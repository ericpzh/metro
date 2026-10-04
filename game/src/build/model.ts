// Build model helpers: the sparse cell list, the station document, and the
// commands that edit it. Pure data, no React.

import { finishOf, floorSpeed } from '../sim/finishes.ts'
import { zoneIndex } from '../sim/zones.ts'
import { carveRampOpenings } from '../sim/openings.ts'
import { isTrackCell, reservedOpening } from '../sim/placement.ts'
import { LEVEL_STEPS } from '../sim/constants.ts'
import { BILLBOARD_SPECS, billboardSpec, postersFor } from '../sim/billboards.ts'
import { benchSpec } from '../sim/benches.ts'
import { edgeCells, trackCells, trackOriginForCentre } from '../sim/track.ts'
import { exitFloorAt } from '../sim/exits.ts'
import { escalatorModule, type EscalatorDir } from '../sim/escalators.ts'
import { liftExtendedDown, liftExtendedUp, liftModule } from '../sim/lifts.ts'
import { STAIR_WIDTH_NARROW, stairFlightsFor, stairLandings, stairTurnCells } from '../sim/stairs.ts'
import { makeSignBoards, settleSignBoards, signBoardsOf, type SignBoardsDraft, type SignLineSource } from '../sim/sign.ts'
import { DEFAULT_ZONE, type BenchVariant, type BillboardVariant, type Cell, type ExitBays, type Face, type FinishId, type GateDoor, type Module, type RoomKind, type StairStyle, type StationData, type Vec3i, type Zone } from '../sim/types.ts'
import { referenceStation } from '../data/reference-station.ts'

export function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

/**
 * Snap an arbitrary z to the nearest fixed storey. The storey grid itself lives
 * in `sim/constants.ts` (`LEVEL_STEPS`); Q/E steps through it and the depth rail
 * lists exactly it, so the work plane is always on the 4-unit grid the reference
 * station is built on (G = 0, B1 = -4, B2 = -8) instead of jumping between
 * whatever z values happen to have walkable cells.
 */
export function nearestLevel(z: number): number {
  let best = LEVEL_STEPS[0]
  for (const l of LEVEL_STEPS) if (Math.abs(l - z) < Math.abs(best - z)) best = l
  return best
}

/**
 * The z of the at-grade (street) level — h = 0 m. A surface exit head-house is
 * rooted here and nowhere else: its opening and canopy belong at the ground, not
 * on a concourse or platform slab. There are no named levels any more; the
 * street is simply z = 0.
 */
export const GROUND_Z = 0

/**
 * A placed escalator is a fixed one-storey piece, the same footprint as a
 * straight stair: it rises `ESCALATOR_RUN` cells along the placement rotation.
 * `dir` chooses whether it carries people up (from the base to the top) or down
 * (from the top to the base) — the run itself always climbs from the cell it is
 * dropped on. The piece itself lives in `sim/escalators.ts`, so the builder and
 * the reference station place the exact same equipment.
 */
export { ESCALATOR_RISE, ESCALATOR_RUN, nextEscalatorDir } from '../sim/escalators.ts'

/**
 * Where a 指示牌's composed layout reads its lines from: the station document
 * itself, or just its `lines` array. The placement tool holds the whole document
 * and the model tests hold an array, and neither should have to wrap the other.
 */
export type SignLineInput = StationData | ReadonlyArray<StationData['lines'][number]>

function linesOf(source: SignLineInput): SignLineSource {
  return Array.isArray(source) ? { lines: source } : (source as StationData)
}/**
 * Build a fresh module payload for one cell. Shared by the placement tool and
 * the on-hover ghost, so the preview is the exact module the click would add.
 * `width` is the stair width — omitted, a stair is the narrow piece, exactly the
 * escalator's step band — `dir` the escalator direction and `door` the 闸机 piece
 * (a working lane or the fence machine, toggled with Tab); other types ignore
 * them. Returns null for a type the placement UI cannot create yet.
 *
 * A stair or escalator is a fixed-length piece: its base is the cell, and it
 * climbs one storey `STAIR_RUN` cells along the placement rotation.
 *
 * `lines` and `sign` are only read by a 指示牌. A fresh board is composed from the
 * station's own lines (`defaultSignLayout`) so the ghost a player hovers already
 * carries their 1号线的 colour and number instead of a placeholder; `sign` is the
 * **current** pair of boards (`store.currentBoards`), and a placed sign carries a
 * copy of it, so the player composes once and hangs as many signs as they like. A
 * 指示牌 placed without a `sign` still gets a readable default front — and, as ever,
 * an empty back.
 */
export function createModule(
  type: string,
  x: number,
  y: number,
  z: number,
  id: string,
  rot = 0,
  width?: number,
  dir: EscalatorDir = 'up',
  door: GateDoor = 'lane',
  lines: SignLineInput = [],
  sign?: SignBoardsDraft,
): Module | null {
  switch (type) {
    case 'gate':
      return { id, type: 'gate', x, y, z, rot, cfg: { dir: 'both', door } }
    case 'fence':
      return { id, type: 'fence', x, y, z, rot, cfg: {} }
    case 'tvm':
      return { id, type: 'tvm', x, y, z, rot, cfg: {} }
    case 'vending':
      return { id, type: 'vending', x, y, z, rot, cfg: {} }
    case 'bench':
    case 'bench-steel-1':
    case 'bench-steel-2':
    case 'bench-seat-1':
    case 'bench-seat-2': {
      // The palette id names the variant; a bare `bench` (an old caller, or the
      // room builder's staff seat) is the 1 m stainless piece. A two-cell run is
      // centred on the hovered cell like a track piece, so it grows evenly.
      const variant: BenchVariant = type === 'bench' ? 'steel-1' : (type.slice('bench-'.length) as BenchVariant)
      const spec = benchSpec(variant)
      const [ox, oy] = trackOriginForCentre(rot, x, y, spec.w, 1)
      return { id, type: 'bench', x: ox, y: oy, z, rot, w: spec.w, cfg: { variant: spec.variant } }
    }
    case 'shelf':
      return { id, type: 'shelf', x, y, z, rot, cfg: {} }
    case 'desk':
      return { id, type: 'desk', x, y, z, rot, cfg: {} }
    case 'cubicle':
      return { id, type: 'cubicle', x, y, z, rot, cfg: {} }
    case 'sink':
      return { id, type: 'sink', x, y, z, rot, cfg: {} }
    case 'billboard':
    case 'billboard-wide':
    case 'billboard-standard':
    case 'billboard-large':
    case 'billboard-panorama':
    case 'billboard-portrait':
    case 'billboard-square': {
      // The palette id names the variant; a bare `billboard` (an old caller)
      // falls back to the small landscape. The run is centred on the hovered
      // cell like a track piece, so a two-cell banner grows evenly either side.
      // No poster yet: `randomAdSlug` rolls one when the piece is committed, so
      // the hover ghost does not re-roll its artwork on every pointer move.
      const variant: BillboardVariant = type === 'billboard' ? 'wide' : (type.slice('billboard-'.length) as BillboardVariant)
      const spec = BILLBOARD_SPECS[variant] ?? BILLBOARD_SPECS.wide
      const [ox, oy] = trackOriginForCentre(rot, x, y, spec.w, 1)
      return { id, type: 'billboard', x: ox, y: oy, z, rot, w: spec.w, cfg: { variant: spec.variant } }
    }
    case 'tv':
      return { id, type: 'tv', x, y, z, rot, cfg: {} }
    case 'sign': {
      // A board is born with a composed **front** (§5.8), not a blank face: the
      // station's first line is already on it, so a fresh sign is readable before
      // the player has opened its editor. The current pair, when there is one, is
      // what the piece actually hangs — copied, because the next sign must be free
      // to be composed differently without reprinting this one. The **back** is
      // empty unless the player has composed one: a sign is one-sided until it is
      // said otherwise.
      const boards = sign ? settleSignBoards(sign, linesOf(lines)) : makeSignBoards(undefined, linesOf(lines))
      return { id, type: 'sign', x, y, z, rot, cfg: { front: boards.front.map((c) => ({ ...c })), back: boards.back.map((c) => ({ ...c })) } }
    }
    case 'exit':
    case 'exit-covered-1':
    case 'exit-covered-2':
    case 'exit-covered-3':
    case 'exit-uncovered-1':
    case 'exit-uncovered-2':
    case 'exit-uncovered-3': {
      // The palette id names the variant: `exit` (or -covered-) is the 有盖
      // head-house and -uncovered- is the open 无盖 railing exit; the trailing
      // digit is the bay count (单向 / 双向 / 三向). A bare `exit` (an old caller
      // or save) is the reference covered two-bay piece.
      const parts = type.split('-')
      const covered = parts[1] !== 'uncovered'
      const n = Number(parts[2])
      const bays: ExitBays = n === 1 || n === 3 ? n : 2
      // The placeholder name is the fallback: the placement caller swaps in the
      // next free A ~ Z letter (`nextExitName`), so a fresh exit reads like real
      // signage. A save with no name, or all 26 letters used, keeps it.
      return { id, type: 'exit', x, y, z, rot, cfg: { name: '未命名口', inRate: 900, open: true, covered, bays } }
    }
    case 'escalator':
      // The one shared piece: the run always climbs from the dropped cell;
      // `dir` only orders from/to, which is what the sim reads as the one-way
      // travel and the label.
      return escalatorModule({ x, y, z }, rot, dir, id)
    case 'lift':
      // An elevator: one storey up from the dropped cell. The player grows the
      // shaft a storey at a time (`extendLift`), so a fresh piece is always two
      // stops.
      return liftModule({ x, y, z }, rot, id)
    case 'stair': {
      const style = 'straight' as StairStyle
      const flights = stairFlightsFor({ x, y, z }, rot, style)
      return {
        id,
        type: 'stair',
        x,
        y,
        z,
        rot,
        from: flights[0].from,
        to: flights[flights.length - 1].to,
        cfg: { width: width ?? STAIR_WIDTH_NARROW, style, flights },
      }
    }
    case 'stair-straight':
    case 'stair-right90':
    case 'stair-left90':
    case 'stair-right180': {
      const style = type.slice('stair-'.length) as StairStyle
      const flights = stairFlightsFor({ x, y, z }, rot, style)
      return {
        id,
        type: 'stair',
        x,
        y,
        z,
        rot,
        from: flights[0].from,
        to: flights[flights.length - 1].to,
        cfg: { width: width ?? STAIR_WIDTH_NARROW, style, flights },
      }
    }
    default:
      return null
  }
}

/**
 * Roll the poster a freshly placed ad screen prints. Deterministic in the module
 * id — `nextModuleId` never reuses one — so the same click in the same station
 * always hangs the same campaign, and an undo/redo pair does not reshuffle the
 * wall. The candidates are filtered to the panel's silhouette, so a landscape
 * panel is never asked to print a portrait poster.
 */
