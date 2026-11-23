using System;
using System.Collections.Generic;
using System.Globalization;
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
using Object = UnityEngine.Object;

namespace Metro.EditModeTests {
    /// <summary>
    /// Domain D2 parity tests closing web suites:
    /// <c>ground</c>, <c>zones</c>, <c>save</c>, <c>grid</c>, <c>ceiling-cells</c>,
    /// <c>contact-finishes</c>, <c>walls</c>, <c>halfwall</c>, <c>triangle</c>,
    /// <c>wall-cuts</c>, <c>surfaces</c>, <c>local-cell-edit</c>, <c>facility</c>,
    /// <c>check-ceiling-floor</c>, and <c>check-tanwei-raised-floors</c>.
    /// </summary>
    public sealed class StationGroundAndZoneParityTests {
        static readonly string[] StockFinishes20 = {
            "floor.granite", "floor.concrete", "floor.marble", "floor.limestone",
            "floor.sandstone", "floor.slate", "floor.softwood", "floor.hardwood",
            "floor.tile", "floor.track", "floor.soil", "floor.obsidian",
            "ceil.baffle", "ceil.metal", "ceil.steel",
            "wall.plaster", "wall.enamel", "wall.stainless", "wall.aluminum", "wall.soil",
        };

        GameObject rootObject;
        readonly List<Object> unityCleanup = new List<Object>();
        readonly List<StationCellView> cellViews = new List<StationCellView>();

        [SetUp]
        public void SetUp() {
            StationToolSelection.Reset();
            StationEditSession.Reset();
            rootObject = new GameObject("StationGroundAndZoneParityTests");
        }

        [TearDown]
        public void TearDown() {
            for (int i = cellViews.Count - 1; i >= 0; i--) {
                cellViews[i]?.ReleaseMeshes();
            }
            cellViews.Clear();
            for (int i = unityCleanup.Count - 1; i >= 0; i--) {
                if (unityCleanup[i] != null) Object.DestroyImmediate(unityCleanup[i]);
            }
            unityCleanup.Clear();
            StationEditHost.ResetForTests();
            if (rootObject != null) Object.DestroyImmediate(rootObject);
            rootObject = null;
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
            StationToolSelection.Reset();
            StationEditSession.Reset();
            PassengerPoseFeeds.Clear();
        }

        static JObject BaseSave(JArray cells = null, JArray modules = null, JArray lines = null, int? levelBase = 0) {
            var obj = new JObject {
                ["format"] = "metro-save",
                ["formatVersion"] = 1,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "Parity fixture",
                ["nameEn"] = "Parity",
                ["city"] = "guangzhou",
                ["seed"] = 1234567,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = cells ?? new JArray(),
                    ["modules"] = modules ?? new JArray(),
                    ["lines"] = lines ?? new JArray(),
                },
            };
            if (levelBase.HasValue) obj["levelBase"] = levelBase.Value;
            return obj;
        }

        static StationReadResult ReadSave(JObject save) {
            var read = StationDocumentReader.Read(save.ToString(Formatting.None), StationSource.None);
            Assert.IsNotNull(read.Document);
            return read;
        }

