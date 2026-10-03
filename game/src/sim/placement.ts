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

import { EXIT_L, EXIT_W, exitFloorAt } from './exits.ts'
import { rampEnvelope, rampOpeningAt } from './openings.ts'
import { edgeCells, trackCellAt, trackCells } from './track.ts'
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
 * The axis-aligned world box covering a list of cells from `z0` to `z1`. A
 * quarter-turn keeps a track piece axis-aligned, so the bounding box of its
 * cells is exact rather than an over-estimate.
 */
function cellsAabb(cells: ReadonlyArray<[number, number, number]>, z0: number, z1: number): ModuleBox {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of cells) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x + 1)
    y1 = Math.max(y1, y + 1)
  }
  return { x0, y0, z0, x1, y1, z1 }
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
    case 'platform-edge': {
      // The screen sits on the track-facing strip of its single-cell-deep run.
      const box = cellsAabb(edgeCells(m), z0, z0 + FLAT_HEIGHT['platform-edge'])
      return box.x1 - box.x0 <= 1.0001
        ? { ...box, x0: box.x0 + 0.16, x1: box.x1 - 0.16 }
        : { ...box, y0: box.y0 + 0.16, y1: box.y1 - 0.16 }
    }
    case 'track':
      // A dug track bed: the module owns the whole trench volume (bed slab +
      // rails) from the block top to the platform surface, so no equipment can
      // be dropped into it.
      return cellsAabb(trackCells(m), m.z, m.z + 1)
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

/** Every cell a track module's bed covers — its run × depth at its own level. */
export function trackBedCells(m: Module): Array<[number, number, number]> {
  return m.type === 'track' ? trackCells(m) : []
}

/** The track module whose bed covers `(x, y, z)`, if any. */
export function trackAt(modules: readonly Module[], x: number, y: number, z: number): Module | undefined {
  for (const m of modules) {
    if (m.type === 'track' && trackCellAt(m, x, y, z)) return m
  }
  return undefined
}

/**
 * Keys of every track-bed cell, from the finish OR a track module's bed. A
 * placed rail digs its cells (they are void, so there is no finish left to
 * read); the finish path keeps the hand-built demo working unchanged.
 */
export function trackBedKeys(cells: readonly Cell[], modules: readonly Module[]): Set<string> {
  const out = new Set<string>()
  for (const c of cells) if (c.fill === 'solid' && c.finish?.top === 'floor.track') out.add(`${c.x},${c.y},${c.z}`)
  for (const m of modules) for (const [x, y, z] of trackBedCells(m)) out.add(`${x},${y},${z}`)
  return out
}

/** True when a cell is a track bed by either rule. */
export function isTrackCell(cells: readonly Cell[], modules: readonly Module[], x: number, y: number, z: number): boolean {
  return isTrackBed(cells, x, y, z) || trackAt(modules, x, y, z) !== undefined
}

/**
 * The floor cells a module stands on, at its own level. A room covers its whole
 * `w × h`; a platform-edge or track run is one cell deep along its local +x;
 * every other piece — gate, TVM, bench, ramp, exit — is anchored by its single
 * cell.
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
      return edgeCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'track':
      return trackCells(m).map(([x, y]) => [x, y] as [number, number])
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
export function placementOnTrack(cells: readonly Cell[], candidate: Module, modules: readonly Module[] = []): boolean {
  for (const [x, y] of baseCells(candidate)) {
    if (isTrackBed(cells, x, y, candidate.z)) return true
    // A dug bed leaves no finish: the module covers the cell, and its own bed
    // base is the block just under it, so test the candidate's cell and the one
    // above (the trench).
    if (trackAt(modules, x, y, candidate.z) || trackAt(modules, x, y, candidate.z + 1)) return true
  }
  return false
}

/**
 * True when a solid block may not be built at `(x, y, z)` because it is a
 * reserved opening: the corridor a ramp carves (stair/escalator/lift) or the
 * floor an exit head-house lays over a hole. Equipment already refuses these
 * spaces through `placementBlocked` / `placementOnTrack`; the block brush needs
 * the same guard, or a hand-built cell seals a run the player can see through.
 */
export function reservedOpening(modules: readonly Module[], x: number, y: number, z: number): boolean {
  return rampOpeningAt(modules, x, y, z) || exitFloorAt(modules, x, y, z)
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
