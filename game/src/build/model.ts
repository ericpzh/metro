// Build model helpers: the sparse cell list, the station document, and the
// commands that edit it. Pure data, no React.

import type { Cell, Module, StationData } from '../sim/types.ts'
import { referenceStation } from '../data/reference-station.ts'

export function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
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
    cells: data.cells.map((c) => ({ ...c })),
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
    cells: s.cells.map((c) => ({ ...c })),
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

/** Re-add n up-escalators from the platform to the concourse (the V4 fix). */
export function setUpEscalators(state: StationState, n: number): StationState {
  const xs = [-4, -2, 0, 2, 4]
  const modules = state.modules.filter((m) => !(m.type === 'escalator' && m.id.startsWith('esc-cp-up-')))
  for (let i = 0; i < Math.min(5, Math.max(0, n)); i++) {
    const x = xs[i]
    modules.push({
      id: `esc-cp-up-${i}`,
      type: 'escalator',
      x,
      y: -2,
      z: -8,
      from: { x, y: -2, z: -8 },
      to: { x, y: 3, z: -4 },
      cfg: { dir: 'up' },
    })
  }
  return { ...state, modules }
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
    { id: 'lab-exit', type: 'exit', x: 6, y: 0, z: 0, cfg: { name: 'A口', inRate: 600, outRate: 600, open: true } },
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
