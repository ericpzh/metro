// The station graph — GAME-SPEC.md §7.2.
//
// Every walkable cell is a node; every placeable thing that moves people is a
// node or a capacity-limited edge. A* runs over the graph, results are cached
// per (from, to, needsClass), and misses go through a per-tick budget so a
// train-borne wave cannot stall the sim (PLAN.md §2.2).

import {
  ESCALATOR_RATE,
  ESCALATOR_SPEED,
  GATE_RATE,
  LIFT_BATCH,
  LIFT_CYCLE,
  MAX_REPATH_PER_TICK,
  PATH_CACHE_MAX,
  STAIR_RATE_DOWN,
  STAIR_RATE_UP,
  STAIR_SPEED,
  TVM_RATE,
  WALK_SPEED,
} from './constants.ts'
import { STOCK, doorCentres } from './stock.ts'
import type { StationData } from './types.ts'

export type ServerKind = 'gate' | 'escalator' | 'stair' | 'lift' | 'door' | 'stop'

export interface ServerDef {
  id: number
  kind: ServerKind
  label: string
  /** Service rate, pax/s. */
  rate: number
  /** Where the queue forms (a graph node). */
  node: number
  /** For vertical modules: the node the agent arrives at. -1 for in-place servers. */
  exitNode: number
  /** Ride time, seconds (vertical modules only). */
  ride: number
  /** Batch size for lifts. */
  batch: number
  /** Fixed cycle time for lifts, seconds. */
  cycle: number
  /** Live queue of agent ids, front = being served. */
  queue: number[]
  cooldown: number
  served: number
  waitAccum: number
  waitCount: number
}

export interface PlatformEdge {
  id: string
  name: string
  line: string
  dir: string
  side: 'left' | 'right'
  /** Door servers, one per door. */
  doors: number[]
  /** Platform nodes, for crowding metrics. */
  cells: number[]
}

export interface StationGraph {
  version: number
  nodeCount: number
  nodeX: Float32Array
  nodeY: Float32Array
  nodeZ: Float32Array
  nodeKey: string[]
  nodeIndex: Map<string, number>
  adjStart: Int32Array
  adjTo: Int32Array
  adjCost: Float32Array
  adjKind: Uint8Array
  adjServer: Int32Array
  servers: ServerDef[]
  serverForNode: Map<number, number>
  platforms: PlatformEdge[]
  exits: Array<{ id: string; node: number; name: string }>
  stops: Array<{ id: string; node: number; kind: 'tvm' | 'bench' | 'retail' }>
  /** Node grid bounds, for density overlays. */
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Walkable nodes bucketed by floor height z (for metrics). */
  levelsZ: number[]
}

const KIND_WALK = 0
const KIND_ESCALATOR = 1
const KIND_STAIR = 2
const KIND_LIFT = 3
export const EDGE_KIND = { walk: KIND_WALK, escalator: KIND_ESCALATOR, stair: KIND_STAIR, lift: KIND_LIFT }

export function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

interface EdgeDraft {
  from: number
  to: number
  cost: number
  kind: number
  server: number
}

