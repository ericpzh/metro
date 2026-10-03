// Build model helpers: the sparse cell list, the station document, and the
// commands that edit it. Pure data, no React.

import { finishOf, floorSpeed } from '../sim/finishes.ts'
import { zoneIndex } from '../sim/zones.ts'
import { carveRampOpenings } from '../sim/openings.ts'
import { reservedOpening } from '../sim/placement.ts'
import { exitFloorAt } from '../sim/exits.ts'
import { escalatorModule, type EscalatorDir } from '../sim/escalators.ts'
import { STAIR_WIDTH_NORMAL, stairFlightsFor, stairLandings, stairTurnCells } from '../sim/stairs.ts'
import { DEFAULT_ZONE, type Cell, type Face, type FinishId, type Module, type RoomKind, type StairStyle, type StationData, type Vec3i, type Zone } from '../sim/types.ts'
import { referenceStation } from '../data/reference-station.ts'

export function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

/**
 * The fixed editing storeys: every 4 units from +12 down to -32. Q/E steps
 * through these and the depth rail lists exactly these, so the work plane is
 * always on the 4-unit grid the reference station is built on (G = 0,
 * B1 = -4, B2 = -8) instead of jumping between whatever z values happen to
 * have walkable cells.
 */
export const LEVEL_STEPS: number[] = [12, 8, 4, 0, -4, -8, -12, -16, -20, -24, -28, -32].sort((a, b) => a - b)

/** Snap an arbitrary z to the nearest fixed storey. */
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
 * Build a fresh module payload for one cell. Shared by the placement tool and
 * the on-hover ghost, so the preview is the exact module the click would add.
 * `width` is the stair width and `dir` the escalator direction (each cycled with
 * Tab); other types ignore them. Returns null for a type the placement UI cannot
 * create yet.
 *
 * A stair or escalator is a fixed-length piece: its base is the cell, and it
 * climbs one storey `STAIR_RUN` cells along the placement rotation.
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
): Module | null {
  switch (type) {
    case 'gate':
      return { id, type: 'gate', x, y, z, rot, cfg: { dir: 'both' } }
    case 'tvm':
      return { id, type: 'tvm', x, y, z, rot, cfg: {} }
    case 'bench':
      return { id, type: 'bench', x, y, z, rot, cfg: {} }
    case 'exit':
      return { id, type: 'exit', x, y, z, rot, cfg: { name: '未命名口', inRate: 900, open: true } }
    case 'escalator':
      // The one shared piece: the run always climbs from the dropped cell;
      // `dir` only orders from/to, which is what the sim reads as the one-way
      // travel and the label.
      return escalatorModule({ x, y, z }, rot, dir, id)
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
        cfg: { width: width ?? STAIR_WIDTH_NORMAL, style, flights },
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
        cfg: { width: width ?? STAIR_WIDTH_NORMAL, style, flights },
      }
    }
    default:
      return null
  }
}

/**
 * Append an equipment module. A stair also lays its own half/quarter landings as
 * floor cells, so a turning flight has a walkable node between its two flights
 * (the model draws the platform and the block mesher skips it). A ramp landing
 * on an exit's floor materialises that cell too: the exit covers it even where
 * a carve left a hole, so the graph keeps the ramp's edge nodes. A ramp
 * (escalator, stair, lift) then carves the slab it climbs through; flat
 * equipment is a plain append.
 */
