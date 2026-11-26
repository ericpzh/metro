using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
using System.IO.MemoryMappedFiles;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;
using UnityEngine.InputSystem.LowLevel;
#endif
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace Metro.App {
    /// <summary>
    /// Renders the shared Station Designer React 19 UI (<c>game/src/unity-web/main.tsx</c>)
    /// directly inside Unity's own <c>Game</c> viewport (and Windows standalone <c>.exe</c>
    /// swapchain) on a <see cref="RenderMode.ScreenSpaceOverlay"/> <see cref="RawImage"/>.
    ///
    /// WebView2 runs completely offscreen in <c>MetroEditorWebView.exe</c> with zero visible
    /// desktop popup window, writing straight-alpha 32-bit BGRA frames into a double-buffered
    /// shared-memory map (<see cref="MemoryMappedFile"/>) and receiving Unity
    /// <c>InputSystem</c> mouse, wheel and keyboard events over loopback IPC.
    /// Compiled out on WebGL, where the browser DOM hosts React natively.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class StationDesktopUiPresenter : MonoBehaviour {
        /// <summary>The one overlay canvas object this presenter owns (plan 29 §4).</summary>
        public const string CanvasName = "StationDesktopUiCanvas";

        public static Func<(string exePath, string uiDir, string publicDir, string logDir)> PathResolver { get; set; }

        static bool userEnabled = true;
        static bool smokeSuppressed;
        static string startupRoute = "/game/zoo";
        static StationDesktopUiPresenter activeInstance;

        public static bool UserEnabled {
            get => userEnabled;
            set {
                if (userEnabled == value) return;
                userEnabled = value;
                if (!userEnabled && activeInstance != null) {
                    activeInstance.StopWorker();
                }
            }
        }

        public static bool SmokeSuppressed {
            get => smokeSuppressed;
            set {
                smokeSuppressed = value;
                // The canvas refresh only exists on the platforms that present the
                // in-canvas UI; on WebGL the class compiles its input/presentation half
                // out (see the #else below) and there is no canvas to refresh.
                if (activeInstance != null) {
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
                    activeInstance.RefreshCanvasVisibility();
#endif
                }
            }
        }

        public static string StartupRoute {
            get => startupRoute;
            set => startupRoute = string.IsNullOrWhiteSpace(value) ? "/game/zoo" : value;
        }

        public static bool IsBenchmarkRoute(string route) {
            if (string.IsNullOrWhiteSpace(route)) return false;
            string clean = route.Trim().TrimEnd('/');
            return clean.EndsWith("/benchmark", StringComparison.OrdinalIgnoreCase)
                || clean.EndsWith("/benchmark/en", StringComparison.OrdinalIgnoreCase);
        }

        public static string ParseCommandLineRoute(string[] args) {
            if (args == null || args.Length == 0) return null;
            for (int i = 0; i < args.Length; i++) {
                string arg = args[i];
                if (string.Equals(arg, "-metroRoute", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) {
                    string val = args[i + 1]?.Trim();
                    if (!string.IsNullOrEmpty(val)) {
                        return val.StartsWith("/", StringComparison.Ordinal) ? val : "/" + val;
                    }
                }
            }
            bool benchmark = false;
            bool english = false;
            for (int i = 0; i < args.Length; i++) {
                string arg = args[i];
                if (string.Equals(arg, "-benchmark", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(arg, "--benchmark", StringComparison.OrdinalIgnoreCase)) {
                    benchmark = true;
                } else if (string.Equals(arg, "--en", StringComparison.OrdinalIgnoreCase) ||
                           string.Equals(arg, "-en", StringComparison.OrdinalIgnoreCase)) {
                    english = true;
                } else if (string.Equals(arg, "-lang", StringComparison.OrdinalIgnoreCase) &&
                           i + 1 < args.Length &&
                           string.Equals(args[i + 1], "en", StringComparison.OrdinalIgnoreCase)) {
                    english = true;
                }
            }
            if (benchmark) return english ? "/game/benchmark/en" : "/game/benchmark";
            return null;
        }

        static bool HasBenchmarkOutputArg(string[] args) {
            if (args == null) return false;
            for (int i = 0; i < args.Length; i++) {
                if (string.Equals(args[i], "-metroBenchOut", StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        public static string StandaloneAutosavePath() =>
            Path.Combine(Application.persistentDataPath, "autosave.metro.json");

        public static StationDesktopUiPresenter Active => activeInstance;
        public static bool IsSupportedPlatform {
            get {
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
                return true;
#else
                return false;
#endif
            }
        }

#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
        const int ShmMagic = 0x4D554932; // "MUI2"
        const int ShmHeaderBytes = 64;
        const int ShmMaxWidth = 3840;
        const int ShmMaxHeight = 2160;
        const int ShmSlotStrideBytes = ShmMaxWidth * ShmMaxHeight * 4;
        const long ShmTotalBytes = ShmHeaderBytes + 2L * ShmSlotStrideBytes;
        const string UiThemePreference = "metro.ui.theme";
        const string UiLanguagePreference = "metro.ui.lang";

        readonly ConcurrentQueue<string> incomingCommands = new ConcurrentQueue<string>();
        readonly ConcurrentQueue<(bool isError, string text)> incomingLogs = new ConcurrentQueue<(bool isError, string text)>();
        readonly ConcurrentQueue<string> outgoingLines = new ConcurrentQueue<string>();
        readonly AutoResetEvent outgoingSignal = new AutoResetEvent(false);

        StationGameHost boundHost;
        Canvas overlayCanvas;
        GameObject startupBackdropRoot;
        Image startupBackdrop;
        Image startupCardBorder;
        Image startupCardFill;
        Image startupTrack;
        Image startupBar;
        RectTransform startupCardBorderRect;
        RectTransform startupBarRect;
        Text startupBrandText;
        Text startupTitleText;
        Text startupDetailText;
        RawImage surfaceImage;
        Texture2D surfaceTexture;

        TcpListener listener;
        TcpClient activeClient;
        Process workerProcess;
        CancellationTokenSource sessionCts;
        FileStream shmStream;
        MemoryMappedFile shmFile;
        MemoryMappedViewAccessor shmAccessor;

        sealed class PreparedStandaloneAutosave {
            public StationReadResult Read;
            public StationSimulationSession Session;
        }

        string currentShmPath = "";
        string activeStartupRoute = "";
        bool webReady;
        bool startAttempted;
        bool launchedInBenchmarkMode;
        bool pendingStandaloneAutosaveRestore;
        bool autosaveInstallInFlight;
        int autosaveInstallAfterPresentFrame = -1;
        double firstUpdateAt = -1.0;
        Task<PreparedStandaloneAutosave> autosaveReadTask;
        Coroutine autosaveInstallCoroutine;
        int lastAutosavedRevision = -1;
        int preBenchmarkRevision = -1;
        double nextAutosaveAt;
        long lastUploadedSequence;
        int lastUploadFrame = -1;
        int presentedFrames;
        int lastSentWidth;
        int lastSentHeight;
        string lastCapturedPreviewPath = "";

        Vector2 lastMousePos = new Vector2(-1f, -1f);
        int heldMouseButtons;
        double lastLeftClickTime = -10.0;
        Vector2 lastLeftClickPos;
        bool mouseWasInside;
        volatile string desiredCursor = "default";
        volatile float desiredCursorScale = 1f;
        volatile bool nativeModalDialogOpen;
        string appliedCursor = "default";
        int appliedCursorSize = StationDesktopCursors.Size;
        bool cursorHiddenByOverlay;

        public bool IsWorkerRunning => workerProcess != null && !workerProcess.HasExited;
        public bool IsWebReady => webReady;

        /// <summary>
        /// When true (`-metroBenchOut`), ignores physical OS mouse/keyboard polling so synthetic
        /// benchmark pointer gestures are never perturbed by ambient cursor movement while keeping
        /// the full WebView2 RawImage overlay visible and composited every frame.
        /// </summary>
        public bool SuppressPhysicalInput { get; set; }
        public int PresentedFrameCount => presentedFrames;
        public int TextureWidth => surfaceTexture != null ? surfaceTexture.width : 0;
        public int TextureHeight => surfaceTexture != null ? surfaceTexture.height : 0;
        public string LastCapturedPreviewPath => lastCapturedPreviewPath;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Bootstrap() {
            if (!Application.isPlaying || Application.isBatchMode) return;
            EnsureWatcher();
        }

        static void EnsureWatcher() {
            if (activeInstance != null) return;
            var existing = FindObjectsByType<StationDesktopUiPresenter>();
            if (existing != null && existing.Length > 0) {
                activeInstance = existing[0];
                for (int i = 1; i < existing.Length; i++) {
                    if (existing[i] != null) Destroy(existing[i].gameObject);
                }
                // A stale canvas whose presenter was already gone has no owner left: drop it so
                // the adopted presenter is the only layer drawing the React UI.
                DestroyOtherCanvases(activeInstance);
                return;
            }
            var go = new GameObject("StationDesktopUiPresenter") {
                hideFlags = HideFlags.DontSave,
            };
            DontDestroyOnLoad(go);
            activeInstance = go.AddComponent<StationDesktopUiPresenter>();
        }

        /// <summary>
        /// Destroy every overlay canvas that is not the one <paramref name="keep"/> owns. The
        /// check runs only on the rare paths that build or adopt the presenter (a scene load, a
        /// worker restart, a smoke toggle), never per frame.
        /// </summary>
        static void DestroyOtherCanvases(StationDesktopUiPresenter keep) {
            var canvases = FindObjectsByType<Canvas>(FindObjectsSortMode.None);
            int kept = 0;
            for (int i = 0; i < canvases.Length; i++) {
                var canvas = canvases[i];
                if (canvas == null || !string.Equals(canvas.gameObject.name, CanvasName, StringComparison.Ordinal)) continue;
                if (keep != null && keep.overlayCanvas == canvas) { kept++; continue; }
                Destroy(canvas.gameObject);
            }
            if (kept > 1) {
                UnityEngine.Debug.LogWarning("[ReactUI] More than one in-canvas React UI overlay is present; " +
                    kept + " layers would draw the same UI twice.");
            }
        }

        /// <summary>
        /// How many in-canvas React UI layers exist right now. An automated check can assert
        /// exactly one after repeated switches, an overlay reload and a resize (plan 29 §4).
        /// </summary>
        public static int OverlayCanvasCount() {
            var canvases = FindObjectsByType<Canvas>(FindObjectsSortMode.None);
            int count = 0;
            for (int i = 0; i < canvases.Length; i++) {
                if (canvases[i] != null && string.Equals(canvases[i].gameObject.name, CanvasName, StringComparison.Ordinal)) count++;
            }
            return count;
        }

        void Awake() {
            if (activeInstance != null && activeInstance != this) {
                Destroy(gameObject);
                return;
            }
            activeInstance = this;
            BuildCanvas();
            SubscribeKeyboardText();
            InputSystem.onEvent += OnMouseButtonEvent;
            // Launch the offscreen WebView2 host (and background autosave parse) eagerly during
            // AfterSceneLoad while Unity's splash logo is still playing so #game-loading is
            // ready immediately once the logo finishes.
            TryBindAndStartWorker();
        }

        void OnDestroy() {
            TryWriteStandaloneAutosave(boundHost, force: true);
            InputSystem.onEvent -= OnMouseButtonEvent;
            UnsubscribeKeyboardText();
            StopWorker();
            ResetOverlayCursor();
            if (activeInstance == this) StationDesktopCursors.DisposeCache();
            if (surfaceTexture != null) {
                Destroy(surfaceTexture);
                surfaceTexture = null;
            }
            if (overlayCanvas != null) {
                Destroy(overlayCanvas.gameObject);
                overlayCanvas = null;
            }
            if (activeInstance == this) activeInstance = null;
        }

        void OnApplicationQuit() {
            TryWriteStandaloneAutosave(boundHost, force: true);
            StopWorker();
            ResetOverlayCursor();
            StationDesktopCursors.DisposeCache();
        }

        void BuildCanvas() {
            // One overlay canvas per player (plan 29 §4). A surviving canvas from a previous
            // Play Mode session, a re-entered scene or an adopted presenter would otherwise
            // draw a second UI frame — two ViewCubes, two depth chips — over this one.
            DestroyOtherCanvases(this);
            var canvasGo = new GameObject(CanvasName) {
                hideFlags = HideFlags.DontSave,
            };
            DontDestroyOnLoad(canvasGo);

            overlayCanvas = canvasGo.AddComponent<Canvas>();
            overlayCanvas.renderMode = RenderMode.ScreenSpaceOverlay;
            overlayCanvas.pixelPerfect = true;
            overlayCanvas.sortingOrder = 32000;
            overlayCanvas.enabled = false;

            // Render the same themed Station Designer loading card natively until WebView2
            // delivers its first painted frame so the loading screen appears immediately
            // after the Unity logo with zero blank dark screen and zero 3D station flash.
            var backdropGo = new GameObject("StartupBackdrop") {
                hideFlags = HideFlags.DontSave,
            };
            backdropGo.transform.SetParent(canvasGo.transform, false);
            startupBackdropRoot = backdropGo;

            var backdropRect = backdropGo.AddComponent<RectTransform>();
            backdropRect.anchorMin = Vector2.zero;
            backdropRect.anchorMax = Vector2.one;
            backdropRect.offsetMin = Vector2.zero;
            backdropRect.offsetMax = Vector2.zero;

            startupBackdrop = backdropGo.AddComponent<Image>();
            startupBackdrop.raycastTarget = false;

            BuildStartupLoadingCard(backdropGo.transform);
            ApplyStartupLoadingTheme(
                PlayerPrefs.GetString(UiThemePreference, "blueprint"),
                IsEnglishStartupLanguage(activeStartupRoute),
                boundHost != null ? boundHost.font : null);
            backdropGo.SetActive(false);

            var surfaceGo = new GameObject("WebViewSurface") {
                hideFlags = HideFlags.DontSave,
            };
            surfaceGo.transform.SetParent(canvasGo.transform, false);

            var rect = surfaceGo.AddComponent<RectTransform>();
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;

            surfaceImage = surfaceGo.AddComponent<RawImage>();
            surfaceImage.raycastTarget = false;
            surfaceImage.color = Color.white;
            // SharedFrameBuffer writes top-down scanlines; flip Y in UV at 0 CPU cost.
            surfaceImage.uvRect = new Rect(0f, 1f, 1f, -1f);
            surfaceImage.enabled = false;
        }

        static float ComputeStartupCardScale(int w, int h) {
            if (w <= 0 || h <= 0) return 1f;
            if (w >= 3200 && h >= 1800) return 1.5f;
            if (w >= 2400 && h >= 1300) return 1.25f;
            if (w >= 1760 && h >= 900) return 1f;
            if (w >= 1500 && h >= 800) return 0.9f;
            if (w >= 1340 && h >= 740) return 0.85f;
            return 0.75f;
        }

        void BuildStartupLoadingCard(Transform parent) {
            float scale = ComputeStartupCardScale(Screen.width, Screen.height);
            float cardW = Mathf.Round(390f * scale);
            float cardH = Mathf.Round(182f * scale);
            float pad = Mathf.Round(28f * scale);

            var borderGo = new GameObject("LoadingCardBorder") { hideFlags = HideFlags.DontSave };
            borderGo.transform.SetParent(parent, false);
            startupCardBorderRect = borderGo.AddComponent<RectTransform>();
            startupCardBorderRect.anchorMin = new Vector2(0.5f, 0.5f);
            startupCardBorderRect.anchorMax = new Vector2(0.5f, 0.5f);
            startupCardBorderRect.pivot = new Vector2(0.5f, 0.5f);
            startupCardBorderRect.sizeDelta = new Vector2(cardW + 2f, cardH + 2f);
            startupCardBorder = borderGo.AddComponent<Image>();
            startupCardBorder.raycastTarget = false;

            var cardGo = new GameObject("LoadingCard") { hideFlags = HideFlags.DontSave };
            cardGo.transform.SetParent(borderGo.transform, false);
            var cardRect = cardGo.AddComponent<RectTransform>();
            cardRect.anchorMin = Vector2.zero;
            cardRect.anchorMax = Vector2.one;
            cardRect.offsetMin = new Vector2(1f, 1f);
            cardRect.offsetMax = new Vector2(-1f, -1f);
            startupCardFill = cardGo.AddComponent<Image>();
            startupCardFill.raycastTarget = false;

            startupBrandText = CreateCardText(cardGo.transform, "Brand", pad, pad, pad, Mathf.Round(18f * scale),
                Mathf.Max(10, Mathf.RoundToInt(11f * scale)), FontStyle.Bold);
            startupBrandText.text = "STATION DESIGNER";

            startupTitleText = CreateCardText(cardGo.transform, "Title", pad, Mathf.Round(62f * scale), pad, Mathf.Round(34f * scale),
                Mathf.Max(16, Mathf.RoundToInt(25f * scale)), FontStyle.Bold);

            startupDetailText = CreateCardText(cardGo.transform, "Detail", pad, Mathf.Round(102f * scale), pad, Mathf.Round(42f * scale),
                Mathf.Max(11, Mathf.RoundToInt(14f * scale)), FontStyle.Normal);

            var trackGo = new GameObject("LoadingTrack") { hideFlags = HideFlags.DontSave };
            trackGo.transform.SetParent(cardGo.transform, false);
            var trackRect = trackGo.AddComponent<RectTransform>();
            trackRect.anchorMin = new Vector2(0f, 0f);
            trackRect.anchorMax = new Vector2(1f, 0f);
            trackRect.pivot = new Vector2(0.5f, 0f);
            trackRect.offsetMin = new Vector2(pad, pad);
            trackRect.offsetMax = new Vector2(-pad, pad + Mathf.Max(3f, Mathf.Round(3f * scale)));
            startupTrack = trackGo.AddComponent<Image>();
            startupTrack.raycastTarget = false;

            var barGo = new GameObject("LoadingBar") { hideFlags = HideFlags.DontSave };
            barGo.transform.SetParent(trackGo.transform, false);
            startupBarRect = barGo.AddComponent<RectTransform>();
            startupBarRect.anchorMin = new Vector2(0f, 0f);
            startupBarRect.anchorMax = new Vector2(0.38f, 1f);
            startupBarRect.offsetMin = Vector2.zero;
            startupBarRect.offsetMax = Vector2.zero;
            startupBar = barGo.AddComponent<Image>();
            startupBar.raycastTarget = false;
        }

        static Text CreateCardText(Transform parent, string name, float padLeft, float topOffset, float padRight, float height, int fontSize, FontStyle style) {
            var go = new GameObject(name) { hideFlags = HideFlags.DontSave };
            go.transform.SetParent(parent, false);
            var rect = go.AddComponent<RectTransform>();
            rect.anchorMin = new Vector2(0f, 1f);
            rect.anchorMax = new Vector2(1f, 1f);
            rect.pivot = new Vector2(0.5f, 1f);
            rect.offsetMin = new Vector2(padLeft, -(topOffset + height));
            rect.offsetMax = new Vector2(-padRight, -topOffset);
            var text = go.AddComponent<Text>();
            text.raycastTarget = false;
            text.fontSize = fontSize;
            text.fontStyle = style;
            text.alignment = TextAnchor.UpperLeft;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Overflow;
            return text;
        }

        static bool IsEnglishStartupLanguage(string route) {
            if (!string.IsNullOrWhiteSpace(route)) {
                string[] parts = route.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
                for (int i = 0; i < parts.Length; i++) {
                    if (string.Equals(parts[i], "en", StringComparison.OrdinalIgnoreCase)) return true;
                }
            }
            string saved = PlayerPrefs.GetString(UiLanguagePreference, "");
            return string.Equals(saved, "en", StringComparison.OrdinalIgnoreCase);
        }

        void ApplyStartupLoadingTheme(string theme, bool english, Font font) {
            string normalized = NormalizeUiTheme(theme);
            Color bg, card, border, brand, title, detail, track, bar;
            switch (normalized) {
                case "site":
                    bg = new Color32(0x07, 0x0a, 0x10, 0xff);
                    card = new Color32(0x11, 0x17, 0x20, 0xff);
                    border = new Color32(0x30, 0x3b, 0x49, 0xff);
                    brand = new Color32(0xf2, 0xb3, 0x2c, 0xff);
                    title = new Color32(0xee, 0xf3, 0xf9, 0xff);
                    detail = new Color32(0x9a, 0xb5, 0xcb, 0xff);
                    track = new Color32(0x30, 0x3b, 0x49, 0xff);
                    bar = new Color32(0xf2, 0xb3, 0x2c, 0xff);
                    break;
                case "studio":
                    bg = new Color32(0xf4, 0xf3, 0xed, 0xff);
                    card = new Color32(0xfd, 0xfe, 0xf9, 0xff);
                    border = new Color32(0xd8, 0xdb, 0xce, 0xff);
                    brand = new Color32(0xb9, 0x4d, 0x29, 0xff);
                    title = new Color32(0x30, 0x3a, 0x30, 0xff);
                    detail = new Color32(0x68, 0x73, 0x63, 0xff);
                    track = new Color32(0xe1, 0xe7, 0xd9, 0xff);
                    bar = new Color32(0xc9, 0x4d, 0x24, 0xff);
                    break;
                default:
                    bg = new Color32(0x06, 0x11, 0x1d, 0xff);
                    card = new Color32(0x0b, 0x1b, 0x2c, 0xff);
                    border = new Color32(0x31, 0x57, 0x76, 0xff);
                    brand = new Color32(0x8f, 0xc4, 0xee, 0xff);
                    title = new Color32(0xd6, 0xe7, 0xf7, 0xff);
                    detail = new Color32(0x9a, 0xb5, 0xcb, 0xff);
                    track = new Color32(0x1d, 0x3b, 0x58, 0xff);
                    bar = new Color32(0x55, 0xb6, 0xff, 0xff);
                    break;
            }
            if (startupBackdrop != null) startupBackdrop.color = bg;
            if (startupCardBorder != null) startupCardBorder.color = border;
            if (startupCardFill != null) startupCardFill.color = card;
            if (startupTrack != null) startupTrack.color = track;
            if (startupBar != null) startupBar.color = bar;

            Font resolvedFont = font != null ? font : Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (startupBrandText != null) {
                startupBrandText.color = brand;
                if (resolvedFont != null) startupBrandText.font = resolvedFont;
            }
            if (startupTitleText != null) {
                startupTitleText.color = title;
                startupTitleText.text = english ? "Preparing your station" : "正在准备车站";
                if (resolvedFont != null) startupTitleText.font = resolvedFont;
            }
            if (startupDetailText != null) {
                startupDetailText.color = detail;
                startupDetailText.text = english
                    ? "Connecting to Unity Studio and building your station."
                    : "正在连接 Unity Studio 并构建车站，请稍候。";
                if (resolvedFont != null) startupDetailText.font = resolvedFont;
            }
        }

        void AnimateStartupLoadingBar() {
            if (startupBarRect == null || startupBackdropRoot == null || !startupBackdropRoot.activeSelf) return;
            // Mirrors CSS `@keyframes loading-sweep` (1.5s ease-in-out infinite alternate, 38% width).
            float phase = Mathf.PingPong((float)(Time.unscaledTimeAsDouble / 1.5), 1f);
            float eased = phase * phase * (3f - 2f * phase);
            float minX = eased * 0.62f;
            startupBarRect.anchorMin = new Vector2(minX, 0f);
            startupBarRect.anchorMax = new Vector2(minX + 0.38f, 1f);
        }

        internal static string NormalizeUiTheme(string theme) {
            if (string.Equals(theme, "site", StringComparison.OrdinalIgnoreCase)) return "site";
            if (string.Equals(theme, "studio", StringComparison.OrdinalIgnoreCase)) return "studio";
            return "blueprint";
        }

        internal static Color ResolveStartupBackdropColor(string theme) {
            switch (NormalizeUiTheme(theme)) {
                case "site": return new Color32(0x07, 0x0a, 0x10, 0xff);
                case "studio": return new Color32(0xf4, 0xf3, 0xed, 0xff);
                default: return new Color32(0x06, 0x11, 0x1d, 0xff);
            }
        }

        internal static string DemoIdForRoute(string route) {
            if (string.IsNullOrWhiteSpace(route)) return null;
            string clean = route.Trim().Trim('/');
            if (clean.Length == 0) return null;
            int lastSlash = clean.LastIndexOf('/');
            string last = lastSlash >= 0 ? clean.Substring(lastSlash + 1) : clean;
            if (string.Equals(last, "game", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(last, "en", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(last, "benchmark", StringComparison.OrdinalIgnoreCase)) {
                return null;
            }
            return last;
        }

        void RefreshCanvasVisibility() {
            bool canShowOverlay = userEnabled && !smokeSuppressed && boundHost != null;
            bool showSurface = canShowOverlay && presentedFrames > 0;
            bool showBackdrop = canShowOverlay && !showSurface && IsWorkerRunning &&
                !launchedInBenchmarkMode && !IsBenchmarkRoute(activeStartupRoute);
            bool showCanvas = showSurface || showBackdrop;
            if (overlayCanvas != null && overlayCanvas.enabled != showCanvas) {
                overlayCanvas.enabled = showCanvas;
            }
            if (startupBackdropRoot != null && startupBackdropRoot.activeSelf != showBackdrop) {
                startupBackdropRoot.SetActive(showBackdrop);
            }
            if (surfaceImage != null && surfaceImage.enabled != showSurface) {
                surfaceImage.enabled = showSurface;
            }
            if (!showSurface) ResetOverlayCursor();
        }

        void TryBindAndStartWorker() {
            if (!Application.isPlaying || Application.isBatchMode || !userEnabled || IsAutomatedTestScene()) return;
            if (boundHost == null || !boundHost.isActiveAndEnabled) {
                var candidate = FindAnyObjectByType<StationGameHost>();
                if (candidate == null || !candidate.isActiveAndEnabled) return;
                boundHost = candidate;
                startAttempted = false;
            }
            if (!startAttempted && workerProcess == null) {
                StartWorkerForHost(boundHost);
            }
        }

        void Update() {
            if (workerProcess != null && firstUpdateAt < 0.0) {
                firstUpdateAt = Time.unscaledTimeAsDouble;
            }
            UploadLatestSharedFrame();
            DrainIncomingQueues();

            if (!Application.isPlaying || Application.isBatchMode || !userEnabled) {
                if (workerProcess != null || listener != null) StopWorker();
                return;
            }

            if (IsAutomatedTestScene()) {
                if (workerProcess != null || listener != null) StopWorker();
                return;
            }

            if (boundHost == null || !boundHost.isActiveAndEnabled) {
                if (boundHost != null) StopWorker();
                var candidate = FindAnyObjectByType<StationGameHost>();
                if (candidate == null || !candidate.isActiveAndEnabled) return;
                boundHost = candidate;
                startAttempted = false;
            }

            if (!startAttempted && workerProcess == null) {
                StartWorkerForHost(boundHost);
            }

            if (workerProcess != null && workerProcess.HasExited) {
                int exit = 0;
                try { exit = workerProcess.ExitCode; } catch { }
                if (exit != 0) {
                    UnityEngine.Debug.LogError($"[ReactUI] Offscreen UI worker exited with code {exit}.");
                }
                StopWorker(clearHost: false);
                startAttempted = true;
                return;
            }

            SyncViewportSize();
            if (!smokeSuppressed && !SuppressPhysicalInput && !nativeModalDialogOpen) {
                ForwardMouseInput();
                ForwardKeyboardButtons();
            }
            ApplyOverlayCursor();
            UploadLatestSharedFrame();
            if (boundHost != null && IsStandaloneAutosaveInstallReady()) {
                CompletePendingStandaloneAutosave(boundHost);
            }
            AnimateStartupLoadingBar();
            if (Time.unscaledTimeAsDouble >= nextAutosaveAt) {
                nextAutosaveAt = Time.unscaledTimeAsDouble + 15.0;
                TryWriteStandaloneAutosave(boundHost, force: false);
            }
        }

        void LateUpdate() {
            UploadLatestSharedFrame();
        }

        static bool IsAutomatedTestScene() {
            var activeScene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            if (!activeScene.IsValid()) return false;
            foreach (var root in activeScene.GetRootGameObjects()) {
                if (root != null && root.name.IndexOf("TestRunner", StringComparison.OrdinalIgnoreCase) >= 0) {
                    return true;
                }
            }
            return false;
        }

        (string exePath, string uiDir, string publicDir, string logDir) ResolvePaths() {
            if (PathResolver != null) {
                return PathResolver();
            }
            string baseDir = Path.Combine(Application.streamingAssetsPath, "MetroUi");
            string exe = Path.Combine(baseDir, "bin", "MetroEditorWebView.exe");
            string ui = Path.Combine(baseDir, "ui");
            string pub = Path.Combine(baseDir, "public");
            string log = Path.Combine(Application.persistentDataPath, "MetroUi");
            return (exe, ui, pub, log);
        }

        void StartWorkerForHost(StationGameHost host) {
            startAttempted = true;
            var (exePath, uiDir, publicDir, logDir) = ResolvePaths();
            if (string.IsNullOrEmpty(exePath) || !File.Exists(exePath)) {
                UnityEngine.Debug.LogWarning("[ReactUI] Offscreen UI host binary not found at: " + exePath);
                return;
            }
            if (string.IsNullOrEmpty(uiDir) || !File.Exists(Path.Combine(uiDir, ".vite", "manifest.json"))) {
                UnityEngine.Debug.LogWarning("[ReactUI] Built React UI manifest not found under: " + uiDir);
                return;
            }

            Application.runInBackground = true;

            boundHost = host;
            boundHost.ReplyPublished -= OnHostReplyPublished;
            boundHost.ReplyPublished += OnHostReplyPublished;

            webReady = false;
            lastUploadedSequence = 0;
            presentedFrames = 0;
            lastSentWidth = Mathf.Clamp(Screen.width, 64, ShmMaxWidth);
            lastSentHeight = Mathf.Clamp(Screen.height, 64, ShmMaxHeight);
            RefreshCanvasVisibility();

            int selfPid = Process.GetCurrentProcess().Id;
            string shmDir = !string.IsNullOrWhiteSpace(logDir) ? logDir : Path.GetTempPath();
            Directory.CreateDirectory(shmDir);
            currentShmPath = Path.Combine(shmDir, $"shm-{selfPid}-{Guid.NewGuid():N}.bin");
            shmStream = new FileStream(currentShmPath, FileMode.Create, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete);
            shmStream.SetLength(ShmTotalBytes);
            shmFile = MemoryMappedFile.CreateFromFile(shmStream, null, ShmTotalBytes, MemoryMappedFileAccess.ReadWrite, HandleInheritability.None, leaveOpen: true);
            shmAccessor = shmFile.CreateViewAccessor(0, ShmTotalBytes, MemoryMappedFileAccess.Read);

            sessionCts = new CancellationTokenSource();
            listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var token = sessionCts.Token;
            _ = Task.Run(() => RunServerLoopAsync(listener, token));

            string[] cliArgs = Environment.GetCommandLineArgs();
            string cliRoute = ParseCommandLineRoute(cliArgs);
            launchedInBenchmarkMode = IsBenchmarkRoute(cliRoute) || HasBenchmarkOutputArg(cliArgs);
            bool wantsAutosaveRestore = !Application.isEditor && !Application.isBatchMode &&
                !launchedInBenchmarkMode && string.IsNullOrEmpty(cliRoute) &&
                !IsBenchmarkRoute(startupRoute) && !host.IsLoaded &&
                HasStandaloneAutosaveCandidate();
            string route = !string.IsNullOrEmpty(cliRoute)
                ? cliRoute
                : ((host.IsLoaded || wantsAutosaveRestore) && !IsBenchmarkRoute(startupRoute) ? "/game/" : startupRoute);
            activeStartupRoute = route;
            pendingStandaloneAutosaveRestore = false;
            var startInfo = new ProcessStartInfo {
                FileName = exePath,
                Arguments =
                    $"--port {port} --unity-pid {selfPid} --shm \"{currentShmPath}\" " +
                    $"--width {lastSentWidth} --height {lastSentHeight} " +
                    $"--ui-dir \"{uiDir}\" --public-dir \"{publicDir}\" --log-dir \"{logDir}\" --route \"{route}\"",
                WorkingDirectory = Path.GetDirectoryName(exePath) ?? Environment.CurrentDirectory,
                UseShellExecute = false,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };

            try {
                var proc = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
                proc.ErrorDataReceived += (_, e) => {
                    if (!string.IsNullOrWhiteSpace(e.Data)) {
                        incomingLogs.Enqueue((true, "[ReactUI] " + e.Data));
                    }
                };
                if (!proc.Start()) {
                    UnityEngine.Debug.LogError("[ReactUI] Could not start offscreen MetroEditorWebView worker.");
                    StopWorker();
                    return;
                }
                proc.BeginErrorReadLine();
                workerProcess = proc;
                AllowWorkerForeground();
                firstUpdateAt = -1.0;
                autosaveInstallAfterPresentFrame = -1;
                // Parse and index the standalone autosave off the main thread while Unity's logo
                // and MetroEditorWebView.exe boot, then install once the loading screen is visible.
                if (wantsAutosaveRestore) {
                    string autosavePath = StandaloneAutosavePath();
                    autosaveReadTask = Task.Run(() => ReadStandaloneAutosaveInBackground(autosavePath));
                    pendingStandaloneAutosaveRestore = true;
                }
                ApplyStartupLoadingTheme(
                    PlayerPrefs.GetString(UiThemePreference, "blueprint"),
                    IsEnglishStartupLanguage(route),
                    host.font);
                RefreshCanvasVisibility();
                UnityEngine.Debug.Log($"[ReactUI] Rendering Station Designer React UI in-canvas ({lastSentWidth}x{lastSentHeight}, route={route}).");
            } catch (Exception ex) {
                UnityEngine.Debug.LogError("[ReactUI] Failed to launch offscreen UI worker: " + ex.Message);
                StopWorker();
            }
        }

        public void RestartWorker() {
            var currentHost = boundHost;
            StopWorker();
            boundHost = currentHost;
            startAttempted = false;
        }

        static bool HasStandaloneAutosaveCandidate() {
            try {
                string path = StandaloneAutosavePath();
                return File.Exists(path) && new FileInfo(path).Length > 0;
            } catch {
                return false;
            }
        }

        static PreparedStandaloneAutosave ReadStandaloneAutosaveInBackground(string path) {
            try {
                if (string.IsNullOrEmpty(path) || !File.Exists(path)) return null;
                string json = File.ReadAllText(path, Encoding.UTF8);
                if (string.IsNullOrWhiteSpace(json)) return null;
                var read = StationDocumentReader.Read(json, new StationSource("autosave", ""));
                if (read == null || read.Document == null || read.Index == null) return null;
                StationSimulationSession session = null;
                try {
                    var setup = StationSessionProjection.Setup(
                        read.Document,
                        read.Index,
                        "sim-" + (read.Document.Source.Hash ?? ""));
                    session = new StationSimulationSession(setup);
                } catch {
                    // Fall back to main-thread simulation staging if background build throws.
                }
                return new PreparedStandaloneAutosave {
                    Read = read,
                    Session = session,
                };
            } catch {
                return null;
            }
        }

        bool IsStandaloneAutosaveInstallReady() {
            if (!pendingStandaloneAutosaveRestore || autosaveInstallInFlight) return false;
            if (autosaveReadTask != null && !autosaveReadTask.IsCompleted) return false;
            if (presentedFrames > 0 && autosaveInstallAfterPresentFrame >= 0 && Time.frameCount >= autosaveInstallAfterPresentFrame) {
                return true;
            }
            return firstUpdateAt >= 0.0 && Time.frameCount >= 2 && (Time.unscaledTimeAsDouble - firstUpdateAt) >= 1.5;
        }

        void CompletePendingStandaloneAutosave(StationGameHost host) {
            if (!pendingStandaloneAutosaveRestore || autosaveInstallInFlight) return;
            var readTask = autosaveReadTask;
            autosaveReadTask = null;
            pendingStandaloneAutosaveRestore = false;
            if (host == null || host.IsLoaded) return;
            PreparedStandaloneAutosave prepared = readTask != null && readTask.Status == TaskStatus.RanToCompletion
                ? readTask.Result
                : null;
            if (prepared != null && prepared.Read != null && isActiveAndEnabled) {
                autosaveInstallInFlight = true;
                autosaveInstallCoroutine = StartCoroutine(RunStandaloneAutosaveInstall(host, prepared));
                return;
            }
            bool restored = readTask == null && TryRestoreStandaloneAutosave(host);
            if (!restored) {
                string fallbackDemo = DemoIdForRoute(startupRoute);
                if (!string.IsNullOrEmpty(fallbackDemo)) {
                    host.OpenDemo(fallbackDemo);
                }
            }
        }

        IEnumerator RunStandaloneAutosaveInstall(StationGameHost host, PreparedStandaloneAutosave prepared) {
            StationLoadResult result = null;
            try {
                var enumerator = host.OpenPreReadDocumentYielded(prepared.Read, prepared.Session, "autosave", r => result = r);
                while (enumerator.MoveNext()) {
                    yield return enumerator.Current;
                    if (host == null || !isActiveAndEnabled) yield break;
                }
                if (result != null && result.Accepted) {
                    lastAutosavedRevision = host.CurrentRevision;
                    UnityEngine.Debug.Log($"[ReactUI] Restored standalone station autosave ({StandaloneAutosavePath()}, rev={lastAutosavedRevision}).");
                } else {
                    string fallbackDemo = DemoIdForRoute(startupRoute);
                    if (!string.IsNullOrEmpty(fallbackDemo)) {
                        host.OpenDemo(fallbackDemo);
                    }
                }
            } finally {
                autosaveInstallInFlight = false;
                autosaveInstallCoroutine = null;
            }
        }

        bool TryRestoreStandaloneAutosave(StationGameHost host) {
            if (host == null) return false;
            try {
                string path = StandaloneAutosavePath();
                if (!File.Exists(path)) return false;
                string json = File.ReadAllText(path, Encoding.UTF8);
                if (string.IsNullOrWhiteSpace(json)) return false;
                var result = host.OpenDocument(json, "autosave");
                if (result != null && result.Accepted) {
                    lastAutosavedRevision = host.CurrentRevision;
                    UnityEngine.Debug.Log($"[ReactUI] Restored standalone station autosave ({path}, rev={lastAutosavedRevision}).");
                    return true;
                }
            } catch (Exception ex) {
                UnityEngine.Debug.LogWarning("[ReactUI] Could not restore standalone autosave: " + ex.Message);
            }
            return false;
        }

        void TryWriteStandaloneAutosave(StationGameHost host, bool force) {
            if (Application.isEditor || Application.isBatchMode) return;
            if (launchedInBenchmarkMode || StationBenchmarkRecorder.InBenchmarkUi || StationBenchmarkRecorder.IsRecordingAny) return;
            if (host == null || !host.IsLoaded || host.Document == null) return;
            int rev = host.CurrentRevision;
            if (!force && rev == lastAutosavedRevision) return;
            if (force && rev == lastAutosavedRevision && File.Exists(StandaloneAutosavePath())) return;
            try {
                string json = host.SaveDocument();
                if (string.IsNullOrWhiteSpace(json)) return;
                string path = StandaloneAutosavePath();
                string dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                string tmp = path + ".tmp";
                File.WriteAllText(tmp, json, new UTF8Encoding(false));
                File.Copy(tmp, path, overwrite: true);
                try { File.Delete(tmp); } catch { }
                lastAutosavedRevision = rev;
            } catch (Exception ex) {
                UnityEngine.Debug.LogWarning("[ReactUI] Could not write standalone autosave: " + ex.Message);
            }
        }

        public void StopWorker(bool clearHost = true) {
            if (boundHost != null) {
                boundHost.ReplyPublished -= OnHostReplyPublished;
                if (clearHost) boundHost = null;
            }
            var proc = workerProcess;
            workerProcess = null;
            var client = activeClient;
            activeClient = null;

            if (autosaveInstallCoroutine != null) {
                StopCoroutine(autosaveInstallCoroutine);
                autosaveInstallCoroutine = null;
            }
            webReady = false;
            pendingStandaloneAutosaveRestore = false;
            autosaveInstallInFlight = false;
            autosaveReadTask = null;
            firstUpdateAt = -1.0;
            autosaveInstallAfterPresentFrame = -1;
            activeStartupRoute = "";
            lastUploadedSequence = 0;
            presentedFrames = 0;
            heldMouseButtons = 0;
            nativeModalDialogOpen = false;
            desiredCursor = "default";
            ResetOverlayCursor();
            Array.Clear(keyRepeatAt, 0, keyRepeatAt.Length);
            RefreshCanvasVisibility();

            while (incomingCommands.TryDequeue(out _)) { }
            while (outgoingLines.TryDequeue(out _)) { }

            // Ask WebView2 to shut down cleanly first so Chromium flushes localStorage
            // (settings, theme, audio, tutorial dismissal) to disk before exit.
            if (proc != null && !proc.HasExited) {
                if (client != null && client.Connected) {
                    try {
                        byte[] quitMsg = Encoding.UTF8.GetBytes("{\"kind\":\"quit\"}\n");
                        var stream = client.GetStream();
                        stream.Write(quitMsg, 0, quitMsg.Length);
                        stream.Flush();
                    } catch { }
                }
                try { proc.WaitForExit(1000); } catch { }
            }

            try { sessionCts?.Cancel(); } catch { }
            sessionCts = null;

            try { client?.Close(); } catch { }

            try { listener?.Stop(); } catch { }
            listener = null;

            if (proc != null) {
                try { if (!proc.HasExited) proc.Kill(); } catch { }
                try { proc.Dispose(); } catch { }
            }

            try { shmAccessor?.Dispose(); } catch { }
            shmAccessor = null;
            try { shmFile?.Dispose(); } catch { }
            shmFile = null;
            try { shmStream?.Dispose(); } catch { }
            shmStream = null;
            if (!string.IsNullOrEmpty(currentShmPath)) {
                try { if (File.Exists(currentShmPath)) File.Delete(currentShmPath); } catch { }
                currentShmPath = "";
            }
        }

        // ------------------------------------------------------------------ shared-memory texture upload

        void UploadLatestSharedFrame() {
            if (shmAccessor == null || surfaceImage == null) return;
            // Never upload two full-screen BGRA textures in the same Unity frame.
            int frameNow = Time.frameCount;
            if (presentedFrames > 0 && lastUploadFrame == frameNow) return;
            int magic = shmAccessor.ReadInt32(0);
            if (magic != ShmMagic) return;

            long seq = shmAccessor.ReadInt64(8);
            if (seq <= 0 || seq == lastUploadedSequence) return;

            long t0 = StationBenchmarkRecorder.IsBreakdownProfiling ? Stopwatch.GetTimestamp() : 0;

            int slot = shmAccessor.ReadInt32(4);
            if (slot != 0 && slot != 1) return;

            int metaOffset = slot == 0 ? 16 : 32;
            int w = shmAccessor.ReadInt32(metaOffset + 0);
            int h = shmAccessor.ReadInt32(metaOffset + 4);
            int byteLen = shmAccessor.ReadInt32(metaOffset + 8);
            if (w < 32 || h < 32 || w > ShmMaxWidth || h > ShmMaxHeight || byteLen != w * h * 4) return;

            if (surfaceTexture == null || surfaceTexture.width != w || surfaceTexture.height != h) {
                if (surfaceTexture != null) Destroy(surfaceTexture);
                surfaceTexture = new Texture2D(w, h, TextureFormat.BGRA32, mipChain: false, linear: false) {
                    name = "StationReactUiSurface",
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = (w == Screen.width && h == Screen.height) ? FilterMode.Point : FilterMode.Bilinear,
                };
                surfaceImage.texture = surfaceTexture;
            } else {
                var desiredFilter = (w == Screen.width && h == Screen.height) ? FilterMode.Point : FilterMode.Bilinear;
                if (surfaceTexture.filterMode != desiredFilter) surfaceTexture.filterMode = desiredFilter;
            }

            var safeHandle = shmAccessor.SafeMemoryMappedViewHandle;
            IntPtr basePtr = safeHandle.DangerousGetHandle();
            if (basePtr == IntPtr.Zero) return;

            long offset = shmAccessor.PointerOffset + ShmHeaderBytes + (long)slot * ShmSlotStrideBytes;
            IntPtr slotPtr = new IntPtr(basePtr.ToInt64() + offset);
            surfaceTexture.LoadRawTextureData(slotPtr, byteLen);
            surfaceTexture.Apply(false, false);

            lastUploadedSequence = seq;
            lastUploadFrame = frameNow;
            presentedFrames++;
            if (presentedFrames == 1 && autosaveInstallAfterPresentFrame < 0) {
                autosaveInstallAfterPresentFrame = Time.frameCount + 1;
            }
            RefreshCanvasVisibility();
            if (t0 != 0) StationBenchmarkRecorder.RecordUiUploadTicks(Stopwatch.GetTimestamp() - t0, uploaded: true);
        }

        void SyncViewportSize() {
            if (activeClient == null) return;
            int w = Mathf.Clamp(Screen.width, 64, ShmMaxWidth);
            int h = Mathf.Clamp(Screen.height, 64, ShmMaxHeight);
            if (w == lastSentWidth && h == lastSentHeight) return;
            lastSentWidth = w;
            lastSentHeight = h;
            EnqueueToWorker(new JObject {
                ["kind"] = "resize",
                ["w"] = w,
                ["h"] = h,
            }.ToString(Formatting.None));
        }

        public void RequestPreviewCapture(string fullPngPath) {
            lastCapturedPreviewPath = "";
            EnqueueToWorker(new JObject {
                ["kind"] = "capturePreview",
                ["path"] = fullPngPath,
            }.ToString(Formatting.None));
        }

        // ------------------------------------------------------------------ InputSystem -> WebView2 forwarding

        void OnMouseButtonEvent(InputEventPtr inputEvent, InputDevice device) {
            if (!webReady || activeClient == null || !isActiveAndEnabled ||
                smokeSuppressed || SuppressPhysicalInput || nativeModalDialogOpen ||
                device is not Mouse mouse || mouse != Mouse.current) return;

            int previous =
                (mouse.leftButton.isPressed ? 1 : 0) |
                (mouse.rightButton.isPressed ? 2 : 0) |
                (mouse.middleButton.isPressed ? 4 : 0);
            int next =
                (ReadButton(mouse.leftButton, inputEvent) ? 1 : 0) |
                (ReadButton(mouse.rightButton, inputEvent) ? 2 : 0) |
                (ReadButton(mouse.middleButton, inputEvent) ? 4 : 0);
            if (previous == next) return;

            // Button edges own their event coordinates. Sampling the mouse once per
            // frame can place a press at a later move's location, outside the control.
            Vector2 pos = mouse.position.ReadValueFromEvent(inputEvent, out var eventPosition)
                ? eventPosition : mouse.position.ReadValue();
            bool inside = GetMouseCoordinates(pos, out double rx, out double ry);
            if (!inside && heldMouseButtons == 0) return;
            mouseWasInside = inside;
            int mods = CurrentModifiers();
            // Deliver final drag motion before the release clears the held bit.
            ForwardMouseMove(pos, rx, ry, heldMouseButtons, mods);
            ForwardMouseButton(1, "left", previous, next, inside, pos, rx, ry, mods);
            ForwardMouseButton(2, "right", previous, next, inside, pos, rx, ry, mods);
            ForwardMouseButton(4, "middle", previous, next, inside, pos, rx, ry, mods);
        }

        static bool ReadButton(ButtonControl button, InputEventPtr inputEvent) =>
            button.ReadValueFromEvent(inputEvent, out float value)
                ? value >= button.pressPointOrDefault : button.isPressed;

        void ForwardMouseButton(int bit, string button, int previous, int next, bool inside,
            Vector2 pos, double rx, double ry, int mods) {
            if (((previous ^ next) & bit) == 0) return;
            if ((next & bit) != 0) {
                if (!inside) return;
                heldMouseButtons |= bit;
                int clicks = 1;
                if (bit == 1) {
                    double now = Time.unscaledTimeAsDouble;
                    clicks = (now - lastLeftClickTime <= 0.35 && (pos - lastLeftClickPos).sqrMagnitude <= 36f) ? 2 : 1;
                    lastLeftClickTime = clicks == 2 ? -10.0 : now;
                    lastLeftClickPos = pos;
                }
                SendMouse("down", rx, ry, button, heldMouseButtons, mods, clicks, 0, 0);
            } else if ((heldMouseButtons & bit) != 0) {
                heldMouseButtons &= ~bit;
                SendMouse("up", rx, ry, button, heldMouseButtons, mods, 1, 0, 0);
            }
        }

        bool GetMouseCoordinates(Vector2 pos, out double rx, out double ry) {
            float sw = Mathf.Max(1f, Screen.width);
            float sh = Mathf.Max(1f, Screen.height);
            rx = (pos.x / sw) * lastSentWidth;
            ry = ((sh - pos.y) / sh) * lastSentHeight;
            return pos.x >= 0f && pos.x < sw && pos.y >= 0f && pos.y < sh;
        }

        static string HeldButtonName(int buttons) {
            if ((buttons & 1) != 0) return "left";
            if ((buttons & 2) != 0) return "right";
            if ((buttons & 4) != 0) return "middle";
            return "none";
        }

        void ForwardMouseMove(Vector2 pos, double rx, double ry, int buttons, int mods) {
            if ((pos - lastMousePos).sqrMagnitude < 0.25f) return;
            lastMousePos = pos;
            // CDP Input.dispatchMouseEvent needs the active held button on mouseMoved so
            // Blink keeps native scrollbar, range slider and setPointerCapture drags alive
            // (DOM pointermove still reports button === -1 and buttons === mask).
            SendMouse("move", rx, ry, HeldButtonName(buttons), buttons, mods, 0, 0, 0);
        }

        void ForwardMouseInput() {
            if (!webReady || activeClient == null) return;
            var mouse = Mouse.current;
            if (mouse == null) return;

            Vector2 pos = mouse.position.ReadValue();
            bool inside = GetMouseCoordinates(pos, out double rx, out double ry);
            int mods = CurrentModifiers();
            int currentMask =
                (mouse.leftButton.isPressed ? 1 : 0) |
                (mouse.rightButton.isPressed ? 2 : 0) |
                (mouse.middleButton.isPressed ? 4 : 0);
            // A release lost on focus/device change must not leave a stale hold.
            heldMouseButtons &= currentMask;
            if (!inside && heldMouseButtons == 0) {
                if (mouseWasInside) {
                    mouseWasInside = false;
                    lastMousePos = new Vector2(-1f, -1f);
                    SendMouse("move", -100, -100, "none", 0, mods, 0, 0, 0);
                }
                return;
            }
            mouseWasInside = inside;
            ForwardMouseMove(pos, rx, ry, currentMask, mods);

            if (inside) {
                Vector2 scroll = mouse.scroll.ReadValue();
                if (Mathf.Abs(scroll.x) > 0.01f || Mathf.Abs(scroll.y) > 0.01f) {
                    // Unity scroll.y > 0 is wheel-up; DOM WheelEvent.deltaY < 0 is wheel-up.
                    double dx = NormalizeWheelDelta(scroll.x);
                    double dy = -NormalizeWheelDelta(scroll.y);
                    SendMouse("wheel", rx, ry, "none", heldMouseButtons, mods, 0, dx, dy);
                }
            }
        }

        static double NormalizeWheelDelta(float raw) {
            if (Mathf.Abs(raw) < 0.01f) return 0.0;
            // On Windows, InputSystem Mouse.scroll is typically ±120 per notch; if normalized (±1), scale to ±100.
            return Mathf.Abs(raw) <= 10f ? raw * 100.0 : raw * (100.0 / 120.0);
        }

        public void SendSyntheticMouse(string ev, double x, double y, string button = "none", int buttons = 0, int modifiers = 0, int clicks = 0, double dx = 0, double dy = 0) =>
            SendMouse(ev, x, y, button, buttons, modifiers, clicks, dx, dy);

        public void SendSyntheticKey(string ev, int vk, string domKey, string domCode, int modifiers = 0) =>
            SendKey(ev, vk, domKey, domCode, modifiers);

        void SendMouse(string ev, double x, double y, string button, int buttons, int modifiers, int clicks, double dx, double dy) {
            if (string.Equals(ev, "up", StringComparison.Ordinal)) {
                StationEditProfiling.NoteNativePointerRelease();
            }
            EnqueueToWorker(new JObject {
                ["kind"] = "mouse",
                ["ev"] = ev,
                ["x"] = Math.Round(x, 2),
                ["y"] = Math.Round(y, 2),
                ["button"] = button,
                ["buttons"] = buttons,
                ["modifiers"] = modifiers,
                ["clicks"] = clicks,
                ["dx"] = Math.Round(dx, 2),
                ["dy"] = Math.Round(dy, 2),
            }.ToString(Formatting.None));
        }

        static int CurrentModifiers() {
            var kb = Keyboard.current;
            if (kb == null) return 0;
            int mods = 0;
            if (kb.altKey.isPressed) mods |= 1;
            if (kb.ctrlKey.isPressed) mods |= 2;
            if (kb.leftMetaKey.isPressed || kb.rightMetaKey.isPressed) mods |= 4;
            if (kb.shiftKey.isPressed) mods |= 8;
            return mods;
        }

        void SubscribeKeyboardText() {
            if (Keyboard.current != null) {
                Keyboard.current.onTextInput -= OnTextInput;
                Keyboard.current.onTextInput += OnTextInput;
            }
            InputSystem.onDeviceChange += OnInputDeviceChange;
        }

        void UnsubscribeKeyboardText() {
            InputSystem.onDeviceChange -= OnInputDeviceChange;
            if (Keyboard.current != null) {
                Keyboard.current.onTextInput -= OnTextInput;
            }
        }

        void OnInputDeviceChange(InputDevice device, InputDeviceChange change) {
            if (device is Keyboard kb) {
                if (change == InputDeviceChange.Added || change == InputDeviceChange.Reconnected) {
                    kb.onTextInput -= OnTextInput;
                    kb.onTextInput += OnTextInput;
                } else if (change == InputDeviceChange.Removed || change == InputDeviceChange.Disconnected) {
                    kb.onTextInput -= OnTextInput;
                }
            }
        }

        void OnTextInput(char ch) {
            if (!webReady || activeClient == null || smokeSuppressed || SuppressPhysicalInput || nativeModalDialogOpen) return;
            if (ch < ' ' || ch == 127) return;
            var kb = Keyboard.current;
            if (kb != null && (kb.ctrlKey.isPressed || kb.altKey.isPressed || kb.leftMetaKey.isPressed || kb.rightMetaKey.isPressed)) {
                return;
            }
            EnqueueToWorker(new JObject {
                ["kind"] = "key",
                ["ev"] = ch <= 126 ? "char" : "insertText",
                ["text"] = ch.ToString(),
                ["modifiers"] = CurrentModifiers(),
            }.ToString(Formatting.None));
        }

        readonly double[] keyRepeatAt = new double[KeyBindings.Length];
        double keyRepeatDelay = 0.5;
        double keyRepeatInterval = 1.0 / 30;

        [DllImport("user32.dll")]
        static extern bool SystemParametersInfo(uint action, uint parameter, out uint value, uint flags);

        [DllImport("user32.dll")]
        static extern bool AllowSetForegroundWindow(uint dwProcessId);

        void AllowWorkerForeground() {
            var proc = workerProcess;
            if (proc == null) return;
            try {
                if (!proc.HasExited) AllowSetForegroundWindow((uint)proc.Id);
            } catch {
                // Ignore if worker already exited or OS denies foreground handoff.
            }
        }

        void ApplyOverlayCursor() {
            bool overlayOwnsCursor =
                webReady && activeClient != null && !smokeSuppressed && !SuppressPhysicalInput &&
                !nativeModalDialogOpen && mouseWasInside && Application.isFocused &&
                surfaceImage != null && surfaceImage.enabled;
            string next = overlayOwnsCursor ? StationDesktopCursors.NormalizeName(desiredCursor) : "default";
            float scale = desiredCursorScale;
            int nextSize = StationDesktopCursors.ResolvePixelSize(scale);
            bool usesScaledTexture = !string.Equals(next, "default", StringComparison.Ordinal) &&
                                     !string.Equals(next, "none", StringComparison.Ordinal);
            if (string.Equals(next, appliedCursor, StringComparison.Ordinal) &&
                (!usesScaledTexture || nextSize == appliedCursorSize)) return;
            appliedCursor = next;
            appliedCursorSize = nextSize;

            if (string.Equals(next, "none", StringComparison.Ordinal)) {
                Cursor.SetCursor(null, Vector2.zero, CursorMode.Auto);
                Cursor.visible = false;
                cursorHiddenByOverlay = true;
                return;
            }

            if (cursorHiddenByOverlay) {
                Cursor.visible = true;
                cursorHiddenByOverlay = false;
            }

            if (StationDesktopCursors.TryGet(next, scale, out var texture, out var hotspot)) {
                Cursor.SetCursor(texture, hotspot, CursorMode.Auto);
            } else {
                Cursor.SetCursor(null, Vector2.zero, CursorMode.Auto);
            }
        }

        void ResetOverlayCursor() {
            if (string.Equals(appliedCursor, "default", StringComparison.Ordinal) && !cursorHiddenByOverlay) return;
            appliedCursor = "default";
            if (cursorHiddenByOverlay) {
                Cursor.visible = true;
                cursorHiddenByOverlay = false;
            }
            Cursor.SetCursor(null, Vector2.zero, CursorMode.Auto);
        }

        void OnApplicationFocus(bool focused) {
            if (focused) {
                AllowWorkerForeground();
                const uint getKeyboardSpeed = 0x000a;
                const uint getKeyboardDelay = 0x0016;
                if (SystemParametersInfo(getKeyboardDelay, 0, out uint delay, 0))
                    keyRepeatDelay = 0.25 * (1 + delay);
                if (SystemParametersInfo(getKeyboardSpeed, 0, out uint speed, 0))
                    keyRepeatInterval = 1.0 / (2.5 + 27.5 * speed / 31);
                return;
            }

            ResetOverlayCursor();
            for (int i = 0; i < KeyBindings.Length; i++) {
                if (keyRepeatAt[i] == 0) continue;
                var binding = KeyBindings[i];
                SendKey("up", binding.Vk, binding.DomKey, binding.DomCode, 0);
                keyRepeatAt[i] = 0;
            }
        }

        void ForwardKeyboardButtons() {
            if (!webReady || activeClient == null || !Application.isFocused) return;
            var kb = Keyboard.current;
            if (kb == null) return;

            bool shift = kb.shiftKey.isPressed;
            int mods = CurrentModifiers();
            double now = Time.unscaledTimeAsDouble;
            for (int i = 0; i < KeyBindings.Length; i++) {
                var b = KeyBindings[i];
                KeyControl ctrl = kb[b.Key];
                if (ctrl == null) continue;
                string domKey = shift && !string.IsNullOrEmpty(b.ShiftDomKey) ? b.ShiftDomKey : b.DomKey;
                if (ctrl.wasPressedThisFrame) {
                    SendKey("down", b.Vk, domKey, b.DomCode, mods);
                    keyRepeatAt[i] = b.Repeats ? now + keyRepeatDelay : double.PositiveInfinity;
                }
                if (keyRepeatAt[i] == 0) continue;
                if (ctrl.wasReleasedThisFrame || !ctrl.isPressed) {
                    SendKey("up", b.Vk, domKey, b.DomCode, mods);
                    keyRepeatAt[i] = 0;
                } else if (now >= keyRepeatAt[i]) {
                    SendKey("down", b.Vk, domKey, b.DomCode, mods, repeat: true);
                    keyRepeatAt[i] = now + keyRepeatInterval;
                }
            }
        }

        void SendKey(string ev, int vk, string domKey, string domCode, int modifiers, bool repeat = false) {
            EnqueueToWorker(new JObject {
                ["kind"] = "key",
                ["ev"] = ev,
                ["vk"] = vk,
                ["key"] = domKey,
                ["code"] = domCode,
                ["modifiers"] = modifiers,
                ["repeat"] = repeat,
            }.ToString(Formatting.None));
        }

        readonly struct KeyBinding {
            public readonly Key Key;
            public readonly int Vk;
            public readonly string DomKey;
            public readonly string DomCode;
            public readonly string ShiftDomKey;
            public bool Repeats => DomKey != "Shift" && DomKey != "Control" && DomKey != "Alt" && DomKey != "Meta";

            public KeyBinding(Key key, int vk, string domKey, string domCode, string shiftDomKey = null) {
                Key = key;
                Vk = vk;
                DomKey = domKey;
                DomCode = domCode;
                ShiftDomKey = shiftDomKey;
            }
        }

        static readonly KeyBinding[] KeyBindings = {
            new KeyBinding(Key.A, 0x41, "a", "KeyA", "A"),
            new KeyBinding(Key.B, 0x42, "b", "KeyB", "B"),
            new KeyBinding(Key.C, 0x43, "c", "KeyC", "C"),
            new KeyBinding(Key.D, 0x44, "d", "KeyD", "D"),
            new KeyBinding(Key.E, 0x45, "e", "KeyE", "E"),
            new KeyBinding(Key.F, 0x46, "f", "KeyF", "F"),
            new KeyBinding(Key.G, 0x47, "g", "KeyG", "G"),
            new KeyBinding(Key.H, 0x48, "h", "KeyH", "H"),
            new KeyBinding(Key.I, 0x49, "i", "KeyI", "I"),
            new KeyBinding(Key.J, 0x4A, "j", "KeyJ", "J"),
            new KeyBinding(Key.K, 0x4B, "k", "KeyK", "K"),
            new KeyBinding(Key.L, 0x4C, "l", "KeyL", "L"),
            new KeyBinding(Key.M, 0x4D, "m", "KeyM", "M"),
            new KeyBinding(Key.N, 0x4E, "n", "KeyN", "N"),
            new KeyBinding(Key.O, 0x4F, "o", "KeyO", "O"),
            new KeyBinding(Key.P, 0x50, "p", "KeyP", "P"),
            new KeyBinding(Key.Q, 0x51, "q", "KeyQ", "Q"),
            new KeyBinding(Key.R, 0x52, "r", "KeyR", "R"),
            new KeyBinding(Key.S, 0x53, "s", "KeyS", "S"),
            new KeyBinding(Key.T, 0x54, "t", "KeyT", "T"),
            new KeyBinding(Key.U, 0x55, "u", "KeyU", "U"),
            new KeyBinding(Key.V, 0x56, "v", "KeyV", "V"),
            new KeyBinding(Key.W, 0x57, "w", "KeyW", "W"),
            new KeyBinding(Key.X, 0x58, "x", "KeyX", "X"),
            new KeyBinding(Key.Y, 0x59, "y", "KeyY", "Y"),
            new KeyBinding(Key.Z, 0x5A, "z", "KeyZ", "Z"),

            new KeyBinding(Key.Digit0, 0x30, "0", "Digit0", ")"),
            new KeyBinding(Key.Digit1, 0x31, "1", "Digit1", "!"),
            new KeyBinding(Key.Digit2, 0x32, "2", "Digit2", "@"),
            new KeyBinding(Key.Digit3, 0x33, "3", "Digit3", "#"),
            new KeyBinding(Key.Digit4, 0x34, "4", "Digit4", "$"),
            new KeyBinding(Key.Digit5, 0x35, "5", "Digit5", "%"),
            new KeyBinding(Key.Digit6, 0x36, "6", "Digit6", "^"),
            new KeyBinding(Key.Digit7, 0x37, "7", "Digit7", "&"),
            new KeyBinding(Key.Digit8, 0x38, "8", "Digit8", "*"),
            new KeyBinding(Key.Digit9, 0x39, "9", "Digit9", "("),

            new KeyBinding(Key.Space, 0x20, " ", "Space"),
            new KeyBinding(Key.Enter, 0x0D, "Enter", "Enter"),
            new KeyBinding(Key.NumpadEnter, 0x0D, "Enter", "NumpadEnter"),
            new KeyBinding(Key.Escape, 0x1B, "Escape", "Escape"),
            new KeyBinding(Key.Backspace, 0x08, "Backspace", "Backspace"),
            new KeyBinding(Key.Delete, 0x2E, "Delete", "Delete"),
            new KeyBinding(Key.Tab, 0x09, "Tab", "Tab"),

            new KeyBinding(Key.LeftArrow, 0x25, "ArrowLeft", "ArrowLeft"),
            new KeyBinding(Key.UpArrow, 0x26, "ArrowUp", "ArrowUp"),
            new KeyBinding(Key.RightArrow, 0x27, "ArrowRight", "ArrowRight"),
            new KeyBinding(Key.DownArrow, 0x28, "ArrowDown", "ArrowDown"),
            new KeyBinding(Key.Home, 0x24, "Home", "Home"),
            new KeyBinding(Key.End, 0x23, "End", "End"),
            new KeyBinding(Key.PageUp, 0x21, "PageUp", "PageUp"),
            new KeyBinding(Key.PageDown, 0x22, "PageDown", "PageDown"),

            new KeyBinding(Key.LeftShift, 0x10, "Shift", "ShiftLeft"),
            new KeyBinding(Key.RightShift, 0x10, "Shift", "ShiftRight"),
            new KeyBinding(Key.LeftCtrl, 0x11, "Control", "ControlLeft"),
            new KeyBinding(Key.RightCtrl, 0x11, "Control", "ControlRight"),
            new KeyBinding(Key.LeftAlt, 0x12, "Alt", "AltLeft"),
            new KeyBinding(Key.RightAlt, 0x12, "Alt", "AltRight"),
            new KeyBinding(Key.LeftMeta, 0x5B, "Meta", "MetaLeft"),
            new KeyBinding(Key.RightMeta, 0x5C, "Meta", "MetaRight"),

            new KeyBinding(Key.Minus, 0xBD, "-", "Minus", "_"),
            new KeyBinding(Key.Equals, 0xBB, "=", "Equal", "+"),
            new KeyBinding(Key.LeftBracket, 0xDB, "[", "BracketLeft", "{"),
            new KeyBinding(Key.RightBracket, 0xDD, "]", "BracketRight", "}"),
            new KeyBinding(Key.Semicolon, 0xBA, ";", "Semicolon", ":"),
            new KeyBinding(Key.Quote, 0xDE, "'", "Quote", "\""),
            new KeyBinding(Key.Comma, 0xBC, ",", "Comma", "<"),
            new KeyBinding(Key.Period, 0xBE, ".", "Period", ">"),
            new KeyBinding(Key.Slash, 0xBF, "/", "Slash", "?"),
            new KeyBinding(Key.Backslash, 0xDC, "\\", "Backslash", "|"),
            new KeyBinding(Key.Backquote, 0xC0, "`", "Backquote", "~"),
        };

        // ------------------------------------------------------------------ bridge IPC

        readonly StringBuilder bridgeWrapBuilder = new StringBuilder(4096);

        void OnHostReplyPublished(string json) {
            if (string.IsNullOrEmpty(json)) return;
            bridgeWrapBuilder.Clear();
            using (var sw = new StringWriter(bridgeWrapBuilder, System.Globalization.CultureInfo.InvariantCulture))
            using (var writer = new JsonTextWriter(sw) { Formatting = Formatting.None }) {
                writer.WriteStartObject();
                writer.WritePropertyName("kind");
                writer.WriteValue("bridge");
                writer.WritePropertyName("json");
                writer.WriteValue(json);
                writer.WriteEndObject();
            }
            EnqueueToWorker(bridgeWrapBuilder.ToString());
        }

        void DrainIncomingQueues() {
            while (incomingLogs.TryDequeue(out var logItem)) {
                if (logItem.isError) UnityEngine.Debug.LogError(logItem.text);
                else UnityEngine.Debug.Log(logItem.text);
            }

            var host = boundHost;
            if (host == null) {
                while (incomingCommands.TryDequeue(out _)) { }
                return;
            }
            if (autosaveInstallInFlight) return;
            if (pendingStandaloneAutosaveRestore) {
                if (!IsStandaloneAutosaveInstallReady()) return;
                CompletePendingStandaloneAutosave(host);
                if (autosaveInstallInFlight) return;
            }
            int safety = 0;
            int executed = 0;
            long cmdT0 = StationBenchmarkRecorder.IsBreakdownProfiling ? Stopwatch.GetTimestamp() : 0;
            while (safety++ < 64 && incomingCommands.TryDequeue(out string cmdJson)) {
                if (string.IsNullOrEmpty(cmdJson)) continue;
                executed++;
                try {
                    NoteUiThemeCommand(cmdJson);
                    bool wasInBenchmark = StationBenchmarkRecorder.InBenchmarkUi;
                    if (!wasInBenchmark && cmdJson.IndexOf("\"benchmark.mode\"", StringComparison.Ordinal) >= 0) {
                        TryWriteStandaloneAutosave(host, force: false);
                        preBenchmarkRevision = host.IsLoaded ? host.CurrentRevision : -1;
                    }
                    host.BrowserCommand(cmdJson);
                    if (wasInBenchmark && !StationBenchmarkRecorder.InBenchmarkUi && !launchedInBenchmarkMode) {
                        if (!Application.isEditor && !Application.isBatchMode &&
                            preBenchmarkRevision >= 0 && host.CurrentRevision != preBenchmarkRevision) {
                            if (TryRestoreStandaloneAutosave(host)) {
                                host.BrowserCommand("{\"type\":\"station.resync\",\"payload\":{}}");
                            }
                        }
                        preBenchmarkRevision = -1;
                    }
                } catch (Exception ex) {
                    UnityEngine.Debug.LogException(ex);
                }
            }
            if (cmdT0 != 0 && executed > 0) StationBenchmarkRecorder.RecordCommandTicks(Stopwatch.GetTimestamp() - cmdT0, executed);
        }

        void NoteUiThemeCommand(string cmdJson) {
            bool maybeTheme = cmdJson.IndexOf("\"view.set\"", StringComparison.Ordinal) >= 0 &&
                cmdJson.IndexOf("\"theme\"", StringComparison.Ordinal) >= 0;
            bool maybeLocale = cmdJson.IndexOf("\"exit.locale\"", StringComparison.Ordinal) >= 0;
            if (!maybeTheme && !maybeLocale) return;
            try {
                var obj = JObject.Parse(cmdJson);
                string type = (string)obj["type"];
                if (obj["payload"] is not JObject payload) return;
                if (maybeTheme && string.Equals(type, "view.set", StringComparison.Ordinal) &&
                    string.Equals((string)payload["key"], "theme", StringComparison.Ordinal)) {
                    string normalized = NormalizeUiTheme((string)payload["value"]);
                    ApplyStartupLoadingTheme(normalized, IsEnglishStartupLanguage(activeStartupRoute), boundHost != null ? boundHost.font : null);
                    if (!Application.isBatchMode && !launchedInBenchmarkMode &&
                        !string.Equals(PlayerPrefs.GetString(UiThemePreference, ""), normalized, StringComparison.Ordinal)) {
                        PlayerPrefs.SetString(UiThemePreference, normalized);
                        PlayerPrefs.Save();
                    }
                } else if (maybeLocale && string.Equals(type, "exit.locale", StringComparison.Ordinal)) {
                    string locale = (string)payload["locale"];
                    string normalizedLang = string.Equals(locale, "en", StringComparison.OrdinalIgnoreCase) ? "en" : "zh-CN";
                    if (!Application.isBatchMode && !launchedInBenchmarkMode &&
                        !string.Equals(PlayerPrefs.GetString(UiLanguagePreference, ""), normalizedLang, StringComparison.Ordinal)) {
                        PlayerPrefs.SetString(UiLanguagePreference, normalizedLang);
                        PlayerPrefs.Save();
                    }
                }
            } catch {
                // Malformed command JSON will be reported by the command router.
            }
        }

        void EnqueueToWorker(string jsonLine) {
            if (sessionCts == null || sessionCts.IsCancellationRequested) return;
            outgoingLines.Enqueue(jsonLine);
            outgoingSignal.Set();
        }

        async Task RunServerLoopAsync(TcpListener server, CancellationToken token) {
            try {
                var client = await server.AcceptTcpClientAsync();
                client.NoDelay = true;
                activeClient = client;
                using var stream = client.GetStream();
                using var reader = new StreamReader(stream, new UTF8Encoding(false));
                using var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };

                var writerTask = Task.Run(async () => {
                    while (!token.IsCancellationRequested) {
                        outgoingSignal.WaitOne(50);
                        while (outgoingLines.TryDequeue(out string line)) {
                            await writer.WriteLineAsync(line);
                        }
                    }
                }, token);

                while (!token.IsCancellationRequested) {
                    string line = await reader.ReadLineAsync();
                    if (line == null) break;
                    if (line.Length == 0) continue;
                    HandleWorkerMessage(line);
                }

                await writerTask;
            } catch {
                // Normal teardown on Stop Play Mode or quit.
            }
        }

        void HandleWorkerMessage(string line) {
            try {
                var obj = JObject.Parse(line);
                string kind = (string)obj["kind"] ?? "";
                switch (kind) {
                    case "ready":
                        webReady = true;
                        incomingLogs.Enqueue((false, "[ReactUI] Station Designer React UI mounted in Unity Canvas."));
                        break;
                    case "cmd": {
                        string cmd = (string)obj["json"];
                        if (!string.IsNullOrEmpty(cmd)) incomingCommands.Enqueue(cmd);
                        break;
                    }
                    case "cursor": {
                        desiredCursor = StationDesktopCursors.NormalizeName((string)obj["cursor"]);
                        desiredCursorScale = (float?)obj["scale"] ?? 1f;
                        break;
                    }
                    case "modalDialog": {
                        bool open = (bool?)obj["open"] == true;
                        nativeModalDialogOpen = open;
                        if (open) heldMouseButtons = 0;
                        break;
                    }
                    case "log": {
                        string level = (string)obj["level"] ?? "info";
                        string msg = (string)obj["message"] ?? "";
                        incomingLogs.Enqueue((level == "error", "[ReactUI] " + msg));
                        break;
                    }
                    case "previewCaptured": {
                        if ((bool?)obj["ok"] == true) {
                            lastCapturedPreviewPath = (string)obj["path"] ?? "";
                        } else {
                            incomingLogs.Enqueue((true, "[ReactUI] Preview capture failed: " + ((string)obj["error"] ?? "unknown")));
                        }
                        break;
                    }
                }
            } catch {
                // Ignore malformed telemetry line.
            }
        }
#else
        public bool IsWorkerRunning => false;
        public bool IsWebReady => false;
        public bool SuppressPhysicalInput { get; set; }
        public int PresentedFrameCount => 0;
        public int TextureWidth => 0;
        public int TextureHeight => 0;
        public string LastCapturedPreviewPath => "";
        public void RestartWorker() { }
        public void StopWorker(bool clearHost = true) { }
        public void RequestPreviewCapture(string fullPngPath) { }
        public void SendSyntheticMouse(string ev, double x, double y, string button = "none", int buttons = 0, int modifiers = 0, int clicks = 0, double dx = 0, double dy = 0) { }
        public void SendSyntheticKey(string ev, int vk, string domKey, string domCode, int modifiers = 0) { }
#endif
    }
}
