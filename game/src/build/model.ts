// Build model helpers: the sparse cell list, the station document, and the
// commands that edit it. Pure data, no React.

import { finishOf } from '../sim/finishes.ts'
import { carveRampOpenings, rampBlocked } from '../sim/openings.ts'
import { DEFAULT_ZONE, type Cell, type Face, type FinishId, type Module, type StationData, type Zone } from '../sim/types.ts'
import { referenceStation } from '../data/reference-station.ts'

export function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
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

/** Columns the concourse → platform up-escalator bank may use. */
const CP_UP_X = [-2, 0, 2, 4, 6]

/**
 * Re-add n up-escalators from the platform to the concourse (the V4 fix). Each
 * one is dropped into a free column: `rampBlocked` refuses a column an existing
 * ramp already occupies, so the bank never stacks two ramps on top of one
 * another.
 */
export function setUpEscalators(state: StationState, n: number): StationState {
  const modules = state.modules.filter((m) => !(m.type === 'escalator' && m.id.startsWith('esc-cp-up-')))
  const want = Math.min(CP_UP_X.length, Math.max(0, n))
  let placed = 0
  for (const x of CP_UP_X) {
    if (placed >= want) break
    const candidate: Module = {
      id: `esc-cp-up-${placed}`,
      type: 'escalator',
      x,
      y: -2,
      z: -8,
      from: { x, y: -2, z: -8 },
      to: { x, y: 3, z: -4 },
      cfg: { dir: 'up' },
    }
    if (rampBlocked(modules, candidate)) continue
    modules.push(candidate)
    placed++
  }
  // A placed ramp carves the slabs it passes through, so it surfaces from an
  // opening instead of drawing through solid ground.
  const cells = state.cells.map(cloneCell)
  carveRampOpenings(cells, modules)
  return { ...state, cells, modules }
}

export function countUpEscalators(state: StationState): number {
  return state.modules.filter((m) => m.type === 'escalator' && m.id.startsWith('esc-cp-up-')).length
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
