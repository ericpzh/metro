using System;
using Metro.Build;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// The 隧道 tool (plan 27 §6): hang a fixed-length extension off the free end of the hovered
    /// rail, along that rail's own axis. A tunnel never touches the platform's own cells  the
    /// run starts where that rail stops  and it bores through walls and hangs over void, so
    /// only another rail in the way refuses it. The secondary press lifts the source rail.
    ///
    /// The gesture is a **press** tool (`TunnelTool.onDown`): it commits on the button, and the
    /// release owns nothing.
    /// </summary>
    public static class StationTunnelTool {
        public const string LengthSetting = "tunnelLength";

        static StationRailPlan preview;

        /// <summary>The last aimed run (null when the pointer is over no rail).</summary>
        public static StationRailPlan Preview => preview;

        public static void Reset() {
            preview = null;
            StationEditSession.Rail = null;
        }

        /// <summary>The armed tunnel length in whole metres, from the shell's own setting.</summary>
        public static int ArmedLength() {
            int length = StationToolSelection.SettingInt(LengthSetting, 24);
            return Math.Max(1, length);
        }

        /// <summary>The rail the pointer is over, read from its dug bed or the platform edge.</summary>
        public static StationModuleRecord RailUnder(StationGameHost host, StationSceneHit hit) {
            if (host?.Index == null || hit == null || !hit.HasCell) return null;
            return StationRailPlanner.RailAt(host.Index, hit.Cell.X, hit.Cell.Y, hit.Cell.Z)
                ?? StationRailPlanner.RailAt(host.Index, hit.Cell.PlaceX, hit.Cell.PlaceY, hit.Cell.PlaceZ);
        }

        /// <summary>
        /// One press: extend the hovered rail with a tunnel on the primary button, lift that rail
        /// on the secondary. The commit is the shared cell transaction.
        /// </summary>
        public static bool Begin(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            int button, out string code, out string reason) {
            code = null;
            reason = null;
            if (host?.Index == null) { reason = "no-session"; return false; }
            var source = RailUnder(host, hit);
            if (source == null) { reason = "no-track"; return false; }
            if (button == 2) {
                var removal = StationRailPlanner.PlanRemoval(host.Index, source.Id);
                if (!removal.HasWork) { reason = removal.Reason; return false; }
                // Lifting a bore strips the shell it owned; the reference's `stripTunnelShell`.
                var patch = removal.ToPatch();
                foreach (var write in StationTunnelShell.Strip(host.Index, source.Id)) patch.Writes.Add(write);
                if (!StationEditSession.TryApplyCells(host, patch, "remove rail", null, out _, out code)) {
                    reason = code;
                    return false;
                }
                ForgetPreview();
                return true;
            }
            var plan = StationRailPlanner.PlanTunnel(host.Index, source.Id, ArmedLength(),
                hit.Cell.X, hit.Cell.Y, true);
            if (!plan.Ok) {
                preview = plan;
                StationEditSession.Rail = plan;
                reason = plan.Reason;
                return false;
            }
            plan.Track.Id = StationModulePlacement.NextId(host.Index, "track");
            // Boring clears the rock above the bed and walls the cut in the same revision
            // (`boreTunnel`); the track record and its shell are one gesture.
            var bore = plan.ToPatch();
            foreach (var write in StationTunnelShell.Bore(host.Index,
                         StationModulePlacement.ToRecord(plan.Track), StationCellEditWorld.Build(host.Index)))
                bore.Writes.Add(write);
            if (!StationEditSession.TryApplyCells(host, bore, "bore tunnel", null, out _, out code)) {
                reason = code;
                return false;
            }
            ForgetPreview();
            return true;
        }

        /// <summary>Re-aim the tunnel ghost at one fresh hit.</summary>
        public static void Aim(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer) {
            if (host?.Index == null) { preview = null; StationEditSession.Rail = null; return; }
            var source = RailUnder(host, hit);
            if (source == null) { preview = null; StationEditSession.Rail = null; return; }
            preview = StationRailPlanner.PlanTunnel(host.Index, source.Id, ArmedLength(),
                hit.Cell.X, hit.Cell.Y, true);
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
