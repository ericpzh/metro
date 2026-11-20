// Shared reverse distance fields, resumable coarse sparse A*, bounded fine-graph
// recovery, rolling 16-step local walker, soft claims, service rechoice and
// edit-retaining lifecycle (design/crowd-routing-plan.md §1–§4).
import type { Agent, Needs } from './agents.ts'
import {
  LIFT_AVOID_LUGGAGE_S,
  LIFT_AVOID_S,
  SIM_SECONDS_PER_TICK,
  STAIR_AVOID_S,
} from './constants.ts'
import {
  SPARSE_AGE_PROMOTE_TICKS,
  SPARSE_CLAIM_TTL_TICKS,
  SPARSE_FIELD_CACHE_MAX_BYTES,
  SPARSE_FINE_RECOVERY_POP_BUDGET,
  SPARSE_LOCAL_REFILL_BUDGET,
  SPARSE_MANDATORY_POP_BUDGET,
  SPARSE_MANDATORY_SCAN_BUDGET,
  SPARSE_OPTIONAL_POP_BUDGET,
  SPARSE_OPTIONAL_SCAN_BUDGET,
  SPARSE_REFILL_THRESHOLD,
  SPARSE_SAMPLE_REFRESH_SIM_S,
  SPARSE_SWITCH_MARGIN_MS,
  SPARSE_WALK_HORIZON,
} from './sparseConstants.ts'
import { EDGE_KIND, type PathFinder, queueWait, type ServerDef, type StationGraph } from './station.ts'
import type { GateDir } from './types.ts'
import {
  buildSparseTopology,
  type SparseCrossing,
  type SparseExplicitArc,
  type SparseRegion,
  type SparseTopology,
  type TopologyDiff,
} from './sparseGraph.ts'
import {
  hash32Init,
  hash32Mix,
  INF_MS,
  octantOf,
  scoreTileMs,
  SoftClaimTable,
  StandingOccupancy,
  toMs,
} from './sparsePolicy.ts'

export interface SparseRouterOptions {
  horizon?: number
  refillThreshold?: number
  fieldCacheMaxBytes?: number
  mandatoryPopBudget?: number
  mandatoryScanBudget?: number
  localRefillBudget?: number
  optionalPopBudget?: number
  optionalScanBudget?: number
  fineRecoveryPopBudget?: number
  useDensity?: boolean
  useBias?: boolean
  useClaims?: boolean
  allowSidestep?: boolean
  useSamples?: boolean
}

export interface CoarseStep {
  readonly kind: 'crossing' | 'explicit'
  readonly crossingId: number
  readonly arcId: number
  readonly fromKey: number
  readonly toKey: number
  readonly fromRegionKey: number
  readonly toRegionKey: number
  readonly edgeKind: number
  readonly server: number
  readonly toNodeServer: number
  readonly gateDir: GateDir
  readonly costMs: number
}

export interface CoarseItinerary {
  readonly topologyRevision: number
  readonly costSnapshotId: number
  readonly startKey: number
  readonly goalKey: number
  readonly needsClass: string
  readonly steps: CoarseStep[]
  readonly totalCostMs: number
  /** Upcoming service metadata exposed for gate forecasts & door balancing beyond 16 steps. */
  readonly nextGateServer: number
  readonly nextGateDir: GateDir
  readonly nextGateDistMs: number
  readonly nextServiceServer: number
  readonly nextServiceKind: string
}

export interface SparseWalkerState {
  sessionId: number
  legGen: number
  goalNode: number
  goalKey: number
  itinerary: CoarseItinerary | null
  /** Index of the next coarse step not yet consumed into the rolling path buffer. */
  stepIdx: number
  /** Incremented each time a rolling suffix is appended, seeding tile jitter. */
  segmentSequence: number
  /** Last walking octant (0..7), or -1 if unset. */
  heading: number
  /** True when `agent.path` actually ends at `goalNode` (leg destination). */
  segmentEndsAtGoal: boolean
  /** True when `agent.path` ends at a service transition (gate/ride/lift) awaiting handoff. */
  segmentEndsAtService: boolean
  /** Pending coarse query key if waiting on sparse search. */
  pendingCoarseId: number
  /** Pending fine recovery job key if waiting on fine recovery. */
  pendingFineKey: string | null
  /** Tick when the walker became blocked waiting for routing work, or -1. */
  blockedSinceTick: number
  /** Per-leg sparse miss count & retry backoff tick. */
  sparseMisses: number
  retryAfterTick: number
  /** Short recovery hint prefix from fine-graph fallback. */
  recoveryGoalKey: number
  /** Pending service-change candidate query id (gate lookahead / patience). */
  candidateCoarseId: number
  candidateExcludedServer: number
  candidateOriginNode: number
}

export interface SparseRoutingStats {
  topologyRevision: number
  sectorCount: number
  regionCount: number
  crossingCount: number
  explicitArcCount: number
  coarseQueries: number
  coarseCacheHits: number
  coarseExpansions: number
  coarseEdgeScans: number
  fieldBuilds: number
  fieldCacheHits: number
  fieldExpansions: number
  fieldEdgeScans: number
  fieldCacheEntries: number
  fieldCacheBytes: number
  localRefills: number
  localNeighbourScans: number
  fineFallbacks: number
  fineExpansions: number
  fineFallbackReasons: Record<string, number>
  sectorsRebuilt: number
  fieldsPreservedOnEdit: number
  samplesRefreshed: number
  pendingFieldJobs: number
  pendingCoarseJobs: number
  pendingFineJobs: number
  maxBacklogAge: number
  activeClaims: number
}

interface ReverseField {
  readonly key: string
  readonly regionKey: number
  readonly regionRevision: number
  readonly distMs: Int32Array
  readonly bytes: number
}

interface WorkBudget {
  pops: number
  scans: number
}

/** Binary min-heap ordered by `[priorityMs, tieKey]` carrying `gCost` for deterministic A* or Dijkstra. */
class DeterministicMinHeap {
  private ids: Int32Array
  private prios: Int32Array
  private gCosts: Int32Array
  private ties: Float64Array
  private len = 0

  constructor(cap = 64) {
    this.ids = new Int32Array(cap)
    this.prios = new Int32Array(cap)
    this.gCosts = new Int32Array(cap)
    this.ties = new Float64Array(cap)
  }

  get size(): number { return this.len }
  clear(): void { this.len = 0 }

  push(id: number, prio: number, tie: number, gCost = prio): void {
    if (this.len === this.ids.length) {
      const next = this.len * 2
      const nIds = new Int32Array(next)
      const nPrios = new Int32Array(next)
      const nG = new Int32Array(next)
      const nTies = new Float64Array(next)
      nIds.set(this.ids)
      nPrios.set(this.prios)
      nG.set(this.gCosts)
      nTies.set(this.ties)
      this.ids = nIds
      this.prios = nPrios
      this.gCosts = nG
      this.ties = nTies
    }
    let i = this.len++
    this.ids[i] = id
    this.prios[i] = prio
    this.gCosts[i] = gCost
    this.ties[i] = tie
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.less(p, i)) break
      this.swap(p, i)
      i = p
    }
  }

  pop(): { id: number; cost: number } {
    const id = this.ids[0]
    const cost = this.gCosts[0]
    this.len--
    if (this.len > 0) {
      this.ids[0] = this.ids[this.len]
      this.prios[0] = this.prios[this.len]
      this.gCosts[0] = this.gCosts[this.len]
      this.ties[0] = this.ties[this.len]
      let i = 0
      for (;;) {
        const l = (i << 1) + 1
        const r = l + 1
        let m = i
        if (l < this.len && this.less(l, m)) m = l
        if (r < this.len && this.less(r, m)) m = r
        if (m === i) break
        this.swap(m, i)
        i = m
      }
    }
    return { id, cost }
  }

  private less(a: number, b: number): boolean {
    const pa = this.prios[a], pb = this.prios[b]
    if (pa !== pb) return pa < pb
    return this.ties[a] < this.ties[b]
  }

  private swap(a: number, b: number): void {
    const id = this.ids[a]; this.ids[a] = this.ids[b]; this.ids[b] = id
    const p = this.prios[a]; this.prios[a] = this.prios[b]; this.prios[b] = p
    const g = this.gCosts[a]; this.gCosts[a] = this.gCosts[b]; this.gCosts[b] = g
    const t = this.ties[a]; this.ties[a] = this.ties[b]; this.ties[b] = t
  }
}

interface FieldJob {
  readonly key: string
  readonly regionId: number
  readonly regionKey: number
  readonly regionRevision: number
  readonly targetLocalIndices: Int32Array
  readonly distMs: Int32Array
  readonly heap: DeterministicMinHeap
  initialized: boolean
  /** Resumable current expansion inside `stepField`. */
  expandingLocal: number
  expandingDist: number
  edgeCursor: number
  /** Highest priority among waiters (lower tier / older tick = more urgent). */
  priorityTier: number
  oldestTick: number
  done: boolean
  stale: boolean
}

export interface CostSnapshot {
  readonly id: number
  readonly topologyRevision: number
  readonly signature: number
  readonly gateWaitMs: Int32Array
  readonly serverWaitMs: Int32Array
  readonly regionCrowdMs: Int32Array
  readonly serverOpen: Uint8Array
}

interface CoarseParent {
  fromPoint: number
  step: CoarseStep | null
  walkMs: number
  suffix?: CachedSuffix
}

interface CachedSuffix {
  readonly steps: CoarseStep[]
  readonly walkPrefixMs: number[]
  readonly remainingCostMs: number
}

interface CoarseSearchJob {
  readonly id: number
  readonly cacheKey: string
  readonly sessionId: number
  readonly topologyRevision: number
  readonly snapshot: CostSnapshot
  readonly startNode: number
  readonly goalNode: number
  readonly startKey: number
  readonly goalKey: number
  readonly needs: Needs
  readonly needsClass: string
  readonly excludedServer: number
  readonly heap: DeterministicMinHeap
  readonly bestCost: Map<number, number>
  readonly parent: Map<number, CoarseParent>
  /** Resumable expansion state. */
  expandingPoint: number
  expandingCost: number
  expandingRegionId: number
  /** Cursor stage: 0 = goal check, 1 = crossings[cursorIdx], 2 = explicitArcs[cursorIdx]. */
  cursorStage: number
  cursorIdx: number
  waitingFieldKey: string | null
  enqueuedTick: number
  priorityTier: number
  status: 'running' | 'ready' | 'failed'
  result: CoarseItinerary | null
  failReason: string
}

interface FineRecoveryJob {
  readonly key: string
  readonly topologyRevision: number
  readonly startNode: number
  readonly goalNode: number
  readonly needs: Needs
  readonly excludedServer: number
  readonly heap: DeterministicMinHeap
  readonly gScore: Map<number, number>
  readonly cameFrom: Map<number, number>
  expandingNode: number
  expandingG: number
  edgeCursor: number
  enqueuedTick: number
  priorityTier: number
  readonly reason: string
  status: 'running' | 'ready' | 'no_path'
  resultPath: Int32Array | null
}

function needsCode(n: Needs): string {
  return n.stepFree ? 'S' : n.luggage ? 'L' : 'N'
}

function liftAvoidMs(n: Needs): number {
  if (n.stepFree) return 0
  return toMs(n.luggage ? LIFT_AVOID_LUGGAGE_S : LIFT_AVOID_S)
}

const STAIR_AVOID_MS = toMs(STAIR_AVOID_S)

export class SparseRouter {
  topology: SparseTopology
  sessionId = 1
  readonly occupancy: StandingOccupancy
  readonly claims: SoftClaimTable

  // Tunables
  readonly horizon: number
  readonly refillThreshold: number
  readonly fieldCacheMaxBytes: number
  readonly mandatoryPopBudget: number
  readonly mandatoryScanBudget: number
  readonly localRefillBudget: number
  readonly optionalPopBudget: number
  readonly optionalScanBudget: number
  readonly fineRecoveryPopBudget: number
  readonly useDensity: boolean
  readonly useBias: boolean
  readonly useClaims: boolean
  readonly allowSidestep: boolean
  readonly useSamples: boolean

  // Reverse field cache (LRU by Map insertion order) + fast singleton lookup + deduplicated live jobs
  private fieldCache = new Map<string, ReverseField>()
  private singletonFieldCache = new Map<number, ReverseField>()
  private fieldCacheBytes = 0
  private fieldJobs = new Map<string, FieldJob>()

