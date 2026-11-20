using System;
using System.Collections.Generic;

namespace Metro.Sim {
    public sealed class StationSparseRouterOptions {
        public int Horizon = StationSparsePolicy.WalkHorizon;
        public int RefillThreshold = StationSparsePolicy.RefillThreshold;
        public int FieldCacheMaxBytes = StationSparsePolicy.FieldCacheMaxBytes;
        public int MandatoryPopBudget = StationSparsePolicy.MandatoryPopBudget;
        public int MandatoryScanBudget = StationSparsePolicy.MandatoryScanBudget;
        public int LocalRefillBudget = StationSparsePolicy.LocalRefillBudget;
        public int OptionalPopBudget = StationSparsePolicy.OptionalPopBudget;
        public int OptionalScanBudget = StationSparsePolicy.OptionalScanBudget;
        public int FineRecoveryPopBudget = StationSparsePolicy.FineRecoveryPopBudget;
        public bool UseDensity = true;
        public bool UseBias = true;
        public bool UseClaims = true;
        public bool UseSamples = true;
    }

    public sealed class StationCoarseStep {
        public bool IsCrossing;
        public int CrossingId = -1;
        public int ArcId = -1;
        public long FromKey;
        public long ToKey;
        public long FromRegionKey;
        public long ToRegionKey;
        public WalkEdgeKind EdgeKind;
        public int Server = -1;
        public int ToNodeServer = -1;
        public int GateDir;
        public string LiftId;
        public int CostMs;
    }

    public sealed class StationCoarseItinerary {
        public int TopologyRevision;
        public int CostSnapshotId;
        public long StartKey;
        public long GoalKey;
        public byte NeedsBits;
        public StationCoarseStep[] Steps = Array.Empty<StationCoarseStep>();
        public int TotalCostMs;
        public int NextGateServer = -1;
        public int NextGateDir;
        public int NextGateDistMs = StationSparsePolicy.InfMs;
        public int NextServiceServer = -1;
        public string NextServiceKind = "";
    }

    public sealed class StationSparseWalkerState {
        public int SessionId;
        public int LegGen;
        public int GoalNode = -1;
        public long GoalKey = -1;
        public StationCoarseItinerary Itinerary;
        public int StepIdx;
        public int SegmentSequence;
        public int Heading = -1;
        public bool SegmentEndsAtGoal;
        public bool SegmentEndsAtService;
        public string PendingLiftId;
        public int PendingLiftBoardNode = -1;
        public int PendingLiftDestNode = -1;
        public int PendingCoarseId = -1;
        public int BlockedSinceTick = -1;
        public int SparseMisses;
        public int RetryAfterTick;
        public int CandidateCoarseId = -1;
        public int CandidateExcludedServer = -1;
        public int CandidateOriginNode = -1;
    }

    public sealed class StationSparseRoutingStats {
        public int TopologyRevision;
        public int SectorCount;
        public int RegionCount;
        public int CrossingCount;
        public int ExplicitArcCount;
        public long CoarseQueries;
        public long CoarseCacheHits;
        public long CoarseExpansions;
        public long CoarseEdgeScans;
        public long FieldBuilds;
        public long FieldCacheHits;
        public long FieldExpansions;
        public long FieldEdgeScans;
        public int FieldCacheEntries;
        public int FieldCacheBytes;
        public long LocalRefills;
        public long LocalNeighbourScans;
        public long FineFallbacks;
        public long FineExpansions;
        public int SectorsRebuilt;
        public int FieldsPreservedOnEdit;
        public int SamplesRefreshed;
        public int PendingFieldJobs;
        public int PendingCoarseJobs;
        public int MaxBacklogAge;
        public int ActiveClaims;
    }

    public sealed class StationSparseCostSnapshot {
        public int Id;
        public int TopologyRevision;
        public uint Signature;
        public int[] GateWaitMs = Array.Empty<int>();
        public int[] ServerWaitMs = Array.Empty<int>();
        public int[] RegionCrowdMs = Array.Empty<int>();
        public Dictionary<string, int> LiftWaitMs = new Dictionary<string, int>(StringComparer.Ordinal);
    }

    /// <summary>
    /// Shared reverse distance fields, resumable coarse sparse A*, bounded fine-graph recovery,
    /// rolling 16-step local walker, soft claims, service rechoice and edit-retaining lifecycle
    /// (design/crowd-routing-plan.md §1–§4). Pure <c>Metro.Sim</c> twin of <c>sparseRouter.ts</c>.
    /// </summary>
    public sealed class StationSparseRouter {
        sealed class ReverseField {
            public string Key;
            public long RegionKey;
            public int RegionRevision;
            public int[] DistMs;
            public int Bytes;
            public LinkedListNode<string> LruNode;
        }

        struct WorkBudget {
            public int Pops;
            public int Scans;
        }

        internal sealed class DeterministicMinHeap {
            int[] ids;
            int[] prios;
            int[] gCosts;
            long[] ties;
            int len;

            public DeterministicMinHeap(int cap = 64) {
                int c = Math.Max(8, cap);
                ids = new int[c];
                prios = new int[c];
                gCosts = new int[c];
                ties = new long[c];
            }

            public int Count => len;
            public void Clear() => len = 0;

            public void Push(int id, int prio, long tie, int gCost) {
                if (len == ids.Length) {
                    int next = len * 2;
                    Array.Resize(ref ids, next);
                    Array.Resize(ref prios, next);
                    Array.Resize(ref gCosts, next);
                    Array.Resize(ref ties, next);
                }
                int i = len++;
                ids[i] = id;
                prios[i] = prio;
                gCosts[i] = gCost;
                ties[i] = tie;
                while (i > 0) {
                    int p = (i - 1) >> 1;
                    if (Less(p, i)) break;
                    Swap(p, i);
                    i = p;
                }
            }

            public void Pop(out int id, out int gCost) {
                id = ids[0];
                gCost = gCosts[0];
                len--;
                if (len > 0) {
                    ids[0] = ids[len];
                    prios[0] = prios[len];
                    gCosts[0] = gCosts[len];
                    ties[0] = ties[len];
                    int i = 0;
                    for (;;) {
                        int l = (i << 1) + 1;
                        int r = l + 1;
                        int m = i;
                        if (l < len && Less(l, m)) m = l;
                        if (r < len && Less(r, m)) m = r;
                        if (m == i) break;
                        Swap(m, i);
                        i = m;
                    }
                }
            }

            bool Less(int a, int b) => prios[a] != prios[b] ? prios[a] < prios[b] : ties[a] < ties[b];

            void Swap(int a, int b) {
                int id = ids[a]; ids[a] = ids[b]; ids[b] = id;
                int p = prios[a]; prios[a] = prios[b]; prios[b] = p;
                int g = gCosts[a]; gCosts[a] = gCosts[b]; gCosts[b] = g;
                long t = ties[a]; ties[a] = ties[b]; ties[b] = t;
            }
        }

        sealed class FieldJob {
            public string Key;
            public int RegionId;
            public long RegionKey;
            public int RegionRevision;
            public int[] TargetLocalIndices;
            public int[] DistMs;
            public DeterministicMinHeap Heap;
            public bool Initialized;
            public int ExpandingLocal = -1;
            public int ExpandingDist;
            public int EdgeCursor;
            public int PriorityTier;
            public int OldestTick;
            public bool Done;
            public bool Stale;
        }

        internal sealed class CachedSuffix {
            public StationCoarseStep[] Steps;
            public int[] WalkPrefixMs;
            public int RemainingCostMs;
        }

        internal struct CoarseParent {
            public int FromPoint;
            public StationCoarseStep Step;
            public int WalkMs;
            public CachedSuffix Suffix;
        }

        public enum CoarseJobStatus { Running = 0, Ready = 1, Failed = 2 }

        public sealed class CoarseSearchJob {
            public int Id;
            public string CacheKey;
            public int TopologyRevision;
            public StationSparseCostSnapshot Snapshot;
            public int StartNode;
            public int GoalNode;
            public long StartKey;
            public long GoalKey;
            public StationRouteNeeds Needs;
            public byte NeedsBits;
            public int ExcludedServer;
            internal DeterministicMinHeap Heap;
            internal Dictionary<int, int> BestCost;
            internal Dictionary<int, CoarseParent> Parent;
            internal int ExpandingPoint = -1;
            internal int ExpandingCost;
            internal int ExpandingRegionId = -1;
            internal int CursorStage;
            internal int CursorIdx;
            internal string WaitingFieldKey;
            public int EnqueuedTick;
            public int PriorityTier;
            public CoarseJobStatus Status;
            public StationCoarseItinerary Result;
            public string FailReason = "";
        }

        public StationSparseTopology Topology { get; private set; }
        public int SessionId { get; private set; } = 1;
        public readonly StationStandingOccupancy Occupancy;
        public readonly StationSoftClaimTable Claims;
        public readonly StationSparseRouterOptions Options;

        readonly Dictionary<string, ReverseField> fieldCache = new Dictionary<string, ReverseField>(StringComparer.Ordinal);
        readonly LinkedList<string> fieldLru = new LinkedList<string>();
        readonly Dictionary<int, ReverseField> singletonFieldCache = new Dictionary<int, ReverseField>();
        int fieldCacheBytes;
        readonly Dictionary<string, FieldJob> fieldJobs = new Dictionary<string, FieldJob>(StringComparer.Ordinal);

