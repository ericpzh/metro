using System;
using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Parity tests for multi-storey, wide, turning, and slope-cut ramps
    /// (<c>three-storey-ramps.test.mjs</c>, <c>escalator-length.test.mjs</c>,
    /// <c>escalators.test.mjs</c>, <c>stairs.test.mjs</c>, <c>check-ramp-fit.mjs</c>):
    /// double/triple-storey escalators and stairs, width-3 geometry/carve/rate scaling,
    /// one-way downward escalator rejection, L-turn/U-turn/forward-split loaded stairs,
    /// live triple-storey crowd traversal, and 6x alternating delete/restore slope-cut rebuilds.
    /// </summary>
    public sealed class StationMultiStoreyRampTests {
        const string PrefabFolder = "Assets/StationDesigner/Generated/Prefabs/";

        readonly List<GameObject> gameObjects = new List<GameObject>();
        readonly List<VerticalModuleView> views = new List<VerticalModuleView>();

        [TearDown]
        public void TearDown() {
            for (int i = 0; i < views.Count; i++) views[i]?.Dispose();
            views.Clear();
            StationEditHost.ResetForTests();
            for (int i = 0; i < gameObjects.Count; i++) {
                if (gameObjects[i] != null) UnityEngine.Object.DestroyImmediate(gameObjects[i]);
            }
            gameObjects.Clear();
            StationEditSession.Reset();
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        /* ---------------------------------------------------------- helpers */

        static (int Dx, int Dy) StairFacing(int rot) {
            switch (((rot % 4) + 4) % 4) {
                case 1: return (1, 0);
                case 2: return (0, -1);
                case 3: return (-1, 0);
                default: return (0, 1);
            }
        }

        static (int Rx, int Ry) StairRight(int rot) {
            var (dx, dy) = StairFacing(rot);
            return (dy, -dx);
        }

        static JObject WrapSave(string name, JArray cells, JArray modules, JArray lines = null) => new JObject {
            ["format"] = StationDocumentReader.SaveFormat,
            ["formatVersion"] = StationDocumentReader.SupportedVersion,
            ["gameVersion"] = "0.2.0",
            ["savedAt"] = StationDocumentReader.FixedSavedAt,
            ["name"] = name, ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 7,
            ["levelBase"] = 0, ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = cells,
                ["modules"] = modules,
                ["lines"] = lines ?? new JArray(),
            },
        };

        static JObject EscalatorJson(string id, int x, int y, int z, int rot, int run, int rise,
            string dir = "up", int width = 1) {
            var (dx, dy) = StairFacing(rot);
            int highX = x + dx * run, highY = y + dy * run, highZ = z + rise;
            bool down = string.Equals(dir, "down", StringComparison.Ordinal);
            return new JObject {
                ["id"] = id, ["type"] = "escalator", ["x"] = x, ["y"] = y, ["z"] = z, ["rot"] = rot,
                ["w"] = 1, ["d"] = 1,
                ["from"] = new JObject { ["x"] = down ? highX : x, ["y"] = down ? highY : y, ["z"] = down ? highZ : z },
                ["to"] = new JObject { ["x"] = down ? x : highX, ["y"] = down ? y : highY, ["z"] = down ? z : highZ },
                ["cfg"] = new JObject { ["incline"] = 30, ["dir"] = dir, ["width"] = width },
            };
        }

        static JObject StraightStairJson(string id, int x, int y, int z, int rot, int run, int rise,
            double width = 0.68) {
            var (dx, dy) = StairFacing(rot);
            int toX = x + dx * run, toY = y + dy * run, toZ = z + rise;
            return new JObject {
                ["id"] = id, ["type"] = "stair", ["x"] = x, ["y"] = y, ["z"] = z, ["rot"] = rot,
                ["w"] = 1, ["d"] = 1,
                ["from"] = new JObject { ["x"] = x, ["y"] = y, ["z"] = z },
                ["to"] = new JObject { ["x"] = toX, ["y"] = toY, ["z"] = toZ },
                ["cfg"] = new JObject {
                    ["width"] = width, ["style"] = "straight",
                    ["flights"] = new JArray {
                        new JObject {
                            ["from"] = new JObject { ["x"] = x, ["y"] = y, ["z"] = z },
                            ["to"] = new JObject { ["x"] = toX, ["y"] = toY, ["z"] = toZ },
                        },
                    },
                },
            };
        }

        static StationIndex ReadIndex(JObject save, out StationDocument doc) {
            var read = StationDocumentReader.Read(save.ToString(Formatting.None), StationSource.None);
            Assert.IsNotNull(read.Document, "document failed to parse");
            doc = read.Document;
            Assert.IsTrue(StationIndex.TryCreate(doc, out var index, out var rejection), rejection?.ToString() ?? "");
            return index;
        }

        static GameObject LoadPrefab(string name) =>
            AssetDatabase.LoadAssetAtPath<GameObject>(PrefabFolder + name + ".prefab");

        VerticalModuleView BuildView(JObject module, GameObject prefab = null, string prefabKey = "") {
            var parent = new GameObject("multi-storey-" + (string)module["id"]);
            gameObjects.Add(parent);
            var request = VerticalModuleRequest.FromFacts(ModuleFactsReader.Read(module), prefab, prefabKey,
                (_, __, ___) => false);
            Assert.IsTrue(VerticalModuleViews.TryBuild(request, parent.transform, out var view),
                "VerticalModuleViews.TryBuild failed for " + (string)module["id"]);
            views.Add(view);
            return view;
        }

        static Vector3 DocPoint(VerticalModuleView view, string part) {
            Assert.IsTrue(view.TryGetPart(part, out var tr), "missing part " + part + " on " + view.ModuleId);
            return StationCoordinates.WorldToDocument(tr.position);
        }

        static StationDayData AlwaysOpenDay() => new StationDayData(
            new DaySpan(0, StationClock.ServiceLatest),
            new PeakSpans(new DaySpan(6 * 3600, 10 * 3600), new DaySpan(17 * 3600, 20 * 3600)),
            new DayDemand(new DemandKnobs(1.0, 0.8, 1), DemandKnobs.DefaultOffday),
            new SimCalendar(new SimDate(2026, 1, 1), Array.Empty<string>()));

        /* ------------------------- double & triple-storey escalators */

        [Test]
        public void DoubleAndTripleStoreyEscalatorsBuildGeometryStepChainCarveSpanAndRoundTrip() {
            var prefab = LoadPrefab("Escalator");
            var grid = StationLevelGrid.FromDocument(0, 5);
            var specs = new (string Label, int Rise, int Run, int BaseZ, int[] ExpectedBands)[] {
                ("double", 10, 18, -10, new[] { -10, 0 }),
                ("triple", 15, 26, -15, new[] { -15, 0 }),
            };

            foreach (var spec in specs) {
                for (int rot = 0; rot < 4; rot++) {
                    var (dx, dy) = StairFacing(rot);
                    foreach (var dir in new[] { "up", "down" }) {
                        string id = $"esc-{spec.Label}-r{rot}-{dir}";
                        var modJson = EscalatorJson(id, 0, 0, spec.BaseZ, rot, spec.Run, spec.Rise, dir, width: 1);

                        // 1. 3D view geometry & step-chain pitch/closure.
                        var view = BuildView(modJson, prefab, "escalator");
                        Assert.IsFalse(view.UsedPrefab, id + " must build dimensionally rather than using 5 m prefab");
                        Assert.AreEqual("dimensions", view.PrefabRejectReason);
                        Assert.Greater(view.StepCount, 40, id + " step chain scales with multi-storey run");
                        Assert.Greater(view.StepPitch, 0.35f, id + " step pitch lower bound");
                        Assert.Less(view.StepPitch, 0.45f, id + " step pitch upper bound");

                        var sizeX = (float)(view.DocumentBounds.X1 - view.DocumentBounds.X0);
                        var sizeY = (float)(view.DocumentBounds.Y1 - view.DocumentBounds.Y0);
                        var sizeZ = (float)(view.DocumentBounds.Z1 - view.DocumentBounds.Z0);
                        float along = dx == 0 ? sizeY : sizeX;
                        Assert.Greater(along, spec.Run, id + " drawn run exceeds authored cell span");
                        Assert.Greater(sizeZ, spec.Rise + 0.9f, id + " drawn height reaches upper handrail");

                        view.Apply(ModuleMotionState.Escalator(id, 0.0, true, 1));
                        var startTread = DocPoint(view, "tread-0");
                        view.Apply(ModuleMotionState.Escalator(id, view.LoopSeconds, true, 1));
                        Assert.LessOrEqual(Vector3.Distance(DocPoint(view, "tread-0"), startTread), 1e-3f,
                            id + " step loop closes exactly after LoopSeconds");

                        // 2. Build corridor reservation, multi-storey level bands, carving + ceiling tag, and save round-trip.
                        var cells = new JArray();
                        // Landing floors at baseZ and topZ plus intermediate slab(s) and a ceiling course above the run.
                        int minX = Math.Min(0, dx * spec.Run) - 1, maxX = Math.Max(0, dx * spec.Run) + 1;
                        int minY = Math.Min(0, dy * spec.Run) - 1, maxY = Math.Max(0, dy * spec.Run) + 1;
                        var slabZs = new List<int> { spec.BaseZ, spec.BaseZ + 5, 0, 5 };
                        if (spec.Rise == 15) slabZs.Add(-5);
                        foreach (int sz in slabZs.Distinct()) {
                            for (int cx = minX; cx <= maxX; cx++)
                                for (int cy = minY; cy <= maxY; cy++)
                                    cells.Add(new JObject { ["x"] = cx, ["y"] = cy, ["z"] = sz, ["fill"] = "solid" });
                        }
                        var save = WrapSave(id, cells, new JArray { modJson });
                        var index = ReadIndex(save, out var doc);
                        Assert.IsTrue(index.TryGetModule(id, out var rec));

                        Assert.IsTrue(StationRampRules.TryEnvelope(rec, out var env, out var unsup), unsup);
                        Assert.AreEqual(spec.Run + 1, dx == 0 ? env.Y1 - env.Y0 : env.X1 - env.X0, 1e-6,
                            id + " envelope spans run + both landings");
                        Assert.AreEqual(spec.BaseZ + 1 - StationRampRules.Foot - StationRampRules.Clear, env.Z0, 1e-6);
                        Assert.AreEqual(0 + 1 + StationRampRules.Headroom + StationRampRules.Clear, env.Z1, 1e-6);

                        CollectionAssert.AreEqual(spec.ExpectedBands, StationModuleLevels.Of(rec, grid),
                            id + " spans lower and upper storey bands");

                        var writes = StationRampCarve.Carve(index);
                        int drops = writes.Count(w => w.Mode == StationCellWriteMode.Remove);
                        Assert.Greater(drops, 0, id + " carves intermediate slabs along its multi-storey climb");
                        Assert.IsTrue(writes.Any(w => w.Tags != null && w.Tags.Contains(StationRampCarve.OpeningCeiling)),
                            id + " tags lowest surviving slab above opened columns as opening-ceiling");
                        // Landings at baseZ and topZ (0) must never be dropped.
                        Assert.IsFalse(writes.Any(w => w.Mode == StationCellWriteMode.Remove && w.Key.X == 0 && w.Key.Y == 0 && w.Key.Z == spec.BaseZ),
                            id + " keeps lower landing solid");
                        Assert.IsFalse(writes.Any(w => w.Mode == StationCellWriteMode.Remove && w.Key.X == dx * spec.Run && w.Key.Y == dy * spec.Run && w.Key.Z == 0),
                            id + " keeps upper landing solid");

                        // Save round-trip preserves exact endpoints and cfg.
                        string rewritten = StationDocumentReader.Write(doc);
                        var reloaded = StationDocumentReader.Read(rewritten, StationSource.None);
                        Assert.IsNotNull(reloaded.Document);
                        var reloadedRec = reloaded.Document.Modules.First(m => m.Id == id);
                        Assert.AreEqual(rec.From.Value.Z, reloadedRec.From.Value.Z, 1e-6);
                        Assert.AreEqual(rec.To.Value.Z, reloadedRec.To.Value.Z, 1e-6);
                        Assert.AreEqual(dir, reloadedRec.Config.Text("dir"));
                    }
                }
            }
        }

        /* ----------------------------- double & triple-storey stairs */

        [Test]
        public void DoubleAndTripleStoreyStairsBuildGeometryCarveCorridorAndRoundTrip() {
            var prefab = LoadPrefab("StairStraight");
            var grid = StationLevelGrid.FromDocument(0, 5);
            var specs = new (string Label, int Rise, int Run, int BaseZ, int[] ExpectedBands)[] {
                ("double", 10, 16, -10, new[] { -10, 0 }),
                ("triple", 15, 24, -15, new[] { -15, 0 }),
            };

            foreach (var spec in specs) {
                for (int rot = 0; rot < 4; rot++) {
                    var (dx, dy) = StairFacing(rot);
                    string id = $"stair-{spec.Label}-r{rot}";
                    var modJson = StraightStairJson(id, 0, 0, spec.BaseZ, rot, spec.Run, spec.Rise, width: 0.68);

                    var view = BuildView(modJson, prefab, "stair-straight");
                    Assert.IsFalse(view.UsedPrefab, id + " multi-storey stair builds procedurally");
                    Assert.AreEqual("dimensions", view.PrefabRejectReason);
                    var sizeX = (float)(view.DocumentBounds.X1 - view.DocumentBounds.X0);
                    var sizeY = (float)(view.DocumentBounds.Y1 - view.DocumentBounds.Y0);
                    var sizeZ = (float)(view.DocumentBounds.Z1 - view.DocumentBounds.Z0);
                    Assert.GreaterOrEqual(dx == 0 ? sizeY : sizeX, spec.Run - 0.5f, id + " drawn run covers flight");
                    Assert.Greater(sizeZ, spec.Rise + 0.9f, id + " drawn height reaches upper handrail");
                    var midTread = DocPoint(view, "tread-sample-0");
                    Assert.AreEqual(spec.BaseZ + 1f + spec.Rise * 0.5f, midTread.z, 0.5f,
                        id + " mid-flight tread sits on the multi-storey walking line");

                    // Carve intermediate slabs + verify opening-ceiling & envelope & round-trip.
                    var cells = new JArray();
                    int minX = Math.Min(0, dx * spec.Run), maxX = Math.Max(0, dx * spec.Run);
                    int minY = Math.Min(0, dy * spec.Run), maxY = Math.Max(0, dy * spec.Run);
                    foreach (int sz in new[] { spec.BaseZ, spec.BaseZ + 5, 0, 5 }.Distinct()) {
                        for (int cx = minX; cx <= maxX; cx++)
                            for (int cy = minY; cy <= maxY; cy++)
                                cells.Add(new JObject { ["x"] = cx, ["y"] = cy, ["z"] = sz, ["fill"] = "solid" });
                    }
                    var index = ReadIndex(WrapSave(id, cells, new JArray { modJson }), out var doc);
                    Assert.IsTrue(index.TryGetModule(id, out var rec));
                    Assert.IsTrue(StationRampRules.TryEnvelope(rec, out var env, out var unsup), unsup);
                    Assert.AreEqual(spec.Run + 1, dx == 0 ? env.Y1 - env.Y0 : env.X1 - env.X0, 1e-6);
                    CollectionAssert.AreEqual(spec.ExpectedBands, StationModuleLevels.Of(rec, grid));

                    var writes = StationRampCarve.Carve(index);
                    Assert.Greater(writes.Count(w => w.Mode == StationCellWriteMode.Remove), 0, id + " carves slabs above its walking line");
                    Assert.IsTrue(writes.Any(w => w.Tags != null && w.Tags.Contains(StationRampCarve.OpeningCeiling)),
                        id + " tags opening ceiling");

                    var reloaded = StationDocumentReader.Read(StationDocumentReader.Write(doc), StationSource.None);
                    var rMod = reloaded.Document.Modules.First(m => m.Id == id);
                    Assert.AreEqual(spec.BaseZ, rMod.From.Value.Z, 1e-6);
                    Assert.AreEqual(0, rMod.To.Value.Z, 1e-6);
                }
            }
        }

        /* ---------------- live crowd traversal z=0 -> z=-15 */

        [Test]
        public void LiveServiceCrowdTraversesTripleStoreyEscalatorFromGradeToMinusFifteen() {
            var cells = new JArray();
            // Grade concourse at z = 0 around the upper landing (x = 26..32, y = 0..4).
            for (int x = 24; x <= 34; x++)
                for (int y = 0; y <= 6; y++)
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid", ["zone"] = "unpaid" });
            // Deep platform at z = -15 around the lower landing (x = -4..4, y = 0..6).
            for (int x = -6; x <= 6; x++)
                for (int y = 0; y <= 6; y++)
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = -15, ["fill"] = "solid", ["zone"] = "paid" });

            var modules = new JArray {
                // Street entrance at z = 0 (spawns riders headed to the deep exit at z = -15).
                new JObject {
                    ["id"] = "exit-street", ["type"] = "exit", ["x"] = 32, ["y"] = 3, ["z"] = 0, ["rot"] = 0,
                    ["cfg"] = new JObject { ["name"] = "A", ["headHouse"] = false, ["inRate"] = 18000, ["open"] = true },
                },
                // Destination exit at z = -15 (inRate 0 so all demand flows downward).
                new JObject {
                    ["id"] = "exit-deep", ["type"] = "exit", ["x"] = -4, ["y"] = 3, ["z"] = -15, ["rot"] = 0,
                    ["cfg"] = new JObject { ["name"] = "B", ["headHouse"] = false, ["inRate"] = 0, ["open"] = true },
                },
                // Triple-storey downward escalator: (26, 3, 0) -> (0, 3, -15), run = 26, rise = 15.
                EscalatorJson("esc-triple-down", 0, 3, -15, rot: 1, run: 26, rise: 15, dir: "down", width: 2),
            };

            var index = ReadIndex(WrapSave("triple-live", cells, modules), out var doc);
            var projected = StationSessionProjection.Document(doc, index);
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = projected,
                Day = AlwaysOpenDay(),
                Seed = 17,
                StartSimTime = 8 * 3600,
                StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                Services = new StationServiceOptions { AlightPerTrain = 0 },
            });

            var escServer = session.WalkGraph.Servers.FirstOrDefault(s => s.Kind == "escalator");
            Assert.IsNotNull(escServer, "triple-storey escalator registers a ride server");
            double expectedSlope = Math.Sqrt(26.0 * 26.0 + 15.0 * 15.0);
            Assert.GreaterOrEqual(escServer.Ride, expectedSlope / StationWalkGraphBuilder.EscalatorSpeed - 1.0,
                "ride time reflects full 3-storey slope length");

            bool reachedDeepFloor = false;
            for (int tick = 0; tick < 180; tick++) {
                session.Advance(1.0);
                foreach (var p in session.PassengerFrames()) {
                    // Floor top of z = -15 is -14.0 m.
                    if (p.Z <= -13.5) { reachedDeepFloor = true; break; }
                }
                if (reachedDeepFloor && escServer.Served > 0) break;
            }
            Assert.Greater(escServer.Served, 0, "passengers boarded and rode the triple-storey escalator");
            Assert.IsTrue(reachedDeepFloor, "live crowd reached the deep z = -15 platform floor");
        }

        /* ---------------- width-3 escalator: view, rate, full 3-wide carve */

        [Test]
        public void WidthThreeEscalatorBuildsThreeMetreViewScalesRateByThreeAndCarvesAllThreeLanes() {
            var prefab = LoadPrefab("Escalator");
            for (int rot = 0; rot < 4; rot++) {
                var (dx, dy) = StairFacing(rot);
                var (rx, ry) = StairRight(rot);
                foreach (var dir in new[] { "up", "down" }) {
                    string id = $"esc-w3-r{rot}-{dir}";
                    var modJson = EscalatorJson(id, 4, 4, 0, rot, run: 9, rise: 5, dir: dir, width: 3);

                    // 1. 3D view geometry across 3 lanes.
                    var view = BuildView(modJson, prefab, "escalator");
                    Assert.IsFalse(view.UsedPrefab, id + " width-3 rejects narrow prefab");
                    float sizeX = (float)(view.DocumentBounds.X1 - view.DocumentBounds.X0);
                    float sizeY = (float)(view.DocumentBounds.Y1 - view.DocumentBounds.Y0);
                    float across = dx == 0 ? sizeX : sizeY;
                    Assert.AreEqual(3.0f, across, 0.12f, id + " drawn width spans all three blocks");

                    // 2. Full 3-wide carving (lanes 0, 1, 2 carved; lanes -1 and +3 untouched).
                    var cells = new JArray();
                    for (int lane = -1; lane <= 3; lane++) {
                        for (int step = 0; step <= 9; step++) {
                            int cx = 4 + dx * step + rx * lane;
                            int cy = 4 + dy * step + ry * lane;
                            cells.Add(new JObject { ["x"] = cx, ["y"] = cy, ["z"] = 0, ["fill"] = "solid" });
                            cells.Add(new JObject { ["x"] = cx, ["y"] = cy, ["z"] = 4, ["fill"] = "solid" });
                            cells.Add(new JObject { ["x"] = cx, ["y"] = cy, ["z"] = 5, ["fill"] = "solid" });
                        }
                    }
                    var index = ReadIndex(WrapSave(id, cells, new JArray { modJson }), out var doc);
                    Assert.IsTrue(index.TryGetModule(id, out var rec));
                    var runObj = StationRampCarve.ForModule(rec);
                    Assert.IsNotNull(runObj);
                    Assert.AreEqual(1.5, runObj.CoreHalf, 1e-6, id + " width-3 CoreHalf is 1.5 blocks");

                    var writes = StationRampCarve.Carve(index);
                    var dropped = new HashSet<StationCellKey>(writes.Where(w => w.Mode == StationCellWriteMode.Remove).Select(w => w.Key));
                    // Mid-run cell at step=5, z=4 sits above walking line (h = 1 + 5*5/9 ≈ 3.78, c.Z+1=5 > 3.80, c.Z=4 < 3.78+2.2).
                    for (int lane = 0; lane <= 2; lane++) {
                        var key = new StationCellKey(4 + dx * 5 + rx * lane, 4 + dy * 5 + ry * lane, 4);
                        Assert.IsTrue(dropped.Contains(key), $"{id}: lane {lane} cell {key} must be carved");
                    }
                    foreach (int outside in new[] { -1, 3 }) {
                        var key = new StationCellKey(4 + dx * 5 + rx * outside, 4 + dy * 5 + ry * outside, 4);
                        Assert.IsFalse(dropped.Contains(key), $"{id}: outside lane {outside} cell {key} must stay solid");
                    }

                    // 3. Walk-graph rate scaling (3x single-lane EscalatorRate).
                    var projected = StationSessionProjection.Document(doc, index);
                    var graph = StationWalkGraphBuilder.Build(projected, new StationWalkGraphOptions { IncludeGround = false });
                    var server = graph.Servers.FirstOrDefault(s => s.Kind == "escalator");
                    Assert.IsNotNull(server, id + " walk-graph server missing");
                    Assert.AreEqual(StationWalkGraphBuilder.EscalatorRate * 3.0, server.Rate, 1e-6,
                        id + " width-3 escalator scales throughput by 3x");
                }
            }
        }

        /* ---------------- downward escalator rejects upward routing */

        [Test]
        public void DownwardEscalatorRoutesDownAndRejectsUpwardTraversal() {
            var cells = new JArray();
            for (int x = 0; x <= 14; x++) {
                for (int y = 0; y <= 4; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 5, ["fill"] = "solid" });
                }
            }
            // Downward escalator from (11, 2, 5) down to (2, 2, 0).
            var downEsc = EscalatorJson("esc-down-only", 2, 2, 0, rot: 1, run: 9, rise: 5, dir: "down", width: 1);
            var index = ReadIndex(WrapSave("down-only", cells, new JArray { downEsc }), out var doc);
            var projected = StationSessionProjection.Document(doc, index);
            var graph = StationWalkGraphBuilder.Build(projected, new StationWalkGraphOptions { IncludeGround = false });
            var planner = new StationRoutePlanner(graph);

            var downRoute = planner.Search("13,2,5", "0,2,0", StationRouteNeeds.Walking);
            Assert.IsTrue(downRoute.Found, "downward route uses the downward escalator");
            Assert.IsTrue(downRoute.Kinds.Contains(WalkEdgeKind.Escalator), "route rides the escalator edge");

            var upRoute = planner.Search("0,2,0", "13,2,5", StationRouteNeeds.Walking);
            Assert.IsFalse(upRoute.Found, "upward routing must reject a downward-only escalator");
        }

        /* ------- wide straight / L-turn / U-turn / forward-split stairs */

        [Test]
        public void WideStraightLTurnUTurnAndForwardSplitStairsBuildGeometryCarveAndScaleCapacity() {
            // 1. Wide straight stairs (2-lane 1.36 m and 3-lane 2.04 m): view width, full carve width, and scaled capacity.
            foreach (var (width, lanes) in new[] { (1.36, 2), (2.04, 3) }) {
                string id = $"stair-wide-{lanes}";
                var modJson = StraightStairJson(id, 4, 2, 0, rot: 0, run: 8, rise: 5, width: width);
                var view = BuildView(modJson);
                Assert.AreEqual(lanes, (float)(view.DocumentBounds.X1 - view.DocumentBounds.X0), 0.08f,
                    id + " rendered width fills all blocks");

                var cells = new JArray();
                for (int cx = 2; cx <= 8; cx++) {
                    for (int cy = 0; cy <= 12; cy++) {
                        cells.Add(new JObject { ["x"] = cx, ["y"] = cy, ["z"] = 0, ["fill"] = "solid" });
                        cells.Add(new JObject { ["x"] = cx, ["y"] = cy, ["z"] = 4, ["fill"] = "solid" });
                        cells.Add(new JObject { ["x"] = cx, ["y"] = cy, ["z"] = 5, ["fill"] = "solid" });
                    }
                }
                var index = ReadIndex(WrapSave(id, cells, new JArray { modJson }), out var doc);
                Assert.IsTrue(index.TryGetModule(id, out var rec));
                var runs = StationRampCarve.RunsFor(rec);
                Assert.AreEqual(1, runs.Count);
                Assert.AreEqual(lanes / 2.0, runs[0].CoreHalf, 1e-6, id + " CoreHalf matches lane count");

                var dropped = new HashSet<StationCellKey>(
                    StationRampCarve.Carve(index).Where(w => w.Mode == StationCellWriteMode.Remove).Select(w => w.Key));
                // At y = 7 (t = 5/8 = 0.625, h = 1 + 3.125 = 4.125), z = 4 (c.Z+1=5 > 4.145, c.Z=4 < 5.425) is carved across all lanes.
                for (int lane = 0; lane < lanes; lane++) {
                    Assert.IsTrue(dropped.Contains(new StationCellKey(4 + lane, 7, 4)),
                        $"{id}: lane {lane} carved at (x={4 + lane}, y=7, z=4)");
                }
                Assert.IsFalse(dropped.Contains(new StationCellKey(3, 7, 4)), id + " west outside lane stays solid");
                Assert.IsFalse(dropped.Contains(new StationCellKey(4 + lanes, 7, 4)), id + " east outside lane stays solid");

                var projected = StationSessionProjection.Document(doc, index);
                var graph = StationWalkGraphBuilder.Build(projected, new StationWalkGraphOptions { IncludeGround = false });
                var stairServers = graph.Servers.Where(s => s.Kind == "stair").ToList();
                Assert.AreEqual(2, stairServers.Count, id + " bidirectional stair servers");
                double upRate = stairServers.First(s => graph.NodeZ[s.Node] < graph.NodeZ[s.ExitNode]).Rate;
                double downRate = stairServers.First(s => graph.NodeZ[s.Node] > graph.NodeZ[s.ExitNode]).Rate;
                Assert.AreEqual(StationWalkGraphBuilder.StairRateUp * width, upRate, 1e-6, id + " upward capacity scales with width");
                Assert.AreEqual(StationWalkGraphBuilder.StairRateDown * width, downRate, 1e-6, id + " downward capacity scales with width");
            }

            // 2. Loaded turning & forward-split stairs: L-turn (right90), U-turn (right180), forward-split (rightForward & centerForward).
            var multiFlightCases = new (string Style, JArray Flights, (int X, int Y, int Z) From, (int X, int Y, int Z) To)[] {
                ("right90", new JArray {
                    new JObject { ["from"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 0 }, ["to"] = new JObject { ["x"] = 4, ["y"] = 8, ["z"] = 2.5 } },
                    new JObject { ["from"] = new JObject { ["x"] = 5, ["y"] = 8, ["z"] = 2.5 }, ["to"] = new JObject { ["x"] = 9, ["y"] = 8, ["z"] = 5 } },
                }, (4, 4, 0), (9, 8, 5)),
                ("right180", new JArray {
                    new JObject { ["from"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 0 }, ["to"] = new JObject { ["x"] = 4, ["y"] = 8, ["z"] = 2.5 } },
                    new JObject { ["from"] = new JObject { ["x"] = 6, ["y"] = 8, ["z"] = 2.5 }, ["to"] = new JObject { ["x"] = 6, ["y"] = 4, ["z"] = 5 } },
                }, (4, 4, 0), (6, 4, 5)),
                ("rightForward", new JArray {
                    new JObject { ["from"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 0 }, ["to"] = new JObject { ["x"] = 4, ["y"] = 8, ["z"] = 2.5 } },
                    new JObject { ["from"] = new JObject { ["x"] = 6, ["y"] = 8, ["z"] = 2.5 }, ["to"] = new JObject { ["x"] = 6, ["y"] = 12, ["z"] = 5 } },
                }, (4, 4, 0), (6, 12, 5)),
                ("centerForward", new JArray {
                    new JObject { ["from"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 0 }, ["to"] = new JObject { ["x"] = 4, ["y"] = 8, ["z"] = 2.5 } },
                    new JObject { ["from"] = new JObject { ["x"] = 4, ["y"] = 9, ["z"] = 2.5 }, ["to"] = new JObject { ["x"] = 4, ["y"] = 13, ["z"] = 5 } },
                }, (4, 4, 0), (4, 13, 5)),
            };

            foreach (var tc in multiFlightCases) {
                string id = "stair-" + tc.Style;
                var modJson = new JObject {
                    ["id"] = id, ["type"] = "stair", ["x"] = tc.From.X, ["y"] = tc.From.Y, ["z"] = tc.From.Z,
                    ["rot"] = 0, ["w"] = 1, ["d"] = 1,
                    ["from"] = new JObject { ["x"] = tc.From.X, ["y"] = tc.From.Y, ["z"] = tc.From.Z },
                    ["to"] = new JObject { ["x"] = tc.To.X, ["y"] = tc.To.Y, ["z"] = tc.To.Z },
                    ["cfg"] = new JObject { ["width"] = 1.79, ["style"] = tc.Style, ["flights"] = tc.Flights },
                };

                var view = BuildView(modJson);
                Assert.IsTrue(view.TryGetPart("flight-0", out _), id + " builds first flight");
                Assert.IsTrue(view.TryGetPart("flight-1", out _), id + " builds second flight");
                Assert.IsTrue(view.TryGetPart("turn-landing", out _), id + " builds intermediate landing");
                Assert.Greater(view.DocumentBounds.Z1 - view.DocumentBounds.Z0, 5.5, id + " spans full rise + rail");

                var cells = new JArray();
                for (int x = 0; x <= 14; x++) {
                    for (int y = 0; y <= 16; y++) {
                        cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                        cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 5, ["fill"] = "solid" });
                    }
                }
                var index = ReadIndex(WrapSave(id, cells, new JArray { modJson }), out var doc);
                Assert.IsTrue(index.TryGetModule(id, out var rec));
                Assert.IsTrue(StationRampRules.TryEnvelope(rec, out var env, out var unsup), unsup);
                Assert.Greater(env.Z1 - env.Z0, 6.0, id + " multi-flight envelope spans full storey");
                Assert.AreEqual(2, StationRampCarve.RunsFor(rec).Count, id + " yields one carve run per flight");

                var projected = StationSessionProjection.Document(doc, index);
                var graph = StationWalkGraphBuilder.Build(projected, new StationWalkGraphOptions { IncludeGround = false });
                var servers = graph.Servers.Where(s => s.Kind == "stair").ToList();
                Assert.AreEqual(2, servers.Count, id + " bidirectional walk-graph edges");
                Assert.IsTrue(servers.All(s => s.StairFlights == 2), id + " reports 2 stair flights");
            }
        }

        /* ------- 6x alternating ramp delete/restore slope-cut rebuild (check-ramp-fit.mjs) */

        [Test]
        public void SixAlternatingRampDeleteAndRestoreCommitsRebuildSlopeCutsCleanly() {
            var esc = EscalatorJson("escalator", 0, 0, 0, rot: 0, run: 9, rise: 5, dir: "up", width: 3);
            var stair = StraightStairJson("stair", 5, 0, 0, rot: 0, run: 8, rise: 5, width: 2.04);
            var initialFacts = new List<ModuleFacts> { ModuleFactsReader.Read(esc), ModuleFactsReader.Read(stair) };
            var expectedFullCuts = StationRampOpenings.RampSlopeCuts(initialFacts);
            Assert.Greater(expectedFullCuts.Count, 20, "wide escalator + wide stair generate rich slope cuts");

            var cellMap = new Dictionary<StationCellKey, JObject>();
            foreach (var key in expectedFullCuts.Keys) {
                for (int z = 0; z <= key.Z; z++) {
                    var k = new StationCellKey(key.X, key.Y, z);
                    if (!cellMap.ContainsKey(k))
                        cellMap[k] = new JObject { ["x"] = k.X, ["y"] = k.Y, ["z"] = k.Z, ["fill"] = "solid" };
                }
            }
            for (int x = -2; x <= 9; x++) {
                for (int y = -1; y <= 11; y++) {
                    var k = new StationCellKey(x, y, 0);
                    if (!cellMap.ContainsKey(k))
                        cellMap[k] = new JObject { ["x"] = k.X, ["y"] = k.Y, ["z"] = 0, ["fill"] = "solid" };
                }
            }
            var cells = new JArray(cellMap.Values);
            var save = WrapSave("ramp-fit", cells, new JArray { esc, stair });

            var hostObject = new GameObject(StationGameHost.ObjectName);
            gameObjects.Add(hostObject);
            var host = hostObject.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(host, null);
            var opened = host.OpenDocument(save.ToString(Formatting.None), "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());

            var expectedEscOnlyCuts = StationRampOpenings.RampSlopeCuts(new List<ModuleFacts> { initialFacts[0] });
            Assert.Less(expectedEscOnlyCuts.Count, expectedFullCuts.Count, "deleting the wide stair reduces slope cuts");

            var stairDraft = StationModulePlacement.DraftOf(host.Index.GetModule("stair"));

            for (int cycle = 0; cycle < 6; cycle++) {
                bool deleting = cycle % 2 == 0;
                if (deleting) {
                    Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Remove, null, "stair",
                        "delete stair", null, out _, out var delCode), delCode);
                } else {
                    Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, stairDraft, null,
                        "restore stair", null, out _, out var addCode), addCode);
                }

                var liveCuts = StationRampOpenings.RampSlopeCuts(host.Document.Modules);
                var expected = deleting ? expectedEscOnlyCuts : expectedFullCuts;
                Assert.AreEqual(expected.Count, liveCuts.Count,
                    $"cycle {cycle} ({(deleting ? "delete" : "restore")}): slope-cut cell count must match exactly");
                CollectionAssert.AreEquivalent(expected.Keys, liveCuts.Keys,
                    $"cycle {cycle}: slope-cut keys match without stale residue");

                // Rebuild cell meshes through StationCellMeshWorkspace to confirm clean slope-cut meshing.
                var input = StationCellRenderer.BuildInput(host.Document, null, null, null);
                var unthinned = new Dictionary<StationCellKey, StationCellShape>(host.Document.Cells.Count);
                foreach (var c in host.Document.Cells) {
                    if (c.IsSolid) unthinned[c.Key] = StationCellRules.ShapeOf(c.Tags);
                }
                var ws = StationCellMeshWorkspace.Create(input, StationRampOpenings.PrepareOpenings(host.Index), unthinned);
                var meshed = ws.MeshAll();
                Assert.Greater(meshed.Count, 0, $"cycle {cycle}: chunk mesh rebuilt cleanly");
            }
        }
    }
}
