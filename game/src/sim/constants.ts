import { msg } from './i18n.ts'
import { trainContactWireZ } from './stock.ts'
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
 * Maximum footprint one multi-cell placement drag may preview or commit at
 * once. The budget is shared by every drag that places several cells or
 * modules: 方块 patches (generated auto-wall courses included), 墙 runs, 围栏 and
 * 盲道 lines, roof/outdoor/stair tiles and road segments. A drag that would need
 * more is refused whole — every cell drawn red, the release lays nothing —
 * rather than silently clipped.
 */
export const MAX_DRAG_CELLS = 10000

/** The original name for the 方块-specific end of the shared drag budget. */
export const MAX_BLOCK_DRAG_CELLS = MAX_DRAG_CELLS

/** The only supported station storey grid, in metres. */
export const STOREY_HEIGHT = 5
export const LEVEL_STEPS: number[] = Array.from({length:15},(_,i)=>(i-8)*STOREY_HEIGHT)
export function normalizeLevelBase(value: unknown, _height = STOREY_HEIGHT): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0,Math.min(STOREY_HEIGHT-1,Math.round(value))) : 0
}
export function levelSteps(base = 0, _height = STOREY_HEIGHT): number[] {
  return Array.from({length:15},(_,i)=>(i-8)*STOREY_HEIGHT+normalizeLevelBase(base))
}
export function storeyBand(z: number, base = 0, _height = STOREY_HEIGHT): number {
  const offset=normalizeLevelBase(base), levels=levelSteps(base)
  return Math.max(levels[0],Math.min(levels[levels.length-1],Math.floor((z-offset)/STOREY_HEIGHT)*STOREY_HEIGHT+offset))
}
/** Full-height PSD fascia finishes five centimetres below the next slab. */
export function psdFullHeight(_height = STOREY_HEIGHT): number { return PSD_FULL_HEIGHT }

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
export const WALK_SPEED = 1.34
/** §7.1 appearance proportions, chosen from stable identity rather than journey RNG. */
export const PASSENGER_CHILD_CHANCE = 0.20
export const PASSENGER_CHILD_SCALE = { height: 0.65, depth: 0.70, width: 0.70 } as const
export const PASSENGER_SIZE_VARIATION = { height: [0.80, 1.20], depth: [0.90, 1.10], width: [0.90, 1.10] } as const
export const PASSENGER_CHILD_SIZE_VARIATION = { depth: [0.80, 0.90], width: [0.80, 0.90] } as const
/** Crowd silhouettes reveal the station behind them. */
export const PASSENGER_OPACITY = 0.70
/** Reduced-detail people and ambient traffic reveal more of the station. */
export const PASSENGER_LOW_OPACITY = 0.45
/** §7.1 free-flow variation: longer steps, with the same relaxed cycle cadence.
 * Body proportions scale both physical stride and speed, including children. */
export const WALK_PROFILES = [
  { name: 'slow', speed: 0.9, cycleSeconds: 1.12 },
  { name: 'medium', speed: 1.15, cycleSeconds: 1.12 },
  { name: 'fast', speed: 1.4, cycleSeconds: 1.12 },
] as const
/** Walking speed on stair treads, m/s (derated from free flow). */
export const STAIR_SPEED = 1.0
/** Extra route cost, in seconds, to prefer escalators over faster stair rides. */
export const STAIR_AVOID_S = 32
/** Escalator running speed, m/s. 0.5 is the heavy-duty setting used in crowds. */
export const ESCALATOR_SPEED = 0.5
/** Escalator step pitch, m. One passenger per step is the capacity model. */
export const ESCALATOR_STEP_PITCH = 0.4
/**
 * A moving walkway's own speed, m/s: the belt carries a stander at the free
 * walking speed **plus** the 0.5 m/s the belt itself adds, so a walker who keeps
 * walking gets the same boost an escalator gives. The piece is level, so the
 * whole speed is what the graph edge is ridden at (`sim/walkways.ts`).
 */
