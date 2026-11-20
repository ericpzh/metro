using System;
using System.Collections.Generic;

namespace Metro.Sim {
    /// <summary>
    /// Bounded simulation delta projected from a committed <c>StationIndexDelta</c> so
    /// <see cref="StationSimulationSession"/> updates cells, modules, walk graph and
    /// service facts without scanning the complete station.
    /// </summary>
    public sealed class StationSessionDelta {
        public readonly List<(int X, int Y, int Z)> RemovedCells = new List<(int X, int Y, int Z)>();
        public readonly List<StationCellFact> ChangedCells = new List<StationCellFact>();
        public readonly List<string> RemovedModules = new List<string>();
        public readonly List<StationModuleFact> ChangedModules = new List<StationModuleFact>();
        /// <summary>Optional canonical module list when <see cref="HasModuleChanges"/> is true (preserves exact index order across undo/redo).</summary>
        public List<StationModuleFact> OrderedModules;
        /// <summary>Optional canonical module ID order when <see cref="ChangedModules"/> is non-empty without an exit change, avoiding full ModuleFact re-projection.</summary>
        public string[] OrderedModuleIds;

        public bool HasModuleChanges => RemovedModules.Count > 0 || ChangedModules.Count > 0;
    }

    /// <summary>
    /// Reusable dense array buffer for <see cref="StationWalkGraphWorkspace.StageCellDelta"/>.
    /// Paired in a 2-slot ping-pong pool on <see cref="StationSimulationSession"/> so staging never
    /// mutates the active committed graph while reducing per-edit GC allocations from O(|V|) to O(|delta|).
    /// </summary>
    public sealed class StationWalkGraphScratchSlot {
        internal int Capacity;
        internal long[] NodeCoord = Array.Empty<long>();
        internal string[] NodeKey = Array.Empty<string>();
        internal double[] NodeX = Array.Empty<double>(), NodeY = Array.Empty<double>(), NodeZ = Array.Empty<double>(), NodeSpeed = Array.Empty<double>();
        internal int[] NodeZone = Array.Empty<int>();
        internal byte[] PlanarDegree = Array.Empty<byte>();
        internal int[][] AdjTo = Array.Empty<int[]>();
        internal double[][] AdjCost = Array.Empty<double[]>();
        internal int[][] AdjKind = Array.Empty<int[]>();
        internal int[][] AdjServer = Array.Empty<int[]>();
        internal int[] WalkComponent = Array.Empty<int>();
        internal int[] OldToNew = Array.Empty<int>();
        internal bool[] OldNodeTouched = Array.Empty<bool>();
        internal int[] NewToOld = Array.Empty<int>();

        internal void EnsureCapacity(int needed) {
            if (needed <= Capacity) return;
            int cap = Math.Max(needed + 256, Capacity + (Capacity >> 2) + 256);
            NodeCoord = new long[cap];
            NodeKey = new string[cap];
            NodeX = new double[cap];
            NodeY = new double[cap];
            NodeZ = new double[cap];
            NodeSpeed = new double[cap];
            NodeZone = new int[cap];
            PlanarDegree = new byte[cap];
            AdjTo = new int[cap][];
            AdjCost = new double[cap][];
            AdjKind = new int[cap][];
            AdjServer = new int[cap][];
            WalkComponent = new int[cap];
            OldToNew = new int[cap];
            OldNodeTouched = new bool[cap];
            NewToOld = new int[cap];
            Capacity = cap;
        }
    }

    internal sealed class StationWalkGraphScratchPool {
        readonly StationWalkGraphScratchSlot slot0 = new StationWalkGraphScratchSlot();
        readonly StationWalkGraphScratchSlot slot1 = new StationWalkGraphScratchSlot();
        int activeIndex;

        public void Preallocate(int nodeCount) {
            if (nodeCount <= 0) return;
            slot0.EnsureCapacity(nodeCount + 256);
            slot1.EnsureCapacity(nodeCount + 256);
        }

        public StationWalkGraphScratchSlot StagingSlot => activeIndex == 0 ? slot1 : slot0;

        public void CommitSwap() => activeIndex ^= 1;
    }

    /// <summary>
    /// Exact node/edge mapping between the previous <see cref="StationWalkGraph"/> and
    /// the staged next <see cref="StationWalkGraph"/> for selective passenger and queue
    /// reconciliation.
    /// </summary>
    public sealed class StationWalkGraphDelta {
        /// <summary>Maps old node id <c>[0..OldNodeCount-1]</c> to new node id, or <c>-1</c> if removed.</summary>
        public int[] OldToNewNode = Array.Empty<int>();
        /// <summary>True when old node id was removed or had its speed, zone, server or outgoing edges modified.</summary>
        public bool[] OldNodeTouched = Array.Empty<bool>();
        public int OldNodeCount;
        public int RebuiltNodeCount;
        public int RebuiltEdgeNodeCount;
        public bool AnyRoadAdded;
        public bool ConnectivityIncreased;
        public bool ModulesChanged;
    }

    /// <summary>
    /// Immutable sorted coordinate multiplicity table for O(1) min/max/level queries and
    /// O(|delta|) copy-on-write updates inside <c>Metro.Sim</c>.
    /// </summary>
    internal sealed class SimAxisCounter {
        public static readonly SimAxisCounter Empty = new SimAxisCounter(Array.Empty<int>(), Array.Empty<int>());

        readonly int[] values;
        readonly int[] counts;

        SimAxisCounter(int[] values, int[] counts) {
            this.values = values;
            this.counts = counts;
        }

        public bool IsEmpty => values.Length == 0;
        public int Min => values.Length > 0 ? values[0] : int.MaxValue;
        public int Max => values.Length > 0 ? values[values.Length - 1] : int.MinValue;
        public int[] ValuesArray => values;

        public static SimAxisCounter Build(Dictionary<int, int> acc) {
            if (acc == null || acc.Count == 0) return Empty;
            var keys = new int[acc.Count];
            int n = 0;
            foreach (var kv in acc) {
                if (kv.Value > 0) keys[n++] = kv.Key;
            }
            if (n == 0) return Empty;
            if (n < keys.Length) Array.Resize(ref keys, n);
            Array.Sort(keys);
            var vals = new int[n];
            for (int i = 0; i < n; i++) vals[i] = acc[keys[i]];
            return new SimAxisCounter(keys, vals);
        }

        public SimAxisCounter Apply(Dictionary<int, int> delta) {
            if (delta == null || delta.Count == 0) return this;
            var dKeys = new int[delta.Count];
            int dCount = 0;
            foreach (var kv in delta) {
                if (kv.Value != 0) dKeys[dCount++] = kv.Key;
            }
            if (dCount == 0) return this;
            if (dCount < dKeys.Length) Array.Resize(ref dKeys, dCount);
            Array.Sort(dKeys);

            var outKeys = new List<int>(values.Length + dCount);
            var outCounts = new List<int>(values.Length + dCount);
            int i = 0, j = 0;
            while (i < values.Length && j < dCount) {
                int a = values[i], b = dKeys[j];
                if (a < b) {
                    outKeys.Add(a);
                    outCounts.Add(counts[i]);
                    i++;
                } else if (b < a) {
                    int c = delta[b];
                    if (c > 0) { outKeys.Add(b); outCounts.Add(c); }
                    j++;
                } else {
                    int c = counts[i] + delta[b];
                    if (c > 0) { outKeys.Add(a); outCounts.Add(c); }
                    i++; j++;
                }
            }
            while (i < values.Length) {
                outKeys.Add(values[i]);
                outCounts.Add(counts[i]);
                i++;
            }
            while (j < dCount) {
                int b = dKeys[j++];
                int c = delta[b];
                if (c > 0) { outKeys.Add(b); outCounts.Add(c); }
            }
            return outKeys.Count == 0 ? Empty : new SimAxisCounter(outKeys.ToArray(), outCounts.ToArray());
        }
    }

    /// <summary>
    /// Retained copy-on-write walk-graph state enabling <c>StageCellDelta</c> to produce an
    /// exact <see cref="StationWalkGraph"/> in O(|delta|) without mutating the committed
    /// graph or scanning untouched station regions.
    /// </summary>
    public sealed class StationWalkGraphWorkspace {
        public const int ShardCount = 256;
        public const int ShardMask = ShardCount - 1;
        const int RampBucketShift = 3; // 8m x 8m spatial buckets for escalator/walkway balustrades

        internal struct StoredCell {
            public int X, Y, Z;
            public bool Solid;
            public int Zone;
            public double Speed;
        }

        internal struct RampWall {
            public double Ax, Ay, Bx, By, Z0, Z1;
        }

        internal sealed class ModuleContribution {
            public string Id;
            public StationModuleFact Fact;
            public long[] ObstacleCoords;
            public bool HasGateLane;
            public long GateCoord;
            public int GateRotation;
            public RampWall[] RampWalls;
            public string[] Unported;
            public bool IsServerOrPlatformOrExit;
            public int[] ContentXs;
            public int[] ContentYs;
        }

        public sealed class StagedResult {
            public StationWalkGraphWorkspace Workspace { get; }
            public StationWalkGraph Graph { get; }
            public StationWalkGraphDelta Delta { get; }

            internal StagedResult(StationWalkGraphWorkspace workspace, StationWalkGraph graph, StationWalkGraphDelta delta) {
                Workspace = workspace;
                Graph = graph;
                Delta = delta;
            }
        }

        // Immutable / copy-on-write state per committed workspace snapshot:
        StationWalkGraphOptions options;
        Dictionary<long, StoredCell>[] authoredShards;
        SimAxisCounter contentX;
        SimAxisCounter contentY;
        bool hasGroundWindow;
        int gx0, gx1, gy0, gy1;

        const int ModShardCount = 64;
        const int ModShardMask = ModShardCount - 1;
        [ThreadStatic]
        static int[] threadScratchNewToOld;

        // Module-derived state (shared by reference when delta has zero module changes, sharded when modules change):
        Dictionary<string, ModuleContribution>[] moduleShards;
        Dictionary<long, int>[] obstacleShards;
        Dictionary<long, List<(string Id, int Rotation)>> gateEntriesByCoord;
        Dictionary<long, int> gateRotations;
        Dictionary<long, List<RampWall>> rampWallGrid;
        bool hasAnyRampWalls;
        List<StationModuleFact> serverModules;
        string[] cachedUnported;

        static int ModuleShardOf(string id) =>
            (StringComparer.Ordinal.GetHashCode(id ?? "") & 0x7FFFFFFF) & ModShardMask;

        static int ObstacleShardOf(long packed) => ShardOf(packed) & ModShardMask;

        bool TryGetModuleContrib(string id, out ModuleContribution contrib) {
            if (!string.IsNullOrEmpty(id)) {
                return moduleShards[ModuleShardOf(id)].TryGetValue(id, out contrib);
            }
            contrib = null;
            return false;
        }

        bool HasObstacleAt(long pk) =>
            obstacleShards[ObstacleShardOf(pk)].TryGetValue(pk, out int obs) && obs > 0;

        // Dense node state (shared per-shard / per-node-edge-array where untouched):
        Dictionary<long, int>[] nodeShards;
        int nodeCount;
        long[] nodeCoord;
        string[] nodeKey;
        double[] nodeX, nodeY, nodeZ, nodeSpeed;
        int[] nodeZone;
        byte[] planarDegree;
        int[][] adjTo;
        double[][] adjCost;
        int[][] adjKind;
        int[][] adjServer;
        HashSet<int> nodesWithVerticalOut;

        SimAxisCounter nodeXCounter;
        SimAxisCounter nodeYCounter;
        SimAxisCounter levelZCounter;
        double stationArea;

        // Exact undirected Walk connected components:
        int[] walkComponent;
        Dictionary<int, int> walkCompSizes;
        int nextCompId;

        public StationWalkGraph Graph { get; private set; }

        StationWalkGraphWorkspace() { }

        public static long Pack3(int x, int y, int z) {
            long ux = (long)(x + 1048576) & 0x1FFFFFL;
            long uy = (long)(y + 1048576) & 0x1FFFFFL;
            long uz = (long)(z + 1048576) & 0x1FFFFFL;
            return (ux << 42) | (uy << 21) | uz;
        }

        public static void Unpack3(long packed, out int x, out int y, out int z) {
            x = (int)((packed >> 42) & 0x1FFFFFL) - 1048576;
            y = (int)((packed >> 21) & 0x1FFFFFL) - 1048576;
            z = (int)(packed & 0x1FFFFFL) - 1048576;
        }

