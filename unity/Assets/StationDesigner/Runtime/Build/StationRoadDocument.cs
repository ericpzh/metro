using System;
using System.Collections.Generic;
using System.Globalization;

namespace Metro.Build {
    /// <summary>
    /// A fractional authored road endpoint in document plan axes. Source
    /// <c>sim/roadDocument.ts</c> keeps endpoints as JS numbers; they are <b>not</b>
    /// snapped to cells, so the port keeps the same doubles.
    /// </summary>
    public readonly struct RoadPosition : IEquatable<RoadPosition> {
        public readonly double X;
        public readonly double Y;

        public RoadPosition(double x, double y) {
            X = x == 0 ? 0 : x;   // JS String(-0) is "0"; node ids depend on it.
            Y = y == 0 ? 0 : y;
        }

        public bool Equals(RoadPosition other) => X.Equals(other.X) && Y.Equals(other.Y);
        public override bool Equals(object obj) => obj is RoadPosition other && Equals(other);
        public override int GetHashCode() => unchecked((X.GetHashCode() * 397) ^ Y.GetHashCode());

        /// <summary>Invariant text used by the derived graph signatures (source node ids).</summary>
        public string Key => Number(X) + ":" + Number(Y);

        public override string ToString() => "[" + Key + "]";

        /// <summary>Matches JS <c>String(number)</c> for the values a save can hold.</summary>
        public static string Number(double value) {
            if (value == 0) return "0";
            if (Math.Floor(value) == value && Math.Abs(value) < 1e15)
                return ((long)value).ToString(CultureInfo.InvariantCulture);
            string text = value.ToString("R", CultureInfo.InvariantCulture);
            // JS uses lower-case exponents without a padded exponent ("1e-7", not "1E-07").
            int marker = text.IndexOf('E');
            if (marker < 0) marker = text.IndexOf('e');
            if (marker < 0) return text;
            string mantissa = text.Substring(0, marker);
            int exponent;
            if (!int.TryParse(text.Substring(marker + 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out exponent))
                return text;
            return mantissa + "e" + (exponent >= 0 ? "+" : "-") +
                Math.Abs(exponent).ToString(CultureInfo.InvariantCulture);
        }
    }

    /// <summary>An explicit diagnostic for a road record the layout cannot draw.</summary>
    public sealed class RoadDiagnostic {
        public string ModuleId = "";
        public string Code = "";
        public string Detail = "";

        public RoadDiagnostic() { }
        public RoadDiagnostic(string moduleId, string code, string detail) {
            ModuleId = moduleId ?? "";
            Code = code ?? "";
            Detail = detail ?? "";
        }

        public override string ToString() => $"{Code} {ModuleId}: {Detail}";
    }

    /// <summary>
    /// One authored <c>type: "road"</c> record from <c>static.modules</c>. Every
    /// field here is a document fact (never derived geometry): stable module ID the
    /// source keeps, rectangle in plan cells, elevation, quarter turn, traffic
    /// direction and the optional authored endpoints. A later packet's document
    /// reader adapts its record to this one; <see cref="FromFacts"/> covers the
    /// current <see cref="ModuleFacts"/> shape.
    /// </summary>
    public sealed class StationRoadRecord {
        public string Id = "";
        public string Type = "road";
        public int X;
        public int Y;
        /// <summary>Saved elevation. Kept as a double because the document stores numbers.</summary>
        public double Z;
        public int W;
        public int D;
        /// <summary>Saved quarter turn in plan space (the source stores direction in rots 2/3 for one-way).</summary>
        public int Rotation;
        /// <summary>Authored <c>cfg.direction</c>: "one-way" or "two-way".</summary>
        public string Direction = "one-way";
        public bool HasFrom;
        public bool HasTo;
        public RoadPosition From;
        public RoadPosition To;

        public bool TwoWay => string.Equals(Direction, "two-way", StringComparison.OrdinalIgnoreCase);

        public bool IsWellFormed(out string code, out string detail) {
            code = null;
            detail = null;
            if (string.IsNullOrEmpty(Id)) { code = "road-missing-id"; detail = "road record has no id"; return false; }
            if (W <= 0 || D <= 0) { code = "road-invalid-extent"; detail = $"w={W} d={D}"; return false; }
            if (!TwoWay && !string.Equals(Direction, "one-way", StringComparison.OrdinalIgnoreCase)) {
                code = "road-unknown-direction"; detail = "direction='" + Direction + "'";
                return false;
            }
            return true;
        }

        public StationRoadRecord Clone() => (StationRoadRecord)MemberwiseClone();

        public override string ToString() => $"road {Id} ({X},{Y},{Z:R}) {W}x{D} rot {Rotation} {Direction}";

        /// <summary>Stable flat record constructor for tests, the editor adapter and undo snapshots.</summary>
        public static StationRoadRecord Create(string id, int x, int y, double z, int w, int d, int rotation,
            string direction = "one-way", RoadPosition? from = null, RoadPosition? to = null) {
            return new StationRoadRecord {
                Id = id, Type = "road", X = x, Y = y, Z = z, W = w, D = d,
                Rotation = ((rotation % 4) + 4) % 4, Direction = string.IsNullOrEmpty(direction) ? "one-way" : direction,
                HasFrom = from.HasValue, From = from ?? default,
                HasTo = to.HasValue, To = to ?? default,
            };
        }

        /// <summary>
        /// Adapter from the current save projection. <c>cfg.from</c>/<c>cfg.to</c> keep
        /// their JSON text in <see cref="ModuleConfig"/>; the arrays may contain
        /// fractional numbers, so they are parsed as doubles rather than through
        /// <see cref="ModuleFacts.Point"/> (which is integer-only).
        /// </summary>
        public static StationRoadRecord FromFacts(ModuleFacts facts) {
            if (facts == null) throw new ArgumentNullException(nameof(facts));
            var record = new StationRoadRecord {
                Id = facts.Id ?? "", Type = "road", X = facts.X, Y = facts.Y, Z = facts.Z,
                W = facts.Width, D = facts.Depth, Rotation = ((facts.Rotation % 4) + 4) % 4,
                Direction = facts.Config != null && facts.Config.Has("direction") ? facts.Config.Text("direction") : "one-way",
            };
            if (facts.Config != null && facts.Config.TryNumbers("from", out var from) && from.Length == 2) {
                record.HasFrom = true;
                record.From = new RoadPosition(from[0], from[1]);
            }
            if (facts.Config != null && facts.Config.TryNumbers("to", out var to) && to.Length == 2) {
                record.HasTo = true;
                record.To = new RoadPosition(to[0], to[1]);
            }
            return record;
        }

        /// <summary>Reads every <c>type: "road"</c> fact in document order.</summary>
        public static List<StationRoadRecord> FromFacts(IEnumerable<ModuleFacts> modules, IList<RoadDiagnostic> diagnostics = null) {
            var records = new List<StationRoadRecord>();
            if (modules == null) return records;
            foreach (var facts in modules) {
                if (facts == null || facts.Type != "road") continue;
                records.Add(FromFacts(facts));
            }
            return records;
        }
    }

    /// <summary>A derived endpoint node. Owned by the endpoint references, never a saved record.</summary>
    public sealed class RoadNode {
        public string Id = "";
        public double X;
        public double Y;
        public double Z;
        public readonly List<string> Segments = new List<string>();

        public RoadPosition Point => new RoadPosition(X, Y);
        public override string ToString() => $"{Id} <- {string.Join(",", Segments)}";
    }

    /// <summary>
    /// One derived segment of an authored road, clipped at shared endpoints and
    /// crossings. <see cref="Road"/> is a view/placement rectangle; <see cref="SourceId"/>
    /// is the authored module ID the segment came from, preserved for editing,
    /// undo and provenance.
    /// </summary>
    public sealed class RoadSegment {
        public StationRoadRecord Road;
        public string SourceId = "";
        public string FromNodeId = "";
        public string ToNodeId = "";

        public override string ToString() => $"{Road.Id} ({SourceId}) {FromNodeId}->{ToNodeId}";
    }

    /// <summary>
    /// The derived road document: authored records plus segments and shared nodes
    /// computed from them. Nothing here is written back to the save.
    /// </summary>
    public sealed class RoadGraph {
        /// <summary>Derived split segments in render/placement order (source graph.modules minus non-roads).</summary>
        public readonly List<StationRoadRecord> Modules = new List<StationRoadRecord>();
        /// <summary>The authored road records, in document order. Saves and edits use only these.</summary>
        public readonly List<StationRoadRecord> AuthoredRecords = new List<StationRoadRecord>();
        public readonly List<RoadNode> Nodes = new List<RoadNode>();
        public readonly List<RoadSegment> Segments = new List<RoadSegment>();
        public readonly List<RoadDiagnostic> Diagnostics = new List<RoadDiagnostic>();

        readonly Dictionary<string, RoadNode> nodeById = new Dictionary<string, RoadNode>(StringComparer.Ordinal);
        readonly Dictionary<string, RoadSegment> segmentByRoadId = new Dictionary<string, RoadSegment>(StringComparer.Ordinal);

        internal void AddNode(RoadNode node) {
            Nodes.Add(node);
            if (!nodeById.ContainsKey(node.Id)) nodeById.Add(node.Id, node);
        }

        internal void AddSegment(RoadSegment segment) {
            Segments.Add(segment);
            if (!segmentByRoadId.ContainsKey(segment.Road.Id)) segmentByRoadId.Add(segment.Road.Id, segment);
        }

        public RoadNode Node(string id) => id != null && nodeById.TryGetValue(id, out var node) ? node : null;
        public RoadSegment Segment(string roadId) => roadId != null && segmentByRoadId.TryGetValue(roadId, out var segment) ? segment : null;
        public bool HasNode(string id) => id != null && nodeById.ContainsKey(id);

        public IReadOnlyList<StationRoadRecord> Authored => AuthoredRecords;
    }

    public sealed class RoadSnap {
        public RoadPosition Point;
        public RoadNode Node;
        public StationRoadRecord Road;
        public bool HasNode => Node != null;
    }

    /// <summary>
    /// Port of <c>game/src/sim/roadDocument.ts</c>. The graph is derived from the
    /// authored records on demand; split segments and shared junction caps exist
    /// only here (or in a materialized edit transaction), never in the saved
    /// document.
    /// </summary>
    public static class StationRoadDocument {
        public static string NodeId(RoadPosition p, double z) =>
            "road-node:" + RoadPosition.Number(z) + ":" + p.Key;

        /// <summary>
        /// Authored endpoints when the document's pair is valid and axis aligned,
        /// otherwise the source's inset fallback measured from the rectangle.
        /// </summary>
        public static RoadPosition[] Endpoints(StationRoadRecord road) {
            if (road == null) throw new ArgumentNullException(nameof(road));
            if (road.HasFrom && road.HasTo && (road.From.X == road.To.X || road.From.Y == road.To.Y))
                return new[] { road.From, road.To };
            var layout = StationRoadLayout.Layout(road);
            double inset = Math.Min(layout.Width / 2, layout.Length / 2);
            if (layout.AcrossX)
                return new[] {
                    new RoadPosition(road.X + layout.Width / 2, road.Y + inset),
                    new RoadPosition(road.X + layout.Width / 2, road.Y + layout.Length - inset),
                };
            return new[] {
                new RoadPosition(road.X + inset, road.Y + layout.Width / 2),
                new RoadPosition(road.X + layout.Length - inset, road.Y + layout.Width / 2),
            };
        }

        /// <summary>Port of <c>roadBetween</c>: a rectangle around the two authored endpoints.</summary>
        public static StationRoadRecord Between(RoadPosition from, RoadPosition to, double z, int width,
            string direction, bool reverse, string id) {
            bool vertical = from.X == to.X;
            double half = width / 2.0;
            int x = (int)Math.Floor(Math.Min(from.X, to.X) - half);
            int y = (int)Math.Floor(Math.Min(from.Y, to.Y) - half);
            int w = (int)Math.Ceiling(Math.Max(from.X, to.X) + half) - x;
            int d = (int)Math.Ceiling(Math.Max(from.Y, to.Y) + half) - y;
            return StationRoadRecord.Create(id, x, y, z, w, d, (vertical ? 0 : 1) + (reverse ? 2 : 0),
                direction, from, to);
        }

        /// <summary>
        /// Port of <c>getRoadDocument</c>. <paramref name="allModuleIds"/> is the
        /// complete station ID set for the split-suffix search; when omitted the road
        /// IDs are used (sufficient unless a non-road module already owns a suffix).
        /// </summary>
        public static RoadGraph Read(IEnumerable<StationRoadRecord> modules, IEnumerable<string> allModuleIds = null) {
            var graph = new RoadGraph();
            var roads = new List<StationRoadRecord>();
            var ids = new HashSet<string>(StringComparer.Ordinal);
            if (allModuleIds != null) foreach (var id in allModuleIds) if (id != null) ids.Add(id);
            if (modules != null) {
                foreach (var module in modules) {
                    if (module == null || module.Type != "road") continue;
                    roads.Add(module);
                    ids.Add(module.Id);
                }
            }
            graph.AuthoredRecords.AddRange(roads);

            // Duplicate IDs make node ownership ambiguous; report the second one and
            // keep both records in document order, exactly as the source array does.
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var road in roads) {
                if (string.IsNullOrEmpty(road.Id)) continue;
                if (!seen.Add(road.Id))
                    graph.Diagnostics.Add(new RoadDiagnostic(road.Id, "road-duplicate-id", "another road owns this module id"));
                if (!road.IsWellFormed(out var code, out var detail))
                    graph.Diagnostics.Add(new RoadDiagnostic(road.Id, code, detail));
            }

            var ends = new List<RoadPosition[]>(roads.Count);
            var cuts = new List<List<RoadPosition>>(roads.Count);
            for (int i = 0; i < roads.Count; i++) {
                var pair = Endpoints(roads[i]);
                ends.Add(pair);
                cuts.Add(new List<RoadPosition> { pair[0], pair[1] });
            }
            void AddCut(int index, RoadPosition p) {
                foreach (var q in cuts[index]) if (q.Equals(p)) return;
                cuts[index].Add(p);
            }
            for (int i = 0; i < roads.Count; i++)
                for (int j = i + 1; j < roads.Count; j++) {
                    if (roads[i].Z != roads[j].Z) continue;
                    var a = ends[i][0];
                    var b = ends[i][1];
                    var c = ends[j][0];
                    var d = ends[j][1];
                    bool v = a.X == b.X;
                    bool w = c.X == d.X;
                    if (v != w) {
                        var p = v ? new RoadPosition(a.X, c.Y) : new RoadPosition(c.X, a.Y);
                        if (BetweenValue(p.X, a.X, b.X) && BetweenValue(p.Y, a.Y, b.Y) &&
                            BetweenValue(p.X, c.X, d.X) && BetweenValue(p.Y, c.Y, d.Y)) {
                            AddCut(i, p);
                            AddCut(j, p);
                        }
                    } else if (v ? a.X == c.X : a.Y == c.Y) {
                        foreach (var p in ends[j])
                            if (BetweenValue(p.X, a.X, b.X) && BetweenValue(p.Y, a.Y, b.Y)) AddCut(i, p);
                        foreach (var p in ends[i])
                            if (BetweenValue(p.X, c.X, d.X) && BetweenValue(p.Y, c.Y, d.Y)) AddCut(j, p);
                    }
                }

            var nodes = new Dictionary<string, RoadNode>(StringComparer.Ordinal);
            string Attach(RoadPosition p, double z, string roadId) {
                var key = NodeId(p, z);
                if (!nodes.TryGetValue(key, out var node)) {
                    node = new RoadNode { Id = key, X = p.X, Y = p.Y, Z = z };
                    nodes.Add(key, node);
                    graph.AddNode(node);
                }
                if (!node.Segments.Contains(roadId)) node.Segments.Add(roadId);
                return key;
            }

            var signatures = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < roads.Count; i++) {
                var r = roads[i];
                if (!r.IsWellFormed(out _, out _)) continue;
                var layout = StationRoadLayout.Layout(r);
                bool acrossX = layout.AcrossX;
                int axis = acrossX ? 1 : 0;
                var points = new List<RoadPosition>(cuts[i]);
                points.Sort((p, q) => axis == 0 ? p.X.CompareTo(q.X) : p.Y.CompareTo(q.Y));
                if (points.Count == 2 && points[0].Equals(points[1])) points.RemoveAt(points.Count - 1);
                int partCount = Math.Max(1, points.Count - 1);
                for (int part = 0; part < partCount; part++) {
                    var from = points[part];
                    var to = part + 1 < points.Count ? points[part + 1] : from;
                    int rotation = r.TwoWay ? 0 : r.Rotation;
                    string signature = string.Join(":", new[] {
                        RoadPosition.Number(r.Z), from.Key, to.Key, RoadPosition.Number(layout.Width),
                        r.Direction ?? "", RoadPosition.Number(rotation),
                    });
                    if (!signatures.Add(signature)) continue;
                    string id = r.Id;
                    if (part > 0) {
                        int suffix = part;
                        while (ids.Contains(r.Id + "-segment-" + suffix)) suffix++;
                        id = r.Id + "-segment-" + suffix;
                        ids.Add(id);
                    }
                    double lo = part == 0 ? (acrossX ? r.Y : r.X) : Math.Floor(from.X * (axis == 0 ? 1 : 0) + from.Y * (axis == 1 ? 1 : 0) - layout.Width / 2);
                    double hi = part == points.Count - 2 || points.Count == 1
                        ? (acrossX ? r.Y + r.D : r.X + r.W)
                        : Math.Ceiling((acrossX ? to.Y : to.X) + layout.Width / 2);
                    bool same = r.HasFrom && r.HasTo && points.Count == 2 &&
                        r.From.Equals(from) && r.To.Equals(to);
                    StationRoadRecord road;
                    if (same) road = r;
                    else {
                        road = r.Clone();
                        road.Id = id;
                        if (!acrossX) { road.X = (int)lo; road.W = (int)(hi - lo); }
                        else { road.Y = (int)lo; road.D = (int)(hi - lo); }
                        road.HasFrom = true;
                        road.HasTo = true;
                        road.From = from;
                        road.To = to;
                    }
                    graph.Modules.Add(road);
                    var segment = new RoadSegment {
                        Road = road, SourceId = r.Id,
                        FromNodeId = Attach(from, r.Z, id), ToNodeId = Attach(to, r.Z, id),
                    };
                    graph.AddSegment(segment);
                }
            }
            return graph;
        }

