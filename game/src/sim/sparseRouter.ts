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

interface CachedRegionSuffix {
  readonly steps: CoarseStep[]
  readonly walkPrefixMs: number[]
  readonly costToEntryMs: number
  readonly entryNode: number
}

interface ReverseCoarseTree {
  readonly key: string
  readonly topologyRevision: number
  readonly snapshotId: number
  readonly goalRegionId: number
  readonly effNeeds: string
  readonly distMs: Int32Array
  /** 0 = goal/none, 1 = crossing, 2 = explicit arc. */
  readonly nextKind: Uint8Array
  readonly nextId: Int32Array
  readonly nextStepCostMs: Int32Array
}

interface ReverseCoarseTreeJob {
  readonly key: string
  readonly topologyRevision: number
  readonly snapshot: CostSnapshot
  readonly goalRegionId: number
  readonly needs: Needs
  readonly effNeeds: string
  readonly distMs: Int32Array
  readonly nextKind: Uint8Array
  readonly nextId: Int32Array
  readonly nextStepCostMs: Int32Array
  readonly heap: DeterministicMinHeap
  initialized: boolean
  expandingReg: number
  expandingDist: number
  /** 0 = incoming crossings, 1 = incoming explicit arcs. */
  cursorStage: number
  cursorIdx: number
  priorityTier: number
  oldestTick: number
  done: boolean
  result: ReverseCoarseTree | null
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
  /** Non-null when this job is backed by a shared `ReverseCoarseTreeJob` for `goalRegion`. */
  readonly treeKey: string | null
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

  // Coarse search jobs + single-snapshot completed result, reverse region trees & suffix caches
  private nextCoarseId = 1
  private coarseJobs = new Map<number, CoarseSearchJob>()
  private coarseJobByCacheKey = new Map<string, number>()
  private coarseResultCache = new Map<string, CoarseItinerary | null>()
  private coarseSuffixCache = new Map<string, CachedSuffix>()
  private coarseRegionSuffixCache = new Map<string, CachedRegionSuffix>()
  private reverseTreeCache = new Map<string, ReverseCoarseTree>()
  private reverseTreeJobs = new Map<string, ReverseCoarseTreeJob>()
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
  private refillCursor = 0
  private trimCursor = 0

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
    this.coarseRegionSuffixCache.clear()
    this.reverseTreeCache.clear()
    this.reverseTreeJobs.clear()
    this.fineJobs.clear()
    this.sampleRefreshQueue.length = 0
    this.sampleQueuedKeys.clear()
    this.currentSnapshot = null
    this.elapsedTicks = 0
    this.lastScheduledRefreshTick = -100000
    this.pendingPlayResume = false
    this.refillCursor = 0
    this.trimCursor = 0
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
    this.coarseRegionSuffixCache.clear()
    this.reverseTreeCache.clear()
    this.reverseTreeJobs.clear()
    this.fineJobs.clear()
    this.currentSnapshot = null
    this.elapsedTicks = 0
    this.lastScheduledRefreshTick = -100000
    this.pendingPlayResume = false
    this.refillCursor = 0
    this.trimCursor = 0
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
      this.coarseRegionSuffixCache.clear()
      this.reverseTreeCache.clear()
      this.reverseTreeJobs.clear()
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
    this.coarseRegionSuffixCache.clear()
    this.reverseTreeCache.clear()
    this.reverseTreeJobs.clear()
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
      this.coarseRegionSuffixCache.clear()
      this.reverseTreeCache.clear()
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

  private effNeedsCode(n: Needs): string {
    if (n.stepFree) return 'S'
    return this.topology.hasLifts && n.luggage ? 'L' : 'N'
  }

  private getOrEnqueueReverseTree(
    goalRegionId: number,
    needs: Needs,
    snapshot: CostSnapshot,
    priorityTier: number,
    tick: number,
  ): { tree?: ReverseCoarseTree; jobKey: string } {
    const eff = this.effNeedsCode(needs)
    const key = `${snapshot.topologyRevision}|${snapshot.id}|${goalRegionId}|${eff}`
    const hit = this.reverseTreeCache.get(key)
    if (hit) return { tree: hit, jobKey: key }
    const existing = this.reverseTreeJobs.get(key)
    if (existing) {
      if (priorityTier < existing.priorityTier) existing.priorityTier = priorityTier
      if (tick < existing.oldestTick) existing.oldestTick = tick
      return { jobKey: key }
    }
    const rCount = this.topology.regions.length
    const distMs = new Int32Array(rCount)
    distMs.fill(INF_MS)
    const nextKind = new Uint8Array(rCount)
    const nextId = new Int32Array(rCount)
    nextId.fill(-1)
    const nextStepCostMs = new Int32Array(rCount)
    const job: ReverseCoarseTreeJob = {
      key,
      topologyRevision: snapshot.topologyRevision,
      snapshot,
      goalRegionId,
      needs: { stepFree: needs.stepFree, luggage: needs.luggage },
      effNeeds: eff,
      distMs,
      nextKind,
      nextId,
      nextStepCostMs,
      heap: new DeterministicMinHeap(Math.min(256, Math.max(32, rCount))),
      initialized: false,
      expandingReg: -1,
      expandingDist: 0,
      cursorStage: 0,
      cursorIdx: 0,
      priorityTier,
      oldestTick: tick,
      done: false,
      result: null,
    }
    this.reverseTreeJobs.set(key, job)
    return { jobKey: key }
  }

