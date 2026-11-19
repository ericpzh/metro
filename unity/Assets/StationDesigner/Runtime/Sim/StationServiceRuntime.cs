using System;
using System.Collections.Generic;

namespace Metro.Sim {
    // The station's service layer (plan 11 C3): the crowd, the per-gate queues and
    // admission, the vertical rides and the boarding/alighting of a berthing
    // consist. A deterministic port of the bounded slice of
    // `game/src/sim/world/World.ts` — `tickOnce`'s order, `spawnStreet`,
    // `sampleTripFromStreet`, `stepGate`, `serve`, the alighting wave
    // (`loadAlighting`/`stepAlighting`) and `boardRider` — over the document-built
    // `StationWalkGraph` and `StationRoutePlanner`.
    //
    // **What this is not.** No collision/separation pass, no errands (shops,
    // benches, cubicles), no crowd replanning, no transfers to a second line and no
    // consist geometry: the source's own answer for a single station is that a
    // boarder rides out with its consist, while a berth's arrivals are the
    // alighting wave the same stop brings. Everything the slice does not do is
    // reported by `Unported`.
    //
    // **Determinism.** Every random draw comes from the session's
    // `SimulationRng` in a fixed order (per-exit spawn wave, boarding chance, exit
    // pick, needs, spawn jitter), every collection is iterated in document or id
    // order, and no wall clock, engine type or scene object is read. The same seed
    // and the same ticks therefore produce the same passengers, the same queues and
    // the same admissions.
    public sealed class StationServiceRuntime {
        // ------------------------------------------------------------- constants

        /// <summary>Free-flow walking speed, m/s (<c>WALK_SPEED</c>).</summary>
        public const double WalkSpeed = StationWalkGraphBuilder.WalkSpeed;
        /// <summary>A platform doorway's admission rate, pax/s (<c>DOOR_RATE</c>).</summary>
        public const double DoorRate = 1.2;
        /// <summary>Riders one lift car takes per stop (<c>LIFT_BATCH</c>).</summary>
        public const int LiftBatch = 15;
        internal const double LiftCycleSeconds = 40;
        /// <summary>The consist's car length and rated load (<c>stock.ts</c>, Type L), used only to size capacity.</summary>
        public const double CarLengthMetres = 16.8;
        public const int RatedPerCar = 170;
        public const int MaxCars = 8;
        /// <summary>The source's boarding chance for a street passenger with a line to ride (<c>sampleTripFromStreet</c>).</summary>
        public const double BoardChance = 0.55;
        /// <summary>The source's step-free share (<c>rng.chance(0.03)</c>).</summary>
        public const double StepFreeChance = 0.03;
        /// <summary>The source's luggage share (<c>rng.chance(0.08)</c>).</summary>
        public const double LuggageChance = 0.08;
        const double Dt = StationSimConstants.SimSecondsPerTick;
        // Fare-line decision and forecast constants from game/src/sim/constants.ts.
        const double GateLookahead = 8;
        const int GateReplanPerTick = 8;
        const double GateForecastSeconds = 12;
        const double GateForecastMinDrainFraction = .1;
        const int RerouteReplanPerTick = 4;
        const double PatienceMin = 60, PatienceMax = 180;

        enum Phase { Walking, Queuing, Riding, LiftQueuing, LiftRiding, TrainRiding, Alighting, Stepping, Dead }

        sealed class ServiceRoute {
            public int[][] Segments = Array.Empty<int[]>();
            public string[] Lifts = Array.Empty<string>();
            public double Cost;
        }

        sealed class Passenger {
            public int Id;
            public double X, Y, Z, Heading;
            public Phase Phase = Phase.Walking;
            public double IdentityFactor = 1;
            public double Speed = WalkSpeed;
            public double WalkPhase;
            public double WalkDistance;
            public double WalkWeight;
            public StationPassengerActivity Activity;
            public double ActivityStart;
            public double ActivityTotal;
            public ServiceRoute Route;
            public int Segment;
            public int[] Path = Array.Empty<int>();
            public int PathIndex;
            public string ServerId = "";
            public int Server = -1;
            public double StandX, StandY;
            public int GateServer = -1;
            public int GateDir;
            public bool GateQueueOverflow;
            public bool GateChosen, AlignRouteStart;
            public GateFact ReservedGate;
            public int ReservedGateDir;
            public double GatePatienceAt;
            public bool Boards;
            public double RideT, RideTotal, RideColumn;
            public StationRidePath RidePath;
            public bool RideReverse;
            public int RailVariant;
            public double FromX, FromY, FromZ, ToX, ToY, ToZ;
            public string TrainKey = "";
            /// <summary>The service doorway this rider left through (`train.doors` index).</summary>
            public int TrainDoor = -1;
            /// <summary>`trainRow`: the row of the doorway's cabin queue it stands in.</summary>
            public int TrainRow;
            /// <summary>`trainFile`: which of the two abreast it is (−1 / +1).</summary>
            public int TrainFile;
            /// <summary>The cabin slot it waits in, and the doorway it steps out onto.</summary>
            public double SeatX, SeatY, SeatZ;
            public double StepFromX, StepFromY, StepFromZ;
            public double StepToX, StepToY, StepToZ;
            /// <summary>`trainT` inside the step-out (0 … <see cref="StationServiceCadence.TrainStepSeconds"/>).</summary>
            public double StepT;
            /// <summary>The exit sampled when the wave was seated (the source's trip dest).</summary>
            public int DestExit = -1;
            public string DestExitId = "";
            public string TargetLineId = "";
            public StationRouteNeeds Needs;
            public bool AwaitingRoute;
            public int RouteGraphEpoch;
            public int DoorNode = -1;
            public string LiftId = "";
            public int LiftBoardNode = -1, LiftDestNode = -1, LiftBoardStop = -1, LiftDestStop = -1;
            public int LiftPhase, LiftSlot;
            public bool LiftThresholdDone;
        }

        internal sealed class GateFact {
            public string Id = "";
            public int Server = -1, Node = -1, Mode, Rotation;
            public double Rate;
            public int Batch = 1, Cycle;
            public readonly List<int> Queue = new List<int>();
            public readonly int[] QueuedByDirection = new int[3];
            public readonly int[] IncomingByDirection = new int[3];
            public double Cooldown;
            public int Served, Lane, Admitted;
            /// <summary>Sim seconds the lane last admitted a passenger (`open` starts here).</summary>
            public double AdmittedAt = double.NegativeInfinity;
        }

        /// <summary>
        /// One platform doorway of one (line, track) service — a stable
        /// <see cref="StationDoorSlot"/> plus the queue and latch the source's door server
        /// owns. Identity is the slot's own id, so a station rebuild re-binds the same
        /// doorway rather than renumbering it.
        /// </summary>
        internal sealed class DoorFact {
            public string Id = "", PlatformId = "", LineId = "", TrackId = "";
            public int Index, Server = -1, Node = -1;
            public int X, Y, Z;
            public double Offset;
            public readonly List<int> Queue = new List<int>();
            /// <summary>`ServerDef.rate`: 0 shut, <see cref="DoorRate"/> once the doorway is clear.</summary>
            public double Rate;
            public double Cooldown;
            public int Served, Admitted;
        }

        /// <summary>What one doorway's stop looked like: the readable half of a service frame.</summary>
        public struct StationServiceDoorState {
            public string Id, PlatformId;
            public int Index, Node, X, Y, Z;
            public double Offset;
            /// <summary>Rows still queued in the cabin at this doorway.</summary>
            public int CabinRows;
            /// <summary>Passengers still stepping out through it.</summary>
            public int InFlight;
            /// <summary>The cadence timer (`train.doorT`).</summary>
            public double Cadence;
            /// <summary>True while the doorway is handed to the boarders (`rate > 0`).</summary>
            public bool Released;
            public int Queued, Boarded;
        }

        internal sealed class RideFact {
            public int Server = -1, Node = -1, ExitNode = -1;
            public WalkEdgeKind Kind;
            public double Rate, Ride;
            public StationRidePath Path;
            public bool Reverse;
            public int Columns;
            public readonly List<int> Queue = new List<int>();
            public double Cooldown;
            public int Served, Admitted;
        }

        internal sealed class LiftConnector {
            public string Id = "";
            public int[] Landings = Array.Empty<int>();
            public double X, Y;
            public int Size = 2, Rotation;
            public int[] Stops = Array.Empty<int>();
            public readonly List<int> Queue = new List<int>();
            public readonly List<int> Riders = new List<int>();
            public double CarZ, CarDoor;
            public int CarStop = -1;
            public int Served, Admitted;
        }

        /// <summary>
        /// One (line, track) service's live stop, in the source's own terms
        /// (`Train` + `Train.cabins`/`cabinRows`/`doorT`/`inFlight`/`boardings`).
        ///
        /// `Sequence` is the consist run the state belongs to: seating happens once per
        /// berth, so a *new* dispatch of the same service re-seats instead of reusing the
        /// previous stop's drained cabin.
        /// </summary>
        sealed class TrainWatch {
            public string Key = "", LineId = "", TrackId = "";
            public int Sequence;
            public TrainPhase Last = TrainPhase.None;
            public double BerthTime;
            public bool Seated;
            /// <summary>`train.alightLeft`: the wave the cabin could not hold.</summary>
            public int AlightLeft;
            /// <summary>`train.alightT`: door-open seconds this stop has spent alighting.</summary>
            public double AlightT;
            public int Capacity;
            public int Onboard;
            public int Alighted;
            /// <summary>The service's doorways in `train.doors` order.</summary>
            public List<DoorFact> Doors = new List<DoorFact>();
            /// <summary>`train.cabinRows`: rows still to leave, per doorway.</summary>
            public int[] CabinRows = Array.Empty<int>();
            /// <summary>`train.inFlight`: passengers still stepping out, per doorway.</summary>
            public int[] InFlight = Array.Empty<int>();
            /// <summary>`train.doorT`: the doorway's pair cadence, per doorway.</summary>
            public double[] DoorT = Array.Empty<double>();
            /// <summary>`train.boardings`: how many this doorway took this stop.</summary>
            public int[] Boardings = Array.Empty<int>();
            /// <summary>`train.cabins`: the ids queued in the cabin, front row first, per doorway.</summary>
            public List<int>[] Cabins = Array.Empty<List<int>>();

            public void ResetDoors(int count) {
                if (Doors.Count == count && CabinRows.Length == count) {
                    for (int d = 0; d < count; d++) {
                        CabinRows[d] = 0; InFlight[d] = 0; DoorT[d] = 0; Boardings[d] = 0;
                        Cabins[d].Clear();
                        // The doorway latch is the service server rate: shut until this stop's
                        // own wave clears (the source sets it in `stepAlighting`).
                        if (d < Doors.Count) Doors[d].Rate = 0;
                    }
                    return;
                }
                CabinRows = new int[count];
                InFlight = new int[count];
                DoorT = new double[count];
                Boardings = new int[count];
                Cabins = new List<int>[count];
                for (int d = 0; d < count; d++) Cabins[d] = new List<int>();
            }

            /// <summary>Sum of the cabin queues (`train.cabins[d].length`).</summary>
            public int CabinCount {
                get { int total = 0; for (int d = 0; d < Cabins.Length; d++) total += Cabins[d].Count; return total; }
            }

            public int InFlightTotal {
                get { int total = 0; for (int d = 0; d < InFlight.Length; d++) total += InFlight[d]; return total; }
            }

            public int QueuedTotal {
                get { int total = 0; for (int d = 0; d < Doors.Count; d++) total += Doors[d].Queue.Count; return total; }
            }
        }

        internal sealed class StagedServiceFacts {
            public StationSessionDocument Document;
            public StationWalkGraph Graph;
            public StationRoutePlanner Planner;
            public readonly Dictionary<string, List<DoorFact>> DoorsByService = new Dictionary<string, List<DoorFact>>(StringComparer.Ordinal);
            public readonly List<GateFact> Gates = new List<GateFact>();
            public readonly List<DoorFact> Doors = new List<DoorFact>();
            public readonly List<RideFact> Rides = new List<RideFact>();
            public readonly List<LiftConnector> Lifts = new List<LiftConnector>();
            public readonly List<StationExitFact> Exits = new List<StationExitFact>();
            public readonly List<int> ExitNodes = new List<int>();
            public readonly Dictionary<int, GateFact> GateByServer = new Dictionary<int, GateFact>();
            public readonly Dictionary<int, GateFact> GateByNode = new Dictionary<int, GateFact>();
            public readonly Dictionary<int, DoorFact> DoorByServer = new Dictionary<int, DoorFact>();
            public readonly Dictionary<int, RideFact> RideByServer = new Dictionary<int, RideFact>();
            public readonly Dictionary<string, LiftConnector> LiftById = new Dictionary<string, LiftConnector>(StringComparer.Ordinal);
            public readonly List<string> Unported = new List<string>();
        }

        readonly StationServiceOptions options;
        StationSessionDocument document;
        StationWalkGraph graph;
        StationRoutePlanner planner;
        int walkReplans, queueReplans, gateReplans, patienceReplans;
        readonly Dictionary<(int X, int Y, int Z), int> collisionHeads = new Dictionary<(int X, int Y, int Z), int>();
        int[] collisionNext = Array.Empty<int>();
        readonly Queue<int> detourQueue = new Queue<int>(32);
        readonly Dictionary<int, int> detourFirstStep = new Dictionary<int, int>(32);
        readonly Dictionary<(int X, int Y, int Z), int> nearbyCrowd = new Dictionary<(int X, int Y, int Z), int>();
        SimulationRng rng;
        uint seed;
        double simTime;
        int nextPassengerId;
        int frameVersion;
        int graphEpoch;

        readonly List<Passenger> passengers = new List<Passenger>();
        /// <summary>The service doorways per (line, track), rebuilt with the graph.</summary>
        readonly Dictionary<string, List<DoorFact>> doorsByService = new Dictionary<string, List<DoorFact>>(StringComparer.Ordinal);
        readonly List<GateFact> gates = new List<GateFact>();
        readonly List<DoorFact> doors = new List<DoorFact>();
        readonly List<RideFact> rides = new List<RideFact>();
        readonly List<LiftConnector> lifts = new List<LiftConnector>();
        readonly List<StationExitFact> exits = new List<StationExitFact>();
        readonly List<int> exitNodes = new List<int>();
        readonly Dictionary<int, GateFact> gateByServer = new Dictionary<int, GateFact>();
        readonly Dictionary<int, GateFact> gateByNode = new Dictionary<int, GateFact>();
        readonly Dictionary<int, DoorFact> doorByServer = new Dictionary<int, DoorFact>();
        readonly Dictionary<int, RideFact> rideByServer = new Dictionary<int, RideFact>();
        readonly Dictionary<string, LiftConnector> liftById = new Dictionary<string, LiftConnector>(StringComparer.Ordinal);
        readonly Dictionary<string, TrainWatch> watches = new Dictionary<string, TrainWatch>(StringComparer.Ordinal);
        /// <summary>One consist pose per service (18 §8.2), derived once per rebuilt document.</summary>
        readonly Dictionary<string, StationTrainBerth> berths = new Dictionary<string, StationTrainBerth>(StringComparer.Ordinal);
        readonly List<string> unported = new List<string>();
        StationPassengerFrame[] frameCache = Array.Empty<StationPassengerFrame>();
        int frameCacheVersion = -1;

        public StationServiceRuntime(StationServiceOptions setup = null) {
            options = setup ?? new StationServiceOptions();
        }

        // ---------------------------------------------------------------- public

        public StationServiceOptions Options => options;
        public StationWalkGraph Graph => graph;
        public StationSessionDocument Document => document;
        public int PassengerCount => passengers.Count;
        public int GateCount => gates.Count;
        public int LiftCount => lifts.Count;
        public int Spawned { get; private set; }
        /// <summary>Passengers currently aboard a consist.</summary>
        public int Onboard { get; private set; }
        /// <summary>Passengers admitted onto a consist since the run began.</summary>
        public int Boarded { get; private set; }
        /// <summary>Admissions in the tick just stepped.</summary>
        public int BoardingsThisTick { get; private set; }
        public int Alighted { get; private set; }
        /// <summary>Arrivals the stop could not serve: still aboard when the doors shut.</summary>
        public int LeftBehind { get; private set; }
        public int Exited { get; private set; }
        public int Stuck { get; private set; }
        public int CapHit { get; private set; }
        public int GraphEpoch => graphEpoch;
        public int LastReconciledPassengers { get; private set; }
        public int GateQueueTotal {
            get {
                int total = 0;
                for (int i = 0; i < gates.Count; i++) total += gates[i].Queue.Count;
                return total;
            }
        }
        public int EscalatorQueueTotal {
            get {
                int total = 0;
                for (int i = 0; i < rides.Count; i++) total += rides[i].Queue.Count;
                return total;
            }
        }
        public int LiftQueueTotal {
            get {
                int total = 0;
                for (int i = 0; i < lifts.Count; i++) total += lifts[i].Queue.Count;
                return total;
            }
        }
        public int DoorQueueTotal {
            get {
                int total = 0;
                for (int i = 0; i < doors.Count; i++) total += doors[i].Queue.Count;
                return total;
            }
        }
        public bool TryReadPassengerRoute(int id, List<(double X, double Y, double Z)> points) {
            points.Clear();
            var p = Find(id);
            if (p == null || p.Phase == Phase.Dead) return false;
            bool ridingCurve = p.Phase == Phase.Riding && p.RidePath != null;
            if (ridingCurve)
                points.AddRange(p.RidePath.Remaining(p.RideT / p.RideTotal, p.RideReverse, p.RideColumn));
            if (p.Route == null || p.AwaitingRoute || p.RouteGraphEpoch != graphEpoch) return true;
            for (int s = p.Segment; s < p.Route.Segments.Length; s++) {
                var path = p.Route.Segments[s];
                int first = s != p.Segment ? 0 : p.PathIndex + (ridingCurve ? 2 : 1);
                for (int i = first; i < path.Length; i++) {
                    if (i > 0 && !(s == p.Segment && i == first && ridingCurve)) {
                        int server = EdgeServer(path[i - 1], path[i], out _);
                        if (rideByServer.TryGetValue(server, out var ride) && ride.Path != null) {
                            points.AddRange(ride.Path.Remaining(0, ride.Reverse, 0));
                            continue;
                        }
                    }
                    int node = path[i];
                    points.Add((graph.NodeX[node], graph.NodeY[node], graph.NodeZ[node]));
                }
            }
            return true;
        }

        public int QueueTotal => GateQueueTotal + DoorQueueTotal + EscalatorQueueTotal + LiftQueueTotal;

        /// <summary>True when every walking passenger's active path was built on the current walk graph.</summary>
        public bool AllWalkingRoutesMatchCurrentGraph() {
            for (int i = 0; i < passengers.Count; i++) {
                var p = passengers[i];
                if (p.Phase == Phase.Dead || !string.IsNullOrEmpty(p.TrainKey)) continue;
                if (p.Route != null && p.RouteGraphEpoch != graphEpoch) return false;
                if (p.Path != null) {
                    for (int k = 0; k < p.Path.Length; k++) {
                        if (graph == null || p.Path[k] < 0 || p.Path[k] >= graph.NodeCount) return false;
                    }
                }
            }
            return true;
        }

        /// <summary>JavaScript <c>Math.round</c> for finite coordinates (<c>Math.Floor(value + 0.5)</c>).</summary>
        public static int JsRound(double value) => (int)Math.Floor(value + 0.5);

        /// <summary>
        /// Port of <c>World.nearestNode(x, y, z)</c>: Chebyshev ring search of radius 0..2
        /// around <c>(Math.round(x - 0.5), Math.round(y - 0.5), Math.round(z - 1))</c>,
        /// scanning <c>dy</c> from <c>-r..r</c> then <c>dx</c> from <c>-r..r</c> on that floor.
        /// </summary>
        public static int NearestNode(StationWalkGraph walkGraph, double x, double y, double z) {
            if (walkGraph == null || walkGraph.NodeCount <= 0) return -1;
            int cx = JsRound(x - 0.5);
            int cy = JsRound(y - 0.5);
            int cz = JsRound(z - 1.0);
            for (int r = 0; r <= 2; r++) {
                for (int dy = -r; dy <= r; dy++) {
                    for (int dx = -r; dx <= r; dx++) {
                        if (Math.Max(Math.Abs(dx), Math.Abs(dy)) != r) continue;
                        if (walkGraph.TryNode(cx + dx, cy + dy, cz, out int node)) {
                            return node;
                        }
                    }
                }
            }
            return -1;
        }

        public int NearestNode(double x, double y, double z) => NearestNode(graph, x, y, z);

        /// <summary>
        /// Port of <c>World.computeMetrics</c>: reads post-compaction logical population,
        /// standing station density (excluding <see cref="StationWalkGraphBuilder.ZoneOutside"/>
        /// and passengers with an active <c>TrainKey</c>), direct queue ownership across
        /// gates/rides/lifts/door slots, and cumulative flow counters.
        /// </summary>
        public StationStatisticsSnapshot CollectStatistics(
            long tick,
            double now,
            string period,
            int trainArrivals,
            int activeTrains,
            double tickMs) {
            int standing = 0;
            if (graph != null && graph.NodeCount > 0) {
                for (int i = 0; i < passengers.Count; i++) {
                    var p = passengers[i];
                    if (p.Phase == Phase.Dead) continue;
                    if (!string.IsNullOrEmpty(p.TrainKey)) continue;
                    int node;
                    if (p.Phase == Phase.LiftQueuing && p.LiftBoardNode >= 0 && p.LiftBoardNode < graph.NodeCount) {
                        node = p.LiftBoardNode;
                    } else if (p.Server >= 0 && p.Server < graph.Servers.Count) {
                        node = graph.Servers[p.Server].Node;
                    } else {
                        node = NearestNode(graph, p.X, p.Y, p.Z);
                    }
                    if (node < 0 || node >= graph.NodeCount) continue;
                    if (graph.NodeZone[node] != StationWalkGraphBuilder.ZoneOutside) standing++;
                }
            }
            double stationArea = graph != null ? graph.StationArea : 0;
            return new StationStatisticsSnapshot {
                Tick = tick,
                SimTime = now,
                Population = passengers.Count,
                CrowdLos = StationLos.Compute(stationArea, standing),
                LeftBehind = LeftBehind,
                Boarded = Boarded,
                Alighted = Alighted,
                Exited = Exited,
                TrainArrivals = trainArrivals,
                TrainsLate = activeTrains,
                GateQueue = GateQueueTotal,
                EscalatorQueue = EscalatorQueueTotal,
                LiftQueue = LiftQueueTotal,
                DoorQueue = DoorQueueTotal,
                Period = string.IsNullOrEmpty(period) ? "offpeak" : period,
                AgentsCap = CapHit > 0,
                TickMs = tickMs,
                Stuck = Stuck,
            };
        }