  // Coarse search jobs + single-snapshot completed result & exact continuation suffix cache
  private nextCoarseId = 1
  private coarseJobs = new Map<number, CoarseSearchJob>()
  private coarseJobByCacheKey = new Map<string, number>()
  private coarseResultCache = new Map<string, CoarseItinerary | null>()
  private coarseSuffixCache = new Map<string, CachedSuffix>()
  private coarseCacheSnapshotId = -1
  private costSnapshotSeq = 0
  private currentSnapshot: CostSnapshot | null = null

  // Fine recovery jobs (deduplicated)
  private fineJobs = new Map<string, FineRecoveryJob>()

  // Sample refresh schedule (elapsed ticks, immune to clock scrubbing)
  private elapsedTicks = 0
  private lastScheduledRefreshTick = -100000
  private pendingPlayResume = false
  private sampleRefreshQueue: Array<{ sectorKey: number; requestedRevision: number }> = []
  private sampleQueuedKeys = new Set<number>()

  // Telemetry
  private statsCoarseQueries = 0
  private statsCoarseCacheHits = 0
  private statsCoarseExpansions = 0
  private statsCoarseEdgeScans = 0
  private statsFieldBuilds = 0
  private statsFieldCacheHits = 0
  private statsFieldExpansions = 0
  private statsFieldEdgeScans = 0
  private statsLocalRefills = 0
  private statsLocalNeighbourScans = 0
  private statsFineFallbacks = 0
  private statsFineExpansions = 0
  private statsFineReasons: Record<string, number> = {}
  private statsSectorsRebuilt = 0
  private statsFieldsPreserved = 0
  private statsSamplesRefreshed = 0
  private statsMaxBacklogAge = 0

  constructor(graph: StationGraph, seed: number, opts: SparseRouterOptions = {}) {
    this.horizon = opts.horizon ?? SPARSE_WALK_HORIZON
    this.refillThreshold = opts.refillThreshold ?? SPARSE_REFILL_THRESHOLD
    this.fieldCacheMaxBytes = opts.fieldCacheMaxBytes ?? SPARSE_FIELD_CACHE_MAX_BYTES
    this.mandatoryPopBudget = opts.mandatoryPopBudget ?? SPARSE_MANDATORY_POP_BUDGET
    this.mandatoryScanBudget = opts.mandatoryScanBudget ?? SPARSE_MANDATORY_SCAN_BUDGET
    this.localRefillBudget = opts.localRefillBudget ?? SPARSE_LOCAL_REFILL_BUDGET
    this.optionalPopBudget = opts.optionalPopBudget ?? SPARSE_OPTIONAL_POP_BUDGET
    this.optionalScanBudget = opts.optionalScanBudget ?? SPARSE_OPTIONAL_SCAN_BUDGET
    this.fineRecoveryPopBudget = opts.fineRecoveryPopBudget ?? SPARSE_FINE_RECOVERY_POP_BUDGET
    this.useDensity = opts.useDensity ?? true
    this.useBias = opts.useBias ?? true
    this.useClaims = opts.useClaims ?? true
    this.allowSidestep = opts.allowSidestep ?? false
    this.useSamples = opts.useSamples ?? true

    const built = buildSparseTopology(graph, seed)
    this.topology = built.topology
    this.occupancy = new StandingOccupancy(graph.nodeCount)
    this.claims = new SoftClaimTable(graph.nodeCount)
  }

  /** New document load: bump sessionId and reset all caches, jobs and claims. */
  resetForNewDocument(graph: StationGraph, seed: number): void {
    this.sessionId++
    const built = buildSparseTopology(graph, seed)
    this.topology = built.topology
    this.occupancy.resize(graph.nodeCount)
    this.claims.resize(graph.nodeCount)
    this.fieldCache.clear()
    this.singletonFieldCache.clear()
    this.fieldCacheBytes = 0
    this.fieldJobs.clear()
    this.coarseJobs.clear()
    this.coarseJobByCacheKey.clear()
    this.coarseResultCache.clear()
    this.coarseSuffixCache.clear()
    this.fineJobs.clear()
    this.sampleRefreshQueue.length = 0
    this.sampleQueuedKeys.clear()
    this.currentSnapshot = null
    this.elapsedTicks = 0
    this.lastScheduledRefreshTick = -100000
    this.pendingPlayResume = false
  }

  /** Same-document restart: clear live decisions, claims & pending jobs; retain validated static geometry & fields. */
  resetForRestart(graph: StationGraph): void {
    this.topology.graph = graph
    this.occupancy.resize(graph.nodeCount)
    this.claims.clear()
    this.fieldJobs.clear()
    this.coarseJobs.clear()
    this.coarseJobByCacheKey.clear()
    this.coarseResultCache.clear()
    this.coarseSuffixCache.clear()
    this.fineJobs.clear()
    this.currentSnapshot = null
    this.elapsedTicks = 0
    this.lastScheduledRefreshTick = -100000
    this.pendingPlayResume = false
  }

  /** Real Pause -> Play transition notification (§3 / §4.5). */
  notifyPlayResumed(): void {
    this.pendingPlayResume = true
  }

  /**
   * Commit a rebuilt StationGraph, preserving unaffected sector revisions,
   * static reverse fields, samples, and valid claims (§3 / §4.5).
   */
  onCommit(newGraph: StationGraph, seed: number): TopologyDiff {
    const prev = this.topology
    const { topology: next, diff } = buildSparseTopology(newGraph, seed, prev)
    this.topology = next
    this.occupancy.resize(newGraph.nodeCount)

    // Remap active soft claims by stable TileKey onto new dense node indices.
    this.claims.remap(newGraph.nodeCount, (oldNode) => {
      if (oldNode < 0 || oldNode >= prev.nodeTileKey.length) return -1
      const key = prev.nodeTileKey[oldNode]
      return next.tileKeyToNode.get(key) ?? -1
    })

    if (diff.routingNeutral) {
      // Routing-neutral rebuild: retain every cached field & sample!
      this.statsFieldsPreserved += this.fieldCache.size
      this.rebuildSingletonFieldIndex()
      // Cancel in-flight jobs that hold dense node indices from previous graph.
      this.fieldJobs.clear()
      this.coarseJobs.clear()
      this.coarseJobByCacheKey.clear()
      this.fineJobs.clear()
      this.coarseResultCache.clear()
      this.coarseSuffixCache.clear()
      this.currentSnapshot = null
      return diff
    }

    this.statsSectorsRebuilt += diff.dirtySectorKeys.length

    // Evict ONLY fields belonging to dirty regions; keep untouched regions' fields!
    let preserved = 0
    for (const [fKey, field] of this.fieldCache) {
      if (diff.dirtyRegionKeys.has(field.regionKey)) {
        this.fieldCache.delete(fKey)
        this.fieldCacheBytes -= field.bytes
      } else {
        preserved++
      }
    }
    this.statsFieldsPreserved += preserved
    this.rebuildSingletonFieldIndex()

    // Cancel stale frontiers (in-flight coarse/field/fine jobs tied to previous revision).
    for (const [fKey, job] of this.fieldJobs) {
      job.stale = true
      this.fieldJobs.delete(fKey)
    }
    this.coarseJobs.clear()
    this.coarseJobByCacheKey.clear()
    this.coarseResultCache.clear()
    this.coarseSuffixCache.clear()
    this.fineJobs.clear()
    this.currentSnapshot = null

    return diff
  }

  private rebuildSingletonFieldIndex(): void {
    this.singletonFieldCache.clear()
    const topo = this.topology
    for (const [key, field] of this.fieldCache) {
      const p1 = key.indexOf('|')
      const p2 = key.indexOf('|', p1 + 1)
      if (p2 < 0 || key.indexOf(',', p2 + 1) >= 0) continue
      const tileKey = Number(key.slice(p2 + 1))
      const node = topo.tileKeyToNode.get(tileKey)
      if (node !== undefined) this.singletonFieldCache.set(node, field)
    }
  }

  /** Create a fresh walker state for a leg. */
  createWalker(goalNode: number, prevLegGen = 0): SparseWalkerState {
    const goalKey = goalNode >= 0 && goalNode < this.topology.nodeTileKey.length
      ? this.topology.nodeTileKey[goalNode] : -1
    return {
      sessionId: this.sessionId,
      legGen: prevLegGen + 1,
      goalNode,
      goalKey,
      itinerary: null,
      stepIdx: 0,
      segmentSequence: 0,
      heading: -1,
      segmentEndsAtGoal: false,
      segmentEndsAtService: false,
      pendingCoarseId: -1,
      pendingFineKey: null,
      blockedSinceTick: -1,
      sparseMisses: 0,
      retryAfterTick: 0,
      recoveryGoalKey: -1,
      candidateCoarseId: -1,
      candidateExcludedServer: -1,
      candidateOriginNode: -1,
    }
  }

  private readonly crowdScratch = new Set<number>()

  private countTwoHopCrowd(center: number): number {
    this.crowdScratch.clear()
    this.crowdScratch.add(center)
    const pStart = this.topology.plainAdjStart
    const pTo = this.topology.plainAdjTo
    for (let e = pStart[center]; e < pStart[center + 1]; e++) {
      const n1 = pTo[e]
      this.crowdScratch.add(n1)
      for (let e2 = pStart[n1]; e2 < pStart[n1 + 1]; e2++) {
        this.crowdScratch.add(pTo[e2])
      }
    }
    let total = 0
    for (const n of this.crowdScratch) total += this.occupancy.otherBodiesOn(n, -1)
    return total
  }

  /** Capture a read-only service cost & availability snapshot for the current tick. */
  captureCostSnapshot(gateWaitFn: ((s: ServerDef, dir: GateDir) => number) | null): CostSnapshot {
    const g = this.topology.graph
    const numServers = g.servers.length
    const gateWaitMs = new Int32Array(numServers * 3)
    const serverWaitMs = new Int32Array(numServers)
    const serverOpen = new Uint8Array(numServers)
    let sig = hash32Init(this.topology.topologyRevision)
    sig = hash32Mix(sig, numServers)
    for (let i = 0; i < numServers; i++) {
      const s = g.servers[i]
      serverOpen[i] = 1
      if (s.kind === 'gate') {
        for (let d = -1; d <= 1; d++) {
          const w = gateWaitFn ? gateWaitFn(s, d as GateDir) : queueWait(s)
          const ms = toMs(w)
          gateWaitMs[i * 3 + d + 1] = ms
          if (ms > 0) { sig = hash32Mix(sig, (i << 2) | (d + 1)); sig = hash32Mix(sig, ms) }
        }
      } else {
        let ms = toMs(queueWait(s))
        if ((s.kind === 'escalator' || s.kind === 'stair' || s.kind === 'walkway') &&
            s.node >= 0 && s.node < g.nodeCount) {
          let crowd = this.countTwoHopCrowd(s.node)
          if (s.exitNode !== undefined && s.exitNode >= 0 && s.exitNode < g.nodeCount) {
            crowd += this.occupancy.otherBodiesOn(s.exitNode, -1)
          }
          const bucket = Math.min(24, Math.floor(crowd / 4) * 4)
          if (bucket > 0) ms += bucket * 1500
        }
        serverWaitMs[i] = ms
        if (ms > 0) { sig = hash32Mix(sig, i); sig = hash32Mix(sig, ms) }
      }
    }
    const numRegions = this.topology.regions.length
    const regionCrowdMs = new Int32Array(numRegions)
    for (let r = 0; r < numRegions; r++) {
      const regNodes = this.topology.regions[r].nodes
      let bodies = 0
      for (let k = 0; k < regNodes.length; k++) bodies += this.occupancy.otherBodiesOn(regNodes[k], -1)
      const bucket = Math.min(4, Math.floor(bodies / 10))
      if (bucket > 0) {
        const ms = bucket * 5000
        regionCrowdMs[r] = ms
        sig = hash32Mix(sig, r + 50000)
        sig = hash32Mix(sig, ms)
      }
    }
    // Reuse the active snapshot ID when service waits & availability are identical.
    if (this.currentSnapshot && this.currentSnapshot.topologyRevision === this.topology.topologyRevision &&
        this.currentSnapshot.signature === sig) {
      return this.currentSnapshot
    }
    const snap: CostSnapshot = {
      id: ++this.costSnapshotSeq,
      topologyRevision: this.topology.topologyRevision,
      signature: sig,
      gateWaitMs,
      serverWaitMs,
      regionCrowdMs,
      serverOpen,
    }
    this.currentSnapshot = snap
    if (this.coarseCacheSnapshotId !== snap.id) {
      this.coarseResultCache.clear()
      this.coarseSuffixCache.clear()
      this.coarseCacheSnapshotId = snap.id
    }
    return snap
  }