export function randomAdSlug(mod: Module): string {
  const shape = mod.type === 'billboard' ? billboardSpec(mod.cfg.variant).shape : 'landscape'
  const choices = postersFor(shape)
  let hash = 2166136261
  for (let i = 0; i < mod.id.length; i++) {
    hash ^= mod.id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return choices[(hash >>> 0) % choices.length].slug
}

/** True for an ad screen (广告牌 / 电视) that has no poster yet. */
function needsPoster(mod: Module): boolean {
  return (mod.type === 'billboard' || mod.type === 'tv') && mod.cfg.poster === undefined
}

/**
 * Give every ad screen without one its placed poster: 广告牌 and 电视 print one
 * real campaign each, rolled when the piece is committed and then frozen. A
 * legacy save (or the demo) predates `cfg.poster` and is filled in here rather
 * than at draw time, so the poster is part of the document — it survives a save,
 * a reload and every later frame unchanged.
 *
 * The billboard and TV arms are written out separately because each has its own
 * `cfg` shape; a shared spread would have to describe both at once.
 */
function assignAdPosters(modules: readonly Module[]): Module[] {
  let changed = false
  const out = modules.map((mod): Module => {
    if (!needsPoster(mod)) return mod
    changed = true
    const poster = randomAdSlug(mod)
    if (mod.type === 'billboard') return { ...mod, cfg: { ...mod.cfg, poster } }
    if (mod.type === 'tv') return { ...mod, cfg: { ...mod.cfg, poster } }
    return mod
  })
  return changed ? out : [...modules]
}

/**
 * Every 指示牌's two boards, repaired on the way in (§5.8).
 *
 * A sign saved before the board was a document carries no components at all; one
 * saved by an older build of the editor may carry a scale or a centre the panel can
 * no longer hold; and one saved before a sign had a **back** carries its two faces
 * folded into one list with a `side` on each mark. All three are fixed here, once,
 * rather than at draw time — the same reason `assignAdPosters` rolls a poster on
 * load instead of per frame. A sign that already has a usable pair is returned
 * untouched, so this is not a per-frame rewrite of the document.
 *
 * A component that names a line the station no longer has is **left alone**: the
 * shield prints the neutral plate until that line comes back, which is better
 * than silently rebinding a sign to another line.
 */
function ensureSignLayouts(modules: readonly Module[], lines: SignLineSource): Module[] {
  let changed = false
  const out = modules.map((mod): Module => {
    if (mod.type !== 'sign') return mod
    const boards = signBoardsOf(mod.cfg, lines)
    const same =
      mod.cfg.components === undefined &&
      mod.cfg.front !== undefined &&
      mod.cfg.back !== undefined &&
      mod.cfg.front.length === boards.front.length &&
      mod.cfg.back.length === boards.back.length &&
      mod.cfg.front.every((c, i) => c === boards.front[i]) &&
      mod.cfg.back.every((c, i) => c === boards.back[i])
    if (same) return mod
    changed = true
    // The legacy `components` list is dropped, not carried along: the pair now says
    // everything it said, and leaving it in place would let a later write put the
    // old single board back on the front.
    return { ...mod, cfg: { front: boards.front, back: boards.back } }
  })
  return changed ? out : [...modules]
}

/**
 * Append an equipment module. A stair also lays its own half/quarter landings as
 * floor cells, so a turning flight has a walkable node between its two flights
 * (the model draws the platform and the block mesher skips it). A ramp landing
 * on an exit's floor materialises that cell too: the exit covers it even where
 * a carve left a hole, so the graph keeps the ramp's edge nodes. A ramp
 * (escalator, stair, lift) then carves the slab it climbs through; flat
 * equipment is a plain append.
 *
 * The append is also where a 装饰 screen's poster is rolled (`assignAdPosters`),
 * so one click hangs one campaign for good.
 */
export function addEquipment(state: StationState, mod: Module): StationState {
  const modules = assignAdPosters([...state.modules, mod])
  const isRamp = mod.type === 'escalator' || mod.type === 'stair' || mod.type === 'lift'
  if (!isRamp) return { ...state, modules }
  const cells = state.cells.map(cloneCell)
  const have = new Set(cells.filter((c) => c.fill === 'solid').map((c) => cellKey(c.x, c.y, c.z)))
  const lay = (p: Vec3i): void => {
    const k = cellKey(p.x, p.y, p.z)
    if (have.has(k)) return
    have.add(k)
    cells.push({ x: p.x, y: p.y, z: p.z, fill: 'solid' })
  }
  if (mod.type === 'stair') {
    for (const p of stairTurnCells(mod)) lay(p)
  }
  // Landings on exit floor count even as holes: lay the cell so the graph can
  // stand on it. Laid before the carve, which protects landing cells.
  const landings: Vec3i[] =
    mod.type === 'stair' ? stairLandings(mod) : mod.type === 'escalator' || mod.type === 'lift' ? [mod.from, mod.to] : []
  for (const p of landings) {
    if (!have.has(cellKey(p.x, p.y, p.z)) && exitFloorAt(modules, p.x, p.y, p.z)) lay(p)
  }
  carveRampOpenings(cells, modules)
  return { ...state, cells, modules }
}

/** The neighbour a face looks out on. */
const FACE_STEP: Record<Face, [number, number, number]> = {
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  n: [0, 1, 0],
  s: [0, -1, 0],
  e: [1, 0, 0],
  w: [-1, 0, 0],
}

/** The four in-plane neighbours of a face (used by the surface fill). */
const FACE_PLANE: Record<Face, Array<[number, number, number]>> = {
  top: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]],
  bottom: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]],
  e: [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
  w: [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
  n: [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]],
  s: [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]],
}

function cloneCell(c: Cell): Cell {
  return c.finish ? { ...c, finish: { ...c.finish } } : { ...c }
}

export interface StationState {
  name: string
  seed: number
  cells: Cell[]
  modules: Module[]
  lines: StationData['lines']
}

export function toState(data: StationData): StationState {
  const state: StationState = {
    name: data.name,
    seed: data.seed,
    cells: data.cells.map(cloneCell),
    // A save written before ad screens carried a poster (or the demo) gets one
    // printed now, so a loaded station shows the same campaign on every frame
    // instead of re-rolling it at draw time.
    modules: ensureSignLayouts(assignAdPosters(data.modules), data).map((m) => ({ ...m })),
    // Older saves predate the per-line direction termini; default them to ''
    // so the screen header falls back to the direction word instead of undefined.
    lines: data.lines.map((l) => ({ ...l, upTerminus: l.upTerminus ?? '', downTerminus: l.downTerminus ?? '' })),
  }
  // Rooms drawn before furniture became modules carry no shelf/desk pieces
  // yet — materialise them here so every load path (open, demo, new) agrees.
  return ensureRoomFurniture(state)
}

export function toData(s: StationState): StationData {
  return { name: s.name, seed: s.seed, cells: s.cells, modules: s.modules, lines: s.lines }
}

export function cloneState(s: StationState): StationState {
  return {
    name: s.name,
    seed: s.seed,
    cells: s.cells.map(cloneCell),
    modules: s.modules.map((m) => JSON.parse(JSON.stringify(m)) as Module),
    lines: s.lines.map((l) => JSON.parse(JSON.stringify(l))),
  }
}

/**
 * Add solid cells, ignoring ones that are already solid and refusing any that
 * would cover a reserved opening — a ramp's carved corridor or an exit's floor
 * (`reservedOpening`). Without this guard the block brush could fill an
 * auto-generated hole and seal a stair, escalator or exit in. Returns the cells
 * added and how many were refused.
 */
export function addCells(
  cells: Cell[],
  add: Array<[number, number, number]>,
  modules: readonly Module[] = [],
): { cells: Cell[]; changed: number; blocked: number } {
  const have = new Set(cells.map((c) => cellKey(c.x, c.y, c.z)))
  const out = cells.slice()
  let changed = 0
  let blocked = 0
  for (const [x, y, z] of add) {
    const k = cellKey(x, y, z)
    if (have.has(k)) continue
    if (reservedOpening(modules, x, y, z)) {
      blocked++
      continue
    }
    // A placed rail's bed is already covered ground: the 地基 merge must not
    // pour a block into the trench (and the live ghost drops the same cells).
    if (isTrackCell(cells, modules, x, y, z)) continue
    have.add(k)
    out.push({ x, y, z, fill: 'solid' })
    changed++
  }
  return { cells: out, changed, blocked }
}

/** Remove solid cells and any modules hosted on them. */
export function removeCells(state: StationState, remove: Array<[number, number, number]>): StationState {
  const kill = new Set(remove.map(([x, y, z]) => cellKey(x, y, z)))
  const cells = state.cells.filter((c) => !kill.has(cellKey(c.x, c.y, c.z)))
  const modules = state.modules.filter((m) => !kill.has(cellKey(m.x, m.y, m.z)))
  return { ...state, cells, modules }
}

/** Bulldoze one module, leaving the block it stood on. */
export function removeModule(state: StationState, id: string): StationState {
  const modules = state.modules.filter((m) => m.id !== id)
  return modules.length === state.modules.length ? state : { ...state, modules }
}

/** The elevator shaft standing in a column, if any. */
export function liftInColumn(modules: readonly Module[], x: number, y: number): Extract<Module, { type: 'lift' }> | undefined {
  for (const m of modules) if (m.type === 'lift' && m.x === x && m.y === y) return m
  return undefined
}

/**
 * Grow an existing shaft one storey up or down. The shaft keeps its id and its
 * column; only its reach changes, so a hover-extension reads as the same
 * elevator getting taller rather than a new piece appearing.
 */
export function extendLift(state: StationState, id: string, up: boolean): StationState {
  const mod = state.modules.find((m) => m.id === id)
  if (!mod || mod.type !== 'lift') return state
  const grown = up ? liftExtendedUp(mod) : liftExtendedDown(mod)
  return { ...state, modules: state.modules.map((m) => (m.id === id ? grown : m)) }
}

/** A free `${type}-n` id, so bulldozing then placing again never reuses one. */
export function nextModuleId(modules: readonly Module[], type: string): string {
  const taken = new Set(modules.map((m) => m.id))
  let n = modules.length + 1
  while (taken.has(`${type}-${n}`)) n++
  return `${type}-${n}`
}

/**
 * The default name for a freshly placed exit: the first free letter A ~ Z, as
 * `A口` / `B口` / … (GAME-SPEC.md §5.6). Real signage letters its exits rather
 * than leaving every one 未命名口, and a deleted exit frees its letter for reuse.
 * A rename to anything not starting A ~ Z simply keeps that name; once all 26
 * letters are taken the placeholder comes back.
 */
export function nextExitName(modules: readonly Module[]): string {
  const used = new Set<string>()
  for (const m of modules) {
    if (m.type !== 'exit') continue
    const letter = m.cfg.name.trim().charAt(0).toUpperCase()
    if (letter >= 'A' && letter <= 'Z') used.add(letter)
  }
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i)
    if (!used.has(letter)) return `${letter}口`
  }
  return '未命名口'
}

