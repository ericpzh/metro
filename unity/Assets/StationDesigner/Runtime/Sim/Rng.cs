using System;

namespace Metro.Sim {
    // Bit-for-bit port of rng.ts; arithmetic deliberately wraps at 32 bits.
    public sealed class Rng {
        public uint State { get; set; }
        public Rng(uint seed) { State = seed; }
        public double Next() {
            unchecked {
                State += 0x6d2b79f5u;
                uint t = State;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + ((t ^ (t >> 7)) * (t | 61u));
                return (t ^ (t >> 14)) / 4294967296.0;
            }
        }
        public int Int(int n) => (int)Math.Floor(Next() * n);
        public double Range(double a, double b) => a + Next() * (b - a);
        public static uint HashString(string value) {
            unchecked {
                uint hash = 0x811c9dc5u;
                foreach (char codeUnit in value) hash = (hash ^ codeUnit) * 0x01000193u;
                return hash;
            }
        }
    }
}
