// Elevators (无障碍电梯) — GAME-SPEC §5.1 / §7.4a.
//
// A lift is a vertical shaft, not a ramp: it spans the same `(x, y)` column and
// climbs floor intervals. One piece is a 2 × 2 m assembly (a 1.5 × 1.5 m
// carriage inside its walls) and **one story** — 超短 3 m, 短 4 m, 中 5 m (the
// default), 长 6 m or 超长 7 m (`LIFT_INTERVALS`). A story serves the **level at
// its base**: that level's landing door and the cabin's headroom live in the
// story above it, so the top of the last story is a cap, not a landing. A fresh
// 5 m piece is therefore one level (the floor it was dropped on), and stacking a
// 3 m story on top adds the level at 5 m with the cap moving to 8 m.
//
// The shaft is **exactly the stacked intervals**, from the base floor's surface
// to the top cap's surface — a 5 m piece is 5 m, no more. A cap closes each end;
// extending removes the shared middle cap and moves the two caps to the total
// shaft's ends. Only the levels draw landing portals (each inside the story above
// it); the top cap never does. A player stacks the shaft: hovering the upper half
// adds the currently armed interval above, the lower half one below, so a
// five-metre storey can carry a three-metre mezzanine or a seven-metre-deep
// platform on one car.
//
// The sim serves the whole shaft with a single car (see `World.stepLift`): every
// **level** (`liftLevels`) that is walkable floor is a stop, so the crowd rides
// straight from their floor to theirs. The piece stores each segment rise
// (`cfg.rises`) because the levels of a mixed shaft are not evenly spaced; an omitted interval list uses the five-metre default. Pure data — no three,
// no DOM.

import { rotateLocal } from './track.ts'
import { STOREY_HEIGHT } from './constants.ts'
import { msg, type MessageKey } from './i18n.ts'
import type { LiftDoorSide, Module, Vec3i } from './types.ts'

/** The default floor interval, in blocks. */
export const LIFT_STEP = 5
/** Default height of the base lift module. */
export const LIFT_RISE = 5
/** Default height added by a hover extension. */
export const LIFT_EXTEND = 5
/** The assembly's plan footprint, metres: 2 × 2, with the 1.5 m carriage inside. */
export const LIFT_SIZE = 2

/**
 * The floor intervals an elevator piece can span, in metres — the 层高 tile.
 * A piece is placed across **one** interval; stacking another on top or below
 * adds that interval's own rise, so a shaft may serve uneven floors (a 5 m
 * concourse with a 3 m mezzanine over it, or a 7 m-deep platform below).
 */
export type LiftInterval = 3 | 4 | 5 | 6 | 7

export interface LiftIntervalSpec {
  interval: LiftInterval
  /** The catalogue key the action tile names the interval with. */
  label: MessageKey
}

/** 超短 3 / 短 4 / 中 5 / 长 6 / 超长 7 m, the order the tile cycles. */
export const LIFT_INTERVALS: readonly LiftIntervalSpec[] = [
  { interval: 3, label: 'ultra_short' },
  { interval: 4, label: 'short' },
  { interval: 5, label: 'medium' },
  { interval: 6, label: 'long' },
  { interval: 7, label: 'ultra_long' },
]

/** A fresh elevator spans one five-metre storey — the new station's grid. */
export const LIFT_INTERVAL_DEFAULT: LiftInterval = 5

/** The default interval is the five-metre storey. */
export function defaultLiftInterval(): LiftInterval {
  return LIFT_INTERVAL_DEFAULT
}

/** The next interval the layer tile cycles to (超短 → 短 → 中 → 长 → 超长 → 超短). */
export function nextLiftInterval(interval: LiftInterval): LiftInterval {
  const i = LIFT_INTERVALS.findIndex((s) => s.interval === interval)
  return LIFT_INTERVALS[(i + 1) % LIFT_INTERVALS.length].interval
}

/** The name the action tile wears for an interval: 超短 / 短 / 中 / 长 / 超长. */
export function liftIntervalLabel(interval: LiftInterval | undefined): string {
  return msg((LIFT_INTERVALS.find((s) => s.interval === interval) ?? LIFT_INTERVALS[2]).label)
}

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