/**
 * The rotation for a dragged fence (围栏) run: the panel follows the drag
 * direction like the 墙 tool (§5.2) — an east–west drag lays panels along +x
 * (rot 0), a north–south drag along +y (rot 1). Ties go east–west, matching
 * `straightLineCells` in the viewport. A single cell returns `null`, so the
 * caller keeps the R rotation.
 *
 * The span is read from the full extent of the cells, never from the press cell
 * against a sorted end: a run laid toward −x/−y would otherwise be compared with
 * itself and turn crosswise (the zig-zag bug).
 */
export function fenceRotForLine(cells: ReadonlyArray<readonly [number, number, number]>): number | null {
  if (cells.length < 2) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const c of cells) {
    if (c[0] < minX) minX = c[0]
    if (c[0] > maxX) maxX = c[0]
    if (c[1] < minY) minY = c[1]
    if (c[1] > maxY) maxY = c[1]
  }
  return maxX - minX >= maxY - minY ? 0 : 1
}

export function isSolid(cells: Cell[], x: number, y: number, z: number): boolean {
  for (const c of cells) if (c.x === x && c.y === y && c.z === z && c.fill === 'solid') return true
  return false
}

/* ---------------------------------------------------------- surfaces (§4.3) */

/** The finish override on one face, or undefined for the family default. */
export function faceOverride(cells: Cell[], x: number, y: number, z: number, face: Face): FinishId | undefined {
  return cells.find((c) => c.x === x && c.y === y && c.z === z)?.finish?.[face]
}

/** Paint one exposed face. Returns the same state when nothing changed. */
export function paintFace(state: StationState, x: number, y: number, z: number, face: Face, finish: FinishId): StationState {
  const i = state.cells.findIndex((c) => c.x === x && c.y === y && c.z === z)
  if (i < 0) return state
  const cur = state.cells[i]
  if (cur.finish?.[face] === finish) return state
  const cells = state.cells.slice()
  cells[i] = { ...cur, finish: { ...cur.finish, [face]: finish } }
  return { ...state, cells }
}

/** Erase a face back to its family default. */
export function eraseFace(state: StationState, x: number, y: number, z: number, face: Face): StationState {
  const i = state.cells.findIndex((c) => c.x === x && c.y === y && c.z === z)
  if (i < 0) return state
  const cur = state.cells[i]
  if (!cur.finish?.[face]) return state
  const finish = { ...cur.finish }
  delete finish[face]
  const next = cloneCell(cur)
  if (finish && Object.keys(finish).length > 0) next.finish = finish
  else delete next.finish
  const cells = state.cells.slice()
  cells[i] = next
  return { ...state, cells }
}

/**
 * Paint one face across many cells at once — the `N`/`M` drag rectangle (§9.5).
 * Cells absent from the list, or already wearing the finish, are left untouched.
 */
export function paintFaces(state: StationState, cells: Array<[number, number, number]>, face: Face, finish: FinishId): StationState {
  const keys = new Set(cells.map(([x, y, z]) => cellKey(x, y, z)))
  if (keys.size === 0) return state
  let changed = false
  const next = state.cells.map((c) => {
    if (!keys.has(cellKey(c.x, c.y, c.z)) || c.finish?.[face] === finish) return c
    changed = true
    return { ...c, finish: { ...c.finish, [face]: finish } }
  })
  return changed ? { ...state, cells: next } : state
}

/** Erase one face across many cells at once, back to the family default. */
export function eraseFaces(state: StationState, cells: Array<[number, number, number]>, face: Face): StationState {
  const keys = new Set(cells.map(([x, y, z]) => cellKey(x, y, z)))
  if (keys.size === 0) return state
  let changed = false
  const next = state.cells.map((c) => {
    if (!keys.has(cellKey(c.x, c.y, c.z)) || !c.finish?.[face]) return c
    changed = true
    const finish = { ...c.finish }
    delete finish[face]
    if (Object.keys(finish).length === 0) {
      const copy = cloneCell(c)
      delete copy.finish
      return copy
    }
    return { ...c, finish }
  })
  return changed ? { ...state, cells: next } : state
}

/* ----------------------------------------------------------- zones (§4.5) */

export function zoneAt(cells: Cell[], x: number, y: number, z: number): Zone {
  return cells.find((c) => c.x === x && c.y === y && c.z === z)?.zone ?? DEFAULT_ZONE
}

/**
 * Paint a zone. The spec's bucket tool (§4.5): flood-fill the connected floor
 * at the clicked level. `bucket: false` sets one cell.
 */
export function paintZone(state: StationState, x: number, y: number, z: number, zone: Zone, bucket = true): StationState {
  const solid = new Map<string, number>()
  state.cells.forEach((c, i) => {
    if (c.fill === 'solid') solid.set(cellKey(c.x, c.y, c.z), i)
  })
  const targets = new Set<number>()
  const start = solid.get(cellKey(x, y, z))
  if (start === undefined) return state
  if (!bucket) {
    targets.add(start)
  } else {
    // Flood the connected floor, but stop at an existing zone line so a region
    // can be repainted once its boundary has been drawn.
    const startZone = state.cells[start].zone ?? DEFAULT_ZONE
    const sameZone = (cx: number, cy: number, cz: number): boolean => {
      const idx = solid.get(cellKey(cx, cy, cz))
      return idx !== undefined && (state.cells[idx].zone ?? DEFAULT_ZONE) === startZone
    }
    const seen = new Set<string>([cellKey(x, y, z)])
    const queue: Array<[number, number, number]> = [[x, y, z]]
    while (queue.length > 0 && targets.size < 20000) {
      const [cx, cy, cz] = queue.pop() as [number, number, number]
      const idx = solid.get(cellKey(cx, cy, cz))
      if (idx === undefined) continue
      targets.add(idx)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = cellKey(cx + dx, cy + dy, cz)
        if (seen.has(k) || !sameZone(cx + dx, cy + dy, cz)) continue
        seen.add(k)
        queue.push([cx + dx, cy + dy, cz])
      }
    }
  }
  let changed = false
  const cells = state.cells.map((c, i) => {
    if (!targets.has(i) || (c.zone ?? DEFAULT_ZONE) === zone) return c
    changed = true
    return { ...c, zone }
  })
  return changed ? { ...state, cells } : state
}

/**
 * Set one zone across a set of cells at once — the zone tool's rectangle drag.
 * Only solid cells that are not already in the zone change, and void cells the
 * rectangle covers are ignored, so the drag reads as "tint this patch".
 */
export function paintZoneCells(
  state: StationState,
  cells: Array<[number, number, number]>,
  zone: Zone,
): StationState {
  if (cells.length === 0) return state
  const keys = new Set(cells.map(([x, y, z]) => cellKey(x, y, z)))
  let changed = false
  const next = state.cells.map((c) => {
    if (c.fill !== 'solid' || !keys.has(cellKey(c.x, c.y, c.z))) return c
    if ((c.zone ?? DEFAULT_ZONE) === zone) return c
    changed = true
    return { ...c, zone }
  })
  return changed ? { ...state, cells: next } : state
}

/* ---------------------------------------------------- zone map (§4.5 overlay) */

/**
 * The cells a zone map draws on: the walkable floor, never a roof or a wall top.
 * A cell qualifies when its top face is exposed and walkable, or is a track bed
 * sitting at the foot of its column (the restricted zone). The earth roof over
 * a tunnel and the coping on top of a wall are structure — tinting those is what
 * used to put the zone map on the ceiling instead of the floor.
 */
export function zoneMapFloors(cells: readonly Cell[], modules: readonly Module[] = []): Cell[] {
  const solid = new Set<string>()
  for (const c of cells) if (c.fill === 'solid') solid.add(cellKey(c.x, c.y, c.z))
  const out = cells.filter(
    (c) =>
      c.fill === 'solid' &&
      !solid.has(cellKey(c.x, c.y, c.z + 1)) &&
      (floorSpeed(c) > 0 || (finishOf(c, 'top') === 'floor.track' && !solid.has(cellKey(c.x, c.y, c.z - 1)))),
  )
  // A placed rail digs its bed, so those cells are gone from `cells`. Add the
  // module footprint back as a synthetic restricted cell, so the zone map still
  // tints and names the track.
  const have = new Set(out.map((c) => cellKey(c.x, c.y, c.z)))
  for (const m of modules) {
    if (m.type !== 'track') continue
    const d = m.d ?? 1
    for (let x = m.x; x < m.x + m.w; x++) {
      for (let y = m.y; y < m.y + d; y++) {
        const k = cellKey(x, y, m.z)
        if (have.has(k)) continue
        have.add(k)
        out.push({ x, y, z: m.z, fill: 'solid', finish: { top: 'floor.track' }, zone: 'restricted' })
      }
    }
  }
  return out
}

/** A zone-name label for the zone map, in world coordinates. */
export interface ZoneLabel {
  x: number
  y: number
  z: number
  /** Dense zone index (see `ZONE_INDEX`). */
  zone: number
}

/** The four in-plane neighbours, for the zone-area flood the labels ride on. */
const NEIGH4: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/** Smallest area that earns a text label, so stray single cells stay unlabelled. */
const LABEL_MIN_CELLS = 6

/**
 * One label per contiguous same-zone floor patch, at the patch's centre. The
 * zone map then names each area (付费区, 站台 …) instead of leaving the player to
 * read colours — the text is what makes it a map.
 */
