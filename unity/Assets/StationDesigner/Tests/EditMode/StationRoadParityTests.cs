using System;
using System.Collections.Generic;
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
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Domain D4 road parity suite: walk-graph exclusion and walker relocation, road surface
    /// validation (including mid-span track, void, air, width, solid-above, module-envelope and
    /// authored track footprints), road tool gestures and network editing, family delete on legacy
    /// segments, signal timings, metered traffic invariants, markings and promoted vehicle LODs.
    /// </summary>
    public sealed class StationRoadParityTests {
        readonly List<UnityEngine.Object> cleanupObjects = new List<UnityEngine.Object>();

        [TearDown]
        public void TearDown() {
            for (int i = cleanupObjects.Count - 1; i >= 0; i--) {
                if (cleanupObjects[i] != null) UnityEngine.Object.DestroyImmediate(cleanupObjects[i]);
            }
            cleanupObjects.Clear();
            StationSectionDrag.Reset();
            StationEditHost.ResetForTests();
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationRoadTool.Reset();
            StationCellTool.Reset();
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationFrameSinks.Clear();
            StationCommandHandlers.Clear();
        }

        T Track<T>(T obj) where T : UnityEngine.Object {
            if (obj != null) cleanupObjects.Add(obj);
            return obj;
        }

        static string FloorSave(int width = 60, int depth = 40, JArray extraCells = null,
            JArray modules = null, JArray lines = null, string name = "road-parity") {
            var cells = new JArray();
            for (int x = 0; x < width; x++) {
                for (int y = 0; y < depth; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            if (extraCells != null) {
                foreach (var c in extraCells) cells.Add(c);
            }
            return new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = name,
                ["nameEn"] = "",
                ["city"] = "guangzhou",
                ["seed"] = 1234567,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = cells,
                    ["modules"] = modules ?? new JArray(),
                    ["lines"] = lines ?? new JArray(),
                },
            }.ToString(Formatting.None);
        }

        StationGameHost CreateHost(string saveJson) {
            StationEditSession.Reset();
            StationRoadTool.Reset();
            StationToolSelection.Reset();
            var go = Track(new GameObject(StationGameHost.ObjectName));
            var host = go.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake",
                BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(awake);
            awake.Invoke(host, null);
            var opened = host.OpenDocument(saveJson, "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            return host;
        }

        static StationRoadRecord Road(string id, int x, int y, double z, int w, int d, int rot,
            string direction = "two-way", RoadPosition? from = null, RoadPosition? to = null) {
            var r = StationRoadRecord.Create(id, x, y, z, w, d, rot, direction);
            if (from.HasValue) { r.HasFrom = true; r.From = from.Value; }
            if (to.HasValue) { r.HasTo = true; r.To = to.Value; }
            return r;
        }

        static Shader TestShader() =>
            Shader.Find("Universal Render Pipeline/Lit")
            ?? Shader.Find("Universal Render Pipeline/Unlit")
            ?? Shader.Find("Unlit/Color")
            ?? Shader.Find("Sprites/Default");

        sealed class StubSurfaceContext : IRoadSurfaceContext {
            public Func<int, int, double, bool> SolidFn = (_, _, z) => z == 0;
            public Func<int, int, double, bool> ExitFloorFn = (_, _, _) => false;
            public Func<int, int, double, bool> GroundHoleFn = (_, _, _) => false;
            public Func<int, int, double, bool> TrackFn = (_, _, _) => false;
            public Func<StationRoadRecord, bool> OverlapFn = _ => false;

            public bool IsSolid(int x, int y, double z) => SolidFn(x, y, z);
            public bool IsExitFloor(int x, int y, double z) => ExitFloorFn(x, y, z);
            public bool IsGroundHole(int x, int y, double z) => GroundHoleFn(x, y, z);
            public bool IsTrack(int x, int y, double z) => TrackFn(x, y, z);
            public bool OverlapsModuleEnvelope(StationRoadRecord candidate) => OverlapFn(candidate);
        }

        /* --------------------------------- 1. Road vs crowd exclusion & relocation */

        [Test]
        public void WalkGraphExcludesAllRoadCellsWhileKeepingAdjacentAndUpperStoreyWalkable() {
            var doc = new StationSessionDocument { StationId = "road-walk-excl", LevelBase = 0 };
            for (int x = 0; x < 16; x++) {
                for (int y = 0; y < 18; y++) {
                    doc.Cells.Add(new StationCellFact { X = x, Y = y, Z = 0, Solid = true, Zone = 2, Speed = 1 });
                    doc.Cells.Add(new StationCellFact { X = x, Y = y, Z = 5, Solid = true, Zone = 2, Speed = 1 });
                }
            }
            doc.Modules.Add(new StationModuleFact {
                Id = "road-1", Type = "road", X = 4, Y = 4, Z = 0, Rot = 0, Width = 6, Depth = 10,
            });

            var graph = StationWalkGraphBuilder.Build(doc);

            // Every cell inside the road rectangle on z = 0 is excluded.
            for (int x = 4; x < 10; x++) {
                for (int y = 4; y < 14; y++) {
                    Assert.IsFalse(graph.TryNode(x, y, 0, out _), $"road cell ({x},{y},0) must not be walkable");
                    // Upper storey (z = 5) directly above the road stays walkable.
                    Assert.IsTrue(graph.TryNode(x, y, 5, out _), $"upper storey ({x},{y},5) above road stays walkable");
                }
            }
            // Adjacent sidewalk cells remain walkable.
            Assert.IsTrue(graph.TryNode(3, 8, 0, out _), "west sidewalk stays walkable");
            Assert.IsTrue(graph.TryNode(10, 8, 0, out _), "east sidewalk stays walkable");
            Assert.IsTrue(graph.TryNode(6, 3, 0, out _), "south sidewalk stays walkable");
            Assert.IsTrue(graph.TryNode(6, 14, 0, out _), "north sidewalk stays walkable");
        }

        [Test]
        public void ServiceRuntimeNeverPushesWalkersOntoRoadDuringSeparationAndRelocatesOffNewlyPlacedRoad() {
            // Part A: StationRoadLayout.MoveClear clips movement segments across road borders on z = 0 only.
            var roadList = new[] { Road("r1", 10, 2, 0, 6, 12, 0, "two-way") };
            Assert.IsFalse(StationRoadLayout.MoveClear(roadList, 9.5, 6.5, 10.5, 6.5, 0),
                "step crossing into road must be blocked");
            Assert.IsFalse(StationRoadLayout.MoveClear(roadList, 8.0, 6.5, 18.0, 6.5, 0),
                "segment spanning road must be blocked");
            Assert.IsTrue(StationRoadLayout.MoveClear(roadList, 8.5, 6.5, 9.5, 6.5, 0),
                "step staying on sidewalk is clear");
            Assert.IsTrue(StationRoadLayout.MoveClear(roadList, 9.5, 6.5, 10.5, 6.5, 5),
                "upper storey crossing above road is clear");

            // Part B: Dense crowd walking alongside a road never gets pushed onto the road during separation.
            StationSessionDocument SidewalkWithRoad(bool includeCenterRoad) {
                var doc = new StationSessionDocument { StationId = "road-crowd", LevelBase = 0 };
                for (int x = 0; x < 24; x++) {
                    for (int y = 0; y < 14; y++) {
                        doc.Cells.Add(new StationCellFact { X = x, Y = y, Z = 0, Solid = true, Zone = 2, Speed = 1 });
                    }
                }
                doc.Modules.Add(new StationModuleFact {
                    Id = "exit-a", Type = "exit", X = 2, Y = 2, Z = 0, Name = "A",
                    HasExitInRate = true, ExitInRate = 3600,
                });
                doc.Modules.Add(new StationModuleFact {
                    Id = "exit-b", Type = "exit", X = 20, Y = 2, Z = 0, Name = "B",
                    HasExitInRate = true, ExitInRate = 3600,
                });
                // Road right next to the sidewalk (y = 4..9).
                doc.Modules.Add(new StationModuleFact {
                    Id = "road-side", Type = "road", X = 0, Y = 4, Z = 0, Rot = 1, Width = 24, Depth = 6,
                });
                if (includeCenterRoad) {
                    // Newly placed road cutting across the sidewalk where walkers stand (x = 7..12, y = 0..5).
                    doc.Modules.Add(new StationModuleFact {
                        Id = "road-new", Type = "road", X = 7, Y = 0, Z = 0, Rot = 0, Width = 6, Depth = 6,
                    });
                }
                return doc;
            }

            var initialDoc = SidewalkWithRoad(includeCenterRoad: false);
            var sideRoadRect = new[] { Road("road-side", 0, 4, 0, 24, 6, 1, "two-way") };
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = initialDoc,
                Day = StationDayData.Default,
                Seed = 314,
                StartSimTime = StationClock.ReferenceBootSeconds,
                StartPlaying = true,
                Services = new StationServiceOptions { Spawn = true },
            });

            bool sawWalkersNearMiddle = false;
            for (int tick = 0; tick < 45; tick++) {
                session.Advance(1.0);
                var frames = session.PassengerFrames();
                foreach (var p in frames) {
                    Assert.IsFalse(StationRoadLayout.ContainsPoint(sideRoadRect, p.X, p.Y, 0),
                        $"tick {tick}: walker {p.SimId} at ({p.X:0.##},{p.Y:0.##}) was pushed onto adjacent road");
                    if (p.X >= 7 && p.X < 13 && p.Y >= 0 && p.Y < 4) sawWalkersNearMiddle = true;
                }
            }
            Assert.IsTrue(sawWalkersNearMiddle, "walkers should traverse the sidewalk corridor before road placement");

            // Part C: Place a new road right across the middle of the active sidewalk -> structural edit
            // must relocate every walker off the newly placed road rectangle.
            var editedDoc = SidewalkWithRoad(includeCenterRoad: true);
            var bothRoadRects = new[] {
                Road("road-side", 0, 4, 0, 24, 6, 1, "two-way"),
                Road("road-new", 7, 0, 0, 6, 6, 0, "two-way"),
            };
            var staged = session.StageDocumentEdit(editedDoc, StationDayData.Default, StationDocumentEditKind.Structural);
            session.CommitDocumentEdit(staged);

            var afterFrames = session.PassengerFrames();
            Assert.Greater(afterFrames.Length, 0, "relocated walkers remain active on remaining sidewalk");
            foreach (var p in afterFrames) {
                Assert.IsFalse(StationRoadLayout.ContainsPoint(bothRoadRects, p.X, p.Y, 0),
                    $"walker {p.SimId} at ({p.X:0.##},{p.Y:0.##}) remained inside newly placed road after structural edit");
            }
        }

        /* ---------------------------------------- 2. Road surface validation */

        [Test]
        public void SurfaceReasonDetectsMidSpanTrackVoidHoleElevatedAirNarrowTwoWaySolidAboveAndAllowsCrossings() {
            // Horizontal 12 m × 6 m road at (0, 0, 0).
            var horizontal = Road("cand", 0, 0, 0, 12, 6, 1, "two-way");

            // 1. Mid-span track at r.Z (NOT origin (0,0)!) -> Track.
            var midTrackSameZ = new StubSurfaceContext {
                TrackFn = (x, y, z) => x == 6 && y == 3 && z == 0,
            };
            Assert.AreEqual(RoadSurfaceReason.Track, StationRoadLayout.SurfaceReason(horizontal, midTrackSameZ),
                "mid-span track at r.Z must be detected, not just origin");
            Assert.AreEqual("track", StationRoadLayout.PlacementRefusal(horizontal, midTrackSameZ));

            // 2. Mid-span track at r.Z + 1 (NOT origin (0,0)!) -> Track.
            var midTrackAboveZ = new StubSurfaceContext {
                TrackFn = (x, y, z) => x == 9 && y == 2 && z == 1,
            };
            Assert.AreEqual(RoadSurfaceReason.Track, StationRoadLayout.SurfaceReason(horizontal, midTrackAboveZ),
                "mid-span track at r.Z + 1 must be detected");
            Assert.AreEqual("track", StationRoadLayout.PlacementRefusal(horizontal, midTrackAboveZ));

            // 3. Void hole mid-span on z = 0 -> Ground ("road-ground").
            var voidHole = new StubSurfaceContext {
                SolidFn = (x, y, z) => z == 0 && !(x == 5 && y == 2),
                GroundHoleFn = (x, y, z) => z == 0 && x == 5 && y == 2,
            };
            Assert.AreEqual(RoadSurfaceReason.Ground, StationRoadLayout.SurfaceReason(horizontal, voidHole));
            Assert.AreEqual("road-ground", StationRoadLayout.PlacementRefusal(horizontal, voidHole));

            // 4. Elevated z = 4 air (no solid deck at z = 4) -> Ground ("road-ground").
            var airRoad = Road("air", 0, 0, 4, 12, 6, 1, "two-way");
            var emptyAir = new StubSurfaceContext { SolidFn = (_, _, _) => false };
            Assert.AreEqual(RoadSurfaceReason.Ground, StationRoadLayout.SurfaceReason(airRoad, emptyAir));
            Assert.AreEqual("road-ground", StationRoadLayout.PlacementRefusal(airRoad, emptyAir));

            // 5. Narrow w = 5 two-way -> "road-width" (needs >= 6 m for 2 lanes), while w = 6 succeeds and w = 3 one-way succeeds.
            var narrowTwoWay = Road("narrow", 0, 0, 0, 5, 12, 0, "two-way");
            var clean = new StubSurfaceContext();
            Assert.AreEqual("road-width", StationRoadLayout.PlacementRefusal(narrowTwoWay, clean),
                "5 m two-way road must be refused with road-width");
            Assert.IsNull(StationRoadLayout.PlacementRefusal(Road("ok-two", 0, 0, 0, 6, 12, 0, "two-way"), clean));
            Assert.IsNull(StationRoadLayout.PlacementRefusal(Road("ok-one", 0, 0, 0, 3, 12, 0, "one-way"), clean));

            // 6. Solid block above road (dz = 1..4) -> Occupied ("occupied").
            foreach (int dz in new[] { 1, 2, 3, 4 }) {
                var overhead = new StubSurfaceContext {
                    SolidFn = (x, y, z) => z == 0 || (x == 4 && y == 2 && z == dz),
                };
                Assert.AreEqual(RoadSurfaceReason.Occupied, StationRoadLayout.SurfaceReason(horizontal, overhead),
                    "solid at z+" + dz + " must report Occupied");
                Assert.AreEqual("occupied", StationRoadLayout.PlacementRefusal(horizontal, overhead));
            }

            // 7. Allowed road crossings: clean ground + another road already present returns None.
            Assert.AreEqual(RoadSurfaceReason.None, StationRoadLayout.SurfaceReason(horizontal, clean));
            Assert.IsNull(StationRoadLayout.PlacementRefusal(horizontal, clean));
            var existingGraph = StationRoadDocument.Read(new[] { Road("r-ns", 4, -6, 0, 6, 18, 0, "two-way") });
            var crossPreview = StationRoadEdits.Preview(existingGraph, new RoadEditRequest {
                mode = "add", z = 0, from = new[] { 0.0, 3.0 }, to = new[] { 14.0, 3.0 },
                width = 6, direction = "two-way", rot = 0,
            }, clean);
            Assert.IsTrue(crossPreview.Valid, "crossing an existing road on valid ground is allowed: " + crossPreview.Code);
        }

        [Test]
        public void RoadEditServiceAndCommandHandlerValidateAuthoredTrackFootprintsExitFloorsAndModuleEnvelopes() {
            // 1. Authored track module mid-span at z = 1 (above street, NO floor.track cell finish!) -> "track".
            var authoredTrackModules = new JArray {
                new JObject {
                    ["id"] = "track-overhead", ["type"] = "track",
                    ["x"] = 20, ["y"] = 10, ["z"] = 1, ["w"] = 12, ["d"] = 3, ["rot"] = 1,
                    ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up", ["power"] = "third-rail", ["bridge"] = true },
                },
            };
            var hostTrack = CreateHost(FloorSave(modules: authoredTrackModules, name: "authored-track"));
            Assert.IsFalse(StationRoadEditService.TryPreview(hostTrack, new RoadEditRequest {
                mode = "add", z = 0, from = new[] { 10.0, 15.0 }, to = new[] { 30.0, 15.0 },
                width = 6, direction = "two-way", rot = 0,
            }, out _, out var trackCode));
            Assert.AreEqual("track", trackCode, "SurfaceFacts.IsTrack must catch mid-span authored track modules");

            // 2. Module envelope overlap (bench standing mid-span on road deck) -> "occupied".
            var benchModules = new JArray {
                new JObject {
                    ["id"] = "bench-1", ["type"] = "bench",
                    ["x"] = 20, ["y"] = 15, ["z"] = 0, ["rot"] = 0, ["cfg"] = new JObject(),
                },
            };
            var hostBench = CreateHost(FloorSave(modules: benchModules, name: "bench-overlap"));
            Assert.IsFalse(StationRoadEditService.TryPreview(hostBench, new RoadEditRequest {
                mode = "add", z = 0, from = new[] { 10.0, 15.0 }, to = new[] { 30.0, 15.0 },
                width = 6, direction = "two-way", rot = 0,
            }, out _, out var benchCode));
            Assert.AreEqual("occupied", benchCode, "SurfaceFacts.OverlapsModuleEnvelope must refuse road over bench");

            // 3. Exit head-house overlap at z = 0 -> "occupied".
            var exitModules = new JArray {
                new JObject {
                    ["id"] = "exit-1", ["type"] = "exit",
                    ["x"] = 20, ["y"] = 15, ["z"] = 0, ["rot"] = 0,
                    ["cfg"] = new JObject { ["name"] = "A" },
                },
            };
            var hostExit = CreateHost(FloorSave(modules: exitModules, name: "exit-overlap"));
            Assert.IsFalse(StationRoadEditService.TryPreview(hostExit, new RoadEditRequest {
                mode = "add", z = 0, from = new[] { 10.0, 15.0 }, to = new[] { 30.0, 15.0 },
                width = 6, direction = "two-way", rot = 0,
            }, out _, out var exitCode));
            Assert.AreEqual("occupied", exitCode, "road running through an exit head-house must be refused");

            // 4. StationRoadCommandHandler road.preview catches mid-span floor.track cell (NOT at origin!).
            var cellsWithMidTrack = new JArray();
            for (int x = 0; x < 40; x++) {
                for (int y = 0; y < 30; y++) {
                    var cell = new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" };
                    if (x == 22 && y == 15) cell["finish"] = new JObject { ["top"] = "floor.track" };
                    cellsWithMidTrack.Add(cell);
                }
            }
            var trackCellSave = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "cmd-mid-track", ["city"] = "guangzhou", ["seed"] = 7,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = cellsWithMidTrack, ["modules"] = new JArray(), ["lines"] = new JArray(),
                },
            }.ToString(Formatting.None);
            var read = StationDocumentReader.Read(trackCellSave, new StationSource("cmd-mid-track", ""));
            Assert.IsNotNull(read?.Document);
            var handler = new StationRoadCommandHandler(() => read.Document, () => 1);
            var cmd = new StationCommand {
                Type = "road.preview",
                Payload = new JObject {
                    ["mode"] = "add", ["z"] = 0,
                    ["from"] = new JArray(10, 15), ["to"] = new JArray(30, 15),
                    ["width"] = 6, ["direction"] = "two-way", ["rot"] = 0,
                },
            };
            var reply = new JObject();
            Assert.IsTrue(handler.TryHandle(cmd, reply, out var rejCode, out var rejReason), rejCode + ":" + rejReason);
            Assert.IsFalse((bool)reply["valid"], "StationRoadCommandHandler must reject mid-span floor.track");
            Assert.AreEqual("track", (string)reply["code"]);
        }

        /* ------------------------------- 3. Road tool gestures & network editing */

        [Test]
        public void RoadToolGesturesDefaultTwoWayMidStrokeSettingsSnapWidthPreservationPreviewReadOnlyAndCancel() {
            var host = CreateHost(FloorSave());
            StationToolSelection.TrySelect("module", out _, out _);
            // Deliberately omit roadDirection to verify unset default is "two-way".
            StationToolSelection.ApplySettings(new JObject {
                ["moduleType"] = "road", ["roadWidth"] = 6, ["rotation"] = 0,
            });

            int rev0 = host.CurrentRevision;
            var startHit = StationCellFixture.Hit(15, 15, 0, true);
            var endHit = StationCellFixture.Hit(31, 15, 0, true);

            // Begin + Aim: defaults to two-way, makes 0 document edits.
            Assert.IsTrue(StationRoadTool.Begin(host, startHit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), 0, out var reason), reason);
            StationRoadTool.Aim(host, endHit, StationPointerEvent.Synthetic(260, 100, 800, 600, timeMs: 100));
            Assert.IsNotNull(StationRoadTool.Preview);
            Assert.IsTrue(StationRoadTool.Preview.Valid, StationRoadTool.Preview.Code);
            Assert.AreEqual("two-way", StationRoadTool.Preview.Candidate.Direction,
                "unset roadDirection must default to two-way");
            Assert.AreEqual(6, StationRoadLayout.Layout(StationRoadTool.Preview.Candidate).Width);
            Assert.AreEqual(rev0, host.CurrentRevision, "preview must make 0 document edits");
            Assert.AreEqual(0, StationRoadEditService.Records(host.Index.Document).Count);

            // Cancel clears gesture & preview with 0 edits.
            StationRoadTool.Cancel();
            Assert.IsFalse(StationRoadTool.HasGesture);
            Assert.IsNull(StationRoadTool.Preview);
            Assert.AreEqual(rev0, host.CurrentRevision, "cancel must make 0 document edits");

            // Mid-stroke settings change: roadWidth 6 -> 12, roadDirection two-way -> one-way, rotation 0 -> 2.
            Assert.IsTrue(StationRoadTool.Begin(host, startHit,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 200), 0, out reason), reason);
            StationRoadTool.Aim(host, endHit, StationPointerEvent.Synthetic(260, 100, 800, 600, timeMs: 250));
            int rotBefore = StationRoadTool.Preview.Candidate.Rotation;

            StationToolSelection.ApplySettings(new JObject {
                ["moduleType"] = "road", ["roadWidth"] = 12, ["roadDirection"] = "one-way", ["rotation"] = 2,
            });
            StationRoadTool.Aim(host, endHit, StationPointerEvent.Synthetic(260, 100, 800, 600, timeMs: 300));
            Assert.IsTrue(StationRoadTool.Preview.Valid, StationRoadTool.Preview.Code);
            Assert.AreEqual(12, StationRoadLayout.Layout(StationRoadTool.Preview.Candidate).Width, "mid-stroke width 6->12");
            Assert.AreEqual("one-way", StationRoadTool.Preview.Candidate.Direction, "mid-stroke direction updated");
            Assert.AreEqual(4, StationRoadTool.Preview.Lanes, "12 m one-way has 4 lanes");
            Assert.AreNotEqual(rotBefore, StationRoadTool.Preview.Candidate.Rotation, "mid-stroke rotation updated");
            Assert.AreEqual(rev0, host.CurrentRevision, "still 0 edits before Finish");

            Assert.IsTrue(StationRoadTool.Finish(host, endHit,
                StationPointerEvent.Synthetic(260, 100, 800, 600, timeMs: 350), out var code, out reason), code ?? reason);
            Assert.AreEqual(rev0 + 1, host.CurrentRevision);
            var laid = StationRoadEditService.Records(host.Index.Document);
            Assert.AreEqual(1, laid.Count);
            Assert.AreEqual(12, StationRoadLayout.Layout(laid[0]).Width);
            Assert.AreEqual("one-way", laid[0].Direction);

            // Snapped start within 3 m of the 12 m one-way endpoint keeps the player's armed width (6 m) & direction (two-way).
            StationToolSelection.ApplySettings(new JObject {
                ["moduleType"] = "road", ["roadWidth"] = 6, ["roadDirection"] = "two-way", ["rotation"] = 0,
            });
            var nearEndpoint = StationCellFixture.Hit(32, 16, 0, true); // raw (32.5, 16.5) -> grid (33, 17), within 3 m of laid[0].To ([32:16])
            var branchEnd = StationCellFixture.Hit(31, 30, 0, true);
            Assert.IsTrue(StationRoadTool.Begin(host, nearEndpoint,
                StationPointerEvent.Synthetic(270, 110, 800, 600, timeMs: 400), 0, out reason), reason);
            StationRoadTool.Aim(host, branchEnd, StationPointerEvent.Synthetic(270, 260, 800, 600, timeMs: 450));
            Assert.IsTrue(StationRoadTool.Preview.Valid, StationRoadTool.Preview.Code);
            Assert.AreEqual(laid[0].To, StationRoadTool.Preview.Candidate.From,
                "snapped start lands on existing endpoint node");
            Assert.AreEqual(6, StationRoadLayout.Layout(StationRoadTool.Preview.Candidate).Width,
                "snapped start preserves player's armed 6 m width (not existing road's 12 m)");
            Assert.AreEqual("two-way", StationRoadTool.Preview.Candidate.Direction,
                "snapped start preserves player's armed two-way direction");
            StationRoadTool.Cancel();
        }

        [Test]
        public void RoadNetworkEditingExtendBranchCrossingSplitPartialArmDeleteAndUnifiedUndoRedo() {
            // Part A: Extend (degree 2) and Branch (degree 3).
            var host = CreateHost(FloorSave());
            Assert.IsTrue(StationRoadEditService.TryCommit(host, new RoadEditRequest {
                mode = "add", z = 0, from = new[] { 10.0, 20.0 }, to = new[] { 24.0, 20.0 },
                width = 6, direction = "two-way", rot = 0,
            }, out var code, out var reason), code ?? reason);
            Assert.IsTrue(StationRoadEditService.TryCommit(host, new RoadEditRequest {
                mode = "add", z = 0, from = new[] { 24.0, 20.0 }, to = new[] { 38.0, 20.0 },
                width = 6, direction = "two-way", rot = 0,
            }, out code, out reason), code ?? reason);

            var graphAfterExtend = StationRoadEditService.Graph(host.Index.Document);
            var joinNode = graphAfterExtend.Node(StationRoadDocument.NodeId(new RoadPosition(24, 20), 0));
            Assert.IsNotNull(joinNode, "extend joins at shared node (24,20)");
            Assert.AreEqual(2, joinNode.Segments.Count, "extend produces degree-2 node");

            // Branch off (24, 20) northward -> degree-3 T-junction node.
            Assert.IsTrue(StationRoadEditService.TryCommit(host, new RoadEditRequest {
                mode = "add", z = 0, from = new[] { 24.0, 20.0 }, to = new[] { 24.0, 34.0 },
                width = 6, direction = "two-way", rot = 0,
            }, out code, out reason), code ?? reason);
            var graphAfterBranch = StationRoadEditService.Graph(host.Index.Document);
            var tNode = graphAfterBranch.Node(StationRoadDocument.NodeId(new RoadPosition(24, 20), 0));
            Assert.IsNotNull(tNode);
            Assert.AreEqual(3, tNode.Segments.Count, "branch produces degree-3 T-junction node");

            // Unified StationEditSession Undo & Redo.
            int revBeforeUndo = host.CurrentRevision;
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.AreEqual(2, StationRoadEditService.Records(host.Index.Document).Count, "undo removes branch");
            Assert.IsTrue(StationEditSession.TryRedo(host, out _, out code), code);
            Assert.AreEqual(3, StationRoadEditService.Records(host.Index.Document).Count, "redo restores branch");
            Assert.Greater(host.CurrentRevision, revBeforeUndo);

            // Part B: 4-way crossing split (4 segments, 5 nodes) + deleting arms keeps junction square until last arm.
            var crossHost = CreateHost(FloorSave(name: "four-way"));
            Assert.IsTrue(StationRoadEditService.TryCommit(crossHost, new RoadEditRequest {
                mode = "add", z = 0, from = new[] { 10.0, 20.0 }, to = new[] { 40.0, 20.0 },
                width = 6, direction = "two-way", rot = 0,
            }, out code, out reason), code ?? reason);
            Assert.IsTrue(StationRoadEditService.TryCommit(crossHost, new RoadEditRequest {
                mode = "add", z = 0, from = new[] { 25.0, 6.0 }, to = new[] { 25.0, 34.0 },
                width = 6, direction = "two-way", rot = 0,
            }, out code, out reason), code ?? reason);

            var crossGraph = StationRoadEditService.Graph(crossHost.Index.Document);
            Assert.AreEqual(4, crossGraph.Segments.Count, "4-way crossing splits into 4 derived segments");
            Assert.AreEqual(5, crossGraph.Nodes.Count, "4-way crossing has 5 nodes (4 outer + 1 centre)");
            var centreNode = crossGraph.Node(StationRoadDocument.NodeId(new RoadPosition(25, 20), 0));
            Assert.IsNotNull(centreNode);
            Assert.AreEqual(4, centreNode.Segments.Count, "centre crossing node has degree 4");

            // Delete arms: removing the west arm leaves a 3-way T-junction (3 segments); removing the
            // east arm eliminates the crossing so the surviving N-S corridor stays 1 unsplit straight
            // segment covering the former junction square (25, 20); deleting that corridor leaves 0 roads.
            var armProbes = new[] {
                (Probe: new[] { 15.0, 20.0 }, ExpectedSegments: 3), // west arm removed -> T-junction (3)
                (Probe: new[] { 35.0, 20.0 }, ExpectedSegments: 1), // east arm removed -> unsplit N-S road (1)
                (Probe: new[] { 25.0, 10.0 }, ExpectedSegments: 0), // surviving N-S road removed -> 0
            };
            for (int step = 0; step < armProbes.Length; step++) {
                var probe = armProbes[step].Probe;
                int expectedRemaining = armProbes[step].ExpectedSegments;
                Assert.IsTrue(StationRoadEditService.TryCommit(crossHost, new RoadEditRequest {
                    mode = "delete", z = 0, from = probe, to = probe,
                }, out code, out reason), $"delete arm {step} failed: {code ?? reason}");
                var g = StationRoadEditService.Graph(crossHost.Index.Document);
                Assert.AreEqual(expectedRemaining, g.Segments.Count, $"after deleting arm {step}");
                if (expectedRemaining > 0) {
                    Assert.IsTrue(StationRoadLayout.ContainsPoint(g.Authored, 25.0, 20.0, 0),
                        $"junction square (25,20) remains covered while {expectedRemaining} arm(s) survive");
                } else {
                    Assert.AreEqual(0, g.Authored.Count, "deleting the last arm leaves 0 roads");
                }
            }
        }

        [Test]
        public void DeleteToolBeginFamilyDeleteRemovesSingleLegacyRoadSegment() {
            var camObj = Track(new GameObject("legacy-delete-camera"));
            var camera = camObj.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 18f;
            camera.nearClipPlane = 0.5f;
            camera.farClipPlane = 400f;
            camera.pixelRect = new Rect(0f, 0f, Mathf.Max(1f, Screen.width), Mathf.Max(1f, Screen.height));

            var hostObj = Track(new GameObject(StationGameHost.ObjectName));
            var host = hostObj.AddComponent<StationGameHost>();
            host.catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            host.trainCatalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            host.stationShader = TestShader();
            host.stationCamera = camera;
            host.frameCameraOnCommit = false;
            typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(host, null);
            host.Coordinator.RegisterRenderer(new StationCellRenderer());
            host.Coordinator.RegisterRenderer(new StationRoadRenderer());

            // Two legacy road modules (no cfg.from / cfg.to).
            var legacyModules = new JArray {
                new JObject {
                    ["id"] = "legacy-a", ["type"] = "road",
                    ["x"] = 6, ["y"] = 4, ["z"] = 0, ["w"] = 6, ["d"] = 14, ["rot"] = 0,
                    ["cfg"] = new JObject { ["direction"] = "two-way" },
                },
                new JObject {
                    ["id"] = "legacy-b", ["type"] = "road",
                    ["x"] = 20, ["y"] = 4, ["z"] = 0, ["w"] = 6, ["d"] = 14, ["rot"] = 0,
                    ["cfg"] = new JObject { ["direction"] = "two-way" },
                },
            };
            var opened = host.OpenDocument(FloorSave(width: 34, depth: 24, modules: legacyModules, name: "legacy-del"), "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());

            var rig = StationViewFeature.Attach(host);
            StationEditFeature.Attach(host);
            Assert.IsTrue(rig.Execute(new JObject {
                ["type"] = "camera.snap",
                ["payload"] = new JObject { ["face"] = "top", ["ortho"] = true },
            }.ToString(Formatting.None), out var snapCode), snapCode);
            rig.Tick(0f);
            Assert.IsTrue(rig.Execute(new JObject {
                ["type"] = "view.set",
                ["payload"] = new JObject { ["key"] = "level", ["value"] = 0 },
            }.ToString(Formatting.None), out var levelCode), levelCode);
            rig.Tick(0f);
            host.SetActiveLevel(rig.Visibility.State.ActiveLevel);
            // Aim camera directly down over legacy-a (x=6..12, y=4..18, centre (9, 11)) so the pick ray hits its deck squarely.
            camera.orthographic = true;
            camera.orthographicSize = 18f;
            camera.transform.SetPositionAndRotation(
                StationCoordinates.Point(new Vector3(9f, 11f, 30f)),
                Quaternion.Euler(90f, 0f, 0f));
            Physics.SyncTransforms();

            Assert.IsTrue(StationToolSelection.TrySelect("delete", out _, out var toolCode), toolCode);

            JObject PointerAt(double docX, double docY, int button, int buttons, double timeMs) {
                float sw = Mathf.Max(1f, Screen.width);
                float sh = Mathf.Max(1f, Screen.height);
                var world = StationCoordinates.Point(new Vector3((float)docX, (float)docY, 1.025f));
                var screen = camera.WorldToScreenPoint(world);
                return new JObject {
                    ["x"] = screen.x,
                    ["y"] = sh - screen.y,
                    ["w"] = sw,
                    ["h"] = sh,
                    ["pointerId"] = 1,
                    ["button"] = button,
                    ["buttons"] = buttons,
                    ["time"] = timeMs,
                    ["toolGeneration"] = StationToolSelection.Generation,
                    ["documentRevision"] = host.CurrentRevision,
                };
            }

            int revBefore = host.CurrentRevision;
            var downReply = new JObject();
            Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.down",
                PointerAt(9.0, 11.0, 0, 1, 1000), downReply, out var code, out var reason), code ?? reason);
            Assert.IsTrue(StationRoadTool.HasGesture, "BeginFamilyDelete routed delete press on road into StationRoadTool");

            var upReply = new JObject();
            Assert.IsTrue(StationPointerRouter.Handle(host, "pointer.up",
                PointerAt(9.0, 11.0, 0, 0, 1120), upReply, out code, out reason), code ?? reason);

            Assert.AreEqual(revBefore + 1, host.CurrentRevision, "family delete commits in 1 revision");
            var remaining = StationRoadEditService.Records(host.Index.Document);
            Assert.AreEqual(1, remaining.Count, "only the clicked legacy road segment is removed");
            Assert.AreEqual("legacy-b", remaining[0].Id, "other legacy road stays intact");
        }

        /* -------------------------------- 4. Signals, markings & traffic parity */

        [Test]
        public void SignalTimingsMatchLaneCountAmberAllRedAndHashedPhaseOffset() {
            // Exact lane-count green timings + amber + all-red clearance.
            Assert.AreEqual(20, RoadTrafficSignals.GreenForLanes(4), "4-lane green = 20 s");
            Assert.AreEqual(12, RoadTrafficSignals.GreenForLanes(2), "2-lane green = 12 s");
            Assert.AreEqual(8, RoadTrafficSignals.GreenForLanes(1), "1-lane green = 8 s");
            Assert.AreEqual(3, RoadTrafficSignals.AmberSeconds, "amber = 3 s");
            Assert.AreEqual(5, RoadTrafficSignals.ClearSeconds, "all-red clearance = 5 s");

            // 4-lane vertical (12 m -> 20 s) crossing 1-lane horizontal (3 m -> 8 s).
            var net = StationRoadLayout.Network(new[] {
                Road("v4", 10, 0, 0, 12, 40, 0, "two-way"),
                Road("h1", 0, 18, 0, 34, 3, 1, "one-way"),
            });
            Assert.AreEqual(1, net.Junctions.Count);
            var j = net.Junctions[0];
            Assert.IsFalse(j.Uncontrolled);
            Assert.AreEqual(20, j.VerticalGreen, "4-lane vertical green");
            Assert.AreEqual(8, j.HorizontalGreen, "1-lane horizontal green");

            int verticalPhase = 20 + 3 + 5; // 28
            int cycle = verticalPhase + 8 + 3 + 5; // 44
            uint offset = RoadTrafficSignals.Hash(j.Id) % (uint)verticalPhase;

            int vGreen = 0, vAmber = 0, hGreen = 0, hAmber = 0, allRed = 0;
            for (int sec = 0; sec < cycle; sec++) {
                // Sample at phase-aligned integer seconds relative to the hashed offset.
                double t = sec - (double)offset;
                var vp = StationRoadLayout.Signal(j, true, t + 0.5);
                var hp = StationRoadLayout.Signal(j, false, t + 0.5);

                // Mutual exclusion: never green/amber on both axes simultaneously.
                Assert.IsFalse(vp != RoadSignalPhase.Red && hp != RoadSignalPhase.Red,
                    $"conflicting signal phases at local sec {sec}: V={vp}, H={hp}");

                if (vp == RoadSignalPhase.Green) vGreen++;
                else if (vp == RoadSignalPhase.Amber) vAmber++;
                else if (hp == RoadSignalPhase.Green) hGreen++;
                else if (hp == RoadSignalPhase.Amber) hAmber++;
                else allRed++;
            }
            Assert.AreEqual(20, vGreen, "20 s vertical green");
            Assert.AreEqual(3, vAmber, "3 s vertical amber");
            Assert.AreEqual(8, hGreen, "8 s horizontal green");
            Assert.AreEqual(3, hAmber, "3 s horizontal amber");
            Assert.AreEqual(10, allRed, "two 5 s all-red clearance windows per cycle");

            // Confirm hashed offset shifts t=0 phase deterministically.
            double expectedLocalAtZero = offset;
            var expectedVAtZero = expectedLocalAtZero < 20 ? RoadSignalPhase.Green
                : expectedLocalAtZero < 23 ? RoadSignalPhase.Amber : RoadSignalPhase.Red;
            Assert.AreEqual(expectedVAtZero, StationRoadLayout.Signal(j, true, 0.0),
                "signal phase at t=0 incorporates hashed phase offset");
        }

        [Test]
        public void LongHorizonMeteredTrafficEnforcesCapJunctionExclusivityFollowGapAndShortLinkBusUnlock() {
            // Corridor with TWO controlled junctions separated by an 8 m short link (< 10 m bus length!):
            // East-west road (y = 20..26) crossed by two north-south roads at x = 20..26 and x = 34..40 (gap = 8 m).
            var records = new[] {
                Road("ew", 0, 20, 0, 80, 6, 1, "two-way"),
                Road("ns-west", 20, 0, 0, 6, 46, 0, "two-way"),
                Road("ns-east", 34, 0, 0, 6, 46, 0, "two-way"),
            };
            var layoutNet = StationRoadLayout.Network(records);
            Assert.AreEqual(2, layoutNet.Junctions.Count, "corridor has 2 controlled junctions");
            var trafficNet = StationRoadLayout.TrafficNetwork(layoutNet);
            var traffic = new StationRoadTraffic(trafficNet, seed: 42);

            int maxCarsSeen = 0;
            bool sawBus = false;
            var junctionsVisitedByAnyBus = new HashSet<int>();
            var carsPassedThroughSecondHalf = new HashSet<int>();

            // Advance 2400 ticks (240 sim seconds) at 0.1 s step.
            for (int tick = 1; tick <= 2400; tick++) {
                double t = tick * StationRoadTraffic.Step;
                traffic.Advance(t);

                Assert.LessOrEqual(traffic.Cars.Count, StationRoadTraffic.Capacity,
                    "tick " + tick + " exceeded 192 car capacity");
                maxCarsSeen = Math.Max(maxCarsSeen, traffic.Cars.Count);

                // 1. Junction exclusivity: <= 1 car inside each controlled junction's connector edges.
                var inJunction = new Dictionary<int, int>();
                // 2. Group cars by non-junction edge to verify pairwise follow gap.
                var byEdge = new Dictionary<int, List<RoadTrafficCar>>();
                foreach (var c in traffic.Cars) {
                    var edge = trafficNet.Edges[c.Edge];
                    if (edge.Junction >= 0 && !trafficNet.Junctions[edge.Junction].Uncontrolled) {
                        inJunction.TryGetValue(edge.Junction, out int count);
                        inJunction[edge.Junction] = count + 1;
                        Assert.LessOrEqual(count + 1, 1,
                            $"tick {tick}: more than 1 car inside controlled junction {edge.Junction}");
                        if (c.Kind == RoadVehicleKind.Bus) junctionsVisitedByAnyBus.Add(edge.Junction);
                    } else {
                        if (!byEdge.TryGetValue(c.Edge, out var list)) byEdge[c.Edge] = list = new List<RoadTrafficCar>();
                        list.Add(c);
                    }
                    if (c.Kind == RoadVehicleKind.Bus) sawBus = true;
                    if (tick > 600 && edge.Junction >= 0) carsPassedThroughSecondHalf.Add(c.Id);
                }

                foreach (var kv in byEdge) {
                    var list = kv.Value;
                    if (list.Count < 2) continue;
                    list.Sort((a, b) => a.Distance.CompareTo(b.Distance));
                    for (int i = 1; i < list.Count; i++) {
                        double gap = list[i].Distance - list[i - 1].Distance - (list[i].Size + list[i - 1].Size) * 0.5;
                        Assert.GreaterOrEqual(gap, StationRoadTraffic.FollowGap - 0.05,
                            $"tick {tick} edge {kv.Key}: follow gap violated ({gap:0.###} m)");
                    }
                }
            }

            Assert.Greater(maxCarsSeen, 0, "traffic populated the corridor");
            Assert.IsTrue(sawBus, "10 m buses spawned in metered traffic");
            Assert.Greater(junctionsVisitedByAnyBus.Count, 0, "bus traversed controlled junction");
            Assert.Greater(carsPassedThroughSecondHalf.Count, 4,
                "short two-junction link released locks without deadlocking in the second minute");
        }

        [Test]
        public void RightHandTrafficAcrossFourRotationsCrosswalksStopLinesTJunctionArrowsWideStopLineAndTrafficLightClearance() {
            // 1. Right-hand traffic across rot 0..3 for two-way + one-way flow.
            // Two-way rot 0 & 2 (north-south, AcrossX=true): lane 0 (west/-x) travels -Y (south), lane 1 (east/+x) travels +Y (north) => right-hand!
            foreach (int rot in new[] { 0, 2 }) {
                var twoNs = Road("ns-" + rot, 0, 0, 0, 6, 20, rot, "two-way");
                Assert.AreEqual(-1, StationRoadLayout.LaneSign(twoNs, 0), $"two-way NS rot={rot} west lane goes -Y (RHT)");
                Assert.AreEqual(1, StationRoadLayout.LaneSign(twoNs, 1), $"two-way NS rot={rot} east lane goes +Y (RHT)");
            }
            // Two-way rot 1 & 3 (east-west, AcrossX=false): lane 0 (south/-y) travels +X (east), lane 1 (north/+y) travels -X (west) => right-hand!
            foreach (int rot in new[] { 1, 3 }) {
                var twoEw = Road("ew-" + rot, 0, 0, 0, 20, 6, rot, "two-way");
                Assert.AreEqual(1, StationRoadLayout.LaneSign(twoEw, 0), $"two-way EW rot={rot} south lane goes +X (RHT)");
                Assert.AreEqual(-1, StationRoadLayout.LaneSign(twoEw, 1), $"two-way EW rot={rot} north lane goes -X (RHT)");
            }
            // One-way flow across rot 0..3: rot 0,1 => +1; rot 2,3 => -1.
            Assert.AreEqual(1, StationRoadLayout.LaneSign(Road("o0", 0, 0, 0, 6, 20, 0, "one-way"), 0));
            Assert.AreEqual(1, StationRoadLayout.LaneSign(Road("o1", 0, 0, 0, 20, 6, 1, "one-way"), 0));
            Assert.AreEqual(-1, StationRoadLayout.LaneSign(Road("o2", 0, 0, 0, 6, 20, 2, "one-way"), 0));
            Assert.AreEqual(-1, StationRoadLayout.LaneSign(Road("o3", 0, 0, 0, 20, 6, 3, "one-way"), 0));

            // 2. Crosswalks on exit-only one-way arms vs stop-lines only on arrivals.
            // Two-way N-S main road (x=10..16, y=0..30) with an exit-only one-way E-W arm starting AT the junction and going east (rot=1, sign=+1).
            var exitOnlyRoot = Track(new GameObject("exit-only-arm-view"));
            var exitOnlyView = StationRoadView.BuildRecords(exitOnlyRoot.transform, new[] {
                Road("main-ns", 10, 0, 0, 6, 30, 0, "two-way"),
                Road("exit-east", 10, 12, 0, 20, 6, 1, "one-way"),
            }, TestShader());
            var sides = StationRoadLayout.JunctionSides(exitOnlyView.Network);
            Assert.IsTrue(sides.Any(s => s.Road == "exit-east"),
                "JunctionSides includes the exit-only one-way arm so it receives a crosswalk");
            // 3 arms carry crosswalks (north, south, exit-east), but only the 2 arriving approaches (north & south) get stop-lines & signals.
            Assert.AreEqual(3, sides.Count, "3 junction sides receive crosswalk stripes");
            Assert.AreEqual(2, exitOnlyView.StopLines, "stop lines drawn ONLY on arriving approaches, not exit-only arm");
            Assert.AreEqual(2, exitOnlyView.SignalsBuilt, "signals drawn ONLY on arriving approaches");
            Assert.Greater(exitOnlyView.Crosswalks, 0, "crosswalk stripes built");

            // 3. Uncontrolled merge: 0 crosswalks, 0 stop lines, 0 signals.
            // Two-lane N-S one-way (width 6) sharing an authored node (6, 20, 0) with a wider N-S one-way (width 12) => uncontrolled merge junction.
            var mergeRoot = Track(new GameObject("uncontrolled-merge-view"));
            var mergeView = StationRoadView.BuildRecords(mergeRoot.transform, new[] {
                StationRoadDocument.Between(new RoadPosition(6, 0), new RoadPosition(6, 20), 0, 6, "one-way", false, "narrow-s"),
                StationRoadDocument.Between(new RoadPosition(6, 20), new RoadPosition(6, 40), 0, 12, "one-way", false, "wide-n"),
            }, TestShader());
            Assert.AreEqual(1, mergeView.Network.Junctions.Count, "collinear width change produces 1 merge junction");
            Assert.IsTrue(mergeView.Network.Junctions[0].Uncontrolled,
                "collinear one-way merge is uncontrolled");
            Assert.AreEqual(0, mergeView.Crosswalks, "0 crosswalks on uncontrolled merge");
            Assert.AreEqual(0, mergeView.StopLines, "0 stop lines on uncontrolled merge");
            Assert.AreEqual(0, mergeView.SignalsBuilt, "0 signals on uncontrolled merge");

            // 4. T-junction straight-arrow suppression & wide 12 m road stop line.
            var tJunctionRoot = Track(new GameObject("t-junction-wide-view"));
            var tView = StationRoadView.BuildRecords(tJunctionRoot.transform, new[] {
                // Wide 12 m E-W through road along y = 20..32
                Road("wide-ew", 0, 20, 0, 50, 12, 1, "two-way"),
                // N-S stem arriving from the south and terminating at y = 20..32 (no northern continuation!)
                Road("stem-s", 20, 0, 0, 6, 32, 0, "two-way"),
            }, TestShader());
            var stemArrivals = tView.Network.Edges
                .Where(e => e.Road.Id == "stem-s" && e.Junction < 0 && e.Sign > 0 &&
                            e.Next.Any(n => tView.Network.Edges[n].Junction >= 0))
                .ToList();
            Assert.IsNotEmpty(stemArrivals, "T-junction stem has arriving edge");
            foreach (var edge in stemArrivals) {
                var moves = StationRoadLayout.EdgeMovements(tView.Network, edge);
                Assert.IsFalse(moves.Contains(RoadTurn.Straight),
                    "T-junction stem approach must suppress straight arrow");
                Assert.IsTrue(moves.Contains(RoadTurn.Left) || moves.Contains(RoadTurn.Right),
                    "T-junction stem permits left/right turns");
            }
            Assert.Greater(tView.StopLines, 0, "wide 12 m T-junction builds stop lines");
            Assert.Greater(tView.Arrows, 0, "wide 12 m T-junction builds turn arrows");

            // 5. Standalone traffic-light 3.5 m clearance in StationFootprints.
            var tlSave = FloorSave(width: 10, depth: 10, modules: new JArray {
                new JObject {
                    ["id"] = "tl-1", ["type"] = "traffic-light",
                    ["x"] = 4, ["y"] = 4, ["z"] = 0, ["rot"] = 0, ["cfg"] = new JObject(),
                },
            });
            var tlRead = StationDocumentReader.Read(tlSave, new StationSource("tl-clearance", ""));
            Assert.IsNotNull(tlRead?.Document);
            Assert.IsTrue(tlRead.Index.TryGetModule("tl-1", out var tlMod));
            Assert.IsTrue(StationFootprints.TryClearance(tlMod, out var tlBox, out var tlReason), tlReason);
            Assert.AreEqual(3.5, tlBox.Z1 - tlBox.Z0, 1e-6, "standalone traffic-light clearance height is 3.5 m");
            Assert.AreEqual(0.6, tlBox.X1 - tlBox.X0, 1e-6, "traffic-light footprint width is 0.6 m");
            Assert.AreEqual(0.6, tlBox.Y1 - tlBox.Y0, 1e-6, "traffic-light footprint depth is 0.6 m");
        }

        /* --------------------------------------------- 5. Road vehicles parity */

        [Test]
        public void RoadTrafficCoversBothVariantsPerFamilyAmbientMixAndMultiLaneStagger() {
            // 4-lane 200 m two-way boulevard so all families spawn and parallel lanes stagger.
            var net = StationRoadLayout.Network(new[] {
                Road("blvd", 0, 0, 0, 12, 200, 0, "two-way"),
            });
            var traffic = new StationRoadTraffic(StationRoadLayout.TrafficNetwork(net), seed: 101);

            // 1. Seeded 2-variant coverage per family via VariantOf.
            var carVariants = new HashSet<string>();
            var busVariants = new HashSet<string>();
            var scooterVariants = new HashSet<string>();
            for (int id = 0; id < 40; id++) {
                carVariants.Add(traffic.VariantOf(new RoadTrafficCar { Id = id, Kind = RoadVehicleKind.Car }));
                busVariants.Add(traffic.VariantOf(new RoadTrafficCar { Id = id, Kind = RoadVehicleKind.Bus }));
                scooterVariants.Add(traffic.VariantOf(new RoadTrafficCar { Id = id, Kind = RoadVehicleKind.Scooter }));
            }
            CollectionAssert.AreEquivalent(new[] { "suv", "sedan" }, carVariants, "car variants");
            CollectionAssert.AreEquivalent(new[] { "bus-orange", "bus-mosaic" }, busVariants, "bus variants");
            CollectionAssert.AreEquivalent(new[] { "moped", "bicycle" }, scooterVariants, "scooter variants");

            // 2. Initial Reset stagger across parallel lanes (laneOffset = e.Lane * 2).
            traffic.Advance(0.0);
            var lane0Dists = traffic.Cars.Where(c => traffic.Network.Edges[c.Edge].Lane == 0).Select(c => c.Distance).ToList();
            var lane1Dists = traffic.Cars.Where(c => traffic.Network.Edges[c.Edge].Lane == 1).Select(c => c.Distance).ToList();
            Assert.IsNotEmpty(lane0Dists, "lane 0 has seeded traffic");
            Assert.IsNotEmpty(lane1Dists, "lane 1 has seeded traffic");
            foreach (double d0 in lane0Dists) {
                foreach (double d1 in lane1Dists) {
                    Assert.Greater(Math.Abs(d0 - d1), 0.5,
                        "parallel lanes must stagger vehicles rather than spawning in lockstep");
                }
            }

            // 3. Ambient mix across Car, Bus, Scooter over a 60 s run.
            var seenKinds = new HashSet<RoadVehicleKind>();
            var seenVariants = new HashSet<string>();
            var poses = new List<RoadVehiclePose>();
            for (int tick = 0; tick <= 600; tick += 5) {
                double t = tick * StationRoadTraffic.Step;
                traffic.Advance(t);
                traffic.Sample(t, poses);
                foreach (var p in poses) {
                    seenKinds.Add(p.Kind);
                    seenVariants.Add(p.Variant);
                }
            }
            Assert.IsTrue(seenKinds.Contains(RoadVehicleKind.Car), "ambient traffic includes cars");
            Assert.IsTrue(seenKinds.Contains(RoadVehicleKind.Bus), "ambient traffic includes buses");
            Assert.IsTrue(seenKinds.Contains(RoadVehicleKind.Scooter), "ambient traffic includes scooters");
            Assert.GreaterOrEqual(seenVariants.Count, 5, "ambient traffic mixes multiple vehicle variants");
        }

        [Test]
        public void AllSixPromotedVehicleRigidLodsReduceTrianglesPreserveBoundsAndApplyCleanly() {
            var vehicleNames = new[] {
                "VehicleSuv",
                "VehicleSedan",
                "VehicleBusOrange",
                "VehicleBusMosaic",
                "VehicleMoped",
                "VehicleBicycle",
            };

            int totalBakedMeshes = 0;
            foreach (var name in vehicleNames) {
                string prefabPath = $"Assets/StationDesigner/Generated/Prefabs/{name}.prefab";
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                Assert.IsNotNull(prefab, "missing vehicle prefab: " + prefabPath);

                var library = Resources.Load<StationRigidModelLods>(StationRigidModelLods.ResourcesPath + name);
                Assert.IsNotNull(library, "missing StationRigidModelLods asset for " + name);
                Assert.IsNotEmpty(library.Meshes, name + " LOD table is empty");

                int bakedEntries = 0;
                foreach (var entry in library.Meshes) {
                    Assert.IsNotNull(entry.Source, name + " LOD entry has null Source");
                    if (entry.Baked == null) {
                        Assert.IsNotEmpty(entry.ReuseReason, name + " unbaked entry must explain ReuseReason");
                        continue;
                    }
                    bakedEntries++;
                    totalBakedMeshes++;
                    Assert.GreaterOrEqual(entry.Baked.lodCount, 3, name + " baked mesh must have 3 LOD tiers");
                    Assert.AreEqual(entry.Source.vertexCount, entry.Baked.vertexCount, name + " vertex count parity");
                    Assert.AreEqual(entry.Source.subMeshCount, entry.Baked.subMeshCount, name + " submesh parity");

                    int lod0 = 0, lod2 = 0;
                    for (int s = 0; s < entry.Source.subMeshCount; s++) {
                        Assert.AreEqual(entry.Source.GetIndexCount(s), entry.Baked.GetIndexCount(s, 0),
                            name + " LOD0 matches source");
                        lod0 += (int)entry.Baked.GetIndexCount(s, 0);
                        lod2 += (int)entry.Baked.GetIndexCount(s, 2);
                    }
                    Assert.Less(lod2, lod0, name + " LOD2 must reduce triangle count vs LOD0");
                    Assert.AreEqual(entry.Source.bounds.center.x, entry.Baked.bounds.center.x, 0.02f, name + " bounds cx");
                    Assert.AreEqual(entry.Source.bounds.center.y, entry.Baked.bounds.center.y, 0.02f, name + " bounds cy");
                    Assert.AreEqual(entry.Source.bounds.center.z, entry.Baked.bounds.center.z, 0.02f, name + " bounds cz");
                    Assert.AreEqual(entry.Source.bounds.size.x, entry.Baked.bounds.size.x, 0.02f, name + " bounds sx");
                    Assert.AreEqual(entry.Source.bounds.size.y, entry.Baked.bounds.size.y, 0.02f, name + " bounds sy");
                    Assert.AreEqual(entry.Source.bounds.size.z, entry.Baked.bounds.size.z, 0.02f, name + " bounds sz");
                }

                // Apply onto a real instantiated prefab and clean up via DestroyImmediate.
                var instance = UnityEngine.Object.Instantiate(prefab);
                try {
                    StationRigidModelLods.Apply(instance, name);
                    int appliedBaked = 0;
                    foreach (var mf in instance.GetComponentsInChildren<MeshFilter>(true)) {
                        if (mf.sharedMesh != null && mf.sharedMesh.lodCount >= 3) appliedBaked++;
                    }
                    if (bakedEntries > 0) {
                        Assert.Greater(appliedBaked, 0, name + " Apply must bind baked 3-tier LOD meshes");
                    }
                } finally {
                    UnityEngine.Object.DestroyImmediate(instance);
                }
            }

            Assert.Greater(totalBakedMeshes, 0, "vehicle fleet must carry baked multi-tier LOD meshes");
        }
    }
}
