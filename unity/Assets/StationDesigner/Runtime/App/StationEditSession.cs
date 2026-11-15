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
        /// <summary>The last eyedropper result, cleared by the next input.</summary>
        public static JObject Picked;
        /// <summary>The last `edit.probe` answer, for a browser check to click a known pixel.</summary>
        public static JObject Probe;
        /// <summary>The editing level the last pointer resolved against.</summary>
        public static int Level;
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
            int revisionBefore, int revisionAfter) {
            var entry = new JObject {
                ["seq"] = ++traceSeq,
                ["type"] = type ?? "",
                ["tool"] = tool ?? "",
                ["picked"] = hit != null,
                ["cell"] = hit != null && hit.HasCell ? new JArray(hit.Cell.X, hit.Cell.Y, hit.Cell.Z) : null,
                ["moduleId"] = hit != null && hit.HasModule ? hit.Module.Id : "",
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
            Picked = null;
            Probe = null;
            Level = 0;
            trace.Clear();
            traceSeq = 0;
            undos.Clear();
            redos.Clear();
            appliedCommandIds.Clear();
            commandIdOrder.Clear();
        }

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
            bool dedupe = !string.IsNullOrEmpty(commandId);
            if (dedupe && appliedCommandIds.Contains(commandId)) { code = "duplicate-command"; return false; }
            PruneHistory(host.CurrentSourceId);
            var before = host.SaveDocument();
            if (string.IsNullOrEmpty(before)) { code = "no-document"; return false; }
            var next = StationModuleEdits.Apply(before, mode, draft, removeId, out code);
            if (next == null) return false;
            result = host.ApplyDocumentEdit(next, host.CurrentSourceId);
            if (result == null || !result.Accepted) {
                code = result?.Rejection?.Code ?? "rejected";
                return false;
            }
            if (dedupe) Remember(commandId);
            undos.Add(new HistoryFrame { Document = before, SourceId = host.CurrentSourceId, Label = label ?? "" });
            if (undos.Count > MaxHistory) undos.RemoveAt(0);
            redos.Clear();
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
                ["pick"] = Picked != null ? Picked.DeepClone() : null,
                ["probe"] = Probe != null ? Probe.DeepClone() : null,
                ["trace"] = new JArray(trace.ConvertAll(entry => entry.DeepClone())),
                ["undoDepth"] = undos.Count,
                ["redoDepth"] = redos.Count,
            };
            return edit;
        }

        /// <summary>The resolved plan as structured data: the thing preview and commit agree on.</summary>
        public static JObject PlanJson(StationPlacementPlan plan) {
            if (plan == null) return null;
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
