using System;
using System.Collections.Generic;
using System.Text;

namespace Metro.Sim {
    // The station walk graph — a port of `buildGraph` in game/src/sim/station.ts,
    // bounded to the traversal this packet can prove (plan 11 C1).
    //
    // **Built from the committed document, never from a saved route.** Every node is
    // a walkable cell the document says exists; every edge is a walk, a ride or a
    // lift the document's own modules describe. No Zoo ID, no fixed graph index, no
    // route prefix: a different save produces a different graph, and a save whose
    // floor does not connect produces islands. What the port covers today, and what
    // it does not, is listed by `StationWalkGraphBuilder.Unported(document)` — the
    // integration reports the list instead of quietly walking a shorter station.
    //
    // Ported: the effective cell list (authored records + the generated street
    // window, including authored grade holes), which solid cells are walkable (no
    // solid above, walkable floor finish), the obstacle families that make a whole
    // cell non-walkable (fence, psd-end, tvm, vending, shelf, road footprint, pillar
    // column, solid stair block, booth counter, gate with no lane, lift shaft,
    // walkway belt), gate policy/servers, 4-neighbour walking plus the clear 2×2
    // diagonal rule, straight escalator/walkway rides with their balustrade walls,
    // straight single-flight stairs (both directions), exit links, platform edges
    // with their door servers, and node/zone/speed facts.
    //
    // Unported and reported: module-derived grade openings (ramp carve, exit pad,
    // street-level track), exit head-house wall planes, walking through a walkway's
    // belt, turning/multi-flight stairs (`cfg.flights`), lift landing rows and lift
    // edges, fixture access for benches/cubicles/sinks, canopy/hanger/AC/electrical
    // post cells, lane-mate rails on wide stairs, crowd ramp-body clearance, and the
    // live zone-barrier gate-direction rule (it needs `ZONES`/`crossingDir`; the
    // option exists and defaults off, which is the shipped `ZONE_LINES_BLOCK`).
    public enum WalkEdgeKind { Walk = 0, Escalator = 1, Stair = 2, Lift = 3, Walkway = 4 }

    /// <summary>One capacity-limited thing a route queues at or rides (a port of the source <c>ServerDef</c>'s stable half).</summary>
    public sealed class StationServerFact {
        public int Id;
        public string Kind = "";
        public string Label = "";
        public int Node = -1;
        /// <summary>Where a ride lets out, or -1 for an in-place server.</summary>
        public int ExitNode = -1;
        /// <summary>Service rate, pax/s.</summary>
        public double Rate;
        /// <summary>Ride time, seconds (vertical modules only).</summary>
        public double Ride;
        public int Batch = 1;
        public int Cycle;
        /// <summary>A gate's policy: -1 exit only, 0 both, 1 entry only.</summary>
        public int GateMode, GateRotation;
        public StationRidePath RidePath;
        public int RideColumns;
        public bool RideReverse;
        /// <summary>Number of stair flights represented by this edge (1 = straight, 2+ = turning/switchback).</summary>
        public int StairFlights = 1;
        /// <summary>Live queue length (0 until the crowd is ported; never invented).</summary>
        public int QueueCount;
        public int Served;
        /// <summary>A lift shaft's stops, bottom → top, and their floor heights.</summary>
        public int[] LiftStops;
        public double[] LiftStopZ;
        /// <summary>Stable activity-stop id for <c>Kind == "stop"</c> servers.</summary>
        public string StopId = "";
    }

    public sealed class StationPlatformFact {
        public string Id = "", Name = "", Line = "", Dir = "", Side = "";
        public int[] Doors = Array.Empty<int>();
        public int[] Cells = Array.Empty<int>();
    }

    public sealed class StationExitFact {
        public string Id = "", Name = "";
        public int Node = -1;
        public bool Closed;
        public bool HasInRate;
        public double InRate;
    }

    /// <summary>One built walk graph. Arrays are indexed by node id; edges are per-node lists in insertion order.</summary>
    public sealed class StationWalkGraph {
        public int NodeCount;
        public string[] NodeKey = Array.Empty<string>();
        public double[] NodeX = Array.Empty<double>(), NodeY = Array.Empty<double>(), NodeZ = Array.Empty<double>();
        public double[] NodeSpeed = Array.Empty<double>();
        public int[] NodeZone = Array.Empty<int>();
        Dictionary<string, int> lazyNodeIndex;
        public Dictionary<string, int> NodeIndex => EnsureNodeIndex();
        internal Dictionary<long, int>[] NodeShards;
        internal int[] WalkComponent;
        internal Dictionary<int, int> CondensationMap;
        internal ulong[][] CondensationReachStandard;
        internal ulong[][] CondensationReachStepFree;
        public IList<int[]> AdjTo = new List<int[]>();
        public IList<double[]> AdjCost = new List<double[]>();
        public IList<int[]> AdjKind = new List<int[]>();
        public IList<int[]> AdjServer = new List<int[]>();
        internal int[][] AdjToRaw;
        internal double[][] AdjCostRaw;
        internal int[][] AdjKindRaw;
        internal int[][] AdjServerRaw;
        public readonly List<StationServerFact> Servers = new List<StationServerFact>();
        public readonly Dictionary<int, int> ServerForNode = new Dictionary<int, int>();
        public readonly List<StationPlatformFact> Platforms = new List<StationPlatformFact>();
        public readonly List<StationExitFact> Exits = new List<StationExitFact>();
        public readonly List<StationActivityStopFact> Stops = new List<StationActivityStopFact>();
        public int MinX, MinY, MaxX, MaxY;
        /// <summary>The station's own walkable floor, m² — one node is one square metre, street excluded.</summary>
        public double StationArea;
        public int[] LevelsZ = Array.Empty<int>();
        /// <summary>Whether this graph was built with §4.5 fare-zone barriers enforced.</summary>
        public bool ZoneBarriers;
        /// <summary>Family names present in the document that this build does not traverse.</summary>
        public string[] Unported = Array.Empty<string>();

        public static string CellKey(int x, int y, int z) => x + "," + y + "," + z;

        Dictionary<string, int> EnsureNodeIndex() {
            if (lazyNodeIndex != null) return lazyNodeIndex;
            var dict = new Dictionary<string, int>(NodeCount, StringComparer.Ordinal);
            if (NodeKey != null) {
                int len = Math.Min(NodeCount, NodeKey.Length);
                for (int i = 0; i < len; i++) {
                    if (NodeKey[i] != null) dict[NodeKey[i]] = i;
                }
            }
            lazyNodeIndex = dict;
            return dict;
        }

