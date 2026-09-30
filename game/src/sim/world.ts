// The simulation world.
//
// One tick is synchronous: integrate every agent, step every queue and train,
// record metrics, then return. No await, no per-agent microtasks (PLAN.md §2.4).
// Everything that consumes randomness draws from the single Rng, in a fixed
// iteration order, so `seed + tick -> identical crowd` (§7.6).

import { AgentPool, type Agent } from './agents.ts'
import {
  BOARDING_CUTOFF,
  DWELL_BASE,
  DWELL_MAX,
  DWELL_MIN,
  DWELL_PER_PAX,
  DOOR_RATE,
  LANE_SLOT,
  MAX_AGENTS,
  NEIGHBOUR_CELL,
  PERSONAL_SPACE,
  SIM_DAY,
  SIM_SECONDS_PER_TICK,
  WALK_SPEED,
  clamp,
  densityDerate,
  losOf,
  periodOf,
  type Los,
} from './constants.ts'
import { Rng } from './rng.ts'
import { buildGraph, cellKey, EDGE_KIND, PathFinder, type ServerDef, type StationGraph } from './station.ts'
import { STOCK, trainRatedCapacity } from './stock.ts'
import type { LineDef, StationData, Trip } from './types.ts'

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
/** Walk-distance budget in metres for one tick at a given speed. */
const SEPARATION_NUDGE = 0.25

export interface Train {
  id: number
  line: string
  state: 'approach' | 'dwell' | 'depart'
  t: number
  dwell: number
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


export class World {
  data: StationData
  graph: StationGraph
  path: PathFinder
  rng: Rng
  seed: number
  tick = 0
  simTime = 6.5 * 3600
  pool: AgentPool
  trains: Train[] = []
  doorsByLine = new Map<string, number[]>()
  doorOwner = new Map<number, string>()
  doorEdge = new Map<number, { line: string; index: number }>()
  lineById = new Map<string, LineDef>()
  nextDispatch = new Map<string, number>()
  /** Per-node live population, for the LOS overlay. */
  nodePop: Int32Array
  metrics: Metrics
  /** Deterministic work queue of agents waiting for a path. */
  private gridW = 1
  private gridH = 1
  private gridL = 1
  private gridMinX = 0
  private gridMinY = 0
  private gridMinZ = 0
  private counts = new Int32Array(1)
  private gStart = new Int32Array(2)
  private gOrder = new Int32Array(1)
  private nextTrainId = 1