        int nextCoarseId = 1;
        readonly Dictionary<int, CoarseSearchJob> coarseJobs = new Dictionary<int, CoarseSearchJob>();
        readonly Dictionary<string, int> coarseJobByCacheKey = new Dictionary<string, int>(StringComparer.Ordinal);
        readonly Dictionary<string, StationCoarseItinerary> coarseResultCache = new Dictionary<string, StationCoarseItinerary>(StringComparer.Ordinal);
        readonly Dictionary<string, CachedSuffix> coarseSuffixCache = new Dictionary<string, CachedSuffix>(StringComparer.Ordinal);
        int coarseCacheSnapshotId = -1;
        int costSnapshotSeq;
        StationSparseCostSnapshot currentSnapshot;

        int elapsedTicks;
        int lastScheduledRefreshTick;
        bool pendingPlayResume;
        readonly List<(long SectorKey, int RequestedRevision)> sampleRefreshQueue = new List<(long, int)>();
        readonly HashSet<long> sampleQueuedKeys = new HashSet<long>();

        // Telemetry
        long statsCoarseQueries, statsCoarseCacheHits, statsCoarseExpansions, statsCoarseEdgeScans;
        long statsFieldBuilds, statsFieldCacheHits, statsFieldExpansions, statsFieldEdgeScans;
        long statsLocalRefills, statsLocalNeighbourScans, statsFineFallbacks, statsFineExpansions;
        int statsSectorsRebuilt, statsFieldsPreserved, statsSamplesRefreshed, statsMaxBacklogAge;

        static readonly int StairAvoidMs = StationSparsePolicy.ToMs(StationRoutePlanner.StairAvoidSeconds);

        public StationSparseRouter(
            StationWalkGraph graph,
            int seed,
            IReadOnlyList<StationSparseLiftLink> liftLinks,
            StationSparseRouterOptions options = null) {
            Options = options ?? new StationSparseRouterOptions();
            Topology = StationSparseTopology.Build(graph, seed, liftLinks, null, out _);
            Occupancy = new StationStandingOccupancy(graph.NodeCount);
            Claims = new StationSoftClaimTable(graph.NodeCount);
        }

        public void ResetForNewDocument(StationWalkGraph graph, int seed, IReadOnlyList<StationSparseLiftLink> liftLinks) {
            SessionId++;
            Topology = StationSparseTopology.Build(graph, seed, liftLinks, null, out _);
            Occupancy.Resize(graph.NodeCount);
            Claims.Resize(graph.NodeCount);
            fieldCache.Clear();
            fieldLru.Clear();
            singletonFieldCache.Clear();
            fieldCacheBytes = 0;
            fieldJobs.Clear();
            coarseJobs.Clear();
            coarseJobByCacheKey.Clear();
            coarseResultCache.Clear();
            coarseSuffixCache.Clear();
            sampleRefreshQueue.Clear();
            sampleQueuedKeys.Clear();
            currentSnapshot = null;
            elapsedTicks = 0;
            lastScheduledRefreshTick = 0;
            pendingPlayResume = false;
        }

        public void ResetForRestart(StationWalkGraph graph) {
            Topology.Graph = graph;
            Occupancy.Resize(graph.NodeCount);
            Claims.Clear();
            fieldJobs.Clear();
            coarseJobs.Clear();
            coarseJobByCacheKey.Clear();
            coarseResultCache.Clear();
            coarseSuffixCache.Clear();
            currentSnapshot = null;
            elapsedTicks = 0;
            lastScheduledRefreshTick = 0;
            pendingPlayResume = false;
        }

        public void NotifyPlayResumed() => pendingPlayResume = true;

        public StationSparseTopologyDiff OnCommit(
            StationWalkGraph newGraph,
            int seed,
            IReadOnlyList<StationSparseLiftLink> liftLinks) {
            var prev = Topology;
            var next = StationSparseTopology.Build(newGraph, seed, liftLinks, prev, out var diff);
            Topology = next;
            Occupancy.Resize(newGraph.NodeCount);

            Claims.Remap(newGraph.NodeCount, oldNode => {
                if ((uint)oldNode >= (uint)prev.NodeTileKey.Length) return -1;
                return next.TileKeyToNode.TryGetValue(prev.NodeTileKey[oldNode], out int mapped) ? mapped : -1;
            });

            if (diff.RoutingNeutral) {
                statsFieldsPreserved += fieldCache.Count;
                RebuildSingletonIndex();
                fieldJobs.Clear();
                coarseJobs.Clear();
                coarseJobByCacheKey.Clear();
                coarseResultCache.Clear();
                coarseSuffixCache.Clear();
                currentSnapshot = null;
                return diff;
            }

            statsSectorsRebuilt += diff.DirtySectorKeys.Count;
            var toRemove = new List<string>();
            int preserved = 0;
            foreach (var kv in fieldCache) {
                if (diff.DirtyRegionKeys.Contains(kv.Value.RegionKey)) toRemove.Add(kv.Key);
                else preserved++;
            }
            for (int i = 0; i < toRemove.Count; i++) {
                var entry = fieldCache[toRemove[i]];
                fieldCache.Remove(toRemove[i]);
                if (entry.LruNode != null) fieldLru.Remove(entry.LruNode);
                fieldCacheBytes -= entry.Bytes;
            }
            statsFieldsPreserved += preserved;
            RebuildSingletonIndex();

            foreach (var kv in fieldJobs) kv.Value.Stale = true;
            fieldJobs.Clear();
            coarseJobs.Clear();
            coarseJobByCacheKey.Clear();
            coarseResultCache.Clear();
            coarseSuffixCache.Clear();
            currentSnapshot = null;
            return diff;
        }

        void RebuildSingletonIndex() {
            singletonFieldCache.Clear();
            foreach (var kv in fieldCache) {
                if (TryParseSingletonTileKey(kv.Key, out long tk) && Topology.TileKeyToNode.TryGetValue(tk, out int node)) {
                    singletonFieldCache[node] = kv.Value;
                }
            }
        }

        static bool TryParseSingletonTileKey(string key, out long tileKey) {
            tileKey = -1;
            int p1 = key.IndexOf('|');
            if (p1 < 0) return false;
            int p2 = key.IndexOf('|', p1 + 1);
            if (p2 < 0 || key.IndexOf(',', p2 + 1) >= 0) return false;
            return long.TryParse(key.Substring(p2 + 1), out tileKey);
        }

        public StationSparseWalkerState CreateWalker(int goalNode, int prevLegGen = 0) {
            long goalKey = (uint)goalNode < (uint)Topology.NodeTileKey.Length ? Topology.NodeTileKey[goalNode] : -1;
            return new StationSparseWalkerState {
                SessionId = SessionId,
                LegGen = prevLegGen + 1,
                GoalNode = goalNode,
                GoalKey = goalKey,
            };
        }

