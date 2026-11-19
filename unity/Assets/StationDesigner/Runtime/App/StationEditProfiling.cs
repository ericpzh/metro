using System;
using System.Collections.Generic;
using System.Diagnostics;
using Metro.Build;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Profiling;

namespace Metro.App {
    /// <summary>
    /// End-to-end commit timing, managed allocation and workload/fallback correlation
    /// (Plan 32 §3.B). Native timeline markers are enabled by the live host; managed
    /// stage/allocation and commit observations stay strictly opt-in with zero overhead
    /// when no listener is subscribed.
    /// </summary>
    public static class StationEditProfiling {
        public static bool Enabled;
        /// <summary>Opt-in native command-to-commit and camera-render observations.</summary>
        public static event Action<CommitObservation> CommitSample;

        static long pendingNativeReleaseTimestamp;
        static double pendingClientReleaseTimeMs = double.NaN;

        public static bool IsObservingCommits => CommitSample != null;

        /// <summary>
        /// Record the native wall-clock timestamp when the host/harness dispatches a physical
        /// or synthetic pointer release, so <see cref="CommitObservation.DispatchToStageMilliseconds"/>
        /// spans input transit + decode + commit + render/present.
        /// </summary>
        public static void NoteNativePointerRelease(long stopwatchTimestamp = 0) {
            if (CommitSample == null) return;
            pendingNativeReleaseTimestamp = stopwatchTimestamp > 0 ? stopwatchTimestamp : Stopwatch.GetTimestamp();
        }

        internal static void NoteClientPointerTime(double clientTimeMs) {
            if (CommitSample == null) return;
            pendingClientReleaseTimeMs = clientTimeMs;
        }

        public readonly struct CommitObservation {
            public readonly string CommandId, SessionId, CommandType, Tool, Stage;
            public readonly int BaseRevision, Revision;
            public readonly double Milliseconds;
            public readonly double DispatchToStageMilliseconds;
            public readonly double ClientTimeMs;
            public readonly long AllocatedBytes;
            public readonly StationEditMetrics Metrics;

            internal CommitObservation(
                string id, string sessionId, string type, string tool,
                int baseRevision, int revision, string stage,
                double milliseconds, double dispatchToStageMilliseconds, double clientTimeMs,
                long allocatedBytes, StationEditMetrics metrics) {
                CommandId = id;
                SessionId = sessionId;
                CommandType = type;
                Tool = tool ?? "";
                BaseRevision = baseRevision;
                Revision = revision;
                Stage = stage;
                Milliseconds = milliseconds;
                DispatchToStageMilliseconds = dispatchToStageMilliseconds;
                ClientTimeMs = clientTimeMs;
                AllocatedBytes = allocatedBytes;
                Metrics = metrics;
            }
        }

        internal sealed class CommitTrace : IDisposable {
            string id = "", sessionId = "", type = "", tool = "";
            int baseRevision;
            readonly long start;
            readonly long nativeDispatchStart;
            double clientTimeMs = double.NaN;
            readonly long startAllocated;
            long commitAllocatedBytes;
            readonly Action<CommitObservation> sample;
            StationEditTrace.MetricsSession metricsSession;
            bool hasMetricsSession;

            internal int Revision { get; private set; }
            internal StationEditMetrics Metrics { get; }

            internal CommitTrace(Action<CommitObservation> sample, int baseRevision) {
                this.sample = sample;
                this.baseRevision = baseRevision;
                start = Stopwatch.GetTimestamp();
                nativeDispatchStart = pendingNativeReleaseTimestamp;
                pendingNativeReleaseTimestamp = 0;
                startAllocated = StationEditTrace.ReadManagedBytes();
                Metrics = new StationEditMetrics();
                metricsSession = StationEditTrace.BeginMetrics(Metrics);
                hasMetricsSession = true;
            }

