using System;
using System.Collections.Generic;
using Metro.Sim;
using Metro.View;
using NUnit.Framework;

/// <summary>
/// Track 1 (P1) acceptance tests: passenger errands, front-only fixture access,
/// serialized machine dwell, independent linked bench seats, toilet-to-sink chaining,
/// office/toilet shell exclusion, deletion/inaccessibility recovery, and deterministic
/// walking profiles agreeing with <see cref="PassengerAppearance"/>.
/// Mirrors <c>game/test/passenger-activities.test.mjs</c> and <c>game/test/walking-profiles.test.mjs</c>.
/// </summary>
public class StationErrandsAndWalkingTests {
    static StationCellFact Cell(int x, int y, int z, int zone = 2, bool solid = true, double speed = 1.0) =>
        new StationCellFact { X = x, Y = y, Z = z, Zone = zone, Solid = solid, Speed = speed };

    static StationDayData AlwaysOpenDay() => StationDayData.Default;

    static StationSessionDocument SquareHall(int size = 12, int zone = 2) {
        var doc = new StationSessionDocument { StationId = "errands-hall", LevelBase = 0 };
        for (int x = 0; x <= size; x++) {
            for (int y = 0; y <= size; y++) {
                doc.Cells.Add(Cell(x, y, 0, zone: zone));
            }
        }
        doc.Modules.Add(new StationModuleFact {
            Id = "exit-a", Type = "exit", X = 1, Y = 1, Z = 0, Name = "A",
            HeadHouse = false, HasExitInRate = true, ExitInRate = 0,
        });
        return doc;
    }

    [Test]
    public void WalkingProfilesMatchPassengerAppearanceBitForBitAndStayIndependentOfSimRng() {
        int childCount = 0;
        var seenProfiles = new HashSet<int>();
        for (int id = 1; id <= 200; id++) {
            var look = PassengerAppearance.Look(null, id);
            Assert.AreEqual(look.IsChild, StationPassengerWalking.IsChild(id), "IsChild mismatch id=" + id);
            Assert.AreEqual(look.WalkProfile, StationPassengerWalking.WalkProfile(id), "WalkProfile mismatch id=" + id);
            Assert.AreEqual(look.RawDepth, StationPassengerWalking.RawDepth(id), 1e-12, "RawDepth mismatch id=" + id);
            Assert.AreEqual(look.WalkSpeed, StationPassengerWalking.WalkSpeed(id), 1e-12, "WalkSpeed mismatch id=" + id);
            if (look.IsChild) childCount++;
            seenProfiles.Add(look.WalkProfile);
        }
        Assert.Greater(childCount, 20, "expected ~20% child passengers");
        Assert.Less(childCount, 65, "expected ~20% child passengers");
        Assert.AreEqual(3, seenProfiles.Count, "all 3 walk profiles (slow/medium/fast) represented");

        // Adult speeds span [0.81, 1.54], child speeds are scaled by 0.70 * [0.80..0.90] => [0.504, 0.882].
        double maxChild = 0, minAdult = double.PositiveInfinity;
        for (int id = 1; id <= 200; id++) {
            double spd = StationPassengerWalking.WalkSpeed(id);
            if (StationPassengerWalking.IsChild(id)) {
                Assert.GreaterOrEqual(spd, 0.9 * 0.80 * 0.70 - 1e-9);
                Assert.LessOrEqual(spd, 1.4 * 0.90 * 0.70 + 1e-9);
                if (spd > maxChild) maxChild = spd;
            } else {
                Assert.GreaterOrEqual(spd, 0.9 * 0.90 - 1e-9);
                Assert.LessOrEqual(spd, 1.4 * 1.10 + 1e-9);
                if (spd < minAdult) minAdult = spd;
            }
        }
        Assert.Greater(maxChild, 0.5);
        Assert.Greater(minAdult, 0.8);
    }