        /// <summary>Document families this slice does not simulate, reported rather than faked.</summary>
        public IReadOnlyList<string> Unported => unported;

        public void Build(StationSessionDocument next, StationWalkGraph walkGraph, uint newSeed) {
            seed = newSeed;
            rng = new SimulationRng(seed);
            var staged = BuildServiceFacts(next ?? new StationSessionDocument(), walkGraph);
            InstallFacts(staged);
            ResetRunActorsAndCounters();
        }

        /// <summary>Empty the crowd and reseed the stream — the source's <c>World.restart()</c>.</summary>
        public void Restart() {
            rng = new SimulationRng(seed);
            passengers.Clear();
            nextPassengerId = 0;
            watches.Clear();
            Spawned = Onboard = Boarded = BoardingsThisTick = Alighted = LeftBehind = Exited = Stuck = CapHit = 0;
            for (int i = 0; i < gates.Count; i++) { gates[i].Queue.Clear(); gates[i].Cooldown = 0; gates[i].Served = 0; gates[i].Lane = 0; gates[i].Admitted = 0; gates[i].AdmittedAt = double.NegativeInfinity; }
            for (int i = 0; i < doors.Count; i++) { doors[i].Queue.Clear(); doors[i].Cooldown = 0; doors[i].Served = 0; doors[i].Admitted = 0; doors[i].Rate = 0; }
            for (int i = 0; i < rides.Count; i++) { rides[i].Queue.Clear(); rides[i].Cooldown = 0; rides[i].Served = 0; rides[i].Admitted = 0; }
            for (int i = 0; i < lifts.Count; i++) {
                lifts[i].Queue.Clear(); lifts[i].Riders.Clear();
                lifts[i].CarZ = lifts[i].Stops.Length > 0 ? lifts[i].Stops[0] : 0;
                lifts[i].CarDoor = 0; lifts[i].CarStop = 0; lifts[i].Served = 0; lifts[i].Admitted = 0;
            }
            Invalidate();
            PublishServerCounts();
        }

        /// <summary>The per-berth capacity of a (line, track) service, from the platform run it stops at.</summary>
        /// <summary>
        /// `trainRatedCapacity(line)`: the rated load the service publishes. The source
        /// publishes it and does **not** gate boarding on it (`World.boardRider` has no
        /// capacity check), so the trace's saturated consist keeps taking riders past the
        /// rated load; this number is a published fact, not an admission rule.
        /// </summary>
        public int CapacityFor(string lineId, string trackId) {
            var line = FindLine(lineId);
            return StationServiceCadence.RatedCapacity(line.Stock, line.Cars > 0 ? line.Cars : 1);
        }

        /// <summary>The service's eligible doorway count (`train.doors.length`): modelled doors.</summary>
        public int DoorCountFor(string lineId, string trackId) =>
            doorsByService.TryGetValue((lineId ?? "") + "|" + (trackId ?? ""), out var serviceDoors) ? serviceDoors.Count : 0;

        /// <summary>Passengers aboard a (line, track) service right now.</summary>
        public int OnboardFor(string lineId, string trackId) =>
            watches.TryGetValue((lineId ?? "") + "|" + (trackId ?? ""), out TrainWatch watch) ? watch.Onboard : 0;

        /// <summary>Boarders waiting in a (line, track)'s doorway queues.</summary>
        public int WaitingFor(string lineId, string trackId) {
            int total = 0;
            for (int i = 0; i < doors.Count; i++)
                if (doors[i].LineId == lineId && doors[i].TrackId == trackId) total += doors[i].Queue.Count;
            return total;
        }

        /// <summary>Alighting passengers of a (line, track) that are still in the cabin or a doorway.</summary>
        public int AlightInFlightFor(string lineId, string trackId) =>
            watches.TryGetValue((lineId ?? "") + "|" + (trackId ?? ""), out TrainWatch watch) ? watch.InFlightTotal : 0;

        /// <summary>
        /// The readable doorway state of a (line, track) service: the same numbers
        /// `loadAlighting`/`stepAlighting` keep, door for door. A test asserts the source's
        /// stop against this rather than reading a private field.
        /// </summary>
        public bool TryDoorStates(string lineId, string trackId, out StationServiceDoorState[] states) {
            states = Array.Empty<StationServiceDoorState>();
            if (!doorsByService.TryGetValue((lineId ?? "") + "|" + (trackId ?? ""), out var serviceDoors)) return false;
            watches.TryGetValue((lineId ?? "") + "|" + (trackId ?? ""), out TrainWatch watch);
            states = new StationServiceDoorState[serviceDoors.Count];
            for (int i = 0; i < serviceDoors.Count; i++) {
                var door = serviceDoors[i];
                states[i] = new StationServiceDoorState {
                    Id = door.Id, PlatformId = door.PlatformId, Index = door.Index,
                    Node = door.Node, X = door.X, Y = door.Y, Z = door.Z, Offset = door.Offset,
                    CabinRows = watch != null && i < watch.CabinRows.Length ? watch.CabinRows[i] : 0,
                    InFlight = watch != null && i < watch.InFlight.Length ? watch.InFlight[i] : 0,
                    Cadence = watch != null && i < watch.DoorT.Length ? watch.DoorT[i] : 0,
                    Released = door.Rate > 0,
                    Queued = door.Queue.Count,
                    Boarded = watch != null && i < watch.Boardings.Length ? watch.Boardings[i] : 0,
                };
            }
            return true;
        }

        /// <summary>
        /// Fixture seam: queue <paramref name="perDoor"/> riders at every doorway of a
        /// service, the same doorway queue a walking boarder joins. A test (and the TS
        /// oracle recorder) use it so the stop's boarding order is comparable without the
        /// street-demand RNG in the way.
        /// </summary>
        public int SeedDoorRiders(string lineId, string trackId, int perDoor) {
            if (perDoor <= 0 || !doorsByService.TryGetValue((lineId ?? "") + "|" + (trackId ?? ""), out var serviceDoors)) return 0;
            int seeded = 0;
            for (int d = 0; d < serviceDoors.Count; d++) {
                var door = serviceDoors[d];
                if (door.Node < 0) continue;
                for (int k = 0; k < perDoor; k++) {
                    if (passengers.Count >= options.MaxPassengers) return seeded;
                    var passenger = new Passenger {
                        Id = ++nextPassengerId,
                        X = graph.NodeX[door.Node] + (k % 2 == 0 ? -.22 : .22),
                        Y = graph.NodeY[door.Node] + (k % 3 - 1) * .18,
                        Z = graph.NodeZ[door.Node],
                        Boards = true,
                        TargetLineId = lineId ?? "",
                        RouteGraphEpoch = graphEpoch,
                        Phase = Phase.Queuing,
                        Server = door.Server,
                        ServerId = "door:" + door.Id,
                        DoorNode = door.Node,
                        Activity = StationPassengerActivity.Queue,
                        ActivityStart = simTime,
                        ActivityTotal = 12,
                        WalkWeight = 0,
                    };
                    passenger.IdentityFactor = 0.9 + IdentityUnit(passenger.Id, 0x85a308d3u) * 0.2;
                    passenger.Speed = WalkSpeed * passenger.IdentityFactor;
                    passenger.WalkPhase = IdentityUnit(passenger.Id, 0x9e3779b9u);
                    passengers.Add(passenger);
                    StandAt(passenger, door.Node);
                    door.Queue.Add(passenger.Id);
                    Spawned++;
                    seeded++;
                }
            }
            Invalidate();
            return seeded;
        }

        /// <summary>
        /// Fixture seam: queue <paramref name="count"/> entry riders at one fare gate, the
        /// same queue a walking passenger joins. It lets a probe (and the binding report)
        /// observe the service's own lane cycle without depending on street-demand RNG or
        /// a long walk from an entrance.
        /// </summary>
        public int SeedGateRiders(string gateId, int count) {
            if (count <= 0 || string.IsNullOrEmpty(gateId)) return 0;
            GateFact gate = null;
            for (int i = 0; i < gates.Count; i++) {
                if (string.Equals(gates[i].Id, gateId, StringComparison.Ordinal)) { gate = gates[i]; break; }
            }
            if (gate == null || gate.Node < 0) return 0;
            int seeded = 0;
            for (int k = 0; k < count; k++) {
                if (passengers.Count >= options.MaxPassengers) break;
                var passenger = new Passenger {
                    Id = ++nextPassengerId,
                    X = graph.NodeX[gate.Node] + (k % 2 == 0 ? -.22 : .22),
                    Y = graph.NodeY[gate.Node] + (k % 3 - 1) * .18,
                    Z = graph.NodeZ[gate.Node],
                    Boards = true,
                    TargetLineId = document != null && document.Lines.Count > 0 ? document.Lines[0].Id : "",
                    RouteGraphEpoch = graphEpoch,
                    Phase = Phase.Queuing,
                    Server = gate.Server,
                    ServerId = "gate:" + gate.Id,
                    GateServer = gate.Server,
                    GateDir = gate.Mode > 0 ? 1 : gate.Mode < 0 ? -1 : 1,
                    Activity = StationPassengerActivity.Queue,
                    ActivityStart = simTime,
                    ActivityTotal = 12,
                    WalkWeight = 0,
                };
                passenger.IdentityFactor = 0.9 + IdentityUnit(passenger.Id, 0x85a308d3u) * 0.2;
                passenger.Speed = WalkSpeed * passenger.IdentityFactor;
                passenger.WalkPhase = IdentityUnit(passenger.Id, 0x9e3779b9u);
                passengers.Add(passenger);
                StandAt(passenger, gate.Node);
                gate.Queue.Add(passenger.Id);
                Spawned++;
                seeded++;
            }
            Invalidate();
            return seeded;
        }

        /// <summary>
        /// The whole service tick, in the source's order after dispatch: seat the
        /// berthing consist's alighting wave and let it out, spawn street demand,
        /// serve the queues that already exist, then move everyone. A passenger
        /// that joins a queue during movement is therefore served in the *next*
        /// tick's service step, exactly as `World.tickOnce` orders it.
        /// </summary>
        public void Step(double now, bool serviceOpen, double demandRate, StationTrainFrame[] trains) {
            simTime = now;
            BoardingsThisTick = 0;
            for (int i = 0; i < gates.Count; i++) gates[i].Admitted = 0;
            for (int i = 0; i < doors.Count; i++) doors[i].Admitted = 0;
            for (int i = 0; i < rides.Count; i++) rides[i].Admitted = 0;
            for (int i = 0; i < lifts.Count; i++) lifts[i].Admitted = 0;
            PriceCrowd();
            RefreshGateTraffic();
            walkReplans = queueReplans = gateReplans = patienceReplans = 0;
            StepConsists(trains);
            StepSpawn(serviceOpen, demandRate);
            StepGates();
            StepRides();
            StepDoors(trains);
            StepLiftQueues();
            StepPassengers();
            SeparateWalkers();
            Compact();
            PublishServerCounts();
            Invalidate();
        }

        /// <summary>The called stop for a lift car: a rider still aboard first, then the queue front. -1 when idle.</summary>
        public int NextLiftCall(string liftId, int[] stops) {
            if (liftId == null || !liftById.TryGetValue(liftId, out LiftConnector car)) return -1;
            for (int i = 0; i < car.Riders.Count; i++) {
                var rider = Find(car.Riders[i]);
                if (rider == null || rider.LiftDestStop < 0) continue;
                if (rider.LiftDestStop != car.CarStop) return rider.LiftDestStop;
            }
            for (int i = 0; i < car.Queue.Count; i++) {
                var waiting = Find(car.Queue[i]);
                if (waiting == null || waiting.LiftBoardStop < 0) continue;
                return waiting.LiftBoardStop;
            }
            return -1;
        }

        /// <summary>Report the car's own pose so its riders ride with it.</summary>
        public void SyncLift(string liftId, double carZ, double doorFraction, int stop) {
            if (liftId == null || !liftById.TryGetValue(liftId, out LiftConnector car)) return;
            car.CarZ = carZ;
            car.CarDoor = doorFraction;
            car.CarStop = stop;
        }

        /// <summary>True while any rider on this shaft is walking through its open doorway.</summary>
        public bool IsLiftExchanging(string liftId) {
            if (string.IsNullOrEmpty(liftId)) return false;
            for (int i = 0; i < passengers.Count; i++) {
                var p = passengers[i];
                if (p.Phase != Phase.LiftRiding) continue;
                if (p.LiftPhase != 0 && p.LiftPhase != 2) continue;
                if (string.Equals(p.LiftId, liftId, StringComparison.Ordinal)) return true;
            }
            return false;
        }

        /// <summary>With the doors open at a stop, let riders walk out and waiting passengers walk in.</summary>
        public void LiftExchange(string liftId, int stop, bool allowBoarding = true) {
            if (liftId == null || !liftById.TryGetValue(liftId, out LiftConnector car)) return;
            if (car.CarDoor < 1 - 1e-9) return;
            for (int i = car.Riders.Count - 1; i >= 0; i--) {
                var rider = Find(car.Riders[i]);
                if (rider == null) { car.Riders.RemoveAt(i); continue; }
                if (rider.LiftDestStop != stop || rider.LiftPhase != 1) continue;
                car.Riders.RemoveAt(i);
                int destNode = rider.LiftDestNode;
                double destX = destNode >= 0 && destNode < graph.NodeCount ? graph.NodeX[destNode] : rider.X;
                double destY = destNode >= 0 && destNode < graph.NodeCount ? graph.NodeY[destNode] : rider.Y;
                LiftDoorThreshold(car, destX, destY, rider.X, rider.Y, out double doorX, out double doorY);
                rider.LiftPhase = 2;
                rider.LiftThresholdDone = false;
                rider.FromX = doorX;
                rider.FromY = doorY;
                rider.ToX = destX;
                rider.ToY = destY;
                rider.Activity = StationPassengerActivity.Walk;
                rider.WalkWeight = 1;
                rider.ServerId = "lift:" + car.Id;
            }
            if (!allowBoarding) return;
            // Let exiting riders clear the doorway before incoming passengers walk in.
            for (int i = 0; i < passengers.Count; i++) {
                var p = passengers[i];
                if (p.Phase == Phase.LiftRiding && p.LiftPhase == 2 &&
                    string.Equals(p.LiftId, liftId, StringComparison.Ordinal)) return;
            }
            const double LiftBoardRadius = 2.2;
            while (car.Riders.Count < LiftBatch) {
                int at = -1;
                for (int i = 0; i < car.Queue.Count; i++) {
                    var waiting = Find(car.Queue[i]);
                    if (waiting == null) { car.Queue.RemoveAt(i); i--; continue; }
                    if (waiting.LiftBoardStop != stop) continue;
                    if (waiting.LiftBoardNode >= 0 && waiting.LiftBoardNode < graph.NodeCount) {
                        double bx = graph.NodeX[waiting.LiftBoardNode], by = graph.NodeY[waiting.LiftBoardNode];
                        double dx = waiting.X - bx, dy = waiting.Y - by;
                        if (dx * dx + dy * dy > LiftBoardRadius * LiftBoardRadius) continue;
                        LiftDoorOutward(car, bx, by, out double ox, out double oy);
                        double frontDepth = (waiting.X - car.X) * ox + (waiting.Y - car.Y) * oy;
                        if (frontDepth < car.Size * .5 - .1) continue;
                    }
                    at = i;
                    break;
                }
                if (at < 0) break;
                var passenger = Find(car.Queue[at]);
                car.Queue.RemoveAt(at);
                if (passenger == null) continue;
                int slot = PickFreeLiftSlot(car);
                double boardX = passenger.LiftBoardNode >= 0 && passenger.LiftBoardNode < graph.NodeCount
                    ? graph.NodeX[passenger.LiftBoardNode] : passenger.X;
                double boardY = passenger.LiftBoardNode >= 0 && passenger.LiftBoardNode < graph.NodeCount
                    ? graph.NodeY[passenger.LiftBoardNode] : passenger.Y;
                LiftDoorThreshold(car, boardX, boardY, passenger.X, passenger.Y, out double doorX, out double doorY);
                LiftCabinSlot(car, slot, out double slotX, out double slotY);
                passenger.Phase = Phase.LiftRiding;
                passenger.LiftPhase = 0;
                passenger.LiftSlot = slot;
                passenger.LiftThresholdDone = false;
                passenger.FromX = doorX;
                passenger.FromY = doorY;
                passenger.ToX = slotX;
                passenger.ToY = slotY;
                passenger.Activity = StationPassengerActivity.Walk;
                passenger.WalkWeight = 1;
                passenger.ServerId = "lift:" + car.Id;
                car.Riders.Add(passenger.Id);
                car.Admitted++;
                car.Served++;
            }
        }

        /// <summary>The published passenger set, rebuilt once per tick and then cached.</summary>
        public StationPassengerFrame[] PassengerFrames() {
            if (frameCacheVersion == frameVersion) return frameCache;
            var frames = new StationPassengerFrame[passengers.Count];
            for (int i = 0; i < passengers.Count; i++) frames[i] = Frame(passengers[i]);
            frameCache = frames;
            frameCacheVersion = frameVersion;
            return frames;
        }

        /// <summary>The published gate set, in document order. Cheap: rebuilt per read.</summary>
        public StationGateFrame[] GateFrames() {
            var frames = new StationGateFrame[gates.Count];
            for (int i = 0; i < gates.Count; i++) {
                var gate = gates[i];
                var state = gate.Queue.Count == 0
                    ? (gate.Admitted > 0 ? StationGateState.Serving : StationGateState.Idle)
                    : gate.Admitted > 0 ? StationGateState.Serving : StationGateState.Queueing;
                frames[i] = new StationGateFrame {
                    Id = gate.Id, Server = gate.Server, Node = gate.Node,
                    Queue = gate.Queue.Count, Served = gate.Served,
                    Rate = gate.Rate, Batch = gate.Batch, Cycle = gate.Cycle,
                    State = state, Mode = gate.Mode,
                    Lane = gate.Lane,
                    Open = GateLeafOpenPeak(gate.AdmittedAt, simTime - Dt, simTime),
                };
            }
            return frames;
        }

        /// <summary>The service state for one document gate module id, for a test or a panel.</summary>
        public bool TryGateFrame(string gateId, out StationGateFrame frame) {
            var frames = GateFrames();
            for (int i = 0; i < frames.Length; i++) {
                if (!string.Equals(frames[i].Id, gateId, StringComparison.Ordinal)) continue;
                frame = frames[i];
                return true;
            }
            frame = default;
            return false;
        }

        // --------------------------------------------------------------- building

        internal static StagedServiceFacts StageCellDelta(
            StationSessionDocument doc,
            StationWalkGraph walkGraph,
            StationWalkGraphDelta graphDelta) =>
            BuildServiceFacts(doc, walkGraph);

