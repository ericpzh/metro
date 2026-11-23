using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Metro.Sim;

namespace Metro.Build {
    /// <summary>Source <c>roadLayout</c> facts for one authored rectangle.</summary>
    public readonly struct RoadLayoutFacts {
        public readonly bool AcrossX;
        public readonly double Width;
        public readonly double Length;
        public readonly int Lanes;
        public readonly double LaneWidth;

        public RoadLayoutFacts(bool acrossX, double width, double length, int lanes, double laneWidth) {
            AcrossX = acrossX; Width = width; Length = length; Lanes = lanes; LaneWidth = laneWidth;
        }
    }

    public enum RoadTurn { Left, Straight, Right }

    public enum RoadSignalPhase { Red, Amber, Green }

    /// <summary>A controlled crossing or an uncontrolled lane-merge rectangle.</summary>
    public sealed class RoadJunction {
        public double X0, Y0, X1, Y1, Z;
        public string Id = "";
        public bool Uncontrolled;
        public int VerticalGreen, HorizontalGreen;

        public override string ToString() => $"{Id} [{X0},{Y0}..{X1},{Y1}] z{Z}";
    }

    /// <summary>A directed lane stretch, including the zero-length-entry turn connectors.</summary>
    public sealed class RoadEdge {
        public StationRoadRecord Road;
        public int Lane;
        public int Sign;
        public bool Axis;
        public RoadPosition Start;
        public RoadPosition End;
        public double Length;
        public readonly List<int> Next = new List<int>();
        public int Junction = -1;
        public bool HasControl;
        public RoadPosition Control;

        public override string ToString() => $"{Road.Id} lane{Lane} sign{Sign} {Start}->{End} len{Length:R}";
    }

    public sealed class RoadNetwork {
        public readonly List<StationRoadRecord> Roads = new List<StationRoadRecord>();
        public readonly List<RoadJunction> Junctions = new List<RoadJunction>();
        public readonly List<RoadEdge> Edges = new List<RoadEdge>();
        public readonly List<int> Entries = new List<int>();
    }

    public readonly struct RoadJunctionSide {
        public readonly int Junction;
        public readonly string Road;
        public readonly bool Axis;
        /// <summary>Direction of travel as the side leaves the junction (+1/-1).</summary>
        public readonly int Out;
        public readonly double Boundary;

        public RoadJunctionSide(int junction, string road, bool axis, int direction, double boundary) {
            Junction = junction; Road = road; Axis = axis; Out = direction; Boundary = boundary;
        }
    }

    /// <summary>Per-cell facts the placement guard asks about. Metadata only; the host fills it.</summary>
    public interface IRoadSurfaceContext {
        bool IsSolid(int x, int y, double z);
        bool IsExitFloor(int x, int y, double z);
        bool IsGroundHole(int x, int y, double z);
        bool IsTrack(int x, int y, double z);
        /// <summary>True when another module's placement envelope overlaps the candidate.</summary>
        bool OverlapsModuleEnvelope(StationRoadRecord candidate);
    }

    public enum RoadSurfaceReason { None, Ground, Track, Occupied }

    /// <summary>
    /// Port of <c>game/src/sim/roads.ts</c>, <c>roadLaneMovements.ts</c> and
    /// <c>roadNetwork.ts</c>. All results are derived; the saved document keeps only
    /// <see cref="StationRoadRecord"/> values.
    /// </summary>
    public static class StationRoadLayout {
        public const double LaneWidthConstant = 3;
        public const double CrosswalkDepth = 2;
        public const double NodeSnapRadius = 3;

        /* ------------------------------------------------------------- roads.ts */

        public static RoadLayoutFacts Layout(StationRoadRecord road) {
            if (road == null) throw new ArgumentNullException(nameof(road));
            bool acrossX = Turn(road.Rotation) % 2 == 0;
            double width = acrossX ? road.W : road.D;
            double length = acrossX ? road.D : road.W;
            int lanes = road.TwoWay
                ? (int)Math.Floor(width / (LaneWidthConstant * 2)) * 2
                : (int)Math.Floor(width / LaneWidthConstant);
            return new RoadLayoutFacts(acrossX, width, length, lanes, width / Math.Max(1, lanes));
        }

