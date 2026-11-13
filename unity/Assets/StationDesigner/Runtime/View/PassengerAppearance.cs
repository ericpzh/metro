using System;
using UnityEngine;

namespace Metro.View {
    /// <summary>The source's activity kinds, in atlas order (<c>sim/activities.ts</c>).</summary>
    public enum PassengerActivity {
        Walk = 0, Sit = 1, Shop = 2, Ticket = 3, Vending = 4, Qr = 5, Card = 6,
        Escalator = 7, Lift = 8, Toilet = 9, Wash = 10, Door = 11, Wait = 12, Queue = 13,
        EscalatorLeft = 14,
    }

    /// <summary>Prepared crowd topology. Both animate the same recipe's rig.</summary>
    public enum PassengerDetail { Full = 0, Low = 1 }

    /// <summary>Age is a runtime scale of one recipe, never a separate recipe row.</summary>
    public enum PassengerAge { Adult = 0, Child = 1 }

    /// <summary>Agent render state values that change how travel is measured (<c>sim/types.ts</c>).</summary>
    public enum PassengerMotionState {
        Arriving = 0, Walking = 1, Queuing = 2, Buying = 3, Browsing = 4, Waiting = 5,
        Riding = 6, Alighting = 7, Leaving = 8, StairWalking = 9,
    }

    /// <summary>
    /// One passenger's identity-driven appearance, exactly the source's
    /// <c>passengerAppearance</c> tuple: recipe (outfit index), height, depth,
    /// width and tone. Height/depth/width are the **displayed** factors (the
    /// source's 0.98 storey/train visual scale is already applied); the raw
    /// proportions are kept because walk speed uses them.
    /// </summary>
    public struct PassengerLook {
        public int SimId;
        public int OutfitIndex;
        public string Recipe;
        public PassengerAge Age;
        public bool IsChild;
        public PassengerDetail Detail;
        /// <summary>Displayed height factor (raw height × 0.98).</summary>
        public double Height;
        /// <summary>Displayed fore/aft depth factor (raw depth × 0.98).</summary>
        public double Depth;
        /// <summary>Displayed lateral width factor (raw width × 0.98).</summary>
        public double Width;
        /// <summary>Ink tone multiplier, 0.90–1.05.</summary>
        public double Tone;
        public double RawHeight;
        public double RawDepth;
        public double RawWidth;
        public int WalkProfile;
        public double WalkStride;
        public double WalkCycleSeconds;
        /// <summary>The walk profile's first baked atlas frame (1, 25 or 49).</summary>
        public int WalkFirstFrame;
        /// <summary><c>WALK_PROFILES[profile].speed × raw depth</c> (source <c>passengerWalkSpeed</c>).</summary>
        public double WalkSpeed;
        public PassengerCatalogueEntry Entry;
        public bool Resolved => OutfitIndex >= 0 && !string.IsNullOrEmpty(Recipe);
        public override string ToString() =>
            (Recipe.Length > 0 ? Recipe : "unresolved") + " #" + SimId + (IsChild ? " child" : " adult") +
            " h=" + Height.ToString("F4") + " d=" + Depth.ToString("F4") + " w=" + Width.ToString("F4") +
            " tone=" + Tone.ToString("F4");
    }

    /// <summary>One travel-driven gait sample: the atlas frames and the clip time.</summary>
    public struct PassengerGait {
        /// <summary>Fractional frame inside the profile clip, 0–24.</summary>
        public double Frame;
        /// <summary>Atlas frame index of the first sample (includes the profile offset).</summary>
        public int FrameA;
        /// <summary>Atlas frame index of the second sample.</summary>
        public int FrameB;
        /// <summary>Linear blend between the two samples, 0–1.</summary>
        public double Blend;
        /// <summary>Idle→walk weight published by the simulation.</summary>
        public double Weight;
        /// <summary>Seconds into the active profile's walking clip (a 1.12 s cycle).</summary>
        public double SampleTime;
    }

