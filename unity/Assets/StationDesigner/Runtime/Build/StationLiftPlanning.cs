using System;
using System.Collections.Generic;
using System.Globalization;

namespace Metro.Build {
    /// <summary>
    /// The elevator shaft's growth (`build/model/Lifts.ts` `extendLift` / `removeLiftExtension`):
    /// the piece keeps its id, column and size, and only its reach and stacked rises change, so
    /// a hover-extension reads as the same elevator getting taller. The rise per step is the
    /// tool's armed interval (37 m, 5 by default), and a shaft may mix intervals  a 5 m piece
    /// with a 3 m one stacked on top has stops 5 m and 8 m apart (`liftRises`).
    ///
    /// The growth is refused when another piece already stands in the volume it would take;
    /// there is deliberately **no floor check**, so a shaft can run past a level with no slab.
    /// </summary>
    public static class StationLiftRules {
        public const int DefaultInterval = 5;

        /// <summary>`liftInColumn`: the shaft standing in a plan cell  either footprint size.</summary>
        public static StationModuleRecord LiftInColumn(StationIndex index, int x, int y) {
            if (index == null) return null;
            foreach (var module in index.Document.Modules) {
                if (module == null || module.Type != "lift") continue;
                int size = StationFootprints.LiftSize(module);
                if (x >= module.X && x < module.X + size && y >= module.Y && y < module.Y + size) return module;
            }
            return null;
        }

        /// <summary>
        /// `liftInColumn` with elevation guard: the shaft standing in `(x, y)` whose vertical span
        /// `[lo, hi]` covers <paramref name="z"/>.
        /// </summary>
        public static StationModuleRecord LiftInColumn(StationIndex index, int x, int y, int z) {
            if (index == null) return null;
            foreach (var module in index.Document.Modules) {
                if (module == null || module.Type != "lift") continue;
                int size = StationFootprints.LiftSize(module);
                if (x < module.X || x >= module.X + size || y < module.Y || y >= module.Y + size) continue;
                int lo = (int)Math.Round(Math.Min(module.From?.Z ?? module.Z, module.To?.Z ?? module.Z));
                int hi = (int)Math.Round(Math.Max(module.From?.Z ?? module.Z, module.To?.Z ?? module.Z));
                if (z >= lo && z <= hi) return module;
            }
            return null;
        }

        /// <summary>The numbers in a JSON array of positive ints (`[5,5]`), in order.</summary>
        static List<int> ParseRises(string text) {
            var rises = new List<int>();
            if (string.IsNullOrEmpty(text)) return rises;
            int at = 0;
            while (at < text.Length) {
                while (at < text.Length && !char.IsDigit(text[at])) at++;
                int start = at;
                while (at < text.Length && char.IsDigit(text[at])) at++;
                if (at <= start) break;
                if (int.TryParse(text.Substring(start, at - start), NumberStyles.Integer,
                        CultureInfo.InvariantCulture, out var value) && value > 0) rises.Add(value);
            }
            return rises;
        }

        /// <summary>`liftRises`: every stacked segment, bottom → top, from the saved list.</summary>
        public static List<int> Rises(StationModuleRecord m) {
            var rises = new List<int>();
            if (m == null || !m.From.HasValue || !m.To.HasValue) return rises;
            int span = Math.Abs((int)Math.Round(m.To.Value.Z) - (int)Math.Round(m.From.Value.Z));
            rises = ParseRises(m.Config.Text("rises"));
            int total = 0;
            foreach (var rise in rises) total += rise;
            if (rises.Count > 0 && total == span) return rises;
            rises.Clear();
            int left = span;
            while (left > 0) {
                int step = Math.Min(DefaultInterval, left);
                rises.Add(step);
                left -= step;
            }
            return rises;
        }

        /// <summary>`liftExtendedUp`: raise the shaft one interval and stack it on top.</summary>
        public static StationEditDraft ExtendUp(StationEditDraft draft, int interval) {
            int step = interval > 0 ? interval : DefaultInterval;
            var rises = RisesOf(draft);
            rises.Add(step);
            draft.To = new StationPoint(draft.To.Value.X, draft.To.Value.Y, draft.To.Value.Z + step);
            WriteRises(draft, rises);
            return draft;
        }

