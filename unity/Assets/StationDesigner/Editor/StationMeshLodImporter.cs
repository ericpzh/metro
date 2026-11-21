using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using Unity.Pipeline.Commands;
using UnityEditor;
using UnityEngine;

namespace Metro.Editor {
    public static class StationMeshLodImporter {
        const string RuntimePrefabs = "Assets/StationDesigner/Generated/Prefabs/";
        const string ResourceRoot = "Assets/StationDesigner/Resources/";

        [MenuItem("Assets/Station Designer/Bake Rigid Model LODs", true)]
        static bool CanBakeSelected() => Selection.gameObjects.Any(IsRuntimePrefab);

        [MenuItem("Assets/Station Designer/Bake Rigid Model LODs")]
        static void BakeSelected() {
            foreach (var prefab in Selection.gameObjects.Where(IsRuntimePrefab)) BakeRigidPrefab(prefab);
        }

        [MenuItem("Metro/Station Game/Bake All Rigid Model LODs")]
        public static void BakeAllRigid() {
            foreach (var path in RuntimePrefabPaths()) {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab != null && IsRuntimePrefab(prefab)) BakeRigidPrefab(prefab);
            }
            AuditRigidCoverage();
        }

        [CliGroupCommand("metro", "Bake one generated rigid prefab's model LOD sidecar.",
            Effect = CommandEffect.Destructive, Tags = new[] { "assets" })]
        internal static ExitCode BakeRigidModelLod(
            CommandContext cmd, [CliArg("prefab", "Generated prefab name without extension.")] string prefabName) {
            var path = RuntimePrefabPaths().FirstOrDefault(candidate =>
                Path.GetFileNameWithoutExtension(candidate) == prefabName);
            if (path == null)
                throw new System.ArgumentException("Unknown generated rigid prefab: " + prefabName, nameof(prefabName));
            BakeRigidPrefab(AssetDatabase.LoadAssetAtPath<GameObject>(path));
            cmd.Log.Info("Baked model LODs for " + prefabName);
            return ExitCode.Success;
        }

        static IEnumerable<string> RuntimePrefabPaths() => AssetDatabase.GetAllAssetPaths()
            .Where(path => path.StartsWith(RuntimePrefabs, System.StringComparison.Ordinal) &&
                           path.EndsWith(".prefab") &&
                           !Path.GetFileName(path).StartsWith("Formation", System.StringComparison.Ordinal) &&
                           !IsLegacyFullTrain(Path.GetFileNameWithoutExtension(path)))
            .OrderBy(path => path, System.StringComparer.Ordinal);

        static bool IsLegacyFullTrain(string name) =>
            name == "TrainA" || name == "TrainB" || name == "TrainC" || name == "TrainD" || name == "TrainL";

