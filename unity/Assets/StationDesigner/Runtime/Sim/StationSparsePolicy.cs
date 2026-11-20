using System;
using System.Collections.Generic;

namespace Metro.Sim {
    public enum StationRoutingMode {
        Sparse = 0,
        Legacy = 1,
    }

    /// <summary>
    /// Shared deterministic routing policy, stable tile keys, integer-millisecond scoring,
    /// standing occupancy and soft tile claims (design/crowd-routing-plan.md §4).
    /// Bit-for-bit mirror of <c>game/src/sim/sparsePolicy.ts</c>.
    /// </summary>
    public static class StationSparsePolicy {
        public const int SectorSize = 16;
        public const int WalkHorizon = 16;
        public const int RefillThreshold = 4;
        public const int ClaimSteps = 2;
        public const int ClaimTtlTicks = 4;
        public const int DensityDirectMs = 500;
        public const int DensityAdjacentMs = 250;
        public const int DensityCapMs = 2500;
        public const int ClaimPenaltyMs = 650;
        public const int ClaimCapMs = 1300;
        public const int TurnPenaltyMs = 50;
        public const int JitterModMs = 100;
        public const int SwitchMarginMs = 2000;
        public const int FieldCacheMaxBytes = 16 * 1024 * 1024;
        public const int SampleRefreshSimSeconds = 60;
        public const int MandatoryPopBudget = 12000;
        public const int MandatoryScanBudget = 48000;
        public const int LocalRefillBudget = 384;
        public const int OptionalPopBudget = 2000;
        public const int OptionalScanBudget = 8000;
        public const int FineRecoveryPopBudget = 4000;
        public const int AgePromoteTicks = 4;
        public const int InfMs = 0x3fffffff;

        const long XyBias = 32768L;
        const long XySpan = 65536L;
        const long Z2Bias = 1024L;
        const long SectorBias = 2048L;
        const long SectorSpan = 4096L;

        /// <summary>Round nonnegative seconds to integer milliseconds, half up.</summary>
        public static int ToMs(double seconds) {
            if (double.IsNaN(seconds) || double.IsInfinity(seconds)) return InfMs;
            if (seconds <= 0) return 0;
            double ms = Math.Floor(seconds * 1000.0 + 0.5);
            return ms >= InfMs ? InfMs : (int)ms;
        }

        /// <summary>Mathematical floor division so negative coordinates land in the right 16x16 sector.</summary>
        public static int FloorDiv(int value, int divisor) {
            int q = value / divisor;
            int r = value - q * divisor;
            return r < 0 ? q - 1 : q;
        }

        /// <summary>Lossless, order-preserving 43-bit stable tile key: (tz2, tx, ty) lexicographical order.</summary>
        public static long PackTileKey(int tx, int ty, int tz2) {
            return ((tz2 + Z2Bias) * XySpan + (tx + XyBias)) * XySpan + (ty + XyBias);
        }

        public static void UnpackTileKey(long key, out int tx, out int ty, out int tz2) {
            long tyShifted = key % XySpan;
            long rem = key / XySpan;
            long txShifted = rem % XySpan;
            long tz2Shifted = rem / XySpan;
            tx = (int)(txShifted - XyBias);
            ty = (int)(tyShifted - XyBias);
            tz2 = (int)(tz2Shifted - Z2Bias);
        }

        public static long PackSectorKey(int sx, int sy, int tz2) {
            return ((tz2 + Z2Bias) * SectorSpan + (sx + SectorBias)) * SectorSpan + (sy + SectorBias);
        }

        public static void UnpackSectorKey(long key, out int sx, out int sy, out int tz2) {
            long syShifted = key % SectorSpan;
            long rem = key / SectorSpan;
            long sxShifted = rem % SectorSpan;
            long tz2Shifted = rem / SectorSpan;
            sx = (int)(sxShifted - SectorBias);
            sy = (int)(syShifted - SectorBias);
            tz2 = (int)(tz2Shifted - Z2Bias);
        }

        public static long SectorKeyOfTile(int tx, int ty, int tz2) {
            return PackSectorKey(FloorDiv(tx, SectorSize), FloorDiv(ty, SectorSize), tz2);
        }

        /// <summary>Exact 32-bit unsigned mix shared with TypeScript (Murmur3 finalizer).</summary>
        public static uint Hash32Init(int seed) => unchecked((uint)seed ^ 0x9e3779b9u);