export function buildGraph(data: StationData): StationGraph {
  const solid = new Set<string>()
  for (const c of data.cells) if (c.fill === 'solid') solid.add(cellKey(c.x, c.y, c.z))

  // Walkable = a solid cell with nothing solid directly above it.
  const nodeIndex = new Map<string, number>()
  const keys: string[] = []
  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  const levelSet = new Set<number>()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of data.cells) {
    if (c.fill !== 'solid') continue
    if (solid.has(cellKey(c.x, c.y, c.z + 1))) continue
    const key = cellKey(c.x, c.y, c.z)
    if (nodeIndex.has(key)) continue
    const id = keys.length
    nodeIndex.set(key, id)
    keys.push(key)
    xs.push(c.x + 0.5)
    ys.push(c.y + 0.5)
    zs.push(c.z + 1)
    levelSet.add(c.z)
    if (c.x < minX) minX = c.x
    if (c.y < minY) minY = c.y
    if (c.x > maxX) maxX = c.x
    if (c.y > maxY) maxY = c.y
  }

  const nodeCount = keys.length
  const nodeX = new Float32Array(nodeCount)
  const nodeY = new Float32Array(nodeCount)
  const nodeZ = new Float32Array(nodeCount)
  for (let i = 0; i < nodeCount; i++) {
    nodeX[i] = xs[i]
    nodeY[i] = ys[i]
    nodeZ[i] = zs[i]
  }

  const servers: ServerDef[] = []
  const serverForNode = new Map<number, number>()
  const edges: EdgeDraft[] = []
  const platforms: PlatformEdge[] = []
  const exits: Array<{ id: string; node: number; name: string }> = []
  const stops: Array<{ id: string; node: number; kind: 'tvm' | 'bench' | 'retail' }> = []

  const addServer = (s: Omit<ServerDef, 'id' | 'queue' | 'cooldown' | 'served' | 'waitAccum' | 'waitCount'>): number => {
    const id = servers.length
    servers.push({ ...s, id, queue: [], cooldown: 0, served: 0, waitAccum: 0, waitCount: 0 })
    return id
  }

  // Walk edges: 4-neighbour, same surface height.
  for (let i = 0; i < nodeCount; i++) {
    const x = nodeX[i] - 0.5
    const y = nodeY[i] - 0.5
    const z = nodeZ[i] - 1
    const nb = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]
    for (const [nx, ny] of nb) {
      const j = nodeIndex.get(cellKey(nx, ny, z))
      if (j === undefined) continue
      edges.push({ from: i, to: j, cost: 1 / WALK_SPEED, kind: KIND_WALK, server: -1 })
    }
  }

  const nodeAt = (v: { x: number; y: number; z: number }): number => nodeIndex.get(cellKey(v.x, v.y, v.z)) ?? -1

  for (const m of data.modules) {
    switch (m.type) {
      case 'exit': {
        const n = nodeIndex.get(cellKey(m.x, m.y, m.z))
        if (n !== undefined) exits.push({ id: m.id, node: n, name: m.cfg.name })
        break
      }
      case 'gate': {
        const n = nodeIndex.get(cellKey(m.x, m.y, m.z))
        if (n !== undefined) {
          const id = addServer({
            kind: 'gate',
            label: m.cfg.dir === 'both' ? '闸机' : m.cfg.dir === 'in' ? '进站闸机' : '出站闸机',
            rate: GATE_RATE,
            node: n,
            exitNode: -1,
            ride: 0,
            batch: 1,
            cycle: 0,
          })
          serverForNode.set(n, id)
        }
        break
      }
      case 'tvm': {
        const n = nodeIndex.get(cellKey(m.x, m.y, m.z))
        if (n !== undefined) {
          const id = addServer({ kind: 'stop', label: '售票机', rate: TVM_RATE, node: n, exitNode: -1, ride: 0, batch: 1, cycle: 0 })
          stops.push({ id: m.id, node: n, kind: 'tvm' })
          serverForNode.set(n, id)
        }
        break
      }
      case 'bench': {
        const n = nodeIndex.get(cellKey(m.x, m.y, m.z))
        if (n !== undefined) stops.push({ id: m.id, node: n, kind: 'bench' })
        break
      }
      case 'retail': {
        const n = nodeIndex.get(cellKey(m.x, m.y, m.z))
        if (n !== undefined) stops.push({ id: m.id, node: n, kind: 'retail' })
        break
      }
      case 'escalator':
      case 'stair':
      case 'lift': {
        const a = nodeAt(m.from)
        const b = nodeAt(m.to)
        if (a < 0 || b < 0) break
        const horizontal = Math.hypot(nodeX[a] - nodeX[b], nodeY[a] - nodeY[b])
        const vertical = Math.abs(nodeZ[a] - nodeZ[b])
        const dist = Math.hypot(horizontal, vertical)
        if (m.type === 'escalator') {
          const ride = dist / ESCALATOR_SPEED
          const id = addServer({
            kind: 'escalator',
            label: m.cfg.dir === 'up' ? '自动扶梯 上行' : '自动扶梯 下行',
            rate: ESCALATOR_RATE,
            node: a,
            exitNode: b,
            ride,
            batch: 1,
            cycle: 0,
          })
          edges.push({ from: a, to: b, cost: ride, kind: KIND_ESCALATOR, server: id })
        } else if (m.type === 'stair') {
          const ride = dist / STAIR_SPEED
          const down = nodeZ[a] > nodeZ[b]
          const id = addServer({
            kind: 'stair',
            label: '楼梯',
            rate: (down ? STAIR_RATE_DOWN : STAIR_RATE_UP) * m.cfg.width,
            node: a,
            exitNode: b,
            ride,
            batch: 1,
            cycle: 0,
          })
          edges.push({ from: a, to: b, cost: ride, kind: KIND_STAIR, server: id })
          const id2 = addServer({
            kind: 'stair',
            label: '楼梯',
            rate: (down ? STAIR_RATE_UP : STAIR_RATE_DOWN) * m.cfg.width,
            node: b,
            exitNode: a,
            ride,
            batch: 1,
            cycle: 0,
          })
          edges.push({ from: b, to: a, cost: ride, kind: KIND_STAIR, server: id2 })
        } else {
          const ride = LIFT_CYCLE
          const id = addServer({
            kind: 'lift',
            label: '无障碍电梯',
            rate: LIFT_BATCH / LIFT_CYCLE,
            node: a,
            exitNode: b,
            ride,
            batch: LIFT_BATCH,
            cycle: LIFT_CYCLE,
          })
          const id2 = addServer({
            kind: 'lift',
            label: '无障碍电梯',
            rate: LIFT_BATCH / LIFT_CYCLE,
            node: b,
            exitNode: a,
            ride,
            batch: LIFT_BATCH,
            cycle: LIFT_CYCLE,
          })
          edges.push({ from: a, to: b, cost: ride, kind: KIND_LIFT, server: id })
          edges.push({ from: b, to: a, cost: ride, kind: KIND_LIFT, server: id2 })
        }
        break
      }
      case 'platform-edge': {
        const line = data.lines.find((l) => l.id === m.cfg.line)
        const doors: number[] = []
        const cells: number[] = []
        const nDoors = line ? doorCentres(line).length : m.w
        for (let i = 0; i < m.w; i++) {
          const n = nodeIndex.get(cellKey(m.x + i, m.y, m.z))
          if (n === undefined) continue
          cells.push(n)
        }
        const step = Math.max(1, Math.floor(m.w / Math.max(1, nDoors)))
        for (let i = 0; i < m.w && doors.length < nDoors; i += step) {
          const n = nodeIndex.get(cellKey(m.x + i, m.y, m.z))
          if (n === undefined) continue
          const id = addServer({
            kind: 'door',
            label: '站台门',
            rate: 0,
            node: n,
            exitNode: -1,
            ride: 0,
            batch: 1,
            cycle: 0,
          })
          doors.push(id)
        }
        platforms.push({ id: m.id, name: m.cfg.name, line: m.cfg.line, dir: m.cfg.dir, side: m.cfg.side, doors, cells })
        break
      }
      case 'track':
        break
    }
  }

  // CSR adjacency.
  const adjStart = new Int32Array(nodeCount + 1)
  for (const e of edges) adjStart[e.from + 1]++
  for (let i = 0; i < nodeCount; i++) adjStart[i + 1] += adjStart[i]
  const adjTo = new Int32Array(edges.length)
  const adjCost = new Float32Array(edges.length)
  const adjKind = new Uint8Array(edges.length)
  const adjServer = new Int32Array(edges.length)
  const cursor = adjStart.slice(0, nodeCount)
  for (const e of edges) {
    const k = cursor[e.from]++
    adjTo[k] = e.to
    adjCost[k] = e.cost
    adjKind[k] = e.kind
    adjServer[k] = e.server
  }

  return {
    version: 1,
    nodeCount,
    nodeX,
    nodeY,
    nodeZ,
    nodeKey: keys,
    nodeIndex,
    adjStart,
    adjTo,
    adjCost,
    adjKind,
    adjServer,
    servers,
    serverForNode,
    platforms,
    exits,
    stops,
    minX: Number.isFinite(minX) ? minX : 0,
    minY: Number.isFinite(minY) ? minY : 0,
    maxX: Number.isFinite(maxX) ? maxX : 0,
    maxY: Number.isFinite(maxY) ? maxY : 0,
    levelsZ: [...levelSet].sort((a, b) => a - b),
  }
}

