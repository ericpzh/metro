// Static 16×16 sector/region decomposition, contiguous boundary crossings, explicit
// service/restricted arcs, concourse samples and per-sector topology diffing
// (design/crowd-routing-plan.md §1, §3, §4.1, §4.5).
import { WALK_SPEED } from './constants.ts'
import { EDGE_KIND, gateApproach, type StationGraph } from './station.ts'
import type { GateDir } from './types.ts'
import {
  hash32Init,
  hash32Mix,
  hash32Tile,
  packSectorKey,
  packTileKey,
  sectorOfTile,
  toMs,
  unpackSectorKey,
} from './sparsePolicy.ts'

export interface SparseCrossing {
  readonly id: number
  readonly stableKey: string
  readonly fromRegion: number
  readonly toRegion: number
  readonly fromRegionKey: number
  readonly toRegionKey: number
  /** All legal (u -> v) edge pairs in this contiguous crossing run. */
  fromNodes: Int32Array
  toNodes: Int32Array
  costMs: Int32Array
  /** Sorted unique departure nodes (dense ids) for multi-source reverse field seeding. */
  uniqueFromNodes: Int32Array
  /** Stable TileKeys for uniqueFromNodes (for FieldKey and remapping). */
  readonly uniqueFromKeys: Float64Array
  /** Representative pair (middle of run in stable spatial order). */
  repFromNode: number
  repToNode: number
  readonly repFromKey: number
  readonly repToKey: number
  readonly repCostMs: number
  readonly fromHalfWalkMs: number
  readonly toHalfWalkMs: number
  readonly regionWalkMs: number
}

export interface SparseExplicitArc {
  readonly id: number
  fromNode: number
  toNode: number
  readonly fromKey: number
  readonly toKey: number
  readonly fromRegion: number
  readonly toRegion: number
  readonly kind: number
  readonly server: number
  readonly fromNodeServer: number
  readonly toNodeServer: number
  readonly gateDir: GateDir
  readonly staticCostMs: number
  readonly fromHalfWalkMs: number
  readonly toHalfWalkMs: number
}

export interface SparseRegion {
  readonly id: number
  /** Stable identity: minimum TileKey in the connected component. */
  readonly regionKey: number
  readonly sectorKey: number
  revision: number
  /** Dense node ids in this region, sorted by ascending TileKey. */
  nodes: Int32Array
  /** Stable TileKeys matching `nodes`. */
  readonly tileKeys: Float64Array
  /** Mean tile centroid & free-flow ms/m for region-level reverse coarse trees. */
  readonly centerX: number
  readonly centerY: number
  readonly walkMsPerM: number
  /** Outgoing plain crossings from this region (in stable order). */
  crossings: SparseCrossing[]
  /** Outgoing explicit directed/service arcs from this region (in stable order). */
  explicitArcs: SparseExplicitArc[]
  /** Incoming plain crossings arriving in this region. */
  inCrossings: SparseCrossing[]
  /** Incoming explicit directed/service arcs arriving in this region. */
  inExplicitArcs: SparseExplicitArc[]
  /** Stable TileKey of the concourse sample, or -1 if none. */
  sampleTileKey: number
  /** Dense node id of the concourse sample, or -1 if none. */
  sampleNode: number
}

export interface SparseSector {
  readonly sectorKey: number
  readonly sx: number
  readonly sy: number
  readonly tz2: number
  revision: number
  signature: number
  regionIds: number[]
}

export interface TopologyDiff {
  readonly routingNeutral: boolean
  readonly topologyRevision: number
  readonly dirtySectorKeys: number[]
  readonly preservedRegionKeys: Set<number>
  readonly dirtyRegionKeys: Set<number>
}

export class SparseTopology {
  graph: StationGraph
  readonly seed: number
  topologyRevision: number

  // Per-node stable coordinates & lookup
  nodeTx: Int32Array
  nodeTy: Int32Array
  nodeTz2: Int32Array
  nodeTileKey: Float64Array
  tileKeyToNode: Map<number, number>

  // Bidirectional plain-walk CSR (same elevation, Walk, no edge server, no gate endpoints)
  plainAdjStart: Int32Array
  plainAdjTo: Int32Array
  plainAdjCostMs: Int32Array

  // Dense node -> region & local index inside region (0..region.nodes.length-1)
  nodeRegion: Int32Array
  nodeLocalIdx: Int32Array

  sectors: Map<number, SparseSector>
  regions: SparseRegion[]
  regionByKey: Map<number, SparseRegion>
  crossings: SparseCrossing[]
  explicitArcs: SparseExplicitArc[]
  hasLifts = false

