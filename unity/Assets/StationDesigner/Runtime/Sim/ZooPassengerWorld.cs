using System.Collections.Generic;

namespace Metro.Sim {
    // One entrance, one inbound gate and the stopped train endpoint.
    public sealed class ZooPassengerWorld {
        readonly GatePathSlice.Waypoint[] path;
        readonly SimulationRng rng;
        readonly Queue<GatePathSlice> queue = new Queue<GatePathSlice>();
        readonly List<GatePathSlice> passengers = new List<GatePathSlice>();
        readonly int limit;
        readonly double entranceRate, gateRate;
        double cooldown;
        int doorTick;
        public int Tick { get; private set; }
        public int Boarded { get; private set; }
        public int Queued => queue.Count;
        public bool DoorsOpen => doorTick != 0;
        public bool Complete => Boarded == limit;
        public IReadOnlyList<GatePathSlice> Passengers => passengers;

        public ZooPassengerWorld(GatePathSlice.Waypoint[] path, uint seed, int limit,
            double entranceRate, double gateRate) {
            this.path = path;
            rng = new SimulationRng(seed);
            this.limit = limit;
            this.entranceRate = entranceRate;
            this.gateRate = gateRate;
        }

        public void Step() {
            if (Complete) return;
            Tick++;
            if (passengers.Count < limit) {
                int count = rng.PoissonHour(entranceRate, 1);
                while (count-- > 0 && passengers.Count < limit)
                    passengers.Add(new GatePathSlice(path, 2, gateRate));
            }
            cooldown--;
            while (cooldown <= 0 && queue.Count > 0) {
                queue.Dequeue().Admit();
                // An idle lane may not bank service credit: one admission starts the
                // next interval instead of carrying a negative remainder forward.
                if (cooldown < 0) cooldown = 0;
                cooldown += 1 / gateRate;
            }
            if (cooldown < 0 && queue.Count == 0) cooldown = 0;
            if (cooldown < -1) cooldown = -1;

            foreach (var passenger in passengers) {
                if (passenger.Dead) continue;
                if (passenger.PathIndex == path.Length - 1 && Tick <= doorTick + 2) continue;
                bool waiting = passenger.QueueCount != 0;
                passenger.Move();
                if (!waiting && passenger.QueueCount != 0) queue.Enqueue(passenger);
                if (!DoorsOpen && passenger.PathIndex >= path.Length - 1) doorTick = Tick;
                if (passenger.Dead) Boarded++;
            }
        }
    }
}
