// Street exit head-house (出入口) geometry — the numbers shared by the sim and
// the renderer, so the crowd and the drawing agree on where the opening is.
//
// The sim uses them to place the exit's street-opening node and to make the
// head-house solid: the crowd crosses at the opening and never through the glass
// sides or the back wall (§5.6). Pure data — no three, no DOM.

import type { Module } from './types.ts'

/** Width across the two escalator bays, metres. */
export const EXIT_W = 3.8
/**
 * Clearance the exit floor leaves open each side of a run (the runs sit at
 * local x = ±1). The floor slabs flank the two bays, so the opening must clear
 * the ramp's balustrade and handrail — ±0.60 for an escalator, ±0.705 for the
 * narrow stair exit A uses — not just the treads, or the rail surfaces through
 * the floor beside the bay. `openings.test.mjs` keeps this in step with
 * `rampCorridorHalf`.
 */
export const EXIT_BAY_HALF = 0.72
/** Length of the enclosed part: local y ∈ [−EXIT_L/2, +EXIT_L/2]. */
export const EXIT_L = 4.0
/** Canopy height above the walk, metres. */
export const EXIT_H = 3.2
/** How far the canopy reaches over the escalator run (−y), metres. */
export const EXIT_REACH = 5.6
/** Canopy overhang past the street doorway (+y), metres. */
export const EXIT_BACK = 2.3
/**
 * The street opening, in cells north of the module cell. The head-house is drawn
 * with its doorway at local +2, i.e. world y = module.y + 2.5 — the centre of the
 * cell two north of the module. That cell is the exit's graph node, so the crowd
 * walks in and out through the opening instead of teleporting under the canopy.
 */
export const EXIT_DOOR_Y = 2
/**
 * Back wall, local y. Lands on a cell boundary (world y = module.y − 5) so the
 * sim can drop the crossing row cleanly instead of sitting on a node.
 */
export const EXIT_BACK_Y = -5.5
/** Glass side planes, local x — just inside the frame. */
export const EXIT_SIDE = EXIT_W / 2 - 0.06
/** Glass sides, local y extent: the run's end up to just short of the doorway. */
export const EXIT_GLASS_Y0 = -5.5
export const EXIT_GLASS_Y1 = 1.8

export type ExitModule = Extract<Module, { type: 'exit' }>

/** A thin barrier plane of a head-house, in world space (see `station.ts`). */
export interface ExitWall {
  axis: 'x' | 'y'
  at: number
  min: number
  max: number
}

/** A quarter-turn `rot` normalised to 0..3. */
function quarter(rot: number | undefined): number {
  return (((rot ?? 0) % 4) + 4) % 4
}

/**
 * Rotate a point in the exit's local plan (x across the bays, y along the run,
 * mouth at −y, street doorway at +y) into world offsets, by the placement
 * rotation. Matches the renderer's `group.rotation.z = rot·π/2`, so the drawing
 * and the sim geometry never drift apart.
 */
function exitRotate(lx: number, ly: number, rot: number | undefined): [number, number] {
  switch (quarter(rot)) {
    case 1:
      return [-ly, lx]
    case 2:
      return [-lx, -ly]
    case 3:
      return [ly, -lx]
    default:
      return [lx, ly]
  }
}

/**
 * The plan bounds an exit head-house lays floor over: the street-side walkway
 * plus the side/centre strips flanking the two runs, from the back wall to the
 * canopy overhang past the street doorway (see `buildExit` in
 * `render/models.ts`). The rectangle is turned by the placement rotation, so a
 * rotated head-house covers the ground it actually draws on. World-space,
 * half-open: [x0,x1) × [y0,y1).
 */
export function exitFloorBounds(m: ExitModule): { x0: number; y0: number; x1: number; y1: number } {
  const cx = m.x + 0.5
  const cy = m.y + 0.5
  const rot = quarter(m.rot)
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [lx, ly] of [
    [-EXIT_W / 2, EXIT_BACK_Y],
    [EXIT_W / 2, EXIT_BACK_Y],
    [-EXIT_W / 2, EXIT_BACK],
    [EXIT_W / 2, EXIT_BACK],
  ] as Array<[number, number]>) {
    const [wx, wy] = exitRotate(lx, ly, rot)
    x0 = Math.min(x0, cx + wx)
    x1 = Math.max(x1, cx + wx)
    y0 = Math.min(y0, cy + wy)
    y1 = Math.max(y1, cy + wy)
  }
  return { x0, y0, x1, y1 }
}

/**
 * The exit's street-opening cell — the graph node the crowd walks in and out
 * through. Local +y is the doorway, so the rotation carries it round with the
 * drawn head-house.
 */
export function exitDoorCell(m: ExitModule): [number, number, number] {
  const [dx, dy] = exitRotate(0, EXIT_DOOR_Y, m.rot)
  return [m.x + dx, m.y + dy, m.z]
}

/**
 * The head-house's solid planes — the two glass sides and the back wall — turned
 * by the placement rotation. Each is a thin axis-aligned plane, which is all a
 * quarter-turn of the local planes ever produces.
 */
export function exitWallPlanes(m: ExitModule): ExitWall[] {
  const cx = m.x + 0.5
  const cy = m.y + 0.5
  const rot = quarter(m.rot)
  const walls: ExitWall[] = []
  const seg = (lx0: number, ly0: number, lx1: number, ly1: number): void => {
    const [ax, ay] = exitRotate(lx0, ly0, rot)
    const [bx, by] = exitRotate(lx1, ly1, rot)
    if (Math.abs(ax - bx) < 1e-9) {
      walls.push({ axis: 'x', at: cx + ax, min: cy + Math.min(ay, by), max: cy + Math.max(ay, by) })
    } else {
      walls.push({ axis: 'y', at: cy + ay, min: cx + Math.min(ax, bx), max: cx + Math.max(ax, bx) })
    }
  }
  for (const s of [-1, 1]) seg(s * EXIT_SIDE, EXIT_GLASS_Y0, s * EXIT_SIDE, EXIT_GLASS_Y1)
  seg(-EXIT_SIDE, EXIT_BACK_Y, EXIT_SIDE, EXIT_BACK_Y)
  return walls
}

/** True when cell `(x, y, z)` lies under an exit's floor, on the exit's level. */
export function exitCoversCell(m: ExitModule, x: number, y: number, z: number): boolean {
  if (z !== m.z) return false
  const b = exitFloorBounds(m)
  return x + 1 > b.x0 && x < b.x1 && y + 1 > b.y0 && y < b.y1
}

/** Every floor cell an exit covers on its own level, holes included. */
export function exitFootprintCells(m: ExitModule): Array<[number, number, number]> {
  const b = exitFloorBounds(m)
  const out: Array<[number, number, number]> = []
  for (let x = Math.floor(b.x0); x < b.x1; x++) {
    for (let y = Math.floor(b.y0); y < b.y1; y++) {
      out.push([x, y, m.z])
    }
  }
  return out
}

/**
 * True when cell `(x, y, z)` counts as floor because an exit covers it — even
 * when a ramp carved a hole there. Placement treats exit-covered cells as
 * solid floor, so stairs and escalators can land through an exit.
 */
export function exitFloorAt(modules: readonly Module[], x: number, y: number, z: number): boolean {
  for (const m of modules) {
    if (m.type === 'exit' && exitCoversCell(m, x, y, z)) return true
  }
  return false
}
