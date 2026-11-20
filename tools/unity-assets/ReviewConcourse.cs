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
    /// Import and verify the concourse GLBs exported by export-concourse.mjs,
    /// including the four lengths of each checkout. The review scene shows the
    /// ten palette pieces.
    /// </summary>
    public static class ReviewConcourse
    {
        private const string Folder = "Assets/ConcourseProof";
        private const string Scene = Folder + "/Concourse.unity";
        private const int PaletteCount = 10;
        private const int CheckoutRunCount = 12;
        /// <summary>Row pitch: the widest piece is the 1.5 m glass cabinet.</summary>
        private const float RowSpacing = 2.4f;

        private static readonly float[] RowX =
            Enumerable.Range(0, PaletteCount).Select(i => (i - (PaletteCount - 1) / 2f) * RowSpacing).ToArray();

        [Serializable]
        private class Manifest
        {
            public string family;
            public Parameters parameters;
            public Asset[] assets;
        }

        [Serializable]
        private class Parameters
        {
            public int models;
            public string family;
            public float counterWidthMetres, counterLengthMetres, guidepostHeightMetres;
            public int guidepostPlateTextures;
            public ExtinguisherSpec[] extinguisherSpecs;
        }

        [Serializable]
        private class ExtinguisherSpec
        {
            public string variant;
            public float widthMetres, depthMetres, heightMetres;
            public int cells;
        }

        [Serializable]
        private class Asset
        {
            public string id, paletteId, variant, file, prefab, sha256, facade;
            public float[] min, max, size;
            public int triangles, meshes, textures;
            public string[] materials, alphaMaterials, glassMaterials;
            public Anchors anchors;
            public AssetParameters parameters;
        }

        [Serializable]
        private class AssetParameters
        {
            public string variant;
            public float counterWidthMetres, counterLengthMetres, widthMetres, depthMetres, heightMetres;
            public int cells, plateTextures;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            var manifest = JsonUtility.FromJson<Manifest>(
                File.ReadAllText(Path.Combine(evidence, "export", "manifest.json")));
            Require(manifest?.assets != null, "The concourse manifest has no assets");
            Require(manifest.assets.Length == PaletteCount + CheckoutRunCount,
                $"Expected {PaletteCount + CheckoutRunCount} concourse models, got {manifest.assets.Length}");
            Require(manifest.family == "concourse", $"Unexpected manifest family {manifest.family}");

            var parameters = manifest.parameters;
            Require(parameters != null, "The concourse manifest has no family parameters");
            Require(parameters.models == manifest.assets.Length, $"Unexpected model count {parameters.models}");
            Require(parameters.family == "concourse", $"Unexpected parameter family {parameters.family}");
            Require(Mathf.Approximately(parameters.counterWidthMetres, 1f), "Unexpected checkout counter width");
            Require(Mathf.Approximately(parameters.counterLengthMetres, 1f), "Unexpected checkout counter length");
            Require(Mathf.Approximately(parameters.guidepostHeightMetres, 4f), "Unexpected guidepost height");
            Require(parameters.guidepostPlateTextures == 7,
                $"Expected seven guidepost plate textures, got {parameters.guidepostPlateTextures}");
            Require(parameters.extinguisherSpecs != null && parameters.extinguisherSpecs.Length == 3,
                "Expected three extinguisher specs");
            CheckSpec(parameters, "standard", 0.743f, 0.534f, 1.1f, 1);
            CheckSpec(parameters, "compact", 0.5f, 0.35f, 0.5f, 1);
            CheckSpec(parameters, "glass", 1.5f, 0.5f, 2f, 2);

            Require(manifest.assets.Count(asset => asset.id.StartsWith("station.checkout.")) == 16,
                "Expected four checkout styles in four lengths");
            Require(manifest.assets.Count(asset => asset.id.StartsWith("station.extinguisher.")) == 3,
                "Expected three extinguisher variants");

            Directory.CreateDirectory(Folder);
            var summary = new System.Collections.Generic.List<string>();
            foreach (var asset in manifest.assets)
            {
                CheckAssetParameters(asset);
                CheckSize(asset);

                string model = $"{Folder}/{asset.file}";
                byte[] bytes = File.ReadAllBytes(Path.Combine(evidence, "export", asset.file));
                string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                Require(digest == asset.sha256, $"{asset.paletteId}: GLB digest differs from the validated manifest");
                if (!File.Exists(model) || !bytes.SequenceEqual(File.ReadAllBytes(model)))
                    File.WriteAllBytes(model, bytes);

                AssetDatabase.ImportAsset(model, ImportAssetOptions.ForceSynchronousImport);
                var imported = AssetDatabase.LoadAssetAtPath<GameObject>(model);
                Require(imported != null, $"{asset.paletteId}: glTFast did not produce a model");

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
                Require(renderers.Length > 0, $"{asset.paletteId}: imported model has no mesh renderers");
                var bounds = renderers[0].bounds;
                foreach (var renderer in renderers)
                    bounds.Encapsulate(renderer.bounds);
                Near(bounds.min, Basis(asset.min), $"{asset.paletteId} minimum bounds");
                Near(bounds.max, Basis(asset.max), $"{asset.paletteId} maximum bounds");
                Near(bounds.size, BasisSize(asset.size), $"{asset.paletteId} bounds size");

                int triangles = root.GetComponentsInChildren<MeshFilter>().Sum(filter => filter.sharedMesh.triangles.Length / 3);
                Require(triangles == asset.triangles,
                    $"{asset.paletteId}: expected {asset.triangles} triangles, got {triangles}");

                var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
                var materials = importedMaterials.Select(material => material.name)
                    .OrderBy(name => name, StringComparer.Ordinal).ToArray();
                Require(materials.SequenceEqual(asset.materials),
                    $"{asset.paletteId}: unexpected materials {string.Join(", ", materials)}");

                // Transparent slots must sort in the transparent queue; every other
                // slot stays opaque. The glass cabinet and the pastry case add real
                // glass, and the guidepost prints on three transparent plates.
                foreach (var material in importedMaterials)
                {
                    bool alpha = Array.IndexOf(asset.alphaMaterials, material.name) >= 0;
                    bool glass = Array.IndexOf(asset.glassMaterials, material.name) >= 0;
                    if (alpha || glass)
                        Require(material.renderQueue >= (int)RenderQueue.Transparent,
                            $"{asset.paletteId}: {material.name} lost its transparent queue ({material.renderQueue})");
                    else
                        Require(material.renderQueue < (int)RenderQueue.Transparent,
                            $"{asset.paletteId}: {material.name} should be opaque ({material.renderQueue})");
                }

                var textures = importedMaterials
                    .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                    .Where(texture => texture != null).Distinct().ToArray();
                Require(textures.Length == asset.textures,
                    $"{asset.paletteId}: expected {asset.textures} textures, got {textures.Length}");
                if (asset.paletteId == "guidepost")
                    Require(textures.Length == 7, $"guidepost: expected seven canvas plates, got {textures.Length}");

                CheckHierarchy(root, asset);
                for (int facing = 0; facing < 4; facing++)
                {
                    var rotation = Quaternion.Euler(0, facing * 90, 0);
                    root.transform.rotation = rotation;
                    CheckAnchorAt(root, "AxisX", rotation * Basis(asset.anchors.AxisX), facing);
                    CheckAnchorAt(root, "Front", rotation * Basis(asset.anchors.Front), facing);
                    CheckAnchorAt(root, "Up", rotation * Basis(asset.anchors.Up), facing);
                    CheckAnchorAt(root, "Approach", rotation * Basis(asset.anchors.Approach), facing);
                }
                root.transform.rotation = Quaternion.identity;

                string prefabPath = $"{Folder}/{asset.prefab}.prefab";
                Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null,
                    $"{asset.paletteId}: could not save wrapper prefab");
                UnityEngine.Object.DestroyImmediate(root);

                summary.Add($"{asset.paletteId}={triangles}t/{asset.materials.Length}m/{asset.textures}tex");
            }

            // Unity assigns fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene would never be byte-identical between two imports.
            // The scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above and referenced by GUID, so keep the first
            // generated scene and only create it when it is missing.
            if (!File.Exists(Scene))
                BuildReviewScene(manifest.assets.Take(PaletteCount).ToArray());

            Debug.Log($"CONCOURSE_IMPORT_OK {manifest.assets.Length} models {string.Join(" ", summary)} " +
                $"row={RowX[0]}..{RowX[RowX.Length - 1]}");
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
        /// One review scene: all ten wrapper prefabs in a row, framed together. Only
        /// called when the scene does not exist (see the note in Import).
        /// </summary>
        private static void BuildReviewScene(Asset[] assets)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < assets.Length; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>($"{Folder}/{assets[i].prefab}.prefab");
                Require(prefab != null, $"Missing prefab for {assets[i].prefab}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(RowX[i], 0, 0);
                // The row faces the camera at -z with every piece's own front. The
                // basin and the urinal open towards local +y, so turn them round;
                // the triangular 导向柱 prints on its long faces, so turn it a
                // quarter turn to read its plates, as a pedestrian would.
                instance.transform.rotation = assets[i].paletteId == "guidepost"
                    ? Quaternion.Euler(0, -90, 0)
                    : assets[i].paletteId == "sink" || assets[i].paletteId == "urinal"
                        ? Quaternion.Euler(0, 180, 0)
                        : Quaternion.identity;
            }

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            // Centred on the row so the 21.6 m run fills the canvas width; the
            // 4 m 导向柱 still fits the 55 degree frame.
            camera.transform.position = new Vector3(0, 2.9f, -13.8f);
            camera.transform.LookAt(new Vector3(0, 1.4f, 0));
            camera.fieldOfView = 55;
            camera.nearClipPlane = 0.05f;
            // The 21.6 m row plus the 4 m 导向柱 stays well inside 120 m.
            camera.farClipPlane = 120;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.18f, 0.26f, 0.35f);

            var light = new GameObject("Key light").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 2.2f;
            light.transform.rotation = Quaternion.Euler(35, -35, 0);
            RenderSettings.ambientMode = AmbientMode.Flat;
            // A low flat ambient keeps the dark plinths, door frames and handles
            // genuinely dark while the counters and porcelain stay the light mass.
            RenderSettings.ambientLight = Color.white * 0.15f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the concourse review scene");
        }

        /// <summary>Preserved builder hierarchy: each piece names its own parts.</summary>
        private static void CheckHierarchy(GameObject root, Asset asset)
        {
            int nodes = root.GetComponentsInChildren<Transform>().Length;
            switch (asset.paletteId)
            {
                case "checkout":
                {
                    Require(FindNode(root, "checkout-cabinet") != null, "checkout: cabinet node missing");
                    Require(FindNode(root, "checkout-worktop") != null, "checkout: worktop node missing");
                    // The POS head hangs in its own tilted pivot group; a flattened
                    // import would move it onto the counter group.
                    var screen = FindNode(root, "pos-housing");
                    Require(screen != null, "checkout: POS housing node missing");
                    Require(screen.parent != null && Quaternion.Angle(screen.parent.localRotation, Quaternion.identity) > 5f,
                        "checkout: POS pivot tilt was flattened");
                    break;
                }
                case "checkout-cafe":
                case "checkout-cafe-pastry":
                case "checkout-generic":
                    Require(FindNode(root, "counter-worktop") != null, $"{asset.paletteId}: worktop node missing");
                    if (asset.paletteId == "checkout-cafe-pastry")
                        Require(FindNode(root, "pastry-case-glass-front") != null, "pastry counter: glazed case missing");
                    break;
                case "sink":
                    Require(FindNode(root, "sink-water") == null, "sink: hidden activity water was exported");
                    break;
                case "urinal":
                    Require(FindNode(root, "urinal-ceramic-shell") != null, "urinal: ceramic shell node missing");
                    break;
                case "extinguisher-glass":
                    Require(FindNode(root, "cabinet-pane") != null, "glass cabinet: glazing node missing");
                    Require(FindNode(root, "cabinet-label") != null, "glass cabinet: printed label node missing");
                    break;
                case "guidepost":
                    Require(FindNode(root, "guide-triangular-base") != null, "guidepost: base column missing");
                    Require(FindNode(root, "guide-triangular-column") != null, "guidepost: red column missing");
                    Require(FindNode(root, "guide-yellow-logo-collar") != null, "guidepost: yellow collar missing");
                    Require(FindNode(root, "guide-station-face") != null, "guidepost: station plate missing");
                    Require(FindNode(root, "guide-square-train-icon") != null, "guidepost: train-icon plate missing");
                    Require(FindNode(root, "guide-metro-logo-face") != null, "guidepost: metro logo plate missing");
                    break;
            }
            Require(nodes > 3, $"{asset.paletteId}: imported hierarchy was flattened ({nodes} nodes)");
            Debug.Log($"{asset.paletteId}: {nodes} imported nodes");
        }

        private static void CheckAssetParameters(Asset asset)
        {
            var parameters = asset.parameters;
            Require(parameters != null, $"{asset.paletteId}: no per-asset parameters");
            if (asset.paletteId.StartsWith("checkout"))
            {
                Require(Mathf.Approximately(parameters.counterWidthMetres, 1f) &&
                    parameters.counterLengthMetres >= 1f && parameters.counterLengthMetres <= 4f,
                    $"{asset.id}: unexpected counter dimensions");
            }
            if (asset.paletteId.StartsWith("extinguisher"))
            {
                var spec = parameters.variant == "standard" ? new[] { 0.743f, 0.534f, 1.1f, 1f }
                    : parameters.variant == "compact" ? new[] { 0.5f, 0.35f, 0.5f, 1f }
                        : new[] { 1.5f, 0.5f, 2f, 2f };
                Require(Mathf.Approximately(parameters.widthMetres, spec[0]) &&
                    Mathf.Approximately(parameters.depthMetres, spec[1]) &&
                    Mathf.Approximately(parameters.heightMetres, spec[2]) &&
                    parameters.cells == (int)spec[3],
                    $"{asset.paletteId}: unexpected extinguisher spec");
            }
            if (asset.paletteId == "guidepost")
            {
                Require(parameters.plateTextures == 7, $"guidepost: expected seven plate textures");
                Require(Mathf.Approximately(parameters.heightMetres, 4f), "guidepost: expected a 4 m post");
            }
        }

        /// <summary>The measured bounds each recipe must reproduce, in Unity metres (x, z, y).</summary>
        private static void CheckSize(Asset asset)
        {
            Vector3 size = BasisSize(asset.size);
            if (asset.paletteId.StartsWith("checkout"))
                size.x -= asset.parameters.counterLengthMetres - 1f;
            switch (asset.paletteId)
            {
                case "checkout":
                    Near(size, new Vector3(0.98f, 1.393f, 0.878f), "checkout size", 0.01f);
                    break;
                case "checkout-cafe":
                case "checkout-cafe-pastry":
                    Near(size, new Vector3(0.99f, 1.5f, 0.86f), $"{asset.paletteId} size", 0.01f);
                    break;
                case "checkout-generic":
                    Near(size, new Vector3(0.99f, 1.4f, 0.86f), "generic counter size", 0.01f);
                    break;
                case "sink":
                    Near(size, new Vector3(0.689f, 1.042f, 0.585f), "sink size", 0.01f);
                    break;
                case "urinal":
                    Near(size, new Vector3(0.522f, 1.448f, 0.447f), "urinal size", 0.01f);
                    break;
                case "extinguisher":
                    Near(size, new Vector3(0.743f, 1.1f, 0.487f), "extinguisher size", 0.01f);
                    break;
                case "extinguisher-compact":
                    Near(size, new Vector3(0.5f, 0.5f, 0.319f), "compact cabinet size", 0.01f);
                    break;
                case "extinguisher-glass":
                    Near(size, new Vector3(1.5f, 2f, 0.5f), "glass cabinet size", 0.01f);
                    break;
                case "guidepost":
                    Near(size, new Vector3(0.16f, 4f, 0.589f), "guidepost size", 0.01f);
                    break;
            }
        }

        private static void CheckSpec(Parameters parameters, string variant, float width, float depth, float height, int cells)
        {
            var spec = parameters.extinguisherSpecs.Single(entry => entry.variant == variant);
            Require(Mathf.Approximately(spec.widthMetres, width) && Mathf.Approximately(spec.depthMetres, depth) &&
                Mathf.Approximately(spec.heightMetres, height) && spec.cells == cells,
                $"Unexpected {variant} extinguisher spec");
        }

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        /// <summary>Source sizes swap Y and Z into the Unity channels.</summary>
        private static Vector3 BasisSize(float[] v) => new Vector3(v[0], v[2], v[1]);

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        /// <summary>glTFast may unique sibling node names with a numeric suffix.</summary>
        private static Transform FindNode(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>()
                .FirstOrDefault(child => child.name == name || child.name.StartsWith(name + "_", StringComparison.Ordinal));

        private static void CheckAnchor(GameObject root, string name, Vector3 expected) =>
            Near(FindAnchor(root, name).position, expected, name);

        private static void CheckAnchorAt(GameObject root, string name, Vector3 expected, int facing) =>
            Near(FindAnchor(root, name).position, expected, $"{name} at facing {facing}");

        private static void Near(Vector3 actual, Vector3 expected, string field, float tolerance = 0.002f) =>
            Require(Vector3.Distance(actual, expected) < tolerance,
                $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
