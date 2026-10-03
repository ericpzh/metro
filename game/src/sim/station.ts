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
import { floorSpeed } from './finishes.ts'
import { gateAllows } from './gates.ts'
import { exitDoorCell, exitWallPlanes, type ExitWall } from './exits.ts'
import { STOCK, doorCentres } from './stock.ts'
import { edgeCells } from './track.ts'
import { STAIR_WIDTH_NORMAL, stairFlights } from './stairs.ts'
import { ZONES, type GateDir, type GateMode, type StationData } from './types.ts'
import { crossingDir, zoneIndex } from './zones.ts'

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
  /** Gate policy and the direction a two-way lane is currently committed to. */
  gateMode?: GateMode
  lane?: GateDir
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
  /** Floor-finish walk-speed multiplier at each node (§4.3). */
  nodeSpeed: Float32Array
  /** Zone index at each node (§4.5), for trip sampling and the overlay. */
  nodeZone: Uint8Array
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
  stops: Array<{ id: string; node: number; kind: 'tvm' | 'bench' | 'retail' | 'shop' | 'booth' }>
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
  // Cells that host a gate, and the direction each gate passes. Only a gate
  // whose policy allows the crossing force can cross the zone line here, so a
  // one-way gate is a barrier to the other direction (§4.5).
  const gateModes = new Map<string, GateMode>()
  for (const m of data.modules) if (m.type === 'gate') gateModes.set(cellKey(m.x, m.y, m.z), m.cfg.dir)

  // A booth's desk rings the whole floor, so the staff area is not walkable:
  // the crowd is served from outside the counter. Excluding the footprint keeps
  // the graph honest without a solid voxel base (the desk is a thin model).
  const boothCells = new Set<string>()
  for (const m of data.modules) {
    if (m.type !== 'booth') continue
    const w = (m as { w?: number }).w ?? 1
    const h = (m as { h?: number }).h ?? 1
    for (let x = m.x; x < m.x + w; x++) for (let y = m.y; y < m.y + h; y++) boothCells.add(cellKey(x, y, m.z))
  }

  // A fence (围栏, §5.2) is a 1 m thin panel through the middle of its block:
  // the cell it stands on is not walkable, so a fence run plus the gate row it
  // plugs into divides the floor into areas the crowd can only cross at a gate.
  const fenceCells = new Set<string>()
  for (const m of data.modules) {
    if (m.type !== 'fence') continue
    fenceCells.add(cellKey(m.x, m.y, m.z))
  }

  // Walkable = a solid cell with nothing solid directly above it.
  const nodeIndex = new Map<string, number>()
  const keys: string[] = []
  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  const sps: number[] = []
  const zns: number[] = []
  const levelSet = new Set<number>()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of data.cells) {
    if (c.fill !== 'solid') continue
    if (solid.has(cellKey(c.x, c.y, c.z + 1))) continue
    // A floor finish is gameplay (§4.3): a track bed has speed 0 and is not a
    // node at all, so agents cannot route onto the rails.
    const speed = floorSpeed(c)
    if (speed <= 0) continue
    const key = cellKey(c.x, c.y, c.z)
    if (nodeIndex.has(key)) continue
    if (boothCells.has(key)) continue
    if (fenceCells.has(key)) continue
    const id = keys.length
    nodeIndex.set(key, id)
    keys.push(key)
    xs.push(c.x + 0.5)
    ys.push(c.y + 0.5)
    zs.push(c.z + 1)
    sps.push(speed)
    zns.push(zoneIndex(c.zone))
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
  const nodeSpeed = new Float32Array(nodeCount)
  const nodeZone = new Uint8Array(nodeCount)
  for (let i = 0; i < nodeCount; i++) {
    nodeX[i] = xs[i]
    nodeY[i] = ys[i]
    nodeZ[i] = zs[i]
    nodeSpeed[i] = sps[i]
    nodeZone[i] = zns[i]
  }

  const servers: ServerDef[] = []
  const serverForNode = new Map<number, number>()
  const edges: EdgeDraft[] = []
  const platforms: PlatformEdge[] = []
  const exits: Array<{ id: string; node: number; name: string }> = []
  const stops: Array<{ id: string; node: number; kind: 'tvm' | 'bench' | 'retail' | 'shop' | 'booth' }> = []

  const addServer = (s: Omit<ServerDef, 'id' | 'queue' | 'cooldown' | 'served' | 'waitAccum' | 'waitCount'>): number => {
    const id = servers.length
    servers.push({ ...s, id, queue: [], cooldown: 0, served: 0, waitAccum: 0, waitCount: 0, lane: s.lane ?? 0 })
    return id
  }

  // Exit head-houses are solid: the crowd crosses at the street opening and
  // never through the glass sides or the back wall. Each wall is a thin plane
  // (see sim/exits.ts); an edge that crosses one inside its span is dropped,
  // exactly like a zone boundary above.
  const exitWalls: ExitWall[] = []
  for (const m of data.modules) {
    if (m.type !== 'exit' || m.cfg.headHouse === false) continue
    exitWalls.push(...exitWallPlanes(m))
  }
  const crossesExitWall = (x: number, y: number, nx: number, ny: number): boolean => {
    for (const w of exitWalls) {
      if (w.axis === 'x') {
        if ((x - w.at) * (nx - w.at) >= 0) continue
        const cy = y + ((w.at - x) / (nx - x)) * (ny - y)
        if (cy > w.min && cy < w.max) return true
      } else {
        if ((y - w.at) * (ny - w.at) >= 0) continue
        const cx = x + ((w.at - y) / (ny - y)) * (nx - x)
        if (cx > w.min && cx < w.max) return true
      }
    }
    return false
  }

  // A ramp's balustrade is a barrier too (§5.4): the side glass is not a door.
  // A walk edge across either side plane is dropped, so the crowd enters and
  // leaves at the landing tile *along* the run and never steps through the
  // glass. The planes are the run centreline offset by the balustrade half-
  // width, extended a little past each landing so the side edge that shares the
  // landing's row actually crosses it.
  interface RampWall {
    ax: number
    ay: number
    bx: number
    by: number
  }
  const rampWalls: RampWall[] = []
  for (const m of data.modules) {
    if (m.type !== 'escalator' && m.type !== 'stair') continue
    // A stair may turn: every flight gets its own pair of side walls, so the
    // crowd boards each flight along its run and never through the glass.
    const segs = m.type === 'stair' ? stairFlights(m) : [{ from: m.from, to: m.to }]
    const half = m.type === 'escalator' ? 0.52 : (m.cfg.width ?? STAIR_WIDTH_NORMAL) / 2
    for (const seg of segs) {
      const ax = seg.from.x + 0.5
      const ay = seg.from.y + 0.5
      const dx = seg.to.x - seg.from.x
      const dy = seg.to.y - seg.from.y
      const L = Math.hypot(dx, dy)
      if (L < 1e-6) continue // a vertical run (a lift column) has no sides to cross
      const ux = dx / L
      const uy = dy / L
      const EXT = 0.6
      for (const s of [1, -1]) {
        const ox = -uy * half * s
        const oy = ux * half * s
        rampWalls.push({
          ax: ax - ux * EXT + ox,
          ay: ay - uy * EXT + oy,
          bx: ax + dx + ux * EXT + ox,
          by: ay + dy + uy * EXT + oy,
        })
      }
    }
  }
  const segCross = (px: number, py: number, qx: number, qy: number, rx: number, ry: number, sx: number, sy: number): boolean => {
    const side = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
      (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    const d1 = side(px, py, qx, qy, rx, ry)
    const d2 = side(px, py, qx, qy, sx, sy)
    const d3 = side(rx, ry, sx, sy, px, py)
    const d4 = side(rx, ry, sx, sy, qx, qy)
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  }
  const crossesRampWall = (x: number, y: number, nx: number, ny: number): boolean => {
    for (const w of rampWalls) if (segCross(x, y, nx, ny, w.ax, w.ay, w.bx, w.by)) return true
    return false
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
      // §4.5: a zone boundary is a movement barrier. The only crossing is a
      // cell that hosts a gate, and only if that gate actually passes this
      // direction — so an ungated line traps the crowd and a one-way gate
      // turns away the direction it does not serve.
      if (nodeZone[i] !== nodeZone[j]) {
        const dir = crossingDir(ZONES[nodeZone[i]], ZONES[nodeZone[j]])
        const mi = gateModes.get(cellKey(x, y, z))
        const mj = gateModes.get(cellKey(nx, ny, z))
        const ok = (mi !== undefined && gateAllows(mi, dir)) || (mj !== undefined && gateAllows(mj, dir))
        if (!ok) continue
      }
      // §5.6: an exit head-house wall is a barrier too — the opening is the way.
      if (crossesExitWall(x + 0.5, y + 0.5, nx + 0.5, ny + 0.5)) continue
      // §5.4: a ramp's balustrade is a barrier — board at the landing, along the run.
      if (crossesRampWall(x + 0.5, y + 0.5, nx + 0.5, ny + 0.5)) continue
      // Cost carries the finish speed of both ends, so a concrete floor is a
      // real detour and routing prefers the faster surface.
      const speed = (nodeSpeed[i] + nodeSpeed[j]) / 2
      edges.push({ from: i, to: j, cost: 1 / (WALK_SPEED * speed), kind: KIND_WALK, server: -1 })
    }
  }

  const nodeAt = (v: { x: number; y: number; z: number }): number => nodeIndex.get(cellKey(v.x, v.y, v.z)) ?? -1

  for (const m of data.modules) {
    switch (m.type) {
      case 'exit': {
        // A head-house's node is its street opening, not the cell under the
        // canopy — so the crowd visibly walks out through the doorway. A bare
        // portal (headHouse: false) keeps the module cell.
        const door = m.cfg.headHouse === false ? undefined : nodeIndex.get(cellKey(...exitDoorCell(m)))
        const n = door ?? nodeIndex.get(cellKey(m.x, m.y, m.z))
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
            gateMode: m.cfg.dir,
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
      case 'retail':
      case 'shop': {
        // The anchor corner is a perimeter wall cell (non-walkable once the
        // auto walls stack above it), so the stop rides on the first walkable
        // cell inside the room — the doorway end, falling back to the centre.
        let n: number | undefined
        if (m.type === 'retail') {
          n = nodeIndex.get(cellKey(m.x, m.y, m.z))
        } else {
          const cx = m.x + Math.floor(m.w / 2)
          const cy = m.y + Math.floor(m.h / 2)
          n =
            nodeIndex.get(cellKey(cx, m.y, m.z)) ??
            nodeIndex.get(cellKey(m.x, cy, m.z)) ??
            nodeIndex.get(cellKey(cx, cy, m.z)) ??
            nodeIndex.get(cellKey(m.x + 1, m.y + 1, m.z))
          if (n === undefined) {
            outer: for (let y = m.y; y < m.y + m.h; y++) {
              for (let x = m.x; x < m.x + m.w; x++) {
                const c = nodeIndex.get(cellKey(x, y, m.z))
                if (c !== undefined) {
                  n = c
                  break outer
                }
              }
            }
          }
        }
        if (n !== undefined) stops.push({ id: m.id, node: n, kind: m.type as 'retail' | 'shop' })
        break
      }
      case 'booth': {
        // Served from outside the desk: the stop is the nearest walkable cell
        // ringing the counter, front (south) first.
        const w = (m as { w?: number }).w ?? 1
        const h = (m as { h?: number }).h ?? 1
        const cx = m.x + Math.floor(w / 2)
        const cy = m.y + Math.floor(h / 2)
        const ring: Array<[number, number]> = [
          [cx, m.y - 1],
          [m.x - 1, cy],
          [m.x + w, cy],
          [cx, m.y + h],
          [m.x - 1, m.y - 1],
          [m.x + w, m.y - 1],
          [m.x - 1, m.y + h],
          [m.x + w, m.y + h],
        ]
        let bn: number | undefined
        for (const [x, y] of ring) {
          const c = nodeIndex.get(cellKey(x, y, m.z))
          if (c !== undefined) {
            bn = c
            break
          }
        }
        if (bn !== undefined) stops.push({ id: m.id, node: bn, kind: 'booth' })
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
            label: m.cfg.dir === 'up' ? '上行扶梯' : '下行扶梯',
            rate: ESCALATOR_RATE,
            node: a,
            exitNode: b,
            ride,
            batch: 1,
            cycle: 0,
          })
          edges.push({ from: a, to: b, cost: ride, kind: KIND_ESCALATOR, server: id })
        } else if (m.type === 'stair') {
          // Each flight is its own capacity-limited, two-way edge, and the
          // landings between them are walkable nodes, so a turning stair is
          // walked one flight at a time (§5.1).
          for (const f of stairFlights(m)) {
            const fa = nodeAt(f.from)
            const fb = nodeAt(f.to)
            if (fa < 0 || fb < 0) continue
            const fh = Math.hypot(nodeX[fa] - nodeX[fb], nodeY[fa] - nodeY[fb])
            const fv = Math.abs(nodeZ[fa] - nodeZ[fb])
            const fride = Math.hypot(fh, fv) / STAIR_SPEED
            const down = nodeZ[fa] > nodeZ[fb]
            const idDown = addServer({
              kind: 'stair',
              label: '楼梯',
              rate: (down ? STAIR_RATE_DOWN : STAIR_RATE_UP) * m.cfg.width,
              node: fa,
              exitNode: fb,
              ride: fride,
              batch: 1,
              cycle: 0,
            })
            edges.push({ from: fa, to: fb, cost: fride, kind: KIND_STAIR, server: idDown })
            const idUp = addServer({
              kind: 'stair',
              label: '楼梯',
              rate: (down ? STAIR_RATE_UP : STAIR_RATE_DOWN) * m.cfg.width,
              node: fb,
              exitNode: fa,
              ride: fride,
              batch: 1,
              cycle: 0,
            })
            edges.push({ from: fb, to: fa, cost: fride, kind: KIND_STAIR, server: idUp })
          }
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
        const run = edgeCells(m)
        const nDoors = line ? doorCentres(line).length : m.w
        for (const [x, y] of run) {
          const n = nodeIndex.get(cellKey(x, y, m.z))
          if (n === undefined) continue
          cells.push(n)
        }
        const step = Math.max(1, Math.floor(run.length / Math.max(1, nDoors)))
        for (let i = 0; i < run.length && doors.length < nDoors; i += step) {
          const [x, y] = run[i]
          const n = nodeIndex.get(cellKey(x, y, m.z))
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
    nodeSpeed,
    nodeZone,
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
   * A one-off search that neither reads nor writes the cache and does not
   * consume the amortised budget. Used at the fare line, where the gate choice
   * has to reflect the queues *now* — a shared cached path would commit a whole
   * wave to one gate before any of them arrived (§7.2).
   */
  search(from: number, to: number, needs: Needs): Int32Array | null {
    if (from < 0 || to < 0) return null
    if (from === to) return EMPTY_PATH
    return this.astar(from, to, needs, false)
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
  astar(start: number, goal: number, needs: Needs, count = true): Int32Array | null {
    const g = this.graph
    if (count) this.searches++
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