        public static RoadPosition Point(StationRoadRecord road, double across, double along) =>
            Turn(road.Rotation) % 2 == 0
                ? new RoadPosition(road.X + across, road.Y + along)
                : new RoadPosition(road.X + along, road.Y + across);

        /// <summary>
        /// Clips paint against overlapping roads at the same elevation. A collinear
        /// shared cap is drawn once, owned by the earlier ID, so continuous ink does
        /// not get erased twice.
        /// </summary>
        public static List<(double Lo, double Hi)> InkIntervals(StationRoadRecord road, IEnumerable<StationRoadRecord> modules,
            double across, double junctionMargin = 0) {
            var layout = Layout(road);
            var spans = new List<(double Lo, double Hi)> { (0, layout.Length) };
            if (modules == null) return spans;
            foreach (var other in modules) {
                if (other == null || other.Type != "road" || other.Id == road.Id || other.Z != road.Z) continue;
                var otherLayout = Layout(other);
                if (otherLayout.AcrossX == layout.AcrossX &&
                    (layout.AcrossX ? other.X == road.X && other.W == road.W : other.Y == road.Y && other.D == road.D) &&
                    string.CompareOrdinal(other.Id, road.Id) > 0) continue;
                double cross = (layout.AcrossX ? road.X : road.Y) + across;
                double cross0 = layout.AcrossX ? other.X : other.Y;
                double cross1 = cross0 + (layout.AcrossX ? other.W : other.D);
                if (cross < cross0 || cross > cross1) continue;
                double margin = otherLayout.AcrossX != layout.AcrossX ? junctionMargin : 0;
                double lo = (layout.AcrossX ? other.Y - road.Y : other.X - road.X) - margin;
                double hi = lo + (layout.AcrossX ? other.D : other.W) + margin * 2;
                var next = new List<(double Lo, double Hi)>();
                foreach (var span in spans) {
                    if (hi <= span.Lo || lo >= span.Hi) { next.Add(span); continue; }
                    if (span.Lo < lo) next.Add((span.Lo, lo));
                    if (hi < span.Hi) next.Add((hi, span.Hi));
                }
                spans = next;
            }
            return spans;
        }

        /// <summary>Source <c>roadFromDrag</c> (legacy strokes have no explicit endpoints).</summary>
        public static StationRoadRecord FromDrag(IReadOnlyList<double> a, IReadOnlyList<double> b, int rot,
            string direction, string id) {
            int w = (int)(Math.Abs(a[0] - b[0]) + 1);
            int d = (int)(Math.Abs(a[1] - b[1]) + 1);
            bool swapped = Turn(rot) % 2 != 0;
            return StationRoadRecord.Create(id, (int)Math.Min(a[0], b[0]), (int)Math.Min(a[1], b[1]), a[2],
                swapped ? d : w, swapped ? w : d, ((w > d ? 1 : 0) + rot) % 4, direction);
        }

        public static uint Hash(string text) => RoadTrafficSignals.Hash(text);

        /// <summary>Roads cut pedestrian paths on their own floor only.</summary>
        public static bool ContainsPoint(IEnumerable<StationRoadRecord> roads, double x, double y, double floorZ) {
            if (roads == null) return false;
            foreach (var r in roads)
                if (r != null && r.Z == floorZ && x >= r.X && x < r.X + r.W && y >= r.Y && y < r.Y + r.D) return true;
            return false;
        }

        /// <summary>Clips the whole movement segment against each road rectangle.</summary>
        public static bool MoveClear(IEnumerable<StationRoadRecord> roads, double x, double y, double nx, double ny,
            double floorZ) {
            if (roads == null) return true;
            foreach (var r in roads) {
                if (r == null || r.Z != floorZ) continue;
                double enter = 0, exit = 1;
                foreach (var (start, end, lo, hi) in new[] {
                    (x, nx, (double)r.X, (double)r.X + r.W),
                    (y, ny, (double)r.Y, (double)r.Y + r.D),
                }) {
                    double delta = end - start;
                    if (Math.Abs(delta) < 1e-12) {
                        if (start <= lo || start >= hi) { enter = 1; exit = 0; break; }
                    } else {
                        double a = (lo - start) / delta, b = (hi - start) / delta;
                        enter = Math.Max(enter, Math.Min(a, b));
                        exit = Math.Min(exit, Math.Max(a, b));
                    }
                }
                if (enter < exit && exit > 0 && enter < 1) return false;
            }
            return true;
        }

