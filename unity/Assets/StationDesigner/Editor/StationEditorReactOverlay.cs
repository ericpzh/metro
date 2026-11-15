using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using Metro.App;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Pipeline.Commands;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Metro.Editor {
    /// <summary>
    /// Editor integration and Windows <c>.exe</c> build packaging for
    /// <see cref="StationDesktopUiPresenter"/>.
    ///
    /// In Play Mode on <c>StationGame</c> or <c>StationGameLocal</c>, ensures
    /// <c>MetroEditorWebView.exe</c> and <c>game/dist-unity-ui</c> are built under
    /// <c>.preview/unity/editor-ui-host/</c> and wires <see cref="StationDesktopUiPresenter"/>
    /// so the shared React 19 UI renders directly inside Unity's <c>Game</c> viewport
    /// (<see cref="RenderMode.ScreenSpaceOverlay"/> <c>RawImage</c>) with zero floating
    /// desktop popup windows.
    ///
    /// On <see cref="BuildTarget.StandaloneWindows64"/> builds, stages the offscreen UI
    /// worker and web bundle into <c>&lt;Player&gt;_Data/StreamingAssets/MetroUi/</c>
    /// without touching WebGL builds or dirtying <c>Assets/</c>.
    /// </summary>
    [InitializeOnLoad]
    public sealed class StationEditorReactOverlay : IPostprocessBuildWithReport {
        const string PrefEnabled = "Metro.EditorReactOverlay.Enabled";
        const string PrefStartupRoute = "Metro.EditorReactOverlay.StartupRoute";
        const string MenuToggle = "Metro/Station Game/Show Full React UI in Play Mode";
        const string MenuPlayPublic = "Metro/Station Game/Play StationGame with Full UI";
        const string MenuPlayLocal = "Metro/Station Game/Play StationGameLocal (3D Crowd) with Full UI";

        static Type cachedGameViewType;
        static bool legacySliceNotifiedThisPlay;
        static bool ensuredBuildThisPlay;

        public int callbackOrder => 100;

        static StationEditorReactOverlay() {
            SyncRuntimePreferences();
            StationDesktopUiPresenter.PathResolver = ResolveEditorPaths;
            EditorApplication.playModeStateChanged += OnPlayModeStateChanged;
            EditorApplication.update += OnEditorUpdate;
            AssemblyReloadEvents.beforeAssemblyReload += StopActivePresenter;
            EditorApplication.quitting += StopActivePresenter;
        }

        public static bool Enabled {
            get => EditorPrefs.GetBool(PrefEnabled, true);
            set {
                EditorPrefs.SetBool(PrefEnabled, value);
                StationDesktopUiPresenter.UserEnabled = value;
            }
        }

        public static string StartupRoute {
            get => EditorPrefs.GetString(PrefStartupRoute, "/game/zoo");
            set {
                string normalized = string.IsNullOrWhiteSpace(value) ? "/game/zoo" : value;
                EditorPrefs.SetString(PrefStartupRoute, normalized);
                StationDesktopUiPresenter.StartupRoute = normalized;
            }
        }

        public static bool IsOverlayRunning =>
            StationDesktopUiPresenter.Active != null && StationDesktopUiPresenter.Active.IsWorkerRunning;

        public static bool IsOverlayWebReady =>
            StationDesktopUiPresenter.Active != null && StationDesktopUiPresenter.Active.IsWebReady;

        /// <summary>Allow automated 3D-only smoke captures to hide the in-canvas UI temporarily.</summary>
        public static bool SmokeSuppressed {
            get => StationDesktopUiPresenter.SmokeSuppressed;
            set => StationDesktopUiPresenter.SmokeSuppressed = value;
        }

        static void SyncRuntimePreferences() {
            StationDesktopUiPresenter.UserEnabled = Enabled;
            StationDesktopUiPresenter.StartupRoute = StartupRoute;
        }

        static void StopActivePresenter() {
            if (StationDesktopUiPresenter.Active != null) {
                StationDesktopUiPresenter.Active.StopWorker();
            }
        }

        static (string exePath, string uiDir, string publicDir, string logDir) ResolveEditorPaths() {
            string repoRoot = RepoRoot();
            string exePath = OverlayExePath(repoRoot);
            if (!ensuredBuildThisPlay) {
                ensuredBuildThisPlay = true;
                EnsureOverlayBuilt(repoRoot, exePath);
                EnsureUiBundleExists(repoRoot);
            }
            string uiDir = Path.Combine(repoRoot, "game", "dist-unity-ui");
            string publicDir = Path.Combine(repoRoot, "game", "public");
            string logDir = Path.Combine(repoRoot, ".preview", "unity", "editor-ui-host");
            return (exePath, uiDir, publicDir, logDir);
        }

        // ------------------------------------------------------------------ menu items

        [MenuItem(MenuToggle, priority = 10)]
        static void ToggleOverlayMenu() {
            Enabled = !Enabled;
        }

        [MenuItem(MenuToggle, true)]
        static bool ValidateToggleOverlayMenu() {
            Menu.SetChecked(MenuToggle, Enabled);
            return true;
        }

        [MenuItem(MenuPlayPublic, priority = 11)]
        public static void PlayStationGameWithUi() {
            Enabled = true;
            OpenSceneAndEnterPlayMode(StationGameScene.ScenePath, ensureLocalScene: false);
        }

        [MenuItem(MenuPlayLocal, priority = 12)]
        public static void PlayStationGameLocalWithUi() {
            Enabled = true;
            OpenSceneAndEnterPlayMode(StationLocalProfile.LocalScenePath, ensureLocalScene: true);
        }

        [MenuItem("Metro/Station Game/Startup Demo in Play Mode/Zoo (Default)", priority = 30)]
        static void SetRouteZoo() => StartupRoute = "/game/zoo";
        [MenuItem("Metro/Station Game/Startup Demo in Play Mode/Zoo (Default)", true)]
        static bool ValidateRouteZoo() { Menu.SetChecked("Metro/Station Game/Startup Demo in Play Mode/Zoo (Default)", StartupRoute == "/game/zoo"); return true; }

        [MenuItem("Metro/Station Game/Startup Demo in Play Mode/Zoo (English)", priority = 31)]
        static void SetRouteZooEn() => StartupRoute = "/game/en/zoo";
        [MenuItem("Metro/Station Game/Startup Demo in Play Mode/Zoo (English)", true)]
        static bool ValidateRouteZooEn() { Menu.SetChecked("Metro/Station Game/Startup Demo in Play Mode/Zoo (English)", StartupRoute == "/game/en/zoo"); return true; }

        [MenuItem("Metro/Station Game/Startup Demo in Play Mode/Tanwei", priority = 32)]
        static void SetRouteTanwei() => StartupRoute = "/game/tanwei";
        [MenuItem("Metro/Station Game/Startup Demo in Play Mode/Tanwei", true)]
        static bool ValidateRouteTanwei() { Menu.SetChecked("Metro/Station Game/Startup Demo in Play Mode/Tanwei", StartupRoute == "/game/tanwei"); return true; }

        [MenuItem("Metro/Station Game/Startup Demo in Play Mode/Tianhe Park", priority = 33)]
        static void SetRouteTianhe() => StartupRoute = "/game/tianhe";
        [MenuItem("Metro/Station Game/Startup Demo in Play Mode/Tianhe Park", true)]
        static bool ValidateRouteTianhe() { Menu.SetChecked("Metro/Station Game/Startup Demo in Play Mode/Tianhe Park", StartupRoute == "/game/tianhe"); return true; }

        [MenuItem("Metro/Station Game/Startup Demo in Play Mode/Empty Station", priority = 34)]
        static void SetRouteEmpty() => StartupRoute = "/game/";
        [MenuItem("Metro/Station Game/Startup Demo in Play Mode/Empty Station", true)]
        static bool ValidateRouteEmpty() { Menu.SetChecked("Metro/Station Game/Startup Demo in Play Mode/Empty Station", StartupRoute == "/game/"); return true; }

        static void OpenSceneAndEnterPlayMode(string scenePath, bool ensureLocalScene) {
            if (EditorApplication.isPlaying) {
                EditorApplication.isPlaying = false;
                return;
            }
            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            if (ensureLocalScene && !File.Exists(Path.Combine(projectRoot, scenePath))) {
                StationLocalProfile.GenerateReport();
            } else if (!ensureLocalScene && !File.Exists(Path.Combine(projectRoot, scenePath))) {
                StationGameScene.Generate();
            }
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            FocusGameViewTab();
            Application.runInBackground = true;
            EditorApplication.isPlaying = true;
        }

        public static void FocusGameViewTab() {
            if (cachedGameViewType == null) {
                cachedGameViewType = typeof(UnityEditor.Editor).Assembly.GetType("UnityEditor.GameView");
            }
            if (cachedGameViewType == null) return;
            var window = EditorWindow.GetWindow(cachedGameViewType, false, null, true);
            if (window != null) window.ShowTab();
        }

        // ------------------------------------------------------------------ lifecycle

        static void OnPlayModeStateChanged(PlayModeStateChange state) {
            SyncRuntimePreferences();
            switch (state) {
                case PlayModeStateChange.EnteredPlayMode:
                    ensuredBuildThisPlay = false;
                    legacySliceNotifiedThisPlay = false;
                    break;
                case PlayModeStateChange.ExitingPlayMode:
                case PlayModeStateChange.EnteredEditMode:
                    ensuredBuildThisPlay = false;
                    legacySliceNotifiedThisPlay = false;
                    StopActivePresenter();
                    break;
            }
        }

        static void OnEditorUpdate() {
            if (!EditorApplication.isPlaying || Application.isBatchMode || !Enabled) return;
            if (legacySliceNotifiedThisPlay) return;

            if (UnityEngine.Object.FindAnyObjectByType<StationGameHost>() == null &&
                UnityEngine.Object.FindAnyObjectByType<ZooPlayableView>() != null) {
                legacySliceNotifiedThisPlay = true;
                UnityEngine.Debug.LogWarning(
                    "[ReactUI] ZooPlayable is the legacy vertical-slice scene without StationGameHost. " +
                    "To run the full Station Designer React UI, click 'Metro > Station Game > Play StationGameLocal (3D Crowd) with Full UI' " +
                    "(or open Assets/StationDesigner/Scenes/StationGameLocal.unity).");
            }
        }

        // ------------------------------------------------------------------ StandaloneWindows64 .exe packaging

        public void OnPostprocessBuild(BuildReport report) {
            if (report == null || report.summary.platform != BuildTarget.StandaloneWindows64) return;

            string outputExe = report.summary.outputPath;
            if (string.IsNullOrWhiteSpace(outputExe)) return;
            string outDir = Path.GetDirectoryName(outputExe);
            string exeNameNoExt = Path.GetFileNameWithoutExtension(outputExe);
            if (string.IsNullOrWhiteSpace(outDir) || string.IsNullOrWhiteSpace(exeNameNoExt)) return;

            string dataDir = Path.Combine(outDir, exeNameNoExt + "_Data");
            if (!Directory.Exists(dataDir)) return;

            string repoRoot = RepoRoot();
            string workerExe = OverlayExePath(repoRoot);
            if (!EnsureOverlayBuilt(repoRoot, workerExe)) {
                throw new BuildFailedException("Failed to build MetroEditorWebView offscreen UI worker for Windows player.");
            }
            if (!EnsureUiBundleExists(repoRoot)) {
                throw new BuildFailedException("Failed to build game/dist-unity-ui bundle for Windows player.");
            }

            string targetRoot = Path.Combine(dataDir, "StreamingAssets", "MetroUi");
            CopyDirectoryRecursive(Path.GetDirectoryName(workerExe), Path.Combine(targetRoot, "bin"));
            CopyDirectoryRecursive(Path.Combine(repoRoot, "game", "dist-unity-ui"), Path.Combine(targetRoot, "ui"));
            CopyDirectoryRecursive(Path.Combine(repoRoot, "game", "public", "module-thumbnails"), Path.Combine(targetRoot, "public", "module-thumbnails"));
            CopyDirectoryRecursive(Path.Combine(repoRoot, "game", "public", "audio"), Path.Combine(targetRoot, "public", "audio"));

            UnityEngine.Debug.Log($"[ReactUI] Staged offscreen React UI bundle into {targetRoot}");
        }

        static void CopyDirectoryRecursive(string sourceDir, string destDir) {
            if (string.IsNullOrWhiteSpace(sourceDir) || !Directory.Exists(sourceDir)) return;
            Directory.CreateDirectory(destDir);
            foreach (string file in Directory.GetFiles(sourceDir)) {
                string destFile = Path.Combine(destDir, Path.GetFileName(file));
                File.Copy(file, destFile, overwrite: true);
            }
            foreach (string subDir in Directory.GetDirectories(sourceDir)) {
                string destSub = Path.Combine(destDir, Path.GetFileName(subDir));
                CopyDirectoryRecursive(subDir, destSub);
            }
        }

        // ------------------------------------------------------------------ build & asset helpers

        static string RepoRoot() => Directory.GetParent(Directory.GetParent(Application.dataPath).FullName).FullName;

        static string OverlayExePath(string repoRoot) =>
            Path.Combine(repoRoot, ".preview", "unity", "editor-ui-host", "bin", "MetroEditorWebView.exe");

        public static bool EnsureOverlayBuilt(string repoRoot, string exePath) {
            string csproj = Path.Combine(repoRoot, "tools", "unity-editor-ui", "MetroEditorWebView.csproj");
            string programCs = Path.Combine(repoRoot, "tools", "unity-editor-ui", "Program.cs");
            if (!File.Exists(csproj)) {
                UnityEngine.Debug.LogWarning("React UI worker project not found at: " + csproj);
                return false;
            }
            if (File.Exists(exePath) && File.Exists(programCs) &&
                File.GetLastWriteTimeUtc(exePath) >= File.GetLastWriteTimeUtc(programCs) &&
                File.GetLastWriteTimeUtc(exePath) >= File.GetLastWriteTimeUtc(csproj)) {
                return true;
            }

            var psi = new ProcessStartInfo {
                FileName = "dotnet",
                Arguments = $"build \"{csproj}\" -c Release --nologo -v q",
                WorkingDirectory = repoRoot,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            try {
                using var proc = Process.Start(psi);
                string stdout = proc.StandardOutput.ReadToEnd();
                string stderr = proc.StandardError.ReadToEnd();
                proc.WaitForExit(60000);
                if (proc.ExitCode != 0 || !File.Exists(exePath)) {
                    UnityEngine.Debug.LogError($"Failed to build MetroEditorWebView ({proc.ExitCode}):\n{stdout}\n{stderr}");
                    return false;
                }
                return true;
            } catch (Exception ex) {
                UnityEngine.Debug.LogError("Could not invoke dotnet to build MetroEditorWebView: " + ex.Message);
                return false;
            }
        }

        public static bool EnsureUiBundleExists(string repoRoot) {
            string manifest = Path.Combine(repoRoot, "game", "dist-unity-ui", ".vite", "manifest.json");
            if (File.Exists(manifest)) return true;

            var psi = new ProcessStartInfo {
                FileName = "node",
                Arguments = "node_modules/vite/bin/vite.js build --config vite.unity-ui.config.ts",
                WorkingDirectory = Path.Combine(repoRoot, "game"),
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            try {
                using var proc = Process.Start(psi);
                string stdout = proc.StandardOutput.ReadToEnd();
                string stderr = proc.StandardError.ReadToEnd();
                proc.WaitForExit(60000);
                if (proc.ExitCode != 0 || !File.Exists(manifest)) {
                    UnityEngine.Debug.LogError($"Failed to build game/dist-unity-ui ({proc.ExitCode}):\n{stdout}\n{stderr}");
                    return false;
                }
                return true;
            } catch (Exception ex) {
                UnityEngine.Debug.LogError("Could not build game/dist-unity-ui with Vite: " + ex.Message);
                return false;
            }
        }

        // ------------------------------------------------------------------ Pipeline CLI commands

        [CliGroupCommand("metro",
            "Run the offscreen MetroEditorWebView self-test inside the interactive desktop session and return its alpha + input report.",
            Effect = CommandEffect.ReadOnly, Tags = new[] { "tests" })]
        internal static ExitCode EditorUiSelftest(CommandContext cmd) {
            try {
                string repoRoot = RepoRoot();
                string exePath = OverlayExePath(repoRoot);
                if (!EnsureOverlayBuilt(repoRoot, exePath) || !EnsureUiBundleExists(repoRoot)) {
                    cmd.Log.Error("Could not build MetroEditorWebView or game/dist-unity-ui.");
                    return ExitCode.Failed;
                }

                string reportPath = Path.Combine(repoRoot, ".preview", "unity", "editor-ui-host", "editor-selftest.json");
                if (File.Exists(reportPath)) File.Delete(reportPath);

                var psi = new ProcessStartInfo {
                    FileName = exePath,
                    Arguments = $"--self-test --self-test-out \"{reportPath}\" --repo \"{repoRoot}\"",
                    WorkingDirectory = repoRoot,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                };
                using var proc = Process.Start(psi);
                var stdoutTask = proc.StandardOutput.ReadToEndAsync();
                var stderrTask = proc.StandardError.ReadToEndAsync();
                if (!proc.WaitForExit(20000)) {
                    try { proc.Kill(); } catch { }
                    cmd.Log.Error("Self-test timed out after 20s.");
                    return ExitCode.Failed;
                }
                string stdout = stdoutTask.GetAwaiter().GetResult();
                string stderr = stderrTask.GetAwaiter().GetResult();

                if (proc.ExitCode != 0 || !File.Exists(reportPath)) {
                    cmd.Log.Error($"Self-test exited with code {proc.ExitCode}:\n{stdout}\n{stderr}");
                    return ExitCode.Failed;
                }

                var report = JObject.Parse(File.ReadAllText(reportPath));
                cmd.Result.Write(report);
                return (bool?)report["ok"] == true ? ExitCode.Success : ExitCode.Failed;
            } catch (Exception ex) {
                cmd.Log.Error("editor_ui_selftest failed: " + ex);
                return ExitCode.Failed;
            }
        }

        [CliGroupCommand("metro",
            "Prepare the open Editor in Edit Mode for in-canvas React UI Play Mode: ensure scene exists, open StationGame or StationGameLocal, focus the Game tab, and set the initial route.",
            Effect = CommandEffect.Destructive, Tags = new[] { "tests" })]
        internal static ExitCode EditorUiPrepare(
            CommandContext cmd,
            [CliArg("scene", "Scene to open: StationGame or StationGameLocal.")] string scene = "StationGameLocal",
            [CliArg("route", "Initial route loaded in the React UI, e.g. /game/zoo, /game/en/zoo, /game/tanwei, or /game/.")] string route = "/game/zoo") {
            try {
                if (EditorApplication.isPlaying) {
                    cmd.Log.Error("Stop Play Mode before running editor_ui_prepare.");
                    return ExitCode.Failed;
                }
                Enabled = true;
                SmokeSuppressed = false;
                StartupRoute = route;

                bool isLocal = string.Equals(scene, "StationGameLocal", StringComparison.OrdinalIgnoreCase);
                string scenePath = isLocal ? StationLocalProfile.LocalScenePath : StationGameScene.ScenePath;
                string projectRoot = Directory.GetParent(Application.dataPath).FullName;
                if (!File.Exists(Path.Combine(projectRoot, scenePath))) {
                    if (isLocal) StationLocalProfile.GenerateReport();
                    else StationGameScene.Generate();
                }

                EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                FocusGameViewTab();
                Application.runInBackground = true;

                cmd.Result.Write(new JObject {
                    ["status"] = "prepared",
                    ["scene"] = scenePath,
                    ["route"] = StartupRoute,
                    ["enabled"] = Enabled,
                });
                return ExitCode.Success;
            } catch (Exception ex) {
                cmd.Log.Error("editor_ui_prepare failed: " + ex);
                return ExitCode.Failed;
            }
        }

        [CliGroupCommand("metro",
            "Wait in Play Mode until the in-canvas React UI RawImage has uploaded frames and StationGameHost has committed the station.",
            Effect = CommandEffect.ReadOnly, Tags = new[] { "tests" })]
        internal static async Task<ExitCode> EditorUiWait(
            CommandContext cmd,
            [CliArg("wait-seconds", "Maximum seconds to wait for React UI + station commit.")] double timeoutSeconds = 25,
            [CliArg("preview-out", "Optional destination PNG path to capture the raw 32-bit RGBA WebView2 shared-memory surface.")] string previewOut = "") {
            try {
                Enabled = true;
                SmokeSuppressed = false;
                FocusGameViewTab();
                Application.runInBackground = true;

                var sw = Stopwatch.StartNew();
                long limitMs = (long)(Math.Max(1.0, timeoutSeconds) * 1000.0);
                StationGameHost host = null;
                StationDesktopUiPresenter presenter = null;

                while (sw.ElapsedMilliseconds < limitMs) {
                    await Task.Yield();
                    host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
                    presenter = StationDesktopUiPresenter.Active;
                    if (host != null && host.IsLoaded && presenter != null && presenter.IsWebReady && presenter.PresentedFrameCount >= 2) {
                        // Allow #game-loading dismissal frame to propagate into the Unity RawImage texture.
                        int baseFrames = presenter.PresentedFrameCount;
                        var settleSw = Stopwatch.StartNew();
                        while (settleSw.ElapsedMilliseconds < 900 && presenter.PresentedFrameCount < baseFrames + 3) {
                            await Task.Yield();
                        }
                        break;
                    }
                }

                string capturedPreview = "";
                if (!string.IsNullOrWhiteSpace(previewOut) && presenter != null && presenter.IsWebReady) {
                    string repoRoot = RepoRoot();
                    string fullPreview = Path.IsPathRooted(previewOut)
                        ? Path.GetFullPath(previewOut)
                        : Path.GetFullPath(Path.Combine(repoRoot, previewOut));
                    if (File.Exists(fullPreview)) File.Delete(fullPreview);
                    presenter.RequestPreviewCapture(fullPreview);
                    var capSw = Stopwatch.StartNew();
                    while (capSw.ElapsedMilliseconds < 5000 && string.IsNullOrEmpty(presenter.LastCapturedPreviewPath)) {
                        await Task.Yield();
                    }
                    capturedPreview = presenter.LastCapturedPreviewPath;
                }

                bool ok = host != null && host.IsLoaded && presenter != null && presenter.IsWebReady && presenter.PresentedFrameCount > 0;
                cmd.Result.Write(new JObject {
                    ["status"] = ok ? "passed" : "incomplete",
                    ["mode"] = "in-canvas-rawimage",
                    ["scene"] = UnityEngine.SceneManagement.SceneManager.GetActiveScene().path,
                    ["route"] = StartupRoute,
                    ["workerRunning"] = presenter != null && presenter.IsWorkerRunning,
                    ["webReady"] = presenter != null && presenter.IsWebReady,
                    ["presentedFrames"] = presenter != null ? presenter.PresentedFrameCount : 0,
                    ["textureWidth"] = presenter != null ? presenter.TextureWidth : 0,
                    ["textureHeight"] = presenter != null ? presenter.TextureHeight : 0,
                    ["stationLoaded"] = host != null && host.IsLoaded,
                    ["sourceId"] = host != null ? host.CurrentSourceId : "",
                    ["revision"] = host != null ? host.CurrentRevision : 0,
                    ["previewPath"] = capturedPreview,
                    ["elapsedMs"] = sw.ElapsedMilliseconds,
                });
                return ok ? ExitCode.Success : ExitCode.Failed;
            } catch (Exception ex) {
                cmd.Log.Error("editor_ui_wait failed: " + ex);
                return ExitCode.Failed;
            }
        }

        [CliGroupCommand("metro",
            "Capture Unity's internal GameView framebuffer (3D scene + ScreenSpaceOverlay RawImage React UI) to a PNG under .preview/unity/.",
            Effect = CommandEffect.ReadOnly, Tags = new[] { "tests" })]
        internal static async Task<ExitCode> EditorUiCapture(
            CommandContext cmd,
            [CliArg("output-path", "Destination PNG path under .preview/unity/.")] string outputPath = ".preview/unity/editor/in-window-gameview.png") {
            try {
                if (!EditorApplication.isPlaying) {
                    cmd.Log.Error("Editor must be in Play Mode to capture the live GameView.");
                    return ExitCode.Failed;
                }
                FocusGameViewTab();
                await Task.Yield();
                await Task.Yield();

                string repoRoot = RepoRoot();
                string fullOut = Path.IsPathRooted(outputPath)
                    ? Path.GetFullPath(outputPath)
                    : Path.GetFullPath(Path.Combine(repoRoot, outputPath));
                Directory.CreateDirectory(Path.GetDirectoryName(fullOut)!);
                if (File.Exists(fullOut)) File.Delete(fullOut);

                ScreenCapture.CaptureScreenshot(fullOut);
                var sw = Stopwatch.StartNew();
                while (sw.ElapsedMilliseconds < 5000 && !File.Exists(fullOut)) {
                    await Task.Yield();
                }

                if (!File.Exists(fullOut)) {
                    cmd.Log.Error("ScreenCapture.CaptureScreenshot did not write: " + fullOut);
                    return ExitCode.Failed;
                }

                cmd.Result.Write(new JObject {
                    ["status"] = "captured",
                    ["path"] = fullOut,
                    ["bytes"] = new FileInfo(fullOut).Length,
                    ["screenWidth"] = Screen.width,
                    ["screenHeight"] = Screen.height,
                });
                return ExitCode.Success;
            } catch (Exception ex) {
                cmd.Log.Error("editor_ui_capture failed: " + ex);
                return ExitCode.Failed;
            }
        }

        [CliGroupCommand("metro",
            "Verify standalone exploded view transparency, middle/right/wheel camera gestures, WASD pan, left-drag tray arrangement, and Escape close in the live Editor WebView2 React overlay.",
            Effect = CommandEffect.ReadOnly, Tags = new[] { "tests" })]
        internal static async Task<ExitCode> EditorUiExplodedCheck(
            CommandContext cmd,
            [CliArg("out-dir", "Output folder under .preview/unity/ for SHM and GameView PNGs.")] string outDir = ".preview/unity/editor/exploded-overlay") {
            try {
                if (!EditorApplication.isPlaying) {
                    cmd.Log.Error("Editor must be in Play Mode to run editor_ui_exploded_check.");
                    return ExitCode.Failed;
                }
                FocusGameViewTab();
                Application.runInBackground = true;

                var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
                var presenter = StationDesktopUiPresenter.Active;
                var exploded = StationViewFeature.ActiveExploded;
                if (host == null || !host.IsLoaded || presenter == null || !presenter.IsWebReady || exploded == null) {
                    cmd.Log.Error("StationGameHost, StationDesktopUiPresenter, or StationExplodedView is not ready.");
                    return ExitCode.Failed;
                }

                string repoRoot = RepoRoot();
                string fullOutDir = Path.IsPathRooted(outDir)
                    ? Path.GetFullPath(outDir)
                    : Path.GetFullPath(Path.Combine(repoRoot, outDir));
                Directory.CreateDirectory(fullOutDir);

                int revBefore = host.CurrentRevision;
                bool editorCamBefore = host.stationCamera != null && host.stationCamera.enabled;
                int vw = presenter.TextureWidth > 0 ? presenter.TextureWidth : 1280;
                int vh = presenter.TextureHeight > 0 ? presenter.TextureHeight : 720;
                string sessionId = !string.IsNullOrEmpty(host.ClientSessionId) ? host.ClientSessionId : "editor-overlay-check";

                host.BrowserCommand(new JObject {
                    ["schemaVersion"] = 2,
                    ["id"] = "overlay-exp-open-" + Guid.NewGuid().ToString("N"),
                    ["sessionId"] = sessionId,
                    ["type"] = "exploded.open",
                    ["payload"] = new JObject {
                        ["viewportWidth"] = vw,
                        ["viewportHeight"] = vh,
                        ["theme"] = "blueprint",
                    },
                }.ToString(Formatting.None));

                var waitSw = Stopwatch.StartNew();
                while (waitSw.ElapsedMilliseconds < 20000 && !(exploded.IsReady && exploded.IsEquipped)) {
                    await Task.Yield();
                }
                if (!exploded.IsReady || !exploded.IsEquipped) {
                    cmd.Log.Error("Exploded view did not become ready & equipped within 20s.");
                    return ExitCode.Failed;
                }

                // Wait for WebView2 to adopt the external generation, mount <dialog class="explodedViewer" data-ready="true">, and upload fresh SHM frames.
                int baseFrames = presenter.PresentedFrameCount;
                var settleSw = Stopwatch.StartNew();
                while (settleSw.ElapsedMilliseconds < 2500 && presenter.PresentedFrameCount < baseFrames + 5) {
                    await Task.Yield();
                }
                await Task.Delay(300);

                // 1. Capture raw 32-bit RGBA WebView2 SHM surface and verify modal center alpha == 0 (transparent over Unity camera).
                string shmPng = Path.Combine(fullOutDir, "exploded-overlay-shm.png");
                if (File.Exists(shmPng)) File.Delete(shmPng);
                presenter.RequestPreviewCapture(shmPng);
                var shmSw = Stopwatch.StartNew();
                byte[] shmBytes = null;
                while (shmSw.ElapsedMilliseconds < 5000 && shmBytes == null) {
                    await Task.Yield();
                    if (string.Equals(presenter.LastCapturedPreviewPath, shmPng, StringComparison.OrdinalIgnoreCase) && File.Exists(shmPng)) {
                        try {
                            using var fs = new FileStream(shmPng, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                            if (fs.Length > 0) {
                                shmBytes = new byte[fs.Length];
                                int read = 0;
                                while (read < shmBytes.Length) {
                                    int n = fs.Read(shmBytes, read, shmBytes.Length - read);
                                    if (n <= 0) break;
                                    read += n;
                                }
                            }
                        } catch (IOException) {
                            shmBytes = null;
                        }
                    }
                }
                int centerAlpha = -1;
                int toolbarAlpha = -1;
                if (shmBytes != null && shmBytes.Length > 0) {
                    var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                    try {
                        tex.LoadImage(shmBytes);
                        Color32 centerPx = tex.GetPixel(tex.width / 2, tex.height / 2);
                        Color32 topPx = tex.GetPixel(24, tex.height - 20);
                        centerAlpha = centerPx.a;
                        toolbarAlpha = topPx.a;
                    } finally {
                        UnityEngine.Object.DestroyImmediate(tex);
                    }
                }

                // 2. Capture full GameView framebuffer (3D exploded trays + dashed guides + transparent React modal chrome).
                string openPng = Path.Combine(fullOutDir, "exploded-overlay-open.png");
                if (File.Exists(openPng)) File.Delete(openPng);
                ScreenCapture.CaptureScreenshot(openPng);
                var capOpenSw = Stopwatch.StartNew();
                while (capOpenSw.ElapsedMilliseconds < 5000 && !File.Exists(openPng)) {
                    await Task.Yield();
                }

                vw = presenter.TextureWidth > 0 ? presenter.TextureWidth : vw;
                vh = presenter.TextureHeight > 0 ? presenter.TextureHeight : vh;
                double cx = Math.Round(vw * 0.5);
                double cy = Math.Round(vh * 0.52);

                // 3. Middle-button drag orbit via presenter -> TCP -> WebView2 CDP -> explodedInput -> BrowserCommand
                var rotBeforeOrbit = exploded.ViewerCamera.transform.rotation;
                presenter.SendSyntheticMouse("move", cx, cy, "none", 0);
                await Task.Delay(40);
                presenter.SendSyntheticMouse("down", cx, cy, "middle", 4, 0, 1);
                for (int s = 1; s <= 4; s++) {
                    await Task.Delay(35);
                    presenter.SendSyntheticMouse("move", cx + s * 16, cy - s * 6, "none", 4);
                }
                await Task.Delay(40);
                presenter.SendSyntheticMouse("up", cx + 64, cy - 24, "middle", 0, 0, 1);
                await Task.Delay(250);
                float orbitDegrees = Quaternion.Angle(rotBeforeOrbit, exploded.ViewerCamera.transform.rotation);

                // 4. Right-button drag pan
                var posBeforePan = exploded.ViewerCamera.transform.position;
                presenter.SendSyntheticMouse("down", cx, cy, "right", 2, 0, 1);
                for (int s = 1; s <= 4; s++) {
                    await Task.Delay(35);
                    presenter.SendSyntheticMouse("move", cx - s * 18, cy + s * 10, "none", 2);
                }
                await Task.Delay(40);
                presenter.SendSyntheticMouse("up", cx - 72, cy + 40, "right", 0, 0, 1);
                await Task.Delay(250);
                float rightPanMeters = Vector3.Distance(posBeforePan, exploded.ViewerCamera.transform.position);

                // 5. Wheel zoom in & restore
                float orthoBeforeZoom = exploded.ViewerCamera.orthographicSize;
                presenter.SendSyntheticMouse("wheel", cx, cy, "none", 0, 0, 0, 0, -160);
                await Task.Delay(250);
                float orthoZoomed = exploded.ViewerCamera.orthographicSize;
                presenter.SendSyntheticMouse("wheel", cx, cy, "none", 0, 0, 0, 0, 160);
                await Task.Delay(250);

                // 6. Held WASD ('W') planar pan & release
                var posBeforeWasd = exploded.ViewerCamera.transform.position;
                presenter.SendSyntheticKey("down", 0x57, "w", "KeyW", 0);
                await Task.Delay(450);
                presenter.SendSyntheticKey("up", 0x57, "w", "KeyW", 0);
                await Task.Delay(250);
                float wasdPanMeters = Vector3.Distance(posBeforeWasd, exploded.ViewerCamera.transform.position);

                // 7. Find an unobstructed pixel on tray 1 (-15 m on Zoo) and left-drag it through WebView2
                int targetTrayIdx = exploded.Builder.Trays.Count > 1 ? 1 : 0;
                int targetElev = exploded.Builder.Trays[targetTrayIdx].Level;
                double pickX = cx, pickY = cy;
                bool foundTrayRay = false;
                var traySpec = exploded.Builder.Plan.Trays[targetTrayIdx];
                var trayWorldOffset = exploded.Builder.Trays[targetTrayIdx].WorldOffset;
                int stride = Math.Max(1, traySpec.Cells.Count / 120);
                for (int i = 0; i < traySpec.Cells.Count; i += stride) {
                    var cell = traySpec.Cells[i];
                    if (cell.Z != targetElev) continue;
                    var worldPt = trayWorldOffset + StationCoordinates.Point(new Vector3(cell.X + 0.5f, cell.Y + 0.5f, targetElev + 1f));
                    var vp = exploded.ViewerCamera.WorldToViewportPoint(worldPt);
                    if (vp.x < 0.15f || vp.x > 0.80f || vp.y < 0.18f || vp.y > 0.82f) continue;
                    var ray = exploded.ViewerCamera.ViewportPointToRay(new Vector3(vp.x, vp.y, 0f));
                    if (exploded.Builder.PickTray(ray, out int hitIdx, out _) && hitIdx == targetTrayIdx) {
                        pickX = Math.Round(vp.x * vw);
                        pickY = Math.Round((1.0 - vp.y) * vh);
                        foundTrayRay = true;
                        break;
                    }
                }

                int picksBeforeDrag = exploded.Builder.PickCount;
                presenter.SendSyntheticMouse("move", pickX, pickY, "none", 0);
                await Task.Delay(40);
                presenter.SendSyntheticMouse("down", pickX, pickY, "left", 1, 0, 1);
                for (int s = 1; s <= 5; s++) {
                    await Task.Delay(35);
                    presenter.SendSyntheticMouse("move", pickX + s * 22, pickY - s * 11, "none", 1);
                }
                await Task.Delay(40);
                presenter.SendSyntheticMouse("up", pickX + 110, pickY - 55, "left", 0, 0, 1);
                await Task.Delay(400);

                int? selectedAfterDrag = exploded.Builder.SelectedElevation;
                int picksDuringDrag = exploded.Builder.PickCount - picksBeforeDrag;
                float draggedMeters = exploded.Builder.Trays[targetTrayIdx].ManualOffset.magnitude;

                string draggedPng = Path.Combine(fullOutDir, "exploded-overlay-dragged.png");
                if (File.Exists(draggedPng)) File.Delete(draggedPng);
                ScreenCapture.CaptureScreenshot(draggedPng);
                var capDragSw = Stopwatch.StartNew();
                while (capDragSw.ElapsedMilliseconds < 5000 && !File.Exists(draggedPng)) {
                    await Task.Yield();
                }

                // 8. Press Escape via WebView2 keyboard forwarding to close modal and restore editor camera
                presenter.SendSyntheticKey("down", 0x1B, "Escape", "Escape", 0);
                await Task.Delay(40);
                presenter.SendSyntheticKey("up", 0x1B, "Escape", "Escape", 0);
                var closeSw = Stopwatch.StartNew();
                while (closeSw.ElapsedMilliseconds < 6000 && exploded.Phase != StationExplodedView.PhaseClosed) {
                    await Task.Yield();
                }

                bool closedCleanly = exploded.Phase == StationExplodedView.PhaseClosed;
                bool editorCamRestored = host.stationCamera != null && host.stationCamera.enabled == editorCamBefore;
                bool revisionUnchanged = host.CurrentRevision == revBefore;

                bool allOk = centerAlpha == 0 &&
                             orbitDegrees > 1.0f &&
                             rightPanMeters > 0.3f &&
                             orthoZoomed < orthoBeforeZoom - 0.1f &&
                             wasdPanMeters > 0.3f &&
                             foundTrayRay &&
                             selectedAfterDrag == targetElev &&
                             picksDuringDrag == 1 &&
                             draggedMeters > 0.5f &&
                             closedCleanly &&
                             editorCamRestored &&
                             revisionUnchanged;

                cmd.Result.Write(new JObject {
                    ["ok"] = allOk,
                    ["centerAlpha"] = centerAlpha,
                    ["toolbarAlpha"] = toolbarAlpha,
                    ["orbitDegrees"] = Math.Round(orbitDegrees, 3),
                    ["rightPanMeters"] = Math.Round(rightPanMeters, 3),
                    ["orthoBeforeZoom"] = Math.Round(orthoBeforeZoom, 3),
                    ["orthoZoomed"] = Math.Round(orthoZoomed, 3),
                    ["wasdPanMeters"] = Math.Round(wasdPanMeters, 3),
                    ["foundTrayRay"] = foundTrayRay,
                    ["targetElevation"] = targetElev,
                    ["selectedElevation"] = selectedAfterDrag.HasValue ? (JToken)selectedAfterDrag.Value : JValue.CreateNull(),
                    ["picksDuringDrag"] = picksDuringDrag,
                    ["draggedMeters"] = Math.Round(draggedMeters, 3),
                    ["closedCleanly"] = closedCleanly,
                    ["editorCamRestored"] = editorCamRestored,
                    ["revisionUnchanged"] = revisionUnchanged,
                    ["shmPng"] = shmPng,
                    ["openPng"] = openPng,
                    ["draggedPng"] = draggedPng,
                });
                return allOk ? ExitCode.Success : ExitCode.Failed;
            } catch (Exception ex) {
                cmd.Log.Error("editor_ui_exploded_check failed: " + ex);
                return ExitCode.Failed;
            }
        }

        [CliGroupCommand("metro",
            "Verify station statistics HUD, paginated stats.history transport, and ChartsPanel open/close from both the View rail and HUD bar in the live Editor WebView2 React overlay.",
            Effect = CommandEffect.ReadOnly, Tags = new[] { "tests" })]
        internal static async Task<ExitCode> EditorUiStatisticsCheck(
            CommandContext cmd,
            [CliArg("out-dir", "Output folder under .preview/unity/ for GameView PNGs.")] string outDir = ".preview/unity/editor/statistics-overlay") {
            try {
                if (!EditorApplication.isPlaying) {
                    cmd.Log.Error("Editor must be in Play Mode to run editor_ui_statistics_check.");
                    return ExitCode.Failed;
                }
                FocusGameViewTab();
                Application.runInBackground = true;

                var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
                var presenter = StationDesktopUiPresenter.Active;
                var session = (host?.Simulation as StationSimulationHost)?.Session;
                var handler = StationStatisticsFeature.ActiveHandler;
                if (host == null || !host.IsLoaded || presenter == null || !presenter.IsWebReady || session == null || handler == null) {
                    cmd.Log.Error("StationGameHost, StationDesktopUiPresenter, StationSimulationSession, or StationStatisticsCommandHandler is not ready.");
                    return ExitCode.Failed;
                }

                string repoRoot = RepoRoot();
                string fullOutDir = Path.IsPathRooted(outDir)
                    ? Path.GetFullPath(outDir)
                    : Path.GetFullPath(Path.Combine(repoRoot, outDir));
                Directory.CreateDirectory(fullOutDir);

                int revBefore = host.CurrentRevision;
                int vw = presenter.TextureWidth > 0 ? presenter.TextureWidth : 1280;
                int vh = presenter.TextureHeight > 0 ? presenter.TextureHeight : 720;
                string sessionId = !string.IsNullOrEmpty(host.ClientSessionId) ? host.ClientSessionId : "editor-stats-check";

                void SendSim(string type, JObject payload) {
                    host.BrowserCommand(new JObject {
                        ["schemaVersion"] = 2,
                        ["id"] = "overlay-stats-" + Guid.NewGuid().ToString("N"),
                        ["sessionId"] = sessionId,
                        ["type"] = type,
                        ["payload"] = payload,
                    }.ToString(Formatting.None));
                }

                async Task ClickPixel(double x, double y) {
                    presenter.SendSyntheticMouse("move", x, y, "none", 0);
                    await Task.Delay(50);
                    presenter.SendSyntheticMouse("down", x, y, "left", 1, 0, 1);
                    await Task.Delay(50);
                    presenter.SendSyntheticMouse("up", x, y, "left", 0, 0, 1);
                    await Task.Delay(450);
                }

                async Task<string> CaptureView(string name) {
                    string png = Path.Combine(fullOutDir, name);
                    if (File.Exists(png)) File.Delete(png);
                    ScreenCapture.CaptureScreenshot(png);
                    var swCap = Stopwatch.StartNew();
                    while (swCap.ElapsedMilliseconds < 5000 && !File.Exists(png)) {
                        await Task.Yield();
                    }
                    return png;
                }

                // 1. Seek Zoo to Monday 2026-01-05 08:00 morning peak and run at 64x until >= 3 history samples exist.
                int servedBefore = handler.RequestsServed;
                SendSim("sim.seek", new JObject { ["simTimeSeconds"] = 4 * 86400 + 28800 });
                await Task.Delay(150);
                string activeRunId = session.StatisticsRunId;
                SendSim("sim.speed", new JObject { ["speed"] = 64 });
                SendSim("sim.play", new JObject { ["playing"] = true });

                var runSw = Stopwatch.StartNew();
                while (runSw.ElapsedMilliseconds < 25000 && !(session.History.Count >= 3 && session.Statistics.Population > 0)) {
                    await Task.Yield();
                }

                SendSim("sim.play", new JObject { ["playing"] = false });
                SendSim("sim.speed", new JObject { ["speed"] = 1 });

                // Wait for WebView2's statisticsAdapter to receive the state frame and request stats.history over TCP.
                var syncSw = Stopwatch.StartNew();
                while (syncSw.ElapsedMilliseconds < 6000 && !(handler.RequestsServed > servedBefore && handler.LastServedRunId == activeRunId)) {
                    await Task.Yield();
                }
                await Task.Delay(350);

                // 2. Click the '统计图' / 'Statistics charts' tile in the View rail (middle column of row 3).
                double railX = Math.Round(vw * 0.910);
                double railY = Math.Round(vh * 0.638);
                await ClickPixel(railX, railY);
                string railOpenPng = await CaptureView("stats-editor-rail-open.png");

                // 3. Close with Escape via WebView2 keyboard forwarding.
                presenter.SendSyntheticKey("down", 0x1B, "Escape", "Escape", 0);
                await Task.Delay(50);
                presenter.SendSyntheticKey("up", 0x1B, "Escape", "Escape", 0);
                await Task.Delay(400);
                string closedPng = await CaptureView("stats-editor-closed.png");

                // 4. Reopen ChartsPanel by clicking the HUD bottombarMetrics button.
                double hudX = Math.Round(vw * 0.080);
                double hudY = Math.Round(vh * 0.980);
                await ClickPixel(hudX, hudY);
                string hudOpenPng = await CaptureView("stats-editor-hud-open.png");

                bool revisionUnchanged = host.CurrentRevision == revBefore;
                bool ok = session.History.Count >= 3 &&
                          session.Statistics.Population > 0 &&
                          handler.RequestsServed > servedBefore &&
                          handler.LastServedRunId == activeRunId &&
                          handler.LastServedRows >= 1 &&
                          revisionUnchanged &&
                          File.Exists(railOpenPng) &&
                          File.Exists(closedPng) &&
                          File.Exists(hudOpenPng);

                cmd.Result.Write(new JObject {
                    ["ok"] = ok,
                    ["runId"] = activeRunId,
                    ["historyCount"] = session.History.Count,
                    ["population"] = session.Statistics.Population,
                    ["crowdLos"] = session.Statistics.CrowdLos,
                    ["boarded"] = session.Statistics.Boarded,
                    ["requestsServedDelta"] = handler.RequestsServed - servedBefore,
                    ["lastServedRows"] = handler.LastServedRows,
                    ["revisionUnchanged"] = revisionUnchanged,
                    ["railOpenPng"] = railOpenPng,
                    ["closedPng"] = closedPng,
                    ["hudOpenPng"] = hudOpenPng,
                });
                return ok ? ExitCode.Success : ExitCode.Failed;
            } catch (Exception ex) {
                cmd.Log.Error("editor_ui_statistics_check failed: " + ex);
                return ExitCode.Failed;
            }
        }

        [CliGroupCommand("metro",
            "Verify Hide UI ('U' shortcut / view.set hideUi) switches the live Editor viewport between the solid void clear and the procedural cloud skybox + matching horizon fog.",
            Effect = CommandEffect.ReadOnly, Tags = new[] { "tests" })]
        internal static async Task<ExitCode> EditorUiSkyCheck(
            CommandContext cmd,
            [CliArg("out-dir", "Output folder under .preview/unity/ for GameView PNGs.")] string outDir = ".preview/unity/editor/sky-overlay") {
            try {
                if (!EditorApplication.isPlaying) {
                    cmd.Log.Error("Editor must be in Play Mode to run editor_ui_sky_check.");
                    return ExitCode.Failed;
                }
                FocusGameViewTab();
                Application.runInBackground = true;

                var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
                var presenter = StationDesktopUiPresenter.Active;
                var rig = StationViewFeature.Active;
                if (host == null || !host.IsLoaded || host.stationCamera == null || presenter == null || !presenter.IsWebReady || rig == null) {
                    cmd.Log.Error("StationGameHost, StationDesktopUiPresenter, or StationViewRig is not ready.");
                    return ExitCode.Failed;
                }

                string repoRoot = RepoRoot();
                string fullOutDir = Path.IsPathRooted(outDir)
                    ? Path.GetFullPath(outDir)
                    : Path.GetFullPath(Path.Combine(repoRoot, outDir));
                Directory.CreateDirectory(fullOutDir);

                int revBefore = host.CurrentRevision;
                string sessionId = !string.IsNullOrEmpty(host.ClientSessionId) ? host.ClientSessionId : "editor-sky-check";

                void SendHost(string type, JObject payload) {
                    host.BrowserCommand(new JObject {
                        ["schemaVersion"] = 2,
                        ["id"] = "overlay-sky-" + Guid.NewGuid().ToString("N"),
                        ["sessionId"] = sessionId,
                        ["type"] = type,
                        ["payload"] = payload,
                    }.ToString(Formatting.None));
                }

                async Task<string> CaptureView(string name) {
                    string png = Path.Combine(fullOutDir, name);
                    if (File.Exists(png)) File.Delete(png);
                    ScreenCapture.CaptureScreenshot(png);
                    var swCap = Stopwatch.StartNew();
                    while (swCap.ElapsedMilliseconds < 5000 && !File.Exists(png)) {
                        await Task.Yield();
                    }
                    return png;
                }

                // Frame street level looking across the station plaza, trees, road, and upper sky.
                var boundsCentre = rig.CameraController.State.Bounds.center;
                rig.CameraController.State.Projection = StationProjection.Perspective;
                rig.CameraController.State.Fov = 45f;
                rig.CameraController.State.Target = new Vector3(boundsCentre.x + 8f, boundsCentre.y + 6f, 2.5f);
                rig.CameraController.State.Position = new Vector3(boundsCentre.x - 24f, boundsCentre.y - 30f, 11.5f);
                rig.Commands.ApplyCamera();
                SendHost("sim.seek", new JObject { ["simTimeSeconds"] = 6 * 3600 + 1800 });
                await Task.Delay(350);

                bool initialSkyShown = rig.Sky.Shown;
                var initialClearFlags = host.stationCamera.clearFlags;
                string normalPng = await CaptureView("hide-ui-off-0630.png");

                // Press 'U' via WebView2 keyboard forwarding to enter Hide UI mode.
                int framesBeforeU = presenter.PresentedFrameCount;
                presenter.SendSyntheticKey("down", 0x55, "u", "KeyU", 0);
                await Task.Delay(50);
                presenter.SendSyntheticKey("up", 0x55, "u", "KeyU", 0);

                var waitOnSw = Stopwatch.StartNew();
                while (waitOnSw.ElapsedMilliseconds < 5000 &&
                       !(rig.Sky.Shown && host.stationCamera.clearFlags == CameraClearFlags.Skybox && presenter.PresentedFrameCount >= framesBeforeU + 2)) {
                    await Task.Yield();
                }
                await Task.Delay(300);

                bool skyShownOnU = rig.Sky.Shown;
                var skyClearFlags = host.stationCamera.clearFlags;
                float dawnIntensity = rig.Sky.AppliedIntensity;
                string dawnSkyPng = await CaptureView("hide-ui-on-0630.png");

                // Seek to 12:00 noon for full daylight sky intensity (1.0).
                SendHost("sim.seek", new JObject { ["simTimeSeconds"] = 12 * 3600 });
                await Task.Delay(300);
                float noonIntensity = rig.Sky.AppliedIntensity;
                string noonSkyPng = await CaptureView("hide-ui-on-1200.png");

                // Press 'U' again to exit Hide UI mode and restore void background + fog.
                int framesBeforeRestore = presenter.PresentedFrameCount;
                presenter.SendSyntheticKey("down", 0x55, "u", "KeyU", 0);
                await Task.Delay(50);
                presenter.SendSyntheticKey("up", 0x55, "u", "KeyU", 0);

                var waitOffSw = Stopwatch.StartNew();
                while (waitOffSw.ElapsedMilliseconds < 5000 &&
                       !(!rig.Sky.Shown && host.stationCamera.clearFlags == CameraClearFlags.SolidColor && presenter.PresentedFrameCount >= framesBeforeRestore + 2)) {
                    await Task.Yield();
                }
                SendHost("sim.seek", new JObject { ["simTimeSeconds"] = 6 * 3600 + 1800 });
                await Task.Delay(300);

                bool skyHiddenOnSecondU = !rig.Sky.Shown;
                var restoredClearFlags = host.stationCamera.clearFlags;
                string restoredPng = await CaptureView("hide-ui-restored-0630.png");

                rig.CameraController.Home();
                rig.CameraController.ZoomBy(2f / 3f);
                rig.Commands.ApplyCamera();

                bool revisionUnchanged = host.CurrentRevision == revBefore;
                bool ok = !initialSkyShown &&
                          initialClearFlags == CameraClearFlags.SolidColor &&
                          skyShownOnU &&
                          skyClearFlags == CameraClearFlags.Skybox &&
                          Mathf.Abs(noonIntensity - 1f) < 1e-4f &&
                          dawnIntensity > 0.7f && dawnIntensity < 0.95f &&
                          skyHiddenOnSecondU &&
                          restoredClearFlags == CameraClearFlags.SolidColor &&
                          revisionUnchanged &&
                          File.Exists(normalPng) &&
                          File.Exists(dawnSkyPng) &&
                          File.Exists(noonSkyPng) &&
                          File.Exists(restoredPng);

                cmd.Result.Write(new JObject {
                    ["ok"] = ok,
                    ["initialClearFlags"] = initialClearFlags.ToString(),
                    ["skyShownOnU"] = skyShownOnU,
                    ["skyClearFlags"] = skyClearFlags.ToString(),
                    ["dawnIntensity"] = Math.Round(dawnIntensity, 6),
                    ["noonIntensity"] = Math.Round(noonIntensity, 6),
                    ["skyHiddenOnSecondU"] = skyHiddenOnSecondU,
                    ["restoredClearFlags"] = restoredClearFlags.ToString(),
                    ["revisionUnchanged"] = revisionUnchanged,
                    ["normalPng"] = normalPng,
                    ["dawnSkyPng"] = dawnSkyPng,
                    ["noonSkyPng"] = noonSkyPng,
                    ["restoredPng"] = restoredPng,
                });
                return ok ? ExitCode.Success : ExitCode.Failed;
            } catch (Exception ex) {
                cmd.Log.Error("editor_ui_sky_check failed: " + ex);
                return ExitCode.Failed;
            }
        }
    }
}
