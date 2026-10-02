// The agent pool. Agents are objects (not struct-of-arrays) because at the
// 3,000-agent target the object form is negligible, and removal with stable ids
// is what keeps queue membership and determinism simple. The numeric state
// arrays and the tick loop still avoid per-tick allocation.

import { PATIENCE_MAX, PATIENCE_MIN } from './constants.ts'
import type { Rng } from './rng.ts'
import { AgentState, type GateDir, type Trip } from './types.ts'

export interface Needs {
  stepFree: boolean
  luggage: boolean
}

export interface Agent {
  id: number
  seed: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  state: number
  /** Free-flow speed, m/s. */
  speed: number
  /** Dwell/service countdown, seconds. */
  timer: number
  /** Seconds waited in the current queue (metrics + patience). */
  wait: number
  patience: number
  trip: Trip
  legs: Array<{ node: number; kind: 'stop' | 'exit' | 'line'; ref: string }>
  legIdx: number
  path: Int32Array
  pathIdx: number
  /** Node the current path starts from (for re-path decisions). */
  fromNode: number
  destNode: number
  needs: Needs
  group: number
  comfort: number
  /** Server the agent is queued in, or -1. */
  server: number
  /** Gate/stop server already handled on this leg. */
  servedFor: number
  /**
   * For a fare gate: the node the passenger approached from, so its wait holds
   * just outside the gate footprint instead of on the gate node in the lane.
   */
  gateWaitNode: number
  /** Direction this agent crosses the fare line at the gate it is queued at. */
  gateDir: GateDir
  /** True once this leg has re-chosen a gate at the fare line. */
  gateChosen: boolean
  /** Vertical ride interpolation. */
  rideFromX: number
  rideFromY: number
  rideFromZ: number
  rideToX: number
  rideToY: number
  rideToZ: number
  rideT: number
  rideTotal: number
  /** Chosen platform door server, or -1. */
  door: number
  /** Chosen exit id for a leaving leg. */
  exitId: string
  spawnedTick: number
  /** Set when this agent should be removed after the tick. */
  dead: boolean
  /** True while an A* request for this leg is in the per-tick budget queue. */
  awaitingPath: boolean
}

export class AgentPool {
  private free: Agent[] = []
  private liveList: Agent[] = []
  private byId = new Map<number, Agent>()
  nextId = 1
  private rng: Rng

  constructor(rng: Rng) {
    this.rng = rng
  }

  get count(): number {
    return this.liveList.length
  }

  get live(): readonly Agent[] {
    return this.liveList
  }

  all(): Map<number, Agent> {
    return this.byId
  }

  spawn(trip: Trip, x: number, y: number, z: number, tick: number): Agent | null {
    const a = this.free.pop() ?? ({} as Agent)
    const seed = this.rng.int(0x7fffffff)
    a.id = this.nextId++
    a.seed = seed
    a.x = x
    a.y = y
    a.z = z
    a.vx = 0
    a.vy = 0
    a.state = AgentState.Arriving
    a.speed = 1.34
    a.timer = 0
    a.wait = 0
    a.patience = this.rng.range(PATIENCE_MIN, PATIENCE_MAX)
    a.trip = trip
    a.legs = []
    a.legIdx = 0
    a.path = EMPTY
    a.pathIdx = 0
    a.fromNode = -1
    a.destNode = -1
    a.needs = { stepFree: this.rng.chance(0.03), luggage: this.rng.chance(0.08) }
    a.group = 1
    a.comfort = 1
    a.server = -1
    a.servedFor = -1
    a.gateWaitNode = -1
    a.gateDir = 0
    a.gateChosen = false
    a.rideT = 0
    a.rideTotal = 0
    a.door = -1
    a.exitId = ''
    a.spawnedTick = tick
    a.dead = false
    a.awaitingPath = false
    this.liveList.push(a)
    this.byId.set(a.id, a)
    return a
  }

  kill(a: Agent): void {
    if (a.dead) return
    a.dead = true
    this.byId.delete(a.id)
  }

  /** Remove dead agents and return them to the free list. O(n). */
  compact(): void {
    if (this.liveList.length === 0) return
    let w = 0
    for (let i = 0; i < this.liveList.length; i++) {
      const a = this.liveList[i]
      if (a.dead) {
        this.free.push(a)
      } else {
        this.liveList[w++] = a
      }
    }
    this.liveList.length = w
  }

  forEach(fn: (a: Agent) => void): void {
    for (let i = 0; i < this.liveList.length; i++) fn(this.liveList[i])
  }

  sorted(): Agent[] {
    return this.liveList.slice().sort((p, q) => p.id - q.id)
  }
}

const EMPTY = new Int32Array(0)
