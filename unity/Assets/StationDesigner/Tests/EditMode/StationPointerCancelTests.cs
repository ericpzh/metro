using System;
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
    /// Plan 29 §2: the host-side chord and ownership arbiter. The shell cancels its own chord
    /// (`pointerInput.ts`), but the C# router must not trust it: both build buttons held at
    /// once, a move whose mask lost the owning button, or the release of the button that did
    /// not arm the press all cancel the gesture — zero scene picks, zero revisions, both ghost
    /// layers and the footprint badge cleared — instead of aiming or finishing it. Escape
    /// (`edit.cancel`) is routed through the same one cancellation.
    /// </summary>
    public sealed class StationPointerCancelTests {
        GameObject hostObject;
        GameObject cameraObject;
        StationGameHost host;
        StationViewRig rig;
        Camera camera;

        [SetUp]
        public void SetUp() {
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            StationCellTool.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
            StationEditHost.ResetForTests();
            var cells = new JArray();
            for (int x = 0; x < 4; x++) {
                for (int y = 0; y < 4; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = -5, ["fill"] = "solid" });
                    // A grade slab too: a grade dig must leave its own void hole record.
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            var envelope = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "cancel fixture",
                ["city"] = "guangzhou",
                ["seed"] = 7,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = cells, ["modules"] = new JArray(), ["lines"] = new JArray(),
                },
            }.ToString(Newtonsoft.Json.Formatting.None);

            hostObject = new GameObject(StationGameHost.ObjectName);
            cameraObject = new GameObject("cancel fixture camera");
            camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 12f;
            camera.nearClipPlane = 0.5f;
            camera.farClipPlane = 400f;
            host = hostObject.AddComponent<StationGameHost>();
            host.catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            host.trainCatalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            host.stationShader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            host.stationCamera = camera;
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
            awake.Invoke(host, null);
            host.Coordinator.RegisterRenderer(new StationCellRenderer());
            var opened = host.OpenDocument(envelope, "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            rig = StationViewFeature.Attach(host);
            StationEditFeature.Attach(host);
            Exec("camera.snap", new JObject { ["face"] = "top", ["ortho"] = true });
            Exec("camera.zoom", new JObject { ["factor"] = 6 });
            Exec("view.set", new JObject { ["key"] = "level", ["value"] = -5 });
            // The plane fallback is the case; the street slab would answer first if shown.
            Exec("view.set", new JObject { ["key"] = "ground", ["value"] = true });
            rig.Tick(0f);
            host.SetActiveLevel(rig.Visibility.State.ActiveLevel);
            Assert.IsTrue(StationToolSelection.TrySelect("block", out _, out var code), code);
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
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            StationCellTool.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        void Exec(string type, JObject payload) {
            Assert.IsTrue(rig.Execute(new JObject { ["type"] = type, ["payload"] = payload }
                .ToString(Newtonsoft.Json.Formatting.None), out var code), type + ": " + code);
        }

        JObject Pointer(double docX, double docY, double docZ, int button, int buttons,
            int pointerId = 7, double timeMs = -1) {
            var world = StationCoordinates.Point(new Vector3((float)docX, (float)docY, (float)docZ));
            var viewport = camera.WorldToViewportPoint(world);
            Assert.IsTrue(viewport.x > 0.02f && viewport.x < 0.98f && viewport.y > 0.02f && viewport.y < 0.98f,
                "the fixture aims through the rendered view");
            var screen = camera.WorldToScreenPoint(world);
            var payload = new JObject {
                ["x"] = screen.x,
                ["y"] = Mathf.Max(1f, Screen.height) - screen.y,
                ["w"] = Mathf.Max(1f, Screen.width),
                ["h"] = Mathf.Max(1f, Screen.height),
                ["pointerId"] = pointerId,
                ["button"] = button,
                ["buttons"] = buttons,
                ["toolGeneration"] = StationToolSelection.Generation,
                ["documentRevision"] = host.CurrentRevision,
            };
            if (timeMs >= 0) payload["time"] = timeMs;
            return payload;
        }

        JObject Handle(string type, JObject payload) {
            var reply = new JObject();
            Assert.IsTrue(StationPointerRouter.Handle(host, type, payload, reply, out var code, out var reason),
                type + " -> " + code + " " + reason);
            return reply;
        }

        static void AssertNoLayers(JObject reply) {
            Assert.IsNull(reply["cells"], "the footprint badge and the ghost are cleared: " + reply);
            Assert.IsNull(StationEditSession.Cells, "the session's cell plan is cleared");
            Assert.IsFalse(StationCellTool.HasGesture, "no gesture survives the cancellation");
        }

        // -------------------------------------------------------------------- cases

        [Test]
        public void BothBuildButtonsHeldCancelsAPressWithZeroPicksAndRevisions() {
            int revision = host.CurrentRevision;
            Handle("pointer.down", Pointer(10.5, 10.5, -4, button: 0, buttons: 1));
            Assert.IsTrue(StationCellTool.HasGesture, "the left press armed a cell gesture");
            Assert.IsTrue(StationEditSession.Cells != null, "the press drew its ghost and badge");

            int picks = StationScenePicker.PickCount;
            var chord = Handle("pointer.down", Pointer(10.6, 10.6, -4, button: 2, buttons: 3));
            Assert.AreEqual(0, StationScenePicker.PickCount - picks, "a chord resolves no scene pick");
            Assert.AreEqual(revision, host.CurrentRevision, "a chord applies no revision");
            Assert.AreEqual("chord", (string)chord["cancelled"]);
            AssertNoLayers(chord);

            // Both releases are consumed: neither may commit the cancelled gesture.
            Handle("pointer.up", Pointer(10.6, 10.6, -4, button: 2, buttons: 1));
            Handle("pointer.up", Pointer(10.5, 10.5, -4, button: 0, buttons: 0));
            Assert.AreEqual(revision, host.CurrentRevision);
            Assert.IsNull(host.Index.GetCell(10, 10, -5), "the cancelled rectangle never landed");
        }

        [Test]
        public void ReleasingTheOtherButtonCancelsARightErase() {
            int revision = host.CurrentRevision;
            // The secondary button erases a **visible** cell only, so press on the slab's top.
            Handle("pointer.down", Pointer(1.5, 1.5, -4, button: 2, buttons: 2));
            Assert.IsTrue(StationCellTool.HasGesture, "the secondary press armed the erase");
            int picks = StationScenePicker.PickCount;
            // Right-up is what the browser reports when the left button is released during the
            // right drag: committing here would erase what the player tried to cancel.
            var release = Handle("pointer.up", Pointer(1.5, 1.5, -4, button: 0, buttons: 2));
            Assert.AreEqual(picks, StationScenePicker.PickCount, "the cancelling release resolves no pick");
            Assert.AreEqual(revision, host.CurrentRevision);
            Assert.AreEqual("other-release", (string)release["cancelled"]);
            AssertNoLayers(release);
            Assert.IsNotNull(host.Index.GetCell(1, 1, -5), "the cancelled erase left the slab standing");
        }

        [Test]
        public void AMoveThatLostTheOwningButtonCancelsWithoutAiming() {
            int revision = host.CurrentRevision;
            Handle("pointer.down", Pointer(1.5, 1.5, -4, button: 2, buttons: 2));
            Assert.IsTrue(StationCellTool.HasGesture);
            int picks = StationScenePicker.PickCount;
            // The mask holds the left bit only: the press's own button went up unseen.
            var aim = Handle("pointer.move", Pointer(2.5, 2.5, -4, button: 0, buttons: 1));
            Assert.AreEqual(picks, StationScenePicker.PickCount, "an unowned move resolves no pick");
            Assert.AreEqual(revision, host.CurrentRevision);
            Assert.AreEqual("unowned-pointer", (string)aim["cancelled"]);
            AssertNoLayers(aim);
            Assert.IsNotNull(host.Index.GetCell(1, 1, -5), "no move erased anything");
        }

        [Test]
        public void EscapeUsesTheSameOneCancellation() {
            Handle("pointer.down", Pointer(10.5, 10.5, -4, button: 0, buttons: 1));
            Assert.IsTrue(StationCellTool.HasGesture);
            int revision = host.CurrentRevision;
            var handler = new StationEditCommandHandler();
            Assert.IsTrue(handler.TryHandle(new StationCommand { Type = "edit.cancel" }, new JObject(),
                out var code, out var reason), "edit.cancel refused: " + code + " " + reason);
            Assert.IsFalse(StationCellTool.HasGesture, "Escape drops the cell gesture");
            Assert.IsNull(StationEditSession.Cells, "Escape drops the plan and the footprint badge");
            Assert.IsNull(StationEditSession.Ghost, "Escape drops the drawn ghost layer");
            Assert.AreEqual(revision, host.CurrentRevision, "Escape is not an edit");
        }

        // ---------------------------------------- plan 30 §1: the move sentinel and the right claim

        /// <summary>
        /// A move names no changed button, so the shell sends the unchanged-button sentinel
        /// (`-1`) with the real `buttons` mask. The router used to read button 0 as the left
        /// button's release and cancelled a held right erase on its very first move.
        /// </summary>
        [Test]
        public void ARightEraseDragThroughSentinelMovesAimsAndCommitsOnce() {
            int revision = host.CurrentRevision;
            Handle("pointer.down", Pointer(1.5, 1.5, -4, button: 2, buttons: 2, timeMs: 1000));
            Assert.IsTrue(StationCellTool.HasGesture, "the secondary press armed the erase");
            // The move keeps the owning bit, names no button: owned, aimed, not cancelled.
            var aim = Handle("pointer.move", Pointer(2.5, 2.5, -4, button: -1, buttons: 2, timeMs: 1200));
            Assert.IsNull(aim["cancelled"], "a move with the owning mask is not a cancellation: " + aim);
            Assert.IsNotNull(StationEditSession.Cells, "the drag keeps its preview");
            Assert.IsTrue(StationCellTool.HasGesture, "the drag is still in flight");
            var release = Handle("pointer.up", Pointer(2.5, 2.5, -4, button: 2, buttons: 0, timeMs: 1400));
            Assert.IsNull(release["cancelled"], "the owner's release is not a cancellation: " + release);
            Assert.AreEqual(revision + 1, host.CurrentRevision, "the erase is one revision");
            Assert.IsNull(host.Index.GetCell(1, 1, -5), "the pressed cell is gone");
            Assert.IsNull(host.Index.GetCell(2, 2, -5), "the dragged-to cell is gone");
            Assert.IsNull(host.Index.GetCell(1, 2, -5), "the rectangle the drag drew is gone");
            Assert.IsNull(host.Index.GetCell(2, 1, -5));
            var notice = StationEditSession.ToJson()["notice"];
            Assert.IsTrue(notice == null || notice.Type == JTokenType.Null, "a committed erase publishes no notice");
        }

        /// <summary>A stationary right tap is one erase, exactly as the reference's dig.</summary>
        [Test]
        public void AStationaryRightTapErasesTheOneCellUnderThePointer() {
            int revision = host.CurrentRevision;
            Handle("pointer.down", Pointer(1.5, 1.5, -4, button: 2, buttons: 2));
            Handle("pointer.move", Pointer(1.5, 1.5, -4, button: -1, buttons: 2));
            var release = Handle("pointer.up", Pointer(1.5, 1.5, -4, button: 2, buttons: 0));
            Assert.IsNull(release["cancelled"]);
            Assert.AreEqual(revision + 1, host.CurrentRevision);
            Assert.IsNull(host.Index.GetCell(1, 1, -5));
            Assert.IsNotNull(host.Index.GetCell(2, 2, -5), "the tap takes one cell, not the storey");
            // The trace records the right claim, the mask and the verdict for a failing tap.
            var trace = (JArray)StationEditSession.ToJson()["trace"];
            var last = (JObject)trace[trace.Count - 1];
            Assert.AreEqual("pointer.up", (string)last["type"]);
            Assert.AreEqual("erase", (string)last["rightClaim"], "the shell was told the tool owns the right button");
            Assert.AreEqual(2, (int)last["button"]);
            Assert.AreEqual(0, (int)last["buttons"]);
            Assert.IsTrue((bool)last["committed"]);
        }

        /// <summary>
        /// The same tuples at the release boundary: the final release's own pick aims the
        /// commit at the latest position, so a movement suppressed on the release frame (the
        /// desktop presenter's ordering) still commits where the player let go.
        /// </summary>
        [Test]
        public void AReleaseAtTheLatestPositionCommitsWhereThePlayerLetGo() {
            Handle("pointer.down", Pointer(1.5, 1.5, -4, button: 2, buttons: 2, timeMs: 1000));
            // The frame's motion and the release share one presenter frame: only the up is
            // delivered, at the new position, with the owner's mask already cleared.
            Handle("pointer.up", Pointer(2.5, 2.5, -4, button: 2, buttons: 0, timeMs: 1400));
            Assert.IsNull(host.Index.GetCell(1, 1, -5), "the press's cell anchors the rectangle");
            Assert.IsNull(host.Index.GetCell(2, 2, -5), "the release's own aim reaches the new cell");
        }

        /// <summary>A move from another pointer never aims or commits the armed press.</summary>
        [Test]
        public void AMoveFromAnotherPointerCancelsWithoutAiming() {
            int revision = host.CurrentRevision;
            Handle("pointer.down", Pointer(1.5, 1.5, -4, button: 2, buttons: 2));
            int picks = StationScenePicker.PickCount;
            var aim = Handle("pointer.move", Pointer(2.5, 2.5, -4, button: -1, buttons: 2, pointerId: 8));
            Assert.AreEqual(picks, StationScenePicker.PickCount, "an unowned pointer resolves no pick");
            Assert.AreEqual(revision, host.CurrentRevision);
            Assert.AreEqual("unowned-pointer", (string)aim["cancelled"]);
            AssertNoLayers(aim);
        }

        /// <summary>
        /// A left drag's sentinel move must stay owned too: the same encoding fix must not
        /// make the ordinary primary add cancel.
        /// </summary>
        [Test]
        public void ALeftDragThroughSentinelMovesStillCommits() {
            int revision = host.CurrentRevision;
            Handle("pointer.down", Pointer(10.5, 10.5, -4, button: 0, buttons: 1, timeMs: 1000));
            var aim = Handle("pointer.move", Pointer(10.5, 10.5, -4, button: -1, buttons: 1, timeMs: 1200));
            Assert.IsNull(aim["cancelled"]);
            var release = Handle("pointer.up", Pointer(10.5, 10.5, -4, button: 0, buttons: 0, timeMs: 1400));
            Assert.IsNull(release["cancelled"]);
            Assert.AreEqual(revision + 1, host.CurrentRevision);
            Assert.IsNotNull(host.Index.GetCell(10, 10, -5), "the block landed at the edited level's plane cell");
        }

        /// <summary>
        /// A grade dig leaves the void record the save carries: without it the virtual street
        /// plane would pave the hole back over on the next read.
        /// </summary>
        [Test]
        public void AGradeEraseLeavesItsVoidHoleRecord() {
            Exec("view.set", new JObject { ["key"] = "ground", ["value"] = false });
            Exec("view.set", new JObject { ["key"] = "level", ["value"] = 0 });
            rig.Tick(0f);
            host.SetActiveLevel(rig.Visibility.State.ActiveLevel);
            int revision = host.CurrentRevision;
            Handle("pointer.down", Pointer(1.5, 1.5, 1, button: 2, buttons: 2));
            Handle("pointer.move", Pointer(1.5, 1.5, 1, button: -1, buttons: 2));
            var release = Handle("pointer.up", Pointer(1.5, 1.5, 1, button: 2, buttons: 0));
            Assert.IsNull(release["cancelled"], "the stationary grade erase is not a cancellation: " + release);
            Assert.AreEqual(revision + 1, host.CurrentRevision, "one grade erase is one revision");
            var hole = host.Index.GetCell(1, 1, 0);
            Assert.IsNotNull(hole, "the dig leaves a hole record at grade");
            Assert.IsTrue(hole.IsVoid, "the hole is a void record, not a solid cell");
        }
    }
}
