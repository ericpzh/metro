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

        /// <summary>
        /// The normalized candidate object. It is the repaired state a reader projects, kept
        /// as the parsed tree so a load does not serialize and re-parse the whole station a
        /// second time (plan 29 §3: a local edit must not pay for whole-document work twice).
        /// </summary>
        internal JObject Normalized => normalized;

        public static StationSaveCandidate InspectV1(string json) {
            JObject source;
            try { source=JObject.Parse(json); } catch (JsonException e) { throw new FormatException("Corrupt save",e); }
            return InspectV1Core(source, consumeInput: true);
        }

        /// <summary>Inspect an already-parsed envelope; the text overload is this plus one parse.</summary>
        public static StationSaveCandidate InspectV1(JObject source) => InspectV1Core(source, consumeInput: false);

        /// <summary>Inspect an envelope owned exclusively by the caller, detaching large arrays in place.</summary>
        internal static StationSaveCandidate InspectOwnedV1(JObject ownedSource) => InspectV1Core(ownedSource, consumeInput: true);

        static StationSaveCandidate InspectV1Core(JObject source, bool consumeInput) {
            if (source == null) throw new FormatException("Corrupt save");
            if ((string)source["format"] != "metro-save") throw new FormatException("Not a metro save");
            var version=source["formatVersion"];
            if (version != null && (version.Type==JTokenType.Integer || version.Type==JTokenType.Float) && (double)version>1) throw new FormatException("Save version is too new");
            var data=source["static"] as JObject;
            if (!(data?["cells"] is JArray rawCells)) throw new FormatException("Missing station cells");
            var modules=data["modules"]?.Type == JTokenType.Null ? null : data["modules"];
            var lines=data["lines"]?.Type == JTokenType.Null ? null : data["lines"];
            if (modules != null && !(modules is JArray) || lines != null && !(lines is JArray)) throw new FormatException("Invalid station arrays");
            var linesJson = (lines ?? new JArray()).ToString(Formatting.None);
            StationGridRepair.RepairArrays(rawCells, (modules as JArray) ?? new JArray(), consumeInput,
                out var keptCells, out var keptModules, out int droppedCells, out int droppedModules);
            if (consumeInput) source.Remove("static");
            foreach (var item in keptModules) if (item is JObject mod && mod.Property("storeyHeight") != null) mod["storeyHeight"]=5;
            StationCellNormalization.NormalizeArrayInPlace(keptCells);
            // The day repair reads four authored keys only: repair a small object instead of
            // serializing and re-parsing the whole station for it (plan 29 §3).
            var dayInput=new JObject {
                ["service"]=source["service"]?.DeepClone() ?? JValue.CreateNull(),
                ["peaks"]=source["peaks"]?.DeepClone() ?? JValue.CreateNull(),
                ["demand"]=source["demand"]?.DeepClone() ?? JValue.CreateNull(),
                ["calendar"]=source["calendar"]?.DeepClone() ?? JValue.CreateNull(),
            };
            var day=JObject.Parse(StationDayRepair.RepairJson(dayInput.ToString(Formatting.None)));
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
                ["cells"]=keptCells, ["modules"]=keptModules,
                ["lines"]=JArray.Parse(StationLineRepair.RepairJson(linesJson)),
                ["service"]=day["service"].DeepClone(),["peaks"]=day["peaks"].DeepClone(),["demand"]=day["demand"].DeepClone(),["calendar"]=day["calendar"].DeepClone()
            };
            return new StationSaveCandidate(candidate,droppedCells,droppedModules);
        }
        public string InspectJson() => normalized.ToString(Formatting.None);
    }
}



