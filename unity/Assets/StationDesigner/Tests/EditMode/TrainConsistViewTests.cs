using System;
using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Packet C3's missing rolling stock: the generic player now draws one promoted
    /// consist per (line, track) the committed document runs, derives its berth from
    /// the document's own track records (never a hard-coded world position), places
    /// the cars on the source's own cadence, and drives only the platform-side door
    /// bank from the published <see cref="StationTrainFrame"/>.
    ///
    /// The Zoo world is built once for the class; the per-test reset applies a
    /// `Phase.None` frame, which is exactly the session's restart state (every
    /// consist back on its berth with the doors shut).
    /// </summary>
    public sealed class TrainConsistViewTests {
        const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";

        static GameObject root;
        static StationDocument zooDocument;
        static StationReadResult zooRead;
        static TrainCatalogue catalogue;
        static TrainConsistRenderer zooRenderer;
        static StationWorldView zooWorld;

        [OneTimeSetUp]
        public void OneTimeSetUp() {
            catalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "the train catalogue asset is missing: " + TrainCatalogue.AssetPath);
            zooRead = StationDocumentReader.ReadFile(ZooPath);
            zooDocument = zooRead.Document;
            root = new GameObject("TrainConsistViewTests");
            zooRenderer = new TrainConsistRenderer();
            zooWorld = new StationWorldView(root.transform, "trains zoo",
                new IStationViewRenderer[] { zooRenderer }, ZooAssets());
            zooWorld.Build(zooDocument, zooRead.Index);
            zooWorld.Activate();
        }

        [OneTimeTearDown]
        public void OneTimeTearDown() {
            zooWorld?.Dispose();
            zooWorld = null;
            zooRenderer = null;
            if (root != null) UnityEngine.Object.DestroyImmediate(root);
            root = null;
            StationRenderers.Clear();
            StationFrameSinks.Clear();
        }

        /// <summary>Every test starts from the restart pose: both consists on their berths, doors shut.</summary>
        [SetUp]
        public void ResetPose() {
            zooRenderer.Apply(Frame(false,
                Train("5|track-1", TrainPhase.None, 0, 0),
                Train("5|track-5", TrainPhase.None, 0, 0)));
        }

        /* ------------------------------------------------------------- fixtures */

        static StationViewAssets ZooAssets() => new StationViewAssets { TrainCatalogue = catalogue };

        static TrainConsistView Consist(string trainId) {
            Assert.IsTrue(zooRenderer.TryGetConsist(trainId, out var view), "no consist for " + trainId);
            return view;
        }

        static StationTrainFrame Train(string id, TrainPhase phase, double seconds, double door, int sequence = 1) {
            var parts = (id ?? "").Split('|');
            return new StationTrainFrame {
                Id = id ?? "", LineId = parts.Length > 0 ? parts[0] : "",
                TrackId = parts.Length > 1 ? parts[1] : "",
                ServiceSequence = sequence,
                Phase = phase, PhaseSeconds = seconds, DoorFraction = door,
            };
        }

        static StationMotionFrame Frame(bool playing, params StationTrainFrame[] trains) => new StationMotionFrame {
            Clock = new StationClockFrame { Playing = playing },
            Trains = trains ?? Array.Empty<StationTrainFrame>(),
            Escalators = Array.Empty<StationEscalatorFrame>(),
            Lifts = Array.Empty<StationLiftFrame>(),
            Doors = Array.Empty<StationDoorFrame>(),
            Passengers = Array.Empty<StationPassengerFrame>(),
            Gates = Array.Empty<StationGateFrame>(),
        };

        static JObject Track(string id, int x, int y, int z, int width, int depth, string line, string direction) =>
            new JObject {
                ["id"] = id, ["type"] = "track", ["x"] = x, ["y"] = y, ["z"] = z,
                ["w"] = width, ["d"] = depth, ["rot"] = 0,
                ["cfg"] = new JObject { ["line"] = line, ["dir"] = direction },
            };

        static JObject Edge(string id, int x, int y, int z, int width, string line, string direction, string trackId) =>
            new JObject {
                ["id"] = id, ["type"] = "platform-edge", ["x"] = x, ["y"] = y, ["z"] = z,
                ["w"] = width, ["rot"] = 0,
                ["cfg"] = new JObject {
                    ["line"] = line, ["dir"] = direction, ["side"] = "left",
                    ["psd"] = "full", ["from"] = trackId,
                },
            };

        static JObject Line(string id, string stock, int cars, string power, string direction) =>
            new JObject {
                ["id"] = id, ["name"] = "Line " + id, ["colour"] = "#c70541",
                ["stock"] = stock, ["cars"] = cars, ["power"] = power,
                ["direction"] = direction, ["psd"] = "full",
                ["headwayProfile"] = new JObject { ["peak"] = 150, ["offpeak"] = 240, ["late"] = 480 },
            };

        static StationReadResult ReadProbe(string name, JObject[] modules, JObject[] lines) {
            var envelope = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = name, ["city"] = "guangzhou", ["seed"] = 7,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = new JArray(),
                    ["modules"] = new JArray(modules),
                    ["lines"] = new JArray(lines),
                },
            };
            return StationDocumentReader.Read(envelope.ToString(Formatting.None), new StationSource("test:" + name, ""));
        }

        /// <summary>A one-line, one-track station with no platform (a pure geometry probe).</summary>
        static StationReadResult ReadSingleTrack(string lineId, string stock, int cars, string power, string direction,
            int trackY) => ReadProbe("train probe " + lineId,
            new[] {
                Track("track-1", 0, trackY, 0, 10, 3, lineId, direction),
                Edge("edge-1", 0, trackY + 3, 0, 10, lineId, direction, "track-1"),
            },
            new[] { Line(lineId, stock, cars, power, direction) });

        /* ------------------------------------------------------------- tests */

        [Test]
        public void EveryZooServiceTrackHasAConsistWithTheCatalogueCarsAndScale() {
            Assert.AreEqual(1, zooDocument.LineCount, "Zoo lines");
            Assert.AreEqual(2, zooRenderer.Consists.Count, "one consist per service track (track-1, track-5)");
            var key = TrainFormations.Select("L", 6, "third-rail", catalogue);
            Assert.AreEqual("L.6.third-rail@zoo", key, "Zoo's promoted livery variant");
            Assert.IsTrue(catalogue.TryGet(key, out var entry), "the promoted Zoo formation is in the catalogue");
            foreach (var trainId in new[] { "5|track-1", "5|track-5" }) {
                var view = Consist(trainId);
                Assert.AreEqual(key, view.FormationKey, trainId);
                Assert.AreEqual(entry.prefabPath, view.PrefabPath, trainId);
                Assert.AreEqual(entry.cars, view.Cars, "the catalogue's car count");
                Assert.AreEqual(6, view.Cars, trainId + " is a six-car set");
                Assert.AreEqual(entry.bakedScale, view.Scale, 1e-4f, trainId + " keeps the promoted scale");
                Assert.AreEqual(.98f, view.Scale, 1e-4f, trainId + " bakes Line 5's 0.98");
                // The wrapper stays unscaled; the promoted prefab's own Consist node
                // carries the authored model scale.
                Assert.AreEqual(Vector3.one, view.Root.transform.localScale, "the wrapper is never rescaled");
                var basis = view.Root.transform.Find("Unity basis");
                Assert.IsNotNull(basis, trainId + " keeps the promoted Unity basis");
                Assert.AreEqual(.98f, basis.GetChild(0).localScale.x, 1e-4f, "only the authored model scale");
            }
        }

        [Test]
        public void CarsSitOnTheDerivedTrackAndAtTheAuthoredBerth() {
            var view = Consist("5|track-1");
            // World.computeLineAnchors for track-1 (x 17, y −4, z −20, w 101, d 3,
            // rot 0, dir up): berth at the run centre, the bed centre across, and the
            // rail surface `track.z + 1 − CABIN_FLOOR_Z · scale`.
            Assert.AreEqual(67.5f, view.Berth.DocumentPosition.x, 1e-2f, "berth x");
            Assert.AreEqual(-2.5f, view.Berth.DocumentPosition.y, 1e-2f, "berth plan y (bed centre)");
            Assert.AreEqual(-20f + 1f - .62f * .98f, view.Berth.DocumentPosition.z, 1e-2f, "berth elevation");
            Assert.AreEqual(1f, view.Berth.Facing.x, 1e-6f);
            Assert.AreEqual(0f, view.Berth.Facing.y, 1e-6f);
            Assert.AreEqual(1, view.Berth.DirectionSign, "track-1 runs up");
            Assert.AreEqual(65.5f, view.Berth.ApproachRun, .01f, "connected rail behind the berth");
            Assert.AreEqual(65.5f, view.Berth.DepartRun, .01f, "connected rail ahead of the berth");
            Assert.AreEqual(16.8f * 6f * .98f * .5f, view.Berth.HalfLength, .02f, "half the stock envelope");
            Assert.AreEqual(6, view.Cars, "six cars drawn");
            var centres = TrainConsistGeometry.CarCentres("L", 6, .98f);
            Assert.AreEqual(6, centres.Length);
            Assert.AreEqual(-41.16f, centres[0], 1e-2f, "car 0 is the trailing cab");
            Assert.AreEqual(41.16f, centres[5], 1e-2f, "car 5 is the leading cab");
            for (int i = 0; i < view.Cars; i++) {
                var car = view.CarViews[i];
                Assert.AreEqual(view.Berth.DocumentPosition.x + centres[i], car.DocumentPosition.x, 1e-2f,
                    "car " + i + " centre sits on the source cadence");
                Assert.AreEqual(view.Berth.DocumentPosition.y, car.DocumentPosition.y, 1e-2f,
                    "car " + i + " is centred across the track bed");
                Assert.AreEqual(view.Berth.DocumentPosition.z, car.DocumentPosition.z, 1e-2f,
                    "car " + i + " rides the rail surface");
                Assert.GreaterOrEqual(car.DocumentPosition.x, 17f, "car " + i + " is on the saved track");
                Assert.LessOrEqual(car.DocumentPosition.x, 118f, "car " + i + " is on the saved track");
                Assert.IsTrue(car.HasBounds, "car " + i + " registered its document bounds");
                Assert.IsFalse(string.IsNullOrEmpty(car.Part), "car " + i + " kept its authored part");
            }
            var down = Consist("5|track-5");
            Assert.AreEqual(-1, down.Berth.DirectionSign, "track-5 runs down");
            Assert.AreEqual(-15f + 1f - .62f * .98f, down.Berth.DocumentPosition.z, 1e-2f, "the down platform's raise");
        }

        [Test]
        public void DoorPhaseOpensOnlyThePlatformBankOnBothTracks() {
            zooRenderer.Apply(Frame(true,
                Train("5|track-1", TrainPhase.Dwell, 10, 1),
                Train("5|track-5", TrainPhase.Dwell, 10, 1)));
            var up = Consist("5|track-1");
            Assert.AreEqual(1, up.PlatformBank, "the up track's platform is the consist's local +z bank");
            Assert.AreEqual(1f, up.Rig.Plus, 1e-4f, "the platform bank opened");
            Assert.AreEqual(0f, up.Rig.Minus, 1e-6f, "the far bank stayed shut");
            Assert.Greater(up.Rig.Movement, .3f, "the platform leaf slid on the drawn consist");
            Assert.IsTrue(up.DoorsOpen);
            var down = Consist("5|track-5");
            Assert.AreEqual(-1, down.PlatformBank, "a down service presents its mirrored bank");
            Assert.AreEqual(1f, down.Rig.Minus, 1e-4f, "its platform (minus) bank opened");
            Assert.AreEqual(0f, down.Rig.Plus, 1e-6f, "its far bank stayed shut");
            Assert.Greater(down.Rig.Movement, .3f);
            // Both tracks' platforms are on the same side of the station, so the two
            // consists answer with mirrored local banks and neither tunnel side opens.
            Assert.AreEqual(0f, down.Rig.Plus, 1e-6f);
            // The closing phase's zero fraction shuts the platform bank again.
            zooRenderer.Apply(Frame(true,
                Train("5|track-1", TrainPhase.Hold, 0, 0),
                Train("5|track-5", TrainPhase.Hold, 0, 0)));
            Assert.AreEqual(0f, up.Rig.Plus, 1e-6f);
            Assert.AreEqual(0f, up.Rig.Minus, 1e-6f);
            Assert.AreEqual(0f, down.Rig.Plus, 1e-6f);
            Assert.AreEqual(0f, down.Rig.Minus, 1e-6f);
            Assert.Less(up.Rig.Movement, 1e-4f, "the leaf parked exactly at its closed pose");
        }

        [Test]
        public void ApproachMovesTheConsistAndDwellHoldsTheBerth() {
            var view = Consist("5|track-1");
            var berth = view.Berth.DocumentPosition;
            zooRenderer.Apply(Frame(true,
                Train("5|track-1", TrainPhase.Approach, 0, 0),
                Train("5|track-5", TrainPhase.None, 0, 0)));
            var start = view.DocumentPosition;
            Assert.Less(start.x, berth.x - 100f,
                "approach starts beyond the entrance end: half a consist plus the connected rail");
            Assert.AreEqual(-(view.Berth.HalfLength + view.Berth.ApproachRun), view.OffsetMetres, .01f);
            zooRenderer.Apply(Frame(true,
                Train("5|track-1", TrainPhase.Approach, 3, 0),
                Train("5|track-5", TrainPhase.None, 0, 0)));
            Assert.AreEqual(.5f, TrainConsistGeometry.ApproachProgress(3), 1e-4f);
            var midpoint = view.DocumentPosition;
            Assert.Greater(midpoint.x, start.x, "the consist moved toward the platform");
            Assert.Less(midpoint.x, berth.x, "and has not reached it yet");
            Assert.AreEqual(berth.x - (view.Berth.HalfLength + view.Berth.ApproachRun) * .25f, midpoint.x, .05f);
            // The phase's last drawn frame lands exactly on the mark.
            zooRenderer.Apply(Frame(true,
                Train("5|track-1", TrainPhase.Approach, 5, 0),
                Train("5|track-5", TrainPhase.None, 0, 0)));
            Assert.AreEqual(berth.x, view.DocumentPosition.x, 1e-3f, "approach ends at the berth");
            foreach (var phase in new[] { TrainPhase.Berth, TrainPhase.Opening, TrainPhase.Dwell, TrainPhase.Closing, TrainPhase.Hold }) {
                zooRenderer.Apply(Frame(true,
                    Train("5|track-1", phase, 1, 1),
                    Train("5|track-5", TrainPhase.None, 0, 0)));
                Assert.AreEqual(berth.x, view.DocumentPosition.x, 1e-4f, phase + " holds the berth");
                Assert.AreEqual(berth.y, view.DocumentPosition.y, 1e-4f, phase + " holds across");
            }
        }

        [Test]
        public void ASampleInsideTheTickIntervalMovesTheConsistBetweenTicks() {
            // RCA 14 §5.2: the published pose advances once per fixed second, but a
            // rendered frame samples between the previous and current tick targets, so
            // an approach is continuous instead of a 1 Hz jump.
            var view = Consist("5|track-1");
            var frame2 = Frame(true,
                Train("5|track-1", TrainPhase.Approach, 2, 0),
                Train("5|track-5", TrainPhase.None, 0, 0));
            var frame3 = Frame(true,
                Train("5|track-1", TrainPhase.Approach, 3, 0),
                Train("5|track-5", TrainPhase.None, 0, 0));
            zooRenderer.Apply(frame2, 1f, true);
            var atTwo = view.DocumentPosition.x;
            zooRenderer.Apply(frame3, 1f, false);
            var atThree = view.DocumentPosition.x;
            Assert.Greater(atThree, atTwo, "the approach moves toward the platform");

            zooRenderer.Apply(frame3, .25f, false);
            var inside = view.DocumentPosition.x;
            Assert.That(inside, Is.GreaterThan(atTwo).And.LessThan(atThree),
                "a frame inside the tick interval samples between the two tick poses");
            Assert.AreNotEqual(atTwo, inside, "the sample is not stuck on the previous frame");
            Assert.AreNotEqual(atThree, inside, "the sample is not the current frame's own value");

            // Re-sampling the same frame at the same fraction is the identity: a paused
            // station holds exactly the pose the player last saw.
            zooRenderer.Apply(frame3, .25f, false);
            Assert.AreEqual(inside, view.DocumentPosition.x, 1e-6f);
        }

        [Test]
        public void DepartureRunsTheTailOutOfTheConnectedRail() {
            var view = Consist("5|track-1");
            var berth = view.Berth.DocumentPosition;
            zooRenderer.Apply(Frame(true,
                Train("5|track-1", TrainPhase.Depart, 5, 0),
                Train("5|track-5", TrainPhase.None, 0, 0)));
            float expected = (view.Berth.HalfLength + view.Berth.DepartRun) * view.Berth.DirectionSign;
            Assert.AreEqual(expected, view.OffsetMetres, .05f,
                "the last drawn depart frame leaves the tail on the connected rail's end");
            Assert.Greater(view.DocumentPosition.x, berth.x + 100f, "the consist pulled out");
            // Car 0 is the trailing end; it has cleared the far end of the connected
            // rail (track-1 u 116 → world x 133) at the last drawn frame.
            var tail = view.CarViews[0];
            Assert.Greater(tail.DocumentPosition.x, 133f, "the tail is past the tunnel portal");
        }

        [Test]
        public void PausedFramesHoldAndRestartReturnsToTheBerth() {
            var view = Consist("5|track-1");
            var half = Frame(true,
                Train("5|track-1", TrainPhase.Dwell, 10, .5),
                Train("5|track-5", TrainPhase.Dwell, 10, .5));
            zooRenderer.Apply(half);
            var heldPosition = view.DocumentPosition;
            float heldDoor = view.Rig.Plus;
            Assert.AreEqual(.5f, heldDoor, 1e-4f, "the half-open platform bank");
            // A paused station republishes the same frame: the pose is the identity.
            zooRenderer.Apply(half);
            Assert.AreEqual(heldPosition.x, view.DocumentPosition.x);
            Assert.AreEqual(heldPosition.y, view.DocumentPosition.y);
            Assert.AreEqual(heldPosition.z, view.DocumentPosition.z);
            Assert.AreEqual(heldDoor, view.Rig.Plus);
            // `session.Restart()` clears its actors: every consist is back on its
            // berth with the doors shut and no residual offset.
            zooRenderer.Apply(Frame(false,
                Train("5|track-1", TrainPhase.None, 0, 0),
                Train("5|track-5", TrainPhase.None, 0, 0)));
            Assert.AreEqual(TrainPhase.None, view.Phase);
            Assert.AreEqual(0f, view.OffsetMetres);
            Assert.AreEqual(view.Berth.DocumentPosition.x, view.DocumentPosition.x, 1e-5f);
            Assert.AreEqual(view.Berth.DocumentPosition.y, view.DocumentPosition.y, 1e-5f);
            Assert.AreEqual(view.Berth.DocumentPosition.z, view.DocumentPosition.z, 1e-5f);
            Assert.AreEqual(0f, view.Rig.Plus, 1e-6f);
            Assert.AreEqual(0f, view.Rig.Minus, 1e-6f);
        }

        [Test]
        public void OneVisibilityRootPerTrackCoversEveryPartAndUsesTheSavedTrackBand() {
            var records = zooWorld.Records.Where(record => record.Role == "trains").ToArray();
            Assert.AreEqual(2, records.Length, "one visibility root per consist (track-1, track-5)");
            foreach (var pair in new[] {
                new { TrainId = "5|track-1", Band = -20 },
                new { TrainId = "5|track-5", Band = -15 },
            }) {
                var id = "train:" + pair.TrainId;
                var record = records.FirstOrDefault(candidate => candidate.ModuleId == id);
                Assert.IsNotNull(record, id + " is registered");
                Assert.AreEqual("consist", record.Part, id + " registers the whole consist, not a car");
                Assert.IsNotNull(record.View, id + " has a live view");
                Assert.AreSame(Consist(pair.TrainId).Root, record.View, id + " covers every child part");
                Assert.IsTrue(record.HasBounds, id + " carries the saved track band");
                Assert.AreEqual(pair.Band, record.LevelMin, id + " uses the saved track storey, not child bounds");
                Assert.AreEqual(pair.Band, record.LevelMax, id);
                CollectionAssert.AreEqual(new[] { pair.Band }, record.LevelBands, id + " level membership");
                Assert.IsTrue(zooWorld.TryGetModule(id, out var picked), id + " is addressable");
                Assert.AreSame(record.View, picked.View);
                Assert.IsFalse(records.Any(candidate => candidate.ModuleId.StartsWith(id + "|", StringComparison.Ordinal)),
                    id + " does not also register each car as its own visibility target");

                // The standalone gangway roots are children of the same consist root, so
                // they hide and show with the cars instead of being left always enabled.
                var view = Consist(pair.TrainId);
                Assert.AreEqual(5, view.Gangways.Count, id + " carries five standalone gangway roots");
                foreach (var gangway in view.Gangways) {
                    Assert.IsTrue(gangway.IsChildOf(view.Root.transform),
                        id + " gangway " + gangway.name + " belongs to the registered root");
                }
                // Per-car metadata is retained outside visibility registration.
                Assert.AreEqual(6, view.Cars, id + " still reports six cars");
                foreach (var car in view.CarViews) {
                    Assert.IsTrue(car.HasBounds, id + " car " + car.Index + " keeps its measured bounds");
                    Assert.IsFalse(string.IsNullOrEmpty(car.Part), id + " car " + car.Index + " keeps its authored part");
                }
            }
        }

        [Test]
        public void CarsKeepTheAuthoredFormationLayoutInsteadOfARecentredOverride() {
            // The promoted formation writes `-car.centre` in its own `Consist` frame under
            // the 180° Unity basis; that is exactly the source cadence the source's
            // `carCentre` gives. A runtime re-write in the opposite sign would move the
            // cars against the unchanged gangways and doorway anchors.
            var view = Consist("5|track-1");
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(view.PrefabPath);
            Assert.IsNotNull(prefab, "the promoted formation prefab resolves");
            var source = UnityEngine.Object.Instantiate(prefab);
            try {
                var sourceCars = TrainConsistViews.CollectCars(source);
                var sourceGangways = TrainConsistViews.CollectGangways(source);
                Assert.AreEqual(view.Cars, sourceCars.Count, "same car set");
                Assert.AreEqual(view.Gangways.Count, sourceGangways.Count, "same gangway set");
                var centres = TrainConsistGeometry.CarCentres("L", 6, .98f);
                for (int i = 0; i < view.Cars; i++) {
                    Assert.AreEqual(sourceCars[i].localPosition.x, view.CarViews[i].Transform.localPosition.x, 1e-4f,
                        "car " + i + " keeps the prefab's authored local x");
                    Assert.AreEqual(-centres[i], sourceCars[i].localPosition.x * .98f, 0.02f,
                        "the authored layout is the source's car centre in the mirrored Consist frame");
                }
            } finally {
                UnityEngine.Object.DestroyImmediate(source);
            }
        }

        [Test]
        public void MissingFormationIsNamedAndDrawsNothing() {
            var read = ReadSingleTrack("5", "A", 2, "overhead", "up", 0);
            var empty = ScriptableObject.CreateInstance<TrainCatalogue>();
            empty.entries = Array.Empty<TrainCatalogue.Entry>();
            var renderer = new TrainConsistRenderer();
            var probeRoot = new GameObject("missing formation root");
            var world = new StationWorldView(probeRoot.transform, "missing formation",
                new IStationViewRenderer[] { renderer }, new StationViewAssets { TrainCatalogue = empty });
            try {
                world.Build(read.Document, read.Index);
                Assert.AreEqual(0, renderer.Consists.Count, "a missing formation draws nothing");
                var diagnostic = world.Unresolved.FirstOrDefault(item => item.Code == "no-formation");
                Assert.IsNotNull(diagnostic, "the missing formation is named");
                StringAssert.Contains("train:5|track-1", diagnostic.RecordId);
                StringAssert.Contains("A.2.overhead", diagnostic.Message);
                StringAssert.Contains("no box", diagnostic.Message);
                Assert.AreEqual(0, world.RoleRoot("trains").childCount, "no stand-in box was substituted");
                Assert.AreEqual(0, world.Records.Count(record => record.Role == "trains"));
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(probeRoot);
                UnityEngine.Object.DestroyImmediate(empty);
            }
        }

        [Test]
        public void StationSwitchKeepsTheNewWorldAndDropsTheOldConsists() {
            var renderer = new TrainConsistRenderer();
            var parent = new GameObject("train switch");
            StationWorldView first = null;
            StationWorldView second = null;
            var missing = ReadSingleTrack("5", "A", 2, "overhead", "up", 0);
            var empty = ScriptableObject.CreateInstance<TrainCatalogue>();
            empty.entries = Array.Empty<TrainCatalogue.Entry>();
            try {
                first = new StationWorldView(parent.transform, "first", new IStationViewRenderer[] { renderer }, ZooAssets());
                first.Build(zooDocument, zooRead.Index);
                first.Activate();
                Assert.AreEqual(2, renderer.Consists.Count, "the first world drew both Zoo consists");
                var oldConsist = renderer.Consists[0];
                Assert.IsNotNull(oldConsist.Root);
                // A station switch: the same renderer stages a new world before the
                // old one is released.
                second = new StationWorldView(parent.transform, "second",
                    new IStationViewRenderer[] { renderer }, new StationViewAssets { TrainCatalogue = empty });
                second.Build(missing.Document, missing.Index);
                second.Activate();
                Assert.AreEqual(0, renderer.Consists.Count, "the new world's state replaced the old one");
                Assert.AreEqual(0, second.Records.Count(record => record.ModuleId.StartsWith("train:", StringComparison.Ordinal)),
                    "no old consist leaked into the new world");
                first.Dispose();
                first = null;
                renderer.Release();
                Assert.AreEqual(0, renderer.Consists.Count, "releasing the old world keeps the live state");
                Assert.IsTrue(oldConsist.Root == null, "the previous world's consist was destroyed with it");
                Assert.AreEqual(0, second.Records.Count(record => record.Role == "trains"));
            } finally {
                second?.Dispose();
                first?.Dispose();
                UnityEngine.Object.DestroyImmediate(parent);
                UnityEngine.Object.DestroyImmediate(empty);
            }
        }

        [Test]
        public void SecondLineStockKeepsItsOwnFormationAndScale() {
            var read = ReadProbe("two line stocks",
                new[] {
                    Track("track-1", 0, 0, 0, 10, 3, "5", "up"),
                    Track("track-2", 0, 8, 0, 10, 3, "6", "down"),
                },
                new[] {
                    Line("5", "A", 2, "overhead", "up"),
                    Line("6", "L", 6, "third-rail", "down"),
                });
            var renderer = new TrainConsistRenderer();
            var probeRoot = new GameObject("two line stocks root");
            var world = new StationWorldView(probeRoot.transform, "two stocks",
                new IStationViewRenderer[] { renderer }, ZooAssets());
            try {
                world.Build(read.Document, read.Index);
                Assert.AreEqual(2, renderer.Consists.Count, "one consist per line");
                var a = renderer.Consists.First(view => view.LineId == "5");
                var l = renderer.Consists.First(view => view.LineId == "6");
                Assert.AreEqual("A.2.overhead", a.FormationKey);
                Assert.AreEqual(2, a.Cars);
                Assert.AreEqual(1f, a.Scale, 1e-4f, "a non-Zoo promotion is authored at 1:1");
                Assert.AreEqual("L.6.third-rail@zoo", l.FormationKey);
                Assert.AreEqual(6, l.Cars);
                Assert.AreEqual(.98f, l.Scale, 1e-4f, "the Zoo livery keeps its baked scale");
                Assert.AreEqual(-1, l.Berth.DirectionSign, "line 6's track runs down");
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(probeRoot);
            }
        }

        // ------------------------------------------- the stop's door trace (plan 16 §4)

        /// <summary>
        /// One Zoo Line 5 stop driven by the **real** session through the **real** renderer,
        /// one presented frame per fixed tick, with the rig's per-event log on. The stop is
        /// the source's own choreography (approach, berth, opening, dwell, closing, hold,
        /// depart), so the assertion is the one the screenshot needed: a stop opens once and
        /// closes once, the bank facing away from the platform never moves, and a second
        /// opening can only ever belong to another consist run.
        /// </summary>
        [Test]
        public void AStopOpensOnceAndClosesOnceAndTheOtherBankStaysShut() {
            var sessionDocument = StationSessionProjection.Document(zooDocument, zooRead.Index);
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = sessionDocument,
                Day = StationDayData.Default,
                Seed = 7654321,
                StartSimTime = StationClock.ReferenceBootSeconds,
                StartPlaying = true,
                Services = new StationServiceOptions { Spawn = false },
            });
            zooRenderer.LogDoorEvents = true;
            zooRenderer.ClearDoorEvents();
            try {
                var sequences = new Dictionary<string, HashSet<int>>();
                for (int tick = 0; tick < 70; tick++) {
                    Assert.AreEqual(1, session.Advance(1.0), "fixed one-second ticks");
                    zooRenderer.Apply(session.Snapshot(), 1f, tick == 0);
                    foreach (var train in session.Snapshot().Trains) {
                        if (string.IsNullOrEmpty(train.Id) || train.ServiceSequence <= 0) continue;
                        if (!sequences.TryGetValue(train.Id, out var seen)) sequences[train.Id] = seen = new HashSet<int>();
                        seen.Add(train.ServiceSequence);
                    }
                }
                var events = zooRenderer.DoorEvents;
                Assert.Greater(events.Count, 0, "the stop logged its door events");

                // Nothing the platform does not face ever moved.
                foreach (var item in events)
                    Assert.AreNotEqual("inactive-open", item.Kind,
                        item.TrainId + " opened its tunnel-side bank: " + item);

                foreach (var pair in sequences) {
                    string trainId = pair.Key;
                    Assert.IsTrue(zooRenderer.TryGetConsist(trainId, out var view), "no consist for " + trainId);
                    var opens = new List<TrainDoorEvent>();
                    var closes = new List<TrainDoorEvent>();
                    var fulls = new List<TrainDoorEvent>();
                    foreach (var item in events) {
                        if (item.TrainId != trainId) continue;
                        Assert.AreEqual(view.PlatformBank, item.Bank,
                            "a bank event always addresses the platform bank: " + item);
                        if (item.Kind == "opening") opens.Add(item);
                        else if (item.Kind == "closed") closes.Add(item);
                        else if (item.Kind == "open") fulls.Add(item);
                    }
                    // One stop per consist run: exactly one opening and one closing, and the
                    // leaves were commanded fully open in between.
                    Assert.AreEqual(pair.Value.Count, opens.Count,
                        trainId + " has one opening per consist run (" + Describe(opens) + ")");
                    Assert.AreEqual(pair.Value.Count, closes.Count,
                        trainId + " has one closing per consist run (" + Describe(closes) + ")");
                    Assert.AreEqual(opens.Count, fulls.Count, trainId + " reached fully open once per stop");
                    var openSequences = new HashSet<int>();
                    foreach (var item in opens) {
                        Assert.IsTrue(openSequences.Add(item.ServiceSequence),
                            "the same consist run opened twice: " + item);
                        Assert.IsTrue(pair.Value.Contains(item.ServiceSequence),
                            "an opening belongs to a dispatched consist run: " + item);
                    }
                    // The phase that commanded it is the opening phase, never a re-entry.
                    foreach (var item in opens)
                        Assert.AreEqual(TrainPhase.Opening, item.Phase, "an opening is the opening phase: " + item);
                    foreach (var item in closes)
                        Assert.AreEqual(TrainPhase.Hold, item.Phase,
                            "the leaves are shut by the hold, after the closing phase ramped them: " + item);
                    // The pose follows the fraction: the observed leaf's x moves by the staged slide.
                    var opened = opens[0];
                    var shut = closes[0];
                    Assert.Greater(Mathf.Abs(opened.LeafX - shut.LeafX), 0f,
                        "the doorway's leaf wrote a pose between shut and open");
                    Assert.AreEqual(0f, view.Rig.BankFraction(-view.PlatformBank), 1e-6f,
                        "the inactive bank is still shut at the end of the run");
                    Assert.GreaterOrEqual(opened.Doorway, 0, "the event names the doorway its leaf belongs to");
                    Assert.AreEqual(shut.ServiceSequence, opened.ServiceSequence,
                        "the closing belongs to the same consist run that opened");
                }
            } finally {
                zooRenderer.LogDoorEvents = false;
                zooRenderer.ClearDoorEvents();
            }
        }

        // ------------------------------------------- idle consults (plan 18 §7)

        /// <summary>
        /// 18 §7  a station opened before Play shows **no consist**. The formation is staged
        /// inactive and only an active service run may mount it; the `None` record the session
        /// still publishes in the gap between runs (which the clock and arrival forecast need)
        /// is not a train at a platform.
        /// </summary>
        [Test]
        public void AStationOpenedBeforePlayAndTheGapBetweenRunsShowNoConsist() {
            foreach (var view in zooRenderer.Consists) {
                Assert.IsFalse(view.Visible, view.TrainId + " is staged hidden before any frame");
                Assert.IsTrue(view.Root != null && !view.Root.activeSelf, view.TrainId + " root is inactive, not just unfocused");
            }
            // The paused/restart frame and an idle service record both leave it parked.
            Assert.IsFalse(zooRenderer.Apply(Frame(false,
                Train("5|track-1", TrainPhase.None, 0, 0, 0),
                Train("5|track-5", TrainPhase.None, 0, 0, 0))),
                "a frame of idle services positions no consist");
            foreach (var view in zooRenderer.Consists) {
                Assert.IsFalse(view.Visible, view.TrainId + " stays hidden through an idle frame");
                Assert.AreEqual(TrainPhase.None, view.Phase);
                Assert.AreEqual(0f, view.OffsetMetres, "a parked consist sits on its berth, not at its departure");
            }
        }

        /// <summary>
        /// A level/section pass writes renderers, never root active state, so the retired
        /// consist must stay hidden through Hidden, Ghost and Base  and a second dispatch of
        /// the same service must start beyond the approach rail instead of blending out of the
        /// previous departure.
        /// </summary>
        [Test]
        public void RetiredConsistsStayHiddenThroughVisibilityAndRestartAtTheRail() {
            var view = Consist("5|track-1");
            // The production walk registers every record; the root's active state, not a
            // renderer flag, is what a level toggle must not be able to override.
            using var registry = new StationVisibilityRegistry(Shader.Find("Universal Render Pipeline/Lit"));
            var modules = new Dictionary<string, StationModuleRecord>(StringComparer.Ordinal);
            foreach (var module in zooDocument.Modules) modules[module.Id] = module;
            var grid = registry.State.Grid;
            foreach (var record in zooWorld.Records) {
                if (record?.View == null) continue;
                registry.Register(record.View.transform,
                    StationViewFeature.RoleOf(record, modules),
                    StationViewFeature.LevelsOf(record, modules, grid));
            }
            var target = registry.Targets.FirstOrDefault(candidate =>
                candidate.Root != null && candidate.Root == view.Root.transform);
            Assert.IsNotNull(target, "the consist is registered with a visibility target");
            foreach (var mode in new[] { StationDrawMode.Hidden, StationDrawMode.Ghost, StationDrawMode.Base }) {
                target.Apply(mode, null);
                Assert.IsFalse(view.Visible, mode + " must not resurrect a retired consist");
            }

            // First service: approach, so the pose is live.
            zooRenderer.Apply(Frame(true,
                Train("5|track-1", TrainPhase.Approach, 5, 0, 3),
                Train("5|track-5", TrainPhase.None, 0, 0, 0)));
            Assert.IsTrue(view.Visible, "an active run mounts the consist");
            Assert.AreEqual(3, view.ServiceSequence);
            // Depart, then the true gap: the root goes away and both door banks shut.
            zooRenderer.Apply(Frame(true,
                Train("5|track-1", TrainPhase.Depart, 5, 0, 3),
                Train("5|track-5", TrainPhase.None, 0, 0, 0)));
            var departed = view.DocumentPosition.x;
            Assert.IsFalse(zooRenderer.Apply(Frame(true,
                Train("5|track-1", TrainPhase.None, 0, 0, 0),
                Train("5|track-5", TrainPhase.None, 0, 0, 0))), "the gap positions nothing");
            Assert.IsFalse(view.Visible, "the departed consist is retired, not left parked");
            Assert.AreEqual(0f, view.Rig.Plus, 1e-6f);
            Assert.AreEqual(0f, view.Rig.Minus, 1e-6f);
            // The next dispatch of the same service: a new sequence, its own approach pose.
            zooRenderer.Apply(Frame(true,
                Train("5|track-1", TrainPhase.Approach, 0, 0, 4),
                Train("5|track-5", TrainPhase.None, 0, 0, 0)));
            Assert.IsTrue(view.Visible, "the next dispatch mounts it again");
            Assert.AreEqual(4, view.ServiceSequence, "a new consist run is its own sequence");
            Assert.AreEqual(-(view.Berth.HalfLength + view.Berth.ApproachRun), view.OffsetMetres, .01f,
                "the next train starts beyond the approach rail");
            Assert.Less(view.DocumentPosition.x, departed - 100f,
                "it never interpolates from the previous departure");
        }

        // ------------------------------------------- shared consist pose (plan 18 §8.2)

        /// <summary>
        /// 18 §8.2  the passenger runtime and the consist view must sample **one** pose. The
        /// sim's `StationTrainPose` is the shared owner (the runtime cannot reference the view
        /// assembly); this pins it against the view's own berth derivation on both Zoo tracks,
        /// position, facing, direction, runs, half length and the cabin-floor datum, so the two
        /// cannot drift apart.
        /// </summary>
        [Test]
        public void TheSimConsistPoseMatchesTheViewBerthOnEveryZooTrack() {
            var sessionDocument = StationSessionProjection.Document(zooDocument, zooRead.Index);
            var lineFact = sessionDocument.Lines.First(candidate => candidate.Id == "5");
            foreach (var trackId in new[] { "track-1", "track-5" }) {
                var view = Consist("5|" + trackId);
                Assert.IsTrue(StationTrainPose.TryBerth(sessionDocument, lineFact, true, trackId,
                    StationTrainPose.DefaultScale, out var sim, out var failure), trackId + ": " + failure);
                Assert.AreEqual((double)view.Berth.DocumentPosition.x, sim.X, 1e-3, trackId + " berth x");
                Assert.AreEqual((double)view.Berth.DocumentPosition.y, sim.Y, 1e-3, trackId + " berth y");
                Assert.AreEqual((double)view.Berth.DocumentPosition.z, sim.Z, 1e-3, trackId + " berth z");
                Assert.AreEqual((double)view.Berth.Facing.x, sim.Fx, 1e-6, trackId + " facing x");
                Assert.AreEqual((double)view.Berth.Facing.y, sim.Fy, 1e-6, trackId + " facing y");
                Assert.AreEqual(view.Berth.DirectionSign, sim.DirectionSign, trackId + " direction sign");
                Assert.AreEqual((double)view.Berth.HalfLength, sim.HalfLength, 1e-3, trackId + " half length");
                Assert.AreEqual((double)view.Berth.ApproachRun, sim.ApproachRun, 1e-3, trackId + " approach run");
                Assert.AreEqual((double)view.Berth.DepartRun, sim.DepartRun, 1e-3, trackId + " depart run");
                Assert.AreEqual((double)view.Berth.CabinFloorDocumentZ, sim.CabinFloorZ, 1e-3,
                    trackId + " cabin-floor datum");
                foreach (var phase in new[] { TrainPhase.Approach, TrainPhase.Depart, TrainPhase.Dwell }) {
                    for (double t = 0; t <= 5; t += 1) {
                        Assert.AreEqual((double)TrainConsistGeometry.OffsetMetres(phase, t, view.Berth),
                            StationTrainPose.OffsetMetres(phase, t, sim), 1e-3,
                            trackId + " " + phase + " offset at " + t + " s");
                    }
                }
            }
        }

        static string Describe(List<TrainDoorEvent> events) {
            var builder = new System.Text.StringBuilder();
            for (int i = 0; i < events.Count; i++) {
                if (i > 0) builder.Append("; ");
                builder.Append(events[i].ToString());
            }
            return builder.ToString();
        }
    }
}
