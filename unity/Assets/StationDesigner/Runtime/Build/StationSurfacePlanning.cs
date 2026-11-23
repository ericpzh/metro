using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// The 人行道 / 草坪 outdoor-surface rules (plan 27 §5): one tile per cell, the two finishes
    /// share the slot, and a tile needs solid floor under it with its own course free above.
    /// Ported from `sim/placement.ts`'s `equipmentReason` outdoor branch and
    /// `build/model/OutdoorSurfaces.ts`'s replacement rule.
    /// </summary>
    public static class StationSurfaceRules {
        /// <summary>The two surface families a tile brush lays (`isOutdoorSurface`).</summary>
        public static bool IsSurface(string type) =>
            string.Equals(type, "sidewalk", StringComparison.Ordinal) ||
            string.Equals(type, "lawn", StringComparison.Ordinal);

        /// <summary>Stable refusal codes the tile brush publishes.</summary>
        public static string Code(StationSurfaceRefusal refusal) => refusal switch {
            StationSurfaceRefusal.BelowGround => "outdoor-below-ground",
            StationSurfaceRefusal.Opening => "opening",
            StationSurfaceRefusal.Occupied => "occupied",
            StationSurfaceRefusal.Floor => "floor",
            StationSurfaceRefusal.Track => "track",
            _ => "",
        };
    }

    /// <summary>Why one tile refuses — the port of the outdoor branch's return codes.</summary>
    public enum StationSurfaceRefusal {
        None = 0,
        /// <summary>A tile may not be laid below the street plane.</summary>
        BelowGround = 1,
        /// <summary>A reserved opening: a ramp corridor or an exit plate.</summary>
        Opening = 2,
        /// <summary>The course above the tile is solid, or the same finish is already there.</summary>
        Occupied = 3,
        /// <summary>No floor under the tile (no authored solid, street or exit floor).</summary>
        Floor = 4,
        /// <summary>A rail's dug bed owns the cell.</summary>
        Track = 5,
    }

    /// <summary>
    /// One tile gesture's verdict: the cells it paves (or unpaves), the cells it refuses and
    /// why, and the module writes it would make. A plan never writes.
    /// </summary>
    public sealed class StationSurfacePlan {
        public string Type = "";
        public bool Erase;
        public readonly List<StationCellKey> Accepted = new List<StationCellKey>();
        public readonly List<StationCellKey> Refused = new List<StationCellKey>();
        /// <summary>Cells the drag covered that already read that way (neither added nor refused).</summary>
        public readonly List<StationCellKey> Skipped = new List<StationCellKey>();
        public readonly List<StationEditDraft> Adds = new List<StationEditDraft>();
        public readonly List<string> RemoveModuleIds = new List<string>();
        /// <summary>The first refusal's code, for a notice line.</summary>
        public string Reason = "";

        public bool HasWork => Adds.Count > 0 || RemoveModuleIds.Count > 0;

        public StationCellPatch ToPatch() {
            var patch = new StationCellPatch();
            foreach (var draft in Adds) patch.AddModule(draft);
            foreach (var id in RemoveModuleIds) if (!patch.RemoveModuleIds.Contains(id)) patch.RemoveModuleIds.Add(id);
            return patch;
        }
    }

    /// <summary>
    /// The 人行道 / 草坪 planner behind the tile brushes: a port of `editOutdoorSurfaces` — one
    /// finish per tile, the other kind laid on a tile **replaces** it (only once the new tile is
    /// accepted), the same kind is an "already here" no-op, and an erase takes only its own kind.
    /// </summary>
    public static class StationSurfacePlanner {
        /// <summary>The shared 10,000-cell budget every rectangular drag respects (plan 27 §3).</summary>
        public const int MaxCells = StationCellPlanner.MaxDragCells;

        /// <summary>Every surface tile's finish at one coordinate, or "" when the cell has none.</summary>
        public static string SurfaceAt(StationIndex index, int x, int y, int z) {
            if (index == null) return "";
            foreach (var module in index.Document.Modules) {
                if (module == null || !StationSurfaceRules.IsSurface(module.Type)) continue;
                if (module.X != x || module.Y != y || module.Z != z) continue;
                return module.Type;
            }
            return "";
        }

        /// <summary>The surface module at one coordinate (for an erase pick), or null.</summary>
        public static StationModuleRecord ModuleAt(StationIndex index, int x, int y, int z) {
            if (index == null) return null;
            foreach (var module in index.Document.Modules) {
                if (module == null || !StationSurfaceRules.IsSurface(module.Type)) continue;
                if (module.X != x || module.Y != y || module.Z != z) continue;
                return module;
            }
            return null;
        }

        /// <summary>
        /// Plan one tile rectangle (or a single cell) of the armed finish. The acceptance rules
        /// are the outdoor branch's: nothing below grade, no reserved opening, a free course
        /// above, real floor under it, no track bed — and never two finishes on one tile.
        /// </summary>
        public static StationSurfacePlan Plan(StationIndex index, StationCellEditWorld world,
            IReadOnlyList<StationCellKey> cells, string type, int rotation, bool remove, string idPrefix = null) {
            var plan = new StationSurfacePlan { Type = type ?? "", Erase = remove };
            if (index == null || world == null) { plan.Reason = "no-document"; return plan; }
            if (!StationSurfaceRules.IsSurface(type)) { plan.Reason = "unsupported-surface"; return plan; }
            if (cells == null) return plan;
            if (cells.Count > MaxCells) {
                var unique = new HashSet<StationCellKey>();
                foreach (var cell in cells) if (unique.Add(cell)) plan.Refused.Add(cell);
                if (plan.Refused.Count > MaxCells) {
                    plan.Reason = "over-limit";
                    return plan;
                }
                plan.Refused.Clear();
            }
            // Index the existing tiles once: a drag may cover thousands of cells.
            var held = new Dictionary<StationCellKey, StationModuleRecord>();
            foreach (var module in index.Document.Modules) {
                if (module == null || !StationSurfaceRules.IsSurface(module.Type)) continue;
                var key = new StationCellKey(module.X, module.Y, module.Z);
                if (!held.ContainsKey(key)) held[key] = module;
            }
            var seen = new HashSet<StationCellKey>();
            int serial = index.Document.ModuleCount + 1;
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var module in index.Document.Modules) if (module != null) ids.Add(module.Id);
            foreach (var cell in cells) {
                if (!seen.Add(cell)) continue;
                held.TryGetValue(cell, out var existing);
                if (remove) {
                    if (existing != null && string.Equals(existing.Type, plan.Type, StringComparison.Ordinal)) {
                        plan.Accepted.Add(cell);
                        plan.RemoveModuleIds.Add(existing.Id);
                    } else {
                        plan.Skipped.Add(cell);
                    }
                    continue;
                }
                if (existing != null && string.Equals(existing.Type, plan.Type, StringComparison.Ordinal)) {
                    plan.Skipped.Add(cell);
                    continue;
                }
                var refusal = Check(world, cell);
                if (refusal != StationSurfaceRefusal.None) {
                    plan.Refused.Add(cell);
                    if (plan.Reason.Length == 0) plan.Reason = StationSurfaceRules.Code(refusal);
                    continue;
                }
                string id;
                do { id = (idPrefix ?? plan.Type) + "-" + serial++; } while (ids.Contains(id));
                ids.Add(id);
                var draft = new StationEditDraft {
                    Id = id,
                    Type = plan.Type,
                    X = cell.X,
                    Y = cell.Y,
                    Z = cell.Z,
                    Rotation = StationFootprints.NormRot(rotation),
                };
                plan.Adds.Add(draft);
                plan.Accepted.Add(cell);
                // One finish per tile: the other kind is replaced, and only now that this one is in.
                if (existing != null) plan.RemoveModuleIds.Add(existing.Id);
            }
            return plan;
        }

        /// <summary>The outdoor branch of `equipmentReason`, in the source's own order.</summary>
        static StationSurfaceRefusal Check(StationCellEditWorld world, StationCellKey cell) {
            if (cell.Z < 0) return StationSurfaceRefusal.BelowGround;
            if (world.IsOpening(cell.X, cell.Y, cell.Z)) return StationSurfaceRefusal.Opening;
            if (world.IsSolid(cell.X, cell.Y, cell.Z + 1)) return StationSurfaceRefusal.Occupied;
            bool floor = world.IsSolid(cell.X, cell.Y, cell.Z) ||
                         world.IsGround(cell.X, cell.Y, cell.Z) ||
                         world.IsExitFloor(cell.X, cell.Y, cell.Z);
            if (!floor) return StationSurfaceRefusal.Floor;
            if (world.IsTrackCell(cell.X, cell.Y, cell.Z)) return StationSurfaceRefusal.Track;
            return StationSurfaceRefusal.None;
        }
    }
}
