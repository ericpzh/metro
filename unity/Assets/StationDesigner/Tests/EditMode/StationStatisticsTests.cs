using System;
using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 21 §6.1–6.3: Station statistics collector, 13-column history buffer,
    /// LOS thresholds, JsRound &amp; NearestNode tie-breaking, outside/onboard/waiting
    /// population accounting, multi-speed deterministic replay, lifecycle/edit
    /// continuity, and paginated <c>stats.history</c> transport validation.
    /// </summary>
    public sealed class StationStatisticsTests {
        const string LineA = "line-a";
        const string LineB = "line-b";
        const string TrackA = "track-a";
        const string TrackB = "track-b";

        static StationStatisticsSnapshot MakeReading(
            double simTime,
            int population = 0,
            string crowdLos = "A",
            int gateQueue = 0,
            int escalatorQueue = 0,
            int liftQueue = 0,
            int doorQueue = 0,
            int boarded = 0,
            int exited = 0,
            int leftBehind = 0) {
            return new StationStatisticsSnapshot {
                Tick = (long)Math.Round(simTime),
                SimTime = simTime,
                Population = population,
                CrowdLos = crowdLos,
                GateQueue = gateQueue,
                EscalatorQueue = escalatorQueue,
                LiftQueue = liftQueue,
                DoorQueue = doorQueue,
                Boarded = boarded,
                Exited = exited,
                LeftBehind = leftBehind,
                Period = "offpeak",
            };
        }

        static double[] ColumnOf(double[] interleaved, int count, int col) {
            var result = new double[count];
            for (int i = 0; i < count; i++) result[i] = interleaved[i * StationStatisticsHistory.Stride + col];
            return result;
        }

        static StationCellFact Cell(int x, int y, int z, int zone, bool solid = true, double speed = 1.0) =>
            new StationCellFact { X = x, Y = y, Z = z, Solid = solid, Zone = zone, Speed = speed };

        /// <summary>
        /// Busy two-stop, two-storey fixture: street apron with outside + unpaid zones,
        /// fare gate line, escalator + lift down to a basement island platform serving
        /// two short-headway lines with tight 2-metre platform edges so normal ticks
        /// produce boarding, alighting, exits, queues, and left-behind passengers.
        /// </summary>
        static StationSessionDocument BusyTwoStopDocument(bool withOutsideApron = true, int edgeWidth = 2) {
            var doc = new StationSessionDocument { StationId = "busy-two-stop", LevelBase = 0 };

            // Street level z = 0: x in [0..3] is outside (Zone = 1) when requested, x in [4..7] unpaid (2), x in [8..12] paid (3).
            for (int x = 0; x <= 12; x++) {
                for (int y = 0; y <= 7; y++) {
                    int zone = x <= 3 ? (withOutsideApron ? StationWalkGraphBuilder.ZoneOutside : 2) : (x <= 7 ? 2 : 3);
                    doc.Cells.Add(Cell(x, y, 0, zone));
                }
            }

            // Basement platform z = -5: paid/platform floor x in [0..12], y in [1..6].
            for (int x = 0; x <= 12; x++) {
                for (int y = 1; y <= 6; y++) {
                    doc.Cells.Add(Cell(x, y, -5, 4));
                }
            }

            // Two street exits on the apron so exiting alighted riders and entering riders cross paths.
            doc.Modules.Add(new StationModuleFact { Id = "exit-a", Type = "exit", X = 1, Y = 2, Z = 0, Name = "A", HeadHouse = true });
            doc.Modules.Add(new StationModuleFact { Id = "exit-b", Type = "exit", X = 1, Y = 5, Z = 0, Name = "B", HeadHouse = true });

            // Single fare gate throat at (8, 3) separating unpaid and paid concourse.
            doc.Cells.RemoveAll(c => c.Z == 0 && c.X == 8 && c.Y != 3);
            doc.Modules.Add(new StationModuleFact {
                Id = "gate-1", Type = "gate", X = 8, Y = 3, Z = 0, Rot = 0,
                GateDir = 0, GateOpen = true, GateHasLane = true,
            });

            // Escalator and lift connecting paid street concourse (z = 0) and basement platform (z = -5).
            doc.Modules.Add(new StationModuleFact {
                Id = "esc-down", Type = "escalator", X = 10, Y = 2, Z = -5, Rot = 0, Width = 1, Depth = 4,
                Dir = "both", HasEndpoints = true, FromX = 10, FromY = 2, FromZ = 0, ToX = 10, ToY = 2, ToZ = -5,
            });
            doc.Modules.Add(new StationModuleFact {
                Id = "lift-1", Type = "lift", X = 10, Y = 5, Z = -5, Rot = 0, Width = 2, Depth = 2,
                HasEndpoints = true, FromX = 10, FromY = 5, FromZ = -5, ToX = 10, ToY = 5, ToZ = 0,
            });

            // Stop 1 (north side y = 0, platform edge at y = 1) on Line A.
            doc.Modules.Add(new StationModuleFact {
                Id = TrackA, Type = "track", X = 2, Y = 0, Z = -5, Rot = 0, Width = 8, Depth = 1,
                LineId = LineA, Dir = "up",
            });
            doc.Modules.Add(new StationModuleFact {
                Id = "edge-a", Type = "platform-edge", X = 4, Y = 1, Z = -5, Rot = 0, Width = edgeWidth,
                LineId = LineA, RailId = TrackA, Side = "right", Dir = "up",
            });

            // Stop 2 (south side y = 7, platform edge at y = 6) on Line B.
            doc.Modules.Add(new StationModuleFact {
                Id = TrackB, Type = "track", X = 2, Y = 7, Z = -5, Rot = 0, Width = 8, Depth = 1,
                LineId = LineB, Dir = "down",
            });
            doc.Modules.Add(new StationModuleFact {
                Id = "edge-b", Type = "platform-edge", X = 4, Y = 6, Z = -5, Rot = 2, Width = edgeWidth,
                LineId = LineB, RailId = TrackB, Side = "right", Dir = "down",
            });

            doc.Lines.Add(new StationLineFact {
                Id = LineA, Direction = "up", Stock = "L", Cars = 1,
                AlightPerTrain = 10, AuthoredAlight = true, ModelScale = 0.2,
                HeadwayPeak = 45, HeadwayOffpeak = 50, HeadwayLate = 90,
            });
            doc.Lines.Add(new StationLineFact {
                Id = LineB, Direction = "down", Stock = "L", Cars = 1,
                AlightPerTrain = 10, AuthoredAlight = true, ModelScale = 0.2,
                HeadwayPeak = 55, HeadwayOffpeak = 60, HeadwayLate = 90,
            });

            return doc;
        }

        [Test]
        public void HistoryMatchesWebColumnOrderCadenceDeltasAndBufferPrivacy() {
            Assert.AreEqual(13, StationStatisticsHistory.Stride);
            Assert.AreEqual(60.0, StationStatisticsHistory.SampleSeconds, 1e-9);
            CollectionAssert.AreEqual(
                new[] {
                    "simTime", "population", "crowdLos",
                    "gateQueue", "escalatorQueue", "liftQueue", "doorQueue",
                    "boarded", "exited", "leftBehind",
                    "boardedPerMin", "exitedPerMin", "leftBehindPerMin",
                },
                StationStatisticsHistory.Columns);

            // 1. Cadence from game/test/history.test.mjs: reset at 1000, step 1001..1300 -> 1001, 1061, 1121, 1181, 1241.
            var cadence = new StationStatisticsHistory(0);
            cadence.Reset(1000);
            for (int t = 1001; t <= 1300; t++) cadence.Sample(MakeReading(t));
            Assert.AreEqual(5, cadence.Count);
            Assert.AreEqual(1001.0, cadence.Start, 1e-9);
            CollectionAssert.AreEqual(
                new double[] { 1001, 1061, 1121, 1181, 1241 },
                ColumnOf(cadence.Read(0, cadence.Count), cadence.Count, StationStatisticsHistory.ColSimTime));

            // Restart at 06:30:00 (23400) with 1 s steps -> 06:30:01 (23401), 06:31:01 (23461), 06:32:01 (23521).
            cadence.Reset(23400);
            for (int t = 23401; t <= 23530; t++) cadence.Sample(MakeReading(t));
            CollectionAssert.AreEqual(
                new double[] { 23401, 23461, 23521 },
                ColumnOf(cadence.Read(0, cadence.Count), cadence.Count, StationStatisticsHistory.ColSimTime));

            // 2. Exact baseline & per-minute deltas from game/test/history.test.mjs.
            var history = new StationStatisticsHistory(0);
            history.Reset(0);
            history.Sample(MakeReading(1, population: 40, crowdLos: "C", gateQueue: 3, escalatorQueue: 2, liftQueue: 1, doorQueue: 4, boarded: 12, exited: 7, leftBehind: 2));
            history.Sample(MakeReading(61, population: 55, crowdLos: "D", gateQueue: 5, escalatorQueue: 4, liftQueue: 0, doorQueue: 6, boarded: 20, exited: 9, leftBehind: 5));
            history.Sample(MakeReading(121, population: 30, crowdLos: "B", gateQueue: 1, escalatorQueue: 0, liftQueue: 2, doorQueue: 1, boarded: 26, exited: 14, leftBehind: 5));

            Assert.AreEqual(3, history.Count);
            var buf = history.Read(0, 3);
            CollectionAssert.AreEqual(new double[] { 40, 55, 30 }, ColumnOf(buf, 3, StationStatisticsHistory.ColPopulation));
            CollectionAssert.AreEqual(new double[] { 2, 3, 1 }, ColumnOf(buf, 3, StationStatisticsHistory.ColCrowdLos));
            CollectionAssert.AreEqual(new double[] { 3, 5, 1 }, ColumnOf(buf, 3, StationStatisticsHistory.ColGateQueue));
            CollectionAssert.AreEqual(new double[] { 2, 4, 0 }, ColumnOf(buf, 3, StationStatisticsHistory.ColEscalatorQueue));
            CollectionAssert.AreEqual(new double[] { 1, 0, 2 }, ColumnOf(buf, 3, StationStatisticsHistory.ColLiftQueue));
            CollectionAssert.AreEqual(new double[] { 4, 6, 1 }, ColumnOf(buf, 3, StationStatisticsHistory.ColDoorQueue));
            CollectionAssert.AreEqual(new double[] { 12, 20, 26 }, ColumnOf(buf, 3, StationStatisticsHistory.ColBoarded));
            CollectionAssert.AreEqual(new double[] { 7, 9, 14 }, ColumnOf(buf, 3, StationStatisticsHistory.ColExited));
            CollectionAssert.AreEqual(new double[] { 2, 5, 5 }, ColumnOf(buf, 3, StationStatisticsHistory.ColLeftBehind));
            CollectionAssert.AreEqual(new double[] { 0, 8, 6 }, ColumnOf(buf, 3, StationStatisticsHistory.ColBoardedPerMin));
            CollectionAssert.AreEqual(new double[] { 0, 2, 5 }, ColumnOf(buf, 3, StationStatisticsHistory.ColExitedPerMin));
            CollectionAssert.AreEqual(new double[] { 0, 3, 0 }, ColumnOf(buf, 3, StationStatisticsHistory.ColLeftBehindPerMin));

            // 3. Geometric growth (> 200 rows) preserves earlier row indices, and Read returns a private copy.
            var growth = new StationStatisticsHistory(0);
            growth.Reset(0);
            for (int minute = 0; minute < 220; minute++) {
                growth.Sample(MakeReading(
                    1 + minute * 60,
                    population: minute,
                    boarded: minute * 7,
                    exited: minute * 5,
                    leftBehind: minute > 20 ? minute - 20 : 0));
            }
            Assert.AreEqual(220, growth.Count);
            var full = growth.Read(0, 220);
            var flows = ColumnOf(full, 220, StationStatisticsHistory.ColBoardedPerMin);
            Assert.AreEqual(219 * 7, flows.Sum(), 1e-9);

            var slice = growth.Read(1, 2);
            Assert.AreEqual(2 * StationStatisticsHistory.Stride, slice.Length);
            Assert.AreEqual(61.0, slice[0], 1e-9);
            slice[0] = -999999;
            Assert.AreEqual(61.0, growth.Read(1, 1)[0], 1e-9, "mutating transport slice must not mutate history buffer");
        }

        [Test]
        public void LosThresholdsAndEmptyGraphFollowExactSourceBoundaries() {
            Assert.AreEqual("A", StationLos.Compute(12.0, 10));
            Assert.AreEqual("B", StationLos.Compute(11.999, 10));
            Assert.AreEqual("B", StationLos.Compute(9.0, 10));
            Assert.AreEqual("C", StationLos.Compute(8.999, 10));
            Assert.AreEqual("C", StationLos.Compute(7.0, 10));
            Assert.AreEqual("D", StationLos.Compute(6.999, 10));
            Assert.AreEqual("D", StationLos.Compute(4.0, 10));
            Assert.AreEqual("E", StationLos.Compute(3.999, 10));
            Assert.AreEqual("E", StationLos.Compute(2.0, 10));
            Assert.AreEqual("F", StationLos.Compute(1.999, 10));
            Assert.AreEqual("A", StationLos.Compute(100.0, 0), "empty standing population gives A");
            Assert.AreEqual("A", StationLos.Compute(0.0, 25), "zero station area gives A");
            Assert.AreEqual("A", StationLos.Compute(-5.0, 25), "negative station area gives A");

            for (int i = 0; i < StationLos.Order.Length; i++) {
                Assert.AreEqual(i, StationLos.IndexOf(StationLos.Order[i]));
            }

            var emptySession = new StationSimulationSession(new StationSessionSetup {
                Document = new StationSessionDocument { StationId = "empty", LevelBase = 0 },
                StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            });
            emptySession.Advance(1.0);
            Assert.AreEqual("A", emptySession.Statistics.CrowdLos);
            Assert.AreEqual(0, emptySession.Statistics.Population);
            Assert.AreEqual(0, emptySession.Statistics.GateQueue);
            Assert.AreEqual(0, emptySession.Statistics.EscalatorQueue);
            Assert.AreEqual(0, emptySession.Statistics.LiftQueue);
            Assert.AreEqual(0, emptySession.Statistics.DoorQueue);
        }

        [Test]
        public void JsRoundAndNearestNodeMatchWorldNearestNodeNegativeAndTieRules() {
            Assert.AreEqual(1, StationServiceRuntime.JsRound(0.5));
            Assert.AreEqual(0, StationServiceRuntime.JsRound(0.49));
            Assert.AreEqual(0, StationServiceRuntime.JsRound(-0.5));
            Assert.AreEqual(-1, StationServiceRuntime.JsRound(-0.51));
            Assert.AreEqual(-1, StationServiceRuntime.JsRound(-1.5));
            Assert.AreEqual(-2, StationServiceRuntime.JsRound(-1.51));

            var doc = new StationSessionDocument { StationId = "nearest-ties", LevelBase = 0 };
            doc.Cells.Add(Cell(-3, -5, -5, 3));
            doc.Cells.Add(Cell(-5, -4, -5, 3));
            doc.Cells.Add(Cell(-1, 10, -5, 3));
            doc.Cells.Add(Cell(1, 10, -5, 3));
            doc.Cells.Add(Cell(22, 22, -5, 3));
            doc.Cells.Add(Cell(20, 20, 0, 3));

            var graph = StationWalkGraphBuilder.Build(doc, new StationWalkGraphOptions { IncludeGround = false });

            int hitRing1 = StationServiceRuntime.NearestNode(graph, -3.5, -3.5, -4.0);
            Assert.GreaterOrEqual(hitRing1, 0);
            Assert.AreEqual(-2.5, graph.NodeX[hitRing1], 1e-9);
            Assert.AreEqual(-4.5, graph.NodeY[hitRing1], 1e-9, "outer dy loop (-1) must win before dy = 0");

            int hitSameDy = StationServiceRuntime.NearestNode(graph, 0.5, 10.5, -4.0);
            Assert.GreaterOrEqual(hitSameDy, 0);
            Assert.AreEqual(-0.5, graph.NodeX[hitSameDy], 1e-9, "inner dx loop (-1) must win before dx = +1");
            Assert.AreEqual(10.5, graph.NodeY[hitSameDy], 1e-9);

            int hitRing2 = StationServiceRuntime.NearestNode(graph, 20.5, 20.5, -4.0);
            Assert.GreaterOrEqual(hitRing2, 0);
            Assert.AreEqual(22.5, graph.NodeX[hitRing2], 1e-9, "radius 2 cell is found while ignoring closer cell on wrong floor");
            Assert.AreEqual(22.5, graph.NodeY[hitRing2], 1e-9);
            Assert.AreEqual(-4.0, graph.NodeZ[hitRing2], 1e-9);

            Assert.AreEqual(-1, StationServiceRuntime.NearestNode(graph, 25.5, 25.5, -4.0));
        }

        [Test]
        public void OutsideAndOnboardPassengersCountInPopulationButNotStandingLos() {
            var outsideDoc = new StationSessionDocument { StationId = "outside-and-onboard", LevelBase = 0 };
            // 15-metre outside apron x in [0..14], y in [0..2] (ZoneOutside -> 0 StationArea)
            // feeding a compact 2x2 = 4.0 m^2 paid platform x in [15..16], y in [1..2] (4 standing pax -> < 1.2 m^2/pax -> LOS != A).
            for (int x = 0; x <= 14; x++) {
                for (int y = 0; y <= 2; y++) {
                    outsideDoc.Cells.Add(Cell(x, y, 0, StationWalkGraphBuilder.ZoneOutside));
                }
            }
            for (int x = 15; x <= 16; x++) {
                for (int y = 1; y <= 2; y++) {
                    outsideDoc.Cells.Add(Cell(x, y, 0, 3));
                }
            }
            outsideDoc.Modules.Add(new StationModuleFact { Id = "exit-1", Type = "exit", X = 0, Y = 1, Z = 0, Name = "A", HeadHouse = true });
            outsideDoc.Modules.Add(new StationModuleFact { Id = TrackA, Type = "track", X = 15, Y = 0, Z = 0, Width = 2, Depth = 1, LineId = LineA, Dir = "up" });
            outsideDoc.Modules.Add(new StationModuleFact { Id = "edge-a", Type = "platform-edge", X = 15, Y = 1, Z = 0, Width = 2, LineId = LineA, RailId = TrackA, Side = "right", Dir = "up" });
            outsideDoc.Lines.Add(new StationLineFact {
                Id = LineA, Direction = "up", Stock = "L", Cars = 1, ModelScale = 0.2,
                AlightPerTrain = 0, AuthoredAlight = true,
                HeadwayPeak = 30, HeadwayOffpeak = 30, HeadwayLate = 30,
            });

            // 1. Outside walkers on Monday morning peak (2026-01-05 08:00): count in Population, 0 in standing LOS.
            var outsideSession = new StationSimulationSession(new StationSessionSetup {
                Document = outsideDoc,
                StartSimTime = 4 * 86400 + 28800,
                StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                Services = new StationServiceOptions { ExitInRatePerHour = 14400, AlightPerTrain = 0, PublishedPassengerLimit = 256 },
            });
            Assert.AreEqual(4.0, outsideSession.WalkGraph.StationArea, 1e-9, "only the 2x2 non-outside cells count toward StationArea");

            bool sawOutsideOnlyCrowd = false;
            for (int i = 0; i < 8; i++) {
                outsideSession.Advance(1.0);
                var frames = outsideSession.PassengerFrames();
                if (frames.Length >= 5 && frames.All(f => f.X < 14.5)) {
                    sawOutsideOnlyCrowd = true;
                    Assert.AreEqual(frames.Length, outsideSession.Statistics.Population, "outside passengers count in Population");
                    Assert.AreEqual("A", outsideSession.Statistics.CrowdLos, "outside passengers contribute 0 to standing LOS even when > 4 pax exist");
                    break;
                }
            }
            Assert.IsTrue(sawOutsideOnlyCrowd, "multiple passengers spawned on the outside apron before reaching paid floor");

            // 2. Waiting vs onboard passengers on the 4.0 m^2 platform: waiting counts toward standing LOS, onboard does not.
            var onboardSession = new StationSimulationSession(new StationSessionSetup {
                Document = outsideDoc,
                StartSimTime = 4 * 86400 + 28800,
                StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                Services = new StationServiceOptions { ExitInRatePerHour = 0, AlightPerTrain = 0, PublishedPassengerLimit = 256 },
            });
            int seeded = onboardSession.Services.SeedDoorRiders(LineA, TrackA, 6);
            Assert.GreaterOrEqual(seeded, 5, "seeded >= 5 waiting passengers at platform doors");

            bool sawWaitingLos = false;
            bool sawOnboardLos = false;
            for (int i = 0; i < 60; i++) {
                onboardSession.Advance(1.0);
                if (onboardSession.Services.Onboard == 0 && onboardSession.Statistics.Population == seeded) {
                    sawWaitingLos = true;
                    Assert.AreNotEqual("A", onboardSession.Statistics.CrowdLos, "waiting passengers on 4 m^2 platform must degrade standing LOS");
                }
                if (onboardSession.Services.Onboard == seeded && onboardSession.Services.DoorQueueTotal == 0) {
                    sawOnboardLos = true;
                    Assert.AreEqual(seeded, onboardSession.Statistics.Population, "onboard passengers remain in logical Population while train is in run");
                    Assert.AreEqual("A", onboardSession.Statistics.CrowdLos, "passengers with active TrainKey contribute 0 to standing LOS");
                    break;
                }
            }
            Assert.IsTrue(sawWaitingLos, "observed waiting passengers degrading LOS before boarding");
            Assert.IsTrue(sawOnboardLos, "observed onboard passengers excluded from standing LOS after boarding");
        }

        [Test]
        public void BusyTwoStopFixtureWiresQueuesArrivalsBoardedVsOnboardAgentsCapAndMultiSpeedDeterminism() {
            var doc = BusyTwoStopDocument(withOutsideApron: true, edgeWidth: 2);
            var options = new StationServiceOptions {
                ExitInRatePerHour = 5400,
                MaxPassengers = 55,
            };

            StationSimulationSession RunAtSpeed(int speed) {
                var s = new StationSimulationSession(new StationSessionSetup {
                    Document = doc,
                    Seed = 424242,
                    StartSimTime = 26990,
                    StartPlaying = true,
                    Speed = speed,
                    WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                    Services = options,
                });
                int steps = 320 / speed;
                for (int i = 0; i < steps; i++) s.Advance(1.0);
                return s;
            }

            var s1 = RunAtSpeed(1);
            var s16 = RunAtSpeed(16);
            var s64 = RunAtSpeed(64);

            Assert.GreaterOrEqual(s1.Statistics.TrainArrivals, 4, "both stops berthed multiple trains");
            int berthTransitions = s1.TrainTransitions.Count(t => t.From == TrainPhase.Approach && t.To == TrainPhase.Berth);
            Assert.AreEqual(berthTransitions, s1.Statistics.TrainArrivals, "exactly one arrival per Approach -> Berth");

            Assert.AreEqual(s1.Services.Boarded, s1.Statistics.Boarded);
            Assert.AreEqual(s1.Services.Alighted, s1.Statistics.Alighted);
            Assert.AreEqual(s1.Services.Exited, s1.Statistics.Exited);
            Assert.AreEqual(s1.Services.LeftBehind, s1.Statistics.LeftBehind);
            Assert.Greater(s1.Statistics.Boarded, 0, "passengers boarded");
            Assert.Greater(s1.Statistics.Alighted, 0, "passengers alighted");
            Assert.Greater(s1.Statistics.Exited, 0, "passengers exited");
            Assert.Greater(s1.Statistics.LeftBehind, 0, "tight 2m platform edge produced left-behind passengers");
            Assert.Greater(s1.Statistics.Boarded, s1.Services.Onboard, "Boarded is cumulative while Onboard is current occupancy");
            Assert.IsTrue(s1.Statistics.AgentsCap, "MaxPassengers=55 latched agentsCap once capHit > 0");

            Assert.AreEqual(s1.Services.EscalatorQueueTotal, s1.Statistics.EscalatorQueue);
            Assert.AreEqual(s1.Services.LiftQueueTotal, s1.Statistics.LiftQueue);
            Assert.AreEqual(s1.Services.DoorQueueTotal, s1.Statistics.DoorQueue);
            Assert.AreEqual(
                s1.Services.QueueTotal,
                s1.Statistics.GateQueue + s1.Statistics.EscalatorQueue + s1.Statistics.LiftQueue + s1.Statistics.DoorQueue);

            Assert.AreEqual(6, s1.History.Count, "320 seconds from reset samples at +1, +61, +121, +181, +241, +301");
            Assert.AreEqual(s1.History.Count, s16.History.Count);
            Assert.AreEqual(s1.History.Count, s64.History.Count);

            var h1 = s1.History.Read(0, s1.History.Count);
            var h16 = s16.History.Read(0, s16.History.Count);
            var h64 = s64.History.Read(0, s64.History.Count);
            CollectionAssert.AreEqual(h1, h16, "16x history rows must match 1x bit-for-bit");
            CollectionAssert.AreEqual(h1, h64, "64x history rows must match 1x bit-for-bit");

            Assert.AreEqual(s1.Statistics.Population, s16.Statistics.Population);
            Assert.AreEqual(s1.Statistics.Population, s64.Statistics.Population);
            Assert.AreEqual(s1.Statistics.Boarded, s64.Statistics.Boarded);
            Assert.AreEqual(s1.Statistics.Exited, s64.Statistics.Exited);
            Assert.AreEqual(s1.Statistics.LeftBehind, s64.Statistics.LeftBehind);
            Assert.AreEqual(s1.Statistics.TrainArrivals, s64.Statistics.TrainArrivals);
        }

        [Test]
        public void RestartAndForwardBackwardTimeDateSeeksResetHistoryWithExactPostBoundaryDeltas() {
            var doc = BusyTwoStopDocument();
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = doc,
                Seed = 77,
                StartSimTime = 27000,
                StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                Services = new StationServiceOptions { ExitInRatePerHour = 4800, MaxPassengers = 80 },
            });

            string run0 = session.StatisticsRunId;
            for (int i = 0; i < 185; i++) session.Advance(1.0);
            int boardedBeforeSeek = session.Statistics.Boarded;
            Assert.Greater(boardedBeforeSeek, 0);
            Assert.AreEqual(4, session.History.Count);

            double forwardTarget = session.Clock.SimTime + 3600;
            session.SeekToSimTime(forwardTarget);
            string run1 = session.StatisticsRunId;
            Assert.AreNotEqual(run0, run1);
            Assert.AreEqual(0, session.History.Count, "seek resets history without synthesizing rows");
            Assert.AreEqual(boardedBeforeSeek, session.Statistics.Boarded, "seek preserves cumulative boarded");

            session.SetPlaying(false);
            session.Advance(120.0);
            Assert.AreEqual(0, session.History.Count);

            session.SetPlaying(true);
            session.Advance(1.0);
            Assert.AreEqual(1, session.History.Count);
            int row0Boarded = session.Statistics.Boarded;
            Assert.GreaterOrEqual(row0Boarded, boardedBeforeSeek);
            var row0 = session.History.Read(0, 1);
            Assert.AreEqual(forwardTarget + 1.0, row0[StationStatisticsHistory.ColSimTime], 1e-9);
            Assert.AreEqual(row0Boarded, row0[StationStatisticsHistory.ColBoarded], 1e-9);
            Assert.AreEqual(0.0, row0[StationStatisticsHistory.ColBoardedPerMin], 1e-9);
            Assert.AreEqual(0.0, row0[StationStatisticsHistory.ColExitedPerMin], 1e-9);
            Assert.AreEqual(0.0, row0[StationStatisticsHistory.ColLeftBehindPerMin], 1e-9);

            for (int i = 0; i < 60; i++) session.Advance(1.0);
            Assert.AreEqual(2, session.History.Count);
            int row1Boarded = session.Statistics.Boarded;
            var row1 = session.History.Read(1, 1);
            Assert.AreEqual(row1Boarded, row1[StationStatisticsHistory.ColBoarded], 1e-9);
            Assert.AreEqual(row1Boarded - row0Boarded, row1[StationStatisticsHistory.ColBoardedPerMin], 1e-9);

            session.SeekToSimTime(forwardTarget - 1800);
            string run2 = session.StatisticsRunId;
            Assert.AreNotEqual(run1, run2);
            Assert.AreEqual(0, session.History.Count);
            Assert.AreEqual(row1Boarded, session.Statistics.Boarded);

            session.SeekToDate(2026, 1, 3);
            string run3 = session.StatisticsRunId;
            Assert.AreNotEqual(run2, run3);
            Assert.AreEqual(0, session.History.Count);
            Assert.AreEqual(row1Boarded, session.Statistics.Boarded);

            session.SetPlaying(false);
            double clockBeforeRestart = session.Clock.SimTime;
            session.Restart();
            string run4 = session.StatisticsRunId;
            Assert.AreNotEqual(run3, run4);
            Assert.AreEqual(clockBeforeRestart, session.Clock.SimTime, 1e-9, "restart preserves clock");
            Assert.AreEqual(0, session.History.Count);
            Assert.AreEqual(0, session.Statistics.Population);
            Assert.AreEqual(0, session.Statistics.Boarded);
            Assert.AreEqual(0, session.Statistics.Exited);
            Assert.AreEqual(0, session.Statistics.LeftBehind);
            Assert.AreEqual(0, session.Statistics.TrainArrivals);
            Assert.IsFalse(session.Statistics.AgentsCap, "restart clears latched agentsCap");
        }

        [Test]
        public void StructuralCosmeticAndDayEditsPreserveRunIdCountersAndActiveBerthedTrains() {
            var doc = BusyTwoStopDocument(withOutsideApron: false, edgeWidth: 3);
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = doc,
                Seed = 31415,
                StartSimTime = 27000,
                StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                Services = new StationServiceOptions { ExitInRatePerHour = 4200 },
            });

            bool pausedAtBerthedTrain = false;
            for (int i = 0; i < 260; i++) {
                session.Advance(1.0);
                if (session.History.Count >= 2 && session.Services.Onboard > 0 && session.Statistics.Population > 5) {
                    pausedAtBerthedTrain = true;
                    break;
                }
            }
            Assert.IsTrue(pausedAtBerthedTrain, "reached a state with >=2 history rows, walking crowd, and onboard riders");

            string runId = session.StatisticsRunId;
            int historyBefore = session.History.Count;
            int boardedBefore = session.Statistics.Boarded;
            int exitedBefore = session.Statistics.Exited;
            int leftBehindBefore = session.Statistics.LeftBehind;
            int onboardBefore = session.Services.Onboard;
            int popBefore = session.Statistics.Population;
            int epochBefore = session.Services.GraphEpoch;

            var newDay = StationDayData.Default;
            newDay.Service = new DaySpan(23400, 82800);
            var stagedDay = session.StageDocumentEdit(doc, newDay, StationDocumentEditKind.DayOnly);
            session.CommitDocumentEdit(stagedDay);
            Assert.AreEqual(runId, session.StatisticsRunId);
            Assert.AreEqual(historyBefore, session.History.Count);
            Assert.AreEqual(epochBefore, session.Services.GraphEpoch);
            Assert.AreEqual(boardedBefore, session.Statistics.Boarded);

            var stagedCosmetic = session.StageDocumentEdit(doc, newDay, StationDocumentEditKind.Cosmetic);
            session.CommitDocumentEdit(stagedCosmetic);
            Assert.AreEqual(runId, session.StatisticsRunId);
            Assert.AreEqual(historyBefore, session.History.Count);
            Assert.AreEqual(epochBefore, session.Services.GraphEpoch);
            Assert.AreEqual(onboardBefore, session.Services.Onboard);

            var expandedDoc = BusyTwoStopDocument(withOutsideApron: false, edgeWidth: 3);
            for (int y = 0; y <= 7; y++) expandedDoc.Cells.Add(Cell(13, y, 0, 3));
            var stagedStructural = session.StageDocumentEdit(expandedDoc, newDay, StationDocumentEditKind.Structural);
            session.CommitDocumentEdit(stagedStructural);

            Assert.AreEqual(runId, session.StatisticsRunId, "structural edit preserves statistics runId");
            Assert.AreEqual(historyBefore, session.History.Count, "structural edit preserves history rows");
            Assert.AreEqual(epochBefore + 1, session.Services.GraphEpoch, "structural edit rebuilt walk graph");
            Assert.IsTrue(session.Services.AllWalkingRoutesMatchCurrentGraph(), "every active walker replanned onto new graph");
            Assert.AreEqual(onboardBefore, session.Services.Onboard, "matching doorways preserve onboard passengers");
            Assert.AreEqual(popBefore, session.Statistics.Population);
            Assert.AreEqual(boardedBefore, session.Statistics.Boarded);
            Assert.AreEqual(exitedBefore, session.Statistics.Exited);
            Assert.AreEqual(leftBehindBefore, session.Statistics.LeftBehind);

            var recutDoc = BusyTwoStopDocument(withOutsideApron: false, edgeWidth: 1);
            for (int i = 0; i < recutDoc.Modules.Count; i++) {
                var m = recutDoc.Modules[i];
                if (m.Type == "platform-edge") {
                    m.X += 2;
                    recutDoc.Modules[i] = m;
                }
            }
            int leftBehindBeforeRecut = session.Statistics.LeftBehind;
            var stagedRecut = session.StageDocumentEdit(recutDoc, newDay, StationDocumentEditKind.Structural);
            session.CommitDocumentEdit(stagedRecut);
            Assert.AreEqual(runId, session.StatisticsRunId);
            Assert.AreEqual(leftBehindBeforeRecut, session.Statistics.LeftBehind, "recutting doorways during an edit must not charge leftBehind");
            Assert.IsTrue(session.Services.AllWalkingRoutesMatchCurrentGraph());

            int epochAfterRecut = session.Services.GraphEpoch;
            var abortedDoc = BusyTwoStopDocument(withOutsideApron: false, edgeWidth: 4);
            session.StageDocumentEdit(abortedDoc, newDay, StationDocumentEditKind.Structural);
            session.AbortDocumentEdit();
            Assert.AreEqual(runId, session.StatisticsRunId);
            Assert.AreEqual(epochAfterRecut, session.Services.GraphEpoch);
            Assert.AreEqual(historyBefore, session.History.Count);

            var lastRowBefore = session.History.Read(historyBefore - 1, 1);
            double prevSampledBoarded = lastRowBefore[StationStatisticsHistory.ColBoarded];
            while (session.History.Count == historyBefore) {
                session.Advance(1.0);
            }
            var nextRow = session.History.Read(historyBefore, 1);
            Assert.AreEqual(
                nextRow[StationStatisticsHistory.ColBoarded] - prevSampledBoarded,
                nextRow[StationStatisticsHistory.ColBoardedPerMin],
                1e-9,
                "per-minute delta across structural edits matches cumulative difference");
        }

        [Test]
        public void CommandHandlerAndContributorEnforcePageCapRangeRunFencingAndOmitValuesInState() {
            StationSimulationSession activeSession = null;
            var contributor = new StationStatisticsStateContributor(() => activeSession);
            var handler = new StationStatisticsCommandHandler(() => activeSession);

            var unavailable = contributor.BuildPayload(null, null);
            Assert.IsFalse((bool)unavailable["available"]);
            Assert.AreEqual("", (string)unavailable["runId"]);
            Assert.AreEqual(JTokenType.Null, unavailable["metrics"].Type);

            var noSessionPayload = new JObject { ["runId"] = "run-1", ["from"] = 0, ["limit"] = 10 };
            Assert.IsFalse(handler.TryHandle(new StationCommand { Type = "stats.history" }, noSessionPayload, out string code, out _));
            Assert.AreEqual("no-session", code);

            activeSession = new StationSimulationSession(new StationSessionSetup {
                Document = BusyTwoStopDocument(withOutsideApron: false, edgeWidth: 3),
                Seed = 9,
                StartSimTime = 23400,
                StartPlaying = true,
                Speed = 64,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                Services = new StationServiceOptions { ExitInRatePerHour = 1200, MaxPassengers = 40 },
            });
            while (activeSession.History.Count < 300) {
                activeSession.Advance(1.0);
            }
            int totalRows = activeSession.History.Count;
            Assert.GreaterOrEqual(totalRows, 300);

            var minimalRead = StationDocumentReader.Read(
                new JObject {
                    ["format"] = "metro-save",
                    ["formatVersion"] = 1,
                    ["gameVersion"] = "0.2.0",
                    ["savedAt"] = StationDocumentReader.FixedSavedAt,
                    ["name"] = "Test",
                    ["city"] = "guangzhou",
                    ["seed"] = 1,
                    ["levelBase"] = 0,
                    ["storeyHeight"] = 5,
                    ["static"] = new JObject {
                        ["cells"] = new JArray { new JObject { ["x"] = 0, ["y"] = 0, ["z"] = 0, ["fill"] = "solid" } },
                        ["modules"] = new JArray(),
                        ["lines"] = new JArray(),
                    },
                }.ToString(Newtonsoft.Json.Formatting.None),
                new StationSource("test", ""));
            Assert.IsNotNull(minimalRead.Document);
            Assert.IsTrue(minimalRead.Index.IsValid);
            var stateBlock = contributor.BuildPayload(minimalRead.Document, minimalRead.Index);
            Assert.IsTrue((bool)stateBlock["available"]);
            Assert.AreEqual(activeSession.StatisticsRunId, (string)stateBlock["runId"]);
            Assert.AreEqual(totalRows, (int)stateBlock["history"]["count"]);
            Assert.IsNull(stateBlock["history"]["values"], "normal state frames must never carry history values");

            string runId = activeSession.StatisticsRunId;
            var page0 = new JObject { ["runId"] = runId, ["from"] = 0, ["limit"] = 500 };
            Assert.IsTrue(handler.TryHandle(new StationCommand { Type = "stats.history" }, page0, out code, out _), code);
            Assert.AreEqual(128, (int)page0["count"]);
            Assert.AreEqual(totalRows, (int)page0["total"]);
            Assert.AreEqual(128 * 13, ((JArray)page0["values"]).Count);

            var page1 = new JObject { ["runId"] = runId, ["from"] = 128, ["limit"] = 128 };
            Assert.IsTrue(handler.TryHandle(new StationCommand { Type = "stats.history" }, page1, out code, out _));
            Assert.AreEqual(128, (int)page1["count"]);

            var page2 = new JObject { ["runId"] = runId, ["from"] = 256, ["limit"] = 128 };
            Assert.IsTrue(handler.TryHandle(new StationCommand { Type = "stats.history" }, page2, out code, out _));
            Assert.AreEqual(totalRows - 256, (int)page2["count"]);

            var atEnd = new JObject { ["runId"] = runId, ["from"] = totalRows, ["limit"] = 128 };
            Assert.IsTrue(handler.TryHandle(new StationCommand { Type = "stats.history" }, atEnd, out code, out _));
            Assert.AreEqual(0, (int)atEnd["count"]);
            Assert.AreEqual(0, ((JArray)atEnd["values"]).Count);

            var negFrom = new JObject { ["runId"] = runId, ["from"] = -1, ["limit"] = 10 };
            Assert.IsFalse(handler.TryHandle(new StationCommand { Type = "stats.history" }, negFrom, out code, out _));
            Assert.AreEqual("out-of-range", code);

            var pastEnd = new JObject { ["runId"] = runId, ["from"] = totalRows + 1, ["limit"] = 10 };
            Assert.IsFalse(handler.TryHandle(new StationCommand { Type = "stats.history" }, pastEnd, out code, out _));
            Assert.AreEqual("out-of-range", code);

            var negLimit = new JObject { ["runId"] = runId, ["from"] = 0, ["limit"] = -5 };
            Assert.IsFalse(handler.TryHandle(new StationCommand { Type = "stats.history" }, negLimit, out code, out _));
            Assert.AreEqual("out-of-range", code);

            var badFrom = new JObject { ["runId"] = runId, ["from"] = "zero" };
            Assert.IsFalse(handler.TryHandle(new StationCommand { Type = "stats.history" }, badFrom, out code, out _));
            Assert.AreEqual("bad-payload", code);

            activeSession.Restart();
            var staleRead = new JObject { ["runId"] = runId, ["from"] = 0, ["limit"] = 10 };
            Assert.IsFalse(handler.TryHandle(new StationCommand { Type = "stats.history" }, staleRead, out code, out _));
            Assert.AreEqual("stale-run", code);
        }
    }
}
