using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    // Grid-only portion of the TS repair path. This is not yet a station reader:
    // callers must also apply State.ts repairs before accepting a document.
    public static class StationGridRepair {
        public static string RepairSaveJson(string json) {
            var doc = JObject.Parse(json);
            return RepairJson((doc["static"] as JObject ?? throw new FormatException("Missing station data")).ToString(Formatting.None));
        }
        public static string RepairJson(string json) {
            var data = JObject.Parse(json);
            var cells = data["cells"] as JArray ?? throw new FormatException("Missing cells");
            var modules = data["modules"] as JArray ?? throw new FormatException("Missing modules");
            var keptCells = new JArray(); var keptModules = new JArray();
            foreach (var token in cells) if (GridPoint(token)) keptCells.Add(token.DeepClone());
            foreach (var token in modules) if (GridModule(token)) keptModules.Add(token.DeepClone());
            return new JObject { ["cells"] = keptCells, ["modules"] = keptModules,
                ["droppedCells"] = cells.Count - keptCells.Count,
                ["droppedModules"] = modules.Count - keptModules.Count }.ToString(Formatting.None);
        }
        static bool Number(JToken v, out double n) {
            n = 0;
            if (v == null || (v.Type != JTokenType.Integer && v.Type != JTokenType.Float)) return false;
            n = (double)v; return !double.IsNaN(n) && !double.IsInfinity(n);
        }
        static bool Integer(JToken v) => Number(v, out var n) && Math.Truncate(n) == n;
        static bool GridPoint(JToken v) => v is JObject && Integer(v["x"]) && Integer(v["y"]) && Integer(v["z"]);
        static bool GridModule(JToken token) {
            if (!(token is JObject m)) throw new FormatException("Invalid module");
            var type = (string)m["type"]; var cfg = m["cfg"] as JObject;
            // Wall-mounted panels may intentionally have a fractional Z anchor.
            if (Integer(m["x"]) && Integer(m["y"]) && Number(m["z"], out _)) {
                bool wall = type == "billboard" || type == "calligraphy" ||
                    (type == "monitor" && (string)cfg?["mount"] == "wall") ||
                    (type == "sign" && (string)cfg?["mount"] == "wall") ||
                    (type == "linemap" && (string)cfg?["mount"] != "stand");
                if (type == "glass") {
                    string variant = (string)cfg?["variant"];
                    bool tall = variant == "1x4" || variant == "2x4" || variant == "3x4" || variant == "4x4";
                    bool curtain = cfg != null && cfg.Property("curtainHeight") != null;
                    wall = !tall && !curtain;
                }
                if (wall) return true;
            }
            if (!GridPoint(m)) return false;
            foreach (string key in new[] { "from", "to" }) if (m[key] != null && m[key].Type != JTokenType.Null && !GridPoint(m[key])) return false;
            if (type == "stair" && cfg?["flights"] is JArray flights) foreach (var flight in flights) {
                foreach (string key in new[] { "from", "to" }) {
                    var p = flight[key];
                    if (!(p is JObject) || !Integer(p["x"]) || !Integer(p["y"]) || !Number(p["z"], out var z) || double.IsInfinity(z * 2) || Math.Truncate(z * 2) != z * 2) return false;
                }
            }
            return true;
        }
    }
}




