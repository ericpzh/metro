using System;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §5: the elevator's growth (`build/model/Lifts.ts`). A press in a shaft's own
    /// column grows it one armed interval up or down and keeps its identity; the secondary press
    /// trims one outer interval; another piece standing in the volume it would take refuses the
    /// growth. A press in a column with no shaft falls through to a fresh placement.
    /// </summary>
    public sealed class StationLiftToolTests {
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

        static StationPointerEvent Pointer(float x, float y, double timeMs, int button = 0) =>
            StationPointerEvent.Synthetic(x, y, 800, 600, button: button, timeMs: timeMs);

        void ArmLift(int interval = 5) {
            Assert.IsTrue(StationToolSelection.TrySelect("module", out _, out var code), code);
            StationToolSelection.ApplySettings(new JObject { ["moduleType"] = "lift", ["liftInterval"] = interval });
        }

        void PlaceShaft(int x, int y, int z) {
            ArmLift();
            var plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "lift", Rotation = 0, LiftInterval = 5,
                Hit = StationCellFixture.Hit(x, y, z, true).Cell,
            });
            Assert.IsTrue(plan.Ok, plan.Reason);
            plan.Candidate.Id = StationModulePlacement.NextId(host.Index, "lift");
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, plan.Candidate, null, "place",
                null, out _, out var code), code);
        }

        StationModuleRecord Shaft() {
            foreach (var module in host.Index.Document.Modules) if (module.Type == "lift") return module;
            return null;
        }

        [Test]
        public void APressInTheShaftsUpperHalfGrowsItOneIntervalUp() {
            PlaceShaft(4, 4, 0);
            var before = Shaft();
            Assert.AreEqual(0, before.From.Value.Z, 0.001);
            Assert.AreEqual(5, before.To.Value.Z, 0.001);
            ArmLift();
            int revision = host.CurrentRevision;
            Assert.IsTrue(StationLiftTool.Begin(host, StationCellFixture.Hit(4, 4, 4, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            Assert.AreEqual(revision + 1, host.CurrentRevision, "one press, one revision: " + code + "/" + reason);
            var grown = Shaft();
            Assert.AreEqual(before.Id, grown.Id, "the shaft keeps its identity");
            Assert.AreEqual(10, grown.To.Value.Z, 0.001, "it reaches one 5 m interval higher");
            Assert.AreEqual("[5,5]", grown.Config.Text("rises").Replace(" ", ""), "and stacks its rises");
        }

        [Test]
        public void APressInTheShaftsLowerHalfGrowsItOneIntervalDown() {
            PlaceShaft(4, 4, 0);
            ArmLift(3);
            Assert.IsTrue(StationLiftTool.Begin(host, StationCellFixture.Hit(4, 4, 0, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            var grown = Shaft();
            Assert.AreEqual(-3, grown.From.Value.Z, 0.001, "the base drops one 3 m interval");
            Assert.AreEqual(5, grown.To.Value.Z, 0.001);
            Assert.AreEqual("[3,5]", grown.Config.Text("rises").Replace(" ", ""));
        }

        [Test]
        public void TheSecondaryPressTrimsOneOuterInterval() {
            PlaceShaft(4, 4, 0);
            ArmLift();
            Assert.IsTrue(StationLiftTool.Begin(host, StationCellFixture.Hit(4, 4, 4, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            Assert.AreEqual(10, Shaft().To.Value.Z, 0.001);
            // Trim from the top: the pointer is in the upper half.
            Assert.IsTrue(StationLiftTool.Begin(host, StationCellFixture.Hit(4, 4, 8, true),
                Pointer(100, 100, 100, 2), 2, out code, out reason), code ?? reason);
            Assert.AreEqual(5, Shaft().To.Value.Z, 0.001, "one interval comes off the top");
            // A single-interval shaft has no outer extension left to remove.
            Assert.IsTrue(StationLiftTool.Begin(host, StationCellFixture.Hit(4, 4, 4, true),
                Pointer(100, 100, 200, 2), 2, out _, out reason));
            Assert.AreEqual("lift-single-interval", reason);
        }

        [Test]
        public void APieceInTheNewVolumeRefusesTheGrowth() {
            PlaceShaft(4, 4, 0);
            // A block poured at the level the shaft would grow into.
            var world = StationCellEditWorld.Build(host.Index);
            var block = StationCellPlanner.PlanAddCells(world, new[] { new StationCellKey(4, 4, 6) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, block, "place", null, out _, out var placeCode), placeCode);
            ArmLift();
            int revision = host.CurrentRevision;
            Assert.IsTrue(StationLiftTool.Begin(host, StationCellFixture.Hit(4, 4, 4, true),
                Pointer(100, 100, 0), 0, out _, out var reason));
            Assert.AreEqual("occupied", reason);
            Assert.AreEqual(revision, host.CurrentRevision, "a refused growth writes nothing");
            Assert.AreEqual(5, Shaft().To.Value.Z, 0.001);
        }

        [Test]
        public void AColumnWithNoShaftFallsThroughToAFreshPlacement() {
            ArmLift();
            Assert.IsFalse(StationLiftTool.Begin(host, StationCellFixture.Hit(6, 6, 0, true),
                Pointer(100, 100, 0), 0, out _, out _),
                "not handled: the ordinary placement drops the fresh shaft");
            Assert.IsNull(Shaft());
        }
    }
}