/* ------------------------------------------------------------------ A* */

class MinHeap {
  private nodes: Int32Array
  private prio: Float64Array
  private len = 0

  constructor(cap = 1024) {
    this.nodes = new Int32Array(cap)
    this.prio = new Float64Array(cap)
  }

  clear(): void {
    this.len = 0
  }

  get size(): number {
    return this.len
  }

  push(n: number, p: number): void {
    if (this.len === this.nodes.length) {
      const n2 = new Int32Array(this.len * 2)
      const p2 = new Float64Array(this.len * 2)
      n2.set(this.nodes)
      p2.set(this.prio)
      this.nodes = n2
      this.prio = p2
    }
    let i = this.len++
    this.nodes[i] = n
    this.prio[i] = p
    while (i > 0) {
      const par = (i - 1) >> 1
      if (this.prio[par] <= this.prio[i]) break
      this.swap(par, i)
      i = par
    }
  }

  pop(): number {
    const top = this.nodes[0]
    this.len--
    if (this.len > 0) {
      this.nodes[0] = this.nodes[this.len]
      this.prio[0] = this.prio[this.len]
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.len && this.prio[l] < this.prio[m]) m = l
        if (r < this.len && this.prio[r] < this.prio[m]) m = r
        if (m === i) break
        this.swap(m, i)
        i = m
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const n = this.nodes[a]
    const p = this.prio[a]
    this.nodes[a] = this.nodes[b]
    this.prio[a] = this.prio[b]
    this.nodes[b] = n
    this.prio[b] = p
  }
}