export function zoneRegionLabels(floors: readonly Cell[]): ZoneLabel[] {
  const byKey = new Map<string, Cell>()
  for (const c of floors) byKey.set(cellKey(c.x, c.y, c.z), c)
  const seen = new Set<string>()
  const labels: ZoneLabel[] = []
  for (const start of floors) {
    const startKey = cellKey(start.x, start.y, start.z)
    if (seen.has(startKey)) continue
    const zone = zoneIndex(start.zone)
    const stack: Cell[] = [start]
    seen.add(startKey)
    const region: Cell[] = []
    let sx = 0
    let sy = 0
    while (stack.length > 0) {
      const cur = stack.pop() as Cell
      region.push(cur)
      sx += cur.x + 0.5
      sy += cur.y + 0.5
      for (const [dx, dy] of NEIGH4) {
        const k = cellKey(cur.x + dx, cur.y + dy, cur.z)
        const nb = byKey.get(k)
        if (!nb || seen.has(k) || zoneIndex(nb.zone) !== zone) continue
        seen.add(k)
        stack.push(nb)
      }
    }
    if (region.length < LABEL_MIN_CELLS) continue
    // Centroid, then snap to the region cell nearest it, so the label always
    // sits on the area (and its tint) rather than floating over a concavity.
    const cx = sx / region.length
    const cy = sy / region.length
    let best = region[0]
    let bestD = Infinity
    for (const c of region) {
      const d = (c.x + 0.5 - cx) ** 2 + (c.y + 0.5 - cy) ** 2
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    labels.push({ x: best.x + 0.5, y: best.y + 0.5, z: best.z + 1.06, zone })
  }
  return labels
}

/* ------------------------------------- build floors & their auto walls (§4.1) */

/**
 * Tag on a floor cell the 地基 tool drew. A patch is tracked by its cells
 * rather than by a module, so an L-shape or a drag that overlaps hand-built
 * ground all read as one continuous surface. Hand-built floor (the demo, a
 * saved station) is deliberately untagged: it is treated as ground the patch
 * can merge into, not as a patch of its own.
 */
export const AUTO_FLOOR = 'auto-floor'

/** Tag on an automatically raised wall block — never on a hand-placed one. */
export const AUTO_WALL = 'auto-wall'

/**
 * Height of a wall, in blocks: the player asked for a 4 m wall and one block is
 * one metre, so four courses stand above the floor.
 */
export const AUTO_WALL_H = 4

/**
 * Tag on a wall block the 墙 tool laid. The tag is what lets the tool's
 * right-click find the whole column under the pointer — geometry alone cannot
 * tell a wall course from the floor it stands on. `AUTO_WALL` blocks answer the
 * same lookup, so a hand run and a generated ring can both be lifted in bulk.
 */
export const WALL = 'wall'

function hasTag(c: { tags?: string[] }, tag: string): boolean {
  return c.tags?.includes(tag) === true
}

/**
 * Every cell a placed track covers — a platform bed or a tunnel run. A rail
 * digs its bed, so those cells have left `state.cells` and read as void to the
 * wall flood; the 地基 auto merge treats the whole footprint as covered ground
 * instead of an opening to wall off (see `syncAutoWalls`).
 */
function trackFootprintKeys(modules: readonly Module[]): Set<string> {
  const out = new Set<string>()
  for (const m of modules) {
    if (m.type !== 'track') continue
    for (const [x, y, z] of trackCells(m)) out.add(cellKey(x, y, z))
  }
  return out
}

/**
 * Every floor cell a platform screen door stands on. The 地基 auto-wall ring
 * skips these, so a full track sliced through a patch never boards up the
 * screen doors derived along its platform edge.
 */
function platformDoorKeys(modules: readonly Module[]): Set<string> {
  const out = new Set<string>()
  for (const m of modules) {
    if (m.type !== 'platform-edge') continue
    for (const [x, y, z] of edgeCells(m)) out.add(cellKey(x, y, z))
  }
  return out
}

/**
 * The wall a 墙 tool drag lays: a full-height column on every cell of the run.
 * `cells` are the base cells the wall rises from (the hovered floor's top), so
 * the four courses are `z..z+3`.
 */
export function wallRun(cells: Array<[number, number, number]>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  for (const [x, y, z] of cells) for (let dz = 0; dz < AUTO_WALL_H; dz++) out.push([x, y, z + dz])
  return out
}

/* ------------------------------------------------------- 墙-tool smart snapping */

/**
 * A horizontal direction, as a step in cell coordinates. `s` is `+y` because
 * `+y` is "north" in this codebase's plan (the axes note in the repo guide:
 * `n` is `+y`, `e` is `+x`).
 */
type WallDir = 'n' | 'e' | 's' | 'w'

/** The four directions, in the order the 墙 tool cycles them with **R**. */
export const WALL_DIRS: readonly WallDir[] = ['n', 'e', 's', 'w']

const WALL_STEPS: Record<WallDir, readonly [number, number]> = {
  n: [0, 1],
  e: [1, 0],
  s: [0, -1],
  w: [-1, 0],
}

/** The 墙 tool's arrow id ↔ direction, the same quarter-turns `rot` uses. */
const WALL_ROT_DIR: readonly WallDir[] = ['s', 'w', 'n', 'e']

/**
 * The direction a pointer offset points at, snapped to the nearer of the two
 * axes it spans. The 墙 tool works in whole cells, so "which edge is the pointer
 * beyond" is a quadrant test, not a distance: a purely diagonal offset resolves
 * to `dx >= dy` (east or west) by the tie rule below.
 */
export function wallPointerDir(dx: number, dy: number): WallDir {
  const ex = Math.abs(dx)
  const ey = Math.abs(dy)
  if (ex === 0 && ey === 0) return 's' // dead centre: the tool's own default face
  if (ex >= ey) return dx >= 0 ? 'e' : 'w'
  return dy >= 0 ? 'n' : 's'
}

/**
 * The quarter-turn that faces `dir` — the *output* of a snap, never an input to
 * one. A snapped wall face is turned back into the placement rotation so the
 * rest of the tool (and anything mounted on the wall) reads one convention.
 */
export function wallDirRot(dir: WallDir): number {
  return WALL_ROT_DIR.indexOf(dir)
}

/** True when no wall course of either kind stands at `(x, y, z)`. */
function wallAbsent(cells: readonly Cell[], x: number, y: number, z: number): boolean {
  return !cells.some((c) => c.x === x && c.y === y && c.z === z && isWallCell(c))
}

/** True when a solid floor block stands at `(x, y, z)`. */
function wallFloor(cells: readonly Cell[], x: number, y: number, z: number): boolean {
  return cells.some((c) => c.x === x && c.y === y && c.z === z && c.fill === 'solid')
}

/**
 * The directions in which `(x, y, z)` faces open space — the edges the 墙 tool
 * walls, and the same edge the 地基 auto-wall ring picks (`syncAutoWalls`).
 *
 * An edge is open when the neighbour carries **no wall** and **no floor** on
 * this storey. The wall half is what stops the tool offering a side that already
 * carries a wall; the floor half is what makes "buried" mean anything — without
 * it a cell in the middle of a floor would read as open on all four sides,
 * because the cells around it are floor rather than wall, and it would never
 * step out to the edge that actually wants a wall.
 */
function wallVoidEdges(cells: readonly Cell[], x: number, y: number, z: number): WallDir[] {
  const out: WallDir[] = []
  for (const d of WALL_DIRS) {
    const [dx, dy] = WALL_STEPS[d]
    const nx = x + dx
    const ny = y + dy
    if (wallAbsent(cells, nx, ny, z) && !wallFloor(cells, nx, ny, z)) out.push(d)
  }
  return out
}

/**
 * Where the 墙 tool stands the next column, and which of its wall faces it
 * takes. This is the tool's smart snap (§5.1).
 *
 * A wall is a full-height 1 m course, so a snap cannot slide a block *within* a
 * cell the way a fence panel or a billboard slides. It picks the cell and the
 * face instead, by these rules:
 *
 *  1. **A clean edge wins.** A floor cell with exactly one open edge is walled
 *     where it stands, facing that edge — the ordinary case, and the whole outer
 *     ring of a drawn patch.
 *  2. **A corner is a choice, and R is that choice.** A cell open on two or more
 *     sides stays put, and the chosen direction decides which face the column
 *     takes. **R** steps through the candidates best-first, so at a corner it
 *     picks which wall the course continues.
 *  3. **Only a cell with no edge of its own moves.** A cell buried inside a
 *     floor is closed on every side, so the column steps to the nearest
 *     neighbour that does face open space, faced back toward the hovered cell.
 *
 * "Open" is `wallVoidEdges`: no wall **and** no floor in the neighbour.
 *
 * **Orientation is never an input.** The snap is a pure function of the geometry
 * around the hovered cell, so the column lands the same way whatever the player
 * last pressed R for. R only steps through the candidates the geometry already
 * produced — it can never change *where* the wall goes, only which of two equally
 * valid faces at a corner is taken. Treating a placement rotation as the
 * starting point (the way a fence panel or a billboard takes `rot`) is exactly
 * the trap: it makes the player turn the piece before the tool will agree with
 * them, instead of the tool reading the wall and turning the piece itself.
 *
 * `cells` is the station's cell list, `cell` the hovered base cell, `z` the
 * storey the wall rises from, and `pointer` the pointer's world `[x, y]` when
 * the caller has one — it only breaks a tie, so a rule still holds without it.
 * `cycle` is how many times **R** has stepped the candidate list; it wraps, so
 * the choice is always valid.
 */
export interface WallSnap {
  /** The base cell the column rises from. */
  x: number
  y: number
  z: number
  /** The face the column shows to open space — the candidate `cycle` picked. */
  dir: WallDir
  /** Every direction **R** may choose, best-first. */
  dirs: WallDir[]
}

export function wallSnap(
  cells: readonly Cell[],
  cell: readonly [number, number, number],
  pointer: readonly [number, number] | null = null,
  cycle = 0,
): WallSnap {
  const [ax, ay, az] = cell
  const auto: WallDir | null = pointer === null ? null : wallPointerDir(pointer[0] - (ax + 0.5), pointer[1] - (ay + 0.5))
  const here = wallVoidEdges(cells, ax, ay, az)
  const pick = (dirs: WallDir[]): WallDir => dirs[((cycle % dirs.length) + dirs.length) % dirs.length]

  // Rules 1 and 2: the column stays where it is; only its face is in question.
  if (here.length > 0) {
    const dirs: WallDir[] = []
    const offer = (d: WallDir | null): void => {
      if (d !== null && here.includes(d) && !dirs.includes(d)) dirs.push(d)
    }
    offer(auto)
    for (const d of WALL_DIRS) offer(d)
    return { x: ax, y: ay, z: az, dir: pick(dirs), dirs }
  }

  // Rule 3: no edge here, so step to the nearest neighbour that has one.
  let best: { x: number; y: number; dir: WallDir; dist: number } | null = null
  for (let x = ax - 1; x <= ax + 1; x++) {
    for (let y = ay - 1; y <= ay + 1; y++) {
      if (x === ax && y === ay) continue
      const edges = wallVoidEdges(cells, x, y, az)
      if (edges.length === 0) continue
      const dist = Math.abs(x - ax) + Math.abs(y - ay)
      if (best !== null && dist >= best.dist) continue
      // Face back at the hovered cell, so the wall still points at the aim.
      // (Also independent of orientation: the neighbour's first valid edge is
      // the fallback, not a remembered rotation.)
      const back = wallPointerDir(ax - x, ay - y)
      best = { x, y, dir: edges.includes(back) ? back : edges[0], dist }
    }
  }
  if (best !== null) return { x: best.x, y: best.y, z: az, dir: best.dir, dirs: [best.dir] }
  // Nowhere nearby has an edge either (a lone buried cell): stand it on the
  // tool's own default face and let `addWalls` report the reserved opening or
  // the missing floor.
  return { x: ax, y: ay, z: az, dir: 's', dirs: ['s'] }
}

/**
 * Lay a 墙-tool run: full-height wall columns, tagged `WALL` so a later
 * right-click can lift the whole column. Like `addCells`, a reserved opening is
 * refused. Returns the same state when every course already existed.
 */
export function addWalls(
  state: StationState,
  baseCells: Array<[number, number, number]>,
): { state: StationState; changed: number; blocked: number } {
  const have = new Set(state.cells.map((c) => cellKey(c.x, c.y, c.z)))
  const added: Cell[] = []
  let blocked = 0
  for (const [x, y, z] of wallRun(baseCells)) {
    const k = cellKey(x, y, z)
    if (have.has(k)) continue
    if (reservedOpening(state.modules, x, y, z)) {
      blocked++
      continue
    }
    have.add(k)
    added.push({ x, y, z, fill: 'solid', tags: [WALL] })
  }
  if (added.length === 0) return { state, changed: 0, blocked }
  return { state: { ...state, cells: [...state.cells, ...added] }, changed: added.length, blocked }
}

/**
 * True for a cell the 墙 tool owns: a course it laid, or an auto-generated one.
 * Both are the same 4 m wall to the player, so the tool must be able to lift an
 * `AUTO_WALL` ring exactly like its own run.
 */
function isWallCell(c: Cell): boolean {
  return hasTag(c, WALL) || hasTag(c, AUTO_WALL)
}

/**
 * The whole 墙-tool column through `(x, y, z)`: the contiguous run of wall cells
 * above and below the hit, whether the pointer landed on the base, the middle or
 * the top. An auto-generated wall answers too, so the tool can open a doorway in
 * an auto-wall ring. Empty when the cell is not a wall of either kind.
 */
export function wallColumnAt(state: StationState, x: number, y: number, z: number): Array<[number, number, number]> {
  const tagged = new Set<number>()
  for (const c of state.cells) if (c.x === x && c.y === y && isWallCell(c)) tagged.add(c.z)
  if (!tagged.has(z)) return []
  let a = z
  while (tagged.has(a - 1)) a--
  let b = z
  while (tagged.has(b + 1)) b++
  const out: Array<[number, number, number]> = []
  for (let zz = a; zz <= b; zz++) out.push([x, y, zz])
  return out
}

/**
 * Every 墙-tool column through a set of cells — the right-drag's erase set. The
 * per-cell columns are de-duplicated, so a drag whose line touches the same
 * column twice never repeats a block.
 */
export function wallColumnsAt(
  state: StationState,
  cells: Array<[number, number, number]>,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  const seen = new Set<string>()
  for (const [x, y, z] of cells) {
    for (const p of wallColumnAt(state, x, y, z)) {
      const k = cellKey(p[0], p[1], p[2])
      if (seen.has(k)) continue
      seen.add(k)
      out.push(p)
    }
  }
  return out
}

/**
 * The new wall columns a 地基 drag will raise: every pending floor cell on the
 * edge of the surface (a same-level neighbour is neither solid nor part of the
 * patch). Used for the live ghost, so the room-like shell shows before release.
 * `solid` is the current station; the patch is preview-only.
 */
export function plannedAutoWalls(
  solid: ReadonlySet<string>,
  floorCells: Array<[number, number, number]>,
  modules: readonly Module[] = [],
): Array<[number, number, number]> {
  const patch = new Set(floorCells.map(([x, y, z]) => cellKey(x, y, z)))
  // The platform/tunnel footprint is covered ground even though a rail dug its
  // bed out of `solid`, so the ghost never promises a wall along the platform
  // edge — that is exactly where the screen doors are derived.
  const covered = new Set(solid)
  for (const k of trackFootprintKeys(modules)) covered.add(k)
  const doors = platformDoorKeys(modules)
  const out: Array<[number, number, number]> = []
  for (const [x, y, z] of floorCells) {
    // Already-existing floor, or a rail's dug bed the release will skip: no
    // wall rises from a cell the patch does not actually lay.
    if (covered.has(cellKey(x, y, z))) continue
    // A screen door already stands here: never raise a wall through it.
    if (doors.has(cellKey(x, y, z))) continue
    let edge = false
    for (const [dx, dy] of NEIGH4) {
      const k = cellKey(x + dx, y + dy, z)
      if (!covered.has(k) && !patch.has(k)) {
        edge = true
        break
      }
    }
    if (!edge) continue
    for (let dz = 1; dz <= AUTO_WALL_H; dz++) {
      const wk = cellKey(x, y, z + dz)
      if (!solid.has(wk) && !reservedOpening(modules, x, y, z + dz)) out.push([x, y, z + dz])
    }
  }
  return out
}

/**
 * Rebuild the automatic wall ring around every 地基 floor patch. A patch cell on
 * the outer edge of its surface earns a full-height wall column; an auto wall
 * whose cell became interior — covered by a later drag — or whose floor was dug
 * away is dropped. Hand-placed walls are never added to or removed from,
 * because only `AUTO_WALL` cells are touched.
 *
 * This is the room-union rule applied to floors: overlap or abut two patches
 * and the shared edge inside the union loses its wall while the new outer edge
 * gains one. Only the *outer* edge is walled — a hole dug through the middle of
 * a patch stays open (the void flood cannot reach it), so a stair opening is
 * not silently boarded up. A placed rail digs its bed, so the platform/tunnel
 * footprint is folded into the covered ground too: a full track sliced through
 * a patch reads as part of the surface, not as an opening to wall — otherwise
 * the flood would pour down the trench and board up every screen door along the
 * platform edge. Returns the same state when nothing changed, so a no-op stays
 * out of the undo stack.
 */
export function syncAutoWalls(state: StationState): StationState {
  const solid = new Set<string>()
  for (const c of state.cells) if (c.fill === 'solid') solid.add(cellKey(c.x, c.y, c.z))
  // A dug bed reads as void in `cells`, but it is covered ground for the merge.
  const covered = new Set(solid)
  for (const k of trackFootprintKeys(state.modules)) covered.add(k)
  // Screen-door cells stay unwalled even when they sit on the patch's edge.
  const doors = platformDoorKeys(state.modules)
  // Group the tracked floor by level: walls only answer a same-level edge.
  const byLevel = new Map<number, Array<[number, number]>>()
  for (const c of state.cells) {
    if (c.fill !== 'solid' || !hasTag(c, AUTO_FLOOR)) continue
    const arr = byLevel.get(c.z)
    if (arr) arr.push([c.x, c.y])
    else byLevel.set(c.z, [[c.x, c.y]])
  }
  const wanted = new Map<string, [number, number, number]>()
  for (const [z, cells] of byLevel) {
    const patch = new Set(cells.map(([x, y]) => `${x},${y}`))
    // Bounding box padded by one, to bound the exterior flood.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of cells) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    minX--
    minY--
    maxX++
    maxY++
    // Flood void inward from the padded border, stopping at patch, covered
    // ground (solid or a track footprint). Reached void is outside the surface;
    // an unreached pocket is an interior hole, and earns no wall.
    const seen = new Set<string>()
    const stack: Array<[number, number]> = []
    const pushVoid = (x: number, y: number): void => {
      if (x < minX || x > maxX || y < minY || y > maxY) return
      const k = `${x},${y}`
      if (seen.has(k) || patch.has(k) || covered.has(cellKey(x, y, z))) return
      seen.add(k)
      stack.push([x, y])
    }
    for (let x = minX; x <= maxX; x++) {
      pushVoid(x, minY)
      pushVoid(x, maxY)
    }
    for (let y = minY; y <= maxY; y++) {
      pushVoid(minX, y)
      pushVoid(maxX, y)
    }
    while (stack.length > 0) {
      const [x, y] = stack.pop() as [number, number]
      pushVoid(x + 1, y)
      pushVoid(x - 1, y)
      pushVoid(x, y + 1)
      pushVoid(x, y - 1)
    }
    for (const [x, y] of cells) {
      // A platform screen door stands on this cell: no auto wall may rise
      // through it, even when the cell is also on the patch's outer edge.
      if (doors.has(cellKey(x, y, z))) continue
      let edge = false
      for (const [dx, dy] of NEIGH4) {
        if (seen.has(`${x + dx},${y + dy}`)) {
          edge = true
          break
        }
      }
      if (!edge) continue
      for (let dz = 1; dz <= AUTO_WALL_H; dz++) {
        // Never board up a reserved opening: the ghost (`plannedAutoWalls`)
        // leaves the same cells unwalled, and a ramp or exit needs them open.
        if (reservedOpening(state.modules, x, y, z + dz)) continue
        wanted.set(cellKey(x, y, z + dz), [x, y, z + dz])
      }
    }
  }
  let changed = false
  const kept: Cell[] = []
  for (const c of state.cells) {
    const k = cellKey(c.x, c.y, c.z)
    if (hasTag(c, AUTO_WALL) && !wanted.has(k)) {
      changed = true
      continue
    }
    kept.push(c)
  }
  const have = new Set(kept.map((c) => cellKey(c.x, c.y, c.z)))
  for (const [k, p] of wanted) {
    if (have.has(k)) continue
    kept.push({ x: p[0], y: p[1], z: p[2], fill: 'solid', tags: [AUTO_WALL] })
    changed = true
  }
  return changed ? { ...state, cells: kept } : state
}

/**
 * Add the floor a 地基 rectangle drag drew, tag it as an auto-floor patch, and
 * rebuild the wall ring. Cells the drag covers that already exist are left
 * alone, so extending into hand-built ground is seamless. A single click (a
 * plain block) does not come through here — only a deliberate drag turns into a
 * walled surface.
 */
export function addFloor(state: StationState, cells: Array<[number, number, number]>): StationState {
  const have = new Set(state.cells.map((c) => cellKey(c.x, c.y, c.z)))
  const grown: Cell[] = []
  for (const [x, y, z] of cells) {
    const k = cellKey(x, y, z)
    if (have.has(k)) continue
    // A floor drag may not fill a reserved opening either: the same guard the
    // block brush uses, so a ramp hole stays open under a newly drawn surface.
    if (reservedOpening(state.modules, x, y, z)) continue
    // The platform/tunnel covered area is already a surface: skip a rail's dug
    // bed so the drag does not pour a block into the trench. The wall ring then
    // wraps the whole patch+track footprint (see `syncAutoWalls`).
    if (isTrackCell(state.cells, state.modules, x, y, z)) continue
    have.add(k)
    grown.push({ x, y, z, fill: 'solid', tags: [AUTO_FLOOR] })
  }
  if (grown.length === 0) return state
  return syncAutoWalls({ ...state, cells: [...state.cells, ...grown] })
}

/**
 * Remove blocks a 地基 drag marked, then rebuild the wall ring only if one of
 * them was an auto-floor cell. Removing a hand-placed block, or an auto wall
 * itself, leaves the ring alone so a wall the player deliberately dug out is
 * not silently restored.
 */
export function removeFloor(state: StationState, remove: Array<[number, number, number]>): StationState {
  const killed = new Set(remove.map(([x, y, z]) => cellKey(x, y, z)))
  const droppedFloor = state.cells.some((c) => killed.has(cellKey(c.x, c.y, c.z)) && hasTag(c, AUTO_FLOOR))
  const next = removeCells(state, remove)
  return droppedFloor ? syncAutoWalls(next) : next
}

/* ---------------- shop, toilet, office & booth (facility rooms) */

/**
 * Facility room kind built by the zone tool's rectangle drag. `shop`, `toilet`
 * and `office` are walled rooms: they share the `shop` module type and pick
 * their fit-out with `cfg.kind`. `booth` is an open desk counter with no walls.
 */
export type FacilityKind = 'shop' | 'toilet' | 'office' | 'booth'

/** The walled-room brushes, mapped to the module `cfg.kind` each one builds. */
const WALLED_ROOM: Record<'shop' | 'toilet' | 'office', RoomKind> = {
  shop: 'store',
  toilet: 'toilet',
  office: 'office',
}

/** True for a brush that builds a walled room — every facility kind but booth. */
export function isWalledRoomKind(kind: FacilityKind): kind is 'shop' | 'toilet' | 'office' {
  return kind !== 'booth'
}

/** The fit-out of a walled room, defaulting legacy shops to a store. */
function roomKindOf(m: Module): string | undefined {
  return m.type === 'shop' ? (m.cfg.kind ?? 'store') : undefined
}

/**
 * Identity a facility drag compares against. Two walled rooms merge only when
 * their `cfg.kind` matches, so a toilet drawn over a shop is a clash, not a
 * silent fit-out swap; anything of a different type (a booth, a retail shell)
 * is likewise a clash.
 */
function facilitySignature(type: string, roomKind?: string): string {
  return type === 'shop' ? `shop:${roomKind ?? 'store'}` : type
}

/** The signature a brush builds — the twin of `facilitySignature`. */
function brushSignature(kind: FacilityKind): string {
  return isWalledRoomKind(kind) ? `shop:${WALLED_ROOM[kind]}` : 'booth'
}

/** Minimum room size: walls + at least 1 m of walkable interior. */
export const FACILITY_MIN = 3

/** Wall height in blocks above the floor: a shop is a full room. */
export const SHOP_WALL_H = 3

export interface FacilityRect {
  x0: number
  y0: number
  x1: number
  y1: number
  z: number
}

/** Normalise two corners into an inclusive rect on one level. */
export function facilityRect(a: [number, number, number], b: [number, number, number], z: number): FacilityRect {
  return {
    x0: Math.min(a[0], b[0]),
    y0: Math.min(a[1], b[1]),
    x1: Math.max(a[0], b[0]),
    y1: Math.max(a[1], b[1]),
    z,
  }
}

function isPerimeter(r: FacilityRect, x: number, y: number): boolean {
  return x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1
}

/**
 * Does an existing wall already enclose this side? True when the cell just
 * outside the rect is solid AND has solid above it (a wall column, not open
 * floor). Open floor — solid with nothing above — still needs our own wall.
 */
function touchingExistingWall(solid: Set<string>, x: number, y: number, z: number): boolean {
  return solid.has(cellKey(x, y, z)) && solid.has(cellKey(x, y, z + 1))
}

function outsideOf(r: FacilityRect, x: number, y: number): [number, number] {
  if (x === r.x0) return [x - 1, y]
  if (x === r.x1) return [x + 1, y]
  if (y === r.y0) return [x, y - 1]
  return [x, y + 1]
}

/** The module's own rect on its floor level. */
export function facilityRectOf(mod: { x: number; y: number; z: number; w?: number; h?: number }): FacilityRect {
  const w = mod.w ?? 1
  const h = mod.h ?? 1
  return { x0: mod.x, y0: mod.y, x1: mod.x + w - 1, y1: mod.y + h - 1, z: mod.z }
}

/**
 * Does a drag rectangle cover the whole room? Then the right-click gesture
 * means "delete the store" rather than "cut an opening".
 */
export function facilityCovers(mod: { x: number; y: number; z: number; w?: number; h?: number }, r: FacilityRect): boolean {
  const own = facilityRectOf(mod)
  if (r.z !== own.z) return false
  return r.x0 <= own.x0 && r.y0 <= own.y0 && r.x1 >= own.x1 && r.y1 >= own.y1
}

/**
 * The facility room a cell belongs to — its floor or any of its walls — so a
 * right-click on a wall finds the store it should edit.
 */
export function facilityAt(state: StationState, x: number, y: number, z: number): Module | undefined {
  for (const m of state.modules) {
    if (m.type !== 'shop' && m.type !== 'booth' && m.type !== 'retail') continue
    const w = (m as { w?: number }).w ?? 1
    const h = (m as { h?: number }).h ?? 1
    if (x >= m.x && x < m.x + w && y >= m.y && y < m.y + h && z >= m.z && z <= m.z + SHOP_WALL_H) return m
  }
  return undefined
}

/** True when two rects share at least one cell on the same level. */
function facilityOverlap(a: FacilityRect, b: FacilityRect): boolean {
  return a.z === b.z && a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0
}

/** Facility rooms (shop / booth / retail) whose footprint overlaps `r`. */
export function facilitiesOverlapping(state: StationState, r: FacilityRect): Module[] {
  return state.modules.filter(
    (m) => (m.type === 'shop' || m.type === 'booth' || m.type === 'retail') && facilityOverlap(facilityRectOf(m), r),
  )
}

export interface FacilityPlan {
  /** The rect the room would occupy: the drawn rect merged with same-type rooms. */
  rect: FacilityRect
  /** Same-type rooms a placement would absorb (their union is extended). */
  merge: Module[]
  /** A different-type room the drag overlaps, if any. */
  blockedBy: Module | null
}

/**
 * What a facility rectangle drag would do. Overlapping a room of another type is
 * refused (`blockedBy`); overlapping rooms of the same kind (same module type
 * and, for walled rooms, the same fit-out) extend into a single room covering
 * the union, instead of stacking a second module on top.
 *
 * The union is grown repeatedly: extending two rooms can make the bounding box
 * overlap a room (or the void corner) the drag never touched, and that clash has
 * to refuse the placement rather than silently swallow it.
 */
export function facilityPlan(state: StationState, kind: FacilityKind, r: FacilityRect): FacilityPlan {
  const merge: Module[] = []
  const seen = new Set<string>()
  const want = brushSignature(kind)
  let rect = r
  for (;;) {
    const overlapping = facilitiesOverlapping(state, rect)
    const blockedBy = overlapping.find((m) => facilitySignature(m.type, roomKindOf(m)) !== want) ?? null
    if (blockedBy) return { rect, merge, blockedBy }
    let grew = false
    for (const m of overlapping) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      merge.push(m)
      const own = facilityRectOf(m)
      const grown: FacilityRect = {
        x0: Math.min(rect.x0, own.x0),
        y0: Math.min(rect.y0, own.y0),
        x1: Math.max(rect.x1, own.x1),
        y1: Math.max(rect.y1, own.y1),
        z: rect.z,
      }
      if (grown.x0 !== rect.x0 || grown.y0 !== rect.y0 || grown.x1 !== rect.x1 || grown.y1 !== rect.y1) grew = true
      rect = grown
    }
    if (!grew) break
  }
  return { rect, merge, blockedBy: null }
}