        public static uint Hash32Mix(uint h, int v) {
            unchecked {
                uint x = h ^ (uint)v;
                x *= 0x85ebca6bu;
                x ^= x >> 13;
                x *= 0xc2b2ae35u;
                x ^= x >> 16;
                return x;
            }
        }

        public static uint Hash32Tile(int seed, int tx, int ty, int tz2) {
            uint h = Hash32Init(seed);
            h = Hash32Mix(h, tx);
            h = Hash32Mix(h, ty);
            h = Hash32Mix(h, tz2);
            return h;
        }

        public static int Hash32Jitter(int seed, int agentId, int segmentSequence, int tx, int ty, int tz2) {
            uint h = Hash32Init(seed);
            h = Hash32Mix(h, agentId);
            h = Hash32Mix(h, segmentSequence);
            h = Hash32Mix(h, tx);
            h = Hash32Mix(h, ty);
            h = Hash32Mix(h, tz2);
            return (int)(h % JitterModMs);
        }

        public static int OctantOf(int dx, int dy) {
            int sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
            int sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
            if (sx == 0 && sy == 0) return -1;
            if (sx > 0) return sy > 0 ? 1 : sy < 0 ? 7 : 0;
            if (sx < 0) return sy > 0 ? 3 : sy < 0 ? 5 : 4;
            return sy > 0 ? 2 : 6;
        }

        public static int ShortestOctantDifference(int a, int b) {
            if (a < 0 || b < 0) return 0;
            int d = Math.Abs(a - b) & 7;
            return d > 4 ? 8 - d : d;
        }

        /// <summary>
        /// Exact Section 4.3 <c>scoreTile</c> in integer milliseconds, matching TypeScript <c>scoreTileMs</c>.
        /// </summary>
        public static int ScoreTileMs(
            int walkCostMs,
            int fieldMs,
            int directOtherBodies,
            int adjacentOtherSum,
            int adjacentPlainCount,
            int otherClaims,
            int heading,
            int moveOctant,
            int stationSeed,
            int agentId,
            int segmentSequence,
            int tileTx,
            int tileTy,
            int tileTz2,
            bool useDensity = true,
            bool useBias = true,
            bool useClaims = true) {
            int density = 0;
            if (useDensity) {
                int adjTerm = adjacentPlainCount > 0
                    ? (DensityAdjacentMs * 2 * adjacentOtherSum + adjacentPlainCount) / (2 * adjacentPlainCount)
                    : 0;
                int rawDensity = DensityDirectMs * directOtherBodies + adjTerm;
                density = rawDensity > DensityCapMs ? DensityCapMs : rawDensity;
            }

            int reserved = 0;
            if (useClaims && otherClaims > 0) {
                int rawClaims = ClaimPenaltyMs * otherClaims;
                reserved = rawClaims > ClaimCapMs ? ClaimCapMs : rawClaims;
            }

            int turn = 0;
            int jitter = 0;
            if (useBias) {
                if (heading >= 0 && moveOctant >= 0) {
                    turn = TurnPenaltyMs * ShortestOctantDifference(heading, moveOctant);
                }
                jitter = Hash32Jitter(stationSeed, agentId, segmentSequence, tileTx, tileTy, tileTz2);
            }

            return walkCostMs + fieldMs + density + reserved + turn + jitter;
        }
    }

    public sealed class StationStandingOccupancy {
        int[] counts;

        public StationStandingOccupancy(int nodeCount) {
            counts = new int[Math.Max(0, nodeCount)];
        }

        public void Resize(int nodeCount) {
            int n = Math.Max(0, nodeCount);
            if (counts.Length != n) counts = new int[n];
            else Array.Clear(counts, 0, counts.Length);
        }

        public void Clear() => Array.Clear(counts, 0, counts.Length);

        public void Add(int node) {
            if ((uint)node < (uint)counts.Length) counts[node]++;
        }

        public int OtherBodiesOn(int node, int selfNode) {
            if ((uint)node >= (uint)counts.Length) return 0;
            int c = counts[node] - (node == selfNode ? 1 : 0);
            return c > 0 ? c : 0;
        }
    }

    public sealed class StationSoftClaimTable {
        struct AgentClaim {
            public int N0;
            public int N1;
            public int ExpiresTick;
        }

        int[] nodeCounts;
        readonly Dictionary<int, AgentClaim> byAgent = new Dictionary<int, AgentClaim>();
        readonly List<int> expireScratch = new List<int>();

