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
    /// </summary>
    public sealed class StationSparseTopology {
        public StationWalkGraph Graph;
        public readonly int Seed;
        public int TopologyRevision;

        public int[] NodeTx;
        public int[] NodeTy;
        public int[] NodeTz2;
        public long[] NodeTileKey;
        public readonly Dictionary<long, int> TileKeyToNode;

        public int[] PlainAdjStart;
        public int[] PlainAdjTo;
        public int[] PlainAdjCostMs;

        public int[] NodeRegion;
        public int[] NodeLocalIdx;

        public readonly Dictionary<long, StationSparseSector> Sectors = new Dictionary<long, StationSparseSector>();
        public readonly List<StationSparseRegion> Regions = new List<StationSparseRegion>();
        public readonly Dictionary<long, StationSparseRegion> RegionByKey = new Dictionary<long, StationSparseRegion>();
        public readonly List<StationSparseCrossing> Crossings = new List<StationSparseCrossing>();
        public readonly List<StationSparseExplicitArc> ExplicitArcs = new List<StationSparseExplicitArc>();
        public bool HasLifts;
        public readonly Dictionary<long, int> SamplesDirty = new Dictionary<long, int>();

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
            NodeTx = new int[n];
            NodeTy = new int[n];
            NodeTz2 = new int[n];
            NodeTileKey = new long[n];
            TileKeyToNode = new Dictionary<long, int>(n);
            PlainAdjStart = new int[n + 1];
            PlainAdjTo = Array.Empty<int>();
            PlainAdjCostMs = Array.Empty<int>();
            NodeRegion = new int[n];
            NodeLocalIdx = new int[n];
            Array.Fill(NodeRegion, -1);
            Array.Fill(NodeLocalIdx, -1);
        }

        public long RefreshRegionSample(StationSparseRegion region, long oldSampleKey) {
            bool IsClear(int node, int minDeg) {
                if (node < 0 || Graph.ServerForNode.ContainsKey(node)) return false;
                return PlainAdjStart[node + 1] - PlainAdjStart[node] >= minDeg;
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
            if ((uint)fromNode >= (uint)NodeRegion.Length || (uint)toNode >= (uint)NodeRegion.Length) return false;
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

        static bool CheckGatePassage(StationWalkGraph graph, int[] srvAtNode, int from, int to, out int direction) {
            direction = 0;
            int toSrv = (uint)to < (uint)srvAtNode.Length ? srvAtNode[to] : -1;
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

        public static StationSparseTopology Build(
            StationWalkGraph graph,
            int seed,
            IReadOnlyList<StationSparseLiftLink> liftLinks,
            StationSparseTopology previous,
            out StationSparseTopologyDiff diff) {
            int n = graph.NodeCount;
            var topo = new StationSparseTopology(graph, seed, previous != null ? previous.TopologyRevision : 1);

            var srvAtNode = new int[n];
            Array.Fill(srvAtNode, -1);
            foreach (var kv in graph.ServerForNode) {
                if ((uint)kv.Key < (uint)n) srvAtNode[kv.Key] = kv.Value;
            }

            // 1. Stable tile keys and per-sector buckets.
            var sectorNodes = new Dictionary<long, List<int>>();
            var nodeSector = new long[n];
            for (int i = 0; i < n; i++) {
                int tx = (int)Math.Floor(graph.NodeX[i]);
                int ty = (int)Math.Floor(graph.NodeY[i]);
                int tz2 = (int)Math.Floor((graph.NodeZ[i] - 1.0) * 2.0 + 0.5);
                long key = StationSparsePolicy.PackTileKey(tx, ty, tz2);
                topo.NodeTx[i] = tx;
                topo.NodeTy[i] = ty;
                topo.NodeTz2[i] = tz2;
                topo.NodeTileKey[i] = key;
                topo.TileKeyToNode[key] = i;
                long sk = StationSparsePolicy.SectorKeyOfTile(tx, ty, tz2);
                nodeSector[i] = sk;
                if (!sectorNodes.TryGetValue(sk, out var list)) {
                    list = new List<int>();
                    sectorNodes[sk] = list;
                }
                list.Add(i);
            }

            // 2. Build bidirectional plain-walk CSR.
            var adjToRaw = graph.AdjToRaw;
            var adjCostRaw = graph.AdjCostRaw;
            var adjKindRaw = graph.AdjKindRaw;
            var adjSrvRaw = graph.AdjServerRaw;

            var isPlain = new bool[n][];
            var plainCounts = new int[n];
            int plainTotal = 0;
            for (int u = 0; u < n; u++) {
                var to = adjToRaw != null ? adjToRaw[u] : graph.AdjTo[u];
                var kinds = adjKindRaw != null ? adjKindRaw[u] : graph.AdjKind[u];
                var srvs = adjSrvRaw != null ? adjSrvRaw[u] : graph.AdjServer[u];
                var flags = new bool[to.Length];
                isPlain[u] = flags;
                bool uGate = srvAtNode[u] >= 0;
                if (uGate) continue;
                double uz = graph.NodeZ[u];
                for (int e = 0; e < to.Length; e++) {
                    if (kinds[e] != (int)WalkEdgeKind.Walk || srvs[e] >= 0) continue;
                    int v = to[e];
                    if ((uint)v >= (uint)n || srvAtNode[v] >= 0) continue;
                    if (Math.Abs(graph.NodeZ[v] - uz) > 1e-9) continue;
                    if (HasReversePlainWalk(graph, u, v, adjToRaw, adjKindRaw, adjSrvRaw)) {
                        flags[e] = true;
                        plainCounts[u]++;
                        plainTotal++;
                    }
                }
            }

            for (int u = 0; u < n; u++) topo.PlainAdjStart[u + 1] = topo.PlainAdjStart[u] + plainCounts[u];
            topo.PlainAdjTo = new int[plainTotal];
            topo.PlainAdjCostMs = new int[plainTotal];
            var cursor = new int[n];
            Array.Copy(topo.PlainAdjStart, cursor, n);
            for (int u = 0; u < n; u++) {
                var to = adjToRaw != null ? adjToRaw[u] : graph.AdjTo[u];
                var costs = adjCostRaw != null ? adjCostRaw[u] : graph.AdjCost[u];
                var flags = isPlain[u];
                for (int e = 0; e < to.Length; e++) {
                    if (!flags[e]) continue;
                    int k = cursor[u]++;
                    topo.PlainAdjTo[k] = to[e];
                    topo.PlainAdjCostMs[k] = StationSparsePolicy.ToMs(costs[e]);
                }
            }

            // Index lift links by source node so signatures and explicit arcs include them cleanly.
            Dictionary<int, List<StationSparseLiftLink>> liftsByFrom = null;
            if (liftLinks != null && liftLinks.Count > 0) {
                liftsByFrom = new Dictionary<int, List<StationSparseLiftLink>>();
                for (int i = 0; i < liftLinks.Count; i++) {
                    var link = liftLinks[i];
                    if ((uint)link.FromNode >= (uint)n || (uint)link.ToNode >= (uint)n) continue;
                    if (!liftsByFrom.TryGetValue(link.FromNode, out var list)) {
                        list = new List<StationSparseLiftLink>();
                        liftsByFrom[link.FromNode] = list;
                    }
                    list.Add(link);
                }
            }

            // 3. Build sectors, signatures, and connected regions per sector in stable order.
            var sortedSectorKeys = new List<long>(sectorNodes.Keys);
            sortedSectorKeys.Sort();
            var visited = new bool[n];
            var bfs = new List<int>(256);
            var sigEdges = new List<SigEdge>(16);

            for (int si = 0; si < sortedSectorKeys.Count; si++) {
                long sk = sortedSectorKeys[si];
                var nodes = sectorNodes[sk];
                nodes.Sort((a, b) => topo.NodeTileKey[a].CompareTo(topo.NodeTileKey[b]));
                StationSparsePolicy.UnpackSectorKey(sk, out int sx, out int sy, out int tz2);

                uint sig = StationSparsePolicy.Hash32Init(0x5e4701);
                sig = StationSparsePolicy.Hash32Mix(sig, sx);
                sig = StationSparsePolicy.Hash32Mix(sig, sy);
                sig = StationSparsePolicy.Hash32Mix(sig, tz2);
                sig = StationSparsePolicy.Hash32Mix(sig, nodes.Count);

                for (int i = 0; i < nodes.Count; i++) {
                    int u = nodes[i];
                    sig = StationSparsePolicy.Hash32Mix(sig, topo.NodeTx[u]);
                    sig = StationSparsePolicy.Hash32Mix(sig, topo.NodeTy[u]);
                    sig = StationSparsePolicy.Hash32Mix(sig, (int)Math.Floor(graph.NodeSpeed[u] * 1000.0 + 0.5));
                    sig = StationSparsePolicy.Hash32Mix(sig, graph.NodeZone[u]);
                    int gSrv = srvAtNode[u];
                    sig = StationSparsePolicy.Hash32Mix(sig, gSrv >= 0 ? (graph.Servers[gSrv].GateMode + 2) : 0);

                    sigEdges.Clear();
                    var to = adjToRaw != null ? adjToRaw[u] : graph.AdjTo[u];
                    var costs = adjCostRaw != null ? adjCostRaw[u] : graph.AdjCost[u];
                    var kinds = adjKindRaw != null ? adjKindRaw[u] : graph.AdjKind[u];
                    var srvs = adjSrvRaw != null ? adjSrvRaw[u] : graph.AdjServer[u];
                    var flags = isPlain[u];
                    for (int e = 0; e < to.Length; e++) {
                        int v = to[e];
                        if ((uint)v >= (uint)n) continue;
                        int sv = srvs[e];
                        int srvKind = sv >= 0 && sv < graph.Servers.Count ? ServerKindCode(graph.Servers[sv].Kind) : 0;
                        sigEdges.Add(new SigEdge {
                            ToKey = topo.NodeTileKey[v],
                            Kind = kinds[e],
                            CostMs = StationSparsePolicy.ToMs(costs[e]),
                            Plain = flags[e] ? 1 : 0,
                            SrvKind = srvKind,
                        });
                    }
                    if (liftsByFrom != null && liftsByFrom.TryGetValue(u, out var uLifts)) {
                        for (int li = 0; li < uLifts.Count; li++) {
                            sigEdges.Add(new SigEdge {
                                ToKey = topo.NodeTileKey[uLifts[li].ToNode],
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

                var sector = new StationSparseSector {
                    SectorKey = sk,
                    Sx = sx,
                    Sy = sy,
                    Tz2 = tz2,
                    Revision = 1,
                    Signature = sig,
                };
                topo.Sectors[sk] = sector;

                // Flood-fill connected components within this sector using bidirectional plain walk edges.
                for (int i = 0; i < nodes.Count; i++) {
                    int start = nodes[i];
                    if (visited[start]) continue;
                    visited[start] = true;
                    bfs.Clear();
                    bfs.Add(start);
                    int head = 0;
                    while (head < bfs.Count) {
                        int cur = bfs[head++];
                        for (int e = topo.PlainAdjStart[cur]; e < topo.PlainAdjStart[cur + 1]; e++) {
                            int nb = topo.PlainAdjTo[e];
                            if (visited[nb] || nodeSector[nb] != sk) continue;
                            visited[nb] = true;
                            bfs.Add(nb);
                        }
                    }
                    bfs.Sort((a, b) => topo.NodeTileKey[a].CompareTo(topo.NodeTileKey[b]));
                    var regNodes = bfs.ToArray();
                    var regKeys = new long[regNodes.Length];
                    int regId = topo.Regions.Count;
                    double sumX = 0.0, sumY = 0.0, sumSpeed = 0.0;
                    for (int k = 0; k < regNodes.Length; k++) {
                        int u = regNodes[k];
                        regKeys[k] = topo.NodeTileKey[u];
                        topo.NodeRegion[u] = regId;
                        topo.NodeLocalIdx[u] = k;
                        sumX += topo.NodeTx[u];
                        sumY += topo.NodeTy[u];
                        sumSpeed += graph.NodeSpeed[u] > 0.0 ? graph.NodeSpeed[u] : 1.0;
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
                    topo.Regions.Add(region);
                    topo.RegionByKey[region.RegionKey] = region;
                    sector.RegionIds.Add(regId);
                }
            }

            // 4. Build crossings and explicit arcs per region.
            var rawPlain = new List<RawPlainEdge>();
            var rawExplicit = new List<RawExplicitEdge>();
            var cardinalGroups = new Dictionary<(int ToRegion, int Seam), List<RawPlainEdge>>();
            var diagEdges = new List<RawPlainEdge>();
            var ownerByFromTo = new Dictionary<(int FromNode, int ToRegion), List<RawPlainEdge>>();
            var pendingRuns = new List<(int ToRegion, List<RawPlainEdge> Cardinal, List<RawPlainEdge> All)>();

            for (int rId = 0; rId < topo.Regions.Count; rId++) {
                var region = topo.Regions[rId];
                rawPlain.Clear();
                rawExplicit.Clear();
                cardinalGroups.Clear();
                diagEdges.Clear();
                ownerByFromTo.Clear();
                pendingRuns.Clear();

                for (int i = 0; i < region.Nodes.Length; i++) {
                    int u = region.Nodes[i];
                    long uKey = region.TileKeys[i];
                    int ux = topo.NodeTx[u], uy = topo.NodeTy[u];
                    var to = adjToRaw != null ? adjToRaw[u] : graph.AdjTo[u];
                    var costs = adjCostRaw != null ? adjCostRaw[u] : graph.AdjCost[u];
                    var kinds = adjKindRaw != null ? adjKindRaw[u] : graph.AdjKind[u];
                    var srvs = adjSrvRaw != null ? adjSrvRaw[u] : graph.AdjServer[u];
                    var flags = isPlain[u];

                    for (int e = 0; e < to.Length; e++) {
                        int v = to[e];
                        if ((uint)v >= (uint)n) continue;
                        int vReg = topo.NodeRegion[v];
                        if (vReg < 0) continue;
                        if (flags[e]) {
                            if (vReg != rId) {
                                rawPlain.Add(new RawPlainEdge {
                                    FromNode = u, ToNode = v, FromKey = uKey, ToKey = topo.NodeTileKey[v],
                                    ToRegion = vReg, CostMs = StationSparsePolicy.ToMs(costs[e]),
                                    Dx = topo.NodeTx[v] - ux, Dy = topo.NodeTy[v] - uy,
                                });
                            }
                        } else {
                            var kind = (WalkEdgeKind)kinds[e];
                            int gateDir = 0;
                            if (kind == WalkEdgeKind.Walk && !CheckGatePassage(graph, srvAtNode, u, v, out gateDir)) continue;
                            int sv = srvs[e];
                            int flights = kind == WalkEdgeKind.Stair && sv >= 0 && sv < graph.Servers.Count && graph.Servers[sv].StairFlights > 1
                                ? graph.Servers[sv].StairFlights : 1;
                            rawExplicit.Add(new RawExplicitEdge {
                                FromNode = u, ToNode = v, FromKey = uKey, ToKey = topo.NodeTileKey[v],
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
                            int vReg = topo.NodeRegion[link.ToNode];
                            if (vReg < 0) continue;
                            rawExplicit.Add(new RawExplicitEdge {
                                FromNode = u, ToNode = link.ToNode, FromKey = uKey, ToKey = topo.NodeTileKey[link.ToNode],
                                ToRegion = vReg, Kind = WalkEdgeKind.Lift, Server = -1,
                                FromNodeServer = srvAtNode[u], ToNodeServer = srvAtNode[link.ToNode],
                                GateDir = 0, StairFlights = 1, LiftId = link.Id,
                                CostMs = link.CycleMs,
                            });
                        }
                    }
                }

                // Group plain crossings by (toRegion, faceSeam) and split contiguous runs.
                for (int i = 0; i < rawPlain.Count; i++) {
                    var pe = rawPlain[i];
                    if (pe.Dx == 0 || pe.Dy == 0) {
                        int seam = pe.Dx > 0 ? 0 : pe.Dx < 0 ? 1 : pe.Dy > 0 ? 2 : 3;
                        var gk = (pe.ToRegion, seam);
                        if (!cardinalGroups.TryGetValue(gk, out var list)) {
                            list = new List<RawPlainEdge>();
                            cardinalGroups[gk] = list;
                        }
                        list.Add(pe);
                    } else {
                        diagEdges.Add(pe);
                    }
                }

                var sortedGroups = new List<(int ToRegion, int Seam)>(cardinalGroups.Keys);
                sortedGroups.Sort((a, b) => {
                    int c = topo.Regions[a.ToRegion].RegionKey.CompareTo(topo.Regions[b.ToRegion].RegionKey);
                    return c != 0 ? c : a.Seam.CompareTo(b.Seam);
                });

                for (int gi = 0; gi < sortedGroups.Count; gi++) {
                    var gk = sortedGroups[gi];
                    var list = cardinalGroups[gk];
                    bool alongY = gk.Seam == 0 || gk.Seam == 1;
                    list.Sort((a, b) => {
                        int ca = alongY ? topo.NodeTy[a.FromNode] : topo.NodeTx[a.FromNode];
                        int cb = alongY ? topo.NodeTy[b.FromNode] : topo.NodeTx[b.FromNode];
                        int c = ca.CompareTo(cb);
                        if (c != 0) return c;
                        c = a.FromKey.CompareTo(b.FromKey);
                        return c != 0 ? c : a.ToKey.CompareTo(b.ToKey);
                    });

                    int runStart = 0;
                    for (int i = 1; i <= list.Count; i++) {
                        bool split = i == list.Count || (alongY
                            ? topo.NodeTy[list[i].FromNode] != topo.NodeTy[list[i - 1].FromNode] + 1
                            : topo.NodeTx[list[i].FromNode] != topo.NodeTx[list[i - 1].FromNode] + 1);
                        if (!split) continue;
                        var slice = list.GetRange(runStart, i - runStart);
                        var all = new List<RawPlainEdge>(slice);
                        pendingRuns.Add((gk.ToRegion, slice, all));
                        for (int k = 0; k < slice.Count; k++) ownerByFromTo[(slice[k].FromNode, gk.ToRegion)] = all;
                        runStart = i;
                    }
                }

                diagEdges.Sort((a, b) => {
                    int c = topo.Regions[a.ToRegion].RegionKey.CompareTo(topo.Regions[b.ToRegion].RegionKey);
                    if (c != 0) return c;
                    c = a.FromKey.CompareTo(b.FromKey);
                    return c != 0 ? c : a.ToKey.CompareTo(b.ToKey);
                });
                for (int i = 0; i < diagEdges.Count; i++) {
                    var de = diagEdges[i];
                    if (ownerByFromTo.TryGetValue((de.FromNode, de.ToRegion), out var owner)) {
                        owner.Add(de);
                    } else {
                        pendingRuns.Add((de.ToRegion, new List<RawPlainEdge> { de }, new List<RawPlainEdge> { de }));
                    }
                }

                for (int ri = 0; ri < pendingRuns.Count; ri++) {
                    var run = pendingRuns[ri];
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
                    var toReg = topo.Regions[run.ToRegion];
                    double fdx = region.CenterX - topo.NodeTx[rep.FromNode];
                    double fdy = region.CenterY - topo.NodeTy[rep.FromNode];
                    double tdx = toReg.CenterX - topo.NodeTx[rep.ToNode];
                    double tdy = toReg.CenterY - topo.NodeTy[rep.ToNode];
                    int fromHalf = (int)Math.Floor(Math.Sqrt(fdx * fdx + fdy * fdy) * region.WalkMsPerM + 0.5);
                    int toHalf = (int)Math.Floor(Math.Sqrt(tdx * tdx + tdy * tdy) * toReg.WalkMsPerM + 0.5);
                    var crossing = new StationSparseCrossing {
                        Id = topo.Crossings.Count,
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
                    topo.Crossings.Add(crossing);
                    region.Crossings.Add(crossing);
                    toReg.InCrossings.Add(crossing);
                }

                rawExplicit.Sort((a, b) => {
                    int c = a.FromKey.CompareTo(b.FromKey);
                    if (c != 0) return c;
                    c = a.ToKey.CompareTo(b.ToKey);
                    if (c != 0) return c;
                    c = ((int)a.Kind).CompareTo((int)b.Kind);
                    if (c != 0) return c;
                    c = a.Server.CompareTo(b.Server);
                    return c != 0 ? c : string.CompareOrdinal(a.LiftId ?? "", b.LiftId ?? "");
                });
                for (int i = 0; i < rawExplicit.Count; i++) {
                    var ex = rawExplicit[i];
                    var toReg = topo.Regions[ex.ToRegion];
                    double fdx = region.CenterX - topo.NodeTx[ex.FromNode];
                    double fdy = region.CenterY - topo.NodeTy[ex.FromNode];
                    double tdx = toReg.CenterX - topo.NodeTx[ex.ToNode];
                    double tdy = toReg.CenterY - topo.NodeTy[ex.ToNode];
                    int fromHalf = (int)Math.Floor(Math.Sqrt(fdx * fdx + fdy * fdy) * region.WalkMsPerM + 0.5);
                    int toHalf = (int)Math.Floor(Math.Sqrt(tdx * tdx + tdy * tdy) * toReg.WalkMsPerM + 0.5);
                    if (ex.Kind == WalkEdgeKind.Lift) topo.HasLifts = true;
                    var arc = new StationSparseExplicitArc {
                        Id = topo.ExplicitArcs.Count,
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
                    topo.ExplicitArcs.Add(arc);
                    region.ExplicitArcs.Add(arc);
                    toReg.InExplicitArcs.Add(arc);
                }
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
