using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// The steel hanger's body (`sim/hangers.ts` `hangerBoxes`): the bar at the top of the run,
    /// plus the post and its foot for a post-mounted hanger. Its boxes are what a block brush
    /// must not pour into and what another piece must not share, so the port carries them as
    /// real geometry rather than reporting the family unverified.
    ///
    /// The bar top is 4 m on a roof-mounted hanger and 3 m on a post-mounted one; the beam is
    /// 0.2 m deep, and a post is 0.18 m square, set 0.17 m to the run's local +y.
    /// </summary>
    public static class StationHangerRules {
        public const double BarTopRoof = 4;
        public const double BarTopPost = 3;
        public const double BarDepth = 0.2;
        public const double PostWidth = 0.18;
        public const double PostOffset = 0.17;

        /// <summary>True for the piece's own type id.</summary>
        public static bool IsHanger(string type) => string.Equals(type, "hanger", StringComparison.Ordinal);

        /// <summary>
        /// `hangerBoxes`: the bar, then — for a post mount — the post and its foot. The bar is
        /// centred on the run (`local (w − 1) / 2`), its long axis following the turn.
        /// </summary>
        public static List<StationBox> Boxes(StationModuleRecord m) {
            var boxes = new List<StationBox>(3);
            if (m == null || !IsHanger(m.Type)) return boxes;
            int w = Math.Max(1, m.Width);
            bool post = string.Equals(m.Config.Text("mount"), "post", StringComparison.Ordinal);
            double barTop = post ? BarTopPost : BarTopRoof;
            StationFootprints.RotateLocal(m.Rotation, (w - 1) / 2.0, 0, out var dx, out var dy);
            double cx = m.X + 0.5 + dx;
            double cy = m.Y + 0.5 + dy;
            bool sideways = Math.Abs(StationFootprints.NormRot(m.Rotation) % 2) == 1;
            double halfX = (sideways ? BarDepth : w) / 2;
            double halfY = (sideways ? w : BarDepth) / 2;
            double top = m.Z + 1 + barTop;
            boxes.Add(new StationBox(cx - halfX, cy - halfY, top - BarDepth, cx + halfX, cy + halfY, top));
            if (post) {
                double half = PostWidth / 2;
                StationFootprints.RotateLocal(m.Rotation, 0, PostOffset, out var px, out var py);
                boxes.Add(new StationBox(cx + px - half, cy + py - half, m.Z + 1, cx + px + half, cy + py + half, top));
                boxes.Add(new StationBox(cx + px - 0.18, cy + py - 0.18, m.Z + 1, cx + px + 0.18, cy + py + 0.18, m.Z + 1.05));
            }
            return boxes;
        }

        /// <summary>The union of the hanger's boxes — the single volume `rawModuleEnvelope` reports.</summary>
        public static bool TryBox(StationModuleRecord m, out StationBox box) {
            box = default;
            var boxes = Boxes(m);
            if (boxes.Count == 0) return false;
            double x0 = double.PositiveInfinity, y0 = double.PositiveInfinity, z0 = double.PositiveInfinity;
            double x1 = double.NegativeInfinity, y1 = double.NegativeInfinity, z1 = double.NegativeInfinity;
            foreach (var b in boxes) {
                if (b.X0 < x0) x0 = b.X0;
                if (b.Y0 < y0) y0 = b.Y0;
                if (b.Z0 < z0) z0 = b.Z0;
                if (b.X1 > x1) x1 = b.X1;
                if (b.Y1 > y1) y1 = b.Y1;
                if (b.Z1 > z1) z1 = b.Z1;
            }
            box = new StationBox(x0, y0, z0, x1, y1, z1);
            return true;
        }

        /// <summary>
        /// Port of <c>sim/hangers.ts:hangerRoofZ</c>: nearest solid cell or roof surface at or
        /// above the beam top (<c>m.Z + 1 + BarTopRoof</c>) at one suspension point <c>(x, y)</c>.
        /// </summary>
        public static bool TryRoofZ(StationIndex index, StationModuleRecord m, int x, int y, out double backing,
            string excludeId = null) {
            backing = 0;
            if (index == null || m == null) return false;
            double barTop = m.Z + 1 + BarTopRoof;
            bool found = false;
            var cells = index.Document.Cells;
            for (int i = 0; i < cells.Count; i++) {
                var cell = cells[i];
                if (cell == null || !cell.IsSolid || cell.X != x || cell.Y != y || cell.Z < barTop) continue;
                if (!found || cell.Z < backing) {
                    backing = cell.Z;
                    found = true;
                }
            }
            var roofs = index.ModulesOfType("roof");
            for (int i = 0; i < roofs.Count; i++) {
                var roof = roofs[i];
                if (roof == null || (!string.IsNullOrEmpty(excludeId) && string.Equals(roof.Id, excludeId, StringComparison.Ordinal))) continue;
                var trackCells = StationFootprints.TrackCells(roof);
                bool covers = false;
                for (int c = 0; c < trackCells.Length; c++) {
                    if (trackCells[c].X == x && trackCells[c].Y == y) { covers = true; break; }
                }
                if (!covers) continue;
                StationFootprints.RotateLocal(-roof.Rotation, x - roof.X, y - roof.Y, out _, out double localY);
                int depth = Math.Max(1, roof.Depth);
                double ridge = StationRoofRules.Ridge;
                double height = ridge - (ridge - StationRoofRules.Eave) * Math.Abs(localY - (depth - 1) / 2.0) / (depth / 2.0);
                string variant = roof.Config.Text("variant");
                double z = string.IsNullOrEmpty(variant)
                    ? roof.Z + 1 + StationRoofRules.Base
                    : roof.Z + 1 + height - (string.Equals(variant, "canopy", StringComparison.Ordinal) ? StationRoofRules.Drop : 0);
                if (z >= barTop && (!found || z < backing)) {
                    backing = z;
                    found = true;
                }
            }
            return found;
        }

        /// <summary>
        /// Port of <c>sim/hangers.ts:hangerRoofMissing</c>: post hangers stand on the floor;
        /// roof hangers need solid slab or roof backing at or above <c>m.Z + 5</c> at both ends.
        /// </summary>
        public static bool RoofMissing(StationIndex index, StationModuleRecord m, string excludeId = null) {
            if (m == null) return false;
            if (string.Equals(m.Config.Text("mount"), "post", StringComparison.Ordinal)) return false;
            int width = Math.Max(1, m.Width);
            if (!TryRoofZ(index, m, m.X, m.Y, out _, excludeId)) return true;
            if (width > 1) {
                StationFootprints.RotateLocal(m.Rotation, width - 1, 0, out double dx, out double dy);
                int endX = m.X + (int)Math.Round(dx);
                int endY = m.Y + (int)Math.Round(dy);
                if (!TryRoofZ(index, m, endX, endY, out _, excludeId)) return true;
            }
            return false;
        }
    }
}