        public StationSoftClaimTable(int nodeCount) {
            nodeCounts = new int[Math.Max(0, nodeCount)];
        }

        public int ActiveCount => byAgent.Count;

        public void Resize(int nodeCount) {
            nodeCounts = new int[Math.Max(0, nodeCount)];
            byAgent.Clear();
        }

        public void Clear() {
            Array.Clear(nodeCounts, 0, nodeCounts.Length);
            byAgent.Clear();
        }

        public void Remap(int newNodeCount, Func<int, int> mapOldToNew) {
            var nextCounts = new int[Math.Max(0, newNodeCount)];
            expireScratch.Clear();
            var updates = new List<(int id, AgentClaim claim)>(byAgent.Count);
            foreach (var kv in byAgent) {
                var c = kv.Value;
                int m0 = c.N0 >= 0 ? mapOldToNew(c.N0) : -1;
                int m1 = c.N1 >= 0 ? mapOldToNew(c.N1) : -1;
                if (m0 < 0 && m1 < 0) {
                    expireScratch.Add(kv.Key);
                    continue;
                }
                if (m1 == m0) m1 = -1;
                c.N0 = m0;
                c.N1 = m1;
                if ((uint)m0 < (uint)nextCounts.Length) nextCounts[m0]++;
                if ((uint)m1 < (uint)nextCounts.Length) nextCounts[m1]++;
                updates.Add((kv.Key, c));
            }
            for (int i = 0; i < expireScratch.Count; i++) byAgent.Remove(expireScratch[i]);
            for (int i = 0; i < updates.Count; i++) byAgent[updates[i].id] = updates[i].claim;
            nodeCounts = nextCounts;
        }

        public void Expire(int currentTick) {
            expireScratch.Clear();
            foreach (var kv in byAgent) {
                if (kv.Value.ExpiresTick <= currentTick) expireScratch.Add(kv.Key);
            }
            for (int i = 0; i < expireScratch.Count; i++) {
                Release(expireScratch[i]);
            }
        }

        public void Release(int agentId) {
            if (!byAgent.TryGetValue(agentId, out var old)) return;
            if ((uint)old.N0 < (uint)nodeCounts.Length && nodeCounts[old.N0] > 0) nodeCounts[old.N0]--;
            if ((uint)old.N1 < (uint)nodeCounts.Length && nodeCounts[old.N1] > 0) nodeCounts[old.N1]--;
            byAgent.Remove(agentId);
        }

        public void Refresh(int agentId, int step0, int step1, int currentTick, int ttl = StationSparsePolicy.ClaimTtlTicks) {
            int n0 = (uint)step0 < (uint)nodeCounts.Length ? step0 : -1;
            int n1 = StationSparsePolicy.ClaimSteps >= 2 && (uint)step1 < (uint)nodeCounts.Length && step1 != n0 ? step1 : -1;
            if (byAgent.TryGetValue(agentId, out var old)) {
                if (old.N0 == n0 && old.N1 == n1) {
                    old.ExpiresTick = currentTick + ttl;
                    byAgent[agentId] = old;
                    return;
                }
                if ((uint)old.N0 < (uint)nodeCounts.Length && nodeCounts[old.N0] > 0) nodeCounts[old.N0]--;
                if ((uint)old.N1 < (uint)nodeCounts.Length && nodeCounts[old.N1] > 0) nodeCounts[old.N1]--;
                if (n0 < 0 && n1 < 0) {
                    byAgent.Remove(agentId);
                    return;
                }
                old.N0 = n0;
                old.N1 = n1;
                old.ExpiresTick = currentTick + ttl;
                byAgent[agentId] = old;
                if (n0 >= 0) nodeCounts[n0]++;
                if (n1 >= 0) nodeCounts[n1]++;
                return;
            }
            if (n0 < 0 && n1 < 0) return;
            byAgent[agentId] = new AgentClaim { N0 = n0, N1 = n1, ExpiresTick = currentTick + ttl };
            if (n0 >= 0) nodeCounts[n0]++;
            if (n1 >= 0) nodeCounts[n1]++;
        }

        public int CountOtherAgentsOn(int node, int agentId) {
            if ((uint)node >= (uint)nodeCounts.Length) return 0;
            int c = nodeCounts[node];
            if (byAgent.TryGetValue(agentId, out var own) && (own.N0 == node || own.N1 == node)) c--;
            return c > 0 ? c : 0;
        }
    }
}
