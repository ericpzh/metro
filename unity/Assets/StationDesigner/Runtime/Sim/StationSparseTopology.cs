using System;
using System.Collections.Generic;

namespace Metro.Sim {
    public readonly struct StationSparseLiftLink {
        public readonly string Id;
        public readonly int FromNode;
        public readonly int ToNode;
        public readonly int CycleMs;

        public StationSparseLiftLink(string id, int fromNode, int toNode, int cycleMs) {
            Id = id ?? "";
            FromNode = fromNode;
            ToNode = toNode;
            CycleMs = cycleMs;
        }
    }

    public sealed class StationSparseCrossing {
        public int Id;
        public string StableKey = "";
        public int FromRegion;
        public int ToRegion;
        public long FromRegionKey;
        public long ToRegionKey;
        public int[] FromNodes = Array.Empty<int>();
        public int[] ToNodes = Array.Empty<int>();
        public int[] CostMs = Array.Empty<int>();
        public int[] UniqueFromNodes = Array.Empty<int>();
        public long[] UniqueFromKeys = Array.Empty<long>();
        public int RepFromNode;
        public int RepToNode;
        public long RepFromKey;
        public long RepToKey;
        public int RepCostMs;
        public int FromHalfWalkMs;
        public int ToHalfWalkMs;
        public int RegionWalkMs;
    }

    public sealed class StationSparseExplicitArc {
        public int Id;
        public int FromNode;
        public int ToNode;
        public long FromKey;
        public long ToKey;
        public int FromRegion;
        public int ToRegion;
        public WalkEdgeKind Kind;
        public int Server = -1;
        public int FromNodeServer = -1;
        public int ToNodeServer = -1;
        public int GateDir;
        public int StairFlights = 1;
        public string LiftId;
        public int StaticCostMs;
        public int FromHalfWalkMs;
        public int ToHalfWalkMs;
    }

    public sealed class StationSparseRegion {
        public int Id;
        public long RegionKey;
        public long SectorKey;
        public int Revision = 1;
        public int[] Nodes = Array.Empty<int>();
        public long[] TileKeys = Array.Empty<long>();
        public double CenterX;
        public double CenterY;
        public double WalkMsPerM = 1000.0 / 1.34;
        public readonly List<StationSparseCrossing> Crossings = new List<StationSparseCrossing>();
        public readonly List<StationSparseExplicitArc> ExplicitArcs = new List<StationSparseExplicitArc>();
        public readonly List<StationSparseCrossing> InCrossings = new List<StationSparseCrossing>();
        public readonly List<StationSparseExplicitArc> InExplicitArcs = new List<StationSparseExplicitArc>();
        public long SampleTileKey = -1;
        public int SampleNode = -1;
    }

    public sealed class StationSparseSector {
        public long SectorKey;
        public int Sx;
        public int Sy;
        public int Tz2;
        public int Revision = 1;
        public uint Signature;
        public readonly List<int> RegionIds = new List<int>();
    }

    public sealed class StationSparseTopologyDiff {
        public bool RoutingNeutral;
        public int TopologyRevision;
        public readonly List<long> DirtySectorKeys = new List<long>();
        public readonly HashSet<long> PreservedRegionKeys = new HashSet<long>();
        public readonly HashSet<long> DirtyRegionKeys = new HashSet<long>();
    }

    /// <summary>
    /// Static 16x16 sector/region decomposition, contiguous boundary crossings, explicit
    /// service/restricted arcs, concourse samples and per-sector topology diffing
    /// (design/crowd-routing-plan.md §1, §3, §4.1, §4.5).
    /// Supports O(|dirtySectors|) incremental updates from <see cref="StationWalkGraphDelta"/>.
    /// </summary>
    public sealed class StationSparseTopology {
        public StationWalkGraph Graph;
        public readonly int Seed;
        public int TopologyRevision;
        public int NodeCount;

        public int[] NodeTx;
        public int[] NodeTy;
        public int[] NodeTz2;
        public long[] NodeTileKey;
        public readonly Dictionary<long, int> TileKeyToNode;

        public int[][] PlainAdjTo;
        public int[][] PlainAdjCostMs;

        public int[] NodeRegion;
        public int[] NodeLocalIdx;

        public readonly Dictionary<long, StationSparseSector> Sectors = new Dictionary<long, StationSparseSector>();
        public readonly List<StationSparseRegion> Regions = new List<StationSparseRegion>();
        public readonly Dictionary<long, StationSparseRegion> RegionByKey = new Dictionary<long, StationSparseRegion>();
        public readonly List<StationSparseCrossing> Crossings = new List<StationSparseCrossing>();
        public readonly List<StationSparseExplicitArc> ExplicitArcs = new List<StationSparseExplicitArc>();
        public bool HasLifts;
        public readonly Dictionary<long, int> SamplesDirty = new Dictionary<long, int>();

        // Retained internal state for O(|dirtySectors|) incremental updates:
        int nodeCapacity;
        long[] nodeSector;
        int[] srvAtNode;
        int[] visitedStamp;
        int curVisitStamp;
        int liftArcCount;

        struct ServerSnapshot {
            public int Node;
            public long TileKey;
            public int Tx, Ty, Tz2;
            public int KindCode;
            public int GateMode;
            public int GateRotation;
        }

        struct LiftLinkSnapshot : IEquatable<LiftLinkSnapshot> {
            public long FromKey, ToKey;
            public int FromTx, FromTy, FromTz2;
            public int ToTx, ToTy, ToTz2;
            public string Id;
            public int CycleMs;

            public bool Equals(LiftLinkSnapshot other) =>
                FromKey == other.FromKey && ToKey == other.ToKey &&
                CycleMs == other.CycleMs && string.Equals(Id, other.Id, StringComparison.Ordinal);

            public override bool Equals(object obj) => obj is LiftLinkSnapshot other && Equals(other);

            public override int GetHashCode() {
                unchecked {
                    int h = FromKey.GetHashCode();
                    h = (h * 397) ^ ToKey.GetHashCode();
                    h = (h * 397) ^ CycleMs;
                    h = (h * 397) ^ (Id != null ? StringComparer.Ordinal.GetHashCode(Id) : 0);
                    return h;
                }
            }
        }

        readonly List<ServerSnapshot> prevServers = new List<ServerSnapshot>();
        readonly Dictionary<long, ServerSnapshot> prevServerByTile = new Dictionary<long, ServerSnapshot>();
        readonly List<LiftLinkSnapshot> prevLiftLinks = new List<LiftLinkSnapshot>();

        bool revAdjBuilt;
        int[] revAllStart;
        int[] revAllFrom;
        int[] revStepFreeStart;
        int[] revStepFreeFrom;
        readonly Dictionary<int, uint[]> reachCache = new Dictionary<int, uint[]>();

        StationSparseTopology(StationWalkGraph graph, int seed, int topologyRevision) {
            Graph = graph;
            Seed = seed;
            TopologyRevision = topologyRevision;
            int n = graph.NodeCount;
            NodeCount = n;
            int cap = n > 0 ? Math.Max(n, 256) + 1024 : 0;
            nodeCapacity = cap;
            NodeTx = new int[cap];
            NodeTy = new int[cap];
            NodeTz2 = new int[cap];
            NodeTileKey = new long[cap];
            TileKeyToNode = new Dictionary<long, int>(n);
            PlainAdjTo = new int[cap][];
            PlainAdjCostMs = new int[cap][];
            NodeRegion = new int[cap];
            NodeLocalIdx = new int[cap];
            nodeSector = new long[cap];
            srvAtNode = new int[cap];
            visitedStamp = new int[cap];
            for (int i = 0; i < cap; i++) {
                NodeTileKey[i] = -1;
                NodeRegion[i] = -1;
                NodeLocalIdx[i] = -1;
                srvAtNode[i] = -1;
                PlainAdjTo[i] = Array.Empty<int>();
                PlainAdjCostMs[i] = Array.Empty<int>();
            }
        }

        void EnsureNodeCapacity(int needed) {
            if (needed <= nodeCapacity) return;
            int oldCap = nodeCapacity;
            int nextCap = Math.Max(needed + 1024, oldCap + (oldCap >> 2) + 1024);
            Array.Resize(ref NodeTx, nextCap);
            Array.Resize(ref NodeTy, nextCap);
            Array.Resize(ref NodeTz2, nextCap);
            Array.Resize(ref NodeTileKey, nextCap);
            Array.Resize(ref PlainAdjTo, nextCap);
            Array.Resize(ref PlainAdjCostMs, nextCap);
            Array.Resize(ref NodeRegion, nextCap);
            Array.Resize(ref NodeLocalIdx, nextCap);
            Array.Resize(ref nodeSector, nextCap);
            Array.Resize(ref srvAtNode, nextCap);
            Array.Resize(ref visitedStamp, nextCap);
            for (int i = oldCap; i < nextCap; i++) {
                NodeTileKey[i] = -1;
                NodeRegion[i] = -1;
                NodeLocalIdx[i] = -1;
                srvAtNode[i] = -1;
                PlainAdjTo[i] = Array.Empty<int>();
                PlainAdjCostMs[i] = Array.Empty<int>();
            }
            nodeCapacity = nextCap;
        }

        int NextVisitMark() {
            if (++curVisitStamp == int.MaxValue) {
                curVisitStamp = 1;
                if (visitedStamp.Length > 0) Array.Clear(visitedStamp, 0, visitedStamp.Length);
            }
            return curVisitStamp;
        }

        public long RefreshRegionSample(StationSparseRegion region, long oldSampleKey) {
            bool IsClear(int node, int minDeg) {
                if ((uint)node >= (uint)NodeCount || Graph.ServerForNode.ContainsKey(node)) return false;
                return PlainAdjTo[node].Length >= minDeg;
            }

            if (oldSampleKey >= 0 && TileKeyToNode.TryGetValue(oldSampleKey, out int oldNode) &&
                NodeRegion[oldNode] == region.Id && IsClear(oldNode, 4)) {
                region.SampleTileKey = oldSampleKey;
                region.SampleNode = oldNode;
                return oldSampleKey;
            }

            int bestNode = -1;
            uint bestHash = uint.MaxValue;
            long bestKey = long.MaxValue;
            for (int pass = 0; pass < 2 && bestNode < 0; pass++) {
                int minDeg = pass == 0 ? 4 : 2;
                for (int i = 0; i < region.Nodes.Length; i++) {
                    int node = region.Nodes[i];
                    if (!IsClear(node, minDeg)) continue;
                    uint h = StationSparsePolicy.Hash32Tile(Seed, NodeTx[node], NodeTy[node], NodeTz2[node]);
                    long key = region.TileKeys[i];
                    if (h < bestHash || (h == bestHash && key < bestKey)) {
                        bestHash = h;
                        bestKey = key;
                        bestNode = node;
                    }
                }
            }
            region.SampleNode = bestNode;
            region.SampleTileKey = bestNode >= 0 ? bestKey : -1;
            return region.SampleTileKey;
        }