/** One furniture unit's floor cell and quarter-turn, for the room layouts below. */
export interface FurnitureSpot {
  type: 'shelf' | 'desk' | 'cubicle' | 'sink' | 'bench'
  x: number
  y: number
  /**
   * 0 = run along x, 1 = along y, 2 = along x turned 180°, 3 = along y turned
   * 180°. A wall shelf uses the turn that backs its panel onto the wall (2 for
   * the −y wall, 0 for +y, 1 for −x, 3 for +x); desks, restroom fixtures and
   * benches use their own facing.
   */
  rot: number
}

/**
 * Where a store's shelf units stand (§5.7): interior island rows inset one cell
 * from the walls with one aisle between rows, plus one unit against the inner
 * face of every straight (non-corner) wall run — including a side the room did
 * not wall itself because a pre-existing wall column already encloses it.
 * Door cells (cut openings) get no shelf. The room builder lays one `shelf`
 * module per spot, so every auto shelf is individually bulldozable.
 */
export function storeShelfSpots(
  cells: readonly Cell[],
  rect: FacilityRect,
  doors: ReadonlySet<string> = new Set(),
): FurnitureSpot[] {
  const { x0, y0, x1, y1, z } = rect
  const spots: FurnitureSpot[] = []
  for (let y = y0 + 2; y <= y1 - 2; y += 2) {
    for (let x = x0 + 1; x <= x1 - 1; x++) spots.push({ type: 'shelf', x, y, rot: 0 })
  }
  const solid = new Set<string>()
  for (const c of cells) if (c.fill === 'solid') solid.add(cellKey(c.x, c.y, c.z))
  const walled = new Set<string>()
  for (const [x, y] of facilityWallCells(cells, { x: x0, y: y0, z, w: x1 - x0 + 1, h: y1 - y0 + 1, type: 'shop' })) {
    walled.add(`${x},${y}`)
  }
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (!isPerimeter(rect, x, y)) continue
      if ((x === x0 || x === x1) && (y === y0 || y === y1)) continue
      if (doors.has(`${x},${y}`)) continue
      let run = walled.has(`${x},${y}`)
      if (!run) {
        const [ox, oy] = outsideOf(rect, x, y)
        run = touchingExistingWall(solid, ox, oy, z)
      }
      if (!run) continue
      spots.push({ type: 'shelf', x, y, rot: y === y0 ? 2 : y === y1 ? 0 : x === x0 ? 1 : 3 })
    }
  }
  return spots
}

