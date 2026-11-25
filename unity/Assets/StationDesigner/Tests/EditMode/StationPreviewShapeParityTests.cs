using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Regression suite verifying that every Unity placement, drag, move, extension, and rail
    /// preview builds the exact shape of its committed object — never falling back to a plain
    /// 12-triangle clearance box or wrong-dimension static prefab.
    ///
    /// Also pins pillar picking/extension and slim-pillar 9-spot rotation parity:
    /// 1. Thick &amp; slim pillars (fresh hover, extension, line drag, bridge piers) draw real
    ///    cylindrical / collared pillar meshes matching `StationStructureModuleRenderer` bounds.
    /// 2. Hovering the upper metre of an existing 4 m pillar resolves its extension via direct
    ///    module hit instead of missing `PillarAt` and falling back to a floating pillar.
    /// 3. Moving or rotating a slim pillar preserves all 9 in-cell positions (`% 9`).
    /// 4. Roofs (`flat`, `plateSnap` lower/upper, `truss`, `tapered-truss`, `shell`, `canopy`),
    ///    hangers (`roof` &amp; `post`), glass walls &amp; curtain walls, booths (Move tool),
    ///    vertical circulation (`stair`, `stair-block`, `escalator`, `walkway`, `lift`),
    ///    openings (`psd-end` full/cover, `door`, `gate`), and tracks/bridges (`ShowRail`)
    ///    all render their real procedural/prefab shapes and clean up owned meshes on clear.
    /// </summary>
    public sealed class StationPreviewShapeParityTests {
        GameObject hostObject;
        GameObject cameraObject;
        StationGameHost host;
        StationViewRig rig;
        Camera camera;
        RuntimeCatalogue catalogue;

        [SetUp]
        public void SetUp() {
            ResetStatics();
            catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "RuntimeCatalogue missing at " + RuntimeCatalogue.AssetPath);

            hostObject = new GameObject(StationGameHost.ObjectName);
            cameraObject = new GameObject("preview-shape-parity-camera");
            camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 14f;
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 200f;

            host = hostObject.AddComponent<StationGameHost>();
            host.catalogue = catalogue;
            host.trainCatalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            host.stationShader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            host.stationCamera = camera;
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
            awake.Invoke(host, null);
            host.Coordinator.RegisterRenderer(new StationCellRenderer());
            host.Coordinator.RegisterRenderer(new OutdoorModuleRenderer());
            host.Coordinator.RegisterRenderer(new StationEquipmentModuleRenderer());
            host.Coordinator.RegisterRenderer(new StationDisplayModuleRenderer());
            host.Coordinator.RegisterRenderer(new StationStructureModuleRenderer());
            host.Coordinator.RegisterRenderer(new StationStreetModuleRenderer());
            host.Coordinator.RegisterRenderer(new StationSurfaceModuleRenderer());
            host.Coordinator.RegisterRenderer(new OpeningModuleRenderer());
            host.Coordinator.RegisterRenderer(new VerticalModuleRenderer());
            host.Coordinator.RegisterRenderer(new StationRoadRenderer());
        }

        [TearDown]
        public void TearDown() {
            StationSectionDrag.Reset();
            StationEditHost.ResetForTests();
            if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
            if (hostObject != null) UnityEngine.Object.DestroyImmediate(hostObject);
            cameraObject = null;
            hostObject = null;
            host = null;
            rig = null;
            camera = null;
            ResetStatics();
        }

        static void ResetStatics() {
            StationScenePicker.Reset();
            StationEditSession.Reset();
            StationToolSelection.Reset();
            StationCellTool.Reset();
            StationRoofTool.Reset();
            StationSurfaceTool.Reset();
            StationRoadTool.Reset();
            StationPillarTool.Reset();
            StationRailTool.Reset();
            StationTunnelTool.Reset();
            StationZoneTool.Reset();
            StationPaintTool.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
            StationEditHost.ResetForTests();
        }

        void Exec(string type, JObject payload) {
            Assert.IsTrue(rig.Execute(new JObject { ["type"] = type, ["payload"] = payload }
                .ToString(Newtonsoft.Json.Formatting.None), out var code), type + ": " + code);
        }

        static void ArmTool(string tool, JObject settings = null) {
            var payload = new JObject { ["tool"] = tool };
            if (settings != null) payload["settings"] = settings;
            var cmd = new StationCommand {
                SchemaVersion = StationCommandRouter.SchemaVersion,
                Id = "arm-" + tool,
                SessionId = "preview-shape-test",
                Type = "tool.set",
                Payload = payload,
            };
            var handler = new StationToolCommandHandler();
            Assert.IsTrue(handler.TryHandle(cmd, cmd.Payload, out var code, out var reason), code + ": " + reason);
        }

        void LoadStation(string json, int activeLevel = 0) {
            var opened = host.OpenDocument(json, "file");
            Assert.IsTrue(opened.Accepted, "OpenDocument failed: " + opened);
            Assert.IsNotNull(host.Coordinator?.World, "World must be built");
            rig = StationViewFeature.Attach(host);
            StationEditFeature.Attach(host);
            Exec("view.set", new JObject { ["key"] = "level", ["value"] = activeLevel });
            Exec("view.set", new JObject { ["key"] = "ground", ["value"] = activeLevel < 0 });
            rig.Tick(0f);
            host.SetActiveLevel(rig.Visibility.State.ActiveLevel);
            StationEditHost.Ensure().Bind(host);
        }

        static string FloorStationJson(int minX = -6, int maxX = 24, int minY = -6, int maxY = 16,
            int floorZ = 0, int? ceilingZ = null, JArray modules = null, JArray lines = null) {
            var cells = new JArray();
            for (int x = minX; x <= maxX; x++) {
                for (int y = minY; y <= maxY; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = floorZ, ["fill"] = "solid" });
                    if (ceilingZ.HasValue) {
                        cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = ceilingZ.Value, ["fill"] = "solid" });
                    }
                }
            }
            return new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "PreviewShapeTest",
                ["city"] = "guangzhou",
                ["seed"] = 13,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = cells,
                    ["modules"] = modules ?? new JArray(),
                    ["lines"] = lines ?? new JArray {
                        new JObject {
                            ["id"] = "1",
                            ["name"] = "1号线",
                            ["color"] = "#e53935",
                            ["stock"] = "A",
                            ["cars"] = 6,
                            ["power"] = "catenary",
                            ["direction"] = "up",
                            ["headway"] = 180,
                        },
                    },
                },
            }.ToString(Newtonsoft.Json.Formatting.None);
        }

        static (int MeshCount, int Triangles, Bounds WorldBounds, bool AnyPlainPreviewBox) MeasurePreview(StationPlacementPreview preview) {
            int meshes = 0;
            int triangles = 0;
            bool anyBounds = false;
            bool anyPlainBox = false;
            Bounds bounds = default;
            foreach (var filter in preview.GetComponentsInChildren<MeshFilter>(false)) {
                if (filter == null || filter.sharedMesh == null) continue;
                var renderer = filter.GetComponent<MeshRenderer>();
                if (renderer == null || !renderer.enabled) continue;
                if (filter.gameObject.name == "selection box" || filter.gameObject.name == "erase surface batch") continue;
                var mesh = filter.sharedMesh;
                if (mesh.subMeshCount == 0 || mesh.GetTopology(0) != MeshTopology.Triangles) continue;
                if (filter.gameObject.name == "preview box") anyPlainBox = true;
                meshes++;
                for (int s = 0; s < mesh.subMeshCount; s++) {
                    if (mesh.GetTopology(s) == MeshTopology.Triangles) {
                        triangles += (int)mesh.GetIndexCount(s) / 3;
                    }
                }
                var local = mesh.bounds;
                var m = filter.transform.localToWorldMatrix;
                for (int c = 0; c < 8; c++) {
                    var pt = m.MultiplyPoint3x4(new Vector3(
                        (c & 1) == 0 ? local.min.x : local.max.x,
                        (c & 2) == 0 ? local.min.y : local.max.y,
                        (c & 4) == 0 ? local.min.z : local.max.z));
                    if (!anyBounds) { bounds = new Bounds(pt, Vector3.zero); anyBounds = true; }
                    else bounds.Encapsulate(pt);
                }
            }
            return (meshes, triangles, bounds, anyPlainBox);
        }

        static Bounds MeasureCommittedModule(StationWorldView world, string moduleId) {
            bool any = false;
            Bounds bounds = default;
            foreach (var rec in world.Records) {
                if (rec?.View == null || !string.Equals(rec.ModuleId, moduleId, StringComparison.Ordinal)) continue;
                foreach (var filter in rec.View.GetComponentsInChildren<MeshFilter>(true)) {
                    var mesh = filter?.sharedMesh;
                    if (!mesh || mesh.subMeshCount == 0 || mesh.GetTopology(0) != MeshTopology.Triangles) continue;
                    var local = mesh.bounds;
                    var m = filter.transform.localToWorldMatrix;
                    for (int c = 0; c < 8; c++) {
                        var pt = m.MultiplyPoint3x4(new Vector3(
                            (c & 1) == 0 ? local.min.x : local.max.x,
                            (c & 2) == 0 ? local.min.y : local.max.y,
                            (c & 4) == 0 ? local.min.z : local.max.z));
                        if (!any) { bounds = new Bounds(pt, Vector3.zero); any = true; }
                        else bounds.Encapsulate(pt);
                    }
                }
            }
            Assert.IsTrue(any, "Expected committed mesh for " + moduleId);
            return bounds;
        }

        static void AssertBoundsMatch(Bounds expected, Bounds actual, float tolerance, string label) {
            Assert.AreEqual(expected.min.x, actual.min.x, tolerance, label + " min.x");
            Assert.AreEqual(expected.min.y, actual.min.y, tolerance, label + " min.y");
            Assert.AreEqual(expected.min.z, actual.min.z, tolerance, label + " min.z");
            Assert.AreEqual(expected.max.x, actual.max.x, tolerance, label + " max.x");
            Assert.AreEqual(expected.max.y, actual.max.y, tolerance, label + " max.y");
            Assert.AreEqual(expected.max.z, actual.max.z, tolerance, label + " max.z");
        }

        [Test]
        public void ThickAndSlimPillarPreviewsBuildRealCylinderAndCollarsMatchingCommittedGeometry() {
            var modules = new JArray {
                new JObject {
                    ["id"] = "p-thick-ref", ["type"] = "pillar", ["x"] = 2, ["y"] = 2, ["z"] = 0, ["rot"] = 0,
                    ["cfg"] = new JObject { ["size"] = "thick", ["height"] = 4 },
                },
                new JObject {
                    ["id"] = "p-slim-ref", ["type"] = "pillar", ["x"] = 5, ["y"] = 2, ["z"] = 0, ["rot"] = 6,
                    ["cfg"] = new JObject { ["size"] = "slim", ["height"] = 4 },
                },
            };
            LoadStation(FloorStationJson(modules: modules), activeLevel: 0);
            var preview = StationEditHost.Ensure().Preview;

            // Thick round pillar: 32-segment cylinder + 2 collars = 3 * 32 * 4 = 384 triangles (never a 12-tri box!).
            var thickDraft = new StationEditDraft { Id = "preview-thick", Type = "pillar", X = 2, Y = 2, Z = 0, Rotation = 0 };
            thickDraft.Set("size", "thick");
            thickDraft.Set(4, "height");
            preview.Show(new StationPlacementPlan { Candidate = thickDraft, Reason = "" });
            var thickMeasured = MeasurePreview(preview);
            var thickCommitted = MeasureCommittedModule(host.Coordinator.World, "p-thick-ref");
            Assert.IsFalse(thickMeasured.AnyPlainPreviewBox, "Thick pillar preview must not fall back to plain preview box");
            Assert.GreaterOrEqual(thickMeasured.Triangles, 200, "Thick pillar preview must render cylindrical mesh + collars");
            AssertBoundsMatch(thickCommitted, thickMeasured.WorldBounds, 0.02f, "thick pillar");

            // Slim pillar at spot 6 (-0.35, -0.35): shaft + 2 collars = 36 triangles, shifted off cell centre.
            var slimDraft = new StationEditDraft { Id = "preview-slim", Type = "pillar", X = 5, Y = 2, Z = 0, Rotation = 6 };
            slimDraft.Set("size", "slim");
            slimDraft.Set(4, "height");
            preview.Show(new StationPlacementPlan { Candidate = slimDraft, Reason = "" });
            var slimMeasured = MeasurePreview(preview);
            var slimCommitted = MeasureCommittedModule(host.Coordinator.World, "p-slim-ref");
            Assert.IsFalse(slimMeasured.AnyPlainPreviewBox, "Slim pillar preview must not fall back to plain preview box");
            Assert.GreaterOrEqual(slimMeasured.Triangles, 36, "Slim pillar preview must include shaft and collars");
            AssertBoundsMatch(slimCommitted, slimMeasured.WorldBounds, 0.02f, "slim pillar rot=6");

            // Slim pillar move + rotate preserves all 9 in-cell positions (% 9, not clamped to % 4).
            Assert.IsTrue(host.Index.TryGetModule("p-slim-ref", out var slimRec));
            var hit = new StationPlacementHit(6, 2, 0, 6, 2, 1, true, new StationPoint(6.5, 2.5, 1), 1);
            var movePlan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                Carried = slimRec,
                Rotation = 6,
                Hit = hit,
            });
            Assert.IsTrue(movePlan.Ok, "Slim pillar move should succeed: " + movePlan.Reason);
            Assert.AreEqual(6, movePlan.Candidate.Rotation, "Slim pillar move must preserve spot index 6 (not % 4)");
        }

        [Test]
        public void PillarToolDirectHitOnTopMetreOfFourMetrePillarResolvesExtension() {
            var modules = new JArray {
                new JObject {
                    ["id"] = "p-4m", ["type"] = "pillar", ["x"] = 3, ["y"] = 3, ["z"] = -5, ["rot"] = 0,
                    ["cfg"] = new JObject { ["size"] = "thick", ["height"] = 4 },
                },
            };
            LoadStation(FloorStationJson(floorZ: -5, modules: modules), activeLevel: -5);
            ArmTool("module", new JObject { ["moduleType"] = "pillar-thick", ["pillarLength"] = 4 });
            Assert.IsTrue(host.Index.TryGetModule("p-4m", out var pillar));

            // Ray hits the uppermost metre (Z = -0.2) of the 4 m pillar (shaft Z in [-4, 0)).
            // Previously `PillarAt(3, 3, -1)` tested air Z in [0, 1) and missed the pillar completely.
            var topHit = new StationSceneHit {
                Module = pillar,
                ModuleExact = true,
                ModuleDistance = 5f,
                ModulePoint = new StationPoint(3.98, 3.5, -0.2),
                ModuleNormal = new StationPoint(1, 0, 0),
                Level = -5,
            };
            bool extended = StationPillarTool.Aim(host, topHit, StationPointerEvent.Synthetic(100, 100, 800, 600));
            Assert.IsTrue(extended, "Direct hit on upper metre of 4 m pillar must resolve extension");
            Assert.IsNotNull(StationPillarTool.Plan?.Candidate);
            Assert.AreEqual("p-4m", StationPillarTool.Plan.Candidate.Id);
            Assert.AreEqual(8, StationPillarTool.Plan.Candidate.Number("height"), 1e-6);
            Assert.IsTrue(StationPillarTool.Plan.Ok, "4 m + 4 m in open space must be valid");

            var preview = StationEditHost.Ensure().Preview;
            preview.ShowModules(StationPillarTool.Accepted, StationPillarTool.Refused);
            var extMeasured = MeasurePreview(preview);
            Assert.IsFalse(extMeasured.AnyPlainPreviewBox, "Pillar extension ghost must be cylindrical, not a box");
            Assert.AreEqual(8f, extMeasured.WorldBounds.size.y, 0.05f, "Extended pillar preview height must be 8 m");
        }

        [Test]
        public void RoofAndHangerPreviewsMatchCommittedDimensionsAndShapes() {
            var modules = new JArray {
                new JObject {
                    ["id"] = "roof-tapered-ref", ["type"] = "roof", ["x"] = 2, ["y"] = 2, ["z"] = 0,
                    ["w"] = 4, ["d"] = 8, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "tapered-truss" },
                },
                new JObject {
                    ["id"] = "roof-plate-lower-ref", ["type"] = "roof", ["x"] = 10, ["y"] = 2, ["z"] = 0,
                    ["w"] = 1, ["d"] = 1, ["rot"] = 0,
                    ["cfg"] = new JObject { ["plateSnap"] = "lower" },
                },
                new JObject {
                    ["id"] = "hanger-roof-ref", ["type"] = "hanger", ["x"] = 2, ["y"] = 12, ["z"] = 0,
                    ["w"] = 6, ["d"] = 1, ["rot"] = 0,
                    ["cfg"] = new JObject { ["mount"] = "roof" },
                },
            };
            LoadStation(FloorStationJson(ceilingZ: 5, modules: modules), activeLevel: 0);
            var preview = StationEditHost.Ensure().Preview;

            var tapered = new StationEditDraft { Id = "g-tapered", Type = "roof", X = 2, Y = 2, Z = 0, Width = 4, Depth = 8 };
            tapered.Set("variant", "tapered-truss");
            preview.ShowModules(new[] { new StationPlacementPlan { Candidate = tapered, Reason = "" } });
            var taperedMeasured = MeasurePreview(preview);
            var taperedCommitted = MeasureCommittedModule(host.Coordinator.World, "roof-tapered-ref");
            Assert.IsFalse(taperedMeasured.AnyPlainPreviewBox);
            AssertBoundsMatch(taperedCommitted, taperedMeasured.WorldBounds, 0.05f, "4x8 tapered-truss roof");

            var lowerPlate = new StationEditDraft { Id = "g-plate", Type = "roof", X = 10, Y = 2, Z = 0, Width = 1, Depth = 1 };
            lowerPlate.Set("plateSnap", "lower");
            preview.ShowModules(new[] { new StationPlacementPlan { Candidate = lowerPlate, Reason = "" } });
            var plateMeasured = MeasurePreview(preview);
            var plateCommitted = MeasureCommittedModule(host.Coordinator.World, "roof-plate-lower-ref");
            Assert.IsFalse(plateMeasured.AnyPlainPreviewBox);
            AssertBoundsMatch(plateCommitted, plateMeasured.WorldBounds, 0.02f, "plateSnap=lower roof");

            var hanger = new StationEditDraft { Id = "g-hanger", Type = "hanger", X = 2, Y = 12, Z = 0, Width = 6, Depth = 1 };
            hanger.Set("mount", "roof");
            preview.Show(new StationPlacementPlan { Candidate = hanger, Reason = "" });
            var hangerMeasured = MeasurePreview(preview);
            var hangerCommitted = MeasureCommittedModule(host.Coordinator.World, "hanger-roof-ref");
            Assert.IsFalse(hangerMeasured.AnyPlainPreviewBox);
            AssertBoundsMatch(hangerCommitted, hangerMeasured.WorldBounds, 0.02f, "6 m roof hanger");
        }

        [Test]
        public void GlassBoothVerticalOpeningAndRailPreviewsBuildRealGeometry() {
            var modules = new JArray {
                new JObject {
                    ["id"] = "curtain-ref", ["type"] = "glass", ["x"] = 2, ["y"] = 2, ["z"] = 0,
                    ["w"] = 3, ["d"] = 1, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "3x4", ["curtainHeight"] = 4 },
                },
                new JObject {
                    ["id"] = "booth-ref", ["type"] = "booth", ["x"] = 8, ["y"] = 2, ["z"] = 0,
                    ["w"] = 3, ["h"] = 3, ["rot"] = 0,
                    ["cfg"] = new JObject { ["kind"] = "ticket", ["front"] = 0 },
                },
                new JObject {
                    ["id"] = "lift-ref", ["type"] = "lift", ["x"] = 14, ["y"] = 2, ["z"] = 0, ["rot"] = 0,
                    ["from"] = new JObject { ["x"] = 14, ["y"] = 2, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 14, ["y"] = 2, ["z"] = 5 },
                    ["cfg"] = new JObject { ["rises"] = new JArray(5), ["size"] = 3, ["style"] = "glass" },
                },
                new JObject {
                    ["id"] = "esc-ref", ["type"] = "escalator", ["x"] = 2, ["y"] = 8, ["z"] = 0, ["rot"] = 0,
                    ["from"] = new JObject { ["x"] = 2, ["y"] = 8, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 11, ["y"] = 8, ["z"] = 5 },
                    ["cfg"] = new JObject { ["incline"] = 30, ["dir"] = "up", ["width"] = 2 },
                },
                new JObject {
                    ["id"] = "stairblock-ref", ["type"] = "stair", ["x"] = 18, ["y"] = 2, ["z"] = 0, ["rot"] = 0,
                    ["from"] = new JObject { ["x"] = 17, ["y"] = 2, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 19, ["y"] = 2, ["z"] = 1 },
                    ["cfg"] = new JObject { ["width"] = 1, ["block"] = true, ["blockHeight"] = 0.5 },
                },
                new JObject {
                    ["id"] = "psdend-ref", ["type"] = "psd-end", ["x"] = 18, ["y"] = 6, ["z"] = 0, ["rot"] = 0,
                    ["cfg"] = new JObject { ["psd"] = "full", ["side"] = "left" },
                },
            };
            LoadStation(FloorStationJson(modules: modules), activeLevel: 0);
            var preview = StationEditHost.Ensure().Preview;

            // 1. Glass curtain wall (3x4): multi-part frame + posts + pane (NOT plain box!).
            var curtain = new StationEditDraft { Id = "g-curtain", Type = "glass", X = 2, Y = 2, Z = 0, Width = 3, Depth = 1 };
            curtain.Set("variant", "3x4");
            curtain.Set(4, "curtainHeight");
            preview.Show(new StationPlacementPlan { Candidate = curtain, Reason = "" });
            var curtainMeasured = MeasurePreview(preview);
            var curtainCommitted = MeasureCommittedModule(host.Coordinator.World, "curtain-ref");
            Assert.IsFalse(curtainMeasured.AnyPlainPreviewBox, "Curtain wall must not fall back to plain box");
            Assert.GreaterOrEqual(curtainMeasured.MeshCount, 2, "Curtain wall must emit frame/posts/pane parts");
            AssertBoundsMatch(curtainCommitted, curtainMeasured.WorldBounds, 0.05f, "curtain wall 3x4");

            // 2. Booth via Show(plan) (Move tool path): 3x3 BoothModuleViews geometry, not 5.45x3 prefab.
            var booth = new StationEditDraft { Id = "g-booth", Type = "booth", X = 8, Y = 2, Z = 0, Width = 3, Depth = 3, Height = 3 };
            booth.Set("kind", "ticket");
            booth.Set(0, "front");
            preview.Show(new StationPlacementPlan { Candidate = booth, Reason = "" });
            var boothMeasured = MeasurePreview(preview);
            var boothCommitted = MeasureCommittedModule(host.Coordinator.World, "booth-ref");
            Assert.IsFalse(boothMeasured.AnyPlainPreviewBox);
            AssertBoundsMatch(boothCommitted, boothMeasured.WorldBounds, 0.05f, "booth 3x3 in Show");

            // 3. Large 3x3 lift shaft.
            var lift = new StationEditDraft {
                Id = "g-lift", Type = "lift", X = 14, Y = 2, Z = 0,
                From = new StationPoint(14, 2, 0), To = new StationPoint(14, 2, 5),
            };
            lift.SetJson("rises", "[5]");
            lift.Set(3, "size");
            lift.Set("style", "glass");
            preview.Show(new StationPlacementPlan { Candidate = lift, Reason = "" });
            var liftMeasured = MeasurePreview(preview);
            var liftCommitted = MeasureCommittedModule(host.Coordinator.World, "lift-ref");
            Assert.IsFalse(liftMeasured.AnyPlainPreviewBox, "Lift preview must not fall back to plain box");
            Assert.Greater(liftMeasured.Triangles, 40, "Lift preview must draw full shaft geometry");
            AssertBoundsMatch(liftCommitted, liftMeasured.WorldBounds, 0.05f, "3x3 lift");

            // 4. Wide 2-lane escalator with materialized phase-0 steps.
            var esc = new StationEditDraft {
                Id = "g-esc", Type = "escalator", X = 2, Y = 8, Z = 0,
                From = new StationPoint(2, 8, 0), To = new StationPoint(11, 8, 5),
            };
            esc.Set(30, "incline");
            esc.Set("dir", "up");
            esc.Set(2, "width");
            preview.Show(new StationPlacementPlan { Candidate = esc, Reason = "" });
            var escMeasured = MeasurePreview(preview);
            var escCommitted = MeasureCommittedModule(host.Coordinator.World, "esc-ref");
            Assert.IsFalse(escMeasured.AnyPlainPreviewBox, "Escalator preview must not fall back to plain box");
            Assert.Greater(escMeasured.Triangles, 100, "Escalator preview must include truss, balustrades, and materialized steps");
            AssertBoundsMatch(escCommitted, escMeasured.WorldBounds, 0.1f, "2-lane escalator");

            // 5. Low 0.5 m stair block.
            var sb = new StationEditDraft {
                Id = "g-sb", Type = "stair", X = 18, Y = 2, Z = 0,
                From = new StationPoint(17, 2, 0), To = new StationPoint(19, 2, 1),
            };
            sb.Set(1, "width");
            sb.Set(true, "block");
            sb.Set("blockHeight", "0.5");
            preview.Show(new StationPlacementPlan { Candidate = sb, Reason = "" });
            var sbMeasured = MeasurePreview(preview);
            var sbCommitted = MeasureCommittedModule(host.Coordinator.World, "stairblock-ref");
            Assert.IsFalse(sbMeasured.AnyPlainPreviewBox);
            AssertBoundsMatch(sbCommitted, sbMeasured.WorldBounds, 0.03f, "0.5 m stair block");

            // 6. Full-height PSD end panel.
            var psdEnd = new StationEditDraft { Id = "g-psdend", Type = "psd-end", X = 18, Y = 6, Z = 0 };
            psdEnd.Set("psd", "full");
            psdEnd.Set("side", "left");
            preview.Show(new StationPlacementPlan { Candidate = psdEnd, Reason = "" });
            var psdMeasured = MeasurePreview(preview);
            var psdCommitted = MeasureCommittedModule(host.Coordinator.World, "psdend-ref");
            Assert.IsFalse(psdMeasured.AnyPlainPreviewBox);
            AssertBoundsMatch(psdCommitted, psdMeasured.WorldBounds, 0.05f, "full PSD end");

            // 7. Bridge track + bridge piers in ShowRail (real RailRunGeometry + round cylindrical piers!).
            var bridgeTrack = new StationEditDraft { Id = "g-bridge", Type = "track", X = 2, Y = 12, Z = 5, Width = 16, Depth = 3 };
            bridgeTrack.Set("line", "1");
            bridgeTrack.Set("dir", "up");
            bridgeTrack.Set(true, "bridge");
            bridgeTrack.Set("bridgeRailing", "railing");
            var bridgePier = new StationEditDraft { Id = "g-bridge:pillar:0", Type = "pillar", X = 6, Y = 13, Z = 0 };
            bridgePier.Set("size", "thick");
            bridgePier.Set(5, "height");
            bridgePier.Set("bridgeId", "g-bridge");
            var railPlan = new StationRailPlan { Track = bridgeTrack };
            for (int x = 2; x < 18; x++)
                for (int y = 12; y < 15; y++)
                    railPlan.Bed.Add(new StationCellKey(x, y, 5));
            preview.ShowRail(railPlan, new[] { bridgePier });
            var railMeasured = MeasurePreview(preview);
            Assert.IsFalse(railMeasured.AnyPlainPreviewBox, "ShowRail bridge + pier preview must not draw plain boxes");
            Assert.Greater(railMeasured.Triangles, 500, "Bridge track + cylindrical pier preview must draw detailed geometry");

            preview.ClearAll();
            Assert.AreEqual(0, MeasurePreview(preview).MeshCount, "ClearAll must remove all preview meshes");
        }

        [Test]
        public void LiftPreviewFlattensToSingleMeshAndReusesGhostOnSameCellHover() {
            var modules = new JArray {
                new JObject {
                    ["id"] = "lift-2x2-ref", ["type"] = "lift", ["x"] = 6, ["y"] = 4, ["z"] = 0, ["rot"] = 1,
                    ["from"] = new JObject { ["x"] = 6, ["y"] = 4, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 6, ["y"] = 4, ["z"] = 5 },
                    ["cfg"] = new JObject { ["rises"] = new JArray(5), ["style"] = "glass" },
                },
            };
            LoadStation(FloorStationJson(modules: modules), activeLevel: 0);
            var preview = StationEditHost.Ensure().Preview;

            StationPlacementPlan MakeLiftPlan(int x, int y, int rot, string style, string reason = "") {
                var d = new StationEditDraft {
                    Id = "lift-edit", Type = "lift", X = x, Y = y, Z = 0, Rotation = rot,
                    From = new StationPoint(x, y, 0), To = new StationPoint(x, y, 5),
                };
                d.SetJson("rises", "[5]");
                d.Set("style", style);
                return new StationPlacementPlan { Candidate = d, Reason = reason };
            }

            // 1. Lift ghost must flatten all ~16 sub-parts (shaft, shaft-glass, caps, guides, cabin,
            //    portals, leaves) into ONE single MeshRenderer so URP never has equal-center transparent
            //    sort ties between shaft/shaft-glass/caps.
            preview.Show(MakeLiftPlan(6, 4, 1, "glass"));
            var firstMeasured = MeasurePreview(preview);
            var committed = MeasureCommittedModule(host.Coordinator.World, "lift-2x2-ref");
            Assert.IsFalse(firstMeasured.AnyPlainPreviewBox);
            Assert.AreEqual(1, firstMeasured.MeshCount, "Lift preview must flatten to 1 combined MeshRenderer");
            Assert.Greater(firstMeasured.Triangles, 200, "Flattened lift mesh must retain full shaft/cabin/door geometry");
            AssertBoundsMatch(committed, firstMeasured.WorldBounds, 0.05f, "flattened 2x2 lift");

            var firstGo = preview.GetComponentsInChildren<MeshFilter>(false)[0].gameObject;

            // 2. Repeated Show() with an equivalent plan at the same cell (sub-cell mouse movement)
            //    must reuse the exact same ghost GameObject instead of destroying and rebuilding it.
            preview.Show(MakeLiftPlan(6, 4, 1, "glass"));
            var secondGo = preview.GetComponentsInChildren<MeshFilter>(false)[0].gameObject;
            Assert.AreSame(firstGo, secondGo,
                "Identical hover plan at the same cell must reuse the existing ghost without rebuilding");

            // 3. Changing rotation, style, position, or refusal status must rebuild immediately.
            preview.Show(MakeLiftPlan(6, 4, 2, "glass"));
            var rotatedGo = preview.GetComponentsInChildren<MeshFilter>(false)[0].gameObject;
            Assert.AreNotSame(firstGo, rotatedGo, "Rotation change must rebuild ghost");

            preview.Show(MakeLiftPlan(6, 4, 2, "steel"));
            var steelGo = preview.GetComponentsInChildren<MeshFilter>(false)[0].gameObject;
            Assert.AreNotSame(rotatedGo, steelGo, "Style change must rebuild ghost");

            preview.Show(MakeLiftPlan(6, 4, 2, "steel", reason: "occupied"));
            var refusedGo = preview.GetComponentsInChildren<MeshFilter>(false)[0].gameObject;
            Assert.AreNotSame(steelGo, refusedGo, "Refusal state change must rebuild ghost");

            preview.ClearAll();
            Assert.AreEqual(0, MeasurePreview(preview).MeshCount);
        }
    }
}
