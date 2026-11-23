using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// Connected-component partitioning and graph/network composition for authored road
    /// networks (plan 39 §9). Two roads interact if they share an elevation and either
    /// touch/overlap, fall within the perpendicular lane-marking ink margin, or intersect
    /// along their explicit authored endpoints. Disconnected components can be built,
    /// simulated, and replaced independently without disturbing untouched networks.
    /// </summary>
    public static class StationRoadComponents {
        /// <summary>
        /// Perpendicular ink-clipping reach (<c>CrosswalkDepth + 1.5</c> = 3.5 m), matching
        /// <see cref="StationRoadLayout.InkIntervals"/> when called from <c>StationRoadView</c>.
        /// </summary>
        public const double InkMargin = StationRoadLayout.CrosswalkDepth + 1.5;

        const double EndpointEpsilon = 1e-6;

        public readonly struct Bounds2D {
            public readonly double MinX, MinY, MaxX, MaxY, Z;
            public readonly bool HasValue;

            public Bounds2D(double minX, double minY, double maxX, double maxY, double z) {
                MinX = minX; MinY = minY; MaxX = maxX; MaxY = maxY; Z = z; HasValue = true;
            }

            public static Bounds2D Of(StationRoadRecord record) {
                if (record == null) return default;
                double minX = record.X, maxX = record.X + record.W;
                double minY = record.Y, maxY = record.Y + record.D;
                var ep = StationRoadDocument.Endpoints(record);
                var a = ep[0];
                var b = ep[1];
                if (a.X < minX) minX = a.X;
                if (a.X > maxX) maxX = a.X;
                if (b.X < minX) minX = b.X;
                if (b.X > maxX) maxX = b.X;
                if (a.Y < minY) minY = a.Y;
                if (a.Y > maxY) maxY = a.Y;
                if (b.Y < minY) minY = b.Y;
                if (b.Y > maxY) maxY = b.Y;
                return new Bounds2D(minX, minY, maxX, maxY, record.Z);
            }

            public static Bounds2D Union(Bounds2D a, Bounds2D b) {
                if (!a.HasValue) return b;
                if (!b.HasValue) return a;
                return new Bounds2D(
                    Math.Min(a.MinX, b.MinX),
                    Math.Min(a.MinY, b.MinY),
                    Math.Max(a.MaxX, b.MaxX),
                    Math.Max(a.MaxY, b.MaxY),
                    a.Z);
            }

            public static Bounds2D OfRecords(IReadOnlyList<StationRoadRecord> records) {
                Bounds2D acc = default;
                if (records == null) return acc;
                for (int i = 0; i < records.Count; i++) {
                    var r = records[i];
                    if (r == null) continue;
                    acc = Union(acc, Of(r));
                }
                return acc;
            }

            public bool OverlapsPadded(Bounds2D other, double pad) {
                if (!HasValue || !other.HasValue || Z != other.Z) return false;
                return MinX - pad <= other.MaxX && other.MinX <= MaxX + pad &&
                       MinY - pad <= other.MaxY && other.MinY <= MaxY + pad;
            }
        }

        static bool Between(double value, double a, double b) =>
            value >= Math.Min(a, b) - EndpointEpsilon && value <= Math.Max(a, b) + EndpointEpsilon;

        /// <summary>
        /// True when two well-formed authored roads can affect each other's split graph,
        /// coalescing, junctions, lane connectors, curbs, or lane-marking ink intervals.
        /// </summary>
        public static bool RoadsDirectlyInteract(StationRoadRecord a, StationRoadRecord b) {
            if (a == null || b == null || a.Z != b.Z) return false;
            if (!a.IsWellFormed(out _, out _) || !b.IsWellFormed(out _, out _)) return false;

            // 1. Authored rectangle touch or overlap (crossings, T-junctions, collinear coalescing, shared caps).
            if (a.X <= b.X + b.W && b.X <= a.X + a.W && a.Y <= b.Y + b.D && b.Y <= a.Y + a.D) {
                return true;
            }

            // 2. Perpendicular ink-margin reach (InkIntervals expands perpendicular crossings by ±InkMargin).
            var la = StationRoadLayout.Layout(a);
            var lb = StationRoadLayout.Layout(b);
            if (la.AcrossX != lb.AcrossX) {
                var v = la.AcrossX ? a : b;
                var h = la.AcrossX ? b : a;
                if ((v.X <= h.X + h.W && h.X <= v.X + v.W && v.Y < h.Y + h.D + InkMargin && h.Y - InkMargin < v.Y + v.D) ||
                    (h.Y <= v.Y + v.D && v.Y <= h.Y + h.D && h.X < v.X + v.W + InkMargin && v.X - InkMargin < h.X + h.W)) {
                    return true;
                }
            }

            // 3. Explicit endpoint-segment crossing or collinear containment (mirrors StationRoadDocument.Read).
            var epA = StationRoadDocument.Endpoints(a);
            var epB = StationRoadDocument.Endpoints(b);
            var a0 = epA[0]; var a1 = epA[1];
            var b0 = epB[0]; var b1 = epB[1];
            bool aVert = Math.Abs(a0.X - a1.X) <= EndpointEpsilon;
            bool bVert = Math.Abs(b0.X - b1.X) <= EndpointEpsilon;
            if (aVert != bVert) {
                var (v0, v1) = aVert ? (a0, a1) : (b0, b1);
                var (h0, h1) = aVert ? (b0, b1) : (a0, a1);
                if (Between(v0.X, h0.X, h1.X) && Between(h0.Y, v0.Y, v1.Y)) return true;
            } else if (aVert && Math.Abs(a0.X - b0.X) <= EndpointEpsilon) {
                if (Between(a0.Y, b0.Y, b1.Y) || Between(a1.Y, b0.Y, b1.Y) ||
                    Between(b0.Y, a0.Y, a1.Y) || Between(b1.Y, a0.Y, a1.Y)) return true;
            } else if (!aVert && Math.Abs(a0.Y - b0.Y) <= EndpointEpsilon) {
                if (Between(a0.X, b0.X, b1.X) || Between(a1.X, b0.X, b1.X) ||
                    Between(b0.X, a0.X, a1.X) || Between(b1.X, a0.X, a1.X)) return true;
            }

            return false;
        }

        /// <summary>
        /// Exact safety-net closure check: true when <paramref name="junction"/> touches or
        /// overlaps any road or junction of another component at the same elevation (e.g. a
        /// T-junction box expanded across a receiving carriageway).
        /// </summary>
        public static bool JunctionTouchesComponent(RoadJunction junction,
            IReadOnlyList<StationRoadRecord> records, IReadOnlyList<RoadJunction> junctions) {
            if (junction == null) return false;
            if (junctions != null) {
                for (int i = 0; i < junctions.Count; i++) {
                    var k = junctions[i];
                    if (k == null || k.Z != junction.Z) continue;
                    if (junction.X0 <= k.X1 && junction.X1 >= k.X0 &&
                        junction.Y0 <= k.Y1 && junction.Y1 >= k.Y0) {
                        return true;
                    }
                }
            }
            if (records != null) {
                for (int i = 0; i < records.Count; i++) {
                    var r = records[i];
                    if (r == null || r.Z != junction.Z) continue;
                    if (junction.X0 <= r.X + r.W && junction.X1 >= r.X &&
                        junction.Y0 <= r.Y + r.D && junction.Y1 >= r.Y) {
                        return true;
                    }
                }
            }
            return false;
        }

        /// <summary>
        /// Partition authored road records into independent connected components, preserving
        /// original document order both within each component and across components.
        /// Malformed records form isolated singleton components.
        /// </summary>
        public static List<List<StationRoadRecord>> Partition(IReadOnlyList<StationRoadRecord> records) {
            var groups = new List<List<StationRoadRecord>>();
            if (records == null || records.Count == 0) return groups;
            int n = records.Count;
            var parent = new int[n];
            var wellFormed = new bool[n];
            var bounds = new Bounds2D[n];
            for (int i = 0; i < n; i++) {
                parent[i] = i;
                var r = records[i];
                wellFormed[i] = r != null && r.IsWellFormed(out _, out _);
                if (wellFormed[i]) bounds[i] = Bounds2D.Of(r);
            }

            int Find(int x) {
                while (parent[x] != x) {
                    parent[x] = parent[parent[x]];
                    x = parent[x];
                }
                return x;
            }
            void Union(int a, int b) {
                int ra = Find(a), rb = Find(b);
                if (ra == rb) return;
                if (ra < rb) parent[rb] = ra;
                else parent[ra] = rb;
            }

            for (int i = 0; i < n; i++) {
                if (!wellFormed[i]) continue;
                for (int j = i + 1; j < n; j++) {
                    if (!wellFormed[j]) continue;
                    if (!bounds[i].OverlapsPadded(bounds[j], InkMargin)) continue;
                    if (RoadsDirectlyInteract(records[i], records[j])) Union(i, j);
                }
            }

            var byRoot = new Dictionary<int, List<StationRoadRecord>>();
            for (int i = 0; i < n; i++) {
                int root = Find(i);
                if (!byRoot.TryGetValue(root, out var list)) {
                    list = new List<StationRoadRecord>();
                    byRoot.Add(root, list);
                    groups.Add(list);
                }
                list.Add(records[i]);
            }
            return groups;
        }

        /// <summary>
        /// Concatenate disjoint component <see cref="RoadGraph"/>s into one aggregate graph
        /// without recomputing intersections or splits.
        /// </summary>
        public static RoadGraph ComposeGraph(IReadOnlyList<StationRoadRecord> allAuthored,
            IReadOnlyList<RoadGraph> subGraphs) {
            var graph = new RoadGraph();
            if (allAuthored != null) {
                for (int i = 0; i < allAuthored.Count; i++) {
                    if (allAuthored[i] != null) graph.AuthoredRecords.Add(allAuthored[i]);
                }
            }
            if (subGraphs == null) return graph;
            for (int g = 0; g < subGraphs.Count; g++) {
                var sub = subGraphs[g];
                if (sub == null) continue;
                for (int i = 0; i < sub.Diagnostics.Count; i++) graph.Diagnostics.Add(sub.Diagnostics[i]);
                for (int i = 0; i < sub.Modules.Count; i++) graph.Modules.Add(sub.Modules[i]);
                for (int i = 0; i < sub.Nodes.Count; i++) graph.AddNode(sub.Nodes[i]);
                for (int i = 0; i < sub.Segments.Count; i++) graph.AddSegment(sub.Segments[i]);
            }
            return graph;
        }

        /// <summary>
        /// Concatenate disjoint component <see cref="RoadNetwork"/>s into one aggregate network,
        /// rebasing junction and edge indices so <see cref="StationRoadLayout.JunctionSides"/>
        /// and edge connectivity match a fresh full rebuild exactly.
        /// </summary>
        public static RoadNetwork ComposeNetwork(IReadOnlyList<RoadNetwork> subNetworks) {
            var network = new RoadNetwork();
            if (subNetworks == null) return network;
            for (int n = 0; n < subNetworks.Count; n++) {
                var sub = subNetworks[n];
                if (sub == null) continue;
                int jOffset = network.Junctions.Count;
                int eOffset = network.Edges.Count;
                for (int i = 0; i < sub.Roads.Count; i++) network.Roads.Add(sub.Roads[i]);
                for (int i = 0; i < sub.Junctions.Count; i++) network.Junctions.Add(sub.Junctions[i]);
                for (int i = 0; i < sub.Edges.Count; i++) {
                    var src = sub.Edges[i];
                    var copy = new RoadEdge {
                        Road = src.Road,
                        Lane = src.Lane,
                        Sign = src.Sign,
                        Axis = src.Axis,
                        Start = src.Start,
                        End = src.End,
                        Length = src.Length,
                        Junction = src.Junction >= 0 ? src.Junction + jOffset : -1,
                        HasControl = src.HasControl,
                        Control = src.Control,
                    };
                    for (int k = 0; k < src.Next.Count; k++) copy.Next.Add(src.Next[k] + eOffset);
                    network.Edges.Add(copy);
                }
                for (int i = 0; i < sub.Entries.Count; i++) network.Entries.Add(sub.Entries[i] + eOffset);
            }
            return network;
        }
    }
}