/**
 * Where an office's desk units stand (§5.7): a grid inset one cell from the
 * walls, one aisle between rows and columns. Desks need no wall behind them,
 * so only the rect matters. The room builder lays one `desk` module per spot,
 * individually bulldozable like a shelf.
 */
export function officeDeskSpots(rect: FacilityRect): FurnitureSpot[] {
  const spots: FurnitureSpot[] = []
  for (let y = rect.y0 + 1; y <= rect.y1 - 1; y += 2) {
    for (let x = rect.x0 + 1; x <= rect.x1 - 1; x += 2) spots.push({ type: 'desk', x, y, rot: 0 })
  }
  return spots
}

/**
 * Where a restroom's units stand (§5.7): one `cubicle` (partition + WC + tank)
 * per back-row cell and one `sink` per front-row cell, both inset one cell
 * from the side walls. Door cells (cut openings) get no unit. The room builder
 * lays one module per spot, individually bulldozable like a shelf.
 */
export function restroomSpots(rect: FacilityRect, doors: ReadonlySet<string> = new Set()): FurnitureSpot[] {
  const spots: FurnitureSpot[] = []
  for (let x = rect.x0 + 1; x <= rect.x1 - 1; x++) {
    if (!doors.has(`${x},${rect.y1 - 1}`)) spots.push({ type: 'cubicle', x, y: rect.y1 - 1, rot: 0 })
    if (!doors.has(`${x},${rect.y0}`)) spots.push({ type: 'sink', x, y: rect.y0, rot: 0 })
  }
  return spots
}

