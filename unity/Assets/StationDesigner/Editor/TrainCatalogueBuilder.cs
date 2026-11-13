using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Metro.View;
using UnityEditor;
using UnityEngine;

namespace Metro.Editor {
    /// <summary>
    /// Builds the serialized formation table from the promoted consist prefabs:
    /// `<stock>.<cars>.<power>` for every menu cell plus the promoted livery variants
    /// (`<stock>.<cars>.<power>@zoo`). Validation-only entry point compares the asset
    /// with the promoted folder so a missing formation fails the scene build.
    /// </summary>
    public static class TrainCatalogueBuilder {
        public const string PrefabFolder = "Assets/StationDesigner/Generated/Prefabs";
        public const string AssetPath = Metro.View.TrainCatalogue.AssetPath;

        static readonly Regex NamePattern = new Regex(@"^Formation(?<stock>[A-Z])(?<cars>\d)(?<power>Overhead|ThirdRail)(?<suffix>[A-Za-z0-9]*)$", RegexOptions.CultureInvariant);

        [Serializable] sealed class Report {
            public int entries, baseKeys, variants;
            public string[] problems;
        }

        public static void Generate() {
            var report = Build(write: true).report;
            Debug.Log($"TRAIN_CATALOGUE_OK {report.entries} entries ({report.baseKeys} menu keys, {report.variants} variants)");
        }

        public static void Validate() {
            var expected = ReadPromoted();
            var asset = AssetDatabase.LoadAssetAtPath<Metro.View.TrainCatalogue>(AssetPath);
            if (!asset) throw new InvalidOperationException("Train catalogue asset is missing: " + AssetPath);
            var problems = Compare(asset, expected);
            if (problems.Count > 0) throw new InvalidOperationException("Train catalogue is stale:\n  " + string.Join("\n  ", problems));
            Debug.Log($"TRAIN_CATALOGUE_VALID {expected.Count} formations");
        }

        public static Metro.View.TrainCatalogue Ensure() {
            var existing = AssetDatabase.LoadAssetAtPath<Metro.View.TrainCatalogue>(AssetPath);
            if (existing) { Validate(); return existing; }
            Build(write: true);
            AssetDatabase.ImportAsset(AssetPath, ImportAssetOptions.ForceSynchronousImport);
            var created = AssetDatabase.LoadAssetAtPath<Metro.View.TrainCatalogue>(AssetPath);
            if (!created) throw new InvalidOperationException("Train catalogue asset did not import: " + AssetPath);
            return created;
        }

        static (Metro.View.TrainCatalogue asset, Report report) Build(bool write) {
            var rows = ReadPromoted();
            var problems = new List<string>();
            foreach (var key in TrainFormations.All()) {
                if (rows.All(row => row.key != key)) problems.Add("missing promoted formation: " + key);
            }
            if (rows.All(row => !row.key.EndsWith(TrainFormations.ZooSuffix, StringComparison.Ordinal)))
                problems.Add("missing promoted livery variant for the Zoo formation");
            var asset = AssetDatabase.LoadAssetAtPath<Metro.View.TrainCatalogue>(AssetPath);
            if (!asset) {
                asset = ScriptableObject.CreateInstance<Metro.View.TrainCatalogue>();
                AssetDatabase.CreateAsset(asset, AssetPath);
            }
            asset.schemaVersion = 1;
            asset.entries = rows.Select(row => new Metro.View.TrainCatalogue.Entry {
                key = row.key, stock = row.stock, cars = row.cars, power = row.power,
                prefab = AssetDatabase.LoadAssetAtPath<GameObject>(row.path), prefabPath = row.path, bakedScale = row.scale,
            }).ToArray();
            EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssets();
            AssetDatabase.ImportAsset(AssetPath, ImportAssetOptions.ForceSynchronousImport);
            var report = new Report {
                entries = rows.Count,
                baseKeys = rows.Count(row => !row.key.EndsWith(TrainFormations.ZooSuffix, StringComparison.Ordinal)),
                variants = rows.Count(row => row.key.EndsWith(TrainFormations.ZooSuffix, StringComparison.Ordinal)),
                problems = problems.ToArray(),
            };
            if (problems.Count > 0) throw new InvalidOperationException("Train catalogue build failed:\n  " + string.Join("\n  ", problems));
            return (asset, report);
        }

        static List<(string key, string stock, int cars, string power, string path, float scale)> ReadPromoted() {
            var rows = new List<(string, string, int, string, string, float)>();
            foreach (var asset in AssetDatabase.FindAssets("t:GameObject", new[] { PrefabFolder })) {
                var path = AssetDatabase.GUIDToAssetPath(asset);
                var name = Path.GetFileNameWithoutExtension(path);
                var match = NamePattern.Match(name);
                if (!match.Success) continue;
                var stock = match.Groups["stock"].Value;
                if (Array.IndexOf(TrainFormations.Stocks, stock) < 0) continue;
                int cars = int.Parse(match.Groups["cars"].Value);
                var power = match.Groups["power"].Value == "ThirdRail" ? "third-rail" : "overhead";
                var suffix = match.Groups["suffix"].Value;
                var key = TrainFormations.Key(stock, cars, power) +
                    (suffix.Length > 0 ? "@" + suffix.ToLowerInvariant() : "");
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                float scale = 1f;
                if (prefab) {
                    // The Consist node is nested under the wrapper basis, not a direct child.
                    var consist = prefab.GetComponentsInChildren<Transform>(true)
                        .FirstOrDefault(node => node.name == "Consist");
                    if (consist) scale = consist.localScale.x;
                }
                rows.Add((key, stock, cars, power, path, scale));
            }
            // A livery variant stands in for its plain menu slot when the promotion replaced
            // it: Zoo Line 5's six-car third-rail slot *is* FormationL6ThirdRailZoo
            // (09-train-parity), so the base key resolves to the same promoted consist.
            var keys = new HashSet<string>(rows.Select(row => row.Item1), StringComparer.Ordinal);
            foreach (var row in rows.ToArray()) {
                int at = row.Item1.IndexOf('@');
                if (at < 0) continue;
                var baseKey = row.Item1.Substring(0, at);
                if (keys.Contains(baseKey)) continue;
                rows.Add((baseKey, row.Item2, row.Item3, row.Item4, row.Item5, row.Item6));
                keys.Add(baseKey);
            }
            rows.Sort((a, b) => string.CompareOrdinal(a.Item1, b.Item1));
            return rows;
        }

        static List<string> Compare(Metro.View.TrainCatalogue asset, List<(string key, string stock, int cars, string power, string path, float scale)> expected) {
            var problems = new List<string>();
            var actual = asset.entries ?? Array.Empty<Metro.View.TrainCatalogue.Entry>();
            var byKey = actual.Where(entry => entry != null).ToDictionary(entry => entry.key, StringComparer.Ordinal);
            foreach (var row in expected) {
                if (!byKey.TryGetValue(row.key, out var entry)) { problems.Add("missing formation: " + row.key); continue; }
                if (entry.prefabPath != row.path) problems.Add($"{row.key}: prefab {entry.prefabPath} != {row.path}");
                if (!entry.prefab) problems.Add($"{row.key}: prefab reference not resolved");
                if (Math.Abs(entry.bakedScale - row.scale) > 1e-4f) problems.Add($"{row.key}: scale {entry.bakedScale} != {row.scale}");
            }
            if (actual.Length != expected.Count) problems.Add($"entry count {actual.Length} != {expected.Count}");
            return problems;
        }
    }
}
