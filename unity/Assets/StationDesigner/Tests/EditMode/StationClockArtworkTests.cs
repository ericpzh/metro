using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// 20 §1 — the station clock tells the **simulation's** time.
    ///
    /// Both promoted clocks are double-faced and the export bakes a sample pose into the geometry
    /// (10:09, `CLOCK_POSE_SECONDS`), so a binder that simply turns a pivot to the live angle
    /// double-counts the sample. A hand keeps its imported rotation and its own dial frame and is
    /// re-posed by the delta from the angle measured off its **tip**. The digital dial prints the
    /// source's own LED readout into one retained texture; Zoo ships analogue clocks only, so that
    /// painter is pinned directly against the published frame.
    /// </summary>
    public sealed class StationClockArtworkTests {
        const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";
        const string FontPath = "Assets/StationDesigner/Fonts/NotoSansSC.ttf";

        static StationDocument zoo;
        static RuntimeCatalogue catalogue;
        static Shader shader;
        static Font font;

        [OneTimeSetUp]
        public void Load() {
            var read = StationDocumentReader.ReadFile(ZooPath);
            Assert.IsNotNull(read?.Document, "the Zoo document must load");
            zoo = read.Document;
            catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "runtime catalogue asset missing");
            shader = StationFinishLibrary.FindShader();
            Assert.IsNotNull(shader, "the station finish shader is missing");
            font = AssetDatabase.LoadAssetAtPath<Font>(FontPath);
            Assert.IsNotNull(font, "the CJK font is missing");
        }

        sealed class Built {
            public GameObject Root;
            public StationDisplayModuleRenderer Display;
            public StationWorldView World;
        }

        Built Build(StationDocument document, string name) {
            var root = new GameObject(name);
            var display = new StationDisplayModuleRenderer();
            var world = new StationWorldView(root.transform, name, new IStationViewRenderer[] { display },
                new StationViewAssets { Catalogue = catalogue, Shader = shader, Font = font });
            world.Build(document, new StationIndex(document));
            world.Activate();
            return new Built { Root = root, Display = display, World = world };
        }

        static void Dispose(Built built) {
            built.World?.Dispose();
            if (built.Root) UnityEngine.Object.DestroyImmediate(built.Root);
        }

        static StationClockFrame Clock(double seconds, string dateKey = "2026-01-01", int weekday = 4,
            bool playing = false) {
            int total = (int)System.Math.Floor(seconds);
            int hour = (total / 3600) % 24, minute = (total / 60) % 60, second = total % 60;
            string text = hour.ToString("00") + ":" + minute.ToString("00");
            return new StationClockFrame {
                Playing = playing, DateKey = dateKey, Weekday = weekday, TimeOfDaySeconds = total,
                Clock = text, ClockSeconds = text + ":" + second.ToString("00"),
                HourHandDegrees = (seconds % 43200) / 3600 * 30,
                MinuteHandDegrees = (seconds % 3600) / 60 * 6,
            };
        }

        static IEnumerable<StationClockArtwork.ClockEntry> Analogue(StationDisplayArtwork.Scope scope) =>
            StationClockArtwork.EntriesFor(scope).Where(entry => entry.Hands.Count > 0).ToList();

        /// <summary>
        /// Both dials, at the two times the plan names. The angles are measured back off the
        /// **geometry**, so a sign error in the handedness or a re-stated sample pose shows up as a
        /// wrong reading rather than as a passing internal value.
        /// </summary>
        [Test]
        public void AnalogueDialsBindBothFacesAndReadTheSimulationTime() {
            var run = Build(zoo, "clocks");
            try {
                var scope = run.Display.Current.Displays;
                var entries = Analogue(scope).ToList();
                Assert.Greater(entries.Count, 0, "the Zoo clocks bound their hands: " +
                    string.Join("; ", scope.Notes.Take(6)));
                foreach (var entry in entries) {
                    Assert.AreEqual(2, entry.Faces, entry.ModuleId + " is a double-faced clock");
                    Assert.AreEqual(4, entry.Hands.Count, entry.ModuleId + " binds both faces' two hands");
                    Assert.AreEqual(0, entry.Digital.Count, entry.ModuleId + " is analogue and has no LED plane");
                }
                foreach (var (seconds, hour, minute) in new[] {
                             (6.0 * 3600 + 30 * 60, 195.0, 180.0),
                             (6.0 * 3600 + 48 * 60 + 22, 204.1833, 290.2),
                         }) {
                    var clock = Clock(seconds);
                    StationClockArtwork.Apply(scope, clock, 0);
                    foreach (var entry in entries) {
                        foreach (var hand in entry.Hands) {
                            float expected = (float)(hand.Minute ? minute : hour);
                            float actual = StationClockArtwork.DegreesOf(hand);
                            // The dial frame is derived from the arm's own thinnest axis; the
                            // residual is the export's own in-plane skew (a few degrees), so the
                            // reading is pinned to that tolerance rather than to a share of a degree.
                            Assert.AreEqual(expected, actual, 5f,
                                entry.ModuleId + " " + hand + " reads the wrong time");
                            if (System.Math.Abs(seconds - (6.0 * 3600 + 30 * 60)) < .5) {
                                var filter = hand.Arm.GetComponent<MeshFilter>();
                                var worldCenter = filter.transform.TransformPoint(filter.sharedMesh.bounds.center);
                                Assert.Less(worldCenter.y, hand.Pivot.position.y - .04f,
                                    entry.ModuleId + " " + hand + " must point downward at 06:30, never upward");
                            }
                        }
                        // Both faces read the same time: each hand turns about its own face's
                        // outward normal, so the far dial is the same clock and not a mirror.
                        var hourFace0 = entry.Hands.First(hand => !hand.Minute && hand.Face == 0);
                        var hourFace1 = entry.Hands.First(hand => !hand.Minute && hand.Face == 1);
                        Assert.AreEqual(StationClockArtwork.DegreesOf(hourFace0),
                            StationClockArtwork.DegreesOf(hourFace1), .05f,
                            entry.ModuleId + " disagrees between its two faces");
                        var minuteFace0 = entry.Hands.First(hand => hand.Minute && hand.Face == 0);
                        var minuteFace1 = entry.Hands.First(hand => hand.Minute && hand.Face == 1);
                        Assert.AreEqual(StationClockArtwork.DegreesOf(minuteFace0),
                            StationClockArtwork.DegreesOf(minuteFace1), .05f);
                    }
                }
                StationClockArtwork.Apply(scope, Clock(12.0 * 3600), 0);
                foreach (var entry in entries) {
                    foreach (var hand in entry.Hands) {
                        var filter = hand.Arm.GetComponent<MeshFilter>();
                        var worldCenter = filter.transform.TransformPoint(filter.sharedMesh.bounds.center);
                        Assert.Greater(worldCenter.y, hand.Pivot.position.y + .04f,
                            entry.ModuleId + " " + hand + " must point upward at 12:00");
                    }
                }
            } finally {
                Dispose(run);
            }
        }

        /// <summary>
        /// The export's pose is **subtracted**, not re-stated: the authored angles come off the
        /// promoted arms (10:09, measured at their tips) and applying that same time leaves every
        /// hand where it was.
        /// </summary>
        [Test]
        public void ApplyingALiveAngleMakesTheHandReadItAndWalkAtTheClockRates() {
            var run = Build(zoo, "clock pose");
            try {
                var scope = run.Display.Current.Displays;
                var entry = Analogue(scope).First();
                // The promoted clock carries no baked clock time: both arms are symmetric bars
                // through their pivots with identity node rotations, so there is no 10:09 to
                // subtract. Each hand's authored reference is the angle its own geometry rests at.
                foreach (var hand in entry.Hands) {
                    Assert.GreaterOrEqual(hand.AuthoredDegrees, 0f, "the authored reference was measured");
                    Assert.Less(hand.AuthoredDegrees, 360f);
                }
                foreach (var seconds in new[] { 6.0 * 3600 + 30 * 60, 6.0 * 3600 + 48 * 60 + 22, 12.0 * 3600 }) {
                    StationClockArtwork.Apply(scope, Clock(seconds), 0);
                    foreach (var hand in entry.Hands) {
                        float live = (float)(hand.Minute
                            ? ((seconds % 3600) / 60) * 6
                            : ((seconds % 43200) / 3600) * 30);
                        Assert.AreEqual(live, StationClockArtwork.DegreesOf(hand), 5f,
                            hand + " does not read the angle it was posed at");
                    }
                }
                // The clock rates: a minute of simulation walks the hour hand 0.5° and the minute 6°.
                StationClockArtwork.Apply(scope, Clock(6.0 * 3600 + 30 * 60), 0);
                var before = entry.Hands.ToDictionary(hand => hand, StationClockArtwork.DegreesOf);
                StationClockArtwork.Apply(scope, Clock(6.0 * 3600 + 31 * 60), 0);
                foreach (var hand in entry.Hands) {
                    float walked = Mathf.DeltaAngle(before[hand], StationClockArtwork.DegreesOf(hand));
                    Assert.AreEqual(hand.Minute ? 6f : .5f, walked, .5f,
                        hand + " walked the wrong angle in a minute");
                }
            } finally {
                Dispose(run);
            }
        }

        /// <summary>
        /// The hands sweep with the sub-tick fraction while the session runs, and a **paused**
        /// station settles exactly on its committed time rather than freezing a fraction late.
        /// </summary>
        [Test]
        public void APausedStationSettlesOnTheCommittedTimeAndARunningOneSweeps() {
            var run = Build(zoo, "clock pause");
            try {
                var scope = run.Display.Current.Displays;
                var entry = Analogue(scope).First();
                var minute = entry.Hands.First(hand => hand.Minute);
                var playing = Clock(6.0 * 3600 + 30 * 60, playing: true);
                StationClockArtwork.Apply(scope, playing, 0);
                float settled = StationClockArtwork.DegreesOf(minute);
                StationClockArtwork.Apply(scope, playing, .1);
                float swept = StationClockArtwork.DegreesOf(minute);
                Assert.Greater(Mathf.DeltaAngle(settled, swept), .005f, "a running clock sweeps between ticks");
                // Paused: the fraction is ignored, whatever the host hands over.
                var paused = Clock(6.0 * 3600 + 30 * 60);
                StationClockArtwork.Apply(scope, paused, .1);
                Assert.AreEqual(settled, StationClockArtwork.DegreesOf(minute), .01f,
                    "a paused station settles on the committed time");
                // A seek lands exactly, with no interpolation from the old reading.
                StationClockArtwork.Apply(scope, Clock(12 * 3600), 0);
                Assert.AreEqual(0f, Mathf.DeltaAngle(0f, StationClockArtwork.DegreesOf(minute)), 5f,
                    "midday puts the minute hand on the hour");
            } finally {
                Dispose(run);
            }
        }

        /// <summary>
        /// The LED dial: six digits from the published second, the calendar row from the published
        /// date and weekday, a key that only moves when a printed field does, and one retained
        /// texture whose name carries that key. (Zoo ships analogue clocks, so this is pinned on
        /// the painter the digital variant binds rather than through a placed scene entry.)
        /// </summary>
        [Test]
        public void TheDigitalDialPrintsTheTimeDateAndWeekdayFromThePublishedFrame() {
            Assert.AreEqual("063000", StationClockArtwork.LedDigits(Clock(6 * 3600 + 30 * 60)));
            Assert.AreEqual("064822", StationClockArtwork.LedDigits(Clock(6 * 3600 + 48 * 60 + 22)));
            var calendar = StationClockArtwork.CalendarText(Clock(6 * 3600, "2026-01-01", 4));
            StringAssert.Contains("2026", calendar);
            StringAssert.Contains("01", calendar);
            StringAssert.Contains("星期四", calendar, "the LED prints the simulation calendar's weekday");
            Assert.AreEqual(StationClockArtwork.DigitalWidth, 384);
            Assert.AreEqual(StationClockArtwork.DigitalHeight, 152);
            // The repaint key covers every printed field and nothing else.
            var before = Clock(6 * 3600 + 30 * 60);
            Assert.AreEqual(StationClockArtwork.DigitalKeyOf(before),
                StationClockArtwork.DigitalKeyOf(Clock(6 * 3600 + 30 * 60, playing: true)),
                "the play state is not printed, so it cannot repaint the dial");
            Assert.AreNotEqual(StationClockArtwork.DigitalKeyOf(before),
                StationClockArtwork.DigitalKeyOf(Clock(6 * 3600 + 30 * 60 + 1)), "a new second repaints");
            Assert.AreNotEqual(StationClockArtwork.DigitalKeyOf(before),
                StationClockArtwork.DigitalKeyOf(Clock(6 * 3600 + 30 * 60, "2026-01-02")), "a new day repaints");
            var texture = StationClockArtwork.PaintDigital(before);
            try {
                Assert.IsNotNull(texture, "the LED painter produced no texture");
                Assert.AreEqual(StationClockArtwork.DigitalWidth, texture.width);
                Assert.AreEqual(StationClockArtwork.DigitalHeight, texture.height);
                StringAssert.StartsWith("clock display ", texture.name);
                var other = StationClockArtwork.PaintDigital(Clock(6 * 3600 + 30 * 60 + 1));
                try {
                    Assert.AreNotEqual(texture.name, other.name, "the texture name carries the content key");
                } finally {
                    if (other) UnityEngine.Object.DestroyImmediate(other);
                }
            } finally {
                if (texture) UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        [Test]
        public void TheDigitalClockPrefabBindsBothFacesAndRepaintsEachSecond() {
            Assert.IsTrue(catalogue.TryGet("clock-digital", out var prefabEntry), "clock-digital prefab resolves");
            var host = new GameObject("digital clock test");
            var scope = StationDisplayArtwork.CreateScope(host.transform);
            scope.Font = font;
            try {
                var instance = UnityEngine.Object.Instantiate(prefabEntry.prefab, host.transform);
                var facts = zoo.Modules.First(m => m.Type == "clock").Facts;
                Assert.IsTrue(StationClockArtwork.Bind(scope, instance, facts, Clock(6 * 3600 + 30 * 60)),
                    "clock-digital bound both faces");
                var entry = StationClockArtwork.EntriesFor(scope).Single();
                Assert.AreEqual(2, entry.Digital.Count, "both LED planes bound");
                Assert.AreEqual(2, entry.DigitalSurfaces.Count);
                foreach (var surface in entry.DigitalSurfaces) {
                    Assert.IsNotNull(surface);
                    Assert.IsTrue(surface.Upright, "digital LED plane canonicalized upright");
                }
                var tex0 = StationDisplayArtwork.PosterTexture(entry.Digital[0].sharedMaterial);
                Assert.IsNotNull(tex0, "initial digital texture bound");
                int repaints = StationClockArtwork.Apply(scope, Clock(6 * 3600 + 30 * 60 + 1), 0);
                Assert.AreEqual(1, repaints, "next second triggers digital repaint");
                var tex1 = StationDisplayArtwork.PosterTexture(entry.Digital[0].sharedMaterial);
                Assert.IsNotNull(tex1);
                Assert.AreNotSame(tex0, tex1, "digital LED plane updated its texture on the new second");
            } finally {
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void MultipleDigitalClocksShareOnePaintedTexturePerSecond() {
            Assert.IsTrue(catalogue.TryGet("clock-digital", out var prefabEntry), "clock-digital prefab resolves");
            var host = new GameObject("shared digital clock test");
            var scope = StationDisplayArtwork.CreateScope(host.transform);
            scope.Font = font;
            try {
                StationClockArtwork.ResetDigitalPaintCount();
                var clock0 = Clock(6 * 3600 + 30 * 60);
                for (int i = 0; i < 4; i++) {
                    var inst = UnityEngine.Object.Instantiate(prefabEntry.prefab, host.transform);
                    var facts = new ModuleFacts { Id = "digital-clock-" + i, Type = "clock" };
                    Assert.IsTrue(StationClockArtwork.Bind(scope, inst, facts, clock0));
                }
                Assert.AreEqual(1, StationClockArtwork.TotalDigitalPaints, "4 digital clocks must share 1 initial paint");

                StationClockArtwork.ResetDigitalPaintCount();
                int repaints = StationClockArtwork.Apply(scope, Clock(6 * 3600 + 30 * 60 + 1), 0);
                Assert.AreEqual(4, repaints, "all 4 digital clocks updated");
                Assert.AreEqual(1, StationClockArtwork.TotalDigitalPaints, "4 digital clocks must share 1 paint per second");
                var entries = StationClockArtwork.EntriesFor(scope);
                for (int i = 1; i < entries.Count; i++) {
                    Assert.AreSame(entries[0].DigitalTexture, entries[i].DigitalTexture, "all digital clocks share one Texture2D");
                }
            } finally {
                StationDisplayArtwork.ReleaseScope(scope);
                UnityEngine.Object.DestroyImmediate(host);
            }
        }
    }
}
