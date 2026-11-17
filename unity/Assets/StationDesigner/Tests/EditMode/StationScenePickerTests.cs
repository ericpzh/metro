using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
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
using UnityEngine.Rendering;

namespace Metro.Tests {
    /// <summary>
    /// Camera-visible pointer picking coverage:
    /// - Storey slicing, Hide Ground / Roof / Ceiling / Walls, Ghost storeys and section-plane cuts;
    /// - World registration visibility pass on initial load, same-station edit rebuilds and undo;
    /// - Shifted levelBase and non-default storeyHeight band parity with Web `storeyBand`;
    /// - Triangle-accurate cell, single-module and combined-batch surface hits (including section-clipped
    ///   front triangles in front of kept faces in the same group/mesh/batch);
    /// - Camera cullingMask and frustum near/far clip exclusions;
    /// - Occlusion without distance forgiveness, coincident prop/tile tie-breaking, scoped ramp-gap
    ///   snap for head-house exits, and router contracts (one pick per tool event, zero picks on
    ///   section handle drags, Select miss clearing selection, carried-piece exclusion, outdoor/hanger
    ///   placement anchors).
    /// </summary>
    public sealed class StationScenePickerTests {
        const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";

        static StationDocument zoo;
        static StationReadResult zooRead;
        static RuntimeCatalogue catalogue;
        static TrainCatalogue trains;
        static GameObject root;
        static StationWorldView world;
        static StationVisibilityRegistry zooVisibility;

        [OneTimeSetUp]
        public void Load() {
            zooRead = StationDocumentReader.ReadFile(ZooPath);
            Assert.IsNotNull(zooRead, "Zoo fixture missing: " + ZooPath);
            zoo = zooRead.Document;
            catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "runtime catalogue missing: " + RuntimeCatalogue.AssetPath);
            trains = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            root = new GameObject("picker probe");
            world = new StationWorldView(root.transform, "picker probe", new IStationViewRenderer[] {
                new OutdoorModuleRenderer(),
                new StationSurfaceModuleRenderer(),
                new StationStreetModuleRenderer(),
                new StationEquipmentModuleRenderer(),
                new StationDisplayModuleRenderer(),
                new StationStructureModuleRenderer(),
            }, new StationViewAssets {
                Catalogue = catalogue, TrainCatalogue = trains, Shader = FindShader(),
            });
            world.Build(zoo, zooRead.Index);
            world.Activate();
            zooVisibility = new StationVisibilityRegistry();
            zooVisibility.State.ActiveLevel = 0;
            zooVisibility.State.ShowLevels = true;
            StationViewFeature.RegisterWorld(zooVisibility, world);
        }

        [OneTimeTearDown]
        public void Release() {
            StationScenePicker.Reset();
            zooVisibility?.Dispose();
            zooVisibility = null;
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

        static Ray DocRay(Vector3 originDoc, Vector3 directionDoc) =>
            new Ray(StationCoordinates.Point(originDoc), StationCoordinates.Direction(directionDoc).normalized);

        static StationWorldView BuildProbeWorld(string json, string name, out GameObject worldRoot,
            params IStationViewRenderer[] renderers) {
            var read = StationDocumentReader.Read(json, new StationSource("test:" + name, ""));
            Assert.IsNotNull(read?.Document, name + " must parse");
            worldRoot = new GameObject(name);
            var built = new StationWorldView(worldRoot.transform, name, renderers, new StationViewAssets {
                Catalogue = catalogue, TrainCatalogue = trains, Shader = FindShader(),
            });
            built.Build(read.Document, read.Index);
            built.Activate();
            return built;
        }

        static string EnvelopeJson(JArray cells, JArray modules, int levelBase = 0, int storeyHeight = 5,
            string name = "picker fixture") =>
            new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = name,
                ["city"] = "guangzhou",
                ["seed"] = 7,
                ["levelBase"] = levelBase,
                ["storeyHeight"] = storeyHeight,
                ["static"] = new JObject {
                    ["cells"] = cells ?? new JArray(),
                    ["modules"] = modules ?? new JArray(),
                    ["lines"] = new JArray(),
                },
            }.ToString(Formatting.None);

        static JObject FinishFaces(string finish) => new JObject {
            ["top"] = finish, ["bottom"] = finish,
            ["n"] = finish, ["s"] = finish, ["e"] = finish, ["w"] = finish,
        };

        static void AddSolidSlab(JArray cells, int x0, int y0, int x1, int y1, int z, string finish = null) {
            for (int x = x0; x < x1; x++) {
                for (int y = y0; y < y1; y++) {
                    var cell = new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid" };
                    if (!string.IsNullOrEmpty(finish)) {
                        cell["finish"] = FinishFaces(finish);
                    }
                    cells.Add(cell);
                }
            }
        }

        /* -------------------------------------------------- Zoo fixtures & batches */

        [Test]
        public void EditableCataloguePrefabsKeepCpuReadableMeshes() {
            Assert.IsNotNull(catalogue?.entries);
            var unreadable = new List<string>();
            foreach (var entry in catalogue.entries) {
                if (entry?.prefab == null) continue;
                foreach (var filter in entry.prefab.GetComponentsInChildren<MeshFilter>(true)) {
                    var mesh = filter != null ? filter.sharedMesh : null;
                    if (mesh == null) unreadable.Add(entry.key + ":<null-mesh>");
                    else if (!mesh.isReadable) unreadable.Add(entry.key + ":" + mesh.name);
                }
            }
            Assert.IsEmpty(unreadable, "unreadable prefab meshes cannot answer triangle surface picks: " +
                string.Join(", ", unreadable));
        }

        [Test]
        public void ACombinedSurfaceBatchPicksItsAuthoredTileNotTheChunk() {
            var batches = world.Records.Where(record => record.Role == "surfaces" && record.Part == "batch").ToArray();
            Assert.Greater(batches.Length, 0, "the Zoo paving is combined into batches");
            var batch = batches.First(record => record.SourceIds != null && record.SourceIds.Length > 4 &&
                record.SourceBounds != null && record.SourceBounds.Length == record.SourceIds.Length);
            Assert.IsNotNull(batch.SourceBounds, "a batch carries per-module bounds");
            Assert.IsNotNull(batch.SourceSpans, "a batch carries per-tile triangle spans");
            Assert.Greater(batch.SourceSpans.Length, 0, "triangle spans map combined triangles back to tiles");
            foreach (var box in batch.SourceBounds) {
                if (box.IsEmpty) continue;
                Assert.LessOrEqual(box.X1 - box.X0, 2.01, "a batched tile's own contribution is one cell, not a chunk");
                Assert.LessOrEqual(box.Y1 - box.Y0, 2.01);
            }
            int checkedTiles = 0;
            var ids = new HashSet<string>(batch.SourceIds);
            var picked = new HashSet<string>(StringComparer.Ordinal);
            try {
                for (int i = 0; i < batch.SourceIds.Length && checkedTiles < 8; i++) {
                    var module = zoo.Modules.FirstOrDefault(record => record.Id == batch.SourceIds[i]);
                    if (module == null) continue;
                    zooVisibility.State.ActiveLevel = StationCoordinates.StoreyBand(module.Z, zoo.LevelBase);
                    zooVisibility.State.HideGround = false;
                    zooVisibility.State.ShowLevels = true;
                    zooVisibility.Apply();

                    var hit = StationScenePicker.PickRay(world, DownAt(module.X + .5, module.Y + .5),
                        zooVisibility.State.ActiveLevel, zooVisibility);
                    checkedTiles++;
                    Assert.IsTrue(hit.HasModule, "tile " + module.Id + " must be pickable");
                    Assert.IsTrue(hit.ModuleExact, "batched tile pick must intersect actual mesh triangles");
                    Assert.IsTrue(ids.Contains(hit.Module.Id) || hit.Module.Z == module.Z,
                        "the winner is an authored module on the active storey: " + hit.Module.Id);
                    if (ids.Contains(hit.Module.Id)) {
                        Assert.IsTrue(Array.IndexOf(hit.Record.SourceIds, hit.Module.Id) >= 0,
                            "the winning record is the batch contribution that draws the tile");
                        picked.Add(hit.Module.Id);
                    }
                }
                Assert.Greater(picked.Count, 1, "different tiles resolve to different authored ids");
            } finally {
                zooVisibility.State.ActiveLevel = 0;
                zooVisibility.Apply();
            }
        }

        [Test]
        public void DecorAndEquipmentResolveToTheirAuthoredIds() {
            double[] offsets = { 0.5, 0.35, 0.65, 0.25, 0.75 };
            try {
                foreach (var pair in new[] {
                    new { Type = "bench", Role = "equipment" },
                    new { Type = "cctv", Role = "equipment" },
                    new { Type = "tv", Role = "displays" },
                }) {
                    var module = zoo.Modules.FirstOrDefault(record => record.Type == pair.Type);
                    Assert.IsNotNull(module, "Zoo owns a " + pair.Type);
                    int activeBand = StationCoordinates.StoreyBand(module.Z, zoo.LevelBase);
                    zooVisibility.State.ActiveLevel = activeBand;
                    zooVisibility.State.HideGround = activeBand < 0;
                    zooVisibility.State.ShowLevels = false;
                    zooVisibility.Apply();

                    StationSceneHit hit = null;
                    foreach (var ox in offsets) {
                        foreach (var oy in offsets) {
                            var candidate = StationScenePicker.PickRay(world,
                                DownAt(module.X + ox, module.Y + oy, module.Z + 4.8), activeBand, zooVisibility);
                            if (candidate.HasModule && candidate.Module.Id == module.Id) { hit = candidate; break; }
                            candidate = StationScenePicker.PickRay(world,
                                UpAt(module.X + ox, module.Y + oy, module.Z + 0.1), activeBand, zooVisibility);
                            if (candidate.HasModule && candidate.Module.Id == module.Id) { hit = candidate; break; }
                        }
                        if (hit != null) break;
                    }
                    Assert.IsNotNull(hit, pair.Type + " " + module.Id + " must resolve an exact triangle hit");
                    Assert.IsTrue(hit.ModuleExact);
                    Assert.AreEqual(pair.Role, hit.Record.Role, pair.Type + " resolves through its own renderer");
                    Assert.AreEqual(module.Id, hit.Module.Id, pair.Type + " keeps its authored id");
                }
            } finally {
                zooVisibility.State.ActiveLevel = 0;
                zooVisibility.State.HideGround = false;
                zooVisibility.State.ShowLevels = true;
                zooVisibility.Apply();
            }
        }

        [Test]
        public void ACellOnlyRayStillReportsThePlacementHit() {
            Assert.IsFalse(default(StationPlacementHit).HasCell, "default StationPlacementHit must report no cell");
            Assert.IsFalse(StationPlacementHit.None.HasCell, "None sentinel must report no cell");

            // `world` has no cell renderer, so an open ray hits neither cell nor module and
            // reports the optional work plane separately from `Cell`.
            var hit = StationScenePicker.PickRay(world, DownAt(20.5, -80.5), 0, zooVisibility);
            Assert.IsFalse(hit.HasCell, "empty air must never populate a synthetic solid/void cell");
            Assert.IsFalse(hit.HasModule, "and names no module");
            Assert.IsTrue(hit.HasWorkPlane, "placement fallback still receives the active level's work plane");
            Assert.AreEqual(StationSceneTargetKind.Plane, hit.TargetKind);
            Assert.AreEqual(20, hit.WorkPlane.X);
            Assert.AreEqual(-81, hit.WorkPlane.Y);
            Assert.AreEqual(0, hit.WorkPlane.Z);
            Assert.AreEqual(1.0, hit.Point.Z, 1e-4);

            // Non-placement tools skip evaluating the work plane altogether.
            var selectContext = StationPickContext.Default(zooVisibility, evaluateWorkPlane: false);
            var miss = StationScenePicker.PickRay(world, DownAt(20.5, -80.5), 0, selectContext);
            Assert.IsFalse(miss.HasCell);
            Assert.IsFalse(miss.HasWorkPlane);
            Assert.AreEqual(StationSceneTargetKind.None, miss.TargetKind);
        }

