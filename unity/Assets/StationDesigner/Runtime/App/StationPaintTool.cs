using System;
using System.Collections.Generic;
using Metro.Build;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// One paint gesture's aimed face and cells: what the brush previews and what its release
    /// commits. A preview never writes — the document, revision and undo stack are untouched
    /// until <see cref="StationPaintTool.Finish"/>.
    /// </summary>
    public sealed class StationPaintPreview {
        /// <summary>The cells whose face would be painted, in region order.</summary>
        public readonly List<StationCellKey> Cells = new List<StationCellKey>();
        public StationCellKey Anchor;
        public StationFace Face;
        /// <summary>`single`, `surface`, `erase` or `pick`.</summary>
        public string Mode = "single";
        public string Finish = "";
        /// <summary>A stable code when the whole gesture is refused (`no-face`, `over-limit`).</summary>
        public string Notice = "";

        public bool HasPlan => Cells.Count > 0 || Notice.Length > 0;

        public JObject ToJson() {
            if (!HasPlan) return null;
            var json = new JObject {
                ["mode"] = Mode,
                ["face"] = StationFaces.Name(Face),
                ["finish"] = Finish ?? "",
                ["anchor"] = new JArray(Anchor.X, Anchor.Y, Anchor.Z),
                ["notice"] = Notice ?? "",
            };
            var cells = new JArray();
            foreach (var cell in Cells) cells.Add(new JArray(cell.X, cell.Y, cell.Z));
            json["cells"] = cells;
            return json;
        }
    }

    /// <summary>
    /// The 材质 (paint) brush on the canvas (plan 27 §6). One port of
    /// `game/src/app/tools/PaintTool.ts`: press a face and release to paint it, drag to paint the
    /// rectangle on the anchor's plane (a line with Shift), and use the 整个 surface mode to
    /// flood the connected faces. The secondary button erases back to the bare finish; the
    /// eyedropper (`pick`) mode lifts a face's finish into the brush instead of editing.
    ///
    /// The face itself comes from the event's one scene hit — the authored face for an ordinary
    /// block, the dominant axis of the geometric normal for a slope — so the quad the ghost
    /// draws and the face the release paints are the same surface.
    /// </summary>
    public static class StationPaintTool {
        public const string PaintModeSetting = "paintMode";
        public const string PaintFinishSetting = "paintFinish";

        static StationPaintGesture gesture;
        static StationPaintPreview preview = new StationPaintPreview();

        /// <summary>The last aimed region (null when the brush is not aiming a face).</summary>
        public static StationPaintPreview Preview => preview;
        public static bool HasGesture => gesture != null;

        sealed class StationPaintGesture {
            public StationCellKey Anchor;
            public StationFace Face;
            public int Button;
            public string Mode = "single";
            public string Finish = "";
            public float PressX, PressY;
            public double PressTimeMs;
            public bool Shift;
            public bool Dragging;
            public int Revision;
            /// <summary>The flood region resolved once at the press, reused for preview and commit.</summary>
            public List<StationCellKey> Region;
        }

        public static void Reset() {
            gesture = null;
            preview = new StationPaintPreview();
        }

        /// <summary>The brush's finish, from the committed settings, falling back to the palette default.</summary>
        public static string ArmedFinish() {
            var finish = StationToolSelection.Setting(PaintFinishSetting);
            return finish.Length > 0 ? finish : StationFinishIds.DefaultMaterial;
        }

        /// <summary>The brush's mode: `single` unless the player chose 整个 or 取色.</summary>
        public static string ArmedMode() {
            var mode = StationToolSelection.Setting(PaintModeSetting);
            return mode.Length > 0 ? mode : "single";
        }

        /// <summary>
        /// Arm a paint gesture from one press. In `pick` mode the press lifts the face's finish
        /// into the brush and arms nothing (the reference's momentary eyedropper).
        /// </summary>
        public static bool Begin(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            int button, out string reason) {
            reason = null;
            var game = StationPaintGame.Current();
            if (game == null) { reason = "no-session"; return false; }
            if (!TryResolveFace(hit, out var cell, out var face)) { reason = "no-face"; return false; }
            string mode = ArmedMode();
            string finish = ArmedFinish();
            if (button == 2) mode = "erase";
            if (mode == "pick") {
                var pick = StationFinishEdits.ResolveHover(game.Snapshot, cell.X, cell.Y, cell.Z, face);
                StationEditSession.PaintPick = new JObject {
                    ["cell"] = new JArray(cell.X, cell.Y, cell.Z),
                    ["face"] = StationFaces.Name(face),
                    ["finish"] = pick.Finish ?? "",
                };
                preview = new StationPaintPreview { Anchor = cell, Face = face, Mode = "pick", Finish = pick.Finish ?? "" };
                StationEditSession.Paint = preview;
                return true;
            }
            gesture = new StationPaintGesture {
                Anchor = cell,
                Face = face,
                Button = button,
                Mode = mode,
                Finish = finish,
                PressX = pointer.X,
                PressY = pointer.Y,
                PressTimeMs = pointer.TimeMs,
                Shift = (pointer.Modifiers & StationPointerModifiers.Shift) != 0,
                Revision = host.CurrentRevision,
            };
            if (mode == "surface") {
                // The connected region is resolved once: a flood is the expensive half of the
                // gesture, and neither the preview nor the release can change during the drag.
                gesture.Region = StationFinishEdits.FloodRegion(game.Snapshot, cell, face,
                    StationFinishEdits.DefaultMaxRegionCells);
                if (gesture.Region.Count == 0) {
                    preview = new StationPaintPreview {
                        Anchor = cell, Face = face, Mode = mode, Finish = finish, Notice = "no-face",
                    };
                    StationEditSession.Paint = preview;
                    return true;
                }
            }
            Aim(host, hit, pointer, true);
            return true;
        }

        /// <summary>Re-aim the brush at one fresh hit (a move, or a re-aimed cached pointer).</summary>
        public static void Aim(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            bool fresh = false) {
            var game = StationPaintGame.Current();
            if (game == null) return;
            if (gesture == null) {
                if (!TryResolveFace(hit, out var cell, out var face)) { preview = new StationPaintPreview(); return; }
                string mode = ArmedMode();
                if (mode == "pick") return;
                var cells = StationFinishEdits.FaceTargets(game.Snapshot, new[] { cell }, face);
                preview = new StationPaintPreview {
                    Anchor = cell, Face = face, Mode = mode, Finish = ArmedFinish(),
                };
                preview.Cells.AddRange(cells.Count > 0 ? cells : new List<StationCellKey>());
                StationEditSession.Paint = preview;
                return;
            }
            gesture.Shift = (pointer.Modifiers & StationPointerModifiers.Shift) != 0;
            gesture.Dragging = IsDeliberate(gesture, pointer);
            var region = RegionFor(game, gesture, hit);
            var targets = StationFinishEdits.FaceTargets(game.Snapshot, region, gesture.Face);
            preview = new StationPaintPreview {
                Anchor = gesture.Anchor, Face = gesture.Face, Mode = gesture.Mode, Finish = gesture.Finish,
            };
            if (targets.Count == 0) preview.Notice = "no-face";
            preview.Cells.AddRange(targets);
            StationEditSession.Paint = preview;
        }

        /// <summary>The cells a gesture covers now: the single face, or the plane rectangle it dragged.</summary>
        static List<StationCellKey> RegionFor(StationPaintGame game, StationPaintGesture current, StationSceneHit hit) {
            if (current.Mode == "surface" && current.Region != null) return current.Region;
            if (!current.Dragging || hit == null || !hit.HasCell) return new List<StationCellKey> { current.Anchor };
            var end = new StationCellKey(hit.Cell.X, hit.Cell.Y, hit.Cell.Z);
            return StationFinishEdits.PlaneCells(current.Anchor, end, current.Face);
        }

        /// <summary>
        /// Commit the gesture: one `face.paint` through the same handler the material commands
        /// use, so the validation, the write set, the revision and the undo frame are shared.
        /// </summary>
        public static bool Finish(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            out string code, out string reason) {
            code = null;
            reason = null;
            var current = gesture;
            gesture = null;
            if (current == null) { reason = "no-gesture"; return false; }
            var game = StationPaintGame.Current();
            if (game == null) { reason = "no-session"; return false; }
            if (current.Revision != host.CurrentRevision) {
                StationEditSession.Paint = null;
                preview = new StationPaintPreview();
                reason = "stale-revision";
                return false;
            }
            current.Dragging = IsDeliberate(current, pointer);
            var region = RegionFor(game, current, hit);
            var targets = StationFinishEdits.FaceTargets(game.Snapshot, region, current.Face);
            if (targets.Count == 0) { reason = "no-face"; StationEditSession.Paint = null; return false; }
            var request = new StationPaintRequest {
                X = current.Anchor.X, Y = current.Anchor.Y, Z = current.Anchor.Z,
                Face = current.Face,
                Finish = current.Finish,
                Mode = current.Mode == "erase" ? StationPaintMode.Erase
                    : current.Mode == "surface" ? StationPaintMode.Surface : StationPaintMode.Single,
                ExpectedRevision = host.CurrentRevision,
            };
            if (current.Dragging && hit != null && hit.HasCell) {
                request.HasDrag = true;
                request.ToX = hit.Cell.X;
                request.ToY = hit.Cell.Y;
                request.ToZ = hit.Cell.Z;
            }
            var result = StationFinishEdits.Paint(game.Snapshot, request);
            if (!result.Accepted) {
                reason = string.IsNullOrEmpty(result.Code) ? "rejected" : result.Code;
                preview = new StationPaintPreview();
                StationEditSession.Paint = null;
                return false;
            }
            var payload = JObject.Parse(result.ToPayloadJson());
            if (!StationPaintCommit.TryCommit(payload, out code)) {
                reason = code;
                return false;
            }
            StationEditSession.Paint = null;
            preview = new StationPaintPreview();
            return true;
        }

        public static void Cancel() {
            gesture = null;
            preview = new StationPaintPreview();
            StationEditSession.Paint = null;
        }

        public static void Leave() {
            if (gesture != null) return;
            preview = new StationPaintPreview();
            StationEditSession.Paint = null;
        }

        /// <summary>Publish the aimed region into the session snapshot.</summary>
        public static void Publish() => StationEditSession.Paint = preview.HasPlan ? preview : null;

        /// <summary>
        /// The face the brush would paint: the authored face for a plain block, the dominant axis
        /// of the geometric normal for a slope, and the same answer for a module's own surface
        /// (`PaintTool`'s `dominantFace`).
        /// </summary>
        public static bool TryResolveFace(StationSceneHit hit, out StationCellKey cell, out StationFace face) {
            cell = default;
            face = StationFace.Top;
            if (hit == null) return false;
            if (hit.HasCell) {
                cell = hit.CellKey;
                if (hit.CellSlope) {
                    face = DominantFace(hit.CellNormal);
                } else {
                    face = hit.CellFace;
                }
                return true;
            }
            if (hit.HasModule && hit.ModuleWins) {
                cell = new StationCellKey(hit.Module.X, hit.Module.Y, hit.Module.Z);
                face = DominantFace(hit.ModuleNormal);
                return true;
            }
            return false;
        }

        /// <summary>`dominantFace`: the axis with the largest normal component.</summary>
        public static StationFace DominantFace(StationPoint normal) {
            double ax = Math.Abs(normal.X), ay = Math.Abs(normal.Y), az = Math.Abs(normal.Z);
            if (az >= ax && az >= ay) return normal.Z >= 0 ? StationFace.Top : StationFace.Bottom;
            if (ax >= ay) return normal.X >= 0 ? StationFace.E : StationFace.W;
            return normal.Y >= 0 ? StationFace.N : StationFace.S;
        }

        /// <summary>
        /// The reference's click-versus-drag test: a deliberate press is 160 ms held **and** more
        /// than 4 px of travel, so a quick tap paints one face even if the pointer jitters.
        /// </summary>
        static bool IsDeliberate(StationPaintGesture current, StationPointerEvent pointer) {
            if (pointer.TimeMs < 0 || current.PressTimeMs < 0) return false;
            if (pointer.TimeMs - current.PressTimeMs < StationCellPlanner.LongPressMs) return false;
            float dx = pointer.X - current.PressX, dy = pointer.Y - current.PressY;
            return Mathf.Sqrt(dx * dx + dy * dy) > StationCellPlanner.DragPixels;
        }
    }

    /// <summary>
    /// The live paint snapshot the brush validates against: the committed document's cells plus
    /// the street's holes. It is rebuilt whenever the revision moves, so a commit is never
    /// validated against a document the station no longer has.
    /// </summary>
    public sealed class StationPaintGame {
        static StationPaintGame current;
        static int revision = int.MinValue;
        static string source = "";

        public static StationPaintGame Current() {
            var router = MonoShell.Host();
            if (router?.Index == null) return null;
            if (current != null && revision == router.CurrentRevision &&
                string.Equals(source, router.CurrentSourceId, StringComparison.Ordinal)) return current;
            current = new StationPaintGame(router);
            revision = router.CurrentRevision;
            source = router.CurrentSourceId ?? "";
            return current;
        }

        public static void Forget() {
            current = null;
            revision = int.MinValue;
        }

        public StationPaintSnapshot Snapshot { get; }

        StationPaintGame(StationGameHost host) {
            Snapshot = StationPaintSnapshot.FromDocument(host.Index.Document, null, host.CurrentRevision);
        }

        /// <summary>The host the brush reads; a tiny indirection so tests can drive it directly.</summary>
        static class MonoShell {
            public static StationGameHost Host() => UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
        }
    }
}
