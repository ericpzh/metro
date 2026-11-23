using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// The 支柱 (support pillar) planner (plan 28 §3): a port of `sim/structures.ts`'s
    /// `pillarAt` / `extendedPillar` / `PILLAR_LENGTHS` and the press that grows an existing
    /// post by one armed section. A pillar is one record whose `cfg.height` is its whole shaft:
    /// a press over an existing post **rewrites that record taller** (same id, same finish,
    /// same slim in-cell spot) rather than stacking a second piece, so a mixed stack stays one
    /// shaft and one undo frame.
    /// </summary>
    public static class StationPillarPlanning {
        /// <summary>The section lengths a pillar is built and extended in (`PILLAR_LENGTHS`).</summary>
        public static readonly int[] Lengths = { 2, 3, 4, 5, 6 };
        /// <summary>A fresh station's pillar section is 长 5 m, matching a five-metre storey.</summary>
        public const int DefaultLength = 5;

        /// <summary>`pillarSectionOf`: the armed section, falling back to 长 for a legacy height.</summary>
        public static int SectionOf(double height) {
            int rounded = (int)Math.Round(height);
            for (int i = 0; i < Lengths.Length; i++) if (Lengths[i] == rounded) return rounded;
            return DefaultLength;
        }

        /// <summary>Clamp an arbitrary setting to one of the five catalogue sections.</summary>
        public static int Section(int length) {
            for (int i = 0; i < Lengths.Length; i++) if (Lengths[i] == length) return length;
            return DefaultLength;
        }

        /// <summary>
        /// `pillarAt`: the pillar standing at this horizontal anchor whose physical shaft
        /// overlaps the pointed air cell `(x, y, z) → (x + 1, y + 1, z + 2)`. The cell above a
        /// pillar's own base is inside its shaft, which is what a press on the post hits.
        /// </summary>
        public static StationModuleRecord PillarAt(StationIndex index, int x, int y, int z) {
            if (index == null) return null;
            var air = new StationBox(x, y, z + 1, x + 1, y + 1, z + 2);
            foreach (var module in index.Document.Modules) {
                if (module == null || !string.Equals(module.Type, "pillar", StringComparison.Ordinal)) continue;
                if (module.X != x || module.Y != y) continue;
                if (!StationFootprints.TryClearance(module, out var box, out _)) continue;
                if (box.Overlaps(air)) return module;
            }
            return null;
        }

        /// <summary>
        /// `extendedPillar`: the same post with one armed section added. The record keeps its id
        /// and every authored field, so its id, finish, slim offset and bridge ownership survive.
        /// </summary>
        public static StationEditDraft Extended(StationModuleRecord pillar, int section) {
            if (pillar == null) return null;
            var draft = StationModulePlacement.DraftOf(pillar);
            double height = pillar.Config.Number("height", 0);
            draft.Set("height", Number(height + Math.Max(0, Section(section))));
            return draft;
        }

        /// <summary>
        /// Grow one post by an armed section and validate the **added span** against the real
        /// floor, solids and neighbours (`equipmentReason(cells, others, grown)`): the plan's
        /// candidate is the taller record and its refusal is the same code a fresh piece gets.
        /// </summary>
        public static StationPlacementPlan Extend(StationIndex index, StationModuleRecord pillar, int section) {
            var plan = new StationPlacementPlan();
            if (index == null) { plan.Reason = "no-document"; return plan; }
            if (pillar == null) { plan.Reason = "no-module"; return plan; }
            var draft = Extended(pillar, section);
            if (draft == null) { plan.Reason = "unsupported-family"; return plan; }
            plan.Candidate = draft;
            plan.CellX = draft.X;
            plan.CellY = draft.Y;
            plan.CellZ = draft.Z;
            plan.SupportId = pillar.Id;
            plan.Reason = StationModulePlacement.ValidateExtension(index, pillar, draft, plan.ColliderIds, plan.UnverifiedIds);
            return plan;
        }

        /// <summary>The pillar's own shaft height in metres (`cfg.height` minus a bridge's deck drop).</summary>
        public static double Height(StationModuleRecord pillar) {
            double height = pillar != null ? pillar.Config.Number("height", 0) : 0;
            if (pillar != null && pillar.Config.Has("bridgeId")) height -= 2;
            return Math.Max(0, height);
        }

        /// <summary>Every pillar at one plan cell, whatever storey (`pillarAt` without the air test).</summary>
        public static List<StationModuleRecord> At(StationIndex index, int x, int y) {
            var found = new List<StationModuleRecord>();
            if (index == null) return found;
            foreach (var module in index.Document.Modules) {
                if (module == null || !string.Equals(module.Type, "pillar", StringComparison.Ordinal)) continue;
                if (module.X == x && module.Y == y) found.Add(module);
            }
            return found;
        }

        static string Number(double value) =>
            value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
    }
}