  /* ------------------------------------------------- Reverse Distance Fields */

  private fieldKeyForNodes(region: SparseRegion, targetNodes: Int32Array | number[]): string {
    if (targetNodes.length === 1) {
      return `${region.regionKey}|${region.revision}|${this.topology.nodeTileKey[targetNodes[0]]}`
    }
    // targetNodes from crossing.uniqueFromNodes are already sorted by TileKey.
    const keys: number[] = []
    for (let i = 0; i < targetNodes.length; i++) keys.push(this.topology.nodeTileKey[targetNodes[i]])
    if (keys.length > 1) keys.sort((a, b) => a - b)
    return `${region.regionKey}|${region.revision}|${keys.join(',')}`
  }

  /**
   * Look up or enqueue a deduplicated reverse distance field inside `region`.
   * Single-node regions return immediately without allocating a job.
   */
  getField(
    regionId: number,
    targetNodes: Int32Array | number[],
    priorityTier = 2,
    requestTick = 0,
  ): ReverseField | null {
    const topo = this.topology
    const region = topo.regions[regionId]
    if (!region || targetNodes.length === 0) return null

    const key = this.fieldKeyForNodes(region, targetNodes)
    const hit = this.fieldCache.get(key)
    if (hit) {
      this.statsFieldCacheHits++
      // Touch LRU
      this.fieldCache.delete(key)
      this.fieldCache.set(key, hit)
      return hit
    }

    // Trivial 1-node region (e.g. a fare gate or isolated landing): instant publish.
    if (region.nodes.length === 1) {
      const distMs = new Int32Array(1)
      distMs[0] = targetNodes.includes(region.nodes[0]) ? 0 : INF_MS
      return this.publishField(key, region, distMs)
    }

    const existing = this.fieldJobs.get(key)
    if (existing) {
      if (priorityTier < existing.priorityTier) existing.priorityTier = priorityTier
      if (requestTick < existing.oldestTick) existing.oldestTick = requestTick
      return null
    }

    const locals = new Int32Array(targetNodes.length)
    let count = 0
    for (let i = 0; i < targetNodes.length; i++) {
      const n = targetNodes[i]
      if (topo.nodeRegion[n] === regionId) {
        locals[count++] = topo.nodeLocalIdx[n]
      }
    }
    if (count === 0) {
      const distMs = new Int32Array(region.nodes.length)
      distMs.fill(INF_MS)
      return this.publishField(key, region, distMs)
    }
    const targetLocalIndices = count === locals.length ? locals : locals.subarray(0, count)
    const distMs = new Int32Array(region.nodes.length)
    distMs.fill(INF_MS)

    const job: FieldJob = {
      key,
      regionId,
      regionKey: region.regionKey,
      regionRevision: region.revision,
      targetLocalIndices,
      distMs,
      heap: new DeterministicMinHeap(Math.min(256, Math.max(16, region.nodes.length))),
      initialized: false,
      expandingLocal: -1,
      expandingDist: 0,
      edgeCursor: 0,
      priorityTier,
      oldestTick: requestTick,
      done: false,
      stale: false,
    }
    this.fieldJobs.set(key, job)
    return null
  }

  /** Synchronously build or retrieve a field (used for read-only preview queries; does not touch budgets). */
  getFieldReadOnly(regionId: number, targetNodes: Int32Array | number[]): Int32Array | null {
    const topo = this.topology
    const region = topo.regions[regionId]
    if (!region || targetNodes.length === 0) return null
    const key = this.fieldKeyForNodes(region, targetNodes)
    const hit = this.fieldCache.get(key)
    if (hit) return hit.distMs

    const distMs = new Int32Array(region.nodes.length)
    distMs.fill(INF_MS)
    const heap = new DeterministicMinHeap(Math.max(16, region.nodes.length))
    for (let i = 0; i < targetNodes.length; i++) {
      const n = targetNodes[i]
      if (topo.nodeRegion[n] !== regionId) continue
      const li = topo.nodeLocalIdx[n]
      if (distMs[li] === 0) continue
      distMs[li] = 0
      heap.push(li, 0, region.tileKeys[li])
    }
    const { plainAdjStart, plainAdjTo, plainAdjCostMs, nodeRegion, nodeLocalIdx } = topo
    while (heap.size > 0) {
      const { id: curLocal, cost: curDist } = heap.pop()
      if (curDist !== distMs[curLocal]) continue
      const u = region.nodes[curLocal]
      for (let e = plainAdjStart[u]; e < plainAdjStart[u + 1]; e++) {
        const v = plainAdjTo[e]
        if (nodeRegion[v] !== regionId) continue
        const vLocal = nodeLocalIdx[v]
        const nd = curDist + plainAdjCostMs[e]
        if (nd < distMs[vLocal]) {
          distMs[vLocal] = nd
          heap.push(vLocal, nd, region.tileKeys[vLocal])
        }
      }
    }
    return distMs
  }

  /** Zero-allocation fast path for singleton target reverse fields used by sparse A*. */
  private getSingletonField(
    regionId: number,
    targetNode: number,
    priorityTier: number,
    requestTick: number,
  ): ReverseField | null {
    const fast = this.singletonFieldCache.get(targetNode)
    if (fast) {
      const region = this.topology.regions[regionId]
      if (region && fast.regionKey === region.regionKey && fast.regionRevision === region.revision) {
        this.statsFieldCacheHits++
        return fast
      }
      this.singletonFieldCache.delete(targetNode)
    }
    const field = this.getField(regionId, [targetNode], priorityTier, requestTick)
    if (field) this.singletonFieldCache.set(targetNode, field)
    return field
  }

  private publishField(key: string, region: SparseRegion, distMs: Int32Array): ReverseField {
    const bytes = distMs.byteLength + 96
    const field: ReverseField = {
      key,
      regionKey: region.regionKey,
      regionRevision: region.revision,
      distMs,
      bytes,
    }
    const old = this.fieldCache.get(key)
    if (old) {
      this.fieldCacheBytes -= old.bytes
      this.fieldCache.delete(key)
    }
    this.fieldCache.set(key, field)
    this.fieldCacheBytes += bytes
    // Index singleton fields for O(1) zero-string lookup in coarse A*.
    const p1 = key.indexOf('|')
    const p2 = key.indexOf('|', p1 + 1)
    if (p2 >= 0 && key.indexOf(',', p2 + 1) < 0) {
      const tk = Number(key.slice(p2 + 1))
      const node = this.topology.tileKeyToNode.get(tk)
      if (node !== undefined) this.singletonFieldCache.set(node, field)
    }
    this.statsFieldBuilds++
    this.evictColdFields()
    return field
  }

  private evictColdFields(): void {
    while (this.fieldCacheBytes > this.fieldCacheMaxBytes && this.fieldCache.size > 1) {
      const oldestKey = this.fieldCache.keys().next().value as string | undefined
      if (!oldestKey) break
      const entry = this.fieldCache.get(oldestKey)!
      this.fieldCache.delete(oldestKey)
      this.fieldCacheBytes -= entry.bytes
      const p1 = oldestKey.indexOf('|')
      const p2 = oldestKey.indexOf('|', p1 + 1)
      if (p2 >= 0 && oldestKey.indexOf(',', p2 + 1) < 0) {
        const tk = Number(oldestKey.slice(p2 + 1))
        const node = this.topology.tileKeyToNode.get(tk)
        if (node !== undefined && this.singletonFieldCache.get(node) === entry) {
          this.singletonFieldCache.delete(node)
        }
      }
    }
  }

  /** Step a resumable reverse-Dijkstra field job within `budget` (§4.2). */
  private stepFieldJob(job: FieldJob, budget: WorkBudget): boolean {
    const topo = this.topology
    const region = topo.regions[job.regionId]
    if (!region || region.regionKey !== job.regionKey || region.revision !== job.regionRevision) {
      job.stale = true
      job.done = true
      this.fieldJobs.delete(job.key)
      return true
    }

    if (!job.initialized) {
      job.initialized = true
      for (let i = 0; i < job.targetLocalIndices.length; i++) {
        const li = job.targetLocalIndices[i]
        if (job.distMs[li] === 0) continue
        job.distMs[li] = 0
        job.heap.push(li, 0, region.tileKeys[li])
      }
    }

    const { plainAdjStart, plainAdjTo, plainAdjCostMs, nodeRegion, nodeLocalIdx } = topo

    while (job.expandingLocal >= 0 || job.heap.size > 0) {
      if (job.expandingLocal < 0) {
        if (budget.pops <= 0) return false
        const { id: curLocal, cost: curDist } = job.heap.pop()
        budget.pops--
        this.statsFieldExpansions++
        if (curDist !== job.distMs[curLocal]) continue
        job.expandingLocal = curLocal
        job.expandingDist = curDist
        job.edgeCursor = plainAdjStart[region.nodes[curLocal]]
      }
      const u = region.nodes[job.expandingLocal]
      const end = plainAdjStart[u + 1]
      while (job.edgeCursor < end) {
        if (budget.scans <= 0) return false
        const e = job.edgeCursor++
        budget.scans--
        this.statsFieldEdgeScans++
        const v = plainAdjTo[e]
        if (nodeRegion[v] !== job.regionId) continue
        const vLocal = nodeLocalIdx[v]
        // Plain edges are bidirectional with symmetric cost; reverse cost = forward cost.
        const nd = job.expandingDist + plainAdjCostMs[e]
        if (nd < job.distMs[vLocal]) {
          job.distMs[vLocal] = nd
          job.heap.push(vLocal, nd, region.tileKeys[vLocal])
        }
      }
      job.expandingLocal = -1
    }

    job.done = true
    this.fieldJobs.delete(job.key)
    if (region.revision === job.regionRevision) {
      this.publishField(job.key, region, job.distMs)
    }
    return true
  }

  /* --------------------------------------------------- Coarse Sparse Search */

  startCoarseSearch(
    startNode: number,
    goalNode: number,
    needs: Needs,
    excludedServer: number,
    priorityTier: number,
    tick: number,
  ): { status: 'ready' | 'pending' | 'no_path'; itinerary?: CoarseItinerary | null; jobId?: number } {
    const topo = this.topology
    if (startNode < 0 || goalNode < 0 || startNode >= topo.graph.nodeCount || goalNode >= topo.graph.nodeCount) {
      return { status: 'no_path', itinerary: null }
    }
    const snapshot = this.currentSnapshot
    if (!snapshot) return { status: 'no_path', itinerary: null }

    const nc = needsCode(needs)
    const cacheKey = `${snapshot.topologyRevision}|${snapshot.id}|${startNode}|${goalNode}|${nc}|${excludedServer}`
    this.statsCoarseQueries++

    if (this.coarseResultCache.has(cacheKey)) {
      this.statsCoarseCacheHits++
      const cached = this.coarseResultCache.get(cacheKey)!
      return cached ? { status: 'ready', itinerary: cached } : { status: 'no_path', itinerary: null }
    }

    const existingId = this.coarseJobByCacheKey.get(cacheKey)
    if (existingId !== undefined) {
      const existing = this.coarseJobs.get(existingId)
      if (existing) {
        if (priorityTier < existing.priorityTier) existing.priorityTier = priorityTier
        if (tick < existing.enqueuedTick) existing.enqueuedTick = tick
        if (existing.status === 'ready') return { status: 'ready', itinerary: existing.result }
        if (existing.status === 'failed') return { status: 'no_path', itinerary: null }
        return { status: 'pending', jobId: existingId }
      }
    }

    const id = this.nextCoarseId++
    const heap = new DeterministicMinHeap(64)
    const bestCost = new Map<number, number>()
    const parent = new Map<number, CoarseParent>()
    bestCost.set(startNode, 0)
    heap.push(startNode, this.coarseHeuristicMs(startNode, goalNode), topo.nodeTileKey[startNode], 0)

    const job: CoarseSearchJob = {
      id,
      cacheKey,
      sessionId: this.sessionId,
      topologyRevision: topo.topologyRevision,
      snapshot,
      startNode,
      goalNode,
      startKey: topo.nodeTileKey[startNode],
      goalKey: topo.nodeTileKey[goalNode],
      needs: { stepFree: needs.stepFree, luggage: needs.luggage },
      needsClass: nc,
      excludedServer,
      heap,
      bestCost,
      parent,
      expandingPoint: -1,
      expandingCost: 0,
      expandingRegionId: -1,
      cursorStage: 0,
      cursorIdx: 0,
      waitingFieldKey: null,
      enqueuedTick: tick,
      priorityTier,
      status: 'running',
      result: null,
      failReason: '',
    }
    this.coarseJobs.set(id, job)
    this.coarseJobByCacheKey.set(cacheKey, id)
    return { status: 'pending', jobId: id }
  }