  /** Step a resumable region-level reverse Dijkstra tree job within `budget`. */
  private stepReverseTreeJob(job: ReverseCoarseTreeJob, budget: WorkBudget): boolean {
    if (job.done) return true
    const topo = this.topology
    if (job.topologyRevision !== topo.topologyRevision) {
      job.done = true
      this.reverseTreeJobs.delete(job.key)
      return true
    }

    if (!job.initialized) {
      job.initialized = true
      const goalReg = topo.regions[job.goalRegionId]
      if (goalReg) {
        job.distMs[job.goalRegionId] = 0
        job.heap.push(job.goalRegionId, 0, goalReg.regionKey, 0)
      }
    }

    const regions = topo.regions
    const regionCrowdMs = job.snapshot.regionCrowdMs

    while (job.expandingReg >= 0 || job.heap.size > 0) {
      if (job.expandingReg < 0) {
        if (budget.pops <= 0) return false
        const { id: curReg, cost: curDist } = job.heap.pop()
        budget.pops--
        this.statsCoarseExpansions++
        if (curDist !== job.distMs[curReg]) continue
        job.expandingReg = curReg
        job.expandingDist = curDist
        job.cursorStage = 0
        job.cursorIdx = 0
      }

      const curReg = job.expandingReg
      const region = regions[curReg]
      const curCrowd = curReg < regionCrowdMs.length ? regionCrowdMs[curReg] : 0

      // Stage 0: incoming plain boundary crossings into `curReg`.
      if (job.cursorStage === 0) {
        const inCross = region.inCrossings
        while (job.cursorIdx < inCross.length) {
          if (budget.scans <= 0) return false
          const c = inCross[job.cursorIdx++]
          budget.scans--
          this.statsCoarseEdgeScans++
          const fromReg = c.fromRegion
          if (fromReg === curReg) continue
          const stepCost = c.repCostMs + curCrowd
          const edgeCost = Math.max(1, c.regionWalkMs + curCrowd)
          const nd = job.expandingDist + edgeCost
          if (nd < job.distMs[fromReg]) {
            job.distMs[fromReg] = nd
            job.nextKind[fromReg] = 1
            job.nextId[fromReg] = c.id
            job.nextStepCostMs[fromReg] = stepCost
            job.heap.push(fromReg, nd, regions[fromReg].regionKey, nd)
          }
        }
        job.cursorStage = 1
        job.cursorIdx = 0
      }

      // Stage 1: incoming explicit directed/service arcs into `curReg`.
      if (job.cursorStage === 1) {
        const inArcs = region.inExplicitArcs
        while (job.cursorIdx < inArcs.length) {
          if (budget.scans <= 0) return false
          const arc = inArcs[job.cursorIdx++]
          budget.scans--
          this.statsCoarseEdgeScans++
          const fromReg = arc.fromRegion
          if (fromReg === curReg) continue
          const arcCost = this.explicitArcCostMs(arc, job.needs, job.snapshot, -1)
          if (arcCost >= INF_MS) continue
          const edgeCost = Math.max(1, arc.fromHalfWalkMs + arcCost + arc.toHalfWalkMs)
          const nd = job.expandingDist + edgeCost
          if (nd < job.distMs[fromReg]) {
            job.distMs[fromReg] = nd
            job.nextKind[fromReg] = 2
            job.nextId[fromReg] = arc.id
            job.nextStepCostMs[fromReg] = arcCost
            job.heap.push(fromReg, nd, regions[fromReg].regionKey, nd)
          }
        }
      }

      job.expandingReg = -1
    }

    job.done = true
    const tree: ReverseCoarseTree = {
      key: job.key,
      topologyRevision: job.topologyRevision,
      snapshotId: job.snapshot.id,
      goalRegionId: job.goalRegionId,
      effNeeds: job.effNeeds,
      distMs: job.distMs,
      nextKind: job.nextKind,
      nextId: job.nextId,
      nextStepCostMs: job.nextStepCostMs,
    }
    job.result = tree
    if (this.coarseCacheSnapshotId === job.snapshot.id) {
      this.reverseTreeCache.set(job.key, tree)
    }
    return true
  }

