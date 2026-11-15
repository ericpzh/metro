using System;
using System.Collections.Generic;
using Metro.Build;

namespace Metro.View {
    /// <summary>
    /// Port of `render/platformBlockInsets.ts`: a platform-edge cell's track-facing strip
    /// belongs to the PSD base, so the floor block stops behind it instead of running
    /// under the sill.
    ///
    /// The source owns that strip through the **whole floor block**:
    /// `edge = 0.5 + PSD_WALL_OFFSET − PSD_BASE_DEPTH / 2` is the cell-local line the
    /// plinth starts at, and the inset narrows the top/body on the side the track lies.
    /// With Zoo's numbers `edge = 0.75`, so the last 0.25 m (cell-local) of the platform
    /// cell is cut away and the source's `psd-threshold` (0.29 m deep) plus its concrete
    /// foundation show there. Without the cut the cell's finish top is coplanar with the
    /// threshold's top and z-fights it, while the foundation is buried inside the block.
    ///
    /// The mesher already consumes `StationCellMeshInput.Insets`; this file is the one
    /// derivation of that mask from the committed module records.
    /// </summary>
    public static class StationPlatformInsets {
        /// <summary>`sim/constants.ts:PSD_WALL_OFFSET`.</summary>
        public const double WallOffset = .34;
        /// <summary>`sim/constants.ts:PSD_BASE_DEPTH`.</summary>
        public const double BaseDepth = .18;
        /// <summary>`platformBlockInsets.ts:edge = 0.5 + PSD_WALL_OFFSET − PSD_BASE_DEPTH / 2`.</summary>
        public const double Edge = StationRailGeometry.CellEdge;
        /// <summary>How much of the cell the PSD base owns on its track side (`1 − edge`).</summary>
        public const double Cut = 1 - Edge;

        /// <summary>
        /// One inset per platform-edge cell of the document (the source's `edgeCells`
        /// loop). Every edge with a screen owns its run; a `psd: none` edge owns nothing.
        /// Several edges over one cell narrow the same inset, exactly as the source's
        /// repeated `min`/`max` does.
        /// </summary>
        public static Dictionary<StationCellKey, StationCellInset> For(IReadOnlyList<StationModuleRecord> modules) {
            var result = new Dictionary<StationCellKey, StationCellInset>();
            if (modules == null) return result;
            for (int m = 0; m < modules.Count; m++) {
                var module = modules[m];
                if (module == null || !string.Equals(module.Type, "platform-edge", StringComparison.Ordinal)) continue;
                if (string.Equals(module.Config.Text("psd"), "none", StringComparison.Ordinal)) continue;
                int toward = string.Equals(module.Config.Text("side"), "right", StringComparison.Ordinal) ? 1 : -1;
                // `rotateLocal(mod.rot, 0, side === 'right' ? 1 : -1)`: the track side.
                StationFootprints.RotateLocal(module.Rotation, 0, toward, out var dx, out var dy);
                int width = module.Width > 0 ? module.Width : 1;
                for (int i = 0; i < width; i++) {
                    StationFootprints.RotateLocal(module.Rotation, i, 0, out var ox, out var oy);
                    var key = new StationCellKey(module.X + (int)Math.Round(ox), module.Y + (int)Math.Round(oy), module.Z);
                    var inset = result.TryGetValue(key, out var found) ? found : StationCellInset.Full;
                    double x0 = inset.X0, x1 = inset.X1, y0 = inset.Y0, y1 = inset.Y1;
                    if (dx > 0) x1 = Math.Min(x1, Edge);
                    else if (dx < 0) x0 = Math.Max(x0, 1 - Edge);
                    if (dy > 0) y1 = Math.Min(y1, Edge);
                    else if (dy < 0) y0 = Math.Max(y0, 1 - Edge);
                    result[key] = new StationCellInset(x0, x1, y0, y1);
                }
            }
            return result;
        }
    }
}
