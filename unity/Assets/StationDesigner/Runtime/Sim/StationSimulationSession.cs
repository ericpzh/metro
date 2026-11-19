using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Threading;

namespace Metro.Sim {
    // The station session — one clock, one scheduler, one set of service actors,
    // owned together so the player's station clock is the same number the world
    // runs on (plan 11 C2/C3).
    //
    // **Two numbers, never one.** `Tick` counts elapsed simulation steps (the
    // scheduler's own input); `Clock.SimTime` is seconds since the station's day
    // zero. The Zoo slice published `simTime = ticks` and started at 0, which is
    // why the React clock showed an invented time. Here the session starts at
    // `REFERENCE_BOOT` (06:30), advances the clock by `SimSecondsPerTick` per
    // step, and `SeekToDate` moves the clock without moving the tick — so the two
    // are visibly independent in every snapshot.
    //
    // Ordering follows `World.tickOnce` (game/src/sim/world/World.ts): advance the
    // instant, read the period once, then dispatch/step services from that
    // instant. The demand curve is the authored one (`StationClock.DemandRate`),
    // so closing service or finishing a cohort changes what the station spawns —
    // never whether the clock runs.
    //
    // Plain types only (Metro.Sim has no engine references): the integration layer
    // builds `StationSessionDocument`/`StationDayData` from packet A's document and
    // hands them in; the view layer consumes `StationMotionFrame`/`SnapshotJson`.
    //
    // Unported from C3 and reported by the frame's `capabilities`: crowd,
    // per-gate queues and admission, boarding/alighting, lift calls (a car only
    // moves when a passenger calls it, so without a crowd it parks — which is the
    // source's own answer for an empty station), and train berth poses from saved
    // track geometry.

