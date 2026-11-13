using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Metro.Sim {
    /// <summary>Signal phase from <c>sim/roadNetwork.ts</c>; values match the build enum.</summary>
    public enum RoadTrafficSignalPhase { Red = 0, Amber = 1, Green = 2 }

    public enum RoadVehicleKind { Car, Bus, Scooter }

    public sealed class RoadTrafficTail {
        public int Junction;
        public double Remaining;
    }

    /// <summary>Plain derived lane network: no document records, no engine types.</summary>
    public sealed class RoadTrafficEdge {
        public string RoadId = "";
        public double RoadZ;
        public int Lane;
        public int Sign;
        public bool Axis;
        public double StartX, StartY, EndX, EndY;
        public double Length;
        public int[] Next = Array.Empty<int>();
        public int Junction = -1;
        public bool HasControl;
        public double ControlX, ControlY;
    }

    public sealed class RoadTrafficJunction {
        public string Id = "";
        public bool Uncontrolled;
        public double X0, Y0, X1, Y1, Z;
    }

    public sealed class RoadTrafficNetwork {
        public readonly List<RoadTrafficEdge> Edges = new List<RoadTrafficEdge>();
        public readonly List<RoadTrafficJunction> Junctions = new List<RoadTrafficJunction>();
        public readonly List<int> Entries = new List<int>();
    }

    /// <summary>
    /// FNV-1a plus the source's avalanche. Used for traffic choices, appearance
    /// and signal offsets; it must match the JS <c>Math.imul</c> arithmetic bit for
    /// bit (see the oracle hash rows).
    /// </summary>
    public static class RoadTrafficSignals {
        public const double GreenSeconds = 12;
        public const double AmberSeconds = 3;
        public const double ClearSeconds = 5;
        public const double HalfCycle = GreenSeconds + AmberSeconds + ClearSeconds;

        public static uint Hash(string text) {
            unchecked {
                uint h = 2166136261;
                if (text != null)
                    for (int i = 0; i < text.Length; i++) h = (h ^ text[i]) * 16777619u;
                h = (h ^ (h >> 16)) * 0x85ebca6bu;
                h = (h ^ (h >> 13)) * 0xc2b2ae35u;
                return h ^ (h >> 16);
            }
        }

        public static RoadTrafficSignalPhase Phase(bool uncontrolled, string junctionId, bool axis, double time) {
            if (uncontrolled) return RoadTrafficSignalPhase.Green;
            double cycle = HalfCycle * 2;
            double phase = Mod((time + (double)(Hash(junctionId) % (uint)HalfCycle)) % cycle + cycle, cycle);
            double local = phase - (axis ? 0 : HalfCycle);
            if (local >= 0 && local < GreenSeconds) return RoadTrafficSignalPhase.Green;
            if (local >= GreenSeconds && local < GreenSeconds + AmberSeconds) return RoadTrafficSignalPhase.Amber;
            return RoadTrafficSignalPhase.Red;
        }

        static double Mod(double a, double b) => a - b * Math.Floor(a / b);

        public static string Number(double value) => value.ToString("R", CultureInfo.InvariantCulture);
        public static string Number(int value) => value.ToString(CultureInfo.InvariantCulture);
    }

    public sealed class RoadTrafficCar {
        public int Id;
        public int Edge;
        public double Distance;
        public int PreviousEdge;
        public double PreviousDistance;
        public RoadVehicleKind Kind;
        public double Size;
        public int Held = -1;
        public readonly List<RoadTrafficTail> Tails = new List<RoadTrafficTail>();

        public override string ToString() => $"{Id} edge{Edge} d{Distance:R}";
    }

    /// <summary>One interpolated vehicle pose in document axes (x plan, y plan, z elevation).</summary>
    public struct RoadVehiclePose {
        public int Id;
        public int Edge;
        public int PreviousEdge;
        public RoadVehicleKind Kind;
        public string Variant;
        public double X, Y, Z;
        /// <summary>Document-plane heading: atan2(-dx, dy), as the source model faces +Y.</summary>
        public double Heading;
    }

    /// <summary>
    /// Port of <c>game/src/sim/roadTraffic.ts</c>. Deterministic across ticks and
    /// seeks; the only clock input is the station sim time. <c>elapsedSeconds</c>
    /// is the caller's own monotonic tick used to observe pause/resume; it never
    /// changes choices or phases (those read <c>simTimeSeconds</c>).
    /// </summary>
    public sealed class StationRoadTraffic {
        public const double Step = .1;
        public const double MaxCatchup = 60;
        public const double Spacing = 20;
        public const double Density = .5;
        public const double Speed = 6;
        public const int Capacity = 192;
        public const double FollowGap = 2;
        public const double CrosswalkDepth = 2;

        readonly List<RoadTrafficCar> cars = new List<RoadTrafficCar>();
        readonly Dictionary<int, int> locks = new Dictionary<int, int>();
        readonly List<RoadTrafficCar>[] buckets;
        int serial;
        long tick;

        public StationRoadTraffic(RoadTrafficNetwork network, int seed) {
            Network = network ?? throw new ArgumentNullException(nameof(network));
            Seed = seed;
            buckets = new List<RoadTrafficCar>[network.Edges.Count];
            for (int i = 0; i < buckets.Length; i++) buckets[i] = new List<RoadTrafficCar>();
            Time = double.NaN;
        }

        public RoadTrafficNetwork Network { get; }
        public int Seed { get; }
        /// <summary>Stepped simulation time; NaN before the first advance (source contract).</summary>
        public double Time { get; private set; }
        /// <summary>The caller's elapsed clock from the last advance; diagnostic only.</summary>
        public double ElapsedSeconds { get; private set; }
        /// <summary>Deterministic step index, equals <c>Math.floor(Time/Step)</c>.</summary>
        public long Tick => tick;
        public IReadOnlyList<RoadTrafficCar> Cars => cars;

        RoadTrafficCar MakeCar(int edge, double distance) {
            int id = serial++;
            uint roll = RoadTrafficSignals.Hash(SeedString + ":kind:" + id) % 10;
            var kind = roll == 0 ? RoadVehicleKind.Bus : roll <= 6 ? RoadVehicleKind.Scooter : RoadVehicleKind.Car;
            return new RoadTrafficCar {
                Id = id, Edge = edge, Distance = distance, PreviousEdge = edge, PreviousDistance = distance,
                Kind = kind, Size = kind == RoadVehicleKind.Bus ? 10 : kind == RoadVehicleKind.Car ? 4.2 : 1.9,
                Held = -1,
            };
        }

        string SeedString => Seed.ToString(CultureInfo.InvariantCulture);

        /// <summary>Source <c>RoadTraffic.advance</c>; the elapsed clock only records the host tick.</summary>
        public void Advance(double elapsedSeconds, double simTimeSeconds) {
            ElapsedSeconds = elapsedSeconds;
            Advance(simTimeSeconds);
        }

        public void Advance(double simTimeSeconds) {
            if (!IsFinite(Time) || simTimeSeconds < Time - Step || simTimeSeconds - Time > MaxCatchup)
                Reset(simTimeSeconds);
            long target = (long)Math.Floor((simTimeSeconds + 1e-7) / Step);
            while (tick < target) {
                StepOnce();
                tick++;
                Time = tick * Step;
            }
        }

        /// <summary>Packet C's clock is the authoritative time source when it is installed.</summary>
        public void Advance(StationClock clock) {
            if (clock == null) throw new ArgumentNullException(nameof(clock));
            Advance(clock.SimTime);
        }

        static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);

        void Reset(double time) {
            cars.Clear();
            locks.Clear();
            serial = 0;
            tick = (long)Math.Floor(time / Step);
            Time = tick * Step;
            for (int i = 0; i < Network.Edges.Count && cars.Count < Capacity; i++) {
                var e = Network.Edges[i];
                if (e.Junction >= 0) continue;
                // Stagger cars across the lanes of one road so multi-lane traffic does
                // not line up in lockstep.
                double laneOffset = e.Lane * 2;
                for (double d = Spacing / 2 + laneOffset; d < e.Length - 5 && cars.Count < Capacity; d += Spacing) {
                    var c = MakeCar(i, d);
                    if (RoadTrafficSignals.Hash(SeedString + ":spawn:" + c.Id) % 100 < Density * 100) cars.Add(c);
                }
            }
        }

        void StepOnce() {
            foreach (var bucket in buckets) bucket.Clear();
            foreach (var c in cars) {
                c.PreviousEdge = c.Edge;
                c.PreviousDistance = c.Distance;
                buckets[c.Edge].Add(c);
            }
            foreach (var bucket in buckets) {
                if (bucket.Count <= 1) continue;
                var sorted = bucket.OrderByDescending(c => c.Distance).ToList();
                bucket.Clear();
                bucket.AddRange(sorted);
            }
            var dead = new HashSet<RoadTrafficCar>();
            var processed = new HashSet<int>();
            foreach (var bucket in buckets) {
                RoadTrafficCar leader = null;
                // Cars arriving during this bucket's turn are appended; visit the same
                // original range without copying the lane queue.
                for (int i = 0, count = bucket.Count; i < count; i++) {
                    var c = bucket[i];
                    if (processed.Contains(c.Id)) continue;
                    processed.Add(c.Id);
                    var e = Network.Edges[c.Edge];
                    double old = c.Distance;
                    double limit = e.Length - c.Size / 2;
                    int choice = e.Next.Length > 0
                        ? e.Next[(int)(RoadTrafficSignals.Hash(SeedString + ":" + c.Id + ":" + c.Edge) % (uint)e.Next.Length)]
                        : -1;
                    var next = choice >= 0 ? Network.Edges[choice] : null;
                    bool canLeave = next == null;
                    if (next != null) {
                        RoadTrafficCar tail = null;
                        foreach (var car in buckets[choice]) {
                            if (car.Edge != choice || dead.Contains(car)) continue;
                            if (tail == null || car.Distance < tail.Distance) tail = car;
                        }
                        bool room = tail == null || tail.Distance - tail.Size / 2 > c.Size / 2 + FollowGap;
                        int j = next.Junction;
                        if (j >= 0) limit -= CrosswalkDepth + 1.5;
                        var junction = j >= 0 ? Network.Junctions[j] : null;
                        bool signal = j < 0 || c.Held == j ||
                            RoadTrafficSignals.Phase(junction.Uncontrolled, junction.Id, e.Axis, Time) == RoadTrafficSignalPhase.Green;
                        bool reserved = j < 0 || !locks.ContainsKey(j) || locks[j] == c.Id;
                        canLeave = room && signal && reserved;
                        if (canLeave) limit = e.Length;
                    } else {
                        limit = e.Length + c.Size / 2;
                    }
                    if (leader != null)
                        limit = Math.Min(limit, leader.Distance - (leader.Size + c.Size) / 2 - FollowGap);
                    c.Distance = Math.Max(old, Math.Min(old + Speed * Step, limit));
                    if (next != null && next.Junction >= 0 && canLeave &&
                        c.Distance > e.Length - c.Size / 2 - CrosswalkDepth - 1.5) {
                        locks[next.Junction] = c.Id;
                        c.Held = next.Junction;
                    }
                    double moved = c.Distance - old;
                    for (int t = c.Tails.Count - 1; t >= 0; t--) {
                        var tail = c.Tails[t];
                        tail.Remaining -= moved;
                        if (tail.Remaining <= 0 && locks.TryGetValue(tail.Junction, out var holder) && holder == c.Id)
                            locks.Remove(tail.Junction);
                    }
                    if (c.Tails.Count > 0) c.Tails.RemoveAll(t => t.Remaining <= 0);
                    if (c.Distance >= e.Length && canLeave) {
                        if (next == null) {
                            dead.Add(c);
                            if (c.Held >= 0) locks.Remove(c.Held);
                            foreach (var tail in c.Tails) locks.Remove(tail.Junction);
                        } else {
                            c.Distance -= e.Length;
                            c.Edge = choice;
                            if (e.Junction >= 0 && next.Junction < 0) {
                                c.Tails.Add(new RoadTrafficTail { Junction = e.Junction, Remaining = c.Size / 2 + FollowGap });
                                c.Held = -1;
                            }
                            if (next.Junction >= 0) {
                                locks[next.Junction] = c.Id;
                                c.Held = next.Junction;
                            }
                            buckets[choice].Add(c);
                        }
                    } else {
                        leader = c;
                    }
                }
            }
            if (dead.Count > 0) cars.RemoveAll(dead.Contains);
            // Spawns occur at network boundaries only; interior road seams never
            // emit cars.
            long period = (long)Math.Round(Spacing / (Speed * Step) / Density);
            int entryCount = Math.Max(1, Network.Entries.Count);
            long stagger = Math.Max(1, period / entryCount);
            for (int ei = 0; ei < Network.Entries.Count; ei++) {
                int entry = Network.Entries[ei];
                if (tick % period != ei * stagger % period) continue;
                if (cars.Count >= Capacity) break;
                var e = Network.Edges[entry];
                var c = MakeCar(entry, 5);
                if (e.Length < c.Size) continue;
                bool blocked = cars.Any(a => a.Edge == entry && a.Distance < (a.Size + c.Size) / 2 + FollowGap + 5);
                if (blocked) continue;
                cars.Add(c);
            }
        }

        /// <summary>Package appearance; stable across frames and seeks, never consumes traffic RNG.</summary>
        public string VariantOf(RoadTrafficCar car) {
            bool alternate = RoadTrafficSignals.Hash(SeedString + ":vehicle:" + car.Id) % 2 == 1;
            switch (car.Kind) {
                case RoadVehicleKind.Car: return alternate ? "sedan" : "suv";
                case RoadVehicleKind.Bus: return alternate ? "bus-mosaic" : "bus-orange";
                default: return alternate ? "bicycle" : "moped";
            }
        }

        /// <summary>
        /// Interpolated poses at <paramref name="simTimeSeconds"/>, exactly the
        /// renderer's previous/current blend. The source clamps the blend to one
        /// step and wraps a vehicle across its edge when it has just changed edges.
        /// </summary>
        public void Sample(double simTimeSeconds, List<RoadVehiclePose> output) {
            if (output == null) throw new ArgumentNullException(nameof(output));
            output.Clear();
            double fraction = Math.Min(1, Math.Max(0, (simTimeSeconds - Time) / Step));
            foreach (var c in cars) {
                var previous = Network.Edges[c.PreviousEdge];
                int edge = c.Edge;
                double distance = c.Distance;
                if (c.PreviousEdge == c.Edge) {
                    distance = c.PreviousDistance + (c.Distance - c.PreviousDistance) * fraction;
                } else {
                    double travelled = (previous.Length - c.PreviousDistance + c.Distance) * fraction;
                    if (c.PreviousDistance + travelled < previous.Length) {
                        edge = c.PreviousEdge;
                        distance = c.PreviousDistance + travelled;
                    } else {
                        distance = c.PreviousDistance + travelled - previous.Length;
                    }
                }
                var e = Network.Edges[edge];
                double t = Math.Max(0, Math.Min(1, distance / e.Length));
                var p = EdgePoint(e, t);
                double dx = e.HasControl
                    ? 2 * ((1 - t) * (e.ControlX - e.StartX) + t * (e.EndX - e.ControlX))
                    : e.EndX - e.StartX;
                double dy = e.HasControl
                    ? 2 * ((1 - t) * (e.ControlY - e.StartY) + t * (e.EndY - e.ControlY))
                    : e.EndY - e.StartY;
                output.Add(new RoadVehiclePose {
                    Id = c.Id, Edge = edge, PreviousEdge = c.PreviousEdge, Kind = c.Kind,
                    Variant = VariantOf(c), X = p.X, Y = p.Y, Z = e.RoadZ + 1.05,
                    Heading = Math.Atan2(-dx, dy),
                });
            }
        }

        /// <summary>Source <c>roadEdgePoint</c> over the traffic edge shape.</summary>
        public static (double X, double Y) EdgePoint(RoadTrafficEdge e, double t) {
            double u = 1 - t;
            if (e.HasControl)
                return (u * u * e.StartX + 2 * u * t * e.ControlX + t * t * e.EndX,
                    u * u * e.StartY + 2 * u * t * e.ControlY + t * t * e.EndY);
            return (e.StartX + (e.EndX - e.StartX) * t, e.StartY + (e.EndY - e.StartY) * t);
        }
    }
}
