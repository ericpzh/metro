using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.Persistence;

namespace Metro.App {
    /// <summary>
    /// The 支柱 extension gesture (plan 28 §3): a press with a pillar tile over an **existing**
    /// post grows that post by the armed section instead of dropping a second shaft beside it
    /// (`EquipmentTool.onDown`'s `pillarAt` branch), and the hover shows the grown shaft the
    /// press would commit. A press anywhere else is the ordinary placement the palette family
    /// now resolves (<see cref="Metro.Build.StationModuleFamilies"/>), handled by the router's
    /// `Hover`/`Place`.
    ///
    /// The same <see cref="StationPlacementPlan"/> feeds the ghost and the commit, so the height
    /// the player was shown is the height the save keeps, and the added span is validated by
    /// the resolver's own refusal codes (`occupied`, `floor`, `track`).
    /// </summary>
    public static class StationPillarTool {
        static StationPlacementPlan plan;
        static bool extension;

        /// <summary>The last aimed extension (null when the pointer was not over a post).</summary>
        public static StationPlacementPlan Plan => plan;
        /// <summary>True when the last aim found a post to grow.</summary>
        public static bool HasExtension => extension;

        public static IReadOnlyList<StationPlacementPlan> Accepted =>
            extension && plan != null && plan.Ok && plan.Candidate != null
                ? new[] { plan }
                : (IReadOnlyList<StationPlacementPlan>)Array.Empty<StationPlacementPlan>();

        public static IReadOnlyList<StationPlacementPlan> Refused =>
            extension && plan != null && plan.Candidate != null && !plan.Ok
                ? new[] { plan }
                : (IReadOnlyList<StationPlacementPlan>)Array.Empty<StationPlacementPlan>();

        /// <summary>True while a pillar tile is armed under 设备.</summary>
        public static bool IsArmed() =>
            string.Equals(StationToolSelection.Active, "module", StringComparison.Ordinal) &&
            (StationToolSelection.Setting("moduleType") ?? "").StartsWith("pillar", StringComparison.Ordinal);

        public static void Reset() {
            plan = null;
            extension = false;
        }

        /// <summary>The armed section: the `支柱`'s own 2–6 m Tab cycle.</summary>
        public static int ArmedSection() =>
            StationPillarPlanning.Section(StationToolSelection.SettingInt("pillarLength", StationPillarPlanning.DefaultLength));

        /// <summary>
        /// Aim the extension at one hit: the post under the pointer grows by the armed section.
        /// Returns false when no post stands there, which is the caller's cue to run the
        /// ordinary fresh placement instead.
        /// </summary>
        public static bool Aim(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer) {
            _ = pointer;
            plan = Resolve(host, hit);
            extension = plan != null;
            return extension;
        }

        public static void Publish() {
            StationEditSession.Plan = plan;
            StationEditSession.Cells = null;
        }

        /// <summary>
        /// One press over an existing post: grow it in the same transaction, keeping the record's
        /// id so the piece is one shaft and the edit is one undo frame. Returns false when the
        /// pointer names no post (the caller then places a fresh one).
        /// </summary>
        public static bool Begin(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            int button, out string code, out string reason) {
            code = null;
            reason = null;
            var aimed = Resolve(host, hit);
            plan = aimed;
            extension = aimed != null;
            if (!extension) return false;
            if (button == 2) {
                // The secondary button lifts the whole post, exactly like any other piece.
                if (!StationEditSession.TryApply(host, StationModuleEditMode.Remove, null, aimed.Candidate.Id,
                        "delete", null, out _, out code)) {
                    reason = code;
                    return true;
                }
                Reset();
                return true;
            }
            if (!aimed.Ok) {
                reason = aimed.Reason;
                return true;
            }
            var patch = new StationCellPatch();
            patch.ReplaceModule(aimed.Candidate);
            if (!StationEditSession.TryApplyCells(host, patch, "extend pillar", null, out _, out code)) {
                reason = code;
                return true;
            }
            Reset();
            return true;
        }

        public static void Cancel() => Reset();

        public static void Miss() => Reset();

        /// <summary>The extension plan, or null when no post stands at the pointed cell.</summary>
        static StationPlacementPlan Resolve(StationGameHost host, StationSceneHit hit) {
            if (host?.Index == null || hit == null) return null;
            var cell = hit.EditCell;
            if (!cell.HasCell) return null;
            // `pillarAt(station.modules, ...hit.cell)`: the post anchored on the cell the
            // pointer's surface belongs to (a solid block or the work-plane cell).
            var post = StationPillarPlanning.PillarAt(host.Index, cell.X, cell.Y, cell.Z)
                       ?? (cell.Solid ? null : StationPillarPlanning.PillarAt(host.Index, cell.PlaceX, cell.PlaceY, cell.PlaceZ));
            if (post == null) return null;
            var grown = StationPillarPlanning.Extend(host.Index, post, ArmedSection());
            if (grown.Candidate == null) return grown;
            // A bridge-owned pier is spaced by its bridge, so growing it would orphan its bay.
            if (post.Config.Has("bridgeId")) {
                grown.Reason = "bridge-pier";
                return grown;
            }
            return grown;        }
    }
}
