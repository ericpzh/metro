// The simulation world.
//
// One tick is synchronous: integrate every agent, step every queue and train,
// record metrics, then return. No await, no per-agent microtasks (PLAN.md §2.4).
// Everything that consumes randomness draws from the single Rng, in a fixed
// iteration order, so `seed + tick -> identical crowd` (§7.6).

import { AgentPool, type Agent } from '../agents.ts'
import { activityChoice, dwellTimeline, packActivity, railTimeline } from '../activities.ts'
import { applyPopulationEdit, type PopulationEdit } from '../populationEdit.ts'
import { serviceArrivals, type TrainService } from '../trainSchedule.ts'
import {
  CONGESTION_CAP,
  CONGESTION_S,
  CROWD_RECHECK_S,
  CROWD_REPLAN_PER_TICK,
  PLATFORM_DOOR_WALK_WEIGHT,
  PLATFORM_DOOR_COMMIT_WEIGHT,
  PLATFORM_BOARD_APPROACH,
  DEFAULT_SIM_TIME,
  DOOR_RATE,
  GATE_CLEAR_RADIUS,
  GATE_LOOKAHEAD,
  GATE_REPLAN_PER_TICK,
  REROUTE_REPLAN_PER_TICK,
  LANE_SLOT,
  LIFT_BOARD_S,
  LIFT_DOOR_S,
  LIFT_DWELL_S,
  LIFT_SPEED,
  MAX_AGENTS,
  NEIGHBOUR_CELL,
  PERSONAL_SPACE,
  RAMP_PASSENGER_COLUMN_SPACING,
  SIM_DAY,
  SIM_SECONDS_PER_TICK,
  TRAIN_APPROACH_S,
  TRAIN_BERTH_HOLD,
  TRAIN_DEPART_HOLD,
  TRAIN_DEPART_S,
  TRAIN_DOOR_TRAVEL,
  TRAIN_DWELL,
  WALK_SPEED,
  ZONE_LINES_BLOCK,
  clamp,
  densityDerate,
  losOf,
  periodOf,
  type Period,
} from '../constants.ts'
import { DEFAULT_CALENDAR, dayAt, normalizeCalendar, normalizePeaks, normalizeService, type DayType, type SimCalendar } from '../clock.ts'
import {
  DEFAULT_DEMAND_INPUT,
  demandAt,
  hourOfDay,
  normalizeDayDemand,
  type DemandInput,
} from '../demand.ts'
import { Rng } from '../rng.ts'
import { crowdedWalkEnd, spreadWalkRoute } from '../crowdRouting.ts'
import { clearWalkSegment, walkingLaneNode, platformWaitingNodes } from '../walkingSpace.ts'
import { gateLaneAllows } from '../gates.ts'
import { GateTraffic } from '../gateTraffic.ts'
import { roadMoveClear, roadContainsPoint, type Road } from '../roads.ts'
import { passengerIsChild } from '../walking.ts'
import { rampMoveClear } from '../rampCollision.ts'
import { buildGraph, cellKey, EDGE_KIND, PathFinder, type ServerDef, type StationGraph } from '../station.ts'
import { liftDoorDir, liftDoorSideMask, liftLandingSide } from '../lifts.ts'
import { crossingDir, isUnpaidZone } from '../zones.ts'
import { STOCK, STOCK_CLASSES, CABIN_ALIGHT_MAX_S, CABIN_ALIGHT_PAIR_S, CABIN_FLOOR_Z, trainOriginForScale, trainScaleForStorey, CABIN_MAX_ROWS, CABIN_PAIR_HALF, cabinSlot, trainRatedCapacity } from '../stock.ts'
import { History } from '../history.ts'
import { normRot, rotateLocal, trackFacing, trackSide, trackTrainCentreV, type TrackModule } from '../track.ts'
import { ZONES, type LineDef, type StationData, type Trip } from '../types.ts'
import type { DynamicSnapshot, LineAnchor, Metrics, Train, TrainAt, TrainState } from './types.ts'

const STATE_ARRIVING = 0
const STATE_WALKING = 1
const STATE_QUEUING = 2
const STATE_BUYING = 3
const STATE_BROWSING = 4
const STATE_WAITING = 5
const STATE_RIDING = 6
const STATE_ALIGHTING = 7
const STATE_LEAVING = 8

const ARRIVE = 0.35
const SIM_DT = SIM_SECONDS_PER_TICK
/**
 * How much further than an end of the rail a consist must be *aimed* so that the
 * frame the player sees lands there. The choreography advances on the tick it
 * reaches a phase's length, so a departure is drawn at `1/S … (S−1)/S` of the
 * phase — the `p = 1` frame never renders, and the extreme drawn frame is only
 * `((S−1)/S)²` of the aimed distance. Dividing by that reciprocal keeps the drawn
 * run-out on the connected rail instead of a frame the sim never draws. (The
 * run-in no longer needs it: `approachProgress` lands its last drawn frame on the
 * berth itself.)
 */
function drawnRunScale(phaseSeconds: number): number {
  const s = phaseSeconds / SIM_DT
  return s > 1 ? (s / (s - 1)) ** 2 : 1
}

/**
 * Ease-out progress for the drawn run-in, reaching 1 on the phase's **last drawn
 * frame** so the consist is at rest on the mark the tick the berth begins. The
 * alighting wave is seated at that berth, and a newly spawned passenger is drawn
 * at its own position the moment it exists — so if the last drawn frame still
 * stood a few metres short, the crowd would pop in ahead of a train that had not
 * finished stopping. `drawnRunScale` pins the *first* drawn frame onto the
 * entrance rail end; this pins the last onto the mark.
 */
function approachProgress(t: number): number {
  const s = TRAIN_APPROACH_S / SIM_DT
  if (s <= 2) return clamp(t / TRAIN_APPROACH_S, 0, 1)
  const p = Math.min(1, t / TRAIN_APPROACH_S)
  return clamp((p * s - 1) / (s - 2), 0, 1)
}
/**
 * How many previewed route-leg tails are memoised before the whole memo is
 * dropped (see `World.routeTails`). A trip has a handful of legs and only one
 * passenger is previewed at a time, so this is generous by two orders of
 * magnitude — it is a bound on a leak, not a working set.
 */
const ROUTE_TAIL_MEMO_MAX = 256
/**
 * Sim seconds a passenger takes to cross a doorway: the step in from the
 * platform, or the step out of the cabin onto it. Short, because the doorway is
 * a metre of floor — the wait is the queue behind it, not the step.
 */
const TRAIN_STEP_S = 0.8
/** Relaxation of the crowd collision pass: how much of an overlap to resolve per tick. */
const SEPARATION_RELAX = 0.5
/** Ceiling on a single agent's collision displacement in one tick, m. */
const SEPARATION_MAX = 0.6
/**
 * Uniform-grid cell for the collision pass. Smaller than the density grid's
 * NEIGHBOUR_CELL so a packed crowd only tests the few bodies actually within
 * PERSONAL_SPACE, instead of every body in a 6 m square.
 */
const COLLISION_CELL = 1.0

/** A zeroed metrics block for a freshly constructed or loaded world. */
function freshMetrics(simTime: number): Metrics {
  return {
    tick: 0,
    simTime,
    population: 0,
    crowdLos: 'A',
    leftBehind: 0,
    boarded: 0,
    alighted: 0,
    exited: 0,
    trainArrivals: 0,
    trainsLate: 0,
    gateQueue: 0,
    escalatorQueue: 0,
    liftQueue: 0,
    doorQueue: 0,
    period: 'peak',
    agentsCap: false,
    tickMs: 0,
    stuck: 0,
  }
}

/** Dispatch/anchor key for one service: a (line, track) pair (§6.3). */
function trainKey(lineId: string, trackId: string): string {
  return `${lineId}|${trackId}`
}

export class World {
  data: StationData
  graph: StationGraph
  path: PathFinder
  rng: Rng
  seed: number
  tick = 0
  simTime = DEFAULT_SIM_TIME
  pool: AgentPool
  trains: Train[] = []
  doorsByLine = new Map<string, number[]>()
  /** Door servers per (line, track) service — what each consist boards with. */
  doorsByTrack = new Map<string, number[]>()
  doorOwner = new Map<number, string>()
  doorEdge = new Map<number, { line: string; index: number }>()
  lineById = new Map<string, LineDef>()
  lineAnchors = new Map<string, LineAnchor>()
  nextDispatch = new Map<string, number>()
  /** Per-node live population, for the LOS overlay. */
  nodePop: Int32Array
  metrics: Metrics
  /**
   * The run's minute-by-minute record (§8.1, the 数据 window): the counters above,
   * read once a minute and posted to the app as they land. Dropped by `load`,
   * `restart` and `seek` — each of those starts a different run or a different day,
   * and a chart that spliced them would draw a cliff where the clock jumped.
   */
  history = new History()
  /**
   * The passenger whose route the renderer previews (the 选择 tool's floor line),
   * or -1 for none. Only `routeOf` reads it, and only the worker writes it: the
   * preview is an observation, never an input, so a selected agent walks exactly
   * as it would if nobody were watching it.
   */
  selectedAgent = -1
  /**
   * The walk legs ahead of the previewed route, memoised per agent and leg. The
   * head of the route (the leg being walked) moves every tick, but the tail only
   * changes when the agent finishes a leg, so the A* searches behind it are paid
   * once rather than once per frame.
   *
   * Capped, because an agent's id is never reused within a pool but the *entry*
   * would outlive the passenger: a preview that followed one passenger per click
   * for an hour would hold every leg it ever drew. A tail is a pure function of
   * the graph and the leg, so dropping the memo costs one A* per leg and never a
   * wrong answer (see `World.rebuild`, which drops it when the graph is re-cut).
   */
  private routeTails = new Map<string, Float32Array>()
  /** The graph the cached tails were computed against; a rebuild drops them. */
  private routeTailGraph: StationGraph | null = null
  /** Deterministic work queue of agents waiting for a path. */
  private gridL = 1
  private gridMinZ = 0
  private cGridW = 1
  private cGridH = 1
  private cGridMinX = 0
  private cGridMinY = 0
  private cCounts = new Int32Array(1)
  private cStart = new Int32Array(2)
  private cOrder = new Int32Array(1)
  /** Crowd count within ~2 m of each collision cell's centre, for the derate. */
  private cellDensity = new Float32Array(1)
  /**
   * The same crowd, counted from the bodies' side: every standing passenger
   * charges the cell it is in **and the ring around it**, so a cell with nobody
   * on it still knows who is standing next to it. `cellDensity` is filled only
   * where there are bodies (that is all the speed derate needs), which is
   * exactly the wrong way round for pricing the crowd around a gate.
   */
  private crowdNear = new Float32Array(1)
  /**
   * Gate re-choices spent this tick. The fare-line decision skips the path cache
   * (§7.2), so it is a synchronous search inside the tick and has to be rationed
   * like one — at the gate's own cell too, where a wave arriving together used
   * to choose all at once. An agent the ration skips keeps `gateChosen` false
   * and retries next tick, so the wave spreads over ticks instead of stalling one.
   */
  private gateReplans = 0
  private gateTraffic!: GateTraffic
  /**
   * Patience re-routes spent this tick (`reRouteAroundQueue`). Same rationing as
   * the fare-line choice: without it every impatient agent runs a full synchronous
   * A* in the same tick. Reset beside `gateReplans` in `moveAgents`.
   */
  private rerouteReplans = 0
  private crowdReplans = 0
  private doorWaiting = new Map<number, Int32Array>()
  private doorGestures = new Map<number, number>()
  private doorLoads = new Int32Array(0)
  private nextTrainId = 1
  /** Scratch pose for `trainAt`, so pinning a cabin needs no allocation. */
  private poseScratch: TrainAt = { x: 0, y: 0, z: 0, fx: 1, fy: 0 }
  /**
   * Whether this world enforces §4.5's fare line. Defaults to `ZONE_LINES_BLOCK`,
   * which is off while the demo's zone paint is unfinished; a test — or a station
   * that wants the rule — passes its own answer.
   */
  readonly zoneBarriers: boolean

  constructor(data: StationData, seed = 1234567, opts: { zoneBarriers?: boolean } = {}) {
    this.data = data
    this.seed = seed
    this.rng = new Rng(seed)
    this.simTime = DEFAULT_SIM_TIME
    this.zoneBarriers = opts.zoneBarriers ?? ZONE_LINES_BLOCK
    const g = buildGraph(data, this.zoneBarriers)
    this.graph = g
    this.path = new PathFinder(g)
    this.pool = new AgentPool(this.rng)
    this.nodePop = new Int32Array(g.nodeCount)
    this.metrics = freshMetrics(this.simTime)
    this.history.reset(this.simTime)
    this.rebuild()
  }

  /**
   * Load a different station: a full simulation reset. Switching station is not
   * an edit — every agent, train, queue, metric, the clock and the RNG stream
   * start over, or the old crowd from the old document would walk the new one.
   * `rebuild()` is the edit path and deliberately keeps the crowd in place.
   */
  load(data: StationData, seed = data.seed, startSeconds = DEFAULT_SIM_TIME): void {
    this.data = data
    this.seed = seed
    this.rng = new Rng(seed)
    this.simTime = startSeconds
    this.tick = 0
    this.pool = new AgentPool(this.rng)
    this.trains = []
    this.nextTrainId = 1
    this.metrics = freshMetrics(startSeconds)
    this.selectedAgent = -1
    this.routeTails.clear()
    this.routeTailGraph = null
    this.history.reset(startSeconds)
    this.rebuild()
  }

  /**
   * Empty the simulation without changing the station or the clock: every agent,
   * train, queue and metric starts over, and the RNG reseeds so a restart is
   * deterministic. This is the "remove all agents" action — `load()` is for
   * switching documents, this keeps the one being watched.
   */
  restart(): void {
    this.rng = new Rng(this.seed)
    this.pool = new AgentPool(this.rng)
    this.trains = []
    this.nextTrainId = 1
    this.metrics = freshMetrics(this.simTime)
    // Nobody survives a restart, so the previewed passenger goes with the crowd.
    this.selectedAgent = -1
    this.routeTails.clear()
    this.routeTailGraph = null
    this.history.reset(this.simTime)
    this.rebuild(true)
  }

  /**
   * The station's authored day (§9.6C 时刻): its operating hours, its two peak windows and
   * the demand curves' knobs (one set for 工作日, one for 非工作日), normalized once per
   * `rebuild()` so the tick loop only ever reads plain numbers. Document data read there
   * rather than cached at construction, so an edit that reaches `this.data` takes effect
   * with no second copy to keep in step.
   */
  private day: DemandInput = DEFAULT_DEMAND_INPUT
  /**
   * The station's calendar (§9.6C 日期类型): which date day 0 is, and which dates are
   * holidays. Normalized here like the rest of the authored day, so `dayAt` is only ever asked
   * about a calendar the day can hold — a pick in the 时刻 window's calendar included.
   */
  private calendar: SimCalendar = DEFAULT_CALENDAR
  /**
   * The current day's kind — §7.4's `calendar(dayOfYear)`. Refreshed when the
   * calendar day rolls over: `dayAt` per tick would compute a civil date 64 times a second
   * for an answer that changes once a day.
   */
  private dayTypeCache: { index: number; type: DayType } = { index: Number.NaN, type: 'workday' }

  /** §6.5/§7.4: refresh only demand and dispatch inputs; retain live journeys,
   * trains, queues, route caches, collision buffers and RNG state. */
  updatePopulation(edit: PopulationEdit): void {
    const oldPeriod = periodOf(this.simTime, this.day.service, this.day.peaks, this.dayType() === 'workday')
    const oldHeadways = new Map(this.data.lines.map(l => [l.id, l.headwayProfile[oldPeriod]]))
    this.data = applyPopulationEdit(this.data, edit)
    for (const line of this.data.lines) this.lineById.set(line.id, line)
    for (const e of edit.exits) if (e.name !== undefined) {
      const exit = this.graph.exits.find(x => x.id === e.id)
      if (exit) exit.name = e.name
    }
    if (edit.settings) this.refreshDay()
    const period = periodOf(this.simTime, this.day.service, this.day.peaks, this.dayType() === 'workday')
    this.metrics.period = period
    if (!edit.headways && !edit.settings) return
    for (const line of this.data.lines) {
      const delta = line.headwayProfile[period] - (oldHeadways.get(line.id) ?? line.headwayProfile[period])
      if (delta === 0) continue
      const tracks = this.serviceTracks(line.id)
      for (const track of tracks.length ? tracks : [undefined]) {
        const key = trainKey(line.id, track?.id ?? '')
        const next = this.nextDispatch.get(key)
        if (next !== undefined && next > this.simTime) this.nextDispatch.set(key, Math.max(this.simTime, next + delta))
      }
    }
  }

  private refreshDay(): void {
    this.day = {
      service: normalizeService(this.data.service),
      peaks: normalizePeaks(this.data.peaks),
      ...normalizeDayDemand(this.data.demand),
    }
    this.calendar = normalizeCalendar(this.data.calendar)
    this.dayTypeCache.index = Number.NaN
  }

