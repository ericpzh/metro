using System;
using System.Collections.Generic;
using System.Linq;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App {
    // Save (x,y,z) uses plan coordinates followed by elevation.
    sealed class ZooGeometry : IDisposable {
        [Serializable] public sealed class Footprint {
            public string id;
            public int x, y, w, d;
        }

        readonly Transform root;
        readonly Mesh cube;
        readonly StationMaterials materials;
        readonly List<Mesh> meshes = new List<Mesh>();
        readonly Dictionary<(int x, int y, int elevation, int colour), List<CombineInstance>> batches =
            new Dictionary<(int, int, int, int), List<CombineInstance>>();
        readonly HashSet<GameObject> removedCells = new HashSet<GameObject>();
        readonly Dictionary<(int,int,int), GameObject> editableCells = new Dictionary<(int,int,int), GameObject>();
        readonly List<(GameObject obj, float elevation)> objects = new List<(GameObject, float)>();
        readonly Dictionary<string, GameObject> views = new Dictionary<string, GameObject>(StringComparer.Ordinal);
        readonly Dictionary<string, int> unresolved = new Dictionary<string, int>(StringComparer.Ordinal);
        readonly HashSet<string> visualKeys = new HashSet<string>(StringComparer.Ordinal);
        ModuleFacts[] modules = Array.Empty<ModuleFacts>();
        Metro.View.RuntimeCatalogue catalogue;
        static bool DefaultSolid(int x, int y, int z) => false;
        Func<int,int,int,bool> solids = DefaultSolid;
        TrainFacts line;
        readonly List<ModuleMotion> motions = new List<ModuleMotion>();

        /// <summary>Families drawn as chunk-batched shapes instead of one prefab instance each.</summary>
        static readonly HashSet<string> BatchedTypes = new HashSet<string>(StringComparer.Ordinal) {
            "sidewalk", "lawn", "tactile", "floor-mark",
        };

        public int PrefabViews { get; private set; }
        public int BatchedViews { get; private set; }
        public int LiveViews { get; private set; }
        public int GeneratedViews { get; private set; }
        public int FallbackViews { get; private set; }
        public int UnresolvedViews { get; private set; }
        public IEnumerable<string> VisualKeys => visualKeys.OrderBy(key => key, StringComparer.Ordinal);
        public IReadOnlyDictionary<string, int> Unresolved => unresolved;

        public ZooGeometry(Transform parent, StationMaterials materials, Mesh cube) {
            root = new GameObject("Authored geometry").transform;
            root.SetParent(parent, false);
            this.cube = cube;
            this.materials = materials;
        }

        public static Vector3 Position(JToken record, float rise = 0) =>
            new Vector3((float)record["x"] + .5f, (float)record["z"] + rise, (float)record["y"] + .5f);

        void Box(Vector3 center, Vector3 size, int colour, int elevation, Quaternion rotation = default) {
            var key = (Mathf.FloorToInt(center.x / 16), Mathf.FloorToInt(center.z / 16), elevation, colour);
            if (!batches.TryGetValue(key, out var boxes)) batches.Add(key, boxes = new List<CombineInstance>());
            boxes.Add(new CombineInstance { mesh = cube, transform = Matrix4x4.TRS(center,
                rotation == default ? Quaternion.identity : rotation, size) });
        }

        public void Build(JArray cells, ModuleFacts[] facts, Dictionary<string, Footprint> footprints,
            Metro.View.RuntimeCatalogue catalogue, string editGate, Vector3Int editFloor,
            Func<int,int,int,bool> editable, Func<int,int,int,bool> solids, TrainFacts line) {
            this.catalogue = catalogue;
            this.solids = solids ?? DefaultSolid;
            this.line = line;
            motions.Clear();
            modules = facts ?? Array.Empty<ModuleFacts>();
            PrefabViews = LiveViews = GeneratedViews = BatchedViews = FallbackViews = UnresolvedViews = 0;
            visualKeys.Clear();
            unresolved.Clear();
            views.Clear();
            foreach (var cell in cells.Where(c => (string)c["fill"] == "solid")) {
                var position = Position(cell, .5f);
                var x = (int)cell["x"];
                var y = (int)cell["y"];
                var z = (int)cell["z"];
                if (editFloor == new Vector3Int(x, y, z)) continue;
                var finish = (string)cell["finish"]?["top"];
                bool wall = cell["tags"]?.Any(tag => (string)tag == "wall") == true;
                int colour = wall ? 1 : finish == "floor.soil" ? 11 : finish == "floor.track" ? 5 :
                    (string)cell["zone"] == "platform" ? 2 : 0;
                if (editable(x,y,z)) {
                    var obj = new GameObject("Editable floor", typeof(MeshFilter), typeof(MeshRenderer));
                    obj.transform.SetParent(root, false);
                    obj.transform.position = position;
                    obj.GetComponent<MeshFilter>().sharedMesh = cube;
                    obj.GetComponent<MeshRenderer>().sharedMaterial = materials[colour];
                    editableCells.Add((x,y,z), obj);
                    objects.Add((obj,z));
                    continue;
                }
                Box(position, Vector3.one, colour, z);
            }
            foreach (var module in modules) {
                if (module.Id == editGate) continue;
                footprints.TryGetValue(module.Id, out var footprint);
                RenderModule(module, footprint);
            }
            foreach (var entry in batches) {
                var key = entry.Key;
                var mesh = new Mesh { name = "Zoo geometry chunk", indexFormat = IndexFormat.UInt32 };
                mesh.CombineMeshes(entry.Value.ToArray());
                meshes.Add(mesh);
                var obj = new GameObject($"Chunk {key.x},{key.y} / {key.elevation}", typeof(MeshFilter), typeof(MeshRenderer));
                obj.transform.SetParent(root, false);
                obj.GetComponent<MeshFilter>().sharedMesh = mesh;
                obj.GetComponent<MeshRenderer>().sharedMaterial = materials[key.colour];
                objects.Add((obj, key.elevation));
            }
            batches.Clear();
        }

        /// <summary>
        /// A hung module stores the top course of its storey, so its origin is the
        /// ceiling plane; the promoted wrappers author the piece hanging below a
        /// four-metre ceiling instead, so align the wrapper's top with that plane.
        /// </summary>
        void AlignHanging(GameObject instance, ModuleFacts module) {
            if (!module.CeilingAnchored) return;
            var renderers = instance.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return;
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
            // Only a piece authored entirely above its origin hangs; a floor-standing
            // variant of the same family starts at the ground and must stay there.
            if (bounds.min.y - instance.transform.position.y <= .5f) return;
            float rise = bounds.max.y - instance.transform.position.y;
            if (rise <= 0.01f) return;
            instance.transform.position -= Vector3.up * rise;
        }

        void CollectMotions(GameObject instance) {
            foreach (var motion in instance.GetComponentsInChildren<ModuleMotion>(true)) motions.Add(motion);
        }

        /// <summary>Drive every state-driven part from the published simulation state.</summary>
        public void ApplyMotion(float seconds, bool doorsOpen, int directionSign) {
            float door = doorsOpen ? 1f : 0f;
            foreach (var motion in motions) if (motion) motion.Apply(seconds, door, directionSign);
        }

        /// <summary>Show or hide one module's resolved view (the service gate's own toggling).</summary>
        public bool SetModuleVisible(string id, bool present) {
            if (!views.TryGetValue(id, out var obj)) return false;
            obj.SetActive(present);
            return true;
        }

        public bool TryGetView(string id, out GameObject obj) => views.TryGetValue(id, out obj);

        /// <summary>The resolved view key for a module id, for diagnostics and picking readouts.</summary>
        public string ViewKey(string id) {
            if (catalogue == null) return "";
            foreach (var module in modules) if (module.Id == id) return ModuleViews.Resolve(module, modules, catalogue).Key;
            return "";
        }

        void RenderModule(ModuleFacts module, Footprint footprint) {
            var visual = ModuleViews.Resolve(module, modules, catalogue);
            if (visual.Key.Length > 0) visualKeys.Add(visual.Key);
            // A back-to-back TV pair is one housing: the second half draws nothing.
            if (visual.Kind == ModuleViewKind.None) return;
            // B1: trees and fences instantiate their promoted prefab. They must never reach
            // the batched-shape path; a record with no usable prefab is a diagnostic, not a box.
            if (OutdoorModuleViews.Owns(module.Type)) {
                RuntimeCatalogue.Entry outdoorEntry = null;
                if (catalogue != null && visual.Key.Length > 0) catalogue.TryGet(visual.Key, out outdoorEntry);
                var holder = new GameObject(module.Id + " pivot").transform;
                holder.SetParent(root, false);
                if (outdoorEntry != null && outdoorEntry.prefab != null)
                    holder.SetPositionAndRotation(ModulePlacement.Position(module, outdoorEntry),
                        ModulePlacement.Rotation(module.Rotation));
                var request = new OutdoorModuleRequest {
                    ModuleId = module.Id, Type = module.Type, ViewKey = visual.Key,
                    Variant = module.Config.Text("variant"), Mount = module.Config.Text("mount"),
                    ConfigJson = "", DimensionsJson = module.Width + "x" + module.Depth,
                    X = module.X, Y = module.Y, Z = module.Z, Rotation = module.Rotation,
                    Width = module.Width, Depth = module.Depth,
                    Prefab = outdoorEntry?.prefab, Catalogue = catalogue,
                    Placement = OutdoorPlacement.ParentPlaced,
                    // Fence runs read their neighbours; without them the builder falls back to rot.
                    Neighbours = OutdoorModuleViews.Neighbours(module, modules),
                };
                if (OutdoorModuleViews.TryBuild(request, holder, null, out var outdoor)) {
                    views[module.Id] = outdoor.Instance;
                    objects.Add((outdoor.Instance, module.Z));
                    PrefabViews++;
                    return;
                }
                FallbackViews++;
                UnresolvedViews++;
                var outdoorSignature = ModuleViews.Signature(module) + " -> " + (visual.Key.Length > 0 ? visual.Key : visual.Detail);
                unresolved[outdoorSignature] = unresolved.TryGetValue(outdoorSignature, out var outdoorSeen) ? outdoorSeen + 1 : 1;
                UnityEngine.Object.Destroy(holder.gameObject);
                return;
            }
            // Ground and run families batch into their chunk instead of instancing a
            // prefab per cell; the resolved key is still the catalogue's.
            if (BatchedTypes.Contains(module.Type)) {
                BatchedViews++;
                BatchedShape(module, footprint);
                return;
            }
            if (catalogue != null && visual.HasModel && catalogue.TryGet(visual.Key, out var entry)) {
                if (entry.kind == "generated") {
                    if (RuntimeAssemblies.TryBuild(entry.generator, module, modules, root, cube, materials, solids, this.line, out var assembly)) {
                        assembly.name = module.Id;
                        CollectMotions(assembly);
                        views[module.Id] = assembly;
                        objects.Add((assembly, module.Z));
                        GeneratedViews++;
                        return;
                    }
                } else if (entry.prefab) {
                    var instance = UnityEngine.Object.Instantiate(entry.prefab, root);
                    instance.name = module.Id;
                    var placement = ModulePlacement.Position(module, entry);
                    // psd-end panels carry an authored in-cell offset (sim/psdEnds.ts).
                    if (module.Type == "psd-end" && module.Config.TryNumbers("offset", out var offset) && offset.Length >= 2)
                        placement += ModulePlacement.Rotation(module.Rotation) * new Vector3((float)offset[0], 0f, (float)offset[1]);
                    instance.transform.SetPositionAndRotation(placement, ModulePlacement.Rotation(module.Rotation));
                    RuntimeAssemblies.PrepareImported(instance);
                    AlignHanging(instance, module);
                    RuntimeAssemblies.BindImported(instance, entry.key, module);
                    CollectMotions(instance);
                    views[module.Id] = instance;
                    objects.Add((instance, module.Z));
                    if (entry.kind == "live") LiveViews++; else PrefabViews++;
                    return;
                }
            }
            // Explicit fallback: one visual per module id, never a model and its box.
            FallbackViews++;
            if (visual.Kind == ModuleViewKind.Unresolved) UnresolvedViews++;
            var signature = ModuleViews.Signature(module) + " -> " + (visual.Key.Length > 0 ? visual.Key : visual.Detail);
            unresolved[signature] = unresolved.TryGetValue(signature, out var count) ? count + 1 : 1;
            BatchedShape(module, footprint);
        }

        void BatchedShape(ModuleFacts module, Footprint footprint) {
            string type = module.Type;
            int elevation = module.Z;
            var anchor = new Vector3(module.X + .5f, elevation + 1f, module.Y + .5f);
            var rotation = ModulePlacement.Rotation(module.Rotation);
            var cfg = module.Config;
            var center = footprint == null ? anchor : new Vector3(footprint.x + footprint.w / 2f, anchor.y,
                footprint.y + footprint.d / 2f);
            float width = footprint?.w ?? module.Width, depth = footprint?.d ?? module.Depth;
            void Shape(float height, int colour, float rise = 0, float inset = 0) =>
                Box(center + Vector3.up * (rise + height / 2), new Vector3(width - inset, height, depth - inset), colour, elevation);
            switch (type) {
                case "track":
                    Shape(.17f, 5, -.44f);
                    bool alongX = width >= depth;
                    foreach (float side in new[] { -.74f, .74f })
                        Box(center + (alongX ? Vector3.forward : Vector3.right) * side + Vector3.down * .24f,
                            new Vector3(alongX ? width : .09f, .13f, alongX ? .09f : depth), 6, elevation);
                    break;
                case "platform-edge":
                    Shape(.10f, 8);
                    // Low strip keeps the train and boarding point visible in the cutaway.
                    Shape(.32f, 10, .10f, .72f);
                    break;
                case "road": Shape(.06f, 5, -.05f); break;
                case "sidewalk": Shape(.08f, 2, -.06f); break;
                case "lawn": Shape(.08f, 3, -.06f); break;
                case "stair":
                case "escalator":
                    var flights = Flights(module);
                    if (flights == null) Ramp(anchor, anchor + Vector3.forward, type, width);
                    else {
                        foreach (var flight in flights) Ramp(flight.from, flight.to, type, (float)cfg.Number("width", .85f));
                        for (int i = 1; i < flights.Count; i++)
                            Box((flights[i-1].to + flights[i].from) / 2 - Vector3.up * .1f,
                                new Vector3(Mathf.Abs(flights[i-1].to.x - flights[i].from.x) + 1, .2f,
                                    Mathf.Abs(flights[i-1].to.z - flights[i].from.z) + 1), 2, elevation);
                    }
                    break;
                case "walkway": Ramp(anchor, anchor + rotation * Vector3.forward, type, width); break;
                case "lift":
                    Shape(Mathf.Abs(module.Y - module.Y) + .9f, 10, 1.2f, .2f);
                    break;
                case "hanger":
                    Shape(.2f, 10, 3.6f, .9f);
                    break;
                default:
                    // A missing catalogue entry must stay visible: a neutral box marks the cell.
                    Shape(.72f, 6, 0, .23f);
                    break;
            }
        }

        struct Flight { public Vector3 from, to; }

        List<Flight> Flights(ModuleFacts module) {
            var json = module.Config.Json("flights");
            if (string.IsNullOrEmpty(json)) return null;
            JArray array;
            try { array = JArray.Parse(json); } catch { return null; }
            var flights = new List<Flight>();
            foreach (var item in array) {
                flights.Add(new Flight { from = Position(item["from"], 1), to = Position(item["to"], 1) });
            }
            return flights.Count > 0 ? flights : null;
        }

        void Ramp(Vector3 a, Vector3 b, string type, float width) {
            var delta = b - a;
            var flat = new Vector3(delta.x, 0, delta.z);
            if (flat.sqrMagnitude < .001f) return;
            var rotation = Quaternion.LookRotation(flat);
            int steps = Mathf.CeilToInt(flat.magnitude * 3);
            float length = flat.magnitude / steps;
            for (int i = 0; i < steps; i++) {
                var center = Vector3.Lerp(a, b, (i + .5f) / steps);
                Box(center - Vector3.up * .13f, new Vector3(width, .26f, length + .01f), 2, Mathf.RoundToInt(center.y - 1), rotation);
                if (type == "escalator")
                    foreach (float side in new[] { -.49f, .49f })
                        Box(center + rotation * Vector3.right * side + Vector3.up * .22f,
                            new Vector3(.11f, .68f, length + .04f), 10, Mathf.RoundToInt(center.y - 1), rotation);
            }
        }

        public void SetEditableCell(int x, int y, int z, bool present, int level, JObject authored) {
            if (!editableCells.TryGetValue((x,y,z), out var obj)) {
                obj = new GameObject("Editable floor", typeof(MeshFilter), typeof(MeshRenderer));
                obj.transform.SetParent(root, false);
                obj.transform.position = new Vector3(x + .5f, z + .5f, y + .5f);
                obj.GetComponent<MeshFilter>().sharedMesh = cube;
                var finish = (string)authored["finish"]?["top"];
                bool wall = authored["tags"]?.Any(tag => (string)tag == "wall") == true;
                int colour = wall ? 1 : finish == "floor.soil" ? 11 : finish == "floor.track" ? 5 :
                    (string)authored["zone"] == "platform" ? 2 : 0;
                obj.GetComponent<MeshRenderer>().sharedMaterial = materials[colour];
                editableCells.Add((x,y,z),obj);
                objects.Add((obj,z));
            }
            if (present) removedCells.Remove(obj); else removedCells.Add(obj);
            obj.SetActive(present && z <= level + 2);
        }

        public void ShowThrough(int level) {
            foreach (var entry in objects) entry.obj.SetActive(entry.elevation <= level + 2 && !removedCells.Contains(entry.obj));
        }

        public void Dispose() {
            root.gameObject.SetActive(false);
            UnityEngine.Object.Destroy(root.gameObject);
            foreach (var mesh in meshes) UnityEngine.Object.Destroy(mesh);

        }
    }
}
