using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace Metro.Build {
    /// <summary>
    /// Per-command opt-in stage timings, managed allocations, fallback codes and workload
    /// counts. Allocated only when a trace or profiling subscriber opts in.
    /// </summary>
    public sealed class StationEditMetrics {
        public readonly struct StageRecord {
            public readonly string Stage;
            public readonly double Milliseconds;
            public readonly long AllocatedBytes;
            public readonly int Depth;

            public StageRecord(string stage, double milliseconds, long allocatedBytes, int depth) {
                Stage = stage;
                Milliseconds = milliseconds;
                AllocatedBytes = allocatedBytes;
                Depth = depth;
            }
        }

        public readonly List<StageRecord> Stages = new List<StageRecord>(16);
        public int ScannedRecords;
        public int ClonedRecords;
        public int RebuiltChunks;
        public int RetainedChunks;
        public int InstantiatedPrefabs;
        public int GraphNodes;
        public int TouchedGraphNodes;
        public int ReconciledActors;
        public bool UsedLocalDocument;
        public bool UsedRetainedView;
        public bool UsedIncrementalGraph;
        public bool UsedDeltaPayload;
        public string DocumentFallbackReason = "";
        public string ViewFallbackReason = "";
        public string SimFallbackReason = "";
        internal int CurrentDepth;
    }

    /// <summary>Opt-in managed stage timings and workload counters. No clock or allocation work
    /// without a subscriber or active metrics sink; usable by both player captures and engine-free probes.</summary>
    public static class StationEditTrace {
        public static event Action<string, double, long> Sample;

        [ThreadStatic]
        static StationEditMetrics currentMetrics;

        public static StationEditMetrics CurrentMetrics => currentMetrics;

        public static MetricsSession BeginMetrics(StationEditMetrics metrics = null) =>
            new MetricsSession(metrics ?? new StationEditMetrics());

        public static Scope Measure(string stage) => new Scope(stage, Sample, currentMetrics);

        public static void AddScanned(int count) {
            if (currentMetrics != null && count > 0) currentMetrics.ScannedRecords += count;
        }

        public static void AddCloned(int count) {
            if (currentMetrics != null && count > 0) currentMetrics.ClonedRecords += count;
        }

        public static void AddRebuiltChunks(int rebuilt, int retained = 0) {
            if (currentMetrics == null) return;
            if (rebuilt > 0) currentMetrics.RebuiltChunks += rebuilt;
            if (retained > 0) currentMetrics.RetainedChunks += retained;
        }

        public static void AddInstantiatedPrefabs(int count) {
            if (currentMetrics != null && count > 0) currentMetrics.InstantiatedPrefabs += count;
        }

        public static void AddInstantiatedPrefab() => AddInstantiatedPrefabs(1);

        public static void SetGraphCounts(int graphNodes, int touchedNodes, int reconciledActors = 0) {
            if (currentMetrics == null) return;
            currentMetrics.GraphNodes = graphNodes;
            currentMetrics.TouchedGraphNodes += touchedNodes;
            currentMetrics.ReconciledActors += reconciledActors;
        }

        public static void NoteLocalDocument() {
            if (currentMetrics != null) currentMetrics.UsedLocalDocument = true;
        }

        public static void NoteRetainedView() {
            if (currentMetrics != null) currentMetrics.UsedRetainedView = true;
        }

        public static void NoteIncrementalGraph() {
            if (currentMetrics != null) currentMetrics.UsedIncrementalGraph = true;
        }

        public static void NoteDeltaPayload() {
            if (currentMetrics != null) currentMetrics.UsedDeltaPayload = true;
        }

        public static void NoteDocumentFallback(string reason) {
            if (currentMetrics != null && string.IsNullOrEmpty(currentMetrics.DocumentFallbackReason) && !string.IsNullOrEmpty(reason))
                currentMetrics.DocumentFallbackReason = reason;
        }

        public static void NoteViewFallback(string reason) {
            if (currentMetrics != null && string.IsNullOrEmpty(currentMetrics.ViewFallbackReason) && !string.IsNullOrEmpty(reason))
                currentMetrics.ViewFallbackReason = reason;
        }

        public static void NoteSimFallback(string reason) {
            if (currentMetrics != null && string.IsNullOrEmpty(currentMetrics.SimFallbackReason) && !string.IsNullOrEmpty(reason))
                currentMetrics.SimFallbackReason = reason;
        }

        public readonly struct MetricsSession : IDisposable {
            readonly StationEditMetrics previous;
            public readonly StationEditMetrics Metrics;

            internal MetricsSession(StationEditMetrics next) {
                previous = currentMetrics;
                Metrics = next;
                currentMetrics = next;
            }

            public void Dispose() {
                currentMetrics = previous;
            }
        }

        public static long ReadManagedBytes() {
            long threadBytes = GC.GetAllocatedBytesForCurrentThread();
            return threadBytes > 0 ? threadBytes : GC.GetTotalMemory(false);
        }

        public readonly struct Scope : IDisposable {
            readonly string stage;
            readonly Action<string, double, long> sample;
            readonly StationEditMetrics metrics;
            readonly int depth;
            readonly long started, allocated;

            internal Scope(string stage, Action<string, double, long> sample, StationEditMetrics metrics) {
                this.stage = stage;
                this.sample = sample;
                this.metrics = metrics;
                bool active = sample != null || metrics != null;
                if (active) {
                    depth = metrics != null ? metrics.CurrentDepth++ : 0;
                    started = Stopwatch.GetTimestamp();
                    allocated = ReadManagedBytes();
                } else {
                    depth = 0;
                    started = 0;
                    allocated = 0;
                }
            }

            public void Dispose() {
                if (sample == null && metrics == null) return;
                double ms = (Stopwatch.GetTimestamp() - started) * 1000d / Stopwatch.Frequency;
                long bytes = Math.Max(0L, ReadManagedBytes() - allocated);
                if (metrics != null) {
                    metrics.CurrentDepth = depth;
                    metrics.Stages.Add(new StationEditMetrics.StageRecord(stage, ms, bytes, depth));
                }
                sample?.Invoke(stage, ms, bytes);
            }
        }
    }
}