  /**
   * Synchronously advance a specific coarse job (and any fields it blocks on) within a small
   * bounded budget. Used by rationed gate-lookahead and queue-patience rechoices so warm
   * sparse queries complete on the same tick without stalling cold stations.
   */
  stepCoarseJobNow(jobId: number, maxPops = 2000, maxScans = 8000): CoarseSearchJob | undefined {
    const job = this.coarseJobs.get(jobId)
    if (!job || job.status !== 'running') return job
    const budget: WorkBudget = { pops: maxPops, scans: maxScans }
    while (job.status === 'running' && budget.pops > 0 && budget.scans > 0) {
      if (job.waitingFieldKey !== null) {
        const fj = this.fieldJobs.get(job.waitingFieldKey)
        if (fj) {
          this.stepFieldJob(fj, budget)
          if (!fj.done) break
        }
      }
      const beforePops = budget.pops, beforeScans = budget.scans
      const prevWait = job.waitingFieldKey
      this.stepCoarseJob(job, budget)
      if (job.status !== 'running') break
      if (budget.pops === beforePops && budget.scans === beforeScans && job.waitingFieldKey === prevWait) break
    }
    if (job.status !== 'running') {
      this.coarseJobs.delete(job.id)
      if (this.coarseJobByCacheKey.get(job.cacheKey) === job.id) {
        this.coarseJobByCacheKey.delete(job.cacheKey)
      }
    }
    return job
  }

  getCoarseJob(id: number): CoarseSearchJob | undefined {
    return this.coarseJobs.get(id)
  }

  private explicitArcCostMs(arc: SparseExplicitArc, needs: Needs, snap: CostSnapshot, excludedServer: number): number {
    if (needs.stepFree && (arc.kind === EDGE_KIND.stair || arc.kind === EDGE_KIND.escalator)) return INF_MS
    if (excludedServer >= 0 && (arc.server === excludedServer || arc.toNodeServer === excludedServer)) return INF_MS
    if (arc.server >= 0 && !snap.serverOpen[arc.server]) return INF_MS
    if (arc.toNodeServer >= 0 && !snap.serverOpen[arc.toNodeServer]) return INF_MS

    let cost = arc.staticCostMs
    if (arc.kind === EDGE_KIND.stair) cost += STAIR_AVOID_MS
    if (arc.kind === EDGE_KIND.lift) cost += liftAvoidMs(needs)
    if (arc.server >= 0) cost += snap.serverWaitMs[arc.server]
    if (arc.toNodeServer >= 0) {
      const srv = this.topology.graph.servers[arc.toNodeServer]
      if (srv.kind === 'gate') {
        cost += snap.gateWaitMs[arc.toNodeServer * 3 + arc.gateDir + 1]
      } else {
        cost += snap.serverWaitMs[arc.toNodeServer]
      }
    }
    return cost
  }

  /**
   * 100% admissible horizontal Euclidean lower bound in integer milliseconds.
   * Uses 2.0 m/s (500 ms/m), strictly faster than maximum floor speed (~1.474 m/s)
   * and moving walkways (1.84 m/s); vertical lift hops have dx=dy=0 so h=0.
   */
  private coarseHeuristicMs(node: number, goalNode: number): number {
    const topo = this.topology
    const dx = topo.nodeTx[node] - topo.nodeTx[goalNode]
    const dy = topo.nodeTy[node] - topo.nodeTy[goalNode]
    return Math.floor(Math.hypot(dx, dy) * 500)
  }

  /** Step a resumable coarse sparse A* job (admissible horizontal h, heap ordered by [fMs, tileKey]) (§4.2). */
  private stepCoarseJob(job: CoarseSearchJob, budget: WorkBudget): boolean {
    if (job.status !== 'running') return true
    const topo = this.topology
    if (job.topologyRevision !== topo.topologyRevision) {
      job.status = 'failed'
      job.failReason = 'stale-topology'
      this.coarseJobs.delete(job.id)
      this.coarseJobByCacheKey.delete(job.cacheKey)
      return true
    }

    // If previously suspended waiting for a field, check if it's ready now.
    if (job.waitingFieldKey !== null) {
      if (!this.fieldCache.has(job.waitingFieldKey)) {
        // Ensure field job exists and inherits priority.
        const fj = this.fieldJobs.get(job.waitingFieldKey)
        if (fj) {
          if (job.priorityTier < fj.priorityTier) fj.priorityTier = job.priorityTier
          if (job.enqueuedTick < fj.oldestTick) fj.oldestTick = job.enqueuedTick
          return false
        }
        // Field job was evicted/dropped; clear wait and re-request on resume.
      }
      job.waitingFieldKey = null
    }

    const goalRegionId = topo.nodeRegion[job.goalNode]
    const canUseSuffix = this.coarseCacheSnapshotId === job.snapshot.id
    const suffixPrefix = canUseSuffix ? `${job.snapshot.id}|${job.goalNode}|${job.needsClass}|${job.excludedServer}|` : ''

    while (job.expandingPoint >= 0 || job.heap.size > 0) {
      if (job.expandingPoint < 0) {
        if (budget.pops <= 0) return false
        const { id: point, cost } = job.heap.pop()
        budget.pops--
        this.statsCoarseExpansions++
        const best = job.bestCost.get(point)
        if (best === undefined || cost !== best) continue
        if (point === job.goalNode) {
          const itinerary = this.reconstructItinerary(job)
          job.status = 'ready'
          job.result = itinerary
          if (this.coarseCacheSnapshotId === job.snapshot.id) {
            this.coarseResultCache.set(job.cacheKey, itinerary)
          }
          return true
        }
        // Exact continuation sharing (§1): if an earlier search under the same snapshot
        // already solved the exact optimal continuation from `point -> goalNode`, relax goal directly!
        if (canUseSuffix) {
          const suffix = this.coarseSuffixCache.get(suffixPrefix + point)
          if (suffix) {
            const total = cost + suffix.remainingCostMs
            const prevGoal = job.bestCost.get(job.goalNode)
            if (prevGoal === undefined || total < prevGoal) {
              job.bestCost.set(job.goalNode, total)
              job.parent.set(job.goalNode, { fromPoint: point, step: null, walkMs: 0, suffix })
              job.heap.push(job.goalNode, total, job.goalKey, total)
            }
            continue
          }
        }
        job.expandingPoint = point
        job.expandingCost = cost
        job.expandingRegionId = topo.nodeRegion[point]
        job.cursorStage = 0
        job.cursorIdx = 0
      }

      const regId = job.expandingRegionId
      const region = regId >= 0 ? topo.regions[regId] : undefined
      if (!region) {
        job.expandingPoint = -1
        continue
      }
      const pointLocal = topo.nodeLocalIdx[job.expandingPoint]

      // Stage 0: direct within-region connection to goalNode if in same region.
      if (job.cursorStage === 0) {
        if (regId === goalRegionId) {
          if (budget.scans <= 0) return false
          budget.scans--
          this.statsCoarseEdgeScans++
          const field = this.getSingletonField(regId, job.goalNode, job.priorityTier, job.enqueuedTick)
          if (!field) {
            job.waitingFieldKey = this.fieldKeyForNodes(region, [job.goalNode])
            return false
          }
          const d = field.distMs[pointLocal]
          if (d < INF_MS) {
            const nc = job.expandingCost + d
            const prev = job.bestCost.get(job.goalNode)
            if (prev === undefined || nc < prev) {
              job.bestCost.set(job.goalNode, nc)
              job.parent.set(job.goalNode, { fromPoint: job.expandingPoint, step: null, walkMs: d })
              job.heap.push(job.goalNode, nc, job.goalKey, nc)
            }
          }
        }
        job.cursorStage = 1
        job.cursorIdx = 0
      }

      // Stage 1: outgoing plain boundary crossings from this region.
      if (job.cursorStage === 1) {
        const crossings = region.crossings
        while (job.cursorIdx < crossings.length) {
          if (budget.scans <= 0) return false
          const c = crossings[job.cursorIdx]
          const field = this.getSingletonField(regId, c.repFromNode, job.priorityTier, job.enqueuedTick)
          if (!field) {
            job.waitingFieldKey = this.fieldKeyForNodes(region, [c.repFromNode])
            return false
          }
          budget.scans--
          this.statsCoarseEdgeScans++
          job.cursorIdx++
          const walkMs = field.distMs[pointLocal]
          if (walkMs >= INF_MS) continue
          const regCrowd = c.toRegion >= 0 && c.toRegion < job.snapshot.regionCrowdMs.length ? job.snapshot.regionCrowdMs[c.toRegion] : 0
          const stepCost = c.repCostMs + regCrowd
          const total = job.expandingCost + walkMs + stepCost
          const prev = job.bestCost.get(c.repToNode)
          if (prev === undefined || total < prev) {
            job.bestCost.set(c.repToNode, total)
            job.parent.set(c.repToNode, {
              fromPoint: job.expandingPoint,
              walkMs,
              step: {
                kind: 'crossing',
                crossingId: c.id,
                arcId: -1,
                fromKey: c.repFromKey,
                toKey: c.repToKey,
                fromRegionKey: c.fromRegionKey,
                toRegionKey: c.toRegionKey,
                edgeKind: EDGE_KIND.walk,
                server: -1,
                toNodeServer: -1,
                gateDir: 0,
                costMs: stepCost,
              },
            })
            const f = total + this.coarseHeuristicMs(c.repToNode, job.goalNode)
            job.heap.push(c.repToNode, f, c.repToKey, total)
          }
        }
        job.cursorStage = 2
        job.cursorIdx = 0
      }

      // Stage 2: outgoing explicit directed/service arcs from this region.
      if (job.cursorStage === 2) {
        const arcs = region.explicitArcs
        while (job.cursorIdx < arcs.length) {
          if (budget.scans <= 0) return false
          const arc = arcs[job.cursorIdx]
          const arcCost = this.explicitArcCostMs(arc, job.needs, job.snapshot, job.excludedServer)
          if (arcCost >= INF_MS) {
            budget.scans--
            this.statsCoarseEdgeScans++
            job.cursorIdx++
            continue
          }
          const field = this.getSingletonField(regId, arc.fromNode, job.priorityTier, job.enqueuedTick)
          if (!field) {
            job.waitingFieldKey = this.fieldKeyForNodes(region, [arc.fromNode])
            return false
          }
          budget.scans--
          this.statsCoarseEdgeScans++
          job.cursorIdx++
          const walkMs = field.distMs[pointLocal]
          if (walkMs >= INF_MS) continue
          const total = job.expandingCost + walkMs + arcCost
          const prev = job.bestCost.get(arc.toNode)
          if (prev === undefined || total < prev) {
            job.bestCost.set(arc.toNode, total)
            job.parent.set(arc.toNode, {
              fromPoint: job.expandingPoint,
              walkMs,
              step: {
                kind: 'explicit',
                crossingId: -1,
                arcId: arc.id,
                fromKey: arc.fromKey,
                toKey: arc.toKey,
                fromRegionKey: region.regionKey,
                toRegionKey: topo.regions[arc.toRegion].regionKey,
                edgeKind: arc.kind,
                server: arc.server,
                toNodeServer: arc.toNodeServer,
                gateDir: arc.gateDir,
                costMs: arcCost,
              },
            })
            const f = total + this.coarseHeuristicMs(arc.toNode, job.goalNode)
            job.heap.push(arc.toNode, f, arc.toKey, total)
          }
        }
      }

      job.expandingPoint = -1
    }

    job.status = 'failed'
    job.failReason = 'sparse-exhausted'
    if (this.coarseCacheSnapshotId === job.snapshot.id) {
      this.coarseResultCache.set(job.cacheKey, null)
    }
    return true
  }

