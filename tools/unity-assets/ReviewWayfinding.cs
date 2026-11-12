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
    /// Import the sixteen wayfinding GLBs exported by export-wayfinding.mjs — the
    /// eight city 导向柱 guideposts and the eight city 3 m 地面 doorway entrance
    /// panels — wrap each in a prefab under the Unity gameplay basis, verify the
    /// family parameters, digest, bounds, triangle and mesh counts, material set,
    /// recorded palette, texture/plate counts, alpha queues and the basis anchors at
    /// four facings, and save one review scene with both rows.
    ///
    /// The scene is a pure view over the wrapper prefabs: the doorways stand in
    /// front (their printed street face is local +y, so each instance is turned 180°
    /// to meet the camera) and the guideposts behind them, four metres apart in each
    /// row.
    /// </summary>
    public static class ReviewWayfinding
    {
        private const string Folder = "Assets/WayfindingProof";
        private const string Scene = Folder + "/Wayfinding.unity";
        private const int Count = 16;
        private const int CityCount = 8;
        private const float Spacing = 4f;
        private const float CameraFieldOfView = 42f;
        private const float CameraFarPlane = 250f;
        private const float GuidepostRow = -2f;
        private const float DoorwayRow = -8f;

        /// <summary>Both rows are parallel to the image plane, so the pitch reads evenly.</summary>
        private static readonly Vector3 CameraPosition = new Vector3(0f, 5.2f, -36f);
        private static readonly Vector3 CameraTarget = new Vector3(0f, 2f, 0f);
        private static readonly Color Slate = new Color(0.22f, 0.30f, 0.38f);

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
            public int models, rot;
            public string family, cityStyleSource, stationData, placement, guidepost, doorway, exitNames, headerStyles;
            public string palette, textures, basis;
            public string[] cities;
            public StationSample[] stationSamples;
        }

        [Serializable]
        private class StationSample
        {
            public string city, name, nameEn, line, lineColour;
        }

        [Serializable]
        private class Asset
        {
            public string id, kind, cityStyle, paletteId, prefab, file, sha256, source, provenance, licenseRecord, units, facade;
            public float[] placementOffset, min, max, size, forward;
            public int triangles, meshes, textures, plates, plateMeshes;
            public string[] materials, alphaMaterials, glassMaterials;
            public Anchors anchors;
            public PaletteEntry[] palette;
            public Station station;
            public City city;
            public AssetParameters parameters;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        [Serializable]
        private class PaletteEntry
        {
            public string name, colour, map;
            public bool transparent;
        }

        [Serializable]
        private class Station
        {
            public string name, nameEn, lineId, lineColour;
        }

        [Serializable]
        private class City
        {
            public string style, brand, entranceColour;
        }

        [Serializable]
        private class AssetParameters
        {
            public string kind, cityStyle, exitName, station, stationEn, lineId, lineColour, platePrefix, guideCityStyle;
            public float heightMetres, widthMetres, depthMetres;
            public int plateCount, plateMeshes;
            public Header header;
        }

        [Serializable]
        private class Header
        {
            public string style, bandColour, panelMaterial, canvas, exitIdentifier;
            public int logicalWidth, lineBadges;
            public bool drawsExitName;
        }

        /// <summary>One row slot: the values the exporter must reproduce.</summary>
        private class Expected
        {
            public string id, kind, city, prefab, file, exitName, headerStyle, band, panelMaterial, headerCanvas, identifier;
            public int column, materials, plates, alpha, badges;
            public float width, height, depth, tolerance;
            public bool drawsExitName;
        }

        // The sixteen rows: one guidepost and one doorway per city. Sizes are in
        // Unity metres (x across, y up, z deep) — the source Z-up sizes swap y and
        // z. Plate/texture and material counts are the builders' own output, so a
        // lost plate or a lost palette slot fails here rather than on the manifest
        // alone. The guidepost heights are the eight builders' real posts, 3.8 m to
        // 4.06 m (the brief's "~4 m"); the doorway is the 3 m one-bay panel.
        private static readonly Expected[] Rows =
        {
            new Expected { id = "city-guangzhou-guidepost", kind = "guidepost", city = "guangzhou", prefab = "CityGuidepostGuangzhou", file = "city-guidepost-guangzhou.glb", column = 0,
                width = 0.159794f, height = 4.000f, depth = 0.589127f, materials = 10, plates = 7, alpha = 3, tolerance = 0.003f, exitName = "C口" },
            new Expected { id = "city-guangzhou-doorway-entrance", kind = "doorway", city = "guangzhou", prefab = "CityDoorwayGuangzhou", file = "city-doorway-guangzhou.glb", column = 0,
                width = 3f, height = 0.780f, depth = 0.072f, materials = 3, plates = 1, alpha = 0, tolerance = 0.002f, exitName = "C口",
                headerStyle = "default", band = "#c22f28", panelMaterial = "doorwayPanel_c22f28", headerCanvas = "512x96", badges = 0, drawsExitName = true, identifier = "C" },
            new Expected { id = "city-shenzhen-guidepost", kind = "guidepost", city = "shenzhen", prefab = "CityGuidepostShenzhen", file = "city-guidepost-shenzhen.glb", column = 1,
                width = 0.610f, height = 3.995f, depth = 0.328f, materials = 7, plates = 3, alpha = 3, tolerance = 0.003f, exitName = "C口" },
            new Expected { id = "city-shenzhen-doorway-entrance", kind = "doorway", city = "shenzhen", prefab = "CityDoorwayShenzhen", file = "city-doorway-shenzhen.glb", column = 1,
                width = 3f, height = 0.780f, depth = 0.072f, materials = 3, plates = 1, alpha = 0, tolerance = 0.002f, exitName = "C口",
                headerStyle = "shenzhen", band = "#101b2b", panelMaterial = "doorwayPanel_101b2b", headerCanvas = "512x96", badges = 1, drawsExitName = true, identifier = "C" },
            new Expected { id = "city-shanghai-guidepost", kind = "guidepost", city = "shanghai", prefab = "CityGuidepostShanghai", file = "city-guidepost-shanghai.glb", column = 2,
                width = 0.600f, height = 3.8875f, depth = 0.600f, materials = 3, plates = 1, alpha = 1, tolerance = 0.003f, exitName = "13号口" },
            new Expected { id = "city-shanghai-doorway-entrance", kind = "doorway", city = "shanghai", prefab = "CityDoorwayShanghai", file = "city-doorway-shanghai.glb", column = 2,
                width = 3f, height = 0.780f, depth = 0.072f, materials = 3, plates = 1, alpha = 0, tolerance = 0.002f, exitName = "13号口",
                headerStyle = "shanghai", band = "#353b35", panelMaterial = "doorwayPanel_353b35", headerCanvas = "512x96", badges = 1, drawsExitName = true, identifier = "13" },
            new Expected { id = "city-beijing-guidepost", kind = "guidepost", city = "beijing", prefab = "CityGuidepostBeijing", file = "city-guidepost-beijing.glb", column = 3,
                width = 0.550f, height = 3.965f, depth = 0.345f, materials = 4, plates = 2, alpha = 2, tolerance = 0.003f, exitName = "C口" },
            new Expected { id = "city-beijing-doorway-entrance", kind = "doorway", city = "beijing", prefab = "CityDoorwayBeijing", file = "city-doorway-beijing.glb", column = 3,
                width = 3f, height = 0.780f, depth = 0.072f, materials = 3, plates = 1, alpha = 0, tolerance = 0.002f, exitName = "C口",
                headerStyle = "beijing", band = "#073563", panelMaterial = "doorwayPanel_073563", headerCanvas = "512x96", badges = 1, drawsExitName = false, identifier = "C" },
            new Expected { id = "city-chengdu-guidepost", kind = "guidepost", city = "chengdu", prefab = "CityGuidepostChengdu", file = "city-guidepost-chengdu.glb", column = 4,
                width = 0.344205f, height = 4.000f, depth = 0.347454f, materials = 5, plates = 3, alpha = 3, tolerance = 0.003f, exitName = "C口" },
            new Expected { id = "city-chengdu-doorway-entrance", kind = "doorway", city = "chengdu", prefab = "CityDoorwayChengdu", file = "city-doorway-chengdu.glb", column = 4,
                width = 3f, height = 0.780f, depth = 0.072f, materials = 3, plates = 1, alpha = 0, tolerance = 0.002f, exitName = "C口",
                headerStyle = "chengdu", band = "#343433", panelMaterial = "doorwayPanel_343433", headerCanvas = "2048x384", badges = 1, drawsExitName = true, identifier = "C" },
            new Expected { id = "city-chongqing-guidepost", kind = "guidepost", city = "chongqing", prefab = "CityGuidepostChongqing", file = "city-guidepost-chongqing.glb", column = 5,
                width = 1.580f, height = 4.060f, depth = 0.366f, materials = 4, plates = 1, alpha = 1, tolerance = 0.003f, exitName = "C口" },
            new Expected { id = "city-chongqing-doorway-entrance", kind = "doorway", city = "chongqing", prefab = "CityDoorwayChongqing", file = "city-doorway-chongqing.glb", column = 5,
                width = 3f, height = 0.780f, depth = 0.072f, materials = 3, plates = 1, alpha = 0, tolerance = 0.002f, exitName = "C口",
                headerStyle = "chongqing", band = "#f2f0dd", panelMaterial = "doorwayPanel_f2f0dd", headerCanvas = "2048x384", badges = 1, drawsExitName = true, identifier = "C" },
            new Expected { id = "city-wuhan-guidepost", kind = "guidepost", city = "wuhan", prefab = "CityGuidepostWuhan", file = "city-guidepost-wuhan.glb", column = 6,
                width = 0.652f, height = 4.000f, depth = 0.652f, materials = 4, plates = 2, alpha = 2, tolerance = 0.003f, exitName = "C口" },
            new Expected { id = "city-wuhan-doorway-entrance", kind = "doorway", city = "wuhan", prefab = "CityDoorwayWuhan", file = "city-doorway-wuhan.glb", column = 6,
                width = 3f, height = 0.780f, depth = 0.072f, materials = 3, plates = 1, alpha = 0, tolerance = 0.002f, exitName = "C口",
                headerStyle = "wuhan", band = "#183b70", panelMaterial = "doorwayPanel_183b70", headerCanvas = "2048x384", badges = 1, drawsExitName = true, identifier = "C" },
            new Expected { id = "city-nanjing-guidepost", kind = "guidepost", city = "nanjing", prefab = "CityGuidepostNanjing", file = "city-guidepost-nanjing.glb", column = 7,
                width = 0.760f, height = 3.800f, depth = 0.282f, materials = 2, plates = 1, alpha = 0, tolerance = 0.003f, exitName = "C口" },
            new Expected { id = "city-nanjing-doorway-entrance", kind = "doorway", city = "nanjing", prefab = "CityDoorwayNanjing", file = "city-doorway-nanjing.glb", column = 7,
                width = 3f, height = 0.780f, depth = 0.072f, materials = 3, plates = 1, alpha = 0, tolerance = 0.002f, exitName = "C口",
                headerStyle = "nanjing", band = "#14213f", panelMaterial = "doorwayPanel_14213f", headerCanvas = "2048x384", badges = 1, drawsExitName = true, identifier = "C" },
        };

        private class ImportedWayfinding
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
            Require(manifest?.assets != null, "Unreadable wayfinding export manifest");
            Require(manifest.assets.Length == Count, $"Expected {Count} wayfinding models in the manifest, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.id).Distinct().Count() == Count, "The manifest repeats a checklist id");
            Require(manifest.assets.Select(asset => asset.prefab).Distinct().Count() == Count, "The manifest repeats a prefab name");
            Require(manifest.assets.Select(asset => asset.file).Distinct().Count() == Count, "The manifest repeats a file name");
            Require(manifest.family == "wayfinding", $"Unexpected manifest family {manifest.family}");

            var parameters = manifest.parameters;
            Require(parameters != null, "The manifest is missing its family parameters");
            Require(parameters.models == Count, $"Expected {Count} family models, got {parameters.models}");
            Require(parameters.rot == 0, $"Expected rot 0 exports, got {parameters.rot}");
            Require(parameters.cities != null && parameters.cities.Length == CityCount, "The manifest must list the eight city styles");
            foreach (var city in Cities)
                Require(parameters.cities.Contains(city), $"The manifest is missing the {city} city style");
            Require(manifest.assets.Select(asset => asset.cityStyle).Distinct().Count() == CityCount, "The assets do not cover eight cities");
            foreach (var city in Cities)
            {
                Require(manifest.assets.Count(asset => asset.cityStyle == city) == 2,
                    $"Expected one guidepost and one doorway for {city}");
                Require(manifest.assets.Any(asset => asset.cityStyle == city && asset.kind == "guidepost"), $"{city}: no guidepost");
                Require(manifest.assets.Any(asset => asset.cityStyle == city && asset.kind == "doorway"), $"{city}: no doorway");
            }
            Require(!string.IsNullOrEmpty(parameters.cityStyleSource) && parameters.cityStyleSource.Contains("cityStyle"),
                "The manifest does not record the per-city cityStyle source");
            Require(!string.IsNullOrEmpty(parameters.stationData) && parameters.stationData.Contains("cityStyle"),
                "Expected the exports to stand in a per-asset station document");
            Require(!string.IsNullOrEmpty(parameters.exitNames) && parameters.exitNames.Contains("13号口"),
                "The manifest does not record the Shanghai 13号口 exit naming");
            Require(!string.IsNullOrEmpty(parameters.headerStyles) && parameters.headerStyles.Contains("nanjing"),
                "The manifest does not record the per-city header styles");
            Require(parameters.stationSamples != null && parameters.stationSamples.Length == CityCount,
                $"Expected {CityCount} station samples, got {parameters.stationSamples?.Length ?? 0}");

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var imported = new List<ImportedWayfinding>();
            foreach (var expected in Rows)
            {
                var asset = manifest.assets.Single(entry => entry.id == expected.id);
                CheckFamilyParameters(asset, expected, parameters);
                var row = ImportAsset(asset, expected, evidence);
                imported.Add(row);
                summary.Add($"{asset.id}={asset.triangles}t/{asset.materials.Length}m/{asset.textures}tex");
            }

            // Unity mints fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene is never byte-identical between two imports. The
            // scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above, so create it only when it is missing and
            // verify its content on every run.
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"WAYFINDING_IMPORT_OK {imported.Count} models " +
                      $"{imported.Count(row => row.expected.kind == "guidepost")} guideposts " +
                      $"{imported.Count(row => row.expected.kind == "doorway")} doorways " +
                      $"cities={string.Join(",", parameters.cities)} " +
                      $"row={RowX(0):F2}..{RowX(CityCount - 1):F2} spacing={Spacing:F1} " +
                      $"rows={DoorwayRow:F1}/{GuidepostRow:F1} cameraY={CameraPosition.y:F2} far={CameraFarPlane:F0} " +
                      string.Join(" ", summary));
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

        private static readonly string[] Cities = { "guangzhou", "shenzhen", "shanghai", "beijing", "chengdu", "chongqing", "wuhan", "nanjing" };

        private static void CheckFamilyParameters(Asset asset, Expected expected, Parameters parameters)
        {
            string label = $"{asset.id}: ";
            Require(asset.kind == expected.kind, $"{label}kind {asset.kind} != {expected.kind}");
            Require(asset.cityStyle == expected.city, $"{label}city style {asset.cityStyle} != {expected.city}");
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.file, $"{label}file {asset.file}");
            Require(asset.units == "metres", $"{label}units {asset.units}");
            Require(asset.parameters != null, $"{label}no per-asset parameters");
            var p = asset.parameters;
            Require(p.kind == expected.kind && p.cityStyle == expected.city, $"{label}parameter kind/city drifted");
            Require(p.exitName == expected.exitName, $"{label}exit name {p.exitName} != {expected.exitName}");
            Require(asset.station != null && asset.station.name == p.station && asset.station.nameEn == p.stationEn,
                $"{label}station block drifted from the parameters");
            Require(!string.IsNullOrEmpty(asset.station?.lineColour), $"{label}missing the city line colour");
            Require(asset.station.lineColour == p.lineColour, $"{label}line colour {asset.station.lineColour} != {p.lineColour}");
            Require(asset.city != null && asset.city.style == expected.city, $"{label}city block drifted");
            Require(asset.city.brand == expected.city + "_metro", $"{label}city brand {asset.city.brand}");
            Require(asset.placementOffset != null && asset.placementOffset.Length == 3, $"{label}missing placement offset");
            Near(new Vector3(asset.placementOffset[0], asset.placementOffset[1], asset.placementOffset[2]),
                new Vector3(0.5f, 0.5f, 1f), $"{label}placement offset");
            Require(asset.forward != null && asset.forward.Length == 3, $"{label}missing forward direction");
            Near(Basis(asset.forward),
                expected.kind == "doorway" ? Vector3.forward : Vector3.back, $"{label}forward direction");
            Require(!string.IsNullOrEmpty(asset.facade) && asset.facade.Contains(expected.kind == "doorway" ? "+y" : "-y"),
                $"{label}facade text {asset.facade}");
            Require(asset.materials != null && asset.materials.Length == expected.materials,
                $"{label}expected {expected.materials} materials, got {asset.materials?.Length ?? 0}");
            Require(asset.plates == expected.plates, $"{label}expected {expected.plates} canvas plates, got {asset.plates}");
            Require(asset.textures == expected.plates, $"{label}{asset.textures} textures for {expected.plates} plates");
            Require(asset.alphaMaterials != null && asset.alphaMaterials.Length == expected.alpha,
                $"{label}expected {expected.alpha} alpha slots, got {asset.alphaMaterials?.Length ?? 0}");
            Require(asset.glassMaterials != null && asset.glassMaterials.Length == 0, $"{label}this family has no glass");
            Require(asset.palette != null && asset.palette.Length == expected.materials, $"{label}palette record is incomplete");

            // Every plate is named from its canvas, so a plate count is also the
            // number of guidePlate_/exitHeaderPlate_ slots.
            string platePrefix = expected.kind == "guidepost" ? "guidePlate_" : "exitHeaderPlate_";
            Require(asset.materials.Count(name => name.StartsWith(platePrefix, StringComparison.Ordinal)) == expected.plates,
                $"{label}the {expected.plates} canvas plates are not all named {platePrefix}*");

            if (expected.kind == "guidepost")
            {
                Require(p.guideCityStyle == expected.city, $"{label}builder city style {p.guideCityStyle}");
                Require(p.plateCount == expected.plates && p.plateMeshes >= expected.plates,
                    $"{label}plate record {p.plateCount}/{p.plateMeshes}");
                Require(p.platePrefix == "guide", $"{label}plate prefix {p.platePrefix}");
                Require(Mathf.Abs(p.heightMetres - expected.height) < 0.01f, $"{label}height {p.heightMetres} != {expected.height}");
                Require(p.header == null || string.IsNullOrEmpty(p.header.style),
                    $"{label}a guidepost must not carry a doorway header");
                Require(asset.materials.Any(name => name.StartsWith("guidePart_", StringComparison.Ordinal)) ||
                        expected.city == "guangzhou",
                    $"{label}no guidePart_* city material");
                // The city palette: the Guangzhou default is the palette pillar,
                // the seven city builders mint their own colours.
                if (expected.city == "guangzhou")
                {
                    foreach (var name in new[] { "exitRed", "psu", "darkSteel" })
                        Require(asset.materials.Contains(name), $"{label}missing the {name} palette slot");
                }
            }
            else
            {
                Require(p.header != null && !string.IsNullOrEmpty(p.header.style), $"{label}no doorway header record");
                var header = p.header;
                Require(header.style == expected.headerStyle, $"{label}header style {header.style} != {expected.headerStyle}");
                Require(header.bandColour == expected.band, $"{label}header band {header.bandColour} != {expected.band}");
                Require(header.panelMaterial == expected.panelMaterial, $"{label}panel material {header.panelMaterial}");
                Require(header.canvas == expected.headerCanvas, $"{label}header canvas {header.canvas} != {expected.headerCanvas}");
                Require(header.logicalWidth == 512, $"{label}logical header width {header.logicalWidth}");
                Require(header.lineBadges == expected.badges, $"{label}line badges {header.lineBadges} != {expected.badges}");
                Require(header.drawsExitName == expected.drawsExitName, $"{label}draws-exit flag drifted");
                Require(header.exitIdentifier == expected.identifier, $"{label}exit identifier {header.exitIdentifier}");
                Require(asset.city.entranceColour == expected.band, $"{label}entrance colour {asset.city.entranceColour}");
                Require(asset.materials.Contains(expected.panelMaterial), $"{label}missing the entrance-colour panel");
                Require(Mathf.Abs(p.widthMetres - expected.width) < 0.0001f, $"{label}width {p.widthMetres}");
                Require(Mathf.Abs(p.heightMetres - expected.height) < 0.0001f, $"{label}height {p.heightMetres}");
                Require(Mathf.Abs(p.depthMetres - expected.depth) < 0.0001f, $"{label}depth {p.depthMetres}");
                Require(string.IsNullOrEmpty(p.platePrefix) && p.plateCount == 0, $"{label}a doorway has no guidepost plate record");
            }

            // The station sample is one of the family's eight, with its own line.
            var sample = parameters.stationSamples.Single(entry => entry.city == expected.city);
            Require(sample.name == asset.station.name && sample.nameEn == asset.station.nameEn,
                $"{label}station sample drifted");
            Require(sample.line == asset.station.lineId && sample.lineColour == asset.station.lineColour,
                $"{label}line sample drifted");
        }

        private static ImportedWayfinding ImportAsset(Asset asset, Expected expected, string evidence)
        {
            string label = asset.id;
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
            // degrees about Y, as in ReviewShelf/ReviewExit.
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
            Near(Basis(asset.anchors.Approach), expected.kind == "doorway" ? Vector3.forward : Vector3.back,
                $"{label} approach face");

            var renderers = root.GetComponentsInChildren<MeshRenderer>();
            Require(renderers.Length > 0, $"{label}: imported model has no mesh renderers");
            var filters = root.GetComponentsInChildren<MeshFilter>();
            Require(filters.Length == asset.meshes, $"{label}: expected {asset.meshes} mesh nodes, got {filters.Length}");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
            Near(bounds.min, Basis(asset.min), $"{label} minimum bounds");
            Near(bounds.max, Basis(asset.max), $"{label} maximum bounds");
            var size = BasisSize(asset.size);
            Near(bounds.size, size, $"{label} bounds size");
            Near(size, new Vector3(expected.width, expected.height, expected.depth), $"{label} family size", expected.tolerance);
            // A guidepost is a ~4 m post; a doorway is a waist-high 3 m panel.
            if (expected.kind == "guidepost")
                Require(size.y > 3.6f && size.y < 4.2f, $"{label}: guidepost height {size.y:F2} m");
            else
                Require(Mathf.Abs(size.x - 3f) < 0.002f && size.y < 0.9f, $"{label}: doorway {size.x:F2} x {size.y:F2} m");

            int triangles = filters.Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == asset.triangles, $"{label}: expected {asset.triangles} triangles, got {triangles}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(asset.materials),
                $"{label}: unexpected materials {string.Join(", ", materials)}");

            // Every alpha slot sorts in the transparent queue, every other slot
            // stays opaque. The guidepost's ink plates are the family's transparent
            // surfaces (Guangzhou's three, Nanjing's none); a doorway header is
            // printed opaque on the entrance-colour panel.
            foreach (var material in importedMaterials)
            {
                bool alpha = asset.alphaMaterials.Contains(material.name);
                if (alpha)
                    Require(material.renderQueue >= (int)RenderQueue.Transparent,
                        $"{label}: {material.name} lost its transparent queue ({material.renderQueue})");
                else
                    Require(material.renderQueue < (int)RenderQueue.Transparent,
                        $"{label}: {material.name} should be opaque ({material.renderQueue})");
                Require(asset.glassMaterials.Length == 0 && !material.name.ToLowerInvariant().Contains("glass"),
                    $"{label}: this family carries no glass");
            }

            // The recorded palette must match the imported materials: colour,
            // transparency and the printed map. `mainTexture` is not used here:
            // glTFast's graph shaders report Unity's default white texture for an
            // unassigned [MainTexture] slot, while GetTexture stays null.
            foreach (var entry in asset.palette)
            {
                var material = importedMaterials.SingleOrDefault(candidate => candidate.name == entry.name);
                Require(material != null, $"{label}: palette slot {entry.name} is missing from the import");
                if (entry.colour != null)
                {
                    Require(ColorUtility.TryParseHtmlString(entry.colour, out var expectedColour),
                        $"{label}: unreadable palette colour {entry.colour}");
                    var actual = ColourOf(material);
                    Require(Mathf.Abs(actual.r - expectedColour.r) < 0.02f &&
                            Mathf.Abs(actual.g - expectedColour.g) < 0.02f &&
                            Mathf.Abs(actual.b - expectedColour.b) < 0.02f,
                        $"{label}: {entry.name} colour {actual} != {expectedColour}");
                }
                Require((material.renderQueue >= (int)RenderQueue.Transparent) == entry.transparent,
                    $"{label}: {entry.name} transparency drifted");
                // JsonUtility reads a JSON null string as "", so an absent map is
                // an empty string rather than a null reference.
                Require(HasMap(material) == !string.IsNullOrEmpty(entry.map),
                    $"{label}: {entry.name} map presence drifted");
            }

            var textures = importedMaterials
                .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(IsPrintedTexture).Distinct().ToArray();
            Require(textures.Length == asset.textures,
                $"{label}: expected {asset.textures} textures, got {textures.Length}");
            // Each plate keeps a readable canvas: 8 px or more on a side, so a
            // lost or 1 px texture cannot pass.
            foreach (var texture in textures)
                Require(texture.width >= 8 && texture.height >= 8,
                    $"{label}: plate texture {texture.name} is {texture.width}x{texture.height}");

            CheckHierarchy(root, expected);
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
                $"{label}: could not save wrapper prefab");
            UnityEngine.Object.DestroyImmediate(root);

            return new ImportedWayfinding { expected = expected, manifest = asset, prefabPath = prefabPath };
        }

        /// <summary>Preserved builder hierarchy: the parts each builder names.</summary>
        private static void CheckHierarchy(GameObject root, Expected expected)
        {
            int nodes = root.GetComponentsInChildren<Transform>().Length;
            switch (expected.city)
            {
                case "guangzhou" when expected.kind == "guidepost":
                    Require(FindNode(root, "guide-triangular-column") != null, "guangzhou: guidepost column missing");
                    Require(FindNode(root, "guide-yellow-logo-collar") != null, "guangzhou: logo collar missing");
                    Require(FindNode(root, "guide-station-face") != null, "guangzhou: station plate missing");
                    Require(FindNode(root, "guide-square-exit-letter") != null, "guangzhou: exit-letter plate missing");
                    break;
                case "shenzhen" when expected.kind == "guidepost":
                    Require(FindNode(root, "shenzhen-guide-grey-column") != null, "shenzhen: column missing");
                    Require(FindNode(root, "shenzhen-guide-green-ring") != null, "shenzhen: crown ring missing");
                    break;
                case "shanghai" when expected.kind == "guidepost":
                    Require(FindNode(root, "shanghai-guide-mast") != null, "shanghai: mast missing");
                    Require(FindNode(root, "shanghai-guide-lantern") != null, "shanghai: lantern missing");
                    break;
                case "beijing" when expected.kind == "guidepost":
                    Require(FindNode(root, "beijing-guide-blue-column") != null, "beijing: column missing");
                    Require(FindNode(root, "beijing-guide-live-labels") != null, "beijing: live labels missing");
                    break;
                case "chengdu" when expected.kind == "guidepost":
                    Require(FindNode(root, "chengdu-guide-blue-logo-box") != null, "chengdu: logo box missing");
                    Require(FindNode(root, "chengdu-guide-live-labels") != null, "chengdu: live labels missing");
                    break;
                case "chongqing" when expected.kind == "guidepost":
                    Require(FindNode(root, "chongqing-guide-silver-ring") != null, "chongqing: crown ring missing");
                    Require(FindNode(root, "chongqing-guide-green-box") != null, "chongqing: CRT box missing");
                    break;
                case "wuhan" when expected.kind == "guidepost":
                    Require(FindNode(root, "wuhan-guide-square-shaft") != null, "wuhan: shaft missing");
                    Require(FindNode(root, "wuhan-guide-logo-face") != null, "wuhan: logo face missing");
                    break;
                case "nanjing" when expected.kind == "guidepost":
                    Require(FindNode(root, "nanjing-guide-white-pylon") != null, "nanjing: pylon missing");
                    Require(FindNode(root, "nanjing-guide-live-face") != null, "nanjing: printed face missing");
                    break;
                default:
                    Require(FindNode(root, "exit-doorway-sign") != null, $"{expected.city}: printed header plate missing");
                    break;
            }
            Require(nodes > 2, $"{expected.id}: imported hierarchy was flattened ({nodes} nodes)");
        }

        /// <summary>
        /// One review scene: the eight doorway panels in the front row and the eight
        /// guideposts behind them, both on 4 m centres. The doorway's printed face is
        /// local +y, so each panel is turned 180° to read to the camera; a guidepost's
        /// plates already face local −y. Only called when the scene is missing.
        /// </summary>
        private static void BuildReviewScene(List<ImportedWayfinding> rows)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            foreach (var row in rows)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(row.prefabPath);
                Require(prefab != null, $"Missing prefab for {row.manifest.id}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(RowX(row.expected.column), 0f, RowZ(row.expected));
                instance.transform.rotation = Quaternion.Euler(0f, Yaw(row.expected), 0f);
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
                "Could not save the wayfinding review scene");
        }

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: the sixteen
        /// prefab instances linked to the wrapper prefabs at their row positions and
        /// facings, plus the slate camera (250 m far plane) and the key light the
        /// Web check depends on.
        /// </summary>
        private static void VerifyReviewScene(List<ImportedWayfinding> rows)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            foreach (var row in rows)
            {
                var instance = roots.SingleOrDefault(root => root.name == row.expected.prefab);
                Require(instance != null, $"Review scene is missing the {row.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == row.prefabPath,
                    $"{row.expected.prefab} is not an instance of {row.prefabPath}");
                Near(instance.transform.position,
                    new Vector3(RowX(row.expected.column), 0f, RowZ(row.expected)),
                    $"{row.expected.prefab} row placement");
                Require(Quaternion.Angle(instance.transform.rotation, Quaternion.Euler(0f, Yaw(row.expected), 0f)) < 0.01f,
                    $"{row.expected.prefab} row facing changed");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{row.expected.prefab} instance has no renderers");
            }

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(Mathf.Abs(camera.fieldOfView - CameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(Mathf.Abs(camera.farClipPlane - CameraFarPlane) < 0.01f, "Review camera far plane changed");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Near(camera.transform.position, CameraPosition, "Review camera position");
            var forward = (CameraTarget - CameraPosition).normalized;
            Require(Vector3.Dot(camera.transform.forward, forward) > 0.999f, "Review camera no longer looks at the rows");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 1, "Review scene is missing its directional key light");
        }

        private static float RowX(int column) => (column - (CityCount - 1) / 2f) * Spacing;

        private static float RowZ(Expected expected) => expected.kind == "doorway" ? DoorwayRow : GuidepostRow;

        private static float Yaw(Expected expected) => expected.kind == "doorway" ? 180f : 0f;

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        /// <summary>Source sizes swap Y and Z into the Unity channels.</summary>
        private static Vector3 BasisSize(float[] v) => new Vector3(v[0], v[2], v[1]);

        /// <summary>
        /// The base colour of an imported material. glTFast 6 names the property
        /// `baseColorFactor`; older builds used `_BaseColor`, and a plain Unity
        /// material keeps `_Color`.
        /// </summary>
        private static Color ColourOf(Material material)
        {
            foreach (var property in new[] { "baseColorFactor", "_BaseColor", "_Color" })
                if (material.HasProperty(property)) return material.GetColor(property);
            return Color.white;
        }

        /// <summary>
        /// A real imported map. glTFast's Shader Graph materials report Unity's
        /// unnamed default textures for unassigned slots, so a reference alone is
        /// not evidence of a printed plate.
        /// </summary>
        private static bool IsPrintedTexture(Texture texture) =>
            texture != null && !string.IsNullOrEmpty(texture.name);

        private static bool HasMap(Material material) =>
            material.GetTexturePropertyNames().Any(name => IsPrintedTexture(material.GetTexture(name)));

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
