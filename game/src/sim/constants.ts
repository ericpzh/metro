// Sim constants — GAME-SPEC.md §10.3. Pure data, no DOM, no three, no worker.
//
// Every number the simulation consumes lives here or in stock.ts. The whole
// point of one file is that §7.8 is a calibration target, not a law: these are
// meant to be tuned.

/**
 * Simulated seconds advanced per tick. This is the single most important
 * tuning number in the file.
 *
 * GAME-SPEC §10.3 suggests 24 sim-hours in ~12 real minutes, which works out to
 * tens of simulated seconds per tick. That is incompatible with the same spec's
 * continuous crowd: a crowd that teleports tens of metres per tick cannot be
 * separated, queued or watched. PLAN §2.1's own benchmark steps agents at the
 * 0.2 s tick and measures 3,000 of them at crush density, so the crowd's time
 * base is the tick, not the day.
 *
 * We keep the crowd honest and run the clock fast instead: one tick steps a
 * human-scale amount (1 s of walking is 1.34 m), and 1x runs one tick per real
 * second, so a simulated second is a real second and the crowd walks at true
 * speed. Fast-forward multiplies ticks per second (see BASE_TICK_MS), never the
 * step, so §7.6 determinism is untouched.
 */
export const SIM_SECONDS_PER_TICK = 1.0
/** Real milliseconds per tick at 1x: one simulated second per real second. */
export const BASE_TICK_MS = SIM_SECONDS_PER_TICK * 1000
/** Simulated seconds per real second, at 1x. */
export const SIM_RATE = 1000 / BASE_TICK_MS
/** Real seconds that make up one simulated hour (3600 s = one real hour at 1x). */
export const SECONDS_PER_SIM_HOUR = 3600 / SIM_RATE


/** A simulated day, in simulated seconds. */
export const SIM_DAY = 24 * 3600

/**
 * The fixed storey grid, in blocks: every 4 m from +12 down to -32. One block is
 * one metre, so a storey's floor sits on one of these and its 4 m wall climbs to
 * the next one. The builder's Q/E stepping and the depth rail list exactly these
 * (`nearestLevel` snaps a raw z to the nearest). The renderer also keys every
 * cell to the storey at or below it, so two floors one storey apart never merge
 * into a single band even when a wall column connects them.
 */
export const LEVEL_STEPS: number[] = [12, 8, 4, 0, -4, -8, -12, -16, -20, -24, -28, -32].sort((a, b) => a - b)

/**
 * The storey a cell at `z` belongs to: the fixed grid line at or below it. A
 * floor on the grid and the 4 m walls it grows share a storey; a floor one
 * storey down keeps its own, so a wall column that reaches the floor above does
 * not merge the two into a single band (the renderer keys every cell this way).
 */
export function storeyBand(z: number): number {
  let lo = LEVEL_STEPS[0]
  for (const f of LEVEL_STEPS) if (f <= z) lo = f
  return lo
}

/**
 * Escalator width, metres (§5.1). `ESCALATOR_BALUSTRADE` is the spacing between
 * the two balustrades and `ESCALATOR_BAND` the clear step band between them —
 * the spacing less the 0.07 skirt each side. Everything the run sweeps,
 * handrails included, stays inside one 1 m cell: the handrail's outer face is at
 * 0.49, so a run reserves exactly the tile it stands in and a second run — or a
 * wall, a fence, a gate — may be built right up against it. That is what lets a
 * bank of escalators and stairs stand flush, each with its own balustrade,
 * instead of needing a shared one.
 *
 * Shared by the procedural model and the collision envelope, so the drawn
 * escalator and the space it reserves can never disagree, and shared with
 * `STAIR_WIDTH_NARROW`: a narrow stair is built to exactly the escalator band,
 * so an escalator and a stair are the same width in the same bay.
 */
