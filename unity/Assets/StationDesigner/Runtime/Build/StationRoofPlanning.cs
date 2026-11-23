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
        /// <summary>Round canopy post radius, metres (`CANOPY_POST_RADIUS`).</summary>
        public const double PostRadius = 0.09;

        /// <summary>`supportedRoofWidth`: the three catalogue bay depths, 4 by default.</summary>
        public static int SupportedWidth(int width) => width == 8 || width == 12 ? width : 4;

        /// <summary>`trussRoofRidge`: the shell's ridge underside below the skin, 9.88 m.</summary>
        public static double Ridge => Base + Height - Skin;

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
        /// The canopy's multi-box physical collision volumes (`canopyBodyBoxes`): one slender
        /// column per round post plus the lowered overhead roof shell, keeping the sheltered ground
        /// aisle between the post rows open.
        /// </summary>
        public static List<StationBox> CanopyBodyBoxes(StationModuleRecord m) {
            var boxes = new List<StationBox>();
            if (m == null) return boxes;
            var cells = StationFootprints.TrackCells(m);
            if (cells.Length == 0) return boxes;
            int depth = Math.Max(1, m.Depth);
            int width = Math.Max(1, m.Width);
            var rows = PostRows(depth);
            foreach (var row in new[] { rows.Low, rows.High }) {
                double height = Ridge - (Ridge - Eave) * Math.Abs(row - (depth - 1) / 2.0) / (depth / 2.0) - Drop - 0.1;
                for (int x = 0; x < width; x++) {
                    StationFootprints.RotateLocal(m.Rotation, x, row, out var rx, out var ry);
                    boxes.Add(new StationBox(
                        m.X + 0.5 + rx - PostRadius, m.Y + 0.5 + ry - PostRadius, m.Z + 1,
                        m.X + 0.5 + rx + PostRadius, m.Y + 0.5 + ry + PostRadius, m.Z + 1 + height));
                }
            }
            var footprint = StationBox.FromCells(cells, m.Z + 1, m.Z + 1);
            boxes.Add(new StationBox(
                footprint.X0, footprint.Y0, m.Z + 1 + Eave - Drop - 0.2,
                footprint.X1, footprint.Y1, m.Z + 1 + Top - Drop));
            return boxes;
        }

        /// <summary>
        /// The canopy's reservation (`canopyBodyBoxes`' union): every post's column and the slab
        /// it carries. The per-box split is exposed via <see cref="CanopyBodyBoxes"/>; the coarse
        /// clearance box preserves the full vertical span from floor top to lowered ridge.
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