        /// <summary>`liftExtendedDown`: lower the shaft's base one interval and stack it below.</summary>
        public static StationEditDraft ExtendDown(StationEditDraft draft, int interval) {
            int step = interval > 0 ? interval : DefaultInterval;
            var rises = RisesOf(draft);
            rises.Insert(0, step);
            draft.From = new StationPoint(draft.From.Value.X, draft.From.Value.Y, draft.From.Value.Z - step);
            WriteRises(draft, rises);
            return draft;
        }

        /// <summary>
        /// `removeLiftExtension`: take one outer interval off, bottom or top, keeping the rest of
        /// the shaft. A single-interval shaft has no outer extension to remove.
        /// </summary>
        public static bool TryTrim(StationEditDraft draft, bool bottom) {
            var rises = RisesOf(draft);
            if (rises.Count < 2) return false;
            if (bottom) {
                draft.From = new StationPoint(draft.From.Value.X, draft.From.Value.Y, draft.From.Value.Z + rises[0]);
                rises.RemoveAt(0);
            } else {
                int last = rises[rises.Count - 1];
                draft.To = new StationPoint(draft.To.Value.X, draft.To.Value.Y, draft.To.Value.Z - last);
                rises.RemoveAt(rises.Count - 1);
            }
            WriteRises(draft, rises);
            return true;
        }

        /// <summary>
        /// The pieces a grown shaft would share space with  the source's `placementColliders`
        /// call before an extension (`placeLift`). The shaft itself is skipped, and a hung
        /// fitting under the new volume is not in the way (the shaft is below it).
        /// </summary>
        public static List<string> Blockers(StationIndex index, StationEditDraft grown, int oldLo, int oldHi, bool up) {
            var blockers = new List<string>();
            if (index == null || grown == null) return blockers;
            var record = StationModulePlacement.ToRecord(grown);
            if (!StationFootprints.TryClearance(record, out var box, out _)) return blockers;
            // A poured block in the **new** volume refuses the growth as surely as another piece
            // does. The courses the shaft already stands through — and the lower floor slab at
            // `newLo` that a downward extension stands on — are not blockers: a lift's box starts
            // half a metre above its base, so the floor it stands on would otherwise refuse
            // every downward extension.
            int newLo = (int)Math.Round(Math.Min(record.From.Value.Z, record.To.Value.Z));
            foreach (var cell in index.Document.Cells) {
                if (cell == null || !cell.IsSolid) continue;
                bool isNew = up ? cell.Z >= oldHi : (cell.Z > newLo && cell.Z < oldLo);
                if (!isNew) continue;
                var unit = new StationBox(cell.X, cell.Y, cell.Z, cell.X + 1, cell.Y + 1, cell.Z + 1);
                if (box.Overlaps(unit)) { blockers.Add("block " + cell.X + "," + cell.Y + "," + cell.Z); break; }
            }
            foreach (var module in index.Document.Modules) {
                if (module == null || string.Equals(module.Id, grown.Id, StringComparison.Ordinal)) continue;
                if (!StationFootprints.TryClearance(module, out var other, out _)) continue;
                if (box.Overlaps(other)) blockers.Add(module.Id);
            }
            return blockers;
        }

        static List<int> RisesOf(StationEditDraft draft) {
            var rises = new List<int>();
            if (draft == null) { rises.Add(DefaultInterval); return rises; }
            rises = ParseRises(draft.Text("rises"));
            if (draft.From.HasValue && draft.To.HasValue) {
                int span = Math.Abs((int)Math.Round(draft.To.Value.Z) - (int)Math.Round(draft.From.Value.Z));
                int total = 0;
                foreach (var rise in rises) total += rise;
                if (rises.Count > 0 && total == span) return rises;
                rises.Clear();
                int left = span;
                while (left > 0) {
                    int step = Math.Min(DefaultInterval, left);
                    rises.Add(step);
                    left -= step;
                }
                if (rises.Count > 0) return rises;
            }
            if (rises.Count == 0) rises.Add(DefaultInterval);
            return rises;
        }

        static void WriteRises(StationEditDraft draft, List<int> rises) {
            var parts = new List<string>(rises.Count);
            foreach (var rise in rises) parts.Add(rise.ToString(CultureInfo.InvariantCulture));
            draft.SetJson("rises", "[" + string.Join(",", parts) + "]");
        }
    }
}
