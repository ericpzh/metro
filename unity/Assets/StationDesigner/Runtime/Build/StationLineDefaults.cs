using System;
using System.Collections.Generic;

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
    /// All eight canonical city style palettes ported from <c>game/src/sim/cityStyles.ts</c>.
    /// Engine-free and JSON-free so <c>Metro.Build</c>, <c>Metro.Persistence</c>, <c>Metro.View</c>
    /// and <c>Metro.App</c> share one source of truth.
    /// </summary>
    public static class StationCityStyles {
        public const string DefaultCity = "guangzhou";
        public const string DefaultLineColour = "#2f7ef2";

        public static readonly string[] CityIds = {
            "guangzhou", "shenzhen", "shanghai", "beijing", "chengdu", "chongqing", "wuhan", "nanjing",
        };

        static readonly Dictionary<string, Dictionary<string, string>> Palettes =
            new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal) {
                ["guangzhou"] = new Dictionary<string, string>(StringComparer.Ordinal) {
                    ["1"] = "#f3d03e", ["2"] = "#00629b", ["3"] = "#eca154", ["4"] = "#00843d",
                    ["5"] = "#c5003e", ["6"] = "#80225f", ["7"] = "#97d700", ["8"] = "#008c95",
                    ["9"] = "#71cc98", ["10"] = "#7d9bc1", ["11"] = "#ffa400", ["12"] = "#59621d",
                    ["13"] = "#8e8c13", ["14"] = "#81312f", ["18"] = "#0047ba", ["21"] = "#201747",
                    ["22"] = "#cd5228", ["Guangfo"] = "#c4d600", ["APM"] = "#00b5e2", ["15"] = "#a4d65e",
                    ["16"] = "#9f621d", ["17"] = "#e09a80", ["19"] = "#c53b7f", ["20"] = "#e06287",
                    ["24"] = "#0072ce", ["28"] = "#c07f34", ["THZ1"] = "#43b02a", ["THP1"] = "#e4002b",
                    ["THP2"] = "#00629b",
                },
                ["shenzhen"] = new Dictionary<string, string>(StringComparer.Ordinal) {
                    ["1"] = "#00ab39", ["2"] = "#db6d1c", ["3"] = "#00a2e1", ["4"] = "#dc241f",
                    ["5"] = "#9950b2", ["6"] = "#3abca8", ["6B"] = "#e51836", ["7"] = "#0035ad",
                    ["8"] = "#db6d1c", ["9"] = "#846e74", ["10"] = "#ef60a3", ["11"] = "#6a1d44",
                    ["12"] = "#a192b2", ["13"] = "#de7c00", ["14"] = "#f2c75c", ["15"] = "#76b900",
                    ["16"] = "#1e22aa", ["17"] = "#00a19b", ["18"] = "#6eceb2", ["19"] = "#0077c8",
                    ["20"] = "#88dbdf", ["21"] = "#e0004d", ["22"] = "#f4a261", ["24"] = "#00a88f",
                    ["25"] = "#f18a00", ["27"] = "#0097a9", ["29"] = "#6d2077", ["32"] = "#0085ad",
                },
                ["shanghai"] = new Dictionary<string, string>(StringComparer.Ordinal) {
                    ["1"] = "#e4002b", ["2"] = "#97d700", ["3"] = "#ffd100", ["4"] = "#5f259f",
                    ["5"] = "#ac4fc6", ["6"] = "#d9027d", ["7"] = "#ff6900", ["8"] = "#00a3e0",
                    ["9"] = "#71c5e8", ["10"] = "#c1a7e2", ["11"] = "#76232f", ["12"] = "#007b5f",
                    ["13"] = "#ef95cf", ["14"] = "#827a04", ["15"] = "#bba786", ["16"] = "#2cd5c4",
                    ["17"] = "#bc796f", ["18"] = "#d6a461", ["19"] = "#f06d00", ["20"] = "#009f4d",
                    ["21"] = "#6e4c1e", ["22"] = "#e5554f", ["23"] = "#b090c5", ["26"] = "#00629b",
                    ["Pujiang"] = "#999999", ["Maglev"] = "#009090", ["浦江线"] = "#999999", ["磁浮线"] = "#009090",
                },
                ["beijing"] = new Dictionary<string, string>(StringComparer.Ordinal) {
                    ["1"] = "#a4343a", ["2"] = "#004b87", ["3"] = "#d9017a", ["4"] = "#008c95",
                    ["5"] = "#aa0061", ["6"] = "#b58500", ["7"] = "#ffc56e", ["8"] = "#009b77",
                    ["9"] = "#97d700", ["10"] = "#0092bc", ["11"] = "#ed796b", ["12"] = "#9c4f01",
                    ["13"] = "#f4da40", ["14"] = "#ca9a8e", ["15"] = "#653279", ["16"] = "#6ba539",
                    ["17"] = "#00a9a9", ["18"] = "#b58500", ["19"] = "#d3a3c9", ["20"] = "#0077c8",
                    ["22"] = "#e87722", ["25"] = "#009ca6", ["28"] = "#6eceb2",
                    ["Batong"] = "#a4343a", ["八通线"] = "#a4343a", ["Daxing"] = "#008c95", ["大兴线"] = "#008c95",
                    ["Changping"] = "#d986ba", ["昌平线"] = "#d986ba", ["Fangshan"] = "#d86018", ["房山线"] = "#d86018",
                    ["Yizhuang"] = "#d0006f", ["亦庄线"] = "#d0006f", ["Yanfang"] = "#d86018", ["燕房线"] = "#d86018",
                    ["S1"] = "#a45a2a", ["S1线"] = "#a45a2a", ["Xijiao"] = "#d22630", ["西郊线"] = "#d22630",
                    ["YizhuangT1"] = "#d22630", ["亦庄T1线"] = "#d22630",
                    ["CapitalAirport"] = "#a192b2", ["首都机场线"] = "#a192b2",
                    ["DaxingAirport"] = "#0049a5", ["大兴机场线"] = "#0049a5",
                    ["Pinggu"] = "#e87722", ["平谷线"] = "#e87722",
                },
                ["chengdu"] = new Dictionary<string, string>(StringComparer.Ordinal) {
                    ["1"] = "#10069f", ["2"] = "#ff5c39", ["3"] = "#d9017a", ["4"] = "#00ab59",
                    ["5"] = "#bb29bb", ["6"] = "#b36924", ["7"] = "#59cbe8", ["8"] = "#c4d600",
                    ["9"] = "#ffb81c", ["10"] = "#003da5", ["17"] = "#80e0a7", ["18"] = "#006272",
                    ["Rong2"] = "#44af52", ["蓉2"] = "#44af52", ["蓉2号线"] = "#44af52",
                },
                ["chongqing"] = new Dictionary<string, string>(StringComparer.Ordinal) {
                    ["0"] = "#f2a900", ["环"] = "#f2a900", ["环线"] = "#f2a900",
                    ["1"] = "#e4002b", ["2"] = "#007a33", ["3"] = "#003da5", ["4"] = "#dc8633",
                    ["5"] = "#00a3e0", ["6"] = "#f67599", ["7"] = "#008c95", ["8"] = "#7a9a01",
                    ["9"] = "#862041", ["10"] = "#5f249f", ["11"] = "#782f40", ["12"] = "#71c5e8",
                    ["13"] = "#d9017a", ["14"] = "#97d700", ["15"] = "#004b87", ["16"] = "#b58500",
                    ["17"] = "#a77bca", ["18"] = "#2cd5c4", ["19"] = "#7a4e8c", ["20"] = "#e03c31",
                    ["21"] = "#6d2077", ["22"] = "#009b77", ["23"] = "#ff6900", ["24"] = "#d45d00",
                    ["25"] = "#0077c8", ["26"] = "#c4d600", ["27"] = "#0057b8", ["28"] = "#a45a2a",
                    ["29"] = "#ef60a3",
                    ["jt"] = "#003865", ["江跳"] = "#003865", ["江跳线"] = "#003865",
                    ["bt"] = "#0077c8", ["璧铜"] = "#0077c8", ["璧铜线"] = "#0077c8",
                    ["yc"] = "#00a88f", ["永川"] = "#00a88f", ["永川线"] = "#00a88f",
                    ["nc"] = "#5f259f", ["南川"] = "#5f259f", ["南川线"] = "#5f259f",
                    ["dz"] = "#d86018", ["大足"] = "#d86018", ["大足线"] = "#d86018",
                    ["qw"] = "#97d700", ["綦万"] = "#97d700", ["綦万线"] = "#97d700",
                },
                ["wuhan"] = new Dictionary<string, string>(StringComparer.Ordinal) {
                    ["1"] = "#3080b7", ["2"] = "#eb81b9", ["3"] = "#ddba82", ["4"] = "#8fc31f",
                    ["5"] = "#b75347", ["6"] = "#008234", ["7"] = "#f08600", ["8"] = "#99adad",
                    ["9"] = "#0096a6", ["10"] = "#8d6e63", ["11"] = "#f9d616", ["12"] = "#0097a9",
                    ["13"] = "#7b68ee", ["14"] = "#e06287", ["15"] = "#4db6ac", ["16"] = "#d25f7f",
                    ["17"] = "#a1887f", ["18"] = "#00acc1", ["19"] = "#129490", ["20"] = "#5c6bc0",
                    ["21"] = "#d8006c",
                    ["Yangluo"] = "#d8006c", ["阳逻"] = "#d8006c", ["阳逻线"] = "#d8006c",
                    ["Xingang"] = "#0077c8", ["新港"] = "#0077c8", ["新港线"] = "#0077c8",
                },
                ["nanjing"] = new Dictionary<string, string>(StringComparer.Ordinal) {
                    ["1"] = "#00a2df", ["2"] = "#c70039", ["3"] = "#009651", ["4"] = "#796baf",
                    ["5"] = "#e3c16f", ["6"] = "#62b5e5", ["7"] = "#4a7729", ["8"] = "#d9534f",
                    ["9"] = "#f26b3a", ["10"] = "#eac384", ["11"] = "#b76e79",
                    ["S1"] = "#4bbab3", ["S2"] = "#e87722", ["S3"] = "#ba84ac", ["S4"] = "#00a0e9",
                    ["S5"] = "#9c6b30", ["S6"] = "#c98bdb", ["S7"] = "#de8ca5", ["S8"] = "#ff8000",
                    ["S9"] = "#e4a826",
                },
            };

        public static string Normalize(string city) =>
            !string.IsNullOrEmpty(city) && Palettes.ContainsKey(city) ? city : DefaultCity;

        public static bool IsValid(string city) =>
            !string.IsNullOrEmpty(city) && Palettes.ContainsKey(city);

        public static string LineColourFor(string id, string city = DefaultCity) {
            if (string.IsNullOrEmpty(id)) return DefaultLineColour;
            var table = Palettes[Normalize(city)];
            return table.TryGetValue(id, out string hex) ? hex : DefaultLineColour;
        }
    }

    /// <summary>
    /// The default line the Add Line button creates (<c>build/rail.ts:defaultLine</c>),
    /// populated with the station's active city palette from <see cref="StationCityStyles"/>.
    /// </summary>
    public static class StationLineDefaults {
        /// <summary><c>DEFAULT_LINE_COLOUR</c>.</summary>
        public const string FallbackColour = StationCityStyles.DefaultLineColour;

        /// <summary><c>defaultLine(id, dir, power, city)</c>: a fresh line for Add Line.</summary>
        public static StationLineDraft Default(string id, string direction, string power, string city = StationCityStyles.DefaultCity) {
            var lineId = string.IsNullOrEmpty(id) ? "1" : id;
            return new StationLineDraft {
                Id = lineId,
                Name = lineId + "号线",
                NameEn = "Line " + lineId,
                Colour = ColourFor(lineId, city),
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

        /// <summary><c>lineColourFor(id, city)</c>: the city's sign colour for <paramref name="id"/>, else <see cref="FallbackColour"/>.</summary>
        public static string ColourFor(string id, string city = StationCityStyles.DefaultCity) =>
            StationCityStyles.LineColourFor(id, city);
    }
}