        public StationSparseCostSnapshot CaptureCostSnapshot(
            Func<int, int, double> gateWaitFn,
            IReadOnlyDictionary<string, double> liftWaits) {
            var g = Topology.Graph;
            int numServers = g.Servers.Count;
            var gateWaitMs = new int[numServers * 3];
            var serverWaitMs = new int[numServers];
            uint sig = StationSparsePolicy.Hash32Init(Topology.TopologyRevision);
            sig = StationSparsePolicy.Hash32Mix(sig, numServers);

            for (int i = 0; i < numServers; i++) {
                var srv = g.Servers[i];
                if (srv.Kind == "gate") {
                    for (int d = -1; d <= 1; d++) {
                        double w = gateWaitFn != null ? gateWaitFn(i, d) : DefaultQueueWait(srv);
                        int ms = StationSparsePolicy.ToMs(w);
                        gateWaitMs[i * 3 + d + 1] = ms;
                        if (ms > 0) {
                            sig = StationSparsePolicy.Hash32Mix(sig, (i << 2) | (d + 1));
                            sig = StationSparsePolicy.Hash32Mix(sig, ms);
                        }
                    }
                } else {
                    int ms = StationSparsePolicy.ToMs(DefaultQueueWait(srv));
                    if ((srv.Kind == "escalator" || srv.Kind == "stair" || srv.Kind == "walkway") &&
                        (uint)srv.Node < (uint)g.NodeCount) {
                        int crowd = CountTwoHopCrowd(srv.Node);
                        if ((uint)srv.ExitNode < (uint)g.NodeCount) {
                            crowd += Occupancy.OtherBodiesOn(srv.ExitNode, -1);
                        }
                        int bucket = Math.Min(24, (crowd / 4) * 4);
                        if (bucket > 0) ms += bucket * 1500;
                    }
                    serverWaitMs[i] = ms;
                    if (ms > 0) {
                        sig = StationSparsePolicy.Hash32Mix(sig, i);
                        sig = StationSparsePolicy.Hash32Mix(sig, ms);
                    }
                }
            }

            var liftWaitMs = new Dictionary<string, int>(StringComparer.Ordinal);
            if (liftWaits != null) {
                var keys = new List<string>(liftWaits.Keys);
                keys.Sort(StringComparer.Ordinal);
                for (int i = 0; i < keys.Count; i++) {
                    int ms = StationSparsePolicy.ToMs(liftWaits[keys[i]]);
                    liftWaitMs[keys[i]] = ms;
                    if (ms > 0) {
                        sig = StationSparsePolicy.Hash32Mix(sig, i + 10000);
                        sig = StationSparsePolicy.Hash32Mix(sig, ms);
                    }
                }
            }

            // Quantized per-region crush charge (0 ms under 10 bodies/region; 4 discrete levels)
            // so coarse itineraries prefer closer connectors over trudging across jammed platform sectors.
            int numRegions = Topology.Regions.Count;
            var regionCrowdMs = new int[numRegions];
            for (int r = 0; r < numRegions; r++) {
                var regNodes = Topology.Regions[r].Nodes;
                int bodies = 0;
                for (int k = 0; k < regNodes.Length; k++) bodies += Occupancy.OtherBodiesOn(regNodes[k], -1);
                int bucket = Math.Min(4, bodies / 10);
                if (bucket > 0) {
                    int ms = bucket * 5000;
                    regionCrowdMs[r] = ms;
                    sig = StationSparsePolicy.Hash32Mix(sig, r + 50000);
                    sig = StationSparsePolicy.Hash32Mix(sig, ms);
                }
            }

            if (currentSnapshot != null &&
                currentSnapshot.TopologyRevision == Topology.TopologyRevision &&
                currentSnapshot.Signature == sig) {
                return currentSnapshot;
            }

            var snap = new StationSparseCostSnapshot {
                Id = ++costSnapshotSeq,
                TopologyRevision = Topology.TopologyRevision,
                Signature = sig,
                GateWaitMs = gateWaitMs,
                ServerWaitMs = serverWaitMs,
                RegionCrowdMs = regionCrowdMs,
                LiftWaitMs = liftWaitMs,
            };
            currentSnapshot = snap;
            if (coarseCacheSnapshotId != snap.Id) {
                coarseResultCache.Clear();
                coarseSuffixCache.Clear();
                coarseCacheSnapshotId = snap.Id;
            }
            return snap;
        }

        readonly HashSet<int> crowdScratch = new HashSet<int>();

        int CountTwoHopCrowd(int center) {
            crowdScratch.Clear();
            crowdScratch.Add(center);
            var pStart = Topology.PlainAdjStart;
            var pTo = Topology.PlainAdjTo;
            for (int e = pStart[center]; e < pStart[center + 1]; e++) {
                int n1 = pTo[e];
                crowdScratch.Add(n1);
                for (int e2 = pStart[n1]; e2 < pStart[n1 + 1]; e2++) {
                    crowdScratch.Add(pTo[e2]);
                }
            }
            int total = 0;
            foreach (int n in crowdScratch) total += Occupancy.OtherBodiesOn(n, -1);
            return total;
        }

        public int CurrentServerWaitMs(int server) {
            if (currentSnapshot == null || (uint)server >= (uint)currentSnapshot.ServerWaitMs.Length) return 0;
            return currentSnapshot.ServerWaitMs[server];
        }

        static double DefaultQueueWait(StationServerFact srv) {
            if (srv == null) return 0;
            double w = srv.Rate > 0 ? srv.QueueCount / srv.Rate : srv.QueueCount;
            return w > 600 ? 600 : w;
        }

        static byte NeedsBitsOf(StationRouteNeeds n) => (byte)((n.StepFree ? 1 : 0) | (n.Luggage ? 2 : 0));

        static int LiftAvoidMs(StationRouteNeeds n) {
            if (n.StepFree) return 0;
            return StationSparsePolicy.ToMs(n.Luggage ? StationRoutePlanner.LiftAvoidLuggageSeconds : StationRoutePlanner.LiftAvoidSeconds);
        }

        /* ------------------------------------------------- Reverse Fields */

        string FieldKeyForNodes(StationSparseRegion region, int[] targetNodes) {
            if (targetNodes.Length == 1) {
                return region.RegionKey + "|" + region.Revision + "|" + Topology.NodeTileKey[targetNodes[0]];
            }
            var keys = new long[targetNodes.Length];
            for (int i = 0; i < targetNodes.Length; i++) keys[i] = Topology.NodeTileKey[targetNodes[i]];
            Array.Sort(keys);
            return region.RegionKey + "|" + region.Revision + "|" + string.Join(",", keys);
        }

        ReverseField GetSingletonField(int regionId, int targetNode, int priorityTier, int requestTick) {
            if (singletonFieldCache.TryGetValue(targetNode, out var fast)) {
                var reg = Topology.Regions[regionId];
                if (reg != null && fast.RegionKey == reg.RegionKey && fast.RegionRevision == reg.Revision) {
                    statsFieldCacheHits++;
                    return fast;
                }
                singletonFieldCache.Remove(targetNode);
            }
            var f = GetField(regionId, new[] { targetNode }, priorityTier, requestTick);
            if (f != null) singletonFieldCache[targetNode] = f;
            return f;
        }

        ReverseField GetField(int regionId, int[] targetNodes, int priorityTier, int requestTick) {
            if ((uint)regionId >= (uint)Topology.Regions.Count || targetNodes == null || targetNodes.Length == 0) return null;
            var region = Topology.Regions[regionId];
            string key = FieldKeyForNodes(region, targetNodes);
            if (fieldCache.TryGetValue(key, out var hit)) {
                statsFieldCacheHits++;
                if (hit.LruNode != null) {
                    fieldLru.Remove(hit.LruNode);
                    fieldLru.AddLast(hit.LruNode);
                }
                return hit;
            }
            if (region.Nodes.Length == 1) {
                var dist = new int[1];
                bool match = false;
                for (int i = 0; i < targetNodes.Length; i++) if (targetNodes[i] == region.Nodes[0]) { match = true; break; }
                dist[0] = match ? 0 : StationSparsePolicy.InfMs;
                return PublishField(key, region, dist);
            }
            if (fieldJobs.TryGetValue(key, out var existing)) {
                if (priorityTier < existing.PriorityTier) existing.PriorityTier = priorityTier;
                if (requestTick < existing.OldestTick) existing.OldestTick = requestTick;
                return null;
            }

            var locals = new List<int>(targetNodes.Length);
            for (int i = 0; i < targetNodes.Length; i++) {
                int tn = targetNodes[i];
                if ((uint)tn < (uint)Topology.NodeRegion.Length && Topology.NodeRegion[tn] == regionId) {
                    locals.Add(Topology.NodeLocalIdx[tn]);
                }
            }
            var distMs = new int[region.Nodes.Length];
            Array.Fill(distMs, StationSparsePolicy.InfMs);
            if (locals.Count == 0) return PublishField(key, region, distMs);

            var job = new FieldJob {
                Key = key,
                RegionId = regionId,
                RegionKey = region.RegionKey,
                RegionRevision = region.Revision,
                TargetLocalIndices = locals.ToArray(),
                DistMs = distMs,
                Heap = new DeterministicMinHeap(Math.Min(256, Math.Max(16, region.Nodes.Length))),
                PriorityTier = priorityTier,
                OldestTick = requestTick,
            };
            fieldJobs[key] = job;
            return null;
        }

        ReverseField PublishField(string key, StationSparseRegion region, int[] distMs) {
            int bytes = distMs.Length * 4 + 96;
            if (fieldCache.TryGetValue(key, out var old)) {
                fieldCacheBytes -= old.Bytes;
                if (old.LruNode != null) fieldLru.Remove(old.LruNode);
                fieldCache.Remove(key);
            }
            var node = fieldLru.AddLast(key);
            var field = new ReverseField {
                Key = key,
                RegionKey = region.RegionKey,
                RegionRevision = region.Revision,
                DistMs = distMs,
                Bytes = bytes,
                LruNode = node,
            };
            fieldCache[key] = field;
            fieldCacheBytes += bytes;
            if (TryParseSingletonTileKey(key, out long tk) && Topology.TileKeyToNode.TryGetValue(tk, out int n)) {
                singletonFieldCache[n] = field;
            }
            statsFieldBuilds++;
            EvictColdFields();
            return field;
        }

        void EvictColdFields() {
            while (fieldCacheBytes > Options.FieldCacheMaxBytes && fieldCache.Count > 1 && fieldLru.First != null) {
                string oldestKey = fieldLru.First.Value;
                fieldLru.RemoveFirst();
                if (!fieldCache.TryGetValue(oldestKey, out var entry)) continue;
                fieldCache.Remove(oldestKey);
                fieldCacheBytes -= entry.Bytes;
                if (TryParseSingletonTileKey(oldestKey, out long tk) &&
                    Topology.TileKeyToNode.TryGetValue(tk, out int n) &&
                    singletonFieldCache.TryGetValue(n, out var cur) && ReferenceEquals(cur, entry)) {
                    singletonFieldCache.Remove(n);
                }
            }
        }

