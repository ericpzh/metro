using System;
using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// Acceptance test suite for Plan 39 runtime parity review fixes (§1, §2, §5, §6, §7, §8, §9).
    /// </summary>
    public sealed class StationPlan39ParityFixesTests {
        readonly List<GameObject> cleanup = new List<GameObject>();

        [TearDown]
        public void TearDown() {
            for (int i = cleanup.Count - 1; i >= 0; i--) {
                if (cleanup[i] != null) UnityEngine.Object.DestroyImmediate(cleanup[i]);
            }
            cleanup.Clear();
            StationWorldView.LocalStageFailureInjector = null;
            StationEditHost.ResetForTests();
            StationEditSession.Reset();
            StationToolSelection.Reset();
            StationCellTool.Reset();
            StationZoneTool.Reset();
            StationRoadTool.Reset();
            StationScenePicker.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        StationGameHost CreateHost(string saveJson, string sourceId = "plan39", bool withRoadRenderer = false, bool withEditHandler = false) {
            StationRenderers.Clear();
            StationRenderers.Add(new StationCellRenderer());
            if (withRoadRenderer) StationRenderers.Add(new StationRoadRenderer());
            StationRenderers.Add(new StationEquipmentModuleRenderer());
            StationRenderers.Add(new OpeningModuleRenderer());
            StationRenderers.Add(new VerticalModuleRenderer());
            if (withEditHandler) StationCommandHandlers.Add(new StationEditCommandHandler());

            var go = new GameObject("plan39-host");
            cleanup.Add(go);
            var host = go.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            host.catalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            host.trainCatalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            host.stationShader = StationFinishLibrary.FindShader();
            typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(host, null);
            var opened = host.OpenDocument(saveJson, sourceId);
            Assert.IsTrue(opened.Accepted, opened.Rejection?.Reason ?? "open failed");
            return host;
        }

        static StationSceneHit FloorHit(int x, int y, int z) => Metro.EditModeTests.StationCellFixture.Hit(x, y, z, true);

        static StationPointerEvent Ptr(int button = 0) =>
            StationPointerEvent.Synthetic(100f, 100f, 800f, 600f, button: button, modifiers: 0, timeMs: 1000);

        static void SelectTool(string tool, JObject settings) {
            Assert.IsTrue(StationToolSelection.TrySelect(tool, out _, out var err), err);
            StationToolSelection.ApplySettings(settings);
        }

        static string MakeCommand(string id, string sessionId, string type, JObject payload, int? expectedRevision = null) {
            var env = new JObject {
                ["schemaVersion"] = 2,
                ["id"] = id,
                ["sessionId"] = sessionId,
                ["type"] = type,
                ["payload"] = payload ?? new JObject(),
            };
            if (expectedRevision.HasValue) env["expectedRevision"] = expectedRevision.Value;
            return env.ToString(Newtonsoft.Json.Formatting.None);
        }

        // =====================================================================
        // Item 1: Restore room-purpose painting (store / toilet / office)
        // =====================================================================

        [Test]
        public void Item1_RoomPurposeBrushesPaintFloorPreserveZoneAndWallsEraseOverSavedShopAndKeepTicketInfoBooths() {
            // 10x6 floor slab at z=-5 with paid/unpaid zones, a wall block at (0,0,-4),
            // and a pre-existing saved `shop` module spanning (6..8, 1..3, -5).
            var cells = new JArray();
            for (int x = 0; x < 10; x++) {
                for (int y = 0; y < 6; y++) {
                    cells.Add(new JObject {
                        ["x"] = x, ["y"] = y, ["z"] = -5, ["fill"] = "solid",
                        ["zone"] = x < 5 ? "unpaid" : "paid",
                    });
                }
            }
            cells.Add(new JObject {
                ["x"] = 0, ["y"] = 0, ["z"] = -4, ["fill"] = "solid",
                ["tags"] = new JArray("wall"),
            });
            var modules = new JArray {
                new JObject {
                    ["id"] = "shop-legacy", ["type"] = "shop",
                    ["x"] = 6, ["y"] = 1, ["z"] = -5, ["rot"] = 0, ["w"] = 3, ["h"] = 3, ["d"] = 1,
                    ["cfg"] = new JObject { ["kind"] = "store" },
                },
            };
            var save = new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["name"] = "RoomBrushTest",
                ["city"] = "guangzhou", ["seed"] = 1, ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            }.ToString(Newtonsoft.Json.Formatting.None);

            var host = CreateHost(save, "room-brush");
            int initialModules = host.Index.Document.ModuleCount;
            int initialCells = host.Index.Document.Cells.Count;

            string[] roomBrushes = { "store", "toilet", "office" };
            for (int b = 0; b < roomBrushes.Length; b++) {
                string brush = roomBrushes[b];
                SelectTool("zone", new JObject { ["zoneBrush"] = brush });

                // Single-cell click MUST succeed (never fail with min-size), set Cell.Room, keep Cell.Zone & wall, add 0 modules.
                int cx = 1 + b;
                Assert.IsTrue(StationZoneTool.Begin(host, FloorHit(cx, 1, -5), Ptr(0), 0, out var bReason), brush + " begin: " + bReason);
                Assert.IsTrue(StationZoneTool.Finish(host, FloorHit(cx, 1, -5), Ptr(0), out var fCode, out var fReason), brush + " finish: " + (fCode ?? fReason));
                var painted = host.Index.GetCell(cx, 1, -5);
                Assert.AreEqual(brush, painted.Room, brush + " click should set Cell.Room");
                Assert.AreEqual("unpaid", painted.Zone, brush + " click must preserve Cell.Zone");
                Assert.AreEqual(initialModules, host.Index.Document.ModuleCount, brush + " click must not create a facility module");
                Assert.AreEqual(initialCells, host.Index.Document.Cells.Count, brush + " click must not add walls/cells");

                // Drag across 2 cells including across the unpaid/paid boundary.
                Assert.IsTrue(StationZoneTool.Begin(host, FloorHit(4, 2 + b, -5), Ptr(0), 0, out bReason), brush + " drag begin: " + bReason);
                StationZoneTool.Aim(host, FloorHit(5, 2 + b, -5), Ptr(0));
                Assert.IsTrue(StationZoneTool.Finish(host, FloorHit(5, 2 + b, -5), Ptr(0), out fCode, out fReason), brush + " drag finish: " + (fCode ?? fReason));
                Assert.AreEqual(brush, host.Index.GetCell(4, 2 + b, -5).Room);
                Assert.AreEqual("unpaid", host.Index.GetCell(4, 2 + b, -5).Zone);
                Assert.AreEqual(brush, host.Index.GetCell(5, 2 + b, -5).Room);
                Assert.AreEqual("paid", host.Index.GetCell(5, 2 + b, -5).Zone);
                Assert.AreEqual(initialModules, host.Index.Document.ModuleCount);

                // Right-click erase removes ONLY Cell.Room while preserving Cell.Zone.
                Assert.IsTrue(StationZoneTool.Begin(host, FloorHit(cx, 1, -5), Ptr(2), 2, out bReason), brush + " right erase begin: " + bReason);
                Assert.IsTrue(StationZoneTool.Finish(host, FloorHit(cx, 1, -5), Ptr(2), out fCode, out fReason), brush + " right erase finish: " + (fCode ?? fReason));
                Assert.AreEqual("", host.Index.GetCell(cx, 1, -5).Room);
                Assert.AreEqual("unpaid", host.Index.GetCell(cx, 1, -5).Zone);

                // Undo restores room purpose; redo erases it again.
                Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var uCode), uCode);
                Assert.AreEqual(brush, host.Index.GetCell(cx, 1, -5).Room);
                Assert.IsTrue(StationEditSession.TryRedo(host, out _, out var rCode), rCode);
                Assert.AreEqual("", host.Index.GetCell(cx, 1, -5).Room);
            }

            // Paint room purpose over saved `shop` footprint, then right-drag erase while `store` is armed:
            // floor purpose erases and saved `shop` module survives untouched!
            SelectTool("zone", new JObject { ["zoneBrush"] = "store" });
            Assert.IsTrue(StationZoneTool.Begin(host, FloorHit(7, 2, -5), Ptr(0), 0, out _));
            Assert.IsTrue(StationZoneTool.Finish(host, FloorHit(7, 2, -5), Ptr(0), out _, out _));
            Assert.AreEqual("store", host.Index.GetCell(7, 2, -5).Room);

            Assert.IsTrue(StationZoneTool.Begin(host, FloorHit(7, 2, -5), Ptr(2), 2, out var shopEraseBegin), shopEraseBegin);
            StationZoneTool.Aim(host, FloorHit(8, 2, -5), Ptr(2));
            Assert.IsTrue(StationZoneTool.Finish(host, FloorHit(8, 2, -5), Ptr(2), out var shopEraseCode, out var shopEraseReason), shopEraseCode ?? shopEraseReason);
            Assert.AreEqual("", host.Index.GetCell(7, 2, -5).Room, "right-drag over saved shop must erase floor room purpose");
            Assert.AreEqual("paid", host.Index.GetCell(7, 2, -5).Zone, "fare zone must survive erasing room purpose");
            Assert.IsTrue(host.Index.TryGetModule("shop-legacy", out _), "saved shop module must survive floor erase");

            // Ticket & Info stay on the booth counter path (drag creates 3x3 booth, right-click removes booth).
            foreach (var boothBrush in new[] { "ticket", "info" }) {
                SelectTool("zone", new JObject { ["zoneBrush"] = boothBrush, ["facilityRot"] = 0 });
                Assert.IsTrue(StationZoneTool.Begin(host, FloorHit(1, 3, -5), Ptr(0), 0, out var tbReason), boothBrush + ": " + tbReason);
                StationZoneTool.Aim(host, FloorHit(3, 5, -5), Ptr(0));
                Assert.IsTrue(StationZoneTool.Finish(host, FloorHit(3, 5, -5), Ptr(0), out var tfCode, out var tfReason), boothBrush + ": " + (tfCode ?? tfReason));
                var placedBooth = host.Index.Document.Modules.FirstOrDefault(m => m.Type == "booth");
                Assert.IsNotNull(placedBooth, boothBrush + " drag must create a booth module");

                // Right-click on the booth removes it immediately without opening a drag gesture.
                Assert.IsTrue(StationZoneTool.Begin(host, FloorHit(1, 3, -5), Ptr(2), 2, out var rbReason), boothBrush + " remove: " + rbReason);
                Assert.IsFalse(StationZoneTool.HasGesture, "immediate booth removal must not leave an open gesture");
                Assert.IsNull(host.Index.Document.Modules.FirstOrDefault(m => m.Id == placedBooth.Id), boothBrush + " booth must be removed");
            }
            Assert.IsNotNull(host.Index.GetCell(0, 0, -4), "authored wall block must survive all zone/room gestures");
        }

        // =====================================================================
        // Item 2: Gate reachability independent of rotation
        // =====================================================================

        static StationSessionDocument MakeGateCorridorDoc(int rot, string dirMode) {
            var doc = new StationSessionDocument { StationId = "gate-rot-" + rot + "-" + dirMode, LevelBase = 0 };
            for (int x = 0; x <= 6; x++) {
                doc.Cells.Add(new StationCellFact {
                    X = x, Y = 0, Z = 0, Solid = true, Speed = 1.0,
                    Zone = x < 3 ? 2 : 3,
                });
            }
            int gateDir = dirMode == "in" ? 1 : dirMode == "out" ? -1 : 0;
            doc.Modules.Add(new StationModuleFact {
                Id = "g1", Type = "gate", X = 3, Y = 0, Z = 0, Rot = rot, Width = 1, Depth = 1,
                Dir = dirMode, GateDir = gateDir, GateOpen = true, GateHasLane = true,
            });
            return doc;
        }

        static int TotalEdges(StationWalkGraph g) {
            int sum = 0;
            for (int i = 0; i < g.NodeCount; i++) sum += g.AdjTo[i].Length;
            return sum;
        }

        static bool SparseCanRoute(StationWalkGraph graph, int start, int goal) {
            var router = new StationSparseRouter(graph, 7, null);
            router.BeginTick(1, null, null);
            var st = router.StartCoarseSearch(start, goal, StationRouteNeeds.Walking, -1, 0, 1, out var itin, out int jid);
            if (st == StationSparseRouter.CoarseJobStatus.Running && jid >= 0) {
                var done = router.StepCoarseJobNow(jid, 20000, 80000);
                itin = done != null && done.Status == StationSparseRouter.CoarseJobStatus.Ready ? done.Result : null;
            }
            return itin != null;
        }

        static StationSessionDocument MakeLiveGateFlowDoc(int rot) {
            var doc = new StationSessionDocument { StationId = "live-gate-rot-" + rot, LevelBase = 0 };
            for (int x = 0; x <= 50; x++) {
                doc.Cells.Add(new StationCellFact {
                    X = x, Y = 0, Z = 0, Solid = true, Speed = 1.0,
                    Zone = x <= 4 ? 2 : 3,
                });
            }
            doc.Modules.Add(new StationModuleFact {
                Id = "exit", Type = "exit", X = 0, Y = 0, Z = 0, Rot = 0, Name = "A",
                HeadHouse = false, HasExitInRate = true, ExitInRate = 6000,
            });
            doc.Modules.Add(new StationModuleFact {
                Id = "g1", Type = "gate", X = 5, Y = 0, Z = 0, Rot = rot,
                GateDir = 1, GateOpen = true, GateHasLane = true,
            });
            doc.Modules.Add(new StationModuleFact {
                Id = "track-1", Type = "track", X = 10, Y = -1, Z = 0, Rot = 0, Width = 40, Depth = 1,
                LineId = "2", Dir = "up",
            });
            doc.Modules.Add(new StationModuleFact {
                Id = "edge-1", Type = "platform-edge", X = 10, Y = 0, Z = 0, Rot = 0, Width = 40,
                LineId = "2", RailId = "track-1", Dir = "up", Side = "right",
            });
            doc.Lines.Add(new StationLineFact {
                Id = "2", Direction = "up", Stock = "B", Cars = 2, ModelScale = 0.98,
                HeadwayPeak = 60, HeadwayOffpeak = 90, HeadwayLate = 180,
                AlightPerTrain = 0, AuthoredAlight = true,
            });
            return doc;
        }

        [Test]
        public void Item2_GateReachabilityIsIndependentOfRotationAcrossDenseSparseBarriersAndIncrementalDelta() {
            string[] modes = { "in", "out", "both" };
            for (int rot = 0; rot < 4; rot++) {
                foreach (var mode in modes) {
                    var doc = MakeGateCorridorDoc(rot, mode);
                    var graph = StationWalkGraphBuilder.Build(doc, new StationWalkGraphOptions { ZoneBarriers = true });
                    var ws = StationWalkGraphBuilder.BuildWorkspace(doc, new StationWalkGraphOptions { ZoneBarriers = true });
                    Assert.IsTrue(graph.TryNode(0, 0, 0, out int unpaidStart));
                    Assert.IsTrue(graph.TryNode(2, 0, 0, out int unpaidBeforeGate));
                    Assert.IsTrue(graph.TryNode(3, 0, 0, out int gateNode));
                    Assert.IsTrue(graph.TryNode(6, 0, 0, out int paidEnd));

                    var dense = new StationRoutePlanner(graph);
                    bool expectIn = mode == "in" || mode == "both";
                    bool expectOut = mode == "out" || mode == "both";

                    bool denseIn = dense.Search(unpaidStart, paidEnd, default).Found;
                    bool denseOut = dense.Search(paidEnd, unpaidStart, default).Found;
                    bool sparseIn = SparseCanRoute(graph, unpaidStart, paidEnd);
                    bool sparseOut = SparseCanRoute(graph, paidEnd, unpaidStart);

                    Assert.AreEqual(expectIn, denseIn, $"dense in rot={rot} mode={mode}");
                    Assert.AreEqual(expectOut, denseOut, $"dense out rot={rot} mode={mode}");
                    Assert.AreEqual(expectIn, sparseIn, $"sparse in rot={rot} mode={mode}");
                    Assert.AreEqual(expectOut, sparseOut, $"sparse out rot={rot} mode={mode}");

                    // Same-side travel remains available regardless of rotation or mode.
                    Assert.IsTrue(dense.Search(unpaidStart, unpaidBeforeGate, default).Found, $"same-side unpaid rot={rot} mode={mode}");
                    Assert.IsTrue(dense.Search(gateNode, paidEnd, default).Found, $"same-side paid rot={rot} mode={mode}");

                    // Workspace edges match full build verbatim.
                    Assert.AreEqual(TotalEdges(graph), TotalEdges(ws.Graph), $"workspace edge parity rot={rot} mode={mode}");

                    // Gate rotation metadata stays preserved for 3D animation.
                    Assert.IsTrue(graph.ServerForNode.TryGetValue(gateNode, out int srvIdx));
                    Assert.AreEqual(rot, graph.Servers[srvIdx].GateRotation);

                    // Disabled barriers permits both directions across all 4 rotations.
                    var openGraph = StationWalkGraphBuilder.Build(doc, new StationWalkGraphOptions { ZoneBarriers = false });
                    var openDense = new StationRoutePlanner(openGraph);
                    Assert.IsTrue(openDense.Search(unpaidStart, paidEnd, default).Found, $"no-barriers in rot={rot} mode={mode}");
                    Assert.IsTrue(openDense.Search(paidEnd, unpaidStart, default).Found, $"no-barriers out rot={rot} mode={mode}");
                }
            }

            // Incremental gate rotation edit through StageCellDelta matches a fresh Build verbatim.
            var docBefore = MakeGateCorridorDoc(0, "in");
            var wsEdit = StationWalkGraphBuilder.BuildWorkspace(docBefore, new StationWalkGraphOptions { ZoneBarriers = true });
            var docAfter = MakeGateCorridorDoc(1, "in");
            var delta = new StationSessionDelta();
            delta.ChangedModules.Add(docAfter.Modules[0]);
            var staged = StationWalkGraphBuilder.StageCellDelta(wsEdit, docAfter, delta);
            Assert.IsNotNull(staged.Graph);
            var freshAfter = StationWalkGraphBuilder.Build(docAfter, new StationWalkGraphOptions { ZoneBarriers = true });
            Assert.AreEqual(freshAfter.NodeCount, staged.Graph.NodeCount);
            Assert.AreEqual(TotalEdges(freshAfter), TotalEdges(staged.Graph));
            Assert.IsTrue(staged.Graph.TryNode(3, 0, 0, out int gNode));
            Assert.AreEqual(1, staged.Graph.Servers[staged.Graph.ServerForNode[gNode]].GateRotation);

            // Live StationServiceRuntime gate reservation, queue admission, and boarding work across all 4 rotations
            // (including perpendicular rotations 0 and 2 on an east-west corridor).
            var day = new StationDayData(
                new DaySpan(0, StationClock.ServiceLatest),
                new PeakSpans(new DaySpan(7 * 3600, 10 * 3600), new DaySpan(17 * 3600, 20 * 3600)),
                new DayDemand(new DemandKnobs(1.2, 0.78, 1.0), DemandKnobs.DefaultOffday),
                new SimCalendar(new SimDate(2026, 1, 5), Array.Empty<string>()));
            for (int rot = 0; rot < 4; rot++) {
                var session = new StationSimulationSession(new StationSessionSetup {
                    Document = MakeLiveGateFlowDoc(rot),
                    Day = day,
                    Seed = 7,
                    StartSimTime = 8 * 3600,
                    StartPlaying = true,
                    WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
                    Services = new StationServiceOptions { RoutingMode = StationRoutingMode.Legacy },
                });
                for (int t = 0; t < 200; t++) session.Advance(1.0);
                Assert.Greater(session.Services.Boarded, 0, $"live boarding through entry gate must succeed for rot={rot}");
                Assert.AreEqual(0, session.Services.Stuck, $"entry passengers must not strand at gate for rot={rot}");
            }
        }

        // =====================================================================
        // Item 5 (C# lineId in commit) & Item 6 (C# carried move lifecycle)
        // =====================================================================

        [Test]
        public void Item5And6_HostEmitsLineIdOnAddAndPreservesCarriedMoveAcrossPointerLeaveConfirmCancelAndReplace() {
            var cells = new JArray();
            for (int x = 0; x < 8; x++)
                for (int y = 0; y < 6; y++)
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = -5, ["fill"] = "solid", ["zone"] = "unpaid" });
            var modules = new JArray {
                new JObject { ["id"] = "bench-1", ["type"] = "bench", ["x"] = 2, ["y"] = 2, ["z"] = -5, ["rot"] = 0, ["w"] = 1, ["h"] = 1, ["d"] = 1 },
                new JObject { ["id"] = "bench-blocker", ["type"] = "bench", ["x"] = 4, ["y"] = 2, ["z"] = -5, ["rot"] = 0, ["w"] = 1, ["h"] = 1, ["d"] = 1 },
            };
            var lines = new JArray {
                new JObject { ["id"] = "1", ["name"] = "1号线", ["color"] = "#f3d03e", ["stock"] = "A", ["cars"] = 6, ["direction"] = "up" },
            };
            var save = new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["name"] = "ShellHostTest",
                ["city"] = "guangzhou", ["seed"] = 1, ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = lines },
            }.ToString(Newtonsoft.Json.Formatting.None);

            var host = CreateHost(save, "shell-host", withEditHandler: true);
            var router = host.Router;

            // Item 5: edit.line.add returns commit with payload.lineId == "2".
            int revBeforeAdd = host.CurrentRevision;
            var addReply = JObject.Parse(router.Handle(MakeCommand("c-add-line", "s-1", "edit.line.add", new JObject { ["direction"] = "up" }, revBeforeAdd)));
            Assert.AreEqual("commit", (string)addReply["kind"]);
            Assert.AreEqual("c-add-line", (string)addReply["id"]);
            Assert.AreEqual("2", (string)addReply["payload"]?["lineId"], "commit reply must carry created lineId");

            // Stale expectedRevision refuses cleanly without adding a line.
            var staleReply = JObject.Parse(router.Handle(MakeCommand("c-stale", "s-1", "edit.line.add", new JObject(), revBeforeAdd)));
            Assert.AreEqual("reject", (string)staleReply["kind"]);
            Assert.AreEqual(2, host.Index.Document.Lines.Count);

            // Item 6: edit.move.start parks valid plan on bench-1; pointer.leave preserves carried state & plan!
            int revBeforeMove = host.CurrentRevision;
            var startReply = JObject.Parse(router.Handle(MakeCommand("c-move-start", "s-1", "edit.move.start", new JObject { ["moduleId"] = "bench-1" })));
            Assert.AreEqual("ack", (string)startReply["kind"]);
            Assert.AreEqual("bench-1", StationEditSession.CarriedId);
            Assert.IsNotNull(StationEditSession.Plan);
            Assert.IsTrue(StationEditSession.Plan.IsMove);

            // Aim directly at an invalid occupied cell (bench-blocker at 4,2,-5) -> plan.Ok == false, reason == occupied.
            host.Index.TryGetModule("bench-1", out var benchMod);
            var badHit = new StationPlacementHit(4, 2, -5, 4, 2, -5, true, new StationPoint(4.5, 2.5, -4), -4, new StationPoint(0, 0, 1));
            StationEditSession.Plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                Carried = benchMod, Rotation = 0, Hit = badHit, ModulePoint = badHit.Point,
            });
            Assert.IsFalse(StationEditSession.Plan.Ok);
            Assert.AreEqual("occupied", StationEditSession.Plan.Reason);

            // Confirm on invalid target does not bump revision and leaves carried active.
            router.Handle(MakeCommand("c-confirm-bad", "s-1", "edit.move.confirm", new JObject()));
            Assert.AreEqual(revBeforeMove, host.CurrentRevision);
            Assert.AreEqual("bench-1", StationEditSession.CarriedId);

            // Cancel via edit.cancel clears carried & plan with zero revision change.
            router.Handle(MakeCommand("c-cancel", "s-1", "edit.cancel", new JObject()));
            Assert.AreEqual(revBeforeMove, host.CurrentRevision);
            Assert.IsFalse(StationEditSession.HasCarried);
            Assert.IsNull(StationEditSession.Plan);

            // Start again, aim at valid cell (6, 2, -5), fire pointer.leave (mouse moving onto InfoCard), then confirm!
            router.Handle(MakeCommand("c-move-start-2", "s-1", "edit.move.start", new JObject { ["moduleId"] = "bench-1" }));
            var goodHit = new StationPlacementHit(6, 2, -5, 6, 2, -5, true, new StationPoint(6.5, 2.5, -4), -4, new StationPoint(0, 0, 1));
            StationEditSession.Plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                Carried = benchMod, Rotation = 0, Hit = goodHit, ModulePoint = goodHit.Point,
            });
            Assert.IsTrue(StationEditSession.Plan.Ok);

            router.Handle(MakeCommand("c-leave", "s-1", "pointer.leave", new JObject()));
            Assert.IsTrue(StationEditSession.HasCarried, "pointer.leave must retain carried piece for InfoCard Confirm");
            Assert.IsNotNull(StationEditSession.Plan, "pointer.leave must retain parked placement plan for InfoCard Confirm");

            var confirmReply = JObject.Parse(router.Handle(MakeCommand("c-confirm-good", "s-1", "edit.move.confirm", new JObject())));
            Assert.AreEqual("commit", (string)confirmReply["kind"]);
            Assert.AreEqual(revBeforeMove + 1, host.CurrentRevision);
            Assert.IsFalse(StationEditSession.HasCarried, "confirmed drop must clear carried state");
            Assert.IsTrue(host.Index.TryGetModule("bench-1", out var movedBench));
            Assert.AreEqual(6, movedBench.X);

            // Single undo restores the piece to (2, 2, -5).
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var undoCode), undoCode);
            Assert.IsTrue(host.Index.TryGetModule("bench-1", out var restoredBench));
            Assert.AreEqual(2, restoredBench.X);

            // Station replacement clears any active carried state.
            router.Handle(MakeCommand("c-move-start-3", "s-1", "edit.move.start", new JObject { ["moduleId"] = "bench-1" }));
            Assert.IsTrue(StationEditSession.HasCarried);
            host.OpenDocument(save, "replaced");
            Assert.IsFalse(StationEditSession.HasCarried, "station replacement must clear carried state");
            Assert.IsNull(StationEditSession.Plan);
        }

        // =====================================================================
        // Item 7: Apply berth ownership before legacy platform fallback
        // =====================================================================

        [Test]
        public void Item7_BerthOwnershipBeatsLegacyPlatformFallbackAcrossSimViewsDoorsAndBothHeadings() {
            // Test all 4 scenarios across BOTH headings (up = +1, down = -1):
            // (a) Mixed save: explicit left bound to track-1 + opposite unbound legacy right on same direction -> ONLY left (mask 1 / flipped 2)
            // (b) Legacy-only save: unbound right edge matching line & direction -> right (mask 2 / flipped 1)
            // (c) True two-sided berth: explicit left & explicit right -> both (mask 3 / 3)
            // (d) No platform berth: track only -> 0
            string[] dirs = { "up", "down" };
            foreach (var dir in dirs) {
                int sign = dir == "down" ? -1 : 1;

                // (a) Mixed save
                var mixedJson = BuildBerthFixtureJson(dir,
                    new JObject { ["id"] = "edge-explicit", ["type"] = "platform-edge", ["x"] = 0, ["y"] = 3, ["z"] = -5, ["rot"] = 0, ["w"] = 10, ["h"] = 1, ["d"] = 1,
                        ["cfg"] = new JObject { ["line"] = "1", ["from"] = "track-1", ["side"] = "left", ["dir"] = dir, ["psd"] = "full" } },
                    new JObject { ["id"] = "edge-legacy", ["type"] = "platform-edge", ["x"] = 0, ["y"] = -1, ["z"] = -5, ["rot"] = 0, ["w"] = 10, ["h"] = 1, ["d"] = 1,
                        ["cfg"] = new JObject { ["line"] = "1", ["side"] = "right", ["dir"] = dir, ["psd"] = "full" } });
                AssertBerthCase("mixed-" + dir, mixedJson, dir, expectedTrackSides: 1,
                    expectedBankMask: sign > 0 ? 1 : 2, expectedPlatformPoints: 1,
                    expectedOwnedEdgeIds: new[] { "edge-explicit" }, expectedUnownedEdgeIds: new[] { "edge-legacy" });

                // (b) Legacy-only save
                var legacyJson = BuildBerthFixtureJson(dir,
                    new JObject { ["id"] = "edge-legacy-only", ["type"] = "platform-edge", ["x"] = 0, ["y"] = -1, ["z"] = -5, ["rot"] = 0, ["w"] = 10, ["h"] = 1, ["d"] = 1,
                        ["cfg"] = new JObject { ["line"] = "1", ["side"] = "right", ["dir"] = dir, ["psd"] = "full" } });
                AssertBerthCase("legacy-" + dir, legacyJson, dir, expectedTrackSides: 2,
                    expectedBankMask: sign > 0 ? 2 : 1, expectedPlatformPoints: 1,
                    expectedOwnedEdgeIds: new[] { "edge-legacy-only" }, expectedUnownedEdgeIds: Array.Empty<string>());

                // (c) True two-sided berth
                var bothJson = BuildBerthFixtureJson(dir,
                    new JObject { ["id"] = "edge-l", ["type"] = "platform-edge", ["x"] = 0, ["y"] = 3, ["z"] = -5, ["rot"] = 0, ["w"] = 10, ["h"] = 1, ["d"] = 1,
                        ["cfg"] = new JObject { ["line"] = "1", ["from"] = "track-1", ["side"] = "left", ["dir"] = dir, ["psd"] = "full" } },
                    new JObject { ["id"] = "edge-r", ["type"] = "platform-edge", ["x"] = 0, ["y"] = -1, ["z"] = -5, ["rot"] = 0, ["w"] = 10, ["h"] = 1, ["d"] = 1,
                        ["cfg"] = new JObject { ["line"] = "1", ["from"] = "track-1", ["side"] = "right", ["dir"] = dir, ["psd"] = "full" } });
                AssertBerthCase("two-sided-" + dir, bothJson, dir, expectedTrackSides: 3,
                    expectedBankMask: 3, expectedPlatformPoints: 2,
                    expectedOwnedEdgeIds: new[] { "edge-l", "edge-r" }, expectedUnownedEdgeIds: Array.Empty<string>());

                // (d) Berth without a platform
                var noneJson = BuildBerthFixtureJson(dir);
                AssertBerthCase("no-platform-" + dir, noneJson, dir, expectedTrackSides: 0,
                    expectedBankMask: 0, expectedPlatformPoints: 0,
                    expectedOwnedEdgeIds: Array.Empty<string>(), expectedUnownedEdgeIds: Array.Empty<string>());
            }
        }

        static string BuildBerthFixtureJson(string dir, params JObject[] platformEdges) {
            var cells = new JArray();
            for (int x = 0; x < 12; x++)
                for (int y = -2; y <= 5; y++)
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = -5, ["fill"] = "solid", ["zone"] = "paid" });
            var modules = new JArray {
                new JObject {
                    ["id"] = "track-1", ["type"] = "track", ["x"] = 0, ["y"] = 0, ["z"] = -5, ["rot"] = 0, ["w"] = 10, ["h"] = 1, ["d"] = 3,
                    ["cfg"] = new JObject { ["line"] = "1", ["dir"] = dir },
                },
            };
            foreach (var edge in platformEdges) modules.Add(edge);
            var lines = new JArray {
                new JObject { ["id"] = "1", ["name"] = "1号线", ["color"] = "#f3d03e", ["stock"] = "A", ["cars"] = 6, ["direction"] = dir },
            };
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["name"] = "BerthTest",
                ["city"] = "guangzhou", ["seed"] = 1, ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = lines },
            }.ToString(Newtonsoft.Json.Formatting.None);
        }

        static void AssertBerthCase(string label, string saveJson, string dir,
            int expectedTrackSides, int expectedBankMask, int expectedPlatformPoints,
            string[] expectedOwnedEdgeIds, string[] expectedUnownedEdgeIds) {
            var read = StationDocumentReader.Read(saveJson, new StationSource(label, ""));
            Assert.IsNotNull(read.Document);
            var simDoc = StationSessionProjection.Document(read.Document, read.Index);
            var lineFact = simDoc.Lines[0];

            // 1. Simulation berth pose
            Assert.IsTrue(StationTrainPose.TryBerth(simDoc, lineFact, true, "track-1", StationTrainPose.DefaultScale, out var simBerth, out var fail), label + ": " + fail);
            Assert.AreEqual(expectedTrackSides, simBerth.TrackDoorSides, label + " sim TrackDoorSides");
            Assert.AreEqual(expectedBankMask, simBerth.DoorBankMask, label + " sim DoorBankMask");
            Assert.AreEqual(expectedPlatformPoints > 0, simBerth.HasPlatform, label + " sim HasPlatform");

            // 2. View consist berth geometry (shared by live TrainConsistViews & StationExplodedTrayBuilder)
            Assert.IsTrue(TrainConsistGeometry.TryBerth(read.Document, read.Document.Lines[0], read.Document.Modules[0],
                (float)StationTrainPose.DefaultScale, out var viewBerth, out var vFail), label + ": " + vFail);
            Assert.AreEqual(expectedTrackSides, viewBerth.TrackDoorSides, label + " view TrackDoorSides");
            Assert.AreEqual(expectedBankMask, viewBerth.DoorBankMask, label + " view DoorBankMask");
            Assert.AreEqual(expectedPlatformPoints, viewBerth.PlatformPoints.Count, label + " view PlatformPoints");

            // 3. Passenger service doors
            var walkGraph = StationWalkGraphBuilder.Build(simDoc);
            var slots = StationServiceDoors.ForService(simDoc, walkGraph, "1", "track-1", out _);
            var slotEdgeIds = new HashSet<string>(slots.Select(s => s.PlatformId), StringComparer.Ordinal);
            foreach (var owned in expectedOwnedEdgeIds)
                Assert.IsTrue(slotEdgeIds.Contains(owned), label + " expected service doors on " + owned);
            foreach (var unowned in expectedUnownedEdgeIds)
                Assert.IsFalse(slotEdgeIds.Contains(unowned), label + " must not emit service doors on unowned legacy " + unowned);

            // 4. Live PSD DoorFrames during boarding dwell
            var sim = new StationSimulationSession(new StationSessionSetup {
                Document = simDoc,
                Day = StationDayData.Default,
                Seed = 7,
                StartSimTime = StationClock.ReferenceBootSeconds,
                StartPlaying = true,
                Services = new StationServiceOptions { Spawn = false },
            });
            StationMotionFrame? openFrame = null;
            for (int step = 0; step < 300; step++) {
                sim.Advance(1.0);
                var snap = sim.Snapshot();
                if (snap.Trains.Length > 0 && snap.Trains[0].DoorFraction > 0.5) {
                    openFrame = snap;
                    break;
                }
            }
            Assert.IsTrue(openFrame.HasValue, label + " train never opened doors");
            foreach (var owned in expectedOwnedEdgeIds) {
                var df = openFrame.Value.Doors.First(d => d.PlatformId == owned);
                Assert.AreEqual("track-1", df.TrackId, label + " owned PSD TrackId");
                Assert.Greater(df.DoorFraction, 0.5, label + " owned PSD must open with train");
            }
            foreach (var unowned in expectedUnownedEdgeIds) {
                var df = openFrame.Value.Doors.First(d => d.PlatformId == unowned);
                Assert.AreEqual("", df.TrackId, label + " unowned legacy PSD must not bind to track-1");
                Assert.AreEqual(0.0, df.DoorFraction, 1e-6, label + " unowned legacy PSD must remain shut");
            }
        }

        // =====================================================================
        // Item 8: Clean up legacy landings when stairs move
        // =====================================================================

        [Test]
        public void Item8_MovingLegacyTurningStairCleansAbandonedLandingsKeepsSharedAndRoundTrips() {
            // Even-rise right90 turning stair (medium single: rise=4, run=6): turn landing lies at integer z = -4 + 2 = -2!
            var generatedFlights = StationRampRules.StairFlightsFor(new StationPoint(2, 2, -4), 0, "right90", 2.0, "medium", "single");
            var flightsJson = new JArray();
            for (int f = 0; f < generatedFlights.Count; f++) {
                flightsJson.Add(new JObject {
                    ["from"] = new JObject { ["x"] = generatedFlights[f].From.X, ["y"] = generatedFlights[f].From.Y, ["z"] = generatedFlights[f].From.Z },
                    ["to"] = new JObject { ["x"] = generatedFlights[f].To.X, ["y"] = generatedFlights[f].To.Y, ["z"] = generatedFlights[f].To.Z },
                });
            }
            var lastTo = generatedFlights[generatedFlights.Count - 1].To;
            var stairA = new JObject {
                ["id"] = "stair-legacy", ["type"] = "stair",
                ["x"] = 2, ["y"] = 2, ["z"] = -4, ["rot"] = 0, ["w"] = 2, ["h"] = 4, ["d"] = 1,
                ["from"] = new JObject { ["x"] = 2, ["y"] = 2, ["z"] = -4 },
                ["to"] = new JObject { ["x"] = lastTo.X, ["y"] = lastTo.Y, ["z"] = lastTo.Z },
                ["cfg"] = new JObject { ["style"] = "right90", ["width"] = 2, ["flights"] = flightsJson },
            };
            // Build base save first to inspect exact StairTurnCells of stair-legacy.
            var cells = new JArray();
            for (int x = 0; x < 18; x++) {
                for (int y = 0; y < 14; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = -4, ["fill"] = "solid", ["zone"] = "unpaid" });
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid", ["zone"] = "unpaid" });
                }
            }
            var probeDoc = StationDocumentReader.Read(new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["name"] = "StairProbe",
                ["city"] = "guangzhou", ["seed"] = 1, ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = new JArray { stairA }, ["lines"] = new JArray() },
            }.ToString(Newtonsoft.Json.Formatting.None), new StationSource("probe", ""));
            Assert.IsNotNull(probeDoc.Document);
            var turnPoints = StationRampRules.StairTurnCells(probeDoc.Document.Modules[0]);
            Assert.GreaterOrEqual(turnPoints.Count, 2, "2m wide right90 stair must have multi-cell turn landing");
            // Author legacy landing blocks at every turn cell (with finish & zone so undo preservation is verified),
            // and place a bench on ONE of those cells to exercise shared support!
            var turnKeys = turnPoints.Select(p => new StationCellKey((int)Math.Round(p.X), (int)Math.Round(p.Y), (int)Math.Round(p.Z))).Distinct().ToList();
            var sharedKey = turnKeys[0];
            var abandonedKeys = turnKeys.Skip(1).ToList();
            Assert.GreaterOrEqual(abandonedKeys.Count, 1);

            foreach (var k in turnKeys) {
                cells.Add(new JObject {
                    ["x"] = k.X, ["y"] = k.Y, ["z"] = k.Z, ["fill"] = "solid",
                    ["zone"] = "paid", ["finish"] = new JObject { ["top"] = "floor.marble" },
                });
            }
            var modules = new JArray {
                stairA,
                new JObject {
                    ["id"] = "bench-shared", ["type"] = "bench",
                    ["x"] = sharedKey.X, ["y"] = sharedKey.Y, ["z"] = sharedKey.Z, ["rot"] = 0, ["w"] = 1, ["h"] = 1, ["d"] = 1,
                },
            };
            var saveJson = new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["name"] = "LegacyStairMove",
                ["city"] = "guangzhou", ["seed"] = 1, ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            }.ToString(Newtonsoft.Json.Formatting.None);

            var host = CreateHost(saveJson, "stair-move");
            Assert.IsTrue(host.Index.TryGetModule("stair-legacy", out var origStair));

            // Move & rotate the stair (rot=1) to (10, 4, -4) through normal placement resolver + PlanRampMove.
            var destHit = new StationPlacementHit(10, 4, -4, 10, 4, -4, true, new StationPoint(10.5, 4.5, -3), -3, new StationPoint(0, 0, 1));
            var plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                Carried = origStair, Rotation = 1, Hit = destHit, ModulePoint = destHit.Point,
            });
            Assert.IsTrue(plan.Ok, "destination placement failed: " + plan.Reason);

            int revBefore = host.CurrentRevision;
            var patch = StationRampCarve.PlanRampMove(host.Index, origStair, plan.Candidate);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, patch, "move", null, out _, out var moveCode), moveCode);
            Assert.AreEqual(revBefore + 1, host.CurrentRevision, "move + landing cleanup + carve must commit in one transaction");

            // Abandoned legacy landing cells disappeared; shared cell remained!
            foreach (var k in abandonedKeys) {
                Assert.IsNull(host.Index.GetCell(k), "abandoned legacy landing cell should be removed: " + k);
            }
            Assert.IsNotNull(host.Index.GetCell(sharedKey), "shared landing cell supporting bench-shared must remain");

            // Destination stair routes cleanly from lower landing to upper landing!
            Assert.IsTrue(host.Index.TryGetModule("stair-legacy", out var movedStair));
            Assert.AreEqual(1, movedStair.Rotation);
            var simDoc = StationSessionProjection.Document(host.Index.Document, host.Index);
            var walk = StationWalkGraphBuilder.Build(simDoc);
            var from = movedStair.From.Value;
            var to = movedStair.To.Value;
            Assert.IsTrue(walk.TryNode((int)Math.Round(from.X), (int)Math.Round(from.Y), (int)Math.Round(from.Z), out int nFrom));
            Assert.IsTrue(walk.TryNode((int)Math.Round(to.X), (int)Math.Round(to.Y), (int)Math.Round(to.Z), out int nTo));
            Assert.IsTrue(new StationRoutePlanner(walk).Search(nFrom, nTo, default).Found, "moved stair must route from lower to upper landing");

            // Save round-trip matches moved state.
            string exported = host.SaveDocument();
            var reopened = StationDocumentReader.Read(exported, new StationSource("roundtrip", ""));
            Assert.IsNotNull(reopened.Document);
            foreach (var k in abandonedKeys) Assert.IsNull(reopened.Index.GetCell(k));
            Assert.IsNotNull(reopened.Index.GetCell(sharedKey));

            // Single Undo restores original authored legacy landing cells verbatim (including finish & zone) and original stair!
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var uCode), uCode);
            foreach (var k in abandonedKeys) {
                var restored = host.Index.GetCell(k);
                Assert.IsNotNull(restored, "undo must restore abandoned legacy landing cell: " + k);
                Assert.AreEqual("paid", restored.Zone);
                Assert.AreEqual("floor.marble", restored.Finish["top"]);
            }
            Assert.IsTrue(host.Index.TryGetModule("stair-legacy", out var undoneStair));
            Assert.AreEqual(0, undoneStair.Rotation);
            Assert.AreEqual(2, undoneStair.X);

            // Redo reapplies cleanup and move cleanly.
            Assert.IsTrue(StationEditSession.TryRedo(host, out _, out var rCode), rCode);
            foreach (var k in abandonedKeys) Assert.IsNull(host.Index.GetCell(k));
            Assert.IsNotNull(host.Index.GetCell(sharedKey));
        }

        // =====================================================================
        // Item 9: Bound road rebuilds to affected networks
        // =====================================================================

        [Test]
        public void Item9_RoadEditsRetainDisconnectedNetworksAndMatchFreshRebuildAcrossEditJoinSplitReverseUndoRedoAndRecovery() {
            // Three disconnected road networks at z=0:
            // Net A: road-a (x=0..40, y=0..6, two-way)
            // Net B: road-b (x=0..40, y=40..46, two-way)
            // Net D: road-d (x=120..160, y=0..6, one-way) — stays untouched through edit, join, and split of A & B!
            var modules = new JArray {
                new JObject { ["id"] = "road-a", ["type"] = "road", ["x"] = 0, ["y"] = 0, ["z"] = 0, ["rot"] = 0, ["w"] = 40, ["h"] = 1, ["d"] = 6,
                    ["cfg"] = new JObject { ["from"] = new JArray(0, 3), ["to"] = new JArray(40, 3), ["width"] = 6, ["direction"] = "two-way" } },
                new JObject { ["id"] = "road-b", ["type"] = "road", ["x"] = 0, ["y"] = 40, ["z"] = 0, ["rot"] = 0, ["w"] = 40, ["h"] = 1, ["d"] = 6,
                    ["cfg"] = new JObject { ["from"] = new JArray(0, 43), ["to"] = new JArray(40, 43), ["width"] = 6, ["direction"] = "two-way" } },
                new JObject { ["id"] = "road-d", ["type"] = "road", ["x"] = 120, ["y"] = 0, ["z"] = 0, ["rot"] = 0, ["w"] = 40, ["h"] = 1, ["d"] = 6,
                    ["cfg"] = new JObject { ["from"] = new JArray(120, 3), ["to"] = new JArray(160, 3), ["width"] = 6, ["direction"] = "one-way" } },
            };
            var saveJson = new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["name"] = "RoadComponents",
                ["city"] = "guangzhou", ["seed"] = 77, ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = new JArray(), ["modules"] = modules, ["lines"] = new JArray() },
            }.ToString(Newtonsoft.Json.Formatting.None);

            var host = CreateHost(saveJson, "road-components", withRoadRenderer: true);
            var renderer = StationRoadRenderer.Current;
            Assert.IsNotNull(renderer);
            Assert.AreEqual(3, renderer.ComponentCount);

            // Step traffic forward from 0 -> 12 s so every network has live vehicles & non-zero clocks.
            renderer.Update(0.0);
            for (double t = 1.0; t <= 12.0; t += 1.0) renderer.Update(t);

            Assert.IsTrue(renderer.TryGetRoadView("road-b", out var viewBBefore));
            Assert.IsTrue(renderer.TryGetComponentTraffic("road-b", out var trafficBBefore));
            Assert.IsTrue(renderer.TryGetComponentVehiclePoolRoot("road-b", out var poolBBefore));
            double timeBBefore = trafficBBefore.Time;
            int carsBBefore = trafficBBefore.Cars.Count;
            var carSnapshotB = trafficBBefore.Cars.Select(c => (c.Id, c.Edge, c.Distance)).ToList();

            Assert.IsTrue(renderer.TryGetRoadView("road-d", out var viewDBefore));
            Assert.IsTrue(renderer.TryGetComponentTraffic("road-d", out var trafficDBefore));
            Assert.IsTrue(renderer.TryGetComponentVehiclePoolRoot("road-d", out var poolDBefore));

            // 1. Edit Net A only (add short south branch not touching B or D):
            var branchA = new RoadEditRequest {
                mode = "add", z = 0, from = new[] { 20.0, 3.0 }, to = new[] { 20.0, -18.0 },
                width = 6, direction = "two-way", rot = 0, expectedRevision = -1,
            };
            Assert.IsTrue(StationRoadEditService.TryCommit(host, branchA, out var c1, out var r1), c1 ?? r1);
            Assert.IsTrue(renderer.LastDelta.UsedIncremental);
            Assert.AreEqual(1, renderer.LastDelta.RebuiltComponents);
            Assert.AreEqual(2, renderer.LastDelta.RetainedComponents);
            Assert.AreEqual(2, renderer.LastDelta.RetainedTrafficNetworks);
            Assert.AreEqual(2, renderer.LastDelta.RetainedRoads);

            // Disconnected Net B and Net D MUST retain exact GameObject, Traffic instance, clock, cars, and vehicle pool!
            Assert.IsTrue(renderer.TryGetRoadView("road-b", out var viewBAfter));
            Assert.IsTrue(renderer.TryGetComponentTraffic("road-b", out var trafficBAfter));
            Assert.IsTrue(renderer.TryGetComponentVehiclePoolRoot("road-b", out var poolBAfter));
            Assert.AreSame(viewBBefore, viewBAfter, "disconnected road-b view must be retained");
            Assert.AreSame(trafficBBefore, trafficBAfter, "disconnected road-b traffic must be retained");
            Assert.AreSame(poolBBefore, poolBAfter, "disconnected road-b vehicle pool must be retained");
            Assert.AreEqual(timeBBefore, trafficBAfter.Time, 1e-9, "disconnected road-b clock must not reset");
            Assert.AreEqual(carsBBefore, trafficBAfter.Cars.Count);
            CollectionAssert.AreEqual(carSnapshotB, trafficBAfter.Cars.Select(c => (c.Id, c.Edge, c.Distance)).ToList());
            AssertRoadViewMatchesFreshRebuild(host, renderer.View, "after-branch-A");

            // 2. Join Net A and Net B with bridge road C (x=20, y=3..43), while Net D stays retained!
            var beforeJoinIds = new HashSet<string>(host.Index.Document.Modules.Where(m => m.Type == "road").Select(m => m.Id));
            var joinReq = new RoadEditRequest {
                mode = "add", z = 0, from = new[] { 20.0, 3.0 }, to = new[] { 20.0, 43.0 },
                width = 6, direction = "two-way", rot = 0, expectedRevision = -1,
            };
            Assert.IsTrue(StationRoadEditService.TryCommit(host, joinReq, out var c2, out var r2), c2 ?? r2);
            Assert.AreEqual(2, renderer.ComponentCount, "joining A+B with untouched D leaves 2 components");
            Assert.AreEqual(2, renderer.LastDelta.RetiredComponents);
            Assert.AreEqual(1, renderer.LastDelta.RebuiltComponents);
            Assert.AreEqual(1, renderer.LastDelta.RetainedComponents);
            Assert.IsTrue(renderer.TryGetRoadView("road-d", out var viewDAfterJoin));
            Assert.IsTrue(renderer.TryGetComponentTraffic("road-d", out var trafficDAfterJoin));
            Assert.AreSame(viewDBefore, viewDAfterJoin, "untouched road-d view must survive A+B join");
            Assert.AreSame(trafficDBefore, trafficDAfterJoin, "untouched road-d traffic must survive A+B join");
            AssertRoadViewMatchesFreshRebuild(host, renderer.View, "after-join-AB");

            // 3. Split AB back into A and B by erasing the bridge road C!
            string bridgeId = host.Index.Document.Modules.First(m => m.Type == "road" && !beforeJoinIds.Contains(m.Id)).Id;
            var splitReq = new RoadEditRequest {
                mode = "delete", z = 0, from = new[] { 20.0, 22.0 }, to = new[] { 20.0, 22.0 },
                pickedId = bridgeId, expectedRevision = -1,
            };
            Assert.IsTrue(StationRoadEditService.TryCommit(host, splitReq, out var c3, out var r3), c3 ?? r3);
            Assert.AreEqual(3, renderer.ComponentCount, "splitting AB restores 3 components");
            Assert.AreEqual(1, renderer.LastDelta.RetiredComponents);
            Assert.AreEqual(2, renderer.LastDelta.RebuiltComponents);
            Assert.AreEqual(1, renderer.LastDelta.RetainedComponents);
            Assert.IsTrue(renderer.TryGetComponentTraffic("road-d", out var trafficDAfterSplit));
            Assert.AreSame(trafficDBefore, trafficDAfterSplit, "untouched road-d traffic must survive AB split");
            AssertRoadViewMatchesFreshRebuild(host, renderer.View, "after-split-AB");

            // 4. Undo split (re-joins A+B) and undo join (re-splits A and B), then redo join:
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var uSplit), uSplit);
            Assert.AreEqual(2, renderer.ComponentCount);
            Assert.AreEqual(1, renderer.LastDelta.RetainedComponents);
            AssertRoadViewMatchesFreshRebuild(host, renderer.View, "after-undo-split");

            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var uJoin), uJoin);
            Assert.AreEqual(3, renderer.ComponentCount);
            Assert.AreEqual(1, renderer.LastDelta.RetainedComponents);
            AssertRoadViewMatchesFreshRebuild(host, renderer.View, "after-undo-join");

            // 5. Direction reversal on one-way Net D rebuilds ONLY Net D and retains A & B!
            Assert.IsTrue(renderer.TryGetComponentTraffic("road-b", out var trafficBPreRev));
            var reverseLocal = StationHostEdits.TryPlanSwitchRoadDirection(host.Coordinator.CommittedRead, "road-d", host.CurrentSourceId, out var revErr);
            Assert.IsNotNull(reverseLocal, revErr);
            Assert.IsTrue(StationEditSession.TryApplyLocalRead(host, reverseLocal, host.Coordinator.CommittedRead, "road-reverse", null, out _, out var revCode), revCode);
            Assert.AreEqual(1, renderer.LastDelta.RebuiltComponents);
            Assert.AreEqual(2, renderer.LastDelta.RetainedComponents);
            Assert.IsTrue(renderer.TryGetComponentTraffic("road-b", out var trafficBPostRev));
            Assert.AreSame(trafficBPreRev, trafficBPostRev, "reversing road-d must retain road-b traffic");
            AssertRoadViewMatchesFreshRebuild(host, renderer.View, "after-reverse-D");

            // 6a. Rollback safety when local road staging throws: edit fails cleanly, live views & traffic untouched!
            Assert.IsTrue(renderer.TryGetRoadView("road-b", out var viewBPreFail));
            StationWorldView.LocalStageFailureInjector = r => r == renderer.Role ? new InvalidOperationException("injected road stage failure") : null;
            Assert.IsFalse(StationEditSession.TryUndo(host, out _, out var failCode));
            StationWorldView.LocalStageFailureInjector = null;
            Assert.IsTrue(renderer.TryGetRoadView("road-b", out var viewBPostFail));
            Assert.AreSame(viewBPreFail, viewBPostFail, "aborted local stage must leave live road views untouched");

            // 6b. Full-rebuild recovery path when TryStageLocalDelta refuses incremental staging!
            int fullBuildsBefore = renderer.FullBuilds;
            StationRoadRenderer.ForceFallbackOnce = true;
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var uRev), uRev);
            Assert.Greater(renderer.FullBuilds, fullBuildsBefore, "refused local stage must recover via full build");
            AssertRoadViewMatchesFreshRebuild(host, renderer.View, "after-full-recovery");
        }

        void AssertRoadViewMatchesFreshRebuild(StationGameHost host, StationRoadView liveView, string stage) {
            var tempGo = new GameObject("road-fresh-" + stage);
            cleanup.Add(tempGo);
            var records = StationRoadEditService.Records(host.Index.Document);
            var allIds = host.Index.Document.Modules.Select(m => m.Id);
            var freshGraph = StationRoadDocument.Read(records, allIds);
            var freshView = StationRoadView.BuildGraph(tempGo.transform, freshGraph, StationFinishLibrary.FindShader());

            Assert.AreEqual(freshView.Roads, liveView.Roads, stage + " Roads");
            Assert.AreEqual(freshView.Segments, liveView.Segments, stage + " Segments");
            Assert.AreEqual(freshView.SignalsBuilt, liveView.SignalsBuilt, stage + " SignalsBuilt");
            Assert.AreEqual(freshView.Crosswalks, liveView.Crosswalks, stage + " Crosswalks");
            Assert.AreEqual(freshView.StopLines, liveView.StopLines, stage + " StopLines");
            Assert.AreEqual(freshView.Arrows, liveView.Arrows, stage + " Arrows");
            Assert.AreEqual(freshView.MarkingSpans, liveView.MarkingSpans, stage + " MarkingSpans");

            Assert.AreEqual(freshView.Graph.Nodes.Count, liveView.Graph.Nodes.Count, stage + " Graph.Nodes");
            Assert.AreEqual(freshView.Graph.Segments.Count, liveView.Graph.Segments.Count, stage + " Graph.Segments");
            Assert.AreEqual(freshView.Network.Roads.Count, liveView.Network.Roads.Count, stage + " Network.Roads");
            Assert.AreEqual(freshView.Network.Junctions.Count, liveView.Network.Junctions.Count, stage + " Network.Junctions");
            Assert.AreEqual(freshView.Network.Edges.Count, liveView.Network.Edges.Count, stage + " Network.Edges");
            Assert.AreEqual(freshView.Network.Entries.Count, liveView.Network.Entries.Count, stage + " Network.Entries");
            Assert.AreEqual(
                StationRoadLayout.JunctionSides(freshView.Network).Count,
                StationRoadLayout.JunctionSides(liveView.Network).Count,
                stage + " JunctionSides");
        }
    }
}
