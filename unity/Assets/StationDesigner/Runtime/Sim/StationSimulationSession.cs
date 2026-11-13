using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Metro.Sim {
    // The station session ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â one clock, one scheduler, one set of service actors,
    // owned together so the player's station clock is the same number the world
    // runs on (plan 11 C2/C3).
    //
    // **Two numbers, never one.** `Tick` counts elapsed simulation steps (the
    // scheduler's own input); `Clock.SimTime` is seconds since the station's day
    // zero. The Zoo slice published `simTime = ticks` and started at 0, which is
    // why the React clock showed an invented time. Here the session starts at
    // `REFERENCE_BOOT` (06:30), advances the clock by `SimSecondsPerTick` per
    // step, and `SeekToDate` moves the clock without moving the tick ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â so the two
    // are visibly independent in every snapshot.
    //
    // Ordering follows `World.tickOnce` (game/src/sim/world/World.ts): advance the
    // instant, read the period once, then dispatch/step services from that
    // instant. The demand curve is the authored one (`StationClock.DemandRate`),
    // so closing service or finishing a cohort changes what the station spawns ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â
    // never whether the clock runs.
    //
    // Plain types only (Metro.Sim has no engine references): the integration layer
    // builds `StationSessionDocument`/`StationDayData` from packet A's document and
    // hands them in; the view layer consumes `StationMotionFrame`/`SnapshotJson`.
    //
    // Unported from C3 and reported by the frame's `capabilities`: crowd,
    // per-gate queues and admission, boarding/alighting, lift calls (a car only
    // moves when a passenger calls it, so without a crowd it parks ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â which is the
    // source's own answer for an empty station), and train berth poses from saved
    // track geometry.

    /// <summary>One simulated second per tick ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â <c>SIM_SECONDS_PER_TICK</c>.</summary>
    public static class StationSimConstants {
        public const double SimSecondsPerTick = 1.0;
        /// <summary>Train stop choreography, in simulated seconds (constants.ts).</summary>
        public const double TrainApproachSeconds = 6;
        public const double TrainBerthHold = 2;
        public const double TrainDoorTravel = 2;
        public const double TrainDwell = 30;
        public const double TrainDepartHold = 5;
        public const double TrainDepartSeconds = 6;
        /// <summary>Escalator running speed, m/s (constants.ts).</summary>
        public const double EscalatorSpeed = 0.5;
        /// <summary>A lift car's door travel, dwell and speed (constants.ts).</summary>
        public const double LiftDoorSeconds = 2;
        public const double LiftDwellSeconds = 6;
        public const double LiftSpeed = 1.5;
        /// <summary>Real seconds a service waits for the next consist after a stop, at least (`ticks()` floor).</summary>
        public static readonly int[] SupportedSpeeds = { 1, 4, 16, 64 };
    }

    /// <summary>A train's stop phase, in the order the source runs it.</summary>
    public enum TrainPhase { None = 0, Approach = 1, Berth = 2, Opening = 3, Dwell = 4, Closing = 5, Hold = 6, Depart = 7 }

    /// <summary>
    /// The session-scoped simulation commands the bridge accepts (`sim.*`, contract v2).
    /// None of them is a document edit, so none carries or increments a document
    /// revision; the host maps `{"type":"sim.play","payload":{"playing":true}}` onto
    /// <see cref="StationSimulationSession.TryApplyCommand"/>.
    /// </summary>
    public enum SimCommandKind {
        Play, Speed, Seek, Restart,
        /// <summary>Rejected by <see cref="StationSimulationSession.TryApplyCommand"/>.</summary>
        Unknown = -1,
    }

    /// <summary>One solid or floor cell, in document axes. Only what the session reads.</summary>
    public struct StationCellFact {
        public int X, Y, Z;
        public bool Solid;
        /// <summary>Zone index (Ãƒâ€šÃ‚Â§4.5), 0 = ÃƒÂ¦Ã¢â‚¬â€Ã‚Â ÃƒÂ¥Ã‹â€ Ã¢â‚¬Â ÃƒÂ¥Ã…â€™Ã‚Âº/outside as the document stores it.</summary>
        public int Zone;
        /// <summary>Floor-finish walk-speed multiplier at this cell (Ãƒâ€šÃ‚Â§4.3); 0 = not walkable (a track bed).</summary>
        public double Speed;
    }

    /// <summary>
    /// One document module, reduced to the facts the session's service layer reads.
    /// Packet A's document carries these; the integration adapter fills them.
    /// </summary>
    public struct StationModuleFact {
        public string Id, Type;
        public int X, Y, Z, Rot;
        /// <summary>Plan footprint in cells (a track's length, a booth's w/h, a gate's 1).</summary>
        public int Width, Depth, Height;
        /// <summary>A track / platform-edge / psd-end line binding (<c>cfg.line</c>).</summary>
        public string LineId;
        /// <summary>An exit's authored name (<c>cfg.name</c>); unused by other types.</summary>
        public string Name;
        /// <summary>An exit draws glass walls; a bare portal (<c>cfg.headHouse === false</c>) does not.</summary>
        public bool HeadHouse;
        /// <summary>A platform edge's own direction label (<c>cfg.dir</c>).</summary>
        public string Dir;
        /// <summary>A platform edge's side (<c>cfg.side</c>: left/right).</summary>
        public string Side;
        /// <summary>A module variant string the walk graph must distinguish (<c>cfg.variant</c>), e.g. `canopy`.</summary>
        public string Variant;
        /// <summary>The track module a platform edge boards (<c>cfg.from</c>).</summary>
        public string RailId;
        /// <summary>A gate's policy: -1 exit only, 0 both, 1 entry only (<c>cfg.dir</c>).</summary>
        public int GateDir;
        /// <summary>A gate's policy allows the crossing (<c>gateAllows</c>).</summary>
        public bool GateOpen;
        /// <summary>A gate has a lane; a doorless machine walls its cell instead.</summary>
        public bool GateHasLane;
        public bool Tunnel, Bridge;
        /// <summary>A stair placed as a solid block fills its anchor's headroom.</summary>
        public bool Block;
        /// <summary>Does this module carry authored <c>from</c>/<c>to</c> endpoints?</summary>
        public bool HasEndpoints;
        public int FromX, FromY, FromZ, ToX, ToY, ToZ;
        /// <summary>The moving band's chain length in metres for a ramp piece; 0 = unknown.</summary>
        public double RunLength;
    }

    /// <summary>One line's dispatch-relevant facts (<c>headwayProfile</c>).</summary>
    public struct StationLineFact {
        public string Id;
        /// <summary>The line's fallback direction label (<c>line.direction</c>).</summary>
        public string Direction;
        public double HeadwayPeak, HeadwayOffpeak, HeadwayLate;
        public double HeadwayFor(SimPeriod period) =>
            period == SimPeriod.Peak ? HeadwayPeak : period == SimPeriod.Offpeak ? HeadwayOffpeak : HeadwayLate;
    }

    /// <summary>
    /// The committed document, reduced to the session's inputs. Packet A owns the
    /// full document; this is the subset C2/C3 read, so the session never parses
    /// JSON and never holds a live document object.
    /// </summary>
    public sealed class StationSessionDocument {
        public string StationId = "";
        public int LevelBase;
        public List<StationCellFact> Cells = new List<StationCellFact>();
        public List<StationModuleFact> Modules = new List<StationModuleFact>();
        public List<StationLineFact> Lines = new List<StationLineFact>();

        /// <summary>
        /// The rails a line runs trains on: one consist per (line, track). Tunnel and
        /// bridge runs are extensions, not berths ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â unless the line owns nothing else
        /// (port of <c>World.serviceTracks</c>, document order).
        /// </summary>
        public List<StationModuleFact> ServiceTracks(string lineId) {
            var bound = new List<StationModuleFact>();
            for (int i = 0; i < Modules.Count; i++) {
                var m = Modules[i];
                if (m.Type == "track" && m.LineId == lineId) bound.Add(m);
            }
            var platforms = new List<StationModuleFact>();
            for (int i = 0; i < bound.Count; i++) if (!bound[i].Tunnel && !bound[i].Bridge) platforms.Add(bound[i]);
            return platforms.Count > 0 ? platforms : bound;
        }

        /// <summary>Platform edges bound to a (line, track) pair, document order.</summary>
        public List<StationModuleFact> PlatformEdges(string lineId, string trackId) {
            var result = new List<StationModuleFact>();
            for (int i = 0; i < Modules.Count; i++) {
                var m = Modules[i];
                if (m.Type != "platform-edge") continue;
                if (m.LineId != lineId) continue;
                if (string.IsNullOrEmpty(m.RailId)) continue;
                if (m.RailId == trackId) result.Add(m);
            }
            return result;
        }
    }

    /// <summary>How the session is started. All fields have source defaults.</summary>
    public sealed class StationSessionSetup {
        public StationSessionDocument Document;
        public StationDayData Day = StationDayData.Default;
        public uint Seed = 7654321;
        /// <summary>Seconds since day zero at cold boot. Default <c>REFERENCE_BOOT</c> (06:30).</summary>
        public double StartSimTime = StationClock.ReferenceBootSeconds;
        public bool StartPlaying;
        public int Speed = 1;
        public string SessionId = "sim-1";
        /// <summary>How the document becomes a walk graph; default = the shipped graph (street included).</summary>
        public StationWalkGraphOptions WalkOptions;
        /// <summary>The bounded service slice's own knobs; default = the source's own numbers.</summary>
        public StationServiceOptions Services;
    }

    // ------------------------------------------------------------------ frames

    /// <summary>The clock half of a frame ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â published first, keyed by nothing but the session.</summary>
    public struct StationClockFrame {
        public double SimTimeSeconds;
        public int DayIndex;
        public bool Playing;
        public int Speed;
        public bool ServiceOpen;
        public bool Peak;
        public SimPeriod Period;
        public string DateKey;
        public int Weekday;
        public SimDayType DayType;
        public int TimeOfDaySeconds;
        public double DayFraction;
        public string Clock;
        public string ClockSeconds;
        public double HourHandDegrees, MinuteHandDegrees;
        public long Tick;
        /// <summary>The operating hours and peaks the session is actually running.</summary>
        public DaySpan Service;
        public PeakSpans Peaks;
        /// <summary>The authored demand multiplier at this instant (not a measured crowd).</summary>
        public double DemandRate;
    }

    /// <summary>One consist's service state, keyed by <c>lineId|trackId</c>.</summary>
    public struct StationTrainFrame {
        public string Id, LineId, TrackId;
        public TrainPhase Phase;
        /// <summary>Seconds inside the current phase (<c>Train.t</c>).</summary>
        public double PhaseSeconds;
        /// <summary>Door leaves' commanded position, 0 shut ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ 1 fully open.</summary>
        public double DoorFraction;
        /// <summary>The absolute sim time the next consist dispatch is due.</summary>
        public double NextDispatchSimTime;
        /// <summary>The next three platform arrivals, seconds from the snapshot instant.</summary>
        public double[] ArrivalSeconds;
        public bool[] ArrivalAtPlatform;
        /// <summary>Rated load the platform run can board (the document's own consist length).</summary>
        public int Capacity;
        /// <summary>Passengers aboard this consist right now.</summary>
        public int Onboard;
    }

    /// <summary>One moving band (escalator or walkway), keyed by module id.</summary>
    public struct StationEscalatorFrame {
        public string Id;
        /// <summary>The travel direction the document authored: +1 along fromÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢to, -1 the reverse.</summary>
        public int Direction;
        public double Speed;
        /// <summary>Metres the band has rolled, wrapped into <see cref="RunLength"/> when known.</summary>
        public double PhaseMeters;
        public double RunLength;
    }

    /// <summary>One lift car, keyed by shaft module id. Without a crowd it parks (source behaviour).</summary>
    public struct StationLiftFrame {
        public string Id;
        public string Phase;
        public double DoorFraction;
        public int Stop;
        public int StopCount;
        /// <summary>The stop this car has been called to, or -1 when nobody is waiting.</summary>
        public int Call;
        /// <summary>The cabin floor's own elevation, in document metres.</summary>
        public double Z;
    }

    /// <summary>One platform edge's screen doors, keyed by its module id.</summary>
    public struct StationDoorFrame {
        public string PlatformId, LineId, TrackId;
        /// <summary>0 shut ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ 1 open, from the berthing consist's own phase.</summary>
        public double DoorFraction;
        public TrainPhase TrainPhase;
    }

    /// <summary>
    /// One snapshot of the session, keyed by stable document ids. Published whole on
    /// commit and as a coalesced state frame while running; the clock comes first.
    /// </summary>
    public struct StationMotionFrame {
        public string SessionId;
        public long SessionRevision;
        public StationClockFrame Clock;
        public StationTrainFrame[] Trains;
        public StationEscalatorFrame[] Escalators;
        public StationLiftFrame[] Lifts;
        public StationDoorFrame[] Doors;
        /// <summary>The crowd the station is serving, by stable simulation id (plan 11 C3).</summary>
        public StationPassengerFrame[] Passengers;
        /// <summary>The fare-gate servers' live queues, in document order.</summary>
        public StationGateFrame[] Gates;
        /// <summary>What this build of the session does not publish; see the class comment.</summary>
        public StationSessionCapabilities Capabilities;
    }

    /// <summary>
    /// Which parts of the frame a host can trust. A control whose capability is false
    /// must render unavailable rather than bind to a number nobody produces.
    /// </summary>
    public struct StationSessionCapabilities {
        public bool Clock, Play, Speed, Seek, Restart, ServiceWindow;
        public bool Trains, Doors, Escalators, Lifts;
        /// <summary>Crowd-scale state ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â false until the crowd and gate queues are ported.</summary>
        public bool Crowd, Gates, Queues, Boarding;
        public static StationSessionCapabilities Current => new StationSessionCapabilities {
            Clock = true, Play = true, Speed = true, Seek = true, Restart = true, ServiceWindow = true,
            Trains = true, Doors = true, Escalators = true, Lifts = true,
            Crowd = true, Gates = true, Queues = true, Boarding = true,
        };
    }

    // --------------------------------------------------------------- the session

    /// <summary>
    /// Owns the station clock, the tick scheduler and the service actors. The one
    /// entry point a host needs: construct with a committed document + authored day,
    /// call <see cref="Advance"/> with real elapsed seconds, read <see cref="Snapshot"/>.
    /// </summary>
    public sealed class StationSimulationSession {
        struct TrainRun {
            public string LineId, TrackId;
            public TrainPhase Phase;
            public double T;
        }

        struct EscalatorRun {
            public string Id;
            public int Direction;
            public double Phase;
            public double RunLength;
        }

        struct LiftRun {
            public string Id;
            public string Phase;
            public double Door;
            public int Stop;
            public int StopCount;
            public int[] Stops;
            public double Z;
            public int From;
            public int To;
            public double MoveT;
            public double MoveTotal;
            public double T;
            public int Call;
        }

        readonly SimulationScheduler scheduler = new SimulationScheduler();
        readonly List<TrainRun> trains = new List<TrainRun>();
        readonly List<EscalatorRun> escalators = new List<EscalatorRun>();
        readonly List<LiftRun> lifts = new List<LiftRun>();
        readonly Dictionary<string, double> nextDispatch = new Dictionary<string, double>();
        /// <summary>The (line, track) services the committed document runs, in document order, per line id.</summary>
        readonly Dictionary<string, List<string>> serviceTracks = new Dictionary<string, List<string>>();
        StationSessionDocument document;
        SimulationRng rng;
        uint seed;
        long tick;
        long sessionRevision;
        string sessionId;
        /// <summary>The bounded crowd/gate/boarding slice (plan 11 C3).</summary>
        readonly StationServiceRuntime services;
        readonly StationWalkGraphOptions walkOptions;
        StationWalkGraph walkGraph;

        public StationSimulationSession(StationSessionSetup setup) {
            if (setup == null) throw new ArgumentNullException(nameof(setup));
            sessionId = string.IsNullOrEmpty(setup.SessionId) ? "sim-1" : setup.SessionId;
            seed = setup.Seed;
            rng = new SimulationRng(seed);
            Clock = new StationClock(setup.Day, setup.StartSimTime);
            Speed = IsSupportedSpeed(setup.Speed) ? setup.Speed : 1;
            Playing = setup.StartPlaying;
            walkOptions = setup.WalkOptions ?? new StationWalkGraphOptions();
            services = new StationServiceRuntime(setup.Services);
            LoadDerived(setup.Document);
        }

        public StationClock Clock { get; }
        public long Tick => tick;
        public bool Playing { get; private set; }
        public int Speed { get; private set; }
        public string SessionId => sessionId;
        /// <summary>Bumped whenever derived state is rebuilt (a document or authored-day edit).</summary>
        public long SessionRevision => sessionRevision;
        public StationSessionDocument Document => document;
        /// <summary>The document-built walk graph the service layer routes on (null when the build refused).</summary>
        public StationWalkGraph WalkGraph => walkGraph;
        /// <summary>The bounded crowd/gate/boarding service layer (plan 11 C3).</summary>
        public StationServiceRuntime Services => services;
        /// <summary>The published passenger frames (empty when the station serves nobody).</summary>
        public StationPassengerFrame[] PassengerFrames() => services.PassengerFrames();
        /// <summary>The published gate servers' live queues, in document order.</summary>
        public StationGateFrame[] GateFrames() => services.GateFrames();

        public static bool IsSupportedSpeed(int speed) {
            for (int i = 0; i < StationSimConstants.SupportedSpeeds.Length; i++)
                if (StationSimConstants.SupportedSpeeds[i] == speed) return true;
            return false;
        }

        // ------------------------------------------------------------- lifecycle

        /// <summary>
        /// Play or pause. Pausing drops the scheduler's fractional second: a paused
        /// station must not bank time to spend the instant it resumes.
        /// </summary>
        public void SetPlaying(bool playing) {
            if (playing == Playing) return;
            Playing = playing;
            scheduler.Reset();
        }

        /// <summary>Set the speed multiplier. Returns false for anything but 1ÃƒÆ’Ã¢â‚¬â€/4ÃƒÆ’Ã¢â‚¬â€/16ÃƒÆ’Ã¢â‚¬â€/64ÃƒÆ’Ã¢â‚¬â€.</summary>
        public bool SetSpeed(int speed) {
            if (!IsSupportedSpeed(speed)) return false;
            if (speed == Speed) return true;
            Speed = speed;
            scheduler.Reset();
            return true;
        }

        /// <summary>
        /// Empty the actors without changing the station or the clock ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the source
        /// <c>World.restart()</c>. The clock keeps running from where it stood, the
        /// tick keeps counting, and the dispatch schedule re-staggers from now.
        /// </summary>
        public void Restart() {
            rng = new SimulationRng(seed);
            trains.Clear();
            scheduler.Reset();
            RebuildServices();
            services.Restart();
            sessionRevision++;
        }

        /// <summary>
        /// Move the clock to a whole date, keeping the time of day ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the ÃƒÂ¦Ã¢â‚¬â€Ã‚Â¶ÃƒÂ¥Ã‹â€ Ã‚Â» window's
        /// calendar pick (Ãƒâ€šÃ‚Â§7.9's scrub). The actors stay; the dispatch schedule is dropped
        /// so seeking backwards cannot stall every train until the clock comes round to
        /// that date again (source <c>World.seek</c>).
        /// </summary>
        public void SeekToDate(int year, int month, int day) {
            var stamp = Clock.Stamp();
            double timeOfDay = stamp.TimeOfDay + (stamp.SimTime - Math.Floor(stamp.SimTime));
            var date = new SimDate(year, month, day);
            Clock.Seek(StationClock.SimTimeAtDate(date, Clock.Calendar.Epoch, timeOfDay));
            nextDispatch.Clear();
            scheduler.Reset();
        }

        /// <summary>Move the clock to an absolute instant, seconds since day zero.</summary>
        public void SeekToSimTime(double simTimeSeconds) {
            Clock.Seek(simTimeSeconds);
            nextDispatch.Clear();
            scheduler.Reset();
        }

        /// <summary>
        /// Replace derived state for an edited document, keeping the crew: the source
        /// <c>rebuild()</c> path. Document data itself is never touched here ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â packet A's
        /// transaction owns the committed document and calls this after committing.
        /// </summary>
        public void ApplyDocument(StationSessionDocument next) {
            LoadDerived(next);
            sessionRevision++;
        }

        /// <summary>
        /// Replace the authored day (operating hours, peaks, demand curves, calendar) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â
        /// the source <c>updatePopulation</c> settings path. A headway change shifts the
        /// pending dispatches by the same delta instead of restarting them.
        /// </summary>
        public void ApplyDay(StationDayData day) {
            var oldService = Clock.Service;
            var oldPeaks = Clock.Peaks;
            var oldPeriod = StationClock.PeriodOf((long)Math.Floor(Clock.SimTime), oldService, oldPeaks, Clock.DayType == SimDayType.Workday);
            var oldHeadways = new Dictionary<string, double>();
            if (document != null) {
                for (int i = 0; i < document.Lines.Count; i++) {
                    var line = document.Lines[i];
                    oldHeadways[line.Id] = line.HeadwayFor(oldPeriod);
                }
            }
            Clock.SetDay(day);
            var newPeriod = Clock.Period;
            if (document != null) {
                for (int i = 0; i < document.Lines.Count; i++) {
                    var line = document.Lines[i];
                    double delta = line.HeadwayFor(newPeriod) - (oldHeadways.TryGetValue(line.Id, out double held) ? held : line.HeadwayFor(newPeriod));
                    if (delta == 0) continue;
                    var keys = new List<string>(nextDispatch.Keys);
                    for (int k = 0; k < keys.Count; k++) {
                        if (!keys[k].StartsWith(line.Id + "|", StringComparison.Ordinal)) continue;
                        double next = nextDispatch[keys[k]];
                        if (next > Clock.SimTime) nextDispatch[keys[k]] = Math.Max(Clock.SimTime, next + delta);
                    }
                }
            }
            sessionRevision++;
        }

        /// <summary>Load a different station document. A full reset: clock, tick, RNG and actors.</summary>
        public void LoadDocument(StationSessionDocument next, double startSimTime, uint newSeed) {
            seed = newSeed;
            rng = new SimulationRng(seed);
            tick = 0;
            Clock.Seek(startSimTime);
            Playing = false;
            scheduler.Reset();
            LoadDerived(next);
            sessionRevision++;
        }

        void LoadDerived(StationSessionDocument next) {
            document = next ?? new StationSessionDocument();
            RebuildServices();
            // The walk graph is derived from the committed document only: a rebuilt
            // station is a different graph, and a build that refuses (a disconnected
            // or absurd document) still leaves a clock that runs.
            walkGraph = null;
            try { walkGraph = StationWalkGraphBuilder.Build(document, walkOptions); }
            catch (Exception) { walkGraph = null; }
            services.Build(document, walkGraph, seed);
        }

        /// <summary>The source <c>rebuild()</c> tail: re-read the document's service actors and re-stagger dispatch.</summary>
        void RebuildServices() {
            // A rebuild keeps each band where it had rolled to: an edit that leaves a run
            // alone must not make its steps jump back to zero.
            var phases = new Dictionary<string, double>();
            for (int i = 0; i < escalators.Count; i++) phases[escalators[i].Id] = escalators[i].Phase;
            var cars = new Dictionary<string, LiftRun>();
            for (int i = 0; i < lifts.Count; i++) cars[lifts[i].Id ?? ""] = lifts[i];
            escalators.Clear();
            lifts.Clear();
            serviceTracks.Clear();
            if (document != null) {
                for (int i = 0; i < document.Modules.Count; i++) {
                    var m = document.Modules[i];
                    if (m.Type == "escalator" || m.Type == "walkway") {
                        // The graph edge and the band both travel fromÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢to; an ascending run
                        // rolls with a positive sign, a descending one against it
                        // (`buildRampBand`'s `dir`/`roll.dir`).
                        int direction = m.HasEndpoints && m.ToZ < m.FromZ ? -1 : 1;
                        escalators.Add(new EscalatorRun {
                            Id = m.Id, Direction = direction,
                            Phase = phases.TryGetValue(m.Id ?? "", out double held) ? held : 0,
                            RunLength = m.RunLength > 0 ? m.RunLength : 0,
                        });
                    } else if (m.Type == "lift") {
                        var stops = StationLiftStops.Levels(m);
                        LiftRun held;
                        bool known = cars.TryGetValue(m.Id ?? "", out held) && held.Stops != null && held.Stops.Length == stops.Count;
                        int stop = known ? Math.Max(0, Math.Min(stops.Count - 1, held.Stop)) : 0;
                        lifts.Add(new LiftRun {
                            Id = m.Id, Phase = known ? held.Phase : "idle",
                            Door = known ? held.Door : 0,
                            Stop = stop, StopCount = stops.Count,
                            Stops = stops.ToArray(),
                            Z = known ? held.Z : stops[stop],
                            From = known ? held.From : stop, To = known ? held.To : stop,
                            MoveT = known ? held.MoveT : 0, MoveTotal = known ? held.MoveTotal : 0,
                            T = known ? held.T : 0, Call = known ? held.Call : -1,
                        });
                    }
                }
                for (int i = 0; i < document.Lines.Count; i++) {
                    var line = document.Lines[i];
                    var tracks = document.ServiceTracks(line.Id);
                    var ids = new List<string>();
                    for (int t = 0; t < tracks.Count; t++) ids.Add(tracks[t].Id);
                    serviceTracks[line.Id] = ids;
                }
            }
            nextDispatch.Clear();
            if (document == null) return;
            double stagger = 0;
            for (int i = 0; i < document.Lines.Count; i++) {
                var line = document.Lines[i];
                var ids = serviceTracks[line.Id];
                if (ids.Count == 0) {
                    nextDispatch[ServiceKey(line.Id, "")] = Clock.SimTime + stagger;
                    stagger += 13;
                    continue;
                }
                for (int t = 0; t < ids.Count; t++) {
                    nextDispatch[ServiceKey(line.Id, ids[t])] = Clock.SimTime + stagger;
                    stagger += 13;
                }
            }
        }

        /// <summary>The floors a shaft serves between its endpoints, bottom ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ top (plain <c>liftLevels</c>).</summary>
        static List<int> LiftStopLevels(StationModuleFact m) => StationLiftStops.Levels(m);

        static string ServiceKey(string lineId, string trackId) => lineId + "|" + trackId;

        // -------------------------------------------------------------- advance

        /// <summary>
        /// Advance by real elapsed seconds at the current speed. Whole simulated ticks
        /// are stepped; the fractional remainder is kept for the next call. Returns the
        /// number of ticks actually stepped (0 while paused).
        ///
        /// Speed multiplies **ticks per real second**, never the step size: one tick is
        /// always <c>SIM_SECONDS_PER_TICK</c> simulated seconds, so a run at 4ÃƒÆ’Ã¢â‚¬â€ 16ÃƒÆ’Ã¢â‚¬â€ or
        /// 64ÃƒÆ’Ã¢â‚¬â€ crosses the same calendar in the same order (Ãƒâ€šÃ‚Â§7.6 determinism).
        /// </summary>
        public int Advance(double deltaSeconds) {
            if (!Playing) return 0;
            if (double.IsNaN(deltaSeconds) || double.IsInfinity(deltaSeconds) || deltaSeconds <= 0) return 0;
            return scheduler.Advance(deltaSeconds, Speed, StepOnce);
        }

        bool StepOnce() {
            tick++;
            // The clock advances by the tick's own simulated seconds ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â never by a tick
            // count and never by wall time.
            Clock.Advance(StationSimConstants.SimSecondsPerTick);
            StepServices();
            return true;
        }

        void StepServices() {
            var period = Clock.Period;
            StepTrains(period);
            StepEscalators();
            StepLifts();
            StepCrowd();
        }

        /// <summary>
        /// The crowd's tick, after the services it rides: the alighting wave of a
        /// consist that just berthed, street demand while the station is open, the
        /// gate/ride/doorway admission of queues that already exist, and every
        /// passenger's movement. No clock is read here that the frame will not
        /// publish; a paused station never reaches this method.
        /// </summary>
        void StepCrowd() {
            bool open = Clock.IsOpen;
            double demand = Clock.DemandRate(Clock.SimTime, Clock.DayType == SimDayType.Workday);
            services.Step(Clock.SimTime, open, demand, ServiceTrainFrames());
        }

        /// <summary>The consist states the service layer needs, without the arrival forecast.</summary>
        StationTrainFrame[] ServiceTrainFrames() {
            var frames = new List<StationTrainFrame>();
            if (document != null) {
                for (int i = 0; i < document.Lines.Count; i++) {
                    var line = document.Lines[i];
                    var ids = serviceTracks.TryGetValue(line.Id, out List<string> held) ? held : new List<string>();
                    if (ids.Count == 0) {
                        var active = ActiveTrain(line.Id, "");
                        frames.Add(new StationTrainFrame {
                            Id = ServiceKey(line.Id, ""), LineId = line.Id, TrackId = "",
                            Phase = active?.Phase ?? TrainPhase.None,
                            PhaseSeconds = active?.T ?? 0,
                            DoorFraction = active.HasValue ? DoorFractionOf(active.Value.Phase, active.Value.T) : 0,
                        });
                        continue;
                    }
                    for (int t = 0; t < ids.Count; t++) {
                        var active = ActiveTrain(line.Id, ids[t]);
                        frames.Add(new StationTrainFrame {
                            Id = ServiceKey(line.Id, ids[t]), LineId = line.Id, TrackId = ids[t],
                            Phase = active?.Phase ?? TrainPhase.None,
                            PhaseSeconds = active?.T ?? 0,
                            DoorFraction = active.HasValue ? DoorFractionOf(active.Value.Phase, active.Value.T) : 0,
                        });
                    }
                }
            }
            return frames.ToArray();
        }

        // ---------------------------------------------------------------- trains

        void StepTrains(SimPeriod period) {
            if (document == null) return;
            for (int i = 0; i < document.Lines.Count; i++) {
                var line = document.Lines[i];
                var ids = serviceTracks[line.Id];
                if (ids.Count == 0) {
                    MaybeDispatch(line, "", period);
                    continue;
                }
                for (int t = 0; t < ids.Count; t++) MaybeDispatch(line, ids[t], period);
            }

            for (int i = trains.Count - 1; i >= 0; i--) {
                var train = trains[i];
                train.T += StationSimConstants.SimSecondsPerTick;
                switch (train.Phase) {
                    case TrainPhase.Approach:
                        if (train.T >= StationSimConstants.TrainApproachSeconds) { train.Phase = TrainPhase.Berth; train.T = 0; }
                        break;
                    case TrainPhase.Berth:
                        // Held at the mark, doors shut, before they cycle. Boarding is a
                        // crowd behaviour and is not ported; the phase clock is.
                        if (train.T >= StationSimConstants.TrainBerthHold) { train.Phase = TrainPhase.Opening; train.T = 0; }
                        break;
                    case TrainPhase.Opening:
                        if (train.T >= StationSimConstants.TrainDoorTravel) { train.Phase = TrainPhase.Dwell; train.T = 0; }
                        break;
                    case TrainPhase.Dwell:
                        if (train.T >= StationSimConstants.TrainDwell) { train.Phase = TrainPhase.Closing; train.T = 0; }
                        break;
                    case TrainPhase.Closing:
                        if (train.T >= StationSimConstants.TrainDoorTravel) { train.Phase = TrainPhase.Hold; train.T = 0; }
                        break;
                    case TrainPhase.Hold:
                        if (train.T >= StationSimConstants.TrainDepartHold) { train.Phase = TrainPhase.Depart; train.T = 0; }
                        break;
                    case TrainPhase.Depart:
                        if (train.T >= StationSimConstants.TrainDepartSeconds) trains.RemoveAt(i);
                        else trains[i] = train;
                        continue;
                    default:
                        break;
                }
                trains[i] = train;
            }
        }

        void MaybeDispatch(StationLineFact line, string trackId, SimPeriod period) {
            string key = ServiceKey(line.Id, trackId);
            if (HasActiveTrain(line.Id, trackId)) return;
            double next = nextDispatch.TryGetValue(key, out double held) ? held : Clock.SimTime;
            if (Clock.SimTime < next) return;
            trains.Add(new TrainRun { LineId = line.Id, TrackId = trackId, Phase = TrainPhase.Approach, T = 0 });
            nextDispatch[key] = Clock.SimTime + line.HeadwayFor(period);
        }

        bool HasActiveTrain(string lineId, string trackId) {
            for (int i = 0; i < trains.Count; i++)
                if (trains[i].LineId == lineId && trains[i].TrackId == trackId) return true;
            return false;
        }

        TrainRun? ActiveTrain(string lineId, string trackId) {
            for (int i = 0; i < trains.Count; i++)
                if (trains[i].LineId == lineId && trains[i].TrackId == trackId) return trains[i];
            return null;
        }

        static double DoorFractionOf(TrainPhase phase, double t) {
            switch (phase) {
                case TrainPhase.Opening: return Clamp01(t / StationSimConstants.TrainDoorTravel);
                case TrainPhase.Dwell: return 1;
                case TrainPhase.Closing: return Clamp01(1 - t / StationSimConstants.TrainDoorTravel);
                default: return 0;
            }
        }

        static double Clamp01(double v) => v < 0 ? 0 : v > 1 ? 1 : v;

        // ------------------------------------------------------------ escalators

        void StepEscalators() {
            double dt = StationSimConstants.SimSecondsPerTick;
            for (int i = 0; i < escalators.Count; i++) {
                var run = escalators[i];
                run.Phase += run.Direction * StationSimConstants.EscalatorSpeed * dt;
                if (run.RunLength > 0) run.Phase = Wrap(run.Phase, run.RunLength);
                escalators[i] = run;
            }
        }

        static double Wrap(double v, double m) {
            if (m <= 0) return v;
            double r = v % m;
            return r < 0 ? r + m : r;
        }

        // ----------------------------------------------------------------- lifts

        void StepLifts() {
            // One car per shaft, the source's `stepLift`: idle until a passenger calls
            // it (or a rider still aboard wants its stop), travel eased from stop to
            // stop, open, exchange passengers while the doors are wide, shut, idle. An
            // empty station calls nobody, so the car still parks with its doors shut -
            // the source's own answer (`nextLiftCall` returns -1).
            const double dt = StationSimConstants.SimSecondsPerTick;
            for (int i = 0; i < lifts.Count; i++) {
                var car = lifts[i];
                switch (car.Phase) {
                    case "move": {
                        car.MoveT += dt;
                        double k = car.MoveTotal > 0 ? Math.Min(1, car.MoveT / car.MoveTotal) : 1;
                        double eased = k * k * (3 - 2 * k);
                        double fromZ = LiftZ(car, car.From), toZ = LiftZ(car, car.To);
                        car.Z = fromZ + (toZ - fromZ) * eased;
                        if (k >= 1) {
                            car.Stop = car.To;
                            car.Z = toZ;
                            car.Phase = "open";
                            car.T = 0;
                            car.Door = 0;
                        }
                        break;
                    }
                    case "open": {
                        if (car.Door < 1) {
                            car.Door = Math.Min(1, car.Door + dt / StationSimConstants.LiftDoorSeconds);
                        } else {
                            car.T += dt;
                            services.LiftExchange(car.Id, car.Stop);
                            if (car.T >= StationSimConstants.LiftDwellSeconds) { car.Phase = "close"; car.T = 0; }
                        }
                        break;
                    }
                    case "close": {
                        car.Door = Math.Max(0, car.Door - dt / StationSimConstants.LiftDoorSeconds);
                        if (car.Door <= 0) { car.Phase = "idle"; car.T = 0; car.Call = -1; }
                        break;
                    }
                    default: {
                        int call = services.NextLiftCall(car.Id, car.Stops);
                        car.Call = call;
                        if (call >= 0) {
                            if (call == car.Stop) {
                                car.Phase = "open";
                                car.T = 0;
                                car.Door = 0;
                            } else {
                                car.From = car.Stop;
                                car.To = call;
                                car.MoveT = 0;
                                car.MoveTotal = Math.Max(1.5,
                                    Math.Abs(LiftZ(car, call) - LiftZ(car, car.Stop)) / StationSimConstants.LiftSpeed);
                                car.Phase = "move";
                            }
                        }
                        break;
                    }
                }
                services.SyncLift(car.Id, car.Z, car.Door, car.Stop);
                lifts[i] = car;
            }
        }

        static double LiftZ(LiftRun car, int stop) {
            if (car.Stops == null || car.Stops.Length == 0) return car.Z;
            int at = stop < 0 ? 0 : stop >= car.Stops.Length ? car.Stops.Length - 1 : stop;
            return car.Stops[at];
        }

        // ---------------------------------------------------------------- frames

        public StationMotionFrame Snapshot() {
            var stamp = Clock.Stamp();
            var clock = new StationClockFrame {
                SimTimeSeconds = Clock.SimTime,
                DayIndex = stamp.DayIndex,
                Playing = Playing,
                Speed = Speed,
                ServiceOpen = stamp.IsOpen,
                Peak = stamp.Peak,
                Period = stamp.Period,
                DateKey = stamp.DateKey,
                Weekday = stamp.Weekday,
                DayType = stamp.DayType,
                TimeOfDaySeconds = stamp.TimeOfDay,
                DayFraction = stamp.DayFraction,
                Clock = stamp.Clock,
                ClockSeconds = stamp.ClockSeconds,
                HourHandDegrees = stamp.HourHandDegrees,
                MinuteHandDegrees = stamp.MinuteHandDegrees,
                Tick = tick,
                Service = Clock.Service,
                Peaks = Clock.Peaks,
                DemandRate = Clock.DemandRate(Clock.SimTime, stamp.DayType == SimDayType.Workday),
            };
            var trainFrames = new List<StationTrainFrame>();
            if (document != null) {
                for (int i = 0; i < document.Lines.Count; i++) {
                    var line = document.Lines[i];
                    var ids = serviceTracks.TryGetValue(line.Id, out List<string> held) ? held : new List<string>();
                    if (ids.Count == 0) {
                        trainFrames.Add(TrainFrame(line, ""));
                        continue;
                    }
                    for (int t = 0; t < ids.Count; t++) trainFrames.Add(TrainFrame(line, ids[t]));
                }
            }
            var escalatorFrames = new StationEscalatorFrame[escalators.Count];
            for (int i = 0; i < escalators.Count; i++) {
                var run = escalators[i];
                escalatorFrames[i] = new StationEscalatorFrame {
                    Id = run.Id, Direction = run.Direction, Speed = StationSimConstants.EscalatorSpeed,
                    PhaseMeters = run.Phase, RunLength = run.RunLength,
                };
            }
            var liftFrames = new StationLiftFrame[lifts.Count];
            for (int i = 0; i < lifts.Count; i++) {
                var car = lifts[i];
                liftFrames[i] = new StationLiftFrame {
                    Id = car.Id, Phase = car.Phase, DoorFraction = car.Door,
                    Stop = car.Stop, StopCount = car.StopCount, Call = car.Call, Z = car.Z,
                };
            }
            var doorFrames = DoorFrames();
            return new StationMotionFrame {
                SessionId = sessionId,
                SessionRevision = sessionRevision,
                Clock = clock,
                Trains = trainFrames.ToArray(),
                Escalators = escalatorFrames,
                Lifts = liftFrames,
                Doors = doorFrames,
                Passengers = services.PassengerFrames(),
                Gates = services.GateFrames(),
                Capabilities = StationSessionCapabilities.Current,
            };
        }

        StationTrainFrame TrainFrame(StationLineFact line, string trackId) {
            string key = ServiceKey(line.Id, trackId);
            var active = ActiveTrain(line.Id, trackId);
            double next = nextDispatch.TryGetValue(key, out double held) ? held : Clock.SimTime;
            var arrivals = new double[3];
            var atPlatform = new bool[3];
            ForecastArrivals(Clock.SimTime, next, active, line, arrivals, atPlatform);
            return new StationTrainFrame {
                Id = key,
                LineId = line.Id,
                TrackId = trackId,
                Phase = active?.Phase ?? TrainPhase.None,
                PhaseSeconds = active?.T ?? 0,
                DoorFraction = active.HasValue ? DoorFractionOf(active.Value.Phase, active.Value.T) : 0,
                NextDispatchSimTime = next,
                ArrivalSeconds = arrivals,
                ArrivalAtPlatform = atPlatform,
                Capacity = services.CapacityFor(line.Id, trackId),
                Onboard = services.OnboardFor(line.Id, trackId),
            };
        }

        /// <summary>Port of <c>serviceArrivals</c>: the next three platform arrivals without advancing the world.</summary>
        void ForecastArrivals(double now, double next, TrainRun? active, StationLineFact line, double[] seconds, bool[] atPlatform) {
            const double dt = StationSimConstants.SimSecondsPerTick;
            double freeAt = now + dt;
            double[] durations = {
                StationSimConstants.TrainApproachSeconds, StationSimConstants.TrainBerthHold,
                StationSimConstants.TrainDoorTravel, StationSimConstants.TrainDwell,
                StationSimConstants.TrainDoorTravel, StationSimConstants.TrainDepartHold,
                StationSimConstants.TrainDepartSeconds,
            };
            int slot = 0;
            if (active.HasValue) {
                int phase = (int)active.Value.Phase - 1;
                if (phase >= 0 && phase < durations.Length) {
                    freeAt = now + Ticks(durations[phase] - active.Value.T);
                    for (int i = phase + 1; i < durations.Length; i++) freeAt += Ticks(durations[i]);
                    freeAt += dt;
                    if (active.Value.Phase == TrainPhase.Approach) {
                        seconds[slot] = Ticks(StationSimConstants.TrainApproachSeconds - active.Value.T);
                        atPlatform[slot] = false; slot++;
                    } else if (active.Value.Phase != TrainPhase.Depart && active.Value.Phase != TrainPhase.None) {
                        seconds[slot] = 0; atPlatform[slot] = true; slot++;
                    }
                }
            }
            bool workday = Clock.DayType == SimDayType.Workday;
            double dispatch = Math.Max(now + Math.Max(dt, Ticks(next - now)), freeAt);
            double cycle = 0;
            for (int i = 0; i < durations.Length; i++) cycle += Ticks(durations[i]);
            while (slot < seconds.Length) {
                seconds[slot] = dispatch + Ticks(StationSimConstants.TrainApproachSeconds) - dt - now;
                atPlatform[slot] = false;
                slot++;
                // Re-read the real period at each forecast dispatch, as the source does.
                double headway = line.HeadwayFor(StationClock.PeriodOf((long)Math.Floor(dispatch), Clock.Service, Clock.Peaks, workday));
                dispatch += Math.Max(dt, Math.Max(Ticks(headway), cycle));
            }
        }

        static double Ticks(double seconds) => Math.Max(0, Math.Ceiling(seconds / StationSimConstants.SimSecondsPerTick)) * StationSimConstants.SimSecondsPerTick;

        StationDoorFrame[] DoorFrames() {
            var frames = new List<StationDoorFrame>();
            if (document == null) return frames.ToArray();
            for (int i = 0; i < document.Modules.Count; i++) {
                var edge = document.Modules[i];
                if (edge.Type != "platform-edge") continue;
                var active = ActiveTrain(edge.LineId, edge.RailId);
                double fraction = active.HasValue ? DoorFractionOf(active.Value.Phase, active.Value.T) : 0;
                frames.Add(new StationDoorFrame {
                    PlatformId = edge.Id, LineId = edge.LineId, TrackId = edge.RailId,
                    DoorFraction = fraction, TrainPhase = active?.Phase ?? TrainPhase.None,
                });
            }
            return frames.ToArray();
        }

        // ------------------------------------------------------------------ json

        /// <summary>
        // ------------------------------------------------------------------ commands

        /// <summary>
        /// Apply one session-scoped simulation command. The host parses the envelope and
        /// the payload's plain fields; this decides what they mean. Returns false with a
        /// stable <paramref name="rejectCode"/> when the command cannot be applied - the
        /// bridge turns that into a `reject` ack (`unsupported-speed`, `invalid-seek`).
        /// A rejected command never changes the run.
        /// </summary>
        public bool TryApplyCommand(SimCommandKind kind, bool playing, double value, out string rejectCode) {
            rejectCode = null;
            switch (kind) {
                case SimCommandKind.Play:
                    SetPlaying(playing);
                    return true;
                case SimCommandKind.Speed:
                    if (double.IsNaN(value) || double.IsInfinity(value)) { rejectCode = "invalid-speed"; return false; }
                    if (!SetSpeed((int)Math.Round(value))) { rejectCode = "unsupported-speed"; return false; }
                    return true;
                case SimCommandKind.Seek:
                    if (double.IsNaN(value) || double.IsInfinity(value)) { rejectCode = "invalid-seek"; return false; }
                    SeekToSimTime(value);
                    return true;
                case SimCommandKind.Restart:
                    Restart();
                    return true;
                default:
                    rejectCode = "unsupported-command";
                    return false;
            }
        }

        /// <summary>The bridge envelope's command type for a `sim.*` command; unknown types are the host's reject.</summary>
        public static SimCommandKind CommandFromType(string type) {
            switch (type) {
                case "sim.play": return SimCommandKind.Play;
                case "sim.speed": return SimCommandKind.Speed;
                case "sim.seek": return SimCommandKind.Seek;
                case "sim.restart": return SimCommandKind.Restart;
                default: return SimCommandKind.Unknown;
            }
        }

        // ------------------------------------------------------------------ json

        /// <summary>
        /// The clock object alone - exactly the `payload.clock` a bridge `state` reply
        /// carries, so the React shell can print the station's clock without receiving the
        /// document or the service arrays. `simTimeSeconds` (seconds since the station's
        /// day zero), `dayIndex`, `playing`, `speed`, `serviceOpen` and `peak` lead; the
        /// readout facts the panels also want follow. Never a tick count as time.
        /// </summary>
        public string ClockPayloadJson() {
            var sb = new StringBuilder(512);
            ClockJson(sb, Snapshot().Clock);
            return sb.ToString();
        }

        /// <summary>
        /// The capability block alone - exactly the `payload.simulationCapabilities` a
        /// bridge `state` reply carries beside `payload.clock`, so the React shell can
        /// offer only the transport this session actually honours. It is the same block
        /// <see cref="SnapshotJson"/> publishes, serialized without building a frame:
        /// no crowd, no services, no passengers. `sessionId` identifies the session the
        /// flags describe, so a shell that switches stations cannot keep the old one's.
        /// </summary>
        public string CapabilitiesPayloadJson() {
            var sb = new StringBuilder(384);
            sb.Append("{\"sessionId\":");
            Str(sb, sessionId);
            sb.Append(',');
            CapabilitiesBody(sb, StationSessionCapabilities.Current);
            sb.Append('}');
            return sb.ToString();
        }

        /// The whole frame as JSON ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the payload the bridge publishes. Clock first, then
        /// services keyed by stable document id, then the capability block. Numbers are
        /// round-trip formatted so a consumer sees exactly the instantaneous value.
        /// </summary>
        public string SnapshotJson() {
            var frame = Snapshot();
            var sb = new StringBuilder(4096);
            sb.Append("{\"schemaVersion\":2,\"kind\":\"simulation\",\"sessionId\":");
            Str(sb, frame.SessionId);
            sb.Append(",\"sessionRevision\":").Append(frame.SessionRevision);
            sb.Append(",\"capabilities\":");
            CapabilitiesJson(sb, frame.Capabilities);
            sb.Append(",\"clock\":");
            ClockJson(sb, frame.Clock);
            sb.Append(",\"crowd\":{\"passengers\":").Append(frame.Passengers.Length)
              .Append(",\"published\":").Append(PublishedPassengers(frame.Passengers))
              .Append(",\"queued\":").Append(services.QueueTotal)
              .Append(",\"boarding\":").Append(services.Onboard)
              .Append(",\"spawned\":").Append(services.Spawned)
              .Append(",\"alighted\":").Append(services.Alighted)
              .Append(",\"exited\":").Append(services.Exited)
              .Append(",\"stuck\":").Append(services.Stuck)
              .Append(",\"gateQueue\":").Append(services.GateQueueTotal)
              .Append('}');
            sb.Append(",\"services\":{\"trains\":[");
            for (int i = 0; i < frame.Trains.Length; i++) { if (i > 0) sb.Append(','); TrainJson(sb, frame.Trains[i]); }
            sb.Append("],\"escalators\":[");
            for (int i = 0; i < frame.Escalators.Length; i++) { if (i > 0) sb.Append(','); EscalatorJson(sb, frame.Escalators[i]); }
            sb.Append("],\"lifts\":[");
            for (int i = 0; i < frame.Lifts.Length; i++) { if (i > 0) sb.Append(','); LiftJson(sb, frame.Lifts[i]); }
            sb.Append("],\"doors\":[");
            for (int i = 0; i < frame.Doors.Length; i++) { if (i > 0) sb.Append(','); DoorJson(sb, frame.Doors[i]); }
            sb.Append("],\"passengers\":[");
            int published = PublishedPassengers(frame.Passengers);
            for (int i = 0; i < published; i++) { if (i > 0) sb.Append(','); PassengerJson(sb, frame.Passengers[i]); }
            sb.Append("],\"gates\":[");
            for (int i = 0; i < frame.Gates.Length; i++) { if (i > 0) sb.Append(','); GateJson(sb, frame.Gates[i]); }
            sb.Append("]}}");
            return sb.ToString();
        }

        /// <summary>The bounded window of passengers a subscriber payload carries.</summary>
        int PublishedPassengers(StationPassengerFrame[] frames) {
            int limit = services.Options.PublishedPassengerLimit;
            if (limit <= 0 || frames.Length <= limit) return frames.Length;
            return limit;
        }


        internal static void ClockJson(StringBuilder sb, StationClockFrame clock) {
            sb.Append('{');
            sb.Append("\"simTimeSeconds\":"); Num(sb, clock.SimTimeSeconds);
            sb.Append(",\"dayIndex\":").Append(clock.DayIndex);
            sb.Append(",\"playing\":").Append(clock.Playing ? "true" : "false");
            sb.Append(",\"speed\":").Append(clock.Speed);
            sb.Append(",\"serviceOpen\":").Append(clock.ServiceOpen ? "true" : "false");
            sb.Append(",\"peak\":").Append(clock.Peak ? "true" : "false");
            sb.Append(",\"period\":");
            Str(sb, PeriodText(clock.Period));
            sb.Append(",\"dateKey\":");
            Str(sb, clock.DateKey);
            sb.Append(",\"weekday\":").Append(clock.Weekday);
            sb.Append(",\"dayType\":");
            Str(sb, clock.DayType == SimDayType.Workday ? "workday" : "offday");
            sb.Append(",\"timeOfDaySeconds\":").Append(clock.TimeOfDaySeconds);
            sb.Append(",\"dayFraction\":"); Num(sb, clock.DayFraction);
            sb.Append(",\"clock\":");
            Str(sb, clock.Clock);
            sb.Append(",\"clockSeconds\":");
            Str(sb, clock.ClockSeconds);
            sb.Append(",\"hourHandDegrees\":"); Num(sb, clock.HourHandDegrees);
            sb.Append(",\"minuteHandDegrees\":"); Num(sb, clock.MinuteHandDegrees);
            sb.Append(",\"tick\":").Append(clock.Tick);
            sb.Append(",\"service\":{\"from\":").Append(clock.Service.From).Append(",\"to\":").Append(clock.Service.To).Append('}');
            sb.Append(",\"peaks\":[{\"from\":").Append(clock.Peaks.Early.From).Append(",\"to\":").Append(clock.Peaks.Early.To)
              .Append("},{\"from\":").Append(clock.Peaks.Late.From).Append(",\"to\":").Append(clock.Peaks.Late.To).Append("}]");
            sb.Append(",\"demandRate\":"); Num(sb, clock.DemandRate);
            sb.Append('}');
        }

        public static string PeriodText(SimPeriod period) =>
            period == SimPeriod.Peak ? "peak" : period == SimPeriod.Offpeak ? "offpeak" : "late";

        public static string TrainPhaseText(TrainPhase phase) {
            switch (phase) {
                case TrainPhase.Approach: return "approach";
                case TrainPhase.Berth: return "berth";
                case TrainPhase.Opening: return "opening";
                case TrainPhase.Dwell: return "dwell";
                case TrainPhase.Closing: return "closing";
                case TrainPhase.Hold: return "hold";
                case TrainPhase.Depart: return "depart";
                default: return "none";
            }
        }

        static void CapabilitiesJson(StringBuilder sb, StationSessionCapabilities c) {
            sb.Append('{');
            CapabilitiesBody(sb, c);
            sb.Append('}');
        }

        /// <summary>The capability object's members, without the surrounding braces.</summary>
        static void CapabilitiesBody(StringBuilder sb, StationSessionCapabilities c) {
            sb.Append("\"clock\":").Append(B(c.Clock));
            sb.Append(",\"play\":").Append(B(c.Play));
            sb.Append(",\"speed\":").Append(B(c.Speed));
            sb.Append(",\"seek\":").Append(B(c.Seek));
            sb.Append(",\"restart\":").Append(B(c.Restart));
            sb.Append(",\"serviceWindow\":").Append(B(c.ServiceWindow));
            sb.Append(",\"trains\":").Append(B(c.Trains));
            sb.Append(",\"doors\":").Append(B(c.Doors));
            sb.Append(",\"escalators\":").Append(B(c.Escalators));
            sb.Append(",\"lifts\":").Append(B(c.Lifts));
            sb.Append(",\"crowd\":").Append(B(c.Crowd));
            sb.Append(",\"gates\":").Append(B(c.Gates));
            sb.Append(",\"queues\":").Append(B(c.Queues));
            sb.Append(",\"boarding\":").Append(B(c.Boarding));
        }

        static void TrainJson(StringBuilder sb, StationTrainFrame t) {
            sb.Append("{\"id\":");
            Str(sb, t.Id);
            sb.Append(",\"lineId\":");
            Str(sb, t.LineId);
            sb.Append(",\"trackId\":");
            Str(sb, t.TrackId);
            sb.Append(",\"phase\":");
            Str(sb, TrainPhaseText(t.Phase));
            sb.Append(",\"phaseSeconds\":"); Num(sb, t.PhaseSeconds);
            sb.Append(",\"doorFraction\":"); Num(sb, t.DoorFraction);
            sb.Append(",\"nextDispatchSimTime\":"); Num(sb, t.NextDispatchSimTime);
            sb.Append(",\"capacity\":").Append(t.Capacity);
            sb.Append(",\"onboard\":").Append(t.Onboard);
            sb.Append(",\"arrivals\":[");
            if (t.ArrivalSeconds != null) {
                for (int i = 0; i < t.ArrivalSeconds.Length; i++) {
                    if (i > 0) sb.Append(',');
                    sb.Append("{\"seconds\":"); Num(sb, t.ArrivalSeconds[i]);
                    sb.Append(",\"atPlatform\":").Append(t.ArrivalAtPlatform != null && t.ArrivalAtPlatform[i] ? "true" : "false").Append('}');
                }
            }
            sb.Append("]}");
        }

        static void EscalatorJson(StringBuilder sb, StationEscalatorFrame e) {
            sb.Append("{\"id\":");
            Str(sb, e.Id);
            sb.Append(",\"direction\":").Append(e.Direction);
            sb.Append(",\"speed\":"); Num(sb, e.Speed);
            sb.Append(",\"phaseMeters\":"); Num(sb, e.PhaseMeters);
            sb.Append(",\"runLength\":"); Num(sb, e.RunLength);
            sb.Append('}');
        }

        static void LiftJson(StringBuilder sb, StationLiftFrame l) {
            sb.Append("{\"id\":");
            Str(sb, l.Id);
            sb.Append(",\"phase\":");
            Str(sb, l.Phase);
            sb.Append(",\"doorFraction\":"); Num(sb, l.DoorFraction);
            sb.Append(",\"stop\":").Append(l.Stop);
            sb.Append(",\"stopCount\":").Append(l.StopCount);
            sb.Append('}');
        }

        static void DoorJson(StringBuilder sb, StationDoorFrame d) {
            sb.Append("{\"platformId\":");
            Str(sb, d.PlatformId);
            sb.Append(",\"lineId\":");
            Str(sb, d.LineId);
            sb.Append(",\"trackId\":");
            Str(sb, d.TrackId);
            sb.Append(",\"doorFraction\":"); Num(sb, d.DoorFraction);
            sb.Append(",\"trainPhase\":");
            Str(sb, TrainPhaseText(d.TrainPhase));
            sb.Append('}');
        }

        static void PassengerJson(StringBuilder sb, StationPassengerFrame p) {
            sb.Append("{\"id\":").Append(p.SimId);
            sb.Append(",\"x\":"); Num(sb, p.X);
            sb.Append(",\"y\":"); Num(sb, p.Y);
            sb.Append(",\"z\":"); Num(sb, p.Z);
            sb.Append(",\"heading\":"); Num(sb, p.Heading);
            sb.Append(",\"activity\":");
            Str(sb, StationServiceText.ActivityText(p.Activity));
            sb.Append(",\"activitySeconds\":"); Num(sb, p.ActivitySeconds);
            sb.Append(",\"walkDistance\":"); Num(sb, p.WalkDistance);
            sb.Append(",\"walkPhase\":"); Num(sb, p.WalkPhase);
            sb.Append(",\"walkWeight\":"); Num(sb, p.WalkWeight);
            sb.Append(",\"state\":");
            Str(sb, StationServiceText.PassengerStateText(p.State));
            sb.Append(",\"server\":");
            Str(sb, p.ServerId ?? "");
            sb.Append(",\"visible\":").Append(p.Visible ? "true" : "false");
            sb.Append('}');
        }

        static void GateJson(StringBuilder sb, StationGateFrame g) {
            sb.Append("{\"id\":");
            Str(sb, g.Id);
            sb.Append(",\"server\":").Append(g.Server);
            sb.Append(",\"node\":").Append(g.Node);
            sb.Append(",\"queue\":").Append(g.Queue);
            sb.Append(",\"served\":").Append(g.Served);
            sb.Append(",\"rate\":"); Num(sb, g.Rate);
            sb.Append(",\"batch\":").Append(g.Batch);
            sb.Append(",\"cycle\":").Append(g.Cycle);
            sb.Append(",\"state\":");
            Str(sb, StationServiceText.GateStateText(g.State));
            sb.Append(",\"mode\":");
            Str(sb, StationServiceText.GateModeText(g.Mode));
            sb.Append('}');
        }

        static string B(bool value) => value ? "true" : "false";

        static void Num(StringBuilder sb, double value) {
            if (double.IsNaN(value) || double.IsInfinity(value)) { sb.Append('0'); return; }
            if (value == Math.Floor(value) && Math.Abs(value) < 1e15) {
                sb.Append(((long)value).ToString(CultureInfo.InvariantCulture));
                return;
            }
            sb.Append(value.ToString("R", CultureInfo.InvariantCulture));
        }

        static void Str(StringBuilder sb, string value) {
            if (value == null) { sb.Append("null"); return; }
            sb.Append('"');
            for (int i = 0; i < value.Length; i++) {
                char c = value[i];
                switch (c) {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }
}


