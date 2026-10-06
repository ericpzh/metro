// The simulation world.
//
// One tick is synchronous: integrate every agent, step every queue and train,
// record metrics, then return. No await, no per-agent microtasks (PLAN.md §2.4).
// Everything that consumes randomness draws from the single Rng, in a fixed
// iteration order, so `seed + tick -> identical crowd` (§7.6).

import { AgentPool, type Agent } from '../agents.ts'
import {
  CONGESTION_CAP,
  CONGESTION_S,
  DOOR_RATE,
  GATE_CLEAR_RADIUS,
  GATE_LOOKAHEAD,
  GATE_REPLAN_PER_TICK,
  LANE_SLOT,
  LIFT_BOARD_S,
  LIFT_DOOR_S,
  LIFT_DWELL_S,
  LIFT_SPEED,
  MAX_AGENTS,
  NEIGHBOUR_CELL,
  PERSONAL_SPACE,
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
  type Los,
  type Period,
} from '../constants.ts'
import { dayAt, normalizePeaks, normalizeService, type DayType } from '../clock.ts'
import {
  DEFAULT_DEMAND_INPUT,
  demandAt,
  hourOfDay,
  normalizeDemand,
  type DemandInput,
} from '../demand.ts'
import { Rng } from '../rng.ts'
import { gateLaneAllows } from '../gates.ts'
import { buildGraph, cellKey, EDGE_KIND, PathFinder, type ServerDef, type StationGraph } from '../station.ts'
import { liftDoorDir } from '../lifts.ts'
import { crossingDir, ZONE_INDEX } from '../zones.ts'
import { STOCK, STOCK_CLASSES, CABIN_ALIGHT_MAX_S, CABIN_ALIGHT_PAIR_S, CABIN_FLOOR_Z, CABIN_MAX_ROWS, CABIN_PAIR_HALF, cabinSlot, trainRatedCapacity } from '../stock.ts'
import { rotateLocal, trackFacing, type TrackModule } from '../track.ts'
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

/** Default clock for a station that does not override it: 06:30. */
const DEFAULT_SIM_TIME = 6.5 * 3600

