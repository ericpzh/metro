using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// What one cell-tool gesture showed: the ghost's accepted and refused cells, the ring a
    /// floor patch would raise, the placed pieces a delete would take, and the footprint
    /// badge. It is a **preview** value: the document, the revision and the undo stack are
    /// untouched by everything here.
    /// </summary>
    public sealed class StationCellPreview {
        public StationCellCheck Check = new StationCellCheck();
        /// <summary>The auto-wall courses a floor patch would raise (preview only).</summary>
        public readonly List<StationCellKey> AutoWalls = new List<StationCellKey>();
        /// <summary>Placed pieces a delete gesture would remove, in pending order.</summary>
        public readonly List<string> ModuleIds = new List<string>();
        /// <summary>`add`, `floor`, `ceiling`, `cut`, `erase`, `wall` or `delete`.</summary>
        public string Kind = "";
        /// <summary>A stable code for a whole-gesture refusal (`over-limit`).</summary>
        public string Notice = "";
        public bool OverLimit;
        /// <summary>The cut shape the ghost draws (`Full` for whole blocks).</summary>
        public StationCellShape Shape = StationCellShape.Full;
        /// <summary>The footprint badge, in metres (1 cell = 1 m).</summary>
        public int Length = 1, Width = 1;
        /// <summary>The cell the pointer ring marks.</summary>
        public StationCellKey Cursor;

        public bool HasPlan => Kind.Length > 0;
        public bool Valid => HasPlan && !OverLimit && Check.Blocked.Count == 0;

        public JObject ToJson() {
            if (!HasPlan) return null;
            var json = new JObject {
                ["kind"] = Kind,
                ["ok"] = Valid,
                ["notice"] = Notice ?? "",
                ["measure"] = new JObject { ["length"] = Length, ["width"] = Width },
                ["cursor"] = new JArray(Cursor.X, Cursor.Y, Cursor.Z),
                ["accepted"] = Cells(Check.Accepted),
                ["blocked"] = Cells(Check.Blocked),
                ["ignored"] = Cells(Check.Ignored),
                ["autoWalls"] = Cells(AutoWalls),
                ["reason"] = Check.Reason ?? "",
            };
            if (!Check.Shape.IsFull) json["shape"] = Check.Shape.ToString();
            if (Check.ColliderIds.Count > 0) json["blockedBy"] = new JArray(Check.ColliderIds);
            if (ModuleIds.Count > 0) json["modules"] = new JArray(ModuleIds);
            return json;
        }

        static JArray Cells(IReadOnlyList<StationCellKey> cells) {
            var array = new JArray();
            foreach (var cell in cells) array.Add(new JArray(cell.X, cell.Y, cell.Z));
            return array;
        }
    }

    /// <summary>Which canvas tool armed one press.</summary>
    public enum StationCellGestureKind { Block = 0, Wall = 1, Delete = 2, ModuleRun = 3 }

    /// <summary>
    /// One press's gesture: its owner, mode, anchor, plane and the press that armed it. It is
    /// the value plan 27 §2 asks the router to record at the press so a release is never
    /// dispatched to whatever tool happens to be active when it arrives.
    /// </summary>
    public sealed class StationCellGesture {
        public StationCellGestureKind Kind;
        public string Tool = "";
        public int Button;
        public bool Remove;
        public bool Ceiling;
        public bool AutoWalls;
        public StationCellShape Shape = StationCellShape.Full;
        public StationCellKey Anchor;
        public StationCellKey Target;
        /// <summary>The faces the anchor's geometry offers, for a 半墙 run's side.</summary>
        public IReadOnlyList<StationWallSide> WallDirs = Array.Empty<StationWallSide>();
        /// <summary>The piece a delete press took, or empty.</summary>
        public string ModuleId = "";
        public string SweepFamily = "";
        public readonly List<string> ModuleIds = new List<string>();
        public float PressX, PressY;
        public double PressTimeMs;
        public bool Shift;
        public bool Dragging;
        public int Revision;
        public int ToolGeneration;

        public bool IsCut => !Shape.IsFull;
        public bool HasModules => ModuleIds.Count > 0;
    }

    /// <summary>
    /// The shared canvas cell tools (plan 27 §3/§4). One port of
    /// `game/src/app/tools/{BlockTool,WallTool,DeleteTool}.ts` on top of the pure
    /// <see cref="StationCellPlanner"/>:
    ///
    /// * **方块** — a press arms add (primary) or dig (secondary); a deliberate drag grows a
    ///   rectangle, a Shift line, a 半墙/薄墙角/三角 course line, a 吊顶 run or a walled floor
    ///   patch whose ring the planner judges too;
    /// * **墙** — the press snaps its column to the cell facing open space (`wallSnap`), a
    ///   drag lays a straight storey-high run, and the secondary button lifts each column's
    ///   storey while keeping its floor;
    /// * **删除** — a press on a drawn piece takes that piece (and every same-family piece the
    ///   drag crosses, in one commit), a press on a block digs a rectangle.
    ///
    /// Hover, drag and release all read one <see cref="StationCellCheck"/>, so a cell the
    /// ghost drew blue can never be refused at the click.
    /// </summary>
    public static class StationCellTool {
        static StationCellEditWorld world;
        static int worldRevision = int.MinValue;
        static string worldSource = "";
        static StationCellGesture gesture;
        static StationCellPreview preview = new StationCellPreview();
        static bool hasHover;
        static StationCellKey hoverCell;
        static int hoverLevel;
        static int hoverRevision = int.MinValue;

        /// <summary>The last aimed gesture (null when the pointer is not aiming a cell tool).</summary>
        public static StationCellGesture Gesture => gesture;
        public static StationCellPreview Preview => preview;
        public static bool HasHover => hasHover;

        /// <summary>A press is in flight for a cell tool.</summary>
        public static bool HasGesture => gesture != null;

        public static void Reset() {
            world = null;
            worldRevision = int.MinValue;
            worldSource = "";
            gesture = null;
            preview = new StationCellPreview();
            hasHover = false;
            hoverCell = default;
            hoverLevel = 0;
            hoverRevision = int.MinValue;
        }

        /// <summary>
        /// The cell tools' own world for one committed document. A new revision or a station
        /// switch discards it, which is exactly the source's immutable-array cache.
        /// </summary>
        public static StationCellEditWorld World(StationGameHost host) {
            if (host == null || host.Index == null) return null;
            if (world != null && worldRevision == host.CurrentRevision &&
                string.Equals(worldSource, host.CurrentSourceId, StringComparison.Ordinal)) return world;
            world = StationCellEditWorld.Build(host.Index, new StationCellReservations(host.Index));
            worldRevision = host.CurrentRevision;
            worldSource = host.CurrentSourceId ?? "";
            return world;
        }

        /// <summary>Drop the cached world after a commit, undo or station switch.</summary>
        public static void ForgetWorld() {
            world = null;
            worldRevision = int.MinValue;
        }

        // ------------------------------------------------------------------- press

        /// <summary>
        /// Arm a cell gesture from one press. Returns false when the press names no surface
        /// the tool can act on (the reference then does nothing rather than inventing a
        /// target).
        /// </summary>
        public static bool Begin(StationGameHost host, StationSceneHit hit, string tool, int button,
            StationPointerEvent pointer, out string reason) {
            reason = null;
            var worldRef = World(host);
            if (worldRef == null) { reason = "no-session"; return false; }
            bool remove = button == 2;
            var settings = StationCellToolSettings.Read();
            if (string.Equals(tool, "delete", StringComparison.Ordinal)) {
                // 删除 is button-agnostic: a drawn piece under the pointer is the pending
                // delete; otherwise the block under it is dug like the brush's erase.
                if (!hit.HasCell && !hit.HasModule) { reason = "no-cell"; return false; }
                var deleteGesture = new StationCellGesture {
                    Kind = StationCellGestureKind.Delete,
                    Tool = tool,
                    Button = button,
                    Remove = true,
                    Anchor = hit.HasModule
                        ? new StationCellKey(hit.Module.X, hit.Module.Y, hit.Module.Z)
                        : new StationCellKey(hit.Cell.X, hit.Cell.Y, hit.Cell.Z),
                    PressX = pointer.X,
                    PressY = pointer.Y,
                    PressTimeMs = pointer.TimeMs,
                    Shift = (pointer.Modifiers & StationPointerModifiers.Shift) != 0,
                    Revision = host.CurrentRevision,
                    ToolGeneration = StationToolSelection.Generation,
                };
                deleteGesture.Target = deleteGesture.Anchor;
                if (hit.HasModule && hit.ModuleWins) {
                    deleteGesture.ModuleId = hit.Module.Id;
                    deleteGesture.SweepFamily = StationSweep.FamilyOf(hit.Module) ?? "";
                    deleteGesture.ModuleIds.Add(hit.Module.Id);
                }
                gesture = deleteGesture;
                Aim(host, hit, pointer, true);
                return true;
            }
            if (string.Equals(tool, "wall", StringComparison.Ordinal)) {
                var aim = AnchorFor(hit, remove, !remove);
                if (!aim.HasValue) { reason = "no-cell"; return false; }
                var anchor = aim.Value;
                IReadOnlyList<StationWallSide> dirs = Array.Empty<StationWallSide>();
                if (!remove) {
                    // The add path snaps the column to the cell that faces open space and to the
                    // R-selected face; the remove path lifts exactly the column aimed at.
                    var point = PointOf(hit, anchor);
                    var snap = StationCellPlanner.WallSnap(worldRef, anchor, point.X, point.Y, true,
                        settings.WallSnapCycle);
                    anchor = snap.Base;
                    dirs = snap.Dirs;
                }
                gesture = new StationCellGesture {
                    Kind = StationCellGestureKind.Wall,
                    Tool = tool,
                    Button = button,
                    Remove = remove,
                    Anchor = anchor,
                    Target = anchor,
                    WallDirs = dirs,
                    Shape = settings.HalfWall ? StationCellShape.Half(StationWallSide.N) : StationCellShape.Full,
                    PressX = pointer.X,
                    PressY = pointer.Y,
                    PressTimeMs = pointer.TimeMs,
                    Shift = (pointer.Modifiers & StationPointerModifiers.Shift) != 0,
                    Revision = host.CurrentRevision,
                    ToolGeneration = StationToolSelection.Generation,
                };
                Aim(host, hit, pointer, true);
                return true;
            }
            var cellAnchor = AnchorFor(hit, remove, !remove);
            if (!cellAnchor.HasValue) { reason = "no-cell"; return false; }
            if (string.Equals(tool, "module", StringComparison.Ordinal) &&
                StationModuleRuns.IsLinePalette(StationToolSelection.Setting("moduleType"))) {
                // A run family (围栏 / 盲道 / floor mark) lays a dragged line of panels instead
                // of one piece per press (`EquipmentTool.beginLineAdd`).
                gesture = new StationCellGesture {
                    Kind = StationCellGestureKind.ModuleRun,
                    Tool = tool,
                    Button = button,
                    Remove = remove,
                    Anchor = cellAnchor.Value,
                    Target = cellAnchor.Value,
                    PressX = pointer.X,
                    PressY = pointer.Y,
                    PressTimeMs = pointer.TimeMs,
                    Shift = (pointer.Modifiers & StationPointerModifiers.Shift) != 0,
                    Revision = host.CurrentRevision,
                    ToolGeneration = StationToolSelection.Generation,
                };
                Aim(host, hit, pointer, true);
                return true;
            }
            var shape = remove || settings.SuspendedCeiling ? StationCellShape.Full : settings.Shape;
            gesture = new StationCellGesture {
                Kind = StationCellGestureKind.Block,
                Tool = tool ?? "",
                Button = button,
                Remove = remove,
                Ceiling = !remove && settings.SuspendedCeiling,
                AutoWalls = !remove && !settings.SuspendedCeiling && settings.AutoWalls,
                Shape = shape,
                Anchor = cellAnchor.Value,
                Target = cellAnchor.Value,
                PressX = pointer.X,
                PressY = pointer.Y,
                PressTimeMs = pointer.TimeMs,
                Shift = (pointer.Modifiers & StationPointerModifiers.Shift) != 0,
                Revision = host.CurrentRevision,
                ToolGeneration = StationToolSelection.Generation,
            };
            Aim(host, hit, pointer, true);
            return true;
        }

        /// <summary>
        /// The whole cell one hit names, from the **nearest drawn surface**: a placed module
        /// that wins the pick (paving, a track deck, a cabinet) names its own face exactly as
        /// `render/pickCell.ts:pickCells` does, so the paver in the report anchors one cell
        /// above the paver's own drawn top instead of at the ground behind it. A cell surface
        /// keeps its authored cell and face step.
        /// </summary>
        /// <summary>
        /// True while the committed cell tool's operation is an **add**, the one operation the
        /// reference lets the active storey's work plane answer for (plan 29 §1).
        ///
        /// `CameraSystem.pick` intersects the plane at `activeZ + 1` after a geometry miss and
        /// returns a non-solid cell at `activeZ`; `BlockTool` anchors an add on that cell
        /// (`hit.solid ? hit.place : hit.cell`) and an erase on `hit.cell` only. Unity used to
        /// ask for the plane for placement tools alone, so 方块 could not place in the void at
        /// the depth being edited; the same predicate now decides both whether the pick
        /// evaluates the plane and whether the anchor may read it.
        /// </summary>
        public static bool WantsWorkPlane(string tool) {
            if (HasGesture) return !gesture.Remove;
            if (string.Equals(tool, "delete", StringComparison.Ordinal)) return false;
            if (string.Equals(tool, "module", StringComparison.Ordinal)) return true;
            return StationPointerRouter.IsCellTool(tool);
        }

        /// <summary>
        /// The whole cell one hit names, from the **nearest drawn surface**: a placed module
        /// that wins the pick (paving, a track deck, a cabinet) names its own face exactly as
        /// `render/pickCell.ts:pickCells` does, so the paver in the report anchors one cell
        /// above the paver's own drawn top instead of at the ground behind it. A cell surface
        /// keeps its authored cell and face step.
        ///
        /// `allowWorkPlane` lets an **add** read the active storey's plane fallback when no
        /// visible surface answered (`CameraSystem.pick`'s `workPlaneZ` branch). The plane hit
        /// is the cell at the edited level, exactly as web's non-solid plane `cell` is, so the
        /// authored block lands at `level` and the plane itself was intersected at `level + 1`.
        /// </summary>
        static StationPlacementHit? CellOf(StationSceneHit hit, bool allowWorkPlane = false) {
            if (hit == null) return null;
            var cell = hit.EditCell;
            if (cell.HasCell) return cell;
            if (!allowWorkPlane || !hit.HasWorkPlane) return null;
            return hit.WorkPlane;
        }

        /// <summary>The cell a hit places into (add) or takes away (erase).</summary>
        static StationCellKey? AnchorFor(StationSceneHit hit, bool remove, bool allowWorkPlane = false) {
            var found = CellOf(hit, allowWorkPlane && !remove);
            if (!found.HasValue) return null;
            var cell = found.Value;
            if (!remove && cell.Solid) return new StationCellKey(cell.PlaceX, cell.PlaceY, cell.PlaceZ);
            return new StationCellKey(cell.X, cell.Y, cell.Z);
        }

        /// <summary>
        /// The cell a wall press/hover snaps its column to: the air cell in front of the hit
        /// face, so the same surface resolves the same column on hover and at the release.
        /// </summary>
        static StationCellKey? WallAnchorFor(StationSceneHit hit, bool remove, bool allowWorkPlane = false) {
            var found = CellOf(hit, allowWorkPlane && !remove);
            if (!found.HasValue) return null;
            var cell = found.Value;
            if (remove) return new StationCellKey(cell.X, cell.Y, cell.Z);
            return cell.Solid
                ? new StationCellKey(cell.PlaceX, cell.PlaceY, cell.PlaceZ)
                : new StationCellKey(cell.X, cell.Y, cell.Z);
        }

        /// <summary>The hit's surface point in plan space, for the wall snap's side choice.</summary>
        static StationPoint PointOf(StationSceneHit hit, StationCellKey anchor) {
            if (hit != null && hit.HasModule && hit.ModuleWins) return hit.ModulePoint;
            if (hit != null && hit.HasCell) return hit.Cell.Point;
            return new StationPoint(anchor.X + 0.5, anchor.Y + 0.5, anchor.Z);
        }

        // -------------------------------------------------------------------- aim

        /// <summary>
        /// Re-plan the gesture (or the plain hover) against one fresh hit. `fresh` marks the
        /// press's first aim, where the reference draws the single-cell ghost immediately.
        /// </summary>
        public static void Aim(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer, bool fresh = false) {
            var worldRef = World(host);
            if (worldRef == null) return;
            if (gesture == null) {
                var settings = StationCellToolSettings.Read();
                var cell = AnchorFor(hit, false, WantsWorkPlane(StationToolSelection.Active));
                if (cell.HasValue) {
                    hasHover = true;
                    hoverCell = cell.Value;
                    hoverLevel = cell.Value.Z;
                    hoverRevision = host.CurrentRevision;
                    preview = HoverPreview(worldRef, hit, settings);
                } else {
                    hasHover = false;
                    preview = new StationCellPreview();
                }
                return;
            }
            gesture.Shift = (pointer.Modifiers & StationPointerModifiers.Shift) != 0;
            if (gesture.Kind == StationCellGestureKind.Block && !gesture.Remove && !gesture.Ceiling &&
                !gesture.Shape.IsFull) {
                // A press held in a cut mode keeps its anchor but follows **R** (`BlockTool`'s
                // `d.shape = shape` in `refreshHover`): the ghost's side is the side the release
                // lays, so a stationary R must move both.
                var now = StationCellToolSettings.Read();
                if (!now.Shape.IsFull) gesture.Shape = now.Shape;
            }
            if (gesture.Kind == StationCellGestureKind.Wall) {
                var wallAim = WallAnchorFor(hit, gesture.Remove, WantsWorkPlane(gesture.Tool));
                if (wallAim.HasValue) {
                    var anchor = wallAim.Value;
                    if (gesture.Remove) {
                        gesture.Target = anchor;
                    } else {
                        var point = PointOf(hit, anchor);
                        var snap = StationCellPlanner.WallSnap(worldRef, anchor, point.X, point.Y, true,
                            StationCellToolSettings.Read().WallSnapCycle);
                        gesture.Target = snap.Base;
                    }
                }
            } else if (gesture.Kind == StationCellGestureKind.Delete) {
                var deleteAim = AnchorFor(hit, true);
                if (deleteAim.HasValue) gesture.Target = deleteAim.Value;
                if (gesture.HasModules) {
                    // The sweep grows with the pieces the pointer crossed; it never shrinks.
                    if (gesture.SweepFamily.Length > 0) SweepThrough(worldRef);
                } else if (hit.HasModule && hit.ModuleWins) {
                    gesture.ModuleIds.Add(hit.Module.Id);
                    gesture.SweepFamily = StationSweep.FamilyOf(hit.Module) ?? "";
                }
            } else if (gesture.Kind == StationCellGestureKind.ModuleRun) {
                var runAim = AnchorFor(hit, gesture.Remove, WantsWorkPlane(gesture.Tool));
                if (runAim.HasValue) gesture.Target = runAim.Value;
            } else {
                var cell = AnchorFor(hit, gesture.Remove, WantsWorkPlane(gesture.Tool));
                if (cell.HasValue) gesture.Target = cell.Value;
            }
            hasHover = true;
            hoverCell = gesture.Target;
            hoverLevel = gesture.Target.Z;
            hoverRevision = host.CurrentRevision;
            gesture.Dragging = IsDeliberate(gesture, pointer);
            preview = Plan(worldRef, gesture, pointer);
        }

        /// <summary>
        /// Grow a delete sweep with the same-family pieces the drag crossed between the
        /// press and the current pointer. The cells between the two are the straight run the
        /// pointer travelled, which is the set a held drag visibly passes over for grid
        /// furniture; every piece of the pressed family whose footprint holds one of them
        /// joins the pending list, once. The reference samples the pointer path in screen
        /// space; a document-only answer keeps the sweep deterministic and needs no extra
        /// pick per event (plan 27 §2's one-pick rule).
        /// </summary>
        static void SweepThrough(StationCellEditWorld worldRef) {
            var path = StationCellPlanner.StraightLineCells(gesture.Anchor, gesture.Target, gesture.Anchor.Z);
            foreach (var cell in path) {
                foreach (var module in worldRef.Index.Document.Modules) {
                    if (gesture.ModuleIds.Contains(module.Id)) continue;
                    if (!string.Equals(StationSweep.FamilyOf(module), gesture.SweepFamily, StringComparison.Ordinal)) continue;
                    if (module.Z != cell.Z && !(cell.Z == gesture.Anchor.Z && module.Z == gesture.Anchor.Z)) continue;
                    if (!FootprintHolds(module, cell.X, cell.Y)) continue;
                    gesture.ModuleIds.Add(module.Id);
                }
            }
        }

        /// <summary>True when a module's authored footprint holds the plan cell.</summary>
        static bool FootprintHolds(StationModuleRecord module, int x, int y) {
            var footprint = StationFootprints.TryFootprint(module, out var cells, out _)
                ? cells
                : new[] { module.Point };
            foreach (var cell in footprint) {
                if ((int)Math.Round(cell.X) == x && (int)Math.Round(cell.Y) == y) return true;
            }
            return false;
        }

        /// <summary>
        /// The reference's click-versus-drag test: a **deliberate** press (160 ms held and
        /// more than 4 px of travel) becomes a rectangle; a quick press stays one cell even
        /// when the pointer jitters.
        /// </summary>
        static bool IsDeliberate(StationCellGesture current, StationPointerEvent pointer) {
            if (pointer.TimeMs < 0 || current.PressTimeMs < 0) {
                // No client clock (a synthetic event): treat the gesture as a quick press, which
                // is the safe answer — a single cell, never an accidental rectangle.
                return false;
            }
            double held = pointer.TimeMs - current.PressTimeMs;
            if (held < StationCellPlanner.LongPressMs) return false;
            float dx = pointer.X - current.PressX, dy = pointer.Y - current.PressY;
            return Mathf.Sqrt(dx * dx + dy * dy) > StationCellPlanner.DragPixels;
        }

        /// <summary>The ghost under a still pointer, per committed tool.</summary>
        static StationCellPreview HoverPreview(StationCellEditWorld worldRef, StationSceneHit hit,
            StationCellToolSettings settings) {
            var tool = StationToolSelection.Active;
            if (string.Equals(tool, "wall", StringComparison.Ordinal)) {
                // A wall hover shows the whole storey column the click would raise.
                var column = StationCellPlanner.StoreyWallRun(new[] { hoverCell }, worldRef.LevelBase, worldRef.StoreyHeight);
                return new StationCellPreview {
                    Kind = "wall",
                    Cursor = hoverCell,
                    Check = StationCellPlanner.CheckBlockCells(worldRef, column),
                };
            }
            if (string.Equals(tool, "delete", StringComparison.Ordinal)) {
                if (hit != null && hit.HasModule && hit.ModuleWins) {
                    var previewOut = new StationCellPreview { Kind = "delete", Cursor = hoverCell };
                    previewOut.ModuleIds.Add(hit.Module.Id);
                    return previewOut;
                }
                var single = new List<StationCellKey> { hoverCell };
                var solid = new List<StationCellKey>();
                foreach (var cell in single) if (worldRef.IsSolid(cell.X, cell.Y, cell.Z)) solid.Add(cell);
                var erase = new StationCellPreview { Kind = "erase", Cursor = hoverCell };
                erase.Check.Cells.AddRange(single);
                erase.Check.Accepted.AddRange(solid);
                return erase;
            }
            var cells = new List<StationCellKey> { hoverCell };
            if (settings.SuspendedCeiling) return CeilingPreview(worldRef, cells);
            if (!settings.Shape.IsFull) return CutPreview(worldRef, cells, settings.Shape);
            return new StationCellPreview {
                Kind = "add",
                Cursor = hoverCell,
                Check = StationCellPlanner.CheckBlockCells(worldRef, cells),
                Length = 1,
                Width = 1,
            };
        }

        /// <summary>The live plan for an armed gesture, in the reference's own order.</summary>
        static StationCellPreview Plan(StationCellEditWorld worldRef, StationCellGesture current,
            StationPointerEvent pointer) {
            var anchor = current.Anchor;
            var target = current.Target;
            var cursor = current.Dragging ? target : anchor;
            int z = anchor.Z;
            if (current.Kind == StationCellGestureKind.Wall) return PlanWall(worldRef, current, cursor);
            if (current.Kind == StationCellGestureKind.Delete) return PlanDelete(worldRef, current, cursor);
            if (current.Kind == StationCellGestureKind.ModuleRun) return PlanModuleRun(worldRef, current, cursor);
            if (current.Remove) {
                var rect = current.Dragging
                    ? StationCellPlanner.RectCells(anchor, target, z, current.Shift)
                    : new List<StationCellKey> { anchor };
                // A remove drag is narrowed to the blocks it would really change, so the red
                // highlight reads as "what this release will do".
                var solid = new List<StationCellKey>();
                foreach (var cell in rect) if (worldRef.IsSolid(cell.X, cell.Y, cell.Z)) solid.Add(cell);
                var check = new StationCellPreview {
                    Kind = "erase",
                    Cursor = cursor,
                    Length = current.Dragging ? Math.Abs(target.X - anchor.X) + 1 : 1,
                    Width = current.Dragging ? Math.Abs(target.Y - anchor.Y) + 1 : 1,
                };
                check.Check.Accepted.AddRange(solid);
                check.Check.Cells.AddRange(rect);
                return check;
            }
            if (current.Ceiling) {
                var cells = current.Dragging
                    ? StationCellPlanner.RectCells(anchor, target, z, current.Shift)
                    : new List<StationCellKey> { anchor };
                var ceiling = CeilingPreview(worldRef, cells);
                ceiling.Cursor = cursor;
                ceiling.Length = current.Dragging ? Math.Abs(target.X - anchor.X) + 1 : 1;
                ceiling.Width = current.Dragging ? Math.Abs(target.Y - anchor.Y) + 1 : 1;
                return ceiling;
            }
            if (current.IsCut) {
                // 半墙 / 薄墙角 / 三角: one piece per click, a ridge-locked line per drag — the
                // only axis read off the target, so a run can never turn across its own cut.
                var side = current.Shape.Side;
                var line = current.Dragging
                    ? StationCellPlanner.TriangleLineCells(anchor, target, z, side)
                    : new List<StationCellKey> { anchor };
                int count = StationCellPlanner.CutLineCellCount(anchor, target, side);
                if (current.Dragging && count > StationCellPlanner.MaxDragCells) {
                    var tooLarge = new StationCellPreview {
                        Kind = "cut",
                        Cursor = new StationCellKey(target.X, target.Y, z),
                        Notice = "over-limit",
                        OverLimit = true,
                        Shape = current.Shape,
                    };
                    tooLarge.Check.Shape = current.Shape;
                    tooLarge.Check.Blocked.AddRange(line);
                    tooLarge.Check.Cells.AddRange(line);
                    return tooLarge;
                }
                var cut = CutPreview(worldRef, line, current.Shape);
                cut.Cursor = cursor;
                cut.Length = current.Dragging ? Math.Abs(target.X - anchor.X) + 1 : 1;
                cut.Width = current.Dragging ? Math.Abs(target.Y - anchor.Y) + 1 : 1;
                return cut;
            }
            int length = current.Dragging ? Math.Abs(target.X - anchor.X) + 1 : 1;
            int width = current.Dragging ? Math.Abs(target.Y - anchor.Y) + 1 : 1;
            var cellsPlain = current.Dragging
                ? StationCellPlanner.RectCells(anchor, target, z, current.Shift)
                : new List<StationCellKey> { anchor };
            int budget = StationCellPlanner.DragCellCount(anchor, target, current.Shift);
            if (current.Dragging && budget > StationCellPlanner.MaxDragCells) {
                var tooLarge = new StationCellPreview {
                    Kind = current.AutoWalls ? "floor" : "add",
                    Cursor = target,
                    Notice = "over-limit",
                    OverLimit = true,
                    Length = length,
                    Width = width,
                };
                tooLarge.Check.Cells.AddRange(cellsPlain);
                tooLarge.Check.Blocked.AddRange(cellsPlain);
                return tooLarge;
            }
            var add = new StationCellPreview {
                Kind = current.AutoWalls ? "floor" : "add",
                Cursor = cursor,
                Length = length,
                Width = width,
            };
            // A deliberate drag with 生成墙壁 on draws a walled surface: the ring the release
            // would raise is previewed with the blocks themselves, and judged by the same rule.
            if (current.Dragging && current.AutoWalls) {
                var baseCheck = StationCellPlanner.CheckBlockCells(worldRef, cellsPlain);
                var ring = StationCellPlanner.PlannedAutoWalls(worldRef, baseCheck.Accepted, worldRef.StoreyHeight);
                add.AutoWalls.AddRange(ring);
                var all = new List<StationCellKey>(baseCheck.Accepted);
                all.AddRange(ring);
                if (all.Count > StationCellPlanner.MaxDragCells) {
                    add.Notice = "over-limit";
                    add.OverLimit = true;
                    add.Check.Cells.AddRange(cellsPlain);
                    add.Check.Blocked.AddRange(cellsPlain);
                    return add;
                }
                add.Check = StationCellPlanner.CheckBlockCells(worldRef, all);
                return add;
            }
            add.Check = StationCellPlanner.CheckBlockCells(worldRef, cellsPlain);
            return add;
        }

        /// <summary>The 墙 tool's plan: a storey-high run of columns, or the columns it lifts.</summary>
        static StationCellPreview PlanWall(StationCellEditWorld worldRef, StationCellGesture current,
            StationCellKey cursor) {
            var anchor = current.Anchor;
            var target = current.Target;
            int z = anchor.Z;
            if (current.Remove) {
                var line = current.Dragging
                    ? StationCellPlanner.StraightLineCells(anchor, target, z)
                    : new List<StationCellKey> { anchor };
                var columns = StationCellPlanner.StoreyColumnsAt(worldRef, line);
                var previewOut = new StationCellPreview {
                    Kind = "delete",
                    Cursor = cursor,
                    Length = current.Dragging ? Math.Abs(target.X - anchor.X) + 1 : 1,
                    Width = current.Dragging ? Math.Abs(target.Y - anchor.Y) + 1 : 1,
                };
                previewOut.Check.Accepted.AddRange(columns);
                return previewOut;
            }
            var runLine = current.Dragging
                ? StationCellPlanner.StraightLineCells(anchor, target, z)
                : new List<StationCellKey> { anchor };
            var courses = StationCellPlanner.StoreyWallRun(runLine, worldRef.LevelBase, worldRef.StoreyHeight);
            int columns2 = runLine.Count;
            int perColumn = courses.Count;
            if (columns2 * perColumn > StationCellPlanner.MaxDragCells && columns2 > 1) {
                var tooLarge = new StationCellPreview {
                    Kind = "wall",
                    Cursor = cursor,
                    Notice = "over-limit",
                    OverLimit = true,
                    Length = Math.Abs(target.X - anchor.X) + 1,
                    Width = Math.Abs(target.Y - anchor.Y) + 1,
                };
                tooLarge.Check.Blocked.AddRange(courses);
                tooLarge.Check.Cells.AddRange(courses);
                return tooLarge;
            }
            return new StationCellPreview {
                Kind = "wall",
                Cursor = cursor,
                Check = StationCellPlanner.CheckBlockCells(worldRef, courses),
                Length = current.Dragging ? Math.Abs(target.X - anchor.X) + 1 : 1,
                Width = current.Dragging ? Math.Abs(target.Y - anchor.Y) + 1 : 1,
            };
        }

        /// <summary>
        /// The run tools' plan (plan 27 §5): the straight line of panels the release would lay
        /// (or lift), each cell resolved by the one candidate resolver — so a panel that meets a
        /// 闸机 or a reserved opening is refused by the same rules a single placement is.
        /// </summary>
        static StationCellPreview PlanModuleRun(StationCellEditWorld worldRef, StationCellGesture current,
            StationCellKey cursor) {
            var anchor = current.Anchor;
            var target = current.Target;
            int z = anchor.Z;
            var line = current.Dragging
                ? StationModuleRuns.LineCells(anchor, target, z)
                : new List<StationCellKey> { anchor };
            var previewOut = new StationCellPreview {
                Kind = "run",
                Cursor = cursor,
                Length = current.Dragging ? Math.Abs(target.X - anchor.X) + 1 : 1,
                Width = current.Dragging ? Math.Abs(target.Y - anchor.Y) + 1 : 1,
            };
            if (line.Count > StationModuleRuns.MaxRunCells) {
                previewOut.Notice = "over-limit";
                previewOut.OverLimit = true;
                previewOut.Check.Blocked.AddRange(line);
                previewOut.Check.Cells.AddRange(line);
                return previewOut;
            }
            var plan = StationModuleRuns.PlanAdd(worldRef.Index, RunTemplate(), null, line, current.Remove);
            previewOut.Check = StationModuleRuns.ToCheck(plan);
            if (current.Remove) {
                // An erase run shows the pieces it lifts: every accepted cell is one panel going
                // away, so the red/blue split reads as "what this release does".
                previewOut.Check.Accepted.Clear();
                previewOut.Check.Accepted.AddRange(plan.AcceptedCells);
                previewOut.ModuleIds.AddRange(plan.RemoveIds);
            }
            return previewOut;
        }

        /// <summary>The armed run's settings as one placement template (its hit is per cell).</summary>
        static StationPlacementRequest RunTemplate() => new StationPlacementRequest {
            ToolType = StationToolSelection.Setting("moduleType"),
            Variant = StationToolSelection.Setting("variant"),
            Rotation = StationToolSelection.SettingInt("rotation", 0),
            Width = StationToolSelection.SettingInt("width", 0),
            LineId = StationToolSelection.Setting("lineId"),
            CurtainHeight = StationToolSelection.SettingInt("curtainHeight", 4),
        };

        /// <summary>The 删除 tool's plan: the pieces it takes, or the blocks it digs.</summary>
        static StationCellPreview PlanDelete(StationCellEditWorld worldRef, StationCellGesture current,
            StationCellKey cursor) {
            if (current.HasModules) {
                var previewOut = new StationCellPreview { Kind = "delete", Cursor = cursor };
                previewOut.ModuleIds.AddRange(current.ModuleIds);
                return previewOut;
            }
            var anchor = current.Anchor;
            var target = current.Target;
            int z = anchor.Z;
            var rect = current.Dragging
                ? StationCellPlanner.RectCells(anchor, target, z, current.Shift)
                : new List<StationCellKey> { anchor };
            var previewErase = new StationCellPreview {
                Kind = "erase",
                Cursor = cursor,
                Length = current.Dragging ? Math.Abs(target.X - anchor.X) + 1 : 1,
                Width = current.Dragging ? Math.Abs(target.Y - anchor.Y) + 1 : 1,
            };
            previewErase.Check.Cells.AddRange(rect);
            foreach (var cell in rect) if (worldRef.IsSolid(cell.X, cell.Y, cell.Z)) previewErase.Check.Accepted.Add(cell);
            return previewErase;
        }

        static StationCellPreview CutPreview(StationCellEditWorld worldRef, List<StationCellKey> cells,
            StationCellShape shape) {
            return new StationCellPreview {
                Kind = "cut",
                Cursor = cells.Count > 0 ? cells[0] : default,
                Check = StationCellPlanner.CheckCutCells(worldRef, cells, shape),
                Shape = shape,
            };
        }

        static StationCellPreview CeilingPreview(StationCellEditWorld worldRef, List<StationCellKey> cells) {
            return new StationCellPreview {
                Kind = "ceiling",
                Cursor = cells.Count > 0 ? cells[0] : default,
                Check = StationCellPlanner.CheckBlockCells(worldRef, cells),
            };
        }

        /// <summary>
        /// Rebuild the ghost the pointer already aims at: `R`/`Tab`, a new tool, a changed
        /// setting, a view or camera change and a commit all move what the still pointer is
        /// over, and nothing else would redraw it.
        ///
        /// It resolves the **same** fresh ray and the same full hit a pointer move would
        /// (plan 28 §2), rather than re-planning against a cached coordinate: a camera move, a
        /// storey switch or a tool returning to 方块 must land the ghost where the click would
        /// land, including when no pointer move ever arrives after the change.
        /// </summary>
        public static bool RefreshHover(StationGameHost host) {
            if (host == null || !host.IsLoaded) return false;
            if (!StationPointerRouter.CellToolActive) return false;
            StationEditScene.ResolveView(host, out _, out var camera, out var activeLevel, out var visibility);
            var worldRef = World(host);
            if (camera == null || worldRef == null) return false;
            if (StationEditSession.HasPointer) {
                var ray = camera.ScreenPointToRay(StationEditSession.PointerScreen());
                // The stationary refresh evaluates exactly the plane the live move would
                // (plan 29 §1), so a camera/storey change over the void lands the same ghost.
                var hit = StationEditScene.PickRay(host, host.Coordinator?.World, camera, ray, activeLevel, visibility,
                    StationPointerRouter.NeedsWorkPlane(StationToolSelection.Active), out _, out _);
                if (hit != null) {
                    Aim(host, hit, StationEditSession.Pointer);
                    StationEditSession.Cells = preview;
                    return true;
                }
                Miss();
                return false;
            }
            // No pointer in the stage (the shell parked it): re-plan the cached cell so the
            // settings change still reaches the published plan, but draw nothing.
            if (gesture != null || !hasHover || hoverRevision != host.CurrentRevision) return false;
            preview = HoverPreview(worldRef, null, StationCellToolSettings.Read());
            StationEditSession.Cells = preview;
            return true;
        }

        /// <summary>
        /// The pointer resolved no surface at all (off the station, past the skybox): the
        /// reference's `cancelPreview` drops what was drawn while a held gesture keeps its
        /// anchor, so no stale ghost promises an edit the pointer is no longer aiming at.
        /// </summary>
        public static void Miss() {
            if (gesture == null) {
                hasHover = false;
                preview = new StationCellPreview();
            }
            StationEditSession.Cells = null;
        }

        // ----------------------------------------------------------------- release

        /// <summary>
        /// Commit the gesture's plan. Returns false with a reason when the release is not a
        /// cell edit (a miss with nothing aimed, a stale press, an over-limit drag).
        /// </summary>
        public static bool Finish(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            out string code, out string reason) {
            code = null;
            reason = null;
            var current = gesture;
            gesture = null;
            if (current == null) { reason = "no-gesture"; return false; }
            if (host == null || !host.IsLoaded) { reason = "no-session"; return false; }
            if (current.Revision != host.CurrentRevision) {
                // The station moved under the press (an undo, another client): the release must
                // not apply a plan built against a document that no longer exists.
                preview = new StationCellPreview();
                reason = "stale-revision";
                return false;
            }
            var worldRef = World(host);
            if (worldRef == null) { reason = "no-session"; return false; }
            // The release's own aim decides `dragging`: the reference re-tests held time and
            // travel at the release, not at the last move, so a slow click that never moved is
            // still one cell.
            current.Dragging = IsDeliberate(current, pointer);
            if (hit != null) {
                if (current.Kind == StationCellGestureKind.Block) {
                    var target = AnchorFor(hit, current.Remove, WantsWorkPlane(current.Tool));
                    if (target.HasValue) current.Target = target.Value;
                } else if (current.Kind == StationCellGestureKind.Wall) {
                    var wallAim = WallAnchorFor(hit, current.Remove, WantsWorkPlane(current.Tool));
                    if (wallAim.HasValue) {
                        var anchor = wallAim.Value;
                        current.Target = current.Remove
                            ? anchor
                            : StationCellPlanner.WallSnap(worldRef, anchor,
                                PointOf(hit, anchor).X, PointOf(hit, anchor).Y, true,
                                StationCellToolSettings.Read().WallSnapCycle).Base;
                    }
                } else if (current.Kind == StationCellGestureKind.Delete && !current.HasModules) {
                    var deleteAim = AnchorFor(hit, true);
                    if (deleteAim.HasValue) current.Target = deleteAim.Value;
                }
            }
            var plan = Plan(worldRef, current, pointer);
            preview = plan;
            StationEditSession.Cells = plan;
            if (plan.OverLimit) { reason = "over-limit"; return false; }
            StationCellPatch patch;
            if (current.Kind == StationCellGestureKind.ModuleRun) {
                var runLine = current.Dragging
                    ? StationModuleRuns.LineCells(current.Anchor, current.Target, current.Anchor.Z)
                    : new List<StationCellKey> { current.Anchor };
                var runPlan = StationModuleRuns.PlanAdd(worldRef.Index, RunTemplate(), null, runLine, current.Remove);
                patch = StationModuleRuns.ToPatch(runPlan);
                if (!patch.HasWork) {
                    reason = runPlan.Reason.Length > 0 ? runPlan.Reason : "nothing-to-do";
                    return false;
                }
            } else if (current.Kind == StationCellGestureKind.Wall) {
                var line = current.Dragging
                    ? StationCellPlanner.StraightLineCells(current.Anchor, current.Target, current.Anchor.Z)
                    : new List<StationCellKey> { current.Anchor };
                if (current.Remove) {
                    var columns = StationCellPlanner.StoreyColumnsAt(worldRef, line);
                    if (columns.Count == 0) { reason = "nothing-to-do"; return false; }
                    patch = StationCellPlanner.PlanRemoveCells(worldRef, columns);
                } else {
                    var settings = StationCellToolSettings.Read();
                    StationWallSide? side = settings.HalfWall
                        ? StationCellPlanner.HalfWallRunSide(line, current.WallDirs, settings.WallSnapCycle)
                        : (StationWallSide?)null;
                    patch = StationCellPlanner.PlanWalls(worldRef, line, side, 0);
                }
            } else if (current.Kind == StationCellGestureKind.Delete) {
                if (current.HasModules) {
                    patch = new StationCellPatch();
                    foreach (var id in current.ModuleIds) {
                        if (!host.Index.TryGetModule(id, out _)) continue;
                        patch.RemoveModuleIds.Add(id);
                        patch.Changed++;
                    }
                } else {
                    if (plan.Check.Accepted.Count == 0) { reason = "nothing-to-do"; return false; }
                    patch = StationCellPlanner.PlanRemoveCells(worldRef, plan.Check.Accepted);
                }
            } else if (plan.Kind == "erase") {
                if (plan.Check.Accepted.Count == 0) { reason = "nothing-to-do"; return false; }
                patch = StationCellPlanner.PlanRemoveCells(worldRef, plan.Check.Accepted);
            } else if (plan.Kind == "cut") {
                if (plan.Check.Accepted.Count == 0) { reason = "nothing-to-do"; return false; }
                patch = StationCellPlanner.PlanCut(worldRef, plan.Check.Accepted, current.Shape);
            } else if (plan.Kind == "ceiling") {
                if (plan.Check.Accepted.Count == 0) { reason = "nothing-to-do"; return false; }
                patch = StationCellPlanner.PlanSuspendedCeiling(worldRef, plan.Check.Accepted);
            } else if (plan.Kind == "floor") {
                if (plan.Check.Accepted.Count == 0) { reason = "nothing-to-do"; return false; }
                patch = StationCellPlanner.PlanAutoFloor(worldRef, plan.Check.Accepted);
            } else {
                if (plan.Check.Accepted.Count == 0) { reason = "nothing-to-do"; return false; }
                patch = StationCellPlanner.PlanAddCells(worldRef, plan.Check.Accepted);
            }
            if (!patch.HasWork && patch.RemoveModuleIds.Count == 0) {
                reason = "nothing-to-do";
                return false;
            }
            if (!StationEditSession.TryApplyCells(host, patch, plan.Kind, null, out _, out code)) {
                reason = code;
                return false;
            }
            ForgetWorld();
            preview = new StationCellPreview();
            StationEditSession.Cells = null;
            // A committed gesture leaves the pointer over the cell it just built, so the next
            // hover re-aims from the committed geometry instead of the old ghost.
            hasHover = false;
            return true;
        }

        /// <summary>Drop the gesture and its ghost (Escape, a right tap, a leave, a world change).</summary>
        public static void Cancel() {
            gesture = null;
            preview = new StationCellPreview();
            StationEditSession.Cells = null;
        }

        /// <summary>A pointer leave parks the ghost but keeps a carried gesture's aim.</summary>
        public static void Leave() {
            if (gesture != null) return;
            hasHover = false;
            preview = new StationCellPreview();
            StationEditSession.Cells = null;
        }

        /// <summary>Publish the aimed preview into the session snapshot (after each event).</summary>
        public static void Publish() {
            StationEditSession.Cells = HasGesture || preview.HasPlan ? preview : null;
        }
    }

    /// <summary>`pointerInput.ts`'s modifier bit for Shift.</summary>
    public static class StationPointerModifiers {
        public const int Alt = 1;
        public const int Ctrl = 2;
        public const int Meta = 4;
        public const int Shift = 8;
    }

    /// <summary>The cell tools' settings, read from the committed <c>tool.set</c> payload.</summary>
    public readonly struct StationCellToolSettings {
        public readonly bool HalfWall;
        public readonly bool HalfCorner;
        public readonly bool Triangles;
        public readonly StationTriangleKind TriKind;
        public readonly int WallSnapCycle;
        public readonly bool AutoWalls;
        public readonly bool SuspendedCeiling;

        StationCellToolSettings(bool halfWall, bool halfCorner, bool triangles, StationTriangleKind triKind,
            int cycle, bool autoWalls, bool suspendedCeiling) {
            HalfWall = halfWall; HalfCorner = halfCorner; Triangles = triangles; TriKind = triKind;
            WallSnapCycle = cycle; AutoWalls = autoWalls; SuspendedCeiling = suspendedCeiling;
        }

        /// <summary>The four cut sides in the reference's clockwise order A=N, B=E, C=S, D=W.</summary>
        public static readonly StationWallSide[] Sides = {
            StationWallSide.N, StationWallSide.E, StationWallSide.S, StationWallSide.W,
        };

        /// <summary>
        /// The piece a click lays in a cut mode, or <see cref="StationCellShape.Full"/> for
        /// whole blocks (`geometry/walls.ts:cutShapeFor`). Every cut piece uses an **absolute**
        /// side, so a neighbour or the pointer's position never changes the chosen direction.
        /// </summary>
        public StationCellShape Shape {
            get {
                var side = Sides[((WallSnapCycle % 4) + 4) % 4];
                if (HalfWall) return HalfCorner ? StationCellShape.Corner(side) : StationCellShape.Half(side);
                if (Triangles) return StationCellShape.Wedge(TriKind, side);
                return StationCellShape.Full;
            }
        }

        public static StationCellToolSettings Read() {
            var triKind = StationToolSelection.Setting("triKind");
            return new StationCellToolSettings(
                StationToolSelection.SettingBool("halfWall"),
                StationToolSelection.SettingBool("halfCorner"),
                StationToolSelection.SettingBool("triangles"),
                string.Equals(triKind, "lower", StringComparison.Ordinal) ? StationTriangleKind.Lower : StationTriangleKind.Upper,
                StationToolSelection.SettingInt("wallSnapCycle", 0),
                StationToolSelection.SettingBool("autoWalls"),
                StationToolSelection.SettingBool("suspendedCeiling"));
        }
    }

    /// <summary>
    /// The carve's reserved openings, injected into the pure planner (plan 27 §3: "the exact
    /// ramp cut/retained-wedge rules"). `Metro.Build` cannot reference `Metro.View`, where the
    /// carve tables live, so this adapter is the one seam.
    /// </summary>
    public sealed class StationCellReservations : IStationCellReservations {
        readonly StationIndex index;
        readonly Dictionary<int, HashSet<StationCellKey>> byLevel = new Dictionary<int, HashSet<StationCellKey>>();

        public StationCellReservations(StationIndex index) { this.index = index; }

        public HashSet<StationCellKey> OpeningsAtLevel(int z) {
            if (byLevel.TryGetValue(z, out var known)) return known;
            var openings = StationRampOpenings.RampOpeningsAtLevel(index.Document.Modules, z);
            byLevel[z] = openings;
            return openings;
        }
    }
}
