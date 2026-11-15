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
    /// Import the eleven exit GLBs exported by export-exit.mjs — the three 有盖
    /// head-houses (单向 / 双向 / 三向), the four 地面 doorway headers, the three
    /// 无盖 open exits and the 虚拟 1×1 marker — wrap each in a prefab under the
    /// Unity gameplay basis, verify the family parameters, digest, bounds,
    /// triangles, materials, texture counts, glass/alpha queues, preserved
    /// builder hierarchy and the basis anchors at four facings, and save one
    /// review scene with all eleven in a row.
    /// </summary>
    public static class ReviewExit
    {
        private const string Folder = "Assets/ExitProof";
        private const string Scene = Folder + "/Exit.unity";
        private const int Count = 11;
        private const float Spacing = 8.6f;
        private const float CameraFieldOfView = 60f;
        private const float CameraFarPlane = 300f;

        /// <summary>The camera stands back from the 95 m row and looks slightly down at it.</summary>
        private static readonly Vector3 CameraPosition = new Vector3(0f, 8f, -62f);
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
            public string family, cityStyle, cityStyleSource, stationData, placement, exitWidths;
            public string virtualMarker, palette, textures, basis;
            public float enclosedLengthMetres, canopyHeightMetres, canopyReachMetres;
            public float streetOverhangMetres, backWallMetres, baseHeightMetres;
            public ExitSpec[] exitSpecs;
        }

        [Serializable]
        private class ExitSpec
        {
            public string paletteId, variant, style;
            public bool covered;
            public int bays;
            public float widthMetres, depthMetres;
        }

        [Serializable]
        private class Asset
        {
            public string id, catalogueId, paletteId, family, variant, style, prefab, file, sha256;
            public string source, provenance, licenseRecord, units, facade, forwardDirection;
            public float[] placementOffset, min, max, size, forward;
            public bool marker;
            public Anchors anchors;
            public AssetParameters parameters;
            public int triangles, meshes, textures;
            public string[] materials, alphaMaterials, glassMaterials;
        }

        [Serializable]
        private class AssetParameters
        {
            public string variant, style, cityStyle;
            public bool covered, marker;
            public int bays;
            public float widthMetres, enclosedLengthMetres, canopyHeightMetres, canopyReachMetres;
            public float streetOverhangMetres, backWallMetres, baseHeightMetres;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        /// <summary>One row slot: the recipe values the manifest must reproduce.</summary>
        private class Expected
        {
            public string paletteId, prefab, id, style;
            public bool covered;
            public int bays;
            public float width, depth, height, yaw;
        }

        // exitWidth(bays) = bays + 2, and the sim's own constants (EXIT_REACH 5.6,
        // EXIT_BACK 2.3, EXIT_BASE_HEIGHT 0.25) set the head-house depth and
        // height. A 有盖 head-house is 4.0 m tall, a 无盖 railing 1.25 m, a
        // doorway header 0.78 m; the 虚拟 marker is the 4 m 导向柱.
        private static readonly Expected[] Rows =
        {
            new Expected { paletteId = "exit", prefab = "Exit", id = "station.exit.standard", style = "head-house", covered = true, bays = 2, width = 4.10f, depth = 8.12f, height = 4.00f, yaw = 180f },
            new Expected { paletteId = "exit-covered-1", prefab = "ExitCovered1", id = "station.exit.covered-1", style = "head-house", covered = true, bays = 1, width = 3.10f, depth = 8.12f, height = 4.00f, yaw = 180f },
            new Expected { paletteId = "exit-covered-3", prefab = "ExitCovered3", id = "station.exit.covered-3", style = "head-house", covered = true, bays = 3, width = 5.10f, depth = 8.12f, height = 4.00f, yaw = 180f },
            new Expected { paletteId = "exit-doorway-1", prefab = "ExitDoorway1", id = "station.exit.doorway-1", style = "doorway", covered = true, bays = 1, width = 3.00f, depth = 0.07f, height = 0.78f, yaw = 180f },
            new Expected { paletteId = "exit-doorway-2", prefab = "ExitDoorway2", id = "station.exit.doorway-2", style = "doorway", covered = true, bays = 2, width = 4.00f, depth = 0.07f, height = 0.78f, yaw = 180f },
            new Expected { paletteId = "exit-doorway-3", prefab = "ExitDoorway3", id = "station.exit.doorway-3", style = "doorway", covered = true, bays = 3, width = 5.00f, depth = 0.07f, height = 0.78f, yaw = 180f },
            new Expected { paletteId = "exit-doorway-4", prefab = "ExitDoorway4", id = "station.exit.doorway-4", style = "doorway", covered = true, bays = 4, width = 6.00f, depth = 0.07f, height = 0.78f, yaw = 180f },
            new Expected { paletteId = "exit-uncovered-1", prefab = "ExitUncovered1", id = "station.exit.uncovered-1", style = "head-house", covered = false, bays = 1, width = 3.04f, depth = 8.08f, height = 1.25f, yaw = 180f },
            new Expected { paletteId = "exit-uncovered-2", prefab = "ExitUncovered2", id = "station.exit.uncovered-2", style = "head-house", covered = false, bays = 2, width = 4.04f, depth = 8.08f, height = 1.25f, yaw = 180f },
            new Expected { paletteId = "exit-uncovered-3", prefab = "ExitUncovered3", id = "station.exit.uncovered-3", style = "head-house", covered = false, bays = 3, width = 5.04f, depth = 8.08f, height = 1.25f, yaw = 180f },
            new Expected { paletteId = "exit-virtual", prefab = "ExitVirtual", id = "station.exit.virtual", style = "virtual", covered = true, bays = 1, width = 0.16f, depth = 0.59f, height = 4.00f, yaw = -90f },
        };

        private class ImportedExit
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
            Require(manifest?.assets != null, "Unreadable exit export manifest");
            Require(manifest.assets.Length == Count, $"Expected {Count} exit models in the manifest, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.paletteId).Distinct().Count() == Count, "The manifest repeats a palette id");
            Require(manifest.assets.Select(asset => asset.id).Distinct().Count() == Count, "The manifest repeats a catalogue id");
            Require(manifest.family == "exit", $"Unexpected manifest family {manifest.family}");

            var parameters = manifest.parameters;
            Require(parameters != null, "The manifest is missing its family parameters");
            Require(parameters.models == Count, $"Expected {Count} family models, got {parameters.models}");
            Require(parameters.rot == 0, $"Expected rot 0 exports, got {parameters.rot}");
            // The family runs in an empty station document, so the default
            // Guangzhou identity draws every head-house.
            Require(parameters.cityStyle == "guangzhou", $"Expected the default guangzhou city style, got {parameters.cityStyle}");
            Require(!string.IsNullOrEmpty(parameters.cityStyleSource) && parameters.cityStyleSource.Contains("DEFAULT_CITY_STYLE"),
                "The manifest does not record where the city style comes from");
            Require(!string.IsNullOrEmpty(parameters.stationData) && parameters.stationData.Contains("empty"),
                "Expected the exports to stand in an empty station document");
            Require(!string.IsNullOrEmpty(parameters.virtualMarker) && parameters.virtualMarker.Contains("marker") &&
                    parameters.virtualMarker.Contains("not a full exit"),
                "The manifest does not record that exit-virtual is a marker, not a full exit");
            Require(parameters.exitSpecs != null && parameters.exitSpecs.Length == Count,
                $"Expected {Count} exit spec entries, got {parameters.exitSpecs?.Length ?? 0}");
            Require(Mathf.Approximately(parameters.enclosedLengthMetres, 4f), $"Unexpected enclosed length {parameters.enclosedLengthMetres}");
            Require(Mathf.Approximately(parameters.canopyHeightMetres, 3.2f), $"Unexpected canopy height {parameters.canopyHeightMetres}");
            Require(Mathf.Approximately(parameters.canopyReachMetres, 5.6f), $"Unexpected canopy reach {parameters.canopyReachMetres}");
            Require(Mathf.Approximately(parameters.streetOverhangMetres, 2.3f), $"Unexpected street overhang {parameters.streetOverhangMetres}");
            Require(Mathf.Approximately(parameters.backWallMetres, -5.5f), $"Unexpected back wall {parameters.backWallMetres}");
            Require(Mathf.Approximately(parameters.baseHeightMetres, 0.25f), $"Unexpected base height {parameters.baseHeightMetres}");
            Require(!string.IsNullOrEmpty(parameters.exitWidths) && parameters.exitWidths.Contains("bays + 2"),
                "The manifest does not record the bay width rule");

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var imported = new List<ImportedExit>();
            foreach (var expected in Rows)
            {
                var asset = manifest.assets.Single(entry => entry.paletteId == expected.paletteId);
                CheckFamilyParameters(asset, expected, parameters);
                var exit = ImportAsset(asset, expected, evidence);
                imported.Add(exit);
                summary.Add($"{asset.paletteId}={asset.triangles}t/{asset.materials.Length}m/{asset.textures}tex");
            }

            // Unity mints fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene is never byte-identical between two imports. The
            // scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above, so create it only when it is missing and
            // verify its content on every run.
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"EXIT_IMPORT_OK {imported.Count} models {string.Join(" ", summary)} " +
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
            string label = $"{asset.paletteId}: ";
            Require(asset.id == expected.id, $"{label}manifest id {asset.id} != {expected.id}");
            Require(asset.catalogueId == expected.paletteId, $"{label}catalogue id {asset.catalogueId}");
            Require(asset.family == "exit", $"{label}family {asset.family}");
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.paletteId + ".glb", $"{label}file {asset.file}");
            Require(asset.style == expected.style, $"{label}style {asset.style} != {expected.style}");
            Require(asset.marker == (expected.style == "virtual"), $"{label}marker flag drifted");
            Require(asset.units == "metres", $"{label}units {asset.units}");
            Require(asset.placementOffset != null && asset.placementOffset.Length == 3, $"{label}missing placement offset");
            Near(new Vector3(asset.placementOffset[0], asset.placementOffset[1], asset.placementOffset[2]),
                new Vector3(0.5f, 0.5f, 1f), $"{label}placement offset");
            Require(asset.forward != null && asset.forward.Length == 3, $"{label}missing forward direction");
            var forward = expected.style == "virtual" ? new Vector3(0f, -1f, 0f) : new Vector3(0f, 1f, 0f);
            Near(new Vector3(asset.forward[0], asset.forward[1], asset.forward[2]), forward, $"{label}forward direction");
            Require(!string.IsNullOrEmpty(asset.forwardDirection) && asset.forwardDirection.Contains(expected.style == "virtual" ? "-y" : "+y"),
                $"{label}forward direction text {asset.forwardDirection}");
            Require(asset.parameters != null, $"{label}no per-asset parameters");
            var p = asset.parameters;
            Require(p.style == expected.style, $"{label}parameter style {p.style}");
            Require(p.covered == expected.covered, $"{label}covered flag drifted");
            Require(p.bays == expected.bays, $"{label}expected {expected.bays} bays, got {p.bays}");
            Require(p.cityStyle == parameters.cityStyle, $"{label}city style {p.cityStyle}");
            Require(p.marker == (expected.style == "virtual"), $"{label}parameter marker flag drifted");
            float bayWidth = expected.style == "virtual" ? 1f : expected.bays + 2f;
            Require(Mathf.Abs(p.widthMetres - bayWidth) < 0.0001f, $"{label}bay width {p.widthMetres} != {bayWidth}");
            if (expected.style == "head-house")
            {
                Require(Mathf.Abs(p.enclosedLengthMetres - parameters.enclosedLengthMetres) < 0.0001f,
                    $"{label}enclosed length {p.enclosedLengthMetres}");
                Require(Mathf.Abs(p.baseHeightMetres - parameters.baseHeightMetres) < 0.0001f,
                    $"{label}base height {p.baseHeightMetres}");
                if (expected.covered)
                    Require(Mathf.Abs(p.canopyHeightMetres - parameters.canopyHeightMetres) < 0.0001f &&
                            Mathf.Abs(p.canopyReachMetres - parameters.canopyReachMetres) < 0.0001f,
                        $"{label}canopy parameters drifted");
                else
                    Require(Mathf.Approximately(p.canopyHeightMetres, 0f) && Mathf.Approximately(p.canopyReachMetres, 0f),
                        $"{label}the open exit must not claim a canopy");
            }
            else
            {
                Require(Mathf.Approximately(p.enclosedLengthMetres, 0f) && Mathf.Approximately(p.baseHeightMetres, 0f),
                    $"{label}a {expected.style} has no enclosed head-house length or base");
            }

            var spec = parameters.exitSpecs.Single(entry => entry.paletteId == expected.paletteId);
            Require(spec.style == expected.style && spec.covered == expected.covered && spec.bays == expected.bays,
                $"{label}family spec drifted from the asset");
            Require(Mathf.Abs(spec.widthMetres - bayWidth) < 0.0001f, $"{label}family spec width {spec.widthMetres}");
            Require(Mathf.Abs(spec.depthMetres - expected.depth) < 0.05f,
                $"{label}family spec depth {spec.depthMetres} != {expected.depth}");
        }

        private static ImportedExit ImportAsset(Asset asset, Expected expected, string evidence)
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
            // degrees about Y, as in ReviewShelf/ReviewConcourse.
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
            Near(bounds.size, BasisSize(asset.size), $"{label} bounds size");

            int triangles = filters.Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == asset.triangles, $"{label}: expected {asset.triangles} triangles, got {triangles}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(asset.materials),
                $"{label}: unexpected materials {string.Join(", ", materials)}");

            // Every alpha slot sorts in the transparent queue, every other slot
            // stays opaque. The canopy glass and the 无盖 railing glass are the
            // family's transparent surfaces; the 虚拟 marker prints on three
            // transparent plates; a doorway header is fully opaque.
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
            if (expected.style == "head-house")
            {
                Require(glass.Length == 1, $"{label}: expected the glass material, got {glass.Length}");
                Require(asset.glassMaterials.Contains("glass") && asset.alphaMaterials.Contains("glass"),
                    $"{label}: the head-house glass is not recorded as transparent glass");
                Require(glass[0].renderQueue >= (int)RenderQueue.Transparent,
                    $"{label}: glass lost its transparent queue ({glass[0].renderQueue})");
                if (glass[0].HasProperty("_BaseColor"))
                    Require(glass[0].GetColor("_BaseColor").a < 0.9f,
                        $"{label}: glass is opaque ({glass[0].GetColor("_BaseColor").a:F2})");
            }
            else
            {
                Require(glass.Length == 0, $"{label}: a {expected.style} has no glass");
                Require(asset.glassMaterials.Length == 0, $"{label}: a {expected.style} recorded glass");
            }

            var textures = importedMaterials
                .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length == asset.textures,
                $"{label}: expected {asset.textures} textures, got {textures.Length}");
            CheckFamilyShape(asset, expected, importedMaterials, textures.Length, root);

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

            return new ImportedExit { expected = expected, manifest = asset, prefabPath = prefabPath };
        }

        /// <summary>
        /// The family's fixed shape: bay width, run depth and height per builder,
        /// so a wrong bay count or a lost canopy cannot pass on the manifest alone.
        /// Sizes are in Unity metres (x across the bays, y up, z along the run).
        /// </summary>
        private static void CheckFamilyShape(Asset asset, Expected expected, Material[] materials, int textures,
            GameObject root)
        {
            var size = BasisSize(asset.size);
            float tolerance = expected.style == "virtual" ? 0.005f : 0.02f;
            Near(size, new Vector3(expected.width, expected.height, expected.depth),
                $"{asset.paletteId} family size", tolerance);

            switch (expected.style)
            {
                case "head-house":
                    // exitWidth(bays) = bays + 2; the frame/roof add 0.1 m on the
                    // covered variants, the railing 0.04 m on the open ones. Since 18 §6
                    // a head-house is **pad-free**: the source's `exitConcrete` plinth is
                    // retired at export and the runtime lays the floor from the linked
                    // runs' openings, so one material fewer than the legacy shape is the
                    // current contract (the legacy count is still accepted for a
                    // not-yet-regenerated asset and named by the pad check below).
                    int legacyMaterials = expected.covered ? 7 : 5;
                    Require(materials.Length == legacyMaterials || materials.Length == legacyMaterials - 1,
                        $"{expected.paletteId}: expected {(expected.covered ? 7 : 5)} (legacy) or {(expected.covered ? 6 : 4)} (pad-free) materials, got {materials.Length}");
                    Require(textures == (expected.covered ? 1 : 2),
                        $"{asset.paletteId}: expected {(expected.covered ? 1 : 2)} textures, got {textures}");
                    Require(asset.alphaMaterials.Length == 1, $"{asset.paletteId}: expected one alpha slot, got {asset.alphaMaterials.Length}");
                    if (expected.covered)
                    {
                        foreach (var name in new[] { "blue", "exitRed", "glow" })
                            Require(materials.Any(material => material.name == name), $"{asset.paletteId}: missing {name}");
                        // A legacy asset still carries the baked plinth; a pad-free one must
                        // carry neither the mesh nor the `exitConcrete` slot.
                        bool padNode = FindNode(root, "exit-concrete-base") != null;
                        if (padNode)
                            Require(materials.Any(material => material.name == "exitConcrete"),
                                $"{asset.paletteId}: the legacy concrete plinth lost its material");
                        else
                            Require(!materials.Any(material => material.name == "exitConcrete"),
                                $"{asset.paletteId}: a pad-free exit still exports the concrete plinth material");
                        Require(!materials.Any(material => material.name == "steel"),
                            $"{asset.paletteId}: a covered exit with no runs draws no steel handrail");
                    }
                    else
                    {
                        Require(materials.Any(material => material.name == "steel"), $"{asset.paletteId}: the railing steel is missing");
                        Require(!materials.Any(material => material.name == "blue") &&
                                !materials.Any(material => material.name == "exitRed"),
                            $"{asset.paletteId}: an open exit must not draw the canopy or red frame");
                    }
                    break;
                case "doorway":
                    Require(materials.Length == 3, $"{asset.paletteId}: expected 3 materials, got {materials.Length}");
                    Require(textures == 1, $"{asset.paletteId}: expected one header texture, got {textures}");
                    Require(asset.alphaMaterials.Length == 0, $"{asset.paletteId}: the doorway header is opaque");
                    Require(materials.Any(material => material.name == "doorwayPanel_c22f28"),
                        $"{asset.paletteId}: missing the guangzhou entrance-colour panel");
                    break;
                case "virtual":
                    Require(asset.marker, $"{asset.paletteId}: the 虚拟 exit must record marker=true");
                    Require(materials.Length == 10, $"{asset.paletteId}: expected 10 materials, got {materials.Length}");
                    Require(textures == 7, $"{asset.paletteId}: expected the seven guidepost plates, got {textures}");
                    Require(asset.alphaMaterials.Length == 3,
                        $"{asset.paletteId}: expected three transparent plates, got {asset.alphaMaterials.Length}");
                    Require(materials.Any(material => material.name == "psu"), $"{asset.paletteId}: the yellow logo collar is missing");
                    Require(materials.Any(material => material.name == "exitRed"), $"{asset.paletteId}: the red column is missing");
                    Require(materials.Count(material => material.name.StartsWith("guidePlate_")) == 7,
                        $"{asset.paletteId}: the seven canvas plates are not named guidePlate_*");
                    break;
            }
        }

        /// <summary>Preserved builder hierarchy: the parts each builder names.</summary>
        private static void CheckHierarchy(GameObject root, Expected expected)
        {
            int nodes = root.GetComponentsInChildren<Transform>().Length;
            switch (expected.style)
            {
                case "head-house":
                    // Since 18 §6 a head-house exports **pad-free**: the source's concrete
                    // plinth is retired, and the runtime composes the floor from the linked
                    // runs' openings. A not-yet-regenerated legacy asset still carries it;
                    // either shape is accepted (the material check above keeps the two
                    // consistent), and coverage itself is proved by the runtime
                    // `StationExitSnappingTests` ray test, not by this import gate.
                    if (expected.covered)
                    {
                        Require(FindNode(root, "exit-canopy-segment") != null, $"{expected.paletteId}: canopy segments missing");
                        Require(FindNode(root, "exit-side-glass") != null, $"{expected.paletteId}: side glazing nodes missing");
                    }
                    else
                    {
                        Require(FindNode(root, "exit-canopy-segment") == null,
                            $"{expected.paletteId}: an open exit must not export canopy segments");
                    }
                    break;
                case "doorway":
                    Require(FindNode(root, "exit-doorway-sign") != null, $"{expected.paletteId}: printed header plate missing");
                    break;
                case "virtual":
                    Require(FindNode(root, "guide-triangular-column") != null, $"{expected.paletteId}: guidepost column missing");
                    Require(FindNode(root, "guide-yellow-logo-collar") != null, $"{expected.paletteId}: guidepost logo collar missing");
                    Require(FindNode(root, "guide-station-face") != null, $"{expected.paletteId}: guidepost station plate missing");
                    break;
            }
            Require(nodes > 3, $"{expected.paletteId}: imported hierarchy was flattened ({nodes} nodes)");
        }

        /// <summary>
        /// One review scene: all eleven wrapper prefabs in a row on 8.6 m centres
        /// (the head-houses are 8.1 m deep through the run). Every piece is turned
        /// so its street face reads to the camera; the 虚拟 marker shows a printed
        /// long face. Only called when the scene is missing.
        /// </summary>
        private static void BuildReviewScene(List<ImportedExit> exits)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < exits.Count; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(exits[i].prefabPath);
                Require(prefab != null, $"Missing prefab for {exits[i].manifest.paletteId}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(RowX(i), 0f, 0f);
                instance.transform.rotation = Quaternion.Euler(0f, exits[i].expected.yaw, 0f);
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
                "Could not save the exit review scene");
        }

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: eleven prefab
        /// instances linked to the wrapper prefabs at their row positions and
        /// facings, plus the slate camera and the key light the Web check depends on.
        /// </summary>
        private static void VerifyReviewScene(List<ImportedExit> exits)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            for (int i = 0; i < exits.Count; i++)
            {
                var exit = exits[i];
                var instance = roots.SingleOrDefault(root => root.name == exit.expected.prefab);
                Require(instance != null, $"Review scene is missing the {exit.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == exit.prefabPath,
                    $"{exit.expected.prefab} is not an instance of {exit.prefabPath}");
                Near(instance.transform.position, new Vector3(RowX(i), 0f, 0f), $"{exit.expected.prefab} row placement");
                Require(Quaternion.Angle(instance.transform.rotation, Quaternion.Euler(0f, exit.expected.yaw, 0f)) < 0.01f,
                    $"{exit.expected.prefab} row facing changed");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{exit.expected.prefab} instance has no renderers");
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
    }
}