export const ESCALATOR_BALUSTRADE = 0.82
export const ESCALATOR_BAND = 0.68
/** An escalator's handrail stands this far proud of its step band, metres. */
export const ESCALATOR_RAIL_PROUD = 0.15
/** A stair handrail runs this far proud of the tread edge, metres. */
export const STAIR_RAIL_PROUD = 0.105

/**
 * How thick a **半墙** (half-block wall) is, metres: half a block, so the panel
 * hugs one edge of its cell and leaves the other half of the tile usable for a
 * shelf or a bench. One number for the piece the player lays, the walled facility
 * room's own walls and the panel a ramp keeps beside a wide run
 * (`render/chunkMesher.ts`, `render/models.ts`), so a 半墙 and a room wall are the
 * same wall wherever they meet.
 */
export const HALF_WALL_T = 0.5

/** Free-flow walking speed, m/s. */
export const WALK_SPEED = 1.34/** Walking speed on stair treads, m/s (derated from free flow). */
export const STAIR_SPEED = 1.0
/** Escalator running speed, m/s. 0.5 is the heavy-duty setting used in crowds. */
export const ESCALATOR_SPEED = 0.5
/** Escalator step pitch, m. One passenger per step is the capacity model. */
export const ESCALATOR_STEP_PITCH = 0.4
/** Extra speed an agent gains riding an escalator (carried). */
export const ESCALATOR_BOOST = 1.08

/** Personal-space radius for the separation force, m. */
export const PERSONAL_SPACE = 0.8
/** Uniform-grid cell size for neighbour search, m. */
export const NEIGHBOUR_CELL = 2.0

/** Fruin level-of-service bands, m²/pax. §7.3. */
export const LOS_BANDS = [1.2, 0.9, 0.7, 0.4, 0.2] as const
export type Los = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

/** Density speed derate, §10.3: 1.0 at ≥1.2 m²/pax, ~0.35 at crush. */
export function densityDerate(m2PerPax: number): number {
  return clamp(0.35 + (0.65 * (m2PerPax - 0.2)) / 1.0, 0.35, 1.0)
}

export function losOf(m2PerPax: number): Los {
  if (m2PerPax >= LOS_BANDS[0]) return 'A'
  if (m2PerPax >= LOS_BANDS[1]) return 'B'
  if (m2PerPax >= LOS_BANDS[2]) return 'C'
  if (m2PerPax >= LOS_BANDS[3]) return 'D'
  if (m2PerPax >= LOS_BANDS[4]) return 'E'
  return 'F'
}

/** Gate throughput, pax/s (25/min). */
export const GATE_RATE = 25 / 60
export const GATE_ACCESSIBLE_RATE = 18 / 60
/**
 * A waiting passenger is held at least this far (metres) from a gate's node.
 * The node is the middle of the 1 m gate cell, so anything above 0.5 keeps the
 * queue outside the turnstile footprint even under the collision press; 0.62
 * also clears the leaf, which reaches ~0.29 m into the lane.
 */
export const GATE_CLEAR_RADIUS = 0.62
/** Ticket vending machine, tickets/s (1.5/min). */
export const TVM_RATE = 1.5 / 60
/**
 * Escalator throughput, pax/s. An escalator is single-direction and carries one
 * passenger per step, so its throughput is speed / pitch (75/min at 0.5 m/s and
 * a 0.4 m step). Riding `dist` at that speed leaves exactly `dist / pitch`
 * passengers on the unit — its fixed capacity, one per step.
 */
export const ESCALATOR_RATE = ESCALATOR_SPEED / ESCALATOR_STEP_PITCH
/** Stair, pax/s per metre of width. 25 up / 33 down per minute. */
export const STAIR_RATE_UP = 25 / 60
export const STAIR_RATE_DOWN = 33 / 60
/** Lift: 15 pax per 40 s cycle. */
export const LIFT_BATCH = 15
export const LIFT_CYCLE = 40
/**
 * Elevator car choreography, in simulated seconds. The car is a real, moving
 * cabin: it opens its doors, lets the crowd walk in and out, closes them, then
 * travels to the called floor. `LIFT_BATCH`/`LIFT_CYCLE` stay the capacity the
 * path cost estimates with; these numbers only time the visible motion.
 */
