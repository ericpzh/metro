using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Metro.View;
using Newtonsoft.Json.Linq;
using Unity.Pipeline.Commands;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Metro.Editor {
    public static class TrainMeshLodBaker {
        const string Models = "Assets/StationDesigner/Generated/Models/";
        const string Output = "Assets/StationDesigner/Resources/" + TrainMeshLods.ResourceKey + ".asset";

        [CliGroupCommand("metro", "Bake Low train meshes from export-formations --lod-meshes.",
            Effect = CommandEffect.Destructive, Tags = new[] { "assets" })]
        internal static ExitCode BakeTrainLods(CommandContext cmd,
            [CliArg("export-path", "Directory containing the formations export manifest and GLBs.")] string exportPath) {
            var manifest = JObject.Parse(File.ReadAllText(Path.Combine(exportPath, "manifest.json")));
            var stage = "Assets/TrainLodBake-" + Guid.NewGuid().ToString("N");
            var entries = new Dictionary<Mesh, Mesh>();
            try {
                Directory.CreateDirectory(stage);
                foreach (var part in manifest["assets"]) {
                    string file = (string)part["file"];
                    var evidence = JObject.Parse(File.ReadAllText(Path.Combine(exportPath, Path.ChangeExtension(file, ".manifest.json"))));
                    var low = evidence["lodAssets"].Single(asset => (int)asset["level"] == 2);
                    var fullPath = Models + file;
                    VerifyHash(fullPath, (string)evidence["sha256"]);
                    if ((int)low["triangles"] == (int)evidence["triangles"]) continue;
                    string lowFile = (string)low["file"];
                    string lowPath = stage + "/" + lowFile;
                    string lowSource = Path.Combine(exportPath, lowFile);
                    VerifyHash(lowSource, (string)low["sha256"]);
                    File.Copy(lowSource, lowPath);
                    var importerMeta = File.ReadAllText(fullPath + ".meta");
                    importerMeta = System.Text.RegularExpressions.Regex.Replace(importerMeta,
                        @"(?m)^guid: [a-f0-9]+", "guid: " + Guid.NewGuid().ToString("N"));
                    File.WriteAllText(lowPath + ".meta", importerMeta);
                    AssetDatabase.ImportAsset(lowPath, ImportAssetOptions.ForceSynchronousImport);
                    var fullRoot = AssetDatabase.LoadAssetAtPath<GameObject>(fullPath);
                    var lowRoot = AssetDatabase.LoadAssetAtPath<GameObject>(lowPath);
                    if (fullRoot == null || lowRoot == null) throw new InvalidDataException(file);
                    Collect(fullRoot.transform, lowRoot.transform, entries);
                }

                var asset = AssetDatabase.LoadAssetAtPath<TrainMeshLods>(Output);
                if (asset == null) {
                    asset = ScriptableObject.CreateInstance<TrainMeshLods>();
                    AssetDatabase.CreateAsset(asset, Output);
                }
                var old = AssetDatabase.LoadAllAssetsAtPath(Output).OfType<Mesh>().ToArray();
                asset.entries = entries.Select(entry => {
                    var low = Object.Instantiate(entry.Value);
                    low.name = entry.Key.name + " Low";
                    AssetDatabase.AddObjectToAsset(low, asset);
                    return new TrainMeshLods.Entry { full = entry.Key, low = low };
                }).ToArray();
                foreach (var mesh in old) Object.DestroyImmediate(mesh, true);
                EditorUtility.SetDirty(asset);
                AssetDatabase.SaveAssets();
                cmd.Log.Info("Baked " + entries.Count + " train mesh replacements.");
                return ExitCode.Success;
            } finally {
                AssetDatabase.DeleteAsset(stage);
            }
        }

        static void VerifyHash(string path, string expected) {
            using var stream = File.OpenRead(path);
            using var sha = SHA256.Create();
            var actual = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            if (actual != expected) throw new InvalidDataException("Formation geometry provenance differs: " + path);
        }

        static void Collect(Transform full, Transform low, Dictionary<Mesh, Mesh> entries) {
            if (full.childCount != low.childCount || full.localPosition != low.localPosition ||
                full.localRotation != low.localRotation || full.localScale != low.localScale)
                throw new InvalidDataException($"Train LOD node layout differs: {full.name} / {low.name}, " +
                    $"children {full.childCount} / {low.childCount}, positions {full.localPosition} / {low.localPosition}, " +
                    $"rotations {full.localRotation} / {low.localRotation}, scales {full.localScale} / {low.localScale}");
            var source = full.TryGetComponent<MeshFilter>(out var fullFilter) ? fullFilter.sharedMesh : null;
            var replacement = low.TryGetComponent<MeshFilter>(out var lowFilter) ? lowFilter.sharedMesh : null;
            if ((source == null) != (replacement == null) ||
                (source != null && source.subMeshCount != replacement.subMeshCount))
                throw new InvalidDataException("Train LOD mesh layout differs: " + full.name);
            if (source != null && source.subMeshCount == 1 &&
                replacement.GetIndexCount(0) < source.GetIndexCount(0)) {
                if (full.name != low.name || source.GetTopology(0) != MeshTopology.Triangles ||
                    replacement.GetTopology(0) != MeshTopology.Triangles || replacement.GetIndexCount(0) == 0)
                    throw new InvalidDataException("Train LOD submesh differs: " + full.name + " / " + low.name);
                entries.TryAdd(source, replacement);
            }
            for (int i = 0; i < full.childCount; i++) Collect(full.GetChild(i), low.GetChild(i), entries);
        }
    }
}