    /// <summary>
    /// Port of the source appearance, age/size, gait and activity-arm selection.
    ///
    /// **Unsigned JS hash semantics**: every hash is a 32-bit multiply
    /// (<c>Math.imul</c>) followed by an unsigned shift, so the C# port works in
    /// <c>uint</c> and wraps exactly. Sizes and tones are doubles so the values
    /// compare bit-for-bit with the TypeScript oracle
    /// (<c>tools/unity-parity/record-passenger-appearance.mjs</c>); only the final
    /// transform scale is float.
    /// </summary>
    public static class PassengerAppearance {
        /// <summary><c>PASSENGER_CHILD_CHANCE</c> = 20 %.</summary>
        public const double ChildChance = 0.20;
        /// <summary><c>PASSENGER_CHILD_SCALE.height</c>.</summary>
        public const double ChildHeightScale = 0.65;
        /// <summary><c>PASSENGER_CHILD_SCALE.depth</c>/<c>.width</c>.</summary>
        public const double ChildHorizontalScale = 0.70;
        public const double HeightMin = 0.80;
        public const double HeightMax = 1.20;
        public const double DepthMin = 0.90;
        public const double DepthMax = 1.10;
        public const double WidthMin = 0.90;
        public const double WidthMax = 1.10;
        public const double ChildDepthMin = 0.80;
        public const double ChildDepthMax = 0.90;
        public const double ChildWidthMin = 0.80;
        public const double ChildWidthMax = 0.90;
        public const double ToneMin = 0.90;
        public const double ToneSpan = 0.15;
        /// <summary>The renderer's common visual scale (<c>trainScaleForStorey()</c> = 0.98).</summary>
        public const double VisualScale = 0.98;
        /// <summary><c>PASSENGER_EYE_HEIGHT</c>, metres before the height factor.</summary>
        public const double EyeHeight = 1.48;
        /// <summary><c>PASSENGER_WALK_FRAMES</c>: 24 samples per 1.12 s cycle.</summary>
        public const int WalkFrames = 24;
        /// <summary><c>ACTIVITY_SAMPLES</c> for the belt-side timeline.</summary>
        public const int ActivitySamples = 24;

        /// <summary>The source's identity salt for height.</summary>
        public const uint HeightSalt = 0x243f6a88;
        /// <summary>The source's identity salt for depth (and walk speed).</summary>
        public const uint DepthSalt = 0x85a308d3;
        /// <summary>The source's identity salt for width.</summary>
        public const uint WidthSalt = 0x13198a2e;
        /// <summary>The source's identity salt for tone.</summary>
        public const uint ToneSalt = 0x03707344;
        /// <summary>The source's identity salt for child selection.</summary>
        public const uint ChildSalt = 0x7f4a7c15;
        /// <summary>The source's identity salt for the recipe pool.</summary>
        public const uint OutfitSalt = 0x51ed270b;
        /// <summary><c>identityHash</c>'s default salt, used by the walk profile.</summary>
        public const uint ProfileSalt = 0x9e3779b9;

        /// <summary>Activity names, in atlas order (<c>ACTIVITY_NAMES</c>).</summary>
        public static readonly string[] ActivityNames = {
            "walk", "sit", "shop", "ticket", "vending", "qr", "card", "escalator", "lift",
            "toilet", "wash", "door", "wait", "queue", "escalator-left",
        };

        /// <summary>Activity durations in seconds (<c>ACTIVITY_DURATION</c>).</summary>
        public static readonly double[] ActivityDurations = {
            1, 10, 9, 10, 10, 8, 8, 10, 9, 10, 10, 10, 12, 12, 10,
        };

        /// <summary>The manifest's walk profiles; the catalogue normally supplies them.</summary>
        public static readonly PassengerWalkProfileSpec[] DefaultWalkProfiles = {
            // 0.9 m/s × 1.12 s = 1.0080000000000002 m in IEEE double; keep the exact
            // source value (the bake records it) so frame times compare bit-for-bit.
            new PassengerWalkProfileSpec { name = "slow", speed = 0.9, cycleSeconds = 1.12, stride = 1.0080000000000002, firstFrame = 1 },
            new PassengerWalkProfileSpec { name = "medium", speed = 1.15, cycleSeconds = 1.12, stride = 1.288, firstFrame = 25 },
            new PassengerWalkProfileSpec { name = "fast", speed = 1.4, cycleSeconds = 1.12, stride = 1.568, firstFrame = 49 },
        };

        /// <summary>32-bit multiply with JavaScript <c>Math.imul</c> wrap semantics.</summary>
        public static int Imul(int a, int b) => unchecked(a * b);

        /// <summary>
        /// Port of <c>identityHash(id, salt)</c> in <c>sim/walking.ts</c>: two
        /// <c>Math.imul</c> rounds and unsigned shifts, returned as a uint.
        /// </summary>
        public static uint IdentityHash(int id, uint salt) {
            int first = Imul(unchecked(id ^ unchecked((int)salt)), unchecked((int)0x85ebca6b));
            uint hash = unchecked((uint)first);
            int second = Imul(unchecked((int)(hash ^ (hash >> 16))), unchecked((int)0xc2b2ae35));
            hash = unchecked((uint)second);
            return hash ^ (hash >> 16);
        }

