using System;
using Metro.Build;
using Metro.View;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// The dimension-aware booth (port of <c>render/models/pieces/BoothModel.ts</c>
    /// <c>buildBoothCanonical</c>). A booth is authored as a <c>w × h</c> room: its body
    /// is two side runs and a back run inset by <c>depth = min(0.55, w/3, h/3)</c>, with
    /// a counter across the approach face and an open overhead fascia frame at
    /// 2.08–2.40 m. The promoted <c>TicketBooth</c> prefab measures 5.45 × 3 m, so it
    /// cannot stand in for Zoo's 3 × 3 records (RCA 14 §3.4); this builder is the
    /// canonical prefab's authored dimensions with the promoted model only kept as a
    /// fallback the caller must report.
    ///
    /// Local axes: <c>x</c> along the run, <c>y</c> up from the floor top, <c>z</c>
    /// along the saved plan y. <c>cfg.front</c> turns the whole booth about its
    /// footprint centre, exactly as the source's oriented group does.
    /// </summary>
    public static class BoothModuleViews {
        // The station palette slots this family uses. The promoted piece's `binSteel`,
        // `screen` and `black` have no separate palette entry; steel grey, dark and the
        // teal line colour stand in without adding a 15th finish.
        const int White = StationMaterials.Light;
        const int BinSteel = 4;
        const int Steel = StationMaterials.Steel;
        const int Dark = StationMaterials.Dark;
        const int Glass = StationMaterials.Glass;
        const int Red = 9;
        const int Line = StationMaterials.Line;

        const float HeaderBottom = 2.08f;
        const float HeaderTop = 2.4f;

        /// <summary>Shared unit cube for <see cref="GeometryKit"/>; never destroyed.</summary>
        public static Mesh Cube() {
            if (!cube) cube = BuildCube();
            return cube;
        }

        static Mesh cube;

        /// <summary>
        /// Build one booth under `parent`, positioned and turned by the shared module
        /// placement (the run centre pivot). Returns false only when no geometry could be
        /// made; `note` names an approximation this port still makes.
        /// </summary>
        public static bool TryBuild(ModuleFacts module, Transform parent, StationMaterials materials,
            out GameObject view, out string note) {
            view = null;
            note = "";
            if (module == null || parent == null || materials == null) return false;
            int width = Mathf.Max(1, module.Width);
            int depthPlan = Mathf.Max(1, module.Depth);
            int front = ((module.Config.Int("front", 0) % 4) + 4) % 4;
            bool info = string.Equals(module.Config.Text("kind"), "info", StringComparison.Ordinal);
            // The source builds the canonical booth in its turned footprint: an odd front
            // quarter turn swaps the two plan extents before the booth is rotated back.
            float w = front % 2 == 1 ? depthPlan : width;
            float h = front % 2 == 1 ? width : depthPlan;
            var kit = new GeometryKit(parent, Cube(), materials);
            try {
                var yaw = Quaternion.Euler(0f, -90f * front, 0f);
                // A canonical-axis box at (lx, planY, elevation) with extents (sx, sy, sz).
                void Box(float lx, float planY, float elevation, float sx, float sy, float sz, int colour) =>
                    kit.LocalBox(Vector3.zero, yaw, new Vector3(lx, elevation, planY),
                        new Vector3(sx, sz, sy), colour);

                float inset = Mathf.Min(.55f, Mathf.Min(w / 3f, h / 3f));
                const float cap = .08f;
                float top = info ? 1.02f : .96f;
                int body = info ? White : BinSteel;
                int rim = info ? White : Steel;
                float a = -w * .5f + inset, b = w * .5f - inset, mid = (a + b) * .5f;
                float run = Mathf.Max(.1f, b - a);
                // Side runs own the corners; the back run and counter butt between them.
                foreach (float x in new[] { -w * .5f + inset * .5f, w * .5f - inset * .5f }) {
                    Box(x, 0f, (top + .11f) * .5f, inset, h, top - .11f, body);
                    Box(x, 0f, top + cap * .5f, inset, h, cap, rim);
                }
                Box(mid, h * .5f - inset * .5f, (top + .11f) * .5f, run, inset, top - .11f, body);
                Box(mid, h * .5f - inset * .5f, top + cap * .5f, run, inset, cap, rim);
                // Counter across the approach face. The ticket kiosk's profile is the
                // plain rectangular service face; the information counter's accessible
                // shoulder is drawn straight here and named below.
                Box(mid, -h * .5f + inset * .5f, (top + .11f) * .5f, run, inset, top - .11f, body);
                Box(mid, -h * .5f + inset * .5f, top + cap * .5f, run, inset, cap, rim);
                if (info) {
                    note = "booth-info-shoulder: the accessible counter profile is drawn square, not sloped";
                }
                int kick = info ? Steel : Dark;
                foreach (float planY in new[] { -h * .5f + .015f, h * .5f - .015f })
                    Box(mid, planY, .055f, w, .03f, .11f, kick);
                foreach (float x in new[] { -w * .5f + .015f, w * .5f - .015f })
                    Box(x, 0f, .055f, .03f, h, .11f, kick);
                // Open rectangular overhead frame and its fascia band.
                float fasciaBottom = info ? HeaderBottom + .045f : HeaderBottom;
                int band = info ? Dark : BinSteel;
                foreach (float x in new[] { -w * .5f + .09f, w * .5f - .09f })
                    Box(x, 0f, (fasciaBottom + HeaderTop) * .5f, .18f, h, HeaderTop - fasciaBottom, band);
                foreach (float planY in new[] { -h * .5f + .098f, h * .5f - .098f })
                    Box(mid, planY, (fasciaBottom + HeaderTop) * .5f, w - .36f, .18f, HeaderTop - fasciaBottom, band);
                if (info) {
                    // Underside light and the burgundy seam follow the suspended frame.
                    foreach (float x in new[] { -w * .5f + .09f, w * .5f - .09f }) {
                        Box(x, 0f, HeaderBottom + .015f, .18f, h, .03f, White);
                        Box(x, 0f, HeaderBottom + .0375f, .18f, h, .015f, Red);
                    }
                    foreach (float planY in new[] { -h * .5f + .098f, h * .5f - .098f }) {
                        Box(mid, planY, HeaderBottom + .015f, w - .36f, .18f, .03f, White);
                        Box(mid, planY, HeaderBottom + .0375f, w - .36f, .18f, .015f, Red);
                    }
                    foreach (float planY in new[] { -h * .5f + .1f, h * .5f - .1f })
                        Box(mid, planY, HeaderBottom - .015f, w - .36f, .12f, .03f, White);
                    foreach (float x in new[] { -w * .5f + .1f, w * .5f - .1f })
                        Box(x, 0f, HeaderBottom - .015f, .12f, h - .36f, .03f, White);
                } else {
                    Glaze(Box, w, h, top, cap, mid);
                }
                // Counter fittings. A stocked record's staff seats stay separate modules.
                float[] screens = info
                    ? new[] { a + run * .16f }
                    : new[] { a + run * .2f, b - run * .2f };
                float screenY = -h * .5f + inset * .67f;
                foreach (float x in screens) {
                    Box(x, screenY, top + cap + .025f, .28f, .18f, .035f, Dark);
                    Box(x, screenY, top + cap + .10f, .035f, .04f, .15f, Dark);
                    Box(x, screenY, top + cap + .23f, .34f, .045f, .23f, Dark);
                    Box(x, screenY - .024f, top + cap + .23f, .30f, .01f, .19f, Line);
                }
                view = kit.Finish(string.IsNullOrEmpty(module.Id) ? "booth" : module.Id);
            } catch (Exception error) {
                DestroyNow(kit.Root ? kit.Root.gameObject : null);
                note = error.GetType().Name + ": " + error.Message;
                return false;
            }
            view.transform.SetPositionAndRotation(Pivot(module), Quaternion.identity);
            return true;
        }

        static void Glaze(Action<float, float, float, float, float, float, int> box,
            float w, float h, float top, float cap, float mid) {
            const float post = .08f;
            float glassBottom = top + cap;
            float glassTop = HeaderBottom;
            float glassHeight = Mathf.Max(.05f, glassTop - glassBottom);
            float glassMid = (glassBottom + glassTop) * .5f;
            foreach (float x in new[] { -w * .5f + post * .5f, w * .5f - post * .5f }) {
                foreach (float planY in new[] { -h * .5f + post * .5f, h * .5f - post * .5f })
                    box(x, planY, glassMid, post, post, glassHeight, Dark);
                box(x, 0f, glassMid, .025f, h - 2 * post, glassHeight, Glass);
            }
            box(mid, h * .5f - .04f, glassMid, w - 2 * post, .025f, glassHeight, Glass);
            int bays = Mathf.Max(1, Mathf.FloorToInt((w - .16f) / 1.6f));
            float bayWidth = (w - 2 * post) / bays;
            for (int i = 0; i < bays; i++) {
                float x = -w * .5f + post + bayWidth * (i + .5f);
                float sill = glassBottom + .16f;
                box(x, -h * .5f + .04f, (sill + glassTop) * .5f, bayWidth - .03f, .025f, glassTop - sill, Glass);
                box(x, -h * .5f + .04f, sill, bayWidth - .03f, .045f, .035f, Steel);
                if (i > 0) box(x - bayWidth * .5f, -h * .5f + .04f, glassMid, .03f, .06f, glassHeight, Dark);
            }
        }

        /// <summary>
        /// The footprint centre at the cell's floor top. `BoothModel` draws its canonical
        /// room in **world axes** and owns its orientation through `cfg.front`; the saved
        /// <c>rot</c> is not a turn of a booth (the source never reads it), so neither the
        /// pivot nor the geometry may follow it.
        /// </summary>
        static Vector3 Pivot(ModuleFacts module) {
            var document = new Vector3(
                module.X + Mathf.Max(1, module.Width) * .5f,
                module.Y + Mathf.Max(1, module.Depth) * .5f,
                module.Z + 1f);
            return StationCoordinates.Point(document);
        }

        static void DestroyNow(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }

        /// <summary>
        /// The booth's unit cube. RCA 15 §3: this used to be a hand-built 8-vertex box whose
        /// index table did not match its own bit order (x = bit 0, y = bit 1, z = bit 2), so
        /// every quad was a bowtie and `RecalculateNormals` smoothed the shell into artifacts.
        /// The opening builder's cube is already per-face with correct winding and normals, so
        /// the booth reuses it rather than carrying a second table.
        /// </summary>
        static Mesh BuildCube() {
            var source = OpeningBuilder.UnitCube;
            var mesh = new Mesh { name = "booth box" };
            mesh.vertices = source.vertices;
            mesh.normals = source.normals;
            mesh.uv = source.uv;
            mesh.triangles = source.triangles;
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
