using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 11 A3 — the document/world coordinate contract and the ported footprint,
    /// mount and clearance rules, compared record by record with the TypeScript
    /// game's own answers.
    ///
    /// The fixture is produced by `tools/unity-parity/record-station-coordinates.mjs`,
    /// which imports `moduleFootprint`, `moduleEnvelope`, `isWallMounted`,
    /// `isCeilingHung`, `wallSide`, `wallMountCourses` and `exitFootprintCells` from
    /// the shipping source. Nothing here re-derives the expected geometry.
    /// </summary>
    public sealed class StationCoordinatesTests {
        // The oracle is a decimal JSON written by TypeScript; the C# path reaches the same
        // value through double arithmetic, so 1e-9 is below the rounding either side incurs.
        const double Tolerance = 1e-6;

        static string DataRoot => Application.dataPath;

        static JObject LoadOracle() =>
            JObject.Parse(File.ReadAllText(Path.Combine(DataRoot, "StationDesigner/Tests/EditMode/station-coordinates-oracle.json")));

        /// <summary>Families whose collision envelope this packet deliberately has not ported.</summary>
        static readonly HashSet<string> ClearanceGaps = new HashSet<string>(StringComparer.Ordinal) {
            "stair", "escalator", "walkway", "hanger", "light", "vent", "roof", "sign",
            "psd-end", "fence", "linemap",
        };

        /// <summary>Families whose envelope this packet owns; each must be exercised.</summary>
        static readonly HashSet<string> PortedClearance = new HashSet<string>(StringComparer.Ordinal) {
            "road", "lift", "sidewalk", "lawn", "tree", "bench", "door", "guidepost", "busstop",
            "checkout", "gate", "tvm", "vending", "desk", "cubicle", "sink", "bin", "clock",
            "cctv", "tv", "urinal", "extinguisher", "shelf", "court", "ac-unit",
            "electrical-cabinet", "tactile", "floor-mark", "billboard", "glass", "monitor",
            "calligraphy", "traffic-light", "rail-signal", "pillar", "exit", "retail", "shop",
            "booth", "platform-edge", "track",
        };

        [Test]
        public void PointsConvertWithoutCellOffsetsAndRoundTrip() {
            var oracle = LoadOracle();
            foreach (var point in (JArray)oracle["coordinates"]["points"]) {
                int x = (int)point["x"], y = (int)point["y"];
                double z = (double)point["z"];
                var world = StationCoordinates.Point(x, y, z);
                var expected = (JArray)point["world"];
                Assert.AreEqual((double)expected[0], world.x, Tolerance, "world x of " + x + "," + y + "," + z);
                Assert.AreEqual((double)expected[1], world.y, Tolerance, "world elevation of " + x + "," + y + "," + z);
                Assert.AreEqual((double)expected[2], world.z, Tolerance, "world plan y of " + x + "," + y + "," + z);
                var document = StationCoordinates.WorldToDocument(world);
                Assert.AreEqual(x, document.x, Tolerance);
                Assert.AreEqual(y, document.y, Tolerance);
                Assert.AreEqual(z, document.z, Tolerance);
                // The same point through the vector overload.
                var viaVector = StationCoordinates.Point(new Vector3(x, (float)y, (float)z));
                Assert.AreEqual(world.x, viaVector.x, Tolerance);
                Assert.AreEqual(world.y, viaVector.y, Tolerance);
                Assert.AreEqual(world.z, viaVector.z, Tolerance);
            }
        }

        [Test]
        public void CellCentreAndFloorTopAreExplicitHalfAndOneHelpers() {
            var oracle = LoadOracle();
            foreach (var cell in (JArray)oracle["coordinates"]["cells"]) {
                int x = (int)cell["x"], y = (int)cell["y"];
                double z = (double)cell["z"];
                var centre = StationCoordinates.CellCenter(x, y, z);
                var expectedCentre = (JArray)cell["centre"];
                Assert.AreEqual((double)expectedCentre[0], centre.x, Tolerance);
                Assert.AreEqual((double)expectedCentre[1], centre.y, Tolerance);
                Assert.AreEqual((double)expectedCentre[2], centre.z, Tolerance);
                var top = StationCoordinates.FloorTop(x, y, z);
                var expectedTop = (JArray)cell["floorTop"];
                Assert.AreEqual((double)expectedTop[0], top.x, Tolerance);
                Assert.AreEqual((double)expectedTop[1], top.y, Tolerance);
                Assert.AreEqual((double)expectedTop[2], top.z, Tolerance);
                Assert.AreEqual((float)(z + 1), StationCoordinates.Floor((int)z), 1e-6f);
            }
        }

        [Test]
        public void QuarterTurnsAreMinusNinetyDegreesAndNormalize() {
            var oracle = LoadOracle();
            foreach (var turn in (JArray)oracle["coordinates"]["turns"]) {
                int rot = (int)turn["rot"], norm = (int)turn["norm"];
                Assert.AreEqual(norm, StationCoordinates.NormTurn(rot));
                var rotation = StationCoordinates.ModuleRotation(rot);
                // `eulerAngles` is always 0–360, so compare the source's yaw folded
                // into that range (a −180° turn reads 180° there, which is the same
                // orientation); the forward vector below pins the direction itself.
                double expectedYaw = (double)turn["yaw"];
                double expectedFolded = (expectedYaw % 360 + 360) % 360;
                Assert.AreEqual(expectedFolded, Mathf.Repeat(rotation.eulerAngles.y, 360f), 1e-4,
                    "yaw for rot " + rot);
                var forward = StationCoordinates.Direction(new Vector3(1, 0, 0));
                var rotated = rotation * forward;
                var expectedForward = (JArray)turn["forward"];
                var documentForward = StationCoordinates.WorldToDocumentDirection(rotated);
                Assert.AreEqual((double)expectedForward[0], documentForward.x, 1e-6, "run direction rot " + rot);
                Assert.AreEqual((double)expectedForward[1], documentForward.y, 1e-6, "run direction rot " + rot);
                StationFootprints.WallSide(rot, out var wx, out var wy);
                var expectedWall = (JArray)turn["wallStep"];
                Assert.AreEqual((int)expectedWall[0], wx, "wall side x rot " + rot);
                Assert.AreEqual((int)expectedWall[1], wy, "wall side y rot " + rot);
            }
        }

        [Test]
        public void LevelGridMatchesTheSourceConstants() {
            var oracle = LoadOracle();
            foreach (var level in (JArray)oracle["coordinates"]["levels"]) {
                int levelBase = (int)level["base"];
                var steps = StationCoordinates.LevelSteps(levelBase);
                var expectedSteps = ((JArray)level["steps"]).Select(value => (int)value).ToArray();
                CollectionAssert.AreEqual(expectedSteps, steps, "levelSteps(" + levelBase + ")");
                foreach (var nearest in (JArray)level["nearest"]) {
                    double z = (double)nearest["z"];
                    Assert.AreEqual((int)nearest["level"], StationCoordinates.NearestLevel(z, levelBase),
                        "nearestLevel(" + z + "," + levelBase + ")");
                }
                foreach (var band in (JArray)level["bands"]) {
                    double z = (double)band["z"];
                    Assert.AreEqual((int)band["band"], StationCoordinates.StoreyBand(z, levelBase),
                        "storeyBand(" + z + "," + levelBase + ")");
                }
            }
            foreach (var item in (JArray)oracle["normalizeLevelBase"]) {
                int value = (int)item["value"];
                Assert.AreEqual((int)item["normalized"], StationCoordinates.NormalizeLevelBase(value),
                    "normalizeLevelBase(" + value + ")");
            }
        }

        [Test]
        public void RayToStreetPlaneReportsDocumentSpaceHit() {
            var oracle = LoadOracle();
            foreach (var ray in (JArray)oracle["coordinates"]["rays"]) {
                var origin = (JArray)ray["origin"];
                var direction = (JArray)ray["direction"];
                var unityRay = new Ray(
                    new Vector3((float)origin[0], (float)origin[1], (float)origin[2]),
                    new Vector3((float)direction[0], (float)direction[1], (float)direction[2]));
                bool hit = StationCoordinates.TryRayToDocument(unityRay, out var documentHit);
                var expected = ray["document"];
                if (expected == null || expected.Type == JTokenType.Null) {
                    Assert.IsFalse(hit, "ray must miss the street plane: " + ray);
                    continue;
                }
                Assert.IsTrue(hit, "ray must hit the street plane: " + ray);
                Assert.AreEqual((double)expected[0], documentHit.x, 1e-4);
                Assert.AreEqual((double)expected[1], documentHit.y, 1e-4);
                Assert.AreEqual((double)expected[2], documentHit.z, 1e-4);
            }
        }

        [Test]
        public void FootprintMountAndClearanceMatchTheSourceForEverySampledRecord() {
            var oracle = LoadOracle();
            var comparedTypes = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var documentRow in (JArray)oracle["documents"]) {
                string id = (string)documentRow["id"];
                var read = StationDocumentReader.ReadFile(Path.Combine(DataRoot, "StationDesigner/Demos", id + ".metro.json"));
                Assert.AreEqual((int)documentRow["modules"], read.Document.ModuleCount, id + " module count");
                Assert.AreEqual((int)documentRow["cells"], read.Document.CellCount, id + " cell count");
                int compared = 0;
                foreach (var row in (JArray)documentRow["rows"]) {
                    string moduleId = (string)row["id"];
                    var module = read.Index.GetModule(moduleId);
                    Assert.IsNotNull(module, id + ": module " + moduleId + " is missing from the typed document");
                    string type = (string)row["type"];
                    Assert.AreEqual(type, module.Type);

                    var expectedFootprint = (JArray)row["footprint"];
                    var actualFootprint = StationFootprints.Footprint(module);
                    AssertFootprint(expectedFootprint, actualFootprint, id + "/" + moduleId + " footprint");

                    Assert.AreEqual((string)row["mount"], StationFootprints.MountOf(module).ToString().ToLowerInvariant(),
                        id + "/" + moduleId + " mount");
                    var expectedWall = (JArray)row["wallSide"];
                    StationFootprints.WallSide(module.Rotation, out var wx, out var wy);
                    Assert.AreEqual((int)expectedWall[0], wx, id + "/" + moduleId + " wall side x");
                    Assert.AreEqual((int)expectedWall[1], wy, id + "/" + moduleId + " wall side y");

                    var expectedCourses = ((JArray)row["wallCourses"]).Select(value => (int)value).OrderBy(value => value).ToArray();
                    var actualCourses = StationFootprints.WallCourses(module).OrderBy(value => value).ToArray();
                    CollectionAssert.AreEqual(expectedCourses, actualCourses, id + "/" + moduleId + " wall courses");

                    var expectedClearance = row["clearance"];
                    bool hasClearance = StationFootprints.TryClearance(module, out var box, out var unsupported);
                    if (expectedClearance == null || expectedClearance.Type == JTokenType.Null) {
                        Assert.IsFalse(hasClearance, id + "/" + moduleId + " has no source envelope but one was produced");
                        continue;
                    }
                    if (!hasClearance) {
                        Assert.IsFalse(string.IsNullOrEmpty(unsupported), id + "/" + moduleId + " must say why its envelope is unported");
                        Assert.IsTrue(ClearanceGaps.Contains(type),
                            id + "/" + moduleId + " (" + type + ") reports an unported envelope but its family is claimed as ported: " + unsupported);
                        continue;
                    }
                    var values = (JArray)expectedClearance;
                    if (type == "glass" && StationFootprints.GlassStandsOnFloor(module.Config)) {
                        // Plan 22 §2 intentionally narrowed floor-standing curtain walls from the
                        // pre-Plan-22 0.25 m WallPanelBox band to the rendered 0.10 m leading-edge
                        // glass frame (`StationGlassPanelTests.AFloorStandingCurtainReservesItsRotatedEdgeStrip`).
                        Assert.AreEqual((double)values[2], box.Z0, Tolerance, id + "/" + moduleId + " curtain z0");
                        Assert.AreEqual((double)values[5], box.Z1, Tolerance, id + "/" + moduleId + " curtain z1");
                        Assert.GreaterOrEqual(box.X0, (double)values[0] - Tolerance, id + "/" + moduleId + " curtain x0 within edge band");
                        Assert.LessOrEqual(box.X1, (double)values[3] + Tolerance, id + "/" + moduleId + " curtain x1 within edge band");
                        Assert.GreaterOrEqual(box.Y0, (double)values[1] - Tolerance, id + "/" + moduleId + " curtain y0 within edge band");
                        Assert.LessOrEqual(box.Y1, (double)values[4] + Tolerance, id + "/" + moduleId + " curtain y1 within edge band");
                        double thinSpan = Math.Min(box.X1 - box.X0, box.Y1 - box.Y0);
                        Assert.AreEqual(0.10, thinSpan, Tolerance, id + "/" + moduleId + " curtain frame thickness");
                    } else {
                        Assert.AreEqual((double)values[0], box.X0, Tolerance, id + "/" + moduleId + " box x0");
                        Assert.AreEqual((double)values[1], box.Y0, Tolerance, id + "/" + moduleId + " box y0");
                        Assert.AreEqual((double)values[2], box.Z0, Tolerance, id + "/" + moduleId + " box z0");
                        Assert.AreEqual((double)values[3], box.X1, Tolerance, id + "/" + moduleId + " box x1");
                        Assert.AreEqual((double)values[4], box.Y1, Tolerance, id + "/" + moduleId + " box y1");
                        Assert.AreEqual((double)values[5], box.Z1, Tolerance, id + "/" + moduleId + " box z1");
                    }
                    if (PortedClearance.Contains(type)) {
                        comparedTypes.TryGetValue(type, out var count);
                        comparedTypes[type] = count + 1;
                    }
                    compared++;
                }
                Assert.Greater(compared, 0, id + " oracle rows");
            }
            // Coverage guard: a type this packet claims to own cannot silently stop
            // being compared because TryClearance began refusing it.
            Assert.IsNotEmpty(comparedTypes);
            Assert.IsTrue(comparedTypes.ContainsKey("gate") && comparedTypes.ContainsKey("track") &&
                          comparedTypes.ContainsKey("platform-edge") && comparedTypes.ContainsKey("pillar") &&
                          comparedTypes.ContainsKey("exit") && comparedTypes.ContainsKey("lift"),
                "expected clearance comparisons for the load-bearing families, got: " + string.Join(",", comparedTypes.Keys));
        }

        [Test]
        public void ExitAnchorsMatchTheSourceGeometry() {
            var oracle = LoadOracle();
            foreach (var documentRow in (JArray)oracle["documents"]) {
                string id = (string)documentRow["id"];
                var read = StationDocumentReader.ReadFile(Path.Combine(DataRoot, "StationDesigner/Demos", id + ".metro.json"));
                foreach (var row in (JArray)documentRow["rows"]) {
                    if ((string)row["type"] != "exit") continue;
                    var module = read.Index.GetModule((string)row["id"]);
                    var footprint = StationFootprints.ExitFootprint(module);
                    AssertFootprint((JArray)row["exitFootprint"], footprint, id + "/" + module.Id + " exit footprint");
                }
            }
        }

        static void AssertFootprint(JArray expected, IReadOnlyList<StationPoint> actual, string label) {
            Assert.AreEqual(expected.Count, actual.Count, label + " cell count");
            // Cell coordinates can be fractional (a wide escalator's landings sit at
            // half-cell offsets), so match numerically with a tolerance rather than by
            // formatting each cell into a text key.
            const double tolerance = 1e-6;
            var remaining = new List<double[]>(expected.Count);
            foreach (var cell in expected) {
                remaining.Add(new[] { (double)cell[0], (double)cell[1], (double)cell[2] });
            }
            foreach (var cell in actual) {
                int found = -1;
                for (int i = 0; i < remaining.Count; i++) {
                    var candidate = remaining[i];
                    if (Math.Abs(candidate[0] - cell.X) <= tolerance &&
                        Math.Abs(candidate[1] - cell.Y) <= tolerance &&
                        Math.Abs(candidate[2] - cell.Z) <= tolerance) { found = i; break; }
                }
                Assert.GreaterOrEqual(found, 0, label + " produced cell " + cell.X + "," + cell.Y + "," + cell.Z + " that the source does not have");
                remaining.RemoveAt(found);
            }
            Assert.IsEmpty(remaining, label + " is missing " + remaining.Count + " source cell(s)");
        }
    }
}
