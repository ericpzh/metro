// Elevators (无障碍电梯) — GAME-SPEC §5.1 / §7.4a.
//
// A lift is a vertical shaft, not a ramp: it spans the same `(x, y)` column and
// climbs a whole number of storeys. One piece is a 2 × 2 m assembly (a 1.5 ×
// 1.5 m carriage inside its walls) that sits on the floor it is dropped on and
// serves the floor one storey up (`LIFT_RISE` blocks, the base module). Its
// model is taller than that: it runs on up to the slab above the top landing,
// where its lid's top face is that slab's own underside — flush, so a piece
// placed on the platform (−8 m) reaches the concourse ceiling (0 m) exactly and
// never pokes through the street. A player grows the shaft a storey at a time:
// hovering the shaft's upper half adds a storey above, the lower half one below.
//
// The sim serves the whole shaft with a single car (see `World.stepLift`): every
// walkable floor between `from` and `to` is a stop, so the crowd rides straight
// from their floor to theirs. Pure data — no three, no DOM.

import { rotateLocal } from './track.ts'
import type { LiftDoorSide, Module, Vec3i } from './types.ts'

/** One storey, in blocks: a floor is four metres above the one below it. */
export const LIFT_STEP = 4
/** Blocks a freshly placed lift climbs: its base module serves the next floor up. */
export const LIFT_RISE = 4
/** Blocks a hover-extension adds: one storey. */
export const LIFT_EXTEND = 4
/** The assembly's plan footprint, metres: 2 × 2, with the 1.5 m carriage inside. */
export const LIFT_SIZE = 2

export type LiftModule = Extract<Module, { type: 'lift' }>

/** A lift's door config, as the document stores it (`cfg.doors`). */
export interface LiftDoorConfig {
  doors?: Record<string, LiftDoorSide>
}

/** A shaft position plus its door config: enough to resolve every landing cell. */
export interface LiftLandingSpec {
  x: number
  y: number
  rot?: number
  cfg?: LiftDoorConfig
}

/** The door side stored for the storey at `z`; front is the default (§5.1). */
export function liftDoorSide(m: LiftDoorConfig, z: number): LiftDoorSide {
  const side = m.doors?.[String(z)]
  return side === 'back' || side === 'both' || side === 'none' ? side : 'front'
}

/**
 * True when the storey at `z` opens onto `side` (`front` or `back`). A sealed
 * storey (`none`) serves neither face, so both answers are false.
 */
export function liftServesSide(m: LiftDoorConfig, z: number, side: 'front' | 'back'): boolean {
  const chosen = liftDoorSide(m, z)
  return chosen === 'both' || chosen === side
}

/**
 * A copy of `m` with the door side chosen for the storey at `z`. A `front`
 * choice drops the entry, and an empty map is dropped whole, so a shaft nobody
 * has reconfigured saves exactly as it did before doors could be chosen.
 */
export function liftWithDoorSide(m: LiftModule, z: number, side: LiftDoorSide): LiftModule {
  const doors = { ...(m.cfg.doors ?? {}) }
  if (side === 'front') delete doors[String(z)]
  else doors[String(z)] = side
  const cfg = { ...m.cfg }
  if (Object.keys(doors).length === 0) delete cfg.doors
  else cfg.doors = doors
  return { ...m, cfg }
}

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

/** The world direction the cabin doors look out on, for a placement rotation. */
export function liftDoorDir(rot: number | undefined): [number, number] {
  return rotateLocal(rot, 0, -1)
}

/**
 * 1 when `(x, y)` is the landing on the shaft's local −y (front) face, 2 when it
 * is on the local +y (back) face. Read from the geometry rather than from the
 * config, so the crowd's wait spot and the renderer's open doors agree with
 * whichever side a stop node actually sits on.
 */
export function liftLandingSide(m: { x: number; y: number; rot?: number }, x: number, y: number): 1 | 2 {
  const [fx, fy] = liftDoorDir(m.rot)
  const proj = (x - (m.x + LIFT_SIZE / 2)) * fx + (y - (m.y + LIFT_SIZE / 2)) * fy
  return proj >= 0 ? 1 : 2
}

/** One landing row — the two cells along a face — for a `back`/front door. */
function landingRow(m: LiftLandingSpec, back: boolean): Array<[number, number]> {
  const cx = m.x + LIFT_SIZE / 2
  const cy = m.y + LIFT_SIZE / 2
  // Local j of the landing row: one cell beyond the face at j = ∓(SIZE − 0.5).
  const front = back ? LIFT_SIZE - 0.5 : -LIFT_SIZE + 0.5
  return [-0.5, 0.5].map((i) => {
    const [ox, oy] = rotateLocal(m.rot, i, front)
    return [Math.round(cx + ox - 0.5), Math.round(cy + oy - 0.5)] as [number, number]
  })
}

/**
 * The landing rows a storey opens onto, front row first. With no `z` — or a
 * storey still on the default — this is the single front row; a `back` or
 * `both` storey adds the row on the other face, and a sealed (`none`) storey
 * opens onto no face at all, so it has no rows to board through. Callers that
 * only want the door side the crowd boards through ask the first row.
 */
export function liftLandingRows(m: LiftLandingSpec, z?: number): Array<Array<[number, number]>> {
  const side: LiftDoorSide = z === undefined ? 'front' : liftDoorSide(m.cfg ?? {}, z)
  const rows: Array<Array<[number, number]>> = []
  if (side === 'front' || side === 'both') rows.push(landingRow(m, false))
  if (side === 'back' || side === 'both') rows.push(landingRow(m, true))
  return rows
}

/**
 * The floor cells directly in front of a storey's cabin doors — the only cells a
 * passenger may board or alight through. The opening is the whole local face (2 m
 * across), so both cells along it are doorways; the graph picks the first that is
 * walkable floor. The front row is the default; a storey configured `back` or
 * `both` adds the back row. Every one of the 2 × 2 footprint cells is cabin
 * interior and is never a landing, so the crowd cannot walk in through a wall.
 * Without this a rotated lift kept boarding at its lower-left corner, which can
 * sit against the back or a side wall, and passengers strolled in through it.
 */
export function liftLandingCells(m: LiftLandingSpec, z?: number): Array<[number, number]> {
  return liftLandingRows(m, z).flat()
}