        [Test]
        public void AStoreyHiddenByTheViewRuleCannotBePickedThrough() {
            var buried = zoo.Modules.FirstOrDefault(record => record.Type == "bench" && record.Z <= -15)
                ?? zoo.Modules.First(record => record.Z <= -15 && record.Type == "tv");
            var registry = new StationVisibilityRegistry();
            try {
                registry.State.ActiveLevel = 0;
                registry.State.ShowLevels = false;
                StationViewFeature.RegisterWorld(registry, world);

                var hidden = StationScenePicker.PickRay(world, DownAt(buried.X + .5, buried.Y + .5), -20, registry);
                Assert.IsFalse(hidden.HasModule && hidden.Module.Id == buried.Id,
                    "a storey the view rule hides cannot be picked through");

                int activeBand = StationCoordinates.StoreyBand(buried.Z, zoo.LevelBase);
                registry.State.ActiveLevel = activeBand;
                registry.State.HideGround = true;
                registry.Apply();

                StationSceneHit visible = null;
                foreach (var ox in new[] { 0.5, 0.35, 0.65 }) {
                    foreach (var oy in new[] { 0.5, 0.35, 0.65 }) {
                        var candidate = StationScenePicker.PickRay(world,
                            DownAt(buried.X + ox, buried.Y + oy, buried.Z + 4.8), activeBand, registry);
                        if (candidate.HasModule && candidate.Module.Z == buried.Z) { visible = candidate; break; }
                    }
                    if (visible != null) break;
                }
                Assert.IsNotNull(visible, "the same storey resolves once its band is active");
                Assert.AreEqual(buried.Z, visible.Module.Z, "the active storey's own body wins");
            } finally {
                registry.Dispose();
                StationViewFeature.RegisterWorld(zooVisibility, world);
            }
        }

        /* ---------------------------------------- grade vs underground (§1 & §4.1) */

        [Test]
        public void GradeSlabOverUndergroundModuleAndFloorObeysActiveStoreyGroundAndShowLevels() {
            var cells = new JArray();
            AddSolidSlab(cells, 0, 0, 5, 5, -10, "floor.concrete");
            var modules = new JArray {
                new JObject { ["id"] = "grade-walk-1", ["type"] = "sidewalk", ["x"] = 2, ["y"] = 2, ["z"] = 0, ["rot"] = 0 },
                new JObject { ["id"] = "grade-walk-2", ["type"] = "sidewalk", ["x"] = 3, ["y"] = 2, ["z"] = 0, ["rot"] = 0 },
                new JObject {
                    ["id"] = "ug-bench", ["type"] = "bench", ["x"] = 2, ["y"] = 2, ["z"] = -10, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "steel-1" },
                },
            };