export interface Needs {
  /** Cannot use stairs or escalators; forces the lift path (§7.4a). */
  stepFree: boolean
  /** Luggage — prefers accessible gates. */
  luggage: boolean
}

/** needsClass key for the path cache. */
export function needsClass(n: Needs): string {
  return n.stepFree ? 'S' : n.luggage ? 'L' : 'N'
}

export interface PendingRequest {
  agentId: number
  from: number
  to: number
  needs: Needs
}

export class PathFinder {
  graph: StationGraph
  cache: Map<string, Int32Array> = new Map()
  pending: PendingRequest[] = []
  private gScore: Float64Array
  private cameFrom: Int32Array
  private seen: Int32Array
  private epoch = 0
  private heap = new MinHeap()
  searches = 0
  cacheHits = 0

  constructor(graph: StationGraph) {
    this.graph = graph
    this.gScore = new Float64Array(graph.nodeCount)
    this.cameFrom = new Int32Array(graph.nodeCount)
    this.seen = new Int32Array(graph.nodeCount)
  }

  /** Synchronous lookup: cached path event, or queue a request. */
  request(agentId: number, from: number, to: number, needs: Needs): Int32Array | null {
    if (from < 0 || to < 0) return null
    if (from === to) return EMPTY_PATH
    const key = `${from}|${to}|${needsClass(needs)}`
    const hit = this.cache.get(key)
    if (hit) {
      this.cacheHits++
      this.touch(key, hit)
      return hit
    }
    this.pending.push({ agentId, from, to, needs })
    return null
  }

  private touch(key: string, path: Int32Array): void {
    // Small LRU: re-insert to keep hot entries from being evicted.
    this.cache.delete(key)
    this.cache.set(key, path)
  }