        /* --------------------------------------------------- roadLaneMovements.ts */

        /// <summary>Index is counted from the driver's left; a T approach shares its middle lane.</summary>
        public static List<RoadTurn> LaneMovements(int index, int count, IReadOnlyList<RoadTurn> available) {
            bool through = available.Contains(RoadTurn.Straight);
            bool split = !through && available.Contains(RoadTurn.Left) && available.Contains(RoadTurn.Right);
            var result = new List<RoadTurn>();
            foreach (var turn in available) {
                if (turn == RoadTurn.Straight) { result.Add(turn); continue; }
                if (split) {
                    if (turn == RoadTurn.Left ? index < (int)Math.Ceiling(count / 2.0) : index >= (int)Math.Floor(count / 2.0))
                        result.Add(turn);
                    continue;
                }
                if (!through) { result.Add(turn); continue; }
                if (turn == RoadTurn.Left ? index == 0 : index == count - 1) result.Add(turn);
            }
            return result;
        }

        public static RoadTurn? Turn(bool inAxis, int inSign, bool outAxis, int outSign) {
            if (inAxis == outAxis) return inSign == outSign ? RoadTurn.Straight : (RoadTurn?)null;
            int cross = (inAxis ? -1 : 1) * inSign * outSign;
            return cross > 0 ? RoadTurn.Left : RoadTurn.Right;
        }

        /// <summary>Increasing lane coordinates run rightward for +Y and leftward for +X.</summary>
        public static int DriverLaneOrder(bool axis, int sign) => (axis ? 1 : -1) * sign;

        /* --------------------------------------------------------- roadNetwork.ts */

        /// <summary>Source <c>roadLaneSign</c>: a half turn reverses one-way flow only.</summary>
        public static int LaneSign(StationRoadRecord r, int lane) {
            var layout = Layout(r);
            if (r.TwoWay) return (lane < layout.Lanes / 2 ? -1 : 1) * (layout.AcrossX ? 1 : -1);
            return Turn(r.Rotation) >= 2 ? -1 : 1;
        }

        public static RoadSignalPhase Signal(RoadJunction junction, bool axis, double time) =>
            (RoadSignalPhase)(int)RoadTrafficSignals.Phase(junction.Uncontrolled, junction.Id,
                junction.VerticalGreen, junction.HorizontalGreen, axis, time);

        public static RoadNetwork Network(IEnumerable<StationRoadRecord> modules) =>
            Network(StationRoadDocument.Read(modules));

