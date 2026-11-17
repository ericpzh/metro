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
    /// Plan 29 §1: the block brush places on the **active depth plane** exactly as the
    /// reference does. `CameraSystem.pick` intersects the plane at `activeZ + 1` after a
    /// geometry miss and returns a non-solid cell at `activeZ`; `BlockTool` anchors an add
    /// on that cell (`hit.solid ? hit.place : hit.cell`) and an erase on `hit.cell` only.
    ///
    /// These cases drive the production router (`pointer.down` / `pointer.move` /
    /// `pointer.up`) through a real camera, world, cell renderer and committed index, so they
    /// pin the whole chain: the pick policy, the ghost's anchor, the write, the drawn result
    /// and the undo. A visible surface still wins ahead of the plane, an occupied ground cell
    /// is a no-op and an erase in empty air never synthesizes a removal.
    /// </summary>
    public sealed class StationWorkPlanePlacementTests {
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
            hostObject = new GameObject(StationGameHost.ObjectName);
            cameraObject = new GameObject("work plane camera");
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
            host.Coordinator.RegisterRenderer(new StationSurfaceModuleRenderer());
            host.Coordinator.RegisterRenderer(new StationEquipmentModuleRenderer());
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

        // ------------------------------------------------------------------ fixture

        static string Envelope(JArray cells, int levelBase) => new JObject {
            ["format"] = StationDocumentReader.SaveFormat,
            ["formatVersion"] = StationDocumentReader.SupportedVersion,
            ["savedAt"] = StationDocumentReader.FixedSavedAt,
            ["name"] = "work plane fixture",
            ["city"] = "guangzhou",
            ["seed"] = 7,
            ["levelBase"] = levelBase,
            ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = cells ?? new JArray(),
                ["modules"] = new JArray(),
                ["lines"] = new JArray(),
            },
        }.ToString(Newtonsoft.Json.Formatting.None);

        /// <summary>A station whose only geometry is a small 4 × 4 floor slab at one depth.</summary>
        static JArray Slab(int z) {
            var cells = new JArray();
            for (int x = 0; x < 4; x++) {
                for (int y = 0; y < 4; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid" });
                }
            }
            return cells;
        }

        void Open(JArray cells, int levelBase, int level) {
            var opened = host.OpenDocument(Envelope(cells, levelBase), "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            rig = StationViewFeature.Attach(host);
            StationEditFeature.Attach(host);
            // A fixed top-down orthographic view: every case addresses the same document
            // cell through the same pixel, so hover, press and release cannot disagree.
            Assert.IsTrue(rig.Execute(new JObject {
                ["type"] = "camera.snap",
                ["payload"] = new JObject { ["face"] = "top", ["ortho"] = true },
            }.ToString(Newtonsoft.Json.Formatting.None), out var snapCode), snapCode);
            // A 4 m fixture frames at ~4 m half-height; the void target sits outside that, and
            // `StationPointerEvent.ToScreen` clamps to the viewport, so zoom out to keep every
            // aimed document point inside the rendered view.
            Assert.IsTrue(rig.Execute(new JObject {
                ["type"] = "camera.zoom",
                ["payload"] = new JObject { ["factor"] = 6 },
            }.ToString(Newtonsoft.Json.Formatting.None), out var zoomCode), zoomCode);
            rig.Tick(0f);
            SetLevel(level);
            // 隐藏地面: the case is the work-plane fallback, and the visible street slab would
            // otherwise answer every downward ray before the plane can (it is exactly the
            // reference's own "ground hidden" case for placing in the void).
            Assert.IsTrue(rig.Execute(new JObject {
                ["type"] = "view.set",
                ["payload"] = new JObject { ["key"] = "ground", ["value"] = true },
            }.ToString(Newtonsoft.Json.Formatting.None), out var groundCode), groundCode);
            rig.Tick(0f);
            Assert.IsTrue(StationToolSelection.TrySelect("block", out _, out var toolCode), toolCode);
        }

        void SetLevel(int level) {
            Assert.IsTrue(rig.Execute(new JObject {
                ["type"] = "view.set",
                ["payload"] = new JObject { ["key"] = "level", ["value"] = level },
            }.ToString(Newtonsoft.Json.Formatting.None), out var code), code);
            rig.Tick(0f);
            host.SetActiveLevel(rig.Visibility.State.ActiveLevel);
        }

        // ------------------------------------------------------------------ helpers

        /// <summary>The pixel of one document point, in the shell's top-left origin payload space.</summary>
        JObject Pointer(double docX, double docY, double docZ, int button = 0, int buttons = 1,
            double? timeMs = null) {
            var world = StationCoordinates.Point(new Vector3((float)docX, (float)docY, (float)docZ));
            var viewport = camera.WorldToViewportPoint(world);
            Assert.IsTrue(viewport.x > 0.02f && viewport.x < 0.98f && viewport.y > 0.02f && viewport.y < 0.98f,
                "the fixture aims through the rendered view, not a point the payload clamps: " + docX + "," + docY);
            var screen = camera.WorldToScreenPoint(world);
            var payload = new JObject {
                ["x"] = screen.x,
                ["y"] = Mathf.Max(1f, Screen.height) - screen.y,
                ["w"] = Mathf.Max(1f, Screen.width),
                ["h"] = Mathf.Max(1f, Screen.height),
                ["pointerId"] = 1,
                ["button"] = button,
                ["buttons"] = buttons,
                ["toolGeneration"] = StationToolSelection.Generation,
                ["documentRevision"] = host.CurrentRevision,
            };
            if (timeMs.HasValue) payload["time"] = timeMs.Value;
            return payload;
        }

        JObject Handle(string type, JObject payload) {
            var reply = new JObject();
            Assert.IsTrue(StationPointerRouter.Handle(host, type, payload, reply, out var code, out var reason),
                type + " " + payload + " -> " + code + " " + reason);
            return reply;
        }

        static JObject CellsOf(JObject reply) => reply["cells"] as JObject;

        /// <summary>The drawn cell at one authored block, read back through the picker.</summary>
        void AssertDrawn(int x, int y, int z) {
            var screen = camera.WorldToScreenPoint(StationCoordinates.Point(
                new Vector3(x + .5f, y + .5f, z + 1f)));
            var hit = StationScenePicker.Pick(host.Coordinator.World, camera, screen,
                rig.Visibility.State.ActiveLevel, rig.Visibility, null, false);
            Assert.IsNotNull(hit, "the committed cell must be a pickable drawn surface");
            Assert.IsTrue(hit.HasCell, "the cell (" + x + "," + y + "," + z + ") is drawn");
            Assert.AreEqual(new StationCellKey(x, y, z), hit.CellKey,
                "the drawn block at the aimed cell is the one the release laid");
        }

        static void AssertSolid(StationGameHost host, int x, int y, int z) {
            var cell = host.Index.GetCell(x, y, z);
            Assert.IsNotNull(cell, "cell (" + x + "," + y + "," + z + ") must exist");
            Assert.IsTrue(cell.IsSolid, "cell (" + x + "," + y + "," + z + ") must be solid");
        }

        /// <summary>An empty plan point well outside the fixture's floor slab, inside the view.</summary>
        const double VoidX = 10.5, VoidY = 10.5;

        // -------------------------------------------------------------------- cases

        [Test]
        public void ABlockPlacesInTheVoidAtANegativeDepth() {
            Open(Slab(-5), 0, -5);
            int revision = host.CurrentRevision;

            var down = Handle("pointer.down", Pointer(VoidX, VoidY, -4f));
            Assert.IsNull(down["miss"], "the plane answered instead of a miss: " + down);
            var cells = CellsOf(down);
            Assert.IsNotNull(cells, "the press drew a plan: " + down);
            Assert.AreEqual("add", (string)cells["kind"]);
            Assert.IsTrue((bool)cells["ok"], "the ghost drew the floating cell: " + cells);
            Assert.AreEqual(-5, (int)cells["cursor"][2], "the ghost sits at the edited depth");

            Handle("pointer.up", Pointer(VoidX, VoidY, -4f));
            Assert.AreEqual(revision + 1, host.CurrentRevision, "the release is one revision");
            AssertSolid(host, 10, 10, -5);
            AssertDrawn(10, 10, -5);

            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var code), code);
            Assert.IsNull(host.Index.GetCell(10, 10, -5), "undo removes the floating block");
            Assert.AreEqual(revision + 2, host.CurrentRevision, "undo is one more revision");
        }

        [Test]
        public void ABlockPlacesInTheVoidAtAPositiveDepth() {
            Open(Slab(-5), 0, 5);
            int revision = host.CurrentRevision;
            var down = Handle("pointer.down", Pointer(VoidX, VoidY, 6f));
            var cells = CellsOf(down);
            Assert.IsNotNull(cells, down.ToString());
            Assert.AreEqual("add", (string)cells["kind"], "the press drew the add ghost: " + cells);
            Assert.AreEqual(5, (int)cells["cursor"][2]);
            Handle("pointer.up", Pointer(VoidX, VoidY, 6f));
            Assert.AreEqual(revision + 1, host.CurrentRevision);
            AssertSolid(host, 10, 10, 5);
            AssertDrawn(10, 10, 5);
        }

        [Test]
        public void AShiftedOriginPlacesOnItsOwnDepthPlane() {
            // levelBase 2 shifts the ladder to 2, 7, 12, …: the plane is still the edited
            // depth, and the authored cell keeps that level rather than a band index.
            Open(Slab(7), 2, 7);
            int revision = host.CurrentRevision;
            var down = Handle("pointer.down", Pointer(VoidX, VoidY, 8f));
            var cells = CellsOf(down);
            Assert.IsNotNull(cells, down.ToString());
            Assert.AreEqual("add", (string)cells["kind"], down.ToString());
            Assert.AreEqual(7, (int)cells["cursor"][2]);
            Handle("pointer.up", Pointer(VoidX, VoidY, 8f));
            Assert.AreEqual(revision + 1, host.CurrentRevision);
            AssertSolid(host, 10, 10, 7);
            AssertDrawn(10, 10, 7);
        }

        [Test]
        public void AVisibleNearerFaceStillWinsOverThePlane() {
            Open(Slab(-5), 0, -5);
            // Nothing drawn at the void pixel yet: the first press lays the floater.
            Handle("pointer.down", Pointer(VoidX, VoidY, -4f));
            Handle("pointer.up", Pointer(VoidX, VoidY, -4f));
            AssertSolid(host, 10, 10, -5);
            int revision = host.CurrentRevision;

            // The same pixel now meets that block's **drawn top**: the anchor is the cell above
            // it, so the next block stacks rather than landing on the plane again.
            var down = Handle("pointer.down", Pointer(VoidX, VoidY, -4f));
            var cells = CellsOf(down);
            Assert.IsNotNull(cells, down.ToString());
            Assert.AreEqual(-4, (int)cells["cursor"][2],
                "a visible surface ahead of the plane anchors one cell above it: " + cells);
            Handle("pointer.up", Pointer(VoidX, VoidY, -4f));
            Assert.AreEqual(revision + 1, host.CurrentRevision);
            AssertSolid(host, 10, 10, -4);
            AssertDrawn(10, 10, -4);
        }

        [Test]
        public void ARectangleDragGrowsFromThePlane() {
            Open(Slab(-5), 0, -5);
            int revision = host.CurrentRevision;
            // A deliberate press: 200 ms held and more than 4 px of travel (`LONG_PRESS_MS`).
            Handle("pointer.down", Pointer(VoidX, VoidY, -4f, timeMs: 1000));
            var aim = Handle("pointer.move", Pointer(12.5f, 12.5f, -4f, button: 0, buttons: 1, timeMs: 1200));
            var cells = CellsOf(aim);
            Assert.IsNotNull(cells, aim.ToString());
            Assert.AreEqual("add", (string)cells["kind"], aim.ToString());
            Assert.AreEqual(3, (int)cells["measure"]["length"], "a 3-cell run along x");
            Assert.AreEqual(3, (int)cells["measure"]["width"], "and along y");
            Assert.AreEqual(9, ((JArray)cells["accepted"]).Count,
                "the whole 3 × 3 footprint is accepted from the plane");

            Handle("pointer.up", Pointer(12.5f, 12.5f, -4f, timeMs: 1400));
            Assert.AreEqual(revision + 1, host.CurrentRevision, "the whole rectangle is one revision");
            for (int x = 10; x <= 12; x++) {
                for (int y = 10; y <= 12; y++) AssertSolid(host, x, y, -5);
            }
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var code), code);
            Assert.IsNull(host.Index.GetCell(12, 12, -5), "one undo frame takes the whole rectangle");
        }

        [Test]
        public void OccupiedGroundIsANoOpInsteadOfAHole() {
            Open(Slab(-5), 0, 0);
            int revision = host.CurrentRevision;
            // At grade the untouched street is already floor: the plane answers with the grade
            // cell, the planner ignores it, so the release changes nothing and no hole record
            // is invented (`addCells` drops a hole only where a void record really exists).
            var down = Handle("pointer.down", Pointer(VoidX, VoidY, 1f));
            var cells = CellsOf(down);
            Assert.IsNotNull(cells, down.ToString());
            Assert.AreEqual(0, (int)cells["cursor"][2], "the plane cell is the grade ground itself");
            Assert.AreEqual(0, ((JArray)cells["accepted"]).Count,
                "an occupied ground cell is no candidate: " + down);
            Handle("pointer.up", Pointer(VoidX, VoidY, 1f));
            Assert.AreEqual(revision, host.CurrentRevision, "an occupied ground cell is not a write");
            Assert.IsNull(host.Index.GetCell(10, 10, 0), "no hole record was invented");
        }

        [Test]
        public void EraseInTheVoidNeverSynthesizesARemoval() {
            Open(Slab(-5), 0, -5);
            int revision = host.CurrentRevision;
            int picksBefore = StationScenePicker.PickCount;
            var reply = Handle("pointer.down", Pointer(VoidX, VoidY, -4f, button: 2, buttons: 2));
            Assert.AreEqual(1, StationScenePicker.PickCount - picksBefore, "one scene pick per event");
            var eraseHit = reply["hit"] as JObject;
            Assert.AreEqual("none", eraseHit?["targetKind"]?.ToString(),
                "the secondary button resolves no work-plane cell: " + reply);
            Assert.IsNull(CellsOf(reply), "no erase plan is drawn in empty air");
            Assert.IsFalse(StationCellTool.HasGesture, "no erase gesture was armed");
            Handle("pointer.up", Pointer(VoidX, VoidY, -4f, button: 2, buttons: 0));
            Assert.AreEqual(revision, host.CurrentRevision, "erase-in-void changes nothing");
            Assert.IsNull(host.Index.GetCell(10, 10, -5), "and writes no cell");
        }

        [Test]
        public void AStationaryRefreshKeepsThePlaneItWouldClick() {
            Open(Slab(-5), 0, -5);
            var aim = Handle("pointer.move", Pointer(VoidX, VoidY, -4f, button: 0, buttons: 0));
            var cells = CellsOf(aim);
            Assert.IsNotNull(cells, aim.ToString());
            Assert.AreEqual("add", (string)cells["kind"], aim.ToString());
            Assert.AreEqual(-5, (int)cells["cursor"][2]);
            // R / a settings change re-aims the cached pointer through the same policy.
            Assert.IsTrue(StationPointerRouter.RefreshHover(host), "the stationary refresh re-aimed");
            Assert.AreEqual(-5, StationCellTool.Preview.Cursor.Z,
                "the refreshed ghost still sits on the edited depth plane");
        }

        [Test]
        public void ACommitReAimsTheGhostOnTheNextFrameNotInsideTheRelease() {
            // Plan 29 §3: the release pays its own scene pick and nothing else; the ghost under
            // the still pointer is re-aimed by one coalesced refresh on the following frame.
            Open(Slab(-5), 0, -5);
            int picks = StationScenePicker.PickCount;
            Handle("pointer.down", Pointer(VoidX, VoidY, -4f));
            Assert.AreEqual(picks + 1, StationScenePicker.PickCount, "the press resolves one pick");
            Handle("pointer.up", Pointer(VoidX, VoidY, -4f));
            Assert.AreEqual(picks + 2, StationScenePicker.PickCount,
                "the release resolves its own pick only, never a second one inside the install");
            Assert.IsTrue(host.HoverRefreshPending, "the commit asked for the coalesced re-aim");

            var update = typeof(StationGameHost).GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(update, "the host tick is the frame that owns the deferred refresh");
            update.Invoke(host, null);
            Assert.AreEqual(picks + 3, StationScenePicker.PickCount, "the next frame re-aims exactly once");
            Assert.IsFalse(host.HoverRefreshPending);
            update.Invoke(host, null);
            Assert.AreEqual(picks + 3, StationScenePicker.PickCount, "an idle frame picks nothing");
        }
    }
}