        void EnsureRevRegionAdj() {
            if (revAdjBuilt) return;
            revAdjBuilt = true;
            int rCount = Regions.Count;
            var allCounts = new int[rCount];
            var sfCounts = new int[rCount];
            for (int r = 0; r < rCount; r++) {
                var reg = Regions[r];
                for (int i = 0; i < reg.Crossings.Count; i++) {
                    int to = reg.Crossings[i].ToRegion;
                    if ((uint)to < (uint)rCount) {
                        allCounts[to]++;
                        sfCounts[to]++;
                    }
                }
                for (int i = 0; i < reg.ExplicitArcs.Count; i++) {
                    var arc = reg.ExplicitArcs[i];
                    int to = arc.ToRegion;
                    if ((uint)to < (uint)rCount) {
                        allCounts[to]++;
                        if (arc.Kind != WalkEdgeKind.Stair && arc.Kind != WalkEdgeKind.Escalator) {
                            sfCounts[to]++;
                        }
                    }
                }
            }
            var allStart = new int[rCount + 1];
            var sfStart = new int[rCount + 1];
            for (int r = 0; r < rCount; r++) {
                allStart[r + 1] = allStart[r] + allCounts[r];
                sfStart[r + 1] = sfStart[r] + sfCounts[r];
            }
            var allFrom = new int[allStart[rCount]];
            var sfFrom = new int[sfStart[rCount]];
            var allCur = new int[rCount];
            var sfCur = new int[rCount];
            Array.Copy(allStart, allCur, rCount);
            Array.Copy(sfStart, sfCur, rCount);
            for (int r = 0; r < rCount; r++) {
                var reg = Regions[r];
                for (int i = 0; i < reg.Crossings.Count; i++) {
                    int to = reg.Crossings[i].ToRegion;
                    if ((uint)to < (uint)rCount) {
                        allFrom[allCur[to]++] = r;
                        sfFrom[sfCur[to]++] = r;
                    }
                }
                for (int i = 0; i < reg.ExplicitArcs.Count; i++) {
                    var arc = reg.ExplicitArcs[i];
                    int to = arc.ToRegion;
                    if ((uint)to < (uint)rCount) {
                        allFrom[allCur[to]++] = r;
                        if (arc.Kind != WalkEdgeKind.Stair && arc.Kind != WalkEdgeKind.Escalator) {
                            sfFrom[sfCur[to]++] = r;
                        }
                    }
                }
            }
            revAllStart = allStart;
            revAllFrom = allFrom;
            revStepFreeStart = sfStart;
            revStepFreeFrom = sfFrom;
        }

        /// <summary>
        /// Exact static reachability between two walk-graph nodes under <paramref name="stepFree"/>.
        /// Equivalent to fine-graph reachability because every region is a connected component
        /// of bidirectional plain walk edges and every non-plain edge is an explicit arc.
        /// </summary>
        public bool CanReach(int fromNode, int toNode, bool stepFree) {
            if ((uint)fromNode >= (uint)NodeCount || (uint)toNode >= (uint)NodeCount) return false;
            int fromReg = NodeRegion[fromNode];
            int toReg = NodeRegion[toNode];
            if (fromReg < 0 || toReg < 0) return false;
            if (fromReg == toReg) return true;

            int cacheKey = toReg * 2 + (stepFree ? 1 : 0);
            if (!reachCache.TryGetValue(cacheKey, out var bits)) {
                EnsureRevRegionAdj();
                int rCount = Regions.Count;
                bits = new uint[(rCount + 31) >> 5];
                var start = stepFree ? revStepFreeStart : revAllStart;
                var from = stepFree ? revStepFreeFrom : revAllFrom;
                var queue = new int[rCount];
                int head = 0, tail = 0;
                bits[toReg >> 5] |= 1u << (toReg & 31);
                queue[tail++] = toReg;
                while (head < tail) {
                    int cur = queue[head++];
                    for (int e = start[cur]; e < start[cur + 1]; e++) {
                        int prev = from[e];
                        int w = prev >> 5;
                        uint m = 1u << (prev & 31);
                        if ((bits[w] & m) == 0) {
                            bits[w] |= m;
                            queue[tail++] = prev;
                        }
                    }
                }
                reachCache[cacheKey] = bits;
            }
            return (bits[fromReg >> 5] & (1u << (fromReg & 31))) != 0;
        }

        struct RawPlainEdge {
            public int FromNode, ToNode, ToRegion, CostMs, Dx, Dy;
            public long FromKey, ToKey;
        }

        struct RawExplicitEdge {
            public int FromNode, ToNode, ToRegion, Server, FromNodeServer, ToNodeServer, GateDir, StairFlights, CostMs;
            public long FromKey, ToKey;
            public WalkEdgeKind Kind;
            public string LiftId;
        }

        struct SigEdge : IComparable<SigEdge> {
            public long ToKey;
            public int Kind, CostMs, Plain, SrvKind;
            public int CompareTo(SigEdge other) {
                int c = ToKey.CompareTo(other.ToKey);
                if (c != 0) return c;
                c = Kind.CompareTo(other.Kind);
                if (c != 0) return c;
                c = CostMs.CompareTo(other.CostMs);
                if (c != 0) return c;
                c = SrvKind.CompareTo(other.SrvKind);
                return c != 0 ? c : Plain.CompareTo(other.Plain);
            }
        }

        sealed class RegionBuildScratch {
            public readonly List<RawPlainEdge> RawPlain = new List<RawPlainEdge>();
            public readonly List<RawExplicitEdge> RawExplicit = new List<RawExplicitEdge>();
            public readonly Dictionary<(int ToRegion, int Seam), List<RawPlainEdge>> CardinalGroups =
                new Dictionary<(int ToRegion, int Seam), List<RawPlainEdge>>();
            public readonly List<RawPlainEdge> DiagEdges = new List<RawPlainEdge>();
            public readonly Dictionary<(int FromNode, int ToRegion), List<RawPlainEdge>> OwnerByFromTo =
                new Dictionary<(int FromNode, int ToRegion), List<RawPlainEdge>>();
            public readonly List<(int ToRegion, List<RawPlainEdge> Cardinal, List<RawPlainEdge> All)> PendingRuns =
                new List<(int ToRegion, List<RawPlainEdge> Cardinal, List<RawPlainEdge> All)>();
        }

        static bool HasReversePlainWalk(StationWalkGraph graph, int u, int v, int[][] adjToRaw, int[][] adjKindRaw, int[][] adjSrvRaw) {
            if (Math.Abs(graph.NodeZ[u] - graph.NodeZ[v]) > 1e-9) return false;
            var to = adjToRaw != null ? adjToRaw[v] : graph.AdjTo[v];
            var kinds = adjKindRaw != null ? adjKindRaw[v] : graph.AdjKind[v];
            var srvs = adjSrvRaw != null ? adjSrvRaw[v] : graph.AdjServer[v];
            for (int e = 0; e < to.Length; e++) {
                if (to[e] == u && kinds[e] == (int)WalkEdgeKind.Walk && srvs[e] < 0) return true;
            }
            return false;
        }

        static bool CheckGatePassage(StationWalkGraph graph, int[] srvAtNode, int nodeCount, int from, int to, out int direction) {
            direction = 0;
            int toSrv = (uint)to < (uint)nodeCount ? srvAtNode[to] : -1;
            if (toSrv >= 0) {
                var srv = graph.Servers[toSrv];
                if (srv.Kind == "gate") {
                    direction = StationWalkGraphBuilder.GateApproach(graph, from, to);
                }
            }
            return true;
        }

        static int ServerKindCode(string kind) {
            switch (kind) {
                case "gate": return 1;
                case "escalator": return 2;
                case "stair": return 3;
                case "lift": return 4;
                case "walkway": return 5;
                case "door": return 6;
                case "stop": return 7;
                default: return 0;
            }
        }

        static void ComputeNodeTileCoords(StationWalkGraph g, int u, out int tx, out int ty, out int tz2, out long tileKey, out long sectorKey) {
            tx = (int)Math.Floor(g.NodeX[u]);
            ty = (int)Math.Floor(g.NodeY[u]);
            tz2 = (int)Math.Floor((g.NodeZ[u] - 1.0) * 2.0 + 0.5);
            tileKey = StationSparsePolicy.PackTileKey(tx, ty, tz2);
            sectorKey = StationSparsePolicy.SectorKeyOfTile(tx, ty, tz2);
        }

        bool[] ComputePlainAdjForNode(
            int u,
            int[][] adjToRaw,
            double[][] adjCostRaw,
            int[][] adjKindRaw,
            int[][] adjSrvRaw) {
            int n = NodeCount;
            var to = adjToRaw != null ? adjToRaw[u] : Graph.AdjTo[u];
            var costs = adjCostRaw != null ? adjCostRaw[u] : Graph.AdjCost[u];
            var kinds = adjKindRaw != null ? adjKindRaw[u] : Graph.AdjKind[u];
            var srvs = adjSrvRaw != null ? adjSrvRaw[u] : Graph.AdjServer[u];
            var flags = to.Length == 0 ? Array.Empty<bool>() : new bool[to.Length];
            if (srvAtNode[u] >= 0 || to.Length == 0) {
                PlainAdjTo[u] = Array.Empty<int>();
                PlainAdjCostMs[u] = Array.Empty<int>();
                return flags;
            }
            double uz = Graph.NodeZ[u];
            int count = 0;
            for (int e = 0; e < to.Length; e++) {
                if (kinds[e] != (int)WalkEdgeKind.Walk || srvs[e] >= 0) continue;
                int v = to[e];
                if ((uint)v >= (uint)n || srvAtNode[v] >= 0) continue;
                if (Math.Abs(Graph.NodeZ[v] - uz) > 1e-9) continue;
                if (HasReversePlainWalk(Graph, u, v, adjToRaw, adjKindRaw, adjSrvRaw)) {
                    flags[e] = true;
                    count++;
                }
            }
            if (count == 0) {
                PlainAdjTo[u] = Array.Empty<int>();
                PlainAdjCostMs[u] = Array.Empty<int>();
                return flags;
            }
            var pTo = new int[count];
            var pCost = new int[count];
            int k = 0;
            for (int e = 0; e < to.Length; e++) {
                if (!flags[e]) continue;
                pTo[k] = to[e];
                pCost[k] = StationSparsePolicy.ToMs(costs[e]);
                k++;
            }
            PlainAdjTo[u] = pTo;
            PlainAdjCostMs[u] = pCost;
            return flags;
        }

