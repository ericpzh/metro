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
    /// The document is only ever changed by <see cref="StationGameHost.ApplyDocumentEdit"/> (a
    /// complete envelope) or by <see cref="StationGameHost.TryApplyLocalCells"/> /
    /// <see cref="StationGameHost.TryApplyLocalModule"/> (the plan 30 §3 local path, which builds
    /// the next typed document from the committed one plus the patch). Both install through the
    /// same transaction as an open, bump one revision and push one undo frame. A patch the local
    /// whitelist cannot derive exactly — a line add, a record a load-time repair owns — falls back
    /// to the complete envelope path with the identical result. A refusal leaves the station, the
    /// revision and the selection untouched, and a canceled move never touches the save at all.
    ///
    /// Undo/redo keep the **whole committed envelope** either side of an edit. That is the
    /// forward/inverse record this port needs: the transaction is document-level and
    /// lossless, so replaying the previous envelope restores dependent edits (a stair's
    /// carved cells, a neighbour's arm) without a per-family inverse. A local edit frames the
    /// committed envelope text the host already holds instead of re-serializing it.
    /// </summary>
    public static class StationEditSession {
        public const int MaxHistory = 40;

        sealed class HistoryFrame {
            public string Document;
            public string SourceId;
            public string Label;
            public StationReadResult LocalTarget, LocalExpected;
            public StationIndexDelta InverseDelta;

            public string GetOrMaterializeDocumentJson() {
                if (!string.IsNullOrEmpty(Document)) return Document;
                if (LocalTarget?.Document != null) {
                    Document = LocalTarget.Document.NormalizedJson;
                    return Document;
                }
                return "";
            }
        }

        static readonly List<HistoryFrame> undos = new List<HistoryFrame>();
        static readonly List<HistoryFrame> redos = new List<HistoryFrame>();
        static readonly HashSet<string> appliedCommandIds = new HashSet<string>(StringComparer.Ordinal);
        static readonly Queue<string> commandIdOrder = new Queue<string>();

        public static string SelectionKind = "";
        public static string SelectionKey = "";
        public static string SelectionLabel = "";
        /// <summary>
        /// How many edits installed through the local path and how many fell back to the complete
        /// envelope path (plan 30 §3). Session counters, not document facts: a verifier reads them
        /// to tell "this edit was local" from "this edit re-read the station".
        /// </summary>
        public static int LocalEdits;
        public static int FullEdits;
        /// <summary>The placed record a move carries, if any.</summary>
        public static string CarriedId = "";
        public static int CarriedRotation;
        public static int? CarriedLightPosition;
        public static string MoveReason = "";
        /// <summary>The last valid aim input for the carried piece so off-canvas rotation/settings/confirm revalidate cleanly (plan 40 §3).</summary>
        public static StationPlacementAimInput ParkedMoveAim;
        static StationPlacementPlan currentPlan;
        /// <summary>The last resolved plan, for the state snapshot and the verifier.</summary>
        public static StationPlacementPlan Plan {
            get => currentPlan;
            set {
                currentPlan = value;
                if (value != null && value.IsMove && value.AimInput.HasValue && HasCarried) {
                    ParkedMoveAim = value.AimInput;
                }
            }
        }
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
        /// <summary>
        /// The last build outcome the player should be told about (plan 28 §4): a normalized
        /// refusal code, the host's own sentence and the outcome kind — `blocked` (a candidate
        /// this surface refuses), `no-op` (a deliberate click that changes nothing) or `stale`
        /// (a gesture whose tool or revision moved). Null after a successful edit. It is a
        /// session fact, published as `edit.notice`: nothing here writes the document.
        /// </summary>
        public static JObject Notice;
        /// <summary>
        /// What the last draw put on screen (plan 28 §5): the ghost objects, how many renderers
        /// the camera actually drew, and which layer owns them. A verifier reads this beside the
        /// published plan so a badge can never stand alone next to an invisible ghost.
        /// </summary>
        public static JObject Ghost;
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
                // The right-button verdict (plan 30 §1): the claim the shell was told, the
                // event's own identity and mask, so a stationary right tap that still fails can
                // be read back from `state.edit.trace` — rightClaim, tool generation, the picked
                // cell and the commit verdict — before any erase rule is changed.
                ["rightClaim"] = StationToolSelection.RightClaim ?? "",
                ["button"] = Pointer.Button,
                ["buttons"] = Pointer.Buttons,
                ["pointerId"] = Pointer.PointerId,
                ["toolGeneration"] = Pointer.ToolGeneration,
            };
            trace.Add(entry);
            if (trace.Count > MaxTrace) trace.RemoveAt(0);
        }

        public static void ClearTrace() => trace.Clear();

        public static bool HasCarried => !string.IsNullOrEmpty(CarriedId);

        public static void SetCarried(StationModuleRecord module) {
            CarriedId = module?.Id ?? "";
            CarriedRotation = module?.Rotation ?? 0;
            CarriedLightPosition = null;
            ParkedMoveAim = default;
        }

        public static void Reset() {
            SelectionKind = SelectionKey = SelectionLabel = "";
            SetCarried(null);
            MoveReason = "";
            Plan = null;
            Cells = null;
            Paint = null;
            PaintPick = null;
            Zone = null;
            Surface = null;
            Rail = null;
            Picked = null;
            Notice = null;
            Ghost = null;
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
            LocalEdits = 0;
            FullEdits = 0;
            StationCellTool.Reset();
            StationPaintTool.Reset();
            StationPaintGame.Forget();
            StationZoneTool.Reset();
            StationSurfaceTool.Reset();
            StationRoofTool.Reset();
            StationPillarTool.Reset();
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

        /// <summary>
        /// Publish one build outcome for the shell to surface (plan 28 §4). `kind` is `blocked`,
        /// `no-op` or `stale`; a null/empty code clears the notice (a successful edit or a plain
        /// hover has nothing to say).
        /// </summary>
        public static void PublishNotice(string kind, string code, string reason, string tool) {
            if (string.IsNullOrEmpty(code) && string.IsNullOrEmpty(reason)) { Notice = null; return; }
            var notice = new JObject {
                ["kind"] = kind ?? "",
                ["code"] = code ?? "",
                ["reason"] = reason ?? "",
                ["tool"] = tool ?? "",
                // The armed 设备 palette so a bridge and a tunnel refuse differently in the shell.
                ["moduleType"] = StationToolSelection.Setting("moduleType") ?? "",
            };
            if (string.Equals(tool, "zone", StringComparison.Ordinal)) {
                notice["zoneBrush"] = StationZoneTool.ArmedBrush();
                var zonePreview = StationZoneTool.Preview;
                if (zonePreview != null && zonePreview.Width > 0 && zonePreview.Height > 0) {
                    notice["width"] = zonePreview.Width;
                    notice["height"] = zonePreview.Height;
                }
            }
            Notice = notice;
        }

        public static void ClearNotice() => Notice = null;

        /// <summary>Forget history that belongs to another station (a switch makes it meaningless).</summary>
        public static void PruneHistory(string sourceId) {
            if (undos.Count > 0 && !string.Equals(undos[undos.Count - 1].SourceId, sourceId, StringComparison.Ordinal)) undos.Clear();
            if (redos.Count > 0 && !string.Equals(redos[redos.Count - 1].SourceId, sourceId, StringComparison.Ordinal)) redos.Clear();
        }

        /// <summary>
        /// Unconditionally clear both undo and redo stacks on any non-edit station load
        /// (including reloads that share the same <c>sourceId</c>, such as New -> New or File -> File).
        /// </summary>
        public static void ClearHistory() {
            undos.Clear();
            redos.Clear();
        }

        public static int UndoCount => undos.Count;
        public static int RedoCount => redos.Count;
        public static bool CanUndo => undos.Count > 0;
        public static bool CanRedo => redos.Count > 0;

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

        public static void SelectPassenger(int simId) {
            SelectionKind = "agent";
            SelectionKey = simId.ToString(System.Globalization.CultureInfo.InvariantCulture);
            SelectionLabel = SelectionKey;
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
            var beforeRead = host.Coordinator.CommittedRead;
            var local = host.TryApplyLocalModule(mode, draft, removeId, host.CurrentSourceId, out var localCode);
            if (local != null) {
                return FinishLocalEdit(host, local, beforeRead, label, commandId, out result, out code);
            }
            StationEditTrace.NoteDocumentFallback(localCode);
            var saved = host.SaveDocument();
            if (string.IsNullOrEmpty(saved)) { code = "no-document"; return false; }
            var next = StationModuleEdits.Apply(saved, mode, draft, removeId, out code);
            if (next == null) return false;
            return TryApplyPatch(host, next, label, commandId, out result, out code);
        }

        /// <summary>
        /// Patch one exit module's <c>name</c>, <c>inRate</c> and/or <c>open</c> settings through
        /// the local edit path (falling back to complete-envelope JSON if needed) so the live
        /// entrance slider and open switch take effect immediately and participate in undo/redo.
        /// </summary>
        public static bool TryApplyExitSettings(StationGameHost host, string moduleId,
            bool hasName, string name, bool hasInRate, double inRate, bool hasOpen, bool open,
            string commandId, out StationLoadResult result, out string code) {
            result = null;
            code = null;
            if (host == null || !host.IsLoaded) { code = "no-session"; return false; }
            if (IsDuplicate(host, commandId, out code)) return false;
            var beforeRead = host.Coordinator.CommittedRead;
            var local = host.TryApplyLocalExitSettings(moduleId, hasName, name, hasInRate, inRate,
                hasOpen, open, host.CurrentSourceId, out var localCode);
            if (local != null) {
                return FinishLocalEdit(host, local, beforeRead, "exit", commandId, out result, out code);
            }
            StationEditTrace.NoteDocumentFallback(localCode);
            var saved = host.SaveDocument();
            if (string.IsNullOrEmpty(saved)) { code = "no-document"; return false; }
            var next = StationModuleEdits.ApplyExit(saved, moduleId, hasName, name, hasInRate, inRate,
                hasOpen, open, out code);
            if (next == null) return false;
            return TryApplyPatch(host, next, "exit", commandId, out result, out code);
        }

        /// <summary>
        /// Apply one **cell** patch and install it: the same transaction, the same history and
        /// the same revision rule as a module edit. The planner names the writes; the committed
        /// envelope is patched locally when whitelisted or via <see cref="Metro.Persistence.StationCellEdits"/>.
        /// </summary>
        public static bool TryApplyCells(StationGameHost host, Metro.Build.StationCellPatch patch,
            string label, string commandId, out StationLoadResult result, out string code) {
            result = null;
            code = null;
            if (host == null || !host.IsLoaded) { code = "no-session"; return false; }
            if (IsDuplicate(host, commandId, out code)) return false;
            var beforeRead = host.Coordinator.CommittedRead;
            var local = host.TryApplyLocalCells(patch, host.CurrentSourceId, out var localCode);
            if (local != null) {
                return FinishLocalEdit(host, local, beforeRead, label, commandId, out result, out code);
            }
            StationEditTrace.NoteDocumentFallback(localCode);
            var saved = host.SaveDocument();
            if (string.IsNullOrEmpty(saved)) { code = "no-document"; return false; }
            var next = StationCellEdits.Apply(saved, patch, out code);
            if (next == null) return false;
            return TryApplyPatch(host, next, label, commandId, out result, out code);
        }

        /// <summary>
        /// Apply an updated authored road set incrementally through the local delta path,
        /// falling back to a full envelope rewrite only when local projection refuses.
        /// </summary>
        public static bool TryApplyRoads(StationGameHost host, IReadOnlyList<StationRoadRecord> nextRoads,
            string label, string commandId, out StationLoadResult result, out string code) {
            result = null;
            code = null;
            if (host == null || !host.IsLoaded) { code = "no-session"; return false; }
            if (IsDuplicate(host, commandId, out code)) return false;
            var beforeRead = host.Coordinator.CommittedRead;
            var local = host.TryApplyLocalRoads(nextRoads, host.CurrentSourceId, out var localCode);
            if (local != null) {
                return FinishLocalEdit(host, local, beforeRead, label, commandId, out result, out code);
            }
            StationEditTrace.NoteDocumentFallback(localCode);
            var saved = host.SaveDocument();
            if (string.IsNullOrEmpty(saved)) { code = "no-document"; return false; }
            var next = StationRoadWrites.Apply(saved, nextRoads, out code);
            if (next == null) return false;
            return TryApplyPatch(host, next, label, commandId, out result, out code);
        }

        public static bool TryApplyLocalRead(StationGameHost host, StationReadResult local, StationReadResult beforeRead,
            string label, string commandId, out StationLoadResult result, out string code) {
            result = null;
            code = null;
            if (host == null || !host.IsLoaded) { code = "no-session"; return false; }
            if (local == null) { code = "no-document"; return false; }
            if (IsDuplicate(host, commandId, out code)) return false;
            var candidate = host.ApplyLocalHistory(local);
            return FinishLocalEdit(host, candidate, beforeRead, label, commandId, out result, out code);
        }

        static bool FinishLocalEdit(StationGameHost host, StationLoadResult candidate, StationReadResult beforeRead, string label,
            string commandId, out StationLoadResult result, out string code) {
            code = null;
            result = candidate;
            if (candidate == null || !candidate.Accepted) {
                code = candidate?.Rejection?.Code ?? "rejected";
                return false;
            }
            LocalEdits++;
            var afterRead = host.Coordinator.CommittedRead;
            var inverseDelta = beforeRead != null && afterRead != null && ReferenceEquals(afterRead.LocalParent, beforeRead)
                ? StationLocalEdit.BuildInverseDelta(beforeRead.Index, afterRead.Index, afterRead.LocalDelta)
                : null;
            CommitHistory(host, null, label, commandId, beforeRead, inverseDelta);
            return true;
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
            var before = host.SaveDocument();
            result = host.ApplyDocumentEdit(nextEnvelope, host.CurrentSourceId);
            if (result == null || !result.Accepted) {
                code = result?.Rejection?.Code ?? "rejected";
                return false;
            }
            FullEdits++;
            CommitHistory(host, before, label, commandId);
            return true;
        }

        /// <summary>
        /// Push one undo frame for the state an install just replaced and clear redo. Frames that
        /// belong to another station are dropped first, so a switch can never make one station's
        /// undo land on another's document.
        /// </summary>
        static void CommitHistory(StationGameHost host, string before, string label, string commandId,
            StationReadResult localBefore = null, StationIndexDelta inverseDelta = null) {
            using var sample = StationEditProfiling.Measure("StationEdit.CommitHistory");
            if (!string.IsNullOrEmpty(commandId)) Remember(commandId);
            PruneHistory(host.CurrentSourceId);
            if (localBefore != null || !string.IsNullOrEmpty(before)) {
                undos.Add(new HistoryFrame {
                    Document = before,
                    SourceId = host.CurrentSourceId,
                    Label = label ?? "",
                    LocalTarget = localBefore,
                    LocalExpected = localBefore == null ? null : host.Coordinator.CommittedRead,
                    InverseDelta = inverseDelta,
                });
                if (undos.Count > MaxHistory) undos.RemoveAt(0);
            }
            redos.Clear();
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

        static bool MatchesExpectedRead(StationReadResult expected, StationReadResult actual) {
            if (expected == null || actual == null) return false;
            if (ReferenceEquals(expected, actual)) return true;
            return expected.Document != null && actual.Document != null &&
                   ReferenceEquals(expected.Document.CellPages, actual.Document.CellPages) &&
                   ReferenceEquals(expected.Document.ModulePages, actual.Document.ModulePages) &&
                   ReferenceEquals(expected.Document.Lines, actual.Document.Lines);
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
            var currentRead = host.Coordinator.CommittedRead;
            bool localHistory = frame.LocalTarget != null && MatchesExpectedRead(frame.LocalExpected, currentRead);
            StationIndexDelta reverseOfInverse = null;
            if (localHistory) {
                var read = StationLocalEdit.TryRestore(currentRead, frame.LocalTarget, frame.InverseDelta, host.CurrentSourceId, out var restoreCode);
                if (read != null) {
                    reverseOfInverse = StationLocalEdit.BuildInverseDelta(currentRead.Index, read.Index, read.LocalDelta);
                    result = host.ApplyLocalHistory(read);
                } else {
                    StationEditTrace.NoteDocumentFallback(restoreCode);
                }
            }
            string fallbackBeforeJson = null;
            if (result == null) {
                localHistory = false;
                StationEditTrace.NoteDocumentFallback("history-full-envelope");
                fallbackBeforeJson = host.SaveDocument();
                var targetJson = frame.GetOrMaterializeDocumentJson();
                if (string.IsNullOrEmpty(targetJson)) { code = "no-document"; return false; }
                result = host.ApplyDocumentEdit(targetJson, host.CurrentSourceId);
            }
            if (result == null || !result.Accepted) {
                code = result?.Rejection?.Code ?? "rejected";
                return false;
            }
            if (localHistory) LocalEdits++;
            else FullEdits++;
            from.RemoveAt(from.Count - 1);
            to.Add(new HistoryFrame {
                Document = localHistory ? null : fallbackBeforeJson,
                SourceId = host.CurrentSourceId,
                Label = frame.Label,
                LocalTarget = localHistory ? currentRead : null,
                LocalExpected = localHistory ? host.Coordinator.CommittedRead : null,
                InverseDelta = localHistory ? reverseOfInverse : null,
            });
            if (to.Count > MaxHistory) to.RemoveAt(0);
            code = null;
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
                ["notice"] = Notice != null ? Notice.DeepClone() : null,
                ["ghost"] = Ghost != null ? Ghost.DeepClone() : null,
                ["probe"] = Probe != null ? Probe.DeepClone() : null,
                ["trace"] = new JArray(trace.ConvertAll(entry => entry.DeepClone())),
                ["undoDepth"] = undos.Count,
                ["redoDepth"] = redos.Count,
                ["canUndo"] = undos.Count > 0,
                ["canRedo"] = redos.Count > 0,
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

        /// <summary>The committed index the preview layer is bound to (identity, per revision).</summary>
        StationIndex boundIndex;

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

        /// <summary>
        /// Bind the preview to a committed world. It **clears** both ghost layers and restores
        /// a carried piece, so it is the rebind a commit, an undo or a station switch needs —
        /// never something to run before every draw.
        /// </summary>
        public void Bind(StationGameHost host) {
            EnsurePreview();
            boundIndex = host != null ? host.Index : null;
            if (StationEditSession.SelectionKind == "module" && boundIndex?.GetModule(StationEditSession.SelectionKey) == null) {
                StationEditSession.ClearSelection();
            } else if (StationEditSession.SelectionKind == "cell" && !HasSelectedSolidCell(boundIndex, StationEditSession.SelectionKey)) {
                StationEditSession.ClearSelection();
            }
            if (StationEditSession.SelectionKind != "module") Preview.ClearSelection();
            Preview.Bind(boundIndex);
        }

        static bool HasSelectedSolidCell(StationIndex index, string keyText) {
            if (index == null || string.IsNullOrEmpty(keyText)) return false;
            var parts = keyText.Split(',');
            if (parts.Length != 3) return false;
            if (!int.TryParse(parts[0], out int x) || !int.TryParse(parts[1], out int y) || !int.TryParse(parts[2], out int z))
                return false;
            var cell = index.GetCell(x, y, z);
            return cell != null && cell.IsSolid;
        }

        /// <summary>
        /// Bind only when the committed world really changed (plan 28 §1): a draw on the
        /// first aim after Open or New must bind, while a draw under a still pointer over the
        /// same revision must not wipe the layer it is about to write. <see cref="Bind"/>
        /// clears both layers and restores carried views, so it cannot run per event.
        /// </summary>
        public bool EnsureBound(StationGameHost host) {
            EnsurePreview();
            var next = host != null ? host.Index : null;
            if (next == null) return false;
            if (ReferenceEquals(boundIndex, next) && Preview != null && Preview.Bound) return true;
            Bind(host);
            return Preview != null && Preview.Bound;
        }
    }
}