/**
 * The booth's staff seats: one `bench` per back-row interior cell, facing the
 * front counter (rot 2). Mirrors the seats the booth model used to draw, so a
 * migrated booth reads exactly as before — except each seat is now its own
 * right-clickable module.
 */
export function boothBenchSpots(rect: FacilityRect): FurnitureSpot[] {
  const spots: FurnitureSpot[] = []
  if (rect.y1 - 1 <= rect.y0) return spots
  for (let x = rect.x0 + 1; x <= rect.x1 - 1; x++) spots.push({ type: 'bench', x, y: rect.y1 - 1, rot: 2 })
  return spots
}

/**
 * Lay one auto furniture module (`cfg.auto`) per spot, skipping cells that
 * already hold a shelf or desk — a hand-placed 货架/办公桌 keeps its cell, and
 * a merge never stacks two units on each other.
 */
function addAutoFurniture(state: StationState, z: number, spots: readonly FurnitureSpot[]): StationState {
  const taken = new Set<string>()
  for (const m of state.modules) {
    if ((m.type === 'shelf' || m.type === 'desk' || m.type === 'cubicle' || m.type === 'sink' || m.type === 'bench') && m.z === z) {
      taken.add(`${m.x},${m.y}`)
    }
  }
  const modules = [...state.modules]
  for (const s of spots) {
    const k = `${s.x},${s.y}`
    if (taken.has(k)) continue
    taken.add(k)
    if (s.type === 'shelf') {
      modules.push({ id: nextModuleId(modules, 'shelf'), type: 'shelf', x: s.x, y: s.y, z, rot: s.rot, cfg: { auto: true } })
    } else if (s.type === 'desk') {
      modules.push({ id: nextModuleId(modules, 'desk'), type: 'desk', x: s.x, y: s.y, z, rot: s.rot, cfg: { auto: true } })
    } else if (s.type === 'cubicle') {
      modules.push({ id: nextModuleId(modules, 'cubicle'), type: 'cubicle', x: s.x, y: s.y, z, rot: s.rot, cfg: { auto: true } })
    } else if (s.type === 'sink') {
      modules.push({ id: nextModuleId(modules, 'sink'), type: 'sink', x: s.x, y: s.y, z, rot: s.rot, cfg: { auto: true } })
    } else {
      modules.push({ id: nextModuleId(modules, 'bench'), type: 'bench', x: s.x, y: s.y, z, rot: s.rot, cfg: { auto: true } })
    }
  }
  return modules.length === state.modules.length ? state : { ...state, modules }
}

/**
 * Drop a room's auto-generated furniture (`cfg.auto`), leaving hand-placed
 * 货架/办公桌 where they stand. Used when the room itself goes away.
 */
function dropAutoFurniture(state: StationState, rect: FacilityRect): StationState {
  const kill = new Set<string>()
  for (const m of state.modules) {
    if (m.type !== 'shelf' && m.type !== 'desk' && m.type !== 'cubicle' && m.type !== 'sink' && m.type !== 'bench') continue
    if (!m.cfg.auto) continue
    if (m.z !== rect.z) continue
    if (m.x >= rect.x0 && m.x <= rect.x1 && m.y >= rect.y0 && m.y <= rect.y1) kill.add(m.id)
  }
  if (kill.size === 0) return state
  return { ...state, modules: state.modules.filter((m) => !kill.has(m.id)) }
}

/** Mark a walled room, retail shell or booth as furniture-materialised. */
function markRoomStocked(state: StationState, id: string): StationState {
  const modules = state.modules.map((m): Module => {
    if (m.id !== id) return m
    if (m.type === 'shop') return { ...m, cfg: { ...m.cfg, stocked: true } }
    if (m.type === 'retail') return { ...m, cfg: { ...m.cfg, stocked: true } }
    if (m.type === 'booth') return { ...m, cfg: { ...m.cfg, stocked: true } }
    return m
  })
  return { ...state, modules }
}

/**
 * Bring legacy rooms up to the furniture-module model: a store-kind room drawn
 * before auto shelves became individually placed pieces gets one `shelf`
 * module per layout spot, an office one `desk` per grid spot, a restroom its
 * cubicles and sinks, and a booth its staff benches. A room the player already
 * cleared of its drawn shelving (the old `cfg.bare`) just has the flag
 * consumed. Rooms that already went through this carry `cfg.stocked` and are
 * left alone, so re-running never duplicates a unit — deleting every unit
 * stays deleted across a reload.
 * Returns the same state when nothing changed.
 */
export function ensureRoomFurniture(state: StationState): StationState {
  let next = state
  let changed = false
  for (const m of state.modules) {
    if (m.type !== 'shop' && m.type !== 'retail' && m.type !== 'booth') continue
    const fitOut = m.type === 'retail' ? 'store' : m.type === 'booth' ? 'booth' : (m.cfg.kind ?? 'store')
    if ((fitOut !== 'store' && fitOut !== 'office' && fitOut !== 'toilet' && fitOut !== 'booth') || m.cfg.stocked) continue
    // The old clear-the-room flag only ever existed on stores; booths never had it.
    const bare = m.type !== 'booth' && m.cfg.bare === true
    if (bare) {
      next = markRoomStocked(next, m.id)
    } else {
      const rect = facilityRectOf(m)
      if (fitOut === 'store') {
        const doorPairs: Array<[number, number]> = m.type === 'shop' ? (m.cfg.door ?? []) : []
        const doors = new Set(doorPairs.map(([x, y]) => `${x},${y}`))
        next = addAutoFurniture(next, m.z, storeShelfSpots(next.cells, rect, doors))
      } else if (fitOut === 'office') {
        next = addAutoFurniture(next, m.z, officeDeskSpots(rect))
      } else if (fitOut === 'toilet') {
        const doorPairs: Array<[number, number]> = m.type === 'shop' ? (m.cfg.door ?? []) : []
        const doors = new Set(doorPairs.map(([x, y]) => `${x},${y}`))
        next = addAutoFurniture(next, m.z, restroomSpots(rect, doors))
      } else {
        next = addAutoFurniture(next, m.z, boothBenchSpots(rect))
      }
      next = markRoomStocked(next, m.id)
    }
    changed = true
  }
  return changed ? next : state
}

/**
 * Place a walled room (商店 / 厕所 / 办公室) or a booth, or extend a room of
 * the same kind when the drag overlaps one (a different kind is never overlapped
 * — `facilityPlan` reports the clash so the UI can explain).
 *
 * A **walled room** is a small building: full-height solid walls around its
 * floor. There is deliberately **no doorway** — the player right-clicks the wall
 * to cut an opening afterwards, so the room is exactly as sealed as they made
 * it. Walls are skipped where an existing wall column already encloses that
 * side. The brush (`kind`) picks the fit-out the renderer draws via `cfg.kind`.
 *
 * A **booth** is not a walled room at all: just a desk counter around the floor
 * (a thin model, no voxel base) enclosing a staff area the crowd is served from
 * outside. It has no opening and never gets one.
 *
 * Requires open floor under the whole rect; returns the unchanged state when
 * the rect is too small, has no floor, or overlaps another room kind.
 */
export function placeFacility(
  state: StationState,
  kind: FacilityKind,
  r: FacilityRect,
  id?: string,
): StationState {
  const plan = facilityPlan(state, kind, r)
  if (plan.blockedBy) return state
  const rect = plan.rect
  // Absorbed same-type rooms go first, so their walls are rebuilt around the
  // extended footprint instead of being left stranded inside it.
  const base = plan.merge.length > 0 ? removeFacilitySet(state, new Set(plan.merge.map((m) => m.id))) : state
  const w = rect.x1 - rect.x0 + 1
  const h = rect.y1 - rect.y0 + 1
  if (w < FACILITY_MIN || h < FACILITY_MIN) return state
  if (w * h > 400) return state
  const solid = new Set(base.cells.filter((c) => c.fill === 'solid').map((c) => cellKey(c.x, c.y, c.z)))
  // Every rect cell must already be floor.
  for (let x = rect.x0; x <= rect.x1; x++) {
    for (let y = rect.y0; y <= rect.y1; y++) {
      if (!solid.has(cellKey(x, y, rect.z))) return state
    }
  }
  // Openings inherited from a room being extended, kept only where they still
  // sit on the new perimeter; an opening that becomes interior vanishes with the
  // wall it was cut from.
  const doors = new Set<string>()
  for (const m of plan.merge) {
    if (m.type !== 'shop' && m.type !== 'booth') continue
    for (const [dx, dy] of m.cfg.door ?? []) doors.add(`${dx},${dy}`)
  }
  const add: Cell[] = []
  const keptDoors: Array<[number, number]> = []
  if (isWalledRoomKind(kind)) {
    const have = new Set(solid)
    for (let x = rect.x0; x <= rect.x1; x++) {
      for (let y = rect.y0; y <= rect.y1; y++) {
        if (!isPerimeter(rect, x, y)) continue
        if (doors.has(`${x},${y}`)) {
          keptDoors.push([x, y])
          continue
        }
        // Skip a side an existing wall column already encloses.
        const [ox, oy] = outsideOf(rect, x, y)
        if (touchingExistingWall(solid, ox, oy, rect.z)) continue
        for (let dz = 1; dz <= SHOP_WALL_H; dz++) {
          const kk = cellKey(x, y, rect.z + dz)
          if (have.has(kk)) continue
          have.add(kk)
          add.push({ x, y, z: rect.z + dz, fill: 'solid' })
        }
      }
    }
  }
  // Keep the original room's id when extending, so selection and saves follow it.
  const modId = id ?? plan.merge[0]?.id ?? nextModuleId(state.modules, kind)
  // A store stocks its own shelves as individual `shelf` modules, an office
  // its desks as `desk` modules, a restroom its cubicles and sinks, and a
  // booth its staff benches — one module per layout spot — so every unit is
  // right-clickable on its own. Absorbed rooms bring no auto furniture along
  // (their walls move); hand-placed pieces stay, and fresh units skip cells a
  // hand-placed unit already holds.
  const fitOut = isWalledRoomKind(kind) ? WALLED_ROOM[kind] : null
  const stocksShelves = fitOut === 'store'
  const stocksDesks = fitOut === 'office'
  const stocksRestroom = fitOut === 'toilet'
  const stocksBooth = kind === 'booth'
  const stocked = stocksShelves || stocksDesks || stocksRestroom || stocksBooth
  const module = (
    isWalledRoomKind(kind)
      ? {
          id: modId,
          type: 'shop',
          x: rect.x0,
          y: rect.y0,
          z: rect.z,
          w,
          h,
          cfg: { kind: WALLED_ROOM[kind], door: keptDoors, ...(stocked ? { stocked: true } : {}) },
        }
      : { id: modId, type: 'booth', x: rect.x0, y: rect.y0, z: rect.z, w, h, cfg: { kind: 'ticket', stocked: true } }
  ) as StationState['modules'][number]
  let next = { ...base, cells: [...base.cells, ...add], modules: [...base.modules, module] }
  if (stocksShelves) {
    const doorKeys = new Set(keptDoors.map(([x, y]) => `${x},${y}`))
    next = addAutoFurniture(next, rect.z, storeShelfSpots(next.cells, rect, doorKeys))
  } else if (stocksDesks) {
    next = addAutoFurniture(next, rect.z, officeDeskSpots(rect))
  } else if (stocksRestroom) {
    const doorKeys = new Set(keptDoors.map(([x, y]) => `${x},${y}`))
    next = addAutoFurniture(next, rect.z, restroomSpots(rect, doorKeys))
  } else if (stocksBooth) {
    next = addAutoFurniture(next, rect.z, boothBenchSpots(rect))
  }
  return next
}

