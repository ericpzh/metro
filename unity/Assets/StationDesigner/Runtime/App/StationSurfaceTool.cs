using System;
using System.Collections.Generic;
using Metro.Build;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// One tile gesture's aimed patch: the cells it paves (or unpaves), the cells it refuses and
    /// why. What the tint draws and what the release commits are the same plan
    /// (<see cref="StationSurfacePlanner"/>), so a tinted tile can never turn into a refusal.
    /// </summary>
    public sealed class StationSurfacePreview {
        /// <summary>The cells whose finish the release changes.</summary>
        public readonly List<StationCellKey> Cells = new List<StationCellKey>();
        /// <summary>The covered cells the tile rules refuse.</summary>
        public readonly List<StationCellKey> Refused = new List<StationCellKey>();
        /// <summary>The covered cells that already read that way.</summary>
        public readonly List<StationCellKey> Skipped = new List<StationCellKey>();
        /// <summary>Placed surface module ids the erase gesture would remove.</summary>
        public readonly List<string> RemoveModuleIds = new List<string>();
        public StationCellKey Anchor;
        /// <summary>`sidewalk` or `lawn`.</summary>
        public string Type = "";
        public bool Erase;
        /// <summary>The first refusal's code (`floor`, `occupied`, `opening`, `track`, …).</summary>
        public string Notice = "";

        public bool HasPlan => Cells.Count > 0 || Refused.Count > 0 || Notice.Length > 0;

        public JObject ToJson() {
            if (!HasPlan) return null;
            var json = new JObject {
                ["type"] = Type ?? "",
                ["erase"] = Erase,
                ["anchor"] = new JArray(Anchor.X, Anchor.Y, Anchor.Z),
                ["notice"] = Notice ?? "",
            };
            json["cells"] = CellsJson(Cells);
            json["refused"] = CellsJson(Refused);
            return json;
        }

        static JArray CellsJson(List<StationCellKey> cells) {
            var array = new JArray();
            foreach (var cell in cells) array.Add(new JArray(cell.X, cell.Y, cell.Z));
            return array;
        }
    }

    /// <summary>
    /// The 人行道 / 草坪 tile brushes (plan 27 §5): a press anchors, a deliberate drag paves the
    /// rectangle it covers, and the secondary button takes the same finish up again. One finish
    /// per tile — laying 草坪 over 人行道 **replaces** it — and a tile needs real floor under it
    /// with a free course above, exactly the outdoor branch of the reference's placement rules.
    ///
    /// The brush is the 设备 palette's own `moduleType` (`sidewalk` / `lawn`), so a tile tile
    /// arms it the same way a bench does; no second vocabulary.
    /// </summary>
    public static class StationSurfaceTool {
        static StationSurfaceGesture gesture;
        static StationSurfacePreview preview = new StationSurfacePreview();

        public static StationSurfacePreview Preview => preview;
        public static bool HasGesture => gesture != null;

        sealed class StationSurfaceGesture {
            public StationCellKey Anchor;
            public int Button;
            public string Type = "";
            public bool Erase;
            public int Rotation;
            public float PressX, PressY;
            public double PressTimeMs;
            public int Revision;
        }

        /// <summary>The armed finish from the 设备 palette, or "" when the palette holds a piece.</summary>
        public static string ArmedType() {
            var type = StationToolSelection.Setting("moduleType");
            return StationSurfaceRules.IsSurface(type) ? type : "";
        }

        /// <summary>True while the committed tool is the 设备 palette with a tile finish armed.</summary>
        public static bool IsArmed() =>
            string.Equals(StationToolSelection.Active, "module", StringComparison.Ordinal) && ArmedType().Length > 0;

        public static void Reset() {
            gesture = null;
            preview = new StationSurfacePreview();
            StationEditSession.Surface = null;
        }

        static bool TrySurfaceCell(StationSceneHit hit, out StationCellKey cell) {
            cell = default;
            if (hit == null) return false;
            if (hit.HasModule && hit.ModuleWins && hit.Module != null &&
                StationSurfaceRules.IsSurface(hit.Module.Type)) {
                cell = new StationCellKey(hit.Module.X, hit.Module.Y, hit.Module.Z);
                return true;
            }
            if (hit.HasCell) {
                cell = hit.CellKey;
                return true;
            }
            return false;
        }

        /// <summary>Arm a tile gesture from one press, or say why the press paves nothing.</summary>
        public static bool Begin(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            int button, out string reason) {
            reason = null;
            var world = StationCellTool.World(host);
            if (world == null) { reason = "no-session"; return false; }
            if (!TrySurfaceCell(hit, out var cell)) { reason = "no-cell"; return false; }
            var type = ArmedType();
            if (type.Length == 0) { reason = "no-tile"; return false; }
            bool erase = button == 2;
            if (erase) {
                // The tile brush's secondary press only takes **its own** finish up: a 人行道
                // brush does not lift the 草坪 beside it, and plain floor has nothing to lift
                // (`TileEquipmentTool`'s `picked?.type !== brush` refusal).
                var held = StationSurfacePlanner.ModuleAt(host.Index, cell.X, cell.Y, cell.Z);
                if (held == null || !string.Equals(held.Type, type, StringComparison.Ordinal)) {
                    preview = new StationSurfacePreview { Anchor = cell, Type = type, Erase = true, Notice = "no-surface" };
                    StationEditSession.Surface = preview;
                    reason = "no-surface";
                    return false;
                }
            }
            gesture = new StationSurfaceGesture {
                Anchor = cell,
                Button = button,
                Type = type,
                Erase = erase,
                Rotation = StationToolSelection.SettingInt("rotation", 0),
                PressX = pointer.X,
                PressY = pointer.Y,
                PressTimeMs = pointer.TimeMs,
                Revision = host.CurrentRevision,
            };
            Aim(host, hit, pointer, true);
            return true;
        }

        /// <summary>Re-aim the brush at one fresh hit (a move, or a re-aimed cached pointer).</summary>
        public static void Aim(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            bool fresh = false) {
            var world = StationCellTool.World(host);
            if (world == null) return;
            if (gesture == null) {
                var type = ArmedType();
                if (type.Length == 0 || !TrySurfaceCell(hit, out var hoverCell)) { preview = new StationSurfacePreview(); return; }
                var plan = StationSurfacePlanner.Plan(host.Index, world, new[] { hoverCell }, type, 0, false);
                preview = PreviewOf(plan, hoverCell);
                StationEditSession.Surface = preview;
                return;
            }
            if (!TrySurfaceCell(hit, out var aimCell)) return;
            var cells = gesture.Anchor == aimCell
                ? new List<StationCellKey> { gesture.Anchor }
                : StationCellPlanner.RectCells(gesture.Anchor, aimCell, gesture.Anchor.Z, false);
            var dragged = StationSurfacePlanner.Plan(host.Index, world, cells, gesture.Type, gesture.Rotation, gesture.Erase);
            preview = PreviewOf(dragged, gesture.Anchor);
            StationEditSession.Surface = preview;
        }

        /// <summary>
        /// Commit the gesture: one cell patch through <c>StationEditSession.TryApplyCells</c>, so
        /// the revision, the undo frame and the redo clear are the same as every other edit.
        /// </summary>
        public static bool Finish(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            out string code, out string reason) {
            code = null;
            reason = null;
            var current = gesture;
            gesture = null;
            if (current == null) { reason = "no-gesture"; return false; }
            var world = StationCellTool.World(host);
            if (world == null) { reason = "no-session"; return false; }
            if (current.Revision != host.CurrentRevision) {
                preview = new StationSurfacePreview();
                StationEditSession.Surface = null;
                reason = "stale-revision";
                return false;
            }
            var target = TrySurfaceCell(hit, out var releaseCell) ? releaseCell : current.Anchor;
            var cells = target == current.Anchor
                ? new List<StationCellKey> { current.Anchor }
                : StationCellPlanner.RectCells(current.Anchor, target, current.Anchor.Z, false);
            var plan = StationSurfacePlanner.Plan(host.Index, world, cells, current.Type, current.Rotation, current.Erase);
            if (!plan.HasWork) {
                reason = plan.Reason.Length > 0 ? plan.Reason : current.Erase ? "no-surface" : "nothing-to-do";
                preview = new StationSurfacePreview();
                StationEditSession.Surface = null;
                return false;
            }
            var label = current.Erase ? "remove paving" : "pave";
            if (!StationEditSession.TryApplyCells(host, plan.ToPatch(), label, null, out _, out code)) {
                reason = code;
                return false;
            }
            StationCellTool.ForgetWorld();
            preview = new StationSurfacePreview();
            StationEditSession.Surface = null;
            return true;
        }

        public static void Cancel() {
            gesture = null;
            preview = new StationSurfacePreview();
            StationEditSession.Surface = null;
        }

        public static void Leave() {
            if (gesture != null) return;
            preview = new StationSurfacePreview();
            StationEditSession.Surface = null;
        }

        /// <summary>Publish the aimed patch into the session snapshot.</summary>
        public static void Publish() => StationEditSession.Surface = preview.HasPlan ? preview : null;

        /// <summary>The tile's own tint: paving reads grey-blue, lawn green, a refusal red.</summary>
        public static int ColourFor(string type, bool erase) {
            if (erase) return 0xff7a7a;
            return string.Equals(type, "lawn", StringComparison.Ordinal) ? 0x5aa55a : 0x9fb0c0;
        }

        static StationSurfacePreview PreviewOf(StationSurfacePlan plan, StationCellKey anchor) {
            var preview = new StationSurfacePreview {
                Anchor = anchor,
                Type = plan.Type,
                Erase = plan.Erase,
                Notice = plan.Reason ?? "",
            };
            preview.Cells.AddRange(plan.Accepted);
            preview.Refused.AddRange(plan.Refused);
            preview.Skipped.AddRange(plan.Skipped);
            preview.RemoveModuleIds.AddRange(plan.RemoveModuleIds);
            return preview;
        }
    }
}
