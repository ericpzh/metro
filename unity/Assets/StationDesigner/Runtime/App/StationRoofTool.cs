using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// The 屋顶 gesture owner (plan 28 §3): a port of `TileEquipmentTool` for the five Structure
    /// roof tiles — 板 (`roof`), 无桁架 (`roof-shell`), 桁架 (`roof-truss`), 锥形桁架
    /// (`roof-tapered`) and 雨棚 (`roof-canopy`).
    ///
    /// Unlike the one-piece equipment palette, a roof tile is an **area or bay gesture**: a thin
    /// plate fills a rectangle the drag draws, a truss bay runs a line of four-metre bays along
    /// its own crest axis, and the release lays (or lifts) every piece the ghost showed. The aim
    /// plane is the tile's own, not the pointer's surface — a slab follows the block face it is
    /// dropped over (so it can sit on the upper or lower half of a cell), while a truss/canopy
    /// aims on a **horizontal plane** at the shell's eave height — and the same
    /// <see cref="Cells"/> answer feeds hover, the settings refresh and the release, so the ghost
    /// is the batch the press commits.
    ///
    /// Nothing here writes: <see cref="Begin"/>/<see cref="Finish"/> hand one
    /// <see cref="StationCellPatch"/> to the shared transaction, so a roof gesture is one
    /// revision and one undo frame like every other edit.
    /// </summary>
    public static class StationRoofTool {
        /// <summary>The catalogue bay: four cells along the run (`TRUSS_ROOF_BAY`).</summary>
        public const int Bay = 4;
        /// <summary>`DRAG_PX`: pointer travel that counts as a drag.</summary>
        public const float DragPixels = 4f;
        /// <summary>`LONG_PRESS_MS`: hold before a press becomes a rectangle, for the bay tiles.</summary>
        public const double LongPressMs = 160;

        static readonly string[] Tiles = { "roof", "roof-shell", "roof-truss", "roof-tapered", "roof-canopy" };

        /// <summary>The gesture's press record: the anchor, the armed tile and the press itself.</summary>
        sealed class Gesture {
            public string TileType = "";
            public int Rotation;
            public int RoofWidth = 4;
            public int Button;
            public bool Remove;
            public StationCellKey Anchor;
            public StationCellKey Target;
            public string PlateSnap = "";
            public string PickedRoofId = "";
            public float PressX, PressY;
            public double PressTimeMs;

            /// <summary>
            /// The reference's click-versus-drag test: a thin plate fills its rectangle as soon
            /// as the pointer travels, while a bay tile keeps the long-press guard so a quick
            /// tap stays one bay (`TileEquipmentTool.cells`).
            /// </summary>
            public bool Dragging(StationPointerEvent pointer) {
                float dx = pointer.X - PressX, dy = pointer.Y - PressY;
                if (Mathf.Sqrt(dx * dx + dy * dy) <= DragPixels) return false;
                if (string.Equals(TileType, "roof", StringComparison.Ordinal)) return true;
                if (PressTimeMs < 0 || pointer.TimeMs < 0) return false;
                return pointer.TimeMs - PressTimeMs >= LongPressMs;
            }
        }

        static Gesture gesture;
        static readonly List<StationPlacementPlan> accepted = new List<StationPlacementPlan>();
        static readonly List<StationPlacementPlan> refused = new List<StationPlacementPlan>();
        static StationCellKey aim;
        static bool hasAim;

        /// <summary>The batch the release would lay (one plan per aimed cell).</summary>
        public static IReadOnlyList<StationPlacementPlan> Accepted => accepted;
        /// <summary>The batch the release would refuse (drawn red beside the accepted ones).</summary>
        public static IReadOnlyList<StationPlacementPlan> Refused => refused;
        /// <summary>A press is in flight for a roof tile.</summary>
        public static bool HasGesture => gesture != null;
        /// <summary>True while an in-flight roof gesture is removing existing roof pieces.</summary>
        public static bool IsRemoving => gesture != null && gesture.Remove;

        public static bool IsArmed() => IsRoofTile(StationToolSelection.Setting("moduleType")) &&
                                        string.Equals(StationToolSelection.Active, "module", StringComparison.Ordinal);

        static bool IsRoofTile(string paletteId) {
            var id = paletteId ?? "";
            for (int i = 0; i < Tiles.Length; i++) if (string.Equals(Tiles[i], id, StringComparison.Ordinal)) return true;
            return false;
        }

        /// <summary>True for the four truss/canopy bays, which run lines instead of filling areas.</summary>
        static bool IsTrussRun(string tileType) => !string.Equals(tileType, "roof", StringComparison.Ordinal) &&
                                                    IsRoofTile(tileType);

        public static void Reset() {
            gesture = null;
            accepted.Clear();
            refused.Clear();
            hasAim = false;
        }

        // -------------------------------------------------------------------- aim

        /// <summary>
        /// The aim cell for one hit. A thin plate follows the pointed **surface**: a roof piece
        /// already under the pointer snaps to its own cell and plate snap (`roofSnap`), and any
        /// other surface steps one cell out along its face (`hit.place`). A truss bay or canopy
        /// instead aims on the horizontal plane at its eave height, so it stays on the storey
        /// being edited however the camera looks at the shell.
        /// </summary>
        static bool TryAim(StationGameHost host, StationSceneHit hit, Ray ray, string tileType,
            out StationCellKey cell, out string plateSnap) {
            cell = default;
            plateSnap = "";
            if (host == null) return false;
            if (IsTrussRun(tileType)) {
                int level = StationEditSession.Level;
                double height = level + 1 + (string.Equals(tileType, "roof-canopy", StringComparison.Ordinal)
                    ? 0
                    : StationRoofRules.Top);
                if (!TryRayHeight(ray, (float)height, out var point)) return false;
                cell = new StationCellKey(Mathf.RoundToInt(point.x), Mathf.RoundToInt(point.y), level);
                return true;
            }
            // A roof slab under the pointer: its own cell, which is what makes a click on the
            // plate lift or re-drop it instead of hanging a second plate beside it.
            if (hit != null && hit.HasModule && hit.ModuleWins && IsSlab(hit.Module)) {
                cell = new StationCellKey(hit.Module.X, hit.Module.Y, hit.Module.Z);
                plateSnap = hit.Module.Config.Text("plateSnap");
                return true;
            }
            var surface = hit != null ? hit.EditCell : StationPlacementHit.None;
            if (!surface.HasCell) return false;
            cell = new StationCellKey(surface.PlaceX, surface.PlaceY, surface.PlaceZ);
            return true;
        }

        static bool IsSlab(StationModuleRecord module) =>
            module != null && string.Equals(module.Type, "roof", StringComparison.Ordinal) &&
            !StationRoofRules.IsVariant(module.Config.Text("variant"));

        /// <summary>The ray's hit on the horizontal document plane at `height` metres.</summary>
        static bool TryRayHeight(Ray ray, float height, out Vector3 point) {
            point = default;
            var plane = new Plane(Vector3.up, new Vector3(0f, height, 0f));
            if (!plane.Raycast(ray, out var distance) || distance < 0f) return false;
            var world = ray.origin + ray.direction * distance;
            // Unity world (x, z, y) → document (x, y, z): the one conversion lives in StationCoordinates.
            point = StationCoordinates.WorldToDocument(world);
            return true;
        }

        /// <summary>The armed tile's rotation, width and plate snap.</summary>
        static void ReadSettings(out int rotation, out int roofWidth, out string plateSnap) {
            rotation = StationToolSelection.SettingInt("rotation", 0);
            roofWidth = StationRoofRules.SupportedWidth(StationToolSelection.SettingInt("roofWidth", 4));
            plateSnap = StationToolSelection.Setting("roofPlateSnap");
        }

        /// <summary>Re-aim the hover (or the held gesture) at one fresh hit on a camera ray.</summary>
        public static void AimAt(StationGameHost host, StationSceneHit hit, Ray ray, StationPointerEvent pointer) {
            if (host?.Index == null) { Reset(); return; }
            string tileType = gesture != null ? gesture.TileType : StationToolSelection.Setting("moduleType");
            if (!IsRoofTile(tileType)) { Reset(); return; }
            if (!TryAim(host, hit, ray, tileType, out var cell, out var snap)) {
                Miss();
                return;
            }
            if (gesture != null) {
                // A held **add** gesture follows `R`/Tab (`TileEquipmentTool` reads the live
                // `moduleRot`/`roofWidth` while `tileRot` is only fixed for a remove press), so a
                // stationary rotation turns the bays the release will lay.
                if (!gesture.Remove) {
                    gesture.Rotation = StationToolSelection.SettingInt("rotation", 0);
                    gesture.RoofWidth = StationRoofRules.SupportedWidth(StationToolSelection.SettingInt("roofWidth", 4));
                }
                gesture.Target = cell;
                if (snap.Length > 0) gesture.PlateSnap = snap;
            }
            aim = cell;
            hasAim = true;
            Plan(host, pointer);
        }

        /// <summary>
        /// One press: arm the gesture. A roof edit commits on the **release** (`TileEquipmentTool`
        /// drags its area), so the press only records the anchor and draws the first ghost.
        /// </summary>
        public static bool Begin(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            Ray ray, int button, out string reason) {
            reason = null;
            if (host?.Index == null) { reason = "no-session"; return false; }
            string tileType = StationToolSelection.Setting("moduleType");
            string pickedId = "";
            // A secondary press names the piece under the pointer: its own variant, turn and
            // depth are what it lifts, whatever tile the rail happens to be holding.
            if (button == 2) {
                var picked = PickRoof(host.Index, hit);
                if (picked == null) { reason = "no-roof-to-remove"; return false; }
                pickedId = picked.Id;
                tileType = TileOf(picked);
            }
            if (!IsRoofTile(tileType)) { reason = "unsupported-family"; return false; }
            if (!TryAim(host, hit, ray, tileType, out var cell, out var snap)) { reason = "no-cell"; return false; }
            ReadSettings(out var rotation, out var roofWidth, out var armedSnap);
            var pickedRoof = string.IsNullOrEmpty(pickedId) ? null : host.Index.GetModule(pickedId);
            gesture = new Gesture {
                TileType = tileType,
                Rotation = pickedRoof != null ? pickedRoof.Rotation : rotation,
                RoofWidth = pickedRoof != null ? Math.Max(1, pickedRoof.Depth) : roofWidth,
                Button = button,
                Remove = button == 2,
                Anchor = cell,
                Target = cell,
                PlateSnap = snap.Length > 0 ? snap : (pickedRoof != null ? pickedRoof.Config.Text("plateSnap") : armedSnap),
                PickedRoofId = pickedId,
                PressX = pointer.X,
                PressY = pointer.Y,
                PressTimeMs = pointer.TimeMs,
            };
            aim = cell;
            hasAim = true;
            Plan(host, pointer);
            return true;
        }

        public static void Publish() {
            StationEditSession.Plan = accepted.Count > 0 ? accepted[0] : (refused.Count > 0 ? refused[0] : null);
            StationEditSession.Cells = null;
        }

        /// <summary>
        /// The release: lay the batch the ghost drew, or lift the pieces it boxed, in one
        /// revision. A refusal leaves the document untouched and answers with its code.
        /// </summary>
        public static bool Finish(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            Ray ray, out string code, out string reason) {
            code = null;
            reason = null;
            var current = gesture;
            gesture = null;
            if (current == null) { reason = "no-gesture"; return false; }
            if (host?.Index == null) { reason = "no-session"; return false; }
            // The release's own aim decides the batch, exactly as the reference re-computes it.
            if (TryAim(host, hit, ray, current.TileType, out var cell, out var snap)) {
                current.Target = cell;
                if (snap.Length > 0) current.PlateSnap = snap;
            }
            var cells = Cells(current, pointer);
            if (cells.Count > StationCellPlanner.MaxDragCells) {
                reason = "over-limit";
                PlanCells(host, current, cells, pointer);
                return false;
            }
            // The release commits the **batch the ghost drew** at this aim, recomputed from the
            // release's own hit so a flushed move cannot leave the two apart.
            PlanCells(host, current, cells, pointer);
            var patch = new StationCellPatch();
            if (current.Remove) {
                var taken = new HashSet<string>(StringComparer.Ordinal);
                foreach (var plan in accepted) {
                    if (plan?.Candidate == null) continue;
                    if (!taken.Add(plan.Candidate.Id)) continue;
                    patch.RemoveModuleIds.Add(plan.Candidate.Id);
                    patch.Changed++;
                }
                if (patch.RemoveModuleIds.Count == 0) { reason = "nothing-to-do"; return false; }
            } else {
                if (accepted.Count == 0) {
                    reason = refused.Count > 0 && !string.IsNullOrEmpty(refused[0].Reason) ? refused[0].Reason : "nothing-to-do";
                    return false;
                }
                foreach (var plan in accepted) {
                    if (plan?.Candidate == null) continue;
                    patch.AddModule(plan.Candidate);
                }
            }
            if (!StationEditSession.TryApplyCells(host, patch,
                    current.Remove ? "remove roof" : "place roof", null, out _, out code)) {
                reason = code;
                return false;
            }
            Reset();
            return true;
        }

        public static void Cancel() => Reset();

        public static void Miss() {
            hasAim = false;
            accepted.Clear();
            refused.Clear();
            if (gesture == null) StationEditSession.Plan = null;
        }

        // ------------------------------------------------------------------ plans

        /// <summary>Re-plan the batch for the current aim (or held gesture).</summary>
        static void Plan(StationGameHost host, StationPointerEvent pointer) {
            var current = gesture;
            if (current != null) {
                PlanCells(host, current, Cells(current, pointer), pointer);
                return;
            }
            if (!hasAim) { accepted.Clear(); refused.Clear(); return; }
            var tileType = StationToolSelection.Setting("moduleType");
            ReadSettings(out var rotation, out var width, out var snap);
            var hover = new Gesture {
                TileType = tileType, Rotation = rotation, RoofWidth = width, PlateSnap = snap,
                Anchor = aim, Target = aim,
            };
            PlanCells(host, hover, new List<StationCellKey> { aim }, pointer);
        }

        static void PlanCells(StationGameHost host, Gesture current, List<StationCellKey> cells,
            StationPointerEvent pointer) {
            accepted.Clear();
            refused.Clear();
            if (host?.Index == null) return;
            var taken = new HashSet<string>(StringComparer.Ordinal);
            var claimed = new HashSet<StationCellKey>();
            foreach (var cell in cells) {
                if (current.Remove) {
                    var piece = RoofAt(host.Index, cell, current.TileType);
                    if (piece == null || !taken.Add(piece.Id)) continue;
                    var removal = new StationPlacementPlan { Candidate = StationModulePlacement.DraftOf(piece) };
                    removal.CellX = piece.X; removal.CellY = piece.Y; removal.CellZ = piece.Z;
                    accepted.Add(removal);
                    continue;
                }
                // A cell that already holds a piece of this family is not a candidate: the
                // reference skips it (`pieceAt`) so a click on a plate re-aims it instead of
                // hanging a second slab in the same place.
                if (RoofAt(host.Index, cell, current.TileType) != null) continue;
                if (claimed.Contains(cell)) continue;
                var plan = Resolve(host.Index, cell, current);
                if (plan.Candidate == null) continue;
                // A truss bay is centred on its aim, so a dragged anchor list can name the same
                // footprint twice; the first wins, exactly as the reference's `pieceAt` check does.
                var footprint = FootprintOf(plan.Candidate);
                bool overlapsPlanned = false;
                foreach (var cellKey in footprint) if (claimed.Contains(cellKey)) overlapsPlanned = true;
                if (overlapsPlanned) continue;
                foreach (var cellKey in footprint) claimed.Add(cellKey);
                plan.Candidate.Id = NextRoofId(host.Index, taken, plan.Candidate.Id);
                if (plan.Ok) accepted.Add(plan); else refused.Add(plan);
            }
            _ = pointer;
        }

        /// <summary>The batch's aim cells: one tile, an area, or a line of whole bays.</summary>
        static List<StationCellKey> Cells(Gesture current, StationPointerEvent pointer) {
            var cells = new List<StationCellKey> { current.Anchor };
            if (current.Dragging(pointer) == false) return cells;
            int z = current.Anchor.Z;
            if (IsTrussRun(current.TileType)) {
                // One anchor per whole bay along the crest axis; the lateral coordinate is the
                // anchor's, so a sideways wander never staggers the run.
                StationFootprints.RotateLocal(current.Rotation, 1, 0, out var fx, out var fy);
                bool alongX = Math.Abs(fx) > Math.Abs(fy);
                int delta = alongX ? current.Target.X - current.Anchor.X : current.Target.Y - current.Anchor.Y;
                int n = Math.Abs(delta) / Bay;
                int sign = delta < 0 ? -1 : 1;
                for (int k = 1; k <= n; k++) {
                    cells.Add(alongX
                        ? new StationCellKey(current.Anchor.X + sign * k * Bay, current.Anchor.Y, z)
                        : new StationCellKey(current.Anchor.X, current.Anchor.Y + sign * k * Bay, z));
                }
                return cells;
            }
            // A thin plate fills its rectangle immediately on travel (`TileEquipmentTool.cells`).
            int x0 = Math.Min(current.Anchor.X, current.Target.X), x1 = Math.Max(current.Anchor.X, current.Target.X);
            int y0 = Math.Min(current.Anchor.Y, current.Target.Y), y1 = Math.Max(current.Anchor.Y, current.Target.Y);
            for (int x = x0; x <= x1; x++) {
                for (int y = y0; y <= y1; y++) {
                    if (x == current.Anchor.X && y == current.Anchor.Y) continue;
                    cells.Add(new StationCellKey(x, y, z));
                }
            }
            return cells;
        }

        /// <summary>The one candidate one aim cell resolves to (a fresh piece, never a rewrite).</summary>
        static StationPlacementPlan Resolve(StationIndex index, StationCellKey cell, Gesture current) {
            var request = new StationPlacementRequest {
                ToolType = current.TileType,
                Rotation = current.Rotation,
                Width = current.RoofWidth,
                RoofPlateSnap = current.PlateSnap,
                Hit = new StationPlacementHit(cell.X, cell.Y, cell.Z, cell.X, cell.Y, cell.Z, false,
                    new StationPoint(cell.X + 0.5, cell.Y + 0.5, cell.Z + 1), cell.Z + 1, new StationPoint(0, 0, 1)),
            };
            return StationModulePlacement.Resolve(index, request);
        }

        /// <summary>The placed tile whose footprint holds this cell, of the same family.</summary>
        static StationModuleRecord RoofAt(StationIndex index, StationCellKey cell, string tileType) {
            if (index == null) return null;
            foreach (var module in index.Document.Modules) {
                if (module == null || !string.Equals(module.Type, "roof", StringComparison.Ordinal)) continue;
                if (module.Z != cell.Z) continue;
                if (!string.Equals(TileOf(module), tileType, StringComparison.Ordinal) &&
                    !string.Equals(tileType, "roof", StringComparison.Ordinal)) continue;
                foreach (var point in StationFootprints.TrackCells(module)) {
                    if ((int)Math.Round(point.X) != cell.X || (int)Math.Round(point.Y) != cell.Y) continue;
                    return module;
                }
            }
            return null;
        }

        /// <summary>The roof piece under the pointer, for a secondary press (`pickRoof`).</summary>
        static StationModuleRecord PickRoof(StationIndex index, StationSceneHit hit) {
            if (index == null || hit == null || !hit.HasModule || !hit.ModuleWins) return null;
            if (string.Equals(hit.Module.Type, "roof", StringComparison.Ordinal)) return hit.Module;
            return null;
        }

        /// <summary>The palette id a placed roof piece belongs to (`roof` or `roof-<variant>`).</summary>
        static string TileOf(StationModuleRecord module) {
            if (module == null) return "";
            var variant = module.Config.Text("variant");
            if (variant.Length == 0) return "roof";
            return variant == "tapered-truss" ? "roof-tapered" : "roof-" + variant;
        }

        /// <summary>Every plan cell a candidate's own footprint covers.</summary>
        static List<StationCellKey> FootprintOf(StationEditDraft draft) {
            var cells = new List<StationCellKey>();
            if (draft == null) return cells;
            foreach (var point in StationFootprints.TrackCells(StationModulePlacement.ToRecord(draft))) {
                cells.Add(new StationCellKey((int)Math.Round(point.X), (int)Math.Round(point.Y),
                    (int)Math.Round(point.Z)));
            }
            return cells;
        }

        /// <summary>A free `roof-N` id, unique across the batch as well as the document.</summary>
        static string NextRoofId(StationIndex index, HashSet<string> taken, string fallback = "") {
            if (!string.IsNullOrEmpty(fallback) && !taken.Contains(fallback) && index.GetModule(fallback) == null) {
                taken.Add(fallback);
                return fallback;
            }
            int n = index.Document.ModuleCount + 1;
            while (index.GetModule("roof-" + n) != null || taken.Contains("roof-" + n)) n++;
            var id = "roof-" + n;
            taken.Add(id);
            return id;
        }
    }
}