        public bool TryNode(int x, int y, int z, out int node) {
            if (NodeShards != null) {
                long pk = StationWalkGraphWorkspace.Pack3(x, y, z);
                return NodeShards[StationWalkGraphWorkspace.ShardOf(pk)].TryGetValue(pk, out node);
            }
            return EnsureNodeIndex().TryGetValue(CellKey(x, y, z), out node);
        }

        public bool TryNode(string key, out int node) {
            if (NodeShards != null && TryParseCellKey(key, out int x, out int y, out int z)) {
                long pk = StationWalkGraphWorkspace.Pack3(x, y, z);
                return NodeShards[StationWalkGraphWorkspace.ShardOf(pk)].TryGetValue(pk, out node);
            }
            if (string.IsNullOrEmpty(key)) { node = -1; return false; }
            return EnsureNodeIndex().TryGetValue(key, out node);
        }

        static bool TryParseCellKey(string key, out int x, out int y, out int z) {
            x = y = z = 0;
            if (string.IsNullOrEmpty(key)) return false;
            int c1 = key.IndexOf(',');
            if (c1 <= 0) return false;
            int c2 = key.IndexOf(',', c1 + 1);
            if (c2 <= c1 + 1 || key.IndexOf(',', c2 + 1) >= 0) return false;
            return TryParseIntSlice(key, 0, c1, out x) &&
                   TryParseIntSlice(key, c1 + 1, c2, out y) &&
                   TryParseIntSlice(key, c2 + 1, key.Length, out z);
        }

        static bool TryParseIntSlice(string s, int start, int end, out int val) {
            val = 0;
            if (start >= end) return false;
            bool neg = false;
            int i = start;
            if (s[i] == '-') { neg = true; i++; if (i >= end) return false; }
            long acc = 0;
            for (; i < end; i++) {
                char ch = s[i];
                if (ch < '0' || ch > '9') return false;
                acc = acc * 10 + (ch - '0');
                if (acc > int.MaxValue) return false;
            }
            val = neg ? -(int)acc : (int)acc;
            return true;
        }

        /// <summary>
        /// Exact O(1) reachability query over undirected <c>Walk</c> components and vertical
        /// condensation bitsets. Returns true conservatively when no component index was built.
        /// </summary>
        public bool CanReach(int start, int goal, bool stepFree = false) {
            if (start < 0 || goal < 0 || start >= NodeCount || goal >= NodeCount) return false;
            if (start == goal) return true;
            if (WalkComponent == null || start >= WalkComponent.Length || goal >= WalkComponent.Length) return true;
            int cs = WalkComponent[start];
            int cg = WalkComponent[goal];
            if (cs == cg && cs != 0) return true;
            var map = CondensationMap;
            var reach = stepFree ? CondensationReachStepFree : CondensationReachStandard;
            if (map == null || reach == null || reach.Length == 0) return false;
            if (!map.TryGetValue(cs, out int ds) || !map.TryGetValue(cg, out int dg)) return false;
            if (ds < 0 || ds >= reach.Length) return false;
            var bits = reach[ds];
            int word = dg >> 6;
            return bits != null && word < bits.Length && (bits[word] & (1UL << (dg & 63))) != 0;
        }

        /// <summary>Total cost of a path of node ids, or NaN when an edge is missing.</summary>
        public double PathCost(IReadOnlyList<int> path) {
            double total = 0;
            for (int i = 1; i < path.Count; i++) {
                double best = double.PositiveInfinity;
                int from = path[i - 1], to = path[i];
                for (int e = 0; e < AdjTo[from].Length; e++) if (AdjTo[from][e] == to && AdjCost[from][e] < best) best = AdjCost[from][e];
                if (double.IsPositiveInfinity(best)) return double.NaN;
                total += best;
            }
            return total;
        }
    }

    public sealed class StationWalkGraphOptions {
        /// <summary>§4.5's fare line. The shipped `ZONE_LINES_BLOCK` is off while the demo's paint is unfinished.</summary>
        public bool ZoneBarriers;
        /// <summary>How far past the station's content the generated street reaches (`GROUND_MARGIN`).</summary>
        public double GroundMargin = 16;
        /// <summary>Materialise the virtual street plane. Off gives the authored station floor only.</summary>
        public bool IncludeGround = true;
        /// <summary>Floor-speed multiplier for a cell whose finish the document did not resolve (concrete).</summary>
        public double UnknownFloorSpeed = 0.9;
    }

    public static class StationWalkGraphBuilder {
        // Mirrors game/src/sim/constants.ts.
        public const double WalkSpeed = 1.34;
        public const double EscalatorSpeed = 0.5;
        public const double StairSpeed = 1.0;
        public const double WalkwaySpeed = WalkSpeed + 0.5;
        public const double EscalatorBand = 0.68;
        public const double EscalatorBalustrade = 0.82;
        public const double EscalatorSkirtInset = 0.08;
        public const double EscalatorRate = 0.5 / 0.4;
        public const double WalkwayRate = WalkwaySpeed / 0.8;
        public const double GateRate = 25.0 / 60.0;
        public const double StairRateUp = 25.0 / 60.0;
        public const double StairRateDown = 33.0 / 60.0;
        public const int GroundZ = 0;
        public const int ZoneOutside = 1;

        /// <summary>Paid-side zone roles: paid (3), platform (4), restricted (5).</summary>
        public static bool IsPaidZone(int zone) => zone >= 3 && zone <= 5;

        /// <summary>Unpaid-side zone roles: none (0), outside (1), unpaid (2).</summary>
        public static bool IsUnpaidZone(int zone) => !IsPaidZone(zone);

        /// <summary>
        /// Fare-line crossing direction from <paramref name="fromZone"/> to <paramref name="toZone"/>:
        /// +1 entering paid, -1 leaving paid, 0 same-side relabel (no crossing).
        /// </summary>
        public static int CrossingDir(int fromZone, int toZone) {
            bool fromPaid = IsPaidZone(fromZone);
            bool toPaid = IsPaidZone(toZone);
            if (fromPaid == toPaid) return 0;
            return toPaid ? 1 : -1;
        }

        /// <summary>Whether a gate with <paramref name="mode"/> (-1 out, 0 both, +1 in) allows <paramref name="dir"/>.</summary>
        public static bool GateAllows(int mode, int dir) =>
            dir == 0 || mode == 0 || (mode > 0 ? dir == 1 : dir == -1);

        /// <summary>Whether a gate lane (<paramref name="lane"/> = committed two-way direction) admits <paramref name="dir"/>.</summary>
        public static bool GateLaneAllows(int mode, int lane, int dir) =>
            mode == 0 ? (lane == 0 || dir == 0 || dir == lane) : GateAllows(mode, dir);

