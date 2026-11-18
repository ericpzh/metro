using System;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §1/§3: the block brush's pure planner. Every case here asks the same question
    /// the ghost asks on hover, so the table doubles as the inventory of what F accepts and
    /// refuses. The fixture is the TypeScript game's own rules (`build/validation.ts`,
    /// `sim/placement.ts`, `build/model/{Cells,Floors,Walls,Ceilings}.ts`).
    /// </summary>
    public sealed class StationCellPlannerTests {
        StationGameHost host;
        GameObject hostObject;

        [SetUp]
        public void SetUp() {
            StationCellTool.Reset();
            StationEditSession.Reset();
            StationScenePicker.Reset();
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
            StationCellTool.Reset();
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        StationCellEditWorld World() => StationCellEditWorld.Build(host.Index);

        // ------------------------------------------------------------------- math

        [Test]
        public void RectangleAndLineCellMathMatchTheReference() {
            var a = new StationCellKey(1, 1, 0);
            var b = new StationCellKey(3, 2, 0);
            var rect = StationCellPlanner.RectCells(a, b, 0, false);
            Assert.AreEqual(6, rect.Count, "3 × 2 rectangle");
            Assert.AreEqual(6, StationCellPlanner.DragCellCount(a, b, false));
            var line = StationCellPlanner.RectCells(a, b, 0, true);
            Assert.AreEqual(3, line.Count, "a Shift line walks the longer axis");
            Assert.AreEqual(3, StationCellPlanner.DragCellCount(a, b, true));
            // A 三角 hugging east/west is cut across x, so its ridge runs north–south.
            Assert.AreEqual(2, StationCellPlanner.CutLineCellCount(a, b, StationWallSide.E));
            Assert.AreEqual(3, StationCellPlanner.CutLineCellCount(a, b, StationWallSide.N));
            var ridge = StationCellPlanner.TriangleLineCells(a, b, 0, StationWallSide.E);
            Assert.AreEqual(2, ridge.Count);
            Assert.AreEqual(1, ridge[0].X, "the run keeps the anchor's x");
            Assert.AreEqual(2, ridge[1].Y, "and travels toward the target");
        }

        // ---------------------------------------------------------------- verdicts

        [Test]
        public void AFreeCellIsAcceptedAndTheStreetIsNotACandidate() {
            var world = World();
            var free = StationCellPlanner.CheckBlockCells(world, new[] { new StationCellKey(4, 4, 1) });
            Assert.AreEqual(1, free.Accepted.Count, "a free cell above the floor is a candidate");
            Assert.AreEqual("", free.Reason);
            // The street is already floor: neither accepted nor refused.
            var street = StationCellPlanner.CheckBlockCells(world, new[] { new StationCellKey(2, 6, 0) });
            Assert.AreEqual(0, street.Accepted.Count);
            Assert.AreEqual(0, street.Blocked.Count);
            Assert.AreEqual(1, street.Ignored.Count, "virtual ground is not a refusal");
        }

        [Test]
        public void AHeldCellIsIgnoredAndEquipmentRefusesWithItsOwnBlocker() {
            var world = World();
            var held = StationCellPlanner.CheckBlockCells(world, new[] { new StationCellKey(2, 2, 0) });
            Assert.AreEqual(1, held.Ignored.Count, "the floor the station already holds is not a candidate");
            Assert.AreEqual(0, held.Blocked.Count);

            var bench = StationCellPlanner.CheckBlockCells(world, new[] { new StationCellKey(2, 2, 1) });
            Assert.AreEqual(1, bench.Blocked.Count, "a block may not share the bench's column");
            Assert.AreEqual("equipment", bench.Reason);
            CollectionAssert.Contains(bench.ColliderIds, "bench-1");
        }

        [Test]
        public void AnExitHeadHouseLaysAReservedOpening() {
            var world = World();
            Assert.IsTrue(host.Index.TryGetModule("exit-1", out var exit));
            var footprint = StationFootprints.ExitFootprint(exit);
            Assert.Greater(footprint.Length, 0, "the fixture's exit has a floor");
            int checkedCells = 0;
            foreach (var at in footprint) {
                int x = (int)Math.Round(at.X), y = (int)Math.Round(at.Y);
                if (!world.IsExitFloor(x, y, 0)) continue;
                // A block may not be poured into an exit's floor, whatever else stands there.
                var verdict = StationCellPlanner.BlockReason(world, x, y, 0);
                Assert.IsFalse(verdict.Ok, "the exit's floor at " + x + "," + y + " refuses a block");
                Assert.AreEqual("opening", verdict.Reason);
                checkedCells++;
            }
            Assert.Greater(checkedCells, 0, "the exit lays floor over its own footprint");
        }

        // ----------------------------------------------------------------- release

        [Test]
        public void LayingABlockOnTheStreetDropsTheHoleRecordInsteadOfWritingOne() {
            var world = World();
            // (1, 1, 0) is a dug hole in the fixture: a `void` record at grade.
            Assert.IsTrue(world.IsVoid(1, 1, 0));
            Assert.IsFalse(world.IsSolid(1, 1, 0));
            var plan = StationCellPlanner.PlanAddCells(world, new[] { new StationCellKey(1, 1, 0) });
            Assert.IsTrue(plan.HasWork);
            Assert.AreEqual(StationCellWriteMode.Remove, plan.Writes[0].Mode, "at grade the block is the street itself");
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan, "place", null, out var applied, out var code), code);
            Assert.IsTrue(applied.Accepted);
            Assert.IsNull(host.Index.GetCell(1, 1, 0), "absence means ground again");
        }

        [Test]
        public void LayingABlockInTheAirAddsOneSolidRecord() {
            var world = World();
            var plan = StationCellPlanner.PlanAddCells(world, new[] { new StationCellKey(4, 4, 1) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan, "place", null, out _, out var code), code);
            var cell = host.Index.GetCell(4, 4, 1);
            Assert.IsNotNull(cell);
            Assert.IsTrue(cell.IsSolid);
            var reopened = StationDocumentReader.Read(host.SaveDocument(), StationSource.None);
            bool found = false;
            foreach (var record in reopened.Document.Cells) {
                if (record.X == 4 && record.Y == 4 && record.Z == 1 && record.IsSolid) found = true;
            }
            Assert.IsTrue(found, "the committed text carries the block");
        }

        [Test]
        public void DiggingAGradeBlockLeavesAHoleAndTakesTheHostedPieceWithIt() {
            var world = World();
            // (2, 2, 0) holds the bench; the same drag takes the floor under it.
            var plan = StationCellPlanner.PlanRemoveCells(world, new[] { new StationCellKey(2, 2, 0) });
            Assert.IsTrue(plan.HasWork);
            CollectionAssert.Contains(plan.RemoveModuleIds, "bench-1", "removeCells takes a hosted module");
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan, "erase", null, out _, out var code), code);
            var hole = host.Index.GetCell(2, 2, 0);
            Assert.IsNotNull(hole, "a dug street leaves a hole record");
            Assert.IsFalse(hole.IsSolid);
            Assert.IsNull(host.Index.GetModule("bench-1"));
        }

        [Test]
        public void APatchRaisesItsRingAndTheRingSkipsPiecesAlreadyInTheWay() {
            var world = World();
            var patch = new[] {
                new StationCellKey(4, 4, 1), new StationCellKey(5, 4, 1),
                new StationCellKey(4, 5, 1), new StationCellKey(5, 5, 1),
            };
            var check = StationCellPlanner.CheckBlockCells(world, patch);
            Assert.AreEqual(4, check.Accepted.Count);
            var ring = StationCellPlanner.PlannedAutoWalls(world, check.Accepted, world.StoreyHeight);
            Assert.Greater(ring.Count, 0, "an outer edge earns a wall column");
            foreach (var course in ring) Assert.AreNotEqual(1, course.Z, "a ring never stands on the patch's own course");
            var plan = StationCellPlanner.PlanAutoFloor(world, patch);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan, "floor", null, out _, out var code), code);
            foreach (var cell in patch) {
                var record = host.Index.GetCell(cell.X, cell.Y, cell.Z);
                Assert.IsNotNull(record, "the patch laid " + cell);
                Assert.IsTrue(record.HasTag("auto-floor"));
            }
            int walls = 0;
            foreach (var cell in host.Index.Document.Cells) if (cell.HasTag("auto-wall")) walls++;
            Assert.GreaterOrEqual(walls, ring.Count, "the release raises the ring the ghost drew");
        }

        [Test]
        public void AHalfWallCourseTagsTheCellAndACornerMergesIntoIt() {
            var world = World();
            var half = StationCellShape.Half(StationWallSide.N);
            var plan = StationCellPlanner.PlanCut(world, new[] { new StationCellKey(4, 4, 1) }, half);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan, "half wall", null, out _, out var code), code);
            var cell = host.Index.GetCell(4, 4, 1);
            Assert.IsTrue(cell.HasTag("wall"));
            Assert.IsTrue(cell.HasTag("half-wall:n"), "the piece is tagged with its absolute side");

            // A corner on the free quarter of the same cell merges rather than adding a record.
            // A 半墙 hugging n keeps the two north quarters, so the free piece is a south corner.
            var worldAfter = World();
            var corner = StationCellShape.Corner(StationWallSide.S);
            var merge = StationCellPlanner.CutCourseReason(worldAfter, 4, 4, 1, corner);
            Assert.AreEqual(StationCutVerdict.Merge, merge.Verdict, "disjoint quarters share the cell");
            var mergePlan = StationCellPlanner.PlanCut(worldAfter, new[] { new StationCellKey(4, 4, 1) }, corner);
            Assert.AreEqual(StationCellWriteMode.AppendTags, mergePlan.Writes[0].Mode);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, mergePlan, "corner", null, out _, out var code2), code2);
            var merged = host.Index.GetCell(4, 4, 1);
            Assert.IsTrue(merged.HasTag("half-wall:n"), "the earlier piece survives the merge");
            Assert.IsTrue(merged.HasTag("half-corner:s"));

            // A second half wall on the same side overlaps the first: refused, never doubled.
            var again = StationCellPlanner.CutCourseReason(World(), 4, 4, 1, half);
            Assert.AreEqual(StationCutVerdict.Refuse, again.Verdict);
            Assert.AreEqual("occupied", again.Reason);
        }

        [Test]
        public void AFreshFullBlockIsNotACutCandidate() {
            // The reference refuses to turn an ordinary block into a half wall: a cut may only
            // join an existing **cut** cell, never replace authored floor.
            var world = World();
            var verdict = StationCellPlanner.CutCourseReason(world, 7, 2, 0, StationCellShape.Half(StationWallSide.N));
            Assert.AreEqual(StationCutVerdict.Skip, verdict.Verdict);
        }

        [Test]
        public void ASuspendedCeilingCellCarriesTheBaffleFinish() {
            var world = World();
            var plan = StationCellPlanner.PlanSuspendedCeiling(world, new[] { new StationCellKey(4, 4, 1) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan, "ceiling", null, out _, out var code), code);
            var cell = host.Index.GetCell(4, 4, 1);
            Assert.IsTrue(cell.HasTag("suspended-ceiling"));
            Assert.AreEqual("ceil.baffle", cell.FinishOf("top"));
            Assert.AreEqual("ceil.baffle", cell.FinishOf("bottom"));
        }

        // ------------------------------------------------------------- transaction

        [Test]
        public void OneGestureIsOneRevisionAndUndoRestoresTheCells() {
            int before = host.CurrentRevision;
            var world = World();
            var plan = StationCellPlanner.PlanAutoFloor(world, new[] {
                new StationCellKey(4, 4, 1), new StationCellKey(5, 4, 1),
            });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan, "floor", "cell-1", out _, out var code), code);
            Assert.AreEqual(before + 1, host.CurrentRevision, "one gesture, one revision");
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsNull(host.Index.GetCell(4, 4, 1), "undo restores the previous envelope");
            Assert.AreEqual(before + 2, host.CurrentRevision, "the undo is one more revision");
            // A repeated command id is an ack, never a second revision.
            int revision = host.CurrentRevision;
            var again = StationCellPlanner.PlanAutoFloor(World(), new[] { new StationCellKey(4, 4, 1) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, again, "floor", "cell-2", out _, out code), code);
            Assert.IsFalse(StationEditSession.TryApplyCells(host, again, "floor", "cell-2", out _, out var duplicate));
            Assert.AreEqual("duplicate-command", duplicate);
            Assert.AreEqual(revision + 1, host.CurrentRevision, "the retry never added a revision");
        }

        [Test]
        public void AMergeKeepsTheAuthoredZoneRoomAndFinishItDidNotName() {
            // The fixture authors a half wall at (3, 3, 1) with a zone and a finish. A corner
            // merged into it appends one tag; everything else the record carries must travel.
            var world = World();
            host.Index.TryGetCell(3, 3, 1, out var authored);
            Assert.IsNotNull(authored);
            Assert.AreEqual("concourse", authored.Zone);
            var plan = StationCellPlanner.PlanCut(world, new[] { new StationCellKey(3, 3, 1) },
                StationCellShape.Corner(StationWallSide.S));
            Assert.AreEqual(StationCellWriteMode.AppendTags, plan.Writes[0].Mode, "a merge patches tags only");
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan, "corner", null, out _, out var code), code);
            var after = host.Index.GetCell(3, 3, 1);
            Assert.AreEqual("concourse", after.Zone, "an unknown authored field travels with the cell");
            Assert.AreEqual("floor.vinyl", after.FinishOf("top"));
            Assert.IsTrue(after.HasTag("half-wall:n"));
            Assert.IsTrue(after.HasTag("half-corner:s"));
        }

        [Test]
        public void TheCellToolBuildsItsSingleCellFromAPress() {
            int before = host.CurrentRevision;
            StationToolSelection.TrySelect("block", out _, out _);
            var hit = StationCellFixture.Hit(4, 4, 0, true);
            Assert.IsTrue(StationCellTool.Begin(host, hit, "block", 0,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 1000), out var reason), reason);
            Assert.IsNotNull(StationCellTool.Preview.ToJson(), "a press immediately aims a plan");
            Assert.AreEqual(1, StationCellTool.Preview.Check.Accepted.Count, "a quick press is one cell");
            Assert.IsTrue(StationCellTool.Finish(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 1100), out var code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision);
            Assert.IsNotNull(host.Index.GetCell(4, 4, 1));
        }

        [Test]
        public void ADeliberateDragLaysTheRectangle() {
            StationToolSelection.TrySelect("block", out _, out _);
            var down = StationCellFixture.Hit(4, 4, 0, true);
            StationCellTool.Begin(host, down, "block", 0,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), out _);
            // 200 ms later, 40 px away: a deliberate drag (`LONG_PRESS_MS` + `DRAG_PX`).
            var far = StationCellFixture.Hit(5, 4, 0, true);
            StationCellTool.Aim(host, far, StationPointerEvent.Synthetic(140, 100, 800, 600, timeMs: 200));
            Assert.AreEqual(2, StationCellTool.Preview.Check.Cells.Count, "the drag grew a second cell");
            Assert.IsTrue(StationCellTool.Finish(host, far,
                StationPointerEvent.Synthetic(140, 100, 800, 600, timeMs: 260), out var code, out var reason), code ?? reason);
            Assert.IsNotNull(host.Index.GetCell(4, 4, 1));
            Assert.IsNotNull(host.Index.GetCell(5, 4, 1), "a rectangle is laid whole");
        }

        [Test]
        public void AnOversizedDragIsRefusedWhole() {
            StationToolSelection.TrySelect("block", out _, out _);
            var down = StationCellFixture.Hit(0, 0, 0, true);
            StationCellTool.Begin(host, down, "block", 0,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), out _);
            var far = StationCellFixture.Hit(120, 120, 0, true);
            StationCellTool.Aim(host, far, StationPointerEvent.Synthetic(400, 400, 800, 600, timeMs: 400));
            Assert.IsTrue(StationCellTool.Preview.OverLimit, "the whole gesture is refused, not clipped");
            Assert.AreEqual(0, StationCellTool.Preview.Check.Accepted.Count);
            int revision = host.CurrentRevision;
            Assert.IsFalse(StationCellTool.Finish(host, far,
                StationPointerEvent.Synthetic(400, 400, 800, 600, timeMs: 460), out _, out var reason));
            Assert.AreEqual("over-limit", reason);
            Assert.AreEqual(revision, host.CurrentRevision, "a refused gesture never edits");
        }

        [Test]
        public void AStaleRevisionEndsTheGestureWithoutAnEdit() {
            StationToolSelection.TrySelect("block", out _, out _);
            var hit = StationCellFixture.Hit(4, 4, 0, true);
            StationCellTool.Begin(host, hit, "block", 0, StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), out _);
            // Another edit moves the document under the press.
            var other = StationCellPlanner.PlanAddCells(World(), new[] { new StationCellKey(7, 7, 1) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, other, "place", null, out _, out _));
            int revision = host.CurrentRevision;
            Assert.IsFalse(StationCellTool.Finish(host, hit, StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 50),
                out _, out var reason));
            Assert.AreEqual("stale-revision", reason);
            Assert.AreEqual(revision, host.CurrentRevision, "a stale release never edits");
        }

        [Test]
        public void ARightPressDigsTheCellUnderThePointer() {
            int before = host.CurrentRevision;
            StationToolSelection.TrySelect("block", out _, out _);
            var hit = StationCellFixture.Hit(2, 2, 0, true);
            Assert.IsTrue(StationCellTool.Begin(host, hit, "block", 2,
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 2, timeMs: 0), out var reason), reason);
            Assert.Greater(StationCellTool.Preview.Check.Accepted.Count, 0, "the erase plan takes the solid cell");
            CollectionAssert.AreEqual(new[] { new StationCellKey(2, 2, 0) }, StationCellTool.Preview.RemovedCells);
            CollectionAssert.AreEqual(new[] { "bench-1" }, StationCellTool.Preview.ModuleIds);
            Assert.IsTrue(StationCellTool.Finish(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 2, timeMs: 20), out var code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision);
            Assert.IsFalse(host.Index.GetCell(2, 2, 0)?.IsSolid ?? false, "the right press dug the block out");
        }

        [Test]
        public void AutoFloorErasePreviewCommitAndHistoryAgree() {
            var fixture = (JObject)StationLocalEditTests.AutoWallFixtures()[1];
            var read = StationLocalEditTests.ReadAutoWallFixture(fixture);
            Assert.IsTrue(host.OpenDocument(read.Document.NormalizedJson, "file").Accepted);
            var before = host.Document.NormalizedJson;
            StationToolSelection.TrySelect("block", out _, out _);
            var hit = StationCellFixture.Hit(0, 0, -7, true);
            Assert.IsTrue(StationCellTool.Begin(host, hit, "block", 2,
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 2, timeMs: 0), out var reason), reason);
            CollectionAssert.AreEquivalent(fixture["cellChanges"]["removed"].ToObject<string[]>(),
                StationCellTool.Preview.RemovedCells.ConvertAll(key => key.ToString()));
            Assert.AreEqual(before, host.Document.NormalizedJson, "preview does not edit the document");
            Assert.IsTrue(StationCellTool.Finish(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 2, timeMs: 20), out var code, out reason), code ?? reason);
            var after = host.Document.NormalizedJson;
            StationLocalEditTests.AssertAutoWallRecords(fixture, before, after);
            var reopened = StationDocumentReader.Read(host.SaveDocument(), StationSource.None);
            StationLocalEditTests.AssertAutoWallRecords(fixture, before, reopened.Document.NormalizedJson);
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsTrue(JToken.DeepEquals(JObject.Parse(before)["static"], JObject.Parse(host.Document.NormalizedJson)["static"]));
            Assert.IsTrue(StationEditSession.TryRedo(host, out _, out code), code);
            Assert.IsTrue(JToken.DeepEquals(JObject.Parse(after)["static"], JObject.Parse(host.Document.NormalizedJson)["static"]));
        }

        // ----------------------------------------------------------------- walls

        [Test]
        public void TheWallSnapStandsAColumnOnTheOpenEdgeAndRStepsTheFace() {
            var world = World();
            // (0, 4, 0) is on the fixture's west edge: its only open side is west, so a wall
            // stands there and faces west with no key pressed.
            var edge = StationCellPlanner.WallSnap(world, new StationCellKey(0, 4, 0), 0.5, 4.5, true, 0);
            Assert.AreEqual(0, edge.Base.X);
            Assert.AreEqual(4, edge.Base.Y);
            Assert.AreEqual(StationWallSide.W, edge.Dir);
            CollectionAssert.Contains(edge.Dirs, StationWallSide.W);
            // On the same edge the cycle still only offers the faces the geometry owns.
            var turned = StationCellPlanner.WallSnap(world, new StationCellKey(0, 4, 0), 0.5, 4.5, true, 1);
            CollectionAssert.Contains(turned.Dirs, StationWallSide.W);
            Assert.AreEqual(1, turned.Dirs.Count, "no other side of a west-edge cell faces open space");
        }

        [Test]
        public void ABuriedCellStepsToTheNearestNeighbourThatFacesOpenSpace() {
            var world = World();
            // (1, 5, 0) has no open edge of its own — every neighbour is floor — but the west
            // edge is one cell away, so the column steps there and faces back at the aim.
            var snap = StationCellPlanner.WallSnap(world, new StationCellKey(1, 5, 0), 1.5, 5.5, true, 0);
            Assert.IsTrue(snap.Base.X == 0, "the column stepped to the edge, got " + snap.Base);
            Assert.LessOrEqual(Math.Abs(snap.Base.X - 1) + Math.Abs(snap.Base.Y - 5), 1,
                "the nearest edge wins");
            Assert.AreEqual(StationWallSide.W, snap.Dir, "it faces back toward the aimed cell");
            // A cell no neighbour can help (the very middle of the fixture) stays put and offers
            // all four faces, so R can still turn it.
            var buried = StationCellPlanner.WallSnap(world, new StationCellKey(5, 5, 0), 5.5, 5.5, true, 0);
            Assert.AreEqual(5, buried.Base.X);
            Assert.AreEqual(4, buried.Dirs.Count, "a buried cell offers every face");
        }

        [Test]
        public void AWallClickLaysAStoreyHighColumnAndItsRightClickLiftsTheStoreyOnly() {
            StationToolSelection.TrySelect("wall", out _, out _);
            // The press is authored floor, so the column stands in the air above it: four
            // courses to the storey's top (z = 1…4), never one poured into the pavement.
            var hit = StationCellFixture.Hit(0, 4, 0, true);
            Assert.IsTrue(StationCellTool.Begin(host, hit, "wall", 0,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), out var reason), reason);
            Assert.AreEqual(4, StationCellTool.Preview.Check.Cells.Count, "one storey of courses");
            Assert.AreEqual(4, StationCellTool.Preview.Check.Accepted.Count);
            Assert.IsTrue(StationCellTool.Finish(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 40), out var code, out reason), code ?? reason);
            for (int z = 1; z <= 4; z++) {
                var course = host.Index.GetCell(0, 4, z);
                Assert.IsNotNull(course, "course z=" + z);
                Assert.IsTrue(course.HasTag("wall"));
            }
            Assert.IsTrue(host.Index.GetCell(0, 4, 0).IsSolid, "the pavement stayed floor");
            // The column's storey lifts on the secondary button, and the storey's floor is kept.
            int before = host.CurrentRevision;
            var right = StationCellFixture.Hit(0, 4, 2, true);
            Assert.IsTrue(StationCellTool.Begin(host, right, "wall", 2,
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 2, timeMs: 100), out reason), reason);
            Assert.AreEqual(4, StationCellTool.Preview.Check.Accepted.Count,
                "the column's courses, without the storey's floor");
            Assert.IsTrue(StationCellTool.Finish(host, right,
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 2, timeMs: 130), out code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision);
            Assert.IsNull(host.Index.GetCell(0, 4, 2), "the wall course is gone");
            Assert.IsNotNull(host.Index.GetCell(0, 4, 0), "the storey's floor is kept");
        }

        [Test]
        public void AWallDragLaysAStraightStoreyHighRun() {
            StationToolSelection.TrySelect("wall", out _, out _);
            var down = StationCellFixture.Hit(0, 3, 0, true);
            StationCellTool.Begin(host, down, "wall", 0,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), out _);
            var far = StationCellFixture.Hit(0, 5, 0, true);
            StationCellTool.Aim(host, far, StationPointerEvent.Synthetic(100, 160, 800, 600, timeMs: 200));
            Assert.IsTrue(StationCellTool.Preview.Check.Accepted.Count > 0);
            Assert.IsTrue(StationCellTool.Finish(host, far,
                StationPointerEvent.Synthetic(100, 160, 800, 600, timeMs: 260), out var code, out var reason), code ?? reason);
            // Two edge columns (y = 3 and y = 5) laid; the interior column between them has no
            // open edge of its own, so the snap keeps the press anchor and only the target adds.
            Assert.IsNotNull(host.Index.GetCell(0, 3, 1), "the press column was laid");
            Assert.IsNotNull(host.Index.GetCell(0, 5, 1), "the drag target column was laid");
        }

        [Test]
        public void AHalfWallRunKeepsOnePanelSideForTheWholeRun() {
            var cells = new[] { new StationCellKey(1, 1, 0), new StationCellKey(2, 1, 0), new StationCellKey(3, 1, 0) };
            var open = new[] { StationWallSide.N, StationWallSide.S };
            // A run along x takes only its perpendicular pair, the open side first.
            var dirs = StationCellPlanner.HalfWallSideDirs(cells, open);
            CollectionAssert.AreEqual(new[] { StationWallSide.N, StationWallSide.S }, dirs);
            Assert.AreEqual(StationWallSide.N, StationCellPlanner.HalfWallRunSide(cells, open, 0));
            Assert.AreEqual(StationWallSide.S, StationCellPlanner.HalfWallRunSide(cells, open, 1));
            // A single column has no axis, so all four sides stay on offer.
            var single = StationCellPlanner.HalfWallSideDirs(new[] { new StationCellKey(1, 1, 0) }, open);
            Assert.AreEqual(4, single.Count);
        }

        [Test]
        public void AHalfWallColumnLaysASingleTaggedCourseWhenAskedForOne() {
            var world = World();
            // One course in the air above the pavement — a 半墙 cannot replace authored floor, so
            // the anchor is the cell the press stepped into.
            var patch = StationCellPlanner.PlanWalls(world, new[] { new StationCellKey(0, 4, 1) },
                StationWallSide.E, 1);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, patch, "half wall", null, out _, out var code), code);
            var course = host.Index.GetCell(0, 4, 1);
            Assert.IsTrue(course.HasTag("wall"));
            Assert.IsTrue(course.HasTag("half-wall:e"));
            Assert.IsNull(host.Index.GetCell(0, 4, 2), "a one-course request lays exactly one course");
            // The course above authored floor cannot be laid as a half wall: the floor block is
            // already there and the cut would replace it.
            var replaced = StationCellPlanner.PlanWalls(world, new[] { new StationCellKey(0, 5, 0) },
                StationWallSide.E, 1);
            Assert.IsFalse(replaced.HasWork, "a 半墙 never replaces a full block");
        }

        // --------------------------------------------------------------- delete

        [Test]
        public void TheDeletePressTakesThePlacedPieceAndCommitsOnRelease() {
            StationToolSelection.TrySelect("delete", out _, out _);
            int before = host.CurrentRevision;
            var hit = StationCellFixture.Hit(2, 2, 1, true);
            hit.Module = host.Index.GetModule("bench-1");
            hit.ModuleExact = true;
            hit.ModuleDistance = 1f;
            Assert.IsTrue(StationCellTool.Begin(host, hit, "delete", 0,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), out var reason), reason);
            CollectionAssert.Contains(StationCellTool.Preview.ModuleIds, "bench-1");
            Assert.IsTrue(StationCellTool.Finish(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 40), out var code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "one piece, one revision");
            Assert.IsNull(host.Index.GetModule("bench-1"));
        }

        [Test]
        public void TheDeleteSweepCollectsSameFamilyPiecesTheDragCrosses() {
            // A second bench of the same variant on the same storey: one drag across both must
            // take them in one commit (so one undo brings the pair back).
            var save = JObject.Parse(host.SaveDocument());
            ((JArray)save["static"]["modules"]).Add(new JObject {
                ["id"] = "bench-2", ["type"] = "bench", ["x"] = 3, ["y"] = 2, ["z"] = 0, ["rot"] = 0,
                ["cfg"] = new JObject { ["variant"] = "steel-1" },
            });
            Assert.IsTrue(host.OpenDocument(save.ToString(Newtonsoft.Json.Formatting.None), "file").Accepted);
            var world = StationCellTool.World(host);
            Assert.IsNotNull(world);
            var bench = host.Index.GetModule("bench-1");
            var other = host.Index.GetModule("bench-2");
            Assert.AreEqual(StationSweep.FamilyOf(bench), StationSweep.FamilyOf(other),
                "the same palette variant is one sweep family");
            StationToolSelection.TrySelect("delete", out _, out _);
            int before = host.CurrentRevision;
            var hit = StationCellFixture.Hit(2, 2, 1, true);
            hit.Module = bench;
            hit.ModuleExact = true;
            hit.ModuleDistance = 1f;
            StationCellTool.Begin(host, hit, "delete", 0,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), out _);
            // The drag crosses the second bench's cell.
            var far = StationCellFixture.Hit(3, 2, 1, true);
            far.Module = other;
            far.ModuleExact = true;
            far.ModuleDistance = 1f;
            StationCellTool.Aim(host, far, StationPointerEvent.Synthetic(180, 100, 800, 600, timeMs: 220));
            CollectionAssert.Contains(StationCellTool.Preview.ModuleIds, "bench-2",
                "the piece the drag crossed joins the sweep");
            Assert.IsTrue(StationCellTool.Finish(host, far,
                StationPointerEvent.Synthetic(180, 100, 800, 600, timeMs: 260), out var code, out var reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "the sweep is one transaction");
            Assert.IsNull(host.Index.GetModule("bench-1"));
            Assert.IsNull(host.Index.GetModule("bench-2"));
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsNotNull(host.Index.GetModule("bench-1"), "one undo puts the run back together");
            Assert.IsNotNull(host.Index.GetModule("bench-2"));
        }

        // ----------------------------------------------------------------- runs

        [Test]
        public void ARunPaletteArmsALineAndLaysOnePanelPerCell() {
            Assert.IsTrue(StationModuleRuns.IsLinePalette("fence"));
            Assert.IsTrue(StationModuleRuns.IsLinePalette("tactile-guide"));
            Assert.IsTrue(StationModuleRuns.IsLinePalette("floor-mark-boarding"));
            Assert.IsFalse(StationModuleRuns.IsLinePalette("bench-steel-1"), "a bench is press-to-place");

            StationToolSelection.TrySelect("module", out _, out _);
            StationToolSelection.ApplySettings(new JObject { ["moduleType"] = "fence", ["rotation"] = 0 });
            var down = StationCellFixture.Hit(0, 2, 0, true);
            Assert.IsTrue(StationCellTool.Begin(host, down, "module", 0,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), out var reason), reason);
            Assert.AreEqual(StationCellGestureKind.ModuleRun, StationCellTool.Gesture.Kind);
            var far = StationCellFixture.Hit(0, 4, 0, true);
            StationCellTool.Aim(host, far, StationPointerEvent.Synthetic(100, 160, 800, 600, timeMs: 220));
            Assert.AreEqual(3, StationCellTool.Preview.Check.Cells.Count, "three cells in the run");
            Assert.AreEqual("run", StationCellTool.Preview.Kind);
            int before = host.CurrentRevision;
            Assert.IsTrue(StationCellTool.Finish(host, far,
                StationPointerEvent.Synthetic(100, 160, 800, 600, timeMs: 260), out var code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "the whole run is one transaction");
            int fences = 0;
            foreach (var module in host.Index.Document.Modules) if (module.Type == "fence") fences++;
            Assert.AreEqual(3, fences, "one panel per run cell");
            var reopened = StationDocumentReader.Read(host.SaveDocument(), StationSource.None);
            int saved = 0;
            foreach (var module in reopened.Document.Modules) if (module.Type == "fence") saved++;
            Assert.AreEqual(3, saved, "the panels reopen from the save text");
        }

        [Test]
        public void ARunRefusesTheCellAPieceAlreadyStandsInAndNamesIt() {
            var template = new StationPlacementRequest { ToolType = "fence", Rotation = 0 };
            // A run's cells are the air the panels go into (the wall brush's convention too).
            // The bench stands at (2, 2): a fence run across it refuses that cell and names the
            // piece, while the free cells around it still lay.
            var plan = StationModuleRuns.PlanAdd(host.Index, template, null, new[] {
                new StationCellKey(1, 2, 1), new StationCellKey(2, 2, 1), new StationCellKey(3, 2, 1),
            }, false);
            Assert.AreEqual(2, plan.Accepted.Count, "the free cells lay");
            Assert.AreEqual(1, plan.Blocked.Count, "the bench's cell is refused");
            CollectionAssert.Contains(plan.ColliderIds, "bench-1");
            foreach (var draft in plan.Accepted) Assert.AreEqual(0, draft.Z, "a panel stands on the floor below its cell");
        }

        [Test]
        public void ARunEraseLiftsOnlyItsOwnVariantAlongTheLine() {
            // A guide path and a warning strip side by side: dragging the guide path back must
            // leave the warning tiles standing.
            var save = JObject.Parse(host.SaveDocument());
            var modules = (JArray)save["static"]["modules"];
            modules.Add(new JObject {
                ["id"] = "tac-guide", ["type"] = "tactile", ["x"] = 5, ["y"] = 3, ["z"] = 0, ["rot"] = 0,
                ["cfg"] = new JObject { ["variant"] = "guide" },
            });
            modules.Add(new JObject {
                ["id"] = "tac-warn", ["type"] = "tactile", ["x"] = 6, ["y"] = 3, ["z"] = 0, ["rot"] = 0,
                ["cfg"] = new JObject { ["variant"] = "warning" },
            });
            Assert.IsTrue(host.OpenDocument(save.ToString(Newtonsoft.Json.Formatting.None), "file").Accepted);
            StationToolSelection.TrySelect("module", out _, out _);
            StationToolSelection.ApplySettings(new JObject { ["moduleType"] = "tactile-guide", ["rotation"] = 0 });
            var down = StationCellFixture.Hit(5, 3, 0, true);
            Assert.IsTrue(StationCellTool.Begin(host, down, "module", 2,
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 2, timeMs: 0), out var reason), reason);
            var far = StationCellFixture.Hit(6, 3, 0, true);
            StationCellTool.Aim(host, far, StationPointerEvent.Synthetic(160, 100, 800, 600, button: 2, timeMs: 220));
            Assert.IsTrue(StationCellTool.Finish(host, far,
                StationPointerEvent.Synthetic(160, 100, 800, 600, button: 2, timeMs: 260), out var code, out var done), code ?? done);
            Assert.IsNull(host.Index.GetModule("tac-guide"), "the dragged variant is lifted");
            Assert.IsNotNull(host.Index.GetModule("tac-warn"), "the other variant keeps standing");
        }

        [Test]
        public void ARunUsesOneHistoryEntrySoUndoRestoresTheWholeLine() {
            StationToolSelection.TrySelect("module", out _, out _);
            StationToolSelection.ApplySettings(new JObject { ["moduleType"] = "fence", ["rotation"] = 0 });
            var down = StationCellFixture.Hit(0, 2, 0, true);
            StationCellTool.Begin(host, down, "module", 0,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), out _);
            var far = StationCellFixture.Hit(0, 4, 0, true);
            StationCellTool.Aim(host, far, StationPointerEvent.Synthetic(100, 160, 800, 600, timeMs: 220));
            Assert.IsTrue(StationCellTool.Finish(host, far,
                StationPointerEvent.Synthetic(100, 160, 800, 600, timeMs: 260), out var code, out var reason), code ?? reason);
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            foreach (var module in host.Index.Document.Modules) {
                Assert.AreNotEqual("fence", module.Type, "one undo removes the whole run");
            }
        }

        // ----------------------------------------------------------------- paint

        [Test]
        public void APaintPressWritesThePickedFaceAndUndoRestoresIt() {
            StationToolSelection.TrySelect("paint", out _, out _);
            StationToolSelection.ApplySettings(new JObject {
                ["paintMode"] = "single", ["paintFinish"] = "floor.marble",
            });
            int before = host.CurrentRevision;
            var hit = StationCellFixture.Hit(5, 5, 0, true);
            Assert.IsTrue(StationPaintTool.Begin(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), 0, out var reason), reason);
            Assert.AreEqual(1, StationPaintTool.Preview.Cells.Count, "a quick press paints one face");
            Assert.IsTrue(StationPaintTool.Finish(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 40), out var code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "one paint, one revision");
            Assert.AreEqual("floor.marble", host.Index.GetCell(5, 5, 0).FinishOf("top"));
            // Plan 27 §6: a paint is an ordinary transaction, so one undo takes it back.
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.AreNotEqual("floor.marble", host.Index.GetCell(5, 5, 0).FinishOf("top"),
                "undo removes the painted finish");
        }

        [Test]
        public void APaintEraseClearsTheFaceAndLeavesTheBlock() {
            StationToolSelection.TrySelect("paint", out _, out _);
            StationToolSelection.ApplySettings(new JObject {
                ["paintMode"] = "single", ["paintFinish"] = "floor.marble",
            });
            var hit = StationCellFixture.Hit(5, 5, 0, true);
            StationPaintTool.Begin(host, hit, StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), 0, out _);
            Assert.IsTrue(StationPaintTool.Finish(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 40), out var code, out var reason), code ?? reason);
            Assert.AreEqual("floor.marble", host.Index.GetCell(5, 5, 0).FinishOf("top"));
            // The secondary button erases the face; the block itself stays.
            Assert.IsTrue(StationPaintTool.Begin(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 2, timeMs: 100), 2, out reason), reason);
            Assert.IsTrue(StationPaintTool.Finish(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 2, timeMs: 140), out code, out reason), code ?? reason);
            Assert.AreEqual("", host.Index.GetCell(5, 5, 0).FinishOf("top"), "the finish is bare again");
            Assert.IsTrue(host.Index.GetCell(5, 5, 0).IsSolid, "the block is still there");
        }

        [Test]
        public void ASurfacePaintFloodsTheConnectedFacesInOneRevision() {
            var snapshot = StationPaintSnapshot.FromDocument(host.Index.Document, null, host.CurrentRevision);
            var expected = StationFinishEdits.FloodRegion(snapshot, new StationCellKey(5, 5, 0), StationFace.Top);
            Assert.Greater(expected.Count, 4, "the fixture's floor is one connected surface");
            StationToolSelection.TrySelect("paint", out _, out _);
            StationToolSelection.ApplySettings(new JObject {
                ["paintMode"] = "surface", ["paintFinish"] = "floor.granite",
            });
            int before = host.CurrentRevision;
            var hit = StationCellFixture.Hit(5, 5, 0, true);
            Assert.IsTrue(StationPaintTool.Begin(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), 0, out var reason), reason);
            Assert.IsTrue(StationPaintTool.Finish(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 40), out var code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "the whole flood is one revision");
            int painted = 0;
            foreach (var cell in expected) {
                if (host.Index.GetCell(cell)?.FinishOf("top") == "floor.granite") painted++;
            }
            Assert.AreEqual(expected.Count, painted, "every face in the connected region was painted");
        }

        [Test]
        public void APaintDragCoversTheRectangleOnTheAnchorPlane() {
            StationToolSelection.TrySelect("paint", out _, out _);
            StationToolSelection.ApplySettings(new JObject {
                ["paintMode"] = "single", ["paintFinish"] = "floor.marble",
            });
            var down = StationCellFixture.Hit(2, 2, 0, true);
            Assert.IsTrue(StationPaintTool.Begin(host, down,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), 0, out var reason), reason);
            // A deliberate drag (200 ms, 60 px) paints the 2 × 2 rectangle it drew.
            var far = StationCellFixture.Hit(3, 3, 0, true);
            StationPaintTool.Aim(host, far, StationPointerEvent.Synthetic(160, 160, 800, 600, timeMs: 220));
            Assert.AreEqual(4, StationPaintTool.Preview.Cells.Count, "a 2 × 2 rectangle");
            Assert.IsTrue(StationPaintTool.Finish(host, far,
                StationPointerEvent.Synthetic(160, 160, 800, 600, timeMs: 260), out var code, out reason), code ?? reason);
            foreach (var cell in new[] { (2, 2), (2, 3), (3, 2), (3, 3) }) {
                Assert.AreEqual("floor.marble", host.Index.GetCell(cell.Item1, cell.Item2, 0).FinishOf("top"),
                    "painted " + cell);
            }
        }

        [Test]
        public void APaintPickLiftsTheFinishWithoutEditing() {
            StationToolSelection.TrySelect("paint", out _, out _);
            StationToolSelection.ApplySettings(new JObject {
                ["paintMode"] = "single", ["paintFinish"] = "floor.marble",
            });
            var hit = StationCellFixture.Hit(5, 5, 0, true);
            StationPaintTool.Begin(host, hit, StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), 0, out _);
            Assert.IsTrue(StationPaintTool.Finish(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 40), out var code, out var reason), code ?? reason);
            int before = host.CurrentRevision;
            StationToolSelection.ApplySettings(new JObject { ["paintMode"] = "pick" });
            Assert.IsTrue(StationPaintTool.Begin(host, hit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 100), 0, out reason), reason);
            Assert.IsFalse(StationPaintTool.HasGesture, "取色 arms no gesture");
            Assert.AreEqual("floor.marble", (string)StationEditSession.PaintPick?["finish"]);
            Assert.AreEqual("pick", StationEditSession.Paint?.Mode);
            Assert.AreEqual(before, host.CurrentRevision, "the eyedropper never edits");
        }

        // ------------------------------------------------------------------ road

        /// <summary>
        /// A bare 60 × 40 pavement (no pieces, no walls) for a road stroke: a road refuses any
        /// solid block in the four metres above its deck, so the fixture's own half wall and its
        /// edge storeys would otherwise collide with the stroke.
        /// </summary>
        static string BareFloorSave() {
            var cells = new JArray();
            for (int x = 0; x < 60; x++) {
                for (int y = 0; y < 40; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Road fixture", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = new JArray(), ["lines"] = new JArray() },
            }.ToString(Newtonsoft.Json.Formatting.None);
        }

        [Test]
        public void ARoadStrokeLaysOneSegmentAndUndoRestoresIt() {
            Assert.IsTrue(host.OpenDocument(BareFloorSave(), "file").Accepted);
            StationToolSelection.TrySelect("module", out _, out _);
            StationToolSelection.ApplySettings(new JObject {
                ["moduleType"] = "road", ["roadWidth"] = 6, ["roadDirection"] = "one-way", ["rotation"] = 0,
            });
            int before = host.CurrentRevision;
            var down = StationCellFixture.Hit(20, 20, 0, true);
            Assert.IsTrue(StationRoadTool.Begin(host, down,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), 0, out var reason), reason);
            var far = StationCellFixture.Hit(32, 20, 0, true);
            StationRoadTool.Aim(host, far, StationPointerEvent.Synthetic(280, 100, 800, 600, timeMs: 220));
            Assert.IsNotNull(StationRoadTool.Preview, "the stroke draws its preview");
            Assert.IsTrue(StationRoadTool.Preview.Valid, StationRoadTool.Preview.Code);
            Assert.IsTrue(StationRoadTool.Finish(host, far,
                StationPointerEvent.Synthetic(280, 100, 800, 600, timeMs: 260), out var code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "one stroke, one revision");
            int roads = 0;
            foreach (var module in host.Index.Document.Modules) if (module.Type == "road") roads++;
            Assert.AreEqual(1, roads, "the stroke laid one authored road");
            // Plan 27 §6: the stroke joins the unified history, so Ctrl+Z takes it back.
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            roads = 0;
            foreach (var module in host.Index.Document.Modules) if (module.Type == "road") roads++;
            Assert.AreEqual(0, roads, "one undo removes the stroke");
        }

        [Test]
        public void ARoadSecondaryPressLiftsTheSegmentUnderThePointer() {
            Assert.IsTrue(host.OpenDocument(BareFloorSave(), "file").Accepted);
            StationToolSelection.TrySelect("module", out _, out _);
            StationToolSelection.ApplySettings(new JObject {
                ["moduleType"] = "road", ["roadWidth"] = 6, ["roadDirection"] = "one-way", ["rotation"] = 0,
            });
            var down = StationCellFixture.Hit(20, 20, 0, true);
            StationRoadTool.Begin(host, down, StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), 0, out _);
            var far = StationCellFixture.Hit(32, 20, 0, true);
            StationRoadTool.Aim(host, far, StationPointerEvent.Synthetic(280, 100, 800, 600, timeMs: 220));
            Assert.IsTrue(StationRoadTool.Finish(host, far,
                StationPointerEvent.Synthetic(280, 100, 800, 600, timeMs: 260), out var code, out var reason), code ?? reason);
            var roads = host.Index.ModulesOfType("road");
            Assert.Greater(roads.Count, 0);
            int before = host.CurrentRevision;
            // Aim at the road's own body: the press resolves the segment there.
            var record = roads[0];
            var erase = StationCellFixture.Hit(record.X, record.Y, record.Z, true);
            erase.Module = record;
            erase.ModuleExact = true;
            erase.ModuleDistance = 1f;
            Assert.IsTrue(StationRoadTool.Begin(host, erase,
                StationPointerEvent.Synthetic(160, 100, 800, 600, button: 2, timeMs: 300), 2, out reason), reason);
            Assert.IsTrue(StationRoadTool.Finish(host, erase,
                StationPointerEvent.Synthetic(160, 100, 800, 600, button: 2, timeMs: 340), out code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "the erase is one revision");
            int remaining = 0;
            foreach (var module in host.Index.Document.Modules) if (module.Type == "road") remaining++;
            Assert.AreEqual(0, remaining, "the segment is gone");
        }
    }

    /// <summary>
    /// A 12 × 12 floor at z = 0 with one bench, one covered exit head-house off to the side
    /// (its floor plate is eight metres deep, so it is kept clear of every tested cell), a dug
    /// hole and one authored half wall carrying a zone and a finish.
    /// </summary>
    public static class StationCellFixture {
        public const int Size = 12;

        public static string Save => Build().ToString(Newtonsoft.Json.Formatting.None);

        static JObject Build() {
            var cells = new JArray();
            for (int x = 0; x < Size; x++) {
                for (int y = 0; y < Size; y++) {
                    // (1, 1) is the dug hole below: one record per coordinate.
                    if (x == 1 && y == 1) continue;
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            // A dug hole in the pavement: the void record is the street's own hole.
            cells.Add(new JObject { ["x"] = 1, ["y"] = 1, ["z"] = 0, ["fill"] = "void" });
            // An authored half wall with a zone and a finish: a merge must keep both.
            cells.Add(new JObject {
                ["x"] = 3, ["y"] = 3, ["z"] = 1, ["fill"] = "solid",
                ["tags"] = new JArray("wall", "half-wall:n"),
                ["zone"] = "concourse",
                ["finish"] = new JObject { ["top"] = "floor.vinyl" },
            });
            var modules = new JArray {
                new JObject {
                    ["id"] = "bench-1", ["type"] = "bench", ["x"] = 2, ["y"] = 2, ["z"] = 0, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "steel-1", ["note"] = "keep me" },
                },
                new JObject {
                    ["id"] = "exit-1", ["type"] = "exit", ["x"] = 8, ["y"] = 10, ["z"] = 0, ["rot"] = 0,
                    ["cfg"] = new JObject { ["style"] = "covered", ["name"] = "A", ["bays"] = 3 },
                },
            };
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Cell plan fixture", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            };
        }

        /// <summary>
        /// A scene hit on the **top face of the block at** <paramref name="x"/>,<paramref name="y"/>,
        /// <paramref name="z"/>, so a placement steps to `z + 1` and an erase takes `z` itself.
        /// </summary>
        public static StationSceneHit Hit(int x, int y, int z, bool solid) {
            var point = new StationPoint(x + 0.5, y + 0.5, z + 1);
            return new StationSceneHit {
                CellKey = new StationCellKey(x, y, z),
                CellFace = StationFace.Top,
                CellNormal = new StationPoint(0, 0, 1),
                Level = z,
                Point = point,
                Cell = new StationPlacementHit(x, y, z, x, y, z + 1, solid, point, z + 1, new StationPoint(0, 0, 1)),
            };
        }


    }
}