/** The render-side mask for a level's doors: 1 front, 2 back, 3 both, 0 sealed. */
export function liftDoorSideMask(m: LiftDoorConfig, z: number): number {
  const side = liftDoorSide(m, z)
  return side === 'both' ? 3 : side === 'back' ? 2 : side === 'none' ? 0 : 1
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
 * corner (the lower stop); it serves the floor one **interval** up — 3/4/5/6/7 m
 * from the 层高 tile, 5 m by default. `rot` only turns the cabin doors, which
 * face local −y like the rest of the equipment.
 *
 * The piece records its own segment rise (`cfg.rises`, one entry per stacked
 * interval), because a shaft may now mix them: a 5 m piece with a 3 m one stacked
 * on top has stops 5 m and 8 m apart. A single entry is the whole span, so the
 * stops always come from the piece rather than from a guessed grid.
 */
export function liftModule(base: Vec3i, rot: number, id: string, interval?: LiftInterval): LiftModule {
  const floor = interval ?? defaultLiftInterval()
  return {
    id,
    type: 'lift',
    storeyHeight: STOREY_HEIGHT,
    x: base.x,
    y: base.y,
    z: base.z,
    rot,
    from: { x: base.x, y: base.y, z: base.z },
    to: { x: base.x, y: base.y, z: base.z + floor },
    cfg: { rises: [floor] },
  }
}

/**
 * The rise of every stacked segment of a shaft, bottom → top. New pieces store
 * theirs in `cfg.rises`; an omitted list uses five-metre intervals.
 */
export function liftRises(m: LiftModule): number[] {
  const span = Math.abs(m.to.z - m.from.z)
  const stored = m.cfg.rises
  if (stored && stored.length > 0 && stored.every((r) => r > 0) && Math.abs(stored.reduce((a, b) => a + b, 0) - span) < 1e-6) {
    return [...stored]
  }
  const step = LIFT_STEP
  const out: number[] = []
  let left = span
  while (left > 1e-6) {
    const rise = Math.min(step, left)
    out.push(rise)
    left -= rise
  }
  return out
}

/**
 * Every stop's **cell z**, bottom → top: the shaft's `from` plus each stacked
 * rise. Unlike a uniform step this keeps uneven floors exact — the 5 m + 3 m
 * shaft stops at 0, 5 and 8. The graph keeps only the stop levels that are
 * actually walkable landing floor.
 */
export function liftStops(m: LiftModule): number[] {
  const lo = Math.min(m.from.z, m.to.z)
  const hi = Math.max(m.from.z, m.to.z)
  const out = [lo]
  let z = lo
  for (const rise of liftRises(m)) {
    z += rise
    if (z > hi + 1e-6) break
    out.push(z)
  }
  // The top landing is `to` by construction; guard a stored rise list that ran short.
  if (Math.abs(out[out.length - 1] - hi) > 1e-6) out.push(hi)
  return out
}

/**
 * The **levels** a shaft serves: one per stacked story, at that story's base
 * floor. The top of the last story is its cap, not a landing — so a fresh 5 m
 * piece is one level (the floor it was placed on), and stacking a 3 m story on
 * top adds the level at 5 m, with the cap moving to 8 m. Every level has its
 * story above it, which is where its landing door and the cabin's headroom live.
 * This is the list the door chooser and the graph stops read.
 */
export function liftLevels(m: LiftModule): number[] {
  const lo = Math.min(m.from.z, m.to.z)
  const rises = liftRises(m)
  const out = [lo]
  let z = lo
  for (let i = 0; i < rises.length - 1; i++) {
    z += rises[i]
    out.push(z)
  }
  return out
}

/** A copy of `m` grown one interval upward (its `to` moves up). */
export function liftExtendedUp(m: LiftModule, interval?: LiftInterval): LiftModule {
  const rise = interval ?? defaultLiftInterval()
  return { ...m, to: { x: m.to.x, y: m.to.y, z: m.to.z + rise }, cfg: { ...m.cfg, rises: [...liftRises(m), rise] } }
}

/** A copy of `m` grown one interval downward (its `from` moves down). */
export function liftExtendedDown(m: LiftModule, interval?: LiftInterval): LiftModule {
  const rise = interval ?? defaultLiftInterval()
  return { ...m, from: { x: m.from.x, y: m.from.y, z: m.from.z - rise }, cfg: { ...m.cfg, rises: [rise, ...liftRises(m)] } }
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
export function liftStopZs(fromZ: number, toZ: number, step = LIFT_STEP): number[] {
  const lo = Math.min(fromZ, toZ)
  const hi = Math.max(fromZ, toZ)
  const out: number[] = []
  for (let z = lo; z <= hi; z += step) out.push(z)
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
