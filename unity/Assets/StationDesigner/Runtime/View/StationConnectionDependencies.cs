using System;
using System.Collections.Generic;
using Metro.Build;

namespace Metro.View {
    /// <summary>
    /// Pure edit-dependency resolver for the fence and tactile join families (plan 16 §2).
    ///
    /// The canvas-edit owner needs to know exactly which module views a document edit (or an
    /// uncommitted drag) invalidates, because a fence panel and a tactile tile are built from
    /// their **neighbours**: adding, removing or moving one piece changes the geometry of the
    /// piece at the other end of the join. This file ports the rules the TypeScript renderer
    /// uses for that answer, from `render/moduleDependencies.ts` (the committed rebuild set:
    /// `equipmentRetainedIds` and its fence-mask branch) and from
    /// `render/scene/systems/GhostSystem.ts` (`setFencePreview`, the drag's narrower neighbour
    /// rule). It is deliberately not wired into an edit handler: it returns IDs and mutates
    /// nothing.
    ///
    /// **Two modes, because the source really has two.**
    /// A committed transaction rebuilds every fence/gate adjacent to a changed fence or gate,
    /// every tactile adjacent to a changed tactile, and every fence whose four-side join mask
    /// moved when a stair/escalator/walkway changed (a landing band can reach a fence several
    /// cells from the ramp record). A drag preview is narrower: `GhostSystem` rebuilds only
    /// **adjacent committed fences** — a doorless 闸机's carried fence half and a tactile tile
    /// are not refreshed until the commit, and a ground noise barrier keeps its own model
    /// because it draws no arms.
    ///
    /// Removed IDs are included in the committed answer so the caller can drop those views.
    /// The TypeScript retained-set analysis only names survivors; the two answers agree on
    /// every ID that still exists.
    /// </summary>
    public static class StationConnectionDependencies {
        /// <summary>Fence, 闸机 and tactile are the families whose models read a join.</summary>
        static readonly HashSet<string> JoinTypes = new HashSet<string>(StringComparer.Ordinal) {
            "fence", "gate", "tactile",
        };

        /// <summary>
        /// The module types `moduleDependencies.ts` knows how to retain. A change it cannot
        /// classify fails closed: the source keeps no model, and neither does this resolver.
        /// </summary>
        static readonly HashSet<string> KnownTypes = new HashSet<string>(StringComparer.Ordinal) {
            "sidewalk", "lawn", "tree", "road", "traffic-light", "bench", "fence", "light", "vent", "bin",
            "extinguisher", "shelf", "desk", "cubicle", "sink", "urinal", "checkout", "booth", "gate",
            "platform-edge", "billboard", "tvm", "vending", "door", "glass", "calligraphy", "linemap",
            "tactile", "floor-mark", "court", "ac-unit", "electrical-cabinet", "pillar", "roof", "exit",
            "guidepost", "busstop", "psd-end", "rail-signal", "shop",
            "track", "stair", "escalator", "walkway", "lift", "hanger", "clock", "cctv", "monitor", "sign", "tv",
        };

        /// <summary>`noiseBarrierVariant` (`sim/noiseBarriers.ts`): the three saved values whose
        /// model ignores the fence arms, so a drag never rebuilds one.</summary>
        static readonly HashSet<string> NoiseBarriers = new HashSet<string>(StringComparer.Ordinal) {
            "bridge-railing", "sound-barrier-half", "sound-barrier",
        };

