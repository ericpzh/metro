#!/usr/bin/env node
/**
 * Runtime model inventory (plan 10-model-runtime-integration.md, M4.1).
 *
 * Usage:
 *   node tools/unity-assets/audit-runtime-models.mjs [outputPath]
 *
 * Default output: .preview/unity/model-inventory/runtime-model-inventory.json
 * The command prints a short summary and exits 0 when the Unity mappings cover
 * every resolved key and every palette row produced a module. It exits 1 when a
 * `problems` array is non-empty or a palette row could not produce a module.
 *
 * What it does
 * ------------
 * 1. Imports the real TS catalogue (`game/src/app/store/catalog.ts`,
 *    `MODULE_OPTIONS`) and calls the real builder
 *    (`createModule` in `game/src/build/model/Equipment.ts`) for every palette
 *    id at (0, 0, 0), rot 0. Node 24 strips the TS types; the game imports use
 *    explicit `.ts` extensions, so the same sources run here unchanged.
 * 2. Reads the three shipped demo documents directly (`game/src/data/*.json`).
 *    They are station documents, not save envelopes, so there is no
 *    `static.modules` wrapper and no repair step to run: the list is already
 *    the current-catalogue document the game opens. Each placed module is
 *    reduced to a documented *normalized* type + cfg (content, neighbours and
 *    placement offsets are deliberately dropped) so variants collapse to the
 *    configurations the Unity view actually has to choose between.
 * 3. Resolves every enumerated type + cfg to a visual key and a classification
 *    (prefab / generated / live-view / intentional-none / unresolved).
 * 4. Cross-checks the keys against the Unity side: the palette rows of
 *    `unity/plan/model-migration-checklist.md` and the promoted prefab paths in
 *    `unity/asset-recipes/catalogue.json` (files and `.meta` files included).
 *    Build-time provenance matches a catalogue record when either its
 *    `sourcePaths` name the type's builder file (`TYPE_BUILDERS`, e.g. bench ->
 *    BenchModel.ts) or its recipe id's family segment is the normalized type
 *    (`station.checkout.cafe` -> checkout). The second rule catches variants a
 *    shared sub-builder owns (cafe counters are drawn by ShopCounter.ts, not
 *    CheckoutModel.ts) without guessing from the palette id.
 *
 * Resolution rules (kept explicit and data-driven)
 * ------------------------------------------------
 * RULE 0 — palette identity. If a configuration's *key fingerprint* equals a
 *   `MODULE_OPTIONS` row's fingerprint, the resolved key is that palette id
 *   (the key the Unity runtime catalogue uses). This baseline applies to every
 *   type; the family rules below refine the configurations a palette row cannot
 *   express by itself (auto furniture, a fence-door gate, paired TVs, mounts,
 *   generated runs, ...). Fingerprints live in `FINGERPRINTS` and only carry
 *   fields that change the drawn piece; authored content (poster, sign boards,
 *   exit name), neighbour wiring (support, edgeId, boothId) and sub-cell
 *   placement offsets (offset, corner) are excluded.
 * RULE 1 — finite non-palette artwork. The ten variants the checklist records as
 *   "additional variants" have a promoted prefab but no palette tile
 *   (`SUPPLEMENTAL_ARTWORK`): bench-*-2, door-*-2 and the four 4 m glass panels.
 *   They resolve to their own Unity registry key with classification `prefab`.
 *   A supplemental key is the one deliberate exception to the palette/generated/
 *   live/none key forms: it is the record the Unity runtime catalogue already
 *   contains, and the plan's "separate explicit mapping for non-palette assets"
 *   needs exactly this name.
 * RULE 2 — generated assemblies. Escalators, stairs (except the fixed stair
 *   block), lifts, track runs, platform edges, full-height PSD ends, fence-door
 *   gates, parametric booths, non-default curtain walls and exit bays outside
 *   the palette get a `generated:<name>` key (or, when the palette row itself
 *   matches, the palette id) and classification `generated`; the report records
 *   the builder that owns the generator.
 * RULE 3 — live views. TVs, clocks and monitors have a registered prefab but
 *   their displayed content is live runtime state (departure board, time, feed),
 *   so they keep their palette key with classification `live-view`.
 * RULE 4 — everything else is `unresolved`, with a reason string. No key is
 *   invented for a configuration the TS sources do not clearly place.
 *
 * The catalogue key alias table below is part of the audit, not a silent fix.
 * The runtime key for `station.tv.double` is `tv-double` (its own checklist row
 * and TvDouble prefab). A proof run that regenerated the old recipe value
 * (`catalogueId: "tv"`) would collide with `station.tv.standard`; the report
 * would key that record `tv-double` and record the collision in
 * `unity.catalogueKeyAliases` / `unity.duplicateCatalogueIds`, so M1 still sees
 * it. The table is applied only when the declared value differs from the
 * runtime key; at the current HEAD the recipe already says `tv-double`.
 *
 * The one palette id whose own `createModule(id, ...)` call returns null is
 * `tv-double`: it is two back-to-back `tv` modules on one tile, not one module.
 * The pair row is still enumerated (from the `tv` type) and its null attempt is
 * recorded as a type fallback, not as an unresolved palette row. A palette id
 * that has no documented fallback and still returns null is fatal (it lands in
 * `problems.paletteCreationFailures` and the command exits 1).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MODULE_OPTIONS } from '../../game/src/app/store/catalog.ts'
import { createModule, footprintCellsOf } from '../../game/src/build/model/Equipment.ts'
import { benchSpec } from '../../game/src/sim/benches.ts'
import { billboardSpec } from '../../game/src/sim/billboards.ts'
import { counterLength, counterVariant } from '../../game/src/sim/counters.ts'
import { doorSpec } from '../../game/src/sim/doors.ts'
import { extinguisherVariant } from '../../game/src/sim/extinguishers.ts'
import { gateDoorOf } from '../../game/src/sim/gates.ts'
import { glassSpec } from '../../game/src/sim/glassPanels.ts'
import { lineMapSpec } from '../../game/src/sim/linemaps.ts'
import { shelfVariant } from '../../game/src/sim/shelves.ts'
import { signMountOf } from '../../game/src/sim/sign.ts'
import { tvBackToBack } from '../../game/src/sim/tvs.ts'
import { rotateLocal } from '../../game/src/sim/track.ts'

const SCHEMA_VERSION = 1
const DEFAULT_OUTPUT = '.preview/unity/model-inventory/runtime-model-inventory.json'
const PALETTE_SECTION = 'Station palette and additional variants'
const CLASSIFICATIONS = ['prefab', 'generated', 'live-view', 'intentional-none', 'unresolved']

const DEMOS = [
  { id: 'zoo', path: 'game/src/data/demo-station.json' },
  { id: 'tanwei', path: 'game/src/data/tanwei-station.json' },
  { id: 'tianhe', path: 'game/src/data/tianhe-station.json' },
]

/** Source builder per normalized module type, from `render/models.ts`'s dispatch. */
const TYPE_BUILDERS = {
  'ac-unit': 'AcUnitModel.ts',
  bench: 'BenchModel.ts',
  billboard: 'BillboardModel.ts',
  bin: 'BinModel.ts',
  booth: 'BoothModel.ts',
  busstop: 'StreetDecorModel.ts',
  calligraphy: 'CalligraphyModel.ts',
  cctv: 'CctvModel.ts',
  checkout: 'CheckoutModel.ts',
  clock: 'ClockModel.ts',
  court: 'CourtModel.ts',
  cubicle: 'CubicleModel.ts',
  desk: 'DeskModel.ts',
  door: 'DoorModel.ts',
  'electrical-cabinet': 'ElectricalCabinetModel.ts',
  escalator: 'EscalatorModel.ts',
  exit: 'ExitModel.ts',
  extinguisher: 'ExtinguisherModel.ts',
  fence: 'FenceModel.ts',
  'floor-mark': 'FloorMarkModel.ts',
  gate: 'GateModel.ts',
  glass: 'GlassModel.ts',
  guidepost: 'StreetDecorModel.ts',
  hanger: 'HangerModel.ts',
  lawn: 'OutdoorSurfaceModel.ts',
  lift: 'LiftModel.ts',
  light: 'LightModel.ts',
  linemap: 'LineMapModel.ts',
  monitor: 'MonitorModel.ts',
  pillar: 'PillarModel.ts',
  'platform-edge': 'PsdModel.ts',
  'psd-end': 'PsdEndModel.ts',
  'rail-signal': 'RailSignalModel.ts',
  retail: 'RoomModel.ts',
  road: 'RoadModel.ts',
  roof: 'RoofModel.ts',
  shelf: 'ShelfModel.ts',
  shop: 'RoomModel.ts',
  sidewalk: 'OutdoorSurfaceModel.ts',
  sign: 'SignModel.ts',
  sink: 'SinkModel.ts',
  stair: 'StairModel.ts',
  tactile: 'TactileModel.ts',
  track: 'TrackModel.ts',
  'traffic-light': 'TrafficLightModel.ts',
  tree: 'TreeModel.ts',
  tv: 'TvModel.ts',
  tvm: 'TvmModel.ts',
  urinal: 'UrinalModel.ts',
  vending: 'VendingModel.ts',
  vent: 'VentModel.ts',
  walkway: 'WalkwayModel.ts',
}

