using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// Native Steamworks SDK 1.65 flat C ABI bridge for Windows Steam builds.
    ///
    /// Activates only on <c>UNITY_STANDALONE_WIN</c> (non-Editor) when <c>steam_api64.dll</c>
    /// is present beside <c>MetroStation.exe</c>, keeping WebGL, Microsoft Store MSIX,
    /// portable <c>StationDesigner.exe</c>, and Editor runs completely free of Steam binaries.
    ///
    /// When active, the host:
    /// 1. Reads the optional Steam AppID from <c>StreamingAssets/MetroUi/steam-runtime.json</c>,
    /// 2. Calls <c>SteamAPI_RestartAppIfNecessary</c> (when <c>requireSteamRestart</c> is set)
    ///    and <c>SteamAPI_InitFlat</c> + <c>SteamAPI_ManualDispatch_Init</c>,
    /// 3. Polls manual callbacks in <c>Update()</c> for <c>GameOverlayActivated_t</c>
    ///    (<c>k_iSteamFriendsCallbacks + 31 = 331</c>) so <see cref="StationDesktopUiPresenter"/>
    ///    pauses physical input forwarding and resets custom cursors while the Steam Overlay is
    ///    open, and
    /// 4. Queries <c>SteamAPI_ISteamApps_GetCurrentGameLanguage</c> so first-run launches default
    ///    to English or Chinese.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class StationSteamHost : MonoBehaviour {
        public const string RuntimeConfigFileName = "steam-runtime.json";
        public const string SteamApiDllName = "steam_api64.dll";
        public const int GameOverlayActivatedCallbackId = 331; // k_iSteamFriendsCallbacks (300) + 31

        static StationSteamHost activeInstance;
        static bool initialized;
        static bool overlayActive;
        static uint activeAppId;
        static string startupSteamLanguage = "";

        public static StationSteamHost Active => activeInstance;
        public static bool IsInitialized => initialized;
        public static bool IsOverlayActive => overlayActive;
        public static uint AppId => activeAppId;
        public static string SteamLanguage => startupSteamLanguage;

        /// <summary>Raised whenever the Steam Overlay opens (<c>true</c>) or closes (<c>false</c>).</summary>
        public static event Action<bool> OverlayActiveChanged;

        /// <summary>Test seam allowing EditMode/PlayMode tests to verify overlay input gating.</summary>
        public static void SetOverlayActiveForTests(bool active) => SetOverlayActive(active);

        /// <summary>Test seam allowing EditMode/PlayMode tests to inject a simulated Steam language.</summary>
        public static void SetSteamLanguageForTests(string steamLanguage) {
            startupSteamLanguage = steamLanguage ?? "";
        }

        public static void ResetForTests() {
            initialized = false;
            activeAppId = 0;
            startupSteamLanguage = "";
            SetOverlayActive(false);
        }

        static void SetOverlayActive(bool active) {
            if (overlayActive == active) return;
            overlayActive = active;
            try {
                OverlayActiveChanged?.Invoke(active);
            } catch (Exception ex) {
                Debug.LogWarning("[Steam] OverlayActiveChanged listener threw: " + ex.Message);
            }
        }

        /// <summary>
        /// Maps a Steam API language token (<c>ISteamApps::GetCurrentGameLanguage()</c>) to one of
        /// Station Designer's two UI locales (<c>"zh-CN"</c> or <c>"en"</c>). Returns empty string
        /// if no Steam language is available.
        /// </summary>
        public static string MapSteamLanguageToUiLocale(string steamLanguage) {
            if (string.IsNullOrWhiteSpace(steamLanguage)) return "";
            string clean = steamLanguage.Trim().ToLowerInvariant();
            if (clean == "schinese" || clean == "tchinese" || clean.StartsWith("zh", StringComparison.Ordinal)) {
                return "zh-CN";
            }
            return "en";
        }

        /// <summary>
        /// Returns <c>true</c> and outputs <c>"en"</c> or <c>"zh-CN"</c> when a Steam game language
        /// has been resolved for the current session.
        /// </summary>
        public static bool TryResolveStartupLanguage(out string uiLocale) {
            uiLocale = MapSteamLanguageToUiLocale(startupSteamLanguage);
            return !string.IsNullOrEmpty(uiLocale);
        }

        /// <summary>
        /// Applies a first-run UI locale (<c>"en"</c> or <c>"zh-CN"</c>) to a desktop startup route
        /// such as <c>/game/</c> or <c>/game/zoo</c> without disturbing explicit <c>/en</c> or
        /// benchmark routes.
        /// </summary>
        public static string ApplyStartupLocaleToRoute(string route, string uiLocale) {
            if (string.IsNullOrWhiteSpace(route)) return route;
            if (!string.Equals(uiLocale, "en", StringComparison.OrdinalIgnoreCase)) return route;

            string trimmed = route.Trim();
            string[] parts = trimmed.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < parts.Length; i++) {
                if (string.Equals(parts[i], "en", StringComparison.OrdinalIgnoreCase)) return trimmed;
                if (string.Equals(parts[i], "benchmark", StringComparison.OrdinalIgnoreCase)) return trimmed;
            }
            if (parts.Length == 0 || !string.Equals(parts[0], "game", StringComparison.OrdinalIgnoreCase)) {
                return trimmed;
            }
            if (parts.Length == 1) return "/game/en/";
            return "/game/en/" + string.Join("/", parts, 1, parts.Length - 1);
        }

        /// <summary>
        /// Parses <c>steam-runtime.json</c> (<c>{ "appId": 480, "requireSteamRestart": true }</c>).
        /// </summary>
        public static bool TryParseRuntimeConfig(string json, out uint appId, out bool requireSteamRestart) {
            appId = 0;
            requireSteamRestart = false;
            if (string.IsNullOrWhiteSpace(json)) return false;
            try {
                var obj = JObject.Parse(json);
                var rawId = obj["appId"];
                if (rawId != null && uint.TryParse(rawId.ToString(), out uint parsed) && parsed > 0) {
                    appId = parsed;
                }
                requireSteamRestart = (bool?)obj["requireSteamRestart"] == true;
                return appId > 0;
            } catch {
                return false;
            }
        }

        public static string RuntimeConfigPath() =>
            Path.Combine(Application.streamingAssetsPath, "MetroUi", RuntimeConfigFileName);

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        [StructLayout(LayoutKind.Sequential, Pack = 8)]
        struct CallbackMsg {
            public int HSteamUser;
            public int CallbackId;
            public IntPtr ParamPtr;
            public int ParamSize;
        }

        static class NativeSteam {
            [DllImport(SteamApiDllName, CallingConvention = CallingConvention.Cdecl)]
            public static extern int SteamAPI_InitFlat(byte[] outErrMsg);

            [DllImport(SteamApiDllName, CallingConvention = CallingConvention.Cdecl)]
            [return: MarshalAs(UnmanagedType.I1)]
            public static extern bool SteamAPI_RestartAppIfNecessary(uint ownAppId);

            [DllImport(SteamApiDllName, CallingConvention = CallingConvention.Cdecl)]
            public static extern void SteamAPI_Shutdown();

            [DllImport(SteamApiDllName, CallingConvention = CallingConvention.Cdecl)]
            public static extern void SteamAPI_ManualDispatch_Init();

            [DllImport(SteamApiDllName, CallingConvention = CallingConvention.Cdecl)]
            public static extern int SteamAPI_GetHSteamPipe();

            [DllImport(SteamApiDllName, CallingConvention = CallingConvention.Cdecl)]
            public static extern void SteamAPI_ManualDispatch_RunFrame(int hSteamPipe);

            [DllImport(SteamApiDllName, CallingConvention = CallingConvention.Cdecl)]
            [return: MarshalAs(UnmanagedType.I1)]
            public static extern bool SteamAPI_ManualDispatch_GetNextCallback(int hSteamPipe, out CallbackMsg callbackMsg);

            [DllImport(SteamApiDllName, CallingConvention = CallingConvention.Cdecl)]
            public static extern void SteamAPI_ManualDispatch_FreeLastCallback(int hSteamPipe);

            [DllImport(SteamApiDllName, CallingConvention = CallingConvention.Cdecl)]
            public static extern IntPtr SteamAPI_SteamUtils_v011();

            [DllImport(SteamApiDllName, CallingConvention = CallingConvention.Cdecl)]
            public static extern uint SteamAPI_ISteamUtils_GetAppID(IntPtr self);

            [DllImport(SteamApiDllName, CallingConvention = CallingConvention.Cdecl)]
            public static extern IntPtr SteamAPI_SteamApps_v009();

            [DllImport(SteamApiDllName, CallingConvention = CallingConvention.Cdecl)]
            public static extern IntPtr SteamAPI_ISteamApps_GetCurrentGameLanguage(IntPtr self);
        }

        int steamPipe;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Bootstrap() {
            if (!Application.isPlaying || Application.isBatchMode) return;
            if (activeInstance != null) return;
            if (!HasBundledSteamApiDll()) return;
            var go = new GameObject("StationSteamHost") {
                hideFlags = HideFlags.DontSave,
            };
            DontDestroyOnLoad(go);
            activeInstance = go.AddComponent<StationSteamHost>();
        }

        static bool HasBundledSteamApiDll() {
            try {
                string appDir = Path.GetDirectoryName(Application.dataPath);
                if (string.IsNullOrEmpty(appDir)) return false;
                return File.Exists(Path.Combine(appDir, SteamApiDllName));
            } catch {
                return false;
            }
        }

        void Awake() {
            if (activeInstance != null && activeInstance != this) {
                Destroy(gameObject);
                return;
            }
            activeInstance = this;
            InitializeSteam();
        }

        void InitializeSteam() {
            uint configuredAppId = 0;
            bool requireRestart = false;
            string cfgPath = RuntimeConfigPath();
            if (File.Exists(cfgPath)) {
                try {
                    TryParseRuntimeConfig(File.ReadAllText(cfgPath), out configuredAppId, out requireRestart);
                } catch (Exception ex) {
                    Debug.LogWarning("[Steam] Could not read steam-runtime.json: " + ex.Message);
                }
            }
            activeAppId = configuredAppId;

            try {
                if (requireRestart && configuredAppId > 0) {
                    if (NativeSteam.SteamAPI_RestartAppIfNecessary(configuredAppId)) {
                        Debug.Log("[Steam] Relaunching through Steam client for AppID " + configuredAppId + ".");
                        Application.Quit();
                        return;
                    }
                }

                var errBuf = new byte[1024];
                int initResult = NativeSteam.SteamAPI_InitFlat(errBuf);
                if (initResult != 0) {
                    string errText = DecodeNullTerminatedUtf8(errBuf);
                    Debug.LogWarning($"[Steam] SteamAPI_InitFlat returned {initResult} ({errText}); running without Steamworks.");
                    return;
                }

                initialized = true;
                NativeSteam.SteamAPI_ManualDispatch_Init();
                steamPipe = NativeSteam.SteamAPI_GetHSteamPipe();

                IntPtr utils = NativeSteam.SteamAPI_SteamUtils_v011();
                if (utils != IntPtr.Zero) {
                    uint liveAppId = NativeSteam.SteamAPI_ISteamUtils_GetAppID(utils);
                    if (liveAppId > 0) activeAppId = liveAppId;
                }

                IntPtr apps = NativeSteam.SteamAPI_SteamApps_v009();
                if (apps != IntPtr.Zero) {
                    IntPtr langPtr = NativeSteam.SteamAPI_ISteamApps_GetCurrentGameLanguage(apps);
                    startupSteamLanguage = langPtr != IntPtr.Zero ? (Marshal.PtrToStringUTF8(langPtr) ?? "") : "";
                }

                Debug.Log($"[Steam] Initialized via Steamworks SDK 1.65 (AppID={activeAppId}, language={startupSteamLanguage}).");
            } catch (Exception ex) {
                Debug.LogWarning("[Steam] Native steam_api64.dll init failed; running without Steamworks: " + ex.Message);
                initialized = false;
            }
        }

        void Update() {
            if (!initialized || steamPipe == 0) return;
            try {
                NativeSteam.SteamAPI_ManualDispatch_RunFrame(steamPipe);
                while (NativeSteam.SteamAPI_ManualDispatch_GetNextCallback(steamPipe, out var cb)) {
                    try {
                        if (cb.CallbackId == GameOverlayActivatedCallbackId &&
                            cb.ParamPtr != IntPtr.Zero &&
                            cb.ParamSize >= 1) {
                            byte active = Marshal.ReadByte(cb.ParamPtr, 0);
                            SetOverlayActive(active != 0);
                        }
                    } finally {
                        NativeSteam.SteamAPI_ManualDispatch_FreeLastCallback(steamPipe);
                    }
                }
            } catch (Exception ex) {
                Debug.LogWarning("[Steam] Manual callback dispatch failed: " + ex.Message);
            }
        }

        void OnApplicationQuit() => ShutdownSteam();

        void OnDestroy() {
            if (activeInstance == this) {
                ShutdownSteam();
                activeInstance = null;
            }
        }

        void ShutdownSteam() {
            SetOverlayActive(false);
            if (!initialized) return;
            initialized = false;
            steamPipe = 0;
            try {
                NativeSteam.SteamAPI_Shutdown();
            } catch {
                // Ignore shutdown errors on abrupt process termination.
            }
        }

        static string DecodeNullTerminatedUtf8(byte[] buffer) {
            if (buffer == null || buffer.Length == 0) return "";
            int len = Array.IndexOf(buffer, (byte)0);
            if (len < 0) len = buffer.Length;
            return len > 0 ? Encoding.UTF8.GetString(buffer, 0, len) : "";
        }
#endif
    }
}
