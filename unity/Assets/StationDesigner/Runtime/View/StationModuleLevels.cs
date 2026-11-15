using System;
using System.Collections.Generic;
using Metro.Build;
using UnityEngine;

namespace Metro.View {
    /// <summary>
    /// The **storey bands** one saved module occupies, the port of
    /// <c>render/scene/systems/SceneSystem.ts:moduleLevels</c>. Every entry is a band
    /// (<see cref="StationLevelGrid.Band"/> of a height), never a raw metre: a module's
    /// <c>z</c> is the floor it hangs from, so a wall panel anchored at one metre below
    /// the next slab must still read as the storey it is drawn on (RCA 14 §1).
    ///
    /// This is deliberately a *membership* answer. The module's world box stays the
    /// separate input used for section clipping and picking; reading it here was the
    /// defect that hid glass and PSD covers on the active floor.
    /// </summary>
    public static class StationModuleLevels {
        /// <summary>The artwork families the source slices by their visible panel (moduleLevels).</summary>
        static readonly HashSet<string> WallArtwork = new HashSet<string>(StringComparer.Ordinal) {
            "sign", "billboard", "calligraphy", "linemap", "glass", "monitor",
        };

        /// <summary>The source bands for one module, ascending and distinct.</summary>
        public static int[] Of(StationModuleRecord module, StationLevelGrid grid) {
            if (module == null) return Array.Empty<int>();
            // Wall artwork can have an anchor below its visible panel. Slice it by the
            // pointed panel height, so a low-mounted board does not disappear into the
            // floor below and a two-metre pane belongs to the storey its glazing is on.
            if (WallArtwork.Contains(module.Type) && StationFootprints.IsWallMounted(module) &&
                StationFootprints.TryClearance(module, out var box, out _) && box.Z1 > box.Z0) {
                return new[] { Band(grid, (box.Z0 + box.Z1) * .5) };
            }
            switch (module.Type) {
                case "pillar": {
                    // A full-height column owns one band per storey it rises through.
                    int height = Math.Max(0, module.Config.Int("height", 0));
                    if (height <= 0) return new[] { Band(grid, module.Z) };
                    int step = grid.StoreyHeight > 0 ? grid.StoreyHeight : StationLevelGrid.LadderStep;
                    var levels = new List<int>();
                    for (int z = module.Z; z < module.Z + height; z += step) levels.Add(Band(grid, z));
                    return Collapse(levels);
                }
                case "escalator":
                case "walkway":
                case "lift":
                case "stair": {
                    // A run keeps both of its ends; a one-storey run collapses to one band
                    // rather than repeating it. A block stair sits on its own floor.
                    if (module.Type == "stair" && module.Config.Bool("block")) return new[] { Band(grid, module.Z) };
                    if (!module.From.HasValue || !module.To.HasValue) return new[] { Band(grid, module.Z) };
                    return Collapse(new List<int> {
                        Band(grid, module.From.Value.Z), Band(grid, module.To.Value.Z),
                    });
                }
                default:
                    // Ordinary module: the storey of the floor it is anchored to. The
                    // promoted roof plate heights are not ported by packet A, so a roof
                    // also answers with its anchor storey instead of a guessed span.
                    return new[] { Band(grid, module.Z) };
            }
        }

        /// <summary>
        /// The same membership rule for a bare <see cref="ModuleFacts"/>, which is what the
        /// family renderers are handed (RCA 15 §1). The wall-artwork branch needs the
        /// clearance box, and that box is only built from the saved record
        /// (<see cref="StationFootprints.TryClearance"/>), so a facts-only caller falls
        /// through to the anchor band — which is every hung fixture's answer anyway.
        /// </summary>
        public static int[] Of(ModuleFacts module, StationLevelGrid grid) {
            if (module == null) return Array.Empty<int>();
            switch (module.Type) {
                case "pillar": {
                    int height = Math.Max(0, module.Config.Int("height", 0));
                    if (height <= 0) return new[] { Band(grid, module.Z) };
                    int step = grid.StoreyHeight > 0 ? grid.StoreyHeight : StationLevelGrid.LadderStep;
                    var levels = new List<int>();
                    for (int z = module.Z; z < module.Z + height; z += step) levels.Add(Band(grid, z));
                    return Collapse(levels);
                }
                case "escalator":
                case "walkway":
                case "lift":
                case "stair": {
                    if (module.Type == "stair" && module.Config.Bool("block")) return new[] { Band(grid, module.Z) };
                    if (!module.From.HasValue || !module.To.HasValue) return new[] { Band(grid, module.Z) };
                    return Collapse(new List<int> { Band(grid, module.From.Z), Band(grid, module.To.Z) });
                }
                default:
                    return new[] { Band(grid, module.Z) };
            }
        }

        /// <summary>
        /// The storey band a raw elevation belongs to (`sim/constants.ts:storeyBand`, which slices
        /// by the fixed 5 m band step anchored at <see cref="StationLevelGrid.LevelBase"/> just as
        /// <see cref="StationCellMesher"/> does).
        /// </summary>
        public static int Band(StationLevelGrid grid, double z) => StationCoordinates.StoreyBand(z, grid.LevelBase);

        /// <summary>Sort and de-duplicate a band list.</summary>
        public static int[] Collapse(IEnumerable<int> levels) {
            if (levels == null) return Array.Empty<int>();
            var seen = new SortedSet<int>();
            foreach (int level in levels) seen.Add(level);
            var result = new int[seen.Count];
            seen.CopyTo(result);
            return result;
        }
    }
}
