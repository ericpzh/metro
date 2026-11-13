using System;
using System.Collections.Generic;
using Metro.App.Views;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

// Packet C Â· C3 â€” the published service frames (`StationServiceRuntime`), the
// document-derived crowd that fills them and the App feed that binds them to the
// crowd renderer.
//
// Every expectation here is a behaviour of the station, not a counter: passengers
// appear only while the station is open, the same seed replays the same frame, a
// gate admits in arrival order, a consist boards only with its doors wide and
// only after its own alighting wave has left, ids survive pause/seek/restart, a
// lift is called by the passenger waiting for it, a station nobody can walk
// through still runs its clock, and every published passenger reaches the view
// exactly once.
public class StationServiceFrameTests {
    // -------------------------------------------------------------- fixtures

    const string LineId = "line-1";
    const string TrackId = "track-1";
    const string GateId = "gate-1";
    const string ExitId = "exit-1";

    static StationCellFact Cell(int x, int y, int z, int zone, bool solid = true, double speed = 1) =>
        new StationCellFact { X = x, Y = y, Z = z, Solid = solid, Zone = zone, Speed = speed };

    /// <summary>
    /// A one-storey station: a street apron, one fare gate as the only way through
    /// the fare line, a paid platform strip with one screen-door run. The gate is
    /// the only walk edge between the two zones, so the crowd must use it.
    /// </summary>
    static StationSessionDocument GatePlatformDocument() {
        var document = new StationSessionDocument { StationId = "fixture-c3-gate", LevelBase = 0 };
        for (int x = 0; x <= 11; x++)
            for (int y = 0; y <= 9; y++)
                document.Cells.Add(Cell(x, y, 0, 1));
        document.Cells.Add(Cell(12, 4, 0, 1));
        for (int x = 13; x <= 23; x++)
            for (int y = 3; y <= 5; y++)
                document.Cells.Add(Cell(x, y, 0, 2));
        document.Modules.Add(new StationModuleFact { Id = "exit", Type = "exit", X = 10, Y = 4, Z = 0, Name = "A" });
        document.Modules.Add(new StationModuleFact {
            Id = GateId, Type = "gate", X = 12, Y = 4, Z = 0, Rot = 0, GateDir = 0, GateOpen = true, GateHasLane = true,
        });
        document.Modules.Add(new StationModuleFact {
            Id = TrackId, Type = "track", X = 14, Y = 2, Z = 0, Rot = 0, Width = 10, Depth = 1, LineId = LineId,
        });
        document.Modules.Add(new StationModuleFact {
            Id = "edge-1", Type = "platform-edge", X = 14, Y = 3, Z = 0, Rot = 0, Width = 10,
            LineId = LineId, RailId = TrackId, Side = "right", Dir = "up",
        });
        document.Lines.Add(new StationLineFact {
            Id = LineId, Direction = "up", HeadwayPeak = 150, HeadwayOffpeak = 240, HeadwayLate = 480,
        });
        return document;
    }

    /// <summary>
    /// Two floors whose only connection is one lift: the street apron and the
    /// platform. No stair, no escalator and (with the generated ground off) no
    /// other edge, so a passenger can only reach the train by calling the car.
    /// </summary>
    static StationSessionDocument LiftOnlyDocument() {
        var document = new StationSessionDocument { StationId = "fixture-c3-lift", LevelBase = 0 };
        for (int x = 0; x <= 7; x++)
            for (int y = 0; y <= 7; y++)
                document.Cells.Add(Cell(x, y, 0, 1));
        for (int x = 0; x <= 7; x++)
            for (int y = 0; y <= 7; y++)
                document.Cells.Add(Cell(x, y, -5, 2));
        document.Modules.Add(new StationModuleFact { Id = "exit", Type = "exit", X = 4, Y = 4, Z = 0, Name = "A" });
        document.Modules.Add(new StationModuleFact {
            Id = "lift-1", Type = "lift", X = 5, Y = 5, Z = -5, Rot = 0, Width = 2, Depth = 2,
            HasEndpoints = true, FromX = 5, FromY = 5, FromZ = -5, ToX = 5, ToY = 5, ToZ = 0,
        });
        document.Modules.Add(new StationModuleFact {
            Id = TrackId, Type = "track", X = 2, Y = 0, Z = -5, Rot = 0, Width = 6, Depth = 1, LineId = LineId,
        });
        document.Modules.Add(new StationModuleFact {
            Id = "edge-1", Type = "platform-edge", X = 2, Y = 1, Z = -5, Rot = 0, Width = 6,
            LineId = LineId, RailId = TrackId, Side = "right", Dir = "up",
        });
        document.Lines.Add(new StationLineFact {
            Id = LineId, Direction = "up", HeadwayPeak = 150, HeadwayOffpeak = 240, HeadwayLate = 480,
        });
        return document;
    }

