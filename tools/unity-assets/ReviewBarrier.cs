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
    /// Import the ten 围栏 / 隔音屏障 / 盲道 (fence, noise barrier and tactile) GLBs
    /// exported by export-barrier.mjs, wrap each in a prefab, verify
    /// bounds/materials/anchors/facings and save one review scene with all ten
    /// models in a row.
    /// </summary>
    public static class ReviewBarrier
    {
        private const string Folder = "Assets/BarrierProof";
        private const string Scene = Folder + "/Barrier.unity";
        private const int ExpectedAssets = 10;
        private const float RowSpacing = 1.4f;

        /// <summary>Row positions: ten pieces at 1.4 m spacing, centred on the origin.</summary>
        private static readonly float[] RowX = BuildRow();

        [Serializable]
        private class Manifest
        {
            public Asset[] assets;
            public Parameters parameters;
        }

        [Serializable]
        private class Parameters
        {
            public int assetCount, rot, tactileWarningStripInstances;
            public float fencePanelPitchMetres, fencePanelWidthMetres;
            public float soundBarrierHeightMetres, soundBarrierHalfHeightMetres, bridgeRailingHeightMetres;
            public float tactileTileWidthMetres, tactileTileDepthMetres, tactileTileThicknessMetres;
            public bool isolatedPanel, tactileDotsMerged;
            public string stationData, runtimeComposition, noiseBarrierGeometry, tactileDots, tactileBasis, basis;
        }

        [Serializable]
        private class Asset
        {
            public string id, paletteId, variant, file, prefab, sha256;
            public float[] min, max, sizeMetres;
            public int triangles, meshes, textures, dotInstances, dotTriangles;
            public string[] materials, alphaMaterials, glassMaterials;
            public Anchors anchors;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        private static float[] BuildRow()
        {
            var row = new float[ExpectedAssets];
            for (int i = 0; i < row.Length; i++) row[i] = (i - (row.Length - 1) / 2f) * RowSpacing;
            return row;
        }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            var manifest = JsonUtility.FromJson<Manifest>(
                File.ReadAllText(Path.Combine(evidence, "export", "manifest.json")));
            Require(manifest?.assets != null && manifest.assets.Length == ExpectedAssets,
                $"Expected {ExpectedAssets} barrier models in the manifest");
            var parameters = manifest.parameters;
            Require(parameters != null, "The manifest is missing its family parameters");
            Require(parameters.assetCount == ExpectedAssets, "The family parameter assetCount is not 10");
            Require(parameters.rot == 0, "The family was exported at rot 0");
            Require(parameters.isolatedPanel, "The fence family must be exported as one isolated panel");
            Require(parameters.tactileDotsMerged, "The tactile dot field must be merged before export");
            Require(parameters.tactileWarningStripInstances == 60,
                $"Unexpected warning-strip dot count {parameters.tactileWarningStripInstances}");
            Near(parameters.fencePanelPitchMetres, 1f, "fence panel pitch");
            Near(parameters.fencePanelWidthMetres, 1.03f, "isolated fence panel width");
            Near(parameters.soundBarrierHeightMetres, 3f, "sound-barrier height");
            Near(parameters.soundBarrierHalfHeightMetres, 1.5f, "half-height sound-barrier height");
            Near(parameters.bridgeRailingHeightMetres, 0.74f, "bridge-railing height");
            Near(parameters.tactileTileWidthMetres, 1f, "tactile tile width");
            Near(parameters.tactileTileDepthMetres, 0.45f, "tactile tile depth");
            Near(parameters.tactileTileThicknessMetres, 0.012f, "tactile tile thickness");
            Require(!string.IsNullOrEmpty(parameters.runtimeComposition)
                && parameters.runtimeComposition.Contains("runtime composition"),
                "The manifest must state that fence runs and joins are runtime composition");
            Require(!string.IsNullOrEmpty(parameters.noiseBarrierGeometry)
                && parameters.noiseBarrierGeometry.Contains("buildBridgeNoiseBarrier"),
                "The manifest must record the reused bridge barrier geometry");

            Directory.CreateDirectory(Folder);
            var summary = new System.Collections.Generic.List<string>();
            foreach (var asset in manifest.assets)
            {
                Require(!string.IsNullOrEmpty(asset.id) && !string.IsNullOrEmpty(asset.file),
                    "The manifest holds an asset without an id or file");

                string model = $"{Folder}/{asset.file}";
                byte[] bytes = File.ReadAllBytes(Path.Combine(evidence, "export", asset.file));
                string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                Require(digest == asset.sha256, $"{asset.id}: GLB digest differs from the validated manifest");
                if (!File.Exists(model) || !bytes.SequenceEqual(File.ReadAllBytes(model)))
                    File.WriteAllBytes(model, bytes);

                AssetDatabase.ImportAsset(model, ImportAssetOptions.ForceSynchronousImport);
                var imported = AssetDatabase.LoadAssetAtPath<GameObject>(model);
                Require(imported != null, $"{asset.id}: glTFast did not produce a model");

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
                Require(renderers.Length > 0, $"{asset.id}: imported model has no mesh renderers");
                var bounds = renderers[0].bounds;
                foreach (var renderer in renderers)
                    bounds.Encapsulate(renderer.bounds);
                Near(bounds.min, Basis(asset.min), $"{asset.id} minimum bounds", 0.001f);
                Near(bounds.max, Basis(asset.max), $"{asset.id} maximum bounds", 0.001f);

                // The tactile tiles are 12 mm thick, so keep the thin axis explicit;
                // every fence and barrier piece stands at least half a metre tall.
                if (asset.id.StartsWith("station.tactile.", StringComparison.Ordinal))
                    Require(asset.sizeMetres[2] > 0.005f && asset.sizeMetres[2] < 0.02f,
                        $"{asset.id}: unexpected tile thickness {asset.sizeMetres[2]:F4}");
                else
                    Require(asset.sizeMetres[2] > 0.5f,
                        $"{asset.id}: unexpected model height {asset.sizeMetres[2]:F4}");

                var filters = root.GetComponentsInChildren<MeshFilter>();
                Require(filters.Length > 0, $"{asset.id}: imported model has no meshes");
                int triangles = filters.Sum(filter => filter.sharedMesh == null ? 0 : filter.sharedMesh.triangles.Length / 3);
                Require(triangles == asset.triangles,
                    $"{asset.id}: expected {asset.triangles} triangles, got {triangles}");

                var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
                var materials = importedMaterials.Select(material => material.name)
                    .OrderBy(name => name, StringComparer.Ordinal).ToArray();
                Require(materials.SequenceEqual(asset.materials),
                    $"{asset.id}: unexpected materials {string.Join(", ", materials)}");

                // Glass sits in the transparent queue; every other slot (steel, white
                // concrete panels, dark steel fittings, tactile tiles) must stay opaque.
                foreach (var glassName in asset.glassMaterials)
                {
                    var glass = importedMaterials.Single(material => material.name == glassName);
                    Require(Array.IndexOf(asset.alphaMaterials, glassName) >= 0,
                        $"{asset.id}: {glassName} is not recorded as an alpha material");
                    Require(glass.renderQueue >= (int)RenderQueue.Transparent,
                        $"{asset.id}: {glassName} lost its transparent queue ({glass.renderQueue})");
                }
                foreach (var material in importedMaterials)
                {
                    if (Array.IndexOf(asset.alphaMaterials, material.name) >= 0) continue;
                    Require(material.renderQueue < (int)RenderQueue.Transparent,
                        $"{asset.id}: {material.name} should be opaque ({material.renderQueue})");
                }

                var textures = importedMaterials
                    .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                    .Where(texture => texture != null).Distinct().ToArray();
                Require(textures.Length == asset.textures,
                    $"{asset.id}: expected {asset.textures} textures, got {textures.Length}");

                // GLTFExporter drops InstancedMesh instances. The warning strip's
                // ~60 dot cylinders are merged into one ordinary mesh before export;
                // assert that mesh and its merged triangle count survived the import.
                if (asset.dotInstances > 0)
                {
                    var dots = filters.FirstOrDefault(filter => filter.gameObject.name.Contains("tactileDots"));
                    Require(dots != null && dots.sharedMesh != null,
                        $"{asset.id}: the merged tactile dot mesh is missing from the import");
                    int dotTriangles = dots.sharedMesh.triangles.Length / 3;
                    Require(dotTriangles == asset.dotTriangles,
                        $"{asset.id}: merged dot mesh has {dotTriangles} triangles, expected {asset.dotTriangles}");
                    Require(dotTriangles >= asset.dotInstances * 32,
                        $"{asset.id}: merged dot mesh does not cover every instance");
                }

                var front = FindAnchor(root, "Front");
                var approach = FindAnchor(root, "Approach");
                for (int i = 0; i < 4; i++)
                {
                    var rotation = Quaternion.Euler(0, i * 90, 0);
                    root.transform.rotation = rotation;
                    Near(front.position, rotation * Vector3.forward, $"{asset.id} front at facing {i}");
                    Near(approach.position, rotation * Vector3.back, $"{asset.id} approach at facing {i}");
                }
                root.transform.rotation = Quaternion.identity;

                string prefabPath = $"{Folder}/{asset.prefab}";
                Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null,
                    $"{asset.id}: could not save wrapper prefab");
                UnityEngine.Object.DestroyImmediate(root);

                summary.Add($"{asset.id}={triangles}t/{asset.materials.Length}m/{asset.alphaMaterials.Length}a/{asset.textures}x");
            }

            Require(manifest.assets.Select(asset => asset.id).Distinct().Count() == ExpectedAssets,
                "The manifest repeats a catalogue id");
            Require(summary.Count == ExpectedAssets, $"Expected {ExpectedAssets} imported prefabs, got {summary.Count}");

            // Unity assigns fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene would never be byte-identical between two imports.
            // The scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above and referenced by GUID, so keep the first
            // generated scene and only create it when it is missing.
            if (!File.Exists(Scene))
                BuildReviewScene(manifest.assets);

            Debug.Log($"BARRIER_IMPORT_OK {manifest.assets.Length} models {string.Join(" ", summary)} "
                + $"row={RowX[0]:F1}..{RowX[RowX.Length - 1]:F1}");
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
        /// One review scene: all ten wrapper prefabs in a row, framed together.
        /// The camera sits above and in front so the 3 m noise barriers and the
        /// flat 12 mm tactile tiles both read. Only called when the scene does not
        /// exist (see the note in Import).
        /// </summary>
        private static void BuildReviewScene(Asset[] assets)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < assets.Length; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>($"{Folder}/{assets[i].prefab}");
                Require(prefab != null, $"Missing prefab for {assets[i].id}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(RowX[i], 0, 0);
                instance.transform.rotation = Quaternion.identity;
            }

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = new Vector3(0f, 4.6f, -13f);
            camera.transform.LookAt(new Vector3(0f, 0.8f, 0f));
            camera.fieldOfView = 46;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 100;
            camera.clearFlags = CameraClearFlags.SolidColor;
            // Slate review clear colour, matching the other family reviews.
            camera.backgroundColor = new Color(0.22f, 0.30f, 0.38f);

            var light = new GameObject("Key light").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 2.4f;
            light.transform.rotation = Quaternion.Euler(40, -30, 0);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.5f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the barrier review scene");
        }

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        private static void CheckAnchor(GameObject root, string name, Vector3 expected) =>
            Near(FindAnchor(root, name).position, expected, name);

        private static void Near(Vector3 actual, Vector3 expected, string field, float tolerance = 0.001f) =>
            Require(Vector3.Distance(actual, expected) < tolerance,
                $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Near(float actual, float expected, string field, float tolerance = 0.01f) =>
            Require(Mathf.Abs(actual - expected) < tolerance, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
