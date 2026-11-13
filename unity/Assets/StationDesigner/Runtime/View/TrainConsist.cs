using System;
using System.Collections.Generic;

namespace Metro.View {
    /// <summary>
    /// The consist arithmetic the platform screen doors repeat: door centres from the
    /// car cadence, per-door width and the run offsets a screen cuts its openings at.
    /// Port of `game/src/sim/stock.ts` (`STOCK`, `DOOR_END_INSET`, `doorCentres`,
    /// `doorWidthAt`), so a Unity opening and the car door it exists to meet come from
    /// one list.
    /// </summary>
    public static class TrainConsist {
        public const float DoorEndInset = 2.8f;

        public readonly struct Stock {
            public readonly string Cls;
            public readonly float Width, Length, Height, DoorWidth;
            public readonly int DoorsPerSide;
            public readonly bool HasCabLength;
            public readonly int CabDoorsPerSide;
            public readonly float CabLength, SingleEndDoorWidth;

            public Stock(string cls, float width, float length, float height, int doorsPerSide, float doorWidth,
                int cabDoorsPerSide = 0, float cabLength = 0f, float singleEndDoorWidth = 0f) {
                Cls = cls; Width = width; Length = length; Height = height; DoorsPerSide = doorsPerSide;
                DoorWidth = doorWidth; CabDoorsPerSide = cabDoorsPerSide; CabLength = cabLength;
                SingleEndDoorWidth = singleEndDoorWidth;
                HasCabLength = cabLength > 0f;
            }
        }

        static readonly Dictionary<string, Stock> Stocks = new Dictionary<string, Stock>(StringComparer.Ordinal) {
            ["A"] = new Stock("A", 3.0f, 22.0f, 3.8f, 5, 1.4f),
            ["B"] = new Stock("B", 2.8f, 19.5f, 3.8f, 4, 1.3f),
            ["C"] = new Stock("C", 2.6f, 19.0f, 3.6f, 4, 1.2f),
            ["L"] = new Stock("L", 2.8f, 16.8f, 3.6f, 3, 1.4f),
            // D: cab cars carry four doors and a 4.6 m cab, with one narrow end plug door.
            ["D"] = new Stock("D", 3.3f, 20.1f, 3.8f, 4, 1.4f, 4, 4.6f, 0.8f),
        };

        public static bool TryStock(string cls, out Stock stock) =>
            Stocks.TryGetValue(string.IsNullOrEmpty(cls) ? "A" : cls.ToUpperInvariant(), out stock);

        public static float Length(string stock, int cars, float modelScale) =>
            (TryStock(stock, out var s) ? s.Length : 22f) * cars * Scale(modelScale);

        static float Scale(float modelScale) => modelScale > 0f ? modelScale : 1f;

        /// <summary>`stock.ts` `doorCentres`: offsets from the consist centre, in metres.</summary>
        public static float[] DoorCentres(string stock, int cars, float modelScale) {
            if (!TryStock(stock, out var s) || cars <= 0) return Array.Empty<float>();
            int count = cars;
            float total = s.Length * count;
            var raw = new List<float>(count * s.DoorsPerSide);
            for (int c = 0; c < count; c++) {
                float carStart = c * s.Length;
                bool cabLeft = c == 0, cabRight = c == count - 1;
                int doors = cabLeft || cabRight ? (s.CabDoorsPerSide > 0 ? s.CabDoorsPerSide : s.DoorsPerSide) : s.DoorsPerSide;
                float cabInset = s.HasCabLength ? s.CabLength + s.SingleEndDoorWidth * .5f + .3f : DoorEndInset;
                float first = cabLeft ? cabInset : DoorEndInset;
                float last = s.Length - (cabRight ? cabInset : DoorEndInset);
                float pitch = doors > 1 ? (last - first) / (doors - 1) : 0f;
                for (int d = 0; d < doors; d++) raw.Add(carStart + (doors > 1 ? first + d * pitch : s.Length * .5f));
            }
            var scale = Scale(modelScale);
            var offsets = new float[raw.Count];
            for (int i = 0; i < raw.Count; i++) {
                float off = raw[i] - total * .5f;
                // Round the distance from the centre, not the signed value (stock.ts).
                offsets[i] = Math.Sign(off) * (float)(Math.Round(Math.Abs(off) * 10.0 + 1e-9) / 10.0) * scale;
            }
            return offsets;
        }

        /// <summary>`stock.ts` `doorWidthAt`: one narrow end plug door on a D cab car.</summary>
        public static float DoorWidthAt(string stock, int cars, float modelScale, float offset) {
            if (!TryStock(stock, out var s) || !s.HasCabLength || s.SingleEndDoorWidth <= 0f) return DoorWidth(stock, modelScale);
            float scale = Scale(modelScale);
            float fromEnd = (Length(stock, cars, modelScale) * .5f - Math.Abs(offset)) / scale;
            float endInset = s.CabLength + s.SingleEndDoorWidth * .5f + .3f;
            return Math.Abs(fromEnd - endInset) < .06f ? s.SingleEndDoorWidth * scale : s.DoorWidth * scale;
        }

        public static float DoorWidth(string stock, float modelScale) =>
            (TryStock(stock, out var s) ? s.DoorWidth : 1.4f) * Scale(modelScale);

        /// <summary>Door centres measured from the rail's first cell (`railW/2 + offset`).</summary>
        public static float[] DoorRunOffsets(string stock, int cars, float modelScale, int railWidth) {
            var offsets = DoorCentres(stock, cars, modelScale);
            for (int i = 0; i < offsets.Length; i++) offsets[i] += railWidth * .5f;
            return offsets;
        }
    }
}
