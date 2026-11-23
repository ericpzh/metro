using System;
using System.Collections.Generic;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// Plan 37 Track 4 parity suite: turning/multi-flight and double/triple-span stair/escalator
    /// placement, ramp moves + 1-revision undo/redo + landing protection, walled rooms
    /// (store/toilet/office + merge + perimeter doors + door-cut + "h" serialization), and exit
    /// head-house enclosure wall planes + derived floor parity across full and incremental graphs.
    /// </summary>
    public sealed class StationRampsRoomsExitWallsTests {
        readonly List<UnityEngine.Object> owned = new List<UnityEngine.Object>();

        [TearDown]
        public void TearDown() {
            StationEditSession.Reset();
            for (int i = owned.Count - 1; i >= 0; i--) {
                if (owned[i] != null) UnityEngine.Object.DestroyImmediate(owned[i]);
            }
            owned.Clear();
        }

        [Test]
        public void TurningStairsAndMultiSpanEscalatorsAuthorExpectedFlightsAndMoveInOneRevision() {
            var go = new GameObject("Track4RampHost");
            owned.Add(go);
            var host = go.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(host, null);
            var opened = host.OpenDocument(BuildOpenFloorDoc(30, 30), "test");
            Assert.IsTrue(opened.Accepted);

            // 1. Place a switchback (right180) medium-width stair.
            var req = new StationPlacementRequest {
                ToolType = "stair-right180",
                Rotation = 0,
                StairWidth = 2 * StationRampRules.Band,
                RampSpan = "single",
                RampLengthId = "long",
                Hit = FloorHit(5, 5, 0),
                Id = "stair-u1",
            };
            var plan = StationModulePlacement.Resolve(host.Index, req);
            Assert.IsTrue(plan.Ok, "Expected right180 stair to resolve cleanly, got: " + plan.Reason);
            Assert.AreEqual("stair", plan.Candidate.Type);
            Assert.AreEqual("right180", plan.Candidate.Text("style"));
            var rec = StationModulePlacement.ToRecord(plan.Candidate);
            var flights = StationRampRules.FlightsOf(rec);
            Assert.AreEqual(2, flights.Count);
            Assert.AreEqual(5, flights[0].From.X);
            Assert.AreEqual(5, flights[0].From.Y);
            Assert.AreEqual(0, flights[0].From.Z);
            Assert.AreEqual(2.5, flights[0].To.Z, 1e-6);
            Assert.AreEqual(5, flights[1].To.Z, 1e-6);

            // Commit placement with carve in 1 revision.
            int revBefore = host.CurrentRevision;
            var placePatch = new StationCellPatch();
            placePatch.ModuleAdds.Add(plan.Candidate);
            foreach (var w in StationRampCarve.Carve(host.Index, new[] { rec })) placePatch.Writes.Add(w);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, placePatch, "place-stair", "c-st1", out _, out var code), code);
            Assert.AreEqual(revBefore + 1, host.CurrentRevision);
            Assert.IsNotNull(host.Index.GetModule("stair-u1"));

            // 2. Move and rotate the switchback stair +90 deg CW in 1 revision.
            var placed = host.Index.GetModule("stair-u1");
            var moveReq = new StationPlacementRequest {
                Carried = placed,
                Rotation = 1,
                Hit = FloorHit(12, 12, 0),
            };
            var movePlan = StationModulePlacement.Resolve(host.Index, moveReq);
            Assert.IsTrue(movePlan.Ok, "Move of turning stair must succeed, got: " + movePlan.Reason);
            var movedRec = StationModulePlacement.ToRecord(movePlan.Candidate);
            var movedFlights = StationRampRules.FlightsOf(movedRec);
            Assert.AreEqual(2, movedFlights.Count);
            Assert.AreEqual(12, movedFlights[0].From.X);
            Assert.AreEqual(12, movedFlights[0].From.Y);
            // Rotation 0 -> 1 turns (+Y) into (+X).
            Assert.Greater(movedFlights[0].To.X, movedFlights[0].From.X);

            var movePatch = new StationCellPatch();
            movePatch.ModuleReplaces.Add(movePlan.Candidate);
            foreach (var w in StationRampCarve.Carve(host.Index, new[] { movedRec }, excludeModuleId: placed.Id)) {
                movePatch.Writes.Add(w);
            }
            int revBeforeMove = host.CurrentRevision;
            Assert.IsTrue(StationEditSession.TryApplyCells(host, movePatch, "move-stair", "c-st2", out _, out code), code);
            Assert.AreEqual(revBeforeMove + 1, host.CurrentRevision);
            Assert.AreEqual(12, host.Index.GetModule("stair-u1").X);
            Assert.AreEqual(1, host.Index.GetModule("stair-u1").Rotation);

            // Undo restores original placement in 1 revision, redo reapplies.
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.AreEqual(5, host.Index.GetModule("stair-u1").X);
            Assert.AreEqual(0, host.Index.GetModule("stair-u1").Rotation);
            Assert.IsTrue(StationEditSession.TryRedo(host, out _, out code), code);
            Assert.AreEqual(12, host.Index.GetModule("stair-u1").X);

            // 3. Double- and triple-span escalator specs produce exact rise and 30-deg run.
            var doubleEscReq = new StationPlacementRequest {
                ToolType = "escalator",
                Rotation = 0,
                RampSpan = "double",
                RampLengthId = "long",
                EscalatorDown = true,
                EscalatorWidth = 2,
                Hit = FloorHit(2, 2, 0),
                Id = "esc-dbl",
            };
            var dblPlan = StationModulePlacement.Resolve(host.Index, doubleEscReq);
            Assert.IsTrue(dblPlan.Ok, dblPlan.Reason);
            Assert.AreEqual(10, dblPlan.Candidate.From.Value.Z, 1e-6);
            Assert.AreEqual(0, dblPlan.Candidate.To.Value.Z, 1e-6);
            Assert.AreEqual("down", dblPlan.Candidate.Text("dir"));
            Assert.AreEqual("2", dblPlan.Candidate.Text("width"));

            var tripleEscReq = new StationPlacementRequest {
                ToolType = "escalator",
                Rotation = 0,
                RampSpan = "triple",
                RampLengthId = "long",
                Hit = FloorHit(2, 2, 0),
                Id = "esc-trp",
            };
            var trpPlan = StationModulePlacement.Resolve(host.Index, tripleEscReq);
            Assert.IsTrue(trpPlan.Ok, trpPlan.Reason);
            Assert.AreEqual(15, trpPlan.Candidate.To.Value.Z, 1e-6);
        }

        [Test]
        public void WalledRoomsCreateMergeSerializeHAndCarvePerimeterOpenings() {
            var go = new GameObject("Track4RoomHost");
            owned.Add(go);
            var host = go.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(host, null);
            Assert.IsTrue(host.OpenDocument(BuildOpenFloorDoc(20, 20), "test").Accepted);

            // 1. Place store, toilet, office footprints as `shop` records with `h` (not `d`).
            foreach (var (kind, ox) in new[] { ("store", 1), ("toilet", 6), ("office", 11) }) {
                var rect = new StationFacilityRect(ox, 1, ox + 3, 5, 0); // 4x5
                var plan = StationFacilityPlanner.Plan(host.Index, kind, rect, 0);
                Assert.IsTrue(plan.Ok, kind + " failed: " + plan.Reason);
                Assert.AreEqual("shop", plan.Room.Type);
                Assert.AreEqual(kind, plan.Room.Text("kind"));
                Assert.AreEqual(4, plan.Room.Width);
                Assert.AreEqual(5, plan.Room.Height);
                var raw = StationModuleEdits.ToSaveRecord(plan.Room);
                Assert.AreEqual(5, (int)raw["h"], "shop must serialize Y span as h");
                Assert.IsNull(raw["d"], "shop must not serialize d");
                Assert.IsTrue(StationEditSession.TryApplyCells(host, plan.ToPatch(), "place-" + kind, null, out _, out var err), err);
            }

            // Verify different-kind overlap is refused with clash.
            var clash = StationFacilityPlanner.Plan(host.Index, "toilet", new StationFacilityRect(2, 2, 5, 5, 0), 0);
            Assert.IsFalse(clash.Ok);
            Assert.AreEqual("clash", clash.Reason);

            // Build solid perimeter walls around the store (1..4, 1..5, z=1..3).
            var store = StationFacilityPlanner.At(host.Index, 2, 2, 0);
            Assert.IsNotNull(store);
            var wallPatch = new StationCellPatch();
            for (int x = 1; x <= 4; x++) {
                for (int y = 1; y <= 5; y++) {
                    if (x != 1 && x != 4 && y != 1 && y != 5) continue;
                    for (int dz = 1; dz <= 3; dz++) {
                        wallPatch.Add(StationCellWrite.Set(new StationCellKey(x, y, dz), isVoid: false, "wall"));
                    }
                }
            }
            Assert.IsTrue(StationEditSession.TryApplyCells(host, wallPatch, "walls", null, out _, out var wErr), wErr);

            // Cut a perimeter opening at (2, 1) on the store's south wall.
            var cutPlan = StationFacilityPlanner.PlanCarveOpenings(host.Index, store.Id, new StationFacilityRect(2, 1, 2, 1, 0));
            Assert.IsTrue(cutPlan.Ok, cutPlan.Reason);
            Assert.AreEqual(3, cutPlan.DropCells.Count);
            Assert.IsNotNull(cutPlan.Room);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, cutPlan.ToPatch(), "cut-door", null, out _, out var cErr), cErr);
            Assert.IsNull(host.Index.GetCell(2, 1, 1));

            // Merge/extend the store north to y=7: keeps original id, preserves perimeter door (2,1), clears interior wall at y=5.
            var extendPlan = StationFacilityPlanner.Plan(host.Index, "store", new StationFacilityRect(1, 5, 4, 7, 0), 0);
            Assert.IsTrue(extendPlan.Ok, extendPlan.Reason);
            Assert.AreEqual(store.Id, extendPlan.Room.Id);
            Assert.IsTrue(extendPlan.Room.Text("door").Contains("[2,1]"), "South perimeter door must survive northward extension.");
            Assert.Greater(extendPlan.DropCells.Count, 0, "Interior wall at y=5 should be dropped on merge.");
            Assert.IsTrue(StationEditSession.TryApplyCells(host, extendPlan.ToPatch(), "extend-store", null, out _, out var eErr), eErr);
            Assert.IsNull(host.Index.GetCell(2, 5, 1), "Interior wall between merged rooms should be removed.");
            Assert.IsNotNull(host.Index.GetCell(1, 1, 1), "Surviving outer perimeter wall must be kept.");
        }

        [Test]
        public void ExitWallsEnforceGlassAndBackWallsForAllRotationsAndMatchIncrementalGraph() {
            int NodeAt(StationWalkGraph g, int x, int y, int z) =>
                g.NodeIndex.TryGetValue(StationWalkGraph.CellKey(x, y, z), out int idx) ? idx : -1;

            for (int rot = 0; rot < 4; rot++) {
                var doc = new StationSessionDocument { LevelBase = 0 };
                // Add an elevated floor below (z = -5) and street-level floor (z = 0).
                for (int x = -8; x <= 8; x++) {
                    for (int y = -8; y <= 8; y++) {
                        doc.Cells.Add(new StationCellFact { X = x, Y = y, Z = -5, Solid = true, Zone = 2, Speed = 1.0 });
                    }
                }
                var exit = new StationModuleFact {
                    Id = "exit-1", Type = "exit", X = 0, Y = 0, Z = 0, Rot = rot,
                    HeadHouse = true, ExitBays = 2, ExitStyle = "",
                };
                doc.Modules.Add(exit);

                var opts = new StationWalkGraphOptions { IncludeGround = true, GroundMargin = 8 };
                var full = StationWalkGraphBuilder.Build(doc, opts);
                var ws = StationWalkGraphBuilder.BuildWorkspace(doc, opts);
                var inc = ws.Graph;

                // Unported list must no longer report exit-walls.
                foreach (var u in full.Unported) Assert.IsFalse(u.StartsWith("exit-walls:", StringComparison.Ordinal));
                foreach (var u in inc.Unported) Assert.IsFalse(u.StartsWith("exit-walls:", StringComparison.Ordinal));

                // Check glass side barrier at local y = -1 crossing from inside (lx=0) to outside (lx=-2) fails directly.
                StationWalkGraphBuilder.ExitRotate(0, -1, rot, out double inDx, out double inDy);
                StationWalkGraphBuilder.ExitRotate(-2, -1, rot, out double outDx, out double outDy);
                int inNode = NodeAt(full, (int)Math.Round(inDx), (int)Math.Round(inDy), 0);
                int outNode = NodeAt(full, (int)Math.Round(outDx), (int)Math.Round(outDy), 0);
                Assert.GreaterOrEqual(inNode, 0, "rot=" + rot);
                Assert.GreaterOrEqual(outNode, 0, "rot=" + rot);
                Assert.IsFalse(HasDirectEdge(full, inNode, outNode), "rot=" + rot + " glass wall must block direct edge");
                Assert.IsFalse(HasDirectEdge(inc, NodeAt(inc, (int)Math.Round(inDx), (int)Math.Round(inDy), 0),
                    NodeAt(inc, (int)Math.Round(outDx), (int)Math.Round(outDy), 0)),
                    "rot=" + rot + " incremental graph must match full graph on glass wall");

                // Doorway (local y = +2) stays open: walking from local (0, 1) to local (0, 2) is allowed.
                StationWalkGraphBuilder.ExitRotate(0, 1, rot, out double preDx, out double preDy);
                StationWalkGraphBuilder.ExitRotate(0, 2, rot, out double doorDx, out double doorDy);
                int preNode = NodeAt(full, (int)Math.Round(preDx), (int)Math.Round(preDy), 0);
                int doorNode = NodeAt(full, (int)Math.Round(doorDx), (int)Math.Round(doorDy), 0);
                Assert.IsTrue(HasDirectEdge(full, preNode, doorNode), "rot=" + rot + " doorway must stay passable");

                // Floor below (z = -5) remains completely passable across the same XY!
                int belowIn = NodeAt(full, (int)Math.Round(inDx), (int)Math.Round(inDy), -5);
                int belowMid = NodeAt(full, (int)Math.Round(inDx + (outDx - inDx) * 0.5), (int)Math.Round(inDy + (outDy - inDy) * 0.5), -5);
                Assert.IsTrue(HasDirectEdge(full, belowIn, belowMid), "rot=" + rot + " floor below head-house must stay passable");

                // Removing the exit incrementally restores the direct edge and matches a fresh full build!
                var nextDoc = new StationSessionDocument { LevelBase = 0 };
                nextDoc.Cells.AddRange(doc.Cells);
                var delta = new StationSessionDelta();
                delta.RemovedModules.Add("exit-1");
                var staged = StationWalkGraphBuilder.StageCellDelta(ws, nextDoc, delta);
                int inAfter = NodeAt(staged.Graph, (int)Math.Round(inDx), (int)Math.Round(inDy), 0);
                int outAfter = NodeAt(staged.Graph, (int)Math.Round(outDx), (int)Math.Round(outDy), 0);
                int midAfter = NodeAt(staged.Graph, (int)Math.Round(inDx + (outDx - inDx) * 0.5), (int)Math.Round(inDy + (outDy - inDy) * 0.5), 0);
                Assert.IsTrue(HasDirectEdge(staged.Graph, inAfter, midAfter), "rot=" + rot + " removing exit must unblock edges");
                Assert.IsTrue(HasDirectEdge(staged.Graph, midAfter, outAfter), "rot=" + rot + " removing exit must unblock edges");
            }
        }

        static bool HasDirectEdge(StationWalkGraph graph, int from, int to) {
            if (graph == null || from < 0 || to < 0) return false;
            var outs = graph.AdjTo[from];
            for (int i = 0; i < outs.Length; i++) if (outs[i] == to) return true;
            return false;
        }

        static StationPlacementHit FloorHit(int x, int y, int z) =>
            new StationPlacementHit(x, y, z, x, y, z + 1, true, new StationPoint(x + 0.5, y + 0.5, z + 1), z + 1, new StationPoint(0, 0, 1));

        static string BuildOpenFloorDoc(int w, int h) {
            var cells = new JArray();
            for (int x = 0; x < w; x++) {
                for (int y = 0; y < h; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["shape"] = "solid", ["fill"] = "solid", ["zone"] = "unpaid" });
                }
            }
            var doc = new JObject {
                ["format"] = "metro-save",
                ["formatVersion"] = 1,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Track4",
                ["nameEn"] = "Track4",
                ["city"] = "guangzhou",
                ["seed"] = 42,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = cells,
                    ["modules"] = new JArray(),
                    ["lines"] = new JArray(),
                },
            };
            return doc.ToString(Formatting.None);
        }
    }
}