    /// <summary>A street with an exit and a platform five storeys below it, with no link at all.</summary>
    static StationSessionDocument DisconnectedDocument() {
        var document = new StationSessionDocument { StationId = "fixture-c3-disconnected", LevelBase = 0 };
        for (int x = 0; x <= 3; x++)
            for (int y = 0; y <= 3; y++)
                document.Cells.Add(Cell(x, y, 0, 1));
        for (int x = 0; x <= 3; x++)
            for (int y = 0; y <= 3; y++)
                document.Cells.Add(Cell(x, y, -10, 2));
        document.Modules.Add(new StationModuleFact { Id = ExitId, Type = "exit", X = 0, Y = 0, Z = 0, Name = "A" });
        document.Modules.Add(new StationModuleFact {
            Id = TrackId, Type = "track", X = 0, Y = 0, Z = -10, Rot = 0, Width = 4, Depth = 1, LineId = LineId,
        });
        document.Modules.Add(new StationModuleFact {
            Id = "edge-1", Type = "platform-edge", X = 0, Y = 1, Z = -10, Rot = 0, Width = 4,
            LineId = LineId, RailId = TrackId, Side = "right", Dir = "up",
        });
        document.Lines.Add(new StationLineFact {
            Id = LineId, Direction = "up", HeadwayPeak = 150, HeadwayOffpeak = 240, HeadwayLate = 480,
        });
        return document;
    }

    /// <summary>An authored day whose 06:30 boot is a peak, so spawns are dense enough to observe.</summary>
    static StationDayData PeakDay(double amPeak) {
        return new StationDayData(
            new DaySpan(0, StationClock.ServiceLatest),
            new PeakSpans(new DaySpan(6 * 3600, 9 * 3600), new DaySpan(17 * 3600, 20 * 3600)),
            new DayDemand(new DemandKnobs(amPeak, 0.78, 1), DemandKnobs.DefaultOffday),
            new SimCalendar(new SimDate(2026, 1, 1), new string[0]));
    }

    /// <summary>A day whose service window has already shut at the boot instant.</summary>
    static StationDayData ShutDay() {
        return new StationDayData(
            new DaySpan(5 * 3600, 23 * 3600),
            new PeakSpans(new DaySpan(6 * 3600, 9 * 3600), new DaySpan(17 * 3600, 20 * 3600)),
            new DayDemand(new DemandKnobs(20, 0.78, 1), DemandKnobs.DefaultOffday),
            new SimCalendar(new SimDate(2026, 1, 1), new string[0]));
    }

    static StationSessionSetup Setup(StationSessionDocument document, StationDayData day, int alight, bool ground = false, uint seed = 7654321, double start = StationClock.ReferenceBootSeconds, StationServiceOptions services = null) {
        var options = services ?? new StationServiceOptions();
        // A fixture may raise the exit's own admission rate: the committed session
        // does not project the document's authored `inRate` yet (reported unported),
        // so the fixtures run the source's 900/h only when nothing else asks. The
        // station's shipped default stays 900.
        if (services == null) options.ExitInRatePerHour = 7200;
        options.AlightPerTrain = alight;
        return new StationSessionSetup {
            Document = document,
            Day = day,
            Seed = seed,
            StartSimTime = start,
            StartPlaying = true,
            WalkOptions = new StationWalkGraphOptions { IncludeGround = ground },
            Services = options,
        };
    }

