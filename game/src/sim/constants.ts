// Sim constants — GAME-SPEC.md §10.3. Pure data, no DOM, no three, no worker.
//
// Every number the simulation consumes lives here or in stock.ts. The whole
// point of one file is that §7.8 is a calibration target, not a law: these are
// meant to be tuned.

/** Ticks per second. The worker owns 200 ms per tick (PLAN.md §2.1). */
export const TICK_HZ = 5
/** Seconds per tick, in real time. */
export const DT = 1 / TICK_HZ

/**
 * Simulated seconds advanced per tick. This is the single most important
 * tuning number in the file.
 *
 * GAME-SPEC §10.3 suggests 24 sim-hours in ~12 real minutes, which works out to
 * 24 simulated seconds per 200 ms tick. That is incompatible with the same
 * spec's 5 Hz continuous crowd: 24 s of walking is 32 m, and a crowd that
 * teleports 32 m per tick cannot be separated, queued or watched. PLAN §2.1's
 * own benchmark steps agents at the 0.2 s tick and measures 3,000 of them at
 * crush density, so the crowd's time base is the tick, not the day.
 *
 * We keep the crowd honest and run the clock fast instead: 1 simulated second
 * per tick means 1x = 5x wall-clock, a weekday AM peak is ~18 real minutes, and
 * a train every 150 sim-seconds arrives every 30 real seconds. Fast-forward
 * multiplies ticks per second, never the step, so §7.6 determinism is untouched.
 */
export const SIM_SECONDS_PER_TICK = 1.0
/** Simulated seconds per real second, at 1x. */
export const SIM_RATE = SIM_SECONDS_PER_TICK / DT
/** Real seconds that make up one simulated hour (720 s, i.e. 12 sim-min real). */
export const SECONDS_PER_SIM_HOUR = 3600 / SIM_RATE


/** A simulated day, in simulated seconds. */
export const SIM_DAY = 24 * 3600

/** Free-flow walking speed, m/s. */
export const WALK_SPEED = 1.34
/** Walking speed on stair treads, m/s (derated from free flow). */
export const STAIR_SPEED = 1.0
/** Escalator running speed, m/s. */
export const ESCALATOR_SPEED = 0.75
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
/** Ticket vending machine, tickets/s (1.5/min). */
export const TVM_RATE = 1.5 / 60
/** Escalator throughput, pax/s (75/min). Direction-locked. */
export const ESCALATOR_RATE = 75 / 60
/** Stair, pax/s per metre of width. 25 up / 33 down per minute. */
export const STAIR_RATE_UP = 25 / 60
export const STAIR_RATE_DOWN = 33 / 60
/** Lift: 15 pax per 40 s cycle. */
export const LIFT_BATCH = 15
export const LIFT_CYCLE = 40
/** Train door, pax/s at a 1.4 m door, derated by crowding. */
export const DOOR_RATE = 1.2
/** Dwell, seconds: base + per-pax, clamped. */
export const DWELL_BASE = 25
export const DWELL_PER_PAX = 0.35
export const DWELL_MIN = 20
export const DWELL_MAX = 90
/** Boarding stops this many seconds before departure. */
export const BOARDING_CUTOFF = 3
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
