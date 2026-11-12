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
    /// Import the ten retail 货架 (shop fixture) GLBs exported by export-retail.mjs:
    /// the two display runs, the three café backbars, the four clothing fixtures
    /// and the tiered fruit stand. Wrap each in a prefab under the Unity gameplay
    /// basis, verify the family parameters, the per-colour stock materials, the
    /// texture set, the opaque queues and the basis anchors, and save one review
    /// scene with all ten fixtures in a row.
    /// </summary>
    public static class ReviewRetail
    {
        private const string Folder = "Assets/RetailProof";
        private const string Scene = Folder + "/Retail.unity";
        private const int Count = 10;
        // The extra-long café backbar is 3.96 m; 4.5 m centres keep every piece in
        // its own slot with a clear gap, which the Web check reads as ten runs.
        private const float Spacing = 4.5f;

        /// <summary>The camera frames the whole 40.5 m row from slightly above the decks.</summary>
        private static readonly Vector3 CameraPosition = new Vector3(0f, 3.2f, -37f);
        private static readonly Vector3 CameraTarget = new Vector3(0f, 1.2f, 0f);
        private const float CameraFieldOfView = 44f;
        private const float CameraFarPlane = 150f;
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
            public VariantParameter[] variants;
        }

        [Serializable]
        private class VariantParameter
        {
            public string variant, frameMaterial;
            public int cells;
            public float widthMetres, heightMetres, depthMetres;
        }

        [Serializable]
        private class Asset
        {
            public string id, catalogueId, paletteId, variant, prefab, file, sha256, facade, frameMaterial;
            public int cells, triangles, meshes, textures, instances;
            public float widthMetres, heightMetres, depthMetres, edgeDepthMetres;
            public float[] min, max, size, placementOffset;
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
            public int cells;
            public float width, height, depth;
            // Bounds measured from the promoted GLB (the brief's expected envelope).
            public float sizeX, sizeY, sizeZ;
        }

        // SHELF_SPECS (game/src/sim/shelves.ts) and shelfWidth for the ten family
        // variants; the builder reads the same numbers, so a mismatch means the
        // recipe drifted. `width` is the authored envelope the builder draws.
        private static readonly Expected[] ExpectedFixtures =
        {
            new Expected { paletteId = "shelf-bags", variant = "bags", prefab = "ShelfBags", id = "station.shelf.bags", cells = 2, width = 1.94f, height = 2.05f, depth = 0.40f, sizeX = 1.94f, sizeY = 0.40f, sizeZ = 2.05f, frame = "white" },
            new Expected { paletteId = "shelf-books", variant = "books", prefab = "ShelfBooks", id = "station.shelf.books", cells = 2, width = 1.94f, height = 2.05f, depth = 0.40f, sizeX = 1.94f, sizeY = 0.40f, sizeZ = 2.05f, frame = "wood" },
            new Expected { paletteId = "shelf-cafe-backbar", variant = "cafe-backbar", prefab = "ShelfCafeBackbar", id = "station.shelf.cafe-backbar", cells = 1, width = 0.96f, height = 2.15f, depth = 0.60f, sizeX = 0.96f, sizeY = 0.60f, sizeZ = 2.15f, frame = "darkSteel" },
            new Expected { paletteId = "shelf-cafe-backbar-2", variant = "cafe-backbar-2", prefab = "ShelfCafeBackbar2", id = "station.shelf.cafe-backbar-2", cells = 2, width = 1.96f, height = 2.15f, depth = 0.60f, sizeX = 1.96f, sizeY = 0.60f, sizeZ = 2.15f, frame = "darkSteel" },
            new Expected { paletteId = "shelf-cafe-backbar-4", variant = "cafe-backbar-4", prefab = "ShelfCafeBackbar4", id = "station.shelf.cafe-backbar-4", cells = 4, width = 3.96f, height = 2.15f, depth = 0.60f, sizeX = 3.96f, sizeY = 0.60f, sizeZ = 2.15f, frame = "darkSteel" },
            new Expected { paletteId = "shelf-clothing-rail", variant = "clothing-rail", prefab = "ShelfClothingRail", id = "station.shelf.clothing-rail", cells = 1, width = 0.94f, height = 1.65f, depth = 0.60f, sizeX = 0.94f, sizeY = 0.60f, sizeZ = 1.65f, frame = "white" },
            new Expected { paletteId = "shelf-clothing-shoes", variant = "clothing-shoes", prefab = "ShelfClothingShoes", id = "station.shelf.clothing-shoes", cells = 1, width = 0.94f, height = 1.35f, depth = 0.55f, sizeX = 0.94f, sizeY = 0.55f, sizeZ = 1.35f, frame = "darkSteel" },
            new Expected { paletteId = "shelf-clothing-table", variant = "clothing-table", prefab = "ShelfClothingTable", id = "station.shelf.clothing-table", cells = 1, width = 0.94f, height = 1.05f, depth = 0.80f, sizeX = 0.94f, sizeY = 0.80f, sizeZ = 1.05f, frame = "white" },
            new Expected { paletteId = "shelf-clothing-wall", variant = "clothing-wall", prefab = "ShelfClothingWall", id = "station.shelf.clothing-wall", cells = 1, width = 0.94f, height = 1.95f, depth = 0.50f, sizeX = 0.94f, sizeY = 0.50f, sizeZ = 1.95f, frame = "darkSteel" },
            new Expected { paletteId = "shelf-fruit-tiered", variant = "fruit-tiered", prefab = "ShelfFruitTiered", id = "station.shelf.fruit-tiered", cells = 1, width = 0.96f, height = 1.50f, depth = 0.65f, sizeX = 0.96f, sizeY = 0.64f, sizeZ = 1.50f, frame = "woodDark" },
        };

        private class ImportedFixture
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
            Require(manifest.assets.Length == Count, $"Expected {Count} retail models in the manifest, got {manifest.assets.Length}");
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
            Require(manifest.parameters.variants != null && manifest.parameters.variants.Length == Count,
                $"Expected {Count} variant entries, got {manifest.parameters.variants?.Length ?? 0}");
            Require(manifest.parameters.variants.Sum(variant => variant.cells) == ExpectedFixtures.Sum(fixture => fixture.cells),
                "The variant table does not describe the family's cell run");
            Require(manifest.parameters.instanceCount > 0, "The family parameters record no baked instances");
            Require(manifest.parameters.instanceCount ==
                    manifest.assets.Sum(asset => asset.instanceColors.Sum(record => record.instances)),
                "The family instance count disagrees with the per-asset stock colours");
            Require(manifest.parameters.stockColours ==
                    manifest.assets.Sum(asset => asset.instanceColors.Length),
                "The family stock-colour count disagrees with the per-asset stock colours");

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var imported = new List<ImportedFixture>();
            foreach (var expected in ExpectedFixtures)
            {
                var asset = manifest.assets.Single(entry => entry.paletteId == expected.paletteId);
                CheckFamilyParameters(asset, expected, manifest.parameters);
                var fixture = ImportAsset(asset, expected, evidence);
                imported.Add(fixture);
                summary.Add($"{asset.id}={fixture.manifest.triangles}t/{fixture.manifest.materials.Length}m/" +
                            $"{fixture.manifest.textures}x/{fixture.manifest.instanceColors.Length}c");
            }

            // Unity mints fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene is never byte-identical between two imports. The
            // scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above, so create it only when it is missing and
            // verify its content on every run.
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"RETAIL_IMPORT_OK {imported.Count} models {string.Join(" ", summary)} " +
                      $"row={RowOrigin(0):F2}..{RowOrigin(Count - 1):F2} spacing={Spacing:F1} cameraY={CameraPosition.y:F2}");
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
            Require(asset.cells == expected.cells, $"{label}cells {asset.cells} != {expected.cells}");
            Require(Mathf.Abs(asset.widthMetres - expected.width) < 0.02f,
                $"{label}width {asset.widthMetres} != {expected.width}");
            Require(Mathf.Abs(asset.heightMetres - expected.height) < 0.0001f,
                $"{label}height {asset.heightMetres} != {expected.height}");
            Require(Mathf.Abs(asset.depthMetres - expected.depth) < 0.0001f,
                $"{label}depth {asset.depthMetres} != {expected.depth}");
            Require(asset.frameMaterial == expected.frame, $"{label}frame {asset.frameMaterial} != {expected.frame}");
            Require(Mathf.Abs(asset.edgeDepthMetres - expected.depth) < 0.0001f,
                $"{label}edge depth {asset.edgeDepthMetres} != {expected.depth}");
            Require(asset.placementOffset != null && asset.placementOffset.Length == 3,
                $"{label}manifest is missing the placement offset");
            // placeLocalAtEdge: x = cell + 0.5, y = cell + 0.5 + (0.5 - depth/2), z = +1.
            Near(new Vector3(asset.placementOffset[0], asset.placementOffset[1], asset.placementOffset[2]),
                new Vector3(0.5f, 1f - expected.depth / 2f, 1f), $"{label}placement offset");
            Require(asset.min != null && asset.max != null && asset.min.Length == 3 && asset.max.Length == 3,
                $"{label}manifest is missing its bounds");
            // A multi-cell run anchors on its first cell and keeps the builder's
            // edge offset: -0.5 .. cells - 0.5 in source x.
            Require(Mathf.Abs(asset.min[0] + 0.5f) < 0.06f,
                $"{label}bounds start at x={asset.min[0]:F3}, expected the anchor-cell edge -0.5");
            Require(Mathf.Abs(asset.max[0] - (expected.cells - 0.5f)) < 0.06f,
                $"{label}bounds end at x={asset.max[0]:F3}, expected {expected.cells - 0.5f}");

            var variant = parameters.variants.Single(entry => entry.variant == expected.variant);
            Require(variant.cells == expected.cells, $"{label}family cells {variant.cells} != {expected.cells}");
            Require(Mathf.Abs(variant.widthMetres - expected.width) < 0.02f,
                $"{label}family width {variant.widthMetres} != {expected.width}");
            Require(Mathf.Abs(variant.heightMetres - expected.height) < 0.0001f,
                $"{label}family height {variant.heightMetres} != {expected.height}");
            Require(Mathf.Abs(variant.depthMetres - expected.depth) < 0.0001f,
                $"{label}family depth {variant.depthMetres} != {expected.depth}");
            Require(variant.frameMaterial == expected.frame, $"{label}family frame {variant.frameMaterial}");
        }

        private static ImportedFixture ImportAsset(Asset asset, Expected expected, string evidence)
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
            // degrees about Y, as in ReviewShelf/ReviewBin/ReviewCctv.
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
            // The authored envelope: a drifted builder or a lost instancing bake
            // both change it, and the row spacing assumes it.
            var size = bounds.size;
            Near(size, Basis(new[] { expected.sizeX, expected.sizeY, expected.sizeZ }), $"{label} bounds size", 0.021f);

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
                Require(stock.mainTexture == null, $"{label}: stock material {record.material} should carry no map");
            }

            // No glazing in this family: every material the fixtures are built
            // from must import opaque, and the manifest has to say so.
            Require(asset.alphaMaterials == null || asset.alphaMaterials.Length == 0,
                $"{label}: retail fixtures carry no transparent materials, manifest lists {asset.alphaMaterials?.Length ?? 0}");
            foreach (var material in importedMaterials)
            {
                bool alpha = asset.alphaMaterials != null && asset.alphaMaterials.Contains(material.name);
                if (alpha)
                    Require(material.renderQueue >= (int)RenderQueue.Transparent,
                        $"{label}: {material.name} lost its transparent queue ({material.renderQueue})");
                else
                    Require(material.renderQueue < (int)RenderQueue.Transparent,
                        $"{label}: {material.name} should be opaque ({material.renderQueue})");
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

            return new ImportedFixture { expected = expected, manifest = asset, prefabPath = prefabPath };
        }

        /// <summary>
        /// One review scene: all ten wrapper prefabs in a row on 4.5 m centres,
        /// each centred inside its slot (a multi-cell run hangs off its anchor
        /// cell), framed by a slate-clearing camera 150 m deep. Only called when
        /// the scene is missing.
        /// </summary>
        private static void BuildReviewScene(List<ImportedFixture> fixtures)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < fixtures.Count; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(fixtures[i].prefabPath);
                Require(prefab != null, $"Missing prefab for {fixtures[i].manifest.paletteId}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(SlotX(i, fixtures[i].manifest), 0f, 0f);
                instance.transform.rotation = Quaternion.identity;
            }

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = CameraPosition;
            camera.transform.LookAt(CameraTarget);
            camera.fieldOfView = CameraFieldOfView;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = CameraFarPlane;
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
                "Could not save the retail review scene");
        }

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: ten prefab
        /// instances linked to the wrapper prefabs at their slot positions, the slate
        /// camera and the key light the Web check depends on.
        /// </summary>
        private static void VerifyReviewScene(List<ImportedFixture> fixtures)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            for (int i = 0; i < fixtures.Count; i++)
            {
                var fixture = fixtures[i];
                var instance = roots.SingleOrDefault(root => root.name == fixture.expected.prefab);
                Require(instance != null, $"Review scene is missing the {fixture.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == fixture.prefabPath,
                    $"{fixture.expected.prefab} is not an instance of {fixture.prefabPath}");
                Near(instance.transform.position, new Vector3(SlotX(i, fixture.manifest), 0f, 0f),
                    $"{fixture.expected.prefab} row placement");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{fixture.expected.prefab} instance has no renderers");
            }

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(Mathf.Abs(camera.fieldOfView - CameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Near(camera.transform.position, CameraPosition, "Review camera position");
            Require(camera.farClipPlane >= CameraFarPlane - 0.001f,
                $"Review camera far plane {camera.farClipPlane:F1} does not cover the row");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 1, "Review scene is missing its directional key light");
        }

        /// <summary>The centre of review slot `index`, before the piece's own offset.</summary>
        private static float RowOrigin(int index) => (index - (Count - 1) / 2f) * Spacing;

        /// <summary>
        /// A wrapper's origin sits on its anchor cell, so a multi-cell run extends
        /// to the right. Shift it back by half its measured width to centre it.
        /// </summary>
        private static float SlotX(int index, Asset asset) =>
            RowOrigin(index) - (asset.min[0] + asset.max[0]) / 2f;

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        private static void CheckAnchor(GameObject root, string name, Vector3 expected) =>
            Near(FindAnchor(root, name).position, expected, name);

        private static void Near(Vector3 actual, Vector3 expected, string field, float tolerance = 0.001f) =>
            Require(Vector3.Distance(actual, expected) < tolerance, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