        /// <summary>
        /// Infers the fare-crossing direction when approaching <paramref name="gateNode"/> from
        /// <paramref name="fromNode"/> by scanning the gate's outgoing neighbours (mirrors <c>station.ts:gateApproach</c>).
        /// </summary>
        public static int GateApproach(StationWalkGraph graph, int fromNode, int gateNode) {
            if (graph == null || fromNode < 0 || gateNode < 0 ||
                fromNode >= graph.NodeCount || gateNode >= graph.NodeCount) return 0;
            int fromZone = graph.NodeZone[fromNode];
            var outs = graph.AdjToRaw != null ? graph.AdjToRaw[gateNode] : graph.AdjTo[gateNode];
            for (int e = 0; e < outs.Length; e++) {
                int nb = outs[e];
                if ((uint)nb >= (uint)graph.NodeCount) continue;
                int dir = CrossingDir(fromZone, graph.NodeZone[nb]);
                if (dir != 0) return dir;
            }
            return 0;
        }

        internal static bool GateStepAllowed(bool fromGate, int fromRotation, int fromMode,
            bool toGate, int toRotation, int toMode, int dx, int dy, int fromZone, int toZone,
            bool zoneBarriers) {
            if (fromGate && GateTravelDirection(fromRotation, dx, dy) == 0) return false;
            if (toGate && GateTravelDirection(toRotation, dx, dy) == 0) return false;
            if (!zoneBarriers) return true;
            int dir = CrossingDir(fromZone, toZone);
            if (dir == 0) return true;
            if (fromGate && GateAllows(fromMode, dir)) return true;
            if (toGate && GateAllows(toMode, dir)) return true;
            return false;
        }

        internal static bool GateStepAllowed(bool fromGate, int fromRotation,
            bool toGate, int toRotation, int dx, int dy, int fromZone, int toZone,
            bool zoneBarriers) =>
            GateStepAllowed(fromGate, fromRotation, 0, toGate, toRotation, 0, dx, dy, fromZone, toZone, zoneBarriers);

        internal static bool CrossesFareLine(int fromZone, int toZone) =>
            CrossingDir(fromZone, toZone) != 0;

        internal static int GateTravelDirection(int rotation, int dx, int dy) {
            switch ((rotation % 4 + 4) % 4) {
                case 1: return -dx;
                case 2: return -dy;
                case 3: return dx;
                default: return dy;
            }
        }

        public static StationWalkGraphWorkspace BuildWorkspace(StationSessionDocument document, StationWalkGraphOptions options = null) =>
            StationWalkGraphWorkspace.Build(document, options);

        public static StationWalkGraphWorkspace.StagedResult StageCellDelta(
            StationWalkGraphWorkspace workspace,
            StationSessionDocument nextDocument,
            StationSessionDelta delta,
            StationWalkGraphScratchSlot scratchSlot = null) =>
            workspace.StageCellDelta(nextDocument, delta, scratchSlot);