        public static int ShardOf(long packed) {
            ulong h = (ulong)packed;
            h ^= h >> 33;
            h *= 0xff51afd7ed558ccdUL;
            h ^= h >> 33;
            return (int)(h & ShardMask);
        }

        static long PackBucket2(int bx, int by) => ((long)bx << 32) ^ (uint)by;

        static readonly (int dx, int dy)[] Cardinal = { (1, 0), (-1, 0), (0, 1), (0, -1) };
        static readonly (int dx, int dy)[] Diagonal = { (1, 1), (1, -1), (-1, 1), (-1, -1) };

        public List<StationCellFact> ExportAuthoredCells() {
            int total = 0;
            for (int s = 0; s < ShardCount; s++) total += authoredShards[s].Count;
            var list = new List<StationCellFact>(total);
            for (int s = 0; s < ShardCount; s++) {
                foreach (var kv in authoredShards[s]) {
                    var c = kv.Value;
                    list.Add(new StationCellFact { X = c.X, Y = c.Y, Z = c.Z, Solid = c.Solid, Zone = c.Zone, Speed = c.Speed });
                }
            }
            return list;
        }

        // --------------------------------------------------------------- full build

        public static StationWalkGraphWorkspace Build(StationSessionDocument document, StationWalkGraphOptions opts = null) {
            if (document == null) throw new ArgumentNullException(nameof(document));
            opts = CloneOptions(opts);
            var ws = new StationWalkGraphWorkspace { options = opts };

            ws.authoredShards = new Dictionary<long, StoredCell>[ShardCount];
            for (int s = 0; s < ShardCount; s++) ws.authoredShards[s] = new Dictionary<long, StoredCell>();

            var cxAcc = new Dictionary<int, int>();
            var cyAcc = new Dictionary<int, int>();
            void AddContentXY(int x, int y) {
                cxAcc[x] = cxAcc.TryGetValue(x, out int cx) ? cx + 1 : 1;
                cyAcc[y] = cyAcc.TryGetValue(y, out int cy) ? cy + 1 : 1;
            }

            var cells = document.EnsureCells();
            var authoredOrder = new List<StoredCell>(cells.Count);
            var authoredGrade2D = new HashSet<long>();
            for (int i = 0; i < cells.Count; i++) {
                var cell = cells[i];
                double spd = double.IsNaN(cell.Speed) ? opts.UnknownFloorSpeed : cell.Speed;
                var sc = new StoredCell { X = cell.X, Y = cell.Y, Z = cell.Z, Solid = cell.Solid, Zone = cell.Zone, Speed = spd };
                authoredOrder.Add(sc);
                AddContentXY(cell.X, cell.Y);
                if (cell.Z == StationWalkGraphBuilder.GroundZ) {
                    authoredGrade2D.Add(PackBucket2(cell.X, cell.Y));
                }
                long pk = Pack3(cell.X, cell.Y, cell.Z);
                int sh = ShardOf(pk);
                if (!ws.authoredShards[sh].TryGetValue(pk, out var prev)) {
                    ws.authoredShards[sh][pk] = sc;
                } else {
                    bool mergedSolid = prev.Solid || sc.Solid;
                    bool keepPrev = prev.Solid && prev.Speed > 0;
                    ws.authoredShards[sh][pk] = new StoredCell {
                        X = sc.X, Y = sc.Y, Z = sc.Z,
                        Solid = mergedSolid,
                        Zone = keepPrev ? prev.Zone : sc.Zone,
                        Speed = keepPrev ? prev.Speed : sc.Speed,
                    };
                }
            }

            // Build module contributions in exact document order:
            ws.moduleShards = new Dictionary<string, ModuleContribution>[ModShardCount];
            ws.obstacleShards = new Dictionary<long, int>[ModShardCount];
            for (int s = 0; s < ModShardCount; s++) {
                ws.moduleShards[s] = new Dictionary<string, ModuleContribution>(StringComparer.Ordinal);
                ws.obstacleShards[s] = new Dictionary<long, int>();
            }
            ws.gateEntriesByCoord = new Dictionary<long, List<(string Id, int Rotation)>>();
            ws.gateRotations = new Dictionary<long, int>();
            ws.rampWallGrid = new Dictionary<long, List<RampWall>>();
            ws.serverModules = new List<StationModuleFact>();
            var unportedList = new List<string>();

            for (int i = 0; i < document.Modules.Count; i++) {
                var mod = document.Modules[i];
                var contrib = BuildModuleContribution(mod, i);
                string keyId = contrib.Id;
                ws.moduleShards[ModuleShardOf(keyId)][keyId] = contrib;
                for (int k = 0; k < contrib.ContentXs.Length; k++) {
                    AddContentXY(contrib.ContentXs[k], contrib.ContentYs[k]);
                }
                ApplyModuleContributionToShards(contrib, ws.obstacleShards, null, ws.gateEntriesByCoord, ws.gateRotations, ws.rampWallGrid);
                if (contrib.RampWalls != null && contrib.RampWalls.Length > 0) ws.hasAnyRampWalls = true;
                if (contrib.IsServerOrPlatformOrExit) ws.serverModules.Add(mod);
                if (contrib.Unported != null) {
                    for (int u = 0; u < contrib.Unported.Length; u++) unportedList.Add(contrib.Unported[u]);
                }
            }
            ws.cachedUnported = unportedList.ToArray();

            ws.contentX = SimAxisCounter.Build(cxAcc);
            ws.contentY = SimAxisCounter.Build(cyAcc);
            ws.ComputeGroundWindow(out ws.hasGroundWindow, out ws.gx0, out ws.gx1, out ws.gy0, out ws.gy1);

            // Build nodes in exact reference order (authored cells first, then generated street x -> y):
            ws.nodeShards = new Dictionary<long, int>[ShardCount];
            for (int s = 0; s < ShardCount; s++) ws.nodeShards[s] = new Dictionary<long, int>();

            int estNodes = authoredOrder.Count + (ws.hasGroundWindow ? Math.Max(0, (ws.gx1 - ws.gx0 + 1) * (ws.gy1 - ws.gy0 + 1)) : 0);
            var coords = new List<long>(Math.Min(estNodes, 200000));
            var keys = new List<string>(coords.Capacity);
            var xs = new List<double>(coords.Capacity);
            var ys = new List<double>(coords.Capacity);
            var zs = new List<double>(coords.Capacity);
            var speeds = new List<double>(coords.Capacity);
            var zones = new List<int>(coords.Capacity);

            var nxAcc = new Dictionary<int, int>();
            var nyAcc = new Dictionary<int, int>();
            var lzAcc = new Dictionary<int, int>();
            double area = 0;

            void TryEmitNode(int x, int y, int z, int zone, double speed) {
                if (speed <= 0) return;
                if (ws.IsEffectiveSolid(x, y, z + 1)) return;
                long pk = Pack3(x, y, z);
                int sh = ShardOf(pk);
                if (ws.nodeShards[sh].ContainsKey(pk)) return;
                if (ws.HasObstacleAt(pk)) return;
                int id = coords.Count;
                ws.nodeShards[sh][pk] = id;
                coords.Add(pk);
                keys.Add(StationWalkGraph.CellKey(x, y, z));
                xs.Add(x + 0.5);
                ys.Add(y + 0.5);
                zs.Add(z + 1);
                speeds.Add(speed);
                zones.Add(zone);
                if (zone != StationWalkGraphBuilder.ZoneOutside) area++;
                nxAcc[x] = nxAcc.TryGetValue(x, out int cnx) ? cnx + 1 : 1;
                nyAcc[y] = nyAcc.TryGetValue(y, out int cny) ? cny + 1 : 1;
                lzAcc[z] = lzAcc.TryGetValue(z, out int clz) ? clz + 1 : 1;
            }

            for (int i = 0; i < authoredOrder.Count; i++) {
                var c = authoredOrder[i];
                if (!c.Solid) continue;
                TryEmitNode(c.X, c.Y, c.Z, c.Zone, c.Speed);
            }
            if (ws.hasGroundWindow) {
                for (int x = ws.gx0; x <= ws.gx1; x++) {
                    for (int y = ws.gy0; y <= ws.gy1; y++) {
                        if (authoredGrade2D.Contains(PackBucket2(x, y))) continue;
                        TryEmitNode(x, y, StationWalkGraphBuilder.GroundZ, StationWalkGraphBuilder.ZoneOutside, opts.UnknownFloorSpeed);
                    }
                }
            }

            ws.nodeCount = coords.Count;
            ws.nodeCoord = coords.ToArray();
            ws.nodeKey = keys.ToArray();
            ws.nodeX = xs.ToArray();
            ws.nodeY = ys.ToArray();
            ws.nodeZ = zs.ToArray();
            ws.nodeSpeed = speeds.ToArray();
            ws.nodeZone = zones.ToArray();
            ws.stationArea = area;
            ws.nodeXCounter = SimAxisCounter.Build(nxAcc);
            ws.nodeYCounter = SimAxisCounter.Build(nyAcc);
            ws.levelZCounter = SimAxisCounter.Build(lzAcc);

            ws.planarDegree = new byte[ws.nodeCount];
            ws.adjTo = new int[ws.nodeCount][];
            ws.adjCost = new double[ws.nodeCount][];
            ws.adjKind = new int[ws.nodeCount][];
            ws.adjServer = new int[ws.nodeCount][];
            ws.nodesWithVerticalOut = new HashSet<int>();

            // Planar edges for all nodes:
            var scratchTo = new List<int>(12);
            var scratchCost = new List<double>(12);
            var scratchKind = new List<int>(12);
            var scratchSrv = new List<int>(12);
            for (int i = 0; i < ws.nodeCount; i++) {
                ws.BuildPlanarEdgesForNode(i, scratchTo, scratchCost, scratchKind, scratchSrv);
                ws.planarDegree[i] = (byte)scratchTo.Count;
                ws.adjTo[i] = scratchTo.Count == 0 ? Array.Empty<int>() : scratchTo.ToArray();
                ws.adjCost[i] = scratchCost.Count == 0 ? Array.Empty<double>() : scratchCost.ToArray();
                ws.adjKind[i] = scratchKind.Count == 0 ? Array.Empty<int>() : scratchKind.ToArray();
                ws.adjServer[i] = scratchSrv.Count == 0 ? Array.Empty<int>() : scratchSrv.ToArray();
            }

            // Build WalkGraph shell + vertical edges + servers + components + condensation:
            var graph = ws.CreateGraphInstance();
            ws.BuildInitialWalkComponents();
            ws.PopulateGraphReachability(graph);
            ws.Graph = graph;
            return ws;
        }

        // ------------------------------------------------------------- stage delta

