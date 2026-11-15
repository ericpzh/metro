using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

// Packet C ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· C3 ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â the published service frames (`StationServiceRuntime`), the
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
    static StationSessionDocument GatePlatformDocument() {        var document = new StationSessionDocument { StationId = "fixture-c3-gate", LevelBase = 0 };
        for (int x = 0; x <= 11; x++)
            for (int y = 0; y <= 9; y++)
                document.Cells.Add(Cell(x, y, 0, 2));
        document.Cells.Add(Cell(12, 4, 0, 2));
        for (int x = 13; x <= 23; x++)
            for (int y = 3; y <= 5; y++)
                document.Cells.Add(Cell(x, y, 0, 3));
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

    /* ------------------------------------------- door identity (plan 18 §8) */

    /// <summary>
    /// 18 §8.1 — the source attributes each platform edge's doors to a track by
    /// `World.ts`'s rule, not by an exact `cfg.from` match: a valid `from` wins, otherwise
    /// the first service track with the edge's own direction, otherwise the first track.
    /// Requiring the saved id verbatim left every edge that named no track (or named one
    /// that had been moved away) with **no** service doors, so nobody could board or alight
    /// there.
    /// </summary>
    [Test]
    public void APlatformEdgeFindsItsTrackByTheSourceRuleNotByAnExactSavedId() {
        var document = new StationSessionDocument { StationId = "fixture-18-8", LevelBase = 0 };
        document.Modules.Add(new StationModuleFact {
            Id = "track-up", Type = "track", X = 0, Y = 0, Z = 0, Rot = 0, Width = 10, Depth = 1,
            LineId = LineId, Dir = "up",
        });
        document.Modules.Add(new StationModuleFact {
            Id = "track-down", Type = "track", X = 0, Y = 4, Z = 0, Rot = 0, Width = 10, Depth = 1,
            LineId = LineId, Dir = "down",
        });
        document.Modules.Add(new StationModuleFact {
            Id = "track-tunnel", Type = "track", X = 0, Y = 8, Z = 0, Rot = 0, Width = 10, Depth = 1,
            LineId = LineId, Dir = "up", Tunnel = true,
        });
        document.Modules.Add(new StationModuleFact {
            Id = "edge-bound", Type = "platform-edge", X = 0, Y = 1, Z = 0, Rot = 0, Width = 10,
            LineId = LineId, RailId = "track-down", Dir = "up",
        });
        document.Modules.Add(new StationModuleFact {
            Id = "edge-unbound", Type = "platform-edge", X = 0, Y = 5, Z = 0, Rot = 0, Width = 10,
            LineId = LineId, Dir = "down",
        });
        document.Modules.Add(new StationModuleFact {
            Id = "edge-stale", Type = "platform-edge", X = 0, Y = 9, Z = 0, Rot = 0, Width = 10,
            LineId = LineId, RailId = "track-deleted", Dir = "down",
        });
        document.Lines.Add(new StationLineFact {
            Id = LineId, Direction = "up", HeadwayPeak = 150, HeadwayOffpeak = 240, HeadwayLate = 480,
        });

        // A valid `from` wins, even when the edge's direction disagrees.
        Assert.AreEqual("track-down", StationServiceDoors.ResolveEdgeTrack(document,
            document.Modules[3], document.Lines[0], true), "a valid from binds that track");
        // No `from`: the first service track in the edge's own direction.
        Assert.AreEqual("track-down", StationServiceDoors.ResolveEdgeTrack(document,
            document.Modules[4], document.Lines[0], true), "an unbound edge takes its direction's track");
        // A `from` naming a track the line no longer has falls back the same way.
        Assert.AreEqual("track-down", StationServiceDoors.ResolveEdgeTrack(document,
            document.Modules[5], document.Lines[0], true), "a stale from falls back to the direction match");
        // The tunnel run is an extension: it is only a last resort.
        Assert.AreEqual("track-up", StationServiceDoors.ResolveEdgeTrack(document,
            new StationModuleFact { Id = "edge-any", Type = "platform-edge", LineId = LineId, Dir = "sideways" },
            document.Lines[0], true), "an unmatched direction takes the first platform track");

        // A line with no rail at all keeps the source's line-only service.
        var bare = new StationSessionDocument { StationId = "fixture-18-8-bare", LevelBase = 0 };
        bare.Lines.Add(new StationLineFact { Id = LineId, Direction = "up" });
        bare.Modules.Add(new StationModuleFact {
            Id = "edge-only", Type = "platform-edge", X = 0, Y = 0, Z = 0, Rot = 0, Width = 4, LineId = LineId,
        });
        Assert.AreEqual("", StationServiceDoors.ResolveEdgeTrack(bare, bare.Modules[0], bare.Lines[0], true),
            "a line with no track resolves to the line-only service");
        Assert.AreEqual(0, StationServiceDoors.ServiceTracks(bare, LineId).Count);
    }

    /// <summary>Two tracks of one line keep disjoint door sets on the real Zoo save.</summary>
    [Test]
    public void TheZooServiceAttributesEachPlatformEdgeToExactlyOneTrack() {
        var read = Metro.Persistence.StationDocumentReader.ReadFile("Assets/StationDesigner/Demos/zoo.metro.json");
        var document = StationSessionProjection.Document(read.Document, read.Index);
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = document,
            Day = StationDayData.Default, Seed = 7,
            StartSimTime = StationClock.ReferenceBootSeconds, StartPlaying = false,
            Services = new StationServiceOptions { Spawn = false },
        });
        var up = StationServiceDoors.ForService(document, session.WalkGraph, "5", "track-1", out var upNotes);
        var down = StationServiceDoors.ForService(document, session.WalkGraph, "5", "track-5", out var downNotes);
        Assert.Greater(up.Count, 0, "line 5's up track has doorways: " + string.Join(";", upNotes));
        Assert.Greater(down.Count, 0, "line 5's down track has doorways: " + string.Join(";", downNotes));
        Assert.IsFalse(up.Any(slot => string.Equals(slot.TrackId, "track-5", StringComparison.Ordinal)),
            "an up-platform doorway never belongs to the down service");
        Assert.IsFalse(down.Any(slot => string.Equals(slot.TrackId, "track-1", StringComparison.Ordinal)),
            "a down-platform doorway never belongs to the up service");
        Assert.AreEqual(up.Count + down.Count, up.Select(slot => slot.Node).Concat(down.Select(slot => slot.Node)).Distinct().Count(),
            "no walkable node carries doorways for both services");
    }

    /* ------------------------------------------- cabin pose (plan 18 §8.2) */

    /// <summary>
    /// `stock.ts:cabinSlot`, in scaled car units: two abreast either side of the doorway,
    /// rows snaking wall to wall and drifting one turn-step toward the cab each turn.
    /// </summary>
    [Test]
    public void ACabinSlotSnakesWallToWallFromItsDoorway() {
        var cadence = StationServiceCadence.CabinHalfWidth - StationServiceCadence.CabinDoorInset;
        // Row 0: the near wall, one pair-half either side of the doorway.
        StationTrainPose.CabinSlot(2.0, 1, -1, 0, out double x, out double y);
        Assert.AreEqual(2.0 - StationServiceCadence.CabinPairHalf, x, 1e-9, "row 0 stays on the doorway");
        Assert.AreEqual(cadence, y, 1e-9, "row 0 sits against the near wall");
        StationTrainPose.CabinSlot(2.0, -1, 1, 0, out x, out y);
        Assert.AreEqual(cadence, Math.Abs(y), 1e-9, "the far side mirrors the wall");
        // Row 4: 2.2 m of depth is one 1.8 m span plus 0.4 m, so the odd turn heads back.
        double depth = 4 * StationServiceCadence.CabinRowPitch;
        double turn = Math.Floor(depth / (cadence * 2));
        double within = depth - turn * (cadence * 2);
        StationTrainPose.CabinSlot(2.0, 1, -1, 4, out x, out y);
        Assert.AreEqual(2.0 - StationServiceCadence.CabinPairHalf +
            Math.Min(turn, StationServiceCadence.CabinMaxTurns) * StationServiceCadence.CabinTurnStep,
            x, 1e-9, "each turn drifts one step toward the cab");
        Assert.AreEqual(-cadence + within, y, 1e-9, "an odd turn heads back toward the doorway's skin");
        // The turn is capped so a full car of rows stays inside the stock.
        StationTrainPose.CabinSlot(0, 1, 1, StationServiceCadence.CabinMaxRows - 1, out x, out _);
        Assert.LessOrEqual(x, StationServiceCadence.CabinPairHalf +
            StationServiceCadence.CabinMaxTurns * StationServiceCadence.CabinTurnStep + 1e-9,
            "the drift never passes the last authored turn");
        // Pair-half displacement along the train is the source's 0.32 m.
        Assert.AreEqual(.32, StationServiceCadence.CabinPairHalf, 1e-9);
    }

    /// <summary>
    /// 18 §8.2 — a track-bound wave is seated **inside its car** and steps out along the
    /// train. The old runtime used the source's no-consist branch for every service: all
    /// rows packed against one platform node and the step displaced along document X, so a
    /// logically alighting passenger never visibly left a car. The discriminating check is
    /// the car frame: every cabin rider projects inside the stock's cabin half width, which
    /// a platform-node seat cannot do.
    /// </summary>
    [Test]
    public void ATrackBoundZooWaveIsSeatedInsideItsCar() {
        var read = Metro.Persistence.StationDocumentReader.ReadFile("Assets/StationDesigner/Demos/zoo.metro.json");
        var document = StationSessionProjection.Document(read.Document, read.Index);
        var line = document.Lines.First(candidate => candidate.Id == "5");
        Assert.IsTrue(StationTrainPose.TryBerth(document, line, true, "track-1",
            StationTrainPose.DefaultScale, out var berth, out var failure), "berth: " + failure);
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = document, Day = StationDayData.Default, Seed = 7654321,
            StartSimTime = StationClock.ReferenceBootSeconds, StartPlaying = true,
            Services = new StationServiceOptions { Spawn = false, AlightPerTrain = 200 },
        });
        double cabinHalf = StationServiceCadence.CabinHalfWidth;
        int riders = 0;
        for (int tick = 0; tick < 120 && riders == 0; tick++) {
            session.Advance(1.0);
            foreach (var passenger in session.Snapshot().Passengers) {
                if (!(passenger.ServerId ?? "").StartsWith("line:5|track-1", StringComparison.Ordinal)) continue;
                double dx = passenger.X - berth.X, dy = passenger.Y - berth.Y;
                double along = dx * berth.Fx + dy * berth.Fy;
                double across = -dx * berth.Fy + dy * berth.Fx;
                Assert.LessOrEqual(Math.Abs(across), cabinHalf + 1e-6,
                    "passenger " + passenger.SimId + " sits outside the car: across=" + across.ToString("0.###"));
                Assert.LessOrEqual(Math.Abs(along), berth.HalfLength + 1e-6,
                    "passenger " + passenger.SimId + " sits past the car ends: along=" + along.ToString("0.###"));
                Assert.AreEqual(berth.CabinFloorZ, passenger.Z, 1e-6,
                    "passenger " + passenger.SimId + " stands on the cabin floor");
                riders++;
            }
        }
        Assert.Greater(riders, 0, "the berth seated a wave inside the car");
        // The step out lands either side of the doorway's centre, along the train's facing.
        StationTrainPose.StepOutTarget(berth, 67.5, -2.0, -19.0, 1, out double toX, out double toY, out double toZ);
        Assert.AreEqual(67.5 + StationServiceCadence.CabinPairHalf * berth.Fx, toX, 1e-9);
        Assert.AreEqual(-2.0 + StationServiceCadence.CabinPairHalf * berth.Fy, toY, 1e-9);
        Assert.AreEqual(-19.0, toZ, 1e-9, "the step lands on the platform's own elevation");
        // A line-only service keeps the source's no-consist branch (there is no car to stand in).
        StationTrainPose.CabinWorldPos(null, 0, 0, 1, 0, out _, out _, out _);
        Assert.IsFalse(StationTrainPose.CabinWorldPos(null, 0, 0, 1, 0, out _, out _, out _),
            "no consist means no cabin slot");
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
                document.Cells.Add(Cell(x, y, 0, 2));
        for (int x = 0; x <= 7; x++)
            for (int y = 0; y <= 7; y++)
                document.Cells.Add(Cell(x, y, -5, 3));
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
                document.Cells.Add(Cell(x, y, 0, 2));
        for (int x = 0; x <= 3; x++)
            for (int y = 0; y <= 3; y++)
                document.Cells.Add(Cell(x, y, -10, 3));
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
    public void GateLaneCommitsAndPublishesTheLeafCurve() {
        var session = Session(GatePlatformDocument(), 0);
        Assert.AreEqual(3, session.Services.SeedGateRiders(GateId, 3), "three entry riders join the lane queue");
        int lane = 0;
        var open = new List<double>();
        Run(session, 8, frame => {
            Assert.AreEqual(1, frame.Gates.Length, "one fare gate in the fixture");
            lane = Math.Max(lane, frame.Gates[0].Lane);
            open.Add(frame.Gates[0].Open);
        });
        Assert.AreEqual(1, lane, "the two-way lane commits to the first arrival's direction");
        Assert.IsTrue(open.Any(value => value >= .99), "the published leaf curve opened the lane: " +
            string.Join(",", open.ConvertAll(value => value.ToString("0.###"))));
        Assert.Less(open[open.Count - 1], .5, "and shut again after the hold: " +
            string.Join(",", open.ConvertAll(value => value.ToString("0.###"))));
        Assert.GreaterOrEqual(session.Services.GateFrames()[0].Served, 3, "all three riders passed the lane");
    }

    [Test]
    public void SpawnCountScalesWithTheDemandCurve() {
        // The authored knob is the ÃƒÂ¦Ã¢â‚¬â€Ã‚Â¶ÃƒÂ¥Ã‹â€ Ã‚Â» slider's own range (0ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“2.5, clamped by the clock),
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
    public void BoardingOnlyHappensWhileTheDoorsAreActuallyOpeningOrOpen() {
        var session = Session(GatePlatformDocument(), 6);
        int boardings = 0;
        int ticksWithOpenDoors = 0;
        for (int tick = 0; tick < 70; tick++) {
            session.Advance(1.0);
            var frame = session.Snapshot();
            var doors = frame.Doors[0];
            bool leavesMoving = doors.TrainPhase == TrainPhase.Opening || doors.TrainPhase == TrainPhase.Dwell;
            if (doors.DoorFraction > 0) ticksWithOpenDoors++;
            if (session.Services.BoardingsThisTick <= 0) continue;
            boardings += session.Services.BoardingsThisTick;
            // The source opens a doorway as soon as its own wave clears, which can be while
            // the leaves are still travelling â€” never before they have started to move.
            Assert.IsTrue(leavesMoving, "a boarder was admitted while the doors were " + doors.TrainPhase + " on tick " + (tick + 1));
            Assert.Greater(doors.DoorFraction, 0, "the leaves have begun to open (tick " + (tick + 1) + ")");
        }
        Assert.Greater(ticksWithOpenDoors, 0, "the consist did open its doors");
        Assert.Greater(boardings, 0, "and the platform's queue got through");
        Assert.AreEqual(session.Services.Boarded, boardings, "every admission was counted exactly once");
        // The rated load is published, not enforced: the source's `boardRider` has no
        // capacity gate, so boarding is bounded by the platform queue and the doorway rate.
        Assert.GreaterOrEqual(session.Snapshot().Trains[0].Capacity, 1,
            "the service publishes the line's rated load");
    }

    [Test]
    public void EachDoorwayBoardsOnlyAfterItsOwnWaveHasCleared() {
        var session = Session(GatePlatformDocument(), 6);
        Assert.IsTrue(session.Services.TryDoorStates(LineId, TrackId, out var states), "the fixture has service doorways");
        var firstRelease = new Dictionary<int, int>();
        var firstBoard = new Dictionary<int, int>();
        var lastWave = new Dictionary<int, int>();
        int lastAlighting = 0;
        for (int tick = 1; tick <= 70; tick++) {
            session.Advance(1.0);
            Assert.IsTrue(session.Services.TryDoorStates(LineId, TrackId, out states));
            for (int d = 0; d < states.Length; d++) {
                if (states[d].Released && !firstRelease.ContainsKey(d)) firstRelease[d] = tick;
                if (states[d].CabinRows > 0 || states[d].InFlight > 0) lastWave[d] = tick;
                if (states[d].Boarded > 0 && !firstBoard.ContainsKey(d)) firstBoard[d] = tick;
            }
            lastAlighting = session.Services.Alighted;
        }
        Assert.Greater(firstBoard.Count, 0, "the platform's queue reached the consist");
        Assert.Greater(lastAlighting, 0, "the berth brought an alighting wave");
        foreach (var pair in firstBoard) {
            Assert.IsTrue(firstRelease.ContainsKey(pair.Key), "doorway " + pair.Key + " released before it boarded");
            Assert.GreaterOrEqual(pair.Value, firstRelease[pair.Key],
                "doorway " + pair.Key + " boards from its own hand-over tick, not before it");
            if (lastWave.TryGetValue(pair.Key, out int last))
                Assert.GreaterOrEqual(pair.Value, last,
                    "doorway " + pair.Key + " never admits while its own wave is still in it");
        }
        Assert.AreEqual(0, session.Services.AlightInFlightFor(LineId, TrackId), "the stop's wave finished");
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

    // ------------------------------------------ the TS service oracle (plan 16 Ãƒâ€šÃ‚Â§4)

    /// <summary>
    /// The source's stop, recorded by `tools/unity-parity/record-station-service.mjs`
    /// running `World.dispatchTrains` / `loadAlighting` / `stepAlighting` / `stepOut` /
    /// `boardRider` themselves on one Zoo Line 5 service. Every expectation below is that
    /// file's own answer, not a second implementation of the same arithmetic.
    /// </summary>
    static JObject ServiceOracle() {
        if (oracle != null) return oracle;
        string path = Path.Combine(Application.dataPath, "StationDesigner/Tests/EditMode/station-service-oracle.json");
        Assert.IsTrue(File.Exists(path), "the service oracle is missing: " + path);
        oracle = JObject.Parse(File.ReadAllText(path));
        return oracle;
    }
    static JObject oracle;

    static JObject ServiceCase(string name) {
        foreach (var item in (JArray)ServiceOracle()["cases"])
            if ((string)item["name"] == name) return (JObject)item;
        Assert.Fail("no service oracle case '" + name + "'");
        return null;
    }

    /// <summary>The recorded station, expanded into the session's plain document.</summary>
    static StationSessionDocument StationOf(JObject station) {
        var document = new StationSessionDocument { StationId = (string)station["name"], LevelBase = 0 };
        foreach (var rect in (JArray)station["cells"]) {
            int x0 = (int)rect["x0"], x1 = (int)rect["x1"], y0 = (int)rect["y0"], y1 = (int)rect["y1"];
            int z = (int)rect["z"];
            int zone = StationSessionProjection.ZoneIndex((string)rect["zone"]);
            for (int x = x0; x <= x1; x++)
                for (int y = y0; y <= y1; y++)
                    document.Cells.Add(Cell(x, y, z, zone));
        }
        foreach (var module in (JArray)station["modules"]) {
            var cfg = module["cfg"] as JObject ?? new JObject();
            document.Modules.Add(new StationModuleFact {
                Id = (string)module["id"], Type = (string)module["type"],
                X = (int)module["x"], Y = (int)module["y"], Z = (int)module["z"],
                Rot = module["rot"] == null ? 0 : (int)module["rot"],
                Width = module["w"] == null ? 1 : (int)module["w"],
                Depth = module["d"] == null ? 1 : (int)module["d"],
                Height = 1,
                LineId = (string)cfg["line"] ?? "",
                Dir = (string)cfg["dir"] ?? "",
                Side = (string)cfg["side"] ?? "",
                RailId = (string)cfg["from"] ?? "",
                Name = (string)cfg["name"] ?? "",
            });
        }
        var line = (JObject)station["line"];
        var headway = (JObject)line["headwayProfile"];
        document.Lines.Add(new StationLineFact {
            Id = (string)line["id"], Direction = (string)line["direction"],
            Stock = (string)line["stock"], Cars = (int)line["cars"],
            AlightPerTrain = (int)line["alightPerTrain"], AuthoredAlight = true, ModelScale = (double)line["modelScale"],
            HeadwayPeak = (double)headway["peak"], HeadwayOffpeak = (double)headway["offpeak"],
            HeadwayLate = (double)headway["late"],
        });
        return document;
    }

    static string TrackOf(JObject item) => ((string)item["serviceKey"]).Split('|')[1];

    static StationSimulationSession OracleSession(JObject item) {
        var station = (JObject)item["station"];
        var line = (JObject)station["line"];
        var session = new StationSimulationSession(new StationSessionSetup {
            Document = StationOf(station),
            Day = StationDayData.Default,
            Seed = 7654321,
            StartSimTime = StationClock.ReferenceBootSeconds,
            StartPlaying = true,
            // The recorded fixture is authored floor only (the recorder's graph rides on
            // `withGround`'s street, which the C# builder reports rather than re-derives).
            WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
            Services = new StationServiceOptions { Spawn = false, ExitInRatePerHour = 0 },
        });
        int riders = (int)item["ridersPerDoor"];
        if (riders > 0) session.Services.SeedDoorRiders((string)line["id"], TrackOf(item), riders);
        return session;
    }

    /// <summary>One tick's doorway facts, in the service's own doorway order.</summary>
    sealed class DoorRun {
        public int Tick;
        public StationServiceRuntime.StationServiceDoorState[] States = Array.Empty<StationServiceRuntime.StationServiceDoorState>();
        public TrainPhase Phase;
        public double PhaseSeconds;
        public int Boarded;
        public int Onboard;
        public int Alighted;
    }

    static List<DoorRun> RunService(StationSimulationSession session, int ticks) {
        string lineId = session.Document.Lines[0].Id;
        string trackId = session.Document.Modules.Find(m => m.Type == "track").Id;
        var runs = new List<DoorRun>();
        for (int i = 0; i < ticks; i++) {
            Assert.AreEqual(1, session.Advance(1.0), "fixed one-second ticks");
            Assert.IsTrue(session.Services.TryDoorStates(lineId, trackId, out var states), "the service has doorways");
            var train = session.Snapshot().Trains[0];
            runs.Add(new DoorRun {
                Tick = (int)session.Tick, States = states, Phase = train.Phase,
                PhaseSeconds = train.PhaseSeconds, Boarded = session.Services.Boarded,
                Onboard = session.Services.Onboard, Alighted = session.Services.Alighted,
            });
        }
        return runs;
    }

    static int FirstTick(List<DoorRun> runs, Func<DoorRun, bool> predicate) {
        for (int i = 0; i < runs.Count; i++) if (predicate(runs[i])) return runs[i].Tick;
        return -1;
    }

    [Test]
    public void TheZooLine5WaveIsStagedAndReleasedDoorForDoorLikeTheSource() {
        var item = ServiceCase("zoo-line-5-up");
        var session = OracleSession(item);
        var doorNodes = (JArray)item["doorNodes"];
        Assert.AreEqual((int)item["doorCount"], session.Services.DoorCountFor("5", "track-1"),
            "one service doorway per modelled passenger door, not one per platform cell");
        Assert.AreEqual(18, (int)item["doorCount"], "six L cars, three doors a side");
        Assert.AreEqual((int)item["capacity"], session.Snapshot().Trains[0].Capacity,
            "`trainRatedCapacity(line)`: the rated load the source publishes");

        var runs = RunService(session, 60);
        Assert.IsTrue(session.Services.TryDoorStates("5", "track-1", out var doors));
        for (int d = 0; d < doorNodes.Count; d++) {
            Assert.AreEqual((double)doorNodes[d]["x"], doors[d].X + .5, 1e-9, "doorway " + d + " cell x");
            Assert.AreEqual((double)doorNodes[d]["y"], doors[d].Y + .5, 1e-9, "doorway " + d + " cell y");
            Assert.AreEqual((double)doorNodes[d]["z"], doors[d].Z + 1, 1e-9, "doorway " + d + " cell z");
        }

        // The cabin depth each doorway is loaded with: two abreast per row, rows across
        // the whole consist first, so 200 over 18 doors is six rows on ten and five on eight.
        var doorRows = (JArray)item["doorRows"];
        int berthTick = FirstTick(runs, run => run.Phase == TrainPhase.Berth);
        Assert.AreEqual(6, berthTick, "the consist is at berth on the source's tick");
        var atBerth = runs[berthTick - 1];
        for (int d = 0; d < doorRows.Count; d++)
            Assert.AreEqual((int)doorRows[d], atBerth.States[d].CabinRows, "doorway " + d + " cabin rows");

        // Per doorway: when its first pair left the cabin, and when it was handed to boarders.
        foreach (var expected in (JArray)item["doorTimeline"]) {
            int d = (int)expected["door"];
            int firstRelease = -1, released = -1;
            for (int i = 1; i < runs.Count && (firstRelease < 0 || released < 0); i++) {
                if (firstRelease < 0 && runs[i].States[d].CabinRows < runs[i - 1].States[d].CabinRows) firstRelease = runs[i].Tick;
                if (released < 0 && runs[i].States[d].Released) released = runs[i].Tick;
            }
            Assert.AreEqual((int)expected["firstReleaseTick"], firstRelease, "doorway " + d + " first release tick");
            Assert.AreEqual((int)expected["releasedTick"], released, "doorway " + d + " handed to boarders");
        }

        // The phase timeline: the source's own dispatch/berth/opening/dwell/closing/hold/
        // depart ticks, from the transition log the phase loop itself writes.
        var phases = new List<string>();
        foreach (var transition in session.TrainTransitions) {
            if (!transition.ServiceId.StartsWith("5|", StringComparison.Ordinal)) continue;
            phases.Add(transition.Tick + ":" + StationSimulationSession.TrainPhaseText(transition.To) +
                (transition.Dispatch ? "*" : ""));
        }
        CollectionAssert.AreEqual(
            new[] { "1:approach*", "6:berth", "8:opening", "10:dwell", "40:closing", "42:hold", "47:depart" },
            phases, "the stop's phase timeline is the source's: dispatch, berth, open, dwell, close, hold, depart");

        // The wave: every step-out the source recorded crossed the platform, on the very
        // ticks it recorded them (one pair a doorway a tick until a doorway's rows are gone).
        var stepOuts = (JArray)item["stepOuts"];
        var expectedPerTick = new Dictionary<int, int>();
        foreach (var step in stepOuts) {
            int tick = (int)step["tick"];
            expectedPerTick[tick] = expectedPerTick.TryGetValue(tick, out int held) ? held + 1 : 1;
        }
        var actualPerTick = new Dictionary<int, int>();
        int crossings = 0;
        foreach (var run in runs) {
            int delta = run.Alighted - crossings;
            crossings = run.Alighted;
            if (delta > 0) actualPerTick[run.Tick] = delta;
        }
        Assert.AreEqual(expectedPerTick.Count, actualPerTick.Count, "the wave crosses on the source's ticks");
        foreach (var pair in expectedPerTick)
            Assert.AreEqual(pair.Value, actualPerTick.TryGetValue(pair.Key, out int held) ? held : 0,
                "step-outs at tick " + pair.Key);
        Assert.AreEqual((int)item["summary"]["alighted"], session.Services.Alighted, "alighted");
        Assert.AreEqual((int)item["summary"]["leftBehind"], session.Services.LeftBehind, "left behind");

        // The consist leaves the world on the source's own tick, and only then.
        var removed = FirstTick(runs, run => run.Phase == TrainPhase.None && run.Tick > berthTick);
        Assert.AreEqual((int)item["removedTick"], removed, "the consist leaves the world on the source's tick");
        Assert.AreEqual((int)item["removedTick"], (int)session.Tick - 7, "seven ticks after the last recorded one");
    }

    [Test]
    public void ZeroAlightersHandEveryDoorwayToTheBoardersOnTheOpeningTick() {
        var item = ServiceCase("zero-alighters");
        var session = OracleSession(item);
        Assert.AreEqual(0, session.Services.DoorCountFor("5", "track-1") - 18, "the same 18 doorways");
        var runs = RunService(session, 30);
        // Every doorway opened on the source's first opening tick (opening t = 1): with no
        // wave to clear, the doorway is handed to the boarders the moment its queue is empty.
        int releasedTick = FirstTick(runs, run => {
            for (int d = 0; d < run.States.Length; d++) if (!run.States[d].Released) return false;
            return true;
        });
        Assert.AreEqual(9, releasedTick, "the zero-alighter stop hands every doorway over on opening t=1");
        Assert.AreEqual(0, session.Services.AlightInFlightFor("5", "track-1"), "nobody is stepping out");
        Assert.AreEqual((int)item["summary"]["boarded"], session.Services.Boarded, "boarded");

        // The source's cooldown law, per doorway: two aboard on the release tick, one after.
        var expectedByDoor = new Dictionary<string, int>();
        foreach (var board in (JArray)item["boardings"])
            expectedByDoor[(int)board["tick"] + "/" + (int)board["door"]] = (int)board["count"];
        var actualByDoor = new Dictionary<string, int>();
        for (int i = 0; i < runs.Count; i++) {
            for (int d = 0; d < runs[i].States.Length; d++) {
                int boarded = runs[i].States[d].Boarded - (i > 0 ? runs[i - 1].States[d].Boarded : 0);
                if (boarded > 0) actualByDoor[runs[i].Tick + "/" + d] = boarded;
            }
        }
        foreach (var pair in expectedByDoor)
            Assert.AreEqual(pair.Value, actualByDoor.TryGetValue(pair.Key, out int held) ? held : 0,
                "boardings at tick/door " + pair.Key);
        Assert.AreEqual(expectedByDoor.Count, actualByDoor.Count,
            "no doorway boarded on a tick the source did not");
    }

    [Test]
    public void AnOppositeBankServiceKeepsItsOwnDoorwaysAndWholeWave() {
        var item = ServiceCase("opposite-bank");
        var session = OracleSession(item);
        Assert.AreEqual((int)item["doorCount"], session.Services.DoorCountFor("5", "track-5"), "the down track's own doors");
        Assert.AreEqual(2, (int)item["doorSides"], "the source's bank mask is the platform side, not the consist's +y");
        RunService(session, 60);
        Assert.AreEqual((int)item["summary"]["alighted"], session.Services.Alighted, "alighted");
        Assert.AreEqual((int)item["summary"]["boarded"], session.Services.Boarded, "boarded");
        Assert.AreEqual((int)item["summary"]["leftBehind"], session.Services.LeftBehind, "left behind");
    }

    [Test]
    public void ASaturatedCabinRidesOnAndCountsTheArrivalsItCouldNotGetOff() {        var item = ServiceCase("saturated-cabin");
        var session = OracleSession(item);
        var runs = RunService(session, 60);
        Assert.AreEqual(12, (int)item["doorRows"][0], "the cabin is loaded to its twelve rows");
        // The source bounds a doorway's alighting at 15 s: past it the doorway boards and
        // the rest of the wave rides on, counted rather than dropped in silence.
        foreach (var expected in (JArray)item["doorTimeline"])
            Assert.AreEqual(24, (int)expected["releasedTick"], "doorway " + (int)expected["door"] + " turns to boarding at 24");
        Assert.AreEqual(24, FirstTick(runs, run => {
            for (int d = 0; d < run.States.Length; d++) if (!run.States[d].Released) return false;
            return true;
        }), "every doorway turns to boarding on the same tick");
        Assert.AreEqual((int)item["summary"]["alighted"], session.Services.Alighted, "alighted");
        Assert.Greater(session.Services.LeftBehind, 0, "the wave the dwell could not clear is counted");
        Assert.AreEqual((int)item["summary"]["leftBehind"], session.Services.LeftBehind, "left behind");
        Assert.AreEqual(0, runs[runs.Count - 1].Onboard, "the saturated consist leaves with its riders");
    }
}
