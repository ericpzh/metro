using System;
using System.Collections.Generic;
using Metro.Build;
using UnityEngine;

namespace Metro.View {
    /// <summary>
    /// The bridge options of one saved track run (`TrackModel.ts`'s `mod.cfg.bridge*`
    /// fields). A bridge run keeps the running gear on the ordinary rail datum but
    /// replaces the dug trench with a raised deck, edge shoulders and a barrier or
    /// railing along each edge; the deck's shoulders step back around any catenary
    /// gantry post, including one a neighbouring run owns across the module seam.
    /// </summary>
    public sealed class RailBridgeOptions {
        /// <summary>`cfg.bridgeRailing`: railing, either sound barrier, or none.</summary>
        public string Railing = "railing";
        public bool GroundTrack;
        public bool HasRailing => !string.Equals(Railing, "none", StringComparison.Ordinal);
        /// <summary>`STOCK[line.stock].width`, for the screen-door centre-line offset.</summary>
        public float VehicleWidth;
        /// <summary>
        /// Upright positions a **neighbouring** run owns, in this run's local frame
        /// (`neighboringGantryPosts`): the deck's shoulder and the barrier stop at their faces.
        /// </summary>
        public IReadOnlyList<Vector2> NeighborPosts = Array.Empty<Vector2>();

        public bool SoundBarrier => string.Equals(Railing, "sound-barrier", StringComparison.Ordinal) ||
                                    string.Equals(Railing, "sound-barrier-half", StringComparison.Ordinal);

        /// <summary>`bridgeBarrierTop`: 2 m half-height, 3.5 m full, 1.29 m railing.</summary>
        public float BarrierTop => (float)StationFootprints.BridgeBarrierTop(Railing);

        /// <summary>`BRIDGE_BARRIER_TOP`.</summary>
        public const float BridgeBarrierTop = 3.5f;
        /// <summary>`bridgeBarrierTop`'s railing case.</summary>
        public const float BridgeRailingTop = 1.29f;
        /// <summary>`BRIDGE_DECK_DEPTH`: one metre of structure below the rail bed.</summary>
        public const float DeckDepth = 1f;
    }

    /// <summary>
    /// Overhead catenary configuration for one saved track run (`CatenaryModel.ts` / `TrackGantry.ts`).
    /// Under a slab or inside a tunnel a rigid aluminium conductor rail hangs in the shallow 5 m
    /// ceiling recess; on a bridge or open gantry run, cantilever masts carry a sagging parabolic
    /// messenger wire, droppers, ribbed insulators, and a return conductor.
    /// </summary>
    public sealed class RailCatenaryOptions {
        public bool Tunnel;
        /// <summary>`cfg.catenaryStyle`: `"gantry"` selects open cantilever masts outside bridges.</summary>
        public string Style = "";
        /// <summary>`STOCK[line.stock].width`, for the side mast offset (`trackSideFixtureOffset`).</summary>
        public float VehicleWidth;
        /// <summary>Track-local ceiling underside (`trackCeilingUnderside - mod.z`); 0 uses headroom + 1.</summary>
        public float CeilingZ;
    }

    /// <summary>One material bin of generated track geometry: vertices and triangles only.</summary>
    public sealed class RailMeshBin {
        public readonly List<Vector3> Vertices = new List<Vector3>();
        public readonly List<int> Triangles = new List<int>();
        readonly List<(int Start, int Count, int LastTier)> hardware = new List<(int, int, int)>();
        public int VertexCount => Vertices.Count;
        public int TriangleCount => Triangles.Count / 3;

        public void Box(Vector3 centre, Vector3 size, int lastTier = 2) {
            int triStart = Triangles.Count;
            float hx = size.x * .5f, hy = size.y * .5f, hz = size.z * .5f;
            int start = Vertices.Count;
            for (int i = 0; i < 8; i++) {
                Vertices.Add(centre + new Vector3(
                    (i & 1) == 0 ? -hx : hx,
                    (i & 2) == 0 ? -hy : hy,
                    (i & 4) == 0 ? -hz : hz));
            }
            // Six quads, each wound so its face is outward (the source boxes are closed).
            int[][] faces = {
                new[] { 0, 1, 3, 2 }, new[] { 4, 6, 7, 5 }, new[] { 0, 4, 5, 1 },
                new[] { 2, 3, 7, 6 }, new[] { 0, 2, 6, 4 }, new[] { 1, 5, 7, 3 },
            };
            for (int f = 0; f < faces.Length; f++) {
                var face = faces[f];
                Triangles.Add(start + face[0]); Triangles.Add(start + face[1]); Triangles.Add(start + face[2]);
                Triangles.Add(start + face[0]); Triangles.Add(start + face[2]); Triangles.Add(start + face[3]);
            }
            if (lastTier < 2) hardware.Add((triStart, Triangles.Count - triStart, lastTier));
        }

