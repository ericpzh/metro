using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// Track 6 EditMode tests (plan 37 §6): authoritative undo/redo + same-sourceId history clearing,
    /// monotonic <c>stationEpoch</c>, main viewport theme sync before <c>hideUi</c> and after
    /// <c>SyncSky(force: true)</c>, and incremental road local delta parity &amp; view retention.
    /// </summary>
    public sealed class StationShellAndRoadDeltaTests {
        readonly List<GameObject> cleanup = new List<GameObject>();

        [TearDown]
        public void TearDown() {
            for (int i = cleanup.Count - 1; i >= 0; i--) {
                if (cleanup[i] != null) UnityEngine.Object.DestroyImmediate(cleanup[i]);
            }
            cleanup.Clear();
            StationEditHost.ResetForTests();
            StationEditSession.Reset();
            StationToolSelection.Reset();
            StationCellTool.Reset();
            StationRoadTool.Reset();
            StationScenePicker.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        StationGameHost CreateHost() {
            var go = new GameObject("track6-host");
            cleanup.Add(go);
            var host = go.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            host.catalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            host.trainCatalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            host.stationShader = StationFinishLibrary.FindShader();
            typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(host, null);
            return host;
        }

        [Test]
        public void ClearHistoryOnSameSourceIdReloadsAndPublishesAuthoritativeCanUndoCanRedoAndEpoch() {
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
            var host = CreateHost();

            var first = host.NewStation(new JObject { ["name"] = "First" });
            Assert.IsTrue(first.Accepted);
            int epoch1 = host.StationEpoch;
            Assert.GreaterOrEqual(epoch1, 1);
            Assert.IsFalse(StationEditSession.CanUndo);
            Assert.IsFalse(StationEditSession.CanRedo);

            // Make a local cell edit so undo becomes available.
            var patch = new StationCellPatch();
            patch.Writes.Add(StationCellWrite.Set(new StationCellKey(2, 2, -5), isVoid: false));
            Assert.IsTrue(StationEditSession.TryApplyCells(host, patch, "cell", null, out _, out var cellCode), cellCode);
            Assert.IsTrue(StationEditSession.CanUndo);
            Assert.IsFalse(StationEditSession.CanRedo);
            Assert.AreEqual(epoch1, host.StationEpoch, "ordinary edits must not bump stationEpoch");

            var stateAfterEdit = host.BuildStatePayload();
            Assert.AreEqual(true, (bool)stateAfterEdit["canUndo"]);
            Assert.AreEqual(false, (bool)stateAfterEdit["canRedo"]);
            Assert.AreEqual(epoch1, (int)stateAfterEdit["stationEpoch"]);

            // Undo -> canUndo=false, canRedo=true.
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var undoCode), undoCode);
            Assert.IsFalse(StationEditSession.CanUndo);
            Assert.IsTrue(StationEditSession.CanRedo);
            Assert.AreEqual(epoch1, host.StationEpoch, "undo must not bump stationEpoch");

            // Same-sourceId reload ("new" -> "new") MUST clear both stacks and bump stationEpoch.
            var second = host.NewStation(new JObject { ["name"] = "Second" });
            Assert.IsTrue(second.Accepted);
            Assert.Greater(host.StationEpoch, epoch1);
            Assert.IsFalse(StationEditSession.CanUndo, "new -> new reload must clear undo stack");
            Assert.IsFalse(StationEditSession.CanRedo, "new -> new reload must clear redo stack");
            int epoch2 = host.StationEpoch;

            // Open file ("file"), edit, then open file again ("file" -> "file") -> must clear & bump.
            string saveJson = host.SaveDocument();
            Assert.IsTrue(host.OpenDocument(saveJson, "file").Accepted);
            int epoch3 = host.StationEpoch;
            Assert.Greater(epoch3, epoch2);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, patch, "cell", null, out _, out cellCode), cellCode);
            Assert.IsTrue(StationEditSession.CanUndo);

            Assert.IsTrue(host.OpenDocument(saveJson, "file").Accepted);
            Assert.Greater(host.StationEpoch, epoch3);
            Assert.IsFalse(StationEditSession.CanUndo, "file -> file reload must clear undo stack");
            Assert.IsFalse(StationEditSession.CanRedo, "file -> file reload must clear redo stack");
        }

        [Test]
        public void ViewThemeSyncUpdatesVoidColorAndFogBeforeHideUiAndAfterExplodedClose() {
            var camGo = new GameObject("theme-cam");
            cleanup.Add(camGo);
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = StationRenderRig.VoidColor;

            var rigGo = new GameObject("theme-rig");
            cleanup.Add(rigGo);
            var rig = rigGo.AddComponent<StationViewRig>();
            var handler = new StationViewCommandHandler(rig, null);

            RenderSettings.fog = true;
            RenderSettings.fogColor = StationRenderRig.VoidColor.linear;

            // 1. Early theme command BEFORE rig.Configure must be accepted and queued (never no-session).
            var earlyCmd = new StationCommand {
                Type = "view.set",
                Payload = new JObject { ["key"] = "theme", ["value"] = "studio" },
                Raw = "{\"type\":\"view.set\",\"payload\":{\"key\":\"theme\",\"value\":\"studio\"}}",
            };
            var earlyPayload = new JObject();
            Assert.IsTrue(handler.TryHandle(earlyCmd, earlyPayload, out var earlyCode, out var earlyReason),
                earlyCode + ": " + earlyReason);
            Assert.AreEqual("studio", (string)earlyPayload["view"]["theme"]);

            // Configure rig with hideUi=false (never enabled); pending studio theme applies immediately.
            rig.Configure(cam, new Bounds(Vector3.zero, new Vector3(40f, 40f, 10f)), StationLevelGrid.FromDocument(0, 5), 0);
            AssertColorClose(StationRenderRig.StudioVoidColor, cam.backgroundColor, "initial studio clear colour");
            AssertColorClose(StationRenderRig.StudioVoidColor.linear, RenderSettings.fogColor, "initial studio fog colour");

            // 2. Switch to blueprint while hideUi has never been enabled -> camera & fog update immediately.
            Assert.IsTrue(rig.Execute("{\"type\":\"view.set\",\"payload\":{\"key\":\"theme\",\"value\":\"blueprint\"}}", out var bpCode), bpCode);
            AssertColorClose(StationRenderRig.VoidColor, cam.backgroundColor, "blueprint clear colour");
            AssertColorClose(StationRenderRig.VoidColor.linear, RenderSettings.fogColor, "blueprint fog colour");

            // 3. Switch back to studio, simulate Exploded View overriding clear/fog, then SyncSky(force: true).
            Assert.IsTrue(rig.Execute("{\"type\":\"view.set\",\"payload\":{\"key\":\"theme\",\"value\":\"studio\"}}", out var stCode), stCode);
            AssertColorClose(StationRenderRig.StudioVoidColor, cam.backgroundColor, "studio clear colour before exploded");

            cam.backgroundColor = Color.magenta;
            RenderSettings.fogColor = Color.green;
            rig.SyncSky(force: true);
            AssertColorClose(StationRenderRig.StudioVoidColor, cam.backgroundColor, "SyncSky(force:true) must restore studio clear colour when hideUi is false");
            AssertColorClose(StationRenderRig.StudioVoidColor.linear, RenderSettings.fogColor, "SyncSky(force:true) must restore studio fog colour when hideUi is false");
        }

        [Test]
        public void RoadLocalDeltaAddEraseUndoRetainsUnrelatedViewsAndMatchesFullRebuild() {
            string zooPath = Path.Combine(Application.dataPath, "StationDesigner", "Demos", "zoo.metro.json");
            Assert.IsTrue(File.Exists(zooPath), "Zoo demo missing: " + zooPath);
            string zooJson = File.ReadAllText(zooPath);

            StationRenderers.Clear();
            StationRenderers.Add(new StationCellRenderer());
            StationRenderers.Add(new StationRoadRenderer());
            StationRenderers.Add(new StationEquipmentModuleRenderer());
            StationRenderers.Add(new StationStructureModuleRenderer());
            StationRenderers.Add(new StationContactShadowRenderer());

            var host = CreateHost();
            var opened = host.OpenDocument(zooJson, "zoo");
            Assert.IsTrue(opened.Accepted, opened.Rejection?.Reason ?? "open failed");

            var worldBefore = host.Coordinator.World;
            var retainedEquipView = worldBefore.Records
                .FirstOrDefault(r => r.Role == "equipment" && r.View != null)?.View;
            Assert.NotNull(retainedEquipView, "Zoo must have an equipment view to verify retention");
            int initialRoadCount = host.Index.ModulesOfType("road").Count;

            int localStart = StationEditSession.LocalEdits;
            int fullStart = StationEditSession.FullEdits;

            // 1. Add a perpendicular road branching from road-3976.
            var addReq = new RoadEditRequest {
                mode = "add",
                z = 0,
                from = new[] { 40.0, -9.0 },
                to = new[] { 40.0, -35.0 },
                width = 6,
                direction = "two-way",
                rot = 0,
                expectedRevision = -1,
            };
            Assert.IsTrue(StationRoadEditService.TryCommit(host, addReq, out var addCode, out var addReason), addCode ?? addReason);
            Assert.AreSame(worldBefore, host.Coordinator.World, "road add must retain StationWorldView");
            Assert.IsTrue(retainedEquipView != null, "unrelated equipment GameObject must survive road add");
            Assert.AreEqual(initialRoadCount + 1, host.Index.ModulesOfType("road").Count);

            // Snapshot incremental road counts & save JSON for full-rebuild parity check after undo
            // (opening a second host mid-test would call ClearHistory on the static edit session).
            var incrementalView = StationRoadRenderer.Current.View;
            int incRoads = incrementalView.Roads;
            int incSegments = incrementalView.Segments;
            int incSignals = incrementalView.SignalsBuilt;
            int incCrosswalks = incrementalView.Crosswalks;
            int incArrows = incrementalView.Arrows;
            string afterAddJson = host.SaveDocument();

            // 2. Erase the newly added road.
            string addedId = host.Index.ModulesOfType("road").Last().Id;
            var eraseReq = new RoadEditRequest {
                mode = "delete",
                z = 0,
                from = new[] { 40.0, -25.0 },
                to = new[] { 40.0, -25.0 },
                pickedId = addedId,
                expectedRevision = -1,
            };
            Assert.IsTrue(StationRoadEditService.TryCommit(host, eraseReq, out var delCode, out var delReason), delCode ?? delReason);
            Assert.AreSame(worldBefore, host.Coordinator.World, "road erase must retain StationWorldView");
            Assert.AreEqual(initialRoadCount, host.Index.ModulesOfType("road").Count);

            // 3. Undo erase & undo add.
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var u1), u1);
            Assert.AreSame(worldBefore, host.Coordinator.World, "undo road erase must retain StationWorldView");
            Assert.AreEqual(initialRoadCount + 1, host.Index.ModulesOfType("road").Count);

            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var u2), u2);
            Assert.AreSame(worldBefore, host.Coordinator.World, "undo road add must retain StationWorldView");
            Assert.AreEqual(initialRoadCount, host.Index.ModulesOfType("road").Count);

            Assert.AreEqual(localStart + 4, StationEditSession.LocalEdits, "all 4 road transitions must run locally");
            Assert.AreEqual(fullStart, StationEditSession.FullEdits, "zero full fallbacks allowed for road add/erase/undo");

            // 4. Verify incremental road view counts match a fresh full rebuild of the post-add JSON.
            var refHost = CreateHost();
            Assert.IsTrue(refHost.OpenDocument(afterAddJson, "ref").Accepted);
            var refView = StationRoadRenderer.Current.View;
            Assert.AreEqual(refView.Roads, incRoads, "drawn road count parity");
            Assert.AreEqual(refView.Segments, incSegments, "split segment count parity");
            Assert.AreEqual(refView.SignalsBuilt, incSignals, "signal count parity");
            Assert.AreEqual(refView.Crosswalks, incCrosswalks, "crosswalk count parity");
            Assert.AreEqual(refView.Arrows, incArrows, "arrow count parity");
            var refGo = refHost.gameObject;
            cleanup.Remove(refGo);
            UnityEngine.Object.DestroyImmediate(refGo);
        }

        static void AssertColorClose(Color expected, Color actual, string label) {
            Assert.AreEqual(expected.r, actual.r, 0.01f, label + " (R)");
            Assert.AreEqual(expected.g, actual.g, 0.01f, label + " (G)");
            Assert.AreEqual(expected.b, actual.b, 0.01f, label + " (B)");
        }
    }
}
