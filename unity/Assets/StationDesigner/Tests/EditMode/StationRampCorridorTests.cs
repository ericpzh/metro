using System;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §5: the ramp **corridor**. `sim/openings.ts` `rampEnvelope` is now the reservation
    /// for a straight flight, an escalator and a 自动步道 — the box the block brush and other
    /// pieces are held off — while a turning stair stays an explicit refusal. Placement itself
    /// still refuses a fresh flight until the carve (`rampSlopeCuts`/`carveRampOpenings`) lands:
    /// the corridor alone would refuse the floor a flight stands on.
    /// </summary>
    public sealed class StationRampCorridorTests {
        static JObject Save() {
            var cells = new JArray();
            for (int x = 0; x < 20; x++) {
                for (int y = 0; y < 20; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            var modules = new JArray {
                new JObject {
                    ["id"] = "stair-1", ["type"] = "stair", ["x"] = 4, ["y"] = 4, ["z"] = 0, ["rot"] = 0,
                    ["from"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 4, ["y"] = 12, ["z"] = 5 },
                    ["cfg"] = new JObject { ["width"] = 0.68, ["style"] = "straight" },
                },
                new JObject {
                    ["id"] = "escalator-1", ["type"] = "escalator", ["x"] = 10, ["y"] = 4, ["z"] = 0, ["rot"] = 0,
                    ["from"] = new JObject { ["x"] = 10, ["y"] = 4, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 10, ["y"] = 12, ["z"] = 5 },
                    ["cfg"] = new JObject { ["width"] = 2, ["dir"] = "up" },
                },
                new JObject {
                    ["id"] = "stair-turn", ["type"] = "stair", ["x"] = 14, ["y"] = 4, ["z"] = 0, ["rot"] = 0,
                    ["from"] = new JObject { ["x"] = 14, ["y"] = 4, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 18, ["y"] = 8, ["z"] = 5 },
                    ["cfg"] = new JObject {
                        ["width"] = 1.79, ["style"] = "leftForward",
                        ["flights"] = new JArray {
                            new JObject {
                                ["from"] = new JObject { ["x"] = 14, ["y"] = 4, ["z"] = 0 },
                                ["to"] = new JObject { ["x"] = 14, ["y"] = 8, ["z"] = 5 },
                            },
                            new JObject {
                                ["from"] = new JObject { ["x"] = 14, ["y"] = 8, ["z"] = 5 },
                                ["to"] = new JObject { ["x"] = 18, ["y"] = 8, ["z"] = 5 },
                            },
                        },
                    },
                },
            };
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Ramp fixture", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            };
        }

        static StationIndex index;
        static StationDocument document;

        [SetUp]
        public void SetUp() {
            if (document == null) {
                document = StationDocumentReader.Read(Save().ToString(Newtonsoft.Json.Formatting.None), StationSource.None).Document;
                Assert.IsTrue(StationIndex.TryCreate(document, out index, out var rejection), rejection?.ToString() ?? "");
            }
        }

        static StationModuleRecord Module(string id) {
            index.TryGetModule(id, out var module);
            return module;
        }

        [Test]
        public void AStraightStairReservesItsCorridor() {
            Assert.IsTrue(StationFootprints.TryClearance(Module("stair-1"), out var box, out var unsupported), unsupported);
            // One lane wide (its tread is 0.79 m, so the corridor is the whole tile), rising to
            // 5 m: the body hangs 0.5 m under the walking line, the rail stands 1.2 m above it.
            Assert.AreEqual(4, box.X0, 0.001);
            Assert.AreEqual(5, box.X1, 0.001);
            Assert.AreEqual(4, box.Y0, 0.001);
            Assert.AreEqual(13, box.Y1, 0.001);
            Assert.AreEqual(0.35, box.Z0, 0.001);
            Assert.AreEqual(7.35, box.Z1, 0.001);
        }

        [Test]
        public void AWideEscalatorWidensAcrossItsRun() {
            Assert.IsTrue(StationFootprints.TryClearance(Module("escalator-1"), out var box, out var unsupported), unsupported);
            // A two-lane escalator runs along +y, so the extra lane widens it across x: its
            // corridor is a metre either side of the centre, while y keeps its own tile.
            Assert.AreEqual(9.5, box.X0, 0.001);
            Assert.AreEqual(11.5, box.X1, 0.001);
            Assert.AreEqual(4, box.Y0, 0.001);
            Assert.AreEqual(13, box.Y1, 0.001);
        }

        [Test]
        public void ATurningStairReservesTheUnionOfItsFlights() {
            // A multi-flight stair is boxed per flight and unioned, so its corridor is a known
            // reservation rather than an unportlaimed one.
            Assert.IsTrue(StationFootprints.TryClearance(Module("stair-turn"), out var box, out var unsupported), unsupported);
            // The fixture turns from +y at (14,4) to +x at (14,8): the union spans both legs.
            Assert.LessOrEqual(box.X0, 14, "the first leg is inside the union");
            Assert.GreaterOrEqual(box.Y1, 8, "and so is the second leg");
        }

        [Test]
        public void ADiagonalRunHasAKnownCorridor() {
            // An oblique leg is one straightened segment boxed by its own half-width on both
            // axes, so a diagonal run is a reservation the collider queries can name.
            var cells = new JArray();
            for (int x = 0; x < 12; x++)
                for (int y = 0; y < 12; y++)
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
            var modules = new JArray {
                new JObject {
                    ["id"] = "stair-diag", ["type"] = "stair", ["x"] = 2, ["y"] = 2, ["z"] = 0, ["rot"] = 0,
                    ["from"] = new JObject { ["x"] = 2, ["y"] = 2, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 6, ["y"] = 6, ["z"] = 3 },
                    ["cfg"] = new JObject { ["width"] = 0.68, ["style"] = "straight" },
                },
            };
            var save = new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Diagonal", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            };
            var read = StationDocumentReader.Read(save.ToString(Newtonsoft.Json.Formatting.None), StationSource.None);
            Assert.IsTrue(StationIndex.TryCreate(read.Document, out var diagonal, out var rejection), rejection?.ToString() ?? "");
            Assert.IsTrue(diagonal.TryGetModule("stair-diag", out var stair));
            Assert.IsTrue(StationRampRules.TryEnvelope(stair, out var box, out var unsupported), unsupported);
            Assert.Less(box.X0, 2.5, "the corridor covers the run's lower end");
            Assert.Greater(box.X1, 6.5, "and its upper end");
            Assert.Greater(box.Y1, 6.5);
        }

        [Test]
        public void TheCorridorIsAKnownBoxRatherThanAnUnverifiedReservation() {
            // A run's cells are the carve's business (`IsRunOrRail` skips it in the block
            // reservation), but its envelope is no longer unknown: collider queries can name it.
            var world = StationCellEditWorld.Build(index);
            Assert.IsFalse(world.Unverified.Contains("stair-1"), "the corridor is a known box now");
            Assert.IsTrue(StationFootprints.TryClearance(Module("stair-1"), out var box, out _));
            var bench = new StationBox(4, 10, 1, 5, 11, 2);
            Assert.IsTrue(box.Overlaps(bench), "a piece standing in the corridor overlaps it");
        }

        [Test]
        public void AFreshStraightFlightPlacesWithItsCarve() {
            // The corridor and the carve are one rule now: a straight single flight resolves,
            // and the commit that opens the corridor is the same revision (StationRampCarve).
            // A clean floor, so the flight has only the carve to answer to.
            var floor = new JArray();
            for (int x = 0; x < 12; x++)
                for (int y = 0; y < 12; y++)
                    floor.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
            var empty = new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Clean", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = floor, ["modules"] = new JArray(), ["lines"] = new JArray() },
            };
            var read = StationDocumentReader.Read(empty.ToString(Newtonsoft.Json.Formatting.None), StationSource.None);
            Assert.IsTrue(StationIndex.TryCreate(read.Document, out var clean, out var rejection), rejection?.ToString() ?? "");
            var plan = StationModulePlacement.Resolve(clean, new StationPlacementRequest {
                ToolType = "stair",
                Rotation = 0,
                Hit = new StationPlacementHit(4, 4, 0, 4, 4, 1, true, new StationPoint(4.5, 4.5, 1), 1),
            });
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("stair", plan.Candidate.Type);
        }

        [Test]
        public void ATurningFlightKeepsItsOwnRefusal() {
            // A multi-flight stair's landings and slides are not ported, so it still refuses
            // with a stable code instead of placing through a carve that cannot seat it.
            // The envelope folds a multi-flight stair into the union of its flights, so both
            // the turning piece and the straight one have a known corridor now.
            Assert.IsTrue(StationRampRules.IsStraightRun(Module("stair-turn")),
                "a multi-flight stair has a known union envelope");
            Assert.IsTrue(StationRampRules.IsStraightRun(Module("stair-1")));
        }
    }
}