  /**
   * Move the clock to `seconds` — the 时刻 window's calendar pick, and §7.9's scrub (§7.9 "drag the
   * timeline to 07:50"). The crowd, the queues and the trains in flight are **untouched**: what
   * changes is the day the demand is drawn from and the period the timetable is in.
   *
   * The **dispatch schedule is dropped**, because `nextDispatch` holds absolute sim times: seeking
   * backwards from a run's 22nd day to its 1st would otherwise stall every train until the clock
   * came round to that date again — the exact bug a scrubber has to avoid.
   */
  seek(seconds: number): void {
    this.simTime = seconds
    this.metrics.simTime = seconds
    this.metrics.period = periodOf(seconds, this.day.service, this.day.peaks, dayAt(seconds, this.calendar).dayType === 'workday')
    this.dayTypeCache.index = Number.NaN
    this.nextDispatch.clear()
    // The record is the run's, and a seek puts the run on another day: starting it
    // over here is what keeps a chart from drawing an hour-wide cliff at the jump.
    this.history.reset(seconds)
  }

  /** Rebuild the graph from static data and reset derived state. */
  private roads: Road[] = []
  /** Platform-side half of edge cells; prepared once with the routing graph. */
  private platformFloor = new Map<number, readonly [number, number]>()

  rebuild(reuseGraph = false): void {
    this.doorWaiting.clear()
    this.doorGestures.clear()
    this.roads = this.data.modules.filter((m): m is Road => m.type === 'road')
    // The authored day is document data: re-read and re-normalize it on every rebuild,
    // which is the same path a live edit takes (`build` → `rebuild`).
    this.refreshDay()
    if (!reuseGraph) {
      this.graph = buildGraph(this.data, this.zoneBarriers)
      this.platformFloor.clear()
      for (const p of this.graph.platforms) {
        const edge = this.data.modules.find(m => m.id === p.id)
        if (edge?.type !== 'platform-edge') continue
        const inward = rotateLocal(edge.rot, 0, edge.cfg.side === 'right' ? -1 : 1)
        for (const node of p.cells) this.platformFloor.set(node, inward)
      }
      // A tail is a list of node ids, so every one of them is stale the moment the
      // graph is re-cut — dropped here rather than left to the identity check in
      // `routeTail`, which only fires on the next preview.
      this.routeTails.clear()
      this.routeTailGraph = this.graph
      this.nodePop = new Int32Array(this.graph.nodeCount)
      this.doorsByLine.clear()
      this.doorLoads = new Int32Array(this.graph.servers.length)
      this.doorsByTrack.clear()
      this.doorOwner.clear()
      this.doorEdge.clear()
      this.lineById.clear()
      for (const l of this.data.lines) this.lineById.set(l.id, l)
      this.computeLineAnchors()
      for (const p of this.graph.platforms) {
        const arr = this.doorsByLine.get(p.line) ?? []
        for (const d of p.doors) {
          arr.push(d)
          this.doorOwner.set(d, p.line)
          this.doorEdge.set(d, { line: p.line, index: p.doors.indexOf(d) })
        }
        this.doorsByLine.set(p.line, arr)
        // Each platform belongs to the rail that derived it (`cfg.from`), so a
        // consist boards only at its own screen doors. Edges that predate
        // `cfg.from` fall back to the rail of the same direction, or the line's
        // only rail.
        const edgeMod = this.data.modules.find((m) => m.id === p.id)
        const from = edgeMod?.type === 'platform-edge' ? edgeMod.cfg.from : undefined
        const rails = this.serviceTracks(p.line)
        const trackId = rails.some((t) => t.id === from)
          ? (from as string)
          : (rails.filter((t) => (t.cfg.dir ?? this.lineById.get(p.line)?.direction) === p.dir)[0] ?? rails[0])?.id
        if (trackId !== undefined) {
          const key = trainKey(p.line, trackId)
          const tarr = this.doorsByTrack.get(key) ?? []
          for (const d of p.doors) tarr.push(d)
          this.doorsByTrack.set(key, tarr)
        }
      }
    } else {
      this.nodePop.fill(0)
      this.doorLoads.fill(0)
    }
    for (const mod of this.data.modules) if (mod.type === 'door') {
      const [fx,fy] = rotateLocal(mod.rot,0,1)
      for (const offset of [0,-1]) for (let i=0;i<mod.w;i++) {
        const [rx,ry] = rotateLocal(mod.rot,i,offset)
        const node = this.graph.nodeIndex.get(cellKey(mod.x+rx,mod.y+ry,mod.z))
        if (node !== undefined) this.doorGestures.set(node,Math.atan2(fy,fx))
      }
    }
    // Search queues, congestion and forecasts are dynamic even when topology is
    // retained. Their fresh state must match a full restart, including lifts.
    this.path = new PathFinder(this.graph)
    this.gateTraffic = new GateTraffic(this.graph)
    this.path.gateWait = (s, dir) => this.gateTraffic.wait(s, dir)
    this.routeTails.clear()
    this.routeTailGraph = this.graph
    // Reset server queues; agents will re-request on the next tick.
    for (const s of this.graph.servers) {
      s.queue.length = 0
      s.cooldown = 0
      s.served = 0
      s.waitAccum = 0
      s.waitCount = 0
      s.lane = 0
      s.activeCustomer = undefined
      if (s.ramp) {
        s.ramp.next = 0
        if (s.ramp.traffic) { s.ramp.traffic.direction = -1; s.ramp.traffic.until = 0 }
      }
      if (s.lift) {
        const car = s.lift
        car.at = 0; car.z = car.stopZ[0]
        car.legFrom = 0; car.legTo = 0; car.moveT = 0; car.moveTotal = 0
        car.phase = 'idle'; car.t = 0; car.door = 0; car.riders.length = 0
      }
    }
    /**
     * A consist still on the road holds its own doorways, and an edit re-cuts
     * them: the screen a car door meets can move, appear or go. When that
     * happens the cabin those passengers were seated in is no longer the cabin
     * that was drawn, so they are set down — without a left-behind mark, since
     * an edit is not the station failing to serve them.
     */
    for (const train of this.trains) {
      const key = trainKey(train.line, train.track)
      const doors = this.doorsByTrack.get(key) ?? this.doorsByLine.get(train.line) ?? []
      const same = doors.length === train.doors.length && doors.every((d, i) => d === train.doors[i])
      train.doors = doors
      if (same) continue
      for (const a of this.pool.live) {
        if (a.train === train.id) this.pool.kill(a)
      }
      train.cabins = doors.map(() => [])
      train.cabinDepth = doors.map(() => 0)
      train.cabinRows = doors.map(() => 0)
      train.doorT = doors.map(() => 0)
      train.inFlight = doors.map(() => 0)
      train.boardings = doors.map(() => 0)
      train.alightLeft = 0
      train.onboard = 0
    }
    this.pool.forEach((a) => {
      // An edit may pave the tile beneath a standing passenger (§7.2). Move it
      // to the nearest remaining floor on that level before replanning.
      if (a.train < 0 && a.state !== STATE_RIDING && roadContainsPoint(this.roads, a.x, a.y, Math.round(a.z) - 1)) {
        let nearest = -1, distance = Infinity
        for (let node = 0; node < this.graph.nodeCount; node++) {
          if (this.graph.nodeZ[node] !== Math.round(a.z)) continue
          const d = (this.graph.nodeX[node] - a.x) ** 2 + (this.graph.nodeY[node] - a.y) ** 2
          if (d < distance) { nearest = node; distance = d }
        }
        if (nearest < 0) this.pool.kill(a)
        else { a.x = this.graph.nodeX[nearest]; a.y = this.graph.nodeY[nearest]; a.vx = 0; a.vy = 0 }
      }
      a.path = EMPTY_PATH
      for (const leg of a.legs) leg.node = -1
      a.awaitingPath = false
      a.servedFor = -1
      a.pathIdx = 0
      a.fromNode = -1
      a.destNode = -1
      a.server = -1
      a.rampApproach = undefined
      a.activity = 0
      a.activeStop = ''
      a.wait = 0
      a.patienceWait = 0
      a.state = STATE_ARRIVING
      // A rider is *not* unpinned here: the loop above sets a consist's riders
      // down only when its doorways were re-cut, and a rebuild that left them
      // alone has to leave the wave riding (see the cabin's own test).
      a.liftServer = -1
      a.liftBoard = -1
      a.liftDest = -1
      a.liftPhase = 0
      a.liftT = 0
    })
    if (!reuseGraph) this.setupGrid()
    else {
      this.cCounts.fill(0); this.cStart.fill(0); this.cOrder.fill(0)
      this.cellDensity.fill(0); this.crowdNear.fill(0)
    }
    this.nextDispatch.clear()
    let stagger = 0
    for (const l of this.data.lines) {
      const tracks = this.serviceTracks(l.id)
      if (tracks.length === 0) {
        this.nextDispatch.set(trainKey(l.id, ''), this.simTime + stagger)
        stagger += 13
        continue
      }
      for (const t of tracks) {
        this.nextDispatch.set(trainKey(l.id, t.id), this.simTime + stagger)
        stagger += 13
      }
    }
  }

  /**
   * The rails a line runs trains on: one consist per (line, track) (§6.3).
   * Tunnel runs are extensions, not berths — unless the line owns nothing
   * else, so a tunnel-only line still shows a train. Document order, keeping
   * dispatch deterministic (§7.6).
   */
  private serviceTracks(lineId: string): TrackModule[] {
    const bound = this.data.modules.filter((m): m is TrackModule => m.type === 'track' && m.cfg.line === lineId)
    const platforms = bound.filter((t) => !t.cfg.tunnel && !t.cfg.bridge)
    return platforms.length > 0 ? platforms : bound
  }

  private setupGrid(): void {
    const g = this.graph
    this.gridMinZ = g.levelsZ.length ? Math.floor(g.levelsZ[0]) - 2 : -8
    this.gridL = clamp(g.levelsZ.length + 4, 2, 32)
    this.cGridMinX = Math.floor(g.minX) - 2
    this.cGridMinY = Math.floor(g.minY) - 2
    this.cGridW = clamp(Math.ceil((g.maxX - g.minX) / COLLISION_CELL) + 4, 4, 1024)
    this.cGridH = clamp(Math.ceil((g.maxY - g.minY) / COLLISION_CELL) + 4, 4, 1024)
    const cnb = this.cGridW * this.cGridH * this.gridL
    this.cCounts = new Int32Array(cnb)
    this.cStart = new Int32Array(cnb + 1)
    this.cOrder = new Int32Array(Math.max(64, this.pool.count + 64))
    this.cellDensity = new Float32Array(cnb)
    this.crowdNear = new Float32Array(cnb)
  }

  /* -------------------------------------------------------------- public */

  tickOnce(): Metrics {
    const t0 = performanceNowMs()
    this.tick++
    this.simTime += SIM_DT
    const workday = this.dayType() === 'workday'
    const period = periodOf(this.simTime, this.day.service, this.day.peaks, workday)

    this.dispatchTrains(period)
    this.spawnStreet(period)
    this.stepServers()
    this.moveAgents()
    this.pool.compact()
    this.computeMetrics(period)
    // The minute's own read (§8.1): a no-op on 59 ticks out of 60.
    this.history.sample(this.metrics)
    // The path cache is keyed on (from, to, needsClass); queue waits drift, so
    // refresh it periodically and let new legs rebalance (§7.2 trigger 3).
    if (this.tick % 60 === 0) this.path.clear()

    const ms = performanceNowMs() - t0
    this.metrics.tickMs = ms
    return this.metrics
  }

  /**
   * Write a render buffer: [x, y, z, state, packed activity, id] per live agent. The id
   * is what lets the renderer interpolate the same agent across frames; slots
   * move around as agents die because `pool.compact()` shifts the live list.
   */
  writeTransfer(out: Float32Array): number {
    let n = 0
    const live = this.pool.live
    for (let i = 0; i < live.length; i++) {
      const a = live[i]
      const o = i * 6
      out[o] = a.x
      out[o + 1] = a.y
      out[o + 2] = a.z
      out[o + 3] = a.state
      out[o + 4] = this.activityTransfer(a)
      out[o + 5] = a.id
      n++
    }
    return n
  }

  private activityTransfer(a: Agent): number {
    const elapsed = (this.tick - a.activityStart) * SIM_DT
    if (a.activity && elapsed >= 0 && (a.activeStop || elapsed < a.activityTotal)) {
      const time = a.activeStop ? dwellTimeline(elapsed, a.activityTotal, a.activity)
        : a.activity === 5 || a.activity === 6 ? a.activityVariant * 4 + elapsed * 2
        : a.activity === 11 ? 2.5 + elapsed * 2
        : a.activity === 7 || a.activity === 14 ? railTimeline(a.rideTotal-a.rideT,a.rideTotal,a.activityVariant)
        : dwellTimeline(elapsed,a.activityTotal,a.activity)
      return packActivity(a.activity, time, a.activityYaw)
    }
    if (a.state === STATE_QUEUING || a.state === STATE_WAITING) {
      const s = this.graph.servers[a.server]
      const yaw = s ? Math.atan2(this.graph.nodeY[s.node] - a.y, this.graph.nodeX[s.node] - a.x) : a.activityYaw
      return packActivity(s?.kind === 'door' ? 13 : 12, (this.tick * SIM_DT + a.id * .71) % 12, yaw)
    }
    return 0
  }

  snapshot(): DynamicSnapshot {
    const agents: DynamicSnapshot['agents'] = []
    for (const a of this.pool.live) {
      agents.push({ id: a.id, seed: a.seed, x: a.x, y: a.y, z: a.z, state: a.state, trip: a.trip, legIdx: a.legIdx, pathIdx: a.pathIdx })
    }
    return { rng: this.rng.state, tick: this.tick, simTime: this.simTime, agents }
  }

  /* ------------------------------------------------------------ spawning */

  /**
   * The demand multiplier at this instant: `sim/demand.ts`'s curve for the day the
   * calendar is on — the same samples the 时刻 window plots — scaled by the period
   * the timetable is in. The period is handed in because `tickOnce` has already
   * asked for it: asking twice is two chances to answer differently.
   */
  private curve(period: Period): number {
    const workday = this.dayType() === 'workday'
    const knobs = workday ? this.day.workday : this.day.offday
    return demandAt(hourOfDay(this.simTime), period, knobs)
  }

  /** The day type the calendar is on, refreshed when the simulated day rolls over. */
  private dayType(): DayType {
    const index = Math.floor(this.simTime / SIM_DAY)
    if (this.dayTypeCache.index !== index) {
      this.dayTypeCache = { index, type: dayAt(this.simTime, this.calendar).dayType }
    }
    return this.dayTypeCache.type
  }

  private spawnStreet(period: 'peak' | 'offpeak' | 'late'): void {
    if (this.pool.count >= MAX_AGENTS) {
      this.metrics.agentsCap = true
      return
    }
    const curve = this.curve(period)
    for (const e of this.graph.exits) {
      const mod = this.data.modules.find((m) => m.id === e.id)
      if (!mod || mod.type !== 'exit') continue
      const cfg = mod.cfg
      if (!cfg.open || cfg.inRate <= 0) continue
      const n = this.rng.poissonHour(cfg.inRate * curve, SIM_DT)
      for (let k = 0; k < n; k++) {
        if (this.pool.count >= MAX_AGENTS) return
        this.spawnAtNode(e.node, 'exit:' + e.id, this.sampleTripFromStreet(e.node))
      }
    }
  }

  private sampleTripFromStreet(origin = -1): Trip {
    const lineIds = this.data.lines.map((l) => l.id)
    const board = lineIds.length > 0 && this.rng.chance(0.55)
    const dest = board ? 'line:' + lineIds[0] : 'exit:' + this.pickExitId()
    const stops = this.sampleErrands(origin, true, board)
    return { origin: '', stops, dest }
  }