  private reconstructItinerary(job: CoarseSearchJob): CoarseItinerary {
    const rev: CoarseStep[] = []
    const walkPrefixMs: number[] = []
    const pointChain: Array<{ point: number; gCost: number; stepCountAfter: number }> = []
    let cur = job.goalNode
    const goalTotal = job.bestCost.get(job.goalNode) ?? INF_MS

    // Handle exact suffix shortcut if `goalNode` was reached via `coarseSuffixCache`.
    let trailingSuffix: CachedSuffix | undefined
    const goalParent = job.parent.get(job.goalNode)
    if (goalParent?.suffix) {
      trailingSuffix = goalParent.suffix
      cur = goalParent.fromPoint
    }

    while (cur !== job.startNode) {
      const p = job.parent.get(cur)
      if (!p) break
      if (p.step) {
        pointChain.push({ point: cur, gCost: job.bestCost.get(cur) ?? 0, stepCountAfter: rev.length })
        rev.push(p.step)
        walkPrefixMs.push(p.walkMs)
      }
      cur = p.fromPoint
    }
    rev.reverse()
    walkPrefixMs.reverse()

    const prefixLen = rev.length
    if (trailingSuffix) {
      for (let i = 0; i < trailingSuffix.steps.length; i++) {
        rev.push(trailingSuffix.steps[i])
        walkPrefixMs.push(trailingSuffix.walkPrefixMs[i])
      }
    }

    // Publish exact optimal continuations along the path into `coarseSuffixCache` (§1).
    if (this.coarseCacheSnapshotId === job.snapshot.id && goalTotal < INF_MS) {
      const suffixPrefix = `${job.snapshot.id}|${job.goalNode}|${job.needsClass}|${job.excludedServer}|`
      for (let i = 0; i < pointChain.length; i++) {
        const entry = pointChain[i]
        const startIdx = prefixLen - entry.stepCountAfter
        const rem = goalTotal - entry.gCost
        if (rem >= 0 && startIdx >= 0 && startIdx <= rev.length) {
          this.coarseSuffixCache.set(suffixPrefix + entry.point, {
            steps: rev.slice(startIdx),
            walkPrefixMs: walkPrefixMs.slice(startIdx),
            remainingCostMs: rem,
          })
        }
      }
    }

    // Extract upcoming gate / service metadata for forecasts beyond 16 steps.
    let nextGateServer = -1
    let nextGateDir: GateDir = 0
    let nextGateDistMs = INF_MS
    let nextServiceServer = -1
    let nextServiceKind = ''
    let accumMs = 0
    const g = this.topology.graph
    for (let i = 0; i < rev.length; i++) {
      const st = rev[i]
      accumMs += walkPrefixMs[i]
      if (st.kind === 'explicit') {
        if (nextGateServer < 0 && st.toNodeServer >= 0 && g.servers[st.toNodeServer]?.kind === 'gate') {
          nextGateServer = st.toNodeServer
          nextGateDir = st.gateDir
          nextGateDistMs = accumMs
        }
        if (nextServiceServer < 0) {
          if (st.server >= 0) {
            nextServiceServer = st.server
            nextServiceKind = g.servers[st.server]?.kind ?? ''
          } else if (st.toNodeServer >= 0) {
            nextServiceServer = st.toNodeServer
            nextServiceKind = g.servers[st.toNodeServer]?.kind ?? ''
          }
        }
      }
      accumMs += st.costMs
    }

    return {
      topologyRevision: job.topologyRevision,
      costSnapshotId: job.snapshot.id,
      startKey: job.startKey,
      goalKey: job.goalKey,
      needsClass: job.needsClass,
      steps: rev,
      totalCostMs: job.bestCost.get(job.goalNode) ?? INF_MS,
      nextGateServer,
      nextGateDir,
      nextGateDistMs,
      nextServiceServer,
      nextServiceKind,
    }
  }

  /** Price an itinerary (or its remaining suffix from `stepIdx`) under the current cost snapshot (§4.3). */
  priceItineraryFrom(
    itinerary: CoarseItinerary,
    stepIdx: number,
    fromNode: number,
    needs: Needs,
    snap: CostSnapshot,
  ): number {
    const topo = this.topology
    if (itinerary.topologyRevision !== topo.topologyRevision) return INF_MS
    let curNode = fromNode
    let total = 0
    for (let i = stepIdx; i < itinerary.steps.length; i++) {
      const st = itinerary.steps[i]
      const regId = topo.nodeRegion[curNode]
      if (regId < 0) return INF_MS
      if (st.kind === 'crossing') {
        const c = topo.crossings[st.crossingId]
        if (!c || c.fromRegion !== regId) return INF_MS
        const dist = this.getFieldReadOnly(regId, [c.repFromNode])
        if (!dist) return INF_MS
        const w = dist[topo.nodeLocalIdx[curNode]]
        if (w >= INF_MS) return INF_MS
        const regCrowd = c.toRegion >= 0 && c.toRegion < snap.regionCrowdMs.length ? snap.regionCrowdMs[c.toRegion] : 0
        total += w + c.repCostMs + regCrowd
        curNode = c.repToNode
      } else {
        const arc = topo.explicitArcs[st.arcId]
        if (!arc || arc.fromRegion !== regId) return INF_MS
        const arcCost = this.explicitArcCostMs(arc, needs, snap, -1)
        if (arcCost >= INF_MS) return INF_MS
        const dist = this.getFieldReadOnly(regId, [arc.fromNode])
        if (!dist) return INF_MS
        const w = dist[topo.nodeLocalIdx[curNode]]
        if (w >= INF_MS) return INF_MS
        total += w + arcCost
        curNode = arc.toNode
      }
    }
    const goalNode = topo.tileKeyToNode.get(itinerary.goalKey) ?? -1
    if (goalNode < 0) return INF_MS
    const goalReg = topo.nodeRegion[goalNode]
    if (topo.nodeRegion[curNode] !== goalReg) return INF_MS
    const dist = this.getFieldReadOnly(goalReg, [goalNode])
    if (!dist) return INF_MS
    const tail = dist[topo.nodeLocalIdx[curNode]]
    if (tail >= INF_MS) return INF_MS
    return total + tail
  }

  /* --------------------------------------------------- Fine-Graph Recovery */

  enqueueFineRecovery(
    startNode: number,
    goalNode: number,
    needs: Needs,
    excludedServer: number,
    priorityTier: number,
    tick: number,
    reason: string,
  ): string {
    const key = `${this.topology.topologyRevision}|${startNode}|${goalNode}|${needsCode(needs)}|${excludedServer}`
    const existing = this.fineJobs.get(key)
    if (existing) {
      if (priorityTier < existing.priorityTier) existing.priorityTier = priorityTier
      if (tick < existing.enqueuedTick) existing.enqueuedTick = tick
      return key
    }
    const heap = new DeterministicMinHeap(128)
    const gScore = new Map<number, number>()
    const cameFrom = new Map<number, number>()
    gScore.set(startNode, 0)
    heap.push(startNode, 0, this.topology.nodeTileKey[startNode])

    this.fineJobs.set(key, {
      key,
      topologyRevision: this.topology.topologyRevision,
      startNode,
      goalNode,
      needs: { stepFree: needs.stepFree, luggage: needs.luggage },
      excludedServer,
      heap,
      gScore,
      cameFrom,
      expandingNode: -1,
      expandingG: 0,
      edgeCursor: 0,
      enqueuedTick: tick,
      priorityTier,
      reason,
      status: 'running',
      resultPath: null,
    })
    return key
  }

  getFineJob(key: string): FineRecoveryJob | undefined {
    return this.fineJobs.get(key)
  }

  private stepFineRecoveryJob(job: FineRecoveryJob, budget: WorkBudget, snap: CostSnapshot): boolean {
    if (job.status !== 'running') return true
    const topo = this.topology
    if (job.topologyRevision !== topo.topologyRevision) {
      job.status = 'no_path'
      this.fineJobs.delete(job.key)
      return true
    }
    const g = topo.graph
    const { adjStart, adjTo, adjCost, adjKind, adjServer, servers, serverForNode } = g
    const liftPen = liftAvoidMs(job.needs)
    let finePops = Math.min(budget.pops, this.fineRecoveryPopBudget)

    while (job.expandingNode >= 0 || job.heap.size > 0) {
      if (job.expandingNode < 0) {
        if (finePops <= 0 || budget.pops <= 0) return false
        const { id: cur, cost } = job.heap.pop()
        finePops--
        budget.pops--
        this.statsFineExpansions++
        const best = job.gScore.get(cur)
        if (best === undefined || cost !== best) continue
        if (cur === job.goalNode) {
          const nodes: number[] = []
          let p: number | undefined = cur
          while (p !== undefined) {
            nodes.push(p)
            if (p === job.startNode) break
            p = job.cameFrom.get(p)
          }
          nodes.reverse()
          job.resultPath = Int32Array.from(nodes)
          job.status = 'ready'
          this.statsFineFallbacks++
          this.statsFineReasons[job.reason] = (this.statsFineReasons[job.reason] ?? 0) + 1
          return true
        }
        job.expandingNode = cur
        job.expandingG = cost
        job.edgeCursor = adjStart[cur]
      }
      const cur = job.expandingNode
      const end = adjStart[cur + 1]
      while (job.edgeCursor < end) {
        if (budget.scans <= 0) return false
        const e = job.edgeCursor++
        budget.scans--
        const kind = adjKind[e]
        if (job.needs.stepFree && (kind === EDGE_KIND.stair || kind === EDGE_KIND.escalator)) continue
        const nb = adjTo[e]
        const sv = adjServer[e]
        const gsv = serverForNode.get(nb)
        if (job.excludedServer >= 0 && (sv === job.excludedServer || gsv === job.excludedServer)) continue
        let ec = toMs(adjCost[e])
        if (kind === EDGE_KIND.stair) ec += STAIR_AVOID_MS
        if (kind === EDGE_KIND.lift) ec += liftPen
        if (sv >= 0) ec += snap.serverWaitMs[sv]
        if (gsv !== undefined) {
          const s = servers[gsv]
          if (s.kind === 'gate') {
            // Infer gate crossing direction for fine recovery consistency.
            const dir = this.inferGateDir(cur, nb)
            ec += snap.gateWaitMs[gsv * 3 + dir + 1]
          } else {
            ec += snap.serverWaitMs[gsv]
          }
        }
        const ng = job.expandingG + ec
        const prev = job.gScore.get(nb)
        if (prev === undefined || ng < prev) {
          job.gScore.set(nb, ng)
          job.cameFrom.set(nb, cur)
          job.heap.push(nb, ng, topo.nodeTileKey[nb])
        }
      }
      job.expandingNode = -1
    }

    job.status = 'no_path'
    return true
  }

  private inferGateDir(from: number, gateNode: number): GateDir {
    const topo = this.topology
    const reg = topo.regions[topo.nodeRegion[from]]
    if (reg) {
      for (let i = 0; i < reg.explicitArcs.length; i++) {
        const a = reg.explicitArcs[i]
        if (a.fromNode === from && a.toNode === gateNode) return a.gateDir
      }
    }
    return 0
  }

  /* ------------------------------------------- Rolling 16-Step Local Walker */

  /** Pick best legal arrival tile across a boundary crossing (§4.3). */
  chooseCrossingArrival(crossing: SparseCrossing, departureNode: number, selfNode: number): number {
    const topo = this.topology
    let bestTo = -1
    let bestScore = INF_MS
    let bestKey = Infinity
    for (let i = 0; i < crossing.fromNodes.length; i++) {
      if (crossing.fromNodes[i] !== departureNode) continue
      const to = crossing.toNodes[i]
      const occPenalty = this.useDensity ? 500 * this.occupancy.otherBodiesOn(to, selfNode) : 0
      const score = crossing.costMs[i] + occPenalty
      const key = topo.nodeTileKey[to]
      if (score < bestScore || (score === bestScore && key < bestKey)) {
        bestScore = score
        bestKey = key
        bestTo = to
      }
    }
    return bestTo
  }

