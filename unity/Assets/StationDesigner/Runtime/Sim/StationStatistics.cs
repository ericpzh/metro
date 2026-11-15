using System;

namespace Metro.Sim {
    /// <summary>
    /// Pedestrian Level of Service grades (<c>game/src/sim/constants.ts</c>, Fruin walkway
    /// density bands in m² per standing passenger).
    /// </summary>
    public static class StationLos {
        public static readonly double[] Bands = { 1.2, 0.9, 0.7, 0.4, 0.2 };
        public static readonly string[] Order = { "A", "B", "C", "D", "E", "F" };

        public static string GradeFromAreaPerPerson(double areaPerPerson) {
            if (areaPerPerson >= 1.2) return "A";
            if (areaPerPerson >= 0.9) return "B";
            if (areaPerPerson >= 0.7) return "C";
            if (areaPerPerson >= 0.4) return "D";
            if (areaPerPerson >= 0.2) return "E";
            return "F";
        }

        public static string Compute(double stationArea, int standing) {
            if (standing <= 0 || stationArea <= 0 || double.IsNaN(stationArea) || double.IsInfinity(stationArea)) {
                return "A";
            }
            return GradeFromAreaPerPerson(stationArea / standing);
        }

        public static int IndexOf(string grade) {
            switch (grade) {
                case "A": return 0;
                case "B": return 1;
                case "C": return 2;
                case "D": return 3;
                case "E": return 4;
                case "F": return 5;
                default: return 0;
            }
        }
    }

    /// <summary>
    /// Live station metrics snapshot matching TypeScript's <c>Metrics</c> interface
    /// (<c>game/src/sim/world/types.ts</c>).
    /// </summary>
    public struct StationStatisticsSnapshot {
        public long Tick;
        public double SimTime;
        public int Population;
        public string CrowdLos;
        public int LeftBehind;
        public int Boarded;
        public int Alighted;
        public int Exited;
        public int TrainArrivals;
        public int TrainsLate;
        public int GateQueue;
        public int EscalatorQueue;
        public int LiftQueue;
        public int DoorQueue;
        public string Period;
        public bool AgentsCap;
        public double TickMs;
        public int Stuck;
    }

    /// <summary>
    /// Per-run one-minute station statistics history (<c>game/src/sim/history.ts</c>).
    /// Stores exact C# doubles in the 13-column interleaved row layout; the JS adapter
    /// converts slices to <c>Float32Array</c> when writing <c>SimSlice.history</c>.
    /// </summary>
    public sealed class StationStatisticsHistory {
        public const int ColSimTime = 0;
        public const int ColPopulation = 1;
        public const int ColCrowdLos = 2;
        public const int ColGateQueue = 3;
        public const int ColEscalatorQueue = 4;
        public const int ColLiftQueue = 5;
        public const int ColDoorQueue = 6;
        public const int ColBoarded = 7;
        public const int ColExited = 8;
        public const int ColLeftBehind = 9;
        public const int ColBoardedPerMin = 10;
        public const int ColExitedPerMin = 11;
        public const int ColLeftBehindPerMin = 12;

        public const int Stride = 13;
        public const int SampleSeconds = 60;

        public static readonly string[] Columns = {
            "simTime",
            "population",
            "crowdLos",
            "gateQueue",
            "escalatorQueue",
            "liftQueue",
            "doorQueue",
            "boarded",
            "exited",
            "leftBehind",
            "boardedPerMin",
            "exitedPerMin",
            "leftBehindPerMin",
        };

        double[] values = new double[Stride * 64];
        int count;
        double start;
        double last = double.NegativeInfinity;
        int prevBoarded;
        int prevExited;
        int prevLeftBehind;

        public StationStatisticsHistory(double initialStart = 0) {
            start = initialStart;
        }

        public int Count => count;
        public double Start => start;
        public int Step => SampleSeconds;

        /// <summary>
        /// Reset the series at <paramref name="simTime"/> so the first completed tick
        /// after a load, restart or seek opens the new series with zero flow deltas.
        /// </summary>
        public void Reset(double simTime) {
            count = 0;
            start = simTime;
            last = simTime - SampleSeconds;
            prevBoarded = 0;
            prevExited = 0;
            prevLeftBehind = 0;
        }

        /// <summary>
        /// Append one row when at least <see cref="SampleSeconds"/> simulated seconds
        /// have passed since the previous sample.
        /// </summary>
        public bool Sample(in StationStatisticsSnapshot snapshot) {
            if (snapshot.SimTime - last < SampleSeconds) return false;
            last = snapshot.SimTime;
            bool first = count == 0;
            if (first) start = snapshot.SimTime;
            EnsureCapacity(count + 1);
            int at = count * Stride;
            values[at + ColSimTime] = snapshot.SimTime;
            values[at + ColPopulation] = snapshot.Population;
            values[at + ColCrowdLos] = StationLos.IndexOf(snapshot.CrowdLos);
            values[at + ColGateQueue] = snapshot.GateQueue;
            values[at + ColEscalatorQueue] = snapshot.EscalatorQueue;
            values[at + ColLiftQueue] = snapshot.LiftQueue;
            values[at + ColDoorQueue] = snapshot.DoorQueue;
            values[at + ColBoarded] = snapshot.Boarded;
            values[at + ColExited] = snapshot.Exited;
            values[at + ColLeftBehind] = snapshot.LeftBehind;
            values[at + ColBoardedPerMin] = first ? 0 : snapshot.Boarded - prevBoarded;
            values[at + ColExitedPerMin] = first ? 0 : snapshot.Exited - prevExited;
            values[at + ColLeftBehindPerMin] = first ? 0 : snapshot.LeftBehind - prevLeftBehind;
            prevBoarded = snapshot.Boarded;
            prevExited = snapshot.Exited;
            prevLeftBehind = snapshot.LeftBehind;
            count++;
            return true;
        }

        /// <summary>
        /// Read a bounded contiguous slice of rows <c>[from, from + rowCount)</c> into a
        /// fresh array without exposing the internal buffer.
        /// </summary>
        public bool TryRead(int from, int limit, out double[] slice, out int rowCount) {
            if (from < 0 || from > count || limit < 0) {
                slice = Array.Empty<double>();
                rowCount = 0;
                return false;
            }
            int available = count - from;
            rowCount = limit < available ? limit : available;
            if (rowCount <= 0) {
                slice = Array.Empty<double>();
                rowCount = 0;
                return true;
            }
            slice = new double[rowCount * Stride];
            Array.Copy(values, from * Stride, slice, 0, slice.Length);
            return true;
        }

        public double[] Read(int from, int limit) => Read(from, limit, out _);

        public double[] Read(int from, int limit, out int rowCount) {
            if (!TryRead(from, limit, out double[] slice, out rowCount)) {
                throw new ArgumentOutOfRangeException(from < 0 || from > count ? nameof(from) : nameof(limit));
            }
            return slice;
        }

        void EnsureCapacity(int rows) {
            int need = rows * Stride;
            if (need <= values.Length) return;
            int nextLength = values.Length;
            while (nextLength < need) nextLength *= 2;
            var next = new double[nextLength];
            Array.Copy(values, 0, next, 0, count * Stride);
            values = next;
        }
    }

    /// <summary>How an incoming edited document affects the running simulation.</summary>
    public enum StationDocumentEditKind {
        Structural = 0,
        Cosmetic = 1,
        DayOnly = 2,
    }
}