  /**
   * Amortise A* across ticks. Cache hits are free — only real searches consume
   * the per-tick budget, so a wave that shares a corridor resolves in one tick
   * while a wave of genuinely distinct legs still cannot stall the sim.
   */
  process(limit = MAX_REPATH_PER_TICK): PendingRequest[] {
    const done: PendingRequest[] = []
    let n = 0
    while (this.pending.length > 0) {
      const key = `${this.pending[0].from}|${this.pending[0].to}|${needsClass(this.pending[0].needs)}`
      if (this.cache.has(key)) {
        const req = this.pending.shift() as PendingRequest
        this.touch(key, this.cache.get(key) as Int32Array)
        done.push(req)
        continue
      }
      if (n >= limit) break
      const req = this.pending.shift() as PendingRequest
      const path = this.astar(req.from, req.to, req.needs)
      if (path) {
        if (this.cache.size >= PATH_CACHE_MAX) {
          // Drop the oldest quarter.
          let drop = PATH_CACHE_MAX >> 2
          for (const k of this.cache.keys()) {
            this.cache.delete(k)
            if (--drop <= 0) break
          }
        }
        this.cache.set(key, path)
      }
      done.push(req)
      n++
    }
    return done
  }

  /** Drop cached paths (queue waits drift) but keep in-flight requests. */
  clear(): void {
    this.cache.clear()
  }

  get pendingCount(): number {
    return this.pending.length
  }

  /** Plain A* over the CSR graph. Returns node ids from start to goal. */
  astar(start: number, goal: number, needs: Needs): Int32Array | null {
    const g = this.graph
    this.searches++
    this.epoch++
    const ep = this.epoch
    const { adjStart, adjTo, adjCost, adjKind, adjServer, nodeX, nodeY, nodeZ, servers, serverForNode } = g
    const heap = this.heap
    heap.clear()
    this.gScore[start] = 0
    this.seen[start] = ep
    this.cameFrom[start] = -1
    heap.push(start, this.h(start, goal, nodeX, nodeY, nodeZ))
    while (heap.size > 0) {
      const cur = heap.pop()
      if (cur === goal) {
        // Reconstruct.
        let len = 1
        let p = cur
        while (this.cameFrom[p] !== -1) {
          p = this.cameFrom[p]
          len++
        }
        const out = new Int32Array(len)
        p = cur
        for (let i = len - 1; i >= 0; i--) {
          out[i] = p
          p = this.cameFrom[p]
        }
        return out
      }
      const gs = this.gScore[cur]
      for (let e = adjStart[cur]; e < adjStart[cur + 1]; e++) {
        const kind = adjKind[e]
        if (needs.stepFree && (kind === KIND_STAIR || kind === KIND_ESCALATOR)) continue
        const nb = adjTo[e]
        let ecost = adjCost[e]
        // §7.2: the edge cost carries the live queue wait, so the crowd spreads
        // across escalators and gates instead of all taking the nearest one.
        const sv = adjServer[e]
        if (sv >= 0) ecost += queueWait(servers[sv])
        let ng = gs + ecost
        const gsv = serverForNode.get(nb)
        if (gsv !== undefined) ng += queueWait(servers[gsv])
        if (this.seen[nb] === ep && this.gScore[nb] <= ng) continue
        this.seen[nb] = ep
        this.gScore[nb] = ng
        this.cameFrom[nb] = cur
        heap.push(nb, ng + this.h(nb, goal, nodeX, nodeY, nodeZ))
      }
    }
    return null
  }

  private h(n: number, goal: number, nx: Float32Array, ny: Float32Array, nz: Float32Array): number {
    return Math.hypot(nx[n] - nx[goal], ny[n] - ny[goal], nz[n] - nz[goal]) / WALK_SPEED
  }
}

const EMPTY_PATH = new Int32Array(0)

/** Estimated wait at a capacity-limited edge, seconds. Capped so A* stays sane. */
function queueWait(s: ServerDef): number {
  const w = s.rate > 0 ? s.queue.length / s.rate : s.queue.length
  return w > 600 ? 600 : w
}

export function stockDoorsPerSide(line: { stock: 'A' | 'B' | 'C' }): number {
  return STOCK[line.stock].doorsPerSide
}

export { doorCentres, STOCK }