/**
 * Every wall cell a walled room currently has — its whole wall ring. Empty for
 * a booth (its desk is a model, not voxels) or a room whose walls have all been
 * opened.
 */
export function facilityWallCells(
  cells: readonly Cell[],
  mod: { x: number; y: number; z: number; w?: number; h?: number; type: string },
): Array<[number, number, number]> {
  if (mod.type !== 'shop') return []
  const own = facilityRectOf(mod)
  const solid = new Set<string>()
  for (const c of cells) if (c.fill === 'solid') solid.add(cellKey(c.x, c.y, c.z))
  const out: Array<[number, number, number]> = []
  for (let x = own.x0; x <= own.x1; x++) {
    for (let y = own.y0; y <= own.y1; y++) {
      if (!isPerimeter(own, x, y)) continue
      for (let dz = 1; dz <= SHOP_WALL_H; dz++) {
        if (solid.has(cellKey(x, y, own.z + dz))) out.push([x, y, own.z + dz])
      }
    }
  }
  return out
}

/** Every floor cell of a facility's footprint. */
export function facilityFloorCells(mod: { x: number; y: number; z: number; w?: number; h?: number }): Array<[number, number, number]> {
  const own = facilityRectOf(mod)
  const out: Array<[number, number, number]> = []
  for (let x = own.x0; x <= own.x1; x++) for (let y = own.y0; y <= own.y1; y++) out.push([x, y, own.z])
  return out
}

/**
 * The wall cells a right-click drag would cut open. Only wall columns directly
 * above the room's perimeter floor cells the drag touches are returned, so an
 * opening is exactly where the player dragged — any run length, and any number
 * of separate openings.
 */
export function facilityOpeningCells(
  cells: readonly Cell[],
  mod: { x: number; y: number; z: number; w?: number; h?: number; type: string },
  r: FacilityRect,
): Array<[number, number, number]> {
  return facilityWallCells(cells, mod).filter(([x, y]) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)
}

/**
 * Cut the openings a right-click drag planned, and remember them on the room.
 * A walled room is a building: once its last wall is opened the room is gone, so
 * it is removed too (leaving only the floor it stood on).
 */
export function carveFacilityOpenings(
  state: StationState,
  id: string,
  cells: Array<[number, number, number]>,
): StationState {
  if (cells.length === 0) return state
  const kill = new Set(cells.map(([x, y, z]) => cellKey(x, y, z)))
  const nextCells = state.cells.filter((c) => !kill.has(cellKey(c.x, c.y, c.z)))
  if (nextCells.length === state.cells.length) return state
  const opened = new Map<string, [number, number]>()
  for (const [x, y] of cells) opened.set(`${x},${y}`, [x, y])
  const modules = state.modules.map((m) => {
    if (m.id !== id || m.type !== 'shop') return m
    const have = new Set((m.cfg.door ?? []).map(([x, y]) => `${x},${y}`))
    const door = [...(m.cfg.door ?? [])]
    for (const [k, pair] of opened) {
      if (have.has(k)) continue
      have.add(k)
      door.push(pair)
    }
    return { ...m, cfg: { ...m.cfg, door } }
  })
  const result = { ...state, cells: nextCells, modules }
  // A room with no wall left is not a room: drop it — and the auto furniture it
  // stocked, while hand-placed 货架/办公桌 stay as furniture on the remaining floor.
  const updated = modules.find((m) => m.id === id)
  if (updated && updated.type === 'shop' && facilityWallCells(nextCells, updated).length === 0) {
    const dropped = { ...result, modules: result.modules.filter((m) => m.id !== id) }
    return dropAutoFurniture(dropped, facilityRectOf(updated))
  }
  return result
}

/**
 * Remove a set of facility rooms and the auto walls only they need. A wall cell
 * a surviving walled room still needs is kept, and floors are never touched.
 * A removed room's auto-generated furniture goes with it; hand-placed 货架/办公桌 stay —
 * except on the extend path, where `placeFacility` re-stocks the union fresh
 * (absorbed rooms' units are dropped first, so a merge never stacks two units
 * on one cell).
 */
function removeFacilitySet(state: StationState, ids: ReadonlySet<string>): StationState {
  const kill = new Set<string>()
  const rooms: Array<{ x: number; y: number; z: number; w: number; h: number }> = []
  for (const m of state.modules) {
    if (!ids.has(m.id) || (m.type !== 'shop' && m.type !== 'booth')) continue
    if (m.type === 'shop') {
      for (const [x, y, z] of facilityWallCells(state.cells, m)) kill.add(cellKey(x, y, z))
    }
    rooms.push({ x: m.x, y: m.y, z: m.z, w: m.w, h: m.h })
  }
  // Never remove a wall cell a surviving walled room still needs.
  const keep = new Set<string>()
  for (const m of state.modules) {
    if (ids.has(m.id) || m.type !== 'shop') continue
    for (const [x, y, z] of facilityWallCells(state.cells, m)) keep.add(cellKey(x, y, z))
  }
  const cells = state.cells.filter((c) => {
    const k = cellKey(c.x, c.y, c.z)
    return !(kill.has(k) && !keep.has(k))
  })
  let next: StationState = { ...state, cells, modules: state.modules.filter((m) => !ids.has(m.id)) }
  for (const r of rooms) {
    next = dropAutoFurniture(next, { x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1, z: r.z })
  }
  return next
}

/**
 * Bulldoze a walled room, booth or retail shell. A walled room's auto walls —
 * the solid cells stacked above its own perimeter — are removed too, but never
 * a wall another room still needs, and never the floor. A removed room's
 * auto-generated furniture goes with it while hand-placed pieces stay behind
 * on the floor.
 */
export function removeFacility(state: StationState, id: string): StationState {
  const mod = state.modules.find((m) => m.id === id)
  if (!mod || (mod.type !== 'shop' && mod.type !== 'booth' && mod.type !== 'retail')) return state
  if (mod.type === 'shop') return removeFacilitySet(state, new Set([id]))
  const dropped: StationState = { ...state, modules: state.modules.filter((m) => m.id !== id) }
  return dropAutoFurniture(dropped, facilityRectOf(mod))
}

/**
 * Flood-fill the connected exposed region of a face's plane with a finish
 * (§4.3, the `M` 整面 tool). The region stops at unexposed faces and at the
 * plane's edge, not at a change of current finish — you are painting a floor.
 */
export function fillSurface(state: StationState, x: number, y: number, z: number, face: Face, finish: FinishId): StationState {
  const solid = new Set(state.cells.filter((c) => c.fill === 'solid').map((c) => cellKey(c.x, c.y, c.z)))
  const step = FACE_STEP[face]
  const exposed = (px: number, py: number, pz: number): boolean =>
    solid.has(cellKey(px, py, pz)) && !solid.has(cellKey(px + step[0], py + step[1], pz + step[2]))
  if (!exposed(x, y, z)) return state
  const seen = new Set<string>([cellKey(x, y, z)])
  const queue: Array<[number, number, number]> = [[x, y, z]]
  const region: Array<[number, number, number]> = []
  const plane = FACE_PLANE[face]
  while (queue.length > 0 && region.length < 20000) {
    const [cx, cy, cz] = queue.pop() as [number, number, number]
    region.push([cx, cy, cz])
    for (const [dx, dy, dz] of plane) {
      const nx = cx + dx
      const ny = cy + dy
      const nz = cz + dz
      const k = cellKey(nx, ny, nz)
      if (seen.has(k) || !exposed(nx, ny, nz)) continue
      seen.add(k)
      queue.push([nx, ny, nz])
    }
  }
  const inRegion = new Set(region.map(([rx, ry, rz]) => cellKey(rx, ry, rz)))
  let changed = false
  const cells = state.cells.map((c) => {
    if (!inRegion.has(cellKey(c.x, c.y, c.z))) return c
    if (c.finish?.[face] === finish) return c
    changed = true
    return { ...c, finish: { ...c.finish, [face]: finish } }
  })
  return changed ? { ...state, cells } : state
}

/** The finish a face currently wears — used by the eyedropper. */
export function faceFinish(cells: Cell[], x: number, y: number, z: number, face: Face): FinishId {
  const c = cells.find((cc) => cc.x === x && cc.y === y && cc.z === z)
  return c ? finishOf(c, face) : 'floor.granite'
}

/** The lab station: one 16^3 chunk with a hole and a step (§4 V1). */
export function labStation(): StationData {
  const cells: Cell[] = []
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      cells.push({ x, y, z: 0, fill: 'solid' })
      // A step: a second course on the far half.
      if (y >= 5) cells.push({ x, y, z: 1, fill: 'solid' })
    }
  }
  // A hole cut through the slab.
  for (let x = 2; x < 5; x++) for (let y = 2; y < 5; y++) cells.splice(cells.findIndex((c) => c.x === x && c.y === y && c.z === 0), 1)
  // A few modules, so the lab also shows contact shadows and the metal / enamel
  // material language against the granite.
  const modules: Module[] = [
    { id: 'lab-gate', type: 'gate', x: 0, y: 6, z: 1, cfg: { dir: 'both' } },
    { id: 'lab-gate2', type: 'gate', x: 1, y: 6, z: 1, cfg: { dir: 'both' } },
    { id: 'lab-tvm', type: 'tvm', x: 7, y: 6, z: 1, cfg: {} },
    { id: 'lab-bench', type: 'bench', x: 4, y: 6, z: 1, cfg: {} },
    { id: 'lab-exit', type: 'exit', x: 6, y: 0, z: 0, cfg: { name: 'A口', inRate: 900, open: true } },
  ]
  return {
    name: '材质试验台',
    seed: 1,
    cells,
    modules,
    lines: [],
  }
}

export function initialStation(): StationState {
  return toState(referenceStation())
}
