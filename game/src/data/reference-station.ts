// The reference station, §7.8 "Wusi Square" — three levels, three exits, a
// gate line and a bank of escalators. Every number here is either the spec's
// reference peak or a consequence of it.
//
//   G   surface plaza      z = 0   walk at z = 1
//   B1  concourse          z = -4  walk at z = -3   (gate line at y = 12)
//   B2  platform           z = -8  walk at z = -7   (track at y = -7)
//
// The AM peak: alighting dumps ~540 people onto the platform every 150 s
// against ~225/min of escalator capacity, so the platform exit is the binding
// constraint — exactly the §7.8 conclusion, and it is bursty.

import type { Cell, LineDef, Module, StationData, Vec3i } from '../sim/types.ts'

const Z_C = -4 // concourse floor block
const Z_P = -8 // platform floor block
const Z_G = 0 // surface slab

function rect(x0: number, x1: number, y0: number, y1: number, z: number, cells: Cell[], skip?: (x: number, y: number) => boolean): void {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (skip && skip(x, y)) continue
      cells.push({ x, y, z, fill: 'solid' })
    }
  }
}

function esc(id: string, from: Vec3i, to: Vec3i, dir: 'up' | 'down'): Module {
  return { id, type: 'escalator', x: from.x, y: from.y, z: from.z, from, to, cfg: { dir } }
}

/** Gate line across the concourse at y = 12, widest available row first. */
function gateLine(n: number): number[] {
  const order = [-1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, 0, -7, 7]
  const out: number[] = []
  for (const x of order) {
    if (out.length >= n) break
    out.push(x)
  }
  return out.sort((a, b) => a - b)
}


export interface StationVariant {
  /** Number of up escalators from the platform to the concourse. Min 1, max 3. */
  upEscalators?: number
  /** Number of down escalators from the concourse to the platform. Min 1, max 3. */
  downEscalators?: number
  /** Set false for the under-built "before" station. */
  gates?: number
}

export function referenceStation(variant: StationVariant = {}): StationData {
  // The demo default is deliberately under-built on the platform exit: one up
  // escalator against ~3.6 arrivals/s. That is the station that breaks, and the
  // UI's "add an escalator" is the fix (§7.8, V4).
  const up = variant.upEscalators ?? 1
  const down = variant.downEscalators ?? 2
  const gates = variant.gates ?? 12

  const cells: Cell[] = []
  const modules: Module[] = []

  // Platform: 121 m of floor, 7 m wide, one edge adjacent to the track.
  rect(-60, 60, -6, 0, Z_P, cells)
  // Concourse: 15 x 25 m box, split by the gate line at y = 12.
  const gateXs = gateLine(gates)
  rect(-7, 7, 0, 24, Z_C, cells, (_x, y) => y === 12)
  for (const gx of gateXs) cells.push({ x: gx, y: 12, z: Z_C, fill: 'solid' })
  // Surface plaza.
  rect(-5, 5, 28, 36, Z_G, cells)

  // Track bed (a solid strip beside the platform) and the platform edge.
  rect(-70, 70, -8, -7, Z_P, cells)
  modules.push({
    id: 'edge-1',
    type: 'platform-edge',
    x: -60,
    y: -6,
    z: Z_P,
    w: 121,
    cfg: { name: '1站台', line: '2', dir: 'eastbound', side: 'left' },
  })
  modules.push({
    id: 'track-1',
    type: 'track',
    x: -70,
    y: -7,
    z: Z_P,
    w: 140,
    cfg: { line: '2', power: 'third-rail' },
  })

  // --- exits (surface, §5.6) ---------------------------------------------
  const exitDefs = [
    { id: 'exit-a', x: -4, y: 34, name: 'A口', inRate: 900, outRate: 6000 },
    { id: 'exit-b', x: 0, y: 30, name: 'B口', inRate: 900, outRate: 6000 },
    { id: 'exit-c', x: 4, y: 34, name: 'C口', inRate: 900, outRate: 6000 },
  ]
  for (const e of exitDefs) {
    modules.push({
      id: e.id,
      type: 'exit',
      x: e.x,
      y: e.y,
      z: Z_G,
      cfg: { name: e.name, inRate: e.inRate, outRate: e.outRate, open: true },
    })
  }

  // --- vertical circulation ----------------------------------------------
  const xs = [-4, -2, 0, 2, 4]
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]
    // Surface <-> concourse.
    modules.push(esc(`esc-gc-down-${i}`, { x, y: 28, z: Z_G }, { x, y: 21, z: Z_C }, 'down'))
    modules.push(esc(`esc-gc-up-${i}`, { x, y: 22, z: Z_C }, { x, y: 29, z: Z_G }, 'up'))
    // Concourse <-> platform.
    if (down > i) modules.push(esc(`esc-cp-down-${i}`, { x, y: 2, z: Z_C }, { x, y: -3, z: Z_P }, 'down'))
    if (up > i) modules.push(esc(`esc-cp-up-${i}`, { x, y: -2, z: Z_P }, { x, y: 3, z: Z_C }, 'up'))
  }

  // --- fare control -------------------------------------------------------
  for (let i = 0; i < gateXs.length; i++) {
    modules.push({ id: `gate-${i}`, type: 'gate', x: gateXs[i], y: 12, z: Z_C, cfg: { dir: 'both' } })
  }

  // --- service points (§7.4a stops) ---------------------------------------
  modules.push({ id: 'tvm-1', type: 'tvm', x: -4, y: 16, z: Z_C, cfg: {} })
  modules.push({ id: 'tvm-2', type: 'tvm', x: 4, y: 16, z: Z_C, cfg: {} })
  modules.push({ id: 'bench-1', type: 'bench', x: 0, y: 8, z: Z_C, cfg: {} })
  modules.push({ id: 'bench-2', type: 'bench', x: -8, y: -4, z: Z_P, cfg: {} })

  const lines: LineDef[] = [
    {
      id: '2',
      name: '2号线',
      colour: '#2f7ef2',
      stock: 'B',
      cars: 6,
      power: 'third-rail',
      headwayProfile: { peak: 150, offpeak: 240, late: 480 },
      dwellBase: 25,
      dwellPerPax: 0.35,
      terminus: 'through',
      direction: 'eastbound',
      stations: ['edge-1'],
    },
  ]

  return {
    name: '五四广场',
    seed: 1234567,
    levels: [
      { id: 'G', z: Z_G, kind: 'at-grade', height: 4 },
      { id: 'B1', z: Z_C, kind: 'underground', height: 4.5 },
      { id: 'B2', z: Z_P, kind: 'underground', height: 4.5 },
    ],
    cells,
    modules,
    lines,
  }
}

/** The 2x2 at-grade seed a new station starts from (§3 step 1, §4.1). */
export function emptyStation(name = '未命名车站'): StationData {
  return {
    name,
    seed: 7654321,
    levels: [{ id: 'G', z: 0, kind: 'at-grade', height: 4.5 }],
    cells: [
      { x: 0, y: 0, z: 0, fill: 'solid' },
      { x: 1, y: 0, z: 0, fill: 'solid' },
      { x: 0, y: 1, z: 0, fill: 'solid' },
      { x: 1, y: 1, z: 0, fill: 'solid' },
    ],
    modules: [],
    lines: [],
  }
}
