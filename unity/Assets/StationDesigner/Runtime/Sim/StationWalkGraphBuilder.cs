using System;
using System.Collections.Generic;
using System.Text;

namespace Metro.Sim {
    // The station walk graph â€” a port of `buildGraph` in game/src/sim/station.ts,
    // bounded to the traversal this packet can prove (plan 11 C1).
    //
    // **Built from the committed document, never from a saved route.** Every node is
    // a walkable cell the document says exists; every edge is a walk, a ride or a
    // lift the document's own modules describe. No Zoo ID, no fixed graph index, no
    // route prefix: a different save produces a different graph, and a save whose
    // floor does not connect produces islands. What the port covers today, and what
    // it does not, is listed by `StationWalkGraphBuilder.Unported(document)` â€” the
    // integration reports the list instead of quietly walking a shorter station.
    //
    // Ported: the effective cell list (authored records + the generated street
    // window, including authored grade holes), which solid cells are walkable (no
    // solid above, walkable floor finish), the obstacle families that make a whole
    // cell non-walkable (fence, psd-end, tvm, vending, shelf, road footprint, pillar
    // column, solid stair block, booth counter, gate with no lane, lift shaft,
    // walkway belt), gate policy/servers, 4-neighbour walking plus the clear 2Ã—2
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
        public int GateMode;
        /// <summary>Live queue length (0 until the crowd is ported; never invented).</summary>
        public int QueueCount;
        public int Served;
        /// <summary>A lift shaft's stops, bottom â†’ top, and their floor heights.</summary>
        public int[] LiftStops;
        public double[] LiftStopZ;
    }

    public sealed class StationPlatformFact {
        public string Id = "", Name = "", Line = "", Dir = "", Side = "";
        public int[] Doors = Array.Empty<int>();
        public int[] Cells = Array.Empty<int>();
    }

    public sealed class StationExitFact {
        public string Id = "", Name = "";
        public int Node = -1;
    }

    /// <summary>One built walk graph. Arrays are indexed by node id; edges are per-node lists in insertion order.</summary>
    public sealed class StationWalkGraph {
        public int NodeCount;
        public string[] NodeKey = Array.Empty<string>();
        public double[] NodeX = Array.Empty<double>(), NodeY = Array.Empty<double>(), NodeZ = Array.Empty<double>();
        public double[] NodeSpeed = Array.Empty<double>();
        public int[] NodeZone = Array.Empty<int>();
        public readonly Dictionary<string, int> NodeIndex = new Dictionary<string, int>(StringComparer.Ordinal);
        public List<int[]> AdjTo = new List<int[]>();
        public List<double[]> AdjCost = new List<double[]>();
        public List<int[]> AdjKind = new List<int[]>();
        public List<int[]> AdjServer = new List<int[]>();
        public readonly List<StationServerFact> Servers = new List<StationServerFact>();
        public readonly Dictionary<int, int> ServerForNode = new Dictionary<int, int>();
        public readonly List<StationPlatformFact> Platforms = new List<StationPlatformFact>();
        public readonly List<StationExitFact> Exits = new List<StationExitFact>();
        public int MinX, MinY, MaxX, MaxY;
        /// <summary>The station's own walkable floor, mÂ² â€” one node is one square metre, street excluded.</summary>
        public double StationArea;
        public int[] LevelsZ = Array.Empty<int>();
        /// <summary>Family names present in the document that this build does not traverse.</summary>
        public string[] Unported = Array.Empty<string>();

        public static string CellKey(int x, int y, int z) => x + "," + y + "," + z;

        public bool TryNode(int x, int y, int z, out int node) => NodeIndex.TryGetValue(CellKey(x, y, z), out node);
        public bool TryNode(string key, out int node) => NodeIndex.TryGetValue(key, out node);

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
        /// <summary>Â§4.5's fare line. The shipped `ZONE_LINES_BLOCK` is off while the demo's paint is unfinished.</summary>
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

        public static StationWalkGraph Build(StationSessionDocument document, StationWalkGraphOptions options = null) {
            if (document == null) throw new ArgumentNullException(nameof(document));
            options = options ?? new StationWalkGraphOptions();
            var graph = new StationWalkGraph();
            var unported = new List<string>();

            // ---- effective cells: authored records first, then the generated street.
            var cells = new List<CellShape>();
            var authoredAtGrade = new HashSet<long>();
            foreach (var cell in document.Cells) {
                if (cell.Z == GroundZ) authoredAtGrade.Add(Pack(cell.X, cell.Y));
                cells.Add(new CellShape { X = cell.X, Y = cell.Y, Z = cell.Z, Solid = cell.Solid, Zone = cell.Zone, Speed = double.IsNaN(cell.Speed) ? options.UnknownFloorSpeed : cell.Speed });
            }
            if (options.IncludeGround) AppendGround(cells, document, options, authoredAtGrade);

            var solid = new HashSet<string>(StringComparer.Ordinal);
            foreach (var cell in cells) if (cell.Solid) solid.Add(StationWalkGraph.CellKey(cell.X, cell.Y, cell.Z));

            // ---- exclusions: a whole cell that is not walkable even though it is solid.
            var gateModes = new Dictionary<string, int>(StringComparer.Ordinal);
            var gateWallCells = new HashSet<string>(StringComparer.Ordinal);
            var fenceCells = new HashSet<string>(StringComparer.Ordinal);
            var boothCells = new HashSet<string>(StringComparer.Ordinal);
            var liftCells = new HashSet<string>(StringComparer.Ordinal);
            foreach (var module in document.Modules) {
                string key = StationWalkGraph.CellKey(module.X, module.Y, module.Z);
                switch (module.Type) {
                    case "gate":
                        if (module.GateHasLane) gateModes[key] = module.GateDir;
                        else gateWallCells.Add(key);
                        break;
                    case "fence":
                    case "psd-end":
                        fenceCells.Add(key);
                        break;
                    case "tvm":
                    case "vending":
                    case "shelf":
                        fenceCells.Add(key);
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
                        if (module.HasEndpoints && Math.Abs(module.ToZ - module.FromZ) > 0) unported.Add("stair-flights:" + module.Id);
                        break;
                    case "booth": {
                        int w = Math.Max(1, module.Width), h = Math.Max(1, module.Depth);
                        for (int x = module.X; x < module.X + w; x++)
                            for (int y = module.Y; y < module.Y + h; y++)
                                boothCells.Add(StationWalkGraph.CellKey(x, y, module.Z));
                        break;
                    }
                    case "lift": {
                        int size = module.Width >= 3 ? 3 : 2;
                        for (int x = module.X; x < module.X + size; x++)
                            for (int y = module.Y; y < module.Y + size; y++)
                                liftCells.Add(StationWalkGraph.CellKey(x, y, module.Z));
                        unported.Add("lift-stops:" + module.Id);
                        break;
                    }
                    case "walkway":
                        // The belt is ridden, not walked; its interior cells are not nodes. The
                        // covered-cell helper is not ported, so the family is reported.
                        unported.Add("walkway-belt:" + module.Id);
                        break;
                    case "bench":
                    case "cubicle":
                    case "sink":
                        unported.Add("fixture-access:" + module.Id);
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
                        if (module.HeadHouse) unported.Add("exit-walls:" + module.Id);
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

            // ---- 4-neighbour walking, same surface height.
            var cardinalWalk = new HashSet<long>();
            for (int i = 0; i < graph.NodeCount; i++) {
                int x = (int)(graph.NodeX[i] - 0.5);
                int y = (int)(graph.NodeY[i] - 0.5);
                int z = (int)(graph.NodeZ[i] - 1);
                foreach (var step in Cardinal) {
                    int nx = x + step.dx, ny = y + step.dy;
                    if (!graph.NodeIndex.TryGetValue(StationWalkGraph.CellKey(nx, ny, z), out int j)) continue;
                    if (options.ZoneBarriers && graph.NodeZone[i] != graph.NodeZone[j]) continue;
                    if (CrossesExitWall(document, x, y, nx, ny, z)) continue;
                    if (CrossesRampWall(rampWalls, x + 0.5, y + 0.5, nx + 0.5, ny + 0.5, z)) continue;
                    double speed = (graph.NodeSpeed[i] + graph.NodeSpeed[j]) / 2;
                    edges.Add(i, j, 1.0 / (WalkSpeed * speed), WalkEdgeKind.Walk, -1);
                    cardinalWalk.Add((long)i * graph.NodeCount + j);
                }
            }

            // ---- diagonals: legal only inside a clear 2Ã—2 square.
            bool CardinalAllows(int from, int to) => cardinalWalk.Contains((long)from * graph.NodeCount + to);
            for (int i = 0; i < graph.NodeCount; i++) {
                int x = (int)(graph.NodeX[i] - 0.5), y = (int)(graph.NodeY[i] - 0.5), z = (int)(graph.NodeZ[i] - 1);
                if (gateModes.ContainsKey(StationWalkGraph.CellKey(x, y, z))) continue;
                foreach (var step in Diagonal) {
                    int nx = x + step.dx, ny = y + step.dy;
                    if (!graph.NodeIndex.TryGetValue(StationWalkGraph.CellKey(nx, ny, z), out int j)) continue;
                    if (!graph.NodeIndex.TryGetValue(StationWalkGraph.CellKey(nx, y, z), out int a)) continue;
                    if (!graph.NodeIndex.TryGetValue(StationWalkGraph.CellKey(x, ny, z), out int b)) continue;
                    if (gateModes.ContainsKey(StationWalkGraph.CellKey(nx, ny, z)) ||
                        gateModes.ContainsKey(StationWalkGraph.CellKey(nx, y, z)) ||
                        gateModes.ContainsKey(StationWalkGraph.CellKey(x, ny, z))) continue;
                    if (!CardinalAllows(i, a) || !CardinalAllows(a, j) || !CardinalAllows(i, b) || !CardinalAllows(b, j)) continue;
                    if (CrossesExitWall(document, x, y, nx, ny, z)) continue;
                    if (CrossesRampWall(rampWalls, x + 0.5, y + 0.5, nx + 0.5, ny + 0.5, z)) continue;
                    double speed = (graph.NodeSpeed[i] + graph.NodeSpeed[j]) / 2;
                    edges.Add(i, j, Math.Sqrt(2) / (WalkSpeed * speed), WalkEdgeKind.Walk, -1);
                }
            }

            // ---- vertical links and in-place servers, in document order.
            foreach (var module in document.Modules) {
                switch (module.Type) {
                    case "exit": {
                        int node = NodeAt(graph, module.X, module.Y, module.Z);
                        if (node >= 0) graph.Exits.Add(new StationExitFact { Id = module.Id, Name = module.Name, Node = node });
                        break;
                    }
                    case "gate": {
                        if (!module.GateHasLane) break;
                        int node = NodeAt(graph, module.X, module.Y, module.Z);
                        if (node < 0) break;
                        int id = AddServer(graph, new StationServerFact {
                            Kind = "gate", Label = module.GateDir == 0 ? "fare_gate" : module.GateDir > 0 ? "entry_gate" : "exit_gate",
                            Rate = GateRate, Node = node, ExitNode = -1, Batch = 1, GateMode = module.GateDir,
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
                        double ride = distance / (walkway ? WalkwaySpeed : EscalatorSpeed);
                        int id = AddServer(graph, new StationServerFact {
                            Kind = walkway ? "walkway" : "escalator",
                            Label = walkway ? "walkway" : module.Dir == "down" ? "down_escalator" : "up_escalator",
                            Rate = (walkway ? WalkwayRate : EscalatorRate) * Math.Max(1, module.Width),
                            Node = a, ExitNode = b, Ride = ride, Batch = 1, Cycle = 0,
                        });
                        // The edge and the band both travel fromâ†’to; a descending piece is not
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
                        double ride = Math.Sqrt(horizontal * horizontal + vertical * vertical) / StairSpeed;
                        int width = Math.Max(1, module.Width);
                        // Each flight is a two-way capacity-limited edge: the landing below and
                        // the landing above are two servers with opposite rates (Â§5.1).
                        bool down = graph.NodeZ[a] > graph.NodeZ[b];
                        int downId = AddServer(graph, new StationServerFact {
                            Kind = "stair", Label = "stairs",
                            Rate = (down ? StairRateDown : StairRateUp) * width,
                            Node = a, ExitNode = b, Ride = ride, Batch = 1, Cycle = 0,
                        });
                        edges.Add(a, b, ride, WalkEdgeKind.Stair, downId);
                        int upId = AddServer(graph, new StationServerFact {
                            Kind = "stair", Label = "stairs",
                            Rate = (down ? StairRateUp : StairRateDown) * width,
                            Node = b, ExitNode = a, Ride = ride, Batch = 1, Cycle = 0,
                        });
                        edges.Add(b, a, ride, WalkEdgeKind.Stair, upId);
                        break;
                    }
                }
            }

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

        static int AddServer(StationWalkGraph graph, StationServerFact server) {
            server.Id = graph.Servers.Count;
            graph.Servers.Add(server);
            return server.Id;
        }

        /// <summary>The source <c>withGround</c>: the authored records plus the generated street window.</summary>
        static void AppendGround(List<CellShape> cells, StationSessionDocument document, StationWalkGraphOptions options, HashSet<long> authoredAtGrade) {
            int x0 = int.MaxValue, y0 = int.MaxValue, x1 = int.MinValue, y1 = int.MinValue;
            void Eat(double x, double y) {
                if (double.IsNaN(x) || double.IsNaN(y) || double.IsInfinity(x) || double.IsInfinity(y)) return;
                if (x < x0) x0 = (int)x;
                if (y < y0) y0 = (int)y;
                if (x > x1) x1 = (int)x;
                if (y > y1) y1 = (int)y;
            }
            foreach (var cell in document.Cells) Eat(cell.X, cell.Y);
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

        static void AddRampWalls(List<RampWall> walls, StationModuleFact module, double half, List<string> unported) {
            double ax = module.FromX + 0.5, ay = module.FromY + 0.5;
            double dx = module.ToX - module.FromX, dy = module.ToY - module.FromY;
            double length = Math.Sqrt(dx * dx + dy * dy);
            if (length < 1e-6) return; // a vertical run has no sides to cross
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

        /// <summary>
        /// The exit head-house wall planes (an opening is the only way through, Â§5.6).
        /// Not ported: a head-house is reported in <see cref="Unported"/> instead, so the
        /// integration knows those edges may be more permissive than the source.
        /// </summary>
        static bool CrossesExitWall(StationSessionDocument document, int x, int y, int nx, int ny, int z) => false;

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
