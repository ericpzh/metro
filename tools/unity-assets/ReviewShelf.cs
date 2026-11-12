using System;
using System.Collections.Generic;
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
    /// Import the ten 货架 (shelf) GLBs exported by export-shelf.mjs, wrap each in a
    /// prefab under the Unity gameplay basis, verify the family parameters, the
    /// per-colour stock materials, the glass queues and the basis anchors, and save
    /// one review scene with all ten stocked fixtures in a row.
    /// </summary>
    public static class ReviewShelf
    {
        private const string Folder = "Assets/ShelfProof";
        private const string Scene = Folder + "/Shelf.unity";
        private const int Count = 10;
        private const float Spacing = 1.3f;

        /// <summary>The camera looks along +z at the row, standing a little above the stock.</summary>
        private static readonly Vector3 CameraPosition = new Vector3(0f, 2.45f, -11.8f);
        private static readonly Vector3 CameraTarget = new Vector3(0f, 1.1f, 0f);
        private const float CameraFieldOfView = 44f;
        private static readonly Color Slate = new Color(0.22f, 0.30f, 0.38f);

        [Serializable]
        private class Manifest
        {
            public Asset[] assets;
            public Parameters parameters;
        }

        [Serializable]
        private class Parameters
        {
            public int models, rot, instanceCount, stockColours;
            public string stationData, placement, instanceExpansion, palette, textures, basis;
            public ShelfSpecParameter[] shelfSpecs;
        }

        [Serializable]
        private class ShelfSpecParameter
        {
            public string variant, frameMaterial;
            public float heightMetres, depthMetres;
            public int levels;
        }

        [Serializable]
        private class Asset
        {
            public string id, catalogueId, paletteId, variant, prefab, file, sha256, facade, frameMaterial;
            public float[] min, max, size, placementOffset, shelfLevels;
            public float heightMetres, depthMetres, edgeDepthMetres;
            public int triangles, meshes, textures;
            public string[] materials, alphaMaterials, glassMaterials;
            public Anchors anchors;
            public InstanceColor[] instanceColors;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        [Serializable]
        private class InstanceColor
        {
            public string color, material;
            public int instances, triangles;
        }

        private class Expected
        {
            public string paletteId, variant, prefab, id, frame;
            public float height, depth;
            public int levels;
            public float EdgeDepth => depth + (paletteId == "shelf-cooler" || paletteId == "shelf-cooler-dark" ? 0.12f : 0f);
        }

        // SHELF_SPECS (game/src/sim/shelves.ts) for the ten family variants; the
        // builder reads the same numbers, so a mismatch means the recipe drifted.
        private static readonly Expected[] ExpectedShelves =
        {
            new Expected { paletteId = "shelf-dark-tall", variant = "dark-tall", prefab = "ShelfDarkTall", id = "station.shelf.dark-tall", height = 1.90f, depth = 0.50f, levels = 5, frame = "darkSteel" },
            new Expected { paletteId = "shelf-white-tall", variant = "white-tall", prefab = "ShelfWhiteTall", id = "station.shelf.white-tall", height = 1.90f, depth = 0.50f, levels = 5, frame = "white" },
            new Expected { paletteId = "shelf-white-short", variant = "white-short", prefab = "ShelfWhiteShort", id = "station.shelf.white-short", height = 1.25f, depth = 0.50f, levels = 3, frame = "white" },
            new Expected { paletteId = "shelf-wire", variant = "wire", prefab = "ShelfWire", id = "station.shelf.wire", height = 1.60f, depth = 0.50f, levels = 4, frame = "darkSteel" },
            new Expected { paletteId = "shelf-cooler", variant = "cooler", prefab = "ShelfCooler", id = "station.shelf.cooler", height = 2.05f, depth = 0.66f, levels = 6, frame = "white" },
            new Expected { paletteId = "shelf-cooler-dark", variant = "cooler-dark", prefab = "ShelfCoolerDark", id = "station.shelf.cooler-dark", height = 2.05f, depth = 0.66f, levels = 6, frame = "darkSteel" },
            new Expected { paletteId = "shelf-food-snacks", variant = "food-snacks", prefab = "ShelfFoodSnacks", id = "station.shelf.food-snacks", height = 1.65f, depth = 0.55f, levels = 0, frame = "darkSteel" },
            new Expected { paletteId = "shelf-food-bakery", variant = "food-bakery", prefab = "ShelfFoodBakery", id = "station.shelf.food-bakery", height = 1.55f, depth = 0.65f, levels = 0, frame = "darkSteel" },
            new Expected { paletteId = "shelf-ice-cream", variant = "ice-cream", prefab = "ShelfIceCream", id = "station.shelf.ice-cream", height = 0.98f, depth = 0.80f, levels = 0, frame = "white" },
            new Expected { paletteId = "shelf-fruit-island", variant = "fruit-island", prefab = "ShelfFruitIsland", id = "station.shelf.fruit-island", height = 1.05f, depth = 0.90f, levels = 0, frame = "woodDark" },
        };

        private class ImportedShelf
        {
            public Expected expected;
            public Asset manifest;
            public string prefabPath;
        }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            string summaryPath = Path.Combine(evidence, "export", "manifest.json");
            Require(File.Exists(summaryPath), $"Missing {summaryPath}");
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(summaryPath));
            Require(manifest?.assets != null, "Unreadable export manifest");
            Require(manifest.assets.Length == Count, $"Expected {Count} shelf models in the manifest, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.paletteId).Distinct().Count() == Count,
                "The manifest repeats a palette id");
            Require(manifest.parameters != null, "The manifest is missing its family parameters");
            Require(manifest.parameters.models == Count, $"Expected {Count} family models, got {manifest.parameters.models}");
            Require(manifest.parameters.rot == 0, $"Expected rot 0 exports, got {manifest.parameters.rot}");
            Require(!string.IsNullOrEmpty(manifest.parameters.instanceExpansion) &&
                    manifest.parameters.instanceExpansion.Contains("InstancedMesh"),
                "The manifest does not record the instancing expansion");
            Require(!string.IsNullOrEmpty(manifest.parameters.stationData) &&
                    manifest.parameters.stationData.Contains("empty"),
                "Expected the exports to stand in an empty station document");
            Require(manifest.parameters.shelfSpecs != null && manifest.parameters.shelfSpecs.Length == Count,
                $"Expected {Count} shelf spec entries, got {manifest.parameters.shelfSpecs?.Length ?? 0}");

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var imported = new List<ImportedShelf>();
            foreach (var expected in ExpectedShelves)
            {
                var asset = manifest.assets.Single(entry => entry.paletteId == expected.paletteId);
                CheckFamilyParameters(asset, expected, manifest.parameters);
                var shelf = ImportAsset(asset, expected, evidence);
                imported.Add(shelf);
                summary.Add($"{asset.id}={shelf.manifest.triangles}t/{shelf.manifest.materials.Length}m/" +
                            $"{shelf.manifest.alphaMaterials.Length}a/{shelf.manifest.instanceColors.Length}c");
            }

            // Unity mints fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene is never byte-identical between two imports. The
            // scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above, so create it only when it is missing and
            // verify its content on every run.
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"SHELF_IMPORT_OK {imported.Count} models {string.Join(" ", summary)} " +
                      $"row={RowX(0):F2}..{RowX(Count - 1):F2} spacing={Spacing:F1} cameraY={CameraPosition.y:F2}");
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

        private static void CheckFamilyParameters(Asset asset, Expected expected, Parameters parameters)
        {
            string label = $"{asset.paletteId}: ";
            Require(asset.id == expected.id, $"{label}manifest id {asset.id} != {expected.id}");
            Require(asset.catalogueId == expected.paletteId, $"{label}catalogue id {asset.catalogueId}");
            Require(asset.variant == expected.variant, $"{label}variant {asset.variant}");
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.paletteId + ".glb", $"{label}file {asset.file}");
            Require(Mathf.Abs(asset.heightMetres - expected.height) < 0.0001f,
                $"{label}height {asset.heightMetres} != {expected.height}");
            Require(Mathf.Abs(asset.depthMetres - expected.depth) < 0.0001f,
                $"{label}depth {asset.depthMetres} != {expected.depth}");
            Require(asset.shelfLevels != null && asset.shelfLevels.Length == expected.levels,
                $"{label}expected {expected.levels} shelf levels, got {asset.shelfLevels?.Length ?? 0}");
            Require(asset.frameMaterial == expected.frame, $"{label}frame {asset.frameMaterial} != {expected.frame}");
            Require(Mathf.Abs(asset.edgeDepthMetres - expected.EdgeDepth) < 0.0001f,
                $"{label}edge depth {asset.edgeDepthMetres} != {expected.EdgeDepth}");
            Require(asset.placementOffset != null && asset.placementOffset.Length == 3,
                $"{label}manifest is missing the placement offset");
            Near(new Vector3(asset.placementOffset[0], asset.placementOffset[1], asset.placementOffset[2]),
                new Vector3(0.5f, 1f - expected.EdgeDepth / 2f, 1f), $"{label}placement offset");

            var parameter = parameters.shelfSpecs.Single(spec => spec.variant == expected.variant);
            Require(Mathf.Abs(parameter.heightMetres - expected.height) < 0.0001f,
                $"{label}family height {parameter.heightMetres} != {expected.height}");
            Require(Mathf.Abs(parameter.depthMetres - expected.depth) < 0.0001f,
                $"{label}family depth {parameter.depthMetres} != {expected.depth}");
            Require(parameter.levels == expected.levels, $"{label}family levels {parameter.levels} != {expected.levels}");
            Require(parameter.frameMaterial == expected.frame, $"{label}family frame {parameter.frameMaterial}");
        }

        private static ImportedShelf ImportAsset(Asset asset, Expected expected, string evidence)
        {
            string label = asset.paletteId;
            string modelPath = $"{Folder}/{asset.file}";
            string glbPath = Path.Combine(evidence, "export", asset.file);
            Require(File.Exists(glbPath), $"{label}: missing {glbPath}");
            byte[] bytes = File.ReadAllBytes(glbPath);
            string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            Require(digest == asset.sha256, $"{label}: GLB digest differs from the validated manifest");
            if (!File.Exists(modelPath) || !bytes.SequenceEqual(File.ReadAllBytes(modelPath)))
                File.WriteAllBytes(modelPath, bytes);

            AssetDatabase.ImportAsset(modelPath, ImportAssetOptions.ForceSynchronousImport);
            var imported = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            Require(imported != null, $"{label}: glTFast did not produce a model");

            // Build the wrapper prefab in a clean scene: basis parent rotated 180
            // degrees about Y, as in ReviewBin/ReviewCctv.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var root = new GameObject(expected.prefab);
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
            Require(renderers.Length > 0, $"{label}: imported model has no mesh renderers");
            var filters = root.GetComponentsInChildren<MeshFilter>();
            Require(filters.Length == asset.meshes,
                $"{label}: expected {asset.meshes} mesh nodes, got {filters.Length}");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers)
                bounds.Encapsulate(renderer.bounds);
            Near(bounds.min, Basis(asset.min), $"{label} minimum bounds");
            Near(bounds.max, Basis(asset.max), $"{label} maximum bounds");

            int triangles = filters.Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == asset.triangles,
                $"{label}: expected {asset.triangles} triangles, got {triangles}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(asset.materials),
                $"{label}: unexpected materials {string.Join(", ", materials)}");

            // Every baked stock colour is its own opaque material slot named
            // shelfGoods_<hex>; the instancing expansion must not have collapsed
            // them back into the white base material.
            Require(asset.instanceColors != null && asset.instanceColors.Length > 0, $"{label}: no instance colours recorded");
            var stockMaterials = materials.Where(name => name.StartsWith("shelfGoods_", StringComparison.Ordinal)).ToArray();
            Require(stockMaterials.Length == asset.instanceColors.Length,
                $"{label}: expected {asset.instanceColors.Length} stock colour slots, got {stockMaterials.Length}");
            foreach (var record in asset.instanceColors)
            {
                Require(record.material == $"shelfGoods_{record.color}",
                    $"{label}: stock material {record.material} is not named from colour {record.color}");
                var stock = importedMaterials.Single(material => material.name == record.material);
                Require(stock.renderQueue < (int)RenderQueue.Transparent,
                    $"{label}: stock material {record.material} must stay opaque");
                Require(record.instances > 0, $"{label}: {record.material} recorded no instances");
            }

            // Glass sorts in the transparent queue; the carcass, panel and frame
            // materials the fixture is built from stay opaque.
            foreach (var material in importedMaterials)
            {
                bool alpha = asset.alphaMaterials.Contains(material.name);
                if (alpha)
                    Require(material.renderQueue >= (int)RenderQueue.Transparent,
                        $"{label}: {material.name} lost its transparent queue ({material.renderQueue})");
                else
                    Require(material.renderQueue < (int)RenderQueue.Transparent,
                        $"{label}: {material.name} should be opaque ({material.renderQueue})");
            }
            // The cooler doors are the family's defining glass; the other
            // fixtures only add glass lids/dividers.
            if (expected.paletteId == "shelf-cooler" || expected.paletteId == "shelf-cooler-dark")
            {
                Require(asset.glassMaterials.Contains("glass"), $"{label}: cooler doors are not in glassMaterials");
                Require(asset.alphaMaterials.Contains("glass"), $"{label}: cooler doors are not transparent");
            }
            Require(importedMaterials.Single(material => material.name == asset.frameMaterial).renderQueue < (int)RenderQueue.Transparent,
                $"{label}: frame material {asset.frameMaterial} must be opaque");

            var textures = importedMaterials
                .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length == asset.textures,
                $"{label}: expected {asset.textures} textures, got {textures.Length}");

            var axisX = FindAnchor(root, "AxisX");
            var front = FindAnchor(root, "Front");
            var up = FindAnchor(root, "Up");
            var approach = FindAnchor(root, "Approach");
            for (int i = 0; i < 4; i++)
            {
                var rotation = Quaternion.Euler(0, i * 90, 0);
                root.transform.rotation = rotation;
                Near(axisX.position, rotation * Vector3.right, $"{label} AxisX at facing {i}");
                Near(front.position, rotation * Vector3.forward, $"{label} Front at facing {i}");
                Near(up.position, rotation * Vector3.up, $"{label} Up at facing {i}");
                Near(approach.position, rotation * Vector3.back, $"{label} Approach at facing {i}");
            }
            root.transform.rotation = Quaternion.identity;

            string prefabPath = $"{Folder}/{asset.prefab}.prefab";
            Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null,
                $"{label}: could not save wrapper prefab");
            UnityEngine.Object.DestroyImmediate(root);

            return new ImportedShelf { expected = expected, manifest = asset, prefabPath = prefabPath };
        }

        /// <summary>
        /// One review scene: all ten wrapper prefabs in a row on 1.3 m centres,
        /// framed by a slate-clearing camera roughly 2.5 m above the floor so the
        /// stock on every deck is visible. Only called when the scene is missing.
        /// </summary>
        private static void BuildReviewScene(List<ImportedShelf> shelves)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < shelves.Count; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(shelves[i].prefabPath);
                Require(prefab != null, $"Missing prefab for {shelves[i].manifest.paletteId}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(RowX(i), 0f, 0f);
                instance.transform.rotation = Quaternion.identity;
            }

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = CameraPosition;
            camera.transform.LookAt(CameraTarget);
            camera.fieldOfView = CameraFieldOfView;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 100f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Slate;

            var key = new GameObject("Key light").AddComponent<Light>();
            key.type = LightType.Directional;
            key.intensity = 2.6f;
            key.transform.rotation = Quaternion.Euler(35f, -35f, 0f);
            var fill = new GameObject("Fill light").AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 1.1f;
            fill.transform.rotation = Quaternion.Euler(16f, 148f, 0f);

            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.5f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the shelf review scene");
        }

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: ten prefab
        /// instances linked to the wrapper prefabs at their row positions, the slate
        /// camera and the key light the Web check depends on.
        /// </summary>
        private static void VerifyReviewScene(List<ImportedShelf> shelves)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            for (int i = 0; i < shelves.Count; i++)
            {
                var shelf = shelves[i];
                var instance = roots.SingleOrDefault(root => root.name == shelf.expected.prefab);
                Require(instance != null, $"Review scene is missing the {shelf.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == shelf.prefabPath,
                    $"{shelf.expected.prefab} is not an instance of {shelf.prefabPath}");
                Near(instance.transform.position, new Vector3(RowX(i), 0f, 0f), $"{shelf.expected.prefab} row placement");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{shelf.expected.prefab} instance has no renderers");
            }

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(Mathf.Abs(camera.fieldOfView - CameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Near(camera.transform.position, CameraPosition, "Review camera position");
            Require(camera.transform.position.y >= 2.3f,
                $"Review camera must sit near 2.5 m to see the stock (y={camera.transform.position.y:F2})");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 1, "Review scene is missing its directional key light");
        }

        private static float RowX(int index) => (index - (Count - 1) / 2f) * Spacing;

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
