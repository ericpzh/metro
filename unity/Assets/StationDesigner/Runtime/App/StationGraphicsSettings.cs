using Newtonsoft.Json.Linq;
using Metro.Build;
using Metro.View;
using UnityEngine;

namespace Metro.App {
    public sealed class StationGraphicsSettings : IStationCommandHandler, IStationStateContributor {
        const string Preference = "metro.graphics.model-detail";
        const string UpscalingPreference = "metro.graphics.upscaling";
        string profile;
        string upscaling;
        internal static float ModelLodBias { get; private set; } = 1f;
        internal static int MinimumModelLod { get; private set; }
        internal static int OtherLevelModelLod { get; private set; } = 1;
        internal static float FullThreshold { get; private set; } = .12f;
        internal static float ReducedThreshold { get; private set; } = .05f;
        internal static float Hysteresis { get; private set; } = .1f;
        readonly StationModelDetailConfiguration config;

        StationGraphicsSettings() {
            config = StationModelDetailConfiguration.Load();
            FullThreshold = config.FullThreshold;
            ReducedThreshold = config.ReducedThreshold;
            Hysteresis = config.Hysteresis;
            StationMeshLodIndices.Configure(FullThreshold, ReducedThreshold);
            string defaultProfile = config.DefaultProfile.ToString().ToLowerInvariant();
            profile = PlayerPrefs.GetString(Preference, defaultProfile);
            if (!Valid(profile)) profile = "high";
            upscaling = PlayerPrefs.GetString(UpscalingPreference, "native");
            if (!StationFsrUpscaler.IsValidMode(upscaling)) upscaling = "native";
            Apply();
        }

        public string Capability => "graphics";
        public string Key => Capability;
        public JObject BuildPayload(StationDocument document, StationIndex index) =>
            new JObject {
                ["profile"] = profile,
                ["upscaling"] = upscaling,
                ["renderScale"] = StationFsrUpscaler.ScaleFor(upscaling),
                ["upscalingBackend"] = StationFsrUpscaler.BackendFor(upscaling),
            };
        public bool Handles(string type) => type == "graphics.get" || type == "graphics.set";

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (command.Type == "graphics.set") {
                bool hasProfile = payload["profile"] != null;
                bool hasUpscaling = payload["upscaling"] != null;
                if (!hasProfile && !hasUpscaling) {
                    rejectCode = "invalid-graphics-profile";
                    rejectReason = "Specify profile (high, balanced, or low) or upscaling (native, ultra, quality, balanced, or performance).";
                    return false;
                }
                string requestedProfile = profile;
                if (hasProfile) {
                    var value = payload["profile"].Type == JTokenType.String ? (string)payload["profile"] : null;
                    if (!Valid(value)) {
                        rejectCode = "invalid-graphics-profile";
                        rejectReason = "Choose high, balanced, or low.";
                        return false;
                    }
                    requestedProfile = value;
                }
                string requestedUpscaling = upscaling;
                if (hasUpscaling) {
                    var value = payload["upscaling"].Type == JTokenType.String ? (string)payload["upscaling"] : null;
                    if (!StationFsrUpscaler.IsValidMode(value)) {
                        rejectCode = "invalid-upscaling-mode";
                        rejectReason = "Choose native, ultra, quality, balanced, or performance.";
                        return false;
                    }
                    requestedUpscaling = value;
                }
                bool changed = false;
                bool profileChanged = false;
                if (requestedProfile != profile) {
                    profile = requestedProfile;
                    PlayerPrefs.SetString(Preference, profile);
                    changed = true;
                    profileChanged = true;
                }
                if (requestedUpscaling != upscaling) {
                    upscaling = requestedUpscaling;
                    PlayerPrefs.SetString(UpscalingPreference, upscaling);
                    changed = true;
                }
                if (changed) {
                    Apply(profileChanged);
                    PlayerPrefs.Save();
                }
            }
            payload["profile"] = profile;
            payload["upscaling"] = upscaling;
            payload["renderScale"] = StationFsrUpscaler.ScaleFor(upscaling);
            payload["upscalingBackend"] = StationFsrUpscaler.BackendFor(upscaling);
            return true;
        }

        static bool Valid(string value) => value == "high" || value == "balanced" || value == "low";

        internal static int OtherLevelTier(int availableTiers) {
            int last = Mathf.Max(0, availableTiers - 1);
            int floor = Mathf.Max(MinimumModelLod, OtherLevelModelLod);
            return Mathf.Clamp(floor, 0, last);
        }

        internal static int SelectTier(float screenHeight, int previous, int availableTiers, bool otherLevel = false) {
            float ratio = screenHeight * ModelLodBias;
            float full = FullThreshold *
                (previous == 0 ? 1f - Hysteresis : previous < 0 ? 1f : 1f + Hysteresis);
            float reduced = ReducedThreshold *
                (previous == 2 ? 1f + Hysteresis : previous < 0 ? 1f : 1f - Hysteresis);
            int tier = ratio >= full ? 0 : ratio >= reduced ? 1 : 2;
            int last = Mathf.Max(0, availableTiers - 1);
            int floor = otherLevel ? Mathf.Max(MinimumModelLod, OtherLevelModelLod) : MinimumModelLod;
            return Mathf.Clamp(tier, Mathf.Min(last, floor), last);
        }

        void Apply(bool reapplyVisibility = false) {
            ModelLodBias = profile == "high" ? 1f : profile == "balanced" ? config.BalancedBias : config.LowBias;
            MinimumModelLod = profile == "low" ? 1 : 0;
            OtherLevelModelLod = profile == "high" ? 1 : 2;
            StationVisibilityRules.OtherLevelMeshLod = OtherLevelModelLod;
            QualitySettings.meshLodThreshold = config.NativeThreshold / ModelLodBias;
            StationFsrUpscaler.Apply(upscaling);
            if (reapplyVisibility) StationViewFeature.Active?.Visibility?.Apply();
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() => StationCommandHandlers.Add(new StationGraphicsSettings());
    }
}
