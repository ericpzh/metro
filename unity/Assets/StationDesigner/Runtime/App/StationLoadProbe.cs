using System;
using System.Diagnostics;
using UnityEngine;
using UnityEngine.Profiling;

namespace Metro.App {
    /// <summary>Opt-in stage log that survives an aborted WebGL load.</summary>
    internal static class StationLoadProbe {
        static bool? enabled;
        static int nextLoad;

        public static Action<string> Begin(string sourceId, bool replacing) {
            if (!Application.isPlaying || !(enabled ??= IsEnabled())) return null;
            int load = ++nextLoad;
            var clock = Stopwatch.StartNew();
            string context = $"load={load} source={sourceId} replacing={replacing}";
            return stage => {
                string elapsed = clock.Elapsed.TotalMilliseconds.ToString("F2", System.Globalization.CultureInfo.InvariantCulture);
                UnityEngine.Debug.Log(
                    $"[MetroLoad] {context} stage={stage} ms={elapsed} " +
                    $"managedBytes={GC.GetTotalMemory(false)} unityAllocatedBytes={Profiler.GetTotalAllocatedMemoryLong()} " +
                    $"unityReservedBytes={Profiler.GetTotalReservedMemoryLong()}");
            };
        }

        static bool IsEnabled() {
#if UNITY_WEBGL && !UNITY_EDITOR
            return Uri.TryCreate(Application.absoluteURL, UriKind.Absolute, out var uri) &&
                Array.IndexOf(uri.Query.TrimStart('?').Split('&'), "metroLoadProbe=1") >= 0;
#else
            return Array.IndexOf(Environment.GetCommandLineArgs(), "-metroLoadProbe") >= 0;
#endif
        }
    }
}
