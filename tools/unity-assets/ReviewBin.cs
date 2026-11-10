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
    public static class ReviewBin
    {
        private const string Folder = "Assets/BinProof";
        private const string Model = Folder + "/bin.glb";
        private const string Prefab = Folder + "/Bin.prefab";
        private const string Scene = Folder + "/Review.unity";

        [Serializable]
        private class Manifest
        {
            public string id, sha256;
            public float[] min, max;
            public int triangles, textures;
            public string[] materials, alphaMaterials;
            public Anchors anchors;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(Path.Combine(evidence, "export", "manifest.json")));
            byte[] bytes = File.ReadAllBytes(Path.Combine(evidence, "export", "bin.glb"));
            string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            Require(digest == manifest.sha256, "GLB digest differs from the validated manifest");

            Directory.CreateDirectory(Folder);
            if (!File.Exists(Model) || !bytes.SequenceEqual(File.ReadAllBytes(Model)))
                File.WriteAllBytes(Model, bytes);
            AssetDatabase.ImportAsset(Model, ImportAssetOptions.ForceSynchronousImport);
            var imported = AssetDatabase.LoadAssetAtPath<GameObject>(Model);
            Require(imported != null, "glTFast did not produce a model");

            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var root = new GameObject("Double-stream bin");
            var orientation = new GameObject("Unity basis").transform;
            orientation.SetParent(root.transform, false);
            PrefabUtility.InstantiatePrefab(imported, orientation);
            // Export rotates source Z-up to glTF Y-up, then glTFast reflects X.
            // The wrapper turns X and Z back to the gameplay convention (x,z,y).
            orientation.localRotation = Quaternion.Euler(0, 180, 0);
            CheckAnchor(root, "AxisX", Basis(manifest.anchors.AxisX));
            CheckAnchor(root, "Front", Basis(manifest.anchors.Front));
            CheckAnchor(root, "Up", Basis(manifest.anchors.Up));
            CheckAnchor(root, "Approach", Basis(manifest.anchors.Approach));

            var renderers = root.GetComponentsInChildren<MeshRenderer>();
            Require(renderers.Length > 0, "Imported model has no mesh renderers");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers)
                bounds.Encapsulate(renderer.bounds);
            Near(bounds.min, Basis(manifest.min), "minimum bounds");
            Near(bounds.max, Basis(manifest.max), "maximum bounds");
            int triangles = root.GetComponentsInChildren<MeshFilter>().Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == manifest.triangles, $"Expected {manifest.triangles} triangles, got {triangles}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(manifest.materials), $"Unexpected materials: {string.Join(", ", materials)}");
            var labels = importedMaterials.Single(material => material.name == "binLabels");
            Require(labels.renderQueue >= (int)RenderQueue.Transparent, "Sorting stickers lost their transparent queue");
            var labelTexture = labels.mainTexture;
            Require(labelTexture != null && labelTexture.width == 1024 && labelTexture.height == 768,
                "Sorting sticker canvas did not import at 1024 x 768");
            var steel = importedMaterials.Single(material => material.name == "binSteel");
            Require(steel.mainTexture != null && steel.mainTexture.width == 128 && steel.mainTexture.height == 128,
                "Brushed steel canvas did not import at 128 x 128");
            var textures = importedMaterials.SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length >= manifest.textures, $"Expected at least {manifest.textures} textures, got {textures.Length}");

            var front = FindAnchor(root, "Front");
            var approach = FindAnchor(root, "Approach");
            for (int i = 0; i < 4; i++)
            {
                var rotation = Quaternion.Euler(0, i * 90, 0);
                root.transform.rotation = rotation;
                Near(front.position, rotation * Vector3.forward, $"front at facing {i}");
                Near(approach.position, rotation * Vector3.back, $"approach at facing {i}");
            }
            root.transform.rotation = Quaternion.identity;

            Require(PrefabUtility.SaveAsPrefabAsset(root, Prefab) != null, "Could not save wrapper prefab");
            UnityEngine.Object.DestroyImmediate(root);
            PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(Prefab));

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = new Vector3(1.9f, 1.45f, -2.15f);
            camera.transform.LookAt(new Vector3(0, 0.45f, 0));
            camera.orthographic = true;
            camera.orthographicSize = 1.05f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.22f, 0.30f, 0.38f);
            var light = new GameObject("Key light").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 2.5f;
            light.transform.rotation = Quaternion.Euler(38, -35, 0);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.5f;
            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene), "Could not save review scene");
            Debug.Log($"BIN_IMPORT_OK {manifest.id} {bounds.size:F3} {triangles} {materials.Length} materials {textures.Length} textures labels={labels.renderQueue} approach={manifest.anchors.Approach[1]}");
        }

        public static void BuildWeb()
        {
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.decompressionFallback = false;
            PlayerSettings.WebGL.template = "APPLICATION:Default";
            var report = BuildPipeline.BuildPlayer(
                new[] { Scene }, Environment.GetEnvironmentVariable("METRO_BENCH_WEB"),
                BuildTarget.WebGL, BuildOptions.None);
            Require(report.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded, report.summary.result.ToString());
        }

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        private static void CheckAnchor(GameObject root, string name, Vector3 expected) =>
            Near(FindAnchor(root, name).position, expected, name);

        private static void Near(Vector3 actual, Vector3 expected, string field) =>
            Require(Vector3.Distance(actual, expected) < 0.001f, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