        bool StepFieldJob(FieldJob job, ref WorkBudget budget) {
            if ((uint)job.RegionId >= (uint)Topology.Regions.Count) {
                job.Stale = job.Done = true;
                fieldJobs.Remove(job.Key);
                return true;
            }
            var region = Topology.Regions[job.RegionId];
            if (region.RegionKey != job.RegionKey || region.Revision != job.RegionRevision) {
                job.Stale = job.Done = true;
                fieldJobs.Remove(job.Key);
                return true;
            }
            if (!job.Initialized) {
                job.Initialized = true;
                for (int i = 0; i < job.TargetLocalIndices.Length; i++) {
                    int li = job.TargetLocalIndices[i];
                    if (job.DistMs[li] == 0) continue;
                    job.DistMs[li] = 0;
                    job.Heap.Push(li, 0, region.TileKeys[li], 0);
                }
            }
            var plainStart = Topology.PlainAdjStart;
            var plainTo = Topology.PlainAdjTo;
            var plainCost = Topology.PlainAdjCostMs;
            var nodeReg = Topology.NodeRegion;
            var nodeLocal = Topology.NodeLocalIdx;

            while (job.ExpandingLocal >= 0 || job.Heap.Count > 0) {
                if (job.ExpandingLocal < 0) {
                    if (budget.Pops <= 0) return false;
                    job.Heap.Pop(out int curLocal, out int curDist);
                    budget.Pops--;
                    statsFieldExpansions++;
                    if (curDist != job.DistMs[curLocal]) continue;
                    job.ExpandingLocal = curLocal;
                    job.ExpandingDist = curDist;
                    job.EdgeCursor = plainStart[region.Nodes[curLocal]];
                }
                int u = region.Nodes[job.ExpandingLocal];
                int end = plainStart[u + 1];
                while (job.EdgeCursor < end) {
                    if (budget.Scans <= 0) return false;
                    int e = job.EdgeCursor++;
                    budget.Scans--;
                    statsFieldEdgeScans++;
                    int v = plainTo[e];
                    if (nodeReg[v] != job.RegionId) continue;
                    int vLocal = nodeLocal[v];
                    int nd = job.ExpandingDist + plainCost[e];
                    if (nd < job.DistMs[vLocal]) {
                        job.DistMs[vLocal] = nd;
                        job.Heap.Push(vLocal, nd, region.TileKeys[vLocal], nd);
                    }
                }
                job.ExpandingLocal = -1;
            }
            job.Done = true;
            fieldJobs.Remove(job.Key);
            if (region.Revision == job.RegionRevision) PublishField(job.Key, region, job.DistMs);
            return true;
        }

        /* --------------------------------------------- Coarse Sparse A* */

        int CoarseHeuristicMs(int node, int goalNode) {
            double dx = Topology.NodeTx[node] - Topology.NodeTx[goalNode];
            double dy = Topology.NodeTy[node] - Topology.NodeTy[goalNode];
            return (int)Math.Floor(Math.Sqrt(dx * dx + dy * dy) * 500.0);
        }

        public CoarseJobStatus StartCoarseSearch(
            int startNode,
            int goalNode,
            StationRouteNeeds needs,
            int excludedServer,
            int priorityTier,
            int tick,
            out StationCoarseItinerary readyItinerary,
            out int jobId) {
            readyItinerary = null;
            jobId = -1;
            if ((uint)startNode >= (uint)Topology.Graph.NodeCount || (uint)goalNode >= (uint)Topology.Graph.NodeCount || currentSnapshot == null) {
                return CoarseJobStatus.Failed;
            }
            byte nb = NeedsBitsOf(needs);
            string cacheKey = currentSnapshot.TopologyRevision + "|" + currentSnapshot.Id + "|" + startNode + "|" + goalNode + "|" + nb + "|" + excludedServer;
            statsCoarseQueries++;

            if (coarseResultCache.TryGetValue(cacheKey, out var cached)) {
                statsCoarseCacheHits++;
                readyItinerary = cached;
                return cached != null ? CoarseJobStatus.Ready : CoarseJobStatus.Failed;
            }
            if (coarseJobByCacheKey.TryGetValue(cacheKey, out int existingId) && coarseJobs.TryGetValue(existingId, out var existing)) {
                if (priorityTier < existing.PriorityTier) existing.PriorityTier = priorityTier;
                if (tick < existing.EnqueuedTick) existing.EnqueuedTick = tick;
                jobId = existingId;
                readyItinerary = existing.Result;
                return existing.Status;
            }

            int id = nextCoarseId++;
            var heap = new DeterministicMinHeap(64);
            var bestCost = new Dictionary<int, int>(64);
            var parent = new Dictionary<int, CoarseParent>(64);
            bestCost[startNode] = 0;
            heap.Push(startNode, CoarseHeuristicMs(startNode, goalNode), Topology.NodeTileKey[startNode], 0);

            var job = new CoarseSearchJob {
                Id = id,
                CacheKey = cacheKey,
                TopologyRevision = Topology.TopologyRevision,
                Snapshot = currentSnapshot,
                StartNode = startNode,
                GoalNode = goalNode,
                StartKey = Topology.NodeTileKey[startNode],
                GoalKey = Topology.NodeTileKey[goalNode],
                Needs = needs,
                NeedsBits = nb,
                ExcludedServer = excludedServer,
                Heap = heap,
                BestCost = bestCost,
                Parent = parent,
                EnqueuedTick = tick,
                PriorityTier = priorityTier,
                Status = CoarseJobStatus.Running,
            };
            coarseJobs[id] = job;
            coarseJobByCacheKey[cacheKey] = id;
            jobId = id;
            return CoarseJobStatus.Running;
        }

        public CoarseSearchJob StepCoarseJobNow(int jobId, int maxPops = 2000, int maxScans = 8000) {
            if (!coarseJobs.TryGetValue(jobId, out var job) || job.Status != CoarseJobStatus.Running) return job;
            var budget = new WorkBudget { Pops = maxPops, Scans = maxScans };
            while (job.Status == CoarseJobStatus.Running && budget.Pops > 0 && budget.Scans > 0) {
                if (job.WaitingFieldKey != null && fieldJobs.TryGetValue(job.WaitingFieldKey, out var fj)) {
                    StepFieldJob(fj, ref budget);
                    if (!fj.Done) break;
                }
                int bPops = budget.Pops, bScans = budget.Scans;
                string prevWait = job.WaitingFieldKey;
                StepCoarseJob(job, ref budget);
                if (job.Status != CoarseJobStatus.Running) break;
                if (budget.Pops == bPops && budget.Scans == bScans && job.WaitingFieldKey == prevWait) break;
            }
            if (job.Status != CoarseJobStatus.Running) {
                coarseJobs.Remove(job.Id);
                if (coarseJobByCacheKey.TryGetValue(job.CacheKey, out int cid) && cid == job.Id) {
                    coarseJobByCacheKey.Remove(job.CacheKey);
                }
            }
            return job;
        }

        int ExplicitArcCostMs(StationSparseExplicitArc arc, StationRouteNeeds needs, StationSparseCostSnapshot snap, int excludedServer) {
            if (needs.StepFree && (arc.Kind == WalkEdgeKind.Stair || arc.Kind == WalkEdgeKind.Escalator)) return StationSparsePolicy.InfMs;
            if (excludedServer >= 0 && (arc.Server == excludedServer || arc.ToNodeServer == excludedServer)) return StationSparsePolicy.InfMs;

            int cost = arc.StaticCostMs;
            if (arc.Kind == WalkEdgeKind.Stair) cost += StairAvoidMs * Math.Max(1, arc.StairFlights);
            if (arc.Kind == WalkEdgeKind.Lift) {
                cost += LiftAvoidMs(needs);
                if (!string.IsNullOrEmpty(arc.LiftId) && snap.LiftWaitMs.TryGetValue(arc.LiftId, out int lw)) cost += lw;
            }
            if (arc.Server >= 0 && arc.Server < snap.ServerWaitMs.Length) cost += snap.ServerWaitMs[arc.Server];
            if (arc.ToNodeServer >= 0 && arc.ToNodeServer < Topology.Graph.Servers.Count) {
                var srv = Topology.Graph.Servers[arc.ToNodeServer];
                if (srv.Kind == "gate") cost += snap.GateWaitMs[arc.ToNodeServer * 3 + arc.GateDir + 1];
                else cost += snap.ServerWaitMs[arc.ToNodeServer];
            }
            return cost;
        }

