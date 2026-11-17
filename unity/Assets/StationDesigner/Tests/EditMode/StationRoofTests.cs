using System;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §5: the 屋顶 plate. A fresh tile is a 1 × 1 slab hung one truss base above the
    /// cell it is dropped on (`createModule`'s roof branch, `flatEnvelope`'s roof rule), and the
    /// 贴顶 toggle pins a thin plate inside the cell instead. The truss/canopy ridge envelopes
    /// stay unsupported and are refused, never guessed.
    /// </summary>
    public sealed class StationRoofTests {
        StationGameHost host;
        GameObject hostObject;

        [SetUp]
        public void SetUp() {
            StationEditSession.Reset();
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
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        StationPlacementRequest Request(int x, int y, int z, string plateSnap = "") =>
            new StationPlacementRequest {
                ToolType = "roof",
                Rotation = 0,
                RoofPlateSnap = plateSnap,
                Hit = StationCellFixture.Hit(x, y, z, true).Cell,
            };

        StationModuleRecord Roof() {
            foreach (var module in host.Index.Document.Modules) if (module.Type == "roof") return module;
            return null;
        }

        [Test]
        public void ARoofTileHangsOneTrussBaseAboveItsCell() {
            var plan = StationModulePlacement.Resolve(host.Index, Request(4, 4, 0));
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("roof", plan.Candidate.Type);
            Assert.AreEqual(1, plan.Candidate.Width);
            Assert.AreEqual("", plan.Candidate.Text("plateSnap"), "a plain tile carries no snap");
            var record = StationModulePlacement.ToRecord(plan.Candidate);
            Assert.IsTrue(StationFootprints.TryClearance(record, out var box, out var unsupported), unsupported);
            Assert.AreEqual(4, box.X0, 0.001);
            Assert.AreEqual(4, box.Y0, 0.001);
            Assert.AreEqual(6, box.Z0, 0.001, "one truss base (5 m) above the cell's own top");
            Assert.AreEqual(6.25, box.Z1, 0.001, "a quarter-metre slab");
        }

        [Test]
        public void ThePlateSnapPinsTheSlabInsideItsCell() {
            // `moduleAim` anchors a roof on the cell it was dropped on, so a snapped plate is
            // built against that cell's own volume; the rule under test is the envelope.
            var upper = new StationEditDraft { Type = "roof", X = 4, Y = 4, Z = 1, Width = 1, Depth = 1 };
            upper.Set("plateSnap", "upper");
            Assert.IsTrue(StationFootprints.TryClearance(StationModulePlacement.ToRecord(upper), out var box, out var unsupported), unsupported);
            Assert.AreEqual(1.75, box.Z0, 0.001, "the upper plate sits in the cell's top quarter");
            Assert.AreEqual(2.0, box.Z1, 0.001);
            var lower = new StationEditDraft { Type = "roof", X = 4, Y = 4, Z = 1, Width = 1, Depth = 1 };
            lower.Set("plateSnap", "lower");
            Assert.IsTrue(StationFootprints.TryClearance(StationModulePlacement.ToRecord(lower), out var lowBox, out _));
            Assert.AreEqual(1.0, lowBox.Z0, 0.001, "and the lower plate in its bottom quarter");
            Assert.AreEqual(1.25, lowBox.Z1, 0.001);
            // The placement path carries the tool's snap into the candidate.
            var plan = StationModulePlacement.Resolve(host.Index, Request(4, 4, 0, "lower"));
            Assert.IsTrue(plan.Ok || plan.Reason == "occupied", "a snapped plate either fits or reports its block");
            if (plan.Ok) Assert.AreEqual("lower", plan.Candidate.Text("plateSnap"));
        }

        [Test]
        public void ARoofTileRefusesWhereItsSlabWouldCutABlock() {
            // A block where the plain tile's slab hangs makes the tile `occupied`.
            var world = StationCellEditWorld.Build(host.Index);
            var block = StationCellPlanner.PlanAddCells(world, new[] { new StationCellKey(4, 4, 6) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, block, "place", null, out _, out var code), code);
            var plan = StationModulePlacement.Resolve(host.Index, Request(4, 4, 0));
            Assert.IsFalse(plan.Ok);
            Assert.AreEqual("occupied", plan.Reason);
        }

        [Test]
        public void OneRoofTileIsOneUndoEntry() {
            var plan = StationModulePlacement.Resolve(host.Index, Request(4, 4, 0));
            plan.Candidate.Id = StationModulePlacement.NextId(host.Index, "roof");
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, plan.Candidate, null, "place",
                null, out _, out var code), code);
            Assert.IsNotNull(Roof());
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsNull(Roof(), "one undo takes the tile back");
        }

        [Test]
        public void ATrussBayIsFourCellsByTheToolsBreadthCentredOnTheAim() {
            var plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "roof-truss", Rotation = 0, Width = 8,
                Hit = StationCellFixture.Hit(5, 5, 0, true).Cell,
            });
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("roof", plan.Candidate.Type);
            Assert.AreEqual("truss", plan.Candidate.Text("variant"));
            Assert.AreEqual(StationRoofRules.Bay, plan.Candidate.Width, "four cells along the run");
            Assert.AreEqual(8, plan.Candidate.Depth, "the tool's breadth");
            Assert.AreEqual(4, plan.Candidate.X, "the bay is centred on the aim");
            Assert.AreEqual(2, plan.Candidate.Y);
            var record = StationModulePlacement.ToRecord(plan.Candidate);
            Assert.IsTrue(StationFootprints.TryClearance(record, out var box, out var unsupported), unsupported);
            Assert.AreEqual(6, box.Z0, 0.001, "the shell starts one truss base above the slab");
            Assert.AreEqual(11, box.Z1, 0.001, "and reaches its 10 m top");
        }

        [Test]
        public void ACanopyReservesItsPostsAndTheSlabTheyCarry() {
            var plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "roof-canopy", Rotation = 0, Width = 4,
                Hit = StationCellFixture.Hit(5, 5, 0, true).Cell,
            });
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("canopy", plan.Candidate.Text("variant"));
            var record = StationModulePlacement.ToRecord(plan.Candidate);
            Assert.IsTrue(StationFootprints.TryClearance(record, out var box, out var unsupported), unsupported);
            Assert.AreEqual(1, box.Z0, 0.001, "the posts stand on the slab's top");
            Assert.AreEqual(6, box.Z1, 0.001, "and the lowered shell tops out one storey lower");
            Assert.Greater(StationRoofRules.PostCells(record).Count, 0, "the piece stands on posts");
        }

        [Test]
        public void APsdEndPanelCarriesItsHalfHeightAndTheCoverItsFullOne() {
            var panel = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "psd-end", Rotation = 0,
                Hit = StationCellFixture.Hit(4, 4, 0, true).Cell,
            });
            Assert.IsTrue(panel.Ok, panel.Reason);
            Assert.AreEqual("psd-end", panel.Candidate.Type);
            Assert.AreEqual("half", panel.Candidate.Text("psd"));
            var cover = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "psd-end-cover", Rotation = 0,
                Hit = StationCellFixture.Hit(4, 4, 0, true).Cell,
            });
            Assert.IsTrue(cover.Ok, cover.Reason);
            Assert.AreEqual("full", cover.Candidate.Text("psd"));
            Assert.AreEqual("cover", cover.Candidate.Text("variant"));
        }

        [Test]
        public void ACanopyOverAHoleRefusesItsPost() {
            // The canopy stands on its posts; one over the fixture's dug hole has no floor.
            var plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "roof-canopy", Rotation = 0, Width = 4,
                Hit = StationCellFixture.Hit(1, 1, 0, true).Cell,
            });
            Assert.IsFalse(plan.Ok);
            // The hole itself is a loor refusal; the fixture's bench inside the bay is an
            // occupied one. Either way the piece never lands over the void.
            Assert.IsTrue(plan.Reason == "floor" || plan.Reason == "occupied", plan.Reason);
        }
    }
}
