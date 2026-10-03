// The simulation world.
//
// One tick is synchronous: integrate every agent, step every queue and train,
// record metrics, then return. No await, no per-agent microtasks (PLAN.md §2.4).
// Everything that consumes randomness draws from the single Rng, in a fixed
// iteration order, so `seed + tick -> identical crowd` (§7.6).

import { AgentPool, type Agent } from './agents.ts'
import {
  DOOR_RATE,
  GATE_CLEAR_RADIUS,
  LANE_SLOT,
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
  clamp,
  densityDerate,
  losOf,
  periodOf,
  type Los,
} from './constants.ts'
import { Rng } from './rng.ts'
import { gateLaneAllows } from './gates.ts'
import { buildGraph, cellKey, EDGE_KIND, PathFinder, type ServerDef, type StationGraph } from './station.ts'
import { crossingDir, ZONE_INDEX } from './zones.ts'
import { STOCK, trainRatedCapacity, type StockClass } from './stock.ts'
import { rotateLocal, trackFacing } from './track.ts'
import { ZONES, type LineDef, type StationData, type Trip } from './types.ts'

const STATE_ARRIVING = 0
const STATE_WALKING = 1
const STATE_QUEUING = 2
const STATE_BUYING = 3
const STATE_BROWSING = 4
const STATE_WAITING = 5
const STATE_RIDING = 6
const STATE_LEAVING = 8

const ARRIVE = 0.35
const SIM_DT = SIM_SECONDS_PER_TICK
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

export type TrainState = 'approach' | 'berth' | 'opening' | 'dwell' | 'closing' | 'hold' | 'depart'

export interface Train {
  id: number
  line: string
  state: TrainState
  t: number
  boarded: number
  alighted: number
  onboard: number
  capacity: number
  late: number
  doors: number[]
  dir: string
}

export interface Metrics {
  tick: number
  simTime: number
  population: number
  worstLos: Los
  worstLosNode: number
  leftBehind: number
  boarded: number
  alighted: number
  exited: number
  trainsLate: number
  gateQueue: number
  escalatorQueue: number
  doorQueue: number
  period: 'peak' | 'offpeak' | 'late'
  agentsCap: boolean
  tickMs: number
  /** Agents that could not be routed to any destination this run. */
  stuck: number
}

/** Where a line's train appears: the track it runs on and its stock. */
interface LineAnchor {
  x: number
  y: number
  z: number
  /** Unit run direction of the track, so a north–south line travels in y. */
  fx: number
  fy: number
  /** Yaw (radians) that turns the consist's local +x onto the run axis. */
  yaw: number
  dirSign: number
  cars: number
  stock: StockClass
  colour: number
}