/** Normalized type + cfg that swaps in a different builder than the type default. */
const BUILDER_OVERRIDES = [
  { type: 'stair', when: (mod) => mod.cfg?.block === true, builder: 'StairBlockModel.ts' },
]

/**
 * Palette ids whose `createModule(id, ...)` call has no case, with the palette's
 * own module type to build instead. `tv-double` is two tv modules back to back
 * on one tile (`sim/tvs.ts`), not one module; the palette row still has to be
 * counted and mapped, so its representative module is a single tv module and
 * the pair is carried in the normalized cfg/fingerprint.
 */
const PALETTE_TYPE_FALLBACKS = {
  'tv-double': {
    type: 'tv',
    note: 'pair palette row: two back-to-back tv modules on one tile (sim/tvs.ts); createModule has no tv-double case',
  },
}

/** Recipe records whose declared catalogueId disagrees with the checklist key. */
const CATALOGUE_KEY_ALIASES = {
  'station.tv.double': {
    key: 'tv-double',
    note: 'declared catalogueId is "tv"; the checklist row and promoted TvDouble prefab are keyed tv-double (M1 owns the recipe fix)',
  },
}

/** Finite non-palette variants with a promoted prefab (`RULE 1`). */
const SUPPLEMENTAL_ARTWORK = new Set([
  'bench-seat-2',
  'bench-steel-2',
  'bench-wood-2',
  'door-glass-2',
  'door-steel-2',
  'door-wood-2',
  'glass-1x4',
  'glass-2x4',
  'glass-3x4',
  'glass-4x4',
])

/**
 * Artwork that covers a `generated:*` key. Each key maps to checklist id
 * prefixes; the first row that has a promoted prefab proves the family exists.
 */
const GENERATED_FAMILY_ARTWORK = {
  'generated:pillar-run': ['pillar-slim', 'pillar-thick'],
  'generated:stair': ['stair-'],
  'generated:escalator': ['escalator'],
  'generated:lift': ['lift'],
  'generated:track': ['track-', 'bridge'],
  'generated:track-bridge': ['bridge'],
  'generated:platform-edge': ['platform-edge'],
  'generated:psd-end-full': ['psd-end', 'platform-edge'],
  'generated:gate-fence': ['gate'],
  'generated:booth-ticket': ['ticket-booth'],
  'generated:booth-info': ['ticket-booth'],
  'generated:curtain-wall': ['curtain-wall'],
  'generated:exit': ['exit'],
}

/** Types whose prefab is a source for a runtime-generated assembly (`RULE 2`). */
const GENERATED_TYPES = new Set(['escalator', 'stair', 'lift', 'track', 'booth', 'platform-edge'])

/** Types whose registered prefab carries live runtime content (`RULE 3`). */
const LIVE_TYPES = new Set(['tv', 'clock', 'monitor'])

/** Generator label for a `generated` row, including palette ids that generate. */
const generatorFor = (type, key) => {
  if (!key) return null
  if (GENERATORS[key]) return GENERATORS[key]
  if (key.startsWith('generated:')) return `${TYPE_BUILDERS[type] ?? 'runtime generator'} (runtime assembly)`
  if (type === 'track') return GENERATORS['generated:track-bridge']
  return GENERATORS[`generated:${type}`] ?? `${TYPE_BUILDERS[type] ?? 'runtime generator'} (runtime assembly)`
}
/**
 * Generator label recorded for a generated classification. Keys may be a
 * `generated:*` key or a palette id whose family is assembled at runtime.
 */
const GENERATORS = {
  'generated:stair': 'StairModel.ts (runtime flights / landings)',
  'generated:escalator': 'EscalatorModel.ts (runtime run)',
  'generated:lift': 'LiftModel.ts (runtime shaft rises)',
  'generated:track': 'TrackModel.ts (runtime track run)',
  'generated:track-bridge': 'TrackModel.ts (runtime bridge run)',
  'generated:platform-edge': 'PsdModel.ts (runtime platform-edge run)',
  'generated:psd-end-full': 'PsdEndModel.ts (full-height end assembly)',
  'generated:gate-fence': 'GateModel.ts (fence-door infill)',
  'generated:booth-ticket': 'BoothModel.ts (parametric ticket booth)',
  'generated:booth-info': 'BoothModel.ts (parametric information island)',
  'generated:curtain-wall': 'GlassModel.ts (curtain height parameter)',
  'generated:exit': 'ExitModel.ts (parametric exit bays)',
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const unityRoot = join(repoRoot, 'unity')

/* --------------------------------------------------------------- utilities */

const round2 = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}

const repoPath = (absolute) => relative(repoRoot, absolute).split(sep).join('/')
const unityPath = (absolute) => relative(unityRoot, absolute).split(sep).join('/')

const readJson = (absolute) => JSON.parse(readFileSync(absolute, 'utf8'))
const readText = (absolute) => readFileSync(absolute, 'utf8')

const listOf = (value) => (Array.isArray(value) ? value : [])
const unique = (values) => [...new Set(values)]
const sortedCounts = (counts) => Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))

const emptyClassificationCounts = () =>
  Object.fromEntries(CLASSIFICATIONS.map((classification) => [classification, 0]))

const countClassifications = (rows) => {
  const counts = emptyClassificationCounts()
  for (const row of rows) counts[row.classification] = (counts[row.classification] ?? 0) + 1
  return { ...counts, total: rows.length }
}

const moduleExtraFields = (mod) => {
  const derived = {}
  if (mod.from !== undefined) derived.from = mod.from
  if (mod.to !== undefined) derived.to = mod.to
  if (mod.panelH !== undefined) derived.panelH = mod.panelH
  if (mod.storeyHeight !== undefined) derived.storeyHeight = mod.storeyHeight
  if (mod.ceilingAnchored !== undefined) derived.ceilingAnchored = mod.ceilingAnchored
  return derived
}

const moduleSummary = (mod) => ({
  type: mod.type,
  w: mod.w ?? null,
  d: mod.d ?? null,
  rot: mod.rot ?? 0,
  ...moduleExtraFields(mod),
})

const footprintFor = (paletteId, mod) => {
  if (!mod) return { cells: [], cellCount: 0, width: 0, depth: 0, source: 'none' }
  let cells = []
  try {
    // `footprintCellsOf` is the catalogue's own footprint rule. The TV pair row
    // has no single tv-double module, so its representative tv module is used.
    cells = footprintCellsOf(mod.type === 'tv' && paletteId === 'tv-double' ? 'tv' : paletteId)
  } catch {
    cells = [[0, 0]]
  }
  if (!Array.isArray(cells) || cells.length === 0) cells = [[0, 0]]
  const xs = cells.map(([x]) => x)
  const ys = cells.map(([, y]) => y)
  return {
    cells: cells.map(([x, y]) => [x, y]),
    cellCount: cells.length,
    width: Math.max(...xs) - Math.min(...xs) + 1,
    depth: Math.max(...ys) - Math.min(...ys) + 1,
    source: 'equipment.footprintCellsOf',
  }
}

/* --------------------------------------------------------- fingerprinting */

const relativeFlight = (mod, point) => {
  const dx = (point?.x ?? 0) - (mod.x ?? 0)
  const dy = (point?.y ?? 0) - (mod.y ?? 0)
  const dz = (point?.z ?? 0) - (mod.z ?? 0)
  const [lx, ly] = rotateLocal(-(mod.rot ?? 0), dx, dy)
  return { x: round2(lx), y: round2(ly), z: round2(dz) }
}