        public static RoadNetwork Network(RoadGraph graph) {
            if (graph == null) throw new ArgumentNullException(nameof(graph));
            var network = new RoadNetwork();
            var roads = graph.Modules
                .Where(m => m != null && m.Type == "road")
                .OrderBy(m => m.Id, StringComparer.Ordinal)
                .ToList();

            // Coalesce same-width collinear strokes so shared pavement is one lane
            // queue without an artificial spawn/exit seam.
            for (int a = 0; a < roads.Count; a++) {
                bool restart = false;
                for (int b = a + 1; b < roads.Count; b++) {
                    var r = roads[a];
                    var s = roads[b];
                    bool axis = Layout(r).AcrossX;
                    if (r.Z != s.Z || !string.Equals(r.Direction, s.Direction, StringComparison.Ordinal)) continue;
                    int rotationMod = r.TwoWay ? 2 : 4;
                    if (Turn(r.Rotation) % rotationMod != Turn(s.Rotation) % rotationMod) continue;
                    bool adjacent = axis
                        ? r.X == s.X && r.W == s.W && r.Y <= s.Y + s.D && s.Y <= r.Y + r.D
                        : r.Y == s.Y && r.D == s.D && r.X <= s.X + s.W && s.X <= r.X + r.W;
                    if (!adjacent) continue;
                    roads[a] = StationRoadRecord.Create(r.Id,
                        Math.Min(r.X, s.X), Math.Min(r.Y, s.Y), r.Z,
                        Math.Max(r.X + r.W, s.X + s.W) - Math.Min(r.X, s.X),
                        Math.Max(r.Y + r.D, s.Y + s.D) - Math.Min(r.Y, s.Y),
                        r.Rotation, r.Direction,
                        r.HasFrom ? r.From : (RoadPosition?)null, r.HasTo ? r.To : (RoadPosition?)null);
                    roads.RemoveAt(b);
                    restart = true;
                    break;
                }
                if (restart) a = -1;
            }
            network.Roads.AddRange(roads);

            var junctions = network.Junctions;
            // Authored shared nodes connect straight segments of different widths:
            // lane merges, without signals or zebra crossings.
            foreach (var node in graph.Nodes) {
                if (node.Segments.Count < 2) continue;
                var connected = new List<StationRoadRecord>();
                foreach (var id in node.Segments) {
                    var segment = graph.Segment(id);
                    if (segment != null) connected.Add(segment.Road);
                }
                if (connected.Count < 2) continue;
                var layouts = connected.Select(Layout).ToList();
                if (!layouts.All(l => l.AcrossX == layouts[0].AcrossX) ||
                    layouts.All(l => l.Width == layouts[0].Width)) continue;
                double half = layouts.Max(l => l.Width) / 2;
                junctions.Add(new RoadJunction {
                    X0 = node.X - half, Y0 = node.Y - half, X1 = node.X + half, Y1 = node.Y + half,
                    Z = node.Z, Id = "road-merge:" + node.Id, Uncontrolled = true,
                });
            }
            for (int a = 0; a < roads.Count; a++)
                for (int b = a + 1; b < roads.Count; b++) {
                    var r = roads[a];
                    var s = roads[b];
                    if (r.Z != s.Z || Layout(r).AcrossX == Layout(s).AcrossX) continue;
                    double x0 = Math.Max(r.X, s.X), y0 = Math.Max(r.Y, s.Y);
                    double x1 = Math.Min(r.X + r.W, s.X + s.W), y1 = Math.Min(r.Y + r.D, s.Y + s.D);
                    if (x1 <= x0 || y1 <= y0) continue;
                    // A T stroke may stop at the receiving road's centre; the junction
                    // still spans that road's full carriageway.
                    var vertical = Layout(r).AcrossX ? r : s;
                    var horizontal = vertical == r ? s : r;
                    var junction = new RoadJunction {
                        X0 = vertical.X, Y0 = horizontal.Y,
                        X1 = vertical.X + vertical.W, Y1 = horizontal.Y + horizontal.D, Z = r.Z,
                    };
                    junction.Id = JunctionId(junction);
                    junctions.Add(junction);
                }
            // Overlapping crossing rectangles form one controlled junction, including
            // split roads.
            for (int a = 0; a < junctions.Count; a++) {
                bool restart = false;
                for (int b = a + 1; b < junctions.Count; b++) {
                    var j = junctions[a];
                    var k = junctions[b];
                    if (j.Z != k.Z || j.X0 > k.X1 || j.X1 < k.X0 || j.Y0 > k.Y1 || j.Y1 < k.Y0) continue;
                    j.X0 = Math.Min(j.X0, k.X0);
                    j.Y0 = Math.Min(j.Y0, k.Y0);
                    j.X1 = Math.Max(j.X1, k.X1);
                    j.Y1 = Math.Max(j.Y1, k.Y1);
                    j.Uncontrolled = j.Uncontrolled && k.Uncontrolled;
                    j.Id = JunctionId(j);
                    junctions.RemoveAt(b);
                    restart = true;
                    break;
                }
                if (restart) a = -1;
            }

            var incoming = junctions.Select(_ => new List<int>()).ToList();
            var outgoing = junctions.Select(_ => new List<int>()).ToList();
            foreach (var r in roads) {
                var layout = Layout(r);
                bool axis = layout.AcrossX;
                for (int lane = 0; lane < layout.Lanes; lane++) {
                    double across = (lane + .5) * layout.LaneWidth;
                    int sign = LaneSign(r, lane);
                    double origin = axis ? r.Y : r.X;
                    var cuts = new List<(double Lo, double Hi, int Index)>();
                    for (int index = 0; index < junctions.Count; index++) {
                        var j = junctions[index];
                        double cross = (axis ? r.X : r.Y) + across;
                        if (j.Z != r.Z || cross <= (axis ? j.X0 : j.Y0) || cross >= (axis ? j.X1 : j.Y1)) continue;
                        double lo = Math.Max(0, (axis ? j.Y0 : j.X0) - origin);
                        double hi = Math.Min(layout.Length, (axis ? j.Y1 : j.X1) - origin);
                        if (hi > lo) cuts.Add((lo, hi, index));
                    }
                    cuts = cuts.OrderBy(c => c.Lo).ToList();
                    double from = 0;
                    int prev = -1;
                    void Segment(double to, int next) {
                        if (to - from < .01) return;
                        var start = Point(r, across, sign > 0 ? from : to);
                        var end = Point(r, across, sign > 0 ? to : from);
                        int id = network.Edges.Count;
                        network.Edges.Add(new RoadEdge {
                            Road = r, Lane = lane, Sign = sign, Axis = axis,
                            Start = start, End = end, Length = to - from, Junction = -1,
                        });
                        if (prev >= 0) (sign > 0 ? outgoing : incoming)[prev].Add(id);
                        if (next >= 0) (sign > 0 ? incoming : outgoing)[next].Add(id);
                    }
                    foreach (var cut in cuts) {
                        Segment(cut.Lo, cut.Index);
                        from = cut.Hi;
                        prev = cut.Index;
                    }
                    Segment(layout.Length, -1);
                }
            }
            int straights = network.Edges.Count;
            var starts = new Dictionary<string, List<int>>(StringComparer.Ordinal);
            for (int i = 0; i < straights; i++) {
                var edge = network.Edges[i];
                string key = StationRoadDocument.NodeId(edge.End, edge.Road.Z);
                if (!starts.TryGetValue(key, out var list)) starts.Add(key, list = new List<int>());
                list.Add(i);
            }
            for (int i = 0; i < straights; i++) {
                var e = network.Edges[i];
                string key = StationRoadDocument.NodeId(e.End, e.Road.Z);
                if (!starts.TryGetValue(key, out var list)) continue;
                foreach (int n in list) {
                    if (n == i) continue;
                    if (network.Edges[n].Axis != e.Axis || network.Edges[n].Sign != e.Sign) continue;
                    e.Next.Add(n);
                }
            }
            for (int j = 0; j < junctions.Count; j++) {
                var junction = junctions[j];
                foreach (int i in incoming[j]) {
                    var a = network.Edges[i];
                    var destinations = new List<(RoadTurn Turn, List<int> Edges)>();
                    int laneOrder = DriverLaneOrder(a.Axis, a.Sign);
                    var approach = incoming[j]
                        .Where(n => network.Edges[n].Road.Id == a.Road.Id && network.Edges[n].Axis == a.Axis && network.Edges[n].Sign == a.Sign)
                        .OrderBy(n => (network.Edges[n].Lane - a.Lane) * laneOrder)
                        .ToList();
                    foreach (int o in outgoing[j]) {
                        var b = network.Edges[o];
                        var turn = Turn(a.Axis, a.Sign, b.Axis, b.Sign);
                        if (turn == null) continue; // no U turns
                        var slot = destinations.FindIndex(d => d.Turn == turn.Value);
                        if (slot < 0) destinations.Add((turn.Value, new List<int> { o }));
                        else destinations[slot].Edges.Add(o);
                    }
                    int index = approach.IndexOf(i);
                    var permitted = LaneMovements(index, approach.Count, destinations.Select(d => d.Turn).ToList());
                    if (!junction.Uncontrolled && permitted.Count > 0) {
                        int green = RoadTrafficSignals.GreenForLanes(Layout(a.Road).Lanes);
                        if (a.Axis) junction.VerticalGreen = Math.Max(junction.VerticalGreen, green);
                        else junction.HorizontalGreen = Math.Max(junction.HorizontalGreen, green);
                    }
                    foreach (var turn in permitted) {
                        var list = destinations.First(d => d.Turn == turn).Edges;
                        list = list.OrderBy(n => (network.Edges[n].Lane - a.Lane) * DriverLaneOrder(network.Edges[n].Axis, network.Edges[n].Sign)).ToList();
                        int target = turn == RoadTurn.Left ? 0
                            : turn == RoadTurn.Right ? list.Count - 1
                            : Math.Min(list.Count - 1, (int)Math.Floor((index + .5) * list.Count / approach.Count));
                        int o = list[target];
                        var b = network.Edges[o];
                        bool hasControl = a.Axis != b.Axis;
                        var control = hasControl
                            ? (a.Axis ? new RoadPosition(a.End.X, b.Start.Y) : new RoadPosition(b.Start.X, a.End.Y))
                            : default;
                        if (Near(a.End, b.Start)) { a.Next.Add(o); continue; }
                        var connector = new RoadEdge {
                            Road = a.Road, Lane = a.Lane, Sign = a.Sign, Axis = a.Axis,
                            Start = a.End, End = b.Start, Junction = j, HasControl = hasControl, Control = control,
                        };
                        connector.Next.Add(o);
                        var previous = connector.Start;
                        for (int s = 1; s <= 16; s++) {
                            var p = EdgePoint(connector, s / 16.0);
                            connector.Length += Math.Sqrt((p.X - previous.X) * (p.X - previous.X) + (p.Y - previous.Y) * (p.Y - previous.Y));
                            previous = p;
                        }
                        a.Next.Add(network.Edges.Count);
                        network.Edges.Add(connector);
                    }
                }
            }
            var reached = new HashSet<int>(network.Edges.SelectMany(e => e.Next));
            var departures = new HashSet<int>(outgoing.SelectMany(list => list));
            for (int i = 0; i < network.Edges.Count; i++) {
                var e = network.Edges[i];
                if (e.Junction < 0 && !reached.Contains(i) && !departures.Contains(i)) network.Entries.Add(i);
            }
            return network;
        }