  /** Sectors whose optional concourse samples need refresh: sectorKey -> dirty sector.revision. */
  samplesDirty = new Map<number, number>()

  // Lazy reverse region adjacency CSR + per-(goalRegion, stepFree) reachability bitsets.
  private revAdjBuilt = false
  private revAllStart: Int32Array | null = null
  private revAllFrom: Int32Array | null = null
  private revStepFreeStart: Int32Array | null = null
  private revStepFreeFrom: Int32Array | null = null
  private reachCache = new Map<number, Uint32Array>()

  constructor(graph: StationGraph, seed: number, topologyRevision = 1) {
    this.graph = graph
    this.seed = seed
    this.topologyRevision = topologyRevision
    const n = graph.nodeCount
    this.nodeTx = new Int32Array(n)
    this.nodeTy = new Int32Array(n)
    this.nodeTz2 = new Int32Array(n)
    this.nodeTileKey = new Float64Array(n)
    this.tileKeyToNode = new Map()
    this.plainAdjStart = new Int32Array(n + 1)
    this.plainAdjTo = new Int32Array(0)
    this.plainAdjCostMs = new Int32Array(0)
    this.nodeRegion = new Int32Array(n)
    this.nodeLocalIdx = new Int32Array(n)
    this.nodeRegion.fill(-1)
    this.nodeLocalIdx.fill(-1)
    this.sectors = new Map()
    this.regions = []
    this.regionByKey = new Map()
    this.crossings = []
    this.explicitArcs = []
  }

  /** Compute usable sample tile for a region, retaining `oldSampleKey` if still clear. */
  refreshRegionSample(region: SparseRegion, oldSampleKey: number): number {
    const plainStart = this.plainAdjStart
    const isClear = (node: number, minDeg: number): boolean => {
      if (node < 0 || this.graph.serverForNode.has(node)) return false
      return plainStart[node + 1] - plainStart[node] >= minDeg
    }

    if (oldSampleKey >= 0) {
      const oldNode = this.tileKeyToNode.get(oldSampleKey)
      if (oldNode !== undefined && this.nodeRegion[oldNode] === region.id && isClear(oldNode, 4)) {
        region.sampleTileKey = oldSampleKey
        region.sampleNode = oldNode
        return oldSampleKey
      }
    }

    let bestNode = -1
    let bestHash = 0xffffffff
    let bestKey = Infinity
    for (const minDeg of [4, 2]) {
      for (let i = 0; i < region.nodes.length; i++) {
        const node = region.nodes[i]
        if (!isClear(node, minDeg)) continue
        const h = hash32Tile(this.seed, this.nodeTx[node], this.nodeTy[node], this.nodeTz2[node])
        const key = region.tileKeys[i]
        if (h < bestHash || (h === bestHash && key < bestKey)) {
          bestHash = h
          bestKey = key
          bestNode = node
        }
      }
      if (bestNode >= 0) break
    }
    region.sampleNode = bestNode
    region.sampleTileKey = bestNode >= 0 ? bestKey : -1
    return region.sampleTileKey
  }

  private ensureRevRegionAdj(): void {
    if (this.revAdjBuilt) return
    this.revAdjBuilt = true
    const rCount = this.regions.length
    const allCounts = new Int32Array(rCount)
    const sfCounts = new Int32Array(rCount)
    for (let r = 0; r < rCount; r++) {
      const reg = this.regions[r]
      for (let i = 0; i < reg.crossings.length; i++) {
        const to = reg.crossings[i].toRegion
        if (to >= 0 && to < rCount) {
          allCounts[to]++
          sfCounts[to]++
        }
      }
      for (let i = 0; i < reg.explicitArcs.length; i++) {
        const arc = reg.explicitArcs[i]
        const to = arc.toRegion
        if (to >= 0 && to < rCount) {
          allCounts[to]++
          if (arc.kind !== EDGE_KIND.stair && arc.kind !== EDGE_KIND.escalator) {
            sfCounts[to]++
          }
        }
      }
    }
    const allStart = new Int32Array(rCount + 1)
    const sfStart = new Int32Array(rCount + 1)
    for (let r = 0; r < rCount; r++) {
      allStart[r + 1] = allStart[r] + allCounts[r]
      sfStart[r + 1] = sfStart[r] + sfCounts[r]
    }
    const allFrom = new Int32Array(allStart[rCount])
    const sfFrom = new Int32Array(sfStart[rCount])
    const allCur = allStart.slice(0, rCount)
    const sfCur = sfStart.slice(0, rCount)
    for (let r = 0; r < rCount; r++) {
      const reg = this.regions[r]
      for (let i = 0; i < reg.crossings.length; i++) {
        const to = reg.crossings[i].toRegion
        if (to >= 0 && to < rCount) {
          allFrom[allCur[to]++] = r
          sfFrom[sfCur[to]++] = r
        }
      }
      for (let i = 0; i < reg.explicitArcs.length; i++) {
        const arc = reg.explicitArcs[i]
        const to = arc.toRegion
        if (to >= 0 && to < rCount) {
          allFrom[allCur[to]++] = r
          if (arc.kind !== EDGE_KIND.stair && arc.kind !== EDGE_KIND.escalator) {
            sfFrom[sfCur[to]++] = r
          }
        }
      }
    }
    this.revAllStart = allStart
    this.revAllFrom = allFrom
    this.revStepFreeStart = sfStart
    this.revStepFreeFrom = sfFrom
  }

