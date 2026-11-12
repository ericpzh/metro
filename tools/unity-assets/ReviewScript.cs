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
    /// Import the twelve 站名 (station-name calligraphy) GLBs exported by
    /// export-script.mjs: the six hands — 黑体 / 楷书 / 隶书 / 宋体 / 魏碑 / 行书 —
    /// on both ways an inscription runs (横排 and 竖排). Each is wrapped in a prefab
    /// under the Unity gameplay basis, and the family parameters, the sample
    /// inscription, the ink material names, the bounds, the two-triangle mesh, the
    /// one transparent ink texture and the twelve distinct ink digests are checked.
    ///
    /// The piece is one transparent plate of brush strokes with no board or frame,
    /// so the review scene sets the row on a pale wall: the wall is the paper the
    /// inscription is painted on, and the 0.46 m stand-off is what keeps the ink
    /// clear of it. The scene holds all twelve prefabs in one row on 5.6 m centres
    /// (the horizontal panels are 5 m wide) under a slate-clearing camera.
    /// </summary>
    public static class ReviewScript
    {
        private const string Folder = "Assets/ScriptProof";
        private const string Scene = Folder + "/Script.unity";
        private const int Count = 12;

        /// <summary>The one fixed sample inscription the export writes into every panel.</summary>
        private const string SampleStationName = "人民广场";

        /// <summary>Row pitch: the 横排 panels are 5 m wide, so 5.6 m keeps a 0.6 m gap.</summary>
        private const float RowPitchMetres = 5.6f;

        /// <summary>
        /// A straight-on view of the 61.6 m row: the camera sits back far enough for
        /// the whole run plus the palette wall behind it, and its far plane covers
        /// the family's largest piece.
        /// </summary>
        private static readonly Vector3 CameraPosition = new Vector3(0f, 2.1f, 43.5f);
        private static readonly Vector3 CameraTarget = new Vector3(0f, 1.6f, -0.5f);
        private const float CameraFieldOfView = 55f;
        private const float CameraNearPlane = 0.05f;
        private const float CameraFarPlane = 150f;
        private static readonly Color Slate = new Color(0.22f, 0.30f, 0.38f);

        /// <summary>
        /// The wall the pieces hang on, as a review prop. The ink is transparent on
        /// purpose — an inscription is strokes *on* a wall — so without a wall behind
        /// the row the plates would have nothing to read against. Pale 搪瓷板, 74 m
        /// wide and 3.6 m tall, with its front face on z = −0.5: the ink planes hang
        /// 0.46 m off the row's origin, so they stand 0.04 m proud of it, exactly as
        /// the piece's own offset says.
        /// </summary>
        private static readonly Color WallColour = new Color(0.910f, 0.902f, 0.878f);
        private const float WallWidthMetres = 74f;
        private const float WallHeightMetres = 3.6f;
        private const float WallThicknessMetres = 0.2f;
        private const float WallZ = -0.5f;

        /// <summary>The row is built on world z = 0 and centred on x = 0.</summary>
        private const float RowCentre = (Count - 1) * RowPitchMetres / 2f;

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
            public float inkOffsetMetres;
            public string sampleStationName, sampleNameSource, dynamicReprint, stationData, placement, mesh, textureNote, canvasEncode, basis, row;
            public Panel[] panels;
        }

        [Serializable]
        private class Panel
        {
            public string paletteId, style, axis, textureSha256, inkMaterial;
            public float widthMetres, heightMetres, bottomMetres, rowPitchMetres;
            public int textureWidth, textureHeight;
        }

        [Serializable]
        private class Asset
        {
            public string id, catalogueId, paletteId, family, kind, style, axis, prefab, file, sha256, textureSha256;
            public string source, provenance, licenseRecord, units, facade, inkMaterial;
            public float[] min, max, size, placementOffset;
            public Anchors anchors;
            public int triangles, meshes, textures, textureWidth, textureHeight;
            public float rowPitchMetres;
            public string[] materials, alphaMaterials;
            public AssetParameters parameters;
            public Validation validation;
        }

        [Serializable]
        private class AssetParameters
        {
            public string style, axis, sampleStationName, wall, texture, inscription, dynamicReprint, artwork;
            public float panelWidthMetres, panelHeightMetres, panelBottomMetres, panelCentreMetres, inkOffsetMetres;
            public int panelCells, textureWidth, textureHeight;
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
            public string paletteId, prefab, id, style, axis;
            /// <summary>The panel the piece was cut for: 5 × 1 m 横排, 0.98 × 2.6 m 竖排.</summary>
            public float width, height, bottom;
            /// <summary>The ink plate's pixels: 512 px/m, never below 64.</summary>
            public int textureWidth, textureHeight;
            public int cells;
        }

        /// <summary>
        /// The twelve family models in review-row order, with the panel each builder
        /// output must keep. The dimensions are the source-space extents the exporter
        /// asserted and the catalogue row records, repeated here so a builder drift
        /// cannot pass review.
        /// </summary>
        private static readonly Expected[] ExpectedScript =
        {
            new Expected { paletteId = "calligraphy-hei-h", prefab = "CalligraphyHeiH", id = "station.calligraphy.hei-h", style = "hei", axis = "h", width = 5f, height = 1f, bottom = 1.2f, textureWidth = 2560, textureHeight = 512, cells = 5 },
            new Expected { paletteId = "calligraphy-hei-v", prefab = "CalligraphyHeiV", id = "station.calligraphy.hei-v", style = "hei", axis = "v", width = 0.98f, height = 2.6f, bottom = 0.4f, textureWidth = 502, textureHeight = 1331, cells = 1 },
            new Expected { paletteId = "calligraphy-kai-h", prefab = "CalligraphyKaiH", id = "station.calligraphy.kai-h", style = "kai", axis = "h", width = 5f, height = 1f, bottom = 1.2f, textureWidth = 2560, textureHeight = 512, cells = 5 },
            new Expected { paletteId = "calligraphy-kai-v", prefab = "CalligraphyKaiV", id = "station.calligraphy.kai-v", style = "kai", axis = "v", width = 0.98f, height = 2.6f, bottom = 0.4f, textureWidth = 502, textureHeight = 1331, cells = 1 },
            new Expected { paletteId = "calligraphy-li-h", prefab = "CalligraphyLiH", id = "station.calligraphy.li-h", style = "li", axis = "h", width = 5f, height = 1f, bottom = 1.2f, textureWidth = 2560, textureHeight = 512, cells = 5 },
            new Expected { paletteId = "calligraphy-li-v", prefab = "CalligraphyLiV", id = "station.calligraphy.li-v", style = "li", axis = "v", width = 0.98f, height = 2.6f, bottom = 0.4f, textureWidth = 502, textureHeight = 1331, cells = 1 },
            new Expected { paletteId = "calligraphy-song-h", prefab = "CalligraphySongH", id = "station.calligraphy.song-h", style = "song", axis = "h", width = 5f, height = 1f, bottom = 1.2f, textureWidth = 2560, textureHeight = 512, cells = 5 },
            new Expected { paletteId = "calligraphy-song-v", prefab = "CalligraphySongV", id = "station.calligraphy.song-v", style = "song", axis = "v", width = 0.98f, height = 2.6f, bottom = 0.4f, textureWidth = 502, textureHeight = 1331, cells = 1 },
            new Expected { paletteId = "calligraphy-wei-h", prefab = "CalligraphyWeiH", id = "station.calligraphy.wei-h", style = "wei", axis = "h", width = 5f, height = 1f, bottom = 1.2f, textureWidth = 2560, textureHeight = 512, cells = 5 },
            new Expected { paletteId = "calligraphy-wei-v", prefab = "CalligraphyWeiV", id = "station.calligraphy.wei-v", style = "wei", axis = "v", width = 0.98f, height = 2.6f, bottom = 0.4f, textureWidth = 502, textureHeight = 1331, cells = 1 },
            new Expected { paletteId = "calligraphy-xing-h", prefab = "CalligraphyXingH", id = "station.calligraphy.xing-h", style = "xing", axis = "h", width = 5f, height = 1f, bottom = 1.2f, textureWidth = 2560, textureHeight = 512, cells = 5 },
            new Expected { paletteId = "calligraphy-xing-v", prefab = "CalligraphyXingV", id = "station.calligraphy.xing-v", style = "xing", axis = "v", width = 0.98f, height = 2.6f, bottom = 0.4f, textureWidth = 502, textureHeight = 1331, cells = 1 },
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
            Require(manifest.assets.Length == Count, $"Expected {Count} calligraphy models in the manifest, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.paletteId).Distinct().Count() == Count, "The manifest repeats a palette id");
            CheckFamilyParameters(manifest.parameters, manifest.assets);

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var imported = new List<Imported>();
            foreach (var expected in ExpectedScript)
            {
                var asset = manifest.assets.Single(entry => entry.paletteId == expected.paletteId);
                CheckAssetParameters(asset, expected, manifest.parameters);
                var entry = ImportAsset(asset, expected, evidence);
                imported.Add(entry);
                summary.Add($"{asset.id}={entry.manifest.triangles}t/{entry.manifest.materials[0]}/" +
                            $"{entry.manifest.textures}x/{entry.manifest.textureWidth}x{entry.manifest.textureHeight}");
            }

            // The twelve inks are the family. Their digests are the exported plates'
            // own bytes, so equal digests mean two hands or two axes printed the same
            // pixels — a silent duplicate, which is exactly what this family is here
            // to rule out.
            var digests = imported.Select(entry => entry.manifest.textureSha256).ToArray();
            Require(digests.All(digest => !string.IsNullOrEmpty(digest) && digest.Length == 64),
                "A calligraphy model is missing its ink texture digest");
            Require(digests.Distinct().Count() == Count,
                $"The twelve ink plates are not distinct: {string.Join(", ", digests.Select(digest => digest.Substring(0, 8)))}");
            var inks = imported.Select(entry => entry.manifest.inkMaterial).ToArray();
            Require(inks.Distinct().Count() == Count, $"The twelve ink materials are not distinct: {string.Join(", ", inks)}");

            // Unity mints fresh scene fileIDs on every SaveScene call, so a regenerated
            // scene is never byte-identical between two imports. The scene is a pure
            // view over the wrapper prefabs, which are rebuilt deterministically above,
            // so create it only when it is missing and verify its content on every run.
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"SCRIPT_IMPORT_OK {imported.Count} models sample={SampleStationName} " +
                      $"{string.Join(" ", summary)} row={RowX(0):F2}..{RowX(Count - 1):F2} " +
                      $"camera=({CameraPosition.x:F1},{CameraPosition.y:F1},{CameraPosition.z:F1}) far={CameraFarPlane:F0}");
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
        /// The family parameters the recipe has to keep: twelve modules built at rot 0
        /// in an empty station document, the one sample inscription, the 0.46 m ink
        /// stand-off, the panel table, and the explicit note that the live station name
        /// is a runtime binding rather than something a prefab can carry.
        /// </summary>
        private static void CheckFamilyParameters(Parameters parameters, Asset[] assets)
        {
            Require(parameters != null, "The manifest is missing its family parameters");
            Require(parameters.models == Count, $"Expected {Count} family models, got {parameters.models}");
            Require(parameters.rot == 0, $"Expected rot 0 exports, got {parameters.rot}");
            Require(parameters.sampleStationName == SampleStationName,
                $"Expected the sample inscription {SampleStationName}, got {parameters.sampleStationName}");
            Require(!string.IsNullOrEmpty(parameters.sampleNameSource) && parameters.sampleNameSource.Contains("sample"),
                "The manifest does not record that the inscription is a sample");
            Require(!string.IsNullOrEmpty(parameters.dynamicReprint) && parameters.dynamicReprint.Contains("runtime binding"),
                "The manifest does not record the runtime reprint binding");
            Require(!string.IsNullOrEmpty(parameters.stationData) && parameters.stationData.Contains("empty"),
                "Expected the exports to stand in an empty station document");
            Require(!string.IsNullOrEmpty(parameters.placement) && parameters.placement.Contains("buildModule"),
                "The manifest does not record the builder placement");
            Require(Mathf.Abs(parameters.inkOffsetMetres - 0.46f) < 0.0001f,
                $"Expected the ink to stand 0.46 m off the wall, got {parameters.inkOffsetMetres}");
            Require(!string.IsNullOrEmpty(parameters.textureNote) && parameters.textureNote.Contains("ink"),
                "The manifest does not describe the family's texture budget");
            Require(!string.IsNullOrEmpty(parameters.canvasEncode) && parameters.canvasEncode.Contains("serialised"),
                "The manifest does not record the serialised canvas encodes");
            Require(!string.IsNullOrEmpty(parameters.basis) && parameters.basis.Contains("Z-up"),
                "The manifest does not record the export basis");
            Require(!string.IsNullOrEmpty(parameters.row) && parameters.row.Contains("5.6"),
                "The manifest does not record the review row pitch");

            Require(parameters.panels != null && parameters.panels.Length == Count,
                $"Expected {Count} panel parameter entries, got {parameters.panels?.Length ?? 0}");
            foreach (var expected in ExpectedScript)
            {
                var panel = parameters.panels.Single(entry => entry.paletteId == expected.paletteId);
                Require(panel.style == expected.style && panel.axis == expected.axis,
                    $"{expected.paletteId}: family panel {panel.style}/{panel.axis} != {expected.style}/{expected.axis}");
                Require(Mathf.Abs(panel.widthMetres - expected.width) < 0.001f &&
                        Mathf.Abs(panel.heightMetres - expected.height) < 0.001f &&
                        Mathf.Abs(panel.bottomMetres - expected.bottom) < 0.001f,
                    $"{expected.paletteId}: family panel size drifted");
                Require(panel.textureWidth == expected.textureWidth && panel.textureHeight == expected.textureHeight,
                    $"{expected.paletteId}: family ink plate {panel.textureWidth}x{panel.textureHeight}");
                Require(panel.rowPitchMetres == RowPitchMetres, $"{expected.paletteId}: family row pitch {panel.rowPitchMetres}");
                Require(panel.inkMaterial == $"calligraphyInk_{expected.style}_{expected.axis}",
                    $"{expected.paletteId}: family ink material {panel.inkMaterial}");
            }
            var styles = assets.Select(asset => asset.style).Distinct().OrderBy(style => style).ToArray();
            Require(styles.SequenceEqual(new[] { "hei", "kai", "li", "song", "wei", "xing" }),
                $"Unexpected hand set: {string.Join(", ", styles)}");
            var axes = assets.Select(asset => asset.axis).Distinct().OrderBy(axis => axis).ToArray();
            Require(axes.SequenceEqual(new[] { "h", "v" }), $"Unexpected axis set: {string.Join(", ", axes)}");
        }

        /// <summary>
        /// One model's identity, panel, ink and canonical parameters. The dimensions
        /// are the same source-space extents the exporter asserted on the built plate.
        /// </summary>
        private static void CheckAssetParameters(Asset asset, Expected expected, Parameters family)
        {
            string label = $"{expected.paletteId}: ";
            Require(asset.id == expected.id, $"{label}manifest id {asset.id} != {expected.id}");
            Require(asset.catalogueId == expected.paletteId, $"{label}catalogue id {asset.catalogueId}");
            Require(asset.family == "script", $"{label}family {asset.family}");
            Require(asset.kind == "calligraphy", $"{label}kind {asset.kind}");
            Require(asset.style == expected.style, $"{label}style {asset.style} != {expected.style}");
            Require(asset.axis == expected.axis, $"{label}axis {asset.axis} != {expected.axis}");
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.paletteId + ".glb", $"{label}file {asset.file}");
            Require(asset.units == "metres", $"{label}units {asset.units}");
            Require(!string.IsNullOrEmpty(asset.source) && asset.source.Contains("CalligraphyModel.ts"),
                $"{label}manifest source is missing");
            Require(!string.IsNullOrEmpty(asset.provenance) && asset.provenance.Contains("Repository"),
                $"{label}provenance is missing");
            Require(!string.IsNullOrEmpty(asset.licenseRecord) && asset.licenseRecord.Contains("Repository-authored"),
                $"{label}license record is missing");
            Require(asset.validation != null && asset.validation.errors == 0 && asset.validation.warnings == 0,
                $"{label}GLB validation was not clean");
            Require(!string.IsNullOrEmpty(asset.facade) && asset.facade.Contains("local -y"),
                $"{label}the piece is not recorded as wall-mounted");

            // Where the builder puts the piece: the module's own cell centre.
            Require(asset.placementOffset != null && asset.placementOffset.Length == 3, $"{label}missing placement offset");
            Near(new Vector3(asset.placementOffset[0], asset.placementOffset[1], asset.placementOffset[2]),
                new Vector3(0.5f, 0.5f, 1f), $"{label}placement offset");

            // The ink plate: one plane at the panel's size, 0.46 m off the wall.
            Require(asset.size != null && asset.size.Length == 3, $"{label}missing size");
            Require(Mathf.Abs(asset.size[0] - expected.width) < 0.001f &&
                    Mathf.Abs(asset.size[2] - expected.height) < 0.001f,
                $"{label}panel size {asset.size[0]:F3} x {asset.size[2]:F3} != {expected.width} x {expected.height}");
            Require(Mathf.Abs(asset.size[1]) < 0.001f, $"{label}the ink plate has thickness {asset.size[1]:F4}");
            Near(new Vector3(asset.min[0], asset.min[1], asset.min[2]),
                new Vector3(-expected.width / 2f, -0.46f, expected.bottom), $"{label}minimum bounds");
            Near(new Vector3(asset.max[0], asset.max[1], asset.max[2]),
                new Vector3(expected.width / 2f, -0.46f, expected.bottom + expected.height), $"{label}maximum bounds");

            // One mesh, two triangles, one transparent texture, one material named for
            // the hand and axis: the piece has no board and no frame.
            Require(asset.meshes == 1, $"{label}expected one mesh, got {asset.meshes}");
            Require(asset.triangles == 2, $"{label}expected two triangles, got {asset.triangles}");
            Require(asset.textures == 1, $"{label}expected one texture, got {asset.textures}");
            Require(asset.textureWidth == expected.textureWidth && asset.textureHeight == expected.textureHeight,
                $"{label}ink plate {asset.textureWidth}x{asset.textureHeight} != {expected.textureWidth}x{expected.textureHeight}");
            string ink = $"calligraphyInk_{expected.style}_{expected.axis}";
            Require(asset.inkMaterial == ink, $"{label}ink material {asset.inkMaterial} != {ink}");
            Require(asset.materials != null && asset.materials.Length == 1 && asset.materials[0] == ink,
                $"{label}unexpected material set {string.Join(", ", asset.materials ?? Array.Empty<string>())}");
            Require(asset.alphaMaterials != null && asset.alphaMaterials.Length == 1 && asset.alphaMaterials[0] == ink,
                $"{label}the ink is not the one transparent material");
            Require(asset.rowPitchMetres == RowPitchMetres, $"{label}row pitch {asset.rowPitchMetres}");

            Require(asset.parameters != null, $"{label}missing parameters");
            var parameters = asset.parameters;
            Require(parameters.style == expected.style && parameters.axis == expected.axis,
                $"{label}parameter style/axis {parameters.style}/{parameters.axis}");
            Require(parameters.sampleStationName == SampleStationName,
                $"{label}parameter sample name {parameters.sampleStationName} != {SampleStationName}");
            Require(Mathf.Abs(parameters.panelWidthMetres - expected.width) < 0.001f &&
                    Mathf.Abs(parameters.panelHeightMetres - expected.height) < 0.001f &&
                    Mathf.Abs(parameters.panelBottomMetres - expected.bottom) < 0.001f &&
                    Mathf.Abs(parameters.panelCentreMetres - (expected.bottom + expected.height / 2f)) < 0.001f,
                $"{label}panel parameters drifted");
            Require(parameters.panelCells == expected.cells, $"{label}panel cells {parameters.panelCells} != {expected.cells}");
            Require(Mathf.Abs(parameters.inkOffsetMetres - 0.46f) < 0.0001f,
                $"{label}ink offset {parameters.inkOffsetMetres}");
            Require(parameters.textureWidth == expected.textureWidth && parameters.textureHeight == expected.textureHeight,
                $"{label}parameter ink plate {parameters.textureWidth}x{parameters.textureHeight}");
            Require(!string.IsNullOrEmpty(parameters.inscription) && parameters.inscription.Contains(SampleStationName),
                $"{label}the sample inscription is not recorded");
            Require(!string.IsNullOrEmpty(parameters.dynamicReprint) && parameters.dynamicReprint.Contains("runtime binding"),
                $"{label}the live-name reprint is not a runtime binding");
            Require(!string.IsNullOrEmpty(parameters.artwork) && parameters.artwork.Contains("no board"),
                $"{label}the piece does not record that it is ink alone");
            Require(!string.IsNullOrEmpty(asset.textureSha256) && asset.textureSha256.Length == 64,
                $"{label}missing the ink texture digest");

            var panel = family.panels.Single(entry => entry.paletteId == expected.paletteId);
            Require(panel.textureSha256 == asset.textureSha256, $"{label}family panel digest differs from the asset's");
        }

        private static Imported ImportAsset(Asset asset, Expected expected, string evidence)
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
            // degrees about Y, as in ReviewBin/ReviewCctv/ReviewShelf/ReviewPrinted.
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
            Require(renderers.Length == 1, $"{label}: expected one mesh renderer, got {renderers.Length}");
            var filters = root.GetComponentsInChildren<MeshFilter>();
            Require(filters.Length == asset.meshes, $"{label}: expected {asset.meshes} mesh nodes, got {filters.Length}");
            Near(renderers[0].bounds.min, Basis(asset.min), $"{label} minimum bounds");
            Near(renderers[0].bounds.max, Basis(asset.max), $"{label} maximum bounds");

            int triangles = 0;
            foreach (var filter in filters)
            {
                var mesh = filter.sharedMesh;
                Require(mesh != null, $"{label}: a MeshFilter has no mesh");
                Require(mesh.GetTopology(0) == MeshTopology.Triangles, $"{label}: unexpected mesh topology {mesh.GetTopology(0)}");
                triangles += mesh.GetIndices(0).Length / 3;
            }
            Require(triangles == asset.triangles, $"{label}: expected {asset.triangles} triangles, got {triangles}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(asset.materials), $"{label}: unexpected materials {string.Join(", ", materials)}");

            // The ink is the family's one transparent material, and the piece has no
            // opaque geometry at all: a board or a frame would fail here.
            foreach (var material in importedMaterials)
            {
                Require(asset.alphaMaterials.Contains(material.name),
                    $"{label}: {material.name} is not the transparent ink");
                Require(material.renderQueue >= (int)RenderQueue.Transparent,
                    $"{label}: {material.name} lost its transparent queue ({material.renderQueue})");
            }
            var inkMaterial = importedMaterials.Single(material => material.name == asset.inkMaterial);
            Require(inkMaterial.renderQueue >= (int)RenderQueue.Transparent,
                $"{label}: the ink is not on the transparent queue");

            var textures = importedMaterials
                .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length == asset.textures,
                $"{label}: expected {asset.textures} textures, got {textures.Length}");
            Require(textures[0].width == expected.textureWidth && textures[0].height == expected.textureHeight,
                $"{label}: the ink texture is {textures[0].width}x{textures[0].height}, " +
                $"expected {expected.textureWidth}x{expected.textureHeight}");

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

            return new Imported { expected = expected, manifest = asset, prefabPath = prefabPath };
        }

        /// <summary>
        /// One review scene: all twelve wrapper prefabs in a row on z = 0, the pale
        /// wall they hang on, and a straight-on camera that frames the 61.6 m run
        /// against the slate clear colour.
        /// </summary>
        private static void BuildReviewScene(List<Imported> models)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < models.Count; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(models[i].prefabPath);
                Require(prefab != null, $"Missing prefab for {models[i].manifest.paletteId}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(RowX(i), 0f, 0f);
            }

            BuildWall(models);

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = CameraPosition;
            camera.transform.LookAt(CameraTarget);
            camera.fieldOfView = CameraFieldOfView;
            camera.nearClipPlane = CameraNearPlane;
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
                "Could not save the script review scene");
        }

        /// <summary>
        /// The pale 搪瓷板 wall the row hangs on. The ink is transparent, so this is
        /// what the strokes read against — and it is a scene prop, not part of any
        /// model: the pieces carry no board or frame.
        ///
        /// The material is built from the shader the imported ink already wears,
        /// with every texture cleared and the tint set to the pale wall colour. That
        /// shader is the one thing the Web build is known to ship, because the twelve
        /// prefabs in the scene use it; a hand-picked pipeline shader would be a
        /// guess about what the build strips.
        /// </summary>
        private static void BuildWall(List<Imported> models)
        {
            // A built-in cube, not a hand-built quad: the mesh is a built-in
            // resource the scene can reference, and its slab is visible from
            // whichever side the camera ends up on. It is 0.2 m thick with its
            // front face on z = -0.5, so the ink hangs 0.04 m proud of it.
            var wall = GameObject.CreatePrimitive(PrimitiveType.Cube);
            wall.name = "Pale wall";
            UnityEngine.Object.DestroyImmediate(wall.GetComponent<Collider>());
            wall.transform.position = new Vector3(0f, WallHeightMetres / 2f, WallZ - WallThicknessMetres / 2f);
            wall.transform.localScale = new Vector3(WallWidthMetres, WallHeightMetres, WallThicknessMetres);

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(models[0].prefabPath);
            Require(prefab != null, "Missing the prefab the pale wall takes its shader from");
            var ink = prefab.GetComponentsInChildren<MeshRenderer>()[0].sharedMaterial;
            Require(ink != null && ink.shader != null, "The imported ink material has no shader");
            var material = new Material(ink.shader) { name = "paleWall" };
            foreach (var property in material.GetTexturePropertyNames()) material.SetTexture(property, null);
            Require(SetMaterialColour(material, WallColour), "The pale wall shader has no colour property to tint");
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", 0f);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.2f);
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 0f);
            material.renderQueue = (int)RenderQueue.Geometry;
            wall.GetComponent<MeshRenderer>().sharedMaterial = material;
        }

        /// <summary>
        /// The tint of a material, whichever colour property its shader uses. The
        /// glTFast shaders name theirs `baseColorFactor`; a plain URP material would
        /// use `_BaseColor`.
        /// </summary>
        private static bool SetMaterialColour(Material material, Color colour)
        {
            foreach (var property in ColourProperties)
            {
                if (!material.HasProperty(property)) continue;
                material.SetColor(property, colour);
                return true;
            }
            return false;
        }

        private static Color MaterialColour(Material material)
        {
            foreach (var property in ColourProperties)
                if (material.HasProperty(property)) return material.GetColor(property);
            throw new InvalidOperationException($"{material.name} has no colour property to read");
        }

        private static readonly string[] ColourProperties = { "baseColorFactor", "_BaseColor", "_Color" };

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: twelve prefab
        /// instances linked to the wrapper prefabs at their row positions, the pale
        /// wall behind them, and the slate camera with the 150 m far plane and the key
        /// light the Web check depends on.
        /// </summary>
        private static void VerifyReviewScene(List<Imported> models)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            for (int i = 0; i < models.Count; i++)
            {
                var model = models[i];
                var instance = roots.SingleOrDefault(root => root.name == model.expected.prefab);
                Require(instance != null, $"Review scene is missing the {model.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == model.prefabPath,
                    $"{model.expected.prefab} is not an instance of {model.prefabPath}");
                Near(instance.transform.position, new Vector3(RowX(i), 0f, 0f), $"{model.expected.prefab} row placement");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length == 1,
                    $"{model.expected.prefab} instance does not have its one ink plate");
            }

            var wall = roots.SingleOrDefault(root => root.name == "Pale wall");
            Require(wall != null, "Review scene is missing the pale wall the row hangs on");
            var wallRenderer = wall.GetComponent<MeshRenderer>();
            Require(wallRenderer != null && wallRenderer.sharedMaterial != null, "The pale wall has no renderer material");
            Require(Vector4.Distance((Vector4)MaterialColour(wallRenderer.sharedMaterial), (Vector4)WallColour) < 0.002f,
                "The pale wall is not the colour the Web check reads");
            Require(Mathf.Abs(wall.transform.position.z - (WallZ - WallThicknessMetres / 2f)) < 0.001f,
                $"The pale wall stands at z={wall.transform.position.z:F3}, not {(WallZ - WallThicknessMetres / 2f):F3}");

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(Mathf.Abs(camera.fieldOfView - CameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(Mathf.Abs(camera.farClipPlane - CameraFarPlane) < 0.001f, "Review camera far plane changed");
            Require(camera.farClipPlane >= 150f, "Review camera cannot frame the whole row");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Near(camera.transform.position, CameraPosition, "Review camera position");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 1, "Review scene is missing its directional key light");
        }

        private static float RowX(int index) => index * RowPitchMetres - RowCentre;

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
