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
    /// <summary>
    /// Imports the two hanger variants exported by export-hanger.mjs, wraps each
    /// glTFast model in a prefab under the Unity gameplay basis and records both
    /// in one review scene. The family source is HangerModel.ts; the post variant
    /// is a 3 m post under a 4 m bar, the roof variant hangs the same bar from a
    /// plate roof 1 m above it.
    /// </summary>
    public static class ReviewHanger
    {
        private const string Folder = "Assets/HangerProof";
        private const string Scene = Folder + "/Hanger.unity";

        [Serializable]
        private class Manifest
        {
            public string id, paletteId, variant, cfgMount, file, prefab, sha256;
            public float[] min, max, placementOffset;
            public int triangles, textures, w;
            public string[] materials, alphaMaterials;
            public Anchors anchors;
            public StationContext stationContext;
            public bool hasSuspension;
            public float roofZ, suspensionLength;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up; }

        [Serializable]
        private class StationContext { public string note; }

        private class Variant
        {
            public string key;
            public Manifest manifest;
            public string modelPath;
            public string prefabPath;
            public string prefabName;
            public Bounds bounds;
            public int triangles;
            public string[] materials;
            public int textures;
            public GameObject prefab;
        }

        private static readonly Variant[] Variants =
        {
            new Variant
            {
                key = "hanger-post", prefabName = "HangerPost",
                modelPath = Folder + "/hanger-post.glb", prefabPath = Folder + "/HangerPost.prefab",
            },
            new Variant
            {
                key = "hanger-roof", prefabName = "HangerRoof",
                modelPath = Folder + "/hanger-roof.glb", prefabPath = Folder + "/HangerRoof.prefab",
            },
        };

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            Directory.CreateDirectory(Folder);

            foreach (var variant in Variants) ImportVariant(variant, evidence);

            // The scene is rebuilt on every import: Unity mints fresh local fileIDs
            // for runtime-created scene objects on each save, so the shared proof
            // runner checks .glb/.prefab/.meta bytes for idempotency and this script
            // verifies the scene *content* after saving it.
            BuildReviewScene();

            Debug.Log($"HANGER_IMPORT_OK post={Describe(Variants[0])} roof={Describe(Variants[1])} scene={Scene} {SceneSummary()}");
        }

        /// <summary>One review scene with both variants side by side and a fixed camera.</summary>
        private static void BuildReviewScene()
        {
            // One review scene holds both prefab instances so the Web build shows
            // the whole family at a glance. Each root is shifted along X to sit
            // beside the other: the bar is 4 m long, anchored at local x +0.5.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var post = (GameObject)PrefabUtility.InstantiatePrefab(Variants[0].prefab);
            post.name = "Hanger post";
            post.transform.position = new Vector3(-3.9f, 0f, 0f);
            var roof = (GameObject)PrefabUtility.InstantiatePrefab(Variants[1].prefab);
            roof.name = "Hanger roof";
            roof.transform.position = new Vector3(0.9f, 0f, 0f);

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = new Vector3(1.2f, 3.7f, -12f);
            camera.transform.LookAt(new Vector3(0f, 2.4f, 0f));
            camera.orthographic = true;
            camera.orthographicSize = 3.6f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.20f, 0.27f, 0.35f);
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 80f;

            // Two diffuse lights: the exported steel is satin (metalness 0.35),
            // so it reads as steel without a reflection probe.
            var key = new GameObject("Key light").AddComponent<Light>();
            key.type = LightType.Directional;
            key.intensity = 2.5f;
            key.transform.rotation = Quaternion.Euler(38f, -32f, 0f);
            var fill = new GameObject("Fill light").AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 1.2f;
            fill.transform.rotation = Quaternion.Euler(16f, 148f, 0f);

            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.65f;
            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene), "Could not save review scene");
            VerifyScene();
        }

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: two prefab
        /// instances linked to the wrapper prefabs, their placement, and the fixed
        /// camera and lights the Web check depends on.
        /// </summary>
        private static void VerifyScene()
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            VerifyInstance(roots, "Hanger post", Variants[0].prefabPath, new Vector3(-3.9f, 0f, 0f));
            VerifyInstance(roots, "Hanger roof", Variants[1].prefabPath, new Vector3(0.9f, 0f, 0f));
            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(camera.orthographic, "Review camera is not orthographic");
            Require(Mathf.Abs(camera.orthographicSize - 3.6f) < 0.001f, "Review camera size changed");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)new Color(0.20f, 0.27f, 0.35f)) < 0.002f, "Review camera background changed");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights == 2, $"Review scene expects two directional lights, found {lights}");
        }

        private static void VerifyInstance(GameObject[] roots, string name, string prefabPath, Vector3 position)
        {
            var instance = roots.SingleOrDefault(root => root.name == name);
            Require(instance != null, $"Review scene is missing the {name} instance");
            var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
            Require(source != null && AssetDatabase.GetAssetPath(source) == prefabPath,
                $"{name} is not an instance of {prefabPath}");
            Near(instance.transform.position, position, $"{name} placement");
            var renderers = instance.GetComponentsInChildren<MeshRenderer>();
            Require(renderers.Length > 0, $"{name} instance has no renderers");
        }

        private static string SceneSummary()
        {
            var scene = EditorSceneManager.GetActiveScene();
            var roots = scene.GetRootGameObjects();
            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            var background = camera?.backgroundColor ?? Color.clear;
            return $"sceneRoots={roots.Length} camera=ortho:{camera?.orthographicSize:F2}"
                + $" bg=({background.r:F2},{background.g:F2},{background.b:F2})"
                + $" lights={roots.Sum(root => root.GetComponents<Light>().Length)}";
        }

        private static string Describe(Variant variant) =>
            $"{variant.manifest.id} bounds={variant.bounds.size.x:F3}x{variant.bounds.size.y:F3}x{variant.bounds.size.z:F3}m"
            + $" min={Format(variant.bounds.min)} max={Format(variant.bounds.max)}"
            + $" {variant.triangles}tri {variant.materials.Length}mat {variant.textures}tex"
            + $" suspension={(variant.manifest.hasSuspension ? $"{variant.manifest.suspensionLength:F2}m" : "none")}";

        private static string Format(Vector3 value) => $"({value.x:F3},{value.y:F3},{value.z:F3})";

        private static void ImportVariant(Variant variant, string evidence)
        {
            var manifestPath = Path.Combine(evidence, "export", variant.key + ".manifest.json");
            var glbPath = Path.Combine(evidence, "export", variant.key + ".glb");
            Require(File.Exists(manifestPath), $"Missing {manifestPath}");
            Require(File.Exists(glbPath), $"Missing {glbPath}");
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(manifestPath));
            Require(manifest != null && manifest.id != null, $"Unreadable manifest {manifestPath}");
            Require(manifest.file == variant.key + ".glb", $"{variant.key}: manifest names {manifest.file}");
            Require(manifest.w == 4, $"{variant.key}: expected the 4 m catalogue run, got w={manifest.w}");
            Require(manifest.anchors != null && manifest.anchors.AxisX != null && manifest.anchors.Front != null && manifest.anchors.Up != null,
                $"{variant.key}: manifest is missing the basis anchors");

            byte[] bytes = File.ReadAllBytes(glbPath);
            string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            Require(digest == manifest.sha256, $"{variant.key}: GLB digest differs from the validated manifest");

            if (!File.Exists(variant.modelPath) || !bytes.SequenceEqual(File.ReadAllBytes(variant.modelPath)))
                File.WriteAllBytes(variant.modelPath, bytes);
            AssetDatabase.ImportAsset(variant.modelPath, ImportAssetOptions.ForceSynchronousImport);
            var imported = AssetDatabase.LoadAssetAtPath<GameObject>(variant.modelPath);
            Require(imported != null, $"{variant.key}: glTFast did not produce a model");

            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var root = new GameObject(variant.prefabName);
            var orientation = new GameObject("Unity basis").transform;
            orientation.SetParent(root.transform, false);
            PrefabUtility.InstantiatePrefab(imported, orientation);
            // Export rotates source Z-up to glTF Y-up, then glTFast reflects X.
            // The wrapper turns X and Z back to the gameplay convention (x,z,y).
            orientation.localRotation = Quaternion.Euler(0, 180, 0);

            CheckAnchor(root, "AxisX", Basis(manifest.anchors.AxisX));
            CheckAnchor(root, "Front", Basis(manifest.anchors.Front));
            CheckAnchor(root, "Up", Basis(manifest.anchors.Up));

            var renderers = root.GetComponentsInChildren<MeshRenderer>();
            Require(renderers.Length > 0, $"{variant.key}: imported model has no mesh renderers");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
            Near(bounds.min, Basis(manifest.min), $"{variant.key} minimum bounds");
            Near(bounds.max, Basis(manifest.max), $"{variant.key} maximum bounds");
            Near(bounds.size, Basis(manifest.max) - Basis(manifest.min), $"{variant.key} size");

            int triangles = root.GetComponentsInChildren<MeshFilter>().Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == manifest.triangles, $"{variant.key}: expected {manifest.triangles} triangles, got {triangles}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(manifest.materials), $"{variant.key}: unexpected materials {string.Join(", ", materials)}");
            foreach (var material in importedMaterials)
            {
                if (manifest.alphaMaterials != null && manifest.alphaMaterials.Contains(material.name))
                    Require(material.renderQueue >= (int)RenderQueue.Transparent, $"{variant.key}: {material.name} lost its transparent queue");
            }
            var textures = importedMaterials
                .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length == manifest.textures, $"{variant.key}: expected {manifest.textures} textures, got {textures.Length}");

            var axisX = FindAnchor(root, "AxisX");
            var front = FindAnchor(root, "Front");
            var up = FindAnchor(root, "Up");
            for (int i = 0; i < 4; i++)
            {
                var rotation = Quaternion.Euler(0, i * 90, 0);
                root.transform.rotation = rotation;
                Near(axisX.position, rotation * Basis(manifest.anchors.AxisX), $"{variant.key} AxisX at facing {i}");
                Near(front.position, rotation * Basis(manifest.anchors.Front), $"{variant.key} Front at facing {i}");
                Near(up.position, rotation * Basis(manifest.anchors.Up), $"{variant.key} Up at facing {i}");
            }
            root.transform.rotation = Quaternion.identity;

            Require(PrefabUtility.SaveAsPrefabAsset(root, variant.prefabPath) != null, $"{variant.key}: could not save wrapper prefab");
            variant.prefab = AssetDatabase.LoadAssetAtPath<GameObject>(variant.prefabPath);
            Require(variant.prefab != null, $"{variant.key}: wrapper prefab did not load back");
            UnityEngine.Object.DestroyImmediate(root);

            variant.manifest = manifest;
            variant.bounds = bounds;
            variant.triangles = triangles;
            variant.materials = materials;
            variant.textures = textures.Length;
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
