using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using Metro.App;
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
    }
}