        uint ComputeSectorSignature(
            int sx,
            int sy,
            int tz2,
            List<int> sortedNodes,
            bool[][] isPlainArray,
            Dictionary<int, bool[]> isPlainMap,
            int[][] adjToRaw,
            double[][] adjCostRaw,
            int[][] adjKindRaw,
            int[][] adjSrvRaw,
            Dictionary<int, List<StationSparseLiftLink>> liftsByFrom,
            List<SigEdge> sigEdges) {
            int n = NodeCount;
            uint sig = StationSparsePolicy.Hash32Init(0x5e4701);
            sig = StationSparsePolicy.Hash32Mix(sig, sx);
            sig = StationSparsePolicy.Hash32Mix(sig, sy);
            sig = StationSparsePolicy.Hash32Mix(sig, tz2);
            sig = StationSparsePolicy.Hash32Mix(sig, sortedNodes.Count);

            for (int i = 0; i < sortedNodes.Count; i++) {
                int u = sortedNodes[i];
                sig = StationSparsePolicy.Hash32Mix(sig, NodeTx[u]);
                sig = StationSparsePolicy.Hash32Mix(sig, NodeTy[u]);
                sig = StationSparsePolicy.Hash32Mix(sig, (int)Math.Floor(Graph.NodeSpeed[u] * 1000.0 + 0.5));
                sig = StationSparsePolicy.Hash32Mix(sig, Graph.NodeZone[u]);
                int gSrv = srvAtNode[u];
                sig = StationSparsePolicy.Hash32Mix(sig, gSrv >= 0 ? (Graph.Servers[gSrv].GateMode + 2) : 0);

                sigEdges.Clear();
                var to = adjToRaw != null ? adjToRaw[u] : Graph.AdjTo[u];
                var costs = adjCostRaw != null ? adjCostRaw[u] : Graph.AdjCost[u];
                var kinds = adjKindRaw != null ? adjKindRaw[u] : Graph.AdjKind[u];
                var srvs = adjSrvRaw != null ? adjSrvRaw[u] : Graph.AdjServer[u];
                bool[] flags = isPlainArray != null ? isPlainArray[u] : isPlainMap[u];
                for (int e = 0; e < to.Length; e++) {
                    int v = to[e];
                    if ((uint)v >= (uint)n) continue;
                    int sv = srvs[e];
                    int srvKind = sv >= 0 && sv < Graph.Servers.Count ? ServerKindCode(Graph.Servers[sv].Kind) : 0;
                    sigEdges.Add(new SigEdge {
                        ToKey = NodeTileKey[v],
                        Kind = kinds[e],
                        CostMs = StationSparsePolicy.ToMs(costs[e]),
                        Plain = flags[e] ? 1 : 0,
                        SrvKind = srvKind,
                    });
                }
                if (liftsByFrom != null && liftsByFrom.TryGetValue(u, out var uLifts)) {
                    for (int li = 0; li < uLifts.Count; li++) {
                        sigEdges.Add(new SigEdge {
                            ToKey = NodeTileKey[uLifts[li].ToNode],
                            Kind = (int)WalkEdgeKind.Lift,
                            CostMs = uLifts[li].CycleMs,
                            Plain = 0,
                            SrvKind = 4,
                        });
                    }
                }
                sigEdges.Sort();
                sig = StationSparsePolicy.Hash32Mix(sig, sigEdges.Count);
                for (int j = 0; j < sigEdges.Count; j++) {
                    var se = sigEdges[j];
                    sig = StationSparsePolicy.Hash32Mix(sig, (int)(se.ToKey & 0x7fffffffL));
                    sig = StationSparsePolicy.Hash32Mix(sig, (int)(se.ToKey >> 31));
                    sig = StationSparsePolicy.Hash32Mix(sig, (se.Kind << 8) | (se.SrvKind << 2) | se.Plain);
                    sig = StationSparsePolicy.Hash32Mix(sig, se.CostMs);
                }
            }
            return sig;
        }

        void BuildSectorRegions(
            long sk,
            StationSparseSector sector,
            List<int> sortedNodes,
            List<int> bfs,
            List<StationSparseRegion> createdRegions) {
            int mark = NextVisitMark();
            for (int i = 0; i < sortedNodes.Count; i++) {
                int start = sortedNodes[i];
                if (visitedStamp[start] == mark) continue;
                visitedStamp[start] = mark;
                bfs.Clear();
                bfs.Add(start);
                int head = 0;
                while (head < bfs.Count) {
                    int cur = bfs[head++];
                    var pTo = PlainAdjTo[cur];
                    for (int e = 0; e < pTo.Length; e++) {
                        int nb = pTo[e];
                        if (visitedStamp[nb] == mark || nodeSector[nb] != sk) continue;
                        visitedStamp[nb] = mark;
                        bfs.Add(nb);
                    }
                }
                bfs.Sort((a, b) => NodeTileKey[a].CompareTo(NodeTileKey[b]));
                var regNodes = bfs.ToArray();
                var regKeys = new long[regNodes.Length];
                int regId = Regions.Count;
                double sumX = 0.0, sumY = 0.0, sumSpeed = 0.0;
                for (int k = 0; k < regNodes.Length; k++) {
                    int u = regNodes[k];
                    regKeys[k] = NodeTileKey[u];
                    NodeRegion[u] = regId;
                    NodeLocalIdx[u] = k;
                    sumX += NodeTx[u];
                    sumY += NodeTy[u];
                    sumSpeed += Graph.NodeSpeed[u] > 0.0 ? Graph.NodeSpeed[u] : 1.0;
                }
                double invCount = regNodes.Length > 0 ? 1.0 / regNodes.Length : 1.0;
                double avgSpeed = Math.Max(0.1, sumSpeed * invCount);
                var region = new StationSparseRegion {
                    Id = regId,
                    RegionKey = regKeys[0],
                    SectorKey = sk,
                    Revision = 1,
                    Nodes = regNodes,
                    TileKeys = regKeys,
                    CenterX = sumX * invCount,
                    CenterY = sumY * invCount,
                    WalkMsPerM = 1000.0 / (1.34 * avgSpeed),
                };
                Regions.Add(region);
                RegionByKey[region.RegionKey] = region;
                sector.RegionIds.Add(regId);
                createdRegions?.Add(region);
            }
        }