export const LIFT_DOOR_S = 2
export const LIFT_DWELL_S = 6
/** How fast the cabin travels, m/s. */
export const LIFT_SPEED = 1.5
/** Seconds a passenger takes to step into or out of the cabin. */
export const LIFT_BOARD_S = 0.6
/** Train door, pax/s at a 1.4 m door, derated by crowding. */
export const DOOR_RATE = 1.2

/**
 * Platform screen door (屏蔽门) heights above the platform, metres (§5.9). A
 * full-height screen fills the storey; a half-height (半高) screen stops at
 * chest height. Shared by the collision envelope and the procedural model, so
 * the two can never disagree.
 */
export const PSD_FULL_HEIGHT = 3.1
export const PSD_HALF_HEIGHT = 1.5

/**
 * Train stop choreography, in simulated seconds. A stop is a fixed sequence
 * rather than a demand-scaled dwell:
 *
 *   approach ─ berth ─ opening ─ dwell ─ closing ─ hold ─ depart
 *      6 s      2 s      2 s      30 s     2 s      5 s     6 s
 *
 * The consist runs in, waits `TRAIN_BERTH_HOLD` at the mark with the doors
 * shut, opens them over `TRAIN_DOOR_TRAVEL`, stands with the doors fully open
 * for `TRAIN_DWELL`, shuts them over `TRAIN_DOOR_TRAVEL`, waits
 * `TRAIN_DEPART_HOLD`, then runs out over `TRAIN_DEPART_S`.
 *
 * Boarding is served while the doors are commanded open (opening + dwell); when
 * the doors begin to close the door queues are abandoned and counted left
 * behind. The leaf travel is rendered, so a 2 s `TRAIN_DOOR_TRAVEL` is the
 * longest a set of doors is ever seen to move.
 */
export const TRAIN_APPROACH_S = 6
export const TRAIN_BERTH_HOLD = 2
export const TRAIN_DOOR_TRAVEL = 2
export const TRAIN_DWELL = 30
export const TRAIN_DEPART_HOLD = 5
export const TRAIN_DEPART_S = 6
/** Agent patience before re-route, seconds. */
export const PATIENCE_MIN = 60
export const PATIENCE_MAX = 180
/** Queue lane geometry (§5.5): slot spacing and shuffle speed. */
export const LANE_SLOT = 0.8
export const LANE_SPEED = 0.6
export const LANE_RATE = 45 / 60

/** Default peak windows in simulated seconds since midnight (§9.6C). */
export const PEAK_WINDOWS: Array<[number, number]> = [
  [7.5 * 3600, 9 * 3600],
  [17.5 * 3600, 19 * 3600],
]
/** Service window 05:30–24:00. */
export const SERVICE_OPEN = 5.5 * 3600
export const SERVICE_CLOSE = 24 * 3600

/** Hard cap so a broken station cannot grow the crowd without bound. */
export const MAX_AGENTS = 6000
/** Per-tick re-path budget (PLAN.md §2.2). */
export const MAX_REPATH_PER_TICK = 8
/** Path cache entry cap. */
export const PATH_CACHE_MAX = 8192

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function periodOf(simTime: number): 'peak' | 'offpeak' | 'late' {
  const t = ((simTime % SIM_DAY) + SIM_DAY) % SIM_DAY
  if (t < SERVICE_OPEN || t >= SERVICE_CLOSE) return 'late'
  for (const [a, b] of PEAK_WINDOWS) if (t >= a && t < b) return 'peak'
  if (t < 6.5 * 3600 || t >= 22.5 * 3600) return 'late'
  return 'offpeak'
}
