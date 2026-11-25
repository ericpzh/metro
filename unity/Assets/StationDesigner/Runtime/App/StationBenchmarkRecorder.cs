using System;
using System.Collections.Generic;
using System.Diagnostics;
using Metro.Build;
using Newtonsoft.Json.Linq;
using Unity.Profiling;
using UnityEngine;
using UnityEngine.Rendering;

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
        static readonly double TicksToMs = 1000.0 / Stopwatch.Frequency;

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

        struct FrameBreakdownSample {
            public double AtMs;
            public double IntervalMs;
            public long Tick;
            public float MainThreadMs;
            public float RenderThreadMs;
            public float GcAllocKb;
            public int Gc0Collections;
            public float PickMs;
            public int PickCount;
            public float CmdMs;
            public int CmdCount;
            public float UiUploadMs;
            public int UiUploads;
            public float CrowdMs;
            public int CrowdSampled;
            public int CrowdLodSwaps;
            public int CrowdVisible;
            public int CrowdCulled;
            public float InstancedMs;
            public int InstancedBatches;
            public float EscalatorMs;
            public float PublishStateMs;
            public float ViewRigMs;
            public float SimTickMs;
            public float RenderCpuMs;
            public float PresentWaitMs;
        }

        struct BreakdownAccumulator {
            public long PickTicks;
            public int PickCount;
            public long CmdTicks;
            public int CmdCount;
            public long UiUploadTicks;
            public int UiUploads;
            public long CrowdTicks;
            public int CrowdSampled;
            public int CrowdLodSwaps;
            public int CrowdVisible;
            public int CrowdCulled;
            public long InstancedTicks;
            public int InstancedBatches;
            public long EscalatorTicks;
            public long PublishStateTicks;
            public long ViewRigTicks;
            public long SimTickTicks;
            public long RenderCpuTicks;
            public long LastCameraBeginTicks;
            public long LastCameraEndTicks;
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
        readonly List<FrameBreakdownSample> breakdowns = new List<FrameBreakdownSample>(4096);
        readonly List<ResourceSample> resources = new List<ResourceSample>(64);
        ProfilerRecorder memoryRecorder;
        ProfilerRecorder mainThreadRecorder;
        ProfilerRecorder renderThreadRecorder;
        ProfilerRecorder gcAllocRecorder;
        bool memoryRecorderActive;
        bool mainThreadRecorderActive;
        bool renderThreadRecorderActive;
        bool gcAllocRecorderActive;
        bool renderHooksAttached;
        bool recording;
        bool recordBreakdown;
        int lastGc0Count;
        double startedAtSeconds;
        double nextResourceAtSeconds;

        static BreakdownAccumulator accum;

        public static bool InBenchmarkUi { get; private set; }
        public static bool IsRecordingAny { get; private set; }
        public static bool IsBreakdownProfiling { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() {
            InBenchmarkUi = false;
            IsRecordingAny = false;
            IsBreakdownProfiling = false;
            accum = default;
        }

        public static void RecordPickTicks(long ticks) {
            if (!IsBreakdownProfiling) return;
            accum.PickTicks += ticks;
            accum.PickCount++;
        }

        public static void RecordCommandTicks(long ticks, int count) {
            if (!IsBreakdownProfiling) return;
            accum.CmdTicks += ticks;
            accum.CmdCount += count;
        }

        public static void RecordUiUploadTicks(long ticks, bool uploaded) {
            if (!IsBreakdownProfiling) return;
            accum.UiUploadTicks += ticks;
            if (uploaded) accum.UiUploads++;
        }

        public static void RecordCrowdTicks(long ticks, int sampled, int lodSwaps, int visible, int culled) {
            if (!IsBreakdownProfiling) return;
            accum.CrowdTicks += ticks;
            accum.CrowdSampled += sampled;
            accum.CrowdLodSwaps += lodSwaps;
            accum.CrowdVisible = visible;
            accum.CrowdCulled = culled;
        }

        public static void RecordInstancedTicks(long ticks, int submittedBatches) {
            if (!IsBreakdownProfiling) return;
            accum.InstancedTicks += ticks;
            accum.InstancedBatches = submittedBatches;
        }

        public static void RecordEscalatorTicks(long ticks) {
            if (!IsBreakdownProfiling) return;
            accum.EscalatorTicks += ticks;
        }

        public static void RecordPublishStateTicks(long ticks) {
            if (!IsBreakdownProfiling) return;
            accum.PublishStateTicks += ticks;
        }

        public static void RecordViewRigTicks(long ticks) {
            if (!IsBreakdownProfiling) return;
            accum.ViewRigTicks += ticks;
        }

        public static void RecordSimTickTicks(long ticks) {
            if (!IsBreakdownProfiling) return;
            accum.SimTickTicks += ticks;
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
                case "benchmark.start": {
                    InBenchmarkUi = true;
                    bool wantBreakdown = command.Payload != null && command.Payload.Value<bool?>("breakdown") == true;
                    StartRecording(Time.unscaledTimeAsDouble, wantBreakdown);
                    payload["recording"] = true;
                    payload["breakdown"] = wantBreakdown;
                    payload["hardware"] = BuildHardwarePayload();
                    return true;
                }
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

        public void StartRecording(double nowSeconds, bool breakdown = false) {
            DisposeRecorders();
            frames.Clear();
            breakdowns.Clear();
            resources.Clear();
            accum = default;
            startedAtSeconds = nowSeconds;
            nextResourceAtSeconds = 1.0;
            recording = true;
            recordBreakdown = breakdown;
            IsRecordingAny = true;
            IsBreakdownProfiling = breakdown;
            lastGc0Count = GC.CollectionCount(0);
            try {
                memoryRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "Total Used Memory");
                memoryRecorderActive = memoryRecorder.Valid;
            } catch {
                memoryRecorderActive = false;
            }
            if (breakdown) {
                try {
                    mainThreadRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Internal, "Main Thread", 1);
                    mainThreadRecorderActive = mainThreadRecorder.Valid;
                } catch { mainThreadRecorderActive = false; }
                try {
                    renderThreadRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Render Thread", 1);
                    renderThreadRecorderActive = renderThreadRecorder.Valid;
                } catch { renderThreadRecorderActive = false; }
                try {
                    gcAllocRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "GC Allocated In Frame", 1);
                    gcAllocRecorderActive = gcAllocRecorder.Valid;
                } catch { gcAllocRecorderActive = false; }
                AttachRenderHooks();
            }
        }

        void AttachRenderHooks() {
            if (renderHooksAttached) return;
            renderHooksAttached = true;
            RenderPipelineManager.beginCameraRendering += OnBeginCamera;
            RenderPipelineManager.endCameraRendering += OnEndCamera;
        }

        void DetachRenderHooks() {
            if (!renderHooksAttached) return;
            renderHooksAttached = false;
            RenderPipelineManager.beginCameraRendering -= OnBeginCamera;
            RenderPipelineManager.endCameraRendering -= OnEndCamera;
        }

        static void OnBeginCamera(ScriptableRenderContext context, Camera camera) {
            if (!IsBreakdownProfiling || camera == null || camera.cameraType != CameraType.Game || camera.targetTexture != null) return;
            accum.LastCameraBeginTicks = Stopwatch.GetTimestamp();
        }

        static void OnEndCamera(ScriptableRenderContext context, Camera camera) {
            if (!IsBreakdownProfiling || camera == null || camera.cameraType != CameraType.Game || camera.targetTexture != null) return;
            long now = Stopwatch.GetTimestamp();
            if (accum.LastCameraBeginTicks != 0) {
                accum.RenderCpuTicks += now - accum.LastCameraBeginTicks;
                accum.LastCameraBeginTicks = 0;
            }
            accum.LastCameraEndTicks = now;
        }

        public void RecordFrame(double nowSeconds, double intervalMs, long tick) {
            if (!recording) return;
            double elapsedSeconds = Math.Max(0.0, nowSeconds - startedAtSeconds);
            double elapsedMs = elapsedSeconds * 1000.0;
            if (frames.Count < MaxFrameSamples && intervalMs > 0.0 && !double.IsNaN(intervalMs) && !double.IsInfinity(intervalMs)) {
                frames.Add(new FrameSample(elapsedMs, intervalMs, tick));
                if (recordBreakdown) {
                    int gc0Now = GC.CollectionCount(0);
                    int gc0Delta = gc0Now - lastGc0Count;
                    lastGc0Count = gc0Now;
                    long tickNow = Stopwatch.GetTimestamp();
                    float presentWaitMs = accum.LastCameraEndTicks != 0
                        ? (float)Math.Max(0.0, (tickNow - accum.LastCameraEndTicks) * TicksToMs)
                        : 0f;
                    breakdowns.Add(new FrameBreakdownSample {
                        AtMs = elapsedMs,
                        IntervalMs = intervalMs,
                        Tick = tick,
                        MainThreadMs = mainThreadRecorderActive && mainThreadRecorder.Valid ? (float)(mainThreadRecorder.LastValue * 1e-6) : -1f,
                        RenderThreadMs = renderThreadRecorderActive && renderThreadRecorder.Valid ? (float)(renderThreadRecorder.LastValue * 1e-6) : -1f,
                        GcAllocKb = gcAllocRecorderActive && gcAllocRecorder.Valid ? (float)(gcAllocRecorder.LastValue / 1024.0) : -1f,
                        Gc0Collections = gc0Delta,
                        PickMs = (float)(accum.PickTicks * TicksToMs),
                        PickCount = accum.PickCount,
                        CmdMs = (float)(accum.CmdTicks * TicksToMs),
                        CmdCount = accum.CmdCount,
                        UiUploadMs = (float)(accum.UiUploadTicks * TicksToMs),
                        UiUploads = accum.UiUploads,
                        CrowdMs = (float)(accum.CrowdTicks * TicksToMs),
                        CrowdSampled = accum.CrowdSampled,
                        CrowdLodSwaps = accum.CrowdLodSwaps,
                        CrowdVisible = accum.CrowdVisible,
                        CrowdCulled = accum.CrowdCulled,
                        InstancedMs = (float)(accum.InstancedTicks * TicksToMs),
                        InstancedBatches = accum.InstancedBatches,
                        EscalatorMs = (float)(accum.EscalatorTicks * TicksToMs),
                        PublishStateMs = (float)(accum.PublishStateTicks * TicksToMs),
                        ViewRigMs = (float)(accum.ViewRigTicks * TicksToMs),
                        SimTickMs = (float)(accum.SimTickTicks * TicksToMs),
                        RenderCpuMs = (float)(accum.RenderCpuTicks * TicksToMs),
                        PresentWaitMs = presentWaitMs,
                    });
                    accum = default;
                }
            } else if (recordBreakdown) {
                accum = default;
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
            bool hadBreakdown = recordBreakdown;
            recording = false;
            recordBreakdown = false;
            IsRecordingAny = false;
            IsBreakdownProfiling = false;
            accum = default;
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

            if (hadBreakdown && breakdowns.Count > 1) {
                payload["breakdown"] = BuildBreakdownPayload();
            }

            frames.Clear();
            breakdowns.Clear();
            resources.Clear();

            payload["recording"] = false;
            payload["frames"] = framesArray;
            payload["resources"] = resourcesArray;
            payload["hardware"] = BuildHardwarePayload();
        }

        JObject BuildBreakdownPayload() {
            // Skip sample 0 (recording start boundary) to match frame stats.
            int start = breakdowns.Count > 1 ? 1 : 0;
            int n = breakdowns.Count - start;
            double sumMain = 0, sumRender = 0, sumGcKb = 0, sumPick = 0, sumCmd = 0, sumUi = 0;
            double sumCrowd = 0, sumInst = 0, sumEsc = 0, sumPub = 0, sumRig = 0, sumSim = 0, sumRenderCpu = 0, sumPresentWait = 0;
            float maxMain = 0, maxRender = 0, maxGcKb = 0, maxPick = 0, maxCmd = 0, maxUi = 0;
            float maxCrowd = 0, maxInst = 0, maxEsc = 0, maxPub = 0, maxRig = 0, maxSim = 0, maxRenderCpu = 0, maxPresentWait = 0;
            int totalGc0 = 0, totalPicks = 0, totalUiUploads = 0, totalSampled = 0, totalLodSwaps = 0;
            int mainValidCount = 0, renderValidCount = 0, gcValidCount = 0;

            var sorted = new List<FrameBreakdownSample>(n);
            for (int i = start; i < breakdowns.Count; i++) {
                var b = breakdowns[i];
                sorted.Add(b);
                if (b.MainThreadMs >= 0f) { sumMain += b.MainThreadMs; mainValidCount++; if (b.MainThreadMs > maxMain) maxMain = b.MainThreadMs; }
                if (b.RenderThreadMs >= 0f) { sumRender += b.RenderThreadMs; renderValidCount++; if (b.RenderThreadMs > maxRender) maxRender = b.RenderThreadMs; }
                if (b.GcAllocKb >= 0f) { sumGcKb += b.GcAllocKb; gcValidCount++; if (b.GcAllocKb > maxGcKb) maxGcKb = b.GcAllocKb; }
                totalGc0 += b.Gc0Collections;
                sumPick += b.PickMs; totalPicks += b.PickCount; if (b.PickMs > maxPick) maxPick = b.PickMs;
                sumCmd += b.CmdMs; if (b.CmdMs > maxCmd) maxCmd = b.CmdMs;
                sumUi += b.UiUploadMs; totalUiUploads += b.UiUploads; if (b.UiUploadMs > maxUi) maxUi = b.UiUploadMs;
                sumCrowd += b.CrowdMs; totalSampled += b.CrowdSampled; totalLodSwaps += b.CrowdLodSwaps; if (b.CrowdMs > maxCrowd) maxCrowd = b.CrowdMs;
                sumInst += b.InstancedMs; if (b.InstancedMs > maxInst) maxInst = b.InstancedMs;
                sumEsc += b.EscalatorMs; if (b.EscalatorMs > maxEsc) maxEsc = b.EscalatorMs;
                sumPub += b.PublishStateMs; if (b.PublishStateMs > maxPub) maxPub = b.PublishStateMs;
                sumRig += b.ViewRigMs; if (b.ViewRigMs > maxRig) maxRig = b.ViewRigMs;
                sumSim += b.SimTickMs; if (b.SimTickMs > maxSim) maxSim = b.SimTickMs;
                sumRenderCpu += b.RenderCpuMs; if (b.RenderCpuMs > maxRenderCpu) maxRenderCpu = b.RenderCpuMs;
                sumPresentWait += b.PresentWaitMs; if (b.PresentWaitMs > maxPresentWait) maxPresentWait = b.PresentWaitMs;
            }
            sorted.Sort((a, b) => b.IntervalMs.CompareTo(a.IntervalMs));

            int topCount = Math.Min(20, sorted.Count);
            int topGc0Spikes = 0;
            var topArr = new JArray();
            for (int i = 0; i < topCount; i++) {
                var s = sorted[i];
                if (s.Gc0Collections > 0) topGc0Spikes++;
                topArr.Add(new JObject {
                    ["atMs"] = Math.Round(s.AtMs, 1),
                    ["ms"] = Math.Round(s.IntervalMs, 2),
                    ["tick"] = s.Tick,
                    ["mainMs"] = Math.Round(s.MainThreadMs, 2),
                    ["renderMs"] = Math.Round(s.RenderThreadMs, 2),
                    ["gcKb"] = Math.Round(s.GcAllocKb, 1),
                    ["gc0"] = s.Gc0Collections,
                    ["pickMs"] = Math.Round(s.PickMs, 2),
                    ["picks"] = s.PickCount,
                    ["cmdMs"] = Math.Round(s.CmdMs, 2),
                    ["cmds"] = s.CmdCount,
                    ["uiMs"] = Math.Round(s.UiUploadMs, 2),
                    ["uiUploads"] = s.UiUploads,
                    ["crowdMs"] = Math.Round(s.CrowdMs, 2),
                    ["sampled"] = s.CrowdSampled,
                    ["lodSwaps"] = s.CrowdLodSwaps,
                    ["visPax"] = s.CrowdVisible,
                    ["culledPax"] = s.CrowdCulled,
                    ["instMs"] = Math.Round(s.InstancedMs, 2),
                    ["instBatches"] = s.InstancedBatches,
                    ["escMs"] = Math.Round(s.EscalatorMs, 2),
                    ["pubMs"] = Math.Round(s.PublishStateMs, 2),
                    ["rigMs"] = Math.Round(s.ViewRigMs, 2),
                    ["simMs"] = Math.Round(s.SimTickMs, 2),
                    ["renderCpuMs"] = Math.Round(s.RenderCpuMs, 2),
                    ["presentWaitMs"] = Math.Round(s.PresentWaitMs, 2),
                });
            }

            double invN = n > 0 ? 1.0 / n : 0.0;
            return new JObject {
                ["frames"] = n,
                ["gc0Total"] = totalGc0,
                ["topSpikesWithGc0"] = topGc0Spikes,
                ["totalPicks"] = totalPicks,
                ["totalUiUploads"] = totalUiUploads,
                ["totalCrowdSampled"] = totalSampled,
                ["totalCrowdLodSwaps"] = totalLodSwaps,
                ["avg"] = new JObject {
                    ["mainMs"] = mainValidCount > 0 ? Math.Round(sumMain / mainValidCount, 2) : -1,
                    ["renderMs"] = renderValidCount > 0 ? Math.Round(sumRender / renderValidCount, 2) : -1,
                    ["gcKb"] = gcValidCount > 0 ? Math.Round(sumGcKb / gcValidCount, 1) : -1,
                    ["pickMs"] = Math.Round(sumPick * invN, 3),
                    ["cmdMs"] = Math.Round(sumCmd * invN, 3),
                    ["uiMs"] = Math.Round(sumUi * invN, 3),
                    ["crowdMs"] = Math.Round(sumCrowd * invN, 3),
                    ["instMs"] = Math.Round(sumInst * invN, 3),
                    ["escMs"] = Math.Round(sumEsc * invN, 3),
                    ["pubMs"] = Math.Round(sumPub * invN, 3),
                    ["rigMs"] = Math.Round(sumRig * invN, 3),
                    ["simMs"] = Math.Round(sumSim * invN, 3),
                    ["renderCpuMs"] = Math.Round(sumRenderCpu * invN, 2),
                    ["presentWaitMs"] = Math.Round(sumPresentWait * invN, 2),
                },
                ["max"] = new JObject {
                    ["mainMs"] = Math.Round(maxMain, 2),
                    ["renderMs"] = Math.Round(maxRender, 2),
                    ["gcKb"] = Math.Round(maxGcKb, 1),
                    ["pickMs"] = Math.Round(maxPick, 2),
                    ["cmdMs"] = Math.Round(maxCmd, 2),
                    ["uiMs"] = Math.Round(maxUi, 2),
                    ["crowdMs"] = Math.Round(maxCrowd, 2),
                    ["instMs"] = Math.Round(maxInst, 2),
                    ["escMs"] = Math.Round(maxEsc, 2),
                    ["pubMs"] = Math.Round(maxPub, 2),
                    ["rigMs"] = Math.Round(maxRig, 2),
                    ["simMs"] = Math.Round(maxSim, 2),
                    ["renderCpuMs"] = Math.Round(maxRenderCpu, 2),
                    ["presentWaitMs"] = Math.Round(maxPresentWait, 2),
                },
                ["topSpikes"] = topArr,
            };
        }

        void DisposeRecorders() {
            DetachRenderHooks();
            if (memoryRecorderActive) {
                try { memoryRecorder.Dispose(); } catch { }
                memoryRecorderActive = false;
            }
            if (mainThreadRecorderActive) {
                try { mainThreadRecorder.Dispose(); } catch { }
                mainThreadRecorderActive = false;
            }
            if (renderThreadRecorderActive) {
                try { renderThreadRecorder.Dispose(); } catch { }
                renderThreadRecorderActive = false;
            }
            if (gcAllocRecorderActive) {
                try { gcAllocRecorder.Dispose(); } catch { }
                gcAllocRecorderActive = false;
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