  private sampleErrands(origin: number, entry: boolean, boarding = true): string[] {
    const stops: string[] = []
    const choice = this.rng.next()
    const kinds = entry
      ? choice < .25 ? boarding ? ['tvm', 'vending'] : ['vending'] : choice < .30 ? ['shelf', 'shop', 'retail'] : choice < .34 ? ['bench'] : choice < .37 ? ['cubicle'] : []
      : choice < .08 ? ['vending'] : choice < .12 ? ['shelf', 'shop', 'retail'] : choice < .15 ? ['bench'] : choice < .17 ? ['cubicle'] : []
    const g = this.graph
    // Local errands only: never send somebody across the station or a fare
    // boundary for a discretionary drink. Unreachable optional legs are skipped.
    const candidates = g.stops.filter(s => kinds.includes(s.kind) && s.publicShop!==false &&
      (s.kind !== 'bench' || s.server === undefined || (g.servers[s.server].activeCustomer === undefined && g.servers[s.server].queue.length === 0)) &&
      (entry ? isUnpaidZone(ZONES[g.nodeZone[s.node]]) : origin >= 0 && crossingDir(ZONES[g.nodeZone[origin]],ZONES[g.nodeZone[s.node]]) === 0) &&
      (origin < 0 || (Math.abs(g.nodeZ[s.node] - g.nodeZ[origin]) <= 20 && Math.hypot(g.nodeX[s.node] - g.nodeX[origin], g.nodeY[s.node] - g.nodeY[origin]) < 24)))
    candidates.sort((a,b) => {
      const score = (s: typeof a) => (origin < 0 ? 0 : Math.hypot(g.nodeX[s.node]-g.nodeX[origin],g.nodeY[s.node]-g.nodeY[origin]) + Math.abs(g.nodeZ[s.node]-g.nodeZ[origin])*2) + (s.server === undefined ? 0 : g.servers[s.server].queue.length * (s.duration ?? 20) + g.servers[s.server].cooldown)
      return score(a)-score(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    })
    const pick = candidates.length ? candidates[this.rng.int(Math.min(3,candidates.length))] : undefined
    if (pick) {
      stops.push('stop:' + pick.id)
      if (pick.kind === 'cubicle') {
        const sinks = g.stops.filter(s => s.kind === 'sink' && Math.abs(g.nodeZ[s.node]-g.nodeZ[pick.node]) < .1 && crossingDir(ZONES[g.nodeZone[s.node]],ZONES[g.nodeZone[pick.node]]) === 0 && Math.hypot(g.nodeX[s.node]-g.nodeX[pick.node],g.nodeY[s.node]-g.nodeY[pick.node]) < 12)
        sinks.sort((a,b) => Math.hypot(g.nodeX[a.node]-g.nodeX[pick.node],g.nodeY[a.node]-g.nodeY[pick.node])-Math.hypot(g.nodeX[b.node]-g.nodeX[pick.node],g.nodeY[b.node]-g.nodeY[pick.node]))
        if (sinks[0]) stops.push('stop:' + sinks[0].id)
      }
    }
    return stops
  }

  private pickExitId(): string {
    // All open exits are equal: outflow is unlimited, so this is a uniform
    // choice of door, not a rate weight.
    const exits = this.graph.exits.filter((e) => {
      const m = this.data.modules.find((x) => x.id === e.id)
      return m && m.type === 'exit' && m.cfg.open
    })
    if (exits.length === 0) return ''
    return exits[this.rng.int(exits.length)].id
  }

  private sampleTripFromTrain(exitShare: number, arrivingLine: string, origin = -1): Trip {
    const stops = origin >= 0 ? this.sampleErrands(origin, false) : []
    if (this.rng.chance(exitShare)) return { origin: '', stops, dest: 'exit:' + this.pickExitId() }
    // Only a *different* line can be a transfer destination (§7.5). With one
    // line in the demo every alighting passenger is exiting.
    const other = this.data.lines.map((l) => l.id).filter((id) => id !== arrivingLine)
    if (other.length > 0) return { origin: '', stops, dest: 'line:' + other[0] }
    return { origin: '', stops, dest: 'exit:' + this.pickExitId() }
  }

  private spawnAtNode(node: number, origin: string, trip: Trip): Agent | null {
    const g = this.graph
    if (node < 0 || node >= g.nodeCount) return null
    // Deterministic jitter inside the cell so a spawn wave does not stack; the
    // collision pass then spreads the wave out.
    const jx = (this.rng.next() - 0.5) * 0.6
    const jy = (this.rng.next() - 0.5) * 0.6
    const a = this.pool.spawn({ origin, stops: trip.stops, dest: trip.dest }, g.nodeX[node] + jx, g.nodeY[node] + jy, g.nodeZ[node], this.tick)
    return a
  }

  /* -------------------------------------------------------------- trains */

  private headwayFor(line: LineDef, period: 'peak' | 'offpeak' | 'late'): number {
    return period === 'peak' ? line.headwayProfile.peak : period === 'offpeak' ? line.headwayProfile.offpeak : line.headwayProfile.late
  }

  /** The same per-track dispatch schedule that runs the trains, for platform TVs (§6.5). */
  trainServices(): TrainService[] {
    const services: TrainService[] = []
    for (const line of this.data.lines) {
      const tracks = this.serviceTracks(line.id)
      for (const track of tracks.length ? tracks : [undefined]) {
        const trackId = track?.id ?? ''
        const key = trainKey(line.id, trackId)
        const anchor = this.lineAnchors.get(key)
        if (!anchor) continue
        const active = this.trains.find((t) => t.line === line.id && t.track === trackId)
        services.push({
          lineId: line.id, trackId, trainState: active?.state, direction: track?.cfg.dir ?? line.direction,
          x: anchor.x, y: anchor.y, z: anchor.z, fx: anchor.fx, fy: anchor.fy,
          halfLength: track ? track.w / 2 : 0,
          arrivals: serviceArrivals(this.simTime, this.nextDispatch.get(key) ?? this.simTime, active, line, this.day.service, this.day.peaks, this.dayType() === 'workday'),
        })
      }
    }
    return services
  }

  private dispatchTrains(period: 'peak' | 'offpeak' | 'late'): void {
    for (const line of this.data.lines) {
      const tracks = this.serviceTracks(line.id)
      if (tracks.length === 0) {
        // No rails yet (a hand-authored edge with no track): the line still
        // runs one train serving the whole line.
        this.maybeDispatch(line, '', period, trainKey(line.id, ''), this.doorsByLine.get(line.id) ?? [], line.direction)
        continue
      }
      for (const track of tracks) {
        const key = trainKey(line.id, track.id)
        this.maybeDispatch(line, track.id, period, key, this.doorsByTrack.get(key) ?? [], track.cfg.dir ?? line.direction)
      }
    }

    for (const train of this.trains.slice()) {
      train.t += SIM_DT
      switch (train.state) {
        case 'approach':
          // Running in; the consist comes to a stand at the platform mark.
          if (train.t >= TRAIN_APPROACH_S) {
            this.setTrainState(train, 'berth')
            this.loadAlighting(train)
            this.metrics.trainArrivals++
          }
          break
        case 'berth':
          // Held at the mark, doors shut, before they cycle.
          if (train.t >= TRAIN_BERTH_HOLD) {
            this.openDoors(train)
            this.setTrainState(train, 'opening')
          }
          break
        case 'opening':
          // The leaves travel; the doorways step their passengers out while they do.
          this.stepAlighting(train)
          if (train.t >= TRAIN_DOOR_TRAVEL) this.setTrainState(train, 'dwell')
          break
        case 'dwell':
          // Doors fully open, serving the platform.
          this.stepAlighting(train)
          if (train.t >= TRAIN_DWELL) {
            this.closeDoors(train)
            this.setTrainState(train, 'closing')
          }
          break
        case 'closing':
          // The leaves shut; the queues have already been abandoned.
          if (train.t >= TRAIN_DOOR_TRAVEL) {
            this.setTrainState(train, 'hold')
            this.emptyTrain(train)
          }
          break
        case 'hold':
          // Sealed, waiting to pull out.
          if (train.t >= TRAIN_DEPART_HOLD) this.setTrainState(train, 'depart')
          break
        case 'depart':
          // Run out, then the consist leaves the world.
          if (train.t >= TRAIN_DEPART_S) {
            this.emptyTrain(train)
            this.trains.splice(this.trains.indexOf(train), 1)
          }
          break
      }
    }
  }

  /** Dispatch one service unless its consist is already running. */
  private maybeDispatch(line: LineDef, trackId: string, period: 'peak' | 'offpeak' | 'late', key: string, doors: number[], dir: string): void {
    const active = this.trains.find((t) => t.line === line.id && t.track === trackId)
    const next = this.nextDispatch.get(key) ?? this.simTime
    if (!active && this.simTime >= next) {
      const train: Train = {
        id: this.nextTrainId++,
        line: line.id,
        track: trackId,
        state: 'approach',
        t: 0,
        boarded: 0,
        alighted: 0,
        onboard: 0,
        capacity: trainRatedCapacity(line),
        late: 0,
        doors,
        dir,
        cabins: [],
        cabinDepth: [],
        cabinRows: [],
        doorT: [],
        inFlight: [],
        boardings: [],
        alightLeft: 0,
        alightT: 0,
      }
      // Cabin passengers are created at berth, before opening (§1.13, §5.9).
      this.trains.push(train)
      this.nextDispatch.set(key, this.simTime + this.headwayFor(line, period))
    }
  }

  /** Move a train to the head of `state`, resetting its phase clock. */
  private setTrainState(train: Train, state: TrainState): void {
    train.state = state
    train.t = 0
  }

  /**
   * The doors open onto the platform — but the alighting wave leaves through
   * them first, so boarding is held at each doorway until its own queue has
   * drained (`stepAlighting` opens them one at a time). The leaves are drawn
   * from the train's own state, so holding the rate changes nothing the player
   * sees except who is walking through the doorway.
   */
  private openDoors(train: Train): void {
    for (const d of train.doors) {
      const s = this.graph.servers[d]
      if (!s) continue
      s.rate = 0
      s.cooldown = 0
    }
  }

  private closeDoors(train: Train): void {
    for (const d of train.doors) {
      const s = this.graph.servers[d]
      if (!s) continue
      s.rate = 0
      // Whoever is still queued was left behind by this train.
      this.metrics.leftBehind += s.queue.length
    }
  }

  /**
   * Seat the alighting wave this consist brings (§5.9, §7.4). The whole cohort
   * is placed in the doorway queues it will leave by — the front pair at its own
   * door, the rows behind it receding inboard — once the train has stopped,
   * before the doors open, so the platform sees people
   * step out of a train rather than appear around a screen door.
   *
   * A wave too big for the cabin (a station left on a crush setting) keeps the
   * remainder on `alightLeft` and is seated as the queues drain.
   */
  private loadAlighting(train: Train): void {
    const n = train.doors.length
    train.cabins = []
    train.cabinDepth = []
    train.cabinRows = []
    train.doorT = []
    train.inFlight = []
    train.boardings = []
    for (let d = 0; d < n; d++) {
      train.cabins.push([])
      train.cabinDepth.push(0)
      train.cabinRows.push(0)
      train.doorT.push(0)
      train.inFlight.push(0)
      train.boardings.push(0)
    }
    const line = this.lineById.get(train.line)
    train.alightLeft = line && n > 0 ? Math.max(0, line.alightPerTrain) : 0
    // One row at a time *across* the consist, so a wave smaller than the cabin
    // spreads over every doorway rather than packing the first car solid.
    for (let row = 0; row < CABIN_MAX_ROWS && train.alightLeft > 0; row++) {
      for (let d = 0; d < n && train.alightLeft > 0; d++) {
        let seated = 0
        for (const file of [-1, 1]) {
          if (train.alightLeft <= 0) break
          if (!this.seatAlighter(train, d, file, row)) break
          train.alightLeft--
          seated++
        }
        if (seated > 0) train.cabinRows[d] = row + 1
      }
    }
    // What the cabin could hold is the depth boarders stand behind.
    for (let d = 0; d < n; d++) train.cabinDepth[d] = train.cabinRows[d]
  }

  /**
   * Put one alighting passenger in the cabin at its doorway queue's slot. It is
   * `STATE_ALIGHTING` from the moment it is seated: aboard, pinned to the
   * consist, and out of the station crowd's way until it steps onto the floor.
   */
  private seatAlighter(train: Train, door: number, file: number, row: number): boolean {
    if (this.pool.count >= MAX_AGENTS) {
      this.metrics.agentsCap = true
      return false
    }
    const slot = this.cabinWorldPos(train, door, file, row)
    if (!slot) return false
    const trip = this.sampleTripFromTrain(0.55, train.line, this.graph.servers[train.doors[door]]?.node ?? -1)
    if (!trip.dest) return false
    const a = this.pool.spawn({ origin: 'train:' + train.line, stops: trip.stops, dest: trip.dest }, slot[0], slot[1], slot[2], this.tick)
    if (!a) return false
    a.state = STATE_ALIGHTING
    a.train = train.id
    a.trainDoor = door
    a.trainFile = file
    a.trainRow = row
    a.trainPhase = 1
    a.trainT = 0
    train.cabins[door].push(a.id)
    return true
  }

  /**
   * The world position of a cabin slot: the consist's own pose plus the slot's
   * place in its frame. The car runs along the consist's local +x and its doors
   * face local ±y, which is the frame `doorCentres` and `cabinSlot` are in.
   */
  private cabinWorldPos(train: Train, door: number, file: number, row: number): [number, number, number] | null {
    const s = this.graph.servers[train.doors[door]]
    if (!s) return null
    const at = this.trainAt(train, this.poseScratch)
    if (!at) {
      // A platform edge with no rail under it (§6.3: dispatch needs a track to
      // *draw* a consist, not to run one). There is no car to stand in and none
      // drawn to stand in it, so the wave waits where it would leave from — at
      // its own doorway, at a car floor's height over the platform.
      const g = this.graph
      return [
        g.nodeX[s.node] + file * 0.3,
        g.nodeY[s.node] + (row % 2 === 0 ? -0.15 : 0.15),
        g.nodeZ[s.node],
      ]
    }
    // The doorway's own place in the consist's frame: the screen door stands on
    // the cell its car door falls in, so the two are the same point to the half
    // metre the graph rounds to.
    const dx = this.graph.nodeX[s.node] - at.x
    const dy = this.graph.nodeY[s.node] - at.y
    const doorX = dx * at.fx + dy * at.fy
    const across = -dx * at.fy + dy * at.fx
    const side = across >= 0 ? 1 : -1
    const scale = trainScaleForStorey(this.data.storeyHeight)
    const [sx, sy] = cabinSlot(doorX / scale, side, file, row)
    const lx = sx * scale, ly = sy * scale
    return [at.x + lx * at.fx - ly * at.fy, at.y + lx * at.fy + ly * at.fx, at.z + CABIN_FLOOR_Z * trainScaleForStorey(this.data.storeyHeight)]
  }

  /**
   * Step the alighting queues out of one consist, a pair a doorway at a time,
   * and hand each doorway to the boarders the moment it is clear. Called while
   * the doors are cycling, so a wave leaves over the dwell — not in one tick.
   *
   * The doorway's alighting turn is bounded (`CABIN_ALIGHT_MAX_S`): past it
   * whoever is still in the cabin rides on, and the doorway boards. A dwell has
   * to be shared, and the arrivals it could not get off are the stop's
   * left-behind count, not a platform that silently never boards.
   */
  private stepAlighting(train: Train): void {
    const n = train.doors.length
    train.alightT += SIM_DT
    const streaming = train.alightT <= CABIN_ALIGHT_MAX_S
    if (!streaming) {
      // Turning to boarding: the queue stops being a queue, and the riders still
      // standing in it are simply still aboard. Whatever never even reached the
      // cabin is this stop's left-behind arrivals, counted as it is dropped.
      this.metrics.leftBehind += train.alightLeft
      train.alightLeft = 0
      for (let d = 0; d < n; d++) {
        train.cabins[d].length = 0
        train.cabinRows[d] = 0
      }
    }
    for (let d = 0; d < n; d++) {
      const s = this.graph.servers[train.doors[d]]
      if (!s) continue
      const queue = train.cabins[d]
      if (streaming) {
        // Refill first: a wave the cabin could not hold is seated as room appears.
        while (train.alightLeft > 0 && train.cabinRows[d] < CABIN_MAX_ROWS) {
          const row = train.cabinRows[d]
          if (!this.seatAlighter(train, d, -1, row)) {
            train.alightLeft = 0
            break
          }
          train.alightLeft--
          // An odd wave leaves one seat in its last row empty.
          if (train.alightLeft > 0 && this.seatAlighter(train, d, 1, row)) train.alightLeft--
          train.cabinRows[d] = row + 1
        }
        // Then let the front row out, at the doorway's own cadence.
        train.doorT[d] -= SIM_DT
        if (train.doorT[d] <= 0 && queue.length > 0) {
          let out = 0
          for (let i = queue.length - 1; i >= 0; i--) {
            const a = this.pool.all().get(queue[i])
            if (!a || a.dead) {
              queue.splice(i, 1)
              continue
            }
            if (a.trainRow > 0) continue
            this.stepOut(train, a, s.node)
            queue.splice(i, 1)
            train.inFlight[d]++
            out++
          }
          if (out > 0) {
            train.cabinRows[d] = Math.max(0, train.cabinRows[d] - 1)
            // Accumulated, not reset: the cadence is an average, so a one-second
            // tick does not stretch a 1.2 s pair into two ticks of dwell.
            train.doorT[d] += CABIN_ALIGHT_PAIR_S
            // The rows behind shuffle up to the doorway they just left.
            for (const id of queue) {
              const a = this.pool.all().get(id)
              if (a && !a.dead) a.trainRow--
            }
          }
        }
      }
      // A clear doorway boards. Anyone still stepping out is still in it.
      if (s.rate <= 0 && train.cabinRows[d] === 0 && train.inFlight[d] === 0) {
        s.rate = DOOR_RATE
      }
    }
  }

  /** Send a passenger out of the cabin: a step from its slot to the doorway node. */
  private stepOut(train: Train, a: Agent, node: number): void {
    const g = this.graph
    a.trainPhase = 2
    a.trainT = 0
    a.rideFromX = a.x
    a.rideFromY = a.y
    a.rideFromZ = a.z
    // Two abreast leave abreast: the pair steps out either side of the doorway's
    // centre rather than onto one point, where the renderer would draw one body.
    const at = this.trainAt(train, this.poseScratch)
    const along = at ? a.trainFile * CABIN_PAIR_HALF : 0
    a.rideToX = g.nodeX[node] + (at ? along * at.fx : 0)
    a.rideToY = g.nodeY[node] + (at ? along * at.fy : 0)
    a.rideToZ = g.nodeZ[node]
  }

  /** Take a boarding passenger into the cabin, behind the alighting queue. */
  private boardRider(a: Agent, s: ServerDef): void {
    const train = this.trains.find((t) => t.doors.includes(s.id))
    if (!train) {
      // A doorway with no consist behind it (the train departed mid-service):
      // the passenger has boarded something that is not there, and leaves.
      a.dead = true
      return
    }
    const door = train.doors.indexOf(s.id)
    const k = train.boardings[door]++
    a.train = train.id
    a.trainDoor = door
    a.trainFile = k % 2 === 0 ? -1 : 1
    // Behind the wave that is getting off, so the two streams never share a slot.
    a.trainRow = train.cabinDepth[door] + Math.floor(k / 2)
    a.trainPhase = 0
    a.trainT = 0
    a.rideFromX = a.x
    a.rideFromY = a.y
    a.rideFromZ = a.z
    a.state = STATE_RIDING
    a.server = -1
    train.onboard++
  }

  /**
   * Pin a passenger to the consist it is riding in: stepping in from the
   * platform, standing in the cabin (and shuffling up as the queue ahead of it
   * leaves), or stepping out onto the platform. A rider is never routed by the
   * station's crowd — it moves with its train.
   */
  private stepTrainRider(a: Agent): void {
    const train = this.trains.find((t) => t.id === a.train)
    if (!train) {
      // Its consist left the world (or was edited away): nobody is left riding.
      a.dead = true
      a.train = -1
      return
    }
    const slot = this.cabinWorldPos(train, a.trainDoor, a.trainFile, a.trainRow)
    if (!slot) {
      a.dead = true
      a.train = -1
      return
    }
    if (a.trainPhase === 0) {
      // Stepping in: from where the doorway left the passenger to its slot.
      a.trainT += SIM_DT
      const k = clamp(a.trainT / TRAIN_STEP_S, 0, 1)
      a.x = a.rideFromX + (slot[0] - a.rideFromX) * k
      a.y = a.rideFromY + (slot[1] - a.rideFromY) * k
      a.z = a.rideFromZ + (slot[2] - a.rideFromZ) * k
      if (k >= 1) a.trainPhase = 1
      return
    }
    if (a.trainPhase === 1) {
      // Standing, and easing into place after the queue ahead of it moved up.
      const k = clamp(SIM_DT / 0.35, 0, 1)
      a.x += (slot[0] - a.x) * k
      a.y += (slot[1] - a.y) * k
      a.z += (slot[2] - a.z) * k
      return
    }
    // Stepping out: from the slot to the doorway node, then a walker like anyone
    // else. The consist is standing at its mark with the doors open, so the
    // target cannot move under the step.
    a.trainT += SIM_DT
    const k = clamp(a.trainT / TRAIN_STEP_S, 0, 1)
    a.x = a.rideFromX + (a.rideToX - a.rideFromX) * k
    a.y = a.rideFromY + (a.rideToY - a.rideFromY) * k
    a.z = a.rideFromZ + (a.rideToZ - a.rideFromZ) * k
    if (k < 1) return
    train.inFlight[a.trainDoor] = Math.max(0, train.inFlight[a.trainDoor] - 1)
    train.alighted++
    this.metrics.alighted++
    a.train = -1
    a.trainDoor = -1
    a.trainPhase = 0
    a.state = STATE_WALKING
    a.server = -1
    // The trip is a platform arrival's: origin 'train:<line>', then its stops
    // and destination, walked from the doorway it stepped onto.
    this.startLeg(a)
  }

  /**
   * Closed doors clear everyone still aboard before departure: the boarders ride out
   * (they boarded it), and a member of the wave that never got off is stranded
   * on the train — the one way an arrival is lost.
   */
  private emptyTrain(train: Train): void {
    for (const a of this.pool.live) {
      if (a.train !== train.id) continue
      this.pool.kill(a)
      if (a.state === STATE_ALIGHTING) this.metrics.leftBehind++
    }
    for (let d = 0; d < train.cabins.length; d++) {
      train.cabins[d].length = 0
      train.inFlight[d] = 0
    }
    // Whatever is still on `alightLeft` never even reached the cabin.
    this.metrics.leftBehind += Math.max(0, train.alightLeft)
    train.alightLeft = 0
    train.onboard = 0
  }

  /**
   * Where each (line, track) service runs, derived from its own track and the
   * platform edges beside it. This is the only geometry the renderer needs
   * to draw rolling stock, so it stays a pure function of the station. The track
   * carries its own orientation, so a north–south line travels in y.
   */
  private computeLineAnchors(): void {    this.lineAnchors.clear()
    for (const line of this.data.lines) {
      for (const track of this.serviceTracks(line.id)) {
        // A line needs a track to run on; the platform edge is only needed for
        // boarding. Decoupling them means a freshly laid rail gets a train right
        // away, even before a platform and its screen doors exist.
        const rot = track.rot ?? 0
        const [fx, fy] = trackFacing(rot)
        const width = STOCK[line.stock].width * trainScaleForStorey(this.data.storeyHeight)
        // Work in the track's local frame: u runs along the bed, v across it. The
        // bed spans v ∈ [0, d]; the platform edge (if any) sits at v = −1 or d.
        // `side` names the side the track lies on from the screen's frame, so
        // 'left' means the platform is beyond the bed at v = +d.
        const trackDir = track.cfg.dir ?? line.direction
        const v = trackTrainCentreV(track, width, this.data.modules.filter((m) => m.type === 'platform-edge'), line.direction)
        // Rotate about the first cell's centre, like the track and PSD models
        // (§1.13). Rotating the cell corner instead shifts a turned berth by
        // up to one metre and separates the train doors from their screens.
        const [ox, oy] = rotateLocal(rot, (track.w - 1) / 2, v - 0.5)
        const x = track.x + 0.5 + ox
        const y = track.y + 0.5 + oy
        // A train rides the rail surface: the recessed bed slab sits half a metre
        // below the platform, so the consist drops with it.
        const z = track.z + trainOriginForScale(trainScaleForStorey(this.data.storeyHeight))
        // The track's own 上行/下行 picks which way along the run the train moves;
        // an unset track falls back to the line's travel sign. This is what the
        // placement preview's direction arrows show.
        const dirSign = track.cfg.dir ? (track.cfg.dir === 'down' ? -1 : 1) : (line.travelSign ?? 1) >= 0 ? 1 : -1
        const colour = parseInt(line.colour.replace('#', ''), 16) || 0x1f5fd0
        // Screen doors decide which door banks may open (§1.13): a side with no
        // platform-edge run has no screen, so its doors stay shut. Only the
        // edges derived from this rail count — the platform the consist is
        // actually berthed at — so the two directions keep their own banks.
        // Edges that predate `cfg.from` match by direction instead.
        let doorSides = 0
        let dirSides = 0
        for (const m of this.data.modules) {
          if (m.type !== 'platform-edge' || m.cfg.line !== line.id) continue
          const bit = m.cfg.side === 'left' ? 1 : 2
          if (m.cfg.from === track.id) doorSides |= bit
          else if (!m.cfg.from && m.cfg.dir === trackDir) dirSides |= bit
        }
        if (doorSides === 0) doorSides = dirSides
        // The consist runs the whole connected rail: it comes in from beyond the
        // entrance end and leaves through the far one, so a built tunnel / bridge
        // is traversed end to end.
        const run = this.connectedRun(track)
        const approachRun = dirSign >= 0 ? run.back : run.fwd
        const departRun = dirSign >= 0 ? run.fwd : run.back
        this.lineAnchors.set(trainKey(line.id, track.id), { x, y, z, fx, fy, yaw: Math.atan2(fy, fx), dirSign, cars: line.cars, stock: line.stock, colour, doorSides, approachRun, departRun })
      }
    }
  }

  /**
   * How far the berth sits from each end of the rail the consist can actually
   * run on: the collinear, bed-sharing runs of the same line — the platform
   * track and every 隧道 / 轨道桥 grown off it — merged into one chain. The old
   * choreography ran only `consist + 25 m`, so a consist vanished beside the
   * platform however long the connected tunnel or bridge was; these ends let
   * `trainAt` run it in from beyond the entrance portal and out through the
   * far one.
   *
   * `back`/`fwd` are metres along the track's local +x, both measured from the
   * berth (the bed centre, which sits half a cell in from the origin corner).
   */
  private connectedRun(track: TrackModule): { back: number; fwd: number } {
    const rot = normRot(track.rot)
    const [fx, fy] = trackFacing(rot)
    const [sx, sy] = trackSide(rot)
    const d0 = track.d ?? 1
    const centre = track.w / 2
    // The run-axis spans (cell units from this track's origin) of every rail that
    // shares the bed: same line, storey and axis, with an across-span that
    // overlaps this one's. Its own span is the seed of the chain.
    const spans: Array<[number, number]> = []
    for (const m of this.data.modules) {
      if (m.type !== 'track' || m.cfg.line !== track.cfg.line || m.z !== track.z) continue
      if (normRot(m.rot) !== rot) continue
      const dx = m.x - track.x
      const dy = m.y - track.y
      const across = dx * sx + dy * sy
      if (across >= d0 || across + (m.d ?? 1) <= 0) continue
      const u = dx * fx + dy * fy
      spans.push([u, u + m.w])
    }
    spans.sort((a, b) => a[0] - b[0])
    // Grow the chain over every span that touches it; sorted by start, a run that
    // only meets the far end after the chain grew is reached on its own turn. A
    // gap (a separate track with no rail between) is left out.
    let lo = 0
    let hi = track.w
    for (const [u0, u1] of spans) {
      if (u0 > hi || u1 < lo) continue
      lo = Math.min(lo, u0)
      hi = Math.max(hi, u1)
    }
    return { back: centre - lo, fwd: hi - centre }
  }

  /**
   * The berth anchor a consist runs from: its own (line, track), or — for a
   * consist whose track was edited out from under it — the line's remaining
   * anchor, so it keeps its pose until it departs instead of vanishing mid-run.
   */
  private trainAnchor(train: Train): LineAnchor | null {
    const own = this.lineAnchors.get(trainKey(train.line, train.track))
    if (own) return own
    for (const [k, v] of this.lineAnchors) {
      if (k.startsWith(train.line + '|')) return v
    }
    return null
  }

  /**
   * Where a consist actually is this tick: its berth anchor plus the run-in /
   * run-out easing. `trainRenderState` and the people riding in the cabin both
   * read this, so a passenger aboard can never drift off its own train.
   */
  private trainAt(train: Train, out: TrainAt): TrainAt | null {
    const a = this.trainAnchor(train)
    if (!a) return null
    const half = (STOCK[a.stock].length * a.cars * trainScaleForStorey(this.data.storeyHeight)) / 2
    let offset = 0
    if (train.state === 'approach') {
      // Ease out: fast down the tunnel, slowing to a stop at the mark. The
      // consist starts beyond the entrance end of its connected rail, so it
      // emerges from the tunnel / off the bridge rather than popping into being
      // over the platform — and its last drawn frame lands on the mark, so it is
      // standing still by the tick the berth (and its seating wave) begins.
      const q = approachProgress(train.t)
      offset = -(1 - q) * (1 - q) * (half + a.approachRun) * a.dirSign
    } else if (train.state === 'depart') {
      // Ease in: pull away gently, then run up to speed, only leaving the world
      // once the tail is out through the far end of the connected rail.
      const p = Math.min(1, train.t / TRAIN_DEPART_S)
      offset = p * p * (half + a.departRun) * drawnRunScale(TRAIN_DEPART_S) * a.dirSign
    }
    out.x = a.x + offset * a.fx
    out.y = a.y + offset * a.fy
    out.z = a.z
    out.fx = a.fx
    out.fy = a.fy
    return out
  }

  /**
   * One pose per live train, stride 10: x, y, z, cars, stock index (A/B/C/L),
   * doors-open, line colour, direction, yaw, door/power flags. A pure function of
   * train state, so it adds no randomness and cannot disturb §7.6 determinism.
   * Bits 0–1 are `LineAnchor.doorSides`; bit 2 selects catenary pickup. The
   * renderer slides only leaves whose screen doors exist (§1.13).
   *
   * `doors-open` is the leaves' commanded position: open over the opening and
   * dwell phases, shut over the closing phase — the phase the sim itself shuts
   * them in. The renderer's leaf travel then finishes exactly as the closing
   * phase ends, so the riders cleared at the hold leave a sealed car rather than
   * one whose doors are still wide.
   */
  trainRenderState(): Float32Array {
    const STRIDE = 10
    const out = new Float32Array(this.trains.length * STRIDE)
    let k = 0
    for (const train of this.trains) {
      const a = this.trainAnchor(train)
      if (!a) continue
      const at = this.trainAt(train, this.poseScratch)
      if (!at) continue
      out[k++] = at.x
      out[k++] = at.y
      out[k++] = at.z
      out[k++] = a.cars
      out[k++] = STOCK_CLASSES.indexOf(a.stock)
      out[k++] = train.state === 'opening' || train.state === 'dwell' ? 1 : 0
      out[k++] = a.colour
      out[k++] = a.dirSign
      out[k++] = a.yaw
      // Bits 0–1 open door banks; bit 2 selects the overhead-wire roof variant.
      out[k++] = a.doorSides | (this.lineById.get(train.line)?.power === 'catenary' ? 4 : 0)
    }
    return out.subarray(0, k)
  }

  /**
   * One pose per elevator car, stride 7: plan x, plan y, lower cell z, upper
   * cell z, cabin floor height, door-open fraction, and the doors the stop opens
   * (bit 1 front / local −y, bit 2 back / local +y). The renderer matches a car
   * to its shaft by the first three numbers, then moves the cabin and slides the
   * doors on the sides the car is serving. A pure function of car state, so §7.6
   * determinism is untouched.
   */
  liftRenderState(): Float32Array {
    const out: number[] = []
    for (const s of this.graph.servers) {
      if (s.kind !== 'lift' || !s.lift) continue
      const c = s.lift
      const node = c.stops[c.at] ?? -1
      // A `both` level opens front **and** back together; a single-side level
      // uses the landing it was assigned. The mask, not the stop node's row, is
      // what the renderer opens.
      const side = node >= 0 ? liftDoorSideMask({ doors: c.doors }, this.graph.nodeZ[node] - 1) : 1
      out.push(c.x, c.y, c.fromZ, c.toZ, c.z, c.door, side)
    }
    return Float32Array.from(out)
  }

  /* ------------------------------------------------------------- servers */

  private stepServers(): void {
    const dt = SIM_DT
    const servers = this.graph.servers
    for (let i = 0; i < servers.length; i++) {
      const s = servers[i]
      if (s.rate <= 0) continue
      if (s.kind === 'lift') {
        this.stepLift(s, dt)
        continue
      }
      if (s.kind === 'gate') {
        this.stepGate(s, dt)
        continue
      }
      if (s.kind === 'stop' && s.stop) {
        for (let q=0;q<s.queue.length;q++) {
          const person=this.pool.all().get(s.queue[q])
          if (person) person.stopQueueRank=q+(s.activeCustomer === undefined ? 0 : 1)
        }
        const customer = s.activeCustomer === undefined ? undefined : this.pool.all().get(s.activeCustomer)
        if (customer && !customer.dead && customer.activeStop === s.stop.id) {
          s.cooldown = customer.timer
          continue
        }
        s.activeCustomer = undefined
        s.cooldown = 0
        while (s.queue.length && !this.pool.all().has(s.queue[0])) s.queue.shift()
        const head = this.pool.all().get(s.queue[0])
        if (head && Math.hypot(head.x-s.stop.x!,head.y-s.stop.y!) < .22) {
          s.queue.shift()
          this.serve(head,s)
        }
        continue
      }
      // The server owns the whole tick's worth of service capacity: at 75/min
      // and a 1 s step that is 1-2 people, but the loop is what makes the rate
      // correct at any step size.
      s.cooldown -= dt
      while (s.cooldown <= 0 && s.queue.length > 0) {
        const traffic = s.ramp?.traffic
        if (traffic && traffic.direction !== s.id && traffic.until > this.simTime) {
          s.cooldown = 0
          break
        }
        const head = this.pool.all().get(s.queue[0])
        if (s.kind === 'door' && head && !head.dead &&
          Math.hypot(head.x - this.graph.nodeX[s.node], head.y - this.graph.nodeY[s.node]) > PLATFORM_BOARD_APPROACH) {
          // A spread-out platform queue walks to the open door before boarding.
          s.cooldown = 0
          break
        }
        const id = s.queue.shift() as number
        const a = this.pool.all().get(id)
        if (!a || a.dead) {
          s.cooldown += 1 / s.rate
          continue
        }
        this.serve(a, s)
        s.cooldown += 1 / s.rate
      }
      if (s.cooldown < 0 && s.queue.length === 0) s.cooldown = 0
      if (s.cooldown < -dt) s.cooldown = -dt
    }
  }

  /**
   * A fare gate. A one-way gate serves only the direction it is built for; a
   * two-way gate is one lane, so the first agent to reach an idle lane fixes
   * the direction and the lane stays that way until no agent of that direction
   * is left to pass — first come, first served (§7.1). Agents of the blocked
   * direction simply keep waiting behind it; the lane releases the moment its
   * side drains, so the other direction gets its turn.
   */
  private stepGate(s: ServerDef, dt: number): void {
    s.cooldown -= dt
    const mode = s.gateMode ?? 'both'
    const pool = this.pool.all()
    while (s.cooldown <= 0 && s.queue.length > 0) {
      const idx = this.pickGateAgent(s, mode, pool)
      if (idx < 0) {
        // Nobody of the committed direction is queued: release the lane so the
        // next arrival (first come) can claim it.
        s.lane = 0
        break
      }
      const id = s.queue.splice(idx, 1)[0]
      const a = pool.get(id)
      if (!a || a.dead) {
        s.cooldown += 1 / s.rate
        continue
      }
      if (mode === 'both') s.lane = a.gateDir
      this.serve(a, s)
      s.cooldown += 1 / s.rate
    }
    if (s.cooldown < 0 && s.queue.length === 0) s.cooldown = 0
    if (s.cooldown < -dt) s.cooldown = -dt
  }

  /** Queue index of the next agent the gate may serve, or -1. */
  private pickGateAgent(s: ServerDef, mode: ServerDef['gateMode'], pool: Map<number, Agent>): number {
    const lane = s.lane ?? 0
    for (let i = 0; i < s.queue.length; i++) {
      const a = pool.get(s.queue[i])
      // A dead entry must be pulled out by the caller, whatever the direction.
      if (!a || a.dead) return i
      if (gateLaneAllows(mode ?? 'both', lane, a.gateDir)) return i
    }
    return -1
  }

  /**
   * An elevator car. One shaft has one car: it parks at a floor, opens its
   * doors, waits while the crowd walks in and out, shuts, then travels to the
   * next called floor. Passengers aboard are `STATE_RIDING` and are pinned to
   * the cabin by `stepLiftRide`, so they really move with it — the ride is not a
   * teleport. The whole shaft is a single server; its stops and riders live on
   * `s.lift` (see `buildGraph`).
   */
  private stepLift(s: ServerDef, dt: number): void {
    const car = s.lift
    if (!car) return
    switch (car.phase) {
      case 'idle': {
        if (car.riders.length > 0) {
          // Leftover riders (a multi-stop trip): head for the next destination.
          this.startLiftMove(car, this.nextRiderStop(car))
          return
        }
        const call = this.nextLiftCall(s, car)
        if (call < 0) return
        if (call === car.at) {
          car.phase = 'open'
          car.t = 0
          car.door = 0
        } else {
          this.startLiftMove(car, call)
        }
        return
      }
      case 'move': {
        car.moveT += dt
        const k = clamp(car.moveT / car.moveTotal, 0, 1)
        // Ease in/out, so the cabin accelerates and settles instead of sliding
        // at a constant speed and stopping dead.
        const e = k * k * (3 - 2 * k)
        car.z = car.stopZ[car.legFrom] + (car.stopZ[car.legTo] - car.stopZ[car.legFrom]) * e
        if (k >= 1) {
          car.at = car.legTo
          car.z = car.stopZ[car.legTo]
          car.phase = 'open'
          car.t = 0
          car.door = 0
        }
        return
      }
      case 'open': {
        if (car.door < 1) {
          car.door = Math.min(1, car.door + dt / LIFT_DOOR_S)
          return
        }
        car.t += dt
        this.liftExchange(s, car)
        if (car.t >= LIFT_DWELL_S) {
          car.phase = 'close'
          car.t = 0
        }
        return
      }
      case 'close': {
        car.door = Math.max(0, car.door - dt / LIFT_DOOR_S)
        if (car.door <= 0) {
          car.phase = 'idle'
          car.t = 0
        }
        return
      }
    }
  }

  /** Begin travelling to `target` from the car's current stop. */
  private startLiftMove(car: NonNullable<ServerDef['lift']>, target: number): void {
    car.legFrom = car.at
    car.legTo = target
    car.moveT = 0
    const dist = Math.abs(car.stopZ[target] - car.stopZ[car.at])
    car.moveTotal = Math.max(1.5, dist / LIFT_SPEED)
    car.phase = 'move'
  }

  /**
   * The stop a waiting passenger wants the car to collect them at. The queue is
   * scanned front to back — first come, first served — so the car never starves
   * the passenger who has waited longest. -1 when nobody is waiting.
   */
  private nextLiftCall(s: ServerDef, car: NonNullable<ServerDef['lift']>): number {
    const pool = this.pool.all()
    for (let i = 0; i < s.queue.length; i++) {
      const a = pool.get(s.queue[i])
      if (!a || a.dead) continue
      const idx = car.stops.indexOf(a.liftBoard)
      if (idx >= 0) return idx
    }
    return -1
  }

  /** The next stop a rider aboard wants, or the current stop if none. */
  private nextRiderStop(car: NonNullable<ServerDef['lift']>): number {
    const pool = this.pool.all()
    for (const id of car.riders) {
      const a = pool.get(id)
      if (!a || a.dead) continue
      const idx = car.stops.indexOf(a.liftDest)
      if (idx >= 0 && idx !== car.at) return idx
    }
    return car.at
  }

  /**
   * With the doors open at a stop: let every rider bound here step out (they
   * walk to the landing, then continue their path), then let the waiting crowd
   * at this floor step in, up to the car's batch.
   */
  private liftExchange(s: ServerDef, car: NonNullable<ServerDef['lift']>): void {
    const g = this.graph
    const stop = car.stops[car.at]
    const pool = this.pool.all()
    const remaining: number[] = []
    for (const id of car.riders) {
      const a = pool.get(id)
      if (!a || a.dead) continue
      if (a.liftDest !== stop) {
        remaining.push(id)
        continue
      }
      // Start the step-out: interpolate from the cabin to the landing node.
      a.liftPhase = 2
      a.liftT = 0
      a.server = -1
      a.rideFromX = a.x
      a.rideFromY = a.y
      a.rideFromZ = a.z
      a.rideToX = g.nodeX[stop]
      a.rideToY = g.nodeY[stop]
      a.rideToZ = g.nodeZ[stop]
    }
    car.riders = remaining
    let filled = car.riders.length
    for (let i = 0; i < s.queue.length && filled < s.batch; ) {
      const a = pool.get(s.queue[i])
      if (!a || a.dead) {
        s.queue.splice(i, 1)
        continue
      }
      if (a.liftBoard !== stop) {
        i++
        continue
      }
      s.queue.splice(i, 1)
      // The first boarding rider for a new destination selects it; following
      // riders to that floor simply board. One press does not delay the car.
      const selects = !car.riders.some(id => pool.get(id)?.liftDest === a.liftDest)
      car.riders.push(a.id)
      if (selects && filled === 0 && !passengerIsChild(a.id)) {
        a.activity = 8; a.activityStart = this.tick + LIFT_BOARD_S; a.activityTotal = 5
        const [fx,fy] = liftDoorDir(car.rot)
        a.activityYaw = Math.atan2(fy,fx)
      }
      a.liftServer = s.id
      a.liftPhase = 0
      a.liftT = 0
      a.liftSlot = filled
      a.rideFromX = a.x
      a.rideFromY = a.y
      a.rideFromZ = a.z
      a.server = s.id
      a.state = STATE_RIDING
      filled++
    }
  }

  /** Pin a rider to the cabin, or walk the passenger in/out of it. */
  private stepLiftRide(a: Agent): void {
    const s = this.graph.servers[a.liftServer]
    const car = s?.lift
    if (!car) {
      a.state = STATE_WALKING
      a.server = -1
      a.liftServer = -1
      return
    }
    const [slotX, slotY] = liftSlotOffset(a.liftSlot, car.size)
    const [sx, sy] = rotateLocal(car.rot,slotX,slotY)
    // The carriage is centred in its own plan footprint: 1.5 m inside the
    // 2 × 2 小 assembly, 2.25 m inside the 3 × 3 大 one.
    const cabinX = car.x + car.size / 2 + sx
    const cabinY = car.y + car.size / 2 + sy
    if (a.liftPhase === 0) {
      // Stepping in: from where the queue left the passenger to its cabin slot.
      a.liftT += SIM_DT
      const k = clamp(a.liftT / LIFT_BOARD_S, 0, 1)
      a.x = a.rideFromX + (cabinX - a.rideFromX) * k
      a.y = a.rideFromY + (cabinY - a.rideFromY) * k
      a.z = car.z
      if (k >= 1) a.liftPhase = 1
      return
    }
    if (a.liftPhase === 1) {
      a.x = cabinX
      a.y = cabinY
      a.z = car.z
      return
    }
    // Stepping out: from the cabin to the landing node, then resume the path.
    a.liftT += SIM_DT
    const k = clamp(a.liftT / LIFT_BOARD_S, 0, 1)
    a.x = a.rideFromX + (a.rideToX - a.rideFromX) * k
    a.y = a.rideFromY + (a.rideToY - a.rideFromY) * k
    a.z = a.rideFromZ + (a.rideToZ - a.rideFromZ) * k
    if (k >= 1) {
      a.server = -1
      a.liftServer = -1
      a.liftBoard = -1
      a.liftDest = -1
      a.liftPhase = 0
      a.state = STATE_WALKING
      this.onArrive(a)
    }
  }

  /** Render state of every elevator car; see `World.liftRenderState`. */

  private serve(a: Agent, s: ServerDef): void {
    s.waitAccum += a.wait
    s.waitCount++
    a.server = -1
    a.rampApproach = undefined
    a.wait = 0
    a.patienceWait = 0
    if (s.exitNode >= 0) {
      const g = this.graph
      a.state = STATE_RIDING
      a.rideFromX = a.x
      a.rideFromY = a.y
      a.rideFromZ = a.z
      a.rideToX = g.nodeX[s.exitNode]
      a.rideToY = g.nodeY[s.exitNode]
      a.rideToZ = g.nodeZ[s.exitNode]
      a.rideTotal = Math.max(0.2, s.ride)
      a.rideT = a.rideTotal
      if (s.ramp) {
        const dx = g.nodeX[s.exitNode] - g.nodeX[s.node]
        const dy = g.nodeY[s.exitNode] - g.nodeY[s.node]
        const length = Math.hypot(dx, dy)
        const column = s.ramp.columns === 1 ? 0
          : s.kind === 'stair' ? RAMP_PASSENGER_COLUMN_SPACING / 2
          : (s.ramp.next++ % s.ramp.columns - (s.ramp.columns - 1) / 2) * RAMP_PASSENGER_COLUMN_SPACING
        const ox = s.ramp.dx + (length > 0 ? dy / length * column : 0)
        const oy = s.ramp.dy - (length > 0 ? dx / length * column : 0)
        a.rideFromX = g.nodeX[s.node] + ox
        a.rideFromY = g.nodeY[s.node] + oy
        a.rideFromZ = g.nodeZ[s.node]
        a.rideToX += ox
        a.rideToY += oy
        // stepRide advances a full tick after boarding. Preserve each service's
        // time within that tick so single-file riders never stack (§5.1).
        a.rideT += SIM_DT + s.cooldown
        if (s.ramp.traffic) {
          s.ramp.traffic.direction = s.id
          s.ramp.traffic.until = this.simTime + a.rideTotal + s.cooldown
        }
        a.x = a.rideFromX
        a.y = a.rideFromY
        a.z = a.rideFromZ
        if (s.kind === 'escalator' && !passengerIsChild(a.id) && activityChoice(a.id, 0x62a3) < .62) {
          a.activity = column > 0 ? 14 : 7
          a.activityVariant = (s.ramp.columns > 1 ? 1 : 0) + (a.rideToZ < a.rideFromZ ? 2 : 0)
          a.activityStart = this.tick; a.activityTotal = a.rideTotal
          a.activityYaw = Math.atan2(a.rideToY-a.rideFromY,a.rideToX-a.rideFromX)
        }
      }
    } else if (s.kind === 'door') {
      // Boarded: the passenger steps into the car and rides (§1.13), drawn in
      // the cabin until the consist leaves the world.
      this.metrics.boarded++
      this.boardRider(a, s)
    } else if (s.kind === 'stop') {
      a.state = s.stop && s.stop.kind!=='tvm' && s.stop.kind!=='vending' ? STATE_BROWSING : STATE_BUYING
      a.timer = (s.stop?.duration ?? 30) * (.8 + activityChoice(a.id, 0x3461) * .4)
      if (s.stop) {
        s.activeCustomer = a.id
        a.activeStop = s.stop.id
        a.x = s.stop.x!; a.y = s.stop.y!
        a.activity = s.stop.activity ?? 2; a.activityStart = this.tick
        a.activityTotal = a.timer; a.activityYaw = s.stop.yaw ?? 0
      }
    } else {
      a.state = STATE_WALKING
      if (s.kind === 'gate') {
        a.activity = activityChoice(a.id,0x23ad) < .4 ? 5 : 6
        a.activityStart = this.tick; a.activityTotal = 2
        const next = a.path[Math.min(a.pathIdx+1,a.path.length-1)]
        a.activityYaw = next === undefined ? Math.atan2(a.vy,a.vx) : Math.atan2(this.graph.nodeY[next]-a.y,this.graph.nodeX[next]-a.x)
        a.activityVariant = s.gateReader && (-Math.sin(a.activityYaw)*s.gateReader.x+Math.cos(a.activityYaw)*s.gateReader.y)<0 ? 1 : 0
      }
    }
  }

  private joinServer(a: Agent, serverId: number): void {
    const s = this.graph.servers[serverId]
    a.wait = 0
    a.rampApproach = undefined
    a.patienceWait = 0
    if (s.kind === 'gate') this.gateTraffic.join(a, s)
    a.server = serverId
    a.state = STATE_QUEUING
    a.timer = 0
    a.stopQueueRank = s.queue.length + (s.activeCustomer === undefined ? 0 : 1)
    s.queue.push(a.id)
    if (s.kind === 'door') {
      const nodes = this.waitingFloor(serverId)
      a.platformWaitNode = nodes.length > 0 ? nodes[(s.queue.length - 1) % nodes.length] : s.node
    }
  }

  private waitingFloor(server: number): Int32Array {
    let nodes = this.doorWaiting.get(server)
    if (!nodes) {
      const s = this.graph.servers[server]
      nodes = platformWaitingNodes(this.graph, s.node, s.platformInward)
      this.doorWaiting.set(server, nodes)
    }
    return nodes
  }

  /**
   * The neighbour node a queued passenger at a gate should wait beside: the one
   * whose direction from the gate best matches where the passenger is standing.
   * This holds the queue one cell out — outside the turnstile footprint — no
   * matter how a collision shove or a fare-line re-path placed the body.
   */
  private waitSideNode(a: Agent, gateNode: number): number {
    const g = this.graph
    const gx = g.nodeX[gateNode]
    const gy = g.nodeY[gateNode]
    const gz = g.nodeZ[gateNode]
    let best = -1
    let bestDot = 0
    for (let e = g.adjStart[gateNode]; e < g.adjStart[gateNode + 1]; e++) {
      const nb = g.adjTo[e]
      if (Math.abs(g.nodeZ[nb] - gz) > 0.01) continue
      const vx = g.nodeX[nb] - gx
      const vy = g.nodeY[nb] - gy
      const len = Math.hypot(vx, vy)
      if (len < 1e-6) continue
      const dot = ((a.x - gx) * vx + (a.y - gy) * vy) / len
      if (dot > bestDot) {
        bestDot = dot
        best = nb
      }
    }
    return best >= 0 ? best : gateNode
  }

  /**
   * A queued agent keeps wanting the entrance: it walks straight at the server
   * node on the shortest line to it, at its density-derated speed, and holds a
   * small standoff so it does not stand exactly on the node. It is the collision
   * pass, not a scripted lane, that turns the crowd into a disc of bodies pressed
   * toward the entrance — each blocked by the ones in front.
   *
   * A fare gate is the one server whose node is *inside* the thing being entered:
   * the node is the middle of the turnstile, so a queue pressed onto it would
   * stand in the lane. A gate queue is therefore anchored to the cell the
   * passenger approached from (`gateWaitNode`), so it forms just outside the
   * gate footprint and the leaf can cycle without anyone waiting inside it.
   */
  private stepQueue(a: Agent): void {
    a.vx = 0
    a.vy = 0
    if (a.server < 0) return
    const g = this.graph
    const s = g.servers[a.server]
    const node = s.kind === 'gate' && a.gateWaitNode >= 0 ? a.gateWaitNode : s.node
    // A lift queue waits on the landing, just in front of the cabin doors, so
    // the crowd visibly walks in when the car opens.
    let tx = s.kind === 'lift' && a.liftBoard >= 0 ? a.liftWaitX : g.nodeX[node]
    let ty = s.kind === 'lift' && a.liftBoard >= 0 ? a.liftWaitY : g.nodeY[node]
    if (s.stop) {
      const rank = a.stopQueueRank
      const yaw = s.stop.yaw ?? 0
      // Follow connected walk cells behind the customer. A wall ends the line;
      // it never projects a queue through walls or off the platform.
      const sign = s.stop.kind === 'bench' || s.stop.kind === 'cubicle' ? 1 : -1
      const desiredX = s.stop.x! + sign * Math.cos(yaw) * rank * .75
      const desiredY = s.stop.y! + sign * Math.sin(yaw) * rank * .75
      if (clearWalkSegment(g,a.x,a.y,desiredX,desiredY,a.z)) { tx = desiredX; ty = desiredY }
      else {
        const places=this.waitingFloor(s.id),place=rank>0&&places.length?places[(rank-1)%places.length]:node
        tx=g.nodeX[place];ty=g.nodeY[place]
      }
    }
    if (s.kind === 'door' && a.platformWaitNode >= 0) {
      // Only the head leaves its line when boarding begins. The other line
      // stays clear of the centre path used by alighting passengers.
      const approaching = s.rate > 0 && s.queue[0] === a.id
      const wait = approaching ? s.node : a.platformWaitNode
      if (clearWalkSegment(g, g.nodeX[s.node], g.nodeY[s.node], g.nodeX[wait], g.nodeY[wait], g.nodeZ[s.node])) {
        tx = g.nodeX[wait]
        ty = g.nodeY[wait]
      }
    }
    let detouring = false
    if (s.ramp && !rampMoveClear(g.rampWalls, a.x, a.y, tx, ty, Math.round(a.z) - 1)) {
      if (!a.rampApproach || !rampMoveClear(g.rampWalls, a.x, a.y, g.nodeX[a.rampApproach[0]], g.nodeY[a.rampApproach[0]], Math.round(a.z) - 1)) {
        a.rampApproach = this.recoverRampRoute(a, node) ?? undefined
      }
      if (!a.rampApproach) return
      while (a.rampApproach.length > 1 && Math.hypot(g.nodeX[a.rampApproach[0]] - a.x, g.nodeY[a.rampApproach[0]] - a.y) < 0.05) {
        a.rampApproach = a.rampApproach.subarray(1)
      }
      tx = g.nodeX[a.rampApproach[0]]
      ty = g.nodeY[a.rampApproach[0]]
      detouring = true
    } else {
      a.rampApproach = undefined
    }
    const dist = Math.hypot(tx - a.x, ty - a.y)
    const standoff = detouring ? 0 : s.stop ? .04 : PERSONAL_SPACE * 0.3
    if (dist > standoff) {
      const n = this.localDensity(a)
      const m2PerPax = n > 0 ? 12.57 / (n + 1) : 12.57
      const speed = a.speed * densityDerate(m2PerPax)
      const step = Math.min(speed * SIM_DT, dist - standoff)
      const inv = step / dist
      this.tryMove(a, a.x + (tx - a.x) * inv, a.y + (ty - a.y) * inv)
      a.z += (g.nodeZ[node] - a.z) * inv
    }
  }

  /**
   * One positional-relaxation pass over the whole crowd (§10.3). Every pair
   * closer than PERSONAL_SPACE pushes apart, so no body stands inside another;
   * a body pushed toward a wall is stopped at the edge and slides along it.
   * Walking, queuing and waiting agents are all included — the crowd resolves
   * itself the same way wherever it is.
   */
  private resolveCollisions(): void {
    const live = this.pool.live
    const W = this.cGridW
    const H = this.cGridH
    const band = W * H
    const ps2 = PERSONAL_SPACE * PERSONAL_SPACE
    for (let i = 0; i < live.length; i++) {
      const a = live[i]
      // A rider is inside a train, not standing on the floor: it neither pushes
      // the crowd nor is pushed by it (its consist holds it in place).
      if (a.dead || a.state === STATE_RIDING || a.train >= 0 || a.activeStop) continue
      const ax = a.x
      const ay = a.y
      const gx = Math.floor((ax - this.cGridMinX) / COLLISION_CELL)
      const gy = Math.floor((ay - this.cGridMinY) / COLLISION_CELL)
      const lz = this.levelBucket(a.z)
      let px = 0
      let py = 0
      for (let oy = -1; oy <= 1; oy++) {
        const yy = gy + oy
        if (yy < 0 || yy >= H) continue
        for (let ox = -1; ox <= 1; ox++) {
          const xx = gx + ox
          if (xx < 0 || xx >= W) continue
          const c = lz * band + yy * W + xx
          for (let k = this.cStart[c]; k < this.cStart[c + 1]; k++) {
            const b = live[this.cOrder[k]]
            if (b === a || b.dead || b.state === STATE_RIDING || b.train >= 0) continue
            const dx = ax - b.x
            const dy = ay - b.y
            const d2 = dx * dx + dy * dy
            if (d2 >= ps2) continue
            if (d2 < 1e-8) {
              // Perfectly coincident: spread along a fixed, id-derived angle.
              const ang = a.id * 2.399963229728653
              px += Math.cos(ang) * PERSONAL_SPACE * SEPARATION_RELAX
              py += Math.sin(ang) * PERSONAL_SPACE * SEPARATION_RELAX
              continue
            }
            const d = Math.sqrt(d2)
            const push = ((PERSONAL_SPACE - d) / d) * SEPARATION_RELAX
            px += dx * push
            py += dy * push
          }
        }
      }
      if (px === 0 && py === 0) continue
      const pm = Math.hypot(px, py)
      if (pm > SEPARATION_MAX) {
        px = (px / pm) * SEPARATION_MAX
        py = (py / pm) * SEPARATION_MAX
      }
      this.tryMove(a, ax + px, ay + py, true)
    }
  }

  /** Crowd shoves stay on floor and cannot push a body through a ramp rail (§10.3). */
  private tryMove(a: Agent, nx: number, ny: number, preserveApproach = false): void {
    const g = this.graph
    const floorZ = Math.round(a.z) - 1
    const node = g.nodeIndex.get(cellKey(Math.floor(nx), Math.floor(ny), floorZ))
    const inward = node === undefined ? undefined : this.platformFloor.get(node)
    if (inward && node !== undefined) {
      // A walkable edge tile includes floor beyond the rendered screen (0.34 m
      // from its centre). Keep ordinary bodies at the centre or further inland,
      // leaving that clearance for their shoulders. Train riders use their own
      // controlled threshold crossing, never this crowd movement path.
      const depth = (nx - g.nodeX[node]) * inward[0] + (ny - g.nodeY[node]) * inward[1]
      if (depth < 0) { nx -= depth * inward[0]; ny -= depth * inward[1] }
    }
    const target = a.server >= 0 && (g.servers[a.server].kind === 'escalator' || g.servers[a.server].kind === 'walkway' || g.servers[a.server].kind === 'stair')
      ? g.servers[a.server].node : a.state === STATE_WALKING ? a.path[a.pathIdx] : undefined
    const holdApproach = preserveApproach && target !== undefined &&
      rampMoveClear(g.rampWalls, a.x, a.y, g.nodeX[target], g.nodeY[target], floorZ)
    const clear = (x: number, y: number): boolean => this.onFloor(x, y, a.z) &&
      roadMoveClear(this.roads, a.x, a.y, x, y, floorZ) &&
      rampMoveClear(g.rampWalls, a.x, a.y, x, y, floorZ) &&
      (!holdApproach || rampMoveClear(g.rampWalls, x, y, g.nodeX[target!], g.nodeY[target!], floorZ))
    if (clear(nx, ny)) {
      a.x = nx
      a.y = ny
    } else if (clear(nx, a.y)) {
      a.x = nx
    } else if (clear(a.x, ny)) {
      a.y = ny
    }
  }

  /** True when the cell containing a point is walkable floor on its level. */
  private onFloor(x: number, y: number, z: number): boolean {
    const ix = Math.floor(x), iy = Math.floor(y)
    if (this.graph.nodeIndex.has(cellKey(ix, iy, Math.round(z) - 1))) return true
    // Turning stairs in a five-metre storey have a walkable half-storey landing
    // (2.5 m). Its graph node is keyed by the supporting floor at a half-integer
    // height, so integer-only rounding falsely treated that platform as a void.
    const halfStoreyFloor = Math.round((z - 1) * 2) / 2
    return !Number.isInteger(halfStoreyFloor) && this.graph.nodeIndex.has(cellKey(ix, iy, halfStoreyFloor))
  }

  /* --------------------------------------------------------------- agents */

  private moveAgents(): void {
    const live = this.pool.live
    // Grid and per-cell density from where the crowd stands at the top of the
    // tick; movement reads the density, the collision pass rebuilds the grid.
    this.buildCollisionGrid(live)
    this.computeCellDensity()
    // Price that crowd onto the graph before anything plans against it, so every
    // search this tick sees the same station.
    this.priceCongestion()
    this.gateTraffic.refresh(this.pool)
    this.gateReplans = 0
    this.rerouteReplans = 0
    this.crowdReplans = 0
    this.doorLoads.fill(0)
    for (const a of live) {
      if (!a.dead && a.train < 0 && a.door >= 0 && a.legs[a.legIdx]?.kind === 'line') this.doorLoads[a.door]++
    }
    // Resolve path requests first, in agent id order.
    this.processRepaths()

    for (let i = 0; i < live.length; i++) {
      const a = live[i]
      if (a.dead) continue
      if (a.awaitingPath) {
        a.vx = 0
        a.vy = 0
        continue
      }
      // A passenger aboard a consist moves with its train, never with the crowd:
      // stepping in, standing in the cabin, or stepping out onto the platform.
      if (a.train >= 0) {
        this.stepTrainRider(a)
        continue
      }
      switch (a.state) {
        case STATE_RIDING:
          this.stepRide(a)
          break
        case STATE_QUEUING:
        case STATE_WAITING:
          this.stepQueue(a)
          this.queueTime(a)
          break
        case STATE_BUYING:
        case STATE_BROWSING:
          a.vx = 0
          a.vy = 0
          a.timer -= SIM_DT
          if (a.timer <= 0) this.resumeLeg(a)
          break
        default:
          this.stepWalk(a)
          break
      }
    }
    // One collision pass over the whole crowd, after everyone has moved.
    this.buildCollisionGrid(live)
    this.resolveCollisions()
    this.holdPlatformQueuesClear()
    // The collision press can shove a gate queue into the turnstile itself; a
    // final pass holds it clear of the footprint.
    this.holdGateQueuesClear()
  }

  /**
   * Keep fare-gate queues out of the turnstile footprint. A gate's node sits in
   * the middle of its 1 m cell, so the collision press wants to pile bodies onto
   * the very spot the leaf swings through. This eases anyone shoved inside back
   * out along the radial from the node — on their own side of the fare line. The
   * passenger being served is WALKING, not queued, so it passes through freely.
   */
  private holdGateQueuesClear(): void {
    const g = this.graph
    for (let i = 0; i < g.servers.length; i++) {
      const s = g.servers[i]
      if (s.kind !== 'gate' || s.queue.length === 0) continue
      const gx = g.nodeX[s.node]
      const gy = g.nodeY[s.node]
      for (let q = 0; q < s.queue.length; q++) {
        const a = this.pool.all().get(s.queue[q])
        if (!a || a.dead) continue
        let dx = a.x - gx
        let dy = a.y - gy
        let d = Math.hypot(dx, dy)
        if (d >= GATE_CLEAR_RADIUS) continue
        if (d < 1e-4) {
          // Exactly on the node: back off toward the side it queued from.
          const wn = a.gateWaitNode
          dx = wn >= 0 ? g.nodeX[wn] - gx : 1
          dy = wn >= 0 ? g.nodeY[wn] - gy : 0
          d = Math.hypot(dx, dy) || 1
        }
        const k = GATE_CLEAR_RADIUS / d
        this.tryMove(a, gx + dx * k, gy + dy * k)
      }
    }
  }

  /** Keep closed-door queues behind the screen after crowd separation. */
  private holdPlatformQueuesClear(): void {
    const g = this.graph
    for (const s of g.servers) {
      if (s.kind !== 'door' || !s.platformInward) continue
      const [ix, iy] = s.platformInward
      const x = g.nodeX[s.node], y = g.nodeY[s.node]
      for (const id of s.queue) {
        const a = this.pool.all().get(id)
        if (!a || a.dead) continue
        if (s.rate > 0 && s.queue[0] === id) continue
        const depth = (a.x - x) * ix + (a.y - y) * iy
        if (depth < 0.9) this.tryMove(a, a.x + ix * (0.9 - depth), a.y + iy * (0.9 - depth))
      }
    }
  }

  private queueTime(a: Agent): void {
    a.wait += SIM_DT
    a.patienceWait += SIM_DT
    if (a.patienceWait <= a.patience) return
    const s = a.server >= 0 ? this.graph.servers[a.server] : null
    if (s && s.kind === 'door') {
      // Re-pick the cheapest door (§5.9).
      const idx = s.queue.indexOf(a.id)
      if (idx >= 0) s.queue.splice(idx, 1)
      a.server = -1
      a.wait = 0
      const leg = a.legs[a.legIdx]
      if (leg) {
        leg.node = -1
        a.door = -1
      }
      this.startLeg(a)
      return
    }
    if (s && s.kind === 'stop') {
      // Drop the stop, walk on.
      const idx = s.queue.indexOf(a.id)
      if (idx >= 0) s.queue.splice(idx, 1)
      a.server = -1
      a.comfort -= 0.1
      this.advanceLeg(a)
      return
    }
    // §7.2's other re-path trigger: a wait past patience re-picks the next-cheapest
    // edge. Keep the place when there is nothing better, and let the patience clock
    // start again rather than asking a synchronous search every tick.
    // A skipped search retries next tick; a completed check restarts patience
    // while preserving the total wait if the passenger keeps its queue place.
    if (s && (s.kind === 'gate' || s.kind === 'lift') && this.rerouteReplans >= REROUTE_REPLAN_PER_TICK) return
    const moved = this.reRouteAroundQueue(a, s)
    a.patienceWait = 0
    if (moved) a.wait = 0
  }

  /**
   * Take the next-cheapest edge instead of the queue the passenger is standing in
   * (§7.2). For a gate that is the next lane along the line, for a lift it is the
   * stair or the escalator beside it — the search the passenger would have run had
   * it known the queue when it set out (`chooseGate` runs it 8 m earlier; this is
   * the second chance for the queue that only formed once the crowd arrived).
   *
   * It only ever *moves* an agent whose new route queues at a different server. A
   * passenger that finds nothing better keeps its place in the queue it is already
   * in, instead of walking to the back of it: a step-free passenger in a lift
   * queue has nowhere else to be, and a lane whose neighbour is just as long is
   * not a reason to lose your spot.
   */
  private reRouteAroundQueue(a: Agent, s: ServerDef | null): boolean {
    if (!s || (s.kind !== 'gate' && s.kind !== 'lift')) return false
    // The lift is the only way down for a step-free passenger: re-planning would
    // hand back the same cabin every time.
    if (s.kind === 'lift' && a.needs.stepFree) return false
    if (a.destNode < 0 || a.awaitingPath) return false
    // Bound the synchronous searches (§7.2). A skipped passenger keeps its place
    // and its overdue patience clock, so the next tick can give it a turn.
    if (this.rerouteReplans >= REROUTE_REPLAN_PER_TICK) return false
    const from = s.kind === 'gate' && a.gateWaitNode >= 0
      ? a.gateWaitNode : this.nearestNode(a.x, a.y, a.z)
    if (from < 0 || from === a.destNode) return false
    this.rerouteReplans++
    const path = this.path.search(from, a.destNode, a.needs)
    if (!path || path.length === 0) return false
    if (this.firstQueueServer(path) === s.id) return false
    const idx = s.queue.indexOf(a.id)
    if (idx >= 0) s.queue.splice(idx, 1)
    if (s.kind === 'gate') this.gateTraffic.leave(a, s)
    a.server = -1
    a.liftBoard = -1
    a.liftDest = -1
    // The new approach is its own fare-line decision: let it re-choose a lane too.
    a.gateChosen = false
    a.path = path
    a.pathIdx = 0
    if (path.length === 1) this.onArrive(a)
    else a.state = STATE_WALKING
    return true
  }

  /**
   * The first server a route queues at — the gate, lane or ramp it is committed
   * to. `-1` when the walk queues nowhere.
   */
  private firstQueueServer(path: Int32Array): number {
    const g = this.graph
    for (let i = 0; i < path.length; i++) {
      const srv = g.serverForNode.get(path[i])
      if (srv === undefined) continue
      const kind = g.servers[srv].kind
      if (kind === 'gate' || kind === 'lift' || kind === 'escalator' || kind === 'walkway' || kind === 'stair') return srv
    }
    return -1
  }

  private stepRide(a: Agent): void {
    if (a.liftServer >= 0) {
      this.stepLiftRide(a)
      return
    }
    a.rideT -= SIM_DT
    const k = 1 - clamp(a.rideT / a.rideTotal, 0, 1)
    a.x = a.rideFromX + (a.rideToX - a.rideFromX) * k
    a.y = a.rideFromY + (a.rideToY - a.rideFromY) * k
    a.z = a.rideFromZ + (a.rideToZ - a.rideFromZ) * k
    if (a.rideT <= 0) {
      if (a.activity === 7 || a.activity === 14) a.activity = 0
      a.state = STATE_WALKING
      this.onArrive(a)
    }
  }

  private stepWalk(a: Agent): void {
    if (a.awaitingPath) return
    if (a.path.length === 0 || a.pathIdx >= a.path.length) {
      if (a.server < 0) {
        a.state = STATE_ARRIVING
        this.startLeg(a)
      }
      return
    }
    if (this.chooseGate(a)) return
    this.avoidCrowdedWalk(a)
    const g = this.graph
    const target = a.path[a.pathIdx]
    let steering = walkingLaneNode(g, a.path, a.pathIdx, a.id)
    if (steering !== target && (!clearWalkSegment(g, a.x, a.y, g.nodeX[steering], g.nodeY[steering], a.z) ||
      !rampMoveClear(g.rampWalls, a.x, a.y, g.nodeX[steering], g.nodeY[steering], Math.round(a.z) - 1) ||
      !roadMoveClear(this.roads, a.x, a.y, g.nodeX[steering], g.nodeY[steering], Math.round(a.z) - 1))) steering = target
    const tx = g.nodeX[steering]
    const ty = g.nodeY[steering]
    const tz = g.nodeZ[target]
    const previous = a.pathIdx > 0 ? a.path[a.pathIdx - 1] : target
    const floorCorridor = !g.serverForNode.has(target) && !g.serverForNode.has(previous) &&
      g.nodeZone[target] === g.nodeZone[previous] && Number.isInteger(tz) && Math.abs(a.z - tz) < 0.01
    // Crowd displacement (or a station edit) can put a rail between a body and
    // its next waypoint. Rejoin the graph on the reachable side (§7.2 / §10.3).
    if ((floorCorridor && !clearWalkSegment(g, a.x, a.y, tx, ty, a.z)) ||
      !roadMoveClear(this.roads, a.x, a.y, tx, ty, Math.round(a.z) - 1) || !rampMoveClear(g.rampWalls, a.x, a.y, tx, ty, Math.round(a.z) - 1)) {
      const path = this.recoverRampRoute(a, a.destNode)
      if (path) {
        a.path = path
        a.pathIdx = 0
        a.fromNode = path[0]
      }
      a.vx = 0
      a.vy = 0
      return
    }
    const dist = Math.hypot(tx - a.x, ty - a.y)

    // Density derate from the live neighbour count (§10.3). localDensity
    // counts within 2 m, so the area a single agent commands is pi*r^2.
    const n = this.localDensity(a)
    const m2PerPax = n > 0 ? 12.57 / (n + 1) : 12.57
    const speed = a.speed * densityDerate(m2PerPax)
    const budget = speed * SIM_DT

    if (dist <= budget || dist < ARRIVE) {
      // A gate joins its queue from outside the turnstile footprint, so a
      // waiting passenger is never snapped onto the node in the middle of the
      // lane; every other node is arrived at exactly.
      const srv = this.graph.serverForNode.get(target)
      const gateNode = srv !== undefined && this.graph.servers[srv].kind === 'gate'
      if (!gateNode) {
        this.tryMove(a, tx, ty)
        if (Math.hypot(tx - a.x, ty - a.y) > 1e-6) return
        a.z = tz
      }
      a.vx = 0
      a.vy = 0
      this.onArrive(a)
      return
    }
    const inv = budget / dist
    this.tryMove(a, a.x + (tx - a.x) * inv, a.y + (ty - a.y) * inv)
    a.z += (tz - a.z) * inv
    a.vx = ((tx - a.x) / Math.max(dist, 1e-6)) * speed
    a.vy = ((ty - a.y) / Math.max(dist, 1e-6)) * speed
  }

  private avoidCrowdedWalk(a: Agent): void {
    if (this.tick < a.crowdCheckTick || this.crowdReplans >= CROWD_REPLAN_PER_TICK) return
    const g = this.graph
    let start = a.pathIdx
    let node = a.path[start]
    // Turn only at a reached waypoint, so a new route never pulls a body
    // backwards through a wall or a handrail to its old start node.
    if (Math.hypot(a.x - g.nodeX[node], a.y - g.nodeY[node], a.z - g.nodeZ[node]) > ARRIVE) {
      if (start === 0) return
      node = a.path[--start]
      if (Math.hypot(a.x - g.nodeX[node], a.y - g.nodeY[node], a.z - g.nodeZ[node]) > ARRIVE) return
    }
    a.crowdCheckTick = this.tick + Math.ceil(CROWD_RECHECK_S / SIM_DT)
    const end = crowdedWalkEnd(this.path, a.path, start)
    if (end <= start + 1) return
    this.crowdReplans++
    const route = spreadWalkRoute(this.path, a.path, start, end, a.needs)
    if (!route) return
    a.path = route
    a.pathIdx = 0
    a.fromNode = route[0]
  }

  private recoverRampRoute(a: Agent, destination: number): Int32Array | null {
    if (destination < 0 || this.rerouteReplans >= REROUTE_REPLAN_PER_TICK) return null
    const g = this.graph
    const cx = Math.floor(a.x), cy = Math.floor(a.y), cz = Math.round(a.z) - 1
    let from = -1, best = Infinity
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const node = g.nodeIndex.get(cellKey(cx + dx, cy + dy, cz))
      if (node === undefined) continue
      const distance = Math.hypot(g.nodeX[node] - a.x, g.nodeY[node] - a.y)
      if (distance >= best || !roadMoveClear(this.roads, a.x, a.y, g.nodeX[node], g.nodeY[node], cz) || !rampMoveClear(g.rampWalls, a.x, a.y, g.nodeX[node], g.nodeY[node], cz)) continue
      best = distance
      from = node
    }
    if (from < 0) return null
    this.rerouteReplans++
    return this.path.search(from, destination, a.needs)
  }