        static bool BetweenValue(double n, double a, double b) =>
            n >= Math.Min(a, b) - 1e-6 && n <= Math.Max(a, b) + 1e-6;

        /// <summary>Port of <c>roadSnap</c>; nodes win over body projections.</summary>
        public static RoadSnap Snap(RoadGraph graph, RoadPosition p, double z, double radius = 3,
            Func<RoadSegment, bool> visible = null) {
            if (graph == null) throw new ArgumentNullException(nameof(graph));
            visible ??= _ => true;
            var best = radius;
            RoadNode found = null;
            foreach (var node in graph.Nodes) {
                if (node.Z != z) continue;
                bool anyVisible = false;
                foreach (var id in node.Segments) {
                    var segment = graph.Segment(id);
                    if (segment != null && visible(segment)) { anyVisible = true; break; }
                }
                if (!anyVisible) continue;
                double distance = Math.Sqrt((p.X - node.X) * (p.X - node.X) + (p.Y - node.Y) * (p.Y - node.Y));
                if (distance <= best) { best = distance; found = node; }
            }
            if (found != null) {
                StationRoadRecord road = null;
                foreach (var id in found.Segments) {
                    var segment = graph.Segment(id);
                    if (segment != null && visible(segment)) { road = segment.Road; break; }
                }
                return new RoadSnap { Point = found.Point, Node = found, Road = road };
            }

            RoadPosition? projection = null;
            StationRoadRecord projectedRoad = null;
            double projectBest = double.PositiveInfinity;
            foreach (var segment in graph.Segments) {
                if (!visible(segment)) continue;
                var r = segment.Road;
                if (r.Z != z) continue;
                var pair = Endpoints(r);
                var a = pair[0];
                var b = pair[1];
                bool vertical = a.X == b.X;
                int axis = vertical ? 1 : 0;
                double raw = axis == 0 ? p.X : p.Y;
                double min = axis == 0 ? Math.Min(a.X, b.X) : Math.Min(a.Y, b.Y);
                double max = axis == 0 ? Math.Max(a.X, b.X) : Math.Max(a.Y, b.Y);
                double along = Math.Max(min, Math.Min(max, Math.Round(raw * 2, MidpointRounding.AwayFromZero) / 2));
                var q = vertical ? new RoadPosition(a.X, along) : new RoadPosition(along, a.Y);
                double distance = Math.Sqrt((q.X - p.X) * (q.X - p.X) + (q.Y - p.Y) * (q.Y - p.Y));
                double reach = Math.Max(radius, StationRoadLayout.Layout(r).Width / 2 + .5);
                if (distance <= reach && distance < projectBest) {
                    projectBest = distance;
                    projection = q;
                    projectedRoad = r;
                }
            }
            return new RoadSnap { Point = projection ?? p, Road = projectedRoad };
        }

