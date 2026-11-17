using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// The canvas editor's session state and its one commit path (plan 16 §1.5).
    ///
    /// The document is only ever changed by <see cref="StationGameHost.ApplyDocumentEdit"/>:
    /// every place/move/delete builds a complete candidate, applies it to the committed v1
    /// envelope in <see cref="StationModuleEdits"/> and installs that envelope through the
    /// same transaction as an open. A refusal leaves the station, the revision and the
    /// selection untouched, and a canceled move never touches the save at all.
    ///
    /// Undo/redo keep the **whole committed envelope** either side of an edit. That is the
    /// forward/inverse record this port needs: the transaction is document-level and
    /// lossless, so replaying the previous envelope restores dependent edits (a stair's
    /// carved cells, a neighbour's arm) without a per-family inverse.
    /// </summary>
    public static class StationEditSession {
        public const int MaxHistory = 40;

        sealed class HistoryFrame {
            public string Document;
            public string SourceId;
            public string Label;
        }

        static readonly List<HistoryFrame> undos = new List<HistoryFrame>();
        static readonly List<HistoryFrame> redos = new List<HistoryFrame>();
        static readonly HashSet<string> appliedCommandIds = new HashSet<string>(StringComparer.Ordinal);
        static readonly Queue<string> commandIdOrder = new Queue<string>();

        public static string SelectionKind = "";
        public static string SelectionKey = "";
        public static string SelectionLabel = "";
        /// <summary>The placed record a move carries, if any.</summary>
        public static string CarriedId = "";
        public static int CarriedRotation;
        public static string MoveReason = "";
        /// <summary>The last resolved plan, for the state snapshot and the verifier.</summary>
        public static StationPlacementPlan Plan;
        /// <summary>
        /// The cell tool's last aimed preview (accepted/refused cells, the ring, the badge).
        /// It is a **preview**: publishing it never touches the document, the revision or the
        /// history (plan 27 §3).
        /// </summary>
        public static StationCellPreview Cells;
        /// <summary>
        /// The brush's last aimed region (the faces the release would paint) and its last
        /// eyedropper result. A preview, like <see cref="Cells"/>: publishing it never touches
        /// the document, the revision or the history.
        /// </summary>
        public static StationPaintPreview Paint;
        /// <summary>The last `pick`-mode face finish, adopted by the shell's brush.</summary>
        public static JObject PaintPick;
        /// <summary>The road tool's aimed stroke (a preview; see <see cref="Cells"/>).</summary>
        public static Metro.Build.RoadEditPreview Road;
        /// <summary>
        /// The 分区 brush's aimed patch (the floor tinted and the labels the release would
        /// write). A preview, like <see cref="Cells"/>: it never touches the document, the
        /// revision or the history.
        /// </summary>
        public static StationZonePreview Zone;
        /// <summary>The 人行道 / 草坪 tile brush's aimed patch (a preview; see <see cref="Cells"/>).</summary>
        public static StationSurfacePreview Surface;
        /// <summary>The rail tool's aimed piece (a preview; see <see cref="Cells"/>).</summary>
        public static Metro.Build.StationRailPlan Rail;
        /// <summary>The last eyedropper result, cleared by the next input.</summary>
        public static JObject Picked;
        /// <summary>The last `edit.probe` answer, for a browser check to click a known pixel.</summary>
        public static JObject Probe;
        /// <summary>The editing level the last pointer resolved against.</summary>
        public static int Level;
        /// <summary>True while the pointer is inside the stage (a leave parks it).</summary>
        public static bool HasPointer;
        /// <summary>The last routed pointer event, so a settings or view change can re-aim it.</summary>
        public static StationPointerEvent Pointer;
        /// <summary>
        /// The recent interaction trace (plan 16 §1.1/§1.6): one entry per routed pointer
        /// event carrying the event, the hit, the resolved candidate and the revision it
        /// left behind. Bounded and document-free, published as `payload.edit.trace`, so a
        /// verifier can prove "one pick per event, one revision per commit".
        /// </summary>
        static readonly List<JObject> trace = new List<JObject>();
        static int traceSeq;
        const int MaxTrace = 16;

        public static void Trace(string type, string tool, StationSceneHit hit, StationPlacementPlan plan,
            int revisionBefore, int revisionAfter, int picks = -1) {
            var targetKind = hit == null ? "none"
                : hit.TargetKind == StationSceneTargetKind.Module ? "module"
                : hit.TargetKind == StationSceneTargetKind.Cell ? "cell"
                : hit.TargetKind == StationSceneTargetKind.Plane ? "plane"
                : "none";
            var entry = new JObject {
                ["seq"] = ++traceSeq,
                ["type"] = type ?? "",
                ["tool"] = tool ?? "",
                ["picked"] = hit != null,
                ["picks"] = picks >= 0 ? picks : (hit != null ? 1 : 0),
                ["targetKind"] = targetKind,
                ["cell"] = hit != null && hit.HasCell ? new JArray(hit.CellKey.X, hit.CellKey.Y, hit.CellKey.Z) : null,
                ["plane"] = hit != null && hit.HasWorkPlane ? new JArray(hit.WorkPlane.X, hit.WorkPlane.Y, hit.WorkPlane.Z) : null,
                ["moduleId"] = hit != null && hit.TargetKind == StationSceneTargetKind.Module ? hit.Module.Id : "",
                ["reason"] = plan != null ? plan.Reason ?? "" : "",
                ["candidate"] = plan?.Candidate != null
                    ? new JArray(plan.Candidate.Type, plan.Candidate.X, plan.Candidate.Y, plan.Candidate.Z, plan.Candidate.Rotation)
                    : null,
                ["revisionBefore"] = revisionBefore,
                ["revisionAfter"] = revisionAfter,
                ["committed"] = revisionAfter != revisionBefore,
            };
            trace.Add(entry);
            if (trace.Count > MaxTrace) trace.RemoveAt(0);
        }

        public static void ClearTrace() => trace.Clear();

        public static bool HasCarried => !string.IsNullOrEmpty(CarriedId);

        public static void Reset() {
            SelectionKind = SelectionKey = SelectionLabel = "";
            CarriedId = "";
            CarriedRotation = 0;
            MoveReason = "";
            Plan = null;
            Cells = null;
            Paint = null;
            PaintPick = null;
            Zone = null;
            Surface = null;
            Rail = null;
            Picked = null;
            Probe = null;
            Level = 0;
            HasPointer = false;
            Pointer = default;
            trace.Clear();
            traceSeq = 0;
            undos.Clear();
            redos.Clear();
            appliedCommandIds.Clear();
            commandIdOrder.Clear();
            StationCellTool.Reset();
            StationPaintTool.Reset();
            StationPaintGame.Forget();
            StationZoneTool.Reset();
            StationSurfaceTool.Reset();
        }

        /// <summary>Remember the pointer a settings or view refresh has to re-aim.</summary>
        public static void RememberPointer(in StationPointerEvent pointer) {
            Pointer = pointer;
            HasPointer = true;
        }

        /// <summary>The pointer left the stage: nothing to re-aim until it comes back.</summary>
        public static void ForgetPointer() {
            HasPointer = false;
            Cells = null;
        }

        /// <summary>The remembered pointer's Unity screen position (origin bottom-left).</summary>
        public static Vector2 PointerScreen() => Pointer.ToScreen();

        /// <summary>Forget history that belongs to another station (a switch makes it meaningless).</summary>
        public static void PruneHistory(string sourceId) {
            if (undos.Count > 0 && !string.Equals(undos[undos.Count - 1].SourceId, sourceId, StringComparison.Ordinal)) undos.Clear();
            if (redos.Count > 0 && !string.Equals(redos[redos.Count - 1].SourceId, sourceId, StringComparison.Ordinal)) redos.Clear();
        }

        public static void SelectModule(StationModuleRecord module) {
            SelectionKind = "module";
            SelectionKey = module?.Id ?? "";
            SelectionLabel = module == null ? "" : module.Type;
        }

        public static void SelectCell(StationCellKey cell) {
            SelectionKind = "cell";
            SelectionKey = cell.ToString();
            SelectionLabel = "(" + cell.X + ", " + cell.Y + ", " + cell.Z + ")";
        }

        public static void ClearSelection() {
            SelectionKind = SelectionKey = SelectionLabel = "";
        }

        // --------------------------------------------------------------- transaction

        /// <summary>
        /// Apply one candidate to the committed document and install it. Passing
        /// <paramref name="commandId"/> deduplicates a retried command: the same id is
        /// acknowledged once and a repeat is an ack, never a second revision.
        /// </summary>
        public static bool TryApply(StationGameHost host, StationModuleEditMode mode, StationEditDraft draft,
            string removeId, string label, string commandId, out StationLoadResult result, out string code) {
            result = null;
            code = null;
            if (host == null || !host.IsLoaded) { code = "no-session"; return false; }
            if (IsDuplicate(host, commandId, out code)) return false;
            var before = host.SaveDocument();
            if (string.IsNullOrEmpty(before)) { code = "no-document"; return false; }
            var next = StationModuleEdits.Apply(before, mode, draft, removeId, out code);
            if (next == null) return false;
            return TryApplyPatch(host, next, label, commandId, out result, out code);
        }

        /// <summary>
        /// Apply one **cell** patch and install it: the same transaction, the same history and
        /// the same revision rule as a module edit. The planner names the writes; only
        /// <see cref="Metro.Persistence.StationCellEdits"/> touches the envelope text.
        /// </summary>
        public static bool TryApplyCells(StationGameHost host, Metro.Build.StationCellPatch patch,
            string label, string commandId, out StationLoadResult result, out string code) {
            result = null;
            code = null;
            if (host == null || !host.IsLoaded) { code = "no-session"; return false; }
            if (IsDuplicate(host, commandId, out code)) return false;
            var before = host.SaveDocument();
            if (string.IsNullOrEmpty(before)) { code = "no-document"; return false; }
            var next = StationCellEdits.Apply(before, patch, out code);
            if (next == null) return false;
            return TryApplyPatch(host, next, label, commandId, out result, out code);
        }

        /// <summary>
        /// The one install path (plan 27 §3): hand a complete envelope to
        /// <c>StationGameHost.ApplyDocumentEdit</c>, install it **before** pushing one undo
        /// frame, and clear redo. A refusal leaves the document, the revision, the history and
        /// the selection untouched. `label` names the edit in the history.
        /// </summary>
        public static bool TryApplyPatch(StationGameHost host, string nextEnvelope, string label, string commandId,
            out StationLoadResult result, out string code) {
            result = null;
            code = null;
            if (host == null || !host.IsLoaded) { code = "no-session"; return false; }
            if (string.IsNullOrEmpty(nextEnvelope)) { code = "no-document"; return false; }
            if (IsDuplicate(host, commandId, out code)) return false;
            PruneHistory(host.CurrentSourceId);
            var before = host.SaveDocument();
            result = host.ApplyDocumentEdit(nextEnvelope, host.CurrentSourceId);
            if (result == null || !result.Accepted) {
                code = result?.Rejection?.Code ?? "rejected";
                return false;
            }
            if (!string.IsNullOrEmpty(commandId)) Remember(commandId);
            if (!string.IsNullOrEmpty(before)) {
                undos.Add(new HistoryFrame { Document = before, SourceId = host.CurrentSourceId, Label = label ?? "" });
                if (undos.Count > MaxHistory) undos.RemoveAt(0);
            }
            redos.Clear();
            return true;
        }

        static bool IsDuplicate(StationGameHost host, string commandId, out string code) {
            code = null;
            if (string.IsNullOrEmpty(commandId)) return false;
            if (!appliedCommandIds.Contains(commandId)) return false;
            code = "duplicate-command";
            return true;
        }

        /// <summary>Re-install the envelope from before the last edit as one new revision.</summary>
        public static bool TryUndo(StationGameHost host, out StationLoadResult result, out string code) {
            return TryStep(host, undos, redos, out result, out code);
        }

        public static bool TryRedo(StationGameHost host, out StationLoadResult result, out string code) {
            return TryStep(host, redos, undos, out result, out code);
        }

        static bool TryStep(StationGameHost host, List<HistoryFrame> from, List<HistoryFrame> to,
            out StationLoadResult result, out string code) {
            result = null;
            code = null;
            if (host == null || !host.IsLoaded) { code = "no-session"; return false; }
            PruneHistory(host.CurrentSourceId);
            if (from.Count == 0) { code = "no-history"; return false; }
            var frame = from[from.Count - 1];
            if (!string.Equals(frame.SourceId, host.CurrentSourceId, StringComparison.Ordinal)) {
                from.Clear();
                code = "no-history";
                return false;
            }
            var current = host.SaveDocument();
            result = host.ApplyDocumentEdit(frame.Document, host.CurrentSourceId);
            if (result == null || !result.Accepted) {
                code = result?.Rejection?.Code ?? "rejected";
                return false;
            }
            from.RemoveAt(from.Count - 1);
            to.Add(new HistoryFrame { Document = current, SourceId = host.CurrentSourceId, Label = frame.Label });
            if (to.Count > MaxHistory) to.RemoveAt(0);
            return true;
        }

        static void Remember(string commandId) {
            appliedCommandIds.Add(commandId);
            commandIdOrder.Enqueue(commandId);
            while (commandIdOrder.Count > 64) appliedCommandIds.Remove(commandIdOrder.Dequeue());
        }

        // ------------------------------------------------------------------- snapshot

        /// <summary>What the shell/verifier reads beside the committed state.</summary>
        public static JObject ToJson() {
            var edit = new JObject {
                ["selectionKind"] = SelectionKind,
                ["selectionKey"] = SelectionKey,
                ["selectionLabel"] = SelectionLabel,
                ["carried"] = HasCarried ? CarriedId : "",
                ["carriedRotation"] = CarriedRotation,
                ["moveReason"] = MoveReason ?? "",
                ["level"] = Level,
                ["plan"] = PlanJson(Plan),
                ["cells"] = Cells != null ? Cells.ToJson() : null,
                ["paint"] = Paint != null ? Paint.ToJson() : null,
                ["paintPick"] = PaintPick != null ? PaintPick.DeepClone() : null,
                ["road"] = Road != null ? RoadJson(Road) : null,
                ["zone"] = Zone != null ? Zone.ToJson() : null,
                ["surface"] = Surface != null ? Surface.ToJson() : null,
                ["railPlan"] = Rail != null ? RailJson(Rail) : null,
                ["pick"] = Picked != null ? Picked.DeepClone() : null,
                ["probe"] = Probe != null ? Probe.DeepClone() : null,
                ["trace"] = new JArray(trace.ConvertAll(entry => entry.DeepClone())),
                ["undoDepth"] = undos.Count,
                ["redoDepth"] = redos.Count,
            };
            return edit;
        }

        /// <summary>The rail piece's aimed run as structured data (the ghost and the release agree).</summary>
        public static JObject RailJson(Metro.Build.StationRailPlan rail) {
            if (rail == null) return null;
            var json = new JObject {
                ["ok"] = rail.Ok,
                ["reason"] = rail.Reason ?? "",
                ["line"] = rail.LineId ?? "",
                ["direction"] = rail.Direction ?? "",
                ["x"] = rail.X, ["y"] = rail.Y, ["z"] = rail.Z,
                ["w"] = rail.Width, ["d"] = rail.Depth, ["rot"] = rail.Rotation,
                ["tunnel"] = rail.Tunnel,
                ["colliders"] = new JArray(rail.ColliderIds),
            };
            var bed = new JArray();
            foreach (var cell in rail.Bed) bed.Add(new JArray(cell.X, cell.Y, cell.Z));
            json["bed"] = bed;
            return json;
        }

        /// <summary>The road stroke's aimed preview as structured data.</summary>
        static JObject RoadJson(Metro.Build.RoadEditPreview road) {
            if (road == null) return null;
            var json = new JObject {
                ["valid"] = road.Valid,
                ["code"] = road.Code ?? "",
                ["length"] = road.Length,
                ["lanes"] = road.Lanes,
                ["laneWidth"] = road.LaneWidth,
                ["sourceId"] = road.SourceId ?? "",
            };
            if (road.Candidate != null) {
                json["candidate"] = new JObject {
                    ["id"] = road.Candidate.Id,
                    ["x"] = road.Candidate.X,
                    ["y"] = road.Candidate.Y,
                    ["z"] = road.Candidate.Z,
                    ["w"] = road.Candidate.W,
                    ["d"] = road.Candidate.D,
                    ["rot"] = road.Candidate.Rotation,
                    ["direction"] = road.Candidate.Direction ?? "",
                };
                if (road.Candidate.HasFrom) json["from"] = new JArray(road.Candidate.From.X, road.Candidate.From.Y);
                if (road.Candidate.HasTo) json["to"] = new JArray(road.Candidate.To.X, road.Candidate.To.Y);
            }
            return json;
        }

        /// <summary>The resolved plan as structured data: the thing preview and commit agree on.</summary>
        public static JObject PlanJson(StationPlacementPlan plan) {            if (plan == null) return null;
            var json = new JObject {
                ["ok"] = plan.Ok,
                ["reason"] = plan.Reason ?? "",
                ["support"] = plan.SupportId ?? "",
                ["move"] = plan.IsMove,
                ["cell"] = new JArray(plan.CellX, plan.CellY, plan.CellZ),
            };
            if (plan.Candidate != null) {
                json["candidate"] = new JObject {
                    ["id"] = plan.Candidate.Id,
                    ["type"] = plan.Candidate.Type,
                    ["x"] = plan.Candidate.X,
                    ["y"] = plan.Candidate.Y,
                    ["z"] = plan.Candidate.Z,
                    ["rot"] = StationFootprints.NormRot(plan.Candidate.Rotation),
                    ["w"] = plan.Candidate.Width,
                    ["d"] = plan.Candidate.Depth,
                };
            }
            if (plan.ColliderIds.Count > 0) json["blockedBy"] = new JArray(plan.ColliderIds);
            if (plan.UnverifiedIds.Count > 0) json["unverifiedBy"] = new JArray(plan.UnverifiedIds);
            return json;
        }
    }

    /// <summary>The <c>edit</c> snapshot contributor: selection, the move draft and the last plan.</summary>
    public sealed class StationEditStateContributor : IStationStateContributor {
        public string Key => "edit";
        public JObject BuildPayload(StationDocument document, StationIndex index) => StationEditSession.ToJson();
    }

    /// <summary>
    /// The one place pointer and edit handlers get their scene objects from: the preview
    /// component and the host. It is process-wide and self-creating, like the renderers,
    /// so no scene reference is needed.
    /// </summary>
    public sealed class StationEditHost : MonoBehaviour {
        public const string ObjectName = "StationEditPreview";
        public StationPlacementPreview Preview { get; private set; }

        static StationEditHost instance;

        public static StationEditHost Ensure() {
            if (instance != null) return instance;
            instance = UnityEngine.Object.FindAnyObjectByType<StationEditHost>();
            if (instance == null) {
                var go = new GameObject(ObjectName);
                if (Application.isPlaying) DontDestroyOnLoad(go);
                instance = go.AddComponent<StationEditHost>();
            }
            instance.EnsurePreview();
            return instance;
        }

        /// <summary>The current station host (the scene's <c>StationGame</c> component).</summary>
        public static StationGameHost Host {
            get {
                if (cachedHost == null) cachedHost = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
                return cachedHost;
            }
        }

        static StationGameHost cachedHost;

        /// <summary>The scene host changed (scene reload, test fixture): forget the cached one.</summary>
        public static void ForgetHost() => cachedHost = null;

        public static void ResetForTests() {
            if (instance != null) {
                if (Application.isPlaying) Destroy(instance.gameObject);
                else DestroyImmediate(instance.gameObject);
                instance = null;
            }
            var leftover = UnityEngine.Object.FindAnyObjectByType<StationEditHost>();
            if (leftover != null) {
                if (Application.isPlaying) Destroy(leftover.gameObject);
                else DestroyImmediate(leftover.gameObject);
            }
        }

        void EnsurePreview() {
            if (Preview == null) Preview = GetComponent<StationPlacementPreview>();
            if (Preview == null) Preview = gameObject.AddComponent<StationPlacementPreview>();
        }

        /// <summary>Bind the preview to a committed world (called on every commit and pointer).</summary>
        public void Bind(StationGameHost host) {
            EnsurePreview();
            Preview.Bind(host != null ? host.Index : null);
        }
    }
}