        /// <summary>A cylinder between two arbitrary Unity-local points.</summary>
        public void Tube(Vector3 a, Vector3 b, float radius, int radialSegments = 8, int lastTier = 2) {
            Vector3 axis = b - a;
            float length = axis.magnitude;
            if (length < 1e-5f || radius <= 0f) return;
            int segs = Mathf.Max(3, radialSegments);
            int triStart = Triangles.Count;
            Vector3 dir = axis / length;
            Vector3 tangent = Vector3.Cross(dir, Mathf.Abs(dir.y) < .9f ? Vector3.up : Vector3.right).normalized;
            Vector3 bitangent = Vector3.Cross(dir, tangent);
            int start = Vertices.Count;
            for (int ring = 0; ring < 2; ring++) {
                Vector3 origin = ring == 0 ? a : b;
                for (int i = 0; i < segs; i++) {
                    float angle = (i / (float)segs) * Mathf.PI * 2f;
                    Vector3 offset = (tangent * Mathf.Cos(angle) + bitangent * Mathf.Sin(angle)) * radius;
                    Vertices.Add(origin + offset);
                }
            }
            for (int i = 0; i < segs; i++) {
                int next = (i + 1) % segs;
                int v0 = start + i;
                int v1 = start + next;
                int v2 = start + segs + next;
                int v3 = start + segs + i;
                Triangles.Add(v0); Triangles.Add(v2); Triangles.Add(v1);
                Triangles.Add(v0); Triangles.Add(v3); Triangles.Add(v2);
            }
            // End caps.
            for (int i = 1; i + 1 < segs; i++) {
                Triangles.Add(start); Triangles.Add(start + i); Triangles.Add(start + i + 1);
                Triangles.Add(start + segs); Triangles.Add(start + segs + i + 1); Triangles.Add(start + segs + i);
            }
            if (lastTier < 2) hardware.Add((triStart, Triangles.Count - triStart, lastTier));
        }

        /// <summary>A five-rib porcelain/composite insulator along <paramref name="a"/> → <paramref name="b"/>.</summary>
        public void RibbedInsulator(Vector3 a, Vector3 b, float radius, int radialSegments = 8, int lastTier = 2) {
            Vector3 axis = b - a;
            float length = axis.magnitude;
            if (length < 1e-5f || radius <= 0f) return;
            int segs = Mathf.Max(4, radialSegments);
            int triStart = Triangles.Count;
            Vector3 dir = axis / length;
            Vector3 tangent = Vector3.Cross(dir, Mathf.Abs(dir.y) < .9f ? Vector3.up : Vector3.right).normalized;
            Vector3 bitangent = Vector3.Cross(dir, tangent);
            var rings = new List<Vector2>(22) { new Vector2(radius * .42f, 0f) };
            for (int i = 0; i < 5; i++) {
                float z = length * (i + .1f) / 5f;
                rings.Add(new Vector2(radius * .42f, z));
                rings.Add(new Vector2(radius, z + length * .045f));
                rings.Add(new Vector2(radius * .88f, z + length * .09f));
                rings.Add(new Vector2(radius * .42f, z + length * .15f));
            }
            rings.Add(new Vector2(radius * .42f, length));
            int start = Vertices.Count;
            for (int r = 0; r < rings.Count; r++) {
                Vector3 centre = a + dir * rings[r].y;
                float rad = rings[r].x;
                for (int i = 0; i < segs; i++) {
                    float angle = (i / (float)segs) * Mathf.PI * 2f;
                    Vertices.Add(centre + (tangent * Mathf.Cos(angle) + bitangent * Mathf.Sin(angle)) * rad);
                }
            }
            for (int r = 0; r + 1 < rings.Count; r++) {
                int r0 = start + r * segs;
                int r1 = start + (r + 1) * segs;
                for (int i = 0; i < segs; i++) {
                    int next = (i + 1) % segs;
                    Triangles.Add(r0 + i); Triangles.Add(r1 + next); Triangles.Add(r0 + next);
                    Triangles.Add(r0 + i); Triangles.Add(r1 + i); Triangles.Add(r1 + next);
                }
            }
            if (lastTier < 2) hardware.Add((triStart, Triangles.Count - triStart, lastTier));
        }

        /// <summary>Continuous segmented tube along a polyline (for the sagging parabolic messenger wire).</summary>
        public void PolylineTube(IReadOnlyList<Vector3> points, float radius, int radialSegments = 6, int lastTier = 2) {
            if (points == null || points.Count < 2 || radius <= 0f) return;
            for (int i = 0; i + 1 < points.Count; i++) {
                Tube(points[i], points[i + 1], radius, radialSegments, lastTier);
            }
        }

        /// <summary>A box placed in the source's YZ cross-section and extruded along local x.</summary>
        public void Extrude(IReadOnlyList<Vector2> profile, float x0, float x1) {
            if (profile == null || profile.Count < 3) return;
            int start = Vertices.Count;
            int count = profile.Count;
            // Profile points are (across, up); Unity local axes are (along, up, across).
            for (int side = 0; side < 2; side++) {
                float x = side == 0 ? x0 : x1;
                for (int i = 0; i < count; i++)
                    Vertices.Add(new Vector3(x, profile[i].y, profile[i].x));
            }
            // Caps: the x0 fan faces −x, the x1 fan faces +x.
            for (int i = 1; i + 1 < count; i++) {
                Triangles.Add(start);
                Triangles.Add(start + i);
                Triangles.Add(start + i + 1);
                Triangles.Add(start + count);
                Triangles.Add(start + count + i + 1);
                Triangles.Add(start + count + i);
            }
            // Sides, wound outward in Unity's clockwise-front convention.
            for (int i = 0; i < count; i++) {
                int next = (i + 1) % count;
                int a = start + i, b = start + next, c = start + count + next, d = start + count + i;
                Triangles.Add(a); Triangles.Add(d); Triangles.Add(c);
                Triangles.Add(a); Triangles.Add(c); Triangles.Add(b);
            }
        }