    static StationSimulationSession Session(StationSessionDocument document, int alight = 0, double start = StationClock.ReferenceBootSeconds, StationServiceOptions services = null) =>
        new StationSimulationSession(Setup(document, PeakDay(40), alight, false, 7654321, start, services));

    static void Run(StationSimulationSession session, int ticks, Action<StationMotionFrame> each = null) {
        for (int i = 0; i < ticks; i++) {
            Assert.AreEqual(1, session.Advance(1.0), "each call steps exactly one simulated second at 1x");
            each?.Invoke(session.Snapshot());
        }
    }

    // ---------------------------------------------------------- the crowd gate

    [Test]
    public void PassengersSpawnOnlyWhileTheServiceIsOpen() {
        var open = new StationSimulationSession(Setup(GatePlatformDocument(), PeakDay(40), 0));
        Run(open, 60);
        Assert.Greater(open.Services.Spawned, 0, "an open station draws street demand");
        Assert.Greater(open.PassengerFrames().Length, 0, "and publishes the crowd it drew");

        var shut = new StationSimulationSession(Setup(GatePlatformDocument(), ShutDay(), 0, false, 7654321, 23.5 * 3600));
        Assert.IsFalse(shut.Snapshot().Clock.ServiceOpen, "the fixture's window has already closed at 23:30");
        Run(shut, 60);
        Assert.AreEqual(0, shut.Services.Spawned, "a shut station draws nobody");
        Assert.AreEqual(0, shut.PassengerFrames().Length);
        Assert.AreEqual(23.5 * 3600 + 60, shut.Clock.SimTime, 1e-6, "the clock runs through the closed window regardless");
    }

    [Test]
    public void SpawnCountScalesWithTheDemandCurve() {
        // The authored knob is the 时刻 slider's own range (0–2.5, clamped by the clock),
        // so the comparison is the busiest authored day against a nearly flat one.
        var busy = new StationSimulationSession(Setup(GatePlatformDocument(), PeakDay(2.5), 0));
        var quiet = new StationSimulationSession(Setup(GatePlatformDocument(), PeakDay(0.2), 0));
        Run(busy, 90);
        Run(quiet, 90);
        Assert.Greater(busy.Services.Spawned, quiet.Services.Spawned * 2,
            "the busiest morning peak draws far more passengers than a nearly flat day ("
            + busy.Services.Spawned + " vs " + quiet.Services.Spawned + ")");
        Assert.Greater(quiet.Services.Spawned, 0, "even a quiet day draws somebody");
    }

    [Test]
    public void TheSameSeedReplaysTheSameServiceFrame() {
        var first = Session(GatePlatformDocument(), 6);
        var second = Session(GatePlatformDocument(), 6);
        for (int tick = 0; tick < 60; tick++) {
            Assert.AreEqual(1, first.Advance(1.0));
            Assert.AreEqual(1, second.Advance(1.0));
            var a = first.Snapshot();
            var b = second.Snapshot();
            AssertSamePassengers(a.Passengers, b.Passengers, tick);
            AssertSameGates(a.Gates, b.Gates, tick);
            Assert.AreEqual(a.Trains[0].Phase, b.Trains[0].Phase, "train phase at tick " + tick);
            Assert.AreEqual(a.Trains[0].DoorFraction, b.Trains[0].DoorFraction, 0, "door fraction at tick " + tick);
            Assert.AreEqual(a.Lifts.Length, b.Lifts.Length, "lift count at tick " + tick);
            for (int i = 0; i < a.Lifts.Length; i++) Assert.AreEqual(a.Lifts[i].Stop, b.Lifts[i].Stop, "lift stop at tick " + tick);
            Assert.AreEqual(a.Passengers.Length, b.Passengers.Length, "published passenger count at tick " + tick);
            Assert.AreEqual(first.Services.Boarded, second.Services.Boarded, "boardings at tick " + tick);
            Assert.AreEqual(first.Services.Exited, second.Services.Exited, "exits at tick " + tick);
        }
        Assert.Greater(first.Services.Spawned, 0, "the run actually had a crowd to replay");
        Assert.Greater(first.Services.Boarded, 0, "and it actually boarded somebody");
    }

