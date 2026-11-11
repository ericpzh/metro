using System;
using System.Collections.Generic;
using System.Linq;
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
        readonly Material[] materials;
        readonly List<Mesh> meshes = new List<Mesh>();
        readonly Dictionary<(int x, int y, int elevation, int colour), List<CombineInstance>> batches =
            new Dictionary<(int, int, int, int), List<CombineInstance>>();
        readonly List<(GameObject obj, float elevation)> objects = new List<(GameObject, float)>();
        static readonly Color32[] Colours = {
            new Color32(184,185,178,255), new Color32(141,151,153,255), new Color32(219,212,195,255),
            new Color32(79,113,67,255), new Color32(93,106,110,255), new Color32(61,69,76,255),
            new Color32(181,192,195,255), new Color32(42,107,118,255), new Color32(217,169,61,255),
            new Color32(139,77,59,255), new Color32(79,140,148,255), new Color32(83,60,49,255),
            new Color32(75,120,58,255), new Color32(215,227,225,255)
        };

        public ZooGeometry(Transform parent, Shader shader, Mesh cube) {
            root = new GameObject("Authored geometry").transform;
            root.SetParent(parent, false);
            this.cube = cube;
            materials = Colours.Select(colour => new Material(shader) { color = colour }).ToArray();
        }

        public static Vector3 Position(JToken record, float rise = 0) =>
            new Vector3((float)record["x"] + .5f, (float)record["z"] + rise, (float)record["y"] + .5f);

        void Box(Vector3 center, Vector3 size, int colour, int elevation, Quaternion rotation = default) {
            var key = (Mathf.FloorToInt(center.x / 16), Mathf.FloorToInt(center.z / 16), elevation, colour);
            if (!batches.TryGetValue(key, out var boxes)) batches.Add(key, boxes = new List<CombineInstance>());
            boxes.Add(new CombineInstance { mesh = cube, transform = Matrix4x4.TRS(center,
                rotation == default ? Quaternion.identity : rotation, size) });
        }

        public void Build(JArray cells, JArray modules, Dictionary<string, Footprint> footprints,
            GameObject bench, GameObject bin, string editGate, Vector3Int editFloor) {
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
                Box(position, Vector3.one, colour, z);
            }
            foreach (var module in modules) {
                var id = (string)module["id"];
                if (id == editGate) continue;
                footprints.TryGetValue(id, out var footprint);
                RenderModule(module, footprint, bench, bin);
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

        void RenderModule(JToken module, Footprint footprint, GameObject bench, GameObject bin) {
            string type = (string)module["type"];
            int elevation = (int)module["z"];
            var anchor = Position(module, 1);
            int rot = (int?)module["rot"] ?? 0;
            var rotation = Quaternion.Euler(0, rot * 90, 0);
            var center = footprint == null ? anchor : new Vector3(footprint.x + footprint.w / 2f, anchor.y,
                footprint.y + footprint.d / 2f);
            float width = footprint?.w ?? 1, depth = footprint?.d ?? 1;
            var cfg = module["cfg"];
            if ((type == "bench" && (string)cfg?["variant"] == "steel-2" && bench) || (type == "bin" && bin)) {
                var obj = UnityEngine.Object.Instantiate(type == "bench" ? bench : bin, center, rotation, root);
                obj.name = (string)module["id"];
                objects.Add((obj, elevation));
                return;
            }
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
                case "tree":
                    Box(anchor + Vector3.up * 1.1f, new Vector3(.24f, 2.2f, .24f), 11, elevation);
                    Box(anchor + Vector3.up * 2.8f, new Vector3(2.3f, 2.4f, 2.3f), 12, elevation, Quaternion.Euler(0, rot * 90 + 30, 0));
                    break;
                case "stair":
                case "escalator":
                    var flights = cfg?["flights"] as JArray;
                    if (flights == null) Ramp(module, type, elevation, (float?)cfg?["width"] ?? .85f);
                    else {
                        foreach (var flight in flights) Ramp(flight, type, elevation, (float?)cfg?["width"] ?? .85f);
                        for (int i = 1; i < flights.Count; i++) {
                            var from = Position(flights[i-1]["to"], 1);
                            var to = Position(flights[i]["from"], 1);
                            Box((from + to) / 2 - Vector3.up * .1f,
                                new Vector3(Mathf.Abs(from.x - to.x) + 1, .2f, Mathf.Abs(from.z - to.z) + 1), 2, elevation);
                        }
                    }
                    break;
                case "lift":
                    Shape(Mathf.Abs((float)module["to"]["z"] - (float)module["from"]["z"]) + 1.2f, 10, 0, .2f);
                    break;
                case "exit":
                    foreach (float side in new[] { -.42f, .42f })
                        Box(anchor + rotation * new Vector3(side, .55f, 0), new Vector3(.12f, 1.1f, 1.4f), 7, elevation, rotation);
                    Box(anchor + Vector3.up * 1.1f, new Vector3(.95f, .18f, .23f), 7, elevation, rotation);
                    break;
                case "fence": case "glass": case "door": case "psd-end":
                    Box(center + Vector3.up * .55f,
                        new Vector3(width > 1 ? width : rot % 2 == 0 ? .94f : .11f, 1.1f,
                            depth > 1 ? depth : rot % 2 == 0 ? .11f : .94f), 10, elevation);
                    break;
                case "gate":
                    Box(anchor + Vector3.up * .52f, new Vector3(.78f, 1.04f, .32f), 7, elevation, rotation);
                    break;
                case "bench": Shape(.50f, 6, 0, .52f); break;
                case "bin": Shape(.85f, 7, 0, .54f); break;
                case "tactile": case "floor-mark": Shape(.035f, 8, 0, .08f); break;
                case "sign": case "billboard": case "tv": case "calligraphy": case "linemap": case "monitor":
                    Box(center + Vector3.up * 1.5f,
                        new Vector3(width > 1 ? width : rot % 2 == 0 ? .75f : .09f, .58f,
                            depth > 1 ? depth : rot % 2 == 0 ? .09f : .75f), 7, elevation);
                    break;
                case "light": case "vent": case "cctv": case "clock": Shape(.13f, 13, 2.4f, .6f); break;
                case "tvm": case "vending": case "electrical-cabinet": case "cubicle": case "shelf": Shape(1.55f, 7, 0, .24f); break;
                case "extinguisher": Shape(.56f, 9, .15f, .68f); break;
                default: Shape(.72f, 6, 0, .23f); break;
            }
        }

        void Ramp(JToken flight, string type, int elevation, float width) {
            var a = Position(flight["from"], 1);
            var b = Position(flight["to"], 1);
            var delta = b - a;
            var flat = new Vector3(delta.x, 0, delta.z);
            if (flat.sqrMagnitude < .001f) return;
            var rotation = Quaternion.LookRotation(flat);
            int steps = Mathf.CeilToInt(flat.magnitude * 3);
            float length = flat.magnitude / steps;
            for (int i = 0; i < steps; i++) {
                var center = Vector3.Lerp(a, b, (i + .5f) / steps);
                Box(center - Vector3.up * .13f, new Vector3(width, .26f, length + .01f), 2, elevation, rotation);
                if (type == "escalator")
                    foreach (float side in new[] { -.49f, .49f })
                        Box(center + rotation * Vector3.right * side + Vector3.up * .22f,
                            new Vector3(.11f, .68f, length + .04f), 10, elevation, rotation);
            }
        }

        public void ShowThrough(int level) {
            foreach (var entry in objects) entry.obj.SetActive(entry.elevation <= level + 2);
        }

        public void Dispose() {
            root.gameObject.SetActive(false);
            UnityEngine.Object.Destroy(root.gameObject);
            foreach (var mesh in meshes) UnityEngine.Object.Destroy(mesh);
            foreach (var material in materials) UnityEngine.Object.Destroy(material);
        }
    }
}
