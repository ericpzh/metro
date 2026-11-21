using Newtonsoft.Json.Linq;
using Metro.Build;
using Metro.View;
using UnityEngine;

namespace Metro.App {
    public sealed class StationGraphicsSettings : IStationCommandHandler, IStationStateContributor {
        const string Preference = "metro.graphics.model-detail";
        string profile;
        internal static float ModelLodBias { get; private set; } = 1f;
        internal static int MinimumModelLod { get; private set; }
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
            Apply();
        }

        public string Capability => "graphics";
        public string Key => Capability;
        public JObject BuildPayload(StationDocument document, StationIndex index) =>
            new JObject { ["profile"] = profile };
        public bool Handles(string type) => type == "graphics.get" || type == "graphics.set";

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (command.Type == "graphics.set") {
                var requested = payload["profile"]?.Type == JTokenType.String ? (string)payload["profile"] : null;
                if (!Valid(requested)) {
                    rejectCode = "invalid-graphics-profile";
                    rejectReason = "Choose high, balanced, or low.";
                    return false;
                }
                if (requested != profile) {
                    profile = requested;
                    Apply();
                    PlayerPrefs.SetString(Preference, profile);
                    PlayerPrefs.Save();
                }
            }
            payload["profile"] = profile;
            return true;
        }

        static bool Valid(string value) => value == "high" || value == "balanced" || value == "low";

        internal static int SelectTier(float screenHeight, int previous, int availableTiers) {
            float ratio = screenHeight * ModelLodBias;
            float full = FullThreshold *
                (previous == 0 ? 1f - Hysteresis : previous < 0 ? 1f : 1f + Hysteresis);
            float reduced = ReducedThreshold *
                (previous == 2 ? 1f + Hysteresis : previous < 0 ? 1f : 1f - Hysteresis);
            int tier = ratio >= full ? 0 : ratio >= reduced ? 1 : 2;
            int last = Mathf.Max(0, availableTiers - 1);
            return Mathf.Clamp(tier, Mathf.Min(last, MinimumModelLod), last);
        }

        void Apply() {
            ModelLodBias = profile == "high" ? 1f : profile == "balanced" ? config.BalancedBias : config.LowBias;
            MinimumModelLod = profile == "low" ? 1 : 0;
            QualitySettings.meshLodThreshold = config.NativeThreshold / ModelLodBias;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() => StationCommandHandlers.Add(new StationGraphicsSettings());
    }
}
