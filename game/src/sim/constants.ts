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
/**
 * Default clock for a station that does not override it: 06:30, the service
 * opening. A fresh load (`World.load` with no `startSeconds`) and the shipped
 * demo (`REFERENCE_BOOT` in `data/reference-station.ts`) both open here, so
 * 打开 and 示例车站 start the same crowd.
 */
export const DEFAULT_SIM_TIME = 6.5 * 3600


/** A simulated day, in simulated seconds. */
export const SIM_DAY = 24 * 3600

/**
 * The fixed storey grid, in blocks: every 4 m from +24 down to -32. One block is
 * one metre, so a storey's floor sits on one of these and its 4 m wall climbs to
 * the next one. The builder's Q/E stepping and the depth rail list exactly these
 * (`nearestLevel` snaps a raw z to the nearest). The renderer also keys every
 * cell to the storey at or below it, so two floors one storey apart never merge
 * into a single band even when a wall column connects them.
 */
export const LEVEL_STEPS: number[] = [24, 20, 16, 12, 8, 4, 0, -4, -8, -12, -16, -20, -24, -28, -32].sort((a, b) => a - b)

/** Shift the 4 m editing grid by whole metres, while keeping old saves at zero. */
export function normalizeLevelBase(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(3, Math.round(value))) : 0
}

export function levelSteps(base = 0): number[] {
  return LEVEL_STEPS.map((z) => z + normalizeLevelBase(base))
}

/**
 * The storey a cell at `z` belongs to: the fixed grid line at or below it. A
 * floor on the grid and the 4 m walls it grows share a storey; a floor one
 * storey down keeps its own, so a wall column that reaches the floor above does
 * not merge the two into a single band (the renderer keys every cell this way).
 */