        public StagedResult StageCellDelta(
            StationSessionDocument nextDocument,
            StationSessionDelta delta,
            StationWalkGraphScratchSlot scratchSlot = null) {
            if (nextDocument == null) throw new ArgumentNullException(nameof(nextDocument));
            if (delta == null) throw new ArgumentNullException(nameof(delta));

            var next = new StationWalkGraphWorkspace {
                options = options,
                stationArea = stationArea,
                nextCompId = nextCompId,
            };

            // 1. Copy-on-write authored cell shards & content X/Y counters:
            next.authoredShards = (Dictionary<long, StoredCell>[])authoredShards.Clone();
            var clonedAuthoredShard = new bool[ShardCount];
            Dictionary<long, StoredCell> WritableAuthoredShard(int sh) {
                if (!clonedAuthoredShard[sh]) {
                    next.authoredShards[sh] = new Dictionary<long, StoredCell>(authoredShards[sh]);
                    clonedAuthoredShard[sh] = true;
                }
                return next.authoredShards[sh];
            }

            var cxDelta = new Dictionary<int, int>();
            var cyDelta = new Dictionary<int, int>();
            void NoteContentDelta(int x, int y, int d) {
                if (d == 0) return;
                cxDelta[x] = (cxDelta.TryGetValue(x, out int vx) ? vx : 0) + d;
                cyDelta[y] = (cyDelta.TryGetValue(y, out int vy) ? vy : 0) + d;
            }

            var dirtyCellCoords = new HashSet<long>();
            for (int i = 0; i < delta.RemovedCells.Count; i++) {
                var rc = delta.RemovedCells[i];
                long pk = Pack3(rc.X, rc.Y, rc.Z);
                int sh = ShardOf(pk);
                if (authoredShards[sh].ContainsKey(pk) || (clonedAuthoredShard[sh] && next.authoredShards[sh].ContainsKey(pk))) {
                    if (WritableAuthoredShard(sh).Remove(pk)) {
                        NoteContentDelta(rc.X, rc.Y, -1);
                        dirtyCellCoords.Add(pk);
                    }
                }
            }
            for (int i = 0; i < delta.ChangedCells.Count; i++) {
                var cc = delta.ChangedCells[i];
                double spd = double.IsNaN(cc.Speed) ? options.UnknownFloorSpeed : cc.Speed;
                long pk = Pack3(cc.X, cc.Y, cc.Z);
                int sh = ShardOf(pk);
                var shard = WritableAuthoredShard(sh);
                bool existed = shard.ContainsKey(pk);
                shard[pk] = new StoredCell { X = cc.X, Y = cc.Y, Z = cc.Z, Solid = cc.Solid, Zone = cc.Zone, Speed = spd };
                if (!existed) NoteContentDelta(cc.X, cc.Y, 1);
                dirtyCellCoords.Add(pk);
            }

            // 2. Module contributions (zero copy when pure cell edit; sharded copy-on-write when modules change):
            bool anyRoadAdded = false;
            bool rampWallsChanged = false;
            bool serverModulesChanged = false;
            bool obstacleRemoved = false;
            bool unportedChanged = false;
            HashSet<string> removedUnportedStrings = null;
            var changedRampBuckets = new HashSet<long>();
            if (!delta.HasModuleChanges) {
                next.moduleShards = moduleShards;
                next.obstacleShards = obstacleShards;
                next.gateEntriesByCoord = gateEntriesByCoord;
                next.gateRotations = gateRotations;
                next.rampWallGrid = rampWallGrid;
                next.hasAnyRampWalls = hasAnyRampWalls;
                next.serverModules = serverModules;
                next.cachedUnported = cachedUnported;
            } else {
                next.moduleShards = (Dictionary<string, ModuleContribution>[])moduleShards.Clone();
                var clonedModShard = new bool[ModShardCount];
                Dictionary<string, ModuleContribution> WritableModShard(int sh) {
                    if (!clonedModShard[sh]) {
                        next.moduleShards[sh] = new Dictionary<string, ModuleContribution>(moduleShards[sh], StringComparer.Ordinal);
                        clonedModShard[sh] = true;
                    }
                    return next.moduleShards[sh];
                }

                next.obstacleShards = (Dictionary<long, int>[])obstacleShards.Clone();
                var clonedObsShard = new bool[ModShardCount];
                Func<int, Dictionary<long, int>> writableObsShard = sh => {
                    if (!clonedObsShard[sh]) {
                        next.obstacleShards[sh] = new Dictionary<long, int>(obstacleShards[sh]);
                        clonedObsShard[sh] = true;
                    }
                    return next.obstacleShards[sh];
                };

                bool gatesCloned = false;
                next.gateEntriesByCoord = gateEntriesByCoord;
                next.gateRotations = gateRotations;
                void EnsureGatesWritable() {
                    if (gatesCloned) return;
                    gatesCloned = true;
                    next.gateEntriesByCoord = new Dictionary<long, List<(string Id, int Rotation)>>(gateEntriesByCoord.Count);
                    foreach (var kv in gateEntriesByCoord) next.gateEntriesByCoord[kv.Key] = new List<(string Id, int Rotation)>(kv.Value);
                    next.gateRotations = new Dictionary<long, int>(gateRotations);
                }

                for (int i = 0; i < delta.RemovedModules.Count; i++) {
                    string rmId = delta.RemovedModules[i];
                    if (!string.IsNullOrEmpty(rmId) && next.TryGetModuleContrib(rmId, out var oldC)) {
                        WritableModShard(ModuleShardOf(rmId)).Remove(rmId);
                        if (oldC.IsServerOrPlatformOrExit) serverModulesChanged = true;
                        if (oldC.ObstacleCoords != null && oldC.ObstacleCoords.Length > 0) obstacleRemoved = true;
                        if (oldC.HasGateLane) EnsureGatesWritable();
                        if (oldC.Unported != null && oldC.Unported.Length > 0) {
                            unportedChanged = true;
                            removedUnportedStrings ??= new HashSet<string>(StringComparer.Ordinal);
                            for (int u = 0; u < oldC.Unported.Length; u++) removedUnportedStrings.Add(oldC.Unported[u]);
                        }
                        RemoveModuleContributionFromShards(oldC, writableObsShard, next.gateEntriesByCoord, next.gateRotations, dirtyCellCoords);
                        for (int k = 0; k < oldC.ContentXs.Length; k++) NoteContentDelta(oldC.ContentXs[k], oldC.ContentYs[k], -1);
                        if (oldC.RampWalls != null && oldC.RampWalls.Length > 0) {
                            rampWallsChanged = true;
                            obstacleRemoved = true;
                            CollectRampWallBuckets(oldC.RampWalls, changedRampBuckets);
                        }
                    }
                }
                for (int i = 0; i < delta.ChangedModules.Count; i++) {
                    var mod = delta.ChangedModules[i];
                    string modId = mod.Id ?? "";
                    if (mod.Type == "road") anyRoadAdded = true;
                    if (next.TryGetModuleContrib(modId, out var oldC)) {
                        if (oldC.IsServerOrPlatformOrExit) serverModulesChanged = true;
                        if (oldC.ObstacleCoords != null && oldC.ObstacleCoords.Length > 0) obstacleRemoved = true;
                        if (oldC.HasGateLane) EnsureGatesWritable();
                        if (oldC.Unported != null && oldC.Unported.Length > 0) unportedChanged = true;
                        RemoveModuleContributionFromShards(oldC, writableObsShard, next.gateEntriesByCoord, next.gateRotations, dirtyCellCoords);
                        for (int k = 0; k < oldC.ContentXs.Length; k++) NoteContentDelta(oldC.ContentXs[k], oldC.ContentYs[k], -1);
                        if (oldC.RampWalls != null && oldC.RampWalls.Length > 0) {
                            rampWallsChanged = true;
                            obstacleRemoved = true;
                            CollectRampWallBuckets(oldC.RampWalls, changedRampBuckets);
                        }
                    }
                    var newC = BuildModuleContribution(mod, i);
                    if (newC.IsServerOrPlatformOrExit) serverModulesChanged = true;
                    if (newC.HasGateLane) EnsureGatesWritable();
                    if (newC.Unported != null && newC.Unported.Length > 0) unportedChanged = true;
                    WritableModShard(ModuleShardOf(modId))[modId] = newC;
                    ApplyModuleContributionToShards(newC, next.obstacleShards, writableObsShard, next.gateEntriesByCoord, next.gateRotations, null, dirtyCellCoords);
                    for (int k = 0; k < newC.ContentXs.Length; k++) NoteContentDelta(newC.ContentXs[k], newC.ContentYs[k], 1);
                    if (newC.RampWalls != null && newC.RampWalls.Length > 0) {
                        rampWallsChanged = true;
                        CollectRampWallBuckets(newC.RampWalls, changedRampBuckets);
                    }
                }

                if (!rampWallsChanged && !serverModulesChanged && !unportedChanged) {
                    next.rampWallGrid = rampWallGrid;
                    next.hasAnyRampWalls = hasAnyRampWalls;
                    next.serverModules = serverModules;
                    next.cachedUnported = cachedUnported;
                } else if (!rampWallsChanged && !serverModulesChanged && delta.ChangedModules.Count == 0 && removedUnportedStrings != null) {
                    // Pure removal of non-server, non-ramp modules (e.g. floor delete cascading a bench): O(|cachedUnported|)!
                    next.rampWallGrid = rampWallGrid;
                    next.hasAnyRampWalls = hasAnyRampWalls;
                    next.serverModules = serverModules;
                    var filteredUnported = new List<string>(cachedUnported.Length);
                    for (int u = 0; u < cachedUnported.Length; u++) {
                        if (!removedUnportedStrings.Contains(cachedUnported[u])) filteredUnported.Add(cachedUnported[u]);
                    }
                    next.cachedUnported = filteredUnported.ToArray();
                } else {
                    next.rampWallGrid = rampWallsChanged ? new Dictionary<long, List<RampWall>>() : rampWallGrid;
                    next.serverModules = serverModulesChanged
                        ? new List<StationModuleFact>(serverModules.Count + delta.ChangedModules.Count)
                        : serverModules;
                    var unportedList = unportedChanged ? new List<string>(cachedUnported.Length + 4) : null;
                    bool anyRamp = hasAnyRampWalls && !rampWallsChanged;
                    for (int i = 0; i < nextDocument.Modules.Count; i++) {
                        var mod = nextDocument.Modules[i];
                        ModuleContribution c;
                        if (string.IsNullOrEmpty(mod.Id) || !next.TryGetModuleContrib(mod.Id, out c)) {
                            c = BuildModuleContribution(mod, i);
                        }
                        if (rampWallsChanged && c.RampWalls != null && c.RampWalls.Length > 0) {
                            anyRamp = true;
                            AddRampWallsToGrid(c.RampWalls, next.rampWallGrid);
                        }
                        if (serverModulesChanged && c.IsServerOrPlatformOrExit) next.serverModules.Add(mod);
                        if (unportedChanged && c.Unported != null) {
                            for (int u = 0; u < c.Unported.Length; u++) unportedList.Add(c.Unported[u]);
                        }
                    }
                    next.hasAnyRampWalls = anyRamp;
                    next.cachedUnported = unportedChanged ? unportedList.ToArray() : cachedUnported;
                }
            }

            next.contentX = contentX.Apply(cxDelta);
            next.contentY = contentY.Apply(cyDelta);
            next.ComputeGroundWindow(out next.hasGroundWindow, out next.gx0, out next.gx1, out next.gy0, out next.gy1);

            // If virtual street window expanded/shrunk at the station perimeter, add symmetric difference:
            if (hasGroundWindow != next.hasGroundWindow ||
                gx0 != next.gx0 || gx1 != next.gx1 || gy0 != next.gy0 || gy1 != next.gy1) {
                CollectGroundWindowDiff(
                    hasGroundWindow, gx0, gx1, gy0, gy1,
                    next.hasGroundWindow, next.gx0, next.gx1, next.gy0, next.gy1,
                    dirtyCellCoords);
            }

            // 3. Expand candidate node coordinates: every dirty cell (x,y,z) and (x,y,z-1) underneath it:
            var candidateCoords = new List<long>(dirtyCellCoords.Count * 2);
            var candidateSet = new HashSet<long>();
            foreach (long pk in dirtyCellCoords) {
                if (candidateSet.Add(pk)) candidateCoords.Add(pk);
                Unpack3(pk, out int x, out int y, out int z);
                long below = Pack3(x, y, z - 1);
                if (candidateSet.Add(below)) candidateCoords.Add(below);
            }
            candidateCoords.Sort();

            // 4. Copy-on-write node arrays and shards (using reusable ping-pong scratchSlot when supplied):
            int oldCount = nodeCount;

            next.nodeShards = (Dictionary<long, int>[])nodeShards.Clone();
            var clonedNodeShard = new bool[ShardCount];
            Dictionary<long, int> WritableNodeShard(int sh) {
                if (!clonedNodeShard[sh]) {
                    next.nodeShards[sh] = new Dictionary<long, int>(nodeShards[sh]);
                    clonedNodeShard[sh] = true;
                }
                return next.nodeShards[sh];
            }

            var toRemoveCoords = new List<long>();
            var toAddNodes = new List<(long Coord, int X, int Y, int Z, int Zone, double Speed)>();
            var toUpdateAttrs = new List<(int CurrentSlot, long Coord, int Zone, double Speed)>();

            for (int i = 0; i < candidateCoords.Count; i++) {
                long pk = candidateCoords[i];
                Unpack3(pk, out int x, out int y, out int z);
                bool wasNode = nodeShards[ShardOf(pk)].TryGetValue(pk, out int existingSlot);
                bool willBeNode = next.EvaluateWalkable(x, y, z, out int newZone, out double newSpeed);
                if (wasNode && !willBeNode) {
                    toRemoveCoords.Add(pk);
                } else if (!wasNode && willBeNode) {
                    toAddNodes.Add((pk, x, y, z, newZone, newSpeed));
                } else if (wasNode && willBeNode) {
                    if (nodeZone[existingSlot] != newZone || Math.Abs(nodeSpeed[existingSlot] - newSpeed) > 1e-12) {
                        toUpdateAttrs.Add((existingSlot, pk, newZone, newSpeed));
                    }
                }
            }

            int maxCap = oldCount - toRemoveCoords.Count + toAddNodes.Count;
            if (maxCap < 0) maxCap = 0;
            int copyCap = Math.Max(oldCount, maxCap);

            int[] oldToNew;
            bool[] oldNodeTouched;
            int[] newToOld;
            if (scratchSlot != null) {
                scratchSlot.EnsureCapacity(copyCap);
                oldToNew = scratchSlot.OldToNew;
                oldNodeTouched = scratchSlot.OldNodeTouched;
                if (oldCount > 0) Array.Clear(oldNodeTouched, 0, oldCount);
                newToOld = scratchSlot.NewToOld;
                next.nodeCoord = scratchSlot.NodeCoord;
                next.nodeKey = scratchSlot.NodeKey;
                next.nodeX = scratchSlot.NodeX;
                next.nodeY = scratchSlot.NodeY;
                next.nodeZ = scratchSlot.NodeZ;
                next.nodeSpeed = scratchSlot.NodeSpeed;
                next.nodeZone = scratchSlot.NodeZone;
                next.planarDegree = scratchSlot.PlanarDegree;
                next.adjTo = scratchSlot.AdjTo;
                next.adjCost = scratchSlot.AdjCost;
                next.adjKind = scratchSlot.AdjKind;
                next.adjServer = scratchSlot.AdjServer;
                next.walkComponent = scratchSlot.WalkComponent;
            } else {
                oldToNew = new int[oldCount];
                oldNodeTouched = new bool[oldCount];
                if (threadScratchNewToOld == null || threadScratchNewToOld.Length < copyCap) {
                    threadScratchNewToOld = new int[Math.Max(copyCap + 256, 1024)];
                }
                newToOld = threadScratchNewToOld;
                next.nodeCoord = new long[copyCap];
                next.nodeKey = new string[copyCap];
                next.nodeX = new double[copyCap];
                next.nodeY = new double[copyCap];
                next.nodeZ = new double[copyCap];
                next.nodeSpeed = new double[copyCap];
                next.nodeZone = new int[copyCap];
                next.planarDegree = new byte[copyCap];
                next.adjTo = new int[copyCap][];
                next.adjCost = new double[copyCap][];
                next.adjKind = new int[copyCap][];
                next.adjServer = new int[copyCap][];
                next.walkComponent = new int[copyCap];
            }
            for (int i = 0; i < oldCount; i++) {
                oldToNew[i] = i;
                newToOld[i] = i;
            }

            if (oldCount > 0) {
                Array.Copy(nodeCoord, next.nodeCoord, oldCount);
                Array.Copy(nodeKey, next.nodeKey, oldCount);
                Array.Copy(nodeX, next.nodeX, oldCount);
                Array.Copy(nodeY, next.nodeY, oldCount);
                Array.Copy(nodeZ, next.nodeZ, oldCount);
                Array.Copy(nodeSpeed, next.nodeSpeed, oldCount);
                Array.Copy(nodeZone, next.nodeZone, oldCount);
                Array.Copy(planarDegree, next.planarDegree, oldCount);
                Array.Copy(adjTo, next.adjTo, oldCount);
                Array.Copy(adjCost, next.adjCost, oldCount);
                Array.Copy(adjKind, next.adjKind, oldCount);
                Array.Copy(adjServer, next.adjServer, oldCount);
                Array.Copy(walkComponent, next.walkComponent, oldCount);
            }
            next.walkCompSizes = new Dictionary<int, int>(walkCompSizes);

            var nxDelta = new Dictionary<int, int>();
            var nyDelta = new Dictionary<int, int>();
            var lzDelta = new Dictionary<int, int>();
            void NoteNodeAxisDelta(int x, int y, int z, int d) {
                nxDelta[x] = (nxDelta.TryGetValue(x, out int vx) ? vx : 0) + d;
                nyDelta[y] = (nyDelta.TryGetValue(y, out int vy) ? vy : 0) + d;
                lzDelta[z] = (lzDelta.TryGetValue(z, out int vz) ? vz : 0) + d;
            }

            // Track planar edge rebuild roots (coords whose 3x3 planar neighborhood needs edge rebuild)
            // and split seeds per old WalkComponent:
            var planarDirtySeeds = new HashSet<long>();
            var splitSeedsByComp = new Dictionary<int, HashSet<long>>();

            void AddSplitNeighborsOfCoord(long centerCoord, int compId) {
                Unpack3(centerCoord, out int cx, out int cy, out int cz);
                if (!splitSeedsByComp.TryGetValue(compId, out var set)) {
                    splitSeedsByComp[compId] = set = new HashSet<long>();
                }
                for (int dx = -1; dx <= 1; dx++) {
                    for (int dy = -1; dy <= 1; dy++) {
                        if (dx == 0 && dy == 0) continue;
                        set.Add(Pack3(cx + dx, cy + dy, cz));
                    }
                }
            }

            // Apply attribute updates on surviving nodes before pop-and-swap:
            for (int i = 0; i < toUpdateAttrs.Count; i++) {
                var upd = toUpdateAttrs[i];
                int slot = upd.CurrentSlot;
                int prevZone = next.nodeZone[slot];
                if (prevZone != upd.Zone) {
                    if (prevZone != StationWalkGraphBuilder.ZoneOutside) next.stationArea -= 1;
                    if (upd.Zone != StationWalkGraphBuilder.ZoneOutside) next.stationArea += 1;
                    if (options.ZoneBarriers) AddSplitNeighborsOfCoord(upd.Coord, next.walkComponent[slot]);
                }
                next.nodeZone[slot] = upd.Zone;
                next.nodeSpeed[slot] = upd.Speed;
                oldNodeTouched[slot] = true;
                planarDirtySeeds.Add(upd.Coord);
            }

            // Apply node removals via dense pop-and-swap:
            int currentCount = oldCount;
            for (int i = 0; i < toRemoveCoords.Count; i++) {
                long rmCoord = toRemoveCoords[i];
                int rmShard = ShardOf(rmCoord);
                if (!next.nodeShards[rmShard].TryGetValue(rmCoord, out int slot)) continue;

                Unpack3(rmCoord, out int rx, out int ry, out int rz);
                NoteNodeAxisDelta(rx, ry, rz, -1);
                if (next.nodeZone[slot] != StationWalkGraphBuilder.ZoneOutside) next.stationArea -= 1;

                int comp = next.walkComponent[slot];
                if (next.walkCompSizes.TryGetValue(comp, out int csz)) {
                    if (csz <= 1) next.walkCompSizes.Remove(comp);
                    else next.walkCompSizes[comp] = csz - 1;
                }
                AddSplitNeighborsOfCoord(rmCoord, comp);
                planarDirtySeeds.Add(rmCoord);

                int removedOrig = newToOld[slot];
                if (removedOrig >= 0 && removedOrig < oldCount) {
                    oldToNew[removedOrig] = -1;
                    oldNodeTouched[removedOrig] = true;
                }

                WritableNodeShard(rmShard).Remove(rmCoord);
                int last = currentCount - 1;
                if (slot != last) {
                    long movedCoord = next.nodeCoord[last];
                    next.nodeCoord[slot] = movedCoord;
                    next.nodeKey[slot] = next.nodeKey[last];
                    next.nodeX[slot] = next.nodeX[last];
                    next.nodeY[slot] = next.nodeY[last];
                    next.nodeZ[slot] = next.nodeZ[last];
                    next.nodeSpeed[slot] = next.nodeSpeed[last];
                    next.nodeZone[slot] = next.nodeZone[last];
                    next.planarDegree[slot] = next.planarDegree[last];
                    next.adjTo[slot] = next.adjTo[last];
                    next.adjCost[slot] = next.adjCost[last];
                    next.adjKind[slot] = next.adjKind[last];
                    next.adjServer[slot] = next.adjServer[last];
                    next.walkComponent[slot] = next.walkComponent[last];

                    WritableNodeShard(ShardOf(movedCoord))[movedCoord] = slot;
                    int movedOrig = newToOld[last];
                    newToOld[slot] = movedOrig;
                    if (movedOrig >= 0 && movedOrig < oldCount) {
                        oldToNew[movedOrig] = slot;
                    }
                    // Rebuild planar edges around movedCoord so its neighbors point to `slot` instead of `last`:
                    planarDirtySeeds.Add(movedCoord);
                }
                currentCount--;
            }

            // Apply node additions at the end [currentCount ..]:
            bool connectivityIncreased = serverModulesChanged || obstacleRemoved;
            for (int i = 0; i < toAddNodes.Count; i++) {
                var add = toAddNodes[i];
                int slot = currentCount++;
                WritableNodeShard(ShardOf(add.Coord))[add.Coord] = slot;
                next.nodeCoord[slot] = add.Coord;
                next.nodeKey[slot] = StationWalkGraph.CellKey(add.X, add.Y, add.Z);
                next.nodeX[slot] = add.X + 0.5;
                next.nodeY[slot] = add.Y + 0.5;
                next.nodeZ[slot] = add.Z + 1;
                next.nodeSpeed[slot] = add.Speed;
                next.nodeZone[slot] = add.Zone;
                next.planarDegree[slot] = 0;
                next.adjTo[slot] = Array.Empty<int>();
                next.adjCost[slot] = Array.Empty<double>();
                next.adjKind[slot] = Array.Empty<int>();
                next.adjServer[slot] = Array.Empty<int>();

                int freshComp = ++next.nextCompId;
                next.walkComponent[slot] = freshComp;
                next.walkCompSizes[freshComp] = 1;

                if (add.Zone != StationWalkGraphBuilder.ZoneOutside) next.stationArea += 1;
                NoteNodeAxisDelta(add.X, add.Y, add.Z, 1);
                newToOld[slot] = -1;
                planarDirtySeeds.Add(add.Coord);
                connectivityIncreased = true;
            }

            next.nodeCount = currentCount;
            if (scratchSlot != null) {
                if (currentCount < oldCount) {
                    int clearLen = oldCount - currentCount;
                    Array.Clear(next.nodeKey, currentCount, clearLen);
                    Array.Clear(next.adjTo, currentCount, clearLen);
                    Array.Clear(next.adjCost, currentCount, clearLen);
                    Array.Clear(next.adjKind, currentCount, clearLen);
                    Array.Clear(next.adjServer, currentCount, clearLen);
                }
            } else if (next.nodeCoord.Length != currentCount) {
                Array.Resize(ref next.nodeCoord, currentCount);
                Array.Resize(ref next.nodeKey, currentCount);
                Array.Resize(ref next.nodeX, currentCount);
                Array.Resize(ref next.nodeY, currentCount);
                Array.Resize(ref next.nodeZ, currentCount);
                Array.Resize(ref next.nodeSpeed, currentCount);
                Array.Resize(ref next.nodeZone, currentCount);
                Array.Resize(ref next.planarDegree, currentCount);
                Array.Resize(ref next.adjTo, currentCount);
                Array.Resize(ref next.adjCost, currentCount);
                Array.Resize(ref next.adjKind, currentCount);
                Array.Resize(ref next.adjServer, currentCount);
                Array.Resize(ref next.walkComponent, currentCount);
            }

            next.nodeXCounter = nodeXCounter.Apply(nxDelta);
            next.nodeYCounter = nodeYCounter.Apply(nyDelta);
            next.levelZCounter = levelZCounter.Apply(lzDelta);

            // Also add any dirty gateMode coords (affecting 2x2 diagonal rule) and changed RampWall bucket nodes:
            foreach (long dc in dirtyCellCoords) {
                planarDirtySeeds.Add(dc);
            }
            if (rampWallsChanged && changedRampBuckets.Count > 0) {
                for (int u = 0; u < currentCount; u++) {
                    int bx = ((int)(next.nodeX[u] - 0.5)) >> RampBucketShift;
                    int by = ((int)(next.nodeY[u] - 0.5)) >> RampBucketShift;
                    if (changedRampBuckets.Contains(PackBucket2(bx, by))) {
                        planarDirtySeeds.Add(next.nodeCoord[u]);
                        int orig = newToOld[u];
                        if (orig >= 0 && orig < oldCount) {
                            oldNodeTouched[orig] = true;
                            AddSplitNeighborsOfCoord(next.nodeCoord[u], next.walkComponent[u]);
                        }
                    }
                }
            }

            // 5. Expand planarDirtySeeds by 1 Chebyshev ring on the same Z to get exact nodes whose planar edges may change:
            var rebuildNodes = new List<int>(planarDirtySeeds.Count * 9);
            var rebuildNodeSet = new HashSet<int>();
            foreach (long seed in planarDirtySeeds) {
                Unpack3(seed, out int sx, out int sy, out int sz);
                for (int dx = -1; dx <= 1; dx++) {
                    for (int dy = -1; dy <= 1; dy++) {
                        long nk = Pack3(sx + dx, sy + dy, sz);
                        if (next.nodeShards[ShardOf(nk)].TryGetValue(nk, out int u)) {
                            if (rebuildNodeSet.Add(u)) rebuildNodes.Add(u);
                        }
                    }
                }
            }

            // Record pre-rebuild walk degrees so if a gate-mode or ramp-wall removed a walk edge without removing a node, we detect splits:
            var scratchTo = new List<int>(12);
            var scratchCost = new List<double>(12);
            var scratchKind = new List<int>(12);
            var scratchSrv = new List<int>(12);

            for (int i = 0; i < rebuildNodes.Count; i++) {
                int u = rebuildNodes[i];
                byte oldDeg = next.planarDegree[u];
                next.BuildPlanarEdgesForNode(u, scratchTo, scratchCost, scratchKind, scratchSrv);
                byte newDeg = (byte)scratchTo.Count;
                if (newDeg > oldDeg) {
                    connectivityIncreased = true;
                } else if (newDeg < oldDeg) {
                    if (!splitSeedsByComp.TryGetValue(next.walkComponent[u], out var sset)) {
                        splitSeedsByComp[next.walkComponent[u]] = sset = new HashSet<long>();
                    }
                    sset.Add(next.nodeCoord[u]);
                    Unpack3(next.nodeCoord[u], out int ux, out int uy, out int uz);
                    for (int dx = -1; dx <= 1; dx++) {
                        for (int dy = -1; dy <= 1; dy++) {
                            if (dx != 0 || dy != 0) sset.Add(Pack3(ux + dx, uy + dy, uz));
                        }
                    }
                }
                next.planarDegree[u] = newDeg;
                next.adjTo[u] = newDeg == 0 ? Array.Empty<int>() : scratchTo.ToArray();
                next.adjCost[u] = newDeg == 0 ? Array.Empty<double>() : scratchCost.ToArray();
                next.adjKind[u] = newDeg == 0 ? Array.Empty<int>() : scratchKind.ToArray();
                next.adjServer[u] = newDeg == 0 ? Array.Empty<int>() : scratchSrv.ToArray();
            }

            // Mark oldNodeTouched for nodes whose actual walk/planar neighborhood changed (excluding pure movedCoord relabeling):
            foreach (long dc in candidateSet) {
                Unpack3(dc, out int cx, out int cy, out int cz);
                for (int dx = -1; dx <= 1; dx++) {
                    for (int dy = -1; dy <= 1; dy++) {
                        long nk = Pack3(cx + dx, cy + dy, cz);
                        if (next.nodeShards[ShardOf(nk)].TryGetValue(nk, out int u)) {
                            int orig = newToOld[u];
                            if (orig >= 0 && orig < oldCount) oldNodeTouched[orig] = true;
                        }
                    }
                }
            }

            // Strip stale vertical suffix from surviving previous vertical origins before CreateGraphInstance re-appends active vertical links:
            foreach (int oldVNode in nodesWithVerticalOut) {
                if (oldVNode < 0 || oldVNode >= oldCount) continue;
                int curSlot = oldToNew[oldVNode];
                if (curSlot < 0 || curSlot >= currentCount) continue;
                int pDeg = next.planarDegree[curSlot];
                if (next.adjTo[curSlot].Length > pDeg) {
                    if (pDeg == 0) {
                        next.adjTo[curSlot] = Array.Empty<int>();
                        next.adjCost[curSlot] = Array.Empty<double>();
                        next.adjKind[curSlot] = Array.Empty<int>();
                        next.adjServer[curSlot] = Array.Empty<int>();
                    } else {
                        var tTo = new int[pDeg]; Array.Copy(next.adjTo[curSlot], tTo, pDeg); next.adjTo[curSlot] = tTo;
                        var tCost = new double[pDeg]; Array.Copy(next.adjCost[curSlot], tCost, pDeg); next.adjCost[curSlot] = tCost;
                        var tKind = new int[pDeg]; Array.Copy(next.adjKind[curSlot], tKind, pDeg); next.adjKind[curSlot] = tKind;
                        var tSrv = new int[pDeg]; Array.Copy(next.adjServer[curSlot], tSrv, pDeg); next.adjServer[curSlot] = tSrv;
                    }
                }
            }

            // 6. Create WalkGraph instance (populates Servers, Exits, Platforms, and appends Vertical edges):
            next.nodesWithVerticalOut = new HashSet<int>();
            var nextGraph = next.CreateGraphInstance();

            // Mark oldNodeTouched ONLY on vertical origins whose outgoing vertical edges actually changed:
            foreach (int oldVNode in nodesWithVerticalOut) {
                if (oldVNode < 0 || oldVNode >= oldCount || oldNodeTouched[oldVNode]) continue;
                int curSlot = oldToNew[oldVNode];
                if (curSlot < 0 || curSlot >= currentCount || !next.nodesWithVerticalOut.Contains(curSlot)) {
                    oldNodeTouched[oldVNode] = true;
                    continue;
                }
                int oldPDeg = planarDegree[oldVNode];
                int newPDeg = next.planarDegree[curSlot];
                int oldVCount = adjTo[oldVNode].Length - oldPDeg;
                int newVCount = next.adjTo[curSlot].Length - newPDeg;
                if (oldVCount != newVCount) {
                    oldNodeTouched[oldVNode] = true;
                    continue;
                }
                for (int k = 0; k < oldVCount; k++) {
                    int oldTarget = adjTo[oldVNode][oldPDeg + k];
                    int mappedTarget = (oldTarget >= 0 && oldTarget < oldCount) ? oldToNew[oldTarget] : -1;
                    if (mappedTarget != next.adjTo[curSlot][newPDeg + k] ||
                        adjKind[oldVNode][oldPDeg + k] != next.adjKind[curSlot][newPDeg + k] ||
                        Math.Abs(adjCost[oldVNode][oldPDeg + k] - next.adjCost[curSlot][newPDeg + k]) > 1e-9) {
                        oldNodeTouched[oldVNode] = true;
                        break;
                    }
                }
            }
            foreach (int newVSlot in next.nodesWithVerticalOut) {
                if (newVSlot < 0 || newVSlot >= currentCount) continue;
                int orig = newToOld[newVSlot];
                if (orig >= 0 && orig < oldCount && !nodesWithVerticalOut.Contains(orig)) {
                    oldNodeTouched[orig] = true;
                    connectivityIncreased = true;
                }
            }

            // 7. Repair WalkComponents (merges for new walk edges, lockstep interleaved BFS for splits):
            next.RepairWalkComponents(rebuildNodes, splitSeedsByComp, ref connectivityIncreased);
            next.PopulateGraphReachability(nextGraph);
            next.Graph = nextGraph;

            var graphDelta = new StationWalkGraphDelta {
                OldToNewNode = oldToNew,
                OldNodeTouched = oldNodeTouched,
                OldNodeCount = oldCount,
                RebuiltNodeCount = toRemoveCoords.Count + toAddNodes.Count + toUpdateAttrs.Count,
                RebuiltEdgeNodeCount = rebuildNodes.Count,
                AnyRoadAdded = anyRoadAdded,
                ConnectivityIncreased = connectivityIncreased,
                ModulesChanged = delta.HasModuleChanges,
            };
            return new StagedResult(next, nextGraph, graphDelta);
        }

