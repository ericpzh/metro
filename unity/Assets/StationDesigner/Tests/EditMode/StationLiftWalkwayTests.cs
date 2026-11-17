using System;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §5: the lift and the 自动步道. Both are ordinary placement families, so the
    /// cases pin the piece each one builds (`liftModule`, `walkwayModule`), the floor rules
    /// they share with every other piece, and the one rule only a walkway has — its belt lies
    /// on floor for the whole run.
    /// </summary>
    public sealed class StationLiftWalkwayTests {
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

        StationPlacementRequest Request(string type, int x, int y, int z, int rotation = 0) =>
            new StationPlacementRequest {
                ToolType = type,
                Rotation = rotation,
                Hit = StationCellFixture.Hit(x, y, z, true).Cell,
            };

        StationModuleRecord Module(string type) {
            foreach (var module in host.Index.Document.Modules) if (module.Type == type) return module;
            return null;
        }

        void Place(StationPlacementPlan plan, out string code) {
            plan.Candidate.Id = StationModulePlacement.NextId(host.Index, plan.Candidate.Type);
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, plan.Candidate, null, "place",
                null, out _, out code), code);
        }

        // ------------------------------------------------------------------- the lift

        [Test]
        public void ALiftServesTheFloorOneIntervalUp() {
            var request = Request("lift", 5, 5, 0);
            request.LiftInterval = 5;
            var plan = StationModulePlacement.Resolve(host.Index, request);
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("lift", plan.Candidate.Type);
            Assert.IsTrue(plan.Candidate.From.HasValue && plan.Candidate.To.HasValue);
            Assert.AreEqual(0, plan.Candidate.From.Value.Z);
            Assert.AreEqual(5, plan.Candidate.To.Value.Z, "the shaft serves one 5 m interval up");
            Assert.AreEqual("[5]", plan.Candidate.Text("rises"), "the piece records its own rise");
            int before = host.CurrentRevision;
            Place(plan, out var code);
            Assert.AreEqual(before + 1, host.CurrentRevision, "one press, one revision");
            Assert.IsNotNull(Module("lift"));
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsNull(Module("lift"), "one undo takes the shaft back");
        }

        [Test]
        public void TheLargeLiftCarriesItsSizeAndTheSmallOneStaysImplicit() {
            var large = Request("lift", 5, 5, 0);
            large.LiftSizeLarge = true;
            var plan = StationModulePlacement.Resolve(host.Index, large);
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("large", plan.Candidate.Text("size"));
            var small = Request("lift", 5, 5, 0);
            var bare = StationModulePlacement.Resolve(host.Index, small);
            Assert.IsTrue(bare.Ok, bare.Reason);
            Assert.AreEqual("", bare.Candidate.Text("size"), "the 小 shaft stores no size");
        }

        [Test]
        public void ALiftRefusesAHoleUnderItsFootprint() {
            // The 2 × 2 shaft over the fixture's dug hole at (1,1) has no floor under it.
            var plan = StationModulePlacement.Resolve(host.Index, Request("lift", 0, 0, 0));
            Assert.IsFalse(plan.Ok);
            Assert.AreEqual("lift-footprint", plan.Reason);
        }

        // ---------------------------------------------------------------- the walkway

        [Test]
        public void AWalkwayRunsLevelAlongTheStairFacing() {
            var request = Request("walkway", 4, 4, 0);
            request.WalkwayRun = 30;
            var plan = StationModulePlacement.Resolve(host.Index, request);
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("walkway", plan.Candidate.Type);
            Assert.AreEqual(4, plan.Candidate.From.Value.X);
            Assert.AreEqual(4, plan.Candidate.From.Value.Y);
            Assert.AreEqual(34, plan.Candidate.To.Value.Y, "rot 0 climbs along +y, not +x");
            Assert.AreEqual(4, plan.Candidate.To.Value.X);
            Assert.AreEqual(0, plan.Candidate.To.Value.Z, "a walkway is level");
            Assert.AreEqual("up", plan.Candidate.Text("dir"));
            int before = host.CurrentRevision;
            Place(plan, out var code);
            Assert.AreEqual(before + 1, host.CurrentRevision);
            Assert.IsNotNull(Module("walkway"));
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsNull(Module("walkway"));
        }

        [Test]
        public void TheDownWalkwayOrdersItsEndpointsTheOtherWay() {
            var request = Request("walkway", 4, 4, 0);
            request.WalkwayRun = 30;
            request.WalkwayDown = true;
            var plan = StationModulePlacement.Resolve(host.Index, request);
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual(34, plan.Candidate.From.Value.Y, "down travels from the far end back");
            Assert.AreEqual(4, plan.Candidate.To.Value.Y);
            Assert.AreEqual("down", plan.Candidate.Text("dir"));
        }

        [Test]
        public void AWalkwayRefusesARunThatLeavesTheFloor() {
            // The belt lies on the floor for its whole length: the fixture's dug hole at (1,1)
            // is a gap the run crosses, even though both landings are fine.
            var plan = StationModulePlacement.Resolve(host.Index, Request("walkway", 1, 1, 0));
            Assert.IsFalse(plan.Ok);
            Assert.AreEqual("floor", plan.Reason);
        }

        [Test]
        public void TheWalkwayCarriesItsExtraWidth() {
            var request = Request("walkway", 4, 4, 0);
            request.WalkwayRun = 30;
            request.Width = 2;
            var plan = StationModulePlacement.Resolve(host.Index, request);
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual(2, plan.Candidate.Number("width", 0), 0.001);
        }
    }
}
