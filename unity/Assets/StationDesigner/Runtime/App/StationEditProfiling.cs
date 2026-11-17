using System;
using Metro.Build;
using UnityEngine.Profiling;

namespace Metro.App {
    /// <summary>Player CPU timeline markers plus optional managed allocation samples.
    /// Disabled in engine-free probes; the live host enables native markers on Awake.</summary>
    public static class StationEditProfiling {
        public static bool Enabled;
        public static Scope Measure(string stage) => new Scope(stage);
        public readonly struct Scope : IDisposable {
            readonly bool enabled;
            readonly StationEditTrace.Scope managed;
            internal Scope(string stage) {
                enabled = Enabled;
                managed = StationEditTrace.Measure(stage);
                if (enabled) Profiler.BeginSample(stage);
            }
            public void Dispose() { if (enabled) Profiler.EndSample(); managed.Dispose(); }
        }
    }
}