export interface DynamicSnapshot {
  rng: number
  tick: number
  simTime: number
  agents: Array<{
    id: number
    seed: number
    x: number
    y: number
    z: number
    state: number
    trip: Trip
    legIdx: number
    pathIdx: number
  }>
}

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
    doorQueue: 0,
    period: 'peak',
    agentsCap: false,
    tickMs: 0,
    stuck: 0,
  }
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
  doorOwner = new Map<number, string>()
  doorEdge = new Map<number, { line: string; index: number }>()
  lineById = new Map<string, LineDef>()
  lineAnchors = new Map<string, LineAnchor>()
  nextDispatch = new Map<string, number>()
  /** Per-node live population, for the LOS overlay. */
  nodePop: Int32Array
  metrics: Metrics
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
  private nextTrainId = 1

  constructor(data: StationData, seed = 1234567) {
    this.data = data
    this.seed = seed
    this.rng = new Rng(seed)
    this.simTime = DEFAULT_SIM_TIME
    const g = buildGraph(data)
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
    this.rebuild()
  }

  /** Rebuild the graph from static data and reset derived state. */
  rebuild(): void {
    this.graph = buildGraph(this.data)
    this.path = new PathFinder(this.graph)
    this.nodePop = new Int32Array(this.graph.nodeCount)
    this.doorsByLine.clear()
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
    }
    // Reset server queues; agents will re-request on the next tick.
    for (const s of this.graph.servers) {
      s.queue.length = 0
      s.cooldown = 0
      s.served = 0
      s.waitAccum = 0
      s.waitCount = 0
    }
    this.pool.forEach((a) => {
      a.path = EMPTY_PATH
      a.pathIdx = 0
      a.fromNode = -1
      a.destNode = -1
      a.server = -1
      a.state = STATE_ARRIVING
    })
    this.setupGrid()
    this.nextDispatch.clear()
    let stagger = 0
    for (const l of this.data.lines) {
      this.nextDispatch.set(l.id, this.simTime + stagger)
      stagger += 13
    }
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
  }

  /* -------------------------------------------------------------- public */

  tickOnce(): Metrics {
    const t0 = performanceNowMs()
    this.tick++
    this.simTime += SIM_DT
    const period = periodOf(this.simTime)

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

  private curve(period: 'peak' | 'offpeak' | 'late'): number {
    const h = (this.simTime % SIM_DAY) / 3600
    const gauss = (mu: number, s: number) => Math.exp(-((h - mu) * (h - mu)) / (2 * s * s))
    const shape = 0.06 + 1.0 * gauss(8, 0.85) + 0.78 * gauss(18, 1.05) + 0.18 * gauss(12.5, 2.2)
    if (period === 'late') return shape * 0.25
    if (period === 'offpeak') return shape * 0.6
    return shape
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
    // Optional stop at a ticket machine: §7.4a, 30% of unpaid entries.
    const stops: string[] = []
    if (this.rng.chance(0.25)) {
      // A ticket machine is only a stop in the unpaid zone, where an entering
      // passenger actually passes it (§4.5).
      const tvms = this.graph.stops.filter((s) => s.kind === 'tvm' && this.graph.nodeZone[s.node] === ZONE_INDEX.unpaid)
      if (tvms.length > 0) {
        const pick = tvms[this.rng.int(tvms.length)]
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
      const active = this.trains.find((t) => t.line === line.id)
      const next = this.nextDispatch.get(line.id) ?? this.simTime
      if (!active && this.simTime >= next) {
        const cap = trainRatedCapacity(line)
        this.trains.push({
          id: this.nextTrainId++,
          line: line.id,
          state: 'approach',
          t: 0,
          boarded: 0,
          alighted: 0,
          onboard: 0,
          capacity: cap,
          late: 0,
          doors: this.doorsByLine.get(line.id) ?? [],
          dir: line.direction,
        })
        this.nextDispatch.set(line.id, this.simTime + this.headwayFor(line, period))
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
            this.dumpAlighting(train)
            this.setTrainState(train, 'opening')
          }
          break
        case 'opening':
          // The leaves travel; boarding was enabled with the command.
          if (train.t >= TRAIN_DOOR_TRAVEL) this.setTrainState(train, 'dwell')
          break
        case 'dwell':
          // Doors fully open, serving the platform.
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
          if (train.t >= TRAIN_DEPART_S) this.trains.splice(this.trains.indexOf(train), 1)
          break
      }
    }
  }

  /** Move a train to the head of `state`, resetting its phase clock. */
  private setTrainState(train: Train, state: TrainState): void {
    train.state = state
    train.t = 0
  }

  private openDoors(train: Train): void {
    for (const d of train.doors) {
      const s = this.graph.servers[d]
      s.rate = DOOR_RATE
    }
  }

  private closeDoors(train: Train): void {
    for (const d of train.doors) {
      const s = this.graph.servers[d]
      s.rate = 0
      // Whoever is still queued was left behind by this train.
      this.metrics.leftBehind += s.queue.length
    }
  }

  private dumpAlighting(train: Train): void {
    const line = this.lineById.get(train.line)
    if (!line) return
    let n = line.alightPerTrain
    const doors = train.doors
    if (doors.length === 0) return
    for (let i = 0; i < n; i++) {
      if (this.pool.count >= MAX_AGENTS) break
      const d = doors[i % doors.length]
      const s = this.graph.servers[d]
      const trip = this.sampleTripFromTrain(0.55, train.line)
      if (!trip.dest) continue
      this.spawnAtNode(s.node, 'train:' + train.line, trip)
      train.alighted++
    }
    this.metrics.alighted += n
  }

  /**
   * The track position a line's trains run on, derived once from its track and
   * the platform edge beside it. This is the only geometry the renderer needs
   * to draw rolling stock, so it stays a pure function of the station. The track
   * carries its own orientation, so a north–south line travels in y.
   */
  private computeLineAnchors(): void {
    this.lineAnchors.clear()
    for (const line of this.data.lines) {
      // A line needs a track to run on; the platform edge is only needed for
      // boarding. Decoupling them means a freshly laid rail gets a train right
      // away, even before a platform and its screen doors exist.
      const track = this.data.modules.find((m) => m.type === 'track' && m.cfg.line === line.id)
      if (!track || track.type !== 'track') continue
      const rot = track.rot ?? 0
      const [fx, fy] = trackFacing(rot)
      const d = track.d ?? 1
      const width = STOCK[line.stock].width
      const gap = 0.1
      // Work in the track's local frame: u runs along the bed, v across it. The
      // bed spans v ∈ [0, d]; the platform edge (if any) sits at v = −1 or d.
      const edge = this.data.modules.find((m) => m.type === 'platform-edge' && m.cfg.line === line.id)
      let v = d / 2
      if (edge && edge.type === 'platform-edge') {
        const side = edge.cfg.side
        if (side === 'left') {
          // Platform on the local −v side: keep clear of its track-facing edge.
          const minCentre = gap + width / 2
          const maxCentre = d - width / 2
          v = minCentre <= maxCentre ? clamp(v, minCentre, maxCentre) : maxCentre
        } else {
          const minCentre = width / 2
          const maxCentre = d - gap - width / 2
          v = minCentre <= maxCentre ? clamp(v, minCentre, maxCentre) : minCentre
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
      this.lineAnchors.set(line.id, { x, y, z, fx, fy, yaw: Math.atan2(fy, fx), dirSign, cars: line.cars, stock: line.stock, colour })
    }
  }

  /**
   * One pose per live train, stride 9: x, y, z, cars, stock index (A/B/C),
   * doors-open, line colour, direction, yaw. A pure function of train state, so
   * it adds no randomness and cannot disturb §7.6 determinism.
   */
  trainRenderState(): Float32Array {
    const STRIDE = 9
    const out = new Float32Array(this.trains.length * STRIDE)
    let k = 0
    for (const train of this.trains) {
      const a = this.lineAnchors.get(train.line)
      if (!a) continue
      const trainLen = STOCK[a.stock].length * a.cars
      const reach = trainLen / 2 + 25
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
      out[k++] = a.x + offset * a.fx
      out[k++] = a.y + offset * a.fy
      out[k++] = a.z
      out[k++] = a.cars
      out[k++] = a.stock === 'A' ? 0 : a.stock === 'B' ? 1 : 2
      out[k++] = train.state === 'opening' || train.state === 'dwell' || train.state === 'closing' ? 1 : 0
      out[k++] = a.colour
      out[k++] = a.dirSign
      out[k++] = a.yaw
    }
    return out.subarray(0, k)
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

  private stepLift(s: ServerDef, dt: number): void {
    s.cooldown -= dt
    if (s.cooldown > 0) return
    // Load a batch and run one cycle.
    let boarded = 0
    const batch: Agent[] = []
    while (s.queue.length > 0 && boarded < s.batch) {
      const a = this.pool.all().get(s.queue.shift() as number)
      if (!a || a.dead) continue
      batch.push(a)
      boarded++
    }
    if (batch.length === 0) {
      s.cooldown = 0
      return
    }
    for (const a of batch) this.serve(a, s)
    s.cooldown = s.cycle
  }

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
      // Boarded: the agent leaves the station.
      a.dead = true
      this.metrics.boarded++
      const train = this.trains.find((t) => t.doors.includes(s.id))
      if (train) train.onboard++
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
    const tx = g.nodeX[node]
    const ty = g.nodeY[node]
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
      if (a.dead || a.state === STATE_RIDING) continue
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
            if (b === a || b.dead || b.state === STATE_RIDING) continue
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
    if (a.wait > a.patience) {
      if (a.server >= 0 && this.graph.servers[a.server].kind === 'door') {
        // Re-pick the cheapest door (§5.9).
        const s = this.graph.servers[a.server]
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
      } else if (a.server >= 0 && this.graph.servers[a.server].kind === 'stop') {
        // Drop the stop, walk on.
        const s = this.graph.servers[a.server]
        const idx = s.queue.indexOf(a.id)
        if (idx >= 0) s.queue.splice(idx, 1)
        a.server = -1
        a.comfort -= 0.1
        this.advanceLeg(a)
      }
    }
  }

  private stepRide(a: Agent): void {
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
   * The moment an agent is about to step onto a gate it re-plans the rest of
   * the leg against the live queues, because walking a few metres along the
   * concourse beats queueing behind everyone else (§7.2).
   *
   * The re-plan deliberately skips the cache — it has to see the queues as they
   * are — and happens once per crossing, which the escalators already pace, so
   * it is a handful of searches a second, not a per-tick wave.
   */
  private chooseGate(a: Agent): boolean {
    if (a.gateChosen) return false
    const target = a.path[a.pathIdx]
    const srv = this.graph.serverForNode.get(target)
    if (srv === undefined || this.graph.servers[srv].kind !== 'gate') return false
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
   */
  private buildCollisionGrid(live: readonly Agent[]): void {
    const n = live.length
    if (this.cOrder.length < n) this.cOrder = new Int32Array(Math.max(n, this.cOrder.length * 2))
    const counts = this.cCounts
    counts.fill(0)
    const W = this.cGridW
    const H = this.cGridH
    const band = W * H
    for (let i = 0; i < n; i++) counts[this.collisionCellIndex(live[i].x, live[i].y, live[i].z, band)]++
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
    let doorQ = 0
    for (const s of g.servers) {
      if (s.kind === 'gate') gateQ += s.queue.length
      else if (s.kind === 'escalator' || s.kind === 'stair' || s.kind === 'lift') escQ += s.queue.length
      else if (s.kind === 'door') doorQ += s.queue.length
    }
    this.metrics.tick = this.tick
    this.metrics.simTime = this.simTime
    this.metrics.population = this.pool.count
    this.metrics.worstLos = 'ABCDEF'[worst] as Los
    this.metrics.worstLosNode = worstNode
    this.metrics.gateQueue = gateQ
    this.metrics.escalatorQueue = escQ
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

function performanceNowMs(): number {
  // Works in both the browser and Node without importing either.
  const p = (globalThis as { performance?: { now(): number } }).performance
  return p ? p.now() : Date.now()
}

export { STATE_ARRIVING, STATE_WALKING, STATE_QUEUING, STATE_BUYING, STATE_BROWSING, STATE_WAITING, STATE_RIDING, STATE_LEAVING, STOCK, LANE_SLOT, WALK_SPEED }
