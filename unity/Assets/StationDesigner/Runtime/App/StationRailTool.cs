using System;
using System.Collections.Generic;
using Metro.Build;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// The `rail` tool (plan 27 §6): the 站台 platform rail. A press drops the whole pre-sized
    /// track piece for the bound line — the run centred on the pressed cell, turned by R — and
    /// the secondary press lifts the rail under the pointer. The piece is the same
    /// <see cref="StationRailPlan"/> the ghost draws, so a previewed run is the run that commits.
    ///
    /// The gesture is a **press** tool (`PlatformTool.onDown`): it commits on the button, and
    /// the release owns nothing.
    /// </summary>
    public static class StationRailTool {
        public const string LineSetting = "lineId";
        public const string DirectionSetting = "railDir";
        public const string RotationSetting = "rotationRail";
        public const string CatenarySetting = "railCatenaryStyle";

        static StationRailPlan preview;

        /// <summary>The last aimed run (null when the pointer is not over a track surface).</summary>
        public static StationRailPlan Preview => preview;

        public static void Reset() {
            preview = null;
            StationEditSession.Rail = null;
        }

        /// <summary>The armed line id, empty for "the document's first line".</summary>
        public static string ArmedLine() => StationToolSelection.Setting(LineSetting);

        /// <summary>The armed platform direction, defaulting to up.</summary>
        public static string ArmedDirection() {
            var dir = StationToolSelection.Setting(DirectionSetting);
            return string.IsNullOrEmpty(dir) ? "up" : dir;
        }

        public static int ArmedRotation() => StationToolSelection.SettingInt(RotationSetting, 0);

        /// <summary>
        /// One press: lay the piece on the primary button, lift the rail on the secondary. The
        /// commit is the shared cell transaction, so the revision, the undo frame and the redo
        /// clear are the same as every other edit.
        /// </summary>
        public static bool Begin(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            int button, out string code, out string reason) {
            code = null;
            reason = null;
            if (host?.Index == null) { reason = "no-session"; return false; }
            var cell = hit != null ? hit.EditCell : StationPlacementHit.None;
            if (!cell.HasCell) { reason = "no-cell"; return false; }
            if (button == 2) {
                var rail = StationRailPlanner.RailAt(host.Index, cell.X, cell.Y, cell.Z)
                    ?? StationRailPlanner.RailAt(host.Index, cell.PlaceX, cell.PlaceY, cell.PlaceZ);
                if (rail == null) { reason = "no-track-to-remove"; return false; }
                var removal = StationRailPlanner.PlanRemoval(host.Index, rail.Id);
                if (!removal.HasWork) { reason = removal.Reason; return false; }
                var removalPatch = removal.ToPatch();
                // A bored rail owns a tunnel shell; lifting it takes the shell with it.
                foreach (var write in StationTunnelShell.Strip(host.Index, rail.Id)) removalPatch.Writes.Add(write);
                if (!StationEditSession.TryApplyCells(host, removalPatch, "remove rail", null, out _, out code)) {
                    reason = code;
                    return false;
                }
                ForgetPreview();
                return true;
            }
            var plan = StationRailPlanner.Plan(host.Index, ArmedLine(), ArmedDirection(), ArmedRotation(),
                cell.X, cell.Y, cell.Z);
            if (!plan.Ok) {
                preview = plan;
                StationEditSession.Rail = plan;
                reason = plan.Reason;
                return false;
            }
            plan.Track.Id = StationModulePlacement.NextId(host.Index, "track");
            // The screens are derived from the platform floor beside the bed, in the same
            // transaction as the rail (`derivePlatformEdges`).
            plan.DerivedEdges.AddRange(StationRailPlanner.DerivePlatformEdges(host.Index, plan));
            if (!StationEditSession.TryApplyCells(host, plan.ToPatch(), "place rail", null, out _, out code)) {
                reason = code;
                return false;
            }
            ForgetPreview();
            return true;
        }

        /// <summary>Re-aim the piece ghost at one fresh hit (a move, or a re-aimed cached pointer).</summary>
        public static void Aim(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer) {
            if (host?.Index == null) { preview = null; StationEditSession.Rail = null; return; }
            var cell = hit != null ? hit.EditCell : StationPlacementHit.None;
            if (!cell.HasCell) { preview = null; StationEditSession.Rail = null; return; }
            preview = StationRailPlanner.Plan(host.Index, ArmedLine(), ArmedDirection(), ArmedRotation(),
                cell.X, cell.Y, cell.Z);
            StationEditSession.Rail = preview;
        }

        public static void Cancel() {
            preview = null;
            StationEditSession.Rail = null;
        }

        public static void Leave() => Cancel();

        public static void Publish() => StationEditSession.Rail = preview;

        static void ForgetPreview() {
            preview = null;
            StationEditSession.Rail = null;
        }
    }
}
