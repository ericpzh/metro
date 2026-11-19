using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App {
    /// <summary>
    /// Opt-in standalone Windows player hardware benchmark (`MetroStation.exe -metroBenchOut &lt;report.json&gt;`).
    /// Drives real pointer moves/presses/releases and Ctrl+Z / Ctrl+Y keys through
    /// <see cref="StationDesktopUiPresenter"/> + offscreen WebView2 React UI (`main.tsx`) and
    /// records `release -> authoritative-commit` and `release -> first-frame-presented` across
    /// Zoo, Tanwei and Tianhe. Completely inert (zero allocations/hooks) unless `-metroBenchOut` is passed.
    /// </summary>
    public sealed class StationPlayerBenchmark : MonoBehaviour {
        string reportPath = "";
        string[] targetDemos = { "zoo", "tanwei", "tianhe" };
        readonly List<float> recentFrameMs = new List<float>(2048);
        bool measuringFrames;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Bootstrap() {
            if (!Application.isPlaying) return;
            var args = Environment.GetCommandLineArgs();
            int outIdx = Array.IndexOf(args, "-metroBenchOut");
            if (outIdx < 0 || outIdx + 1 >= args.Length) return;

            string outPath = Path.GetFullPath(args[outIdx + 1]);
            string[] demos = { "zoo", "tanwei", "tianhe" };
            int demoIdx = Array.IndexOf(args, "-metroBenchDemos");
            if (demoIdx >= 0 && demoIdx + 1 < args.Length && !string.IsNullOrWhiteSpace(args[demoIdx + 1])) {
                demos = args[demoIdx + 1]
                    .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                    .Select(s => s.Trim().ToLowerInvariant())
                    .ToArray();
            }

            Application.runInBackground = true;
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = -1;
            if (!Application.isEditor) {
                Screen.SetResolution(1600, 900, FullScreenMode.Windowed);
            }

            var go = new GameObject("StationPlayerBenchmark") { hideFlags = HideFlags.DontSave };
            DontDestroyOnLoad(go);
            var runner = go.AddComponent<StationPlayerBenchmark>();
            runner.reportPath = outPath;
            runner.targetDemos = demos;
        }

        void Update() {
            if (measuringFrames) {
                recentFrameMs.Add(Time.unscaledDeltaTime * 1000f);
            }
        }

        IEnumerator Start() {
            int exitCode = 0;
            var rootReport = new JObject {
                ["schemaVersion"] = 1,
                ["platform"] = Application.platform.ToString(),
                ["unityVersion"] = Application.unityVersion,
                ["startedAtUtc"] = DateTimeOffset.UtcNow.ToString("O"),
            };

            var enumerator = RunSuiteCoroutine(rootReport);
            var stack = new Stack<IEnumerator>();
            stack.Push(enumerator);
            bool suiteFailed = false;
            while (stack.Count > 0) {
                var cur = stack.Peek();
                bool moved;
                object yielded = null;
                try {
                    moved = cur.MoveNext();
                    if (moved) yielded = cur.Current;
                } catch (Exception ex) {
                    UnityEngine.Debug.LogException(ex);
                    rootReport["status"] = "failed";
                    rootReport["error"] = ex.ToString();
                    exitCode = 1;
                    suiteFailed = true;
                    break;
                }
                if (!moved) {
                    stack.Pop();
                    continue;
                }
                if (yielded is IEnumerator sub) {
                    stack.Push(sub);
                } else {
                    yield return yielded;
                }
            }
            if (!suiteFailed) {
                rootReport["status"] = "completed";
            }

            rootReport["finishedAtUtc"] = DateTimeOffset.UtcNow.ToString("O");
            try {
                var dir = Path.GetDirectoryName(reportPath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(reportPath, rootReport.ToString(Formatting.Indented));
            } catch (Exception writeEx) {
                UnityEngine.Debug.LogException(writeEx);
                exitCode = 2;
            }

            if (StationDesktopUiPresenter.Active != null) {
                try { Destroy(StationDesktopUiPresenter.Active.gameObject); } catch { }
            }
            yield return null;
            yield return null;
            Application.Quit(exitCode);
            if (!Application.isEditor) {
                try { Process.GetCurrentProcess().Kill(); } catch { }
            }
        }

        IEnumerator RunSuiteCoroutine(JObject report) {
            StationGameHost host = null;
            float waitHost = 0f;
            while ((host = FindAnyObjectByType<StationGameHost>()) == null && waitHost < 30f) {
                waitHost += Time.unscaledDeltaTime;
                yield return null;
            }
            if (host == null) throw new InvalidOperationException("StationGameHost not found in scene.");

            // Wait for StationDesktopUiPresenter + MetroEditorWebView.exe + initial demo mount:
            float waitUi = 0f;
            while ((StationDesktopUiPresenter.Active == null || !StationDesktopUiPresenter.Active.IsWebReady || !host.IsLoaded) && waitUi < 25f) {
                waitUi += Time.unscaledDeltaTime;
                yield return null;
            }
            if (StationDesktopUiPresenter.Active == null || !StationDesktopUiPresenter.Active.IsWebReady || !host.IsLoaded) {
                throw new InvalidOperationException(
                    $"Startup did not finish within 25s (presenter={StationDesktopUiPresenter.Active != null}, webReady={StationDesktopUiPresenter.Active?.IsWebReady ?? false}, hostLoaded={host.IsLoaded}).");
            }

            // Let initial resize & surface upload settle:
            for (int f = 0; f < 30; f++) yield return null;

            StationDesktopUiPresenter.Active.SuppressPhysicalInput = true;

            var playerArtifacts = new JObject();
            try {
                string exePath = Process.GetCurrentProcess().MainModule?.FileName;
                if (!string.IsNullOrEmpty(exePath) && File.Exists(exePath)) {
                    using var sha = SHA256.Create();
                    using var fs = File.OpenRead(exePath);
                    playerArtifacts["executable"] = exePath;
                    playerArtifacts["bytes"] = fs.Length;
                    playerArtifacts["sha256"] = BitConverter.ToString(sha.ComputeHash(fs)).Replace("-", "").ToLowerInvariant();
                }
            } catch { /* optional provenance */ }
            report["playerArtifacts"] = playerArtifacts;

            report["environment"] = new JObject {
                ["os"] = SystemInfo.operatingSystem,
                ["cpu"] = SystemInfo.processorType,
                ["cpuLogicalCores"] = SystemInfo.processorCount,
                ["ramMb"] = SystemInfo.systemMemorySize,
                ["gpu"] = SystemInfo.graphicsDeviceName,
                ["gpuVendor"] = SystemInfo.graphicsDeviceVendor,
                ["gpuApi"] = SystemInfo.graphicsDeviceType.ToString(),
                ["vramMb"] = SystemInfo.graphicsMemorySize,
                ["screenWidth"] = Screen.width,
                ["screenHeight"] = Screen.height,
                ["uiSurfaceWidth"] = StationDesktopUiPresenter.Active.TextureWidth,
                ["uiSurfaceHeight"] = StationDesktopUiPresenter.Active.TextureHeight,
                ["qualityLevel"] = QualitySettings.names[QualitySettings.GetQualityLevel()],
                ["renderPipeline"] = GraphicsSettings.currentRenderPipeline != null ? GraphicsSettings.currentRenderPipeline.name : "BuiltIn",
                ["vSyncCount"] = QualitySettings.vSyncCount,
                ["targetFrameRate"] = Application.targetFrameRate,
            };

            StationEditProfileCommandHandler.SetActive(true);
            StationEditProfileCommandHandler.DrainSamplesJson(clear: true);

            var demoReports = new JArray();
            report["demos"] = demoReports;

            foreach (var demoId in targetDemos) {
                var demoJson = new JObject { ["demo"] = demoId };
                demoReports.Add(demoJson);
                yield return RunDemoMatrixCoroutine(host, demoId, demoJson);
            }

            StationEditProfileCommandHandler.SetActive(false);
            if (StationDesktopUiPresenter.Active != null) {
                StationDesktopUiPresenter.Active.SuppressPhysicalInput = false;
            }
        }

        static string HostCmd(StationGameHost host, string type, JObject payload = null) {
            var env = new JObject {
                ["schemaVersion"] = 2,
                ["id"] = "bench-" + Guid.NewGuid().ToString("N").Substring(0, 8),
                ["sessionId"] = host.ClientSessionId,
                ["type"] = type,
                ["payload"] = payload ?? new JObject(),
            };
            return host.SendForTest(env.ToString(Formatting.None));
        }

        static JObject ProbeCoord(StationGameHost host, StationCellKey cell, bool focus = true, float distance = 26f, bool solidCenter = false, bool exactCell = false) {
            var raw = HostCmd(host, "edit.probe", new JObject {
                ["kind"] = "coord",
                ["cell"] = new JArray(cell.X, cell.Y, cell.Z),
                ["focus"] = focus,
                ["distance"] = distance,
                ["solidCenter"] = solidCenter,
                ["exactCell"] = exactCell,
            });
            var reply = JObject.Parse(raw);
            return reply["payload"]?["probe"] as JObject;
        }

        static void SetToolAndLevel(StationGameHost host, int level, string tool, JObject settings = null, bool cutaway = false) {
            HostCmd(host, "view.set", new JObject { ["key"] = "cutaway", ["value"] = cutaway });
            HostCmd(host, "view.set", new JObject { ["key"] = "showLevels", ["value"] = false });
            HostCmd(host, "view.set", new JObject { ["key"] = "level", ["value"] = level });
            HostCmd(host, "tool.set", new JObject {
                ["tool"] = tool,
                ["settings"] = settings ?? new JObject { ["autoWalls"] = true },
            });
            host.PublishStateNow();
        }

        static StationCellKey FindFreeInteriorCandidate(StationGameHost host, int targetZ, Func<StationCellKey, bool> extraPred = null, HashSet<StationCellKey> used = null) {
            SetToolAndLevel(host, targetZ, "block", new JObject { ["autoWalls"] = true });
            var cellWorld = StationCellTool.World(host);
            var b = host.Index.Bounds;
            // Search outward from station center on targetZ for an empty cell adjacent to an existing solid floor cell
            // that resolves cleanly through the live 3D scene picker (`fallbackProjection == null`):
            int midX = (b.MinX + b.MaxX) / 2;
            int midY = (b.MinY + b.MaxY) / 2;
            for (int r = 1; r <= 90; r++) {
                for (int dx = -r; dx <= r; dx++) {
                    for (int dy = -r; dy <= r; dy++) {
                        if (Math.Max(Math.Abs(dx), Math.Abs(dy)) != r) continue;
                        var k = new StationCellKey(midX + dx, midY + dy, targetZ);
                        if (used != null && used.Contains(k)) continue;
                        if (extraPred != null && !extraPred(k)) continue;
                        if (host.Index.GetCell(k) != null) continue;
                        bool adjSolid =
                            (host.Index.GetCell(k.X + 1, k.Y, targetZ)?.IsSolid ?? false) ||
                            (host.Index.GetCell(k.X - 1, k.Y, targetZ)?.IsSolid ?? false) ||
                            (host.Index.GetCell(k.X, k.Y + 1, targetZ)?.IsSolid ?? false) ||
                            (host.Index.GetCell(k.X, k.Y - 1, targetZ)?.IsSolid ?? false);
                        if (!adjSolid && r < 45) continue;
                        bool occludedAbove = false;
                        for (int zUp = targetZ + 1; zUp <= targetZ + 4; zUp++) {
                            if (host.Index.GetCell(k.X, k.Y, zUp)?.IsSolid ?? false) { occludedAbove = true; break; }
                        }
                        if (occludedAbove) continue;
                        var chk = StationCellPlanner.CheckBlockCells(cellWorld, new[] { k });
                        if (chk.Accepted.Count != 1 || chk.Blocked.Count != 0) continue;
                        var p = ProbeCoord(host, k, focus: true, distance: 26f);
                        if (p != null && p["fallbackProjection"] == null) {
                            used?.Add(k);
                            return k;
                        }
                    }
                }
            }
            // Fallback exterior cell at targetZ:
            for (int off = 4; off <= 40; off++) {
                var k = new StationCellKey(b.MaxX + off, midY, targetZ);
                if (used != null && used.Contains(k)) continue;
                if (extraPred != null && !extraPred(k)) continue;
                var chk = StationCellPlanner.CheckBlockCells(cellWorld, new[] { k });
                if (chk.Accepted.Count != 1 || chk.Blocked.Count != 0) continue;
                var p = ProbeCoord(host, k, focus: true, distance: 26f);
                if (p != null && p["fallbackProjection"] == null) {
                    used?.Add(k);
                    return k;
                }
            }
            var fallback = new StationCellKey(b.MaxX + 6, midY, targetZ);
            used?.Add(fallback);
            return fallback;
        }

        static List<StationCellKey> FindGradeCandidates(StationGameHost host, int maxCount = 4) {
            SetToolAndLevel(host, 0, "block", new JObject { ["autoWalls"] = false }, cutaway: false);
            var list = new List<StationCellKey>(maxCount);
            var cellWorld = StationCellTool.World(host);
            int probeTries = 0;
            // First pass: bare z = 0 solid cells with no module cascade; second pass: allow surface/street cascade if needed:
            foreach (bool allowCascade in new[] { false, true }) {
                foreach (var c in host.Document.Cells) {
                    if (list.Count >= maxCount || probeTries >= 32) break;
                    if (c.Z != 0 || !c.IsSolid) continue;
                    if (list.Contains(c.Key)) continue;
                    bool occluded = false;
                    for (int zUp = 1; zUp <= 4; zUp++) {
                        if (host.Index.GetCell(c.X, c.Y, zUp)?.IsSolid ?? false) { occluded = true; break; }
                    }
                    if (occluded) continue;
                    var patch = StationCellPlanner.PlanRemoveCells(cellWorld, new[] { c.Key });
                    if (patch.HasWork && (allowCascade || patch.RemoveModuleIds.Count == 0)) {
                        probeTries++;
                        var p = ProbeCoord(host, c.Key, focus: true, distance: 26f, solidCenter: true, exactCell: true);
                        if (p != null && p["fallbackProjection"] == null) {
                            list.Add(c.Key);
                        }
                    }
                }
                if (list.Count >= maxCount || probeTries >= 32) break;
            }
            return list;
        }

        static StationCellKey? FindEquipmentSupportedFloorCell(StationGameHost host, out int levelZ) {
            var cellWorld = StationCellTool.World(host);
            int probeTries = 0;
            foreach (var mod in host.Document.Modules) {
                if (probeTries >= 32) break;
                if (mod.Type != "bench" && mod.Type != "tvm" && mod.Type != "vending" && mod.Type != "fence" && mod.Type != "tree" && mod.Type != "trash" && mod.Type != "bin")
                    continue;
                int fz = mod.Z;
                var floorCell = host.Index.GetCell(mod.X, mod.Y, fz);
                if (floorCell == null || !floorCell.IsSolid) continue;
                bool occluded = false;
                for (int zUp = fz + 1; zUp <= fz + 4; zUp++) {
                    if (host.Index.GetCell(mod.X, mod.Y, zUp)?.IsSolid ?? false) { occluded = true; break; }
                }
                if (occluded) continue;
                var patch = StationCellPlanner.PlanRemoveCells(cellWorld, new[] { floorCell.Key });
                if (patch.HasWork && patch.RemoveModuleIds.Count > 0) {
                    probeTries++;
                    SetToolAndLevel(host, fz, "block", new JObject { ["autoWalls"] = true });
                    var p = ProbeCoord(host, floorCell.Key, focus: true, distance: 24f, solidCenter: true, exactCell: true);
                    if (p != null && p["fallbackProjection"] == null) {
                        levelZ = fz;
                        return floorCell.Key;
                    }
                }
            }
            levelZ = -5;
            return null;
        }

        IEnumerator ClickPointerAndWaitCommit(
            StationGameHost host,
            double u,
            double v,
            string button,
            int buttonBit,
            string opLabel,
            JArray recordsOut,
            bool deliberateAutoFloor = false) {
            var ui = StationDesktopUiPresenter.Active;
            double sw = Math.Max(1, ui.TextureWidth > 0 ? ui.TextureWidth : Screen.width);
            double sh = Math.Max(1, ui.TextureHeight > 0 ? ui.TextureHeight : Screen.height);
            double px = u * sw;
            double py = v * sh;

            StationEditProfileCommandHandler.DrainSamplesJson(clear: true);
            int revBefore = host.CurrentRevision;

            if (deliberateAutoFloor) {
                // Hold >= 160ms + > 4px sub-cell nudge so StationCellTool triggers PlanAutoFloor (AppendAutoWallSync) on 1 cell:
                ui.SendSyntheticMouse("move", px - 3.0, py, "none", 0, 0, 0);
                yield return new WaitForSecondsRealtime(0.020f);
                ui.SendSyntheticMouse("down", px - 3.0, py, button, buttonBit, 0, 1);
                yield return new WaitForSecondsRealtime(0.165f);
                ui.SendSyntheticMouse("move", px + 3.0, py, "none", buttonBit, 0, 0);
                yield return new WaitForSecondsRealtime(0.025f);
                long releaseTick = Stopwatch.GetTimestamp();
                ui.SendSyntheticMouse("up", px + 3.0, py, button, 0, 0, 1);
                yield return CollectCommitRecord(host, revBefore, releaseTick, opLabel, recordsOut);
                yield break;
            }

            // Hover -> Press -> Release at realistic human / 60 Hz frame spacing (avoiding 1.2 ms/frame pileup at vSyncCount=0):
            ui.SendSyntheticMouse("move", px, py, "none", 0, 0, 0);
            yield return new WaitForSecondsRealtime(0.025f);

            ui.SendSyntheticMouse("down", px, py, button, buttonBit, 0, 1);
            yield return new WaitForSecondsRealtime(0.045f);

            long clickReleaseTick = Stopwatch.GetTimestamp();
            ui.SendSyntheticMouse("up", px, py, button, 0, 0, 1);

            yield return CollectCommitRecord(host, revBefore, clickReleaseTick, opLabel, recordsOut);
        }

        IEnumerator DragPointerAndWaitCommit(
            StationGameHost host,
            double u0, double v0,
            double u1, double v1,
            string button,
            int buttonBit,
            string opLabel,
            JArray recordsOut) {
            var ui = StationDesktopUiPresenter.Active;
            double sw = Math.Max(1, ui.TextureWidth > 0 ? ui.TextureWidth : Screen.width);
            double sh = Math.Max(1, ui.TextureHeight > 0 ? ui.TextureHeight : Screen.height);
            double x0 = u0 * sw, y0 = v0 * sh;
            double x1 = u1 * sw, y1 = v1 * sh;

            StationEditProfileCommandHandler.DrainSamplesJson(clear: true);
            int revBefore = host.CurrentRevision;

            ui.SendSyntheticMouse("move", x0, y0, "none", 0, 0, 0);
            yield return null;
            yield return null;

            ui.SendSyntheticMouse("down", x0, y0, button, buttonBit, 0, 1);
            yield return new WaitForSecondsRealtime(0.185f);

            const int steps = 4;
            for (int s = 1; s <= steps; s++) {
                double t = (double)s / steps;
                ui.SendSyntheticMouse("move", x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, "none", buttonBit, 0, 0);
                yield return new WaitForSecondsRealtime(0.020f);
            }

            long releaseTick = Stopwatch.GetTimestamp();
            ui.SendSyntheticMouse("up", x1, y1, button, 0, 0, 1);

            yield return CollectCommitRecord(host, revBefore, releaseTick, opLabel, recordsOut);
        }

        IEnumerator SendCtrlShortcutAndWaitCommit(
            StationGameHost host,
            int vk,
            string domKey,
            string domCode,
            string opLabel,
            JArray recordsOut) {
            var ui = StationDesktopUiPresenter.Active;
            StationEditProfileCommandHandler.DrainSamplesJson(clear: true);
            int revBefore = host.CurrentRevision;

            const int ctrlMod = 2; // Ctrl modifier bit in MetroEditorWebView
            long releaseTick = Stopwatch.GetTimestamp();
            StationEditProfiling.NoteNativePointerRelease(releaseTick);
            ui.SendSyntheticKey("down", 0x11, "Control", "ControlLeft", ctrlMod);
            ui.SendSyntheticKey("down", vk, domKey, domCode, ctrlMod);
            ui.SendSyntheticKey("up", vk, domKey, domCode, ctrlMod);
            ui.SendSyntheticKey("up", 0x11, "Control", "ControlLeft", 0);

            yield return CollectCommitRecord(host, revBefore, releaseTick, opLabel, recordsOut);
        }

        IEnumerator CollectCommitRecord(
            StationGameHost host,
            int revBefore,
            long releaseTick,
            string opLabel,
            JArray recordsOut) {
            float waited = 0f;
            bool committed = false;
            double wallCommitMs = -1;
            double wallPresentMs = -1;

            while (waited < 5.0f) {
                if (!committed && host.CurrentRevision > revBefore) {
                    committed = true;
                    wallCommitMs = (Stopwatch.GetTimestamp() - releaseTick) * 1000.0 / Stopwatch.Frequency;
                    // Wait for EndOfFrame of this committed frame:
                    yield return new WaitForEndOfFrame();
                    wallPresentMs = (Stopwatch.GetTimestamp() - releaseTick) * 1000.0 / Stopwatch.Frequency;
                    break;
                }
                waited += Time.unscaledDeltaTime;
                yield return null;
            }

            // Allow one extra frame + 30ms settle so StationGameHost's coroutine flushes `first-frame-presented`
            // and WebView2 finishes adopting the delta before the next gesture starts:
            yield return null;
            yield return new WaitForSecondsRealtime(0.030f);
            var samples = StationEditProfileCommandHandler.DrainSamplesJson(clear: true);

            if (!committed) {
                recordsOut.Add(new JObject {
                    ["op"] = opLabel,
                    ["committed"] = false,
                    ["revisionBefore"] = revBefore,
                    ["revisionAfter"] = host.CurrentRevision,
                    ["notice"] = StationEditSession.Notice?.DeepClone() ?? JValue.CreateNull(),
                });
                yield break;
            }

            JObject authSample = null;
            JObject presentSample = null;
            foreach (JObject s in samples) {
                string st = (string)s["stage"];
                if (st == "authoritative-commit") authSample = s;
                else if (st == "first-frame-presented") presentSample = s;
            }

            double releaseToCommitMs = authSample?["dispatchToStageMs"] != null && authSample["dispatchToStageMs"].Type != JTokenType.Null
                ? (double)authSample["dispatchToStageMs"]
                : wallCommitMs;
            double releaseToFirstFrameMs = presentSample?["dispatchToStageMs"] != null && presentSample["dispatchToStageMs"].Type != JTokenType.Null
                ? (double)presentSample["dispatchToStageMs"]
                : wallPresentMs;

            recordsOut.Add(new JObject {
                ["op"] = opLabel,
                ["committed"] = true,
                ["revision"] = host.CurrentRevision,
                ["releaseToCommitMs"] = Math.Round(releaseToCommitMs, 3),
                ["releaseToFirstFrameMs"] = Math.Round(releaseToFirstFrameMs, 3),
                ["hostCommandToCommitMs"] = authSample != null ? authSample["ms"] : JValue.CreateNull(),
                ["hostCommandToPresentMs"] = presentSample != null ? presentSample["ms"] : JValue.CreateNull(),
                ["allocatedBytes"] = authSample != null ? authSample["allocatedBytes"] : 0,
                ["metrics"] = authSample?["metrics"]?.DeepClone() ?? JValue.CreateNull(),
                ["stages"] = authSample?["stages"]?.DeepClone() ?? JValue.CreateNull(),
            });
        }

        static JObject SummarizeRecords(JArray records) {
            var commitVals = new List<double>();
            var frameVals = new List<double>();
            var allocVals = new List<long>();
            int misses = 0;
            int fallbacks = 0;

            foreach (JObject r in records) {
                if (!(bool)(r["committed"] ?? false)) {
                    misses++;
                    continue;
                }
                commitVals.Add((double)r["releaseToCommitMs"]);
                frameVals.Add((double)r["releaseToFirstFrameMs"]);
                allocVals.Add((long)(r["allocatedBytes"] ?? 0));
                var m = r["metrics"] as JObject;
                if (m != null) {
                    bool okLocal = (bool)(m["usedLocalDocument"] ?? false) &&
                                   (bool)(m["usedRetainedView"] ?? false) &&
                                   (bool)(m["usedIncrementalGraph"] ?? false) &&
                                   (bool)(m["usedDeltaPayload"] ?? false);
                    if (!okLocal) fallbacks++;
                }
            }

            static JObject Dist(List<double> raw) {
                if (raw.Count == 0) return new JObject { ["count"] = 0 };
                double first = raw[0];
                var sorted = new List<double>(raw);
                sorted.Sort();
                int p50 = sorted.Count / 2;
                int p95 = Math.Min(sorted.Count - 1, (int)Math.Ceiling(sorted.Count * 0.95) - 1);
                return new JObject {
                    ["count"] = sorted.Count,
                    ["first"] = Math.Round(first, 3),
                    ["median"] = Math.Round(sorted[p50], 3),
                    ["p95"] = Math.Round(sorted[Math.Max(0, p95)], 3),
                    ["max"] = Math.Round(sorted[sorted.Count - 1], 3),
                };
            }

            long maxAlloc = allocVals.Count > 0 ? allocVals.Max() : 0;
            long medianAlloc = 0;
            if (allocVals.Count > 0) {
                var sa = new List<long>(allocVals);
                sa.Sort();
                medianAlloc = sa[sa.Count / 2];
            }

            return new JObject {
                ["samples"] = commitVals.Count,
                ["misses"] = misses,
                ["fallbacks"] = fallbacks,
                ["releaseToCommitMs"] = Dist(commitVals),
                ["releaseToFirstFrameMs"] = Dist(frameVals),
                ["medianAllocatedBytes"] = medianAlloc,
                ["maxAllocatedBytes"] = maxAlloc,
            };
        }

        IEnumerator RunDemoMatrixCoroutine(StationGameHost host, string demoId, JObject demoOut) {
            int revBeforeOpen = host.CurrentRevision;
            var openEnv = new JObject {
                ["schemaVersion"] = 2,
                ["id"] = "bench-open-" + demoId,
                ["sessionId"] = host.ClientSessionId,
                ["type"] = "station.openDemo",
                ["payload"] = new JObject { ["id"] = demoId },
            };
            // Dispatch through BrowserCommand (not SendForTest) so MetroEditorWebView receives and adopts
            // the station commit before Scenario 1's first edit publishes a delta:
            host.BrowserCommand(openEnv.ToString(Formatting.None));
            int openRev = host.CurrentRevision;
            if (openRev <= revBeforeOpen) {
                throw new InvalidOperationException($"station.openDemo failed for '{demoId}' (revision remained {host.CurrentRevision}).");
            }

            // Ensure block tool is active so canvas forwards pointer moves with client's adopted documentRevision:
            HostCmd(host, "tool.set", new JObject {
                ["tool"] = "block",
                ["settings"] = new JObject { ["autoWalls"] = true },
            });
            host.PublishStateNow();

            // Wait via real round-trip pointer pings until MetroEditorWebView has parsed & adopted openRev
            // AND cold-open PSD/exit textures have settled:
            var ui = StationDesktopUiPresenter.Active;
            double midX = Math.Max(1, ui.TextureWidth > 0 ? ui.TextureWidth : Screen.width) * 0.5;
            double midY = Math.Max(1, ui.TextureHeight > 0 ? ui.TextureHeight : Screen.height) * 0.5;
            float minSettle = demoId == "tianhe" ? 3.0f : 1.2f;
            float maxSettle = demoId == "tianhe" ? 40.0f : 12.0f;
            float settleElapsed = 0f;
            float nextPingAt = 0.1f;
            int pingToggle = 0;
            while (settleElapsed < maxSettle) {
                settleElapsed += Time.unscaledDeltaTime;
                if (settleElapsed >= nextPingAt) {
                    pingToggle ^= 1;
                    ui.SendSyntheticMouse("move", midX + pingToggle * 2.0, midY, "none", 0, 0, 0);
                    nextPingAt = settleElapsed + 0.25f;
                }
                yield return null;
                if (settleElapsed >= minSettle && StationPointerEvent.LastClientDocumentRevision >= openRev) {
                    var st = host.BuildStatePayload();
                    int psdPending = (int?)st["psd"]?["headers"]?["pending"] ?? 0;
                    int exitPending = (int?)st["exit"]?["faces"]?["pending"] ?? 0;
                    if (psdPending == 0 && exitPending == 0) break;
                }
            }
            // Extra settle after client adoption so post-adopt React effects finish before camera framing:
            yield return new WaitForSecondsRealtime(0.50f);
            host.PublishStateNow();
            for (int f = 0; f < 15; f++) yield return null;
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
            StationEditProfileCommandHandler.DrainSamplesJson(clear: true);
            for (int f = 0; f < 5; f++) yield return null;

            string initialHash = host.CurrentSourceHash;
            demoOut["sourceHash"] = initialHash;
            demoOut["initialCells"] = host.Document.Cells.Count;
            demoOut["initialModules"] = host.Document.Modules.Count;
            demoOut["initialGraphNodes"] = ((StationSimulationHost)host.Simulation).Session?.WalkGraph?.NodeCount ?? 0;

            int concourseZ = host.Index.Levels.Contains(-5) ? -5
                : (host.Index.Levels.Contains(-10) ? -10 : host.Document.OpeningLevel);
            demoOut["editLevel"] = concourseZ;

            // Pre-discover target coordinates before starting interactive frame-tail measurement so synchronous
            // probe searches do not pollute interactive frame-time statistics:
            var usedCells = new HashSet<StationCellKey>();
            var s1Target = FindFreeInteriorCandidate(host, concourseZ, null, usedCells);
            var s2Target = FindFreeInteriorCandidate(host, concourseZ, null, usedCells);
            var s3Target = FindFreeInteriorCandidate(host, concourseZ, null, usedCells);
            var gradeCells = FindGradeCandidates(host, 4);
            var seamCell = FindFreeInteriorCandidate(host, concourseZ, k => ((k.X & 15) == 15 || (k.X & 15) == 0) && ((k.Y & 15) == 15 || (k.Y & 15) == 0), usedCells);
            var eqFloor = FindEquipmentSupportedFloorCell(host, out int eqZ);
            var s7Target = FindFreeInteriorCandidate(host, concourseZ, null, usedCells);
            for (int f = 0; f < 5; f++) yield return null;

            var scenarios = new JObject();
            demoOut["scenarios"] = scenarios;
            var allOrdinaryRecords = new JArray();

            recentFrameMs.Clear();
            measuringFrames = true;

            // 1. Ordinary block place/delete + Undo/Redo (AutoWalls ON, Paused) — First-use + 4 repeats
            {
                HostCmd(host, "sim.play", new JObject { ["playing"] = false });
                var target = s1Target;
                SetToolAndLevel(host, concourseZ, "block", new JObject { ["autoWalls"] = true });
                for (int f = 0; f < 8; f++) yield return null;

                var p = ProbeCoord(host, target, focus: true, distance: 26f);
                for (int f = 0; f < 8; f++) yield return null;
                double u = (double)p["u"], v = (double)p["v"];

                var recs = new JArray();
                JObject pDelCached = null;
                for (int rep = 0; rep < 5; rep++) {
                    string tag = rep == 0 ? "first" : ("repeat-" + rep);
                    yield return ClickPointerAndWaitCommit(host, u, v, "left", 1, "place-autowall-on-" + tag, recs, deliberateAutoFloor: true);
                    pDelCached ??= ProbeCoord(host, target, focus: false, distance: 26f, solidCenter: true, exactCell: true) ?? p;
                    yield return ClickPointerAndWaitCommit(host, (double)pDelCached["u"], (double)pDelCached["v"], "right", 2, "delete-autowall-on-" + tag, recs);
                }
                // Place once, then real Ctrl+Z undo + real Ctrl+Y redo + right-click cleanup:
                yield return ClickPointerAndWaitCommit(host, u, v, "left", 1, "place-before-undo", recs, deliberateAutoFloor: true);
                yield return SendCtrlShortcutAndWaitCommit(host, 0x5A, "z", "KeyZ", "undo-ctrl-z", recs);
                yield return SendCtrlShortcutAndWaitCommit(host, 0x59, "y", "KeyY", "redo-ctrl-y", recs);
                yield return ClickPointerAndWaitCommit(host, (double)pDelCached["u"], (double)pDelCached["v"], "right", 2, "delete-after-redo", recs);

                foreach (var r in recs) allOrdinaryRecords.Add(r);
                scenarios["ordinaryAutoWallsOnPaused"] = new JObject {
                    ["cell"] = new JArray(target.X, target.Y, target.Z),
                    ["summary"] = SummarizeRecords(recs),
                    ["records"] = recs,
                };
            }

            // 2. Ordinary block place/delete (AutoWalls OFF, Paused) — First + 3 repeats
            {
                var target = s2Target;
                SetToolAndLevel(host, concourseZ, "block", new JObject { ["autoWalls"] = false });
                for (int f = 0; f < 8; f++) yield return null;
                var p = ProbeCoord(host, target, focus: true, distance: 26f);
                for (int f = 0; f < 6; f++) yield return null;
                double u = (double)p["u"], v = (double)p["v"];

                var recs = new JArray();
                JObject pDelCached = null;
                for (int rep = 0; rep < 4; rep++) {
                    string tag = rep == 0 ? "first" : ("repeat-" + rep);
                    yield return ClickPointerAndWaitCommit(host, u, v, "left", 1, "place-autowall-off-" + tag, recs);
                    pDelCached ??= ProbeCoord(host, target, focus: false, distance: 26f, solidCenter: true, exactCell: true) ?? p;
                    yield return ClickPointerAndWaitCommit(host, (double)pDelCached["u"], (double)pDelCached["v"], "right", 2, "delete-autowall-off-" + tag, recs);
                }
                foreach (var r in recs) allOrdinaryRecords.Add(r);
                scenarios["ordinaryAutoWallsOffPaused"] = new JObject {
                    ["cell"] = new JArray(target.X, target.Y, target.Z),
                    ["summary"] = SummarizeRecords(recs),
                    ["records"] = recs,
                };
            }

            // 3. Cut block (halfWall = true) place & delete — First + 3 repeats
            {
                var target = s3Target;
                SetToolAndLevel(host, concourseZ, "block", new JObject { ["autoWalls"] = false, ["halfWall"] = true, ["wallSnapCycle"] = 0 });
                for (int f = 0; f < 8; f++) yield return null;
                var p = ProbeCoord(host, target, focus: true, distance: 26f);
                for (int f = 0; f < 6; f++) yield return null;
                double u = (double)p["u"], v = (double)p["v"];

                var recs = new JArray();
                JObject pDelCached = null;
                for (int rep = 0; rep < 4; rep++) {
                    string tag = rep == 0 ? "first" : ("repeat-" + rep);
                    yield return ClickPointerAndWaitCommit(host, u, v, "left", 1, "cut-place-" + tag, recs);
                    pDelCached ??= ProbeCoord(host, target, focus: false, distance: 26f, solidCenter: true, exactCell: true) ?? p;
                    yield return ClickPointerAndWaitCommit(host, (double)pDelCached["u"], (double)pDelCached["v"], "right", 2, "cut-delete-" + tag, recs);
                }
                foreach (var r in recs) allOrdinaryRecords.Add(r);
                scenarios["cutBlockPaused"] = new JObject {
                    ["cell"] = new JArray(target.X, target.Y, target.Z),
                    ["summary"] = SummarizeRecords(recs),
                    ["records"] = recs,
                };
            }

            // 4. Grade / void street dig & fill (z = 0) — First + repeats across authored z = 0 solid cells
            {
                SetToolAndLevel(host, 0, "block", new JObject { ["autoWalls"] = false }, cutaway: false);
                for (int f = 0; f < 8; f++) yield return null;

                var recs = new JArray();
                for (int rep = 0; rep < gradeCells.Count; rep++) {
                    var gradeCell = gradeCells[rep];
                    string tag = rep == 0 ? "first" : ("repeat-" + rep);
                    bool hadCascade = StationCellPlanner.PlanRemoveCells(StationCellTool.World(host), new[] { gradeCell }).RemoveModuleIds.Count > 0;
                    var pDig = ProbeCoord(host, gradeCell, focus: true, distance: 26f, solidCenter: true, exactCell: true);
                    for (int f = 0; f < 4; f++) yield return null;
                    yield return ClickPointerAndWaitCommit(host, (double)pDig["u"], (double)pDig["v"], "right", 2, "grade-dig-" + tag, recs);
                    var pFill = !hadCascade ? ProbeCoord(host, gradeCell, focus: false, distance: 26f) : null;
                    bool canFillDirectly = !hadCascade &&
                        pFill != null &&
                        pFill["fallbackProjection"] == null &&
                        StationCellPlanner.CheckBlockCells(StationCellTool.World(host), new[] { gradeCell }).Accepted.Count == 1;
                    if (canFillDirectly) {
                        yield return ClickPointerAndWaitCommit(host, (double)pFill["u"], (double)pFill["v"], "left", 1, "grade-fill-" + tag, recs);
                    } else {
                        yield return SendCtrlShortcutAndWaitCommit(host, 0x5A, "z", "KeyZ", "grade-restore-undo-" + tag, recs);
                    }
                }
                foreach (var r in recs) allOrdinaryRecords.Add(r);
                scenarios["gradeVoidPaused"] = new JObject {
                    ["cellsCount"] = gradeCells.Count,
                    ["summary"] = SummarizeRecords(recs),
                    ["records"] = recs,
                };
            }

            // 5. 16 m Chunk Boundary block place & delete (AutoWalls ON)
            {
                SetToolAndLevel(host, concourseZ, "block", new JObject { ["autoWalls"] = true });
                for (int f = 0; f < 8; f++) yield return null;
                var p = ProbeCoord(host, seamCell, focus: true, distance: 26f);
                for (int f = 0; f < 6; f++) yield return null;
                double u = (double)p["u"], v = (double)p["v"];

                var recs = new JArray();
                JObject pDelCached = null;
                for (int rep = 0; rep < 3; rep++) {
                    yield return ClickPointerAndWaitCommit(host, u, v, "left", 1, "seam-place-" + rep, recs, deliberateAutoFloor: true);
                    pDelCached ??= ProbeCoord(host, seamCell, focus: false, distance: 26f, solidCenter: true, exactCell: true) ?? p;
                    yield return ClickPointerAndWaitCommit(host, (double)pDelCached["u"], (double)pDelCached["v"], "right", 2, "seam-delete-" + rep, recs);
                }
                foreach (var r in recs) allOrdinaryRecords.Add(r);
                scenarios["chunkBoundaryPaused"] = new JObject {
                    ["cell"] = new JArray(seamCell.X, seamCell.Y, seamCell.Z),
                    ["summary"] = SummarizeRecords(recs),
                    ["records"] = recs,
                };
            }

            // 6. Near-ramp / equipment cascade delete + Ctrl+Z restore
            {
                if (eqFloor.HasValue) {
                    SetToolAndLevel(host, eqZ, "block", new JObject { ["autoWalls"] = true });
                    for (int f = 0; f < 8; f++) yield return null;
                    var p = ProbeCoord(host, eqFloor.Value, focus: true, distance: 24f, solidCenter: true, exactCell: true);
                    for (int f = 0; f < 6; f++) yield return null;
                    double u = (double)p["u"], v = (double)p["v"];

                    var recs = new JArray();
                    for (int rep = 0; rep < 3; rep++) {
                        yield return ClickPointerAndWaitCommit(host, u, v, "right", 2, "equipment-cascade-delete-" + rep, recs);
                        yield return SendCtrlShortcutAndWaitCommit(host, 0x5A, "z", "KeyZ", "equipment-cascade-undo-" + rep, recs);
                    }
                    foreach (var r in recs) allOrdinaryRecords.Add(r);
                    scenarios["nearEquipmentCascadePaused"] = new JObject {
                        ["cell"] = new JArray(eqFloor.Value.X, eqFloor.Value.Y, eqFloor.Value.Z),
                        ["summary"] = SummarizeRecords(recs),
                        ["records"] = recs,
                    };
                }
            }

            // 7. Running simulation (active crowd + trains) + prolonged 20-op alternating add/delete sequence + Undo/Redo!
            {
                HostCmd(host, "sim.seek", new JObject { ["simTimeSeconds"] = 4 * 86400 + 28800 }); // Monday 08:00 AM peak
                HostCmd(host, "sim.speed", new JObject { ["speed"] = 4 });
                HostCmd(host, "sim.play", new JObject { ["playing"] = true });
                // Advance 35 simulated seconds so active crowd & trains are moving while we edit:
                host.Coordinator.Tick(35.0);
                HostCmd(host, "sim.speed", new JObject { ["speed"] = 1 });
                for (int f = 0; f < 10; f++) yield return null;

                int activePax = ((StationSimulationHost)host.Simulation).Session?.PassengerFrames()?.Length ?? 0;
                var target = s7Target;
                SetToolAndLevel(host, concourseZ, "block", new JObject { ["autoWalls"] = true });
                for (int f = 0; f < 8; f++) yield return null;
                var p = ProbeCoord(host, target, focus: true, distance: 26f);
                for (int f = 0; f < 6; f++) yield return null;
                double u = (double)p["u"], v = (double)p["v"];

                var recs = new JArray();
                JObject pDelCached = null;
                for (int i = 0; i < 10; i++) {
                    yield return ClickPointerAndWaitCommit(host, u, v, "left", 1, "running-seq-place-" + i, recs, deliberateAutoFloor: true);
                    pDelCached ??= ProbeCoord(host, target, focus: false, distance: 26f, solidCenter: true, exactCell: true) ?? p;
                    yield return ClickPointerAndWaitCommit(host, (double)pDelCached["u"], (double)pDelCached["v"], "right", 2, "running-seq-delete-" + i, recs);
                }
                yield return ClickPointerAndWaitCommit(host, u, v, "left", 1, "running-place-undo", recs, deliberateAutoFloor: true);
                yield return SendCtrlShortcutAndWaitCommit(host, 0x5A, "z", "KeyZ", "running-undo", recs);
                yield return SendCtrlShortcutAndWaitCommit(host, 0x59, "y", "KeyY", "running-redo", recs);
                yield return ClickPointerAndWaitCommit(host, (double)pDelCached["u"], (double)pDelCached["v"], "right", 2, "running-cleanup", recs);

                foreach (var r in recs) allOrdinaryRecords.Add(r);
                scenarios["runningProlongedAlternatingSequence"] = new JObject {
                    ["activePassengersStart"] = activePax,
                    ["activePassengersEnd"] = ((StationSimulationHost)host.Simulation).Session?.PassengerFrames()?.Length ?? 0,
                    ["cell"] = new JArray(target.X, target.Y, target.Z),
                    ["summary"] = SummarizeRecords(recs),
                    ["records"] = recs,
                };
                HostCmd(host, "sim.play", new JObject { ["playing"] = false });
            }

            // 8. Separate multi-cell drag bounds (4x3 = 12 cells, with & without auto-walls) — reported separately per Gate 4:
            {
                var b = host.Index.Bounds;
                var c0 = new StationCellKey(b.MaxX + 6, (b.MinY + b.MaxY) / 2 + 6, concourseZ);
                var c1 = new StationCellKey(c0.X + 3, c0.Y + 2, concourseZ);
                SetToolAndLevel(host, concourseZ, "block", new JObject { ["autoWalls"] = true });
                for (int f = 0; f < 8; f++) yield return null;
                var p0 = ProbeCoord(host, c0, focus: true, distance: 32f);
                var p1 = ProbeCoord(host, c1, focus: false, distance: 32f);
                for (int f = 0; f < 6; f++) yield return null;

                var dragRecs = new JArray();
                yield return DragPointerAndWaitCommit(host, (double)p0["u"], (double)p0["v"], (double)p1["u"], (double)p1["v"], "left", 1, "drag-4x3-autowall-place", dragRecs);
                yield return SendCtrlShortcutAndWaitCommit(host, 0x5A, "z", "KeyZ", "drag-4x3-autowall-undo", dragRecs);

                SetToolAndLevel(host, concourseZ, "block", new JObject { ["autoWalls"] = false });
                for (int f = 0; f < 6; f++) yield return null;
                yield return DragPointerAndWaitCommit(host, (double)p0["u"], (double)p0["v"], (double)p1["u"], (double)p1["v"], "left", 1, "drag-4x3-floor-place", dragRecs);
                var p0Del = ProbeCoord(host, c0, focus: true, distance: 32f, solidCenter: true, exactCell: true) ?? p0;
                var p1Del = ProbeCoord(host, c1, focus: false, distance: 32f, solidCenter: true, exactCell: true) ?? p1;
                for (int f = 0; f < 4; f++) yield return null;
                yield return DragPointerAndWaitCommit(host, (double)p0Del["u"], (double)p0Del["v"], (double)p1Del["u"], (double)p1Del["v"], "right", 2, "drag-4x3-floor-delete", dragRecs);

                scenarios["multiCellDrag4x3Bounds"] = new JObject {
                    ["footprint"] = "4x3 (12 floor cells + 18 auto-wall perimeter cells, and bare 12 floor cells)",
                    ["summary"] = SummarizeRecords(dragRecs),
                    ["records"] = dragRecs,
                };
            }

            measuringFrames = false;
            var sortedFrames = new List<float>(recentFrameMs);
            sortedFrames.Sort();
            float frameP50 = sortedFrames.Count > 0 ? sortedFrames[sortedFrames.Count / 2] : 0f;
            float frameP95 = sortedFrames.Count > 0 ? sortedFrames[Math.Min(sortedFrames.Count - 1, (int)(sortedFrames.Count * 0.95f))] : 0f;
            float frameMax = sortedFrames.Count > 0 ? sortedFrames[sortedFrames.Count - 1] : 0f;

            demoOut["ordinaryOverallSummary"] = SummarizeRecords(allOrdinaryRecords);
            demoOut["frameTailMs"] = new JObject {
                ["framesMeasured"] = sortedFrames.Count,
                ["median"] = Math.Round(frameP50, 3),
                ["p95"] = Math.Round(frameP95, 3),
                ["max"] = Math.Round(frameMax, 3),
            };
        }
    }
}