        internal static StagedServiceFacts BuildServiceFacts(StationSessionDocument doc, StationWalkGraph walkGraph) {
            var staged = new StagedServiceFacts {
                Document = doc ?? new StationSessionDocument(),
                Graph = walkGraph,
                Planner = walkGraph != null ? new StationRoutePlanner(walkGraph) : null,
            };

            staged.Unported.Add("errands:shop,shelf,bench,cubicle,sink");
            staged.Unported.Add("transfers:second-line");
            staged.Unported.Add("consist-geometry");
            if (walkGraph == null || doc == null) return staged;

            // Index gate & door servers by Node once in O(|Servers|) instead of linear-scanning per module:
            var gateServerByNode = new Dictionary<int, StationServerFact>();
            var doorServerByNode = new Dictionary<int, int>();
            for (int s = 0; s < walkGraph.Servers.Count; s++) {
                var srv = walkGraph.Servers[s];
                if (srv.Kind == "gate" && !gateServerByNode.ContainsKey(srv.Node)) {
                    gateServerByNode[srv.Node] = srv;
                } else if (srv.Kind == "door" && !doorServerByNode.ContainsKey(srv.Node)) {
                    doorServerByNode[srv.Node] = s;
                }
            }

            // Gates: one server per walkable gate cell, keyed by the gate module id.
            var gateModules = doc.ModulesOfType("gate");
            for (int i = 0; i < gateModules.Count; i++) {
                var module = gateModules[i];
                if (!module.GateHasLane) continue;
                if (!walkGraph.TryNode(module.X, module.Y, module.Z, out int node)) continue;
                if (!gateServerByNode.TryGetValue(node, out var server) || server == null) continue;
                var gate = new GateFact {
                    Id = module.Id ?? "", Server = server.Id, Node = node, Mode = module.GateDir, Rotation = module.Rot,
                    Rate = server.Rate > 0 ? server.Rate : StationWalkGraphBuilder.GateRate,
                    Batch = Math.Max(1, server.Batch), Cycle = server.Cycle,
                };
                staged.Gates.Add(gate);
                staged.GateByServer[gate.Server] = gate;
                staged.GateByNode[gate.Node] = gate;
            }

            // Platform doorways: one per *modelled passenger door* on the cells the door
            // cadence stands at (`doorRunOffsets`), exactly as `sim/station.ts` seats its
            // `kind: 'door'` servers.
            for (int i = 0; i < doc.Lines.Count; i++) {
                var line = doc.Lines[i];
                var tracks = doc.ServiceTracks(line.Id);
                if (tracks.Count == 0) tracks.Add(default);
                for (int t = 0; t < tracks.Count; t++) {
                    string trackId = tracks[t].Id ?? "";
                    var slots = StationServiceDoors.ForService(doc, walkGraph, line.Id, trackId, out var doorNotes);
                    for (int n = 0; n < doorNotes.Count; n++) if (!staged.Unported.Contains(doorNotes[n])) staged.Unported.Add(doorNotes[n]);
                    if (slots.Count == 0) {
                        staged.Unported.Add("platform-doors:" + line.Id + "|" + trackId);
                        continue;
                    }
                    var serviceDoors = new List<DoorFact>(slots.Count);
                    for (int s = 0; s < slots.Count; s++) {
                        var slot = slots[s];
                        var door = new DoorFact {
                            Id = slot.Id, PlatformId = slot.PlatformId, LineId = line.Id, TrackId = trackId,
                            Index = slot.Index, Node = slot.Node, X = slot.X, Y = slot.Y, Z = slot.Z, Offset = slot.Offset,
                        };
                        serviceDoors.Add(door);
                        staged.Doors.Add(door);
                        if (door.Node >= 0 && doorServerByNode.TryGetValue(door.Node, out int srv)) {
                            door.Server = srv;
                            staged.DoorByServer[srv] = door;
                        }
                    }
                    staged.DoorsByService[ServiceKey(line.Id, trackId)] = serviceDoors;
                }
            }

            // Vertical rides: the document's capacity-limited edges.
            for (int s = 0; s < walkGraph.Servers.Count; s++) {
                var server = walkGraph.Servers[s];
                if (server.ExitNode < 0 || server.Ride <= 0) continue;
                WalkEdgeKind kind;
                switch (server.Kind) {
                    case "escalator": kind = WalkEdgeKind.Escalator; break;
                    case "walkway": kind = WalkEdgeKind.Walkway; break;
                    case "stair": kind = WalkEdgeKind.Stair; break;
                    default: continue;
                }
                var ride = new RideFact { Server = s, Node = server.Node, ExitNode = server.ExitNode, Kind = kind, Rate = server.Rate, Ride = server.Ride,
                    Path = server.RidePath, Reverse = server.RideReverse, Columns = server.RideColumns };
                staged.Rides.Add(ride);
                staged.RideByServer[s] = ride;
            }

            // Lift connectors: the landing rows on each side of a shaft.
            var liftModules = doc.ModulesOfType("lift");
            for (int i = 0; i < liftModules.Count; i++) {
                var module = liftModules[i];
                if (!module.HasEndpoints) continue;
                int size = module.Width >= 3 ? 3 : 2;
                var stops = StationLiftStops.Levels(module);
                int loZ = Math.Min(module.FromZ, module.ToZ), hiZ = Math.Max(module.FromZ, module.ToZ);
                if (hiZ - loZ < 1) continue;
                var landings = new int[stops.Count];
                int servedStops = 0;
                for (int s = 0; s < stops.Count; s++) {
                    landings[s] = LandingNode(walkGraph, module, size, stops[s]);
                    if (landings[s] >= 0) servedStops++;
                }
                if (servedStops < 2) { staged.Unported.Add("lift-landing:" + module.Id); continue; }
                var connector = new LiftConnector {
                    Id = module.Id ?? "", Landings = landings,
                    X = module.X + size * .5, Y = module.Y + size * .5,
                    Size = size, Rotation = (module.Rot % 4 + 4) % 4,
                    Stops = stops.ToArray(), CarZ = stops[0], CarStop = 0,
                };
                staged.Lifts.Add(connector);
                staged.Planner.AddLift(connector.Id, landings, () => LiftQueueWait(connector));
                staged.LiftById[connector.Id] = connector;
            }

            // Exits in document order: the source's street-spawn entrances.
            for (int i = 0; i < walkGraph.Exits.Count; i++) {
                var exit = walkGraph.Exits[i];
                if (exit != null && exit.Node >= 0) {
                    staged.Exits.Add(exit);
                    staged.ExitNodes.Add(exit.Node);
                }
            }

            return staged;
        }

        void InstallFacts(StagedServiceFacts staged) {
            document = staged?.Document ?? new StationSessionDocument();
            graph = staged?.Graph;
            planner = staged?.Planner;
            nearbyCrowd.Clear();
            if (planner != null) {
                planner.Congestion = CongestionAt;
                planner.GateWait = GateWait;
            }
            graphEpoch++;
            gates.Clear(); gateByServer.Clear(); gateByNode.Clear();
            doors.Clear(); doorByServer.Clear(); doorsByService.Clear();
            rides.Clear(); rideByServer.Clear();
            lifts.Clear(); liftById.Clear();
            exits.Clear(); exitNodes.Clear();
            berths.Clear();
            unported.Clear();
            if (staged == null) return;
            gates.AddRange(staged.Gates);
            foreach (var kv in staged.GateByServer) gateByServer[kv.Key] = kv.Value;
            foreach (var kv in staged.GateByNode) gateByNode[kv.Key] = kv.Value;
            doors.AddRange(staged.Doors);
            foreach (var kv in staged.DoorByServer) doorByServer[kv.Key] = kv.Value;
            foreach (var kv in staged.DoorsByService) doorsByService[kv.Key] = kv.Value;
            rides.AddRange(staged.Rides);
            foreach (var kv in staged.RideByServer) rideByServer[kv.Key] = kv.Value;
            lifts.AddRange(staged.Lifts);
            foreach (var kv in staged.LiftById) liftById[kv.Key] = kv.Value;
            exits.AddRange(staged.Exits);
            exitNodes.AddRange(staged.ExitNodes);
            unported.AddRange(staged.Unported);
        }

        void ResetRunActorsAndCounters() {
            watches.Clear();
            passengers.Clear();
            nextPassengerId = 0;
            Spawned = Onboard = Boarded = BoardingsThisTick = Alighted = LeftBehind = Exited = Stuck = CapHit = 0;
            Invalidate();
            PublishServerCounts();
        }

        internal void ApplyCosmeticDocument(StationSessionDocument next) {
            document = next ?? new StationSessionDocument();
            Invalidate();
        }

        void ReconcileTrainWatches() {
            foreach (var pair in watches) {
                var watch = pair.Value;
                var newDoors = doorsByService.TryGetValue(watch.Key, out var heldDoors) ? heldDoors : new List<DoorFact>();
                bool same = DoorsMatch(watch.Doors, newDoors);
                if (same) {
                    for (int d = 0; d < newDoors.Count; d++) newDoors[d].Rate = watch.Doors[d].Rate;
                    watch.Doors = newDoors;
                    watch.Capacity = CapacityFor(watch.LineId, watch.TrackId);
                    for (int i = 0; i < passengers.Count; i++) {
                        var rider = passengers[i];
                        if (rider.Phase == Phase.Dead || !string.Equals(rider.TrainKey, watch.Key, StringComparison.Ordinal)) continue;
                        rider.DoorNode = rider.TrainDoor >= 0 && rider.TrainDoor < newDoors.Count ? newDoors[rider.TrainDoor].Node : -1;
                        rider.DestExit = ResolveExitNode(rider.DestExitId);
                        rider.RouteGraphEpoch = graphEpoch;
                    }
                } else {
                    for (int i = passengers.Count - 1; i >= 0; i--) {
                        var rider = passengers[i];
                        if (rider.Phase == Phase.Dead || !string.Equals(rider.TrainKey, watch.Key, StringComparison.Ordinal)) continue;
                        if (rider.Phase == Phase.TrainRiding) Onboard = Math.Max(0, Onboard - 1);
                        Kill(rider);
                    }
                    watch.Doors = newDoors;
                    watch.Capacity = CapacityFor(watch.LineId, watch.TrackId);
                    watch.ResetDoors(newDoors.Count);
                    watch.AlightLeft = 0;
                    watch.Onboard = 0;
                    watch.Seated = false;
                }
            }
        }

        /// <summary>
        /// Incremental local-edit actor reconciliation: preserves unaffected server cooldowns,
        /// served counts, FIFO queues, lift poses and passenger routes (remapping dense node ids),
        /// while replanning only passengers whose node, server, destination or remaining path was
        /// touched by the edit.
        /// </summary>
        internal void ApplyIncrementalStagedEdit(StagedServiceFacts staged, StationWalkGraphDelta delta) {
            LastReconciledPassengers = 0;
            if (delta == null) {
                ApplyStagedEdit(staged);
                return;
            }

            int oldLimit = Math.Min(delta.OldNodeCount, delta.OldToNewNode.Length);
            int touchedLimit = Math.Min(delta.OldNodeCount, delta.OldNodeTouched.Length);
            int MapOldNode(int oldN) =>
                (oldN >= 0 && oldN < oldLimit) ? delta.OldToNewNode[oldN] : -1;

            // Snapshot previous server states before InstallFacts clears them:
            var oldGatesById = new Dictionary<string, GateFact>(gates.Count, StringComparer.Ordinal);
            var oldGatesByServer = new Dictionary<int, GateFact>(gates.Count);
            for (int i = 0; i < gates.Count; i++) {
                var g = gates[i];
                if (!string.IsNullOrEmpty(g.Id)) oldGatesById[g.Id] = g;
                if (g.Server >= 0) oldGatesByServer[g.Server] = g;
            }
            var oldDoorsById = new Dictionary<string, DoorFact>(doors.Count, StringComparer.Ordinal);
            for (int i = 0; i < doors.Count; i++) {
                var d = doors[i];
                if (!string.IsNullOrEmpty(d.Id)) oldDoorsById[d.Id] = d;
            }
            var oldRidesByServer = new Dictionary<int, RideFact>(rides.Count);
            var oldRidesByKey = new Dictionary<(WalkEdgeKind Kind, int Node, int ExitNode), RideFact>(rides.Count);
            for (int i = 0; i < rides.Count; i++) {
                var r = rides[i];
                if (r.Server >= 0) oldRidesByServer[r.Server] = r;
                int nn = MapOldNode(r.Node), ne = MapOldNode(r.ExitNode);
                if (nn >= 0 && ne >= 0) oldRidesByKey[(r.Kind, nn, ne)] = r;
            }
            var oldLiftsById = new Dictionary<string, LiftConnector>(lifts.Count, StringComparer.Ordinal);
            for (int i = 0; i < lifts.Count; i++) {
                var l = lifts[i];
                if (!string.IsNullOrEmpty(l.Id)) oldLiftsById[l.Id] = l;
            }

            InstallFacts(staged);
            ReconcileTrainWatches();

            var newGatesById = new Dictionary<string, GateFact>(gates.Count, StringComparer.Ordinal);
            for (int i = 0; i < gates.Count; i++) {
                var ng = gates[i];
                if (!string.IsNullOrEmpty(ng.Id)) newGatesById[ng.Id] = ng;
                if (!string.IsNullOrEmpty(ng.Id) && oldGatesById.TryGetValue(ng.Id, out var og) &&
                    og.Mode == ng.Mode && MapOldNode(og.Node) == ng.Node) {
                    ng.Cooldown = og.Cooldown;
                    ng.Served = og.Served;
                    ng.Lane = og.Lane;
                    ng.AdmittedAt = og.AdmittedAt;
                }
            }
            var newDoorsById = new Dictionary<string, DoorFact>(doors.Count, StringComparer.Ordinal);
            for (int i = 0; i < doors.Count; i++) {
                var nd = doors[i];
                if (!string.IsNullOrEmpty(nd.Id)) newDoorsById[nd.Id] = nd;
                if (!string.IsNullOrEmpty(nd.Id) && oldDoorsById.TryGetValue(nd.Id, out var od) &&
                    MapOldNode(od.Node) == nd.Node) {
                    nd.Cooldown = od.Cooldown;
                    nd.Served = od.Served;
                }
            }
            var newRidesByKey = new Dictionary<(WalkEdgeKind Kind, int Node, int ExitNode), RideFact>(rides.Count);
            for (int i = 0; i < rides.Count; i++) {
                var nr = rides[i];
                newRidesByKey[(nr.Kind, nr.Node, nr.ExitNode)] = nr;
                if (oldRidesByKey.TryGetValue((nr.Kind, nr.Node, nr.ExitNode), out var oride) &&
                    Math.Abs(oride.Rate - nr.Rate) < 1e-9) {
                    nr.Cooldown = oride.Cooldown;
                    nr.Served = oride.Served;
                }
            }
            var intactLifts = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < lifts.Count; i++) {
                var nl = lifts[i];
                if (!string.IsNullOrEmpty(nl.Id) && oldLiftsById.TryGetValue(nl.Id, out var ol) &&
                    ol.Size == nl.Size && ol.Rotation == nl.Rotation &&
                    SameStops(ol.Stops, nl.Stops) &&
                    LiftLandingsMatch(ol, nl, MapOldNode)) {
                    nl.CarZ = ol.CarZ;
                    nl.CarDoor = ol.CarDoor;
                    nl.CarStop = ol.CarStop;
                    nl.Served = ol.Served;
                    intactLifts.Add(nl.Id);
                }
            }

            if (passengers.Count == 0) {
                PublishServerCounts();
                Invalidate();
                return;
            }

            var paxById = new Dictionary<int, Passenger>(passengers.Count);
            var preservedIds = new HashSet<int>();
            var toReplan = new List<Passenger>();

            for (int i = 0; i < passengers.Count; i++) {
                var p = passengers[i];
                if (p.Phase == Phase.Dead) continue;
                if (!string.IsNullOrEmpty(p.TrainKey)) {
                    if (!watches.ContainsKey(p.TrainKey)) {
                        if (p.Phase == Phase.TrainRiding) Onboard = Math.Max(0, Onboard - 1);
                        Kill(p);
                    }
                    continue;
                }
                paxById[p.Id] = p;
                if (TryPreservePassenger(p, delta, oldGatesByServer, oldRidesByServer, newGatesById, newDoorsById, newRidesByKey, intactLifts)) {
                    preservedIds.Add(p.Id);
                } else {
                    toReplan.Add(p);
                }
            }

            // Restore preserved passengers into their servers' FIFO queues in exact previous order:
            foreach (var kv in newGatesById) {
                if (oldGatesById.TryGetValue(kv.Key, out var og)) {
                    for (int q = 0; q < og.Queue.Count; q++) {
                        int pid = og.Queue[q];
                        if (preservedIds.Contains(pid) && paxById.TryGetValue(pid, out var p) &&
                            p.Phase == Phase.Queuing && p.Server == kv.Value.Server) {
                            kv.Value.Queue.Add(pid);
                        }
                    }
                }
            }
            foreach (var kv in newDoorsById) {
                if (oldDoorsById.TryGetValue(kv.Key, out var od)) {
                    for (int q = 0; q < od.Queue.Count; q++) {
                        int pid = od.Queue[q];
                        if (preservedIds.Contains(pid) && paxById.TryGetValue(pid, out var p) &&
                            p.Phase == Phase.Queuing && p.Server == kv.Value.Server) {
                            kv.Value.Queue.Add(pid);
                        }
                    }
                }
            }
            foreach (var kv in newRidesByKey) {
                if (oldRidesByKey.TryGetValue(kv.Key, out var oride)) {
                    for (int q = 0; q < oride.Queue.Count; q++) {
                        int pid = oride.Queue[q];
                        if (preservedIds.Contains(pid) && paxById.TryGetValue(pid, out var p) &&
                            p.Phase == Phase.Queuing && p.Server == kv.Value.Server) {
                            kv.Value.Queue.Add(pid);
                        }
                    }
                }
            }
            foreach (string lid in intactLifts) {
                if (oldLiftsById.TryGetValue(lid, out var ol) && liftById.TryGetValue(lid, out var nl)) {
                    for (int q = 0; q < ol.Queue.Count; q++) {
                        int pid = ol.Queue[q];
                        if (preservedIds.Contains(pid)) nl.Queue.Add(pid);
                    }
                    for (int r = 0; r < ol.Riders.Count; r++) {
                        int pid = ol.Riders[r];
                        if (preservedIds.Contains(pid)) nl.Riders.Add(pid);
                    }
                }
            }

            // Replan only the affected passengers:
            LastReconciledPassengers = toReplan.Count;
            for (int i = 0; i < toReplan.Count; i++) {
                ReplanSinglePassenger(toReplan[i], checkRoads: delta.AnyRoadAdded);
            }

            Compact();
            PublishServerCounts();
            Invalidate();
        }

        bool TryPreservePassenger(
            Passenger p,
            StationWalkGraphDelta delta,
            Dictionary<int, GateFact> oldGatesByServer,
            Dictionary<int, RideFact> oldRidesByServer,
            Dictionary<string, GateFact> newGatesById,
            Dictionary<string, DoorFact> newDoorsById,
            Dictionary<(WalkEdgeKind Kind, int Node, int ExitNode), RideFact> newRidesByKey,
            HashSet<string> intactLifts) {
            if (graph == null || planner == null) return false;
            int oldLimit = Math.Min(delta.OldNodeCount, delta.OldToNewNode.Length);
            int touchedLimit = Math.Min(delta.OldNodeCount, delta.OldNodeTouched.Length);
            int MapOld(int oldN) =>
                (oldN >= 0 && oldN < oldLimit) ? delta.OldToNewNode[oldN] : -1;
            bool IsTouched(int oldN) =>
                oldN < 0 || oldN >= touchedLimit || delta.OldNodeTouched[oldN];

            if (delta.AnyRoadAdded && p.Phase != Phase.Riding && p.Phase != Phase.LiftRiding &&
                RoadContainsPoint(document, p.X, p.Y, JsRound(p.Z) - 1)) {
                return false;
            }

            if (p.AwaitingRoute) {
                if (delta.ConnectivityIncreased) return false;
                p.RouteGraphEpoch = graphEpoch;
                return true;
            }

            // Check current phase & server validity:
            int remappedGateServer = -1;
            if (p.GateServer >= 0 && oldGatesByServer.TryGetValue(p.GateServer, out var passedOldGate) &&
                !string.IsNullOrEmpty(passedOldGate.Id) && newGatesById.TryGetValue(passedOldGate.Id, out var passedNewGate)) {
                remappedGateServer = passedNewGate.Server;
            }

            int updatedServer = p.Server;
            string updatedServerId = p.ServerId ?? "";
            int updatedDoorNode = p.DoorNode >= 0 ? MapOld(p.DoorNode) : -1;

            switch (p.Phase) {
                case Phase.Walking:
                    if (p.Route?.Segments == null || p.Segment < 0 || p.Segment >= p.Route.Segments.Length) return false;
                    break;
                case Phase.Queuing: {
                    if (updatedServerId.StartsWith("gate:", StringComparison.Ordinal)) {
                        string gid = updatedServerId.Substring(5);
                        if (!newGatesById.TryGetValue(gid, out var ng)) return false;
                        if (!GateLaneAllows(ng.Mode, 0, p.GateDir)) return false;
                        updatedServer = ng.Server;
                    } else if (updatedServerId.StartsWith("door:", StringComparison.Ordinal)) {
                        string did = updatedServerId.Substring(5);
                        int effectiveDoorNode = updatedDoorNode >= 0
                            ? updatedDoorNode
                            : (p.Path != null && p.Path.Length > 0 ? MapOld(p.Path[p.Path.Length - 1]) : -1);
                        if (!newDoorsById.TryGetValue(did, out var nd) || effectiveDoorNode < 0 || nd.Node != effectiveDoorNode) return false;
                        updatedServer = nd.Server;
                        p.Server = updatedServer;
                        p.DoorNode = effectiveDoorNode;
                        p.GateServer = remappedGateServer;
                        p.RouteGraphEpoch = graphEpoch;
                        if (p.Route?.Segments != null) RemapRouteSegmentsInPlace(p, delta.OldToNewNode, oldLimit);
                        return true;
                    } else if (updatedServerId.StartsWith("ride:", StringComparison.Ordinal)) {
                        if (!oldRidesByServer.TryGetValue(p.Server, out var oride)) return false;
                        int nn = MapOld(oride.Node), ne = MapOld(oride.ExitNode);
                        if (nn < 0 || ne < 0 || !newRidesByKey.TryGetValue((oride.Kind, nn, ne), out var nride)) return false;
                        if (!SameRideGeometry(oride, nride)) return false;
                        updatedServer = nride.Server;
                        updatedServerId = "ride:" + nride.Server;
                    } else {
                        return false;
                    }
                    break;
                }
                case Phase.Riding: {
                    if (!updatedServerId.StartsWith("ride:", StringComparison.Ordinal)) return false;
                    if (!int.TryParse(updatedServerId.Substring(5), out int oldSrv) || !oldRidesByServer.TryGetValue(oldSrv, out var oride)) return false;
                    int nn = MapOld(oride.Node), ne = MapOld(oride.ExitNode);
                    if (nn < 0 || ne < 0 || !newRidesByKey.TryGetValue((oride.Kind, nn, ne), out var nride)) return false;
                    if (!SameRideGeometry(oride, nride)) return false;
                    updatedServerId = "ride:" + nride.Server;
                    break;
                }
                case Phase.LiftQueuing:
                case Phase.LiftRiding: {
                    if (string.IsNullOrEmpty(p.LiftId) || !intactLifts.Contains(p.LiftId)) return false;
                    if (MapOld(p.LiftBoardNode) < 0 || MapOld(p.LiftDestNode) < 0) return false;
                    break;
                }
                default:
                    return false;
            }

            // Validate Route & remaining path nodes:
            var segments = p.Route?.Segments;
            if (segments == null || segments.Length == 0) return false;
            if (p.Route.Lifts != null) {
                for (int l = Math.Max(0, p.Segment); l < p.Route.Lifts.Length; l++) {
                    if (!intactLifts.Contains(p.Route.Lifts[l])) return false;
                }
            }

            for (int s = 0; s < segments.Length; s++) {
                var seg = segments[s];
                if (seg == null) return false;
                int touchCheckStart = s < p.Segment ? seg.Length : (s == p.Segment ? Math.Max(0, p.PathIndex) : 0);
                for (int k = 0; k < seg.Length; k++) {
                    int oldN = seg[k];
                    int mapped = MapOld(oldN);
                    if (mapped < 0) return false;
                    if (k >= touchCheckStart && IsTouched(oldN)) return false;
                    if (k > touchCheckStart && !planner.GatePassage(MapOld(seg[k - 1]), mapped, out _)) return false;
                }
            }

            // Validate final destination node:
            var lastSeg = segments[segments.Length - 1];
            if (lastSeg.Length == 0) return false;
            int newFinalNode = MapOld(lastSeg[lastSeg.Length - 1]);
            if (newFinalNode < 0) return false;
            if (p.Boards) {
                if (DoorForNodeAndLine(newFinalNode, p.TargetLineId) == null) return false;
            } else {
                int expectedExit = ResolveExitNode(p.DestExitId);
                if (expectedExit < 0 || newFinalNode != expectedExit) return false;
                p.DestExit = expectedExit;
            }

            // Commit in-place node remapping:
            RemapRouteSegmentsInPlace(p, delta.OldToNewNode, oldLimit);
            if (p.LiftBoardNode >= 0) p.LiftBoardNode = MapOld(p.LiftBoardNode);
            if (p.LiftDestNode >= 0) p.LiftDestNode = MapOld(p.LiftDestNode);
            if (p.DoorNode >= 0) p.DoorNode = updatedDoorNode;
            p.Server = updatedServer;
            p.ServerId = updatedServerId;
            p.GateServer = remappedGateServer;
            p.RouteGraphEpoch = graphEpoch;
            return true;
        }