        public static StationWalkGraph Build(StationSessionDocument document, StationWalkGraphOptions options = null) {
            if (document == null) throw new ArgumentNullException(nameof(document));
            options = options ?? new StationWalkGraphOptions();
            var graph = new StationWalkGraph { ZoneBarriers = options.ZoneBarriers };
            var unported = new List<string>();
            var docCells = document.EnsureCells();

            // ---- effective cells: authored records first, then the generated street, then exit pads.
            var cells = new List<CellShape>();
            var authoredAtGrade = new HashSet<long>();
            var authoredCoords = new HashSet<string>(StringComparer.Ordinal);
            foreach (var cell in docCells) {
                if (cell.Z == GroundZ) authoredAtGrade.Add(Pack(cell.X, cell.Y));
                authoredCoords.Add(StationWalkGraph.CellKey(cell.X, cell.Y, cell.Z));
                cells.Add(new CellShape { X = cell.X, Y = cell.Y, Z = cell.Z, Solid = cell.Solid, Zone = cell.Zone, Speed = double.IsNaN(cell.Speed) ? options.UnknownFloorSpeed : cell.Speed });
            }
            if (options.IncludeGround) AppendGround(cells, document, options, authoredAtGrade, docCells);
            AppendExitFloors(cells, document, options, authoredCoords);

            var solid = new HashSet<string>(StringComparer.Ordinal);
            foreach (var cell in cells) if (cell.Solid) solid.Add(StationWalkGraph.CellKey(cell.X, cell.Y, cell.Z));

            // ---- exclusions: a whole cell that is not walkable even though it is solid.
            var gateLanes = new Dictionary<string, (int Rotation, int Mode)>(StringComparer.Ordinal);
            var fixtureAccess = new Dictionary<string, string>(StringComparer.Ordinal);
            var fixturePairs = new List<(int X, int Y, int Z, int FrontX, int FrontY, int FrontZ)>(4);
            var gateWallCells = new HashSet<string>(StringComparer.Ordinal);
            var fenceCells = new HashSet<string>(StringComparer.Ordinal);
            var boothCells = new HashSet<string>(StringComparer.Ordinal);
            var liftCells = new HashSet<string>(StringComparer.Ordinal);
            foreach (var module in document.Modules) {
                string key = StationWalkGraph.CellKey(module.X, module.Y, module.Z);
                switch (module.Type) {
                    case "gate":
                        if (module.GateHasLane) gateLanes[key] = (module.Rot, module.GateDir);
                        else gateWallCells.Add(key);
                        break;
                    case "fence":
                    case "psd-end":
                        fenceCells.Add(key);
                        break;
                    case "tvm":
                    case "vending":
                        fenceCells.Add(key);
                        break;
                    case "checkout":
                    case "shelf":
                        ShopFixtureBlockedCells(module, (x, y, z) =>
                            fenceCells.Add(StationWalkGraph.CellKey(x, y, z)));
                        break;
                    case "road":
                        for (int x = module.X; x < module.X + Math.Max(1, module.Width); x++)
                            for (int y = module.Y; y < module.Y + Math.Max(1, module.Depth); y++)
                                fenceCells.Add(StationWalkGraph.CellKey(x, y, module.Z));
                        break;
                    case "pillar":
                        for (int z = module.Z; z < module.Z + Math.Max(1, module.Height); z++)
                            fenceCells.Add(StationWalkGraph.CellKey(module.X, module.Y, z));
                        break;
                    case "stair":
                        if (module.Block) fenceCells.Add(key);
                        // A turning stair's middle landing is a model-owned walkable cell
                        // (`stairTurnCells`), and its flights carry their own walls; neither is
                        // ported, so the family is reported rather than half-walked.
                        if (module.RidePath == null && module.HasEndpoints && Math.Abs(module.ToZ - module.FromZ) > 0) unported.Add("stair-flights:" + module.Id);
                        break;
                    case "booth": {
                        int w = Math.Max(1, module.Width), h = Math.Max(1, module.Depth);
                        for (int x = module.X; x < module.X + w; x++)
                            for (int y = module.Y; y < module.Y + h; y++)
                                boothCells.Add(StationWalkGraph.CellKey(x, y, module.Z));
                        break;
                    }
                    case "lift": {
                        LiftBlockedCells(module, (bx, by, bz) =>
                            liftCells.Add(StationWalkGraph.CellKey(bx, by, bz)));
                        unported.Add("lift-stops:" + module.Id);
                        break;
                    }
                    case "escalator":
                        if (module.HasEndpoints) {
                            EscalatorBlockedLowerCells(module, (bx, by, bz) =>
                                fenceCells.Add(StationWalkGraph.CellKey(bx, by, bz)));
                        }
                        break;
                    case "walkway":
                        // The belt is ridden, not walked; its interior cells are not nodes. The
                        // covered-cell helper is not ported, so the family is reported.
                        unported.Add("walkway-belt:" + module.Id);
                        break;
                    case "bench":
                    case "cubicle":
                    case "sink":
                        fixturePairs.Clear();
                        StationActivityStops.FixtureAccessPairs(module, fixturePairs);
                        for (int fp = 0; fp < fixturePairs.Count; fp++) {
                            var pair = fixturePairs[fp];
                            fixtureAccess[StationWalkGraph.CellKey(pair.X, pair.Y, pair.Z)] =
                                StationWalkGraph.CellKey(pair.FrontX, pair.FrontY, pair.FrontZ);
                        }
                        break;
                    case "roof":
                        // A canopy's posts stand on their own cells; `canopyPostCells` is not
                        // ported, so those cells stay walkable until it is. Reported by name.
                        if (module.Variant == "canopy") unported.Add("canopy-posts:" + module.Id);
                        break;
                    case "hanger":
                        unported.Add("hanger-posts:" + module.Id);
                        break;
                    case "ac-unit":
                    case "electrical-cabinet":
                        unported.Add("floor-decor:" + module.Id);
                        break;
                    case "exit":
                        break;
                }
            }

            // ---- nodes: a solid cell with nothing solid above it and a walkable floor.
            var keys = new List<string>();
            var xs = new List<double>();
            var ys = new List<double>();
            var zs = new List<double>();
            var speeds = new List<double>();
            var zones = new List<int>();
            var levelSet = new SortedSet<int>();
            double stationArea = 0;
            int minX = int.MaxValue, minY = int.MaxValue, maxX = int.MinValue, maxY = int.MinValue;
            foreach (var cell in cells) {
                if (!cell.Solid) continue;
                if (solid.Contains(StationWalkGraph.CellKey(cell.X, cell.Y, cell.Z + 1))) continue;
                if (cell.Speed <= 0) continue;
                string key = StationWalkGraph.CellKey(cell.X, cell.Y, cell.Z);
                if (graph.NodeIndex.ContainsKey(key)) continue;
                if (boothCells.Contains(key) || fenceCells.Contains(key) || gateWallCells.Contains(key) ||
                    liftCells.Contains(key)) continue;
                int id = keys.Count;
                graph.NodeIndex[key] = id;
                keys.Add(key);
                xs.Add(cell.X + 0.5);
                ys.Add(cell.Y + 0.5);
                zs.Add(cell.Z + 1);
                speeds.Add(cell.Speed);
                int zone = cell.Zone;
                zones.Add(zone);
                if (zone != ZoneOutside) stationArea++;
                levelSet.Add(cell.Z);
                if (cell.X < minX) minX = cell.X;
                if (cell.Y < minY) minY = cell.Y;
                if (cell.X > maxX) maxX = cell.X;
                if (cell.Y > maxY) maxY = cell.Y;
            }
            graph.NodeCount = keys.Count;
            graph.NodeKey = keys.ToArray();
            graph.NodeX = xs.ToArray();
            graph.NodeY = ys.ToArray();
            graph.NodeZ = zs.ToArray();
            graph.NodeSpeed = speeds.ToArray();
            graph.NodeZone = zones.ToArray();
            graph.StationArea = stationArea;
            graph.MinX = minX == int.MaxValue ? 0 : minX;
            graph.MinY = minY == int.MaxValue ? 0 : minY;
            graph.MaxX = maxX == int.MinValue ? 0 : maxX;
            graph.MaxY = maxY == int.MinValue ? 0 : maxY;
            graph.LevelsZ = new List<int>(levelSet).ToArray();
            for (int i = 0; i < graph.NodeCount; i++) {
                graph.AdjTo.Add(Array.Empty<int>());
                graph.AdjCost.Add(Array.Empty<double>());
                graph.AdjKind.Add(Array.Empty<int>());
                graph.AdjServer.Add(Array.Empty<int>());
            }
            var edges = new EdgeList(graph.NodeCount);

            // ---- ramp barriers: the balustrade of a straight escalator/walkway run.
            var rampWalls = new List<StationWalkGraphBuilder.RampWall>();
            foreach (var module in document.Modules) {
                if (module.Type != "escalator" && module.Type != "walkway") continue;
                if (!module.HasEndpoints) continue;
                int widthBlocks = Math.Max(1, module.Width);
                double half = (EscalatorBalustrade + (widthBlocks - 1) - 2 * EscalatorSkirtInset) / 2;
                AddRampWalls(rampWalls, module, half, unported);
            }

            // ---- exit head-house wall planes (solid glass sides + back wall; doorway stays open).
            var exitWalls = CollectExitWalls(document);

            // ---- 4-neighbour walking, same surface height.
            var cardinalWalk = new HashSet<long>();
            for (int i = 0; i < graph.NodeCount; i++) {
                int x = (int)(graph.NodeX[i] - 0.5);
                int y = (int)(graph.NodeY[i] - 0.5);
                int z = (int)(graph.NodeZ[i] - 1);
                foreach (var step in Cardinal) {
                    int nx = x + step.dx, ny = y + step.dy;
                    string hereKey = StationWalkGraph.CellKey(x, y, z);
                    string thereKey = StationWalkGraph.CellKey(nx, ny, z);
                    if (!graph.NodeIndex.TryGetValue(thereKey, out int j)) continue;
                    if ((fixtureAccess.TryGetValue(hereKey, out var hereFront) && !string.Equals(hereFront, thereKey, StringComparison.Ordinal)) ||
                        (fixtureAccess.TryGetValue(thereKey, out var thereFront) && !string.Equals(thereFront, hereKey, StringComparison.Ordinal))) continue;
                    bool fromGate = gateLanes.TryGetValue(hereKey, out var fromLane);
                    bool toGate = gateLanes.TryGetValue(thereKey, out var toLane);
                    if (!GateStepAllowed(fromGate, fromLane.Rotation, fromLane.Mode,
                            toGate, toLane.Rotation, toLane.Mode, step.dx, step.dy,
                            graph.NodeZone[i], graph.NodeZone[j], options.ZoneBarriers)) continue;
                    if (CrossesExitWall(exitWalls, x + 0.5, y + 0.5, nx + 0.5, ny + 0.5, z)) continue;
                    if (CrossesRampWall(rampWalls, x + 0.5, y + 0.5, nx + 0.5, ny + 0.5, z)) continue;
                    double speed = (graph.NodeSpeed[i] + graph.NodeSpeed[j]) / 2;
                    edges.Add(i, j, 1.0 / (WalkSpeed * speed), WalkEdgeKind.Walk, -1);
                    cardinalWalk.Add((long)i * graph.NodeCount + j);
                }
            }

            // ---- diagonals: legal only inside a clear 2×2 square.
            bool CardinalAllows(int from, int to) => cardinalWalk.Contains((long)from * graph.NodeCount + to);
            for (int i = 0; i < graph.NodeCount; i++) {
                int x = (int)(graph.NodeX[i] - 0.5), y = (int)(graph.NodeY[i] - 0.5), z = (int)(graph.NodeZ[i] - 1);
                string hereKey = StationWalkGraph.CellKey(x, y, z);
                if (gateLanes.ContainsKey(hereKey) || fixtureAccess.ContainsKey(hereKey)) continue;
                foreach (var step in Diagonal) {
                    int nx = x + step.dx, ny = y + step.dy;
                    string thereKey = StationWalkGraph.CellKey(nx, ny, z);
                    string aKey = StationWalkGraph.CellKey(nx, y, z);
                    string bKey = StationWalkGraph.CellKey(x, ny, z);
                    if (!graph.NodeIndex.TryGetValue(thereKey, out int j)) continue;
                    if (!graph.NodeIndex.TryGetValue(aKey, out int a)) continue;
                    if (!graph.NodeIndex.TryGetValue(bKey, out int b)) continue;
                    if (gateLanes.ContainsKey(thereKey) || gateLanes.ContainsKey(aKey) || gateLanes.ContainsKey(bKey)) continue;
                    if (fixtureAccess.ContainsKey(thereKey) || fixtureAccess.ContainsKey(aKey) || fixtureAccess.ContainsKey(bKey)) continue;
                    if (!CardinalAllows(i, a) || !CardinalAllows(a, j) || !CardinalAllows(i, b) || !CardinalAllows(b, j)) continue;
                    if (CrossesExitWall(exitWalls, x + 0.5, y + 0.5, nx + 0.5, ny + 0.5, z)) continue;
                    if (CrossesRampWall(rampWalls, x + 0.5, y + 0.5, nx + 0.5, ny + 0.5, z)) continue;
                    double speed = (graph.NodeSpeed[i] + graph.NodeSpeed[j]) / 2;
                    edges.Add(i, j, Math.Sqrt(2) / (WalkSpeed * speed), WalkEdgeKind.Walk, -1);
                }
            }

            // ---- vertical links and in-place servers, in document order.
            foreach (var module in document.Modules) {
                switch (module.Type) {
                    case "exit": {
                        // A head-house's node is its street opening (`exitDoorCell`), not the cell
                        // under the canopy — so the crowd walks out through the doorway even when
                        // the stairwell cell at (module.X, module.Y, module.Z) is carved open.
                        int node = -1;
                        if (module.HeadHouse) {
                            ExitDoorCell(module, out int dx, out int dy, out int dz);
                            node = NodeAt(graph, dx, dy, dz);
                        }
                        if (node < 0) node = NodeAt(graph, module.X, module.Y, module.Z);
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
                        int node = NodeAt(graph, module.X, module.Y, module.Z);
                        if (node < 0) break;
                        int id = AddServer(graph, new StationServerFact {
                            Kind = "gate", Label = module.GateDir == 0 ? "fare_gate" : module.GateDir > 0 ? "entry_gate" : "exit_gate",
                            Rate = GateRate, Node = node, ExitNode = -1, Batch = 1, GateMode = module.GateDir, GateRotation = module.Rot,
                        });
                        graph.ServerForNode[node] = id;
                        break;
                    }
                    case "escalator":
                    case "walkway": {
                        if (!module.HasEndpoints) break;
                        int a = NodeAt(graph, module.FromX, module.FromY, module.FromZ);
                        int b = NodeAt(graph, module.ToX, module.ToY, module.ToZ);
                        if (a < 0 || b < 0) break;
                        bool walkway = module.Type == "walkway";
                        double horizontal = Math.Sqrt(Pow2(graph.NodeX[a] - graph.NodeX[b]) + Pow2(graph.NodeY[a] - graph.NodeY[b]));
                        double vertical = Math.Abs(graph.NodeZ[a] - graph.NodeZ[b]);
                        double distance = Math.Sqrt(horizontal * horizontal + vertical * vertical);
                        double ride = (module.RidePath?.Length ?? distance) / (walkway ? WalkwaySpeed : EscalatorSpeed);
                        int id = AddServer(graph, new StationServerFact {
                            Kind = walkway ? "walkway" : "escalator",
                            Label = walkway ? "walkway" : module.Dir == "down" ? "down_escalator" : "up_escalator",
                            Rate = (walkway ? WalkwayRate : EscalatorRate) * EffectiveRideWidth(module),
                            Node = a, ExitNode = b, Ride = ride, Batch = 1, Cycle = 0,
                            RidePath = module.RidePath, RideColumns = module.RideColumns,
                        });
                        // The edge and the band both travel from→to; a descending piece is not
                        // a second edge back up (it is one-way, as the source builds it).
                        edges.Add(a, b, ride, walkway ? WalkEdgeKind.Walkway : WalkEdgeKind.Escalator, id);
                        break;
                    }
                    case "stair": {
                        if (!module.HasEndpoints) break;
                        int a = NodeAt(graph, module.FromX, module.FromY, module.FromZ);
                        int b = NodeAt(graph, module.ToX, module.ToY, module.ToZ);
                        if (a < 0 || b < 0) break;
                        double horizontal = Math.Sqrt(Pow2(graph.NodeX[a] - graph.NodeX[b]) + Pow2(graph.NodeY[a] - graph.NodeY[b]));
                        double vertical = Math.Abs(graph.NodeZ[a] - graph.NodeZ[b]);
                        double ride = (module.RidePath?.Length ?? Math.Sqrt(horizontal * horizontal + vertical * vertical)) / StairSpeed;
                        double width = EffectiveRideWidth(module);
                        // Each flight is a two-way capacity-limited edge: the landing below and
                        // the landing above are two servers with opposite rates (§5.1).
                        bool down = graph.NodeZ[a] > graph.NodeZ[b];
                        int stairFlights = Math.Max(1, module.StairFlights);
                        int downId = AddServer(graph, new StationServerFact {
                            Kind = "stair", Label = "stairs",
                            Rate = (down ? StairRateDown : StairRateUp) * width,
                            Node = a, ExitNode = b, Ride = ride, RidePath = module.RidePath,
                            StairFlights = stairFlights,
                        });
                        edges.Add(a, b, ride, WalkEdgeKind.Stair, downId);
                        int upId = AddServer(graph, new StationServerFact {
                            Kind = "stair", Label = "stairs",
                            Rate = (down ? StairRateUp : StairRateDown) * width,
                            Node = b, ExitNode = a, Ride = ride, RidePath = module.RidePath, RideReverse = true,
                            StairFlights = stairFlights,
                        });
                        edges.Add(b, a, ride, WalkEdgeKind.Stair, upId);
                        break;
                    }
                }
            }

            // ---- activity stops and their serialized servers, in document order.
            StationActivityStops.PopulateGraphStops(
                graph,
                document.Modules,
                (sx, sy, sz) => NodeAt(graph, sx, sy, sz),
                srv => AddServer(graph, srv));

            // ---- platform edges: one door server per walkable cell of the run.
            foreach (var module in document.Modules) {
                if (module.Type != "platform-edge") continue;
                var doors = new List<int>();
                var cellsOnRun = new List<int>();
                int runLength = Math.Max(1, module.Width);
                for (int i = 0; i < runLength; i++) {
                    // `edgeCells`: one cell deep, along local +x turned by the saved quarter turn.
                    int dx = 0, dy = 0;
                    switch (((module.Rot % 4) + 4) % 4) {
                        case 1: dy = i; break;
                        case 2: dx = -i; break;
                        case 3: dy = -i; break;
                        default: dx = i; break;
                    }
                    int x = module.X + dx, y = module.Y + dy;
                    int node = NodeAt(graph, x, y, module.Z);
                    if (node < 0) continue;
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

            for (int i = 0; i < graph.NodeCount; i++) {
                graph.AdjTo[i] = edges.To[i].ToArray();
                graph.AdjCost[i] = edges.Cost[i].ToArray();
                graph.AdjKind[i] = edges.Kind[i].ToArray();
                graph.AdjServer[i] = edges.Server[i].ToArray();
            }
            graph.Unported = unported.ToArray();
            return graph;
        }

        // ------------------------------------------------------------------ parts

        struct CellShape { public int X, Y, Z; public bool Solid; public int Zone; public double Speed; }
        struct RampWall { public double Ax, Ay, Bx, By, Z0, Z1, InwardX, InwardY; }
        static readonly (int dx, int dy)[] Cardinal = { (1, 0), (-1, 0), (0, 1), (0, -1) };
        static readonly (int dx, int dy)[] Diagonal = { (1, 1), (1, -1), (-1, 1), (-1, -1) };

        static double Pow2(double v) => v * v;

        static long Pack(int x, int y) => ((long)x << 32) ^ (uint)y;

        static int NodeAt(StationWalkGraph graph, int x, int y, int z) =>
            graph.NodeIndex.TryGetValue(StationWalkGraph.CellKey(x, y, z), out int node) ? node : -1;

        /// <summary>
        /// Port of <c>exitDoorCell</c> (<c>game/src/sim/exits.ts</c>): the street-opening
        /// cell a head-house admits and discharges the crowd through. Uses JS-compatible
        /// half-up rounding (<c>Math.Floor(centre + 0.5)</c>) so even bay counts pick the
        /// exact same middle cell as the web simulation.
        /// </summary>
        internal static void ExitDoorCell(StationModuleFact module, out int x, out int y, out int z) {
            int bays = module.ExitBays == 1 || module.ExitBays == 3 || module.ExitBays == 4 ? module.ExitBays : 2;
            double centre = (bays - 1) * 0.5;
            int lx = (int)Math.Floor(centre + 0.5);
            int ly = module.ExitStyle == "doorway" || module.ExitStyle == "virtual" ? 0 : 2;
            int rot = ((module.Rot % 4) + 4) % 4;
            int dx, dy;
            switch (rot) {
                case 1: dx = -ly; dy = lx; break;
                case 2: dx = -lx; dy = -ly; break;
                case 3: dx = ly; dy = -lx; break;
                default: dx = lx; dy = ly; break;
            }
            x = module.X + dx;
            y = module.Y + dy;
            z = module.Z;
        }

        static int AddServer(StationWalkGraph graph, StationServerFact server) {
            server.Id = graph.Servers.Count;
            graph.Servers.Add(server);
            return server.Id;
        }

        /// <summary>The source <c>withGround</c>: the authored records plus the generated street window.</summary>
        static void AppendGround(List<CellShape> cells, StationSessionDocument document, StationWalkGraphOptions options, HashSet<long> authoredAtGrade, List<StationCellFact> docCells) {
            int x0 = int.MaxValue, y0 = int.MaxValue, x1 = int.MinValue, y1 = int.MinValue;
            void Eat(double x, double y) {
                if (double.IsNaN(x) || double.IsNaN(y) || double.IsInfinity(x) || double.IsInfinity(y)) return;
                if (x < x0) x0 = (int)x;
                if (y < y0) y0 = (int)y;
                if (x > x1) x1 = (int)x;
                if (y > y1) y1 = (int)y;
            }
            foreach (var cell in docCells) Eat(cell.X, cell.Y);
            foreach (var module in document.Modules) {
                Eat(module.X, module.Y);
                if (module.Type == "road") Eat(module.X + Math.Max(1, module.Width) - 1, module.Y + Math.Max(1, module.Depth) - 1);
                if (module.HasEndpoints) { Eat(module.FromX, module.FromY); Eat(module.ToX, module.ToY); }
            }
            if (x0 == int.MaxValue) { x0 = x1 = y0 = y1 = 0; }
            x0 -= (int)options.GroundMargin; x1 += (int)options.GroundMargin;
            y0 -= (int)options.GroundMargin; y1 += (int)options.GroundMargin;
            for (int x = x0; x <= x1; x++) {
                for (int y = y0; y <= y1; y++) {
                    if (authoredAtGrade.Contains(Pack(x, y))) continue;
                    cells.Add(new CellShape { X = x, Y = y, Z = GroundZ, Solid = true, Zone = ZoneOutside, Speed = options.UnknownFloorSpeed });
                }
            }
        }

        internal static double EffectiveRideWidth(StationModuleFact module) =>
            module.RideWidth > 0 ? module.RideWidth : Math.Max(1, module.Width);

        internal static void EscalatorCenterShift(StationModuleFact module, int widthBlocks, double length,
            out double shiftX, out double shiftY) {
            shiftX = shiftY = 0;
            if (widthBlocks <= 1 || length < 1e-6) return;
            bool lowerFirst = module.FromZ != module.ToZ
                ? module.FromZ < module.ToZ
                : module.FromX != module.ToX
                    ? module.FromX < module.ToX
                    : module.FromY < module.ToY;
            double lowX = lowerFirst ? module.FromX : module.ToX;
            double lowY = lowerFirst ? module.FromY : module.ToY;
            double highX = lowerFirst ? module.ToX : module.FromX;
            double highY = lowerFirst ? module.ToY : module.FromY;
            double half = (widthBlocks - 1) * 0.5 / length;
            shiftX = (highY - lowY) * half;
            shiftY = -(highX - lowX) * half;
        }

        internal static void ShopFixtureBlockedCells(StationModuleFact module, Action<int, int, int> addCell) {
            // The document projection supplies the placement footprint's run length.
            int length = module.Width >= 1 && module.Width <= 4 ? module.Width : 1;
            StationServiceCadence.RotateLocal(module.Rot, 1, 0, out double dx, out double dy);
            for (int i = 0; i < length; i++)
                addCell(module.X + i * (int)dx, module.Y + i * (int)dy, module.Z);
        }

        /// <summary>
        /// Interior lower-floor cells directly beneath an inclined escalator's solid lower steps
        /// and truss (headroom &lt; 2.2 m). Blocking these prevents walkers from cutting straight
        /// through the machinery into the foot landing while preserving landing endpoints and
        /// high-headroom floor beneath the upper half.
        /// </summary>
        internal static void LiftBlockedCells(StationModuleFact module, Action<int, int, int> addCell) {
            int size = module.Width >= 3 ? 3 : 2;
            var levels = module.HasEndpoints ? StationLiftStops.Levels(module) : null;
            if (levels != null && levels.Count > 0) {
                for (int l = 0; l < levels.Count; l++) {
                    int z = levels[l];
                    for (int x = module.X; x < module.X + size; x++)
                        for (int y = module.Y; y < module.Y + size; y++)
                            addCell(x, y, z);
                }
                if (!levels.Contains(module.Z)) {
                    for (int x = module.X; x < module.X + size; x++)
                        for (int y = module.Y; y < module.Y + size; y++)
                            addCell(x, y, module.Z);
                }
                return;
            }
            for (int x = module.X; x < module.X + size; x++)
                for (int y = module.Y; y < module.Y + size; y++)
                    addCell(x, y, module.Z);
        }

        internal static void EscalatorBlockedLowerCells(StationModuleFact module, Action<int, int, int> addCell) {
            if (module.Type != "escalator" || !module.HasEndpoints || module.FromZ == module.ToZ) return;
            bool fromLower = module.FromZ < module.ToZ;
            int lowX = fromLower ? module.FromX : module.ToX;
            int lowY = fromLower ? module.FromY : module.ToY;
            int lowZ = fromLower ? module.FromZ : module.ToZ;
            int highX = fromLower ? module.ToX : module.FromX;
            int highY = fromLower ? module.ToY : module.FromY;
            int highZ = fromLower ? module.ToZ : module.FromZ;
            int dx = highX - lowX, dy = highY - lowY;
            double horizontal = Math.Sqrt((double)dx * dx + (double)dy * dy);
            int rise = highZ - lowZ;
            if (horizontal < 1.5 || rise <= 0) return;
            int steps = Math.Max(Math.Abs(dx), Math.Abs(dy));
            int widthBlocks = Math.Max(1, module.Width);
            double ux = dx / horizontal, uy = dy / horizontal;
            double lx = dy / horizontal, ly = -dx / horizontal;
            for (int s = 1; s < steps; s++) {
                if (rise * (s / horizontal) >= 2.2) break;
                int cx = lowX + (int)Math.Round(ux * s);
                int cy = lowY + (int)Math.Round(uy * s);
                for (int lane = 0; lane < widthBlocks; lane++) {
                    int bx = cx + (int)Math.Round(lx * lane);
                    int by = cy + (int)Math.Round(ly * lane);
                    if ((bx == lowX && by == lowY) || (bx == highX && by == highY)) continue;
                    addCell(bx, by, lowZ);
                }
            }
        }

        static void AddRampWalls(List<RampWall> walls, StationModuleFact module, double half, List<string> unported) {
            double dx = module.ToX - module.FromX, dy = module.ToY - module.FromY;
            double length = Math.Sqrt(dx * dx + dy * dy);
            if (length < 1e-6) return; // a vertical run has no sides to cross
            EscalatorCenterShift(module, Math.Max(1, module.Width), length, out double shiftX, out double shiftY);
            double ax = module.FromX + 0.5 + shiftX, ay = module.FromY + 0.5 + shiftY;
            double ux = dx / length, uy = dy / length;
            const double extend = 0.6;
            for (int s = 1; s >= -1; s -= 2) {
                double ox = -uy * half * s, oy = ux * half * s;
                walls.Add(new RampWall {
                    Ax = ax - ux * extend + ox, Ay = ay - uy * extend + oy,
                    Bx = ax + dx + ux * extend + ox, By = ay + dy + uy * extend + oy,
                    Z0 = Math.Min(module.FromZ, module.ToZ), Z1 = Math.Max(module.FromZ, module.ToZ),
                    InwardX = uy * s, InwardY = -ux * s,
                });
            }
            if (module.Type == "stair") unported.Add("stair-rails:" + module.Id);
        }

        static bool CrossesRampWall(List<RampWall> walls, double x, double y, double nx, double ny, int z) {
            foreach (var w in walls) {
                if (z < w.Z0 || z > w.Z1) continue;
                if (SegmentCross(x, y, nx, ny, w.Ax, w.Ay, w.Bx, w.By)) return true;
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

        // ------------------------------------------------------------- exit enclosure & derived floor

        public const double ExitHeight = 3.2;
        public const double ExitBackY = -5.5;
        public const double ExitFrontY = 2.3;
        public const double ExitGlassY0 = -5.5;
        public const double ExitGlassY1 = 1.8;
        public const double ExitWallInset = 0.06;

        internal struct ExitWallPlane {
            public bool AxisX;
            public double At, Min, Max, Z0, Z1;
            public double Ax, Ay, Bx, By;
        }

        /// <summary>
        /// True when <paramref name="module"/> is an enclosed head-house exit (not <c>headHouse: false</c>,
        /// not <c>doorway</c>, not <c>virtual</c>). Mirrors <c>isExitHeadHouse</c> + <c>headHouse !== false</c>.
        /// </summary>
        internal static bool HasHeadHouseShell(StationModuleFact module) {
            if (module.Type != "exit" || !module.HeadHouse) return false;
            return !string.Equals(module.ExitStyle, "doorway", StringComparison.Ordinal) &&
                   !string.Equals(module.ExitStyle, "virtual", StringComparison.Ordinal);
        }

        public static void ExitRotate(double lx, double ly, int rot, out double wx, out double wy) {
            switch (((rot % 4) + 4) % 4) {
                case 1: wx = -ly; wy = lx; break;
                case 2: wx = -lx; wy = -ly; break;
                case 3: wx = ly; wy = -lx; break;
                default: wx = lx; wy = ly; break;
            }
        }

        internal static void ExitSpan(StationModuleFact module, out double centre, out double half) {
            int bays = module.ExitBays == 1 || module.ExitBays == 3 || module.ExitBays == 4 ? module.ExitBays : 2;
            centre = (bays - 1) * 0.5;
            half = (bays + 2) * 0.5;
        }

        internal static void ExitWallPlanesFor(StationModuleFact module, List<ExitWallPlane> output) {
            if (!HasHeadHouseShell(module)) return;
            double cx = module.X + 0.5;
            double cy = module.Y + 0.5;
            int rot = ((module.Rot % 4) + 4) % 4;
            ExitSpan(module, out double centre, out double half);
            double side = half - ExitWallInset;
            double z0 = module.Z;
            double z1 = module.Z + ExitHeight;

            void AddSeg(double lx0, double ly0, double lx1, double ly1) {
                ExitRotate(lx0, ly0, rot, out double ax, out double ay);
                ExitRotate(lx1, ly1, rot, out double bx, out double by);
                double wax = cx + ax, way = cy + ay, wbx = cx + bx, wby = cy + by;
                if (Math.Abs(ax - bx) < 1e-9) {
                    output.Add(new ExitWallPlane {
                        AxisX = true,
                        At = wax,
                        Min = Math.Min(way, wby),
                        Max = Math.Max(way, wby),
                        Z0 = z0,
                        Z1 = z1,
                        Ax = wax, Ay = way, Bx = wbx, By = wby,
                    });
                } else {
                    output.Add(new ExitWallPlane {
                        AxisX = false,
                        At = way,
                        Min = Math.Min(wax, wbx),
                        Max = Math.Max(wax, wbx),
                        Z0 = z0,
                        Z1 = z1,
                        Ax = wax, Ay = way, Bx = wbx, By = wby,
                    });
                }
            }

            AddSeg(centre - side, ExitGlassY0, centre - side, ExitGlassY1);
            AddSeg(centre + side, ExitGlassY0, centre + side, ExitGlassY1);
            AddSeg(centre - side, ExitBackY, centre + side, ExitBackY);
        }

        internal static void ExitFootprintCellsFor(StationModuleFact module, List<(int X, int Y, int Z)> output) {
            if (!HasHeadHouseShell(module)) return;
            double cx = module.X + 0.5;
            double cy = module.Y + 0.5;
            int rot = ((module.Rot % 4) + 4) % 4;
            ExitSpan(module, out double centre, out double half);
            double lo = centre - half;
            double hi = centre + half;
            double x0 = double.PositiveInfinity, y0 = double.PositiveInfinity;
            double x1 = double.NegativeInfinity, y1 = double.NegativeInfinity;
            (double lx, double ly)[] corners = {
                (lo, ExitBackY), (hi, ExitBackY), (lo, ExitFrontY), (hi, ExitFrontY),
            };
            for (int c = 0; c < corners.Length; c++) {
                ExitRotate(corners[c].lx, corners[c].ly, rot, out double wx, out double wy);
                double px = cx + wx, py = cy + wy;
                if (px < x0) x0 = px;
                if (px > x1) x1 = px;
                if (py < y0) y0 = py;
                if (py > y1) y1 = py;
            }
            int ix0 = (int)Math.Floor(x0);
            int iy0 = (int)Math.Floor(y0);
            for (int x = ix0; x < x1; x++) {
                for (int y = iy0; y < y1; y++) {
                    output.Add((x, y, module.Z));
                }
            }
        }

        static void AppendExitFloors(List<CellShape> cells, StationSessionDocument document,
            StationWalkGraphOptions options, HashSet<string> authoredCoords) {
            var fp = new List<(int X, int Y, int Z)>(48);
            var added = new HashSet<string>(StringComparer.Ordinal);
            foreach (var module in document.Modules) {
                if (!HasHeadHouseShell(module)) continue;
                fp.Clear();
                ExitFootprintCellsFor(module, fp);
                for (int i = 0; i < fp.Count; i++) {
                    var (x, y, z) = fp[i];
                    string key = StationWalkGraph.CellKey(x, y, z);
                    if (authoredCoords.Contains(key) || !added.Add(key)) continue;
                    cells.Add(new CellShape {
                        X = x, Y = y, Z = z, Solid = true,
                        Zone = ZoneOutside, Speed = options.UnknownFloorSpeed,
                    });
                }
            }
        }

        static List<ExitWallPlane> CollectExitWalls(StationSessionDocument document) {
            var walls = new List<ExitWallPlane>();
            foreach (var module in document.Modules) {
                if (HasHeadHouseShell(module)) ExitWallPlanesFor(module, walls);
            }
            return walls;
        }

        static bool CrossesExitWall(List<ExitWallPlane> walls, double x, double y, double nx, double ny, int z) {
            for (int i = 0; i < walls.Count; i++) {
                var w = walls[i];
                if (z < w.Z0 || z > w.Z1) continue;
                if (w.AxisX) {
                    if ((x - w.At) * (nx - w.At) >= 0) continue;
                    double cy = y + ((w.At - x) / (nx - x)) * (ny - y);
                    if (cy > w.Min && cy < w.Max) return true;
                } else {
                    if ((y - w.At) * (ny - w.At) >= 0) continue;
                    double cx = x + ((w.At - y) / (ny - y)) * (nx - x);
                    if (cx > w.Min && cx < w.Max) return true;
                }
            }
            return false;
        }

        sealed class EdgeList {
            public readonly List<int>[] To;
            public readonly List<double>[] Cost;
            public readonly List<int>[] Kind;
            public readonly List<int>[] Server;
            public EdgeList(int count) {
                To = new List<int>[count]; Cost = new List<double>[count];
                Kind = new List<int>[count]; Server = new List<int>[count];
                for (int i = 0; i < count; i++) {
                    To[i] = new List<int>(); Cost[i] = new List<double>();
                    Kind[i] = new List<int>(); Server[i] = new List<int>();
                }
            }
            public void Add(int from, int to, double cost, WalkEdgeKind kind, int server) {
                To[from].Add(to); Cost[from].Add(cost); Kind[from].Add((int)kind); Server[from].Add(server);
            }
        }
    }
}
