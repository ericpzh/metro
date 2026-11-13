// Build the explicit runtime view mapping used by the Unity runtime catalogue.
//
//   node tools/unity-assets/build-runtime-views.mjs           # write the mapping
//   node tools/unity-assets/build-runtime-views.mjs --check   # verify it is current
//
// Inputs, in this order of authority:
//   * `game/src/app/store/catalog.ts` MODULE_OPTIONS — the 152 build palette ids;
//   * `unity/plan/model-migration-checklist.md` — the palette row's promoted prefab;
//   * `unity/asset-recipes/catalogue.json` — the promoted recipe (source provenance);
//   * the overrides below — families the runtime assembles from saved dimensions
//     (generated), families whose artwork is repainted from station content
//     (live), and the city-specific non-palette pieces.
//
// The output is the single mapping `Metro.Editor.RuntimeCatalogue` reads to build
// the serialized catalogue asset, and the Node test
// `unity/tests/runtime-views.test.mjs` checks that it stays complete and current.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const outputPath = join(root, 'unity/asset-recipes/runtime-views.json')

/** Families the runtime generator assembles from the saved document. */
const GENERATED = {
  'hanger-roof': { generator: 'hanger-rod', note: 'rod length and clamp height from the nearest backing surface (`hangerRoofZ`)' },
  escalator: { generator: 'escalator-run', note: 'sloped run, belt and balustrades from the saved incline and direction' },
  walkway: { generator: 'walkway-run', note: 'level moving band from the saved run' },
  lift: { generator: 'lift-shaft', note: 'shaft, landings and car travel from `cfg.rises`' },
  'stair-straight': { generator: 'stair-flights', note: 'straight flights and half-level landings from `cfg.flights`' },
  'stair-left90': { generator: 'stair-flights' },
  'stair-right90': { generator: 'stair-flights' },
  'stair-left180': { generator: 'stair-flights' },
  'stair-right180': { generator: 'stair-flights' },
  'stair-leftForward': { generator: 'stair-flights' },
  'stair-centerForward': { generator: 'stair-flights' },
  'stair-rightForward': { generator: 'stair-flights' },
}
/** Palettes whose prefab artwork is repainted from station content at runtime. */
const LIVE = {
  clock: 'clock-hands',
  'clock-digital': 'clock-display',
  tv: 'tv-panels',
  'tv-double': 'tv-panels',
  'sign-ceiling': 'sign-panels',
  'sign-wall': 'sign-panels',
  exit: 'exit-header',
  'exit-covered-1': 'exit-header',
  'exit-covered-3': 'exit-header',
  'exit-uncovered-1': 'exit-header',
  'exit-uncovered-2': 'exit-header',
  'exit-uncovered-3': 'exit-header',
  'exit-doorway-1': 'exit-header',
  'exit-doorway-2': 'exit-header',
  'exit-virtual': 'exit-header',
  guidepost: 'guidepost-plates',
}
const LIVE_PREFIX = [
  ['billboard-', 'poster-panels'],
  ['linemap-', 'linemap-panels'],
  ['monitor-', 'monitor-panels'],
  ['calligraphy-', 'inscription'],
]
/** Checklist rows the migration record marks as needing a runtime rule. */
const PARTIAL = new Set(['hanger-roof', 'platform-edge', 'structure-ceiling', 'structure-finishes', 'platform-edge-housing', 'track-kit', 'bridge-pillar', 'shop-stock', 'street-arrow-markings', 'dynamic-station-panels'])
/** Checklist rows that are not station view keys (trains, vehicles, audits, parts). */
const SKIP_ROW = /^(train-|vehicle-|city-|structure-|platform-edge-|track-|bridge-|shop-|street-|dynamic-|ramp-|passenger-|catalogue-variant-audit|renderer-source-audit)/
/** Checklist rows for the non-palette bench, door and glass sizes. */
const SUPPLEMENTAL = ['bench-seat-2', 'bench-steel-2', 'bench-wood-2', 'door-steel-2', 'door-wood-2', 'door-glass-2', 'glass-1x4', 'glass-2x4', 'glass-3x4', 'glass-4x4']
const CITY_VIEWS = ['guangzhou', 'shenzhen', 'shanghai', 'beijing', 'chengdu', 'chongqing', 'wuhan', 'nanjing']
const CITY_PARTS = ['exit-canopy', 'exit-header', 'doorway-entrance', 'guidepost', 'train-mark']
const LIVE_CITY_PARTS = new Set(['exit-header', 'doorway-entrance', 'guidepost'])
/** Non-palette view keys the gameplay document can place directly. */
const SINGLES = [
  ['booth', 'ticket-booth'],
  ['shop', 'shop-room'],
  ['retail', 'retail-room'],
]
/** Default pivot of a locally built piece: the cell centre at the floor plane. */
const DEFAULT_OFFSET = [0.5, 0.5, 1]