    static void AssertSamePassengers(StationPassengerFrame[] a, StationPassengerFrame[] b, int tick) {
        Assert.AreEqual(a.Length, b.Length, "passenger count at tick " + tick);
        for (int i = 0; i < a.Length; i++) {
            string at = "passenger " + a[i].SimId + " at tick " + tick;
            Assert.AreEqual(a[i].SimId, b[i].SimId, at + " id");
            Assert.AreEqual(a[i].X, b[i].X, 0, at + " x");
            Assert.AreEqual(a[i].Y, b[i].Y, 0, at + " y");
            Assert.AreEqual(a[i].Z, b[i].Z, 0, at + " z");
            Assert.AreEqual(a[i].Heading, b[i].Heading, 0, at + " heading");
            Assert.AreEqual(a[i].Activity, b[i].Activity, at + " activity");
            Assert.AreEqual(a[i].ActivitySeconds, b[i].ActivitySeconds, 0, at + " activity seconds");
            Assert.AreEqual(a[i].WalkDistance, b[i].WalkDistance, 0, at + " walk distance");
            Assert.AreEqual(a[i].WalkWeight, b[i].WalkWeight, 0, at + " walk weight");
            Assert.AreEqual(a[i].State, b[i].State, at + " state");
            Assert.AreEqual(a[i].ServerId, b[i].ServerId, at + " server");
        }
    }

    static void AssertSameGates(StationGateFrame[] a, StationGateFrame[] b, int tick) {
        Assert.AreEqual(a.Length, b.Length, "gate count at tick " + tick);
        for (int i = 0; i < a.Length; i++) {
            Assert.AreEqual(a[i].Id, b[i].Id, "gate id at tick " + tick);
            Assert.AreEqual(a[i].Queue, b[i].Queue, "gate queue at tick " + tick);
            Assert.AreEqual(a[i].Served, b[i].Served, "gate served at tick " + tick);
            Assert.AreEqual(a[i].State, b[i].State, "gate state at tick " + tick);
        }
    }

    // --------------------------------------------------------------- the gate

