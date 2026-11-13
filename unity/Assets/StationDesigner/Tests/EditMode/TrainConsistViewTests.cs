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

        static StationTrainFrame Train(string id, TrainPhase phase, double seconds, double door) {
            var parts = (id ?? "").Split('|');
            return new StationTrainFrame {
                Id = id ?? "", LineId = parts.Length > 0 ? parts[0] : "",
                TrackId = parts.Length > 1 ? parts[1] : "",
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
        public void CarsAreRegisteredForPickingByLineTrackIndex() {
            var records = zooWorld.Records.Where(record => record.Role == "trains").ToArray();
            Assert.AreEqual(12, records.Length, "two consists of six cars");
            foreach (var trainId in new[] { "5|track-1", "5|track-5" }) {
                for (int i = 0; i < 6; i++) {
                    var id = "train:" + trainId + "|" + i;
                    var record = records.FirstOrDefault(candidate => candidate.ModuleId == id);
                    Assert.IsNotNull(record, id + " is registered");
                    Assert.AreEqual("car", record.Part);
                    Assert.IsNotNull(record.View, id + " has a live view");
                    Assert.IsTrue(record.HasBounds, id + " carries document bounds");
                    Assert.LessOrEqual(record.LevelMin, record.LevelMax);
                    Assert.IsTrue(zooWorld.TryGetModule(id, out var picked), id + " is pickable");
                    Assert.AreSame(record.View, picked.View);
                }
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
    }
}