const stairFingerprint = (mod) => {
  const cfg = mod.cfg ?? {}
  if (cfg.block) return { block: true, blockHeight: round2(cfg.blockHeight ?? 1) }
  // The saved `rot` orients the run, and the builder's flight direction is not a
  // pure rotation of the palette's canonical run, so the palette key is matched
  // on the shape and clear width only. The actual flights are parameters for the
  // generator and stay in the normalized cfg below.
  return {
    block: false,
    style: cfg.style ?? 'straight',
    width: round2(cfg.width ?? 0.68),
  }
}

/** Relative flights for the reported cfg (not part of the palette fingerprint). */
const stairFlightsForReport = (mod) => {
  const cfg = mod.cfg ?? {}
  const rawFlights = listOf(cfg.flights)
  return rawFlights.length
    ? rawFlights.map((flight) => ({ from: relativeFlight(mod, flight.from), to: relativeFlight(mod, flight.to) }))
    : mod.from && mod.to
      ? [{ from: relativeFlight(mod, mod.from), to: relativeFlight(mod, mod.to) }]
      : []
}

const tvPairOf = (context) => (context?.pair === 'double' ? 'double' : 'single')

/**
 * The fields that change the drawn piece for one type. This is the input to
 * RULE 0 palette identity; keep it in sync with the family rules in
 * `resolveVisual` when a new parameter starts changing geometry.
 */
const FINGERPRINTS = {
  'ac-unit': () => ({}),
  bench: (mod) => ({ variant: benchSpec(mod.cfg?.variant).variant }),
  billboard: (mod) => ({ variant: billboardSpec(mod.cfg?.variant).variant }),
  bin: () => ({}),
  booth: (mod) => ({ kind: mod.cfg?.kind === 'info' ? 'info' : 'ticket' }),
  busstop: (mod) => ({ variant: mod.cfg?.variant === 'long' ? 'long' : 'short' }),
  calligraphy: (mod) => ({ style: mod.cfg?.style ?? 'kai', axis: mod.cfg?.axis ?? 'h' }),
  cctv: (mod) => ({ variant: mod.cfg?.variant ?? (mod.cfg?.mount === 'post' ? 'post' : 'bullet') }),
  checkout: (mod) => ({ variant: counterVariant(mod.cfg?.variant) }),
  clock: (mod) => ({ variant: mod.cfg?.variant === 'digital' ? 'digital' : 'analogue' }),
  court: (mod) => ({ variant: mod.cfg?.variant ?? 'pickleball' }),
  cubicle: (mod) => ({ variant: mod.cfg?.variant === 'toilet' ? 'toilet' : 'standard' }),
  desk: () => ({}),
  door: (mod) => ({ variant: doorSpec(mod.cfg?.variant).variant }),
  'electrical-cabinet': () => ({}),
  escalator: (mod) => ({
    incline: mod.cfg?.incline ?? 30,
    dir: mod.cfg?.dir === 'down' ? 'down' : 'up',
    width: mod.cfg?.width ?? 1,
  }),
  exit: (mod) => {
    const cfg = mod.cfg ?? {}
    const style = cfg.style === 'doorway' ? 'doorway' : cfg.style === 'virtual' ? 'virtual' : 'head-house'
    const bays = style === 'virtual' ? 1 : [1, 2, 3, 4].includes(Number(cfg.bays)) ? Number(cfg.bays) : 2
    return { covered: cfg.covered !== false, bays, style }
  },
  extinguisher: (mod) => ({ variant: extinguisherVariant(mod.cfg?.variant) }),
  fence: (mod) => ({ variant: mod.cfg?.variant ?? 'glass' }),
  'floor-mark': (mod) => ({ variant: mod.cfg?.variant ?? 'boarding' }),
  gate: (mod) => ({ variant: mod.cfg?.variant === 'new' ? 'new' : 'old', door: gateDoorOf(mod) }),
  glass: (mod) => ({
    variant: glassSpec(mod.cfg?.variant).variant,
    // 4 m is the curtain wall's own default height; treat it as absent so a
    // curtain wall written with an explicit 4 still matches the palette row.
    curtainHeight: mod.cfg?.curtainHeight === 4 ? null : (mod.cfg?.curtainHeight ?? null),
  }),
  guidepost: () => ({}),
  hanger: (mod) => ({ mount: mod.cfg?.mount === 'post' ? 'post' : 'roof' }),
  lawn: () => ({}),
  lift: (mod) => ({
    style: mod.cfg?.style === 'glass' ? 'glass' : 'steel',
    size: mod.cfg?.size === 3 ? 3 : 2,
    rises: listOf(mod.cfg?.rises).map(round2),
  }),
  light: (mod) => ({ variant: mod.cfg?.variant === 'rectangular' ? 'rectangular' : 'circular' }),
  linemap: (mod) => ({ mount: lineMapSpec(mod.cfg?.mount).variant }),
  monitor: (mod) => ({ mount: mod.cfg?.mount === 'wall' ? 'wall' : 'ceiling' }),
  pillar: (mod) => ({ size: mod.cfg?.size === 'thick' ? 'thick' : 'slim', height: round2(mod.cfg?.height ?? 5) }),
  'platform-edge': () => ({}),
  'psd-end': (mod) => ({ psd: mod.cfg?.psd === 'half' ? 'half' : 'full', cover: mod.cfg?.variant === 'cover' }),
  'rail-signal': () => ({}),
  road: (mod) => ({ direction: mod.cfg?.direction === 'one-way' ? 'one-way' : 'two-way' }),
  roof: (mod) => ({ variant: mod.cfg?.variant ?? 'flat' }),
  shelf: (mod) => ({ variant: shelfVariant(mod.cfg?.variant) }),
  sidewalk: () => ({}),
  sign: (mod) => ({ mount: signMountOf(mod.cfg) }),
  sink: () => ({}),
  stair: (mod) => stairFingerprint(mod),
  tactile: (mod) => ({ variant: mod.cfg?.variant ?? 'guide' }),
  track: (mod) => ({ bridge: mod.cfg?.bridge === true }),
  'traffic-light': () => ({}),
  tree: () => ({}),
  tv: (_mod, context) => ({ pair: tvPairOf(context) }),
  tvm: () => ({}),
  urinal: () => ({}),
  vending: () => ({}),
  vent: () => ({}),
  walkway: (mod) => ({ dir: mod.cfg?.dir === 'down' ? 'down' : 'up' }),
  shop: (mod) => ({ kind: mod.cfg?.kind ?? 'store' }),
  retail: (mod) => ({ kind: mod.cfg?.kind ?? 'store' }),
}

function fingerprintFor(mod, context) {
  const fn = FINGERPRINTS[mod.type]
  return fn ? fn(mod, context) : {}
}

/* ----------------------------------------------------------- normalization */

/**
 * The normalized cfg the report prints. It is the fingerprint plus the extra
 * fields that are worth seeing (auto flags, dimensions, authored-content
 * switches) but do not change which visual key is chosen. Authored content
 * itself (sign boards, posters, exit names/demand) is intentionally absent.
 */
function normalizeCfg(mod, context) {
  const cfg = mod.cfg ?? {}
  const fingerprint = fingerprintFor(mod, context)
  switch (mod.type) {
    case 'bench':
    case 'shelf':
    case 'desk':
    case 'cubicle':
    case 'sink':
      return { ...fingerprint, auto: cfg.auto === true }
    case 'billboard':
    case 'tv':
    case 'sign':
      return { ...fingerprint }
    case 'gate':
      return { ...fingerprint, dir: cfg.dir ?? 'both' }
    case 'cctv': {
      const variant = fingerprint.variant
      return { ...fingerprint, mount: cfg.mount ?? (variant === 'post' ? 'post' : 'ceiling') }
    }
    case 'glass':
      return { ...fingerprint }
    case 'psd-end':
      return {
        ...fingerprint,
        ...(cfg.width !== undefined ? { width: round2(cfg.width) } : {}),
        ...(cfg.depth !== undefined ? { depth: round2(cfg.depth) } : {}),
        ...(cfg.side !== undefined ? { side: cfg.side } : {}),
      }
    case 'stair':
      return fingerprint.block ? { ...fingerprint } : { ...fingerprint, flights: stairFlightsForReport(mod) }
    case 'lift':
      return { ...fingerprint, doorCount: Object.keys(cfg.doors ?? {}).length }
    case 'track':
      return {
        ...fingerprint,
        line: cfg.line ?? null,
        power: cfg.power ?? null,
        dir: cfg.dir ?? null,
        tunnel: cfg.tunnel === true,
        catenaryStyle: cfg.catenaryStyle ?? null,
        ...(cfg.bridgeRailing !== undefined ? { bridgeRailing: cfg.bridgeRailing } : {}),
      }
    case 'platform-edge':
      return {
        ...fingerprint,
        psd: cfg.psd ?? 'full',
        side: cfg.side ?? 'left',
        dir: cfg.dir ?? 'up',
        line: cfg.line ?? null,
      }
    case 'exit':
      return { ...fingerprint }
    case 'calligraphy':
      return { ...fingerprint, showEnglish: cfg.showEnglish === true }
    case 'pillar':
      return { ...fingerprint, finish: cfg.finish ?? null }
    case 'roof':
      return { ...fingerprint, finish: cfg.finish ?? null, plateSnap: cfg.plateSnap ?? null }
    case 'checkout':
      return { ...fingerprint, length: counterLength(mod.w) }
    case 'booth':
      return { ...fingerprint, w: mod.w ?? null, h: mod.h ?? null, front: cfg.front ?? 0 }
    case 'shop':
    case 'retail':
      return { ...fingerprint, w: mod.w ?? null, h: mod.h ?? null, stocked: cfg.stocked === true }
    default:
      return { ...fingerprint }
  }
}

