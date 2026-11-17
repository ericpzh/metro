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

        JObject Pointer(double docX, double docY, double docZ, int button, int buttons) {
            var world = StationCoordinates.Point(new Vector3((float)docX, (float)docY, (float)docZ));
            var viewport = camera.WorldToViewportPoint(world);
            Assert.IsTrue(viewport.x > 0.02f && viewport.x < 0.98f && viewport.y > 0.02f && viewport.y < 0.98f,
                "the fixture aims through the rendered view");
            var screen = camera.WorldToScreenPoint(world);
            return new JObject {
                ["x"] = screen.x,
                ["y"] = Mathf.Max(1f, Screen.height) - screen.y,
                ["w"] = Mathf.Max(1f, Screen.width),
                ["h"] = Mathf.Max(1f, Screen.height),
                ["pointerId"] = 7,
                ["button"] = button,
                ["buttons"] = buttons,
                ["toolGeneration"] = StationToolSelection.Generation,
                ["documentRevision"] = host.CurrentRevision,
            };
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
    }
}