  /**
   * The fare line is a decision point, not a waypoint. A cached path commits a
   * whole wave to the gate nearest the escalator while the queues it should
   * balance are still empty, so that gate jams and the rest of the line idles.
   *
   * The moment an agent *approaches* a gate it re-plans the rest of the leg
   * against the live queues and the live crowd, because walking a few metres
   * along the concourse beats queueing behind everyone else (§7.2) — and a
   * decision left to the last metre is not a decision at all: by the time the
   * gate is the very next node, the passenger is standing in the crush it should
   * have walked around. `GATE_LOOKAHEAD` metres out is where the choice is still
   * free, and `GATE_REPLAN_PER_TICK` rations the synchronous searches that buys;
   * an agent the ration skips retries next tick (`gateChosen` stays false) —
   * at the gate's own cell too, where a wave arriving together used to choose
   * all at once — so the wave spreads over ticks instead of stalling one.
   *
   * The re-plan deliberately skips the cache — it has to see the queues as they
   * are — and happens once per crossing, which the escalators already pace.
   */
  private chooseGate(a: Agent): boolean {
    if (a.gateChosen || a.destNode < 0) return false
    const g = this.graph
    // How far the passenger still has to walk before it is standing at a gate.
    let lead = 0
    let px = a.x
    let py = a.y
    let gateAt = -1
    for (let i = a.pathIdx; i < a.path.length; i++) {
      const n = a.path[i]
      lead += Math.hypot(g.nodeX[n] - px, g.nodeY[n] - py)
      px = g.nodeX[n]
      py = g.nodeY[n]
      const srv = g.serverForNode.get(n)
      if (srv !== undefined && g.servers[srv].kind === 'gate') {
        gateAt = i
        break
      }
      if (lead > GATE_LOOKAHEAD) break
    }
    if (gateAt < 0) return false
    if (gateAt !== a.pathIdx && lead > GATE_LOOKAHEAD) return false
    // Rationed for agents standing at the gate too: a wave arriving together
    // used to skip this check via `atGate` and run one synchronous search per
    // agent in the same tick. A skipped agent retries next tick (`gateChosen`
    // stays false), so the wave spreads over ticks instead of stalling one.
    if (this.gateReplans >= GATE_REPLAN_PER_TICK) {
      // Keep walking toward the decision point, but never join a stale gate
      // queue before the budget gives this passenger a live route check.
      if (gateAt === a.pathIdx) { a.vx = 0; a.vy = 0; return true }
      return false
    }
    this.gateReplans++
    a.gateChosen = true
    this.gateTraffic.release(a)
    let from = this.nearestNode(a.x, a.y, a.z)
    // Collision pressure can put the body nearest the gate node itself. Starting
    // A* there would skip its arrival charge and make that lane look free.
    const nearServer = this.graph.serverForNode.get(from)
    if (gateAt > 0 && nearServer !== undefined && this.graph.servers[nearServer].kind === 'gate') {
      from = a.path[gateAt - 1]
    }
    if (from < 0 || a.destNode < 0 || from === a.destNode) return true
    const path = this.path.search(from, a.destNode, a.needs)
    if (path && path.length > 0) {
      a.path = path
      a.pathIdx = 0
      if (path.length === 1) {
        this.onArrive(a)
        return true
      }
      a.state = STATE_WALKING
      this.gateTraffic.reserve(a)
      return false
    }
    return true
  }