        public Mesh ToMesh(string name) {
            var mesh = new Mesh { name = name, indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            mesh.SetVertices(Vertices);
            mesh.SetTriangles(Triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            if (hardware.Count > 0) {
                var ordered = StructuralIndices();
                int simplified = ordered.Count;
                AppendFasteners(ordered, 1);
                int reduced = ordered.Count;
                AppendFasteners(ordered, 0);
                StationMeshLodIndices.ApplySharedPrefix(mesh, ordered, reduced, simplified);
            }
            return mesh;
        }

        List<int> StructuralIndices() {
            var result = new List<int>();
            int source = 0;
            foreach (var item in hardware) {
                for (; source < item.Start; source++) result.Add(Triangles[source]);
                source = item.Start + item.Count;
            }
            for (; source < Triangles.Count; source++) result.Add(Triangles[source]);
            return result;
        }

        void AppendFasteners(List<int> indices, int tier) {
            foreach (var item in hardware) {
                if (item.LastTier != tier) continue;
                for (int next = item.Start; next < item.Start + item.Count; next++) indices.Add(Triangles[next]);
            }
        }
    }

    /// <summary>
    /// One generated track run, ported from `TrackModel.ts:buildTrack` and
    /// `TrackDetails.ts:buildTrackDetails`. It is built in the track record's own local
    /// frame (run along +x, across +y, up +z) and translated by
    /// <see cref="StationStreetModuleRenderer"/> exactly once at the view boundary.
    ///
    /// The parts are separate bins because the source has separate materials: concrete
    /// finishes for the bed and sleepers, plain steel for the rail heads, dark steel for
    /// the seats/clips/bolts and the third rail, the amber PSU cover, and white
    /// insulators. The old view drew a single dark cube for all of it.
    /// </summary>
    public sealed class RailRunGeometry {
        public float Width;
        public float Depth;
        public float Scale = StationRailGeometry.DefaultScale;
        public float BedTop;
        public float RailTopAboveModule;
        public float Gauge = StationRailGeometry.RailCentreOffset;
        public int SleeperCount;
        public float SleeperSpacing;
        /// <summary>Local +1 / −1 edge the conductor rail sits on (0 for overhead).</summary>
        public int ThirdRailSide;
        public float ThirdRailLocalY;
        public bool Catenary;
        /// <summary>Contact wire centre height above the track datum (`TrainContactWireZ`).</summary>
        public float ContactWireZ;
        /// <summary>True when catenary built the rigid overhead conductor (under cover/tunnel), false for open gantry.</summary>
        public bool RigidCatenary;
        /// <summary>Open gantry cantilever mast count (0 for rigid or third rail).</summary>
        public int GantryMastCount;
        /// <summary>Sagging messenger span count between anchors (0 for rigid or third rail).</summary>
        public int MessengerSpanCount;
        /// <summary>Vertical dropper count on open gantry spans.</summary>
        public int DropperCount;
        /// <summary>Non-null for a `cfg.bridge` run: the deck, shoulders and barriers it draws.</summary>
        public RailBridgeOptions Bridge;
        /// <summary>Optional overhead catenary configuration (`CatenaryModel.ts`).</summary>
        public RailCatenaryOptions CatenaryOptions;
        /// <summary>The deck's barrier line offset across the bed (`bridgeSupportOffset`).</summary>
        public float BridgeSupportOffset;
        /// <summary>The deck's full across extent (`bridgeSpan`), never narrower than the bed.</summary>
        public float BridgeSpan;
        /// <summary>One line per part the port emits, for diagnostics and tests.</summary>
        public readonly List<string> Notes = new List<string>();

        public readonly RailMeshBin Bed = new RailMeshBin();
        /// <summary>The raised deck and its edge shoulders; the source's `bridgeFinish` surface.</summary>
        public readonly RailMeshBin Deck = new RailMeshBin();
        public readonly RailMeshBin Steel = new RailMeshBin();
        public readonly RailMeshBin Dark = new RailMeshBin();
        public readonly RailMeshBin Power = new RailMeshBin();
        public readonly RailMeshBin Insulator = new RailMeshBin();
        /// <summary>The sound barrier's opaque lower panels (`mats.white` in the source).</summary>
        public readonly RailMeshBin Panel = new RailMeshBin();
        /// <summary>The copper overhead contact wire (`mats.wood` in `CatenaryModel.ts`).</summary>
        public readonly RailMeshBin Copper = new RailMeshBin();

        float cx;   // local x of the run centre
        float cy;   // local y of the bed centre

        bool IsBridge => Bridge != null;

        /// <summary>
        /// Build one run. <paramref name="width"/>/<paramref name="depth"/> are the saved
        /// module extents in cells; <paramref name="thirdRailSide"/> is the local +1/−1
        /// edge the conductor rail takes (ignored for an overhead run).
        /// </summary>
        public static RailRunGeometry Build(float width, float depth, float scale, int thirdRailSide, bool catenary) =>
            Build(width, depth, scale, thirdRailSide, catenary, null, null);

        /// <summary>Build one run, optionally as a bridge (see <see cref="RailBridgeOptions"/>).</summary>
        public static RailRunGeometry Build(float width, float depth, float scale, int thirdRailSide, bool catenary,
            RailBridgeOptions bridge) =>
            Build(width, depth, scale, thirdRailSide, catenary, bridge, null);

        /// <summary>Build one run with explicit bridge and catenary options.</summary>
        public static RailRunGeometry Build(float width, float depth, float scale, int thirdRailSide, bool catenary,
            RailBridgeOptions bridge, RailCatenaryOptions catenaryOptions) {
            var run = new RailRunGeometry {
                Width = Math.Max(1f, width),
                Depth = Math.Max(1f, depth),
                Scale = scale > 0f ? scale : StationRailGeometry.DefaultScale,
                ThirdRailSide = thirdRailSide,
                Catenary = catenary,
                Bridge = bridge,
                CatenaryOptions = catenaryOptions,
            };
            run.BuildParts();
            return run;
        }

        void BuildParts() {
            float w = Width, d = Depth, s = Scale;
            cx = (w - 1f) * .5f;
            cy = (d - 1f) * .5f;
            BedTop = StationRailGeometry.BedTop(s);
            RailTopAboveModule = StationRailGeometry.RailTopAboveModule(s);
            float hardwareLift = StationRailGeometry.HardwareLift(s);

            // The trench: a full dug course with its top at bedTop, the raised centre slab,
            // and the two trench walls that close the exposed block sides. Unity local axes
            // are (along, up, across), so a source (x, across, up) becomes (x, up, across).
            //
            // A **bridge** has no trench: the same raising is a deck that hangs a metre below
            // the rail bed and carries a shoulder and a barrier/railing along each edge
            // (`TrackModel.ts:buildTrack`'s `cfg.bridge` branch). Without it the rails were
            // drawn in a dug bed while the web drew the raised bridge deck the screenshots
            // show, and the whole deck and both barriers were missing (plan 22 §1).
            if (!IsBridge) {
                Box(Bed, V(cx, cy, (BedTop - 1f) * .5f), S(w, d, BedTop + 1f));
            }
            Box(Bed, V(cx, cy, BedTop + .02f), S(w, Mathf.Max(.8f, d - .52f), .04f));
            if (IsBridge) {
                BuildBridgeDeck(w, d);
            } else {
                for (int side = -1; side <= 1; side += 2)
                    Box(Bed, V(cx, cy + side * (d * .5f - .025f), BedTop * .5f), S(w, .05f, -BedTop));
            }
            Notes.Add("track-bed top=" + BedTop.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture));

            // Hardware is scaled and lifted as one group (the source's `hardware` node), so a
            // promoted stock scale only changes the running gear, never the saved trench.
            // `buildTrackDetails` ends by shifting every part down by `TRACK_BED_DROP`: the
            // sleeper bearing surface, web and fastenings are all authored above the bed
            // datum and must land in the trench with it.
            float gauge = StationRailGeometry.RailCentreOffset;
            Gauge = gauge;
            int sleepers = Mathf.Max(2, Mathf.RoundToInt(w / .6f));
            SleeperCount = sleepers;
            SleeperSpacing = w / sleepers;
            float sleeperY = Mathf.Min(2.42f, Mathf.Max(1.9f, d - .3f));
            for (int i = 0; i < sleepers; i++) {
                float x = ((i + .5f) / sleepers) * w - .5f;
                Detail(Bed, V(x, cy, .53f), S(.23f, sleeperY, .08f));
            }
            for (int sign = -1; sign <= 1; sign += 2) {
                float y = cy + sign * gauge;
                Detail(Steel, V(cx, y, .579f), S(w, .15f, .018f));
                Detail(Steel, V(cx, y, .608f), S(w, .022f, .04f));
                // The bevelled head: a broad polished crown over a narrow, darker web.
                var profile = new[] {
                    new Vector2(-.029f, .628f), new Vector2(.029f, .628f),
                    new Vector2(.035f, .635f), new Vector2(.035f, .645f),
                    new Vector2(.027f, .65f), new Vector2(-.027f, .65f),
                    new Vector2(-.035f, .645f), new Vector2(-.035f, .635f),
                };
                float baseY = cy * (1f - s);
                var placed = new List<Vector2>(profile.Length);
                for (int p = 0; p < profile.Length; p++) {
                    // Across: the hardware group's y correction and scale; up: lift and bed drop.
                    placed.Add(new Vector2(baseY + (y + profile[p].x) * s,
                        hardwareLift + (profile[p].y - StationRailGeometry.BedDrop) * s));
                }
                Steel.Extrude(placed, -.5f, w - .5f);
                for (int i = 0; i < sleepers; i++) {
                    float x = ((i + .5f) / sleepers) * w - .5f;
                    Detail(Dark, V(x, y, .567f), S(.19f, .34f, .014f));
                    for (int clip = -1; clip <= 1; clip += 2) {
                        Detail(Dark, V(x, y + clip * .085f, .591f), S(.13f, .02f, .018f), lastTier: 1);
                        Detail(Dark, V(x, y + clip * .135f, .59f), S(.046f, .046f, .026f), lastTier: 0);
                    }
                }
            }
            if (d >= 3f) {
                for (int sign = -1; sign <= 1; sign += 2) {
                    float y = cy + sign * (d * .5f - .15f);
                    Detail(Dark, V(cx, y, .466f), S(w, .16f, .025f));
                    for (int side = -1; side <= 1; side += 2)
                        Detail(Bed, V(cx, y + side * .095f, .48f), S(w, .025f, .035f));
                }
            }

            if (Catenary) {
                BuildCatenary();
            } else {
                BuildThirdRail();
            }
        }

        /* --------------------------------------------------------- bridge deck */

        /// <summary>
        /// The raised deck, its two shoulders and the barrier/railing along each edge — the
        /// port of `TrackModel.ts`'s `cfg.bridge` branch (`buildBridgeEdgeConcrete`,
        /// `buildBridgeNoiseBarrier`, `buildBridgeRailing`).
        ///
        /// The deck hangs `BRIDGE_DECK_DEPTH` (1 m) below the rail bed and spans the screen-door
        /// centre lines (`bridgeSpan`); each shoulder is the concrete step between the bed edge
        /// and the barrier line, raised to the barrier's footing. Both stop at any catenary
        /// gantry upright, including one a neighbouring run owns across the module seam.
        /// </summary>
        void BuildBridgeDeck(float w, float d) {
            var options = Bridge;
            float support = StationRailGeometry.TrackSideFixtureOffset(d, options.VehicleWidth);
            BridgeSupportOffset = support;
            float span = options.HasRailing || Catenary || !options.GroundTrack ? Mathf.Max(d, support * 2f + .12f) : d;
            BridgeSpan = span;
            float shoulderDepth = (span - d) * .5f;
            bool sound = options.SoundBarrier;
            // The deck slab first: the shoulders and barriers stand on it.
            Box(Deck, V(cx, cy, (BedTop - RailBridgeOptions.DeckDepth) * .5f),
                S(w, span, RailBridgeOptions.DeckDepth + BedTop));
            // The shoulder rises to the barrier's own footing: 0.5 m under a noise barrier,
            // 0.55 m under a railing (`buildTrack`).
            float shoulderTop = sound ? .5f : .55f;
            for (int side = -1; options.HasRailing && side <= 1; side += 2) {
                float y = cy + side * support;
                float shoulderY = cy + side * (d * .5f + shoulderDepth * .5f);
                var ownPostXs = OwnGantryPostXs(y, support);
                var postXs = new List<float>(ownPostXs);
                AppendNeighborPostXs(postXs, y);
                postXs.Sort();
                AppendBridgeShoulder(w, shoulderY, shoulderDepth, shoulderTop, postXs);
                if (sound) BuildBridgeNoiseBarrier(w, y, options.BarrierTop, ownPostXs.Count > 0);
                else BuildBridgeRailing(w, y, ownPostXs.Count > 0);
            }
            Notes.Add("track-bridge span=" + span.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) +
                " support=" + support.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) +
                " railing=" + options.Railing +
                " neighborPosts=" + options.NeighborPosts.Count);
        }