    [Test]
    public void FrontOnlyFixtureAccessMatchesAcrossFullAndIncrementalGraphsForAllRotations() {
        var opts = new StationWalkGraphOptions { IncludeGround = false };
        foreach (string kind in new[] { "bench", "cubicle", "sink" }) {
            for (int rot = 0; rot < 4; rot++) {
                var doc = SquareHall(8);
                var fixture = new StationModuleFact {
                    Id = kind + "-" + rot, Type = kind, X = 4, Y = 4, Z = 0, Rot = rot,
                    Variant = kind == "bench" ? "steel-1" : "",
                };
                doc.Modules.Add(fixture);
                var gFull = StationWalkGraphBuilder.Build(doc, opts);

                // Incremental add onto empty hall must produce identical adjacency and stops.
                var baseDoc = SquareHall(8);
                var ws = StationWalkGraphBuilder.BuildWorkspace(baseDoc, opts);
                var delta = new StationSessionDelta();
                delta.ChangedModules.Add(fixture);
                var gInc = StationWalkGraphBuilder.StageCellDelta(ws, doc, delta).Graph;

                int frontLocalY = kind == "cubicle" ? -1 : 1;
                StationActivityStops.RotateLocalInt(rot, 0, frontLocalY, out int fx, out int fy);

                foreach (var g in new[] { gFull, gInc }) {
                    Assert.IsTrue(g.TryNode(4, 4, 0, out int fixNode));
                    Assert.IsTrue(g.TryNode(4 + fx, 4 + fy, 0, out int frontNode));
                    Assert.AreEqual(1, g.AdjTo[fixNode].Length,
                        kind + " rot=" + rot + " has exactly 1 outgoing edge (front)");
                    Assert.AreEqual(frontNode, g.AdjTo[fixNode][0],
                        kind + " rot=" + rot + " exits only through its front face");
                    Assert.GreaterOrEqual(Array.IndexOf(g.AdjTo[frontNode], fixNode), 0,
                        kind + " rot=" + rot + " enters from front");
                    // No diagonal touches the fixture cell.
                    foreach (var d in new[] { (1, 1), (1, -1), (-1, 1), (-1, -1) }) {
                        Assert.IsTrue(g.TryNode(4 + d.Item1, 4 + d.Item2, 0, out int diag));
                        Assert.AreEqual(-1, Array.IndexOf(g.AdjTo[diag], fixNode),
                            kind + " rot=" + rot + " refuses diagonal entry");
                    }
                    // No unported fixture-access diagnostic remains.
                    foreach (string u in g.Unported)
                        Assert.IsFalse(u.StartsWith("fixture-access:", StringComparison.Ordinal));
                }
            }
        }
    }