        static string JunctionId(RoadJunction j) =>
            RoadPosition.Number(j.Z) + ":" + RoadPosition.Number(j.X0) + ":" + RoadPosition.Number(j.Y0) + ":" +
            RoadPosition.Number(j.X1) + ":" + RoadPosition.Number(j.Y1);

        static bool Near(RoadPosition a, RoadPosition b) =>
            Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y)) < .01;

        /// <summary>One side of a junction per street, whether arriving or only leaving.</summary>
        public static List<RoadJunctionSide> JunctionSides(RoadNetwork network) {
            if (network == null) throw new ArgumentNullException(nameof(network));
            var sides = new List<RoadJunctionSide>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            void Add(int junction, RoadEdge edge, bool arriving) {
                int direction = arriving ? -edge.Sign : edge.Sign;
                string key = junction + ":" + edge.Road.Id + ":" + edge.Axis + ":" + direction;
                if (!seen.Add(key)) return;
                sides.Add(new RoadJunctionSide(junction, edge.Road.Id, edge.Axis, direction,
                    arriving ? (edge.Axis ? edge.End.Y : edge.End.X) : (edge.Axis ? edge.Start.Y : edge.Start.X)));
            }
            foreach (var edge in network.Edges) {
                if (edge.Junction >= 0) {
                    if (edge.Next.Count > 0) Add(edge.Junction, network.Edges[edge.Next[0]], false);
                    continue;
                }
                foreach (int next in edge.Next) {
                    var connector = network.Edges[next];
                    if (connector.Junction >= 0) Add(connector.Junction, edge, true);
                }
            }
            return sides;
        }

        /// <summary>Reads the real connectors so painted permissions cannot disagree with cars.</summary>
        public static List<RoadTurn> EdgeMovements(RoadNetwork network, RoadEdge edge) {
            var result = new List<RoadTurn>();
            foreach (int n in edge.Next) {
                var connector = network.Edges[n];
                var exit = connector.Junction >= 0 ? network.Edges[connector.Next[0]] : connector;
                var turn = Turn(edge.Axis, edge.Sign, exit.Axis, exit.Sign);
                if (turn != null && !result.Contains(turn.Value)) result.Add(turn.Value);
            }
            return result;
        }

        /// <summary>Quadratic Bezier (or straight) point along an edge.</summary>
        public static RoadPosition EdgePoint(RoadEdge e, double t) {
            if (e == null) throw new ArgumentNullException(nameof(e));
            double u = 1 - t;
            if (e.HasControl)
                return new RoadPosition(
                    u * u * e.Start.X + 2 * u * t * e.Control.X + t * t * e.End.X,
                    u * u * e.Start.Y + 2 * u * t * e.Control.Y + t * t * e.End.Y);
            return new RoadPosition(e.Start.X + (e.End.X - e.Start.X) * t, e.Start.Y + (e.End.Y - e.Start.Y) * t);
        }

        /* ------------------------------------------------------ roadPlacement.ts */

        /// <summary>
        /// Source <c>roadSurfaceReason</c>. The module-envelope overlap rule
        /// (<c>placementColliders</c>) is delegated to the context because this
        /// packet does not own module footprints.
        /// </summary>
        public static RoadSurfaceReason SurfaceReason(StationRoadRecord r, IRoadSurfaceContext context) {
            if (r == null) throw new ArgumentNullException(nameof(r));
            if (r.Z < 0) return RoadSurfaceReason.Ground;
            if (context == null) return RoadSurfaceReason.None;
            bool track = false;
            bool occupied = false;
            for (int x = r.X; x < r.X + r.W; x++)
                for (int y = r.Y; y < r.Y + r.D; y++) {
                    bool covered = context.IsSolid(x, y, r.Z) || context.IsExitFloor(x, y, r.Z);
                    if (!covered && (r.Z != 0 || context.IsGroundHole(x, y, r.Z))) return RoadSurfaceReason.Ground;
                    track |= context.IsTrack(x, y, r.Z) || context.IsTrack(x, y, r.Z + 1);
                    for (int dz = 1; dz <= 4; dz++) occupied |= context.IsSolid(x, y, r.Z + dz);
                }
            if (track) return RoadSurfaceReason.Track;
            if (occupied || context.OverlapsModuleEnvelope(r)) return RoadSurfaceReason.Occupied;
            return RoadSurfaceReason.None;
        }

        /// <summary>Refusal code for the edit transaction; empty means the surface accepts the road.</summary>
        public static string PlacementRefusal(StationRoadRecord r, IRoadSurfaceContext context) {
            if (r == null) return "road-invalid-record";
            var layout = Layout(r);
            if (layout.Width < (r.TwoWay ? LaneWidthConstant * 2 : LaneWidthConstant)) return "road-width";
            switch (SurfaceReason(r, context)) {
                case RoadSurfaceReason.Ground: return "road-ground";
                case RoadSurfaceReason.Track: return "track";
                case RoadSurfaceReason.Occupied: return "occupied";
                default: return null;
            }
        }

        /* --------------------------------------------------------------- helpers */

        /// <summary>
        /// Adapts the derived lane network to packet G's engine-free traffic port.
        /// This is the only hand-off between the document/layout layer and
        /// <see cref="StationRoadTraffic"/>.
        /// </summary>
        public static RoadTrafficNetwork TrafficNetwork(RoadNetwork network) {
            if (network == null) throw new ArgumentNullException(nameof(network));
            var traffic = new RoadTrafficNetwork();
            foreach (var e in network.Edges) {
                traffic.Edges.Add(new RoadTrafficEdge {
                    RoadId = e.Road.Id, RoadZ = e.Road.Z, Lane = e.Lane, Sign = e.Sign, Axis = e.Axis,
                    StartX = e.Start.X, StartY = e.Start.Y, EndX = e.End.X, EndY = e.End.Y,
                    Length = e.Length, Next = e.Next.ToArray(), Junction = e.Junction,
                    HasControl = e.HasControl, ControlX = e.Control.X, ControlY = e.Control.Y,
                });
            }
            foreach (var j in network.Junctions) {
                traffic.Junctions.Add(new RoadTrafficJunction {
                    Id = j.Id, Uncontrolled = j.Uncontrolled, X0 = j.X0, Y0 = j.Y0, X1 = j.X1, Y1 = j.Y1, Z = j.Z,
                    VerticalGreen = j.VerticalGreen, HorizontalGreen = j.HorizontalGreen,
                });
            }
            traffic.Entries.AddRange(network.Entries);
            return traffic;
        }

        public static int Turn(int rotation) {
            int turn = rotation % 4;
            return turn < 0 ? turn + 4 : turn;
        }

        /// <summary>Source <c>String(number)</c>: invariant and without a trailing ".0".</summary>
        public static string Number(double value) => RoadPosition.Number(value);
    }
}
