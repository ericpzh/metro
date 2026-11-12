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
    /// Import the nine fit-out GLBs exported by export-fitout.mjs: the two walled
    /// rooms (store shell and authored retail adapter), the glazed ticket booth with
    /// its mounted sign, the three shop-furniture pieces, the painted street arrows,
    /// the roadside decor cluster and the panel-atlas row. Wrap each in a prefab
    /// under the Unity gameplay basis, verify the family parameters, bounds,
    /// triangles, material and texture sets, named parts, the authored room
    /// openings, the booth glazing/sign, the stock colours, the flat street paint
    /// and the panel UV windows, then save one review scene.
    /// </summary>
    public static class ReviewFitout
    {
        private const string Folder = "Assets/FitoutProof";
        private const string Scene = Folder + "/Fitout.unity";
        private const int Count = 9;

        private static readonly Vector3 CameraPosition = new Vector3(0f, 12f, -34f);
        private const float CameraTilt = 12f;
        private const float CameraSize = 13f;
        private const float CameraFarPlane = 100f;
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
            public int models;
            public string stationDocument, dimensions, seeding, encoding, naming, instancing, textures, runtime;
        }

        [Serializable]
        private class Asset
        {
            public int schemaVersion, triangles, meshes, textures, openingCells;
            public string id, family, row, kind, prefab, file, sha256, source, provenance, licenseRecord, units, notes, adapter, openingSide;
            public float openingX0, openingX1, openingWidth;
            public float[] min, max, size, placementOffset;
            public string[] materials, parts, alphaMaterials, glassMaterials, roots;
            public Anchors anchors;
            public StockColor[] stockColors;
            public Panel[] panels;
            public Case[] cases;
            public Validation validation;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        [Serializable]
        private class StockColor
        {
            public string color, material;
            public int instances, triangles;
        }

        [Serializable]
        private class Panel
        {
            public string name, detail;
            public float u, v, w, h, widthMetres, heightMetres;
        }

        [Serializable]
        private class Case
        {
            public string name, detail;
            public int count;
            public float widthMetres, heightMetres;
        }

        [Serializable]
        private class Validation { public int errors, warnings; }

        private class Expected
        {
            public string row, prefab, id, source;
            public float sizeX, sizeY, sizeZ;
            public int triangles, meshes, textures;
            public int alphaCount, glassCount, stockColorCount, panelCount, rootCount;
            public float openingWidth;
            public string[] materials;
            public string[] parts;
            public float slotX, rowY, rowZ;
        }

        // Measured from the promoted GLBs on the first proof run; the exporter's
        // parameters and the game's own specs are the source, these are the pinned
        // envelopes a drifted builder or a lost instancing bake would change.
        private static readonly Expected[] Fixtures =
        {
            new Expected
            {
                row = "shop-room", prefab = "ShopRoom", id = "fitout.shop-room",
                source = "game/src/render/models/pieces/RoomModel.ts",
                sizeX = 6f, sizeY = 4f, sizeZ = 3f, triangles = 216, meshes = 18, textures = 0,
                alphaCount = 0, glassCount = 0, stockColorCount = 0, panelCount = 0, rootCount = 1,
                openingWidth = 2f, slotX = -14f, rowY = 0f, rowZ = 0f,
                materials = new[] { "blue", "white" },
                parts = new[] { "wall-south-01", "wall-north-01", "wall-east-01", "wall-west-01" },
            },
            new Expected
            {
                row = "retail-room", prefab = "RetailRoom", id = "fitout.retail-room",
                source = "game/src/render/models/pieces/RoomModel.ts",
                sizeX = 5f, sizeY = 4f, sizeZ = 3f, triangles = 192, meshes = 16, textures = 1,
                alphaCount = 0, glassCount = 0, stockColorCount = 0, panelCount = 0, rootCount = 1,
                openingWidth = 2f, slotX = -7f, rowY = 0f, rowZ = 0f,
                materials = new[] { "blue", "steel" },
                parts = new[] { "wall-south-01", "wall-north-01", "wall-east-01", "wall-west-01" },
            },
            new Expected
            {
                row = "ticket-booth", prefab = "TicketBooth", id = "fitout.ticket-booth",
                source = "game/src/render/models/pieces/BoothModel.ts",
                sizeX = 4f, sizeY = 3.003f, sizeZ = 2.4f, triangles = 414, meshes = 37, textures = 4,
                alphaCount = 1, glassCount = 1, stockColorCount = 0, panelCount = 0, rootCount = 1,
                openingWidth = 4f, slotX = -1f, rowY = 0f, rowZ = 0f,
                materials = new[] { "binSteel", "black", "boothSignFace", "darkSteel", "glass", "screen", "steel" },
                parts = new[] { "booth-sign-sheet" },
            },
            new Expected
            {
                row = "shop-shelves", prefab = "ShopShelves", id = "fitout.shop-shelves",
                source = "game/src/render/models/pieces/ShopShelves.ts",
                sizeX = 0.912f, sizeY = 0.5405f, sizeZ = 1.65f, triangles = 1884, meshes = 24, textures = 1,
                alphaCount = 1, glassCount = 0, stockColorCount = 10, panelCount = 0, rootCount = 1,
                openingWidth = 0f, slotX = 4f, rowY = 0f, rowZ = 0f,
                materials = new[] { "blue", "darkSteel", "gateRed", "shelfPanel", "white" },
                parts = new[] { "food-back", "food-deck", "food-header", "food-price-strip" },
            },
            new Expected
            {
                row = "shop-counter", prefab = "ShopCounter", id = "fitout.shop-counter",
                source = "game/src/render/models/pieces/ShopCounter.ts",
                sizeX = 1.99f, sizeY = 0.86f, sizeZ = 1.4f, triangles = 256, meshes = 23, textures = 2,
                alphaCount = 0, glassCount = 0, stockColorCount = 0, panelCount = 0, rootCount = 1,
                openingWidth = 0f, slotX = 6.5f, rowY = 0f, rowZ = 0f,
                materials = new[] { "darkSteel", "desktopScreen", "rubber", "steel", "white" },
                parts = new[] { "counter-plinth", "counter-worktop", "counter-pos-screen", "counter-rear-door" },
            },
            new Expected
            {
                row = "shop-stock", prefab = "ShopStock", id = "fitout.shop-stock",
                source = "game/src/render/models/pieces/ShopStock.ts",
                sizeX = 6.887f, sizeY = 0.831f, sizeZ = 1.929f, triangles = 11504, meshes = 39, textures = 0,
                alphaCount = 0, glassCount = 0, stockColorCount = 38, panelCount = 0, rootCount = 1,
                openingWidth = 0f, slotX = -14f, rowY = 8.5f, rowZ = 12f,
                materials = new string[0],
                parts = new[] { "stock-snacks-packages", "stock-fruit-produce", "stock-cafe-jars", "stock-clothing-garments" },
            },
            new Expected
            {
                row = "street-arrow-markings", prefab = "StreetArrows", id = "fitout.street-arrow-markings",
                source = "game/src/render/models/pieces/RoadArrowMarking.ts",
                sizeX = 9f, sizeY = 5f, sizeZ = 0.02f, triangles = 50, meshes = 5, textures = 0,
                alphaCount = 0, glassCount = 0, stockColorCount = 0, panelCount = 0, rootCount = 1,
                openingWidth = 0f, slotX = -3f, rowY = 8.5f, rowZ = 12f,
                materials = new[] { "asphalt", "white" },
                parts = new[] { "road-arrow-straight", "road-arrow-left-through", "road-arrow-right-through", "road-arrow-three-way", "street-surface" },
            },
            new Expected
            {
                row = "street-decor", prefab = "StreetDecor", id = "fitout.street-decor",
                source = "game/src/render/models/pieces/StreetDecorModel.ts",
                sizeX = 5.52f, sizeY = 1.93f, sizeZ = 4f, triangles = 320, meshes = 42, textures = 11,
                alphaCount = 3, glassCount = 0, stockColorCount = 0, panelCount = 0, rootCount = 2,
                openingWidth = 0f, slotX = 5f, rowY = 8.5f, rowZ = 12f,
                materials = new[] { "shelterCream", "shelterGreen", "steel", "streetPoster_landscape-1-jpg", "streetPoster_portrait-13-jpg" },
                parts = new[] { "guide-station-face", "guide-square-exit-letter", "guide-metro-logo-face", "guide-triangular-column" },
            },
            new Expected
            {
                row = "dynamic-station-panels", prefab = "StationPanels", id = "fitout.dynamic-station-panels",
                source = "game/src/render/panelAtlas.ts",
                sizeX = 9.06f, sizeY = 0.09f, sizeZ = 1.86f, triangles = 56, meshes = 8, textures = 1,
                alphaCount = 0, glassCount = 0, stockColorCount = 0, panelCount = 4, rootCount = 1,
                openingWidth = 0f, slotX = 14.5f, rowY = 8.5f, rowZ = 12f,
                materials = new[] { "darkSteel", "panelAtlas" },
                parts = new[] { "panel-edited-sign", "panel-route-map", "panel-poster", "panel-display" },
            },
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
            Require(manifest.assets.Length == Count, $"Expected {Count} fit-out models in the manifest, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.row).Distinct().Count() == Count, "The manifest repeats a row");
            Require(manifest.assets.Select(asset => asset.prefab).Distinct().Count() == Count, "The manifest repeats a prefab");
            Require(manifest.parameters != null, "The manifest is missing its family parameters");
            Require(manifest.parameters.models == Count, $"Expected {Count} family models, got {manifest.parameters.models}");
            Require(!string.IsNullOrEmpty(manifest.parameters.stationDocument) && manifest.parameters.stationDocument.Contains("体育西路"),
                "The manifest does not record the authored station document");
            Require(!string.IsNullOrEmpty(manifest.parameters.seeding) && manifest.parameters.seeding.Contains("fixed-seed"),
                "The manifest does not record the seeded RNG");
            Require(!string.IsNullOrEmpty(manifest.parameters.encoding) && manifest.parameters.encoding.Contains("serialised"),
                "The manifest does not record the serialised canvas encode");
            Require(!string.IsNullOrEmpty(manifest.parameters.naming) && manifest.parameters.naming.Contains("named"),
                "The manifest does not record the naming contract");
            Require(!string.IsNullOrEmpty(manifest.parameters.runtime) && manifest.parameters.runtime.Contains("runtime"),
                "The manifest does not state the runtime boundaries");

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var imported = new List<ImportedFixture>();
            foreach (var expected in Fixtures)
            {
                var asset = manifest.assets.Single(entry => entry.row == expected.row);
                CheckFamilyParameters(asset, expected);
                var fixture = ImportAsset(asset, expected, evidence);
                imported.Add(fixture);
                summary.Add($"{asset.row}={asset.triangles}t/{asset.materials.Length}m/{asset.textures}x");
            }

            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"FITOUT_IMPORT_OK {imported.Count} models {string.Join(" ", summary)} " +
                      $"camera={CameraPosition.z:F0}/{CameraSize:F1} rows={Fixtures.Count(f => f.rowZ == 0f)}+{Fixtures.Count(f => f.rowZ > 0f)}");
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

        private static void CheckFamilyParameters(Asset asset, Expected expected)
        {
            string label = $"{asset.row}: ";
            Require(asset.schemaVersion == 1, $"{label}schema version {asset.schemaVersion}");
            Require(asset.family == "fitout", $"{label}family {asset.family}");
            Require(asset.id == expected.id, $"{label}manifest id {asset.id} != {expected.id}");
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.row + ".glb", $"{label}file {asset.file}");
            Require(!string.IsNullOrEmpty(asset.source) && asset.source.Contains(expected.source),
                $"{label}source {asset.source} does not name {expected.source}");
            Require(asset.validation != null && asset.validation.errors == 0 && asset.validation.warnings == 0,
                $"{label}glTF validation is not clean");
            Require(asset.triangles == expected.triangles, $"{label}triangles {asset.triangles} != {expected.triangles}");
            Require(asset.meshes == expected.meshes, $"{label}meshes {asset.meshes} != {expected.meshes}");
            Require(asset.textures == expected.textures, $"{label}textures {asset.textures} != {expected.textures}");
            Require(asset.alphaMaterials.Length == expected.alphaCount,
                $"{label}alpha materials {asset.alphaMaterials.Length} != {expected.alphaCount}");
            Require(asset.glassMaterials.Length == expected.glassCount,
                $"{label}glass materials {asset.glassMaterials.Length} != {expected.glassCount}");
            Require(asset.stockColors.Length == expected.stockColorCount,
                $"{label}stock colours {asset.stockColors.Length} != {expected.stockColorCount}");
            Require(asset.panels.Length == expected.panelCount,
                $"{label}panels {asset.panels.Length} != {expected.panelCount}");
            Require(asset.roots != null && asset.roots.Length == expected.rootCount,
                $"{label}roots {asset.roots?.Length ?? 0} != {expected.rootCount}");
            Require(Mathf.Abs(asset.openingWidth - expected.openingWidth) < 0.001f,
                $"{label}opening width {asset.openingWidth} != {expected.openingWidth}");
            Require(asset.parts != null && asset.parts.Length > 0, $"{label}no named parts recorded");
            Require(asset.parts.Distinct().Count() == asset.parts.Length, $"{label}parts array repeats a name");
            Require(asset.materials != null && asset.materials.Length > 0, $"{label}no materials recorded");
            Require(asset.materials.Distinct().Count() == asset.materials.Length, $"{label}materials array repeats a name");
            foreach (var material in expected.materials)
                Require(asset.materials.Contains(material), $"{label}manifest is missing the {material} material");
            foreach (var part in expected.parts)
                Require(asset.parts.Any(name => name == part || name.StartsWith(part, StringComparison.Ordinal)),
                    $"{label}manifest is missing the {part} part");
            var size = new[] { asset.size[0], asset.size[1], asset.size[2] };
            Require(Mathf.Abs(size[0] - expected.sizeX) < 0.02f && Mathf.Abs(size[1] - expected.sizeY) < 0.02f && Mathf.Abs(size[2] - expected.sizeZ) < 0.02f,
                $"{label}envelope {size[0]:F3} x {size[1]:F3} x {size[2]:F3} drifted from the pinned size");
            Require(asset.openingCells >= 0, $"{label}negative opening cells");
            if (expected.openingWidth > 0f)
            {
                Require(!string.IsNullOrEmpty(asset.openingSide), $"{label}opening has no side");
                Require(asset.openingX1 - asset.openingX0 > 0.5f, $"{label}opening span is empty");
            }
            if (expected.stockColorCount > 0)
                Require(asset.stockColors.All(record => record.instances > 0), $"{label}stock colour with no instances");
            if (expected.panelCount > 0)
                Require(asset.panels.All(panel => panel.w > 0f && panel.h > 0f), $"{label}empty panel window");
        }

        private static ImportedFixture ImportAsset(Asset asset, Expected expected, string evidence)
        {
            string label = asset.row;
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

            // Wrapper prefab in a clean scene: basis parent rotated 180 degrees
            // about Y, as in every other family.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var root = new GameObject(expected.prefab);
            var orientation = new GameObject("Unity basis").transform;
            orientation.SetParent(root.transform, false);
            PrefabUtility.InstantiatePrefab(imported, orientation);
            orientation.localRotation = Quaternion.Euler(0, 180, 0);

            CheckAnchor(root, "AxisX", Basis(asset.anchors.AxisX));
            CheckAnchor(root, "Front", Basis(asset.anchors.Front));
            CheckAnchor(root, "Up", Basis(asset.anchors.Up));
            CheckAnchor(root, "Approach", Basis(asset.anchors.Approach));

            var renderers = root.GetComponentsInChildren<MeshRenderer>();
            Require(renderers.Length > 0, $"{label}: imported model has no mesh renderers");
            var filters = root.GetComponentsInChildren<MeshFilter>();
            Require(filters.Length == asset.meshes, $"{label}: expected {asset.meshes} mesh nodes, got {filters.Length}");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
            Near(bounds.min, Basis(asset.min), $"{label} minimum bounds");
            Near(bounds.max, Basis(asset.max), $"{label} maximum bounds");
            Near(bounds.size, Basis(new[] { expected.sizeX, expected.sizeY, expected.sizeZ }), $"{label} bounds size", 0.021f);

            int triangles = filters.Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == asset.triangles, $"{label}: expected {asset.triangles} triangles, got {triangles}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(asset.materials),
                $"{label}: unexpected materials {string.Join(", ", materials)}");

            // Every mesh is named, and the names are the ones the manifest pinned.
            // glTFast disambiguates repeated node names with a "_n" (or " (n)")
            // suffix; the authored name is what the manifest records.
            var expectedParts = new HashSet<string>(asset.parts);
            var meshNames = new HashSet<string>(filters.Select(filter => NormalizePart(filter.gameObject.name, expectedParts)));
            Require(meshNames.All(name => !string.IsNullOrEmpty(name)), $"{label}: a mesh node carries no name");
            Require(meshNames.SetEquals(expectedParts),
                $"{label}: named parts differ. Missing [{string.Join(",", expectedParts.Except(meshNames))}], extra [{string.Join(",", meshNames.Except(expectedParts))}]");
            foreach (var part in expected.parts)
                Require(filters.Any(filter => NormalizePart(filter.gameObject.name, expectedParts) == part || NormalizePart(filter.gameObject.name, expectedParts).StartsWith(part, StringComparison.Ordinal)),
                    $"{label}: no mesh named {part}");

            // Texture set: every material map imported, and the count the manifest
            // recorded is the count Unity made.
            var textures = importedMaterials
                .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length == asset.textures, $"{label}: expected {asset.textures} textures, got {textures.Length}");

            // Alpha queues: exactly the manifest's transparent materials, and every
            // glass material transparent.
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
            foreach (var name in asset.glassMaterials)
            {
                Require(name.IndexOf("glass", StringComparison.OrdinalIgnoreCase) >= 0, $"{label}: {name} is not a glass material");
                Require(importedMaterials.Single(material => material.name == name).renderQueue >= (int)RenderQueue.Transparent,
                    $"{label}: glass material {name} is opaque");
            }

            // The stock contract: one opaque, untextured material per authored colour.
            var stockMaterials = materials.Where(name => name.StartsWith("shelfGoods_", StringComparison.Ordinal)).ToArray();
            Require(stockMaterials.Length == asset.stockColors.Length,
                $"{label}: expected {asset.stockColors.Length} stock colour slots, got {stockMaterials.Length}");
            foreach (var record in asset.stockColors)
            {
                Require(record.material == $"shelfGoods_{record.color}",
                    $"{label}: stock material {record.material} is not named from colour {record.color}");
                var stock = importedMaterials.Single(material => material.name == record.material);
                Require(stock.renderQueue < (int)RenderQueue.Transparent, $"{label}: stock material {record.material} must stay opaque");
                Require(stock.mainTexture == null, $"{label}: stock material {record.material} should carry no map");
                Require(record.instances > 0, $"{label}: {record.material} recorded no instances");
            }

            CheckAssetSemantics(asset, expected, root, renderers, filters, importedMaterials);

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
            Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null, $"{label}: could not save wrapper prefab");
            UnityEngine.Object.DestroyImmediate(root);

            return new ImportedFixture { expected = expected, manifest = asset, prefabPath = prefabPath };
        }

        /// <summary>The per-row evidence: openings, glazing, signs, stock, paint and atlas windows.</summary>
        private static void CheckAssetSemantics(
            Asset asset, Expected expected, GameObject root, MeshRenderer[] renderers, MeshFilter[] filters, Material[] materials)
        {
            string label = asset.row;
            switch (asset.row)
            {
                case "shop-room":
                case "retail-room":
                {
                    // The authored opening: no wall renderer may cross it, and south
                    // wall panels stand on both sides. The manifest records the span.
                    Require(asset.openingSide == "south", $"{label}: expected a south opening, got {asset.openingSide}");
                    Require(asset.openingCells == 2, $"{label}: expected a two-cell opening, got {asset.openingCells}");
                    float x0 = asset.openingX0, x1 = asset.openingX1;
                    var opening = new Bounds(new Vector3((x0 + x1) / 2f, 1.5f, 0.25f),
                        new Vector3(x1 - x0, 2.8f, 0.7f));
                    foreach (var renderer in renderers)
                    {
                        var b = renderer.bounds;
                        bool overlaps = b.max.x > opening.min.x + 0.01f && b.min.x < opening.max.x - 0.01f
                            && b.max.y > opening.min.y && b.min.y < opening.max.y
                            && b.max.z > opening.min.z && b.min.z < opening.max.z;
                        Require(!overlaps, $"{label}: {renderer.name} crosses the authored opening");
                    }
                    var south = filters.Where(filter => filter.gameObject.name.StartsWith("wall-south", StringComparison.Ordinal)).ToArray();
                    Require(south.Length >= 2, $"{label}: the south wall has no panels beside the opening");
                    Require(south.Any(filter => filter.GetComponent<MeshRenderer>().bounds.max.x <= x0 + 0.01f),
                        $"{label}: no south panel west of the opening");
                    Require(south.Any(filter => filter.GetComponent<MeshRenderer>().bounds.min.x >= x1 - 0.01f),
                        $"{label}: no south panel east of the opening");
                    Require(renderers.Any(renderer => renderer.sharedMaterial.name == "white")
                        || renderers.Any(renderer => renderer.sharedMaterial.name == "steel"),
                        $"{label}: no plaster/steel wall finish");
                    Require(renderers.Any(renderer => renderer.sharedMaterial.name == "blue"),
                        $"{label}: no enamel accent band");
                    break;
                }
                case "ticket-booth":
                {
                    // The service glazing leaves the front transfer gap open, and the
                    // authored sign is mounted above it on the header.
                    var glass = renderers.Where(renderer => asset.glassMaterials.Contains(renderer.sharedMaterial.name)).ToArray();
                    Require(glass.Length > 0, $"{label}: no glazing");
                    foreach (var pane in glass)
                        Require(pane.bounds.min.y > 1.0f,
                            $"{label}: glazing {pane.name} reaches below the transfer sill (y {pane.bounds.min.y:F2})");
                    var sign = filters.SingleOrDefault(filter => filter.gameObject.name == "booth-sign-sheet");
                    Require(sign != null, $"{label}: no booth-sign-sheet");
                    var signMaterial = sign.GetComponent<MeshRenderer>().sharedMaterial;
                    Require(signMaterial.name == "boothSignFace", $"{label}: the sign sheet is not the authored sign face");
                    Require(signMaterial.mainTexture != null, $"{label}: the sign face carries no canvas");
                    Require(signMaterial.mainTexture.width > 512 && signMaterial.mainTexture.height > 128,
                        $"{label}: the sign canvas is too small ({signMaterial.mainTexture.width} x {signMaterial.mainTexture.height})");
                    Require(sign.GetComponent<MeshRenderer>().bounds.min.y > 1.9f, $"{label}: the sign is not on the booth header");
                    Require(asset.openingWidth == 4f, $"{label}: the front opening is not 4 m");
                    break;
                }
                case "shop-shelves":
                {
                    Require(asset.stockColors.Length > 0, $"{label}: the run carries no stock");
                    var shelf = materials.Single(material => material.name == "shelfPanel");
                    Require(shelf.mainTexture != null, $"{label}: the perforated shelf panel lost its canvas");
                    Require(filters.Any(filter => filter.gameObject.name.StartsWith("stock-packages", StringComparison.Ordinal)),
                        $"{label}: no packaged stock in the run");
                    break;
                }
                case "shop-counter":
                {
                    Require(filters.Any(filter => filter.gameObject.name == "counter-pos-screen"), $"{label}: no POS screen");
                    Require(filters.Any(filter => filter.gameObject.name == "counter-payment-screen"), $"{label}: no payment screen");
                    var screen = materials.Single(material => material.name == "desktopScreen");
                    Require(screen.mainTexture != null, $"{label}: the POS canvas is missing");
                    break;
                }
                case "shop-stock":
                {
                    Require(asset.stockColors.Length == 38, $"{label}: expected 38 stock colours, got {asset.stockColors.Length}");
                    foreach (var batch in new[] { "stock-snacks-", "stock-fruit-", "stock-cafe-", "stock-clothing-" })
                        Require(filters.Any(filter => filter.gameObject.name.StartsWith(batch, StringComparison.Ordinal)),
                            $"{label}: the {batch} batches are missing");
                    // The stock families the game draws: boxes, spheres, cylinders,
                    // bananas and shirts. A lost expansion drops them to one box batch.
                    Require(filters.Any(filter => filter.gameObject.name.StartsWith("stock-fruit-produce", StringComparison.Ordinal)),
                        $"{label}: no spherical produce");
                    Require(filters.Any(filter => filter.gameObject.name.StartsWith("stock-fruit-bananas", StringComparison.Ordinal)),
                        $"{label}: no banana stock");
                    Require(filters.Any(filter => filter.gameObject.name.StartsWith("stock-cafe-jars", StringComparison.Ordinal)),
                        $"{label}: no jar stock");
                    Require(filters.Any(filter => filter.gameObject.name.StartsWith("stock-clothing-garments", StringComparison.Ordinal)),
                        $"{label}: no garment stock");
                    break;
                }
                case "street-arrow-markings":
                {
                    var arrows = filters.Where(filter => filter.gameObject.name.StartsWith("road-arrow", StringComparison.Ordinal)).ToArray();
                    Require(arrows.Length == 4, $"{label}: expected 4 arrows, got {arrows.Length}");
                    foreach (var arrow in arrows)
                    {
                        var paint = arrow.GetComponent<MeshRenderer>();
                        Require(paint.sharedMaterial.name == "white", $"{label}: {arrow.name} is not white paint");
                        Require(paint.bounds.size.y < 0.02f, $"{label}: {arrow.name} is not flat (height {paint.bounds.size.y:F3})");
                    }
                    var surface = filters.SingleOrDefault(filter => filter.gameObject.name == "street-surface");
                    Require(surface != null && surface.GetComponent<MeshRenderer>().sharedMaterial.name == "asphalt",
                        $"{label}: no asphalt sample");
                    Require(asset.cases.Length == 4, $"{label}: expected four movement cases");
                    Require(asset.cases.Any(entry => entry.detail.Contains("left+straight")), $"{label}: no left-through case");
                    Require(asset.cases.Any(entry => entry.detail.Contains("right+straight")), $"{label}: no right-through case");
                    Require(asset.cases.Any(entry => entry.detail.Contains("left+straight+right")), $"{label}: no three-way case");
                    break;
                }
                case "street-decor":
                {
                    var transforms = root.GetComponentsInChildren<Transform>();
                    foreach (var name in asset.roots)
                        Require(transforms.Any(transform => transform.name == name), $"{label}: missing the {name} cluster root");
                    foreach (var name in new[] { "streetPoster_landscape-1-jpg", "streetPoster_portrait-13-jpg" })
                    {
                        var poster = materials.SingleOrDefault(material => material.name == name);
                        Require(poster != null, $"{label}: missing the {name} campaign material");
                        Require(poster.mainTexture != null, $"{label}: {name} carries no poster texture");
                    }
                    var plates = materials.Where(material => material.name.StartsWith("guide-", StringComparison.Ordinal)).ToArray();
                    Require(plates.Length >= 6, $"{label}: expected the guidepost's printed faces, got {plates.Length}");
                    foreach (var plate in plates) Require(plate.mainTexture != null, $"{label}: {plate.name} carries no printed face");
                    Require(transforms.Any(transform => transform.name == "guide-station-face"), $"{label}: no station-name plate");
                    Require(transforms.Any(transform => transform.name == "guide-square-exit-letter"), $"{label}: no exit-letter plate");
                    break;
                }
                case "dynamic-station-panels":
                {
                    Require(asset.panels.Length == 4, $"{label}: expected four panels, got {asset.panels.Length}");
                    var atlas = materials.SingleOrDefault(material => material.name == "panelAtlas");
                    Require(atlas != null, $"{label}: no panelAtlas material");
                    Require(atlas.mainTexture != null, $"{label}: the atlas carries no page");
                    Require(atlas.mainTexture.width >= 1024 && atlas.mainTexture.width == atlas.mainTexture.height,
                        $"{label}: atlas page is {atlas.mainTexture.width} x {atlas.mainTexture.height}");
                    var rects = new List<Rect>();
                    foreach (var panel in asset.panels)
                    {
                        var filter = filters.SingleOrDefault(entry => entry.gameObject.name == panel.name);
                        Require(filter != null, $"{label}: no {panel.name} mesh");
                        var mesh = filter.sharedMesh;
                        var uv = mesh.uv;
                        Require(uv != null && uv.Length > 0, $"{label}: {panel.name} has no UVs");
                        float minU = uv.Min(value => value.x), maxU = uv.Max(value => value.x);
                        float minV = uv.Min(value => value.y), maxV = uv.Max(value => value.y);
                        Require(Mathf.Abs((maxU - minU) - panel.w) < 0.005f,
                            $"{label}: {panel.name} UV width {(maxU - minU):F4} != {panel.w:F4}");
                        Require(Mathf.Abs((maxV - minV) - panel.h) < 0.005f,
                            $"{label}: {panel.name} UV height {(maxV - minV):F4} != {panel.h:F4}");
                        rects.Add(new Rect(minU, minV, maxU - minU, maxV - minV));
                        var renderer = filter.GetComponent<MeshRenderer>();
                        Require(renderer.sharedMaterial.name == "panelAtlas", $"{label}: {panel.name} does not use the atlas material");
                        Require(renderer.bounds.size.x > panel.widthMetres - 0.05f && renderer.bounds.size.y > panel.heightMetres - 0.05f,
                            $"{label}: {panel.name} is not mounted at its authored size");
                    }
                    for (int i = 0; i < rects.Count; i++)
                        for (int j = i + 1; j < rects.Count; j++)
                            Require(Mathf.Abs(rects[i].x - rects[j].x) > 0.01f || Mathf.Abs(rects[i].y - rects[j].y) > 0.01f,
                                $"{label}: {asset.panels[i].name} and {asset.panels[j].name} share an atlas window");
                    break;
                }
                default:
                    throw new InvalidOperationException($"{label}: no semantic check");
            }
        }

        private static void BuildReviewScene(List<ImportedFixture> fixtures)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            foreach (var fixture in fixtures)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(fixture.prefabPath);
                Require(prefab != null, $"Missing prefab for {fixture.manifest.row}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = SlotPosition(fixture.expected, fixture.manifest);
                instance.transform.rotation = Quaternion.identity;
            }

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = CameraPosition;
            camera.transform.rotation = Quaternion.Euler(CameraTilt, 0f, 0f);
            camera.orthographic = true;
            camera.orthographicSize = CameraSize;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = CameraFarPlane;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Slate;

            var key = new GameObject("Key light").AddComponent<Light>();
            key.type = LightType.Directional;
            key.intensity = 2.4f;
            key.transform.rotation = Quaternion.Euler(35f, -35f, 0f);
            var fill = new GameObject("Fill light").AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 1.2f;
            fill.transform.rotation = Quaternion.Euler(16f, 148f, 0f);

            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.55f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the fit-out review scene");
        }

        private static void VerifyReviewScene(List<ImportedFixture> fixtures)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            foreach (var fixture in fixtures)
            {
                var instance = roots.SingleOrDefault(root => root.name == fixture.expected.prefab);
                Require(instance != null, $"Review scene is missing the {fixture.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == fixture.prefabPath,
                    $"{fixture.expected.prefab} is not an instance of {fixture.prefabPath}");
                Near(instance.transform.position, SlotPosition(fixture.expected, fixture.manifest),
                    $"{fixture.expected.prefab} row placement");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{fixture.expected.prefab} instance has no renderers");
            }

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(camera.orthographic, "Review camera is not orthographic");
            Require(Mathf.Abs(camera.orthographicSize - CameraSize) < 0.001f, "Review camera size changed");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Near(camera.transform.position, CameraPosition, "Review camera position");
            Require(Mathf.Abs(camera.farClipPlane - CameraFarPlane) < 0.001f, "Review camera far plane changed");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 2, "Review scene is missing its two directional lights");
        }

        /// <summary>The prefab's world position: centred in its slot, on its row's shelf.</summary>
        private static Vector3 SlotPosition(Expected expected, Asset asset) =>
            new Vector3(expected.slotX - (asset.min[0] + asset.max[0]) / 2f, expected.rowY, expected.rowZ);

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        /// <summary>
        /// A node's authored name: glTFast suffixes a repeated node name with
        /// "_n" (or " (n)"), and only a suffix whose base is an authored part is
        /// stripped — so a stock part's own "_694936" colour suffix survives.
        /// </summary>
        private static string NormalizePart(string name, HashSet<string> expected)
        {
            var underscore = System.Text.RegularExpressions.Regex.Match(name, @"^(.*)_\d+$");
            if (underscore.Success && expected.Contains(underscore.Groups[1].Value)) return underscore.Groups[1].Value;
            var duplicate = System.Text.RegularExpressions.Regex.Match(name, @"^(.*) \(\d+\)$");
            if (duplicate.Success && expected.Contains(duplicate.Groups[1].Value)) return duplicate.Groups[1].Value;
            return name;
        }

        private static void CheckAnchor(GameObject root, string name, Vector3 expected) =>
            Near(FindAnchor(root, name).position, expected, name);

        private static void Near(Vector3 actual, Vector3 expected, string field, float tolerance = 0.002f) =>
            Require(Vector3.Distance(actual, expected) < tolerance, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
