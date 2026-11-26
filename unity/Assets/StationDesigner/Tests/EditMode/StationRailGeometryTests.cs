using System;
using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// Plan 17 §3: the shared rail datum. The track bed, the consist berth, the platform
    /// screen doors and the platform-block inset all read one frame — recessed bed, rail
    /// running surface, wheel datum, cabin floor, platform top, PSD face and sill plane —
    /// instead of each re-deriving a number (which is how the old ballast cube ended up at
    /// platform height and the rails a metre above their bed).
    /// </summary>
    public sealed class StationRailGeometryTests {
        const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";

        static StationDocument zoo;
        static StationReadResult zooRead;

        [OneTimeSetUp]
        public void LoadZoo() {
            zooRead = StationDocumentReader.ReadFile(ZooPath);
            Assert.IsNotNull(zooRead, "Zoo fixture missing: " + ZooPath);
            zoo = zooRead.Document;
        }

        static StationModuleRecord Track(string id) =>
            zoo.Modules.First(module => module.Id == id);

        static StationLineRecord Line() => zoo.Lines[0];

        [Test]
        public void TheDatumPutsTheCabinFloorOnThePlatformAndTheRailInTheTrench() {
            var berth = new TrainBerth();
            foreach (var id in new[] { "track-1", "track-5" }) {
                var track = Track(id);
                float scale = StationRailGeometry.ModelScale(.98f);
                Assert.IsTrue(TrainConsistGeometry.TryBerth(zoo, Line(), track, scale, out berth, out var failure), failure);
                // The rail head is 0.2 m above the bed top, the bed sits 1.46 m below the
                // platform top, and the cabin floor is exactly the platform top.
                Assert.AreEqual(StationRailGeometry.BedTop(scale), berth.RailSurfaceZ - track.Z - .2f * scale, 1e-3f,
                    id + ": the rail datum comes from the shared bed");
                Assert.AreEqual(-.4602f, StationRailGeometry.BedTop(scale), 2e-3f, id + ": recessed bed");
                Assert.AreEqual(track.Z + 1f, berth.PlatformTopZ, 1e-6f, id + ": platform top is one metre up");
                Assert.AreEqual(berth.PlatformTopZ, berth.CabinFloorDocumentZ, 1e-4f,
                    id + ": the cabin floor meets the platform");
                Assert.Less(berth.RailSurfaceZ, berth.PlatformTopZ - .6f,
                    id + ": the rail runs in the trench below the platform face");
                Assert.AreEqual(StationRailGeometry.TrainOrigin(scale), berth.DocumentPosition.z - track.Z, 1e-5f,
                    id + ": the consist origin is the shared train origin");
                // The stock scale changes the running gear only: the platform top never moves.
                Assert.AreEqual(track.Z + 1f, StationRailGeometry.PlatformTopAboveModule + track.Z, 1e-6f);
            }
        }

        [Test]
        public void ThePlatformInsetEdgeIsThePsdSillsNearEdge() {
            // The floor block stops where the sill starts, on either bank: the shared
            // `edge` and the sill's platform-side face are the same line.
            Assert.AreEqual(StationPlatformInsets.Edge, StationRailGeometry.CellEdge, 1e-9);
            Assert.AreEqual(1 - StationPlatformInsets.Edge, StationRailGeometry.PsdSillNearEdge(-1), 1e-9,
                "side=left: the cut on the 0 side is the sill's near edge");
            Assert.AreEqual(StationPlatformInsets.Edge, StationRailGeometry.PsdSillNearEdge(1), 1e-9,
                "side=right: the cut on the 1 side is the sill's near edge");
            foreach (int toward in new[] { -1, 1 }) {
                float sillY = StationRailGeometry.PsdSillY(toward, false);
                float depth = StationRailGeometry.PsdSillDepth(false);
                double near = .5 + sillY - toward * depth * .5;
                Assert.AreEqual(StationRailGeometry.PsdSillNearEdge(toward), near, 1e-5,
                    "toward " + toward + ": the sill's platform-side face lands on the inset edge");
            }
        }

        [Test]
        public void TheZooRailsTakeTheSideWithoutScreenDoors() {
            var facts = zoo.Modules.Select(module => module.Facts).ToArray();
            foreach (var id in new[] { "track-1", "track-5" }) {
                var track = Track(id);
                var edge = StationRailGeometry.PlatformEdgeFor(zoo, track, Line().Id, Line().Direction);
                Assert.IsNotNull(edge, id + " has a boarding edge");
                int side = StationRailGeometry.ThirdRailSide(track.Facts, facts, Line().Direction);
                bool left = string.Equals(edge.Config.Text("side"), "left", StringComparison.Ordinal);
                Assert.AreEqual(left ? -1 : 1, side, id + ": the live rail avoids the platform screen");
            }
        }

        [Test]
        public void SwappedEdgeAndDirectionFlipTheLiveRailAndTheBerthAcross() {
            // Same track, the other screen side: the conductor rail moves to the other edge.
            var save = JObject.Parse(System.IO.File.ReadAllText(System.IO.Path.Combine(Application.dataPath,
                "StationDesigner/Demos/zoo.metro.json")));
            foreach (var token in (JArray)save["static"]["modules"]) {
                var module = (JObject)token;
                if ((string)module["type"] != "platform-edge") continue;
                ((JObject)module["cfg"])["side"] = "right";
            }
            var read = StationDocumentReader.Read(save.ToString(Formatting.None), new StationSource("rail swap", ""));
            var facts = read.Document.Modules.Select(module => module.Facts).ToArray();
            var track = read.Document.Modules.First(module => module.Id == "track-1");
            Assert.AreEqual(1, StationRailGeometry.ThirdRailSide(track.Facts, facts, Line().Direction),
                "a right-hand screen puts the live rail on the +y edge");
        }

        /* --------------------------------------------------------- the built run */

        static RuntimeCatalogue Catalogue() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "runtime catalogue missing: " + RuntimeCatalogue.AssetPath);
            return catalogue;
        }

        static TrainCatalogue Trains() {
            var catalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "train catalogue missing: " + TrainCatalogue.AssetPath);
            return catalogue;
        }

        static JObject Save(JArray modules) => new JObject {
            ["format"] = StationDocumentReader.SaveFormat,
            ["formatVersion"] = StationDocumentReader.SupportedVersion,
            ["savedAt"] = StationDocumentReader.FixedSavedAt,
            ["name"] = "rail probe", ["city"] = "guangzhou", ["seed"] = 11,
            ["levelBase"] = 0, ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = new JArray(),
                ["modules"] = modules,
                ["lines"] = new JArray(new JObject {
                    ["id"] = "5", ["name"] = "Line 5", ["colour"] = "#c70541",
                    ["stock"] = "L", ["cars"] = 6, ["power"] = "third-rail",
                    ["direction"] = "up", ["psd"] = "full",
                    ["headwayProfile"] = new JObject { ["peak"] = 150, ["offpeak"] = 240, ["late"] = 480 },
                }),
            },
        };

        static JObject TrackModule(string id, int z, int rot, string dir = "up") => new JObject {
            ["id"] = id, ["type"] = "track", ["x"] = 10, ["y"] = 4, ["z"] = z,
            ["w"] = 64, ["d"] = 3, ["rot"] = rot,
            ["cfg"] = new JObject { ["line"] = "5", ["dir"] = dir },
        };

        static JObject EdgeModule(string id, int z, string side, string dir = "up") => new JObject {
            ["id"] = id, ["type"] = "platform-edge", ["x"] = 10, ["y"] = 7, ["z"] = z,
            ["w"] = 64, ["rot"] = 0,
            ["cfg"] = new JObject { ["line"] = "5", ["dir"] = dir, ["side"] = side, ["psd"] = "full", ["from"] = "track" },
        };

        static StationBox MeasuredBounds(GameObject view) {
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            foreach (var filter in view.GetComponentsInChildren<MeshFilter>(true)) {
                var mesh = filter ? filter.sharedMesh : null;
                if (!mesh) continue;
                var local = mesh.bounds;
                for (int corner = 0; corner < 8; corner++) {
                    var world = filter.transform.TransformPoint(new Vector3(
                        (corner & 1) == 0 ? local.min.x : local.max.x,
                        (corner & 2) == 0 ? local.min.y : local.max.y,
                        (corner & 4) == 0 ? local.min.z : local.max.z));
                    var document = StationCoordinates.WorldToDocument(world);
                    min = Vector3.Min(min, document);
                    max = Vector3.Max(max, document);
                }
            }
            return new StationBox(min.x, min.y, min.z, max.x, max.y, max.z);
        }

        [Test]
        public void TheStreetRendererBuildsTheTrenchBedSeparateSteelPartsAndPower() {
            var read = StationDocumentReader.Read(Save(new JArray {
                TrackModule("track", -20, 0),
                EdgeModule("edge", -20, "left"),
            }).ToString(Formatting.None), new StationSource("rail probe", ""));
            var root = new GameObject("rail view probe");
            var street = new StationStreetModuleRenderer();
            var world = new StationWorldView(root.transform, "rail probe",
                new IStationViewRenderer[] { street },
                new StationViewAssets { Catalogue = Catalogue(), TrainCatalogue = Trains(), Shader = FindShader() });
            try {
                world.Build(read.Document, read.Index);
                world.Activate();
                Assert.IsTrue(world.TryGetModule("track", out var record), "the track run is registered");
                Assert.AreEqual("track-run", record.Part);
                var view = record.View;
                var renderers = view.GetComponentsInChildren<MeshRenderer>(true)
                    .Where(renderer => renderer.enabled).ToArray();
                Assert.GreaterOrEqual(renderers.Length, 4, "bed, rail, hardware and power are separate parts");
                var materials = renderers.Select(renderer => renderer.sharedMaterial.name).Distinct().ToArray();
                CollectionAssert.Contains(materials, "track bed");
                CollectionAssert.Contains(materials, "track rail");
                CollectionAssert.Contains(materials, "track hardware");
                CollectionAssert.Contains(materials, "track power");
                Assert.IsTrue(street.TrackNotes.Any(note => note.StartsWith("track ", StringComparison.Ordinal) &&
                    note.Contains("third-rail side=-1")),
                    "the live rail takes the side without the screen: " + string.Join("; ", street.TrackNotes));

                // The drawn run lives in the trench: its top is the rail crown at
                // z − 0.264, not a ballast cube at the platform top (z + 1).
                var bounds = MeasuredBounds(view);
                var parts = string.Join("; ", view.GetComponentsInChildren<MeshFilter>(true)
                    .Where(filter => filter && filter.sharedMesh)
                    .Select(filter => filter.name + " local=" + filter.sharedMesh.bounds.center + "/" +
                        filter.sharedMesh.bounds.size));
                // The trench walls end at the track cell's own floor elevation; the rail
                // crown sits 0.26 m below it, never at the platform top one metre above.
                Assert.AreEqual(-20f, bounds.Z1, .02f,
                    "the run tops out at the track cell's floor, not the platform | " + parts + " | doc=" + bounds);
                var railPart = view.GetComponentsInChildren<MeshFilter>(true).First(filter => filter.name == "track-rail");
                float crown = float.MinValue;
                foreach (var vertex in railPart.sharedMesh.vertices) {
                    var worldPoint = railPart.transform.TransformPoint(vertex);
                    crown = Mathf.Max(crown, StationCoordinates.WorldToDocument(worldPoint).z);
                }
                Assert.AreEqual(-20f + StationRailGeometry.RailTopAboveModule(.98f), crown, .01f,
                    "the rail crown is the shared rail datum");
                Assert.Less(crown, -20f, "the rail is recessed below the track cell's floor");
                Assert.AreEqual(-21f, bounds.Z0, .01f,
                    "the dug bed's concrete underside meets the integer grid one metre below");
                Assert.AreEqual(64f, bounds.X1 - bounds.X0, .05f, "the run keeps its saved length");
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void TheRunPortsSleeperSpacingGaugeAndAReversedRun() {
            foreach (int rot in new[] { 0, 1, 2, 3 }) {
                var run = RailRunGeometry.Build(64f, 3f, .98f, rot % 2 == 0 ? -1 : 1, false);
                Assert.AreEqual(64f, run.Width);
                Assert.AreEqual(Mathf.RoundToInt(64f / .6f), run.SleeperCount, "sleeper cadence is the source's 0.6 m");
                Assert.AreEqual(64f / run.SleeperCount, run.SleeperSpacing, 1e-4f);
                Assert.AreEqual(StationRailGeometry.RailCentreOffset, run.Gauge, 1e-6f, "1.435 m gauge");
                Assert.Greater(run.Bed.TriangleCount, 0);
                Assert.Greater(run.Steel.TriangleCount, 0);
                Assert.Greater(run.Dark.TriangleCount, 0);
                Assert.Greater(run.Power.TriangleCount, 0, "the third-rail cover is its own part");
                Assert.AreEqual(rot % 2 == 0 ? -1 : 1, run.ThirdRailSide);
                Assert.AreEqual(.75f, StationRailGeometry.CellEdge, 1e-6);
            }
            var overhead = RailRunGeometry.Build(48f, 3f, .98f, -1, true);
            Assert.IsTrue(overhead.Catenary);
            Assert.Greater(overhead.Dark.TriangleCount, 0, "overhead masts and wire geometry");
            Assert.IsTrue(overhead.Notes.Any(note => note.Contains("catenary")), "the overhead simplification is named");
        }

        static Shader FindShader() =>
            Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");

        /* ------------------------------------------------------ the bridge deck */

        static JObject BridgeTrack(string id, int z, string railing, string dir = "down") => new JObject {
            ["id"] = id, ["type"] = "track", ["x"] = 10, ["y"] = 4, ["z"] = z,
            ["w"] = 32, ["d"] = 3, ["rot"] = 0,
            ["cfg"] = new JObject {
                ["line"] = "5", ["dir"] = dir, ["bridge"] = true, ["bridgeRailing"] = railing,
                ["bridgeFinish"] = "floor.concrete",
            },
        };

        /// <summary>
        /// Plan 22 §1: a `cfg.bridge` run draws a raised deck, its edge shoulders and the barrier
        /// the save names. `BuildTrackRun` dropped the whole bridge group and `BuildParts` emitted
        /// the trench, so Tanwei's four 32 × 3 m bridge runs came out as dug track with no deck
        /// over them while the web drew the bridge in the reference screenshot.
        /// </summary>
        [Test]
        public void ABridgeRunDrawsADeckShouldersAndItsBarrierInsteadOfATrench() {
            var trench = RailRunGeometry.Build(32f, 3f, .98f, -1, false);
            var bridge = RailRunGeometry.Build(32f, 3f, .98f, -1, false, new RailBridgeOptions {
                Railing = "sound-barrier-half", VehicleWidth = 3f,
            });
            Assert.AreEqual(0, trench.Deck.TriangleCount, "a ground run has no deck");
            Assert.Greater(bridge.Deck.TriangleCount, 0, "the raised deck and its two shoulders");
            Assert.Greater(bridge.Panel.TriangleCount, 0, "the sound barrier's opaque lower panels");
            // A bridge run replaces the dug course (and the two trench walls) with the deck, so its
            // bed bin never reaches the full metre the ground run's dug course reaches.
            Assert.Less(trench.Bed.Vertices.Min(vertex => vertex.y), -.9f, "the ground run digs its trench a metre down");
            Assert.Greater(bridge.Bed.Vertices.Min(vertex => vertex.y), -.9f,
                "a bridge run's bed carries no dug course: the deck below it is a separate part");
            // `bridgeSupportOffset = max(d/2 + 0.5 − PSD_WALL_OFFSET, vehicleWidth/2 + 0.25)`
            // = max(1.66, 1.75), and `bridgeSpan = max(d, offset·2 + 0.12)` = 3.62.
            Assert.AreEqual(1.75f, bridge.BridgeSupportOffset, 1e-4f);
            Assert.AreEqual(3.62f, bridge.BridgeSpan, 1e-4f);
            Assert.IsTrue(bridge.Notes.Exists(note => note.StartsWith("track-bridge", StringComparison.Ordinal)),
                "the bridge composition is named: " + string.Join("; ", bridge.Notes));
        }

        [Test]
        public void ABridgeRailingTakesItsOwnHeightAndTheHalfBarrierIsTwoMetres() {
            Assert.AreEqual(1.29f, new RailBridgeOptions { Railing = "railing" }.BarrierTop, 1e-4f);
            Assert.AreEqual(2f, new RailBridgeOptions { Railing = "sound-barrier-half" }.BarrierTop, 1e-4f);
            Assert.AreEqual(3.5f, new RailBridgeOptions { Railing = "sound-barrier" }.BarrierTop, 1e-4f);
        }

        [TestCase(true, 3f)]
        [TestCase(false, 3.62f)]
        public void OpenTrackWithoutRailingsKeepsTheDeckAndHardware(bool groundTrack, float span) {
            var options = new RailBridgeOptions { Railing = "none", GroundTrack = groundTrack, VehicleWidth = 3f };
            var track = RailRunGeometry.Build(32f, 3f, .98f, -1, false, options);
            Assert.AreEqual(span, track.BridgeSpan, 1e-4f);
            Assert.AreEqual(12, track.Deck.TriangleCount, "only the slab remains");
            Assert.AreEqual(0, track.Panel.TriangleCount);
            Assert.Greater(track.Steel.TriangleCount, 0, "running rails still render");
            Assert.AreEqual(0f, options.BarrierTop);
        }

        [Test]
        public void TheStreetRendererBuildsTheSavedBridgeDeckAndBarrier() {
            var read = StationDocumentReader.Read(Save(new JArray {
                BridgeTrack("track", -20, "sound-barrier-half"),
                EdgeModule("edge", -20, "left", "down"),
            }).ToString(Formatting.None), new StationSource("bridge probe", ""));
            var root = new GameObject("bridge view probe");
            var street = new StationStreetModuleRenderer();
            var world = new StationWorldView(root.transform, "bridge probe",
                new IStationViewRenderer[] { street },
                new StationViewAssets { Catalogue = Catalogue(), TrainCatalogue = Trains(), Shader = FindShader() });
            try {
                world.Build(read.Document, read.Index);
                world.Activate();
                Assert.IsTrue(world.TryGetModule("track", out var record));
                var view = record.View;
                var partNames = view.GetComponentsInChildren<MeshFilter>(true)
                    .Where(filter => filter && filter.sharedMesh).Select(filter => filter.name).Distinct().ToArray();
                CollectionAssert.Contains(partNames, "track-deck");
                CollectionAssert.Contains(partNames, "track-barrier-panel");
                CollectionAssert.Contains(partNames, "track-rail");
                var bounds = MeasuredBounds(view);
                Assert.AreEqual(-20f + 2f, bounds.Z1, .03f,
                    "a half-height noise barrier tops out two metres above the track anchor | " + bounds);
                Assert.AreEqual(-20f - 1f, bounds.Z0, .03f,
                    "the deck hangs BRIDGE_DECK_DEPTH below the track record's floor elevation | " + bounds);
                Assert.Greater(bounds.Y1 - bounds.Y0, 3f, "the shoulders make the deck wider than the 3 m bed");
                Assert.Less(bounds.Y1 - bounds.Y0, 4f, "and no wider than its two screen-door centre lines");
                Assert.IsTrue(street.TrackNotes.Any(note => note.Contains("track-bridge")),
                    "the bridge note reaches the binding trace: " + string.Join("; ", street.TrackNotes));
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }
    }
}
