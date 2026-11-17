using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Metro.View;
using UnityEditor;
using UnityEngine;

namespace Metro.Editor {
    /// <summary>
    /// Builds the serialized <see cref="RuntimeCatalogue"/> from the explicit runtime
    /// view mapping and the promoted recipe catalogue. Recipe parsing and
    /// <c>AssetDatabase</c> stay in the Editor: player code only reads the resulting
    /// asset's prefab references.
    ///
    ///   Metro.Editor.RuntimeCatalogue.Generate    (batch entry point, writes the asset)
    ///   Metro.Editor.RuntimeCatalogue.Validate    (validation-only entry point)
    /// </summary>
    public static class RuntimeCatalogue {
        public const string RecipesFolder = "asset-recipes";
        public const string ViewsFileName = "runtime-views.json";
        public const string RecipesFileName = "catalogue.json";

        [Serializable] sealed class ViewsFile { public int schemaVersion; public ViewRow[] views; }
        [Serializable] sealed class ViewRow {
            public string key, kind, prefab, generator, binding, recipeId, status, city, part;
            public float[] offset;
            public int cells;
            public bool palette;
        }
        [Serializable] sealed class RecipesFile { public int schemaVersion; public RecipeRow[] families; }
        [Serializable] sealed class RecipeRow { public string id; public Promoted promoted; }
        [Serializable] sealed class Promoted { public string prefab; }
        [Serializable] sealed class PrefabProbe { public string prefab, body; public float bodyX, bodyY, bodyZ, minX, minY, minZ, maxX, maxY, maxZ; }
        [Serializable] sealed class CatalogueReport {
            public string generatedAt;
            public int entries, palette, prefab, generated, live;
            public string[] missingPrefabs;
            public PrefabProbe[] probes;
        }

        static string ProjectRoot => Path.GetFullPath(Path.Combine(Application.dataPath, ".."));

        /// <summary>
        /// The checked-in recipe folder. A batch project is a copy of Assets, Packages and
        /// ProjectSettings, often two or three levels below the repository, so the folder
        /// is found by walking up from the project instead of assuming a fixed depth.
        /// </summary>
        static string RecipesPath {
            get {
                var directory = new DirectoryInfo(ProjectRoot);
                for (int depth = 0; directory != null && depth < 8; depth++, directory = directory.Parent) {
                    var candidate = Path.Combine(directory.FullName, RecipesFolder);
                    if (File.Exists(Path.Combine(candidate, ViewsFileName))) return candidate;
                    // The repository keeps the recipes beside the project rather than above it.
                    candidate = Path.Combine(directory.FullName, "unity", RecipesFolder);
                    if (File.Exists(Path.Combine(candidate, ViewsFileName))) return candidate;
                }
                throw new DirectoryNotFoundException("Could not find " + RecipesFolder + "/" + ViewsFileName + " above " + ProjectRoot);
            }
        }

        public static void Generate() {
            var report = Build(write: true).report;
            Debug.Log($"RUNTIME_CATALOGUE_OK {report.entries} entries ({report.prefab} prefab, {report.generated} generated, {report.live} live)");
        }

        public static void Validate() {
            var expected = ReadMapping();
            var asset = AssetDatabase.LoadAssetAtPath<Metro.View.RuntimeCatalogue>(Metro.View.RuntimeCatalogue.AssetPath);
            if (!asset) throw new InvalidOperationException("Runtime catalogue asset is missing: " + Metro.View.RuntimeCatalogue.AssetPath);
            var problems = Compare(asset, expected);
            if (problems.Count > 0) throw new InvalidOperationException("Runtime catalogue is stale:\n  " + string.Join("\n  ", problems));
            Debug.Log($"RUNTIME_CATALOGUE_VALID {asset.Count} entries");
        }