        /// <summary>Port of <c>roadSegmentAt</c>: a segment body wins over a shared cap.</summary>
        public static RoadSegment SegmentAt(RoadGraph graph, RoadPosition p, double z, string sourceId = null) {
            if (graph == null) throw new ArgumentNullException(nameof(graph));
            double best = double.PositiveInfinity;
            RoadSegment result = null;
            foreach (var segment in graph.Segments) {
                var r = segment.Road;
                if (r.Z != z || (!string.IsNullOrEmpty(sourceId) && segment.SourceId != sourceId && r.Id != sourceId)) continue;
                if (p.X < r.X || p.X >= r.X + r.W || p.Y < r.Y || p.Y >= r.Y + r.D) continue;
                var pair = Endpoints(r);
                var a = pair[0];
                var b = pair[1];
                int axis = StationRoadLayout.Layout(r).AcrossX ? 1 : 0;
                int other = 1 - axis;
                double pa = axis == 0 ? p.X : p.Y;
                double ao = axis == 0 ? a.X : a.Y;
                double bo = axis == 0 ? b.X : b.Y;
                double po = other == 0 ? p.X : p.Y;
                double aother = other == 0 ? a.X : a.Y;
                double outside = Math.Max(Math.Min(ao, bo) - pa, Math.Max(0, pa - Math.Max(ao, bo)));
                double distance = Math.Abs(po - aother) + outside * 2;
                if (distance < best) { best = distance; result = segment; }
            }
            return result;
        }

