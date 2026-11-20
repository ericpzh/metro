using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// Plan 17 §2/§6.4: the visible-model chain and the logical crowd are two different
    /// facts. A public-safe pack has no soft-human catalogue and therefore draws nobody —
    /// that must not be read as "the station spawns nobody". The counts below come from
    /// the fixed-tick service; <c>models.*</c> reports the separate model chain
    /// (samples → eligible recipes → bound models → visible actors).
    /// </summary>
    public sealed class StationCrowdStateTests {
        const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";
        StationSimulationSession session;

        [SetUp]
        public void Boot() {
            PassengerCatalogueAnchor.ClearInjection();
            var read = StationDocumentReader.ReadFile(ZooPath);
            Assert.IsNotNull(read, "Zoo fixture missing: " + ZooPath);
            session = new StationSimulationSession(StationSessionProjection.Setup(read.Document, read.Index, "crowd-probe"));
            session.SetPlaying(true);
            // Run past the first real stop: spawns, a berth and its alighting wave. The
            // bounded loop keeps a broken phase loop from hanging the suite.
            for (int tick = 0; tick < 600 && session.Services.Alighted == 0; tick++) session.Advance(1.0);
            session.SetPlaying(false);
        }

        [TearDown]
        public void Release() {
            PassengerCatalogueAnchor.ClearInjection();
            PassengerPoseFeeds.Clear();
            session = null;
        }

        [Test]
        public void ThePublicProfileStillProvesLogicalSpawnsAndAlightings() {
            var json = StationCrowdStateContributor.Build(session);
            Assert.IsNotNull(json, "the crowd payload is published");
            Assert.Greater((int)json["passengersTotal"], 0, "the session spawned a crowd");
            Assert.Greater((int)json["spawned"], 0, "spawns are a logical fact, not a model fact");
            Assert.Greater((int)json["alighted"], 0, "a consist stop released at least one alighter");
            Assert.IsFalse((bool)json["catalogue"]["bound"], "the public pack binds no internal catalogue");
            var models = (JObject)json["models"];
            Assert.AreEqual(0, (int)models["bound"], "no model is bound without a catalogue");
            Assert.AreEqual(0, (int)models["visible"], "and none is visible");
            Assert.AreEqual("passenger-catalogue-missing", (string)models["reason"],
                "the model gap is named, not confused with a spawn failure");
        }

        [Test]
        public void TheLocalProfileReportsTheEligibleAndVisibleChain() {
            var catalogue = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(PassengerCatalogue.AssetPath);
            if (catalogue == null) Assert.Ignore("local passenger catalogue is not present in this project");
            PassengerCatalogueAnchor.Inject(catalogue);
            var json = StationCrowdStateContributor.Build(session);
            var models = (JObject)json["models"];
            Assert.IsTrue((bool)((JObject)json["catalogue"])["bound"], "the local profile binds the catalogue");
            Assert.Greater((int)models["eligible"], 0, "published sim ids resolve eligible recipes");
            Assert.AreEqual("", (string)models["reason"]);

            // The same poses through the real view produce bound and visible bodies; the
            // logical counts do not change because a model could be drawn.
            var parent = new GameObject("crowd chain probe");
            try {
                var view = PassengerCrowdView.Build(parent.transform, catalogue);
                var poses = session.PassengerFrames()
                    .Where(frame => frame.Visible)
                    .Take(4)
                    .Select(SessionPassengerFeed.Map)
                    .ToList();
                Assert.Greater(poses.Count, 0, "the session published visible passengers");
                view.Render(poses, 0);
                Assert.AreEqual(poses.Count, view.Spawned, "one bound model per published pose");
                Assert.AreEqual(poses.Count, view.VisibleActors, "each bound model is posed and visible");
                foreach (var actor in view.Actors) {
                    Assert.IsTrue(actor.Sampled, "the actor sampled a real clip");
                    Assert.IsFalse(string.IsNullOrEmpty(actor.Recipe), "the recipe identity is the catalogue's");
                }
            } finally {
                UnityEngine.Object.DestroyImmediate(parent);
            }
        }

        [Test]
        public void CrowdPoseSkipsUnchangedAnimationsAndUsesFixedLocalBounds() {
            var catalogue = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(PassengerCatalogue.AssetPath);
            if (catalogue == null) Assert.Ignore("local passenger catalogue is not present in this project");
            var parent = new GameObject("crowd stage5 probe");
            try {
                var view = PassengerCrowdView.Build(parent.transform, catalogue);
                var poses = new System.Collections.Generic.List<PassengerPose>(200);
                for (int i = 1; i <= 200; i++) {
                    poses.Add(new PassengerPose {
                        SimId = i,
                        X = (i % 20) * 1.5,
                        Y = (i / 20) * 1.5,
                        Z = -5,
                        Heading = 0,
                        Activity = PassengerActivity.Walk,
                        WalkDistance = i * 0.1,
                        WalkPhase = 0.25,
                        WalkWeight = i <= 100 ? 0.0 : 1.0,
                        HasWalkWeight = true,
                        Visible = true,
                    });
                }

                // First render samples all 200 actors and sets fixed local bounds with updateWhenOffscreen=false.
                var swFirst = System.Diagnostics.Stopwatch.StartNew();
                view.Render(poses, 1.0);
                swFirst.Stop();
                Assert.AreEqual(200, view.Spawned);
                Assert.AreEqual(200, view.SampledThisFrame, "initial render samples every visible actor");
                foreach (var actor in view.Actors) {
                    Assert.IsFalse(actor.Skin.updateWhenOffscreen, "offscreen skinning must be disabled");
                    Assert.Greater(actor.Skin.localBounds.size.y, 1.5f, "fixed local bounds must cover full actor height");
                }

                // Repeated identical frame (e.g. paused): 0 SampleAnimation calls!
                var swPaused = System.Diagnostics.Stopwatch.StartNew();
                view.Render(poses, 1.0);
                swPaused.Stop();
                Assert.AreEqual(0, view.SampledThisFrame, "identical paused frame must skip redundant SampleAnimation");
                Assert.AreEqual(200, view.SkippedUnchangedAnimationThisFrame);

                // Next walking step: only the 100 walking actors advance; the 100 standing actors stay skipped!
                for (int i = 0; i < poses.Count; i++) {
                    var p = poses[i];
                    if (p.WalkWeight > 0.5) p.WalkDistance += 0.35;
                    poses[i] = p;
                }
                var swWalk = System.Diagnostics.Stopwatch.StartNew();
                view.Render(poses, 1.25);
                swWalk.Stop();
                Assert.AreEqual(100, view.SampledThisFrame, "only moving walkers resample");
                Assert.AreEqual(100, view.SkippedUnchangedAnimationThisFrame, "standing actors remain skipped");
                Debug.Log($"[Stage5Crowd] n=200 firstMs={swFirst.Elapsed.TotalMilliseconds:F2} pausedMs={swPaused.Elapsed.TotalMilliseconds:F2} halfWalkMs={swWalk.Elapsed.TotalMilliseconds:F2}");
            } finally {
                UnityEngine.Object.DestroyImmediate(parent);
            }
        }
    }
}