  /**
   * Crowd count around an agent, read from the precomputed cell density. The
   * per-cell value is the number of bodies within ~2 m of the cell centre, so
   * this is O(1) instead of a scan of every body in a 6 m square — which is
   * what made a crush expensive.
   */
  private localDensity(a: Agent): number {
    const band = this.cGridW * this.cGridH
    return this.cellDensity[this.collisionCellIndex(a.x, a.y, a.z, band)]
  }

  /**
   * Precompute the crowd count within 2 m of every collision cell's centre,
   * from the current grid. Agents in the same cell share the value, so the work
   * is one pass over the non-empty cells instead of one scan per agent — which
   * is what made a crush expensive.
   */
  private computeCellDensity(): void {
    const W = this.cGridW
    const H = this.cGridH
    const band = W * H
    const dens = this.cellDensity
    const live = this.pool.live
    dens.fill(0)
    for (let lz = 0; lz < this.gridL; lz++) {
      const base = lz * band
      for (let gy = 0; gy < H; gy++) {
        for (let gx = 0; gx < W; gx++) {
          const c = base + gy * W + gx
          if (this.cStart[c + 1] === this.cStart[c]) continue
          const cx = this.cGridMinX + (gx + 0.5) * COLLISION_CELL
          const cy = this.cGridMinY + (gy + 0.5) * COLLISION_CELL
          let n = -1 // the agents in this cell count themselves out
          for (let oy = -2; oy <= 2; oy++) {
            const yy = gy + oy
            if (yy < 0 || yy >= H) continue
            for (let ox = -2; ox <= 2; ox++) {
              const xx = gx + ox
              if (xx < 0 || xx >= W) continue
              const nc = base + yy * W + xx
              for (let k = this.cStart[nc]; k < this.cStart[nc + 1]; k++) {
                const b = live[this.cOrder[k]]
                const dx = b.x - cx
                const dy = b.y - cy
                if (dx * dx + dy * dy < 4) n++
              }
            }
          }
          dens[c] = n
        }
      }
    }
  }

