using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.Persistence;

namespace Metro.App {
    /// <summary>
    /// The 电梯 tool's shaft growth (`placeLift` / `extendLift` / `removeLiftExtension`). A press
    /// in a shaft's own column grows it one armed interval — up when the pointer is in the
    /// shaft's upper half, down when it is below — keeping its id, column and size. The
    /// secondary press trims one outer interval from the nearer end. A press in a column with no
    /// shaft falls through to the ordinary placement path, which drops a fresh one.
    ///
    /// The growth is refused when another piece already stands in the volume it would take;
    /// there is deliberately no floor check, so a shaft can run past a level with no slab.
    /// </summary>
    public static class StationLiftTool {
        /// <summary>True while the 设备 palette holds the 电梯 tile.</summary>
        public static bool IsArmed() =>
            string.Equals(StationToolSelection.Active, "module", StringComparison.Ordinal) &&
            string.Equals(StationToolSelection.Setting("moduleType"), "lift", StringComparison.Ordinal);

        /// <summary>The armed interval in metres (`liftInterval`), 5 by default.</summary>
        public static int ArmedInterval() {
            int interval = StationToolSelection.SettingInt("liftInterval", 5);
            return interval is >= 3 and <= 7 ? interval : 5;
        }

        /// <summary>
        /// Handle one press in a shaft column. Returns false when the column holds no shaft, so
        /// the ordinary placement path can drop a fresh elevator there.
        /// </summary>
        public static bool Begin(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            int button, out string code, out string reason) {
            code = null;
            reason = null;
            if (host?.Index == null || hit == null || !hit.HasCell) return false;
            var shaft = StationLiftRules.LiftInColumn(host.Index, hit.Cell.X, hit.Cell.Y);
            if (shaft == null) return false;
            var draft = StationModulePlacement.DraftOf(shaft);
            int lo = (int)Math.Round(Math.Min(shaft.From?.Z ?? shaft.Z, shaft.To?.Z ?? shaft.Z));
            int hi = (int)Math.Round(Math.Max(shaft.From?.Z ?? shaft.Z, shaft.To?.Z ?? shaft.Z));
            bool upperHalf = hit.Cell.Z >= (lo + hi) / 2.0;
            string label;
            if (button == 2) {
                if (!StationLiftRules.TryTrim(draft, bottom: !upperHalf)) { reason = "lift-single-interval"; return true; }
                label = "trim lift";
            } else {
                if (upperHalf) StationLiftRules.ExtendUp(draft, ArmedInterval());
                else StationLiftRules.ExtendDown(draft, ArmedInterval());
                label = "extend lift";
                var blockers = StationLiftRules.Blockers(host.Index, draft, lo, hi, upperHalf);
                if (blockers.Count > 0) {
                    reason = "occupied";
                    return true;
                }
            }
            var next = Metro.Persistence.StationLiftEdits.Apply(host.SaveDocument(), draft, out code);
            if (next == null) { reason = code; return true; }
            if (!StationEditSession.TryApplyPatch(host, next, label, null, out _, out code)) {
                reason = code;
                return true;
            }
            return true;
        }
    }
}
