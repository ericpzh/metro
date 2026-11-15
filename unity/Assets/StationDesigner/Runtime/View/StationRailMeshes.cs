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
        /// <summary>`cfg.bridgeRailing`: `<c>railing</c>`, `<c>sound-barrier</c>` or `<c>sound-barrier-half</c>`.</summary>
        public string Railing = "railing";
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
        public float BarrierTop => string.Equals(Railing, "sound-barrier-half", StringComparison.Ordinal) ? 2f
            : string.Equals(Railing, "sound-barrier", StringComparison.Ordinal) ? BridgeBarrierTop : BridgeRailingTop;

        /// <summary>`BRIDGE_BARRIER_TOP`.</summary>
        public const float BridgeBarrierTop = 3.5f;
        /// <summary>`bridgeBarrierTop`'s railing case.</summary>
        public const float BridgeRailingTop = 1.29f;
        /// <summary>`BRIDGE_DECK_DEPTH`: one metre of structure below the rail bed.</summary>
        public const float DeckDepth = 1f;
    }

    /// <summary>One material bin of generated track geometry: vertices and triangles only.</summary>
    public sealed class RailMeshBin {
        public readonly List<Vector3> Vertices = new List<Vector3>();
        public readonly List<int> Triangles = new List<int>();
        public int VertexCount => Vertices.Count;
        public int TriangleCount => Triangles.Count / 3;

        public void Box(Vector3 centre, Vector3 size) {
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
            return mesh;
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
        /// <summary>Non-null for a `cfg.bridge` run: the deck, shoulders and barriers it draws.</summary>
        public RailBridgeOptions Bridge;
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

        float cx;   // local x of the run centre
        float cy;   // local y of the bed centre

        bool IsBridge => Bridge != null;

        /// <summary>
        /// Build one run. <paramref name="width"/>/<paramref name="depth"/> are the saved
        /// module extents in cells; <paramref name="thirdRailSide"/> is the local +1/−1
        /// edge the conductor rail takes (ignored for an overhead run).
        /// </summary>
        public static RailRunGeometry Build(float width, float depth, float scale, int thirdRailSide, bool catenary) =>
            Build(width, depth, scale, thirdRailSide, catenary, null);

        /// <summary>Build one run, optionally as a bridge (see <see cref="RailBridgeOptions"/>).</summary>
        public static RailRunGeometry Build(float width, float depth, float scale, int thirdRailSide, bool catenary,
            RailBridgeOptions bridge) {
            var run = new RailRunGeometry {
                Width = Math.Max(1f, width),
                Depth = Math.Max(1f, depth),
                Scale = scale > 0f ? scale : StationRailGeometry.DefaultScale,
                ThirdRailSide = thirdRailSide,
                Catenary = catenary,
                Bridge = bridge,
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
                        Detail(Dark, V(x, y + clip * .085f, .591f), S(.13f, .02f, .018f));
                        Detail(Dark, V(x, y + clip * .135f, .59f), S(.046f, .046f, .026f));
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
                Notes.Add("track-catenary:masts+contact-wire (simplified gantry lookup)");
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
            float span = Mathf.Max(d, support * 2f + .12f);
            BridgeSpan = span;
            float shoulderDepth = (span - d) * .5f;
            bool sound = options.SoundBarrier;
            // The deck slab first: the shoulders and barriers stand on it.
            Box(Deck, V(cx, cy, (BedTop - RailBridgeOptions.DeckDepth) * .5f),
                S(w, span, RailBridgeOptions.DeckDepth + BedTop));
            // The shoulder rises to the barrier's own footing: 0.5 m under a noise barrier,
            // 0.55 m under a railing (`buildTrack`).
            float shoulderTop = sound ? .5f : .55f;
            for (int side = -1; side <= 1; side += 2) {
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
        void Detail(RailMeshBin bin, Vector3 centre, Vector3 size) {
            float s = Scale;
            float hardwareLift = StationRailGeometry.HardwareLift(s);
            // `centre` is already in Unity local axes: y is up, z is across.
            Box(bin,
                new Vector3(centre.x,
                    hardwareLift + (centre.y - StationRailGeometry.BedDrop) * s,
                    cy * (1f - s) + centre.z * s),
                new Vector3(size.x, size.y * s, size.z * s));
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
        /// An overhead run: masts along the bed, a cantilever and a contact wire at the
        /// source's `CONTACT_WIRE_Z`. The full per-neighbour gantry weave is not ported
        /// (the station rails are third rail); the wire, masts and droppers are real
        /// geometry and the simplification is named in <see cref="Notes"/>.
        /// </summary>
        void BuildCatenary() {
            // Catenary is drawn on the track group, not the scaled running-gear group: it
            // is not shifted by `TRACK_BED_DROP` and keeps its authored wire height.
            float w = Width, d = Depth;
            int masts = Mathf.Max(2, Mathf.RoundToInt(w / 24f));
            float contact = StationRailGeometry.OverheadContactZ;
            for (int i = 0; i < masts; i++) {
                float x = ((i + .5f) / masts) * w - .5f;
                float postY = cy + (d * .5f + .35f);
                Box(Dark, V(x, postY, contact * .5f), S(.16f, .16f, contact));
                Box(Dark, V(x, cy, contact - .05f), S(.16f, postY - cy, .12f));
                Box(Insulator, V(x, cy, contact - .18f), S(.12f, .12f, .12f));
            }
            Box(Dark, V(cx, cy, contact), S(w, .035f, .035f));
            Box(Steel, V(cx, cy, contact + 1.2f), S(w, .03f, .03f));
            int droppers = Mathf.Max(2, Mathf.RoundToInt(w / 5f));
            for (int i = 0; i < droppers; i++) {
                float x = ((i + .5f) / droppers) * w - .5f;
                Box(Steel, V(x, cy, contact + .6f), S(.025f, .025f, 1.2f));
            }
        }
    }
}