            internal void BindCommand(StationCommand command, int currentBaseRevision, string activeTool) {
                id = command.Id ?? "";
                sessionId = command.SessionId ?? "";
                type = command.Type ?? "";
                tool = activeTool ?? "";
                baseRevision = currentBaseRevision;
                if (!double.IsNaN(pendingClientReleaseTimeMs)) {
                    clientTimeMs = pendingClientReleaseTimeMs;
                    pendingClientReleaseTimeMs = double.NaN;
                } else if (command.Payload?["time"] != null) {
                    try { clientTimeMs = (double)command.Payload["time"]; } catch { clientTimeMs = double.NaN; }
                }
            }

            internal static bool CanObserveCommandType(string type) {
                if (string.IsNullOrEmpty(type)) return false;
                if (type == "pointer.up" || type == "pointer.down" || type == "pointer.rightTap") return true;
                if (type == "edit.undo" || type == "edit.redo" || type == "edit.delete") return true;
                if (type == "face.paint" || type == "sign.commit" || type == "road.commit" || type == "road.undo") return true;
                return false;
            }

            internal void Commit(int revision) {
                Revision = revision;
                commitAllocatedBytes = Math.Max(0L, StationEditTrace.ReadManagedBytes() - startAllocated);
                Mark("authoritative-commit");
            }

            internal void EndCommandScope() {
                if (!hasMetricsSession) return;
                commitAllocatedBytes = Math.Max(0L, StationEditTrace.ReadManagedBytes() - startAllocated);
                metricsSession.Dispose();
                hasMetricsSession = false;
            }

            internal void Mark(string stage) {
                long now = Stopwatch.GetTimestamp();
                double milliseconds = (now - start) * 1000d / Stopwatch.Frequency;
                double dispatchMs = nativeDispatchStart > 0
                    ? (now - nativeDispatchStart) * 1000d / Stopwatch.Frequency
                    : double.NaN;
                long alloc = hasMetricsSession
                    ? Math.Max(0L, StationEditTrace.ReadManagedBytes() - startAllocated)
                    : commitAllocatedBytes;
                sample(new CommitObservation(
                    id, sessionId, type, tool, baseRevision, Revision, stage,
                    milliseconds, dispatchMs, clientTimeMs, alloc, Metrics));
            }

            public void Dispose() {
                EndCommandScope();
            }
        }

        internal static CommitTrace BeginBrowserCommand(int baseRevision) {
            var sample = CommitSample;
            return sample == null ? null : new CommitTrace(sample, baseRevision);
        }

        internal static CommitTrace ObserveCommit(StationCommand command, int baseRevision, CommitTrace existing = null) {
            var sample = CommitSample;
            if (sample == null) {
                existing?.Dispose();
                return null;
            }
            if (!CommitTrace.CanObserveCommandType(command.Type)) {
                existing?.Dispose();
                return null;
            }
            if (command.Type == "pointer.up" && !StationPointerRouter.AnyEditGestureActive()) {
                existing?.Dispose();
                return null;
            }
            var trace = existing ?? new CommitTrace(sample, baseRevision);
            trace.BindCommand(command, baseRevision, StationToolSelection.Active);
            return trace;
        }

        public static Scope Measure(string stage) => new Scope(stage);

        public readonly struct Scope : IDisposable {
            readonly bool enabled;
            readonly StationEditTrace.Scope managed;

            internal Scope(string stage) {
                enabled = Enabled;
                managed = StationEditTrace.Measure(stage);
                if (enabled) Profiler.BeginSample(stage);
            }

            public void Dispose() {
                if (enabled) Profiler.EndSample();
                managed.Dispose();
            }
        }
    }

    /// <summary>
    /// Opt-in bridge readout (`profile.commits`) for end-to-end WebGL and desktop player
    /// benchmarks. Zero allocations or hooks when not enabled via `{ "enable": true }`.
    /// </summary>
    public sealed class StationEditProfileCommandHandler : IStationCommandHandler {
        static readonly List<StationEditProfiling.CommitObservation> buffered = new List<StationEditProfiling.CommitObservation>(64);
        static bool subscribed;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() => StationCommandHandlers.Add(new StationEditProfileCommandHandler());