/* ------------------------------------------------------------ palette data */

const ctxForPalette = (option, mod) =>
  mod?.type === 'tv' ? { pair: option.id === 'tv-double' ? 'double' : 'single' } : undefined

function buildPaletteRows() {
  const rows = []
  for (const option of MODULE_OPTIONS) {
    const attemptedType = option.id
    let mod = createModule(attemptedType, 0, 0, 0, option.id, 0)
    const create = { attemptedType, status: mod ? 'direct' : 'returned-null', returnedNull: mod === null, fallbackType: null, note: null }
    if (!mod) {
      const fallback = PALETTE_TYPE_FALLBACKS[option.id]
      if (fallback) {
        mod = createModule(fallback.type, 0, 0, 0, option.id, 0)
        create.status = mod ? 'type-fallback' : 'failed'
        create.fallbackType = fallback.type
        create.note = fallback.note
      } else {
        create.status = 'failed'
      }
    }
    const context = ctxForPalette(option, mod)
    rows.push({
      option,
      module: mod,
      derived: mod ? moduleExtraFields(mod) : {},
      create,
      context,
      fingerprint: mod ? fingerprintFor(mod, context) : null,
      cfg: mod ? normalizeCfg(mod, context) : null,
      footprint: footprintFor(option.id, mod),
    })
  }
  return rows
}

const paletteRows = buildPaletteRows()

/** RULE 0 index: type + fingerprint -> palette ids. */
const paletteIndex = new Map()
for (const row of paletteRows) {
  if (!row.module) continue
  const key = `${row.module.type}\0${JSON.stringify(row.fingerprint)}`
  const list = paletteIndex.get(key) ?? []
  list.push(row.option.id)
  paletteIndex.set(key, list)
}

const paletteIdFor = (type, fingerprint) => {
  const list = paletteIndex.get(`${type}\0${JSON.stringify(fingerprint)}`)
  return list && list.length === 1 ? list[0] : null
}

/* ----------------------------------------------------------- visual keys */

const prefabResult = (key) => ({ key, classification: 'prefab', generator: null, reason: null })
const generatedResult = (key) => ({
  key,
  classification: 'generated',
  generator: GENERATORS[key] ?? `${TYPE_BUILDERS[key.replace(/^generated:/, '')] ?? 'runtime generator'}`,
  reason: null,
})
const liveResult = (key) => ({ key, classification: 'live-view', generator: null, reason: null })
const unresolvedResult = (reason) => ({ key: null, classification: 'unresolved', generator: null, reason })

const supplementalKey = (key) => (SUPPLEMENTAL_ARTWORK.has(key) ? key : null)

/**
 * Resolve one module (or the palette's representative module) to the visual key
 * the Unity runtime catalogue will use. `context.pair` is only read for TVs.
 */
function resolveVisual(mod, context = {}) {
  const cfg = mod.cfg ?? {}
  const fingerprint = fingerprintFor(mod, context)
  const palette = () => paletteIdFor(mod.type, fingerprint)

  switch (mod.type) {
    case 'bench': {
      const variant = benchSpec(cfg.variant).variant
      const key = palette() ?? supplementalKey(`bench-${variant}`)
      return key ? prefabResult(key) : unresolvedResult(`bench variant "${variant}" has no palette or supplemental registry key`)
    }
    case 'bin':
      return palette() ? prefabResult(palette()) : unresolvedResult('bin has no palette row')
    case 'gate': {
      if (fingerprint.door === 'fence') {
        return generatedResult('generated:gate-fence')
      }
      const key = palette()
      return key ? prefabResult(key) : unresolvedResult(`gate variant "${fingerprint.variant}" has no palette row`)
    }
    case 'tvm':
      return palette() ? prefabResult(palette()) : unresolvedResult('tvm has no palette row')
    case 'vending':
      return palette() ? prefabResult(palette()) : unresolvedResult('vending has no palette row')
    case 'extinguisher': {
      const key = palette()
      return key ? prefabResult(key) : unresolvedResult(`extinguisher variant "${fingerprint.variant}" has no palette row`)
    }
    case 'electrical-cabinet':
      return palette() ? prefabResult(palette()) : unresolvedResult('electrical-cabinet has no palette row')
    case 'cctv': {
      const key = palette()
      return key ? prefabResult(key) : unresolvedResult(`cctv variant "${fingerprint.variant}" has no palette row`)
    }
    case 'tv': {
      const key = palette()
      return key ? liveResult(key) : unresolvedResult(`tv pair "${fingerprint.pair}" has no palette row`)
    }
    case 'clock': {
      const key = palette()
      return key ? liveResult(key) : unresolvedResult(`clock variant "${fingerprint.variant}" has no palette row`)
    }
    case 'monitor': {
      const key = palette()
      return key ? liveResult(key) : unresolvedResult(`monitor mount "${fingerprint.mount}" has no palette row`)
    }
    case 'linemap': {
      const key = palette()
      return key ? prefabResult(key) : unresolvedResult(`linemap mount "${fingerprint.mount}" has no palette row`)
    }
    case 'sign': {
      const key = palette()
      return key ? prefabResult(key) : unresolvedResult(`sign mount "${fingerprint.mount}" has no palette row`)
    }
    case 'billboard': {
      const key = palette()
      return key ? prefabResult(key) : unresolvedResult(`billboard variant "${fingerprint.variant}" has no palette row`)
    }
    case 'door': {
      const variant = doorSpec(cfg.variant).variant
      const key = palette() ?? supplementalKey(`door-${variant}`)
      return key ? prefabResult(key) : unresolvedResult(`door variant "${variant}" has no palette or supplemental registry key`)
    }
    case 'glass': {
      const variant = glassSpec(cfg.variant).variant
      if (fingerprint.curtainHeight !== null) {
        const key = palette()
        return key ? prefabResult(key) : generatedResult('generated:curtain-wall')
      }
      const key = palette() ?? supplementalKey(`glass-${variant}`)
      return key ? prefabResult(key) : unresolvedResult(`glass variant "${variant}" has no palette or supplemental registry key`)
    }
    case 'fence': {
      const variant = cfg.variant ?? 'glass'
      const key = palette()
      return key ? prefabResult(key) : unresolvedResult(`fence variant "${variant}" has no palette row`)
    }
    case 'psd-end': {
      if (fingerprint.cover) {
        const key = palette()
        return key ? prefabResult(key) : unresolvedResult('psd-end cover has no palette row')
      }
      if (fingerprint.psd === 'half') {
        const key = palette()
        return key ? prefabResult(key) : unresolvedResult('psd-end half-height has no palette row')
      }
      return generatedResult('generated:psd-end-full')
    }
    case 'platform-edge':
      return generatedResult('generated:platform-edge')
    case 'escalator': {
      const key = palette()
      return key ? generatedResult(key) : generatedResult('generated:escalator')
    }
    case 'stair': {
      if (cfg.block) {
        const key = palette()
        // The palette's stair block is the 1 m cube; a saved 0.5 m block is the
        // same builder at another height, so it is a generated stair piece.
        return key ? prefabResult(key) : generatedResult('generated:stair')
      }
      const key = palette()
      return key ? generatedResult(key) : generatedResult('generated:stair')
    }
    case 'lift': {
      const key = palette()
      return key ? generatedResult(key) : generatedResult('generated:lift')
    }
    case 'track': {
      if (cfg.bridge === true) {
        const key = palette()
        return key ? generatedResult(key) : generatedResult('generated:track-bridge')
      }
      return generatedResult('generated:track')
    }
    case 'tactile':
    case 'floor-mark':
    case 'shelf':
    case 'checkout':
    case 'cubicle':
    case 'light': {
      const key = palette()
      return key ? prefabResult(key) : unresolvedResult(`${mod.type} config ${JSON.stringify(fingerprint)} has no palette row`)
    }
    case 'desk':
    case 'sink':
    case 'guidepost':
    case 'vent':
    case 'ac-unit':
    case 'rail-signal': {
      const key = palette()
      return key ? prefabResult(key) : unresolvedResult(`${mod.type} has no palette row`)
    }
    case 'booth': {
      const kind = cfg.kind === 'info' ? 'info' : 'ticket'
      return generatedResult(kind === 'info' ? 'generated:booth-info' : 'generated:booth-ticket')
    }
    case 'exit': {
      const key = palette()
      if (key) return prefabResult(key)
      const { covered, bays, style } = fingerprint
      const shape = style === 'doorway' ? 'doorway' : style === 'virtual' ? 'virtual' : covered ? 'covered' : 'uncovered'
      return generatedResult(`generated:exit-${shape}-${bays}`)
    }
    case 'shop':
    case 'retail':
      // The promoted room shells (ShopRoom / RetailRoom) are the runtime view.
      return prefabResult(mod.type === 'shop' ? 'shop-room' : 'retail-room')
    case 'sidewalk':
    case 'lawn':
    case 'tree':
      // These three carry their own promoted prefabs in `runtime-views.json`
      // (Sidewalk, Lawn, Tree); only court/pillar are assembled at runtime.
      return prefabResult(mod.type)
    case 'court':
    case 'pillar':
      // Saved pillars run 3–11 m tall; the palette prefab is one 5 m section, so the
      // runtime assembles the column from the saved height.
      return generatedResult('generated:pillar-run')
    case 'road':
      // One-way and two-way runs share the asphalt piece; the markings are live content.
      return prefabResult('road')
    case 'hanger':
    case 'roof':
    case 'calligraphy':
    case 'busstop':
    case 'walkway':
    case 'urinal':
    case 'traffic-light': {
      // RULE 0 only for these types: no family-specific rescue, so a saved
      // configuration that the palette cannot express stays unresolved.
      const key = palette()
      return key
        ? prefabResult(key)
        : unresolvedResult(`no palette row or family rule for ${mod.type} config ${JSON.stringify(fingerprint)}`)
    }
    default:
      return unresolvedResult(`no resolver rule for module type "${mod.type}"`)
  }
}

