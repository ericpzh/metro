using System;
using System.Collections.Generic;
using System.Globalization;
using Metro.Build;
using Metro.Sim;
using UnityEngine;
using UnityEngine.UI;

namespace Metro.App.Views {
    /// <summary>
    /// 20 §1 — the station **clock** tells the simulation's time.
    ///
    /// The promoted `clock.glb` carries two dials (`clockFaceFront`/`clockDialFront` and the
    /// `…Back` pair) whose hands are pivots (`clockHourHand`/`clockMinuteHand` and their `2`
    /// counterparts) and whose arms are baked pointing at the export's sample time; the
    /// `clock-digital.glb` carries two LED planes (`clockDisplay`/`clockDisplay2`). The display
    /// renderer mounted both through the ordinary ceiling-fixture path and never bound a
    /// consumer, so a Zoo concourse showed 10:09 for ever — the pose the export bakes.
    ///
    /// This is the consumer. A hand keeps the pivot's imported rotation and its own dial frame
    /// (the face's outward normal plus the physical up), and is re-posed by the **delta** from
    /// the angle the export baked, so the authored sample time is subtracted rather than
    /// re-stated: `StationClock`'s hour/minute angles turn the arm the way a clock turns, on
    /// both faces (each about its own outward normal, so the far face reads the same time).
    /// The digital planes print the source's own LED readout — six seven-segment digits and the
    /// calendar row — into one retained texture per world, repainted only when the printed
    /// fields change.
    /// </summary>
    public static class StationClockArtwork {
        public const string HourPivot = "clockHourHand", MinutePivot = "clockMinuteHand";
        public const string FrontFace = "clockFaceFront", BackFace = "clockFaceBack";
        public const string DigitalPlane = "clockDisplay";
        public const int DigitalWidth = 384, DigitalHeight = 152;
        /// <summary>`CLOCK_POSE_SECONDS`: the time the models are built and exported at (10:09).</summary>
        public const double AuthoredPoseSeconds = 10 * 3600 + 9 * 60;

        /// <summary>One hand pivot in its dial's frame.</summary>
        public sealed class Hand {
            public Transform Pivot;
            public Transform Arm;
            /// <summary>The pivot's imported rotation (the export's pose lives here).</summary>
            public Quaternion Original;
            /// <summary>The dial's outward normal, in the pivot's parent frame.</summary>
            public Vector3 Axis;
            /// <summary>The viewer's right on that face, in the pivot's parent frame.</summary>
            public Vector3 Right;
            /// <summary>Physical up on that face, in the pivot's parent frame.</summary>
            public Vector3 Up;
            /// <summary>+1 when the parent hierarchy preserves handedness, −1 when reflected.</summary>
            public float Handedness = 1f;
            public bool Minute;
            /// <summary>0 = the front dial, 1 = the `2` dial.</summary>
            public int Face;
            /// <summary>The angle the arm is baked at, degrees clockwise from 12 o'clock.</summary>
            public float AuthoredDegrees;
            /// <summary>The angle last applied, degrees clockwise from 12 o'clock.</summary>
            public float AppliedDegrees;
            public override string ToString() =>
                (Minute ? "minute" : "hour") + " face" + Face + " authored=" +
                AuthoredDegrees.ToString("0.##", CultureInfo.InvariantCulture) +
                " applied=" + AppliedDegrees.ToString("0.##", CultureInfo.InvariantCulture);
        }

        /// <summary>One placed clock: its two dials' hands and its digital planes.</summary>
        public sealed class ClockEntry {
            public string ModuleId = "";
            public readonly List<Hand> Hands = new List<Hand>();
            public readonly List<MeshRenderer> Digital = new List<MeshRenderer>();
            public readonly List<StationDisplayArtwork.UprightSurface> DigitalSurfaces =
                new List<StationDisplayArtwork.UprightSurface>();
            public Material DigitalMaterial;
            public Texture2D DigitalTexture;
            public string DigitalKey = "";
            /// <summary>How many dials this clock has (two on both promoted variants).</summary>
            public int Faces;
            public int Repaints;
            public override string ToString() =>
                ModuleId + " faces=" + Faces + " hands=" + Hands.Count + " digital=" + Digital.Count;
        }

        static readonly Dictionary<StationDisplayArtwork.Scope, List<ClockEntry>> byScope =
            new Dictionary<StationDisplayArtwork.Scope, List<ClockEntry>>();
        static bool sinkRegistered;