    [Test]
    public void SerializedMachineDwellIndependentBenchSeatsAndOfficeExclusionWorkDeterministically() {
        var doc = SquareHall(12);
        doc.Modules.Add(new StationModuleFact { Id = "tvm-1", Type = "tvm", X = 5, Y = 5, Z = 0, Rot = 0 });
        doc.Modules.Add(new StationModuleFact { Id = "bench-2", Type = "bench", X = 7, Y = 5, Z = 0, Rot = 0, Variant = "steel-2" });
        doc.Modules.Add(new StationModuleFact { Id = "office-1", Type = "shop", X = 2, Y = 8, Z = 0, Width = 3, Height = 3, ShopKind = "office" });
        doc.Modules.Add(new StationModuleFact { Id = "store-1", Type = "shop", X = 7, Y = 8, Z = 0, Width = 3, Height = 3, ShopKind = "store" });

        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc, Day = AlwaysOpenDay(), Seed = 42, StartSimTime = 8 * 3600, StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });

        // Errands diagnostic is cleared.
        foreach (string u in session.Services.Unported)
            Assert.IsFalse(u.StartsWith("errands:", StringComparison.Ordinal), "errands diagnostic must be cleared");

        // Office stop is marked non-public; store stop is public.
        var officeStop = session.WalkGraph.Stops.Find(s => s.Id == "office-1");
        var storeStop = session.WalkGraph.Stops.Find(s => s.Id == "store-1");
        Assert.IsNotNull(officeStop);
        Assert.IsFalse(officeStop.PublicShop, "office rooms are excluded from public shopping errands");
        Assert.IsNotNull(storeStop);
        Assert.IsTrue(storeStop.PublicShop, "store rooms are public shops");

        // Two passengers visiting the same TVM are strictly serialized (never both Buying simultaneously).
        int p1 = session.Services.SeedStopVisitor(new[] { "tvm-1" }, "exit-a", 5.5, 3.5, 1.0);
        int p2 = session.Services.SeedStopVisitor(new[] { "tvm-1" }, "exit-a", 5.5, 3.5, 1.0);
        bool sawQueuedWhileBusy = false;
        int maxConcurrentBuying = 0;
        for (int t = 0; t < 120; t++) {
            session.Advance(1.0);
            int buying = 0;
            foreach (var f in session.Services.PassengerFrames()) {
                if (f.State == StationPassengerState.Buying && f.ServerId == "stop:tvm-1") buying++;
            }
            if (buying > maxConcurrentBuying) maxConcurrentBuying = buying;
            if (session.Services.TryStopState("tvm-1", out int activeId, out int queued, out _)) {
                if (activeId >= 0 && queued >= 1) sawQueuedWhileBusy = true;
            }
        }
        Assert.AreEqual(1, maxConcurrentBuying, "TVM serves strictly one customer at a time");
        Assert.IsTrue(sawQueuedWhileBusy, "second visitor queues while first dwells at TVM");
        Assert.IsTrue(session.Services.TryStopState("tvm-1", out _, out _, out int tvmServed));
        Assert.AreEqual(2, tvmServed, "both visitors served in sequence");
        Assert.AreEqual(2, session.Services.Exited, "both visitors resume trip and exit");

        // Linked 2-seat bench exposes two independent seats ("bench-2" and "bench-2:seat1") used concurrently.
        int b1 = session.Services.SeedStopVisitor(new[] { "bench-2" }, "exit-a", 7.5, 6.5, 1.0);
        int b2 = session.Services.SeedStopVisitor(new[] { "bench-2:seat1" }, "exit-a", 8.5, 6.5, 1.0);
        Assert.Greater(b1, 0);
        Assert.Greater(b2, 0);
        bool bothSittingAtOnce = false;
        for (int t = 0; t < 30; t++) {
            session.Advance(1.0);
            int sitting = 0;
            foreach (var f in session.Services.PassengerFrames()) {
                if (f.State == StationPassengerState.Browsing && f.Activity == StationPassengerActivity.Sit) sitting++;
            }
            if (sitting == 2) { bothSittingAtOnce = true; break; }
        }
        Assert.IsTrue(bothSittingAtOnce, "2-seat bench serves both seats concurrently");
    }

    [Test]
    public void ToiletToSinkOrderUnreachableSkipAndDeletionResumptionHold() {
        var doc = SquareHall(12);
        doc.Modules.Add(new StationModuleFact { Id = "cub-1", Type = "cubicle", X = 5, Y = 6, Z = 0, Rot = 0 });
        doc.Modules.Add(new StationModuleFact { Id = "sink-1", Type = "sink", X = 7, Y = 5, Z = 0, Rot = 0 });
        doc.Modules.Add(new StationModuleFact { Id = "vending-1", Type = "vending", X = 9, Y = 5, Z = 0, Rot = 0 });

        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc, Day = AlwaysOpenDay(), Seed = 9, StartSimTime = 8 * 3600, StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });

        // 1. Toilet -> Sink ordered sequence + missing stop skipped without Stuck.
        int pid = session.Services.SeedStopVisitor(new[] { "missing-stop", "cub-1", "sink-1" }, "exit-a", 5.5, 4.5, 1.0);
        Assert.Greater(pid, 0);
        int toiletTick = -1, washTick = -1;
        for (int t = 1; t <= 160; t++) {
            session.Advance(1.0);
            foreach (var f in session.Services.PassengerFrames()) {
                if (f.SimId != pid) continue;
                if (f.Activity == StationPassengerActivity.Toilet && toiletTick < 0) toiletTick = t;
                if (f.Activity == StationPassengerActivity.Wash && washTick < 0) washTick = t;
            }
        }
        Assert.Greater(toiletTick, 0, "passenger visited cubicle");
        Assert.Greater(washTick, toiletTick, "passenger washed hands at sink strictly after cubicle");
        Assert.AreEqual(0, session.Services.Stuck, "missing stop was skipped without stranding");
        Assert.AreEqual(1, session.Services.Exited, "passenger completed journey to exit");

        // 2. Deleting a stop mid-dwell releases customer cleanly to finish their trip.
        int dv = session.Services.SeedStopVisitor(new[] { "vending-1" }, "exit-a", 9.5, 3.5, 1.0);
        bool enteredVending = false;
        for (int t = 0; t < 10; t++) {
            session.Advance(1.0);
            foreach (var f in session.Services.PassengerFrames()) {
                if (f.SimId == dv && f.State == StationPassengerState.Buying) { enteredVending = true; break; }
            }
            if (enteredVending) break;
        }
        Assert.IsTrue(enteredVending, "visitor began dwelling at vending machine");

        var docAfter = SquareHall(12);
        docAfter.Modules.Add(doc.Modules[1]); // cub-1
        docAfter.Modules.Add(doc.Modules[2]); // sink-1
        var rmDelta = new StationSessionDelta();
        rmDelta.RemovedModules.Add("vending-1");
        var staged = session.StageCellDelta(docAfter.StationId, docAfter.LevelBase, AlwaysOpenDay(), rmDelta);
        session.CommitDocumentEdit(staged);
        for (int t = 0; t < 40; t++) session.Advance(1.0);
        Assert.AreEqual(2, session.Services.Exited, "passenger resumed and exited after vending machine was deleted");
    }
}
