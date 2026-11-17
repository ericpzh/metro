using System;
using System.IO;
using Metro.Sim;
using NUnit.Framework;
using UnityEngine;

// Packet C · C2/C3 — the station session (`StationSimulationSession.cs`).
//
// Every clock expectation comes from `station-clock-oracle.json`, whose values are
// computed by `game/src/sim/clock.ts` itself, so a passing test means the C# clock
// agrees with the TypeScript source at that instant — not that it agrees with a
// second copy of the same arithmetic.
//
// The scheduling half pins what a station session has to get right beyond the
// arithmetic: the clock starts at REFERENCE_BOOT (06:30) and **is not a tick
// count**, speed multiplies ticks per real second, pause banks nothing, seek moves
// the instant without moving the tick, restart keeps the clock, closing service
// never stops the clock, and a station with no route at all still advances time.
public class StationSimulationSessionTests {
    // -------------------------------------------------------------- fixtures

    /// <summary>A small two-storey station: one line, one track, one platform edge, one escalator, one lift.</summary>
    public static StationSessionDocument ServiceDocument() {
        var document = new StationSessionDocument { StationId = "fixture-service", LevelBase = 0 };
        document.Lines.Add(new StationLineFact {
            Id = "line-1", Direction = "up", HeadwayPeak = 150, HeadwayOffpeak = 240, HeadwayLate = 480,
        });
        document.Modules.Add(new StationModuleFact {
            Id = "track-1", Type = "track", X = 0, Y = 0, Z = -15, Rot = 0, Width = 20, LineId = "line-1",
        });
        document.Modules.Add(new StationModuleFact {
            Id = "edge-1", Type = "platform-edge", X = 0, Y = 1, Z = -15, Rot = 0, LineId = "line-1",
            RailId = "track-1", Side = "right", Dir = "up",
        });
        document.Modules.Add(new StationModuleFact {
            Id = "esc-1", Type = "escalator", X = 0, Y = 0, Z = 0, Rot = 0,
            HasEndpoints = true, FromX = 0, FromY = 0, FromZ = 0, ToX = 0, ToY = 4, ToZ = -5, RunLength = 6,
        });
        document.Modules.Add(new StationModuleFact {
            Id = "lift-1", Type = "lift", X = 4, Y = 4, Z = -15, Rot = 0,
            HasEndpoints = true, FromX = 4, FromY = 4, FromZ = -15, ToX = 4, ToY = 4, ToZ = -5,
        });
        return document;
    }

    /// <summary>A station whose walkable floor shares no link with anything: no lines, no modules, no exits.</summary>
    public static StationSessionDocument DisconnectedDocument() {
        var document = new StationSessionDocument { StationId = "fixture-disconnected", LevelBase = 0 };
        // Two islands of floor, five storeys apart, with no stair/escalator between them.
        document.Cells.Add(new StationCellFact { X = 0, Y = 0, Z = 0, Solid = true, Zone = 0, Speed = 1 });
        document.Cells.Add(new StationCellFact { X = 0, Y = 0, Z = -20, Solid = true, Zone = 0, Speed = 1 });
        return document;
    }

    static StationSimulationSession Session(StationSessionDocument document = null, double startSimTime = StationClock.ReferenceBootSeconds) =>
        new StationSimulationSession(new StationSessionSetup {
            Document = document ?? ServiceDocument(),
            Day = StationClockTests.DayOf(StationClockTests.Instance().input),
            StartSimTime = startSimTime,
            Seed = 7654321,
        });

    static StationTrainFrame Train(StationMotionFrame frame, string id = "line-1|track-1") {
        for (int i = 0; i < frame.Trains.Length; i++) if (frame.Trains[i].Id == id) return frame.Trains[i];
        Assert.Fail("no train frame for " + id);
        return default;
    }

    // ------------------------------------------------------- oracle scenarios