function classificationForKey(type, key, cfg, fallback) {
  if (!key) return 'unresolved'
  if (key.startsWith('generated:')) return 'generated'
  if (key.startsWith('live:')) return 'live-view'
  if (key.startsWith('none:')) return 'intentional-none'
  if (fallback) return fallback
  if (LIVE_TYPES.has(type)) return 'live-view'
  if (GENERATED_TYPES.has(type)) return type === 'stair' && cfg?.block ? 'prefab' : 'generated'
  return 'prefab'
}

/* ------------------------------------------------------------- demo data */

const demoStations = DEMOS.map((demo) => {
  const absolute = join(repoRoot, demo.path)
  const station = readJson(absolute)
  return { ...demo, absolute, station, modules: listOf(station.modules) }
})

/** TV pair membership: two back-to-back tv modules sharing one cell. */
function tvPairMap(modules) {
  const byCell = new Map()
  for (const mod of modules) {
    if (mod.type !== 'tv') continue
    const key = `${mod.x},${mod.y},${mod.z}`
    const list = byCell.get(key) ?? []
    list.push(mod)
    byCell.set(key, list)
  }
  const pairs = new Map()
  for (const list of byCell.values()) {
    for (const mod of list) {
      const mate = list.find((other) => other !== mod && tvBackToBack(mod, other))
      if (mate) pairs.set(mod.id, 'double')
    }
  }
  return pairs
}

const variants = new Map()

for (const demo of demoStations) {
  const pairs = tvPairMap(demo.modules)
  for (const mod of demo.modules) {
    const context = mod.type === 'tv' ? { pair: pairs.get(mod.id) ?? 'single' } : undefined
    const cfg = normalizeCfg(mod, context)
    const variantKey = `${mod.type}\0${JSON.stringify(cfg)}`
    let variant = variants.get(variantKey)
    if (!variant) {
      const resolved = resolveVisual(mod, context)
      variant = {
        type: mod.type,
        cfg,
        resolvedKey: resolved.key,
        classification: resolved.classification,
        generator: resolved.classification === 'generated' ? generatorFor(mod.type, resolved.key) : resolved.generator,
        reason: resolved.reason,
        instances: Object.fromEntries(DEMOS.map((entry) => [entry.id, 0])),
        total: 0,
      }
      variants.set(variantKey, variant)
    }
    variant.instances[demo.id] += 1
    variant.total += 1
  }
}

const variantRows = [...variants.values()].sort(
  (a, b) => a.type.localeCompare(b.type) || a.classification.localeCompare(b.classification) || String(a.resolvedKey).localeCompare(String(b.resolvedKey)) || JSON.stringify(a.cfg).localeCompare(JSON.stringify(b.cfg)),
)

/* --------------------------------------------------------------- reporting */

const sources = {}
const builderFor = (mod) => {
  const override = BUILDER_OVERRIDES.find((entry) => entry.type === mod.type && entry.when(mod))
  return override ? override.builder : TYPE_BUILDERS[mod.type] ?? null
}

const demoRows = {}
const demoSummary = DEMOS.map((demo) => {
  const station = demoStations.find((entry) => entry.id === demo.id)
  return { demo, station }
})

for (const { demo, station } of demoSummary) {
  demoRows[demo.id] = {
    id: demo.id,
    path: demo.path,
    name: station.station.name ?? null,
    nameEn: station.station.nameEn ?? null,
    moduleCount: station.modules.length,
    keys: {},
    classifications: emptyClassificationCounts(),
    unresolved: { count: 0, byType: {} },
    variants: 0,
  }
}

for (const variant of variantRows) {
  for (const demo of DEMOS) {
    const count = variant.instances[demo.id]
    if (!count) continue
    const row = demoRows[demo.id]
    row.variants += 1
    row.classifications[variant.classification] += count
    if (variant.resolvedKey) row.keys[variant.resolvedKey] = (row.keys[variant.resolvedKey] ?? 0) + count
    else {
      row.unresolved.count += count
      row.unresolved.byType[variant.type] = (row.unresolved.byType[variant.type] ?? 0) + count
    }
  }
}

for (const row of Object.values(demoRows)) row.keys = sortedCounts(row.keys)
for (const row of Object.values(demoRows)) {
  row.classifications = { ...row.classifications, total: row.moduleCount }
  row.resolvedPrefabKeys = Object.entries(row.keys).filter(([key]) => {
    const variant = variantRows.find((entry) => entry.resolvedKey === key && entry.classification === 'prefab')
    return Boolean(variant)
  }).length
}

const coverage = {
  palette: countClassifications(
    paletteRows.map((row) => {
      const resolved = resolveVisual(row.module, row.context)
      return {
        classification: classificationForKey(row.module?.type, resolved.key, row.cfg, resolved.classification),
      }
    }),
  ),
  variants: countClassifications(variantRows),
  instances: (() => {
    const counts = emptyClassificationCounts()
    let total = 0
    for (const variant of variantRows) {
      counts[variant.classification] += variant.total
      total += variant.total
    }
    return { ...counts, total }
  })(),
}

/* ---------------------------------------------------------------- Unity */