        /// <summary>The clocks one world owns (`null`/empty before a build).</summary>
        public static IReadOnlyList<ClockEntry> EntriesFor(StationDisplayArtwork.Scope scope) =>
            scope != null && byScope.TryGetValue(scope, out var list) ? (IReadOnlyList<ClockEntry>)list : Array.Empty<ClockEntry>();

        /// <summary>
        /// Bind one placed clock: resolve both dials' hands and both digital planes, record each
        /// pivot's imported rotation and measured authored angle, and settle it on the published
        /// time. False with a ledger reason when the prefab carries no hands and no display.
        /// </summary>
        public static bool Bind(StationDisplayArtwork.Scope scope, GameObject root, ModuleFacts module,
            StationClockFrame clock) =>
            Bind(scope, root, module, clock, null);

        public static bool Bind(StationDisplayArtwork.Scope scope, GameObject root, ModuleFacts module,
            StationClockFrame clock, Metro.App.StationWorldView world) {
            if (scope == null || root == null || module == null) return false;
            var entry = new ClockEntry { ModuleId = module.Id ?? "" };
            var faces = new Dictionary<string, Vector3>(StringComparer.Ordinal);
            var digitalFound = new List<(int slot, int order, MeshRenderer renderer)>();
            int order = 0;
            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer) continue;
                foreach (var material in renderer.sharedMaterials) {
                    if (!material || material.name == null) continue;
                    int digital = SlotOf(material.name, DigitalPlane);
                    if (digital >= 0) {
                        digitalFound.Add((digital, order++, renderer));
                        break;
                    }
                }
            }
            digitalFound.Sort((a, b) => a.slot != b.slot ? a.slot.CompareTo(b.slot) : a.order.CompareTo(b.order));
            for (int d = 0; d < digitalFound.Count; d++) {
                var renderer = digitalFound[d].renderer;
                var surface = StationDisplayArtwork.BindUprightArtwork(scope, renderer);
                entry.Digital.Add(renderer);
                entry.DigitalSurfaces.Add(surface);
            }
            var front = FindNode(root.transform, FrontFace);
            var back = FindNode(root.transform, BackFace);
            if (front != null) faces["0"] = OutwardNormal(front, -root.transform.forward);
            if (back != null) faces["1"] = OutwardNormal(back, root.transform.forward);
            foreach (var pair in new[] {
                         new[] { HourPivot, "0", "hour" }, new[] { MinutePivot, "0", "minute" },
                         new[] { HourPivot + "2", "1", "hour" }, new[] { MinutePivot + "2", "1", "minute" } }) {
                var pivot = FindNode(root.transform, pair[0]);
                if (pivot == null) continue;
                if (!faces.TryGetValue(pair[1], out var outward)) {
                    outward = OutwardNormal(pivot, pair[1] == "1" ? root.transform.forward : -root.transform.forward);
                    faces[pair[1]] = outward;
                }
                var hand = Describe(pivot, outward, string.Equals(pair[2], "minute", StringComparison.Ordinal),
                    pair[1] == "1" ? 1 : 0);
                if (hand == null) continue;
                entry.Hands.Add(hand);
            }
            entry.Faces = faces.Count > 0 ? faces.Count : entry.Digital.Count;
            if (entry.Hands.Count == 0 && entry.Digital.Count == 0) {
                scope.Notes.Add("clock-unresolved:" + module.Id + ":no-hands-or-display");
                return false;
            }
            if (!byScope.TryGetValue(scope, out var list)) byScope[scope] = list = new List<ClockEntry>();
            list.Add(entry);
            Apply(scope, world, clock, 0);
            return true;
        }

        /// <summary>Resolve one hand's dial frame and the angle its arm is baked at.</summary>
        public static Hand Describe(Transform pivot, Vector3 outwardWorld, bool minute, int face) {
            if (pivot == null) return null;
            var arm = FirstMesh(pivot);
            var armCenterWorld = ArmCenterWorld(arm, pivot);
            // The dial's plane comes from the **arm itself**: an arm is a thin box standing proud
            // of its dial (`y = −0.042` in front of the pivot), so its thinnest axis oriented by
            // `armCenterWorld − pivot.position` is the exact outward normal toward the viewer on
            // both dials and at every station rotation.
            var normalWorld = ArmNormalWorld(arm, pivot, outwardWorld, armCenterWorld);
            var upWorld = Vector3.up - normalWorld * Vector3.Dot(Vector3.up, normalWorld);
            if (upWorld.sqrMagnitude < 1e-8f) {
                upWorld = Vector3.forward - normalWorld * Vector3.Dot(Vector3.forward, normalWorld);
            }
            if (upWorld.sqrMagnitude < 1e-8f) upWorld = Vector3.up;
            upWorld.Normalize();
            // In Unity's left-handed world frame, `normalWorld × upWorld` points to 3 o'clock
            // (the viewer's right when facing the dial).
            var rightWorld = Vector3.Cross(normalWorld, upWorld);
            if (rightWorld.sqrMagnitude < 1e-8f) rightWorld = Vector3.right;
            rightWorld.Normalize();

            float handedness = 1f;
            if (pivot.parent != null) {
                var lossy = pivot.parent.lossyScale;
                if (lossy.x * lossy.y * lossy.z < 0f) handedness = -1f;
            }
            var axis = pivot.parent != null ? pivot.parent.InverseTransformDirection(normalWorld) : normalWorld;
            var up = pivot.parent != null ? pivot.parent.InverseTransformDirection(upWorld) : upWorld;
            var right = pivot.parent != null ? pivot.parent.InverseTransformDirection(rightWorld) : rightWorld;
            if (axis.sqrMagnitude > 1e-10f) axis.Normalize();
            if (up.sqrMagnitude > 1e-10f) up.Normalize();
            if (right.sqrMagnitude > 1e-10f) right.Normalize();

            var hand = new Hand {
                Pivot = pivot, Arm = arm, Original = pivot.localRotation,
                Axis = axis, Up = up, Right = right, Handedness = handedness,
                Minute = minute, Face = face,
            };
            hand.AuthoredDegrees = MeasureDegrees(hand);
            return hand;
        }

        static Vector3 ArmCenterWorld(Transform arm, Transform pivot) {
            if (arm != null) {
                var filter = arm.GetComponent<MeshFilter>();
                if (filter != null && filter.sharedMesh != null) {
                    return filter.transform.TransformPoint(filter.sharedMesh.bounds.center);
                }
                return arm.position;
            }
            return pivot != null ? pivot.position : Vector3.zero;
        }

        static Vector3 ArmNormalWorld(Transform arm, Transform pivot, Vector3 outwardWorld, Vector3 armCenterWorld) {
            if (arm != null) {
                var filter = arm.GetComponent<MeshFilter>();
                if (filter != null && filter.sharedMesh != null) {
                    var size = filter.sharedMesh.bounds.size;
                    var unit = Mathf.Abs(size.x) <= Mathf.Abs(size.y) && Mathf.Abs(size.x) <= Mathf.Abs(size.z)
                        ? Vector3.right
                        : Mathf.Abs(size.y) <= Mathf.Abs(size.z) ? Vector3.up : Vector3.forward;
                    var world = filter.transform.TransformDirection(unit);
                    if (world.sqrMagnitude > 1e-10f) {
                        world.Normalize();
                        var offset = pivot != null ? armCenterWorld - pivot.position : Vector3.zero;
                        float proud = Vector3.Dot(offset, world);
                        if (Mathf.Abs(proud) > 1e-4f) {
                            if (proud < 0f) world = -world;
                        } else if (outwardWorld.sqrMagnitude > 1e-8f && Vector3.Dot(world, outwardWorld) < 0f) {
                            world = -world;
                        }
                        return world;
                    }
                }
            }
            return outwardWorld.sqrMagnitude > 1e-8f ? outwardWorld.normalized : Vector3.back;
        }

        /// <summary>
        /// The arm's angle in its dial, degrees clockwise from 12 o'clock, measured from the
        /// arm's offset from its pivot (`+len/2` toward the tip in `ClockModel.ts`) so 10:09
        /// reads `304.5°` / `54.0°` and 06:30 reads `195°` / `180°` (pointing down).
        /// </summary>
        public static float MeasureDegrees(Hand hand) {
            if (hand == null || hand.Pivot == null) return 0f;
            var parent = hand.Pivot.parent;
            var axisWorld = parent != null ? parent.TransformDirection(hand.Axis) : hand.Axis;
            var rightWorld = parent != null ? parent.TransformDirection(hand.Right) : hand.Right;
            var upWorld = parent != null ? parent.TransformDirection(hand.Up) : hand.Up;
            if (axisWorld.sqrMagnitude > 1e-10f) axisWorld.Normalize();
            if (rightWorld.sqrMagnitude > 1e-10f) rightWorld.Normalize();
            if (upWorld.sqrMagnitude > 1e-10f) upWorld.Normalize();

            var tipWorld = ArmCenterWorld(hand.Arm, hand.Pivot) - hand.Pivot.position;
            tipWorld -= axisWorld * Vector3.Dot(tipWorld, axisWorld);
            if (tipWorld.sqrMagnitude < 1e-8f) {
                tipWorld = ArmDirectionWorld(hand.Arm);
                tipWorld -= axisWorld * Vector3.Dot(tipWorld, axisWorld);
            }
            float x = Vector3.Dot(tipWorld, rightWorld), y = Vector3.Dot(tipWorld, upWorld);
            if (Mathf.Abs(x) < 1e-6f && Mathf.Abs(y) < 1e-6f) return hand.AuthoredDegrees;
            float degrees = Mathf.Atan2(x, y) * Mathf.Rad2Deg;
            return degrees < 0 ? degrees + 360f : degrees;
        }

        static Vector3 ArmDirectionWorld(Transform arm) {
            if (arm == null) return Vector3.zero;
            var filter = arm.GetComponent<MeshFilter>();
            if (filter == null || filter.sharedMesh == null) return Vector3.zero;
            var size = filter.sharedMesh.bounds.size;
            var unit = Mathf.Abs(size.x) >= Mathf.Abs(size.y) && Mathf.Abs(size.x) >= Mathf.Abs(size.z)
                ? Vector3.right
                : Mathf.Abs(size.y) >= Mathf.Abs(size.z) ? Vector3.up : Vector3.forward;
            var world = filter.transform.TransformDirection(unit);
            return world.sqrMagnitude < 1e-10f ? Vector3.zero : world.normalized;
        }

        /// <summary>The angle one hand currently reads, in its dial, clockwise from 12 o'clock.</summary>
        public static float DegreesOf(Hand hand) {
            if (hand == null || hand.Pivot == null) return 0f;
            // The arm's rest direction, turned by whatever the pivot now carries beyond its
            // imported rotation. Measured the same way the authored angle is.
            return MeasureDegrees(hand);
        }

        /// <summary>
        /// Pose every hand and repaint every digital plane from the published frame. `fraction`
        /// is the sub-tick part already elapsed (seconds), so the analogue hands sweep rather
        /// than step; a paused station passes 0 and settles on the committed time.
        /// </summary>
        public static int Apply(StationDisplayArtwork.Scope scope, StationClockFrame clock, double fraction) =>
            Apply(scope, null, clock, fraction);

        public static int Apply(StationDisplayArtwork.Scope scope, Metro.App.StationWorldView world,
            StationClockFrame clock, double fraction) {
            if (scope == null || !byScope.TryGetValue(scope, out var entries)) return 0;
            double hour = clock.HourHandDegrees, minute = clock.MinuteHandDegrees;
            if (fraction > 0 && clock.Playing) {
                // 30°/hour and 6°/minute: the source's own rates, applied to the elapsed part of
                // the tick so the sweep is continuous.
                hour += fraction * (30.0 / 3600.0);
                minute += fraction * (6.0 / 60.0);
                hour = Wrap(hour);
                minute = Wrap(minute);
            }
            int repaints = 0;
            for (int i = 0; i < entries.Count; i++) {
                var entry = entries[i];
                for (int h = 0; h < entry.Hands.Count; h++) {
                    var hand = entry.Hands[h];
                    if (hand.Pivot == null) continue;
                    double live = hand.Minute ? minute : hour;
                    double delta = live - hand.AuthoredDegrees;
                    if (delta < -180) delta += 360;
                    else if (delta > 180) delta -= 360;
                    // In Unity's left-handed frame, a positive `AngleAxis` about the face's
                    // outward normal turns 12 o'clock (+Up) clockwise toward 3 o'clock (+Right).
                    hand.Pivot.localRotation =
                        Quaternion.AngleAxis((float)delta * hand.Handedness, hand.Axis) * hand.Original;
                    hand.AppliedDegrees = (float)Wrap(live);
                }
                if (entry.Digital.Count == 0) continue;
                var key = DigitalKeyOf(clock);
                if (string.Equals(entry.DigitalKey, key, StringComparison.Ordinal) && entry.DigitalMaterial) continue;
                var texture = DigitalTexture(scope, clock, ref entry.DigitalTexture);
                if (texture == null) continue;
                if (!entry.DigitalMaterial) {
                    var template = entry.DigitalSurfaces.Count > 0 && entry.DigitalSurfaces[0]?.Template != null
                        ? entry.DigitalSurfaces[0].Template
                        : entry.Digital[0].sharedMaterial;
                    if (!template) continue;
                    entry.DigitalMaterial = new Material(template) { name = "clock display " + clock.ClockSeconds };
                    StationDisplayArtwork.ResetTextureTransform(entry.DigitalMaterial);
                    if (entry.DigitalMaterial.HasProperty("_BaseColor"))
                        entry.DigitalMaterial.SetColor("_BaseColor", Color.white);
                    else if (entry.DigitalMaterial.HasProperty("baseColorFactor"))
                        entry.DigitalMaterial.SetColor("baseColorFactor", Color.white);
                    scope.Materials["clock-display|" + entry.ModuleId] = entry.DigitalMaterial;
                }
                StationDisplayArtwork.SetTexture(entry.DigitalMaterial, texture);
                for (int d = 0; d < entry.Digital.Count; d++) {
                    entry.Digital[d].sharedMaterial = entry.DigitalMaterial;
                    world?.RecaptureArtwork(entry.Digital[d]);
                }
                entry.DigitalKey = key;
                entry.Repaints++;
                repaints++;
            }
            return repaints;
        }

        static double Wrap(double degrees) {
            double value = degrees % 360.0;
            return value < 0 ? value + 360.0 : value;
        }

        /// <summary>The printed fields of the LED display (time to the second, and the day).</summary>
        public static string DigitalKeyOf(StationClockFrame clock) =>
            "led|" + clock.ClockSeconds + "|" + clock.DateKey + "|" + clock.Weekday;

        static Texture2D DigitalTexture(StationDisplayArtwork.Scope scope, StationClockFrame clock,
            ref Texture2D cached) {
            var next = PaintDigital(clock);
            if (next == null) return cached;
            if (cached) {
                scope.Textures.Remove(cached);
                if (Application.isPlaying) UnityEngine.Object.Destroy(cached);
                else UnityEngine.Object.DestroyImmediate(cached);
            }
            cached = next;
            scope.Textures.Add(cached);
            return cached;
        }

        /// <summary>
        /// The digital dial, ported from `ClockModel.updateDigitalClock`: six seven-segment digits
        /// at the source's own digit positions and segment rectangles, the two colon pairs, and
        /// the calendar row beneath (`YYYY年 MM月 DD日 星期X`).
        /// </summary>
        public static Texture2D PaintDigital(StationClockFrame clock) {
            RenderTexture previous = RenderTexture.active;
            RenderTexture target = null;
            GameObject cameraObject = null, canvasObject = null;
            Texture2D texture = null;
            try {
                target = RenderTexture.GetTemporary(DigitalWidth, DigitalHeight, 0, RenderTextureFormat.ARGB32,
                    RenderTextureReadWrite.sRGB);
                cameraObject = new GameObject("clock display camera");
                var camera = cameraObject.AddComponent<Camera>();
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(.063f, .063f, .075f, 1f);
                camera.orthographic = true;
                camera.orthographicSize = DigitalHeight * .5f;
                camera.nearClipPlane = .01f;
                camera.farClipPlane = 100f;
                camera.transform.position = new Vector3(DigitalWidth * .5f, DigitalHeight * .5f, -10f);
                camera.targetTexture = target;
                canvasObject = new GameObject("clock display canvas", typeof(Canvas));
                var canvas = canvasObject.GetComponent<Canvas>();
                canvas.renderMode = RenderMode.WorldSpace;
                var rect = canvasObject.GetComponent<RectTransform>();
                rect.sizeDelta = new Vector2(DigitalWidth, DigitalHeight);
                rect.position = new Vector3(DigitalWidth * .5f, DigitalHeight * .5f, 0f);
                rect.localScale = Vector3.one;
                var root = canvasObject.transform;
                // The calendar row's own ground, then the LED's.
                Solid(root, 0f, 0f, DigitalWidth, DigitalHeight, new Color(.063f, .063f, .075f, 1f));
                Solid(root, 0f, 0f, DigitalWidth, 103f, new Color(.063f, .063f, .075f, 1f));
                var digits = LedDigits(clock);
                for (int i = 0; i < digits.Length && i < LedDigitX.Length; i++) {
                    int mask = LedMasks[digits[i] - '0'];
                    for (int segment = 0; segment < LedSegments.Length; segment++) {
                        if ((mask & (1 << segment)) == 0) continue;
                        var run = LedSegments[segment];
                        Solid(root, LedDigitX[i] + run[0] - run[2] * .5f, 53f + run[1] - run[3] * .5f, run[2], run[3],
                            new Color(1f, .204f, .141f, 1f));
                    }
                }
                foreach (var x in new[] { 136f, 245f }) {
                    foreach (var y in new[] { 40f, 66f }) {
                        Solid(root, x, y, 6f, 6f, new Color(1f, .204f, .141f, 1f));
                    }
                }
                var row = new GameObject("calendar", typeof(RectTransform));
                row.transform.SetParent(root, false);
                var ui = row.AddComponent<Text>();
                ui.font = StationTvPlatePainter.StationUiFont();
                ui.text = CalendarText(clock);
                ui.fontSize = 27;
                ui.fontStyle = FontStyle.Bold;
                ui.color = new Color(.898f, .890f, .874f, 1f);
                ui.alignment = TextAnchor.MiddleCenter;
                ui.supportRichText = true;
                ui.horizontalOverflow = HorizontalWrapMode.Overflow;
                ui.verticalOverflow = VerticalWrapMode.Overflow;
                ui.raycastTarget = false;
                var rowRect = (RectTransform)row.transform;
                rowRect.anchorMin = rowRect.anchorMax = new Vector2(0f, 1f);
                rowRect.pivot = new Vector2(0f, 1f);
                rowRect.sizeDelta = new Vector2(DigitalWidth, 49f);
                rowRect.anchoredPosition = new Vector2(0f, -103f);
                camera.Render();
                RenderTexture.active = target;
                texture = new Texture2D(DigitalWidth, DigitalHeight, TextureFormat.RGBA32, false) {
                    name = "clock display " + Stable(DigitalKeyOf(clock)),
                    wrapMode = TextureWrapMode.Clamp,
                };
                texture.ReadPixels(new Rect(0, 0, DigitalWidth, DigitalHeight), 0, 0);
                texture.Apply(false, false);
            } finally {
                RenderTexture.active = previous;
                if (cameraObject) UnityEngine.Object.DestroyImmediate(cameraObject);
                if (canvasObject) UnityEngine.Object.DestroyImmediate(canvasObject);
                if (target != null) RenderTexture.ReleaseTemporary(target);
            }
            return texture;
        }

        static void Solid(Transform root, float x, float y, float width, float height, Color colour) {
            var go = new GameObject("segment", typeof(RectTransform));
            go.transform.SetParent(root, false);
            var rect = (RectTransform)go.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            rect.sizeDelta = new Vector2(width, height);
            rect.anchoredPosition = new Vector2(x, -y);
            var image = go.AddComponent<Image>();
            image.color = colour;
            image.raycastTarget = false;
        }

        // ---- the source's LED tables (`ClockModel.ts`) -------------------------------------
        static readonly int[][] LedSegments = {
            new[] { 0, -34, 22, 5 }, new[] { 13, -17, 5, 26 }, new[] { 13, 17, 5, 26 },
            new[] { 0, 34, 22, 5 }, new[] { -13, 17, 5, 26 }, new[] { -13, -17, 5, 26 }, new[] { 0, 0, 22, 5 },
        };
        static readonly int[] LedMasks = { 0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f };
        static readonly int[] LedDigitX = { 61, 105, 170, 214, 279, 323 };
        const string WeekdayInk = "日一二三四五六";

        /// <summary>`HHMMSS`: the six digits the LED prints (`clockTextOf(second)` plus seconds).</summary>
        public static string LedDigits(StationClockFrame clock) {
            int total = clock.TimeOfDaySeconds;
            if (total < 0) total = 0;
            int hour = (total / 3600) % 24, minute = (total / 60) % 60, second = total % 60;
            return hour.ToString("00", CultureInfo.InvariantCulture) + minute.ToString("00", CultureInfo.InvariantCulture) +
                second.ToString("00", CultureInfo.InvariantCulture);
        }

        /// <summary>`YYYY年 MM月 DD日 星期X` with the numbers in the LED's red, as the source prints.</summary>
        public static string CalendarText(StationClockFrame clock) {
            var key = clock.DateKey ?? "";
            var parts = key.Split('-');
            int year = 0, month = 0, day = 0;
            if (parts.Length >= 3) {
                int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out year);
                int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out month);
                int.TryParse(parts[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out day);
            }
            int weekday = clock.Weekday;
            if (weekday < 0 || weekday > 6) weekday = 0;
            const string red = "<color=#ff3424>";
            return red + year.ToString("0000", CultureInfo.InvariantCulture) + "</color>年 " +
                red + month.ToString("00", CultureInfo.InvariantCulture) + "</color>月 " +
                red + day.ToString("00", CultureInfo.InvariantCulture) + "</color>日 星期" + WeekdayInk[weekday];
        }

        static string Stable(string text) {
            uint hash = 2166136261u;
            foreach (var ch in text ?? "") {
                hash ^= ch;
                hash *= 16777619u;
            }
            return hash.ToString("x8", CultureInfo.InvariantCulture);
        }

        /// <summary>The slot a printed surface names: base for `clockDisplay`, pair for `…2`.</summary>
        static int SlotOf(string materialName, string tag) {
            if (string.IsNullOrEmpty(materialName)) return -1;
            int index = materialName.IndexOf(tag, StringComparison.OrdinalIgnoreCase);
            if (index < 0) return -1;
            int after = index + tag.Length;
            while (after < materialName.Length && (materialName[after] == ' ' || materialName[after] == '_')) after++;
            return after < materialName.Length && materialName[after] == '2' ? 1 : 0;
        }

        static Transform FindNode(Transform root, string name) {
            if (root == null) return null;
            if (string.Equals(root.name, name, StringComparison.OrdinalIgnoreCase)) return root;
            for (int i = 0; i < root.childCount; i++) {
                var found = FindNode(root.GetChild(i), name);
                if (found != null) return found;
            }
            return null;
        }

        static Transform FirstMesh(Transform pivot) {
            for (int i = 0; i < pivot.childCount; i++) {
                var child = pivot.GetChild(i);
                if (child.GetComponent<MeshFilter>() != null) return child;
            }
            var filter = pivot.GetComponent<MeshFilter>();
            return filter != null ? pivot : null;
        }

        /// <summary>The dial's outward normal from its own face mesh, in the node's parent frame.</summary>
        static Vector3 OutwardNormal(Transform face, Vector3 fallback) {
            var filter = face.GetComponent<MeshFilter>();
            if (filter == null || filter.sharedMesh == null) return fallback;
            var normals = filter.sharedMesh.normals;
            if (normals == null || normals.Length == 0) return fallback;
            var sum = Vector3.zero;
            for (int i = 0; i < normals.Length; i++) sum += normals[i];
            if (sum.sqrMagnitude < 1e-10f) return fallback;
            return face.TransformDirection(sum.normalized);
        }

        public static void Reset() {
            byScope.Clear();
        }

        /// <summary>
        /// The frame sink: the clock is read-only display state, so it is driven from the
        /// published frame and never touches the document. A seek/restart (`Epoch`) forces the des
        /// next update to settle exactly on the committed time instead of interpolating across the
        /// discontinuity.
        /// </summary>
        sealed class Sink : IStationFrameSink {
            public void Tick(StationDocument document, StationIndex index, StationFrameClock clock) {
                var current = StationDisplayModuleRenderer.Active != null
                    ? StationDisplayModuleRenderer.Active.Current
                    : null;
                var scope = current?.Displays;
                if (scope == null) return;
                var host = StationGameHost.ResolveActive();
                var session = host != null ? (host.Simulation as StationSimulationHost)?.Session : null;
                if (session == null) return;
                var frame = session.Snapshot();
                double fraction = clock.Playing ? clock.Fraction * StationSimConstants.SimSecondsPerTick : 0;
                Apply(scope, current.World, frame.Clock, fraction);
            }
        }

        public static void RegisterSink() {
            if (sinkRegistered) return;
            sinkRegistered = true;
            StationFrameSinks.Add(new Sink());
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() => RegisterSink();
    }
}