            GameObject probeRoot = null;
            StationWorldView probeWorld = null;
            var registry = new StationVisibilityRegistry();
            try {
                StationScenePicker.Reset();
                probeWorld = BuildProbeWorld(EnvelopeJson(cells, modules, name: "grade-over-underground"),
                    "grade-over-underground", out probeRoot,
                    new StationCellRenderer(),
                    new StationSurfaceModuleRenderer(),
                    new StationEquipmentModuleRenderer());

                registry.State.ActiveLevel = 0;
                registry.State.ShowLevels = true;
                registry.State.HideGround = false;
                StationViewFeature.RegisterWorld(registry, probeWorld);

                // Find a ray straight down that strikes `ug-bench` when -10 m is active.
                registry.State.ActiveLevel = -10;
                registry.Apply();

                var gradeCellRecord = probeWorld.Records.First(r =>
                    r.Role == StationCellRenderer.RoleName && r.View != null &&
                    r.View.transform.parent != null && r.View.transform.parent.name == "Ground");
                var gradeMeshRenderer = gradeCellRecord.View.GetComponent<MeshRenderer>();
                Assert.IsNotNull(gradeMeshRenderer);
                Assert.IsTrue(gradeCellRecord.View.activeInHierarchy,
                    "grade GameObject stays active while visibility disables its MeshRenderer");
                Assert.IsFalse(gradeMeshRenderer.enabled,
                    "at -10 m the grade cell renderer is disabled by StationVisibilityRegistry");

                Ray benchRay = default;
                StationSceneHit ugBenchHit = null;
                foreach (var ox in new[] { 0.5, 0.4, 0.6, 0.35, 0.65 }) {
                    foreach (var oy in new[] { 0.5, 0.4, 0.6 }) {
                        var ray = DownAt(2 + ox, 2 + oy, 30);
                        var candidate = StationScenePicker.PickRay(probeWorld, ray, -10, registry);
                        if (candidate.TargetKind == StationSceneTargetKind.Module && candidate.Module.Id == "ug-bench") {
                            benchRay = ray;
                            ugBenchHit = candidate;
                            break;
                        }
                    }
                    if (ugBenchHit != null) break;
                }
                Assert.IsNotNull(ugBenchHit, "fixed ray must hit ug-bench at -10 m through the disabled 0 m grade");
                Assert.AreEqual("ug-bench", ugBenchHit.Module.Id);
                Assert.AreEqual(-10, ugBenchHit.Module.Z);

                var floorRay = DownAt(0.5, 0.5, 30);
                var ugFloorHit = StationScenePicker.PickRay(probeWorld, floorRay, -10, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, ugFloorHit.TargetKind,
                    "disabled 0 m grade slab contributes neither hit nor occlusion over the -10 m floor");
                Assert.AreEqual(new StationCellKey(0, 0, -10), ugFloorHit.CellKey);
                Assert.AreEqual(StationFace.Top, ugFloorHit.CellFace);
                Assert.AreEqual(1.0, ugFloorHit.CellNormal.Z, 1e-4);
                Assert.AreEqual(-9.0, ugFloorHit.Point.Z, 1e-3);

                var emptyRay = DownAt(40.5, 40.5, 30);
                var emptyHit = StationScenePicker.PickRay(probeWorld, emptyRay, -10, registry);
                Assert.IsFalse(emptyHit.HasCell, "an empty ray never claims a cell");
                Assert.IsFalse(emptyHit.HasModule);
                Assert.IsTrue(emptyHit.HasWorkPlane);
                Assert.AreEqual(StationSceneTargetKind.Plane, emptyHit.TargetKind);
                Assert.AreEqual(-10, emptyHit.WorkPlane.Z);

                // Restore 0 m active level: the visible 0 m slab and sidewalk win over -10 m.
                registry.State.ActiveLevel = 0;
                registry.State.HideGround = false;
                registry.State.ShowLevels = true;
                registry.Apply();
                Assert.IsTrue(gradeMeshRenderer.enabled, "grade renderer re-enables at 0 m");

                var gradeBenchRayHit = StationScenePicker.PickRay(probeWorld, benchRay, 0, registry);
                Assert.AreEqual(StationSceneTargetKind.Module, gradeBenchRayHit.TargetKind);
                Assert.AreEqual("grade-walk-1", gradeBenchRayHit.Module.Id,
                    "visible 0 m sidewalk tile occludes the underground bench beneath it");

                var gradeFloorRayHit = StationScenePicker.PickRay(probeWorld, floorRay, 0, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, gradeFloorRayHit.TargetKind);
                Assert.AreEqual(new StationCellKey(0, 0, 0), gradeFloorRayHit.CellKey,
                    "visible 0 m solid slab wins when restored");

                // At 0 m with HideGround = true and ShowLevels = true: grade hides, -10 m ghosts and stays hittable.
                registry.State.HideGround = true;
                registry.State.ShowLevels = true;
                registry.Apply();
                Assert.IsTrue(gradeCellRecord.View.activeInHierarchy);
                Assert.IsFalse(gradeMeshRenderer.enabled);

                var ghostBenchHit = StationScenePicker.PickRay(probeWorld, benchRay, 0, registry);
                Assert.AreEqual(StationSceneTargetKind.Module, ghostBenchHit.TargetKind);
                Assert.AreEqual("ug-bench", ghostBenchHit.Module.Id,
                    "with Hide Ground on and Show Other Levels on, the ghosted -10 m bench is hittable");

                var ghostFloorHit = StationScenePicker.PickRay(probeWorld, floorRay, 0, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, ghostFloorHit.TargetKind);
                Assert.AreEqual(new StationCellKey(0, 0, -10), ghostFloorHit.CellKey,
                    "ghosted -10 m floor is hittable when Hide Ground removes the 0 m slab");

                // Turn ShowLevels off while HideGround stays on at 0 m: -10 m hides too -> only work plane remains.
                registry.State.ShowLevels = false;
                registry.Apply();
                var allHiddenHit = StationScenePicker.PickRay(probeWorld, benchRay, 0, registry);
                Assert.IsFalse(allHiddenHit.HasCell);
                Assert.IsFalse(allHiddenHit.HasModule);
                Assert.AreEqual(StationSceneTargetKind.Plane, allHiddenHit.TargetKind);

                // Repeat transition back to 0 m visible without calling StationScenePicker.Reset() to catch stale caches.
                registry.State.HideGround = false;
                registry.State.ShowLevels = true;
                registry.Apply();
                var restoredAgain = StationScenePicker.PickRay(probeWorld, floorRay, 0, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, restoredAgain.TargetKind);
                Assert.AreEqual(new StationCellKey(0, 0, 0), restoredAgain.CellKey);
            } finally {
                StationScenePicker.Reset();
                registry.Dispose();
                probeWorld?.Dispose();
                if (probeRoot != null) UnityEngine.Object.DestroyImmediate(probeRoot);
            }
        }

        [Test]
        public void ShiftedLevelBaseAndOverriddenStoreyHeightMatchWebStoreyBandAndSlicePicking() {
            // Web `sim/constants.ts:storeyBand(z, base, _height)`:
            // `Math.floor((z - normalizeLevelBase(base)) / 5) * 5 + normalizeLevelBase(base)`, clamped to [-40+base, 30+base].
            var grid = StationLevelGrid.FromDocument(levelBase: 2, storeyHeight: 6);
            Assert.AreEqual(2, grid.LevelBase);
            Assert.AreEqual(6, grid.StoreyHeight);
            foreach (int z in new[] { -45, -10, -8, -4, -3, 1, 2, 6, 7, 8, 12, 35 }) {
                int webBand = Math.Max(-40 + 2, Math.Min(30 + 2,
                    (int)Math.Floor((z - 2.0) / 5.0) * 5 + 2));
                Assert.AreEqual(webBand, StationModuleLevels.Band(grid, z),
                    "StationModuleLevels.Band must match Web storeyBand at z=" + z);
            }

            // Build a world with levelBase=2, storeyHeight=6:
            // upper floor at z=8 (band 7), lower floor at z=-8 (band -8), plus a 12 m pillar from -8 (bands -8, -3).
            var cells = new JArray();
            AddSolidSlab(cells, 0, 0, 4, 4, 8, "floor.stone");
            AddSolidSlab(cells, 0, 0, 4, 4, -8, "floor.concrete");
            var modules = new JArray {
                new JObject {
                    ["id"] = "upper-bench", ["type"] = "bench", ["x"] = 1, ["y"] = 1, ["z"] = 8, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "steel-1" },
                },
                new JObject {
                    ["id"] = "lower-bench", ["type"] = "bench", ["x"] = 1, ["y"] = 1, ["z"] = -8, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "steel-1" },
                },
                new JObject {
                    ["id"] = "tall-pillar", ["type"] = "pillar", ["x"] = 3, ["y"] = 3, ["z"] = -8, ["rot"] = 0,
                    ["cfg"] = new JObject { ["height"] = 12 },
                },
            };

            GameObject probeRoot = null;
            StationWorldView probeWorld = null;
            var registry = new StationVisibilityRegistry();
            try {
                StationScenePicker.Reset();
                probeWorld = BuildProbeWorld(EnvelopeJson(cells, modules, levelBase: 2, storeyHeight: 6, name: "shifted-grid"),
                    "shifted-grid", out probeRoot,
                    new StationCellRenderer(),
                    new StationEquipmentModuleRenderer(),
                    new StationStructureModuleRenderer());

                var pillarRecord = probeWorld.Document.Modules.First(m => m.Id == "tall-pillar");
                CollectionAssert.AreEqual(new[] { -8, -3 }, StationModuleLevels.Of(pillarRecord, grid),
                    "pillar steps by storeyHeight=6 (-8, -2) and maps each step through Web storeyBand (-8, -3)");

                foreach (var cellRec in probeWorld.Records.Where(r => r.Role == StationCellRenderer.RoleName)) {
                    Assert.IsNotNull(cellRec.LevelBands, "cell group must register explicit mesher storey band");
                    Assert.AreEqual(1, cellRec.LevelBands.Length);
                    CollectionAssert.Contains(new[] { -8, -3, 7 }, cellRec.LevelBands[0]);
                }

                registry.State.ActiveLevel = -8;
                registry.State.HideGround = true;
                registry.State.ShowLevels = true;
                StationViewFeature.RegisterWorld(registry, probeWorld);

                var lowerFloor = StationScenePicker.PickRay(probeWorld, DownAt(0.5, 0.5, 30), -8, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, lowerFloor.TargetKind);
                Assert.AreEqual(new StationCellKey(0, 0, -8), lowerFloor.CellKey,
                    "upper z=8 slab (band 7) hides when band -8 is active");

                registry.State.ActiveLevel = 7;
                registry.Apply();
                var upperFloor = StationScenePicker.PickRay(probeWorld, DownAt(0.5, 0.5, 30), 7, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, upperFloor.TargetKind);
                Assert.AreEqual(new StationCellKey(0, 0, 8), upperFloor.CellKey,
                    "upper z=8 slab wins when band 7 is active");
            } finally {
                StationScenePicker.Reset();
                registry.Dispose();
                probeWorld?.Dispose();
                if (probeRoot != null) UnityEngine.Object.DestroyImmediate(probeRoot);
            }
        }

        [Test]
        public void InitialLoadEditRebuildAndUndoKeepViewSliceWithoutRetoggling() {
            var cells = new JArray();
            AddSolidSlab(cells, 0, 0, 6, 6, 0, "floor.stone");
            AddSolidSlab(cells, 0, 0, 6, 6, -10, "floor.concrete");
            var modules = new JArray {
                new JObject { ["id"] = "grade-walk", ["type"] = "sidewalk", ["x"] = 2, ["y"] = 2, ["z"] = 0, ["rot"] = 0 },
                new JObject {
                    ["id"] = "ug-bench", ["type"] = "bench", ["x"] = 2, ["y"] = 2, ["z"] = -10, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "steel-1" },
                },
            };

            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            var hostObject = new GameObject(StationGameHost.ObjectName);
            var cameraObject = new GameObject("HostPickCamera");
            try {
                var camera = cameraObject.AddComponent<Camera>();
                camera.orthographic = true;
                camera.orthographicSize = 8f;
                camera.nearClipPlane = 0.5f;
                camera.farClipPlane = 200f;

                var host = hostObject.AddComponent<StationGameHost>();
                host.catalogue = catalogue;
                host.trainCatalogue = trains;
                host.stationShader = FindShader();
                host.stationCamera = camera;
                host.frameCameraOnCommit = false;

                var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
                Assert.IsNotNull(awake);
                awake.Invoke(host, null);
                host.Coordinator.RegisterRenderer(new StationCellRenderer());
                host.Coordinator.RegisterRenderer(new StationSurfaceModuleRenderer());
                host.Coordinator.RegisterRenderer(new StationEquipmentModuleRenderer());

                var rig = StationViewFeature.Attach(host);
                StationEditFeature.Attach(host);

                var opened = host.OpenDocument(EnvelopeJson(cells, modules, name: "host-lifecycle"), "file");
                Assert.IsTrue(opened.Accepted, opened.ToString());
                Assert.AreEqual(-10, rig.Visibility.State.ActiveLevel, "station opens on its lowest built storey (-10 m)");

                // Aim an orthographic top-down camera straight over the station so ScreenPointToRay is exact.
                camera.orthographic = true;
                camera.orthographicSize = 6f;
                camera.transform.SetPositionAndRotation(
                    StationCoordinates.Point(new Vector3(3f, 3f, 30f)),
                    Quaternion.LookRotation(Vector3.down, Vector3.forward));

                // 1. Initial pick right after OpenDocument WITHOUT sending any view command:
                var initialFloor = StationScenePicker.PickRay(host.Coordinator.World, DownAt(1.5, 1.5, 30),
                    rig.Visibility.State.ActiveLevel, rig.Visibility);
                Assert.AreEqual(StationSceneTargetKind.Cell, initialFloor.TargetKind);
                Assert.AreEqual(new StationCellKey(1, 1, -10), initialFloor.CellKey,
                    "initial load must apply visibility after RegisterWorld so 0 m grade never leaks");

                // 2. Place a bench at (4, 2, -10) through StationPointerRouter.Handle, causing a full world rebuild:
                Assert.IsTrue(StationToolSelection.TrySelect("module", out _, out _));
                StationToolSelection.ApplySettings(new JObject { ["moduleType"] = "bench-steel-1", ["rotation"] = 0 });
                var placeScreen = camera.WorldToScreenPoint(StationCoordinates.FloorTop(4, 2, -10));
                var placePayload = new JObject {
                    ["x"] = placeScreen.x,
                    ["y"] = Mathf.Max(1f, Screen.height) - placeScreen.y,
                    ["w"] = Mathf.Max(1f, Screen.width),
                    ["h"] = Mathf.Max(1f, Screen.height),
                    ["button"] = 0,
                    ["buttons"] = 1,
                    ["toolGeneration"] = StationToolSelection.Generation,
                    ["documentRevision"] = host.CurrentRevision,
                };
                int revBeforePlace = host.CurrentRevision;
                var placeReply = new JObject();
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", placePayload, placeReply,
                    out var placeCode, out var placeReason), placeCode + ": " + placeReason);
                Assert.AreEqual(revBeforePlace + 1, host.CurrentRevision, "placement committed at -10 m");
                string placedId = StationEditSession.SelectionKey;
                Assert.IsTrue(host.Index.TryGetModule(placedId, out var placed) && placed.Z == -10,
                    "placed bench must land on -10 m, not on hidden 0 m grade");

                // Immediately pick after edit rebuild WITHOUT retoggling any view control:
                var afterEditFloor = StationScenePicker.PickRay(host.Coordinator.World, DownAt(1.5, 1.5, 30),
                    rig.Visibility.State.ActiveLevel, rig.Visibility);
                Assert.AreEqual(StationSceneTargetKind.Cell, afterEditFloor.TargetKind);
                Assert.AreEqual(new StationCellKey(1, 1, -10), afterEditFloor.CellKey,
                    "edit rebuild must re-apply visibility to the newly built world");

                // 3. Undo the placement (rebuilding the world again) and pick immediately WITHOUT retoggling view:
                Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var undoCode), undoCode);
                Assert.IsNull(host.Index.GetModule(placedId), "undo removed placed bench");
                var afterUndoSpot = StationScenePicker.PickRay(host.Coordinator.World, DownAt(4.5, 2.5, 30),
                    rig.Visibility.State.ActiveLevel, rig.Visibility);
                Assert.AreEqual(StationSceneTargetKind.Cell, afterUndoSpot.TargetKind);
                Assert.AreEqual(new StationCellKey(4, 2, -10), afterUndoSpot.CellKey,
                    "undo rebuild keeps 0 m grade hidden without retoggling view");
            } finally {
                StationEditHost.ResetForTests();
                UnityEngine.Object.DestroyImmediate(cameraObject);
                UnityEngine.Object.DestroyImmediate(hostObject);
                StationEditSession.Reset();
                StationScenePicker.Reset();
                StationToolSelection.Reset();
                StationRenderers.Clear();
                StationCommandHandlers.Clear();
            }
        }

        /* ----------------------------- section clipping & visibility roles (§4.2) */

        [Test]
        public void SectionClippedFrontTrianglesYieldToKeptBackFacesInSameCellGroupModuleAndBatch() {
            // Two wall columns in the same chunk (0,0), storey 0, role Wall, finish wall.tile -> one cell group;
            // plus one sidewalk batch spanning y = 1..6 -> one combined batch mesh.
            var cells = new JArray();
            AddSolidSlab(cells, 0, 0, 8, 8, 0, "floor.concrete");
            for (int z = 1; z <= 2; z++) {
                cells.Add(new JObject {
                    ["x"] = 2, ["y"] = 6, ["z"] = z, ["fill"] = "solid",
                    ["tags"] = new JArray("wall"),
                    ["finish"] = FinishFaces("wall.tile"),
                });
                cells.Add(new JObject {
                    ["x"] = 2, ["y"] = 2, ["z"] = z, ["fill"] = "solid",
                    ["tags"] = new JArray("wall"),
                    ["finish"] = FinishFaces("wall.tile"),
                });
            }
            var modules = new JArray();
            for (int y = 1; y <= 6; y++) {
                modules.Add(new JObject {
                    ["id"] = "walk-y" + y, ["type"] = "sidewalk", ["x"] = 5, ["y"] = y, ["z"] = 0, ["rot"] = 0,
                });
            }
            modules.Add(new JObject {
                ["id"] = "two-plate-sign", ["type"] = "calligraphy", ["x"] = 6, ["y"] = 1, ["z"] = 1,
                ["rot"] = 0, ["w"] = 1, ["panelH"] = 1, ["cfg"] = new JObject { ["style"] = "wei", ["axis"] = "h" },
            });

            GameObject probeRoot = null;
            StationWorldView probeWorld = null;
            Mesh twoPlateMesh = null;
            Material twoPlateMat = null;
            var registry = new StationVisibilityRegistry();
            try {
                StationScenePicker.Reset();
                probeWorld = BuildProbeWorld(EnvelopeJson(cells, modules, name: "section-cut-same-group"),
                    "section-cut-same-group", out probeRoot,
                    new StationCellRenderer(),
                    new StationSurfaceModuleRenderer());

                // Build a single MeshFilter/MeshRenderer for `two-plate-sign` with TWO front-facing (+Y) quads:
                // front quad at doc y = 6.5 (clipped when y > 4 is cut) and back quad at doc y = 2.5 (kept).
                var holder = new GameObject("two-plate-holder");
                holder.transform.SetParent(probeRoot.transform, false);
                var mf = holder.AddComponent<MeshFilter>();
                var mr = holder.AddComponent<MeshRenderer>();
                twoPlateMat = new Material(FindShader());
                mr.sharedMaterial = twoPlateMat;
                twoPlateMesh = new Mesh { name = "TwoPlateProbe" };
                // In Unity world (x = docX, y = docZ, z = docY), a ray along doc -Y travels along world -Z,
                // so quads facing +Z have outward normal along doc +Y (`Cross(e1, e2)` = (0, 0, +1) when v0,v1,v2 = (0,0),(0,1),(1,1) -> Cross((0,1,0),(1,1,0)) = (0,0,-1); reverse v1/v2 for +Z!).
                twoPlateMesh.vertices = new[] {
                    StationCoordinates.Point(new Vector3(6f, 6.5f, 1f)),
                    StationCoordinates.Point(new Vector3(7f, 6.5f, 1f)),
                    StationCoordinates.Point(new Vector3(7f, 6.5f, 2f)),
                    StationCoordinates.Point(new Vector3(6f, 6.5f, 2f)),
                    StationCoordinates.Point(new Vector3(6f, 2.5f, 1f)),
                    StationCoordinates.Point(new Vector3(7f, 2.5f, 1f)),
                    StationCoordinates.Point(new Vector3(7f, 2.5f, 2f)),
                    StationCoordinates.Point(new Vector3(6f, 2.5f, 2f)),
                };
                twoPlateMesh.triangles = new[] {
                    0, 1, 2, 0, 2, 3,
                    4, 5, 6, 4, 6, 7,
                };
                twoPlateMesh.RecalculateNormals();
                twoPlateMesh.RecalculateBounds();
                mf.sharedMesh = twoPlateMesh;
                probeWorld.RegisterModule("displays", "two-plate-sign", holder, "board",
                    new StationBox(6, 2, 1, 7, 7, 2), 0, 0);
                StationScenePicker.Reset();

                // Verify both walls sit inside the SAME StationCellGroupView.
                Assert.IsTrue(StationCellRenderer.TryGetView(probeWorld, out var cellView));
                var wallGroups = cellView.Groups.Where(g => g.Role == StationSurfaceRole.Wall).ToArray();
                Assert.AreEqual(1, wallGroups.Length, "both wall columns belong to the same cell group");

                // Uncut baseline: horizontal rays from y = 9 along -Y hit the front wall (y=7) and front plate (y=6.5).
                registry.State.ActiveLevel = 0;
                registry.State.ShowLevels = true;
                StationViewFeature.RegisterWorld(registry, probeWorld);

                var wallRay = DocRay(new Vector3(2.5f, 9f, 2.5f), new Vector3(0f, -1f, 0f));
                var uncutWall = StationScenePicker.PickRay(probeWorld, wallRay, 0, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, uncutWall.TargetKind);
                Assert.AreEqual(new StationCellKey(2, 6, 2), uncutWall.CellKey, "uncut ray hits front wall at y=6..7");
                Assert.AreEqual(2f, uncutWall.CellDistance, 0.02f);

                var plateRay = DocRay(new Vector3(6.5f, 9f, 1.5f), new Vector3(0f, -1f, 0f));
                var uncutPlate = StationScenePicker.PickRay(probeWorld, plateRay, 0, registry);
                Assert.AreEqual(StationSceneTargetKind.Module, uncutPlate.TargetKind);
                Assert.AreEqual("two-plate-sign", uncutPlate.Module.Id);
                Assert.AreEqual(2.5f, uncutPlate.ModuleDistance, 0.02f);
                Assert.AreEqual(6.5, uncutPlate.ModulePoint.Y, 0.02);

                // Enable section cut at y = 4 with Azimuth = 0 (Normal = +Y -> keeps y <= 4, clips y > 4).
                registry.Section = new StationSectionPlane { Anchor = new Vector3(4f, 4f, 0f), Azimuth = 0f, Offset = 0f };
                registry.SectionClipping = true;
                registry.State.Cutaway = true;
                registry.Apply();

                // 1. Same cell group: front wall at y=6..7 is clipped; kept back wall at y=2..3 (face y=3) wins!
                var cutWall = StationScenePicker.PickRay(probeWorld, wallRay, 0, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, cutWall.TargetKind);
                Assert.AreEqual(new StationCellKey(2, 2, 2), cutWall.CellKey,
                    "clipped front triangle in the same cell group must not block the kept back wall");
                Assert.AreEqual(6f, cutWall.CellDistance, 0.02f);
                Assert.AreEqual(3.0, cutWall.Point.Y, 0.02);
                Assert.AreEqual(1.0, cutWall.CellNormal.Y, 0.02);

                // 2. Same module mesh: front quad at y=6.5 is clipped; kept back quad at y=2.5 wins!
                var cutPlate = StationScenePicker.PickRay(probeWorld, plateRay, 0, registry);
                Assert.AreEqual(StationSceneTargetKind.Module, cutPlate.TargetKind);
                Assert.AreEqual("two-plate-sign", cutPlate.Module.Id);
                Assert.AreEqual(6.5f, cutPlate.ModuleDistance, 0.02f);
                Assert.AreEqual(2.5, cutPlate.ModulePoint.Y, 0.02);
                Assert.AreEqual(1.0, cutPlate.ModuleNormal.Y, 0.02);

                // 3. Combined surface batch: straddling batch stays enabled; clipped tile (y=5) misses, kept tile (y=2) wins!
                var batchRecord = probeWorld.Records.Single(r => r.Role == "surfaces" && r.Part == "batch");
                Assert.IsTrue(batchRecord.View.GetComponent<MeshRenderer>().enabled,
                    "straddling surface batch stays enabled while shader clips y > 4");

                var clippedTileHit = StationScenePicker.PickRay(probeWorld, DownAt(5.5, 5.5, 20), 0, registry);
                Assert.IsFalse(clippedTileHit.HasModule, "section-clipped tile in combined batch must not claim pick");
                Assert.IsFalse(clippedTileHit.HasCell, "floor beneath clipped tile is also clipped by section");
                Assert.IsFalse(clippedTileHit.HasWorkPlane, "work plane at clipped point is also rejected");
                Assert.AreEqual(StationSceneTargetKind.None, clippedTileHit.TargetKind);

                var keptTileHit = StationScenePicker.PickRay(probeWorld, DownAt(5.5, 2.5, 20), 0, registry);
                Assert.AreEqual(StationSceneTargetKind.Module, keptTileHit.TargetKind);
                Assert.AreEqual("walk-y2", keptTileHit.Module.Id, "kept tile in the same combined batch resolves its authored id");
            } finally {
                StationScenePicker.Reset();
                registry.Dispose();
                if (twoPlateMesh != null) UnityEngine.Object.DestroyImmediate(twoPlateMesh);
                if (twoPlateMat != null) UnityEngine.Object.DestroyImmediate(twoPlateMat);
                probeWorld?.Dispose();
                if (probeRoot != null) UnityEngine.Object.DestroyImmediate(probeRoot);
            }
        }

        [Test]
        public void HiddenRoofHiddenCeilingClearWallAndSectionHiddenWallFollowRenderedState() {
            var cells = new JArray();
            AddSolidSlab(cells, 0, 0, 6, 6, -5, "floor.concrete");
            // Suspended ceiling course at z = -1 above floor z = -5 (emitted under Role = Ceiling).
            for (int x = 0; x < 6; x++) {
                for (int y = 0; y < 6; y++) {
                    cells.Add(new JObject {
                        ["x"] = x, ["y"] = y, ["z"] = -1, ["fill"] = "solid",
                        ["tags"] = new JArray("suspended-ceiling"),
                    });
                }
            }
            // Wall course at y = 4, z = -4..-3 in front of a bench at (2, 2, -5).
            for (int z = -4; z <= -3; z++) {
                cells.Add(new JObject {
                    ["x"] = 2, ["y"] = 4, ["z"] = z, ["fill"] = "solid",
                    ["tags"] = new JArray("wall"),
                    ["finish"] = FinishFaces("wall.tile"),
                });
            }
            var modules = new JArray {
                new JObject {
                    ["id"] = "canopy-roof", ["type"] = "roof", ["x"] = 1, ["y"] = 1, ["z"] = -5, ["rot"] = 0,
                    ["w"] = 3, ["d"] = 3, ["cfg"] = new JObject { ["style"] = "canopy" },
                },
                new JObject {
                    ["id"] = "room-bench", ["type"] = "bench", ["x"] = 2, ["y"] = 2, ["z"] = -5, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "steel-1" },
                },
            };

            GameObject probeRoot = null;
            StationWorldView probeWorld = null;
            var registry = new StationVisibilityRegistry();
            try {
                StationScenePicker.Reset();
                probeWorld = BuildProbeWorld(EnvelopeJson(cells, modules, name: "roof-ceiling-wall"),
                    "roof-ceiling-wall", out probeRoot,
                    new StationCellRenderer(),
                    new StationEquipmentModuleRenderer(),
                    new StationStructureModuleRenderer());

                registry.State.ActiveLevel = -5;
                registry.State.HideGround = true;
                registry.State.AutoCeiling = false;
                registry.State.HideRoof = false;
                registry.State.HideWalls = false;
                registry.State.Cutaway = false;
                StationViewFeature.RegisterWorld(registry, probeWorld);

                // 1. Ceiling visible vs AutoCeiling (Hide Ceiling) enabled:
                var downThroughCeiling = DownAt(0.5, 0.5, 20);
                var ceilingVisible = StationScenePicker.PickRay(probeWorld, downThroughCeiling, -5, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, ceilingVisible.TargetKind);
                Assert.AreEqual(-1, ceilingVisible.CellKey.Z, "visible ceiling slab takes the pick");

                registry.State.AutoCeiling = true;
                registry.Apply();
                var ceilingHidden = StationScenePicker.PickRay(probeWorld, downThroughCeiling, -5, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, ceilingHidden.TargetKind);
                Assert.AreEqual(new StationCellKey(0, 0, -5), ceilingHidden.CellKey,
                    "hidden ceiling is skipped so the -5 m floor below wins");

                // 2. Roof visible vs HideRoof enabled (with ceiling hidden):
                var downThroughRoof = DownAt(1.5, 1.5, 20);
                var roofVisible = StationScenePicker.PickRay(probeWorld, downThroughRoof, -5, registry);
                Assert.AreEqual(StationSceneTargetKind.Module, roofVisible.TargetKind);
                Assert.AreEqual("canopy-roof", roofVisible.Module.Id, "visible roof canopy takes the pick");

                registry.State.HideRoof = true;
                registry.Apply();
                var roofHidden = StationScenePicker.PickRay(probeWorld, downThroughRoof, -5, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, roofHidden.TargetKind);
                Assert.AreEqual(new StationCellKey(1, 1, -5), roofHidden.CellKey,
                    "hidden roof is skipped so the floor underneath wins");

                // 3. Solid wall vs translucent Clear wall vs section-hidden wall in front of `room-bench`:
                // Find horizontal ray from +Y toward -Y that hits `room-bench` when the wall is hidden.
                registry.State.HideWalls = true;
                registry.State.Cutaway = true;
                registry.SectionClipping = false;
                registry.Apply();

                Ray wallToBenchRay = default;
                StationSceneHit sectionHiddenWallHit = null;
                foreach (var ox in new[] { 0.5f, 0.4f, 0.6f }) {
                    foreach (var oz in new[] { -3.8f, -3.6f, -3.9f, -3.5f }) {
                        var ray = DocRay(new Vector3(2f + ox, 7f, oz), new Vector3(0f, -1f, 0f));
                        var candidate = StationScenePicker.PickRay(probeWorld, ray, -5, registry);
                        if (candidate.TargetKind == StationSceneTargetKind.Module && candidate.Module.Id == "room-bench") {
                            wallToBenchRay = ray;
                            sectionHiddenWallHit = candidate;
                            break;
                        }
                    }
                    if (sectionHiddenWallHit != null) break;
                }
                Assert.IsNotNull(sectionHiddenWallHit, "with HideWalls + Cutaway, wall renderer disables and room-bench wins");

                // Turn Cutaway off while keeping HideWalls = true -> wall becomes translucent Clear (enabled & hittable):
                registry.State.Cutaway = false;
                registry.State.HideWalls = true;
                registry.Apply();
                var clearWallHit = StationScenePicker.PickRay(probeWorld, wallToBenchRay, -5, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, clearWallHit.TargetKind,
                    "translucent Clear wall stays drawn and hittable, matching Web visible-mesh policy");
                Assert.AreEqual(4, clearWallHit.CellKey.Y);

                // Also verify RequestFor does NOT leak `room-bench` as TargetModuleId through the nearer wall:
                var wallBlockedReq = StationPointerRouter.BuildRequest(probeWorld, wallToBenchRay,
                    StationPickContext.Default(registry), clearWallHit, null, 0, "bench-steel-1", "", 0, "", 4);
                Assert.AreEqual("", wallBlockedReq.TargetModuleId,
                    "a nearer wall cell must prevent an occluded module behind it from leaking into TargetModuleId");
                Assert.IsFalse(wallBlockedReq.ModulePoint.HasValue);
            } finally {
                StationScenePicker.Reset();
                registry.Dispose();
                probeWorld?.Dispose();
                if (probeRoot != null) UnityEngine.Object.DestroyImmediate(probeRoot);
            }
        }

        [Test]
        public void CameraCullingMaskAndFrustumClipPlanesFilterBothCellsAndModules() {
            var cells = new JArray();
            AddSolidSlab(cells, 0, 0, 4, 4, -10, "floor.concrete");
            var modules = new JArray {
                new JObject { ["id"] = "near-board", ["type"] = "billboard", ["x"] = 1, ["y"] = 1, ["z"] = 8, ["rot"] = 0, ["w"] = 1 },
                new JObject { ["id"] = "mid-board", ["type"] = "billboard", ["x"] = 1, ["y"] = 1, ["z"] = 4, ["rot"] = 0, ["w"] = 1 },
                new JObject { ["id"] = "far-board", ["type"] = "billboard", ["x"] = 1, ["y"] = 1, ["z"] = -15, ["rot"] = 0, ["w"] = 1 },
            };

            GameObject probeRoot = null;
            StationWorldView probeWorld = null;
            var camObj = new GameObject("ClipFilterCamera");
            try {
                StationScenePicker.Reset();
                probeWorld = BuildProbeWorld(EnvelopeJson(cells, modules, name: "camera-clip-mask"),
                    "camera-clip-mask", out probeRoot,
                    new StationCellRenderer());

                GameObject MakePlate(string id, float docZ, int layer) {
                    var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
                    go.layer = layer;
                    go.transform.SetParent(probeRoot.transform, false);
                    go.transform.position = StationCoordinates.Point(new Vector3(1.5f, 1.5f, docZ));
                    go.transform.localScale = new Vector3(1f, 0.1f, 1f);
                    probeWorld.RegisterModule("displays", id, go, "board",
                        new StationBox(1, 1, docZ - 0.1, 2, 2, docZ + 0.1), 0, 0);
                    return go;
                }

                // Camera at doc (1.5, 1.5, 25) looking straight down (-Z in doc / -Y in world):
                // near-board at z=24 (dist 1 < near=2), mid-board at z=20 (dist 5 in [2, 12]),
                // virtual ground at z=0 (dist 24 > far=12), cell floor at z=-9 (dist 34 > far=12),
                // far-board at z=-15 (dist 40 > far=12).
                MakePlate("near-board", 24f, 0);
                var midGo = MakePlate("mid-board", 20f, 8);
                MakePlate("far-board", -15f, 0);
                StationScenePicker.Reset();

                var cam = camObj.AddComponent<Camera>();
                cam.orthographic = false;
                cam.fieldOfView = 45f;
                cam.nearClipPlane = 2f;
                cam.farClipPlane = 12f;
                cam.transform.SetPositionAndRotation(
                    StationCoordinates.Point(new Vector3(1.5f, 1.5f, 25f)),
                    Quaternion.LookRotation(Vector3.down, Vector3.forward));

                var screenCenter = new Vector2(Mathf.Max(1f, Screen.width) * 0.5f, Mathf.Max(1f, Screen.height) * 0.5f);

                // With layer 8 included (~0): near-board (< nearClipPlane) and cells/far-board (> farClipPlane) are excluded; mid-board wins!
                cam.cullingMask = ~0;
                var hitIncluded = StationScenePicker.Pick(probeWorld, cam, screenCenter, 0, visibility: null, evaluateWorkPlane: false);
                Assert.AreEqual(StationSceneTargetKind.Module, hitIncluded.TargetKind);
                Assert.AreEqual("mid-board", hitIncluded.Module.Id, "near (<2m) and far (>12m) surfaces must be clipped");

                // Exclude layer 8 from camera cullingMask: mid-board is culled, and virtual ground + cells + far-board are beyond farClipPlane -> None!
                cam.cullingMask = ~(1 << 8);
                var hitMasked = StationScenePicker.Pick(probeWorld, cam, screenCenter, 0, visibility: null, evaluateWorkPlane: false);
                Assert.AreEqual(StationSceneTargetKind.None, hitMasked.TargetKind,
                    "layer excluded from camera.cullingMask and cell beyond farClipPlane must both be skipped");

                // Extend farClipPlane to 28 m in orthographic mode while keeping layer 8 masked:
                // now the z=0 ground cell at dist 24 m is inside [2, 28], while -10 m cell (34 m) and far-board (40 m) stay clipped!
                cam.orthographic = true;
                cam.orthographicSize = 5f;
                cam.farClipPlane = 28f;
                var hitOrthoCell = StationScenePicker.Pick(probeWorld, cam, screenCenter, 0, visibility: null, evaluateWorkPlane: false);
                Assert.AreEqual(StationSceneTargetKind.Cell, hitOrthoCell.TargetKind);
                Assert.AreEqual(new StationCellKey(1, 1, 0), hitOrthoCell.CellKey);
                _ = midGo;
            } finally {
                StationScenePicker.Reset();
                UnityEngine.Object.DestroyImmediate(camObj);
                probeWorld?.Dispose();
                if (probeRoot != null) UnityEngine.Object.DestroyImmediate(probeRoot);
            }
        }

        /* ---------------------- surface accuracy, ramps, ties & router (§2–§3, §4.2) */

        [Test]
        public void RotatedThinSignAndRampGapDistinguishExactTrianglesFromScopedExitBounds() {
            var cells = new JArray();
            AddSolidSlab(cells, 0, 0, 8, 8, -5, "floor.concrete");
            // Displaced half-wall at (6, 2, -4) (`half-wall:n` draws only y in [2.5, 3.0], so its south face sits inside cell (6,2,-4) at y=2.5).
            cells.Add(new JObject {
                ["x"] = 6, ["y"] = 2, ["z"] = -4, ["fill"] = "solid",
                ["tags"] = new JArray("wall", "half-wall:n"),
                ["finish"] = FinishFaces("wall.tile"),
            });
            var modules = new JArray {
                new JObject {
                    ["id"] = "diag-sign", ["type"] = "calligraphy", ["x"] = 2, ["y"] = 2, ["z"] = -5,
                    ["rot"] = 0, ["w"] = 3, ["panelH"] = 1, ["cfg"] = new JObject { ["style"] = "wei", ["axis"] = "h" },
                },
                new JObject {
                    ["id"] = "gap-stair", ["type"] = "stair", ["x"] = 4, ["y"] = 1, ["z"] = -5, ["rot"] = 0, ["w"] = 1,
                    ["from"] = new JObject { ["x"] = 4, ["y"] = 1, ["z"] = -5 },
                    ["to"] = new JObject { ["x"] = 4, ["y"] = 6, ["z"] = 0 },
                    ["cfg"] = new JObject { ["style"] = "straight" },
                },
            };

            GameObject probeRoot = null;
            StationWorldView probeWorld = null;
            var registry = new StationVisibilityRegistry();
            try {
                StationScenePicker.Reset();
                probeWorld = BuildProbeWorld(EnvelopeJson(cells, modules, name: "rotated-and-ramp"),
                    "rotated-and-ramp", out probeRoot,
                    new StationCellRenderer());

                // 1. Thin sign blade rotated 45 degrees about vertical: its world AABB spans ~2.15 x 2.15,
                //    but only the diagonal 4 cm blade contains triangles.
                var signGo = GameObject.CreatePrimitive(PrimitiveType.Cube);
                UnityEngine.Object.DestroyImmediate(signGo.GetComponent<Collider>());
                signGo.transform.SetParent(probeRoot.transform, false);
                signGo.transform.position = StationCoordinates.Point(new Vector3(2.5f, 2.5f, -2f));
                signGo.transform.rotation = Quaternion.Euler(0f, 45f, 0f);
                signGo.transform.localScale = new Vector3(3f, 0.8f, 0.04f);
                probeWorld.RegisterModule("signs", "diag-sign", signGo, "board",
                    new StationBox(1, 1, -3, 4, 4, -1), -5, -5);

                // 2. Straight stair proxy with TWO separated treads (y=1.5..2.5 and y=4.5..5.5), leaving an
                //    open gap at y=3.5 inside the stair's live renderer bounds!
                var stairHolder = new GameObject("gap-stair-holder");
                stairHolder.transform.SetParent(probeRoot.transform, false);
                var treadLo = GameObject.CreatePrimitive(PrimitiveType.Cube);
                UnityEngine.Object.DestroyImmediate(treadLo.GetComponent<Collider>());
                treadLo.transform.SetParent(stairHolder.transform, false);
                treadLo.transform.position = StationCoordinates.Point(new Vector3(4.5f, 2f, -3.5f));
                treadLo.transform.localScale = new Vector3(1f, 0.2f, 1f);
                var treadHi = GameObject.CreatePrimitive(PrimitiveType.Cube);
                UnityEngine.Object.DestroyImmediate(treadHi.GetComponent<Collider>());
                treadHi.transform.SetParent(stairHolder.transform, false);
                treadHi.transform.position = StationCoordinates.Point(new Vector3(4.5f, 5f, -0.5f));
                treadHi.transform.localScale = new Vector3(1f, 0.2f, 1f);
                probeWorld.RegisterModule("modules", "gap-stair", stairHolder, "run",
                    new StationBox(4, 1, -5, 5, 6, 1), -5, 0);

                StationScenePicker.Reset();
                registry.State.ActiveLevel = -5;
                registry.State.HideGround = true;
                registry.State.ShowLevels = true;
                StationViewFeature.RegisterWorld(registry, probeWorld);

                // Diagonal ray normal to the 45-degree blade hits its center with rotated normal:
                var onBladeRay = DocRay(new Vector3(2.5f + 1f, 2.5f + 1f, -2f), new Vector3(-1f, -1f, 0f));
                var onBlade = StationScenePicker.PickRay(probeWorld, onBladeRay, -5, registry);
                Assert.AreEqual(StationSceneTargetKind.Module, onBlade.TargetKind);
                Assert.AreEqual("diag-sign", onBlade.Module.Id);
                Assert.IsTrue(onBlade.ModuleExact);
                Assert.AreEqual(0.707, Math.Abs(onBlade.ModuleNormal.X), 0.05);
                Assert.AreEqual(0.707, Math.Abs(onBlade.ModuleNormal.Y), 0.05);

                // Vertical ray inside the rotated sign's AABB corner (x=3.3, y=3.3) misses the blade and hits the floor!
                var aabbCorner = StationScenePicker.PickRay(probeWorld, DownAt(3.3, 3.3, 10), -5, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, aabbCorner.TargetKind,
                    "empty corner of a rotated sign's world AABB must not claim the pick");
                Assert.AreEqual(new StationCellKey(3, 3, -5), aabbCorner.CellKey);

                // Displaced half-wall face inside cell (6, 2, -4) at y = 2.5 preserves authored CellKey (6, 2, -4)
                // while deriving placement neighbor (6, 1, -4) separately:
                var halfWallRay = DocRay(new Vector3(6.5f, 0.5f, -3.5f), new Vector3(0f, 1f, 0f));
                var halfWallHit = StationScenePicker.PickRay(probeWorld, halfWallRay, -5, registry);
                Assert.AreEqual(StationSceneTargetKind.Cell, halfWallHit.TargetKind);
                Assert.AreEqual(new StationCellKey(6, 2, -4), halfWallHit.CellKey,
                    "displaced thin/half-wall face keeps its authored cell key rather than rounding the hit point");
                Assert.AreEqual(2.5, halfWallHit.Point.Y, 0.02);
                Assert.AreEqual(1, halfWallHit.Cell.PlaceY, "placement neighbor steps one cell south along face normal");

                // Gap ray at (4.5, 3.5) passes cleanly between treads: Select/Delete sees the floor cell, NOT the stair!
                var gapRay = DownAt(4.5, 3.5, 10);
                var pickCtx = StationPickContext.Default(registry);
                var gapHit = StationScenePicker.PickRay(probeWorld, gapRay, -5, pickCtx);
                Assert.AreEqual(StationSceneTargetKind.Cell, gapHit.TargetKind,
                    "exact pick through a gap between stair treads hits the floor cell below");
                Assert.AreEqual(new StationCellKey(4, 3, -5), gapHit.CellKey);

                // Scoped bounds fallback: head-house `exit` placement snaps to `gap-stair`, while `bench` does NOT!
                var exitReq = StationPointerRouter.BuildRequest(probeWorld, gapRay, pickCtx, gapHit,
                    null, 0, "exit", "", 0, "", 4);
                Assert.AreEqual("gap-stair", exitReq.TargetModuleId,
                    "head-house exit tool uses scoped PickSnapRampInBounds across tread gaps");

                var benchReq = StationPointerRouter.BuildRequest(probeWorld, gapRay, pickCtx, gapHit,
                    null, 0, "bench-steel-1", "", 0, "", 4);
                Assert.AreEqual("", benchReq.TargetModuleId,
                    "ordinary tools never receive bounds-based ramp hits through gaps");

                // If a nearer cell surface sits above the ramp's bounds entry, PickSnapRampInBounds rejects the occluded ramp:
                var occludedFakeHit = new StationSceneHit {
                    Cell = StationPlacementHit.FromCellFace(4, 3, 5, 0, 0, 1, true, new StationPoint(4.5, 3.5, 6)),
                    CellKey = new StationCellKey(4, 3, 5),
                    CellDistance = 4f, // closer than stair bounds entry at z=-0.4 (distance ~10.4)
                    Level = -5,
                };
                Assert.IsNull(StationScenePicker.PickSnapRampInBounds(probeWorld, gapRay, pickCtx, occludedFakeHit),
                    "a nearer solid cell must block PickSnapRampInBounds");
            } finally {
                StationScenePicker.Reset();
                registry.Dispose();
                probeWorld?.Dispose();
                if (probeRoot != null) UnityEngine.Object.DestroyImmediate(probeRoot);
            }
        }

        [Test]
        public void CoincidentTieBreakingFavorsPropsAndRailsOverPavingWithoutForgivingTrueDepth() {
            var modules = new JArray {
                new JObject { ["id"] = "tile-1", ["type"] = "tactile", ["x"] = 1, ["y"] = 1, ["z"] = 0, ["rot"] = 0, ["cfg"] = new JObject { ["variant"] = "guide" } },
                new JObject { ["id"] = "rail-1", ["type"] = "track", ["x"] = 1, ["y"] = 1, ["z"] = 0, ["rot"] = 0 },
                new JObject { ["id"] = "canopy-1", ["type"] = "roof", ["x"] = 3, ["y"] = 1, ["z"] = 0, ["rot"] = 0, ["w"] = 1, ["d"] = 1 },
                new JObject { ["id"] = "bench-under-canopy", ["type"] = "bench", ["x"] = 3, ["y"] = 1, ["z"] = 0, ["rot"] = 0 },
                new JObject { ["id"] = "paving-over-prop", ["type"] = "sidewalk", ["x"] = 5, ["y"] = 1, ["z"] = 2, ["rot"] = 0 },
                new JObject { ["id"] = "buried-prop", ["type"] = "bench", ["x"] = 5, ["y"] = 1, ["z"] = 0, ["rot"] = 0 },
            };

            GameObject probeRoot = null;
            StationWorldView probeWorld = null;
            try {
                StationScenePicker.Reset();
                probeWorld = BuildProbeWorld(EnvelopeJson(new JArray(), modules, name: "tie-breaking"),
                    "tie-breaking", out probeRoot);

                void AddQuad(string role, string id, float x, float y, float zTop) {
                    var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
                    go.transform.SetParent(probeRoot.transform, false);
                    go.transform.position = StationCoordinates.Point(new Vector3(x + 0.5f, y + 0.5f, zTop - 0.01f));
                    go.transform.localScale = new Vector3(1f, 0.02f, 1f);
                    probeWorld.RegisterModule(role, id, go, "part",
                        new StationBox(x, y, zTop - 0.05, x + 1, y + 1, zTop + 0.05), 0, 0);
                }

                // 1. Coincident within 1 mm: rail-1 (non-surface) beats tile-1 (surface tile).
                AddQuad("surfaces", "tile-1", 1f, 1f, 1.001f);
                AddQuad("street", "rail-1", 1f, 1f, 1.000f);

                // 2. Canopy 3 m above bench: nearer canopy wins.
                AddQuad("structure", "canopy-1", 3f, 1f, 4.0f);
                AddQuad("equipment", "bench-under-canopy", 3f, 1f, 1.8f);

                // 3. Elevated sidewalk 1.5 m above a buried prop (previously lost to 2 m SurfaceForgivenessMetres):
                //    nearer sidewalk MUST win!
                AddQuad("surfaces", "paving-over-prop", 5f, 1f, 3.1f);
                AddQuad("equipment", "buried-prop", 5f, 1f, 1.6f);
                StationScenePicker.Reset();

                var tieHit = StationScenePicker.PickRay(probeWorld, DownAt(1.5, 1.5, 20), 0);
                Assert.AreEqual("rail-1", tieHit.Module.Id, "within CoincidentTieMetres, non-paving rail beats paving tile");

                var canopyHit = StationScenePicker.PickRay(probeWorld, DownAt(3.5, 1.5, 20), 0);
                Assert.AreEqual("canopy-1", canopyHit.Module.Id, "nearer canopy occludes bench below");

                var pavingHit = StationScenePicker.PickRay(probeWorld, DownAt(5.5, 1.5, 20), 0);
                Assert.AreEqual("paving-over-prop", pavingHit.Module.Id,
                    "elevated paving 1.5 m nearer than a prop wins without the old 2 m forgiveness");
            } finally {
                StationScenePicker.Reset();
                probeWorld?.Dispose();
                if (probeRoot != null) UnityEngine.Object.DestroyImmediate(probeRoot);
            }
        }

        [Test]
        public void RouterSelectMissCarriedBatchExclusionOutdoorAndHangerAnchorsAndPickBudget() {
            var cells = new JArray();
            AddSolidSlab(cells, 0, 0, 8, 8, -5, "floor.concrete");
            // Suspended ceiling at z = -1 so hangers and hung TVs have ceiling support above the -5 m room,
            // while `view.set { key: "ceiling", value: true }` hides it cleanly from top-down picks!
            for (int x = 0; x < 8; x++) {
                for (int y = 0; y < 8; y++) {
                    cells.Add(new JObject {
                        ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid",
                        ["tags"] = new JArray("suspended-ceiling"),
                        ["finish"] = FinishFaces("ceiling.panel"),
                    });
                }
            }
            var modules = new JArray {
                new JObject { ["id"] = "walk-host", ["type"] = "sidewalk", ["x"] = 1, ["y"] = 1, ["z"] = 0, ["rot"] = 0 },
                new JObject { ["id"] = "tac-1", ["type"] = "tactile", ["x"] = 3, ["y"] = 1, ["z"] = -5, ["rot"] = 0, ["cfg"] = new JObject { ["variant"] = "guide" } },
                new JObject { ["id"] = "tac-2", ["type"] = "tactile", ["x"] = 4, ["y"] = 1, ["z"] = -5, ["rot"] = 0, ["cfg"] = new JObject { ["variant"] = "guide" } },
                new JObject {
                    ["id"] = "hanger-bar", ["type"] = "hanger", ["x"] = 2, ["y"] = 5, ["z"] = -5, ["rot"] = 0, ["w"] = 2,
                },
            };

            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            var hostObject = new GameObject(StationGameHost.ObjectName);
            var cameraObject = new GameObject("RouterTestCamera");
            try {
                var camera = cameraObject.AddComponent<Camera>();
                camera.orthographic = true;
                camera.orthographicSize = 8f;
                camera.nearClipPlane = 0.5f;
                camera.farClipPlane = 200f;

                var host = hostObject.AddComponent<StationGameHost>();
                host.catalogue = catalogue;
                host.trainCatalogue = trains;
                host.stationShader = FindShader();
                host.stationCamera = camera;
                host.frameCameraOnCommit = false;

                var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
                awake.Invoke(host, null);
                host.Coordinator.RegisterRenderer(new StationCellRenderer());
                host.Coordinator.RegisterRenderer(new StationSurfaceModuleRenderer());
                host.Coordinator.RegisterRenderer(new StationEquipmentModuleRenderer());
                host.Coordinator.RegisterRenderer(new StationDisplayModuleRenderer());
                host.Coordinator.RegisterRenderer(new StationStructureModuleRenderer());

                var rig = StationViewFeature.Attach(host);
                StationEditFeature.Attach(host);

                var opened = host.OpenDocument(EnvelopeJson(cells, modules, name: "router-contracts"), "file");
                Assert.IsTrue(opened.Accepted, opened.ToString());
                Assert.AreEqual(-5, rig.Visibility.State.ActiveLevel, "station opens on -5 m indoor storey");

                // Hide ceiling and snap rig camera to top-down orthographic so `rig.Execute` keeps it top-down.
                Assert.IsTrue(rig.Execute(new JObject {
                    ["type"] = "view.set", ["payload"] = new JObject { ["key"] = "ceiling", ["value"] = true },
                }.ToString(Formatting.None), out var viewCode), viewCode);
                Assert.IsTrue(rig.Execute(new JObject {
                    ["type"] = "view.set", ["payload"] = new JObject { ["key"] = "ground", ["value"] = true },
                }.ToString(Formatting.None), out _));
                Assert.IsTrue(rig.Execute(new JObject {
                    ["type"] = "camera.snap", ["payload"] = new JObject { ["face"] = "top", ["ortho"] = true },
                }.ToString(Formatting.None), out var snapCode), snapCode);

                JObject PointerPayloadAtDoc(float docX, float docY, float docZ) {
                    var screen = camera.WorldToScreenPoint(StationCoordinates.Point(new Vector3(docX, docY, docZ)));
                    return new JObject {
                        ["x"] = screen.x,
                        ["y"] = Mathf.Max(1f, Screen.height) - screen.y,
                        ["w"] = Mathf.Max(1f, Screen.width),
                        ["h"] = Mathf.Max(1f, Screen.height),
                        ["button"] = 0,
                        ["buttons"] = 1,
                        ["toolGeneration"] = StationToolSelection.Generation,
                        ["documentRevision"] = host.CurrentRevision,
                    };
                }

                // 1. Select batched tactile tile `tac-1` (1 pick), then Select miss in empty space -> clears selection (1 pick)!
                Assert.IsTrue(StationToolSelection.TrySelect("select", out _, out _));
                int picks0 = StationScenePicker.PickCount;
                var selectReply = new JObject();
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", PointerPayloadAtDoc(3.5f, 1.5f, -4f),
                    selectReply, out _, out _));
                Assert.AreEqual(picks0 + 1, StationScenePicker.PickCount, "one scene pick per Select down");
                Assert.AreEqual("module", StationEditSession.SelectionKind);
                Assert.AreEqual("tac-1", StationEditSession.SelectionKey);

                var missReply = new JObject();
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", PointerPayloadAtDoc(-3f, -3f, -4f),
                    missReply, out _, out _));
                Assert.AreEqual(picks0 + 2, StationScenePicker.PickCount, "one scene pick on Select miss");
                Assert.AreEqual("", StationEditSession.SelectionKind, "Select miss must clear Unity selection");
                Assert.AreEqual("", StationEditSession.SelectionKey);
                Assert.AreEqual("none", (string)missReply["hit"]["targetKind"]);

                // pointer.up performs ZERO scene picks:
                int picksBeforeUp = StationScenePicker.PickCount;
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.up", PointerPayloadAtDoc(3.5f, 1.5f, -4f),
                    new JObject(), out _, out _));
                Assert.AreEqual(picksBeforeUp, StationScenePicker.PickCount, "pointer.up performs zero scene picks");

                // 2. Move pickup on batched `tac-1` defers preview until aim, and subsequent aim over (3.5, 1.5)
                //    excludes `tac-1` from the combined batch so it aims onto the underlying floor cell (3, 1, -5)!
                Assert.IsTrue(StationToolSelection.TrySelect("move", out _, out _));
                var pickupReply = new JObject();
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", PointerPayloadAtDoc(3.5f, 1.5f, -4f),
                    pickupReply, out _, out _));
                Assert.AreEqual("tac-1", StationEditSession.CarriedId);
                // Plan 27 §4: a lift shows its ghost at the source **immediately** — a piece that
                // vanishes until the next pointer move reads as a deletion. The preview is the
                // piece's own cell, and the next aim event moves it (asserted below).
                Assert.IsNotNull(StationEditSession.Plan, "a lift shows the source-cell ghost at once");
                Assert.IsTrue(StationEditSession.Plan.IsMove, "the plan is the carried piece");
                Assert.IsTrue(StationEditSession.Plan.Ok, StationEditSession.Plan.Reason);

                var aimReply = new JObject();
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.move", PointerPayloadAtDoc(3.5f, 1.5f, -4f),
                    aimReply, out _, out _));
                Assert.AreEqual("cell", (string)aimReply["hit"]["targetKind"],
                    "carried batched tile must be excluded during aim so the floor cell underneath wins: " + aimReply);
                Assert.IsNotNull(StationEditSession.Plan);
                Assert.IsTrue(StationEditSession.Plan.Ok, StationEditSession.Plan.Reason);
                StationPointerRouter.CancelMove(host, StationEditHost.Ensure());

                // 3.4: Hanger bar (`hanger-bar` anchored on z=-5 floor, crossbar at z=-1) anchors hung `tv` at z=-5 with support!
                var hangerRay = DownAt(2.5, 5.5, 10);
                var hangerHit = StationScenePicker.PickRay(host.Coordinator.World, hangerRay, -5, rig.Visibility);
                Assert.AreEqual(StationSceneTargetKind.Module, hangerHit.TargetKind);
                Assert.AreEqual("hanger-bar", hangerHit.Module.Id);
                var tvReq = StationPointerRouter.BuildRequest(host.Coordinator.World, hangerRay,
                    StationPickContext.Default(rig.Visibility), hangerHit, null, 0, "tv", "", 0, "", 4);
                var tvPlan = StationModulePlacement.Resolve(host.Index, tvReq);
                Assert.IsTrue(tvPlan.Ok, "hung tv on supported hanger must resolve ok, got: " + tvPlan.Reason);
                Assert.AreEqual(2, tvPlan.Candidate.X);
                Assert.AreEqual(5, tvPlan.Candidate.Y);
                Assert.AreEqual(-5, tvPlan.Candidate.Z, "hung tv inherits the hanger's z=-5 anchor");

                // 3.5: Step up to 0 m with ground shown: outdoor surface (`sidewalk` at z=0, top ~1.1) anchors equipment back onto host.Z = 0:
                Assert.IsTrue(rig.Execute(new JObject {
                    ["type"] = "view.set", ["payload"] = new JObject { ["key"] = "level", ["value"] = 0 },
                }.ToString(Formatting.None), out _));
                Assert.IsTrue(rig.Execute(new JObject {
                    ["type"] = "view.set", ["payload"] = new JObject { ["key"] = "ground", ["value"] = false },
                }.ToString(Formatting.None), out _));
                var walkHit = StationScenePicker.PickRay(host.Coordinator.World, DownAt(1.5, 1.5, 20), 0, rig.Visibility);
                Assert.AreEqual("walk-host", walkHit.Module?.Id);
                var walkReq = StationPointerRouter.BuildRequest(host.Coordinator.World, DownAt(1.5, 1.5, 20),
                    StationPickContext.Default(rig.Visibility), walkHit, null, 0, "bench-steel-1", "", 0, "", 4);
                var walkPlan = StationModulePlacement.Resolve(host.Index, walkReq);
                Assert.IsTrue(walkPlan.Ok, walkPlan.Reason);
                Assert.AreEqual(0, walkPlan.Candidate.Z, "bench aimed at 0 m sidewalk top anchors on z=0, not z=1");

                // 5. Section handle grab performs ZERO scene picks:
                Assert.IsTrue(rig.Execute(new JObject {
                    ["type"] = "view.set", ["payload"] = new JObject { ["key"] = "cutaway", ["value"] = true },
                }.ToString(Formatting.None), out _));
                rig.Tick(0f);
                camera.orthographic = false;
                camera.fieldOfView = 45f;
                var secPlanePoint = StationCameraSpace.ToWorld(rig.sectionView.Plane.Point);
                var secNormal = StationCameraSpace.ToWorld(rig.sectionView.Plane.Normal);
                var secRight = StationCameraSpace.ToWorld(rig.sectionView.Plane.Right);
                var secUp = StationCameraSpace.ToWorld(rig.sectionView.Plane.Up);
                var arrowShaft = secPlanePoint - secNormal * (rig.sectionView.ArrowLength * 0.3f);
                camera.transform.position = arrowShaft + secNormal * 12f + secRight * 12f + secUp * 8f;
                camera.transform.LookAt(arrowShaft);
                var arrowScreen = camera.WorldToScreenPoint(arrowShaft);
                var handleDown = new JObject {
                    ["x"] = arrowScreen.x,
                    ["y"] = Mathf.Max(1f, Screen.height) - arrowScreen.y,
                    ["w"] = Mathf.Max(1f, Screen.width),
                    ["h"] = Mathf.Max(1f, Screen.height),
                    ["pointerId"] = 9,
                    ["button"] = 0,
                    ["buttons"] = 1,
                };
                int picksBeforeHandle = StationScenePicker.PickCount;
                var handleReply = new JObject();
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", handleDown, handleReply, out _, out _));
                Assert.AreEqual(picksBeforeHandle, StationScenePicker.PickCount,
                    "a section handle grab that consumes pointer.down must perform zero scene picks");
                StationSectionDrag.Reset();
            } finally {
                StationSectionDrag.Reset();
                StationEditHost.ResetForTests();
                UnityEngine.Object.DestroyImmediate(cameraObject);
                UnityEngine.Object.DestroyImmediate(hostObject);
                StationEditSession.Reset();
                StationScenePicker.Reset();
                StationToolSelection.Reset();
                StationRenderers.Clear();
                StationCommandHandlers.Clear();
            }
        }

        [Test]
        public void ZooMinusTenFixedTargetsMatchBrowserCanvasSequence() {
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            var hostObject = new GameObject(StationGameHost.ObjectName);
            var cameraObject = new GameObject("ZooMinusTenCamera");
            try {
                var camera = cameraObject.AddComponent<Camera>();
                var host = hostObject.AddComponent<StationGameHost>();
                host.catalogue = catalogue;
                host.trainCatalogue = trains;
                host.stationShader = FindShader();
                host.stationCamera = camera;
                host.frameCameraOnCommit = false;

                var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
                awake.Invoke(host, null);
                host.Coordinator.RegisterRenderer(new StationCellRenderer());
                host.Coordinator.RegisterRenderer(new OutdoorModuleRenderer());
                host.Coordinator.RegisterRenderer(new StationSurfaceModuleRenderer());
                host.Coordinator.RegisterRenderer(new StationStreetModuleRenderer());
                host.Coordinator.RegisterRenderer(new StationEquipmentModuleRenderer());
                host.Coordinator.RegisterRenderer(new StationDisplayModuleRenderer());
                host.Coordinator.RegisterRenderer(new StationStructureModuleRenderer());
                host.Coordinator.RegisterRenderer(new OpeningModuleRenderer());
                host.Coordinator.RegisterRenderer(new VerticalModuleRenderer());
                host.Coordinator.RegisterRenderer(new StationSignRenderer());
                host.Coordinator.RegisterRenderer(new StationRoadRenderer());

                var rig = StationViewFeature.Attach(host);
                StationEditFeature.Attach(host);

                var zooJson = System.IO.File.ReadAllText(ZooPath);
                var opened = host.OpenDocument(zooJson, "file");
                Assert.IsTrue(opened.Accepted, opened.ToString());

                void ExecView(string type, JObject payload) {
                    var raw = new JObject { ["type"] = type, ["payload"] = payload }.ToString(Formatting.None);
                    Assert.IsTrue(rig.Execute(raw, out var code), type + " failed: " + code);
                    host.SetActiveLevel(rig.Commands.Camera.ActiveLevel);
                }

                // Exact same camera & storey framing sequence as `verify-station-game.mjs`:
                ExecView("view.set", new JObject { ["key"] = "level", ["value"] = 0 });
                ExecView("camera.home", new JObject());
                ExecView("view.set", new JObject { ["key"] = "level", ["value"] = -10 });
                ExecView("camera.zoom", new JObject { ["factor"] = 0.45 });
                rig.Tick(0f);

                // Fixed, independently chosen Zoo -10 m targets in document metres (north concourse balcony):
                var fixedBinDoc = new Vector3(58.5f, 38.5f, -8.55f);    // bin-754 @ (58, 38, -10)
                var fixedCellDoc = new Vector3(57.5f, 37.2f, -9.0f);    // open concourse floor @ (57, 37, -10), under (69, 23, 0)
                var fixedDropDoc = new Vector3(60.5f, 37.5f, -9.0f);    // adjacent open concourse floor @ (60, 37, -10)
                var fixedVoidDoc = new Vector3(50.0f, 45.0f, 0.0f);     // above hidden 0 m grade north of station -> void miss

                JObject PointerAtDoc(Vector3 docPoint, int button = 0, int buttons = 1) {
                    var screen = camera.WorldToScreenPoint(StationCoordinates.Point(docPoint));
                    return new JObject {
                        ["x"] = screen.x,
                        ["y"] = Mathf.Max(1f, Screen.height) - screen.y,
                        ["w"] = Mathf.Max(1f, Screen.width),
                        ["h"] = Mathf.Max(1f, Screen.height),
                        ["button"] = button,
                        ["buttons"] = buttons,
                        ["toolGeneration"] = StationToolSelection.Generation,
                        ["documentRevision"] = host.CurrentRevision,
                    };
                }

                // 1. Select fixed -10 m concourse cell (directly under hidden 0 m grade), fixed -10 m bin-754, and empty void:
                Assert.IsTrue(StationToolSelection.TrySelect("select", out _, out _));
                int picks = StationScenePicker.PickCount;
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", PointerAtDoc(fixedCellDoc), new JObject(), out _, out _));
                Assert.AreEqual(++picks, StationScenePicker.PickCount);
                Assert.AreEqual("cell", StationEditSession.SelectionKind, "got " + StationEditSession.SelectionKind + ":" + StationEditSession.SelectionKey);
                Assert.AreEqual("57,37,-10", StationEditSession.SelectionKey,
                    "hidden 0 m grade is skipped so visible (57,37,-10) concourse floor wins");

                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", PointerAtDoc(fixedBinDoc), new JObject(), out _, out _));
                Assert.AreEqual(++picks, StationScenePicker.PickCount);
                Assert.AreEqual("module", StationEditSession.SelectionKind, "got " + StationEditSession.SelectionKind + ":" + StationEditSession.SelectionKey);
                Assert.AreEqual("bin-754", StationEditSession.SelectionKey);

                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", PointerAtDoc(fixedVoidDoc), new JObject(), out _, out _));
                Assert.AreEqual(++picks, StationScenePicker.PickCount);
                Assert.AreEqual("", StationEditSession.SelectionKind, "void miss clears Unity selection, got " + StationEditSession.SelectionKey);
                Assert.AreEqual("", StationEditSession.SelectionKey);

                // 2. Eyedropper (`pick`) on fixed -10 m bin-754:
                Assert.IsTrue(StationToolSelection.TrySelect("pick", out _, out _));
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", PointerAtDoc(fixedBinDoc), new JObject(), out _, out _));
                Assert.AreEqual(++picks, StationScenePicker.PickCount);
                Assert.AreEqual("bin-754", (string)StationEditSession.Picked?["moduleId"]);

                // 3. Placement (`module`, `bench-steel-1`, rot 0): hover, refused click on occupied bin, valid click on (57, 37, -10):
                Assert.IsTrue(StationToolSelection.TrySelect("module", out _, out _));
                StationToolSelection.ApplySettings(new JObject {
                    ["moduleType"] = "bench-steel-1", ["rotation"] = 0,
                });
                long rev0 = host.CurrentRevision;

                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.move", PointerAtDoc(fixedCellDoc, 0, 0), new JObject(), out _, out _));
                Assert.AreEqual(++picks, StationScenePicker.PickCount);
                Assert.AreEqual(rev0, host.CurrentRevision, "hover preview never mutates revision");
                Assert.IsNotNull(StationEditSession.Plan);
                Assert.IsTrue(StationEditSession.Plan.Ok, StationEditSession.Plan.Reason);
                Assert.AreEqual(57, StationEditSession.Plan.Candidate.X);
                Assert.AreEqual(37, StationEditSession.Plan.Candidate.Y);
                Assert.AreEqual(-10, StationEditSession.Plan.Candidate.Z);

                // Refused click on occupied bin cell (58, 38, -10):
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", PointerAtDoc(fixedBinDoc), new JObject(), out _, out _));
                Assert.AreEqual(++picks, StationScenePicker.PickCount);
                Assert.AreEqual(rev0, host.CurrentRevision, "refused placement leaves revision untouched");

                // Valid click on (57, 37, -10):
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", PointerAtDoc(fixedCellDoc), new JObject(), out _, out _));
                Assert.AreEqual(++picks, StationScenePicker.PickCount);
                Assert.AreEqual(rev0 + 1, host.CurrentRevision, "single commit for valid placement");
                string placedId = StationEditSession.SelectionKey;
                Assert.IsTrue(!string.IsNullOrEmpty(placedId), "newly placed bench is selected");
                Assert.IsTrue(host.Index.TryGetModule(placedId, out var placedBench));
                Assert.AreEqual(57, placedBench.X);
                Assert.AreEqual(37, placedBench.Y);
                Assert.AreEqual(-10, placedBench.Z);

                // 4. Move pickup at (57.5, 37.5, -8.55) and drop onto (60, 37, -10):
                var placedSeatDoc = new Vector3(57.5f, 37.5f, -8.55f);
                Assert.IsTrue(StationToolSelection.TrySelect("move", out _, out _));
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", PointerAtDoc(placedSeatDoc), new JObject(), out _, out _));
                Assert.AreEqual(++picks, StationScenePicker.PickCount);
                Assert.AreEqual(placedId, StationEditSession.CarriedId, "got selection=" + StationEditSession.SelectionKey);
                // Plan 27 §4: the source cell's ghost appears on the pickup event itself; the drop
                // below replaces it with the aimed plan.
                Assert.IsNotNull(StationEditSession.Plan, "a pickup shows the source-cell ghost at once");
                Assert.IsTrue(StationEditSession.Plan.IsMove, "the plan is the carried piece");
                Assert.AreEqual(rev0 + 1, host.CurrentRevision);

                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", PointerAtDoc(fixedDropDoc), new JObject(), out _, out _));
                Assert.AreEqual(++picks, StationScenePicker.PickCount);
                Assert.AreEqual(rev0 + 2, host.CurrentRevision, "single commit for valid move drop: " + StationEditSession.MoveReason);
                Assert.AreEqual("", StationEditSession.CarriedId);
                Assert.IsTrue(host.Index.TryGetModule(placedId, out var movedBench));
                Assert.AreEqual(60, movedBench.X);
                Assert.AreEqual(37, movedBench.Y);
                Assert.AreEqual(-10, movedBench.Z);

                // 5. Select right-tap (`pointer.rightTap`) deletes the moved bench in one undoable commit:
                var movedSeatDoc = new Vector3(60.5f, 37.5f, -8.55f);
                Assert.IsTrue(StationToolSelection.TrySelect("select", out _, out _));
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.rightTap", PointerAtDoc(movedSeatDoc, 2, 0), new JObject(), out _, out _));
                Assert.AreEqual(++picks, StationScenePicker.PickCount);
                Assert.AreEqual(rev0 + 3, host.CurrentRevision, "single commit for right-tap delete");
                Assert.IsFalse(host.Index.TryGetModule(placedId, out _));

                // Undo restores the deleted bench, redo deletes it again, three undos restore clean Zoo:
                Assert.IsTrue(StationEditSession.TryUndo(host, out _, out _));
                Assert.AreEqual(rev0 + 4, host.CurrentRevision);
                Assert.IsTrue(host.Index.TryGetModule(placedId, out _));

                Assert.IsTrue(StationEditSession.TryRedo(host, out _, out _));
                Assert.AreEqual(rev0 + 5, host.CurrentRevision);
                Assert.IsFalse(host.Index.TryGetModule(placedId, out _));

                Assert.IsTrue(StationEditSession.TryUndo(host, out _, out _)); // undo delete
                Assert.IsTrue(StationEditSession.TryUndo(host, out _, out _)); // undo move
                Assert.IsTrue(StationEditSession.TryUndo(host, out _, out _)); // undo place
                Assert.IsFalse(host.Index.TryGetModule(placedId, out _));

                // 6. Toggle view and click the EXACT SAME pixel immediately without an intervening hover:
                // Also verify the frozen concourse ray `(56.5, 37.6, -9.0)` piercing `(72, 14, 0)`!
                var screenshotClickPayload = PointerAtDoc(new Vector3(56.5f, 37.6f, -9.0f));
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", screenshotClickPayload, new JObject(), out _, out _));
                Assert.AreEqual("cell", StationEditSession.SelectionKind, "got " + StationEditSession.SelectionKind + ":" + StationEditSession.SelectionKey);
                Assert.AreEqual("56,37,-10", StationEditSession.SelectionKey);

                // `hideUi` lifts HideAbove without moving the camera -> same pixel immediately hits 0 m street `sidewalk-1717` over (72, 14, 0)!
                ExecView("view.set", new JObject { ["key"] = "hideUi", ["value"] = true });
                rig.Tick(0f);
                screenshotClickPayload["documentRevision"] = host.CurrentRevision;
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", screenshotClickPayload, new JObject(), out _, out _));
                Assert.AreEqual("module", StationEditSession.SelectionKind, "got " + StationEditSession.SelectionKind + ":" + StationEditSession.SelectionKey);
                Assert.AreEqual("sidewalk-1717", StationEditSession.SelectionKey,
                    "enabling hideUi without hover exposes 0 m street paving over (72,14,0) on the frozen ray");

                // Restore normal -10 m slice without hover -> same pixel immediately resolves 56,37,-10 again!
                ExecView("view.set", new JObject { ["key"] = "hideUi", ["value"] = false });
                rig.Tick(0f);
                Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down", screenshotClickPayload, new JObject(), out _, out _));
                Assert.AreEqual("cell", StationEditSession.SelectionKind);
                Assert.AreEqual("56,37,-10", StationEditSession.SelectionKey);
            } finally {
                StationSectionDrag.Reset();
                StationEditHost.ResetForTests();
                UnityEngine.Object.DestroyImmediate(cameraObject);
                UnityEngine.Object.DestroyImmediate(hostObject);
                StationEditSession.Reset();
                StationScenePicker.Reset();
                StationToolSelection.Reset();
                StationRenderers.Clear();
                StationCommandHandlers.Clear();
            }
        }

        /* --------------------------------------- drawn surfaces (plan 18 §9) */

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
            var read = StationDocumentReader.Read(envelope.ToString(Formatting.None),
                new StationSource("test:picker-plate", ""));
            Assert.IsNotNull(read?.Document, "the probe document loads");
            var probeRoot = new GameObject("picker plate probe");
            var probeWorld = new StationWorldView(probeRoot.transform, "picker plate",
                Array.Empty<IStationViewRenderer>(), new StationViewAssets());
            GameObject plate = null;
            try {
                probeWorld.Build(read.Document, read.Index);
                plate = GameObject.CreatePrimitive(PrimitiveType.Cube);
                UnityEngine.Object.DestroyImmediate(plate.GetComponent<Collider>());
                plate.transform.SetParent(probeRoot.transform, false);
                plate.transform.position = StationCoordinates.Point(new Vector3(2f, 2f, 2f));
                plate.transform.localScale = new Vector3(4f, 1f, .02f);
                probeWorld.RegisterModule("displays", "probe-inscription", plate, "board",
                    new StationBox(-2, 0, 0, 6, 4, 3), 0, 0);
                StationScenePicker.Reset();
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
            var read = StationDocumentReader.Read(envelope.ToString(Formatting.None),
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
                probeWorld.RegisterModule("displays", "probe-billboard", cube, "board",
                    new StationBox(0, 0, 0, 4, 1, 1), 0, 0);
                StationScenePicker.Reset();
                var through = StationScenePicker.PickRay(probeWorld, DownAt(1f, .5f), 0);
                Assert.IsTrue(through.HasModule, "the drawn cube takes the pick");
                Assert.AreEqual("probe-billboard", through.Module.Id);
                Assert.IsTrue(through.ModuleExact, "the hit is a drawn surface");
                Assert.Less(through.ModuleLocal.magnitude, 1f,
                    "the local attachment point is inside the drawn cube's own frame");
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
