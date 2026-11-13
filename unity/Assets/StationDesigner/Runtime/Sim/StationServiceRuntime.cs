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

        enum Phase { Walking, Queuing, Riding, LiftQueuing, LiftRiding, TrainRiding, Alighting, Dead }

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
            public double StepOutAt;
            public double StepOutFromX, StepOutFromY, StepOutFromZ;
            public int DoorNode = -1;
            public string LiftId = "";
            public int LiftBoardNode = -1, LiftDestNode = -1, LiftBoardStop = -1, LiftDestStop = -1;
        }

        sealed class GateFact {
            public string Id = "";
            public int Server = -1, Node = -1, Mode;
            public double Rate;
            public int Batch = 1, Cycle;
            public readonly List<int> Queue = new List<int>();
            public double Cooldown;
            public int Served, Lane, Admitted;
        }

        sealed class DoorFact {
            public string Id = "", PlatformId = "", LineId = "", TrackId = "";
            public int Server = -1, Node = -1;
            public readonly List<int> Queue = new List<int>();
            public double Cooldown;
            public int Served, Admitted;
        }

        sealed class RideFact {
            public int Server = -1, Node = -1, ExitNode = -1;
            public WalkEdgeKind Kind;
            public double Rate, Ride;
            public readonly List<int> Queue = new List<int>();
            public double Cooldown;
            public int Served, Admitted;
        }

        sealed class LiftConnector {
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

        sealed class TrainWatch {
            public string Key = "", LineId = "", TrackId = "";
            public TrainPhase Last = TrainPhase.None;
            public bool Seated;
            public double BerthTime;
            public int AlightInFlight;
            public int Capacity;
            public int Onboard;
            public int Boardings;
            public int Alighted;
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

        readonly List<Passenger> passengers = new List<Passenger>();
        readonly List<GateFact> gates = new List<GateFact>();
        readonly List<DoorFact> doors = new List<DoorFact>();
        readonly List<RideFact> rides = new List<RideFact>();
        readonly List<LiftConnector> lifts = new List<LiftConnector>();
        readonly List<int> exitNodes = new List<int>();
        readonly Dictionary<int, GateFact> gateByServer = new Dictionary<int, GateFact>();
        readonly Dictionary<int, GateFact> gateByNode = new Dictionary<int, GateFact>();
        readonly Dictionary<int, DoorFact> doorByServer = new Dictionary<int, DoorFact>();
        readonly Dictionary<int, RideFact> rideByServer = new Dictionary<int, RideFact>();
        readonly Dictionary<string, LiftConnector> liftById = new Dictionary<string, LiftConnector>(StringComparer.Ordinal);
        readonly Dictionary<string, TrainWatch> watches = new Dictionary<string, TrainWatch>(StringComparer.Ordinal);
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
        public int Exited { get; private set; }
        public int Stuck { get; private set; }
        public int CapHit { get; private set; }
        public int GateQueueTotal {
            get {
                int total = 0;
                for (int i = 0; i < gates.Count; i++) total += gates[i].Queue.Count;
                return total;
            }
        }
        public int QueueTotal {
            get {
                int total = GateQueueTotal;
                for (int i = 0; i < doors.Count; i++) total += doors[i].Queue.Count;
                for (int i = 0; i < rides.Count; i++) total += rides[i].Queue.Count;
                for (int i = 0; i < lifts.Count; i++) total += lifts[i].Queue.Count;
                return total;
            }
        }
        /// <summary>Document families this slice does not simulate, reported rather than faked.</summary>
        public IReadOnlyList<string> Unported => unported;

        public void Build(StationSessionDocument next, StationWalkGraph walkGraph, uint newSeed) {
            document = next ?? new StationSessionDocument();
            graph = walkGraph;
            planner = graph != null ? new StationRoutePlanner(graph) : null;
            seed = newSeed;
            rng = new SimulationRng(seed);
            Rebuild();
        }

        /// <summary>Empty the crowd and reseed the stream — the source's <c>World.restart()</c>.</summary>
        public void Restart() {
            rng = new SimulationRng(seed);
            passengers.Clear();
            nextPassengerId = 0;
            watches.Clear();
            Spawned = Onboard = Boarded = BoardingsThisTick = Alighted = Exited = Stuck = CapHit = 0;
            for (int i = 0; i < gates.Count; i++) { gates[i].Queue.Clear(); gates[i].Cooldown = 0; gates[i].Served = 0; gates[i].Lane = 0; gates[i].Admitted = 0; }
            for (int i = 0; i < doors.Count; i++) { doors[i].Queue.Clear(); doors[i].Cooldown = 0; doors[i].Served = 0; doors[i].Admitted = 0; }
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
        public int CapacityFor(string lineId, string trackId) {
            int length = 0;
            if (document != null) {
                for (int i = 0; i < document.Modules.Count; i++) {
                    var m = document.Modules[i];
                    if (m.Type == "platform-edge" && m.LineId == lineId && m.RailId == trackId) length = Math.Max(length, m.Width);
                }
                if (length == 0) {
                    for (int i = 0; i < document.Modules.Count; i++) {
                        var m = document.Modules[i];
                        if (m.Type == "track" && m.Id == trackId) length = Math.Max(length, m.Width);
                    }
                }
            }
            if (length <= 0) return RatedPerCar;
            int cars = (int)Math.Round(length / CarLengthMetres);
            if (cars < 1) cars = 1;
            if (cars > MaxCars) cars = MaxCars;
            return cars * RatedPerCar;
        }

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

        /// <summary>Alighting passengers of a (line, track) that are still in the cabin or the doorway.</summary>
        public int AlightInFlightFor(string lineId, string trackId) =>
            watches.TryGetValue((lineId ?? "") + "|" + (trackId ?? ""), out TrainWatch watch) ? watch.AlightInFlight : 0;

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

        void Rebuild() {
            gates.Clear(); gateByServer.Clear(); gateByNode.Clear();
            doors.Clear(); doorByServer.Clear();
            rides.Clear(); rideByServer.Clear();
            lifts.Clear(); liftById.Clear();
            exitNodes.Clear();
            watches.Clear();
            unported.Clear();
            unported.Add("crowd-collision");
            unported.Add("crowd-replanning");
            unported.Add("errands:shop,shelf,bench,cubicle,sink");
            unported.Add("transfers:second-line");
            unported.Add("consist-geometry");
            if (graph == null || document == null) { Invalidate(); return; }

            var modulesById = new Dictionary<string, StationModuleFact>(StringComparer.Ordinal);
            for (int i = 0; i < document.Modules.Count; i++) {
                var m = document.Modules[i];
                if (!string.IsNullOrEmpty(m.Id)) modulesById[m.Id] = m;
            }

            // Gates: one server per walkable gate cell, keyed by the gate module id.
            for (int i = 0; i < document.Modules.Count; i++) {
                var module = document.Modules[i];
                if (module.Type != "gate" || !module.GateHasLane) continue;
                if (!graph.TryNode(module.X, module.Y, module.Z, out int node)) continue;
                StationServerFact server = null;
                for (int s = 0; s < graph.Servers.Count; s++) {
                    var candidate = graph.Servers[s];
                    if (candidate.Kind == "gate" && candidate.Node == node) { server = candidate; break; }
                }
                if (server == null) continue;
                var gate = new GateFact {
                    Id = module.Id ?? "", Server = server.Id, Node = node, Mode = module.GateDir,
                    Rate = server.Rate > 0 ? server.Rate : StationWalkGraphBuilder.GateRate,
                    Batch = Math.Max(1, server.Batch), Cycle = server.Cycle,
                };
                gates.Add(gate);
                gateByServer[gate.Server] = gate;
                gateByNode[gate.Node] = gate;
            }

            // Platform door servers, keyed by their platform edge and bound track.
            for (int p = 0; p < graph.Platforms.Count; p++) {
                var platform = graph.Platforms[p];
                modulesById.TryGetValue(platform.Id ?? "", out StationModuleFact edge);
                for (int d = 0; d < platform.Doors.Length; d++) {
                    int id = platform.Doors[d];
                    if (id < 0 || id >= graph.Servers.Count) continue;
                    var server = graph.Servers[id];
                    var door = new DoorFact {
                        Id = platform.Id ?? "", PlatformId = platform.Id ?? "", LineId = platform.Line ?? "",
                        TrackId = edge.RailId ?? "", Server = id, Node = server.Node,
                    };
                    doors.Add(door);
                    doorByServer[id] = door;
                }
            }

            // Vertical rides: the document's capacity-limited edges.
            for (int s = 0; s < graph.Servers.Count; s++) {
                var server = graph.Servers[s];
                if (server.ExitNode < 0 || server.Ride <= 0) continue;
                WalkEdgeKind kind;
                switch (server.Kind) {
                    case "escalator": kind = WalkEdgeKind.Escalator; break;
                    case "walkway": kind = WalkEdgeKind.Walkway; break;
                    case "stair": kind = WalkEdgeKind.Stair; break;
                    default: continue;
                }
                var ride = new RideFact { Server = s, Node = server.Node, ExitNode = server.ExitNode, Kind = kind, Rate = server.Rate, Ride = server.Ride };
                rides.Add(ride);
                rideByServer[s] = ride;
            }

            // Lift connectors: the landing rows on each side of a shaft. The walk
            // graph does not carry lift edges (it reports them unported), so the
            // service layer composes a route through a lift itself.
            for (int i = 0; i < document.Modules.Count; i++) {
                var module = document.Modules[i];
                if (module.Type != "lift" || !module.HasEndpoints) continue;
                int size = module.Width >= 3 ? 3 : 2;
                var stops = StationLiftStops.Levels(module);
                int loZ = Math.Min(module.FromZ, module.ToZ), hiZ = Math.Max(module.FromZ, module.ToZ);
                if (hiZ - loZ < 1) continue;
                int a = LandingNode(module, size, loZ);
                int b = LandingNode(module, size, hiZ);
                if (a < 0 || b < 0) { unported.Add("lift-landing:" + module.Id); continue; }
                int stopA = stops.IndexOf(loZ), stopB = stops.IndexOf(hiZ);
                if (stopA < 0 || stopB < 0) { unported.Add("lift-stop:" + module.Id); continue; }
                var connector = new LiftConnector {
                    Id = module.Id ?? "", NodeA = a, NodeB = b, StopA = stopA, StopB = stopB,
                    Stops = stops.ToArray(), CarZ = stops[stopA], CarStop = stopA,
                };
                lifts.Add(connector);
                liftById[connector.Id] = connector;
            }

            // Exits in document order: the source's street-spawn entrances.
            for (int i = 0; i < graph.Exits.Count; i++) {
                if (graph.Exits[i].Node >= 0) exitNodes.Add(graph.Exits[i].Node);
            }

            passengers.Clear();
            nextPassengerId = 0;
            Spawned = Onboard = Boarded = BoardingsThisTick = Alighted = Exited = Stuck = CapHit = 0;
            Invalidate();
            PublishServerCounts();
        }

        int LandingNode(StationModuleFact module, int size, int z) {
            if (module.HasEndpoints) {
                int ex = z == module.FromZ ? module.FromX : module.ToX;
                int ey = z == module.FromZ ? module.FromY : module.ToY;
                if (graph.TryNode(ex, ey, z, out int endpoint)) return endpoint;
            }
            for (int y = module.Y - 1; y <= module.Y + size; y++) {
                for (int x = module.X - 1; x <= module.X + size; x++) {
                    bool inside = x >= module.X && x < module.X + size && y >= module.Y && y < module.Y + size;
                    if (inside) continue;
                    if (graph.TryNode(x, y, z, out int node)) return node;
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
            int destinationExit = board ? -1 : PickExit();
            bool stepFree = rng.Next() < StepFreeChance;
            bool luggage = rng.Next() < LuggageChance;
            double jx = (rng.Next() - 0.5) * 0.6;
            double jy = (rng.Next() - 0.5) * 0.6;
            var needs = new StationRouteNeeds { StepFree = stepFree, Luggage = luggage };
            var passenger = new Passenger {
                X = graph.NodeX[entrance] + jx, Y = graph.NodeY[entrance] + jy, Z = graph.NodeZ[entrance],
                Boards = board,
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

        int PickExit() {
            if (exitNodes.Count == 0) return -1;
            int at = (int)Math.Floor(rng.Next() * exitNodes.Count);
            if (at < 0) at = 0;
            if (at >= exitNodes.Count) at = exitNodes.Count - 1;
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

        void StepDoors(StationTrainFrame[] trains) {
            for (int i = 0; i < doors.Count; i++) {
                var door = doors[i];
                var train = TrainFor(trains, door.LineId, door.TrackId);
                var watch = Watch(door.LineId, door.TrackId);
                // Doors admit only when the leaves are actually wide open and the
                // consist's own alighting wave has left the cabin (alight before
                // board, the source's doorway hand-over rule).
                bool open = train.HasValue && train.Value.Phase == TrainPhase.Dwell &&
                    train.Value.DoorFraction >= 1 - 1e-9 && watch.AlightInFlight == 0;
                if (!open) { door.Cooldown = 0; continue; }
                door.Cooldown -= Dt;
                while (door.Cooldown <= 0 && door.Queue.Count > 0 && watch.Onboard < watch.Capacity) {
                    int id = door.Queue[0];
                    door.Queue.RemoveAt(0);
                    var passenger = Find(id);
                    door.Cooldown += 1 / DoorRate;
                    if (passenger == null) continue;
                    door.Served++;
                    door.Admitted++;
                    watch.Onboard++;
                    watch.Boardings++;
                    Boarded++;
                    BoardingsThisTick++;
                    Onboard++;
                    passenger.Phase = Phase.TrainRiding;
                    passenger.TrainKey = watch.Key;
                    passenger.Server = -1;
                    passenger.ServerId = "line:" + door.LineId + "|" + door.TrackId;
                    passenger.Activity = StationPassengerActivity.Wait;
                    passenger.ActivityStart = simTime;
                    passenger.ActivityTotal = 12;
                    passenger.WalkWeight = 0;
                    passenger.X = graph.NodeX[door.Node];
                    passenger.Y = graph.NodeY[door.Node];
                    passenger.Z = graph.NodeZ[door.Node];
                }
                if (door.Cooldown < 0 && door.Queue.Count == 0) door.Cooldown = 0;
                if (door.Cooldown < -Dt) door.Cooldown = -Dt;
            }
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
                }
            }
        }

        void StepWalk(Passenger passenger) {
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

        void StepConsists(StationTrainFrame[] trains) {
            if (trains == null) return;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < trains.Length; i++) {
                var frame = trains[i];
                string key = (frame.LineId ?? "") + "|" + (frame.TrackId ?? "");
                seen.Add(key);
                var watch = Watch(frame.LineId, frame.TrackId);
                if (frame.Phase == TrainPhase.Berth && watch.Last != TrainPhase.Berth) {
                    watch.Seated = true;
                    watch.BerthTime = simTime;
                    watch.AlightInFlight = 0;
                    SeatAlightingWave(watch, frame);
                }
                if ((frame.Phase == TrainPhase.Opening || frame.Phase == TrainPhase.Dwell) && watch.Seated) StepAlighters(watch);
                if (frame.Phase == TrainPhase.Hold && watch.Last != TrainPhase.Hold) ClearBoarders(watch);
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
            return watch;
        }

        static StationTrainFrame? TrainFor(StationTrainFrame[] trains, string lineId, string trackId) {
            if (trains == null) return null;
            for (int i = 0; i < trains.Length; i++)
                if (trains[i].LineId == lineId && trains[i].TrackId == trackId) return trains[i];
            return null;
        }

        void SeatAlightingWave(TrainWatch watch, StationTrainFrame frame) {
            int wave = Math.Max(0, options.AlightPerTrain);
            if (wave == 0) return;
            var doorList = new List<DoorFact>();
            for (int i = 0; i < doors.Count; i++)
                if (doors[i].LineId == frame.LineId && doors[i].TrackId == frame.TrackId) doorList.Add(doors[i]);
            if (doorList.Count == 0) return;
            for (int i = 0; i < wave; i++) {
                if (passengers.Count >= options.MaxPassengers) { CapHit++; break; }
                var door = doorList[i % doorList.Count];
                int row = i / doorList.Count;
                double offsetX = (row % 3 - 1) * 0.24;
                double offsetY = ((row / 3) % 3 - 1) * 0.24;
                var passenger = new Passenger();
                passenger.Id = ++nextPassengerId;
                passenger.IdentityFactor = 0.9 + IdentityUnit(passenger.Id, 0x85a308d3u) * 0.2;
                passenger.Speed = WalkSpeed * passenger.IdentityFactor;
                passenger.WalkPhase = IdentityUnit(passenger.Id, 0x9e3779b9u);
                passenger.DoorNode = door.Node;
                passenger.TrainKey = watch.Key;
                passenger.Phase = Phase.Alighting;
                passenger.Boards = false;
                passenger.Activity = StationPassengerActivity.Walk;
                passenger.StepOutAt = simTime + 0.5 + row * 0.55;
                passenger.StepOutFromX = graph.NodeX[door.Node] + offsetX;
                passenger.StepOutFromY = graph.NodeY[door.Node] + offsetY;
                passenger.StepOutFromZ = graph.NodeZ[door.Node] + 0.12;
                passenger.X = passenger.StepOutFromX;
                passenger.Y = passenger.StepOutFromY;
                passenger.Z = passenger.StepOutFromZ;
                passenger.Heading = Math.Atan2(-offsetY, -offsetX);
                passenger.ServerId = "line:" + frame.LineId + "|" + frame.TrackId;
                passengers.Add(passenger);
                Spawned++;
                watch.AlightInFlight++;
            }
        }

        void StepAlighters(TrainWatch watch) {
            for (int i = 0; i < passengers.Count; i++) {
                var passenger = passengers[i];
                if (passenger.Phase != Phase.Alighting) continue;
                if (!string.Equals(passenger.TrainKey, watch.Key, StringComparison.Ordinal)) continue;
                if (simTime < passenger.StepOutAt) continue;
                int doorNode = passenger.DoorNode;
                passenger.X = graph.NodeX[doorNode];
                passenger.Y = graph.NodeY[doorNode];
                passenger.Z = graph.NodeZ[doorNode];
                passenger.TrainKey = "";
                passenger.ServerId = "";
                passenger.Phase = Phase.Walking;
                if (watch.AlightInFlight > 0) watch.AlightInFlight--;
                Alighted++;
                watch.Alighted++;
                var route = PlanRoute(doorNode, PickExit(), StationRouteNeeds.Walking);
                if (route == null) { Stuck++; Kill(passenger); continue; }
                BeginRoute(passenger, route);
            }
        }

        void ClearBoarders(TrainWatch watch) {
            // The consist departs sealed: whoever is aboard rides out of this
            // station (the source kills every rider with its train).
            for (int i = passengers.Count - 1; i >= 0; i--) {
                var passenger = passengers[i];
                if (passenger.Phase != Phase.TrainRiding || !string.Equals(passenger.TrainKey, watch.Key, StringComparison.Ordinal)) continue;
                Onboard--;
                passengers.RemoveAt(i);
            }
            watch.Onboard = 0;
            watch.AlightInFlight = 0;
            watch.Seated = false;
        }

        // ---------------------------------------------------------------- helpers

        static int CrossingDir(int fromZone, int toZone) {
            // The projection's zone indices: 2 = paid, 1 = unpaid/outside, 0 = unzoned.
            bool fromPaid = fromZone == 2, toPaid = toZone == 2;
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
