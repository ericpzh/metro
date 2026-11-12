using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.AssetExample
{
    /// <summary>
    /// Import the ten vehicle-family GLBs exported by export-vehicle.mjs: the six
    /// Guangzhou road vehicles (SUV, sedan, both bus liveries, moped, bicycle) and
    /// the four city train marks (Guangzhou, Beijing, Chongqing, Nanjing). Each is
    /// wrapped in a prefab under the Unity gameplay basis, the family parameters,
    /// bounds, triangle counts, material sets, texture counts, alpha queues and
    /// basis anchors are checked, and one review scene holds all ten in a row:
    /// vehicles on 13 m centres in a 3/4 pose, the marks on 2.5 m centres at the end.
    /// </summary>
    public static class ReviewVehicle
    {
        private const string Folder = "Assets/VehicleProof";
        private const string Scene = Folder + "/Vehicle.unity";
        private const int Count = 10;
        private const int VehicleCount = 6;

        /// <summary>
        /// The row: six vehicles on 13 m centres (the 10 m bus is the longest, so
        /// the pitch clears it with room to read the silhouette), then the four cab
        /// marks on 2.5 m centres after a 5 m gap. Vehicles are posed 30 degrees
        /// off the row axis so the review shows their flanks — the bus livery, the
        /// cycle frames — while the marks keep their authored +Z facing.
        /// </summary>
        private const float VehiclePitch = 13f;
        private const float MarkPitch = 2.5f;
        private const float MarkGap = 5f;
        private const float VehicleYaw = -30f;

        /// <summary>
        /// A three-quarter view down the row from beyond the marks: near enough to
        /// read the decal canvases and the cycle frames, far enough that the 80 m
        /// run fits the 45 degree frame. The far plane covers the family's largest
        /// asset several times over as the Web check requires.
        /// </summary>
        private static readonly Vector3 CameraPosition = new Vector3(55f, 8f, 32f);
        private static readonly Vector3 CameraTarget = new Vector3(26f, 2.4f, 3f);
        private const float CameraFieldOfView = 45f;
        private const float CameraFarPlane = 250f;
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
            public int models, rot;
            public string placement, materials, textures, canvasEncode, basis, depthPrepass;
            public VehicleRow[] vehicles;
            public MarkRow[] marks;
            public Row row;
        }

        [Serializable]
        private class Row
        {
            public float vehiclePitchMetres, markPitchMetres, markGapMetres, vehicleYawDegrees, farPlaneMetres;
            public string[] order;
        }

        [Serializable]
        private class VehicleRow
        {
            public string paletteId, variant;
            public float widthMetres, lengthMetres, heightMetres;
            public int triangles;
            public string[] materials;
        }

        [Serializable]
        private class MarkRow
        {
            public string paletteId, city, material, line, lineColour;
            public int canvasWidth, canvasHeight, atlasSlot;
            public InkCount[] inkCounts;
        }

        [Serializable]
        private class InkCount
        {
            public string color;
            public int pixels;
        }

        [Serializable]
        private class Asset
        {
            public string id, rowId, paletteId, family, kind, variant, prefab, file, sha256, source, provenance, licenseRecord, units, facade;
            public bool catalogue;
            public float[] min, max, size, placementOffset;
            public Anchors anchors;
            public bool hasMark;
            public int triangles, meshes, textures;
            public float rowPitchMetres;
            public string[] materials, alphaMaterials;
            public AssetParameters parameters;
            public MarkInfo mark;
            public Validation validation;
        }

        /// <summary>
        /// The union of the two per-kind parameter blocks. JsonUtility leaves the
        /// fields a given kind does not carry at their defaults.
        /// </summary>
        [Serializable]
        private class AssetParameters
        {
            public string variant, detail, facing, up, materialSettings, city, material, canvasSource, canvasPixels, line, lineColour, marks, readFace;
            public float lengthMetres, widthMetres, heightMetres, opacity, plateWidthMetres, plateHeightMetres;
            public int triangles, colourBins, atlasSlot;
            public bool depthWrite;
            public InkCount[] inkCounts;
        }

        [Serializable]
        private class MarkInfo
        {
            public string city, material, readFace, line, colour;
            public int atlasSlot, opaquePixels;
            public int[] canvas;
            public float widthMetres, heightMetres, plateDepthMetres;
            public InkCount[] colours;
        }

        [Serializable]
        private class Anchors
        {
            public float[] AxisX, Front, Up, Approach;
        }

        [Serializable]
        private class Validation
        {
            public int errors, warnings;
        }

        private class Expected
        {
            public string id, prefab, file, kind, variant, city;
            /// <summary>Source-space extents the exporter asserts on the built geometry.</summary>
            public float width, length, height, pitch;
            public int triangles, textures;
            public string[] materials;
            /// <summary>The mark's primary canvas ink and its exact opaque pixel count.</summary>
            public string ink, secondInk;
            public int inkPixels, secondInkPixels;
        }

        /// <summary>
        /// The ten family rows in review-row order. The extents and triangle counts
        /// are the measured values export-vehicle.mjs asserts on the built geometry,
        /// repeated here so a builder or exporter drift cannot pass review. The ink
        /// counts are the exporter's exact opaque-pixel histogram of each canvas:
        /// Unity decodes the same PNG out of the GLB and must reproduce them.
        /// </summary>
        private static readonly Expected[] ExpectedVehicles =
        {
            new Expected { id = "vehicle-suv", prefab = "VehicleSuv", file = "vehicle-suv.glb", kind = "vehicle", variant = "suv", width = 2.19f, length = 4.2845f, height = 1.791f, triangles = 2568, textures = 0, pitch = 13,
                materials = new[] { "vehicleAccent", "vehicleGlass", "vehicleLamp", "vehicleMetal", "vehiclePaint", "vehicleRubber", "vehicleTail" } },
            new Expected { id = "vehicle-sedan", prefab = "VehicleSedan", file = "vehicle-sedan.glb", kind = "vehicle", variant = "sedan", width = 2.19f, length = 4.2845f, height = 1.51f, triangles = 2492, textures = 0, pitch = 13,
                materials = new[] { "vehicleAccent", "vehicleGlass", "vehicleLamp", "vehicleMetal", "vehiclePale", "vehicleRubber", "vehicleTail" } },
            new Expected { id = "vehicle-bus-orange", prefab = "VehicleBusOrange", file = "vehicle-bus-orange.glb", kind = "vehicle", variant = "bus-orange", width = 2.9f, length = 10.13f, height = 3.325f, triangles = 5612, textures = 0, pitch = 13,
                materials = new[] { "vehicleGlass", "vehicleLamp", "vehicleMetal", "vehiclePaint", "vehiclePale", "vehicleRubber", "vehicleTail" } },
            new Expected { id = "vehicle-bus-mosaic", prefab = "VehicleBusMosaic", file = "vehicle-bus-mosaic.glb", kind = "vehicle", variant = "bus-mosaic", width = 2.9f, length = 10.1562f, height = 3.325f, triangles = 5753, textures = 0, pitch = 13,
                materials = new[] { "vehicleAccent", "vehicleGlass", "vehicleLamp", "vehicleMetal", "vehiclePaint", "vehiclePale", "vehicleRubber", "vehicleTail" } },
            new Expected { id = "vehicle-moped", prefab = "VehicleMoped", file = "vehicle-moped.glb", kind = "vehicle", variant = "moped", width = 0.88f, length = 1.9235f, height = 1.72f, triangles = 3560, textures = 0, pitch = 13,
                materials = new[] { "vehicleAccent", "vehicleGlass", "vehicleLamp", "vehicleMetal", "vehiclePaint", "vehiclePale", "vehicleRubber", "vehicleTail" } },
            new Expected { id = "vehicle-bicycle", prefab = "VehicleBicycle", file = "vehicle-bicycle.glb", kind = "vehicle", variant = "bicycle", width = 0.67f, length = 1.9f, height = 1.81f, triangles = 4080, textures = 0, pitch = 13,
                materials = new[] { "vehicleAccent", "vehicleGlass", "vehicleMetal", "vehiclePaint", "vehiclePale", "vehicleRubber" } },
            new Expected { id = "city-guangzhou-train-mark", prefab = "TrainMarkGuangzhou", file = "train-mark-guangzhou.glb", kind = "mark", variant = "guangzhou", city = "guangzhou", width = 1.48f, length = 0.056f, height = 1.72f, triangles = 14, textures = 1, pitch = 2.5f,
                materials = new[] { "darkSteel", "trainMark" }, ink = "#d8231c", inkPixels = 5856 },
            new Expected { id = "city-beijing-train-mark", prefab = "TrainMarkBeijing", file = "train-mark-beijing.glb", kind = "mark", variant = "beijing", city = "beijing", width = 1.68f, length = 0.056f, height = 1.955f, triangles = 14, textures = 1, pitch = 2.5f,
                materials = new[] { "darkSteel", "trainMark" }, ink = "#ffffff", inkPixels = 2094 },
            new Expected { id = "city-chongqing-train-mark", prefab = "TrainMarkChongqing", file = "train-mark-chongqing.glb", kind = "mark", variant = "chongqing", city = "chongqing", width = 1.88f, length = 0.056f, height = 0.53f, triangles = 14, textures = 1, pitch = 2.5f,
                materials = new[] { "chongqingTrainMark", "darkSteel" }, ink = "#ffffff", inkPixels = 32704, secondInk = "#dc8633", secondInkPixels = 15056 },
            new Expected { id = "city-nanjing-train-mark", prefab = "TrainMarkNanjing", file = "train-mark-nanjing.glb", kind = "mark", variant = "nanjing", city = "nanjing", width = 1.58f, length = 0.056f, height = 1.58f, triangles = 14, textures = 1, pitch = 2.5f,
                materials = new[] { "darkSteel", "nanjingTrainMark" }, ink = "#d82316", inkPixels = 31967, secondInk = "#ffffff", secondInkPixels = 10213 },
        };

        private class Imported
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
            Require(manifest.assets.Length == Count, $"Expected {Count} vehicle models in the manifest, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.id).Distinct().Count() == Count, "The manifest repeats a row id");
            CheckFamilyParameters(manifest.parameters, manifest.assets);

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var imported = new List<Imported>();
            foreach (var expected in ExpectedVehicles)
            {
                var asset = manifest.assets.Single(entry => entry.id == expected.id);
                CheckAssetParameters(asset, expected);
                var entry = ImportAsset(asset, expected, evidence);
                imported.Add(entry);
                summary.Add($"{asset.id}={entry.manifest.triangles}t/{entry.manifest.materials.Length}m/{entry.manifest.textures}x");
            }

            // Unity mints fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene is never byte-identical between two imports. The
            // scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above, so create it only when it is missing and
            // verify its content on every run.
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"VEHICLE_IMPORT_OK {imported.Count} models {string.Join(" ", summary)} " +
                      $"vehicles={RowX(0):F1}..{RowX(VehicleCount - 1):F1} marks={RowX(VehicleCount):F1}..{RowX(Count - 1):F1} " +
                      $"pitch={VehiclePitch:F0}/{MarkPitch:F1} yaw={VehicleYaw:F0} far={CameraFarPlane:F0}");
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
        /// The family parameters the recipe has to keep: ten models at rot 0 with a
        /// stable local origin, the six vehicle rows, the four mark rows with their
        /// canvas sources, the review row geometry and the explicit note that the
        /// renderer's depth prepass is not part of the fixture.
        /// </summary>
        private static void CheckFamilyParameters(Parameters parameters, Asset[] assets)
        {
            Require(parameters != null, "The manifest is missing its family parameters");
            Require(parameters.models == Count, $"Expected {Count} family models, got {parameters.models}");
            Require(parameters.rot == 0, $"Expected rot 0 exports, got {parameters.rot}");
            Require(!string.IsNullOrEmpty(parameters.placement) && parameters.placement.Contains("local origin"),
                "The manifest does not record the stable local origin placement");
            Require(!string.IsNullOrEmpty(parameters.materials) && parameters.materials.Contains("vehicle"),
                "The manifest does not record the deterministic material naming");
            Require(!string.IsNullOrEmpty(parameters.textures) && parameters.textures.Contains("canvas"),
                "The manifest does not describe the mark canvas budget");
            Require(!string.IsNullOrEmpty(parameters.canvasEncode) && parameters.canvasEncode.Contains("serialised"),
                "The manifest does not record the serialised canvas encodes");
            Require(!string.IsNullOrEmpty(parameters.basis) && parameters.basis.Contains("Z-up"),
                "The manifest does not record the export basis");
            Require(!string.IsNullOrEmpty(parameters.depthPrepass) && parameters.depthPrepass.Contains("depth prepass"),
                "The manifest does not record the road kit's renderer-only depth prepass");

            Require(parameters.row != null, "The manifest is missing its review-row parameters");
            Require(Mathf.Abs(parameters.row.vehiclePitchMetres - VehiclePitch) < 0.001f,
                $"Manifest vehicle pitch {parameters.row.vehiclePitchMetres} != {VehiclePitch}");
            Require(Mathf.Abs(parameters.row.markPitchMetres - MarkPitch) < 0.001f,
                $"Manifest mark pitch {parameters.row.markPitchMetres} != {MarkPitch}");
            Require(Mathf.Abs(parameters.row.markGapMetres - MarkGap) < 0.001f,
                $"Manifest mark gap {parameters.row.markGapMetres} != {MarkGap}");
            Require(Mathf.Abs(parameters.row.vehicleYawDegrees - VehicleYaw) < 0.001f,
                $"Manifest vehicle yaw {parameters.row.vehicleYawDegrees} != {VehicleYaw}");
            Require(Mathf.Abs(parameters.row.farPlaneMetres - CameraFarPlane) < 0.001f,
                $"Manifest review far plane {parameters.row.farPlaneMetres} != {CameraFarPlane}");
            Require(parameters.row.order != null && parameters.row.order.SequenceEqual(ExpectedVehicles.Select(entry => entry.id)),
                "The manifest review-row order does not match the ten rows");

            Require(parameters.vehicles != null && parameters.vehicles.Length == VehicleCount,
                $"Expected {VehicleCount} vehicle parameter rows, got {parameters.vehicles?.Length ?? 0}");
            Require(parameters.marks != null && parameters.marks.Length == Count - VehicleCount,
                $"Expected {Count - VehicleCount} mark parameter rows, got {parameters.marks?.Length ?? 0}");
            foreach (var expected in ExpectedVehicles)
            {
                if (expected.kind == "vehicle")
                {
                    var row = parameters.vehicles.Single(entry => entry.paletteId == expected.id);
                    Require(row.variant == expected.variant, $"{expected.id}: family variant {row.variant} != {expected.variant}");
                    Require(row.triangles == expected.triangles, $"{expected.id}: family triangles {row.triangles} != {expected.triangles}");
                    Require(Mathf.Abs(row.lengthMetres - expected.length) < 0.001f,
                        $"{expected.id}: family length {row.lengthMetres} != {expected.length}");
                    Require(row.materials != null && row.materials.SequenceEqual(expected.materials),
                        $"{expected.id}: family material set drifted");
                }
                else
                {
                    var row = parameters.marks.Single(entry => entry.paletteId == expected.id);
                    Require(row.city == expected.city, $"{expected.id}: family city {row.city} != {expected.city}");
                    Require(row.material == expected.materials.Single(name => name != "darkSteel"),
                        $"{expected.id}: family mark material {row.material}");
                    var asset = assets.Single(entry => entry.id == expected.id);
                    Require(asset.mark != null && asset.mark.canvas != null && asset.mark.canvas.Length == 2,
                        $"{expected.id}: the manifest is missing the mark canvas record");
                    Require(row.canvasWidth == asset.mark.canvas[0] && row.canvasHeight == asset.mark.canvas[1],
                        $"{expected.id}: family canvas {row.canvasWidth}x{row.canvasHeight} != asset {asset.mark.canvas[0]}x{asset.mark.canvas[1]}");
                    Require(row.atlasSlot == asset.mark.atlasSlot, $"{expected.id}: family atlas slot {row.atlasSlot}");
                    Require(row.inkCounts != null && row.inkCounts.Any(ink => ink.color == expected.ink),
                        $"{expected.id}: family ink histogram is missing {expected.ink}");
                }
            }
        }

        /// <summary>
        /// One row's identity, extents and canonical parameters. The extents are the
        /// source-space size the exporter asserted on the built geometry.
        /// </summary>
        private static void CheckAssetParameters(Asset asset, Expected expected)
        {
            string label = $"{expected.id}: ";
            Require(asset.id == expected.id, $"{label}manifest id {asset.id} != {expected.id}");
            Require(asset.rowId == expected.id, $"{label}row id {asset.rowId}");
            Require(asset.catalogue == false, $"{label}review fixtures are not catalogue rows");
            Require(asset.family == "vehicle", $"{label}family {asset.family}");
            Require(asset.kind == expected.kind, $"{label}kind {asset.kind} != {expected.kind}");
            Require(asset.variant == expected.variant, $"{label}variant {asset.variant} != {expected.variant}");
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.file, $"{label}file {asset.file}");
            Require(asset.units == "metres", $"{label}units {asset.units}");
            Require(asset.facade == "local +y (front face)", $"{label}facade {asset.facade}");
            Require(!string.IsNullOrEmpty(asset.source) && asset.source.Contains("game/src/render"),
                $"{label}manifest source is missing");
            Require(!string.IsNullOrEmpty(asset.provenance) && asset.provenance.Contains("Repository"),
                $"{label}provenance is missing");
            Require(!string.IsNullOrEmpty(asset.licenseRecord) && asset.licenseRecord.Contains("Repository-authored"),
                $"{label}license record is missing");
            Require(asset.validation != null && asset.validation.errors == 0 && asset.validation.warnings == 0,
                $"{label}GLB validation was not clean");
            Require(asset.placementOffset != null && asset.placementOffset.Length == 3, $"{label}missing placement offset");
            Near(new Vector3(asset.placementOffset[0], asset.placementOffset[1], asset.placementOffset[2]),
                Vector3.zero, $"{label}placement offset");
            Near(new Vector3(asset.size[0], asset.size[1], asset.size[2]),
                new Vector3(expected.width, expected.length, expected.height), $"{label}manifest size");
            Require(asset.meshes > 0 && asset.triangles == expected.triangles,
                $"{label}expected {expected.triangles} triangles, got {asset.triangles}");
            Require(asset.textures == expected.textures, $"{label}expected {expected.textures} textures, got {asset.textures}");
            Require(Mathf.Abs(asset.rowPitchMetres - expected.pitch) < 0.001f, $"{label}row pitch {asset.rowPitchMetres}");
            Require(asset.materials.SequenceEqual(expected.materials),
                $"{label}manifest materials {string.Join(",", asset.materials)}");
            Require(asset.alphaMaterials != null && asset.alphaMaterials.Length > 0, $"{label}no alpha material recorded");
            Require(asset.parameters != null, $"{label}missing parameters");

            if (expected.kind == "vehicle")
            {
                Require(asset.hasMark == false, $"{label}a road vehicle carries no mark canvas");
                Require(asset.mark == null || string.IsNullOrEmpty(asset.mark.city),
                    $"{label}a road vehicle carries no mark canvas record");
                // Every road-kit colour bin is the same authored translucent surface.
                Require(asset.alphaMaterials.Length == asset.materials.Length,
                    $"{label}only {asset.alphaMaterials.Length}/{asset.materials.Length} road surfaces are translucent");
                Require(asset.parameters.detail == "high", $"{label}detail {asset.parameters.detail}");
                Require(asset.parameters.facing != null && asset.parameters.facing.Contains("local +y"),
                    $"{label}travel direction is not local +y");
                Require(Mathf.Abs(asset.parameters.opacity - 0.7f) < 0.0001f, $"{label}opacity {asset.parameters.opacity}");
                Require(asset.parameters.depthWrite == false, $"{label}depthWrite changed");
                Require(asset.parameters.colourBins == expected.materials.Length,
                    $"{label}colour bins {asset.parameters.colourBins} != {expected.materials.Length}");
                Require(Mathf.Abs(asset.parameters.lengthMetres - expected.length) < 0.001f,
                    $"{label}parameter length {asset.parameters.lengthMetres}");
                Require(!string.IsNullOrEmpty(asset.parameters.materialSettings) &&
                        asset.parameters.materialSettings.Contains("depth prepass"),
                    $"{label}the renderer-only depth prepass is not recorded");
            }
            else
            {
                Require(asset.hasMark, $"{label}the mark fixture is not flagged as a canvas asset");
                Require(asset.mark != null, $"{label}the mark canvas record is missing");
                Require(asset.mark.city == expected.city, $"{label}mark city {asset.mark.city}");
                Require(asset.mark.material == expected.materials.Single(name => name != "darkSteel"),
                    $"{label}mark material {asset.mark.material}");
                Require(asset.mark.canvas != null && asset.mark.canvas.Length == 2, $"{label}mark canvas size is missing");
                Require(asset.mark.opaquePixels > 0, $"{label}the mark canvas is empty");
                var inks = new[] { expected.ink, expected.secondInk }.Where(ink => !string.IsNullOrEmpty(ink)).ToArray();
                foreach (var ink in inks)
                {
                    int expectedPixels = ink == expected.secondInk ? expected.secondInkPixels : expected.inkPixels;
                    var record = asset.mark.colours?.SingleOrDefault(entry => entry.color == ink);
                    Require(record != null && record.pixels == expectedPixels,
                        $"{label}canvas ink {ink} has {record?.pixels ?? 0} pixels, expected {expectedPixels}");
                }
                Require(asset.parameters.city == expected.city, $"{label}parameter city {asset.parameters.city}");
                Require(!string.IsNullOrEmpty(asset.parameters.canvasSource) && asset.parameters.canvasSource.Contains("game/src/render"),
                    $"{label}the mark canvas source is not recorded");
                Require(!string.IsNullOrEmpty(asset.parameters.canvasPixels) &&
                        asset.parameters.canvasPixels == $"{asset.mark.canvas[0]} x {asset.mark.canvas[1]}",
                    $"{label}canvas pixel size {asset.parameters.canvasPixels}");
                Require(asset.parameters.atlasSlot == asset.mark.atlasSlot, $"{label}atlas slot drifted");
                Require(Mathf.Abs(asset.parameters.plateWidthMetres - asset.mark.widthMetres) < 0.001f &&
                        asset.parameters.plateWidthMetres >= 1f && asset.parameters.plateWidthMetres <= 2f,
                    $"{label}mark plate width {asset.parameters.plateWidthMetres} is outside cab-panel scale");
                Require(asset.parameters.inkCounts != null && asset.parameters.inkCounts.Any(ink => ink.color == expected.ink),
                    $"{label}parameters are missing the ink histogram");
                if (expected.city == "chongqing")
                {
                    Require(asset.parameters.line == "4" && asset.parameters.lineColour == "#dc8633",
                        $"{label}Chongqing badge line {asset.parameters.line}/{asset.parameters.lineColour}");
                    Require(asset.mark.line == "4" && asset.mark.colour == "#dc8633",
                        $"{label}Chongqing mark line record drifted");
                }
                else
                {
                    Require(string.IsNullOrEmpty(asset.parameters.line), $"{label}unexpected line binding");
                }
            }
        }

        private static Imported ImportAsset(Asset asset, Expected expected, string evidence)
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
            Require(filters.Length == asset.meshes, $"{label}: expected {asset.meshes} mesh nodes, got {filters.Length}");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
            Near(bounds.min, Basis(asset.min), $"{label} minimum bounds");
            Near(bounds.max, Basis(asset.max), $"{label} maximum bounds");

            int triangles = filters.Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == asset.triangles, $"{label}: expected {asset.triangles} triangles, got {triangles}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(asset.materials),
                $"{label}: unexpected materials {string.Join(", ", materials)}");

            // Alpha queues: the road kit's colour bins are all translucent; the
            // mark decal is translucent over an opaque steel backing plate.
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
            if (expected.kind == "vehicle")
            {
                Require(importedMaterials.All(material => material.renderQueue >= (int)RenderQueue.Transparent),
                    $"{label}: a road surface is not on the transparent queue");
            }
            else
            {
                var mark = importedMaterials.Single(material => material.name == asset.mark.material);
                Require(mark.GetTexturePropertyNames().Any(property => mark.GetTexture(property) != null),
                    $"{label}: the mark material lost its canvas texture");
                var backing = importedMaterials.Single(material => material.name == "darkSteel");
                Require(backing.renderQueue < (int)RenderQueue.Transparent, $"{label}: the plate backing is transparent");

                // Decode the canvas PNG out of the GLB itself and reproduce the
                // exporter's opaque-pixel histogram. This proves the imported
                // texture is the city's canvas (size, dominant ink and ink counts),
                // not a placeholder and not a different city's slot. Ink counts
                // allow a two-level decode difference; the alpha channel is exact.
                var canvas = DecodeEmbeddedPng(glbPath);
                Require(canvas.width == asset.mark.canvas[0] && canvas.height == asset.mark.canvas[1],
                    $"{label}: embedded canvas is {canvas.width}x{canvas.height}, expected {asset.mark.canvas[0]}x{asset.mark.canvas[1]}");
                var canvasColours = Histogram(canvas.pixels);
                Require(canvasColours.Values.Sum() == asset.mark.opaquePixels,
                    $"{label}: embedded canvas has {canvasColours.Values.Sum()} opaque pixels, expected {asset.mark.opaquePixels}");
                var dominant = canvasColours.OrderByDescending(entry => entry.Value).First().Key;
                Require(dominant == expected.ink,
                    $"{label}: the canvas's dominant ink is {dominant}, expected {expected.ink}");
                foreach (var ink in new[] { expected.ink, expected.secondInk }.Where(value => !string.IsNullOrEmpty(value)))
                {
                    int expectedPixels = ink == expected.secondInk ? expected.secondInkPixels : expected.inkPixels;
                    canvasColours.TryGetValue(ink, out int actualPixels);
                    Require(actualPixels == expectedPixels,
                        $"{label}: embedded canvas ink {ink} has {actualPixels} pixels, expected {expectedPixels}");
                }

                var texture = importedMaterials
                    .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                    .FirstOrDefault(value => value != null);
                Require(texture != null, $"{label}: no imported texture");
                Require(texture.width == asset.mark.canvas[0] && texture.height == asset.mark.canvas[1],
                    $"{label}: imported texture is {texture.width}x{texture.height}");
            }

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

            return new Imported { expected = expected, manifest = asset, prefabPath = prefabPath };
        }

        /// <summary>
        /// One review scene: six vehicles on 13 m centres in a 3/4 pose and the four
        /// cab marks on 2.5 m centres at the end of the row, under a slate 3/4 camera
        /// with a 250 m far plane and the key/fill light the Web check depends on.
        /// </summary>
        private static void BuildReviewScene(List<Imported> vehicles)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < vehicles.Count; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(vehicles[i].prefabPath);
                Require(prefab != null, $"Missing prefab for {vehicles[i].manifest.id}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(RowX(i), 0f, 0f);
                instance.transform.rotation = i < VehicleCount ? Quaternion.Euler(0, VehicleYaw, 0) : Quaternion.identity;
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
                "Could not save the vehicle review scene");
        }

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: ten prefab
        /// instances linked to the wrapper prefabs at their row positions (vehicles
        /// in the 3/4 pose, marks upright), the slate camera with the 250 m far plane
        /// and the key light the Web check depends on.
        /// </summary>
        private static void VerifyReviewScene(List<Imported> vehicles)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            for (int i = 0; i < vehicles.Count; i++)
            {
                var model = vehicles[i];
                var instance = roots.SingleOrDefault(root => root.name == model.expected.prefab);
                Require(instance != null, $"Review scene is missing the {model.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == model.prefabPath,
                    $"{model.expected.prefab} is not an instance of {model.prefabPath}");
                Near(instance.transform.position, new Vector3(RowX(i), 0f, 0f), $"{model.expected.prefab} row placement");
                bool turned = Mathf.Abs(Quaternion.Angle(instance.transform.rotation, Quaternion.Euler(0, VehicleYaw, 0))) < 0.01f;
                Require(turned == (i < VehicleCount), $"{model.expected.prefab} row rotation is {(turned ? "turned" : "upright")}");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{model.expected.prefab} instance has no renderers");
            }

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

        private static float RowX(int index) => index < VehicleCount
            ? (index - (VehicleCount - 1) / 2f) * VehiclePitch
            : (VehicleCount / 2f - 0.5f) * VehiclePitch + MarkGap + (index - VehicleCount) * MarkPitch;

        /// <summary>
        /// The single embedded canvas PNG of a mark GLB: parse the GLB container,
        /// read the JSON chunk's images/bufferViews, and slice the PNG out of the BIN
        /// chunk. The GLB is the file Unity actually imported, so this checks the
        /// delivered artwork rather than the exporter's intermediate state.
        /// </summary>
        private static CanvasImage DecodeEmbeddedPng(string glbPath)
        {
            byte[] bytes = File.ReadAllBytes(glbPath);
            Require(BitConverter.ToUInt32(bytes, 0) == 0x46546C67, $"{glbPath}: not a GLB");
            int jsonLength = (int)BitConverter.ToUInt32(bytes, 12);
            Require(BitConverter.ToUInt32(bytes, 16) == 0x4E4F534A, $"{glbPath}: missing JSON chunk");
            string json = Encoding.UTF8.GetString(bytes, 20, jsonLength).TrimEnd('\0', ' ');
            int binHeader = 20 + jsonLength;
            int binLength = (int)BitConverter.ToUInt32(bytes, binHeader);
            Require(BitConverter.ToUInt32(bytes, binHeader + 4) == 0x004E4942, $"{glbPath}: missing BIN chunk");
            int binStart = binHeader + 8;
            var glb = JsonUtility.FromJson<GlbJson>(json);
            Require(glb?.images != null && glb.images.Length == 1, $"{glbPath}: expected exactly one embedded image");
            Require(glb.images[0].mimeType == "image/png", $"{glbPath}: the mark image is not a PNG");
            var view = glb.bufferViews[glb.images[0].bufferView];
            Require(view.byteOffset + view.byteLength <= binLength, $"{glbPath}: image bufferView is outside the BIN chunk");
            var png = new byte[view.byteLength];
            System.Array.Copy(bytes, binStart + view.byteOffset, png, 0, view.byteLength);
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            Require(texture.LoadImage(png, false), $"{glbPath}: the embedded PNG did not decode");
            return new CanvasImage { width = texture.width, height = texture.height, pixels = texture.GetPixels32() };
        }

        private class CanvasImage
        {
            public int width, height;
            public Color32[] pixels;
        }

        private static Dictionary<string, int> Histogram(Color32[] pixels)
        {
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var pixel in pixels)
            {
                if (pixel.a < 128) continue;
                string hex = $"#{pixel.r:x2}{pixel.g:x2}{pixel.b:x2}";
                counts.TryGetValue(hex, out int count);
                counts[hex] = count + 1;
            }
            return counts;
        }

        [Serializable]
        private class GlbJson
        {
            public GlbImage[] images;
            public GlbBufferView[] bufferViews;
        }

        [Serializable]
        private class GlbImage
        {
            public int bufferView;
            public string mimeType, name;
        }

        [Serializable]
        private class GlbBufferView
        {
            public int buffer, byteOffset, byteLength;
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
