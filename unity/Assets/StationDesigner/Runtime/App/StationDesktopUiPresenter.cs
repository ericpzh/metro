using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
using System.IO.MemoryMappedFiles;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;
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

        readonly ConcurrentQueue<string> incomingCommands = new ConcurrentQueue<string>();
        readonly ConcurrentQueue<(bool isError, string text)> incomingLogs = new ConcurrentQueue<(bool isError, string text)>();
        readonly ConcurrentQueue<string> outgoingLines = new ConcurrentQueue<string>();
        readonly AutoResetEvent outgoingSignal = new AutoResetEvent(false);

        StationGameHost boundHost;
        Canvas overlayCanvas;
        RawImage surfaceImage;
        Texture2D surfaceTexture;

        TcpListener listener;
        TcpClient activeClient;
        Process workerProcess;
        CancellationTokenSource sessionCts;
        FileStream shmStream;
        MemoryMappedFile shmFile;
        MemoryMappedViewAccessor shmAccessor;

        string currentShmPath = "";
        bool webReady;
        bool startAttempted;
        long lastUploadedSequence;
        int presentedFrames;
        int lastSentWidth;
        int lastSentHeight;
        string lastCapturedPreviewPath = "";

        Vector2 lastMousePos = new Vector2(-1f, -1f);
        int heldMouseButtons;
        double lastLeftClickTime = -10.0;
        Vector2 lastLeftClickPos;
        bool mouseWasInside;

        public bool IsWorkerRunning => workerProcess != null && !workerProcess.HasExited;
        public bool IsWebReady => webReady;
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
            var go = new GameObject("StationDesktopUiPresenter") {
                hideFlags = HideFlags.DontSave,
            };
            DontDestroyOnLoad(go);
            activeInstance = go.AddComponent<StationDesktopUiPresenter>();
        }

        void Awake() {
            if (activeInstance != null && activeInstance != this) {
                Destroy(gameObject);
                return;
            }
            activeInstance = this;
            BuildCanvas();
            SubscribeKeyboardText();
        }

        void OnDestroy() {
            UnsubscribeKeyboardText();
            StopWorker();
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
            StopWorker();
        }

        void BuildCanvas() {
            var canvasGo = new GameObject("StationDesktopUiCanvas") {
                hideFlags = HideFlags.DontSave,
            };
            DontDestroyOnLoad(canvasGo);

            overlayCanvas = canvasGo.AddComponent<Canvas>();
            overlayCanvas.renderMode = RenderMode.ScreenSpaceOverlay;
            overlayCanvas.pixelPerfect = true;
            overlayCanvas.sortingOrder = 32000;
            overlayCanvas.enabled = false;

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

        void RefreshCanvasVisibility() {
            bool show = userEnabled && !smokeSuppressed && boundHost != null && presentedFrames > 0;
            if (overlayCanvas != null && overlayCanvas.enabled != show) {
                overlayCanvas.enabled = show;
            }
            if (surfaceImage != null && surfaceImage.enabled != show) {
                surfaceImage.enabled = show;
            }
        }

        void Update() {
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
            if (!smokeSuppressed) {
                ForwardMouseInput();
                ForwardKeyboardButtons();
            }
            UploadLatestSharedFrame();
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

            string route = host.IsLoaded ? "/game/" : startupRoute;
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

        public void StopWorker(bool clearHost = true) {
            if (boundHost != null) {
                boundHost.ReplyPublished -= OnHostReplyPublished;
                if (clearHost) boundHost = null;
            }
            webReady = false;
            lastUploadedSequence = 0;
            presentedFrames = 0;
            heldMouseButtons = 0;
            RefreshCanvasVisibility();

            while (incomingCommands.TryDequeue(out _)) { }
            while (outgoingLines.TryDequeue(out _)) { }

            try { sessionCts?.Cancel(); } catch { }
            sessionCts = null;

            try { activeClient?.Close(); } catch { }
            activeClient = null;

            try { listener?.Stop(); } catch { }
            listener = null;

            var proc = workerProcess;
            workerProcess = null;
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
            int magic = shmAccessor.ReadInt32(0);
            if (magic != ShmMagic) return;

            long seq = shmAccessor.ReadInt64(8);
            if (seq <= 0 || seq == lastUploadedSequence) return;

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
            presentedFrames++;
            RefreshCanvasVisibility();
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

        void ForwardMouseInput() {
            if (!webReady || activeClient == null) return;
            var mouse = Mouse.current;
            if (mouse == null) return;

            Vector2 pos = mouse.position.ReadValue();
            float sw = Mathf.Max(1f, Screen.width);
            float sh = Mathf.Max(1f, Screen.height);
            bool inside = pos.x >= 0f && pos.x < sw && pos.y >= 0f && pos.y < sh;

            if (!inside && heldMouseButtons == 0) {
                if (mouseWasInside) {
                    mouseWasInside = false;
                    SendMouse("move", -100, -100, "none", 0, CurrentModifiers(), 0, 0, 0);
                }
                return;
            }
            mouseWasInside = inside;

            double rx = (pos.x / sw) * lastSentWidth;
            double ry = ((sh - pos.y) / sh) * lastSentHeight;
            int mods = CurrentModifiers();

            int currentMask =
                (mouse.leftButton.isPressed ? 1 : 0) |
                (mouse.rightButton.isPressed ? 2 : 0) |
                (mouse.middleButton.isPressed ? 4 : 0);

            if ((pos - lastMousePos).sqrMagnitude >= 0.25f) {
                lastMousePos = pos;
                SendMouse("move", rx, ry, "none", currentMask, mods, 0, 0, 0);
            }

            if (mouse.leftButton.wasPressedThisFrame && inside) {
                heldMouseButtons |= 1;
                double now = Time.unscaledTimeAsDouble;
                int clicks = (now - lastLeftClickTime <= 0.35 && (pos - lastLeftClickPos).sqrMagnitude <= 36f) ? 2 : 1;
                lastLeftClickTime = clicks == 2 ? -10.0 : now;
                lastLeftClickPos = pos;
                SendMouse("down", rx, ry, "left", heldMouseButtons, mods, clicks, 0, 0);
            }
            if (mouse.leftButton.wasReleasedThisFrame && (heldMouseButtons & 1) != 0) {
                heldMouseButtons &= ~1;
                SendMouse("up", rx, ry, "left", heldMouseButtons, mods, 1, 0, 0);
            }

            if (mouse.rightButton.wasPressedThisFrame && inside) {
                heldMouseButtons |= 2;
                SendMouse("down", rx, ry, "right", heldMouseButtons, mods, 1, 0, 0);
            }
            if (mouse.rightButton.wasReleasedThisFrame && (heldMouseButtons & 2) != 0) {
                heldMouseButtons &= ~2;
                SendMouse("up", rx, ry, "right", heldMouseButtons, mods, 1, 0, 0);
            }

            if (mouse.middleButton.wasPressedThisFrame && inside) {
                heldMouseButtons |= 4;
                SendMouse("down", rx, ry, "middle", heldMouseButtons, mods, 1, 0, 0);
            }
            if (mouse.middleButton.wasReleasedThisFrame && (heldMouseButtons & 4) != 0) {
                heldMouseButtons &= ~4;
                SendMouse("up", rx, ry, "middle", heldMouseButtons, mods, 1, 0, 0);
            }

            if (inside) {
                Vector2 scroll = mouse.scroll.ReadValue();
                if (Mathf.Abs(scroll.x) > 0.01f || Mathf.Abs(scroll.y) > 0.01f) {
                    // Unity scroll.y > 0 is wheel-up (zoom in); DOM WheelEvent.deltaY < 0 is wheel-up.
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
            if (!webReady || activeClient == null || smokeSuppressed) return;
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

        void ForwardKeyboardButtons() {
            if (!webReady || activeClient == null) return;
            var kb = Keyboard.current;
            if (kb == null) return;

            bool shift = kb.shiftKey.isPressed;
            int mods = CurrentModifiers();
            for (int i = 0; i < KeyBindings.Length; i++) {
                var b = KeyBindings[i];
                KeyControl ctrl = kb[b.Key];
                if (ctrl == null) continue;
                string domKey = shift && !string.IsNullOrEmpty(b.ShiftDomKey) ? b.ShiftDomKey : b.DomKey;
                if (ctrl.wasPressedThisFrame) {
                    SendKey("down", b.Vk, domKey, b.DomCode, mods);
                }
                if (ctrl.wasReleasedThisFrame) {
                    SendKey("up", b.Vk, domKey, b.DomCode, mods);
                }
            }
        }

        void SendKey(string ev, int vk, string domKey, string domCode, int modifiers) {
            EnqueueToWorker(new JObject {
                ["kind"] = "key",
                ["ev"] = ev,
                ["vk"] = vk,
                ["key"] = domKey,
                ["code"] = domCode,
                ["modifiers"] = modifiers,
            }.ToString(Formatting.None));
        }

        readonly struct KeyBinding {
            public readonly Key Key;
            public readonly int Vk;
            public readonly string DomKey;
            public readonly string DomCode;
            public readonly string ShiftDomKey;

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

        void OnHostReplyPublished(string json) {
            if (string.IsNullOrEmpty(json)) return;
            EnqueueToWorker(new JObject {
                ["kind"] = "bridge",
                ["json"] = json,
            }.ToString(Formatting.None));
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
            int safety = 0;
            while (safety++ < 64 && incomingCommands.TryDequeue(out string cmdJson)) {
                if (string.IsNullOrEmpty(cmdJson)) continue;
                try {
                    host.BrowserCommand(cmdJson);
                } catch (Exception ex) {
                    UnityEngine.Debug.LogException(ex);
                }
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
