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
    /// Import the eleven canopy / street GLBs exported by export-canopy.mjs, wrap
    /// each in a prefab under the Unity gameplay basis, verify the family
    /// parameters, the roof bay widths, the screen glass queues and the basis
    /// anchors, and save one review scene with all eleven pieces in a row.
    /// </summary>
    public static class ReviewCanopy
    {
        private const string Folder = "Assets/CanopyProof";
        private const string Scene = Folder + "/Canopy.unity";
        private const int Count = 11;

        /// <summary>
        /// The row: four roof variants on 5 m centres, the PSD end and its cover
        /// course on 2 m, the two shelters on 8.5 m (the long one is 7.88 m wide),
        /// then the two signals on 2 m. Centred on x = 0.
        /// </summary>
        private static readonly float[] RowX =
        {
            -23.25f, -18.25f, -13.25f, -8.25f, -3.25f,
            0.25f, 2.25f, 7.5f, 16f, 21.25f, 23.25f,
        };

        /// <summary>The camera looks along +z from the front of the row.</summary>
        private static readonly Vector3 CameraPosition = new Vector3(-0.9f, 7.5f, -58f);
        private static readonly Vector3 CameraTarget = new Vector3(-0.9f, 4.4f, 0f);
        private const float CameraFieldOfView = 34f;
        private const float CameraFarPlane = 200f;
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
            public int models, rot, roofTileCells;
            public float roofBayWidthMetres, storeyHeightMetres, ceilingHeightMetres, roofEaveMetres;
            public float canopyDropMetres, psdHalfHeightMetres, psdFullHeightMetres;
            public string stationData, placement, palette, textures, basis;
            public string[] posters;
            public RoofParameter[] roofVariants;
            public BusStopParameter[] busStopLengths;
            public PsdEndParameter[] psdEnds;
        }

        [Serializable]
        private class RoofParameter
        {
            public string paletteId, variant;
            public int cells;
            public float bayWidthMetres, minZ, heightMetres;
        }

        [Serializable]
        private class BusStopParameter
        {
            public string paletteId, variant;
            public int cells;
            public float lengthMetres;
        }

        [Serializable]
        private class PsdEndParameter
        {
            public string paletteId, psd;
            public bool coverCourse;
            public float widthMetres, heightMetres;
        }

        [Serializable]
        private class Asset
        {
            public string id, catalogueId, paletteId, family, variant, type, prefab, file, sha256, units, facade;
            public string psd, posterSlug, mountFace;
            public bool coverCourse;
            public float[] placementOffset, min, max, size;
            public int cells, triangles, meshes, textures;
            public float bayWidthMetres, storeyHeightMetres, ceilingHeightMetres, roofEaveMetres, canopyDropMetres;
            public float psdHalfHeightMetres, psdFullHeightMetres, widthMetres, depthMetres, heightMetres;
            public string[] materials, alphaMaterials, glassMaterials;
            public Anchors anchors;
            public Validation validation;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        [Serializable]
        private class Validation { public int errors, warnings; }

        private class Expected
        {
            public string paletteId, prefab, id, type, variant, psd;
            public bool cover;
            public int cells, triangles, textures;
            public float width, depth, height, minZ;
            public float[] placementOffset;
            public string[] materials, alphaMaterials, glassMaterials;
        }

        // The recipe's own contract (export-canopy.mjs MODELS). A mismatch means
        // the builder, the palette or the recipe drifted.
        private static readonly Expected[] ExpectedModels =
        {
            new Expected
            {
                paletteId = "roof", prefab = "Roof", id = "station.roof.flat", type = "roof", variant = null,
                psd = "", cover = false, cells = 1, triangles = 12, textures = 0,
                width = 1f, depth = 1f, height = 0.25f, minZ = 5f, placementOffset = new[] { 0.5f, 0.5f, 1f },
                materials = new[] { "concrete" }, alphaMaterials = new string[0], glassMaterials = new string[0],
            },
            new Expected
            {
                paletteId = "roof-canopy", prefab = "RoofCanopy", id = "station.roof.canopy", type = "roof", variant = "canopy",
                psd = "", cover = false, cells = 4, triangles = 840, textures = 0,
                width = 4f, depth = 4.008f, height = 5f, minZ = 0f, placementOffset = new[] { 0.5f, 0.5f, 1f },
                materials = new[] { "concrete", "steel" }, alphaMaterials = new string[0], glassMaterials = new string[0],
            },
            new Expected
            {
                paletteId = "roof-shell", prefab = "RoofShell", id = "station.roof.shell", type = "roof", variant = "shell",
                psd = "", cover = false, cells = 4, triangles = 24, textures = 0,
                width = 4f, depth = 4.008f, height = 0.981f, minZ = 9.019f, placementOffset = new[] { 0.5f, 0.5f, 1f },
                materials = new[] { "concrete" }, alphaMaterials = new string[0], glassMaterials = new string[0],
            },
            new Expected
            {
                paletteId = "roof-tapered", prefab = "RoofTapered", id = "station.roof.tapered", type = "roof", variant = "tapered-truss",
                psd = "", cover = false, cells = 4, triangles = 396, textures = 0,
                width = 4f, depth = 4.008f, height = 5f, minZ = 5f, placementOffset = new[] { 0.5f, 0.5f, 1f },
                materials = new[] { "concrete", "steel" }, alphaMaterials = new string[0], glassMaterials = new string[0],
            },
            new Expected
            {
                paletteId = "roof-truss", prefab = "RoofTruss", id = "station.roof.truss", type = "roof", variant = "truss",
                psd = "", cover = false, cells = 4, triangles = 264, textures = 0,
                width = 4f, depth = 4.008f, height = 5f, minZ = 5f, placementOffset = new[] { 0.5f, 0.5f, 1f },
                materials = new[] { "concrete", "steel" }, alphaMaterials = new string[0], glassMaterials = new string[0],
            },
            new Expected
            {
                paletteId = "psd-end", prefab = "PsdEnd", id = "station.psd-end.standard", type = "psd-end", variant = null,
                psd = "half", cover = false, cells = 1, triangles = 114, textures = 0,
                width = 1f, depth = 0.2487f, height = 2.45f, minZ = 0f, placementOffset = new[] { 0.5f, 0.5f, 0f },
                materials = new[] { "black", "concrete", "gateRed", "psdFixedGlass" },
                alphaMaterials = new[] { "gateRed", "psdFixedGlass" }, glassMaterials = new[] { "psdFixedGlass" },
            },
            new Expected
            {
                paletteId = "psd-end-cover", prefab = "PsdEndCover", id = "station.psd-end.cover", type = "psd-end", variant = "cover",
                psd = "full", cover = true, cells = 1, triangles = 12, textures = 0,
                width = 1f, depth = 0.24f, height = 1f, minZ = 0f, placementOffset = new[] { 0.5f, 0.5f, 0f },
                materials = new[] { "white" }, alphaMaterials = new string[0], glassMaterials = new string[0],
            },
            new Expected
            {
                paletteId = "busstop-long", prefab = "BusstopLong", id = "station.busstop.long", type = "busstop", variant = "long",
                psd = "", cover = false, cells = 8, triangles = 372, textures = 2,
                width = 7.88f, depth = 1.88f, height = 3f, minZ = 0f, placementOffset = new[] { -2.5f, 0.5f, 1f },
                materials = new[] { "black", "busstopCream", "busstopGreen", "busstopPoster", "busstopRouteBoard", "darkSteel", "orange", "steel" },
                alphaMaterials = new string[0], glassMaterials = new string[0],
            },
            new Expected
            {
                paletteId = "busstop-short", prefab = "BusstopShort", id = "station.busstop.short", type = "busstop", variant = "short",
                psd = "", cover = false, cells = 4, triangles = 260, textures = 2,
                width = 3.88f, depth = 1.88f, height = 3f, minZ = 0f, placementOffset = new[] { -0.5f, 0.5f, 1f },
                materials = new[] { "black", "busstopCream", "busstopGreen", "busstopPoster", "busstopRouteBoard", "darkSteel", "orange", "steel" },
                alphaMaterials = new string[0], glassMaterials = new string[0],
            },
            new Expected
            {
                paletteId = "traffic-light", prefab = "TrafficLight", id = "station.traffic-light.standard", type = "traffic-light", variant = null,
                psd = "", cover = false, cells = 1, triangles = 108, textures = 0,
                width = 0.42f, depth = 0.52f, height = 3.5f, minZ = 0f, placementOffset = new[] { 0.5f, 0.5f, 1f },
                materials = new[] { "black", "darkSteel", "ledGreen", "steel" },
                alphaMaterials = new string[0], glassMaterials = new string[0],
            },
            new Expected
            {
                paletteId = "rail-signal", prefab = "RailSignal", id = "station.rail-signal.standard", type = "rail-signal", variant = null,
                psd = "", cover = false, cells = 1, triangles = 708, textures = 0,
                width = 0.293f, depth = 0.293f, height = 1f, minZ = 0f, placementOffset = new[] { 0.5f, 0.5f, 1f },
                materials = new[] { "black", "concrete", "darkSteel", "ledRed", "steel" },
                alphaMaterials = new string[0], glassMaterials = new string[0],
            },
        };

        private class ImportedCanopy
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
            Require(manifest.assets.Length == Count, $"Expected {Count} canopy models in the manifest, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.paletteId).Distinct().Count() == Count, "The manifest repeats a palette id");
            Require(manifest.assets.Select(asset => asset.id).Distinct().Count() == Count, "The manifest repeats a catalogue id");
            Require(manifest.assets.All(asset => asset.family == "canopy"), "A manifest asset is not in the canopy family");
            Require(manifest.assets.All(asset => asset.validation.errors == 0 && asset.validation.warnings == 0),
                "A GLB carried a validation issue");
            CheckFamilyParameters(manifest.parameters);

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var imported = new List<ImportedCanopy>();
            foreach (var expected in ExpectedModels)
            {
                var asset = manifest.assets.SingleOrDefault(entry => entry.paletteId == expected.paletteId);
                Require(asset != null, $"The manifest is missing {expected.paletteId}");
                CheckAssetParameters(asset, expected, manifest.parameters);
                var piece = ImportAsset(asset, expected, evidence);
                imported.Add(piece);
                summary.Add($"{asset.paletteId}={asset.triangles}t/{asset.materials.Length}m/{asset.alphaMaterials.Length}a/{asset.textures}x");
            }

            // Unity mints fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene is never byte-identical between two imports. The
            // scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above, so create it only when it is missing and
            // verify its content on every run.
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"CANOPY_IMPORT_OK {imported.Count} models {string.Join(" ", summary)} " +
                      $"row={RowX[0]:F2}..{RowX[Count - 1]:F2} cameraY={CameraPosition.y:F2} far={CameraFarPlane:F0}");
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
        /// The family's placement contract: a four-bay roof grid, a five-metre
        /// storey, the 9 m truss eave, the half/full screen courses and the two
        /// shelter lengths.
        /// </summary>
        private static void CheckFamilyParameters(Parameters parameters)
        {
            Require(parameters != null, "The manifest is missing its family parameters");
            Require(parameters.models == Count, $"Expected {Count} family models, got {parameters.models}");
            Require(parameters.rot == 0, $"Expected rot 0 exports, got {parameters.rot}");
            Require(!string.IsNullOrEmpty(parameters.stationData) && parameters.stationData.Contains("empty"),
                "Expected the exports to stand in an empty station document");
            Require(parameters.roofBayWidthMetres == 4f, $"Expected a 4 m roof bay, got {parameters.roofBayWidthMetres}");
            Require(parameters.roofTileCells == 1, $"Expected a 1 cell flat roof tile, got {parameters.roofTileCells}");
            Require(parameters.storeyHeightMetres == 5f, $"Expected a 5 m storey, got {parameters.storeyHeightMetres}");
            Require(parameters.ceilingHeightMetres == 5f, $"Expected the roof ceiling at 5 m, got {parameters.ceilingHeightMetres}");
            Require(parameters.roofEaveMetres == 9f, $"Expected the truss eave at 9 m, got {parameters.roofEaveMetres}");
            Require(parameters.canopyDropMetres == 5f, $"Expected the canopy dropped 5 m, got {parameters.canopyDropMetres}");
            Require(parameters.psdHalfHeightMetres == 1.45f, $"Unexpected half screen height {parameters.psdHalfHeightMetres}");
            Require(parameters.psdFullHeightMetres == 3f, $"Unexpected full screen height {parameters.psdFullHeightMetres}");
            Require(parameters.posters != null && parameters.posters.Length == 1 && !string.IsNullOrEmpty(parameters.posters[0]),
                "The manifest does not freeze the shelter campaign");

            Require(parameters.roofVariants != null && parameters.roofVariants.Length == 5,
                $"Expected five roof entries, got {parameters.roofVariants?.Length ?? 0}");
            foreach (var roof in parameters.roofVariants)
            {
                Require(roof.bayWidthMetres == roof.cells, $"{roof.paletteId}: bay width {roof.bayWidthMetres} != {roof.cells} cells");
                Require(roof.cells == (roof.paletteId == "roof" ? 1 : 4), $"{roof.paletteId}: unexpected {roof.cells} cell bay");
                Require(roof.minZ >= 0f, $"{roof.paletteId}: the roof hangs below the cell floor ({roof.minZ})");
                if (roof.paletteId == "roof") Require(Mathf.Abs(roof.minZ - 5f) < 0.001f, "The flat tile is not at the 5 m ceiling");
                if (roof.paletteId == "roof-shell") Require(Mathf.Abs(roof.minZ - 9.019f) < 0.01f, "The shell is not at the 9 m eave");
            }

            Require(parameters.busStopLengths != null && parameters.busStopLengths.Length == 2,
                $"Expected two shelter lengths, got {parameters.busStopLengths?.Length ?? 0}");
            var longStop = parameters.busStopLengths.Single(entry => entry.paletteId == "busstop-long");
            var shortStop = parameters.busStopLengths.Single(entry => entry.paletteId == "busstop-short");
            Require(Mathf.Abs(longStop.lengthMetres - 7.88f) < 0.002f, $"Long shelter length {longStop.lengthMetres} != 7.88");
            Require(Mathf.Abs(shortStop.lengthMetres - 3.88f) < 0.002f, $"Short shelter length {shortStop.lengthMetres} != 3.88");
            Require(longStop.cells == 8 && shortStop.cells == 4, "The shelters do not span 8 / 4 cells");

            Require(parameters.psdEnds != null && parameters.psdEnds.Length == 2,
                $"Expected two PSD end courses, got {parameters.psdEnds?.Length ?? 0}");
            var half = parameters.psdEnds.Single(entry => entry.paletteId == "psd-end");
            var cover = parameters.psdEnds.Single(entry => entry.paletteId == "psd-end-cover");
            Require(half.psd == "half" && !half.coverCourse, "The psd-end recipe is not the half-height infill");
            Require(cover.psd == "full" && cover.coverCourse, "The psd-end-cover recipe is not the full-height cover course");
            Require(Mathf.Abs(half.heightMetres - 2.45f) < 0.002f, $"Half screen course height {half.heightMetres} != 2.45");
            Require(Mathf.Abs(cover.heightMetres - 1f) < 0.002f, $"Cover course height {cover.heightMetres} != 1.0");
        }

        private static void CheckAssetParameters(Asset asset, Expected expected, Parameters parameters)
        {
            string label = $"{asset.paletteId}: ";
            Require(asset.id == expected.id, $"{label}manifest id {asset.id} != {expected.id}");
            Require(asset.catalogueId == expected.paletteId, $"{label}catalogue id {asset.catalogueId}");
            Require(asset.type == expected.type, $"{label}module type {asset.type} != {expected.type}");
            // JsonUtility reads a JSON null string as "", so compare normalised.
            Require((asset.variant ?? "") == (expected.variant ?? ""),
                $"{label}variant '{asset.variant}' != '{expected.variant}'");
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.paletteId + ".glb", $"{label}file {asset.file}");
            Require(asset.units == "metres", $"{label}units {asset.units}");
            Require(asset.triangles == expected.triangles, $"{label}triangles {asset.triangles} != {expected.triangles}");
            Require(asset.textures == expected.textures, $"{label}textures {asset.textures} != {expected.textures}");
            Require(asset.cells == expected.cells, $"{label}cells {asset.cells} != {expected.cells}");
            Require(asset.psd == expected.psd, $"{label}screen course {asset.psd} != {expected.psd}");
            Require(asset.coverCourse == expected.cover, $"{label}cover course flag {asset.coverCourse}");
            Require(asset.storeyHeightMetres == 5f, $"{label}storey height {asset.storeyHeightMetres}");
            Require(Mathf.Abs(asset.widthMetres - expected.width) < 0.002f, $"{label}width {asset.widthMetres} != {expected.width}");
            Require(Mathf.Abs(asset.depthMetres - expected.depth) < 0.002f, $"{label}depth {asset.depthMetres} != {expected.depth}");
            Require(Mathf.Abs(asset.heightMetres - expected.height) < 0.002f, $"{label}height {asset.heightMetres} != {expected.height}");
            Require(Mathf.Abs(asset.min[2] - expected.minZ) < 0.002f, $"{label}min z {asset.min[2]} != {expected.minZ}");
            Near(new Vector3(asset.placementOffset[0], asset.placementOffset[1], asset.placementOffset[2]),
                new Vector3(expected.placementOffset[0], expected.placementOffset[1], expected.placementOffset[2]),
                $"{label}placement offset");
            Require(asset.materials.SequenceEqual(expected.materials), $"{label}material set {string.Join(", ", asset.materials)}");
            Require(asset.alphaMaterials.SequenceEqual(expected.alphaMaterials), $"{label}alpha set {string.Join(", ", asset.alphaMaterials)}");
            Require(asset.glassMaterials.SequenceEqual(expected.glassMaterials), $"{label}glass set {string.Join(", ", asset.glassMaterials)}");
            Require(asset.anchors != null && asset.anchors.AxisX != null && asset.anchors.Front != null &&
                    asset.anchors.Up != null && asset.anchors.Approach != null, $"{label}anchors missing");

            // The four supported roofs span the family's four-bay grid; the flat
            // tile is the single ceiling cell. A hung roof records the storey it
            // hangs above (ceiling) and the truss eave.
            if (expected.type == "roof")
            {
                Require(asset.bayWidthMetres == (expected.paletteId == "roof" ? 1f : 4f),
                    $"{label}bay width {asset.bayWidthMetres}");
                Require(asset.ceilingHeightMetres == 5f, $"{label}ceiling height {asset.ceilingHeightMetres}");
                Require(asset.roofEaveMetres == 9f, $"{label}roof eave {asset.roofEaveMetres}");
            }
            else
            {
                Require(asset.ceilingHeightMetres == 0f && asset.roofEaveMetres == 0f && asset.bayWidthMetres == 0f,
                    $"{label}is not a hung roof but records roof parameters");
            }
            if (expected.paletteId == "roof-canopy") Require(asset.canopyDropMetres == 5f, $"{label}canopy drop {asset.canopyDropMetres}");
            if (expected.type == "psd-end")
            {
                Require(asset.psdHalfHeightMetres == (expected.psd == "half" ? 1.45f : 0f), $"{label}psd half height {asset.psdHalfHeightMetres}");
                Require(asset.psdFullHeightMetres == (expected.cover ? 3f : 0f), $"{label}psd full height {asset.psdFullHeightMetres}");
            }
            if (expected.type == "busstop")
            {
                Require(asset.posterSlug == parameters.posters[0], $"{label}poster {asset.posterSlug}");
                Require(asset.materials.Contains("busstopRouteBoard") && asset.materials.Contains("busstopPoster"),
                    $"{label}is missing its printed canvases");
            }
        }

        private static ImportedCanopy ImportAsset(Asset asset, Expected expected, string evidence)
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
            // degrees about Y, as in ReviewBin/ReviewCctv/ReviewShelf.
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

            // The screen glass and the red threshold sort in the transparent
            // queue; every opaque fitting (steel, concrete, the white cover
            // course) stays out of it.
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
            // The half-height screen is the family's glass: the fixed pane must be
            // present, in the glass set and in the transparent queue.
            foreach (var glassName in asset.glassMaterials)
            {
                var glass = importedMaterials.Single(material => material.name == glassName);
                Require(asset.alphaMaterials.Contains(glassName), $"{label}: {glassName} is not transparent");
                Require(glass.renderQueue >= (int)RenderQueue.Transparent, $"{label}: {glassName} queue {glass.renderQueue}");
            }
            if (expected.type == "psd-end" && !expected.cover)
                Require(asset.glassMaterials.Contains("psdFixedGlass") && asset.alphaMaterials.Contains("psdFixedGlass"),
                    $"{label}: the screen's fixed glass is missing");

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

            return new ImportedCanopy { expected = expected, manifest = asset, prefabPath = prefabPath };
        }

        /// <summary>
        /// One review scene: all eleven wrapper prefabs in a row — roofs on 5 m
        /// centres, the PSD pair and the signals on 2 m, the shelters on 8.5 m —
        /// framed by a camera with a 200 m far plane that clears to slate. Only
        /// called when the scene is missing.
        /// </summary>
        private static void BuildReviewScene(List<ImportedCanopy> pieces)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < pieces.Count; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(pieces[i].prefabPath);
                Require(prefab != null, $"Missing prefab for {pieces[i].manifest.paletteId}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(RowX[i], 0f, 0f);
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
                "Could not save the canopy review scene");
        }

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: eleven
        /// prefab instances linked to the wrapper prefabs at their row positions,
        /// the slate far-plane camera and the key light the Web check depends on.
        /// </summary>
        private static void VerifyReviewScene(List<ImportedCanopy> pieces)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            for (int i = 0; i < pieces.Count; i++)
            {
                var piece = pieces[i];
                var instance = roots.SingleOrDefault(root => root.name == piece.expected.prefab);
                Require(instance != null, $"Review scene is missing the {piece.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == piece.prefabPath,
                    $"{piece.expected.prefab} is not an instance of {piece.prefabPath}");
                Near(instance.transform.position, new Vector3(RowX[i], 0f, 0f), $"{piece.expected.prefab} row placement");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{piece.expected.prefab} instance has no renderers");
            }
            Require(roots.Count(root => root.GetComponentsInChildren<MeshRenderer>().Length > 0) >= Count,
                "The review scene does not carry all eleven pieces");

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(Mathf.Abs(camera.fieldOfView - CameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(Mathf.Abs(camera.farClipPlane - CameraFarPlane) < 0.001f, "Review camera far plane changed");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Near(camera.transform.position, CameraPosition, "Review camera position");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 1, "Review scene is missing its directional key light");
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