        // ----------------------------------------------------- graph & edge helpers

        StationWalkGraph CreateGraphInstance() {
            var graph = new StationWalkGraph {
                NodeCount = nodeCount,
                NodeKey = nodeKey,
                NodeX = nodeX,
                NodeY = nodeY,
                NodeZ = nodeZ,
                NodeSpeed = nodeSpeed,
                NodeZone = nodeZone,
                NodeShards = nodeShards,
                StationArea = stationArea,
                MinX = nodeXCounter.IsEmpty ? 0 : nodeXCounter.Min,
                MaxX = nodeXCounter.IsEmpty ? 0 : nodeXCounter.Max,
                MinY = nodeYCounter.IsEmpty ? 0 : nodeYCounter.Min,
                MaxY = nodeYCounter.IsEmpty ? 0 : nodeYCounter.Max,
                LevelsZ = levelZCounter.ValuesArray,
                Unported = cachedUnported ?? Array.Empty<string>(),
            };

            // Populate Adj slices directly without allocating duplicate 150k-element List wrappers:
            graph.AdjTo = new ArraySegment<int[]>(adjTo, 0, nodeCount);
            graph.AdjCost = new ArraySegment<double[]>(adjCost, 0, nodeCount);
            graph.AdjKind = new ArraySegment<int[]>(adjKind, 0, nodeCount);
            graph.AdjServer = new ArraySegment<int[]>(adjServer, 0, nodeCount);
            graph.AdjToRaw = adjTo;
            graph.AdjCostRaw = adjCost;
            graph.AdjKindRaw = adjKind;
            graph.AdjServerRaw = adjServer;

            // Vertical links, gates, exits, and platform edges in exact document order:
            Dictionary<int, List<(int To, double Cost, int Kind, int Server)>> verticalOut = null;
            void AddVertEdge(int from, int to, double cost, WalkEdgeKind kind, int srv) {
                if (verticalOut == null) verticalOut = new Dictionary<int, List<(int, double, int, int)>>();
                if (!verticalOut.TryGetValue(from, out var list)) {
                    verticalOut[from] = list = new List<(int, double, int, int)>(2);
                }
                list.Add((to, cost, (int)kind, srv));
                nodesWithVerticalOut.Add(from);
            }

            for (int i = 0; i < serverModules.Count; i++) {
                var module = serverModules[i];
                switch (module.Type) {
                    case "exit": {
                        int node = -1;
                        if (module.HeadHouse) {
                            StationWalkGraphBuilder.ExitDoorCell(module, out int dx, out int dy, out int dz);
                            if (TryGetNode(dx, dy, dz, out int doorNode)) node = doorNode;
                        }
                        if (node < 0 && TryGetNode(module.X, module.Y, module.Z, out int baseNode)) node = baseNode;
                        if (node >= 0) {
                            graph.Exits.Add(new StationExitFact {
                                Id = module.Id,
                                Name = module.Name,
                                Node = node,
                                Closed = module.ExitClosed,
                                HasInRate = module.HasExitInRate,
                                InRate = module.ExitInRate,
                            });
                        }
                        break;
                    }
                    case "gate": {
                        if (!module.GateHasLane) break;
                        if (!TryGetNode(module.X, module.Y, module.Z, out int node)) break;
                        int id = AddServer(graph, new StationServerFact {
                            Kind = "gate",
                            Label = module.GateDir == 0 ? "fare_gate" : module.GateDir > 0 ? "entry_gate" : "exit_gate",
                            Rate = StationWalkGraphBuilder.GateRate,
                            Node = node,
                            ExitNode = -1,
                            Batch = 1,
                            GateMode = module.GateDir,
                            GateRotation = module.Rot,
                        });
                        graph.ServerForNode[node] = id;
                        break;
                    }
                    case "escalator":
                    case "walkway": {
                        if (!module.HasEndpoints) break;
                        if (!TryGetNode(module.FromX, module.FromY, module.FromZ, out int a)) break;
                        if (!TryGetNode(module.ToX, module.ToY, module.ToZ, out int b)) break;
                        bool walkway = module.Type == "walkway";
                        double horizontal = Math.Sqrt(Pow2(nodeX[a] - nodeX[b]) + Pow2(nodeY[a] - nodeY[b]));
                        double vertical = Math.Abs(nodeZ[a] - nodeZ[b]);
                        double distance = Math.Sqrt(horizontal * horizontal + vertical * vertical);
                        double ride = (module.RidePath?.Length ?? distance) / (walkway ? StationWalkGraphBuilder.WalkwaySpeed : StationWalkGraphBuilder.EscalatorSpeed);
                        int id = AddServer(graph, new StationServerFact {
                            Kind = walkway ? "walkway" : "escalator",
                            Label = walkway ? "walkway" : module.Dir == "down" ? "down_escalator" : "up_escalator",
                            Rate = (walkway ? StationWalkGraphBuilder.WalkwayRate : StationWalkGraphBuilder.EscalatorRate) * StationWalkGraphBuilder.EffectiveRideWidth(module),
                            Node = a,
                            ExitNode = b,
                            Ride = ride,
                            RidePath = module.RidePath,
                            RideColumns = module.RideColumns,
                            Batch = 1,
                            Cycle = 0,
                        });
                        AddVertEdge(a, b, ride, walkway ? WalkEdgeKind.Walkway : WalkEdgeKind.Escalator, id);
                        break;
                    }
                    case "stair": {
                        if (!module.HasEndpoints) break;
                        if (!TryGetNode(module.FromX, module.FromY, module.FromZ, out int a)) break;
                        if (!TryGetNode(module.ToX, module.ToY, module.ToZ, out int b)) break;
                        double horizontal = Math.Sqrt(Pow2(nodeX[a] - nodeX[b]) + Pow2(nodeY[a] - nodeY[b]));
                        double vertical = Math.Abs(nodeZ[a] - nodeZ[b]);
                        double ride = (module.RidePath?.Length ?? Math.Sqrt(horizontal * horizontal + vertical * vertical)) / StationWalkGraphBuilder.StairSpeed;
                        double width = StationWalkGraphBuilder.EffectiveRideWidth(module);
                        bool down = nodeZ[a] > nodeZ[b];
                        int stairFlights = Math.Max(1, module.StairFlights);
                        int downId = AddServer(graph, new StationServerFact {
                            Kind = "stair", Label = "stairs",
                            Rate = (down ? StationWalkGraphBuilder.StairRateDown : StationWalkGraphBuilder.StairRateUp) * width,
                            Node = a, ExitNode = b, Ride = ride, RidePath = module.RidePath,
                            StairFlights = stairFlights,
                        });
                        AddVertEdge(a, b, ride, WalkEdgeKind.Stair, downId);
                        int upId = AddServer(graph, new StationServerFact {
                            Kind = "stair", Label = "stairs",
                            Rate = (down ? StationWalkGraphBuilder.StairRateUp : StationWalkGraphBuilder.StairRateDown) * width,
                            Node = b, ExitNode = a, Ride = ride, RidePath = module.RidePath, RideReverse = true,
                            StairFlights = stairFlights,
                        });
                        AddVertEdge(b, a, ride, WalkEdgeKind.Stair, upId);
                        break;
                    }
                }
            }

            // Platform edges (second pass in exact document order, matching StationWalkGraphBuilder.Build):
            for (int i = 0; i < serverModules.Count; i++) {
                var module = serverModules[i];
                if (module.Type != "platform-edge") continue;
                var doors = new List<int>();
                var cellsOnRun = new List<int>();
                int runLength = Math.Max(1, module.Width);
                for (int r = 0; r < runLength; r++) {
                    int dx = 0, dy = 0;
                    switch (((module.Rot % 4) + 4) % 4) {
                        case 1: dy = r; break;
                        case 2: dx = -r; break;
                        case 3: dy = -r; break;
                        default: dx = r; break;
                    }
                    int x = module.X + dx, y = module.Y + dy;
                    if (!TryGetNode(x, y, module.Z, out int node)) continue;
                    cellsOnRun.Add(node);
                    int id = AddServer(graph, new StationServerFact {
                        Kind = "door", Label = "platform_doors", Node = node, ExitNode = -1, Rate = 0, Batch = 1,
                    });
                    doors.Add(id);
                }
                graph.Platforms.Add(new StationPlatformFact {
                    Id = module.Id, Name = module.LineId, Line = module.LineId, Dir = module.Dir, Side = module.Side,
                    Doors = doors.ToArray(), Cells = cellsOnRun.ToArray(),
                });
            }

            // Append vertical outgoing edges onto planar base edges for the ~100-300 vertical origin nodes:
            if (verticalOut != null) {
                foreach (var kv in verticalOut) {
                    int u = kv.Key;
                    var vList = kv.Value;
                    int pDeg = planarDegree[u];
                    int total = pDeg + vList.Count;
                    var newTo = new int[total];
                    var newCost = new double[total];
                    var newKind = new int[total];
                    var newSrv = new int[total];
                    if (pDeg > 0) {
                        Array.Copy(adjTo[u], newTo, pDeg);
                        Array.Copy(adjCost[u], newCost, pDeg);
                        Array.Copy(adjKind[u], newKind, pDeg);
                        Array.Copy(adjServer[u], newSrv, pDeg);
                    }
                    for (int k = 0; k < vList.Count; k++) {
                        var ve = vList[k];
                        newTo[pDeg + k] = ve.To;
                        newCost[pDeg + k] = ve.Cost;
                        newKind[pDeg + k] = ve.Kind;
                        newSrv[pDeg + k] = ve.Server;
                    }
                    adjTo[u] = newTo;
                    adjCost[u] = newCost;
                    adjKind[u] = newKind;
                    adjServer[u] = newSrv;
                    graph.AdjTo[u] = newTo;
                    graph.AdjCost[u] = newCost;
                    graph.AdjKind[u] = newKind;
                    graph.AdjServer[u] = newSrv;
                }
            }

            return graph;
        }