export const WALKWAY_SPEED = WALK_SPEED + 0.5
/**
 * Moving-walkway throughput, pax/s per lane. A belt has no steps: riders stand
 * a walking stride apart (~0.8 m), so its capacity is the carried speed over
 * that pitch — a little under three per second on one 0.68 m lane.
 */
export const WALKWAY_PITCH = 0.8
export const WALKWAY_RATE = WALKWAY_SPEED / WALKWAY_PITCH
/** Separation between the two passenger columns of a wide ramp (§5.1), metres. */
export const RAMP_PASSENGER_COLUMN_SPACING = 0.7
/** Body clearance from the inside of a ramp rail; fits the narrow tread (§5.1). */
export const RAMP_BODY_RADIUS = 0.25
/** Outside clearance includes the shoulder and projecting handrail. */
export const RAMP_OUTSIDE_CLEARANCE = 0.4
/** Interior stair turns reserve a half landing tile before each flight's rail. */
export const RAMP_TURN_LANDING_INSET = 0.5
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
 * The letters worst-last, A first: the only ordering the code may index a letter
 * by. `LOS_LABELS` is a map to sort by *name*, and the charts and the run's own
 * record (§8.1) need the order, not the spelling.
 */
export const LOS_ORDER: readonly Los[] = ['A', 'B', 'C', 'D', 'E', 'F']

/**
 * The letters as the panels print them (§7.3). One map, because two readouts show a level
 * of service — the status bar's 平均拥挤等级 and the 时刻 window's own strip — and two maps is
 * two chances for them to disagree about what D means.
 */