        static void OnSample(StationEditProfiling.CommitObservation obs) {
            if (buffered.Count < 4096) buffered.Add(obs);
        }

        public static void SetActive(bool enable) {
            if (enable && !subscribed) {
                buffered.Clear();
                StationEditProfiling.CommitSample += OnSample;
                subscribed = true;
            } else if (!enable && subscribed) {
                StationEditProfiling.CommitSample -= OnSample;
                subscribed = false;
                buffered.Clear();
            }
        }

        public static JArray DrainSamplesJson(bool clear = true) {
            var arr = new JArray();
            for (int i = 0; i < buffered.Count; i++) {
                var o = buffered[i];
                var item = new JObject {
                    ["commandId"] = o.CommandId ?? "",
                    ["commandType"] = o.CommandType ?? "",
                    ["tool"] = o.Tool ?? "",
                    ["baseRevision"] = o.BaseRevision,
                    ["revision"] = o.Revision,
                    ["stage"] = o.Stage ?? "",
                    ["ms"] = Math.Round(o.Milliseconds, 4),
                    ["dispatchToStageMs"] = double.IsNaN(o.DispatchToStageMilliseconds) ? JValue.CreateNull() : new JValue(Math.Round(o.DispatchToStageMilliseconds, 4)),
                    ["allocatedBytes"] = o.AllocatedBytes,
                };
                if (o.Metrics != null && (o.Stage == "authoritative-commit" || o.Stage == "commit-serialized")) {
                    var stages = new JArray();
                    for (int s = 0; s < o.Metrics.Stages.Count; s++) {
                        var st = o.Metrics.Stages[s];
                        stages.Add(new JObject {
                            ["stage"] = st.Stage,
                            ["ms"] = Math.Round(st.Milliseconds, 4),
                            ["bytes"] = st.AllocatedBytes,
                            ["depth"] = st.Depth,
                        });
                    }
                    item["metrics"] = new JObject {
                        ["scannedRecords"] = o.Metrics.ScannedRecords,
                        ["clonedRecords"] = o.Metrics.ClonedRecords,
                        ["rebuiltChunks"] = o.Metrics.RebuiltChunks,
                        ["retainedChunks"] = o.Metrics.RetainedChunks,
                        ["instantiatedPrefabs"] = o.Metrics.InstantiatedPrefabs,
                        ["graphNodes"] = o.Metrics.GraphNodes,
                        ["touchedGraphNodes"] = o.Metrics.TouchedGraphNodes,
                        ["reconciledActors"] = o.Metrics.ReconciledActors,
                        ["usedLocalDocument"] = o.Metrics.UsedLocalDocument,
                        ["usedRetainedView"] = o.Metrics.UsedRetainedView,
                        ["usedIncrementalGraph"] = o.Metrics.UsedIncrementalGraph,
                        ["usedDeltaPayload"] = o.Metrics.UsedDeltaPayload,
                        ["documentFallback"] = o.Metrics.DocumentFallbackReason ?? "",
                        ["viewFallback"] = o.Metrics.ViewFallbackReason ?? "",
                        ["simFallback"] = o.Metrics.SimFallbackReason ?? "",
                        ["stages"] = stages,
                    };
                }
                arr.Add(item);
            }
            if (clear) buffered.Clear();
            return arr;
        }

        public string Capability => "editProfiling";
        public bool Handles(string type) => string.Equals(type, "profile.commits", StringComparison.Ordinal);

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = null;
            rejectReason = null;
            payload ??= new JObject();
            if (payload["enable"] != null && payload["enable"].Type == JTokenType.Boolean) {
                SetActive((bool)payload["enable"]);
            }
            bool doRead = payload["read"] != null && payload["read"].Type == JTokenType.Boolean && (bool)payload["read"];
            bool doClear = payload["clear"] != null && payload["clear"].Type == JTokenType.Boolean && (bool)payload["clear"];
            if (doRead) {
                payload["samples"] = DrainSamplesJson(doClear);
            } else if (doClear) {
                buffered.Clear();
            }
            payload["active"] = subscribed;
            return true;
        }
    }
}