        void BuildPlanarEdgesForNode(int i, List<int> to, List<double> cost, List<int> kind, List<int> server) {
            to.Clear(); cost.Clear(); kind.Clear(); server.Clear();
            Unpack3(nodeCoord[i], out int x, out int y, out int z);
            double speedI = nodeSpeed[i];
            int zoneI = nodeZone[i];

            // 1. Cardinal in exact order: (1,0), (-1,0), (0,1), (0,-1)
            int cardMask = 0;
            int[] cardNeighbor = { -1, -1, -1, -1 };
            for (int c = 0; c < 4; c++) {
                int nx = x + Cardinal[c].dx, ny = y + Cardinal[c].dy;
                if (!TryGetNode(nx, ny, z, out int j)) continue;
                bool fromGate = gateRotations.TryGetValue(nodeCoord[i], out var fromLane);
                bool toGate = gateRotations.TryGetValue(nodeCoord[j], out var toLane);
                if (!StationWalkGraphBuilder.GateStepAllowed(fromGate, fromLane, toGate, toLane,
                        nx - x, ny - y, zoneI, nodeZone[j], options.ZoneBarriers)) continue;
                if (CrossesRampWall(x + 0.5, y + 0.5, nx + 0.5, ny + 0.5, z)) continue;
                double spd = (speedI + nodeSpeed[j]) * 0.5;
                to.Add(j);
                cost.Add(1.0 / (StationWalkGraphBuilder.WalkSpeed * spd));
                kind.Add((int)WalkEdgeKind.Walk);
                server.Add(-1);
                cardMask |= 1 << c;
                cardNeighbor[c] = j;
            }

            // 2. Diagonal in exact order: (1,1), (1,-1), (-1,1), (-1,-1)
            if (gateRotations.ContainsKey(nodeCoord[i])) return;
            for (int d = 0; d < 4; d++) {
                int dx = Diagonal[d].dx, dy = Diagonal[d].dy;
                int nx = x + dx, ny = y + dy;
                int cardAIdx = dx > 0 ? 0 : 1; // (dx, 0)
                int cardBIdx = dy > 0 ? 2 : 3; // (0, dy)
                if ((cardMask & (1 << cardAIdx)) == 0 || (cardMask & (1 << cardBIdx)) == 0) continue;
                int a = cardNeighbor[cardAIdx];
                int b = cardNeighbor[cardBIdx];
                long pkJ = Pack3(nx, ny, z);
                if (!nodeShards[ShardOf(pkJ)].TryGetValue(pkJ, out int j)) continue;
                if (gateRotations.ContainsKey(pkJ) ||
                    gateRotations.ContainsKey(nodeCoord[a]) ||
                    gateRotations.ContainsKey(nodeCoord[b])) continue;
                // Check CardinalAllows(a -> j) and CardinalAllows(b -> j):
                int zoneJ = nodeZone[j];
                if (options.ZoneBarriers && (StationWalkGraphBuilder.CrossesFareLine(nodeZone[a], zoneJ) ||
                        StationWalkGraphBuilder.CrossesFareLine(nodeZone[b], zoneJ))) continue;
                if (CrossesRampWall(nx + 0.5, y + 0.5, nx + 0.5, ny + 0.5, z)) continue;
                if (CrossesRampWall(x + 0.5, ny + 0.5, nx + 0.5, ny + 0.5, z)) continue;
                if (CrossesRampWall(x + 0.5, y + 0.5, nx + 0.5, ny + 0.5, z)) continue;
                double spd = (speedI + nodeSpeed[j]) * 0.5;
                to.Add(j);
                cost.Add(Math.Sqrt(2.0) / (StationWalkGraphBuilder.WalkSpeed * spd));
                kind.Add((int)WalkEdgeKind.Walk);
                server.Add(-1);
            }
        }

