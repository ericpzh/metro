using System;
using System.Collections.Generic;
using System.Linq;
using Metro.Build;
using Metro.Sim;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>Stable pick record for a rendered road piece (authored module ID, not a split ID).</summary>
    public sealed class RoadPiece : MonoBehaviour {
        public string moduleId = "";
        public string sourceId = "";
        public string role = "";
    }

    /// <summary>
    /// Runtime renderer for authored road records. Ports
    /// <c>game/src/render/models/pieces/RoadModel.ts</c> and
    /// <c>RoadArrowMarking.ts</c> onto generated meshes: asphalt deck, side curbs,
    /// edge/lane/double-yellow paint, dashed lane divisions, junction gaps, zebra
    /// crossings, stop lines, turn arrows and roadside signal heads.
    ///
    /// The builder works in the caller-placed parent's local space
    /// (<c>local = (documentX, documentElevation, documentY)</c>) and never writes
    /// derived geometry back to the document. A road the layout cannot resolve
    /// produces an explicit <see cref="Diagnostic"/> with its module ID and no
    /// stand-in box.
    /// </summary>
    public sealed class StationRoadView : MonoBehaviour {
        public sealed class Diagnostic {
            public string ModuleId = "";
            public string Code = "";
            public string Detail = "";
            public override string ToString() => $"{Code} {ModuleId}: {Detail}";
        }

        enum Paint { Deck, Curb, White, Yellow, Steel, Dark, Black, SignalRed, SignalAmber, SignalGreen, Unlit }

        /// <summary>One controlled approach's pole and three switchable lenses.</summary>
        public sealed class SignalHead {
            public RoadJunction Junction;
            public bool Axis;
            public Renderer[] Lenses;
            public RoadSignalPhase Phase = (RoadSignalPhase)(-1);
        }

        sealed class MeshData {
            public readonly List<Vector3> Vertices = new List<Vector3>(64);
            public readonly List<int> Triangles = new List<int>(128);

            public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d) {
                int i = Vertices.Count;
                Vertices.Add(a); Vertices.Add(b); Vertices.Add(c); Vertices.Add(d);
                Triangles.Add(i); Triangles.Add(i + 1); Triangles.Add(i + 2);
                Triangles.Add(i); Triangles.Add(i + 2); Triangles.Add(i + 3);
            }

            public void Box(Vector3 centre, Vector3 size) {
                float hx = size.x / 2, hy = size.y / 2, hz = size.z / 2;
                var p000 = centre + new Vector3(-hx, -hy, -hz);
                var p100 = centre + new Vector3(hx, -hy, -hz);
                var p010 = centre + new Vector3(-hx, hy, -hz);
                var p110 = centre + new Vector3(hx, hy, -hz);
                var p001 = centre + new Vector3(-hx, -hy, hz);
                var p101 = centre + new Vector3(hx, -hy, hz);
                var p011 = centre + new Vector3(-hx, hy, hz);
                var p111 = centre + new Vector3(hx, hy, hz);
                Quad(p000, p100, p110, p010);
                Quad(p001, p011, p111, p101);
                Quad(p000, p010, p011, p001);
                Quad(p100, p101, p111, p110);
                Quad(p000, p001, p101, p100);
                Quad(p010, p110, p111, p011);
            }

            public void Polygon(IReadOnlyList<Vector2> polygon, Func<Vector2, Vector3> map) {
                var points = new List<Vector2>(polygon);
                if (points.Count < 3) return;
                if (points[points.Count - 1] == points[0]) points.RemoveAt(points.Count - 1);
                double area = 0;
                for (int i = 0; i < points.Count; i++) {
                    var a = points[i];
                    var b = points[(i + 1) % points.Count];
                    area += a.x * b.y - b.x * a.y;
                }
                if (area < 0) points.Reverse();
                int guard = 0;
                while (points.Count > 3 && guard++ < 64) {
                    bool clipped = false;
                    for (int i = 0; i < points.Count; i++) {
                        var a = points[(i + points.Count - 1) % points.Count];
                        var b = points[i];
                        var c = points[(i + 1) % points.Count];
                        double cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
                        if (cross <= 1e-9) continue;
                        bool contains = false;
                        foreach (var p in points) {
                            if (p == a || p == b || p == c) continue;
                            if (Inside(a, b, c, p)) { contains = true; break; }
                        }
                        if (contains) continue;
                        Triangle(a, b, c, map);
                        points.RemoveAt(i);
                        clipped = true;
                        break;
                    }
                    if (!clipped) break;
                }
                if (points.Count == 3) Triangle(points[0], points[1], points[2], map);
            }

            void Triangle(Vector2 a, Vector2 b, Vector2 c, Func<Vector2, Vector3> map) {
                int i = Vertices.Count;
                Vertices.Add(map(a)); Vertices.Add(map(b)); Vertices.Add(map(c));
                Triangles.Add(i); Triangles.Add(i + 1); Triangles.Add(i + 2);
            }

            static bool Inside(Vector2 a, Vector2 b, Vector2 c, Vector2 p) {
                double d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
                double d2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
                double d3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
                bool hasNegative = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
                bool hasPositive = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
                return !(hasNegative && hasPositive);
            }

            public Mesh Build(string name) {
                if (Vertices.Count == 0) return null;
                var mesh = new Mesh { name = name, indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
                mesh.SetVertices(Vertices);
                mesh.SetTriangles(Triangles, 0);
                mesh.RecalculateNormals();
                mesh.RecalculateBounds();
                return mesh;
            }
        }

        /// <summary>
        /// Owned view objects, meshes, signals, diagnostics and counters for one connected road
        /// component (plan 39 §9). Retained components keep these objects alive across edits to
        /// disconnected networks; replaced components hand only their own GameObjects and Meshes
        /// to <see cref="StationLocalViewCommit"/> on commit.
        /// </summary>
        public sealed class ComponentViewData {
            public int Serial;
            public RoadGraph SubGraph;
            public RoadNetwork SubNetwork;
            public readonly Dictionary<string, GameObject> RoadRoots = new Dictionary<string, GameObject>(StringComparer.Ordinal);
            public readonly List<Mesh> OwnedMeshes = new List<Mesh>();
            public readonly List<SignalHead> Signals = new List<SignalHead>();
            public readonly List<Diagnostic> Diagnostics = new List<Diagnostic>();
            public int Roads;
            public int Segments;
            public int Arrows;
            public int Crosswalks;
            public int StopLines;
            public int MarkingSpans;
        }

        readonly List<Material> ownedMaterials = new List<Material>();
        readonly List<Mesh> ownedMeshes = new List<Mesh>();
        readonly List<SignalHead> signals = new List<SignalHead>();
        readonly List<Diagnostic> diagnostics = new List<Diagnostic>();
        readonly Dictionary<string, GameObject> roots = new Dictionary<string, GameObject>(StringComparer.Ordinal);
        readonly List<ComponentViewData> activeComponents = new List<ComponentViewData>();
        readonly List<StationRoadRecord> allAuthored = new List<StationRoadRecord>();
        bool componentMode;
        bool aggregatesDirty;
        RoadGraph cachedGraph;
        RoadNetwork cachedNetwork;
        Material[] paints;
        Transform previewRoot;
        Material previewAdd, previewDelete;

        public RoadGraph Graph {
            get {
                EnsureAggregates();
                return cachedGraph;
            }
        }
        public RoadNetwork Network {
            get {
                EnsureAggregates();
                return cachedNetwork;
            }
        }
        public IReadOnlyList<Diagnostic> Diagnostics => diagnostics;
        public IReadOnlyList<SignalHead> Signals => signals;
        public int Roads { get; private set; }
        public int Segments { get; private set; }
        public int Arrows { get; private set; }
        public int SignalsBuilt => signals.Count;
        public int Crosswalks { get; private set; }
        public int StopLines { get; private set; }
        public int MarkingSpans { get; private set; }

        void EnsureAggregates() {
            if (!componentMode || !aggregatesDirty) return;
            var subGraphs = new List<RoadGraph>(activeComponents.Count);
            var subNetworks = new List<RoadNetwork>(activeComponents.Count);
            for (int i = 0; i < activeComponents.Count; i++) {
                if (activeComponents[i].SubGraph != null) subGraphs.Add(activeComponents[i].SubGraph);
                if (activeComponents[i].SubNetwork != null) subNetworks.Add(activeComponents[i].SubNetwork);
            }
            cachedGraph = StationRoadComponents.ComposeGraph(allAuthored, subGraphs);
            cachedNetwork = StationRoadComponents.ComposeNetwork(subNetworks);
            aggregatesDirty = false;
        }

        /// <summary>Create an empty persistent road view ready for component-scoped staging/swaps.</summary>
        public static StationRoadView CreateEmpty(Transform parent, Shader shader, Shader unlitShader = null) {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var view = parent.gameObject.AddComponent<StationRoadView>();
            view.componentMode = true;
            view.aggregatesDirty = true;
            view.paints = view.CreatePaints(shader, unlitShader);
            return view;
        }

        /// <summary>Build from the current save projection's module facts.</summary>
        public static StationRoadView Build(Transform parent, IReadOnlyList<ModuleFacts> modules, Shader shader,
            Shader unlitShader = null) {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var records = StationRoadRecord.FromFacts(modules);
            return BuildRecords(parent, records, shader, unlitShader);
        }

        /// <summary>Build from explicit authored road records (editor adapter, tests, previews).</summary>
        public static StationRoadView BuildRecords(Transform parent, IEnumerable<StationRoadRecord> records,
            Shader shader, Shader unlitShader = null) {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var graph = StationRoadDocument.Read(records);
            return BuildGraph(parent, graph, shader, unlitShader);
        }

        public static StationRoadView BuildGraph(Transform parent, RoadGraph graph, Shader shader, Shader unlitShader = null) {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            if (graph == null) throw new ArgumentNullException(nameof(graph));
            var view = parent.gameObject.AddComponent<StationRoadView>();
            view.cachedGraph = graph;
            view.cachedNetwork = StationRoadLayout.Network(graph);
            view.paints = view.CreatePaints(shader, unlitShader);
            view.BuildAll(parent);
            return view;
        }

        Material[] CreatePaints(Shader shader, Shader unlitShader) {
            Shader lit = shader != null ? shader : Shader.Find("Universal Render Pipeline/Lit");
            if (!lit) lit = Shader.Find("Universal Render Pipeline/Unlit");
            if (!lit) lit = Shader.Find("Unlit/Color");
            if (!lit) lit = Shader.Find("Sprites/Default");
            if (!lit) throw new InvalidOperationException("StationRoadView needs a shader");
            Shader unlit = unlitShader != null ? unlitShader : Shader.Find("Universal Render Pipeline/Unlit");
            if (!unlit) unlit = lit;
            var result = new Material[Enum.GetValues(typeof(Paint)).Length];
            result[(int)Paint.Deck] = Owned(lit, new Color(.231f, .247f, .271f), .96f);
            result[(int)Paint.Curb] = Owned(lit, new Color(.60f, .62f, .64f), .85f);
            result[(int)Paint.White] = Owned(lit, new Color(0xee / 255f, 0xf1 / 255f, 0xf4 / 255f), .8f);
            result[(int)Paint.Yellow] = Owned(lit, new Color(0xf7 / 255f, 0xc8 / 255f, 0x3c / 255f), .8f);
            result[(int)Paint.Steel] = Owned(lit, new Color(.718f, .741f, .769f), .55f);
            result[(int)Paint.Dark] = Owned(lit, new Color(.235f, .263f, .298f), .55f);
            result[(int)Paint.Black] = Owned(lit, new Color(.106f, .118f, .141f), .5f);
            result[(int)Paint.SignalRed] = Owned(unlit, new Color(1f, .207f, .207f), 1f);
            result[(int)Paint.SignalAmber] = Owned(unlit, new Color(1f, .741f, .207f), 1f);
            result[(int)Paint.SignalGreen] = Owned(unlit, new Color(.251f, .898f, .541f), 1f);
            result[(int)Paint.Unlit] = Owned(unlit, new Color(.125f, .145f, .133f), 1f);
            previewAdd = Owned(unlit, new Color(1f, .82f, .18f), 1f);
            previewDelete = Owned(unlit, new Color(1f, .28f, .2f), 1f);
            return result;
        }

        Material Owned(Shader shader, Color color, float smoothness) {
            var material = new Material(shader) { color = color };
            material.SetInt("_Cull", 0);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", smoothness);
            ownedMaterials.Add(material);
            return material;
        }

        void BuildAll(Transform parent) {
            var comp = StageComponent(parent, 0, cachedGraph, cachedNetwork);
            for (int i = 0; i < comp.Diagnostics.Count; i++) diagnostics.Add(comp.Diagnostics[i]);
            foreach (var pair in comp.RoadRoots) roots[pair.Key] = pair.Value;
            for (int i = 0; i < comp.OwnedMeshes.Count; i++) ownedMeshes.Add(comp.OwnedMeshes[i]);
            for (int i = 0; i < comp.Signals.Count; i++) signals.Add(comp.Signals[i]);
            Roads = comp.Roads;
            Segments = comp.Segments;
            Arrows = comp.Arrows;
            Crosswalks = comp.Crosswalks;
            StopLines = comp.StopLines;
            MarkingSpans = comp.MarkingSpans;
        }

        /// <summary>
        /// Stage one connected road component under <paramref name="stagingParent"/> without
        /// mutating any live state on this <see cref="StationRoadView"/>. Reads only shared
        /// materials (<c>paints</c>) and returns an isolated <see cref="ComponentViewData"/>.
        /// </summary>
        public ComponentViewData StageComponent(Transform stagingParent, int componentSerial,
            RoadGraph subGraph, RoadNetwork subNetwork) {
            var comp = new ComponentViewData {
                Serial = componentSerial,
                SubGraph = subGraph,
                SubNetwork = subNetwork,
            };
            if (subGraph == null || subNetwork == null) return comp;
            foreach (var diagnostic in subGraph.Diagnostics) {
                comp.Diagnostics.Add(new Diagnostic { ModuleId = diagnostic.ModuleId, Code = diagnostic.Code, Detail = diagnostic.Detail });
                Debug.LogWarning($"Road {diagnostic.ModuleId} unresolved: {diagnostic.Code} ({diagnostic.Detail})");
            }
            var junctionSides = StationRoadLayout.JunctionSides(subNetwork);
            foreach (var record in subGraph.Authored) {
                if (!record.IsWellFormed(out var code, out var detail)) {
                    comp.Diagnostics.Add(new Diagnostic { ModuleId = record.Id, Code = code, Detail = detail });
                    Debug.LogWarning($"Road {record.Id} unresolved: {code} ({detail})");
                    continue;
                }
                BuildRoadInto(stagingParent, record, subGraph.Authored, subNetwork, junctionSides, comp);
                comp.Roads++;
            }
            comp.Segments = subGraph.Segments.Count;
            return comp;
        }

        /// <summary>
        /// Atomically swap retired road components for newly staged ones on this persistent view.
        /// Retired road GameObjects and Meshes are detached (owned by caller's commit retirement);
        /// newly staged road GameObjects are reparented directly under this view's transform.
        /// </summary>
        public void CommitComponentSwap(IReadOnlyList<ComponentViewData> retired,
            IReadOnlyList<ComponentViewData> added, IReadOnlyList<StationRoadRecord> nextAllAuthored) {
            if (retired != null && retired.Count > 0) {
                var retiredSet = new HashSet<ComponentViewData>(retired);
                for (int i = activeComponents.Count - 1; i >= 0; i--) {
                    if (retiredSet.Contains(activeComponents[i])) activeComponents.RemoveAt(i);
                }
                for (int r = 0; r < retired.Count; r++) {
                    foreach (var roadId in retired[r].RoadRoots.Keys) roots.Remove(roadId);
                }
            }
            if (added != null) {
                for (int a = 0; a < added.Count; a++) {
                    var comp = added[a];
                    foreach (var pair in comp.RoadRoots) {
                        if (pair.Value != null) pair.Value.transform.SetParent(transform, false);
                        roots[pair.Key] = pair.Value;
                    }
                    activeComponents.Add(comp);
                }
            }

            allAuthored.Clear();
            if (nextAllAuthored != null) {
                for (int i = 0; i < nextAllAuthored.Count; i++) allAuthored.Add(nextAllAuthored[i]);
            }

            signals.Clear();
            diagnostics.Clear();
            int roads = 0, segments = 0, arrows = 0, crosswalks = 0, stopLines = 0, markingSpans = 0;
            for (int i = 0; i < activeComponents.Count; i++) {
                var comp = activeComponents[i];
                roads += comp.Roads;
                segments += comp.Segments;
                arrows += comp.Arrows;
                crosswalks += comp.Crosswalks;
                stopLines += comp.StopLines;
                markingSpans += comp.MarkingSpans;
                for (int s = 0; s < comp.Signals.Count; s++) signals.Add(comp.Signals[s]);
                for (int d = 0; d < comp.Diagnostics.Count; d++) diagnostics.Add(comp.Diagnostics[d]);
            }
            Roads = roads;
            Segments = segments;
            Arrows = arrows;
            Crosswalks = crosswalks;
            StopLines = stopLines;
            MarkingSpans = markingSpans;
            aggregatesDirty = true;
        }

        public bool TryGetRoadRoot(string moduleId, out GameObject root) {
            if (moduleId != null && roots.TryGetValue(moduleId, out root) && root != null) return true;
            root = null;
            return false;
        }

        void BuildRoadInto(Transform parent, StationRoadRecord record, IReadOnlyList<StationRoadRecord> componentAuthored,
            RoadNetwork componentNetwork, IReadOnlyList<RoadJunctionSide> junctionSides, ComponentViewData comp) {
            var layout = StationRoadLayout.Layout(record);
            // The source draws a full authored rectangle per record; split segments are
            // graph facts for editing/traffic, not extra saved geometry.
            var root = new GameObject("road " + record.Id).transform;
            root.SetParent(parent, false);
            comp.RoadRoots[record.Id] = root.gameObject;
            var piece = root.gameObject.AddComponent<RoadPiece>();
            piece.moduleId = record.Id;
            piece.sourceId = record.Id;
            piece.role = "road";

            float surface = (float)record.Z + 1.025f + comp.Roads * .00002f;
            var deck = new MeshData();
            double x0 = record.X, x1 = record.X + record.W, y0 = record.Y, y1 = record.Y + record.D;
            deck.Quad(new Vector3((float)x0, surface, (float)y0), new Vector3((float)x1, surface, (float)y0),
                new Vector3((float)x1, surface, (float)y1), new Vector3((float)x0, surface, (float)y1));
            AddMesh(root, deck, Paint.Deck, record.Id, "deck", comp.OwnedMeshes);

            // Side curbs follow the same clipping as the paint, so a crossing opens a
            // real gap in the kerb instead of a wall through the junction.
            var curbs = new MeshData();
            foreach (double across in new[] {.06, layout.Width - .06}) {
                foreach (var span in StationRoadLayout.InkIntervals(record, componentAuthored, across, 0)) {
                    Slab(curbs, record, across, (span.Lo + span.Hi) / 2, .12, span.Hi - span.Lo, (float)record.Z + .965f, .13f);
                }
            }
            AddMesh(root, curbs, Paint.Curb, record.Id, "curb", comp.OwnedMeshes);

            var white = new MeshData();
            var yellow = new MeshData();
            void Ink(double across, bool dashed, bool yellowPaint) {
                var target = yellowPaint ? yellow : white;
                foreach (var span in StationRoadLayout.InkIntervals(record, componentAuthored, across, StationRoadLayout.CrosswalkDepth + 1.5)) {
                    for (double from = dashed ? Math.Floor(span.Lo / 6) * 6 : span.Lo; from < span.Hi; from += dashed ? 6 : layout.Length + 1) {
                        double lo = Math.Max(span.Lo, from);
                        double hi = Math.Min(span.Hi, dashed ? from + 3 : span.Hi);
                        if (hi <= lo) continue;
                        Slab(target, record, across, (lo + hi) / 2, .12, hi - lo, (float)record.Z + 1.035f, .008f);
                        comp.MarkingSpans++;
                    }
                }
            }
            Ink(.16, false, false);
            Ink(layout.Width - .16, false, false);
            for (int lane = 1; lane < layout.Lanes; lane++) {
                if (record.TwoWay && lane == layout.Lanes / 2) {
                    Ink(layout.Width / 2 - .13, false, true);
                    Ink(layout.Width / 2 + .13, false, true);
                } else {
                    Ink(lane * layout.LaneWidth, true, false);
                }
            }

            // Arrival arrows, stop lines and signal poles come from the lane network,
            // not from the arrow-per-lane preview (source RoadModel behaviour).
            var approaches = new HashSet<string>(StringComparer.Ordinal);
            for (int sIdx = 0; sIdx < junctionSides.Count; sIdx++) {
                var side = junctionSides[sIdx];
                var junction = componentNetwork.Junctions[side.Junction];
                if (junction.Uncontrolled || junction.Z != record.Z || side.Road != record.Id) continue;
                double along = side.Boundary + side.Out * (StationRoadLayout.CrosswalkDepth / 2 + .8);
                double roadWidth = side.Axis ? record.W : record.D;
                for (double across = .4; across < roadWidth - .3; across += 1) {
                    Slab(white, record, across,
                        side.Axis ? along - record.Y : along - record.X,
                        .5, StationRoadLayout.CrosswalkDepth,
                        (float)record.Z + 1.045f, .012f);
                    comp.Crosswalks++;
                }
            }
            for (int eIdx = 0; eIdx < componentNetwork.Edges.Count; eIdx++) {
                var edge = componentNetwork.Edges[eIdx];
                if (edge.Road.Id != record.Id || edge.Junction >= 0) continue;
                RoadEdge connector = null;
                foreach (int next in edge.Next) {
                    var candidate = componentNetwork.Edges[next];
                    if (candidate.Junction >= 0) { connector = candidate; break; }
                }
                if (connector == null) continue;
                var junction = componentNetwork.Junctions[connector.Junction];
                if (junction.Uncontrolled) continue;
                var turns = StationRoadLayout.EdgeMovements(componentNetwork, edge);
                if (edge.Length > StationRoadLayout.CrosswalkDepth + 3) {
                    double setback = Math.Min(7, edge.Length - 1.5);
                    double distance = Math.Min(setback, (edge.Length + StationRoadLayout.CrosswalkDepth + 1.5) / 2);
                    double ax = edge.End.X - (edge.Axis ? 0 : edge.Sign * distance);
                    double ay = edge.End.Y - (edge.Axis ? edge.Sign * distance : 0);
                    double scale = Math.Min(1, Math.Min(layout.LaneWidth / 3, (edge.Length - StationRoadLayout.CrosswalkDepth - 1.5) / 3.2));
                    AddArrow(white, record, turns, ax, ay, (float)record.Z + 1.06f, edge.Axis, edge.Sign, scale);
                    comp.Arrows++;
                }
                string key = connector.Junction + ":" + edge.Axis + ":" + edge.Sign;
                if (!approaches.Add(key)) continue;
                double approachAlong = (edge.Axis ? edge.End.Y : edge.End.X) - edge.Sign * (StationRoadLayout.CrosswalkDepth / 2 + .8);
                double stop = approachAlong - edge.Sign * (StationRoadLayout.CrosswalkDepth / 2 + .5);
                double stopWidth = record.TwoWay ? layout.Width / 2 : layout.Width;
                double stopAcross = (edge.Axis ? record.X : record.Y) +
                    (record.TwoWay && edge.Lane >= layout.Lanes / 2 ? layout.Width / 2 : 0) + stopWidth / 2;
                Slab(white, record,
                    stopAcross - (edge.Axis ? record.X : record.Y),
                    stop - (edge.Axis ? record.Y : record.X),
                    stopWidth, .2,
                    (float)record.Z + 1.045f, .012f);
                comp.StopLines++;
                double side = (edge.Axis ? record.X : record.Y) +
                    (edge.Sign * (edge.Axis ? 1 : -1) > 0 ? (edge.Axis ? record.W : record.D) + .5 : -.5);
                int rot = edge.Axis ? (edge.Sign > 0 ? 0 : 2) : (edge.Sign > 0 ? 3 : 1);
                BuildSignal(root, junction, edge.Axis, edge.Axis ? side : approachAlong,
                    edge.Axis ? approachAlong : side, record.Z, rot, comp.OwnedMeshes, comp.Signals);
            }
            AddMesh(root, white, Paint.White, record.Id, "markings", comp.OwnedMeshes);
            AddMesh(root, yellow, Paint.Yellow, record.Id, "markings-yellow", comp.OwnedMeshes);

            var collider = root.gameObject.AddComponent<BoxCollider>();
            collider.center = new Vector3((float)(record.X + record.W / 2.0), surface - .01f, (float)(record.Y + record.D / 2.0));
            collider.size = new Vector3(record.W, .08f, record.D);
        }

        void Slab(MeshData mesh, StationRoadRecord record, double across, double along, double acrossSize, double alongSize,
            float y, float thickness) {
            bool acrossX = StationRoadLayout.Layout(record).AcrossX;
            double x = acrossX ? record.X + across : record.X + along;
            double z = acrossX ? record.Y + along : record.Y + across;
            var size = acrossX
                ? new Vector3((float)acrossSize, thickness, (float)alongSize)
                : new Vector3((float)alongSize, thickness, (float)acrossSize);
            mesh.Box(new Vector3((float)x, y, (float)z), size);
        }

        void AddArrow(MeshData mesh, StationRoadRecord record, IReadOnlyList<RoadTurn> turns, double x, double y,
            float elevation, bool axis, int sign, double scale) {
            double theta = axis ? (sign > 0 ? 0 : Math.PI) : (sign > 0 ? -Math.PI / 2 : Math.PI / 2);
            double cos = Math.Cos(theta), sin = Math.Sin(theta);
            Vector3 Map(Vector2 p) {
                double u = p.x * scale, v = p.y * scale;
                return new Vector3((float)(x + u * cos - v * sin), elevation, (float)(y + u * sin + v * cos));
            }
            mesh.Polygon(new[] {
                new Vector2(-.12f, -1.3f), new Vector2(.12f, -1.3f), new Vector2(.12f, .25f), new Vector2(-.12f, .25f),
            }, Map);
            if (Contains(turns, RoadTurn.Straight))
                mesh.Polygon(new[] {
                    new Vector2(-.12f, .1f), new Vector2(.12f, .1f), new Vector2(.12f, .8f), new Vector2(.55f, .8f),
                    new Vector2(0, 1.5f), new Vector2(-.55f, .8f), new Vector2(-.12f, .8f),
                }, Map);
            var branch = new[] {
                new Vector2(0, -.15f), new Vector2(-.85f, .4f), new Vector2(-.85f, .1f), new Vector2(-1.4f, .55f),
                new Vector2(-.85f, 1f), new Vector2(-.85f, .7f), new Vector2(0, .15f),
            };
            if (Contains(turns, RoadTurn.Left)) mesh.Polygon(branch, Map);
            if (Contains(turns, RoadTurn.Right)) {
                var mirrored = new Vector2[branch.Length];
                for (int i = 0; i < branch.Length; i++) mirrored[i] = new Vector2(-branch[i].x, branch[i].y);
                mesh.Polygon(mirrored, Map);
            }
        }

        static bool Contains(IReadOnlyList<RoadTurn> turns, RoadTurn turn) {
            for (int i = 0; i < turns.Count; i++) if (turns[i] == turn) return true;
            return false;
        }

        void BuildSignal(Transform parent, RoadJunction junction, bool axis, double x, double y, double z, int rot,
            List<Mesh> meshSink, List<SignalHead> signalSink) {
            var root = new GameObject("road-signal " + junction.Id).transform;
            root.SetParent(parent, false);
            root.localPosition = new Vector3((float)x, (float)z + 1f, (float)y);
            root.localRotation = Metro.View.ModulePlacement.Rotation(rot);
            var piece = root.gameObject.AddComponent<RoadPiece>();
            piece.moduleId = "signal:" + junction.Id;
            piece.role = "signal";

            var body = new MeshData();
            body.Box(new Vector3(0, .06f, 0), new Vector3(.32f, .12f, .32f));
            body.Box(new Vector3(0, 1.45f, 0), new Vector3(.09f, 2.9f, .09f));
            body.Box(new Vector3(0, 2.97f, 0), new Vector3(.42f, 1.06f, .26f));
            AddMesh(root, body, Paint.Dark, piece.moduleId, "signal-body", meshSink);
            var lenses = new Renderer[3];
            for (int i = 0; i < 3; i++) {
                var lens = new GameObject("traffic-lens-" + i, typeof(MeshFilter), typeof(MeshRenderer));
                lens.transform.SetParent(root, false);
                lens.transform.localPosition = new Vector3(0, 3.3f - i * .33f, -.155f);
                var mesh = new MeshData();
                mesh.Box(Vector3.zero, new Vector3(.25f, .25f, .05f));
                var built = mesh.Build("traffic lens");
                meshSink.Add(built);
                lens.GetComponent<MeshFilter>().sharedMesh = built;
                var renderer = lens.GetComponent<MeshRenderer>();
                renderer.sharedMaterial = paints[(int)Paint.Unlit];
                lenses[i] = renderer;
            }
            signalSink.Add(new SignalHead { Junction = junction, Axis = axis, Lenses = lenses });
        }

        void AddMesh(Transform parent, MeshData data, Paint paint, string moduleId, string role, List<Mesh> meshSink) {
            var mesh = data.Build(role);
            if (mesh == null) return;
            meshSink.Add(mesh);
            var go = new GameObject(role, typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(parent, false);
            go.GetComponent<MeshFilter>().sharedMesh = mesh;
            go.GetComponent<MeshRenderer>().sharedMaterial = paints[(int)paint];
            var piece = go.AddComponent<RoadPiece>();
            piece.moduleId = moduleId;
            piece.sourceId = moduleId;
            piece.role = role;
        }

        /// <summary>Updates signal lens materials from C's station clock; not a document edit.</summary>
        public void SetSimTime(double simTimeSeconds) {
            ApplySignalTime(signals, simTimeSeconds);
        }

        /// <summary>Updates signal lens materials for one newly installed road component only.</summary>
        public void SetComponentSimTime(ComponentViewData comp, double simTimeSeconds) {
            if (comp == null) return;
            ApplySignalTime(comp.Signals, simTimeSeconds);
        }

        void ApplySignalTime(List<SignalHead> targetSignals, double simTimeSeconds) {
            for (int i = 0; i < targetSignals.Count; i++) {
                var head = targetSignals[i];
                var phase = StationRoadLayout.Signal(head.Junction, head.Axis, simTimeSeconds);
                if (phase == head.Phase) continue;
                head.Phase = phase;
                int active = phase == RoadSignalPhase.Red ? 0 : phase == RoadSignalPhase.Amber ? 1 : 2;
                for (int lens = 0; lens < 3; lens++) {
                    var lensRenderer = head.Lenses[lens];
                    if (!lensRenderer) continue;
                    lensRenderer.sharedMaterial = paints[(int)(lens == active
                        ? (Paint)((int)Paint.SignalRed + lens)
                        : Paint.Unlit)];
                    var target = lensRenderer.GetComponentInParent<Metro.View.StationVisibilityTarget>(true);
                    if (target != null) target.Recapture(lensRenderer);
                }
            }
        }

        /// <summary>Show/hide every piece that belongs to an authored module ID.</summary>
        public void SetModuleVisible(string moduleId, bool visible) {
            if (moduleId != null && roots.TryGetValue(moduleId, out var root)) root.SetActive(visible);
        }

        public bool TryModuleId(Collider collider, out string moduleId) {
            moduleId = "";
            if (!collider) return false;
            var piece = collider.GetComponentInParent<RoadPiece>();
            if (!piece) return false;
            moduleId = piece.moduleId;
            return !string.IsNullOrEmpty(moduleId);
        }

        /// <summary>Ghost of the pending road-edit transaction (never a document write).</summary>
        public void ShowPreview(RoadEditPreview preview) {
            ClearPreview();
            if (preview == null || preview.Candidate == null) return;
            var root = new GameObject("road-edit-preview").transform;
            root.SetParent(transform, false);
            previewRoot = root;
            bool isDelete = preview.IsDelete || !string.IsNullOrEmpty(preview.SourceId);
            var material = preview.Valid && !isDelete ? previewAdd : previewDelete;
            var data = new MeshData();
            var record = preview.Candidate;
            var layout = StationRoadLayout.Layout(record);
            float surface = (float)record.Z + 1.03f;
            data.Quad(new Vector3(record.X, surface, record.Y),
                new Vector3(record.X + record.W, surface, record.Y),
                new Vector3(record.X + record.W, surface, record.Y + record.D),
                new Vector3(record.X, surface, record.Y + record.D));
            var mesh = data.Build("road preview");
            ownedMeshes.Add(mesh);
            var go = new GameObject("preview deck", typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(root, false);
            go.GetComponent<MeshFilter>().sharedMesh = mesh;
            go.GetComponent<MeshRenderer>().sharedMaterial = material;
            // Source RoadTool.setRoadNodePreview: every snap node on this elevation is
            // visible while drawing, so authored endpoints and junctions are pickable.
            var nodeData = new MeshData();
            foreach (var node in Graph.Nodes) {
                if (node.Z != record.Z) continue;
                nodeData.Box(new Vector3((float)node.X, (float)record.Z + 1.045f, (float)node.Y),
                    new Vector3(.35f, .02f, .35f));
            }
            var nodeMesh = nodeData.Build("road preview nodes");
            if (nodeMesh != null) {
                ownedMeshes.Add(nodeMesh);
                var nodeGo = new GameObject("preview nodes", typeof(MeshFilter), typeof(MeshRenderer));
                nodeGo.transform.SetParent(root, false);
                nodeGo.GetComponent<MeshFilter>().sharedMesh = nodeMesh;
                nodeGo.GetComponent<MeshRenderer>().sharedMaterial = material;
            }
            for (int lane = 0; lane < layout.Lanes; lane++) {
                var arrow = new MeshData();
                var centre = StationRoadLayout.Point(record, (lane + .5) * layout.LaneWidth, layout.Length / 2);
                AddArrow(arrow, record, new[] { RoadTurn.Straight }, centre.X, centre.Y,
                    (float)record.Z + 1.07f, layout.AcrossX, StationRoadLayout.LaneSign(record, lane),
                    Math.Min(1, Math.Min(layout.LaneWidth / 3, layout.Length / 3.2)));
                var arrowMesh = arrow.Build("road preview arrows");
                if (arrowMesh == null) continue;
                ownedMeshes.Add(arrowMesh);
                var arrowGo = new GameObject("preview arrow", typeof(MeshFilter), typeof(MeshRenderer));
                arrowGo.transform.SetParent(root, false);
                arrowGo.GetComponent<MeshFilter>().sharedMesh = arrowMesh;
                arrowGo.GetComponent<MeshRenderer>().sharedMaterial = material;
            }
        }

        public void ClearPreview() {
            if (previewRoot) {
                if (Application.isPlaying) Destroy(previewRoot.gameObject);
                else DestroyImmediate(previewRoot.gameObject);
            }
            previewRoot = null;
        }

        void OnDestroy() {
            ClearPreview();
            for (int i = 0; i < activeComponents.Count; i++) {
                Kill(activeComponents[i].OwnedMeshes);
                activeComponents[i].OwnedMeshes.Clear();
            }
            activeComponents.Clear();
            Kill(ownedMeshes);
            Kill(ownedMaterials);
            ownedMeshes.Clear();
            ownedMaterials.Clear();
        }

        static void Kill<T>(List<T> owned) where T : UnityEngine.Object {
            foreach (var value in owned) {
                if (!value) continue;
                if (Application.isPlaying) Destroy(value); else DestroyImmediate(value);
            }
        }
    }

    /// <summary>Deterministic work-count record for the latest road build or local delta (plan 39 §9).</summary>
    public struct StationRoadDeltaMetrics {
        public bool UsedIncremental;
        public int RebuiltComponents;
        public int RetainedComponents;
        public int RetiredComponents;
        public int RebuiltRoads;
        public int RetainedRoads;
        public int RetiredRoads;
        public int RebuiltJunctions;
        public int RetainedJunctions;
        public int RebuiltTrafficNetworks;
        public int RetainedTrafficNetworks;
        public int RebuiltVehiclePools;
        public int RetainedVehiclePools;
    }

    /// <summary>
    /// Packet G's station-world renderer. It registers under role <c>"roads"</c>,
    /// partitions authored roads into independent connected components, builds each
    /// component's geometry and ambient traffic separately, and bounds local deltas
    /// (add, erase, direction reversal, join, split, undo, redo) to affected components
    /// while retaining disconnected views, vehicles and traffic clocks (plan 39 §9).
    /// </summary>
    public sealed class StationRoadRenderer : Metro.App.IStationViewRenderer, Metro.App.IStationLocalViewRenderer {
        sealed class RoadComponentState {
            public int Serial;
            public int VehicleIdOffset;
            public StationRoadRecord[] Records = System.Array.Empty<StationRoadRecord>();
            public StationRoadComponents.Bounds2D Bounds;
            public RoadGraph SubGraph;
            public RoadNetwork SubNetwork;
            public StationRoadView.ComponentViewData ViewData;
            public StationRoadTraffic Traffic;
        }

        public StationRoadDeltaMetrics LastDelta { get; private set; }
        public int LocalDeltaCommits { get; private set; }
        public int FullBuilds { get; private set; }
        public int TotalRebuiltComponents { get; private set; }
        public int TotalRetainedComponents { get; private set; }
        public int TotalRebuiltRoads { get; private set; }
        public int TotalRetainedRoads { get; private set; }
        public int TotalRebuiltTrafficNetworks { get; private set; }
        public int TotalRetainedTrafficNetworks { get; private set; }

        public int ComponentCount => newest != null ? newest.Components.Count : 0;

        public bool TryGetRoadView(string roadId, out GameObject roadObject) {
            roadObject = null;
            var view = newest?.View;
            return view != null && view.TryGetRoadRoot(roadId, out roadObject);
        }

        public bool TryGetComponentTraffic(string roadId, out StationRoadTraffic traffic) {
            traffic = null;
            var state = newest;
            if (state == null || string.IsNullOrEmpty(roadId)) return false;
            if (state.RoadIdToComponent.TryGetValue(roadId, out var comp) && comp.Traffic != null) {
                traffic = comp.Traffic;
                return true;
            }
            return false;
        }

        public bool TryGetComponentVehiclePoolRoot(string roadId, out Transform poolRoot) {
            poolRoot = null;
            var state = newest;
            if (state == null || state.Vehicles == null || string.IsNullOrEmpty(roadId)) return false;
            if (state.RoadIdToComponent.TryGetValue(roadId, out var comp)) {
                return state.Vehicles.TryGetComponentPoolRoot(comp.Serial, out poolRoot);
            }
            return false;
        }

        public IReadOnlyList<string> GetComponentRoadIds(string roadId) {
            var state = newest;
            if (state == null || string.IsNullOrEmpty(roadId) ||
                !state.RoadIdToComponent.TryGetValue(roadId, out var comp)) {
                return System.Array.Empty<string>();
            }
            var ids = new string[comp.Records.Length];
            for (int i = 0; i < comp.Records.Length; i++) ids[i] = comp.Records[i].Id;
            return ids;
        }

        static HashSet<string> CollectAllModuleIds(StationDocument document) {
            var ids = new HashSet<string>(StringComparer.Ordinal);
            if (document == null) return ids;
            for (int i = 0; i < document.Modules.Count; i++) {
                var m = document.Modules[i];
                if (m != null && !string.IsNullOrEmpty(m.Id)) ids.Add(m.Id);
            }
            return ids;
        }

        static bool RecordInteractsWithComponent(StationRoadRecord candidate, RoadComponentState comp) {
            if (candidate == null || comp == null || comp.Records.Length == 0) return false;
            var candBounds = StationRoadComponents.Bounds2D.Of(candidate);
            if (!candBounds.OverlapsPadded(comp.Bounds, StationRoadComponents.InkMargin)) return false;
            for (int i = 0; i < comp.Records.Length; i++) {
                if (StationRoadComponents.RoadsDirectlyInteract(candidate, comp.Records[i])) return true;
            }
            return false;
        }

        public static bool ForceFallbackOnce { get; set; }

        public bool TryStageLocalDelta(
            Metro.App.StationLocalDeltaContext context,
            out Metro.App.IStationLocalRendererStage stage,
            out string fallbackReason) {
            stage = null;
            fallbackReason = null;
            if (ForceFallbackOnce) {
                ForceFallbackOnce = false;
                fallbackReason = "road-forced-fallback";
                return false;
            }
            var delta = context.Delta;
            var changedRoadIds = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < delta.RemovedModules.Count; i++) {
                var id = delta.RemovedModules[i];
                if (context.PrevIndex.TryGetModule(id, out var oldMod) &&
                    oldMod != null && string.Equals(oldMod.Type, "road", StringComparison.Ordinal)) {
                    changedRoadIds.Add(id);
                }
            }
            for (int i = 0; i < delta.ChangedModules.Count; i++) {
                var mod = delta.ChangedModules[i];
                if (mod == null) continue;
                if (string.Equals(mod.Type, "road", StringComparison.Ordinal)) {
                    changedRoadIds.Add(mod.Id);
                } else if (context.PrevIndex.TryGetModule(mod.Id, out var prevMod) &&
                    prevMod != null && string.Equals(prevMod.Type, "road", StringComparison.Ordinal)) {
                    changedRoadIds.Add(mod.Id);
                }
            }
            if (changedRoadIds.Count == 0) return true;

            if (!states.TryGetValue(context.World, out var state) || state == null ||
                state.RoleRoot == null || state.ContentRoot == null || state.View == null) {
                fallbackReason = "no-road-state";
                return false;
            }

            var nextRoadModules = context.NextIndex.ModulesOfType("road");
            var nextRecords = new List<StationRoadRecord>(nextRoadModules.Count);
            var nextById = new Dictionary<string, StationRoadRecord>(nextRoadModules.Count, StringComparer.Ordinal);
            for (int i = 0; i < nextRoadModules.Count; i++) {
                var module = nextRoadModules[i];
                if (module == null || !string.Equals(module.Type, "road", StringComparison.Ordinal)) continue;
                var rec = StationRoadRecord.FromFacts(module.Facts);
                if (nextById.ContainsKey(rec.Id)) {
                    fallbackReason = "road-duplicate-ids";
                    return false;
                }
                nextRecords.Add(rec);
                nextById.Add(rec.Id, rec);
            }

            // Step 2: Seed affected previous components & road IDs from the PREVIOUS graph.
            var affectedPrev = new HashSet<RoadComponentState>();
            var affectedRoadIds = new HashSet<string>(changedRoadIds, StringComparer.Ordinal);
            var bfsQueue = new Queue<StationRoadRecord>();
            var enqueued = new HashSet<string>(StringComparer.Ordinal);

            void AbsorbComponent(RoadComponentState comp) {
                if (comp == null || !affectedPrev.Add(comp)) return;
                for (int r = 0; r < comp.Records.Length; r++) {
                    var rid = comp.Records[r].Id;
                    affectedRoadIds.Add(rid);
                    if (nextById.TryGetValue(rid, out var nextRec) && enqueued.Add(rid)) {
                        bfsQueue.Enqueue(nextRec);
                    }
                }
            }

            foreach (var id in changedRoadIds) {
                if (state.RoadIdToComponent.TryGetValue(id, out var prevComp)) {
                    AbsorbComponent(prevComp);
                }
                if (nextById.TryGetValue(id, out var nextRec) && enqueued.Add(id)) {
                    bfsQueue.Enqueue(nextRec);
                }
            }

            // Step 3: Expand through the NEXT graph into any untouched components that now interact
            // with an affected road (joins, chained bridges, ink-margin overlaps).
            void ExpandNextGraph() {
                while (bfsQueue.Count > 0) {
                    var current = bfsQueue.Dequeue();
                    for (int c = 0; c < state.Components.Count; c++) {
                        var comp = state.Components[c];
                        if (affectedPrev.Contains(comp)) continue;
                        if (RecordInteractsWithComponent(current, comp)) {
                            AbsorbComponent(comp);
                        }
                    }
                }
            }

            // Step 4: Partition ONLY affected next records and verify junction-box closure
            // against every retained component (fixed point).
            var allModuleIds = CollectAllModuleIds(context.NextDocument);
            List<List<StationRoadRecord>> replacementGroups;
            List<RoadGraph> subGraphs;
            List<RoadNetwork> subNetworks;

            while (true) {
                ExpandNextGraph();
                var affectedNextRecords = new List<StationRoadRecord>();
                for (int i = 0; i < nextRecords.Count; i++) {
                    if (affectedRoadIds.Contains(nextRecords[i].Id)) affectedNextRecords.Add(nextRecords[i]);
                }
                replacementGroups = StationRoadComponents.Partition(affectedNextRecords);
                subGraphs = new List<RoadGraph>(replacementGroups.Count);
                subNetworks = new List<RoadNetwork>(replacementGroups.Count);
                bool absorbedExtra = false;
                for (int g = 0; g < replacementGroups.Count; g++) {
                    var subGraph = StationRoadDocument.Read(replacementGroups[g], allModuleIds);
                    var subNet = StationRoadLayout.Network(subGraph);
                    subGraphs.Add(subGraph);
                    subNetworks.Add(subNet);
                    for (int j = 0; j < subNet.Junctions.Count; j++) {
                        var junction = subNet.Junctions[j];
                        for (int c = 0; c < state.Components.Count; c++) {
                            var retained = state.Components[c];
                            if (affectedPrev.Contains(retained)) continue;
                            if (StationRoadComponents.JunctionTouchesComponent(junction,
                                    retained.Records, retained.SubNetwork?.Junctions)) {
                                AbsorbComponent(retained);
                                absorbedExtra = true;
                            }
                        }
                    }
                }
                if (!absorbedExtra) break;
            }

            // Verify retained components still hold valid live view objects before staging.
            int retainedComponents = 0;
            int retainedRoads = 0;
            int retainedJunctions = 0;
            for (int c = 0; c < state.Components.Count; c++) {
                var comp = state.Components[c];
                if (affectedPrev.Contains(comp)) continue;
                retainedComponents++;
                retainedRoads += comp.Records.Length;
                if (comp.SubNetwork != null) retainedJunctions += comp.SubNetwork.Junctions.Count;
                for (int r = 0; r < comp.Records.Length; r++) {
                    var rid = comp.Records[r].Id;
                    if (!state.View.TryGetRoadRoot(rid, out _)) {
                        fallbackReason = "road-state-inconsistent";
                        return false;
                    }
                }
            }

            var stagedContainer = new GameObject("roads-stage");
            stagedContainer.transform.SetParent(context.StagingRoot, false);
            stagedContainer.SetActive(false);

            int seed = unchecked((int)(context.NextDocument != null ? context.NextDocument.Seed : 0));
            int nextSerialCursor = state.NextComponentSerial;
            var stagedComponents = new List<RoadComponentState>(replacementGroups.Count);
            int rebuiltRoads = 0;
            int rebuiltJunctions = 0;
            for (int g = 0; g < replacementGroups.Count; g++) {
                int compSerial = ++nextSerialCursor;
                var subGraph = subGraphs[g];
                var subNet = subNetworks[g];
                var viewData = state.View.StageComponent(stagedContainer.transform, compSerial, subGraph, subNet);
                for (int d = 0; d < viewData.Diagnostics.Count; d++) {
                    var diag = viewData.Diagnostics[d];
                    context.Diagnostics.Add(new StationDiagnostic(diag.Code ?? "road",
                        StationDiagnosticSeverity.Warning, "road", diag.ModuleId ?? "", diag.Detail ?? ""));
                }
                var recordsArr = replacementGroups[g].ToArray();
                var compTraffic = new StationRoadTraffic(StationRoadLayout.TrafficNetwork(subNet), seed);
                stagedComponents.Add(new RoadComponentState {
                    Serial = compSerial,
                    VehicleIdOffset = compSerial * 100000,
                    Records = recordsArr,
                    Bounds = StationRoadComponents.Bounds2D.OfRecords(recordsArr),
                    SubGraph = subGraph,
                    SubNetwork = subNet,
                    ViewData = viewData,
                    Traffic = compTraffic,
                });
                rebuiltRoads += recordsArr.Length;
                rebuiltJunctions += subNet.Junctions.Count;
            }

            RoadVehicleViews newlyStagedVehicles = null;
            if (state.Vehicles == null && nextRecords.Count > 0) {
                Shader shader = state.Shader != null ? state.Shader : Shader.Find("Universal Render Pipeline/Lit");
                var vehiclesGo = new GameObject("roads-vehicles");
                vehiclesGo.transform.SetParent(stagedContainer.transform, false);
                newlyStagedVehicles = RoadVehicleViews.BuildMultiComponent(vehiclesGo.transform, shader, false,
                    state.Catalogue,
                    (code, detail) => context.Diagnostics.Add(new StationDiagnostic(code ?? "unresolved",
                        StationDiagnosticSeverity.Warning, "renderer", Role, detail ?? "")));
            }

            var retiredList = new List<RoadComponentState>(affectedPrev.Count);
            int retiredRoads = 0;
            foreach (var comp in affectedPrev) {
                retiredList.Add(comp);
                retiredRoads += comp.Records.Length;
            }

            var metrics = new StationRoadDeltaMetrics {
                UsedIncremental = true,
                RebuiltComponents = stagedComponents.Count,
                RetainedComponents = retainedComponents,
                RetiredComponents = retiredList.Count,
                RebuiltRoads = rebuiltRoads,
                RetainedRoads = retainedRoads,
                RetiredRoads = retiredRoads,
                RebuiltJunctions = rebuiltJunctions,
                RetainedJunctions = retainedJunctions,
                RebuiltTrafficNetworks = stagedComponents.Count,
                RetainedTrafficNetworks = retainedComponents,
                RebuiltVehiclePools = stagedComponents.Count,
                RetainedVehiclePools = retainedComponents,
            };

            stage = new RoadLocalStage(this, state, stagedContainer, retiredList, stagedComponents,
                newlyStagedVehicles, nextRecords.ToArray(), nextSerialCursor,
                context.NextDocument != null ? context.NextDocument.LevelBase : state.LevelBase, metrics);
            return true;
        }

        sealed class RoadLocalStage : Metro.App.IStationLocalRendererStage {
            readonly StationRoadRenderer renderer;
            readonly State state;
            readonly GameObject stagedContainer;
            readonly List<RoadComponentState> retiredComponents;
            readonly List<RoadComponentState> stagedComponents;
            readonly RoadVehicleViews newlyStagedVehicles;
            readonly StationRoadRecord[] nextRecords;
            readonly int nextSerialCursor;
            readonly int levelBase;
            readonly StationRoadDeltaMetrics metrics;
            bool committed;

            public RoadLocalStage(StationRoadRenderer renderer, State state, GameObject stagedContainer,
                List<RoadComponentState> retiredComponents, List<RoadComponentState> stagedComponents,
                RoadVehicleViews newlyStagedVehicles, StationRoadRecord[] nextRecords, int nextSerialCursor,
                int levelBase, StationRoadDeltaMetrics metrics) {
                this.renderer = renderer;
                this.state = state;
                this.stagedContainer = stagedContainer;
                this.retiredComponents = retiredComponents;
                this.stagedComponents = stagedComponents;
                this.newlyStagedVehicles = newlyStagedVehicles;
                this.nextRecords = nextRecords;
                this.nextSerialCursor = nextSerialCursor;
                this.levelBase = levelBase;
                this.metrics = metrics;
            }

            public void Commit(Metro.App.StationWorldView world, Metro.App.StationLocalViewCommit commit) {
                committed = true;

                // 1. Retire ONLY affected road records from StationWorldView (picker + visibility).
                var retiredRoadIds = new HashSet<string>(StringComparer.Ordinal);
                var retiredViewDatas = new List<StationRoadView.ComponentViewData>(retiredComponents.Count);
                for (int i = 0; i < retiredComponents.Count; i++) {
                    var oldComp = retiredComponents[i];
                    if (oldComp.ViewData != null) retiredViewDatas.Add(oldComp.ViewData);
                    for (int r = 0; r < oldComp.Records.Length; r++) {
                        retiredRoadIds.Add(oldComp.Records[r].Id);
                        state.RoadIdToComponent.Remove(oldComp.Records[r].Id);
                    }
                    state.Components.Remove(oldComp);
                }
                if (retiredRoadIds.Count > 0) {
                    world.RetireRecordsWhere(
                        r => string.Equals(r.Role, renderer.Role, StringComparison.Ordinal) &&
                             retiredRoadIds.Contains(r.ModuleId),
                        commit,
                        retireViewObjects: false);
                }

                // 2. Retire ONLY affected road GameObjects, Meshes, and Vehicle pools.
                for (int i = 0; i < retiredComponents.Count; i++) {
                    var oldComp = retiredComponents[i];
                    if (oldComp.ViewData != null) {
                        foreach (var go in oldComp.ViewData.RoadRoots.Values) {
                            if (go != null) commit.RetiredViews.Add(go);
                        }
                        for (int m = 0; m < oldComp.ViewData.OwnedMeshes.Count; m++) {
                            if (oldComp.ViewData.OwnedMeshes[m] != null) {
                                commit.RetiredMeshes.Add(oldComp.ViewData.OwnedMeshes[m]);
                            }
                        }
                        oldComp.ViewData.OwnedMeshes.Clear();
                    }
                    state.Vehicles?.RemoveComponentPool(oldComp.Serial, world, commit);
                }

                // 3. Install newly staged Vehicle host if transitioning 0 -> N roads.
                if (newlyStagedVehicles != null && state.Vehicles == null) {
                    newlyStagedVehicles.transform.SetParent(state.ContentRoot.transform, false);
                    newlyStagedVehicles.gameObject.SetActive(true);
                    newlyStagedVehicles.BindWorld(world);
                    state.Vehicles = newlyStagedVehicles;
                }

                // 4. Atomically swap affected components into persistent StationRoadView.
                var addedViewDatas = new List<StationRoadView.ComponentViewData>(stagedComponents.Count);
                for (int i = 0; i < stagedComponents.Count; i++) {
                    var newComp = stagedComponents[i];
                    addedViewDatas.Add(newComp.ViewData);
                    state.Components.Add(newComp);
                    for (int r = 0; r < newComp.Records.Length; r++) {
                        state.RoadIdToComponent[newComp.Records[r].Id] = newComp;
                    }
                }
                state.View.CommitComponentSwap(retiredViewDatas, addedViewDatas, nextRecords);

                // 5. Register ONLY newly built/replaced road GameObjects in StationWorldView.
                for (int i = 0; i < stagedComponents.Count; i++) {
                    var newComp = stagedComponents[i];
                    for (int r = 0; r < newComp.Records.Length; r++) {
                        var record = newComp.Records[r];
                        if (!newComp.ViewData.RoadRoots.TryGetValue(record.Id, out var go) || go == null) continue;
                        go.SetActive(true);
                        var box = new StationBox(record.X, record.Y, record.Z,
                            record.X + record.W, record.Y + record.D, record.Z + 1.07);
                        int level = (int)Math.Round(record.Z);
                        world.AddLocalRecord(new Metro.App.StationViewRecord {
                            Role = renderer.Role,
                            ModuleId = record.Id,
                            Part = "",
                            View = go,
                            Bounds = box,
                            HasBounds = true,
                            LevelMin = level,
                            LevelMax = level,
                        }, commit);
                    }
                }

                if (stagedContainer != null) {
                    if (Application.isPlaying) UnityEngine.Object.Destroy(stagedContainer);
                    else UnityEngine.Object.DestroyImmediate(stagedContainer);
                }

                state.NextComponentSerial = Math.Max(state.NextComponentSerial, nextSerialCursor);
                state.Records = nextRecords;
                state.LevelBase = levelBase;
                state.Traffic = state.Components.Count > 0 ? state.Components[0].Traffic : null;
                state.Vehicles?.SetPrimaryTraffic(state.Traffic);

                // 6. Sync signals and traffic ONLY for newly installed components at the current clock;
                //    untouched components retain their live views, vehicles and traffic clocks verbatim.
                if (!double.IsNaN(state.SampledTime)) {
                    for (int i = 0; i < stagedComponents.Count; i++) {
                        var newComp = stagedComponents[i];
                        state.View.SetComponentSimTime(newComp.ViewData, state.SampledTime);
                        if (newComp.Traffic != null) {
                            newComp.Traffic.Advance(state.SampledTime);
                            state.Vehicles?.RenderComponentForWorld(newComp.Serial, newComp.Traffic,
                                newComp.VehicleIdOffset, state.SampledTime, world);
                        }
                    }
                    state.Vehicles?.RefreshWorldCounts();
                }

                renderer.RecordDeltaMetrics(metrics);
            }

            public void Dispose() {
                if (committed) return;
                for (int i = 0; i < stagedComponents.Count; i++) {
                    var vd = stagedComponents[i].ViewData;
                    if (vd == null) continue;
                    for (int m = 0; m < vd.OwnedMeshes.Count; m++) {
                        var mesh = vd.OwnedMeshes[m];
                        if (!mesh) continue;
                        if (Application.isPlaying) UnityEngine.Object.Destroy(mesh);
                        else UnityEngine.Object.DestroyImmediate(mesh);
                    }
                    vd.OwnedMeshes.Clear();
                }
                if (stagedContainer != null) {
                    if (Application.isPlaying) UnityEngine.Object.Destroy(stagedContainer);
                    else UnityEngine.Object.DestroyImmediate(stagedContainer);
                }
            }
        }

        void RecordDeltaMetrics(StationRoadDeltaMetrics metrics) {
            LastDelta = metrics;
            if (metrics.UsedIncremental) LocalDeltaCommits++;
            else FullBuilds++;
            TotalRebuiltComponents += metrics.RebuiltComponents;
            TotalRetainedComponents += metrics.RetainedComponents;
            TotalRebuiltRoads += metrics.RebuiltRoads;
            TotalRetainedRoads += metrics.RetainedRoads;
            TotalRebuiltTrafficNetworks += metrics.RebuiltTrafficNetworks;
            TotalRetainedTrafficNetworks += metrics.RetainedTrafficNetworks;
            StationEditTrace.AddRoadDelta(metrics.RebuiltComponents, metrics.RetainedComponents,
                metrics.RebuiltRoads, metrics.RetainedRoads);
        }

        /// <summary>
        /// Per-world render state. The host snapshots one renderer instance into
        /// every staged world, so state must belong to the world: a previous
        /// world's Release must not clear the candidate the host is about to commit.
        /// </summary>
        sealed class State {
            public Metro.App.StationWorldView World;
            public Transform RoleRoot;
            public GameObject ContentRoot;
            public Shader Shader;
            public Metro.View.RuntimeCatalogue Catalogue;
            public StationRoadView View;
            public RoadVehicleViews Vehicles;
            public StationRoadTraffic Traffic;
            public readonly List<RoadComponentState> Components = new List<RoadComponentState>();
            public readonly Dictionary<string, RoadComponentState> RoadIdToComponent =
                new Dictionary<string, RoadComponentState>(StringComparer.Ordinal);
            public int NextComponentSerial;
            public StationRoadRecord[] Records = System.Array.Empty<StationRoadRecord>();
            public int Serial;
            /// <summary>The committed document the storey bands are measured against.</summary>
            public int LevelBase;
            /// <summary>The last station-clock sample the traffic poses were rendered at.</summary>
            public double SampledTime = double.NaN;
        }

        readonly Dictionary<Metro.App.StationWorldView, State> states =
            new Dictionary<Metro.App.StationWorldView, State>();
        State newest;
        int serial;

        public string Role => "roads";
        public StationRoadView View => newest?.View;
        public RoadVehicleViews Vehicles => newest?.Vehicles;
        public StationRoadTraffic Traffic => newest?.Traffic;
        public StationRoadRecord[] Records => newest?.Records ?? System.Array.Empty<StationRoadRecord>();

        /// <summary>The renderer of the active built world; feature handlers use it for ghosts.</summary>
        public static StationRoadRenderer Current { get; private set; }

        public void Build(Metro.App.StationViewBuildContext context) {
            var records = new List<StationRoadRecord>();
            foreach (var module in context.Document.Modules) {
                if (module == null || module.Type != "road") continue;
                records.Add(StationRoadRecord.FromFacts(module.Facts));
            }
            var root = context.RoleRoot(Role);
            Shader shader = context.Shader != null ? context.Shader : Shader.Find("Universal Render Pipeline/Lit");
            var contentGo = new GameObject("roads-content");
            contentGo.transform.SetParent(root, false);

            var state = new State {
                World = context.World,
                RoleRoot = root,
                ContentRoot = contentGo,
                Shader = shader,
                Catalogue = context.Catalogue,
                Records = records.ToArray(),
                Serial = ++serial,
                LevelBase = context.Document != null ? context.Document.LevelBase : 0,
            };

            state.View = StationRoadView.CreateEmpty(contentGo.transform, shader);
            var groups = StationRoadComponents.Partition(records);
            var allModuleIds = CollectAllModuleIds(context.Document);
            int seed = unchecked((int)(context.Document != null ? context.Document.Seed : 0));
            var builtViewDatas = new List<StationRoadView.ComponentViewData>(groups.Count);
            int totalJunctions = 0;

            for (int g = 0; g < groups.Count; g++) {
                int compSerial = ++state.NextComponentSerial;
                var subGraph = StationRoadDocument.Read(groups[g], allModuleIds);
                var subNet = StationRoadLayout.Network(subGraph);
                var viewData = state.View.StageComponent(contentGo.transform, compSerial, subGraph, subNet);
                for (int d = 0; d < viewData.Diagnostics.Count; d++) {
                    var diag = viewData.Diagnostics[d];
                    context.ReportUnresolved(diag.Code, "road", diag.ModuleId, diag.Detail);
                }
                var compRecords = groups[g].ToArray();
                var compTraffic = new StationRoadTraffic(StationRoadLayout.TrafficNetwork(subNet), seed);
                var compState = new RoadComponentState {
                    Serial = compSerial,
                    VehicleIdOffset = compSerial * 100000,
                    Records = compRecords,
                    Bounds = StationRoadComponents.Bounds2D.OfRecords(compRecords),
                    SubGraph = subGraph,
                    SubNetwork = subNet,
                    ViewData = viewData,
                    Traffic = compTraffic,
                };
                state.Components.Add(compState);
                builtViewDatas.Add(viewData);
                totalJunctions += subNet.Junctions.Count;
                for (int r = 0; r < compRecords.Length; r++) {
                    state.RoadIdToComponent[compRecords[r].Id] = compState;
                }
            }
            state.View.CommitComponentSwap(null, builtViewDatas, records);

            for (int i = 0; i < state.Records.Length; i++) {
                var record = state.Records[i];
                if (!state.View.TryGetRoadRoot(record.Id, out var viewGo) || viewGo == null) continue;
                var box = new StationBox(record.X, record.Y, record.Z, record.X + record.W, record.Y + record.D, record.Z + 1.07);
                int level = (int)Math.Round(record.Z);
                context.World.RegisterModule(Role, record.Id, viewGo, "", box, level, level);
            }

            if (records.Count > 0) {
                var vehiclesGo = new GameObject("roads-vehicles");
                vehiclesGo.transform.SetParent(contentGo.transform, false);
                state.Vehicles = RoadVehicleViews.BuildMultiComponent(vehiclesGo.transform, shader, false, context.Catalogue,
                    (code, detail) => context.ReportUnresolved(code, "renderer", Role, detail));
                state.Traffic = state.Components.Count > 0 ? state.Components[0].Traffic : null;
                state.Vehicles.SetPrimaryTraffic(state.Traffic);
                state.Vehicles.BindWorld(context.World);
            }

            RecordDeltaMetrics(new StationRoadDeltaMetrics {
                UsedIncremental = false,
                RebuiltComponents = state.Components.Count,
                RetainedComponents = 0,
                RetiredComponents = 0,
                RebuiltRoads = records.Count,
                RetainedRoads = 0,
                RetiredRoads = 0,
                RebuiltJunctions = totalJunctions,
                RetainedJunctions = 0,
                RebuiltTrafficNetworks = state.Components.Count,
                RetainedTrafficNetworks = 0,
                RebuiltVehiclePools = state.Components.Count,
                RetainedVehiclePools = 0,
            });

            states[context.World] = state;
            newest = state;
            Current = this;
        }

        /// <summary>
        /// Host hook: one station-clock sample. Signal lenses and ambient vehicle
        /// poses follow the same authoritative time across every active road component;
        /// the caller owns the clock.
        /// </summary>
        public void Update(double simTimeSeconds) {
            var state = newest;
            if (state == null) return;
            if (state.View != null) state.View.SetSimTime(simTimeSeconds);
            if (state.Components.Count == 0) return;
            if (!double.IsNaN(state.SampledTime) && Math.Abs(simTimeSeconds - state.SampledTime) <= 1e-9) return;
            for (int i = 0; i < state.Components.Count; i++) {
                var comp = state.Components[i];
                if (comp.Traffic == null) continue;
                comp.Traffic.Advance(simTimeSeconds);
                if (state.Vehicles != null) {
                    state.Vehicles.RenderComponentForWorld(comp.Serial, comp.Traffic, comp.VehicleIdOffset,
                        simTimeSeconds, state.World);
                }
            }
            state.Vehicles?.RefreshWorldCounts();
            state.SampledTime = simTimeSeconds;
        }

        /// <summary>Cheap change fingerprint for raw-JSON state caching on StationGameHost.</summary>
        internal (object stateRef, object recordsRef, double sampledTime, int visible, int sampled, int drawn, int segments, int simCars) StateFingerprint() {
            var state = newest;
            if (state == null) return (null, null, double.NaN, 0, 0, 0, 0, 0);
            int totalSimCars = 0;
            for (int i = 0; i < state.Components.Count; i++) {
                if (state.Components[i].Traffic != null) totalSimCars += state.Components[i].Traffic.Cars.Count;
            }
            return (
                state,
                state.Records,
                state.SampledTime,
                state.Vehicles != null ? state.Vehicles.VisibleVehicles : 0,
                state.Vehicles != null ? state.Vehicles.SampledVehicles : 0,
                state.View != null ? state.View.Roads : 0,
                state.View != null ? state.View.Segments : 0,
                totalSimCars);
        }

        /// <summary>
        /// The cheap `payload.roads` summary: committed road records with their saved
        /// endpoints, drawn geometry counts, ambient vehicle counts by kind and the
        /// exact station-clock sample the poses were rendered at. All numbers come
        /// from the built world; nothing is recomputed or invented here.
        /// </summary>
        public JObject SnapshotState() {
            var state = newest;
            if (state == null) return null;
            var view = state.View;
            var vehicles = state.Vehicles;
            var endpoints = new JArray();
            foreach (var record in state.Records) {
                if (!record.HasFrom && !record.HasTo) continue;
                var row = new JObject { ["id"] = record.Id };
                if (record.HasFrom) row["from"] = new JArray(record.From.X, record.From.Y);
                if (record.HasTo) row["to"] = new JArray(record.To.X, record.To.Y);
                endpoints.Add(row);
            }
            int totalSimCars = 0;
            for (int i = 0; i < state.Components.Count; i++) {
                if (state.Components[i].Traffic != null) totalSimCars += state.Components[i].Traffic.Cars.Count;
            }
            return new JObject {
                ["records"] = state.Records.Length,
                ["segments"] = view != null ? view.Segments : 0,
                ["drawn"] = view != null ? view.Roads : 0,
                ["signals"] = view != null ? view.SignalsBuilt : 0,
                ["endpoints"] = endpoints,
                ["simTime"] = double.IsNaN(state.SampledTime) ? JValue.CreateNull() : new JValue(state.SampledTime),
                ["simCars"] = totalSimCars,
                ["vehicles"] = new JObject {
                    ["visible"] = vehicles != null ? vehicles.VisibleVehicles : 0,
                    ["sampled"] = vehicles != null ? vehicles.SampledVehicles : 0,
                    ["filtered"] = vehicles != null ? vehicles.FilteredVehicles : 0,
                    ["cars"] = vehicles != null ? vehicles.Cars : 0,
                    ["buses"] = vehicles != null ? vehicles.Buses : 0,
                    ["scooters"] = vehicles != null ? vehicles.Scooters : 0,
                    ["bikes"] = vehicles != null ? vehicles.Bicycles : 0,
                    ["mopeds"] = vehicles != null ? vehicles.Mopeds : 0,
                    // Riders are ambient road traffic; station crowd actors are counted
                    // by `payload.crowd` and never included here.
                    ["riders"] = vehicles != null ? vehicles.Riders : 0,
                    ["prefab"] = vehicles != null ? vehicles.PrefabVehicleViews : 0,
                    ["fallback"] = vehicles != null ? vehicles.FallbackVehicleViews : 0,
                },
            };
        }

        public void ShowPreview(RoadEditPreview preview) {
            var view = newest?.View;
            if (view != null) view.ShowPreview(preview);
        }
        public void ClearPreview() {
            var view = newest?.View;
            if (view != null) view.ClearPreview();
        }

        public void Release() {
            // The host calls Release on the world being replaced after the candidate
            // has already built. Drop only disposed worlds and keep the live state.
            var dead = new List<Metro.App.StationWorldView>();
            foreach (var pair in states) if (pair.Key == null || pair.Key.IsDisposed) dead.Add(pair.Key);
            foreach (var world in dead) states.Remove(world);
            State next = null;
            foreach (var state in states.Values) if (next == null || state.Serial > next.Serial) next = state;
            newest = next;
            if (newest == null) Current = null;
        }
    }

    /// <summary>Process-wide registration of packet G's renderer and command handler.</summary>
    public static class StationRoadFeature {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() {
            Metro.App.StationRenderers.Add(new StationRoadRenderer());
            Metro.App.StationCommandHandlers.Add(new StationRoadCommandHandler());
        }

        /// <summary>
        /// Register `payload.roads` with the scene host after it exists. This is the
        /// same self-service shape packet D uses for `camera`/`view`
        /// (<c>host.RegisterStateContributor</c>); the host merges every contributor
        /// into each `state`/commit reply, so the browser verifier can report road
        /// geometry and traffic separately from road editing.
        /// </summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void InstallState() => AttachState(UnityEngine.Object.FindAnyObjectByType<Metro.App.StationGameHost>());

        /// <summary>Test/entry point: bind the roads payload to one host.</summary>
        public static StationRoadStateContributor AttachState(Metro.App.StationGameHost host) {
            if (!host) return null;
            var contributor = new StationRoadStateContributor();
            host.RegisterStateContributor(contributor);
            return contributor;
        }
    }

    /// <summary>
    /// `payload.roads` for every `state` and commit reply: authored road records and
    /// their saved endpoints, drawn segment/rectangle counts, vehicle counts by kind
    /// and the station-clock time the poses were sampled at. Reading
    /// <see cref="StationRoadRenderer.Current"/> keeps the payload tied to the world
    /// the host committed rather than to a stale staged build.
    /// </summary>
    public sealed class StationRoadStateContributor : Metro.App.IStationStateContributor {
        readonly StationRoadRenderer renderer;

        public StationRoadStateContributor(StationRoadRenderer renderer = null) {
            this.renderer = renderer;
        }

        public string Key => "roads";

        public JObject BuildPayload(StationDocument document, StationIndex index) {
            var target = renderer != null ? renderer : StationRoadRenderer.Current;
            return target != null ? target.SnapshotState() : null;
        }
    }

    /// <summary>
    /// The <c>road.*</c> command handler. It is the transport adapter over
    /// <see cref="StationRoadEdits"/>: the pure layer computes previews and
    /// revision-checked transactions, this handler owns the bridge payloads and
    /// commits a road transaction by re-entering the host's normal load transaction
    /// with the edited save text (the only public document-replacement path today).
    ///
    /// Payload shapes are documented on <see cref="RoadEditRequest"/>. Responses:
    /// <code>
    /// road.preview ack: { valid, code, candidate:{id,x,y,z,w,d,rot,cfg}, length, lanes, laneWidth }
    /// road.commit  ack: { kind, record, moduleIds:[...] }   (host revision increments once)
    /// road.undo    ack: { kind:"road.undo", moduleIds:[...] }
    /// road.cancel  ack: {}
    /// </code>
    /// A commit is rejected with <c>revision-mismatch</c>, <c>road-ground</c>,
    /// <c>road-width</c>, <c>road-nodes-distinct</c>, <c>track</c>,
    /// <c>occupied</c>, <c>nothing-to-undo</c> or <c>no-session</c>.
    /// </summary>
    public sealed class StationRoadCommandHandler : Metro.App.IStationCommandHandler {
        readonly Func<StationDocument> documentProvider;
        readonly Func<int> revisionProvider;
        readonly List<(string Station, List<StationRoadRecord> Roads)> undo =
            new List<(string, List<StationRoadRecord>)>();

        public StationRoadCommandHandler() { }

        /// <summary>Test seam: supply the document/revision without a scene host.</summary>
        public StationRoadCommandHandler(Func<StationDocument> document, Func<int> revision = null) {
            documentProvider = document;
            revisionProvider = revision;
        }

        public string Capability => "road";

        public bool Handles(string type) =>
            type == "road.preview" || type == "road.commit" || type == "road.undo" || type == "road.cancel";

        public bool TryHandle(Metro.App.StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            var host = documentProvider == null ? UnityEngine.Object.FindAnyObjectByType<StationGameHost>() : null;
            var document = documentProvider != null ? documentProvider() : host?.Document;
            if (document == null) {
                rejectCode = "no-session";
                rejectReason = "No committed station document.";
                return false;
            }
            int revision = revisionProvider != null ? revisionProvider() : host != null ? host.CurrentRevision : 0;
            payload ??= new JObject();
            switch (command.Type) {
                case "road.cancel":
                    StationRoadRenderer.Current?.ClearPreview();
                    return true;
                case "road.preview":
                    return Preview(command, document, payload, out rejectCode, out rejectReason);
                case "road.commit":
                    return Commit(command, document, revision, host, payload, out rejectCode, out rejectReason);
                case "road.undo":
                    return Undo(command, document, revision, host, payload, out rejectCode, out rejectReason);
                default:
                    return false;
            }
        }

        bool Preview(Metro.App.StationCommand command, StationDocument document, JObject payload,
            out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            var request = ReadRequest(command);
            if (request == null) { rejectCode = "parse-failed"; rejectReason = "road.preview needs a JSON payload."; return false; }
            request.expectedRevision = -1;
            var graph = Graph(document);
            var preview = StationRoadEdits.Preview(graph, request, new DocumentSurfaceContext(document));
            StationRoadRenderer.Current?.ShowPreview(preview);
            payload["valid"] = preview.Valid;
            payload["code"] = preview.Code;
            payload["length"] = preview.Length;
            payload["lanes"] = preview.Lanes;
            payload["laneWidth"] = preview.LaneWidth;
            payload["fromNode"] = preview.FromNode?.Id ?? "";
            payload["toNode"] = preview.ToNode?.Id ?? "";
            payload["candidate"] = preview.Candidate != null ? RoadJson(preview.Candidate) : JValue.CreateNull();
            return true;
        }

        bool Commit(Metro.App.StationCommand command, StationDocument document, int revision, StationGameHost host,
            JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (!command.ExpectedRevision.HasValue) {
                rejectCode = "revision-required";
                rejectReason = "road.commit needs the envelope expectedRevision.";
                return false;
            }
            var request = ReadRequest(command);
            if (request == null) { rejectCode = "parse-failed"; rejectReason = "road.commit needs a JSON payload."; return false; }
            request.expectedRevision = command.ExpectedRevision.Value;
            var graph = Graph(document);
            var commit = StationRoadEdits.Commit(graph, request, revision, document.Modules.Count,
                document.Modules.Select(module => module.Id), new DocumentSurfaceContext(document));
            if (!commit.Accepted) {
                rejectCode = string.IsNullOrEmpty(commit.Code) ? "road-refused" : commit.Code;
                rejectReason = string.IsNullOrEmpty(commit.Message) ? rejectCode : commit.Message;
                return false;
            }
            if (!Apply(host, commit, out var reason)) {
                rejectCode = "road-commit-failed";
                rejectReason = reason;
                return false;
            }
            undo.Add((StationKey(document), commit.Previous));
            StationRoadRenderer.Current?.ClearPreview();
            payload["kind"] = commit.Kind;
            payload["record"] = string.IsNullOrEmpty(commit.SourceId) ? commit.Record?.Id ?? "" : commit.SourceId;
            var ids = new JArray();
            foreach (var module in commit.Next) ids.Add(module.Id);
            payload["moduleIds"] = ids;
            return true;
        }

        bool Undo(Metro.App.StationCommand command, StationDocument document, int revision, StationGameHost host,
            JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (!command.ExpectedRevision.HasValue) {
                rejectCode = "revision-required";
                rejectReason = "road.undo needs the envelope expectedRevision.";
                return false;
            }
            if (undo.Count == 0) { rejectCode = "nothing-to-undo"; rejectReason = "No road edit to undo."; return false; }
            var entry = undo[undo.Count - 1];
            if (!string.Equals(entry.Station, StationKey(document), StringComparison.Ordinal)) {
                undo.Clear();
                rejectCode = "stale-undo";
                rejectReason = "The road edit belongs to a different station document.";
                return false;
            }
            var snapshot = entry.Roads;
            var commit = StationRoadEdits.Undo(snapshot, command.ExpectedRevision ?? -1, revision);
            if (!commit.Accepted) {
                rejectCode = commit.Code;
                rejectReason = commit.Message;
                return false;
            }
            if (!Apply(host, commit, out var reason)) {
                rejectCode = "road-undo-failed";
                rejectReason = reason;
                return false;
            }
            undo.RemoveAt(undo.Count - 1);
            payload["kind"] = commit.Kind;
            var ids = new JArray();
            foreach (var module in commit.Next) ids.Add(module.Id);
            payload["moduleIds"] = ids;
            return true;
        }

        static RoadEditRequest ReadRequest(Metro.App.StationCommand command) {
            if (command.Payload == null) return null;
            try { return command.Payload.ToObject<RoadEditRequest>(); } catch (JsonException) { return null; }
        }

        static string StationKey(StationDocument document) =>
            document.Source.Hash + "|" +
            document.Seed.ToString(System.Globalization.CultureInfo.InvariantCulture) + "|" + document.Name;

        static RoadGraph Graph(StationDocument document) {
            var records = new List<StationRoadRecord>();
            foreach (var module in document.Modules)
                if (module != null && module.Type == "road") records.Add(StationRoadRecord.FromFacts(module.Facts));
            return StationRoadDocument.Read(records, document.Modules.Select(module => module.Id));
        }

        /// <summary>
        /// Replace the road records in the host's own save text and re-enter the
        /// ordinary install transaction. Non-road modules, order and every raw field
        /// stay untouched; a rejection leaves the previous world and revision in place.
        /// </summary>
        static bool Apply(StationGameHost host, RoadEditCommit commit, out string reason) {
            reason = "";
            if (host == null || host.Coordinator == null) { reason = "No station host is loaded."; return false; }
            var local = host.TryApplyLocalRoads(commit.Next, host.CurrentSourceId, out _);
            if (local != null) {
                if (local.Accepted) return true;
                reason = local.Rejection != null
                    ? local.Rejection.Code + ": " + local.Rejection.Reason
                    : "The station rejected the road edit.";
                return false;
            }
            JObject root;
            try { root = JObject.Parse(host.Coordinator.Save(DateTimeOffset.UtcNow)); }
            catch (Exception error) { reason = "Could not read the committed save: " + error.Message; return false; }
            if (!(root["static"] is JObject station) || !(station["modules"] is JArray modules)) {
                reason = "Committed save has no static.modules array.";
                return false;
            }
            var next = new Queue<StationRoadRecord>(commit.Next);
            var rebuilt = new JArray();
            foreach (var token in modules) {
                if ((string)token["type"] != "road") { rebuilt.Add(token.DeepClone()); continue; }
                if (next.Count == 0) continue;
                rebuilt.Add(RoadJson(next.Dequeue()));
            }
            while (next.Count > 0) rebuilt.Add(RoadJson(next.Dequeue()));
            station["modules"] = rebuilt;
            var result = host.ApplyDocumentEdit(root.ToString(Formatting.None), host.CurrentSourceId);
            if (result.Accepted) return true;
            reason = result.Rejection != null
                ? result.Rejection.Code + ": " + result.Rejection.Reason
                : "The station rejected the road edit.";
            return false;
        }

        static JObject RoadJson(StationRoadRecord record) {
            var cfg = new JObject { ["direction"] = record.Direction };
            if (record.HasFrom) cfg["from"] = new JArray(record.From.X, record.From.Y);
            if (record.HasTo) cfg["to"] = new JArray(record.To.X, record.To.Y);
            return new JObject {
                ["id"] = record.Id, ["type"] = "road",
                ["x"] = record.X, ["y"] = record.Y, ["z"] = record.Z,
                ["w"] = record.W, ["d"] = record.D, ["rot"] = record.Rotation,
                ["cfg"] = cfg,
            };
        }

        /// <summary>Placement facts from A's committed document/index (derived, read-only).</summary>
        sealed class DocumentSurfaceContext : IRoadSurfaceContext {
            readonly StationDocument document;
            public DocumentSurfaceContext(StationDocument document) { this.document = document; }

            public bool IsSolid(int x, int y, double z) => Cell(x, y, z, out var solid, out _) && solid;

            public bool IsExitFloor(int x, int y, double z) => false; // exit head-house floors are A's footprint facts

            public bool IsGroundHole(int x, int y, double z) => z == 0 && Cell(x, y, z, out var solid, out _) && !solid;

            public bool IsTrack(int x, int y, double z) => Cell(x, y, z, out _, out var finish) &&
                string.Equals(finish, "floor.track", StringComparison.Ordinal);

            public bool OverlapsModuleEnvelope(StationRoadRecord candidate) => false; // module envelopes are A's footprints

            bool Cell(int x, int y, double z, out bool solid, out string finish) {
                solid = false;
                finish = "";
                if (z != Math.Floor(z)) return false;
                foreach (var cell in document.Cells) {
                    if (cell.X != x || cell.Y != y || cell.Z != (int)z) continue;
                    solid = cell.IsSolid;
                    cell.Finish.TryGetValue("top", out finish);
                    return true;
                }
                return false;
            }
        }
    }
}