        bool StepCoarseJob(CoarseSearchJob job, ref WorkBudget budget) {
            if (job.Status != CoarseJobStatus.Running) return true;
            if (job.TopologyRevision != Topology.TopologyRevision) {
                job.Status = CoarseJobStatus.Failed;
                job.FailReason = "stale-topology";
                return true;
            }
            if (job.WaitingFieldKey != null) {
                if (!fieldCache.ContainsKey(job.WaitingFieldKey)) {
                    if (fieldJobs.TryGetValue(job.WaitingFieldKey, out var fj)) {
                        if (job.PriorityTier < fj.PriorityTier) fj.PriorityTier = job.PriorityTier;
                        if (job.EnqueuedTick < fj.OldestTick) fj.OldestTick = job.EnqueuedTick;
                        return false;
                    }
                }
                job.WaitingFieldKey = null;
            }

            int goalRegionId = Topology.NodeRegion[job.GoalNode];
            bool canUseSuffix = coarseCacheSnapshotId == job.Snapshot.Id;
            string suffixPrefix = canUseSuffix ? (job.Snapshot.Id + "|" + job.GoalNode + "|" + job.NeedsBits + "|" + job.ExcludedServer + "|") : "";

            while (job.ExpandingPoint >= 0 || job.Heap.Count > 0) {
                if (job.ExpandingPoint < 0) {
                    if (budget.Pops <= 0) return false;
                    job.Heap.Pop(out int point, out int cost);
                    budget.Pops--;
                    statsCoarseExpansions++;
                    if (!job.BestCost.TryGetValue(point, out int best) || cost != best) continue;
                    if (point == job.GoalNode) {
                        var itin = ReconstructItinerary(job);
                        job.Status = CoarseJobStatus.Ready;
                        job.Result = itin;
                        if (coarseCacheSnapshotId == job.Snapshot.Id) coarseResultCache[job.CacheKey] = itin;
                        return true;
                    }
                    if (canUseSuffix && coarseSuffixCache.TryGetValue(suffixPrefix + point, out var suffix)) {
                        int total = cost + suffix.RemainingCostMs;
                        if (!job.BestCost.TryGetValue(job.GoalNode, out int prevGoal) || total < prevGoal) {
                            job.BestCost[job.GoalNode] = total;
                            job.Parent[job.GoalNode] = new CoarseParent { FromPoint = point, Suffix = suffix };
                            job.Heap.Push(job.GoalNode, total, job.GoalKey, total);
                        }
                        continue;
                    }
                    job.ExpandingPoint = point;
                    job.ExpandingCost = cost;
                    job.ExpandingRegionId = Topology.NodeRegion[point];
                    job.CursorStage = 0;
                    job.CursorIdx = 0;
                }

                int regId = job.ExpandingRegionId;
                if ((uint)regId >= (uint)Topology.Regions.Count) {
                    job.ExpandingPoint = -1;
                    continue;
                }
                var region = Topology.Regions[regId];
                int pointLocal = Topology.NodeLocalIdx[job.ExpandingPoint];

                if (job.CursorStage == 0) {
                    if (regId == goalRegionId) {
                        if (budget.Scans <= 0) return false;
                        budget.Scans--;
                        statsCoarseEdgeScans++;
                        var field = GetSingletonField(regId, job.GoalNode, job.PriorityTier, job.EnqueuedTick);
                        if (field == null) {
                            job.WaitingFieldKey = FieldKeyForNodes(region, new[] { job.GoalNode });
                            return false;
                        }
                        int d = field.DistMs[pointLocal];
                        if (d < StationSparsePolicy.InfMs) {
                            int nc = job.ExpandingCost + d;
                            if (!job.BestCost.TryGetValue(job.GoalNode, out int prev) || nc < prev) {
                                job.BestCost[job.GoalNode] = nc;
                                job.Parent[job.GoalNode] = new CoarseParent { FromPoint = job.ExpandingPoint, WalkMs = d };
                                job.Heap.Push(job.GoalNode, nc, job.GoalKey, nc);
                            }
                        }
                    }
                    job.CursorStage = 1;
                    job.CursorIdx = 0;
                }

                if (job.CursorStage == 1) {
                    var crossings = region.Crossings;
                    while (job.CursorIdx < crossings.Count) {
                        if (budget.Scans <= 0) return false;
                        var c = crossings[job.CursorIdx];
                        var field = GetSingletonField(regId, c.RepFromNode, job.PriorityTier, job.EnqueuedTick);
                        if (field == null) {
                            job.WaitingFieldKey = FieldKeyForNodes(region, new[] { c.RepFromNode });
                            return false;
                        }
                        budget.Scans--;
                        statsCoarseEdgeScans++;
                        job.CursorIdx++;
                        int walkMs = field.DistMs[pointLocal];
                        if (walkMs >= StationSparsePolicy.InfMs) continue;
                        int regCrowd = (uint)c.ToRegion < (uint)job.Snapshot.RegionCrowdMs.Length ? job.Snapshot.RegionCrowdMs[c.ToRegion] : 0;
                        int stepCost = c.RepCostMs + regCrowd;
                        int total = job.ExpandingCost + walkMs + stepCost;
                        if (!job.BestCost.TryGetValue(c.RepToNode, out int prev) || total < prev) {
                            job.BestCost[c.RepToNode] = total;
                            job.Parent[c.RepToNode] = new CoarseParent {
                                FromPoint = job.ExpandingPoint,
                                WalkMs = walkMs,
                                Step = new StationCoarseStep {
                                    IsCrossing = true,
                                    CrossingId = c.Id,
                                    FromKey = c.RepFromKey,
                                    ToKey = c.RepToKey,
                                    FromRegionKey = c.FromRegionKey,
                                    ToRegionKey = c.ToRegionKey,
                                    EdgeKind = WalkEdgeKind.Walk,
                                    CostMs = stepCost,
                                },
                            };
                            job.Heap.Push(c.RepToNode, total + CoarseHeuristicMs(c.RepToNode, job.GoalNode), c.RepToKey, total);
                        }
                    }
                    job.CursorStage = 2;
                    job.CursorIdx = 0;
                }

                if (job.CursorStage == 2) {
                    var arcs = region.ExplicitArcs;
                    while (job.CursorIdx < arcs.Count) {
                        if (budget.Scans <= 0) return false;
                        var arc = arcs[job.CursorIdx];
                        int arcCost = ExplicitArcCostMs(arc, job.Needs, job.Snapshot, job.ExcludedServer);
                        if (arcCost >= StationSparsePolicy.InfMs) {
                            budget.Scans--;
                            statsCoarseEdgeScans++;
                            job.CursorIdx++;
                            continue;
                        }
                        var field = GetSingletonField(regId, arc.FromNode, job.PriorityTier, job.EnqueuedTick);
                        if (field == null) {
                            job.WaitingFieldKey = FieldKeyForNodes(region, new[] { arc.FromNode });
                            return false;
                        }
                        budget.Scans--;
                        statsCoarseEdgeScans++;
                        job.CursorIdx++;
                        int walkMs = field.DistMs[pointLocal];
                        if (walkMs >= StationSparsePolicy.InfMs) continue;
                        int total = job.ExpandingCost + walkMs + arcCost;
                        if (!job.BestCost.TryGetValue(arc.ToNode, out int prev) || total < prev) {
                            job.BestCost[arc.ToNode] = total;
                            job.Parent[arc.ToNode] = new CoarseParent {
                                FromPoint = job.ExpandingPoint,
                                WalkMs = walkMs,
                                Step = new StationCoarseStep {
                                    IsCrossing = false,
                                    ArcId = arc.Id,
                                    FromKey = arc.FromKey,
                                    ToKey = arc.ToKey,
                                    FromRegionKey = region.RegionKey,
                                    ToRegionKey = Topology.Regions[arc.ToRegion].RegionKey,
                                    EdgeKind = arc.Kind,
                                    Server = arc.Server,
                                    ToNodeServer = arc.ToNodeServer,
                                    GateDir = arc.GateDir,
                                    LiftId = arc.LiftId,
                                    CostMs = arcCost,
                                },
                            };
                            job.Heap.Push(arc.ToNode, total + CoarseHeuristicMs(arc.ToNode, job.GoalNode), arc.ToKey, total);
                        }
                    }
                }

                job.ExpandingPoint = -1;
            }

            job.Status = CoarseJobStatus.Failed;
            job.FailReason = "sparse-exhausted";
            if (coarseCacheSnapshotId == job.Snapshot.Id) coarseResultCache[job.CacheKey] = null;
            return true;
        }