        /// <summary>`buildBridgeEdgeConcrete`: the shoulder step, split around every upright.</summary>
        void AppendBridgeShoulder(float w, float y, float depth, float top, List<float> postXs) {
            const float halfPost = .06f;
            float end = w - .5f;
            float start = -.5f;
            foreach (var x in postXs) {
                if (x + halfPost <= start || x - halfPost >= end) continue;
                Section(start, Math.Min(end, x - halfPost));
                start = Math.Min(end, Math.Max(start, x + halfPost));
            }
            Section(start, end);
            void Section(float lo, float hi) {
                if (hi <= lo) return;
                Box(Deck, V((lo + hi) * .5f, y, (top + BedTop) * .5f), S(hi - lo, depth, top - BedTop));
            }
        }

        /// <summary>
        /// `buildBridgeNoiseBarrier`: a glazed barrier on opaque lower panels between steel
        /// posts every two metres — a half-height one tops out at 2 m and the full one at 3.5 m.
        /// Panels and rails stop at every post, and never share a face with it.
        /// </summary>
        void BuildBridgeNoiseBarrier(float w, float y, float top, bool gantryOwnsUprights) {
            const float baseZ = .5f;
            const float halfPost = .06f;
            const float railHeight = .08f;
            const float glazing = .003f;
            float height = top - baseZ;
            float middle = baseZ + height * 2f / 3f;
            var externalCuts = new List<Vector2>();
            foreach (var post in Bridge.NeighborPosts)
                if (Mathf.Abs(post.y - y) < halfPost * 2f - 1e-6f)
                    externalCuts.Add(new Vector2(post.x - halfPost, post.x + halfPost));
            var cuts = new List<Vector2>(externalCuts);
            for (float x = 0f; x < w; x += 2f) {
                bool gantry = gantryOwnsUprights && Mathf.Approximately(Mathf.Repeat(x, 8f), 0f);
                bool inside = false;
                for (int i = 0; i < externalCuts.Count; i++) {
                    var cut = externalCuts[i];
                    if (cut.x < x + halfPost && cut.y > x - halfPost) { inside = true; break; }
                }
                if (!gantry && inside) continue;
                cuts.Add(new Vector2(x - halfPost, x + halfPost));
                // The gantry supplies the upright at this position; every surrounding frame and
                // panel stops at its faces rather than passing through it.
                if (!gantry)
                    Box(Dark, V(x, y, baseZ + height * .5f), S(halfPost * 2f, halfPost * 2f, height));
            }
            cuts.Sort((a, b) => a.x.CompareTo(b.x));
            float start = -.5f;
            float end = w - .5f;
            for (int i = 0; i < cuts.Count; i++) {
                var cut = cuts[i];
                if (cut.y <= start || cut.x >= end) continue;
                Bay(start, Math.Min(end, cut.x));
                start = Math.Min(end, Math.Max(start, cut.y));
            }
            Bay(start, end);
            void Bay(float lo, float hi) {
                if (hi <= lo) return;
                float x = (lo + hi) * .5f;
                float width = hi - lo;
                float lowerTop = middle - railHeight * .5f;
                float glassBottom = middle + railHeight * .5f + glazing;
                float glassTop = top - railHeight - glazing;
                Box(Panel, V(x, y, (baseZ + lowerTop) * .5f), S(width, .08f, lowerTop - baseZ));
                if (width > glazing * 2f)
                    Box(Steel, V(x, y, (glassBottom + glassTop) * .5f), S(width - glazing * 2f, .08f, glassTop - glassBottom));
                Box(Steel, V(x, y, middle), S(width, halfPost * 2f, railHeight));
                Box(Steel, V(x, y, top - railHeight * .5f), S(width, halfPost * 2f, railHeight));
            }
        }

