using System.Collections.Generic;
using System.IO;
using System.Linq;
using Metro.App;
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
                    MeshLodUtility.GenerateMeshLods(baked, 2);
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

    }
}