export function storeyBand(z: number, base = 0): number {
  const offset = normalizeLevelBase(base)
  return Math.max(LEVEL_STEPS[0] + offset, Math.min(LEVEL_STEPS[LEVEL_STEPS.length - 1] + offset, Math.floor((z - offset) / 4) * 4 + offset))
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
/** Wider metal shoulders: glass and tread edges move inward by this amount on each side. */
export const ESCALATOR_SKIRT_INSET = 0.08
/** Flat moving step track inside each landing cell, metres. */
export const ESCALATOR_FLAT_LENGTH = 0.5
/** Horizontal length of each half of the smooth incline-to-flat bend. */
export const ESCALATOR_TRANSITION_LENGTH = 0.3
/** Casing clearance beyond its original balustrade centreline. */
export const ESCALATOR_CASING_PROUD = 0.08
/** Separate overlapping casing/terrain faces without changing the reserved footprint. */
export const ESCALATOR_SURFACE_CLEARANCE = 0.005
/** Bury the lower body's base beneath the floor rather than sharing its top face. */
export const ESCALATOR_BASE_BURY = 0.02
/** Steel infill between the handrails of adjoining ramp pieces. */
export const RAMP_JOIN_THICKNESS = 0.05
export const RAMP_JOIN_RAIL_OVERLAP = 0.02
export const RAMP_JOIN_DOME_RADIUS = 0.065
export const RAMP_JOIN_DOME_SPACING = 1.5
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

/**
 * Does a zone line block the crowd? (§4.5 — B2's fare line.)
 *
 * `true` is the authored rule: a zone boundary is a movement barrier whose only
 * crossing is a gate cell, so an ungated fare line strands the crowd. The rule is
 * a statement about **painted floor**, though, and a cell with no `zone` reads as
 * 无分区, which the fare line counts with the unpaid side (`isUnpaidZone`). So a
 * station whose paint is unfinished still grows invisible fare lines wherever a
 * painted `paid` patch sits in floor nobody has zoned — the shipped 动物园 save has
 * 7,199 of its 12,035 cells unlabelled — and those lines wall off real
 * circulation. Measured on that save: enforced, 5 of its 30
 * ramps carry nobody and its −16 platform has exactly one usable way out (a
 * single stair, 265,572 queued agent-seconds in 2400 s); ignored, every ramp
 * carries somebody, the choke moves off that stair, 11 % more people clear and
 * the peak elevator queue falls from 47 to 10.
 *
 * So the barrier is **off for now**: zones stay labels, a gate is still a queue
 * the crowd walks through — and walks around when it is long — and the fare line
 * stops being invisible enforcement. Paint the floor, then set this back to `true`,
 * or pass `true` to `buildGraph` / `new World(...)` for one station, which is how
 * `zones.test.mjs` and `gates.test.mjs` keep the rule covered.
 */
export const ZONE_LINES_BLOCK = false

/** Personal-space radius for the separation force, m. */
export const PERSONAL_SPACE = 0.8
/** Uniform-grid cell size for neighbour search, m. */
export const NEIGHBOUR_CELL = 2.0

/** Fruin level-of-service bands, m²/pax. §7.3. */
export const LOS_BANDS = [1.2, 0.9, 0.7, 0.4, 0.2] as const
export type Los = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

/**
 * The letters as the panels print them (§7.3). One map, because two readouts show a level
 * of service — the status bar's 最挤等级 and the 时刻 window's own strip — and two maps is
 * two chances for them to disagree about what D means.
 */
export const LOS_LABELS: Record<Los, string> = {
  A: '畅通',
  B: '顺畅',
  C: '有点挤',
  D: '拥挤',
  E: '很挤',
  F: '挤爆',
}

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

/**
 * What a lift costs a passenger who could have taken a stair or an escalator —
 * §7.2's `levelPenalty`, in seconds of generalised cost.
 *
 * A lift edge is *cheap* on the graph: one 40 s hop between any two floors, which
 * is what the trouble is. The moment the escalator queue passes a couple of
 * minutes, A* hands the lift the entire wave, and the one cabin a station owns is
 * asked to carry commuters it was never for — measured on the shipped 动物园
 * demo, 1001 of 2142 passengers queued at a lift, in queues 33 and 68 deep,
 * while the escalators stood beside them.
 *
 * Real passengers do not read the graph that way. The lift is signed for
 * step-free access, its doors are slow, it carries a dozen people at a time, and
 * a walker will accept a long detour to stay out of it. `LIFT_AVOID_S` is that
 * willingness: it is added to every lift edge for an agent who can manage a stair
 * or an escalator, so the lift wins only when the alternative is genuinely worse
 * by that much — it is a pressure valve at crush, not a shortcut. A passenger
 * with luggage minds it far less (`LIFT_AVOID_LUGGAGE_S`), and a **step-free**
 * passenger is charged nothing at all: the lift is the only way down they have
 * (§7.4a). Tune these two numbers, not the code.
 */
export const LIFT_AVOID_S = 300
export const LIFT_AVOID_LUGGAGE_S = 30

/**
 * Crowding in the path cost (§7.3), in seconds per body.
 *
 * `waitQ` prices a *server's* own queue, but the crowd that has not reached the
 * queue yet — the disc of bodies pressed against a gate bank, the tail of a
 * corridor — is invisible to A*. That is how a whole wave picks the same
 * turnstile and then stands in front of it, and why an agent already committed
 * has no idea the next lane along is empty.
 *
 * A path is charged `min(bodies within 2 m, CONGESTION_CAP) × CONGESTION_S`
 * seconds to enter each node, so a route through a crush costs what it feels
 * like. The cap keeps a crowd from becoming a wall: past a crush, one more body
 * is not another second of detour.
 */
export const CONGESTION_S = 1.2
export const CONGESTION_CAP = 10

/**
 * Wayfinding at the fare line (§7.2). An agent re-plans the rest of its leg the
 * moment a gate comes within `GATE_LOOKAHEAD` metres of it, rather than when it
 * is already standing in the queue: walking a few metres along the concourse
 * beats queueing behind everyone else, and a decision left to the last metre
 * cannot be taken at all — by then the passenger is inside the crush it should
 * have avoided.
 *
 * That re-plan deliberately skips the path cache, so it is a synchronous search
 * rather than an amortised one, and `GATE_REPLAN_PER_TICK` rations it. An agent
 * the ration skips still re-chooses at the gate's own cell, which is where the
 * choice used to be made every time.
 */
export const GATE_LOOKAHEAD = 8
export const GATE_REPLAN_PER_TICK = 2
/**
 * §7.2's patience trigger (`World.reRouteAroundQueue`): the same synchronous
 * search as the fare-line choice, fired when a queued passenger's wait passes
 * patience. Unrationed it runs once per impatient agent per tick, so a saturated
 * gate or lift fires hundreds of full A* searches in the same tick and every
 * tick after — the long-session cliff a refresh clears. Rationed like the gate
 * choice; an agent the ration skips keeps its place and retries next tick.
 */
export const REROUTE_REPLAN_PER_TICK = 4
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
/** Full-height screen openings are wider than the car doors they align with (§5.9). */
export const PSD_FULL_DOOR_WIDTH_SCALE = 1.5

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

/**
 * A span of the simulated day, in seconds since midnight. One shape for everything a
 * station authors *about* the day — its **operating hours** (营业时间) and its two
 * **peak windows** (高峰时段) — so a single normalizer, a single day-bar band and a single
 * `withinSpan` serve all of them (§9.6C).
 */
export interface TimeSpan {
  /** Seconds since midnight the span starts. */
  from: number
  /** Seconds since midnight it ends; `from < to`, and both inside one day. */
  to: number
}

/** The station's two peak windows, 早高峰 then 晚高峰 (§9.6C 高峰时段). */
export type PeakWindows = [TimeSpan, TimeSpan]

/**
 * 06:30–23:30: what a station that has not authored its 营业时间 opens on, and the
 * window the shipped save runs. It is deliberately **behaviour-preserving** — every hour
 * it excludes was already 夜间 service under the shoulders below — so adding the window
 * changed no crowd and §7.6's replay of an older run still holds.
 */
export const DEFAULT_SERVICE: TimeSpan = { from: 6.5 * 3600, to: 23.5 * 3600 }

/** 07:30–09:00 and 17:30–19:00: the two peaks a station starts with (§9.6C). */
export const DEFAULT_PEAKS: PeakWindows = [
  { from: 7.5 * 3600, to: 9 * 3600 },
  { from: 17.5 * 3600, to: 19 * 3600 },
]

/**
 * The thin-service shoulders of an open day, in seconds since midnight: before 06:30
 * and from 22:30 the timetable is on its 夜间 headway even though the station is open
 * (§6.5's early and late tails). These are demand-shape boundaries rather than opening
 * times — the *window* above is what the player authors — and the shipped window
 * (06:30–23:30) contains them, so the shoulders are never a shut station in disguise:
 * every hour they call thin is an hour the station is open.
 */
export const SHOULDER_OPEN = 6.5 * 3600
export const SHOULDER_CLOSE = 22.5 * 3600

/** Is `timeOfDay` inside `span`? Half-open — `[from, to)` — so an end and a start that
    meet are one instant, not two overlapping ones. */
export function withinSpan(timeOfDay: number, span: TimeSpan): boolean {
  return timeOfDay >= span.from && timeOfDay < span.to
}

/** Seconds since midnight, wrapped into one day (a negative time reads as the day before). */
export function timeOfDayOf(simTime: number): number {
  return ((simTime % SIM_DAY) + SIM_DAY) % SIM_DAY
}

/** Hard cap so a broken station cannot grow the crowd without bound. */
export const MAX_AGENTS = 6000
/** Per-tick re-path budget (PLAN.md §2.2). */
export const MAX_REPATH_PER_TICK = 8
/** Path cache entry cap. */
export const PATH_CACHE_MAX = 8192

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * The three service periods the timetable is authored against (§6.5): 高峰 /
 * 平峰 / 夜间. One name for the union, so the metrics, the clock's readout and the
 * dispatcher that picks a headway from it cannot spell it three ways.
 */
export type Period = 'peak' | 'offpeak' | 'late'

/**
 * Which period the timetable is in at `simTime`: shut outside the station's operating
 * hours, 高峰 inside a peak window, 夜间 on the shoulders, 平峰 otherwise.
 *
 * **Shut is checked first**, and on purpose: a station that opens at 08:00 is not in
 * its 高峰 for the half hour before it opens, however the peak windows are drawn.
 */
export function periodOf(simTime: number, service: TimeSpan = DEFAULT_SERVICE, peaks: PeakWindows = DEFAULT_PEAKS): Period {
  const t = timeOfDayOf(simTime)
  if (!withinSpan(t, service)) return 'late'
  for (const p of peaks) if (withinSpan(t, p)) return 'peak'
  if (t < SHOULDER_OPEN || t >= SHOULDER_CLOSE) return 'late'
  return 'offpeak'
}
/** Floor furniture clearance, including displays (GAME-SPEC §5.7). */
export const DESK_HEIGHT = 1.22
export const CHECKOUT_HEIGHT = 1.42
