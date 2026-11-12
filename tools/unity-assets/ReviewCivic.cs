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
    /// Import the eight city-exit GLBs exported by export-civic.mjs — Guangzhou's
    /// default red-framed portal drawn inline in ExitModel.ts, plus the seven
    /// authored city canopies (Shenzhen, Shanghai, Beijing, Chengdu, Chongqing,
    /// Wuhan, Nanjing) with their printed header fascias — wrap each in a prefab
    /// under the Unity gameplay basis, verify the family parameters, digest,
    /// off-centre bounds, triangles, material set, texture count and sizes, the
    /// glass/alpha queues, the printed header texture (the evidence for the same
    /// city's header row), the builder-owned canopy and sign nodes, and the basis
    /// anchors at four facings, then save one review scene with all eight in a row.
    /// </summary>
    public static class ReviewCivic
    {
        private const string Folder = "Assets/CivicProof";
        private const string Scene = Folder + "/Civic.unity";
        private const int Count = 8;
        private const float Spacing = 8.6f;
        private const float CameraFieldOfView = 60f;
        private const float CameraFarPlane = 300f;

        /// <summary>
        /// The camera stands back from the 60 m row at just above canopy height and
        /// looks level at it, so each printed fascia reads under its own canopy
        /// overhang. check-web-civic.mjs renders the same camera at 2x device pixel
        /// ratio and projects the row with it.
        /// </summary>
        private static readonly Vector3 CameraPosition = new Vector3(0f, 5f, -46f);
        private static readonly Vector3 CameraTarget = new Vector3(0f, 2.2f, 0f);
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
            public string family, cityStyleSource, stationData, lineColour;
            public string exitNameSource, placement, exitWidths;
            public string headerPolicy, headerResolution, palette, textures, boundsNote, basis;
            public float enclosedLengthMetres, canopyHeightMetres, canopyReachMetres;
            public float streetOverhangMetres, backWallMetres, baseHeightMetres;
            public string[] cities;
            public ExitName[] exitNames;
            public HeaderColour[] headerColours;
            public CitySpec[] citySpecs;
        }

        [Serializable]
        private class ExitName
        {
            public string city, exitName, convention;
        }

        [Serializable]
        private class HeaderColour
        {
            public string city, ground, entranceColour;
            public int inkPixels, distinctColours;
        }

        [Serializable]
        private class CitySpec
        {
            public string city, paletteId, prefab, exitName, headerGround, canopyNode, headerNode;
            public int headerWidth, headerHeight, triangles, textures, materials;
            public float[] sizeMetres;
            public float depthMetres;
        }

        [Serializable]
        private class Asset
        {
            public string id, paletteId, family, city, cityStyle, prefab, file, sha256;
            public string source, provenance, licenseRecord, units, facade, forwardDirection;
            public string exitName, exitNameConvention;
            public string[] rows, materials, alphaMaterials, glassMaterials;
            public float[] placementOffset, min, max, size, forward;
            public Anchors anchors;
            public Header header;
            public HeaderEvidence headerEvidence;
            public TextureInfo[] textureList;
            public AssetParameters parameters;
            public int triangles, meshes, textures;
        }

        [Serializable]
        private class Header
        {
            public string material, city, exitName, groundHex;
            public int width, height, inkPixels, distinctColours;
            public float[] ground;
        }

        [Serializable]
        private class HeaderEvidence
        {
            public string prefab, file, texture;
            public int width, height;
        }

        [Serializable]
        private class TextureInfo
        {
            public string name;
            public int width, height;
        }

        [Serializable]
        private class AssetParameters
        {
            public string variant, style, cityStyle, exitName, canopyNode, headerNode;
            public bool covered;
            public int bays;
            public float widthMetres, enclosedLengthMetres, canopyHeightMetres, canopyReachMetres;
            public float streetOverhangMetres, backWallMetres, baseHeightMetres;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        /// <summary>One row slot: the recipe values the manifest must reproduce.</summary>
        private class Expected
        {
            public string city, paletteId, prefab, entrance, canopyNode, headerNode;
            public int headerWidth, headerHeight;
            public float width, height, depth, yaw;
        }

        // One covered 双向 head-house per city, in checklist order. Sizes are Unity
        // metres: x across the head-house, y up from the 0.25 m plinth, z along the
        // run (5.6 m of canopy over the run plus the 2.3 m street overhang). The
        // extra height on Nanjing and Beijing is the rooftop sign; the extra WIDTH
        // on Shenzhen is the projecting metro blade.
        private static readonly Expected[] Rows =
        {
            // The inline Guangzhou default: red steel portal frame, blue waved roof.
            new Expected { city = "guangzhou", paletteId = "city-exit-guangzhou", prefab = "CityExitGuangzhou", entrance = "#c22f28", canopyNode = "exit-canopy-segment", headerNode = null, headerWidth = 512, headerHeight = 96, width = 4.10f, height = 4.00f, depth = 8.12f, yaw = 180f },
            new Expected { city = "shenzhen", paletteId = "city-exit-shenzhen", prefab = "CityExitShenzhen", entrance = "#101b2b", canopyNode = "shenzhen-curved-canopy", headerNode = null, headerWidth = 512, headerHeight = 96, width = 4.56f, height = 3.59f, depth = 8.10f, yaw = 180f },
            new Expected { city = "shanghai", paletteId = "city-exit-shanghai", prefab = "CityExitShanghai", entrance = "#353b35", canopyNode = "shanghai-flat-canopy", headerNode = null, headerWidth = 512, headerHeight = 96, width = 4.00f, height = 3.64f, depth = 8.10f, yaw = 180f },
            new Expected { city = "beijing", paletteId = "city-exit-beijing", prefab = "CityExitBeijing", entrance = "#073563", canopyNode = "beijing-stainless-canopy", headerNode = "beijing-entrance-sign", headerWidth = 512, headerHeight = 96, width = 4.00f, height = 4.58f, depth = 8.10f, yaw = 180f },
            new Expected { city = "chengdu", paletteId = "city-exit-chengdu", prefab = "CityExitChengdu", entrance = "#343433", canopyNode = "chengdu-silver-curved-roof", headerNode = "chengdu-entrance-sign", headerWidth = 2048, headerHeight = 384, width = 4.00f, height = 3.65f, depth = 8.10f, yaw = 180f },
            new Expected { city = "chongqing", paletteId = "city-exit-chongqing", prefab = "CityExitChongqing", entrance = "#f2f0dd", canopyNode = "chongqing-silver-roof", headerNode = "chongqing-entrance-sign", headerWidth = 2048, headerHeight = 384, width = 4.00f, height = 3.45f, depth = 8.22f, yaw = 180f },
            new Expected { city = "wuhan", paletteId = "city-exit-wuhan", prefab = "CityExitWuhan", entrance = "#183b70", canopyNode = "wuhan-flat-silver-roof", headerNode = "wuhan-entrance-sign", headerWidth = 2048, headerHeight = 384, width = 4.03f, height = 3.75f, depth = 8.14f, yaw = 180f },
            new Expected { city = "nanjing", paletteId = "city-exit-nanjing", prefab = "CityExitNanjing", entrance = "#14213f", canopyNode = "nanjing-sloped-silver-roof", headerNode = "nanjing-entrance-sign", headerWidth = 2048, headerHeight = 384, width = 4.00f, height = 4.86f, depth = 8.49f, yaw = 180f },
        };

        private class ImportedCity
        {
            public Expected expected;
            public Asset manifest;
            public string prefabPath;
            public string headerTexture;
        }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            string summaryPath = Path.Combine(evidence, "export", "manifest.json");
            Require(File.Exists(summaryPath), $"Missing {summaryPath}");
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(summaryPath));
            Require(manifest?.assets != null, "Unreadable civic export manifest");
            Require(manifest.assets.Length == Count, $"Expected {Count} city exits in the manifest, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.paletteId).Distinct().Count() == Count, "The manifest repeats a palette id");
            Require(manifest.assets.Select(asset => asset.city).Distinct().Count() == Count, "The manifest repeats a city");
            Require(manifest.assets.Select(asset => asset.sha256).Distinct().Count() == Count, "Two cities exported the same GLB");
            Require(manifest.family == "civic", $"Unexpected manifest family {manifest.family}");

            var parameters = manifest.parameters;
            Require(parameters != null, "The manifest is missing its family parameters");
            Require(parameters.models == Count, $"Expected {Count} family models, got {parameters.models}");
            Require(parameters.rot == 0, $"Expected rot 0 exports, got {parameters.rot}");
            Require(parameters.cities != null && parameters.cities.Length == Count,
                $"Expected {Count} cities, got {parameters.cities?.Length ?? 0}");
            for (int i = 0; i < Count; i++)
                Require(parameters.cities[i] == Rows[i].city, $"City {i} is {parameters.cities[i]}, expected {Rows[i].city}");
            Require(!string.IsNullOrEmpty(parameters.cityStyleSource) && parameters.cityStyleSource.Contains("cityStyle"),
                "The manifest does not record that the city style drives both the canopy and the header");
            Require(!string.IsNullOrEmpty(parameters.stationData) && parameters.stationData.Contains("empty"),
                "Expected the exports to stand in an empty station document");
            Require(!string.IsNullOrEmpty(parameters.headerPolicy) && parameters.headerPolicy.Contains("one prefab") &&
                    parameters.headerPolicy.Contains("header"),
                "The manifest does not record that one prefab is both the canopy and header evidence");
            Require(!string.IsNullOrEmpty(parameters.headerResolution) && parameters.headerResolution.Contains("2048"),
                "The manifest does not record the per-city header resolution");
            Require(!string.IsNullOrEmpty(parameters.boundsNote) && parameters.boundsNote.Contains("off-centre") &&
                    parameters.boundsNote.Contains("-y"),
                "The manifest does not record the off-centre bounds");
            Require(!string.IsNullOrEmpty(parameters.exitNameSource) && parameters.exitNameSource.Contains("moduleThumbnails"),
                "The manifest does not record where the exit name convention comes from");
            Require(parameters.exitNames != null && parameters.exitNames.Length == Count,
                $"Expected {Count} exit name entries, got {parameters.exitNames?.Length ?? 0}");
            Require(parameters.headerColours != null && parameters.headerColours.Length == Count,
                $"Expected {Count} header colour entries, got {parameters.headerColours?.Length ?? 0}");
            Require(parameters.citySpecs != null && parameters.citySpecs.Length == Count,
                $"Expected {Count} city spec entries, got {parameters.citySpecs?.Length ?? 0}");
            Require(Mathf.Approximately(parameters.enclosedLengthMetres, 4f), $"Unexpected enclosed length {parameters.enclosedLengthMetres}");
            Require(Mathf.Approximately(parameters.canopyHeightMetres, 3.2f), $"Unexpected canopy height {parameters.canopyHeightMetres}");
            Require(Mathf.Approximately(parameters.canopyReachMetres, 5.6f), $"Unexpected canopy reach {parameters.canopyReachMetres}");
            Require(Mathf.Approximately(parameters.streetOverhangMetres, 2.3f), $"Unexpected street overhang {parameters.streetOverhangMetres}");
            Require(Mathf.Approximately(parameters.backWallMetres, -5.5f), $"Unexpected back wall {parameters.backWallMetres}");
            Require(Mathf.Approximately(parameters.baseHeightMetres, 0.25f), $"Unexpected base height {parameters.baseHeightMetres}");
            Require(!string.IsNullOrEmpty(parameters.exitWidths) && parameters.exitWidths.Contains("exitWidth(2) = 4"),
                "The manifest does not record the shared two-bay width");

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var imported = new List<ImportedCity>();
            foreach (var expected in Rows)
            {
                var asset = manifest.assets.Single(entry => entry.paletteId == expected.paletteId);
                CheckFamilyParameters(asset, expected, parameters);
                var city = ImportAsset(asset, expected, evidence);
                imported.Add(city);
                summary.Add($"{asset.city}={asset.triangles}t/{asset.materials.Length}m/{asset.textures}tex/" +
                            $"{asset.header.width}x{asset.header.height}/headerTex={city.headerTexture}");
            }

            // Unity mints fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene is never byte-identical between two imports. The
            // scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above, so create it only when it is missing and
            // verify its content on every run.
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"CIVIC_IMPORT_OK {imported.Count} cities {string.Join(" ", summary)} " +
                      $"row={RowX(0):F2}..{RowX(Count - 1):F2} spacing={Spacing:F1} cameraY={CameraPosition.y:F2} far={CameraFarPlane:F0}");
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
            string label = $"{asset.city}: ";
            Require(asset.id == expected.paletteId, $"{label}manifest id {asset.id} != {expected.paletteId}");
            Require(asset.paletteId == expected.paletteId, $"{label}palette id {asset.paletteId}");
            Require(asset.family == "civic", $"{label}family {asset.family}");
            Require(asset.city == expected.city, $"{label}city {asset.city}");
            Require(asset.cityStyle == expected.city, $"{label}cityStyle {asset.cityStyle} != {expected.city}");
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.paletteId + ".glb", $"{label}file {asset.file}");
            Require(asset.units == "metres", $"{label}units {asset.units}");
            // Both of the city's checklist rows point at this one prefab: the
            // printed header is part of the exit asset, not a separate plate.
            Require(asset.rows != null && asset.rows.Length == 2, $"{label}missing the canopy/header row ids");
            Require(asset.rows[0] == $"city-{expected.city}-exit-canopy" && asset.rows[1] == $"city-{expected.city}-exit-header",
                $"{label}row ids {string.Join(",", asset.rows)}");
            Require(asset.placementOffset != null && asset.placementOffset.Length == 3, $"{label}missing placement offset");
            Near(new Vector3(asset.placementOffset[0], asset.placementOffset[1], asset.placementOffset[2]),
                new Vector3(0.5f, 0.5f, 1f), $"{label}placement offset");
            Require(asset.forward != null && asset.forward.Length == 3, $"{label}missing forward direction");
            Near(new Vector3(asset.forward[0], asset.forward[1], asset.forward[2]), new Vector3(0f, 1f, 0f),
                $"{label}forward direction");
            Require(!string.IsNullOrEmpty(asset.forwardDirection) && asset.forwardDirection.Contains("+y"),
                $"{label}forward direction text {asset.forwardDirection}");
            Require(!string.IsNullOrEmpty(asset.facade) && asset.facade.Contains("+y"),
                $"{label}facade {asset.facade}");

            // The exit name convention is the city pass's: 13号口 on Shanghai,
            // C口 on every other city.
            string exitName = expected.city == "shanghai" ? "13号口" : "C口";
            Require(asset.exitName == exitName, $"{label}exit name {asset.exitName} != {exitName}");
            Require(!string.IsNullOrEmpty(asset.exitNameConvention) &&
                    asset.exitNameConvention.Contains(expected.city == "shanghai" ? "号口" : "口"),
                $"{label}exit name convention {asset.exitNameConvention}");

            Require(asset.parameters != null, $"{label}no per-asset parameters");
            var p = asset.parameters;
            Require(p.style == "head-house", $"{label}style {p.style}");
            Require(p.covered, $"{label}the city head-house must be covered");
            Require(p.bays == 2, $"{label}expected the reference two bays, got {p.bays}");
            Require(p.cityStyle == expected.city, $"{label}parameter city style {p.cityStyle}");
            Require(p.exitName == exitName, $"{label}parameter exit name {p.exitName}");
            Require(p.canopyNode == expected.canopyNode, $"{label}canopy node {p.canopyNode} != {expected.canopyNode}");
            // JsonUtility reads a JSON null string as "", so compare the node
            // names through SameText: "no printed sign node of its own" is a
            // legitimate value for the three cities whose plate is unnamed.
            Require(SameText(p.headerNode, expected.headerNode), $"{label}header node {p.headerNode}");
            Require(Mathf.Abs(p.widthMetres - 4f) < 0.0001f, $"{label}bay width {p.widthMetres} != 4");
            Require(Mathf.Abs(p.enclosedLengthMetres - parameters.enclosedLengthMetres) < 0.0001f,
                $"{label}enclosed length {p.enclosedLengthMetres}");
            Require(Mathf.Abs(p.canopyHeightMetres - parameters.canopyHeightMetres) < 0.0001f &&
                    Mathf.Abs(p.canopyReachMetres - parameters.canopyReachMetres) < 0.0001f,
                $"{label}canopy parameters drifted");
            Require(Mathf.Abs(p.streetOverhangMetres - parameters.streetOverhangMetres) < 0.0001f &&
                    Mathf.Abs(p.backWallMetres - parameters.backWallMetres) < 0.0001f &&
                    Mathf.Abs(p.baseHeightMetres - parameters.baseHeightMetres) < 0.0001f,
                $"{label}head-house depth/base drifted");

            // The printed header: the city's own fascia ground, at the city's own
            // print resolution, with real ink on it. This is the header row's evidence.
            var header = asset.header;
            Require(header != null, $"{label}missing the header record");
            Require(header.city == expected.city, $"{label}header city {header.city}");
            Require(header.exitName == exitName, $"{label}header exit name {header.exitName}");
            Require(header.width == expected.headerWidth && header.height == expected.headerHeight,
                $"{label}header print size {header.width}x{header.height}, expected {expected.headerWidth}x{expected.headerHeight}");
            Require(header.groundHex == expected.entrance,
                $"{label}header ground {header.groundHex} != the city entrance colour {expected.entrance}");
            Require(header.inkPixels > 100, $"{label}the header fascia is nearly blank ({header.inkPixels} ink pixels)");
            Require(header.distinctColours >= 6, $"{label}the header fascia has only {header.distinctColours} colours");
            Require(!string.IsNullOrEmpty(header.material) && header.material.StartsWith("cityExitHeader_"),
                $"{label}header material {header.material}");
            Require(header.material == $"cityExitHeader_{expected.headerWidth}x{expected.headerHeight}",
                $"{label}header material is not named by its print size");
            Require(asset.headerEvidence != null && asset.headerEvidence.prefab == expected.prefab &&
                    asset.headerEvidence.texture == header.material &&
                    asset.headerEvidence.width == expected.headerWidth && asset.headerEvidence.height == expected.headerHeight,
                $"{label}the header evidence does not point at this prefab and its fascia");

            var spec = parameters.citySpecs.Single(entry => entry.city == expected.city);
            Require(spec.paletteId == expected.paletteId && spec.prefab == expected.prefab && spec.exitName == exitName,
                $"{label}family spec drifted from the asset");
            Require(spec.headerWidth == expected.headerWidth && spec.headerHeight == expected.headerHeight &&
                    spec.headerGround == expected.entrance,
                $"{label}family spec header drifted");
            Require(SameText(spec.canopyNode, expected.canopyNode) && SameText(spec.headerNode, expected.headerNode),
                $"{label}family spec nodes drifted");
            Require(Mathf.Abs(spec.depthMetres - expected.depth) < 0.05f,
                $"{label}family spec depth {spec.depthMetres} != {expected.depth}");

            var colour = parameters.headerColours.Single(entry => entry.city == expected.city);
            Require(colour.ground == expected.entrance && colour.entranceColour == expected.entrance,
                $"{label}the header colour record drifted ({colour.ground} / {colour.entranceColour})");
            var name = parameters.exitNames.Single(entry => entry.city == expected.city);
            Require(name.exitName == exitName && !string.IsNullOrEmpty(name.convention),
                $"{label}the exit name record drifted");
        }

        private static ImportedCity ImportAsset(Asset asset, Expected expected, string evidence)
        {
            string label = asset.city;
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
            // degrees about Y, as in ReviewExit/ReviewShelf.
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
            Require(filters.Length == asset.meshes, $"{label}: expected {asset.meshes} mesh nodes, got {filters.Length}");

            // The bounds are large and off-centre through the run: the canopy
            // reaches 5.6 m along -y and only 2.3 m past the street doorway, so
            // min, max and size are all checked against the manifest.
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
            Near(bounds.min, Basis(asset.min), $"{label} minimum bounds");
            Near(bounds.max, Basis(asset.max), $"{label} maximum bounds");
            Near(bounds.size, BasisSize(asset.size), $"{label} bounds size");
            Require(asset.min[1] < -4.9f && asset.max[1] > 1.9f,
                $"{label}: the manifest bounds do not span the run ({asset.min[1]}..{asset.max[1]})");

            int triangles = filters.Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == asset.triangles, $"{label}: expected {asset.triangles} triangles, got {triangles}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(asset.materials),
                $"{label}: unexpected materials {string.Join(", ", materials)}");
            // The family's fixed shape: every city keeps the palette glass and the
            // concrete plinth; Guangzhou alone keeps the red frame and blue roof.
            Require(materials.Contains("glass"), $"{label}: the head-house glass is missing");
            Require(materials.Contains("exitConcrete"), $"{label}: the concrete plinth is missing");
            if (expected.city == "guangzhou")
                Require(materials.Contains("exitRed") && materials.Contains("blue"),
                    $"{label}: the default canopy lost its red frame or blue roof");
            else
                Require(!materials.Contains("exitRed") && !materials.Contains("blue"),
                    $"{label}: a city canopy must not reuse the Guangzhou red frame / blue roof");

            // Every alpha slot sorts in the transparent queue, every other slot
            // stays opaque; the canopy glass is the family's shared transparent
            // surface, and the city plates that print with alphaTest (Shanghai's
            // roundel, Nanjing's emblem/wordmark/portal label) follow it.
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
            var glass = importedMaterials.Where(material => material.name == "glass").ToArray();
            Require(glass.Length == 1, $"{label}: expected the glass material, got {glass.Length}");
            Require(asset.glassMaterials.Contains("glass") && asset.alphaMaterials.Contains("glass"),
                $"{label}: the head-house glass is not recorded as transparent glass");
            Require(glass[0].renderQueue >= (int)RenderQueue.Transparent,
                $"{label}: glass lost its transparent queue ({glass[0].renderQueue})");
            if (glass[0].HasProperty("_BaseColor"))
                Require(glass[0].GetColor("_BaseColor").a < 0.9f,
                    $"{label}: glass is opaque ({glass[0].GetColor("_BaseColor").a:F2})");

            var textures = importedMaterials
                .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length == asset.textures,
                $"{label}: expected {asset.textures} textures, got {textures.Length}");
            Require(asset.textureList != null && asset.textureList.Length == asset.textures,
                $"{label}: the manifest texture list does not match its texture count");
            foreach (var record in asset.textureList)
                Require(textures.OfType<Texture2D>().Any(texture => texture.width == record.width && texture.height == record.height),
                    $"{label}: no imported texture is {record.width}x{record.height} (for {record.name})");

            // The printed header is present as a real imported texture of the
            // recorded print size, carried by the named header material: this is
            // what the header checklist row relies on.
            var headerMaterial = importedMaterials.SingleOrDefault(material => material.name == asset.header.material);
            Require(headerMaterial != null, $"{label}: the header material was not imported");
            var headerTexture = headerMaterial.GetTexturePropertyNames()
                .Select(headerMaterial.GetTexture).OfType<Texture2D>()
                .FirstOrDefault(texture => texture.width == asset.header.width && texture.height == asset.header.height);
            Require(headerTexture != null,
                $"{label}: the printed header texture ({asset.header.width}x{asset.header.height}) is missing");
            Require(headerMaterial.renderQueue < (int)RenderQueue.Transparent,
                $"{label}: the printed fascia should be opaque ({headerMaterial.renderQueue})");
            string headerTextureName = headerTexture.name;

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

            // The family's fixed shape, in Unity metres (x across, y up, z along
            // the run): every city keeps the 4 m two-bay plan and the ~8.1 m run.
            var size = BasisSize(asset.size);
            Near(size, new Vector3(expected.width, expected.height, expected.depth),
                $"{label} family size", 0.02f);

            string prefabPath = $"{Folder}/{asset.prefab}.prefab";
            Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null,
                $"{label}: could not save wrapper prefab");
            UnityEngine.Object.DestroyImmediate(root);

            return new ImportedCity
            {
                expected = expected,
                manifest = asset,
                prefabPath = prefabPath,
                headerTexture = headerTextureName,
            };
        }

        /// <summary>
        /// Preserved builder hierarchy: the plinth every head-house lays, the
        /// builder's own roof node (Guangzhou keeps the shared
        /// `exit-canopy-segment` strip; a city builder must replace it), and the
        /// printed sign node where the city builder names one.
        /// </summary>
        private static void CheckHierarchy(GameObject root, Expected expected)
        {
            int nodes = root.GetComponentsInChildren<Transform>().Length;
            Require(FindNode(root, "exit-concrete-base") != null,
                $"{expected.city}: concrete plinth node missing");
            Require(FindNode(root, expected.canopyNode) != null,
                $"{expected.city}: the builder's canopy node {expected.canopyNode} is missing");
            if (expected.city == "guangzhou")
                Require(FindNode(root, "exit-side-glass") != null,
                    "guangzhou: side glazing nodes missing");
            else
                Require(FindNode(root, "exit-canopy-segment") == null,
                    $"{expected.city}: the shared Guangzhou roof strip leaked into a city canopy");
            if (expected.headerNode != null)
                Require(FindNode(root, expected.headerNode) != null,
                    $"{expected.city}: the printed header node {expected.headerNode} is missing");
            Require(nodes > 20, $"{expected.city}: imported hierarchy was flattened ({nodes} nodes)");
        }

        /// <summary>
        /// One review scene: all eight wrapper prefabs in a row on 8.6 m centres
        /// (the head-houses are 8.1 m deep through the run). Every piece is turned
        /// so its street face and printed header read to the camera. Only called
        /// when the scene is missing.
        /// </summary>
        private static void BuildReviewScene(List<ImportedCity> cities)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < cities.Count; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(cities[i].prefabPath);
                Require(prefab != null, $"Missing prefab for {cities[i].manifest.paletteId}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(RowX(i), 0f, 0f);
                instance.transform.rotation = Quaternion.Euler(0f, cities[i].expected.yaw, 0f);
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
            fill.intensity = 1.0f;
            fill.transform.rotation = Quaternion.Euler(16f, 148f, 0f);

            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.5f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the civic review scene");
        }

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: eight prefab
        /// instances linked to the wrapper prefabs at their row positions and
        /// facings, plus the slate camera and the key light the Web check depends on.
        /// </summary>
        private static void VerifyReviewScene(List<ImportedCity> cities)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            for (int i = 0; i < cities.Count; i++)
            {
                var city = cities[i];
                var instance = roots.SingleOrDefault(root => root.name == city.expected.prefab);
                Require(instance != null, $"Review scene is missing the {city.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == city.prefabPath,
                    $"{city.expected.prefab} is not an instance of {city.prefabPath}");
                Near(instance.transform.position, new Vector3(RowX(i), 0f, 0f), $"{city.expected.prefab} row placement");
                Require(Quaternion.Angle(instance.transform.rotation, Quaternion.Euler(0f, city.expected.yaw, 0f)) < 0.01f,
                    $"{city.expected.prefab} row facing changed");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{city.expected.prefab} instance has no renderers");
            }

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(Mathf.Abs(camera.fieldOfView - CameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(Mathf.Abs(camera.farClipPlane - CameraFarPlane) < 0.01f, "Review camera far plane changed");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Near(camera.transform.position, CameraPosition, "Review camera position");
            var forward = (CameraTarget - CameraPosition).normalized;
            Require(Vector3.Dot(camera.transform.forward, forward) > 0.999f, "Review camera no longer looks at the row");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 1, "Review scene is missing its directional key light");
        }

        private static float RowX(int index) => (index - (Count - 1) / 2f) * Spacing;

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

        /// <summary>
        /// JsonUtility reads a JSON null string as an empty string, so a record
        /// that means "this city's builder names no sign node" compares through
        /// this instead of a raw reference comparison.
        /// </summary>
        private static bool SameText(string actual, string expected) => (actual ?? "") == (expected ?? "");
    }
}