        /// <summary><c>identityHash(...) / 2^32</c>, the source's [0,1) identity random.</summary>
        public static double IdentityUnit(int id, uint salt) => IdentityHash(id, salt) / 4294967296.0;

        /// <summary><c>passengerIsChild</c>: 20 % of stable identities.</summary>
        public static bool IsChild(int simId) => IdentityUnit(simId, ChildSalt) < ChildChance;

        public static PassengerAge AgeOf(int simId) => IsChild(simId) ? PassengerAge.Child : PassengerAge.Adult;

        /// <summary>
        /// Port of <c>passengerProportions</c>: height, fore/aft depth, lateral width
        /// and tone each come from their own identity hash, so a tall passenger need
        /// not be wide. Children scale height 0.65 and both horizontal axes 0.70.
        /// </summary>
        public static void Proportions(int simId, out double height, out double depth, out double width, out double tone) {
            bool child = IsChild(simId);
            double heightSpread = HeightMax - HeightMin;
            double depthSpread = child ? ChildDepthMax - ChildDepthMin : DepthMax - DepthMin;
            double widthSpread = child ? ChildWidthMax - ChildWidthMin : WidthMax - WidthMin;
            double depthMin = child ? ChildDepthMin : DepthMin;
            double widthMin = child ? ChildWidthMin : WidthMin;
            height = (HeightMin + IdentityUnit(simId, HeightSalt) * heightSpread) * (child ? ChildHeightScale : 1.0);
            depth = (depthMin + IdentityUnit(simId, DepthSalt) * depthSpread) * (child ? ChildHorizontalScale : 1.0);
            width = (widthMin + IdentityUnit(simId, WidthSalt) * widthSpread) * (child ? ChildHorizontalScale : 1.0);
            tone = ToneMin + IdentityUnit(simId, ToneSalt) * ToneSpan;
        }

        /// <summary><c>passengerWalkProfile</c>: <c>(identityHash(id) &gt;&gt;&gt; 4) % 3</c>.</summary>
        public static int WalkProfile(int simId) => (int)((IdentityHash(simId, ProfileSalt) >> 4) % 3u);

        /// <summary>
        /// Port of <c>passengerAppearance</c>: proportions, the 0.98 visual scale, then
        /// the recipe from the ordered eligible pool. The pool index is selected by a
        /// separate identity hash, so appearance, size and gait are independent.
        /// </summary>
        public static PassengerLook Look(PassengerCatalogue catalogue, int simId, PassengerDetail detail = PassengerDetail.Full) {
            Proportions(simId, out var rawHeight, out var rawDepth, out var rawWidth, out var tone);
            var look = new PassengerLook {
                SimId = simId,
                Detail = detail,
                IsChild = IsChild(simId),
                Height = rawHeight * VisualScale,
                Depth = rawDepth * VisualScale,
                Width = rawWidth * VisualScale,
                Tone = tone,
                RawHeight = rawHeight,
                RawDepth = rawDepth,
                RawWidth = rawWidth,
                OutfitIndex = -1,
                Recipe = "",
            };
            look.Age = look.IsChild ? PassengerAge.Child : PassengerAge.Adult;
            int profile = WalkProfile(simId);
            var spec = catalogue != null ? catalogue.WalkProfile(profile) : DefaultWalkProfiles[profile];
            look.WalkProfile = profile;
            look.WalkStride = spec.stride;
            look.WalkCycleSeconds = spec.cycleSeconds;
            look.WalkFirstFrame = spec.firstFrame;
            // passengerWalkSpeed: profile speed × the *raw* fore/aft proportion.
            look.WalkSpeed = spec.speed * rawDepth;
            if (catalogue != null) {
                int at = catalogue.SelectIndex(IdentityHash(simId, OutfitSalt), look.IsChild);
                if (catalogue.TryGetAt(at, out var entry)) {
                    look.OutfitIndex = at;
                    look.Recipe = entry.recipe;
                    look.Entry = entry;
                }
            }
            return look;
        }

