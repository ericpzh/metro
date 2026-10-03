// Elevators (无障碍电梯) — GAME-SPEC §5.1 / §7.4a.
//
// A lift is a vertical shaft, not a ramp: it spans the same `(x, y)` column and
// climbs a whole number of storeys. One piece is a 2 × 2 m assembly (a 1.5 ×
// 1.5 m carriage inside its walls) that sits on the floor it is dropped on and
// serves the floor one storey up (`LIFT_RISE` blocks, the base module). Its
// model is taller than that: it runs on up to the slab above the top landing, so
// a piece placed on the platform (−8 m) tops out at the concourse ceiling (0 m)
// without poking through the street. A player grows the shaft a storey at a
// time: hovering the shaft's upper half adds a storey above, the lower half one
// below.
//
// The sim serves the whole shaft with a single car (see `World.stepLift`): every
// walkable floor between `from` and `to` is a stop, so the crowd rides straight
// from their floor to theirs. Pure data — no three, no DOM.

import type { Module, Vec3i } from './types.ts'

/** One storey, in blocks: a floor is four metres above the one below it. */
export const LIFT_STEP = 4
/** Blocks a freshly placed lift climbs: its base module serves the next floor up. */
export const LIFT_RISE = 4
/** Blocks a hover-extension adds: one storey. */
export const LIFT_EXTEND = 4
/** The assembly's plan footprint, metres: 2 × 2, with the 1.5 m carriage inside. */
export const LIFT_SIZE = 2

export type LiftModule = Extract<Module, { type: 'lift' }>

/**
 * The one lift piece. `base` is the floor cell at the assembly's lower-left
 * corner (the lower stop); it serves the floor one storey up. `rot` only turns
 * the cabin doors, which face local −y like the rest of the equipment.
 */
export function liftModule(base: Vec3i, rot: number, id: string): LiftModule {
  return {
    id,
    type: 'lift',
    x: base.x,
    y: base.y,
    z: base.z,
    rot,
    from: { x: base.x, y: base.y, z: base.z },
    to: { x: base.x, y: base.y, z: base.z + LIFT_RISE },
    cfg: {},
  }
}

/** A copy of `m` grown one storey upward (its `to` moves up). */
export function liftExtendedUp(m: LiftModule): LiftModule {
  return { ...m, to: { x: m.to.x, y: m.to.y, z: m.to.z + LIFT_EXTEND } }
}

/** A copy of `m` grown one storey downward (its `from` moves down). */
export function liftExtendedDown(m: LiftModule): LiftModule {
  return { ...m, from: { x: m.from.x, y: m.from.y, z: m.from.z - LIFT_EXTEND } }
}

/** The four floor cells the 2 × 2 assembly stands on, at its own level. */
export function liftFootprintCells(m: { x: number; y: number }): Array<[number, number]> {
  return [
    [m.x, m.y],
    [m.x + 1, m.y],
    [m.x, m.y + 1],
    [m.x + 1, m.y + 1],
  ]
}

/**
 * Every cell z the shaft could stop at, bottom → top, on the storey grid. The
 * graph keeps only the ones that are actually walkable floor nodes.
 */
export function liftStopZs(fromZ: number, toZ: number): number[] {
  const lo = Math.min(fromZ, toZ)
  const hi = Math.max(fromZ, toZ)
  const out: number[] = []
  for (let z = lo; z <= hi; z += LIFT_STEP) out.push(z)
  return out
}
