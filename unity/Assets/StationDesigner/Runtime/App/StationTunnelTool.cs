using System;
using Metro.Build;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// The 隧道 / 桥梁 tools (plan 27 §6, plan 28 §3c): hang a fixed-length extension off the free
    /// end of the hovered rail, along that rail's own axis. A tunnel never touches the platform's
    /// own cells — the run starts where that rail stops — and it bores through walls and hangs over
    /// void, so only another rail in the way refuses it. A 桥梁 is the same gesture with
    /// `cfg.bridge` (and its railing) instead of `cfg.tunnel`, so it spans the void above; its
    /// piers are derived per bay in the same revision. The secondary press lifts the source rail.
    ///
    /// Both tiles read **one** extension aim (<see cref="Plan"/>), used by hover, by the settings
    /// refresh and by the commit, so a ghost that says "28 m bridge here" is the run the press
    /// lays (plan 28 §3c: "Feed `PlanTunnel` or `PlanBridge` to both `ShowRail` and commit").
    /// </summary>
    public static class StationTunnelTool {
        public const string LengthSetting = "tunnelLength";
        public const string BridgeLengthSetting = "bridgeLength";
        public const string BridgeRailingSetting = "bridgeRailing";

        static StationRailPlan preview;
        static bool previewBridge;

        /// <summary>The last aimed run (null when the pointer is over no rail).</summary>
        public static StationRailPlan Preview => preview;
        /// <summary>True when the aimed run is the 桥梁 variant.</summary>
        public static bool PreviewIsBridge => previewBridge;

        public static void Reset() {
            preview = null;
            previewBridge = false;
            StationEditSession.Rail = null;
        }

        /// <summary>The armed tunnel length in whole metres, from the shell's own setting.</summary>
        public static int ArmedLength() {
            int length = StationToolSelection.SettingInt(LengthSetting, 24);
            return Math.Max(1, length);
        }

        /// <summary>The armed bridge length in whole metres (the 桥梁 folder's own 24 m default).</summary>
        public static int ArmedBridgeLength() {
            int length = StationToolSelection.SettingInt(BridgeLengthSetting, 24);
            return Math.Max(1, length);
        }

        /// <summary>The armed bridge railing (`railing` / `sound-barrier-half` / `sound-barrier`).</summary>
        public static string ArmedRailing() {
            var railing = StationToolSelection.Setting(BridgeRailingSetting);
            return string.IsNullOrEmpty(railing) ? "railing" : railing;
        }

        /// <summary>
        /// The rail the pointer is over, read from the **nearest drawn surface**: its dug bed,
        /// the platform edge in front of it, or the track module itself when its bed is not a
        /// cell (a bored tunnel). The pointer's own face names the cell, exactly like the
        /// reference's `railModuleAtPlatform(station, ...hit.cell)`.
        /// </summary>
        public static StationModuleRecord RailUnder(StationGameHost host, StationSceneHit hit) {
            if (host?.Index == null || hit == null) return null;
            var cell = hit.EditCell;
            if (cell.HasCell) {
                var rail = StationRailPlanner.RailAt(host.Index, cell.X, cell.Y, cell.Z)
                    ?? StationRailPlanner.RailAt(host.Index, cell.PlaceX, cell.PlaceY, cell.PlaceZ);
                if (rail != null) return rail;
            }
            if (hit.HasModule && hit.ModuleWins &&
                string.Equals(hit.Module.Type, "track", StringComparison.Ordinal)) {
                return hit.Module;
            }
            if (hit.HasModule && hit.ModuleWins) {
                // The platform screen door in front of a rail names that rail it was derived from.
                var from = hit.Module.Config.Text("from");
                if (from.Length > 0 && host.Index.TryGetModule(from, out var derived) && derived != null &&
                    string.Equals(derived.Type, "track", StringComparison.Ordinal)) return derived;
            }
            return null;
        }

        /// <summary>
        /// The one extension plan both tiles share: a tunnel run from the rail under the
        /// pointer, or the bridge variant with the armed railing. Returns null when the pointer
        /// names no rail at all (the reference then draws no ghost).
        /// </summary>
        public static StationRailPlan Plan(StationGameHost host, StationSceneHit hit, bool bridge) {
            if (host?.Index == null) return null;
            var source = RailUnder(host, hit);
            if (source == null) return null;
            var cell = hit != null ? hit.EditCell : StationPlacementHit.None;
            int atX = cell.HasCell ? cell.X : source.X;
            int atY = cell.HasCell ? cell.Y : source.Y;
            return bridge
                ? StationRailPlanner.PlanBridge(host.Index, source.Id, ArmedBridgeLength(), atX, atY, true,
                    ArmedRailing())
                : StationRailPlanner.PlanTunnel(host.Index, source.Id, ArmedLength(), atX, atY, true);
        }

        /// <summary>
        /// One press: extend the hovered rail (a tunnel, or the bridge variant) on the primary
        /// button, lift that rail on the secondary. The commit is the shared cell transaction.
        /// </summary>
        public static bool Begin(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            int button, bool bridge, out string code, out string reason) {
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
            var plan = Plan(host, hit, bridge);
            if (plan == null) { reason = "no-track"; return false; }
            if (!plan.Ok) {
                preview = plan;
                previewBridge = bridge;
                StationEditSession.Rail = plan;
                reason = plan.Reason;
                return false;
            }
            plan.Track.Id = StationModulePlacement.NextId(host.Index, "track");
            // Boring clears the rock above the bed and walls the cut in the same revision
            // (`boreTunnel`); a bridge's piers are spaced per bay in that same revision.
            var commit = plan.ToPatch();
            if (bridge) {
                foreach (var pier in StationBridgePillars.Candidates(host.Index,
                             StationModulePlacement.ToRecord(plan.Track)))
                    commit.AddModule(pier);
            } else {
                foreach (var write in StationTunnelShell.Bore(host.Index,
                             StationModulePlacement.ToRecord(plan.Track), StationCellEditWorld.Build(host.Index)))
                    commit.Writes.Add(write);
            }
            if (!StationEditSession.TryApplyCells(host, commit, bridge ? "place bridge" : "bore tunnel", null,
                    out _, out code)) {
                reason = code;
                return false;
            }
            ForgetPreview();
            return true;
        }

        /// <summary>One press of the 隧道 tile (`bridge: false`): the shape the 隧道 tool has always had.</summary>
        public static bool Begin(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            int button, out string code, out string reason) =>
            Begin(host, hit, pointer, button, false, out code, out reason);

        /// <summary>Re-aim the 隧道 ghost (the bridge variant keeps its own overload).</summary>
        public static void Aim(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer) =>
            Aim(host, hit, pointer, false);

        /// <summary>Re-aim the run ghost at one fresh hit (a move, or a re-aimed cached pointer).</summary>
        public static void Aim(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer, bool bridge) {
            if (host?.Index == null) { preview = null; previewBridge = false; StationEditSession.Rail = null; return; }
            preview = Plan(host, hit, bridge);
            previewBridge = bridge;
            StationEditSession.Rail = preview;
        }

        public static void Cancel() {
            preview = null;
            previewBridge = false;
            StationEditSession.Rail = null;
        }

        public static void Leave() => Cancel();

        public static void Publish() => StationEditSession.Rail = preview;

        static void ForgetPreview() {
            preview = null;
            previewBridge = false;
            StationEditSession.Rail = null;
        }
    }
}