        /// <summary>`buildBridgeRailing`: a top rail at 1.25 m on posts every two metres.</summary>
        void BuildBridgeRailing(float w, float y, bool gantryOwnsUprights) {
            Box(Steel, V((w - 1f) * .5f, y, 1.25f), S(w, .08f, .08f));
            for (float x = 0f; x < w; x += 2f) {
                if (gantryOwnsUprights && Mathf.Approximately(Mathf.Repeat(x, 8f), 0f)) continue;
                Box(Steel, V(x, y, .9f), S(.08f, .08f, .7f));
            }
        }

        /// <summary>
        /// The gantry uprights this run owns on one barrier line (`trackGantryLayout`): a bridge
        /// catenary run stands one every eight metres, on the conductor-rail side only.
        /// </summary>
        List<float> OwnGantryPostXs(float y, float support) {
            var xs = new List<float>();
            if (!Catenary) return xs;
            int side = ThirdRailSide == 0 ? -1 : ThirdRailSide;
            float gantryY = cy + side * support;
            if (Mathf.Abs(gantryY - y) > .12f) return xs;
            for (float x = 0f; x < Width; x += 8f) xs.Add(x);
            return xs;
        }

        /// <summary>`neighboringGantryPosts`' x list for one barrier line.</summary>
        void AppendNeighborPostXs(List<float> xs, float y) {
            if (Bridge.NeighborPosts == null || Bridge.NeighborPosts.Count == 0) return;
            for (int i = 0; i < Bridge.NeighborPosts.Count; i++) {
                var post = Bridge.NeighborPosts[i];
                if (Mathf.Abs(post.y - y) >= .12f - 1e-6f) continue;
                xs.Add(post.x);
            }
        }