  /**
   * Exact static reachability between two graph nodes under `stepFree`.
   * Equivalent to fine-graph reachability because every region is a connected component
   * of bidirectional plain walk edges and every non-plain edge is an explicit arc.
   */
  canReach(fromNode: number, toNode: number, stepFree: boolean): boolean {
    const n = this.nodeRegion.length
    if (fromNode < 0 || fromNode >= n || toNode < 0 || toNode >= n) return false
    const fromReg = this.nodeRegion[fromNode]
    const toReg = this.nodeRegion[toNode]
    if (fromReg < 0 || toReg < 0) return false
    if (fromReg === toReg) return true

    const cacheKey = toReg * 2 + (stepFree ? 1 : 0)
    let bits = this.reachCache.get(cacheKey)
    if (!bits) {
      this.ensureRevRegionAdj()
      const rCount = this.regions.length
      bits = new Uint32Array((rCount + 31) >>> 5)
      const start = stepFree ? this.revStepFreeStart! : this.revAllStart!
      const from = stepFree ? this.revStepFreeFrom! : this.revAllFrom!
      const queue = new Int32Array(rCount)
      let head = 0
      let tail = 0
      bits[toReg >>> 5] |= 1 << (toReg & 31)
      queue[tail++] = toReg
      while (head < tail) {
        const cur = queue[head++]
        for (let e = start[cur]; e < start[cur + 1]; e++) {
          const prev = from[e]
          const w = prev >>> 5
          const m = 1 << (prev & 31)
          if ((bits[w] & m) === 0) {
            bits[w] |= m
            queue[tail++] = prev
          }
        }
      }
      this.reachCache.set(cacheKey, bits)
    }
    return (bits[fromReg >>> 5] & (1 << (fromReg & 31))) !== 0
  }
}

/** Check if edge `u -> v` has a matching reverse plain walk edge `v -> u`. */
function hasReversePlainWalk(g: StationGraph, u: number, v: number): boolean {
  const uz = g.nodeZ[u]
  if (g.nodeZ[v] !== uz) return false
  for (let e = g.adjStart[v]; e < g.adjStart[v + 1]; e++) {
    if (g.adjTo[e] === u && g.adjKind[e] === EDGE_KIND.walk && g.adjServer[e] < 0) return true
  }
  return false
}

/**
 * Build the complete sparse topology for `graph`.
 * When `previous` is provided (after a committed edit), computes per-sector topology
 * signatures, preserves revisions & samples for untouched sectors, and reports dirty regions.
 */
