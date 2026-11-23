using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Domain D5 parity tests: equipment, signage, calligraphy, city styles, placement,
    /// wall/ceiling support, outdoor surfaces, booth geometry, walk-graph exclusions,
    /// TV schedules and grid repair.
    /// </summary>
    public sealed class StationEquipmentParityTests {
        /* ------------------------------------------------------------- fixtures */

        static JObject Cell(int x, int y, int z, string fill = "solid", string[] tags = null, string finishTop = null) {
            var cell = new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = fill };
            if (tags != null && tags.Length > 0) cell["tags"] = new JArray(tags);
            if (!string.IsNullOrEmpty(finishTop)) cell["finish"] = new JObject { ["top"] = finishTop };
            return cell;
        }

        static JObject Module(string id, string type, int x, int y, int z, int rot = 0,
            int w = 1, int d = 1, int h = 1, JObject cfg = null, bool ceilingAnchored = false, double panelH = 0) {
            var module = new JObject {
                ["id"] = id, ["type"] = type, ["x"] = x, ["y"] = y, ["z"] = z, ["rot"] = rot,
                ["w"] = w, ["d"] = d, ["h"] = h, ["cfg"] = cfg ?? new JObject(),
            };
            if (ceilingAnchored) module["ceilingAnchored"] = true;
            if (panelH > 0) module["panelH"] = panelH;
            return module;
        }

        static JObject Line(string id, string name, string colour, string upTerminus, string downTerminus) => new JObject {
            ["id"] = id, ["name"] = name, ["nameEn"] = "Line " + id, ["colour"] = colour,
            ["stock"] = "L", ["cars"] = 6, ["power"] = "third-rail", ["psd"] = "full",
            ["direction"] = "up", ["upTerminus"] = upTerminus, ["downTerminus"] = downTerminus,
            ["headwayProfile"] = new JObject { ["peak"] = 150, ["offpeak"] = 240, ["late"] = 480 },
        };

        static StationReadResult ReadStation(IEnumerable<JObject> cells, IEnumerable<JObject> modules = null,
            IEnumerable<JObject> lines = null, string name = "动物园", string city = "guangzhou", int levelBase = 0) {
            var save = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = name,
                ["nameEn"] = "Parity",
                ["city"] = city,
                ["seed"] = 1234567,
                ["levelBase"] = levelBase,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = new JArray(cells ?? Array.Empty<JObject>()),
                    ["modules"] = new JArray(modules ?? Array.Empty<JObject>()),
                    ["lines"] = new JArray(lines ?? Array.Empty<JObject>()),
                },
            };
            return StationDocumentReader.Read(save.ToString(Formatting.None), StationSource.None);
        }

        static List<JObject> FloorPad(int x0, int x1, int y0, int y1, int z) {
            var cells = new List<JObject>();
            for (int x = x0; x <= x1; x++)
                for (int y = y0; y <= y1; y++)
                    cells.Add(Cell(x, y, z));
            return cells;
        }

        static StationPlacementRequest FloorHit(string tool, int x, int y, int z, int rot = 0, int width = 0,
            int? lightPosition = null, string targetModuleId = "") =>
            new StationPlacementRequest {
                ToolType = tool,
                Rotation = rot,
                Width = width,
                LightPosition = lightPosition,
                TargetModuleId = targetModuleId,
                Hit = new StationPlacementHit(x, y, z, x, y, z + 1, true,
                    new StationPoint(x + 0.5, y + 0.5, z + 1), z + 1),
            };

        static StationPlacementRequest WallHit(string tool, int cx, int cy, int cz, int px, int py, int rot = 0) =>
            new StationPlacementRequest {
                ToolType = tool,
                Rotation = rot,
                Hit = new StationPlacementHit(cx, cy, cz, px, py, cz, true,
                    new StationPoint(cx + 0.5, cy + 0.5, cz + 0.5), cz + 1),
            };

        static StationModuleRecord RecordOf(string id, string type, int x, int y, int z, int rot = 0,
            int w = 1, int d = 1, int h = 1, JObject cfg = null, bool ceilingAnchored = false, double panelH = 0) {
            var json = Module(id, type, x, y, z, rot, w, d, h, cfg, ceilingAnchored, panelH);
            var facts = ModuleFactsReader.Read(json);
            return new StationModuleRecord(id, type, x, y, z, rot, w, d, h, ceilingAnchored,
                null, null, Array.Empty<string>(), json.ToString(Formatting.None), facts, panelH);
        }

        sealed class FixedReservations : IStationCellReservations {
            readonly HashSet<StationCellKey> openings;
            public FixedReservations(params StationCellKey[] cells) =>
                openings = new HashSet<StationCellKey>(cells);
            public HashSet<StationCellKey> OpeningsAtLevel(int z, IReadOnlyList<StationModuleRecord> modules) {
                var result = new HashSet<StationCellKey>();
                foreach (var cell in openings) if (cell.Z == z) result.Add(cell);
                return result;
            }
        }

        /* ---------------------------------- 1. WallSupport, Sign-Wall & Calligraphy */

        [Test]
        public void MultiCellWallMountsRequireBackingOnEveryCellAndEveryCourseAtGradeAndUnderground() {
            var cases = new (string Tool, int Width, int[] Courses, int AimX, bool Centred)[] {
                ("billboard-16x9-4m", 7, new[] { 0, 1, 2, 3 }, 5, true),
                ("linemap-wall", 2, new[] { 1, 2 }, 5, true),
                ("monitor-wall", 3, new[] { 0, 1, 2 }, 5, true),
                ("calligraphy-wei-h", 3, new[] { 1, 2 }, 5, false),
                ("glass-3x2", 3, new[] { 0, 1 }, 5, true),
            };
            foreach (int floorZ in new[] { 0, -5, -15 }) {
                foreach (var item in cases) {
                    int startX = item.Centred ? item.AimX - (int)Math.Floor((item.Width - 1) / 2.0) : item.AimX;
                    int endX = startX + item.Width - 1;
                    // Glass follows aimed course (`cz - 1`), so hitting floorZ + 1 anchors at floorZ.
                    int hitCourseZ = floorZ + 1;

                    // Full wall across every run cell and every required course succeeds.
                    var fullCells = FloorPad(0, 12, 0, 6, floorZ);
                    for (int x = startX; x <= endX; x++)
                        foreach (int c in item.Courses)
                            fullCells.Add(Cell(x, 2, floorZ + 1 + c, tags: new[] { "wall" }));
                    // Ensure the hit cell at (AimX, 2, hitCourseZ) exists as wall so aim resolves cleanly.
                    if (!item.Courses.Contains(0))
                        fullCells.Add(Cell(item.AimX, 2, hitCourseZ, tags: new[] { "wall" }));

                    var full = ReadStation(fullCells);
                    var okPlan = StationModulePlacement.Resolve(full.Index,
                        WallHit(item.Tool, item.AimX, 2, hitCourseZ, item.AimX, 3, rot: 0));
                    Assert.IsTrue(okPlan.Ok, $"{item.Tool} at z={floorZ} full backing failed: {okPlan.Reason}");
                    Assert.AreEqual(startX, okPlan.Candidate.X, $"{item.Tool} anchor X at z={floorZ}");
                    Assert.AreEqual(floorZ, okPlan.Candidate.Z, $"{item.Tool} anchor Z at z={floorZ}");

                    // Missing ONE cell at the far end of the run must refuse with "wall".
                    var shortEnd = fullCells.Where(c => !((int)c["x"] == endX && (int)c["y"] == 2 && (int)c["z"] == floorZ + 1 + item.Courses[0])).ToList();
                    var shortRead = ReadStation(shortEnd);
                    var shortPlan = StationModulePlacement.Resolve(shortRead.Index,
                        WallHit(item.Tool, item.AimX, 2, hitCourseZ, item.AimX, 3, rot: 0));
                    Assert.IsFalse(shortPlan.Ok, $"{item.Tool} at z={floorZ} missing end cell must fail");
                    Assert.AreEqual("wall", shortPlan.Reason, $"{item.Tool} at z={floorZ} missing end cell reason");

                    // Missing the highest required course across the run must refuse with "wall".
                    int topCourse = item.Courses[item.Courses.Length - 1];
                    var shortHeight = fullCells.Where(c => !((int)c["y"] == 2 && (int)c["z"] == floorZ + 1 + topCourse)).ToList();
                    var heightRead = ReadStation(shortHeight);
                    var heightPlan = StationModulePlacement.Resolve(heightRead.Index,
                        WallHit(item.Tool, item.AimX, 2, hitCourseZ, item.AimX, 3, rot: 0));
                    Assert.IsFalse(heightPlan.Ok, $"{item.Tool} at z={floorZ} missing top course must fail");
                    Assert.AreEqual("wall", heightPlan.Reason, $"{item.Tool} at z={floorZ} missing top course reason");
                }

                // Underground with ZERO wall blocks (floor only) must NOT falsely hit virtual street z=0.
                if (floorZ < 0) {
                    var floorOnly = ReadStation(FloorPad(0, 12, 0, 6, floorZ));
                    foreach (var item in cases) {
                        var plan = StationModulePlacement.Resolve(floorOnly.Index,
                            FloorHit(item.Tool, 5, 3, floorZ, rot: 0));
                        Assert.IsFalse(plan.Ok, $"{item.Tool} underground z={floorZ} with no wall must fail");
                        Assert.AreEqual("wall", plan.Reason, $"{item.Tool} underground z={floorZ} no-wall reason");
                    }
                }
            }
        }

        [Test]
        public void HalfWallAndCompoundCutBackingEnforceFacingSide() {
            // Billboard at (4, 4, 0) with rot = 1 -> WallSide(1) = (+1, 0), so backing cell is (5, 4, 1)
            // and the panel's back touches the WEST face of cell (5, 4, 1).
            StationPlacementPlan ResolveWithWall(string tool, params JObject[] wallCells) {
                var cells = FloorPad(0, 8, 0, 8, 0);
                cells.AddRange(wallCells);
                var read = ReadStation(cells);
                return StationModulePlacement.Resolve(read.Index, WallHit(tool, 5, 4, 1, 4, 4, rot: 1));
            }

            Assert.IsTrue(ResolveWithWall("billboard", Cell(5, 4, 1, tags: new[] { "wall", "half-wall:w" })).Ok,
                "half-wall facing panel backs it");
            var away = ResolveWithWall("billboard", Cell(5, 4, 1, tags: new[] { "wall", "half-wall:e" }));
            Assert.IsFalse(away.Ok);
            Assert.AreEqual("wall", away.Reason, "half-wall facing away must not back a panel");

            var sideways = ResolveWithWall("billboard", Cell(5, 4, 1, tags: new[] { "wall", "half-wall:n" }));
            Assert.IsFalse(sideways.Ok);
            Assert.AreEqual("wall", sideways.Reason, "perpendicular half-wall must not back a panel");

            // Compound L-shape keeping full west half (`half-wall:n` + `half-corner:w` => NW+NE+SW) backs west face.
            Assert.IsTrue(ResolveWithWall("billboard", Cell(5, 4, 1, tags: new[] { "wall", "half-wall:n", "half-corner:w" })).Ok,
                "L-shape compound cut filling the facing half backs the panel");

            // Compound cut whose west half only holds one corner (`half-wall:e` + `half-corner:w` => NE+SE+SW) fails.
            var oppositeCut = ResolveWithWall("billboard", Cell(5, 4, 1, tags: new[] { "wall", "half-wall:e", "half-corner:w" }));
            Assert.IsFalse(oppositeCut.Ok);
            Assert.AreEqual("wall", oppositeCut.Reason, "compound cut missing part of the facing half is refused");

            // Multi-cell billboard run (width 2 along +y at rot=1 -> y=4 and y=5): both cells need facing half.
            var goodRun = ResolveWithWall("billboard-large",
                Cell(5, 4, 1, tags: new[] { "wall", "half-wall:w" }),
                Cell(5, 5, 1, tags: new[] { "wall", "half-wall:w" }));
            Assert.IsTrue(goodRun.Ok, goodRun.Reason);

            var mixedRun = ResolveWithWall("billboard-large",
                Cell(5, 4, 1, tags: new[] { "wall", "half-wall:w" }),
                Cell(5, 5, 1, tags: new[] { "wall", "half-wall:e" }));
            Assert.IsFalse(mixedRun.Ok);
            Assert.AreEqual("wall", mixedRun.Reason, "second cell with half-wall facing away refuses the run");
        }

        [Test]
        public void WallSignPlacesOnBackedWallAtGradeAndUndergroundAndRefusesOpenAir() {
            foreach (int z in new[] { 0, -5 }) {
                var cells = FloorPad(0, 8, 0, 8, z);
                cells.Add(Cell(4, 2, z + 1, tags: new[] { "wall" }));
                cells.Add(Cell(4, 2, z + 2, tags: new[] { "wall" }));
                var backed = ReadStation(cells);

                var plan = StationModulePlacement.Resolve(backed.Index, WallHit("sign-wall", 4, 2, z + 2, 4, 3, rot: 0));
                Assert.IsTrue(plan.Ok, $"sign-wall at z={z} should succeed: {plan.Reason}");
                Assert.AreEqual("sign", plan.Candidate.Type);
                Assert.AreEqual("wall", plan.Candidate.Text("mount"));
                Assert.AreEqual(z, plan.Candidate.Z);

                var record = StationModulePlacement.ToRecord(plan.Candidate);
                Assert.IsTrue(StationFootprints.TryClearance(record, out var box, out var err), err);
                Assert.AreEqual(0.003, box.Depth, 1e-6, "wall sign reserves 3 mm stand-off along wall normal");
                Assert.AreEqual(z + 1 + 1.45, box.Z0, 1e-6);
                Assert.AreEqual(z + 1 + 1.85, box.Z1, 1e-6);

                // Moving a wall sign to another backed cell works; moving to open air refuses with "wall".
                var cells2 = new List<JObject>(cells) {
                    Cell(6, 2, z + 1, tags: new[] { "wall" }),
                    Cell(6, 2, z + 2, tags: new[] { "wall" }),
                };
                var moveWorld = ReadStation(cells2);
                plan.Candidate.Id = "sign-wall-1";
                var carried = StationModulePlacement.ToRecord(plan.Candidate);
                var movedOk = StationModulePlacement.Resolve(moveWorld.Index, new StationPlacementRequest {
                    Carried = carried, Rotation = 0,
                    Hit = WallHit("sign-wall", 6, 2, z + 2, 6, 3, rot: 0).Hit,
                });
                Assert.IsTrue(movedOk.Ok, $"moving sign-wall at z={z} failed: {movedOk.Reason}");
                Assert.AreEqual(6, movedOk.Candidate.X);

                var movedOpenAir = StationModulePlacement.Resolve(moveWorld.Index, new StationPlacementRequest {
                    Carried = carried, Rotation = 0,
                    Hit = FloorHit("sign-wall", 7, 7, z).Hit,
                });
                Assert.IsFalse(movedOpenAir.Ok);
                Assert.AreEqual("wall", movedOpenAir.Reason);
            }

            // Only course 0 backed (missing course 1 required by sign-wall) -> refused with "wall".
            var lowWall = FloorPad(0, 8, 0, 8, 0);
            lowWall.Add(Cell(4, 2, 1, tags: new[] { "wall" }));
            var lowRead = ReadStation(lowWall);
            var lowPlan = StationModulePlacement.Resolve(lowRead.Index, WallHit("sign-wall", 4, 2, 1, 4, 3, rot: 0));
            Assert.IsFalse(lowPlan.Ok);
            Assert.AreEqual("wall", lowPlan.Reason);

            // Booth-attached wall sign uses BOOTH_SIGN_PANEL_Z (2.2 m) and boothOffset.
            var boothSign = RecordOf("sign-booth", "sign", 10, 20, -15, rot: 0, cfg: new JObject {
                ["mount"] = "wall",
                ["boothId"] = "booth-1",
                ["boothOffset"] = new JObject { ["x"] = 0.5, ["y"] = 0 },
                ["front"] = new JArray {
                    new JObject { ["id"] = "c1", ["kind"] = "icon", ["icon"] = "exit", ["x"] = 0.5, ["y"] = 0.2, ["scale"] = 1, ["side"] = "both" },
                },
                ["back"] = new JArray(),
            });
            Assert.IsTrue(StationFootprints.TryClearance(boothSign, out var boothBox, out var boothErr), boothErr);
            Assert.AreEqual(10.5, boothBox.X0, 1e-6, "boothOffset.x shifts wall sign centre");
            Assert.AreEqual(11.5, boothBox.X1, 1e-6);
            Assert.AreEqual(20.0, boothBox.Y0, 1e-6);
            Assert.AreEqual(20.003, boothBox.Y1, 1e-6);
            Assert.AreEqual(-12.0, boothBox.Z0, 1e-6, "booth sign bottom = z + 1 + 2.2 - 0.2");
            Assert.AreEqual(-11.6, boothBox.Z1, 1e-6);
        }

        [Test]
        public void SignRepairAppliesFiveCentimetrePanelWidthRoundingParity() {
            // Two arrows placed near the right end so span = 1.02 m -> want = 1.02 + 0.24 = 1.26 m ->
            // rounds to 1.25 m (5 cm step), shifting the row onto centre of 1.25 m instead of 1.26 m.
            // Arrow width at scale 1 = 0.32 + 0.04 = 0.36 m (half = 0.18 m).
            // c1 at x = 0.68 ([0.50, 0.86]), c2 at x = 1.34 ([1.16, 1.52]) => span = 1.02, want = 1.26 -> panel 1.25.
            // Expected shift = (1.25 - 1.02) / 2 - 0.50 = -0.385 => c1.x = 0.295, c2.x = 0.955.
            var sign = new JObject {
                ["id"] = "sign-round", ["type"] = "sign", ["x"] = 0, ["y"] = 0, ["z"] = 0, ["rot"] = 0,
                ["cfg"] = new JObject {
                    ["mount"] = "wall",
                    ["front"] = new JArray {
                        new JObject { ["id"] = "c1", ["kind"] = "arrow", ["arrow"] = "left", ["x"] = 0.68, ["y"] = 0.2, ["scale"] = 1, ["side"] = "both" },
                        new JObject { ["id"] = "c2", ["kind"] = "arrow", ["arrow"] = "right", ["x"] = 1.34, ["y"] = 0.2, ["scale"] = 1, ["side"] = "both" },
                    },
                    ["back"] = new JArray(),
                },
            };
            var repaired = JObject.Parse(StationSignRepair.NormalizeJson(sign.ToString(Formatting.None)));
            var front = (JArray)repaired["cfg"]["front"];
            Assert.AreEqual(0.295, (double)front[0]["x"], 1e-6, "5 cm rounding to 1.25 m centres c1 at 0.295");
            Assert.AreEqual(0.955, (double)front[1]["x"], 1e-6, "5 cm rounding to 1.25 m centres c2 at 0.955");

            // StationSignBoards agrees byte-for-byte with StationSignRepair on the same input.
            var boards = StationSignBoards.FromConfig(sign["cfg"]["front"].ToString(Formatting.None), "[]", "");
            Assert.AreEqual(1.25f, StationSignBoards.PanelWidth(boards.Front), 1e-5f);
            Assert.AreEqual((double)front[0]["x"], boards.Front[0].X, 1e-5);
            Assert.AreEqual((double)front[1]["x"], boards.Front[1].X, 1e-5);

            // Second check: want = 1.28 -> rounds UP to 1.30 m (span = 1.04: c1 at 0.68, c2 at 1.36).
            ((JObject)((JArray)sign["cfg"]["front"])[1])["x"] = 1.36;
            var repairedUp = JObject.Parse(StationSignRepair.NormalizeJson(sign.ToString(Formatting.None)));
            var frontUp = (JArray)repairedUp["cfg"]["front"];
            // shift = (1.30 - 1.04) / 2 - 0.50 = -0.37 => c1.x = 0.31, c2.x = 0.99.
            Assert.AreEqual(0.31, (double)frontUp[0]["x"], 1e-6, "want=1.28 rounds up to 1.30 m");
            Assert.AreEqual(0.99, (double)frontUp[1]["x"], 1e-6);

            // Oracle parity check against sign-normalization-input/expected JSON.
            string dir = Path.Combine(Application.dataPath, "StationDesigner/Tests/EditMode");
            string input = File.ReadAllText(Path.Combine(dir, "sign-normalization-input.json"));
            string expected = File.ReadAllText(Path.Combine(dir, "sign-normalization-expected.json"));
            var actualArr = JArray.Parse(StationSignRepair.NormalizeSaveSignsJson(input));
            var expectedArr = JArray.Parse(expected);
            Assert.AreEqual(expectedArr.Count, actualArr.Count);
            var actualFront = (JArray)actualArr[0]["cfg"]["front"];
            var expectedFront = (JArray)expectedArr[0]["cfg"]["front"];
            Assert.AreEqual(expectedFront.Count, actualFront.Count);
            for (int i = 0; i < expectedFront.Count; i++) {
                Assert.AreEqual((string)expectedFront[i]["id"], (string)actualFront[i]["id"]);
                Assert.AreEqual((double)expectedFront[i]["x"], (double)actualFront[i]["x"], 1e-9);
                Assert.AreEqual((double)expectedFront[i]["scale"], (double)actualFront[i]["scale"], 1e-9);
            }
        }

        [Test]
        public void CalligraphyCountsAndLaysOutAstralUnicodeCodePointsWithoutSplittingSurrogates() {
            const string extensionB = "\uD842\uDFB7"; // 𠮷 (U+20BB7)
            const string trainEmoji = "\uD83D\uDE87"; // 🚇 (U+1F687)

            var charsExt = StationCalligraphy.Chars(extensionB + "野家");
            CollectionAssert.AreEqual(new[] { extensionB, "野", "家" }, charsExt,
                "CJK Extension B surrogate pair counts as 1 character, not 2");

            var charsEmoji = StationCalligraphy.Chars(trainEmoji + "站");
            CollectionAssert.AreEqual(new[] { trainEmoji, "站" }, charsEmoji,
                "astral emoji surrogate pair counts as 1 character");

            // Capping at MaxChars (8) must never bisect a surrogate pair.
            string nineAstral = string.Concat(Enumerable.Repeat(extensionB, 9));
            var capped = StationCalligraphy.Chars(nineAstral);
            Assert.AreEqual(StationCalligraphy.MaxChars, capped.Count);
            foreach (var glyph in capped) {
                Assert.AreEqual(extensionB, glyph, "each capped entry stays an intact surrogate pair");
            }

            // Geometry matches a 3-character BMP name (3 odd cells).
            var geom = StationCalligraphy.For(extensionB + "野家", "h");
            Assert.AreEqual(3, geom.Cells);
            Assert.AreEqual(3, geom.Chars.Count);

            // Layout produces 3 glyphs (not 4) with intact Text and matching slot positions.
            var panel = new Vector2(4f, 1f);
            var horizontal = StationCalligraphyArtwork.Layout(extensionB + "野家", "h", "wei", panel);
            Assert.AreEqual(3, horizontal.Count, "horizontal layout keeps astral code point intact");
            Assert.AreEqual(extensionB, horizontal[0].Text);
            Assert.AreEqual("野", horizontal[1].Text);
            Assert.AreEqual("家", horizontal[2].Text);
            float slot = (4f - StationCalligraphyArtwork.Pad) / 3f;
            Assert.AreEqual(0.15f + slot * 0.5f, horizontal[0].X, 1e-4f);
            Assert.AreEqual(StationCalligraphyArtwork.Jitter(extensionB, 97) * 0.035f, horizontal[0].Turn, 1e-6f);

            var vertical = StationCalligraphyArtwork.Layout(extensionB + "野家", "v", "wei", new Vector2(1f, 2f));
            Assert.AreEqual(3, vertical.Count, "vertical layout keeps astral code point intact");
            Assert.AreEqual(extensionB, vertical[0].Text);
        }

        /* ---------------------------------- 2. CeilingSupport, Vent, Lights, Hanger & Aim */

        [Test]
        public void AllSevenCeilingPropsPlaceAndMoveUnderElevatedTrackDeckAndRefuseWithoutSupport() {
            var cells = FloorPad(0, 8, 0, 8, 0);
            var elevatedTrack = Module("track-elev", "track", 1, 1, 6, rot: 0, w: 6, d: 3, cfg: new JObject {
                ["line"] = "1", ["bridge"] = true, ["tunnel"] = false,
            });
            var tunnelTrack = Module("track-tunnel", "track", 1, 5, 6, rot: 0, w: 4, d: 3, cfg: new JObject {
                ["line"] = "1", ["tunnel"] = true,
            });
            var read = ReadStation(cells, new[] { elevatedTrack, tunnelTrack });

            string[] props = { "sign-ceiling", "tv", "clock", "cctv", "light-circular", "vent", "monitor" };
            foreach (string tool in props) {
                // Place under elevated track deck (z = 6 -> underside at 5 -> prop anchors at z = 4).
                var plan = StationModulePlacement.Resolve(read.Index, FloorHit(tool, 2, 2, 0));
                Assert.IsTrue(plan.Ok, $"{tool} under elevated track deck failed: {plan.Reason}");
                Assert.AreEqual(4, plan.Candidate.Z, $"{tool} anchors directly under track deck underside 5");
                Assert.IsTrue(plan.Candidate.CeilingAnchored, $"{tool} sets CeilingAnchored under track deck");

                // Move placed prop to another cell under the same track deck.
                plan.Candidate.Id = tool + "-1";
                var moved = StationModulePlacement.Resolve(read.Index, new StationPlacementRequest {
                    Carried = StationModulePlacement.ToRecord(plan.Candidate),
                    Rotation = 0,
                    Hit = FloorHit(tool, 4, 2, 0).Hit,
                });
                Assert.IsTrue(moved.Ok, $"moving {tool} under elevated track deck failed: {moved.Reason}");
                Assert.AreEqual(4, moved.Candidate.Z);
                Assert.IsTrue(moved.Candidate.CeilingAnchored);

                // Under open sky -> refused with "ceiling".
                var sky = StationModulePlacement.Resolve(read.Index, FloorHit(tool, 7, 7, 0));
                Assert.IsFalse(sky.Ok, $"{tool} under open sky must fail");
                Assert.AreEqual("ceiling", sky.Reason, $"{tool} open sky refusal");

                // Under a tunnel track with no solid slab -> refused with "ceiling".
                var underTunnel = StationModulePlacement.Resolve(read.Index, FloorHit(tool, 2, 6, 0));
                Assert.IsFalse(underTunnel.Ok, $"{tool} under bare tunnel track must fail");
                Assert.AreEqual("ceiling", underTunnel.Reason);
            }
        }

        [Test]
        public void PostCctvAndVariantRoofsRefuseUndergroundPlacements() {
            var cells = FloorPad(0, 16, 0, 16, 0);
            cells.AddRange(FloorPad(0, 16, 0, 16, -5));
            var read = ReadStation(cells);

            var postBelow = StationModulePlacement.Resolve(read.Index, FloorHit("cctv-post", 4, 4, -5));
            Assert.IsFalse(postBelow.Ok);
            Assert.AreEqual("outdoor-below-ground", postBelow.Reason, "cctv-post refused underground");

            var postAbove = StationModulePlacement.Resolve(read.Index, FloorHit("cctv-post", 4, 4, 0));
            Assert.IsTrue(postAbove.Ok, postAbove.Reason);

            // Variant roofs (canopy, shell, truss, tapered) refused underground with "exit-on-slab",
            // even when there is no floor at that depth (matching web canopy.test.mjs).
            var emptyUnderground = ReadStation(FloorPad(0, 16, 0, 16, 0));
            foreach (string roofTool in new[] { "roof-canopy", "roof-shell", "roof-truss", "roof-tapered" }) {
                var belowWithFloor = StationModulePlacement.Resolve(read.Index, FloorHit(roofTool, 6, 6, -5, width: 4));
                Assert.IsFalse(belowWithFloor.Ok, $"{roofTool} underground with floor must fail");
                Assert.AreEqual("exit-on-slab", belowWithFloor.Reason, $"{roofTool} underground refusal");

                var belowNoFloor = StationModulePlacement.Resolve(emptyUnderground.Index, FloorHit(roofTool, 6, 6, -4, width: 4));
                Assert.IsFalse(belowNoFloor.Ok, $"{roofTool} underground without floor must fail");
                Assert.AreEqual("exit-on-slab", belowNoFloor.Reason, $"{roofTool} reports exit-on-slab before floor");
            }

            // Plain roof plate (no variant) stays legal underground (e.g. ceiling plate).
            var plainRoofBelow = StationModulePlacement.Resolve(read.Index, FloorHit("roof", 6, 6, -5));
            Assert.IsTrue(plainRoofBelow.Ok, plainRoofBelow.Reason);
        }

        [Test]
        public void VentPlacesUnderSlabClearsFurnitureBelowAndCollidesWithCeilingFixturesAndPillars() {
            var cells = FloorPad(0, 6, 0, 6, 0);
            for (int x = 1; x <= 4; x++) cells.Add(Cell(x, 2, 4));
            var modules = new[] {
                Module("desk-1", "desk", 1, 2, 0),
                Module("bench-1", "bench", 2, 2, 0, cfg: new JObject { ["variant"] = "steel-1" }),
                Module("shelf-1", "shelf", 3, 2, 0, cfg: new JObject { ["variant"] = "cafe-backbar" }),
            };
            var read = ReadStation(cells, modules);

            // Vent clears desk, bench, and tallest shelf (2.15 m) underneath.
            foreach (int x in new[] { 1, 2, 3 }) {
                var plan = StationModulePlacement.Resolve(read.Index, FloorHit("vent", x, 2, 0));
                Assert.IsTrue(plan.Ok, $"vent over furniture at x={x} failed: {plan.Reason}");
                Assert.IsEmpty(plan.ColliderIds);
                Assert.IsTrue(StationFootprints.TryClearance(StationModulePlacement.ToRecord(plan.Candidate), out var box, out _));
                Assert.AreEqual(3.94, box.Z0, 1e-6);
                Assert.AreEqual(4.0, box.Z1, 1e-6);
                Assert.AreEqual(0.7, box.Width, 1e-6);
                Assert.AreEqual(0.7, box.Depth, 1e-6);
            }

            // Vent collides with co-located vent, light-circular, and pillar-slim.
            var clashes = new[] {
                Module("vent-existing", "vent", 1, 2, 3, ceilingAnchored: true),
                Module("light-existing", "light", 2, 2, 3, cfg: new JObject { ["variant"] = "circular" }, ceilingAnchored: true),
                Module("pillar-existing", "pillar", 3, 2, 0, cfg: new JObject { ["size"] = "slim", ["height"] = 5 }),
            };
            var clashRead = ReadStation(cells, clashes);
            var expectedBlockers = new (int X, string Id)[] { (1, "vent-existing"), (2, "light-existing"), (3, "pillar-existing") };
            foreach (var item in expectedBlockers) {
                var plan = StationModulePlacement.Resolve(clashRead.Index, FloorHit("vent", item.X, 2, 0));
                Assert.IsFalse(plan.Ok, $"vent should collide with {item.Id}");
                Assert.AreEqual("occupied", plan.Reason);
                CollectionAssert.Contains(plan.ColliderIds, item.Id);
            }
        }

        [Test]
        public void RectangularLightNinePositionsRotationParityAndSharingVsCollision() {
            var order = new (int X, int Y)[] {
                (0, 0), (-1, 1), (0, 1), (1, 1), (-1, 0), (1, 0), (-1, -1), (0, -1), (1, -1),
            };
            for (int pos = 0; pos < 9; pos++) {
                var cfg = new ModuleConfig(new Dictionary<string, string> {
                    ["variant"] = "rectangular", ["position"] = pos.ToString(),
                });
                for (int rot = 0; rot < 4; rot++) {
                    var plan = StationFootprints.LightPlan(rot, cfg);
                    bool turned = rot % 2 == 1;
                    double expectedW = turned ? 0.12 : 0.8;
                    double expectedD = turned ? 0.8 : 0.12;
                    Assert.AreEqual(expectedW, plan.Width, 1e-9, $"pos={pos} rot={rot} width");
                    Assert.AreEqual(expectedD, plan.Depth, 1e-9, $"pos={pos} rot={rot} depth");
                    Assert.AreEqual(order[pos].X * (1 - expectedW) / 2, plan.OffsetX, 1e-9, $"pos={pos} rot={rot} ox");
                    Assert.AreEqual(order[pos].Y * (1 - expectedD) / 2, plan.OffsetY, 1e-9, $"pos={pos} rot={rot} oy");
                }
            }

            // Circular light ignores rotation in both LightPlan and ModulePlacement.Rotation.
            var circularCfg = new ModuleConfig(new Dictionary<string, string> { ["variant"] = "circular" });
            for (int rot = 0; rot < 4; rot++) {
                var circular = StationFootprints.LightPlan(rot, circularCfg);
                Assert.AreEqual((0.5, 0.5, 0.0, 0.0), circular);
                var facts = new ModuleFacts { Type = "light", Rotation = rot, Config = circularCfg };
                Assert.AreEqual(Quaternion.identity, ModulePlacement.Rotation(facts), "circular light ignores rotation");
            }
            var rectCfg = new ModuleConfig(new Dictionary<string, string> { ["variant"] = "rectangular" });
            Assert.AreEqual(ModulePlacement.Rotation(0), ModulePlacement.Rotation(new ModuleFacts { Type = "light", Rotation = 2, Config = rectCfg }),
                "rectangular light folds rotation modulo 2");
            Assert.AreEqual(ModulePlacement.Rotation(1), ModulePlacement.Rotation(new ModuleFacts { Type = "light", Rotation = 3, Config = rectCfg }));

            // Two non-overlapping rectangular lights sharing one cell (north pos=2 & south pos=7) succeed;
            // overlapping positions (pos=1 & pos=2, both along y = +0.44) collide.
            var cells = FloorPad(0, 4, 0, 4, 0);
            cells.Add(Cell(2, 2, 4));
            var northLight = Module("light-north", "light", 2, 2, 3, rot: 0,
                cfg: new JObject { ["variant"] = "rectangular", ["position"] = 2 }, ceilingAnchored: true);
            var read = ReadStation(cells, new[] { northLight });

            var southPlan = StationModulePlacement.Resolve(read.Index, FloorHit("light-rectangular", 2, 2, 0, rot: 0, lightPosition: 7));
            Assert.IsTrue(southPlan.Ok, "non-overlapping north & south rectangular lights share one cell: " + southPlan.Reason);

            var overlapPlan = StationModulePlacement.Resolve(read.Index, FloorHit("light-rectangular", 2, 2, 0, rot: 0, lightPosition: 1));
            Assert.IsFalse(overlapPlan.Ok, "overlapping rectangular lights in one cell collide");
            Assert.AreEqual("occupied", overlapPlan.Reason);
            CollectionAssert.Contains(overlapPlan.ColliderIds, "light-north");
        }

        [Test]
        public void HangerSupportsCompatibleCeilingPropsAndMoveFromSlabToHangerClearsCeilingAnchored() {
            // HangerAcceptsPiece contract.
            Assert.IsTrue(StationModulePlacement.HangerAcceptsPiece("tv", "", ""));
            Assert.IsTrue(StationModulePlacement.HangerAcceptsPiece("clock", "", ""));
            Assert.IsTrue(StationModulePlacement.HangerAcceptsPiece("clock", "digital", ""));
            Assert.IsTrue(StationModulePlacement.HangerAcceptsPiece("cctv", "bullet", ""));
            Assert.IsTrue(StationModulePlacement.HangerAcceptsPiece("cctv", "dome", ""));
            Assert.IsFalse(StationModulePlacement.HangerAcceptsPiece("cctv", "post", ""));
            Assert.IsTrue(StationModulePlacement.HangerAcceptsPiece("sign", "", "ceiling"));
            Assert.IsFalse(StationModulePlacement.HangerAcceptsPiece("sign", "", "wall"));
            Assert.IsFalse(StationModulePlacement.HangerAcceptsPiece("light", "circular", ""));
            Assert.IsFalse(StationModulePlacement.HangerAcceptsPiece("vent", "", ""));

            var cells = FloorPad(0, 12, 0, 6, 0);
            // Solid slab only over (1, 2) at z = 4; post hanger at x = 4..7, y = 2, z = 0 (no slab overhead);
            // roof hanger at x = 4..7, y = 4, z = 0 with slab overhead at z = 5.
            cells.Add(Cell(1, 2, 4));
            for (int x = 4; x <= 7; x++) cells.Add(Cell(x, 4, 5));

            var postHanger = Module("hanger-post-1", "hanger", 4, 2, 0, rot: 0, w: 4, cfg: new JObject { ["mount"] = "post" });
            var roofHanger = Module("hanger-roof-1", "hanger", 4, 4, 0, rot: 0, w: 4, cfg: new JObject { ["mount"] = "roof" });
            var read = ReadStation(cells, new[] { postHanger, roofHanger });
            var mounts = StationCeilingMounts.ForIndex(read.Index);

            // StationCeilingMounts resolves HangerPost (3 m) and HangerRoof (4 m) heights.
            var tvOnPost = RecordOf("tv-p", "tv", 5, 2, 0, rot: 0);
            var tvOnRoof = RecordOf("tv-r", "tv", 5, 4, 0, rot: 0);
            var postMount = mounts.Resolve(tvOnPost.Facts, 4);
            var roofMount = mounts.Resolve(tvOnRoof.Facts, 4);
            Assert.AreEqual(StationCeilingMounts.SupportKind.HangerPost, postMount.Support);
            Assert.AreEqual(3.0, postMount.Local, 1e-6);
            Assert.AreEqual(StationCeilingMounts.SupportKind.HangerRoof, roofMount.Support);
            Assert.AreEqual(4.0, roofMount.Local, 1e-6);

            // Analogue clock hangs at perpendicular rotation, while digital clock & tv require parallel rotation.
            var postRec = read.Index.GetModule("hanger-post-1");
            Assert.IsTrue(StationModulePlacement.HangerSupports(postRec, RecordOf("clk-a", "clock", 5, 2, 0, rot: 1)));
            Assert.IsFalse(StationModulePlacement.HangerSupports(postRec, RecordOf("clk-d", "clock", 5, 2, 0, rot: 1, cfg: new JObject { ["variant"] = "digital" })));
            Assert.IsFalse(StationModulePlacement.HangerSupports(postRec, RecordOf("tv-perp", "tv", 5, 2, 0, rot: 1)));
            Assert.IsFalse(StationCeilingMounts.HangerSupports(postRec.Facts, RecordOf("lt", "light", 5, 2, 0, rot: 0).Facts));

            // Place under slab (CeilingAnchored == true), then move onto post hanger -> CeilingAnchored clears to false.
            foreach (string tool in new[] { "tv", "clock", "cctv", "sign-ceiling" }) {
                var underSlab = StationModulePlacement.Resolve(read.Index, FloorHit(tool, 1, 2, 0, rot: 0));
                Assert.IsTrue(underSlab.Ok, $"{tool} under slab failed: {underSlab.Reason}");
                Assert.IsTrue(underSlab.Candidate.CeilingAnchored, $"{tool} starts CeilingAnchored under slab");

                underSlab.Candidate.Id = tool + "-move";
                var moved = StationModulePlacement.Resolve(read.Index, new StationPlacementRequest {
                    Carried = StationModulePlacement.ToRecord(underSlab.Candidate),
                    Rotation = 0,
                    TargetModuleId = "hanger-post-1",
                    Hit = FloorHit(tool, 5, 2, 0, rot: 0).Hit,
                });
                Assert.IsTrue(moved.Ok, $"moving {tool} from slab to hanger failed: {moved.Reason}");
                Assert.IsFalse(moved.Candidate.CeilingAnchored, $"moving {tool} slab->hanger must clear CeilingAnchored");
                Assert.AreEqual("hanger-post-1", moved.SupportId);
                Assert.AreEqual(0, moved.Candidate.Z);
            }

            // Light cannot hang on a post hanger without a slab overhead.
            var lightOnHanger = StationModulePlacement.Resolve(read.Index, FloorHit("light-circular", 5, 2, 0, targetModuleId: "hanger-post-1"));
            Assert.IsFalse(lightOnHanger.Ok);
            Assert.AreEqual("ceiling", lightOnHanger.Reason);
        }

        [Test]
        public void WallAimHandlesShiftedLevelBasePlainSideFacesAndFollowsCourseRules() {
            // Shifted levelBase = 2 with floor at z = 2 and untagged plain solid blocks at (3, 2, 3..5).
            var cells = FloorPad(0, 6, 0, 6, 2);
            for (int z = 3; z <= 5; z++) cells.Add(Cell(3, 2, z)); // deliberately untagged (no "wall" tag)
            var read = ReadStation(cells, levelBase: 2);

            // Side hit on untagged plain block resolves anchor floor z = 2 (independent of levelBase).
            var posterAnchor = StationWallAim.StandCell(read.Index, WallHit("billboard", 3, 2, 4, 3, 3).Hit, false, false);
            Assert.AreEqual(3, posterAnchor.X, 1e-6);
            Assert.AreEqual(3, posterAnchor.Y, 1e-6);
            Assert.AreEqual(2, posterAnchor.Z, 1e-6, "plain side face still anchors on exposed floor z=2");

            // Non-floor-standing glass follows aimed course (cz - 1 = 3) even on untagged solid column.
            var glassAnchor = StationWallAim.StandCell(read.Index, WallHit("glass-2x2", 3, 2, 4, 3, 3).Hit, false, true);
            Assert.AreEqual(3, glassAnchor.Z, 1e-6, "followCourse pins glass panel to aimed course on untagged side face");

            // FollowsCourse contract: true only for wall-mounted short glass panels, false for curtains & posters.
            foreach (string shortVariant in new[] { "1x1", "1x2", "2x1", "2x2", "3x1", "3x2" }) {
                var cfg = new ModuleConfig(new Dictionary<string, string> { ["variant"] = shortVariant });
                Assert.IsTrue(StationWallAim.FollowsCourse("glass", cfg), $"glass {shortVariant} follows course");
            }
            foreach (string curtainVariant in new[] { "1x4", "2x4", "3x4", "4x4" }) {
                var cfg = new ModuleConfig(new Dictionary<string, string> { ["variant"] = curtainVariant });
                Assert.IsFalse(StationWallAim.FollowsCourse("glass", cfg), $"curtain {curtainVariant} stands on floor");
            }
            Assert.IsFalse(StationWallAim.FollowsCourse("glass",
                new ModuleConfig(new Dictionary<string, string> { ["variant"] = "2x2", ["curtainHeight"] = "3" })),
                "curtainHeight override makes glass floor-standing");
            foreach (string nonCourse in new[] { "billboard", "calligraphy", "linemap", "sign", "monitor", "exit" }) {
                Assert.IsFalse(StationWallAim.FollowsCourse(nonCourse, ModuleConfig.Empty), $"{nonCourse} does not follow course");
            }
        }

        [Test]
        public void CeilingAimMatrixAcrossFloorsSpansAndLevelBases() {
            int[] floors = { 1, 6, 11, 17 };
            int[] spans = { 3, 7, 12 };
            int[] levelBases = { 0, 2, 4 };

            foreach (int levelBase in levelBases) {
                foreach (int floorZ in floors) {
                    foreach (int span in spans) {
                        int slabZ = floorZ + span;
                        var cells = new[] { Cell(2, 2, floorZ), Cell(2, 2, slabZ) };
                        var read = ReadStation(cells, levelBase: levelBase);

                        Assert.IsTrue(StationCeilingAim.TryTopBlockZ(read.Index, 2, 2, floorZ + 1, out int top),
                            $"floor={floorZ} span={span} base={levelBase}");
                        Assert.AreEqual(slabZ, top, $"top block for floor={floorZ} span={span} base={levelBase}");

                        var fromFloor = StationCeilingAim.Aim(read.Index, FloorHit("light-circular", 2, 2, floorZ), "light-circular");
                        Assert.AreEqual(slabZ - 1, fromFloor.Z, 1e-6,
                            $"from floor: floor={floorZ} span={span} base={levelBase}");

                        var undersideHit = new StationPlacementRequest {
                            ToolType = "light-circular",
                            Hit = new StationPlacementHit(2, 2, slabZ, 2, 2, slabZ - 1, true,
                                new StationPoint(2.5, 2.5, slabZ), slabZ),
                        };
                        var fromUnderside = StationCeilingAim.Aim(read.Index, undersideHit, "light-circular");
                        Assert.AreEqual(slabZ - 1, fromUnderside.Z, 1e-6,
                            $"from underside: floor={floorZ} span={span} base={levelBase}");
                    }
                }
            }
        }

        /* ---------------------------------- 3. Equipment Catalogue, Walk Graph, Glass & Booths */

        [Test]
        public void AllSevenBenchVariantsParseClearanceFloorTrackAndCollisions() {
            var variants = new (string PaletteId, string Variant, int Width)[] {
                ("bench", "steel-1", 1),
                ("bench-steel-1", "steel-1", 1),
                ("bench-steel-2", "steel-2", 2),
                ("bench-seat-1", "seat-1", 1),
                ("bench-seat-2", "seat-2", 2),
                ("bench-wood-1", "wood-1", 1),
                ("bench-wood-2", "wood-2", 2),
                ("bench-office-1", "office-1", 1),
            };
            var floor = FloorPad(0, 10, 0, 10, 0);
            var read = ReadStation(floor);

            foreach (var v in variants) {
                Assert.IsTrue(StationModuleFamilies.TryParse(v.PaletteId, "", 0, out var family), v.PaletteId);
                Assert.AreEqual("bench", family.Type);
                Assert.AreEqual(v.Variant, family.Variant);
                Assert.AreEqual(v.Width, family.Width);

                for (int rot = 0; rot < 4; rot++) {
                    var plan = StationModulePlacement.Resolve(read.Index, FloorHit(v.PaletteId, 5, 5, 0, rot));
                    Assert.IsTrue(plan.Ok, $"{v.PaletteId} rot={rot}: {plan.Reason}");
                    var rec = StationModulePlacement.ToRecord(plan.Candidate);
                    Assert.AreEqual(v.Width, StationFootprints.Footprint(rec).Length);
                    Assert.IsTrue(StationFootprints.TryClearance(rec, out var box, out var err), err);
                    Assert.AreEqual(1.0, box.Height, 1e-6);
                    bool turned = rot % 2 == 1;
                    Assert.AreEqual(turned ? 1.0 : v.Width, box.Width, 1e-6);
                    Assert.AreEqual(turned ? v.Width : 1.0, box.Depth, 1e-6);
                }
            }

            // 2 m bench refuses when second cell sits on a hole or on floor.track, and collides on 2nd cell.
            var withHoleAndTrack = FloorPad(0, 10, 0, 10, 0);
            withHoleAndTrack.RemoveAll(c => (int)c["x"] == 6 && (int)c["y"] == 3);
            withHoleAndTrack.Add(Cell(6, 3, 0, fill: "void"));
            withHoleAndTrack.RemoveAll(c => (int)c["x"] == 6 && (int)c["y"] == 6);
            withHoleAndTrack.Add(Cell(6, 6, 0, finishTop: "floor.track"));
            var existingBench = Module("bench-existing", "bench", 5, 8, 0, rot: 0, w: 2, cfg: new JObject { ["variant"] = "steel-2" });
            var checkRead = ReadStation(withHoleAndTrack, new[] { existingBench });

            var overHole = StationModulePlacement.Resolve(checkRead.Index, FloorHit("bench-steel-2", 5, 3, 0, rot: 0));
            Assert.IsFalse(overHole.Ok);
            Assert.AreEqual("floor", overHole.Reason);

            var overTrack = StationModulePlacement.Resolve(checkRead.Index, FloorHit("bench-steel-2", 5, 6, 0, rot: 0));
            Assert.IsFalse(overTrack.Ok);
            Assert.AreEqual("track", overTrack.Reason);

            var hitSecondCell = StationModulePlacement.Resolve(checkRead.Index, FloorHit("bench-steel-1", 6, 8, 0, rot: 0));
            Assert.IsFalse(hitSecondCell.Ok);
            Assert.AreEqual("occupied", hitSecondCell.Reason);
            CollectionAssert.Contains(hitSecondCell.ColliderIds, "bench-existing");

            var adjacentClear = StationModulePlacement.Resolve(checkRead.Index, FloorHit("bench-steel-1", 7, 8, 0, rot: 0));
            Assert.IsTrue(adjacentClear.Ok, adjacentClear.Reason);
        }

        [Test]
        public void AllTwentyShelfVariantsMatchWidthsHeightsAndRotations() {
            var shelves = new (string Variant, int Width, double Height)[] {
                ("dark-tall", 1, 1.9), ("white-tall", 1, 1.9), ("white-short", 1, 1.25), ("wire", 1, 1.6),
                ("cooler", 1, 2.05), ("cooler-dark", 1, 2.05), ("clothing-rail", 1, 1.65), ("clothing-wall", 1, 1.95),
                ("clothing-table", 1, 1.05), ("clothing-shoes", 1, 1.35), ("food-snacks", 1, 1.65), ("food-bakery", 1, 1.55),
                ("ice-cream", 1, 0.98), ("fruit-island", 1, 1.05), ("fruit-tiered", 1, 1.5),
                ("cafe-backbar", 1, 2.15), ("cafe-backbar-2", 2, 2.15), ("cafe-backbar-4", 4, 2.15),
                ("books", 2, 2.05), ("bags", 2, 2.05),
            };
            var read = ReadStation(FloorPad(0, 12, 0, 12, 0));

            foreach (var s in shelves) {
                Assert.IsTrue(StationModuleFamilies.TryParse("shelf-" + s.Variant, "", 0, out var family), s.Variant);
                Assert.AreEqual("shelf", family.Type);
                Assert.AreEqual(s.Variant, family.Variant);
                Assert.AreEqual(s.Width, StationModuleFamilies.ShelfWidth(s.Variant), s.Variant);

                for (int rot = 0; rot < 4; rot++) {
                    var plan = StationModulePlacement.Resolve(read.Index, FloorHit("shelf-" + s.Variant, 6, 6, 0, rot));
                    Assert.IsTrue(plan.Ok, $"shelf-{s.Variant} rot={rot}: {plan.Reason}");
                    var rec = StationModulePlacement.ToRecord(plan.Candidate);
                    Assert.AreEqual(s.Width, StationFootprints.Footprint(rec).Length, s.Variant);
                    Assert.IsTrue(StationFootprints.TryClearance(rec, out var box, out var err), err);
                    Assert.AreEqual(s.Height, box.Height, 1e-6, $"shelf-{s.Variant} height");
                    bool turned = rot % 2 == 1;
                    Assert.AreEqual(turned ? 1.0 : s.Width, box.Width, 1e-6, $"shelf-{s.Variant} rot={rot} width");
                    Assert.AreEqual(turned ? s.Width : 1.0, box.Depth, 1e-6, $"shelf-{s.Variant} rot={rot} depth");
                }
            }
        }

        [Test]
        public void AllFourCheckoutStylesAcrossLengthsOneToFour() {
            var styles = new (string PaletteId, string Variant, double Height)[] {
                ("checkout", "", StationFootprints.CheckoutHeight),
                ("checkout-generic", "generic", 1.4),
                ("checkout-cafe", "cafe", 1.5),
                ("checkout-cafe-pastry", "cafe-pastry", 1.5),
            };
            var read = ReadStation(FloorPad(0, 12, 0, 12, 0));

            foreach (var style in styles) {
                for (int len = 1; len <= 4; len++) {
                    for (int rot = 0; rot < 4; rot++) {
                        var plan = StationModulePlacement.Resolve(read.Index, FloorHit(style.PaletteId, 6, 6, 0, rot, width: len));
                        Assert.IsTrue(plan.Ok, $"{style.PaletteId} len={len} rot={rot}: {plan.Reason}");
                        Assert.AreEqual("checkout", plan.Candidate.Type);
                        Assert.AreEqual(style.Variant, plan.Candidate.Text("variant"));
                        Assert.AreEqual(len, plan.Candidate.Width);
                        var rec = StationModulePlacement.ToRecord(plan.Candidate);
                        Assert.AreEqual(len, StationFootprints.Footprint(rec).Length);
                        Assert.IsTrue(StationFootprints.TryClearance(rec, out var box, out var err), err);
                        Assert.AreEqual(style.Height, box.Height, 1e-6, $"{style.PaletteId} height");
                        bool turned = rot % 2 == 1;
                        Assert.AreEqual(turned ? 1.0 : len, box.Width, 1e-6);
                        Assert.AreEqual(turned ? len : 1.0, box.Depth, 1e-6);
                    }
                }
            }
            Assert.AreEqual(1, StationFootprints.CounterLength(0));
            Assert.AreEqual(1, StationFootprints.CounterLength(5));
        }

        [Test]
        public void SmallFixturesRestroomElectricalAndOutdoorRefusalsMatchCatalogueSpecs() {
            var cells = FloorPad(0, 12, 0, 12, 0);
            cells.AddRange(FloorPad(0, 12, 0, 12, -5));
            cells.Add(Cell(4, 2, 1, tags: new[] { "wall" }));
            cells.Add(Cell(4, 2, 2, tags: new[] { "wall" }));
            cells.Add(Cell(7, 2, 1, tags: new[] { "wall" })); // only 1 course
            var read = ReadStation(cells);

            void CheckHeight(string tool, double expectedW, double expectedD, double expectedH, int rot = 0) {
                var plan = StationModulePlacement.Resolve(read.Index, FloorHit(tool, 5, 6, 0, rot));
                Assert.IsTrue(plan.Ok, $"{tool} failed: {plan.Reason}");
                var rec = StationModulePlacement.ToRecord(plan.Candidate);
                Assert.IsTrue(StationFootprints.TryClearance(rec, out var box, out var err), err);
                Assert.AreEqual(expectedW, box.Width, 1e-6, $"{tool} width");
                Assert.AreEqual(expectedD, box.Depth, 1e-6, $"{tool} depth");
                Assert.AreEqual(expectedH, box.Height, 1e-6, $"{tool} height");
            }

            CheckHeight("bin", 1, 1, 0.95);
            CheckHeight("desk", 1, 1, 1.22);
            CheckHeight("vending", 1, 1, 1.9);
            CheckHeight("tvm", 1, 1, 1.9);
            CheckHeight("extinguisher-compact", 1, 1, 0.5);
            CheckHeight("extinguisher", 1, 1, 1.1);
            CheckHeight("extinguisher-glass", 2, 1, 2.0, rot: 0);
            CheckHeight("extinguisher-glass", 1, 2, 2.0, rot: 1);
            CheckHeight("cubicle", 1, 1, 1.8);
            CheckHeight("cubicle-toilet", 1, 1, 1.8);
            CheckHeight("sink", 1, 1, 0.9);
            CheckHeight("electrical-cabinet", 3, 1, 2.2, rot: 0);
            CheckHeight("electrical-cabinet", 1, 3, 2.2, rot: 1);
            CheckHeight("ac-unit", 3, 2, 2.7, rot: 0);

            // Urinal requires wall courses [0, 1]: succeeds on 2-course wall, fails on 1-course wall.
            var urinalOk = StationModulePlacement.Resolve(read.Index, WallHit("urinal", 4, 2, 1, 4, 3, rot: 0));
            Assert.IsTrue(urinalOk.Ok, urinalOk.Reason);
            var urinalRec = StationModulePlacement.ToRecord(urinalOk.Candidate);
            Assert.IsTrue(StationFootprints.IsWallMounted(urinalRec));
            CollectionAssert.AreEqual(new[] { 0, 1 }, StationFootprints.WallCourses(urinalRec));
            Assert.IsTrue(StationFootprints.TryClearance(urinalRec, out var urinalBox, out _));
            Assert.AreEqual(1.27, urinalBox.Z0, 1e-6);
            Assert.AreEqual(2.72, urinalBox.Z1, 1e-6);

            var urinalLow = StationModulePlacement.Resolve(read.Index, WallHit("urinal", 7, 2, 1, 7, 3, rot: 0));
            Assert.IsFalse(urinalLow.Ok);
            Assert.AreEqual("wall", urinalLow.Reason, "urinal needs both courses 0 and 1");

            // Traffic-light (not in palette factory, tested via Carried move & clearance) & guidepost underground refusal.
            var guideAbove = StationModulePlacement.Resolve(read.Index, FloorHit("guidepost", 5, 6, 0));
            Assert.IsTrue(guideAbove.Ok, guideAbove.Reason);
            var guideBelow = StationModulePlacement.Resolve(read.Index, FloorHit("guidepost", 5, 6, -5));
            Assert.IsFalse(guideBelow.Ok);
            Assert.AreEqual("outdoor-below-ground", guideBelow.Reason);

            var tlRec = RecordOf("tl-1", "traffic-light", 5, 6, 0);
            Assert.IsTrue(StationFootprints.TryClearance(tlRec, out var tlBox, out _));
            Assert.AreEqual(0.6, tlBox.Width, 1e-6);
            Assert.AreEqual(0.6, tlBox.Depth, 1e-6);
            Assert.AreEqual(3.5, tlBox.Height, 1e-6);
            var tlBelow = StationModulePlacement.Resolve(read.Index, new StationPlacementRequest {
                Carried = tlRec, Rotation = 0, Hit = FloorHit("traffic-light", 5, 6, -5).Hit,
            });
            Assert.IsFalse(tlBelow.Ok);
            Assert.AreEqual("outdoor-below-ground", tlBelow.Reason);
        }

        [Test]
        public void AllSixStandingDoorVariantsAndWalkGraphPassabilityForDoorsFencesAndTrees() {
            var doors = new (string Id, string Variant, int Width)[] {
                ("door-steel-1", "steel-1", 1), ("door-steel-2", "steel-2", 2),
                ("door-wood-1", "wood-1", 1), ("door-wood-2", "wood-2", 2),
                ("door-glass-1", "glass-1", 1), ("door-glass-2", "glass-2", 2),
            };
            var read = ReadStation(FloorPad(0, 8, 0, 8, 0)); // open floor, no walls anywhere

            foreach (var d in doors) {
                var plan = StationModulePlacement.Resolve(read.Index, FloorHit(d.Id, 4, 4, 0, rot: 0));
                Assert.IsTrue(plan.Ok, $"{d.Id} stands on open floor without wall: {plan.Reason}");
                var rec = StationModulePlacement.ToRecord(plan.Candidate);
                Assert.IsFalse(StationFootprints.IsWallMounted(rec), $"{d.Id} is not wall-mounted");
                Assert.IsEmpty(StationFootprints.WallCourses(rec));
                Assert.AreEqual(d.Width, StationFootprints.Footprint(rec).Length);
                Assert.IsTrue(StationFootprints.TryClearance(rec, out var box, out var err), err);
                Assert.AreEqual(1.99, box.Height, 1e-6, $"{d.Id} height is 1.99 m");
            }

            // Walk graph passability: door & tree remain walkable; fence & fence-gate block their cell.
            var sessionDoc = new StationSessionDocument { StationId = "walk-test", LevelBase = 0 };
            for (int x = 0; x < 7; x++)
                for (int y = 0; y < 3; y++)
                    sessionDoc.Cells.Add(new StationCellFact { X = x, Y = y, Z = 0, Solid = true, Zone = 2, Speed = 1.0 });

            sessionDoc.Modules.Add(new StationModuleFact { Id = "door-1", Type = "door", X = 1, Y = 1, Z = 0, Width = 1 });
            sessionDoc.Modules.Add(new StationModuleFact { Id = "tree-1", Type = "tree", X = 2, Y = 1, Z = 0, Width = 1 });
            sessionDoc.Modules.Add(new StationModuleFact { Id = "fence-1", Type = "fence", Variant = "glass", X = 4, Y = 1, Z = 0, Width = 1 });
            sessionDoc.Modules.Add(new StationModuleFact { Id = "fence-gate-1", Type = "fence", Variant = "gate", X = 5, Y = 1, Z = 0, Width = 1 });

            var graph = StationWalkGraphBuilder.Build(sessionDoc, new StationWalkGraphOptions { IncludeGround = false });
            Assert.IsTrue(graph.NodeIndex.ContainsKey(StationWalkGraph.CellKey(1, 1, 0)), "door cell stays walkable");
            Assert.IsTrue(graph.NodeIndex.ContainsKey(StationWalkGraph.CellKey(2, 1, 0)), "tree cell stays walkable");
            Assert.IsFalse(graph.NodeIndex.ContainsKey(StationWalkGraph.CellKey(4, 1, 0)), "fence blocks walk graph");
            Assert.IsFalse(graph.NodeIndex.ContainsKey(StationWalkGraph.CellKey(5, 1, 0)), "fence-gate blocks walk graph");
        }

        [Test]
        public void FloorStickersShareCellWithFenceGateAndPlatformEdge() {
            var cells = FloorPad(0, 10, 0, 10, 0);
            var fenceGate = Module("fg-1", "fence", 2, 2, 0, cfg: new JObject { ["variant"] = "gate" });
            var glassFence = Module("f-1", "fence", 5, 2, 0, cfg: new JObject { ["variant"] = "glass" });
            var psd = Module("psd-1", "platform-edge", 2, 5, 0, rot: 0, w: 4, cfg: new JObject { ["psd"] = "full", ["line"] = "1" });
            var read = ReadStation(cells, new[] { fenceGate, glassFence, psd });

            foreach (string sticker in new[] { "tactile-guide", "tactile-warning", "floor-mark-boarding", "floor-mark-waiting", "floor-mark-direction" }) {
                var onGate = StationModulePlacement.Resolve(read.Index, FloorHit(sticker, 2, 2, 0));
                Assert.IsTrue(onGate.Ok, $"{sticker} should share cell with fence-gate: {onGate.Reason}");
                Assert.IsEmpty(onGate.ColliderIds);

                var onPsd = StationModulePlacement.Resolve(read.Index, FloorHit(sticker, 2, 5, 0));
                Assert.IsTrue(onPsd.Ok, $"{sticker} should share cell with platform-edge: {onPsd.Reason}");
                Assert.IsEmpty(onPsd.ColliderIds);

                var onGlassFence = StationModulePlacement.Resolve(read.Index, FloorHit(sticker, 5, 2, 0));
                Assert.IsFalse(onGlassFence.Ok, $"{sticker} must collide with solid glass fence");
                Assert.AreEqual("occupied", onGlassFence.Reason);
            }

            // Reverse order: placing fence-gate over existing tactile/floor-mark also succeeds.
            var existingStickers = ReadStation(cells, new[] {
                Module("tac-1", "tactile", 2, 2, 0, cfg: new JObject { ["variant"] = "warning" }),
                Module("fm-1", "floor-mark", 4, 2, 0, cfg: new JObject { ["variant"] = "boarding" }),
            });
            Assert.IsTrue(StationModulePlacement.Resolve(existingStickers.Index, FloorHit("fence-gate", 2, 2, 0)).Ok);
            Assert.IsTrue(StationModulePlacement.Resolve(existingStickers.Index, FloorHit("fence-gate", 4, 2, 0)).Ok);
        }

        [Test]
        public void EdgeDecorCurtainShareShiftAndPerpendicularGlassCrossTile() {
            var cells = FloorPad(0, 10, 0, 10, 0);
            var curtain = Module("curtain-1", "glass", 3, 3, 0, rot: 0, w: 3, cfg: new JObject { ["variant"] = "3x4" });
            var read = ReadStation(cells, new[] { curtain });
            var curtainRec = read.Index.GetModule("curtain-1");

            // Opposite rotation (rot = 2 vs curtain rot = 0 => opposite WallSides) allows all 5 edge-decor families
            // and shifts their resolved world position by +0.15 m along WallSide(decor.Rotation).
            foreach (string tool in new[] { "bin", "extinguisher", "shelf-dark-tall", "tvm", "vending" }) {
                var plan = StationModulePlacement.Resolve(read.Index, FloorHit(tool, 4, 3, 0, rot: 2));
                Assert.IsTrue(plan.Ok, $"{tool} backed against curtain failed: {plan.Reason}");
                Assert.IsEmpty(plan.ColliderIds);

                var decorRec = StationModulePlacement.ToRecord(plan.Candidate);
                Assert.IsTrue(StationModulePlacement.EdgeDecorGlassShare(decorRec, curtainRec));

                // Measure +0.15 m shift via ModulePlacement.Resolve with vs without the curtain.
                var bareRead = ReadStation(cells);
                var entry = new RuntimeCatalogue.Entry { offset = new Vector3(0.5f, 0.5f, 1f) };
                var posWithCurtain = ModulePlacement.Resolve(decorRec, entry, read.Index);
                var posAlone = ModulePlacement.Resolve(decorRec, entry, bareRead.Index);
                StationFootprints.WallSide(decorRec.Rotation, out int sx, out int sy);
                var expectedShift = new Vector3(sx * 0.15f, 0f, sy * 0.15f);
                var delta = posWithCurtain - posAlone;
                Assert.AreEqual(expectedShift.x, delta.x, 1e-5f, $"{tool} curtain shift x");
                Assert.AreEqual(expectedShift.y, delta.y, 1e-5f, $"{tool} curtain shift y");
                Assert.AreEqual(expectedShift.z, delta.z, 1e-5f, $"{tool} curtain shift z");

                // Same rotation as curtain (not opposite WallSide) does NOT trigger share.
                var sameRotRec = RecordOf(tool + "-same", decorRec.Type, 4, 3, 0, rot: 0);
                Assert.IsFalse(StationModulePlacement.EdgeDecorGlassShare(sameRotRec, curtainRec));
            }

            // GlassCrossTile: perpendicular curtain (rot = 1) crossing curtain-1 at (4, 3) succeeds;
            // same rotation (rot = 0) on the same tile collides.
            var crossPlan = StationModulePlacement.Resolve(read.Index, FloorHit("curtain-wall", 4, 3, 0, rot: 1, width: 3));
            Assert.IsTrue(crossPlan.Ok, "perpendicular floor curtains cross cleanly: " + crossPlan.Reason);
            Assert.IsEmpty(crossPlan.ColliderIds);

            var parallelOverlap = StationModulePlacement.Resolve(read.Index, FloorHit("curtain-wall", 4, 3, 0, rot: 0, width: 1));
            Assert.IsFalse(parallelOverlap.Ok, "same-rotation curtain on same tile collides");
            Assert.AreEqual("occupied", parallelOverlap.Reason);
        }

        [Test]
        public void OutdoorSurfacePlannerRefusesUndergroundRampOpeningSolidAboveTrackAndNoFloor() {
            var cells = FloorPad(0, 10, 0, 10, 0);
            cells.Add(Cell(3, 3, 1)); // solid block above (3, 3, 0)
            var track = Module("track-1", "track", 5, 5, 0, rot: 0, w: 3, d: 3, cfg: new JObject { ["line"] = "1" });
            var existingSidewalk = Module("sidewalk-1", "sidewalk", 1, 8, 0);
            var read = ReadStation(cells, new[] { track, existingSidewalk });
            var reservations = new FixedReservations(new StationCellKey(2, 2, 0));
            var world = StationCellEditWorld.Build(read.Index, reservations);

            var underground = StationSurfacePlanner.Plan(read.Index, world, new[] { new StationCellKey(1, 1, -5) }, "sidewalk", 0, false);
            Assert.AreEqual("outdoor-below-ground", underground.Reason);
            Assert.AreEqual(1, underground.Refused.Count);

            var onOpening = StationSurfacePlanner.Plan(read.Index, world, new[] { new StationCellKey(2, 2, 0) }, "sidewalk", 0, false);
            Assert.AreEqual("opening", onOpening.Reason);

            var solidAbove = StationSurfacePlanner.Plan(read.Index, world, new[] { new StationCellKey(3, 3, 0) }, "lawn", 0, false);
            Assert.AreEqual("occupied", solidAbove.Reason);

            var onTrack = StationSurfacePlanner.Plan(read.Index, world, new[] { new StationCellKey(6, 6, 0) }, "sidewalk", 0, false);
            Assert.AreEqual("track", onTrack.Reason);

            var noFloor = StationSurfacePlanner.Plan(read.Index, world, new[] { new StationCellKey(1, 1, 5) }, "lawn", 0, false);
            Assert.AreEqual("floor", noFloor.Reason);

            // Replacement: lawn over existing sidewalk replaces it; sidewalk over sidewalk is skipped.
            var replace = StationSurfacePlanner.Plan(read.Index, world, new[] { new StationCellKey(1, 8, 0) }, "lawn", 0, false);
            Assert.AreEqual("", replace.Reason);
            Assert.AreEqual(1, replace.Adds.Count);
            CollectionAssert.AreEqual(new[] { "sidewalk-1" }, replace.RemoveModuleIds);

            var sameKind = StationSurfacePlanner.Plan(read.Index, world, new[] { new StationCellKey(1, 8, 0) }, "sidewalk", 0, false);
            Assert.AreEqual(1, sameKind.Skipped.Count);
            Assert.IsFalse(sameKind.HasWork);
        }

        [Test]
        public void BadmintonCourtAllowsBackcourtDividerAndProtectsCentreNet() {
            var cells = FloorPad(0, 20, 0, 20, 0);
            // rot=0 badminton court at (2, 2): X in [2, 16), Y in [2, 9), centre net at X = 9.0 ([8.8, 9.2]).
            var courtH = Module("court-h", "court", 2, 2, 0, rot: 0, cfg: new JObject { ["variant"] = "badminton" });
            var readH = ReadStation(cells, new[] { courtH });
            Assert.IsTrue(StationFootprints.TryClearance(readH.Index.GetModule("court-h"), out var boxH, out _));
            Assert.AreEqual(14.0, boxH.Width, 1e-6);
            Assert.AreEqual(7.0, boxH.Depth, 1e-6);
            Assert.AreEqual(1.6, boxH.Height, 1e-6, "badminton net height is 1.6 m");

            var backcourt = StationModulePlacement.Resolve(readH.Index, FloorHit("court-divider", 4, 4, 0, rot: 0));
            Assert.IsTrue(backcourt.Ok, "divider on backcourt clears badminton net: " + backcourt.Reason);

            var onNet = StationModulePlacement.Resolve(readH.Index, FloorHit("court-divider", 8, 4, 0, rot: 0));
            Assert.IsFalse(onNet.Ok, "divider crossing centre net must collide");
            Assert.AreEqual("occupied", onNet.Reason);
            CollectionAssert.Contains(onNet.ColliderIds, "court-h");

            // Rotated 90° (rot=1) at (10, 2): X in [4, 11), Y in [2, 16), centre net along Y = 9.0.
            var courtV = Module("court-v", "court", 10, 2, 0, rot: 1, cfg: new JObject { ["variant"] = "badminton" });
            var readV = ReadStation(cells, new[] { courtV });
            Assert.IsTrue(StationModulePlacement.Resolve(readV.Index, FloorHit("court-divider", 6, 4, 0, rot: 1)).Ok);
            var onNetV = StationModulePlacement.Resolve(readV.Index, FloorHit("court-divider", 6, 8, 0, rot: 1));
            Assert.IsFalse(onNetV.Ok);
            Assert.AreEqual("occupied", onNetV.Reason);
        }

        [Test]
        public void TicketBoothDrawsGlazingServiceApertureAndFacesSelectedFront() {
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");
            Assert.IsNotNull(shader, "station shader missing");
            var materials = new StationMaterials(shader);
            var root = new GameObject("booth-parity-probe");
            try {
                // Ticket booth has glazing and leaves an open transfer aperture on front (z = 2.12 in document axes).
                var ticketFacts = ModuleFactsReader.Read(Module("booth-t", "booth", 0, 0, 0, w: 4, h: 3,
                    cfg: new JObject { ["kind"] = "ticket", ["front"] = 0 }));
                Assert.IsTrue(BoothModuleViews.TryBuild(ticketFacts, root.transform, materials, out var ticketView, out var ticketNote), ticketNote);
                var glassMat = materials[StationMaterials.Glass];
                var ticketGlassRenderers = ticketView.GetComponentsInChildren<MeshRenderer>(true)
                    .Where(r => r.sharedMaterial == glassMat).ToList();
                Assert.Greater(ticketGlassRenderers.Count, 0, "ticket booth builds glazing");

                // Measure all glass vertices on the front face (y < 0.2 in document axes):
                // glazing starts above sill (floor top 1.0 + counter 1.04 + 0.16 aperture = 2.20 m),
                // leaving [2.04, 2.20) clear as the transfer aperture.
                float minFrontGlassZ = float.MaxValue;
                foreach (var renderer in ticketGlassRenderers) {
                    var mesh = renderer.GetComponent<MeshFilter>().sharedMesh;
                    foreach (var v in mesh.vertices) {
                        var doc = StationCoordinates.WorldToDocument(renderer.transform.TransformPoint(v));
                        if (doc.y < 0.2f && doc.x > 0.2f && doc.x < 3.8f) minFrontGlassZ = Mathf.Min(minFrontGlassZ, doc.z);
                    }
                }
                Assert.Greater(minFrontGlassZ, 2.15f, "front glazing leaves open transfer aperture above countertop (2.04 m)");
                Assert.Less(minFrontGlassZ, 3.0f, "front glazing vertices were measured");

                // Info booth has NO glazing.
                var infoFacts = ModuleFactsReader.Read(Module("booth-i", "booth", 0, 0, 0, w: 4, h: 3,
                    cfg: new JObject { ["kind"] = "info", ["front"] = 0 }));
                Assert.IsTrue(BoothModuleViews.TryBuild(infoFacts, root.transform, materials, out var infoView, out _));
                Assert.AreEqual(0, infoView.GetComponentsInChildren<MeshRenderer>(true)
                    .Count(r => r.sharedMaterial == glassMat), "info counter has no enclosing glazing");

                // Counter screens face the selected cfg.front edge across all 4 orientations.
                var lineMat = materials[StationMaterials.Line];
                for (int front = 0; front < 4; front++) {
                    var facts = ModuleFactsReader.Read(Module("booth-f" + front, "booth", 10, 20, 0, w: 5, h: 4,
                        cfg: new JObject { ["kind"] = "ticket", ["front"] = front }));
                    Assert.IsTrue(BoothModuleViews.TryBuild(facts, root.transform, materials, out var view, out _));
                    var screenRenderer = view.GetComponentsInChildren<MeshRenderer>(true)
                        .FirstOrDefault(r => r.sharedMaterial == lineMat);
                    Assert.IsNotNull(screenRenderer, $"front={front} has counter screens");
                    var screenMesh = screenRenderer.GetComponent<MeshFilter>().sharedMesh;
                    Assert.Greater(screenMesh.vertexCount, 0, $"front={front} screen mesh has vertices");
                    var sum = Vector3.zero;
                    foreach (var v in screenMesh.vertices)
                        sum += StationCoordinates.WorldToDocument(screenRenderer.transform.TransformPoint(v));
                    var doc = sum / screenMesh.vertexCount;
                    float edgeDist = front == 0 ? Mathf.Abs(doc.y - 20f)
                        : front == 1 ? Mathf.Abs(doc.x - 15f)
                        : front == 2 ? Mathf.Abs(doc.y - 24f)
                        : Mathf.Abs(doc.x - 10f);
                    Assert.Less(edgeDist, 0.7f, $"front={front} counter screens face the selected edge (doc={doc}, dist={edgeDist})");
                }
            } finally {
                var sharedCube = BoothModuleViews.Cube();
                var destroyedMeshes = new HashSet<Mesh>();
                foreach (var filter in root.GetComponentsInChildren<MeshFilter>(true)) {
                    var mesh = filter.sharedMesh;
                    if (mesh != null && mesh != sharedCube && destroyedMeshes.Add(mesh))
                        UnityEngine.Object.DestroyImmediate(mesh);
                }
                UnityEngine.Object.DestroyImmediate(root);
                for (int i = 0; i < StationMaterials.Colours.Length; i++) {
                    if (materials[i] != null) UnityEngine.Object.DestroyImmediate(materials[i]);
                }
            }
        }

        /* ---------------------------------- 4. TV Display, City Styles & Validation */

        [Test]
        public void TvSchedulePinsSixSecondArrivingBoundaryZeroLineFallbackAndMultiFloor3dNearestTrack() {
            StationTvSchedule.Reset();
            var lines = new[] {
                Line("1", "1号线", "#f3d03e", "广州东站", "西塱"),
                Line("2", "2号线", "#00629b", "嘉禾望岗", "广州南站"),
            };
            var tracks = new[] {
                Module("track-upper", "track", 0, 0, -10, rot: 0, w: 60, d: 3, cfg: new JObject { ["line"] = "1", ["dir"] = "up" }),
                Module("track-lower", "track", 0, 0, -20, rot: 0, w: 60, d: 3, cfg: new JObject { ["line"] = "2", ["dir"] = "down" }),
            };
            var twoFloorDoc = ReadStation(Array.Empty<JObject>(), tracks, lines).Document;
            var anchors = StationTvSchedule.Anchors(twoFloorDoc);
            Assert.IsTrue(anchors.ContainsKey("track-upper"));
            Assert.IsTrue(anchors.ContainsKey("track-lower"));

            var clock = new StationClockFrame { Clock = "08:15", DateKey = "2026-05-01", TimeOfDaySeconds = 8 * 3600 + 15 * 60 };
            var words = StationDisplayWords.For("zh-CN");

            // Exact 6.0 s arriving boundary: 6.0 s is arriving; 6.01 s and 60 s are 1 min; 61 s is 2 min.
            var boundaryFrame = new StationMotionFrame {
                Clock = clock,
                Trains = new[] {
                    new StationTrainFrame {
                        Id = "1|track-upper", LineId = "1", TrackId = "track-upper", Phase = TrainPhase.Approach,
                        ArrivalSeconds = new[] { 6.0, 6.01, 60.0 }, ArrivalAtPlatform = new[] { false, false, false },
                    },
                },
            };
            var sampleUpper = new Vector3(30f, 1.5f, -9f);
            var boundary = StationTvSchedule.Select(twoFloorDoc, boundaryFrame, true, sampleUpper);
            Assert.IsTrue(boundary.Arrivals[0].Arriving, "6.0 s is inside arriving threshold");
            Assert.AreEqual(words.Arriving, words.StatusText(boundary.Arrivals[0]));
            Assert.IsFalse(boundary.Arrivals[1].Arriving, "6.01 s is past arriving threshold");
            Assert.AreEqual(1, boundary.Arrivals[1].Minutes);
            Assert.AreEqual("1 分钟", words.StatusText(boundary.Arrivals[1]));
            Assert.AreEqual(1, boundary.Arrivals[2].Minutes);
            Assert.AreEqual("1 分钟", words.StatusText(boundary.Arrivals[2]));

            var minuteRollFrame = new StationMotionFrame {
                Clock = clock,
                Trains = new[] {
                    new StationTrainFrame {
                        Id = "1|track-upper", LineId = "1", TrackId = "track-upper", Phase = TrainPhase.Approach,
                        ArrivalSeconds = new[] { 61.0 }, ArrivalAtPlatform = new[] { false },
                    },
                },
            };
            var roll = StationTvSchedule.Select(twoFloorDoc, minuteRollFrame, true, sampleUpper);
            Assert.AreEqual(2, roll.Arrivals[0].Minutes, "61.0 s rounds up to 2 minutes");
            Assert.AreEqual("2 分钟", words.StatusText(roll.Arrivals[0]));

            // Multi-floor 3D nearest track: same plan (30, 1.5), z=-9 selects track-upper, z=-19 selects track-lower.
            var multiFrame = new StationMotionFrame {
                Clock = clock,
                Trains = new[] {
                    new StationTrainFrame {
                        Id = "1|track-upper", LineId = "1", TrackId = "track-upper", Phase = TrainPhase.Approach,
                        ArrivalSeconds = new[] { 120.0 }, ArrivalAtPlatform = new[] { false },
                    },
                    new StationTrainFrame {
                        Id = "2|track-lower", LineId = "2", TrackId = "track-lower", Phase = TrainPhase.Approach,
                        ArrivalSeconds = new[] { 240.0 }, ArrivalAtPlatform = new[] { false },
                    },
                },
            };
            var upperPick = StationTvSchedule.Select(twoFloorDoc, multiFrame, true, new Vector3(30f, 1.5f, -9f));
            Assert.AreEqual("track-upper", upperPick.TrackId);
            Assert.AreEqual("1", upperPick.LineId);
            Assert.AreEqual("广州东站", upperPick.Terminus);

            var lowerPick = StationTvSchedule.Select(twoFloorDoc, multiFrame, true, new Vector3(30f, 1.5f, -19f));
            Assert.AreEqual("track-lower", lowerPick.TrackId);
            Assert.AreEqual("2", lowerPick.LineId);
            Assert.AreEqual("广州南站", lowerPick.Terminus);

            // Genuinely 0-line document reports HasLine == false and maps to 暂无线路.
            var zeroLineDoc = ReadStation(FloorPad(0, 2, 0, 2, 0), Array.Empty<JObject>(), Array.Empty<JObject>()).Document;
            Assert.AreEqual(0, zeroLineDoc.LineCount);
            var noLineStatus = StationTvSchedule.Select(zeroLineDoc, default, false, Vector3.zero);
            Assert.IsFalse(noLineStatus.HasLine);
            Assert.AreEqual("no-lines", noLineStatus.Note);
            Assert.AreEqual(0, noLineStatus.ArrivalCount);
            var noLinePlate = StationTvPlatePainter.Describe(zeroLineDoc, default, false, Vector3.zero, "zh-CN");
            Assert.IsFalse(noLinePlate.HasLine);
            Assert.AreEqual("暂无线路", StationDisplayWords.For("zh-CN").NoLines);
            Assert.AreEqual("No lines yet", StationDisplayWords.For("en").NoLines);
            StationTvSchedule.Reset();
        }

        [Test]
        public void CityStylesPinDoorwayEntranceHexAndLineMapSlugsForAllEightCities() {
            var method = typeof(StationStreetModuleRenderer).GetMethod("DoorwayEntranceHex",
                BindingFlags.Static | BindingFlags.NonPublic);
            Assert.IsNotNull(method, "StationStreetModuleRenderer.DoorwayEntranceHex exists");

            var cities = new (string City, string Hex, string Slug, bool Contain)[] {
                ("guangzhou", "#c22f28", "network-map", false),
                ("shenzhen", "#101b2b", "shenzhen-map", false),
                ("shanghai", "#353b35", "shanghai-map", true),
                ("beijing", "#073563", "beijing-map", true),
                ("chengdu", "#343433", "chengdu-map", true),
                ("chongqing", "#f2f0dd", "chongqing-map", true),
                ("wuhan", "#183b70", "wuhan-map", true),
                ("nanjing", "#14213f", "nanjing-map", true),
            };

            foreach (var c in cities) {
                Assert.AreEqual(c.Hex, (string)method.Invoke(null, new object[] { c.City }), $"entrance hex for {c.City}");
                Assert.AreEqual(c.Slug, StationLineMapArtwork.SlugOf(c.City), $"line map slug for {c.City}");
                Assert.AreEqual(c.Contain, StationLineMapArtwork.Contain(c.Slug), $"line map fit for {c.City}");
                var read = ReadStation(FloorPad(0, 1, 0, 1, 0), city: c.City);
                Assert.AreEqual(c.City, read.Document.City, $"save reader keeps city {c.City}");
            }
            Assert.AreEqual("#c22f28", (string)method.Invoke(null, new object[] { "unknown-city" }), "unknown city falls back to guangzhou");
            Assert.AreEqual("guangzhou", ReadStation(FloorPad(0, 1, 0, 1, 0), city: "atlantis").Document.City);
        }

        [Test]
        public void NextExitLetterNextIdAndPlacementRefusalCodesCoverEdgeCases() {
            // NextExitLetter: A when empty, reuses deleted gap (B), returns "" once A..Z are all occupied.
            var empty = ReadStation(FloorPad(0, 4, 0, 4, 0));
            Assert.AreEqual("A", StationModuleFamilies.NextExitLetter(empty.Index));

            var withAC = ReadStation(FloorPad(0, 4, 0, 4, 0), new[] {
                Module("e1", "exit", 0, 0, 0, cfg: new JObject { ["name"] = "A" }),
                Module("e2", "exit", 2, 0, 0, cfg: new JObject { ["name"] = "C口" }),
            });
            Assert.AreEqual("B", StationModuleFamilies.NextExitLetter(withAC.Index), "reuses freed B");

            var all26 = new List<JObject>();
            for (int i = 0; i < 26; i++)
                all26.Add(Module("e-" + i, "exit", i, 0, 0, cfg: new JObject { ["name"] = ((char)('A' + i)).ToString() }));
            var fullExits = ReadStation(FloorPad(0, 4, 0, 4, 0), all26);
            Assert.AreEqual("", StationModuleFamilies.NextExitLetter(fullExits.Index), ">26 exits falls back to empty string");

            // NextId skips an id that collides after an earlier module was deleted.
            var afterDelete = ReadStation(FloorPad(0, 4, 0, 4, 0), new[] {
                Module("bench-1", "bench", 0, 0, 0),
                Module("bench-3", "bench", 1, 0, 0), // ModuleCount=2 => starts at bench-3, must skip to bench-4
            });
            Assert.AreEqual("bench-4", StationModulePlacement.NextId(afterDelete.Index, "bench"));

            // Placement refusal codes: floor, occupied+blocker, ceiling, wall, lift-footprint, track.
            var cells = FloorPad(0, 10, 0, 10, 0);
            cells.RemoveAll(c => (int)c["x"] == 2 && (int)c["y"] == 2);
            cells.Add(Cell(2, 2, 0, fill: "void"));
            cells.RemoveAll(c => (int)c["x"] == 8 && (int)c["y"] == 8);
            cells.Add(Cell(8, 8, 0, finishTop: "floor.track"));
            var blocker = Module("tvm-blocker", "tvm", 5, 5, 0);
            var read = ReadStation(cells, new[] { blocker });

            var floorPlan = StationModulePlacement.Resolve(read.Index, FloorHit("bench-steel-1", 2, 2, 0));
            Assert.AreEqual("floor", floorPlan.Reason);

            var occPlan = StationModulePlacement.Resolve(read.Index, FloorHit("bench-steel-1", 5, 5, 0));
            Assert.AreEqual("occupied", occPlan.Reason);
            CollectionAssert.Contains(occPlan.ColliderIds, "tvm-blocker");

            var ceilPlan = StationModulePlacement.Resolve(read.Index, FloorHit("tv", 5, 2, 0));
            Assert.AreEqual("ceiling", ceilPlan.Reason);

            var wallPlan = StationModulePlacement.Resolve(read.Index, FloorHit("billboard", 5, 2, 0));
            Assert.AreEqual("wall", wallPlan.Reason);

            var liftSmall = StationModulePlacement.Resolve(read.Index, FloorHit("lift", 1, 1, 0));
            Assert.AreEqual("lift-footprint", liftSmall.Reason);

            var liftLargeReq = FloorHit("lift", 0, 0, 0);
            liftLargeReq.LiftSizeLarge = true; // 3x3 covers (0..2, 0..2), hitting void at (2, 2)
            var liftLarge = StationModulePlacement.Resolve(read.Index, liftLargeReq);
            Assert.AreEqual("lift-footprint", liftLarge.Reason);

            var trackPlan = StationModulePlacement.Resolve(read.Index, FloorHit("bench-steel-1", 8, 8, 0));
            Assert.AreEqual("track", trackPlan.Reason);
        }

        [Test]
        public void WallCoursesHalfOpenEdgeCasesAndGridRepairFractionalZRules() {
            // Half-open [c, c+1) boundary edge cases.
            CollectionAssert.AreEqual(new[] { 0 }, StationFootprints.Courses(0, 1));
            CollectionAssert.AreEqual(new[] { 0, 1 }, StationFootprints.Courses(0, 2));
            CollectionAssert.AreEqual(new[] { 1 }, StationFootprints.Courses(1.0, 1.0));
            CollectionAssert.AreEqual(new[] { 1, 2 }, StationFootprints.Courses(1.2, 1.0));
            CollectionAssert.AreEqual(new[] { 1 }, StationFootprints.Courses(1.45, 0.4));
            CollectionAssert.AreEqual(new[] { 0, 1, 2 }, StationFootprints.Courses(0.4, 2.6));
            CollectionAssert.AreEqual(new[] { 1, 2 }, StationFootprints.Courses(1.01, 1.9));

            // GridRepair rejects fractional Z for non-wall-artwork and keeps it for wall-mounted artwork.
            JObject ModZ(string type, double z, JObject cfg = null) => new JObject {
                ["id"] = type + "-z", ["type"] = type, ["x"] = 1, ["y"] = 2, ["z"] = z, ["rot"] = 0,
                ["cfg"] = cfg ?? new JObject(),
            };

            Assert.IsFalse(StationGridRepair.KeepsModule(ModZ("bench", 0.5)), "bench cannot have fractional Z");
            Assert.IsFalse(StationGridRepair.KeepsModule(ModZ("sign", 0.5, new JObject { ["mount"] = "ceiling" })),
                "ceiling sign cannot have fractional Z");
            Assert.IsFalse(StationGridRepair.KeepsModule(ModZ("linemap", 0.5, new JObject { ["mount"] = "stand" })),
                "standing linemap cannot have fractional Z");
            Assert.IsFalse(StationGridRepair.KeepsModule(ModZ("monitor", 0.5, new JObject { ["mount"] = "ceiling" })),
                "ceiling monitor cannot have fractional Z");
            Assert.IsFalse(StationGridRepair.KeepsModule(ModZ("glass", 0.5, new JObject { ["variant"] = "2x4" })),
                "curtain-wall glass cannot have fractional Z");
            Assert.IsFalse(StationGridRepair.KeepsModule(ModZ("glass", 0.5, new JObject { ["variant"] = "2x2", ["curtainHeight"] = 3 })),
                "curtainHeight glass cannot have fractional Z");

            Assert.IsTrue(StationGridRepair.KeepsModule(ModZ("billboard", 0.5)));
            Assert.IsTrue(StationGridRepair.KeepsModule(ModZ("calligraphy", 0.5)));
            Assert.IsTrue(StationGridRepair.KeepsModule(ModZ("sign", 0.5, new JObject { ["mount"] = "wall" })));
            Assert.IsTrue(StationGridRepair.KeepsModule(ModZ("linemap", 0.5, new JObject { ["mount"] = "wall" })));
            Assert.IsTrue(StationGridRepair.KeepsModule(ModZ("monitor", 0.5, new JObject { ["mount"] = "wall" })));
            Assert.IsTrue(StationGridRepair.KeepsModule(ModZ("glass", 0.5, new JObject { ["variant"] = "2x2" })));
        }
    }
}