        static bool SameRideGeometry(RideFact before, RideFact after) =>
            before.Columns == after.Columns && before.Reverse == after.Reverse &&
            (before.Path == null ? after.Path == null : before.Path.SameGeometry(after.Path));

        static void RemapRouteSegmentsInPlace(Passenger p, int[] oldToNew, int oldLimit) {
            var segments = p.Route?.Segments;
            if (segments == null) return;
            for (int s = 0; s < segments.Length; s++) {
                var seg = segments[s];
                if (seg == null) continue;
                for (int k = 0; k < seg.Length; k++) {
                    int oldN = seg[k];
                    seg[k] = (oldN >= 0 && oldN < oldLimit && oldToNew[oldN] >= 0) ? oldToNew[oldN] : 0;
                }
            }
            if (p.Segment >= 0 && p.Segment < segments.Length && segments[p.Segment] != null) {
                p.Path = segments[p.Segment];
            } else {
                p.Path = Array.Empty<int>();
            }
        }

        static bool SameStops(int[] a, int[] b) {
            if (ReferenceEquals(a, b)) return true;
            if (a == null || b == null || a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }

        /// <summary>
        /// Port of the crowd/service tail of <c>World.rebuild</c>: swap in staged graph and
        /// service servers, keep cumulative counters and RNG untouched, preserve active
        /// consist riders whose doorways still match (or clear recut cabins without charging
        /// <see cref="LeftBehind"/>), relocate standing passengers off newly placed road
        /// footprints, invalidate old route/server/lift references, and replan routes on the
        /// new graph while recomputing active queues.
        /// </summary>
        internal void ApplyStagedEdit(StagedServiceFacts staged) {
            LastReconciledPassengers = 0;
            InstallFacts(staged);
            ReconcileTrainWatches();

            int replanned = 0;
            for (int i = 0; i < passengers.Count; i++) {
                var passenger = passengers[i];
                if (passenger.Phase == Phase.Dead) continue;
                if (!string.IsNullOrEmpty(passenger.TrainKey)) {
                    if (!watches.ContainsKey(passenger.TrainKey)) {
                        if (passenger.Phase == Phase.TrainRiding) Onboard = Math.Max(0, Onboard - 1);
                        Kill(passenger);
                    }
                    continue;
                }
                replanned++;
                ReplanSinglePassenger(passenger, checkRoads: true);
            }
            LastReconciledPassengers = replanned;

            Compact();
            PublishServerCounts();
            Invalidate();
        }

        void ReplanSinglePassenger(Passenger passenger, bool checkRoads) {
            Phase prevPhase = passenger.Phase;
            string prevServerId = passenger.ServerId ?? "";
            int prevGateServer = passenger.GateServer;
            int prevGateDir = passenger.GateDir;
            double prevFromX = passenger.FromX, prevFromY = passenger.FromY, prevFromZ = passenger.FromZ;
            double prevToX = passenger.ToX, prevToY = passenger.ToY, prevToZ = passenger.ToZ;

            if (checkRoads && prevPhase != Phase.Riding && prevPhase != Phase.LiftRiding &&
                RoadContainsPoint(document, passenger.X, passenger.Y, JsRound(passenger.Z) - 1)) {
                int nearestFloor = NearestFloorNodeOnLevel(graph, passenger.X, passenger.Y, JsRound(passenger.Z));
                if (nearestFloor < 0) { Kill(passenger); return; }
                passenger.X = graph.NodeX[nearestFloor];
                passenger.Y = graph.NodeY[nearestFloor];
                passenger.Z = graph.NodeZ[nearestFloor];
            }

            int fromNode = NearestNode(graph, passenger.X, passenger.Y, passenger.Z);
            if (prevPhase == Phase.Riding) {
                if (fromNode < 0) {
                    int nTo = NearestNode(graph, prevToX, prevToY, prevToZ);
                    int nFrom = NearestNode(graph, prevFromX, prevFromY, prevFromZ);
                    if (nTo >= 0 && nFrom >= 0) {
                        double dTo = SqDist3(graph, nTo, passenger.X, passenger.Y, passenger.Z);
                        double dFrom = SqDist3(graph, nFrom, passenger.X, passenger.Y, passenger.Z);
                        fromNode = dTo <= dFrom ? nTo : nFrom;
                    } else {
                        fromNode = nTo >= 0 ? nTo : nFrom;
                    }
                }
                if (fromNode >= 0 && graph != null) {
                    passenger.X = graph.NodeX[fromNode];
                    passenger.Y = graph.NodeY[fromNode];
                    passenger.Z = graph.NodeZ[fromNode];
                }
            } else if (prevPhase == Phase.LiftRiding) {
                if (fromNode < 0) fromNode = NearestNode(graph, passenger.X, passenger.Y, passenger.Z + 1.0);
                if (fromNode < 0) fromNode = NearestNodeAnyLevel(graph, passenger.X, passenger.Y, passenger.Z + 1.0);
                if (fromNode >= 0 && graph != null) {
                    passenger.X = graph.NodeX[fromNode];
                    passenger.Y = graph.NodeY[fromNode];
                    passenger.Z = graph.NodeZ[fromNode];
                }
            }

            passenger.Route = null;
            passenger.RouteGraphEpoch = graphEpoch;
            passenger.Segment = 0;
            passenger.Path = Array.Empty<int>();
            passenger.PathIndex = 0;
            passenger.AwaitingRoute = false;
            passenger.Server = -1;
            passenger.ServerId = "";
            passenger.GateServer = -1;
            passenger.GateDir = 0;
            passenger.GateChosen = false;
            passenger.AlignRouteStart = false;
            ReleaseGateReservation(passenger);
            passenger.DoorNode = -1;
            passenger.LiftId = "";
            passenger.LiftBoardNode = -1;
            passenger.LiftDestNode = -1;
            passenger.LiftBoardStop = -1;
            passenger.LiftDestStop = -1;
            passenger.LiftPhase = 0;
            passenger.LiftSlot = 0;
            passenger.LiftThresholdDone = false;
            passenger.RideT = 0;
            passenger.RidePath = null;
            passenger.RideTotal = 0;
            passenger.Phase = Phase.Walking;
            passenger.Activity = StationPassengerActivity.Walk;
            passenger.WalkWeight = 0;

            if (graph == null || planner == null || fromNode < 0) {
                passenger.AwaitingRoute = true;
                return;
            }

            if (passenger.Boards) {
                string lineId = !string.IsNullOrEmpty(passenger.TargetLineId)
                    ? passenger.TargetLineId
                    : (document != null && document.Lines.Count > 0 ? document.Lines[0].Id : "");
                passenger.TargetLineId = lineId;
                var atDoor = DoorForNodeAndLine(fromNode, lineId);
                if (atDoor != null) {
                    passenger.Phase = Phase.Queuing;
                    passenger.Server = atDoor.Server;
                    passenger.ServerId = "door:" + atDoor.Id;
                    passenger.DoorNode = fromNode;
                    passenger.Activity = StationPassengerActivity.Queue;
                    passenger.ActivityStart = simTime;
                    passenger.ActivityTotal = 12;
                    passenger.WalkWeight = 0;
                    atDoor.Queue.Add(passenger.Id);
                    StandAt(passenger, fromNode);
                    return;
                }
                var route = PlanDoorRoute(fromNode, lineId, passenger.Needs);
                if (route == null) {
                    passenger.AwaitingRoute = true;
                    return;
                }
                StartRebuiltRoute(passenger, route, prevPhase, prevServerId, prevGateServer >= 0, prevGateDir);
            } else {
                int destExit = ResolveExitNode(passenger.DestExitId);
                passenger.DestExit = destExit;
                if (destExit < 0) {
                    passenger.AwaitingRoute = true;
                    return;
                }
                if (fromNode == destExit) {
                    var completeRoute = new ServiceRoute { Segments = new[] { new[] { fromNode } }, Cost = 0 };
                    passenger.Route = completeRoute;
                    passenger.RouteGraphEpoch = graphEpoch;
                    passenger.Segment = 0;
                    passenger.Path = completeRoute.Segments[0];
                    passenger.PathIndex = 0;
                    passenger.Phase = Phase.Walking;
                    return;
                }
                var route = PlanRoute(fromNode, destExit, passenger.Needs);
                if (route == null) {
                    passenger.AwaitingRoute = true;
                    return;
                }
                StartRebuiltRoute(passenger, route, prevPhase, prevServerId, prevGateServer >= 0, prevGateDir);
            }
        }

        void StartRebuiltRoute(
            Passenger passenger,
            ServiceRoute route,
            Phase prevPhase,
            string prevServerId,
            bool hadPassedGate,
            int prevGateDir) {
            passenger.Route = route;
            passenger.RouteGraphEpoch = graphEpoch;
            passenger.Segment = 0;
            passenger.AwaitingRoute = false;
            var segments = route.Segments ?? Array.Empty<int[]>();
            var firstSeg = segments.Length > 0 && segments[0] != null ? segments[0] : Array.Empty<int>();
            passenger.Path = firstSeg;
            passenger.PathIndex = 0;
            passenger.Phase = Phase.Walking;
            double startGap = firstSeg.Length > 0 && graph != null
                ? Math.Sqrt((passenger.X - graph.NodeX[firstSeg[0]]) * (passenger.X - graph.NodeX[firstSeg[0]]) +
                            (passenger.Y - graph.NodeY[firstSeg[0]]) * (passenger.Y - graph.NodeY[firstSeg[0]]))
                : 0;
            if (startGap > 0.35) passenger.AlignRouteStart = true;

            if (firstSeg.Length <= 1 && segments.Length > 1 && route.Lifts != null && route.Lifts.Length > 0) {
                string liftId = route.Lifts[0];
                int node = firstSeg.Length > 0 ? firstSeg[firstSeg.Length - 1] : -1;
                if (liftById.TryGetValue(liftId, out LiftConnector car) && (node >= 0 && Array.IndexOf(car.Landings, node) >= 0)) {
                    EndSegment(passenger);
                }
                return;
            }

            if (firstSeg.Length >= 2) {
                int startNode = firstSeg[0];
                int nextNode = firstSeg[1];
                if (gateByNode.TryGetValue(startNode, out GateFact startGate)) {
                    if (prevPhase == Phase.Queuing && prevServerId.StartsWith("gate:", StringComparison.Ordinal)) {
                        int dir = DirectionAtGate(startGate, startNode, nextNode);
                        if (dir == 0) dir = prevGateDir != 0 ? prevGateDir : (startGate.Mode != 0 ? startGate.Mode : 1);
                        passenger.Phase = Phase.Queuing;
                        passenger.Server = startGate.Server;
                        passenger.ServerId = "gate:" + startGate.Id;
                        passenger.GateDir = dir;
                        passenger.Activity = StationPassengerActivity.Wait;
                        passenger.ActivityStart = simTime;
                        passenger.ActivityTotal = 12;
                        passenger.WalkWeight = 0;
                        RegisterGateQueue(passenger, startGate);
                        GateStance(passenger, startGate);
                        return;
                    }
                    if (hadPassedGate) {
                        passenger.GateServer = startGate.Server;
                    }
                }
                if (prevPhase == Phase.Queuing && prevServerId.StartsWith("ride:", StringComparison.Ordinal) && startGap <= 1.0) {
                    int srv = EdgeServer(startNode, nextNode, out WalkEdgeKind edgeKind);
                    if (srv >= 0 && edgeKind != WalkEdgeKind.Walk && rideByServer.TryGetValue(srv, out RideFact startRide)) {
                        JoinRide(passenger, startRide);
                        return;
                    }
                }
            }
        }

        static bool DoorsMatch(List<DoorFact> before, List<DoorFact> after) {
            if (before == null || after == null || before.Count != after.Count) return false;
            for (int i = 0; i < before.Count; i++) {
                var a = before[i];
                var b = after[i];
                if (b.Node < 0) return false;
                if (!string.Equals(a.Id, b.Id, StringComparison.Ordinal)) return false;
                if (a.X != b.X || a.Y != b.Y || a.Z != b.Z) return false;
            }
            return true;
        }

        static bool RoadContainsPoint(StationSessionDocument doc, double x, double y, int cellZ) {
            if (doc == null) return false;
            var roads = doc.ModulesOfType("road");
            for (int i = 0; i < roads.Count; i++) {
                var m = roads[i];
                if (m.Z != cellZ) continue;
                double w = Math.Max(1, m.Width), d = Math.Max(1, m.Depth);
                if (x >= m.X && x <= m.X + w && y >= m.Y && y <= m.Y + d) return true;
            }
            return false;
        }

        static int NearestFloorNodeOnLevel(StationWalkGraph walkGraph, double x, double y, int nodeZ) {
            if (walkGraph == null) return -1;
            int nearest = -1;
            double best = double.PositiveInfinity;
            for (int n = 0; n < walkGraph.NodeCount; n++) {
                if (JsRound(walkGraph.NodeZ[n]) != nodeZ) continue;
                double dx = walkGraph.NodeX[n] - x, dy = walkGraph.NodeY[n] - y;
                double dist = dx * dx + dy * dy;
                if (dist < best) { best = dist; nearest = n; }
            }
            return nearest;
        }

        static int NearestNodeAnyLevel(StationWalkGraph walkGraph, double x, double y, double z) {
            if (walkGraph == null) return -1;
            int nearest = -1;
            double best = double.PositiveInfinity;
            for (int n = 0; n < walkGraph.NodeCount; n++) {
                double d = SqDist3(walkGraph, n, x, y, z);
                if (d < best) { best = d; nearest = n; }
            }
            return nearest;
        }

        static double SqDist3(StationWalkGraph walkGraph, int node, double x, double y, double z) {
            double dx = walkGraph.NodeX[node] - x;
            double dy = walkGraph.NodeY[node] - y;
            double dz = walkGraph.NodeZ[node] - z;
            return dx * dx + dy * dy + dz * dz;
        }

        DoorFact DoorForNodeAndLine(int node, string lineId) {
            if (node < 0) return null;
            for (int i = 0; i < doors.Count; i++) {
                if (doors[i].Node == node && (string.IsNullOrEmpty(lineId) || string.Equals(doors[i].LineId, lineId, StringComparison.Ordinal))) {
                    return doors[i];
                }
            }
            return null;
        }

        int ResolveExitNode(string exitId) {
            if (!string.IsNullOrEmpty(exitId)) {
                for (int i = 0; i < exits.Count; i++) {
                    if (string.Equals(exits[i].Id, exitId, StringComparison.Ordinal) && exits[i].Node >= 0) {
                        return exits[i].Node;
                    }
                }
            }
            if (exits.Count > 0) return exits[0].Node;
            return graph != null && graph.NodeCount > 0 ? 0 : -1;
        }

        static bool LiftLandingsMatch(LiftConnector before, LiftConnector after, Func<int, int> map) {
            for (int i = 0; i < before.Landings.Length; i++) {
                int old = before.Landings[i];
                if ((old < 0 ? -1 : map(old)) != after.Landings[i]) return false;
            }
            return true;
        }

        static int LandingNode(StationWalkGraph walkGraph, StationModuleFact module, int size, int z) {
            if (walkGraph == null) return -1;
            int mask = module.LiftDoorMasks != null && module.LiftDoorMasks.TryGetValue(z, out int configured)
                ? configured : 1;
            double half = size * .5;
            for (int side = 0; side < 2; side++) {
                if ((mask & (1 << side)) == 0) continue;
                for (int i = 0; i < size; i++) {
                    double x = i - (size - 1) * .5;
                    double y = (side == 0 ? -1 : 1) * (half + .5);
                    for (int turn = (module.Rot % 4 + 4) % 4; turn > 0; turn--) (x, y) = (-y, x);
                    if (walkGraph.TryNode(JsRound(module.X + half + x - .5),
                            JsRound(module.Y + half + y - .5), z, out int node)) return node;
                }
            }
            return -1;
        }

        bool CanSeparate(Passenger p) {
            if (p.RidePath != null || p.GateServer >= 0) return false;
            if (p.Phase == Phase.Walking) return true;
            if (p.Phase == Phase.LiftQueuing) return true;
            return p.Phase == Phase.Queuing && (rideByServer.ContainsKey(p.Server) ||
                p.GateQueueOverflow && gateByServer.ContainsKey(p.Server));
        }

        void SeparateWalkers() {
            if (graph == null || passengers.Count < 2) return;
            collisionHeads.Clear();
            if (collisionNext.Length < passengers.Count)
                Array.Resize(ref collisionNext, Math.Max(64, passengers.Count * 2));
            for (int i = 0; i < passengers.Count; i++) {
                var p = passengers[i];
                if (!CanSeparate(p)) continue;
                var cell = ((int)Math.Floor(p.X), (int)Math.Floor(p.Y), JsRound(p.Z) - 1);
                collisionNext[i] = collisionHeads.TryGetValue(cell, out int head) ? head : -1;
                collisionHeads[cell] = i;
            }
            const double space = .8;
            for (int i = 0; i < passengers.Count; i++) {
                var p = passengers[i];
                if (!CanSeparate(p)) continue;
                int x = (int)Math.Floor(p.X), y = (int)Math.Floor(p.Y), z = JsRound(p.Z) - 1;
                if (!graph.TryNode(x, y, z, out int from) || graph.ServerForNode.ContainsKey(from)) continue;
                double px = 0, py = 0;
                int neighbors = 0;
                for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                    if (!collisionHeads.TryGetValue((x + dx, y + dy, z), out int j)) continue;
                    for (; j >= 0 && neighbors < 24; j = collisionNext[j]) {
                        if (j == i) continue;
                        var other = passengers[j];
                        if (Math.Abs(p.Z - other.Z) > .3) continue;
                        double vx = p.X - other.X, vy = p.Y - other.Y;
                        double distance = Math.Sqrt(vx * vx + vy * vy);
                        if (distance >= space) continue;
                        neighbors++;
                        if (distance < 1e-6) {
                            double angle = p.Id * 2.399963229728653;
                            px += Math.Cos(angle) * space * .5;
                            py += Math.Sin(angle) * space * .5;
                        } else {
                            double push = (space - distance) / distance * .5;
                            px += vx * push; py += vy * push;
                        }
                    }
                }
                double length = Math.Sqrt(px * px + py * py);
                if (length < 1e-6) continue;
                const double separationMax = .6;
                double scale = Math.Min(1, separationMax / length);
                double tx = p.X + px * scale, ty = p.Y + py * scale;
                // Limit each push to a walk connection. A rotated gate, balustrade or missing
                // support stays solid even when an agent is pushed toward it.
                if (CanPush(from, tx, ty, z)) { p.X = tx; p.Y = ty; }
                else if (CanPush(from, tx, p.Y, z)) p.X = tx;
                else if (CanPush(from, p.X, ty, z)) p.Y = ty;
            }
        }

        bool CanPush(int from, double x, double y, int z) => CanStepTo(from, x, y, z, -1, -1);

        bool CanStepTo(int from, double x, double y, int z, int allowedNode1, int allowedNode2 = -1) {
            if (!graph.TryNode((int)Math.Floor(x), (int)Math.Floor(y), z, out int to)) return false;
            if (to == from) return true;
            if (to != allowedNode1 && to != allowedNode2 && graph.ServerForNode.ContainsKey(to)) return false;
            int edge = Array.IndexOf(graph.AdjTo[from], to);
            return edge >= 0 && graph.AdjKind[from][edge] == (int)WalkEdgeKind.Walk;
        }

        /// <summary>
        /// Short bounded BFS over Walk edges to route a queued passenger around a balustrade tip,
        /// shaft corner or wall when straight-line approach to its landing node is blocked.
        /// </summary>
        int NextWalkStepToward(int from, int target, int altTarget = -1) {
            if (graph == null || from < 0 || (target < 0 && altTarget < 0)) return -1;
            if (from == target || from == altTarget) return from;
            detourQueue.Clear();
            detourFirstStep.Clear();
            detourFirstStep[from] = from;
            var firstNeighbors = graph.AdjTo[from];
            var firstKinds = graph.AdjKind[from];
            for (int e = 0; e < firstNeighbors.Length; e++) {
                if (firstKinds[e] != (int)WalkEdgeKind.Walk) continue;
                int nb = firstNeighbors[e];
                if (nb == target || nb == altTarget) return nb;
                if (graph.ServerForNode.ContainsKey(nb)) continue;
                if (!detourFirstStep.ContainsKey(nb)) {
                    detourFirstStep[nb] = nb;
                    detourQueue.Enqueue(nb);
                }
            }
            int expanded = 0;
            while (detourQueue.Count > 0 && expanded++ < 48) {
                int cur = detourQueue.Dequeue();
                int first = detourFirstStep[cur];
                var neighbors = graph.AdjTo[cur];
                var kinds = graph.AdjKind[cur];
                for (int e = 0; e < neighbors.Length; e++) {
                    if (kinds[e] != (int)WalkEdgeKind.Walk) continue;
                    int nb = neighbors[e];
                    if (nb == target || nb == altTarget) return first;
                    if (graph.ServerForNode.ContainsKey(nb)) continue;
                    if (!detourFirstStep.ContainsKey(nb)) {
                        detourFirstStep[nb] = first;
                        detourQueue.Enqueue(nb);
                    }
                }
            }
            return -1;
        }

