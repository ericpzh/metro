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
    /// Import the eleven 玻璃板 / 玻璃幕墙 GLBs exported by export-glass.mjs, wrap
    /// each in a prefab under the Unity gameplay basis, verify digest, bounds,
    /// triangles, materials, render queues and anchors at four facings, and save
    /// one review scene with all eleven panels in a row.
    /// </summary>
    public static class ReviewGlass
    {
        private const string Folder = "Assets/GlassProof";
        private const string Scene = Folder + "/Glass.unity";
        /// <summary>The ten 玻璃板 sizes plus the default 2 x 4 m 玻璃幕墙.</summary>
        private const int ExpectedModels = 11;
        /// <summary>Row pitch: the widest exported panel is 4 m.</summary>
        private const float RowSpacing = 4.5f;
        private const float WallOffsetMetres = 0.44f;

        /// <summary>The canvas / floor edge the panel hangs off or stands on.</summary>
        private static readonly string[] OpaqueMetals = { "darkSteel", "steel" };
        private static readonly string[] GlassMaterialNames = { "glass" };

        [Serializable]
        private class Manifest
        {
            public Asset[] assets;
            public Parameters parameters;
        }

        [Serializable]
        private class Parameters
        {
            public int models;
            public float wallOffsetMetres;
            public float floorStandingFromHeightMetres;
            public Frame frame;
            public CurtainWall curtainWall;
            public string stationData, rotation;
        }

        [Serializable]
        private class Frame
        {
            public float depth, rail, post, pane;
        }

        [Serializable]
        private class CurtainWall
        {
            public float widthMetres, heightMetres;
            public string settings, sharesBuilderWith;
        }

        [Serializable]
        private class Asset
        {
            public string id, catalogueId, paletteId, variant, prefab, file, sha256, mount;
            public float[] min, max;
            public float widthMetres, heightMetres, wallOffsetMetres, curtainHeightMetres;
            public int triangles, meshes, textures;
            public string[] materials, alphaMaterials, glassMaterials;
            public Anchors anchors;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        /// <summary>The eleven catalogue sizes this family must deliver.</summary>
        private static readonly Model[] Models =
        {
            new Model("glass-1x1", 1, 1, "Glass1x1", "station.glass.panel-1x1"),
            new Model("glass-1x2", 1, 2, "Glass1x2", "station.glass.panel-1x2"),
            new Model("glass-1x4", 1, 4, "Glass1x4", "station.glass.panel-1x4"),
            new Model("glass-2x1", 2, 1, "Glass2x1", "station.glass.panel-2x1"),
            new Model("glass-2x2", 2, 2, "Glass2x2", "station.glass.panel-2x2"),
            new Model("glass-2x4", 2, 4, "Glass2x4", "station.glass.panel-2x4"),
            new Model("glass-3x1", 3, 1, "Glass3x1", "station.glass.panel-3x1"),
            new Model("glass-3x2", 3, 2, "Glass3x2", "station.glass.panel-3x2"),
            new Model("glass-3x4", 3, 4, "Glass3x4", "station.glass.panel-3x4"),
            new Model("glass-4x4", 4, 4, "Glass4x4", "station.glass.panel-4x4"),
            new Model("curtain-wall", 2, 4, "CurtainWall", "station.glass.curtain-wall"),
        };

        private class Model
        {
            public readonly string paletteId, prefab, id;
            public readonly int width, height;

            public Model(string paletteId, int width, int height, string prefab, string id)
            {
                this.paletteId = paletteId;
                this.width = width;
                this.height = height;
                this.prefab = prefab;
                this.id = id;
            }

            public bool FloorStanding => height >= 4;
        }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            var manifest = JsonUtility.FromJson<Manifest>(
                File.ReadAllText(Path.Combine(evidence, "export", "manifest.json")));
            Require(manifest?.assets != null, "Unreadable glass manifest");
            Require(manifest.assets.Length == ExpectedModels,
                $"Expected {ExpectedModels} glass models in the manifest, got {manifest.assets?.Length ?? 0}");

            // Family parameters: the size table, the wall stand-off and the frame
            // members decide everything the exported panels should be.
            var parameters = manifest.parameters;
            Require(parameters != null, "Manifest is missing its family parameters");
            Require(parameters.models == ExpectedModels, $"Expected {ExpectedModels} models in the parameters, got {parameters.models}");
            Require(Near(parameters.wallOffsetMetres, WallOffsetMetres),
                $"Unexpected wall stand-off: {parameters.wallOffsetMetres}");
            Require(Near(parameters.floorStandingFromHeightMetres, 4f),
                $"Unexpected floor-standing threshold: {parameters.floorStandingFromHeightMetres}");
            Require(parameters.frame != null, "Manifest is missing the frame members");
            Require(Near(parameters.frame.depth, 0.1f), $"Unexpected frame depth: {parameters.frame.depth}");
            Require(Near(parameters.frame.rail, 0.1f), $"Unexpected frame rail: {parameters.frame.rail}");
            Require(Near(parameters.frame.post, 0.1f), $"Unexpected frame post: {parameters.frame.post}");
            Require(Near(parameters.frame.pane, 0.02f), $"Unexpected pane stand-off: {parameters.frame.pane}");
            var curtain = parameters.curtainWall;
            Require(curtain != null, "Manifest is missing the 玻璃幕墙 parameters");
            Require(Near(curtain.widthMetres, 2f) && Near(curtain.heightMetres, 4f),
                $"Unexpected curtain wall size: {curtain.widthMetres} x {curtain.heightMetres}");
            Require(curtain.sharesBuilderWith == "glass-2x4",
                $"Unexpected curtain wall builder sharing: {curtain.sharesBuilderWith}");

            Directory.CreateDirectory(Folder);
            var summary = new System.Collections.Generic.List<string>();
            foreach (var model in Models)
            {
                var asset = manifest.assets.SingleOrDefault(candidate => candidate.paletteId == model.paletteId);
                Require(asset != null, $"{model.paletteId}: no matching manifest asset");
                Require(asset.id == model.id, $"{model.paletteId}: manifest id {asset.id}");
                Require(asset.prefab == model.prefab, $"{model.paletteId}: manifest prefab {asset.prefab}");
                Require(Near(asset.widthMetres, model.width),
                    $"{model.paletteId}: expected width {model.width}, manifest says {asset.widthMetres}");
                Require(Near(asset.heightMetres, model.height),
                    $"{model.paletteId}: expected height {model.height}, manifest says {asset.heightMetres}");
                Require(asset.mount == (model.FloorStanding ? "floor-edge" : "wall"),
                    $"{model.paletteId}: unexpected mount {asset.mount}");
                // Wall panels hang 0.44 m off the local -y wall; floor-standing ones
                // sit on the edge tile, so their own stand-off is zero.
                Require(Near(asset.wallOffsetMetres, model.FloorStanding ? 0f : WallOffsetMetres),
                    $"{model.paletteId}: unexpected wall offset {asset.wallOffsetMetres}");
                if (model.paletteId == "curtain-wall")
                    Require(Near(asset.curtainHeightMetres, 4f),
                        $"curtain-wall: expected the 4 m curtain height, got {asset.curtainHeightMetres}");
                else
                    Require(Near(asset.curtainHeightMetres, 0f),
                        $"{model.paletteId}: plain 玻璃板 should carry no curtain height");
                summary.Add(ImportModel(model, asset, evidence));
            }

            // Unity mints fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene would never be byte-identical between two
            // imports. The scene is a pure view over the wrapper prefabs, which
            // are rebuilt deterministically above and referenced by GUID, so keep
            // the first generated scene and only create it when it is missing.
            if (!File.Exists(Scene)) BuildReviewScene();
            Require(AssetDatabase.LoadAssetAtPath<SceneAsset>(Scene) != null, "Review scene did not import");

            Debug.Log($"GLASS_IMPORT_OK {manifest.assets.Length} models {string.Join(" ", summary)}"
                + $" row={RowX(0):F1}..{RowX(Models.Length - 1):F1} scene={Scene}");
        }

        /// <summary>Verify one GLB, rebuild its wrapper prefab and return its log token.</summary>
        private static string ImportModel(Model model, Asset asset, string evidence)
        {
            string modelPath = $"{Folder}/{asset.file}";
            byte[] bytes = File.ReadAllBytes(Path.Combine(evidence, "export", asset.file));
            string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            Require(digest == asset.sha256, $"{model.paletteId}: GLB digest differs from the validated manifest");
            if (!File.Exists(modelPath) || !bytes.SequenceEqual(File.ReadAllBytes(modelPath)))
                File.WriteAllBytes(modelPath, bytes);

            AssetDatabase.ImportAsset(modelPath, ImportAssetOptions.ForceSynchronousImport);
            var imported = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            Require(imported != null, $"{model.paletteId}: glTFast did not produce a model");

            // Build the wrapper prefab in a clean scene: basis parent rotated
            // 180 degrees about Y, as in ReviewCctv/ReviewHanger/ReviewBin.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var root = new GameObject(model.prefab);
            var orientation = new GameObject("Unity basis").transform;
            orientation.SetParent(root.transform, false);
            PrefabUtility.InstantiatePrefab(imported, orientation);
            // Export rotates source Z-up to glTF Y-up, then glTFast reflects X.
            // The wrapper turns X and Z back to the gameplay convention (x,z,y).
            orientation.localRotation = Quaternion.Euler(0, 180, 0);

            CheckAnchor(root, "AxisX", Basis(asset.anchors.AxisX), model.paletteId);
            CheckAnchor(root, "Front", Basis(asset.anchors.Front), model.paletteId);
            CheckAnchor(root, "Up", Basis(asset.anchors.Up), model.paletteId);
            CheckAnchor(root, "Approach", Basis(asset.anchors.Approach), model.paletteId);

            var renderers = root.GetComponentsInChildren<MeshRenderer>();
            Require(renderers.Length == asset.meshes,
                $"{model.paletteId}: expected {asset.meshes} mesh renderers, got {renderers.Length}");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
            Near(bounds.min, Basis(asset.min), $"{model.paletteId} minimum bounds");
            Near(bounds.max, Basis(asset.max), $"{model.paletteId} maximum bounds");

            int triangles = root.GetComponentsInChildren<MeshFilter>().Sum(filter => filter.sharedMesh.triangles.Length / 3);
            // 5 boxes x 12 triangles: sill, head, two posts, one pane.
            Require(triangles == asset.triangles,
                $"{model.paletteId}: expected {asset.triangles} triangles, got {triangles}");
            Require(triangles == 60, $"{model.paletteId}: expected 60 triangles for the outer frame, got {triangles}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(asset.materials),
                $"{model.paletteId}: unexpected materials {string.Join(", ", materials)} "
                + $"({string.Join(", ", asset.materials)} expected)");
            Require(materials.SequenceEqual(new[] { "darkSteel", "glass", "steel" }),
                $"{model.paletteId}: expected the darkSteel/glass/steel palette set");
            Require(asset.alphaMaterials != null && asset.alphaMaterials.SequenceEqual(GlassMaterialNames),
                $"{model.paletteId}: expected the pane as the only alpha material");
            Require(asset.glassMaterials != null && asset.glassMaterials.SequenceEqual(GlassMaterialNames),
                $"{model.paletteId}: expected one glass material");

            // The pane sorts in the transparent queue; the two metal frame
            // materials must stay opaque.
            foreach (var glassName in asset.glassMaterials)
            {
                var glass = importedMaterials.Single(material => material.name == glassName);
                Require(glass.renderQueue >= (int)RenderQueue.Transparent,
                    $"{model.paletteId}: {glassName} lost its transparent queue ({glass.renderQueue})");
            }
            foreach (var metal in OpaqueMetals)
            {
                var material = importedMaterials.Single(candidate => candidate.name == metal);
                Require(material.renderQueue < (int)RenderQueue.Transparent,
                    $"{model.paletteId}: {metal} should be opaque, queue is {material.renderQueue}");
            }

            var textures = importedMaterials
                .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length == asset.textures,
                $"{model.paletteId}: expected {asset.textures} textures, got {textures.Length}");

            var axisX = FindAnchor(root, "AxisX");
            var front = FindAnchor(root, "Front");
            var up = FindAnchor(root, "Up");
            var approach = FindAnchor(root, "Approach");
            for (int i = 0; i < 4; i++)
            {
                var rotation = Quaternion.Euler(0, i * 90, 0);
                root.transform.rotation = rotation;
                Near(axisX.position, rotation * Basis(asset.anchors.AxisX), $"{model.paletteId} AxisX at facing {i}");
                Near(front.position, rotation * Basis(asset.anchors.Front), $"{model.paletteId} Front at facing {i}");
                Near(up.position, rotation * Basis(asset.anchors.Up), $"{model.paletteId} Up at facing {i}");
                Near(approach.position, rotation * Basis(asset.anchors.Approach), $"{model.paletteId} Approach at facing {i}");
            }
            root.transform.rotation = Quaternion.identity;

            string prefabPath = $"{Folder}/{asset.prefab}.prefab";
            Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null,
                $"{model.paletteId}: could not save the wrapper prefab");
            UnityEngine.Object.DestroyImmediate(root);

            return $"{model.paletteId}={triangles}t/{materials.Length}m/{asset.alphaMaterials.Length}a";
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

        /// <summary>Row position of the i-th panel; the row is centred on x = 0.</summary>
        private static float RowX(int index) => (index - (Models.Length - 1) / 2f) * RowSpacing;

        /// <summary>
        /// One review scene: all eleven wrapper prefabs in a row, framed together.
        /// Only called when the scene does not exist (see the note in Import).
        /// </summary>
        private static void BuildReviewScene()
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < Models.Length; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>($"{Folder}/{Models[i].prefab}.prefab");
                Require(prefab != null, $"Missing prefab for {Models[i].paletteId}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.name = Models[i].prefab;
                instance.transform.position = new Vector3(RowX(i), 0, 0);
                instance.transform.rotation = Quaternion.identity;
            }

            var roots = EditorSceneManager.GetActiveScene().GetRootGameObjects();
            Require(roots.Length == Models.Length, $"Review scene has {roots.Length} roots, expected {Models.Length}");
            int renderers = roots.Sum(root => root.GetComponentsInChildren<MeshRenderer>().Length);
            Require(renderers == Models.Length * 5, $"Review scene has {renderers} mesh renderers, expected {Models.Length * 5}");

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = new Vector3(0, 7.5f, -46f);
            camera.transform.LookAt(new Vector3(0, 2.4f, 0));
            camera.fieldOfView = 40;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 200;
            camera.clearFlags = CameraClearFlags.SolidColor;
            // Slate clear colour: the Web check proves the 3D scene replaced the
            // Unity splash by finding this exact blue-green.
            camera.backgroundColor = new Color(0.22f, 0.30f, 0.38f);

            var light = new GameObject("Key light").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 2.4f;
            light.transform.rotation = Quaternion.Euler(35, -35, 0);
            // A dim fill keeps the pane's outer frame readable against the wall
            // side; the panes are transparent, so they need light from the front.
            var fill = new GameObject("Fill light").AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 0.9f;
            fill.transform.rotation = Quaternion.Euler(12, 155, 0);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.45f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the glass review scene");
            Debug.Log($"Glass review scene: {Models.Length} panels, pitch {RowSpacing}m, "
                + $"camera far {camera.farClipPlane}, background slate");
        }

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        private static void CheckAnchor(GameObject root, string name, Vector3 expected, string label) =>
            Near(FindAnchor(root, name).position, expected, $"{label} {name}");

        private static void Near(Vector3 actual, Vector3 expected, string field) =>
            Require(Vector3.Distance(actual, expected) < 0.001f, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static bool Near(float actual, float expected) => Mathf.Abs(actual - expected) < 0.0005f;

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