  /**
   * Price the crowd into the graph, node by node (§7.3). What a passenger has to
   * walk through is the bodies already standing there, and `waitQ` cannot see
   * them: a queue that has not formed at a server yet does not exist for A*, so
   * a route that is about to become a crush is still priced as empty floor.
   *
   * The bodies are scattered into their own cell and the ring around it, so a
   * node knows who is standing *beside* it — which is the whole case being
   * priced: the crowd pressed at a gate bank is on the tiles in front of the
   * gate, not inside it. Every node then reads its own cell, capped (past a
   * crush one more body is not another second of detour) and written onto the
   * path finder for every search this tick.
   */
  private priceCongestion(): void {
    const g = this.graph
    const W = this.cGridW
    const H = this.cGridH
    const band = W * H
    const near = this.crowdNear
    near.fill(0)
    const live = this.pool.live
    for (let i = 0; i < live.length; i++) {
      const a = live[i]
      // A rider is in a car, not on the floor: the platform beside a berthed
      // train must not be priced as a crush because the train is full.
      if (a.dead || a.train >= 0) continue
      const gx = Math.floor((a.x - this.cGridMinX) / COLLISION_CELL)
      const gy = Math.floor((a.y - this.cGridMinY) / COLLISION_CELL)
      const base = this.levelBucket(a.z) * band
      for (let oy = -2; oy <= 2; oy++) {
        const yy = gy + oy
        if (yy < 0 || yy >= H) continue
        for (let ox = -2; ox <= 2; ox++) {
          const xx = gx + ox
          if (xx < 0 || xx >= W) continue
          near[base + yy * W + xx]++
        }
      }
    }
    const out = this.path.congestion
    for (let n = 0; n < g.nodeCount; n++) {
      const bodies = near[this.collisionCellIndex(g.nodeX[n], g.nodeY[n], g.nodeZ[n], band)]
      out[n] = (bodies > CONGESTION_CAP ? CONGESTION_CAP : bodies) * CONGESTION_S
    }
  }