function normalizeUnityLink(link) {
  if (!link) return null
  if (/^[a-z]+:\/\//i.test(link)) return null
  if (link.startsWith('../')) return link.slice(3)
  if (link.startsWith('Assets/')) return link
  return null
}

function fileState(rel) {
  if (!rel) return { path: null, exists: false, metaExists: false }
  const absolute = join(unityRoot, rel)
  return {
    path: rel,
    exists: existsSync(absolute),
    metaExists: existsSync(`${absolute}.meta`),
  }
}

const checklistPath = 'unity/plan/model-migration-checklist.md'
const checklistRows = []
if (existsSync(join(repoRoot, checklistPath))) {
  const text = readText(join(repoRoot, checklistPath))
  let section = null
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      section = heading[1]
      continue
    }
    const match = /^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)\|\s*$/.exec(line)
    if (!match) continue
    const evidence = match[5].trim()
    const links = [...evidence.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((entry) => entry[1])
    // A checklist row may link a generated serialized asset (the runtime catalogue) as
    // well as a promoted prefab; both must exist with their .meta.
    const prefabLink = links.find((link) => /\.prefab$/i.test(link)) ?? links.find((link) => /\.(prefab|unity|asset)$/i.test(link)) ?? links[0] ?? null
    const rel = normalizeUnityLink(prefabLink)
    const state = fileState(rel)
    checklistRows.push({
      id: match[1],
      section,
      family: match[2].trim(),
      status: (match[3].trim().split(/\s+/)[0] || 'UNKNOWN').toUpperCase(),
      owner: match[4].trim(),
      evidence,
      prefabPath: state.path,
      prefabExists: state.exists,
      prefabMetaExists: state.metaExists,
    })
  }
}

const checklistById = new Map(checklistRows.map((row) => [row.id, row]))
const paletteSectionRows = checklistRows.filter((row) => row.section === PALETTE_SECTION)
const paletteIds = new Set(MODULE_OPTIONS.map((option) => option.id))
const paletteSectionSupplemental = paletteSectionRows.filter((row) => !paletteIds.has(row.id))

const cataloguePath = 'unity/asset-recipes/catalogue.json'
const catalogue = readJson(join(repoRoot, cataloguePath))
const catalogueRecords = []
for (const family of listOf(catalogue.families)) {
  const declaredAlias = CATALOGUE_KEY_ALIASES[family.id] ?? null
  const alias = declaredAlias && declaredAlias.key !== family.catalogueId ? declaredAlias : null
  const effectiveKey = alias?.key ?? family.catalogueId
  const promoted = family.promoted ?? {}
  catalogueRecords.push({
    id: family.id,
    declaredCatalogueId: family.catalogueId ?? null,
    key: effectiveKey,
    aliased: Boolean(alias),
    aliasNote: alias?.note ?? null,
    sourcePaths: listOf(family.sourcePaths),
    buildSources: listOf(family.sourcePaths).map((path) => basename(path)),
    variants: listOf(family.variants),
    model: fileState(promoted.model),
    prefab: fileState(promoted.prefab),
    scene: fileState(promoted.scene),
  })
}

const catalogueByKey = new Map()
const catalogueById = new Map()
for (const record of catalogueRecords) {
  catalogueById.set(record.id, record)
  const list = catalogueByKey.get(record.key) ?? []
  list.push(record)
  catalogueByKey.set(record.key, list)
}

const duplicateCatalogueIds = []
{
  const groups = new Map()
  for (const record of catalogueRecords) {
    const list = groups.get(record.declaredCatalogueId) ?? []
    list.push(record)
    groups.set(record.declaredCatalogueId, list)
  }
  for (const [key, records] of groups) {
    if (records.length < 2) continue
    duplicateCatalogueIds.push({
      key,
      records: records.map((record) => record.id),
      resolvedKeys: records.map((record) => record.key),
      note: records.some((record) => record.aliased)
        ? 'recipe catalogue key collision; resolved by CATALOGUE_KEY_ALIASES (M1 owns the recipe fix)'
        : 'recipe catalogue key collision',
    })
  }
}

/* ---------------------------------------------------------- provenance */

for (const [type, builder] of Object.entries(TYPE_BUILDERS)) {
  if (sources[type]) continue
  const records = catalogueRecords.filter(
    (record) => record.buildSources.includes(builder) || record.id.split('.')[1] === type,
  )
  const checklistMentions = checklistRows.filter((row) => row.family.includes(builder)).map((row) => row.id)
  const sourcePaths = unique(records.flatMap((record) => record.sourcePaths))
  const fallbackPaths =
    sourcePaths.length === 0 && checklistMentions.length > 0
      ? [`game/src/render/models/pieces/${builder}`]
      : []
  sources[type] = {
    type,
    builder,
    builderPath: `game/src/render/models/pieces/${builder}`,
    builderPathExists: existsSync(join(repoRoot, 'game/src/render/models/pieces', builder)),
    catalogueRecords: records.map((record) => record.id).sort(),
    checklistRows: checklistMentions.sort(),
    sourcePaths: sourcePaths.length > 0 ? sourcePaths : fallbackPaths,
    fromChecklist: records.length === 0 && checklistMentions.length > 0,
    overrides: BUILDER_OVERRIDES.filter((entry) => entry.type === type).map((entry) => entry.builder),
  }
}

/** Resolve provenance for one normalized module, including builder overrides. */
const sourcesForModule = (mod) => {
  const builder = builderFor(mod)
  const base = sources[mod.type] ?? null
  if (!base) return { type: mod.type, builder, builderPath: null, catalogueRecords: [], sourcePaths: [] }
  if (!builder || builder === base.builder) return base
  const records = catalogueRecords.filter((record) => record.buildSources.includes(builder))
  return {
    type: mod.type,
    builder,
    builderPath: `game/src/render/models/pieces/${builder}`,
    builderPathExists: existsSync(join(repoRoot, 'game/src/render/models/pieces', builder)),
    catalogueRecords: records.map((record) => record.id).sort(),
    checklistRows: checklistRows.filter((row) => row.family.includes(builder)).map((row) => row.id).sort(),
    sourcePaths: unique(records.flatMap((record) => record.sourcePaths)),
    fromChecklist: records.length === 0,
    overrides: base.overrides,
  }
}

/** Provenance for a normalized variant row (stair-block swaps its builder). */
const variantSources = (type, cfg) => {
  if (type === 'stair' && cfg?.block) {
    const builder = 'StairBlockModel.ts'
    const records = catalogueRecords.filter((record) => record.buildSources.includes(builder))
    return {
      type,
      builder,
      builderPath: `game/src/render/models/pieces/${builder}`,
      catalogueRecords: records.map((record) => record.id).sort(),
      sourcePaths: unique(records.flatMap((record) => record.sourcePaths)),
    }
  }
  return sources[type] ?? null
}

/* ------------------------------------------------------- Unity coverage */

const runtimeViewsPath = 'unity/asset-recipes/runtime-views.json'
const runtimeViews = existsSync(join(repoRoot, runtimeViewsPath)) ? readJson(join(repoRoot, runtimeViewsPath)) : { views: [] }
const runtimeViewsByKey = new Map(
  listOf(runtimeViews.views).map((entry) => [entry.key, { ...entry, prefabState: fileState(entry.prefab) }]),
)

const prefabCoverage = (key) => {
  const row = checklistById.get(key)
  if (row?.prefabPath && row.prefabExists && row.prefabMetaExists) {
    return { covered: true, source: 'checklist', prefabPath: row.prefabPath, status: row.status, rowId: row.id }
  }
  const records = catalogueByKey.get(key) ?? []
  const record = records.find((entry) => entry.prefab.exists && entry.prefab.metaExists)
  if (record) {
    return { covered: true, source: 'catalogue', prefabPath: record.prefab.path, status: 'DONE', rowId: checklistById.get(key)?.id ?? null }
  }
  const viewEntry = runtimeViewsByKey.get(key)
  if (viewEntry?.prefabState.path && viewEntry.prefabState.exists && viewEntry.prefabState.metaExists) {
    return { covered: true, source: 'runtime-views', prefabPath: viewEntry.prefabState.path, status: viewEntry.status ?? 'DONE', rowId: null }
  }
  return {
    covered: false,
    source: null,
    prefabPath: row?.prefabPath ?? records[0]?.prefab.path ?? viewEntry?.prefabState.path ?? null,
    status: row?.status ?? viewEntry?.status ?? null,
    rowId: row?.id ?? null,
  }
}