        StationCoarseItinerary ReconstructItinerary(CoarseSearchJob job) {
            var rev = new List<StationCoarseStep>();
            var walkPrefix = new List<int>();
            var chain = new List<(int Point, int GCost, int StepCountAfter)>();
            int cur = job.GoalNode;
            int goalTotal = job.BestCost.TryGetValue(job.GoalNode, out int gt) ? gt : StationSparsePolicy.InfMs;

            CachedSuffix trailing = null;
            if (job.Parent.TryGetValue(job.GoalNode, out var gp) && gp.Suffix != null) {
                trailing = gp.Suffix;
                cur = gp.FromPoint;
            }
            while (cur != job.StartNode && job.Parent.TryGetValue(cur, out var p)) {
                if (p.Step != null) {
                    chain.Add((cur, job.BestCost.TryGetValue(cur, out int cg) ? cg : 0, rev.Count));
                    rev.Add(p.Step);
                    walkPrefix.Add(p.WalkMs);
                }
                cur = p.FromPoint;
            }
            rev.Reverse();
            walkPrefix.Reverse();
            int prefixLen = rev.Count;
            if (trailing != null) {
                rev.AddRange(trailing.Steps);
                walkPrefix.AddRange(trailing.WalkPrefixMs);
            }

            var stepsArr = rev.ToArray();
            var walkArr = walkPrefix.ToArray();

            if (coarseCacheSnapshotId == job.Snapshot.Id && goalTotal < StationSparsePolicy.InfMs) {
                string suffixPrefix = job.Snapshot.Id + "|" + job.GoalNode + "|" + job.NeedsBits + "|" + job.ExcludedServer + "|";
                for (int i = 0; i < chain.Count; i++) {
                    var e = chain[i];
                    int startIdx = prefixLen - e.StepCountAfter;
                    int rem = goalTotal - e.GCost;
                    if (rem >= 0 && startIdx >= 0 && startIdx <= stepsArr.Length) {
                        int count = stepsArr.Length - startIdx;
                        var sSteps = new StationCoarseStep[count];
                        var sWalk = new int[count];
                        Array.Copy(stepsArr, startIdx, sSteps, 0, count);
                        Array.Copy(walkArr, startIdx, sWalk, 0, count);
                        coarseSuffixCache[suffixPrefix + e.Point] = new CachedSuffix {
                            Steps = sSteps,
                            WalkPrefixMs = sWalk,
                            RemainingCostMs = rem,
                        };
                    }
                }
            }

            int nextGateServer = -1, nextGateDir = 0, nextGateDistMs = StationSparsePolicy.InfMs;
            int nextServiceServer = -1;
            string nextServiceKind = "";
            int accumMs = 0;
            var servers = Topology.Graph.Servers;
            for (int i = 0; i < stepsArr.Length; i++) {
                var st = stepsArr[i];
                accumMs += walkArr[i];
                if (!st.IsCrossing) {
                    if (nextGateServer < 0 && st.ToNodeServer >= 0 && st.ToNodeServer < servers.Count && servers[st.ToNodeServer].Kind == "gate") {
                        nextGateServer = st.ToNodeServer;
                        nextGateDir = st.GateDir;
                        nextGateDistMs = accumMs;
                    }
                    if (nextServiceServer < 0) {
                        if (st.Server >= 0 && st.Server < servers.Count) {
                            nextServiceServer = st.Server;
                            nextServiceKind = servers[st.Server].Kind;
                        } else if (st.ToNodeServer >= 0 && st.ToNodeServer < servers.Count) {
                            nextServiceServer = st.ToNodeServer;
                            nextServiceKind = servers[st.ToNodeServer].Kind;
                        }
                    }
                }
                accumMs += st.CostMs;
            }

            return new StationCoarseItinerary {
                TopologyRevision = job.TopologyRevision,
                CostSnapshotId = job.Snapshot.Id,
                StartKey = job.StartKey,
                GoalKey = job.GoalKey,
                NeedsBits = job.NeedsBits,
                Steps = stepsArr,
                TotalCostMs = goalTotal,
                NextGateServer = nextGateServer,
                NextGateDir = nextGateDir,
                NextGateDistMs = nextGateDistMs,
                NextServiceServer = nextServiceServer,
                NextServiceKind = nextServiceKind,
            };
        }

        /* ---------------------------------------- Rolling 16-Step Walker */

        public int ChooseCrossingArrival(StationSparseCrossing crossing, int departureNode, int selfNode) {
            int bestTo = -1;
            int bestScore = StationSparsePolicy.InfMs;
            long bestKey = long.MaxValue;
            for (int i = 0; i < crossing.FromNodes.Length; i++) {
                if (crossing.FromNodes[i] != departureNode) continue;
                int to = crossing.ToNodes[i];
                int occ = Options.UseDensity ? 500 * Occupancy.OtherBodiesOn(to, selfNode) : 0;
                int score = crossing.CostMs[i] + occ;
                long key = Topology.NodeTileKey[to];
                if (score < bestScore || (score == bestScore && key < bestKey)) {
                    bestScore = score;
                    bestKey = key;
                    bestTo = to;
                }
            }
            return bestTo;
        }

        public enum RefillResult { Ok = 0, Pending = 1, Repair = 2 }

        /// <summary>
        /// Refill a Unity walker's <c>path</c> array (where <c>path[pathIndex]</c> is the current tile
        /// and <c>path[pathIndex + 1]</c> is the next tile) up to <c>Horizon</c> edges.
        /// </summary>
        public RefillResult RefillWalker(
            int agentId,
            ref int[] path,
            ref int pathIndex,
            StationSparseWalkerState walker,
            int currentTick,
            int selfNode,
            int priorityTier) {
            var itin = walker.Itinerary;
            if (itin == null || itin.TopologyRevision != Topology.TopologyRevision) return RefillResult.Repair;

            int remainingEdges = path != null && path.Length > 0 ? Math.Max(0, path.Length - 1 - pathIndex) : 0;
            if (remainingEdges > Options.RefillThreshold || walker.SegmentEndsAtGoal || walker.SegmentEndsAtService) {
                return RefillResult.Ok;
            }

            int startNode = (path != null && path.Length > 0 && pathIndex < path.Length) ? path[path.Length - 1] : selfNode;
            if ((uint)startNode >= (uint)Topology.Graph.NodeCount) return RefillResult.Repair;

            if (startNode == walker.GoalNode && walker.StepIdx >= itin.Steps.Length) {
                if (path == null || path.Length == 0) { path = new[] { startNode }; pathIndex = 0; }
                walker.SegmentEndsAtGoal = true;
                return RefillResult.Ok;
            }

            var suffix = new List<int>(Options.Horizon);
            int at = startNode;
            int heading = walker.Heading;
            if (path != null && path.Length >= 2) {
                int p0 = path[path.Length - 2], p1 = path[path.Length - 1];
                heading = StationSparsePolicy.OctantOf(Topology.NodeTx[p1] - Topology.NodeTx[p0], Topology.NodeTy[p1] - Topology.NodeTy[p0]);
            }

            var visited = new HashSet<int>();
            if (path != null) {
                for (int i = Math.Max(0, pathIndex); i < path.Length; i++) visited.Add(path[i]);
            }
            visited.Add(at);

            var plainStart = Topology.PlainAdjStart;
            var plainTo = Topology.PlainAdjTo;
            var plainCost = Topology.PlainAdjCostMs;
            var nodeReg = Topology.NodeRegion;
            var nodeLocal = Topology.NodeLocalIdx;
            var nodeTx = Topology.NodeTx;
            var nodeTy = Topology.NodeTy;
            var nodeTz2 = Topology.NodeTz2;
            var nodeKey = Topology.NodeTileKey;
            var servers = Topology.Graph.Servers;

            int stepIdx = walker.StepIdx;
            bool reachedGoal = false;
            bool reachedService = false;
            bool pendingField = false;

            while (remainingEdges + suffix.Count < Options.Horizon) {
                int regId = nodeReg[at];
                if (regId < 0) return suffix.Count > 0 ? RefillResult.Ok : RefillResult.Repair;

                var step = stepIdx < itin.Steps.Length ? itin.Steps[stepIdx] : null;
                int[] targetNodes;
                bool atTarget = false;
                if (step == null) {
                    if (nodeReg[walker.GoalNode] != regId) {
                        if (suffix.Count > 0) break;
                        return RefillResult.Repair;
                    }
                    targetNodes = new[] { walker.GoalNode };
                    atTarget = at == walker.GoalNode;
                } else if (step.IsCrossing) {
                    var crossing = Topology.Crossings[step.CrossingId];
                    if (crossing.FromRegion != regId) {
                        if (suffix.Count > 0) break;
                        return RefillResult.Repair;
                    }
                    targetNodes = crossing.UniqueFromNodes;
                    for (int k = 0; k < targetNodes.Length; k++) if (targetNodes[k] == at) { atTarget = true; break; }
                } else {
                    var arc = Topology.ExplicitArcs[step.ArcId];
                    if (arc.FromRegion != regId) {
                        if (suffix.Count > 0) break;
                        return RefillResult.Repair;
                    }
                    targetNodes = new[] { arc.FromNode };
                    atTarget = at == arc.FromNode;
                }

                if (atTarget) {
                    if (step == null) {
                        reachedGoal = true;
                        break;
                    }
                    if (step.IsCrossing) {
                        var crossing = Topology.Crossings[step.CrossingId];
                        int arrival = ChooseCrossingArrival(crossing, at, selfNode);
                        if (arrival < 0) {
                            if (suffix.Count > 0) break;
                            return RefillResult.Repair;
                        }
                        heading = StationSparsePolicy.OctantOf(nodeTx[arrival] - nodeTx[at], nodeTy[arrival] - nodeTy[at]);
                        suffix.Add(arrival);
                        visited.Add(arrival);
                        at = arrival;
                        stepIdx++;
                        continue;
                    } else {
                        var arc = Topology.ExplicitArcs[step.ArcId];
                        if (arc.Kind == WalkEdgeKind.Lift && !string.IsNullOrEmpty(arc.LiftId)) {
                            // Lift transition: stop walking at board landing; EndSegment hands off to LiftConnector.
                            walker.PendingLiftId = arc.LiftId;
                            walker.PendingLiftBoardNode = arc.FromNode;
                            walker.PendingLiftDestNode = arc.ToNode;
                            stepIdx++;
                            reachedService = true;
                            break;
                        }
                        bool isRide = arc.Kind == WalkEdgeKind.Escalator || arc.Kind == WalkEdgeKind.Walkway || arc.Kind == WalkEdgeKind.Stair;
                        bool isGateEntry = arc.ToNodeServer >= 0 && arc.ToNodeServer < servers.Count && servers[arc.ToNodeServer].Kind == "gate";
                        suffix.Add(arc.ToNode);
                        visited.Add(arc.ToNode);
                        heading = StationSparsePolicy.OctantOf(nodeTx[arc.ToNode] - nodeTx[at], nodeTy[arc.ToNode] - nodeTy[at]);
                        at = arc.ToNode;
                        stepIdx++;
                        if (isRide) {
                            reachedService = true;
                            break;
                        }
                        if (isGateEntry) {
                            if (stepIdx < itin.Steps.Length && !itin.Steps[stepIdx].IsCrossing) {
                                var exitArc = Topology.ExplicitArcs[itin.Steps[stepIdx].ArcId];
                                if (exitArc.FromNode == at) {
                                    suffix.Add(exitArc.ToNode);
                                    visited.Add(exitArc.ToNode);
                                    at = exitArc.ToNode;
                                    stepIdx++;
                                }
                            }
                            reachedService = true;
                            break;
                        }
                        continue;
                    }
                }

                var field = targetNodes.Length == 1
                    ? GetSingletonField(regId, targetNodes[0], priorityTier, currentTick)
                    : GetField(regId, targetNodes, priorityTier, currentTick);
                if (field == null) {
                    pendingField = true;
                    break;
                }
                int atDist = field.DistMs[nodeLocal[at]];
                if (atDist >= StationSparsePolicy.InfMs) {
                    if (suffix.Count > 0) break;
                    return RefillResult.Repair;
                }

                int bestNode = -1, bestScore = StationSparsePolicy.InfMs;
                long bestKey = long.MaxValue;
                int fallbackNode = -1, fallbackDist = StationSparsePolicy.InfMs;
                long fallbackKey = long.MaxValue;
                int ax = nodeTx[at], ay = nodeTy[at];

                for (int e = plainStart[at]; e < plainStart[at + 1]; e++) {
                    statsLocalNeighbourScans++;
                    int nb = plainTo[e];
                    if (nodeReg[nb] != regId || visited.Contains(nb)) continue;
                    int nbDist = field.DistMs[nodeLocal[nb]];
                    if (nbDist >= atDist) continue;
                    long nbKey = nodeKey[nb];
                    if (nbDist < fallbackDist || (nbDist == fallbackDist && nbKey < fallbackKey)) {
                        fallbackDist = nbDist;
                        fallbackKey = nbKey;
                        fallbackNode = nb;
                    }
                    int direct = Occupancy.OtherBodiesOn(nb, selfNode);
                    int adjSum = 0, adjCnt = 0;
                    if (Options.UseDensity) {
                        for (int ne = plainStart[nb]; ne < plainStart[nb + 1]; ne++) {
                            adjSum += Occupancy.OtherBodiesOn(plainTo[ne], selfNode);
                            adjCnt++;
                        }
                    }
                    int otherClaims = Options.UseClaims ? Claims.CountOtherAgentsOn(nb, agentId) : 0;
                    int moveOct = StationSparsePolicy.OctantOf(nodeTx[nb] - ax, nodeTy[nb] - ay);
                    int sc = StationSparsePolicy.ScoreTileMs(
                        plainCost[e], nbDist, direct, adjSum, adjCnt, otherClaims, heading, moveOct,
                        Topology.Seed, agentId, walker.SegmentSequence, nodeTx[nb], nodeTy[nb], nodeTz2[nb],
                        Options.UseDensity, Options.UseBias, Options.UseClaims);
                    if (sc < bestScore || (sc == bestScore && nbKey < bestKey)) {
                        bestScore = sc;
                        bestKey = nbKey;
                        bestNode = nb;
                    }
                }

                int chosen = bestNode >= 0 ? bestNode : fallbackNode;
                if (chosen < 0) {
                    if (suffix.Count > 0) break;
                    return RefillResult.Repair;
                }
                heading = StationSparsePolicy.OctantOf(nodeTx[chosen] - ax, nodeTy[chosen] - ay);
                suffix.Add(chosen);
                visited.Add(chosen);
                at = chosen;
            }

            if (suffix.Count > 0) {
                int keepCount = (path != null && path.Length > 0 && pathIndex < path.Length) ? (path.Length - pathIndex) : 0;
                int prefixLen = keepCount > 0 ? keepCount : 1;
                var nextPath = new int[prefixLen + suffix.Count];
                if (keepCount > 0) {
                    Array.Copy(path, pathIndex, nextPath, 0, keepCount);
                } else {
                    nextPath[0] = startNode;
                }
                for (int i = 0; i < suffix.Count; i++) nextPath[prefixLen + i] = suffix[i];
                path = nextPath;
                pathIndex = 0;
                walker.StepIdx = stepIdx;
                walker.Heading = heading;
                walker.SegmentSequence++;
                walker.SegmentEndsAtGoal = reachedGoal;
                walker.SegmentEndsAtService = reachedService;
                statsLocalRefills++;
                RefreshClaims(agentId, path, pathIndex, currentTick);
                return RefillResult.Ok;
            }

            if (reachedGoal) {
                walker.StepIdx = stepIdx;
                walker.SegmentEndsAtGoal = true;
                return RefillResult.Ok;
            }
            if (reachedService) {
                walker.StepIdx = stepIdx;
                walker.SegmentEndsAtService = true;
                return RefillResult.Ok;
            }
            return pendingField ? RefillResult.Pending : RefillResult.Ok;
        }

