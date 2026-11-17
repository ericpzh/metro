using System;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §5: the 楼梯块 tile — one solid stair box, not a flight. It rides the ordinary
    /// placement resolver (`createModule`'s stair-block branch), so the cases pin the box it
    /// builds, the floor/occupancy refusals it shares with every other piece, and the fact that
    /// the unported ramp corridor no longer swallows it.
    /// </summary>
    public sealed class StationStairBlockTests {
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

        StationPlacementRequest Request(int x, int y, int z, bool solid, double blockHeight = 1) =>
            new StationPlacementRequest {
                ToolType = "stair-block",
                Rotation = 0,
                BlockHeight = blockHeight,
                Hit = StationCellFixture.Hit(x, y, z, solid).Cell,
            };

        StationModuleRecord Block() {
            foreach (var module in host.Index.Document.Modules) {
                if (module.Type == "stair" && module.Config.Bool("block")) return module;
            }
            return null;
        }

        [Test]
        public void APressLaysOneSolidStairBlock() {
            var plan = StationModulePlacement.Resolve(host.Index, Request(4, 4, 0, true));
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("stair", plan.Candidate.Type, "the box is a solid stair, not a flight");
            Assert.IsTrue(plan.Candidate.Bool("block"));
            Assert.AreEqual(1, plan.Candidate.Number("blockHeight", 0), 0.001);
            Assert.IsTrue(plan.Candidate.From.HasValue && plan.Candidate.To.HasValue, "it carries its own run");
            Assert.AreEqual(3, plan.Candidate.From.Value.X, "the run starts one cell back");
            Assert.AreEqual(4, plan.Candidate.From.Value.Y);
            Assert.AreEqual(5, plan.Candidate.To.Value.X, "and steps one cell forward");
            Assert.AreEqual(1, plan.Candidate.To.Value.Z, "with its top one course up");
            int before = host.CurrentRevision;
            plan.Candidate.Id = StationModulePlacement.NextId(host.Index, "stair");
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, plan.Candidate, null, "place",
                null, out _, out var code), code);
            Assert.AreEqual(before + 1, host.CurrentRevision, "one press, one revision");
            var block = Block();
            Assert.IsNotNull(block, "the pressed cell carries the stair block");
            Assert.AreEqual(4, block.X);
            Assert.AreEqual(4, block.Y);
        }

        [Test]
        public void TheLowBlockCarriesHalfAMetre() {
            var plan = StationModulePlacement.Resolve(host.Index, Request(4, 4, 0, true, blockHeight: 0.5));
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual(0.5, plan.Candidate.Number("blockHeight", 0), 0.001);
        }

        [Test]
        public void AStairBlockRefusesAHoleAndAnOccupiedCell() {
            var hole = StationModulePlacement.Resolve(host.Index, Request(1, 1, 0, true));
            Assert.IsFalse(hole.Ok);
            Assert.AreEqual("floor", hole.Reason, "a dug hole is not floor for the block");
            var occupied = StationModulePlacement.Resolve(host.Index, Request(3, 3, 0, true));
            Assert.IsFalse(occupied.Ok, "the fixture's half wall stands in the block's own course");
            Assert.AreEqual("occupied", occupied.Reason);
        }

        [Test]
        public void AStairBlockIsNotTreatedAsARun() {
            var plan = StationModulePlacement.Resolve(host.Index, Request(4, 4, 0, true));
            // A 楼梯块 is one solid box: it never takes a run's corridor or carve refusal.
            Assert.AreNotEqual("ramp-corridor-unported", plan.Reason);
            Assert.AreNotEqual("ramp-turning-unported", plan.Reason);
            Assert.IsTrue(plan.Ok, plan.Reason);
            // A straight single flight now places with its carve; the box stays a plain box.
            var flight = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "stair", Rotation = 0, Hit = StationCellFixture.Hit(4, 4, 0, true).Cell,
            });
            Assert.AreNotEqual("ramp-turning-unported", flight.Reason);
        }

        [Test]
        public void OneStairBlockIsOneUndoEntry() {
            var plan = StationModulePlacement.Resolve(host.Index, Request(4, 4, 0, true));
            plan.Candidate.Id = StationModulePlacement.NextId(host.Index, "stair");
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, plan.Candidate, null, "place",
                null, out _, out var code), code);
            Assert.IsNotNull(Block());
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsNull(Block(), "one undo takes the block back");
        }
    }
}
