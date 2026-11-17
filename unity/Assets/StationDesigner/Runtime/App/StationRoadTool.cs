using System;
using System.Collections.Generic;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// The road tool's commit seam (plan 27 §6). One placement stroke is resolved by
    /// <see cref="StationRoadEdits"/>, written by <see cref="StationRoadWrites"/> and installed
    /// through <see cref="StationEditSession.TryApplyPatch"/>, so a road is one revision and one
    /// undo entry in the same history as every other edit — the plan's "route `road.commit` into
    /// the unified edit history to avoid separate stacks".
    ///
    /// The graph and the surface facts are rebuilt from the committed document on every call, so a
    /// preview and its release can never validate against two different stations.
    /// </summary>
    public static class StationRoadEditService {
        /// <summary>Resolve one stroke's ghost, with no document write.</summary>
        public static bool TryPreview(StationGameHost host, RoadEditRequest request,
            out RoadEditPreview preview, out string code) {
            preview = null;
            code = null;
            if (host == null || host.Index == null) { code = "no-session"; return false; }
            var graph = Graph(host.Index.Document);
            preview = StationRoadEdits.Preview(graph, request, new SurfaceFacts(host.Index));
            if (!preview.Valid) { code = preview.Code; return false; }
            return true;
        }

        /// <summary>Commit one stroke through the unified transaction.</summary>
        public static bool TryCommit(StationGameHost host, RoadEditRequest request, out string code, out string reason) {
            code = null;
            reason = null;
            if (host == null || !host.IsLoaded || host.Index == null) { code = "no-session"; reason = code; return false; }
            var document = host.Index.Document;
            var graph = Graph(document);
            request.expectedRevision = -1;
            var commit = StationRoadEdits.Commit(graph, request, host.CurrentRevision, document.Modules.Count,
                ModuleIds(document), new SurfaceFacts(host.Index));
            if (!commit.Accepted) {
                code = string.IsNullOrEmpty(commit.Code) ? "road-refused" : commit.Code;
                reason = code;
                return false;
            }
            var saved = host.SaveDocument();
            var next = StationRoadWrites.Apply(saved, commit.Next, out code);
            if (next == null) { reason = code; return false; }
            if (!StationEditSession.TryApplyPatch(host, next, commit.Kind, null, out _, out code)) {
                reason = code;
                return false;
            }
            return true;
        }

        static IEnumerable<string> ModuleIds(StationDocument document) {
            foreach (var module in document.Modules) yield return module.Id;
        }

        /// <summary>The authored road records, in document order.</summary>
        public static List<StationRoadRecord> Records(StationDocument document) {
            var records = new List<StationRoadRecord>();
            if (document == null) return records;
            foreach (var module in document.Modules) {
                if (module != null && string.Equals(module.Type, "road", StringComparison.Ordinal))
                    records.Add(StationRoadRecord.FromFacts(module.Facts));
            }
            return records;
        }

        public static RoadGraph Graph(StationDocument document) =>
            document == null ? null : StationRoadDocument.Read(Records(document), ModuleIds(document));

        /// <summary>Placement facts from the committed document: floor, street holes and rail beds.</summary>
        sealed class SurfaceFacts : IRoadSurfaceContext {
            readonly StationIndex index;
            public SurfaceFacts(StationIndex index) { this.index = index; }

            public bool IsSolid(int x, int y, double z) {
                if (z != Math.Floor(z)) return false;
                var cell = index.GetCell(x, y, (int)z);
                return cell != null && cell.IsSolid;
            }

            public bool IsExitFloor(int x, int y, double z) =>
                z == Math.Floor(z) && StationFootprints.IsExitFloorAt(index, x, y, (int)z);

            public bool IsGroundHole(int x, int y, double z) {
                if (z != Math.Floor(z)) return false;
                var cell = index.GetCell(x, y, (int)z);
                if (cell != null) return !cell.IsSolid;
                return z == 0 && StationFootprints.IsGroundHole(index, x, y);
            }

            public bool IsTrack(int x, int y, double z) {
                if (z != Math.Floor(z)) return false;
                var cell = index.GetCell(x, y, (int)z);
                return cell != null && cell.IsSolid && cell.FinishOf(StationFinishFace.Top) == "floor.track";
            }

            public bool OverlapsModuleEnvelope(StationRoadRecord candidate) {
                // A road deck may run under nothing: any authored module whose clearance crosses the
                // candidate's deck refuses it (the source's `equipmentReason`).
                if (candidate == null) return false;
                var deck = new StationBox(candidate.X, candidate.Y, candidate.Z + 1.01,
                    candidate.X + Math.Max(1, candidate.W), candidate.Y + Math.Max(1, candidate.D), candidate.Z + 1.07);
                foreach (var module in index.Document.Modules) {
                    if (string.Equals(module.Type, "road", StringComparison.Ordinal)) continue;
                    if (!StationFootprints.TryClearance(module, out var box, out _)) continue;
                    if (box.Overlaps(deck)) return true;
                }
                return false;
            }
        }
    }

    /// <summary>
    /// The 道路 stroke on the canvas (plan 27 §6). One port of `RoadTool.ts`: press on a
    /// surface, drag a centreline and release to lay it; the node snap moves the start only, the
    /// player's width and direction survive a branch, and the secondary button lifts the segment
    /// under the pointer. The ghost is <see cref="StationRoadRenderer.ShowPreview"/>, the same
    /// preview the `road.preview` command draws.
    /// </summary>
    public static class StationRoadTool {
        static Gesture gesture;
        static bool hasAim;
        static RoadEditPreview preview;

        sealed class Gesture {
            public RoadEditRequest Request;
            public bool Remove;
            public int Revision;
        }

        public static bool HasGesture => gesture != null;
        public static RoadEditPreview Preview => preview;

        public static void Reset() {
            gesture = null;
            hasAim = false;
            preview = null;
        }

        /// <summary>Arm a road stroke from one press.</summary>
        public static bool Begin(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            int button, out string reason) {
            reason = null;
            if (host == null || !host.IsLoaded) { reason = "no-session"; return false; }
            if (hit == null || !hit.HasCell) { reason = "no-cell"; return false; }
            bool remove = button == 2;
            string pickedId = hit.HasModule && hit.Module != null &&
                              string.Equals(hit.Module.Type, "road", StringComparison.Ordinal) ? hit.Module.Id : "";
            var request = new RoadEditRequest {
                mode = remove ? "delete" : "add",
                z = remove && hit.HasModule ? hit.Module.Z : hit.Cell.Z,
                from = new[] { hit.Cell.Point.X, hit.Cell.Point.Y },
                to = new[] { hit.Cell.Point.X, hit.Cell.Point.Y },
                width = Math.Max(1, StationToolSelection.SettingInt("roadWidth", 6)),
                direction = DirectionSetting(),
                rot = StationToolSelection.SettingInt("rotation", 0),
                pickedId = pickedId,
                expectedRevision = -1,
            };
            gesture = new Gesture {
                Request = request,
                Remove = remove,
                Revision = host.CurrentRevision,
            };
            Aim(host, hit, pointer);
            return true;
        }

        static string DirectionSetting() {
            var direction = StationToolSelection.Setting("roadDirection");
            return direction.Length > 0 ? direction : "one-way";
        }

        /// <summary>Re-aim the stroke at the pointer's surface point and redraw its ghost.</summary>
        public static void Aim(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer) {
            if (gesture == null) return;
            if (hit != null && hit.HasCell && !gesture.Remove) {
                gesture.Request.to = new[] { hit.Cell.Point.X, hit.Cell.Point.Y };
                // The stroke's own settings are re-read per aim, so Tab/Shift+Tab and R apply to a
                // stroke already in the air (the reference reads the store each move).
                gesture.Request.width = Math.Max(1, StationToolSelection.SettingInt("roadWidth", 6));
                gesture.Request.direction = DirectionSetting();
                gesture.Request.rot = StationToolSelection.SettingInt("rotation", 0);
            }
            hasAim = true;
            if (StationRoadEditService.TryPreview(host, gesture.Request, out var aimed, out _)) {
                preview = aimed;
                StationRoadRenderer.Current?.ShowPreview(aimed);
            } else {
                preview = null;
                StationRoadRenderer.Current?.ClearPreview();
            }
            StationEditSession.Road = preview;
        }

        /// <summary>Commit the stroke (or the segment the secondary button aimed at).</summary>
        public static bool Finish(StationGameHost host, StationSceneHit hit, StationPointerEvent pointer,
            out string code, out string reason) {
            code = null;
            reason = null;
            var current = gesture;
            gesture = null;
            if (current == null) { reason = "no-gesture"; return false; }
            if (current.Revision != host.CurrentRevision) {
                StationRoadRenderer.Current?.ClearPreview();
                StationEditSession.Road = null;
                reason = "stale-revision";
                return false;
            }
            if (hit != null && hit.HasCell) {
                current.Request.to = new[] { hit.Cell.Point.X, hit.Cell.Point.Y };
                if (current.Remove) current.Request.z = hit.Cell.Z;
            }
            if (current.Remove && string.IsNullOrEmpty(current.Request.pickedId) && hit != null && hit.HasModule)
                current.Request.pickedId = hit.Module.Id;
            bool ok = StationRoadEditService.TryCommit(host, current.Request, out code, out reason);
            StationRoadRenderer.Current?.ClearPreview();
            StationEditSession.Road = null;
            preview = null;
            return ok;
        }

        public static void Cancel() {
            gesture = null;
            preview = null;
            hasAim = false;
            StationRoadRenderer.Current?.ClearPreview();
            StationEditSession.Road = null;
        }

        /// <summary>Publish the aimed stroke into the session snapshot.</summary>
        public static void Publish() => StationEditSession.Road = hasAim && preview != null ? preview : null;
    }
}