  /** Build a `CoarseItinerary` for `(startNode -> goalNode)` in O(path length) from a solved `ReverseCoarseTree`. */
  private extractItineraryFromTree(
    tree: ReverseCoarseTree,
    startNode: number,
    goalNode: number,
    needs: Needs,
    snap: CostSnapshot,
  ): CoarseItinerary | null {
    const topo = this.topology
    const startReg = topo.nodeRegion[startNode]
    const goalReg = topo.nodeRegion[goalNode]
    if (startReg < 0 || goalReg < 0 || goalReg !== tree.goalRegionId) return null

    const nc = needsCode(needs)
    const startKey = topo.nodeTileKey[startNode]
    const goalKey = topo.nodeTileKey[goalNode]
    const regions = topo.regions

    if (startReg === goalReg) {
      const d = Math.round(
        Math.hypot(topo.nodeTx[startNode] - topo.nodeTx[goalNode], topo.nodeTy[startNode] - topo.nodeTy[goalNode]) *
          regions[startReg].walkMsPerM,
      )
      return {
        topologyRevision: tree.topologyRevision,
        costSnapshotId: tree.snapshotId,
        startKey,
        goalKey,
        needsClass: nc,
        steps: [],
        totalCostMs: d,
        nextGateServer: -1,
        nextGateDir: 0,
        nextGateDistMs: INF_MS,
        nextServiceServer: -1,
        nextServiceKind: '',
      }
    }

    if (tree.distMs[startReg] >= INF_MS) return null

    // Pick the best first step out of `startReg` using actual distance from `startNode`
    // (and actual distance to `goalNode` when adjacent to `goalReg`, preserving split-seam choice).
    const sRegion = regions[startReg]
    const gRegion = regions[goalReg]
    const sx = topo.nodeTx[startNode]
    const sy = topo.nodeTy[startNode]
    const gx = topo.nodeTx[goalNode]
    const gy = topo.nodeTy[goalNode]
    const regionCrowdMs = snap.regionCrowdMs

    let bestKind = 0
    let bestId = -1
    let bestFirstWalk = 0
    let bestStepCost = 0
    let bestTotal = INF_MS
    let bestTie = Infinity

    for (let i = 0; i < sRegion.crossings.length; i++) {
      const c = sRegion.crossings[i]
      const toReg = c.toRegion
      const rem = tree.distMs[toReg]
      if (rem >= INF_MS) continue
      const firstWalk = Math.round(Math.hypot(sx - topo.nodeTx[c.repFromNode], sy - topo.nodeTy[c.repFromNode]) * sRegion.walkMsPerM)
      const crowd = toReg < regionCrowdMs.length ? regionCrowdMs[toReg] : 0
      const stepCost = c.repCostMs + crowd
      const afterMs = toReg === goalReg
        ? Math.round(Math.hypot(topo.nodeTx[c.repToNode] - gx, topo.nodeTy[c.repToNode] - gy) * gRegion.walkMsPerM)
        : c.toHalfWalkMs + rem
      const total = firstWalk + stepCost + afterMs
      if (total < bestTotal || (total === bestTotal && c.repToKey < bestTie)) {
        bestTotal = total
        bestTie = c.repToKey
        bestKind = 1
        bestId = c.id
        bestFirstWalk = firstWalk
        bestStepCost = stepCost
      }
    }
    for (let i = 0; i < sRegion.explicitArcs.length; i++) {
      const arc = sRegion.explicitArcs[i]
      const toReg = arc.toRegion
      if (toReg === startReg) continue
      const rem = tree.distMs[toReg]
      if (rem >= INF_MS) continue
      const arcCost = this.explicitArcCostMs(arc, needs, snap, -1)
      if (arcCost >= INF_MS) continue
      const firstWalk = Math.round(Math.hypot(sx - topo.nodeTx[arc.fromNode], sy - topo.nodeTy[arc.fromNode]) * sRegion.walkMsPerM)
      const afterMs = toReg === goalReg
        ? Math.round(Math.hypot(topo.nodeTx[arc.toNode] - gx, topo.nodeTy[arc.toNode] - gy) * gRegion.walkMsPerM)
        : arc.toHalfWalkMs + rem
      const total = firstWalk + arcCost + afterMs
      if (total < bestTotal || (total === bestTotal && arc.toKey < bestTie)) {
        bestTotal = total
        bestTie = arc.toKey
        bestKind = 2
        bestId = arc.id
        bestFirstWalk = firstWalk
        bestStepCost = arcCost
      }
    }

    if (bestKind === 0 || bestId < 0) return null

    const steps: CoarseStep[] = []
    const walkPrefixMs: number[] = []
    const visited = new Set<number>()
    visited.add(startReg)

    const pushStep = (kind: number, id: number, walkMs: number, stepCost: number): number => {
      if (kind === 1) {
        const c = topo.crossings[id]
        steps.push({
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
        })
        walkPrefixMs.push(walkMs)
        return c.toRegion
      }
      const arc = topo.explicitArcs[id]
      steps.push({
        kind: 'explicit',
        crossingId: -1,
        arcId: arc.id,
        fromKey: arc.fromKey,
        toKey: arc.toKey,
        fromRegionKey: regions[arc.fromRegion].regionKey,
        toRegionKey: regions[arc.toRegion].regionKey,
        edgeKind: arc.kind,
        server: arc.server,
        toNodeServer: arc.toNodeServer,
        gateDir: arc.gateDir,
        costMs: stepCost,
      })
      walkPrefixMs.push(walkMs)
      return arc.toRegion
    }

    let prevNode = bestKind === 1 ? topo.crossings[bestId].repToNode : topo.explicitArcs[bestId].toNode
    let curReg = pushStep(bestKind, bestId, bestFirstWalk, bestStepCost)
    let totalCostMs = bestFirstWalk + bestStepCost

    while (curReg !== goalReg) {
      if (visited.has(curReg)) return null
      visited.add(curReg)
      const nk = tree.nextKind[curReg]
      const nid = tree.nextId[curReg]
      if (nk === 0 || nid < 0) return null
      const nextFrom = nk === 1 ? topo.crossings[nid].repFromNode : topo.explicitArcs[nid].fromNode
      const nextTo = nk === 1 ? topo.crossings[nid].repToNode : topo.explicitArcs[nid].toNode
      const walkMs = Math.round(
        Math.hypot(topo.nodeTx[prevNode] - topo.nodeTx[nextFrom], topo.nodeTy[prevNode] - topo.nodeTy[nextFrom]) *
          regions[curReg].walkMsPerM,
      )
      const sc = tree.nextStepCostMs[curReg]
      curReg = pushStep(nk, nid, walkMs, sc)
      totalCostMs += walkMs + sc
      prevNode = nextTo
    }

    totalCostMs += Math.round(
      Math.hypot(topo.nodeTx[prevNode] - gx, topo.nodeTy[prevNode] - gy) * gRegion.walkMsPerM,
    )

    // Extract upcoming gate / service metadata for forecasts beyond 16 steps.
    let nextGateServer = -1
    let nextGateDir: GateDir = 0
    let nextGateDistMs = INF_MS
    let nextServiceServer = -1
    let nextServiceKind = ''
    let accumMs = 0
    const g = topo.graph
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i]
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
      topologyRevision: tree.topologyRevision,
      costSnapshotId: tree.snapshotId,
      startKey,
      goalKey,
      needsClass: nc,
      steps,
      totalCostMs,
      nextGateServer,
      nextGateDir,
      nextGateDistMs,
      nextServiceServer,
      nextServiceKind,
    }
  }

  /** Return a warm cached coarse itinerary under the active snapshot without creating a pending job. */
  tryCachedCoarseSearch(
    startNode: number,
    goalNode: number,
    needs: Needs,
    excludedServer = -1,
  ): CoarseItinerary | null | undefined {
    const topo = this.topology
    if (startNode < 0 || goalNode < 0 || startNode >= topo.graph.nodeCount || goalNode >= topo.graph.nodeCount) {
      return null
    }
    const snapshot = this.currentSnapshot
    if (!snapshot) return undefined
    if (excludedServer < 0 && !topo.canReach(startNode, goalNode, needs.stepFree)) {
      return null
    }
    const nc = needsCode(needs)
    const cacheKey = `${snapshot.topologyRevision}|${snapshot.id}|${startNode}|${goalNode}|${nc}|${excludedServer}`
    if (this.coarseResultCache.has(cacheKey)) {
      this.statsCoarseQueries++
      this.statsCoarseCacheHits++
      return this.coarseResultCache.get(cacheKey)!
    }
    if (excludedServer < 0) {
      const startReg = topo.nodeRegion[startNode]
      const goalReg = topo.nodeRegion[goalNode]
      if (startReg >= 0 && startReg === goalReg) {
        const d = Math.round(
          Math.hypot(topo.nodeTx[startNode] - topo.nodeTx[goalNode], topo.nodeTy[startNode] - topo.nodeTy[goalNode]) *
            topo.regions[startReg].walkMsPerM,
        )
        const itin: CoarseItinerary = {
          topologyRevision: snapshot.topologyRevision,
          costSnapshotId: snapshot.id,
          startKey: topo.nodeTileKey[startNode],
          goalKey: topo.nodeTileKey[goalNode],
          needsClass: nc,
          steps: [],
          totalCostMs: d,
          nextGateServer: -1,
          nextGateDir: 0,
          nextGateDistMs: INF_MS,
          nextServiceServer: -1,
          nextServiceKind: '',
        }
        this.statsCoarseQueries++
        this.statsCoarseCacheHits++
        this.coarseResultCache.set(cacheKey, itin)
        return itin
      }
      const treeKey = `${snapshot.topologyRevision}|${snapshot.id}|${goalReg}|${this.effNeedsCode(needs)}`
      const tree = this.reverseTreeCache.get(treeKey)
      if (tree) {
        this.statsCoarseQueries++
        this.statsCoarseCacheHits++
        const itin = this.extractItineraryFromTree(tree, startNode, goalNode, needs, snapshot)
        this.coarseResultCache.set(cacheKey, itin)
        return itin
      }
    }
    return undefined
  }

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
    if (excludedServer < 0 && !topo.canReach(startNode, goalNode, needs.stepFree)) {
      return { status: 'no_path', itinerary: null }
    }

    const nc = needsCode(needs)
    const cacheKey = `${snapshot.topologyRevision}|${snapshot.id}|${startNode}|${goalNode}|${nc}|${excludedServer}`
    this.statsCoarseQueries++

    if (this.coarseResultCache.has(cacheKey)) {
      this.statsCoarseCacheHits++
      const cached = this.coarseResultCache.get(cacheKey)!
      return cached ? { status: 'ready', itinerary: cached } : { status: 'no_path', itinerary: null }
    }

    // Fast path for normal queries (excludedServer < 0): share one reverse region-graph tree per (goalRegion, effNeeds).
    if (excludedServer < 0) {
      const startReg = topo.nodeRegion[startNode]
      const goalReg = topo.nodeRegion[goalNode]
      if (startReg >= 0 && startReg === goalReg) {
        const d = Math.round(
          Math.hypot(topo.nodeTx[startNode] - topo.nodeTx[goalNode], topo.nodeTy[startNode] - topo.nodeTy[goalNode]) *
            topo.regions[startReg].walkMsPerM,
        )
        const itin: CoarseItinerary = {
          topologyRevision: snapshot.topologyRevision,
          costSnapshotId: snapshot.id,
          startKey: topo.nodeTileKey[startNode],
          goalKey: topo.nodeTileKey[goalNode],
          needsClass: nc,
          steps: [],
          totalCostMs: d,
          nextGateServer: -1,
          nextGateDir: 0,
          nextGateDistMs: INF_MS,
          nextServiceServer: -1,
          nextServiceKind: '',
        }
        this.coarseResultCache.set(cacheKey, itin)
        return { status: 'ready', itinerary: itin }
      }
      const { tree, jobKey } = this.getOrEnqueueReverseTree(goalReg, needs, snapshot, priorityTier, tick)
      if (tree) {
        this.statsCoarseCacheHits++
        const itin = this.extractItineraryFromTree(tree, startNode, goalNode, needs, snapshot)
        this.coarseResultCache.set(cacheKey, itin)
        return itin ? { status: 'ready', itinerary: itin } : { status: 'no_path', itinerary: null }
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
        excludedServer: -1,
        treeKey: jobKey,
        heap: new DeterministicMinHeap(1),
        bestCost: new Map(),
        parent: new Map(),
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

    const startReg = topo.nodeRegion[startNode]
    const goalReg = topo.nodeRegion[goalNode]
    if (startReg < 0 || goalReg < 0) return { status: 'no_path', itinerary: null }
    if (startReg === goalReg) {
      const d = Math.round(
        Math.hypot(topo.nodeTx[startNode] - topo.nodeTx[goalNode], topo.nodeTy[startNode] - topo.nodeTy[goalNode]) *
          topo.regions[startReg].walkMsPerM,
      )
      const itin: CoarseItinerary = {
        topologyRevision: snapshot.topologyRevision,
        costSnapshotId: snapshot.id,
        startKey: topo.nodeTileKey[startNode],
        goalKey: topo.nodeTileKey[goalNode],
        needsClass: nc,
        steps: [],
        totalCostMs: d,
        nextGateServer: -1,
        nextGateDir: 0,
        nextGateDistMs: INF_MS,
        nextServiceServer: -1,
        nextServiceKind: '',
      }
      this.coarseResultCache.set(cacheKey, itin)
      return { status: 'ready', itinerary: itin }
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
    bestCost.set(startReg, 0)
    heap.push(startReg, this.regionHeuristicMs(startReg, goalReg), topo.regions[startReg].regionKey, 0)

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
      treeKey: null,
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
      if (job.treeKey !== null) {
        const tj = this.reverseTreeJobs.get(job.treeKey)
        if (tj?.done) this.reverseTreeJobs.delete(job.treeKey)
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

  private coarseHeuristicMs(node: number, goalNode: number): number {
    const topo = this.topology
    const dx = topo.nodeTx[node] - topo.nodeTx[goalNode]
    const dy = topo.nodeTy[node] - topo.nodeTy[goalNode]
    return Math.floor(Math.hypot(dx, dy) * 500)
  }

  /**
   * 100% admissible horizontal Euclidean lower bound in integer milliseconds between region centroids.
   * Uses 2.0 m/s (500 ms/m), strictly faster than maximum floor speed (~1.474 m/s)
   * and moving walkways (1.84 m/s); vertical lift hops have dx=dy=0 so h=0.
   */
  private regionHeuristicMs(regId: number, goalRegId: number): number {
    const regions = this.topology.regions
    const r = regions[regId]
    const g = regions[goalRegId]
    return Math.floor(Math.hypot(r.centerX - g.centerX, r.centerY - g.centerY) * 500)
  }

  /** Step a resumable coarse search job (reverse region-tree for normal queries, region-level A* for excludedServer probes). */
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

    // Shared reverse region-tree backed coarse query (O(path length) extraction once the tree finishes).
    if (job.treeKey !== null) {
      let tree = this.reverseTreeCache.get(job.treeKey)
      if (!tree) {
        let tJob = this.reverseTreeJobs.get(job.treeKey)
        if (!tJob) {
          const goalReg = topo.nodeRegion[job.goalNode]
          const enq = this.getOrEnqueueReverseTree(goalReg, job.needs, job.snapshot, job.priorityTier, job.enqueuedTick)
          tree = enq.tree
          tJob = this.reverseTreeJobs.get(enq.jobKey)
        }
        if (!tree && tJob) {
          if (job.priorityTier < tJob.priorityTier) tJob.priorityTier = job.priorityTier
          if (job.enqueuedTick < tJob.oldestTick) tJob.oldestTick = job.enqueuedTick
          if (!tJob.done) this.stepReverseTreeJob(tJob, budget)
          if (tJob.done) tree = tJob.result ?? undefined
        }
      }
      if (!tree) return false
      const itinerary = this.extractItineraryFromTree(tree, job.startNode, job.goalNode, job.needs, job.snapshot)
      if (itinerary) {
        job.status = 'ready'
        job.result = itinerary
        if (this.coarseCacheSnapshotId === job.snapshot.id) {
          this.coarseResultCache.set(job.cacheKey, itinerary)
        }
      } else {
        job.status = 'failed'
        job.failReason = 'sparse-exhausted'
        if (this.coarseCacheSnapshotId === job.snapshot.id) {
          this.coarseResultCache.set(job.cacheKey, null)
        }
      }
      return true
    }

    // Region-level forward A* for excludedServer probes: zero 256-node field builds and
    // identical region-centroid cost model to `ReverseCoarseTree`.
    const startReg = topo.nodeRegion[job.startNode]
    const goalReg = topo.nodeRegion[job.goalNode]
    if (startReg < 0 || goalReg < 0) {
      job.status = 'failed'
      job.failReason = 'sparse-exhausted'
      return true
    }
    const regions = topo.regions
    const goalRegion = regions[goalReg]
    const sx = topo.nodeTx[job.startNode], sy = topo.nodeTy[job.startNode]
    const gx = topo.nodeTx[job.goalNode], gy = topo.nodeTy[job.goalNode]
    const regionCrowdMs = job.snapshot.regionCrowdMs

    while (job.expandingRegionId >= 0 || job.heap.size > 0) {
      if (job.expandingRegionId < 0) {
        if (budget.pops <= 0) return false
        const { id: curReg, cost } = job.heap.pop()
        budget.pops--
        this.statsCoarseExpansions++
        const best = job.bestCost.get(curReg)
        if (best === undefined || cost !== best) continue
        if (curReg === goalReg) {
          const itinerary = this.reconstructItinerary(job)
          job.status = 'ready'
          job.result = itinerary
          if (this.coarseCacheSnapshotId === job.snapshot.id) {
            this.coarseResultCache.set(job.cacheKey, itinerary)
          }
          return true
        }
        job.expandingRegionId = curReg
        job.expandingCost = cost
        job.cursorStage = 0
        job.cursorIdx = 0
      }

      const regId = job.expandingRegionId
      const region = regions[regId]
      if (!region) {
        job.expandingRegionId = -1
        continue
      }

      // Stage 0: outgoing plain boundary crossings from this region.
      if (job.cursorStage === 0) {
        const crossings = region.crossings
        while (job.cursorIdx < crossings.length) {
          if (budget.scans <= 0) return false
          const c = crossings[job.cursorIdx++]
          budget.scans--
          this.statsCoarseEdgeScans++
          const toReg = c.toRegion
          if (toReg === regId) continue
          const regCrowd = toReg >= 0 && toReg < regionCrowdMs.length ? regionCrowdMs[toReg] : 0
          const stepCost = c.repCostMs + regCrowd
          let edgeCost: number
          if (regId === startReg) {
            const firstWalk = Math.round(Math.hypot(sx - topo.nodeTx[c.repFromNode], sy - topo.nodeTy[c.repFromNode]) * region.walkMsPerM)
            const afterMs = toReg === goalReg
              ? Math.round(Math.hypot(topo.nodeTx[c.repToNode] - gx, topo.nodeTy[c.repToNode] - gy) * goalRegion.walkMsPerM)
              : c.toHalfWalkMs
            edgeCost = Math.max(1, firstWalk + stepCost + afterMs)
          } else if (toReg === goalReg) {
            const tailWalk = Math.round(Math.hypot(topo.nodeTx[c.repToNode] - gx, topo.nodeTy[c.repToNode] - gy) * goalRegion.walkMsPerM)
            edgeCost = Math.max(1, c.fromHalfWalkMs + stepCost + tailWalk)
          } else {
            edgeCost = Math.max(1, c.regionWalkMs + regCrowd)
          }
          const total = job.expandingCost + edgeCost
          const prev = job.bestCost.get(toReg)
          if (prev === undefined || total < prev) {
            job.bestCost.set(toReg, total)
            job.parent.set(toReg, {
              fromPoint: regId,
              walkMs: 0,
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
            const f = toReg === goalReg ? total : total + this.regionHeuristicMs(toReg, goalReg)
            job.heap.push(toReg, f, regions[toReg].regionKey, total)
          }
        }
        job.cursorStage = 1
        job.cursorIdx = 0
      }

      // Stage 1: outgoing explicit directed/service arcs from this region.
      if (job.cursorStage === 1) {
        const arcs = region.explicitArcs
        while (job.cursorIdx < arcs.length) {
          if (budget.scans <= 0) return false
          const arc = arcs[job.cursorIdx++]
          budget.scans--
          this.statsCoarseEdgeScans++
          const toReg = arc.toRegion
          if (toReg === regId) continue
          const arcCost = this.explicitArcCostMs(arc, job.needs, job.snapshot, job.excludedServer)
          if (arcCost >= INF_MS) continue
          const firstHalf = regId === startReg
            ? Math.round(Math.hypot(sx - topo.nodeTx[arc.fromNode], sy - topo.nodeTy[arc.fromNode]) * region.walkMsPerM)
            : arc.fromHalfWalkMs
          const afterMs = toReg === goalReg
            ? Math.round(Math.hypot(topo.nodeTx[arc.toNode] - gx, topo.nodeTy[arc.toNode] - gy) * goalRegion.walkMsPerM)
            : arc.toHalfWalkMs
          const edgeCost = Math.max(1, firstHalf + arcCost + afterMs)
          const total = job.expandingCost + edgeCost
          const prev = job.bestCost.get(toReg)
          if (prev === undefined || total < prev) {
            job.bestCost.set(toReg, total)
            job.parent.set(toReg, {
              fromPoint: regId,
              walkMs: 0,
              step: {
                kind: 'explicit',
                crossingId: -1,
                arcId: arc.id,
                fromKey: arc.fromKey,
                toKey: arc.toKey,
                fromRegionKey: region.regionKey,
                toRegionKey: regions[toReg].regionKey,
                edgeKind: arc.kind,
                server: arc.server,
                toNodeServer: arc.toNodeServer,
                gateDir: arc.gateDir,
                costMs: arcCost,
              },
            })
            const f = toReg === goalReg ? total : total + this.regionHeuristicMs(toReg, goalReg)
            job.heap.push(toReg, f, regions[toReg].regionKey, total)
          }
        }
      }

      job.expandingRegionId = -1
    }

    job.status = 'failed'
    job.failReason = 'sparse-exhausted'
    if (this.coarseCacheSnapshotId === job.snapshot.id) {
      this.coarseResultCache.set(job.cacheKey, null)
    }
    return true
  }

  private reconstructItinerary(job: CoarseSearchJob): CoarseItinerary {
    const topo = this.topology
    const regions = topo.regions
    const startReg = topo.nodeRegion[job.startNode]
    const goalReg = topo.nodeRegion[job.goalNode]
    const rev: CoarseStep[] = []
    let curReg = goalReg
    while (curReg !== startReg) {
      const p = job.parent.get(curReg)
      if (!p || !p.step) break
      rev.push(p.step)
      curReg = p.fromPoint
    }
    rev.reverse()

    const walkPrefixMs: number[] = []
    let prevNode = job.startNode
    let totalCostMs = 0
    for (let i = 0; i < rev.length; i++) {
      const st = rev[i]
      const nextFrom = st.kind === 'crossing' ? topo.crossings[st.crossingId].repFromNode : topo.explicitArcs[st.arcId].fromNode
      const nextTo = st.kind === 'crossing' ? topo.crossings[st.crossingId].repToNode : topo.explicitArcs[st.arcId].toNode
      const rId = topo.nodeRegion[prevNode]
      const walkMs = rId >= 0
        ? Math.round(Math.hypot(topo.nodeTx[prevNode] - topo.nodeTx[nextFrom], topo.nodeTy[prevNode] - topo.nodeTy[nextFrom]) * regions[rId].walkMsPerM)
        : 0
      walkPrefixMs.push(walkMs)
      totalCostMs += walkMs + st.costMs
      prevNode = nextTo
    }
    if (goalReg >= 0) {
      totalCostMs += Math.round(
        Math.hypot(topo.nodeTx[prevNode] - topo.nodeTx[job.goalNode], topo.nodeTy[prevNode] - topo.nodeTy[job.goalNode]) *
          regions[goalReg].walkMsPerM,
      )
    }

    // Extract upcoming gate / service metadata for forecasts beyond 16 steps.
    let nextGateServer = -1
    let nextGateDir: GateDir = 0
    let nextGateDistMs = INF_MS
    let nextServiceServer = -1
    let nextServiceKind = ''
    let accumMs = 0
    const g = topo.graph
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
      totalCostMs,
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
    heap.push(startNode, this.coarseHeuristicMs(startNode, goalNode), this.topology.nodeTileKey[startNode], 0)

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
          job.heap.push(nb, ng + this.coarseHeuristicMs(nb, job.goalNode), topo.nodeTileKey[nb], ng)
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
      const field = targetNodes.length === 1
        ? this.getSingletonField(regId, targetNodes[0], priorityTier, currentTick)
        : this.getField(regId, targetNodes, priorityTier, currentTick)
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

      const hasValidItinerary = w.itinerary !== null && w.itinerary.topologyRevision === this.topology.topologyRevision
      const isBlocked = a.path.length <= a.pathIdx
      if ((a.awaitingPath || (a.state === 1 && !hasValidItinerary)) && isBlocked && w.blockedSinceTick < 0) {
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
      } else if ((a.awaitingPath || a.state === 1) && !hasValidItinerary &&
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
        } else if (!this.topology.canReach(selfNode, w.goalNode, a.needs.stepFree)) {
          w.blockedSinceTick = -1
          this.claims.release(a.id)
          onNoPath(a)
        } else {
          w.pendingFineKey = this.enqueueFineRecovery(selfNode, w.goalNode, a.needs, -1, tier, tick, 'sparse-no-path')
          referencedFineKeys.add(w.pendingFineKey)
        }
      }
      if (w.candidateCoarseId >= 0) referencedCoarseIds.add(w.candidateCoarseId)
    }

    // Drop any orphaned jobs whose walkers died or moved on.
    const referencedTreeKeys = new Set<string>()
    for (const [id, job] of this.coarseJobs) {
      if (!referencedCoarseIds.has(id)) {
        this.coarseJobs.delete(id)
        if (this.coarseJobByCacheKey.get(job.cacheKey) === id) this.coarseJobByCacheKey.delete(job.cacheKey)
      } else if (job.treeKey !== null) {
        referencedTreeKeys.add(job.treeKey)
      }
    }
    for (const key of this.reverseTreeJobs.keys()) {
      if (!referencedTreeKeys.has(key)) this.reverseTreeJobs.delete(key)
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

    // Adopt ready coarse/fine results first, then refill in priority order:
    // (1) blocked walkers (remaining === 0), (2) low-buffer walkers (<= refillThreshold),
    // (3) optional live-crowd tail trims, so speculative trims never starve newly-alighted riders.
    const count = walkers.length
    const offset = count > 0 ? tick % count : 0
    let localRefillsLeft = this.localRefillBudget

    for (let k = 0; k < count; k++) {
      const { a, w, selfNode } = walkers[(offset + k) % count]
      if (a.dead || getWalker(a) !== w) continue

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
            if (job.failReason === 'sparse-exhausted' && !this.topology.canReach(selfNode, w.goalNode, a.needs.stepFree)) {
              w.blockedSinceTick = -1
              this.claims.release(a.id)
              onNoPath(a)
              continue
            }
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
    }

    const tryRefill = (a: Agent, w: SparseWalkerState, selfNode: number, isBlocked: boolean): void => {
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
          } else if (!this.topology.canReach(selfNode, w.goalNode, a.needs.stepFree)) {
            w.blockedSinceTick = -1
            this.claims.release(a.id)
            onNoPath(a)
          } else {
            w.pendingFineKey = this.enqueueFineRecovery(selfNode, w.goalNode, a.needs, -1, 0, tick, 'refill-repair')
          }
        }
      }
    }

    if (count > 0) {
      const startRefill = this.refillCursor % count
      let nextRefillCursor = startRefill
      // Pass 1: blocked walkers (remaining === 0) get first claim on local refills.
      for (let k = 0; k < count && localRefillsLeft > 0; k++) {
        const idx = (startRefill + k) % count
        nextRefillCursor = (idx + 1) % count
        const { a, w, selfNode } = walkers[idx]
        if (a.dead || getWalker(a) !== w) continue
        if (!w.itinerary || (a.state !== 1 && !a.awaitingPath)) continue
        if (w.segmentEndsAtGoal || w.segmentEndsAtService) continue
        const remaining = Math.max(0, a.path.length - a.pathIdx)
        if (remaining === 0) tryRefill(a, w, selfNode, true)
      }
      // Pass 2: low-buffer walkers (1..refillThreshold steps remaining).
      for (let k = 0; k < count && localRefillsLeft > 0; k++) {
        const idx = (startRefill + k) % count
        nextRefillCursor = (idx + 1) % count
        const { a, w, selfNode } = walkers[idx]
        if (a.dead || getWalker(a) !== w) continue
        if (!w.itinerary || (a.state !== 1 && !a.awaitingPath)) continue
        if (w.segmentEndsAtGoal || w.segmentEndsAtService) continue
        const remaining = Math.max(0, a.path.length - a.pathIdx)
        if (remaining > 0 && remaining <= this.refillThreshold) tryRefill(a, w, selfNode, false)
      }
      this.refillCursor = nextRefillCursor

      // Pass 3: optional live-crowd tail trims using any leftover local refill budget.
      if (localRefillsLeft > 0) {
        const startTrim = this.trimCursor % count
        let nextTrimCursor = startTrim
        for (let k = 0; k < count && localRefillsLeft > 0; k++) {
          const idx = (startTrim + k) % count
          nextTrimCursor = (idx + 1) % count
          const { a, w, selfNode } = walkers[idx]
          if (a.dead || getWalker(a) !== w) continue
          if (!w.itinerary || a.state !== 1) continue
          const remaining = Math.max(0, a.path.length - a.pathIdx)
          if (remaining <= this.refillThreshold) continue
          const check1 = a.pathIdx + 1 < a.path.length ? a.path[a.pathIdx + 1] : -1
          const check2 = a.pathIdx + 2 < a.path.length ? a.path[a.pathIdx + 2] : -1
          const crowdedAhead =
            (check1 >= 0 && (this.occupancy.otherBodiesOn(check1, selfNode) > 0 || (this.useClaims && this.claims.countOtherAgentsOn(check1, a.id) > 0))) ||
            (check2 >= 0 && (this.occupancy.otherBodiesOn(check2, selfNode) > 0 || (this.useClaims && this.claims.countOtherAgentsOn(check2, a.id) > 0)))
          if (!crowdedAhead) continue
          const keepEnd = Math.min(a.path.length, a.pathIdx + 2)
          let safePrefix = keepEnd < a.path.length
          const graph = this.topology.graph
          for (let j = a.pathIdx; safePrefix && j < keepEnd; j++) {
            if (graph.serverForNode.has(a.path[j])) safePrefix = false
            if (j + 1 < keepEnd && Math.abs(graph.nodeZ[a.path[j]] - graph.nodeZ[a.path[j + 1]]) > 1e-6) safePrefix = false
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
            tryRefill(a, w, selfNode, false)
          }
        }
        this.trimCursor = nextTrimCursor
      }

      // Track backlog age.
      for (let k = 0; k < count; k++) {
        const { a, w } = walkers[k]
        if (a.dead || getWalker(a) !== w) continue
        if (w.blockedSinceTick >= 0) {
          const age = tick - w.blockedSinceTick
          if (age > this.statsMaxBacklogAge) this.statsMaxBacklogAge = age
        }
      }
    }

    // Second quick pass of mandatory jobs if newly requested fields/coarse/fine jobs can finish within remaining budget.
    if (mandatoryBudget.pops > 0 && mandatoryBudget.scans > 0 &&
        (this.fieldJobs.size > 0 || this.coarseJobs.size > 0 || this.fineJobs.size > 0)) {
      this.runMandatoryJobs(mandatoryBudget, snap, tick)
      // Immediately adopt newly-finished coarse/fine/field results for blocked walkers so delay stays minimal!
      for (let k = 0; k < count; k++) {
        const { a, w, selfNode } = walkers[(offset + k) % count]
        if (a.dead || getWalker(a) !== w) continue
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

    // Prune completed coarse/tree/fine jobs once adopted.
    for (const [id, job] of this.coarseJobs) {
      if (job.status !== 'running') {
        this.coarseJobs.delete(id)
        if (this.coarseJobByCacheKey.get(job.cacheKey) === id) this.coarseJobByCacheKey.delete(job.cacheKey)
      }
    }
    for (const [key, tJob] of this.reverseTreeJobs) {
      if (tJob.done) this.reverseTreeJobs.delete(key)
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

      // 1b. Run highest-priority shared reverse region-tree jobs so all waiting queries unblock together.
      if (this.reverseTreeJobs.size > 0 && budget.pops > 0 && budget.scans > 0) {
        const sortedTrees = [...this.reverseTreeJobs.values()]
          .filter((j) => !j.done)
          .sort((a, b) => {
            const aAge = tick - a.oldestTick >= SPARSE_AGE_PROMOTE_TICKS ? 0 : a.priorityTier
            const bAge = tick - b.oldestTick >= SPARSE_AGE_PROMOTE_TICKS ? 0 : b.priorityTier
            return aAge - bAge || a.oldestTick - b.oldestTick || a.goalRegionId - b.goalRegionId || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
          })
        for (let i = 0; i < sortedTrees.length && budget.pops > 0 && budget.scans > 0; i++) {
          const prevPops = budget.pops, prevScans = budget.scans
          this.stepReverseTreeJob(sortedTrees[i], budget)
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
          const prevStatus = sortedCoarse[i].status
          this.stepCoarseJob(sortedCoarse[i], budget)
          if (budget.pops !== prevPops || budget.scans !== prevScans ||
              this.fieldJobs.size !== prevFieldCount || sortedCoarse[i].status !== prevStatus) {
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

    // Finalize any tree-backed coarse jobs whose shared reverse tree finished on the last pop/scan.
    for (const job of this.coarseJobs.values()) {
      if (job.status === 'running' && job.treeKey !== null) {
        const readyTree = this.reverseTreeCache.get(job.treeKey) ?? this.reverseTreeJobs.get(job.treeKey)?.result
        if (readyTree) this.stepCoarseJob(job, budget)
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