        void BuildRegionCrossingsAndArcs(
            StationSparseRegion region,
            bool[][] isPlainArray,
            Dictionary<int, bool[]> isPlainMap,
            int[][] adjToRaw,
            double[][] adjCostRaw,
            int[][] adjKindRaw,
            int[][] adjSrvRaw,
            Dictionary<int, List<StationSparseLiftLink>> liftsByFrom,
            RegionBuildScratch s) {
            int n = NodeCount;
            int rId = region.Id;
            s.RawPlain.Clear();
            s.RawExplicit.Clear();
            s.CardinalGroups.Clear();
            s.DiagEdges.Clear();
            s.OwnerByFromTo.Clear();
            s.PendingRuns.Clear();

            for (int i = 0; i < region.Nodes.Length; i++) {
                int u = region.Nodes[i];
                long uKey = region.TileKeys[i];
                int ux = NodeTx[u], uy = NodeTy[u];
                var to = adjToRaw != null ? adjToRaw[u] : Graph.AdjTo[u];
                var costs = adjCostRaw != null ? adjCostRaw[u] : Graph.AdjCost[u];
                var kinds = adjKindRaw != null ? adjKindRaw[u] : Graph.AdjKind[u];
                var srvs = adjSrvRaw != null ? adjSrvRaw[u] : Graph.AdjServer[u];
                bool[] flags = null;
                if (isPlainArray != null) flags = isPlainArray[u];
                else if (isPlainMap != null) isPlainMap.TryGetValue(u, out flags);
                bool uGate = srvAtNode[u] >= 0;
                double uz = Graph.NodeZ[u];

                for (int e = 0; e < to.Length; e++) {
                    int v = to[e];
                    if ((uint)v >= (uint)n) continue;
                    int vReg = NodeRegion[v];
                    if (vReg < 0) continue;
                    bool edgeIsPlain;
                    if (flags != null) {
                        edgeIsPlain = flags[e];
                    } else {
                        edgeIsPlain = !uGate &&
                            kinds[e] == (int)WalkEdgeKind.Walk &&
                            srvs[e] < 0 &&
                            srvAtNode[v] < 0 &&
                            Math.Abs(Graph.NodeZ[v] - uz) <= 1e-9 &&
                            HasReversePlainWalk(Graph, u, v, adjToRaw, adjKindRaw, adjSrvRaw);
                    }
                    if (edgeIsPlain) {
                        if (vReg != rId) {
                            s.RawPlain.Add(new RawPlainEdge {
                                FromNode = u, ToNode = v, FromKey = uKey, ToKey = NodeTileKey[v],
                                ToRegion = vReg, CostMs = StationSparsePolicy.ToMs(costs[e]),
                                Dx = NodeTx[v] - ux, Dy = NodeTy[v] - uy,
                            });
                        }
                    } else {
                        var kind = (WalkEdgeKind)kinds[e];
                        int gateDir = 0;
                        if (kind == WalkEdgeKind.Walk && !CheckGatePassage(Graph, srvAtNode, n, u, v, out gateDir)) continue;
                        int sv = srvs[e];
                        int flights = kind == WalkEdgeKind.Stair && sv >= 0 && sv < Graph.Servers.Count && Graph.Servers[sv].StairFlights > 1
                            ? Graph.Servers[sv].StairFlights : 1;
                        s.RawExplicit.Add(new RawExplicitEdge {
                            FromNode = u, ToNode = v, FromKey = uKey, ToKey = NodeTileKey[v],
                            ToRegion = vReg, Kind = kind, Server = sv,
                            FromNodeServer = srvAtNode[u], ToNodeServer = srvAtNode[v],
                            GateDir = gateDir, StairFlights = flights, LiftId = null,
                            CostMs = StationSparsePolicy.ToMs(costs[e]),
                        });
                    }
                }

                if (liftsByFrom != null && liftsByFrom.TryGetValue(u, out var uLifts)) {
                    for (int li = 0; li < uLifts.Count; li++) {
                        var link = uLifts[li];
                        int vReg = NodeRegion[link.ToNode];
                        if (vReg < 0) continue;
                        s.RawExplicit.Add(new RawExplicitEdge {
                            FromNode = u, ToNode = link.ToNode, FromKey = uKey, ToKey = NodeTileKey[link.ToNode],
                            ToRegion = vReg, Kind = WalkEdgeKind.Lift, Server = -1,
                            FromNodeServer = srvAtNode[u], ToNodeServer = srvAtNode[link.ToNode],
                            GateDir = 0, StairFlights = 1, LiftId = link.Id,
                            CostMs = link.CycleMs,
                        });
                    }
                }
            }

            // Group plain crossings by (toRegion, faceSeam) and split contiguous runs.
            for (int i = 0; i < s.RawPlain.Count; i++) {
                var pe = s.RawPlain[i];
                if (pe.Dx == 0 || pe.Dy == 0) {
                    int seam = pe.Dx > 0 ? 0 : pe.Dx < 0 ? 1 : pe.Dy > 0 ? 2 : 3;
                    var gk = (pe.ToRegion, seam);
                    if (!s.CardinalGroups.TryGetValue(gk, out var list)) {
                        list = new List<RawPlainEdge>();
                        s.CardinalGroups[gk] = list;
                    }
                    list.Add(pe);
                } else {
                    s.DiagEdges.Add(pe);
                }
            }

            var sortedGroups = new List<(int ToRegion, int Seam)>(s.CardinalGroups.Keys);
            sortedGroups.Sort((a, b) => {
                int c = Regions[a.ToRegion].RegionKey.CompareTo(Regions[b.ToRegion].RegionKey);
                return c != 0 ? c : a.Seam.CompareTo(b.Seam);
            });

            for (int gi = 0; gi < sortedGroups.Count; gi++) {
                var gk = sortedGroups[gi];
                var list = s.CardinalGroups[gk];
                bool alongY = gk.Seam == 0 || gk.Seam == 1;
                list.Sort((a, b) => {
                    int ca = alongY ? NodeTy[a.FromNode] : NodeTx[a.FromNode];
                    int cb = alongY ? NodeTy[b.FromNode] : NodeTx[b.FromNode];
                    int c = ca.CompareTo(cb);
                    if (c != 0) return c;
                    c = a.FromKey.CompareTo(b.FromKey);
                    return c != 0 ? c : a.ToKey.CompareTo(b.ToKey);
                });

                int runStart = 0;
                for (int i = 1; i <= list.Count; i++) {
                    bool split = i == list.Count || (alongY
                        ? NodeTy[list[i].FromNode] != NodeTy[list[i - 1].FromNode] + 1
                        : NodeTx[list[i].FromNode] != NodeTx[list[i - 1].FromNode] + 1);
                    if (!split) continue;
                    var slice = list.GetRange(runStart, i - runStart);
                    var all = new List<RawPlainEdge>(slice);
                    s.PendingRuns.Add((gk.ToRegion, slice, all));
                    for (int k = 0; k < slice.Count; k++) s.OwnerByFromTo[(slice[k].FromNode, gk.ToRegion)] = all;
                    runStart = i;
                }
            }

            s.DiagEdges.Sort((a, b) => {
                int c = Regions[a.ToRegion].RegionKey.CompareTo(Regions[b.ToRegion].RegionKey);
                if (c != 0) return c;
                c = a.FromKey.CompareTo(b.FromKey);
                return c != 0 ? c : a.ToKey.CompareTo(b.ToKey);
            });
            for (int i = 0; i < s.DiagEdges.Count; i++) {
                var de = s.DiagEdges[i];
                if (s.OwnerByFromTo.TryGetValue((de.FromNode, de.ToRegion), out var owner)) {
                    owner.Add(de);
                } else {
                    s.PendingRuns.Add((de.ToRegion, new List<RawPlainEdge> { de }, new List<RawPlainEdge> { de }));
                }
            }

            for (int ri = 0; ri < s.PendingRuns.Count; ri++) {
                var run = s.PendingRuns[ri];
                var rep = run.Cardinal[run.Cardinal.Count / 2];
                run.All.Sort((a, b) => {
                    int c = a.FromKey.CompareTo(b.FromKey);
                    return c != 0 ? c : a.ToKey.CompareTo(b.ToKey);
                });
                int m = run.All.Count;
                var fromNodes = new int[m];
                var toNodes = new int[m];
                var costMs = new int[m];
                var uniqNodes = new List<int>(m);
                var uniqKeys = new List<long>(m);
                int lastFrom = -1;
                for (int i = 0; i < m; i++) {
                    fromNodes[i] = run.All[i].FromNode;
                    toNodes[i] = run.All[i].ToNode;
                    costMs[i] = run.All[i].CostMs;
                    if (fromNodes[i] != lastFrom) {
                        lastFrom = fromNodes[i];
                        uniqNodes.Add(fromNodes[i]);
                        uniqKeys.Add(run.All[i].FromKey);
                    }
                }
                var toReg = Regions[run.ToRegion];
                double fdx = region.CenterX - NodeTx[rep.FromNode];
                double fdy = region.CenterY - NodeTy[rep.FromNode];
                double tdx = toReg.CenterX - NodeTx[rep.ToNode];
                double tdy = toReg.CenterY - NodeTy[rep.ToNode];
                int fromHalf = (int)Math.Floor(Math.Sqrt(fdx * fdx + fdy * fdy) * region.WalkMsPerM + 0.5);
                int toHalf = (int)Math.Floor(Math.Sqrt(tdx * tdx + tdy * tdy) * toReg.WalkMsPerM + 0.5);
                var crossing = new StationSparseCrossing {
                    Id = Crossings.Count,
                    StableKey = region.RegionKey + "|" + toReg.RegionKey + "|" + rep.FromKey + "|" + rep.ToKey,
                    FromRegion = rId,
                    ToRegion = run.ToRegion,
                    FromRegionKey = region.RegionKey,
                    ToRegionKey = toReg.RegionKey,
                    FromNodes = fromNodes,
                    ToNodes = toNodes,
                    CostMs = costMs,
                    UniqueFromNodes = uniqNodes.ToArray(),
                    UniqueFromKeys = uniqKeys.ToArray(),
                    RepFromNode = rep.FromNode,
                    RepToNode = rep.ToNode,
                    RepFromKey = rep.FromKey,
                    RepToKey = rep.ToKey,
                    RepCostMs = rep.CostMs,
                    FromHalfWalkMs = fromHalf,
                    ToHalfWalkMs = toHalf,
                    RegionWalkMs = fromHalf + rep.CostMs + toHalf,
                };
                Crossings.Add(crossing);
                region.Crossings.Add(crossing);
                toReg.InCrossings.Add(crossing);
            }

            s.RawExplicit.Sort((a, b) => {
                int c = a.FromKey.CompareTo(b.FromKey);
                if (c != 0) return c;
                c = a.ToKey.CompareTo(b.ToKey);
                if (c != 0) return c;
                c = ((int)a.Kind).CompareTo((int)b.Kind);
                if (c != 0) return c;
                c = a.Server.CompareTo(b.Server);
                return c != 0 ? c : string.CompareOrdinal(a.LiftId ?? "", b.LiftId ?? "");
            });
            for (int i = 0; i < s.RawExplicit.Count; i++) {
                var ex = s.RawExplicit[i];
                var toReg = Regions[ex.ToRegion];
                double fdx = region.CenterX - NodeTx[ex.FromNode];
                double fdy = region.CenterY - NodeTy[ex.FromNode];
                double tdx = toReg.CenterX - NodeTx[ex.ToNode];
                double tdy = toReg.CenterY - NodeTy[ex.ToNode];
                int fromHalf = (int)Math.Floor(Math.Sqrt(fdx * fdx + fdy * fdy) * region.WalkMsPerM + 0.5);
                int toHalf = (int)Math.Floor(Math.Sqrt(tdx * tdx + tdy * tdy) * toReg.WalkMsPerM + 0.5);
                if (ex.Kind == WalkEdgeKind.Lift) {
                    liftArcCount++;
                    HasLifts = true;
                }
                var arc = new StationSparseExplicitArc {
                    Id = ExplicitArcs.Count,
                    FromNode = ex.FromNode,
                    ToNode = ex.ToNode,
                    FromKey = ex.FromKey,
                    ToKey = ex.ToKey,
                    FromRegion = rId,
                    ToRegion = ex.ToRegion,
                    Kind = ex.Kind,
                    Server = ex.Server,
                    FromNodeServer = ex.FromNodeServer,
                    ToNodeServer = ex.ToNodeServer,
                    GateDir = ex.GateDir,
                    StairFlights = ex.StairFlights,
                    LiftId = ex.LiftId,
                    StaticCostMs = ex.CostMs,
                    FromHalfWalkMs = fromHalf,
                    ToHalfWalkMs = toHalf,
                };
                ExplicitArcs.Add(arc);
                region.ExplicitArcs.Add(arc);
                toReg.InExplicitArcs.Add(arc);
            }
        }

        void RemoveCrossing(StationSparseCrossing c) {
            if ((uint)c.ToRegion < (uint)Regions.Count) {
                Regions[c.ToRegion].InCrossings.Remove(c);
            }
            int idx = c.Id;
            int last = Crossings.Count - 1;
            if ((uint)idx <= (uint)last && ReferenceEquals(Crossings[idx], c)) {
                if (idx != last) {
                    var moved = Crossings[last];
                    Crossings[idx] = moved;
                    moved.Id = idx;
                }
                Crossings.RemoveAt(last);
            }
            c.Id = -1;
        }

        void RemoveExplicitArc(StationSparseExplicitArc a) {
            if ((uint)a.ToRegion < (uint)Regions.Count) {
                Regions[a.ToRegion].InExplicitArcs.Remove(a);
            }
            if (a.Kind == WalkEdgeKind.Lift && liftArcCount > 0) {
                liftArcCount--;
                HasLifts = liftArcCount > 0;
            }
            int idx = a.Id;
            int last = ExplicitArcs.Count - 1;
            if ((uint)idx <= (uint)last && ReferenceEquals(ExplicitArcs[idx], a)) {
                if (idx != last) {
                    var moved = ExplicitArcs[last];
                    ExplicitArcs[idx] = moved;
                    moved.Id = idx;
                }
                ExplicitArcs.RemoveAt(last);
            }
            a.Id = -1;
        }