export const LOS_LABELS: Record<Los, string> = {
  A: msg('free_flow'),
  B: msg('comfortable'),
  C: msg('busy'),
  D: msg('crowded'),
  E: msg('very_crowded'),
  F: msg('overcrowded'),
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
/** Reconsider a short walking corridor when a crowd forms (§7.2–7.3). */
export const CROWD_LOOKAHEAD = 8
export const CROWD_RECHECK_S = 8
export const CROWD_REPLAN_PER_TICK = 4
export const CROWD_REPLAN_MIN_BODIES = 3
export const CROWD_ROUTE_GAIN_S = 2
/** Fine walking fills clear corridor width instead of sharing one wall line (§7.2). */
export const WALK_LANE_REACH = 8
export const WALK_LANE_EDGE_INSET = 0.2
export const WALK_SEGMENT_SAMPLE = 0.25
export const WALK_LANE_FAN_SLOPE = 0.5
/** Waiting fans out on usable platform floor beside each door (§5.9). */
export const PLATFORM_WAIT_RADIUS = 4
export const PLATFORM_DOOR_WALK_WEIGHT = 0.25
export const PLATFORM_DOOR_COMMIT_WEIGHT = 8
export const PLATFORM_BOARD_APPROACH = 1.5

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
export const GATE_REPLAN_PER_TICK = 8
/** Nearby committed arrivals included in a gate's queue forecast (§7.2). */
export const GATE_FORECAST_SECONDS = 12
/** Bound the drain-time forecast when an approaching wave fills a two-way lane. */
export const GATE_FORECAST_MIN_DRAIN_FRACTION = 0.1
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
 * full-height screen clears the ceiling block by 5 cm; a half-height (半高) screen stops at
 * chest height. Shared by the collision envelope and the procedural model, so
 * the two can never disagree.
 */
export const PSD_FULL_HEIGHT = 3
/** Screen/barrier centre line within a platform tile, toward the track (§5.4). */
export const PSD_WALL_OFFSET = 0.34
export const PSD_BASE_DEPTH = 0.18
export const PSD_HALF_HEIGHT = 1.45
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
/** Running-rail crown and centreline offsets in the track model (metres). */
// The deeper trench adds the missing underfloor height, preserving the roof and platform datums.
export const TRACK_UNDERFLOOR_DROP = 0.49
export const TRACK_BED_DROP = 0.45 + TRACK_UNDERFLOOR_DROP
export const RAIL_HEAD_Z = 0.65 - TRACK_BED_DROP
export const RAIL_CENTRE_OFFSET = 0.7525
/** Track-local conductor height; train origins follow TRAIN_ORIGIN_Z. */
export const CONTACT_WIRE_Z = trainContactWireZ()
export const CONTACT_STRIP_Z = CONTACT_WIRE_Z - 0.012
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
 *
 * A 非工作日 runs 平峰/离峰 only: the peak windows do not apply, so an open
 * off-day is 平峰 all day and only the shut hours and the shoulders are 离峰.
 */
export function periodOf(simTime: number, service: TimeSpan = DEFAULT_SERVICE, peaks: PeakWindows = DEFAULT_PEAKS, workday = true): Period {
  const t = timeOfDayOf(simTime)
  if (!withinSpan(t, service)) return 'late'
  if (workday) for (const p of peaks) if (withinSpan(t, p)) return 'peak'
  if (t < SHOULDER_OPEN || t >= SHOULDER_CLOSE) return 'late'
  return 'offpeak'
}
/** Floor furniture clearance, including displays (GAME-SPEC §5.7). */
export const DESK_HEIGHT = 1.22
export const CHECKOUT_HEIGHT = 1.42
/** Decorative rail signal: preserve the reference proportions at one metre tall. */
export const RAIL_SIGNAL_HEIGHT = 1
export const RAIL_SIGNAL_SCALE = RAIL_SIGNAL_HEIGHT / 2.59
/** Conservative crowd bounds for render culling; preserve room for the baked gait. */
export const PASSENGER_CULL_HEIGHT_FRACTION = 0.85
export const PASSENGER_CULL_RADIUS_SCALE = 1.25
export const PASSENGER_INSTANCE_CAPACITY = 8000

export const OUTDOOR_SURFACE_HEIGHT = 0.1
/** Renderer detail falls away only after seams/leaves become small on screen. */
export const OUTDOOR_TILE_DETAIL_PX = 10
export const OUTDOOR_TREE_DETAIL_PX = 45
export const OUTDOOR_TREE_FAR_PX = 18
export const STATIC_DETAIL_HYSTERESIS = 1.2
/**
 * A train part without an authored Low variant may use the bounded-error
 * simplifier only up to this radius (metres), where its 2 % relative error stays
 * below a pixel. Static batching merges a whole consist's car body into one mesh,
 * so the larger pieces are authored instead — never fed to a 2 %-of-150 m error.
 */
export const TRAIN_DETAIL_MAX_RADIUS = 8
/** Four recent/prepared views, including the active one; bounds dormant GPU allocations. */
export const EQUIPMENT_VIEW_CACHE_SIZE = 4
/** At 24 CSS pixels, 2% geometric error is under half a pixel. */
export const EQUIPMENT_DETAIL_PX = 24
export const EQUIPMENT_DETAIL_ERROR = .02
export const EQUIPMENT_DETAIL_RATIO = .25
export const EQUIPMENT_DETAIL_MIN_TRIANGLES = 64

// Ambient street traffic and automatically derived road lanes (§4.1).
export const ROAD_VEHICLE_OPACITY = PASSENGER_OPACITY
export const ROAD_VEHICLE_LOW_OPACITY = PASSENGER_LOW_OPACITY
export const ROAD_LANE_WIDTH = 3
export const ROAD_TRAFFIC_SPACING = 20
export const ROAD_TRAFFIC_DENSITY = 0.5
export const ROAD_TRAFFIC_SPEED = 6
export const ROAD_TRAFFIC_CAPACITY = 192
export const ROAD_STEP = 0.1
export const ROAD_MAX_CATCHUP = 60
export const ROAD_SIGNAL_GREEN = 12
export const ROAD_SIGNAL_AMBER = 3
export const ROAD_SIGNAL_CLEAR = 5
export const ROAD_FOLLOW_GAP = 2
export const ROAD_CROSSWALK_DEPTH = 2
export const TRAFFIC_LIGHT_HEIGHT = 3.5
export const ROAD_NETWORK_CACHE_LIMIT = 8
export const ROAD_NODE_HANDLE_CAPACITY = 2048
export const ROAD_NODE_SNAP_RADIUS = 3
