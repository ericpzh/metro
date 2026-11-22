using System;
using System.Collections.Generic;
using Metro.Build;
using Newtonsoft.Json.Linq;
using Unity.Profiling;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// Opt-in per-frame recorder for the interactive Unity benchmark route
    /// (<c>UnityBenchmarkRoute.tsx</c>). Records actual Unity frame intervals
    /// (<c>Time.unscaledDeltaTime</c>), simulation ticks, native Unity memory usage,
    /// and host hardware facts so desktop standalone (<c>.exe</c>) and Editor runs
    /// measure real D3D11/Vulkan frame pacing instead of WebView2's offscreen
    /// <c>requestAnimationFrame</c> cadence. Completely inert when not recording.
    /// </summary>
    public sealed class StationBenchmarkRecorder : IStationCommandHandler, IStationFrameSink, IStationActiveDuringExplodedView {
        const int MaxFrameSamples = 16000;
        const int MaxResourceSamples = 120;

        readonly struct FrameSample {
            public readonly double AtMs;
            public readonly double IntervalMs;
            public readonly long Tick;

            public FrameSample(double atMs, double intervalMs, long tick) {
                AtMs = atMs;
                IntervalMs = intervalMs;
                Tick = tick;
            }
        }

        readonly struct ResourceSample {
            public readonly double AtMs;
            public readonly double? RamMb;

            public ResourceSample(double atMs, double? ramMb) {
                AtMs = atMs;
                RamMb = ramMb;
            }
        }

        readonly List<FrameSample> frames = new List<FrameSample>(4096);
        readonly List<ResourceSample> resources = new List<ResourceSample>(64);
        ProfilerRecorder memoryRecorder;
        bool memoryRecorderActive;
        bool recording;
        double startedAtSeconds;
        double nextResourceAtSeconds;

        public static bool InBenchmarkUi { get; private set; }
        public static bool IsRecordingAny { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() {
            InBenchmarkUi = false;
            IsRecordingAny = false;
        }

        public string Capability => "benchmark";
        public bool IsRecording => recording;

        public bool Handles(string type) =>
            type == "benchmark.start" || type == "benchmark.stop" || type == "benchmark.info" || type == "benchmark.mode";

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            switch (command.Type) {
                case "benchmark.mode":
                    InBenchmarkUi = command.Payload != null && command.Payload.Value<bool?>("active") == true;
                    payload["active"] = InBenchmarkUi;
                    return true;
                case "benchmark.start":
                    InBenchmarkUi = true;
                    StartRecording(Time.unscaledTimeAsDouble);
                    payload["recording"] = true;
                    payload["hardware"] = BuildHardwarePayload();
                    return true;
                case "benchmark.stop":
                    StopRecordingAndWrite(payload);
                    return true;
                case "benchmark.info":
                    payload["recording"] = recording;
                    payload["active"] = InBenchmarkUi;
                    payload["hardware"] = BuildHardwarePayload();
                    return true;
                default:
                    rejectCode = "unknown-benchmark-command";
                    rejectReason = "Unsupported benchmark command.";
                    return false;
            }
        }

        public void Tick(StationDocument document, StationIndex index, StationFrameClock clock) {
            if (!recording) return;
            RecordFrame(Time.unscaledTimeAsDouble, Time.unscaledDeltaTime * 1000.0, clock.Tick);
        }

        public void StartRecording(double nowSeconds) {
            DisposeRecorders();
            frames.Clear();
            resources.Clear();
            startedAtSeconds = nowSeconds;
            nextResourceAtSeconds = 1.0;
            recording = true;
            IsRecordingAny = true;
            try {
                memoryRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "Total Used Memory");
                memoryRecorderActive = memoryRecorder.Valid;
            } catch {
                memoryRecorderActive = false;
            }
        }

        public void RecordFrame(double nowSeconds, double intervalMs, long tick) {
            if (!recording) return;
            double elapsedSeconds = Math.Max(0.0, nowSeconds - startedAtSeconds);
            double elapsedMs = elapsedSeconds * 1000.0;
            if (frames.Count < MaxFrameSamples && intervalMs > 0.0 && !double.IsNaN(intervalMs) && !double.IsInfinity(intervalMs)) {
                frames.Add(new FrameSample(elapsedMs, intervalMs, tick));
            }
            if (resources.Count < MaxResourceSamples && elapsedSeconds >= nextResourceAtSeconds) {
                nextResourceAtSeconds = Math.Floor(elapsedSeconds) + 1.0;
                double? ramMb = null;
                if (memoryRecorderActive && memoryRecorder.Valid) {
                    long bytes = memoryRecorder.LastValue;
                    if (bytes > 0) ramMb = Math.Round(bytes / (1024.0 * 1024.0), 1);
                }
                resources.Add(new ResourceSample(elapsedMs, ramMb));
            }
        }

        internal void StopRecordingAndWrite(JObject payload) {
            recording = false;
            IsRecordingAny = false;
            DisposeRecorders();

            var framesArray = new JArray();
            for (int i = 0; i < frames.Count; i++) {
                var f = frames[i];
                framesArray.Add(new JArray(
                    Math.Round(f.AtMs, 2),
                    Math.Round(f.IntervalMs, 3),
                    f.Tick));
            }

            var resourcesArray = new JArray();
            for (int i = 0; i < resources.Count; i++) {
                var r = resources[i];
                var item = new JObject {
                    ["at"] = Math.Round(r.AtMs, 1),
                    ["cpu"] = JValue.CreateNull(),
                    ["gpu"] = JValue.CreateNull(),
                    ["ram"] = r.RamMb.HasValue ? new JValue(r.RamMb.Value) : JValue.CreateNull(),
                };
                resourcesArray.Add(item);
            }

            frames.Clear();
            resources.Clear();

            payload["recording"] = false;
            payload["frames"] = framesArray;
            payload["resources"] = resourcesArray;
            payload["hardware"] = BuildHardwarePayload();
        }

        void DisposeRecorders() {
            if (memoryRecorderActive) {
                try { memoryRecorder.Dispose(); } catch { }
                memoryRecorderActive = false;
            }
        }

        internal static JObject BuildHardwarePayload() {
            int memMb = SystemInfo.systemMemorySize;
            int vramMb = SystemInfo.graphicsMemorySize;
            bool isDesktop = Application.platform != RuntimePlatform.WebGLPlayer;
            return new JObject {
                ["gpu"] = SystemInfo.graphicsDeviceName ?? "",
                ["gpuApi"] = SystemInfo.graphicsDeviceType.ToString(),
                ["vramMb"] = vramMb > 0 ? new JValue(vramMb) : JValue.CreateNull(),
                ["cpu"] = SystemInfo.processorType ?? "",
                ["cpuCores"] = SystemInfo.processorCount > 0 ? new JValue(SystemInfo.processorCount) : JValue.CreateNull(),
                ["memoryGb"] = memMb > 0 ? new JValue(Math.Round(memMb / 1024.0, 1)) : JValue.CreateNull(),
                ["screenWidth"] = Screen.width,
                ["screenHeight"] = Screen.height,
                ["engine"] = "Unity " + Application.unityVersion,
                ["platform"] = Application.platform.ToString(),
                ["isDesktop"] = isDesktop,
            };
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() {
            var recorder = new StationBenchmarkRecorder();
            StationCommandHandlers.Add(recorder);
            StationFrameSinks.Add(recorder);
        }
    }
}
