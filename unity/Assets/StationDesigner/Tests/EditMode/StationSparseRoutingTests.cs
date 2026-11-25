using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

/// <summary>
/// Cross-engine parity, spread, edit-retention, work-cap determinism and peak-rush
/// performance regressions for sparse hierarchical crowd routing
/// (design/crowd-routing-plan.md §1–§6).
/// </summary>
public class StationSparseRoutingTests {
    static StationCellFact SolidCell(int x, int y, int z, int zone = 0) => new StationCellFact {
        X = x, Y = y, Z = z, Solid = true, Zone = zone, Speed = 1.0,
    };

    static StationSessionDocument WideHallDocument(int width = 11, int length = 30, bool twoConnectors = false, bool diagonalOffset = true) {
        var doc = new StationSessionDocument { StationId = "sparse-wide-hall", LevelBase = 0 };
        int yMid = width / 2;
        for (int x = 0; x < length; x++) {
            for (int y = 0; y < width; y++) doc.Cells.Add(SolidCell(x, y, 9, 2));
        }
        for (int x = length + 3; x <= length + 12; x++) {
            for (int y = 0; y < width; y++) doc.Cells.Add(SolidCell(x, y, 4, 2));
        }
        int escY = diagonalOffset ? width - 2 : yMid;
        doc.Modules.Add(new StationModuleFact {
            Id = "exit-in", Type = "exit", X = 1, Y = diagonalOffset ? 1 : yMid, Z = 9, Rot = 0,
            Name = "In", HasExitInRate = true, ExitInRate = 0,
        });
        doc.Modules.Add(new StationModuleFact {
            Id = "exit-out", Type = "exit", X = length + 11, Y = yMid, Z = 4, Rot = 0,
            Name = "Out", HasExitInRate = true, ExitInRate = 0,
        });
        if (twoConnectors) {
            doc.Modules.Add(new StationModuleFact {
                Id = "esc-1", Type = "escalator", X = length - 4, Y = 2, Z = 9, Rot = 0, Width = 1, Depth = 1,
                HasEndpoints = true, FromX = length - 4, FromY = 2, FromZ = 9, ToX = length + 5, ToY = 2, ToZ = 4,
            });
            doc.Modules.Add(new StationModuleFact {
                Id = "esc-2", Type = "escalator", X = length - 4, Y = width - 3, Z = 9, Rot = 0, Width = 1, Depth = 1,
                HasEndpoints = true, FromX = length - 4, FromY = width - 3, FromZ = 9, ToX = length + 5, ToY = width - 3, ToZ = 4,
            });
        } else {
            doc.Modules.Add(new StationModuleFact {
                Id = "esc-1", Type = "escalator", X = length - 4, Y = escY, Z = 9, Rot = 0, Width = 1, Depth = 1,
                HasEndpoints = true, FromX = length - 4, FromY = escY, FromZ = 9, ToX = length + 5, ToY = escY, ToZ = 4,
            });
        }
        return doc;
    }

    static StationDayData AlwaysOpenDay(double amPeak = 1.0) => new StationDayData(
        new DaySpan(0, StationClock.ServiceLatest),
        new PeakSpans(new DaySpan(6 * 3600, 10 * 3600), new DaySpan(17 * 3600, 20 * 3600)),
        new DayDemand(new DemandKnobs(amPeak, 0.78, 1), DemandKnobs.DefaultOffday),
        new SimCalendar(new SimDate(2026, 1, 1), Array.Empty<string>()));