    [Test]
    public void GateAdmitsInArrivalOrderAndPublishesItsQueue() {
        var session = Session(GatePlatformDocument(), 0);
        var joinOrder = new List<int>();
        var servedOrder = new List<int>();
        var queued = new HashSet<int>();
        int lastServed = 0;
        int lastServiceTick = -1;
        var serviceGaps = new List<int>();
        for (int tick = 1; tick <= 90; tick++) {
            session.Advance(1.0);
            var frame = session.Snapshot();
            var gate = FindGate(frame, GateId);
            Assert.AreEqual("gate-1", gate.Id);
            Assert.AreEqual(1, gate.Batch, "a gate serves one passenger at a time");
            Assert.Greater(gate.Rate, 0, "the document's gate rate is published");

            var nowQueued = new HashSet<int>();
            for (int i = 0; i < frame.Passengers.Length; i++) {
                var passenger = frame.Passengers[i];
                if (passenger.State != StationPassengerState.Queuing || passenger.ServerId != "gate:" + GateId) continue;
                nowQueued.Add(passenger.SimId);
                if (!queued.Contains(passenger.SimId)) joinOrder.Add(passenger.SimId);
            }
            foreach (int id in queued) {
                if (nowQueued.Contains(id)) continue;
                servedOrder.Add(id);
                if (lastServiceTick >= 0) serviceGaps.Add(tick - lastServiceTick);
                lastServiceTick = tick;
            }
            Assert.AreEqual(nowQueued.Count, gate.Queue, "the published queue is the bodies queued at the gate (tick " + tick + ")");
            Assert.AreEqual(gate.Served, servedOrder.Count, "served counts every admitted passenger (tick " + tick + ")");
            Assert.GreaterOrEqual(gate.Served, lastServed, "served never goes backwards");
            lastServed = gate.Served;
            queued = nowQueued;
        }
        Assert.Greater(joinOrder.Count, 4, "the fixture built a real queue (" + joinOrder.Count + " joiners)");
        Assert.Greater(servedOrder.Count, 3, "and the gate actually admitted people (" + servedOrder.Count + ")");
        // FIFO: the gate's admissions are a prefix of the arrival order.
        for (int i = 0; i < servedOrder.Count; i++)
            Assert.AreEqual(joinOrder[i], servedOrder[i], "admission " + i + " is the passenger who queued " + i + "th");
        // The document's rate (25/min) is one passenger per 2.4 s: never two in one tick.
        for (int i = 0; i < serviceGaps.Count; i++)
            Assert.GreaterOrEqual(serviceGaps[i], 2, "a 25/min gate cannot admit twice within a second");
    }

    static StationGateFrame FindGate(StationMotionFrame frame, string id) {
        for (int i = 0; i < frame.Gates.Length; i++) if (frame.Gates[i].Id == id) return frame.Gates[i];
        Assert.Fail("no gate frame for " + id);
        return default;
    }

    // ------------------------------------------------------------ boarding

    [Test]
    public void BoardingOnlyHappensWhileTheDoorsAreActuallyOpen() {
        var session = Session(GatePlatformDocument(), 6);
        int boardings = 0;
        int ticksWithOpenDoors = 0;
        for (int tick = 0; tick < 70; tick++) {
            session.Advance(1.0);
            var frame = session.Snapshot();
            var doors = frame.Doors[0];
            bool wideOpen = doors.DoorFraction >= 1 - 1e-9;
            if (wideOpen) ticksWithOpenDoors++;
            if (session.Services.BoardingsThisTick <= 0) continue;
            boardings += session.Services.BoardingsThisTick;
            Assert.IsTrue(wideOpen, "a boarder was admitted at fraction " + doors.DoorFraction + " on tick " + (tick + 1));
            Assert.AreEqual(TrainPhase.Dwell, doors.TrainPhase, "boarding only in the dwell (tick " + (tick + 1) + ")");
            Assert.AreEqual(1.0, doors.DoorFraction, 1e-9, "the leaves are wide, not travelling");
        }
        Assert.Greater(ticksWithOpenDoors, 0, "the consist did open its doors");
        Assert.Greater(boardings, 0, "and the platform's queue got through");
        Assert.AreEqual(session.Services.Boarded, boardings, "every admission was counted exactly once");
        Assert.LessOrEqual(session.Services.Boarded, session.Snapshot().Trains[0].Capacity,
            "the consist never boards past its own capacity");
    }