        void RemoveRegion(StationSparseRegion reg) {
            RegionByKey.Remove(reg.RegionKey);
            int idx = reg.Id;
            int last = Regions.Count - 1;
            if ((uint)idx <= (uint)last && ReferenceEquals(Regions[idx], reg)) {
                if (idx != last) {
                    var moved = Regions[last];
                    Regions[idx] = moved;
                    moved.Id = idx;
                    for (int k = 0; k < moved.Nodes.Length; k++) NodeRegion[moved.Nodes[k]] = idx;
                    for (int k = 0; k < moved.Crossings.Count; k++) moved.Crossings[k].FromRegion = idx;
                    for (int k = 0; k < moved.InCrossings.Count; k++) moved.InCrossings[k].ToRegion = idx;
                    for (int k = 0; k < moved.ExplicitArcs.Count; k++) moved.ExplicitArcs[k].FromRegion = idx;
                    for (int k = 0; k < moved.InExplicitArcs.Count; k++) moved.InExplicitArcs[k].ToRegion = idx;
                    if (Sectors.TryGetValue(moved.SectorKey, out var msec)) {
                        for (int k = 0; k < msec.RegionIds.Count; k++) {
                            if (msec.RegionIds[k] == last) {
                                msec.RegionIds[k] = idx;
                                break;
                            }
                        }
                    }
                }
                Regions.RemoveAt(last);
            }
            reg.Id = -1;
        }

        void PopulateServerSnapshots(StationWalkGraph graph) {
            prevServers.Clear();
            prevServerByTile.Clear();
            int n = NodeCount;
            foreach (var kv in graph.ServerForNode) {
                int u = kv.Key;
                int sv = kv.Value;
                if ((uint)u >= (uint)n) continue;
                srvAtNode[u] = sv;
                int kindCode = 0, gateMode = 0, gateRot = 0;
                if ((uint)sv < (uint)graph.Servers.Count) {
                    var s = graph.Servers[sv];
                    kindCode = ServerKindCode(s.Kind);
                    gateMode = s.GateMode;
                    gateRot = s.GateRotation;
                }
                var snap = new ServerSnapshot {
                    Node = u,
                    TileKey = NodeTileKey[u],
                    Tx = NodeTx[u],
                    Ty = NodeTy[u],
                    Tz2 = NodeTz2[u],
                    KindCode = kindCode,
                    GateMode = gateMode,
                    GateRotation = gateRot,
                };
                prevServers.Add(snap);
                prevServerByTile[snap.TileKey] = snap;
            }
        }

        void PopulateLiftSnapshots(IReadOnlyList<StationSparseLiftLink> liftLinks, out Dictionary<int, List<StationSparseLiftLink>> liftsByFrom) {
            prevLiftLinks.Clear();
            liftsByFrom = null;
            int n = NodeCount;
            if (liftLinks == null || liftLinks.Count == 0) return;
            liftsByFrom = new Dictionary<int, List<StationSparseLiftLink>>();
            for (int i = 0; i < liftLinks.Count; i++) {
                var link = liftLinks[i];
                if ((uint)link.FromNode >= (uint)n || (uint)link.ToNode >= (uint)n) continue;
                if (!liftsByFrom.TryGetValue(link.FromNode, out var list)) {
                    list = new List<StationSparseLiftLink>();
                    liftsByFrom[link.FromNode] = list;
                }
                list.Add(link);
                prevLiftLinks.Add(new LiftLinkSnapshot {
                    FromKey = NodeTileKey[link.FromNode],
                    ToKey = NodeTileKey[link.ToNode],
                    FromTx = NodeTx[link.FromNode],
                    FromTy = NodeTy[link.FromNode],
                    FromTz2 = NodeTz2[link.FromNode],
                    ToTx = NodeTx[link.ToNode],
                    ToTy = NodeTy[link.ToNode],
                    ToTz2 = NodeTz2[link.ToNode],
                    Id = link.Id ?? "",
                    CycleMs = link.CycleMs,
                });
            }
        }

        void AddSeamNeighborSectors(int tx, int ty, int tz2, HashSet<long> target) {
            int lx = tx & 15, ly = ty & 15;
            if (lx != 0 && lx != 15 && ly != 0 && ly != 15) return;
            for (int dx = -1; dx <= 1; dx++) {
                for (int dy = -1; dy <= 1; dy++) {
                    if (dx == 0 && dy == 0) continue;
                    long nsk = StationSparsePolicy.SectorKeyOfTile(tx + dx, ty + dy, tz2);
                    if (Sectors.ContainsKey(nsk)) target.Add(nsk);
                }
            }
        }

        void RefreshSurvivingExplicitArcServers(HashSet<StationSparseRegion> rebuiltRegions) {
            var adjToRaw = Graph.AdjToRaw;
            var adjKindRaw = Graph.AdjKindRaw;
            var adjSrvRaw = Graph.AdjServerRaw;
            for (int i = 0; i < ExplicitArcs.Count; i++) {
                var arc = ExplicitArcs[i];
                if (rebuiltRegions != null && rebuiltRegions.Contains(Regions[arc.FromRegion])) continue;
                int u = arc.FromNode;
                int v = arc.ToNode;
                arc.FromNodeServer = (uint)u < (uint)NodeCount ? srvAtNode[u] : -1;
                arc.ToNodeServer = (uint)v < (uint)NodeCount ? srvAtNode[v] : -1;
                if (arc.Kind == WalkEdgeKind.Lift && !string.IsNullOrEmpty(arc.LiftId)) {
                    arc.Server = -1;
                    continue;
                }
                if ((uint)u < (uint)NodeCount) {
                    var to = adjToRaw != null ? adjToRaw[u] : Graph.AdjTo[u];
                    var kinds = adjKindRaw != null ? adjKindRaw[u] : Graph.AdjKind[u];
                    var srvs = adjSrvRaw != null ? adjSrvRaw[u] : Graph.AdjServer[u];
                    int kindInt = (int)arc.Kind;
                    for (int e = 0; e < to.Length; e++) {
                        if (to[e] == v && kinds[e] == kindInt) {
                            int sv = srvs[e];
                            arc.Server = sv;
                            arc.StairFlights = arc.Kind == WalkEdgeKind.Stair &&
                                sv >= 0 && sv < Graph.Servers.Count && Graph.Servers[sv].StairFlights > 1
                                ? Graph.Servers[sv].StairFlights : 1;
                            break;
                        }
                    }
                }
            }
        }

        // -------------------------------------------------------- incremental update

