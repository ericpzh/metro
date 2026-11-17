using System;
using System.Collections.Generic;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §6: the 分区 brush. The planner cases are the source's own rules — a zone lives
    /// on **floor** (`build/model/Zones.ts` `isFloorCell`), a fare paint clears `room`, a room
    /// paint leaves the fare label alone, and 无分区 takes a label away instead of writing
    /// `none` — and the gesture cases prove the tool commits once, through the shared history.
    /// </summary>
    public sealed class StationZoneBrushTests {
        StationGameHost host;
        GameObject hostObject;

        [SetUp]
        public void SetUp() {
            StationEditSession.Reset();
            StationZoneTool.Reset();
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
            StationZoneTool.Reset();
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        StationZoneWorld World() => StationZoneWorld.Build(host.Index);

        static StationPointerEvent Pointer(float x, float y, double timeMs, int button = 0) =>
            StationPointerEvent.Synthetic(x, y, 800, 600, button: button, timeMs: timeMs);

        void ArmZone(string brush) {
            Assert.IsTrue(StationToolSelection.TrySelect("zone", out _, out var code), code);
            StationToolSelection.ApplySettings(new JObject { ["zoneBrush"] = brush });
        }

        /// <summary>Every auto-stocked staff bench the document holds.</summary>
        List<StationModuleRecord> AutoBenches() {
            var benches = new List<StationModuleRecord>();
            foreach (var module in host.Index.Document.Modules) {
                if (module.Type == "bench" && module.Config.Bool("auto")) benches.Add(module);
            }
            return benches;
        }

        /// <summary>The saved record for one coordinate, or null when the document holds none.</summary>
        JObject SavedCell(int x, int y, int z) {            var envelope = JObject.Parse(host.SaveDocument());
            foreach (var token in (JArray)envelope["static"]["cells"]) {
                if (!(token is JObject cell)) continue;
                if ((int?)cell["x"] != x || (int?)cell["y"] != y) continue;
                if (Math.Abs((double?)cell["z"] ?? 0) > 1e-9) continue;
                return cell;
            }
            return null;
        }

        // ----------------------------------------------------------------- planner

        [Test]
        public void AFarePaintLabelsEveryFloorCellTheRectangleCovers() {
            var world = World();
            var cells = StationCellPlanner.RectCells(
                new StationCellKey(4, 4, 0), new StationCellKey(5, 5, 0), 0, false);
            var plan = StationZonePlanner.Plan(world, cells, "paid");
            Assert.IsTrue(plan.HasWork);
            Assert.AreEqual(4, plan.Floor.Count, "the 2 × 2 rectangle is all street floor");
            Assert.AreEqual(4, plan.Accepted.Count);
            Assert.AreEqual("", plan.Reason);
            var patch = plan.ToPatch();
            Assert.AreEqual(4, patch.Writes.Count);
            Assert.AreEqual(StationCellWriteMode.Label, patch.Writes[0].Mode);
            Assert.AreEqual("paid", patch.Writes[0].Zone, "a fare paint writes the zone label");
            Assert.AreEqual("", patch.Writes[0].Room, "and clears a room purpose");
        }

        [Test]
        public void AZoneBrushRefusesWhatIsNotFloor() {
            var world = World();
            // The fixture's (1,1,0) is a dug hole (a `void` record) and (0,1,1) is empty air:
            // neither is floor, so neither can carry a label.
            Assert.IsFalse(world.IsFloor(1, 1, 0), "a hole is not floor");
            Assert.IsFalse(world.IsFloor(0, 1, 1), "an empty course above grade is not floor");
            var plan = StationZonePlanner.Plan(world, new[] {
                new StationCellKey(1, 1, 0), new StationCellKey(0, 1, 1), new StationCellKey(2, 1, 0),
            }, "unpaid");
            Assert.AreEqual(1, plan.Accepted.Count, "only the floor cell is accepted");
            Assert.AreEqual(2, plan.Ignored.Count);
        }

        [Test]
        public void AVoidRecordAndACeilingPlateAreNeverFloor() {
            var world = World();
            // The fixture's half wall at (3,3,1) is a coping: a piece thinner than a block is
            // not floor itself, so a zone can never be painted onto it (`isFloorCell`).
            Assert.IsTrue(world.IsSolid(new StationCellKey(3, 3, 1)));
            Assert.IsFalse(world.IsFloor(3, 3, 1), "a 半墙 coping is structure, not floor");
            var plan = StationZonePlanner.Plan(world, new[] { new StationCellKey(3, 3, 1) }, "paid");
            Assert.IsFalse(plan.HasWork);
            Assert.AreEqual("not-floor", plan.Reason);
        }

        [Test]
        public void ARoomPaintKeepsTheFareLabelAndEraseTakesOnlyTheRoom() {
            Assert.IsTrue(host.OpenDocument(ZonedSave(), "file").Accepted);
            var world = World();
            // (2,0) is 付费区 + 商店 in the fixture save.
            var cell = new StationCellKey(2, 0, 0);
            Assert.AreEqual("paid", world.Find(cell).Zone);
            Assert.AreEqual("store", world.Find(cell).Room);
            var erase = StationZonePlanner.Plan(world, new[] { cell }, "none");
            Assert.IsTrue(erase.HasWork);
            Assert.AreEqual(1, erase.Writes.Count);
            Assert.AreEqual(StationCellWriteMode.Label, erase.Writes[0].Mode, "the record stays");
            Assert.IsNull(erase.Writes[0].Zone, "the fare label is left alone");
            Assert.AreEqual("", erase.Writes[0].Room, "and the room purpose comes off");
        }

        [Test]
        public void ErasingABareZoneRecordGivesTheCoordinateBackToTheStreet() {
            var world = World();
            var cell = new StationCellKey(5, 5, 0);
            var painted = StationZonePlanner.Plan(world, new[] { cell }, "paid");
            Assert.IsTrue(StationEditSession.TryApplyCells(host, painted.ToPatch(), "paint zone", null, out _, out var code), code);
            Assert.AreEqual("paid", host.Index.GetCell(5, 5, 0).Zone);
            var afterPaint = World();
            var erased = StationZonePlanner.Plan(afterPaint, new[] { cell }, "none");
            Assert.AreEqual(StationCellWriteMode.Remove, erased.Writes[0].Mode,
                "a record with nothing but a label is the street again");
            Assert.IsTrue(StationEditSession.TryApplyCells(host, erased.ToPatch(), "erase zone", null, out _, out code), code);
            Assert.IsNull(host.Index.GetCell(5, 5, 0), "absence means street");
        }

        [Test]
        public void APaintOnVirginStreetMaterialisesARecordWithItsZone() {
            // (20,20,0) is outside the fixture's 12 × 12 pavement: the document speaks for it
            // nowhere, and the street plane is floor there.
            var world = World();
            var cell = new StationCellKey(20, 20, 0);
            Assert.IsTrue(world.IsFloor(cell));
            var plan = StationZonePlanner.Plan(world, new[] { cell }, "unpaid");
            Assert.IsTrue(plan.HasWork);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan.ToPatch(), "paint zone", null, out _, out var code), code);
            var record = host.Index.GetCell(20, 20, 0);
            Assert.IsNotNull(record, "the street gained a record so it can carry a label");
            Assert.AreEqual("unpaid", record.Zone);
            Assert.IsTrue(record.IsSolid);
        }

        [Test]
        public void ARepaintKeepsTheFinishTagsAndFieldsItDoesNotOwn() {
            Assert.IsTrue(host.OpenDocument(ZonedSave(), "file").Accepted);
            var world = World();
            // (0,0) carries a finish, a tag and a field this port does not read.
            var plan = StationZonePlanner.Plan(world, new[] { new StationCellKey(0, 0, 0) }, "platform");
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan.ToPatch(), "paint zone", null, out _, out var code), code);
            var cell = SavedCell(0, 0, 0);
            Assert.AreEqual("platform", (string)cell["zone"]);
            Assert.AreEqual("floor.marble", (string)cell["finish"]["top"], "the finish survives");
            Assert.AreEqual("painted-ground", (string)cell["tags"][0], "the tags survive");
            Assert.AreEqual("keep-me", (string)cell["note"], "an unknown field survives untouched");
        }

        [Test]
        public void ABucketFloodStopsAtTheZoneBoundary() {
            Assert.IsTrue(host.OpenDocument(ZonedSave(), "file").Accepted);
            var world = World();
            // Row y = 2 is six plain cells: paint the first three 付费区.
            var row = new[] {
                new StationCellKey(0, 2, 0), new StationCellKey(1, 2, 0), new StationCellKey(2, 2, 0),
            };
            Assert.IsTrue(StationEditSession.TryApplyCells(host,
                StationZonePlanner.Plan(world, row, "paid").ToPatch(), "paint zone", null, out _, out var code), code);
            var afterPaint = World();
            var bucket = StationZonePlanner.Bucket(afterPaint, new StationCellKey(0, 2, 0), "unpaid");
            Assert.AreEqual(3, bucket.Accepted.Count, "the flood stops where the zone line is");
            Assert.IsTrue(StationEditSession.TryApplyCells(host, bucket.ToPatch(), "paint zone", null, out _, out code), code);
            for (int x = 0; x < 3; x++) Assert.AreEqual("unpaid", host.Index.GetCell(x, 2, 0).Zone, "cell " + x);
            Assert.AreEqual("", host.Index.GetCell(3, 2, 0).Zone ?? "", "the untouched side keeps its own label");
        }

        [Test]
        public void ABucketRefusesTheEraserAndTheRoomBrushes() {
            var world = World();
            Assert.AreEqual("not-bucketable", StationZonePlanner.Bucket(world, new StationCellKey(0, 1, 0), "none").Reason);
            Assert.AreEqual("not-bucketable", StationZonePlanner.Bucket(world, new StationCellKey(0, 1, 0), "store").Reason);
        }

        // ------------------------------------------------------------------- gesture

        [Test]
        public void AQuickTapPaintsOneFloorCellAndOneRevision() {
            ArmZone("paid");
            int before = host.CurrentRevision;
            var down = StationCellFixture.Hit(4, 4, 0, true);
            Assert.IsTrue(StationZoneTool.Begin(host, down, Pointer(100, 100, 0), 0, out var reason), reason);
            Assert.IsTrue(StationZoneTool.Finish(host, down, Pointer(101, 100, 40), out var code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "one tap, one revision");
            Assert.AreEqual("paid", host.Index.GetCell(4, 4, 0).Zone);
            Assert.AreEqual("", host.Index.GetCell(5, 4, 0).Zone, "the neighbour keeps no label");
        }

        [Test]
        public void ADeliberateDragPaintsTheRectangleItDrew() {
            ArmZone("unpaid");
            var down = StationCellFixture.Hit(4, 4, 0, true);
            Assert.IsTrue(StationZoneTool.Begin(host, down, Pointer(100, 100, 0), 0, out var reason), reason);
            int before = host.CurrentRevision;
            var far = StationCellFixture.Hit(6, 5, 0, true);
            StationZoneTool.Aim(host, far, Pointer(260, 160, 220));
            Assert.AreEqual(6, StationZoneTool.Preview.Floor.Count, "a 3 × 2 rectangle");
            Assert.AreEqual(before, host.CurrentRevision, "the preview never edits");
            Assert.IsTrue(StationZoneTool.Finish(host, far, Pointer(260, 160, 260), out var code, out reason), code ?? reason);
            for (int x = 4; x <= 6; x++)
                for (int y = 4; y <= 5; y++)
                    Assert.AreEqual("unpaid", host.Index.GetCell(x, y, 0).Zone, "painted " + x + "," + y);
        }

        [Test]
        public void TheSecondaryButtonErasesWhatThePrimaryPainted() {
            ArmZone("paid");
            var cell = StationCellFixture.Hit(5, 5, 0, true);
            Assert.IsTrue(StationZoneTool.Begin(host, cell, Pointer(100, 100, 0), 0, out _));
            Assert.IsTrue(StationZoneTool.Finish(host, cell, Pointer(100, 100, 30), out var code, out _), code);
            Assert.AreEqual("paid", host.Index.GetCell(5, 5, 0).Zone);
            // The shell hands a claimed right button to the tool (`rightClaim` = erase for 分区).
            Assert.AreEqual("erase", StationToolSelection.RightClaim);
            Assert.IsTrue(StationZoneTool.Begin(host, cell, Pointer(100, 100, 100, 2), 2, out var reason), reason);
            Assert.IsTrue(StationZoneTool.Finish(host, cell, Pointer(100, 100, 130, 2), out code, out reason), code ?? reason);
            Assert.IsNull(host.Index.GetCell(5, 5, 0), "the label and its bare record are gone");
        }

        [Test]
        public void APressOnAWallCopingPaintsNothingAndSaysWhy() {
            ArmZone("paid");
            int before = host.CurrentRevision;
            var coping = StationCellFixture.Hit(3, 3, 1, true);
            Assert.IsFalse(StationZoneTool.Begin(host, coping, Pointer(100, 100, 0), 0, out var reason));
            Assert.AreEqual("not-floor", reason);
            Assert.AreEqual("not-floor", StationZoneTool.Preview.Notice);
            Assert.IsFalse(StationZoneTool.HasGesture);
            Assert.AreEqual(before, host.CurrentRevision);
        }

        [Test]
        public void AReleasedGestureFromAnOlderRevisionIsRefused() {
            ArmZone("paid");
            var down = StationCellFixture.Hit(4, 4, 0, true);
            Assert.IsTrue(StationZoneTool.Begin(host, down, Pointer(100, 100, 0), 0, out _));
            // Something else commits while the button is held: the gesture now belongs to a
            // revision the station no longer has.
            StationToolSelection.TrySelect("block", out _, out _);
            var plan = StationCellPlanner.PlanAddCells(StationCellWorld(), new[] { new StationCellKey(7, 7, 1) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan, "place", null, out _, out var commitCode), commitCode);
            Assert.IsFalse(StationZoneTool.Finish(host, down, Pointer(100, 100, 200), out _, out var reason));
            Assert.AreEqual("stale-revision", reason);
            Assert.AreEqual("", host.Index.GetCell(4, 4, 0).Zone ?? "", "the stale release wrote no label");
        }

        [Test]
        public void OneZoneEditIsOneUndoEntry() {
            ArmZone("paid");
            var down = StationCellFixture.Hit(4, 4, 0, true);
            Assert.IsTrue(StationZoneTool.Begin(host, down, Pointer(100, 100, 0), 0, out _));
            var far = StationCellFixture.Hit(6, 6, 0, true);
            StationZoneTool.Aim(host, far, Pointer(280, 200, 220));
            Assert.IsTrue(StationZoneTool.Finish(host, far, Pointer(280, 200, 260), out var code, out var reason), code ?? reason);
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            for (int x = 4; x <= 6; x++)
                for (int y = 4; y <= 6; y++)
                    Assert.AreEqual("", host.Index.GetCell(x, y, 0).Zone ?? "", "cell " + x + "," + y + " is clean again");
        }

        // ---------------------------------------------------------------- facilities

        [Test]
        public void ATicketDragBuildsTheCounterAndItsStaffBench() {
            Assert.IsTrue(host.OpenDocument(ZonedSave(), "file").Accepted);
            int before = host.CurrentRevision;
            ArmZone("ticket");
            var down = StationCellFixture.Hit(0, 0, 0, true);
            Assert.IsTrue(StationZoneTool.Begin(host, down, Pointer(100, 100, 0), 0, out var reason), reason);
            var far = StationCellFixture.Hit(2, 2, 0, true);
            StationZoneTool.Aim(host, far, Pointer(220, 220, 220));
            Assert.AreEqual("ticket", StationZoneTool.Preview.Facility);
            Assert.AreEqual("", StationZoneTool.Preview.Notice, "a 3 × 3 counter is legal");
            Assert.AreEqual(before, host.CurrentRevision, "the preview never edits");
            Assert.IsTrue(StationZoneTool.Finish(host, far, Pointer(220, 220, 260), out var code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "one drag, one revision");
            var booth = host.Index.GetModule("booth-1");
            Assert.IsNotNull(booth, "the drag builds a booth");
            Assert.AreEqual(3, booth.Width);
            Assert.AreEqual(3, booth.Depth);
            Assert.AreEqual("ticket", booth.Config.Text("kind"));
            Assert.IsTrue(booth.Config.Bool("stocked"));
            var benches = AutoBenches();
            Assert.AreEqual(1, benches.Count, "and stocks one staff bench");
            Assert.AreEqual(1, benches[0].Y, "the bench stands in the back row");
        }

        [Test]
        public void ACounterUnderTheMinimumSizeIsRefused() {
            Assert.IsTrue(host.OpenDocument(ZonedSave(), "file").Accepted);
            int before = host.CurrentRevision;
            ArmZone("info");
            var down = StationCellFixture.Hit(0, 0, 0, true);
            Assert.IsTrue(StationZoneTool.Begin(host, down, Pointer(100, 100, 0), 0, out _));
            var far = StationCellFixture.Hit(1, 1, 0, true);
            StationZoneTool.Aim(host, far, Pointer(180, 180, 220));
            Assert.AreEqual("min-size", StationZoneTool.Preview.Notice);
            Assert.IsFalse(StationZoneTool.Finish(host, far, Pointer(180, 180, 260), out _, out var reason));
            Assert.AreEqual("min-size", reason);
            Assert.AreEqual(before, host.CurrentRevision, "a refused room writes nothing");
            Assert.IsNull(host.Index.GetModule("booth-1"));
        }

        [Test]
        public void ADifferentCounterKindRefusesTheDragAndNamesTheRoom() {
            Assert.IsTrue(host.OpenDocument(ZonedSave(), "file").Accepted);
            ArmZone("info");
            var down = StationCellFixture.Hit(0, 0, 0, true);
            StationZoneTool.Begin(host, down, Pointer(100, 100, 0), 0, out _);
            var far = StationCellFixture.Hit(2, 2, 0, true);
            StationZoneTool.Aim(host, far, Pointer(220, 220, 220));
            Assert.IsTrue(StationZoneTool.Finish(host, far, Pointer(220, 220, 260), out var code, out var reason), code ?? reason);
            int before = host.CurrentRevision;
            ArmZone("ticket");
            var down2 = StationCellFixture.Hit(1, 1, 0, true);
            StationZoneTool.Begin(host, down2, Pointer(100, 100, 300), 0, out _);
            var far2 = StationCellFixture.Hit(3, 3, 0, true);
            StationZoneTool.Aim(host, far2, Pointer(240, 240, 480));
            Assert.AreEqual("clash", StationZoneTool.Preview.Notice);
            Assert.AreEqual("booth-1", StationZoneTool.Preview.BlockedBy);
            Assert.IsFalse(StationZoneTool.Finish(host, far2, Pointer(240, 240, 520), out _, out reason));
            Assert.AreEqual("clash", reason);
            Assert.AreEqual(before, host.CurrentRevision);
        }

        [Test]
        public void ACounterDragAcrossADugHoleIsRefused() {
            // The cell fixture's (1,1) is a dug hole: the street plane withholds it.
            ArmZone("ticket");
            var down = StationCellFixture.Hit(0, 0, 0, true);
            Assert.IsTrue(StationZoneTool.Begin(host, down, Pointer(100, 100, 0), 0, out _));
            var far = StationCellFixture.Hit(2, 2, 0, true);
            StationZoneTool.Aim(host, far, Pointer(220, 220, 220));
            Assert.AreEqual("no-floor", StationZoneTool.Preview.Notice);
            Assert.IsFalse(StationZoneTool.Finish(host, far, Pointer(220, 220, 260), out _, out var reason));
            Assert.AreEqual("no-floor", reason);
        }

        [Test]
        public void ASecondDragOfTheSameKindExtendsTheCounterIntoOneRoom() {
            Assert.IsTrue(host.OpenDocument(ZonedSave(), "file").Accepted);
            ArmZone("ticket");
            var first = StationCellFixture.Hit(0, 0, 0, true);
            StationZoneTool.Begin(host, first, Pointer(100, 100, 0), 0, out _);
            var firstFar = StationCellFixture.Hit(2, 2, 0, true);
            StationZoneTool.Aim(host, firstFar, Pointer(220, 220, 200));
            Assert.IsTrue(StationZoneTool.Finish(host, firstFar, Pointer(220, 220, 240), out var code, out var reason), code ?? reason);
            // Overlap the first counter by one column and drag the union to 5 × 4.
            var second = StationCellFixture.Hit(2, 1, 0, true);
            Assert.IsTrue(StationZoneTool.Begin(host, second, Pointer(220, 160, 300), 0, out reason), reason);
            var secondFar = StationCellFixture.Hit(4, 3, 0, true);
            StationZoneTool.Aim(host, secondFar, Pointer(380, 300, 480));
            Assert.AreEqual(5, StationZoneTool.Preview.Width, "the union of the two drags");
            Assert.AreEqual(4, StationZoneTool.Preview.Height);
            Assert.IsTrue(StationZoneTool.Finish(host, secondFar, Pointer(380, 300, 520), out code, out reason), code ?? reason);
            int booths = 0;
            foreach (var module in host.Index.Document.Modules) {
                if (module.Type != "booth") continue;
                booths++;
                Assert.AreEqual(5, module.Width, "one room covers the union");
                Assert.AreEqual(4, module.Depth);
            }
            Assert.AreEqual(1, booths, "the absorbed counter is gone");
            Assert.AreEqual(3, AutoBenches().Count, "the union's back row is re-stocked once, not twice");
        }

        [Test]
        public void TheSecondaryPressBulldozesTheCounterUnderThePointer() {
            Assert.IsTrue(host.OpenDocument(ZonedSave(), "file").Accepted);
            ArmZone("ticket");
            var down = StationCellFixture.Hit(0, 0, 0, true);
            StationZoneTool.Begin(host, down, Pointer(100, 100, 0), 0, out _);
            var far = StationCellFixture.Hit(2, 2, 0, true);
            StationZoneTool.Aim(host, far, Pointer(220, 220, 200));
            Assert.IsTrue(StationZoneTool.Finish(host, far, Pointer(220, 220, 240), out var code, out var reason), code ?? reason);
            int before = host.CurrentRevision;
            var inside = StationCellFixture.Hit(1, 1, 0, true);
            Assert.IsTrue(StationZoneTool.Begin(host, inside, Pointer(160, 160, 300, 2), 2, out reason), reason);
            Assert.IsFalse(StationZoneTool.HasGesture, "a counter is removed on the press, not by a drag");
            Assert.AreEqual(before + 1, host.CurrentRevision, "the removal is one revision");
            Assert.IsNull(host.Index.GetModule("booth-1"), "the counter is gone");
            Assert.AreEqual(0, AutoBenches().Count, "and so is its auto bench");
        }

        [Test]
        public void TheSecondaryPressOnPlainFloorStillErasesTheLabel() {
            Assert.IsTrue(host.OpenDocument(ZonedSave(), "file").Accepted);
            ArmZone("paid");
            var floor = StationCellFixture.Hit(5, 1, 0, true);
            StationZoneTool.Begin(host, floor, Pointer(100, 100, 0), 0, out _);
            Assert.IsTrue(StationZoneTool.Finish(host, floor, Pointer(100, 100, 40), out var code, out var reason), code ?? reason);
            Assert.AreEqual("paid", host.Index.GetCell(5, 1, 0).Zone);
            ArmZone("ticket");
            int before = host.CurrentRevision;
            Assert.IsTrue(StationZoneTool.Begin(host, floor, Pointer(100, 100, 100, 2), 2, out reason), reason);
            Assert.IsTrue(StationZoneTool.Finish(host, floor, Pointer(100, 100, 130, 2), out code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision);
            Assert.IsNull(host.Index.GetCell(5, 1, 0), "the bare label record went back to the street");
        }

        [Test]
        public void ACounterStandsOnTheBlockUnderThePointerNotTheStorey() {
            Assert.IsTrue(host.OpenDocument(RaisedSlabSave(), "file").Accepted);
            // The pointer lands on the wall courses above the slab: the column walks down to the
            // floor the wall was raised from.
            Assert.AreEqual(0, StationFacilityPlanner.StandZ(host.Index, 0, 0, 3));
            ArmZone("ticket");
            var onWall = StationCellFixture.Hit(0, 0, 3, true);
            Assert.IsTrue(StationZoneTool.Begin(host, onWall, Pointer(100, 100, 0), 0, out var reason), reason);
            var far = StationCellFixture.Hit(2, 2, 3, true);
            StationZoneTool.Aim(host, far, Pointer(220, 220, 220));
            Assert.IsTrue(StationZoneTool.Finish(host, far, Pointer(220, 220, 260), out var code, out reason), code ?? reason);
            var booth = host.Index.GetModule("booth-1");
            Assert.IsNotNull(booth);
            Assert.AreEqual(0, booth.Z, "the counter stood on the slab's own floor, not on the wall");
        }

        [Test]
        public void AFacilityDragIsOneUndoEntry() {
            Assert.IsTrue(host.OpenDocument(ZonedSave(), "file").Accepted);
            ArmZone("ticket");
            var down = StationCellFixture.Hit(0, 0, 0, true);
            StationZoneTool.Begin(host, down, Pointer(100, 100, 0), 0, out _);
            var far = StationCellFixture.Hit(2, 2, 0, true);
            StationZoneTool.Aim(host, far, Pointer(220, 220, 200));
            Assert.IsTrue(StationZoneTool.Finish(host, far, Pointer(220, 220, 240), out var code, out var reason), code ?? reason);
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsNull(host.Index.GetModule("booth-1"), "one undo takes the room and its bench");
            Assert.AreEqual(0, AutoBenches().Count);
        }

        StationCellEditWorld StationCellWorld() => StationCellEditWorld.Build(host.Index);

        /// <summary>
        /// A 6 × 6 pavement with a three-course wall column at (0,0) standing on its floor: the
        /// press lands on the wall, and the counter still belongs to the slab underneath.
        /// </summary>
        static string RaisedSlabSave() {
            var cells = new JArray();
            for (int x = 0; x < 6; x++) {
                for (int y = 0; y < 6; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            for (int z = 1; z <= 3; z++) {
                cells.Add(new JObject {
                    ["x"] = 0, ["y"] = 0, ["z"] = z, ["fill"] = "solid",
                    ["tags"] = new JArray("wall"),
                });
            }
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Slab fixture", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = new JArray(), ["lines"] = new JArray() },
            }.ToString(Newtonsoft.Json.Formatting.None);
        }

        /// <summary>
        /// An 8 × 4 pavement carrying the label shapes the brush has to preserve: a finished cell
        /// with a tag and an unknown field, a 付费区 商店, a room-only cell and two plain rooms.
        /// </summary>
        static string ZonedSave() {
            var cells = new JArray();
            for (int x = 0; x < 8; x++) {
                for (int y = 0; y < 4; y++) {
                    var cell = new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" };
                    if (x == 0 && y == 0) {
                        cell["tags"] = new JArray("painted-ground");
                        cell["finish"] = new JObject { ["top"] = "floor.marble" };
                        cell["note"] = "keep-me";
                    }
                    if (x == 2 && y == 0) {
                        cell["zone"] = "paid";
                        cell["room"] = "store";
                    }
                    if (x == 3 && y == 0) cell["room"] = "toilet";
                    cells.Add(cell);
                }
            }
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Zone fixture", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = new JArray(), ["lines"] = new JArray() },
            }.ToString(Newtonsoft.Json.Formatting.None);
        }
    }
}