        /// <summary>Ensure the scene can resolve views: generate the asset when absent, validate always.</summary>
        public static Metro.View.RuntimeCatalogue Ensure() {
            var existing = AssetDatabase.LoadAssetAtPath<Metro.View.RuntimeCatalogue>(Metro.View.RuntimeCatalogue.AssetPath);
            if (existing) { Validate(); return existing; }
            Build(write: true);
            AssetDatabase.ImportAsset(Metro.View.RuntimeCatalogue.AssetPath, ImportAssetOptions.ForceSynchronousImport);
            var created = AssetDatabase.LoadAssetAtPath<Metro.View.RuntimeCatalogue>(Metro.View.RuntimeCatalogue.AssetPath);
            if (!created) throw new InvalidOperationException("Runtime catalogue asset did not import: " + Metro.View.RuntimeCatalogue.AssetPath);
            return created;
        }

        static (Metro.View.RuntimeCatalogue asset, CatalogueReport report) Build(bool write) {
            var expected = ReadMapping();
            var recipes = ReadRecipes();
            var problems = new List<string>();
            var catalogue = AssetDatabase.LoadAssetAtPath<Metro.View.RuntimeCatalogue>(Metro.View.RuntimeCatalogue.AssetPath);
            bool created = false;
            if (!catalogue) {
                Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(ProjectRoot, Metro.View.RuntimeCatalogue.AssetPath)) ?? "Assets");
                catalogue = ScriptableObject.CreateInstance<Metro.View.RuntimeCatalogue>();
                AssetDatabase.CreateAsset(catalogue, Metro.View.RuntimeCatalogue.AssetPath);
                created = true;
            }
            var entries = new List<Metro.View.RuntimeCatalogue.Entry>(expected.Count);
            var probes = new List<PrefabProbe>();
            foreach (var row in expected) {
                var prefab = string.IsNullOrEmpty(row.prefab) ? null : AssetDatabase.LoadAssetAtPath<GameObject>(row.prefab);
                if (!string.IsNullOrEmpty(row.prefab) && !prefab) problems.Add("prefab missing: " + row.key + " -> " + row.prefab);
                if (!string.IsNullOrEmpty(row.prefab) && !row.prefab.StartsWith("Assets/StationDesigner/Generated/", StringComparison.Ordinal))
                    problems.Add("view prefab is outside the generated tree: " + row.key + " -> " + row.prefab);
                if (prefab && row.kind != "generated" && !recipes.Contains(row.prefab) &&
                    !Metro.View.RoadVehicleViewKeys.IsVehicleKey(row.key))
                    Debug.Log($"Runtime view {row.key} has no recipe row (promoted without a recipe): {row.prefab}");
                var offset = row.offset != null && row.offset.Length == 3 ? new Vector3(row.offset[0], row.offset[1], row.offset[2]) : new Vector3(.5f, .5f, 1);
                entries.Add(new Metro.View.RuntimeCatalogue.Entry {
                    key = row.key, kind = row.kind, prefab = prefab, prefabPath = row.prefab ?? "", generator = row.generator ?? "",
                    binding = row.binding ?? "", recipeId = row.recipeId ?? "", city = row.city ?? "", part = row.part ?? "",
                    status = row.status ?? "", offset = offset, cells = row.cells, palette = row.palette,
                });
                if (prefab && Probe(row.key)) {
                    var probe = ProbePrefab(row.key, prefab, offset);
                    if (probe != null) probes.Add(probe);
                }
            }
            catalogue.schemaVersion = 1;
            catalogue.entries = entries.ToArray();
            EditorUtility.SetDirty(catalogue);
            AssetDatabase.SaveAssets();
            AssetDatabase.ImportAsset(Metro.View.RuntimeCatalogue.AssetPath, ImportAssetOptions.ForceSynchronousImport);
            var report = new CatalogueReport {
                generatedAt = DateTimeOffset.UtcNow.ToString("O"),
                entries = entries.Count,
                palette = entries.Count(entry => entry.palette),
                prefab = entries.Count(entry => entry.kind == "prefab"),
                generated = entries.Count(entry => entry.kind == "generated"),
                live = entries.Count(entry => entry.kind == "live"),
                missingPrefabs = problems.ToArray(),
                probes = probes.ToArray(),
            };
            WriteReport(report);
            if (problems.Count > 0) {
                if (created) AssetDatabase.DeleteAsset(Metro.View.RuntimeCatalogue.AssetPath);
                throw new InvalidOperationException("Runtime catalogue build failed:\n  " + string.Join("\n  ", problems));
            }
            return (catalogue, report);
        }

        static readonly string[] ProbeKeys = { "gate", "gate-new", "cctv", "cctv-post", "bench-steel-2", "bin", "tvm", "tv", "tv-double", "psd-end", "fence", "door-steel-1", "extinguisher", "electrical-cabinet", "hanger-roof" };
        static bool Probe(string key) => Array.IndexOf(ProbeKeys, key) >= 0;
        static readonly Dictionary<string, string> BodyNode = new Dictionary<string, string> {
            ["gate"] = "gate-body", ["gate-new"] = "gate-body", ["cctv"] = "cctv-body", ["cctv-post"] = "cctv-body",
            ["tvm"] = "", ["tv"] = "", ["tv-double"] = "",
        };

        /// <summary>
        /// Record the instantiated prefab's local bounds and a named part's position so
        /// the promoted basis and pivot can be reviewed without a scene.
        /// </summary>
        static PrefabProbe ProbePrefab(string key, GameObject prefab, Vector3 offset) {
            var instance = UnityEngine.Object.Instantiate(prefab);
            try {
                instance.transform.SetParent(null, false);
                instance.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                var renderers = instance.GetComponentsInChildren<Renderer>(true);
                if (renderers.Length == 0) return null;
                var bounds = renderers[0].bounds;
                foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
                var probe = new PrefabProbe {
                    prefab = key, body = BodyNode.TryGetValue(key, out var node) ? node : "",
                    minX = bounds.min.x, minY = bounds.min.y, minZ = bounds.min.z,
                    maxX = bounds.max.x, maxY = bounds.max.y, maxZ = bounds.max.z,
                };
                if (!string.IsNullOrEmpty(probe.body)) {
                    var part = instance.GetComponentsInChildren<Transform>(true).FirstOrDefault(child => child.name == probe.body);
                    if (part) {
                        probe.bodyX = part.position.x; probe.bodyY = part.position.y; probe.bodyZ = part.position.z;
                    }
                }
                probe.prefab = key;
                return probe;
            } finally {
                UnityEngine.Object.DestroyImmediate(instance);
            }
        }

        static void WriteReport(CatalogueReport report) {
            var path = ReportPath();
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ".");
            File.WriteAllText(path, JsonUtility.ToJson(report, true) + "\n");
        }

        static string ReportPath() {
            var arguments = Environment.GetCommandLineArgs();
            for (int i = 0; i < arguments.Length - 1; i++)
                if (arguments[i] == "-metroCatalogueReport") return Path.GetFullPath(arguments[i + 1]);
            return Path.Combine(ProjectRoot, "Logs/runtime-catalogue-report.json");
        }

        static List<ViewRow> ReadMapping() {
            var path = Path.Combine(RecipesPath, ViewsFileName);
            if (!File.Exists(path)) throw new FileNotFoundException("Runtime view mapping missing", path);
            var file = JsonUtility.FromJson<ViewsFile>(File.ReadAllText(path));
            if (file?.views == null || file.views.Length == 0) throw new InvalidOperationException("Runtime view mapping has no views: " + path);
            // Additive rows: the six promoted road vehicles have no recipe-manifest
            // rows of their own, so they are appended after the generated mapping.
            // The existing rows stay byte-for-byte in order; a missing prefab fails
            // the build by key instead of leaving the traffic renderer to guess.
            var rows = file.views.ToList();
            rows.AddRange(VehicleRows());
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in rows) {
                if (string.IsNullOrEmpty(row.key)) throw new InvalidOperationException("Runtime view mapping row without a key");
                if (!keys.Add(row.key)) throw new InvalidOperationException("Duplicate runtime view key: " + row.key);
                if (row.kind != "prefab" && row.kind != "generated" && row.kind != "live")
                    throw new InvalidOperationException("Unknown runtime view kind: " + row.kind + " (" + row.key + ")");
                if (row.kind == "generated" && string.IsNullOrEmpty(row.generator))
                    throw new InvalidOperationException("Generated runtime view without a generator: " + row.key);
            }
            return rows;
        }

        static IEnumerable<ViewRow> VehicleRows() {
            foreach (var key in Metro.View.RoadVehicleViewKeys.All) {
                var prefab = Metro.View.RoadVehicleViewKeys.PrefabPath(key);
                if (string.IsNullOrEmpty(prefab))
                    throw new InvalidOperationException("Road vehicle view key has no prefab path: " + key);
                yield return new ViewRow {
                    key = key, kind = "prefab", prefab = prefab, status = "DONE",
                    offset = new[] { .5f, .5f, 1f }, cells = 0, palette = false,
                };
            }
        }

        static HashSet<string> ReadRecipes() {
            var path = Path.Combine(RecipesPath, RecipesFileName);
            if (!File.Exists(path)) return new HashSet<string>(StringComparer.Ordinal);
            var file = JsonUtility.FromJson<RecipesFile>(File.ReadAllText(path));
            var promoted = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in file?.families ?? Array.Empty<RecipeRow>())
                if (!string.IsNullOrEmpty(row?.promoted?.prefab)) promoted.Add(row.promoted.prefab);
            return promoted;
        }

        static List<string> Compare(Metro.View.RuntimeCatalogue asset, List<ViewRow> expected) {
            var problems = new List<string>();
            var actual = asset.entries ?? Array.Empty<Metro.View.RuntimeCatalogue.Entry>();
            if (actual.Length != expected.Count) problems.Add($"entry count {actual.Length} != {expected.Count}");
            var byKey = actual.Where(entry => entry != null).ToDictionary(entry => entry.key, StringComparer.Ordinal);
            foreach (var row in expected) {
                if (!byKey.TryGetValue(row.key, out var entry)) { problems.Add("missing entry: " + row.key); continue; }
                if (entry.kind != row.kind) problems.Add($"{row.key}: kind {entry.kind} != {row.kind}");
                if ((entry.prefabPath ?? "") != (row.prefab ?? "")) problems.Add($"{row.key}: prefab {entry.prefabPath} != {row.prefab}");
                if (!string.IsNullOrEmpty(row.prefab) && !entry.prefab) problems.Add($"{row.key}: prefab reference not resolved");
                if ((entry.generator ?? "") != (row.generator ?? "")) problems.Add($"{row.key}: generator {entry.generator} != {row.generator}");
                if ((entry.binding ?? "") != (row.binding ?? "")) problems.Add($"{row.key}: binding {entry.binding} != {row.binding}");
                var expectedOffset = row.offset != null && row.offset.Length == 3
                    ? new Vector3(row.offset[0], row.offset[1], row.offset[2]) : new Vector3(.5f, .5f, 1);
                if ((entry.offset - expectedOffset).sqrMagnitude > 1e-10f) problems.Add($"{row.key}: placement offset {entry.offset} != {expectedOffset}");
                if (entry.cells != row.cells) problems.Add($"{row.key}: cells {entry.cells} != {row.cells}");
                if (entry.palette != row.palette) problems.Add($"{row.key}: palette flag");
                if (entry.prefab && entry.key != row.key) problems.Add($"{row.key}: entry key mismatch");
            }
            return problems;
        }
    }
}