        /// <summary>
        /// Updates this topology in place in O(|dirtySectors|) using <paramref name="delta"/>,
        /// producing bit-identical sectors, regions, crossings, explicit arcs, reachability and
        /// <paramref name="diff"/> compared to <see cref="Build"/>. Returns <c>false</c> (without
        /// mutating state) when a full rebuild is cheaper or required.
        /// </summary>
        public bool TryUpdateIncremental(
            StationWalkGraph newGraph,
            IReadOnlyList<StationSparseLiftLink> liftLinks,
            StationWalkGraphDelta delta,
            out StationSparseTopologyDiff diff) {
            diff = null;
            if (newGraph == null || delta == null || !delta.HasIncrementalLists || delta.OldNodeCount != NodeCount) {
                return false;
            }
            int oldCount = NodeCount;
            int newCount = newGraph.NodeCount;
            if (delta.NewNodeCount != newCount) return false;
            int totalTouched = delta.RemovedOldNodes.Length + delta.AddedNewNodeCount + delta.RebuiltNewNodes.Length;
            if (totalTouched > Math.Max(4096, oldCount / 4)) return false;

            // 1. Precompute added node coordinates without mutating existing arrays.
            int addedStart = delta.AddedNewNodeStart;
            int addedCount = delta.AddedNewNodeCount;
            var addedTx = addedCount > 0 ? new int[addedCount] : Array.Empty<int>();
            var addedTy = addedCount > 0 ? new int[addedCount] : Array.Empty<int>();
            var addedTz2 = addedCount > 0 ? new int[addedCount] : Array.Empty<int>();
            var addedKey = addedCount > 0 ? new long[addedCount] : Array.Empty<long>();
            var addedSk = addedCount > 0 ? new long[addedCount] : Array.Empty<long>();
            for (int i = 0; i < addedCount; i++) {
                ComputeNodeTileCoords(newGraph, addedStart + i, out addedTx[i], out addedTy[i], out addedTz2[i], out addedKey[i], out addedSk[i]);
            }

            // 2. Collect rebuildSectors BEFORE mutating any arrays (lossless bailout if too large).
            var rebuildSectors = new HashSet<long>();
            for (int i = 0; i < delta.RemovedOldNodes.Length; i++) {
                int oldU = delta.RemovedOldNodes[i];
                if ((uint)oldU >= (uint)oldCount) return false;
                rebuildSectors.Add(nodeSector[oldU]);
                AddSeamNeighborSectors(NodeTx[oldU], NodeTy[oldU], NodeTz2[oldU], rebuildSectors);
                var pTo = PlainAdjTo[oldU];
                for (int e = 0; e < pTo.Length; e++) {
                    int nb = pTo[e];
                    if ((uint)nb < (uint)oldCount) rebuildSectors.Add(nodeSector[nb]);
                }
            }
            for (int i = 0; i < delta.MovedNodes.Length; i++) {
                int oldU = delta.MovedNodes[i].OldId;
                if ((uint)oldU >= (uint)oldCount) return false;
                rebuildSectors.Add(nodeSector[oldU]);
                AddSeamNeighborSectors(NodeTx[oldU], NodeTy[oldU], NodeTz2[oldU], rebuildSectors);
            }
            for (int i = 0; i < addedCount; i++) {
                rebuildSectors.Add(addedSk[i]);
                AddSeamNeighborSectors(addedTx[i], addedTy[i], addedTz2[i], rebuildSectors);
            }
            for (int i = 0; i < delta.RebuiltNewNodes.Length; i++) {
                int u = delta.RebuiltNewNodes[i];
                if ((uint)u >= (uint)newCount) return false;
                ComputeNodeTileCoords(newGraph, u, out int tx, out int ty, out int tz2, out _, out long sk);
                rebuildSectors.Add(sk);
                AddSeamNeighborSectors(tx, ty, tz2, rebuildSectors);
            }
            for (int i = 0; i < delta.VerticalRemovedOldNodes.Length; i++) {
                int oldU = delta.VerticalRemovedOldNodes[i];
                if ((uint)oldU < (uint)oldCount) rebuildSectors.Add(nodeSector[oldU]);
            }
            for (int i = 0; i < delta.VerticalChangedNewNodes.Length; i++) {
                int u = delta.VerticalChangedNewNodes[i];
                if ((uint)u < (uint)newCount) {
                    ComputeNodeTileCoords(newGraph, u, out _, out _, out _, out _, out long sk);
                    rebuildSectors.Add(sk);
                }
            }

            // Server diff in O(|Servers|):
            var newServerByTile = new Dictionary<long, ServerSnapshot>(newGraph.ServerForNode.Count);
            foreach (var kv in newGraph.ServerForNode) {
                int u = kv.Key;
                int sv = kv.Value;
                if ((uint)u >= (uint)newCount) continue;
                ComputeNodeTileCoords(newGraph, u, out int tx, out int ty, out int tz2, out long tk, out long sk);
                int kindCode = 0, gateMode = 0, gateRot = 0;
                if ((uint)sv < (uint)newGraph.Servers.Count) {
                    var s = newGraph.Servers[sv];
                    kindCode = ServerKindCode(s.Kind);
                    gateMode = s.GateMode;
                    gateRot = s.GateRotation;
                }
                var snap = new ServerSnapshot {
                    Node = u, TileKey = tk, Tx = tx, Ty = ty, Tz2 = tz2,
                    KindCode = kindCode, GateMode = gateMode, GateRotation = gateRot,
                };
                newServerByTile[tk] = snap;
                if (!prevServerByTile.TryGetValue(tk, out var oldSnap) ||
                    oldSnap.KindCode != snap.KindCode ||
                    oldSnap.GateMode != snap.GateMode ||
                    oldSnap.GateRotation != snap.GateRotation) {
                    rebuildSectors.Add(sk);
                    AddSeamNeighborSectors(tx, ty, tz2, rebuildSectors);
                }
            }
            foreach (var kv in prevServerByTile) {
                if (!newServerByTile.ContainsKey(kv.Key)) {
                    var oldSnap = kv.Value;
                    rebuildSectors.Add(StationSparsePolicy.SectorKeyOfTile(oldSnap.Tx, oldSnap.Ty, oldSnap.Tz2));
                    AddSeamNeighborSectors(oldSnap.Tx, oldSnap.Ty, oldSnap.Tz2, rebuildSectors);
                }
            }

            // Lift link diff in O(|LiftLinks|):
            var newLiftSet = new HashSet<LiftLinkSnapshot>();
            var oldLiftSet = prevLiftLinks.Count > 0 ? new HashSet<LiftLinkSnapshot>(prevLiftLinks) : null;
            if (liftLinks != null && liftLinks.Count > 0) {
                for (int i = 0; i < liftLinks.Count; i++) {
                    var link = liftLinks[i];
                    if ((uint)link.FromNode >= (uint)newCount || (uint)link.ToNode >= (uint)newCount) continue;
                    ComputeNodeTileCoords(newGraph, link.FromNode, out int ftx, out int fty, out int ftz2, out long fk, out long fsk);
                    ComputeNodeTileCoords(newGraph, link.ToNode, out int ttx, out int tty, out int ttz2, out long tk, out _);
                    var snap = new LiftLinkSnapshot {
                        FromKey = fk, ToKey = tk,
                        FromTx = ftx, FromTy = fty, FromTz2 = ftz2,
                        ToTx = ttx, ToTy = tty, ToTz2 = ttz2,
                        Id = link.Id ?? "", CycleMs = link.CycleMs,
                    };
                    newLiftSet.Add(snap);
                    if (oldLiftSet == null || !oldLiftSet.Contains(snap)) {
                        rebuildSectors.Add(fsk);
                    }
                }
            }
            for (int i = 0; i < prevLiftLinks.Count; i++) {
                var oldL = prevLiftLinks[i];
                if (!newLiftSet.Contains(oldL)) {
                    rebuildSectors.Add(StationSparsePolicy.SectorKeyOfTile(oldL.FromTx, oldL.FromTy, oldL.FromTz2));
                }
            }

            if (rebuildSectors.Count > Math.Max(64, Sectors.Count / 4)) {
                return false;
            }

            // Fast path: zero sectors structurally touched (e.g. cosmetic/non-walk module edit):
            if (rebuildSectors.Count == 0 && delta.RemovedOldNodes.Length == 0 && delta.MovedNodes.Length == 0 && addedCount == 0) {
                Graph = newGraph;
                if (delta.ModulesChanged) {
                    for (int i = 0; i < prevServers.Count; i++) {
                        int u = prevServers[i].Node;
                        if ((uint)u < (uint)nodeCapacity) srvAtNode[u] = -1;
                    }
                    PopulateServerSnapshots(newGraph);
                    RefreshSurvivingExplicitArcServers(null);
                }
                diff = new StationSparseTopologyDiff {
                    RoutingNeutral = true,
                    TopologyRevision = TopologyRevision,
                };
                for (int i = 0; i < Regions.Count; i++) {
                    diff.PreservedRegionKeys.Add(Regions[i].RegionKey);
                }
                return true;
            }

            // --- Point of commit: mutate topology in place in O(|rebuildSectors|) ---
            EnsureNodeCapacity(newCount);

            // 3. Snapshot old sector/region metadata, build sectorNewNodes and affectedOutgoingRegions.
            var oldSectorSigs = new Dictionary<long, uint>(rebuildSectors.Count);
            var oldSectorRevs = new Dictionary<long, int>(rebuildSectors.Count);
            var oldRegionMeta = new Dictionary<long, (int Revision, long SampleTileKey)>();
            var sectorNewNodes = new Dictionary<long, List<int>>(rebuildSectors.Count);
            var oldRegionsToRemove = new List<StationSparseRegion>();
            var oldRegionSet = new HashSet<int>();
            var removedOldRegionKeys = new List<long>();
            var oldToNew = delta.OldToNewNode;

            foreach (long sk in rebuildSectors) {
                var list = new List<int>();
                sectorNewNodes[sk] = list;
                if (Sectors.TryGetValue(sk, out var prevSec)) {
                    oldSectorSigs[sk] = prevSec.Signature;
                    oldSectorRevs[sk] = prevSec.Revision;
                    for (int i = 0; i < prevSec.RegionIds.Count; i++) {
                        int rId = prevSec.RegionIds[i];
                        var reg = Regions[rId];
                        oldRegionsToRemove.Add(reg);
                        oldRegionSet.Add(rId);
                        removedOldRegionKeys.Add(reg.RegionKey);
                        oldRegionMeta[reg.RegionKey] = (reg.Revision, reg.SampleTileKey);
                        for (int k = 0; k < reg.Nodes.Length; k++) {
                            int oldU = reg.Nodes[k];
                            int newU = oldToNew[oldU];
                            if (newU >= 0) list.Add(newU);
                        }
                    }
                }
            }
            for (int i = 0; i < addedCount; i++) {
                sectorNewNodes[addedSk[i]].Add(addedStart + i);
            }

            var survivingAffectedOutgoing = new HashSet<StationSparseRegion>();
            for (int i = 0; i < oldRegionsToRemove.Count; i++) {
                var oldReg = oldRegionsToRemove[i];
                for (int k = 0; k < oldReg.InCrossings.Count; k++) {
                    int fromR = oldReg.InCrossings[k].FromRegion;
                    if (!oldRegionSet.Contains(fromR)) survivingAffectedOutgoing.Add(Regions[fromR]);
                }
                for (int k = 0; k < oldReg.InExplicitArcs.Count; k++) {
                    int fromR = oldReg.InExplicitArcs[k].FromRegion;
                    if (!oldRegionSet.Contains(fromR)) survivingAffectedOutgoing.Add(Regions[fromR]);
                }
            }

            var removedExplicitArcSectorPairs = new List<(long FromSk, long ToSk)>();
            foreach (var reg in survivingAffectedOutgoing) {
                for (int k = 0; k < reg.ExplicitArcs.Count; k++) {
                    var a = reg.ExplicitArcs[k];
                    removedExplicitArcSectorPairs.Add((Regions[a.FromRegion].SectorKey, Regions[a.ToRegion].SectorKey));
                }
            }
            for (int i = 0; i < oldRegionsToRemove.Count; i++) {
                var oldReg = oldRegionsToRemove[i];
                for (int k = 0; k < oldReg.ExplicitArcs.Count; k++) {
                    var a = oldReg.ExplicitArcs[k];
                    removedExplicitArcSectorPairs.Add((Regions[a.FromRegion].SectorKey, Regions[a.ToRegion].SectorKey));
                }
            }

            // 4. Detach outgoing crossings & explicit arcs of affected regions, then remove old regions descending by Id.
            foreach (var reg in survivingAffectedOutgoing) {
                for (int k = 0; k < reg.Crossings.Count; k++) RemoveCrossing(reg.Crossings[k]);
                reg.Crossings.Clear();
                for (int k = 0; k < reg.ExplicitArcs.Count; k++) RemoveExplicitArc(reg.ExplicitArcs[k]);
                reg.ExplicitArcs.Clear();
            }
            for (int i = 0; i < oldRegionsToRemove.Count; i++) {
                var oldReg = oldRegionsToRemove[i];
                for (int k = 0; k < oldReg.Crossings.Count; k++) RemoveCrossing(oldReg.Crossings[k]);
                oldReg.Crossings.Clear();
                for (int k = 0; k < oldReg.ExplicitArcs.Count; k++) RemoveExplicitArc(oldReg.ExplicitArcs[k]);
                oldReg.ExplicitArcs.Clear();
            }
            oldRegionsToRemove.Sort((a, b) => b.Id.CompareTo(a.Id));
            for (int i = 0; i < oldRegionsToRemove.Count; i++) {
                RemoveRegion(oldRegionsToRemove[i]);
            }

            // 5. Patch per-node arrays, TileKeyToNode, srvAtNode, and lift snapshots.
            for (int i = 0; i < prevServers.Count; i++) {
                int oldSrvU = prevServers[i].Node;
                if ((uint)oldSrvU < (uint)nodeCapacity) srvAtNode[oldSrvU] = -1;
            }

            int movedCount = delta.MovedNodes.Length;
            var movedTx = movedCount > 0 ? new int[movedCount] : Array.Empty<int>();
            var movedTy = movedCount > 0 ? new int[movedCount] : Array.Empty<int>();
            var movedTz2 = movedCount > 0 ? new int[movedCount] : Array.Empty<int>();
            var movedKey = movedCount > 0 ? new long[movedCount] : Array.Empty<long>();
            var movedSk = movedCount > 0 ? new long[movedCount] : Array.Empty<long>();
            for (int i = 0; i < movedCount; i++) {
                int oldU = delta.MovedNodes[i].OldId;
                movedTx[i] = NodeTx[oldU];
                movedTy[i] = NodeTy[oldU];
                movedTz2[i] = NodeTz2[oldU];
                movedKey[i] = NodeTileKey[oldU];
                movedSk[i] = nodeSector[oldU];
            }
            for (int i = 0; i < delta.RemovedOldNodes.Length; i++) {
                int oldU = delta.RemovedOldNodes[i];
                TileKeyToNode.Remove(NodeTileKey[oldU]);
            }
            for (int i = 0; i < movedCount; i++) {
                int newU = delta.MovedNodes[i].NewId;
                NodeTx[newU] = movedTx[i];
                NodeTy[newU] = movedTy[i];
                NodeTz2[newU] = movedTz2[i];
                NodeTileKey[newU] = movedKey[i];
                nodeSector[newU] = movedSk[i];
                TileKeyToNode[movedKey[i]] = newU;
            }
            for (int i = 0; i < addedCount; i++) {
                int newU = addedStart + i;
                NodeTx[newU] = addedTx[i];
                NodeTy[newU] = addedTy[i];
                NodeTz2[newU] = addedTz2[i];
                NodeTileKey[newU] = addedKey[i];
                nodeSector[newU] = addedSk[i];
                TileKeyToNode[addedKey[i]] = newU;
            }
            for (int i = newCount; i < oldCount; i++) {
                NodeRegion[i] = -1;
                NodeLocalIdx[i] = -1;
                NodeTileKey[i] = -1;
                PlainAdjTo[i] = Array.Empty<int>();
                PlainAdjCostMs[i] = Array.Empty<int>();
            }

            NodeCount = newCount;
            Graph = newGraph;
            PopulateServerSnapshots(newGraph);
            PopulateLiftSnapshots(liftLinks, out var liftsByFrom);

            // 6. Rebuild PlainAdj, signatures, and connected regions ONLY for rebuildSectors.
            var adjToRaw = newGraph.AdjToRaw;
            var adjCostRaw = newGraph.AdjCostRaw;
            var adjKindRaw = newGraph.AdjKindRaw;
            var adjSrvRaw = newGraph.AdjServerRaw;

            var sortedRebuild = new List<long>(rebuildSectors);
            sortedRebuild.Sort();
            var plainFlagsMap = new Dictionary<int, bool[]>(sortedRebuild.Count * 128);
            for (int si = 0; si < sortedRebuild.Count; si++) {
                long sk = sortedRebuild[si];
                var nodes = sectorNewNodes[sk];
                if (nodes.Count == 0) {
                    Sectors.Remove(sk);
                    SamplesDirty.Remove(sk);
                    continue;
                }
                for (int i = 0; i < nodes.Count; i++) {
                    int u = nodes[i];
                    plainFlagsMap[u] = ComputePlainAdjForNode(u, adjToRaw, adjCostRaw, adjKindRaw, adjSrvRaw);
                }
            }

            var bfs = new List<int>(256);
            var sigEdges = new List<SigEdge>(16);
            var newlyCreatedRegions = new List<StationSparseRegion>(sortedRebuild.Count * 2);
            var directlyChanged = new HashSet<long>();

            for (int si = 0; si < sortedRebuild.Count; si++) {
                long sk = sortedRebuild[si];
                var nodes = sectorNewNodes[sk];
                if (nodes.Count == 0) {
                    if (oldSectorSigs.ContainsKey(sk)) directlyChanged.Add(sk);
                    continue;
                }
                nodes.Sort((a, b) => NodeTileKey[a].CompareTo(NodeTileKey[b]));
                StationSparsePolicy.UnpackSectorKey(sk, out int sx, out int sy, out int tz2);
                uint sig = ComputeSectorSignature(sx, sy, tz2, nodes, null, plainFlagsMap, adjToRaw, adjCostRaw, adjKindRaw, adjSrvRaw, liftsByFrom, sigEdges);

                if (!oldSectorSigs.TryGetValue(sk, out uint prevSig) || prevSig != sig) {
                    directlyChanged.Add(sk);
                }

                var sector = new StationSparseSector {
                    SectorKey = sk,
                    Sx = sx,
                    Sy = sy,
                    Tz2 = tz2,
                    Revision = oldSectorRevs.TryGetValue(sk, out int prevRev) ? prevRev : 1,
                    Signature = sig,
                };
                Sectors[sk] = sector;
                BuildSectorRegions(sk, sector, nodes, bfs, newlyCreatedRegions);
            }

            // 7. Rebuild crossings and explicit arcs for newly created regions + surviving affected outgoing regions.
            var scratch = new RegionBuildScratch();
            var rebuiltRegionSet = new HashSet<StationSparseRegion>(newlyCreatedRegions.Count + survivingAffectedOutgoing.Count);
            for (int i = 0; i < newlyCreatedRegions.Count; i++) {
                var reg = newlyCreatedRegions[i];
                rebuiltRegionSet.Add(reg);
                BuildRegionCrossingsAndArcs(reg, null, plainFlagsMap, adjToRaw, adjCostRaw, adjKindRaw, adjSrvRaw, liftsByFrom, scratch);
            }
            foreach (var reg in survivingAffectedOutgoing) {
                rebuiltRegionSet.Add(reg);
                BuildRegionCrossingsAndArcs(reg, null, plainFlagsMap, adjToRaw, adjCostRaw, adjKindRaw, adjSrvRaw, liftsByFrom, scratch);
            }
            if (delta.ModulesChanged) {
                RefreshSurvivingExplicitArcServers(rebuiltRegionSet);
            }

            // 8. Compute diff, revisions, and sample preservation — identical semantics to Build.
            diff = new StationSparseTopologyDiff { TopologyRevision = TopologyRevision };
            if (directlyChanged.Count == 0) {
                diff.RoutingNeutral = true;
                for (int si = 0; si < sortedRebuild.Count; si++) {
                    long sk = sortedRebuild[si];
                    if (!Sectors.TryGetValue(sk, out var sec)) continue;
                    sec.Revision = oldSectorRevs.TryGetValue(sk, out int prevRev) ? prevRev : 1;
                    for (int i = 0; i < sec.RegionIds.Count; i++) {
                        var reg = Regions[sec.RegionIds[i]];
                        if (oldRegionMeta.TryGetValue(reg.RegionKey, out var pm)) {
                            reg.Revision = pm.Revision;
                            reg.SampleTileKey = pm.SampleTileKey;
                            reg.SampleNode = pm.SampleTileKey >= 0 && TileKeyToNode.TryGetValue(pm.SampleTileKey, out int sn) ? sn : -1;
                        } else {
                            reg.Revision = sec.Revision;
                        }
                    }
                }
                for (int i = 0; i < Regions.Count; i++) {
                    diff.PreservedRegionKeys.Add(Regions[i].RegionKey);
                }
                revAdjBuilt = false;
                reachCache.Clear();
                return true;
            }

            revAdjBuilt = false;
            reachCache.Clear();

            var dirtySet = new HashSet<long>();
            foreach (long sk in directlyChanged) {
                StationSparsePolicy.UnpackSectorKey(sk, out int sx, out int sy, out int tz2);
                for (int dy = -1; dy <= 1; dy++) {
                    for (int dx = -1; dx <= 1; dx++) {
                        dirtySet.Add(StationSparsePolicy.PackSectorKey(sx + dx, sy + dy, tz2));
                    }
                }
            }
            for (int i = 0; i < ExplicitArcs.Count; i++) {
                var arc = ExplicitArcs[i];
                long fromSk = Regions[arc.FromRegion].SectorKey;
                long toSk = Regions[arc.ToRegion].SectorKey;
                if (directlyChanged.Contains(fromSk)) dirtySet.Add(toSk);
                if (directlyChanged.Contains(toSk)) dirtySet.Add(fromSk);
            }
            for (int i = 0; i < removedExplicitArcSectorPairs.Count; i++) {
                var pair = removedExplicitArcSectorPairs[i];
                if (directlyChanged.Contains(pair.FromSk)) dirtySet.Add(pair.ToSk);
                if (directlyChanged.Contains(pair.ToSk)) dirtySet.Add(pair.FromSk);
            }

            TopologyRevision++;
            diff.TopologyRevision = TopologyRevision;

            foreach (long sk in dirtySet) {
                if (!Sectors.TryGetValue(sk, out var sec)) continue;
                int prevRev = rebuildSectors.Contains(sk)
                    ? (oldSectorRevs.TryGetValue(sk, out int orv) ? orv : 0)
                    : sec.Revision;
                sec.Revision = prevRev + 1;
                diff.DirtySectorKeys.Add(sk);
                SamplesDirty[sk] = sec.Revision;
                for (int i = 0; i < sec.RegionIds.Count; i++) {
                    var reg = Regions[sec.RegionIds[i]];
                    reg.Revision = sec.Revision;
                    diff.DirtyRegionKeys.Add(reg.RegionKey);
                    long candSample = rebuildSectors.Contains(sk)
                        ? (oldRegionMeta.TryGetValue(reg.RegionKey, out var pm) ? pm.SampleTileKey : -1)
                        : reg.SampleTileKey;
                    if (candSample >= 0 &&
                        TileKeyToNode.TryGetValue(candSample, out int sn) &&
                        NodeRegion[sn] == reg.Id && srvAtNode[sn] < 0) {
                        reg.SampleTileKey = candSample;
                        reg.SampleNode = sn;
                    } else {
                        reg.SampleTileKey = -1;
                        reg.SampleNode = -1;
                    }
                }
            }
            diff.DirtySectorKeys.Sort();

            // Restore revision/sample on rebuilt sectors outside dirtySet (e.g. pop-and-swap tail sectors).
            for (int si = 0; si < sortedRebuild.Count; si++) {
                long sk = sortedRebuild[si];
                if (dirtySet.Contains(sk) || !Sectors.TryGetValue(sk, out var sec)) continue;
                sec.Revision = oldSectorRevs.TryGetValue(sk, out int prevRev) ? prevRev : 1;
                for (int i = 0; i < sec.RegionIds.Count; i++) {
                    var reg = Regions[sec.RegionIds[i]];
                    if (oldRegionMeta.TryGetValue(reg.RegionKey, out var pm)) {
                        reg.Revision = pm.Revision;
                        reg.SampleTileKey = pm.SampleTileKey;
                        reg.SampleNode = pm.SampleTileKey >= 0 && TileKeyToNode.TryGetValue(pm.SampleTileKey, out int sn) ? sn : -1;
                    } else {
                        reg.Revision = sec.Revision;
                    }
                }
            }

            for (int i = 0; i < Regions.Count; i++) {
                var reg = Regions[i];
                if (!dirtySet.Contains(reg.SectorKey)) {
                    diff.PreservedRegionKeys.Add(reg.RegionKey);
                }
            }
            for (int i = 0; i < removedOldRegionKeys.Count; i++) {
                long rk = removedOldRegionKeys[i];
                if (!diff.PreservedRegionKeys.Contains(rk)) diff.DirtyRegionKeys.Add(rk);
            }
            return true;
        }