        // ---------------------------------------- exact WalkComponent & reachability

        void BuildInitialWalkComponents() {
            walkComponent = new int[nodeCount];
            walkCompSizes = new Dictionary<int, int>();
            nextCompId = 0;
            if (nodeCount == 0) return;

            var queue = new Queue<int>(1024);
            for (int i = 0; i < nodeCount; i++) {
                if (walkComponent[i] != 0) continue;
                int comp = ++nextCompId;
                walkComponent[i] = comp;
                queue.Enqueue(i);
                int size = 0;
                while (queue.Count > 0) {
                    int u = queue.Dequeue();
                    size++;
                    int pDeg = planarDegree[u];
                    var outs = adjTo[u];
                    for (int e = 0; e < pDeg; e++) {
                        int v = outs[e];
                        if (walkComponent[v] == 0) {
                            walkComponent[v] = comp;
                            queue.Enqueue(v);
                        }
                    }
                }
                walkCompSizes[comp] = size;
            }
        }

        void RepairWalkComponents(
            List<int> rebuiltNodes,
            Dictionary<int, HashSet<long>> splitSeedsByComp,
            ref bool connectivityIncreased) {
            if (nodeCount == 0) {
                walkCompSizes.Clear();
                return;
            }

            // Step A: Handle potential splits first via lockstep interleaved BFS on affected old components:
            if (splitSeedsByComp.Count > 0) {
                foreach (var kv in splitSeedsByComp) {
                    int comp = kv.Key;
                    if (!walkCompSizes.TryGetValue(comp, out int totalInComp) || totalInComp <= 1) continue;
                    var seedNodes = new List<int>(kv.Value.Count);
                    foreach (long coord in kv.Value) {
                        if (nodeShards[ShardOf(coord)].TryGetValue(coord, out int u) && walkComponent[u] == comp) {
                            if (!seedNodes.Contains(u)) seedNodes.Add(u);
                        }
                    }
                    if (seedNodes.Count <= 1) continue;
                    RepairComponentSplitLockstep(comp, seedNodes);
                }
            }

            // Step B: Handle merges across Walk edges on rebuiltNodes (always relabeling smaller component):
            var bfsQueue = new Queue<int>(64);
            for (int i = 0; i < rebuiltNodes.Count; i++) {
                int u = rebuiltNodes[i];
                int pDeg = planarDegree[u];
                var outs = adjTo[u];
                for (int e = 0; e < pDeg; e++) {
                    int v = outs[e];
                    int cu = walkComponent[u];
                    int cv = walkComponent[v];
                    if (cu == cv) continue;
                    connectivityIncreased = true;
                    int sizeU = walkCompSizes.TryGetValue(cu, out int su) ? su : 1;
                    int sizeV = walkCompSizes.TryGetValue(cv, out int sv) ? sv : 1;
                    int smallComp, largeComp, startNode;
                    if (sizeU <= sizeV) {
                        smallComp = cu; largeComp = cv; startNode = u;
                    } else {
                        smallComp = cv; largeComp = cu; startNode = v;
                    }
                    // Relabel smallComp -> largeComp via planar Walk edges:
                    bfsQueue.Clear();
                    walkComponent[startNode] = largeComp;
                    bfsQueue.Enqueue(startNode);
                    int moved = 0;
                    while (bfsQueue.Count > 0) {
                        int cur = bfsQueue.Dequeue();
                        moved++;
                        int deg = planarDegree[cur];
                        var curOuts = adjTo[cur];
                        for (int k = 0; k < deg; k++) {
                            int nb = curOuts[k];
                            if (walkComponent[nb] == smallComp) {
                                walkComponent[nb] = largeComp;
                                bfsQueue.Enqueue(nb);
                            }
                        }
                    }
                    walkCompSizes[largeComp] = (walkCompSizes.TryGetValue(largeComp, out int lsz) ? lsz : 0) + moved;
                    if (walkCompSizes.TryGetValue(smallComp, out int remSz)) {
                        if (remSz <= moved) walkCompSizes.Remove(smallComp);
                        else walkCompSizes[smallComp] = remSz - moved;
                    }
                }
            }
        }

