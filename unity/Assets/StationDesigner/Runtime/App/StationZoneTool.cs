using System;
using System.Collections.Generic;
using Metro.App.Views;
using Metro.Build;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// One 分区 gesture's aimed patch: the floor the brush covers, the floor whose label really
    /// changes, and the cells it skipped. What the tint draws and what the release commits are
    /// the same plan (`StationZonePlanner`), so a tinted cell can never turn into a refusal.
    /// </summary>
    public sealed class StationZonePreview {
        /// <summary>Every covered cell that is floor — the tint's own set.</summary>
        public readonly List<StationCellKey> Floor = new List<StationCellKey>();
        /// <summary>The floor cells whose label changes.</summary>
        public readonly List<StationCellKey> Cells = new List<StationCellKey>();
        /// <summary>The covered cells that are not floor (no tint, no write).</summary>
        public readonly List<StationCellKey> Skipped = new List<StationCellKey>();
        public StationCellKey Anchor;
        /// <summary>The armed brush id (`unpaid`, `paid`, `store`, … or `none`).</summary>
        public string Paint = "";
        public bool Erase;
        /// <summary>The tint's own colour (`ZONE_PAINT_LIST`), or the eraser's warning red.</summary>
        public int Colour = 0x7fe4ff;
        /// <summary>A stable code when the hover or the gesture paints nothing (`not-floor`).</summary>
        public string Notice = "";
        /// <summary>The counter brush (`ticket` / `info`) when the drag builds a facility room.</summary>
        public string Facility = "";
        /// <summary>The footprint a counter drag would build or extend (its rect cells).</summary>
        public readonly List<StationCellKey> Rect = new List<StationCellKey>();
        /// <summary>The room already standing there that refuses the drag (`clash`), when any.</summary>
        public string BlockedBy = "";
        public int Width, Height;

        public bool HasPlan => Floor.Count > 0 || Cells.Count > 0 || Rect.Count > 0 || Notice.Length > 0;

        public JObject ToJson() {
            if (!HasPlan) return null;
            var json = new JObject {
                ["paint"] = Paint ?? "",
                ["erase"] = Erase,
                ["anchor"] = new JArray(Anchor.X, Anchor.Y, Anchor.Z),
                ["notice"] = Notice ?? "",
            };
            json["floor"] = CellsJson(Floor);
            json["cells"] = CellsJson(Cells);
            if (Facility.Length > 0) {
                json["facility"] = new JObject {
                    ["kind"] = Facility,
                    ["w"] = Width,
                    ["h"] = Height,
                    ["blockedBy"] = BlockedBy ?? "",
                    ["cells"] = CellsJson(Rect),
                };
            }
            return json;
        }

        static JArray CellsJson(List<StationCellKey> cells) {
            var array = new JArray();
            foreach (var cell in cells) array.Add(new JArray(cell.X, cell.Y, cell.Z));
            return array;
        }
    }

    /// <summary>
    /// The 分区 (zone) brush on the canvas (plan 27 §6). One port of
    /// `game/src/app/tools/ZoneTool.ts`'s fare-zone half: press a floor cell and release to
    /// label it, drag to label the rectangle it covers, and hold the secondary button (or the
    /// **无分区** tile) to take a label off again. Only floor accepts a label — the same rule
    /// the 分区 map tints by — so a drag across a wall row paints the floor it crosses.
    ///
    /// The brush's id and the eraser are the shared UI's own state (`zoneBrush`), which travels
    /// in every `tool.set`; nothing here owns a second vocabulary.
    /// </summary>
    public static class StationZoneTool {
        public const string BrushSetting = "zoneBrush";
        /// <summary>The facility brushes build counters instead of labelling floor (`ZoneTool`).</summary>
        public const string TicketBrush = "ticket";
        public const string InfoBrush = "info";

        static StationZoneGesture gesture;
        static StationZonePreview preview = new StationZonePreview();

        public static StationZonePreview Preview => preview;
        public static bool HasGesture => gesture != null;

        sealed class StationZoneGesture {
            public StationCellKey Anchor;
            public int Button;
            public string Paint = "";
            public bool Erase;
            /// <summary>True when the drag builds a counter (`ZoneTool`'s facility branch).</summary>
            public bool Facility;
            public string Kind = "";
            public int Front;
            public float PressX, PressY;
            public double PressTimeMs;
            public int Revision;
        }

        public static void Reset() {
            gesture = null;
            preview = new StationZonePreview();
            StationEditSession.Zone = null;
            ForgetWorld();
        }

        /// <summary>The armed brush, falling back to the palette's own default (非付费区).</summary>
        public static string ArmedBrush() {
            var brush = StationToolSelection.Setting(BrushSetting);
            return string.IsNullOrEmpty(brush) || string.Equals(brush, "null", StringComparison.Ordinal)
                ? "unpaid"
                : brush;
        }

        static bool IsFacility(string brush) =>
            StationFacilityRules.IsBoothBrush(brush);

        /// <summary>
        /// Arm a zone gesture from one press. A press on a cell that is not floor paints nothing
        /// and says why (`ZoneTool.onDown`), rather than opening a drag that would write a label
        /// no overlay could draw.
        /// </summary>
        public static bool Begin(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            int button, out string reason) {
            reason = null;
            var world = World(host);
            if (world == null) { reason = "no-session"; return false; }
            if (hit == null || !hit.HasCell) { reason = "no-cell"; return false; }
            var brush = ArmedBrush();
            if (button == 2) {
                var index = host.Index;
                var room = StationFacilityPlanner.At(index, hit.Cell.X, hit.Cell.Y, hit.Cell.Z);
                if (room != null && string.Equals(room.Type, "booth", StringComparison.Ordinal)) {
                    var removal = StationFacilityPlanner.PlanRemoval(index, room.Id);
                    if (removal.HasWork) {
                        if (!StationEditSession.TryApplyCells(host, removal.ToPatch(), "remove counter", null,
                                out _, out var removeCode)) {
                            reason = removeCode;
                            return false;
                        }
                        ForgetWorld();
                        preview = new StationZonePreview();
                        StationEditSession.Zone = null;
                        return true;
                    }
                }
            } else if (IsFacility(brush)) {
                return BeginFacility(host, world, hit, pointer, button, out reason);
            }
            var cell = hit.CellKey;
            bool erase = button == 2 || StationZoneIds.IsErase(brush);
            if (!world.IsFloor(cell)) {
                preview = new StationZonePreview {
                    Anchor = cell, Paint = erase ? StationZoneIds.None : brush, Erase = erase,
                    Colour = ColourFor(brush, erase), Notice = "not-floor",
                };
                StationEditSession.Zone = preview;
                reason = "not-floor";
                return false;
            }
            gesture = new StationZoneGesture {
                Anchor = cell,
                Button = button,
                Paint = erase ? StationZoneIds.None : brush,
                Erase = erase,
                PressX = pointer.X,
                PressY = pointer.Y,
                PressTimeMs = pointer.TimeMs,
                Revision = host.CurrentRevision,
            };
            Aim(host, hit, pointer, true);
            return true;
        }

        /// <summary>
        /// Arm a counter drag (`ZoneTool`'s `isFacilityBrush` branch): the drag builds or extends
        /// a `booth` (`ticket` or `info`). Right-click booth removal and floor-label erasing are
        /// handled in <see cref="Begin"/> before entering this branch.
        /// </summary>
        static bool BeginFacility(StationGameHost host, StationZoneWorld world, StationSceneHit hit,
            StationPointerEvent pointer, int button, out string reason) {
            reason = null;
            var index = host.Index;
            int x = hit.Cell.X, y = hit.Cell.Y, z = hit.Cell.Z;
            var brush = ArmedBrush();
            // §5.7: a room stands on the **block under the pointer**, not on the storey the
            // player is editing, and a press on the room's own wall walks down to that block.
            int standZ = StationFacilityPlanner.StandZ(index, x, y, z);
            gesture = new StationZoneGesture {
                Anchor = new StationCellKey(x, y, standZ),
                Button = button,
                Paint = brush,
                Facility = true,
                Kind = brush,
                Front = StationToolSelection.SettingInt("facilityRot", 0),
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
            var world = World(host);
            if (world == null) return;
            if (gesture == null) {
                if (hit == null || !hit.HasCell) { preview = new StationZonePreview(); return; }
                var brush = ArmedBrush();
                var hovered = hit.CellKey;
                bool erase = StationZoneIds.IsErase(brush);
                bool facility = IsFacility(brush);
                if (!world.IsFloor(hovered)) {
                    preview = new StationZonePreview {
                        Anchor = hovered, Paint = erase ? StationZoneIds.None : brush, Erase = erase,
                        Colour = facility ? FacilityColour : ColourFor(brush, erase), Notice = "not-floor",
                    };
                    StationEditSession.Zone = preview;
                    return;
                }
                // A counter brush hovers as the same single tinted floor cell the fare brush does
                // (`ZoneTool.onMove` reads the armed brush's colour before it is a facility drag).
                if (facility) {
                    preview = new StationZonePreview { Anchor = hovered, Paint = brush, Colour = FacilityColour };
                    preview.Floor.Add(hovered);
                    StationEditSession.Zone = preview;
                    return;
                }
                var single = StationZonePlanner.Plan(world, new[] { hovered }, brush);
                preview = PreviewOf(single, hovered);
                StationEditSession.Zone = preview;
                return;
            }
            if (gesture.Facility) {
                var corner = new StationCellKey(hit.Cell.X, hit.Cell.Y, gesture.Anchor.Z);
                var rect = new StationFacilityRect(gesture.Anchor.X, gesture.Anchor.Y, corner.X, corner.Y, gesture.Anchor.Z);
                var facilityPlan = StationFacilityPlanner.Plan(host.Index, gesture.Kind, rect, gesture.Front);
                preview = FacilityPreviewOf(facilityPlan, gesture.Anchor);
                StationEditSession.Zone = preview;
                return;
            }
            var cells = gesture.Anchor == hit.CellKey
                ? new List<StationCellKey> { gesture.Anchor }
                : StationCellPlanner.RectCells(gesture.Anchor, hit.CellKey, gesture.Anchor.Z, false);
            var plan = StationZonePlanner.Plan(world, cells, gesture.Paint);
            preview = PreviewOf(plan, gesture.Anchor);
            StationEditSession.Zone = preview;
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
            var world = World(host);
            if (world == null) { reason = "no-session"; return false; }
            if (current.Revision != host.CurrentRevision) {
                preview = new StationZonePreview();
                StationEditSession.Zone = null;
                reason = "stale-revision";
                return false;
            }
            var target = hit != null && hit.HasCell ? hit.CellKey : current.Anchor;
            if (current.Facility) {
                var rect = new StationFacilityRect(current.Anchor.X, current.Anchor.Y, target.X, target.Y, current.Anchor.Z);
                var facilityPlan = StationFacilityPlanner.Plan(host.Index, current.Kind, rect, current.Front);
                if (!facilityPlan.Ok) {
                    reason = facilityPlan.Reason;
                    preview = FacilityPreviewOf(facilityPlan, current.Anchor);
                    StationEditSession.Zone = preview;
                    return false;
                }
                var facilityLabel = string.Equals(current.Kind, TicketBrush, StringComparison.Ordinal)
                    ? "place ticket booth"
                    : string.Equals(current.Kind, InfoBrush, StringComparison.Ordinal)
                        ? "place information desk"
                        : "place " + current.Kind;
                if (!StationEditSession.TryApplyCells(host, facilityPlan.ToPatch(), facilityLabel, null, out _, out code)) {
                    reason = code;
                    return false;
                }
                ForgetWorld();
                preview = new StationZonePreview();
                StationEditSession.Zone = null;
                return true;
            }
            var cells = target == current.Anchor
                ? new List<StationCellKey> { current.Anchor }
                : StationCellPlanner.RectCells(current.Anchor, target, current.Anchor.Z, false);
            var plan = StationZonePlanner.Plan(world, cells, current.Paint);
            if (!plan.HasWork) {
                reason = plan.Reason.Length > 0 ? plan.Reason : "nothing-to-do";
                preview = new StationZonePreview();
                StationEditSession.Zone = null;
                return false;
            }
            var label = current.Erase ? "erase zone" : "paint zone";
            if (!StationEditSession.TryApplyCells(host, plan.ToPatch(), label, null, out _, out code)) {
                reason = code;
                return false;
            }
            ForgetWorld();
            preview = new StationZonePreview();
            StationEditSession.Zone = null;
            return true;
        }

        public static void Cancel() {
            gesture = null;
            preview = new StationZonePreview();
            StationEditSession.Zone = null;
        }

        public static void Leave() {
            if (gesture != null) return;
            preview = new StationZonePreview();
            StationEditSession.Zone = null;
        }

        /// <summary>Publish the aimed patch into the session snapshot.</summary>
        public static void Publish() => StationEditSession.Zone = preview.HasPlan ? preview : null;

        static StationZonePreview PreviewOf(StationZonePlan plan, StationCellKey anchor) {
            var preview = new StationZonePreview {
                Anchor = anchor,
                Paint = plan.Paint,
                Erase = plan.Erase,
                Colour = ColourFor(plan.Paint, plan.Erase),
            };
            preview.Floor.AddRange(plan.Floor);
            preview.Cells.AddRange(plan.Accepted);
            preview.Skipped.AddRange(plan.Ignored);
            if (plan.Reason == "not-floor") preview.Notice = "not-floor";
            return preview;
        }

        /// <summary>The counter brush's own tint (`FACILITY_OPTIONS`'s single colour).</summary>
        public static int FacilityColour => 0x42a5c4;

        static StationZonePreview FacilityPreviewOf(StationFacilityPlan plan, StationCellKey anchor) {
            var preview = new StationZonePreview {
                Anchor = anchor,
                Paint = plan.Kind,
                Facility = plan.Kind,
                Colour = plan.Ok ? FacilityColour : 0xff7a7a,
                Width = plan.Width,
                Height = plan.Height,
                BlockedBy = plan.BlockedBy != null ? plan.BlockedBy.Id : "",
                Notice = plan.Ok ? "" : plan.Reason,
            };
            var cells = StationFacilityRules.Cells(plan.Rect);
            preview.Rect.AddRange(cells);
            preview.Cells.AddRange(cells);
            return preview;
        }

        /// <summary>The brush's tint, from the shared palette the 分区 map draws with (`ZONE_PAINT_LIST`),
        /// and the eraser's own warning red — the same colour the 材质 brush erases in.</summary>
        public static int ColourFor(string paint, bool erase) {
            if (erase) return 0xff7a7a;
            int index = StationZoneMap.DisplayIndexOf(paint);
            return index >= 0 ? StationZoneMap.Category(index).Rgb : 0x7fe4ff;
        }

        /* ------------------------------------------------------------------- world */

        static StationZoneWorld world;
        static int worldRevision = int.MinValue;
        static string worldSource = "";

        /// <summary>The gesture's immutable world, cached per committed revision (one per document).</summary>
        public static StationZoneWorld World(StationGameHost host) {
            if (host == null || host.Index == null) return null;
            if (world != null && worldRevision == host.CurrentRevision &&
                string.Equals(worldSource, host.CurrentSourceId ?? "", StringComparison.Ordinal)) return world;
            world = StationZoneWorld.Build(host.Index);
            worldRevision = host.CurrentRevision;
            worldSource = host.CurrentSourceId ?? "";
            return world;
        }

        public static void ForgetWorld() {
            world = null;
            worldRevision = int.MinValue;
            worldSource = "";
        }
    }
}