/** A zeroed metrics block for a freshly constructed or loaded world. */
function freshMetrics(simTime: number): Metrics {
  return {
    tick: 0,
    simTime,
    population: 0,
    worstLos: 'A',
    worstLosNode: -1,
    leftBehind: 0,
    boarded: 0,
    alighted: 0,
    exited: 0,
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
   * like one; an agent the ration skips still chooses at the gate's own cell.
   */
  private gateReplans = 0
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
    this.rebuild()
  }

  /**
   * The station's authored day (§9.6C 时刻): its operating hours, its two peak windows and
   * the demand curve's knobs, normalized once per `rebuild()` so the tick loop only ever
   * reads plain numbers. Document data read there rather than cached at construction, so
   * an edit that reaches `this.data` takes effect with no second copy to keep in step.
   */
  private day: DemandInput = DEFAULT_DEMAND_INPUT
  /**
   * The current day's type — §7.4's `calendar(dayOfYear)` multiplier. Refreshed when the
   * calendar day rolls over: `dayAt` per tick would compute a civil date 64 times a second
   * for an answer that changes once a day.
   */
  private dayTypeCache: { index: number; type: DayType } = { index: Number.NaN, type: 'weekday' }

  /** Rebuild the graph from static data and reset derived state. */
  rebuild(): void {
    // The authored day is document data: re-read and re-normalize it on every rebuild,
    // which is the same path a live edit takes (`build` → `rebuild`).
    this.day = {
      service: normalizeService(this.data.service),
      peaks: normalizePeaks(this.data.peaks),
      knobs: normalizeDemand(this.data.demand),
    }
    this.dayTypeCache.index = Number.NaN
    this.graph = buildGraph(this.data, this.zoneBarriers)
    this.path = new PathFinder(this.graph)
    // A tail is a list of node ids, so every one of them is stale the moment the
    // graph is re-cut — dropped here rather than left to the identity check in
    // `routeTail`, which only fires on the next preview.
    this.routeTails.clear()
    this.routeTailGraph = this.graph
    this.nodePop = new Int32Array(this.graph.nodeCount)
    this.doorsByLine.clear()
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
    // Reset server queues; agents will re-request on the next tick.
    for (const s of this.graph.servers) {
      s.queue.length = 0
      s.cooldown = 0
      s.served = 0
      s.waitAccum = 0
      s.waitCount = 0
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
      a.path = EMPTY_PATH
      a.pathIdx = 0
      a.fromNode = -1
      a.destNode = -1
      a.server = -1
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
    this.setupGrid()
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
    const platforms = bound.filter((t) => !t.cfg.tunnel)
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
    const period = periodOf(this.simTime, this.day.service, this.day.peaks)

    this.dispatchTrains(period)
    this.spawnStreet(period)
    this.stepServers()
    this.moveAgents()
    this.pool.compact()
    this.computeMetrics(period)
    // The path cache is keyed on (from, to, needsClass); queue waits drift, so
    // refresh it periodically and let new legs rebalance (§7.2 trigger 3).
    if (this.tick % 60 === 0) this.path.clear()

    const ms = performanceNowMs() - t0
    this.metrics.tickMs = ms
    return this.metrics
  }

  /**
   * Write a render buffer: [x, y, z, state, phase, id] per live agent. The id
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
      out[o + 4] = (a.pathIdx & 7) + (a.id % 5) * 0.1
      out[o + 5] = a.id
      n++
    }
    return n
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
   * The demand multiplier at this instant: `sim/demand.ts`'s curve — the same samples the
   * 时刻 window plots — scaled by the period the timetable is in and by the day type's
   * calendar coefficient (§7.4). The period is handed in because `tickOnce` has already
   * asked for it: asking twice is two chances to answer differently.
   */
  private curve(period: Period): number {
    return demandAt(hourOfDay(this.simTime), period, this.dayType(), this.day.knobs)
  }

  /** The day type the calendar is on, refreshed when the simulated day rolls over. */
  private dayType(): DayType {
    const index = Math.floor(this.simTime / SIM_DAY)
    if (this.dayTypeCache.index !== index) {
      this.dayTypeCache = { index, type: dayAt(this.simTime).dayType }
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
        this.spawnAtNode(e.node, 'exit:' + e.id, this.sampleTripFromStreet())
      }
    }
  }

  private sampleTripFromStreet(): Trip {
    // Optional stop at a ticket / vending machine: §7.4a, a quarter of unpaid
    // entries. Both machine types are stops in the unpaid zone, where an
    // entering passenger actually passes them (§4.5).
    const stops: string[] = []
    if (this.rng.chance(0.25)) {
      const machines = this.graph.stops.filter(
        (s) => (s.kind === 'tvm' || s.kind === 'vending') && this.graph.nodeZone[s.node] === ZONE_INDEX.unpaid,
      )
      if (machines.length > 0) {
        const pick = machines[this.rng.int(machines.length)]
        stops.push('stop:' + pick.id)
      }
    }
    const lineIds = this.data.lines.map((l) => l.id)
    const board = lineIds.length > 0 && this.rng.chance(0.55)
    const dest = board ? 'line:' + lineIds[0] : 'exit:' + this.pickExitId()
    return { origin: '', stops, dest }
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

  private sampleTripFromTrain(exitShare: number, arrivingLine: string): Trip {
    if (this.rng.chance(exitShare)) return { origin: '', stops: [], dest: 'exit:' + this.pickExitId() }
    // Only a *different* line can be a transfer destination (§7.5). With one
    // line in the demo every alighting passenger is exiting.
    const other = this.data.lines.map((l) => l.id).filter((id) => id !== arrivingLine)
    if (other.length > 0) return { origin: '', stops: [], dest: 'line:' + other[0] }
    return { origin: '', stops: [], dest: 'exit:' + this.pickExitId() }
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
          if (train.t >= TRAIN_APPROACH_S) this.setTrainState(train, 'berth')
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
          if (train.t >= TRAIN_DOOR_TRAVEL) this.setTrainState(train, 'hold')
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
      // The wave this consist brings is seated before it is on the road at all:
      // it rides in down the tunnel, so the cabin is already full when the train
      // pulls in and there is nothing to pop into being in front of the platform.
      this.loadAlighting(train)
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
   * door, the rows behind it receding inboard — before the train is on the road,
   * so the cabin draws full as the consist runs in and the platform sees people
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
    const trip = this.sampleTripFromTrain(0.55, train.line)
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
        g.nodeZ[s.node] + (CABIN_FLOOR_Z - 0.5),
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
    const [lx, ly] = cabinSlot(doorX, side, file, row)
    return [at.x + lx * at.fx - ly * at.fy, at.y + lx * at.fy + ly * at.fx, at.z + CABIN_FLOOR_Z]
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
   * A consist leaves the world with everyone still aboard: the boarders ride out
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
        const d = track.d ?? 1
        const width = STOCK[line.stock].width
        const gap = 0.1
        // Work in the track's local frame: u runs along the bed, v across it. The
        // bed spans v ∈ [0, d]; the platform edge (if any) sits at v = −1 or d.
        // `side` names the side the track lies on from the screen's frame, so
        // 'left' means the platform is beyond the bed at v = +d.
        const trackDir = track.cfg.dir ?? line.direction
        const edge = this.data.modules.find(
          (m) => m.type === 'platform-edge' && m.cfg.line === line.id && (m.cfg.from === track.id || (!m.cfg.from && m.cfg.dir === trackDir)),
        )
        let v = d / 2
        if (edge && edge.type === 'platform-edge') {
          const side = edge.cfg.side
          if (side === 'left') {
            // Platform on the local +v side (past the bed): keep clear of its
            // track-facing edge.
            const minCentre = width / 2
            const maxCentre = d - gap - width / 2
            v = minCentre <= maxCentre ? clamp(v, minCentre, maxCentre) : minCentre
          } else {
            // Platform on the local −v side.
            const minCentre = gap + width / 2
            const maxCentre = d - width / 2
            v = minCentre <= maxCentre ? clamp(v, minCentre, maxCentre) : maxCentre
          }
        }
        // The run midpoint on the bed, turned into world cell coordinates.
        const [ox, oy] = rotateLocal(rot, track.w / 2, v)
        const x = track.x + ox
        const y = track.y + oy
        // A train rides the rail surface: the recessed bed slab sits half a metre
        // below the platform, so the consist drops with it.
        const z = track.z + 0.5
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
        this.lineAnchors.set(trainKey(line.id, track.id), { x, y, z, fx, fy, yaw: Math.atan2(fy, fx), dirSign, cars: line.cars, stock: line.stock, colour, doorSides })
      }
    }
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
    const reach = (STOCK[a.stock].length * a.cars) / 2 + 25
    let offset = 0
    if (train.state === 'approach') {
      // Ease out: fast down the tunnel, slowing to a stop at the mark.
      const p = Math.min(1, train.t / TRAIN_APPROACH_S)
      offset = -(1 - p) * (1 - p) * reach * a.dirSign
    } else if (train.state === 'depart') {
      // Ease in: pull away gently, then run up to speed.
      const p = Math.min(1, train.t / TRAIN_DEPART_S)
      offset = p * p * reach * a.dirSign
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
   * doors-open, line colour, direction, yaw, door-side mask. A pure function of
   * train state, so it adds no randomness and cannot disturb §7.6 determinism.
   * The mask is the berth's `LineAnchor.doorSides`: the renderer slides only the
   * leaves on a side whose screen doors exist (§1.13).
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
      out[k++] = train.state === 'opening' || train.state === 'dwell' || train.state === 'closing' ? 1 : 0
      out[k++] = a.colour
      out[k++] = a.dirSign
      out[k++] = a.yaw
      out[k++] = a.doorSides
    }
    return out.subarray(0, k)
  }

  /**
   * One pose per elevator car, stride 6: plan x, plan y, lower cell z, upper
   * cell z, cabin floor height, door-open fraction. The renderer matches a car
   * to its shaft by the first three numbers, then moves the cabin and slides the
   * doors. A pure function of car state, so §7.6 determinism is untouched.
   */
  liftRenderState(): Float32Array {
    const out: number[] = []
    for (const s of this.graph.servers) {
      if (s.kind !== 'lift' || !s.lift) continue
      const c = s.lift
      out.push(c.x, c.y, c.fromZ, c.toZ, c.z, c.door)
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
      // The server owns the whole tick's worth of service capacity: at 75/min
      // and a 1 s step that is 1-2 people, but the loop is what makes the rate
      // correct at any step size.
      s.cooldown -= dt
      while (s.cooldown <= 0 && s.queue.length > 0) {
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
      car.riders.push(a.id)
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
    const [sx, sy] = liftSlotOffset(a.liftSlot)
    // The 1.5 m carriage is centred in the 2 × 2 m assembly.
    const cabinX = car.x + 1 + sx
    const cabinY = car.y + 1 + sy
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
    a.wait = 0
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
    } else if (s.kind === 'door') {
      // Boarded: the passenger steps into the car and rides (§1.13), drawn in
      // the cabin until the consist leaves the world.
      this.metrics.boarded++
      this.boardRider(a, s)
    } else if (s.kind === 'stop') {
      a.state = STATE_BUYING
      a.timer = this.rng.range(30, 60)
    } else {
      a.state = STATE_WALKING
    }
  }

  private joinServer(a: Agent, serverId: number): void {
    const s = this.graph.servers[serverId]
    a.server = serverId
    a.state = STATE_QUEUING
    a.timer = 0
    s.queue.push(a.id)
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
    const tx = s.kind === 'lift' && a.liftBoard >= 0 ? a.liftWaitX : g.nodeX[node]
    const ty = s.kind === 'lift' && a.liftBoard >= 0 ? a.liftWaitY : g.nodeY[node]
    const dist = Math.hypot(tx - a.x, ty - a.y)
    const standoff = PERSONAL_SPACE * 0.3
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
      if (a.dead || a.state === STATE_RIDING || a.train >= 0) continue
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
      this.tryMove(a, ax + px, ay + py)
    }
  }

  /** Move an agent, but never onto a cell that is not floor. */
  private tryMove(a: Agent, nx: number, ny: number): void {
    if (this.onFloor(nx, ny, a.z)) {
      a.x = nx
      a.y = ny
    } else if (this.onFloor(nx, a.y, a.z)) {
      a.x = nx
    } else if (this.onFloor(a.x, ny, a.z)) {
      a.y = ny
    }
  }

  /** True when the cell containing a point is walkable floor on its level. */
  private onFloor(x: number, y: number, z: number): boolean {
    return this.graph.nodeIndex.has(cellKey(Math.floor(x), Math.floor(y), Math.round(z) - 1))
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
    this.gateReplans = 0
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

  private queueTime(a: Agent): void {
    a.wait += SIM_DT
    if (a.wait <= a.patience) return
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
    this.reRouteAroundQueue(a, s)
    a.wait = 0
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
    const from = this.nearestNode(a.x, a.y, a.z)
    if (from < 0 || from === a.destNode) return false
    const path = this.path.search(from, a.destNode, a.needs)
    if (!path || path.length === 0) return false
    if (this.firstQueueServer(path) === s.id) return false
    const idx = s.queue.indexOf(a.id)
    if (idx >= 0) s.queue.splice(idx, 1)
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
      if (kind === 'gate' || kind === 'lift' || kind === 'escalator' || kind === 'stair') return srv
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
    const g = this.graph
    const target = a.path[a.pathIdx]
    const tx = g.nodeX[target]
    const ty = g.nodeY[target]
    const tz = g.nodeZ[target]
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
        a.x = tx
        a.y = ty
        a.z = tz
      }
      a.vx = 0
      a.vy = 0
      this.onArrive(a)
      return
    }
    const inv = budget / dist
    a.x += (tx - a.x) * inv
    a.y += (ty - a.y) * inv
    a.z += (tz - a.z) * inv
    a.vx = ((tx - a.x) / Math.max(dist, 1e-6)) * speed
    a.vy = ((ty - a.y) / Math.max(dist, 1e-6)) * speed
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
   * an agent the ration skips re-chooses at the gate's own cell, exactly where
   * every re-choice used to be made.
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
    const atGate = gateAt === a.pathIdx
    if (!atGate) {
      if (lead > GATE_LOOKAHEAD) return false
      if (this.gateReplans >= GATE_REPLAN_PER_TICK) return false
      this.gateReplans++
    }
    a.gateChosen = true
    const from = this.nearestNode(a.x, a.y, a.z)
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
        const score = dist + 8 * s.queue.length
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
      if ((kind === EDGE_KIND.escalator || kind === EDGE_KIND.stair || kind === EDGE_KIND.lift) && server >= 0) {
        if (kind === EDGE_KIND.lift) {
          // Remember where this passenger boards and where the car should drop
          // them; a lift's car delivers each rider to its own floor.
          a.liftBoard = cur
          a.liftDest = next
          const car = g.servers[server].lift
          // The stop node is the landing tile in front of the door; stand the
          // queue just off the threshold (toward the landing, away from the car),
          // so the crowd visibly funnels through the doorway when it opens.
          const [dx, dy] = liftDoorDir(car?.rot ?? 0)
          a.liftWaitX = g.nodeX[cur] - dx * 0.45
          a.liftWaitY = g.nodeY[cur] - dy * 0.45
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
    const srv = g.serverForNode.get(leg.node)
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
        a.dead = true
        this.metrics.stuck++
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
    let worst = 4
    let worstNode = -1
    for (const a of this.pool.live) {
      // A rider is aboard a consist, not standing in the station: pricing it
      // against the platform node under its car would report the train's own
      // passengers as a crush on the floor they have not stepped onto yet.
      if (a.train >= 0) continue
      // A queued body stands in its lane but is logically at the server, so
      // count it there — and skip the ring search, which is what makes a lane
      // that reaches past the station expensive.
      const n = a.server >= 0 ? g.servers[a.server].node : this.nearestNode(a.x, a.y, a.z)
      if (n >= 0) this.nodePop[n]++
    }
    for (let n = 0; n < g.nodeCount; n++) {
      const pop = this.nodePop[n]
      if (pop === 0) continue
      // One node is one square metre of floor.
      const los = losOf(1 / pop)
      const rank = 'ABCDEF'.indexOf(los)
      if (rank > worst) {
        worst = rank
        worstNode = n
      }
    }
    let gateQ = 0
    let escQ = 0
    let liftQ = 0
    let doorQ = 0
    for (const s of g.servers) {
      if (s.kind === 'gate') gateQ += s.queue.length
      else if (s.kind === 'escalator' || s.kind === 'stair') escQ += s.queue.length
      else if (s.kind === 'lift') liftQ += s.queue.length
      else if (s.kind === 'door') doorQ += s.queue.length
    }
    this.metrics.tick = this.tick
    this.metrics.simTime = this.simTime
    this.metrics.population = this.pool.count
    this.metrics.worstLos = 'ABCDEF'[worst] as Los
    this.metrics.worstLosNode = worstNode
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
function liftSlotOffset(slot: number): [number, number] {
  const cols = [-0.45, 0, 0.45]
  const row = Math.floor(slot / cols.length) % 4
  const col = cols[slot % cols.length]
  const rowY = -0.45 + row * 0.3
  return [col, rowY]
}

function performanceNowMs(): number {
  // Works in both the browser and Node without importing either.
  const p = (globalThis as { performance?: { now(): number } }).performance
  return p ? p.now() : Date.now()
}

export { STATE_ARRIVING, STATE_WALKING, STATE_QUEUING, STATE_BUYING, STATE_BROWSING, STATE_WAITING, STATE_RIDING, STATE_LEAVING, STOCK, LANE_SLOT, WALK_SPEED }
