using System;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §5: the wall aim (`app/tools/moduleAim.ts`'s wall branch). A wall-mounted piece
    /// hangs on a column's face: the hit names the course and the piece stands on the floor at
    /// the column's foot. A non-floor-standing 玻璃板 is the one piece that follows the aimed
    /// course, because its size is a band of wall.
    /// </summary>
    public sealed class StationWallAimTests {
        static StationIndex index;

        /// <summary>
        /// A 8 × 8 pavement at 0 with a wall column at (2,2) from z = 1 to 3 and a second one
        /// from z = -1 (a column founded below the floor) at (5,5).
        /// </summary>
        static JObject Save() {
            var cells = new JArray();
            for (int x = 0; x < 8; x++) {
                for (int y = 0; y < 8; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            for (int z = 1; z <= 3; z++) {
                for (int x = 2; x <= 3; x++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = 2, ["z"] = z, ["fill"] = "solid", ["tags"] = new JArray("wall") });
                }
            }
            for (int z = -1; z <= 2; z++) {
                cells.Add(new JObject { ["x"] = 5, ["y"] = 5, ["z"] = z, ["fill"] = "solid", ["tags"] = new JArray("wall") });
            }
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Wall fixture", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
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

        static StationPlacementRequest WallHit(string type, int cx, int cy, int cz, int px, int py) =>
            new StationPlacementRequest {
                ToolType = type,
                Rotation = 0,
                Hit = new StationPlacementHit(cx, cy, cz, px, py, cz, true,
                    new StationPoint(cx + 0.5, cy + 0.5, cz + 0.5), cz + 1),
            };

        [Test]
        public void AWallPieceStandsOnTheFloorAtTheFootOfTheColumn() {
            // The pointer hits the wall course at (2,2,2) from the air cell (2,3,2) in front.
            var at = StationModulePlacement.AimCell(index, WallHit("monitor-wall", 2, 2, 2, 2, 3));
            Assert.AreEqual(2, at.X, 0.001, "the anchor is the cell in front of the wall");
            Assert.AreEqual(3, at.Y, 0.001);
            Assert.AreEqual(0, at.Z, 0.001, "and stands on the pavement the column was raised from");
        }

        [Test]
        public void AColumnFoundedBelowTheFloorAnchorsOnItsOwnBase() {
            // The column at (5,5) starts a course below the pavement, so the exposed floor in
            // front of it is the pavement itself.
            var at = StationModulePlacement.AimCell(index, WallHit("monitor-wall", 5, 5, 2, 4, 5));
            Assert.AreEqual(4, at.X, 0.001);
            Assert.AreEqual(0, at.Z, 0.001);
        }

        [Test]
        public void AGlassPanelFollowsTheCourseItWasAimedAt() {
            // A non-floor-standing glass panel is a band of wall, so it hangs over the course
            // the pointer named: one course below the hit cell.
            var at = StationModulePlacement.AimCell(index, WallHit("glass-2x2", 2, 2, 2, 2, 3));
            Assert.AreEqual(1, at.Z, 0.001, "the panel is pinned to the aimed course");
        }

        [Test]
        public void AMonitorWallPlacesOnTheWallItWasAimedAt() {
            var plan = StationModulePlacement.Resolve(index, WallHit("monitor-wall", 2, 2, 2, 2, 3));
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("monitor", plan.Candidate.Type);
            Assert.AreEqual("wall", plan.Candidate.Text("mount"));
            Assert.AreEqual(0, plan.Candidate.Z, "it stands on the floor, not on the course");
            Assert.AreEqual(3, plan.Candidate.Width);
        }

        [Test]
        public void AWallLineMapHangsItsTwoCellBoardOnABackedFace() {
            var plan = StationModulePlacement.Resolve(index, WallHit("linemap-wall", 2, 2, 2, 2, 3));
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("linemap", plan.Candidate.Type);
            Assert.AreEqual("wall", plan.Candidate.Text("mount"));
            Assert.AreEqual(2, plan.Candidate.Width, "the board is two cells wide");
            Assert.AreEqual(2, plan.Candidate.X, "centred on the aimed cell");
            Assert.AreEqual(3, plan.Candidate.Y, "and standing off the wall it hangs on");
            Assert.AreEqual(0, plan.Candidate.Z, "on the floor at the foot of the column");
        }

        [Test]
        public void AStandingLineMapTotemStandsOnTheFloor() {
            var plan = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                ToolType = "linemap-stand",
                Rotation = 0,
                Hit = new StationPlacementHit(4, 4, 0, 4, 4, 1, true, new StationPoint(4.5, 4.5, 1), 1),
            });
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("stand", plan.Candidate.Text("mount"));
            Assert.IsFalse(StationFootprints.IsWallMounted(StationModulePlacement.ToRecord(plan.Candidate)),
                "the totem stands on the floor, it does not hang");
        }

        [Test]
        public void AStationNamePanelIsCutFromTheNameOnce() {
            // `calligraphyGeometry`: a 横排 band is `PAD + n × ADVANCE` rounded up to an **odd**
            // cell count (that odd width is what puts the run's centre on the aimed cell), and
            // a 竖排 column is always one cell wide.
            var band = StationCalligraphy.For("动物园", "h");
            // 0.3 + 3 × 0.86 = 2.88 → three cells, the odd count the rule asks for.
            Assert.AreEqual(3, band.Cells, "a three-character name spans three cells");
            Assert.AreEqual(1, band.PanelH, 0.0001, "横排 is a one-metre band");
            Assert.AreEqual(1.2, band.Bottom, 0.0001, "hung from 1.2 m");
            var column = StationCalligraphy.For("动物园", "v");
            Assert.AreEqual(1, column.Cells, "竖排 is one cell wide");
            Assert.AreEqual(2.6, column.PanelH, 0.0001, "capped by the column's 2.6 m ceiling");
            Assert.AreEqual(0.4, column.Bottom, 0.0001);
            // A two-character name wants 2.02 m, still three cells; a five-character name would
            // want 4.6 m and is capped by the band's own five-cell ceiling.
            Assert.AreEqual(3, StationCalligraphy.For("广州", "h").Cells);
            Assert.AreEqual(5, StationCalligraphy.For("动物园南门站", "h").Cells);
            // The courses a panel is backed on follow its bottom and height.
            Assert.AreEqual(2, StationCalligraphy.Courses(1.2, 1).Count, "1.2 → 2.2 crosses two courses");
        }

        [Test]
        public void ABillboardFillsItsVariantsRun() {
            // `billboardSpec(variant).w`: the sized 16:9 panels are six and seven cells wide,
            // and the run is centred on the aim like a track piece.
            var plan = StationModulePlacement.Resolve(index, WallHit("billboard-16x9-4m", 2, 2, 2, 2, 3));
            Assert.IsNotNull(plan.Candidate);
            Assert.AreEqual("billboard", plan.Candidate.Type);
            Assert.AreEqual("16x9-4m", plan.Candidate.Text("variant"));
            Assert.AreEqual(7, plan.Candidate.Width, "the four-metre 16:9 panel fills seven cells");
            // The board hangs on the wall's face (cell 2,3) and its seven-cell run is centred
            // on that anchored cell, so it starts three cells along: 2 - 3.
            Assert.AreEqual(-1, plan.Candidate.X, "centred on the anchored cell");
            Assert.AreEqual(3, plan.Candidate.Y);
            var bare = StationModulePlacement.Resolve(index, WallHit("billboard", 2, 2, 2, 2, 3));
            Assert.AreEqual("wide", bare.Candidate.Text("variant"), "a bare id is the small landscape");
            Assert.AreEqual(1, bare.Candidate.Width);
        }

        [Test]
        public void ABillboardRollsItsPosterFromItsId() {
            // `randomAdSlug`: the poster is deterministic in the module id, so the same click
            // hangs the same campaign and a redo never reshuffles the wall.
            var plan = StationModulePlacement.Resolve(index, WallHit("billboard-16x9-4m", 2, 2, 2, 2, 3));
            var draft = plan.Candidate;
            draft.Id = "billboard-7";
            Assert.IsTrue(StationAdPosters.RollFor(draft), "a fresh screen takes a poster");
            string poster = draft.Text("poster");
            Assert.IsFalse(string.IsNullOrEmpty(poster), "and the slug is real");
            draft.Config.Remove("poster");
            StationAdPosters.RollFor(draft);
            Assert.AreEqual(poster, draft.Text("poster"), "the same id rolls the same campaign");
            // A landscape panel never prints a portrait poster.
            bool landscape = false;
            foreach (var choice in StationAdPosters.PostersFor(StationAdPosters.Shape.Landscape))
                if (choice.Slug == poster) landscape = true;
            Assert.IsTrue(landscape, "a 16:9 panel takes a landscape poster");
        }

        [Test]
        public void AWallSignIsBornWithAComposedFront() {
            // `defaultSignLayout`: four components on the board's centre line  arrow-left, the
            // line badge, the exit icon, arrow-right  and a wall sign has no back at all.
            var plan = StationModulePlacement.Resolve(index, WallHit("sign-wall", 2, 2, 2, 2, 3));
            Assert.IsNotNull(plan.Candidate);
            Assert.AreEqual("sign", plan.Candidate.Type);
            Assert.AreEqual("wall", plan.Candidate.Text("mount"));
            var front = plan.Candidate.Text("front");
            StringAssert.Contains("\"kind\":\"arrow\"", front);
            StringAssert.Contains("\"kind\":\"icon\"", front);
            int components = 0;
            int at = 0;
            while ((at = front.IndexOf("\"kind\"", at, StringComparison.Ordinal)) >= 0) { components++; at += 6; }
            Assert.AreEqual(3, components, "arrow, exit icon, arrow  no line badge in this fixture");
            Assert.AreEqual("[]", plan.Candidate.Text("back").Replace(" ", ""), "a wall sign has no back");
        }

        [Test]
        public void AStationWithNoLinePrintsNoShield() {
            // No saved line in the fixture, so the default front omits the badge rather than
            // claiming a line the station does not have.
            var plan = StationModulePlacement.Resolve(index, WallHit("sign-wall", 2, 2, 2, 2, 3));
            Assert.IsFalse(plan.Candidate.Text("front").Contains("\"kind\":\"line\""),
                "no line, no shield");
        }

        [Test]
        public void AWallPieceWithNothingToHangOnIsRefused() {
            // The air cell (7,7) has no wall anywhere near it.
            var plan = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                ToolType = "monitor-wall",
                Rotation = 0,
                Hit = new StationPlacementHit(7, 7, 1, 7, 7, 2, true, new StationPoint(7.5, 7.5, 2), 2),
            });
            Assert.IsFalse(plan.Ok, "a wall piece needs a wall behind it");
        }
    }
}
