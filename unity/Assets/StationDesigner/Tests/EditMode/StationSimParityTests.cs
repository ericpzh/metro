using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

/// <summary>
/// Domain D1 simulation parity tests closing web-vs-Unity gaps across capacity,
/// crowd-routing, demo invariants, determinism, diagonal-walk, gate truth tables
/// & traffic forecasting, load/restart/pause lifecycles, wayfinding penalties &
/// rations, open-door boarding guard, and Tanwei PSD floor containment.
/// </summary>
public class StationSimParityTests {
    // -------------------------------------------------------------- shared builders

    static StationCellFact Cell(int x, int y, int z, int zone = 2, bool solid = true, double speed = 1.0) =>
        new StationCellFact { X = x, Y = y, Z = z, Zone = zone, Solid = solid, Speed = speed };

    static void AddPlate(StationSessionDocument doc, int x0, int x1, int y0, int y1, int z, int zone = 2, double speed = 1.0) {
        for (int x = x0; x <= x1; x++) {
            for (int y = y0; y <= y1; y++) {
                doc.Cells.Add(Cell(x, y, z, zone, true, speed));
            }
        }
    }

    static StationDayData AlwaysOpenWorkdayDay(double amPeak = 1.0) => new StationDayData(
        new DaySpan(0, StationClock.ServiceLatest),
        new PeakSpans(new DaySpan(7 * 3600, 10 * 3600), new DaySpan(17 * 3600, 20 * 3600)),
        new DayDemand(new DemandKnobs(amPeak, 0.78, 1.0), DemandKnobs.DefaultOffday),
        new SimCalendar(new SimDate(2026, 1, 5), Array.Empty<string>()));

    static int EdgeIndex(StationWalkGraph g, int x, int y, int z, int nx, int ny, int nz) {
        if (!g.TryNode(x, y, z, out int a) || !g.TryNode(nx, ny, nz, out int b)) return -1;
        var to = g.AdjTo[a];
        for (int e = 0; e < to.Length; e++) if (to[e] == b) return e;
        return -1;
    }

    static double EdgeCost(StationWalkGraph g, int x, int y, int z, int nx, int ny, int nz) {
        if (!g.TryNode(x, y, z, out int a)) return double.NaN;
        int e = EdgeIndex(g, x, y, z, nx, ny, nz);
        return e >= 0 ? g.AdjCost[a][e] : double.NaN;
    }

    static bool[] ReachableFrom(StationWalkGraph g, IEnumerable<int> starts) {
        var seen = new bool[g.NodeCount];
        var queue = new Queue<int>();
        foreach (int s in starts) {
            if (s >= 0 && s < g.NodeCount && !seen[s]) {
                seen[s] = true;
                queue.Enqueue(s);
            }
        }
        while (queue.Count > 0) {
            int u = queue.Dequeue();
            var to = g.AdjTo[u];
            for (int e = 0; e < to.Length; e++) {
                int v = to[e];
                if (!seen[v]) {
                    seen[v] = true;
                    queue.Enqueue(v);
                }
            }
        }
        return seen;
    }

    static StationSessionDocument ControlledCapacityStation(int upEscalators, int downEscalators = 2, int cars = 6, int alightPerTrain = 540, double exitInRate = 900) {
        var doc = new StationSessionDocument { StationId = $"cap-u{upEscalators}-c{cars}", LevelBase = 0 };
        const int zG = 0, zC = -5, zP = -10;

        // Platform (z = -10): x = -25..25, y = -6..0 (platform), track at y = -9..-7
        AddPlate(doc, -25, 25, -6, 0, zP, zone: 4, speed: 1.0);
        // Concourse (z = -5): x = -7..7, y = 0..24; gate line at y = 12 (y >= 12 unpaid, y < 12 paid)
        for (int x = -7; x <= 7; x++) {
            for (int y = 0; y <= 24; y++) {
                doc.Cells.Add(Cell(x, y, zC, zone: y >= 12 ? 2 : 3, solid: true, speed: 1.0));
            }
        }
        // Surface plaza (z = 0): x = -8..8, y = 24..34
        AddPlate(doc, -8, 8, 24, 34, zG, zone: 1, speed: 1.0);

        // Track and platform edge
        doc.Modules.Add(new StationModuleFact {
            Id = "track-1", Type = "track", X = -25, Y = -9, Z = zP, Rot = 0, Width = 50, Depth = 3,
            LineId = "2", Dir = "up",
        });
        doc.Modules.Add(new StationModuleFact {
            Id = "edge-1", Type = "platform-edge", X = -25, Y = -6, Z = zP, Rot = 0, Width = 50,
            LineId = "2", RailId = "track-1", Dir = "up", Side = "left",
        });

        // Three surface exits and surface <-> concourse escalator pairs
        int[] exitXs = { -5, 0, 5 };
        for (int i = 0; i < exitXs.Length; i++) {
            int ex = exitXs[i];
            doc.Modules.Add(new StationModuleFact {
                Id = "exit-" + i, Type = "exit", X = ex, Y = 30, Z = zG, Rot = 0, Name = "E" + i,
                HeadHouse = false, HasExitInRate = true, ExitInRate = exitInRate,
            });
            doc.Modules.Add(new StationModuleFact {
                Id = "esc-gc-down-" + i, Type = "escalator", X = ex, Y = 29, Z = zG, Rot = 0, Width = 1,
                HasEndpoints = true, FromX = ex, FromY = 29, FromZ = zG, ToX = ex, ToY = 20, ToZ = zC, Dir = "down",
            });
            doc.Modules.Add(new StationModuleFact {
                Id = "esc-gc-up-" + i, Type = "escalator", X = ex + 1, Y = 20, Z = zC, Rot = 0, Width = 1,
                HasEndpoints = true, FromX = ex + 1, FromY = 20, FromZ = zC, ToX = ex + 1, ToY = 29, ToZ = zG, Dir = "up",
            });
        }

        // Concourse <-> platform escalators
        int[] downXs = { -6, -4 };
        for (int i = 0; i < Math.Min(downEscalators, downXs.Length); i++) {
            int x = downXs[i];
            doc.Modules.Add(new StationModuleFact {
                Id = "esc-cp-down-" + i, Type = "escalator", X = x, Y = 6, Z = zC, Rot = 0, Width = 1,
                HasEndpoints = true, FromX = x, FromY = 6, FromZ = zC, ToX = x, ToY = -3, ToZ = zP, Dir = "down",
            });
        }
        int[] upXs = { -2, 0, 2, 4, 6 };
        for (int i = 0; i < Math.Min(upEscalators, upXs.Length); i++) {
            int x = upXs[i];
            doc.Modules.Add(new StationModuleFact {
                Id = "esc-cp-up-" + i, Type = "escalator", X = x, Y = -3, Z = zP, Rot = 0, Width = 1,
                HasEndpoints = true, FromX = x, FromY = -3, FromZ = zP, ToX = x, ToY = 6, ToZ = zC, Dir = "up",
            });
        }

        // 12 two-way gates across concourse y = 12 (Rot = 2 => entering south -y is +1, exiting north +y is -1)
        for (int x = -6; x <= 5; x++) {
            doc.Modules.Add(new StationModuleFact {
                Id = "gate-" + (x + 6), Type = "gate", X = x, Y = 12, Z = zC, Rot = 2,
                GateDir = 0, GateOpen = true, GateHasLane = true,
            });
        }

        doc.Lines.Add(new StationLineFact {
            Id = "2", Direction = "up", Stock = "B", Cars = cars, ModelScale = 0.98,
            HeadwayPeak = 150, HeadwayOffpeak = 240, HeadwayLate = 480,
            AlightPerTrain = alightPerTrain, AuthoredAlight = true,
        });
        return doc;
    }

    static StationSessionDocument FlatGateCorridorDocument(int gateDir, double exitInRate = 6000, int alightPerTrain = 200) {
        var doc = new StationSessionDocument { StationId = "flat-gate-" + gateDir, LevelBase = 0 };
        for (int x = 0; x <= 50; x++) {
            for (int y = 0; y <= 1; y++) {
                doc.Cells.Add(Cell(x, y, 0, zone: x <= 4 ? 2 : 3, solid: true, speed: 1.0));
            }
        }
        doc.Modules.Add(new StationModuleFact {
            Id = "exit", Type = "exit", X = 0, Y = 0, Z = 0, Rot = 0, Name = "A口",
            HeadHouse = false, HasExitInRate = true, ExitInRate = exitInRate,
        });
        // Rot = 3 => GateTravelDirection(3, dx, dy) == dx: +x (unpaid->paid) is +1, -x (paid->unpaid) is -1.
        doc.Modules.Add(new StationModuleFact {
            Id = "g1", Type = "gate", X = 5, Y = 0, Z = 0, Rot = 3,
            GateDir = gateDir, GateOpen = true, GateHasLane = true,
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
            AlightPerTrain = alightPerTrain, AuthoredAlight = true,
        });
        return doc;
    }

    static StationSessionDocument TwoGateForecastDocument() {
        var doc = new StationSessionDocument { StationId = "two-gate-forecast", LevelBase = 0 };
        for (int x = 0; x <= 10; x++) {
            for (int y = 0; y <= 4; y++) {
                doc.Cells.Add(Cell(x, y, -4, zone: x >= 6 ? 3 : 2, solid: true, speed: 1.0));
            }
        }
        // Rot = 3 => +x is entry (+1), -x is exit (-1).
        doc.Modules.Add(new StationModuleFact {
            Id = "gate-a", Type = "gate", X = 6, Y = 1, Z = -4, Rot = 3,
            GateDir = 0, GateOpen = true, GateHasLane = true,
        });
        doc.Modules.Add(new StationModuleFact {
            Id = "gate-b", Type = "gate", X = 6, Y = 3, Z = -4, Rot = 3,
            GateDir = 0, GateOpen = true, GateHasLane = true,
        });
        doc.Modules.Add(new StationModuleFact {
            Id = "exit-east", Type = "exit", X = 10, Y = 2, Z = -4, Rot = 0, Name = "E",
            HeadHouse = false, HasExitInRate = true, ExitInRate = 0,
        });
        return doc;
    }

    // --------------------------------------------------- 1. Tanwei PSD floor containment

    [Test]
    public void Tanwei555TickReplayKeepsOrdinaryPassengersInlandOfPlatformScreenDoors() {
        string path = Path.Combine(Application.dataPath, "StationDesigner/Demos/tanwei.metro.json");
        var read = StationDocumentReader.ReadFile(path);
        Assert.IsNotNull(read?.Document, "tanwei.metro.json must load");

        var setup = StationSessionProjection.Setup(read.Document, read.Index, "tanwei-psd-555");
        setup.Seed = 1234567;
        setup.StartPlaying = true;
        var session = new StationSimulationSession(setup);

        var edges = setup.Document.Modules.Where(m => m.Type == "platform-edge").ToList();
        Assert.GreaterOrEqual(edges.Count, 4, "Tanwei has platform edges on both levels");

        const double psdWallOffset = 0.34;
        int maxBeyond = 0;
        int totalViolations = 0;
        string firstDetail = "";

        for (int tick = 0; tick < 555; tick++) {
            session.Advance(1.0);
            int beyond = 0;
            var frames = session.PassengerFrames();
            for (int i = 0; i < frames.Length; i++) {
                var p = frames[i];
                if (p.State == StationPassengerState.Boarding || p.State == StationPassengerState.Alighting) continue;
                for (int e = 0; e < edges.Count; e++) {
                    var m = edges[e];
                    if (Math.Abs(p.Z - m.Z - 1.0) > 0.1) continue;
                    StationServiceCadence.RotateLocal(m.Rot, 0, m.Side == "right" ? -1 : 1, out double ix, out double iy);
                    StationServiceCadence.RotateLocal(-m.Rot, p.X - m.X - 0.5, p.Y - m.Y - 0.5, out double u, out _);
                    double depth = (p.X - m.X - 0.5) * ix + (p.Y - m.Y - 0.5) * iy;
                    if (u >= -0.5 && u < m.Width - 0.5 && depth < -psdWallOffset && depth > -2.0) {
                        beyond++;
                        if (firstDetail.Length == 0) {
                            firstDetail = $"tick={tick} id={p.SimId} state={p.State} edge={m.Id} depth={depth:F4}";
                        }
                    }
                }
            }
            if (beyond > maxBeyond) maxBeyond = beyond;
            totalViolations += beyond;
        }

        Assert.Greater(session.Services.Alighted, 0, "Tanwei replay must exercise alighting waves");
        Assert.Greater(session.Services.Exited, 0, "Tanwei replay must circulate passengers to exits");
        Assert.AreEqual(0, maxBeyond,
            $"ordinary walking/waiting passengers must remain inland of PSD (-{psdWallOffset} m); totalViolations={totalViolations}, first={firstDetail}");
    }

    // --------------------------------------------------- 2. All 3 demos invariants

    [Test]
    public void AllThreeShippedDemosHaveCleanGridCeilingPlatesModelScaleAndZeroDrops() {
        foreach (string id in new[] { "zoo", "tanwei", "tianhe" }) {
            string path = Path.Combine(Application.dataPath, "StationDesigner/Demos", id + ".metro.json");
            Assert.IsTrue(File.Exists(path), "missing demo save: " + path);

            // Inspect raw JSON file directly (so loader repairs cannot hide dirty shipped data).
            var raw = JObject.Parse(File.ReadAllText(path));
            var rawCells = (JArray)raw["static"]["cells"];
            int offGrid = 0;
            int rawCeilingLabeled = 0;
            for (int i = 0; i < rawCells.Count; i++) {
                var c = (JObject)rawCells[i];
                double x = (double)c["x"], y = (double)c["y"], z = (double)c["z"];
                if (x != Math.Floor(x) || y != Math.Floor(y) || z != Math.Floor(z)) offGrid++;
                var tags = c["tags"] as JArray;
                bool isCeiling = tags != null && tags.Any(t =>
                    string.Equals((string)t, "suspended-ceiling", StringComparison.Ordinal) ||
                    string.Equals((string)t, "opening-ceiling", StringComparison.Ordinal));
                if (isCeiling && (c["zone"] != null || c["room"] != null)) rawCeilingLabeled++;
            }
            Assert.AreEqual(0, offGrid, $"{id}: raw demo file must carry zero off-grid fractional cells");
            Assert.AreEqual(0, rawCeilingLabeled, $"{id}: raw demo ceiling plates must not carry zone/room labels");

            // Inspect loaded & projected document.
            var read = StationDocumentReader.ReadFile(path);
            Assert.IsNotNull(read?.Document, id + " read failed");
            Assert.AreEqual(0, read.Document.DroppedCells, $"{id}: demo load must drop 0 cells");
            Assert.AreEqual(0, read.Document.DroppedModules, $"{id}: demo load must drop 0 modules");
            Assert.Greater(read.Document.Lines.Count, 0, $"{id}: demo must declare at least one line");

            foreach (var cell in read.Document.Cells) {
                if (cell.HasTag("suspended-ceiling") || cell.HasTag("opening-ceiling")) {
                    Assert.IsTrue(string.IsNullOrEmpty(cell.Zone), $"{id}: ceiling cell {cell.Key} has zone '{cell.Zone}'");
                    Assert.IsTrue(string.IsNullOrEmpty(cell.Room), $"{id}: ceiling cell {cell.Key} has room '{cell.Room}'");
                }
            }

            var projected = StationSessionProjection.Document(read.Document, read.Index);
            foreach (var line in projected.Lines) {
                Assert.AreEqual(0.98, line.ModelScale, 1e-9, $"{id}: line {line.Id} ModelScale must equal 0.98");
            }
        }
    }