        /* ------------------------------------------------------ local-axis helpers */

        /// <summary>Source-frame point (along, across, up) → Unity local (along, up, across).</summary>
        internal static Vector3 V(float along, float across, float up) => new Vector3(along, up, across);

        /// <summary>Source-frame size (along, across, up) → Unity local (along, up, across).</summary>
        internal static Vector3 S(float along, float across, float up) => new Vector3(along, up, across);

        static void Box(RailMeshBin bin, Vector3 centre, Vector3 size) => bin.Box(centre, size);

        /// <summary>
        /// One running-gear box: apply the source's hardware group — across correction
        /// <c>cy·(1−scale)</c>, up scale, the lift and the final `TRACK_BED_DROP` shift.
        /// </summary>
        void Detail(RailMeshBin bin, Vector3 centre, Vector3 size, int lastTier = 2) {
            float s = Scale;
            float hardwareLift = StationRailGeometry.HardwareLift(s);
            // `centre` is already in Unity local axes: y is up, z is across.
            bin.Box(
                new Vector3(centre.x,
                    hardwareLift + (centre.y - StationRailGeometry.BedDrop) * s,
                    cy * (1f - s) + centre.z * s),
                new Vector3(size.x, size.y * s, size.z * s), lastTier);
        }

        /// <summary>`TrackDetails.ts:buildThirdRail`: guarded conductor rail, cover and insulators.</summary>
        void BuildThirdRail() {
            float w = Width, d = Depth;
            int side = ThirdRailSide == 0 ? -1 : ThirdRailSide;
            float ty = cy + side * 1.05f;
            ThirdRailSide = side;
            ThirdRailLocalY = ty;
            Detail(Dark, V(cx, ty, .62f), S(w, .09f, .09f));
            Detail(Power, V(cx, ty + side * .12f, .8f), S(w, .34f, .05f));
            Detail(Power, V(cx, ty + side * .28f, .8f), S(w, .05f, .22f));
            int n = Mathf.Max(2, Mathf.RoundToInt(w / 4f));
            for (int i = 0; i < n; i++) {
                float x = ((i + .5f) / n) * w - .5f;
                Detail(Dark, V(x, ty, .5f), S(.24f, .28f, .025f));
                Detail(Insulator, V(x, ty, .54f), S(.13f, .13f, .08f));
                Detail(Dark, V(x, ty, .59f), S(.2f, .17f, .025f));
            }
            Notes.Add("track-third-rail side=" + side + " localY=" + ty.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture));
        }

        /// <summary>
        /// Port of `CatenaryModel.ts:buildTrackCatenary` for the 5 m storey profile:
        /// rigid aluminium overhead conductor rail under slabs and inside tunnels, and
        /// single-sided cantilever gantries with a sagging parabolic messenger wire,
        /// droppers, ribbed insulators, cleats, and return conductor on open runs/bridges.
        /// Contact wire sits level at `TrainContactWireZ(Scale)` (`3.903 m` at `0.98`)
        /// reaching both module seams (`-0.5 .. w - 0.5`).
        /// </summary>
        void BuildCatenary() {
            float w = Width, d = Depth;
            // `CatenaryModel.ts`: `trainContactWireZ(trainScaleForStorey(mod.storeyHeight))`
            // derives wire elevation from the 5 m storey profile (`0.98` -> `3.903 m`), never
            // the promoted consist's `bakedScale` (which would push rigid clamps 4.6 cm above
            // the 4.0 m ceiling slab).
            float contact = StationRailGeometry.TrainContactWireZ(StationRailGeometry.DefaultScale);
            ContactWireZ = contact;
            int mastSide = ThirdRailSide == 0 ? -1 : ThirdRailSide;
            bool tunnel = CatenaryOptions != null && CatenaryOptions.Tunnel;
            string style = CatenaryOptions != null ? CatenaryOptions.Style ?? "" : "";
            float vehicleWidth = CatenaryOptions != null && CatenaryOptions.VehicleWidth > 0f
                ? CatenaryOptions.VehicleWidth
                : Bridge != null ? Bridge.VehicleWidth : 0f;
            bool isGantry = !tunnel && (IsBridge || string.Equals(style, "gantry", StringComparison.Ordinal));
            RigidCatenary = !isGantry;

            // Round copper contact wire reaching both module seams; underside touches pantograph carbon.
            Copper.Tube(V(-.5f, cy, contact), V(w - .5f, cy, contact), StationRailGeometry.ContactWireRadius, 8);

            if (!isGantry) {
                float ceiling = CatenaryOptions != null && CatenaryOptions.CeilingZ > 0f
                    ? CatenaryOptions.CeilingZ
                    : StationRailGeometry.TrackHeadroom(true, tunnel, false, style) + 1f;
                // Flanged aluminium conductor rail; copper sits proud beneath it.
                Box(Steel, V(cx, cy, contact + .062f), S(w, .095f, .016f));
                Box(Steel, V(cx, cy, contact + .036f), S(w, .022f, .036f));
                int count = Mathf.Max(2, Mathf.RoundToInt(w / 4f));
                for (int i = 0; i < count; i++) {
                    float x = (i + .5f) * w / count - .5f;
                    if (tunnel) {
                        Box(Dark, V(x, -.46f, ceiling - .045f), S(.19f, .06f, .08f));
                        Steel.Tube(V(x, -.43f, ceiling - .025f), V(x, cy - .32f, ceiling - .03f), .012f, 6);
                        Dark.Tube(V(x, -.43f, ceiling - .075f), V(x, cy - .32f, ceiling - .03f), .009f, 6);
                        Dark.RibbedInsulator(V(x, cy - .32f, ceiling - .03f), V(x, cy, ceiling - .03f), .023f, 6);
                        Steel.Tube(V(x, cy, ceiling - .03f), V(x, cy, contact + .077f), .012f, 6);
                    } else {
                        Box(Dark, V(x, cy - .48f, ceiling - .012f), S(.22f, .25f, .024f));
                        Dark.RibbedInsulator(V(x, cy - .45f, ceiling - .03f), V(x, cy - .1f, ceiling - .03f), .023f, 6);
                        Steel.Tube(V(x, cy - .1f, ceiling - .03f), V(x, cy, contact + .075f), .012f, 6);
                    }
                    Dark.Box(V(x, cy, contact + .075f), S(.14f, .14f, .018f), lastTier: 0);
                }
                Notes.Add("track-catenary:rigid" + (tunnel ? "-tunnel" : "-ceiling") +
                    " contact=" + contact.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) +
                    " ceiling=" + ceiling.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture));
                return;
            }

            // Open gantry layout (`TrackGantry.ts:trackGantryLayout`).
            var mastXs = new List<float>();
            if (IsBridge) {
                for (float x = 0f; x < w; x += 8f) mastXs.Add(x);
            } else {
                int count = Mathf.Max(1, Mathf.CeilToInt(w / 8f));
                for (int i = 0; i < count; i++) {
                    mastXs.Add(count == 1 ? (w - 1f) * .5f : (i / (float)(count - 1)) * (w - 1f) - .5f);
                }
            }
            GantryMastCount = mastXs.Count;
            float offset = StationRailGeometry.TrackSideFixtureOffset(d, vehicleWidth);
            float postY = cy + mastSide * offset;
            float top = contact + .72f;
            float messengerZ = contact + .38f;
            float bottom = IsBridge ? -StationRailGeometry.UnderfloorDrop : 0f;
            float postTop = top + .1f;
            float inward = Mathf.Sign(cy - postY);
            if (inward == 0f) inward = -mastSide;
            float armEnd = cy + inward * .35f;
            float side = postY + inward * .08f;

            void InsulatedArm(Vector3 from, Vector3 to) {
                Vector3 c = Vector3.Lerp(from, to, .12f);
                Vector3 dd = Vector3.Lerp(from, to, .38f);
                Steel.Tube(from, c, .023f, 6);
                Dark.RibbedInsulator(c, dd, .065f, 6);
                Steel.Tube(dd, to, .023f, 6);
            }

            for (int i = 0; i < mastXs.Count; i++) {
                float x = mastXs[i];
                Box(Dark, V(x, postY, (bottom + postTop) * .5f), S(.12f, .12f, postTop - bottom));
                Dark.Tube(V(x, postY, top), V(x, armEnd, top), .045f, 8);
                Dark.Tube(V(x, postY, top - .66f), V(x, armEnd - inward * .20f, top), .032f, 8);
                Box(Dark, V(x, postY + inward * .06f, top - .36f), S(.12f, .08f, .10f));
                Box(Dark, V(x, postY + inward * .06f, contact + .21f), S(.12f, .08f, .10f));
                InsulatedArm(V(x, side, top - .36f), V(x, cy, messengerZ));
                InsulatedArm(V(x, side, contact + .21f), V(x, cy - mastSide * .18f, contact + .10f));
                Dark.Tube(
                    V(x, Mathf.Lerp(side, cy, .48f), Mathf.Lerp(top - .36f, messengerZ, .48f)),
                    V(x, cy - mastSide * .18f, contact + .10f), .012f, 6);
                Dark.Tube(V(x, cy - mastSide * .18f, contact + .10f), V(x, cy, contact + .035f), .015f, 6);
                Steel.Tube(V(x, cy, messengerZ), V(x, cy, contact + .012f), .006f, 6);
                Dark.RibbedInsulator(V(x, postY, top - .02f), V(x, postY - mastSide * .18f, top - .02f), .035f, 6);
            }
            Dark.Tube(V(-.5f, postY - mastSide * .18f, top - .02f), V(w - .5f, postY - mastSide * .18f, top - .02f), .009f, 6);

            // Unique sorted anchors from -0.5 to w - 0.5: every module ends at messengerZ so
            // abutting runs join seamlessly without steps, while each span sags parabolically.
            var anchors = new List<float>(mastXs.Count + 2) { -.5f, w - .5f };
            for (int i = 0; i < mastXs.Count; i++) anchors.Add(mastXs[i]);
            anchors.Sort();
            var uniqueAnchors = new List<float>(anchors.Count);
            for (int i = 0; i < anchors.Count; i++) {
                if (uniqueAnchors.Count == 0 || Mathf.Abs(anchors[i] - uniqueAnchors[uniqueAnchors.Count - 1]) > 1e-4f)
                    uniqueAnchors.Add(anchors[i]);
            }
            var curvePoints = new Vector3[9];
            for (int bay = 1; bay < uniqueAnchors.Count; bay++) {
                float start = uniqueAnchors[bay - 1];
                float end = uniqueAnchors[bay];
                float length = end - start;
                if (length < .01f) continue;
                MessengerSpanCount++;
                float sag = Mathf.Min(.14f, length * .025f);
                for (int p = 0; p < 9; p++) {
                    float t = p / 8f;
                    float z = messengerZ - sag * 4f * t * (1f - t);
                    curvePoints[p] = V(Mathf.Lerp(start, end, t), cy, z);
                }
                Steel.PolylineTube(curvePoints, .009f, 6);
                int droppers = Mathf.Max(1, Mathf.CeilToInt(length / 2f));
                for (int i = 0; i < droppers; i++) {
                    float t = (i + .5f) / droppers;
                    float x = Mathf.Lerp(start, end, t);
                    float z = messengerZ - sag * 4f * t * (1f - t);
                    Steel.Tube(V(x, cy, contact + .012f), V(x, cy, z), .006f, 6, lastTier: i % 2 == 0 ? 2 : 0);
                    Dark.Box(V(x, cy, contact + .026f), S(.055f, .055f, .025f), lastTier: 0);
                    DropperCount++;
                }
            }
            Notes.Add("track-catenary:gantry masts=" + GantryMastCount + " spans=" + MessengerSpanCount +
                " contact=" + contact.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture));
        }
    }
}