    [Test]
    public void EveryOracleScenarioLandsOnTheSameClock() {
        var oracle = StationClockTests.Instance();
        Assert.GreaterOrEqual(oracle.scenarios.Length, 10, "the oracle carries the whole schedule set");
        foreach (var scenario in oracle.scenarios) {
            var day = StationClockTests.DayOf(StationClockTests.HasDay(scenario.input) ? scenario.input : oracle.input);
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = scenario.name == "disconnected" ? DisconnectedDocument() : ServiceDocument(),
                Day = day,
                StartSimTime = scenario.startSimTime,
                Seed = 7654321,
            });
            var start = session.Snapshot().Clock;
            StationClockTests.AssertFrame(scenario.frames[0], session.Clock.Stamp(), session.Clock.SimTime, session.Tick);
            Assert.AreEqual(scenario.frames[0].isOpen, start.ServiceOpen, scenario.name + " start serviceOpen");
            Assert.AreEqual(scenario.frames[0].demandRate, start.DemandRate, 1e-12, scenario.name + " start demandRate");

            for (int i = 0; i < scenario.steps.Length; i++) {
                var step = scenario.steps[i];
                switch (step.op) {
                    case "restart": session.Restart(); break;
                    case "seekDate": session.SeekToDate(step.year, step.month, step.day); break;
                    case "seekSim": session.SeekToSimTime(step.simTime); break;
                    default:
                        session.SetPlaying(step.playing);
                        if (step.speed > 0) Assert.IsTrue(session.SetSpeed(step.speed), scenario.name + " speed " + step.speed);
                        session.Advance(step.seconds);
                        break;
                }
                var expected = scenario.frames[i + 1];
                var stamp = session.Clock.Stamp();
                StationClockTests.AssertFrame(expected, stamp, session.Clock.SimTime, session.Tick);
                var clock = session.Snapshot().Clock;
                Assert.AreEqual(expected.isOpen, clock.ServiceOpen, scenario.name + " " + expected.label + " serviceOpen");
                Assert.AreEqual(expected.period, StationSimulationSession.PeriodText(clock.Period), scenario.name + " " + expected.label + " period");
                bool expectedPlaying = step.op == "play" ? step.playing : session.Playing;
                Assert.AreEqual(expectedPlaying, clock.Playing, scenario.name + " " + expected.label + " playing");
                Assert.AreEqual(expected.demandRate, clock.DemandRate, 1e-12, scenario.name + " " + expected.label + " demandRate");
            }
        }
    }

    [Test]
    public void ColdBootIs0630AndSimTimeIsNotATickCount() {
        var session = Session();
        var snapshot = session.Snapshot();
        Assert.AreEqual(23400.0, snapshot.Clock.SimTimeSeconds, 1e-12);
        Assert.AreEqual(0, snapshot.Clock.Tick);
        Assert.AreEqual("06:30:00", snapshot.Clock.ClockSeconds);
        Assert.AreEqual(0, snapshot.Clock.DayIndex);
        Assert.IsTrue(snapshot.Clock.ServiceOpen);
        Assert.IsFalse(snapshot.Clock.Playing, "a station opens paused");
        session.SetPlaying(true);
        session.Advance(10);
        var running = session.Snapshot().Clock;
        Assert.AreEqual(23410.0, running.SimTimeSeconds, 1e-12, "10 ticks at 1× advance 10 simulated seconds");
        Assert.AreEqual(10, running.Tick);
        Assert.AreEqual(23410.0 - 10.0, running.SimTimeSeconds - running.Tick, 1e-12,
            "simTime is seconds since day zero, not the tick counter the Zoo slice published");
        Assert.AreEqual("06:30:10", running.ClockSeconds);
    }

    [Test]
    public void SpeedMultipliesTicksPerRealSecondAndPauseBanksNothing() {
        var session = Session();
        session.SetPlaying(true);
        session.SetSpeed(4);
        Assert.AreEqual(4, session.Advance(1.0), "4× runs four ticks in one real second");
        Assert.AreEqual(23404.0, session.Clock.SimTime, 1e-12);
        session.SetSpeed(64);
        Assert.AreEqual(32, session.Advance(0.5), "64× runs 32 ticks in half a second");
        Assert.AreEqual(23436.0, session.Clock.SimTime, 1e-12);
        session.SetPlaying(false);
        Assert.AreEqual(0, session.Advance(5.0), "a paused station steps nothing");
        Assert.AreEqual(23436.0, session.Clock.SimTime, 1e-12);
        session.SetPlaying(true);
        session.SetSpeed(1);
        Assert.AreEqual(0, session.Advance(0.5), "resuming does not spend the paused seconds");
        Assert.AreEqual(23436.0, session.Clock.SimTime, 1e-12);
        Assert.AreEqual(1, session.Advance(0.5), "and half a banked tick plus another half is one tick");
        Assert.AreEqual(23437.0, session.Clock.SimTime, 1e-12);
    }

    [Test]
    public void UnsupportedSpeedsAreRejected() {
        var session = Session();
        Assert.IsTrue(session.SetSpeed(16));
        Assert.AreEqual(16, session.Speed);
        Assert.IsFalse(session.SetSpeed(0));
        Assert.IsFalse(session.SetSpeed(3));
        Assert.IsFalse(session.SetSpeed(-4));
        Assert.AreEqual(16, session.Speed, "a rejected speed leaves the run at the last legal one");
        foreach (int speed in StationSimConstants.SupportedSpeeds) Assert.IsTrue(StationSimulationSession.IsSupportedSpeed(speed));
    }

    [Test]
    public void SeekMovesTheClockAndKeepsTheTick() {
        var session = Session();
        session.SetPlaying(true);
        session.SetSpeed(4);
        session.Advance(2.0);
        long tick = session.Tick;
        Assert.AreEqual(8, tick);
        session.SeekToDate(2026, 1, 10);
        Assert.AreEqual(tick, session.Tick, "a seek is not elapsed simulation time");
        var stamp = session.Clock.Stamp();
        Assert.AreEqual("2026-01-10", stamp.DateKey);
        Assert.AreEqual("06:30:08", stamp.ClockSeconds, "the time of day is carried across the seek");
        Assert.AreEqual(9 * 86400 + 23408, session.Clock.SimTime, 1e-12);
        Assert.AreEqual(SimDayType.Offday, stamp.DayType, "a Saturday");
        // Backwards onto a date before day 0 is a real date, not a failure.
        session.SeekToDate(2025, 12, 25);
        Assert.AreEqual("2025-12-25", session.Clock.Stamp().DateKey);
        Assert.Less(session.Clock.SimTime, 0);
        Assert.AreEqual(tick, session.Tick);
    }

    [Test]
    public void RestartKeepsTheClockAndTheDocument() {
        var session = Session();
        session.SetPlaying(true);
        session.SetSpeed(16);
        session.Advance(3.0);
        double before = session.Clock.SimTime;
        long beforeTick = session.Tick;
        session.Restart();
        Assert.AreEqual(before, session.Clock.SimTime, 1e-12, "restart keeps the instant — it clears the crowd, not the day");
        Assert.AreEqual(beforeTick, session.Tick, "and the tick keeps counting");
        Assert.IsTrue(session.Playing, "the run stays in the state it was in");
        Assert.AreEqual(TrainPhase.None, Train(session.Snapshot()).Phase, "every consist is gone until the next dispatch");
        Assert.AreEqual(1, session.SessionRevision, "a restart is a derived-state rebuild");
        Assert.AreEqual(1, session.Snapshot().Doors.Length, "the document survives the restart");
    }

    [Test]
    public void ClosingServiceChangesDemandAndNeverStopsTheClock() {
        // This document's window shuts at 23:00. Start 30 s before it.
        var day = StationClockTests.DayOf(StationClockTests.Instance().input);
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = ServiceDocument(), Day = day,
            StartSimTime = StationClock.SimTimeAtDate(new SimDate(2026, 1, 6), day.Calendar.Epoch, 22 * 3600 + 59 * 60 + 30),
            Seed = 7654321,
        });
        session.SetPlaying(true);
        Assert.IsTrue(session.Clock.Stamp().IsOpen, "still open at 22:59:30");
        session.Advance(60);
        var stamp = session.Clock.Stamp();
        Assert.AreEqual("23:00:30", stamp.ClockSeconds);
        Assert.IsFalse(stamp.IsOpen, "the window shut 30 s ago");
        Assert.AreEqual(SimPeriod.Late, stamp.Period, "a shut station is 夜间");
        Assert.AreEqual(60, session.Tick, "the clock ran through the close");
        Assert.Greater(session.Clock.SimTime, 0);
        // The demand multiplier follows the period, so it changed — the clock did not stop.
        Assert.Less(session.Snapshot().Clock.DemandRate, 0.5);
        // One call per real second, the way a frame loop drives it (one call is capped at
        // 64 whole ticks, which a 600 s call would silently truncate).
        for (int i = 0; i < 10; i++) session.Advance(60);
        Assert.AreEqual("23:10:30", session.Clock.Stamp().ClockSeconds, "the clock keeps running while shut");
    }

    [Test]
    public void DisconnectedStationStillAdvancesTime() {
        var oracle = StationClockTests.Instance();
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = DisconnectedDocument(),
            Day = StationClockTests.DayOf(oracle.input),
            StartSimTime = StationClock.ReferenceBootSeconds,
            Seed = 7654321,
        });
        Assert.AreEqual(0, session.Snapshot().Trains.Length, "no lines, no consists");
        Assert.AreEqual(0, session.Snapshot().Escalators.Length);
        session.SetPlaying(true);
        session.SetSpeed(16);
        Assert.AreEqual(16, session.Advance(1.0), "a station nobody can walk through still has a clock");
        Assert.AreEqual(23416.0, session.Clock.SimTime, 1e-12);
        Assert.AreEqual("06:30:16", session.Clock.Stamp().ClockSeconds);
    }

    // ----------------------------------------------------------- C3 services

    [Test]
    public void TrainDispatchFollowsTheStopChoreography() {
        var session = Session();
        session.SetPlaying(true);
        Assert.AreEqual(TrainPhase.None, Train(session.Snapshot()).Phase, "no consist before the first dispatch");
        Assert.AreEqual(23400.0, Train(session.Snapshot()).NextDispatchSimTime, 1e-12, "dispatch is due at the boot instant");

        var seen = new System.Collections.Generic.List<(long tick, TrainPhase phase, double door)>();
        for (int i = 0; i < 60; i++) {
            session.Advance(1.0);
            var train = Train(session.Snapshot());
            seen.Add((session.Tick, train.Phase, train.DoorFraction));
        }
        // approach 6 s, berth 2 s, opening 2 s, dwell 30 s, closing 2 s, hold 5 s, depart 6 s.
        // The consist dispatches on the first tick and its phase clock advances in that
        // same tick, so approach is ticks 1-5 and berth starts at 6.
        AssertPhase(seen, 5, TrainPhase.Approach);
        AssertPhase(seen, 6, TrainPhase.Berth);
        AssertPhase(seen, 8, TrainPhase.Opening);
        AssertPhase(seen, 10, TrainPhase.Dwell);
        AssertPhase(seen, 39, TrainPhase.Dwell);
        AssertPhase(seen, 40, TrainPhase.Closing);
        AssertPhase(seen, 42, TrainPhase.Hold);
        AssertPhase(seen, 47, TrainPhase.Depart);
        AssertPhase(seen, 53, TrainPhase.None);
        // The leaves' commanded fraction: open over dwell, shut over the closing phase.
        Assert.AreEqual(0.0, seen[7].door, 1e-12, "the opening begins shut");
        Assert.AreEqual(0.5, seen[8].door, 1e-12, "opening travels over two seconds");
        Assert.AreEqual(1.0, seen[9].door, 1e-12, "dwell holds them wide");
        Assert.AreEqual(1.0, seen[38].door, 1e-12, "the last dwell second");
        Assert.AreEqual(1.0, seen[39].door, 1e-12, "the closing phase starts wide");
        Assert.AreEqual(0.5, seen[40].door, 1e-12, "and travels back over two seconds");
        Assert.AreEqual(0.0, seen[41].door, 1e-12, "sealed at the hold");
        // The next dispatch is the headway after the instant the consist was dispatched
        // (offpeak: 240 s here, and the dispatch happened on the first tick at 06:30:01).
        double next = Train(session.Snapshot()).NextDispatchSimTime;
        Assert.AreEqual(23401.0 + 240.0, next, 1e-12);
        Assert.AreEqual(next + 6 - 1 - session.Clock.SimTime, Train(session.Snapshot()).ArrivalSeconds[0], 1e-9,
            "the arrival forecast is measured from the snapshot instant");
    }

    static void AssertPhase(System.Collections.Generic.List<(long tick, TrainPhase phase, double door)> seen, long tick, TrainPhase phase) {
        for (int i = 0; i < seen.Count; i++) {
            if (seen[i].tick != tick) continue;
            Assert.AreEqual(phase, seen[i].phase, "phase at tick " + tick);
            return;
        }
        Assert.Fail("no frame at tick " + tick);
    }

    [Test]
    public void PlatformDoorsFollowTheBerthingConsist() {
        var session = Session();
        session.SetPlaying(true);
        for (int i = 0; i < 10; i++) session.Advance(1.0);
        var frame = session.Snapshot();
        Assert.AreEqual(1, frame.Doors.Length, "one platform edge in the fixture");
        Assert.AreEqual("edge-1", frame.Doors[0].PlatformId);
        Assert.AreEqual("line-1", frame.Doors[0].LineId);
        Assert.AreEqual("track-1", frame.Doors[0].TrackId);
        Assert.AreEqual(1.0, frame.Doors[0].DoorFraction, 1e-12, "the doors are wide open at the dwell");
        Assert.AreEqual(TrainPhase.Dwell, frame.Doors[0].TrainPhase);
        for (int i = 0; i < 32; i++) session.Advance(1.0);
        Assert.AreEqual(0.0, session.Snapshot().Doors[0].DoorFraction, 1e-12, "and shut once the consist is sealed");
    }

    [Test]
    public void EscalatorBandRollsAtTheSourceSpeed() {
        var session = Session();
        session.SetPlaying(true);
        session.Advance(1.0);
        var frame = session.Snapshot();
        Assert.AreEqual(1, frame.Escalators.Length);
        Assert.AreEqual("esc-1", frame.Escalators[0].Id);
        Assert.AreEqual(-1, frame.Escalators[0].Direction, "this run descends from→to, so its band rolls against the climb");
        Assert.AreEqual(0.5, frame.Escalators[0].Speed, 1e-12);
        // One tick rolls half a metre; wrapped into the six-metre run it stands at 5.5.
        Assert.AreEqual(5.5, frame.Escalators[0].PhaseMeters, 1e-9);
        for (int i = 0; i < 11; i++) session.Advance(1.0);
        Assert.AreEqual(0.0, session.Snapshot().Escalators[0].PhaseMeters, 1e-9, "twelve ticks roll exactly one full run");
        session.SetPlaying(false);
        double held = session.Snapshot().Escalators[0].PhaseMeters;
        session.Advance(4.0);
        Assert.AreEqual(held, session.Snapshot().Escalators[0].PhaseMeters, 1e-12, "paused, the band holds its pose");
    }

    [Test]
    public void LiftParksWithoutACrowd() {
        var session = Session();
        session.SetPlaying(true);
        for (int i = 0; i < 30; i++) session.Advance(1.0);
        var lift = session.Snapshot().Lifts[0];
        Assert.AreEqual("lift-1", lift.Id);
        Assert.AreEqual("idle", lift.Phase, "nobody called the car, so it parks — the source's own answer for an empty station");
        Assert.AreEqual(0.0, lift.DoorFraction, 1e-12);
        Assert.AreEqual(3, lift.StopCount, "−15, −10 and −5 m are the shaft's stops");
    }

    [Test]
    public void DocumentEditsRebuildDerivedStateAndKeepTheClock() {
        var session = Session();
        session.SetPlaying(true);
        session.Advance(5.0);
        double simTime = session.Clock.SimTime;
        Assert.AreEqual(1, session.Snapshot().Escalators.Length);

        var next = ServiceDocument();
        next.Modules.Add(new StationModuleFact {
            Id = "esc-2", Type = "escalator", X = 2, Y = 0, Z = 0, Rot = 0,
            HasEndpoints = true, FromX = 2, FromY = 0, FromZ = 0, ToX = 2, ToY = 4, ToZ = -5, RunLength = 6,
        });
        long revision = session.SessionRevision;
        session.ApplyDocument(next);
        Assert.AreEqual(simTime, session.Clock.SimTime, 1e-12, "an edit does not move the clock");
        Assert.AreEqual(revision + 1, session.SessionRevision);
        Assert.AreEqual(2, session.Snapshot().Escalators.Length, "the new run is in the derived state");
        Assert.AreEqual(3.5, session.Snapshot().Escalators[0].PhaseMeters, 1e-12, "an untouched run keeps its phase across the rebuild");
    }

    [Test]
    public void AuthoredDayEditShiftsPendingDispatchByTheHeadwayDelta() {
        var oracle = StationClockTests.Instance();
        var day = StationClockTests.DayOf(oracle.input);
        var session = Session();
        session.SetPlaying(true);
        session.Advance(1.0);
        double before = Train(session.Snapshot()).NextDispatchSimTime;
        // Make the instant a peak: the same document's peak headway is 150 s, offpeak 240 s.
        var peakDay = day;
        // Drop the fixture's holiday list so day 0 (2026-01-01, a Thursday) is a workday:
        // the peak window only applies to 工作日.
        peakDay.Calendar = new SimCalendar(day.Calendar.Epoch, new string[0]);
        peakDay.Service = new DaySpan(0, StationClock.ServiceLatest);
        peakDay.Peaks = new PeakSpans(new DaySpan(6 * 3600, 9 * 3600), day.Peaks.Late);
        session.ApplyDay(peakDay);
        Assert.AreEqual(SimPeriod.Peak, session.Clock.Period);
        double after = Train(session.Snapshot()).NextDispatchSimTime;
        Assert.AreEqual(Math.Max(session.Clock.SimTime, before + (150 - 240)), after, 1e-12,
            "the pending dispatch moves with the headway, not from a restart");
        Assert.AreEqual(23401.0, session.Clock.SimTime, 1e-12, "and the clock did not move");
    }

    // -------------------------------------------------------------- the JSON

    [Serializable] public sealed class SnapshotDto {
        public int schemaVersion;
        public string kind, sessionId;
        public long sessionRevision;
        public CapabilitiesDto capabilities;
        public ClockDto clock;
        public ServicesDto services;
    }
    [Serializable] public sealed class CapabilitiesDto {
        public bool clock, play, speed, seek, restart, serviceWindow;
        public bool trains, doors, escalators, lifts, crowd, gates, queues, boarding;
    }
    [Serializable] public sealed class ClockDto {
        public double simTimeSeconds;
        public int dayIndex, speed, weekday, timeOfDaySeconds, tick;
        public bool playing, serviceOpen, peak;
        public string period, dateKey, dayType, clock, clockSeconds;
        public double dayFraction, hourHandDegrees, minuteHandDegrees, demandRate;
        public SpanDto service;
        public SpanDto[] peaks;
    }
    [Serializable] public sealed class SpanDto { public int from, to; }
    [Serializable] public sealed class ServicesDto { public TrainDto[] trains; public EscalatorDto[] escalators; public LiftDto[] lifts; public DoorDto[] doors; }
    [Serializable] public sealed class TrainDto { public string id, lineId, trackId, phase; public double phaseSeconds, doorFraction, nextDispatchSimTime; }
    [Serializable] public sealed class EscalatorDto { public string id; public int direction; public double speed, phaseMeters, runLength; }
    [Serializable] public sealed class LiftDto { public string id, phase; public double doorFraction; public int stop, stopCount; }
    [Serializable] public sealed class DoorDto { public string platformId, lineId, trackId, trainPhase; public double doorFraction; }

    [Test]
    public void SnapshotJsonPublishesTheClockFirst() {
        var session = Session();
        string json = session.SnapshotJson();
        Assert.IsTrue(json.StartsWith("{\"schemaVersion\":2,\"kind\":\"simulation\""), "the envelope leads");
        var dto = JsonUtility.FromJson<SnapshotDto>(json);
        Assert.AreEqual(2, dto.schemaVersion);
        Assert.AreEqual("simulation", dto.kind);
        Assert.AreEqual("sim-1", dto.sessionId);
        Assert.AreEqual(23400.0, dto.clock.simTimeSeconds, 1e-12);
        Assert.AreEqual(0, dto.clock.tick);
        Assert.IsFalse(dto.clock.playing);
        Assert.AreEqual(1, dto.clock.speed);
        Assert.IsTrue(dto.clock.serviceOpen);
        Assert.IsFalse(dto.clock.peak);
        Assert.AreEqual("offpeak", dto.clock.period);
        Assert.AreEqual("2026-01-01", dto.clock.dateKey);
        Assert.AreEqual("offday", dto.clock.dayType);
        Assert.AreEqual("06:30:00", dto.clock.clockSeconds);
        Assert.AreEqual(18000, dto.clock.service.from, "this document's own window is 05:00-23:00");
        Assert.AreEqual(82800, dto.clock.service.to);
        Assert.AreEqual(21600, dto.clock.peaks[0].from, "this document's own morning peak is 06:00-08:30");
        Assert.AreEqual(30600, dto.clock.peaks[0].to);
        // Capabilities: the clock and service frames are real, and C3 now publishes the
        // crowd, the gate queues and boarding too (this document serves nobody, so the
        // counts are zero — that is a measured zero, not an invented one).
        Assert.IsTrue(dto.capabilities.clock);
        Assert.IsTrue(dto.capabilities.play);
        Assert.IsTrue(dto.capabilities.seek);
        Assert.IsTrue(dto.capabilities.restart);
        Assert.IsTrue(dto.capabilities.trains);
        Assert.IsTrue(dto.capabilities.crowd);
        Assert.IsTrue(dto.capabilities.gates);
        Assert.IsTrue(dto.capabilities.queues);
        Assert.IsTrue(dto.capabilities.boarding);
        Assert.AreEqual("line-1|track-1", dto.services.trains[0].id);
        Assert.AreEqual("track-1", dto.services.trains[0].trackId);
        Assert.AreEqual("esc-1", dto.services.escalators[0].id);
        Assert.AreEqual("lift-1", dto.services.lifts[0].id);
        Assert.AreEqual("edge-1", dto.services.doors[0].platformId);

        session.SetPlaying(true);
        session.Advance(1.0);
        var running = JsonUtility.FromJson<SnapshotDto>(session.SnapshotJson());
        Assert.IsTrue(running.clock.playing);
        Assert.AreEqual(1, running.clock.tick);
        Assert.AreEqual(23401.0, running.clock.simTimeSeconds, 1e-12);
        Assert.AreEqual("approach", running.services.trains[0].phase, "the consist dispatched on the first tick");
    }

    [Test]
    public void SessionIdsAreStableAcrossSnapshots() {
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = ServiceDocument(), Day = StationDayData.Default, SessionId = "s-7",
        });
        var first = session.Snapshot();
        session.SetPlaying(true);
        session.Advance(3.0);
        var second = session.Snapshot();
        Assert.AreEqual("s-7", first.SessionId);
        Assert.AreEqual(first.SessionId, second.SessionId);
        Assert.AreEqual(0, first.SessionRevision);
        Assert.AreEqual(0, second.SessionRevision, "a tick is not a document revision");
    }
}