        void PriceCrowd() {
            nearbyCrowd.Clear();
            for (int i = 0; i < passengers.Count; i++) {
                var p = passengers[i];
                if (p.Phase != Phase.Walking && p.Phase != Phase.Queuing && p.Phase != Phase.LiftQueuing) continue;
                int x = (int)Math.Floor(p.X), y = (int)Math.Floor(p.Y), z = JsRound(p.Z);
                for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) {
                    var key = (x + dx, y + dy, z);
                    nearbyCrowd.TryGetValue(key, out int count);
                    nearbyCrowd[key] = count + 1;
                }
            }
        }

        int LocalCrowdCount(double x, double y, double z) {
            nearbyCrowd.TryGetValue(((int)Math.Floor(x), (int)Math.Floor(y), JsRound(z)), out int count);
            return Math.Max(0, count - 1);
        }

        static double DensityDerate(int neighbors) {
            double m2PerPax = neighbors > 0 ? 12.57 / (neighbors + 1) : 12.57;
            return Clamp(0.35 + 0.65 * (m2PerPax - 0.2), 0.35, 1.0);
        }

        double CongestionAt(int node) {
            nearbyCrowd.TryGetValue(((int)Math.Floor(graph.NodeX[node]), (int)Math.Floor(graph.NodeY[node]),
                JsRound(graph.NodeZ[node])), out int count);
            return StationRoutePlanner.CongestionCost(count);
        }

        // gateTraffic.ts refresh/reserve/join/leave. Decisions made earlier in this
        // tick are visible to the next passenger, even if neither has queued yet.
        void RefreshGateTraffic() {
            foreach (var gate in gates) {
                Array.Clear(gate.QueuedByDirection, 0, 3);
                Array.Clear(gate.IncomingByDirection, 0, 3);
                foreach (int id in gate.Queue) {
                    var passenger = Find(id);
                    if (passenger != null && passenger.Phase == Phase.Queuing)
                        gate.QueuedByDirection[passenger.GateDir + 1]++;
                }
            }
            foreach (var passenger in passengers) {
                passenger.ReservedGate = null;
                ReserveGate(passenger);
            }
        }

        void ReleaseGateReservation(Passenger passenger) {
            var gate = passenger.ReservedGate;
            if (gate == null) return;
            gate.IncomingByDirection[passenger.ReservedGateDir + 1]--;
            passenger.ReservedGate = null;
        }

        void ReserveGate(Passenger passenger) {
            ReleaseGateReservation(passenger);
            if (!passenger.GateChosen || passenger.Phase != Phase.Walking || passenger.AwaitingRoute) return;
            var gate = UpcomingGate(passenger, GateForecastSeconds * WalkSpeed, true, out int at);
            if (gate == null) return;
            int from = passenger.Path[at - 1];
            int direction = DirectionAtGate(gate, from, gate.Node);
            passenger.ReservedGate = gate;
            passenger.ReservedGateDir = direction;
            gate.IncomingByDirection[direction + 1]++;
        }

        GateFact UpcomingGate(Passenger passenger, double limit, bool includeRise, out int at) {
            double x = passenger.X, y = passenger.Y, z = passenger.Z, distance = 0;
            for (int i = passenger.PathIndex + 1; i < passenger.Path.Length; i++) {
                int node = passenger.Path[i];
                double dx = graph.NodeX[node] - x, dy = graph.NodeY[node] - y;
                double dz = includeRise ? graph.NodeZ[node] - z : 0;
                distance += Math.Sqrt(dx * dx + dy * dy + dz * dz);
                bool immediateChoice = !includeRise && i == passenger.PathIndex + 1;
                if (distance > limit && !immediateChoice) break;
                if (gateByNode.TryGetValue(node, out var gate) && gate.Server != passenger.GateServer) {
                    at = i;
                    return gate;
                }
                if (distance > limit) break;
                x = graph.NodeX[node]; y = graph.NodeY[node]; z = graph.NodeZ[node];
            }
            at = -1;
            return null;
        }

        double GateWait(int server, int direction) {
            if (!gateByServer.TryGetValue(server, out var gate)) return 0;
            if (gate.Rate <= 0) return 600;
            int Count(int d) => gate.QueuedByDirection[d + 1] + gate.IncomingByDirection[d + 1];
            int neutral = Count(0);
            double seconds;
            if (direction == 0 || gate.Mode != 0) {
                seconds = (Count(-1) + neutral + Count(1)) / gate.Rate;
            } else {
                seconds = (Count(direction) + neutral) / gate.Rate;
                int lane = gate.Lane != 0 ? gate.Lane : Count(-1) > Count(1) ? -1 : Count(1) > 0 ? 1 : 0;
                if (lane != 0 && lane != direction) {
                    int opposite = -direction;
                    double arrivals = gate.IncomingByDirection[opposite + 1] / GateForecastSeconds;
                    double drain = Math.Max(gate.Rate * GateForecastMinDrainFraction, gate.Rate - arrivals);
                    seconds += Count(opposite) / drain;
                }
            }
            return Math.Min(600, seconds + Math.Max(0, gate.Cooldown));
        }

        void SyncServerQueue(int server, int count) {
            if (graph != null && server >= 0 && server < graph.Servers.Count)
                graph.Servers[server].QueueCount = count;
        }

        void RegisterGateQueue(Passenger passenger, GateFact gate) {
            ReleaseGateReservation(passenger);
            gate.Queue.Add(passenger.Id);
            SyncServerQueue(gate.Server, gate.Queue.Count);
            gate.QueuedByDirection[passenger.GateDir + 1]++;
            ResetGatePatience(passenger);
        }

        void ResetGatePatience(Passenger passenger) {
            double patience = PatienceMin + (PatienceMax - PatienceMin) * IdentityUnit(passenger.Id, 0x62b9u);
            passenger.GatePatienceAt = simTime + patience;
        }

        // World.chooseGate: a fresh search once per walking leg. A deferred decision
        // can keep approaching, but holds before entering the gate queue.
        bool ChooseApproachingGate(Passenger passenger) {
            if (passenger.GateChosen) return false;
            var gate = UpcomingGate(passenger, GateLookahead, false, out int at);
            if (gate == null) return false;
            if (gateReplans >= GateReplanPerTick) {
                if (at != passenger.PathIndex + 1) return false;
                passenger.WalkWeight = 0;
                return true;
            }

            gateReplans++;
            passenger.GateChosen = true;
            ReleaseGateReservation(passenger);
            int from = GateSearchStart(passenger, passenger.Path[at - 1]);
            var segments = passenger.Route.Segments;
            int goal = segments[segments.Length - 1][^1];
            var route = PlanRoute(from, goal, passenger.Needs);
            if (route == null) return true;
            SetWalkingRoute(passenger, route);
            ReserveGate(passenger);
            return false;
        }

        int GateSearchStart(Passenger passenger, int approach) {
            int start = NearestNode(graph, passenger.X, passenger.Y, passenger.Z);
            // Starting on a gate cell skips its arrival charge. Use the connected approach
            // when a body is close enough to be mapped onto the gate.
            return start < 0 || gateByNode.ContainsKey(start) ? approach : start;
        }

        void SetWalkingRoute(Passenger passenger, ServiceRoute route) {
            passenger.Route = route;
            passenger.Segment = 0;
            passenger.Path = route.Segments[0];
            passenger.PathIndex = 0;
            passenger.AlignRouteStart = true;
        }

        bool RerouteGateQueue(Passenger passenger, GateFact gate) {
            if (passenger.Path.Length <= 1 || simTime <= passenger.GatePatienceAt ||
                    patienceReplans >= RerouteReplanPerTick) return false;
            patienceReplans++;
            ResetGatePatience(passenger);
            int from = GateSearchStart(passenger, passenger.Path[passenger.PathIndex]);
            var segments = passenger.Route.Segments;
            int goal = segments[segments.Length - 1][^1];
            if (from == goal) return false;
            var route = PlanRoute(from, goal, passenger.Needs);
            if (route == null || FirstQueueServer(route.Segments[0]) == gate.Server) return false;

            gate.Queue.Remove(passenger.Id);
            SyncServerQueue(gate.Server, gate.Queue.Count);
            gate.QueuedByDirection[passenger.GateDir + 1]--;
            passenger.GateChosen = false;
            passenger.Phase = Phase.Walking;
            passenger.Server = -1;
            passenger.ServerId = "";
            passenger.Activity = StationPassengerActivity.Walk;
            SetWalkingRoute(passenger, route);
            return true;
        }

        int FirstQueueServer(int[] path) {
            for (int i = 1; i < path.Length; i++) {
                int server = EdgeServer(path[i - 1], path[i], out _);
                if (rideByServer.ContainsKey(server)) return server;
                if (gateByNode.TryGetValue(path[i], out var gate)) return gate.Server;
            }
            return -1;
        }

        void SpreadWalkingRoute(Passenger passenger, int from) {
            if (walkReplans >= 4 || graph.ServerForNode.ContainsKey(from)) return;
            int start = passenger.PathIndex, end = start;
            double distance = 0;
            bool crowded = false;
            while (end + 1 < passenger.Path.Length) {
                int a = passenger.Path[end], b = passenger.Path[end + 1];
                if (double.IsInfinity(planner.WalkingCost(passenger.Path, end, end + 1))) break;
                double dx = graph.NodeX[a] - graph.NodeX[b], dy = graph.NodeY[a] - graph.NodeY[b];
                distance += Math.Sqrt(dx * dx + dy * dy);
                if (distance > 8) break;
                end++;
                crowded |= CongestionAt(b) >= 3 * StationRoutePlanner.CongestionSeconds;
            }
            if (!crowded) return;
            walkReplans++;
            var detour = planner.Astar(from, passenger.Path[end], passenger.Needs, walkOnly: true);
            if (detour == null || planner.WalkingCost(detour, 0, detour.Length - 1) + 2 >=
                    planner.WalkingCost(passenger.Path, start, end)) return;
            var path = new int[start + detour.Length + passenger.Path.Length - end - 1];
            Array.Copy(passenger.Path, path, start);
            detour.CopyTo(path, start);
            Array.Copy(passenger.Path, end + 1, path, start + detour.Length, passenger.Path.Length - end - 1);
            passenger.Path = path;
            passenger.Route.Segments[passenger.Segment] = path;
        }

        void PublishServerCounts() {
            if (graph == null) return;
            for (int i = 0; i < graph.Servers.Count; i++) {
                var server = graph.Servers[i];
                if (gateByServer.TryGetValue(i, out GateFact gate)) { server.QueueCount = gate.Queue.Count; server.Served = gate.Served; }
                else if (doorByServer.TryGetValue(i, out DoorFact door)) { server.QueueCount = door.Queue.Count; server.Served = door.Served; }
                else if (rideByServer.TryGetValue(i, out RideFact ride)) { server.QueueCount = ride.Queue.Count; server.Served = ride.Served; }
            }
        }

        void Invalidate() {
            frameVersion++;
            frameCache = Array.Empty<StationPassengerFrame>();
            frameCacheVersion = -1;
        }

        // --------------------------------------------------------------- spawning

        void StepSpawn(bool serviceOpen, double demandRate) {
            if (!options.Spawn || !serviceOpen || exitNodes.Count == 0 || planner == null) return;
            if (passengers.Count >= options.MaxPassengers) { CapHit++; return; }
            double rate = options.ExitInRatePerHour * (demandRate > 0 ? demandRate : 0);
            if (rate <= 0) return;
            for (int e = 0; e < exitNodes.Count; e++) {
                int count = rng.PoissonHour(rate, Dt);
                for (int k = 0; k < count; k++) {
                    if (passengers.Count >= options.MaxPassengers) { CapHit++; return; }
                    SpawnFromEntrance(exitNodes[e]);
                }
            }
        }

        void SpawnFromEntrance(int entrance) {
            bool board = false;
            string lineId = "";
            if (document != null && document.Lines.Count > 0) {
                board = rng.Next() < BoardChance;
                if (board) lineId = document.Lines[0].Id;
            }
            string destExitId = "";
            int destinationExit = board ? -1 : PickExit(out destExitId);
            bool stepFree = rng.Next() < StepFreeChance;
            bool luggage = rng.Next() < LuggageChance;
            double jx = (rng.Next() - 0.5) * 0.6;
            double jy = (rng.Next() - 0.5) * 0.6;
            var needs = new StationRouteNeeds { StepFree = stepFree, Luggage = luggage };
            var passenger = new Passenger {
                X = graph.NodeX[entrance] + jx, Y = graph.NodeY[entrance] + jy, Z = graph.NodeZ[entrance],
                Boards = board,
                TargetLineId = lineId,
                DestExit = destinationExit,
                DestExitId = destExitId,
                Needs = needs,
                RouteGraphEpoch = graphEpoch,
            };
            passenger.Id = ++nextPassengerId;
            passenger.IdentityFactor = 0.9 + IdentityUnit(passenger.Id, 0x85a308d3u) * 0.2;
            passenger.Speed = WalkSpeed * passenger.IdentityFactor;
            passenger.WalkPhase = IdentityUnit(passenger.Id, 0x9e3779b9u);
            ServiceRoute route = board
                ? PlanDoorRoute(entrance, lineId, needs)
                : PlanRoute(entrance, destinationExit, needs);
            if (route == null) { nextPassengerId--; Stuck++; return; }
            passengers.Add(passenger);
            Spawned++;
            BeginRoute(passenger, route);
        }

        int PickExit(out string exitId) {
            exitId = "";
            if (exitNodes.Count == 0) return -1;
            int at = (int)Math.Floor(rng.Next() * exitNodes.Count);
            if (at < 0) at = 0;
            if (at >= exitNodes.Count) at = exitNodes.Count - 1;
            if (at < exits.Count && exits[at] != null) exitId = exits[at].Id ?? "";
            return exitNodes[at];
        }

        // --------------------------------------------------------------- routing

        static double LiftQueueWait(LiftConnector lift) => Math.Min(600, lift.Queue.Count * LiftCycleSeconds / LiftBatch);

        ServiceRoute PlanRoute(int from, int to, StationRouteNeeds needs, int avoidServer = -1) {
            if (planner == null) return null;
            var path = planner.Astar(from, to, needs, avoidServer: avoidServer, useLifts: true);
            if (path == null) return null;
            double cost = planner.LastSearchCost(to);
            List<int[]> segments = null;
            List<string> takenLifts = null;
            int segmentStart = 0;
            for (int i = 1; i < path.Length; i++) {
                string liftId = planner.LastSearchLiftInto(path[i]);
                if (liftId == null) continue;
                if (segments == null) {
                    segments = new List<int[]>();
                    takenLifts = new List<string>();
                }
                segments.Add(path[segmentStart..i]);
                takenLifts.Add(liftId);
                segmentStart = i;
            }
            if (segments == null) return new ServiceRoute { Segments = new[] { path }, Cost = cost };
            segments.Add(path[segmentStart..]);
            return new ServiceRoute { Segments = segments.ToArray(), Lifts = takenLifts.ToArray(), Cost = cost };
        }

        /// <summary>
        /// The route an entering passenger takes to a platform doorway: the best
        /// doorway of the line by walk distance plus the queue already committed
        /// to it (the source's door choice), falling back to the next-best when a
        /// doorway cannot be reached.
        /// </summary>
        ServiceRoute PlanDoorRoute(int from, string lineId, StationRouteNeeds needs) {
            if (planner == null) return null;
            var candidates = new List<DoorFact>();
            var scores = new List<double>();
            for (int i = 0; i < doors.Count; i++) {
                if (doors[i].LineId != lineId) continue;
                double dx = graph.NodeX[doors[i].Node] - graph.NodeX[from];
                double dy = graph.NodeY[doors[i].Node] - graph.NodeY[from];
                double dz = graph.NodeZ[doors[i].Node] - graph.NodeZ[from];
                double score = Math.Sqrt(dx * dx + dy * dy + dz * dz) + doors[i].Queue.Count * 2.0;
                int at = candidates.Count;
                for (int c = 0; c < candidates.Count; c++) {
                    if (score < scores[c] - 1e-9 || (Math.Abs(score - scores[c]) <= 1e-9 && doors[i].Server < candidates[c].Server)) { at = c; break; }
                }
                candidates.Insert(at, doors[i]);
                scores.Insert(at, score);
            }
            int tried = 0;
            for (int i = 0; i < candidates.Count && tried < 4; i++, tried++) {
                if (doors.Count == 0) break;
                var route = PlanRoute(from, candidates[i].Node, needs);
                if (route != null) return route;
            }
            return null;
        }

        void BeginRoute(Passenger passenger, ServiceRoute route) {
            passenger.Route = route;
            passenger.RouteGraphEpoch = graphEpoch;
            passenger.AwaitingRoute = false;
            passenger.Segment = 0;
            BeginSegment(passenger);
        }

        void BeginSegment(Passenger passenger) {
            var segments = passenger.Route?.Segments;
            if (segments == null || passenger.Segment >= segments.Length) { Kill(passenger); return; }
            ReleaseGateReservation(passenger);
            passenger.GateChosen = false;
            passenger.AlignRouteStart = false;
            passenger.Path = segments[passenger.Segment] ?? Array.Empty<int>();
            passenger.PathIndex = 0;
            passenger.Phase = Phase.Walking;
            if (passenger.Path.Length > 0 && passenger.Segment > 0) {
                passenger.X = graph.NodeX[passenger.Path[0]];
                passenger.Y = graph.NodeY[passenger.Path[0]];
                passenger.Z = graph.NodeZ[passenger.Path[0]];
            }
            if (passenger.Path.Length <= 1) EndSegment(passenger);
        }

        void EndSegment(Passenger passenger) {
            ReleaseGateReservation(passenger);
            var segments = passenger.Route?.Segments;
            if (segments == null) { Kill(passenger); return; }
            if (passenger.Segment + 1 < segments.Length) {
                string liftId = passenger.Route.Lifts[passenger.Segment];
                if (!liftById.TryGetValue(liftId, out LiftConnector car)) { Stuck++; Kill(passenger); return; }
                int node = passenger.Path.Length > 0 ? passenger.Path[passenger.Path.Length - 1] : -1;
                int dest = segments[passenger.Segment + 1][0];
                int boardStop = Array.IndexOf(car.Landings, node);
                int destStop = Array.IndexOf(car.Landings, dest);
                if (node < 0 || boardStop < 0 || destStop < 0) { Stuck++; Kill(passenger); return; }
                passenger.LiftBoardNode = node; passenger.LiftDestNode = dest;
                passenger.LiftBoardStop = boardStop; passenger.LiftDestStop = destStop;
                passenger.LiftId = liftId;
                passenger.LiftPhase = 0;
                passenger.LiftSlot = 0;
                passenger.LiftThresholdDone = false;
                passenger.Phase = Phase.LiftQueuing;
                passenger.ServerId = "lift:" + liftId;
                passenger.Activity = StationPassengerActivity.Wait;
                passenger.ActivityStart = simTime;
                passenger.ActivityTotal = 12;
                passenger.WalkWeight = 0;
                car.Queue.Add(passenger.Id);
                passenger.StandX = graph.NodeX[node];
                passenger.StandY = graph.NodeY[node];
                LiftDoorOutward(car, passenger.StandX, passenger.StandY, out double ox, out double oy);
                passenger.Heading = Math.Atan2(-oy, -ox);
                return;
            }
            int endNode = passenger.Path.Length > 0 ? passenger.Path[passenger.Path.Length - 1] : -1;
            if (passenger.Boards) {
                var door = DoorForNode(endNode);
                if (door != null) {
                    passenger.Phase = Phase.Queuing;
                    passenger.Server = door.Server;
                    passenger.ServerId = "door:" + door.Id;
                    passenger.DoorNode = endNode;
                    passenger.Activity = StationPassengerActivity.Queue;
                    passenger.ActivityStart = simTime;
                    passenger.ActivityTotal = 12;
                    passenger.WalkWeight = 0;
                    door.Queue.Add(passenger.Id);
                    SyncServerQueue(door.Server, door.Queue.Count);
                    StandAt(passenger, endNode);
                    return;
                }
                Stuck++;
                Kill(passenger);
                return;
            }
            // The trip is over: this passenger left the station through its exit.
            Exited++;
            Kill(passenger);
        }

        // ------------------------------------------------------------- admission

        /// <summary>The source's turnstile leaf cycle (`CrowdSystem`): open, hold, shut.</summary>
        const double GateOpenSeconds = .25;
        const double GateHoldSeconds = .45;
        const double GateShutSeconds = .35;

        void StepGates() {
            for (int i = 0; i < gates.Count; i++) {
                var gate = gates[i];
                gate.Cooldown -= Dt;
                while (gate.Cooldown <= 0 && gate.Queue.Count > 0) {
                    int at = NextGateIndex(gate);
                    if (at < 0 && gate.Lane != 0) {
                        gate.Lane = 0;
                        at = NextGateIndex(gate);
                    }
                    if (at < 0) break;
                    int id = gate.Queue[at];
                    var passenger = Find(id);
                    if (passenger != null && passenger.Path.Length > 0) {
                        GateStance(passenger, gate);
                        if (Math.Abs(passenger.X - passenger.StandX) + Math.Abs(passenger.Y - passenger.StandY) > .12) {
                            gate.Cooldown = 0;
                            break;
                        }
                    }
                    gate.Queue.RemoveAt(at);
                    SyncServerQueue(gate.Server, gate.Queue.Count);
                    gate.Cooldown += 1 / Math.Max(1e-9, gate.Rate);
                    if (passenger == null) continue;
                    gate.QueuedByDirection[passenger.GateDir + 1]--;
                    gate.Served++;
                    gate.Admitted++;
                    // A two-way lane is one lane: the first arrival commits its direction
                    // and everyone queued behind in that direction passes first (World.stepGate).
                    if (gate.Mode == 0) gate.Lane = passenger.GateDir;
                    gate.AdmittedAt = simTime;
                    passenger.Server = -1;
                    passenger.ServerId = "";
                    passenger.GateServer = gate.Server;
                    passenger.Phase = Phase.Walking;
                    passenger.Activity = IdentityUnit(passenger.Id, 0x23ad) < 0.4 ? StationPassengerActivity.Qr : StationPassengerActivity.Card;
                    passenger.ActivityStart = simTime;
                    passenger.ActivityTotal = 2;
                    passenger.WalkWeight = 1;
                }
                if (gate.Cooldown < 0 && gate.Queue.Count == 0) gate.Cooldown = 0;
                if (gate.Cooldown < -Dt) gate.Cooldown = -Dt;
            }
        }

        /// <summary>
        /// `CrowdSystem.stepGateWing`'s leaf curve, evaluated at the fixed tick: the gate
        /// opens for <see cref="GateOpenSeconds"/>, holds for <see cref="GateHoldSeconds"/>
        /// and shuts for <see cref="GateShutSeconds"/> after the passenger it served.
        /// </summary>
        internal static double GateLeafOpen(double admittedAt, double now) {
            double elapsed = now - admittedAt;
            if (double.IsNaN(elapsed) || double.IsInfinity(elapsed) || elapsed < 0) return 0;
            if (elapsed < GateOpenSeconds) return elapsed / GateOpenSeconds;
            if (elapsed < GateOpenSeconds + GateHoldSeconds) return 1;
            double shut = elapsed - GateOpenSeconds - GateHoldSeconds;
            if (shut < GateShutSeconds) return 1 - shut / GateShutSeconds;
            return 0;
        }

        /// <summary>
        /// The highest fraction the source's leaf curve reaches inside one fixed tick.
        /// The curve is sub-second (0.25 + 0.45 + 0.35 s) while the service publishes on
        /// one-second ticks, so sampling a single instant can miss the open entirely.
        /// Publishing the interval's peak keeps the gate visibly answering the passenger
        /// it served while the frame stays the authoritative, deterministic record.
        /// </summary>
        internal static double GateLeafOpenPeak(double admittedAt, double from, double to) {
            if (double.IsNaN(admittedAt) || double.IsInfinity(admittedAt)) return 0;
            const double step = .125;
            double peak = GateLeafOpen(admittedAt, to);
            for (double t = from; t <= to + 1e-9; t += step)
                peak = Math.Max(peak, GateLeafOpen(admittedAt, t));
            return peak;
        }

        int NextGateIndex(GateFact gate) {
            for (int i = 0; i < gate.Queue.Count; i++) {
                var passenger = Find(gate.Queue[i]);
                if (passenger == null) return i; // pulled out by the caller
                if (GateLaneAllows(gate.Mode, gate.Lane, passenger.GateDir)) return i;
            }
            return -1;
        }

        static bool GateLaneAllows(int mode, int lane, int dir) {
            if (mode == 0) return lane == 0 || dir == 0 || dir == lane;
            if (dir == 0) return true;
            return mode > 0 ? dir > 0 : dir < 0;
        }

        const double RideApproachRadius = 0.95;

        void RideEntryPoint(RideFact ride, Passenger passenger, out double ex, out double ey, out int entryNode) {
            ex = graph.NodeX[ride.Node];
            ey = graph.NodeY[ride.Node];
            entryNode = ride.Node;
            if (ride.Columns > 1 && ride.Path != null) {
                double col = passenger != null && Math.Abs(passenger.RideColumn) > 1e-6 ? passenger.RideColumn : 0;
                ride.Path.Sample(0, ride.Reverse, col, out double sx, out double sy, out _, out _);
                int z = JsRound(graph.NodeZ[ride.Node]) - 1;
                if (graph.TryNode((int)Math.Floor(sx), (int)Math.Floor(sy), z, out int found)) {
                    ex = sx;
                    ey = sy;
                    entryNode = found;
                }
            }
        }

        void RideEntryPoint(RideFact ride, Passenger passenger, out double ex, out double ey) =>
            RideEntryPoint(ride, passenger, out ex, out ey, out _);

        void StepRides() {
            for (int i = 0; i < rides.Count; i++) {
                var ride = rides[i];
                if (ride.Rate <= 0) continue;
                ride.Cooldown -= Dt;
                while (ride.Cooldown <= 0 && ride.Queue.Count > 0) {
                    int pick = -1;
                    Passenger passenger = null;
                    for (int q = 0; q < ride.Queue.Count; q++) {
                        var candidate = Find(ride.Queue[q]);
                        if (candidate == null) { pick = q; passenger = null; break; }
                        RideEntryPoint(ride, candidate, out double ex, out double ey);
                        double dx = candidate.X - ex, dy = candidate.Y - ey;
                        if (dx * dx + dy * dy <= RideApproachRadius * RideApproachRadius) {
                            pick = q;
                            passenger = candidate;
                            break;
                        }
                    }
                    if (pick < 0) {
                        ride.Cooldown = 0;
                        break;
                    }
                    ride.Queue.RemoveAt(pick);
                    SyncServerQueue(ride.Server, ride.Queue.Count);
                    double offset = Math.Max(-Dt, Math.Min(0, -Dt - ride.Cooldown));
                    ride.Cooldown += 1 / ride.Rate;
                    if (passenger == null) continue;
                    ride.Served++;
                    ride.Admitted++;
                    StartRide(passenger, ride, offset);
                }
                if (ride.Cooldown < 0 && ride.Queue.Count == 0) ride.Cooldown = 0;
                if (ride.Cooldown < -Dt) ride.Cooldown = -Dt;
            }
        }

        void StartRide(Passenger passenger, RideFact ride, double elapsedOffset) {
            ReleaseGateReservation(passenger);
            passenger.Phase = Phase.Riding;
            passenger.Server = -1;
            passenger.ServerId = "ride:" + ride.Server;
            passenger.RideT = elapsedOffset;
            passenger.RideTotal = Math.Max(0.2, ride.Ride);
            passenger.RidePath = ride.Path;
            passenger.RideReverse = ride.Reverse;
            if (ride.Columns > 1) {
                if (Math.Abs(passenger.RideColumn) < 1e-6)
                    passenger.RideColumn = ride.Served % 2 == 0 ? -.35 : .35;
            } else {
                passenger.RideColumn = 0;
            }
            passenger.FromX = graph.NodeX[ride.Node];
            passenger.FromY = graph.NodeY[ride.Node];
            passenger.FromZ = graph.NodeZ[ride.Node];
            passenger.ToX = graph.NodeX[ride.ExitNode];
            passenger.ToY = graph.NodeY[ride.ExitNode];
            passenger.ToZ = graph.NodeZ[ride.ExitNode];
            if (ride.Kind == WalkEdgeKind.Escalator) {
                passenger.WalkWeight = 0;
                bool left = ride.Columns > 1 ? passenger.RideColumn > 0 : IdentityUnit(passenger.Id, 0x62a3) < 0.5;
                passenger.Activity = left ? StationPassengerActivity.EscalatorLeft : StationPassengerActivity.Escalator;
                passenger.RailVariant = (ride.Columns > 1 ? 1 : 0) + (passenger.ToZ < passenger.FromZ ? 2 : 0);
            } else {
                passenger.WalkWeight = ride.Kind == WalkEdgeKind.Stair ? 1 : 0;
                passenger.Activity = StationPassengerActivity.Walk;
            }
            passenger.ActivityStart = simTime;
            passenger.ActivityTotal = passenger.RideTotal;
        }

        /// <summary>
        /// The doorway half of the tick — the source's `stepServers` for a `kind: 'door'`
        /// server. A doorway boards only while **its own** latch is open (`door.Rate > 0`,
        /// set by `stepAlighting` the tick that doorway's wave cleared, or on the opening
        /// tick when it brought nobody) — not when the whole consist's alighting is done.
        /// Capacity is published, never enforced: the source's `boardRider` takes riders
        /// past the rated load, so a saturated consist keeps boarding (the trace's
        /// `saturated-cabin` case is the proof).
        /// </summary>
        void StepDoors(StationTrainFrame[] trains) {
            for (int i = 0; i < doors.Count; i++) {
                var door = doors[i];
                if (door.Rate <= 0) continue;
                var watch = Watch(door.LineId, door.TrackId);
                door.Cooldown -= Dt;
                while (door.Cooldown <= 0 && door.Queue.Count > 0) {
                    int head = door.Queue[0];
                    var front = Find(head);
                    // A spread-out platform queue walks to the open door before boarding.
                    if (front != null && Math.Abs(front.X - graph.NodeX[door.Node]) + Math.Abs(front.Y - graph.NodeY[door.Node]) >
                        StationServiceCadence.BoardApproach) {
                        door.Cooldown = 0;
                        break;
                    }
                    door.Queue.RemoveAt(0);
                    SyncServerQueue(door.Server, door.Queue.Count);
                    var passenger = front;
                    if (passenger == null) { door.Cooldown += 1 / door.Rate; continue; }
                    BoardRider(watch, door, passenger);
                    door.Cooldown += 1 / door.Rate;
                }
                if (door.Cooldown < 0 && door.Queue.Count == 0) door.Cooldown = 0;
                if (door.Cooldown < -Dt) door.Cooldown = -Dt;
            }
        }

        /// <summary>The source's `boardRider`: into the cabin behind the alighting wave.</summary>
        void BoardRider(TrainWatch watch, DoorFact door, Passenger passenger) {
            int doorIndex = door.Index;
            int k = 0;
            if (doorIndex >= 0 && doorIndex < watch.Boardings.Length) {
                k = watch.Boardings[doorIndex];
                watch.Boardings[doorIndex] = k + 1;
            }
            door.Served++;
            door.Admitted++;
            watch.Onboard++;
            Boarded++;
            BoardingsThisTick++;
            Onboard++;
            passenger.Phase = Phase.TrainRiding;
            passenger.TrainKey = watch.Key;
            passenger.TrainDoor = doorIndex;
            passenger.TrainFile = k % 2 == 0 ? -1 : 1;
            // Behind the wave that is getting off, so the two streams never share a slot.
            int waveRows = doorIndex >= 0 && doorIndex < watch.CabinRows.Length ? watch.CabinRows[doorIndex] : 0;
            passenger.TrainRow = waveRows + k / 2;
            passenger.Server = -1;
            passenger.ServerId = "line:" + door.LineId + "|" + door.TrackId;
            passenger.Activity = StationPassengerActivity.Wait;
            passenger.ActivityStart = simTime;
            passenger.ActivityTotal = 12;
            passenger.WalkWeight = 0;
            // A rider stands inside the car, behind the alighting wave (`World.pinRider`'s slot):
            // the same `cabinWorldPos` frame the wave was seated in (18 §8.2).
            var berth = BerthFor(watch.LineId, watch.TrackId);
            if (!StationTrainPose.CabinWorldPos(berth, graph.NodeX[door.Node], graph.NodeY[door.Node],
                    passenger.TrainFile, passenger.TrainRow, out double rx, out double ry, out double rz)) {
                rx = graph.NodeX[door.Node];
                ry = graph.NodeY[door.Node];
                rz = graph.NodeZ[door.Node];
            }
            passenger.X = rx;
            passenger.Y = ry;
            passenger.Z = rz;
        }

        void StepLiftQueues() {
            for (int i = 0; i < lifts.Count; i++) {
                var car = lifts[i];
                for (int q = 0; q < car.Queue.Count; q++) {
                    var passenger = Find(car.Queue[q]);
                    if (passenger == null) continue;
                    if (passenger.LiftBoardNode >= 0 && passenger.LiftBoardNode < graph.NodeCount) {
                        passenger.StandX = graph.NodeX[passenger.LiftBoardNode];
                        passenger.StandY = graph.NodeY[passenger.LiftBoardNode];
                    }
                }
            }
        }

        // ------------------------------------------------------------- the crowd

        void StepPassengers() {
            for (int i = 0; i < passengers.Count; i++) {
                var passenger = passengers[i];
                if (passenger.Phase != Phase.Riding) passenger.RidePath = null;
                switch (passenger.Phase) {
                    case Phase.Walking: StepWalk(passenger); break;
                    case Phase.Queuing: StepQueue(passenger); break;
                    case Phase.Riding: StepRide(passenger); break;
                    case Phase.LiftQueuing: StepQueue(passenger); break;
                    case Phase.LiftRiding: StepLiftRide(passenger); break;
                    case Phase.TrainRiding: passenger.WalkWeight = 0; break;
                    case Phase.Alighting: passenger.WalkWeight = 0; break;
                    case Phase.Stepping: StepOutRide(passenger); break;
                }
            }
        }

        void StepWalk(Passenger passenger) {
            if (passenger.AwaitingRoute) { passenger.WalkWeight = 0; return; }
            double timeLeft = Dt;
            bool checkCrowd = (passenger.Id + (long)simTime) % 8 == 0;
            int guard = 0;
            while (guard++ < 64 && timeLeft > 1e-9) {
                if (passenger.Path.Length == 0) { EndSegment(passenger); return; }
                if (ChooseApproachingGate(passenger)) return;
                if (passenger.AlignRouteStart) {
                    int start = passenger.Path[0];
                    if (!WalkToward(passenger, start, start, start, ref timeLeft, out bool atStart) || !atStart) return;
                    passenger.AlignRouteStart = false;
                    if (timeLeft <= 1e-9) return;
                }
                if (passenger.PathIndex >= passenger.Path.Length - 1) { EndSegment(passenger); return; }
                int from = passenger.Path[passenger.PathIndex];
                if (checkCrowd && Math.Abs(passenger.X - graph.NodeX[from]) + Math.Abs(passenger.Y - graph.NodeY[from]) < .05) {
                    checkCrowd = false;
                    SpreadWalkingRoute(passenger, from);
                }
                int to = passenger.Path[passenger.PathIndex + 1];
                if (gateByNode.TryGetValue(to, out GateFact gate) && gate.Server != passenger.GateServer) {
                    JoinGate(passenger, gate, from);
                    return;
                }
                int server = EdgeServer(from, to, out WalkEdgeKind kind);
                if (server >= 0 && kind != WalkEdgeKind.Walk && rideByServer.TryGetValue(server, out RideFact ride)) {
                    if (ride.Queue.Count >= 3 && TryAvoidQueue(passenger, from, ride.Server)) continue;
                    JoinRide(passenger, ride);
                    return;
                }
                if (!WalkToward(passenger, to, from, to, ref timeLeft, out bool arrived)) return;
                if (!arrived) return;
                passenger.PathIndex++;
                if (gateByNode.ContainsKey(from)) passenger.GateServer = -1;
            }
        }

        bool TryAvoidQueue(Passenger passenger, int from, int server) {
            if (queueReplans >= 4 ||
                Math.Abs(passenger.X - graph.NodeX[from]) + Math.Abs(passenger.Y - graph.NodeY[from]) > .15) return false;
            var segments = passenger.Route.Segments;
            int goal = segments[segments.Length - 1][^1];
            if (from == goal) return false;
            queueReplans++;
            var alternative = PlanRoute(from, goal, passenger.Needs, avoidServer: server);
            if (alternative == null || alternative.Cost + 2 >= RemainingRouteCost(passenger)) return false;
            SetWalkingRoute(passenger, alternative);
            passenger.AlignRouteStart = false;
            ReserveGate(passenger);
            return true;
        }

        double RemainingRouteCost(Passenger passenger) {
            var route = passenger.Route;
            double cost = planner.RouteCost(passenger.Path, passenger.PathIndex, passenger.Needs);
            double liftPenalty = StationRoutePlanner.LiftPenalty(passenger.Needs);
            for (int i = passenger.Segment; i < route.Lifts.Length; i++) {
                var lift = liftById[route.Lifts[i]];
                var nextSegment = route.Segments[i + 1];
                cost += LiftCycleSeconds + liftPenalty + LiftQueueWait(lift) + CongestionAt(nextSegment[0]);
                cost += planner.RouteCost(nextSegment, 0, passenger.Needs);
            }
            return cost;
        }

        int EdgeServer(int from, int to, out WalkEdgeKind kind) {
            kind = WalkEdgeKind.Walk;
            if (graph == null || from < 0 || to < 0) return -1;
            int best = -1;
            double bestCost = double.PositiveInfinity;
            for (int e = 0; e < graph.AdjTo[from].Length; e++) {
                if (graph.AdjTo[from][e] != to) continue;
                if (graph.AdjCost[from][e] >= bestCost) continue;
                bestCost = graph.AdjCost[from][e];
                kind = (WalkEdgeKind)graph.AdjKind[from][e];
                best = graph.AdjServer[from][e];
            }
            return best;
        }

        /// <summary>Walk toward a node at the graph's own floor speed, spending the tick's time budget.</summary>
        bool WalkToward(Passenger passenger, int node, int fromNode, int toNode, ref double timeLeft, out bool arrived) {
            arrived = false;
            if (node < 0) return false;
            double tx = graph.NodeX[node], ty = graph.NodeY[node], tz = graph.NodeZ[node];
            double dx = tx - passenger.X, dy = ty - passenger.Y;
            double dist = Math.Sqrt(dx * dx + dy * dy);
            if (dist > 1e-9) passenger.Heading = Math.Atan2(dy, dx);
            bool tappingGate = passenger.GateServer >= 0 && simTime - passenger.ActivityStart <= 2;
            double floorSpeed = (fromNode >= 0 && toNode >= 0 && fromNode < graph.NodeSpeed.Length && toNode < graph.NodeSpeed.Length)
                ? (graph.NodeSpeed[fromNode] + graph.NodeSpeed[toNode]) * 0.5
                : 1.0;
            if (floorSpeed <= 0) floorSpeed = 1;
            double speed = passenger.Speed * floorSpeed;
            double budget = speed * timeLeft;
            if (dist <= budget || dist < 0.02) {
                if (dist > 0) {
                    passenger.WalkDistance += dist;
                    if (speed > 0) timeLeft -= dist / speed;
                }
                passenger.X = tx; passenger.Y = ty; passenger.Z = tz;
                arrived = true;
                if (!tappingGate) passenger.Activity = StationPassengerActivity.Walk;
                passenger.WalkWeight = 1;
                return true;
            }
            double step = budget / dist;
            passenger.X += dx * step;
            passenger.Y += dy * step;
            passenger.Z += (tz - passenger.Z) * step;
            passenger.WalkDistance += budget;
            if (speed > 0) timeLeft -= budget / speed;
            else timeLeft = 0;
            if (!tappingGate) passenger.Activity = StationPassengerActivity.Walk;
            passenger.WalkWeight = 1;
            return false;
        }

        void JoinGate(Passenger passenger, GateFact gate, int from) {
            passenger.Phase = Phase.Queuing;
            passenger.Server = gate.Server;
            passenger.ServerId = "gate:" + gate.Id;
            passenger.GateDir = DirectionAtGate(gate, from, gate.Node);
            passenger.Activity = StationPassengerActivity.Wait;
            passenger.ActivityStart = simTime;
            passenger.ActivityTotal = 12;
            passenger.WalkWeight = 0;
            RegisterGateQueue(passenger, gate);
            GateStance(passenger, gate);
        }

        void JoinRide(Passenger passenger, RideFact ride) {
            ReleaseGateReservation(passenger);
            passenger.Phase = Phase.Queuing;
            passenger.Server = ride.Server;
            passenger.ServerId = "ride:" + ride.Server;
            passenger.RideColumn = ride.Columns > 1 ? ((ride.Served + ride.Queue.Count) % 2 == 0 ? -.35 : .35) : 0;
            passenger.Activity = StationPassengerActivity.Wait;
            passenger.ActivityStart = simTime;
            passenger.ActivityTotal = 12;
            passenger.WalkWeight = 0;
            ride.Queue.Add(passenger.Id);
            SyncServerQueue(ride.Server, ride.Queue.Count);
            RideEntryPoint(ride, passenger, out passenger.StandX, out passenger.StandY);
        }

        void StepRide(Passenger passenger) {
            double before = Math.Max(0, passenger.RideT);
            passenger.RideT = Math.Min(passenger.RideTotal, passenger.RideT + Dt);
            double k = passenger.RideT / passenger.RideTotal;
            if (passenger.RidePath != null) {
                passenger.RidePath.Sample(k, passenger.RideReverse, passenger.RideColumn,
                    out passenger.X, out passenger.Y, out passenger.Z, out passenger.Heading);
            } else {
                passenger.X = passenger.FromX + (passenger.ToX - passenger.FromX) * k;
                passenger.Y = passenger.FromY + (passenger.ToY - passenger.FromY) * k;
                passenger.Z = passenger.FromZ + (passenger.ToZ - passenger.FromZ) * k;
                passenger.Heading = Math.Atan2(passenger.ToY - passenger.FromY, passenger.ToX - passenger.FromX);
            }
            if (passenger.Activity == StationPassengerActivity.Walk && passenger.WalkWeight > .5)
                passenger.WalkDistance += ((passenger.RidePath?.Length ?? passenger.RideTotal) / passenger.RideTotal) *
                    (passenger.RideT - before);
            if (k < 1) return;
            passenger.Phase = Phase.Walking;
            passenger.ServerId = "";
            passenger.Activity = StationPassengerActivity.Walk;
            passenger.WalkWeight = 1;
            if (passenger.PathIndex < passenger.Path.Length - 1) passenger.PathIndex++;
            if (passenger.PathIndex >= passenger.Path.Length - 1) EndSegment(passenger);
        }

        /// <summary>
        /// The source's `stepTrainRider` stepping-out phase (`trainPhase === 2`): from the
        /// cabin slot to the doorway over `TRAIN_STEP_S`, then the passenger is an ordinary
        /// platform walker. The crossing is counted the tick the step lands, exactly where
        /// `World` counts `alighted` — that is the stop's visible delivery.
        /// </summary>
        void StepOutRide(Passenger passenger) {
            passenger.StepT += Dt;
            double k = Math.Min(1, passenger.StepT / StationServiceCadence.TrainStepSeconds);
            passenger.X = passenger.StepFromX + (passenger.StepToX - passenger.StepFromX) * k;
            passenger.Y = passenger.StepFromY + (passenger.StepToY - passenger.StepFromY) * k;
            passenger.Z = passenger.StepFromZ + (passenger.StepToZ - passenger.StepFromZ) * k;
            double dx = passenger.StepToX - passenger.StepFromX, dy = passenger.StepToY - passenger.StepFromY;
            if (Math.Abs(dx) + Math.Abs(dy) > 1e-9) passenger.Heading = Math.Atan2(dy, dx);
            if (k < 1) return;
            // `inFlight[d]--`, `train.alighted++`, `metrics.alighted++` — the passenger is
            // no longer in the doorway, so the doorway may be handed to the boarders.
            if (!watches.TryGetValue(passenger.TrainKey ?? "", out TrainWatch watch)) watch = null;
            if (watch != null && passenger.TrainDoor >= 0 && passenger.TrainDoor < watch.InFlight.Length) {
                watch.InFlight[passenger.TrainDoor] = Math.Max(0, watch.InFlight[passenger.TrainDoor] - 1);
                watch.Alighted++;
            }
            Alighted++;
            passenger.TrainKey = "";
            passenger.TrainDoor = -1;
            passenger.TrainRow = 0;
            passenger.ServerId = "";
            passenger.Activity = StationPassengerActivity.Walk;
            passenger.WalkWeight = 1;
            int exit = passenger.DestExit >= 0 ? passenger.DestExit : ResolveExitNode(passenger.DestExitId);
            var route = PlanRoute(passenger.DoorNode, exit, passenger.Needs);
            passenger.DoorNode = -1;
            if (route == null) { Stuck++; Kill(passenger); return; }
            passenger.Phase = Phase.Walking;
            BeginRoute(passenger, route);
        }

        int PickFreeLiftSlot(LiftConnector car) {
            bool[] used = new bool[LiftBatch];
            for (int i = 0; i < car.Riders.Count; i++) {
                var r = Find(car.Riders[i]);
                if (r != null && r.LiftSlot >= 0 && r.LiftSlot < LiftBatch) used[r.LiftSlot] = true;
            }
            for (int s = 0; s < LiftBatch; s++) if (!used[s]) return s;
            return car.Riders.Count % LiftBatch;
        }

        static void RotateLocal(int rot, double lx, double ly, out double rx, out double ry) {
            switch ((rot % 4 + 4) % 4) {
                case 1: rx = -ly; ry = lx; break;
                case 2: rx = -lx; ry = -ly; break;
                case 3: rx = ly; ry = -lx; break;
                default: rx = lx; ry = ly; break;
            }
        }

        static void LiftDoorOutward(LiftConnector car, double nodeX, double nodeY, out double ox, out double oy) {
            RotateLocal(car.Rotation, 0, -1, out double fx, out double fy);
            double proj = (nodeX - car.X) * fx + (nodeY - car.Y) * fy;
            if (proj >= 0) { ox = fx; oy = fy; }
            else { ox = -fx; oy = -fy; }
        }

        static void LiftDoorThreshold(LiftConnector car, double landingX, double landingY, double fromX, double fromY,
            out double doorX, out double doorY) {
            LiftDoorOutward(car, landingX, landingY, out double ox, out double oy);
            double half = car.Size * .5;
            double tx = -oy, ty = ox;
            double lateral = (fromX - car.X) * tx + (fromY - car.Y) * ty;
            double maxLat = Math.Max(.2, half - .45);
            lateral = Clamp(lateral, -maxLat, maxLat);
            doorX = car.X + ox * half + tx * lateral;
            doorY = car.Y + oy * half + ty * lateral;
        }

        static void LiftCabinSlot(LiftConnector car, int slot, out double sx, out double sy) {
            double k = car.Size * .5;
            double lx, ly;
            if (slot == 0) {
                lx = .245 * k;
                ly = 0;
            } else {
                int colIdx = slot % 3;
                double col = (colIdx == 0 ? -.45 : colIdx == 1 ? 0.0 : .45) * k;
                int row = (slot / 3) % 4;
                double rowY = (-.45 + row * .3) * k;
                lx = col;
                ly = rowY;
            }
            RotateLocal(car.Rotation, lx, ly, out double rx, out double ry);
            sx = car.X + rx;
            sy = car.Y + ry;
        }

        static bool WalkTowardPoint(Passenger passenger, double tx, double ty, double speed, ref double timeLeft) {
            double dx = tx - passenger.X, dy = ty - passenger.Y;
            double dist = Math.Sqrt(dx * dx + dy * dy);
            if (dist < .03) {
                passenger.X = tx;
                passenger.Y = ty;
                return true;
            }
            double budget = speed * timeLeft;
            if (dist <= budget) {
                passenger.X = tx;
                passenger.Y = ty;
                if (speed > 0) timeLeft -= dist / speed;
                else timeLeft = 0;
                return true;
            }
            double step = budget / dist;
            passenger.X += dx * step;
            passenger.Y += dy * step;
            timeLeft = 0;
            return false;
        }

        void LiftFaceDoor(Passenger passenger, LiftConnector car) {
            int refNode = passenger.LiftDestNode >= 0 && passenger.LiftDestNode < graph.NodeCount
                ? passenger.LiftDestNode
                : (passenger.LiftBoardNode >= 0 && passenger.LiftBoardNode < graph.NodeCount ? passenger.LiftBoardNode : -1);
            if (refNode >= 0) {
                LiftDoorOutward(car, graph.NodeX[refNode], graph.NodeY[refNode], out double ox, out double oy);
                passenger.Heading = Math.Atan2(oy, ox);
            } else {
                RotateLocal(car.Rotation, 0, -1, out double fx, out double fy);
                passenger.Heading = Math.Atan2(fy, fx);
            }
        }

        void FinishLiftExit(Passenger passenger, double destX, double destY, double destZ) {
            passenger.X = destX;
            passenger.Y = destY;
            passenger.Z = destZ;
            passenger.LiftId = "";
            passenger.LiftPhase = 0;
            passenger.LiftSlot = 0;
            passenger.LiftThresholdDone = false;
            passenger.LiftBoardNode = -1;
            passenger.LiftDestNode = -1;
            passenger.LiftBoardStop = -1;
            passenger.LiftDestStop = -1;
            passenger.ServerId = "";
            passenger.Activity = StationPassengerActivity.Walk;
            passenger.WalkWeight = 1;
            passenger.Segment++;
            BeginSegment(passenger);
        }

        void StepLiftRide(Passenger passenger) {
            if (passenger.LiftId == null || !liftById.TryGetValue(passenger.LiftId, out LiftConnector car)) {
                passenger.Phase = Phase.Walking;
                passenger.LiftPhase = 0;
                passenger.ServerId = "";
                return;
            }
            if (passenger.LiftPhase == 0) {
                // Walking into the cabin through the open doorway to the assigned slot.
                LiftCabinSlot(car, passenger.LiftSlot, out double slotX, out double slotY);
                if (car.CarDoor < .5) {
                    passenger.X = slotX;
                    passenger.Y = slotY;
                    passenger.Z = car.CarZ + 1;
                    passenger.LiftPhase = 1;
                    passenger.Activity = StationPassengerActivity.Lift;
                    passenger.ActivityStart = simTime;
                    passenger.ActivityTotal = 9;
                    passenger.WalkWeight = 0;
                    LiftFaceDoor(passenger, car);
                    return;
                }
                double startX = passenger.X, startY = passenger.Y;
                double timeLeft = Dt;
                bool arrived = false;
                if (!passenger.LiftThresholdDone) {
                    if (WalkTowardPoint(passenger, passenger.FromX, passenger.FromY, passenger.Speed, ref timeLeft))
                        passenger.LiftThresholdDone = true;
                }
                if (passenger.LiftThresholdDone && timeLeft > 1e-9) {
                    arrived = WalkTowardPoint(passenger, slotX, slotY, passenger.Speed, ref timeLeft);
                } else if (passenger.LiftThresholdDone) {
                    double dx = slotX - passenger.X, dy = slotY - passenger.Y;
                    arrived = dx * dx + dy * dy < .04 * .04;
                }
                passenger.Z = car.CarZ + 1;
                double cdx = passenger.X - startX, cdy = passenger.Y - startY;
                double moved = Math.Sqrt(cdx * cdx + cdy * cdy);
                passenger.WalkDistance += moved;
                if (moved > 1e-6) passenger.Heading = Math.Atan2(cdy, cdx);
                if (arrived) {
                    passenger.X = slotX;
                    passenger.Y = slotY;
                    passenger.LiftPhase = 1;
                    if (moved > .08) {
                        // Keep walking animation for the tick the passenger steps into their slot;
                        // the next tick settles into Lift stance and turns to face the door.
                        passenger.Activity = StationPassengerActivity.Walk;
                        passenger.WalkWeight = 1;
                    } else {
                        passenger.Activity = StationPassengerActivity.Lift;
                        passenger.ActivityStart = simTime;
                        passenger.ActivityTotal = 9;
                        passenger.WalkWeight = 0;
                        LiftFaceDoor(passenger, car);
                    }
                } else {
                    passenger.Activity = StationPassengerActivity.Walk;
                    passenger.WalkWeight = 1;
                }
                return;
            }
            if (passenger.LiftPhase == 1) {
                // Riding inside the cabin: pinned to the assigned slot, facing out the door.
                LiftCabinSlot(car, passenger.LiftSlot, out double slotX, out double slotY);
                passenger.X = slotX;
                passenger.Y = slotY;
                passenger.Z = car.CarZ + 1;
                LiftFaceDoor(passenger, car);
                if (passenger.Activity != StationPassengerActivity.Lift) {
                    passenger.Activity = StationPassengerActivity.Lift;
                    passenger.ActivityStart = simTime;
                    passenger.ActivityTotal = 9;
                }
                passenger.WalkWeight = 0;
                return;
            }
            // LiftPhase == 2: walking out of the cabin through the open doorway to the landing node.
            int destNode = passenger.LiftDestNode;
            double destX = destNode >= 0 && destNode < graph.NodeCount ? graph.NodeX[destNode] : passenger.ToX;
            double destY = destNode >= 0 && destNode < graph.NodeCount ? graph.NodeY[destNode] : passenger.ToY;
            double destZ = destNode >= 0 && destNode < graph.NodeCount ? graph.NodeZ[destNode] : car.CarZ + 1;
            if (car.CarDoor < .5) {
                FinishLiftExit(passenger, destX, destY, destZ);
                return;
            }
            double exitStartX = passenger.X, exitStartY = passenger.Y;
            double exitTimeLeft = Dt;
            bool exited = false;
            if (!passenger.LiftThresholdDone) {
                if (WalkTowardPoint(passenger, passenger.FromX, passenger.FromY, passenger.Speed, ref exitTimeLeft))
                    passenger.LiftThresholdDone = true;
            }
            if (passenger.LiftThresholdDone && exitTimeLeft > 1e-9) {
                exited = WalkTowardPoint(passenger, destX, destY, passenger.Speed, ref exitTimeLeft);
            } else if (passenger.LiftThresholdDone) {
                double dx = destX - passenger.X, dy = destY - passenger.Y;
                exited = dx * dx + dy * dy < .04 * .04;
            }
            passenger.Z = destZ;
            double edx = passenger.X - exitStartX, edy = passenger.Y - exitStartY;
            double exitMoved = Math.Sqrt(edx * edx + edy * edy);
            passenger.WalkDistance += exitMoved;
            if (exitMoved > 1e-6) passenger.Heading = Math.Atan2(edy, edx);
            passenger.Activity = StationPassengerActivity.Walk;
            passenger.WalkWeight = 1;
            if (exited) FinishLiftExit(passenger, destX, destY, destZ);
        }

        void StepLiftQueue(Passenger passenger) {
            if (passenger.LiftId == null || !liftById.TryGetValue(passenger.LiftId, out LiftConnector car)) {
                passenger.Phase = Phase.Walking;
                passenger.ServerId = "";
                return;
            }
            int rank = 0;
            for (int i = 0; i < car.Queue.Count && car.Queue[i] != passenger.Id; i++) {
                var ahead = Find(car.Queue[i]);
                if (ahead != null && ahead.LiftBoardStop == passenger.LiftBoardStop) rank++;
            }
            double tx = passenger.StandX, ty = passenger.StandY;
            int boardNode = passenger.LiftBoardNode;
            if (boardNode >= 0 && boardNode < graph.NodeCount) {
                tx = graph.NodeX[boardNode];
                ty = graph.NodeY[boardNode];
                passenger.StandX = tx;
                passenger.StandY = ty;
            }
            LiftDoorOutward(car, tx, ty, out double ox, out double oy);
            double dx = tx - passenger.X, dy = ty - passenger.Y;
            double dist = Math.Sqrt(dx * dx + dy * dy);
            double standoff = rank == 0 ? .12 : .30 + .44 * Math.Sqrt(rank);
            int z = JsRound(passenger.Z) - 1;
            bool hasFrom = graph.TryNode((int)Math.Floor(passenger.X), (int)Math.Floor(passenger.Y), z, out int from);
            bool directReach = !hasFrom || boardNode < 0 || from == boardNode ||
                Array.IndexOf(graph.AdjTo[from], boardNode) >= 0;
            if (dist <= standoff && (rank > 0 || directReach)) {
                passenger.Heading = Math.Atan2(-oy, -ox);
                if (passenger.Activity == StationPassengerActivity.Walk) {
                    passenger.Activity = StationPassengerActivity.Wait;
                    passenger.ActivityStart = simTime;
                }
                passenger.WalkWeight = 0;
                return;
            }
            double speed = passenger.Speed * (rank == 0 ? 1.0 : DensityDerate(LocalCrowdCount(passenger.X, passenger.Y, passenger.Z)));
            double oldX = passenger.X, oldY = passenger.Y;
            if (directReach && dist > standoff) {
                double step = Math.Min(speed * Dt, dist - standoff);
                double nx = passenger.X + dx / dist * step;
                double ny = passenger.Y + dy / dist * step;
                if (hasFrom) {
                    if (CanStepTo(from, nx, ny, z, boardNode)) { passenger.X = nx; passenger.Y = ny; }
                    else if (CanStepTo(from, nx, oldY, z, boardNode)) passenger.X = nx;
                    else if (CanStepTo(from, oldX, ny, z, boardNode)) passenger.Y = ny;
                } else {
                    passenger.X = nx;
                    passenger.Y = ny;
                }
            }
            double moved = Math.Sqrt((passenger.X - oldX) * (passenger.X - oldX) + (passenger.Y - oldY) * (passenger.Y - oldY));
            if (moved <= .08 && hasFrom && boardNode >= 0 && from != boardNode) {
                int detour = NextWalkStepToward(from, boardNode);
                if (detour >= 0 && detour != from) {
                    double ddx = graph.NodeX[detour] - passenger.X, ddy = graph.NodeY[detour] - passenger.Y;
                    double ddist = Math.Sqrt(ddx * ddx + ddy * ddy);
                    if (ddist > 1e-6) {
                        double maxStep = dist > standoff ? Math.Min(speed * Dt, dist - standoff) : speed * Dt;
                        double step = Math.Min(Math.Max(maxStep, Math.Min(speed * Dt, ddist)), ddist);
                        passenger.X += ddx / ddist * step;
                        passenger.Y += ddy / ddist * step;
                        moved = Math.Sqrt((passenger.X - oldX) * (passenger.X - oldX) + (passenger.Y - oldY) * (passenger.Y - oldY));
                    }
                }
            }
            passenger.WalkDistance += moved;
            if (moved > .08) {
                passenger.Heading = Math.Atan2(passenger.Y - oldY, passenger.X - oldX);
                passenger.Activity = StationPassengerActivity.Walk;
                passenger.WalkWeight = 1;
            } else {
                passenger.Heading = Math.Atan2(-oy, -ox);
                if (passenger.Activity == StationPassengerActivity.Walk) {
                    passenger.Activity = StationPassengerActivity.Wait;
                    passenger.ActivityStart = simTime;
                }
                passenger.WalkWeight = 0;
            }
        }

        void StepQueue(Passenger passenger) {
            if (passenger.Phase == Phase.LiftQueuing) {
                StepLiftQueue(passenger);
                return;
            }
            if (passenger.Server < 0) { passenger.Phase = Phase.Walking; return; }
            if (rideByServer.TryGetValue(passenger.Server, out var ride)) {
                StepRideQueue(passenger, ride);
                return;
            }
            if (gateByServer.TryGetValue(passenger.Server, out var gate) && passenger.Path.Length > 0) {
                if (RerouteGateQueue(passenger, gate)) return;
                GateStance(passenger, gate);
                int approach = Math.Min(passenger.PathIndex + 1, passenger.Path.Length - 1);
                if (passenger.Path[approach] != gate.Node) return;
            }
            double dx = passenger.StandX - passenger.X, dy = passenger.StandY - passenger.Y;
            double dist = Math.Sqrt(dx * dx + dy * dy);
            if (dist > 1e-9) passenger.Heading = Math.Atan2(dy, dx);
            double budget = passenger.Speed * Dt;
            if (dist > .05) {
                passenger.Activity = StationPassengerActivity.Walk;
                passenger.WalkWeight = 1;
            } else if (passenger.Activity == StationPassengerActivity.Walk) {
                passenger.Activity = StationPassengerActivity.Wait;
                passenger.ActivityStart = simTime;
                passenger.WalkWeight = 0;
            }
            if (dist <= budget) { passenger.WalkDistance += dist; passenger.X = passenger.StandX; passenger.Y = passenger.StandY; return; }
            double step = budget / dist;
            passenger.X += dx * step;
            passenger.Y += dy * step;
            passenger.WalkDistance += budget;
        }

        void StepRideQueue(Passenger passenger, RideFact ride) {
            int rank = ride.Queue.IndexOf(passenger.Id);
            if (rank < 0) rank = 0;
            RideEntryPoint(ride, passenger, out double tx, out double ty, out int entryNode);
            passenger.StandX = tx;
            passenger.StandY = ty;
            double dx = tx - passenger.X, dy = ty - passenger.Y;
            double dist = Math.Sqrt(dx * dx + dy * dy);
            if (dist > 1e-6) {
                passenger.Heading = Math.Atan2(dy, dx);
            } else if (ride.ExitNode >= 0) {
                passenger.Heading = Math.Atan2(graph.NodeY[ride.ExitNode] - ty, graph.NodeX[ride.ExitNode] - tx);
            }
            int frontSlots = Math.Max(1, ride.Columns);
            double standoff = rank < frontSlots ? 0.08 : 0.24 + 0.44 * Math.Sqrt(rank - frontSlots + 1);
            int z = JsRound(passenger.Z) - 1;
            bool hasFrom = graph.TryNode((int)Math.Floor(passenger.X), (int)Math.Floor(passenger.Y), z, out int from);
            bool directReach = !hasFrom || from == ride.Node || from == entryNode ||
                Array.IndexOf(graph.AdjTo[from], ride.Node) >= 0 ||
                (entryNode != ride.Node && Array.IndexOf(graph.AdjTo[from], entryNode) >= 0);
            bool behindObstacle = !directReach && dist < 1.5;
            if (dist <= standoff && (directReach || (rank >= frontSlots && !behindObstacle))) {
                if (passenger.Activity == StationPassengerActivity.Walk) {
                    passenger.Activity = StationPassengerActivity.Wait;
                    passenger.ActivityStart = simTime;
                }
                passenger.WalkWeight = 0;
                return;
            }
            double speed = passenger.Speed * (rank < frontSlots ? 1.0 : DensityDerate(LocalCrowdCount(passenger.X, passenger.Y, passenger.Z)));
            double oldX = passenger.X, oldY = passenger.Y;
            if (directReach && dist > standoff) {
                double step = Math.Min(speed * Dt, dist - standoff);
                double nx = passenger.X + dx / dist * step;
                double ny = passenger.Y + dy / dist * step;
                if (hasFrom) {
                    if (CanStepTo(from, nx, ny, z, ride.Node, entryNode)) { passenger.X = nx; passenger.Y = ny; }
                    else if (CanStepTo(from, nx, oldY, z, ride.Node, entryNode)) passenger.X = nx;
                    else if (CanStepTo(from, oldX, ny, z, ride.Node, entryNode)) passenger.Y = ny;
                } else {
                    passenger.X = nx;
                    passenger.Y = ny;
                }
            }
            double moved = Math.Sqrt((passenger.X - oldX) * (passenger.X - oldX) + (passenger.Y - oldY) * (passenger.Y - oldY));
            if (moved <= .08 && hasFrom && from != ride.Node && from != entryNode) {
                int detour = NextWalkStepToward(from, entryNode, ride.Node);
                if (detour >= 0 && detour != from) {
                    double ddx = graph.NodeX[detour] - passenger.X, ddy = graph.NodeY[detour] - passenger.Y;
                    double ddist = Math.Sqrt(ddx * ddx + ddy * ddy);
                    if (ddist > 1e-6) {
                        double step = Math.Min(speed * Dt, ddist);
                        passenger.X += ddx / ddist * step;
                        passenger.Y += ddy / ddist * step;
                        moved = Math.Sqrt((passenger.X - oldX) * (passenger.X - oldX) + (passenger.Y - oldY) * (passenger.Y - oldY));
                    }
                }
            }
            passenger.WalkDistance += moved;
            if (moved > .08) {
                passenger.Heading = Math.Atan2(passenger.Y - oldY, passenger.X - oldX);
                passenger.Activity = StationPassengerActivity.Walk;
                passenger.WalkWeight = 1;
            } else {
                if (passenger.Activity == StationPassengerActivity.Walk) {
                    passenger.Activity = StationPassengerActivity.Wait;
                    passenger.ActivityStart = simTime;
                }
                passenger.WalkWeight = 0;
            }
        }

        /// <summary>
        /// The consist half of the tick, in the source's order and on the source's own
        /// phase clock (`World.dispatchTrains`):
        /// <list type="number">
        /// <item>a consist arriving at **berth** seats its alighting wave, once per berth —
        /// a *new* <see cref="StationTrainFrame.ServiceSequence"/> re-seats even when the
        /// previous stop's cabin had not fully drained;</item>
        /// <item>each tick whose *pre-transition* phase was opening or dwell runs
        /// `stepAlighting`; on the tick a phase transition is reported the transition
        /// already happened, so the phase the source was in when it stepped is the phase
        /// *before* the one the frame now publishes: opening at t=0 is skipped (berth ran),
        /// dwell at t=0 and closing at t=0 are stepped (opening and dwell ran);</item>
        /// <item>the tick the doors begin to close (`closing`, t=0) is `closeDoors`:
        /// every doorway's latch shuts and whoever is still queued is left behind;</item>
        /// <item>the tick the consist reaches `hold` (t=0) is `emptyTrain`: the riders ride
        /// out, the arrivals still in a cabin are the stop's left-behind count, and the
        /// wave that never reached a cabin is dropped.</item>
        /// </list>
        /// </summary>
        void StepConsists(StationTrainFrame[] trains) {
            if (trains == null) return;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < trains.Length; i++) {
                var frame = trains[i];
                string key = (frame.LineId ?? "") + "|" + (frame.TrackId ?? "");
                seen.Add(key);
                var watch = Watch(frame.LineId, frame.TrackId);
                // A new consist run for this service: its own stop starts from nothing.
                if (frame.ServiceSequence != watch.Sequence) {
                    watch.Sequence = frame.ServiceSequence;
                    watch.Seated = false;
                    watch.AlightLeft = 0;
                    watch.AlightT = 0;
                    watch.BerthTime = 0;
                    watch.ResetDoors(watch.Doors.Count);
                }
                if (frame.Phase == TrainPhase.Berth) {
                    if (!watch.Seated) {
                        watch.Seated = true;
                        watch.BerthTime = simTime;
                        SeatAlightingWave(watch, frame);
                    }
                } else if (frame.Phase == TrainPhase.Opening && frame.PhaseSeconds <= 0) {
                    // The berth tick: the source opens the doors but does not alight yet.
                } else if (frame.Phase == TrainPhase.Opening || frame.Phase == TrainPhase.Dwell ||
                           (frame.Phase == TrainPhase.Closing && frame.PhaseSeconds <= 0)) {
                    if (watch.Seated) StepAlighters(watch);
                }
                if (frame.Phase == TrainPhase.Closing && frame.PhaseSeconds <= 0 && watch.Last != TrainPhase.Closing) {
                    CloseDoors(watch);
                }
                if (frame.Phase == TrainPhase.Hold && watch.Last != TrainPhase.Hold) EmptyTrain(watch);
                watch.Last = frame.Phase;
            }
            var stale = new List<string>();
            foreach (var pair in watches) if (!seen.Contains(pair.Key)) stale.Add(pair.Key);
            for (int i = 0; i < stale.Count; i++) watches.Remove(stale[i]);
        }

        TrainWatch Watch(string lineId, string trackId) {
            string key = (lineId ?? "") + "|" + (trackId ?? "");
            if (!watches.TryGetValue(key, out TrainWatch watch)) {
                watch = new TrainWatch { Key = key, LineId = lineId ?? "", TrackId = trackId ?? "" };
                watches[key] = watch;
            }
            if (watch.Capacity <= 0) watch.Capacity = CapacityFor(lineId, trackId);
            if (!doorsByService.TryGetValue(key, out var serviceDoors)) serviceDoors = new List<DoorFact>();
            if (!ReferenceEquals(watch.Doors, serviceDoors)) {
                watch.Doors = serviceDoors;
                watch.ResetDoors(serviceDoors.Count);
            }
            return watch;
        }

        static StationTrainFrame? TrainFor(StationTrainFrame[] trains, string lineId, string trackId) {
            if (trains == null) return null;
            for (int i = 0; i < trains.Length; i++)
                if (trains[i].LineId == lineId && trains[i].TrackId == trackId) return trains[i];
            return null;
        }

        /// <summary>The authored wave for a line: the document's `alightPerTrain`, else the options' fallback.</summary>
        int WaveFor(string lineId) {
            var line = FindLine(lineId);
            // The document authors the wave; a hand-built fixture that names none keeps the
            // service options fallback. An authored 0 is a real zero-alighter stop.
            return line.AuthoredAlight ? Math.Max(0, line.AlightPerTrain) : Math.Max(0, options.AlightPerTrain);
        }

        StationLineFact FindLine(string lineId) {
            if (document != null) {
                for (int i = 0; i < document.Lines.Count; i++)
                    if (string.Equals(document.Lines[i].Id, lineId, StringComparison.Ordinal)) return document.Lines[i];
            }
            return StationLineFact.Default;
        }

        static string ServiceKey(string lineId, string trackId) => (lineId ?? "") + "|" + (trackId ?? "");

        /// <summary>
        /// The source's `loadAlighting`, door for door: the whole wave is placed in the
        /// doorways it will leave by — one row at a time **across** the consist, so a wave
        /// smaller than the cabins spreads over every doorway instead of packing the first
        /// car, and two abreast per doorway (`file` −1/+1) per row. A wave too big for the
        /// cabin (12 rows deep) keeps the remainder on `AlightLeft` and is seated as the
        /// rows drain.
        ///
        /// The cabin slot is `World.cabinWorldPos` over the sim's own consist pose
        /// (`StationTrainPose`, 18 §8.2): the rider starts **inside its car**, at the cabin
        /// floor, in the row and file it will leave by, so the release walks it out of a
        /// doorway that is drawn under it. Only a line-only service (no track to stand a
        /// consist on) keeps the source's no-consist branch  the rider waits at its own
        /// doorway, one file either side, at the car floor's height over the platform. The
        /// release tick, the doorway and the crossing are the facts the stop is compared on.
        /// </summary>
        void SeatAlightingWave(TrainWatch watch, StationTrainFrame frame) {
            int doorCount = watch.Doors.Count;
            if (doorCount == 0) return;
            watch.AlightLeft = Math.Max(0, WaveFor(frame.LineId));
            for (int row = 0; row < StationServiceCadence.CabinMaxRows && watch.AlightLeft > 0; row++) {
                for (int d = 0; d < doorCount && watch.AlightLeft > 0; d++) {
                    int seated = 0;
                    for (int f = 0; f < 2; f++) {
                        int file = f == 0 ? -1 : 1;
                        if (watch.AlightLeft <= 0) break;
                        if (!SeatAlighter(watch, d, file, row)) break;
                        watch.AlightLeft--;
                        seated++;
                    }
                    if (seated > 0) watch.CabinRows[d] = row + 1;
                }
            }
        }

        /// <summary>Put one alighting passenger in a doorway's cabin queue (`World.seatAlighter`).</summary>
        bool SeatAlighter(TrainWatch watch, int doorIndex, int file, int row) {
            if (passengers.Count >= options.MaxPassengers) { CapHit++; return false; }
            var door = watch.Doors[doorIndex];
            if (door.Node < 0) return false;
            var berth = BerthFor(watch.LineId, watch.TrackId);
            double nodeX = graph.NodeX[door.Node], nodeY = graph.NodeY[door.Node], nodeZ = graph.NodeZ[door.Node];
            double x, y, z;
            if (!StationTrainPose.CabinWorldPos(berth, nodeX, nodeY, file, row, out x, out y, out z)) {
                // The source's **no-consist** branch: a platform edge with no rail under it.
                // There is no car to stand in and none drawn, so the wave waits where it would
                // leave from  at its own doorway, at the car floor's height over the platform.
                // (This branch is for a line-only service, never for a track-bound one.)
                x = nodeX + file * 0.3;
                y = nodeY + (row % 2 == 0 ? -.15 : .15);
                z = nodeZ;
            }
            double dx = nodeX - x, dy = nodeY - y;
            string destExitId;
            int destExit = PickExit(out destExitId);
            var passenger = new Passenger {
                Id = ++nextPassengerId,
                X = x, Y = y, Z = z,
                SeatX = x, SeatY = y, SeatZ = z,
                Heading = Math.Abs(dx) + Math.Abs(dy) > 1e-9 ? Math.Atan2(dy, dx) : 0,
                DoorNode = door.Node,
                TrainKey = watch.Key,
                TrainDoor = doorIndex,
                TrainFile = file,
                TrainRow = row,
                Phase = Phase.Alighting,
                Boards = false,
                Activity = StationPassengerActivity.Walk,
                ServerId = "line:" + watch.LineId + "|" + watch.TrackId,
                // The trip's destination is sampled when the wave is seated (the source's
                // `sampleTripFromTrain`), not when the rider reaches the platform.
                DestExit = destExit,
                DestExitId = destExitId,
                RouteGraphEpoch = graphEpoch,
            };
            // Sample the same mobility mix as street arrivals without changing the demand RNG.
            passenger.Needs = new StationRouteNeeds {
                StepFree = IdentityUnit(passenger.Id, 0x17832bd1u) < StepFreeChance,
                Luggage = IdentityUnit(passenger.Id, 0xb17f0c83u) < LuggageChance,
            };
            passenger.IdentityFactor = 0.9 + IdentityUnit(passenger.Id, 0x85a308d3u) * 0.2;
            passenger.Speed = WalkSpeed * passenger.IdentityFactor;
            passenger.WalkPhase = IdentityUnit(passenger.Id, 0x9e3779b9u);
            passengers.Add(passenger);
            Spawned++;
            watch.Cabins[doorIndex].Add(passenger.Id);
            return true;
        }

        /// <summary>
        /// The source's `stepAlighting`: refill a doorway's cabin from the wave it could not
        /// hold, then let the front row out at the doorway's own 1.2 s pair cadence, and —
        /// once that doorway has no rows and nobody in flight — hand **that doorway** (not
        /// the whole consist) to the boarders. Past `CABIN_ALIGHT_MAX_S` the doorway turns
        /// to boarding whatever is left, and the rest of the wave rides on, counted as the
        /// stop's left-behind arrivals.
        /// </summary>
        void StepAlighters(TrainWatch watch) {
            int doorCount = watch.Doors.Count;
            watch.AlightT += Dt;
            bool streaming = watch.AlightT <= StationServiceCadence.AlightMaxSeconds + 1e-9;
            if (!streaming) {
                LeftBehind += watch.AlightLeft;
                watch.AlightLeft = 0;
                for (int d = 0; d < doorCount; d++) {
                    watch.Cabins[d].Clear();
                    watch.CabinRows[d] = 0;
                }
            }
            for (int d = 0; d < doorCount; d++) {
                var door = watch.Doors[d];
                var cabin = watch.Cabins[d];
                if (streaming) {
                    // Refill first: the wave the cabin could not hold is seated as room appears.
                    while (watch.AlightLeft > 0 && watch.CabinRows[d] < StationServiceCadence.CabinMaxRows) {
                        int row = watch.CabinRows[d];
                        if (!SeatAlighter(watch, d, -1, row)) { watch.AlightLeft = 0; break; }
                        watch.AlightLeft--;
                        // An odd wave leaves one seat in its last row empty.
                        if (watch.AlightLeft > 0 && SeatAlighter(watch, d, 1, row)) watch.AlightLeft--;
                        watch.CabinRows[d] = row + 1;
                    }
                    // Then let the front row out, at the doorway's own cadence.
                    watch.DoorT[d] -= Dt;
                    if (watch.DoorT[d] <= 0 && cabin.Count > 0) {
                        int released = 0;
                        for (int q = cabin.Count - 1; q >= 0; q--) {
                            var passenger = Find(cabin[q]);
                            if (passenger == null) { cabin.RemoveAt(q); continue; }
                            if (passenger.TrainRow > 0) continue;
                            StepOut(watch, passenger, door.Node);
                            cabin.RemoveAt(q);
                            watch.InFlight[d]++;
                            released++;
                        }
                        if (released > 0) {
                            watch.CabinRows[d] = Math.Max(0, watch.CabinRows[d] - 1);
                            // Accumulated, not reset: the cadence is an average, so a
                            // one-second tick does not stretch a 1.2 s pair into two ticks.
                            watch.DoorT[d] += StationServiceCadence.AlightPairSeconds;
                            // The rows behind shuffle up to the doorway they just left.
                            for (int q = 0; q < cabin.Count; q++) {
                                var passenger = Find(cabin[q]);
                                if (passenger != null) passenger.TrainRow--;
                            }
                        }
                    }
                }
                // A clear doorway boards. Anyone still stepping out is still in it.
                if (door.Rate <= 0 && watch.CabinRows[d] == 0 && watch.InFlight[d] == 0) {
                    door.Rate = StationServiceCadence.DoorRate;
                }
            }
        }

        /// <summary>
        /// The source's `stepOut`: a step from the cabin slot to the doorway, over
        /// `TRAIN_STEP_S`, two abreast either side of the doorway's centre. The passenger
        /// becomes a platform walker only when the step lands.
        /// </summary>
        void StepOut(TrainWatch watch, Passenger passenger, int node) {
            var berth = BerthFor(watch.LineId, watch.TrackId);
            StationTrainPose.StepOutTarget(berth, graph.NodeX[node], graph.NodeY[node], graph.NodeZ[node],
                passenger.TrainFile, out double toX, out double toY, out double toZ);
            passenger.StepT = 0;
            passenger.StepFromX = passenger.X;
            passenger.StepFromY = passenger.Y;
            passenger.StepFromZ = passenger.Z;
            passenger.StepToX = toX;
            passenger.StepToY = toY;
            passenger.StepToZ = toZ;
            passenger.DoorNode = node;
            passenger.Phase = Phase.Stepping;
        }

        /// <summary>
        /// The sim's own consist pose for one service (18 §8.2): the frame cabin slots, riders
        /// and the step-out are placed in. Null for a line-only service (no track), which is the
        /// only case the source's no-consist branch covers.
        /// </summary>
        StationTrainBerth BerthFor(string lineId, string trackId) {
            string key = ServiceKey(lineId, trackId);
            if (berths.TryGetValue(key, out var held)) return held;
            StationTrainBerth berth = null;
            if (!string.IsNullOrEmpty(trackId) && document != null) {
                StationTrainPose.TryBerth(document, FindLine(lineId), true, trackId,
                    StationTrainPose.DefaultScale, out berth, out _);
            }
            berths[key] = berth;
            return berth;
        }

        /// <summary>The source's `closeDoors`: every doorway's latch shuts, and whoever is still queued is left behind.</summary>
        void CloseDoors(TrainWatch watch) {
            for (int d = 0; d < watch.Doors.Count; d++) {
                var door = watch.Doors[d];
                door.Rate = 0;
                LeftBehind += door.Queue.Count;
                door.Queue.Clear();
            }
        }

        /// <summary>
        /// The source's `emptyTrain`: closed doors clear everyone still aboard before
        /// departure. The boarders ride out (they boarded it), a member of the wave that
        /// never got off is stranded on the train and counted, and whatever never even
        /// reached a cabin is dropped.
        /// </summary>
        void EmptyTrain(TrainWatch watch) {
            for (int i = passengers.Count - 1; i >= 0; i--) {
                var passenger = passengers[i];
                if (passenger.Phase != Phase.TrainRiding && passenger.Phase != Phase.Alighting && passenger.Phase != Phase.Stepping) continue;
                if (!string.Equals(passenger.TrainKey, watch.Key, StringComparison.Ordinal)) continue;
                if (passenger.Phase == Phase.Alighting) LeftBehind++;
                if (passenger.Phase == Phase.TrainRiding) Onboard--;
                Kill(passenger);
            }
            for (int d = 0; d < watch.Cabins.Length; d++) {
                watch.Cabins[d].Clear();
                watch.InFlight[d] = 0;
                watch.CabinRows[d] = 0;
            }
            LeftBehind += Math.Max(0, watch.AlightLeft);
            watch.AlightLeft = 0;
            watch.Onboard = 0;
            watch.Seated = false;
        }

        // ---------------------------------------------------------------- helpers

        int DirectionAtGate(GateFact gate, int from, int to) =>
            StationWalkGraphBuilder.GateTravelDirection(gate.Rotation, (int)(graph.NodeX[to] - graph.NodeX[from]),
                (int)(graph.NodeY[to] - graph.NodeY[from]));

        void GateStance(Passenger passenger, GateFact gate) {
            int rank = 0;
            for (int i = 0; i < gate.Queue.Count && gate.Queue[i] != passenger.Id; i++) {
                var ahead = Find(gate.Queue[i]);
                if (ahead != null && ahead.GateDir == passenger.GateDir) rank++;
            }
            int side = passenger.GateDir == 0 ? 1 : passenger.GateDir;
            int rot = (gate.Rotation % 4 + 4) % 4;
            int dx = rot == 1 ? -side : rot == 3 ? side : 0;
            int dy = rot == 0 ? side : rot == 2 ? -side : 0;
            double x = graph.NodeX[gate.Node], y = graph.NodeY[gate.Node];
            int cx = (int)Math.Floor(x), cy = (int)Math.Floor(y);
            int z = JsRound(graph.NodeZ[gate.Node]) - 1;
            int last = gate.Node;
            double tail = .65 + .58 * rank;
            double reached = 0;
            for (int n = 1; n <= Math.Ceiling(tail); n++) {
                if (!graph.TryNode(cx - dx * n, cy - dy * n, z, out int next) ||
                    graph.ServerForNode.ContainsKey(next) || Array.IndexOf(graph.AdjTo[last], next) < 0) break;
                last = next;
                reached = n;
            }
            double offset = Math.Min(tail, reached);
            passenger.GateQueueOverflow = tail > reached && rank > 0;
            passenger.StandX = x - dx * offset;
            passenger.StandY = y - dy * offset;
        }

        void StandAt(Passenger passenger, int node) {
            if (node < 0 || graph == null) { passenger.StandX = passenger.X; passenger.StandY = passenger.Y; return; }
            // Hold the queue a small step back from the node it is waiting for, so a
            // line of bodies does not stand inside the doorway or the car itself.
            double dx = passenger.X - graph.NodeX[node];
            double dy = passenger.Y - graph.NodeY[node];
            double length = Math.Sqrt(dx * dx + dy * dy);
            if (length < 1e-6) { passenger.StandX = graph.NodeX[node]; passenger.StandY = graph.NodeY[node]; return; }
            const double standoff = 0.42;
            passenger.StandX = graph.NodeX[node] + dx / length * standoff;
            passenger.StandY = graph.NodeY[node] + dy / length * standoff;
        }

        Passenger Find(int id) {
            if (id <= 0) return null;
            int lo = 0, hi = passengers.Count - 1;
            while (lo <= hi) {
                int mid = (lo + hi) >> 1;
                int midId = passengers[mid].Id;
                if (midId == id) return passengers[mid];
                if (midId < id) lo = mid + 1; else hi = mid - 1;
            }
            return null;
        }

        DoorFact DoorForNode(int node) {
            if (node < 0) return null;
            for (int i = 0; i < doors.Count; i++) if (doors[i].Node == node) return doors[i];
            return null;
        }

        void Kill(Passenger passenger) {
            ReleaseGateReservation(passenger);
            passenger.Phase = Phase.Dead;
        }

        void Compact() {
            int write = 0;
            for (int i = 0; i < passengers.Count; i++) {
                if (passengers[i].Phase == Phase.Dead) continue;
                passengers[write++] = passengers[i];
            }
            if (write < passengers.Count) passengers.RemoveRange(write, passengers.Count - write);
        }

        StationPassengerFrame Frame(Passenger passenger) {
            var frame = new StationPassengerFrame {
                SimId = passenger.Id,
                X = passenger.X, Y = passenger.Y, Z = passenger.Z,
                Heading = passenger.Heading,
                Activity = passenger.Activity,
                RidePath = passenger.RidePath,
                RideProgress = passenger.RideTotal > 0 ? passenger.RideT / passenger.RideTotal : 0,
                RideSeconds = passenger.RideTotal,
                RideColumn = passenger.RideColumn,
                RideReverse = passenger.RideReverse,
                RailVariant = passenger.RailVariant,
                WalkDistance = passenger.WalkDistance,
                WalkPhase = passenger.WalkPhase,
                WalkWeight = passenger.WalkWeight,
                ServerId = passenger.ServerId ?? "",
                Visible = true,
            };
            double elapsed = simTime - passenger.ActivityStart;
            switch (passenger.Phase) {
                case Phase.Walking:
                    frame.State = StationPassengerState.Walking;
                    frame.ActivitySeconds = Math.Max(0, elapsed);
                    break;
                case Phase.Queuing:
                case Phase.LiftQueuing:
                    frame.State = StationPassengerState.Queuing;
                    frame.ActivitySeconds = passenger.ActivityTotal > 0 ? Clamp(elapsed, 0, passenger.ActivityTotal) : 0;
                    break;
                case Phase.Riding:
                    frame.State = StationPassengerState.Riding;
                    frame.ActivitySeconds = passenger.RideT;
                    break;
                case Phase.LiftRiding:
                    frame.State = passenger.LiftPhase == 1 && passenger.Activity == StationPassengerActivity.Lift
                        ? StationPassengerState.Riding
                        : StationPassengerState.Walking;
                    frame.ActivitySeconds = passenger.ActivityTotal > 0 ? Clamp(elapsed, 0, passenger.ActivityTotal) : 0;
                    break;
                case Phase.TrainRiding:
                    frame.State = StationPassengerState.Boarding;
                    frame.ActivitySeconds = Clamp(elapsed, 0, passenger.ActivityTotal);
                    break;
                case Phase.Stepping:
                    // Stepping out of the cabin is the visible Alighting transition: the
                    // actor moves across the threshold until the step lands, then walks.
                    frame.State = StationPassengerState.Alighting;
                    frame.ActivitySeconds = Clamp(passenger.StepT, 0, StationServiceCadence.TrainStepSeconds);
                    break;
                default:
                    frame.State = StationPassengerState.Alighting;
                    frame.ActivitySeconds = 0;
                    break;
            }
            return frame;
        }

        static double Clamp(double value, double low, double high) => value < low ? low : value > high ? high : value;

        /// <summary>The source's <c>identityHash</c> stream: stable per id, never an RNG draw.</summary>
        public static double IdentityUnit(int id, uint salt) {
            unchecked {
                uint hash = (uint)id ^ salt;
                hash = hash * 0x85ebca6bu;
                hash ^= hash >> 16;
                hash = hash * 0xc2b2ae35u;
                hash ^= hash >> 16;
                return hash / 4294967296.0;
            }
        }
    }
}
