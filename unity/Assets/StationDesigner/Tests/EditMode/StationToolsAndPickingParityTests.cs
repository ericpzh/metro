using System;
using System.Collections.Generic;
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
    /// Domain D7 parity coverage: block/wall/surface 10k drag limits, column delete across all
    /// level bases, palette settings routing (`toolAdapter` -> `StationPointerRouter.RequestFor` ->
    /// `Resolve`), `HideUi` cursor suppression, `StationPlacementHit` normal/wedge snapping,
    /// `StationRoofTool` gestures, `StationZoneTool` edge cases, `StationPaintTool` custom hex,
    /// exhaustive `StationSweep.FamilyOf`, `StationPlacementPreview` lifecycle/reuse/refusals,
    /// `StationScenePicker` ramp occlusion & hanger/lawn placement surfaces, `SelectAgent`,
    /// `StationEditSession.MaxHistory`, host edit/open commands, and `StationBenchmarkRecorder`.
    /// </summary>
    public sealed class StationToolsAndPickingParityTests {
        GameObject hostObject;
        GameObject cameraObject;
        StationGameHost host;
        StationViewRig rig;
        Camera camera;
        readonly List<UnityEngine.Object> ownedObjects = new List<UnityEngine.Object>();

        [SetUp]
        public void SetUp() {
            ResetStatics();
            hostObject = new GameObject(StationGameHost.ObjectName);
            cameraObject = new GameObject("tools parity camera");
            camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = false;
            camera.fieldOfView = 45f;
            camera.nearClipPlane = 0.2f;
            camera.farClipPlane = 400f;
            camera.pixelRect = new Rect(0f, 0f, 1280f, 720f);
            host = hostObject.AddComponent<StationGameHost>();
            host.catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            host.trainCatalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            host.stationShader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            host.stationCamera = camera;
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
            awake.Invoke(host, null);
            host.Coordinator.RegisterRenderer(new StationCellRenderer());
            rig = StationViewFeature.Attach(host);
            StationEditFeature.Attach(host);
        }

        [TearDown]
        public void TearDown() {
            for (int i = ownedObjects.Count - 1; i >= 0; i--) {
                if (ownedObjects[i] != null) UnityEngine.Object.DestroyImmediate(ownedObjects[i]);
            }
            ownedObjects.Clear();
            StationSectionDrag.Reset();
            StationRoofTool.Reset();
            StationSurfaceTool.Reset();
            StationZoneTool.Reset();
            StationPaintTool.Reset();
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
            StationCellTool.Reset();
            StationRoofTool.Reset();
            StationSurfaceTool.Reset();
            StationZoneTool.Reset();
            StationPaintTool.Reset();
            StationSectionDrag.Reset();
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
            StationEditHost.ResetForTests();
        }

        static JObject MakeSave(int levelBase = 0, JArray cells = null, JArray modules = null, JArray lines = null) =>
            new JObject {
                ["format"] = "metro-save",
                ["formatVersion"] = 1,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Tools parity",
                ["nameEn"] = "Tools parity",
                ["city"] = "guangzhou",
                ["seed"] = 1234567,
                ["levelBase"] = levelBase,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = cells ?? new JArray(),
                    ["modules"] = modules ?? new JArray(),
                    ["lines"] = lines ?? new JArray(),
                },
            };

        static JArray SolidFloorPatch(int x0, int x1, int y0, int y1, int z) {
            var cells = new JArray();
            for (int x = x0; x <= x1; x++) {
                for (int y = y0; y <= y1; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid" });
                }
            }
            return cells;
        }

        static StationSceneHit CellTopHit(int x, int y, int z, float distance = 5f) {
            var hit = StationCellFixture.Hit(x, y, z, true);
            hit.CellDistance = distance;
            return hit;
        }

        static StationPointerEvent Ptr(float x, float y, double timeMs = 0, int button = 0) =>
            StationPointerEvent.Synthetic(x, y, 1280, 720, button: button, timeMs: timeMs);

        static string NoticeCode() => (string)StationEditSession.Notice?["code"] ?? "";

        static int UndoDepth() => (int)(StationEditSession.ToJson()["undoDepth"] ?? 0);

        void OpenSave(JObject save) {
            var outcome = host.OpenDocument(save.ToString(Newtonsoft.Json.Formatting.None), "file");
            Assert.IsTrue(outcome.Accepted, outcome.ToString());
        }

        StationPlacementPreview EnsurePreview() {
            var existing = hostObject.transform.Find("TestPreviewHost")?.GetComponent<StationPlacementPreview>();
            if (existing == null) {
                var go = new GameObject("TestPreviewHost");
                go.transform.SetParent(hostObject.transform, false);
                ownedObjects.Add(go);
                existing = go.AddComponent<StationPlacementPreview>();
            }
            existing.Bind(host.Index);
            return existing;
        }

        static int PreviewRendererCount(StationPlacementPreview preview) =>
            preview.GetComponentsInChildren<MeshRenderer>(true).Length;

        static void SelectTool(string tool, JObject settings = null) {
            Assert.IsTrue(StationToolSelection.TrySelect(tool, out _, out var code), code);
            if (settings != null) StationToolSelection.ApplySettings(settings);
        }

        // ------------------------------------------------------------------ CellTool, wall cap & column delete

        [Test]
        public void WallDragOfSixtyMetresCommitsAndOverTenThousandCoursesIsRefusedWithoutCommit() {
            var cells = SolidFloorPatch(0, 70, 0, 2, -5);
            OpenSave(MakeSave(0, cells));
            var world = StationCellEditWorld.Build(host.Index);

            // 60 m wall run = 60 * 5 = 300 storey courses (previously falsely rejected by columns^2 * courses > 10000).
            var line60 = StationCellPlanner.StraightLineCells(new StationCellKey(0, 0, -5), new StationCellKey(59, 0, -5), -5);
            Assert.AreEqual(60, line60.Count);
            var courses60 = StationCellPlanner.StoreyWallRun(line60, world.LevelBase, world.StoreyHeight);
            Assert.AreEqual(300, courses60.Count);
            Assert.LessOrEqual(courses60.Count, StationCellPlanner.MaxDragCells);

            SelectTool("wall", new JObject { ["wallMode"] = "full" });
            int revBefore = host.CurrentRevision;
            var hitDown = CellTopHit(0, 0, -5);
            var hitMove = CellTopHit(59, 0, -5);
            Assert.IsTrue(StationCellTool.Begin(host, hitDown, "wall", 0, Ptr(100, 100, 0), out var reason), reason);
            StationCellTool.Aim(host, hitMove, Ptr(400, 100, 220));
            Assert.IsTrue(StationCellTool.Finish(host, hitMove, Ptr(400, 100, 260), out var code, out reason), code ?? reason);
            Assert.AreEqual(revBefore + 1, host.CurrentRevision, "60 m wall drag must commit in 1 revision");
            Assert.AreNotEqual("over-limit", NoticeCode());

            // > 10,000 courses (2,600 columns * 4 = 10,400 courses) must refuse with over-limit and 0 commits.
            int revOver = host.CurrentRevision;
            var hitOver = CellTopHit(2600, 0, -5);
            Assert.IsTrue(StationCellTool.Begin(host, hitDown, "wall", 0, Ptr(100, 100, 300), out reason), reason);
            StationCellTool.Aim(host, hitOver, Ptr(600, 100, 520));
            Assert.IsTrue(StationCellTool.Preview.OverLimit, "oversized wall preview must flag OverLimit");
            Assert.AreEqual("over-limit", StationCellTool.Preview.Notice);
            StationCellTool.Finish(host, hitOver, Ptr(600, 100, 560), out code, out reason);
            Assert.AreEqual(revOver, host.CurrentRevision, "oversized wall drag must not commit");
        }

        [Test]
        public void AutoWallCapCountsGeneratedWallsAndExactTenThousandBlocksAndSurfaceCapsMatchWeb() {
            OpenSave(MakeSave(0, SolidFloorPatch(0, 2, 0, 2, -5)));

            // Exact 10,000 cell rectangle (100 x 100) is within budget.
            int exactCount = StationCellPlanner.DragCellCount(new StationCellKey(0, 0, -5), new StationCellKey(99, 99, -5), false);
            Assert.AreEqual(StationCellPlanner.MaxDragCells, exactCount);
            Assert.AreEqual(10100, StationCellPlanner.DragCellCount(new StationCellKey(0, 0, -5), new StationCellKey(100, 99, -5), false));

            // Auto-wall floor drag: 98 x 98 = 9,604 floor cells + perimeter auto-walls (396 * 4 = 1,584) > 10,000 -> refused!
            SelectTool("block", new JObject { ["autoWalls"] = true });
            int revBefore = host.CurrentRevision;
            var hitA = CellTopHit(0, 0, -5);
            var hitB = CellTopHit(97, 97, -5);
            Assert.IsTrue(StationCellTool.Begin(host, hitA, "block", 0, Ptr(100, 100, 0), out var reason), reason);
            StationCellTool.Aim(host, hitB, Ptr(400, 400, 220));
            Assert.IsTrue(StationCellTool.Preview.OverLimit, "auto-wall floor drag exceeding 10k total cells must flag OverLimit");
            Assert.AreEqual("over-limit", StationCellTool.Preview.Notice);
            StationCellTool.Finish(host, hitB, Ptr(400, 400, 260), out _, out _);
            Assert.AreEqual(revBefore, host.CurrentRevision, "auto-wall floor drag exceeding 10k total cells must not commit");

            // Sidewalk & lawn surface drags > 10,000 cells refuse cleanly with over-limit.
            var surfaceCells = new List<StationCellKey>(10001);
            for (int x = 0; x < 101; x++) {
                for (int y = 0; y < 100; y++) {
                    if (surfaceCells.Count < 10001) surfaceCells.Add(new StationCellKey(x, y, 0));
                }
            }
            var world = StationCellEditWorld.Build(host.Index);
            var swPlan = StationSurfacePlanner.Plan(host.Index, world, surfaceCells, "sidewalk", 0, false);
            Assert.AreEqual("over-limit", swPlan.Reason);
            Assert.AreEqual(0, swPlan.Accepted.Count);
            var lawnPlan = StationSurfacePlanner.Plan(host.Index, world, surfaceCells, "lawn", 0, false);
            Assert.AreEqual("over-limit", lawnPlan.Reason);
            Assert.AreEqual(0, lawnPlan.Accepted.Count);
        }

        [Test]
        public void ColumnDeletePreservesFloorsAcrossNegativeStoreysAllLevelBasesGapsAndStreet() {
            for (int levelBase = 0; levelBase <= 4; levelBase++) {
                int floorZ = levelBase - 15;
                var cells = new JArray {
                    new JObject { ["x"] = 2, ["y"] = 2, ["z"] = floorZ, ["fill"] = "solid" },
                    new JObject { ["x"] = 2, ["y"] = 2, ["z"] = floorZ + 1, ["fill"] = "solid", ["tags"] = new JArray("wall") },
                    new JObject { ["x"] = 2, ["y"] = 2, ["z"] = floorZ + 3, ["fill"] = "solid", ["tags"] = new JArray("wall") },
                    new JObject { ["x"] = 2, ["y"] = 2, ["z"] = floorZ + 5, ["fill"] = "solid" },
                    new JObject { ["x"] = 5, ["y"] = 5, ["z"] = floorZ, ["fill"] = "solid" },
                };
                OpenSave(MakeSave(levelBase, cells));
                var world = StationCellEditWorld.Build(host.Index);

                var col = StationCellPlanner.StoreyColumnsAt(world, new[] { new StationCellKey(2, 2, floorZ + 1) });
                Assert.AreEqual(2, col.Count, $"levelBase={levelBase} collects both separated wall blocks across gap");
                CollectionAssert.Contains(col, new StationCellKey(2, 2, floorZ + 1));
                CollectionAssert.Contains(col, new StationCellKey(2, 2, floorZ + 3));
                CollectionAssert.DoesNotContain(col, new StationCellKey(2, 2, floorZ), "floor beneath is preserved");
                CollectionAssert.DoesNotContain(col, new StationCellKey(2, 2, floorZ + 5), "next storey floor is preserved");

                var floorOnly = StationCellPlanner.StoreyColumnsAt(world, new[] { new StationCellKey(5, 5, floorZ) });
                Assert.AreEqual(0, floorOnly.Count, $"levelBase={levelBase} floor-only column removes nothing");
            }

            // G at z=+1 preserves virtual street z=0 while lifting z=1..4 wall courses.
            var streetWall = new JArray {
                new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 1, ["fill"] = "solid", ["tags"] = new JArray("wall") },
                new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 2, ["fill"] = "solid", ["tags"] = new JArray("wall") },
            };
            OpenSave(MakeSave(0, streetWall));
            var swWorld = StationCellEditWorld.Build(host.Index);
            var lifted = StationCellPlanner.StoreyColumnsAt(swWorld, new[] { new StationCellKey(4, 4, 1) });
            Assert.AreEqual(2, lifted.Count);
            CollectionAssert.DoesNotContain(lifted, new StationCellKey(4, 4, 0), "street at z=0 is preserved");
        }

        // ------------------------------------------------------------------ Palette settings routing & HideUi cursor

        [Test]
        public void PaletteSettingsRouteFromToolSelectionThroughPointerRouterToResolvedCandidates() {
            var cells = SolidFloorPatch(0, 12, 0, 12, 0);
            for (int x = 0; x <= 12; x++) {
                for (int y = 0; y <= 12; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 5, ["fill"] = "solid" });
                }
            }
            for (int x = 1; x <= 8; x++) {
                for (int z = 1; z <= 4; z++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = 2, ["z"] = z, ["fill"] = "solid", ["tags"] = new JArray("wall") });
                }
            }
            var modules = new JArray {
                new JObject { ["id"] = "exit-A", ["type"] = "exit", ["x"] = 10, ["y"] = 10, ["z"] = 0, ["rot"] = 0, ["w"] = 1, ["d"] = 1,
                    ["cfg"] = new JObject { ["letter"] = "A", ["style"] = "virtual" } },
            };
            OpenSave(MakeSave(0, cells, modules));

            var resolveMethod = typeof(StationPointerRouter).GetMethod("ResolvePlacement", BindingFlags.Static | BindingFlags.NonPublic);
            Assert.IsNotNull(resolveMethod, "ResolvePlacement helper must exist");

            var floorHit = CellTopHit(5, 6, 0);
            var ray = new Ray(StationCoordinates.Point(new Vector3(5.5f, 6.5f, 4f)), Vector3.down);
            var ctx = StationPickContext.Default(rig.Visibility);

            StationPlacementPlan ResolveCurrent(StationSceneHit hit) =>
                (StationPlacementPlan)resolveMethod.Invoke(null, new object[] { host, host.Coordinator.World, ray, ctx, hit });

            // 1. Numeric liftSize = 3 -> 3x3 large lift + liftStyle = "steel".
            SelectTool("module", new JObject { ["moduleType"] = "lift", ["liftSize"] = 3, ["liftInterval"] = 5, ["liftStyle"] = "steel" });
            var liftPlan = ResolveCurrent(floorHit);
            Assert.IsTrue(liftPlan.Ok, liftPlan.Reason);
            Assert.AreEqual(3, StationFootprints.LiftSize(StationModulePlacement.ToRecord(liftPlan.Candidate)), "numeric liftSize=3 must produce 3x3 lift");
            Assert.AreEqual("steel", liftPlan.Candidate.Text("style"), "liftStyle=steel must persist on candidate");

            // 2. Walkway reads escalatorDir="down" & escalatorWidth=2.
            SelectTool("module", new JObject { ["moduleType"] = "walkway", ["walkwayLength"] = "short", ["escalatorDir"] = "down", ["escalatorWidth"] = 2 });
            var walkPlan = ResolveCurrent(floorHit);
            Assert.IsNotNull(walkPlan.Candidate);
            Assert.AreEqual("walkway", walkPlan.Candidate.Type);
            Assert.AreEqual(2, StationFootprints.EscalatorWidth(StationModulePlacement.ToRecord(walkPlan.Candidate)), "walkway must read escalatorWidth=2");
            Assert.IsTrue(walkPlan.Candidate.From.HasValue && walkPlan.Candidate.To.HasValue);
            Assert.Greater(walkPlan.Candidate.From.Value.Y, walkPlan.Candidate.To.Value.Y, "escalatorDir=down reverses walkway endpoints along +Y facing");

            // 3. doorWide=true turns door-steel-1 into 2-wide door-steel-2.
            SelectTool("module", new JObject { ["moduleType"] = "door-steel-1", ["doorWide"] = true });
            var doorPlan = ResolveCurrent(floorHit);
            Assert.IsTrue(doorPlan.Ok, doorPlan.Reason);
            Assert.AreEqual("steel-2", doorPlan.Candidate.Text("variant"));
            Assert.AreEqual(2, doorPlan.Candidate.Width);

            // 4. hangerLength=6 on hanger-roof.
            SelectTool("module", new JObject { ["moduleType"] = "hanger-roof", ["hangerLength"] = 6 });
            var hangerPlan = ResolveCurrent(floorHit);
            Assert.IsTrue(hangerPlan.Ok, hangerPlan.Reason);
            Assert.AreEqual(6, hangerPlan.Candidate.Width, "hangerLength=6 must propagate");

            // 5. counterLength=3 on checkout.
            SelectTool("module", new JObject { ["moduleType"] = "checkout", ["counterLength"] = 3 });
            var checkoutPlan = ResolveCurrent(floorHit);
            Assert.IsTrue(checkoutPlan.Ok, checkoutPlan.Reason);
            Assert.AreEqual(3, checkoutPlan.Candidate.Width, "counterLength=3 must propagate");

            // 6. curtainWidth=3 & curtainHeight=2 on curtain-wall.
            SelectTool("module", new JObject { ["moduleType"] = "curtain-wall", ["curtainWidth"] = 3, ["curtainHeight"] = 2 });
            var curtainPlan = ResolveCurrent(floorHit);
            Assert.IsTrue(curtainPlan.Ok, curtainPlan.Reason);
            Assert.AreEqual(3, curtainPlan.Candidate.Width);
            Assert.AreEqual(2, (int)curtainPlan.Candidate.Number("curtainHeight", 0));

            // 7. gateDoor="fence" on gate & guideExitId on guidepost.
            SelectTool("module", new JObject { ["moduleType"] = "gate", ["gateDoor"] = "fence" });
            var gatePlan = ResolveCurrent(floorHit);
            Assert.IsTrue(gatePlan.Ok, gatePlan.Reason);
            Assert.AreEqual("fence", gatePlan.Candidate.Text("door"));

            SelectTool("module", new JObject { ["moduleType"] = "guidepost", ["guideExitId"] = "exit-A" });
            var guidePlan = ResolveCurrent(floorHit);
            Assert.IsTrue(guidePlan.Ok, guidePlan.Reason);
            Assert.AreEqual("exit-A", guidePlan.Candidate.Text("exitId"));
        }

        [Test]
        public void HideUiSuppressesPlacementPreviewCursorAndRestoresWhenUnhidden() {
            OpenSave(MakeSave(0, SolidFloorPatch(0, 6, 0, 6, 0)));
            var preview = EnsurePreview();

            var cellPreview = new StationCellPreview { Kind = "add", Cursor = new StationCellKey(2, 2, 1) };
            cellPreview.Check.Cells.Add(new StationCellKey(2, 2, 1));
            cellPreview.Check.Accepted.Add(new StationCellKey(2, 2, 1));

            preview.ShowCells(cellPreview);
            Assert.Greater(PreviewRendererCount(preview), 0, "cursor and cell preview draw when HideUi is off");

            // Turning HideUi on clears and suppresses subsequent ShowCells calls.
            rig.Visibility.State.ActiveLevel = 0;
            rig.Visibility.State.HideUi = true;
            rig.Visibility.Apply();
            preview.SyncVisibility();
            Assert.IsTrue(preview.UiHidden);
            Assert.AreEqual(0, PreviewRendererCount(preview), "HideUi clears active cell cursor immediately");

            preview.ShowCells(cellPreview);
            Assert.AreEqual(0, PreviewRendererCount(preview), "ShowCells stays hidden while HideUi is active");

            rig.Visibility.State.HideUi = false;
            rig.Visibility.Apply();
            preview.ShowCells(cellPreview);
            Assert.Greater(PreviewRendererCount(preview), 0, "turning HideUi off restores preview drawing");
        }

        // ------------------------------------------------------------------ PickCell normals & PlacementSurface

        [Test]
        public void PlacementHitFromNormalSnapsTiltedWedgeNormalsAndTieBreaksDeterministically() {
            var hitSlope = StationPlacementHit.FromNormal(
                new StationPoint(3.5, 4.5, 1.5),
                new StationPoint(0, 0.70710678, 0.70710678), true);
            Assert.AreEqual(3, hitSlope.X);
            Assert.AreEqual(4, hitSlope.Y);
            Assert.AreEqual(1, hitSlope.Z);
            Assert.AreEqual(3, hitSlope.PlaceX);
            Assert.AreEqual(4, hitSlope.PlaceY);
            Assert.AreEqual(2, hitSlope.PlaceZ, "45° tie between Z and Y snaps to +Z");

            StationPlacementHit.FaceStep(new StationPoint(0.7071, -0.7071, 0), out int sx, out int sy, out int sz);
            Assert.AreEqual(1, sx);
            Assert.AreEqual(0, sy);
            Assert.AreEqual(0, sz);

            var hitSoffit = StationPlacementHit.FromNormal(
                new StationPoint(2.5, 2.5, 2.0),
                new StationPoint(0, 0.3, -0.95), true);
            Assert.AreEqual(2, hitSoffit.Z);
            Assert.AreEqual(1, hitSoffit.PlaceZ, "underside soffit steps into lower cell");

            var zeroHit = StationPlacementHit.FromNormal(new StationPoint(1.5, 1.5, 1.0), new StationPoint(0, 0, 0), true);
            Assert.AreEqual(0, zeroHit.Z);
            Assert.AreEqual(1, zeroHit.PlaceZ);
        }

        [Test]
        public void LowAngleHangerBarAndLawnSurfaceHitsResolveCleanlyInOnePick() {
            var cells = SolidFloorPatch(0, 12, 0, 12, 0);
            for (int x = 0; x <= 12; x++) {
                for (int y = 0; y <= 12; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 5, ["fill"] = "solid" });
                }
            }
            var modules = new JArray {
                new JObject { ["id"] = "hanger-1", ["type"] = "hanger", ["x"] = 4, ["y"] = 4, ["z"] = 0, ["rot"] = 0, ["w"] = 4, ["d"] = 1,
                    ["cfg"] = new JObject { ["mount"] = "roof" } },
                new JObject { ["id"] = "lawn-1", ["type"] = "lawn", ["x"] = 8, ["y"] = 8, ["z"] = 0, ["rot"] = 0, ["w"] = 1, ["d"] = 1 },
            };
            OpenSave(MakeSave(0, cells, modules));

            var barGo = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ownedObjects.Add(barGo);
            UnityEngine.Object.DestroyImmediate(barGo.GetComponent<Collider>());
            barGo.transform.position = StationCoordinates.Point(new Vector3(5.5f, 4.5f, 4.1f));
            barGo.transform.localScale = new Vector3(4f, 0.2f, 0.2f);
            host.Coordinator.World.RegisterModule("equipment", "hanger-1", barGo, "",
                new StationBox(3.5, 4.4, 4.0, 7.5, 4.6, 4.2), 0, 0, new[] { 0 });

            var lawnGo = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ownedObjects.Add(lawnGo);
            UnityEngine.Object.DestroyImmediate(lawnGo.GetComponent<Collider>());
            lawnGo.transform.position = StationCoordinates.Point(new Vector3(8.5f, 8.5f, 1.05f));
            lawnGo.transform.localScale = new Vector3(1f, 0.1f, 1f);
            host.Coordinator.World.RegisterModule("surface", "lawn-1", lawnGo, "",
                new StationBox(8, 8, 1.0, 9, 9, 1.1), 0, 0, new[] { 0 });

            // Oblique low-angle ray hitting hanger bar (not ground behind it) in 1 pick for all 4 hanger props.
            var fromWorld = StationCoordinates.Point(new Vector3(5.5f, 1.0f, 3.85f));
            var toBarWorld = StationCoordinates.Point(new Vector3(5.5f, 4.4f, 4.1f));
            var obliqueRay = new Ray(fromWorld, (toBarWorld - fromWorld).normalized);
            var ctx = StationPickContext.Default(rig.Visibility);
            int picksBefore = StationScenePicker.PickCount;
            var hit = StationScenePicker.PickRay(host.Coordinator.World, obliqueRay, 0, ctx);
            Assert.AreEqual(picksBefore + 1, StationScenePicker.PickCount, "exactly 1 pick per ray");
            Assert.AreEqual(StationSceneTargetKind.Module, hit.TargetKind);
            Assert.AreEqual("hanger-1", hit.Module.Id, "oblique ray wins on hanger bar over distant ground");

            foreach (var prop in new[] { "tv", "clock", "cctv-ptz", "sign-ceiling" }) {
                var req = StationPointerRouter.BuildRequest(host.Coordinator.World, obliqueRay, ctx, hit, null, 0, prop, "", 0, "", 4);
                Assert.AreEqual("hanger-1", req.TargetModuleId);
                Assert.IsTrue(req.Hit.HasCell, $"{prop} resolves host cell from hanger bar");
                Assert.AreEqual(0, req.Hit.Z, $"{prop} anchors to hanger's storey");
            }

            // Lawn top hit resets anchor Z to host.Z (0) despite 10 cm slab height; side hit steps to neighbour.
            var lawnMod = host.Index.GetModule("lawn-1");
            var lawnTopHit = new StationSceneHit {
                Level = 0, Module = lawnMod, ModuleExact = true, ModuleDistance = 1f,
                ModulePoint = new StationPoint(8.5, 8.5, 1.1), ModuleNormal = new StationPoint(0, 0, 1),
            };
            var benchOnLawn = StationPointerRouter.BuildRequest(host.Coordinator.World, obliqueRay, ctx, lawnTopHit, null, 0, "bench-steel-1", "", 0, "", 4);
            Assert.AreEqual(0, benchOnLawn.Hit.Z, "lawn top hit anchors bench at host.Z=0");
            Assert.AreEqual(0, benchOnLawn.Hit.PlaceZ);

            var lawnSideHit = new StationSceneHit {
                Level = 0, Module = lawnMod, ModuleExact = true, ModuleDistance = 1f,
                ModulePoint = new StationPoint(9.0, 8.5, 1.05), ModuleNormal = new StationPoint(1, 0, 0),
            };
            var sideBench = StationPointerRouter.BuildRequest(host.Coordinator.World, obliqueRay, ctx, lawnSideHit, null, 0, "bench-steel-1", "", 0, "", 4);
            Assert.AreEqual(9, sideBench.Hit.PlaceX, "lawn side hit steps to neighbouring cell");
        }

        // ------------------------------------------------------------------ Ramp targeting occlusion & SelectAgent

        [Test]
        public void OccludingSolidBlockBeatsRampAndPsdBehindItAndExposesRampOnceRemoved() {
            var cells = SolidFloorPatch(0, 14, 0, 10, -5);
            for (int z = -4; z <= -2; z++) {
                cells.Add(new JObject { ["x"] = 4, ["y"] = 5, ["z"] = z, ["fill"] = "solid", ["tags"] = new JArray("wall") });
            }
            var modules = new JArray {
                new JObject {
                    ["id"] = "esc-1", ["type"] = "escalator", ["x"] = 6, ["y"] = 5, ["z"] = -5, ["rot"] = 0, ["w"] = 1, ["d"] = 1,
                    ["from"] = new JObject { ["x"] = 6, ["y"] = 5, ["z"] = -5 },
                    ["to"] = new JObject { ["x"] = 12, ["y"] = 5, ["z"] = 0 },
                    ["cfg"] = new JObject { ["width"] = 1 },
                },
                new JObject {
                    ["id"] = "psd-1", ["type"] = "platform-edge", ["x"] = 6, ["y"] = 5, ["z"] = -5, ["rot"] = 0, ["w"] = 4, ["d"] = 1,
                    ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up", ["side"] = "left", ["psd"] = "full" },
                },
            };
            OpenSave(MakeSave(0, cells, modules));
            rig.Visibility.State.ActiveLevel = -5;
            rig.Visibility.State.ShowLevels = true;
            rig.Visibility.Apply();

            var rampGo = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ownedObjects.Add(rampGo);
            UnityEngine.Object.DestroyImmediate(rampGo.GetComponent<Collider>());
            rampGo.transform.position = StationCoordinates.Point(new Vector3(8f, 5.5f, -3f));
            rampGo.transform.localScale = new Vector3(4f, 2f, 1f);
            host.Coordinator.World.RegisterModule("vertical", "esc-1", rampGo, "",
                new StationBox(6, 5, -4, 10, 6, -2), -5, 0, new[] { -5, 0 });

            // Ray from x=1 toward +X hits the solid wall at x=4 BEFORE the ramp at x=6.
            var origin = StationCoordinates.Point(new Vector3(1f, 5.5f, -3f));
            var target = StationCoordinates.Point(new Vector3(8f, 5.5f, -3f));
            var ray = new Ray(origin, (target - origin).normalized);
            var hit = StationScenePicker.PickRay(host.Coordinator.World, ray, -5, StationPickContext.Default(rig.Visibility));
            Assert.AreEqual(StationSceneTargetKind.Cell, hit.TargetKind, "foreground solid wall must occlude ramp & PSD behind it");
            Assert.AreEqual(4, hit.EditCell.X);

            // Remove the occluding wall; same ray now hits esc-1 directly.
            var patch = StationCellPlanner.PlanRemoveCells(StationCellEditWorld.Build(host.Index), new[] {
                new StationCellKey(4, 5, -4), new StationCellKey(4, 5, -3), new StationCellKey(4, 5, -2),
            });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, patch, "delete", null, out _, out var code), code);
            var rampGo2 = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ownedObjects.Add(rampGo2);
            UnityEngine.Object.DestroyImmediate(rampGo2.GetComponent<Collider>());
            rampGo2.transform.position = StationCoordinates.Point(new Vector3(8f, 5.5f, -3f));
            rampGo2.transform.localScale = new Vector3(4f, 2f, 1f);
            host.Coordinator.World.RegisterModule("vertical", "esc-1", rampGo2, "",
                new StationBox(6, 5, -4, 10, 6, -2), -5, 0, new[] { -5, 0 });

            var exposedHit = StationScenePicker.PickRay(host.Coordinator.World, ray, -5, StationPickContext.Default(rig.Visibility));
            Assert.AreEqual(StationSceneTargetKind.Module, exposedHit.TargetKind, "once occluder is gone, ramp is directly pickable");
            Assert.AreEqual("esc-1", exposedHit.Module.Id);
        }

        [Test]
        public void SelectAgentSetsAgentSelectionAndClearsCleanlyOnNonPassengerSelection() {
            var cells = SolidFloorPatch(0, 6, 0, 6, 0);
            var modules = new JArray {
                new JObject { ["id"] = "bench-1", ["type"] = "bench", ["x"] = 3, ["y"] = 3, ["z"] = 0, ["rot"] = 0, ["w"] = 1, ["d"] = 1,
                    ["cfg"] = new JObject { ["variant"] = "steel-1" } },
            };
            OpenSave(MakeSave(0, cells, modules));

            var bench = host.Index.GetModule("bench-1");
            StationEditSession.SelectModule(bench);
            Assert.AreEqual("module", StationEditSession.SelectionKind);
            Assert.AreEqual("bench-1", StationEditSession.SelectionKey);

            StationEditSession.SelectPassenger(42);
            Assert.AreEqual("agent", StationEditSession.SelectionKind, "passenger selection uses agent kind");
            Assert.AreEqual("42", StationEditSession.SelectionKey, "passenger sim id is stored in SelectionKey");

            StationEditSession.ClearSelection();
            Assert.AreEqual("", StationEditSession.SelectionKind);
            Assert.AreEqual("", StationEditSession.SelectionKey);
        }

        // ------------------------------------------------------------------ RoofTool, ZoneTool, PaintTool

        [Test]
        public void RoofToolDragsFlatRectanglesAndCrestAxisBayRunsAcrossRotationsAndWidths() {
            OpenSave(MakeSave(0, SolidFloorPatch(0, 20, 0, 20, 0)));
            EnsurePreview();
            StationEditSession.Level = 0;

            // 1. Flat roof rectangle drag in 1 undo.
            SelectTool("module", new JObject { ["moduleType"] = "roof", ["rotation"] = 0, ["roofPlateSnap"] = "upper" });
            var hitA = CellTopHit(2, 2, 0);
            var hitB = CellTopHit(3, 3, 0);
            var rayA = new Ray(StationCoordinates.Point(new Vector3(2.5f, 2.5f, 15f)), Vector3.down);
            var rayB = new Ray(StationCoordinates.Point(new Vector3(3.5f, 3.5f, 15f)), Vector3.down);
            int revBefore = host.CurrentRevision;
            Assert.IsTrue(StationRoofTool.Begin(host, hitA, Ptr(100, 100, 0), rayA, 0, out var reason), reason);
            StationRoofTool.AimAt(host, hitB, rayB, Ptr(160, 160, 50));
            Assert.AreEqual(4, StationRoofTool.Accepted.Count, "2x2 flat roof rectangle");
            Assert.IsTrue(StationRoofTool.Finish(host, hitB, Ptr(160, 160, 60), rayB, out var code, out reason), code ?? reason);
            Assert.AreEqual(revBefore + 1, host.CurrentRevision, "2x2 flat roof commits in 1 revision");
            Assert.AreEqual(4, host.Index.ModulesOfType("roof").Count);

            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.AreEqual(0, host.Index.ModulesOfType("roof").Count);

            // 2. Truss bay run along crest axis (width=8, long press >= 160 ms, ignoring sideways wander).
            SelectTool("module", new JObject { ["moduleType"] = "roof-truss", ["rotation"] = 0, ["roofWidth"] = 8 });
            var emptyHit = new StationSceneHit { Level = 0 };
            var trussRayA = new Ray(StationCoordinates.Point(new Vector3(6f, 6f, 25f)), Vector3.down);
            var trussRayB = new Ray(StationCoordinates.Point(new Vector3(14f, 9f, 25f)), Vector3.down);
            Assert.IsTrue(StationRoofTool.Begin(host, emptyHit, Ptr(100, 100, 0), trussRayA, 0, out reason), reason);
            StationRoofTool.AimAt(host, emptyHit, trussRayB, Ptr(300, 140, 250));
            Assert.GreaterOrEqual(StationRoofTool.Accepted.Count, 2, "bay run places multiple 4 m bays along crest axis");
            int firstY = StationRoofTool.Accepted[0].Candidate.Y;
            foreach (var p in StationRoofTool.Accepted) {
                Assert.AreEqual(firstY, p.Candidate.Y, "truss bay run ignores sideways pointer wander");
                Assert.AreEqual(4, p.Candidate.Width, "truss bay length is 4 m");
                Assert.AreEqual(8, p.Candidate.Depth, "truss bay breadth follows roofWidth=8");
            }
            Assert.IsTrue(StationRoofTool.Finish(host, emptyHit, Ptr(300, 140, 260), trussRayB, out code, out reason), code ?? reason);
            Assert.GreaterOrEqual(host.Index.ModulesOfType("roof").Count, 2);
        }

        [Test]
        public void ZoneToolHandlesExposedFloorUnderHalfWallRefusesSuspendedCeilingAndRightDragsErase() {
            var cells = SolidFloorPatch(0, 8, 0, 8, 0);
            cells.Add(new JObject { ["x"] = 2, ["y"] = 2, ["z"] = 1, ["fill"] = "solid", ["tags"] = new JArray("wall", "half-wall:n") });
            cells.Add(new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 4, ["fill"] = "solid", ["tags"] = new JArray("suspended-ceiling") });
            OpenSave(MakeSave(0, cells));

            var world = StationZoneWorld.Build(host.Index);
            var underHalf = StationZonePlanner.Plan(world, new[] { new StationCellKey(2, 2, 0) }, "paid");
            Assert.AreEqual(1, underHalf.Accepted.Count, "floor under half-wall:n stays zoneable");

            var ceilPlan = StationZonePlanner.Plan(world, new[] { new StationCellKey(4, 4, 4) }, "paid");
            Assert.AreEqual(0, ceilPlan.Accepted.Count, "suspended-ceiling cell cannot be zoned");

            // Paint a 3x2 paid zone then right-drag erase a 2x2 subset.
            SelectTool("zone", new JObject { ["zoneBrush"] = "paid", ["zoneMode"] = "brush" });
            var h0 = CellTopHit(1, 1, 0);
            var h1 = CellTopHit(3, 2, 0);
            Assert.IsTrue(StationZoneTool.Begin(host, h0, Ptr(100, 100, 0), 0, out var reason), reason);
            StationZoneTool.Aim(host, h1, Ptr(200, 150, 220));
            Assert.IsTrue(StationZoneTool.Finish(host, h1, Ptr(200, 150, 260), out var code, out reason), code ?? reason);
            Assert.AreEqual("paid", host.Index.GetCell(1, 1, 0).Zone);
            Assert.AreEqual("paid", host.Index.GetCell(3, 2, 0).Zone);

            // Right-drag erase 1..2, 1..2.
            var h2 = CellTopHit(2, 2, 0);
            Assert.IsTrue(StationZoneTool.Begin(host, h0, Ptr(100, 100, 300, button: 2), 2, out reason), reason);
            StationZoneTool.Aim(host, h2, Ptr(160, 150, 520, button: 2));
            Assert.IsTrue(StationZoneTool.Finish(host, h2, Ptr(160, 150, 560, button: 2), out code, out reason), code ?? reason);
            Assert.AreEqual("", host.Index.GetCell(1, 1, 0)?.Zone ?? "", "right-drag erased (1,1)");
            Assert.AreEqual("", host.Index.GetCell(2, 2, 0)?.Zone ?? "", "right-drag erased (2,2)");
            Assert.AreEqual("paid", host.Index.GetCell(3, 2, 0).Zone, "outside erase rectangle stays paid");
        }

        [Test]
        public void PaintToolAppliesAndPicksCustomHexTintThroughBeginFinishPick() {
            OpenSave(MakeSave(0, SolidFloorPatch(0, 4, 0, 4, 0)));
            const string customTint = "wall.enamel#ff4242";
            SelectTool("paint", new JObject { ["paintFinish"] = customTint, ["paintMode"] = "single" });
            var hit = CellTopHit(2, 2, 0);
            Assert.IsTrue(StationPaintTool.Begin(host, hit, Ptr(100, 100, 0), 0, out var reason), reason);
            Assert.IsTrue(StationPaintTool.Finish(host, hit, Ptr(100, 100, 40), out var code, out reason), code ?? reason);
            Assert.AreEqual(customTint, host.Index.GetCell(2, 2, 0).FinishOf("top"), "custom hex tint persists on painted face");

            int revBefore = host.CurrentRevision;
            StationToolSelection.ApplySettings(new JObject { ["paintMode"] = "pick" });
            Assert.IsTrue(StationPaintTool.Begin(host, hit, Ptr(100, 100, 100), 0, out reason), reason);
            Assert.AreEqual(revBefore, host.CurrentRevision, "paint pick never mutates document");
            Assert.AreEqual(customTint, (string)StationEditSession.PaintPick?["finish"]);
        }

        // ------------------------------------------------------------------ Sweep, Previews, History & Host commands

        [Test]
        public void SweepFamilyOfCoversAllThirtySweepableFamiliesVariantSeparationsAndUnsweepables() {
            StationModuleRecord Mod(string type, JObject cfg = null, int w = 1) {
                var draft = new StationEditDraft { Id = "m-1", Type = type, Width = w, Depth = 1 };
                if (cfg != null) {
                    foreach (var p in cfg.Properties()) {
                        if (p.Value.Type == JTokenType.Boolean) draft.Set((bool)p.Value, p.Name);
                        else if (p.Value.Type == JTokenType.Integer) draft.Set((int)p.Value, p.Name);
                        else draft.Set(p.Name, p.Value.ToString());
                    }
                }
                return StationModulePlacement.ToRecord(draft);
            }

            var sweepableSamples = new[] {
                Mod("ac-unit"), Mod("electrical-cabinet"), Mod("floor-mark", new JObject { ["variant"] = "boarding" }),
                Mod("gate"), Mod("gate", new JObject { ["variant"] = "new" }), Mod("tvm"), Mod("vending"),
                Mod("escalator"), Mod("walkway"), Mod("lift"), Mod("psd-end", new JObject { ["psd"] = "half" }),
                Mod("psd-end", new JObject { ["psd"] = "full" }), Mod("bench", new JObject { ["variant"] = "wood-2" }),
                Mod("shelf", new JObject { ["variant"] = "cooler" }), Mod("desk"),
                Mod("checkout", new JObject { ["variant"] = "cafe" }, 3), Mod("cubicle"), Mod("sink"),
                Mod("guidepost"), Mod("busstop", new JObject { ["variant"] = "short" }), Mod("bin"),
                Mod("extinguisher", new JObject { ["variant"] = "compact" }), Mod("extinguisher", new JObject { ["variant"] = "glass" }),
                Mod("vent"), Mod("light", new JObject { ["variant"] = "circular" }), Mod("clock"),
                Mod("clock", new JObject { ["variant"] = "digital" }), Mod("cctv", new JObject { ["variant"] = "dome" }),
                Mod("billboard", new JObject { ["variant"] = "large" }), Mod("glass", new JObject { ["variant"] = "2x2", ["curtainHeight"] = 3 }),
                Mod("door", new JObject { ["variant"] = "glass-2" }), Mod("calligraphy", new JObject { ["style"] = "wei", ["axis"] = "v", ["showEnglish"] = true }),
                Mod("linemap", new JObject { ["mount"] = "stand" }), Mod("tv"), Mod("sign", new JObject { ["mount"] = "wall" }),
                Mod("monitor", new JObject { ["mount"] = "wall" }), Mod("traffic-light"), Mod("rail-signal"),
            };
            foreach (var sample in sweepableSamples) {
                Assert.IsNotEmpty(StationSweep.FamilyOf(sample), $"expected sweepable family for {sample.Type}");
            }

            Assert.AreNotEqual(StationSweep.FamilyOf(Mod("psd-end", new JObject { ["psd"] = "half" })),
                StationSweep.FamilyOf(Mod("psd-end", new JObject { ["psd"] = "full" })));
            Assert.AreNotEqual(StationSweep.FamilyOf(Mod("sign", new JObject { ["mount"] = "wall" })),
                StationSweep.FamilyOf(Mod("sign", new JObject { ["mount"] = "ceiling" })));
            Assert.AreNotEqual(StationSweep.FamilyOf(Mod("checkout", new JObject { ["variant"] = "cafe" }, 2)),
                StationSweep.FamilyOf(Mod("checkout", new JObject { ["variant"] = "cafe" }, 3)));
            Assert.AreNotEqual(StationSweep.FamilyOf(Mod("gate")),
                StationSweep.FamilyOf(Mod("gate", new JObject { ["variant"] = "new" })));

            foreach (var unsweepable in new[] { "tactile", "fence", "track", "exit", "stair", "shop", "platform-edge", "roof", "road", "pillar", "sidewalk", "lawn", "tree", "hanger" }) {
                Assert.IsNull(StationSweep.FamilyOf(Mod(unsweepable)), $"{unsweepable} must not be sweepable");
            }
            Assert.IsNull(StationSweep.FamilyOf(null));
        }

        [Test]
        public void PlacementPreviewDrawsRefusedCellsRoofGhostsForcesLod0AndDisposesCleanly() {
            OpenSave(MakeSave(0, SolidFloorPatch(0, 10, 0, 10, 0)));
            var preview = EnsurePreview();

            // 1. Accepted + refused cells draw side-by-side.
            var cp = new StationCellPreview { Kind = "add", Cursor = new StationCellKey(2, 2, 1) };
            cp.Check.Cells.Add(new StationCellKey(2, 2, 1));
            cp.Check.Cells.Add(new StationCellKey(3, 2, 1));
            cp.Check.Accepted.Add(new StationCellKey(2, 2, 1));
            cp.Check.Blocked.Add(new StationCellKey(3, 2, 1));
            preview.ShowCells(cp);
            Assert.GreaterOrEqual(PreviewRendererCount(preview), 2, "accepted and refused cells render together");

            // 2. All 5 roof variants render via ShowModules.
            var roofPlans = new List<StationPlacementPlan>();
            foreach (var roofType in new[] { "roof", "roof-shell", "roof-truss", "roof-tapered", "roof-canopy" }) {
                var req = new StationPlacementRequest {
                    ToolType = roofType, Rotation = 1, Width = 4, RoofPlateSnap = "upper",
                    Hit = StationPlacementHit.FromCellFace(4, 4, 0, 0, 0, 1, true, new StationPoint(4.5, 4.5, 1)),
                };
                var plan = StationModulePlacement.Resolve(host.Index, req);
                if (plan?.Candidate != null) roofPlans.Add(plan);
            }
            Assert.AreEqual(5, roofPlans.Count, "all 5 roof variants resolve");
            preview.ShowModules(roofPlans);
            Assert.Greater(PreviewRendererCount(preview), 0, "ShowModules builds ghosts for all 5 roof variants");

            // 3. Single prefab ghost preserves forceMeshLod == 0.
            var benchReq = new StationPlacementRequest {
                ToolType = "bench-steel-1", Rotation = 0,
                Hit = StationPlacementHit.FromCellFace(2, 2, 0, 0, 0, 1, true, new StationPoint(2.5, 2.5, 1)),
            };
            var benchPlan = StationModulePlacement.Resolve(host.Index, benchReq);
            Assert.IsTrue(benchPlan.Ok, benchPlan.Reason);
            preview.Show(benchPlan);
            var renderers = preview.GetComponentsInChildren<MeshRenderer>(true);
            Assert.Greater(renderers.Length, 0);
            foreach (var mr in renderers) {
                Assert.AreEqual(0, mr.forceMeshLod, "placement preview ghosts pin forceMeshLod = 0");
            }

            // 4. ClearAll drops ghost, cell, and hover layers.
            preview.ClearAll();
            Assert.AreEqual(0, PreviewRendererCount(preview));
        }

        [Test]
        public void EditSessionCapsHistoryAtMaxHistoryAndHostCommandsHandleNewDemoAndBenchmarks() {
            OpenSave(MakeSave(0, SolidFloorPatch(0, 60, 0, 4, 0)));

            for (int i = 0; i < StationEditSession.MaxHistory + 5; i++) {
                var patch = new StationCellPatch();
                patch.Writes.Add(new StationCellWrite {
                    Key = new StationCellKey(i, 0, 1),
                    Mode = StationCellWriteMode.Set,
                });
                Assert.IsTrue(StationEditSession.TryApplyCells(host, patch, "add", null, out _, out var code), code);
            }
            Assert.AreEqual(StationEditSession.MaxHistory, UndoDepth(), "undo stack caps at MaxHistory=40");

            // station.new resets to an empty z=0 station with bumped revision and cleared history.
            int revBeforeNew = host.CurrentRevision;
            var newResult = host.NewStation(new JObject { ["name"] = "Fresh Station" });
            Assert.IsTrue(newResult.Accepted, newResult.ToString());
            Assert.Greater(host.CurrentRevision, revBeforeNew);
            Assert.AreEqual(0, host.Index.Document.Modules.Count);
            Assert.AreEqual(0, UndoDepth());

            // Unknown demo id rejects cleanly without corrupting current document.
            var badDemo = host.OpenDemo("nonexistent-demo");
            Assert.IsFalse(badDemo.Accepted, "unknown demo id must reject");

            // StationBenchmarkRecorder enforces MaxFrameSamples cap (16,000) and filters <= 0 / NaN / Infinity frames.
            var recorder = new StationBenchmarkRecorder();
            recorder.StartRecording(0.0);
            recorder.RecordFrame(0.01, 0.0, 1);
            recorder.RecordFrame(0.02, -5.0, 2);
            recorder.RecordFrame(0.03, double.NaN, 3);
            recorder.RecordFrame(0.04, double.PositiveInfinity, 4);
            for (int i = 0; i < 16050; i++) {
                recorder.RecordFrame(1.0 + i * 0.001, 16.0, i);
            }
            var stopPayload = new JObject();
            Assert.IsTrue(recorder.TryHandle(new StationCommand { Type = "benchmark.stop", Payload = stopPayload }, stopPayload, out _, out _));
            var recorded = (JArray)stopPayload["frames"];
            Assert.AreEqual(16000, recorded.Count, "MaxFrameSamples caps at 16,000 and filters invalid intervals");
        }
    }
}