  private levelBucket(z: number): number {
    const span = Math.max(4, NEIGHBOUR_CELL * 2)
    let lz = Math.floor((z - this.gridMinZ) / span)
    if (lz < 0) lz = 0
    else if (lz >= this.gridL) lz = this.gridL - 1
    return lz
  }

  /**
   * Rebuild the fine collision grid from the current positions. It is built
   * after the movement pass, so it reflects where the crowd actually is now.
   * Riders aboard a consist are left out: they stand in a car, not on the floor,
   * so neither the separation pass nor the density derate may see them.
   */
  private buildCollisionGrid(live: readonly Agent[]): void {
    const n = live.length
    if (this.cOrder.length < n) this.cOrder = new Int32Array(Math.max(n, this.cOrder.length * 2))
    const counts = this.cCounts
    counts.fill(0)
    const W = this.cGridW
    const H = this.cGridH
    const band = W * H
    for (let i = 0; i < n; i++) {
      if (live[i].train >= 0) continue
      counts[this.collisionCellIndex(live[i].x, live[i].y, live[i].z, band)]++
    }
    let acc = 0
    const nb = band * this.gridL
    for (let c = 0; c < nb; c++) {
      this.cStart[c] = acc
      acc += counts[c]
    }
    this.cStart[nb] = acc
    const cursor = counts
    for (let c = 0; c < nb; c++) cursor[c] = this.cStart[c]
    for (let i = 0; i < n; i++) {
      const a = live[i]
      if (a.train >= 0) continue
      this.cOrder[cursor[this.collisionCellIndex(a.x, a.y, a.z, band)]++] = i
    }
  }

  private collisionCellIndex(x: number, y: number, z: number, band: number): number {
    let gx = Math.floor((x - this.cGridMinX) / COLLISION_CELL)
    let gy = Math.floor((y - this.cGridMinY) / COLLISION_CELL)
    const W = this.cGridW
    const H = this.cGridH
    if (gx < 0) gx = 0
    else if (gx >= W) gx = W - 1
    if (gy < 0) gy = 0
    else if (gy >= H) gy = H - 1
    return this.levelBucket(z) * band + gy * W + gx
  }

  /* --------------------------------------------------------- path & legs */

  private startLeg(a: Agent): void {
    if (a.legs.length === 0) {
      // Build the leg list: stops, then the destination.
      a.legs = []
      for (const s of a.trip.stops) a.legs.push({ node: -1, kind: 'stop', ref: s })
      const destKind = a.trip.dest.startsWith('line:') ? 'line' : 'exit'
      a.legs.push({ node: -1, kind: destKind, ref: a.trip.dest })
      a.legIdx = 0
    }
    const leg = a.legs[a.legIdx]
    if (!leg) {
      a.dead = true
      return
    }
    this.ensureLegNode(a, leg)
    a.fromNode = this.nearestNode(a.x, a.y, a.z)
    a.destNode = leg.node
    a.gateChosen = false
    if (a.fromNode < 0 || leg.node < 0) {
      // Unreachable or off-graph: give up on the trip.
      this.advanceLeg(a)
      return
    }
    if (a.fromNode === leg.node) {
      // Already standing on the destination (e.g. an agent spawned at its own
      // door): the leg is complete without a search.
      a.path = EMPTY_PATH
      a.pathIdx = 0
      a.awaitingPath = false
      this.onLegEnd(a)
      return
    }
    a.state = STATE_ARRIVING
    a.awaitingPath = true
    const path = this.path.request(a.id, a.fromNode, leg.node, a.needs)
    if (path) {
      a.path = path
      a.pathIdx = 0
      a.awaitingPath = false
      a.state = STATE_WALKING
      if (a.path.length === 1) this.onArrive(a)
    }
  }

