using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.AssetExample
{
    public static class ReviewTrain
    {
        private const string Folder = "Assets/TrainProof";
        private const string Model = Folder + "/train.glb";
        private const string Prefab = Folder + "/TypeA.prefab";
        private const string Scene = Folder + "/Review.unity";

        [Serializable]
        private class Manifest { public string sha256; public float[] min, max; public Door[] doors; }
        [Serializable]
        private class Door { public string name; public int side; public Sample[] samples; }
        [Serializable]
        private class Sample { public float[] position; }

        public static void Import()
        {
            var source = Path.Combine(Environment.GetEnvironmentVariable("METRO_BENCH_PROOF"), "export");
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(Path.Combine(source, "manifest.json")));
            byte[] bytes = File.ReadAllBytes(Path.Combine(source, "train.glb"));
            using var sha = SHA256.Create();
            Require(BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant() == manifest.sha256, "GLB digest mismatch");
            Directory.CreateDirectory(Folder);
            if (!File.Exists(Model) || !bytes.SequenceEqual(File.ReadAllBytes(Model)))
                File.WriteAllBytes(Model, bytes);
            AssetDatabase.ImportAsset(Model, ImportAssetOptions.ForceSynchronousImport);
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(Model);
            Require(model != null, "glTFast did not import the train");
            var assets = AssetDatabase.LoadAllAssetsAtPath(Model);
            var clips = assets.OfType<AnimationClip>().ToDictionary(clip => clip.name);
            Require(clips.Count == 2 && clips.ContainsKey("OpenPlus") && clips.ContainsKey("OpenMinus"), "Expected two independent door clips");

            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var wrapper = new GameObject("Type A two-car train");
            var basis = new GameObject("Unity basis").transform;
            basis.SetParent(wrapper.transform, false);
            basis.localRotation = Quaternion.Euler(0, 180, 0);
            var imported = (GameObject)PrefabUtility.InstantiatePrefab(model, basis);
            var leaves = imported.GetComponentsInChildren<Transform>().Where(node => node.name.StartsWith("TypeADoor", StringComparison.Ordinal))
                .ToDictionary(node => node.name);
            Require(leaves.Count == 40 && manifest.doors.Count(door => door.side == 1) == 20 &&
                manifest.doors.Count(door => door.side == -1) == 20, "Expected 20 leaves per bank");
            var renderers = wrapper.GetComponentsInChildren<MeshRenderer>();
            Require(renderers.Length > 0, "Train has no renderers");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers)
                bounds.Encapsulate(renderer.bounds);
            // Renderer.bounds transforms local AABBs, which can be conservative for curved parts.
            Near(bounds.min, Basis(manifest.min), "minimum bounds", 0.10f);
            Near(bounds.max, Basis(manifest.max), "maximum bounds", 0.10f);
            var materials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var glass = materials.Single(material => material.name == "glass");
            Require(glass.renderQueue >= (int)RenderQueue.Transparent, "Window material lost its transparent queue");
            Require(materials.Any(material => material.name == "lineLivery"), "Missing livery material");
            var textures = materials.SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length >= 4, $"Expected at least four imported textures, got {textures.Length}");

            void Check(int sample)
            {
                foreach (var door in manifest.doors)
                    Near(leaves[door.name].position, Basis(door.samples[sample].position), $"{door.name}, sample {sample}", 0.001f);
            }
            Check(0);
            foreach (var (name, sample) in new[] { ("OpenPlus", 1), ("OpenMinus", 3) })
            {
                var clip = clips[name];
                Require(Mathf.Abs(clip.length - 1) < 0.001f, $"{name} duration changed");
                clip.SampleAnimation(imported, 0.18f);
                Check(sample);
                clip.SampleAnimation(imported, 1);
                Check(sample + 1);
                clip.SampleAnimation(imported, 0);
                Check(0);
            }
            Require(PrefabUtility.SaveAsPrefabAsset(wrapper, Prefab) != null, "Could not save wrapper prefab");
            clips["OpenPlus"].SampleAnimation(imported, 1);
            foreach (var door in manifest.doors.Where(door => door.side == 1))
                PrefabUtility.RecordPrefabInstancePropertyModifications(leaves[door.name]);
            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = new Vector3(30, 15, 44);
            camera.transform.LookAt(new Vector3(0, 1.8f, 0));
            camera.orthographic = true;
            camera.orthographicSize = 13;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.22f, 0.30f, 0.38f);
            var light = new GameObject("Key light").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 2.5f;
            light.transform.rotation = Quaternion.Euler(45, 180, 0);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.5f;
            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene), "Could not save review scene");
            Debug.Log($"TRAIN_IMPORT_OK {bounds.size:F3} {renderers.Length} renderers {materials.Length} materials {textures.Length} textures {leaves.Count} leaves glass={glass.renderQueue} clips={string.Join(",", clips.Keys)}");
        }

        public static void BuildWeb()
        {
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.decompressionFallback = false;
            PlayerSettings.WebGL.template = "APPLICATION:Default";
            var report = BuildPipeline.BuildPlayer(new[] { Scene }, Environment.GetEnvironmentVariable("METRO_BENCH_WEB"),
                BuildTarget.WebGL, BuildOptions.None);
            Require(report.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded, report.summary.result.ToString());
        }

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);
        private static void Near(Vector3 actual, Vector3 expected, string field, float tolerance) =>
            Require(Vector3.Distance(actual, expected) < tolerance, $"{field}: expected {expected:F4}, got {actual:F4}");
        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