  /**
   * Refill a walking agent's rolling segment up to `horizon` (16) steps when `<= 4` remain (§4.3).
   * Returns `'ok'`, `'pending'` (waiting on reverse field), or `'repair'` (need coarse/fine recovery).
   */
  refillWalker(
    agent: Agent,
    walker: SparseWalkerState,
    currentTick: number,
    selfNode: number,
    priorityTier: number,
  ): 'ok' | 'pending' | 'repair' {
    const topo = this.topology
    const g = topo.graph
    const itinerary = walker.itinerary
    if (!itinerary || itinerary.topologyRevision !== topo.topologyRevision) return 'repair'

    const remaining = Math.max(0, agent.path.length - agent.pathIdx)
    if (remaining > this.refillThreshold || walker.segmentEndsAtGoal || walker.segmentEndsAtService) {
      return 'ok'
    }

    const startNode = remaining > 0 ? agent.path[agent.path.length - 1] : selfNode
    if (startNode < 0 || startNode >= g.nodeCount) return 'repair'

    // If agent is already standing on goalNode, complete cleanly.
    if (startNode === walker.goalNode && walker.stepIdx >= itinerary.steps.length) {
      if (remaining === 0) {
        agent.path = Int32Array.from([startNode])
        agent.pathIdx = 0
      }
      walker.segmentEndsAtGoal = true
      return 'ok'
    }

    const suffix: number[] = []
    let at = startNode
    let heading = walker.heading
    if (remaining >= 2) {
      const p0 = agent.path[agent.path.length - 2]
      const p1 = agent.path[agent.path.length - 1]
      heading = octantOf(topo.nodeTx[p1] - topo.nodeTx[p0], topo.nodeTy[p1] - topo.nodeTy[p0])
    }

    const visitedInSegment = new Set<number>()
    for (let i = agent.pathIdx; i < agent.path.length; i++) visitedInSegment.add(agent.path[i])
    visitedInSegment.add(at)

    const { plainAdjStart, plainAdjTo, plainAdjCostMs, nodeRegion, nodeLocalIdx, nodeTx, nodeTy, nodeTz2, nodeTileKey } = topo
    const maxSteps = this.horizon
    let stepIdx = walker.stepIdx
    let reachedGoal = false
    let reachedService = false
    let pendingField = false
    const scoreOpts = { useDensity: this.useDensity, useBias: this.useBias, useClaims: this.useClaims }

    while (remaining + suffix.length < maxSteps) {
      const regId = nodeRegion[at]
      if (regId < 0) return suffix.length > 0 ? 'ok' : 'repair'

      const step = stepIdx < itinerary.steps.length ? itinerary.steps[stepIdx] : null

      // Determine current target set inside `regId`.
      let targetNodes: Int32Array | number[]
      let isTarget: (n: number) => boolean
      if (!step) {
        if (nodeRegion[walker.goalNode] !== regId) {
          if (suffix.length > 0) break
          return 'repair'
        }
        targetNodes = [walker.goalNode]
        isTarget = (n) => n === walker.goalNode
      } else if (step.kind === 'crossing') {
        const crossing = topo.crossings[step.crossingId]
        if (!crossing || crossing.fromRegion !== regId) {
          if (suffix.length > 0) break
          return 'repair'
        }
        targetNodes = crossing.uniqueFromNodes
        isTarget = (n) => {
          for (let k = 0; k < crossing.uniqueFromNodes.length; k++) {
            if (crossing.uniqueFromNodes[k] === n) return true
          }
          return false
        }
      } else {
        const arc = topo.explicitArcs[step.arcId]
        if (!arc || arc.fromRegion !== regId) {
          if (suffix.length > 0) break
          return 'repair'
        }
        targetNodes = [arc.fromNode]
        isTarget = (n) => n === arc.fromNode
      }

      // If `at` is already at a target tile, execute the transition!
      if (isTarget(at)) {
        if (!step) {
          reachedGoal = true
          break
        }
        if (step.kind === 'crossing') {
          const crossing = topo.crossings[step.crossingId]
          const arrival = this.chooseCrossingArrival(crossing, at, selfNode)
          if (arrival < 0) {
            if (suffix.length > 0) break
            return 'repair'
          }
          heading = octantOf(nodeTx[arrival] - nodeTx[at], nodeTy[arrival] - nodeTy[at])
          suffix.push(arrival)
          visitedInSegment.add(arrival)
          at = arrival
          stepIdx++
          continue
        } else {
          // Explicit directed arc (gate / ride / lift / one-way walk).
          const arc = topo.explicitArcs[step.arcId]
          const isRideOrLift = arc.kind === EDGE_KIND.escalator || arc.kind === EDGE_KIND.walkway ||
            arc.kind === EDGE_KIND.stair || arc.kind === EDGE_KIND.lift
          const isGateEntry = arc.toNodeServer >= 0 && g.servers[arc.toNodeServer]?.kind === 'gate'
          suffix.push(arc.toNode)
          visitedInSegment.add(arc.toNode)
          heading = octantOf(nodeTx[arc.toNode] - nodeTx[at], nodeTy[arc.toNode] - nodeTy[at])
          at = arc.toNode
          stepIdx++

          if (isRideOrLift) {
            reachedService = true
            break
          }
          if (isGateEntry) {
            // Append the immediate post-gate exit node so `World.onArrive` sees `prev -> gate -> next`
            // for exact `crossingDir`, then stop extending past the gate!
            if (stepIdx < itinerary.steps.length && itinerary.steps[stepIdx].kind === 'explicit') {
              const exitArc = topo.explicitArcs[itinerary.steps[stepIdx].arcId]
              if (exitArc && exitArc.fromNode === at) {
                suffix.push(exitArc.toNode)
                visitedInSegment.add(exitArc.toNode)
                at = exitArc.toNode
                stepIdx++
              }
            }
            reachedService = true
            break
          }
          // Ordinary directed walk edge: keep extending!
          continue
        }
      }

      // Not yet at target: obtain shared multi-source reverse field in `regId`.
      const field = this.getField(regId, targetNodes, priorityTier, currentTick)
      if (!field) {
        pendingField = true
        break
      }
      const atLocal = nodeLocalIdx[at]
      const atDist = field.distMs[atLocal]
      if (atDist >= INF_MS) {
        if (suffix.length > 0) break
        return 'repair'
      }

      // Score all strictly downhill plain neighbours in `regId` (§4.3).
      let bestNode = -1
      let bestScore = INF_MS
      let bestKey = Infinity
      let fallbackNode = -1
      let fallbackDist = INF_MS
      let fallbackKey = Infinity
      const ax = nodeTx[at], ay = nodeTy[at]

      for (let e = plainAdjStart[at]; e < plainAdjStart[at + 1]; e++) {
        this.statsLocalNeighbourScans++
        const nb = plainAdjTo[e]
        if (nodeRegion[nb] !== regId) continue
        if (visitedInSegment.has(nb)) continue
        const nbDist = field.distMs[nodeLocalIdx[nb]]
        if (nbDist >= atDist) continue

        const nbKey = nodeTileKey[nb]
        if (nbDist < fallbackDist || (nbDist === fallbackDist && nbKey < fallbackKey)) {
          fallbackDist = nbDist
          fallbackKey = nbKey
          fallbackNode = nb
        }

        const direct = this.occupancy.otherBodiesOn(nb, selfNode)
        let adjSum = 0
        let adjCnt = 0
        if (this.useDensity) {
          for (let ne = plainAdjStart[nb]; ne < plainAdjStart[nb + 1]; ne++) {
            const n2 = plainAdjTo[ne]
            adjSum += this.occupancy.otherBodiesOn(n2, selfNode)
            adjCnt++
          }
        }
        const otherClaims = this.useClaims ? this.claims.countOtherAgentsOn(nb, agent.id) : 0
        const moveOct = octantOf(nodeTx[nb] - ax, nodeTy[nb] - ay)
        const sc = scoreTileMs(
          plainAdjCostMs[e],
          nbDist,
          direct,
          adjSum,
          adjCnt,
          otherClaims,
          heading,
          moveOct,
          topo.seed,
          agent.id,
          walker.segmentSequence,
          nodeTx[nb],
          nodeTy[nb],
          nodeTz2[nb],
          scoreOpts,
        )
        if (sc < bestScore || (sc === bestScore && nbKey < bestKey)) {
          bestScore = sc
          bestKey = nbKey
          bestNode = nb
        }
      }

      const chosen = bestNode >= 0 ? bestNode : fallbackNode
      if (chosen < 0) {
        if (suffix.length > 0) break
        return 'repair'
      }

      heading = octantOf(nodeTx[chosen] - ax, nodeTy[chosen] - ay)
      suffix.push(chosen)
      visitedInSegment.add(chosen)
      at = chosen
    }

    if (suffix.length > 0) {
      // Preserve current untraversed prefix and append suffix.
      const keepStart = remaining > 0 ? agent.pathIdx : 0
      const keepLen = remaining
      // If `agent.path` was empty, start with `[startNode, ...suffix]` so `path[0]` is where the walker stands.
      const prependStart = keepLen === 0 ? 1 : 0
      const nextPath = new Int32Array(keepLen + prependStart + suffix.length)
      if (keepLen > 0) {
        nextPath.set(agent.path.subarray(keepStart), 0)
      } else {
        nextPath[0] = startNode
      }
      for (let i = 0; i < suffix.length; i++) nextPath[keepLen + prependStart + i] = suffix[i]
      agent.path = nextPath
      agent.pathIdx = prependStart > 0 && nextPath.length > 1 ? 1 : 0
      agent.fromNode = nextPath[0]
      walker.stepIdx = stepIdx
      walker.heading = heading
      walker.segmentSequence++
      walker.segmentEndsAtGoal = reachedGoal
      walker.segmentEndsAtService = reachedService
      this.statsLocalRefills++
      this.refreshWalkerClaims(agent, currentTick)
      return 'ok'
    }

    if (reachedGoal) {
      walker.stepIdx = stepIdx
      walker.segmentEndsAtGoal = true
      return 'ok'
    }
    if (reachedService) {
      walker.stepIdx = stepIdx
      walker.segmentEndsAtService = true
      return 'ok'
    }
    return pendingField ? 'pending' : 'ok'
  }

  /** Refresh an agent's soft claims for the next 1–2 untraversed tiles in `agent.path`. */
  refreshWalkerClaims(agent: Agent, currentTick: number): void {
    if (!this.useClaims) return
    const idx = agent.pathIdx
    const n0 = idx < agent.path.length ? agent.path[idx] : -1
    const n1 = idx + 1 < agent.path.length ? agent.path[idx + 1] : -1
    this.claims.refresh(agent.id, n0, n1, currentTick, SPARSE_CLAIM_TTL_TICKS)
  }

  /* --------------------------------------------------- Main Tick Scheduler */