    [Test]
    public void AlightingLeavesTheCabinBeforeBoardingStarts() {
        var session = Session(GatePlatformDocument(), 6);
        bool sawWave = false;
        bool sawAlighted = false;
        int firstBoardingTick = -1;
        for (int tick = 1; tick <= 70; tick++) {
            session.Advance(1.0);
            var frame = session.Snapshot();
            int alighting = 0;
            for (int i = 0; i < frame.Passengers.Length; i++)
                if (frame.Passengers[i].State == StationPassengerState.Alighting) alighting++;
            if (alighting > 0) sawWave = true;
            if (session.Services.Alighted > 0) sawAlighted = true;
            if (session.Services.BoardingsThisTick <= 0) continue;
            if (firstBoardingTick < 0) firstBoardingTick = tick;
            Assert.IsTrue(sawAlighted, "the wave left the cabin before the first boarder (tick " + tick + ")");
            Assert.AreEqual(0, alighting, "nobody is still stepping out when a boarder is admitted (tick " + tick + ")");
            Assert.AreEqual(0, session.Services.AlightInFlightFor(LineId, TrackId),
                "the consist's own doorway hand-over is clear (tick " + tick + ")");
        }
        Assert.IsTrue(sawWave, "a berth brings its alighting wave before the doors open");
        Assert.Greater(firstBoardingTick, 0, "boarding followed the alighting wave");
        Assert.GreaterOrEqual(session.Services.Alighted, 6, "the whole fixture wave stepped out");
    }

    // ------------------------------------------------- identity and lifecycle

    [Test]
    public void PassengerIdsSurvivePauseResumeSeekAndRestart() {
        var session = Session(GatePlatformDocument(), 0);
        Run(session, 25);
        var before = Ids(session);
        Assert.Greater(before.Count, 0, "there is a crowd to hold on to");

        session.SetPlaying(false);
        Assert.AreEqual(0, session.Advance(30.0), "a paused station steps nothing");
        CollectionAssert.AreEqual(before, Ids(session), "pause keeps every id");

        session.SetPlaying(true);
        session.Advance(1.0);
        var resumed = Ids(session);
        foreach (int id in before) Assert.Contains(id, resumed, "resuming keeps passenger " + id + " alive");

        var afterResume = Ids(session);
        session.SeekToSimTime(session.Clock.SimTime + 3600);
        CollectionAssert.AreEqual(afterResume, Ids(session), "a seek moves the clock, not the crowd");
        session.SeekToSimTime(session.Clock.SimTime - 7200);
        CollectionAssert.AreEqual(afterResume, Ids(session), "and seeks backwards just as safely");

        // Restart reseeds the stream and re-issues ids from 1; from the same instant
        // the whole run replays, so the very same people come back in the same order.
        session.SeekToSimTime(StationClock.ReferenceBootSeconds);
        session.Restart();
        Assert.AreEqual(0, Ids(session).Count, "restart empties the station");
        Assert.AreEqual(0, session.Services.Spawned, "and resets the run's counters");
        Run(session, 25);
        CollectionAssert.AreEqual(before, Ids(session), "the same seed replays the same identities after a restart");
    }

    static List<int> Ids(StationSimulationSession session) {
        var ids = new List<int>();
        var frames = session.PassengerFrames();
        for (int i = 0; i < frames.Length; i++) ids.Add(frames[i].SimId);
        ids.Sort();
        return ids;
    }

    // ----------------------------------------------------------------- lift

    [Test]
    public void APassengerOnALiftEdgeCallsTheCarAndRidesIt() {
        var session = Session(LiftOnlyDocument(), 0);
        bool sawCall = false;
        bool sawMoving = false;
        bool sawRider = false;
        bool sawUpperStop = false;
        for (int tick = 1; tick <= 120; tick++) {
            session.Advance(1.0);
            var frame = session.Snapshot();
            var lift = frame.Lifts[0];
            if (lift.Call >= 0) sawCall = true;
            if (lift.Phase == "move") sawMoving = true;
            if (lift.Stop == 1) sawUpperStop = true;
            for (int i = 0; i < frame.Passengers.Length; i++) {
                var passenger = frame.Passengers[i];
                if (passenger.Activity != StationPassengerActivity.Lift) continue;
                if (passenger.State != StationPassengerState.Riding) continue;
                sawRider = true;
                Assert.AreEqual(lift.Z, passenger.Z, 1e-9, "a rider is pinned to its car's floor");
                Assert.IsFalse(double.IsNaN(passenger.Z) || double.IsInfinity(passenger.Z));
            }
        }
        Assert.IsTrue(sawCall, "a passenger waiting for the lift published a call");
        Assert.IsTrue(sawMoving, "the called car moved off its parked stop");
        Assert.IsTrue(sawUpperStop, "the car travelled to the landing that called it");
        Assert.IsTrue(sawRider, "a passenger rode the car");
        Assert.Greater(session.Services.Boarded, 0, "and the lift delivered the crowd to the platform, where it boarded");
    }

