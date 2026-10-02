// Equipment footprints and collision, GAME-SPEC §5.
//
// Everything the builder drops is a module with a real plan footprint and a
// height. Two modules may not share space: a gate cannot be dropped inside a
// ticket machine, a second TVM cannot sit on the first, and an exit head-house
// keeps its whole enclosure clear. Ramps already had their own collision
// (`rampEnvelope` / `rampBlocked` in `openings.ts`, tuned for the vertical
// corridor); this module folds them into one envelope any equipment can be
// tested against, and adds the flat, floor-standing modules.
//
// Pure data — no three, no DOM.

import { EXIT_L, EXIT_W } from './exits.ts'
import { rampEnvelope } from './openings.ts'
import type { Cell, Module } from './types.ts'

/** An axis-aligned world-space box, half-open: [x0,x1) × [y0,y1) × [z0,z1). */
export interface ModuleBox {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}

/** How tall a body of each flat module stands above its cell top, metres. */
const FLAT_HEIGHT: Record<'gate' | 'tvm' | 'bench' | 'retail' | 'shop' | 'booth' | 'platform-edge' | 'track', number> = {
  gate: 1.2,
  tvm: 1.9,
  bench: 1.0,
  retail: 3.6,
  shop: 3.6,
  booth: 2.4,
  'platform-edge': 3.1,
  track: 0.3,
}

/**
 * The plan box a flat, floor-standing module occupies. Modules anchor at their
 * cell and rise from its top (`z + 1`), matching `render/models.ts`. The exit's
 * canopy is longer than its enclosure, but the collision box is the head-house
 * proper, so an exit does not swallow the plaza on every side.
 */
function flatEnvelope(m: Module): ModuleBox | null {
  const z0 = m.z + 1
  switch (m.type) {
    case 'gate':
    case 'tvm':
    case 'bench':
      return { x0: m.x, y0: m.y, z0, x1: m.x + 1, y1: m.y + 1, z1: z0 + FLAT_HEIGHT[m.type] }
    case 'exit': {
      const rx = EXIT_W / 2
      const ry = EXIT_L / 2
      const cx = m.x + 0.5
      const cy = m.y + 0.5
      // Rotation snaps to quarter turns, so the largest axis extent bounds it.
      const half = Math.max(rx, ry)
      return { x0: cx - half, y0: cy - half, z0, x1: cx + half, y1: cy + half, z1: z0 + 3.4 }
    }
    case 'retail':
    case 'shop':
    case 'booth':
      return { x0: m.x, y0: m.y, z0, x1: m.x + m.w, y1: m.y + m.h, z1: z0 + FLAT_HEIGHT[m.type] }
    case 'platform-edge':
      // The screen sits just inside the platform edge of its run.
      return { x0: m.x, y0: m.y + 0.16, z0, x1: m.x + m.w, y1: m.y + 0.84, z1: z0 + FLAT_HEIGHT['platform-edge'] }
    case 'track':
      return { x0: m.x, y0: m.y, z0, x1: m.x + m.w, y1: m.y + 1, z1: z0 + FLAT_HEIGHT.track }
    default:
      return null
  }
}

/** The world box a module occupies — its ramp corridor or its flat body. */
export function moduleEnvelope(m: Module): ModuleBox | null {
  return rampEnvelope(m) ?? flatEnvelope(m)
}

/**
 * True when a cell's exposed top face is a rail track bed (§4.3). The track bed
 * is what sits under the rails: agents cannot walk on it (speed 0) and, by the
 * same rule, equipment must not be laid over it.
 */
export function isTrackBed(cells: readonly Cell[], x: number, y: number, z: number): boolean {
  const c = cells.find((cc) => cc.x === x && cc.y === y && cc.z === z)
  return c?.fill === 'solid' && c.finish?.top === 'floor.track'
}

/**
 * The floor cells a module stands on, at its own level. A room covers its whole
 * `w × h`; a platform-edge or track run is one cell deep along +x; every other
 * piece — gate, TVM, bench, ramp, exit — is anchored by its single cell.
 */
function baseCells(m: Module): Array<[number, number]> {
  switch (m.type) {
    case 'retail':
    case 'shop':
    case 'booth': {
      const out: Array<[number, number]> = []
      for (let x = m.x; x < m.x + m.w; x++) for (let y = m.y; y < m.y + m.h; y++) out.push([x, y])
      return out
    }
    case 'platform-edge':
    case 'track': {
      const out: Array<[number, number]> = []
      for (let x = m.x; x < m.x + m.w; x++) out.push([x, m.y])
      return out
    }
    default:
      return [[m.x, m.y]]
  }
}

/**
 * True when a candidate would stand on a rail track bed. `placementBlocked`
 * only sees other modules; the block under a track bed is solid and looks like
 * floor, so this is the surface rule that sits beside it. The builder refuses
 * these placements even though nothing else occupies the space.
 */
export function placementOnTrack(cells: readonly Cell[], candidate: Module): boolean {
  for (const [x, y] of baseCells(candidate)) {
    if (isTrackBed(cells, x, y, candidate.z)) return true
  }
  return false
}

/** Strict overlap, so modules in adjacent cells (a gate line) do not collide. */
export function boxesOverlap(a: ModuleBox, b: ModuleBox): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0
}

/**
 * True when a candidate module would share space with one already placed — the
 * rule the builder enforces before it commits a placement. A module never
 * conflicts with itself (matched by id), so re-checking is safe.
 *
 * An exit is a special case: stairs and escalators may pass through it, so an
 * exit ↔ stair/escalator overlap never blocks placement. All other pairs
 * (exit ↔ gate/TVM/…, stair ↔ stair, ramp ↔ gate, …) still collide.
 */
export function placementBlocked(modules: readonly Module[], candidate: Module): boolean {
  const c = moduleEnvelope(candidate)
  if (!c) return false
  for (const m of modules) {
    if (m === candidate || (candidate.id && m.id === candidate.id)) continue
    if (isExitRampPair(m, candidate)) continue
    const e = moduleEnvelope(m)
    if (e && boxesOverlap(c, e)) return true
  }
  return false
}

/**
 * An exit head-house may be crossed by a stair or escalator run: that pair is
 * allowed to share space. Anything else — exit vs exit, ramp vs ramp, ramp vs
 * flat equipment — still collides.
 */
function isExitRampPair(a: Module, b: Module): boolean {
  const isExit = (m: Module): boolean => m.type === 'exit'
  const isRamp = (m: Module): boolean => m.type === 'stair' || m.type === 'escalator'
  return (isExit(a) && isRamp(b)) || (isExit(b) && isRamp(a))
}

/**
 * The module standing on cell `(x, y, z)`, for right-click bulldozing. The test
 * volume is the 1 m column just above the block top, so a multi-cell module (an
 * exit, a PSD run, a ramp) is found from any of the cells it covers.
 */
export function moduleAt(modules: readonly Module[], x: number, y: number, z: number): Module | undefined {
  const cell: ModuleBox = { x0: x, y0: y, z0: z + 1, x1: x + 1, y1: y + 1, z1: z + 2 }
  for (const m of modules) {
    const e = moduleEnvelope(m)
    if (e && boxesOverlap(e, cell)) return m
  }
  return undefined
}
