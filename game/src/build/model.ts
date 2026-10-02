// Build model helpers: the sparse cell list, the station document, and the
// commands that edit it. Pure data, no React.

import { finishOf, floorSpeed } from '../sim/finishes.ts'
import { zoneIndex } from '../sim/zones.ts'
import { carveRampOpenings } from '../sim/openings.ts'
import { exitFloorAt } from '../sim/exits.ts'
import { escalatorModule, type EscalatorDir } from '../sim/escalators.ts'
import { STAIR_WIDTH_NORMAL, stairFlightsFor, stairLandings, stairTurnCells } from '../sim/stairs.ts'
import { DEFAULT_ZONE, type Cell, type Face, type FinishId, type LevelDef, type Module, type StairStyle, type StationData, type Vec3i, type Zone } from '../sim/types.ts'
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
 * on a concourse or platform slab. Falls back to 0 for a doc with no at-grade
 * level.
 */
export function groundLevelZ(levels: readonly LevelDef[]): number {
  return levels.find((l) => l.kind === 'at-grade')?.z ?? 0
}

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
  levels: StationData['levels']
  cells: Cell[]
  modules: Module[]
  lines: StationData['lines']
}

export function toState(data: StationData): StationState {
  return {
    name: data.name,
    seed: data.seed,
    levels: data.levels.map((l) => ({ ...l })),
    cells: data.cells.map(cloneCell),
    modules: data.modules.map((m) => ({ ...m })),
    lines: data.lines.map((l) => ({ ...l })),
  }
}

export function toData(s: StationState): StationData {
  return { name: s.name, seed: s.seed, levels: s.levels, cells: s.cells, modules: s.modules, lines: s.lines }
}

export function cloneState(s: StationState): StationState {
  return {
    name: s.name,
    seed: s.seed,
    levels: s.levels.map((l) => ({ ...l })),
    cells: s.cells.map(cloneCell),
    modules: s.modules.map((m) => JSON.parse(JSON.stringify(m)) as Module),
    lines: s.lines.map((l) => JSON.parse(JSON.stringify(l))),
  }
}

/** Add solid cells, ignoring ones that are already solid. */
export function addCells(cells: Cell[], add: Array<[number, number, number]>): { cells: Cell[]; changed: number } {
  const have = new Set(cells.map((c) => cellKey(c.x, c.y, c.z)))
  const out = cells.slice()
  let changed = 0
  for (const [x, y, z] of add) {
    const k = cellKey(x, y, z)
    if (have.has(k)) continue
    have.add(k)
    out.push({ x, y, z, fill: 'solid' })
    changed++
  }
  return { cells: out, changed }
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
export function zoneMapFloors(cells: readonly Cell[]): Cell[] {
  const solid = new Set<string>()
  for (const c of cells) if (c.fill === 'solid') solid.add(cellKey(c.x, c.y, c.z))
  return cells.filter(
    (c) =>
      c.fill === 'solid' &&
      !solid.has(cellKey(c.x, c.y, c.z + 1)) &&
      (floorSpeed(c) > 0 || (finishOf(c, 'top') === 'floor.track' && !solid.has(cellKey(c.x, c.y, c.z - 1)))),
  )
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

/* --------------------------------- shop & booth zones (facility rooms) */

/** Facility room kind built by the zone tool's rectangle drag. */
export type FacilityKind = 'shop' | 'booth'

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
 * refused (`blockedBy`); overlapping rooms of the same type extends them into a
 * single room covering the union, instead of stacking a second module on top.
 *
 * The union is grown repeatedly: extending two rooms can make the bounding box
 * overlap a room (or the void corner) the drag never touched, and that clash has
 * to refuse the placement rather than silently swallow it.
 */
export function facilityPlan(state: StationState, kind: FacilityKind, r: FacilityRect): FacilityPlan {
  const merge: Module[] = []
  const seen = new Set<string>()
  let rect = r
  for (;;) {
    const overlapping = facilitiesOverlapping(state, rect)
    const blockedBy = overlapping.find((m) => m.type !== kind) ?? null
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
 * Place a shop / booth room, or extend a room of the same type when the drag
 * overlaps one (a different type is never overlapped — `facilityPlan` reports
 * the clash so the UI can explain).
 *
 * A **shop** is a small building: full-height solid walls around its floor.
 * There is deliberately **no doorway** — the player right-clicks the wall to
 * cut an opening afterwards, so the room is exactly as sealed as they made it.
 * Walls are skipped where an existing wall column already encloses that side.
 *
 * A **booth** is not a walled room at all: just a desk counter around the floor
 * (a thin model, no voxel base) enclosing a staff area the crowd is served from
 * outside. It has no opening and never gets one.
 *
 * Requires open floor under the whole rect; returns the unchanged state when
 * the rect is too small, has no floor, or overlaps another room type.
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
  if (kind === 'shop') {
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
    kind === 'shop'
      ? { id: modId, type: 'shop', x: rect.x0, y: rect.y0, z: rect.z, w, h, cfg: { kind: 'store', door: keptDoors } }
      : { id: modId, type: 'booth', x: rect.x0, y: rect.y0, z: rect.z, w, h, cfg: { kind: 'ticket' } }
  ) as StationState['modules'][number]
  return { ...base, cells: [...base.cells, ...add], modules: [...base.modules, module] }
}

/**
 * Every wall cell a shop currently has — its whole wall ring. Empty for a
 * booth (its desk is a model, not voxels) or a shop whose walls have all been
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
 * A shop is a building: once its last wall is opened there is no store left, so
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
  // A store with no wall left is not a store: drop it.
  const updated = modules.find((m) => m.id === id)
  if (updated && updated.type === 'shop' && facilityWallCells(nextCells, updated).length === 0) {
    return { ...result, modules: result.modules.filter((m) => m.id !== id) }
  }
  return result
}

/**
 * Remove a set of facility rooms and the auto walls only they need. A wall cell
 * a surviving shop still needs is kept, and floors are never touched.
 */
function removeFacilitySet(state: StationState, ids: ReadonlySet<string>): StationState {
  const kill = new Set<string>()
  for (const m of state.modules) {
    if (!ids.has(m.id) || m.type !== 'shop') continue
    for (const [x, y, z] of facilityWallCells(state.cells, m)) kill.add(cellKey(x, y, z))
  }
  // Never remove a wall cell a surviving shop still needs.
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
 * Bulldoze a shop / booth. A shop's auto walls — the solid cells stacked above
 * its own perimeter — are removed too, but never a wall another room still
 * needs, and never the floor. A booth has no solid cells, so only the module
 * goes.
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
    levels: [{ id: 'G', z: 0, kind: 'at-grade', height: 4 }],
    cells,
    modules,
    lines: [],
  }
}

export function initialStation(): StationState {
  return toState(referenceStation())
}
