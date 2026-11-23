using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Domain D2 parity tests closing web suites:
    /// <c>slope-cut.test.mjs</c>, <c>ramp-block-placement.test.mjs</c>, <c>ramp-fill.test.mjs</c>,
    /// <c>ramp-surface.test.mjs</c>, and <c>openings.test.mjs</c>.
    /// </summary>
    public sealed class StationRampSlopeAndBlockTests {
        const double EscalatorBand = StationRunGeometry.EscalatorBand; // 0.68
        const double StairWidthDouble = 2.0 * EscalatorBand;          // 1.36
        const double StairWidthTriple = 3.0 * EscalatorBand;          // 2.04

        static JObject BaseSave(JArray cells = null, JArray modules = null) => new JObject {
            ["format"] = "metro-save",
            ["formatVersion"] = 1,
            ["gameVersion"] = "0.2.0",
            ["savedAt"] = "2026-01-01T00:00:00.000Z",
            ["name"] = "Ramp slope fixture",
            ["nameEn"] = "",
            ["city"] = "guangzhou",
            ["seed"] = 1234567,
            ["levelBase"] = 0,
            ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = cells ?? new JArray(),
                ["modules"] = modules ?? new JArray(),
                ["lines"] = new JArray(),
            },
        };

        static StationReadResult ReadSave(JObject save) {
            var read = StationDocumentReader.Read(save.ToString(Formatting.None), StationSource.None);
            Assert.IsNotNull(read.Document, "Failed to read fixture save");
            return read;
        }

        static JObject EscalatorJson(string id = "e1", int fx = 6, int fy = 0, int fz = 0, int tx = 0, int ty = 0, int tz = 4, int width = 1, string dir = "up") =>
            new JObject {
                ["id"] = id,
                ["type"] = "escalator",
                ["x"] = fx,
                ["y"] = fy,
                ["z"] = fz,
                ["rot"] = 0,
                ["from"] = new JObject { ["x"] = fx, ["y"] = fy, ["z"] = fz },
                ["to"] = new JObject { ["x"] = tx, ["y"] = ty, ["z"] = tz },
                ["cfg"] = new JObject { ["dir"] = dir, ["width"] = width },
            };

        static JObject StairJson(string id = "s1", int fx = 6, int fy = 0, int fz = 0, int tx = 0, int ty = 0, int tz = 4,
            double width = 0.68, string style = "straight", int rot = 3, string finish = null, JArray flights = null, bool block = false) {
            var cfg = new JObject {
                ["width"] = width,
                ["style"] = style,
                ["flights"] = flights ?? new JArray {
                    new JObject {
                        ["from"] = new JObject { ["x"] = fx, ["y"] = fy, ["z"] = fz },
                        ["to"] = new JObject { ["x"] = tx, ["y"] = ty, ["z"] = tz },
                    },
                },
            };
            if (!string.IsNullOrEmpty(finish)) cfg["finish"] = finish;
            if (block) cfg["block"] = true;
            return new JObject {
                ["id"] = id,
                ["type"] = "stair",
                ["x"] = fx,
                ["y"] = fy,
                ["z"] = fz,
                ["rot"] = rot,
                ["from"] = new JObject { ["x"] = fx, ["y"] = fy, ["z"] = fz },
                ["to"] = new JObject { ["x"] = tx, ["y"] = ty, ["z"] = tz },
                ["cfg"] = cfg,
            };
        }

        static JObject CellJson(int x, int y, int z, string fill = "solid", string[] tags = null, JObject finish = null, string zone = null) {
            var obj = new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = fill };
            if (tags != null && tags.Length > 0) obj["tags"] = new JArray(tags);
            if (finish != null) obj["finish"] = finish;
            if (!string.IsNullOrEmpty(zone)) obj["zone"] = zone;
            return obj;
        }

        static double WalkingLine(ModuleFacts run, double x, double y) {
            double ax = run.From.X + 0.5, ay = run.From.Y + 0.5, az = run.From.Z + 1.0;
            double dx = run.To.X + 0.5 - ax, dy = run.To.Y + 0.5 - ay;
            double t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
            return az + (run.To.Z + 1.0 - az) * t;
        }

        static double BodyLine(ModuleFacts run, double x, double y) {
            double ax = run.From.X + 0.5, ay = run.From.Y + 0.5, az = run.From.Z + 1.0;
            double dx = run.To.X + 0.5 - ax, dy = run.To.Y + 0.5 - ay;
            double len = Math.Sqrt(dx * dx + dy * dy);
            double trim = StationRunGeometry.StairTreadTrim(len);
            double u = ((x - ax) * dx + (y - ay) * dy) / len;
            return az + (run.To.Z + 1.0 - az) * ((u - trim) / (len - trim * 2.0));
        }

        static double EvalCutCap(StationSlopeCut cut, double x, double y) {
            double minH = 1.0;
            var patches = cut.PatchList;
            for (int i = 0; i < patches.Count; i++) {
                var p = patches[i];
                if (x < p.X0 - 1e-9 || x > p.X1 + 1e-9 || y < p.Y0 - 1e-9 || y > p.Y1 + 1e-9) continue;
                double raw = p.Lo + (p.Hi - p.Lo) * (p.Axis == 'x' ? x : y);
                double clamped = p.HasBase ? Math.Max(p.Base, raw) : raw;
                double h = Math.Max(0.0, Math.Min(1.0, clamped));
                if (h < minH) minH = h;
            }
            return minH;
        }

        static StationCellMeshResult MeshSingleCell(StationMeshCell cell, Dictionary<StationCellKey, StationSlopeCut> cuts = null) {
            var input = new StationCellMeshInput {
                VirtualGround = false,
                BuildGround = false,
                BuildCeilings = false,
                BuildPlates = false,
            };
            input.Cells.Add(cell);
            if (cuts != null) input.SlopeCuts = cuts;
            return StationCellMesher.Mesh(input);
        }

        static StationModuleRecord CreateStairFromPalette(string style, int x, int y, int z, double width, int rot = 0) {
            // Mirror game/src/build/model.ts createModule for straight, 90°, and 180° catalogue stairs.
            int lanes = Math.Abs(width - StairWidthTriple) < 1e-6 ? 3 : Math.Abs(width - StairWidthDouble) < 1e-6 ? 2 : 1;
            double onGridWidth = lanes - 2.0 * StationRunGeometry.StairRailProud;
            JArray flights;
            JObject fromObj, toObj;
            string cfgStyle;
            double storedWidth;
            if (style == "stair-straight") {
                cfgStyle = "straight";
                storedWidth = width;
                fromObj = new JObject { ["x"] = x, ["y"] = y, ["z"] = z };
                int dx, dy;
                RotateDelta(rot, 0, 8, out dx, out dy);
                toObj = new JObject { ["x"] = x + dx, ["y"] = y + dy, ["z"] = z + 5 };
                flights = new JArray { new JObject { ["from"] = fromObj.DeepClone(), ["to"] = toObj.DeepClone() } };
            } else if (style == "stair-right180") {
                cfgStyle = "right180";
                storedWidth = onGridWidth;
                // First leg climbs +y by 4 cells, half-landing at z+2.5, return leg shifts +lanes in x and climbs -y by 4 cells.
                int f1x, f1y, mid2x, mid2y, endx, endy;
                RotateDelta(rot, 0, 4, out f1x, out f1y);
                RotateDelta(rot, lanes, 4, out mid2x, out mid2y);
                RotateDelta(rot, lanes, 0, out endx, out endy);
                fromObj = new JObject { ["x"] = x, ["y"] = y, ["z"] = z };
                var mid1 = new JObject { ["x"] = x + f1x, ["y"] = y + f1y, ["z"] = z + 2.5 };
                var mid2 = new JObject { ["x"] = x + mid2x, ["y"] = y + mid2y, ["z"] = z + 2.5 };
                toObj = new JObject { ["x"] = x + endx, ["y"] = y + endy, ["z"] = z + 5 };
                flights = new JArray {
                    new JObject { ["from"] = fromObj.DeepClone(), ["to"] = mid1 },
                    new JObject { ["from"] = mid2, ["to"] = toObj.DeepClone() },
                };
            } else {
                // stair-right90
                cfgStyle = "right90";
                storedWidth = onGridWidth;
                int f1x, f1y, endx, endy;
                RotateDelta(rot, 0, 4, out f1x, out f1y);
                RotateDelta(rot, 4, 4, out endx, out endy);
                fromObj = new JObject { ["x"] = x, ["y"] = y, ["z"] = z };
                var mid = new JObject { ["x"] = x + f1x, ["y"] = y + f1y, ["z"] = z + 2.5 };
                toObj = new JObject { ["x"] = x + endx, ["y"] = y + endy, ["z"] = z + 5 };
                flights = new JArray {
                    new JObject { ["from"] = fromObj.DeepClone(), ["to"] = mid.DeepClone() },
                    new JObject { ["from"] = mid, ["to"] = toObj.DeepClone() },
                };
            }
            var mod = new JObject {
                ["id"] = style + "-" + lanes + "-" + rot,
                ["type"] = "stair",
                ["x"] = x,
                ["y"] = y,
                ["z"] = z,
                ["rot"] = rot,
                ["from"] = fromObj,
                ["to"] = toObj,
                ["cfg"] = new JObject {
                    ["width"] = storedWidth,
                    ["style"] = cfgStyle,
                    ["flights"] = flights,
                },
            };
            var read = ReadSave(BaseSave(null, new JArray { mod }));
            return read.Document.Modules[0];
        }

        static void RotateDelta(int rot, int lx, int ly, out int wx, out int wy) {
            StationRunGeometry.RotateLocal(rot, lx, ly, out double dx, out double dy);
            wx = (int)Math.Round(dx);
            wy = (int)Math.Round(dy);
        }

        /* -------------------------------------------------- escalator vs stair cuts */

        [Test]
        public void EscalatorSlopeCutFollowsTrussDepthOwnBodyHalfWidthAndProtectsOnlyLowerLanding() {
            // Escalator with incline=0 matches the landing-to-landing walking line directly.
            var escJson = EscalatorJson("e1", 6, 0, 0, 0, 0, 4);
            ((JObject)escJson["cfg"])["incline"] = 0;
            var read = ReadSave(BaseSave(null, new JArray { escJson }));
            var esc = read.Document.Modules[0].Facts;

            var cuts = StationRampOpenings.RampSlopeCuts(new[] { esc });
            Assert.Greater(cuts.Count, 0, "escalator over ground must produce slope cuts");

            foreach (var pair in cuts) {
                var key = pair.Key;
                var cut = pair.Value;
                Assert.AreEqual('x', cut.Axis, "escalator along x must slope along x");
                Assert.IsTrue(cut.OwnBody, "escalator cut must flag OwnBody=true");
                Assert.IsFalse(cut.NoFill, "escalator cut does not use stair NoFill");
                Assert.IsTrue(cut.HasHalf, "escalator cut must carry truss half-width");
                Assert.AreEqual(StationRunGeometry.EscalatorBalustrade * 0.5, cut.Half, 1e-9,
                    "escalator cut Half must equal EscalatorBalustrade / 2");
                Assert.AreEqual(0, key.Y, "only the run's own column y=0 is cut");
                Assert.IsFalse(key.X == 6 && key.Y == 0, "lower landing (6,0) must never be cut");
            }

            Assert.IsTrue(cuts.TryGetValue(new StationCellKey(4, 0, 1), out var under),
                "cell (4,0,1) beneath escalator must be cut");
            for (int i = 0; i <= 4; i++) {
                double t = i * 0.25;
                double world = 1.0 + under.Lo + (under.Hi - under.Lo) * t;
                double expectedTruss = WalkingLine(esc, 4.0 + t, 0.5) - StationRampOpenings.RampFoot;
                Assert.AreEqual(expectedTruss, world, 1e-9, $"truss plane mismatch at t={t}");
            }

            Assert.IsTrue(cuts.TryGetValue(new StationCellKey(0, 0, 4), out var upper),
                "upper landing block (0,0,4) must be cut under terminal track");
            Assert.Less(upper.Lo, 1.0);
            Assert.Less(upper.Hi, 1.0);
        }

        [Test]
        public void StairSlopeCutUsesBodyDropNoFillBaseClampTurnFlightsAndProtectsAllLandings() {
            Assert.Less(StationRampOpenings.StairBodyDrop, StationRampOpenings.RampFoot,
                "stair soffit drop must be shallower than escalator truss depth");

            var stairRead = ReadSave(BaseSave(null, new JArray { StairJson("s1", 6, 0, 0, 0, 0, 4) }));
            var stairFacts = stairRead.Document.Modules[0].Facts;
            var cuts = StationRampOpenings.RampSlopeCuts(new[] { stairFacts });
            Assert.Greater(cuts.Count, 0);

            double basePlane = stairFacts.From.Z + 1.0;
            int clampedCount = 0;
            int slopingCount = 0;
            foreach (var pair in cuts) {
                var key = pair.Key;
                var cut = pair.Value;
                Assert.IsTrue(cut.NoFill, "stair cut must flag NoFill=true");
                Assert.IsFalse(cut.OwnBody, "stair cut must flag OwnBody=false");
                Assert.IsFalse(cut.HasHalf, "stair cut must stay full cell width");
                Assert.IsNull(cut.Finish, "unpainted stair must leave Finish null");
                Assert.IsFalse((key.X == 6 && key.Y == 0) || (key.X == 0 && key.Y == 0),
                    $"stair landing ({key.X},{key.Y}) must never be cut");

                for (int i = 0; i <= 2; i++) {
                    double t = i * 0.5;
                    double world = key.Z + cut.Lo + (cut.Hi - cut.Lo) * t;
                    Assert.GreaterOrEqual(world, basePlane - 1e-9, "stair cut must never dip below base landing plane");
                }
                if (cut.HasBase) {
                    Assert.AreEqual(basePlane, key.Z + cut.Base, 1e-9, "stair Base clamp must equal lower landing top");
                    Assert.GreaterOrEqual(Math.Min(cut.Lo, cut.Hi), cut.Base - 1e-9);
                    clampedCount++;
                }
                if (Math.Abs(cut.Hi - cut.Lo) > 1e-9) slopingCount++;
            }
            Assert.Greater(clampedCount, 0, "stair base clamp must trigger near lower landing");
            Assert.Greater(cuts.Count, clampedCount, "stair base clamp must not swallow every cell");
            Assert.Greater(slopingCount, 0, "stair must remain sloped above base plane");

            // Turn flights follow trimmed tread slope (steeper than landing-to-landing line).
            foreach (var style in new[] { "stair-straight", "stair-right90", "stair-right180" }) {
                var turnRec = CreateStairFromPalette(style, 0, 0, -4, EscalatorBand, rot: 0);
                var turnFacts = turnRec.Facts;
                var turnCuts = StationRampOpenings.RampSlopeCuts(new[] { turnFacts });
                Assert.Greater(turnCuts.Count, 0, $"{style} must produce cuts");
                var flights = StationRunGeometry.StairFlights(turnFacts);
                foreach (var f in flights) {
                    double ax = f.From.X + 0.5, ay = f.From.Y + 0.5;
                    double bx = f.To.X + 0.5, by = f.To.Y + 0.5;
                    double len = Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
                    double trim = StationRunGeometry.StairTreadTrim(len);
                    double drawnSlope = (f.To.Z - f.From.Z) / (len - trim * 2.0);
                    Assert.Greater(drawnSlope, (f.To.Z - f.From.Z) / len + 1e-9,
                        $"{style}: trimmed flight must be steeper than landing-to-landing slope");
                    int checkedCells = 0;
                    foreach (var kv in turnCuts) {
                        double cx = kv.Key.X + 0.5, cy = kv.Key.Y + 0.5;
                        double dSum = Math.Sqrt((cx - ax) * (cx - ax) + (cy - ay) * (cy - ay)) +
                                      Math.Sqrt((cx - bx) * (cx - bx) + (cy - by) * (cy - by));
                        if (Math.Abs(dSum - len) > 0.6) continue;
                        checkedCells++;
                        var c = kv.Value;
                        if (c.HasBase && Math.Min(c.Lo, c.Hi) <= c.Base + 1e-9) continue;
                        Assert.AreEqual(drawnSlope, Math.Abs(c.Hi - c.Lo), 1e-9,
                            $"{style} at ({kv.Key.X},{kv.Key.Y}): cut slope must match trimmed flight body slope");
                    }
                    Assert.Greater(checkedCells, 0, $"{style}: expected cut cells along flight");
                }
            }
        }

        [Test]
        public void PaintedStairCarriesFinishToCapUnlessPlayerPaintedTopFace() {
            const string cladding = "wall.enamel";
            const string groundFinish = "floor.granite";
            var paintedRead = ReadSave(BaseSave(null, new JArray {
                StairJson("s1", 6, 0, 0, 0, 0, 4, finish: cladding),
            }));
            var paintedFacts = paintedRead.Document.Modules[0].Facts;
            var cuts = StationRampOpenings.RampSlopeCuts(new[] { paintedFacts });
            Assert.Greater(cuts.Count, 0);
            foreach (var cut in cuts.Values) {
                Assert.AreEqual(cladding, cut.Finish, "painted stair cut must propagate cfg.finish");
            }

            var target = new StationCellKey(5, 0, 1);
            Assert.IsTrue(cuts.ContainsKey(target), "expected cut at (5,0,1)");

            // Sides painted groundFinish, top unpainted -> cap uses stair's cladding finish.
            var unpaintedTopCell = new StationMeshCell {
                X = 5, Y = 0, Z = 1, Solid = true, Shape = StationCellShape.Full,
                Finish = new StationFinishSet(top: null, bottom: groundFinish, n: groundFinish, e: groundFinish, s: groundFinish, w: groundFinish),
            };
            var res = MeshSingleCell(unpaintedTopCell, cuts);
            var capGroup = res.Groups.FirstOrDefault(g => g.FinishId == cladding);
            var flankGroup = res.Groups.FirstOrDefault(g => g.FinishId == groundFinish);
            Assert.IsNotNull(capGroup, "shaved cap must wear stair cfg.finish when top face is unpainted");
            Assert.IsNotNull(flankGroup, "block sides must retain ground finish");
            for (int i = 0; i < capGroup.Positions.Length; i++) {
                var p = capGroup.Positions[i];
                double expectedPlane = Math.Min(2.0, Math.Max(1.0, BodyLine(paintedFacts, p.x, p.y) - StationRampOpenings.StairBodyDrop));
                Assert.AreEqual(expectedPlane, p.z, 1e-5, $"cap vertex {p} must lie on stair cut plane");
            }

            // Player-painted top face always overrides stair cfg.finish.
            var paintedTopCell = new StationMeshCell {
                X = 5, Y = 0, Z = 1, Solid = true, Shape = StationCellShape.Full,
                Finish = new StationFinishSet(top: groundFinish, bottom: groundFinish, n: groundFinish, e: groundFinish, s: groundFinish, w: groundFinish),
            };
            var kept = MeshSingleCell(paintedTopCell, cuts);
            Assert.IsNull(kept.Groups.FirstOrDefault(g => g.FinishId == cladding),
                "stair cfg.finish must not overwrite player-painted top face");
            Assert.IsNotNull(kept.Groups.FirstOrDefault(g => g.FinishId == groundFinish));
        }

        /* ------------------------------------------ multi-lane & broad-phase thins */

        [Test]
        public void TwoLaneSwitchbackAndThreeLaneStraightAndSwitchbackCutAllLaneColumns() {
            // 2-lane switchback covers 4 columns (x = 0..3).
            var sw2 = CreateStairFromPalette("stair-right180", 0, 0, -4, StairWidthDouble, rot: 0).Facts;
            Assert.AreEqual(1.79, sw2.Config.Number("width", 0), 1e-6);
            var sw2Cols = new HashSet<int>(StationRampOpenings.RampSlopeCuts(new[] { sw2 }).Keys.Select(k => k.X));
            for (int x = 0; x <= 3; x++) Assert.IsTrue(sw2Cols.Contains(x), $"2-lane switchback missing column x={x}");

            // 3-lane straight: RampLaneHalf == 1.5, cuts x = 0..2 with identical (lo, hi) across each row.
            var st3 = CreateStairFromPalette("stair-straight", 0, 0, -4, StairWidthTriple, rot: 0).Facts;
            Assert.AreEqual(1.5, StationRampOpenings.RampLaneHalf(st3), 1e-9, "3-lane straight RampLaneHalf must be 1.5");
            var st3Cuts = StationRampOpenings.RampSlopeCuts(new[] { st3 });
            Assert.Greater(st3Cuts.Count, 0);
            var rows = new Dictionary<int, Dictionary<int, StationSlopeCut>>();
            foreach (var kv in st3Cuts) {
                Assert.That(kv.Key.X, Is.InRange(0, 2), $"3-lane straight cut outside x=0..2 at x={kv.Key.X}");
                if (!rows.TryGetValue(kv.Key.Y, out var row)) rows[kv.Key.Y] = row = new Dictionary<int, StationSlopeCut>();
                row[kv.Key.X] = kv.Value;
            }
            Assert.Greater(rows.Count, 0);
            foreach (var row in rows) {
                CollectionAssert.AreEquivalent(new[] { 0, 1, 2 }, row.Value.Keys, $"row y={row.Key} must span all 3 lanes");
                var planes = new HashSet<string>(row.Value.Values.Select(c =>
                    c.Lo.ToString("G12", CultureInfo.InvariantCulture) + "," + c.Hi.ToString("G12", CultureInfo.InvariantCulture)));
                Assert.AreEqual(1, planes.Count, $"row y={row.Key} lanes must share the same cut plane");
            }

            // 3-lane openings at z=0 open x=0,1,2 and leave x=-1,3 intact.
            var openings = StationRampOpenings.RampOpeningsAtLevel(new[] { st3 }, 0);
            for (int x = 0; x <= 2; x++) Assert.IsTrue(openings.Contains(new StationCellKey(x, 4, 0)), $"lane x={x} must be open at z=0");
            Assert.IsFalse(openings.Contains(new StationCellKey(-1, 4, 0)));
            Assert.IsFalse(openings.Contains(new StationCellKey(3, 4, 0)));

            // 3-lane switchback covers 6 columns (x = 0..5).
            var sw3 = CreateStairFromPalette("stair-right180", 0, 0, -4, StairWidthTriple, rot: 0).Facts;
            Assert.AreEqual(1.5, StationRampOpenings.RampLaneHalf(sw3), 1e-9);
            var sw3Cols = new HashSet<int>(StationRampOpenings.RampSlopeCuts(new[] { sw3 }).Keys.Select(k => k.X));
            for (int x = 0; x <= 5; x++) Assert.IsTrue(sw3Cols.Contains(x), $"3-lane switchback missing column x={x}");
            foreach (var x in sw3Cols) Assert.That(x, Is.InRange(0, 5), $"3-lane switchback cut outside x=0..5 at x={x}");
        }

        [Test]
        public void LegacyWideStairThinsAdjacentWallsAndCrosses16CellBroadPhaseBucketBoundary() {
            // Legacy 1.6 m off-grid stair descending along +y through z=0 thins wall at x=2 to side E.
            var legacy = StairJson("legacy", 1, 4, -2, 1, -4, 3, width: 1.6, rot: 2);
            var wallCells = new List<StationMeshCell> {
                new StationMeshCell { X = 2, Y = 2, Z = 0, Solid = true, Shape = StationCellShape.Full, Flags = StationMeshCellFlags.Wall },
            };
            var legacyFacts = ReadSave(BaseSave(null, new JArray { legacy })).Document.Modules[0].Facts;
            var thins = StationRampOpenings.RampThinCells(wallCells, new[] { legacyFacts });
            Assert.AreEqual(1, thins.Count, "legacy 1.6 m stair must thin adjacent wall");
            Assert.AreEqual(new StationCellKey(2, 2, 0), thins[0].Key);
            Assert.AreEqual(StationWallSide.E, thins[0].Side, "thin side must sit on the half away from the run");

            // 16-cell broad-phase bucket boundary: x=-17 (bucket -2) and x=-15 (bucket -1) both reach wall at x=-16.
            var westJson = StairJson("west", -17, 4, -2, -17, -4, 3, width: 1.6, rot: 2);
            var eastJson = StairJson("east", -15, 4, -2, -15, -4, 3, width: 1.6, rot: 2);
            var bothDoc = ReadSave(BaseSave(null, new JArray { westJson, eastJson })).Document;
            var west = bothDoc.Modules[0].Facts;
            var east = bothDoc.Modules[1].Facts;
            var seamWall = new[] {
                new StationMeshCell { X = -16, Y = 2, Z = 0, Solid = true, Shape = StationCellShape.Full, Flags = StationMeshCellFlags.Wall },
            };

            var weThins = StationRampOpenings.RampThinCells(seamWall, new[] { west, east });
            var ewThins = StationRampOpenings.RampThinCells(seamWall, new[] { east, west });
            Assert.AreEqual(1, weThins.Count);
            Assert.AreEqual(1, ewThins.Count);
            Assert.AreEqual(StationWallSide.E, weThins[0].Side, "west ramp must reach across -16 bucket boundary");
            Assert.AreEqual(StationWallSide.W, ewThins[0].Side, "first overlapping ramp must own thin side across bucket seam");
        }

        /* ---------------------------------------- Tianhe Park fixtures & overlaps */

        [Test]
        public void TianheParkFixturesRetainVolumeAllowPlacementExcludeOpeningAndRefuseTwoRunOverlap() {
            // Exact Tianhe Park run #1: (83,-102,-20) -> (60,-102,-5), width 2.04.
            var stair135 = StairJson("stair-straight-135", 83, -102, -20, 60, -102, -5, width: 2.04, rot: 3);
            var read1 = ReadSave(BaseSave(null, new JArray { stair135 }));
            var facts1 = read1.Document.Modules[0].Facts;
            var target = new StationCellKey(77, -100, -16);
            var above = new StationCellKey(77, -100, -15);

            var cuts1 = StationRampOpenings.RampSlopeCuts(new[] { facts1 });
            Assert.IsTrue(cuts1.TryGetValue(target, out var cut77), "Tianhe (77,-100,-16) must have a slope cut");
            Assert.AreEqual(0.7309090909090905, cut77.Lo, 1e-8);
            Assert.AreEqual(0.04909090909091063, cut77.Hi, 1e-8);
            Assert.IsTrue(StationRampOpenings.RampSurfaceRetainsVolume(cut77.PatchList),
                "Tianhe (77,-100,-16) cut wedge must retain volume");

            var openings16 = StationRampOpenings.RampOpeningsAtLevel(new[] { facts1 }, -16);
            var openings15 = StationRampOpenings.RampOpeningsAtLevel(new[] { facts1 }, -15);
            Assert.IsFalse(openings16.Contains(target), "retained wedge (77,-100,-16) must be excluded from RampOpeningsAtLevel");
            Assert.IsTrue(openings15.Contains(above), "passage cell (77,-100,-15) above wedge must stay reserved");

            var world1 = StationCellEditWorld.Build(read1.Index, new StationCellReservations(read1.Index));
            var preview = StationCellPlanner.CheckBlockCells(world1, new[] { target, above });
            CollectionAssert.AreEqual(new[] { target }, preview.Accepted);
            CollectionAssert.AreEqual(new[] { above }, preview.Blocked);
            var patch = StationCellPlanner.PlanAddCells(world1, new[] { target });
            Assert.AreEqual(1, patch.Changed, "PlanAddCells must accept retained wedge (77,-100,-16)");

            // Wide retained stair lane must not become a thin side panel.
            var placedCell = new StationMeshCell { X = 77, Y = -100, Z = -16, Solid = true, Shape = StationCellShape.Full };
            Assert.AreEqual(0, StationRampOpenings.RampThinCells(new[] { placedCell }, new[] { facts1 }).Count);

            // Exact Tianhe Park run #2: multi-storey centerForward stair verifying (79,-100,-17) and (83,-102,-20).
            var fwdFlights = new JArray {
                new JObject { ["from"] = new JObject { ["x"] = 84, ["y"] = -102, ["z"] = -20 }, ["to"] = new JObject { ["x"] = 80, ["y"] = -102, ["z"] = -17.5 } },
                new JObject { ["from"] = new JObject { ["x"] = 80, ["y"] = -102, ["z"] = -17.5 }, ["to"] = new JObject { ["x"] = 72, ["y"] = -102, ["z"] = -12.5 } },
                new JObject { ["from"] = new JObject { ["x"] = 72, ["y"] = -102, ["z"] = -12.5 }, ["to"] = new JObject { ["x"] = 64, ["y"] = -102, ["z"] = -7.5 } },
                new JObject { ["from"] = new JObject { ["x"] = 64, ["y"] = -102, ["z"] = -7.5 }, ["to"] = new JObject { ["x"] = 60, ["y"] = -102, ["z"] = -5 } },
            };
            var fwdJson = StairJson("forward", 84, -102, -20, 60, -102, -5, width: 2.79, style: "centerForward", rot: 3, flights: fwdFlights);
            var fwdFacts = ReadSave(BaseSave(null, new JArray { fwdJson })).Document.Modules[0].Facts;
            var fwdCuts = StationRampOpenings.RampSlopeCuts(new[] { fwdFacts });

            Assert.IsTrue(fwdCuts.TryGetValue(new StationCellKey(79, -100, -17), out var besideLanding),
                "interior landing cell (79,-100,-17) must be cut");
            Assert.IsFalse(besideLanding.HasBase, "interior landing must not clamp ground with a base shelf");
            Assert.AreEqual(0.14, besideLanding.Hi, 1e-9);
            Assert.Less(besideLanding.Hi, 0.5);
            Assert.Greater(besideLanding.Lo, besideLanding.Hi, "flight climbs away from interior landing");

            Assert.IsTrue(fwdCuts.TryGetValue(new StationCellKey(83, -102, -20), out var outerBase),
                "outer lower landing cell (83,-102,-20) must be cut");
            Assert.IsTrue(outerBase.HasBase, "outer base block must keep floor-level clamp");
            Assert.AreEqual(1.0, outerBase.Base, 1e-9);

            // Overlapping two-run opening refusal in BOTH module orders.
            var lowerJson = StairJson("lower", 83, -102, -22, 60, -102, -7, width: 2.04, rot: 3);
            foreach (var pair in new[] { new JArray { stair135, lowerJson }, new JArray { lowerJson, stair135 } }) {
                var twoRead = ReadSave(BaseSave(null, pair));
                var twoWorld = StationCellEditWorld.Build(twoRead.Index, new StationCellReservations(twoRead.Index));
                var verdict = StationCellPlanner.BlockReason(twoWorld, target.X, target.Y, target.Z);
                Assert.IsFalse(verdict.Ok, "wedge of upper run must not excuse blocking lower run's passage");
                Assert.AreEqual(StationBlockRefusal.Opening, verdict.Refusal);
                Assert.IsTrue(StationRampOpenings.PrepareOpenings(twoRead.Index).AtLevel(target.Z).Contains(target));
            }

            // Also verify against the shipped Tianhe demo file if present in the project.
            var tianhePath = Path.Combine(Application.dataPath, "StationDesigner", "Demos", "tianhe.metro.json");
            if (File.Exists(tianhePath)) {
                var tianheRead = StationDocumentReader.Read(File.ReadAllText(tianhePath), StationSource.None);
                Assert.IsNotNull(tianheRead.Document, "tianhe.metro.json failed to read");
                var tianheCuts = StationRampOpenings.RampSlopeCuts(tianheRead.Document.Modules);
                Assert.Greater(tianheCuts.Count, 0, "shipped Tianhe demo must produce ramp slope cuts");
            }
        }

        [Test]
        public void RampSurfaceRetainsVolumeHandlesZeroPartialCrossingAndBaseClampedPatches() {
            StationRampPatch MakePatch(double lo, double hi, double x0 = 0, double x1 = 1, double y0 = 0, double y1 = 1,
                bool hasBase = false, double baseZ = 0) =>
                new StationRampPatch('x', lo, hi, x0, x1, y0, y1, hasBase, baseZ);

            Assert.IsFalse(StationRampOpenings.RampSurfaceRetainsVolume(new[] { MakePatch(0, 0) }));
            Assert.IsFalse(StationRampOpenings.RampSurfaceRetainsVolume(new[] { MakePatch(-1, 0) }),
                "zero-thickness boundary face is not a retained block volume");
            Assert.IsTrue(StationRampOpenings.RampSurfaceRetainsVolume(new[] { MakePatch(-1, 0.01) }));
            Assert.IsTrue(StationRampOpenings.RampSurfaceRetainsVolume(new[] { MakePatch(-1, -1, x1: 0.5) }),
                "uncut half of block survives");
            Assert.IsFalse(StationRampOpenings.RampSurfaceRetainsVolume(new[] {
                MakePatch(-1, 1), MakePatch(1, -1),
            }), "two opposing slopes can jointly consume the whole block");
            Assert.IsTrue(StationRampOpenings.RampSurfaceRetainsVolume(new[] { MakePatch(-1, -1, hasBase: true, baseZ: 0.1) }),
                "positive base clamp retains volume");
        }

        /* ------------------------------------------------------- RampFillKeys rules */

        [Test]
        public void RampFillKeysFillsOnlyEmptyOverSolidForSyntheticCutsAndProducesNoneForRealRamps() {
            var solid = new HashSet<StationCellKey> {
                new StationCellKey(1, 0, 0), // solid below empty (1,0,1) -> MUST fill
                new StationCellKey(2, 0, 0),
                new StationCellKey(2, 0, 1), // already solid -> MUST NOT fill
                // (3,0,0) absent / void -> (3,0,1) MUST NOT fill
                new StationCellKey(4, 0, 0), // cut has NoFill=true -> MUST NOT fill
                new StationCellKey(5, 0, 0), // cut has OwnBody=true -> MUST NOT fill
            };
            var cuts = new Dictionary<StationCellKey, StationSlopeCut> {
                [new StationCellKey(1, 0, 1)] = new StationSlopeCut { Axis = 'x', Lo = 0.2, Hi = 0.8 },
                [new StationCellKey(2, 0, 1)] = new StationSlopeCut { Axis = 'x', Lo = 0.2, Hi = 0.8 },
                [new StationCellKey(3, 0, 1)] = new StationSlopeCut { Axis = 'x', Lo = 0.2, Hi = 0.8 },
                [new StationCellKey(4, 0, 1)] = new StationSlopeCut { Axis = 'x', Lo = 0.2, Hi = 0.8, NoFill = true },
                [new StationCellKey(5, 0, 1)] = new StationSlopeCut { Axis = 'x', Lo = 0.2, Hi = 0.8, OwnBody = true },
            };

            var fills = StationRampOpenings.RampFillKeys(solid, cuts);
            CollectionAssert.AreEquivalent(new[] { new StationCellKey(1, 0, 1) }, fills,
                "synthetic non-NoFill/non-OwnBody cut must fill only empty cell standing directly on solid");

            // Real stair and escalator always produce SlopeFills.Count == 0.
            var floorCells = new JArray();
            for (int x = 0; x <= 8; x++)
                for (int y = -1; y <= 1; y++)
                    floorCells.Add(CellJson(x, y, 0));

            foreach (var mod in new[] { StairJson("s1"), EscalatorJson("e1") }) {
                var read = ReadSave(BaseSave((JArray)floorCells.DeepClone(), new JArray { mod }));
                var meshInput = StationCellRenderer.BuildInput(read.Document, null, null, null);
                Assert.AreEqual(0, meshInput.SlopeFills.Count,
                    $"real {mod["type"]} must produce 0 derived SlopeFills");
            }
        }

        /* -------------------------- mesher bends, crossings, neighbors, chunk seams */

        [Test]
        public void MesherSplitsSlopeBendsPreservesCrossingAreaExposesCutNeighborAndKeepsShavedHalfWallInnerFace() {
            // 1. Bend splits: lo=-0.5, hi=1.5 (and with base=0.3) split cap at floor/base/ceiling bends.
            var bendCases = new[] {
                new StationSlopeCut { Axis = 'x', Lo = -0.5, Hi = 1.5 },
                new StationSlopeCut { Axis = 'y', Lo = -0.5, Hi = 1.5, HasBase = true, Base = 0.3 },
            };
            foreach (var cut in bendCases) {
                var cell = new StationMeshCell { X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full };
                var mesh = MeshSingleCell(cell, new Dictionary<StationCellKey, StationSlopeCut> { [cell.Key] = cut });
                int capTris = 0;
                foreach (var g in mesh.Groups) {
                    for (int t = 0; t < g.Indices.Length; t += 3) {
                        int i0 = g.Indices[t], i1 = g.Indices[t + 1], i2 = g.Indices[t + 2];
                        if (g.Normals[i0].z <= 0f) continue;
                        var centroid = (g.Positions[i0] + g.Positions[i1] + g.Positions[i2]) / 3f;
                        double expectedZ = EvalCutCap(cut, centroid.x, centroid.y);
                        Assert.AreEqual(expectedZ, centroid.z, 2e-4,
                            $"cap triangle centroid must lie on clamped bend surface (axis={cut.Axis}, base={cut.HasBase})");
                        capTris++;
                    }
                }
                Assert.Greater(capTris, 4, "bent slope cap must be subdivided at slope changes without bridging");
            }

            // 2. Partial footprint & crossing planes: upward cap area projects cleanly to 1.0 m^2.
            var crossingCases = new[] {
                new[] { new StationRampPatch('x', 0.25, 0.25, 0.25, 0.75, 0.2, 0.8) },
                new[] { new StationRampPatch('x', 0, 1, 0, 1, 0, 1), new StationRampPatch('y', 1, 0, 0, 1, 0, 1) },
            };
            foreach (var patches in crossingCases) {
                var cut = new StationSlopeCut {
                    Axis = patches[0].Axis, Lo = patches[0].Lo, Hi = patches[0].Hi, Patches = patches,
                };
                var cell = new StationMeshCell { X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full };
                var mesh = MeshSingleCell(cell, new Dictionary<StationCellKey, StationSlopeCut> { [cell.Key] = cut });
                double xyArea = 0;
                int capTris = 0;
                foreach (var g in mesh.Groups) {
                    for (int t = 0; t < g.Indices.Length; t += 3) {
                        int i0 = g.Indices[t], i1 = g.Indices[t + 1], i2 = g.Indices[t + 2];
                        if (g.Normals[i0].z <= 1e-4f) continue;
                        var a = g.Positions[i0];
                        var b = g.Positions[i1];
                        var c = g.Positions[i2];
                        xyArea += Math.Abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5;
                        var mid = (a + b + c) / 3f;
                        Assert.AreEqual(EvalCutCap(cut, mid.x, mid.y), mid.z, 2e-4);
                        capTris++;
                    }
                }
                Assert.AreEqual(1.0, xyArea, 1e-4, "projected XY cap area of partial/crossing cuts must cover full 1 m^2 block");
                Assert.Greater(capTris, 2, "crossing/partial cut must split into multiple cap regions");
            }

            // 3. Cut neighbor at (1,0,0) exposes upper portion of (0,0,0)'s east wall (+X normal at x=1).
            var pairInput = new StationCellMeshInput {
                VirtualGround = false, BuildGround = false, BuildCeilings = false, BuildPlates = false,
            };
            pairInput.Cells.Add(new StationMeshCell { X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full });
            pairInput.Cells.Add(new StationMeshCell { X = 1, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full });
            pairInput.SlopeCuts[new StationCellKey(1, 0, 0)] = new StationSlopeCut { Axis = 'y', Lo = 0.2, Hi = 0.8 };
            var pairMesh = StationCellMesher.Mesh(pairInput);
            int exposedEastVerts = 0;
            foreach (var g in pairMesh.Groups) {
                for (int i = 0; i < g.Positions.Length; i++) {
                    if (g.Normals[i].x < 0.9f) continue;
                    if (Math.Abs(g.Positions[i].x - 1f) > 1e-4f) continue;
                    double cutHeight = 0.2 + 0.6 * g.Positions[i].y;
                    Assert.GreaterOrEqual(g.Positions[i].z, cutHeight - 1e-4,
                        "exposed east wall of (0,0,0) must lie at or above neighbor's cut line");
                    exposedEastVerts++;
                }
            }
            Assert.Greater(exposedEastVerts, 0, "east face of (0,0,0) must not be culled against shaved neighbor (1,0,0)");

            // 4. Shaved half-wall (west half) keeps its exposed inner +X face.
            var halfCell = new StationMeshCell {
                X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Half(StationWallSide.W),
            };
            var halfMesh = MeshSingleCell(halfCell, new Dictionary<StationCellKey, StationSlopeCut> {
                [halfCell.Key] = new StationSlopeCut { Axis = 'y', Lo = 0.3, Hi = 0.7 },
            });
            bool hasInnerEastNormal = halfMesh.Groups.Any(g => g.Normals.Any(n => n.x > 0.9f));
            Assert.IsTrue(hasInnerEastNormal, "shaved west half-wall must retain its exposed inner +X face");
        }

        [Test]
        public void WorkspaceInvalidatesBothChunksAcross16CellSeamWhenRampFootprintChanges() {
            // Solid blocks straddle the 16-cell chunk seam: x=15 (ChunkX=0) and x=16 (ChunkX=16).
            // Widening a stair at x=16 from 0.50 m (leaves west face x=16 unshaved) to 0.79 m
            // (full-cell cut, shaving x=16) changes only the cut footprint [x0..x1] while lo/hi
            // stay identical, exposing the upper east wall of (15,0,1) in ChunkX=0.
            var cells = new JArray {
                CellJson(15, 0, 1),
                CellJson(16, 0, 1),
            };
            var stairBefore = StairJson("seam-stair", 16, -2, 0, 16, 4, 4, width: 0.50, rot: 0, block: false);
            var stairAfter = StairJson("seam-stair", 16, -2, 0, 16, 4, 4, width: 0.79, rot: 0, block: false);

            var readBefore = ReadSave(BaseSave((JArray)cells.DeepClone(), new JArray { stairBefore }));
            var readAfter = ReadSave(BaseSave((JArray)cells.DeepClone(), new JArray { stairAfter }));

            var inputBefore = StationCellRenderer.BuildInput(readBefore.Document, null, null, null);
            inputBefore.VirtualGround = false;
            inputBefore.BuildGround = false;
            var workspace = StationCellMeshWorkspace.Create(inputBefore, StationRampOpenings.PrepareOpenings(readBefore.Index));
            var beforeChunks = workspace.MeshAll();

            // Stage delta replacing seam-stair with the wider footprint.
            var delta = new StationIndexDelta();
            delta.ChangedModules.Add(readAfter.Document.Modules[0]);
            var staged = workspace.StageDocumentDelta(readAfter.Document, readAfter.Index, delta, readBefore.Index);
            staged.Commit();

            Assert.IsTrue(staged.DirtyKeys.Any(k => !k.IsGround && k.ChunkX == 0),
                "neighbor ChunkX=0 holding (15,0,1) must be marked dirty across the seam");
            Assert.IsTrue(staged.DirtyKeys.Any(k => !k.IsGround && k.ChunkX == 16),
                "cut ChunkX=16 holding (16,0,1) must be marked dirty");

            var incrementalAfter = workspace.MeshAll();

            var inputFresh = StationCellRenderer.BuildInput(readAfter.Document, null, null, null);
            inputFresh.VirtualGround = false;
            inputFresh.BuildGround = false;
            var freshAfter = StationCellMeshWorkspace.Create(inputFresh, StationRampOpenings.PrepareOpenings(readAfter.Index)).MeshAll();

            string Signature(Dictionary<StationCellMeshWorkspace.ChunkBandKey, List<StationCellMeshGroup>> map) {
                var lines = new List<string>();
                foreach (var kv in map.OrderBy(p => p.Key.ChunkX).ThenBy(p => p.Key.ChunkY).ThenBy(p => p.Key.Storey)) {
                    foreach (var g in kv.Value.OrderBy(x => x.GroupKey, StringComparer.Ordinal)) {
                        var pts = g.Positions.Select(p =>
                            string.Format(CultureInfo.InvariantCulture, "{0:F4},{1:F4},{2:F4}", p.x, p.y, p.z)).OrderBy(s => s, StringComparer.Ordinal);
                        lines.Add(g.GroupKey + ":" + g.TriangleCount + ":" + string.Join(";", pts));
                    }
                }
                return string.Join("\n", lines);
            }

            Assert.AreNotEqual(Signature(beforeChunks), Signature(incrementalAfter),
                "footprint change across chunk seam must update meshed surfaces");
            Assert.AreEqual(Signature(freshAfter), Signature(incrementalAfter),
                "incremental workspace across chunk seam must exactly match fresh remesh");
        }

        /* ---------------------------------------- opening-ceiling cleanup & zones */

        [Test]
        public void AddingBlockBelowOpeningCeilingClearsTagAndRestoresFloorInZoneMap() {
            var save = BaseSave(new JArray {
                CellJson(2, 2, -5, tags: new[] { "opening-ceiling" }),
            });
            var readBefore = ReadSave(save);

            // While tagged opening-ceiling, StationZoneMap excludes (2,2,-5) as floor.
            var zonesBefore = StationZoneMap.FloorsAt(readBefore.Document, readBefore.Index, -5);
            Assert.IsFalse(zonesBefore.Any(f => f.X == 2 && f.Y == 2 && f.Z == -5),
                "opening-ceiling slab must be excluded from StationZoneMap floors");

            // Adding a supporting block directly below at (2,2,-6) must clear opening-ceiling via AddOpeningCeilingCleanup.
            var world = StationCellEditWorld.Build(readBefore.Index, new StationCellReservations(readBefore.Index));
            var patch = StationCellPlanner.PlanAddCells(world, new[] { new StationCellKey(2, 2, -6) });
            Assert.IsTrue(patch.Writes.Any(w =>
                w.Key.Equals(new StationCellKey(2, 2, -5)) &&
                w.Mode == StationCellWriteMode.AppendTags &&
                w.RemoveTags.Contains(StationCellPlanner.OpeningCeilingTag)),
                "PlanAddCells must emit opening-ceiling removal write for slab above");

            var patchedJson = StationCellEdits.Apply(save.ToString(Formatting.None), patch, out var code);
            Assert.IsNotNull(patchedJson, code ?? "StationCellEdits.Apply failed");
            var readAfter = StationDocumentReader.Read(patchedJson, StationSource.None);
            Assert.IsNotNull(readAfter.Document);

            var restored = readAfter.Index.GetCell(2, 2, -5);
            Assert.IsNotNull(restored);
            Assert.IsFalse(restored.HasTag(StationCellPlanner.OpeningCeilingTag),
                "opening-ceiling tag must be cleared once block is added below");

            var zonesAfter = StationZoneMap.FloorsAt(readAfter.Document, readAfter.Index, -5);
            Assert.IsTrue(zonesAfter.Any(f => f.X == 2 && f.Y == 2 && f.Z == -5),
                "clearing opening-ceiling must restore the slab as a floor in StationZoneMap");
        }
    }
}
