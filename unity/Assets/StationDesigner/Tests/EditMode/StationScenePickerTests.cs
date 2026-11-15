using System;
using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// Plan 17 §7: the equipment/decor pick. A combined surface batch has no authored
    /// module id on its GameObject, so the old picker discarded every batched tile; the
    /// pick index now expands a batch into its per-module contributions, each with the
    /// tile's own box. Body visibility is the registered view rule — not a hard-coded
    /// level offset — and the winning hit carries the **authored** record the router
    /// hands to selection, preview and delete.
    /// </summary>
    public sealed class StationScenePickerTests {
        const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";

        static StationDocument zoo;
        static StationReadResult zooRead;
        static GameObject root;
        static StationWorldView world;

        [OneTimeSetUp]
        public void Load() {
            zooRead = StationDocumentReader.ReadFile(ZooPath);
            Assert.IsNotNull(zooRead, "Zoo fixture missing: " + ZooPath);
            zoo = zooRead.Document;
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "runtime catalogue missing: " + RuntimeCatalogue.AssetPath);
            var trains = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            root = new GameObject("picker probe");
            world = new StationWorldView(root.transform, "picker probe", new IStationViewRenderer[] {
                new OutdoorModuleRenderer(),
                new StationSurfaceModuleRenderer(),
                new StationStreetModuleRenderer(),
                new StationEquipmentModuleRenderer(),
                new StationDisplayModuleRenderer(),
            }, new StationViewAssets {
                Catalogue = catalogue, TrainCatalogue = trains, Shader = FindShader(),
            });
            world.Build(zoo, zooRead.Index);
            world.Activate();
        }

        [OneTimeTearDown]
        public void Release() {
            StationScenePicker.Reset();
            world?.Dispose();
            world = null;
            if (root != null) UnityEngine.Object.DestroyImmediate(root);
            root = null;
        }

        static Shader FindShader() =>
            Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");

        static Ray DownAt(double x, double y, double z = 60) =>
            new Ray(StationCoordinates.Point(new Vector3((float)x, (float)y, (float)z)), Vector3.down);

        static Ray UpAt(double x, double y, double z) =>
            new Ray(StationCoordinates.Point(new Vector3((float)x, (float)y, (float)z)), Vector3.up);

        [Test]
        public void ACombinedSurfaceBatchPicksItsAuthoredTileNotTheChunk() {
            var batches = world.Records.Where(record => record.Role == "surfaces" && record.Part == "batch").ToArray();
            Assert.Greater(batches.Length, 0, "the Zoo paving is combined into batches");
            var batch = batches.First(record => record.SourceIds != null && record.SourceIds.Length > 4 &&
                record.SourceBounds != null && record.SourceBounds.Length == record.SourceIds.Length);
            Assert.IsNotNull(batch.SourceBounds, "a batch carries per-module bounds");
            foreach (var box in batch.SourceBounds) {
                if (box.IsEmpty) continue;
                Assert.LessOrEqual(box.X1 - box.X0, 2.01, "a batched tile's own contribution is one cell, not a chunk");
                Assert.LessOrEqual(box.Y1 - box.Y0, 2.01);
            }
            int checkedTiles = 0;
            var ids = new HashSet<string>(batch.SourceIds);
            var picked = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < batch.SourceIds.Length && checkedTiles < 8; i++) {
                var module = zoo.Modules.FirstOrDefault(record => record.Id == batch.SourceIds[i]);
                if (module == null) continue;
                // A tile that shares its cell with a taller module may lose the ray to it;
                // every pick must still be one of the batch's own authored records.
                var hit = StationScenePicker.PickRay(world, DownAt(module.X + .5, module.Y + .5), module.Z);
                checkedTiles++;
                Assert.IsTrue(hit.HasModule, "tile " + module.Id + " must be pickable");
                Assert.IsTrue(ids.Contains(hit.Module.Id),
                    "the winner is an authored tile of the batch, not the chunk: " + hit.Module.Id);
                Assert.IsTrue(Array.IndexOf(hit.Record.SourceIds, hit.Module.Id) >= 0,
                    "the winning record is the batch contribution that draws the tile");
                picked.Add(hit.Module.Id);
            }
            Assert.Greater(picked.Count, 1, "different tiles resolve to different authored ids");
        }

        [Test]
        public void DecorAndEquipmentResolveToTheirAuthoredIds() {
            foreach (var pair in new[] {
                new { Type = "bench", Role = "equipment" },
                new { Type = "cctv", Role = "equipment" },
                new { Type = "tv", Role = "displays" },
            }) {
                var module = zoo.Modules.FirstOrDefault(record => record.Type == pair.Type);
                if (module == null) continue;
                var hit = StationScenePicker.PickRay(world, DownAt(module.X + .5, module.Y + .5), module.Z);
                if (!hit.HasModule) {
                    hit = StationScenePicker.PickRay(world, UpAt(module.X + .5, module.Y + .5, module.Z - 2), module.Z);
                }
                Assert.IsTrue(hit.HasModule, pair.Type + " " + module.Id + " must resolve a body");
                Assert.AreEqual(pair.Role, hit.Record.Role, pair.Type + " resolves through its own renderer");
                Assert.AreEqual(module.Id, hit.Module.Id, pair.Type + " keeps its authored id");
            }
        }

        [Test]
        public void ACellOnlyRayStillReportsThePlacementHit() {
            var hit = StationScenePicker.PickRay(world, DownAt(20.5, -80.5), 0);
            Assert.IsTrue(hit.HasCell, "an empty street cell still gives a placement hit");
            Assert.IsFalse(hit.HasModule, "and names no module");
        }

        [Test]
        public void AStoreyHiddenByTheViewRuleCannotBePickedThrough() {
            var buried = zoo.Modules.FirstOrDefault(record => record.Type == "bench" && record.Z <= -15);
            if (buried == null) buried = zoo.Modules.First(record => record.Z <= -15 && record.Type == "tv");
            var registry = new StationVisibilityRegistry();
            try {
                registry.State.LevelBase = zoo.LevelBase;
                registry.State.StoreyHeight = zoo.StoreyHeight;
                registry.State.ActiveLevel = 0;
                registry.State.ShowLevels = false;
                var hidden = StationScenePicker.PickRay(world, DownAt(buried.X + .5, buried.Y + .5), -20, registry);
                Assert.IsFalse(hidden.HasModule && hidden.Module.Id == buried.Id,
                    "a storey the view rule hides cannot be picked through");

                registry.State.ActiveLevel = buried.Z;
                var visible = StationScenePicker.PickRay(world, DownAt(buried.X + .5, buried.Y + .5), buried.Z, registry);
                Assert.IsTrue(visible.HasModule, "the same ray resolves once its storey is active");
                Assert.AreEqual(buried.Z, visible.Module.Z, "the active storey's own body wins");
            } finally {
                registry.Dispose();
            }
        }

        /* --------------------------------------- drawn surfaces (plan 18 §9) */

        /// <summary>
        /// 18 §9 — the module's document bounds are a **shortlist**, not the answer. A wall
        /// inscription answers from its own plate: the hit carries the painted surface's
        /// document position and normal and the same point in the module's local axes, so the
        /// router can attach a carried piece to the face it was really clicked on.
        ///
        /// The fixture isolates one thin plate inside an oversized document box, because the
        /// real save can legitimately have a nearer billboard in front of an inscription.
        /// </summary>
        [Test]
        public void AWallInscriptionAnswersOnItsOwnPlateNotItsBounds() {
            var envelope = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "picker plate probe", ["city"] = "guangzhou", ["seed"] = 7,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = new JArray(),
                    ["modules"] = new JArray(new JObject {
                        ["id"] = "probe-inscription", ["type"] = "calligraphy", ["x"] = 0, ["y"] = 0, ["z"] = 0,
                        ["rot"] = 0, ["w"] = 4, ["panelH"] = 1, ["cfg"] = new JObject { ["style"] = "wei", ["axis"] = "h" },
                    }),
                    ["lines"] = new JArray(),
                },
            };
            var read = StationDocumentReader.Read(envelope.ToString(Newtonsoft.Json.Formatting.None),
                new StationSource("test:picker-plate", ""));
            Assert.IsNotNull(read?.Document, "the probe document loads");
            var probeRoot = new GameObject("picker plate probe");
            var probeWorld = new StationWorldView(probeRoot.transform, "picker plate",
                Array.Empty<IStationViewRenderer>(), new StationViewAssets());
            GameObject plate = null;
            try {
                probeWorld.Build(read.Document, read.Index);
                // A 4 m wide, 1 m tall plate 2 cm thick whose face points along document +y:
                // in Unity axes that thickness is world z (`StationCoordinates.Point`).
                plate = GameObject.CreatePrimitive(PrimitiveType.Cube);
                UnityEngine.Object.DestroyImmediate(plate.GetComponent<Collider>());
                plate.transform.SetParent(probeRoot.transform, false);
                plate.transform.position = StationCoordinates.Point(new Vector3(2f, 2f, 2f));
                plate.transform.localScale = new Vector3(4f, 1f, .02f);
                probeWorld.RegisterModule("displays", "probe-inscription", plate, "board",
                    new StationBox(-2, 0, 0, 6, 4, 3), 0, 0);
                StationScenePicker.Reset();
                // From 0.3 m in front of the plate along its normal.
                var from = new Vector3(2f, 2f + .3f, 2f);
                var direction = new Vector3(0f, -1f, 0f);
                var hit = StationScenePicker.PickRay(probeWorld,
                    new Ray(StationCoordinates.Point(from), StationCoordinates.Point(direction).normalized), 0);
                Assert.IsTrue(hit.HasModule, "the plate is pickable");
                Assert.AreEqual("probe-inscription", hit.Module.Id, "the plate answers as its own module");
                Assert.IsTrue(hit.ModuleExact, "the hit is the drawn surface, not the module bounds");
                Assert.AreEqual(.3f, hit.ModuleDistance, .02f, "the ray met the plate where it was cast");
                Assert.AreEqual(2f, hit.ModulePoint.Y, .02f, "the surface point is on the plate's face");
                Assert.Greater(Math.Abs(hit.ModuleNormal.Y), .9, "the normal is the plate's face normal");
                Assert.Less(hit.ModuleLocal.magnitude, .51f,
                    "the attachment point is inside the plate's own unit-cube frame");
                // A ray that only crosses the registered bounds misses the plate and picks nothing.
                var beside = StationScenePicker.PickRay(probeWorld,
                    new Ray(StationCoordinates.Point(new Vector3(5f, 2.3f, 2f)), Vector3.down), 0);
                Assert.IsFalse(beside.HasModule && beside.Module.Id == "probe-inscription",
                    "empty space inside the module's bounds is not the inscription");
            } finally {
                StationScenePicker.Reset();
                if (plate) UnityEngine.Object.DestroyImmediate(plate);
                probeWorld.Dispose();
                UnityEngine.Object.DestroyImmediate(probeRoot);
            }
        }

        /// <summary>
        /// 18 §9 — a ray that only crosses a module's **bounds** no longer wins: a prop's box
        /// is larger than its geometry (a hung TV's mount, a gate's lane), and the old picker
        /// handed those clicks to the box. The fixture isolates one drawn cube inside a
        /// deliberately oversized document box, so the two halves are unambiguous.
        /// </summary>
        [Test]
        public void ABoundBoxHoleDoesNotClaimThePick() {
            var envelope = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "picker probe", ["city"] = "guangzhou", ["seed"] = 7,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = new JArray(),
                    ["modules"] = new JArray(new JObject {
                        ["id"] = "probe-billboard", ["type"] = "billboard", ["x"] = 0, ["y"] = 0, ["z"] = 0,
                        ["rot"] = 0, ["w"] = 4, ["cfg"] = new JObject(),
                    }),
                    ["lines"] = new JArray(),
                },
            };
            var read = StationDocumentReader.Read(envelope.ToString(Newtonsoft.Json.Formatting.None),
                new StationSource("test:picker-hole", ""));
            Assert.IsNotNull(read?.Document, "the probe document loads");
            var probeRoot = new GameObject("picker hole probe");
            var probeWorld = new StationWorldView(probeRoot.transform, "picker hole",
                Array.Empty<IStationViewRenderer>(), new StationViewAssets());
            try {
                probeWorld.Build(read.Document, read.Index);
                var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
                UnityEngine.Object.DestroyImmediate(cube.GetComponent<Collider>());
                cube.transform.SetParent(probeRoot.transform, false);
                cube.transform.position = StationCoordinates.Point(new Vector3(1f, 0.5f, 3f));
                cube.transform.localScale = new Vector3(.4f, .4f, .4f);
                // The registered box is deliberately wider than the cube, and its cube sits at
                // the document box's first cell only; the fourth cell is empty geometry.
                probeWorld.RegisterModule("displays", "probe-billboard", cube, "board",
                    new StationBox(0, 0, 0, 4, 1, 1), 0, 0);
                StationScenePicker.Reset();
                // Through the cube: the module answers, from a real surface.
                var through = StationScenePicker.PickRay(probeWorld, DownAt(1f, .5f), 0);
                Assert.IsTrue(through.HasModule, "the drawn cube takes the pick");
                Assert.AreEqual("probe-billboard", through.Module.Id);
                Assert.IsTrue(through.ModuleExact, "the hit is a drawn surface");
                Assert.Less(through.ModuleLocal.magnitude, 1f,
                    "the local attachment point is inside the drawn cube's own frame");
                // Beside the cube but inside the registered box: no module may claim it.
                var beside = StationScenePicker.PickRay(probeWorld, DownAt(3.5f, .5f), 0);
                Assert.IsFalse(beside.HasModule && beside.Module.Id == "probe-billboard",
                    "empty space inside a module's bounds is not the module");
                UnityEngine.Object.DestroyImmediate(cube);
            } finally {
                StationScenePicker.Reset();
                probeWorld.Dispose();
                UnityEngine.Object.DestroyImmediate(probeRoot);
            }
        }
    }
}