        sealed class SplitSearchArm {
            public int RootId;
            public SplitSearchArm Parent;
            public Queue<int> Frontier = new Queue<int>(32);
            public List<int> Visited = new List<int>(32);
            public bool Exhausted;

            public SplitSearchArm Find() {
                var r = this;
                while (r.Parent != null) r = r.Parent;
                var cur = this;
                while (cur != r) { var p = cur.Parent; cur.Parent = r; cur = p; }
                return r;
            }
        }

        void RepairComponentSplitLockstep(int comp, List<int> seeds) {
            int k = seeds.Count;
            var owner = new Dictionary<int, SplitSearchArm>(64);
            var arms = new List<SplitSearchArm>(k);
            for (int i = 0; i < k; i++) {
                int s = seeds[i];
                if (owner.ContainsKey(s)) continue;
                var arm = new SplitSearchArm { RootId = i };
                arm.Frontier.Enqueue(s);
                arm.Visited.Add(s);
                owner[s] = arm;
                arms.Add(arm);
            }
            if (arms.Count <= 1) return;

            int activeNonExhausted = arms.Count;
            var distinctRoots = new List<SplitSearchArm>(arms.Count);

            while (activeNonExhausted > 1) {
                distinctRoots.Clear();
                for (int i = 0; i < arms.Count; i++) {
                    var r = arms[i].Find();
                    if (!r.Exhausted && !distinctRoots.Contains(r)) distinctRoots.Add(r);
                }
                if (distinctRoots.Count <= 1) break;

                for (int i = 0; i < distinctRoots.Count; i++) {
                    var arm = distinctRoots[i].Find();
                    if (arm.Exhausted) continue;
                    if (arm.Frontier.Count == 0) {
                        arm.Exhausted = true;
                        activeNonExhausted--;
                        if (activeNonExhausted <= 1) break;
                        continue;
                    }

                    int u = arm.Frontier.Dequeue();
                    int deg = planarDegree[u];
                    var outs = adjTo[u];
                    for (int e = 0; e < deg; e++) {
                        int v = outs[e];
                        if (walkComponent[v] != comp) continue;
                        if (!owner.TryGetValue(v, out var otherArm)) {
                            owner[v] = arm;
                            arm.Visited.Add(v);
                            arm.Frontier.Enqueue(v);
                        } else {
                            var rA = arm.Find();
                            var rB = otherArm.Find();
                            if (rA != rB) {
                                // Merge smaller visited list into larger:
                                if (rA.Visited.Count < rB.Visited.Count) { var tmp = rA; rA = rB; rB = tmp; }
                                bool bWasActive = !rB.Exhausted;
                                bool aWasActive = !rA.Exhausted;
                                rB.Parent = rA;
                                rA.Visited.AddRange(rB.Visited);
                                while (rB.Frontier.Count > 0) rA.Frontier.Enqueue(rB.Frontier.Dequeue());
                                rA.Exhausted = rA.Frontier.Count == 0;
                                int beforeActive = (aWasActive ? 1 : 0) + (bWasActive ? 1 : 0);
                                int afterActive = !rA.Exhausted ? 1 : 0;
                                activeNonExhausted -= (beforeActive - afterActive);
                                arm = rA;
                            }
                        }
                    }

                    if (arm.Frontier.Count == 0 && !arm.Exhausted) {
                        arm.Exhausted = true;
                        activeNonExhausted--;
                    }
                    if (activeNonExhausted <= 1) break;
                }
            }

            // Collect final distinct merged roots:
            var finalRoots = new List<SplitSearchArm>(arms.Count);
            for (int i = 0; i < arms.Count; i++) {
                var r = arms[i].Find();
                if (!finalRoots.Contains(r)) finalRoots.Add(r);
            }
            if (finalRoots.Count <= 1) return; // All boundary seeds reconnected! Zero split!

            // Keep `comp` on the single non-exhausted arm (or the largest exhausted arm if all finished),
            // and assign fresh component IDs to all other (exhausted, smaller) split components:
            int keeperIdx = -1;
            for (int i = 0; i < finalRoots.Count; i++) {
                if (!finalRoots[i].Exhausted) { keeperIdx = i; break; }
            }
            if (keeperIdx < 0) {
                int bestCount = -1;
                for (int i = 0; i < finalRoots.Count; i++) {
                    if (finalRoots[i].Visited.Count > bestCount) {
                        bestCount = finalRoots[i].Visited.Count;
                        keeperIdx = i;
                    }
                }
            }

            int splitOffTotal = 0;
            for (int i = 0; i < finalRoots.Count; i++) {
                if (i == keeperIdx) continue;
                var sub = finalRoots[i];
                int newId = ++nextCompId;
                var vis = sub.Visited;
                for (int j = 0; j < vis.Count; j++) {
                    walkComponent[vis[j]] = newId;
                }
                walkCompSizes[newId] = vis.Count;
                splitOffTotal += vis.Count;
            }
            if (walkCompSizes.TryGetValue(comp, out int origTotal)) {
                int rem = origTotal - splitOffTotal;
                if (rem <= 0) walkCompSizes.Remove(comp);
                else walkCompSizes[comp] = rem;
            }
        }

        void PopulateGraphReachability(StationWalkGraph graph) {
            graph.WalkComponent = walkComponent;
            var stdAdj = new Dictionary<int, List<int>>();
            var sfAdj = new Dictionary<int, List<int>>();
            var activeDense = new Dictionary<int, int>();
            int denseCount = 0;
            int DenseId(int comp) {
                if (!activeDense.TryGetValue(comp, out int id)) {
                    id = denseCount++;
                    activeDense[comp] = id;
                }
                return id;
            }

            foreach (int u in nodesWithVerticalOut) {
                if (u < 0 || u >= nodeCount) continue;
                int cu = walkComponent[u];
                int pDeg = planarDegree[u];
                var outs = adjTo[u];
                var kinds = adjKind[u];
                for (int e = pDeg; e < outs.Length; e++) {
                    int cv = walkComponent[outs[e]];
                    if (cu == cv) continue;
                    int du = DenseId(cu);
                    int dv = DenseId(cv);
                    if (!stdAdj.TryGetValue(du, out var listStd)) stdAdj[du] = listStd = new List<int>(4);
                    if (!listStd.Contains(dv)) listStd.Add(dv);

                    var k = (WalkEdgeKind)kinds[e];
                    if (k != WalkEdgeKind.Stair && k != WalkEdgeKind.Escalator) {
                        if (!sfAdj.TryGetValue(du, out var listSf)) sfAdj[du] = listSf = new List<int>(2);
                        if (!listSf.Contains(dv)) listSf.Add(dv);
                    }
                }
            }

            graph.CondensationMap = activeDense;
            graph.CondensationReachStandard = BuildReachBitsets(denseCount, stdAdj);
            graph.CondensationReachStepFree = BuildReachBitsets(denseCount, sfAdj);
        }

        static ulong[][] BuildReachBitsets(int count, Dictionary<int, List<int>> adj) {
            if (count == 0 || adj.Count == 0) return Array.Empty<ulong[]>();
            int words = (count + 63) >> 6;
            var reach = new ulong[count][];
            var queue = new Queue<int>(count);
            for (int src = 0; src < count; src++) {
                var bits = new ulong[words];
                bits[src >> 6] |= 1UL << (src & 63);
                if (adj.ContainsKey(src)) {
                    queue.Clear();
                    queue.Enqueue(src);
                    while (queue.Count > 0) {
                        int u = queue.Dequeue();
                        if (!adj.TryGetValue(u, out var outs)) continue;
                        for (int i = 0; i < outs.Count; i++) {
                            int v = outs[i];
                            ulong mask = 1UL << (v & 63);
                            int w = v >> 6;
                            if ((bits[w] & mask) == 0) {
                                bits[w] |= mask;
                                queue.Enqueue(v);
                            }
                        }
                    }
                }
                reach[src] = bits;
            }
            return reach;
        }

        // ----------------------------------------------------- occupancy & geometry

        bool TryGetNode(int x, int y, int z, out int node) {
            long pk = Pack3(x, y, z);
            return nodeShards[ShardOf(pk)].TryGetValue(pk, out node);
        }

        bool IsEffectiveSolid(int x, int y, int z) {
            long pk = Pack3(x, y, z);
            if (authoredShards[ShardOf(pk)].TryGetValue(pk, out var cell)) {
                return cell.Solid;
            }
            return z == StationWalkGraphBuilder.GroundZ && hasGroundWindow &&
                   x >= gx0 && x <= gx1 && y >= gy0 && y <= gy1;
        }

        bool EvaluateWalkable(int x, int y, int z, out int zone, out double speed) {
            zone = 0;
            speed = 0;
            long pk = Pack3(x, y, z);
            if (authoredShards[ShardOf(pk)].TryGetValue(pk, out var cell)) {
                if (!cell.Solid || cell.Speed <= 0) return false;
                zone = cell.Zone;
                speed = cell.Speed;
            } else if (z == StationWalkGraphBuilder.GroundZ && hasGroundWindow &&
                       x >= gx0 && x <= gx1 && y >= gy0 && y <= gy1) {
                zone = StationWalkGraphBuilder.ZoneOutside;
                speed = options.UnknownFloorSpeed;
                if (speed <= 0) return false;
            } else {
                return false;
            }
            if (IsEffectiveSolid(x, y, z + 1)) return false;
            if (HasObstacleAt(pk)) return false;
            return true;
        }

        void ComputeGroundWindow(out bool hasWindow, out int x0, out int x1, out int y0, out int y1) {
            if (!options.IncludeGround) {
                hasWindow = false;
                x0 = x1 = y0 = y1 = 0;
                return;
            }
            hasWindow = true;
            int margin = (int)options.GroundMargin;
            if (contentX.IsEmpty || contentY.IsEmpty) {
                x0 = -margin; x1 = margin;
                y0 = -margin; y1 = margin;
                return;
            }
            x0 = contentX.Min - margin;
            x1 = contentX.Max + margin;
            y0 = contentY.Min - margin;
            y1 = contentY.Max + margin;
        }

        static void CollectGroundWindowDiff(
            bool oldHas, int ox0, int ox1, int oy0, int oy1,
            bool newHas, int nx0, int nx1, int ny0, int ny1,
            HashSet<long> dirty) {
            if (oldHas) {
                for (int x = ox0; x <= ox1; x++) {
                    for (int y = oy0; y <= oy1; y++) {
                        if (!newHas || x < nx0 || x > nx1 || y < ny0 || y > ny1) {
                            dirty.Add(Pack3(x, y, StationWalkGraphBuilder.GroundZ));
                        }
                    }
                }
            }
            if (newHas) {
                for (int x = nx0; x <= nx1; x++) {
                    for (int y = ny0; y <= ny1; y++) {
                        if (!oldHas || x < ox0 || x > ox1 || y < oy0 || y > oy1) {
                            dirty.Add(Pack3(x, y, StationWalkGraphBuilder.GroundZ));
                        }
                    }
                }
            }
        }

        bool CrossesRampWall(double x, double y, double nx, double ny, int z) {
            if (!hasAnyRampWalls) return false;
            int bx0 = ((int)Math.Floor(Math.Min(x, nx))) >> RampBucketShift;
            int bx1 = ((int)Math.Floor(Math.Max(x, nx))) >> RampBucketShift;
            int by0 = ((int)Math.Floor(Math.Min(y, ny))) >> RampBucketShift;
            int by1 = ((int)Math.Floor(Math.Max(y, ny))) >> RampBucketShift;
            for (int bx = bx0; bx <= bx1; bx++) {
                for (int by = by0; by <= by1; by++) {
                    if (!rampWallGrid.TryGetValue(PackBucket2(bx, by), out var walls)) continue;
                    for (int i = 0; i < walls.Count; i++) {
                        var w = walls[i];
                        if (z < w.Z0 || z > w.Z1) continue;
                        if (SegmentCross(x, y, nx, ny, w.Ax, w.Ay, w.Bx, w.By)) return true;
                    }
                }
            }
            return false;
        }