        /// <summary>
        /// Port of <c>passengerFrames</c> with the source's second argument: the
        /// renderer divides travelled metres by the displayed depth before the gait
        /// division, so fore/aft scaling changes the physical step length. Uses the
        /// look's own walk profile.
        /// </summary>
        public static PassengerGait Gait(in PassengerLook look, double distanceMetres, double phase, double weight) =>
            Gait(look, look.WalkProfile, distanceMetres, phase, weight);

        /// <summary>Gait for an explicit profile (the oracle covers all three).</summary>
        public static PassengerGait Gait(in PassengerLook look, int profile, double distanceMetres, double phase, double weight) {
            int safeProfile = profile < 0 ? 0 : profile >= DefaultWalkProfiles.Length ? DefaultWalkProfiles.Length - 1 : profile;
            double stride;
            double cycle;
            int firstFrame;
            if (safeProfile == look.WalkProfile && look.WalkStride > 0 && look.WalkCycleSeconds > 0) {
                stride = look.WalkStride;
                cycle = look.WalkCycleSeconds;
                firstFrame = look.WalkFirstFrame;
            } else {
                var spec = DefaultWalkProfiles[safeProfile];
                stride = spec.stride;
                cycle = spec.cycleSeconds;
                firstFrame = spec.firstFrame;
            }
            double depth = look.Depth > 0 ? look.Depth : 1.0;
            double frame = (((phase + distanceMetres / depth / stride) % 1.0 + 1.0) % 1.0) * WalkFrames;
            int first = (int)Math.Floor(frame);
            return new PassengerGait {
                Frame = frame,
                FrameA = first + firstFrame,
                FrameB = (first + 1) % WalkFrames + firstFrame,
                Blend = frame - first,
                Weight = weight,
                SampleTime = frame / WalkFrames * cycle,
            };
        }

        /// <summary>
        /// Port of <c>passengerWalkDistance</c>: riding keeps planted feet, stair
        /// travel includes the rise. <paramref name="dx"/>/<paramref name="dy"/> are
        /// plan deltas, <paramref name="dz"/> the elevation delta.
        /// </summary>
        public static double WalkDistance(PassengerMotionState state, double dx, double dy, double dz) {
            if (state == PassengerMotionState.Riding) return 0;
            double horizontal = dx * dx + dy * dy;
            if (state == PassengerMotionState.StairWalking) horizontal += dz * dz;
            return Math.Sqrt(horizontal);
        }

        /// <summary>The Unity yaw that points the prefab's local +Z along a document heading.</summary>
        public static Quaternion Rotation(double documentHeadingRadians) =>
            Quaternion.Euler(0f, (float)(90.0 - documentHeadingRadians * 180.0 / Math.PI), 0f);

        /// <summary>
        /// The prefab's local scale for one look. The imported soft-human body is
        /// Y-up with X lateral and Z fore/aft, so the displayed factors map
        /// (width, height, depth) — the source's three.js mesh used its own
        /// Z-up basis. The prefab's feet sit at local Y≈0, so this is a feet pivot.
        /// </summary>
        public static Vector3 LocalScale(in PassengerLook look) =>
            new Vector3((float)look.Width, (float)look.Height, (float)look.Depth);

        /// <summary><c>passengerActionMode</c>: 0 default/two hands, 1 right only, 2 left only.</summary>
        public static int ActionMode(int simId, PassengerCatalogueEntry entry, PassengerActivity activity, int preferred = 0) {
            int kind = (int)activity;
            if (kind == 0 || kind == 1 || kind == 9 || kind == 12 || kind == 13) return 0;
            bool handOwned = entry != null &&
                (string.Equals(entry.accessoryType, "purse", StringComparison.Ordinal) ||
                 string.Equals(entry.accessoryType, "handbag", StringComparison.Ordinal));
            if (handOwned) return string.Equals(entry.accessorySide, "right", StringComparison.Ordinal) ? 2 : 1;
            if (preferred == 1 || preferred == 2) return preferred;
            if (kind == 7) return 1;
            if (kind == 14) return 2;
            if (kind == 10) return 0;
            int salt = unchecked(0x6a09e667 ^ (kind * 0x45d9f3b));
            return IdentityUnit(simId, unchecked((uint)salt)) < 0.5 ? 1 : 2;
        }