        [MenuItem("Metro/Station Game/Audit Rigid Model LOD Coverage")]
        public static void AuditRigidCoverage() {
            var lines = new List<string> { "prefab,meshes,threeTiers,reused,unresolved,hasMeshSource" };
            foreach (var path in RuntimePrefabPaths()) {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null || !IsRuntimePrefab(prefab)) continue;
                var sources = prefab.GetComponentsInChildren<MeshFilter>(true)
                    .Select(filter => filter.sharedMesh).Where(mesh => mesh != null).Distinct().ToArray();
                var library = AssetDatabase.LoadAssetAtPath<StationRigidModelLods>(
                    ResourceRoot + StationRigidModelLods.ResourcesPath + prefab.name + ".asset");
                bool current = library != null && library.PrefabDependencyHash ==
                    AssetDatabase.GetAssetDependencyHash(path).ToString();
                int reduced = 0, reused = 0;
                foreach (var source in sources) {
                    if (!current) continue;
                    var row = library.Meshes.FirstOrDefault(entry => entry.Source == source);
                    if (row.Source == null) continue;
                    if (row.Baked == null && !string.IsNullOrEmpty(row.ReuseReason)) reused++;
                    else if (row.Baked != null && row.Baked.lodCount >= 3) reduced++;
                }
                lines.Add($"\"{path.Replace("\"", "\"\"")}\",{sources.Length},{reduced},{reused},{sources.Length - reduced - reused},{sources.Length != 0}");
            }
            const string output = "../.preview/unity/model-lod-rigid-coverage.csv";
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            File.WriteAllLines(output, lines);
            Debug.Log($"Recorded {lines.Count - 1} rigid prefabs in {Path.GetFullPath(output)}.");
        }

        static bool IsRuntimePrefab(GameObject prefab) {
            string path = AssetDatabase.GetAssetPath(prefab);
            return path.StartsWith(RuntimePrefabs, System.StringComparison.Ordinal) && path.EndsWith(".prefab") &&
                prefab.GetComponentInChildren<SkinnedMeshRenderer>(true) == null;
        }

        public static void BakeRigidPrefab(GameObject prefab) {
            if (prefab == null || !IsRuntimePrefab(prefab))
                throw new System.ArgumentException("Select a generated rigid station prefab.", nameof(prefab));
            var sources = prefab.GetComponentsInChildren<MeshFilter>(true)
                .Select(filter => filter.sharedMesh).Where(mesh => mesh != null).Distinct().ToArray();
            if (sources.Length == 0) return;
            string output = ResourceRoot + StationRigidModelLods.ResourcesPath;
            if (!Directory.Exists(output)) {
                Directory.CreateDirectory(output);
                AssetDatabase.Refresh();
            }
            string path = output + prefab.name + ".asset";
            var library = AssetDatabase.LoadAssetAtPath<StationRigidModelLods>(path);
            if (library == null) {
                library = ScriptableObject.CreateInstance<StationRigidModelLods>();
                AssetDatabase.CreateAsset(library, path);
            }
            var previous = library.Meshes;
            var entries = new List<StationRigidModelLods.Entry>();
            foreach (var source in sources) {
                var entry = new StationRigidModelLods.Entry { Source = source };
                if (source.isReadable && source.subMeshCount > 0 &&
                    Enumerable.Range(0, source.subMeshCount).All(sub => source.GetTopology(sub) == MeshTopology.Triangles)) {
                    var baked = Object.Instantiate(source);
                    baked.name = source.name;
                    GenerateBudgetedMeshLods(baked);
                    if (baked.lodCount <= 1) {
                        entry.ReuseReason = "Unity produced no simpler index buffer.";
                        Object.DestroyImmediate(baked);
                    }
                    else {
                        var existing = previous.FirstOrDefault(row => row.Source == source).Baked;
                        if (existing == null) {
                            AssetDatabase.AddObjectToAsset(baked, library);
                            entry.Baked = baked;
                        } else {
                            EditorUtility.CopySerialized(baked, existing);
                            entry.Baked = existing;
                            Object.DestroyImmediate(baked);
                        }
                    }
                } else if (source.subMeshCount > 0 && source.isReadable) {
                    entry.ReuseReason = "Preserve non-triangle topology.";
                }
                entries.Add(entry);
            }
            library.Meshes = entries.ToArray();
            library.PrefabDependencyHash = AssetDatabase.GetAssetDependencyHash(AssetDatabase.GetAssetPath(prefab)).ToString();
            EditorUtility.SetDirty(library);
            foreach (var entry in previous)
                if (entry.Baked != null && !entries.Any(row => row.Baked == entry.Baked))
                    Object.DestroyImmediate(entry.Baked, allowDestroyingAssets: true);
            AssetDatabase.SaveAssetIfDirty(library);
        }

        static void GenerateBudgetedMeshLods(Mesh mesh) {
            MeshLodUtility.GenerateMeshLods(mesh, 4);
            if (mesh.lodCount < 3) return;

            int low = mesh.lodCount - 1;

            // The first two ranges keep the existing High and Balanced geometry.
            // Read every submesh before changing the mesh-wide tier count.
            var tiers = new MeshLodRange[mesh.subMeshCount][];
            for (int sub = 0; sub < tiers.Length; sub++) {
                var ranges = mesh.GetLods(sub);
                tiers[sub] = new[] { ranges[0], ranges[1], ranges[low] };
            }
            mesh.lodCount = 3;
            for (int sub = 0; sub < tiers.Length; sub++)
                mesh.SetLods(tiers[sub], sub);
        }

        [CliGroupCommand("metro",
            "Write the Unity per-model LOD triangle inventory JSON (rigid prefabs, generated modules, runtime compacted train formations, and public stand-in passengers).",
            Effect = CommandEffect.ReadOnly, Tags = new[] { "tests" })]
        internal static ExitCode ModelLodInventory(
            CommandContext cmd,
            [CliArg("output-path", "Output JSON path; defaults to .preview/unity/model-lod-inventory.json.")] string outputPath = null) {
            string path = string.IsNullOrWhiteSpace(outputPath)
                ? Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".preview", "unity", "model-lod-inventory.json"))
                : Path.GetFullPath(outputPath);
            WriteModelLodInventory(path);
            cmd.Log.Info("Wrote Unity model LOD inventory to " + path);
            return ExitCode.Success;
        }

        [MenuItem("Metro/Station Game/Write Model LOD Inventory")]
        public static void WriteDefaultModelLodInventory() {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".preview", "unity", "model-lod-inventory.json"));
            WriteModelLodInventory(path);
            Debug.Log("Wrote Unity model LOD inventory to " + path);
        }

        static void AccumulateMeshTriangles(Mesh mesh, ref int lod0, ref int lod1, ref int lod2, ref int nonTriSubmeshes) {
            if (mesh == null) return;
            int maxLod = Mathf.Max(0, mesh.lodCount - 1);
            for (int sub = 0; sub < mesh.subMeshCount; sub++) {
                if (mesh.GetTopology(sub) != MeshTopology.Triangles) {
                    nonTriSubmeshes++;
                    continue;
                }
                lod0 += (int)(mesh.GetIndexCount(sub, 0) / 3);
                lod1 += (int)(mesh.GetIndexCount(sub, Mathf.Min(1, maxLod)) / 3);
                lod2 += (int)(mesh.GetIndexCount(sub, Mathf.Min(2, maxLod)) / 3);
            }
        }

        public static void WriteModelLodInventory(string outputPath) {
            var rigid = new JArray();
            foreach (var path in RuntimePrefabPaths()) {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null || !IsRuntimePrefab(prefab)) continue;
                var filters = prefab.GetComponentsInChildren<MeshFilter>(true);
                var sources = filters.Select(filter => filter.sharedMesh).Where(mesh => mesh != null).Distinct().ToArray();
                var library = AssetDatabase.LoadAssetAtPath<StationRigidModelLods>(
                    ResourceRoot + StationRigidModelLods.ResourcesPath + prefab.name + ".asset");
                bool current = library != null && library.PrefabDependencyHash ==
                    AssetDatabase.GetAssetDependencyHash(path).ToString();
                int reduced = 0, reused = 0;
                if (library != null) {
                    foreach (var source in sources) {
                        var row = library.Meshes.FirstOrDefault(entry => entry.Source == source);
                        if (row.Source == null) continue;
                        if (row.Baked == null && !string.IsNullOrEmpty(row.ReuseReason)) reused++;
                        else if (row.Baked != null && row.Baked.lodCount >= 3) reduced++;
                    }
                }
                int lod0 = 0, lod1 = 0, lod2 = 0, nonTri = 0, filterCount = 0;
                foreach (var filter in filters) {
                    var source = filter.sharedMesh;
                    if (source == null) continue;
                    filterCount++;
                    var resolved = library != null ? library.Resolve(source) : source;
                    AccumulateMeshTriangles(resolved, ref lod0, ref lod1, ref lod2, ref nonTri);
                }
                rigid.Add(new JObject {
                    ["name"] = prefab.name,
                    ["prefab"] = path,
                    ["meshFilters"] = filterCount,
                    ["distinctMeshes"] = sources.Length,
                    ["threeTiers"] = reduced,
                    ["reused"] = reused,
                    ["unresolved"] = sources.Length - reduced - reused,
                    ["lod0"] = lod0,
                    ["lod1"] = lod1,
                    ["lod2"] = lod2,
                    ["nonTriangleSubmeshes"] = nonTri,
                });
            }

            var generated = new JArray();
            // 1. Round pillar (1x3 m, 32/16/8 segments)
            {
                var root = new GameObject("lod-probe-pillar");
                var material = new Material(Shader.Find("Hidden/InternalErrorShader"));
                var meshes = new List<Mesh>();
                try {
                    var parts = new StructureParts();
                    parts.Cylinder(material, Vector3.zero, 1f, 3f, 32);
                    parts.Emit(root.transform, meshes, "pillar");
                    int l0 = 0, l1 = 0, l2 = 0, nt = 0;
                    foreach (var m in meshes) AccumulateMeshTriangles(m, ref l0, ref l1, ref l2, ref nt);
                    generated.Add(new JObject {
                        ["name"] = "pillar-round (1×3 m)",
                        ["type"] = "pillar",
                        ["lod0"] = l0, ["lod1"] = l1, ["lod2"] = l2,
                        ["note"] = "Closed 32 / 16 / 8 segment cylinder",
                    });
                } finally {
                    foreach (var m in meshes) Object.DestroyImmediate(m);
                    Object.DestroyImmediate(root);
                    Object.DestroyImmediate(material);
                }
            }
            // 2. Track (24 m, 3-cell span, third-rail and catenary)
            foreach (bool catenary in new[] { false, true }) {
                var run = RailRunGeometry.Build(24, 3, 1f, 0, catenary: catenary);
                var meshes = new[] {
                    run.Bed.ToMesh("bed"),
                    run.Deck.ToMesh("deck"),
                    run.Steel.ToMesh("steel"),
                    run.Dark.ToMesh("dark"),
                    run.Power.ToMesh("power"),
                    run.Insulator.ToMesh("insulator"),
                    run.Panel.ToMesh("panel"),
                };
                try {
                    int l0 = 0, l1 = 0, l2 = 0, nt = 0;
                    foreach (var m in meshes) AccumulateMeshTriangles(m, ref l0, ref l1, ref l2, ref nt);
                    generated.Add(new JObject {
                        ["name"] = catenary ? "track-24m (catenary)" : "track-24m (third-rail)",
                        ["type"] = "track",
                        ["lod0"] = l0, ["lod1"] = l1, ["lod2"] = l2,
                        ["note"] = "Rail heads and sleepers retained; fasteners/clips drop at LOD1/LOD2",
                    });
                } finally {
                    foreach (var m in meshes) if (m != null) Object.DestroyImmediate(m);
                }
            }
            // 3. Booths (3x3 m ticket & info)
            {
                var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
                var mats = new StationMaterials(shader);
                try {
                    foreach (string kind in new[] { "ticket", "info" }) {
                        var root = new GameObject("lod-probe-booth-" + kind);
                        var owned = new List<Mesh>();
                        try {
                            var facts = ModuleFactsReader.Read(new JObject {
                                ["id"] = "booth-" + kind, ["type"] = "booth",
                                ["x"] = 0, ["y"] = 0, ["z"] = 0, ["w"] = 3, ["h"] = 3, ["rot"] = 0,
                                ["cfg"] = new JObject { ["kind"] = kind, ["stocked"] = true, ["front"] = 0 },
                            });
                            if (BoothModuleViews.TryBuild(facts, root.transform, mats, out var view, out _)) {
                                int l0 = 0, l1 = 0, l2 = 0, nt = 0;
                                foreach (var f in view.GetComponentsInChildren<MeshFilter>(true)) {
                                    if (f.sharedMesh != null) {
                                        AccumulateMeshTriangles(f.sharedMesh, ref l0, ref l1, ref l2, ref nt);
                                        if (f.sharedMesh != BoothModuleViews.Cube()) owned.Add(f.sharedMesh);
                                    }
                                }
                                generated.Add(new JObject {
                                    ["name"] = "booth-" + kind + " (3×3 m)",
                                    ["type"] = "booth",
                                    ["lod0"] = l0, ["lod1"] = l1, ["lod2"] = l2,
                                    ["note"] = "Low retains the counter, fascia and glazing; small fittings, posts and recess trim are omitted",
                                });
                            }
                        } finally {
                            Object.DestroyImmediate(root);
                            foreach (var m in owned.Distinct()) if (m != null) Object.DestroyImmediate(m);
                        }
                    }
                } finally {
                    for (int i = 0; i < StationMaterials.Colours.Length; i++)
                        if (mats[i] != null) Object.DestroyImmediate(mats[i]);
                }
            }

            // 4. Runtime compacted train formations (all 50 Formation*.prefab assets)
            var trains = new JArray();
            var compactMethod = typeof(TrainConsistViews).GetMethod("CompactConsistInstance",
                BindingFlags.Static | BindingFlags.NonPublic);
            var formationPaths = AssetDatabase.GetAllAssetPaths()
                .Where(p => p.StartsWith(RuntimePrefabs, System.StringComparison.Ordinal) &&
                            p.EndsWith(".prefab") &&
                            Path.GetFileName(p).StartsWith("Formation", System.StringComparison.Ordinal))
                .OrderBy(p => p, System.StringComparer.Ordinal)
                .ToArray();
            foreach (var fPath in formationPaths) {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(fPath);
                if (prefab == null) continue;
                var instance = Object.Instantiate(prefab);
                var owned = new List<Mesh>();
                try {
                    if (compactMethod != null) {
                        var cache = System.Activator.CreateInstance(compactMethod.GetParameters()[2].ParameterType);
                        compactMethod.Invoke(null, new object[] { instance, prefab.name, cache, owned, null });
                    }
                    int l0 = 0, l1 = 0, l2 = 0, nt = 0;
                    foreach (var f in instance.GetComponentsInChildren<MeshFilter>(true)) {
                        var r = f.GetComponent<MeshRenderer>();
                        if (r == null || !r.enabled) continue;
                        AccumulateMeshTriangles(f.sharedMesh, ref l0, ref l1, ref l2, ref nt);
                    }
                    trains.Add(new JObject {
                        ["name"] = prefab.name,
                        ["prefab"] = fPath,
                        ["lod0"] = l0,
                        ["lod1"] = l1,
                        ["lod2"] = l2,
                    });
                } finally {
                    Object.DestroyImmediate(instance);
                    foreach (var m in owned) if (m != null) Object.DestroyImmediate(m);
                }
            }

            // 5. Public stand-in passengers
            var standInPassengers = new JArray();
            foreach (var pPath in new[] {
                "Assets/StationDesigner/Generated/Models/passenger-adult.glb",
                "Assets/StationDesigner/Generated/Models/soft-human-adult-commuter-daypack-low.glb",
            }) {
                var meshes = AssetDatabase.LoadAllAssetsAtPath(pPath).OfType<Mesh>().ToArray();
                if (meshes.Length == 0) continue;
                int l0 = 0, l1 = 0, l2 = 0, nt = 0;
                foreach (var m in meshes) AccumulateMeshTriangles(m, ref l0, ref l1, ref l2, ref nt);
                standInPassengers.Add(new JObject {
                    ["name"] = Path.GetFileNameWithoutExtension(pPath),
                    ["path"] = pPath,
                    ["meshes"] = meshes.Length,
                    ["lod0"] = l0, ["lod1"] = l1, ["lod2"] = l2,
                });
            }

            var rootObj = new JObject {
                ["schemaVersion"] = 1,
                ["unityVersion"] = Application.unityVersion,
                ["rigidPrefabs"] = rigid,
                ["generatedModules"] = generated,
                ["trains"] = trains,
                ["publicPassengers"] = standInPassengers,
            };
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
            File.WriteAllText(outputPath, rootObj.ToString(Newtonsoft.Json.Formatting.Indented) + "\n");
        }

    }
}