  /**
   * Run one fixed routing tick (§4.4 / §4.5):
   * 1. Expire soft claims & capture standing occupancy.
   * 2. Capture tick cost snapshot.
   * 3. Schedule optional sample refresh on real Pause->Play or every 60 elapsed sim seconds.
   * 4. Run mandatory field/coarse/fine jobs within deterministic pop & scan budgets.
   * 5. Adopt ready results & refill eligible walkers in tick-rotated deterministic order.
   * 6. Spend capped optional budget on dirty sample refreshes.
   */
  routeTick(
    tick: number,
    agents: readonly Agent[],
    gateWaitFn: ((s: ServerDef, dir: GateDir) => number) | null,
    getWalker: (a: Agent) => SparseWalkerState | undefined,
    nearestNodeOf: (a: Agent) => number,
    onNoPath: (a: Agent) => void,
    onServiceSwitch: (a: Agent, walker: SparseWalkerState, candidate: CoarseItinerary) => void,
  ): void {
    this.elapsedTicks++
    this.claims.expire(tick)

    // Capture standing occupancy once per tick (excluding train riders).
    this.occupancy.clear()
    const g = this.topology.graph
    const selfNodeByAgent = new Map<number, number>()
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]
      if (a.dead || a.train >= 0) continue
      const n = a.server >= 0 ? g.servers[a.server].node : nearestNodeOf(a)
      if (n >= 0) {
        this.occupancy.add(n)
        selfNodeByAgent.set(a.id, n)
      }
    }

    const snap = this.captureCostSnapshot(gateWaitFn)

    // Schedule optional sample refresh (§4.5): real Pause->Play or >= 60 elapsed sim seconds.
    this.scheduleSampleRefresh()

    // Collect walkers needing coarse search, fine recovery, or segment refill.
    const walkers: Array<{ a: Agent; w: SparseWalkerState; selfNode: number }> = []
    const referencedCoarseIds = new Set<number>()
    const referencedFineKeys = new Set<string>()
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]
      if (a.dead || a.train >= 0) continue
      const w = getWalker(a)
      if (!w) continue
      const selfNode = selfNodeByAgent.get(a.id) ?? -1
      walkers.push({ a, w, selfNode })

      if (w.pendingCoarseId >= 0 && !this.coarseJobs.has(w.pendingCoarseId)) w.pendingCoarseId = -1
      if (w.candidateCoarseId >= 0 && !this.coarseJobs.has(w.candidateCoarseId)) w.candidateCoarseId = -1
      if (w.pendingFineKey !== null && !this.fineJobs.has(w.pendingFineKey)) w.pendingFineKey = null

      const isBlocked = a.path.length <= a.pathIdx
      if ((a.awaitingPath || (a.state === 1 && !w.itinerary)) && isBlocked && w.blockedSinceTick < 0) {
        w.blockedSinceTick = tick
      }
      const age = w.blockedSinceTick >= 0 ? tick - w.blockedSinceTick : 0
      const tier = isBlocked || age >= SPARSE_AGE_PROMOTE_TICKS ? 0 : 1

      // Bump priority of already-pending coarse/fine jobs instead of spawning duplicates!
      if (w.pendingCoarseId >= 0) {
        const pj = this.coarseJobs.get(w.pendingCoarseId)!
        if (tier < pj.priorityTier) pj.priorityTier = tier
        referencedCoarseIds.add(w.pendingCoarseId)
      } else if (w.pendingFineKey !== null) {
        const fj = this.fineJobs.get(w.pendingFineKey)!
        if (tier < fj.priorityTier) fj.priorityTier = tier
        referencedFineKeys.add(w.pendingFineKey)
      } else if ((a.awaitingPath || (a.state === 1 && !w.itinerary)) &&
          selfNode >= 0 && w.goalNode >= 0 && selfNode !== w.goalNode && tick >= w.retryAfterTick) {
        const res = this.startCoarseSearch(selfNode, w.goalNode, a.needs, -1, tier, tick)
        if (res.status === 'ready' && res.itinerary) {
          w.itinerary = res.itinerary
          w.stepIdx = 0
          w.segmentEndsAtGoal = false
          w.segmentEndsAtService = false
          w.pendingCoarseId = -1
        } else if (res.status === 'pending' && res.jobId !== undefined) {
          w.pendingCoarseId = res.jobId
          referencedCoarseIds.add(res.jobId)
        } else {
          w.pendingFineKey = this.enqueueFineRecovery(selfNode, w.goalNode, a.needs, -1, tier, tick, 'sparse-no-path')
          referencedFineKeys.add(w.pendingFineKey)
        }
      }
      if (w.candidateCoarseId >= 0) referencedCoarseIds.add(w.candidateCoarseId)
    }

    // Drop any orphaned jobs whose walkers died or moved on.
    for (const [id, job] of this.coarseJobs) {
      if (!referencedCoarseIds.has(id)) {
        this.coarseJobs.delete(id)
        if (this.coarseJobByCacheKey.get(job.cacheKey) === id) this.coarseJobByCacheKey.delete(job.cacheKey)
      }
    }
    for (const key of this.fineJobs.keys()) {
      if (!referencedFineKeys.has(key)) this.fineJobs.delete(key)
    }

    // Run mandatory jobs within deterministic pop & scan budgets.
    const mandatoryBudget: WorkBudget = {
      pops: this.mandatoryPopBudget,
      scans: this.mandatoryScanBudget,
    }
    this.runMandatoryJobs(mandatoryBudget, snap, tick)

    // Adopt ready coarse/fine results and refill eligible walkers in tick-rotated deterministic order.
    const count = walkers.length
    const offset = count > 0 ? tick % count : 0
    let localRefillsLeft = this.localRefillBudget

    for (let k = 0; k < count; k++) {
      const { a, w, selfNode } = walkers[(offset + k) % count]
      if (a.dead) continue

      // Check pending service-change candidate (§4.3 considerServiceChange).
      if (w.candidateCoarseId >= 0) {
        const cJob = this.coarseJobs.get(w.candidateCoarseId)
        if (!cJob) {
          w.candidateCoarseId = -1
        } else if (cJob.status === 'ready' && cJob.result) {
          w.candidateCoarseId = -1
          const cand = cJob.result
          const evalFrom = w.candidateOriginNode >= 0 ? w.candidateOriginNode : selfNode
          const keepCost = w.itinerary && evalFrom >= 0
            ? this.priceItineraryFrom(w.itinerary, w.stepIdx, evalFrom, a.needs, snap)
            : INF_MS
          const newCost = evalFrom >= 0
            ? this.priceItineraryFrom(cand, 0, evalFrom, a.needs, snap)
            : cand.totalCostMs
          const switchesService = cand.nextServiceServer !== (w.itinerary?.nextServiceServer ?? -1) ||
            cand.nextGateServer !== (w.itinerary?.nextGateServer ?? -1)
          if (keepCost >= INF_MS || (switchesService && newCost + SPARSE_SWITCH_MARGIN_MS < keepCost)) {
            onServiceSwitch(a, w, cand)
          }
        } else if (cJob.status === 'failed') {
          w.candidateCoarseId = -1
        }
      }

      // Check pending primary coarse search.
      if (w.pendingCoarseId >= 0) {
        const job = this.coarseJobs.get(w.pendingCoarseId)
        if (!job) {
          w.pendingCoarseId = -1
        } else if (job.status === 'ready' && job.result) {
          w.itinerary = job.result
          w.stepIdx = 0
          w.segmentEndsAtGoal = false
          w.segmentEndsAtService = false
          w.pendingCoarseId = -1
          w.blockedSinceTick = -1
          w.sparseMisses = 0
        } else if (job.status === 'failed') {
          w.pendingCoarseId = -1
          w.sparseMisses++
          if (selfNode >= 0 && w.goalNode >= 0) {
            w.pendingFineKey = this.enqueueFineRecovery(selfNode, w.goalNode, a.needs, -1, 0, tick, job.failReason || 'coarse-failed')
          }
        }
      }

      // Check pending fine-graph recovery.
      if (w.pendingFineKey !== null) {
        const fJob = this.fineJobs.get(w.pendingFineKey)
        if (!fJob) {
          w.pendingFineKey = null
        } else if (fJob.status === 'ready' && fJob.resultPath && fJob.resultPath.length > 0) {
          w.pendingFineKey = null
          w.blockedSinceTick = -1
          // Extract legal prefix up to `horizon` steps (stopping at any service edge/gate).
          const full = fJob.resultPath
          const prefix = this.extractFineRecoveryPrefix(full)
          agentAdoptPath(a, prefix.path)
          w.segmentEndsAtGoal = prefix.reachesGoal
          w.segmentEndsAtService = prefix.reachesService
          w.itinerary = null
          w.stepIdx = 0
          w.retryAfterTick = tick + Math.min(16, 2 * w.sparseMisses)
          this.refreshWalkerClaims(a, tick)
          continue
        } else if (fJob.status === 'no_path') {
          w.pendingFineKey = null
          w.blockedSinceTick = -1
          this.claims.release(a.id)
          onNoPath(a)
          continue
        }
      }

      // Refill rolling walking segment when walking or waiting to start walking.
      if (w.itinerary && (a.state === 1 || a.awaitingPath)) {
        let remaining = Math.max(0, a.path.length - a.pathIdx)
        // Preserve a 2-step committed prefix (§2.4), but if a crowd or claim forms directly
        // ahead in the uncommitted tail, trim past the 2-step prefix so the walker smoothly
        // steps around live crowding instead of marching blindly for 12+ ticks (§2.3).
        if (remaining > this.refillThreshold && a.state === 1 && localRefillsLeft > 0) {
          const check1 = a.pathIdx + 1 < a.path.length ? a.path[a.pathIdx + 1] : -1
          const check2 = a.pathIdx + 2 < a.path.length ? a.path[a.pathIdx + 2] : -1
          const crowdedAhead =
            (check1 >= 0 && (this.occupancy.otherBodiesOn(check1, selfNode) > 0 || (this.useClaims && this.claims.countOtherAgentsOn(check1, a.id) > 0))) ||
            (check2 >= 0 && (this.occupancy.otherBodiesOn(check2, selfNode) > 0 || (this.useClaims && this.claims.countOtherAgentsOn(check2, a.id) > 0)))
          if (crowdedAhead) {
            const keepEnd = Math.min(a.path.length, a.pathIdx + 2)
            let safePrefix = keepEnd < a.path.length
            const g = this.topology.graph
            for (let k = a.pathIdx; safePrefix && k < keepEnd; k++) {
              if (g.serverForNode.has(a.path[k])) safePrefix = false
              if (k + 1 < keepEnd && Math.abs(g.nodeZ[a.path[k]] - g.nodeZ[a.path[k + 1]]) > 1e-6) safePrefix = false
            }
            const tailAfter = a.path[keepEnd - 1]
            const tailReg = safePrefix ? this.topology.nodeRegion[tailAfter] : -1
            const tailRegKey = tailReg >= 0 ? this.topology.regions[tailReg].regionKey : -1
            if (tailRegKey >= 0) {
              while (w.stepIdx > 0) {
                const curStep = w.stepIdx < w.itinerary.steps.length ? w.itinerary.steps[w.stepIdx] : null
                if (curStep && curStep.fromRegionKey === tailRegKey) break
                if (!curStep && this.topology.nodeRegion[w.goalNode] === tailReg) break
                w.stepIdx--
              }
              a.path = a.path.slice(a.pathIdx, keepEnd)
              a.pathIdx = 0
              w.segmentEndsAtGoal = false
              w.segmentEndsAtService = false
              remaining = a.path.length
            }
          }
        }
        const needsRefill = remaining <= this.refillThreshold && !w.segmentEndsAtGoal && !w.segmentEndsAtService
        if (needsRefill && localRefillsLeft > 0) {
          const isBlocked = remaining === 0
          if (isBlocked && w.blockedSinceTick < 0) w.blockedSinceTick = tick
          const age = w.blockedSinceTick >= 0 ? tick - w.blockedSinceTick : 0
          const tier = isBlocked || age >= SPARSE_AGE_PROMOTE_TICKS ? 0 : 1
          const outcome = this.refillWalker(a, w, tick, selfNode, tier)
          if (outcome === 'ok') {
            localRefillsLeft--
            if (a.path.length > a.pathIdx) {
              a.awaitingPath = false
              a.state = 1
              w.blockedSinceTick = -1
            }
          } else if (outcome === 'repair') {
            w.itinerary = null
            w.stepIdx = 0
            if (selfNode >= 0 && w.goalNode >= 0) {
              const res = this.startCoarseSearch(selfNode, w.goalNode, a.needs, -1, 0, tick)
              if (res.status === 'ready' && res.itinerary) {
                w.itinerary = res.itinerary
              } else if (res.status === 'pending' && res.jobId !== undefined) {
                w.pendingCoarseId = res.jobId
              } else {
                w.pendingFineKey = this.enqueueFineRecovery(selfNode, w.goalNode, a.needs, -1, 0, tick, 'refill-repair')
              }
            }
          }
        }
      }

      // Track backlog age.
      if (w.blockedSinceTick >= 0) {
        const age = tick - w.blockedSinceTick
        if (age > this.statsMaxBacklogAge) this.statsMaxBacklogAge = age
      }
    }

    // Second quick pass of mandatory jobs if newly requested fields/coarse/fine jobs can finish within remaining budget.
    if (mandatoryBudget.pops > 0 && mandatoryBudget.scans > 0 &&
        (this.fieldJobs.size > 0 || this.coarseJobs.size > 0 || this.fineJobs.size > 0)) {
      this.runMandatoryJobs(mandatoryBudget, snap, tick)
      // Immediately adopt newly-finished coarse/fine/field results for blocked walkers so delay stays minimal!
      for (let k = 0; k < count; k++) {
        const { a, w, selfNode } = walkers[(offset + k) % count]
        if (a.dead) continue
        if (w.pendingCoarseId >= 0) {
          const job = this.coarseJobs.get(w.pendingCoarseId)
          if (job?.status === 'ready' && job.result) {
            w.itinerary = job.result
            w.stepIdx = 0
            w.segmentEndsAtGoal = false
            w.segmentEndsAtService = false
            w.pendingCoarseId = -1
            w.blockedSinceTick = -1
            w.sparseMisses = 0
          }
        }
        if (w.pendingFineKey !== null) {
          const fJob = this.fineJobs.get(w.pendingFineKey)
          if (fJob?.status === 'ready' && fJob.resultPath && fJob.resultPath.length > 0) {
            w.pendingFineKey = null
            w.blockedSinceTick = -1
            const prefix = this.extractFineRecoveryPrefix(fJob.resultPath)
            agentAdoptPath(a, prefix.path)
            w.segmentEndsAtGoal = prefix.reachesGoal
            w.segmentEndsAtService = prefix.reachesService
            w.itinerary = null
            w.stepIdx = 0
            w.retryAfterTick = tick + Math.min(16, 2 * w.sparseMisses)
            this.refreshWalkerClaims(a, tick)
            continue
          } else if (fJob?.status === 'no_path') {
            w.pendingFineKey = null
            w.blockedSinceTick = -1
            this.claims.release(a.id)
            onNoPath(a)
            continue
          }
        }
        if (localRefillsLeft > 0 && w.itinerary && (a.awaitingPath || (a.state === 1 && a.path.length <= a.pathIdx)) && !w.segmentEndsAtGoal && !w.segmentEndsAtService) {
          const outcome = this.refillWalker(a, w, tick, selfNode, 0)
          if (outcome === 'ok' && a.path.length > a.pathIdx) {
            localRefillsLeft--
            a.awaitingPath = false
            a.state = 1
            w.blockedSinceTick = -1
          }
        }
      }
    }

    // Prune completed coarse/fine jobs once adopted.
    for (const [id, job] of this.coarseJobs) {
      if (job.status !== 'running') {
        this.coarseJobs.delete(id)
        if (this.coarseJobByCacheKey.get(job.cacheKey) === id) this.coarseJobByCacheKey.delete(job.cacheKey)
      }
    }
    for (const [key, job] of this.fineJobs) {
      if (job.status !== 'running') this.fineJobs.delete(key)
    }

    // Optional budget: dirty concourse sample refreshes (§4.5).
    this.runOptionalJobs()
  }

  private runMandatoryJobs(budget: WorkBudget, snap: CostSnapshot, tick: number): void {
    // Interleave field jobs and coarse jobs so coarse searches wake immediately when their blocking field completes.
    let progressed = true
    while (progressed && budget.pops > 0 && budget.scans > 0) {
      progressed = false

      // 1. Run highest-priority field jobs.
      if (this.fieldJobs.size > 0) {
        const sortedFields = [...this.fieldJobs.values()].sort((a, b) => {
          const aAge = tick - a.oldestTick >= SPARSE_AGE_PROMOTE_TICKS ? 0 : a.priorityTier
          const bAge = tick - b.oldestTick >= SPARSE_AGE_PROMOTE_TICKS ? 0 : b.priorityTier
          return aAge - bAge || a.oldestTick - b.oldestTick || a.regionKey - b.regionKey || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        })
        for (let i = 0; i < sortedFields.length && budget.pops > 0 && budget.scans > 0; i++) {
          const prevPops = budget.pops, prevScans = budget.scans
          this.stepFieldJob(sortedFields[i], budget)
          if (budget.pops !== prevPops || budget.scans !== prevScans) progressed = true
        }
      }

      // 2. Run highest-priority coarse search jobs.
      if (this.coarseJobs.size > 0 && budget.pops > 0 && budget.scans > 0) {
        const sortedCoarse = [...this.coarseJobs.values()]
          .filter((j) => j.status === 'running')
          .sort((a, b) => {
            const aAge = tick - a.enqueuedTick >= SPARSE_AGE_PROMOTE_TICKS ? 0 : a.priorityTier
            const bAge = tick - b.enqueuedTick >= SPARSE_AGE_PROMOTE_TICKS ? 0 : b.priorityTier
            return aAge - bAge || a.enqueuedTick - b.enqueuedTick || a.id - b.id
          })
        for (let i = 0; i < sortedCoarse.length && budget.pops > 0 && budget.scans > 0; i++) {
          const prevPops = budget.pops, prevScans = budget.scans
          const prevFieldCount = this.fieldJobs.size
          this.stepCoarseJob(sortedCoarse[i], budget)
          if (budget.pops !== prevPops || budget.scans !== prevScans || this.fieldJobs.size !== prevFieldCount) {
            progressed = true
          }
        }
      }

      // 3. Run fine-graph recovery jobs.
      if (this.fineJobs.size > 0 && budget.pops > 0 && budget.scans > 0) {
        const sortedFine = [...this.fineJobs.values()]
          .filter((j) => j.status === 'running')
          .sort((a, b) => {
            const aAge = tick - a.enqueuedTick >= SPARSE_AGE_PROMOTE_TICKS ? 0 : a.priorityTier
            const bAge = tick - b.enqueuedTick >= SPARSE_AGE_PROMOTE_TICKS ? 0 : b.priorityTier
            return aAge - bAge || a.enqueuedTick - b.enqueuedTick || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
          })
        for (let i = 0; i < sortedFine.length && budget.pops > 0 && budget.scans > 0; i++) {
          const prevPops = budget.pops, prevScans = budget.scans
          this.stepFineRecoveryJob(sortedFine[i], budget, snap)
          if (budget.pops !== prevPops || budget.scans !== prevScans) progressed = true
        }
      }
    }
  }

  private extractFineRecoveryPrefix(full: Int32Array): { path: Int32Array; reachesGoal: boolean; reachesService: boolean } {
    const g = this.topology.graph
    let end = Math.min(full.length, this.horizon + 1)
    let reachesService = false
    for (let i = 1; i < end; i++) {
      const u = full[i - 1], v = full[i]
      if (g.serverForNode.has(v)) {
        // Gate: include gate node + immediate next exit node if present.
        end = Math.min(full.length, i + 2)
        reachesService = true
        break
      }
      for (let e = g.adjStart[u]; e < g.adjStart[u + 1]; e++) {
        if (g.adjTo[e] === v && g.adjKind[e] !== EDGE_KIND.walk) {
          end = i + 1
          reachesService = true
          break
        }
      }
      if (reachesService) break
    }
    const reachesGoal = end === full.length && !reachesService
    return { path: full.slice(0, end), reachesGoal, reachesService }
  }

  /* -------------------------------------------- Sample Refresh Schedule §4.5 */

  private scheduleSampleRefresh(): void {
    const resumed = this.pendingPlayResume
    this.pendingPlayResume = false
    if (!this.useSamples) return
    const ticksFor60SimSeconds = Math.max(1, Math.round(SPARSE_SAMPLE_REFRESH_SIM_S / SIM_SECONDS_PER_TICK))
    const due = this.elapsedTicks - this.lastScheduledRefreshTick >= ticksFor60SimSeconds
    if (this.topology.samplesDirty.size === 0 || (!resumed && !due)) return

    const dirtyKeys = [...this.topology.samplesDirty.keys()].sort((a, b) => a - b)
    let newlyScheduled = false
    for (let i = 0; i < dirtyKeys.length; i++) {
      const sk = dirtyKeys[i]
      const rev = this.topology.samplesDirty.get(sk)!
      if (this.sampleQueuedKeys.has(sk)) {
        // Coalesce existing queued entry to the newest dirty revision.
        const entry = this.sampleRefreshQueue.find((q) => q.sectorKey === sk)
        if (entry) entry.requestedRevision = rev
        continue
      }
      this.sampleQueuedKeys.add(sk)
      this.sampleRefreshQueue.push({ sectorKey: sk, requestedRevision: rev })
      newlyScheduled = true
    }
    if (newlyScheduled) {
      this.lastScheduledRefreshTick = this.elapsedTicks
    }
  }

  private runOptionalJobs(): void {
    if (this.sampleRefreshQueue.length === 0) return
    let scanBudget = this.optionalScanBudget
    let popBudget = this.optionalPopBudget
    while (this.sampleRefreshQueue.length > 0 && scanBudget > 0 && popBudget > 0) {
      const job = this.sampleRefreshQueue.shift()!
      this.sampleQueuedKeys.delete(job.sectorKey)
      const sector = this.topology.sectors.get(job.sectorKey)
      if (!sector || sector.revision !== job.requestedRevision) continue
      for (let i = 0; i < sector.regionIds.length; i++) {
        const reg = this.topology.regions[sector.regionIds[i]]
        scanBudget -= reg.nodes.length
        popBudget--
        this.topology.refreshRegionSample(reg, reg.sampleTileKey)
        this.statsSamplesRefreshed++
      }
      // Clear dirty mark only if it still equals requestedRevision (§4.5).
      if (this.topology.samplesDirty.get(job.sectorKey) === job.requestedRevision) {
        this.topology.samplesDirty.delete(job.sectorKey)
      }
    }
  }

  /* ------------------------------------------ Read-Only Route Preview (§5 C) */

  /**
   * Estimate the continuation of a selected passenger's active segment without mutating
   * RNG, soft claims, simulation caches, or routing budgets.
   */
  previewContinuation(
    agent: Agent,
    walker: SparseWalkerState | undefined,
    fallbackFinder: PathFinder,
    out: number[],
  ): void {
    const topo = this.topology
    const g = topo.graph
    if (!walker || walker.segmentEndsAtGoal) return

    const tailStart = agent.pathIdx < agent.path.length
      ? agent.path[agent.path.length - 1]
      : (walker.goalNode >= 0 ? -1 : -1)

    if (tailStart < 0 || walker.goalNode < 0 || tailStart === walker.goalNode) return

    const itinerary = walker.itinerary
    if (itinerary && itinerary.topologyRevision === topo.topologyRevision) {
      // Emit representative waypoints for each remaining coarse step, then goal.
      for (let i = walker.stepIdx; i < itinerary.steps.length; i++) {
        const st = itinerary.steps[i]
        const fn = topo.tileKeyToNode.get(st.fromKey)
        const tn = topo.tileKeyToNode.get(st.toKey)
        if (fn !== undefined) out.push(g.nodeX[fn], g.nodeY[fn], g.nodeZ[fn])
        if (tn !== undefined) out.push(g.nodeX[tn], g.nodeY[tn], g.nodeZ[tn])
      }
      out.push(g.nodeX[walker.goalNode], g.nodeY[walker.goalNode], g.nodeZ[walker.goalNode])
      return
    }

    // Fallback read-only search if itinerary is still pending.
    const path = fallbackFinder.search(tailStart, walker.goalNode, agent.needs)
    if (path) {
      for (let i = path[0] === tailStart ? 1 : 0; i < path.length; i++) {
        const n = path[i]
        out.push(g.nodeX[n], g.nodeY[n], g.nodeZ[n])
      }
    }
  }

  stats(): SparseRoutingStats {
    return {
      topologyRevision: this.topology.topologyRevision,
      sectorCount: this.topology.sectors.size,
      regionCount: this.topology.regions.length,
      crossingCount: this.topology.crossings.length,
      explicitArcCount: this.topology.explicitArcs.length,
      coarseQueries: this.statsCoarseQueries,
      coarseCacheHits: this.statsCoarseCacheHits,
      coarseExpansions: this.statsCoarseExpansions,
      coarseEdgeScans: this.statsCoarseEdgeScans,
      fieldBuilds: this.statsFieldBuilds,
      fieldCacheHits: this.statsFieldCacheHits,
      fieldExpansions: this.statsFieldExpansions,
      fieldEdgeScans: this.statsFieldEdgeScans,
      fieldCacheEntries: this.fieldCache.size,
      fieldCacheBytes: this.fieldCacheBytes,
      localRefills: this.statsLocalRefills,
      localNeighbourScans: this.statsLocalNeighbourScans,
      fineFallbacks: this.statsFineFallbacks,
      fineExpansions: this.statsFineExpansions,
      fineFallbackReasons: { ...this.statsFineReasons },
      sectorsRebuilt: this.statsSectorsRebuilt,
      fieldsPreservedOnEdit: this.statsFieldsPreserved,
      samplesRefreshed: this.statsSamplesRefreshed,
      pendingFieldJobs: this.fieldJobs.size,
      pendingCoarseJobs: this.coarseJobs.size,
      pendingFineJobs: this.fineJobs.size,
      maxBacklogAge: this.statsMaxBacklogAge,
      activeClaims: this.claims.activeCount,
    }
  }
}

function agentAdoptPath(a: Agent, path: Int32Array): void {
  a.path = path
  a.pathIdx = path.length > 1 ? 1 : 0
  a.fromNode = path.length > 0 ? path[0] : -1
  a.awaitingPath = false
  a.state = 1
}