    // --------------------------------------------------------------- no route

    [Test]
    public void DisconnectedStationSpawnsNoRouteAndStillAdvancesTheClock() {
        var session = Session(DisconnectedDocument(), 0);
        Run(session, 120);
        Assert.Greater(session.Services.Stuck, 0, "spawn attempts with no route are dropped, and counted");
        Assert.AreEqual(0, session.Services.Boarded, "nobody reached a consist");
        Assert.AreEqual(0, session.Services.WaitingFor(LineId, TrackId), "and nobody even reached a platform doorway");
        Assert.AreEqual(StationClock.ReferenceBootSeconds + 120, session.Clock.SimTime, 1e-6, "the clock ran all the same");
        Assert.AreEqual(120, session.Tick);
    }

    // ----------------------------------------------------------- the published

    [Test]
    public void PublishedPassengerPositionsAreFiniteAndInsideTheStation() {
        var session = Session(GatePlatformDocument(), 4);
        var graph = session.WalkGraph;
        Assert.IsNotNull(graph, "the fixture's document built a walk graph");
        int minZ = int.MaxValue, maxZ = int.MinValue;
        for (int i = 0; i < graph.LevelsZ.Length; i++) {
            if (graph.LevelsZ[i] < minZ) minZ = graph.LevelsZ[i];
            if (graph.LevelsZ[i] > maxZ) maxZ = graph.LevelsZ[i];
        }
        int seen = 0;
        for (int tick = 1; tick <= 70; tick++) {
            session.Advance(1.0);
            var frames = session.PassengerFrames();
            for (int i = 0; i < frames.Length; i++) {
                var frame = frames[i];
                seen++;
                Assert.IsFalse(double.IsNaN(frame.X) || double.IsInfinity(frame.X), "x is finite for " + frame.SimId);
                Assert.IsFalse(double.IsNaN(frame.Y) || double.IsInfinity(frame.Y), "y is finite for " + frame.SimId);
                Assert.IsFalse(double.IsNaN(frame.Z) || double.IsInfinity(frame.Z), "z is finite for " + frame.SimId);
                Assert.IsFalse(double.IsNaN(frame.Heading) || double.IsInfinity(frame.Heading), "heading is finite for " + frame.SimId);
                Assert.GreaterOrEqual(frame.X, graph.MinX - 1, "x inside the station");
                Assert.LessOrEqual(frame.X, graph.MaxX + 2, "x inside the station");
                Assert.GreaterOrEqual(frame.Y, graph.MinY - 1, "y inside the station");
                Assert.LessOrEqual(frame.Y, graph.MaxY + 2, "y inside the station");
                Assert.GreaterOrEqual(frame.Z, minZ - 1, "z inside the station");
                Assert.LessOrEqual(frame.Z, maxZ + 3, "z inside the station");
                Assert.IsTrue(frame.Visible);
            }
        }
        Assert.Greater(seen, 0, "the run published passengers to check");
    }

