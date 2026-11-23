using System;

namespace Metro.Sim {
    /// <summary>
    /// Deterministic identity-to-profile and stride-to-speed rules ported from
    /// <c>game/src/sim/walking.ts</c> and <c>game/src/sim/activities.ts</c>.
    /// Engine-free and independent of the simulation RNG, agreeing bit-for-bit with
    /// <c>Metro.View.PassengerAppearance</c>.
    /// </summary>
    public static class StationPassengerWalking {
        public const double ChildChance = 0.20;
        public const double ChildHorizontalScale = 0.70;
        public const double DepthMin = 0.90;
        public const double DepthMax = 1.10;
        public const double ChildDepthMin = 0.80;
        public const double ChildDepthMax = 0.90;
        public const double WalkCycleSeconds = 1.12;

        public const uint DepthSalt = 0x85a308d3u;
        public const uint ChildSalt = 0x7f4a7c15u;
        public const uint WalkProfileSalt = 0x9e3779b9u;
        public const uint DwellDurationSalt = 0x3461u;

        static readonly double[] ProfileSpeeds = { 0.9, 1.15, 1.4 };

        // Mirrors game/src/sim/activities.ts ACTIVITY_DURATION (indexed by StationPassengerActivity).
        static readonly double[] ActivityDurations = {
            1, 10, 9, 10, 10, 8, 8, 10, 9, 10, 10, 10, 12, 12, 10,
        };

        /// <summary>32-bit unsigned JS <c>Math.imul</c> avalanche hash matching <c>identityHash</c>.</summary>
        public static uint IdentityHash(int id, uint salt) {
            uint h = unchecked((uint)((id ^ (int)salt) * (int)0x85ebca6bu));
            h = unchecked((uint)((int)(h ^ (h >> 16)) * (int)0xc2b2ae35u));
            return h ^ (h >> 16);
        }

        public static double IdentityUnit(int id, uint salt) =>
            IdentityHash(id, salt) / 4294967296.0;

        public static bool IsChild(int id) =>
            IdentityUnit(id, ChildSalt) < ChildChance;

        public static double RawDepth(int id) {
            double u = IdentityUnit(id, DepthSalt);
            return IsChild(id)
                ? (ChildDepthMin + u * (ChildDepthMax - ChildDepthMin)) * ChildHorizontalScale
                : DepthMin + u * (DepthMax - DepthMin);
        }

        /// <summary>0 = slow (0.9 m/s), 1 = medium (1.15 m/s), 2 = fast (1.4 m/s).</summary>
        public static int WalkProfile(int id) =>
            (int)((IdentityHash(id, WalkProfileSalt) >> 4) % 3u);

        public static double WalkProfileSpeed(int profile) =>
            (uint)profile < (uint)ProfileSpeeds.Length ? ProfileSpeeds[profile] : ProfileSpeeds[1];

        public static double WalkStride(int profile) =>
            WalkProfileSpeed(profile) * WalkCycleSeconds;

        /// <summary><c>passengerWalkSpeed(id)</c>: profile base speed × raw fore/aft depth.</summary>
        public static double WalkSpeed(int id) =>
            WalkProfileSpeed(WalkProfile(id)) * RawDepth(id);

        /// <summary>Cycle duration of one activity clip, seconds (<c>ACTIVITY_DURATION</c>).</summary>
        public static double ActivityDuration(StationPassengerActivity activity) {
            int idx = (int)activity;
            return (uint)idx < (uint)ActivityDurations.Length ? ActivityDurations[idx] : 10.0;
        }

        /// <summary>
        /// Maps elapsed dwell time inside a stop stay to the activity clip timeline
        /// (<c>activities.ts:dwellTimeline</c>): 2.5 s lead-in, looping middle, 2.0 s lead-out.
        /// </summary>
        public static double DwellTimeline(double elapsed, double total, StationPassengerActivity activity) {
            double duration = ActivityDuration(activity);
            if (elapsed < 0) elapsed = 0;
            if (elapsed < 2.5) return Math.Min(elapsed, duration);
            double remaining = total - elapsed;
            if (remaining < 2.0) return Math.Max(0, duration - Math.Max(0, remaining));
            double span = Math.Max(1.0, duration - 5.5);
            return 3.0 + ((elapsed - 2.5) % span);
        }
    }
}