    /// <summary>One simulated second per tick — <c>SIM_SECONDS_PER_TICK</c>.</summary>
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
        /// <summary>Zone index (§4.5), 0 = 付费区/outside as the document stores it.</summary>
        public int Zone;
        /// <summary>Floor-finish walk-speed multiplier at this cell (§4.3); 0 = not walkable (a track bed).</summary>
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
        public StationRidePath RidePath;
        public int RideColumns;
        /// <summary>Effective throughput width in metres/lanes for stairs and escalators (0 falls back to <see cref="Width"/>).</summary>
        public double RideWidth;
        /// <summary>Flight count for turning/switchback stairs (0/1 = single straight flight; matches web `stairFlights(m).length`).</summary>
        public int StairFlights;
        public Dictionary<int, int> LiftDoorMasks;
        public int[] LiftRises;
    }

    /// <summary>One line's dispatch-relevant facts (`headwayProfile`, stock, authored wave).</summary>
    public struct StationLineFact {
        public string Id;
        /// <summary>The line's fallback direction label (<c>line.direction</c>).</summary>
        public string Direction;
        public double HeadwayPeak, HeadwayOffpeak, HeadwayLate;
        /// <summary>The stock class the line runs (<c>line.stock</c>: A … D, L).</summary>
        public string Stock;
        /// <summary>The cars a consist carries (<c>line.cars</c>).</summary>
        public int Cars;
        /// <summary>
        /// The authored alighting wave per consist (<c>line.alightPerTrain</c>). Read only
        /// when <see cref="AuthoredAlight"/> is set, so a hand-built fixture that names no
        /// wave keeps <see cref="StationServiceOptions.AlightPerTrain"/> — and an authored
        /// 0 is an authored "nobody gets off here", not "unset".
        /// </summary>
        public int AlightPerTrain;
        /// <summary>True when the document authored <see cref="AlightPerTrain"/>.</summary>
        public bool AuthoredAlight;
        /// <summary>`line.modelScale`, the scale baked into the promoted consist.</summary>
        public double ModelScale;

        public static StationLineFact Default => new StationLineFact { AlightPerTrain = -1, ModelScale = 1 };

        public double HeadwayFor(SimPeriod period) =>
            period == SimPeriod.Peak ? HeadwayPeak : period == SimPeriod.Offpeak ? HeadwayOffpeak : HeadwayLate;

        /// <summary>`trainRatedCapacity(line)`: the rated load the frame publishes.</summary>
        public int RatedCapacity => StationServiceCadence.RatedCapacity(Stock, Cars);
    }

    /// <summary>
    /// The committed document, reduced to the session's inputs. Packet A owns the
    /// full document; this is the subset C2/C3 read, so the session never parses
    /// JSON and never holds a live document object.
    /// </summary>
    public sealed class StationSessionDocument {
        static readonly StationModuleFact[] EmptyModuleFacts = Array.Empty<StationModuleFact>();

        public string StationId = "";
        public int LevelBase;
        public List<StationCellFact> Cells = new List<StationCellFact>();
        public List<StationModuleFact> Modules = new List<StationModuleFact>();
        public List<StationLineFact> Lines = new List<StationLineFact>();

        internal Func<List<StationCellFact>> LazyCells;
        Dictionary<string, List<StationModuleFact>> cachedByType;
        Dictionary<string, int> cachedIndexById;
        List<StationModuleFact> cachedMovingBands;
        int cachedModulesCount = -1;
        int cachedIndexByIdSourceCount = -1;

        static bool IsIndexedSimModuleType(string t) =>
            t == "track" || t == "platform-edge" || t == "gate" || t == "lift" ||
            t == "road" || t == "escalator" || t == "walkway";

        internal List<StationCellFact> EnsureCells() {
            if ((Cells == null || Cells.Count == 0) && LazyCells != null) {
                Cells = LazyCells();
                LazyCells = null;
            }
            return Cells ?? (Cells = new List<StationCellFact>());
        }

        void EnsureModuleTypeIndex() {
            if (cachedByType != null && cachedModulesCount == Modules.Count) return;
            var map = new Dictionary<string, List<StationModuleFact>>(8, StringComparer.Ordinal);
            var bands = new List<StationModuleFact>();
            for (int i = 0; i < Modules.Count; i++) {
                var m = Modules[i];
                string t = m.Type ?? "";
                if (!IsIndexedSimModuleType(t)) continue;
                if (!map.TryGetValue(t, out var list)) map[t] = list = new List<StationModuleFact>();
                list.Add(m);
                if (t == "escalator" || t == "walkway") bands.Add(m);
            }
            cachedByType = map;
            cachedMovingBands = bands;
            cachedModulesCount = Modules.Count;
        }

        public IReadOnlyList<StationModuleFact> ModulesOfType(string type) {
            if (string.IsNullOrEmpty(type) || Modules == null || Modules.Count == 0) return EmptyModuleFacts;
            EnsureModuleTypeIndex();
            return cachedByType.TryGetValue(type, out var list) ? (IReadOnlyList<StationModuleFact>)list : EmptyModuleFacts;
        }

        internal IReadOnlyList<StationModuleFact> MovingBandsInOrder() {
            if (Modules == null || Modules.Count == 0) return EmptyModuleFacts;
            EnsureModuleTypeIndex();
            return cachedMovingBands;
        }

        /// <summary>
        /// Build a child <see cref="StationSessionDocument"/> from a bounded <see cref="StationSessionDelta"/>
        /// without scanning or copying untouched cell/module lists.
        /// </summary>
        public StationSessionDocument ApplyDelta(
            string stationId,
            int levelBase,
            StationSessionDelta delta,
            Func<List<StationCellFact>> lazyCellExport = null) {
            var next = new StationSessionDocument {
                StationId = stationId ?? StationId ?? "",
                LevelBase = levelBase,
                Lines = Lines,
                LazyCells = lazyCellExport ?? (() => EnsureCells()),
            };
            if (delta == null || !delta.HasModuleChanges) {
                EnsureModuleTypeIndex();
                next.Modules = Modules;
                next.cachedByType = cachedByType;
                next.cachedIndexById = cachedIndexById;
                next.cachedIndexByIdSourceCount = cachedIndexByIdSourceCount;
                next.cachedMovingBands = cachedMovingBands;
                next.cachedModulesCount = cachedModulesCount;
                return next;
            }
            if (delta.OrderedModules != null) {
                next.Modules = delta.OrderedModules;
                return next;
            }

            EnsureModuleTypeIndex();
            bool simBucketsChanged = false;
            Dictionary<string, StationModuleFact> changedById = null;
            if (delta.ChangedModules.Count > 0) {
                changedById = new Dictionary<string, StationModuleFact>(delta.ChangedModules.Count, StringComparer.Ordinal);
                for (int i = 0; i < delta.ChangedModules.Count; i++) {
                    var cm = delta.ChangedModules[i];
                    if (IsIndexedSimModuleType(cm.Type ?? "")) simBucketsChanged = true;
                    if (!string.IsNullOrEmpty(cm.Id)) changedById[cm.Id] = cm;
                }
            }
            if (!simBucketsChanged && cachedByType != null && (delta.RemovedModules.Count > 0 || changedById != null)) {
                foreach (var kv in cachedByType) {
                    var bucket = kv.Value;
                    for (int b = 0; b < bucket.Count; b++) {
                        string bid = bucket[b].Id ?? "";
                        if (changedById != null && changedById.ContainsKey(bid)) { simBucketsChanged = true; break; }
                        for (int r = 0; r < delta.RemovedModules.Count; r++) {
                            if (string.Equals(delta.RemovedModules[r], bid, StringComparison.Ordinal)) { simBucketsChanged = true; break; }
                        }
                        if (simBucketsChanged) break;
                    }
                    if (simBucketsChanged) break;
                }
            }

            if (delta.OrderedModuleIds != null) {
                if (cachedIndexById == null || cachedIndexByIdSourceCount != Modules.Count) {
                    var idMap = new Dictionary<string, int>(Modules.Count, StringComparer.Ordinal);
                    for (int i = 0; i < Modules.Count; i++) {
                        var m = Modules[i];
                        if (!string.IsNullOrEmpty(m.Id)) idMap[m.Id] = i;
                    }
                    cachedIndexById = idMap;
                    cachedIndexByIdSourceCount = Modules.Count;
                }
                var ids = delta.OrderedModuleIds;
                var orderedMods = new List<StationModuleFact>(ids.Length);
                for (int i = 0; i < ids.Length; i++) {
                    string id = ids[i] ?? "";
                    if (changedById != null && changedById.TryGetValue(id, out var cm)) {
                        orderedMods.Add(cm);
                    } else if (cachedIndexById.TryGetValue(id, out int oldIdx)) {
                        orderedMods.Add(Modules[oldIdx]);
                    }
                }
                next.Modules = orderedMods;
                if (!simBucketsChanged && cachedByType != null) {
                    next.cachedByType = cachedByType;
                    next.cachedMovingBands = cachedMovingBands;
                    next.cachedModulesCount = orderedMods.Count;
                }
                return next;
            }

            var removedSet = delta.RemovedModules.Count > 0
                ? new HashSet<string>(delta.RemovedModules, StringComparer.Ordinal)
                : null;

            var nextMods = new List<StationModuleFact>(Modules.Count + delta.ChangedModules.Count);
            HashSet<string> placedChanged = changedById != null ? new HashSet<string>(StringComparer.Ordinal) : null;
            for (int i = 0; i < Modules.Count; i++) {
                var m = Modules[i];
                string id = m.Id ?? "";
                if (removedSet != null && removedSet.Contains(id)) continue;
                if (changedById != null && changedById.TryGetValue(id, out var replacement)) {
                    nextMods.Add(replacement);
                    placedChanged.Add(id);
                } else {
                    nextMods.Add(m);
                }
            }
            if (delta.ChangedModules.Count > 0) {
                for (int i = 0; i < delta.ChangedModules.Count; i++) {
                    var cm = delta.ChangedModules[i];
                    string id = cm.Id ?? "";
                    if (placedChanged == null || !placedChanged.Contains(id)) {
                        nextMods.Add(cm);
                    }
                }
            }
            next.Modules = nextMods;
            if (!simBucketsChanged && cachedByType != null) {
                next.cachedByType = cachedByType;
                next.cachedMovingBands = cachedMovingBands;
                next.cachedModulesCount = nextMods.Count;
            }
            return next;
        }

        /// <summary>
        /// The rails a line runs trains on: one consist per (line, track). Tunnel and
        /// bridge runs are extensions, not berths — unless the line owns nothing else
        /// (port of <c>World.serviceTracks</c>, document order).
        /// </summary>
        public List<StationModuleFact> ServiceTracks(string lineId) {
            var bound = new List<StationModuleFact>();
            var tracks = ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var m = tracks[i];
                if (m.LineId == lineId) bound.Add(m);
            }
            var platforms = new List<StationModuleFact>();
            for (int i = 0; i < bound.Count; i++) if (!bound[i].Tunnel && !bound[i].Bridge) platforms.Add(bound[i]);
            return platforms.Count > 0 ? platforms : bound;
        }

        /// <summary>Platform edges bound to a (line, track) pair, document order.</summary>
        public List<StationModuleFact> PlatformEdges(string lineId, string trackId) {
            var result = new List<StationModuleFact>();
            var edges = ModulesOfType("platform-edge");
            for (int i = 0; i < edges.Count; i++) {
                var m = edges[i];
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
        /// <summary>Keep the phase-transition log (a test or a frame sink reads it); default on.</summary>
        public bool RecordTransitions = true;
    }

    // ------------------------------------------------------------------ frames

    /// <summary>The clock half of a frame — published first, keyed by nothing but the session.</summary>
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
        /// <summary>
        /// The consist run this frame describes. A new dispatch of the same service (the
        /// next train on the same track) takes the next sequence, so a consumer can tell
        /// "the same stop went through another phase" from "another consist is at the
        /// platform" without inferring it from a pose.
        /// </summary>
        public int ServiceSequence;
        /// <summary>The doorways this service may open: one per modelled passenger door.</summary>
        public int DoorCount;
        public TrainPhase Phase;
        /// <summary>Seconds inside the current phase (<c>Train.t</c>).</summary>
        public double PhaseSeconds;
        /// <summary>Door leaves' commanded position, 0 shut ... 1 fully open.</summary>
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

    /// <summary>
    /// One phase transition of one consist, recorded where the session's phase loop makes
    /// it. A frame sink or a test can read what changed *and when* instead of inferring a
    /// transition from a pose, and a repeated open/close can be attributed either to a new
    /// service run (<see cref="ServiceSequence"/> changed) or to the phase alone.
    /// </summary>
    public struct StationTrainTransition {
        public long Tick;
        public string ServiceId, LineId, TrackId;
        public int ServiceSequence;
        public TrainPhase From, To;
        /// <summary>The instant the new phase began at (seconds since day zero).</summary>
        public double SimTime;
        /// <summary>True when the transition is a new consist dispatch, not a phase step.</summary>
        public bool Dispatch;
    }

    /// <summary>One moving band (escalator or walkway), keyed by module id.</summary>
    public struct StationEscalatorFrame {
        public string Id;
        /// <summary>The travel direction the document authored: +1 along from→to, -1 the reverse.</summary>
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
        /// <summary>The car's cell elevation. The cabin floor is one metre above it.</summary>
        public double Z;
        public bool HasCarElevation;
    }

    /// <summary>One platform edge's screen doors, keyed by its module id.</summary>
    public struct StationDoorFrame {
        public string PlatformId, LineId, TrackId;
        /// <summary>0 shut … 1 open, from the berthing consist's own phase.</summary>
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
        /// <summary>Crowd-scale state — false until the crowd and gate queues are ported.</summary>
        public bool Crowd, Gates, Queues, Boarding;
        public static StationSessionCapabilities Current => new StationSessionCapabilities {
            Clock = true, Play = true, Speed = true, Seek = true, Restart = true, ServiceWindow = true,
            Trains = true, Doors = true, Escalators = true, Lifts = true,
            Crowd = true, Gates = true, Queues = true, Boarding = true,
        };
    }

    // --------------------------------------------------------------- the session

    /// <summary>Prepared incoming edit staged before touching the active simulation session.</summary>
    public sealed class StagedStationDocumentEdit {
        public StationSessionDocument Document { get; }
        public StationDayData Day { get; }
        public StationDocumentEditKind Kind { get; }
        public StationWalkGraph WalkGraph { get; }
        public bool UsedIncrementalGraph { get; }
        public int RebuiltNodeCount { get; }
        public int RebuiltEdgeCount { get; }
        public string FallbackReason { get; }
        internal StationWalkGraphWorkspace WalkWorkspace { get; }
        internal StationWalkGraphDelta GraphDelta { get; }
        internal StationServiceRuntime.StagedServiceFacts ServiceFacts { get; }

        internal StagedStationDocumentEdit(
            StationSessionDocument document,
            StationDayData day,
            StationDocumentEditKind kind,
            StationWalkGraph walkGraph,
            StationServiceRuntime.StagedServiceFacts serviceFacts,
            StationWalkGraphWorkspace walkWorkspace = null,
            StationWalkGraphDelta graphDelta = null,
            bool usedIncrementalGraph = false,
            string fallbackReason = null) {
            Document = document;
            Day = day;
            Kind = kind;
            WalkGraph = walkGraph;
            ServiceFacts = serviceFacts;
            WalkWorkspace = walkWorkspace;
            GraphDelta = graphDelta;
            UsedIncrementalGraph = usedIncrementalGraph;
            RebuiltNodeCount = graphDelta != null ? graphDelta.RebuiltNodeCount : (walkGraph?.NodeCount ?? 0);
            RebuiltEdgeCount = graphDelta != null ? graphDelta.RebuiltEdgeNodeCount : (walkGraph?.NodeCount ?? 0);
            FallbackReason = fallbackReason;
        }
    }

    /// <summary>
    /// Owns the station clock, the tick scheduler and the service actors. The one
    /// entry point a host needs: construct with a committed document + authored day,
    /// call <see cref="Advance"/> with real elapsed seconds, read <see cref="Snapshot"/>.
    /// </summary>
    public sealed class StationSimulationSession {
        static long nextStatisticsRunSeq;
        struct TrainRun {
            public string LineId, TrackId;
            public TrainPhase Phase;
            public double T;
            /// <summary>Which consist run this is for the service: bumped per dispatch.</summary>
            public int Sequence;
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
        /// <summary>The last <see cref="TransitionLimit"/> phase/dispatch transitions, oldest first.</summary>
        readonly List<StationTrainTransition> transitions = new List<StationTrainTransition>();
        const int TransitionLimit = 512;
        int nextTrainSequence = 1;
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
        long presentationEpoch;
        string sessionId;
        bool hasCachedSnapshot;
        long cachedSnapshotTick = long.MinValue;
        long cachedSnapshotRevision = long.MinValue;
        long cachedSnapshotEpoch = long.MinValue;
        bool cachedSnapshotPlaying;
        int cachedSnapshotSpeed;
        double cachedSnapshotSimTime = double.NaN;
        StationSessionDocument cachedSnapshotDoc;
        StationMotionFrame cachedSnapshot;
        /// <summary>The bounded crowd/gate/boarding slice (plan 11 C3).</summary>
        readonly StationServiceRuntime services;
        readonly StationWalkGraphOptions walkOptions;
        readonly bool recordTransitions;
        StationWalkGraph walkGraph;
        StationWalkGraphWorkspace walkWorkspace;
        readonly StationWalkGraphScratchPool walkScratchPool = new StationWalkGraphScratchPool();
        readonly StationStatisticsHistory history = new StationStatisticsHistory();
        StationStatisticsSnapshot statistics;
        string statisticsRunId = "";
        int trainArrivals;
        StagedStationDocumentEdit stagedEdit;

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
            recordTransitions = setup.RecordTransitions;
            LoadDerived(setup.Document);
            trainArrivals = 0;
            ResetStatisticsRun();
        }

        public StationClock Clock { get; }
        public long Tick => tick;
        public bool Playing { get; private set; }
        public int Speed { get; private set; }
        public string SessionId => sessionId;
        /// <summary>Bumped whenever derived state is rebuilt (a document or authored-day edit).</summary>
        public long SessionRevision => sessionRevision;
        /// <summary>
        /// Bumped whenever the presented history is invalid: restart, seek, speed change
        /// or a rebuilt document. A frame sink compares it with the session id and the
        /// fixed tick to decide between interpolating and snapping (RCA 14 §5.2).
        /// </summary>
        public long PresentationEpoch => presentationEpoch;
        /// <summary>
        /// The scheduler's fractional position toward the next fixed tick (0 … 1). This
        /// is a presentation fraction only: the authoritative clock and every service
        /// decision stay on <see cref="Tick"/> boundaries.
        /// </summary>
        public double PresentationFraction => scheduler.Fraction;
        public StationSessionDocument Document => document;
        /// <summary>The document-built walk graph the service layer routes on (null when the build refused).</summary>
        public StationWalkGraph WalkGraph => walkGraph;
        /// <summary>The bounded crowd/gate/boarding service layer (plan 11 C3).</summary>
        public StationServiceRuntime Services => services;
        /// <summary>
        /// The phase/dispatch transitions the run has made, oldest first, bounded to the
        /// last <see cref="TransitionLimit"/>. This is where the phase loop itself says what
        /// changed: a repeated open/close is either a new <see cref="StationTrainTransition.ServiceSequence"/>
        /// (another consist) or the same sequence moving through its phases.
        /// </summary>
        public IReadOnlyList<StationTrainTransition> TrainTransitions => transitions;
        /// <summary>Forget the transition log (a test that only wants one stop).</summary>
        public void ClearTransitions() => transitions.Clear();
        /// <summary>The published passenger frames (empty when the station serves nobody).</summary>
        public StationPassengerFrame[] PassengerFrames() => services.PassengerFrames();
        /// <summary>The published gate servers' live queues, in document order.</summary>
        public StationGateFrame[] GateFrames() => services.GateFrames();
        /// <summary>Opaque per-run identifier minted on install, restart and seek.</summary>
        public string StatisticsRunId => statisticsRunId;
        /// <summary>Current live metrics snapshot (updated on ticks, resets, seeks and edits).</summary>
        public StationStatisticsSnapshot Statistics => statistics;
        /// <summary>Per-run 1-minute history buffer.</summary>
        public StationStatisticsHistory History => history;
        /// <summary>Cumulative consist berth arrivals since session load or restart.</summary>
        public int TrainArrivals => trainArrivals;

        static string MintStatisticsRunId() =>
            "run-" + Interlocked.Increment(ref nextStatisticsRunSeq).ToString(CultureInfo.InvariantCulture);

        /// <summary>Mint a fresh statistics run ID, clear the history series at the current clock, and refresh live metrics.</summary>
        public void ResetStatisticsRun() {
            statisticsRunId = MintStatisticsRunId();
            history.Reset(Clock.SimTime);
            RefreshStatistics(0);
        }

        /// <summary>Recompute the live metrics snapshot from current actors and clock without sampling a history row.</summary>
        public void RefreshStatistics(double tickMs = 0) {
            statistics = services.CollectStatistics(
                tick,
                Clock.SimTime,
                PeriodText(Clock.Period),
                trainArrivals,
                trains.Count,
                tickMs);
        }

        void CaptureStatistics(double tickMs) {
            RefreshStatistics(tickMs);
            history.Sample(in statistics);
        }

        public static bool IsSupportedSpeed(int speed) {
            for (int i = 0; i < StationSimConstants.SupportedSpeeds.Length; i++)
                if (StationSimConstants.SupportedSpeeds[i] == speed) return true;
            return false;
        }

        // ------------------------------------------------------------- lifecycle

        /// <summary>
        /// Play or pause. The accumulator's sub-tick fraction is kept: no simulated
        /// time is banked because <see cref="Advance"/> returns before accumulating
        /// while paused, and keeping the fraction means the presented pose freezes
        /// exactly where it was and resumes without a one-tick snap (RCA 14 §5.2).
        /// </summary>
        public void SetPlaying(bool playing) {
            if (playing == Playing) return;
            Playing = playing;
        }

        /// <summary>Set the speed multiplier. Returns false for anything but 1×/4×/16×/64×.</summary>
        public bool SetSpeed(int speed) {
            if (!IsSupportedSpeed(speed)) return false;
            if (speed == Speed) return true;
            Speed = speed;
            // The tick is always one simulated second, so a speed change only alters
            // how soon the next tick arrives; the interpolation pair stays valid and
            // the presented pose must not snap back. The fraction is therefore kept.
            return true;
        }

        /// <summary>
        /// Empty the actors without changing the station or the clock — the source
        /// <c>World.restart()</c>. The clock keeps running from where it stood, the
        /// tick keeps counting, and the dispatch schedule re-staggers from now.
        /// </summary>
        public void Restart() {
            stagedEdit = null;
            rng = new SimulationRng(seed);
            trains.Clear();
            transitions.Clear();
            nextTrainSequence = 1;
            trainArrivals = 0;
            scheduler.Reset();
            presentationEpoch++;
            RebuildServices(resetLifts: true);
            services.Restart();
            ResetStatisticsRun();
            sessionRevision++;
        }

        /// <summary>
        /// Move the clock to a whole date, keeping the time of day — the 时刻 window's
        /// calendar pick (§7.9's scrub). The actors stay; the dispatch schedule is dropped
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
            presentationEpoch++;
            ResetStatisticsRun();
        }

        /// <summary>Move the clock to an absolute instant, seconds since day zero.</summary>
        public void SeekToSimTime(double simTimeSeconds) {
            Clock.Seek(simTimeSeconds);
            nextDispatch.Clear();
            scheduler.Reset();
            presentationEpoch++;
            ResetStatisticsRun();
        }

        /// <summary>
        /// Stage an edited document against this running session without mutating active
        /// actors, queues, RNG or statistics. Call <see cref="CommitDocumentEdit"/> on
        /// transaction success or <see cref="AbortDocumentEdit"/> on rollback.
        /// </summary>
        public StagedStationDocumentEdit StageDocumentEdit(
            StationSessionDocument next,
            StationDayData day,
            StationDocumentEditKind kind = StationDocumentEditKind.Structural) {
            var doc = next ?? new StationSessionDocument();
            var normalizedDay = StationClock.NormalizeDay(day);
            if (kind != StationDocumentEditKind.Structural) {
                stagedEdit = new StagedStationDocumentEdit(doc, normalizedDay, kind, walkGraph, null, walkWorkspace, null, false);
                return stagedEdit;
            }
            StationWalkGraphWorkspace candidateWorkspace = null;
            StationWalkGraph candidateGraph = null;
            try {
                candidateWorkspace = StationWalkGraphBuilder.BuildWorkspace(doc, walkOptions);
                candidateGraph = candidateWorkspace.Graph;
            } catch (Exception) {
                candidateWorkspace = null;
                candidateGraph = null;
            }
            var candidateFacts = StationServiceRuntime.BuildServiceFacts(doc, candidateGraph);
            stagedEdit = new StagedStationDocumentEdit(doc, normalizedDay, StationDocumentEditKind.Structural, candidateGraph, candidateFacts, candidateWorkspace, null, false, "full-stage");
            return stagedEdit;
        }

        /// <summary>
        /// Stage an incremental cell/module delta against the retained walk-graph workspace without
        /// scanning untouched station records or mutating active simulation actors.
        /// </summary>
        public StagedStationDocumentEdit StageCellDelta(
            string stationId,
            int levelBase,
            StationDayData day,
            StationSessionDelta delta,
            StationDocumentEditKind kind = StationDocumentEditKind.Structural) {
            var normalizedDay = StationClock.NormalizeDay(day);
            var baseDoc = document ?? new StationSessionDocument();
            if (kind != StationDocumentEditKind.Structural) {
                var nonStructDoc = baseDoc.ApplyDelta(stationId, levelBase, delta, walkWorkspace != null ? (Func<List<StationCellFact>>)walkWorkspace.ExportAuthoredCells : null);
                stagedEdit = new StagedStationDocumentEdit(nonStructDoc, normalizedDay, kind, walkGraph, null, walkWorkspace, null, true);
                return stagedEdit;
            }
            if (walkWorkspace == null || delta == null) {
                var fullDoc = baseDoc.ApplyDelta(stationId, levelBase, delta);
                var fallback = StageDocumentEdit(fullDoc, normalizedDay, StationDocumentEditKind.Structural);
                stagedEdit = new StagedStationDocumentEdit(
                    fallback.Document, fallback.Day, fallback.Kind, fallback.WalkGraph, fallback.ServiceFacts,
                    fallback.WalkWorkspace, null, false, walkWorkspace == null ? "no-walk-workspace" : "null-delta");
                return stagedEdit;
            }
            var nextDoc = baseDoc.ApplyDelta(stationId, levelBase, delta);
            var stagedGraph = StationWalkGraphBuilder.StageCellDelta(walkWorkspace, nextDoc, delta, walkScratchPool.StagingSlot);
            nextDoc.LazyCells = stagedGraph.Workspace.ExportAuthoredCells;
            var candidateFacts = StationServiceRuntime.StageCellDelta(nextDoc, stagedGraph.Graph, stagedGraph.Delta);
            stagedEdit = new StagedStationDocumentEdit(
                nextDoc, normalizedDay, StationDocumentEditKind.Structural,
                stagedGraph.Graph, candidateFacts, stagedGraph.Workspace, stagedGraph.Delta, true);
            return stagedEdit;
        }

        public StationSessionDocument CommittedDocument => document;
        public StationWalkGraphWorkspace WalkWorkspace => walkWorkspace;

        /// <summary>Discard any staged document edit without touching the running session.</summary>
        public void AbortDocumentEdit() {
            stagedEdit = null;
        }

        /// <summary>Publish a previously staged document edit, preserving the statistics run and cumulative counters.</summary>
        public void CommitDocumentEdit(StagedStationDocumentEdit edit = null) {
            var committed = edit ?? stagedEdit;
            stagedEdit = null;
            if (committed == null) return;
            switch (committed.Kind) {
                case StationDocumentEditKind.DayOnly:
                    document = committed.Document;
                    services.ApplyCosmeticDocument(committed.Document);
                    ApplyDay(committed.Day);
                    break;
                case StationDocumentEditKind.Cosmetic:
                    document = committed.Document;
                    services.ApplyCosmeticDocument(committed.Document);
                    ApplyDayCore(committed.Day);
                    sessionRevision++;
                    RefreshStatistics(0);
                    break;
                default:
                    document = committed.Document;
                    Clock.SetDay(committed.Day);
                    walkGraph = committed.WalkGraph;
                    walkWorkspace = committed.WalkWorkspace;
                    if (committed.UsedIncrementalGraph && committed.GraphDelta != null) {
                        walkScratchPool.CommitSwap();
                        RebuildServices(resetLifts: false, preserveDispatch: true);
                        PruneOrphanedTrains();
                        services.ApplyIncrementalStagedEdit(committed.ServiceFacts, committed.GraphDelta);
                    } else {
                        walkScratchPool.Preallocate(walkGraph?.NodeCount ?? 0);
                        RebuildServices(resetLifts: true, preserveDispatch: false);
                        PruneOrphanedTrains();
                        services.ApplyStagedEdit(committed.ServiceFacts);
                    }
                    presentationEpoch++;
                    sessionRevision++;
                    RefreshStatistics(0);
                    break;
            }
        }

        /// <summary>
        /// Replace derived state for an edited document, keeping the crew: the source
        /// <c>rebuild()</c> path. Document data itself is never touched here — packet A's
        /// transaction owns the committed document and calls this after committing.
        /// </summary>
        public void ApplyDocument(StationSessionDocument next) {
            var staged = StageDocumentEdit(next, Clock.Day, StationDocumentEditKind.Structural);
            CommitDocumentEdit(staged);
        }

        /// <summary>
        /// Replace the authored day (operating hours, peaks, demand curves, calendar) —
        /// the source <c>updatePopulation</c> settings path. A headway change shifts the
        /// pending dispatches by the same delta instead of restarting them.
        /// </summary>
        public void ApplyDay(StationDayData day) {
            ApplyDayCore(day);
            sessionRevision++;
            RefreshStatistics(0);
        }

        void ApplyDayCore(StationDayData day) {
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
        }

        /// <summary>Load a different station document. A full reset: clock, tick, RNG and actors.</summary>
        public void LoadDocument(StationSessionDocument next, double startSimTime, uint newSeed) {
            stagedEdit = null;
            seed = newSeed;
            rng = new SimulationRng(seed);
            tick = 0;
            trains.Clear();
            transitions.Clear();
            nextTrainSequence = 1;
            trainArrivals = 0;
            Clock.Seek(startSimTime);
            Playing = false;
            scheduler.Reset();
            presentationEpoch++;
            LoadDerived(next);
            ResetStatisticsRun();
            sessionRevision++;
        }

        void LoadDerived(StationSessionDocument next) {
            document = next ?? new StationSessionDocument();
            RebuildServices(resetLifts: true, preserveDispatch: false);
            // The walk graph is derived from the committed document only: a rebuilt
            // station is a different graph, and a build that refuses (a disconnected
            // or absurd document) still leaves a clock that runs.
            walkGraph = null;
            walkWorkspace = null;
            try {
                walkWorkspace = StationWalkGraphBuilder.BuildWorkspace(document, walkOptions);
                walkGraph = walkWorkspace.Graph;
            } catch (Exception) {
                walkWorkspace = null;
                walkGraph = null;
            }
            walkScratchPool.Preallocate(walkGraph?.NodeCount ?? 0);
            services.Build(document, walkGraph, seed);
        }

        void PruneOrphanedTrains() {
            for (int i = trains.Count - 1; i >= 0; i--) {
                var run = trains[i];
                if (!serviceTracks.TryGetValue(run.LineId ?? "", out List<string> tracks)) {
                    trains.RemoveAt(i);
                    continue;
                }
                if (tracks.Count == 0) {
                    if (!string.IsNullOrEmpty(run.TrackId)) trains.RemoveAt(i);
                    continue;
                }
                bool found = false;
                for (int t = 0; t < tracks.Count; t++) {
                    if (string.Equals(tracks[t], run.TrackId, StringComparison.Ordinal)) { found = true; break; }
                }
                if (!found) trains.RemoveAt(i);
            }
        }

        /// <summary>The source <c>rebuild()</c> tail: re-read the document's service actors and re-stagger dispatch.</summary>
        void RebuildServices(bool resetLifts = false, bool preserveDispatch = false) {
            // A rebuild keeps each band where it had rolled to: an edit that leaves a run
            // alone must not make its steps jump back to zero.
            var phases = new Dictionary<string, double>(escalators.Count, StringComparer.Ordinal);
            for (int i = 0; i < escalators.Count; i++) phases[escalators[i].Id ?? ""] = escalators[i].Phase;
            var cars = new Dictionary<string, LiftRun>(lifts.Count, StringComparer.Ordinal);
            if (!resetLifts) {
                for (int i = 0; i < lifts.Count; i++) cars[lifts[i].Id ?? ""] = lifts[i];
            }
            escalators.Clear();
            lifts.Clear();
            serviceTracks.Clear();
            if (document != null) {
                var bands = document.MovingBandsInOrder();
                for (int i = 0; i < bands.Count; i++) {
                    var m = bands[i];
                    int direction = m.HasEndpoints && m.ToZ < m.FromZ ? -1 : 1;
                    escalators.Add(new EscalatorRun {
                        Id = m.Id, Direction = direction,
                        Phase = phases.TryGetValue(m.Id ?? "", out double held) ? held : 0,
                        RunLength = m.RunLength > 0 ? m.RunLength : 0,
                    });
                }
                var liftMods = document.ModulesOfType("lift");
                for (int i = 0; i < liftMods.Count; i++) {
                    var m = liftMods[i];
                    var stops = StationLiftStops.Levels(m);
                    LiftRun held = default;
                    bool known = !resetLifts && cars.TryGetValue(m.Id ?? "", out held) && held.Stops != null && held.Stops.Length == stops.Count;
                    int stop = known ? Math.Max(0, Math.Min(stops.Count - 1, held.Stop)) : 0;
                    double z = known ? held.Z : (stops.Count > 0 ? stops[stop] : m.Z);
                    lifts.Add(new LiftRun {
                        Id = m.Id, Phase = known ? held.Phase : "idle",
                        Door = known ? held.Door : 0,
                        Stop = stop, StopCount = stops.Count,
                        Stops = stops.ToArray(),
                        Z = z,
                        From = known ? held.From : stop, To = known ? held.To : stop,
                        MoveT = known ? held.MoveT : 0, MoveTotal = known ? held.MoveTotal : 0,
                        T = known ? held.T : 0, Call = known ? held.Call : -1,
                    });
                }
                for (int i = 0; i < document.Lines.Count; i++) {
                    var line = document.Lines[i];
                    var tracks = document.ServiceTracks(line.Id);
                    var ids = new List<string>(tracks.Count);
                    for (int t = 0; t < tracks.Count; t++) ids.Add(tracks[t].Id);
                    serviceTracks[line.Id] = ids;
                }
            }
            if (!preserveDispatch) {
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
                return;
            }

            if (document == null) {
                nextDispatch.Clear();
                return;
            }
            var activeKeys = new HashSet<string>(StringComparer.Ordinal);
            double newStagger = 0;
            for (int i = 0; i < document.Lines.Count; i++) {
                var line = document.Lines[i];
                var ids = serviceTracks[line.Id];
                if (ids.Count == 0) {
                    string key = ServiceKey(line.Id, "");
                    activeKeys.Add(key);
                    if (!nextDispatch.ContainsKey(key)) nextDispatch[key] = Clock.SimTime + newStagger;
                    newStagger += 13;
                    continue;
                }
                for (int t = 0; t < ids.Count; t++) {
                    string key = ServiceKey(line.Id, ids[t]);
                    activeKeys.Add(key);
                    if (!nextDispatch.ContainsKey(key)) nextDispatch[key] = Clock.SimTime + newStagger;
                    newStagger += 13;
                }
            }
            if (nextDispatch.Count != activeKeys.Count) {
                var stale = new List<string>();
                foreach (var k in nextDispatch.Keys) {
                    if (!activeKeys.Contains(k)) stale.Add(k);
                }
                for (int i = 0; i < stale.Count; i++) nextDispatch.Remove(stale[i]);
            }
        }

        /// <summary>The floors a shaft serves between its endpoints, bottom → top (plain <c>liftLevels</c>).</summary>
        static List<int> LiftStopLevels(StationModuleFact m) => StationLiftStops.Levels(m);

        static string ServiceKey(string lineId, string trackId) => lineId + "|" + trackId;

        // -------------------------------------------------------------- advance

        /// <summary>
        /// Advance by real elapsed seconds at the current speed. Whole simulated ticks
        /// are stepped; the fractional remainder is kept for the next call. Returns the
        /// number of ticks actually stepped (0 while paused).
        ///
        /// Speed multiplies **ticks per real second**, never the step size: one tick is
        /// always <c>SIM_SECONDS_PER_TICK</c> simulated seconds, so a run at 4× 16× or
        /// 64 × crosses the same calendar in the same order (§7.6 determinism).
        /// </summary>
        public int Advance(double deltaSeconds) {
            if (!Playing) return 0;
            if (double.IsNaN(deltaSeconds) || double.IsInfinity(deltaSeconds) || deltaSeconds <= 0) return 0;
            return scheduler.Advance(deltaSeconds, Speed, StepOnce);
        }

        bool StepOnce() {
            var sw = Stopwatch.StartNew();
            tick++;
            Clock.Advance(StationSimConstants.SimSecondsPerTick);
            StepServices();
            sw.Stop();
            CaptureStatistics(sw.Elapsed.TotalMilliseconds);
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
                        frames.Add(ServiceFrame(line, "", ActiveTrain(line.Id, "")));
                        continue;
                    }
                    for (int t = 0; t < ids.Count; t++) {
                        var active = ActiveTrain(line.Id, ids[t]);
                        frames.Add(ServiceFrame(line, ids[t], active));
                    }
                }
            }
            return frames.ToArray();
        }

        /// <summary>One service's live state, with the stable identity a consumer keys on.</summary>
        StationTrainFrame ServiceFrame(StationLineFact line, string trackId, TrainRun? active) {
            return new StationTrainFrame {
                Id = ServiceKey(line.Id, trackId), LineId = line.Id, TrackId = trackId,
                ServiceSequence = active?.Sequence ?? 0,
                DoorCount = services.DoorCountFor(line.Id, trackId),
                Phase = active?.Phase ?? TrainPhase.None,
                PhaseSeconds = active?.T ?? 0,
                DoorFraction = active.HasValue ? DoorFractionOf(active.Value.Phase, active.Value.T) : 0,
                Capacity = services.CapacityFor(line.Id, trackId),
                Onboard = services.OnboardFor(line.Id, trackId),
            };
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
                        if (train.T >= StationSimConstants.TrainApproachSeconds) Advance(ref train, TrainPhase.Berth);
                        break;
                    case TrainPhase.Berth:
                        // Held at the mark, doors shut, before they cycle.
                        if (train.T >= StationSimConstants.TrainBerthHold) Advance(ref train, TrainPhase.Opening);
                        break;
                    case TrainPhase.Opening:
                        if (train.T >= StationSimConstants.TrainDoorTravel) Advance(ref train, TrainPhase.Dwell);
                        break;
                    case TrainPhase.Dwell:
                        if (train.T >= StationSimConstants.TrainDwell) Advance(ref train, TrainPhase.Closing);
                        break;
                    case TrainPhase.Closing:
                        if (train.T >= StationSimConstants.TrainDoorTravel) Advance(ref train, TrainPhase.Hold);
                        break;
                    case TrainPhase.Hold:
                        if (train.T >= StationSimConstants.TrainDepartHold) Advance(ref train, TrainPhase.Depart);
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

        /// <summary>
        /// Move one consist to the head of a phase, reset its phase clock and record the
        /// transition where it happens. The service layer reads the same frames the host
        /// publishes, so a phase change is visible to crowd, doors and presentation on the
        /// same tick in every one of them.
        /// </summary>
        void Advance(ref TrainRun train, TrainPhase next) {
            var from = train.Phase;
            train.Phase = next;
            train.T = 0;
            if (from == TrainPhase.Approach && next == TrainPhase.Berth) {
                trainArrivals++;
            }
            Record(train, from, next, false);
        }

        void Record(TrainRun train, TrainPhase from, TrainPhase to, bool dispatch) {
            if (!recordTransitions) return;
            transitions.Add(new StationTrainTransition {
                Tick = tick, ServiceId = ServiceKey(train.LineId, train.TrackId),
                LineId = train.LineId, TrackId = train.TrackId,
                ServiceSequence = train.Sequence, From = from, To = to,
                SimTime = Clock.SimTime, Dispatch = dispatch,
            });
            if (transitions.Count > TransitionLimit) transitions.RemoveRange(0, transitions.Count - TransitionLimit);
        }

        void MaybeDispatch(StationLineFact line, string trackId, SimPeriod period) {
            string key = ServiceKey(line.Id, trackId);
            if (HasActiveTrain(line.Id, trackId)) return;
            double next = nextDispatch.TryGetValue(key, out double held) ? held : Clock.SimTime;
            if (Clock.SimTime < next) return;
            var run = new TrainRun {
                LineId = line.Id, TrackId = trackId, Phase = TrainPhase.Approach, T = 0,
                Sequence = nextTrainSequence++,
            };
            trains.Add(run);
            Record(run, TrainPhase.None, TrainPhase.Approach, true);
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
                            services.LiftExchange(car.Id, car.Stop, allowBoarding: car.T <= StationSimConstants.LiftDwellSeconds);
                            bool exchanging = services.IsLiftExchanging(car.Id);
                            if (car.T >= StationSimConstants.LiftDwellSeconds &&
                                (!exchanging || car.T >= StationSimConstants.LiftDwellSeconds + 4)) {
                                car.Phase = "close";
                                car.T = 0;
                            }
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

        static readonly double[] TrainStopDurations = {
            StationSimConstants.TrainApproachSeconds, StationSimConstants.TrainBerthHold,
            StationSimConstants.TrainDoorTravel, StationSimConstants.TrainDwell,
            StationSimConstants.TrainDoorTravel, StationSimConstants.TrainDepartHold,
            StationSimConstants.TrainDepartSeconds,
        };

        public StationMotionFrame Snapshot() {
            if (hasCachedSnapshot &&
                cachedSnapshotTick == tick &&
                cachedSnapshotRevision == sessionRevision &&
                cachedSnapshotEpoch == presentationEpoch &&
                cachedSnapshotPlaying == Playing &&
                cachedSnapshotSpeed == Speed &&
                cachedSnapshotSimTime == Clock.SimTime &&
                ReferenceEquals(cachedSnapshotDoc, document)) {
                return cachedSnapshot;
            }
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
                    Stop = car.Stop, StopCount = car.StopCount, Call = car.Call, Z = car.Z, HasCarElevation = true,
                };
            }
            var doorFrames = DoorFrames();
            cachedSnapshot = new StationMotionFrame {
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
            hasCachedSnapshot = true;
            cachedSnapshotTick = tick;
            cachedSnapshotRevision = sessionRevision;
            cachedSnapshotEpoch = presentationEpoch;
            cachedSnapshotPlaying = Playing;
            cachedSnapshotSpeed = Speed;
            cachedSnapshotSimTime = Clock.SimTime;
            cachedSnapshotDoc = document;
            return cachedSnapshot;
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
                ServiceSequence = active?.Sequence ?? 0,
                DoorCount = services.DoorCountFor(line.Id, trackId),
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
            var durations = TrainStopDurations;
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
            if (document == null) return Array.Empty<StationDoorFrame>();
            var edges = document.ModulesOfType("platform-edge");
            if (edges.Count == 0) return Array.Empty<StationDoorFrame>();
            var frames = new StationDoorFrame[edges.Count];
            for (int i = 0; i < edges.Count; i++) {
                var edge = edges[i];
                var active = ActiveTrain(edge.LineId, edge.RailId);
                double fraction = active.HasValue ? DoorFractionOf(active.Value.Phase, active.Value.T) : 0;
                frames[i] = new StationDoorFrame {
                    PlatformId = edge.Id, LineId = edge.LineId, TrackId = edge.RailId,
                    DoorFraction = fraction, TrainPhase = active?.Phase ?? TrainPhase.None,
                };
            }
            return frames;
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

        /// The whole frame as JSON — the payload the bridge publishes. Clock first, then
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
            sb.Append(",\"serviceSequence\":").Append(t.ServiceSequence);
            sb.Append(",\"doorCount\":").Append(t.DoorCount);
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