        /// <summary>
        /// <c>passengerDisplayedActivity</c>: a purse/handbag switches the escalator
        /// belt-side clip on the narrow half of the timeline, where that hand is
        /// carrying.
        /// </summary>
        public static PassengerActivity DisplayedActivity(PassengerActivity activity, PassengerCatalogueEntry entry, double time) {
            if (entry == null) return activity;
            bool handOwned = string.Equals(entry.accessoryType, "purse", StringComparison.Ordinal) ||
                             string.Equals(entry.accessoryType, "handbag", StringComparison.Ordinal);
            if (!handOwned) return activity;
            bool right = string.Equals(entry.accessorySide, "right", StringComparison.Ordinal);
            int band = (int)Math.Floor((time / 10.0 * (ActivitySamples - 1) + 0.01) / 6.0);
            bool wide = band % 2 == 1;
            if (!wide && (((int)activity == 7 && right) || ((int)activity == 14 && !right)))
                return activity == PassengerActivity.Escalator ? PassengerActivity.EscalatorLeft : PassengerActivity.Escalator;
            return activity;
        }

        /// <summary><c>passengerActionChannel</c>: profile + 3 × hand mode.</summary>
        public static int ActionChannel(int simId, PassengerCatalogueEntry entry, PassengerActivity activity, int profile, int preferred = 0) =>
            profile + DefaultWalkProfiles.Length * ActionMode(simId, entry, activity, preferred);

        /// <summary>The profile's walking clip name (the atlas's walk rows).</summary>
        public static string WalkClipName(int profile) =>
            profile <= 0 ? "WalkSlow" : profile == 1 ? "Walk" : "WalkFast";

        /// <summary>
        /// The clip name for an activity and hand mode. The walk row keeps the
        /// profile's own clip; every activity has a default, right-hand and left-hand
        /// clip in the recipe's 49-clip set.
        /// </summary>
        public static string ClipName(PassengerActivity activity, int walkProfile, int handMode) {
            if (activity == PassengerActivity.Walk) return WalkClipName(walkProfile);
            string suffix = handMode == 1 ? "_Right" : handMode == 2 ? "_Left" : "";
            switch (activity) {
                case PassengerActivity.Sit: return "Sit" + suffix;
                case PassengerActivity.Shop: return "Shop" + suffix;
                case PassengerActivity.Ticket: return "Ticket" + suffix;
                case PassengerActivity.Vending: return "Vending" + suffix;
                case PassengerActivity.Qr: return "QR" + suffix;
                case PassengerActivity.Card: return "Card" + suffix;
                case PassengerActivity.Escalator: return "Escalator" + suffix;
                case PassengerActivity.Lift: return "Lift" + suffix;
                case PassengerActivity.Toilet: return "Toilet" + suffix;
                case PassengerActivity.Wash: return "Wash" + suffix;
                case PassengerActivity.Door: return "Door" + suffix;
                case PassengerActivity.Wait: return "Wait" + suffix;
                case PassengerActivity.Queue: return "Queue" + suffix;
                case PassengerActivity.EscalatorLeft: return "EscalatorLeft" + suffix;
                default: return WalkClipName(walkProfile);
            }
        }

        /// <summary>
        /// Normalized activity time, port of the activity shader's
        /// <c>clamp(time / duration, 0, 1)</c>. Wait/queue loop; every other gesture
        /// holds its last sample.
        /// </summary>
        public static double ActivityPhase(PassengerActivity activity, double seconds) {
            double duration = ActivityDurations[(int)activity];
            if (activity == PassengerActivity.Wait || activity == PassengerActivity.Queue) {
                double wrapped = seconds % duration;
                if (wrapped < 0) wrapped += duration;
                return wrapped / duration;
            }
            double phase = seconds / duration;
            return phase < 0 ? 0 : phase > 1 ? 1 : phase;
        }

        /// <summary>The seconds into the activity clip to sample.</summary>
        public static double ActivitySampleTime(PassengerActivity activity, double seconds, double clipLength) {
            double duration = clipLength > 0 ? clipLength : ActivityDurations[(int)activity];
            double phase = ActivityPhase(activity, seconds);
            // The phase source is the authored duration; when the clip length and the
            // table agree (it does for every imported clip) this is the same number.
            return phase * duration;
        }

        public static PassengerActivity ActivityFromName(string name) {
            if (string.IsNullOrEmpty(name)) return PassengerActivity.Walk;
            for (int i = 0; i < ActivityNames.Length; i++) {
                if (string.Equals(ActivityNames[i], name, StringComparison.Ordinal)) return (PassengerActivity)i;
            }
            return PassengerActivity.Walk;
        }

        public static string ActivityName(PassengerActivity activity) => ActivityNames[(int)activity];
    }
}
