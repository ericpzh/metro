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
    /// Import the nine staircase GLBs exported by export-stair.mjs, wrap each in a
    /// prefab under the Unity gameplay basis, verify bounds/materials/glass queues/
    /// anchors and save one review scene with all nine pieces in a row.
    ///
    /// The family covers the single-run stair, the 1 m 楼梯块, the three aligned
    /// forward shapes, the two quarter turns and the two switchbacks. Bounds are
    /// large and differ by style: a straight run is about 1 × 8.25 × 6.3 m, a
    /// quarter turn 4.6 × 4.6 m, a switchback 2 × 4.65 m and the block 1 m cube.
    /// </summary>
    public static class ReviewStair
    {
        private const string Folder = "Assets/StairProof";
        private const string Scene = Folder + "/Stair.unity";

        /// <summary>Row pitch between prefab pivots, metres.</summary>
        private const float Spacing = 9f;

        /// <summary>
        /// Every run extends up to 8.25 m toward −x from its pivot, so the drawn row
        /// spans about 80 m from this centre (pivots −36 … 36).
        /// </summary>
        private const float RowCentre = -4.5f;

        /// <summary>The review camera must see the whole row: 250 m far plane.</summary>
        private const float FarPlane = 250f;

        [Serializable]
        private class Manifest
        {
            public Asset[] assets;
            public Parameters parameters;
        }

        [Serializable]
        private class Parameters
        {
            public float storeyHeightMetres, widthMetres, blockWidthMetres, rampRiseMetres;
            public int rampRunCells;
            public string widthToken, rampLength, finishMaterial;
        }

        [Serializable]
        private class Asset
        {
            public string id, paletteId, variant, style, file, prefab, sha256, finish;
            public float[] min, max;
            public int triangles, meshes, textures;
            public string[] materials, alphaMaterials, glassMaterials;
            public float storeyHeightMetres, widthMetres, rampRiseMetres;
            public int rampRunCells;
            public Anchors anchors;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            var manifest = JsonUtility.FromJson<Manifest>(
                File.ReadAllText(Path.Combine(evidence, "export", "manifest.json")));
            Require(manifest?.assets != null, "The stair manifest has no asset list");
            Require(manifest.assets.Length == 9, $"Expected nine stair variants, got {manifest.assets.Length}");

            // Canonical placement parameters: default five-metre storey, the narrow
            // palette size (one 1 m block), and the default 长 single-span ramp.
            Require(Mathf.Approximately(manifest.parameters.storeyHeightMetres, 5f),
                $"Unexpected storey height {manifest.parameters.storeyHeightMetres}");
            Require(Mathf.Approximately(manifest.parameters.widthMetres, 0.68f),
                $"Unexpected narrow width {manifest.parameters.widthMetres}");
            Require(manifest.parameters.widthToken == "narrow",
                $"Unexpected width token {manifest.parameters.widthToken}");
            Require(Mathf.Approximately(manifest.parameters.blockWidthMetres, 1f),
                $"Unexpected block width {manifest.parameters.blockWidthMetres}");
            Require(manifest.parameters.rampLength == "long",
                $"Unexpected ramp length {manifest.parameters.rampLength}");
            Require(Mathf.Approximately(manifest.parameters.rampRiseMetres, 5f),
                $"Unexpected ramp rise {manifest.parameters.rampRiseMetres}");
            Require(manifest.parameters.rampRunCells == 8,
                $"Unexpected ramp run {manifest.parameters.rampRunCells}");
            Require(manifest.parameters.finishMaterial == "stairFinish",
                $"Unexpected finish material {manifest.parameters.finishMaterial}");

            Directory.CreateDirectory(Folder);
            var summary = new System.Collections.Generic.List<string>();
            foreach (var asset in manifest.assets)
            {
                string model = $"{Folder}/{asset.file}";
                byte[] bytes = File.ReadAllBytes(Path.Combine(evidence, "export", asset.file));
                string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                Require(digest == asset.sha256, $"{asset.variant}: GLB digest differs from the validated manifest");
                if (!File.Exists(model) || !bytes.SequenceEqual(File.ReadAllBytes(model)))
                    File.WriteAllBytes(model, bytes);

                AssetDatabase.ImportAsset(model, ImportAssetOptions.ForceSynchronousImport);
                var imported = AssetDatabase.LoadAssetAtPath<GameObject>(model);
                Require(imported != null, $"{asset.variant}: glTFast did not produce a model");

                // Build the wrapper prefab in a clean scene: basis parent rotated
                // 180 degrees about Y, as in ReviewBin/ReviewBench/ReviewCctv.
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
                var root = new GameObject(Path.GetFileNameWithoutExtension(asset.prefab));
                var orientation = new GameObject("Unity basis").transform;
                orientation.SetParent(root.transform, false);
                PrefabUtility.InstantiatePrefab(imported, orientation);
                // Export rotates source Z-up to glTF Y-up, then glTFast reflects X.
                // The wrapper turns X and Z back to the gameplay convention (x,z,y).
                orientation.localRotation = Quaternion.Euler(0, 180, 0);

                CheckAnchor(root, "AxisX", Basis(asset.anchors.AxisX));
                CheckAnchor(root, "Front", Basis(asset.anchors.Front));
                CheckAnchor(root, "Up", Basis(asset.anchors.Up));
                CheckAnchor(root, "Approach", Basis(asset.anchors.Approach));

                var renderers = root.GetComponentsInChildren<MeshRenderer>();
                Require(renderers.Length > 0, $"{asset.variant}: imported model has no mesh renderers");
                var bounds = renderers[0].bounds;
                foreach (var renderer in renderers)
                    bounds.Encapsulate(renderer.bounds);
                Near(bounds.min, Basis(asset.min), $"{asset.variant} minimum bounds");
                Near(bounds.max, Basis(asset.max), $"{asset.variant} maximum bounds");

                int triangles = root.GetComponentsInChildren<MeshFilter>().Sum(filter => filter.sharedMesh.triangles.Length / 3);
                Require(triangles == asset.triangles,
                    $"{asset.variant}: expected {asset.triangles} triangles, got {triangles}");

                var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
                var materials = importedMaterials.Select(material => material.name)
                    .OrderBy(name => name, StringComparer.Ordinal).ToArray();
                Require(materials.SequenceEqual(asset.materials),
                    $"{asset.variant}: unexpected materials {string.Join(", ", materials)}");

                // The glass balustrade infill must stay in the transparent queue; a
                // stair with opaque glass would cut the flight in half visually.
                foreach (var glassName in asset.glassMaterials)
                {
                    var glass = importedMaterials.Single(material => material.name == glassName);
                    bool transparent = Array.IndexOf(asset.alphaMaterials, glassName) >= 0;
                    if (transparent)
                        Require(glass.renderQueue >= (int)RenderQueue.Transparent,
                            $"{asset.variant}: {glassName} lost its transparent queue ({glass.renderQueue})");
                    else
                        Require(glass.renderQueue < (int)RenderQueue.Transparent,
                            $"{asset.variant}: {glassName} should be opaque ({glass.renderQueue})");
                }

                // The stainless grain is the family's only texture; the block is one
                // solid concrete finish and carries none.
                var textures = importedMaterials
                    .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                    .Where(texture => texture != null).Distinct().ToArray();
                Require(textures.Length == asset.textures,
                    $"{asset.variant}: expected {asset.textures} textures, got {textures.Length}");

                var front = FindAnchor(root, "Front");
                var approach = FindAnchor(root, "Approach");
                for (int i = 0; i < 4; i++)
                {
                    var rotation = Quaternion.Euler(0, i * 90, 0);
                    root.transform.rotation = rotation;
                    Near(front.position, rotation * Vector3.forward, $"{asset.variant} front at facing {i}");
                    Near(approach.position, rotation * Vector3.back, $"{asset.variant} approach at facing {i}");
                }
                root.transform.rotation = Quaternion.identity;

                string prefabPath = $"{Folder}/{asset.prefab}";
                Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null,
                    $"{asset.variant}: could not save wrapper prefab");
                UnityEngine.Object.DestroyImmediate(root);

                summary.Add($"{asset.variant}={triangles}t/{asset.materials.Length}m/{asset.alphaMaterials.Length}a");
            }

            // Unity assigns fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene would never be byte-identical between two imports.
            // The scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above and referenced by GUID, so keep the first
            // generated scene and only create it when it is missing.
            if (!File.Exists(Scene))
                BuildReviewScene(manifest.assets);

            Debug.Log($"STAIR_IMPORT_OK {manifest.assets.Length} variants {string.Join(" ", summary)} row={-36f}..{36f}");
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

        /// <summary>
        /// One review scene: all nine wrapper prefabs in a row, framed together.
        /// Each piece is turned a quarter turn so its run lies along the row; the
        /// 9 m pitch clears the longest 8.25 m flight. Only called when the scene
        /// does not exist (see the note in Import).
        /// </summary>
        private static void BuildReviewScene(Asset[] assets)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < assets.Length; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>($"{Folder}/{assets[i].prefab}");
                Require(prefab != null, $"Missing prefab for {assets[i].variant}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.name = assets[i].prefab.Replace(".prefab", string.Empty);
                instance.transform.position = new Vector3(-36f + i * Spacing, 0, 0);
                instance.transform.rotation = Quaternion.Euler(0, -90, 0);
            }

            // High and far enough to frame the ~80 m row (fov 46, 16:9 → ~100 m
            // across at the row); the far plane covers the whole review distance.
            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = new Vector3(RowCentre, 38f, -62f);
            camera.transform.LookAt(new Vector3(RowCentre, 3.8f, 0));
            camera.fieldOfView = 46;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = FarPlane;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.22f, 0.30f, 0.38f);

            var light = new GameObject("Key light").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 2.4f;
            light.transform.rotation = Quaternion.Euler(35, -35, 0);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.4f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the stair review scene");
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
