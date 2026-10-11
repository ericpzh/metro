// Fare-line forecasts (§7.2): a queue includes the wave already walking to it.
import type { Agent, AgentPool } from './agents.ts'
import { GATE_FORECAST_MIN_DRAIN_FRACTION, GATE_FORECAST_SECONDS, WALK_SPEED } from './constants.ts'
import type { ServerDef, StationGraph } from './station.ts'
import { AgentState, ZONES, type GateDir } from './types.ts'
import { crossingDir } from './zones.ts'

export class GateTraffic {
  private queued: Float64Array
  private incoming: Float64Array
  private reservations = new Map<number, { server: number; dir: GateDir }>()
  private graph: StationGraph

  constructor(graph: StationGraph) {
    this.graph = graph
    this.queued = new Float64Array(graph.servers.length * 3)
    this.incoming = new Float64Array(this.queued.length)
  }

  refresh(pool: AgentPool): void {
    this.queued.fill(0)
    this.incoming.fill(0)
    this.reservations.clear()
    const agents = pool.all()
    for (const s of this.graph.servers) {
      if (s.kind !== 'gate') continue
      for (const id of s.queue) {
        const a = agents.get(id)
        if (a?.dead) continue
        this.queued[s.id * 3 + (a?.gateDir ?? 0) + 1]++
      }
    }
    for (const a of pool.live) this.reserve(a)
  }

  release(a: Agent): void {
    const old = this.reservations.get(a.id)
    if (!old) return
    this.incoming[old.server * 3 + old.dir + 1]--
    this.reservations.delete(a.id)
  }

  reserve(a: Agent): void {
    this.release(a)
    if (a.dead || a.state !== AgentState.Walking || a.train >= 0 || a.awaitingPath || !a.gateChosen) return
    const g = this.graph
    let lead = 0, px = a.x, py = a.y, pz = a.z
    for (let i = a.pathIdx; i < a.path.length; i++) {
      const n = a.path[i]
      lead += Math.hypot(g.nodeX[n] - px, g.nodeY[n] - py, g.nodeZ[n] - pz)
      if (lead > GATE_FORECAST_SECONDS * WALK_SPEED) return
      px = g.nodeX[n]; py = g.nodeY[n]; pz = g.nodeZ[n]
      const id = g.serverForNode.get(n)
      if (id === undefined || g.servers[id].kind !== 'gate') continue
      if (a.servedFor === id) continue
      const prev = i > 0 ? a.path[i - 1] : n
      const next = i + 1 < a.path.length ? a.path[i + 1] : n
      const dir = crossingDir(ZONES[g.nodeZone[prev]], ZONES[g.nodeZone[next]])
      this.reservations.set(a.id, { server: id, dir })
      this.incoming[id * 3 + dir + 1]++
      return
    }
  }

  join(a: Agent, s: ServerDef): void {
    this.release(a)
    this.queued[s.id * 3 + a.gateDir + 1]++
  }

  leave(a: Agent, s: ServerDef): void {
    const i = s.id * 3 + a.gateDir + 1
    this.queued[i] = Math.max(0, this.queued[i] - 1)
  }

  wait(s: ServerDef, dir: GateDir): number {
    const base = s.id * 3
    const count = (d: GateDir) => this.queued[base + d + 1] + this.incoming[base + d + 1]
    const rate = s.rate
    if (rate <= 0) return 600
    const neutral = count(0)
    let seconds: number
    if (dir === 0 || (s.gateMode !== 'both' && s.gateMode !== undefined)) {
      seconds = (count(-1) + neutral + count(1)) / rate
    } else {
      seconds = (count(dir) + neutral) / rate
      const lane = s.lane || (count(-1) > count(1) ? -1 : count(1) > 0 ? 1 : 0)
      if (lane && lane !== dir) {
        // The opposite side must drain before the lane flips. Its approaching
        // wave replenishes it, so queue/rate alone can underprice it by minutes.
        const opposite = -dir as GateDir
        const arrivals = this.incoming[base + opposite + 1] / GATE_FORECAST_SECONDS
        const drainRate = Math.max(rate * GATE_FORECAST_MIN_DRAIN_FRACTION, rate - arrivals)
        seconds += count(opposite) / drainRate
      }
    }
    return Math.min(600, seconds + Math.max(0, s.cooldown))
  }
}
