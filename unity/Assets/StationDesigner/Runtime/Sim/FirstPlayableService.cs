using System;

namespace Metro.Sim {
    /// <summary>Bounded route through the committed gate, advanced by a logical clock.</summary>
    public sealed class FirstPlayableService {
        public enum Stage { Entrance, WalkingToGate, Queuing, ThroughGate, Platform, Boarded }
        readonly GatePathSlice passenger;
        public Stage CurrentStage { get; private set; } = Stage.Entrance;
        public int BoardedCount { get; private set; }
        public double X => passenger.X;
        public double Y => passenger.Y;
        public bool Finished => BoardedCount == 1;
        public FirstPlayableService(int gateX = 2, int lane = 0) {
            if (!((gateX == 2 && lane == 0) || (gateX == 3 && lane == 1))) throw new ArgumentException("Unsupported route");
            double y = lane + .5;
            passenger = new GatePathSlice(new[] {
                Point(.5, .5, 0), Point(gateX - .5, y, 0),
                Point(gateX + .5, y, 0, true), Point(gateX + 1.5, y, 3),
                Point(4.5, .5, 3), Point(5.5, 2.5, 3)
            }, .5, 1);
        }
        static GatePathSlice.Waypoint Point(double x, double y, int zone, bool gate = false) =>
            new GatePathSlice.Waypoint { x = x, y = y, z = 0, zone = zone, gate = gate };
        public void Step() {
            if (Finished) return;
            passenger.Step();
            if (passenger.Dead) { BoardedCount = 1; CurrentStage = Stage.Boarded; }
            else if (passenger.State == 2) CurrentStage = Stage.Queuing;
            else if (passenger.PathIndex >= 5) CurrentStage = Stage.Platform;
            else if (passenger.WaitCount > 0) CurrentStage = Stage.ThroughGate;
            else CurrentStage = Stage.WalkingToGate;
        }
    }
}
