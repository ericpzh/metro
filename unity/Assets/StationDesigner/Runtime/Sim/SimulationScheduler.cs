using System;

namespace Metro.Sim {
    public sealed class SimulationScheduler {
        const int MaxTicksPerFrame = 64;
        double pending;

        /// <summary>
        /// The part of a tick the accumulator is holding, 0 … 1. Fixed ticks stay the
        /// only thing that advances the simulation; the presentation layer samples the
        /// two adjacent tick frames at this fraction so a 1 Hz tick renders as
        /// continuous motion (RCA 14 §5.1).
        /// </summary>
        public double Fraction => pending;

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
