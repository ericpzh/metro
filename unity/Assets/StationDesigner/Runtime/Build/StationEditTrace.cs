using System;
using System.Diagnostics;

namespace Metro.Build {
    /// <summary>Opt-in managed stage timings. No clock or allocation work without a subscriber;
    /// usable by both a player capture and engine-free diagnostic probes.</summary>
    public static class StationEditTrace {
        public static event Action<string, double, long> Sample;
        public static Scope Measure(string stage) => new Scope(stage, Sample);
        public readonly struct Scope : IDisposable {
            readonly string stage;
            readonly Action<string, double, long> sample;
            readonly long started, allocated;
            internal Scope(string stage, Action<string, double, long> sample) {
                this.stage = stage; this.sample = sample;
                started = sample == null ? 0 : Stopwatch.GetTimestamp();
                allocated = sample == null ? 0 : GC.GetAllocatedBytesForCurrentThread();
            }
            public void Dispose() {
                if (sample != null) sample(stage, (Stopwatch.GetTimestamp() - started) * 1000d / Stopwatch.Frequency,
                    GC.GetAllocatedBytesForCurrentThread() - allocated);
            }
        }
    }
}