    static (double Share16, double Share22, int Exited, int Spawned) MeasureWideHall(
        StationSessionDocument doc,
        StationRoutingMode mode,
        StationSparseRouterOptions sparseOpts = null,
        int ticks = 150) {
        // Give exit-in a high inflow rate so a steady wide-hall crowd forms while exit-out stays 0.
        for (int i = 0; i < doc.Modules.Count; i++) {
            var m = doc.Modules[i];
            if (m.Id == "exit-in") {
                m.HasExitInRate = true;
                m.ExitInRate = 7200;
                doc.Modules[i] = m;
            }
        }
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc,
            Day = AlwaysOpenDay(1.2),
            Seed = 42,
            StartSimTime = 8 * 3600,
            StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions {
                RoutingMode = mode,
                SparseOptions = sparseOpts,
                AlightPerTrain = 0,
            },
        });

        var lanes16 = new Dictionary<int, int>();
        var lanes22 = new Dictionary<int, int>();
        int total16 = 0, total22 = 0;

        for (int t = 0; t < ticks; t++) {
            session.Advance(1.0);
            var frames = session.PassengerFrames();
            for (int i = 0; i < frames.Length; i++) {
                var p = frames[i];
                if (p.State != StationPassengerState.Walking) continue;
                int tx = (int)Math.Floor(p.X);
                int ty = (int)Math.Floor(p.Y);
                if (Math.Abs(p.Z - 10.0) > 0.5) continue;
                if (tx == 16) {
                    lanes16.TryGetValue(ty, out int c);
                    lanes16[ty] = c + 1;
                    total16++;
                } else if (tx == 22) {
                    lanes22.TryGetValue(ty, out int c);
                    lanes22[ty] = c + 1;
                    total22++;
                }
            }
        }

        double share16 = total16 > 0 ? (double)lanes16.Values.Max() / total16 : 1.0;
        double share22 = total22 > 0 ? (double)lanes22.Values.Max() / total22 : 1.0;
        return (share16, share22, session.Services.Exited, session.Services.Spawned);
    }

    static double Percentile(List<double> sorted, double p) {
        if (sorted.Count == 0) return 0;
        int idx = Math.Min(sorted.Count - 1, Math.Max(0, (int)Math.Ceiling(sorted.Count * p) - 1));
        return sorted[idx];
    }

    [Test]
    public void SharedOraclePolicyTopologyAndRollingStepParity() {
        string oraclePath = Path.Combine(Application.dataPath, "StationDesigner/Tests/EditMode/crowd-routing-oracle.json");
        Assert.IsTrue(File.Exists(oraclePath), "crowd-routing-oracle.json must exist at " + oraclePath);
        var oracle = JObject.Parse(File.ReadAllText(oraclePath));

        // 1. toMs half-up vectors
        foreach (var v in (JArray)oracle["toMsVectors"]) {
            Assert.AreEqual((int)v["ms"], StationSparsePolicy.ToMs((double)v["seconds"]), "toMs(" + v["seconds"] + ")");
        }

        // 2. Negative floorDiv vectors
        foreach (var v in (JArray)oracle["floorDivVectors"]) {
            Assert.AreEqual((int)v["result"], StationSparsePolicy.FloorDiv((int)v["a"], (int)v["b"]),
                $"floorDiv({v["a"]},{v["b"]})");
        }

        // 3. Monotonic tile & sector keys
        foreach (var v in (JArray)oracle["packTileVectors"]) {
            int tx = (int)v["tx"], ty = (int)v["ty"], tz2 = (int)v["tz2"];
            Assert.AreEqual((long)v["tileKey"], StationSparsePolicy.PackTileKey(tx, ty, tz2), $"packTileKey({tx},{ty},{tz2})");
            Assert.AreEqual((long)v["sectorKey"], StationSparsePolicy.SectorKeyOfTile(tx, ty, tz2), $"sectorKey({tx},{ty},{tz2})");
        }

        // 4. Bit-exact Murmur3 hash32 and jitter vectors
        foreach (var v in (JArray)oracle["hashVectors"]) {
            int seed = (int)v["seed"], agentId = (int)v["agentId"], segSeq = (int)v["segSeq"];
            int tx = (int)v["tx"], ty = (int)v["ty"], tz2 = (int)v["tz2"], k = (int)v["k"];
            uint hInit = StationSparsePolicy.Hash32Init(seed);
            uint hMix = StationSparsePolicy.Hash32Mix(hInit, agentId);
            uint hTile = StationSparsePolicy.Hash32Tile(seed, tx, ty, tz2);
            int jitter = StationSparsePolicy.Hash32Jitter(seed, agentId, segSeq, tx, ty, tz2);
            Assert.AreEqual((uint)v["hInit"], hInit, "hash32Init");
            Assert.AreEqual((uint)v["hMix"], hMix, "hash32Mix");
            Assert.AreEqual((uint)v["hTile"], hTile, "hash32Tile");
            Assert.AreEqual((int)v["jitter"], jitter, "hash32Jitter");
        }

        // 5. Octant & exact scoreTileMs vectors
        foreach (var v in (JArray)oracle["octantVectors"]) {
            Assert.AreEqual((int)v["oct"], StationSparsePolicy.OctantOf((int)v["dx"], (int)v["dy"]));
        }
        foreach (var v in (JArray)oracle["scoreVectors"]) {
            Assert.AreEqual((int)v["octDiff"],
                StationSparsePolicy.ShortestOctantDifference((int)v["heading"], (int)v["moveOct"]));
            int score = StationSparsePolicy.ScoreTileMs(
                (int)v["edgeCostMs"], (int)v["remainingMs"],
                (int)v["direct"], (int)v["adjSum"], (int)v["adjCnt"], (int)v["otherClaims"],
                (int)v["heading"], (int)v["moveOct"],
                (int)v["seed"], (int)v["agentId"], (int)v["segSeq"],
                (int)v["tx"], (int)v["ty"], (int)v["tz2"],
                (bool)v["useDensity"], (bool)v["useBias"], (bool)v["useClaims"]);
            Assert.AreEqual((int)v["scoreMs"], score, "scoreTileMs parity");
        }

        // 6. Multi-sector fence-split topology, coarse A*, and rolling 16-step parity
        var fx = (JObject)oracle["fixture"];
        int fxSeed = (int)oracle["seed"];
        int w = (int)fx["width"], h = (int)fx["height"], floorZ = (int)fx["floorZ"];
        var doc = new StationSessionDocument { StationId = "oracle-fence-split", LevelBase = 0 };
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) doc.Cells.Add(new StationCellFact { X = x, Y = y, Z = floorZ, Solid = true, Zone = 0, Speed = 0.9 });
        }
        foreach (var wb in (JArray)fx["wallBlocks"]) {
            doc.Cells.Add(new StationCellFact { X = (int)wb[0], Y = (int)wb[1], Z = (int)wb[2], Solid = true, Zone = 0, Speed = 0.9 });
        }

        var graph = StationWalkGraphBuilder.BuildWorkspace(doc, new StationWalkGraphOptions { IncludeGround = false }).Graph;
        var topo = StationSparseTopology.Build(graph, fxSeed, null, null, out _);

        const int floorTz2 = 18;
        var floorSectors = topo.Sectors.Values.Where(s => s.Tz2 == floorTz2).ToArray();
        var floorSectorSet = new HashSet<long>(floorSectors.Select(s => s.SectorKey));
        var floorRegions = topo.Regions.Where(r => floorSectorSet.Contains(r.SectorKey)).OrderBy(r => r.RegionKey).ToArray();
        var floorRegionSet = new HashSet<long>(floorRegions.Select(r => r.RegionKey));
        var floorCrossings = topo.Crossings
            .Where(c => floorRegionSet.Contains(c.FromRegionKey) && floorRegionSet.Contains(c.ToRegionKey))
            .OrderBy(c => c.StableKey, StringComparer.Ordinal)
            .ToArray();

        Assert.AreEqual((int)fx["sectorCount"], floorSectors.Length, "sectorCount parity");
        Assert.AreEqual((int)fx["regionCount"], floorRegions.Length, "regionCount parity");
        Assert.AreEqual((int)fx["crossingCount"], floorCrossings.Length, "crossingCount parity");

        var actualSectorKeys = floorSectors.Select(s => s.SectorKey).OrderBy(k => k).ToArray();
        var expectedSectorKeys = ((JArray)fx["sectorKeys"]).Select(x => (long)x).ToArray();
        CollectionAssert.AreEqual(expectedSectorKeys, actualSectorKeys, "sectorKeys parity");

        var actualRegions = floorRegions;
        var expectedRegions = (JArray)fx["regions"];
        for (int i = 0; i < expectedRegions.Count; i++) {
            Assert.AreEqual((long)expectedRegions[i]["regionKey"], actualRegions[i].RegionKey, "regionKey " + i);
            Assert.AreEqual((long)expectedRegions[i]["sectorKey"], actualRegions[i].SectorKey, "sectorKey " + i);
            Assert.AreEqual((int)expectedRegions[i]["tileCount"], actualRegions[i].Nodes.Length, "tileCount " + i);
            Assert.AreEqual((long)expectedRegions[i]["sampleTileKey"], actualRegions[i].SampleTileKey, "sampleTileKey " + i);
        }

        var actualCrossings = floorCrossings;
        var expectedCrossings = (JArray)fx["crossings"];
        for (int i = 0; i < expectedCrossings.Count; i++) {
            Assert.AreEqual((string)expectedCrossings[i]["stableKey"], actualCrossings[i].StableKey, "crossing stableKey " + i);
            Assert.AreEqual((long)expectedCrossings[i]["fromRegionKey"], actualCrossings[i].FromRegionKey, "crossing fromRegionKey " + i);
            Assert.AreEqual((long)expectedCrossings[i]["toRegionKey"], actualCrossings[i].ToRegionKey, "crossing toRegionKey " + i);
            Assert.AreEqual((int)expectedCrossings[i]["edgeCount"], actualCrossings[i].FromNodes.Length, "crossing edgeCount " + i);
            Assert.AreEqual((long)expectedCrossings[i]["repFromKey"], actualCrossings[i].RepFromKey, "crossing repFromKey " + i);
            Assert.AreEqual((long)expectedCrossings[i]["repToKey"], actualCrossings[i].RepToKey, "crossing repToKey " + i);
            Assert.AreEqual((int)expectedCrossings[i]["repCostMs"], actualCrossings[i].RepCostMs, "crossing repCostMs " + i);
        }

        var startArr = (JArray)fx["startCoord"];
        var goalArr = (JArray)fx["goalCoord"];
        var crowdArr = (JArray)fx["crowdCoord"];
        Assert.IsTrue(graph.TryNode((int)startArr[0], (int)startArr[1], (int)startArr[2], out int startNode));
        Assert.IsTrue(graph.TryNode((int)goalArr[0], (int)goalArr[1], (int)goalArr[2], out int goalNode));
        Assert.IsTrue(graph.TryNode((int)crowdArr[0], (int)crowdArr[1], (int)crowdArr[2], out int crowdNode));

        var router = new StationSparseRouter(graph, fxSeed, null);
        router.BeginTick(1, null, null);
        var st = router.StartCoarseSearch(startNode, goalNode, StationRouteNeeds.Walking, -1, 0, 1, out var itin, out int jid);
        if (st == StationSparseRouter.CoarseJobStatus.Running) {
            itin = router.StepCoarseJobNow(jid, 20000, 80000)?.Result;
        }
        Assert.IsNotNull(itin, "coarse itinerary found");
        Assert.AreEqual((int)fx["coarseTotalCostMs"], itin.TotalCostMs, "coarseTotalCostMs parity");
        Assert.AreEqual((int)fx["coarseStepCount"], itin.Steps.Length, "coarseStepCount parity");

        // Rolling 16-step parity (free-flow)
        var w1 = router.CreateWalker(goalNode, 0);
        w1.Itinerary = itin;
        int[] p1 = new[] { startNode };
        int pi1 = 0;
        var r1 = router.RefillWalker(1, ref p1, ref pi1, w1, 1, startNode, 0);
        if (r1 == StationSparseRouter.RefillResult.Pending) {
            router.RunMandatoryBudget(1, null);
            r1 = router.RefillWalker(1, ref p1, ref pi1, w1, 1, startNode, 0);
        }
        Assert.AreEqual(StationSparseRouter.RefillResult.Ok, r1);
        var expSeg1 = (JArray)fx["seg1Free"];
        Assert.AreEqual(expSeg1.Count, p1.Length, "seg1 length parity");
        for (int i = 0; i < expSeg1.Count; i++) {
            int n = p1[i];
            Assert.AreEqual((int)expSeg1[i][0], (int)Math.Floor(graph.NodeX[n]), $"seg1[{i}].x");
            Assert.AreEqual((int)expSeg1[i][1], (int)Math.Floor(graph.NodeY[n]), $"seg1[{i}].y");
            Assert.AreEqual((int)expSeg1[i][2], StationServiceRuntime.JsRound(graph.NodeZ[n]) - 1, $"seg1[{i}].z");
        }

        // Rolling 16-step parity (with standing body at crowdCoord)
        router.Occupancy.Clear();
        router.Occupancy.Add(crowdNode);
        var w2 = router.CreateWalker(goalNode, 0);
        w2.Itinerary = itin;
        int[] p2 = new[] { startNode };
        int pi2 = 0;
        var r2 = router.RefillWalker(2, ref p2, ref pi2, w2, 1, startNode, 0);
        Assert.AreEqual(StationSparseRouter.RefillResult.Ok, r2);
        var expSeg2 = (JArray)fx["seg2Crowded"];
        Assert.AreEqual(expSeg2.Count, p2.Length, "seg2 length parity");
        for (int i = 0; i < expSeg2.Count; i++) {
            int n = p2[i];
            Assert.AreEqual((int)expSeg2[i][0], (int)Math.Floor(graph.NodeX[n]), $"seg2[{i}].x");
            Assert.AreEqual((int)expSeg2[i][1], (int)Math.Floor(graph.NodeY[n]), $"seg2[{i}].y");
            Assert.AreEqual((int)expSeg2[i][2], StationServiceRuntime.JsRound(graph.NodeZ[n]) - 1, $"seg2[{i}].z");
        }
    }

    [Test]
    public void WideHallApproachSpreadsCrowdAndPreservesNarrowControl() {
        var legacy = MeasureWideHall(WideHallDocument(), StationRoutingMode.Legacy);
        var sparse = MeasureWideHall(WideHallDocument(), StationRoutingMode.Sparse);
        var noClaims = MeasureWideHall(WideHallDocument(), StationRoutingMode.Sparse, new StationSparseRouterOptions { UseClaims = false });
        var noDensity = MeasureWideHall(WideHallDocument(), StationRoutingMode.Sparse, new StationSparseRouterOptions { UseDensity = false });

        TestContext.WriteLine(
            $"[WideHallUnity] legacy=({legacy.Share16:F3},{legacy.Share22:F3},exit={legacy.Exited}) " +
            $"sparse=({sparse.Share16:F3},{sparse.Share22:F3},exit={sparse.Exited}) " +
            $"noClaims=({noClaims.Share16:F3},{noClaims.Share22:F3}) noDensity=({noDensity.Share16:F3},{noDensity.Share22:F3})");

        Assert.Greater(sparse.Exited, 0, "escalator still queues and drains in sparse mode");
        Assert.LessOrEqual(sparse.Share22, legacy.Share22 * 0.75,
            $"sparse busiest-lane share at approach x=22 ({sparse.Share22:F3}) must be >= 25% lower than legacy ({legacy.Share22:F3})");

        // Narrow single-route control retains completion within 5%
        var narrowLegacy = MeasureWideHall(WideHallDocument(width: 1, length: 24, diagonalOffset: false), StationRoutingMode.Legacy, ticks: 140);
        var narrowSparse = MeasureWideHall(WideHallDocument(width: 1, length: 24, diagonalOffset: false), StationRoutingMode.Sparse, ticks: 140);
        Assert.Greater(narrowLegacy.Exited, 10, "narrow legacy exits passengers");
        Assert.GreaterOrEqual(narrowSparse.Exited, (int)Math.Floor(narrowLegacy.Exited * 0.95),
            $"narrow control sparse exited ({narrowSparse.Exited}) must stay within 5% of legacy ({narrowLegacy.Exited})");
    }

    [Test]
    public void RemoteEditPreservesFieldsRollbackIsCleanAndLifecycleRulesHold() {
        var doc = WideHallDocument(width: 9, length: 48, diagonalOffset: false);
        for (int i = 0; i < doc.Modules.Count; i++) {
            var m = doc.Modules[i];
            if (m.Id == "exit-in") { m.HasExitInRate = true; m.ExitInRate = 3600; doc.Modules[i] = m; }
        }
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc,
            Day = AlwaysOpenDay(1.0),
            Seed = 42,
            StartSimTime = 8 * 3600,
            StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { RoutingMode = StationRoutingMode.Sparse, AlightPerTrain = 0 },
        });

        for (int t = 0; t < 25; t++) session.Advance(1.0);
        var before = session.Services.SparseRoutingStats();
        Assert.Greater(before.FieldCacheEntries, 0, "reverse fields cached before edit");
        Assert.IsTrue(session.Services.AllWalkingRoutesMatchCurrentGraph());

        // 1. Staged edit + AbortDocumentEdit leaves active router completely untouched
        var abortDelta = new StationSessionDelta();
        abortDelta.ChangedCells.Add(SolidCell(75, 0, 9, 2));
        session.StageCellDelta(doc.StationId, doc.LevelBase, session.Clock.Day, abortDelta);
        session.AbortDocumentEdit();
        var afterAbort = session.Services.SparseRoutingStats();
        Assert.AreEqual(before.TopologyRevision, afterAbort.TopologyRevision, "rollback must not bump topology revision");
        Assert.AreEqual(before.FieldCacheEntries, afterAbort.FieldCacheEntries, "rollback must not evict fields");
        Assert.IsTrue(session.Services.AllWalkingRoutesMatchCurrentGraph());

        // 2. Remote structural edit far from active corridor preserves unaffected reverse fields
        var remoteDelta = new StationSessionDelta();
        remoteDelta.ChangedCells.Add(SolidCell(80, 0, 9, 2));
        remoteDelta.ChangedCells.Add(SolidCell(81, 0, 9, 2));
        var staged = session.StageCellDelta(doc.StationId, doc.LevelBase, session.Clock.Day, remoteDelta);
        session.CommitDocumentEdit(staged);
        var afterRemote = session.Services.SparseRoutingStats();
        Assert.Greater(afterRemote.FieldsPreservedOnEdit, 0, "unaffected reverse fields must survive distant edit");
        Assert.Less(afterRemote.SectorsRebuilt, afterRemote.SectorCount, "only touched sector + halo rebuilt");
        Assert.IsTrue(session.Services.AllWalkingRoutesMatchCurrentGraph());

        // 3. Clock scrub must NOT trigger sample refresh; real Pause -> Play DOES
        int samplesBeforeSeek = afterRemote.SamplesRefreshed;
        session.SeekToSimTime(8 * 3600 + 3600);
        session.Advance(1.0);
        Assert.AreEqual(samplesBeforeSeek, session.Services.SparseRoutingStats().SamplesRefreshed,
            "clock scrub must not trigger sample refresh");

        session.SetPlaying(false);
        session.SetPlaying(true);
        session.Advance(1.0);
        Assert.Greater(session.Services.SparseRoutingStats().SamplesRefreshed, samplesBeforeSeek,
            "Pause -> Play must schedule optional sample refresh for dirty sectors");

        // 4. Same-document Restart retains validated fields while clearing live claims
        int fieldsBeforeRestart = session.Services.SparseRoutingStats().FieldCacheEntries;
        int sessionBeforeRestart = session.Services.SparseRouter.SessionId;
        session.Restart();
        var afterRestart = session.Services.SparseRoutingStats();
        Assert.AreEqual(fieldsBeforeRestart, afterRestart.FieldCacheEntries, "Restart retains validated reverse fields");
        Assert.AreEqual(0, afterRestart.ActiveClaims, "Restart clears live soft claims");
        Assert.AreEqual(sessionBeforeRestart, session.Services.SparseRouter.SessionId, "Restart keeps same sessionId");

        // 5. LoadDocument starts a fresh sessionId
        session.LoadDocument(doc, 8 * 3600, 42);
        Assert.AreEqual(sessionBeforeRestart + 1, session.Services.SparseRouter.SessionId, "LoadDocument increments sessionId");
    }

    [Test]
    public void TightWorkCapRemainsDeterministicAcrossReplays() {
        (string PosHash, int Exited, long CoarseExp, long FieldExp) RunOnce() {
            var doc = WideHallDocument(width: 9, length: 32, twoConnectors: true, diagonalOffset: false);
            for (int i = 0; i < doc.Modules.Count; i++) {
                var m = doc.Modules[i];
                if (m.Id == "exit-in") { m.HasExitInRate = true; m.ExitInRate = 7200; doc.Modules[i] = m; }
            }
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = doc,
                Day = AlwaysOpenDay(1.0),
                Seed = 777,
                StartSimTime = 8 * 3600,
                StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                Services = new StationServiceOptions {
                    RoutingMode = StationRoutingMode.Sparse,
                    AlightPerTrain = 0,
                    SparseOptions = new StationSparseRouterOptions {
                        MandatoryPopBudget = 400,
                        MandatoryScanBudget = 1600,
                        LocalRefillBudget = 12,
                    },
                },
            });
            for (int t = 0; t < 80; t++) session.Advance(1.0);
            var frames = session.PassengerFrames();
            double sum = 0;
            for (int i = 0; i < frames.Length; i++) {
                sum += frames[i].SimId * 0.001 + frames[i].X * 13.7 + frames[i].Y * 7.3 + frames[i].Z * 3.1;
            }
            var stats = session.Services.SparseRoutingStats();
            return (sum.ToString("F6"), session.Services.Exited, stats.CoarseExpansions, stats.FieldExpansions);
        }

        var a = RunOnce();
        var b = RunOnce();
        Assert.AreEqual(a.PosHash, b.PosHash, "positions deterministic under tight work caps");
        Assert.AreEqual(a.Exited, b.Exited, "exited deterministic under tight work caps");
        Assert.AreEqual(a.CoarseExp, b.CoarseExp, "coarse expansions deterministic");
        Assert.AreEqual(a.FieldExp, b.FieldExp, "field expansions deterministic");
    }

    [Test]
    public void TianheLine13AlightersWalkAwayFromScreenDoorsAfterColdStart() {
        string path = Path.Combine(Application.dataPath, "StationDesigner/Demos/tianhe.metro.json");
        var source = StationDocumentReader.ReadFile(path);
        Assert.IsNotNull(source?.Document);
        var setup = StationSessionProjection.Setup(source.Document, source.Index, "tianhe-line-13-alighting");
        setup.StartPlaying = true;
        var session = new StationSimulationSession(setup);

        var line13Arrivals = new HashSet<int>();
        var firstPlatformTick = new Dictionary<int, int>();
        var walkDelayTicks = new Dictionary<int, int>();
        var walkedFromDoor = new HashSet<int>();
        for (int tick = 0; tick < 90; tick++) {
            session.Advance(1.0);
            foreach (var passenger in session.Snapshot().Passengers) {
                if (passenger.State == StationPassengerState.Alighting &&
                    passenger.ServerId.StartsWith("line:13|", StringComparison.Ordinal)) {
                    line13Arrivals.Add(passenger.SimId);
                }
                if (!line13Arrivals.Contains(passenger.SimId)) continue;
                if (passenger.State != StationPassengerState.Alighting && !firstPlatformTick.ContainsKey(passenger.SimId)) {
                    firstPlatformTick[passenger.SimId] = tick;
                }
                if (firstPlatformTick.TryGetValue(passenger.SimId, out int landedTick) &&
                    !walkDelayTicks.ContainsKey(passenger.SimId) &&
                    passenger.WalkDistance > 0.01) {
                    walkDelayTicks[passenger.SimId] = tick - landedTick;
                }
                if (passenger.WalkDistance >= 1) {
                    walkedFromDoor.Add(passenger.SimId);
                }
            }
        }

        var delays = walkDelayTicks.Values.Select(v => (double)v).OrderBy(v => v).ToList();
        double p90 = Percentile(delays, 0.90);
        double maxDelay = delays.Count > 0 ? delays[delays.Count - 1] : double.PositiveInfinity;
        var stats = session.Services.SparseRoutingStats();

        Assert.AreEqual(534, line13Arrivals.Count, "both Line 13 trains delivered their wave");
        Assert.GreaterOrEqual(walkedFromDoor.Count, 500, "the arrival waves walked away from the door");
        Assert.LessOrEqual(p90, 2.0, $"Line 13 cold-start alighting-to-walk p90 delay ({p90}) regressed");
        Assert.LessOrEqual(maxDelay, 4.0, $"Line 13 cold-start alighting-to-walk max delay ({maxDelay}) regressed");
        Assert.Less(stats.FieldBuilds, 1500, $"coarse search must not trigger thousands of cold field builds (got {stats.FieldBuilds})");
        Assert.AreEqual(0, stats.FineFallbacks, "no fine-graph fallbacks during cold start");
    }

    [Test]
    public void TianheReachabilityRejectsAlightingOnlySidePlatformsWithZeroExpansions() {
        string path = Path.Combine(Application.dataPath, "StationDesigner/Demos/tianhe.metro.json");
        var source = StationDocumentReader.ReadFile(path);
        Assert.IsNotNull(source?.Document);
        var setup = StationSessionProjection.Setup(source.Document, source.Index, "tianhe-reachability");
        var session = new StationSimulationSession(setup);
        var router = session.Services.SparseRouter;
        Assert.IsNotNull(router);
        var topo = router.Topology;
        var graph = topo.Graph;

        int line11Door = -1, line13BoardDoor = -1, line13AlightDoor = -1;
        for (int i = 0; i < graph.Servers.Count; i++) {
            var s = graph.Servers[i];
            if (s.Kind != "door" || s.Node < 0) continue;
            if (line11Door < 0 && Math.Abs(graph.NodeZ[s.Node] - (-9.0)) < 0.5 && Math.Abs(graph.NodeX[s.Node] - (-14.5)) < 1.0) {
                line11Door = s.Node;
            }
            if (line13BoardDoor < 0 && Math.Abs(graph.NodeZ[s.Node] - (-19.0)) < 0.5 && Math.Abs(graph.NodeY[s.Node] - (-107.5)) < 1.0) {
                line13BoardDoor = s.Node;
            }
            if (line13AlightDoor < 0 && Math.Abs(graph.NodeZ[s.Node] - (-19.0)) < 0.5 && Math.Abs(graph.NodeY[s.Node] - (-111.5)) < 1.0) {
                line13AlightDoor = s.Node;
            }
        }
        Assert.GreaterOrEqual(line11Door, 0, "found Line 11 platform door");
        Assert.GreaterOrEqual(line13BoardDoor, 0, "found Line 13 boarding island door");
        Assert.GreaterOrEqual(line13AlightDoor, 0, "found Line 13 alighting-only outer door");

        Assert.IsTrue(topo.CanReach(line11Door, line13BoardDoor, stepFree: false), "Line 11 can reach Line 13 boarding island");
        Assert.IsFalse(topo.CanReach(line11Door, line13AlightDoor, stepFree: false), "Line 11 cannot reach Line 13 alighting-only outer platform");

        router.BeginTick(1, null, new Dictionary<string, double>());
        var before = router.Stats();
        var status = router.StartCoarseSearch(line11Door, line13AlightDoor, default, -1, 0, 1, out _, out int jobId);
        var after = router.Stats();
        Assert.AreEqual(StationSparseRouter.CoarseJobStatus.Failed, status, "unreachable target fails immediately");
        Assert.AreEqual(-1, jobId, "no coarse job allocated for unreachable target");
        Assert.AreEqual(before.CoarseExpansions, after.CoarseExpansions, "zero coarse expansions for unreachable target");
        Assert.AreEqual(before.FieldExpansions, after.FieldExpansions, "zero field expansions for unreachable target");
    }

    [Test]
    public void TianhePeakRushSparseBeatsLegacyExpansionsAndTickTails() {
        string path = Path.Combine(Application.dataPath, "StationDesigner/Demos/tianhe.metro.json");
        Assert.IsTrue(File.Exists(path), "tianhe.metro.json must exist");
        var source = StationDocumentReader.Read(File.ReadAllText(path), StationSource.None);

        (double TotalMs, double P50, double P95, double MaxMs, long TotalExp, long FineFallbacks, long CoarseQueries, int CacheBytes, int Exited, int Boarded, int Alighted, int Stuck, bool AllValid) RunTianhe(StationRoutingMode mode) {
            var setup = StationSessionProjection.Setup(source.Document, source.Index, "tianhe-" + mode);
            setup.Seed = 42;
            setup.StartSimTime = 8 * 3600;
            setup.StartPlaying = true;
            setup.Services ??= new StationServiceOptions();
            setup.Services.RoutingMode = mode;
            var session = new StationSimulationSession(setup);

            const int ticks = 180;
            var tickMs = new List<double>(ticks);
            var totalSw = Stopwatch.StartNew();
            for (int t = 0; t < ticks; t++) {
                var sw = Stopwatch.StartNew();
                session.Advance(1.0);
                sw.Stop();
                tickMs.Add(sw.Elapsed.TotalMilliseconds);
            }
            totalSw.Stop();
            tickMs.Sort();
            var stats = session.Services.SparseRoutingStats();
            long totalExp = mode == StationRoutingMode.Legacy
                ? session.Services.PlannerExpandedNodes
                : (stats.CoarseExpansions + stats.FieldExpansions + stats.FineExpansions);
            return (
                totalSw.Elapsed.TotalMilliseconds,
                Percentile(tickMs, 0.50),
                Percentile(tickMs, 0.95),
                tickMs[tickMs.Count - 1],
                totalExp,
                stats?.FineFallbacks ?? 0,
                stats?.CoarseQueries ?? 0,
                stats?.FieldCacheBytes ?? 0,
                session.Services.Exited,
                session.Services.Boarded,
                session.Services.Alighted,
                session.Services.Stuck,
                session.Services.AllWalkingRoutesMatchCurrentGraph()
            );
        }

        // Warm JIT briefly with 10 ticks
        RunTianhe(StationRoutingMode.Sparse);
        var legacy = RunTianhe(StationRoutingMode.Legacy);
        var sparse = RunTianhe(StationRoutingMode.Sparse);
        double fallbackRate = sparse.CoarseQueries > 0 ? (double)sparse.FineFallbacks / sparse.CoarseQueries : 0;

        TestContext.WriteLine(
            $"[CrowdRoutingTianheUnity] LEGACY totalMs={legacy.TotalMs:F1} p50={legacy.P50:F2} p95={legacy.P95:F2} max={legacy.MaxMs:F2} " +
            $"exp={legacy.TotalExp} boarded={legacy.Boarded} alighted={legacy.Alighted} exited={legacy.Exited} stuck={legacy.Stuck}");
        TestContext.WriteLine(
            $"[CrowdRoutingTianheUnity] SPARSE totalMs={sparse.TotalMs:F1} p50={sparse.P50:F2} p95={sparse.P95:F2} max={sparse.MaxMs:F2} " +
            $"exp={sparse.TotalExp} fallbacks={sparse.FineFallbacks}/{sparse.CoarseQueries} ({fallbackRate * 100:F2}%) " +
            $"cacheBytes={sparse.CacheBytes} boarded={sparse.Boarded} alighted={sparse.Alighted} exited={sparse.Exited} stuck={sparse.Stuck}");

        // Write raw machine-readable capture under .preview/crowd-routing/ for performance.md
        string outDir = Path.GetFullPath(Path.Combine(Application.dataPath, "../../.preview/crowd-routing"));
        Directory.CreateDirectory(outDir);
        var report = new JObject {
            ["station"] = "tianhe.metro.json",
            ["seed"] = 42,
            ["startSimTime"] = 8 * 3600,
            ["ticks"] = 180,
            ["legacy"] = new JObject {
                ["totalMs"] = Math.Round(legacy.TotalMs, 2),
                ["p50Ms"] = Math.Round(legacy.P50, 3),
                ["p95Ms"] = Math.Round(legacy.P95, 3),
                ["maxMs"] = Math.Round(legacy.MaxMs, 3),
                ["expansions"] = legacy.TotalExp,
                ["boarded"] = legacy.Boarded,
                ["alighted"] = legacy.Alighted,
                ["exited"] = legacy.Exited,
                ["stuck"] = legacy.Stuck,
            },
            ["sparse"] = new JObject {
                ["totalMs"] = Math.Round(sparse.TotalMs, 2),
                ["p50Ms"] = Math.Round(sparse.P50, 3),
                ["p95Ms"] = Math.Round(sparse.P95, 3),
                ["maxMs"] = Math.Round(sparse.MaxMs, 3),
                ["expansions"] = sparse.TotalExp,
                ["coarseQueries"] = sparse.CoarseQueries,
                ["fineFallbacks"] = sparse.FineFallbacks,
                ["fineFallbackRate"] = Math.Round(fallbackRate, 6),
                ["fieldCacheBytes"] = sparse.CacheBytes,
                ["boarded"] = sparse.Boarded,
                ["alighted"] = sparse.Alighted,
                ["exited"] = sparse.Exited,
                ["stuck"] = sparse.Stuck,
            },
        };
        File.WriteAllText(Path.Combine(outDir, "unity-tianhe-sparse-vs-legacy.json"), report.ToString());

        Assert.IsTrue(sparse.AllValid, "all sparse walking routes valid on current graph");
        Assert.LessOrEqual(sparse.TotalExp, legacy.TotalExp * 0.50,
            $"sparse expansions ({sparse.TotalExp}) must be >= 50% lower than legacy ({legacy.TotalExp})");
        Assert.Less(fallbackRate, 0.01,
            $"fine fallback rate ({fallbackRate * 100:F2}%) must be < 1%");
        Assert.LessOrEqual(sparse.P95, legacy.P95 * 0.70,
            $"sparse p95 ({sparse.P95:F2} ms) must be >= 30% lower than legacy ({legacy.P95:F2} ms)");
    }

    [Test]
    public void ZooStepFreeCoarseRouteIncludesLift15AndLift4076() {
        string path = Path.Combine(Application.dataPath, "StationDesigner/Demos/zoo.metro.json");
        var source = StationDocumentReader.Read(File.ReadAllText(path), StationSource.None);
        var setup = StationSessionProjection.Setup(source.Document, source.Index, "zoo-lift-check");
        setup.StartSimTime = 8 * 3600;
        setup.StartPlaying = true;
        var session = new StationSimulationSession(setup);
        var router = session.Services.SparseRouter;
        var topo = router.Topology;
        var liftArcs = topo.ExplicitArcs.Where(a => a.Kind == WalkEdgeKind.Lift).ToList();
        TestContext.WriteLine($"Zoo lift arcs ({liftArcs.Count}): " +
            string.Join(", ", liftArcs.Select(a => $"{a.LiftId}({topo.NodeTx[a.FromNode]},{topo.NodeTy[a.FromNode]},{topo.NodeTz2[a.FromNode]}->{topo.NodeTx[a.ToNode]},{topo.NodeTy[a.ToNode]},{topo.NodeTz2[a.ToNode]})")));
        Assert.IsTrue(liftArcs.Any(a => a.LiftId == "lift-15"), "lift-15 must have explicit arcs");
        Assert.IsTrue(liftArcs.Any(a => a.LiftId == "lift-4076"), "lift-4076 must have explicit arcs");

        // Verify a StepFree coarse search from concourse (-15) to platform door (-20) uses lift-15
        var g = session.WalkGraph;
        var lift15ToConcourse = liftArcs.First(a => a.LiftId == "lift-15" && topo.NodeTz2[a.ToNode] == -30);
        int concourseNode = lift15ToConcourse.ToNode;
        int doorNode = g.Servers.First(s => s.Kind == "door" && s.Node >= 0).Node;
        router.BeginTick(1, null, null);
        var status = router.StartCoarseSearch(concourseNode, doorNode, new StationRouteNeeds { StepFree = true }, -1, 0, 1, out var itin, out int jid);
        if (status == StationSparseRouter.CoarseJobStatus.Running) {
            itin = router.StepCoarseJobNow(jid, 100000, 400000)?.Result;
        }
        Assert.IsNotNull(itin, "StepFree coarse route from concourse to platform door must succeed");
        var usedLifts = itin.Steps.Where(s => !string.IsNullOrEmpty(s.LiftId)).Select(s => s.LiftId).Distinct().ToList();
        TestContext.WriteLine($"StepFree concourse->door lifts: [{string.Join(", ", usedLifts)}] totalCostMs={itin.TotalCostMs} steps={itin.Steps.Length}");
        Assert.IsTrue(usedLifts.Contains("lift-15"), "StepFree route to platform must use lift-15");
    }

    // -------------------------------------------------------- reflection helpers for targeted sparse-routing invariants

    static object SpawnSparseWalker(StationServiceRuntime services, double x, double y, double z, int destExitNode, string destExitId) {
        var rt = typeof(StationServiceRuntime);
        var pType = rt.GetNestedType("Passenger", BindingFlags.NonPublic);
        var phaseType = rt.GetNestedType("Phase", BindingFlags.NonPublic);
        var list = (System.Collections.IList)rt.GetField("passengers", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(services);
        var nextIdField = rt.GetField("nextPassengerId", BindingFlags.Instance | BindingFlags.NonPublic);
        int id = (int)nextIdField.GetValue(services) + 1;
        nextIdField.SetValue(services, id);

        var p = Activator.CreateInstance(pType);
        pType.GetField("Id").SetValue(p, id);
        pType.GetField("X").SetValue(p, x);
        pType.GetField("Y").SetValue(p, y);
        pType.GetField("Z").SetValue(p, z);
        pType.GetField("Phase").SetValue(p, Enum.Parse(phaseType, "Walking"));
        pType.GetField("Speed").SetValue(p, StationServiceRuntime.WalkSpeed);
        pType.GetField("DestExit").SetValue(p, destExitNode);
        pType.GetField("DestExitId").SetValue(p, destExitId ?? "");
        pType.GetField("Needs").SetValue(p, StationRouteNeeds.Walking);
        pType.GetField("RouteGraphEpoch").SetValue(p, services.GraphEpoch);
        list.Add(p);

        int startNode = services.NearestNode(x, y, z);
        Assert.GreaterOrEqual(startNode, 0, $"walker spawn ({x},{y},{z}) must land on walkable node");
        var startLeg = rt.GetMethod("StartSparseLeg", BindingFlags.Instance | BindingFlags.NonPublic);
        startLeg.Invoke(services, new object[] { p, startNode, destExitNode, null, null });
        return p;
    }

    static void QueueDummyRidersOnFirstEscalator(StationServiceRuntime services, int count, int destExitNode, string destExitId, out int esc1Server, out int esc2Server) {
        var rt = typeof(StationServiceRuntime);
        var pType = rt.GetNestedType("Passenger", BindingFlags.NonPublic);
        var phaseType = rt.GetNestedType("Phase", BindingFlags.NonPublic);
        var passengers = (System.Collections.IList)rt.GetField("passengers", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(services);
        var rides = (System.Collections.IList)rt.GetField("rides", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(services);
        var nextIdField = rt.GetField("nextPassengerId", BindingFlags.Instance | BindingFlags.NonPublic);
        var syncQueue = rt.GetMethod("SyncServerQueue", BindingFlags.Instance | BindingFlags.NonPublic);

        Assert.GreaterOrEqual(rides.Count, 2, "expected two escalator rides");
        var rideType = rides[0].GetType();
        var ride0 = rides[0];
        var ride1 = rides[1];
        esc1Server = (int)rideType.GetField("Server").GetValue(ride0);
        esc2Server = (int)rideType.GetField("Server").GetValue(ride1);
        int esc1Node = (int)rideType.GetField("Node").GetValue(ride0);
        int esc1Exit = (int)rideType.GetField("ExitNode").GetValue(ride0);
        var queue0 = (List<int>)rideType.GetField("Queue").GetValue(ride0);
        var g = services.Graph;

        for (int i = 0; i < count; i++) {
            int id = (int)nextIdField.GetValue(services) + 1;
            nextIdField.SetValue(services, id);
            var p = Activator.CreateInstance(pType);
            pType.GetField("Id").SetValue(p, id);
            pType.GetField("X").SetValue(p, g.NodeX[esc1Node]);
            pType.GetField("Y").SetValue(p, g.NodeY[esc1Node]);
            pType.GetField("Z").SetValue(p, g.NodeZ[esc1Node]);
            pType.GetField("StandX").SetValue(p, g.NodeX[esc1Node]);
            pType.GetField("StandY").SetValue(p, g.NodeY[esc1Node]);
            pType.GetField("Phase").SetValue(p, Enum.Parse(phaseType, "Queuing"));
            pType.GetField("Server").SetValue(p, esc1Server);
            pType.GetField("ServerId").SetValue(p, "ride:" + esc1Server);
            pType.GetField("Path").SetValue(p, new[] { esc1Node, esc1Exit });
            pType.GetField("PathIndex").SetValue(p, 0);
            pType.GetField("DestExit").SetValue(p, destExitNode);
            pType.GetField("DestExitId").SetValue(p, destExitId);
            pType.GetField("Needs").SetValue(p, StationRouteNeeds.Walking);
            pType.GetField("RouteGraphEpoch").SetValue(p, services.GraphEpoch);
            passengers.Add(p);
            queue0.Add(id);
        }
        syncQueue.Invoke(services, new object[] { esc1Server, queue0.Count });
    }

    [Test]
    public void SoftClaimTableCountsOtherAgentsExpiresReleasesAndRemapsCleanly() {
        var claims = new StationSoftClaimTable(10);
        claims.Refresh(1, 3, 4, 10, 4);
        claims.Refresh(2, 3, 5, 10, 4);
        Assert.AreEqual(2, claims.ActiveCount);
        Assert.AreEqual(1, claims.CountOtherAgentsOn(3, 1), "agent 1 sees agent 2 on tile 3, excluding self");
        Assert.AreEqual(2, claims.CountOtherAgentsOn(3, 3), "agent 3 sees both 1 and 2 on tile 3");
        Assert.AreEqual(0, claims.CountOtherAgentsOn(4, 1), "agent 1 does not count its own second step");
        Assert.AreEqual(1, claims.CountOtherAgentsOn(4, 2), "agent 2 sees agent 1 on tile 4");

        // TTL expiry
        claims.Expire(13);
        Assert.AreEqual(2, claims.ActiveCount, "claims live before TTL expiry");
        claims.Expire(14);
        Assert.AreEqual(0, claims.ActiveCount, "claims expire at TTL boundary");
        Assert.AreEqual(0, claims.CountOtherAgentsOn(3, 99), "expired node counts drop to zero");

        // Release removes single agent cleanly
        claims.Refresh(1, 2, 7, 20, 5);
        claims.Refresh(2, 2, 6, 20, 5);
        claims.Release(1);
        Assert.AreEqual(1, claims.ActiveCount);
        Assert.AreEqual(1, claims.CountOtherAgentsOn(2, 99), "remaining agent claim stays intact");
        Assert.AreEqual(0, claims.CountOtherAgentsOn(7, 99), "released agent claim is cleared");

        // Remap migrates surviving nodes and drops removed nodes
        claims.Remap(10, n => n == 2 ? 8 : -1);
        Assert.AreEqual(1, claims.ActiveCount);
        Assert.AreEqual(1, claims.CountOtherAgentsOn(8, 99), "surviving tile remaps");
        Assert.AreEqual(0, claims.CountOtherAgentsOn(6, 99), "deleted tile claim drops");
        Assert.AreEqual(0, claims.CountOtherAgentsOn(2, 99), "old tile index cleared");

        // Clear and Resize reset table completely
        claims.Clear();
        Assert.AreEqual(0, claims.ActiveCount);
        Assert.AreEqual(0, claims.CountOtherAgentsOn(8, 99));

        claims.Refresh(7, 1, 2, 30, 5);
        claims.Resize(5);
        Assert.AreEqual(0, claims.ActiveCount, "Resize clears active claims");
        Assert.AreEqual(0, claims.CountOtherAgentsOn(1, 99));
    }

    [Test]
    public void UShapedObstacleAcrossSectorSeamSplitsCrossingsAndNavigatesCleanly() {
        var doc = new StationSessionDocument { StationId = "u-seam-obstacle", LevelBase = 0 };
        for (int x = 0; x <= 31; x++) {
            for (int y = 0; y <= 10; y++) doc.Cells.Add(SolidCell(x, y, 4, 2));
        }
        // Fence at (15, 5, 4) splits the x=15|16 sector seam into two distinct openings (y=0..4 and y=6..10).
        doc.Modules.Add(new StationModuleFact { Id = "fence-split", Type = "fence", X = 15, Y = 5, Z = 4 });
        // U-shaped obstacle in sector 0 trapping eastbound direct movement from (8, 5, 4).
        doc.Modules.Add(new StationModuleFact { Id = "u1", Type = "fence", X = 9, Y = 4, Z = 4 });
        doc.Modules.Add(new StationModuleFact { Id = "u2", Type = "fence", X = 9, Y = 5, Z = 4 });
        doc.Modules.Add(new StationModuleFact { Id = "u3", Type = "fence", X = 9, Y = 6, Z = 4 });
        doc.Modules.Add(new StationModuleFact { Id = "u4", Type = "fence", X = 8, Y = 4, Z = 4 });
        doc.Modules.Add(new StationModuleFact { Id = "u5", Type = "fence", X = 8, Y = 6, Z = 4 });
        doc.Modules.Add(new StationModuleFact {
            Id = "exit-goal", Type = "exit", X = 25, Y = 5, Z = 4, Name = "E",
            HasExitInRate = true, ExitInRate = 0,
        });

        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc,
            Day = AlwaysOpenDay(1.0),
            Seed = 5,
            StartSimTime = 8 * 3600,
            StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { RoutingMode = StationRoutingMode.Sparse, Spawn = false, AlightPerTrain = 0 },
        });

        var g = session.WalkGraph;
        var topo = session.Services.SparseRouter.Topology;
        Assert.IsTrue(g.TryNode(0, 0, 4, out int leftNode));
        Assert.IsTrue(g.TryNode(20, 0, 4, out int rightNode));
        var leftReg = topo.Regions[topo.NodeRegion[leftNode]];
        var rightReg = topo.Regions[topo.NodeRegion[rightNode]];
        int seamCrossings = leftReg.Crossings.Count(c => c.ToRegion == rightReg.Id);
        Assert.AreEqual(2, seamCrossings, "fence at y=5 must split the x=15|16 sector seam into two distinct crossings");

        Assert.IsTrue(g.TryNode(25, 5, 4, out int exitNode));
        SpawnSparseWalker(session.Services, 8.5, 5.5, 5.0, exitNode, "exit-goal");

        for (int t = 0; t < 80 && session.Services.Exited == 0; t++) {
            session.Advance(1.0);
        }
        Assert.AreEqual(1, session.Services.Exited, "walker must escape the U-shaped pocket across the split sector seam");
        Assert.AreEqual(0, session.Services.Stuck, "walker must not get trapped or stuck");
    }

    [Test]
    public void TwoConnectorsBalanceArrivalsOntoUnloadedEscalator() {
        var doc = WideHallDocument(width: 11, length: 30, twoConnectors: true, diagonalOffset: false);
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc,
            Day = AlwaysOpenDay(1.0),
            Seed = 42,
            StartSimTime = 8 * 3600,
            StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { RoutingMode = StationRoutingMode.Sparse, Spawn = false, AlightPerTrain = 0 },
        });
        var g = session.WalkGraph;
        var exitOut = g.Exits.First(e => e.Id == "exit-out");
        QueueDummyRidersOnFirstEscalator(session.Services, 35, exitOut.Node, exitOut.Id, out int esc1Srv, out int esc2Srv);

        var pType = typeof(StationServiceRuntime).GetNestedType("Passenger", BindingFlags.NonPublic);
        var idField = pType.GetField("Id");
        var srvField = pType.GetField("Server");
        var fresh = new List<object>(30);
        for (int i = 0; i < 30; i++) {
            fresh.Add(SpawnSparseWalker(session.Services, 1.5, 5.5, 10.0, exitOut.Node, exitOut.Id));
        }

        var counted = new HashSet<int>();
        int esc1Fresh = 0, esc2Fresh = 0;
        for (int t = 0; t < 120; t++) {
            session.Advance(1.0);
            for (int i = 0; i < fresh.Count; i++) {
                int id = (int)idField.GetValue(fresh[i]);
                if (counted.Contains(id)) continue;
                int srv = (int)srvField.GetValue(fresh[i]);
                if (srv == esc1Srv) { esc1Fresh++; counted.Add(id); }
                else if (srv == esc2Srv) { esc2Fresh++; counted.Add(id); }
            }
        }
        Assert.Greater(esc2Fresh, esc1Fresh,
            $"unloaded esc-2 ({esc2Fresh}) must attract more arrivals than heavily queued esc-1 ({esc1Fresh})");
        Assert.AreEqual(0, session.Services.Stuck, "no walkers stuck during connector balancing");
    }

    [Test]
    public void CoalescedSixtyTickSampleRefreshFiresAfterElapsedTicksNotClockScrub() {
        var doc = new StationSessionDocument { StationId = "sample-refresh-60t", LevelBase = 0 };
        for (int x = 0; x < 48; x++) {
            for (int y = 0; y < 12; y++) doc.Cells.Add(SolidCell(x, y, 4, 2));
        }
        doc.Modules.Add(new StationModuleFact {
            Id = "exit-b", Type = "exit", X = 30, Y = 5, Z = 4, Name = "B",
            HasExitInRate = true, ExitInRate = 0,
        });
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc,
            Day = AlwaysOpenDay(1.0),
            Seed = 17,
            StartSimTime = 8 * 3600,
            StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { RoutingMode = StationRoutingMode.Sparse, Spawn = false, AlightPerTrain = 0 },
        });
        int exitNode = session.WalkGraph.Exits[0].Node;
        SpawnSparseWalker(session.Services, 1.5, 5.5, 5.0, exitNode, "exit-b");
        for (int i = 0; i < 4; i++) session.Advance(1.0);
        Assert.Greater(session.Services.SparseRoutingStats().FieldCacheEntries, 0, "fields warmed before edit");

        // Distant edit in sector (2, 0) marks that sector's sample dirty.
        var delta = new StationSessionDelta();
        delta.ChangedModules.Add(new StationModuleFact { Id = "remote-fence", Type = "fence", X = 45, Y = 10, Z = 4 });
        var staged = session.StageCellDelta(doc.StationId, doc.LevelBase, session.Clock.Day, delta);
        session.CommitDocumentEdit(staged);

        int beforeScrub = session.Services.SparseRoutingStats().SamplesRefreshed;
        session.SeekToSimTime(session.Clock.SimTime + 3600);
        for (int i = 0; i < 5; i++) session.Advance(1.0);
        Assert.AreEqual(beforeScrub, session.Services.SparseRoutingStats().SamplesRefreshed,
            "clock scrub alone must not trigger the 60-tick coalesced sample refresh early");

        for (int i = 0; i < 60; i++) session.Advance(1.0);
        Assert.Greater(session.Services.SparseRoutingStats().SamplesRefreshed, beforeScrub,
            "60 elapsed ticks must fire the coalesced sample refresh");
    }

    [Test]
    public void FreeFlowSparseStretchStaysWithinFifteenPercentOfExactAStar() {
        // Multi-sector, two-storey hall with two escalators and an internal partition wall.
        var doc = WideHallDocument(width: 11, length: 36, twoConnectors: true, diagonalOffset: false);
        doc.Modules.Add(new StationModuleFact { Id = "wall-1", Type = "fence", X = 15, Y = 4, Z = 9 });
        doc.Modules.Add(new StationModuleFact { Id = "wall-2", Type = "fence", X = 15, Y = 5, Z = 9 });
        doc.Modules.Add(new StationModuleFact { Id = "wall-3", Type = "fence", X = 15, Y = 6, Z = 9 });

        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc,
            Day = AlwaysOpenDay(1.0),
            Seed = 55,
            StartSimTime = 8 * 3600,
            StartPlaying = false,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { RoutingMode = StationRoutingMode.Sparse, Spawn = false, AlightPerTrain = 0 },
        });
        var g = session.WalkGraph;
        var exact = new StationRoutePlanner(g);
        var router = session.Services.SparseRouter;
        router.BeginTick(1, null, null);

        var samples = new List<int>();
        int step = Math.Max(1, g.NodeCount / 36);
        for (int i = 0; i < g.NodeCount; i += step) samples.Add(i);

        var ratios = new List<double>();
        int limit = Math.Min(14, samples.Count);
        for (int i = 0; i < limit; i++) {
            for (int j = i + 1; j < limit; j++) {
                int u = samples[i], v = samples[j];
                var exactRoute = exact.Search(u, v, StationRouteNeeds.Walking);
                var status = router.StartCoarseSearch(u, v, StationRouteNeeds.Walking, -1, 0, 1, out var itin, out int jid);
                if (status == StationSparseRouter.CoarseJobStatus.Running && jid >= 0) {
                    var done = router.StepCoarseJobNow(jid, 500000, 2000000);
                    itin = done != null && done.Status == StationSparseRouter.CoarseJobStatus.Ready ? done.Result : null;
                }
                if (!exactRoute.Found) {
                    Assert.IsNull(itin, $"unreachable pair ({u}->{v}) must also be unreachable in sparse search");
                    continue;
                }
                Assert.IsNotNull(itin, $"reachable pair ({u}->{v}) must be reachable in sparse search");
                if (exactRoute.Cost > 1.0) {
                    ratios.Add((itin.TotalCostMs / 1000.0) / exactRoute.Cost);
                }
            }
        }
        Assert.GreaterOrEqual(ratios.Count, 10, $"checked {ratios.Count} reachable pairs");
        ratios.Sort();
        double p95 = Percentile(ratios, 0.95);
        Assert.LessOrEqual(p95, 1.15, $"free-flow p95 route stretch ({p95:F3}) must stay <= 1.15 vs exact A*");
    }

    [Test]
    public void BlockedWalkersReceiveLocalRefillsAheadOfCrowdedTailTrims() {
        var doc = WideHallDocument(width: 5, length: 24, twoConnectors: false, diagonalOffset: false);
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc,
            Day = AlwaysOpenDay(1.0),
            Seed = 42,
            StartSimTime = 8 * 3600,
            StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions {
                RoutingMode = StationRoutingMode.Sparse,
                Spawn = false,
                AlightPerTrain = 0,
                SparseOptions = new StationSparseRouterOptions { LocalRefillBudget = 4 },
            },
        });
        var exitOut = session.WalkGraph.Exits.First(e => e.Id == "exit-out");

        // 16 closely-packed walkers moving ahead so crowded-tail trims have plenty of candidates.
        for (int i = 0; i < 16; i++) {
            SpawnSparseWalker(session.Services, 2.5 + (i % 4), 2.5, 10.0, exitOut.Node, exitOut.Id);
        }
        for (int t = 0; t < 4; t++) session.Advance(1.0);

        // 4 fresh blocked walkers appended at the tail of passengers.
        var fresh = new List<object>(4);
        for (int i = 0; i < 4; i++) {
            fresh.Add(SpawnSparseWalker(session.Services, 1.5, 1.5 + i * 0.5, 10.0, exitOut.Node, exitOut.Id));
        }

        // Advance two ticks: Pass 1 must refill all 4 fresh blocked walkers ahead of Pass 3 trims.
        session.Advance(1.0);
        session.Advance(1.0);

        var pType = typeof(StationServiceRuntime).GetNestedType("Passenger", BindingFlags.NonPublic);
        var awaitField = pType.GetField("AwaitingRoute");
        var pathField = pType.GetField("Path");
        var idxField = pType.GetField("PathIndex");
        var idField = pType.GetField("Id");
        for (int i = 0; i < fresh.Count; i++) {
            bool awaiting = (bool)awaitField.GetValue(fresh[i]);
            var path = (int[])pathField.GetValue(fresh[i]);
            int pathIdx = (int)idxField.GetValue(fresh[i]);
            int id = (int)idField.GetValue(fresh[i]);
            Assert.IsFalse(awaiting, $"fresh blocked walker {id} must not be awaiting route");
            Assert.Greater(path.Length - 1, pathIdx,
                $"fresh blocked walker {id} must receive a Pass 1 rolling segment ahead of Pass 3 crowded-tail trims");
        }
    }

    [Test]
    public void TianheLine11AlightersWalkAwayFromScreenDoorsAfterColdStart() {
        string path = Path.Combine(Application.dataPath, "StationDesigner/Demos/tianhe.metro.json");
        var source = StationDocumentReader.ReadFile(path);
        Assert.IsNotNull(source?.Document);
        var setup = StationSessionProjection.Setup(source.Document, source.Index, "tianhe-line-11-alighting");
        setup.StartPlaying = true;
        var session = new StationSimulationSession(setup);

        var line11Arrivals = new HashSet<int>();
        var firstPlatformTick = new Dictionary<int, int>();
        var walkDelayTicks = new Dictionary<int, int>();
        var walkedFromDoor = new HashSet<int>();
        for (int tick = 0; tick < 90; tick++) {
            session.Advance(1.0);
            foreach (var passenger in session.PassengerFrames()) {
                if (passenger.State == StationPassengerState.Alighting &&
                    passenger.ServerId.StartsWith("line:11|", StringComparison.Ordinal)) {
                    line11Arrivals.Add(passenger.SimId);
                }
                if (!line11Arrivals.Contains(passenger.SimId)) continue;
                if (passenger.State != StationPassengerState.Alighting && !firstPlatformTick.ContainsKey(passenger.SimId)) {
                    firstPlatformTick[passenger.SimId] = tick;
                }
                if (firstPlatformTick.TryGetValue(passenger.SimId, out int landedTick) &&
                    !walkDelayTicks.ContainsKey(passenger.SimId) &&
                    passenger.WalkDistance > 0.01) {
                    walkDelayTicks[passenger.SimId] = tick - landedTick;
                }
                if (passenger.WalkDistance >= 1) {
                    walkedFromDoor.Add(passenger.SimId);
                }
            }
        }

        var delays = walkDelayTicks.Values.Select(v => (double)v).OrderBy(v => v).ToList();
        double p90 = Percentile(delays, 0.90);
        double maxDelay = delays.Count > 0 ? delays[delays.Count - 1] : double.PositiveInfinity;
        var stats = session.Services.SparseRoutingStats();

        Assert.GreaterOrEqual(firstPlatformTick.Count, 400, "both Line 11 directions delivered their landed arrival waves");
        // Tianhe demo has no street-level lift from concourse to grade, so Unity's 3% step-free exit-only alighters become Stuck;
        // every reachable Line 11 rider (100% of non-stuck) must walk away from screen doors without stalling.
        int allowedStuck = Math.Max(15, session.Services.Stuck + 5);
        Assert.GreaterOrEqual(walkedFromDoor.Count, 500, "at least 500 Line 11 riders walked away from screen doors");
        Assert.GreaterOrEqual(walkedFromDoor.Count, firstPlatformTick.Count - allowedStuck,
            $"Line 11 reachable landed riders walked away from screen doors ({walkedFromDoor.Count}/{firstPlatformTick.Count}, stuck={session.Services.Stuck})");
        Assert.LessOrEqual(p90, 2.0, $"Line 11 cold-start alighting-to-walk p90 delay ({p90}) regressed");
        Assert.LessOrEqual(maxDelay, 3.0, $"Line 11 cold-start alighting-to-walk max delay ({maxDelay}) regressed");
        Assert.Less(stats.FieldBuilds, 1500, $"coarse search must not trigger thousands of cold field builds (got {stats.FieldBuilds})");
        Assert.AreEqual(0, stats.FineFallbacks, "no fine-graph fallbacks during cold start");
    }

    [Test]
    public void IncrementalSparseTopologyMatchesFullBuildAcrossEdits() {
        var doc = WideHallDocument(width: 9, length: 34, twoConnectors: true, diagonalOffset: false);
        // Add a fare gate row across x=15 (right on the sector seam x=15|16!) to test seam + server + vertical transitions.
        for (int y = 0; y < 9; y++) {
            doc.Modules.Add(new StationModuleFact {
                Id = "gate-" + y, Type = "gate", X = 15, Y = y, Z = 9, Rot = 0, GateHasLane = true, GateDir = 0,
            });
        }
        var walkOpts = new StationWalkGraphOptions { IncludeGround = false };
        var ws = StationWalkGraphBuilder.BuildWorkspace(doc, walkOpts);
        var incTopo = StationSparseTopology.Build(ws.Graph, 42, null, null, out _);
        var refPrevTopo = StationSparseTopology.Build(ws.Graph, 42, null, null, out _);

        void ApplyAndAssertParity(string label, Action<StationSessionDocument, StationSessionDelta> mutate, IReadOnlyList<StationSparseLiftLink> lifts = null) {
            var delta = new StationSessionDelta();
            mutate(doc, delta);
            var staged = ws.StageCellDelta(doc, delta);
            ws = staged.Workspace;
            bool usedInc = incTopo.TryUpdateIncremental(staged.Graph, lifts, staged.Delta, out var incDiff);
            Assert.IsTrue(usedInc, label + ": expected TryUpdateIncremental to succeed");

            var refTopo = StationSparseTopology.Build(staged.Graph, 42, lifts, refPrevTopo, out var refDiff);
            refPrevTopo = refTopo;

            Assert.AreEqual(refTopo.TopologyRevision, incTopo.TopologyRevision, label + ": TopologyRevision");
            Assert.AreEqual(refDiff.RoutingNeutral, incDiff.RoutingNeutral, label + ": RoutingNeutral");
            Assert.AreEqual(refDiff.TopologyRevision, incDiff.TopologyRevision, label + ": Diff.TopologyRevision");
            CollectionAssert.AreEqual(refDiff.DirtySectorKeys, incDiff.DirtySectorKeys, label + ": DirtySectorKeys");
            Assert.IsTrue(refDiff.PreservedRegionKeys.SetEquals(incDiff.PreservedRegionKeys), label + ": PreservedRegionKeys");
            Assert.IsTrue(refDiff.DirtyRegionKeys.SetEquals(incDiff.DirtyRegionKeys), label + ": DirtyRegionKeys");
            Assert.AreEqual(refTopo.HasLifts, incTopo.HasLifts, label + ": HasLifts");
            Assert.AreEqual(refTopo.NodeCount, incTopo.NodeCount, label + ": NodeCount");
            Assert.AreEqual(refTopo.Sectors.Count, incTopo.Sectors.Count, label + ": SectorCount");
            Assert.AreEqual(refTopo.Regions.Count, incTopo.Regions.Count, label + ": RegionCount");
            Assert.AreEqual(refTopo.Crossings.Count, incTopo.Crossings.Count, label + ": CrossingCount");
            Assert.AreEqual(refTopo.ExplicitArcs.Count, incTopo.ExplicitArcs.Count, label + ": ExplicitArcCount");

            foreach (var kv in refTopo.Sectors) {
                Assert.IsTrue(incTopo.Sectors.TryGetValue(kv.Key, out var incSec), label + ": missing sector " + kv.Key);
                Assert.AreEqual(kv.Value.Signature, incSec.Signature, label + ": sector signature " + kv.Key);
                Assert.AreEqual(kv.Value.Revision, incSec.Revision, label + ": sector revision " + kv.Key);
            }

            foreach (var kv in refTopo.RegionByKey) {
                Assert.IsTrue(incTopo.RegionByKey.TryGetValue(kv.Key, out var incReg), label + ": missing region " + kv.Key);
                var refReg = kv.Value;
                Assert.AreEqual(refReg.Revision, incReg.Revision, label + ": region revision " + kv.Key);
                Assert.AreEqual(refReg.SampleTileKey, incReg.SampleTileKey, label + ": sample tile " + kv.Key);
                CollectionAssert.AreEqual(refReg.TileKeys, incReg.TileKeys, label + ": region tiles " + kv.Key);
                Assert.AreEqual(refReg.Crossings.Count, incReg.Crossings.Count, label + ": crossing count " + kv.Key);
                for (int i = 0; i < refReg.Crossings.Count; i++) {
                    var rc = refReg.Crossings[i];
                    var ic = incReg.Crossings[i];
                    Assert.AreEqual(rc.StableKey, ic.StableKey, label + ": crossing stableKey");
                    Assert.AreEqual(rc.RegionWalkMs, ic.RegionWalkMs, label + ": crossing RegionWalkMs");
                    Assert.AreEqual(rc.RepCostMs, ic.RepCostMs, label + ": crossing RepCostMs");
                    CollectionAssert.AreEqual(rc.UniqueFromKeys, ic.UniqueFromKeys, label + ": crossing UniqueFromKeys");
                }
                Assert.AreEqual(refReg.ExplicitArcs.Count, incReg.ExplicitArcs.Count, label + ": explicit arc count " + kv.Key);
                for (int i = 0; i < refReg.ExplicitArcs.Count; i++) {
                    var ra = refReg.ExplicitArcs[i];
                    var ia = incReg.ExplicitArcs[i];
                    Assert.AreEqual(ra.FromKey, ia.FromKey, label + ": arc FromKey");
                    Assert.AreEqual(ra.ToKey, ia.ToKey, label + ": arc ToKey");
                    Assert.AreEqual(ra.Kind, ia.Kind, label + ": arc Kind");
                    Assert.AreEqual(ra.Server, ia.Server, label + ": arc Server");
                    Assert.AreEqual(ra.FromNodeServer, ia.FromNodeServer, label + ": arc FromNodeServer");
                    Assert.AreEqual(ra.ToNodeServer, ia.ToNodeServer, label + ": arc ToNodeServer");
                    Assert.AreEqual(ra.GateDir, ia.GateDir, label + ": arc GateDir");
                    Assert.AreEqual(ra.StaticCostMs, ia.StaticCostMs, label + ": arc StaticCostMs");
                    Assert.AreEqual(ra.LiftId, ia.LiftId, label + ": arc LiftId");
                }
            }

            // Spot-check reachability parity on all exits/corners
            int sampleStep = Math.Max(1, staged.Graph.NodeCount / 19);
            for (int a = 0; a < staged.Graph.NodeCount; a += sampleStep) {
                for (int b = 0; b < staged.Graph.NodeCount; b += sampleStep) {
                    Assert.AreEqual(refTopo.CanReach(a, b, false), incTopo.CanReach(a, b, false), label + $": CanReach({a},{b},false)");
                    Assert.AreEqual(refTopo.CanReach(a, b, true), incTopo.CanReach(a, b, true), label + $": CanReach({a},{b},true)");
                }
            }
        }

        // 1. Add wall block splitting a sector (triggers node removal + pop-and-swap + region split!)
        ApplyAndAssertParity("split-sector-wall", (d, delta) => {
            for (int y = 0; y < 9; y++) {
                var c = SolidCell(8, y, 10, 2);
                d.Cells.Add(c);
                delta.ChangedCells.Add(c);
            }
        });

        // 2. Carve opening back through the wall (node addition + region merge!)
        ApplyAndAssertParity("reopen-wall", (d, delta) => {
            d.Cells.RemoveAll(c => c.X == 8 && c.Y == 4 && c.Z == 10);
            delta.RemovedCells.Add((8, 4, 10));
        });

        // 3. Remove a gate on the sector seam x=15 (server removal + plain walk restoration across seam!)
        ApplyAndAssertParity("remove-seam-gate", (d, delta) => {
            d.Modules.RemoveAll(m => m.Id == "gate-4");
            delta.RemovedModules.Add("gate-4");
        });

        // 4. Add a decorative non-walk module (routing-neutral fast path!)
        ApplyAndAssertParity("cosmetic-poster", (d, delta) => {
            var poster = new StationModuleFact { Id = "poster-1", Type = "poster", X = 4, Y = 4, Z = 10, Rot = 0 };
            d.Modules.Add(poster);
            delta.ChangedModules.Add(poster);
        });

        // 5. Paint zone change on surviving tiles
        ApplyAndAssertParity("zone-paint", (d, delta) => {
            for (int i = 0; i < d.Cells.Count; i++) {
                var c = d.Cells[i];
                if (c.X == 20 && c.Y >= 2 && c.Y <= 5 && c.Z == 9) {
                    c.Zone = 1;
                    d.Cells[i] = c;
                    delta.ChangedCells.Add(c);
                }
            }
        });

        // 6. Add & remove a lift link
        Assert.IsTrue(ws.Graph.TryNode(2, 2, 9, out int liftTop));
        Assert.IsTrue(ws.Graph.TryNode(40, 4, 4, out int liftBot));
        ApplyAndAssertParity("add-lift-link", (d, delta) => { }, new[] {
            new StationSparseLiftLink("lift-test", liftTop, liftBot, 40000),
            new StationSparseLiftLink("lift-test", liftBot, liftTop, 40000),
        });
        ApplyAndAssertParity("remove-lift-link", (d, delta) => { }, Array.Empty<StationSparseLiftLink>());
    }
}