        static readonly int[,] Steps = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } };

        /// <summary>The committed rebuild set for a before/after document pair.</summary>
        public static IReadOnlyList<string> Affected(StationDocument before, StationDocument after) =>
            Affected(FactsOf(before), FactsOf(after));

        /// <summary>
        /// The committed rebuild set for two module lists: the TypeScript retention analysis is
        /// inverted and restricted to the join families. IDs are returned in the after
        /// document's order, then the removed IDs in the before document's order.
        /// </summary>
        public static IReadOnlyList<string> Affected(IReadOnlyList<ModuleFacts> before, IReadOnlyList<ModuleFacts> after) {
            var affected = new List<string>();
            if (after == null) return affected;
            var previous = new Dictionary<string, ModuleFacts>(StringComparer.Ordinal);
            var order = new List<string>();
            if (before != null) {
                for (int i = 0; i < before.Count; i++) {
                    var module = before[i];
                    if (module == null) continue;
                    var id = module.Id ?? "";
                    if (!previous.ContainsKey(id)) order.Add(id);
                    previous[id] = module;
                }
            }

            // `changedModules`: old and new records in after order, then the removed ones in
            // before order. The source compares whole records, so a move, a turn or a config
            // change all count.
            var changes = new List<ModuleFacts>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < after.Count; i++) {
                var module = after[i];
                if (module == null) continue;
                seen.Add(module.Id ?? "");
                var changed = !previous.TryGetValue(module.Id ?? "", out var old) || !Same(old, module);
                if (!changed) continue;
                if (old != null) changes.Add(old);
                changes.Add(module);
            }
            var removed = new List<ModuleFacts>();
            for (int i = 0; i < order.Count; i++) {
                if (seen.Contains(order[i])) continue;
                removed.Add(previous[order[i]]);
            }
            changes.AddRange(removed);

            // A change the source cannot classify keeps no model (fail closed); a join-family
            // caller can then only rebuild every join view it owns.
            for (int i = 0; i < changes.Count; i++) {
                if (KnownTypes.Contains(changes[i].Type ?? "")) continue;
                for (int j = 0; j < after.Count; j++) {
                    if (IsJoin(after[j])) affected.Add(after[j].Id);
                }
                for (int j = 0; j < removed.Count; j++) {
                    if (IsJoin(removed[j])) affected.Add(removed[j].Id);
                }
                return affected;
            }

            bool rampChanged = false;
            for (int i = 0; i < changes.Count; i++) if (IsRamp(changes[i])) { rampChanged = true; break; }
            StationFenceConnections beforeIndex = rampChanged ? StationFenceConnections.For(before) : null;
            StationFenceConnections afterIndex = rampChanged ? StationFenceConnections.For(after) : null;

            for (int i = 0; i < after.Count; i++) {
                var module = after[i];
                if (!IsJoin(module)) continue;
                bool unchanged = previous.TryGetValue(module.Id ?? "", out var old) && Same(old, module);
                bool rebuild = !unchanged;
                if (!rebuild) {
                    if (string.Equals(module.Type, "tactile", StringComparison.Ordinal)) {
                        rebuild = AnyAdjacent(changes, module, "tactile");
                    } else {
                        rebuild = AnyAdjacent(changes, module, "fence") || AnyAdjacent(changes, module, "gate");
                        // A ramp edit can move a landing under a fence several cells from the
                        // ramp record, so the source compares the fence's own four sides.
                        if (!rebuild && rampChanged && string.Equals(module.Type, "fence", StringComparison.Ordinal))
                            rebuild = JoinMaskChanged(beforeIndex, afterIndex, module);
                    }
                }
                if (rebuild) affected.Add(module.Id);
            }
            for (int i = 0; i < removed.Count; i++) {
                if (IsJoin(removed[i])) affected.Add(removed[i].Id);
            }
            return affected;
        }

        /// <summary>
        /// The drag-preview rebuild set (`GhostSystem.setFencePreview`): the dragged candidates
        /// themselves, plus every committed fence adjacent to one of their cells. Gates,
        /// tactile tiles and rail landings are not rebuilt by a fence drag, and a ground noise
        /// barrier keeps its own model.
        /// </summary>
        public static IReadOnlyList<string> Preview(IReadOnlyList<ModuleFacts> station, IReadOnlyList<ModuleFacts> candidates) {
            var affected = new List<string>();
            if (candidates == null || candidates.Count == 0) return affected;
            var index = StationFenceConnections.For(station);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < candidates.Count; i++) Add(affected, seen, candidates[i]?.Id);
            for (int i = 0; i < candidates.Count; i++) {
                var candidate = candidates[i];
                if (candidate == null) continue;
                for (int step = 0; step < Steps.GetLength(0); step++) {
                    var fences = index.FencesAt(candidate.X + Steps[step, 0], candidate.Y + Steps[step, 1], candidate.Z);
                    for (int f = 0; f < fences.Count; f++) {
                        var fence = fences[f];
                        if (fence == null || NoiseBarriers.Contains(fence.Config.Text("variant"))) continue;
                        Add(affected, seen, fence.Id);
                    }
                }
            }
            return affected;
        }

        /// <summary>The same preview answer for a document plus uncommitted candidates.</summary>
        public static IReadOnlyList<string> Preview(StationDocument station, IReadOnlyList<ModuleFacts> candidates) =>
            Preview(FactsOf(station), candidates);

        static void Add(List<string> ids, HashSet<string> seen, string id) {
            if (string.IsNullOrEmpty(id) || !seen.Add(id)) return;
            ids.Add(id);
        }

        static bool IsJoin(ModuleFacts module) => module != null && JoinTypes.Contains(module.Type ?? "");

        static bool IsRamp(ModuleFacts module) {
            if (module == null) return false;
            var type = module.Type ?? "";
            if (string.Equals(type, "stair", StringComparison.Ordinal)) return !module.Config.Bool("block");
            return string.Equals(type, "escalator", StringComparison.Ordinal) ||
                   string.Equals(type, "walkway", StringComparison.Ordinal);
        }

        /// <summary>`adjacent`: the same storey and a Manhattan cell distance of at most one.</summary>
        static bool Adjacent(ModuleFacts a, ModuleFacts b) =>
            a != null && b != null && a.Z == b.Z && Math.Abs(a.X - b.X) + Math.Abs(a.Y - b.Y) <= 1;

        static bool AnyAdjacent(List<ModuleFacts> changes, ModuleFacts module, string type) {
            for (int i = 0; i < changes.Count; i++) {
                var change = changes[i];
                if (change == null || !string.Equals(change.Type, type, StringComparison.Ordinal)) continue;
                if (Adjacent(change, module)) return true;
            }
            return false;
        }

        static bool JoinMaskChanged(StationFenceConnections before, StationFenceConnections after, ModuleFacts fence) {
            if (before == null || after == null) return false;
            for (int step = 0; step < Steps.GetLength(0); step++) {
                int dx = Steps[step, 0], dy = Steps[step, 1];
                // The index reads the step from the neighbour back to the fence.
                if (before.Connects(fence.X + dx, fence.Y + dy, fence.Z, -dx, -dy) !=
                    after.Connects(fence.X + dx, fence.Y + dy, fence.Z, -dx, -dy)) return true;
            }
            return false;
        }

        /// <summary>
        /// `equal` (`moduleDependencies.ts`) for the facts a view reads: a join builder never
        /// sees a room's authored height, so this comparison is narrower than the source's JSON
        /// equality and can only invalidate less, never a module whose join facts are unchanged.
        /// </summary>
        static bool Same(ModuleFacts a, ModuleFacts b) {
            if (ReferenceEquals(a, b)) return true;
            if (a == null || b == null) return false;
            if (!string.Equals(a.Id, b.Id, StringComparison.Ordinal) ||
                !string.Equals(a.Type, b.Type, StringComparison.Ordinal) ||
                a.X != b.X || a.Y != b.Y || a.Z != b.Z ||
                a.Rotation != b.Rotation || a.Width != b.Width || a.Depth != b.Depth ||
                a.CeilingAnchored != b.CeilingAnchored) return false;
            if (a.From.HasValue != b.From.HasValue || a.To.HasValue != b.To.HasValue) return false;
            if (a.From.HasValue && (a.From.X != b.From.X || a.From.Y != b.From.Y || a.From.Z != b.From.Z)) return false;
            if (a.To.HasValue && (a.To.X != b.To.X || a.To.Y != b.To.Y || a.To.Z != b.To.Z)) return false;
            var left = a.Config ?? ModuleConfig.Empty;
            var right = b.Config ?? ModuleConfig.Empty;
            if (left.Count != right.Count) return false;
            foreach (var key in left.Keys) {
                if (!right.Has(key)) return false;
                if (!string.Equals(left.Text(key), right.Text(key), StringComparison.Ordinal)) return false;
            }
            return true;
        }

        static ModuleFacts[] FactsOf(StationDocument document) {
            if (document == null || document.Modules.Count == 0) return Array.Empty<ModuleFacts>();
            var facts = new List<ModuleFacts>(document.Modules.Count);
            for (int i = 0; i < document.Modules.Count; i++) {
                var record = document.Modules[i];
                if (record?.Facts != null) facts.Add(record.Facts);
            }
            return facts.ToArray();
        }
    }
}