  constructor(data: StationData, seed = 1234567) {
    this.data = data
    this.seed = seed
    this.rng = new Rng(seed)
    this.simTime = 6.5 * 3600
    const g = buildGraph(data)
    this.graph = g
    this.path = new PathFinder(g)
    this.pool = new AgentPool(this.rng)
    this.nodePop = new Int32Array(g.nodeCount)
    this.metrics = {
      tick: 0,
      simTime: this.simTime,
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
    this.gridMinX = Math.floor(g.minX) - 2
    this.gridMinY = Math.floor(g.minY) - 2
    this.gridMinZ = g.levelsZ.length ? Math.floor(g.levelsZ[0]) - 2 : -8
    this.gridW = clamp(Math.ceil(g.maxX - g.minX) + 6, 4, 512)
    this.gridH = clamp(Math.ceil(g.maxY - g.minY) + 6, 4, 512)
    this.gridL = clamp(g.levelsZ.length + 4, 2, 32)
    const nb = this.gridW * this.gridH * this.gridL
    this.counts = new Int32Array(nb)
    this.gStart = new Int32Array(nb + 1)
    this.gOrder = new Int32Array(Math.max(64, this.pool.count + 64))
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

  /** Write a render buffer: [x, y, z, state, phase] per live agent. */
  writeTransfer(out: Float32Array): number {
    let n = 0
    const live = this.pool.live
    for (let i = 0; i < live.length; i++) {
      const a = live[i]
      const o = i * 5
      out[o] = a.x
      out[o + 1] = a.y
      out[o + 2] = a.z
      out[o + 3] = a.state
      out[o + 4] = (a.pathIdx & 7) + (a.id % 5) * 0.1
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
      const tvms = this.graph.stops.filter((s) => s.kind === 'tvm')
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
    const exits = this.graph.exits.filter((e) => {
      const m = this.data.modules.find((x) => x.id === e.id)
      return m && m.type === 'exit' && m.cfg.open && m.cfg.outRate > 0
    })
    if (exits.length === 0) return ''
    let total = 0
    for (const e of exits) {
      const m = this.data.modules.find((x) => x.id === e.id)
      total += m && m.type === 'exit' ? m.cfg.outRate : 0
    }
    let r = this.rng.next() * total
    for (const e of exits) {
      const m = this.data.modules.find((x) => x.id === e.id)
      const w = m && m.type === 'exit' ? m.cfg.outRate : 0
      r -= w
      if (r <= 0) return e.id
    }
    return exits[exits.length - 1].id
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
    // Deterministic jitter inside the cell so a spawn wave does not stack.
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
          dwell: 0,
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

    for (const train of this.trains) {
      train.t += SIM_DT
      if (train.state === 'approach') {
        if (train.t >= 6) {
          train.state = 'dwell'
          train.t = 0
          this.openDoors(train)
          this.dumpAlighting(train)
        }
      } else if (train.state === 'dwell') {
        this.serviceBoarding(train)
        const line = this.lineById.get(train.line)
        const base = line ? line.dwellBase : DWELL_BASE
        const per = line ? line.dwellPerPax : DWELL_PER_PAX
        train.dwell = clamp(base + per * (train.boarded + train.alighted), DWELL_MIN, DWELL_MAX)
        if (train.t >= train.dwell - BOARDING_CUTOFF) {
          train.state = 'depart'
          train.t = 0
          this.closeDoors(train)
        }
      } else {
        if (train.t >= 6) {
          // Remove after departure.
          this.trains.splice(this.trains.indexOf(train), 1)
        }
      }
    }
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
    const cap = trainRatedCapacity(line)
    let n = Math.round(cap * 0.45)
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
    void cap
  }

  private serviceBoarding(train: Train): void {
    // Door rate is applied by stepServers; here we only book the result.
    void train
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

  /* --------------------------------------------------------------- agents */

  private moveAgents(): void {
    const live = this.pool.live
    this.buildNeighbourGrid(live)
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
          a.vx = 0
          a.vy = 0
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

    const sep = this.separation(a)

    if (dist <= budget || dist < ARRIVE) {
      a.x = tx
      a.y = ty
      a.z = tz
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
    // Light separation nudge so queues read as crowds rather than single files.
    a.x += sep.x * SEPARATION_NUDGE
    a.y += sep.y * SEPARATION_NUDGE
  }

  private separation(a: Agent): { x: number; y: number } {
    const live = this.pool.live
    let fx = 0
    let fy = 0
    const W = this.gridW
    const H = this.gridH
    const gx = Math.floor((a.x - this.gridMinX) / NEIGHBOUR_CELL)
    const gy = Math.floor((a.y - this.gridMinY) / NEIGHBOUR_CELL)
    const lz = this.levelBucket(a.z)
    for (let oy = -1; oy <= 1; oy++) {
      const yy = gy + oy
      if (yy < 0 || yy >= H) continue
      for (let ox = -1; ox <= 1; ox++) {
        const xx = gx + ox
        if (xx < 0 || xx >= W) continue
        const c = (lz * H + yy) * W + xx
        const s = this.gStart[c]
        const e = this.gStart[c + 1]
        for (let k = s; k < e; k++) {
          const j = this.gOrder[k]
          const b = live[j]
          if (b === a) continue
          const ddx = b.x - a.x
          const ddy = b.y - a.y
          const d2 = ddx * ddx + ddy * ddy
          if (d2 > PERSONAL_SPACE * PERSONAL_SPACE || d2 < 1e-9) continue
          const d = Math.sqrt(d2)
          const w = (PERSONAL_SPACE - d) / d
          fx -= ddx * w
          fy -= ddy * w
        }
      }
    }
    if (fx > 2) fx = 2
    if (fx < -2) fx = -2
    if (fy > 2) fy = 2
    if (fy < -2) fy = -2
    return { x: fx * 0.9, y: fy * 0.9 }
  }

  private localDensity(a: Agent): number {
    const live = this.pool.live
    let n = 0
    const W = this.gridW
    const H = this.gridH
    const gx = Math.floor((a.x - this.gridMinX) / NEIGHBOUR_CELL)
    const gy = Math.floor((a.y - this.gridMinY) / NEIGHBOUR_CELL)
    const lz = this.levelBucket(a.z)
    for (let oy = -1; oy <= 1; oy++) {
      const yy = gy + oy
      if (yy < 0 || yy >= H) continue
      for (let ox = -1; ox <= 1; ox++) {
        const xx = gx + ox
        if (xx < 0 || xx >= W) continue
        const c = (lz * H + yy) * W + xx
        for (let k = this.gStart[c]; k < this.gStart[c + 1]; k++) {
          const b = live[this.gOrder[k]]
          if (b === a) continue
          const ddx = b.x - a.x
          const ddy = b.y - a.y
          if (ddx * ddx + ddy * ddy < 4) n++
        }
      }
    }
    return n
  }

  private buildNeighbourGrid(live: readonly Agent[]): void {
    const n = live.length
    if (this.gOrder.length < n) this.gOrder = new Int32Array(Math.max(n, this.gOrder.length * 2))
    const counts = this.counts
    counts.fill(0)
    const W = this.gridW
    const H = this.gridH
    const W2 = W
    const band = W2 * H
    for (let i = 0; i < n; i++) counts[this.cellIndexFast(live[i], band)]++
    let acc = 0
    const nb = W2 * H * this.gridL
    for (let c = 0; c < nb; c++) {
      this.gStart[c] = acc
      acc += counts[c]
    }
    this.gStart[nb] = acc
    const cursor = counts
    for (let c = 0; c < nb; c++) cursor[c] = this.gStart[c]
    for (let i = 0; i < n; i++) {
      const c = this.cellIndexFast(live[i], band)
      this.gOrder[cursor[c]++] = i
    }
  }

  private cellIndexFast(a: Agent, band: number): number {
    return this.cellIndexAt(a.x, a.y, a.z, band)
  }

  private cellIndexAt(x: number, y: number, z: number, band: number): number {
    let gx = Math.floor((x - this.gridMinX) / NEIGHBOUR_CELL)
    let gy = Math.floor((y - this.gridMinY) / NEIGHBOUR_CELL)
    const W = this.gridW
    const H = this.gridH
    if (gx < 0) gx = 0
    else if (gx >= W) gx = W - 1
    if (gy < 0) gy = 0
    else if (gy >= H) gy = H - 1
    return this.levelBucket(z) * band + gy * W + gx
  }

  private levelBucket(z: number): number {
    const span = Math.max(4, NEIGHBOUR_CELL * 2)
    let lz = Math.floor((z - this.gridMinZ) / span)
    if (lz < 0) lz = 0
    else if (lz >= this.gridL) lz = this.gridL - 1
    return lz
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
      const n = this.nearestNode(a.x, a.y, a.z)
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
