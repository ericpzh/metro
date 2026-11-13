using System;

namespace Metro.Sim {
    public sealed class SimulationScheduler {
        const int MaxTicksPerFrame = 64;
        double pending;

        public int Advance(double elapsedSeconds, int speed, Func<bool> step) {
            pending += elapsedSeconds * speed;
            int available = (int)Math.Min(Math.Floor(pending), MaxTicksPerFrame);
            // Drop excess whole ticks after a stall, retaining the fractional remainder.
            pending -= Math.Floor(pending);
            int achieved = 0;
            while (achieved < available) {
                achieved++;
                if (!step()) break;
            }
            return achieved;
        }

        public void Reset() => pending = 0;
    }
}