    [Test]
    public void ZooDemoSustainsCrowdThroughputAndConnectedCirculation() {
        string path = Path.Combine(Application.dataPath, "StationDesigner/Demos/zoo.metro.json");
        var read = StationDocumentReader.ReadFile(path);
        var setup = StationSessionProjection.Setup(read.Document, read.Index, "zoo-demo-parity");
        setup.StartPlaying = true;
        var session = new StationSimulationSession(setup);
        var g = session.WalkGraph;

        Assert.GreaterOrEqual(g.Exits.Count, 1, "Zoo has exits");
        Assert.GreaterOrEqual(g.Platforms.Count, 1, "Zoo has platforms");
        var fromExits = ReachableFrom(g, g.Exits.Select(e => e.Node));
        var fromPlatforms = ReachableFrom(g, g.Platforms.SelectMany(p => p.Cells));
        foreach (var plat in g.Platforms) {
            foreach (int c in plat.Cells) Assert.IsTrue(fromExits[c], $"Zoo platform {plat.Id} cell unreachable from exits");
            foreach (int d in plat.Doors) Assert.IsTrue(fromExits[g.Servers[d].Node], $"Zoo door {d} unreachable from exits");
        }
        foreach (var ex in g.Exits) Assert.IsTrue(fromPlatforms[ex.Node], $"Zoo exit {ex.Id} unreachable from platforms");

        for (int i = 0; i < 600; i++) session.Advance(1.0);
        Assert.Greater(session.Services.Boarded, 0, "Zoo must board passengers");
        Assert.Greater(session.Services.Exited, 0, "Zoo must exit passengers");
        int throughput = session.Services.PassengerCount + session.Services.Exited + session.Services.Boarded;
        Assert.Less(session.Services.Stuck, throughput * 0.5,
            $"Zoo stuck count ({session.Services.Stuck}) must remain a small fraction of throughput ({throughput})");
    }

    [Test]
    public void TianheDemoBuildsExactSixGroundEntrancesAndSixReachablePlatformEdges() {
        string path = Path.Combine(Application.dataPath, "StationDesigner/Demos/tianhe.metro.json");
        var read = StationDocumentReader.ReadFile(path);
        var projected = StationSessionProjection.Document(read.Document, read.Index);
        var g = StationWalkGraphWorkspace.Build(projected).Graph;

        var exitNames = g.Exits.Select(e => e.Name).OrderBy(n => n, StringComparer.Ordinal).ToArray();
        CollectionAssert.AreEqual(new[] { "B口", "C口", "D口", "E1口", "E2口", "F口" }, exitNames,
            "Tianhe Park must expose exact 6 ground-level entrances");

        var fromExits = ReachableFrom(g, g.Exits.Select(e => e.Node));
        var reachableEdges = g.Platforms
            .Where(p => p.Cells.Length > 0 && p.Cells.All(c => fromExits[c]))
            .Select(p => p.Id)
            .OrderBy(id => id, StringComparer.Ordinal)
            .ToArray();
        CollectionAssert.AreEqual(new[] {
            "edge-track-11-left",
            "edge-track-13-right",
            "edge-track-53-left",
            "edge-track-54-right",
            "edge-track-55-right",
            "edge-track-57-left",
        }, reachableEdges, "Tianhe Park must reach exact 6 platform edges (excluding Line 13 alighting-only outer platforms)");
    }

    // --------------------------------------------------- 3. Capacity bottleneck relief