        public void RefreshClaims(int agentId, int[] path, int pathIndex, int currentTick) {
            if (!Options.UseClaims || path == null) return;
            int n0 = pathIndex + 1 < path.Length ? path[pathIndex + 1] : -1;
            int n1 = pathIndex + 2 < path.Length ? path[pathIndex + 2] : -1;
            Claims.Refresh(agentId, n0, n1, currentTick, StationSparsePolicy.ClaimTtlTicks);
        }

        /// <summary>
        /// Trim the uncommitted walking tail past a 2-step committed prefix when live crowding
        /// or claims appear directly ahead (§2.3 / §2.4).
        /// </summary>
        public void MaybeTrimCrowdedTail(int agentId, ref int[] path, ref int pathIndex, StationSparseWalkerState walker, int selfNode) {
            if (walker == null || walker.Itinerary == null || path == null) return;
            int remainingEdges = Math.Max(0, path.Length - 1 - pathIndex);
            if (remainingEdges <= Options.RefillThreshold) return;
            int c1 = pathIndex + 2 < path.Length ? path[pathIndex + 2] : -1;
            int c2 = pathIndex + 3 < path.Length ? path[pathIndex + 3] : -1;
            bool crowded =
                (c1 >= 0 && (Occupancy.OtherBodiesOn(c1, selfNode) > 0 || (Options.UseClaims && Claims.CountOtherAgentsOn(c1, agentId) > 0))) ||
                (c2 >= 0 && (Occupancy.OtherBodiesOn(c2, selfNode) > 0 || (Options.UseClaims && Claims.CountOtherAgentsOn(c2, agentId) > 0)));
            if (!crowded) return;
            int keepEnd = Math.Min(path.Length, pathIndex + 3); // current + 2 committed edges
            if (keepEnd >= path.Length) return;
            // Never trim mid-gate or mid-ride inside the 2-step committed prefix.
            var g = Topology.Graph;
            for (int k = pathIndex; k < keepEnd; k++) {
                if (g.ServerForNode.ContainsKey(path[k])) return;
                if (k + 1 < keepEnd && Math.Abs(g.NodeZ[path[k]] - g.NodeZ[path[k + 1]]) > 1e-6) return;
            }
            int tailAfter = path[keepEnd - 1];
            int tailReg = (uint)tailAfter < (uint)Topology.NodeRegion.Length ? Topology.NodeRegion[tailAfter] : -1;
            if (tailReg < 0) return;
            long tailRegKey = Topology.Regions[tailReg].RegionKey;
            while (walker.StepIdx > 0) {
                var st = walker.StepIdx < walker.Itinerary.Steps.Length ? walker.Itinerary.Steps[walker.StepIdx] : null;
                if (st != null && st.FromRegionKey == tailRegKey) break;
                if (st == null && Topology.NodeRegion[walker.GoalNode] == tailReg) break;
                walker.StepIdx--;
            }
            var trimmed = new int[keepEnd - pathIndex];
            Array.Copy(path, pathIndex, trimmed, 0, trimmed.Length);
            path = trimmed;
            pathIndex = 0;
            walker.SegmentEndsAtGoal = false;
            walker.SegmentEndsAtService = false;
            walker.PendingLiftId = null;
            walker.PendingLiftBoardNode = -1;
            walker.PendingLiftDestNode = -1;
        }

        public void BeginTick(
            int tick,
            Func<int, int, double> gateWaitFn,
            IReadOnlyDictionary<string, double> liftWaits) {
            elapsedTicks++;
            Claims.Expire(tick);
            CaptureCostSnapshot(gateWaitFn, liftWaits);
            ScheduleSampleRefresh();
        }