        // ---------------------------------------------------------------- full build

        public static StationSparseTopology Build(
            StationWalkGraph graph,
            int seed,
            IReadOnlyList<StationSparseLiftLink> liftLinks,
            StationSparseTopology previous,
            out StationSparseTopologyDiff diff) {
            int n = graph.NodeCount;
            var topo = new StationSparseTopology(graph, seed, previous != null ? previous.TopologyRevision : 1);

            // 1. Stable tile keys and per-sector buckets.
            var sectorNodes = new Dictionary<long, List<int>>();
            for (int i = 0; i < n; i++) {
                ComputeNodeTileCoords(graph, i, out int tx, out int ty, out int tz2, out long key, out long sk);
                topo.NodeTx[i] = tx;
                topo.NodeTy[i] = ty;
                topo.NodeTz2[i] = tz2;
                topo.NodeTileKey[i] = key;
                topo.TileKeyToNode[key] = i;
                topo.nodeSector[i] = sk;
                if (!sectorNodes.TryGetValue(sk, out var list)) {
                    list = new List<int>();
                    sectorNodes[sk] = list;
                }
                list.Add(i);
            }

            topo.PopulateServerSnapshots(graph);
            topo.PopulateLiftSnapshots(liftLinks, out var liftsByFrom);

            // 2. Build bidirectional plain-walk jagged adjacency.
            var adjToRaw = graph.AdjToRaw;
            var adjCostRaw = graph.AdjCostRaw;
            var adjKindRaw = graph.AdjKindRaw;
            var adjSrvRaw = graph.AdjServerRaw;

            var isPlain = new bool[n][];
            for (int u = 0; u < n; u++) {
                isPlain[u] = topo.ComputePlainAdjForNode(u, adjToRaw, adjCostRaw, adjKindRaw, adjSrvRaw);
            }

            // 3. Build sectors, signatures, and connected regions per sector in stable order.
            var sortedSectorKeys = new List<long>(sectorNodes.Keys);
            sortedSectorKeys.Sort();
            var bfs = new List<int>(256);
            var sigEdges = new List<SigEdge>(16);

            for (int si = 0; si < sortedSectorKeys.Count; si++) {
                long sk = sortedSectorKeys[si];
                var nodes = sectorNodes[sk];
                nodes.Sort((a, b) => topo.NodeTileKey[a].CompareTo(topo.NodeTileKey[b]));
                StationSparsePolicy.UnpackSectorKey(sk, out int sx, out int sy, out int tz2);

                uint sig = topo.ComputeSectorSignature(sx, sy, tz2, nodes, isPlain, null, adjToRaw, adjCostRaw, adjKindRaw, adjSrvRaw, liftsByFrom, sigEdges);

                var sector = new StationSparseSector {
                    SectorKey = sk,
                    Sx = sx,
                    Sy = sy,
                    Tz2 = tz2,
                    Revision = 1,
                    Signature = sig,
                };
                topo.Sectors[sk] = sector;
                topo.BuildSectorRegions(sk, sector, nodes, bfs, null);
            }

            // 4. Build crossings and explicit arcs per region.
            var scratch = new RegionBuildScratch();
            for (int rId = 0; rId < topo.Regions.Count; rId++) {
                topo.BuildRegionCrossingsAndArcs(topo.Regions[rId], isPlain, null, adjToRaw, adjCostRaw, adjKindRaw, adjSrvRaw, liftsByFrom, scratch);
            }

            // 5. Diff against previous topology for per-sector revision retention & dirty halo.
            diff = new StationSparseTopologyDiff { TopologyRevision = topo.TopologyRevision };
            if (previous == null) {
                for (int i = 0; i < topo.Regions.Count; i++) {
                    topo.RefreshRegionSample(topo.Regions[i], -1);
                    diff.DirtyRegionKeys.Add(topo.Regions[i].RegionKey);
                }
                diff.DirtySectorKeys.AddRange(sortedSectorKeys);
                return topo;
            }

            var directlyChanged = new HashSet<long>();
            foreach (var kv in topo.Sectors) {
                if (!previous.Sectors.TryGetValue(kv.Key, out var prevSec) || prevSec.Signature != kv.Value.Signature) {
                    directlyChanged.Add(kv.Key);
                }
            }
            foreach (var sk in previous.Sectors.Keys) {
                if (!topo.Sectors.ContainsKey(sk)) directlyChanged.Add(sk);
            }

            if (directlyChanged.Count == 0) {
                topo.TopologyRevision = previous.TopologyRevision;
                diff.RoutingNeutral = true;
                diff.TopologyRevision = topo.TopologyRevision;
                foreach (var kv in topo.Sectors) {
                    var prevSec = previous.Sectors[kv.Key];
                    kv.Value.Revision = prevSec.Revision;
                    for (int i = 0; i < kv.Value.RegionIds.Count; i++) {
                        var reg = topo.Regions[kv.Value.RegionIds[i]];
                        if (previous.RegionByKey.TryGetValue(reg.RegionKey, out var prevReg)) {
                            reg.Revision = prevReg.Revision;
                            reg.SampleTileKey = prevReg.SampleTileKey;
                            reg.SampleNode = prevReg.SampleTileKey >= 0 && topo.TileKeyToNode.TryGetValue(prevReg.SampleTileKey, out int sn) ? sn : -1;
                            diff.PreservedRegionKeys.Add(reg.RegionKey);
                        } else {
                            reg.Revision = kv.Value.Revision;
                        }
                    }
                }
                foreach (var kv in previous.SamplesDirty) {
                    if (topo.Sectors.ContainsKey(kv.Key)) topo.SamplesDirty[kv.Key] = kv.Value;
                }
                return topo;
            }

            var dirtySet = new HashSet<long>();
            foreach (long sk in directlyChanged) {
                StationSparsePolicy.UnpackSectorKey(sk, out int sx, out int sy, out int tz2);
                for (int dy = -1; dy <= 1; dy++) {
                    for (int dx = -1; dx <= 1; dx++) {
                        dirtySet.Add(StationSparsePolicy.PackSectorKey(sx + dx, sy + dy, tz2));
                    }
                }
            }
            for (int i = 0; i < topo.ExplicitArcs.Count; i++) {
                var arc = topo.ExplicitArcs[i];
                long fromSk = topo.Regions[arc.FromRegion].SectorKey;
                long toSk = topo.Regions[arc.ToRegion].SectorKey;
                if (directlyChanged.Contains(fromSk)) dirtySet.Add(toSk);
                if (directlyChanged.Contains(toSk)) dirtySet.Add(fromSk);
            }
            for (int i = 0; i < previous.ExplicitArcs.Count; i++) {
                var arc = previous.ExplicitArcs[i];
                long fromSk = previous.Regions[arc.FromRegion].SectorKey;
                long toSk = previous.Regions[arc.ToRegion].SectorKey;
                if (directlyChanged.Contains(fromSk)) dirtySet.Add(toSk);
                if (directlyChanged.Contains(toSk)) dirtySet.Add(fromSk);
            }

            topo.TopologyRevision = previous.TopologyRevision + 1;
            diff.TopologyRevision = topo.TopologyRevision;
            foreach (var kv in previous.SamplesDirty) {
                if (topo.Sectors.ContainsKey(kv.Key)) topo.SamplesDirty[kv.Key] = kv.Value;
            }

            for (int si = 0; si < sortedSectorKeys.Count; si++) {
                long sk = sortedSectorKeys[si];
                var sec = topo.Sectors[sk];
                previous.Sectors.TryGetValue(sk, out var prevSec);
                if (dirtySet.Contains(sk)) {
                    sec.Revision = (prevSec != null ? prevSec.Revision : 0) + 1;
                    diff.DirtySectorKeys.Add(sk);
                    topo.SamplesDirty[sk] = sec.Revision;
                    for (int i = 0; i < sec.RegionIds.Count; i++) {
                        var reg = topo.Regions[sec.RegionIds[i]];
                        reg.Revision = sec.Revision;
                        diff.DirtyRegionKeys.Add(reg.RegionKey);
                        if (previous.RegionByKey.TryGetValue(reg.RegionKey, out var prevReg) &&
                            prevReg.SampleTileKey >= 0 &&
                            topo.TileKeyToNode.TryGetValue(prevReg.SampleTileKey, out int sn) &&
                            topo.NodeRegion[sn] == reg.Id && !graph.ServerForNode.ContainsKey(sn)) {
                            reg.SampleTileKey = prevReg.SampleTileKey;
                            reg.SampleNode = sn;
                        }
                    }
                } else {
                    sec.Revision = prevSec != null ? prevSec.Revision : 1;
                    for (int i = 0; i < sec.RegionIds.Count; i++) {
                        var reg = topo.Regions[sec.RegionIds[i]];
                        if (previous.RegionByKey.TryGetValue(reg.RegionKey, out var prevReg)) {
                            reg.Revision = prevReg.Revision;
                            reg.SampleTileKey = prevReg.SampleTileKey;
                            reg.SampleNode = prevReg.SampleTileKey >= 0 && topo.TileKeyToNode.TryGetValue(prevReg.SampleTileKey, out int sn) ? sn : -1;
                            diff.PreservedRegionKeys.Add(reg.RegionKey);
                        } else {
                            reg.Revision = sec.Revision;
                        }
                    }
                }
            }
            for (int i = 0; i < previous.Regions.Count; i++) {
                long rk = previous.Regions[i].RegionKey;
                if (!diff.PreservedRegionKeys.Contains(rk)) diff.DirtyRegionKeys.Add(rk);
            }
            return topo;
        }
    }
}
