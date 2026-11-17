using System;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §5: the 人行道 / 草坪 tile brushes. The fixture is the cell planner's 12 × 12
    /// pavement, so the outdoor branch's refusals (a block above, a dug hole, a reserved
    /// opening) and the one-finish-per-tile replacement rule are all reachable.
    /// </summary>
    public sealed class StationSurfaceToolTests {
        StationGameHost host;
        GameObject hostObject;

        [SetUp]
        public void SetUp() {
            StationEditSession.Reset();
            StationSurfaceTool.Reset();
            StationToolSelection.Reset();
            hostObject = new GameObject(StationGameHost.ObjectName);
            host = hostObject.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            awake.Invoke(host, null);
            var opened = host.OpenDocument(StationCellFixture.Save, "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
        }

        [TearDown]
        public void TearDown() {
            StationEditHost.ResetForTests();
            if (hostObject != null) UnityEngine.Object.DestroyImmediate(hostObject);
            hostObject = null;
            host = null;
            StationEditSession.Reset();
            StationSurfaceTool.Reset();
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        static StationPointerEvent Pointer(float x, float y, double timeMs, int button = 0) =>
            StationPointerEvent.Synthetic(x, y, 800, 600, button: button, timeMs: timeMs);

        void ArmTile(string type) {
            Assert.IsTrue(StationToolSelection.TrySelect("module", out _, out var code), code);
            StationToolSelection.ApplySettings(new JObject { ["moduleType"] = type, ["rotation"] = 0 });
        }

        int Tiles(string type) {
            int count = 0;
            foreach (var module in host.Index.Document.Modules) if (module.Type == type) count++;
            return count;
        }

        string TileAt(int x, int y, int z) => StationSurfacePlanner.SurfaceAt(host.Index, x, y, z);

        // ------------------------------------------------------------------ planner

        [Test]
        public void APavingDragPavesEveryFloorCellItCovers() {
            ArmTile("sidewalk");
            int before = host.CurrentRevision;
            var down = StationCellFixture.Hit(4, 4, 0, true);
            Assert.IsTrue(StationSurfaceTool.Begin(host, down, Pointer(100, 100, 0), 0, out var reason), reason);
            var far = StationCellFixture.Hit(5, 5, 0, true);
            StationSurfaceTool.Aim(host, far, Pointer(200, 200, 240));
            Assert.AreEqual(4, StationSurfaceTool.Preview.Cells.Count, "a 2 × 2 rectangle");
            Assert.AreEqual(before, host.CurrentRevision, "the preview never edits");
            Assert.IsTrue(StationSurfaceTool.Finish(host, far, Pointer(200, 200, 280), out var code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "one drag, one revision");
            for (int x = 4; x <= 5; x++)
                for (int y = 4; y <= 5; y++)
                    Assert.AreEqual("sidewalk", TileAt(x, y, 0), "tile " + x + "," + y);
        }

        [Test]
        public void ATileRefusesACellWithABlockAboveAndAHoleUnderIt() {
            var world = StationCellEditWorld.Build(host.Index);
            // (3,3) carries the fixture's half wall one course up; (1,1) is a dug hole.
            var above = StationSurfacePlanner.Plan(host.Index, world,
                new[] { new StationCellKey(3, 3, 0) }, "sidewalk", 0, false);
            Assert.AreEqual(0, above.Adds.Count);
            Assert.AreEqual("occupied", above.Reason, "a solid course above the tile refuses it");
            var hole = StationSurfacePlanner.Plan(host.Index, world,
                new[] { new StationCellKey(1, 1, 0) }, "sidewalk", 0, false);
            Assert.AreEqual(0, hole.Adds.Count);
            Assert.AreEqual("floor", hole.Reason, "a dug hole is not floor");
        }

        [Test]
        public void LawnReplacesSidewalkAndTheEraserTakesOnlyItsOwnKind() {
            ArmTile("sidewalk");
            var cell = StationCellFixture.Hit(4, 4, 0, true);
            StationSurfaceTool.Begin(host, cell, Pointer(100, 100, 0), 0, out _);
            Assert.IsTrue(StationSurfaceTool.Finish(host, cell, Pointer(100, 100, 40), out var code, out var reason), code ?? reason);
            Assert.AreEqual("sidewalk", TileAt(4, 4, 0));
            // Lawn on the same tile is a replacement, not a second finish.
            ArmTile("lawn");
            int before = host.CurrentRevision;
            StationSurfaceTool.Begin(host, cell, Pointer(100, 100, 100), 0, out reason);
            Assert.IsTrue(StationSurfaceTool.Finish(host, cell, Pointer(100, 100, 140), out code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "the replacement is one revision");
            Assert.AreEqual("lawn", TileAt(4, 4, 0), "the tile changed hands");
            Assert.AreEqual(0, Tiles("sidewalk"), "and carries one finish only");
            // The sidewalk brush's own secondary press does not lift a lawn tile.
            ArmTile("sidewalk");
            before = host.CurrentRevision;
            StationSurfaceTool.Begin(host, cell, Pointer(100, 100, 200, 2), 2, out reason);
            Assert.IsFalse(StationSurfaceTool.HasGesture, "there is no sidewalk here to lift");
            Assert.AreEqual("no-surface", reason);
            Assert.AreEqual(before, host.CurrentRevision);
            // The lawn brush's secondary press does.
            ArmTile("lawn");
            Assert.IsTrue(StationSurfaceTool.Begin(host, cell, Pointer(100, 100, 300, 2), 2, out reason), reason);
            Assert.IsTrue(StationSurfaceTool.Finish(host, cell, Pointer(100, 100, 340, 2), out code, out reason), code ?? reason);
            Assert.AreEqual("", TileAt(4, 4, 0), "the lawn is gone");
        }

        [Test]
        public void OneTileDragIsOneUndoEntry() {
            ArmTile("sidewalk");
            var down = StationCellFixture.Hit(4, 4, 0, true);
            StationSurfaceTool.Begin(host, down, Pointer(100, 100, 0), 0, out _);
            var far = StationCellFixture.Hit(6, 5, 0, true);
            StationSurfaceTool.Aim(host, far, Pointer(260, 200, 240));
            Assert.AreEqual(6, StationSurfaceTool.Preview.Cells.Count, "a 3 × 2 rectangle");
            Assert.IsTrue(StationSurfaceTool.Finish(host, far, Pointer(260, 200, 280), out var code, out var reason), code ?? reason);
            Assert.AreEqual(6, Tiles("sidewalk"));
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.AreEqual(0, Tiles("sidewalk"), "one undo lifts the whole rectangle");
        }

        [Test]
        public void AnAlreadyPavedTileIsAnIgnoredNoOp() {
            ArmTile("sidewalk");
            var cell = StationCellFixture.Hit(4, 4, 0, true);
            StationSurfaceTool.Begin(host, cell, Pointer(100, 100, 0), 0, out _);
            Assert.IsTrue(StationSurfaceTool.Finish(host, cell, Pointer(100, 100, 40), out var code, out var reason), code ?? reason);
            int before = host.CurrentRevision;
            StationSurfaceTool.Begin(host, cell, Pointer(100, 100, 100), 0, out reason);
            Assert.AreEqual(0, StationSurfaceTool.Preview.Cells.Count, "the tile already reads that way");
            Assert.IsFalse(StationSurfaceTool.Finish(host, cell, Pointer(100, 100, 140), out _, out reason));
            Assert.AreEqual("nothing-to-do", reason);
            Assert.AreEqual(before, host.CurrentRevision);
        }

        [Test]
        public void AStaleTileReleaseIsRefused() {
            ArmTile("sidewalk");
            var cell = StationCellFixture.Hit(4, 4, 0, true);
            Assert.IsTrue(StationSurfaceTool.Begin(host, cell, Pointer(100, 100, 0), 0, out _));
            // Something else commits while the button is held.
            StationToolSelection.TrySelect("block", out _, out _);
            var plan = StationCellPlanner.PlanAddCells(StationCellEditWorld.Build(host.Index),
                new[] { new StationCellKey(7, 7, 1) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan, "place", null, out _, out var code), code);
            Assert.IsFalse(StationSurfaceTool.Finish(host, cell, Pointer(100, 100, 200), out _, out var reason));
            Assert.AreEqual("stale-revision", reason);
            Assert.AreEqual("", TileAt(4, 4, 0), "the stale release paved nothing");
        }
    }
}