        static double Side(double ax, double ay, double bx, double by, double cx, double cy) =>
            (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

        static bool SegmentCross(double px, double py, double qx, double qy, double rx, double ry, double sx, double sy) {
            double d1 = Side(px, py, qx, qy, rx, ry);
            double d2 = Side(px, py, qx, qy, sx, sy);
            double d3 = Side(rx, ry, sx, sy, px, py);
            double d4 = Side(rx, ry, sx, sy, qx, qy);
            return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
        }

        static ModuleContribution BuildModuleContribution(StationModuleFact module, int fallbackIndex) {
            var contrib = new ModuleContribution {
                Id = !string.IsNullOrEmpty(module.Id) ? module.Id : ("__anon_" + fallbackIndex),
                Fact = module,
            };

            var cxs = new List<int>(4) { module.X };
            var cys = new List<int>(4) { module.Y };
            if (module.Type == "road") {
                cxs.Add(module.X + Math.Max(1, module.Width) - 1);
                cys.Add(module.Y + Math.Max(1, module.Depth) - 1);
            }
            if (module.HasEndpoints) {
                cxs.Add(module.FromX); cys.Add(module.FromY);
                cxs.Add(module.ToX); cys.Add(module.ToY);
            }
            contrib.ContentXs = cxs.ToArray();
            contrib.ContentYs = cys.ToArray();

            List<long> obstacles = null;
            List<string> unported = null;

            switch (module.Type) {
                case "gate":
                    if (module.GateHasLane) {
                        contrib.HasGateLane = true;
                        contrib.GateCoord = Pack3(module.X, module.Y, module.Z);
                        contrib.GateRotation = module.Rot;
                        contrib.IsServerOrPlatformOrExit = true;
                    } else {
                        obstacles = new List<long>(1) { Pack3(module.X, module.Y, module.Z) };
                    }
                    break;
                case "fence":
                case "psd-end":
                case "tvm":
                case "vending":
                    obstacles = new List<long>(1) { Pack3(module.X, module.Y, module.Z) };
                    break;
                case "checkout":
                case "shelf":
                    obstacles = new List<long>();
                    StationWalkGraphBuilder.ShopFixtureBlockedCells(module, (x, y, z) => obstacles.Add(Pack3(x, y, z)));
                    break;
                case "road": {
                    int w = Math.Max(1, module.Width), d = Math.Max(1, module.Depth);
                    obstacles = new List<long>(w * d);
                    for (int x = module.X; x < module.X + w; x++)
                        for (int y = module.Y; y < module.Y + d; y++)
                            obstacles.Add(Pack3(x, y, module.Z));
                    break;
                }
                case "pillar": {
                    int h = Math.Max(1, module.Height);
                    obstacles = new List<long>(h);
                    for (int z = module.Z; z < module.Z + h; z++)
                        obstacles.Add(Pack3(module.X, module.Y, z));
                    break;
                }
                case "stair":
                    if (module.Block) obstacles = new List<long>(1) { Pack3(module.X, module.Y, module.Z) };
                    if (module.HasEndpoints) {
                        contrib.IsServerOrPlatformOrExit = true;
                        if (module.RidePath == null && Math.Abs(module.ToZ - module.FromZ) > 0) {
                            unported = new List<string>(1) { "stair-flights:" + module.Id };
                        }
                    }
                    break;
                case "booth": {
                    int w = Math.Max(1, module.Width), h = Math.Max(1, module.Depth);
                    obstacles = new List<long>(w * h);
                    for (int x = module.X; x < module.X + w; x++)
                        for (int y = module.Y; y < module.Y + h; y++)
                            obstacles.Add(Pack3(x, y, module.Z));
                    break;
                }
                case "lift": {
                    obstacles = new List<long>();
                    StationWalkGraphBuilder.LiftBlockedCells(module, (bx, by, bz) => obstacles.Add(Pack3(bx, by, bz)));
                    unported = new List<string>(1) { "lift-stops:" + module.Id };
                    break;
                }
                case "escalator":
                case "walkway": {
                    if (module.Type == "walkway") {
                        unported = new List<string>(1) { "walkway-belt:" + module.Id };
                    }
                    if (module.HasEndpoints) {
                        contrib.IsServerOrPlatformOrExit = true;
                        if (module.Type == "escalator") {
                            var blocked = new List<long>(8);
                            StationWalkGraphBuilder.EscalatorBlockedLowerCells(module, (bx, by, bz) =>
                                blocked.Add(Pack3(bx, by, bz)));
                            if (blocked.Count > 0) obstacles = blocked;
                        }
                        int widthBlocks = Math.Max(1, module.Width);
                        double half = (StationWalkGraphBuilder.EscalatorBalustrade + (widthBlocks - 1) - 2 * StationWalkGraphBuilder.EscalatorSkirtInset) / 2.0;
                        double dx = module.ToX - module.FromX, dy = module.ToY - module.FromY;
                        double length = Math.Sqrt(dx * dx + dy * dy);
                        if (length >= 1e-6) {
                            StationWalkGraphBuilder.EscalatorCenterShift(module, widthBlocks, length, out double shiftX, out double shiftY);
                            double ax = module.FromX + 0.5 + shiftX, ay = module.FromY + 0.5 + shiftY;
                            double ux = dx / length, uy = dy / length;
                            const double extend = 0.6;
                            var rw = new RampWall[2];
                            int rwi = 0;
                            for (int s = 1; s >= -1; s -= 2) {
                                double ox = -uy * half * s, oy = ux * half * s;
                                rw[rwi++] = new RampWall {
                                    Ax = ax - ux * extend + ox, Ay = ay - uy * extend + oy,
                                    Bx = ax + dx + ux * extend + ox, By = ay + dy + uy * extend + oy,
                                    Z0 = Math.Min(module.FromZ, module.ToZ), Z1 = Math.Max(module.FromZ, module.ToZ),
                                };
                            }
                            contrib.RampWalls = rw;
                        }
                    }
                    break;
                }
                case "exit":
                    contrib.IsServerOrPlatformOrExit = true;
                    if (module.HeadHouse) unported = new List<string>(1) { "exit-walls:" + module.Id };
                    break;
                case "platform-edge":
                    contrib.IsServerOrPlatformOrExit = true;
                    break;
                case "bench":
                case "cubicle":
                case "sink":
                    unported = new List<string>(1) { "fixture-access:" + module.Id };
                    break;
                case "roof":
                    if (module.Variant == "canopy") unported = new List<string>(1) { "canopy-posts:" + module.Id };
                    break;
                case "hanger":
                    unported = new List<string>(1) { "hanger-posts:" + module.Id };
                    break;
                case "ac-unit":
                case "electrical-cabinet":
                    unported = new List<string>(1) { "floor-decor:" + module.Id };
                    break;
            }

            contrib.ObstacleCoords = obstacles != null ? obstacles.ToArray() : Array.Empty<long>();
            contrib.Unported = unported != null ? unported.ToArray() : null;
            return contrib;
        }

        static void ApplyModuleContributionToShards(
            ModuleContribution contrib,
            Dictionary<long, int>[] obstacleShards,
            Func<int, Dictionary<long, int>> writableObsShard,
            Dictionary<long, List<(string Id, int Rotation)>> gateEntries,
            Dictionary<long, int> gateRotations,
            Dictionary<long, List<RampWall>> rampGrid,
            HashSet<long> dirty = null) {
            for (int i = 0; i < contrib.ObstacleCoords.Length; i++) {
                long pk = contrib.ObstacleCoords[i];
                int sh = ObstacleShardOf(pk);
                var dict = writableObsShard != null ? writableObsShard(sh) : obstacleShards[sh];
                int prev = dict.TryGetValue(pk, out int c) ? c : 0;
                dict[pk] = prev + 1;
                if (prev == 0) dirty?.Add(pk);
            }
            if (contrib.HasGateLane) {
                long gk = contrib.GateCoord;
                if (!gateEntries.TryGetValue(gk, out var list)) {
                    gateEntries[gk] = list = new List<(string Id, int Rotation)>(1);
                }
                list.Add((contrib.Id, contrib.GateRotation));
                gateRotations[gk] = contrib.GateRotation;
                dirty?.Add(gk);
            }
            if (rampGrid != null && contrib.RampWalls != null && contrib.RampWalls.Length > 0) {
                AddRampWallsToGrid(contrib.RampWalls, rampGrid);
            }
        }

        static void RemoveModuleContributionFromShards(
            ModuleContribution contrib,
            Func<int, Dictionary<long, int>> writableObsShard,
            Dictionary<long, List<(string Id, int Rotation)>> gateEntries,
            Dictionary<long, int> gateRotations,
            HashSet<long> dirty) {
            for (int i = 0; i < contrib.ObstacleCoords.Length; i++) {
                long pk = contrib.ObstacleCoords[i];
                int sh = ObstacleShardOf(pk);
                var dict = writableObsShard(sh);
                if (dict.TryGetValue(pk, out int c)) {
                    if (c <= 1) {
                        dict.Remove(pk);
                        dirty?.Add(pk);
                    } else {
                        dict[pk] = c - 1;
                    }
                }
            }
            if (contrib.HasGateLane) {
                long gk = contrib.GateCoord;
                if (gateEntries.TryGetValue(gk, out var list)) {
                    for (int i = list.Count - 1; i >= 0; i--) {
                        if (string.Equals(list[i].Id, contrib.Id, StringComparison.Ordinal)) {
                            list.RemoveAt(i);
                            break;
                        }
                    }
                    if (list.Count == 0) {
                        gateEntries.Remove(gk);
                        gateRotations.Remove(gk);
                    } else {
                        gateRotations[gk] = list[list.Count - 1].Rotation;
                    }
                    dirty?.Add(gk);
                }
            }
        }

        static void AddRampWallsToGrid(RampWall[] walls, Dictionary<long, List<RampWall>> grid) {
            for (int i = 0; i < walls.Length; i++) {
                var w = walls[i];
                int bx0 = ((int)Math.Floor(Math.Min(w.Ax, w.Bx) - 1.0)) >> RampBucketShift;
                int bx1 = ((int)Math.Floor(Math.Max(w.Ax, w.Bx) + 1.0)) >> RampBucketShift;
                int by0 = ((int)Math.Floor(Math.Min(w.Ay, w.By) - 1.0)) >> RampBucketShift;
                int by1 = ((int)Math.Floor(Math.Max(w.Ay, w.By) + 1.0)) >> RampBucketShift;
                for (int bx = bx0; bx <= bx1; bx++) {
                    for (int by = by0; by <= by1; by++) {
                        long bk = PackBucket2(bx, by);
                        if (!grid.TryGetValue(bk, out var list)) grid[bk] = list = new List<RampWall>(2);
                        list.Add(w);
                    }
                }
            }
        }

        static void CollectRampWallBuckets(RampWall[] walls, HashSet<long> buckets) {
            for (int i = 0; i < walls.Length; i++) {
                var w = walls[i];
                int bx0 = ((int)Math.Floor(Math.Min(w.Ax, w.Bx) - 1.0)) >> RampBucketShift;
                int bx1 = ((int)Math.Floor(Math.Max(w.Ax, w.Bx) + 1.0)) >> RampBucketShift;
                int by0 = ((int)Math.Floor(Math.Min(w.Ay, w.By) - 1.0)) >> RampBucketShift;
                int by1 = ((int)Math.Floor(Math.Max(w.Ay, w.By) + 1.0)) >> RampBucketShift;
                for (int bx = bx0; bx <= bx1; bx++) {
                    for (int by = by0; by <= by1; by++) {
                        buckets.Add(PackBucket2(bx, by));
                    }
                }
            }
        }

        static int AddServer(StationWalkGraph graph, StationServerFact server) {
            server.Id = graph.Servers.Count;
            graph.Servers.Add(server);
            return server.Id;
        }

        static double Pow2(double v) => v * v;

        static StationWalkGraphOptions CloneOptions(StationWalkGraphOptions src) =>
            src == null
                ? new StationWalkGraphOptions()
                : new StationWalkGraphOptions {
                    ZoneBarriers = src.ZoneBarriers,
                    GroundMargin = src.GroundMargin,
                    IncludeGround = src.IncludeGround,
                    UnknownFloorSpeed = src.UnknownFloorSpeed,
                };
    }
}