export function buildSparseTopology(
  graph: StationGraph,
  seed: number,
  previous?: SparseTopology | null,
): { topology: SparseTopology; diff: TopologyDiff } {
  const n = graph.nodeCount
  const topo = new SparseTopology(graph, seed, previous ? previous.topologyRevision : 1)

  // 1. Stable tile keys and per-sector node buckets.
  const sectorNodes = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const tx = Math.floor(graph.nodeX[i])
    const ty = Math.floor(graph.nodeY[i])
    const tz2 = Math.round((graph.nodeZ[i] - 1) * 2)
    const key = packTileKey(tx, ty, tz2)
    topo.nodeTx[i] = tx
    topo.nodeTy[i] = ty
    topo.nodeTz2[i] = tz2
    topo.nodeTileKey[i] = key
    topo.tileKeyToNode.set(key, i)
    const sk = sectorOfTile(tx, ty, tz2).key
    let arr = sectorNodes.get(sk)
    if (!arr) { arr = []; sectorNodes.set(sk, arr) }
    arr.push(i)
  }

  // 2. Build bidirectional plain-walk CSR and flag every non-plain edge as explicit.
  const { adjStart, adjTo, adjCost, adjKind, adjServer, nodeZ, serverForNode } = graph
  const plainCounts = new Int32Array(n)
  const isPlainEdge = new Uint8Array(adjTo.length)
  let plainTotal = 0
  for (let u = 0; u < n; u++) {
    const uGate = serverForNode.has(u)
    const uz = nodeZ[u]
    for (let e = adjStart[u]; e < adjStart[u + 1]; e++) {
      if (uGate || adjKind[e] !== EDGE_KIND.walk || adjServer[e] >= 0) continue
      const v = adjTo[e]
      if (nodeZ[v] !== uz || serverForNode.has(v)) continue
      if (hasReversePlainWalk(graph, u, v)) {
        isPlainEdge[e] = 1
        plainCounts[u]++
        plainTotal++
      }
    }
  }
  const plainAdjStart = topo.plainAdjStart
  for (let u = 0; u < n; u++) plainAdjStart[u + 1] = plainAdjStart[u] + plainCounts[u]
  const plainAdjTo = new Int32Array(plainTotal)
  const plainAdjCostMs = new Int32Array(plainTotal)
  const cursor = plainAdjStart.slice(0, n)
  for (let u = 0; u < n; u++) {
    for (let e = adjStart[u]; e < adjStart[u + 1]; e++) {
      if (!isPlainEdge[e]) continue
      const k = cursor[u]++
      plainAdjTo[k] = adjTo[e]
      plainAdjCostMs[k] = toMs(adjCost[e])
    }
  }
  topo.plainAdjTo = plainAdjTo
  topo.plainAdjCostMs = plainAdjCostMs

  // 3. Sort sectors in stable SectorKey order and build regions + per-sector topology signatures.
  const sortedSectorKeys = [...sectorNodes.keys()].sort((a, b) => a - b)
  const nodeSector = new Float64Array(n)
  const sectorSignature = new Map<number, number>()
  const visited = new Uint8Array(n)
  const bfsQueue: number[] = []

  for (const sk of sortedSectorKeys) {
    const nodes = sectorNodes.get(sk)!
    nodes.sort((a, b) => topo.nodeTileKey[a] - topo.nodeTileKey[b])
    const { sx, sy, tz2 } = unpackSectorKey(sk)
    let sig = hash32Init(0x5e4701)
    sig = hash32Mix(sig, sx)
    sig = hash32Mix(sig, sy)
    sig = hash32Mix(sig, tz2)
    sig = hash32Mix(sig, nodes.length)

    for (let i = 0; i < nodes.length; i++) {
      const u = nodes[i]
      nodeSector[u] = sk
      sig = hash32Mix(sig, topo.nodeTx[u])
      sig = hash32Mix(sig, topo.nodeTy[u])
      sig = hash32Mix(sig, Math.round(graph.nodeSpeed[u] * 1000))
      sig = hash32Mix(sig, graph.nodeZone[u])
      const gateSrv = serverForNode.get(u)
      if (gateSrv !== undefined) {
        const gm = graph.servers[gateSrv].gateMode
        sig = hash32Mix(sig, gm === 'in' ? 1 : gm === 'out' ? 2 : 3)
      } else {
        sig = hash32Mix(sig, 0)
      }
      // Include outgoing edges sorted by destination TileKey & kind so signatures are index-independent.
      const outEdges: Array<{ toKey: number; kind: number; costMs: number; plain: number; srvKind: number }> = []
      for (let e = adjStart[u]; e < adjStart[u + 1]; e++) {
        const v = adjTo[e]
        const sv = adjServer[e]
        const srvKind = sv >= 0 ? serverKindCode(graph.servers[sv].kind) : 0
        outEdges.push({
          toKey: topo.nodeTileKey[v],
          kind: adjKind[e],
          costMs: toMs(adjCost[e]),
          plain: isPlainEdge[e],
          srvKind,
        })
      }
      outEdges.sort((a, b) => a.toKey - b.toKey || a.kind - b.kind || a.costMs - b.costMs || a.srvKind - b.srvKind)
      sig = hash32Mix(sig, outEdges.length)
      for (let j = 0; j < outEdges.length; j++) {
        const oe = outEdges[j]
        sig = hash32Mix(sig, oe.toKey & 0x7fffffff)
        sig = hash32Mix(sig, Math.floor(oe.toKey / 0x80000000))
        sig = hash32Mix(sig, (oe.kind << 8) | (oe.srvKind << 2) | oe.plain)
        sig = hash32Mix(sig, oe.costMs)
      }
    }
    sectorSignature.set(sk, sig)

    const sector: SparseSector = {
      sectorKey: sk,
      sx,
      sy,
      tz2,
      revision: 1,
      signature: sig,
      regionIds: [],
    }
    topo.sectors.set(sk, sector)

    // Flood-fill connected components within this sector using bidirectional plain walk edges.
    for (let i = 0; i < nodes.length; i++) {
      const start = nodes[i]
      if (visited[start]) continue
      visited[start] = 1
      bfsQueue.length = 0
      bfsQueue.push(start)
      let head = 0
      while (head < bfsQueue.length) {
        const cur = bfsQueue[head++]
        for (let e = plainAdjStart[cur]; e < plainAdjStart[cur + 1]; e++) {
          const nb = plainAdjTo[e]
          if (visited[nb] || nodeSector[nb] !== sk) continue
          visited[nb] = 1
          bfsQueue.push(nb)
        }
      }
      bfsQueue.sort((a, b) => topo.nodeTileKey[a] - topo.nodeTileKey[b])
      const regNodes = Int32Array.from(bfsQueue)
      const regKeys = new Float64Array(regNodes.length)
      const regId = topo.regions.length
      let sumX = 0
      let sumY = 0
      let sumSpeed = 0
      for (let k = 0; k < regNodes.length; k++) {
        const u = regNodes[k]
        regKeys[k] = topo.nodeTileKey[u]
        topo.nodeRegion[u] = regId
        topo.nodeLocalIdx[u] = k
        sumX += topo.nodeTx[u]
        sumY += topo.nodeTy[u]
        sumSpeed += graph.nodeSpeed[u] > 0 ? graph.nodeSpeed[u] : 1
      }
      const invCount = regNodes.length > 0 ? 1 / regNodes.length : 1
      const avgSpeed = Math.max(0.1, sumSpeed * invCount)
      const regionKey = regKeys[0]
      const region: SparseRegion = {
        id: regId,
        regionKey,
        sectorKey: sk,
        revision: 1,
        nodes: regNodes,
        tileKeys: regKeys,
        centerX: sumX * invCount,
        centerY: sumY * invCount,
        walkMsPerM: 1000 / (WALK_SPEED * avgSpeed),
        crossings: [],
        explicitArcs: [],
        inCrossings: [],
        inExplicitArcs: [],
        sampleTileKey: -1,
        sampleNode: -1,
      }
      topo.regions.push(region)
      topo.regionByKey.set(regionKey, region)
      sector.regionIds.push(regId)
    }
  }

  // 4. Build crossings and explicit directed arcs per region in stable order.
  for (let rId = 0; rId < topo.regions.length; rId++) {
    const region = topo.regions[rId]
    // Collect plain crossing edges leaving this region, and explicit arcs leaving this region.
    interface RawPlainEdge {
      fromNode: number
      toNode: number
      fromKey: number
      toKey: number
      toRegion: number
      costMs: number
      dx: number
      dy: number
    }
    const rawPlain: RawPlainEdge[] = []
    interface RawExplicit {
      fromNode: number
      toNode: number
      fromKey: number
      toKey: number
      toRegion: number
      kind: number
      server: number
      costMs: number
    }
    const rawExplicit: RawExplicit[] = []

    for (let i = 0; i < region.nodes.length; i++) {
      const u = region.nodes[i]
      const uKey = region.tileKeys[i]
      const ux = topo.nodeTx[u]
      const uy = topo.nodeTy[u]
      for (let e = adjStart[u]; e < adjStart[u + 1]; e++) {
        const v = adjTo[e]
        const vReg = topo.nodeRegion[v]
        if (vReg < 0) continue
        if (isPlainEdge[e]) {
          if (vReg !== rId) {
            rawPlain.push({
              fromNode: u,
              toNode: v,
              fromKey: uKey,
              toKey: topo.nodeTileKey[v],
              toRegion: vReg,
              costMs: toMs(adjCost[e]),
              dx: topo.nodeTx[v] - ux,
              dy: topo.nodeTy[v] - uy,
            })
          }
        } else {
          rawExplicit.push({
            fromNode: u,
            toNode: v,
            fromKey: uKey,
            toKey: topo.nodeTileKey[v],
            toRegion: vReg,
            kind: adjKind[e],
            server: adjServer[e],
            costMs: toMs(adjCost[e]),
          })
        }
      }
    }

    // Group plain crossings by (toRegion, faceSeam) for cardinal edges; attach matching diagonals
    // whose departure tile lies in a cardinal run, and emit orphan diagonal corner crossings alone.
    const cardinalGroups = new Map<string, RawPlainEdge[]>()
    const diagEdges: RawPlainEdge[] = []
    for (let i = 0; i < rawPlain.length; i++) {
      const pe = rawPlain[i]
      if (pe.dx === 0 || pe.dy === 0) {
        const seam = pe.dx > 0 ? 0 : pe.dx < 0 ? 1 : pe.dy > 0 ? 2 : 3
        const gk = `${pe.toRegion}|${seam}`
        let list = cardinalGroups.get(gk)
        if (!list) { list = []; cardinalGroups.set(gk, list) }
        list.push(pe)
      } else {
        diagEdges.push(pe)
      }
    }

    const sortedGroupKeys = [...cardinalGroups.keys()].sort((a, b) => {
      const [ra, sa] = a.split('|').map(Number)
      const [rb, sb] = b.split('|').map(Number)
      return topo.regions[ra].regionKey - topo.regions[rb].regionKey || sa - sb
    })

    // Track which crossing owns a (fromNode, toRegion) for attaching diagonal seam edges.
    const ownerByFromAndToReg = new Map<string, RawPlainEdge[]>()
    const pendingRuns: Array<{ toRegion: number; cardinal: RawPlainEdge[]; all: RawPlainEdge[] }> = []

    for (const gk of sortedGroupKeys) {
      const list = cardinalGroups.get(gk)!
      const seam = Number(gk.split('|')[1])
      const alongY = seam === 0 || seam === 1
      list.sort((a, b) => {
        const ca = alongY ? topo.nodeTy[a.fromNode] : topo.nodeTx[a.fromNode]
        const cb = alongY ? topo.nodeTy[b.fromNode] : topo.nodeTx[b.fromNode]
        return ca - cb || a.fromKey - b.fromKey || a.toKey - b.toKey
      })

      let runStart = 0
      for (let i = 1; i <= list.length; i++) {
        const split = i === list.length ||
          (alongY
            ? topo.nodeTy[list[i].fromNode] !== topo.nodeTy[list[i - 1].fromNode] + 1
            : topo.nodeTx[list[i].fromNode] !== topo.nodeTx[list[i - 1].fromNode] + 1)
        if (!split) continue
        const slice = list.slice(runStart, i)
        const all = slice.slice()
        const toRegion = slice[0].toRegion
        pendingRuns.push({ toRegion, cardinal: slice, all })
        for (const pe of slice) ownerByFromAndToReg.set(`${pe.fromNode}|${toRegion}`, all)
        runStart = i
      }
    }

    // Attach diagonal seam crossings to their matching cardinal run, or create corner run.
    diagEdges.sort((a, b) => topo.regions[a.toRegion].regionKey - topo.regions[b.toRegion].regionKey || a.fromKey - b.fromKey || a.toKey - b.toKey)
    for (const de of diagEdges) {
      const owner = ownerByFromAndToReg.get(`${de.fromNode}|${de.toRegion}`)
      if (owner) {
        owner.push(de)
      } else {
        pendingRuns.push({ toRegion: de.toRegion, cardinal: [de], all: [de] })
      }
    }

    for (const run of pendingRuns) {
      const rep = run.cardinal[Math.floor(run.cardinal.length / 2)]
      const all = run.all
      all.sort((a, b) => a.fromKey - b.fromKey || a.toKey - b.toKey)
      const fromNodes = new Int32Array(all.length)
      const toNodes = new Int32Array(all.length)
      const costMs = new Int32Array(all.length)
      const uniqNodes: number[] = []
      const uniqKeys: number[] = []
      let lastFrom = -1
      for (let i = 0; i < all.length; i++) {
        fromNodes[i] = all[i].fromNode
        toNodes[i] = all[i].toNode
        costMs[i] = all[i].costMs
        if (all[i].fromNode !== lastFrom) {
          lastFrom = all[i].fromNode
          uniqNodes.push(all[i].fromNode)
          uniqKeys.push(all[i].fromKey)
        }
      }
      const toReg = topo.regions[run.toRegion]
      const fromHalfWalkMs = Math.round(Math.hypot(region.centerX - topo.nodeTx[rep.fromNode], region.centerY - topo.nodeTy[rep.fromNode]) * region.walkMsPerM)
      const toHalfWalkMs = Math.round(Math.hypot(toReg.centerX - topo.nodeTx[rep.toNode], toReg.centerY - topo.nodeTy[rep.toNode]) * toReg.walkMsPerM)
      const crossing: SparseCrossing = {
        id: topo.crossings.length,
        stableKey: `${region.regionKey}|${toReg.regionKey}|${rep.fromKey}|${rep.toKey}`,
        fromRegion: rId,
        toRegion: run.toRegion,
        fromRegionKey: region.regionKey,
        toRegionKey: toReg.regionKey,
        fromNodes,
        toNodes,
        costMs,
        uniqueFromNodes: Int32Array.from(uniqNodes),
        uniqueFromKeys: Float64Array.from(uniqKeys),
        repFromNode: rep.fromNode,
        repToNode: rep.toNode,
        repFromKey: rep.fromKey,
        repToKey: rep.toKey,
        repCostMs: rep.costMs,
        fromHalfWalkMs,
        toHalfWalkMs,
        regionWalkMs: fromHalfWalkMs + rep.costMs + toHalfWalkMs,
      }
      topo.crossings.push(crossing)
      region.crossings.push(crossing)
      toReg.inCrossings.push(crossing)
    }

    // Publish explicit directed arcs in stable order.
    rawExplicit.sort((a, b) => a.fromKey - b.fromKey || a.toKey - b.toKey || a.kind - b.kind || a.server - b.server)
    for (const ex of rawExplicit) {
      const fromNodeServer = serverForNode.get(ex.fromNode) ?? -1
      const toNodeServer = serverForNode.get(ex.toNode) ?? -1
      let gDir: GateDir = 0
      if (toNodeServer >= 0 && graph.servers[toNodeServer].kind === 'gate') {
        gDir = gateApproach(graph, ex.fromNode, ex.toNode)
      }
      const toReg = topo.regions[ex.toRegion]
      const fromHalfWalkMs = Math.round(Math.hypot(region.centerX - topo.nodeTx[ex.fromNode], region.centerY - topo.nodeTy[ex.fromNode]) * region.walkMsPerM)
      const toHalfWalkMs = Math.round(Math.hypot(toReg.centerX - topo.nodeTx[ex.toNode], toReg.centerY - topo.nodeTy[ex.toNode]) * toReg.walkMsPerM)
      if (ex.kind === EDGE_KIND.lift) topo.hasLifts = true
      const arc: SparseExplicitArc = {
        id: topo.explicitArcs.length,
        fromNode: ex.fromNode,
        toNode: ex.toNode,
        fromKey: ex.fromKey,
        toKey: ex.toKey,
        fromRegion: rId,
        toRegion: ex.toRegion,
        kind: ex.kind,
        server: ex.server,
        fromNodeServer,
        toNodeServer,
        gateDir: gDir,
        staticCostMs: ex.costMs,
        fromHalfWalkMs,
        toHalfWalkMs,
      }
      topo.explicitArcs.push(arc)
      region.explicitArcs.push(arc)
      toReg.inExplicitArcs.push(arc)
    }
  }

  // 5. Diff against previous topology for per-sector revision retention & dirty marking.
  const preservedRegionKeys = new Set<number>()
  const dirtyRegionKeys = new Set<number>()
  const dirtySectorKeys: number[] = []

  if (!previous) {
    // Initial build: populate initial samples lazily or immediately.
    for (const region of topo.regions) {
      topo.refreshRegionSample(region, -1)
    }
    return {
      topology: topo,
      diff: {
        routingNeutral: false,
        topologyRevision: topo.topologyRevision,
        dirtySectorKeys: sortedSectorKeys,
        preservedRegionKeys,
        dirtyRegionKeys: new Set(topo.regions.map((r) => r.regionKey)),
      },
    }
  }

  // Find directly changed sectors (added, removed, or signature mismatch).
  const directlyChanged = new Set<number>()
  for (const [sk, sec] of topo.sectors) {
    const prevSec = previous.sectors.get(sk)
    if (!prevSec || prevSec.signature !== sec.signature) directlyChanged.add(sk)
  }
  for (const sk of previous.sectors.keys()) {
    if (!topo.sectors.has(sk)) directlyChanged.add(sk)
  }

  if (directlyChanged.size === 0) {
    // Routing-neutral edit: preserve all revisions, samples, and regions!
    topo.topologyRevision = previous.topologyRevision
    for (const [sk, sec] of topo.sectors) {
      const prevSec = previous.sectors.get(sk)!
      sec.revision = prevSec.revision
      for (const rId of sec.regionIds) {
        const reg = topo.regions[rId]
        const prevReg = previous.regionByKey.get(reg.regionKey)
        reg.revision = prevReg ? prevReg.revision : sec.revision
        if (prevReg) {
          preservedRegionKeys.add(reg.regionKey)
          reg.sampleTileKey = prevReg.sampleTileKey
          reg.sampleNode = prevReg.sampleTileKey >= 0 ? (topo.tileKeyToNode.get(prevReg.sampleTileKey) ?? -1) : -1
        }
      }
    }
    for (const [sk, rev] of previous.samplesDirty) {
      if (topo.sectors.has(sk)) topo.samplesDirty.set(sk, rev)
    }
    return {
      topology: topo,
      diff: {
        routingNeutral: true,
        topologyRevision: topo.topologyRevision,
        dirtySectorKeys: [],
        preservedRegionKeys,
        dirtyRegionKeys,
      },
    }
  }

  // Dependency halo: 8 same-level neighbouring sectors + landing sectors of explicit arcs in changed sectors.
  const dirtySet = new Set<number>()
  for (const sk of directlyChanged) {
    const { sx, sy, tz2 } = unpackSectorKey(sk)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        dirtySet.add(packSectorKey(sx + dx, sy + dy, tz2))
      }
    }
  }
  // Include endpoints of explicit arcs entering or leaving any directly changed sector.
  for (const arc of topo.explicitArcs) {
    const fromSk = topo.regions[arc.fromRegion].sectorKey
    const toSk = topo.regions[arc.toRegion].sectorKey
    if (directlyChanged.has(fromSk)) dirtySet.add(toSk)
    if (directlyChanged.has(toSk)) dirtySet.add(fromSk)
  }
  for (const arc of previous.explicitArcs) {
    const fromSk = previous.regions[arc.fromRegion].sectorKey
    const toSk = previous.regions[arc.toRegion].sectorKey
    if (directlyChanged.has(fromSk)) dirtySet.add(toSk)
    if (directlyChanged.has(toSk)) dirtySet.add(fromSk)
  }

  topo.topologyRevision = previous.topologyRevision + 1

  // Carry over existing dirty sample marks on surviving sectors.
  for (const [sk, rev] of previous.samplesDirty) {
    if (topo.sectors.has(sk)) topo.samplesDirty.set(sk, rev)
  }

  for (const sk of sortedSectorKeys) {
    const sec = topo.sectors.get(sk)!
    const prevSec = previous.sectors.get(sk)
    if (dirtySet.has(sk)) {
      sec.revision = (prevSec ? prevSec.revision : 0) + 1
      dirtySectorKeys.push(sk)
      topo.samplesDirty.set(sk, sec.revision)
      for (const rId of sec.regionIds) {
        const reg = topo.regions[rId]
        const prevReg = previous.regionByKey.get(reg.regionKey)
        reg.revision = sec.revision
        dirtyRegionKeys.add(reg.regionKey)
        // Retain still-valid sample until optional sample refresh runs; clear if deleted/blocked.
        const oldKey = prevReg ? prevReg.sampleTileKey : -1
        const oldNode = oldKey >= 0 ? (topo.tileKeyToNode.get(oldKey) ?? -1) : -1
        if (oldNode >= 0 && topo.nodeRegion[oldNode] === rId && !graph.serverForNode.has(oldNode)) {
          reg.sampleTileKey = oldKey
          reg.sampleNode = oldNode
        } else {
          reg.sampleTileKey = -1
          reg.sampleNode = -1
        }
      }
    } else {
      sec.revision = prevSec ? prevSec.revision : 1
      for (const rId of sec.regionIds) {
        const reg = topo.regions[rId]
        const prevReg = previous.regionByKey.get(reg.regionKey)
        reg.revision = prevReg ? prevReg.revision : sec.revision
        if (prevReg) {
          preservedRegionKeys.add(reg.regionKey)
          reg.sampleTileKey = prevReg.sampleTileKey
          reg.sampleNode = prevReg.sampleTileKey >= 0 ? (topo.tileKeyToNode.get(prevReg.sampleTileKey) ?? -1) : -1
        }
      }
    }
  }
  for (const prevReg of previous.regions) {
    if (!preservedRegionKeys.has(prevReg.regionKey)) dirtyRegionKeys.add(prevReg.regionKey)
  }

  return {
    topology: topo,
    diff: {
      routingNeutral: false,
      topologyRevision: topo.topologyRevision,
      dirtySectorKeys,
      preservedRegionKeys,
      dirtyRegionKeys,
    },
  }
}

function serverKindCode(kind: string): number {
  switch (kind) {
    case 'gate': return 1
    case 'escalator': return 2
    case 'stair': return 3
    case 'lift': return 4
    case 'walkway': return 5
    case 'door': return 6
    case 'stop': return 7
    default: return 0
  }
}
