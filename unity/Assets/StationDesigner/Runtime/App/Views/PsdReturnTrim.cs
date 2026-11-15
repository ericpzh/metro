using System;
using System.Collections.Generic;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// 18 §3 — the fixed PSD return stops at its parent screen's housing.
    ///
    /// `PsdEndModel.build` does not draw the return as an independent body and leave it at
    /// that: it builds the parent screen's own end profile (`buildPsd` on the `cfg.corner`
    /// module, profile only), carries every box of it into the return's frame, and then
    /// trims the return's **opaque** boxes back to that housing — split at each change in the
    /// housing's vertical cross-section so every slice reaches its matching face, with a
    /// millimetre-scale inset that keeps the fascia, rails and posts in their authored depth
    /// order instead of all landing on one plane. The fixed glass is deliberately **not**
    /// trimmed in X: it has to reach the screen's centreline, so only its own box and tile
    /// bounds clamp it.
    ///
    /// Without this, the return's threshold, concrete foundation, fascia and posts ran
    /// untrimmed into the parent block and shared top faces with it (the broken dark strip
    /// at the base in the playtest), and the fixed glass floated a single clearance away
    /// from the fascia.
    ///
    /// Axes here are the module holder's local axes: **x** along the run, **y** up,
    /// **z** across (into the track).
    /// </summary>
    public static class PsdReturnTrim {
        /// <summary>The opaque inset's base, metres (`0.001` in `PsdEndModel.ts`).</summary>
        public const float InsetBase = .001f;
        /// <summary>The depth under which the inset grows (`0.28` m in the source).</summary>
        public const float InsetDepth = .28f;
        /// <summary>The inset's slope per metre of missing depth (`0.01`).</summary>
        public const float InsetSlope = .01f;

        /// <summary>One housing volume of the parent screen, in the return's local frame.</summary>
        public struct Housing {
            public Vector3 Min, Max;
            public override string ToString() =>
                "housing(" + Min.x.ToString("0.###") + ".." + Max.x.ToString("0.###") + " y " +
                Min.y.ToString("0.###") + ".." + Max.y.ToString("0.###") + " z " +
                Min.z.ToString("0.###") + ".." + Max.z.ToString("0.###") + ")";
        }

        /// <summary>
        /// `0.001 + max(0, 0.28 − depth) × 0.01`: the depth-dependent inset that keeps an
        /// opaque fitting clear of the face it nearly meets.
        /// </summary>
        public static float Inset(float depthAcross) =>
            InsetBase + Mathf.Max(0f, InsetDepth - depthAcross) * InsetSlope;

        /// <summary>
        /// Trim one box. Returns the replacement boxes in the holder's local frame; an empty
        /// list means the box is entirely inside the parent's housing (or has no volume).
        /// </summary>
        /// <param name="centre">The box's centre.</param>
        /// <param name="size">The box's size.</param>
        /// <param name="glass">Glazing is not trimmed in X, only clamped to its own box and the tile.</param>
        /// <param name="offsetX">The return's saved length offset: its sign names the parent's side.</param>
        /// <param name="housing">The parent screen's housing boxes; null/empty for a continuation.</param>
        public static List<(Vector3 centre, Vector3 size)> Apply(Vector3 centre, Vector3 size, bool glass,
            float offsetX, IReadOnlyList<Housing> housing) {
            var result = new List<(Vector3 centre, Vector3 size)>(1);
            if (size.x <= 1e-6f || size.y <= 1e-6f || size.z <= 1e-6f) return result;
            var min = centre - size * .5f;
            var max = centre + size * .5f;
            bool housingPresent = !glass && housing != null && housing.Count > 0;
            // A standalone continuation shares no face with a parent, so it keeps its authored
            // box exactly (no millimetre inset); only a return that meets a housing needs the
            // depth-ordering clearance. The tile clamp below still applies to both.
            float inset = housingPresent ? Inset(size.z) : 0f;
            // The vertical cuts: the box's own ends plus every housing face inside it.
            var cuts = new List<float>(8) { min.y, max.y };
            if (!glass && housing != null && housing.Count > 0) {
                for (int i = 0; i < housing.Count; i++) {
                    AddCut(cuts, housing[i].Min.y, min.y, max.y);
                    AddCut(cuts, housing[i].Max.y, min.y, max.y);
                }
            }
            cuts.Sort();
            // Deduplicate (a repeated face must not emit two coincident slices).
            var slices = new List<(float lo, float hi)>(cuts.Count);
            for (int i = 1; i < cuts.Count; i++) {
                if (cuts[i] - cuts[i - 1] <= 1e-6f) continue;
                slices.Add((cuts[i - 1], cuts[i]));
            }
            if (slices.Count == 0) slices.Add((min.y, max.y));
            for (int s = 0; s < slices.Count; s++) {
                var (lo, hi) = slices[s];
                float minX = -.5f, maxX = .5f;
                if (!glass && housing != null) {
                    for (int i = 0; i < housing.Count; i++) {
                        var box = housing[i];
                        // Only a housing volume that overlaps this slice in **both** height and
                        // depth constrains the run.
                        if (Mathf.Min(hi, box.Max.y) - Mathf.Max(lo, box.Min.y) < 1e-6f) continue;
                        if (Mathf.Min(max.z, box.Max.z) - Mathf.Max(min.z, box.Min.z) < 1e-6f) continue;
                        if (offsetX > 0f) minX = Mathf.Max(minX, box.Max.x);
                        else if (offsetX < 0f) maxX = Mathf.Min(maxX, box.Min.x);
                    }
                }
                // The squared-off corner's free end: keep the fitting inside its own box, then
                // inside the tile, each with the millimetre inset.
                float x0 = Mathf.Clamp(min.x + inset, min.x + inset, max.x - inset);
                float x1 = Mathf.Clamp(max.x - inset, min.x + inset, max.x - inset);
                if (x1 - x0 <= 1e-6f) continue;
                float trimLo = minX + (Mathf.Approximately(minX, -.5f) ? inset : 0f);
                float trimHi = maxX - (Mathf.Approximately(maxX, .5f) ? inset : 0f);
                if (trimHi - trimLo <= 1e-6f) continue;
                x0 = Mathf.Max(x0, trimLo);
                x1 = Mathf.Min(x1, trimHi);
                if (x1 - x0 <= 1e-6f) continue;
                // Across the tile, every face keeps the inset clear of a neighbouring block.
                float z0 = Mathf.Max(min.z, -.5f + inset);
                float z1 = Mathf.Min(max.z, .5f - inset);
                if (z1 - z0 <= 1e-6f) continue;
                var boxCentre = new Vector3((x0 + x1) * .5f, (lo + hi) * .5f, (z0 + z1) * .5f);
                var boxSize = new Vector3(x1 - x0, hi - lo, z1 - z0);
                result.Add((boxCentre, boxSize));
            }
            return result;
        }

        static void AddCut(List<float> cuts, float value, float lo, float hi) {
            if (value <= lo + 1e-6f || value >= hi - 1e-6f) return;
            for (int i = 0; i < cuts.Count; i++) if (Mathf.Abs(cuts[i] - value) <= 1e-6f) return;
            cuts.Add(value);
        }

        /// <summary>
        /// The parent screen's fixed profile, in the parent run's own local frame: the same
        /// boxes `BuildRun` draws, from the same `PsdRunLayout` numbers. Glazing is left out —
        /// it never constrains an opaque return, and the source's profile build skips it.
        /// </summary>
        public static List<Housing> ProfileFromRun(PsdRunLayout layout, bool half) {
            var boxes = new List<Housing>(24);
            if (layout == null) return boxes;
            float len = layout.Length;
            float cx = layout.RunStart + len * .5f;
            float wall = layout.WallOffset;
            const float z0 = 1f;
            void Add(Vector3 centre, Vector3 size) {
                boxes.Add(new Housing {
                    Min = centre - size * .5f,
                    Max = centre + size * .5f,
                });
            }
            // Threshold and foundation: the base the return shares with the run.
            Add(OpeningModuleViews.Local(cx, layout.SillY, z0 - .01f),
                OpeningModuleViews.LocalSize(len, layout.SillDepth, .02f));
            Add(OpeningModuleViews.Local(cx, layout.SillY, z0 - .51f),
                OpeningModuleViews.LocalSize(len, layout.SillDepth, .98f));
            if (!half) {
                Add(OpeningModuleViews.Local(cx, wall, z0 + layout.GlassHeight + OpeningModuleViews.PsdHeaderHeight * .5f),
                    OpeningModuleViews.LocalSize(len, .24f, OpeningModuleViews.PsdHeaderHeight));
                Add(OpeningModuleViews.Local(cx, wall, z0 + OpeningModuleViews.PsdFullHeight - .025f),
                    OpeningModuleViews.LocalSize(len, .28f, .05f));
            } else {
                Add(OpeningModuleViews.Local(cx, wall, z0 + OpeningModuleViews.PsdHalfHeight - .025f),
                    OpeningModuleViews.LocalSize(len, .10f, .05f));
            }
            Add(OpeningModuleViews.Local(cx, wall, z0 + .003f), OpeningModuleViews.LocalSize(len, .03f, .006f));
            // The fixed rails: one at the foot and one under the head (the half screen has a
            // single cap instead, on the same plane).
            if (half) {
                Add(OpeningModuleViews.Local(cx, wall, z0 + OpeningModuleViews.PsdHalfHeight - .05f - .06f),
                    OpeningModuleViews.LocalSize(len, .08f, .12f));
            } else {
                Add(OpeningModuleViews.Local(cx, wall, z0 + .03f), OpeningModuleViews.LocalSize(len, .12f, .06f));
                Add(OpeningModuleViews.Local(cx, wall, z0 + layout.GlassHeight - .03f),
                    OpeningModuleViews.LocalSize(len, .12f, .06f));
            }
            for (int i = 0; i < layout.Posts.Count; i++) {
                Add(OpeningModuleViews.Local(layout.Posts[i], wall, layout.GlassMid),
                    OpeningModuleViews.LocalSize(.08f, layout.FixedFrameDepth, layout.GlassHeight));
            }
            for (int i = 0; i < layout.Pillars.Count; i++) {
                Add(OpeningModuleViews.Local(layout.Pillars[i], wall, layout.GlassMid),
                    OpeningModuleViews.LocalSize(.16f, layout.FixedFrameDepth, layout.GlassHeight));
            }
            return boxes;
        }

        /// <summary>Carry one box through `matrix` and take its axis-aligned bounds.</summary>
        public static Housing Transform(Housing box, Matrix4x4 matrix) {
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            for (int corner = 0; corner < 8; corner++) {
                var point = new Vector3(
                    (corner & 1) == 0 ? box.Min.x : box.Max.x,
                    (corner & 2) == 0 ? box.Min.y : box.Max.y,
                    (corner & 4) == 0 ? box.Min.z : box.Max.z);
                var transformed = matrix.MultiplyPoint3x4(point);
                min = Vector3.Min(min, transformed);
                max = Vector3.Max(max, transformed);
            }
            return new Housing { Min = min, Max = max };
        }
    }
}
