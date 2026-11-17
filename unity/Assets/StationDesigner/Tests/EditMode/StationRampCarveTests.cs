using System;
using System.Collections.Generic;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §5: the corridor a run carves through solid ground (`sim/openings.ts`
    /// `carveRampOpenings`). A block is reached when the run's lane span crosses its near edge
    /// and it sits above the walking line within the run's headroom; a wall is never carved, and
    /// the lowest block over an opened column is tagged as the shaft's ceiling.
    /// </summary>
    public sealed class StationRampCarveTests {
        static StationIndex index;

        /// <summary>
        /// A 16 × 8 slab at 0 with a six-course rock layer over x 2..13 at y = 3, plus a wall
        /// column at (8, 4) so the "a wall is never carved" rule has something to keep.
        /// </summary>
        static JObject Save() {
            var cells = new JArray();
            for (int x = 0; x < 16; x++) {
                for (int y = 0; y < 8; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            for (int x = 2; x <= 13; x++) {
                for (int z = 1; z <= 6; z++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = 3, ["z"] = z, ["fill"] = "solid" });
                }
            }
            for (int z = 1; z <= 3; z++) {
                cells.Add(new JObject { ["x"] = 8, ["y"] = 4, ["z"] = z, ["fill"] = "solid", ["tags"] = new JArray("wall") });
            }
            var modules = new JArray {
                new JObject {
                    ["id"] = "stair-1", ["type"] = "stair", ["x"] = 2, ["y"] = 3, ["z"] = 0,
                    ["rot"] = 0, ["w"] = 6, ["d"] = 1,
                    ["from"] = new JObject { ["x"] = 2, ["y"] = 3, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 8, ["y"] = 3, ["z"] = 3 },
                    ["cfg"] = new JObject { ["width"] = 1 },
                },
            };
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Carve fixture", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            };
        }

        [SetUp]
        public void SetUp() {
            if (index == null) {
                var read = StationDocumentReader.Read(Save().ToString(Newtonsoft.Json.Formatting.None), StationSource.None);
                Assert.IsTrue(StationIndex.TryCreate(read.Document, out index, out var rejection), rejection?.ToString() ?? "");
            }
        }

        static StationCellWrite WriteAt(List<StationCellWrite> writes, int x, int y, int z) {
            foreach (var write in writes) {
                if (write.Key.X != x || write.Key.Y != y || write.Key.Z != z) continue;
                return write;
            }
            return null;
        }

        [Test]
        public void TheRunOpensTheBlocksAboveItsWalkingLine() {
            var writes = StationRampCarve.Carve(index);
            Assert.Greater(writes.Count, 0, "the straight run carves its corridor");
            // A block three courses up over the middle of the run is above the line and inside
            // the headroom, so it is opened; the rock far along the strip is not.
            Assert.IsNotNull(WriteAt(writes, 5, 3, 2), "a block over the run's line is carved");
            Assert.IsNull(WriteAt(writes, 13, 3, 6), "rock beyond the run is untouched");
        }

        /// <summary>A 12 × 12 floor with a two-flight 180° stair at (2, 3): up 4 cells, back 4.</summary>
        static StationIndex Switchback(out StationModuleRecord stair) {
            var cells = new JArray();
            for (int x = 0; x < 12; x++)
                for (int y = 0; y < 12; y++)
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
            var modules = new JArray {
                new JObject {
                    ["id"] = "stair-180", ["type"] = "stair", ["x"] = 2, ["y"] = 3, ["z"] = 0, ["rot"] = 0,
                    ["w"] = 4, ["d"] = 3,
                    ["from"] = new JObject { ["x"] = 2, ["y"] = 3, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 2, ["y"] = 7, ["z"] = 5 },
                    ["cfg"] = new JObject {
                        ["width"] = 2.79, ["style"] = "right180",
                        ["flights"] = new JArray {
                            new JObject {
                                ["from"] = new JObject { ["x"] = 2, ["y"] = 3, ["z"] = 0 },
                                ["to"] = new JObject { ["x"] = 2, ["y"] = 7, ["z"] = 2 },
                            },
                            new JObject {
                                ["from"] = new JObject { ["x"] = 4, ["y"] = 7, ["z"] = 2 },
                                ["to"] = new JObject { ["x"] = 4, ["y"] = 3, ["z"] = 5 },
                            },
                        },
                    },
                },
            };
            var save = new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Switchback", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            };
            var read = StationDocumentReader.Read(save.ToString(Newtonsoft.Json.Formatting.None), StationSource.None);
            Assert.IsTrue(StationIndex.TryCreate(read.Document, out var built, out var rejection), rejection?.ToString() ?? "");
            Assert.IsTrue(built.TryGetModule("stair-180", out stair));
            return built;
        }

        [Test]
        public void ASwitchbackYieldsOneRunPerFlightAndSlidesTheReturn() {
            var switchback = Switchback(out var stair);
            var runs = StationRampCarve.RunsFor(stair);
            Assert.AreEqual(2, runs.Count, "two saved flights are two corridors");
            var slides = StationStairSlides.Slides(stair);
            Assert.AreEqual(2, slides.Count);
            // This stair is 2.04 m wide, which fills three whole blocks: its runs already stand
            // the gap apart the treads want, so the return needs no extra slide  both bands
            // take the same half-lane grid centring and their balustrades meet on the seam.
            Assert.AreEqual(1, slides[0].Dx, 0.0001, "a three-lane band is centred one lane across");
            Assert.AreEqual(0, slides[0].Dy, 0.0001, "and nothing along its run");
            Assert.AreEqual(slides[0].Dx, slides[1].Dx, 0.0001, "the return lies flush with it");
            Assert.AreEqual(slides[0].Dy, slides[1].Dy, 0.0001);
            _ = switchback;
        }

        [Test]
        public void TheCarveAndTheRunCommitInOneRevision() {
            // What the pointer router does on a fresh flight: the piece and the corridor it
            // opens are one patch, so one press is one revision and one undo.
            var hostObject = new UnityEngine.GameObject(StationGameHost.ObjectName);
            var host = hostObject.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(host, null);
            Assert.IsTrue(host.OpenDocument(Save().ToString(Newtonsoft.Json.Formatting.None), "file").Accepted);
            int revision = host.CurrentRevision;
            var stair = new StationEditDraft {
                Type = "stair", X = 2, Y = 3, Z = 0, Rotation = 0, Width = 1, Depth = 1,
            };
            stair.From = new StationPoint(2, 3, 0);
            stair.To = new StationPoint(8, 3, 3);
            stair.Set("width", "1");
            stair.Id = StationModulePlacement.NextId(host.Index, "stair");
            var patch = new StationCellPatch();
            patch.ModuleAdds.Add(stair);
            foreach (var write in StationRampCarve.Carve(host.Index, new[] { StationModulePlacement.ToRecord(stair) }))
                patch.Writes.Add(write);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, patch, "place", null, out _, out var code), code);
            Assert.AreEqual(revision + 1, host.CurrentRevision, "the run and its carve are one revision");
            bool carved = false;
            foreach (var cell in host.Index.Document.Cells)
                if (cell.X == 5 && cell.Y == 3 && cell.Z == 2) carved = true;
            Assert.IsFalse(carved, "the block over the run's line is gone");
            UnityEngine.Object.DestroyImmediate(hostObject);
            StationEditSession.Reset();
        }

        [Test]
        public void AWallBesideTheRunIsNeverCarved() {
            var writes = StationRampCarve.Carve(index);
            Assert.IsNull(WriteAt(writes, 8, 4, 2), "a wall stays solid: the rail runs against it");
        }

        [Test]
        public void TheLowestBlockOverAnOpeningIsTaggedAsItsCeiling() {
            var writes = StationRampCarve.Carve(index);
            var tags = new List<string>();
            foreach (var write in writes) if (write.Tags != null) tags.AddRange(write.Tags);
            Assert.Contains(StationRampCarve.OpeningCeiling, tags,
                "the block left hanging over the shaft is tagged as its ceiling");
        }

    }
}