    [Test]
    public void SnapshotJsonCarriesBoundedPassengerAndGateArrays() {
        var options = new StationServiceOptions { AlightPerTrain = 4, PublishedPassengerLimit = 3, ExitInRatePerHour = 7200 };
        var session = Session(GatePlatformDocument(), 4, StationClock.ReferenceBootSeconds, options);
        Run(session, 25);
        Assert.Greater(session.PassengerFrames().Length, 3, "the station holds more passengers than the window");
        var json = JObject.Parse(session.SnapshotJson());
        var services = json["services"];
        Assert.IsNotNull(services, "the frame keeps its services block");
        Assert.IsNotNull(services["gates"], "gates are published");
        Assert.AreEqual(1, ((JArray)services["gates"]).Count, "one gate in the fixture");
        Assert.AreEqual("gate-1", (string)services["gates"][0]["id"]);
        Assert.IsNotNull(services["passengers"], "passengers are published");
        Assert.AreEqual(3, ((JArray)services["passengers"]).Count, "bounded to the configured window");
        Assert.AreEqual(session.PassengerFrames().Length, (int)json["crowd"]["passengers"], "the summary carries the true total");
        Assert.AreEqual(3, (int)json["crowd"]["published"], "and what the frame actually carried");
        var first = (JObject)services["passengers"][0];
        foreach (string key in new[] { "id", "x", "y", "z", "heading", "activity", "activitySeconds", "walkDistance", "walkPhase", "walkWeight", "state" })
            Assert.IsNotNull(first[key], "a published passenger carries " + key);
    }

    // ------------------------------------------------------------- the App feed

    [Test]
    public void AppFeedMapsEveryPublishedPassengerExactlyOnce() {
        var session = Session(GatePlatformDocument(), 4);
        Run(session, 30);
        var frames = session.PassengerFrames();
        Assert.Greater(frames.Length, 0, "the session published a crowd");
        var feed = new SessionPassengerFeed(session);
        var poses = new List<PassengerPose>();
        Assert.IsTrue(feed.TryRead(poses), "the committed feed answers with a frame");
        Assert.AreEqual(frames.Length, poses.Count, "one pose per published passenger");
        var seen = new HashSet<int>();
        var byId = new Dictionary<int, StationPassengerFrame>();
        for (int i = 0; i < frames.Length; i++) byId[frames[i].SimId] = frames[i];
        for (int i = 0; i < poses.Count; i++) {
            var pose = poses[i];
            Assert.IsTrue(seen.Add(pose.SimId), "passenger " + pose.SimId + " is mapped once");
            Assert.IsTrue(byId.TryGetValue(pose.SimId, out var frame), "the pose's id is a published passenger");
            Assert.AreEqual(frame.X, pose.X, 0, "x");
            Assert.AreEqual(frame.Y, pose.Y, 0, "y");
            Assert.AreEqual(frame.Z, pose.Z, 0, "z");
            Assert.AreEqual(frame.Heading, pose.Heading, 0, "heading");
            Assert.AreEqual((int)pose.Activity, (int)frame.Activity, "activity crosses the assembly unchanged");
            Assert.AreEqual(frame.ActivitySeconds, pose.ActivitySeconds, 0, "activity clock");
            Assert.AreEqual(frame.WalkDistance, pose.WalkDistance, 0, "walk distance");
            Assert.AreEqual(frame.WalkPhase, pose.WalkPhase, 0, "walk phase");
            Assert.AreEqual(frame.WalkWeight, pose.WalkWeight, 0, "walk weight");
            Assert.IsTrue(pose.Visible);
            Assert.AreEqual(PassengerDetail.Full, pose.Detail, "the view selects detail; the feed does not");
        }
        // A released/absent session publishes nothing and keeps the view's last frame.
        var absent = new SessionPassengerFeed(() => null);
        var held = new List<PassengerPose> { new PassengerPose { SimId = 99 } };
        Assert.IsFalse(absent.TryRead(held), "no session means no published crowd");
        Assert.AreEqual(99, held[0].SimId, "and the caller's last frame is untouched");
        // An empty station publishes an empty frame, which hides the actors.
        var empty = Session(DisconnectedDocument(), 0);
        var emptyFeed = new SessionPassengerFeed(empty);
        var emptyPoses = new List<PassengerPose> { new PassengerPose { SimId = 7 } };
        Assert.IsTrue(emptyFeed.TryRead(emptyPoses), "an empty station still publishes a (complete, empty) frame");
        Assert.AreEqual(0, emptyPoses.Count, "which clears the actors");
    }
}
