using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>Non-committable R2 inspection result while module/geometry repair is unported.</summary>
    public sealed class StationSaveCandidate {
        readonly JObject normalized;
        public int DroppedCells { get; }
        public int DroppedModules { get; }
        // A candidate is intentionally not a station document; no save writer is exposed.
        StationSaveCandidate(JObject document, int cells, int modules) { normalized=document; DroppedCells=cells; DroppedModules=modules; }
        public static StationSaveCandidate InspectV1(string json) {
            JObject source;
            try { source=JObject.Parse(json); } catch (JsonException e) { throw new FormatException("Corrupt save",e); }
            if ((string)source["format"] != "metro-save") throw new FormatException("Not a metro save");
            var version=source["formatVersion"];
            if (version != null && (version.Type==JTokenType.Integer || version.Type==JTokenType.Float) && (double)version>1) throw new FormatException("Save version is too new");
            var data=source["static"] as JObject;
            if (!(data?["cells"] is JArray)) throw new FormatException("Missing station cells");
            var modules=data["modules"]?.Type == JTokenType.Null ? null : data["modules"];
            var lines=data["lines"]?.Type == JTokenType.Null ? null : data["lines"];
            if (modules != null && !(modules is JArray) || lines != null && !(lines is JArray)) throw new FormatException("Invalid station arrays");
            var gridInput=new JObject {["cells"]=data["cells"].DeepClone(),["modules"]=modules?.DeepClone() ?? new JArray()};
            var grid=JObject.Parse(StationGridRepair.RepairJson(gridInput.ToString(Formatting.None)));
            foreach (var item in (JArray)grid["modules"]) if (item is JObject mod && mod.Property("storeyHeight") != null) mod["storeyHeight"]=5;
            var day=JObject.Parse(StationDayRepair.RepairJson(source.ToString(Formatting.None)));
            var city=source["city"]?.Type == JTokenType.Null ? source["cityStyle"] : source["city"] ?? source["cityStyle"];
            string cityName=city?.Type == JTokenType.String ? (string)city : "";
            if (Array.IndexOf(new[] { "guangzhou", "shenzhen", "shanghai", "beijing", "chengdu", "chongqing", "wuhan", "nanjing" }, cityName) < 0) cityName="guangzhou";
            var baseValue=source["levelBase"];
            double level=baseValue != null && (baseValue.Type == JTokenType.Integer || baseValue.Type == JTokenType.Float) ? (double)baseValue : 0;
            if (double.IsNaN(level) || double.IsInfinity(level)) level=0;
            var candidate=new JObject {
                ["name"]=source["name"]?.Type == JTokenType.String ? source["name"].DeepClone() : "未命名车站",
                ["nameEn"]=source["nameEn"]?.Type == JTokenType.String ? ((string)source["nameEn"]).Trim() : "",
                ["seed"]=source["seed"]?.Type == JTokenType.Integer || source["seed"]?.Type == JTokenType.Float ? source["seed"].DeepClone() : new JValue(1234567),
                ["cityStyle"]=cityName, ["levelBase"]=Math.Max(0,Math.Min(4,Math.Floor(level+.5))),
                ["storeyHeight"]=5,
                ["cells"]=JArray.Parse(StationCellNormalization.NormalizeJson(grid["cells"].ToString(Formatting.None))), ["modules"]=grid["modules"].DeepClone(),
                ["lines"]=JArray.Parse(StationLineRepair.RepairJson((lines ?? new JArray()).ToString(Formatting.None))),
                ["service"]=day["service"].DeepClone(),["peaks"]=day["peaks"].DeepClone(),["demand"]=day["demand"].DeepClone(),["calendar"]=day["calendar"].DeepClone()
            };
            return new StationSaveCandidate(candidate,(int)grid["droppedCells"],(int)grid["droppedModules"]);
        }
        public string InspectJson() => normalized.ToString(Formatting.None);
    }
}