// A recipe's `parameters.placementOffset` is the source group position measured
// from the cell corner (plan x, plan y, elevation); a bench run centres on its
// cells and insets 0.075 m on local −y instead of using a stored offset.
function placementOf(record, key) {
  const parameters = record?.parameters ?? {}
  if (Array.isArray(parameters.placementOffset) && parameters.placementOffset.length === 3) {
    return { offset: parameters.placementOffset.map((value) => Number(value)), cells: parameters.cells }
  }
  const bench = Boolean(parameters.benchStyle) || /^bench-/.test(key)
  if (bench) {
    const cells = Number.isFinite(parameters.cells) ? parameters.cells : /-2$/.test(key) ? 2 : 1
    return { offset: [0.5 + (cells - 1) / 2, 0.575, 1], cells }
  }
  return { offset: DEFAULT_OFFSET, cells: parameters.cells }
}

const prefabExists = (path) => existsSync(join(root, 'unity', path)) && existsSync(join(root, 'unity', path + '.meta'))
function linkedPrefab(text) {
  const match = text.match(/\]\((\.\.\/Assets\/[^)]+?\.prefab)\)/i)
  return match ? 'Assets/' + match[1].replace(/^\.\.\/Assets\//, '') : null
}

export async function build() {
  const { MODULE_OPTIONS } = await import('../../game/src/app/store/catalog.ts')
  const catalogue = JSON.parse(readFileSync(join(root, 'unity/asset-recipes/catalogue.json'), 'utf8'))
  const recipesByPrefab = new Map()
  for (const record of catalogue.families) {
    const prefab = record.promoted?.prefab
    if (!prefab) continue
    if (!recipesByPrefab.has(prefab)) recipesByPrefab.set(prefab, [])
    recipesByPrefab.get(prefab).push(record)
  }
  const checklistPath = join(root, 'unity/plan/model-migration-checklist.md')
  const rows = new Map()
  if (existsSync(checklistPath)) {
    const checklist = readFileSync(checklistPath, 'utf8')
    for (const line of checklist.split('\n')) {
      if (!line.startsWith('| `')) continue
      const id = line.match(/^\| `([^`]+)`/)?.[1]
      if (!id) continue
      rows.set(id, { status: line.split('|')[3]?.trim() ?? '', prefab: linkedPrefab(line) })
    }
  } else {
    for (const record of catalogue.families) {
      if (record.catalogueId && record.promoted?.prefab) {
        rows.set(record.catalogueId, { status: 'DONE', prefab: record.promoted.prefab })
      }
    }
    if (existsSync(outputPath)) {
      const existing = JSON.parse(readFileSync(outputPath, 'utf8'))
      const byKey = new Map((existing.views ?? []).map((entry) => [entry.key, entry]))
      for (const entry of byKey.values()) {
        rows.set(entry.key, { status: entry.status ?? 'DONE', prefab: entry.prefab ?? null })
      }
      for (const [key, rowId] of SINGLES) {
        const entry = byKey.get(key)
        if (entry) rows.set(rowId, { status: entry.status ?? 'DONE', prefab: entry.prefab ?? null })
      }
      if (byKey.has('track-run')) rows.set('track-kit', { status: byKey.get('track-run').status ?? 'PARTIAL', prefab: null })
      for (const id of CITY_VIEWS) {
        for (const part of CITY_PARTS) {
          const entry = byKey.get(`city:${id}:${part}`)
          if (entry) rows.set(`city-${id}-${part}`, { status: entry.status ?? 'DONE', prefab: entry.prefab ?? null })
        }
      }
    }
  }

  const views = new Map()
  const add = (entry) => {
    if (views.has(entry.key)) throw Error('duplicate runtime view key: ' + entry.key)
    const recipes = entry.prefab ? recipesByPrefab.get(entry.prefab) ?? [] : []
    if (recipes.length) {
      entry.recipeId = recipes.map((record) => record.id).join(' ')
      const placement = placementOf(recipes[0], entry.key)
      entry.offset = placement.offset
      if (Number.isFinite(placement.cells)) entry.cells = placement.cells
    } else if (!entry.offset) {
      entry.offset = placementOf(null, entry.key).offset
    }
    views.set(entry.key, entry)
  }
  const rowPrefab = (id) => {
    const row = rows.get(id)
    if (!row) throw Error('checklist has no promoted prefab row for ' + id)
    if (!row.prefab) throw Error('checklist row has no prefab link: ' + id)
    return row
  }

  for (const option of MODULE_OPTIONS) {
    const row = rowPrefab(option.id)
    const entry = { key: option.id, kind: 'prefab', prefab: row.prefab, palette: true, status: PARTIAL.has(option.id) ? 'PARTIAL' : row.status }
    const generated = GENERATED[option.id]
    if (generated) { entry.kind = 'generated'; entry.generator = generated.generator; if (generated.note) entry.note = generated.note }
    const live = LIVE[option.id] ?? LIVE_PREFIX.find(([prefix]) => option.id.startsWith(prefix))?.[1]
    if (live) { entry.binding = live; if (entry.kind === 'prefab') entry.kind = 'live' }
    add(entry)
  }
  for (const id of SUPPLEMENTAL) {
    const row = rowPrefab(id)
    add({ key: id, kind: 'prefab', prefab: row.prefab, palette: false, status: row.status })
  }
  add({ key: 'platform-edge', kind: 'generated', generator: 'psd-run', palette: false, status: rows.get('platform-edge')?.status ?? 'PARTIAL',
    note: GENERATED['hanger-roof'] ? 'screen door assembly from the saved run and the 6-car L door centres' : '',
    pieces: ['PlatformEdge', 'PlatformEdgeHousing', 'PlatformEdgeHeader', 'PlatformEdgeDecals'] })
  add({ key: 'track-run', kind: 'generated', generator: 'track-run', palette: false, status: rows.get('track-kit')?.status ?? 'PARTIAL',
    note: 'rails, sleepers, power equipment and tunnel from the saved run' })
  add({ key: 'pillar-run', kind: 'generated', generator: 'pillar-run', palette: false, status: rows.get('pillar-slim')?.status ?? 'PARTIAL',
    note: 'column height from the saved cfg.height; the palette prefab is only the 5 m section' })
  for (const [key, rowId] of SINGLES) {
    const row = rowPrefab(rowId)
    add({ key, kind: 'prefab', prefab: row.prefab, palette: false, status: row.status })
  }

  const city = {}
  for (const id of CITY_VIEWS) {
    city[id] = {}
    for (const part of CITY_PARTS) {
      const row = rows.get(`city-${id}-${part}`)
      if (!row?.prefab) { city[id][part] = null; continue }
      const key = `city:${id}:${part}`
      const live = LIVE_CITY_PARTS.has(part)
      city[id][part] = key
      add({ key, kind: live ? 'live' : 'prefab', prefab: row.prefab, palette: false, status: row.status, city: id, part,
        ...(live ? { binding: part === 'guidepost' ? 'guidepost-plates' : 'exit-header' } : {}) })
    }
  }

  const problems = []
  for (const option of MODULE_OPTIONS) if (!views.has(option.id)) problems.push('palette id missing from mapping: ' + option.id)
  for (const entry of views.values()) {
    if (entry.prefab && !prefabExists(entry.prefab)) problems.push('prefab or meta missing: ' + entry.key + ' -> ' + entry.prefab)
    if (entry.kind === 'prefab' && !entry.prefab) problems.push('prefab view without a prefab: ' + entry.key)
    if (entry.kind === 'generated' && !entry.generator) problems.push('generated view without a generator: ' + entry.key)
  }
  const sorted = [...views.values()].sort((a, b) => a.key.localeCompare(b.key))
  const counts = {}
  for (const entry of sorted) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1
  return { schemaVersion: 1, generatedBy: 'tools/unity-assets/build-runtime-views.mjs', counts, problems, views: sorted, city }
}

const mapping = await build()
const text = JSON.stringify(mapping, null, 2) + '\n'
if (mapping.problems.length) {
  console.error(mapping.problems.join('\n'))
  process.exit(1)
}
if (process.argv.includes('--check')) {
  const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : ''
  if (current !== text) {
    console.error('runtime-views.json is stale; run node tools/unity-assets/build-runtime-views.mjs')
    process.exit(1)
  }
  console.log(`RUNTIME_VIEWS_OK ${mapping.views.length} views ${JSON.stringify(mapping.counts)}`)
} else {
  writeFileSync(outputPath, text)
  console.log(`RUNTIME_VIEWS_WRITTEN ${mapping.views.length} views ${JSON.stringify(mapping.counts)}`)
}