        /// <summary>Appends one authored record and rebuilds the derived graph.</summary>
        public static RoadGraph WithAdded(RoadGraph graph, StationRoadRecord road, IEnumerable<string> allModuleIds = null) {
            if (graph == null) throw new ArgumentNullException(nameof(graph));
            var modules = new List<StationRoadRecord>(graph.Modules) { road };
            var ids = new List<string>();
            if (allModuleIds != null) ids.AddRange(allModuleIds);
            foreach (var module in graph.Modules) ids.Add(module.Id);
            return Read(modules, ids);
        }

        /// <summary>Replaces the authored list (undo / delete transactions).</summary>
        public static RoadGraph WithModules(IEnumerable<StationRoadRecord> modules, IEnumerable<string> allModuleIds = null) =>
            Read(modules, allModuleIds);

        /// <summary>Source <c>nextModuleId</c>: a free <c>road-n</c> starting from station length + 1.</summary>
        public static string NextId(int moduleCount, IEnumerable<string> allModuleIds, string type = "road") {
            var taken = new HashSet<string>(StringComparer.Ordinal);
            if (allModuleIds != null) foreach (var id in allModuleIds) if (id != null) taken.Add(id);
            int n = moduleCount + 1;
            while (taken.Contains(type + "-" + n)) n++;
            return type + "-" + n;
        }
    }
}