        static JObject CellJson(int x, int y, int z, string fill = "solid", string[] tags = null, JObject finish = null, string zone = null, string room = null) {
            var obj = new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = fill };
            if (tags != null && tags.Length > 0) obj["tags"] = new JArray(tags);
            if (finish != null) obj["finish"] = finish;
            if (!string.IsNullOrEmpty(zone)) obj["zone"] = zone;
            if (!string.IsNullOrEmpty(room)) obj["room"] = room;
            return obj;
        }

        static StationGameHost CreateHost() {
            var hostGo = new GameObject(StationGameHost.ObjectName);
            hostGo.transform.SetParent(GameObject.Find("StationGroundAndZoneParityTests").transform, false);
            var host = hostGo.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(awake);
            awake.Invoke(host, null);
            StationEditFeature.Attach(host);
            StationEditHost.Ensure().Bind(host);
            return host;
        }

        static bool HasEdge(StationWalkGraph g, int fromX, int fromY, int fromZ, int toX, int toY, int toZ) {
            if (!g.TryNode(fromX, fromY, fromZ, out int u)) return false;
            if (!g.TryNode(toX, toY, toZ, out int v)) return false;
            var adj = g.AdjTo[u];
            for (int i = 0; i < adj.Length; i++) if (adj[i] == v) return true;
            return false;
        }

        static double SignedMeshVolumeAndCheckOutwardWinding(StationCellMeshResult result) {
            double vol6 = 0;
            int totalTris = 0;
            foreach (var g in result.Groups) {
                for (int t = 0; t < g.Indices.Length; t += 3) {
                    int i0 = g.Indices[t], i1 = g.Indices[t + 1], i2 = g.Indices[t + 2];
                    var a = g.Positions[i0];
                    var b = g.Positions[i1];
                    var c = g.Positions[i2];
                    var cross = Vector3.Cross(b - a, c - a);
                    Assert.Greater(Vector3.Dot(cross, g.Normals[i0]), 0f,
                        $"triangle {t / 3} in {g.GroupKey} must have outward winding matching normal");
                    vol6 += Vector3.Dot(a, Vector3.Cross(b, c));
                    totalTris++;
                }
            }
            Assert.Greater(totalTris, 0);
            return vol6 / 6.0;
        }

        /* ======================================================== 1. ZONES & GROUND */

        [Test]
        public void ZoneBarriersBlockUngatedPaidLineRestoreFlowWithGateAndApplyZoneMatrix() {
            StationSessionDocument CorridorDoc(bool withGate) {
                var doc = new StationSessionDocument { StationId = "zone-barriers", LevelBase = 0 };
                doc.Lines.Add(new StationLineFact {
                    Id = "line-1", Direction = "up", HeadwayPeak = 45, HeadwayOffpeak = 45, HeadwayLate = 45,
                    Stock = "L", Cars = 1, AlightPerTrain = 0, AuthoredAlight = true, ModelScale = 1,
                });
                // Corridor x=0..27, y=0, z=0: x=0..4 unpaid(2), x=5..7 paid(3), x=8..27 platform(4) matching 20 m L-stock track.
                for (int x = 0; x <= 27; x++) {
                    doc.Cells.Add(new StationCellFact {
                        X = x, Y = 0, Z = 0, Solid = true,
                        Zone = x <= 4 ? 2 : (x >= 8 ? 4 : 3),
                        Speed = 1.0,
                    });
                }
                doc.Modules.Add(new StationModuleFact {
                    Id = "exit-1", Type = "exit", X = 0, Y = 0, Z = 0, Rot = 0, Width = 1, Depth = 1, Height = 1,
                    Name = "A", ExitStyle = "virtual", HeadHouse = false, HasExitInRate = true, ExitInRate = 3600,
                });
                if (withGate) {
                    doc.Modules.Add(new StationModuleFact {
                        Id = "gate-1", Type = "gate", X = 5, Y = 0, Z = 0, Rot = 3, Width = 1, Depth = 1, Height = 1,
                        GateDir = 0, GateOpen = true, GateHasLane = true,
                    });
                }
                doc.Modules.Add(new StationModuleFact {
                    Id = "track-1", Type = "track", X = 8, Y = -1, Z = 0, Rot = 0, Width = 20, Depth = 1, Height = 1,
                    LineId = "line-1", Dir = "up",
                });
                doc.Modules.Add(new StationModuleFact {
                    Id = "edge-1", Type = "platform-edge", X = 8, Y = 0, Z = 0, Rot = 0, Width = 20, Depth = 1, Height = 1,
                    LineId = "line-1", RailId = "track-1", Side = "right", Dir = "up",
                });
                return doc;
            }

            // 1. Ungated unpaid|paid blocked when ZoneBarriers = true -> Boarded == 0, Stuck > 0.
            var blockedOpts = new StationWalkGraphOptions { ZoneBarriers = true, IncludeGround = false };
            var blockedDoc = CorridorDoc(withGate: false);
            var blockedGraph = StationWalkGraphBuilder.Build(blockedDoc, blockedOpts);
            Assert.IsFalse(HasEdge(blockedGraph, 4, 0, 0, 5, 0, 0),
                "ZoneBarriers=true must block ungated unpaid(4,0,0)->paid(5,0,0) edge");

            var blockedSession = new StationSimulationSession(new StationSessionSetup {
                Document = blockedDoc, Day = StationDayData.Default, StartSimTime = 7.5 * 3600,
                StartPlaying = true, Seed = 42, WalkOptions = blockedOpts,
            });
            blockedSession.Advance(90);
            Assert.AreEqual(0, blockedSession.Services.Boarded, "ungated fare line must prevent boarding");
            Assert.Greater(blockedSession.Services.Stuck, 0, "ungated fare line must produce stuck riders");

            // 2. Adding a fare gate at (5,0,0) restores flow across unpaid|paid.
            var gatedDoc = CorridorDoc(withGate: true);
            var gatedGraph = StationWalkGraphBuilder.Build(gatedDoc, blockedOpts);
            Assert.IsTrue(HasEdge(gatedGraph, 4, 0, 0, 5, 0, 0), "fare gate must bridge unpaid->gate");
            Assert.IsTrue(HasEdge(gatedGraph, 5, 0, 0, 6, 0, 0), "fare gate must bridge gate->paid");

            var gatedSession = new StationSimulationSession(new StationSessionSetup {
                Document = gatedDoc, Day = StationDayData.Default, StartSimTime = 7.5 * 3600,
                StartPlaying = true, Seed = 42, WalkOptions = blockedOpts,
            });
            gatedSession.Advance(90);
            Assert.Greater(gatedSession.GateFrames()[0].Served, 0, "adding fare gate must restore crowd flow through gate");
            Assert.Greater(gatedSession.Services.Boarded, 0, "adding fare gate must restore train boarding");

            // 3. Zone connectivity matrix: outside<->unpaid, none<->unpaid, none<->outside connect; none<->paid blocked; ZoneBarriers=false connects all.
            var matrixDoc = new StationSessionDocument { StationId = "zone-matrix", LevelBase = 0 };
            matrixDoc.Cells.Add(new StationCellFact { X = 0, Y = 0, Z = 0, Solid = true, Zone = 1, Speed = 1 }); // outside
            matrixDoc.Cells.Add(new StationCellFact { X = 1, Y = 0, Z = 0, Solid = true, Zone = 2, Speed = 1 }); // unpaid
            matrixDoc.Cells.Add(new StationCellFact { X = 2, Y = 0, Z = 0, Solid = true, Zone = 0, Speed = 1 }); // none
            matrixDoc.Cells.Add(new StationCellFact { X = 3, Y = 0, Z = 0, Solid = true, Zone = 1, Speed = 1 }); // outside
            matrixDoc.Cells.Add(new StationCellFact { X = 2, Y = 1, Z = 0, Solid = true, Zone = 3, Speed = 1 }); // paid

            var barrierGraph = StationWalkGraphBuilder.Build(matrixDoc, blockedOpts);
            Assert.IsTrue(HasEdge(barrierGraph, 0, 0, 0, 1, 0, 0), "outside <-> unpaid must connect");
            Assert.IsTrue(HasEdge(barrierGraph, 1, 0, 0, 2, 0, 0), "unpaid <-> none must connect");
            Assert.IsTrue(HasEdge(barrierGraph, 2, 0, 0, 3, 0, 0), "none <-> outside must connect");
            Assert.IsFalse(HasEdge(barrierGraph, 2, 0, 0, 2, 1, 0), "none <-> paid must be blocked under ZoneBarriers=true");

            var openGraph = StationWalkGraphBuilder.Build(matrixDoc, new StationWalkGraphOptions { ZoneBarriers = false, IncludeGround = false });
            Assert.IsTrue(HasEdge(openGraph, 2, 0, 0, 2, 1, 0), "ZoneBarriers=false must connect none <-> paid");
            var openCorridor = StationWalkGraphBuilder.Build(blockedDoc, new StationWalkGraphOptions { ZoneBarriers = false, IncludeGround = false });
            Assert.IsTrue(HasEdge(openCorridor, 4, 0, 0, 5, 0, 0), "ZoneBarriers=false must connect unpaid <-> paid");
        }

        [Test]
        public void ZonePlannerPreservesOverLimitReasonBucketFloods142x142AndRefusesWritingNone() {
            // Build a 142x142 room (20,164 explicit solid floor cells) at z=-5.
            const int side = 142;
            const int total = side * side; // 20,164 > MaxCells (10,000)
            var records = new StationCellRecord[total];
            int idx = 0;
            for (int y = 0; y < side; y++) {
                for (int x = 0; x < side; x++) {
                    records[idx++] = new StationCellRecord(x, y, -5, "full", "solid", "", null, null, "", "");
                }
            }
            var defaultDay = new StationDay(
                new StationSpan(23400, 84600),
                new StationSpan(27000, 32400),
                new StationSpan(63000, 68400),
                new StationDemand(1.0, 0.78, 1.0),
                new StationDemand(0.35, 0.4, 1.5),
                2026, 1, 1, Array.Empty<string>());
            var doc = new StationDocument("Large", "", "guangzhou", 1, 0, 5, defaultDay,
                records, Array.Empty<StationModuleRecord>(), Array.Empty<StationLineRecord>(),
                0, 0, StationSource.None, StationDocumentReader.FixedSavedAt, "");
            var world = StationZoneWorld.Build(doc);

            // 1. Rectangular drag Plan over > 10,000 cells preserves Reason == "over-limit" (surgical fix #1).
            var dragCells = new List<StationCellKey>(StationZonePlanner.MaxCells + 5);
            for (int i = 0; i < StationZonePlanner.MaxCells + 5; i++) {
                dragCells.Add(new StationCellKey(i % side, i / side, -5));
            }
            var overPlan = StationZonePlanner.Plan(world, dragCells, "paid");
            Assert.IsFalse(overPlan.HasWork, "overflow drag must emit no work");
            Assert.AreEqual(0, overPlan.Writes.Count);
            Assert.AreEqual("over-limit", overPlan.Reason, "Plan overflow must preserve Reason='over-limit'");

            // 2. Bucket flood over 142x142 (20,164 cells) succeeds completely without artificial 10k cap (surgical fix #1).
            var center = new StationCellKey(71, 71, -5);
            var bucketPlan = StationZonePlanner.Bucket(world, center, "paid");
            Assert.AreEqual("", bucketPlan.Reason, "142x142 bucket flood must not fail with over-limit");
            Assert.IsTrue(bucketPlan.HasWork);
            Assert.AreEqual(total, bucketPlan.Accepted.Count, "bucket must flood all 20,164 cells");
            Assert.AreEqual(total, bucketPlan.Writes.Count);
            var acceptedSet = new HashSet<StationCellKey>(bucketPlan.Accepted);
            Assert.IsTrue(acceptedSet.Contains(new StationCellKey(72, 71, -5)));
            Assert.IsTrue(acceptedSet.Contains(new StationCellKey(70, 71, -5)));
            Assert.IsTrue(acceptedSet.Contains(new StationCellKey(71, 72, -5)));
            Assert.IsTrue(acceptedSet.Contains(new StationCellKey(71, 70, -5)));

            // 3. Refuse writing 'none' onto unpainted cells and refuse bucket with 'none'.
            var nonePlan = StationZonePlanner.Plan(world, new[] { new StationCellKey(0, 0, -5) }, StationZoneIds.None);
            Assert.IsFalse(nonePlan.HasWork, "painting 'none' on unpainted cells must be a no-op");
            Assert.AreEqual("nothing-to-do", nonePlan.Reason);
            var noneBucket = StationZonePlanner.Bucket(world, new StationCellKey(0, 0, -5), StationZoneIds.None);
            Assert.IsFalse(noneBucket.HasWork);
            Assert.AreEqual("not-bucketable", noneBucket.Reason);
        }

        [Test]
        public void ZoneMapExcludesSoilCeilingsThinWallsMatchesOffGridBandAndImplicitStreetRules() {
            var cells = new JArray {
                CellJson(0, 0, -5, finish: new JObject { ["top"] = "floor.soil" }, zone: "unpaid"),
                CellJson(1, 0, -5, tags: new[] { "suspended-ceiling" }),
                CellJson(2, 0, -5, tags: new[] { "opening-ceiling" }),
                CellJson(3, 0, -5, tags: new[] { "half-wall:n" }),
                CellJson(4, 0, -5, zone: "paid"),                          // valid floor at -5
                CellJson(5, 0, -6, zone: "unpaid"),                        // off-grid -6 in levelBase=2 -> band -8!
                // Implicit street at z=0 with shapes above at z=1:
                CellJson(10, 0, 1, tags: new[] { "half-wall:n" }),         // thin wall leaves street (10,0,0) open
                CellJson(11, 0, 1),                                        // full block buries street (11,0,0)
                CellJson(12, 0, 1, tags: new[] { "tri-upper:n" }),         // tri-upper full base buries street (12,0,0)
                CellJson(13, 0, 1, tags: new[] { "tri-lower:n" }),         // tri-lower leaves street (13,0,0) open
            };
            var read = ReadSave(BaseSave(cells, levelBase: 2));
            var allFloors = new HashSet<StationCellKey>(
                StationZoneMap.Floors(read.Document).Select(f => new StationCellKey(f.X, f.Y, f.Z)));

            Assert.IsFalse(allFloors.Contains(new StationCellKey(0, 0, -5)), "floor.soil must be excluded from ZoneMap");
            Assert.IsFalse(allFloors.Contains(new StationCellKey(1, 0, -5)), "suspended-ceiling must be excluded from ZoneMap");
            Assert.IsFalse(allFloors.Contains(new StationCellKey(2, 0, -5)), "opening-ceiling must be excluded from ZoneMap");
            Assert.IsFalse(allFloors.Contains(new StationCellKey(3, 0, -5)), "thin wall course must be excluded from ZoneMap");
            Assert.IsTrue(allFloors.Contains(new StationCellKey(4, 0, -5)), "ordinary floor must be included");

            // With levelBase=2, storey bands are ..., -8, -3, 2; z=-6 belongs to band -8!
            var bandMinus8 = StationZoneMap.FloorsAt(read.Document, read.Index, -8);
            Assert.IsTrue(bandMinus8.Any(f => f.X == 5 && f.Y == 0 && f.Z == -6),
                "off-grid z=-6 must appear in band -8 when levelBase=2");

            // Implicit street under thin wall vs full / tri-upper.
            var zoneWorld = StationZoneWorld.Build(read.Index);
            Assert.IsTrue(zoneWorld.IsFloor(10, 0, 0), "implicit street under half-wall:n remains floor");
            Assert.IsFalse(zoneWorld.IsFloor(11, 0, 0), "implicit street under full block is buried");
            Assert.IsFalse(zoneWorld.IsFloor(12, 0, 0), "implicit street under tri-upper is buried");
            Assert.IsTrue(zoneWorld.IsFloor(13, 0, 0), "implicit street under tri-lower remains floor");
        }

        [Test]
        public void GroundRulesPreserveStreetUnderVirtualAndDoorwayExitsActAsCeilingRemoveIdempotentlyAndRestoreAfterTrack() {
            // 1. Virtual & doorway exits at z=0 must NOT punch grade GroundHoles in StationCellRenderer.BuildInput (surgical fix #2);
            //    head-house exits DO punch grade GroundHoles.
            var modules = new JArray {
                new JObject { ["id"] = "exit-virt", ["type"] = "exit", ["x"] = 2, ["y"] = 2, ["z"] = 0, ["rot"] = 0, ["cfg"] = new JObject { ["style"] = "virtual", ["name"] = "V" } },
                new JObject { ["id"] = "exit-door", ["type"] = "exit", ["x"] = 6, ["y"] = 2, ["z"] = 0, ["rot"] = 0, ["cfg"] = new JObject { ["style"] = "doorway", ["name"] = "D" } },
                new JObject { ["id"] = "exit-head", ["type"] = "exit", ["x"] = 20, ["y"] = 2, ["z"] = 0, ["rot"] = 0, ["cfg"] = new JObject { ["covered"] = true, ["bays"] = 2, ["name"] = "H" } },
            };
            var exitRead = ReadSave(BaseSave(new JArray { CellJson(0, 0, -5) }, modules));
            var meshInput = StationCellRenderer.BuildInput(exitRead.Document, null, null, null);
            Assert.IsFalse(meshInput.GroundHoles.Contains(new StationCellKey(2, 2, 0)),
                "virtual exit at z=0 must leave street intact in BuildInput.GroundHoles");
            Assert.IsFalse(meshInput.GroundHoles.Contains(new StationCellKey(6, 2, 0)),
                "doorway exit at z=0 must leave street intact in BuildInput.GroundHoles");
            Assert.IsTrue(meshInput.GroundHoles.Contains(new StationCellKey(20, 2, 0)),
                "head-house exit at z=0 must punch grade GroundHole");

            // 2. Virtual street at z=0 acts as ceiling for a clock at z=-5 unless (x,y,0) is explicit void.
            var clockMod = new JObject { ["id"] = "clk-1", ["type"] = "clock", ["x"] = 4, ["y"] = 4, ["z"] = -5, ["rot"] = 0, ["cfg"] = new JObject() };
            var intactStreetRead = ReadSave(BaseSave(new JArray { CellJson(4, 4, -5) }, new JArray { clockMod }));
            var intactMount = StationCeilingMounts.For(intactStreetRead.Document).Resolve(intactStreetRead.Document.Modules[0].Facts, 4.0);
            Assert.AreEqual(StationCeilingMounts.SupportKind.CeilingGround, intactMount.Support,
                "virtual street at z=0 must act as ceiling for z=-5 fixture");
            Assert.AreEqual(0.0, intactMount.Underside, 1e-9);

            var voidStreetRead = ReadSave(BaseSave(new JArray { CellJson(4, 4, -5), CellJson(4, 4, 0, fill: "void") }, new JArray { clockMod }));
            var voidMount = StationCeilingMounts.For(voidStreetRead.Document).Resolve(voidStreetRead.Document.Modules[0].Facts, 4.0);
            Assert.AreEqual(StationCeilingMounts.SupportKind.Fallback, voidMount.Support,
                "explicit void at z=0 removes virtual street ceiling");

            // 3. PlanRemoveCells is idempotent on existing void at grade and on empty non-grade coordinates.
            var voidRead = ReadSave(BaseSave(new JArray { CellJson(3, 3, 0, fill: "void") }));
            var voidWorld = StationCellEditWorld.Build(voidRead.Index);
            var removeVoid = StationCellPlanner.PlanRemoveCells(voidWorld, new[] { new StationCellKey(3, 3, 0) });
            Assert.IsFalse(removeVoid.HasWork, "removing an already-void grade cell must be a no-op");
            var removeAir = StationCellPlanner.PlanRemoveCells(voidWorld, new[] { new StationCellKey(3, 3, 2) });
            Assert.IsFalse(removeAir.HasWork, "removing empty non-grade cell must be a no-op");

            // 4. Ground-level track punches street hole; removing the track restores implicit street.
            var trackSave = BaseSave(null, new JArray {
                new JObject { ["id"] = "trk-1", ["type"] = "track", ["x"] = 0, ["y"] = 0, ["z"] = 0, ["rot"] = 0, ["w"] = 6, ["cfg"] = new JObject { ["line"] = "1" } },
            });
            var withTrack = ReadSave(trackSave);
            Assert.IsTrue(StationZoneWorld.Build(withTrack.Index).IsGroundHole(2, 0), "grade track must punch street hole");
            Assert.IsTrue(StationCellRenderer.BuildInput(withTrack.Document, null, null, null).GroundHoles.Contains(new StationCellKey(2, 0, 0)));

            var withoutTrackJson = StationModuleEdits.Apply(trackSave.ToString(Formatting.None), StationModuleEditMode.Remove, null, "trk-1", out var rmCode);
            Assert.IsNotNull(withoutTrackJson, rmCode);
            var withoutTrack = StationDocumentReader.Read(withoutTrackJson, StationSource.None);
            Assert.IsFalse(StationZoneWorld.Build(withoutTrack.Index).IsGroundHole(2, 0), "removing track must restore street");
            Assert.IsFalse(StationCellRenderer.BuildInput(withoutTrack.Document, null, null, null).GroundHoles.Contains(new StationCellKey(2, 0, 0)));
        }

        /* ======================================================== 2. SAVE & GRID */

        [Test]
        public void SaveReaderAndCandidateRejectAllFourErrorCasesAndRepairMetadataDayLinesAndGround() {
            // 1. All 4 error rejections on both StationSaveCandidate.InspectV1 and StationDocumentReader.Read.
            var badSaves = new[] {
                ("corrupt JSON", "{not-json"),
                ("non-metro-save", "{\"format\":\"other\",\"formatVersion\":1,\"static\":{\"cells\":[]}}"),
                ("formatVersion > 1", "{\"format\":\"metro-save\",\"formatVersion\":2,\"static\":{\"cells\":[]}}"),
                ("missing static.cells", "{\"format\":\"metro-save\",\"formatVersion\":1,\"static\":{}}"),
            };
            foreach (var (label, text) in badSaves) {
                Assert.Throws<FormatException>(() => StationSaveCandidate.InspectV1(text), $"InspectV1 must reject {label}");
                Assert.Throws<StationRejectedException>(() => StationDocumentReader.Read(text, StationSource.None),
                    $"StationDocumentReader.Read must reject {label}");
            }

            // 2. levelBase default 0 and round-trip.
            var defaultBase = ReadSave(BaseSave(levelBase: null));
            Assert.AreEqual(0, defaultBase.Document.LevelBase, "missing levelBase must default to 0");
            var base3 = ReadSave(BaseSave(levelBase: 3));
            Assert.AreEqual(3, base3.Document.LevelBase);
            var base3Reopen = StationDocumentReader.Read(StationDocumentReader.Write(base3.Document, DateTimeOffset.UtcNow), StationSource.None);
            Assert.AreEqual(3, base3Reopen.Document.LevelBase, "levelBase must round-trip through Write/Read");

            // 3. Missing/corrupt service, peaks, demand (incl. flat legacy demand), calendar (Feb 31->28, invalid holiday, workdays stripped).
            foreach (var badDay in new[] {
                new JObject(),
                new JObject { ["service"] = new JArray(), ["peaks"] = new JObject(), ["demand"] = new JArray(), ["calendar"] = new JArray() },
                new JObject {
                    ["service"] = new JObject { ["from"] = 80000, ["to"] = 10000 }, // inverted
                    ["peaks"] = new JArray {
                        new JObject { ["from"] = 70000, ["to"] = 60000 },          // inverted
                        new JObject { ["from"] = 50000, ["to"] = 40000 },          // inverted & before early
                    },
                    ["demand"] = new JObject { ["amPeak"] = 1.8, ["pmPeak"] = 1.2, ["sharpness"] = 0.9 }, // flat legacy demand
                    ["calendar"] = new JObject {
                        ["epoch"] = new JObject { ["year"] = 2026, ["month"] = 2, ["day"] = 31 },
                        ["holidays"] = new JArray { "2026-01-01", "not-a-date", 12345 },
                        ["workdays"] = new JArray { "2026-01-04" },
                    },
                },
            }) {
                var repaired = JObject.Parse(StationDayRepair.RepairJson(badDay.ToString(Formatting.None)));
                Assert.Less((int)repaired["service"]["from"], (int)repaired["service"]["to"]);
                var peaks = (JArray)repaired["peaks"];
                Assert.AreEqual(2, peaks.Count);
                Assert.Less((int)peaks[0]["from"], (int)peaks[0]["to"]);
                Assert.LessOrEqual((int)peaks[0]["to"], (int)peaks[1]["from"]);
                Assert.Less((int)peaks[1]["from"], (int)peaks[1]["to"]);
                Assert.IsNotNull(repaired["demand"]["workday"]);
                Assert.IsNotNull(repaired["demand"]["offday"]);
                Assert.IsNull(repaired["calendar"]["workdays"], "legacy workdays key must be stripped");
            }

            // Specific Feb 31 -> Feb 28, flat legacy demand -> workday, invalid holiday stripped.
            var specificDay = JObject.Parse(StationDayRepair.RepairJson(new JObject {
                ["demand"] = new JObject { ["amPeak"] = 1.8, ["pmPeak"] = 1.2, ["sharpness"] = 0.9 },
                ["calendar"] = new JObject {
                    ["epoch"] = new JObject { ["year"] = 2026, ["month"] = 2, ["day"] = 31 },
                    ["holidays"] = new JArray { "2026-05-01", "bad-holiday", "2026-1-1" },
                    ["workdays"] = new JArray { "2026-05-09" },
                },
            }.ToString(Formatting.None)));
            Assert.AreEqual(28, (int)specificDay["calendar"]["epoch"]["day"], "Feb 31 2026 must clamp to Feb 28");
            CollectionAssert.AreEqual(new[] { "2026-05-01" }, ((JArray)specificDay["calendar"]["holidays"]).Select(t => (string)t).ToArray());
            Assert.AreEqual(1.8, (double)specificDay["demand"]["workday"]["amPeak"], 1e-6, "flat legacy demand populates workday");
            Assert.IsNull(specificDay["calendar"]["workdays"]);

            // 4. nameEn trim & bad type, legacy upTerminus/downTerminus, modelScale normalized without mutating caller JSON.
            var callerSave = BaseSave(
                new JArray {
                    CellJson(1, 0, 0, zone: "unpaid", finish: new JObject { ["top"] = "floor.granite", ["bottom"] = "ceil.steel" }),
                    CellJson(2, 0, 0, tags: new[] { "painted-ground" }, finish: new JObject { ["bottom"] = "ceil.baffle" }),
                },
                null,
                new JArray {
                    new JObject { ["id"] = "1", ["name"] = "1号线", ["colour"] = "#f3d03e", ["stock"] = "A", ["cars"] = 5, ["modelScale"] = 1.25 },
                });
            callerSave["nameEn"] = "  Canton Tower  ";
            string callerBefore = callerSave.ToString(Formatting.None);

            var candidate = StationSaveCandidate.InspectV1(callerSave);
            Assert.AreEqual(callerBefore, callerSave.ToString(Formatting.None), "InspectV1(JObject) must not mutate caller JSON");
            var inspected = JObject.Parse(candidate.InspectJson());
            Assert.AreEqual("Canton Tower", (string)inspected["nameEn"], "nameEn must be trimmed");
            Assert.AreEqual(0.98, (double)inspected["lines"][0]["modelScale"], 1e-9, "modelScale must normalize to 0.98");
            Assert.AreEqual("", (string)inspected["lines"][0]["upTerminus"], "missing upTerminus defaults to empty string");
            Assert.AreEqual("", (string)inspected["lines"][0]["downTerminus"], "missing downTerminus defaults to empty string");

            var badNameEn = BaseSave();
            badNameEn["nameEn"] = 9999;
            Assert.AreEqual("", ReadSave(badNameEn).Document.NameEn, "non-string nameEn must normalize to empty string");

            // Implicit street vs painted/zoned street & finishes round-trip.
            var rtRead = ReadSave(callerSave);
            var rtWritten = StationDocumentReader.Write(rtRead.Document, DateTimeOffset.UtcNow);
            var rtAgain = StationDocumentReader.Read(rtWritten, StationSource.None);
            Assert.IsNull(rtAgain.Index.GetCell(0, 0, 0), "implicit street cell must stay absent from saved cells");
            var c1 = rtAgain.Index.GetCell(1, 0, 0);
            Assert.IsNotNull(c1);
            Assert.AreEqual("unpaid", c1.Zone);
            Assert.AreEqual("floor.granite", c1.FinishOf("top"));
            Assert.AreEqual("ceil.steel", c1.FinishOf("bottom"));
            var c2 = rtAgain.Index.GetCell(2, 0, 0);
            Assert.IsNotNull(c2);
            Assert.IsTrue(c2.HasTag("painted-ground"));
            Assert.AreEqual("ceil.baffle", c2.FinishOf("bottom"));
        }

        [Test]
        public void GridRepairDropsFractional3x3PatchAndSupportedModuleFamiliesCreateIntegerCoordinates() {
            // 1. StationGridRepair drops fractional 3x3 patch (9 cells) while keeping integer cells.
            var cells = new JArray {
                CellJson(0, 0, 0),
                CellJson(1, 0, 0),
            };
            for (int dx = 0; dx < 3; dx++) {
                for (int dy = 0; dy < 3; dy++) {
                    cells.Add(new JObject { ["x"] = dx + 0.5, ["y"] = dy + 0.25, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            var repaired = JObject.Parse(StationGridRepair.RepairJson(new JObject {
                ["cells"] = cells,
                ["modules"] = new JArray(),
            }.ToString(Formatting.None)));
            Assert.AreEqual(9, (int)repaired["droppedCells"], "fractional 3x3 patch (9 cells) must be dropped");
            Assert.AreEqual(2, ((JArray)repaired["cells"]).Count, "integer cells must survive grid repair");

            // 2. Integer-grid sweep over supported StationModuleFamilies.TryCreate options across rotations 0..3 & widths.
            var families = new[] {
                "bench", "bench-steel-2", "fence", "tactile-guide", "floor-mark-boarding",
                "tvm", "vending", "bin", "desk", "guidepost", "urinal", "sink", "tv", "vent",
                "clock", "clock-digital", "cctv", "monitor-ceiling", "monitor-wall",
                "curtain-wall", "glass-2x2", "door-steel-2", "gate", "billboard-wide",
                "calligraphy-kai-h", "sign-ceiling", "sign-wall", "pillar-slim", "pillar-thick",
                "hanger-roof", "hanger-post", "psd-end", "exit-covered-2", "stair", "escalator",
            };
            var hit = new StationPlacementHit(4, 5, 0, 4, 5, 0, true, new StationPoint(4.5, 5.5, 1.0), 1.0);
            int createdCount = 0;
            foreach (var tool in families) {
                foreach (int rot in new[] { 0, 1, 2, 3 }) {
                    foreach (int width in tool == "curtain-wall" ? new[] { 1, 2, 3, 4 } : tool == "hanger-roof" ? new[] { 4, 6, 8 } : new[] { 1 }) {
                        var req = new StationPlacementRequest { ToolType = tool, Rotation = rot, Width = width, Hit = hit };
                        Assert.IsTrue(StationModuleFamilies.TryCreate(req, out var draft, out var reason),
                            $"TryCreate failed for {tool} rot={rot} w={width}: {reason}");
                        Assert.IsNotNull(draft);
                        if (draft.From.HasValue) {
                            Assert.AreEqual(Math.Truncate(draft.From.Value.X), draft.From.Value.X, $"{tool} From.X must be integer");
                            Assert.AreEqual(Math.Truncate(draft.From.Value.Y), draft.From.Value.Y, $"{tool} From.Y must be integer");
                            Assert.AreEqual(Math.Truncate(draft.From.Value.Z), draft.From.Value.Z, $"{tool} From.Z must be integer");
                        }
                        if (draft.To.HasValue) {
                            Assert.AreEqual(Math.Truncate(draft.To.Value.X), draft.To.Value.X, $"{tool} To.X must be integer");
                            Assert.AreEqual(Math.Truncate(draft.To.Value.Y), draft.To.Value.Y, $"{tool} To.Y must be integer");
                            Assert.AreEqual(Math.Truncate(draft.To.Value.Z), draft.To.Value.Z, $"{tool} To.Z must be integer");
                        }
                        var modJson = StationModuleEdits.ToSaveRecord(draft);
                        Assert.IsTrue(StationGridRepair.KeepsModule(modJson),
                            $"created {tool} rot={rot} w={width} must survive StationGridRepair.KeepsModule");
                        createdCount++;
                    }
                }
            }
            Assert.Greater(createdCount, 100);
        }

        /* ================= 3. CEILING CELLS, TANWEI RAISED FLOORS & CONTACT FINISHES */

        [Test]
        public void CeilingClassificationMatchesTianheSlabExclusionsAndMinusFiveBoundary() {
            StationCellMeshResult MeshCells(IEnumerable<StationMeshCell> cells) {
                var input = new StationCellMeshInput {
                    LevelBase = 0, StoreyHeight = 5, VirtualGround = false, BuildGround = false, BuildCeilings = true,
                };
                input.Cells.AddRange(cells);
                return StationCellMesher.Mesh(input);
            }

            // 1. Tianhe -11 untagged ceiling slab above -15 floor classifies as StationSurfaceRole.Ceiling.
            var tianheSlab = new List<StationMeshCell>();
            for (int x = 19; x <= 21; x++) {
                for (int y = -103; y <= -101; y++) {
                    foreach (int z in new[] { -15, -11, -5 }) {
                        tianheSlab.Add(new StationMeshCell { X = x, Y = y, Z = z, Solid = true, Shape = StationCellShape.Full });
                    }
                }
            }
            var tianheMesh = MeshCells(tianheSlab);
            Assert.IsTrue(tianheMesh.Faces.Any(f => f.X == 20 && f.Y == -102 && f.Z == -11 && f.Role == StationSurfaceRole.Ceiling),
                "Tianhe untagged -11 slab above -15 floor must classify into Ceiling role");
            Assert.IsFalse(tianheMesh.Faces.Any(f => f.X == 20 && f.Y == -102 && f.Z == -15 && f.Role == StationSurfaceRole.Ceiling),
                "-15 floor must never classify as Ceiling");
            Assert.IsFalse(tianheMesh.Faces.Any(f => f.X == 20 && f.Y == -102 && f.Z == -5 && f.Role == StationSurfaceRole.Ceiling),
                "-5 floor must never classify as Ceiling");

            // 2. half-wall:n at -11 excluded from Ceiling pass.
            var halfWallSlab = new[] {
                new StationMeshCell { X = 0, Y = 0, Z = -15, Solid = true, Shape = StationCellShape.Full },
                new StationMeshCell { X = 0, Y = 0, Z = -11, Solid = true, Shape = StationCellShape.Half(StationWallSide.N), Flags = StationMeshCellFlags.Wall },
                new StationMeshCell { X = 1, Y = 0, Z = -11, Solid = true, Shape = StationCellShape.Full },
            };
            var halfWallMesh = MeshCells(halfWallSlab);
            Assert.IsFalse(halfWallMesh.Faces.Any(f => f.X == 0 && f.Y == 0 && f.Z == -11 && f.Role == StationSurfaceRole.Ceiling),
                "half-wall:n must be excluded from Ceiling pass");

            // 3. Unsupported slab at -11 (no -15 floor beneath) excluded from Ceiling pass.
            var unsupportedSlab = new[] {
                new StationMeshCell { X = 0, Y = 0, Z = -11, Solid = true, Shape = StationCellShape.Full },
                new StationMeshCell { X = 1, Y = 0, Z = -11, Solid = true, Shape = StationCellShape.Full },
            };
            var unsupportedMesh = MeshCells(unsupportedSlab);
            Assert.IsFalse(unsupportedMesh.Faces.Any(f => f.X == 0 && f.Y == 0 && f.Z == -11 && f.Role == StationSurfaceRole.Ceiling),
                "unsupported untagged slab with no floor beneath must be excluded from Ceiling pass");

            // 4. check-ceiling-floor: -5 floor tagged opening-ceiling / suspended-ceiling stays outside Ceiling pass!
            foreach (var flags in new[] { StationMeshCellFlags.None, StationMeshCellFlags.OpeningCeiling, StationMeshCellFlags.SuspendedCeiling }) {
                var minus5 = new[] {
                    new StationMeshCell { X = 97, Y = -99, Z = -20, Solid = true, Shape = StationCellShape.Full },
                    new StationMeshCell { X = 97, Y = -99, Z = -15, Solid = true, Shape = StationCellShape.Full },
                    new StationMeshCell { X = 97, Y = -99, Z = -5, Solid = true, Shape = StationCellShape.Full, Flags = flags },
                    new StationMeshCell { X = 97, Y = -100, Z = -5, Solid = true, Shape = StationCellShape.Full, Flags = StationMeshCellFlags.OpeningCeiling },
                };
                var mesh = MeshCells(minus5);
                Assert.IsTrue(mesh.Faces.Any(f => f.X == 97 && f.Y == -99 && f.Z == -5 && f.Role != StationSurfaceRole.Ceiling),
                    $"floor at z=-5 (flags={flags}) must remain outside Ceiling pass");
                Assert.IsFalse(mesh.Faces.Any(f => f.X == 97 && f.Y == -99 && f.Z == -5 && f.Role == StationSurfaceRole.Ceiling),
                    $"floor at z=-5 (flags={flags}) must never emit Ceiling role");
            }
        }

        [Test]
        public void TanweiRaisedFloorsAtZ11RemainDrawableAndPickableAtActiveLevel10UnderAutoCeiling() {
            var tanweiPath = Path.Combine(Application.dataPath, "StationDesigner", "Demos", "tanwei.metro.json");
            Assert.IsTrue(File.Exists(tanweiPath), "Missing shipped tanwei.metro.json");
            var raw = JObject.Parse(File.ReadAllText(tanweiPath));

            var mat = new Material(Shader.Find("Hidden/InternalErrorShader") ?? Shader.Find("Standard"));
            unityCleanup.Add(mat);

            // Extract neighborhoods around (15, 2, 11) and (22, -5, 11) from the real Tanwei demo so all 3 tag variants run fast & exact.
            var origCells = (JArray)raw["static"]["cells"];
            var localCells = new JArray();
            foreach (var tok in origCells) {
                var c = (JObject)tok;
                int x = (int)c["x"], y = (int)c["y"];
                if ((Math.Abs(x - 15) <= 3 && Math.Abs(y - 2) <= 3) ||
                    (Math.Abs(x - 22) <= 3 && Math.Abs(y + 5) <= 3)) {
                    localCells.Add(c.DeepClone());
                }
            }
            Assert.IsTrue(localCells.Any(t => (int)t["x"] == 15 && (int)t["y"] == 2 && (int)t["z"] == 11),
                "Tanwei demo must contain raised floor (15,2,11)");
            Assert.IsTrue(localCells.Any(t => (int)t["x"] == 22 && (int)t["y"] == -5 && (int)t["z"] == 11),
                "Tanwei demo must contain raised floor (22,-5,11)");

            var registry = new StationVisibilityRegistry();
            try {
                registry.State.ActiveLevel = 10;
                registry.State.LevelBase = (int)(raw["levelBase"] ?? 0);
                registry.State.StoreyHeight = (int)(raw["storeyHeight"] ?? 5);
                registry.State.AutoCeiling = true;
                registry.State.ShowLevels = false;
                Assert.AreEqual(StationDrawMode.Base, registry.DecidePart(StationPartRole.Slab, new[] { 10 }),
                    "active level 10 slabs draw under AutoCeiling=true");

                foreach (var tag in new[] { null, "opening-ceiling", "suspended-ceiling" }) {
                    var mutated = (JArray)localCells.DeepClone();
                    if (tag != null) {
                        foreach (var tok in mutated) {
                            var c = (JObject)tok;
                            int x = (int)c["x"], y = (int)c["y"], z = (int)c["z"];
                            if (z == 11 && ((x == 15 && y == 2) || (x == 22 && y == -5))) {
                                c["tags"] = new JArray(tag);
                            }
                        }
                    }
                    var doc = ReadSave(BaseSave(mutated, levelBase: registry.State.LevelBase)).Document;
                    var meshInput = StationCellRenderer.BuildInput(doc, null, null, null);
                    meshInput.VirtualGround = false;
                    meshInput.BuildGround = false;

                    var view = StationCellView.Build(new StationCellViewRequest {
                        Mesh = meshInput,
                        ResolveFinish = _ => mat,
                        ToWorld = StationCoordinates.Point,
                        BuildPickMap = true,
                    }, rootObject.transform);
                    cellViews.Add(view);

                    // Apply ActiveLevel=10 + AutoCeiling=true (hide all Ceiling pass and non-level-10 storeys).
                    view.SetVisibleStoreys(new[] { 10 });
                    view.SetRoleVisible(StationSurfaceRole.Ceiling, false);

                    foreach (var (tx, ty) in new[] { (15, 2), (22, -5) }) {
                        // Document (tx + 0.5, ty + 0.5, 13) looking straight down (-Z doc == -Y world).
                        var origin = StationCoordinates.Point(new Vector3(tx + 0.5f, ty + 0.5f, 13f));
                        var ray = new Ray(origin, Vector3.down);
                        Assert.IsTrue(view.TryPick(ray, out var hit),
                            $"Tanwei raised floor ({tx},{ty},11) must stay drawable & pickable under AutoCeiling=true (tag={tag ?? "none"})");
                        Assert.AreEqual(tx, hit.X);
                        Assert.AreEqual(ty, hit.Y);
                        Assert.AreEqual(11, hit.Z);
                        Assert.AreEqual(StationFace.Top, hit.Face);
                        Assert.AreNotEqual(StationSurfaceRole.Ceiling, hit.Role,
                            $"raised floor ({tx},{ty},11) must not be classified as Ceiling (tag={tag ?? "none"})");
                    }
                }
            } finally {
                registry.Dispose();
            }
        }

        [Test]
        public void ContactFinishesSurviveVoidNeighborAndRoundTripThroughTryApplyCellsAndTryUndo() {
            // 1. Void neighbor preserves painted face in StationCellNormalization.NormalizeJson.
            var withVoid = new JArray {
                CellJson(0, 0, 0, finish: new JObject { ["e"] = "wall.enamel", ["top"] = "floor.marble" }),
                CellJson(1, 0, 0, fill: "void"),
            };
            var normVoid = JArray.Parse(StationCellNormalization.NormalizeJson(withVoid.ToString(Formatting.None)));
            Assert.AreEqual("wall.enamel", (string)normVoid[0]["finish"]["e"],
                "void neighbor must preserve painted contact face");
            Assert.AreEqual("floor.marble", (string)normVoid[0]["finish"]["top"]);

            // 2. StationEditSession.TryApplyCells adding solid neighbor clears contact face; TryUndo restores it!
            var host = CreateHost();
            var save = BaseSave(new JArray {
                CellJson(0, 0, -5, finish: new JObject { ["e"] = "wall.enamel", ["top"] = "floor.marble" }),
            });
            Assert.IsTrue(host.OpenDocument(save.ToString(Formatting.None), "contact-rt").Accepted);
            Assert.AreEqual("wall.enamel", host.Index.GetCell(0, 0, -5).FinishOf("e"));

            var addEast = new StationCellPatch();
            addEast.Add(StationCellWrite.Set(new StationCellKey(1, 0, -5), false));
            Assert.IsTrue(StationEditSession.TryApplyCells(host, addEast, "add-east", "cmd-add-east", out var applyRes, out var applyCode),
                applyCode ?? "TryApplyCells failed");
            Assert.IsTrue(applyRes.Accepted);
            Assert.AreEqual("", host.Index.GetCell(0, 0, -5).FinishOf("e"),
                "adding solid east neighbor must clear covered east contact finish");
            Assert.AreEqual("floor.marble", host.Index.GetCell(0, 0, -5).FinishOf("top"),
                "exposed top finish must remain intact");

            Assert.IsTrue(StationEditSession.TryUndo(host, out var undoRes, out var undoCode), undoCode ?? "TryUndo failed");
            Assert.IsTrue(undoRes.Accepted);
            Assert.IsNull(host.Index.GetCell(1, 0, -5), "undo must remove added east neighbor");
            Assert.AreEqual("wall.enamel", host.Index.GetCell(0, 0, -5).FinishOf("e"),
                "undo must restore previously cleared east contact finish");
        }

        /* ====== 4. WEDGES, HALF-WALLS, WALL-CUTS, WALLS, SURFACES, LOCAL-EDIT, FACILITY */

        [Test]
        public void AllEightWedgesMeshToExactHalfCubicMetreFiveFacesOutwardWindingAndDistinctSignatures() {
            var signatures = new HashSet<string>(StringComparer.Ordinal);
            foreach (var tri in new[] { StationTriangleKind.Upper, StationTriangleKind.Lower }) {
                foreach (var side in new[] { StationWallSide.N, StationWallSide.E, StationWallSide.S, StationWallSide.W }) {
                    var input = new StationCellMeshInput { VirtualGround = false, BuildGround = false, BuildCeilings = false };
                    input.Cells.Add(new StationMeshCell {
                        X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Wedge(tri, side),
                    });
                    var res = StationCellMesher.Mesh(input);
                    double volume = SignedMeshVolumeAndCheckOutwardWinding(res);
                    Assert.AreEqual(0.5, volume, 1e-5, $"wedge {tri}:{side} signed volume must be 0.5 m^3");

                    var distinctNormals = new HashSet<string>(StringComparer.Ordinal);
                    var verts = new List<string>();
                    foreach (var g in res.Groups) {
                        for (int i = 0; i < g.Normals.Length; i++) {
                            var n = g.Normals[i];
                            distinctNormals.Add(string.Format(CultureInfo.InvariantCulture, "{0:F3},{1:F3},{2:F3}", n.x, n.y, n.z));
                            var p = g.Positions[i];
                            verts.Add(string.Format(CultureInfo.InvariantCulture, "{0:F3},{1:F3},{2:F3}", p.x, p.y, p.z));
                        }
                    }
                    Assert.AreEqual(5, distinctNormals.Count, $"wedge {tri}:{side} must have exactly 5 distinct faces");
                    verts.Sort(StringComparer.Ordinal);
                    signatures.Add(string.Join("|", verts));
                }
            }
            Assert.AreEqual(8, signatures.Count, "all 8 wedge orientations must produce 8 distinct mesh signatures");
        }

        [Test]
        public void CutBitmasksQuartersLShapeOppositeUnionPlanCutMergeAndRefusalPreserveFinishAndZone() {
            // 1. All 4 half-corner quarters = 0.25 m^3, L-shape (3 quarters) = 0.75 m^3,
            //    adjacent corners -> Half (0.5 m^3), opposite corners -> Cuts (0.5 m^3), full union -> Full (1.0 m^3).
            double MeshShapeVolume(StationCellShape shape) {
                var input = new StationCellMeshInput { VirtualGround = false, BuildGround = false, BuildCeilings = false };
                input.Cells.Add(new StationMeshCell { X = 0, Y = 0, Z = 0, Solid = true, Shape = shape });
                return SignedMeshVolumeAndCheckOutwardWinding(StationCellMesher.Mesh(input));
            }

            foreach (var side in new[] { StationWallSide.N, StationWallSide.E, StationWallSide.S, StationWallSide.W }) {
                Assert.AreEqual(0.25, MeshShapeVolume(StationCellShape.Corner(side)), 1e-5, $"half-corner:{side}");
                Assert.AreEqual(0.5, MeshShapeVolume(StationCellShape.Half(side)), 1e-5, $"half-wall:{side}");
            }

            int nBit = StationCellRules.CornerMask(StationWallSide.N);
            int eBit = StationCellRules.CornerMask(StationWallSide.E);
            int sBit = StationCellRules.CornerMask(StationWallSide.S);
            int wBit = StationCellRules.CornerMask(StationWallSide.W);
            Assert.AreEqual(StationCellRules.HalfMask(StationWallSide.N), nBit | eBit);
            Assert.AreEqual(StationCellShape.Half(StationWallSide.N), StationCellRules.ShapeFromCutMask(nBit | eBit));
            Assert.AreEqual(StationCellShape.Cuts(nBit | sBit), StationCellRules.ShapeFromCutMask(nBit | sBit));
            Assert.AreEqual(StationCellShape.Cuts(nBit | eBit | sBit), StationCellRules.ShapeFromCutMask(nBit | eBit | sBit));
            Assert.AreEqual(StationCellShape.Full, StationCellRules.ShapeFromCutMask(nBit | eBit | sBit | wBit));
            Assert.AreEqual(15, StationCellRules.WallCutMask(new[] { "half-wall:n", "half-wall:s" }));
            Assert.AreEqual(0.75, MeshShapeVolume(StationCellShape.Cuts(nBit | eBit | sBit)), 1e-5, "L-shape 3 quarters = 0.75 m^3");
            Assert.AreEqual(0.50, MeshShapeVolume(StationCellShape.Cuts(nBit | sBit)), 1e-5, "opposite 2 quarters = 0.50 m^3");
            Assert.AreEqual(1.00, MeshShapeVolume(StationCellShape.Full), 1e-5, "full 4-quarter union = 1.00 m^3");

            // CutInnerFaces for L-shape missing SW (wBit): looks S from NW and W from SE.
            var lInner = StationCellRules.CutInnerFaces(nBit | eBit | sBit);
            CollectionAssert.AreEquivalent(new[] { StationFace.S, StationFace.W }, lInner);

            // 2. PlanCut / PlanWalls: merge 4 quarters sequentially -> Full (WallCutMask == 15), 5th piece refused/skipped, finish & zone preserved!
            var save = BaseSave(new JArray {
                CellJson(2, 2, -5, tags: new[] { "wall", "half-corner:n" },
                    finish: new JObject { ["top"] = "floor.marble" }, zone: "paid"),
            });
            string json = save.ToString(Formatting.None);
            var key = new StationCellKey(2, 2, -5);

            foreach (var nextCorner in new[] { StationWallSide.E, StationWallSide.S, StationWallSide.W }) {
                var r = StationDocumentReader.Read(json, StationSource.None);
                var w = StationCellEditWorld.Build(r.Index);
                var check = StationCellPlanner.CutCourseReason(w, 2, 2, -5, StationCellShape.Corner(nextCorner));
                Assert.AreEqual(StationCutVerdict.Merge, check.Verdict, $"merging corner {nextCorner} must succeed");
                var patch = StationCellPlanner.PlanCut(w, new[] { key }, StationCellShape.Corner(nextCorner));
                Assert.IsTrue(patch.HasWork);
                json = StationCellEdits.Apply(json, patch, out var err);
                Assert.IsNotNull(json, err);
            }

            var fullRead = StationDocumentReader.Read(json, StationSource.None);
            var mergedCell = fullRead.Index.GetCell(key);
            Assert.AreEqual(15, StationCellRules.WallCutMask(mergedCell.Tags), "4 merged quarters must have WallCutMask == 15");
            Assert.AreEqual(StationCellShape.Full, StationCellRules.ShapeOf(mergedCell.Tags), "4 merged quarters normalize to Full");
            Assert.AreEqual("floor.marble", mergedCell.FinishOf("top"), "merging cuts must preserve existing finish");
            Assert.AreEqual("paid", mergedCell.Zone, "merging cuts must preserve existing zone");

            // 5th overlapping piece is refused with StationBlockRefusal.Occupied!
            var fullWorld = StationCellEditWorld.Build(fullRead.Index);
            var fifth = StationCellPlanner.CutCourseReason(fullWorld, 2, 2, -5, StationCellShape.Corner(StationWallSide.N));
            Assert.AreEqual(StationCutVerdict.Refuse, fifth.Verdict);
            Assert.AreEqual(StationBlockRefusal.Occupied, fifth.Refusal);
            var fifthPatch = StationCellPlanner.PlanCut(fullWorld, new[] { key }, StationCellShape.Corner(StationWallSide.N));
            Assert.IsFalse(fifthPatch.HasWork, "5th overlapping cut must emit no writes");
        }

        [Test]
        public void AutoWallsSkipTrackAndPlatformEdgeWallSnapAndWallColumnAtMatchSpec() {
            // 1. PlannedAutoWalls skips track footprint and platform-edge cells.
            var autoSave = BaseSave(null, new JArray {
                new JObject { ["id"] = "trk-1", ["type"] = "track", ["x"] = 0, ["y"] = 1, ["z"] = -5, ["rot"] = 0, ["w"] = 4, ["cfg"] = new JObject { ["line"] = "1" } },
                new JObject { ["id"] = "psd-1", ["type"] = "platform-edge", ["x"] = 0, ["y"] = 0, ["z"] = -5, ["rot"] = 0, ["w"] = 4, ["cfg"] = new JObject { ["line"] = "1", ["from"] = "trk-1", ["side"] = "right" } },
            });
            var autoWorld = StationCellEditWorld.Build(ReadSave(autoSave).Index);
            var patchFloor = new List<StationCellKey>();
            for (int x = 0; x < 4; x++)
                for (int y = -2; y <= 0; y++)
                    patchFloor.Add(new StationCellKey(x, y, -5));
            var walls = StationCellPlanner.PlannedAutoWalls(autoWorld, patchFloor, 4);
            // y=0 has platform-edge -> MUST NOT raise wall columns at y=0, while y=-2 outer edge DOES!
            Assert.IsFalse(walls.Any(w => w.Y == 0), "PlannedAutoWalls must skip platform-edge cells");
            Assert.IsFalse(walls.Any(w => w.Y == 1), "PlannedAutoWalls must skip track footprint");
            Assert.IsTrue(walls.Any(w => w.Y == -2 && w.Z == -4), "non-PSD outer edge must still raise auto-walls");

            // 2. WallSnap corner / buried / pointer tie-break matrix.
            // 3x3 slab at z=-5 (x=0..2, y=0..2), plus 5x5 slab at z=-10 (x=0..4, y=0..4) for deep buried cell (2,2,-10).
            var snapCells = new JArray();
            for (int x = 0; x <= 2; x++)
                for (int y = 0; y <= 2; y++)
                    snapCells.Add(CellJson(x, y, -5));
            for (int x = 0; x <= 4; x++)
                for (int y = 0; y <= 4; y++)
                    snapCells.Add(CellJson(x, y, -10));
            var snapWorld = StationCellEditWorld.Build(ReadSave(BaseSave(snapCells)).Index);

            // Clean single edge (1,2,-5) open only on N.
            var singleEdge = StationCellPlanner.WallSnap(snapWorld, new StationCellKey(1, 2, -5), 0, 0, false, 0);
            Assert.AreEqual(new StationCellKey(1, 2, -5), singleEdge.Base);
            Assert.AreEqual(StationWallSide.N, singleEdge.Dir);
            CollectionAssert.AreEqual(new[] { StationWallSide.N }, singleEdge.Dirs);

            // Corner (2,2,-5) open on N and E: offers both in Dirs, R wraps, pointer tie-breaks Dir while Dirs stays constant.
            var corner0 = StationCellPlanner.WallSnap(snapWorld, new StationCellKey(2, 2, -5), 2.9, 2.55, true, 0);
            var corner1 = StationCellPlanner.WallSnap(snapWorld, new StationCellKey(2, 2, -5), 2.9, 2.55, true, 1);
            var corner2 = StationCellPlanner.WallSnap(snapWorld, new StationCellKey(2, 2, -5), 2.9, 2.55, true, 2);
            var cornerNorth = StationCellPlanner.WallSnap(snapWorld, new StationCellKey(2, 2, -5), 2.55, 2.9, true, 0);
            Assert.AreEqual(new StationCellKey(2, 2, -5), corner0.Base);
            Assert.AreEqual(StationWallSide.E, corner0.Dir, "pointer leaning E breaks corner tie to E");
            Assert.AreEqual(StationWallSide.N, corner1.Dir, "R cycle=1 steps to N");
            Assert.AreEqual(StationWallSide.E, corner2.Dir, "R cycle=2 wraps back to E");
            Assert.AreEqual(StationWallSide.N, cornerNorth.Dir, "pointer leaning N breaks corner tie to N");
            CollectionAssert.AreEqual(new[] { StationWallSide.N, StationWallSide.E }, corner0.Dirs);
            CollectionAssert.AreEqual(corner0.Dirs, cornerNorth.Dirs, "pointer tie-break must leave Dirs constant");

            // Buried center of 3x3 (1,1,-5) steps to nearest ring cell (dist=1).
            var buried = StationCellPlanner.WallSnap(snapWorld, new StationCellKey(1, 1, -5), 0, 0, false, 0);
            Assert.AreNotEqual(new StationCellKey(1, 1, -5), buried.Base, "shallow buried cell must step to ring edge");
            Assert.AreEqual(1, Math.Abs(buried.Base.X - 1) + Math.Abs(buried.Base.Y - 1));

            // Deep buried center of 5x5 (2,2,-10) stays put with all 4 dirs.
            var deepBuried = StationCellPlanner.WallSnap(snapWorld, new StationCellKey(2, 2, -10), 0, 0, false, 0);
            Assert.AreEqual(new StationCellKey(2, 2, -10), deepBuried.Base);
            Assert.AreEqual(StationWallSide.S, deepBuried.Dir);
            Assert.AreEqual(4, deepBuried.Dirs.Count);

            // 3. WallColumnAt: stacked half-wall across storeys lifts one storey at a time; doorway gap stops column.
            var colCells = new JArray();
            // Continuous half-wall across two storeys: band 0 (z=1..4) and band 5 (z=5..9).
            for (int z = 1; z <= 9; z++) colCells.Add(CellJson(0, 0, z, tags: new[] { "wall", "half-wall:n" }));
            // Wall with doorway gap at z=2: z=1, (gap at 2), z=3, 4.
            colCells.Add(CellJson(3, 0, 1, tags: new[] { "wall" }));
            colCells.Add(CellJson(3, 0, 3, tags: new[] { "wall" }));
            colCells.Add(CellJson(3, 0, 4, tags: new[] { "wall" }));

            var colWorld = StationCellEditWorld.Build(ReadSave(BaseSave(colCells)).Index);
            var lowerBand = StationCellPlanner.WallColumnAt(colWorld, 0, 0, 2);
            CollectionAssert.AreEqual(new[] { 1, 2, 3, 4 }, lowerBand.Select(c => c.Z).ToArray(),
                "stacked half-wall column must stop at storey boundary (band 0: z=1..4)");
            var upperBand = StationCellPlanner.WallColumnAt(colWorld, 0, 0, 6);
            CollectionAssert.AreEqual(new[] { 5, 6, 7, 8, 9 }, upperBand.Select(c => c.Z).ToArray(),
                "upper storey half-wall column must lift band 5 independently (z=5..9)");

            var aboveDoor = StationCellPlanner.WallColumnAt(colWorld, 3, 0, 3);
            CollectionAssert.AreEqual(new[] { 3, 4 }, aboveDoor.Select(c => c.Z).ToArray(),
                "doorway gap at z=2 must stop WallColumnAt from crossing into z=1");
        }

        [Test]
        public void SurfacesFlood142x142DoubleSuspendedCeilingNonWalkableFinishesAndAll20StockFinishesOnSixFaces() {
            // 1. StationFinishEdits.FloodRegion 142x142 (20,164 cells).
            const int side = 142;
            const int total = side * side;
            var bigSnap = new StationPaintSnapshot { LevelBase = 0, StoreyHeight = 5 };
            for (int y = 0; y < side; y++)
                for (int x = 0; x < side; x++)
                    bigSnap.Add(x, y, -5, true);
            bigSnap.Index();
            var flood = StationFinishEdits.FloodRegion(bigSnap, new StationCellKey(71, 71, -5), StationFace.Top);
            Assert.AreEqual(total, flood.Count, "FloodRegion must flood full 142x142 (20,164 cells) surface");

            // 2. Double suspended ceiling at z=-7 and z=-5 bounds vertical wall flood starting at z=-6 to exactly z=-6 and z=-5.
            var ceilSnap = new StationPaintSnapshot { LevelBase = 0, StoreyHeight = 5 };
            for (int z = -10; z <= -1; z++) ceilSnap.Add(0, 0, z, true, new[] { "wall" });
            ceilSnap.Add(1, 0, -7, true, new[] { "suspended-ceiling" });
            ceilSnap.Add(1, 0, -5, true, new[] { "suspended-ceiling" });
            ceilSnap.Index();
            var wallBand = StationFinishEdits.FloodRegion(ceilSnap, new StationCellKey(0, 0, -6), StationFace.E);
            CollectionAssert.AreEquivalent(new[] { -6, -5 }, wallBand.Select(c => c.Z).ToArray(),
                "double suspended ceilings at z=-7,-5 must bound vertical wall flood to z=-6,-5");

            // 3. floor.track and floor.soil are non-walkable in StationWalkGraphBuilder.
            var walkSave = BaseSave(new JArray {
                CellJson(0, 0, -5, finish: new JObject { ["top"] = "floor.tile" }),
                CellJson(1, 0, -5, finish: new JObject { ["top"] = "floor.track" }),
                CellJson(2, 0, -5, finish: new JObject { ["top"] = "floor.soil" }),
                CellJson(3, 0, -5, finish: new JObject { ["top"] = "floor.concrete" }),
            });
            var walkRead = ReadSave(walkSave);
            var walkDoc = StationSessionProjection.Document(walkRead.Document, walkRead.Index);
            var graph = StationWalkGraphBuilder.Build(walkDoc, new StationWalkGraphOptions { IncludeGround = false });
            Assert.IsTrue(graph.TryNode(0, 0, -5, out _), "floor.tile must be walkable");
            Assert.IsFalse(graph.TryNode(1, 0, -5, out _), "floor.track must be non-walkable");
            Assert.IsFalse(graph.TryNode(2, 0, -5, out _), "floor.soil must be non-walkable");
            Assert.IsTrue(graph.TryNode(3, 0, -5, out _), "floor.concrete must be walkable");

            // 4. All 20 stock finishes paint and mesh cleanly on all 6 faces.
            Assert.AreEqual(20, StockFinishes20.Length);
            var singleSnap = new StationPaintSnapshot { LevelBase = 0, StoreyHeight = 5 };
            singleSnap.Add(0, 0, -5, true);
            singleSnap.Index();

            foreach (var finishId in StockFinishes20) {
                var faceFinish = new StationFinishSet(finishId, finishId, finishId, finishId, finishId, finishId);
                foreach (var face in StationFaces.All) {
                    var res = StationFinishEdits.Paint(singleSnap, new StationPaintRequest {
                        X = 0, Y = 0, Z = -5, Face = face, Finish = finishId, Mode = StationPaintMode.Single,
                    });
                    Assert.IsTrue(res.Accepted, $"Paint failed for {finishId} on {face}: {res.Code}");
                    if (finishId != StationFinishIds.DefaultMaterial) {
                        Assert.AreEqual(1, res.Writes.Count, $"expected 1 write for {finishId} on {face}");
                        Assert.AreEqual(finishId, res.Writes[0].Finish);
                    }
                }
                var meshInput = new StationCellMeshInput { VirtualGround = false, BuildGround = false, BuildCeilings = false };
                meshInput.Cells.Add(new StationMeshCell { X = 0, Y = 0, Z = -5, Solid = true, Shape = StationCellShape.Full, Finish = faceFinish });
                var meshed = StationCellMesher.Mesh(meshInput);
                Assert.AreEqual(6, meshed.Faces.Count, $"{finishId}: expected all 6 faces meshed");
                Assert.IsTrue(meshed.Faces.All(f => f.FinishId == finishId), $"{finishId}: every face must carry {finishId}");
            }
        }

        [Test]
        public void CellEditWorldApplyLocalDeltaMatchesFreshBuildAcrossCutCeilingAndModuleDeltas() {
            var initSave = BaseSave(new JArray {
                CellJson(0, 0, -5, tags: new[] { "auto-floor" }),
                CellJson(1, 0, -5, tags: new[] { "auto-floor" }),
                CellJson(2, 0, -5, tags: new[] { "opening-ceiling" }),
            });
            var r0 = ReadSave(initSave);
            var incWorld = StationCellEditWorld.Build(r0.Index, new StationCellReservations(r0.Index));

            void AssertWorldsAgree(string step, StationCellEditWorld inc, StationIndex idx) {
                var fresh = StationCellEditWorld.Build(idx, new StationCellReservations(idx));
                for (int x = -1; x <= 6; x++) {
                    for (int y = -1; y <= 2; y++) {
                        for (int z = -6; z <= 1; z++) {
                            var incB = StationCellPlanner.BlockReason(inc, x, y, z);
                            var freshB = StationCellPlanner.BlockReason(fresh, x, y, z);
                            Assert.AreEqual(freshB.Ok, incB.Ok, $"{step} BlockReason.Ok at ({x},{y},{z})");
                            Assert.AreEqual(freshB.Refusal, incB.Refusal, $"{step} BlockReason.Refusal at ({x},{y},{z})");
                            CollectionAssert.AreEqual(freshB.Blockers, incB.Blockers, $"{step} Blockers at ({x},{y},{z})");

                            var incC = StationCellPlanner.CutCourseReason(inc, x, y, z, StationCellShape.Corner(StationWallSide.E));
                            var freshC = StationCellPlanner.CutCourseReason(fresh, x, y, z, StationCellShape.Corner(StationWallSide.E));
                            Assert.AreEqual(freshC.Verdict, incC.Verdict, $"{step} CutCourseReason at ({x},{y},{z})");
                            Assert.AreEqual(freshC.Refusal, incC.Refusal, $"{step} CutRefusal at ({x},{y},{z})");
                        }
                    }
                }
            }

            // Step 1: Cut delta (add half-corner:n at (0,0,-4)).
            var cutPatch = StationCellPlanner.PlanCut(incWorld, new[] { new StationCellKey(0, 0, -4) }, StationCellShape.Corner(StationWallSide.N));
            var r1 = StationLocalEdit.TryApplyCells(r0, cutPatch, "local-delta", out var c1);
            Assert.IsNotNull(r1, c1);
            incWorld = incWorld.ApplyLocalDelta(r1.Index, r1.LocalDelta);
            AssertWorldsAgree("after-cut-delta", incWorld, r1.Index);

            // Step 2: Ceiling delta (add suspended-ceiling at (1,0,-1) + support block at (2,0,-6) clearing opening-ceiling).
            var ceilPatch = StationCellPlanner.PlanSuspendedCeiling(incWorld, new[] { new StationCellKey(1, 0, -1) });
            var supportPatch = StationCellPlanner.PlanAddCells(incWorld, new[] { new StationCellKey(2, 0, -6) });
            foreach (var w in supportPatch.Writes) ceilPatch.Add(w);
            var r2 = StationLocalEdit.TryApplyCells(r1, ceilPatch, "local-delta", out var c2);
            Assert.IsNotNull(r2, c2);
            incWorld = incWorld.ApplyLocalDelta(r2.Index, r2.LocalDelta);
            AssertWorldsAgree("after-ceiling-delta", incWorld, r2.Index);

            // Step 3: Module delta (add bench at (1,0,-5)).
            var benchDraft = new StationEditDraft { Id = "bench-local-1", Type = "bench", X = 1, Y = 0, Z = -5, Rotation = 0 };
            benchDraft.Set("variant", "steel-1");
            var r3 = StationLocalEdit.TryApplyModule(r2, StationModuleEditMode.Add, benchDraft, null, "local-delta", out var c3);
            Assert.IsNotNull(r3, c3);
            incWorld = incWorld.ApplyLocalDelta(r3.Index, r3.LocalDelta);
            AssertWorldsAgree("after-module-delta", incWorld, r3.Index);
        }

        [Test]
        public void FacilityBoothBenchSpotsUnionCornerClashRefusalAndInteriorUnwalkability() {
            // 1. BoothBenchSpots across all 4 rotations 0..3 on 4x4 rect (1,1)-(4,4).
            var rect = new StationFacilityRect(1, 1, 4, 4, 0);
            var expected = new[] {
                new[] { (2, 3, 2), (3, 3, 2) }, // front 0
                new[] { (1, 2, 3), (1, 3, 3) }, // front 1
                new[] { (2, 1, 0), (3, 1, 0) }, // front 2
                new[] { (3, 2, 1), (3, 3, 1) }, // front 3
            };
            for (int front = 0; front < 4; front++) {
                var spots = StationFacilityPlanner.BoothBenchSpots(rect, front)
                    .OrderBy(s => s.X).ThenBy(s => s.Y)
                    .Select(s => (s.X, s.Y, s.Rotation))
                    .ToArray();
                CollectionAssert.AreEqual(expected[front], spots, $"BoothBenchSpots mismatch for front={front}");
            }

            // 2. Union corner-clash refusal:
            //    Existing ticket booth at (0,0)-(2,2) and existing info booth at (4,4)-(6,6).
            //    Dragging a new ticket booth at (2,2)-(5,5) overlaps the ticket booth -> union becomes (0,0)-(5,5)
            //    which now catches the info booth at (4,4)-(6,6) -> MUST refuse with Reason == "clash" & BlockedBy == info booth!
            var floor = new JArray();
            for (int x = 0; x <= 8; x++)
                for (int y = 0; y <= 8; y++)
                    floor.Add(CellJson(x, y, -5));
            var mods = new JArray {
                new JObject { ["id"] = "booth-ticket-1", ["type"] = "booth", ["x"] = 0, ["y"] = 0, ["z"] = -5, ["w"] = 3, ["h"] = 3, ["rot"] = 0, ["cfg"] = new JObject { ["kind"] = "ticket" } },
                new JObject { ["id"] = "booth-info-1", ["type"] = "booth", ["x"] = 4, ["y"] = 4, ["z"] = -5, ["w"] = 3, ["h"] = 3, ["rot"] = 0, ["cfg"] = new JObject { ["kind"] = "info" } },
            };
            var clashRead = ReadSave(BaseSave(floor, mods));
            var clashPlan = StationFacilityPlanner.Plan(clashRead.Index, "ticket", new StationFacilityRect(2, 2, 5, 5, -5), 0);
            Assert.IsFalse(clashPlan.Ok, "union corner clash with different-kind booth must be refused");
            Assert.AreEqual("clash", clashPlan.Reason);
            Assert.IsNotNull(clashPlan.BlockedBy);
            Assert.AreEqual("booth-info-1", clashPlan.BlockedBy.Id);

            // 3. Booth interior & footprint unwalkability in StationWalkGraphBuilder.
            var simDoc = StationSessionProjection.Document(clashRead.Document, clashRead.Index);
            var walkGraph = StationWalkGraphBuilder.Build(simDoc, new StationWalkGraphOptions { IncludeGround = false });
            for (int x = 0; x <= 2; x++) {
                for (int y = 0; y <= 2; y++) {
                    Assert.IsFalse(walkGraph.TryNode(x, y, -5, out _),
                        $"booth footprint cell ({x},{y},-5) must be unwalkable in StationWalkGraph");
                }
            }
            Assert.IsTrue(walkGraph.TryNode(3, 0, -5, out _), "floor immediately outside booth must stay walkable");
        }
    }
}
