using System;
using System.Globalization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>
    /// Transactional v1 reader for the currently ported save subset. Unsupported
    /// module migrations fail closed before a station can be returned.
    /// </summary>
    public sealed class StationSaveV1 {
        public readonly struct RenderCell {
            public readonly int X,Y,Z;
            public RenderCell(int x,int y,int z) { X=x;Y=y;Z=z; }
        }
        public readonly struct RenderGate {
            public readonly string Id; public readonly int X,Y,Z,Rotation;
            public RenderGate(string id,int x,int y,int z,int rotation) { Id=id;X=x;Y=y;Z=z;Rotation=rotation; }
        }
        readonly JObject document;
        public int DroppedCells { get; }
        public int DroppedModules { get; }
        public int CellCount => ((JArray)document["cells"]).Count;
        public int ModuleCount => ((JArray)document["modules"]).Count;
        public int LineCount => ((JArray)document["lines"]).Count;
        public RenderCell[] SolidCells() {
            var cells=new System.Collections.Generic.List<RenderCell>();
            foreach(var value in (JArray)document["cells"]) if((string)value["fill"]=="solid")
                cells.Add(new RenderCell((int)value["x"],(int)value["y"],(int)value["z"]));
            return cells.ToArray();
        }
        public RenderGate[] Gates() {
            var gates=new System.Collections.Generic.List<RenderGate>();
            foreach(var value in (JArray)document["modules"]) if((string)value["type"]=="gate")
                gates.Add(new RenderGate((string)value["id"],(int)value["x"],(int)value["y"],(int)value["z"],(int?)value["rot"]??0));
            return gates.ToArray();
        }
        public JArray CopyCells() => (JArray)document["cells"].DeepClone();
        public JArray CopyModules() => (JArray)document["modules"].DeepClone();

        public void SetCell(int x, int y, int z, JObject replacement) {
            var cells = (JArray)document["cells"];
            var existing = System.Linq.Enumerable.FirstOrDefault(cells,
                cell => (int)cell["x"] == x && (int)cell["y"] == y && (double)cell["z"] == z);
            Replace(cells, existing, replacement);
        }

        public void SetModule(string id, JObject replacement) {
            var modules = (JArray)document["modules"];
            var existing = System.Linq.Enumerable.FirstOrDefault(modules, module => (string)module["id"] == id);
            Replace(modules, existing, replacement);
        }

        static void Replace(JArray records, JToken existing, JObject replacement) {
            if (replacement == null) existing?.Remove();
            else if (existing == null) records.Add(replacement.DeepClone());
            else existing.Replace(replacement.DeepClone());
        }

        StationSaveV1(JObject document,int cells,int modules) { this.document=document; DroppedCells=cells; DroppedModules=modules; }
        public static StationSaveV1 Read(string input) {
            var candidate=StationSaveCandidate.InspectV1(input);
            var state=JObject.Parse(candidate.InspectJson());
            var modules=(JArray)state["modules"];
            for (int i=0;i<modules.Count;i++) {
                var mod=modules[i] as JObject ?? throw new FormatException("Invalid module");
                string type=(string)mod["type"]; var cfg=mod["cfg"] as JObject;
                if (type=="sign") { modules[i]=JObject.Parse(StationSignRepair.NormalizeJson(mod.ToString(Formatting.None))); continue; }
                if ((type=="billboard" || type=="tv" || type=="busstop") && cfg?.Property("poster")==null)
                    throw new NotSupportedException("Ad poster backfill has not yet been ported");
                if ((type=="shop" || type=="retail" || type=="booth") && cfg?["stocked"]?.Type != JTokenType.Boolean)
                    throw new NotSupportedException("Room furniture backfill has not yet been ported");
                if ((type=="shop" || type=="retail" || type=="booth") && !(bool)cfg["stocked"])
                    throw new NotSupportedException("Room furniture backfill has not yet been ported");
                if ((type=="track" && cfg?["bridge"]?.Type==JTokenType.Boolean && (bool)cfg["bridge"]) ||
                    (type=="pillar" && cfg?.Property("bridgeId") != null && cfg["bridgeId"].Type != JTokenType.Null))
                    throw new NotSupportedException("Bridge support repair has not yet been ported");
            }
            return new StationSaveV1(state,candidate.DroppedCells,candidate.DroppedModules);
        }
        public string Write(DateTimeOffset savedAt) {
            var data=new JObject {
                ["format"]="metro-save",["formatVersion"]=1,["gameVersion"]="0.2.0",
                ["savedAt"]=savedAt.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture),
                ["name"]=document["name"].DeepClone(),["nameEn"]=document["nameEn"].DeepClone(),
                ["city"]=document["cityStyle"].DeepClone(),["seed"]=document["seed"].DeepClone(),
                ["levelBase"]=document["levelBase"].DeepClone(),["storeyHeight"]=5,
                ["service"]=document["service"].DeepClone(),["peaks"]=document["peaks"].DeepClone(),
                ["demand"]=document["demand"].DeepClone(),["calendar"]=document["calendar"].DeepClone(),
                ["static"]=new JObject {["cells"]=document["cells"].DeepClone(),["modules"]=document["modules"].DeepClone(),["lines"]=document["lines"].DeepClone()}
            };
            return data.ToString(Formatting.None);
        }
    }
}




