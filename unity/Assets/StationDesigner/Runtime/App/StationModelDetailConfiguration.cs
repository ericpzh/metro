using UnityEngine;

namespace Metro.App {
    public sealed class StationModelDetailConfiguration : ScriptableObject {
        public const string ResourceName = "StationModelDetailConfiguration";
        public enum Profile { High, Balanced, Low }

        public Profile DefaultProfile = Profile.High;
        [Range(.05f, 1f)] public float BalancedBias = .7f;
        [Range(.05f, 1f)] public float LowBias = .4f;
        [Range(.01f, 1f)] public float FullThreshold = .12f;
        [Range(.001f, 1f)] public float ReducedThreshold = .05f;
        [Range(0f, .4f)] public float Hysteresis = .1f;
        [Min(.01f)] public float NativeThreshold = 1f;

        public static StationModelDetailConfiguration Load() =>
            Resources.Load<StationModelDetailConfiguration>(ResourceName) ??
            CreateInstance<StationModelDetailConfiguration>();

        void OnValidate() {
            LowBias = Mathf.Min(LowBias, BalancedBias);
            ReducedThreshold = Mathf.Min(ReducedThreshold, FullThreshold);
        }
    }
}
