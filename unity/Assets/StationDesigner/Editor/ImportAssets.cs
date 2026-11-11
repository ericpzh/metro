using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Metro.Editor {
    // Validate the complete batch in an isolated AssetDatabase namespace before delivery.
    public static class ImportAssets {
        const string Folder = "Assets/StationDesigner/Generated";
        const string CataloguePath = Folder + "/FixtureCatalogue.asset";
        const string Staging = "Assets/__MetroFixtureImportStaging";
        [Serializable] sealed class Manifest { public int schemaVersion; public Item[] assets; }
        [Serializable] sealed class Item {
            public string id, source, sha256, kind, motionOracle, motionOracleSha256;
            public int triangles;
            public float[] min, max;
            public string[] materials, anchors, clips;
        }
        [Serializable] sealed class MotionOracle { public string sha256; public Door[] doors; }
        [Serializable] sealed class Door { public string name; public int side; public Sample[] samples; }
        [Serializable] sealed class Sample { public float[] position; }
        [Serializable] sealed class Report { public string status; public string[] imported, stale; }

        public static void Run() {
            string[] args = Environment.GetCommandLineArgs();
            var arg = Array.IndexOf(args, "-metroManifest");
            if (arg < 0 || arg + 1 >= args.Length) throw new ArgumentException("-metroManifest is required");
            string path = Path.GetFullPath(args[arg + 1]);
            var project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            var repo = new DirectoryInfo(project);
            while (repo != null && !Directory.Exists(Path.Combine(repo.FullName, ".git")) && !File.Exists(Path.Combine(repo.FullName, ".git"))) repo = repo.Parent;
            if (repo == null) throw new Exception("Cannot find repository root");
            string prefix = Path.GetFullPath(repo.FullName) + Path.DirectorySeparatorChar;
            if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new Exception("Manifest must be inside the repository");
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(path));
            if (manifest == null || manifest.schemaVersion != 1 || manifest.assets == null || manifest.assets.Length == 0) throw new Exception("Invalid fixture manifest");
            if (manifest.assets.Select(x => x.id).Distinct(StringComparer.Ordinal).Count() != manifest.assets.Length) throw new Exception("Duplicate asset ID");
            var sourceBytes = new Dictionary<string, byte[]>(StringComparer.Ordinal);
            var motions = new Dictionary<string, MotionOracle>(StringComparer.Ordinal);
            foreach (var item in manifest.assets) {
                if (string.IsNullOrEmpty(item.id) || item.id.Any(c => !(char.IsLetterOrDigit(c) || c == '.' || c == '-'))) throw new Exception("Invalid asset ID");
                if (item.kind != "bench" && item.kind != "train") throw new Exception("Unsupported fixture kind: " + item.kind);
                string input = Path.GetFullPath(Path.Combine(repo.FullName, item.source ?? ""));
                if (!input.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !input.EndsWith(".glb", StringComparison.OrdinalIgnoreCase)) throw new Exception("Invalid source path");
                using var sha = SHA256.Create();
                var bytes = File.ReadAllBytes(input);
                string hash = BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                if (hash != item.sha256) throw new Exception("Fixture digest mismatch: " + item.id);
                sourceBytes.Add(item.id, bytes);
                if (item.kind == "train") {
                    var oraclePath = Path.GetFullPath(Path.Combine(repo.FullName, item.motionOracle ?? ""));
                    if (!oraclePath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new Exception("Invalid motion oracle path");
                    var oracleBytes = File.ReadAllBytes(oraclePath);
                    var oracleHash = BitConverter.ToString(sha.ComputeHash(oracleBytes)).Replace("-", "").ToLowerInvariant();
                    if (oracleHash != item.motionOracleSha256) throw new Exception("Motion oracle digest mismatch: " + item.id);
                    var oracle = JsonUtility.FromJson<MotionOracle>(System.Text.Encoding.UTF8.GetString(oracleBytes));
                    if (oracle == null || oracle.sha256 != item.sha256 || oracle.doors == null || oracle.doors.Length != 40) throw new Exception("Motion oracle does not match train fixture");
                    motions.Add(item.id, oracle);
                }
            }

            if (Directory.Exists(Staging) || File.Exists(Staging + ".meta")) throw new Exception("Fixture staging path already exists; inspect it before retrying");
            try {
                if (string.IsNullOrEmpty(AssetDatabase.CreateFolder("Assets", "__MetroFixtureImportStaging"))) throw new Exception("Cannot create fixture staging folder");
                foreach (var item in manifest.assets) {
                    string stagedPath = Staging + "/fixture-" + item.id + ".glb";
                    File.WriteAllBytes(stagedPath, sourceBytes[item.id]);
                    Validate(item, stagedPath, null, motions);
                }
                Deliver(manifest, sourceBytes, motions);
            } finally {
                if (Directory.Exists(Staging)) AssetDatabase.DeleteAsset(Staging);
            }
            var output = Array.IndexOf(args, "-metroImportReport");
            var catalogue = AssetDatabase.LoadAssetAtPath<Metro.ImportedAssetCatalogue>(CataloguePath);
            var stale = catalogue.entries.Select(x => x.id).Except(manifest.assets.Select(x => x.id)).ToArray();
            if (output >= 0 && output + 1 < args.Length) File.WriteAllText(args[output + 1], JsonUtility.ToJson(new Report { status = "passed", imported = manifest.assets.Select(x => x.id).ToArray(), stale = stale }, true));
            Debug.Log("IMPORT_ASSETS_OK " + string.Join(", ", manifest.assets.Select(x => x.id)));
        }

        static void Deliver(Manifest manifest, Dictionary<string, byte[]> sourceBytes, Dictionary<string, MotionOracle> motions) {
            // Preserve bytes and paired GUID metadata for rollback if delivery fails.
            var paths = manifest.assets.SelectMany(item => new[] { Folder + "/Models/fixture-" + item.id + ".glb", Folder + "/Prefabs/fixture-" + item.id + ".prefab" }).Concat(new[] { CataloguePath }).ToArray();
            var backup = new Dictionary<string, byte[]>();
            foreach (var path in paths) foreach (var name in new[] { path, path + ".meta" }) backup[name] = File.Exists(name) ? File.ReadAllBytes(name) : null;
            try {
            Directory.CreateDirectory(Folder + "/Models");
            Directory.CreateDirectory(Folder + "/Prefabs");
            var previous = AssetDatabase.LoadAssetAtPath<Metro.ImportedAssetCatalogue>(CataloguePath);
            var stale = previous?.entries?.Select(x => x.id).Except(manifest.assets.Select(x => x.id)).ToArray() ?? Array.Empty<string>();
            foreach (var id in stale) Debug.LogWarning("Stale fixture ID retained; explicit prune required: " + id);
            var entries = new System.Collections.Generic.List<Metro.ImportedAssetCatalogue.Entry>();
            // Keep stale entries in the catalogue; importing is never an implicit prune.
            if (previous?.entries != null) entries.AddRange(previous.entries.Where(x => stale.Contains(x.id)));
            foreach (var item in manifest.assets) {
                string modelPath = Folder + "/Models/fixture-" + item.id + ".glb";
                string prefabPath = Folder + "/Prefabs/fixture-" + item.id + ".prefab";
                byte[] data = sourceBytes[item.id];
                if (!File.Exists(modelPath) || !data.SequenceEqual(File.ReadAllBytes(modelPath))) File.WriteAllBytes(modelPath, data);
                entries.Add(Validate(item, modelPath, prefabPath, motions));
            }
            var catalogue = previous ?? ScriptableObject.CreateInstance<Metro.ImportedAssetCatalogue>();
            catalogue.entries = entries.OrderBy(x => x.id, StringComparer.Ordinal).ToArray();
            if (previous == null) AssetDatabase.CreateAsset(catalogue, CataloguePath); else EditorUtility.SetDirty(catalogue);
            AssetDatabase.SaveAssets();
            } catch {
                foreach (var path in paths) {
                    if (backup[path] == null && File.Exists(path)) AssetDatabase.DeleteAsset(path);
                    foreach (var name in new[] { path, path + ".meta" }) {
                        if (backup[name] != null) File.WriteAllBytes(name, backup[name]);
                        else if (File.Exists(name)) File.Delete(name);
                    }
                }
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                throw;
            }
        }

        static Metro.ImportedAssetCatalogue.Entry Validate(Item item, string modelPath, string prefabPath, Dictionary<string, MotionOracle> motions) {
                AssetDatabase.ImportAsset(modelPath, ImportAssetOptions.ForceSynchronousImport);
                var model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
                if (model == null) throw new Exception("glTFast import failed: " + item.id);
                var wrapper = new GameObject(item.id);
                try {
                    var basis = new GameObject("Unity basis").transform;
                    basis.SetParent(wrapper.transform, false);
                    basis.localRotation = Quaternion.Euler(0, 180, 0);
                    var imported = (GameObject)PrefabUtility.InstantiatePrefab(model, basis);
                    var renderers = wrapper.GetComponentsInChildren<MeshRenderer>();
                    if (renderers.Length == 0) throw new Exception("No mesh renderers: " + item.id);
                    var names = renderers.SelectMany(r => r.sharedMaterials).Where(m => m != null).Select(m => m.name).Distinct().ToArray();
                    if ((item.materials ?? Array.Empty<string>()).Any(name => !names.Contains(name))) throw new Exception("Missing material: " + item.id);
                    var nodes = wrapper.GetComponentsInChildren<Transform>().Select(t => t.name).ToArray();
                    if ((item.anchors ?? Array.Empty<string>()).Any(name => nodes.Count(n => n == name) != 1)) throw new Exception("Missing or duplicate anchor: " + item.id);
                    if (item.kind == "bench") {
                        if (names.Length != item.materials.Length) throw new Exception("Unexpected bench material slot");
                        var bounds = renderers[0].bounds; foreach (var r in renderers) bounds.Encapsulate(r.bounds);
                        Vector3 expectedMin = new Vector3(item.min[0], item.min[2], item.min[1]);
                        Vector3 expectedMax = new Vector3(item.max[0], item.max[2], item.max[1]);
                        if (Vector3.Distance(bounds.min, expectedMin) > .001f || Vector3.Distance(bounds.max, expectedMax) > .001f) throw new Exception("Bench bounds mismatch");
                        int count = wrapper.GetComponentsInChildren<MeshFilter>().Sum(f => f.sharedMesh.triangles.Length / 3);
                        if (count != item.triangles) throw new Exception("Bench triangle count mismatch");
                        foreach (var anchor in new[] { ("AxisX", Vector3.right), ("Front", Vector3.forward), ("Up", Vector3.up) }) {
                            var position = wrapper.GetComponentsInChildren<Transform>().Single(t => t.name == anchor.Item1).position;
                            if (Vector3.Distance(position, anchor.Item2) > .001f) throw new Exception("Bench anchor mismatch: " + anchor.Item1);
                        }
                        var front = wrapper.GetComponentsInChildren<Transform>().Single(t => t.name == "Front");
                        for (int i = 0; i < 4; i++) {
                            wrapper.transform.rotation = Quaternion.Euler(0, i * 90, 0);
                            if (Vector3.Distance(front.position, wrapper.transform.rotation * Vector3.forward) > .001f) throw new Exception("Bench facing mismatch: " + i);
                        }
                        wrapper.transform.rotation = Quaternion.identity;
                    }
                    var clips = AssetDatabase.LoadAllAssetsAtPath(modelPath).OfType<AnimationClip>().ToArray();
                    if ((item.clips ?? Array.Empty<string>()).Any(name => !clips.Any(c => c.name == name && Mathf.Abs(c.length - 1) < .001f))) throw new Exception("Missing fixture clip: " + item.id);
                    var doors = nodes.Where(n => n.StartsWith("TypeADoor", StringComparison.Ordinal)).OrderBy(n => n, StringComparer.Ordinal).ToArray();
                    if (item.kind == "train" && (doors.Length != 40 || doors.Distinct().Count() != 40)) throw new Exception("Expected 40 named train door leaves");
                    if (item.kind == "train" && !renderers.SelectMany(r => r.sharedMaterials).Any(m => m != null && m.name == "glass" && m.renderQueue >= (int)UnityEngine.Rendering.RenderQueue.Transparent)) throw new Exception("Train glass lost transparent queue");
                    if (item.kind == "train") {
                        var oracle = motions[item.id];
                        var leaves = imported.GetComponentsInChildren<Transform>().Where(t => t.name.StartsWith("TypeADoor", StringComparison.Ordinal)).ToDictionary(t => t.name);
                        if (oracle.doors.Count(d => d.side == 1) != 20 || oracle.doors.Count(d => d.side == -1) != 20) throw new Exception("Invalid door side mapping");
                        void Check(int index) {
                            foreach (var door in oracle.doors) {
                                if (!leaves.TryGetValue(door.name, out var leaf) || door.samples == null || door.samples.Length != 5 || door.samples[index].position == null || door.samples[index].position.Length != 3) throw new Exception("Invalid door oracle: " + door.name);
                                var v = door.samples[index].position;
                                if (Vector3.Distance(leaf.position, new Vector3(v[0], v[2], v[1])) > .001f) throw new Exception("Door motion mismatch: " + door.name + " sample " + index);
                            }
                        }
                        Check(0);
                        foreach (var pair in new[] { ("OpenPlus", 1), ("OpenMinus", 3) }) {
                            var clip = clips.Single(c => c.name == pair.Item1);
                            clip.SampleAnimation(imported, .18f); Check(pair.Item2);
                            clip.SampleAnimation(imported, 1); Check(pair.Item2 + 1);
                            clip.SampleAnimation(imported, 0); Check(0);
                        }
                    }
                    if (prefabPath == null) return null;
                    var prefab = PrefabUtility.SaveAsPrefabAsset(wrapper, prefabPath);
                    if (prefab == null) throw new Exception("Cannot save wrapper: " + item.id);
                    return new Metro.ImportedAssetCatalogue.Entry { id = item.id, sha256 = item.sha256, prefab = prefab, anchors = item.anchors, clips = item.clips, dynamicParts = doors };
                } finally { Object.DestroyImmediate(wrapper); }
        }
    }
}