export function addEquipment(state: StationState, mod: Module): StationState {
  const modules = [...state.modules, mod]
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
  return {
    name: data.name,
    seed: data.seed,
    cells: data.cells.map(cloneCell),
    modules: data.modules.map((m) => ({ ...m })),
    lines: data.lines.map((l) => ({ ...l })),
  }
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

/** A free `${type}-n` id, so bulldozing then placing again never reuses one. */
export function nextModuleId(modules: readonly Module[], type: string): string {
  const taken = new Set(modules.map((m) => m.id))
  let n = modules.length + 1
  while (taken.has(`${type}-${n}`)) n++
  return `${type}-${n}`
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
 * tell a wall course from the floor it stands on.
 */
export const WALL = 'wall'

function hasTag(c: { tags?: string[] }, tag: string): boolean {
  return c.tags?.includes(tag) === true
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
 * The whole 墙-tool column through `(x, y, z)`: the contiguous run of tagged
 * cells above and below the hit, whether the pointer landed on the base, the
 * middle or the top. Empty when the cell is not a 墙-tool wall.
 */
export function wallColumnAt(state: StationState, x: number, y: number, z: number): Array<[number, number, number]> {
  const tagged = new Set<number>()
  for (const c of state.cells) if (c.x === x && c.y === y && hasTag(c, WALL)) tagged.add(c.z)
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
  const out: Array<[number, number, number]> = []
  for (const [x, y, z] of floorCells) {
    if (solid.has(cellKey(x, y, z))) continue
    let edge = false
    for (const [dx, dy] of NEIGH4) {
      const k = cellKey(x + dx, y + dy, z)
      if (!solid.has(k) && !patch.has(k)) {
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
 * not silently boarded up. Returns the same state when nothing changed, so a
 * no-op stays out of the undo stack.
 */
export function syncAutoWalls(state: StationState): StationState {
  const solid = new Set<string>()
  for (const c of state.cells) if (c.fill === 'solid') solid.add(cellKey(c.x, c.y, c.z))
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
    // Flood void inward from the padded border, stopping at patch or any solid.
    // Reached void is outside the surface; an unreached pocket is an interior
    // hole, and earns no wall.
    const seen = new Set<string>()
    const stack: Array<[number, number]> = []
    const pushVoid = (x: number, y: number): void => {
      if (x < minX || x > maxX || y < minY || y > maxY) return
      const k = `${x},${y}`
      if (seen.has(k) || patch.has(k) || solid.has(cellKey(x, y, z))) return
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
  const module = (
    isWalledRoomKind(kind)
      ? { id: modId, type: 'shop', x: rect.x0, y: rect.y0, z: rect.z, w, h, cfg: { kind: WALLED_ROOM[kind], door: keptDoors } }
      : { id: modId, type: 'booth', x: rect.x0, y: rect.y0, z: rect.z, w, h, cfg: { kind: 'ticket' } }
  ) as StationState['modules'][number]
  return { ...base, cells: [...base.cells, ...add], modules: [...base.modules, module] }
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
  // A room with no wall left is not a room: drop it.
  const updated = modules.find((m) => m.id === id)
  if (updated && updated.type === 'shop' && facilityWallCells(nextCells, updated).length === 0) {
    return { ...result, modules: result.modules.filter((m) => m.id !== id) }
  }
  return result
}

/**
 * Remove a set of facility rooms and the auto walls only they need. A wall cell
 * a surviving walled room still needs is kept, and floors are never touched.
 */
function removeFacilitySet(state: StationState, ids: ReadonlySet<string>): StationState {
  const kill = new Set<string>()
  for (const m of state.modules) {
    if (!ids.has(m.id) || m.type !== 'shop') continue
    for (const [x, y, z] of facilityWallCells(state.cells, m)) kill.add(cellKey(x, y, z))
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
  return { ...state, cells, modules: state.modules.filter((m) => !ids.has(m.id)) }
}

/**
 * Bulldoze a walled room or booth. A walled room's auto walls — the solid cells
 * stacked above its own perimeter — are removed too, but never a wall another
 * room still needs, and never the floor. A booth has no solid cells, so only the
 * module goes.
 */
export function removeFacility(state: StationState, id: string): StationState {
  const mod = state.modules.find((m) => m.id === id)
  if (!mod || (mod.type !== 'shop' && mod.type !== 'booth' && mod.type !== 'retail')) return state
  if (mod.type === 'shop') return removeFacilitySet(state, new Set([id]))
  return { ...state, modules: state.modules.filter((m) => m.id !== id) }
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
