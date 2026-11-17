using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// The 屋顶's truss and canopy variants (`sim/structures.ts`): the truss shell stands on a
    /// supporting storey whose slab top is local 0, with its base at 5 m, its eave at 9 m and
    /// its top at 10 m; the canopy shares that shell lowered one storey onto round posts. Only
    /// the heights and the post rows are ported  the ridge profile the renderer draws is view
    /// work, not a placement rule.
    /// </summary>
    public static class StationRoofRules {
        /// <summary>The catalogue bay: four cells along the run.</summary>
        public const int Bay = 4;
        /// <summary>Heights above the supporting storey's slab top, in metres.</summary>
        public const double Base = 5;
        public const double Height = 5;
        public const double Eave = 9;
        public const double Skin = 0.12;
        public const double Drop = 5;

        /// <summary>`supportedRoofWidth`: the three catalogue bay depths, 4 by default.</summary>
        public static int SupportedWidth(int width) => width == 8 || width == 12 ? width : 4;

        /// <summary>`trussRoofTop`: the shell's top surface above the slab, 10 m.</summary>
        public static double Top => Base + Height;

        public static bool IsVariant(string variant) =>
            string.Equals(variant, "shell", StringComparison.Ordinal) ||
            string.Equals(variant, "truss", StringComparison.Ordinal) ||
            string.Equals(variant, "tapered-truss", StringComparison.Ordinal) ||
            string.Equals(variant, "canopy", StringComparison.Ordinal);

        /// <summary>`canopyPostRows`: the two post rows, inset a quarter of the depth.</summary>
        public static (int Low, int High) PostRows(int depth) {
            int inset = (int)Math.Round(depth / 4.0 - 1);
            return (inset, depth - 1 - inset);
        }

        /// <summary>`canopyPostCells`: every post's plan cell, turned with the piece.</summary>
        public static List<StationCellKey> PostCells(StationModuleRecord m) {
            var cells = new List<StationCellKey>();
            if (m == null) return cells;
            int depth = Math.Max(1, m.Depth);
            int width = Math.Max(1, m.Width);
            var rows = PostRows(depth);
            foreach (var row in new[] { rows.Low, rows.High }) {
                for (int x = 0; x < width; x++) {
                    StationFootprints.RotateLocal(m.Rotation, x, row, out var dx, out var dy);
                    cells.Add(new StationCellKey(m.X + (int)Math.Round(dx), m.Y + (int)Math.Round(dy), m.Z));
                }
            }
            return cells;
        }

        /// <summary>
        /// The canopy's reservation (`canopyBodyBoxes`' union): every post's column and the slab
        /// it carries. The per-box split is the view's; the placement reserves the whole body
        /// from the ground under the posts to the slab's top.
        /// </summary>
        public static bool TryCanopyBody(StationModuleRecord m, out StationBox box) {
            box = default;
            if (m == null) return false;
            var cells = StationFootprints.TrackCells(m);
            if (cells.Length == 0 || PostCells(m).Count == 0) return false;
            var footprint = StationBox.FromCells(cells, m.Z + 1, m.Z + 1);
            box = new StationBox(footprint.X0, footprint.Y0, m.Z + 1, footprint.X1, footprint.Y1,
                m.Z + 1 + Top - Drop);
            return true;
        }
    }
}
