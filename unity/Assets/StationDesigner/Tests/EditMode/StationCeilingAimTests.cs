using System;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §5: the ceiling aim (`app/tools/moduleAim.ts`'s hung branch). A ceiling-hung
    /// fitting hangs from the **underside overhead** — the lowest solid course whose own cell
    /// below is open air — so a light or a vent pointed at from the floor lands under the slab,
    /// and a cell with nothing overhead falls back to the stand cell and is refused there.
    /// </summary>
    public sealed class StationCeilingAimTests {
        static StationIndex index;

        static JObject Save() {
            var cells = new JArray();
            for (int x = 0; x < 6; x++) {
                for (int y = 0; y < 6; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            // A two-by-two slab at 4 m over (2,2)–(3,3): its underside is the ceiling there.
            for (int x = 2; x <= 3; x++) {
                for (int y = 2; y <= 3; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 4, ["fill"] = "solid" });
                }
            }
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Ceiling fixture", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = new JArray(), ["lines"] = new JArray() },
            };
        }

        [SetUp]
        public void SetUp() {
            if (index == null) {
                var read = StationDocumentReader.Read(Save().ToString(Newtonsoft.Json.Formatting.None), StationSource.None);
                Assert.IsTrue(StationIndex.TryCreate(read.Document, out index, out var rejection), rejection?.ToString() ?? "");
            }
        }

        static StationPlacementRequest Request(string type, int x, int y, int z) =>
            new StationPlacementRequest {
                ToolType = type,
                Rotation = 0,
                Hit = new StationPlacementHit(x, y, z, x, y, z + 1, true, new StationPoint(x + 0.5, y + 0.5, z + 1), z + 1),
            };

        [Test]
        public void AHungFittingAimsAtTheSlabUnderneathItNotTheFloor() {
            var at = StationModulePlacement.AimCell(index, Request("light", 2, 2, 0));
            Assert.AreEqual(2, at.X, 0.001);
            Assert.AreEqual(2, at.Y, 0.001);
            Assert.AreEqual(3, at.Z, 0.001, "the anchor is the air cell under the slab at 4 m");
            var plan = StationModulePlacement.Resolve(index, Request("light", 2, 2, 0));
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.IsTrue(plan.Candidate.CeilingAnchored, "the piece records that it hangs");
            Assert.IsTrue(StationFootprints.TryClearance(StationModulePlacement.ToRecord(plan.Candidate), out var box, out _));
            Assert.AreEqual(3.92, box.Z0, 0.001, "a light is a shallow fitting under its slab");
            Assert.AreEqual(4.0, box.Z1, 0.001);
        }

        [Test]
        public void ACeilingWithNothingOverheadFallsBackToTheStandCellAndIsRefused() {
            // (0,0) has no slab above it: the aim is the hit cell itself.
            var at = StationModulePlacement.AimCell(index, Request("light", 0, 0, 0));
            Assert.AreEqual(0, at.Z, 0.001);
            var plan = StationModulePlacement.Resolve(index, Request("light", 0, 0, 0));
            Assert.IsFalse(plan.Ok);
            Assert.AreEqual("ceiling", plan.Reason);
        }

        [Test]
        public void ACarriedFittingFollowsTheSameCeilingAim() {
            var plan = StationModulePlacement.Resolve(index, Request("light", 2, 2, 0));
            Assert.IsTrue(plan.Ok, plan.Reason);
            plan.Candidate.Id = "light-1";
            var record = StationModulePlacement.ToRecord(plan.Candidate);
            var moved = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                Carried = record,
                Rotation = 0,
                Hit = new StationPlacementHit(3, 3, 0, 3, 3, 1, true, new StationPoint(3.5, 3.5, 1), 1),
            });
            Assert.IsTrue(moved.IsMove);
            Assert.IsTrue(moved.Ok, moved.Reason);
            Assert.AreEqual(3, moved.Candidate.Z, 0.001, "it hangs under the same slab at its new cell");
            Assert.IsTrue(moved.Candidate.CeilingAnchored);
        }

        [Test]
        public void MovedRectangularLightUsesAndSavesTheTurnedGridPosition() {
            var placed = StationModulePlacement.Resolve(index, Request("light-rectangular", 2, 2, 0));
            Assert.IsTrue(placed.Ok, placed.Reason);
            placed.Candidate.Id = "light-1";
            var saved = StationModuleEdits.ToSaveRecord(placed.Candidate);
            var envelope = Save();
            ((JArray)envelope["static"]["modules"]).Add(saved);
            var request = Request("light-rectangular", 3, 3, 0);
            request.Carried = StationModulePlacement.ToRecord(placed.Candidate);
            request.Rotation = 1;
            request.LightPosition = 1;

            var moved = StationModulePlacement.Resolve(index, request);
            Assert.IsTrue(moved.Ok, moved.Reason);
            var record = StationModulePlacement.ToRecord(moved.Candidate);
            Assert.IsTrue(StationFootprints.TryClearance(record, out var box, out _));
            var pivot = ModulePlacement.Position(record.Facts, new UnityEngine.Vector3(0.5f, 0.5f, 1));
            Assert.AreEqual(3.06, pivot.x, 0.001);
            Assert.AreEqual(3.60, pivot.z, 0.001);
            Assert.AreEqual(pivot.x, (box.X0 + box.X1) / 2, 0.001);
            Assert.AreEqual(pivot.z, (box.Y0 + box.Y1) / 2, 0.001);
            Assert.AreEqual(0.12, box.X1 - box.X0, 0.001);

            Assert.IsTrue(StationModuleEdits.ApplyToEnvelope(envelope, StationModuleEditMode.Replace, moved.Candidate, null, out var code), code);
            Assert.AreEqual(1, (int)saved["cfg"]["position"]);
            Assert.AreEqual(1, (int)saved["rot"]);
        }
    }
}