    [Test]
    public void ThreeEscalatorsRelievePlatformBottleneckComparedToOneEscalatorAndEmptyReadsLosA() {
        // Empty station reads LOS A (free flow, never a crush).
        var emptyDoc = ControlledCapacityStation(upEscalators: 1, alightPerTrain: 0, exitInRate: 0);
        var emptySession = new StationSimulationSession(new StationSessionSetup {
            Document = emptyDoc, Day = AlwaysOpenWorkdayDay(1.0), Seed = 99,
            StartSimTime = 8 * 3600, StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
        });
        for (int t = 0; t < 120; t++) emptySession.Advance(1.0);
        Assert.Greater(emptySession.WalkGraph.StationArea, 0);
        Assert.AreEqual(0, emptySession.Statistics.Population);
        Assert.AreEqual("A", emptySession.Statistics.CrowdLos, "empty station must read LOS A");

        (int PeakEscQueue, int PeakPop, string WorstLos, int Exited) RunCapacity(int upEscalators) {
            var doc = ControlledCapacityStation(upEscalators: upEscalators, alightPerTrain: 540, exitInRate: 900);
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = doc, Day = AlwaysOpenWorkdayDay(1.0), Seed = 99,
                StartSimTime = 8 * 3600, StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
            });
            int peakQ = 0, peakPop = 0;
            string worst = "A";
            for (int t = 0; t < 900; t++) {
                session.Advance(1.0);
                var st = session.Statistics;
                if (st.EscalatorQueue > peakQ) peakQ = st.EscalatorQueue;
                if (st.Population > peakPop) peakPop = st.Population;
                if (StationLos.IndexOf(st.CrowdLos) > StationLos.IndexOf(worst)) worst = st.CrowdLos;
            }
            return (peakQ, peakPop, worst, session.Services.Exited);
        }

        var broken = RunCapacity(1);
        var fixed3 = RunCapacity(3);

        Assert.Less(fixed3.PeakEscQueue * 2, broken.PeakEscQueue,
            $"3 escalators must halve peak escalator queue (broken={broken.PeakEscQueue} vs fixed={fixed3.PeakEscQueue})");
        Assert.Less(fixed3.PeakPop, broken.PeakPop,
            $"3 escalators must hold lower peak population (broken={broken.PeakPop} vs fixed={fixed3.PeakPop})");
        Assert.Greater(fixed3.Exited, broken.Exited,
            $"3 escalators must clear more exiting passengers (broken={broken.Exited} vs fixed={fixed3.Exited})");
        Assert.GreaterOrEqual(StationLos.IndexOf(broken.WorstLos), StationLos.IndexOf(fixed3.WorstLos),
            $"3 escalators must not have worse LOS than 1 escalator (broken={broken.WorstLos} vs fixed={fixed3.WorstLos})");
    }

    [Test]
    public void BoardingOnlyShortConsistSaturatesDoorsAndCountsLeftBehind() {
        var doc = ControlledCapacityStation(upEscalators: 3, cars: 2, alightPerTrain: 0, exitInRate: 6000);
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc, Day = AlwaysOpenWorkdayDay(1.2), Seed = 99,
            StartSimTime = 8 * 3600, StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
        });
        for (int t = 0; t < 900; t++) session.Advance(1.0);
        Assert.AreEqual(0, session.Services.Alighted, "AlightPerTrain = 0 produces zero alightings");
        Assert.Greater(session.Services.Boarded, 0, "boarding demand boards the 2-car consist");
        Assert.Greater(session.Services.LeftBehind, 0, "saturated 2-car boarding doors count passengers left behind");
    }

    // --------------------------------------------------- 4. Diagonal walk graph (Builder AND Workspace)

    [Test]
    public void DiagonalWalkGraphMatchesPhysicalCostsAndBlockingRulesInBuilderAndWorkspace() {
        var buildBoth = new Func<StationSessionDocument, StationWalkGraphOptions, StationWalkGraph>[] {
            (d, o) => StationWalkGraphBuilder.Build(d, o),
            (d, o) => StationWalkGraphWorkspace.Build(d, o).Graph,
        };
        var optsNoGround = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = false };
        var optsZones = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true };

        StationSessionDocument SquareDoc() {
            var d = new StationSessionDocument { StationId = "diag-2x2" };
            AddPlate(d, 0, 1, 0, 1, 4, zone: 2, speed: 1.0);
            return d;
        }

        foreach (var build in buildBoth) {
            // 1. 2x2 open square: all 4 diagonals with Sqrt(2)/(WalkSpeed*1.0), 1-step A* path.
            var gSq = build(SquareDoc(), optsNoGround);
            double expectedDiag = Math.Sqrt(2.0) / StationWalkGraphBuilder.WalkSpeed;
            foreach (var (x, y, nx, ny) in new[] { (0, 0, 1, 1), (1, 1, 0, 0), (1, 0, 0, 1), (0, 1, 1, 0) }) {
                Assert.GreaterOrEqual(EdgeIndex(gSq, x, y, 4, nx, ny, 4), 0, $"diagonal ({x},{y})->({nx},{ny}) missing");
                Assert.AreEqual(expectedDiag, EdgeCost(gSq, x, y, 4, nx, ny, 4), 1e-6);
            }
            var shortRoute = new StationRoutePlanner(gSq).Search("0,0,4", "1,1,4", StationRouteNeeds.Walking);
            Assert.IsTrue(shortRoute.Found);
            Assert.AreEqual(2, shortRoute.Nodes.Length, "2x2 corner-to-corner is a single diagonal move");

            // 2. 6x4 plate shortest path: 5 moves (6 nodes) instead of 8 cardinal moves.
            var plateDoc = new StationSessionDocument { StationId = "diag-6x4" };
            AddPlate(plateDoc, 0, 5, 0, 3, 4, zone: 2, speed: 1.0);
            var gPlate = build(plateDoc, optsNoGround);
            var plateRoute = new StationRoutePlanner(gPlate).Search("0,0,4", "5,3,4", StationRouteNeeds.Walking);
            Assert.IsTrue(plateRoute.Found);
            Assert.AreEqual(6, plateRoute.Nodes.Length, "6x4 diagonal route takes 5 moves (6 nodes)");

            // 3. Mixed finishes: (1.0 + 0.9) / 2 = 0.95 diagonal cost.
            var mixedDoc = SquareDoc();
            for (int i = 0; i < mixedDoc.Cells.Count; i++) {
                var c = mixedDoc.Cells[i];
                if (c.X == 1 && c.Y == 1) { c.Speed = 0.9; mixedDoc.Cells[i] = c; }
            }
            var gMixed = build(mixedDoc, optsNoGround);
            Assert.AreEqual(Math.Sqrt(2.0) / (StationWalkGraphBuilder.WalkSpeed * 0.95),
                EdgeCost(gMixed, 0, 0, 4, 1, 1, 4), 1e-6, "mixed finish averages 1.0 and 0.9 to 0.95");

            // 4. Missing cell, void, z+1 wall, unequal-z blocking on either corner flank.
            foreach (var (sx, sy) in new[] { (1, 0), (0, 1) }) {
                StationSessionDocument WithoutSide() {
                    var d = new StationSessionDocument { StationId = "diag-block" };
                    foreach (var c in SquareDoc().Cells) if (c.X != sx || c.Y != sy) d.Cells.Add(c);
                    return d;
                }
                // Missing cell
                var gMissing = build(WithoutSide(), optsNoGround);
                Assert.AreEqual(-1, EdgeIndex(gMissing, 0, 0, 4, 1, 1, 4));
                Assert.AreEqual(-1, EdgeIndex(gMissing, 1, 1, 4, 0, 0, 4));
                // Void cell
                var dVoid = WithoutSide();
                dVoid.Cells.Add(Cell(sx, sy, 4, zone: 2, solid: false, speed: 0));
                var gVoid = build(dVoid, optsNoGround);
                Assert.AreEqual(-1, EdgeIndex(gVoid, 0, 0, 4, 1, 1, 4));
                // z+1 wall block above side
                var dWall = SquareDoc();
                dWall.Cells.Add(Cell(sx, sy, 5, zone: 2, solid: true, speed: 1.0));
                var gWall = build(dWall, optsNoGround);
                Assert.AreEqual(-1, EdgeIndex(gWall, 0, 0, 4, 1, 1, 4));
                // Unequal floor height z=3
                var dDrop = WithoutSide();
                dDrop.Cells.Add(Cell(sx, sy, 3, zone: 2, solid: true, speed: 1.0));
                var gDrop = build(dDrop, optsNoGround);
                Assert.AreEqual(-1, EdgeIndex(gDrop, 0, 0, 4, 1, 1, 4));
            }

            // 5. ZoneBarriers=true blocks diagonal corner-cut across fare line even when endpoints share unpaid zone.
            var dCorner = SquareDoc();
            for (int i = 0; i < dCorner.Cells.Count; i++) {
                var c = dCorner.Cells[i];
                if (c.X == 1 && c.Y == 0) { c.Zone = 3; dCorner.Cells[i] = c; }
            }
            Assert.AreEqual(-1, EdgeIndex(build(dCorner, optsZones), 0, 0, 4, 1, 1, 4),
                "ZoneBarriers=true blocks diagonal corner-cut past paid flank");
            Assert.GreaterOrEqual(EdgeIndex(build(dCorner, optsNoGround), 0, 0, 4, 1, 1, 4), 0,
                "ZoneBarriers=false leaves clear floor open");
            for (int i = 0; i < dCorner.Cells.Count; i++) {
                var c = dCorner.Cells[i];
                if (c.X == 1 && c.Y == 1) { c.Zone = 3; dCorner.Cells[i] = c; }
            }
            Assert.AreEqual(-1, EdgeIndex(build(dCorner, optsZones), 0, 0, 4, 1, 1, 4),
                "ZoneBarriers=true blocks ungated diagonal across fare line");

            // 6. Gate cardinal-only approach and non-skimming adjacent diagonal.
            var dGate = new StationSessionDocument { StationId = "diag-gate" };
            AddPlate(dGate, 0, 4, 0, 4, 4, zone: 2, speed: 1.0);
            dGate.Modules.Add(new StationModuleFact {
                Id = "gate", Type = "gate", X = 2, Y = 2, Z = 4, Rot = 0,
                GateDir = 0, GateOpen = true, GateHasLane = true,
            });
            var gGate = build(dGate, optsNoGround);
            Assert.IsTrue(gGate.TryNode(2, 2, 4, out int gateNode));
            var gateOuts = gGate.AdjTo[gateNode];
            Assert.Greater(gateOuts.Length, 0, "gate lane remains reachable");
            for (int e = 0; e < gateOuts.Length; e++) {
                int j = gateOuts[e];
                Assert.IsTrue(gGate.NodeX[j] == gGate.NodeX[gateNode] || gGate.NodeY[j] == gGate.NodeY[gateNode],
                    "gate node only connects cardinally");
            }
            Assert.AreEqual(-1, EdgeIndex(gGate, 1, 1, 4, 2, 2, 4), "cannot enter gate diagonally");
            Assert.AreEqual(-1, EdgeIndex(gGate, 1, 2, 4, 2, 3, 4), "adjacent diagonal cannot skim gate corner");
        }
    }

    // --------------------------------------------------- 5. Gate truth tables & traffic

    [Test]
    public void GateLaneAllowsAndNextGateIndexMatchPolicyTruthTables() {
        var rt = typeof(StationServiceRuntime);
        var allowsMethod = rt.GetMethod("GateLaneAllows", BindingFlags.Static | BindingFlags.NonPublic);
        Assert.IsNotNull(allowsMethod);
        bool Allows(int mode, int lane, int dir) => (bool)allowsMethod.Invoke(null, new object[] { mode, lane, dir });

        // One-way entry (mode = 1)
        Assert.IsTrue(Allows(1, 0, 1));
        Assert.IsFalse(Allows(1, 0, -1));
        Assert.IsTrue(Allows(1, 0, 0));
        Assert.IsTrue(Allows(1, -1, 1), "one-way gate ignores lane");

        // One-way exit (mode = -1)
        Assert.IsTrue(Allows(-1, 0, -1));
        Assert.IsFalse(Allows(-1, 0, 1));
        Assert.IsTrue(Allows(-1, 0, 0));
        Assert.IsTrue(Allows(-1, 1, -1), "one-way exit ignores lane");

        // Two-way (mode = 0)
        Assert.IsTrue(Allows(0, 0, 1));
        Assert.IsTrue(Allows(0, 0, -1));
        Assert.IsTrue(Allows(0, 0, 0));
        Assert.IsTrue(Allows(0, -1, -1));
        Assert.IsFalse(Allows(0, -1, 1));
        Assert.IsTrue(Allows(0, -1, 0));
        Assert.IsTrue(Allows(0, 1, 1));
        Assert.IsFalse(Allows(0, 1, -1));
        Assert.IsTrue(Allows(0, 1, 0));

        // NextGateIndex truth table on a live StationServiceRuntime instance
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = TwoGateForecastDocument(), Day = AlwaysOpenWorkdayDay(), Seed = 1,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });
        var services = session.Services;
        var nextIdxMethod = rt.GetMethod("NextGateIndex", BindingFlags.Instance | BindingFlags.NonPublic);
        var pType = rt.GetNestedType("Passenger", BindingFlags.NonPublic);
        var passengers = (System.Collections.IList)rt.GetField("passengers", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(services);
        var gates = (System.Collections.IList)rt.GetField("gates", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(services);
        var gate = gates[0];
        var gateType = gate.GetType();
        var qList = (List<int>)gateType.GetField("Queue").GetValue(gate);

        int CheckNext(int[] dirs, int mode, int lane) {
            passengers.Clear();
            qList.Clear();
            for (int i = 0; i < dirs.Length; i++) {
                var p = Activator.CreateInstance(pType);
                pType.GetField("Id").SetValue(p, i + 1);
                pType.GetField("GateDir").SetValue(p, dirs[i]);
                passengers.Add(p);
                qList.Add(i + 1);
            }
            gateType.GetField("Mode").SetValue(gate, mode);
            gateType.GetField("Lane").SetValue(gate, lane);
            return (int)nextIdxMethod.Invoke(services, new[] { gate });
        }

        Assert.AreEqual(0, CheckNext(new[] { -1, 1 }, 0, 0), "idle two-way lane serves first arrival");
        Assert.AreEqual(-1, CheckNext(new[] { 1 }, 0, -1), "committed exit holds back entrant");
        Assert.AreEqual(1, CheckNext(new[] { 1, -1 }, 0, -1), "committed exit lets later exiter through");
        Assert.AreEqual(0, CheckNext(new[] { 1 }, 0, 0), "released lane accepts entrant");
        Assert.AreEqual(1, CheckNext(new[] { 1, -1 }, -1, 0), "exit-only gate skips entrant to serve exiter");
        Assert.AreEqual(-1, CheckNext(new[] { 1 }, -1, 0), "exit-only gate blocks lone entrant");
        Assert.AreEqual(1, CheckNext(new[] { -1, 1 }, 1, 0), "entry-only gate skips exiter to serve entrant");
    }

    [Test]
    public void OneWayAndTwoWayGatesPassStrandAndHoldCommittedLaneUntilClear() {
        StationSimulationSession RunFlat(int gateDir, double exitInRate, int alightPerTrain, int ticks) {
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = FlatGateCorridorDocument(gateDir, exitInRate, alightPerTrain),
                Day = AlwaysOpenWorkdayDay(1.2), Seed = 3, StartSimTime = 8 * 3600, StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
                Services = new StationServiceOptions { RoutingMode = StationRoutingMode.Legacy },
            });
            for (int t = 0; t < ticks; t++) session.Advance(1.0);
            return session;
        }

        // Exit-only gate (-1): strands entry demand (0 boarded, stuck > 0), lets alighting exit.
        var outStranded = RunFlat(-1, 6000, 0, 200);
        Assert.AreEqual(0, outStranded.Services.Boarded, "exit-only gate must not allow boarding");
        Assert.Greater(outStranded.Services.Stuck, 0, "entrants stranded at exit-only gate");
        var outAlight = RunFlat(-1, 0, 120, 200);
        Assert.Greater(outAlight.Services.Exited, 0, "alighting passengers exit cleanly through exit-only gate");

        // Entry-only gate (+1): boards street demand, traps alighting passengers.
        var inBoard = RunFlat(1, 6000, 0, 200);
        Assert.Greater(inBoard.Services.Boarded, 0, "street demand boards through entry-only gate");
        var inTrapped = RunFlat(1, 0, 120, 200);
        Assert.AreEqual(0, inTrapped.Services.Exited, "entry-only gate must not let alighters exit");
        Assert.Greater(inTrapped.Services.Stuck, 0, "alighting passengers stranded at entry-only gate");

        // Two-way gate (0): passes both directions.
        var bothIn = RunFlat(0, 6000, 0, 200);
        Assert.Greater(bothIn.Services.Boarded, 0, "two-way gate boards street demand");
        var bothOut = RunFlat(0, 0, 120, 200);
        Assert.Greater(bothOut.Services.Exited, 0, "two-way gate exits alighting demand");

        // Two-way committed-lane hold-until-clear then flip.
        var quietDoc = FlatGateCorridorDocument(0, exitInRate: 0, alightPerTrain: 0);
        quietDoc.Lines.Clear();
        var quiet = new StationSimulationSession(new StationSessionSetup {
            Document = quietDoc, Day = AlwaysOpenWorkdayDay(), Seed = 5,
            StartSimTime = 8 * 3600, StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });
        var rt = typeof(StationServiceRuntime);
        var services = quiet.Services;
        var g = quiet.WalkGraph;
        var pType = rt.GetNestedType("Passenger", BindingFlags.NonPublic);
        var phaseType = rt.GetNestedType("Phase", BindingFlags.NonPublic);
        var passengers = (System.Collections.IList)rt.GetField("passengers", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(services);
        var gates = (System.Collections.IList)rt.GetField("gates", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(services);
        var gate = gates[0];
        var gateType = gate.GetType();
        var queue = (List<int>)gateType.GetField("Queue").GetValue(gate);
        int gateSrv = (int)gateType.GetField("Server").GetValue(gate);
        int gateNode = (int)gateType.GetField("Node").GetValue(gate);
        Assert.IsTrue(g.TryNode(4, 0, 0, out int westNode));
        Assert.IsTrue(g.TryNode(6, 0, 0, out int eastNode));

        object MakeQueued(int id, int dir, int[] path) {
            var p = Activator.CreateInstance(pType);
            pType.GetField("Id").SetValue(p, id);
            pType.GetField("X").SetValue(p, dir < 0 ? g.NodeX[gateNode] + 0.55 : g.NodeX[gateNode] - 0.55);
            pType.GetField("Y").SetValue(p, g.NodeY[gateNode]);
            pType.GetField("Z").SetValue(p, g.NodeZ[gateNode]);
            pType.GetField("StandX").SetValue(p, dir < 0 ? g.NodeX[gateNode] + 0.55 : g.NodeX[gateNode] - 0.55);
            pType.GetField("StandY").SetValue(p, g.NodeY[gateNode]);
            pType.GetField("Phase").SetValue(p, Enum.Parse(phaseType, "Queuing"));
            pType.GetField("Server").SetValue(p, gateSrv);
            pType.GetField("ServerId").SetValue(p, "gate:g1");
            pType.GetField("GateDir").SetValue(p, dir);
            pType.GetField("GatePatienceAt").SetValue(p, double.PositiveInfinity);
            pType.GetField("Path").SetValue(p, path);
            pType.GetField("PathIndex").SetValue(p, 0);
            pType.GetField("RouteGraphEpoch").SetValue(p, services.GraphEpoch);
            passengers.Add(p);
            queue.Add(id);
            return p;
        }

        MakeQueued(1, -1, new[] { eastNode, gateNode, westNode });
        MakeQueued(2, 1, new[] { westNode, gateNode, eastNode });
        gateType.GetField("Cooldown").SetValue(gate, 0.0);
        gateType.GetField("Lane").SetValue(gate, 0);

        quiet.Advance(1.0);
        Assert.AreEqual(-1, (int)gateType.GetField("Lane").GetValue(gate), "first arrival (exiting) claims the lane");
        Assert.IsFalse(queue.Contains(1), "exiting passenger admitted");
        Assert.IsTrue(queue.Contains(2), "entering passenger waits while lane is committed to exit");

        for (int t = 0; t < 8 && queue.Contains(2); t++) quiet.Advance(1.0);
        Assert.IsFalse(queue.Contains(2), "entering passenger passes after lane flips");
        Assert.AreEqual(1, (int)gateType.GetField("Lane").GetValue(gate), "two-way gate flipped lane to entry");
    }

    [Test]
    public void GateTrafficReservationsOpposingDrainCapsHorizonExclusionsAndGateSearchStart() {
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = TwoGateForecastDocument(), Day = AlwaysOpenWorkdayDay(), Seed = 7,
            StartSimTime = 8 * 3600, StartPlaying = false,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });
        var services = session.Services;
        var g = session.WalkGraph;
        var rt = typeof(StationServiceRuntime);
        var pType = rt.GetNestedType("Passenger", BindingFlags.NonPublic);
        var phaseType = rt.GetNestedType("Phase", BindingFlags.NonPublic);
        var passengers = (System.Collections.IList)rt.GetField("passengers", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(services);
        var gates = (System.Collections.IList)rt.GetField("gates", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(services);
        var planner = (StationRoutePlanner)rt.GetField("planner", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(services);

        var refresh = rt.GetMethod("RefreshGateTraffic", BindingFlags.Instance | BindingFlags.NonPublic);
        var reserve = rt.GetMethod("ReserveGate", BindingFlags.Instance | BindingFlags.NonPublic);
        var release = rt.GetMethod("ReleaseGateReservation", BindingFlags.Instance | BindingFlags.NonPublic);
        var registerQ = rt.GetMethod("RegisterGateQueue", BindingFlags.Instance | BindingFlags.NonPublic);
        var gateWaitMethod = rt.GetMethod("GateWait", BindingFlags.Instance | BindingFlags.NonPublic);
        var gateSearchStart = rt.GetMethod("GateSearchStart", BindingFlags.Instance | BindingFlags.NonPublic);
        var astarMethod = typeof(StationRoutePlanner).GetMethod("Astar", BindingFlags.Instance | BindingFlags.NonPublic);

        var gateA = gates[0];
        var gateB = gates[1];
        var gateType = gateA.GetType();
        int gateASrv = (int)gateType.GetField("Server").GetValue(gateA);
        int gateANode = (int)gateType.GetField("Node").GetValue(gateA);
        int gateBSrv = (int)gateType.GetField("Server").GetValue(gateB);
        var gateAQueue = (List<int>)gateType.GetField("Queue").GetValue(gateA);
        var gateAQDir = (int[])gateType.GetField("QueuedByDirection").GetValue(gateA);
        double GateWait(int srv, int dir) => (double)gateWaitMethod.Invoke(services, new object[] { srv, dir });
        void ResetAll() {
            passengers.Clear();
            gateAQueue.Clear();
            Array.Clear(gateAQDir, 0, 3);
            gateType.GetField("Mode").SetValue(gateA, 0);
            gateType.GetField("Lane").SetValue(gateA, 0);
            gateType.GetField("Rate").SetValue(gateA, StationWalkGraphBuilder.GateRate);
            gateType.GetField("Cooldown").SetValue(gateA, 0.0);
            refresh.Invoke(services, null);
        }

        int nextId = 1;
        object MakeWalker(string fromKey, string toKey, bool chosen = true) {
            Assert.IsTrue(g.TryNode(fromKey, out int n));
            Assert.IsTrue(g.TryNode(toKey, out int dest));
            var path = (int[])astarMethod.Invoke(planner, new object[] { n, dest, StationRouteNeeds.Walking, false, -1, false });
            Assert.IsNotNull(path);
            var p = Activator.CreateInstance(pType);
            pType.GetField("Id").SetValue(p, nextId++);
            pType.GetField("X").SetValue(p, g.NodeX[n]);
            pType.GetField("Y").SetValue(p, g.NodeY[n]);
            pType.GetField("Z").SetValue(p, g.NodeZ[n]);
            pType.GetField("Phase").SetValue(p, Enum.Parse(phaseType, "Walking"));
            pType.GetField("Path").SetValue(p, path);
            pType.GetField("PathIndex").SetValue(p, 0);
            pType.GetField("GateChosen").SetValue(p, chosen);
            pType.GetField("GateServer").SetValue(p, -1);
            pType.GetField("Needs").SetValue(p, StationRouteNeeds.Walking);
            passengers.Add(p);
            return p;
        }

        // 1. Approaching reservation, idempotent re-reserve, join queue, leave/cleanup.
        ResetAll();
        var w1 = MakeWalker("3,1,-4", "9,1,-4", chosen: true);
        refresh.Invoke(services, null);
        Assert.AreEqual(0, gateAQueue.Count);
        Assert.AreEqual(1.0 / StationWalkGraphBuilder.GateRate, GateWait(gateASrv, 1), 1e-8,
            "committed approaching passenger reserves lane before queuing");
        reserve.Invoke(services, new[] { w1 });
        Assert.AreEqual(1.0 / StationWalkGraphBuilder.GateRate, GateWait(gateASrv, 1), 1e-8,
            "idempotent re-reserve must not double-count");
        pType.GetField("GateDir").SetValue(w1, 1);
        pType.GetField("Phase").SetValue(w1, Enum.Parse(phaseType, "Queuing"));
        registerQ.Invoke(services, new[] { w1, gateA });
        Assert.AreEqual(1.0 / StationWalkGraphBuilder.GateRate, GateWait(gateASrv, 1), 1e-8,
            "joining queue transfers reservation without double-counting");
        gateAQueue.Clear();
        refresh.Invoke(services, null);
        Assert.AreEqual(0.0, GateWait(gateASrv, 1), 1e-12, "leaving clears wait");

        // 2. Committed approaching wave steers next route to alternate gate B.
        ResetAll();
        for (int i = 0; i < 12; i++) MakeWalker("3,1,-4", "9,1,-4", chosen: true);
        refresh.Invoke(services, null);
        Assert.IsTrue(g.TryNode("3,1,-4", out int startN));
        Assert.IsTrue(g.TryNode("9,1,-4", out int goalN));
        var steered = (int[])astarMethod.Invoke(planner, new object[] { startN, goalN, StationRouteNeeds.Walking, false, -1, false });
        int chosenGate = -1;
        for (int i = 0; i < steered.Length; i++) {
            if (g.ServerForNode.TryGetValue(steered[i], out int srv) && g.Servers[srv].Kind == "gate") { chosenGate = srv; break; }
        }
        Assert.AreEqual(gateBSrv, chosenGate, "12 approaching bodies on gate A must steer next route to gate B");

        // 3. Opposing-direction replenishment and idle-lane forecast.
        ResetAll();
        for (int i = 0; i < 4; i++) MakeWalker("9,1,-4", "3,1,-4", chosen: true);
        for (int i = 0; i < 3; i++) {
            var q = Activator.CreateInstance(pType);
            int id = nextId++;
            pType.GetField("Id").SetValue(q, id);
            pType.GetField("Phase").SetValue(q, Enum.Parse(phaseType, "Queuing"));
            pType.GetField("Server").SetValue(q, gateASrv);
            pType.GetField("GateDir").SetValue(q, -1);
            passengers.Add(q);
            gateAQueue.Add(id);
        }
        gateType.GetField("Lane").SetValue(gateA, -1);
        refresh.Invoke(services, null);
        double expectedOpp = 7.0 / (StationWalkGraphBuilder.GateRate - 4.0 / 12.0);
        Assert.AreEqual(expectedOpp, GateWait(gateASrv, 1), 1e-8, "opposing forecast accounts for replenishing wave");
        Assert.Greater(GateWait(gateASrv, 1), GateWait(gateASrv, -1) * 4.0, "opposing direction pays far higher wait");
        gateType.GetField("Lane").SetValue(gateA, 0);
        Assert.AreEqual(expectedOpp, GateWait(gateASrv, 1), 1e-8, "imminent opposing wave remains visible on idle lane");

        // 4. Saturated opposing wave uses rate * 0.1 floor (never divides by zero / negative).
        ResetAll();
        gateType.GetField("Lane").SetValue(gateA, -1);
        int arrivals = (int)Math.Ceiling(StationWalkGraphBuilder.GateRate * 12.0) + 4;
        for (int i = 0; i < arrivals; i++) MakeWalker("9,1,-4", "3,1,-4", chosen: true);
        refresh.Invoke(services, null);
        double drainFloor = StationWalkGraphBuilder.GateRate * 0.1;
        double waitSat = GateWait(gateASrv, 1);
        Assert.IsFalse(double.IsNaN(waitSat) || double.IsInfinity(waitSat));
        Assert.AreEqual(arrivals / drainFloor, waitSat, 1e-8, "saturated opposing wave clamps drain to rate * 0.1");

        // 5. Stopped lane (rate <= 0 -> 600), cooldown pricing, and 600 s cap.
        ResetAll();
        gateType.GetField("Rate").SetValue(gateA, 0.0);
        Assert.AreEqual(600.0, GateWait(gateASrv, 1), 1e-12, "rate <= 0 returns 600 s cap");
        gateType.GetField("Rate").SetValue(gateA, 1.0);
        gateType.GetField("Cooldown").SetValue(gateA, 5.0);
        Assert.AreEqual(5.0, GateWait(gateASrv, 1), 1e-12, "cooldown adds active service delay");
        gateType.GetField("Cooldown").SetValue(gateA, 1000.0);
        Assert.AreEqual(600.0, GateWait(gateASrv, 1), 1e-12, "wait is capped at 600 s");

        // 6. Neutral direction (0) and one-way gate price total of all directions.
        ResetAll();
        void AddQueued(int dir, int n) {
            for (int i = 0; i < n; i++) {
                var q = Activator.CreateInstance(pType);
                int id = nextId++;
                pType.GetField("Id").SetValue(q, id);
                pType.GetField("Phase").SetValue(q, Enum.Parse(phaseType, "Queuing"));
                pType.GetField("GateDir").SetValue(q, dir);
                passengers.Add(q);
                gateAQueue.Add(id);
            }
        }
        AddQueued(-1, 2); AddQueued(0, 1); AddQueued(1, 3);
        refresh.Invoke(services, null);
        Assert.AreEqual(6.0 / StationWalkGraphBuilder.GateRate, GateWait(gateASrv, 0), 1e-8, "neutral prices all queued");
        gateType.GetField("Mode").SetValue(gateA, 1);
        Assert.AreEqual(6.0 / StationWalkGraphBuilder.GateRate, GateWait(gateASrv, 1), 1e-8, "one-way gate prices whole queue");

        // 7. Forecast horizon, dead/rider/awaiting/already-served exclusion, and GateSearchStart.
        ResetAll();
        var farWalker = MakeWalker("3,1,-4", "9,1,-4", chosen: true);
        pType.GetField("X").SetValue(farWalker, -1000.0);
        pType.GetField("Y").SetValue(farWalker, -1000.0);
        refresh.Invoke(services, null);
        Assert.AreEqual(0.0, GateWait(gateASrv, 1), 1e-12, "walker past forecast horizon takes no reservation");

        ResetAll();
        var deadQ = Activator.CreateInstance(pType);
        pType.GetField("Id").SetValue(deadQ, nextId++);
        pType.GetField("Phase").SetValue(deadQ, Enum.Parse(phaseType, "Dead"));
        pType.GetField("GateDir").SetValue(deadQ, 1);
        passengers.Add(deadQ);
        gateAQueue.Add((int)pType.GetField("Id").GetValue(deadQ));

        var rider = MakeWalker("3,1,-4", "9,1,-4", chosen: true);
        pType.GetField("Phase").SetValue(rider, Enum.Parse(phaseType, "TrainRiding"));
        var awaiting = MakeWalker("3,1,-4", "9,1,-4", chosen: true);
        pType.GetField("AwaitingRoute").SetValue(awaiting, true);
        var alreadyServed = MakeWalker("3,1,-4", "9,1,-4", chosen: true);
        pType.GetField("GateServer").SetValue(alreadyServed, gateASrv);
        refresh.Invoke(services, null);
        Assert.AreEqual(0.0, GateWait(gateASrv, 1), 1e-12, "dead, train-riding, awaiting, and already-served bodies do not reserve");

        // GateSearchStart: body pressed onto gate cell uses approach node instead of gate node.
        ResetAll();
        Assert.IsTrue(g.TryNode("5,1,-4", out int approachNode));
        var pressed = MakeWalker("5,1,-4", "9,1,-4", chosen: false);
        pType.GetField("X").SetValue(pressed, g.NodeX[gateANode] - 0.05);
        pType.GetField("Y").SetValue(pressed, g.NodeY[gateANode]);
        int searchStart = (int)gateSearchStart.Invoke(services, new object[] { pressed, approachNode });
        Assert.AreEqual(approachNode, searchStart, "GateSearchStart keeps approach node when nearest node is the gate cell");
        release.Invoke(services, new[] { pressed });
    }

    // --------------------------------------------------- 6. Legacy crowd-routing (SpreadWalkingRoute)

    [Test]
    public void LegacySpreadWalkingRouteRespectsLookaheadServerBoundaryCapAndSavingsThreshold() {
        StationSessionDocument CorridorDoc(int width, bool withGateAt5 = false) {
            var d = new StationSessionDocument { StationId = "spread-corridor-" + width };
            AddPlate(d, 0, 20, 0, width - 1, 4, zone: 2, speed: 1.0);
            if (withGateAt5) {
                d.Modules.Add(new StationModuleFact {
                    Id = "gate-5", Type = "gate", X = 5, Y = 0, Z = 4, Rot = 3,
                    GateDir = 0, GateOpen = true, GateHasLane = true,
                });
            }
            return d;
        }

        var rt = typeof(StationServiceRuntime);
        var pType = rt.GetNestedType("Passenger", BindingFlags.NonPublic);
        var phaseType = rt.GetNestedType("Phase", BindingFlags.NonPublic);
        var routeType = rt.GetNestedType("ServiceRoute", BindingFlags.NonPublic);
        var priceCrowd = rt.GetMethod("PriceCrowd", BindingFlags.Instance | BindingFlags.NonPublic);
        var spreadMethod = rt.GetMethod("SpreadWalkingRoute", BindingFlags.Instance | BindingFlags.NonPublic);
        var walkReplansField = rt.GetField("walkReplans", BindingFlags.Instance | BindingFlags.NonPublic);

        object MakeWallWalker(StationServiceRuntime services, StationWalkGraph g, int id, int[] wallPath) {
            var p = Activator.CreateInstance(pType);
            var seg = Activator.CreateInstance(routeType);
            routeType.GetField("Segments").SetValue(seg, new[] { wallPath });
            pType.GetField("Id").SetValue(p, id);
            pType.GetField("X").SetValue(p, g.NodeX[wallPath[0]]);
            pType.GetField("Y").SetValue(p, g.NodeY[wallPath[0]]);
            pType.GetField("Z").SetValue(p, g.NodeZ[wallPath[0]]);
            pType.GetField("Phase").SetValue(p, Enum.Parse(phaseType, "Walking"));
            pType.GetField("Route").SetValue(p, seg);
            pType.GetField("Segment").SetValue(p, 0);
            pType.GetField("Path").SetValue(p, wallPath);
            pType.GetField("PathIndex").SetValue(p, 0);
            pType.GetField("Needs").SetValue(p, StationRouteNeeds.Walking);
            return p;
        }

        int[] WallPath(StationWalkGraph g) {
            var arr = new int[21];
            for (int x = 0; x <= 20; x++) {
                Assert.IsTrue(g.TryNode(x, 0, 4, out arr[x]));
            }
            return arr;
        }

        void AddCrowdBodies(System.Collections.IList passengers, double x, double y, double z, int count, int idStart) {
            for (int i = 0; i < count; i++) {
                var b = Activator.CreateInstance(pType);
                pType.GetField("Id").SetValue(b, idStart + i);
                pType.GetField("X").SetValue(b, x);
                pType.GetField("Y").SetValue(b, y);
                pType.GetField("Z").SetValue(b, z);
                pType.GetField("Phase").SetValue(b, Enum.Parse(phaseType, "Walking"));
                passengers.Add(b);
            }
        }

        // 1. Wide corridor: 8 m lookahead spreads around crowded wall and retains tail x = 9..20; walkReplans cap = 4.
        var wideSession = new StationSimulationSession(new StationSessionSetup {
            Document = CorridorDoc(9), Day = AlwaysOpenWorkdayDay(), Seed = 1,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });
        var wg = wideSession.WalkGraph;
        var wServices = wideSession.Services;
        var wPassengers = (System.Collections.IList)rt.GetField("passengers", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(wServices);
        var wall = WallPath(wg);

        // Empty floor: no replan.
        var alone = MakeWallWalker(wServices, wg, 1, (int[])wall.Clone());
        walkReplansField.SetValue(wServices, 0);
        priceCrowd.Invoke(wServices, null);
        spreadMethod.Invoke(wServices, new object[] { alone, wall[0] });
        Assert.AreEqual(0, (int)walkReplansField.GetValue(wServices), "empty floor triggers zero walk replans");

        // Crowd at (4.5, 0.5, 5.0): 8 bodies cover x=2..6 via +/-2 m PriceCrowd kernel.
        AddCrowdBodies(wPassengers, 4.5, 0.5, 5.0, 8, 100);
        priceCrowd.Invoke(wServices, null);
        walkReplansField.SetValue(wServices, 0);

        var walkers = new List<object>();
        for (int i = 0; i < 6; i++) walkers.Add(MakeWallWalker(wServices, wg, 10 + i, (int[])wall.Clone()));
        for (int i = 0; i < walkers.Count; i++) {
            spreadMethod.Invoke(wServices, new object[] { walkers[i], wall[0] });
        }
        Assert.AreEqual(4, (int)walkReplansField.GetValue(wServices), "walkReplans per-tick cap stops at 4");

        // First 4 spread away from y=0 and preserved tail x = 9..20 (last 12 nodes).
        for (int i = 0; i < 4; i++) {
            var newPath = (int[])pType.GetField("Path").GetValue(walkers[i]);
            Assert.IsTrue(newPath.Any(n => wg.NodeY[n] > 0.5), $"walker {i} leaves crowded y=0 wall");
            Assert.AreEqual(wall[20], newPath[newPath.Length - 1], "tail goal preserved");
            for (int tail = 0; tail < 12; tail++) {
                Assert.AreEqual(wall[9 + tail], newPath[newPath.Length - 12 + tail],
                    $"tail beyond 8 m lookahead preserved at offset {tail}");
            }
        }
        // Walkers 4 & 5 deferred by cap keep original wall path.
        for (int i = 4; i < 6; i++) {
            CollectionAssert.AreEqual(wall, (int[])pType.GetField("Path").GetValue(walkers[i]),
                $"walker {i} beyond cap 4 must not replan this tick");
        }

        // 2. Narrow 1-wide corridor: 2 s savings threshold prevents pointless switch.
        var narrowSession = new StationSimulationSession(new StationSessionSetup {
            Document = CorridorDoc(1), Day = AlwaysOpenWorkdayDay(), Seed = 1,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });
        var ng = narrowSession.WalkGraph;
        var nServices = narrowSession.Services;
        var nPassengers = (System.Collections.IList)rt.GetField("passengers", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(nServices);
        var nWall = WallPath(ng);
        AddCrowdBodies(nPassengers, 4.5, 0.5, 5.0, 10, 200);
        priceCrowd.Invoke(nServices, null);
        walkReplansField.SetValue(nServices, 0);
        var nWalker = MakeWallWalker(nServices, ng, 1, (int[])nWall.Clone());
        spreadMethod.Invoke(nServices, new object[] { nWalker, nWall[0] });
        CollectionAssert.AreEqual(nWall, (int[])pType.GetField("Path").GetValue(nWalker),
            "narrow corridor with no >= 2 s detour keeps its route");

        // 3. Stop-before-server boundary: gate at x=5 stops lookahead at x=4, so crowd at x=8 is ignored.
        var gateSession = new StationSimulationSession(new StationSessionSetup {
            Document = CorridorDoc(9, withGateAt5: true), Day = AlwaysOpenWorkdayDay(), Seed = 1,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });
        var gg = gateSession.WalkGraph;
        var gServices = gateSession.Services;
        var gPassengers = (System.Collections.IList)rt.GetField("passengers", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(gServices);
        var gWall = WallPath(gg);
        AddCrowdBodies(gPassengers, 8.5, 0.5, 5.0, 10, 300); // +/-2 m covers x=6..10, past gate at x=5
        priceCrowd.Invoke(gServices, null);
        walkReplansField.SetValue(gServices, 0);
        var gWalker = MakeWallWalker(gServices, gg, 1, (int[])gWall.Clone());
        spreadMethod.Invoke(gServices, new object[] { gWalker, gWall[0] });
        Assert.AreEqual(0, (int)walkReplansField.GetValue(gServices),
            "lookahead stops before gate server at x=5 and ignores crowding beyond it");
    }

    // --------------------------------------------------- 7. Wayfinding penalties, ramp z-bounds, dug void & rations

    [Test]
    public void WayfindingLiftPenaltyPressureValveCongestionCapAndPriceCrowd() {
        // LiftPenalty & StairAvoidSeconds & CongestionCost cap
        Assert.AreEqual(0.0, StationRoutePlanner.LiftPenalty(new StationRouteNeeds { StepFree = true }), 1e-12);
        Assert.AreEqual(30.0, StationRoutePlanner.LiftPenalty(new StationRouteNeeds { Luggage = true }), 1e-12);
        Assert.AreEqual(300.0, StationRoutePlanner.LiftPenalty(StationRouteNeeds.Walking), 1e-12);
        Assert.AreEqual(32.0, StationRoutePlanner.StairAvoidSeconds, 1e-12);
        Assert.AreEqual(0.0, StationRoutePlanner.CongestionCost(-1), 1e-12);
        Assert.AreEqual(0.0, StationRoutePlanner.CongestionCost(0), 1e-12);
        Assert.AreEqual(3 * StationRoutePlanner.CongestionSeconds, StationRoutePlanner.CongestionCost(3), 1e-12);
        Assert.AreEqual(StationRoutePlanner.CongestionCap * StationRoutePlanner.CongestionSeconds,
            StationRoutePlanner.CongestionCost(StationRoutePlanner.CongestionCap + 40), 1e-12);

        // Two-storey lift + escalator pressure valve
        var doc = new StationSessionDocument { StationId = "wayfinding-lift-esc" };
        AddPlate(doc, 0, 8, 0, 12, 0, zone: 2);
        AddPlate(doc, 0, 8, 0, 12, 5, zone: 2);
        doc.Modules.Add(new StationModuleFact {
            Id = "lift-1", Type = "lift", X = 1, Y = 1, Z = 0, Rot = 0, Width = 2, Depth = 2,
            HasEndpoints = true, FromX = 1, FromY = 1, FromZ = 0, ToX = 1, ToY = 1, ToZ = 5,
        });
        doc.Modules.Add(new StationModuleFact {
            Id = "esc-1", Type = "escalator", X = 5, Y = 1, Z = 0, Rot = 0, Width = 1,
            HasEndpoints = true, FromX = 5, FromY = 1, FromZ = 0, ToX = 5, ToY = 10, ToZ = 5, Dir = "up",
        });
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc, Day = AlwaysOpenWorkdayDay(), Seed = 1,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });
        var g = session.WalkGraph;
        var escSrv = g.Servers.First(s => s.Kind == "escalator");
        var rt = typeof(StationServiceRuntime);
        var planner = (StationRoutePlanner)rt.GetField("planner", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(session.Services);
        var astarMethod = typeof(StationRoutePlanner).GetMethod("Astar", BindingFlags.Instance | BindingFlags.NonPublic);
        var lastLift = typeof(StationRoutePlanner).GetMethod("LastSearchLiftInto", BindingFlags.Instance | BindingFlags.NonPublic);

        Assert.IsTrue(g.TryNode(0, 0, 0, out int lower));
        Assert.IsTrue(g.TryNode(0, 0, 5, out int upper));

        bool UsesLift(int[] path) {
            for (int i = 1; i < path.Length; i++) {
                if (!string.IsNullOrEmpty((string)lastLift.Invoke(planner, new object[] { path[i] }))) return true;
            }
            return false;
        }

        // 100 s escalator queue: walker stays on escalator, luggage & step-free take lift.
        escSrv.QueueCount = (int)Math.Round(100.0 * escSrv.Rate);
        var walk100 = (int[])astarMethod.Invoke(planner, new object[] { lower, upper, StationRouteNeeds.Walking, false, -1, true });
        Assert.IsNotNull(walk100);
        Assert.IsFalse(UsesLift(walk100), "100 s escalator queue: free walker avoids 300 s lift penalty");

        var lug100 = (int[])astarMethod.Invoke(planner, new object[] { lower, upper, new StationRouteNeeds { Luggage = true }, false, -1, true });
        Assert.IsNotNull(lug100);
        Assert.IsTrue(UsesLift(lug100), "100 s escalator queue: luggage (30 s penalty) takes lift");

        var sf100 = (int[])astarMethod.Invoke(planner, new object[] { lower, upper, new StationRouteNeeds { StepFree = true }, false, -1, true });
        Assert.IsNotNull(sf100);
        Assert.IsTrue(UsesLift(sf100), "step-free passenger takes lift");

        // 400 s jammed escalator: free walker uses lift as pressure valve!
        escSrv.QueueCount = (int)Math.Round(400.0 * escSrv.Rate);
        var walk400 = (int[])astarMethod.Invoke(planner, new object[] { lower, upper, StationRouteNeeds.Walking, false, -1, true });
        Assert.IsNotNull(walk400);
        Assert.IsTrue(UsesLift(walk400), "400 s jammed escalator: lift acts as pressure valve for free walker");

        // PriceCrowd steers A* to alternate gate on two-gate corridor.
        var gateSession = new StationSimulationSession(new StationSessionSetup {
            Document = TwoGateForecastDocument(), Day = AlwaysOpenWorkdayDay(), Seed = 5,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });
        var gg = gateSession.WalkGraph;
        var gServices = gateSession.Services;
        var gPlanner = (StationRoutePlanner)rt.GetField("planner", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(gServices);
        var gPassengers = (System.Collections.IList)rt.GetField("passengers", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(gServices);
        var priceCrowd = rt.GetMethod("PriceCrowd", BindingFlags.Instance | BindingFlags.NonPublic);
        var congestionAt = rt.GetMethod("CongestionAt", BindingFlags.Instance | BindingFlags.NonPublic);
        var pType = rt.GetNestedType("Passenger", BindingFlags.NonPublic);
        var phaseType = rt.GetNestedType("Phase", BindingFlags.NonPublic);

        Assert.IsTrue(gg.TryNode(6, 1, -4, out int gateANode));
        Assert.IsTrue(gg.TryNode(6, 3, -4, out int gateBNode));
        Assert.IsTrue(gg.TryNode(0, 2, -4, out int fromNode));
        Assert.IsTrue(gg.TryNode(10, 2, -4, out int toNode));
        Assert.IsTrue(gg.TryNode(10, 4, -4, out int farNode));
        int gateASrv = gg.ServerForNode[gateANode];
        int gateBSrv = gg.ServerForNode[gateBNode];

        int GateOnPath(int[] path) {
            for (int i = 0; i < path.Length; i++) {
                if (gg.ServerForNode.TryGetValue(path[i], out int srv) && gg.Servers[srv].Kind == "gate") return srv;
            }
            return -1;
        }

        // Crowd at gate A steers A* to gate B
        for (int i = 0; i < 8; i++) {
            var p = Activator.CreateInstance(pType);
            pType.GetField("Id").SetValue(p, i + 1);
            pType.GetField("X").SetValue(p, 5.5);
            pType.GetField("Y").SetValue(p, 1.5);
            pType.GetField("Z").SetValue(p, -3.0);
            pType.GetField("Phase").SetValue(p, Enum.Parse(phaseType, "Walking"));
            gPassengers.Add(p);
        }
        priceCrowd.Invoke(gServices, null);
        Assert.Greater((double)congestionAt.Invoke(gServices, new object[] { gateANode }), 0.0, "crowd near gate A priced");
        Assert.AreEqual(0.0, (double)congestionAt.Invoke(gServices, new object[] { farNode }), 1e-12, "empty far floor costs 0");
        var pathB = (int[])astarMethod.Invoke(gPlanner, new object[] { fromNode, toNode, StationRouteNeeds.Walking, false, -1, false });
        Assert.AreEqual(gateBSrv, GateOnPath(pathB), "PriceCrowd at gate A steers A* to gate B");

        // Mirror: crowd at gate B steers A* to gate A
        gPassengers.Clear();
        for (int i = 0; i < 8; i++) {
            var p = Activator.CreateInstance(pType);
            pType.GetField("Id").SetValue(p, i + 1);
            pType.GetField("X").SetValue(p, 5.5);
            pType.GetField("Y").SetValue(p, 3.5);
            pType.GetField("Z").SetValue(p, -3.0);
            pType.GetField("Phase").SetValue(p, Enum.Parse(phaseType, "Walking"));
            gPassengers.Add(p);
        }
        priceCrowd.Invoke(gServices, null);
        var pathA = (int[])astarMethod.Invoke(gPlanner, new object[] { fromNode, toNode, StationRouteNeeds.Walking, false, -1, false });
        Assert.AreEqual(gateASrv, GateOnPath(pathA), "PriceCrowd at gate B steers A* to gate A");
    }

    [Test]
    public void RampBalustradeIsZBoundedAndDugVoidUnderHeadHouseIsUnwalkable() {
        // 3 stacked plates (z = 0, -4, -8) with descending escalator (5,8,0)->(5,2,-4).
        var stacked = new StationSessionDocument { StationId = "z-bounded-ramp" };
        foreach (int z in new[] { 0, -4, -8 }) AddPlate(stacked, 0, 10, 0, 12, z, zone: 3);
        stacked.Modules.Add(new StationModuleFact {
            Id = "esc-1", Type = "escalator", X = 5, Y = 2, Z = -4, Rot = 0, Width = 1,
            HasEndpoints = true, FromX = 5, FromY = 8, FromZ = 0, ToX = 5, ToY = 2, ToZ = -4, Dir = "down",
        });

        var noGround = new StationWalkGraphOptions { IncludeGround = false };
        foreach (var g in new[] {
            StationWalkGraphBuilder.Build(stacked, noGround),
            StationWalkGraphWorkspace.Build(stacked, noGround).Graph,
        }) {
            Assert.AreEqual(-1, EdgeIndex(g, 4, 3, -4, 5, 3, -4), "balustrade blocks walk on escalator storey");
            Assert.AreEqual(-1, EdgeIndex(g, 5, 3, -4, 6, 3, -4), "opposite balustrade blocks walk on escalator storey");
            Assert.AreEqual(-1, EdgeIndex(g, 4, 3, -4, 5, 4, -4), "diagonal cannot cross ramp balustrade");
            Assert.GreaterOrEqual(EdgeIndex(g, 4, 3, -8, 5, 3, -8), 0, "storey below ramp remains free");
            Assert.GreaterOrEqual(EdgeIndex(g, 5, 3, -8, 6, 3, -8), 0, "storey below ramp remains free on east side");
            Assert.GreaterOrEqual(EdgeIndex(g, 4, 3, -8, 5, 4, -8), 0, "diagonal walking is free below ramp");
        }

        // Dug void under head-house stays unwalkable while doorway cell remains live.
        var dug = new StationSessionDocument { StationId = "dug-headhouse" };
        dug.Cells.Add(Cell(0, 0, 0, zone: 1, solid: false, speed: 0));
        dug.Modules.Add(new StationModuleFact {
            Id = "exit-1", Type = "exit", X = 0, Y = 0, Z = 0, Rot = 0, Name = "A口",
            HeadHouse = true, ExitBays = 2,
        });
        var withGround = new StationWalkGraphOptions { IncludeGround = true };
        foreach (var g in new[] {
            StationWalkGraphBuilder.Build(dug, withGround),
            StationWalkGraphWorkspace.Build(dug, withGround).Graph,
        }) {
            Assert.AreEqual(1, g.Exits.Count, "head-house doorway still produces a live exit");
            Assert.IsFalse(g.TryNode(0, 0, 0, out _), "dug void cell under head-house must not be walkable");
            Assert.IsTrue(g.TryNode(1, 2, 0, out int doorNode), "head-house doorway cell on generated street exists");
            Assert.AreEqual(doorNode, g.Exits[0].Node, "exit binds to street doorway cell");
        }
    }

    [Test]
    public void GatePatienceRerouteAndApproachingGateReplanRationsHoldPerTick() {
        var rt = typeof(StationServiceRuntime);
        var pType = rt.GetNestedType("Passenger", BindingFlags.NonPublic);
        var phaseType = rt.GetNestedType("Phase", BindingFlags.NonPublic);
        var routeType = rt.GetNestedType("ServiceRoute", BindingFlags.NonPublic);

        // 1. Patience reroute ration: 4 per tick (RerouteReplanPerTick); skipped riders retry next tick.
        var session1 = new StationSimulationSession(new StationSessionSetup {
            Document = TwoGateForecastDocument(), Day = AlwaysOpenWorkdayDay(), Seed = 7,
            StartSimTime = 8 * 3600, StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });
        var g1 = session1.WalkGraph;
        var s1 = session1.Services;
        var pList1 = (System.Collections.IList)rt.GetField("passengers", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(s1);
        var gates1 = (System.Collections.IList)rt.GetField("gates", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(s1);
        var gateA = gates1[0];
        var gateB = gates1[1];
        var gateType = gateA.GetType();
        int gateASrv = (int)gateType.GetField("Server").GetValue(gateA);
        int gateBSrv = (int)gateType.GetField("Server").GetValue(gateB);
        var gateAQueue = (List<int>)gateType.GetField("Queue").GetValue(gateA);
        var syncQueue = rt.GetMethod("SyncServerQueue", BindingFlags.Instance | BindingFlags.NonPublic);
        var planner1 = (StationRoutePlanner)rt.GetField("planner", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(s1);
        var astarMethod = typeof(StationRoutePlanner).GetMethod("Astar", BindingFlags.Instance | BindingFlags.NonPublic);

        Assert.IsTrue(g1.TryNode(5, 1, -4, out int approachA));
        Assert.IsTrue(g1.TryNode(6, 1, -4, out int gateANode));
        Assert.IsTrue(g1.TryNode(10, 2, -4, out int goalNode));
        var pathViaA = (int[])astarMethod.Invoke(planner1, new object[] { approachA, goalNode, StationRouteNeeds.Walking, false, -1, false });

        // Stack 60 patient waiting riders ahead at gate A so gate B is much faster.
        for (int i = 0; i < 60; i++) {
            var q = Activator.CreateInstance(pType);
            int id = i + 1;
            pType.GetField("Id").SetValue(q, id);
            pType.GetField("X").SetValue(q, 5.5);
            pType.GetField("Y").SetValue(q, 1.5);
            pType.GetField("Z").SetValue(q, -3.0);
            pType.GetField("StandX").SetValue(q, 5.5);
            pType.GetField("StandY").SetValue(q, 1.5);
            pType.GetField("Phase").SetValue(q, Enum.Parse(phaseType, "Queuing"));
            pType.GetField("Server").SetValue(q, gateASrv);
            pType.GetField("ServerId").SetValue(q, "gate:gate-a");
            pType.GetField("GateDir").SetValue(q, 1);
            pType.GetField("GatePatienceAt").SetValue(q, double.PositiveInfinity);
            pType.GetField("Path").SetValue(q, pathViaA);
            pType.GetField("PathIndex").SetValue(q, 0);
            pType.GetField("RouteGraphEpoch").SetValue(q, s1.GraphEpoch);
            pList1.Add(q);
            gateAQueue.Add(id);
        }
        // Add 6 impatient riders at the back of gate A's queue.
        var six = new List<object>();
        for (int i = 0; i < 6; i++) {
            var p = Activator.CreateInstance(pType);
            int id = 100 + i;
            var seg = Activator.CreateInstance(routeType);
            routeType.GetField("Segments").SetValue(seg, new[] { (int[])pathViaA.Clone() });
            pType.GetField("Id").SetValue(p, id);
            pType.GetField("X").SetValue(p, 5.5);
            pType.GetField("Y").SetValue(p, 1.5);
            pType.GetField("Z").SetValue(p, -3.0);
            pType.GetField("StandX").SetValue(p, 5.5);
            pType.GetField("StandY").SetValue(p, 1.5);
            pType.GetField("Phase").SetValue(p, Enum.Parse(phaseType, "Queuing"));
            pType.GetField("Server").SetValue(p, gateASrv);
            pType.GetField("ServerId").SetValue(p, "gate:gate-a");
            pType.GetField("GateDir").SetValue(p, 1);
            pType.GetField("GatePatienceAt").SetValue(p, 8 * 3600 - 1.0);
            pType.GetField("Route").SetValue(p, seg);
            pType.GetField("Segment").SetValue(p, 0);
            pType.GetField("Path").SetValue(p, ((int[][])routeType.GetField("Segments").GetValue(seg))[0]);
            pType.GetField("PathIndex").SetValue(p, 0);
            pType.GetField("DestExit").SetValue(p, goalNode);
            pType.GetField("Needs").SetValue(p, StationRouteNeeds.Walking);
            pType.GetField("RouteGraphEpoch").SetValue(p, s1.GraphEpoch);
            pList1.Add(p);
            gateAQueue.Add(id);
            six.Add(p);
        }
        syncQueue.Invoke(s1, new object[] { gateASrv, gateAQueue.Count });

        session1.Advance(1.0);
        var moved = six.Where(p => (int)pType.GetField("Server").GetValue(p) == -1).ToList();
        var stayed = six.Where(p => gateAQueue.Contains((int)pType.GetField("Id").GetValue(p))).ToList();
        Assert.AreEqual(4, moved.Count, "exactly RerouteReplanPerTick=4 impatient riders reroute on tick 1");
        Assert.AreEqual(2, stayed.Count, "remaining 2 stay in gate A queue on tick 1");
        foreach (var m in moved) {
            var newPath = (int[])pType.GetField("Path").GetValue(m);
            bool usesB = newPath.Any(n => g1.ServerForNode.TryGetValue(n, out int srv) && srv == gateBSrv);
            Assert.IsTrue(usesB, "rerouted rider switched to alternate gate B");
        }

        // Tick 2: the 2 skipped riders retry and reroute to gate B.
        session1.Advance(1.0);
        Assert.IsTrue(stayed.All(p => (int)pType.GetField("Server").GetValue(p) == -1),
            "skipped impatient riders retry and leave gate A on the next tick");

        // 2. Approaching gate replan ration: 8 per tick (GateReplanPerTick); deferred riders hold before gate.
        var session2 = new StationSimulationSession(new StationSessionSetup {
            Document = TwoGateForecastDocument(), Day = AlwaysOpenWorkdayDay(), Seed = 11,
            StartSimTime = 8 * 3600, StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });
        var g2 = session2.WalkGraph;
        var s2 = session2.Services;
        var pList2 = (System.Collections.IList)rt.GetField("passengers", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(s2);
        var planner2 = (StationRoutePlanner)rt.GetField("planner", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(s2);
        Assert.IsTrue(g2.TryNode(5, 1, -4, out int app2));
        Assert.IsTrue(g2.TryNode(10, 2, -4, out int goal2));
        var appPath = (int[])astarMethod.Invoke(planner2, new object[] { app2, goal2, StationRouteNeeds.Walking, false, -1, false });

        var wave = new List<object>();
        for (int i = 0; i < 11; i++) {
            var p = Activator.CreateInstance(pType);
            var seg = Activator.CreateInstance(routeType);
            var clonePath = (int[])appPath.Clone();
            routeType.GetField("Segments").SetValue(seg, new[] { clonePath });
            pType.GetField("Id").SetValue(p, i + 1);
            pType.GetField("X").SetValue(p, g2.NodeX[app2]);
            pType.GetField("Y").SetValue(p, g2.NodeY[app2]);
            pType.GetField("Z").SetValue(p, g2.NodeZ[app2]);
            pType.GetField("Phase").SetValue(p, Enum.Parse(phaseType, "Walking"));
            pType.GetField("Server").SetValue(p, -1);
            pType.GetField("GateServer").SetValue(p, -1);
            pType.GetField("GateChosen").SetValue(p, false);
            pType.GetField("Route").SetValue(p, seg);
            pType.GetField("Segment").SetValue(p, 0);
            pType.GetField("Path").SetValue(p, clonePath);
            pType.GetField("PathIndex").SetValue(p, 0);
            pType.GetField("DestExit").SetValue(p, goal2);
            pType.GetField("Needs").SetValue(p, StationRouteNeeds.Walking);
            pType.GetField("RouteGraphEpoch").SetValue(p, s2.GraphEpoch);
            pList2.Add(p);
            wave.Add(p);
        }

        session2.Advance(1.0);
        int chosenTick1 = wave.Count(p => (bool)pType.GetField("GateChosen").GetValue(p));
        Assert.AreEqual(8, chosenTick1, "exactly GateReplanPerTick=8 approaching riders choose a gate on tick 1");
        Assert.IsTrue(wave.Where(p => !(bool)pType.GetField("GateChosen").GetValue(p))
            .All(p => (int)pType.GetField("Server").GetValue(p) < 0),
            "deferred approaching riders hold outside the gate queue rather than joining a stale gate");

        session2.Advance(1.0);
        Assert.IsTrue(wave.All(p => (bool)pType.GetField("GateChosen").GetValue(p)),
            "deferred approaching riders receive their gate choice on tick 2");
    }

    // --------------------------------------------------- 8. Determinism, Demand, Seek, Load/Restart, BoardApproach, Pause

    [Test]
    public void SameSeedReplaysIdenticallyAndDifferentSeedsDiverge() {
        string Signature(uint seed) {
            var doc = ControlledCapacityStation(upEscalators: 2, alightPerTrain: 200, exitInRate: 1800);
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = doc, Day = AlwaysOpenWorkdayDay(1.0), Seed = seed,
                StartSimTime = 8 * 3600, StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
            });
            for (int t = 0; t < 200; t++) session.Advance(1.0);
            var frames = session.PassengerFrames();
            return $"{session.Services.Spawned}|{session.Services.Boarded}|{session.Services.Exited}|" +
                string.Join(";", frames.Take(20).Select(f => $"{f.SimId}:{f.X:F4},{f.Y:F4},{f.Z:F2},{(int)f.State}"));
        }

        string a1 = Signature(1);
        string a2 = Signature(1);
        string b = Signature(2);
        Assert.AreEqual(a1, a2, "same seed reproduces identical crowd state");
        Assert.AreNotEqual(a1, b, "two different seeds diverge on the same station");
    }

    [Test]
    public void CalendarDayTypeControlsStreetSpawnRateAndClosedServiceWindowSpawnsZero() {
        int RunLineFree(double startSimTime, int ticks) {
            var doc = new StationSessionDocument { StationId = "demand-calendar" };
            AddPlate(doc, 0, 12, 0, 4, 0, zone: 2);
            doc.Modules.Add(new StationModuleFact {
                Id = "exit-a", Type = "exit", X = 1, Y = 2, Z = 0, Name = "A",
                HeadHouse = false, HasExitInRate = true, ExitInRate = 3600,
            });
            doc.Modules.Add(new StationModuleFact {
                Id = "exit-b", Type = "exit", X = 11, Y = 2, Z = 0, Name = "B",
                HeadHouse = false, HasExitInRate = true, ExitInRate = 3600,
            });
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = doc, Day = StationDayData.Default, Seed = 7654321,
                StartSimTime = startSimTime, StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            });
            for (int t = 0; t < ticks; t++) session.Advance(1.0);
            return session.Services.Spawned;
        }

        double morning = 8.5 * 3600;
        var epoch = SimCalendar.Default.Epoch; // 2026-01-01
        int monday = RunLineFree(StationClock.SimTimeAtDate(new SimDate(2026, 1, 5), epoch, morning), 300);
        int saturday = RunLineFree(StationClock.SimTimeAtDate(new SimDate(2026, 1, 10), epoch, morning), 300);
        int sunday = RunLineFree(StationClock.SimTimeAtDate(new SimDate(2026, 1, 11), epoch, morning), 300);
        int holiday = RunLineFree(StationClock.SimTimeAtDate(new SimDate(2026, 1, 1), epoch, morning), 300);
        int closedNight = RunLineFree(StationClock.SimTimeAtDate(new SimDate(2026, 1, 5), epoch, 3 * 3600), 300);

        Assert.Greater(monday, 20, "workday morning peak spawns a real crowd");
        Assert.Less(saturday, monday * 0.7, $"Saturday offday ({saturday}) must spawn well below Monday workday ({monday})");
        Assert.AreEqual(saturday, sunday, "Saturday and Sunday run identical offday curve & RNG stream");
        Assert.AreEqual(saturday, holiday, "2026-01-01 holiday runs the offday curve");
        Assert.AreEqual(0, closedNight, "zero spawns outside the 06:30-23:30 service window");
    }

    [Test]
    public void BackwardSeekToSimTimeRebasesTrainDispatchWithoutResettingCounters() {
        var doc = ControlledCapacityStation(upEscalators: 2, alightPerTrain: 100, exitInRate: 1200);
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc, Day = StationDayData.Default, Seed = 1234567,
            StartSimTime = 7 * 3600, StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
        });
        for (int t = 0; t < 240; t++) session.Advance(1.0);
        Assert.Greater(session.Services.Alighted, 0, "trains ran before seek");

        // Forward seek to Saturday 2026-01-10 08:00 (offday => Offpeak).
        double saturday = StationClock.SimTimeAtDate(new SimDate(2026, 1, 10), SimCalendar.Default.Epoch, 8 * 3600);
        session.SeekToSimTime(saturday);
        Assert.AreEqual(SimDayType.Offday, session.Clock.DayType);
        Assert.AreEqual(SimPeriod.Offpeak, session.Clock.Period);
        // Drain any active consist from before the seek, then confirm fresh dispatch occurs at new date.
        for (int t = 0; t < 60 && session.Snapshot().Trains[0].Phase != TrainPhase.None; t++) session.Advance(1.0);
        session.Advance(1.0);
        Assert.AreNotEqual(TrainPhase.None, session.Snapshot().Trains[0].Phase, "forward seek dispatches on new date");

        // Backward seek to day 0 07:00 must re-base dispatch instead of stalling until 2026-01-10.
        int alightedBefore = session.Services.Alighted;
        int spawnedBefore = session.Services.Spawned;
        for (int t = 0; t < 60 && session.Snapshot().Trains[0].Phase != TrainPhase.None; t++) session.Advance(1.0);
        session.SeekToSimTime(7 * 3600);
        Assert.AreEqual("2026-01-01", session.Clock.Stamp().DateKey);
        Assert.GreaterOrEqual(session.Services.Alighted, alightedBefore, "seek must not erase cumulative counters");
        Assert.GreaterOrEqual(session.Services.Spawned, spawnedBefore);
        session.Advance(1.0);
        Assert.AreEqual(TrainPhase.Approach, session.Snapshot().Trains[0].Phase,
            "backward SeekToSimTime re-bases nextDispatch so trains dispatch immediately instead of stalling");
    }

    [Test]
    public void LoadDocumentResetsEverythingAndPopulatedRestartZerosQueuesWhilePreservingClock() {
        var doc = ControlledCapacityStation(upEscalators: 1, alightPerTrain: 240, exitInRate: 3600);
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc, Day = AlwaysOpenWorkdayDay(1.0), Seed = 1234567,
            StartSimTime = 8 * 3600, StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
        });
        // Run until both crowd, queues, and train service have accumulated.
        for (int t = 0; t < 180 && (session.Services.PassengerCount == 0 || session.Services.QueueTotal == 0); t++) {
            session.Advance(1.0);
        }
        Assert.Greater(session.Services.PassengerCount, 0, "station populated before restart");
        Assert.Greater(session.Services.QueueTotal, 0, "queues populated before restart");

        // 1. Populated Restart zeroes crowd, trains, and all queues while preserving clock and tick.
        double clockBeforeRestart = session.Clock.SimTime;
        long tickBeforeRestart = session.Tick;
        session.Restart();
        Assert.AreEqual(clockBeforeRestart, session.Clock.SimTime, 1e-12, "Restart preserves clock");
        Assert.AreEqual(tickBeforeRestart, session.Tick, "Restart preserves tick");
        Assert.AreEqual(0, session.Services.PassengerCount, "Restart clears crowd");
        Assert.AreEqual(0, session.Services.QueueTotal, "Restart clears all queues");
        Assert.AreEqual(0, session.Services.GateQueueTotal);
        Assert.AreEqual(0, session.Services.EscalatorQueueTotal);
        Assert.AreEqual(0, session.Services.DoorQueueTotal);
        Assert.AreEqual(0, session.Services.LiftQueueTotal);
        Assert.AreEqual(TrainPhase.None, session.Snapshot().Trains[0].Phase, "Restart clears active trains");
        foreach (var srv in session.WalkGraph.Servers) Assert.AreEqual(0, srv.QueueCount, "all graph server queues cleared");

        // 2. Populate again, then direct LoadDocument performs a full reset including tick, clock, seed, and counters.
        for (int t = 0; t < 120; t++) session.Advance(1.0);
        Assert.Greater(session.Services.PassengerCount, 0);
        var doc2 = ControlledCapacityStation(upEscalators: 3, alightPerTrain: 200, exitInRate: 1800);
        session.LoadDocument(doc2, 6 * 3600, 42);
        Assert.AreEqual(0, session.Tick, "LoadDocument resets tick to 0");
        Assert.AreEqual(6 * 3600, session.Clock.SimTime, 1e-12, "LoadDocument resets clock to requested startSimTime");
        Assert.IsFalse(session.Playing, "LoadDocument starts paused");
        Assert.AreEqual(0, session.Services.PassengerCount, "LoadDocument clears crowd");
        Assert.AreEqual(0, session.Services.QueueTotal, "LoadDocument clears queues");
        Assert.AreEqual(0, session.Services.Boarded);
        Assert.AreEqual(0, session.Services.Alighted);
        Assert.AreEqual(0, session.Services.Exited);
        Assert.AreEqual(0, session.Services.LeftBehind);
        Assert.AreEqual(TrainPhase.None, session.Snapshot().Trains[0].Phase);

        // Reseeded LoadDocument replays bit-for-bit against a fresh session with seed 42.
        var fresh = new StationSimulationSession(new StationSessionSetup {
            Document = doc2, Day = AlwaysOpenWorkdayDay(1.0), Seed = 42,
            StartSimTime = 6 * 3600, StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true },
        });
        session.SetPlaying(true);
        for (int t = 0; t < 90; t++) { session.Advance(1.0); fresh.Advance(1.0); }
        var fA = session.PassengerFrames();
        var fB = fresh.PassengerFrames();
        Assert.AreEqual(fB.Length, fA.Length, "reloaded session matches fresh session population");
        for (int i = 0; i < fA.Length; i++) {
            Assert.AreEqual(fB[i].SimId, fA[i].SimId);
            Assert.AreEqual(fB[i].X, fA[i].X, 1e-9);
            Assert.AreEqual(fB[i].Y, fA[i].Y, 1e-9);
        }
    }

    [Test]
    public void BoardApproachOpenDoorGuardBlocksDistantQueuedBoarderUntilWithinRange() {
        var doc = FlatGateCorridorDocument(gateDir: 0, exitInRate: 0, alightPerTrain: 0);
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc, Day = AlwaysOpenWorkdayDay(), Seed = 4,
            StartSimTime = 8 * 3600, StartPlaying = false,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });
        var services = session.Services;
        var g = session.WalkGraph;
        int seeded = services.SeedDoorRiders("2", "track-1", 1);
        Assert.Greater(seeded, 0, "seeded at least one doorway rider");

        var rt = typeof(StationServiceRuntime);
        var doors = (System.Collections.IList)rt.GetField("doors", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(services);
        var passengers = (System.Collections.IList)rt.GetField("passengers", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(services);
        var stepDoors = rt.GetMethod("StepDoors", BindingFlags.Instance | BindingFlags.NonPublic);
        var pType = rt.GetNestedType("Passenger", BindingFlags.NonPublic);

        // Keep only the first doorway's queued rider so we test BoardApproach in isolation.
        var door0 = doors[0];
        var doorType = door0.GetType();
        var q0 = (List<int>)doorType.GetField("Queue").GetValue(door0);
        int door0Node = (int)doorType.GetField("Node").GetValue(door0);
        for (int i = 1; i < doors.Count; i++) ((List<int>)doorType.GetField("Queue").GetValue(doors[i])).Clear();

        int headId = q0[0];
        object head = null;
        foreach (var p in passengers) if ((int)pType.GetField("Id").GetValue(p) == headId) { head = p; break; }
        Assert.IsNotNull(head);

        // Open doorway latch, but stand rider 3.0 m away (> BoardApproach = 1.5 m).
        doorType.GetField("Rate").SetValue(door0, StationServiceCadence.DoorRate);
        doorType.GetField("Cooldown").SetValue(door0, 0.0);
        pType.GetField("X").SetValue(head, g.NodeX[door0Node] + 3.0);
        pType.GetField("Y").SetValue(head, g.NodeY[door0Node]);

        stepDoors.Invoke(services, new object[] { Array.Empty<StationTrainFrame>() });
        Assert.AreEqual(0, services.Boarded, "open door must not board a queued passenger standing beyond BoardApproach (1.5 m)");
        Assert.AreEqual(1, q0.Count, "distant passenger remains at head of door queue");

        // Move passenger within BoardApproach (0.5 m) and re-step open door -> boards immediately.
        pType.GetField("X").SetValue(head, g.NodeX[door0Node] + 0.5);
        pType.GetField("Y").SetValue(head, g.NodeY[door0Node]);
        stepDoors.Invoke(services, new object[] { Array.Empty<StationTrainFrame>() });
        Assert.AreEqual(1, services.Boarded, "passenger inside BoardApproach boards through open door");
        Assert.AreEqual(0, q0.Count, "door queue drained after boarding");
    }

    [Test]
    public void PausedGateWingAndMidApproachTrainHoldPoseAndResumeCleanly() {
        var doc = FlatGateCorridorDocument(gateDir: 0, exitInRate: 0, alightPerTrain: 0);
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc, Day = AlwaysOpenWorkdayDay(), Seed = 7,
            StartSimTime = 8 * 3600, StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });

        // Set up a real gate-wing ModuleMotion host so we verify the presented leaf transforms too.
        var host = new GameObject("sim-pause-gate-wing");
        try {
            var left = new GameObject("left-leaf");
            var right = new GameObject("right-leaf");
            left.transform.SetParent(host.transform, false);
            right.transform.SetParent(host.transform, false);
            left.transform.localPosition = new Vector3(-.025f, 0f, .64f);
            right.transform.localPosition = new Vector3(.325f, 0f, .64f);
            var motion = host.AddComponent<ModuleMotion>();
            motion.kind = ModuleMotion.Kind.GateWings;
            motion.leaves = new[] { left.transform, right.transform };
            motion.leavesClosed = new[] { left.transform.localPosition, right.transform.localPosition };
            motion.leafWidth = .35f;
            motion.leafEdges = new[] { -.2f, .5f };
            motion.leafSigns = new[] { 1f, -1f };

            // Queue 2 gate riders; advance 3.5 real seconds -> 3 whole ticks + 0.5 fractional presentation.
            // At tick 3 the train is mid-Approach (PhaseSeconds = 3 < 6) and the gate has just admitted (Open > 0).
            session.Services.SeedGateRiders("g1", 2);
            session.Advance(1.0); // tick 1: train dispatches (Approach t=1), gate admits rider 1
            session.Advance(1.0); // tick 2: Approach t=2
            session.Advance(1.5); // tick 3: Approach t=3, fraction = 0.5, gate admits rider 2 around t=3..4

            // Ensure gate is visibly mid-open (or sample exact open fraction at current tick).
            var snapBeforePause = session.Snapshot();
            var trainBefore = snapBeforePause.Trains[0];
            Assert.AreEqual(TrainPhase.Approach, trainBefore.Phase, "train is mid-approach before pause");
            Assert.AreEqual(3.0, trainBefore.PhaseSeconds, 1e-9);
            Assert.AreEqual(0.5, session.PresentationFraction, 1e-9);

            Assert.IsTrue(StationTrainPose.TryBerth(doc, doc.Lines[0], true, "track-1", 0.98, out var berth, out _));
            double heldTrainOffset = StationTrainPose.OffsetMetres(trainBefore.Phase,
                trainBefore.PhaseSeconds + session.PresentationFraction, berth);

            // Sample gate wing at a non-zero mid-open fraction (0.6) representing mid-cycle hold.
            float heldGateOpen = (float)Math.Max(0.6, snapBeforePause.Gates[0].Open);
            motion.Apply(0f, heldGateOpen, 1);
            float heldLeftX = left.transform.localPosition.x;
            float heldLeftScaleX = left.transform.localScale.x;
            Assert.Less(heldLeftScaleX, 1f, "gate wing is retracted mid-open before pause");

            // Pause and feed 10 real seconds of frames -> everything holds frozen without banking.
            long heldTick = session.Tick;
            double heldClock = session.Clock.SimTime;
            session.SetPlaying(false);
            Assert.AreEqual(0, session.Advance(10.0), "paused Advance steps zero ticks");
            Assert.AreEqual(heldTick, session.Tick, "paused tick holds");
            Assert.AreEqual(heldClock, session.Clock.SimTime, 1e-12, "paused clock holds");
            Assert.AreEqual(0.5, session.PresentationFraction, 1e-9, "paused presentation fraction holds");
            var snapWhilePaused = session.Snapshot();
            Assert.AreEqual(TrainPhase.Approach, snapWhilePaused.Trains[0].Phase);
            Assert.AreEqual(3.0, snapWhilePaused.Trains[0].PhaseSeconds, 1e-9, "paused train phase clock holds mid-approach");
            Assert.AreEqual(heldTrainOffset,
                StationTrainPose.OffsetMetres(snapWhilePaused.Trains[0].Phase,
                    snapWhilePaused.Trains[0].PhaseSeconds + session.PresentationFraction, berth),
                1e-12, "paused train pose holds mid-approach");
            Assert.AreEqual(snapBeforePause.Gates[0].Open, snapWhilePaused.Gates[0].Open, 1e-12,
                "paused gate frame holds its open state");
            motion.Apply(0f, heldGateOpen, 1);
            Assert.AreEqual(heldLeftX, left.transform.localPosition.x, 1e-6f, "paused gate leaf position holds");
            Assert.AreEqual(heldLeftScaleX, left.transform.localScale.x, 1e-6f, "paused gate leaf scale holds");

            // Resume: 0.5 real seconds finishes the held tick cleanly without spending the paused 10 s.
            session.SetPlaying(true);
            Assert.AreEqual(1, session.Advance(0.5), "resumed 0.5 s completes the held 0.5 s remainder as exactly 1 tick");
            Assert.AreEqual(heldTick + 1, session.Tick);
            Assert.AreEqual(0.0, session.PresentationFraction, 1e-9);
            var snapResumed = session.Snapshot();
            Assert.AreEqual(TrainPhase.Approach, snapResumed.Trains[0].Phase);
            Assert.AreEqual(4.0, snapResumed.Trains[0].PhaseSeconds, 1e-9, "train continues from held approach instant");
            double resumedTrainOffset = StationTrainPose.OffsetMetres(snapResumed.Trains[0].Phase,
                snapResumed.Trains[0].PhaseSeconds, berth);
            Assert.Less(Math.Abs(resumedTrainOffset), Math.Abs(heldTrainOffset),
                "resumed train advances closer to berth from the held position");

            // Next tick moves gate leaf cycle forward cleanly.
            motion.Apply(0f, (float)snapResumed.Gates[0].Open, 1);
            Assert.GreaterOrEqual(left.transform.localScale.x, 0f);
        } finally {
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    // --------------------------------------------------- 10. Track 2: Fare crossing, waiting slots & doorLoads

    [Test]
    public void ReversedGateRotationSameSideRelabelsAndWorkspaceReachabilityMatchFareZones() {
        StationSessionDocument MakeDoc(int gateDir, int gateRot, int westZone = 2, int gateZone = 3, int eastZone = 3) {
            var doc = new StationSessionDocument { StationId = "gate-fare-parity", LevelBase = 0 };
            for (int x = 0; x <= 10; x++) {
                int z = x < 5 ? westZone : x == 5 ? gateZone : eastZone;
                doc.Cells.Add(Cell(x, 0, 0, zone: z, solid: true, speed: 1.0));
            }
            doc.Modules.Add(new StationModuleFact {
                Id = "g1", Type = "gate", X = 5, Y = 0, Z = 0, Rot = gateRot,
                GateDir = gateDir, GateOpen = true, GateHasLane = true,
            });
            return doc;
        }

        var optsOn = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = true };
        var optsOff = new StationWalkGraphOptions { IncludeGround = false, ZoneBarriers = false };

        // Aligned (Rot=3) and Reversed (Rot=1) entry-only gates must both allow unpaid->paid (+x) and block paid->unpaid (-x).
        foreach (int rot in new[] { 3, 1 }) {
            var docIn = MakeDoc(gateDir: 1, gateRot: rot);
            var gFull = StationWalkGraphBuilder.Build(docIn, optsOn);
            var ws = StationWalkGraphBuilder.BuildWorkspace(docIn, optsOn);
            var gWs = ws.Graph;
            foreach (var g in new[] { gFull, gWs }) {
                Assert.IsTrue(g.TryNode(4, 0, 0, out int west));
                Assert.IsTrue(g.TryNode(5, 0, 0, out int gate));
                Assert.IsTrue(g.TryNode(6, 0, 0, out int east));
                Assert.GreaterOrEqual(Array.IndexOf(g.AdjTo[west], gate), 0, "rot=" + rot + " entry allows unpaid->gate");
                Assert.AreEqual(-1, Array.IndexOf(g.AdjTo[gate], west), "rot=" + rot + " entry blocks gate->unpaid");
                Assert.IsTrue(g.CanReach(west, east), "rot=" + rot + " workspace reachability allows unpaid->paid");
                if (ReferenceEquals(g, gWs))
                    Assert.IsFalse(g.CanReach(east, west), "rot=" + rot + " workspace reachability blocks paid->unpaid");

                var planner = new StationRoutePlanner(g);
                Assert.IsTrue(planner.Search(west, east, default).Found, "rot=" + rot + " A* routes unpaid->paid");
                Assert.IsFalse(planner.Search(east, west, default).Found, "rot=" + rot + " A* refuses paid->unpaid");
            }

            // Incremental flip from entry (+1) to exit (-1) must match a fresh rebuild.
            var docOut = MakeDoc(gateDir: -1, gateRot: rot);
            var delta = new StationSessionDelta();
            delta.ChangedModules.Add(docOut.Modules[0]);
            var staged = StationWalkGraphBuilder.StageCellDelta(ws, docOut, delta);
            var gOutFull = StationWalkGraphBuilder.Build(docOut, optsOn);
            Assert.IsTrue(staged.Graph.TryNode(4, 0, 0, out int w2));
            Assert.IsTrue(staged.Graph.TryNode(5, 0, 0, out int g2));
            Assert.IsTrue(staged.Graph.TryNode(6, 0, 0, out int e2));
            Assert.AreEqual(-1, Array.IndexOf(staged.Graph.AdjTo[w2], g2), "rot=" + rot + " incremental exit blocks unpaid->gate");
            Assert.GreaterOrEqual(Array.IndexOf(staged.Graph.AdjTo[g2], w2), 0, "rot=" + rot + " incremental exit allows gate->unpaid");
            Assert.IsFalse(staged.Graph.CanReach(w2, e2), "rot=" + rot + " incremental CanReach blocks unpaid->paid");
            Assert.IsTrue(staged.Graph.CanReach(e2, w2), "rot=" + rot + " incremental CanReach allows paid->unpaid");
            Assert.IsTrue(gOutFull.TryNode(4, 0, 0, out int wf));
            Assert.IsTrue(gOutFull.TryNode(5, 0, 0, out int gf));
            Assert.AreEqual(Array.IndexOf(gOutFull.AdjTo[wf], gf) >= 0, Array.IndexOf(staged.Graph.AdjTo[w2], g2) >= 0);
        }

        // Same-side relabels (outside=1 <-> unpaid=2, paid=3 <-> platform=4) allow both ways even through a one-way gate.
        var sameUnpaid = MakeDoc(gateDir: -1, gateRot: 1, westZone: 1, gateZone: 2, eastZone: 2);
        var gSame = StationWalkGraphBuilder.Build(sameUnpaid, optsOn);
        Assert.IsTrue(gSame.TryNode(4, 0, 0, out int suW));
        Assert.IsTrue(gSame.TryNode(5, 0, 0, out int suG));
        Assert.IsTrue(gSame.TryNode(6, 0, 0, out int suE));
        Assert.IsTrue(new StationRoutePlanner(gSame).Search(suW, suE, default).Found, "outside->unpaid is same-side and unblocked");
        Assert.IsTrue(new StationRoutePlanner(gSame).Search(suE, suW, default).Found, "unpaid->outside is same-side and unblocked");

        // Disabled ZoneBarriers allows both directions along the gate lane regardless of GateDir.
        var gOff = StationWalkGraphBuilder.Build(MakeDoc(gateDir: 1, gateRot: 1), optsOff);
        Assert.IsTrue(gOff.TryNode(4, 0, 0, out int offW));
        Assert.IsTrue(gOff.TryNode(6, 0, 0, out int offE));
        Assert.IsTrue(new StationRoutePlanner(gOff).Search(offE, offW, default).Found, "ZoneBarriers=false allows both ways");
    }

    [Test]
    public void PlatformWaitingSlotsFlankDoorStayBehindPsdAndRecoverOnRemoval() {
        // Wide platform: track at y=-1, edge at y=0 (Side="left" => inward +y), platform floor y=0..6, x=0..40.
        var doc = new StationSessionDocument { StationId = "wait-slots", LevelBase = 0 };
        for (int x = 0; x <= 40; x++) {
            for (int y = 0; y <= 6; y++) {
                doc.Cells.Add(Cell(x, y, 0, zone: 4, solid: true, speed: 1.0));
            }
        }
        doc.Modules.Add(new StationModuleFact {
            Id = "track-1", Type = "track", X = 0, Y = -1, Z = 0, Rot = 0, Width = 40, Depth = 1,
            LineId = "1", Dir = "up",
        });
        doc.Modules.Add(new StationModuleFact {
            Id = "edge-1", Type = "platform-edge", X = 0, Y = 0, Z = 0, Rot = 0, Width = 40,
            LineId = "1", RailId = "track-1", Dir = "up", Side = "left",
        });
        doc.Lines.Add(new StationLineFact {
            Id = "1", Direction = "up", Stock = "B", Cars = 2, ModelScale = 0.98,
            HeadwayPeak = 60, HeadwayOffpeak = 120, HeadwayLate = 240,
            AlightPerTrain = 0, AuthoredAlight = true,
        });

        var session = new StationSimulationSession(new StationSessionSetup {
            Document = doc, Day = AlwaysOpenWorkdayDay(), Seed = 11, StartSimTime = 8 * 3600, StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { Spawn = false, RoutingMode = StationRoutingMode.Legacy },
        });
        Assert.IsTrue(session.Services.TryDoorStates("1", "track-1", out var doorStates));
        Assert.GreaterOrEqual(doorStates.Length, 4);
        var d0 = doorStates[0];
        var waiting = session.Services.PlatformWaitingNodes(d0.Node, hasInward: true, ix: 0, iy: 1);
        Assert.GreaterOrEqual(waiting.Length, 4, "wide platform provides paired waiting slots");
        // First two slots are flanking at depth=1 (y = d0.Y + 1), side = +/-1 (x = d0.X +/- 1), keeping center aisle open.
        for (int i = 0; i < Math.Min(4, waiting.Length); i++) {
            int wn = waiting[i];
            double depth = session.WalkGraph.NodeY[wn] - session.WalkGraph.NodeY[d0.Node];
            double side = Math.Abs(session.WalkGraph.NodeX[wn] - session.WalkGraph.NodeX[d0.Node]);
            Assert.GreaterOrEqual(depth, 1.0 - 1e-6, "waiting slot stays behind PSD row");
            Assert.AreEqual(1.0, side, 1e-6, "paired flanking slot leaves center aisle clear");
        }

        // Seed riders while doors are shut: they hold behind PsdQueueClearDepth (0.9 m) inland of the PSD.
        session.Services.SeedDoorRiders("1", "track-1", 4);
        for (int t = 0; t < 5; t++) session.Advance(1.0); // before train opens doors
        foreach (var frame in session.Services.PassengerFrames()) {
            if (frame.State == StationPassengerState.Queuing) {
                Assert.GreaterOrEqual(frame.Y - (d0.Y + 0.5), 0.9 - 1e-6,
                    "queued rider stays behind PSD safety line while doors are closed");
            }
        }

        // Removing the waiting cell under a queued rider recovers cleanly on incremental edit.
        int removedCellX = (int)Math.Floor(session.WalkGraph.NodeX[waiting[0]]);
        int removedCellY = (int)Math.Floor(session.WalkGraph.NodeY[waiting[0]]);
        var doc2 = new StationSessionDocument { StationId = doc.StationId, LevelBase = doc.LevelBase };
        foreach (var c in doc.Cells) {
            if (c.X == removedCellX && c.Y == removedCellY && c.Z == 0) continue;
            doc2.Cells.Add(c);
        }
        doc2.Modules.AddRange(doc.Modules);
        doc2.Lines.AddRange(doc.Lines);
        var cellDelta = new StationSessionDelta();
        cellDelta.RemovedCells.Add((removedCellX, removedCellY, 0));
        var staged = session.StageCellDelta(doc2.StationId, doc2.LevelBase, AlwaysOpenWorkdayDay(), cellDelta);
        session.CommitDocumentEdit(staged);
        var waitingAfter = session.Services.PlatformWaitingNodes(
            session.WalkGraph.TryNode(d0.X, d0.Y, d0.Z, out int newDoorNode) ? newDoorNode : -1,
            hasInward: true, ix: 0, iy: 1);
        foreach (int wn in waitingAfter) {
            Assert.IsFalse((int)Math.Floor(session.WalkGraph.NodeX[wn]) == removedCellX &&
                           (int)Math.Floor(session.WalkGraph.NodeY[wn]) == removedCellY,
                "removed waiting cell is excluded after incremental edit");
        }
        // Advance through train arrival/dwell: head steps to doorway and boards cleanly.
        for (int t = 0; t < 20; t++) session.Advance(1.0);
        Assert.Greater(session.Services.Boarded, 0, "waiting riders advance to doorway and board after recovery");
    }

    [Test]
    public void ApproachingBoardersSpreadAcrossDoorsViaDoorLoadsInLegacyAndSparseModes() {
        // Long approach corridor so riders are still walking (none queued yet) while spawning a wave.
        var doc = new StationSessionDocument { StationId = "door-loads-spread", LevelBase = 0 };
        for (int x = 0; x <= 44; x++) {
            for (int y = 0; y <= 14; y++) {
                doc.Cells.Add(Cell(x, y, 0, zone: 4, solid: true, speed: 1.0));
            }
        }
        doc.Modules.Add(new StationModuleFact {
            Id = "exit-a", Type = "exit", X = 2, Y = 12, Z = 0, Rot = 0, Name = "A口",
            HeadHouse = false, HasExitInRate = true, ExitInRate = 36000,
        });
        doc.Modules.Add(new StationModuleFact {
            Id = "track-1", Type = "track", X = 4, Y = -1, Z = 0, Rot = 0, Width = 40, Depth = 1,
            LineId = "1", Dir = "up",
        });
        doc.Modules.Add(new StationModuleFact {
            Id = "edge-1", Type = "platform-edge", X = 4, Y = 0, Z = 0, Rot = 0, Width = 40,
            LineId = "1", RailId = "track-1", Dir = "up", Side = "left",
        });
        doc.Lines.Add(new StationLineFact {
            Id = "1", Direction = "up", Stock = "B", Cars = 2, ModelScale = 0.98,
            HeadwayPeak = 600, HeadwayOffpeak = 600, HeadwayLate = 600,
            AlightPerTrain = 0, AuthoredAlight = true,
        });

        var rt = typeof(StationServiceRuntime);
        var pListField = rt.GetField("passengers", BindingFlags.Instance | BindingFlags.NonPublic);
        var loadsField = rt.GetField("doorLoads", BindingFlags.Instance | BindingFlags.NonPublic);
        var pType = rt.GetNestedType("Passenger", BindingFlags.NonPublic);
        var targetDoorField = pType.GetField("TargetDoorId");
        var boardsField = pType.GetField("Boards");
        var phaseField = pType.GetField("Phase");

        foreach (var mode in new[] { StationRoutingMode.Legacy, StationRoutingMode.Sparse }) {
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = doc, Day = AlwaysOpenWorkdayDay(1.5), Seed = 7, StartSimTime = 8 * 3600, StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                Services = new StationServiceOptions { RoutingMode = mode },
            });
            // Run 5 ticks: riders spawn at y=12 (12m from doors at y=0), so they are still walking and NOT yet queued!
            for (int t = 0; t < 5; t++) session.Advance(1.0);
            var pax = (System.Collections.IList)pListField.GetValue(session.Services);
            var loads = (Dictionary<string, int>)loadsField.GetValue(session.Services);
            var distinctDoors = new HashSet<string>(StringComparer.Ordinal);
            int walkingBoarders = 0;
            foreach (var p in pax) {
                if (!(bool)boardsField.GetValue(p)) continue;
                string doorId = (string)targetDoorField.GetValue(p);
                Assert.IsFalse(string.IsNullOrEmpty(doorId), mode + ": approaching boarder must have a committed TargetDoorId");
                distinctDoors.Add(doorId);
                if (phaseField.GetValue(p).ToString() == "Walking") walkingBoarders++;
            }
            Assert.Greater(walkingBoarders, 4, mode + ": expected multiple walking boarders before anyone queues");
            Assert.GreaterOrEqual(distinctDoors.Count, 3,
                mode + ": approaching wave must spread across >= 3 distinct doors before queuing");
            int loadSum = 0;
            foreach (var kv in loads) loadSum += kv.Value;
            Assert.AreEqual(walkingBoarders, loadSum, mode + ": doorLoads matches committed boarders without double-counting");

            // Removing the platform edge clears all door commitments cleanly.
            var docNoEdge = new StationSessionDocument { StationId = doc.StationId, LevelBase = doc.LevelBase };
            docNoEdge.Cells.AddRange(doc.Cells);
            docNoEdge.Modules.Add(doc.Modules[0]);
            docNoEdge.Modules.Add(doc.Modules[1]);
            docNoEdge.Lines.AddRange(doc.Lines);
            var rmDelta = new StationSessionDelta();
            rmDelta.RemovedModules.Add("edge-1");
            var staged = session.StageCellDelta(docNoEdge.StationId, docNoEdge.LevelBase, AlwaysOpenWorkdayDay(1.5), rmDelta);
            session.CommitDocumentEdit(staged);
            Assert.AreEqual(0, loads.Count, mode + ": removing platform edge clears all doorLoads commitments");
        }
    }
}