  private ensureLegNode(a: Agent, leg: { node: number; kind: 'stop' | 'exit' | 'line'; ref: string }): void {
    if (leg.node >= 0) return
    const g = this.graph
    if (leg.kind === 'exit') {
      const id = leg.ref.startsWith('exit:') ? leg.ref.slice(5) : ''
      const e = g.exits.find((x) => x.id === id)
      leg.node = e ? e.node : g.nodeCount > 0 ? 0 : -1
    } else if (leg.kind === 'stop') {
      const id = leg.ref.startsWith('stop:') ? leg.ref.slice(5) : ''
      const s = g.stops.find((x) => x.id === id)
      leg.node = s ? s.node : -1
    } else {
      const lineId = leg.ref.startsWith('line:') ? leg.ref.slice(5) : ''
      const doors = this.doorsByLine.get(lineId) ?? []
      if (doors.length === 0) {
        leg.kind = 'exit'
        leg.ref = 'exit:' + this.pickExitId()
        const e = g.exits.find((x) => x.id === leg.ref.slice(5))
        leg.node = e ? e.node : -1
        return
      }
      let best = -1
      let bestScore = Infinity
      const from = this.nearestNode(a.x, a.y, a.z)
      for (const d of doors) {
        const s = g.servers[d]
        const dist = from >= 0 ? Math.hypot(g.nodeX[from] - g.nodeX[s.node], g.nodeY[from] - g.nodeY[s.node]) : 0
        // Include walkers already committed to a door: otherwise a whole wave
        // chooses the nearest door while every queue still looks empty (§5.9).
        const score = PLATFORM_DOOR_WALK_WEIGHT * dist + PLATFORM_DOOR_COMMIT_WEIGHT * this.doorLoads[d]
        if (score < bestScore || (score === bestScore && d < best)) {
          bestScore = score
          best = d
        }
      }
      if (best < 0) {
        leg.node = -1
        return
      }
      a.door = best
      this.doorLoads[best]++
      leg.node = g.servers[best].node
      a.servedFor = -1
    }
  }

  private advanceLeg(a: Agent): void {
    a.legIdx++
    a.path = EMPTY_PATH
    a.pathIdx = 0
    a.server = -1
    a.awaitingPath = false
    // If this is a new leg, the source is wherever we are now.
    this.startLeg(a)
  }

  private resumeLeg(a: Agent): void {
    if (a.activeStop) {
      const stop = this.graph.stops.find(s => s.id === a.activeStop)
      if (stop?.server !== undefined) this.graph.servers[stop.server].activeCustomer = undefined
    }
    a.activeStop = ''; a.activity = 0
    a.legIdx++
    a.path = EMPTY_PATH
    a.pathIdx = 0
    a.server = -1
    a.awaitingPath = false
    a.state = STATE_ARRIVING
    this.startLeg(a)
  }

  private onArrive(a: Agent): boolean {
    const g = this.graph
    const cur = a.path[a.pathIdx]
    if (cur === undefined) return true
    const doorYaw = this.doorGestures.get(cur)
    if (doorYaw !== undefined && this.tick-a.activityStart > 2) {
      const next = a.path[Math.min(a.pathIdx+1,a.path.length-1)]
      if (next !== undefined) {
        const dx = g.nodeX[next]-a.x,dy=g.nodeY[next]-a.y
        if (Math.abs(Math.cos(doorYaw)*dx+Math.sin(doorYaw)*dy) > .2) {
          a.activity=11;a.activityStart=this.tick;a.activityTotal=2;a.activityYaw=Math.atan2(dy,dx)
        }
      }
    }
    const gate = g.serverForNode.get(cur)
    if (gate !== undefined && a.servedFor !== gate && g.servers[gate].kind === 'gate') {
      a.servedFor = gate
      // Which way this walker crosses the fare line: from the zone it left to
      // the zone it is heading into, read off the path around the gate node.
      const prev = a.pathIdx > 0 ? a.path[a.pathIdx - 1] : -1
      const next = a.pathIdx + 1 < a.path.length ? a.path[a.pathIdx + 1] : -1
      a.gateDir = crossingDir(
        ZONES[prev >= 0 ? g.nodeZone[prev] : g.nodeZone[cur]],
        ZONES[next >= 0 ? g.nodeZone[next] : g.nodeZone[cur]],
      )
      // Wait outside the gate, on whichever side of the node the passenger is
      // actually standing when it reaches the queue.
      a.gateWaitNode = this.waitSideNode(a, cur)
      this.joinServer(a, gate)
      return true
    }
    a.pathIdx++
    if (a.pathIdx >= a.path.length) {
      this.onLegEnd(a)
      return true
    }
    const next = a.path[a.pathIdx]
    const e = this.findEdge(cur, next)
    if (e >= 0) {
      const kind = g.adjKind[e]
      const server = g.adjServer[e]
      if ((kind === EDGE_KIND.escalator || kind === EDGE_KIND.walkway || kind === EDGE_KIND.stair || kind === EDGE_KIND.lift) && server >= 0) {
        if (kind === EDGE_KIND.lift) {
          // Remember where this passenger boards and where the car should drop
          // them; a lift's car delivers each rider to its own floor.
          a.liftBoard = cur
          a.liftDest = next
          const car = g.servers[server].lift
          // The stop node is the landing tile in front of a door; stand the
          // queue just off the threshold (toward the landing, away from the car),
          // so the crowd visibly funnels through the doorway when it opens. A
          // through-floor has a landing on each face, so the outward direction is
          // read off whichever face this stop sits on, not just the front.
          const [fx, fy] = liftDoorDir(car?.rot ?? 0)
          const front = liftLandingSide(car ?? { x: 0, y: 0 }, g.nodeX[cur], g.nodeY[cur]) === 1
          const ox = front ? fx : -fx
          const oy = front ? fy : -fy
          a.liftWaitX = g.nodeX[cur] - ox * 0.45
          a.liftWaitY = g.nodeY[cur] - oy * 0.45
        }
        this.joinServer(a, server)
        return true
      }
    }
    a.state = STATE_WALKING
    return false
  }

  private onLegEnd(a: Agent): void {
    const leg = a.legs[a.legIdx]
    if (!leg) {
      a.dead = true
      return
    }
    if (leg.kind === 'exit') {
      a.dead = true
      this.metrics.exited++
      return
    }
    if (leg.kind === 'line') {
      if (a.door >= 0) {
        this.joinServer(a, a.door)
      } else {
        a.dead = true
      }
      return
    }
    // A stop: queue at a service point, or just dwell.
    const g = this.graph
    const stop = g.stops.find(s => 'stop:'+s.id === leg.ref)
    if (!stop) { this.advanceLeg(a); return }
    const srv = stop?.server ?? g.serverForNode.get(leg.node)
    if (srv !== undefined && g.servers[srv].kind === 'stop') {
      a.servedFor = srv
      this.joinServer(a, srv)
    } else {
      a.state = STATE_BROWSING
      a.timer = this.rng.range(45, 180)
    }
  }

  private processRepaths(): void {
    const done = this.path.process()
    for (const req of done) {
      const a = this.pool.all().get(req.agentId)
      if (!a || a.dead || !a.awaitingPath) continue
      if (a.destNode !== req.to || a.fromNode !== req.from) continue
      const path = this.path.cache.get(`${req.from}|${req.to}|${req.needs.stepFree ? 'S' : req.needs.luggage ? 'L' : 'N'}`)
      if (path) {
        a.path = path
        a.pathIdx = 0
        a.awaitingPath = false
        if (path.length === 1) this.onArrive(a)
        else a.state = STATE_WALKING
      } else {
        // No route exists: the agent cannot complete this trip.
        a.awaitingPath = false
        if (a.legs[a.legIdx]?.kind === 'stop') this.advanceLeg(a)
        else { a.dead = true; this.metrics.stuck++ }
      }
    }
  }

  private findEdge(from: number, to: number): number {
    const g = this.graph
    for (let e = g.adjStart[from]; e < g.adjStart[from + 1]; e++) {
      if (g.adjTo[e] === to) return e
    }
    return -1
  }

  /**
   * The walking route still ahead of one agent, as [x, y, z] waypoints, for the
   * 选择 tool's floor line: where the passenger stands now, the remaining nodes of
   * the leg it is walking, then every later leg it will **walk**.
   *
   * The chain stops at a train. Everything past a ride is another station's floor
   * — or the same station reached through a tunnel — and a line drawn straight
   * across the map would be a lie about a journey the floor cannot carry. So the
   * preview shows the walk, and ends where the passenger boards.
   *
   * Returns null when the agent is not in the world (it has left the station),
   * which is how the worker knows to drop the preview rather than draw an empty
   * one. Reading a route changes nothing: no agent field, no queue, no RNG, and
   * the A* searches it runs do not touch the shared path cache.
   */
  routeOf(agentId: number): Float32Array | null {
    const a = this.pool.all().get(agentId)
    if (!a || a.dead) return null
    const g = this.graph
    const head: number[] = [a.x, a.y, a.z]
    if (a.pathIdx < a.path.length) {
      for (let i = a.pathIdx; i < a.path.length; i++) {
        const n = a.path[i]
        head.push(g.nodeX[n], g.nodeY[n], g.nodeZ[n])
      }
    } else if (a.awaitingPath && a.destNode >= 0) {
      // A leg the sim has not handed a path for yet — the per-tick A* budget, which
      // a wave can spend over several ticks. The preview runs the same search itself
      // so the line does not blink off at the start of every leg; a read-only search,
      // neither cached nor queued nor counted against the budget.
      const from = this.nearestNode(a.x, a.y, a.z)
      const path = from >= 0 && from !== a.destNode ? this.path.search(from, a.destNode, a.needs) : null
      if (path) {
        for (let i = path[0] === from ? 1 : 0; i < path.length; i++) {
          const n = path[i]
          head.push(g.nodeX[n], g.nodeY[n], g.nodeZ[n])
        }
      }
    }
    const tail = this.routeTail(a)
    const out = new Float32Array(head.length + tail.length)
    out.set(head, 0)
    out.set(tail, head.length)
    return out
  }

  /**
   * The walk legs after the one being walked, chained node to node. Every later
   * leg starts where the one before it ended, so the pieces join as one line; a
   * leg with no route to it ends the preview rather than jumping the gap.
   */
  private routeTail(a: Agent): Float32Array {
    if (this.routeTailGraph !== this.graph) {
      this.routeTails.clear()
      this.routeTailGraph = this.graph
    }
    const key = `${a.id}|${a.legIdx}`
    const hit = this.routeTails.get(key)
    if (hit) return hit
    // The memo is a per-leg saving for the one passenger being watched, not a
    // cache of the station: past this many legs it is dropped whole, because the
    // oldest entries belong to passengers who have long since left the world.
    if (this.routeTails.size >= ROUTE_TAIL_MEMO_MAX) this.routeTails.clear()
    const g = this.graph
    const out: number[] = []
    // The leg being walked ends at `destNode` — the last node of its path, or the
    // node it is standing on when that path is already spent at a queue.
    let from = a.destNode >= 0 ? a.destNode : this.nearestNode(a.x, a.y, a.z)
    for (let li = a.legIdx + 1; from >= 0 && li < a.legs.length; li++) {
      const leg = a.legs[li]
      if (leg.kind === 'line') break
      const node = this.legEndNode(leg)
      if (node < 0) break
      if (node !== from) {
        const path = this.path.search(from, node, a.needs)
        if (!path || path.length === 0) break
        // A* answers start → goal, and the start is where the previous leg ended —
        // already the line's last waypoint, so it is not written twice.
        for (let i = path[0] === from ? 1 : 0; i < path.length; i++) {
          const n = path[i]
          out.push(g.nodeX[n], g.nodeY[n], g.nodeZ[n])
        }
      }
      from = node
    }
    const tail = Float32Array.from(out)
    this.routeTails.set(key, tail)
    return tail
  }

  /**
   * Where a leg the agent has not reached yet ends, read off the graph without
   * committing anything. `ensureLegNode` is the walking agent's own business — it
   * picks a platform door from the live queue lengths and writes the choice onto
   * the agent — so the preview resolves the leg kinds by lookup alone.
   */
  private legEndNode(leg: { node: number; kind: 'stop' | 'exit' | 'line'; ref: string }): number {
    if (leg.node >= 0) return leg.node
    const g = this.graph
    if (leg.kind === 'exit') {
      const id = leg.ref.startsWith('exit:') ? leg.ref.slice(5) : ''
      return g.exits.find((x) => x.id === id)?.node ?? -1
    }
    if (leg.kind === 'stop') {
      const id = leg.ref.startsWith('stop:') ? leg.ref.slice(5) : ''
      return g.stops.find((x) => x.id === id)?.node ?? -1
    }
    return -1
  }

  nearestNode(x: number, y: number, z: number): number {
    const g = this.graph
    const cx = Math.round(x - 0.5)
    const cy = Math.round(y - 0.5)
    const cz = Math.round(z - 1)
    for (let r = 0; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const n = g.nodeIndex.get(cellKey(cx + dx, cy + dy, cz))
          if (n !== undefined) return n
        }
      }
    }
    return -1
  }

  /* ------------------------------------------------------------- metrics */

  private computeMetrics(period: 'peak' | 'offpeak' | 'late'): void {
    const g = this.graph
    this.nodePop.fill(0)
    // Everybody standing in the station, over the station's own floor area
    // (§7.3). One pass, two jobs: `nodePop` feeds the per-node density overlay,
    // and `standing` is the numerator of the status bar's crowd level. Bodies on
    // the street plane are left out of the numerator because they are already
    // out of `stationArea`, and a rider is aboard a consist rather than standing
    // on the floor under its car.
    let standing = 0
    for (const a of this.pool.live) {
      if (a.train >= 0) continue
      // A queued body stands in its lane but is logically at the server, so
      // count it there — and skip the ring search, which is what makes a lane
      // that reaches past the station expensive.
      const n = a.server >= 0 ? g.servers[a.server].node : this.nearestNode(a.x, a.y, a.z)
      if (n < 0) continue
      this.nodePop[n]++
      if (ZONES[g.nodeZone[n]] !== 'outside') standing++
    }
    let gateQ = 0
    let escQ = 0
    let liftQ = 0
    let doorQ = 0
    for (const s of g.servers) {
      if (s.kind === 'gate') gateQ += s.queue.length
      else if (s.kind === 'escalator' || s.kind === 'walkway' || s.kind === 'stair') escQ += s.queue.length
      else if (s.kind === 'lift') liftQ += s.queue.length
      else if (s.kind === 'door') doorQ += s.queue.length
    }
    this.metrics.tick = this.tick
    this.metrics.simTime = this.simTime
    this.metrics.population = this.pool.count
    // An empty station, or one with no floor to stand on, is free flow rather
    // than a crush: guard the ratio rather than letting 0/0 fall through `losOf`.
    this.metrics.crowdLos = standing > 0 && g.stationArea > 0 ? losOf(g.stationArea / standing) : 'A'
    this.metrics.gateQueue = gateQ
    this.metrics.escalatorQueue = escQ
    this.metrics.liftQueue = liftQ
    this.metrics.doorQueue = doorQ
    this.metrics.period = period
    this.metrics.trainsLate = this.trains.length
  }

  /** Aggregate throughput counters for the HUD and charts. */
  get totals(): { boarded: number; alighted: number; exited: number; leftBehind: number } {
    return {
      boarded: this.metrics.boarded,
      alighted: this.metrics.alighted,
      exited: this.metrics.exited,
      leftBehind: this.metrics.leftBehind,
    }
  }
}

const EMPTY_PATH = new Int32Array(0)

/**
 * Where a rider stands inside the cabin, by boarding order. The cabin is just
 * under a metre across, so riders line up in three loose columns rather than
 * piling on the centre; the offset is small but keeps them from occupying the
 * exact same point, which the renderer would draw as one body.
 */
function liftSlotOffset(slot: number, size: 2 | 3 = 2): [number, number] {
  const k = size / 2
  if (slot === 0) return [.245 * k, 0]
  const cols = [-0.45, 0, 0.45]
  const row = Math.floor(slot / cols.length) % 4
  const col = cols[slot % cols.length] * k
  const rowY = (-0.45 + row * 0.3) * k
  return [col, rowY]
}

function performanceNowMs(): number {
  // Works in both the browser and Node without importing either.
  const p = (globalThis as { performance?: { now(): number } }).performance
  return p ? p.now() : Date.now()
}

export { STATE_ARRIVING, STATE_WALKING, STATE_QUEUING, STATE_BUYING, STATE_BROWSING, STATE_WAITING, STATE_RIDING, STATE_LEAVING, STOCK, LANE_SLOT, WALK_SPEED }