const generatedCoverage = (key) => {
  const direct = prefabCoverage(key)
  if (direct.covered) return direct
  const prefixes = GENERATED_FAMILY_ARTWORK[key]
  if (prefixes) {
    for (const prefix of prefixes) {
      const matches = checklistRows.filter((row) =>
        prefix.endsWith('-') ? row.id.startsWith(prefix) : row.id === prefix,
      )
      const row = matches.find((entry) => entry.prefabPath && entry.prefabExists && entry.prefabMetaExists)
      if (row) {
        return {
          covered: true,
          source: 'family-checklist',
          prefabPath: row.prefabPath,
          status: row.status,
          rowId: row.id,
        }
      }
      const recordMatches = catalogueRecords.filter((entry) =>
        prefix.endsWith('-') ? (entry.key ?? '').startsWith(prefix) || entry.id.includes(`.${prefix.slice(0, -1)}`) : entry.key === prefix || entry.id.endsWith(`.${prefix}`),
      )
      const record = recordMatches.find((entry) => entry.prefab.path && entry.prefab.exists && entry.prefab.metaExists)
      if (record) {
        return {
          covered: true,
          source: 'family-catalogue',
          prefabPath: record.prefab.path,
          status: 'DONE',
          rowId: null,
        }
      }
      const viewMatches = [...runtimeViewsByKey.values()].filter((entry) =>
        prefix.endsWith('-') ? entry.key.startsWith(prefix) : entry.key === prefix,
      )
      const viewEntry = viewMatches.find(
        (entry) => (entry.prefabState.path && entry.prefabState.exists && entry.prefabState.metaExists) || entry.kind === 'generated',
      )
      if (viewEntry) {
        return {
          covered: true,
          source: 'family-runtime-views',
          prefabPath: viewEntry.prefabState.path,
          status: viewEntry.status ?? 'PARTIAL',
          rowId: null,
        }
      }
    }
  }
  return { covered: false, source: null, prefabPath: null, status: null, rowId: null }
}

const unityCoverageFor = (classification, key) => {
  if (!key) return { covered: false, source: 'unresolved', prefabPath: null, status: null, rowId: null }
  if (classification === 'intentional-none') {
    return { covered: true, source: 'intentional-none', prefabPath: null, status: null, rowId: null }
  }
  if (classification === 'generated') return generatedCoverage(key)
  return prefabCoverage(key)
}

/* ------------------------------------------------------------- problems */

const problems = {
  paletteCreationFailures: [],
  paletteWithoutArtwork: [],
  artworkWithoutPaletteKey: [],
  duplicateRegistryKeys: [],
  missingFiles: [],
  resolvedKeysNotInUnity: [],
  inconsistentVariantKeys: [],
}

for (const row of paletteRows) {
  if (!row.module) {
    problems.paletteCreationFailures.push({
      id: row.option.id,
      attemptedType: row.create.attemptedType,
      fallbackType: row.create.fallbackType,
      status: row.create.status,
      reason: row.create.note ?? 'createModule returned null for the palette id and no type fallback is documented',
    })
  }
}

const registryGroups = [
  { registry: 'MODULE_OPTIONS', entries: MODULE_OPTIONS.map((option) => option.id) },
  { registry: 'checklist.palette', entries: paletteSectionRows.map((row) => row.id) },
  { registry: 'catalogue.effectiveKey', entries: catalogueRecords.map((record) => record.key) },
]
for (const group of registryGroups) {
  const seen = new Map()
  for (const key of group.entries) seen.set(key, (seen.get(key) ?? 0) + 1)
  for (const [key, count] of seen) {
    if (count > 1) problems.duplicateRegistryKeys.push({ registry: group.registry, key, count })
  }
}

for (const row of paletteRows) {
  const coverageEntry = row.module ? prefabCoverage(row.option.id) : { covered: false, source: null, prefabPath: null, status: null, rowId: null }
  if (!coverageEntry.covered) {
    problems.paletteWithoutArtwork.push({
      id: row.option.id,
      checklistStatus: coverageEntry.status,
      checklistPrefab: coverageEntry.prefabPath,
      reason: row.module ? 'no promoted checklist/catalogue prefab with a readable .meta file' : 'palette id produced no module',
    })
  }
}

for (const row of paletteSectionSupplemental) {
  if (!SUPPLEMENTAL_ARTWORK.has(row.id)) {
    problems.artworkWithoutPaletteKey.push({
      id: row.id,
      section: row.section,
      status: row.status,
      prefabPath: row.prefabPath,
      reason: 'palette-section artwork is neither a MODULE_OPTIONS id nor one of the documented ten additional variants',
    })
  }
}

for (const record of catalogueRecords) {
  for (const kind of ['model', 'prefab', 'scene']) {
    const state = record[kind]
    if (!state.path) continue
    if (!state.exists) {
      problems.missingFiles.push({
        source: 'catalogue',
        record: record.id,
        kind,
        path: state.path,
        reason: 'file does not exist',
      })
    } else if (!state.metaExists) {
      problems.missingFiles.push({
        source: 'catalogue',
        record: record.id,
        kind,
        path: `${state.path}.meta`,
        reason: 'Unity .meta file does not exist',
      })
    }
  }
}
for (const row of checklistRows) {
  if (!row.prefabPath) continue
  if (!row.prefabExists) {
    problems.missingFiles.push({
      source: 'checklist',
      id: row.id,
      kind: 'prefab',
      path: row.prefabPath,
      reason: 'linked prefab does not exist',
    })
  } else if (!row.prefabMetaExists) {
    problems.missingFiles.push({
      source: 'checklist',
      id: row.id,
      kind: 'prefab',
      path: `${row.prefabPath}.meta`,
      reason: 'Unity .meta file does not exist',
    })
  }
}

/* -------------------------------------------- resolved-key Unity coverage */

const resolvedKeyIndex = new Map()
const noteResolvedKey = (key, classification, type, instances = 0) => {
  if (!key) return
  const entry = resolvedKeyIndex.get(key) ?? {
    key,
    classifications: new Set(),
    types: new Set(),
    instances: 0,
  }
  entry.classifications.add(classification)
  entry.types.add(type)
  entry.instances += instances
  resolvedKeyIndex.set(key, entry)
}

for (const row of paletteRows) {
  if (!row.module) continue
  const resolved = resolveVisual(row.module, row.context)
  noteResolvedKey(resolved.key, classificationForKey(row.module.type, resolved.key, row.cfg, resolved.classification), row.module.type, 1)
}
for (const variant of variantRows) {
  noteResolvedKey(variant.resolvedKey, variant.classification, variant.type, variant.total)
}

const resolvedKeys = [...resolvedKeyIndex.values()]
  .map((entry) => {
    const classification = [...entry.classifications][0] ?? 'unresolved'
    const coverageEntry = unityCoverageFor(classification, entry.key)
    return {
      key: entry.key,
      classification,
      classifications: [...entry.classifications].sort(),
      types: [...entry.types].sort(),
      instances: entry.instances,
      unityCovered: coverageEntry.covered,
      unitySource: coverageEntry.source,
      prefabPath: coverageEntry.prefabPath,
      checklistStatus: coverageEntry.status,
      checklistRow: coverageEntry.rowId,
    }
  })
  .sort((a, b) => a.classification.localeCompare(b.classification) || a.key.localeCompare(b.key))

for (const entry of resolvedKeys) {
  if (entry.classifications.length > 1) {
    problems.inconsistentVariantKeys.push({
      key: entry.key,
      classifications: entry.classifications,
      types: entry.types,
      reason: 'one resolved key is claimed by configurations with different classifications',
    })
  }
  if (!entry.unityCovered) {
    problems.resolvedKeysNotInUnity.push({
      key: entry.key,
      classification: entry.classification,
      types: entry.types,
      instances: entry.instances,
      reason:
        entry.classification === 'generated'
          ? 'no checklist/catalogue family artwork proves the generator source'
          : 'no checklist row or recipe record promotes a prefab for this key',
    })
  }
}

/* --------------------------------------------------------------- report */

const paletteReport = paletteRows.map((row) => {
  const resolved = row.module ? resolveVisual(row.module, row.context) : unresolvedResult('palette id produced no module')
  const classification = row.module
    ? classificationForKey(row.module.type, resolved.key, row.cfg, resolved.classification)
    : 'unresolved'
  const coverageEntry = row.module ? prefabCoverage(row.option.id) : { covered: false, source: null, prefabPath: null, status: null, rowId: null }
  const prefabState = fileState(coverageEntry.prefabPath)
  const provenance = row.module ? sourcesForModule(row.module) : null
  return {
    id: row.option.id,
    label: row.option.label ?? null,
    type: row.module?.type ?? row.option.type,
    paletteW: row.option.w,
    paletteH: row.option.h,
    module: row.module ? moduleSummary(row.module) : null,
    cfg: row.cfg,
    footprint: row.footprint,
    resolvedKey: resolved.key,
    classification,
    prefabPath: coverageEntry.prefabPath,
    prefabExists: prefabState.exists,
    prefabMetaExists: prefabState.metaExists,
    unityStatus: coverageEntry.status,
    unityCovered: coverageEntry.covered,
    unitySource: coverageEntry.source,
    generator: classification === 'generated' ? generatorFor(row.module?.type ?? row.option.type, resolved.key) : null,
    sourcesRef: row.module?.type ?? null,
    sourceBuilder: provenance?.builder ?? null,
    sourcePaths: provenance?.sourcePaths ?? [],
    catalogueRecords: provenance?.catalogueRecords ?? [],
    create: row.create,
    unresolvedReason: classification === 'unresolved' ? (resolved.reason ?? null) : null,
  }
})

