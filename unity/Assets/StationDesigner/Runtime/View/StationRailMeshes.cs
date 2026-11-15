using System;
using System.Collections.Generic;
using Metro.Build;
using UnityEngine;

namespace Metro.View {
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
        /// <summary>One line per part the port emits, for diagnostics and tests.</summary>
        public readonly List<string> Notes = new List<string>();

        public readonly RailMeshBin Bed = new RailMeshBin();
        public readonly RailMeshBin Steel = new RailMeshBin();
        public readonly RailMeshBin Dark = new RailMeshBin();
        public readonly RailMeshBin Power = new RailMeshBin();
        public readonly RailMeshBin Insulator = new RailMeshBin();

        float cx;   // local x of the run centre
        float cy;   // local y of the bed centre

        /// <summary>
        /// Build one run. <paramref name="width"/>/<paramref name="depth"/> are the saved
        /// module extents in cells; <paramref name="thirdRailSide"/> is the local +1/−1
        /// edge the conductor rail takes (ignored for an overhead run).
        /// </summary>
        public static RailRunGeometry Build(float width, float depth, float scale, int thirdRailSide, bool catenary) {
            var run = new RailRunGeometry {
                Width = Math.Max(1f, width),
                Depth = Math.Max(1f, depth),
                Scale = scale > 0f ? scale : StationRailGeometry.DefaultScale,
                ThirdRailSide = thirdRailSide,
                Catenary = catenary,
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
            Box(Bed, V(cx, cy, (BedTop - 1f) * .5f), S(w, d, BedTop + 1f));
            Box(Bed, V(cx, cy, BedTop + .02f), S(w, Mathf.Max(.8f, d - .52f), .04f));
            for (int side = -1; side <= 1; side += 2)
                Box(Bed, V(cx, cy + side * (d * .5f - .025f), BedTop * .5f), S(w, .05f, -BedTop));
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
