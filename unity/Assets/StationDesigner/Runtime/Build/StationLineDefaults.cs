using System;

namespace Metro.Build {
    /// <summary>
    /// A line record one edit may **add** with the piece that binds to it (plan 28 §3c). The
    /// reference's `layTrack` creates a default line on a document that has none — "First rail on
    /// a fresh station: create the line it binds to, so placement never stalls on an empty line
    /// list" — and commits it in the same transaction as the track. `Metro.Build` cannot reference
    /// Newtonsoft, so this is the typed half the persistence layer writes.
    /// </summary>
    public sealed class StationLineDraft {
        public string Id = "";
        public string Name = "";
        public string NameEn = "";
        public string Colour = "";
        public string Stock = "B";
        public int Cars = 6;
        public string Power = "third-rail";
        public string Psd = "full";
        public string Direction = "up";
        /// <summary>The save's headway profile, in seconds (`peak`, `offpeak`, `late`).</summary>
        public double PeakHeadway = 150;
        public double OffpeakHeadway = 240;
        public double LateHeadway = 480;
        public int AlightPerTrain = 200;
        public string Terminus = "through";
        public int TravelSign = 1;
        /// <summary>`trainScaleForStorey()`: the consist scale every demo save carries.</summary>
        public double ModelScale = 0.98;
    }

    /// <summary>
    /// The default line a first rail creates (`build/rail.ts:defaultLine`), so a station that has
    /// never carried a track can still lay a platform. The authored fields match the reference's
    /// own defaults one for one — a stock-B six-car third-rail line with full-height screen doors
    /// — and only the colour table is the one entry a default line can name (`'1'`).
    /// </summary>
    public static class StationLineDefaults {
        /// <summary>`DEFAULT_LINE_COLOUR`.</summary>
        public const string FallbackColour = "#2f7ef2";

        /// <summary>`defaultLine(id, dir, power, city)`: a fresh line for the first rail laid.</summary>
        public static StationLineDraft Default(string id, string direction, string power) {
            var lineId = string.IsNullOrEmpty(id) ? "1" : id;
            return new StationLineDraft {
                Id = lineId,
                Name = lineId + "号线",
                NameEn = "Line " + lineId,
                Colour = ColourFor(lineId),
                Stock = "B",
                Cars = 6,
                Power = string.IsNullOrEmpty(power) ? "third-rail" : power,
                Psd = "full",
                Direction = string.IsNullOrEmpty(direction) ? "up" : direction,
                PeakHeadway = 150,
                OffpeakHeadway = 240,
                LateHeadway = 480,
                AlightPerTrain = 200,
                Terminus = "through",
                TravelSign = 1,
                ModelScale = 0.98,
            };
        }

        /// <summary>
        /// `lineColourFor`: the city's own sign colour for the line number. Only Guangzhou's
        /// `'1'` can be reached from a default line, and an unknown id reads the shared fallback.
        /// </summary>
        public static string ColourFor(string id) {
            if (string.Equals(id, "1", StringComparison.Ordinal)) return "#edcf3b";
            return FallbackColour;
        }
    }
}