const unitySide = {
  checklist: {
    path: checklistPath,
    rows: checklistRows.length,
    sections: unique(checklistRows.map((row) => row.section).filter(Boolean)),
    paletteSectionRows: paletteSectionRows.length,
    statusCounts: (() => {
      const counts = {}
      for (const row of checklistRows) counts[row.status] = (counts[row.status] ?? 0) + 1
      return counts
    })(),
  },
  catalogue: {
    path: cataloguePath,
    records: catalogueRecords.length,
    uniqueEffectiveKeys: new Set(catalogueRecords.map((record) => record.key)).size,
    schemaVersion: catalogue.schemaVersion ?? null,
    keyAliases: catalogueRecords
      .filter((record) => record.aliased)
      .map((record) => ({
        record: record.id,
        declaredCatalogueId: record.declaredCatalogueId,
        effectiveKey: record.key,
        note: record.aliasNote,
      })),
    duplicateCatalogueIds,
  },
  palette: {
    total: paletteReport.length,
    covered: paletteReport.filter((row) => row.unityCovered).length,
    byStatus: paletteReport.reduce((counts, row) => {
      const status = row.unityStatus ?? 'MISSING'
      counts[status] = (counts[status] ?? 0) + 1
      return counts
    }, {}),
    partial: paletteReport.filter((row) => row.unityStatus === 'PARTIAL').map((row) => row.id),
  },
  supplementalArtwork: paletteSectionSupplemental
    .filter((row) => SUPPLEMENTAL_ARTWORK.has(row.id))
    .map((row) => ({
      id: row.id,
      status: row.status,
      prefabPath: row.prefabPath,
      prefabExists: row.prefabExists,
      prefabMetaExists: row.prefabMetaExists,
    })),
  nonPaletteArtwork: {
    checklistRows: checklistRows.filter((row) => row.section !== PALETTE_SECTION).length,
    sections: unique(checklistRows.filter((row) => row.section !== PALETTE_SECTION).map((row) => row.section).filter(Boolean)),
  },
  paletteWithoutArtwork: problems.paletteWithoutArtwork,
  artworkWithoutPaletteKey: problems.artworkWithoutPaletteKey,
  duplicateRegistryKeys: problems.duplicateRegistryKeys,
  missingFiles: problems.missingFiles,
  resolvedKeysNotInUnity: problems.resolvedKeysNotInUnity,
  resolvedKeys: resolvedKeys.map((entry) => ({
    key: entry.key,
    classification: entry.classification,
    types: entry.types,
    instances: entry.instances,
    unityCovered: entry.unityCovered,
    unitySource: entry.unitySource,
    prefabPath: entry.prefabPath,
    checklistStatus: entry.checklistStatus,
  })),
}

const report = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  head: null,
  dirty: false,
  git: { head: null, dirty: false, dirtyFiles: [], error: null },
  inputs: {
    catalog: 'game/src/app/store/catalog.ts',
    equipment: 'game/src/build/model/Equipment.ts',
    demos: DEMOS.map((demo) => demo.path),
    checklist: checklistPath,
    catalogue: cataloguePath,
    demoLoader: 'raw station document modules (the shipped demos are StationData JSON, not save envelopes; no repair pass is applied)',
  },
  palette: paletteReport,
  demos: demoRows,
  variants: variantRows.map((variant) => {
    const provenance = variantSources(variant.type, variant.cfg)
    return {
      type: variant.type,
      cfg: variant.cfg,
      resolvedKey: variant.resolvedKey,
      classification: variant.classification,
      generator: variant.generator,
      reason: variant.reason,
      instances: variant.instances,
      total: variant.total,
      sourcesRef: variant.type,
      sourceBuilder: provenance?.builder ?? null,
      sourcePaths: provenance?.sourcePaths ?? [],
      catalogueRecords: provenance?.catalogueRecords ?? [],
    }
  }),
  coverage,
  problems,
  sources,
  unity: unitySide,
  summary: {
    palette: paletteReport.length,
    paletteTypeFallbacks: paletteReport
      .filter((row) => row.create.returnedNull)
      .map((row) => ({ id: row.id, fallbackType: row.create.fallbackType, note: row.create.note })),
    demos: DEMO_ORDER(),
    variants: variantRows.length,
    instances: coverage.instances.total,
    unresolved: (() => {
      const byType = {}
      let instances = 0
      let variants = 0
      for (const variant of variantRows) {
        if (variant.classification !== 'unresolved') continue
        variants += 1
        instances += variant.total
        byType[variant.type] = (byType[variant.type] ?? 0) + variant.total
      }
      return { variants, instances, byType: sortedCounts(byType) }
    })(),
    resolvedKeys: resolvedKeys.length,
    unityCoveredResolvedKeys: resolvedKeys.filter((entry) => entry.unityCovered).length,
    problems: Object.values(problems).reduce((total, list) => total + list.length, 0),
  },
}

function DEMO_ORDER() {
  return DEMOS.map((demo) => demo.id)
}

/* --------------------------------------------------------------- git */

try {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true }).trim()
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true })
  const dirtyFiles = status.split(/\r?\n/).filter(Boolean)
  report.head = head
  report.dirty = dirtyFiles.length > 0
  report.git = { head, dirty: report.dirty, dirtyFiles, error: null }
} catch (error) {
  report.git = { head: null, dirty: false, dirtyFiles: [], error: String(error?.message ?? error) }
}

/* --------------------------------------------------------------- write */

const outputArg = process.argv[2] ?? DEFAULT_OUTPUT
const outputPath = resolve(process.cwd(), outputArg)
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

const classificationSummary = (counts) =>
  CLASSIFICATIONS.map((classification) => `${classification} ${counts[classification] ?? 0}`).join(', ')

const fatalProblems = Object.entries(problems).filter(([, list]) => list.length > 0)
console.log(`runtime model inventory -> ${repoPath(outputPath)}`)
console.log(`  palette ${paletteReport.length}: ${classificationSummary(coverage.palette)}`)
console.log(`  demos ${DEMO_ORDER().map((id) => `${id} ${demoRows[id].moduleCount}`).join(', ')} (${coverage.instances.total} modules)`)
console.log(`  variants ${variantRows.length}: ${classificationSummary(coverage.variants)}`)
console.log(`  resolved keys ${resolvedKeys.length}, Unity covers ${resolvedKeys.filter((entry) => entry.unityCovered).length}`)
console.log(`  palette artwork ${unitySide.palette.covered}/${unitySide.palette.total} covered (${unitySide.palette.partial.length} PARTIAL)`)
for (const fallback of report.summary.paletteTypeFallbacks) {
  console.log(`  palette type fallback: ${fallback.id} -> ${fallback.fallbackType} (${fallback.note})`)
}
if (report.summary.unresolved.instances > 0) {
  const detail = Object.entries(report.summary.unresolved.byType)
    .map(([type, count]) => `${type} ${count}`)
    .join(', ')
  console.log(`  unresolved: ${report.summary.unresolved.variants} variants, ${report.summary.unresolved.instances} instances (${detail})`)
}
if (unitySide.catalogue.keyAliases.length > 0) {
  for (const alias of unitySide.catalogue.keyAliases) {
    console.log(`  catalogue alias: ${alias.record} declared "${alias.declaredCatalogueId}" -> "${alias.effectiveKey}"`)
  }
}
if (fatalProblems.length > 0) {
  for (const [name, list] of fatalProblems) console.log(`  problem ${name}: ${list.length}`)
} else {
  console.log('  problems: none')
}
console.log(`  exit ${fatalProblems.length > 0 ? 1 : 0}`)

process.exitCode = fatalProblems.length > 0 ? 1 : 0
