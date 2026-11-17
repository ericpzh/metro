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
            public bool Boards;
            public double RideT, RideTotal;
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
        }

        internal sealed class GateFact {
            public string Id = "";
            public int Server = -1, Node = -1, Mode;
            public double Rate;
            public int Batch = 1, Cycle;
            public readonly List<int> Queue = new List<int>();
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
            public readonly List<int> Queue = new List<int>();
            public double Cooldown;
            public int Served, Admitted;
        }

        internal sealed class LiftConnector {
            public string Id = "";
            public int NodeA = -1, NodeB = -1;
            public int StopA = -1, StopB = -1;
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
                        if (walkGraph.NodeIndex.TryGetValue(StationWalkGraph.CellKey(cx + dx, cy + dy, cz), out int node)) {
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
                lifts[i].CarDoor = 0; lifts[i].CarStop = lifts[i].StopA; lifts[i].Served = 0; lifts[i].Admitted = 0;
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
            StepConsists(trains);
            StepSpawn(serviceOpen, demandRate);
            StepGates();
            StepRides();
            StepDoors(trains);
            StepLiftQueues();
            StepPassengers();
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

        /// <summary>With the doors open at a stop, let riders out and waiting passengers in.</summary>
        public void LiftExchange(string liftId, int stop) {
            if (liftId == null || !liftById.TryGetValue(liftId, out LiftConnector car)) return;
            if (car.CarDoor < 1 - 1e-9) return;
            for (int i = car.Riders.Count - 1; i >= 0; i--) {
                var rider = Find(car.Riders[i]);
                if (rider == null) { car.Riders.RemoveAt(i); continue; }
                if (rider.LiftDestStop != stop) continue;
                car.Riders.RemoveAt(i);
                rider.X = graph.NodeX[rider.LiftDestNode];
                rider.Y = graph.NodeY[rider.LiftDestNode];
                rider.Z = graph.NodeZ[rider.LiftDestNode];
                rider.ServerId = "";
                rider.Segment++;
                BeginSegment(rider);
            }
            while (car.Riders.Count < LiftBatch) {
                int at = -1;
                for (int i = 0; i < car.Queue.Count; i++) {
                    var waiting = Find(car.Queue[i]);
                    if (waiting == null) { car.Queue.RemoveAt(i); i--; continue; }
                    if (waiting.LiftBoardStop == stop) { at = i; break; }
                }
                if (at < 0) break;
                var passenger = Find(car.Queue[at]);
                car.Queue.RemoveAt(at);
                if (passenger == null) continue;
                passenger.Phase = Phase.LiftRiding;
                passenger.Activity = StationPassengerActivity.Lift;
                passenger.ActivityStart = simTime;
                passenger.ActivityTotal = 9;
                passenger.WalkWeight = 0;
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

        internal static StagedServiceFacts BuildServiceFacts(StationSessionDocument doc, StationWalkGraph walkGraph) {
            var staged = new StagedServiceFacts {
                Document = doc ?? new StationSessionDocument(),
                Graph = walkGraph,
                Planner = walkGraph != null ? new StationRoutePlanner(walkGraph) : null,
            };
            staged.Unported.Add("crowd-collision");
            staged.Unported.Add("crowd-replanning");
            staged.Unported.Add("errands:shop,shelf,bench,cubicle,sink");
            staged.Unported.Add("transfers:second-line");
            staged.Unported.Add("consist-geometry");
            if (walkGraph == null || doc == null) return staged;

            // Gates: one server per walkable gate cell, keyed by the gate module id.
            for (int i = 0; i < doc.Modules.Count; i++) {
                var module = doc.Modules[i];
                if (module.Type != "gate" || !module.GateHasLane) continue;
                if (!walkGraph.TryNode(module.X, module.Y, module.Z, out int node)) continue;
                StationServerFact server = null;
                for (int s = 0; s < walkGraph.Servers.Count; s++) {
                    var candidate = walkGraph.Servers[s];
                    if (candidate.Kind == "gate" && candidate.Node == node) { server = candidate; break; }
                }
                if (server == null) continue;
                var gate = new GateFact {
                    Id = module.Id ?? "", Server = server.Id, Node = node, Mode = module.GateDir,
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
                        if (door.Node >= 0) {
                            for (int srv = 0; srv < walkGraph.Servers.Count; srv++) {
                                var candidate = walkGraph.Servers[srv];
                                if (candidate.Kind != "door" || candidate.Node != door.Node) continue;
                                door.Server = srv;
                                staged.DoorByServer[srv] = door;
                                break;
                            }
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
                var ride = new RideFact { Server = s, Node = server.Node, ExitNode = server.ExitNode, Kind = kind, Rate = server.Rate, Ride = server.Ride };
                staged.Rides.Add(ride);
                staged.RideByServer[s] = ride;
            }

            // Lift connectors: the landing rows on each side of a shaft.
            for (int i = 0; i < doc.Modules.Count; i++) {
                var module = doc.Modules[i];
                if (module.Type != "lift" || !module.HasEndpoints) continue;
                int size = module.Width >= 3 ? 3 : 2;
                var stops = StationLiftStops.Levels(module);
                int loZ = Math.Min(module.FromZ, module.ToZ), hiZ = Math.Max(module.FromZ, module.ToZ);
                if (hiZ - loZ < 1) continue;
                int a = LandingNode(walkGraph, module, size, loZ);
                int b = LandingNode(walkGraph, module, size, hiZ);
                if (a < 0 || b < 0) { staged.Unported.Add("lift-landing:" + module.Id); continue; }
                int stopA = stops.IndexOf(loZ), stopB = stops.IndexOf(hiZ);
                if (stopA < 0 || stopB < 0) { staged.Unported.Add("lift-stop:" + module.Id); continue; }
                var connector = new LiftConnector {
                    Id = module.Id ?? "", NodeA = a, NodeB = b, StopA = stopA, StopB = stopB,
                    Stops = stops.ToArray(), CarZ = stops[stopA], CarStop = stopA,
                };
                staged.Lifts.Add(connector);
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

        /// <summary>
        /// Port of the crowd/service tail of <c>World.rebuild</c>: swap in staged graph and
        /// service servers, keep cumulative counters and RNG untouched, preserve active
        /// consist riders whose doorways still match (or clear recut cabins without charging
        /// <see cref="LeftBehind"/>), relocate standing passengers off newly placed road
        /// footprints, invalidate old route/server/lift references, and replan routes on the
        /// new graph while recomputing active queues.
        /// </summary>
        internal void ApplyStagedEdit(StagedServiceFacts staged) {
            InstallFacts(staged);

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

            for (int i = 0; i < passengers.Count; i++) {
                var passenger = passengers[i];
                if (passenger.Phase == Phase.Dead) continue;
                if (!string.IsNullOrEmpty(passenger.TrainKey)) {
                    // If the consist had no watch entry (defensive), clear it without LeftBehind.
                    if (!watches.ContainsKey(passenger.TrainKey)) {
                        if (passenger.Phase == Phase.TrainRiding) Onboard = Math.Max(0, Onboard - 1);
                        Kill(passenger);
                    }
                    continue;
                }

                Phase prevPhase = passenger.Phase;
                string prevServerId = passenger.ServerId ?? "";
                int prevGateServer = passenger.GateServer;
                int prevGateDir = passenger.GateDir;
                double prevFromX = passenger.FromX, prevFromY = passenger.FromY, prevFromZ = passenger.FromZ;
                double prevToX = passenger.ToX, prevToY = passenger.ToY, prevToZ = passenger.ToZ;

                if (prevPhase != Phase.Riding && prevPhase != Phase.LiftRiding &&
                    RoadContainsPoint(document, passenger.X, passenger.Y, JsRound(passenger.Z) - 1)) {
                    int nearestFloor = NearestFloorNodeOnLevel(graph, passenger.X, passenger.Y, JsRound(passenger.Z));
                    if (nearestFloor < 0) { Kill(passenger); continue; }
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
                passenger.DoorNode = -1;
                passenger.LiftId = "";
                passenger.LiftBoardNode = -1;
                passenger.LiftDestNode = -1;
                passenger.LiftBoardStop = -1;
                passenger.LiftDestStop = -1;
                passenger.RideT = 0;
                passenger.RideTotal = 0;
                passenger.Phase = Phase.Walking;
                passenger.Activity = StationPassengerActivity.Walk;
                passenger.WalkWeight = 0;

                if (graph == null || planner == null || fromNode < 0) {
                    passenger.AwaitingRoute = true;
                    continue;
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
                        continue;
                    }
                    var route = PlanDoorRoute(fromNode, lineId, passenger.Needs);
                    if (route == null) {
                        passenger.AwaitingRoute = true;
                        continue;
                    }
                    StartRebuiltRoute(passenger, route, prevPhase, prevServerId, prevGateServer >= 0, prevGateDir);
                } else {
                    int destExit = ResolveExitNode(passenger.DestExitId);
                    passenger.DestExit = destExit;
                    if (destExit < 0) {
                        passenger.AwaitingRoute = true;
                        continue;
                    }
                    if (fromNode == destExit) {
                        var completeRoute = new ServiceRoute { Segments = new[] { new[] { fromNode } }, Cost = 0 };
                        passenger.Route = completeRoute;
                        passenger.RouteGraphEpoch = graphEpoch;
                        passenger.Segment = 0;
                        passenger.Path = completeRoute.Segments[0];
                        passenger.PathIndex = 0;
                        passenger.Phase = Phase.Walking;
                        continue;
                    }
                    var route = PlanRoute(fromNode, destExit, passenger.Needs);
                    if (route == null) {
                        passenger.AwaitingRoute = true;
                        continue;
                    }
                    StartRebuiltRoute(passenger, route, prevPhase, prevServerId, prevGateServer >= 0, prevGateDir);
                }
            }

            Compact();
            PublishServerCounts();
            Invalidate();
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

            if (firstSeg.Length <= 1 && segments.Length > 1 && route.Lifts != null && route.Lifts.Length > 0) {
                string liftId = route.Lifts[0];
                int node = firstSeg.Length > 0 ? firstSeg[firstSeg.Length - 1] : -1;
                if (liftById.TryGetValue(liftId, out LiftConnector car) && (node == car.NodeA || node == car.NodeB)) {
                    EndSegment(passenger);
                }
                return;
            }

            if (firstSeg.Length >= 2) {
                int startNode = firstSeg[0];
                int nextNode = firstSeg[1];
                if (gateByNode.TryGetValue(startNode, out GateFact startGate)) {
                    if (prevPhase == Phase.Queuing && prevServerId.StartsWith("gate:", StringComparison.Ordinal)) {
                        int dir = CrossingDir(graph.NodeZone[startNode], graph.NodeZone[nextNode]);
                        if (dir == 0) dir = prevGateDir != 0 ? prevGateDir : (startGate.Mode != 0 ? startGate.Mode : 1);
                        passenger.Phase = Phase.Queuing;
                        passenger.Server = startGate.Server;
                        passenger.ServerId = "gate:" + startGate.Id;
                        passenger.GateDir = dir;
                        passenger.Activity = StationPassengerActivity.Wait;
                        passenger.ActivityStart = simTime;
                        passenger.ActivityTotal = 12;
                        passenger.WalkWeight = 0;
                        startGate.Queue.Add(passenger.Id);
                        StandAt(passenger, startGate.Node);
                        return;
                    }
                    if (hadPassedGate) {
                        passenger.GateServer = startGate.Server;
                    }
                }
                if (prevPhase == Phase.Queuing && prevServerId.StartsWith("ride:", StringComparison.Ordinal)) {
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
            for (int i = 0; i < doc.Modules.Count; i++) {
                var m = doc.Modules[i];
                if (m.Type != "road" || m.Z != cellZ) continue;
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

        static int LandingNode(StationWalkGraph walkGraph, StationModuleFact module, int size, int z) {
            if (walkGraph == null) return -1;
            if (module.HasEndpoints) {
                int ex = z == module.FromZ ? module.FromX : module.ToX;
                int ey = z == module.FromZ ? module.FromY : module.ToY;
                if (walkGraph.TryNode(ex, ey, z, out int endpoint)) return endpoint;
            }
            for (int y = module.Y - 1; y <= module.Y + size; y++) {
                for (int x = module.X - 1; x <= module.X + size; x++) {
                    bool inside = x >= module.X && x < module.X + size && y >= module.Y && y < module.Y + size;
                    if (inside) continue;
                    if (walkGraph.TryNode(x, y, z, out int node)) return node;
                }
            }
            return -1;
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

        ServiceRoute PlanRoute(int from, int to, StationRouteNeeds needs) {
            if (from < 0 || to < 0 || planner == null) return null;
            var direct = planner.Search(from, to, needs);
            if (direct.Found) return new ServiceRoute { Segments = new[] { direct.Nodes }, Cost = direct.Cost };
            ServiceRoute best = null;
            for (int i = 0; i < lifts.Count; i++) {
                var lift = lifts[i];
                TryLiftRoute(from, to, needs, lift, lift.NodeA, lift.NodeB, ref best);
                TryLiftRoute(from, to, needs, lift, lift.NodeB, lift.NodeA, ref best);
            }
            return best;
        }

        void TryLiftRoute(int from, int to, StationRouteNeeds needs, LiftConnector lift, int board, int dest, ref ServiceRoute best) {
            if (board < 0 || dest < 0 || board == dest) return;
            var first = planner.Search(from, board, needs);
            if (!first.Found) return;
            var second = planner.Search(dest, to, needs);
            if (!second.Found) return;
            int boardStop = board == lift.NodeA ? lift.StopA : lift.StopB;
            int destStop = board == lift.NodeA ? lift.StopB : lift.StopA;
            double cost = first.Cost + LiftRideSeconds(lift, boardStop, destStop) + second.Cost;
            if (best != null && cost >= best.Cost) return;
            best = new ServiceRoute { Segments = new[] { first.Nodes, second.Nodes }, Lifts = new[] { lift.Id }, Cost = cost };
        }

        static double LiftRideSeconds(LiftConnector lift, int fromStop, int toStop) {
            if (lift.Stops.Length == 0) return 1.5;
            double fromZ = lift.Stops[Math.Max(0, Math.Min(lift.Stops.Length - 1, fromStop))];
            double toZ = lift.Stops[Math.Max(0, Math.Min(lift.Stops.Length - 1, toStop))];
            return Math.Max(1.5, Math.Abs(toZ - fromZ) / StationSimConstants.LiftSpeed) + StationSimConstants.LiftDwellSeconds;
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
            var segments = passenger.Route?.Segments;
            if (segments == null) { Kill(passenger); return; }
            if (passenger.Segment + 1 < segments.Length) {
                string liftId = passenger.Route.Lifts[passenger.Segment];
                if (!liftById.TryGetValue(liftId, out LiftConnector car)) { Stuck++; Kill(passenger); return; }
                int node = passenger.Path.Length > 0 ? passenger.Path[passenger.Path.Length - 1] : -1;
                if (node == car.NodeA) {
                    passenger.LiftBoardNode = car.NodeA; passenger.LiftDestNode = car.NodeB;
                    passenger.LiftBoardStop = car.StopA; passenger.LiftDestStop = car.StopB;
                } else if (node == car.NodeB) {
                    passenger.LiftBoardNode = car.NodeB; passenger.LiftDestNode = car.NodeA;
                    passenger.LiftBoardStop = car.StopB; passenger.LiftDestStop = car.StopA;
                } else { Stuck++; Kill(passenger); return; }
                passenger.LiftId = liftId;
                passenger.Phase = Phase.LiftQueuing;
                passenger.ServerId = "lift:" + liftId;
                passenger.Activity = StationPassengerActivity.Wait;
                passenger.ActivityStart = simTime;
                passenger.ActivityTotal = 12;
                passenger.WalkWeight = 0;
                car.Queue.Add(passenger.Id);
                StandAt(passenger, passenger.LiftBoardNode);
                return;
            }
            int endNode = passenger.Path.Length > 0 ? passenger.Path[passenger.Path.Length - 1] : -1;
            if (passenger.Boards) {
                var door = DoorForNode(endNode);
                if (door != null) {
                    passenger.Phase = Phase.Queuing;
                    passenger.Server = door.Server;
                    passenger.ServerId = "door:" + door.Id;
                    passenger.Activity = StationPassengerActivity.Queue;
                    passenger.ActivityStart = simTime;
                    passenger.ActivityTotal = 12;
                    passenger.WalkWeight = 0;
                    door.Queue.Add(passenger.Id);
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
                    if (at < 0) { gate.Lane = 0; break; }
                    int id = gate.Queue[at];
                    gate.Queue.RemoveAt(at);
                    var passenger = Find(id);
                    gate.Cooldown += 1 / Math.Max(1e-9, gate.Rate);
                    if (passenger == null) continue;
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

        void StepRides() {
            for (int i = 0; i < rides.Count; i++) {
                var ride = rides[i];
                if (ride.Rate <= 0) continue;
                ride.Cooldown -= Dt;
                while (ride.Cooldown <= 0 && ride.Queue.Count > 0) {
                    int id = ride.Queue[0];
                    ride.Queue.RemoveAt(0);
                    var passenger = Find(id);
                    ride.Cooldown += 1 / ride.Rate;
                    if (passenger == null) continue;
                    ride.Served++;
                    ride.Admitted++;
                    StartRide(passenger, ride);
                }
                if (ride.Cooldown < 0 && ride.Queue.Count == 0) ride.Cooldown = 0;
                if (ride.Cooldown < -Dt) ride.Cooldown = -Dt;
            }
        }

        void StartRide(Passenger passenger, RideFact ride) {
            passenger.Phase = Phase.Riding;
            passenger.Server = -1;
            passenger.ServerId = "ride:" + ride.Server;
            passenger.RideT = 0;
            passenger.RideTotal = Math.Max(0.2, ride.Ride);
            passenger.FromX = passenger.X;
            passenger.FromY = passenger.Y;
            passenger.FromZ = passenger.Z;
            passenger.ToX = graph.NodeX[ride.ExitNode];
            passenger.ToY = graph.NodeY[ride.ExitNode];
            passenger.ToZ = graph.NodeZ[ride.ExitNode];
            if (ride.Kind == WalkEdgeKind.Escalator) {
                passenger.WalkWeight = 0;
                passenger.Activity = IdentityUnit(passenger.Id, 0x62a3) < 0.5
                    ? StationPassengerActivity.EscalatorLeft : StationPassengerActivity.Escalator;
            } else {
                // A stair (or a moving walkway) is a capacity-limited ride that is
                // animated as walking, as the source's `rideWalking` decides.
                passenger.WalkWeight = 1;
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
                    StandAt(passenger, passenger.LiftBoardNode);
                }
            }
        }

        // ------------------------------------------------------------- the crowd

        void StepPassengers() {
            for (int i = 0; i < passengers.Count; i++) {
                var passenger = passengers[i];
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
            int guard = 0;
            while (guard++ < 64 && timeLeft > 1e-9) {
                if (passenger.Path.Length == 0 || passenger.PathIndex >= passenger.Path.Length - 1) { EndSegment(passenger); return; }
                int from = passenger.Path[passenger.PathIndex];
                int to = passenger.Path[passenger.PathIndex + 1];
                if (gateByNode.TryGetValue(to, out GateFact gate) && gate.Server != passenger.GateServer) {
                    if (!WalkToward(passenger, to, from, to, ref timeLeft, out bool gateArrived)) return;
                    if (!gateArrived) return;
                    // The crossing direction is read across the gate, not onto it: the
                    // next waypoint is the cell on the far side of the fare line.
                    int after = passenger.PathIndex + 2 < passenger.Path.Length ? passenger.Path[passenger.PathIndex + 2] : to;
                    JoinGate(passenger, gate, from, after);
                    return;
                }
                int server = EdgeServer(from, to, out WalkEdgeKind kind);
                if (server >= 0 && kind != WalkEdgeKind.Walk && rideByServer.TryGetValue(server, out RideFact ride)) {
                    JoinRide(passenger, ride);
                    return;
                }
                if (!WalkToward(passenger, to, from, to, ref timeLeft, out bool arrived)) return;
                if (!arrived) return;
                passenger.PathIndex++;
            }
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
                passenger.Activity = StationPassengerActivity.Walk;
                passenger.WalkWeight = 1;
                return timeLeft > 1e-9;
            }
            double step = budget / dist;
            passenger.X += dx * step;
            passenger.Y += dy * step;
            passenger.Z += (tz - passenger.Z) * step;
            passenger.WalkDistance += budget;
            if (speed > 0) timeLeft -= budget / speed;
            else timeLeft = 0;
            passenger.Activity = StationPassengerActivity.Walk;
            passenger.WalkWeight = 1;
            return false;
        }

        void JoinGate(Passenger passenger, GateFact gate, int from, int to) {
            passenger.Phase = Phase.Queuing;
            passenger.Server = gate.Server;
            passenger.ServerId = "gate:" + gate.Id;
            passenger.GateDir = CrossingDir(graph.NodeZone[from], graph.NodeZone[to]);
            passenger.Activity = StationPassengerActivity.Wait;
            passenger.ActivityStart = simTime;
            passenger.ActivityTotal = 12;
            passenger.WalkWeight = 0;
            gate.Queue.Add(passenger.Id);
            StandAt(passenger, gate.Node);
        }

        void JoinRide(Passenger passenger, RideFact ride) {
            passenger.Phase = Phase.Queuing;
            passenger.Server = ride.Server;
            passenger.ServerId = "ride:" + ride.Server;
            passenger.Activity = StationPassengerActivity.Wait;
            passenger.ActivityStart = simTime;
            passenger.ActivityTotal = 12;
            passenger.WalkWeight = 0;
            ride.Queue.Add(passenger.Id);
            StandAt(passenger, ride.Node);
        }

        void StepRide(Passenger passenger) {
            passenger.RideT += Dt;
            double k = passenger.RideTotal > 0 ? Math.Min(1, passenger.RideT / passenger.RideTotal) : 1;
            passenger.X = passenger.FromX + (passenger.ToX - passenger.FromX) * k;
            passenger.Y = passenger.FromY + (passenger.ToY - passenger.FromY) * k;
            passenger.Z = passenger.FromZ + (passenger.ToZ - passenger.FromZ) * k;
            double dx = passenger.ToX - passenger.FromX, dy = passenger.ToY - passenger.FromY;
            if (Math.Abs(dx) + Math.Abs(dy) > 1e-9) passenger.Heading = Math.Atan2(dy, dx);
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
            var route = PlanRoute(passenger.DoorNode, exit, StationRouteNeeds.Walking);
            if (route == null) { Stuck++; Kill(passenger); return; }
            passenger.Phase = Phase.Walking;
            BeginRoute(passenger, route);
        }

        void StepLiftRide(Passenger passenger) {
            if (passenger.LiftId == null || !liftById.TryGetValue(passenger.LiftId, out LiftConnector car)) { passenger.Phase = Phase.Walking; return; }
            if (passenger.LiftBoardNode >= 0) {
                passenger.X = graph.NodeX[passenger.LiftBoardNode] + (passenger.Id % 3 - 1) * 0.06;
                passenger.Y = graph.NodeY[passenger.LiftBoardNode] + (passenger.Id % 2) * 0.06;
            }
            passenger.Z = car.CarZ;
            passenger.WalkWeight = 0;
        }

        void StepQueue(Passenger passenger) {
            if (passenger.Phase == Phase.LiftQueuing) {
                passenger.X += (passenger.StandX - passenger.X) * Math.Min(1, Dt * 2);
                passenger.Y += (passenger.StandY - passenger.Y) * Math.Min(1, Dt * 2);
                if (passenger.LiftBoardNode >= 0)
                    passenger.Heading = Math.Atan2(graph.NodeY[passenger.LiftBoardNode] - passenger.Y, graph.NodeX[passenger.LiftBoardNode] - passenger.X);
                return;
            }
            if (passenger.Server < 0) { passenger.Phase = Phase.Walking; return; }
            double dx = passenger.StandX - passenger.X, dy = passenger.StandY - passenger.Y;
            double dist = Math.Sqrt(dx * dx + dy * dy);
            if (dist > 1e-9) passenger.Heading = Math.Atan2(dy, dx);
            double budget = passenger.Speed * Dt;
            if (dist <= budget) { passenger.WalkDistance += dist; passenger.X = passenger.StandX; passenger.Y = passenger.StandY; return; }
            double step = budget / dist;
            passenger.X += dx * step;
            passenger.Y += dy * step;
            passenger.WalkDistance += budget;
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
                Needs = StationRouteNeeds.Walking,
                RouteGraphEpoch = graphEpoch,
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

        static int CrossingDir(int fromZone, int toZone) {
            // ZONES: 0=none, 1=outside, 2=unpaid, 3=paid, 4=platform, 5=restricted.
            bool fromPaid = fromZone >= 3 && fromZone <= 5;
            bool toPaid = toZone >= 3 && toZone <= 5;
            if (!fromPaid && toPaid) return 1;
            if (fromPaid && !toPaid) return -1;
            return 0;
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
                    frame.ActivitySeconds = 0;
                    break;
                case Phase.Queuing:
                case Phase.LiftQueuing:
                    frame.State = StationPassengerState.Queuing;
                    frame.ActivitySeconds = passenger.ActivityTotal > 0 ? Clamp(elapsed, 0, passenger.ActivityTotal) : 0;
                    break;
                case Phase.Riding:
                case Phase.LiftRiding:
                    frame.State = StationPassengerState.Riding;
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
