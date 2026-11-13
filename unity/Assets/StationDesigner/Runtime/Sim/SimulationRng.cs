using System;

namespace Metro.Sim {
    // Same unsigned 32-bit stream and Knuth sampler as game/src/sim/rng.ts.
    public sealed class SimulationRng {
        public uint State { get; set; }
        public SimulationRng(uint seed) { State = seed; }
        public double Next() {
            unchecked {
                State += 0x6d2b79f5u;
                uint t = State;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + ((t ^ (t >> 7)) * (t | 61u));
                return (t ^ (t >> 14)) / 4294967296.0;
            }
        }
        public int PoissonHour(double ratePerHour, double seconds) {
            double lambda = ratePerHour / 3600 * seconds;
            if (lambda <= 0) return 0;
            double limit = Math.Exp(-lambda), product = 1;
            int k = 0;
            do { k++; product *= Next(); } while (product > limit && k < 64);
            return k - 1;
        }
    }
}
