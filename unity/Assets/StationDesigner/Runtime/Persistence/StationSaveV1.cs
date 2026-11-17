using System;
using System.Globalization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>
    /// Transactional v1 reader for the currently ported save subset. Unsupported
    /// module migrations fail closed before a station can be returned.
    ///
    /// The module repairs the TypeScript load path performs on the way in —
    /// advertising posters, room furniture and bridge-owned pillars — live in
    /// <see cref="StationModuleRepair"/> (packet A). They run here, before the
    /// normalized state is handed to <see cref="StationDocumentReader"/>.
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
        /// <summary>What the module repairs changed, so a load can report them.</summary>
        public StationRepairReport Repairs { get; }
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
        public JArray CopyLines() => (JArray)document["lines"].DeepClone();

        public void SetCell(int x, int y, int z, JObject replacement) {
            var cells = (JArray)document["cells"];
            var existing = System.Linq.Enumerable.FirstOrDefault(cells,
                cell => (int)cell["x"] == x && (int)cell["y"] == y && (double)cell["z"] == z);
            Replace(cells, existing, replacement);
        }
        public void RemoveCell(int x,int y,int z) => SetCell(x,y,z,null);
        public void RestoreCellFrom(StationSaveV1 source,int x,int y,int z) {
            var cell=System.Linq.Enumerable.FirstOrDefault((JArray)source.document["cells"],
                c => (int)c["x"]==x && (int)c["y"]==y && (double)c["z"]==z) as JObject;
            if (cell==null) throw new ArgumentException("Source has no cell at this coordinate.");
            SetCell(x,y,z,cell);
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

        StationSaveV1(JObject document,int cells,int modules,StationRepairReport repairs) {
            this.document=document; DroppedCells=cells; DroppedModules=modules; Repairs=repairs;
        }

        /// <summary>The normalized, repaired state object, for the typed document reader.</summary>
        public string StateJson() => document.ToString(Formatting.None);

        /// <summary>
        /// The normalized, repaired state object itself. The typed reader projects this tree
        /// in place, so opening or editing a station does not serialize and re-parse the whole
        /// document a second time (plan 29 §3). Read-only by contract: nothing outside this
        /// type mutates it.
        /// </summary>
        internal JObject State => document;

        public static StationSaveV1 Read(string input) => Read(StationSaveCandidate.InspectV1(input));

        /// <summary>Read an already-parsed envelope (one parse for the whole load path).</summary>
        public static StationSaveV1 Read(JObject source) => Read(StationSaveCandidate.InspectV1(source));

        static StationSaveV1 Read(StationSaveCandidate candidate) {
            var state=candidate.Normalized;
            var modules=(JArray)state["modules"];
            for (int i=0;i<modules.Count;i++) {
                var mod=modules[i] as JObject ?? throw new FormatException("Invalid module");
                string type=(string)mod["type"];
                if (type=="sign") { modules[i]=JObject.Parse(StationSignRepair.NormalizeJson(mod.ToString(Formatting.None))); continue; }
            }
            // The three migrations the TypeScript load path applies after the grid
            // repair: ad posters, room furniture and bridge-owned pillar support.
            var repairs=StationModuleRepair.RepairDocument(state);
            return new StationSaveV1(state,candidate.DroppedCells,candidate.DroppedModules,repairs);
        }
        public string Write(DateTimeOffset savedAt) => WriteTree(savedAt).ToString(Formatting.None);

        /// <summary>
        /// The normalized v1 envelope as a parsed tree. The typed reader keeps it so a local
        /// edit can patch the committed save without re-serializing and re-parsing it
        /// (plan 30 §1). The tree is the save writer's own copy — <c>State</c> stays private —
        /// but a caller that patches it must clone it first, because the reader hands the same
        /// instance to <see cref="StationDocumentReader"/>.
        /// </summary>
        internal JObject WriteTree(DateTimeOffset savedAt) {
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
            return data;
        }
    }
}
