using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    // Line-running fields from State.ts and sim/headway.ts. Other station repairs
    // remain separate and must complete before a candidate save is accepted.
    public static class StationLineRepair {
        static readonly int[] Formations = { 2, 3, 4, 6, 8 };
        static bool Number(JToken v, out double result) {
            result = 0;
            if (v == null || (v.Type != JTokenType.Integer && v.Type != JTokenType.Float)) return false;
            result = (double)v; return !double.IsNaN(result) && !double.IsInfinity(result);
        }
        static int Headway(JToken value, int fallback) {
            if (!Number(value, out var n)) return fallback;
            return (int)Math.Max(60, Math.Min(1200, Math.Floor(n + 0.5)));
        }
        public static string RepairJson(string json) {
            var lines = JArray.Parse(json); var result = new JArray();
            foreach (var value in lines) {
                if (!(value is JObject)) throw new FormatException("Invalid line");
                var line = (JObject)value.DeepClone();
                line["modelScale"] = 0.98;
                if (line["upTerminus"] == null || line["upTerminus"].Type == JTokenType.Null) line["upTerminus"] = "";
                if (line["downTerminus"] == null || line["downTerminus"].Type == JTokenType.Null) line["downTerminus"] = "";
                int formation = 6;
                if (Number(line["cars"], out var cars)) {
                    formation = Formations[0];
                    foreach (int option in Formations) if (Math.Abs(option - cars) < Math.Abs(formation - cars)) formation = option;
                }
                line["cars"] = formation;
                var profile = line["headwayProfile"] as JObject;
                line["headwayProfile"] = new JObject { ["peak"] = Headway(profile?["peak"], 150), ["offpeak"] = Headway(profile?["offpeak"], 240), ["late"] = Headway(profile?["late"], 480) };
                result.Add(line);
            }
            return result.ToString(Formatting.None);
        }
    }
}
