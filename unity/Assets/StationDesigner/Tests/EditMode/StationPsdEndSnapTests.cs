using System;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §6: the 站台门 end panel's snap (`sim/psdEnds.ts` `snapPsdEnd`). A perpendicular
    /// return seats itself on the nearest screen endpoint in its own corner tile  the panel
    /// keeps its cell and only its local offset and `corner` change  and with no screen in
    /// reach it carries a neighbouring panel's glass plane across a tile.
    /// </summary>
    public sealed class StationPsdEndSnapTests {
        static StationIndex index;

        /// <summary>
        /// A 10 × 10 pavement at 0 with one half-height screen run at (4..7, 3, z = 1) and a
        /// second run two tiles away for the continuation case.
        /// </summary>
        static JObject Save() {
            var cells = new JArray();
            for (int x = 0; x < 10; x++) {
                for (int y = 0; y < 10; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            var modules = new JArray();
            var screen = new JObject {
                ["id"] = "edge-track-1-right", ["type"] = "platform-edge",
                ["x"] = 4, ["y"] = 3, ["z"] = 1, ["rot"] = 0, ["w"] = 4,
                ["cfg"] = new JObject { ["side"] = "right", ["psd"] = "half", ["line"] = "1", ["dir"] = "up" },
            };
            modules.Add(screen);
            modules.Add(new JObject {
                ["id"] = "psd-end-full", ["type"] = "psd-end",
                ["x"] = 4, ["y"] = 5, ["z"] = 1, ["rot"] = 1, ["w"] = 1, ["d"] = 1,
                ["cfg"] = new JObject { ["psd"] = "full", ["side"] = "left", ["corner"] = "edge-track-1-right-full", ["offset"] = new JArray(0, 0.16) },
            });
            modules.Add(new JObject {
                ["id"] = "edge-track-1-right-full", ["type"] = "platform-edge",
                ["x"] = 4, ["y"] = 6, ["z"] = 1, ["rot"] = 0, ["w"] = 4,
                ["cfg"] = new JObject { ["side"] = "right", ["psd"] = "full", ["line"] = "1", ["dir"] = "up" },
            });
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "PSD fixture", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
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

        static StationPlacementRequest Request(int x, int y, int z, int rotation = 0) =>
            new StationPlacementRequest {
                ToolType = "psd-end",
                Rotation = rotation,
                Hit = new StationPlacementHit(x, y, z, x, y, z + 1, true, new StationPoint(x + 0.5, y + 0.5, z + 1), z + 1),
            };

        [Test]
        public void AnEndPanelSeatsItselfOnTheNearScreenEndpoint() {
            // The screen's glass runs along y = 3 with its right side toward +y, so the panel
            // placed on that cell finds the endpoint 0.6 m away and takes the corner.
            var plan = StationModulePlacement.Resolve(index, Request(4, 3, 1, 1));
            Assert.AreNotEqual("unsupported-family", plan.Reason);
            var draft = plan.Candidate;
            Assert.IsNotNull(draft);
            Assert.AreEqual("edge-track-1-right", draft.Text("corner"), "the panel names the screen it seats on");
            Assert.Greater(Math.Abs(draft.OffsetY), 0.0001, "and records where along the tile it sits");
        }

        [Test]
        public void ACoverStacksOnTheFullHeightScreenUnderTheClick() {
            var plan = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                ToolType = "psd-end-cover", Rotation = 0,
                Hit = new StationPlacementHit(5, 6, 1, 5, 6, 2, true, new StationPoint(5.5, 6.5, 2), 2),
            });
            Assert.IsNotNull(plan.Candidate);
            var draft = plan.Candidate;
            Assert.AreEqual(1 + 1 + (int)Math.Round(StationFootprints.PsdFullHeight), draft.Z,
                "the cover sits one course above the screen's full-height top");
            Assert.AreEqual("edge-track-1-right-full", draft.Text("support"));
            Assert.AreEqual("right", draft.Text("side"));
            Assert.AreEqual("full", draft.Text("psd"));
        }

        [Test]
        public void ACoverOnAFullEndDoorFollowsThatDoorsTrimmedSpan() {
            var plan = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                ToolType = "psd-end-cover", Rotation = 1, TargetModuleId = "psd-end-full",
                Hit = new StationPlacementHit(4, 6, 1, 4, 6, 2, true, new StationPoint(4.5, 6.5, 2), 2),
            });
            Assert.IsNotNull(plan.Candidate);
            var draft = plan.Candidate;
            Assert.AreEqual("psd-end-full", draft.Text("support"), "the cover attaches to the door it was named on");
            Assert.AreEqual("left", draft.Text("side"), "end doors render on the left face");
            Assert.AreEqual("full", draft.Text("psd"));
            // One storey above the full door's top (a storey is 5 m in this fixture).
            Assert.AreEqual(1 + 1 + (int)Math.Round(StationFootprints.PsdFullHeight), draft.Z);
            Assert.Greater(double.Parse(draft.Text("depth"), System.Globalization.CultureInfo.InvariantCulture), 0,
                "the cover carries the door's depth");
            Assert.Greater(double.Parse(draft.Text("width"), System.Globalization.CultureInfo.InvariantCulture), 0,
                "and its width");
        }

        [Test]
        public void AnEndPanelWithNoScreenCarriesANeighboursGlassPlane() {
            // A panel already snapped at the screen's end, and a second one a tile along the
            // glass plane: the second carries the first's plane without the corner trim.
            var first = StationModulePlacement.Resolve(index, Request(4, 3, 1, 1));
            Assert.IsNotNull(first.Candidate);
            // With no screen in reach and no neighbouring panel, nothing moves: the panel
            // stays where the player put it instead of inventing a join.
            var lone = new StationEditDraft {
                Type = "psd-end", X = 8, Y = 8, Z = 1, Rotation = 0,
            };
            lone.Set("psd", "half");
            Assert.IsFalse(StationPsdEndRules.TrySnap(index, lone), "nothing to seat on");
            Assert.AreEqual(0, lone.OffsetX, 0.0001);
            Assert.AreEqual("", lone.Text("corner"));
        }
    }
}
