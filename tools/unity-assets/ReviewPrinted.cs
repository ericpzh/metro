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
    /// Import the ten printed-surface GLBs exported by export-printed.mjs: the two
    /// marked courts and their fabric divider, the three printed floor vinyls, the
    /// hung and wall wayfinding signs and the two line network maps. Each is wrapped
    /// in a prefab under the Unity gameplay basis, the family parameters, bounds,
    /// triangle counts, material sets, texture counts and alpha queues are checked,
    /// and one review scene holds all ten in a row under a slate 3/4 top-down camera.
    /// </summary>
    public static class ReviewPrinted
    {
        private const string Folder = "Assets/PrintedProof";
        private const string Scene = Folder + "/Printed.unity";
        private const int Count = 10;

        /// <summary>
        /// A 3/4 top-down view: high enough to read the flat floor vinyls, aimed a
        /// little above the row so the whole 38 m run (courts turned side-on at 8 m
        /// centres) sits in frame. The far plane covers the family's largest piece.
        /// </summary>
        private static readonly Vector3 CameraPosition = new Vector3(0f, 26f, 20f);
        private static readonly Vector3 CameraTarget = new Vector3(0f, 6f, 0f);
        private const float CameraFieldOfView = 50f;
        private const float CameraFarPlane = 200f;
        private static readonly Color Slate = new Color(0.22f, 0.30f, 0.38f);

        /// <summary>The row is built on world z = 0 and centred on x = 0.</summary>
        private const float RowCentre = 18.73f;

        [Serializable]
        private class Manifest
        {
            public Asset[] assets;
            public Parameters parameters;
        }

        [Serializable]
        private class Parameters
        {
            public int models, rot, hungSignCeilingMetres;
            public string stationData, placement, hungSignCeilingSource, dynamicContent, neutralFaces, textures, canvasEncode, basis, row;
            public MountValue[] mounts;
            public Panel[] panels;
        }

        [Serializable]
        private class MountValue
        {
            public string paletteId, mount;
        }

        [Serializable]
        private class Panel
        {
            public string paletteId, kind, variant;
            public float widthMetres, depthMetres, heightMetres, rowPitchMetres;
            public int textures, linePrimitives;
        }

        [Serializable]
        private class Asset
        {
            public string id, catalogueId, paletteId, family, kind, variant, prefab, file, sha256, source, provenance, licenseRecord, units, facade;
            public float[] min, max, size, placementOffset;
            public Anchors anchors;
            public int triangles, meshes, lineMeshes, textures, rowPitchMetres;
            public string[] materials, alphaMaterials;
            public AssetParameters parameters;
            public Validation validation;
        }

        /// <summary>
        /// The union of the per-kind parameter blocks. JsonUtility leaves the fields a
        /// given kind does not carry at their defaults, so one class can read them all.
        /// </summary>
        [Serializable]
        private class AssetParameters
        {
            public string variant, mount, faces, texture, artwork, lineBinding, dynamicContent, canvasTop, netLineMaterial;
            public float widthMetres, depthMetres, thicknessMetres, panelWidthMetres, panelHeightMetres, panelCentreMetres, bayWidthMetres, bayDepthMetres, bayHeightMetres, framePadMetres, heightMetres;
            public bool hung, doubleSided;
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
            public string paletteId, prefab, id, kind, variant;
            public float width, depth, height;
            /// <summary>Scene x offset before RowCentre is subtracted.</summary>
            public float x;
            public int textures, linePrimitives;
            public bool turned;
            public bool vinyl;
        }

        /// <summary>
        /// The ten family models in review-row order. The two 14 m courts stand first,
        /// turned 90 degrees so their 7 m width faces the row, on 8 m centres; the
        /// fabric divider follows on the same court pitch; every other piece sits on
        /// a 3 m pitch. The dimensions are the source-space extents the exporter
        /// asserts, repeated here so a builder drift cannot pass review.
        /// </summary>
        private static readonly Expected[] ExpectedPrinted =
        {
            new Expected { paletteId = "court-badminton", prefab = "CourtBadminton", id = "station.court.badminton", kind = "court", variant = "badminton", width = 14f, depth = 7f, height = 1.597f, x = 0f, textures = 0, linePrimitives = 1, turned = true },
            new Expected { paletteId = "court-pickleball", prefab = "CourtPickleball", id = "station.court.pickleball", kind = "court", variant = "pickleball", width = 14f, depth = 7f, height = 0.962f, x = 8f, textures = 0, linePrimitives = 1, turned = true },
            new Expected { paletteId = "court-divider", prefab = "CourtDivider", id = "station.court.divider", kind = "court", variant = "divider", width = 2f, depth = 0.82f, height = 1f, x = 16f, textures = 0, linePrimitives = 0 },
            new Expected { paletteId = "floor-mark-boarding", prefab = "FloorMarkBoarding", id = "station.floor-mark.boarding", kind = "floor-mark", variant = "boarding", width = 3f, depth = 0.25f, height = 0f, x = 19f, textures = 1, linePrimitives = 0, vinyl = true },
            new Expected { paletteId = "floor-mark-direction", prefab = "FloorMarkDirection", id = "station.floor-mark.direction", kind = "floor-mark", variant = "direction", width = 1f, depth = 2f, height = 0f, x = 22f, textures = 1, linePrimitives = 0, vinyl = true },
            new Expected { paletteId = "floor-mark-waiting", prefab = "FloorMarkWaiting", id = "station.floor-mark.waiting", kind = "floor-mark", variant = "waiting", width = 3f, depth = 2f, height = 0f, x = 25f, textures = 1, linePrimitives = 0, vinyl = true },
            new Expected { paletteId = "sign-ceiling", prefab = "SignCeiling", id = "station.sign.ceiling", kind = "sign", variant = "ceiling", width = 1.9f, depth = 0.16f, height = 0.85f, x = 28f, textures = 2, linePrimitives = 0 },
            new Expected { paletteId = "sign-wall", prefab = "SignWall", id = "station.sign.wall", kind = "sign", variant = "wall", width = 1.9f, depth = 0f, height = 0.4f, x = 31f, textures = 1, linePrimitives = 0 },
            new Expected { paletteId = "linemap-stand", prefab = "LinemapStand", id = "station.linemap.stand", kind = "linemap", variant = "stand", width = 1.86f, depth = 0.62f, height = 2.28f, x = 34f, textures = 2, linePrimitives = 0 },
            new Expected { paletteId = "linemap-wall", prefab = "LinemapWall", id = "station.linemap.wall", kind = "linemap", variant = "wall", width = 1.92f, depth = 0.185f, height = 1.94f, x = 37f, textures = 2, linePrimitives = 0 },
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
            Require(manifest.assets.Length == Count, $"Expected {Count} printed models in the manifest, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.paletteId).Distinct().Count() == Count, "The manifest repeats a palette id");
            CheckFamilyParameters(manifest.parameters, manifest.assets);

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var imported = new List<Imported>();
            foreach (var expected in ExpectedPrinted)
            {
                var asset = manifest.assets.Single(entry => entry.paletteId == expected.paletteId);
                CheckAssetParameters(asset, expected, manifest.parameters);
                var entry = ImportAsset(asset, expected, evidence);
                imported.Add(entry);
                summary.Add($"{asset.id}={entry.manifest.triangles}t/{entry.manifest.materials.Length}m/" +
                            $"{entry.manifest.alphaMaterials.Length}a/{entry.manifest.textures}x");
            }

            // Unity mints fresh scene fileIDs on every SaveScene call, so a regenerated
            // scene is never byte-identical between two imports. The scene is a pure
            // view over the wrapper prefabs, which are rebuilt deterministically above,
            // so create it only when it is missing and verify its content on every run.
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"PRINTED_IMPORT_OK {imported.Count} models {string.Join(" ", summary)} " +
                      $"row={RowX(0):F2}..{RowX(Count - 1):F2} camera=({CameraPosition.x:F1},{CameraPosition.y:F1},{CameraPosition.z:F1}) far={CameraFarPlane:F0}");
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
        /// The family parameters the recipe has to keep: ten modules built at rot 0 in
        /// an empty station document, the mounts and panel table, and the explicit note
        /// that sign and line-map content is a runtime binding rather than baked-in
        /// station artwork.
        /// </summary>
        private static void CheckFamilyParameters(Parameters parameters, Asset[] assets)
        {
            Require(parameters != null, "The manifest is missing its family parameters");
            Require(parameters.models == Count, $"Expected {Count} family models, got {parameters.models}");
            Require(parameters.rot == 0, $"Expected rot 0 exports, got {parameters.rot}");
            Require(!string.IsNullOrEmpty(parameters.stationData) && parameters.stationData.Contains("empty"),
                "Expected the exports to stand in an empty station document");
            Require(!string.IsNullOrEmpty(parameters.placement) && parameters.placement.Contains("buildModule"),
                "The manifest does not record the builder placement");
            Require(parameters.hungSignCeilingMetres == 4,
                $"Expected the hung sign's ceiling fallback to be 4 m, got {parameters.hungSignCeilingMetres}");
            Require(!string.IsNullOrEmpty(parameters.dynamicContent) && parameters.dynamicContent.Contains("dynamic-station-panels"),
                "The manifest does not record the dynamic signage/line-map binding");
            Require(!string.IsNullOrEmpty(parameters.neutralFaces) && parameters.neutralFaces.Contains("neutral"),
                "The manifest does not record the neutral default printed faces");
            Require(!string.IsNullOrEmpty(parameters.textures) && parameters.textures.Contains("brushed steel"),
                "The manifest does not describe the family's texture budget");
            Require(!string.IsNullOrEmpty(parameters.canvasEncode) && parameters.canvasEncode.Contains("serialised"),
                "The manifest does not record the serialised canvas encodes");
            Require(!string.IsNullOrEmpty(parameters.basis) && parameters.basis.Contains("Z-up"),
                "The manifest does not record the export basis");
            Require(!string.IsNullOrEmpty(parameters.row) && parameters.row.Contains("8 m"),
                "The manifest does not record the review row pitch");

            Require(parameters.panels != null && parameters.panels.Length == Count,
                $"Expected {Count} panel parameter entries, got {parameters.panels?.Length ?? 0}");
            Require(parameters.mounts != null && parameters.mounts.Length == 4,
                $"Expected the four sign/line-map mounts, got {parameters.mounts?.Length ?? 0}");
            foreach (var expected in ExpectedPrinted)
            {
                var panel = parameters.panels.Single(entry => entry.paletteId == expected.paletteId);
                Require(panel.kind == expected.kind && panel.variant == expected.variant,
                    $"{expected.paletteId}: family panel {panel.kind}/{panel.variant} != {expected.kind}/{expected.variant}");
                Require(panel.textures == expected.textures, $"{expected.paletteId}: family textures {panel.textures} != {expected.textures}");
                Require(panel.linePrimitives == expected.linePrimitives,
                    $"{expected.paletteId}: family line primitives {panel.linePrimitives} != {expected.linePrimitives}");
                Require(panel.rowPitchMetres == (expected.kind == "court" ? 8f : 3f),
                    $"{expected.paletteId}: family row pitch {panel.rowPitchMetres}");
                var mount = parameters.mounts.SingleOrDefault(entry => entry.paletteId == expected.paletteId);
                if (expected.kind == "sign" || expected.kind == "linemap")
                {
                    Require(mount != null && mount.mount == expected.variant,
                        $"{expected.paletteId}: manifest mount {mount?.mount} != {expected.variant}");
                }
                else Require(mount == null, $"{expected.paletteId}: unexpected mount entry");
            }
            // The two 14 m courts are the only turned instances; the manifest must say so.
            var courts = assets.Where(asset => asset.kind == "court").Select(asset => asset.paletteId).OrderBy(name => name).ToArray();
            Require(courts.SequenceEqual(new[] { "court-badminton", "court-divider", "court-pickleball" }),
                $"Unexpected court set: {string.Join(", ", courts)}");
        }

        /// <summary>
        /// One model's identity, dimensions and canonical parameters. The dimension
        /// table is the same source-space extent the exporter asserted on the built
        /// geometry; the lit faces and vinyls are the family's printed surfaces.
        /// </summary>
        private static void CheckAssetParameters(Asset asset, Expected expected, Parameters family)
        {
            string label = $"{expected.paletteId}: ";
            Require(asset.id == expected.id, $"{label}manifest id {asset.id} != {expected.id}");
            Require(asset.catalogueId == expected.paletteId, $"{label}catalogue id {asset.catalogueId}");
            Require(asset.family == "printed", $"{label}family {asset.family}");
            Require(asset.kind == expected.kind, $"{label}kind {asset.kind} != {expected.kind}");
            Require(asset.variant == expected.variant, $"{label}variant {asset.variant} != {expected.variant}");
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.paletteId + ".glb", $"{label}file {asset.file}");
            Require(asset.units == "metres", $"{label}units {asset.units}");
            Require(!string.IsNullOrEmpty(asset.source) && asset.source.Contains("game/src/render/models"),
                $"{label}manifest source is missing");
            Require(!string.IsNullOrEmpty(asset.provenance) && asset.provenance.Contains("Repository"),
                $"{label}provenance is missing");
            Require(!string.IsNullOrEmpty(asset.licenseRecord) && asset.licenseRecord.Contains("Repository-authored"),
                $"{label}license record is missing");
            Require(asset.validation != null && asset.validation.errors == 0 && asset.validation.warnings == 0,
                $"{label}GLB validation was not clean");
            Require(asset.placementOffset != null && asset.placementOffset.Length == 3, $"{label}missing placement offset");
            Near(new Vector3(asset.placementOffset[0], asset.placementOffset[1], asset.placementOffset[2]),
                new Vector3(expected.kind == "linemap" ? 1f : 0.5f, 0.5f, 1f), $"{label}placement offset");
            Near(new Vector3(asset.size[0], asset.size[1], asset.size[2]),
                new Vector3(expected.width, expected.depth, expected.height), $"{label}manifest size");
            Require(asset.meshes > 0 && asset.triangles > 0, $"{label}exported no geometry");
            Require(asset.textures == expected.textures, $"{label}expected {expected.textures} textures, got {asset.textures}");
            Require(asset.lineMeshes == expected.linePrimitives,
                $"{label}expected {expected.linePrimitives} line primitives, got {asset.lineMeshes}");
            Require(asset.rowPitchMetres == (expected.kind == "court" ? 8 : 3), $"{label}row pitch {asset.rowPitchMetres}");

            if (expected.vinyl)
            {
                Require(asset.alphaMaterials != null && asset.alphaMaterials.Length == 1 &&
                        asset.alphaMaterials[0] == $"floorMarkInk_{expected.variant}",
                    $"{label}the vinyl ink is not the one transparent material");
                Require(asset.parameters != null, $"{label}missing parameters");
                Require(Mathf.Abs(asset.parameters.thicknessMetres - 0.006f) < 0.0001f,
                    $"{label}vinyl thickness {asset.parameters.thicknessMetres}");
                Require(Mathf.Abs(asset.parameters.widthMetres - expected.width) < 0.0001f &&
                        Mathf.Abs(asset.parameters.depthMetres - expected.depth) < 0.0001f,
                    $"{label}vinyl size parameters drifted");
                Require(!string.IsNullOrEmpty(asset.parameters.lineBinding) && asset.parameters.lineBinding.Contains("runtime binding"),
                    $"{label}the floor-mark line binding is not a runtime binding");
                Require(!string.IsNullOrEmpty(asset.parameters.dynamicContent) && asset.parameters.dynamicContent.Contains("dynamic-station-panels"),
                    $"{label}missing the dynamic content note");
            }
            else if (expected.kind == "court")
            {
                Require(asset.alphaMaterials != null && asset.alphaMaterials.Length == 0, $"{label}a court must not be transparent");
                Require(asset.parameters != null, $"{label}missing parameters");
                Require(Mathf.Abs(asset.parameters.bayWidthMetres - (expected.variant == "divider" ? 2f : 14f)) < 0.0001f,
                    $"{label}court bay width {asset.parameters.bayWidthMetres}");
                Require(Mathf.Abs(asset.parameters.bayDepthMetres - (expected.variant == "divider" ? 1f : 7f)) < 0.0001f,
                    $"{label}court bay depth {asset.parameters.bayDepthMetres}");
                if (expected.linePrimitives > 0)
                    Require(!string.IsNullOrEmpty(asset.parameters.netLineMaterial) && asset.parameters.netLineMaterial.Contains("MeshBasicMaterial"),
                        $"{label}the net line material is not recorded");
            }
            else if (expected.kind == "sign")
            {
                Require(asset.alphaMaterials != null && asset.alphaMaterials.Length == 0, $"{label}a sign face is opaque");
                Require(asset.parameters != null, $"{label}missing parameters");
                Require(asset.parameters.mount == expected.variant, $"{label}sign mount {asset.parameters.mount}");
                Require(Mathf.Abs(asset.parameters.panelWidthMetres - 1.9f) < 0.0001f,
                    $"{label}sign panel width {asset.parameters.panelWidthMetres}");
                Require(Mathf.Abs(asset.parameters.panelHeightMetres - 0.4f) < 0.0001f,
                    $"{label}sign panel height {asset.parameters.panelHeightMetres}");
                Require(asset.parameters.hung == (expected.variant == "ceiling"), $"{label}sign hung flag");
                Require(asset.parameters.doubleSided == (expected.variant == "ceiling"), $"{label}sign double-sided flag");
                Require(!string.IsNullOrEmpty(asset.parameters.dynamicContent) && asset.parameters.dynamicContent.Contains("dynamic-station-panels"),
                    $"{label}missing the dynamic content note");
            }
            else
            {
                Require(asset.alphaMaterials != null && asset.alphaMaterials.Length == 0, $"{label}a line map face is opaque");
                Require(asset.parameters != null, $"{label}missing parameters");
                Require(asset.parameters.mount == expected.variant, $"{label}line-map mount {asset.parameters.mount}");
                Require(Mathf.Abs(asset.parameters.panelWidthMetres - 1.8f) < 0.0001f,
                    $"{label}line-map panel width {asset.parameters.panelWidthMetres}");
                Require(Mathf.Abs(asset.parameters.panelHeightMetres - 1.8f) < 0.0001f,
                    $"{label}line-map panel height {asset.parameters.panelHeightMetres}");
                Require(asset.parameters.doubleSided == (expected.variant == "stand"), $"{label}line-map double-sided flag");
                Require(!string.IsNullOrEmpty(asset.parameters.dynamicContent) && asset.parameters.dynamicContent.Contains("dynamic-station-panels"),
                    $"{label}missing the dynamic content note");
            }

            var panel = family.panels.Single(entry => entry.paletteId == expected.paletteId);
            Require(Mathf.Abs(panel.widthMetres - expected.width) < 0.001f &&
                    Mathf.Abs(panel.depthMetres - expected.depth) < 0.001f &&
                    Mathf.Abs(panel.heightMetres - expected.height) < 0.001f,
                $"{label}family panel size drifted");
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
            Require(filters.Length == asset.meshes + asset.lineMeshes,
                $"{label}: expected {asset.meshes} mesh nodes (+{asset.lineMeshes} line primitives), got {filters.Length}");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
            Near(bounds.min, Basis(asset.min), $"{label} minimum bounds");
            Near(bounds.max, Basis(asset.max), $"{label} maximum bounds");

            // The courts' net is a LINES primitive, so triangles come from the
            // triangle-topology submeshes only and the line mesh is counted apart.
            int triangles = 0, triangleMeshes = 0, lineMeshes = 0;
            foreach (var filter in filters)
            {
                var mesh = filter.sharedMesh;
                Require(mesh != null, $"{label}: a MeshFilter has no mesh");
                if (mesh.GetTopology(0) == MeshTopology.Lines) { lineMeshes++; continue; }
                Require(mesh.GetTopology(0) == MeshTopology.Triangles, $"{label}: unexpected mesh topology {mesh.GetTopology(0)}");
                triangles += mesh.GetIndices(0).Length / 3;
                triangleMeshes++;
            }
            Require(triangles == asset.triangles, $"{label}: expected {asset.triangles} triangles, got {triangles}");
            Require(triangleMeshes == asset.meshes, $"{label}: expected {asset.meshes} triangle meshes, got {triangleMeshes}");
            Require(lineMeshes == asset.lineMeshes, $"{label}: expected {asset.lineMeshes} line meshes, got {lineMeshes}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(asset.materials),
                $"{label}: unexpected materials {string.Join(", ", materials)}");

            // Alpha queue: the floor-mark vinyl is the family's only transparent
            // material; the lit sign and line-map faces are opaque, unlit plates.
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
            if (expected.vinyl)
            {
                var vinyl = importedMaterials.Single(material => material.name == $"floorMarkInk_{expected.variant}");
                Require(vinyl.renderQueue >= (int)RenderQueue.Transparent, $"{label}: the vinyl is not on the transparent queue");
            }
            if (expected.kind == "sign")
            {
                var face = importedMaterials.Single(material => material.name == "signFace");
                Require(face.renderQueue < (int)RenderQueue.Transparent, $"{label}: the lit sign face must stay opaque");
                Require(HasTexture(face), $"{label}: the lit sign face lost its printed texture");
            }
            if (expected.kind == "linemap")
            {
                var board = importedMaterials.Single(material => material.name == "lineMapPlaceholder");
                Require(board.renderQueue < (int)RenderQueue.Transparent, $"{label}: the line-map board must stay opaque");
                Require(HasTexture(board), $"{label}: the line-map board lost its printed texture");
            }
            if (expected.kind == "court")
            {
                Require(importedMaterials.All(material => material.renderQueue < (int)RenderQueue.Transparent),
                    $"{label}: a court material is on the transparent queue");
                if (expected.linePrimitives > 0)
                    Require(importedMaterials.Any(material => material.name == "courtNetInk"),
                        $"{label}: the net's line ink is missing");
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
            Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null, $"{label}: could not save wrapper prefab");
            UnityEngine.Object.DestroyImmediate(root);

            return new Imported { expected = expected, manifest = asset, prefabPath = prefabPath };
        }

        /// <summary>
        /// One review scene: all ten wrapper prefabs in a row on z = 0. The two 14 m
        /// courts are turned 90 degrees so their 7 m width faces along the row on 8 m
        /// centres; the divider keeps the court pitch and everything else sits on 3 m.
        /// A 3/4 top-down camera looks down the row from the printed-face side.
        /// </summary>
        private static void BuildReviewScene(List<Imported> printed)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < printed.Count; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(printed[i].prefabPath);
                Require(prefab != null, $"Missing prefab for {printed[i].manifest.paletteId}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(RowX(i), 0f, 0f);
                instance.transform.rotation = printed[i].expected.turned ? Quaternion.Euler(0, 90, 0) : Quaternion.identity;
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
                "Could not save the printed review scene");
        }

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: ten prefab
        /// instances linked to the wrapper prefabs at their row positions (courts
        /// turned side-on), the slate camera with the 200 m far plane and the key
        /// light the Web check depends on.
        /// </summary>
        private static void VerifyReviewScene(List<Imported> printed)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            for (int i = 0; i < printed.Count; i++)
            {
                var model = printed[i];
                var instance = roots.SingleOrDefault(root => root.name == model.expected.prefab);
                Require(instance != null, $"Review scene is missing the {model.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == model.prefabPath,
                    $"{model.expected.prefab} is not an instance of {model.prefabPath}");
                Near(instance.transform.position, new Vector3(RowX(i), 0f, 0f), $"{model.expected.prefab} row placement");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{model.expected.prefab} instance has no renderers");
                bool turned = Mathf.Abs(Quaternion.Angle(instance.transform.rotation, Quaternion.Euler(0, 90, 0))) < 0.01f;
                Require(turned == model.expected.turned,
                    $"{model.expected.prefab} row rotation is {(turned ? "turned" : "upright")}");
            }

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(Mathf.Abs(camera.fieldOfView - CameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(Mathf.Abs(camera.farClipPlane - CameraFarPlane) < 0.001f, "Review camera far plane changed");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Near(camera.transform.position, CameraPosition, "Review camera position");
            Require(camera.transform.position.y >= 20f,
                $"Review camera must sit high enough to see the floor vinyls (y={camera.transform.position.y:F2})");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 1, "Review scene is missing its directional key light");
        }

        private static float RowX(int index) => ExpectedPrinted[index].x - RowCentre;

        private static bool HasTexture(Material material) =>
            material.GetTexturePropertyNames().Any(property => material.GetTexture(property) != null);

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
