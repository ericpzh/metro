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
    /// Regression suite enforcing a single deletion preview highlight across every Unity removal
    /// path, matching the right-click equipment removal highlight:
    /// translucent red surface overlay (<c>edit remove fill</c>) + padded red wireframe bounding
    /// box (<c>edit cell blocker</c>) + zero stray floor cursor square underneath modules.
    ///
    /// Covers:
    /// 1. Equipment right-click / right-drag vs Delete tool hover &amp; sweep-drag on fare gates
    ///    (including contact-shadow overlays).
    /// 2. Fence right-drag vs Delete tool hover &amp; line-erase (<c>BeginRunErase</c>).
    /// 3. Roof right-click/drag vs Delete tool hover &amp; press/drag (<c>StationRoofTool</c>).
    /// 4. Outdoor surface (<c>sidewalk</c>) right-click/drag vs Delete tool hover.
    /// 5. Road (unsplit &amp; split segment) right-click vs Delete tool hover &amp; press, plus
    ///    direct <c>StationRoadView.ShowPreview</c> delete colour.
    /// 6. Solid block erase hover/drag (Delete tool &amp; Block right-drag) including hosted
    ///    module removal highlight.
    /// </summary>
    public sealed class StationDeletePreviewParityTests {
        GameObject hostObject;
        GameObject cameraObject;
        StationGameHost host;
        StationViewRig rig;
        Camera camera;
        RuntimeCatalogue catalogue;

        readonly struct HighlightSnapshot {
            public readonly Dictionary<string, int> SurfaceOverlayCounts;
            public readonly List<Bounds> OutlineBoxes;
            public readonly int CursorBoxCount;
            public readonly int RemoveFillBoxCount;
            public readonly int OtherPreviewBoxCount;
            public readonly int GhostMeshCount;
            public readonly bool EraseBatchActive;
            public readonly int EraseBatchTriangles;

            public HighlightSnapshot(
                Dictionary<string, int> surfaceOverlayCounts,
                List<Bounds> outlineBoxes,
                int cursorBoxCount,
                int removeFillBoxCount,
                int otherPreviewBoxCount,
                int ghostMeshCount,
                bool eraseBatchActive,
                int eraseBatchTriangles) {
                SurfaceOverlayCounts = surfaceOverlayCounts;
                OutlineBoxes = outlineBoxes;
                CursorBoxCount = cursorBoxCount;
                RemoveFillBoxCount = removeFillBoxCount;
                OtherPreviewBoxCount = otherPreviewBoxCount;
                GhostMeshCount = ghostMeshCount;
                EraseBatchActive = eraseBatchActive;
                EraseBatchTriangles = eraseBatchTriangles;
            }
        }

        [SetUp]
        public void SetUp() {
            ResetStatics();
            catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "RuntimeCatalogue missing at " + RuntimeCatalogue.AssetPath);

            hostObject = new GameObject(StationGameHost.ObjectName);
            cameraObject = new GameObject("delete-preview-parity-camera");
            camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 18f;
            camera.nearClipPlane = 0.5f;
            camera.farClipPlane = 400f;

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
            host.Coordinator.RegisterRenderer(new StationSurfaceModuleRenderer());
            host.Coordinator.RegisterRenderer(new OpeningModuleRenderer());
            host.Coordinator.RegisterRenderer(new StationRoadRenderer());
            host.Coordinator.RegisterRenderer(new StationContactShadowRenderer());
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
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            StationCellTool.Reset();
            StationPillarTool.Reset();
            StationRoofTool.Reset();
            StationSurfaceTool.Reset();
            StationZoneTool.Reset();
            StationPaintTool.Reset();
            StationRailTool.Reset();
            StationTunnelTool.Reset();
            StationRoadTool.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
            StationEditHost.ResetForTests();
        }

        void OpenFixture(int level, JArray cells, JArray modules) {
            var envelope = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "delete preview parity",
                ["city"] = "guangzhou",
                ["seed"] = 13,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = cells,
                    ["modules"] = modules,
                    ["lines"] = new JArray(),
                },
            }.ToString(Newtonsoft.Json.Formatting.None);

            var opened = host.OpenDocument(envelope, "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            rig = StationViewFeature.Attach(host);
            StationEditFeature.Attach(host);
            Exec("camera.snap", new JObject { ["face"] = "top", ["ortho"] = true });
            Exec("camera.zoom", new JObject { ["factor"] = 3 });
            Exec("view.set", new JObject { ["key"] = "level", ["value"] = level });
            Exec("view.set", new JObject { ["key"] = "ground", ["value"] = level < 0 });
            rig.Tick(0f);
            host.SetActiveLevel(rig.Visibility.State.ActiveLevel);
        }

        static JArray FloorSlab(int x0, int x1, int y0, int y1, int z) {
            var cells = new JArray();
            for (int x = x0; x <= x1; x++) {
                for (int y = y0; y <= y1; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid" });
                }
            }
            return cells;
        }

        void AimTopDown(float centerX, float centerY, float orthoSize = 14f) {
            camera.orthographic = true;
            camera.orthographicSize = orthoSize;
            camera.transform.SetPositionAndRotation(
                StationCoordinates.Point(new Vector3(centerX, centerY, 35f)),
                Quaternion.Euler(90f, 0f, 0f));
            Physics.SyncTransforms();
        }

        [Test]
        public void DeleteToolHoverAndSweepMatchRightClickOnGatesFencesRoofsAndBlocks() {
            const int z = -5;
            var cells = FloorSlab(0, 15, 0, 11, z);
            var modules = new JArray {
                new JObject {
                    ["id"] = "gate-a", ["type"] = "gate", ["x"] = 4, ["y"] = 5, ["z"] = z, ["rot"] = 0,
                    ["cfg"] = new JObject { ["door"] = "fence" },
                },
                new JObject {
                    ["id"] = "gate-b", ["type"] = "gate", ["x"] = 6, ["y"] = 5, ["z"] = z, ["rot"] = 0,
                    ["cfg"] = new JObject { ["door"] = "fence" },
                },
                new JObject {
                    ["id"] = "fence-a", ["type"] = "fence", ["x"] = 2, ["y"] = 3, ["z"] = z, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "glass" },
                },
                new JObject {
                    ["id"] = "fence-b", ["type"] = "fence", ["x"] = 3, ["y"] = 3, ["z"] = z, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "glass" },
                },
                new JObject {
                    ["id"] = "roof-a", ["type"] = "roof", ["x"] = 10, ["y"] = 5, ["z"] = z, ["rot"] = 0,
                    ["w"] = 1, ["d"] = 1, ["cfg"] = new JObject(),
                },
                new JObject {
                    ["id"] = "bin-hosted", ["type"] = "bin", ["x"] = 12, ["y"] = 8, ["z"] = z, ["rot"] = 0,
                },
            };
            OpenFixture(z, cells, modules);
            AimTopDown(7.5f, 5.5f, 12f);
            var editHost = StationEditHost.Ensure();
            int revBefore = host.CurrentRevision;

            // 1. Baseline: Equipment right-click on gate-a and right-drag across gate-a & gate-b.
            ArmTool("module", new JObject { ["moduleType"] = "gate", ["gateDoor"] = "fence" });
            Assert.IsTrue(Handle("pointer.down", PointerAtModule("gate-a", button: 2, buttons: 2, timeMs: 1000)));
            var rightSingleGate = Capture(editHost.Preview);
            AssertModuleRemoveHighlight(rightSingleGate, new[] { "gate-a" }, "right-click single gate");

            Assert.IsTrue(Handle("pointer.move", PointerAtModule("gate-b", button: -1, buttons: 2, timeMs: 1300)));
            var rightPairGates = Capture(editHost.Preview);
            AssertModuleRemoveHighlight(rightPairGates, new[] { "gate-a", "gate-b" }, "right-drag two gates");
            Assert.IsTrue(Handle("pointer.cancel", new JObject()));

            // 2. Delete tool HOVER on gate-a must match right-click single gate exactly (same overlays, same box, 0 cursors).
            ArmTool("delete");
            Assert.IsTrue(Handle("pointer.move", PointerAtModule("gate-a", button: -1, buttons: 0, timeMs: 2000)));
            var deleteHoverGate = Capture(editHost.Preview);
            AssertSnapshotsMatch(rightSingleGate, deleteHoverGate, "Delete tool hover vs right-click on gate-a");

            // 3. Delete tool PRESS + SWEEP across gate-a & gate-b must match right-drag two gates exactly.
            Assert.IsTrue(Handle("pointer.down", PointerAtModule("gate-a", button: 0, buttons: 1, timeMs: 2100)));
            var deletePressGate = Capture(editHost.Preview);
            AssertSnapshotsMatch(rightSingleGate, deletePressGate, "Delete tool press vs right-click on gate-a");

            Assert.IsTrue(Handle("pointer.move", PointerAtModule("gate-b", button: -1, buttons: 1, timeMs: 2400)));
            var deleteSweepGates = Capture(editHost.Preview);
            AssertSnapshotsMatch(rightPairGates, deleteSweepGates, "Delete tool sweep vs right-drag on gate-a & gate-b");
            Assert.IsTrue(Handle("pointer.cancel", new JObject()));
            AssertClean(editHost.Preview, "after cancelling delete gate sweep");

            // 4. Fence right-drag remove vs Delete tool hover vs Delete tool line-erase (`BeginRunErase`).
            ArmTool("module", new JObject { ["moduleType"] = "fence", ["rotation"] = 0 });
            Assert.IsTrue(Handle("pointer.down", PointerAtModule("fence-a", button: 2, buttons: 2, timeMs: 3000)));
            Assert.IsTrue(Handle("pointer.move", PointerAtModule("fence-b", button: -1, buttons: 2, timeMs: 3300)));
            var rightFenceRun = Capture(editHost.Preview);
            AssertModuleRemoveHighlight(rightFenceRun, new[] { "fence-a", "fence-b" }, "fence right-drag remove");
            Assert.IsTrue(Handle("pointer.cancel", new JObject()));

            ArmTool("delete");
            Assert.IsTrue(Handle("pointer.move", PointerAtModule("fence-a", button: -1, buttons: 0, timeMs: 3400)));
            var deleteHoverFence = Capture(editHost.Preview);
            AssertModuleRemoveHighlight(deleteHoverFence, new[] { "fence-a" }, "Delete tool hover on fence-a");

            Assert.IsTrue(Handle("pointer.down", PointerAtModule("fence-a", button: 0, buttons: 1, timeMs: 3500)));
            Assert.IsTrue(Handle("pointer.move", PointerAtModule("fence-b", button: -1, buttons: 1, timeMs: 3800)));
            var deleteDragFence = Capture(editHost.Preview);
            AssertSnapshotsMatch(rightFenceRun, deleteDragFence, "Delete tool fence line-erase vs fence right-drag");
            Assert.IsTrue(Handle("pointer.cancel", new JObject()));

            // 5. Roof right-click remove vs Delete tool hover vs Delete tool press (`StationRoofTool` remove).
            ArmTool("module", new JObject { ["moduleType"] = "roof", ["rotation"] = 0 });
            Assert.IsTrue(Handle("pointer.down", PointerAtModule("roof-a", button: 2, buttons: 2, timeMs: 4000)));
            var rightRoofRemove = Capture(editHost.Preview);
            AssertModuleRemoveHighlight(rightRoofRemove, new[] { "roof-a" }, "roof tool right-click remove");
            Assert.IsTrue(Handle("pointer.cancel", new JObject()));

            ArmTool("delete");
            Assert.IsTrue(Handle("pointer.move", PointerAtModule("roof-a", button: -1, buttons: 0, timeMs: 4200)));
            var deleteHoverRoof = Capture(editHost.Preview);
            AssertSnapshotsMatch(rightRoofRemove, deleteHoverRoof, "Delete tool hover vs roof right-click on roof-a");

            Assert.IsTrue(Handle("pointer.down", PointerAtModule("roof-a", button: 0, buttons: 1, timeMs: 4300)));
            var deletePressRoof = Capture(editHost.Preview);
            AssertSnapshotsMatch(rightRoofRemove, deletePressRoof, "Delete tool press vs roof right-click on roof-a");
            Assert.IsTrue(Handle("pointer.cancel", new JObject()));

            // 6. Delete tool hover on bare solid block highlights the block itself (not air above) via erase surface batch,
            //    and hovering/erasing a floor block hosting a bin also highlights the hosted bin with the same red overlay + outline.
            ArmTool("delete");
            Assert.IsTrue(Handle("pointer.move", PointerAtFloor(8, 8, z, button: -1, buttons: 0, timeMs: 5000)));
            var deleteHoverBlock = Capture(editHost.Preview);
            Assert.IsTrue(deleteHoverBlock.EraseBatchActive && deleteHoverBlock.EraseBatchTriangles > 0,
                "Delete tool hover on solid floor block must highlight the block in red");
            Assert.AreEqual(1, deleteHoverBlock.CursorBoxCount, "block erase hover keeps cell cursor");

            Assert.IsTrue(Handle("pointer.move", PointerAtDoc(12.05, 8.05, z + 1.0, button: -1, buttons: 0, timeMs: 5100)));
            var deleteHoverHostedFloor = Capture(editHost.Preview);
            Assert.IsTrue(deleteHoverHostedFloor.EraseBatchActive, "floor cell under hosted bin is highlighted");
            Assert.IsTrue(deleteHoverHostedFloor.SurfaceOverlayCounts.ContainsKey("bin-hosted"),
                "hosted bin on erased floor cell must receive the red surface overlay");
            Assert.AreEqual(1, deleteHoverHostedFloor.OutlineBoxes.Count,
                "hosted bin on erased floor cell must receive the red wireframe outline");

            ArmTool("block");
            Assert.IsTrue(Handle("pointer.down", PointerAtDoc(12.05, 8.05, z + 1.0, button: 2, buttons: 2, timeMs: 5200)));
            var blockRightEraseHosted = Capture(editHost.Preview);
            Assert.IsTrue(blockRightEraseHosted.EraseBatchActive);
            Assert.AreEqual(deleteHoverHostedFloor.SurfaceOverlayCounts["bin-hosted"],
                blockRightEraseHosted.SurfaceOverlayCounts["bin-hosted"],
                "Block right-click erase and Delete tool hover produce the same hosted-module surface overlay");
            Assert.AreEqual(1, blockRightEraseHosted.OutlineBoxes.Count);
            Assert.IsTrue(Handle("pointer.cancel", new JObject()));

            Assert.AreEqual(revBefore, host.CurrentRevision, "preview checks never mutate document revision");
        }

        [Test]
        public void SurfaceAndRoadDeletionPathsMatchRightClickHighlight() {
            const int z = 0;
            var cells = FloorSlab(0, 24, 0, 20, z);
            var modules = new JArray {
                new JObject {
                    ["id"] = "sw-1", ["type"] = "sidewalk", ["x"] = 3, ["y"] = 4, ["z"] = z, ["rot"] = 0,
                },
                new JObject {
                    ["id"] = "road-unsplit", ["type"] = "road", ["x"] = 10, ["y"] = 2, ["z"] = z,
                    ["w"] = 6, ["d"] = 8, ["rot"] = 0,
                    ["cfg"] = new JObject { ["direction"] = "two-way" },
                },
            };
            OpenFixture(z, cells, modules);
            AimTopDown(11f, 8f, 14f);
            var editHost = StationEditHost.Ensure();
            int revBefore = host.CurrentRevision;

            // 1. Sidewalk: Surface tool right-click erase vs Delete tool hover.
            ArmTool("module", new JObject { ["moduleType"] = "sidewalk", ["rotation"] = 0 });
            Assert.IsTrue(Handle("pointer.down", PointerAtFloor(3, 4, z, button: 2, buttons: 2, timeMs: 1000)));
            var rightSurfaceErase = Capture(editHost.Preview);
            AssertModuleRemoveHighlight(rightSurfaceErase, new[] { "sw-1" }, "sidewalk right-click erase");
            Assert.IsTrue(Handle("pointer.cancel", new JObject()));

            ArmTool("delete");
            Assert.IsTrue(Handle("pointer.move", PointerAtModule("sw-1", button: -1, buttons: 0, timeMs: 1200)));
            var deleteHoverSurface = Capture(editHost.Preview);
            AssertSnapshotsMatch(rightSurfaceErase, deleteHoverSurface, "Delete tool hover vs sidewalk right-click");

            // 2. Unsplit road: Road tool right-click vs Delete tool hover vs Delete tool press.
            ArmTool("module", new JObject { ["moduleType"] = "road", ["rotation"] = 0 });
            Assert.IsTrue(Handle("pointer.down", PointerAtDoc(13.0, 6.0, 1.03, button: 2, buttons: 2, timeMs: 2000)));
            var rightRoadDelete = Capture(editHost.Preview);
            AssertModuleRemoveHighlight(rightRoadDelete, new[] { "road-unsplit" }, "road tool right-click delete");
            Assert.IsNull(GameObject.Find("road-edit-preview"), "road delete must not draw yellow road-add deck preview");
            Assert.IsTrue(Handle("pointer.cancel", new JObject()));

            ArmTool("delete");
            Assert.IsTrue(Handle("pointer.move", PointerAtDoc(13.0, 6.0, 1.03, button: -1, buttons: 0, timeMs: 2200)));
            var deleteHoverRoad = Capture(editHost.Preview);
            AssertSnapshotsMatch(rightRoadDelete, deleteHoverRoad, "Delete tool hover vs road right-click on unsplit road");

            Assert.IsTrue(Handle("pointer.down", PointerAtDoc(13.0, 6.0, 1.03, button: 0, buttons: 1, timeMs: 2300)));
            var deletePressRoad = Capture(editHost.Preview);
            AssertSnapshotsMatch(rightRoadDelete, deletePressRoad, "Delete tool press vs road right-click on unsplit road");
            Assert.IsNull(GameObject.Find("road-edit-preview"), "Delete tool road press must not draw yellow road preview");
            Assert.IsTrue(Handle("pointer.cancel", new JObject()));

            // 3. Split road segment: crossing road splits road-main; hover, delete press, and road right-click
            //    all highlight ONLY the targeted segment with the shared red fill + red outline.
            var splitModules = new JArray {
                new JObject {
                    ["id"] = "road-main", ["type"] = "road", ["x"] = 10, ["y"] = 2, ["z"] = z,
                    ["w"] = 6, ["d"] = 16, ["rot"] = 0,
                    ["cfg"] = new JObject { ["direction"] = "two-way" },
                },
                new JObject {
                    ["id"] = "road-cross", ["type"] = "road", ["x"] = 4, ["y"] = 8, ["z"] = z,
                    ["w"] = 18, ["d"] = 4, ["rot"] = 1,
                    ["cfg"] = new JObject { ["direction"] = "two-way" },
                },
            };
            OpenFixture(z, cells, splitModules);
            AimTopDown(12f, 10f, 16f);
            editHost = StationEditHost.Ensure();
            revBefore = host.CurrentRevision;

            foreach (double armY in new[] { 4.0, 16.0 }) {
                ArmTool("module", new JObject { ["moduleType"] = "road", ["rotation"] = 0 });
                Assert.IsTrue(Handle("pointer.down", PointerAtDoc(13.0, armY, 1.03, button: 2, buttons: 2, timeMs: 3000)));
                var rightSplitRoad = Capture(editHost.Preview);
                Assert.AreEqual(1, rightSplitRoad.RemoveFillBoxCount, "split road delete draws red fill box for targeted segment y=" + armY);
                Assert.AreEqual(1, rightSplitRoad.OutlineBoxes.Count, "split road delete draws red outline box for targeted segment y=" + armY);
                Assert.AreEqual(0, rightSplitRoad.CursorBoxCount, "split road delete draws no floor cursor ring");
                Assert.AreEqual(0, rightSplitRoad.OtherPreviewBoxCount);
                Assert.Less(rightSplitRoad.OutlineBoxes[0].size.z, 15.5f, "split arm highlight must be smaller than the full 16 m road");
                Assert.IsTrue(Handle("pointer.cancel", new JObject()));

                ArmTool("delete");
                Assert.IsTrue(Handle("pointer.move", PointerAtDoc(13.0, armY, 1.03, button: -1, buttons: 0, timeMs: 3200)));
                var deleteHoverSplitRoad = Capture(editHost.Preview);
                AssertSnapshotsMatch(rightSplitRoad, deleteHoverSplitRoad, "Delete tool hover vs right-click on split road segment y=" + armY);

                Assert.IsTrue(Handle("pointer.down", PointerAtDoc(13.0, armY, 1.03, button: 0, buttons: 1, timeMs: 3300)));
                var deletePressSplitRoad = Capture(editHost.Preview);
                AssertSnapshotsMatch(rightSplitRoad, deletePressSplitRoad, "Delete tool press vs right-click on split road segment y=" + armY);
                Assert.IsTrue(Handle("pointer.cancel", new JObject()));
            }

            // 4. Direct StationRoadView.ShowPreview on a valid delete preview must also use red (never yellow).
            var directDeleteReq = new RoadEditRequest { mode = "delete", z = 0, from = new[] { 13.0, 4.0 }, pickedId = "road-main" };
            Assert.IsTrue(StationRoadEditService.TryPreview(host, directDeleteReq, out var directPreview, out var pCode), pCode);
            Assert.IsTrue(directPreview.Valid && directPreview.IsDelete);
            StationRoadRenderer.Current.ShowPreview(directPreview);
            var roadPreviewGo = GameObject.Find("road-edit-preview");
            Assert.IsNotNull(roadPreviewGo);
            var deckMat = roadPreviewGo.transform.Find("preview deck").GetComponent<MeshRenderer>().sharedMaterial;
            var deckColor = deckMat.HasProperty("_BaseColor") ? deckMat.GetColor("_BaseColor") : deckMat.color;
            Assert.Greater(deckColor.r, 0.8f, "direct road delete preview must be red");
            Assert.Less(deckColor.g, 0.45f, "direct road delete preview must not be yellow");
            StationRoadRenderer.Current.ClearPreview();

            Assert.AreEqual(revBefore, host.CurrentRevision, "preview checks never mutate document revision");
        }

        // ------------------------------------------------------------------ helpers

        void Exec(string type, JObject payload) {
            Assert.IsTrue(rig.Execute(new JObject { ["type"] = type, ["payload"] = payload }
                .ToString(Newtonsoft.Json.Formatting.None), out var code), type + ": " + code);
        }

        void ArmTool(string tool, JObject settings = null) {
            var payload = new JObject { ["tool"] = tool };
            if (settings != null) payload["settings"] = settings;
            var cmd = new StationCommand {
                SchemaVersion = StationCommandRouter.SchemaVersion,
                Id = "arm-" + tool,
                SessionId = "delete-preview-test",
                Type = "tool.set",
                Payload = payload,
            };
            var handler = new StationToolCommandHandler();
            Assert.IsTrue(handler.TryHandle(cmd, cmd.Payload, out var code, out var reason), code + ": " + reason);
        }

        bool Handle(string type, JObject payload) =>
            StationPointerRouter.Handle(host, type, payload, new JObject(), out _, out _);

        JObject PointerAtFloor(int x, int y, int z, int button, int buttons, double timeMs = -1) =>
            PointerAtDoc(x + 0.5, y + 0.5, z + 1.0, button, buttons, timeMs);

        JObject PointerAtModule(string moduleId, int button, int buttons, double timeMs = -1) {
            var mod = host.Index.GetModule(moduleId);
            Assert.IsNotNull(mod, "module missing: " + moduleId);
            Assert.IsTrue(StationPlacementPreview.TrySelectionBounds(host.Coordinator.World, mod, out var wb),
                "selection bounds missing for " + moduleId);
            var doc = StationCoordinates.WorldToDocument(wb.center);
            return PointerAtDoc(doc.x, doc.y, doc.z, button, buttons, timeMs);
        }

        JObject PointerAtDoc(double docX, double docY, double docZ, int button, int buttons, double timeMs = -1) {
            var world = StationCoordinates.Point(new Vector3((float)docX, (float)docY, (float)docZ));
            var screen = camera.WorldToScreenPoint(world);
            float w = Mathf.Max(1f, Screen.width);
            float h = Mathf.Max(1f, Screen.height);
            var obj = new JObject {
                ["x"] = screen.x,
                ["y"] = h - screen.y,
                ["w"] = w,
                ["h"] = h,
                ["pointerId"] = 9,
                ["button"] = button,
                ["buttons"] = buttons,
                ["modifiers"] = 0,
                ["toolGeneration"] = StationToolSelection.Generation,
                ["documentRevision"] = host.CurrentRevision,
            };
            if (timeMs >= 0) obj["time"] = timeMs;
            return obj;
        }

        static HighlightSnapshot Capture(StationPlacementPreview preview) {
            Assert.IsNotNull(preview);
            var overlays = new Dictionary<string, int>(StringComparer.Ordinal);
            var outlines = new List<Bounds>();
            int cursorBoxes = 0, removeBoxes = 0, otherBoxes = 0, ghostMeshes = 0;
            bool eraseActive = false;
            int eraseTris = 0;
            for (int i = 0; i < preview.transform.childCount; i++) {
                var child = preview.transform.GetChild(i);
                if (child == null || !child.gameObject.activeSelf) continue;
                var name = child.name;
                if (name == "erase surface batch") {
                    eraseActive = true;
                    var mf = child.GetComponent<MeshFilter>();
                    eraseTris = mf != null && mf.sharedMesh != null ? mf.sharedMesh.triangles.Length / 3 : 0;
                    continue;
                }
                if (name.StartsWith("surface highlight ", StringComparison.Ordinal)) {
                    var id = name.Substring("surface highlight ".Length);
                    var mr = child.GetComponent<MeshRenderer>();
                    Assert.IsNotNull(mr, "surface highlight needs MeshRenderer: " + name);
                    Assert.IsNotEmpty(mr.sharedMaterials, "surface highlight needs material: " + name);
                    foreach (var mat in mr.sharedMaterials) {
                        Assert.IsNotNull(mat);
                        Assert.AreEqual("edit remove fill", mat.name,
                            "delete surface overlay must use edit remove fill material: " + name);
                    }
                    overlays.TryGetValue(id, out int count);
                    overlays[id] = count + 1;
                    continue;
                }
                if (name == "selection box") {
                    var mr = child.GetComponent<MeshRenderer>();
                    Assert.IsNotNull(mr);
                    var matName = mr.sharedMaterial != null ? mr.sharedMaterial.name : "";
                    if (matName == "edit cursor ring" || matName == "edit cursor refusal") {
                        cursorBoxes++;
                    } else {
                        Assert.AreEqual("edit cell blocker", matName,
                            "delete outline box must use edit cell blocker material");
                        outlines.Add(new Bounds(child.position, child.localScale));
                    }
                    continue;
                }
                if (name == "preview box") {
                    var mr = child.GetComponent<MeshRenderer>();
                    var matName = mr != null && mr.sharedMaterial != null ? mr.sharedMaterial.name : "";
                    if (matName == "edit remove fill") removeBoxes++;
                    else otherBoxes++;
                    continue;
                }
                if (name.StartsWith("ghost ", StringComparison.Ordinal)) {
                    ghostMeshes++;
                }
            }
            outlines.Sort((a, b) => {
                int c = a.center.x.CompareTo(b.center.x);
                if (c != 0) return c;
                c = a.center.z.CompareTo(b.center.z);
                if (c != 0) return c;
                return a.center.y.CompareTo(b.center.y);
            });
            return new HighlightSnapshot(overlays, outlines, cursorBoxes, removeBoxes, otherBoxes,
                ghostMeshes, eraseActive, eraseTris);
        }

        static void AssertModuleRemoveHighlight(HighlightSnapshot snap, string[] expectedIds, string context) {
            Assert.AreEqual(expectedIds.Length, snap.SurfaceOverlayCounts.Count,
                context + ": surface overlay module count mismatch (" + string.Join(", ", snap.SurfaceOverlayCounts.Keys) + ")");
            foreach (var id in expectedIds) {
                Assert.IsTrue(snap.SurfaceOverlayCounts.TryGetValue(id, out int c) && c > 0,
                    context + ": missing red surface overlay for " + id);
            }
            Assert.AreEqual(expectedIds.Length, snap.OutlineBoxes.Count,
                context + ": expected one red wireframe outline box per targeted module");
            Assert.AreEqual(0, snap.CursorBoxCount, context + ": must not draw a stray floor cursor ring");
            Assert.AreEqual(0, snap.OtherPreviewBoxCount, context + ": must not draw add/refusal preview boxes");
            Assert.AreEqual(0, snap.GhostMeshCount, context + ": must not draw placement ghost meshes");
            Assert.IsFalse(snap.EraseBatchActive, context + ": must not activate cell erase batch");
        }

        static void AssertSnapshotsMatch(HighlightSnapshot expected, HighlightSnapshot actual, string context) {
            CollectionAssert.AreEquivalent(expected.SurfaceOverlayCounts.Keys, actual.SurfaceOverlayCounts.Keys,
                context + ": highlighted module IDs must match");
            foreach (var pair in expected.SurfaceOverlayCounts) {
                Assert.AreEqual(pair.Value, actual.SurfaceOverlayCounts[pair.Key],
                    context + ": surface overlay count mismatch for " + pair.Key);
            }
            Assert.AreEqual(expected.OutlineBoxes.Count, actual.OutlineBoxes.Count,
                context + ": outline box count must match");
            for (int i = 0; i < expected.OutlineBoxes.Count; i++) {
                Assert.AreEqual(expected.OutlineBoxes[i].center.x, actual.OutlineBoxes[i].center.x, 1e-3f, context);
                Assert.AreEqual(expected.OutlineBoxes[i].center.y, actual.OutlineBoxes[i].center.y, 1e-3f, context);
                Assert.AreEqual(expected.OutlineBoxes[i].center.z, actual.OutlineBoxes[i].center.z, 1e-3f, context);
                Assert.AreEqual(expected.OutlineBoxes[i].size.x, actual.OutlineBoxes[i].size.x, 1e-3f, context);
                Assert.AreEqual(expected.OutlineBoxes[i].size.y, actual.OutlineBoxes[i].size.y, 1e-3f, context);
                Assert.AreEqual(expected.OutlineBoxes[i].size.z, actual.OutlineBoxes[i].size.z, 1e-3f, context);
            }
            Assert.AreEqual(expected.CursorBoxCount, actual.CursorBoxCount, context + ": cursor box count must match");
            Assert.AreEqual(expected.RemoveFillBoxCount, actual.RemoveFillBoxCount, context + ": remove fill box count must match");
            Assert.AreEqual(expected.OtherPreviewBoxCount, actual.OtherPreviewBoxCount, context + ": other preview box count must match");
            Assert.AreEqual(expected.GhostMeshCount, actual.GhostMeshCount, context + ": ghost mesh count must match");
            Assert.AreEqual(expected.EraseBatchActive, actual.EraseBatchActive, context + ": erase batch active state must match");
        }

        static void AssertClean(StationPlacementPreview preview, string context) {
            var snap = Capture(preview);
            Assert.AreEqual(0, snap.SurfaceOverlayCounts.Count, context + ": surface overlays leaked");
            Assert.AreEqual(0, snap.OutlineBoxes.Count, context + ": outline boxes leaked");
            Assert.AreEqual(0, snap.CursorBoxCount, context + ": cursor boxes leaked");
            Assert.AreEqual(0, snap.RemoveFillBoxCount, context + ": remove fill boxes leaked");
            Assert.AreEqual(0, snap.OtherPreviewBoxCount, context + ": preview boxes leaked");
            Assert.AreEqual(0, snap.GhostMeshCount, context + ": ghost meshes leaked");
            Assert.IsFalse(snap.EraseBatchActive, context + ": erase batch stayed active");
        }
    }
}