        public void RunMandatoryBudget(int tick, HashSet<int> referencedCoarseIds) {
            // Drop orphaned coarse jobs whose passengers left/switched.
            if (referencedCoarseIds != null && coarseJobs.Count > 0) {
                var drop = new List<int>();
                foreach (var kv in coarseJobs) {
                    if (!referencedCoarseIds.Contains(kv.Key)) drop.Add(kv.Key);
                }
                for (int i = 0; i < drop.Count; i++) {
                    var j = coarseJobs[drop[i]];
                    coarseJobs.Remove(drop[i]);
                    if (coarseJobByCacheKey.TryGetValue(j.CacheKey, out int cid) && cid == j.Id) {
                        coarseJobByCacheKey.Remove(j.CacheKey);
                    }
                }
            }

            var budget = new WorkBudget { Pops = Options.MandatoryPopBudget, Scans = Options.MandatoryScanBudget };
            bool progressed = true;
            while (progressed && budget.Pops > 0 && budget.Scans > 0) {
                progressed = false;
                if (fieldJobs.Count > 0) {
                    var list = new List<FieldJob>(fieldJobs.Values);
                    list.Sort((a, b) => {
                        int aa = tick - a.OldestTick >= StationSparsePolicy.AgePromoteTicks ? 0 : a.PriorityTier;
                        int ba = tick - b.OldestTick >= StationSparsePolicy.AgePromoteTicks ? 0 : b.PriorityTier;
                        int c = aa.CompareTo(ba);
                        if (c != 0) return c;
                        c = a.OldestTick.CompareTo(b.OldestTick);
                        if (c != 0) return c;
                        c = a.RegionKey.CompareTo(b.RegionKey);
                        return c != 0 ? c : string.CompareOrdinal(a.Key, b.Key);
                    });
                    for (int i = 0; i < list.Count && budget.Pops > 0 && budget.Scans > 0; i++) {
                        int bp = budget.Pops, bs = budget.Scans;
                        StepFieldJob(list[i], ref budget);
                        if (budget.Pops != bp || budget.Scans != bs) progressed = true;
                    }
                }
                if (coarseJobs.Count > 0 && budget.Pops > 0 && budget.Scans > 0) {
                    var list = new List<CoarseSearchJob>();
                    foreach (var kv in coarseJobs) if (kv.Value.Status == CoarseJobStatus.Running) list.Add(kv.Value);
                    list.Sort((a, b) => {
                        int aa = tick - a.EnqueuedTick >= StationSparsePolicy.AgePromoteTicks ? 0 : a.PriorityTier;
                        int ba = tick - b.EnqueuedTick >= StationSparsePolicy.AgePromoteTicks ? 0 : b.PriorityTier;
                        int c = aa.CompareTo(ba);
                        if (c != 0) return c;
                        c = a.EnqueuedTick.CompareTo(b.EnqueuedTick);
                        return c != 0 ? c : a.Id.CompareTo(b.Id);
                    });
                    for (int i = 0; i < list.Count && budget.Pops > 0 && budget.Scans > 0; i++) {
                        int bp = budget.Pops, bs = budget.Scans, bf = fieldJobs.Count;
                        StepCoarseJob(list[i], ref budget);
                        if (budget.Pops != bp || budget.Scans != bs || fieldJobs.Count != bf) progressed = true;
                    }
                }
            }
        }

        public CoarseSearchJob GetCoarseJob(int id) => coarseJobs.TryGetValue(id, out var j) ? j : null;

        public void PruneCompletedCoarseJobs() {
            if (coarseJobs.Count == 0) return;
            var done = new List<int>();
            foreach (var kv in coarseJobs) if (kv.Value.Status != CoarseJobStatus.Running) done.Add(kv.Key);
            for (int i = 0; i < done.Count; i++) {
                var j = coarseJobs[done[i]];
                coarseJobs.Remove(done[i]);
                if (coarseJobByCacheKey.TryGetValue(j.CacheKey, out int cid) && cid == j.Id) coarseJobByCacheKey.Remove(j.CacheKey);
            }
        }

        public void RecordFineFallback(long expansions) {
            statsFineFallbacks++;
            statsFineExpansions += expansions;
        }

        public void RecordBacklogAge(int age) {
            if (age > statsMaxBacklogAge) statsMaxBacklogAge = age;
        }

        void ScheduleSampleRefresh() {
            bool resumed = pendingPlayResume;
            pendingPlayResume = false;
            if (!Options.UseSamples) return;
            bool due = elapsedTicks - lastScheduledRefreshTick >= StationSparsePolicy.SampleRefreshSimSeconds;
            if (Topology.SamplesDirty.Count == 0 || (!resumed && !due)) return;
            var dirtyKeys = new List<long>(Topology.SamplesDirty.Keys);
            dirtyKeys.Sort();
            bool newly = false;
            for (int i = 0; i < dirtyKeys.Count; i++) {
                long sk = dirtyKeys[i];
                int rev = Topology.SamplesDirty[sk];
                if (sampleQueuedKeys.Contains(sk)) {
                    for (int q = 0; q < sampleRefreshQueue.Count; q++) {
                        if (sampleRefreshQueue[q].SectorKey == sk) {
                            sampleRefreshQueue[q] = (sk, rev);
                            break;
                        }
                    }
                    continue;
                }
                sampleQueuedKeys.Add(sk);
                sampleRefreshQueue.Add((sk, rev));
                newly = true;
            }
            if (newly) lastScheduledRefreshTick = elapsedTicks;
        }

        public void RunOptionalJobs() {
            if (sampleRefreshQueue.Count == 0) return;
            int scanBudget = Options.OptionalScanBudget;
            int popBudget = Options.OptionalPopBudget;
            while (sampleRefreshQueue.Count > 0 && scanBudget > 0 && popBudget > 0) {
                var item = sampleRefreshQueue[0];
                sampleRefreshQueue.RemoveAt(0);
                sampleQueuedKeys.Remove(item.SectorKey);
                if (!Topology.Sectors.TryGetValue(item.SectorKey, out var sec) || sec.Revision != item.RequestedRevision) continue;
                for (int i = 0; i < sec.RegionIds.Count; i++) {
                    var reg = Topology.Regions[sec.RegionIds[i]];
                    scanBudget -= reg.Nodes.Length;
                    popBudget--;
                    Topology.RefreshRegionSample(reg, reg.SampleTileKey);
                    statsSamplesRefreshed++;
                }
                if (Topology.SamplesDirty.TryGetValue(item.SectorKey, out int curRev) && curRev == item.RequestedRevision) {
                    Topology.SamplesDirty.Remove(item.SectorKey);
                }
            }
        }

        /// <summary>Read-only preview continuation for selected passenger without mutating simulation state.</summary>
        public void AppendPreviewContinuation(StationSparseWalkerState walker, List<(double X, double Y, double Z)> points) {
            if (walker == null || walker.SegmentEndsAtGoal || walker.Itinerary == null) return;
            if (walker.Itinerary.TopologyRevision != Topology.TopologyRevision) return;
            var g = Topology.Graph;
            var steps = walker.Itinerary.Steps;
            for (int i = walker.StepIdx; i < steps.Length; i++) {
                var st = steps[i];
                if (Topology.TileKeyToNode.TryGetValue(st.FromKey, out int fn)) {
                    points.Add((g.NodeX[fn], g.NodeY[fn], g.NodeZ[fn]));
                }
                if (Topology.TileKeyToNode.TryGetValue(st.ToKey, out int tn)) {
                    points.Add((g.NodeX[tn], g.NodeY[tn], g.NodeZ[tn]));
                }
            }
            if ((uint)walker.GoalNode < (uint)g.NodeCount) {
                points.Add((g.NodeX[walker.GoalNode], g.NodeY[walker.GoalNode], g.NodeZ[walker.GoalNode]));
            }
        }

        public StationSparseRoutingStats Stats() => new StationSparseRoutingStats {
            TopologyRevision = Topology.TopologyRevision,
            SectorCount = Topology.Sectors.Count,
            RegionCount = Topology.Regions.Count,
            CrossingCount = Topology.Crossings.Count,
            ExplicitArcCount = Topology.ExplicitArcs.Count,
            CoarseQueries = statsCoarseQueries,
            CoarseCacheHits = statsCoarseCacheHits,
            CoarseExpansions = statsCoarseExpansions,
            CoarseEdgeScans = statsCoarseEdgeScans,
            FieldBuilds = statsFieldBuilds,
            FieldCacheHits = statsFieldCacheHits,
            FieldExpansions = statsFieldExpansions,
            FieldEdgeScans = statsFieldEdgeScans,
            FieldCacheEntries = fieldCache.Count,
            FieldCacheBytes = fieldCacheBytes,
            LocalRefills = statsLocalRefills,
            LocalNeighbourScans = statsLocalNeighbourScans,
            FineFallbacks = statsFineFallbacks,
            FineExpansions = statsFineExpansions,
            SectorsRebuilt = statsSectorsRebuilt,
            FieldsPreservedOnEdit = statsFieldsPreserved,
            SamplesRefreshed = statsSamplesRefreshed,
            PendingFieldJobs = fieldJobs.Count,
            PendingCoarseJobs = coarseJobs.Count,
            MaxBacklogAge = statsMaxBacklogAge,
            ActiveClaims = Claims.ActiveCount,
        };
    }
}
