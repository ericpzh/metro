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
    /// Import the ten 广告牌 (billboard / advertisement lightbox) GLBs exported by
    /// export-advert.mjs, wrap each in a prefab under the Unity gameplay basis,
    /// verify the family parameters (cells, panel size, frozen poster slug), the
    /// housing triangle count, the material set, the single poster texture and the
    /// opaque queue, and save one review scene with all ten lightboxes in a row.
    /// </summary>
    public static class ReviewAdvert
    {
        private const string Folder = "Assets/AdvertProof";
        private const string Scene = Folder + "/Advert.unity";
        private const int Count = 10;
        /// <summary>Row spacing, metres: the 6.8 m 16x9-4m panel is the widest piece.</summary>
        private const float Spacing = 7.2f;

        /// <summary>
        /// The camera looks along -z at the 64.8 m row, just above the panels. A
        /// billboard is wall-mounted on its local -y wall and prints towards +y, so
        /// its lit face is Unity +z: the review camera has to stand on the +z side or
        /// it photographs the dark housing and the edge frame from behind.
        /// </summary>
        private static readonly Vector3 CameraPosition = new Vector3(0f, 2.4f, 78f);
        private static readonly Vector3 CameraTarget = new Vector3(0f, 2.1f, 0f);
        private const float CameraFieldOfView = 40f;
        private const float CameraFarPlane = 200f;
        private static readonly Color Slate = new Color(0.22f, 0.30f, 0.38f);

        // The housing the builder draws around every panel: a dark steel slab, the
        // steel edge frame and the lit poster plane (BillboardModel.buildBillboard).
        private const double HousingMinY = -0.5;
        private const double PosterY = -0.315;
        private const double FrameWidthMargin = 0.12;
        private const double FrameHeightMargin = 0.24;
        private const int HousingTriangles = 26;
        private const int HousingMeshes = 3;
        private const int PosterTextures = 1;

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
            public string stationData, placement, posterRule, palette, textures, expectedHousing, basis;
            public BillboardSpecParameter[] billboardSpecs;
            public PosterParameter[] posters;
        }

        [Serializable]
        private class BillboardSpecParameter
        {
            public string paletteId, variant, shape, posterSlug;
            public int cells;
            public float panelW, panelH, panelZ, totalHeightMetres;
        }

        [Serializable]
        private class PosterParameter
        {
            public string slug;
            public int width, height;
            public float aspect;
            public string[] shapes;
        }

        [Serializable]
        private class Asset
        {
            public string id, catalogueId, paletteId, variant, prefab, file, sha256, facade, shape, posterSlug;
            public string source, provenance, licenseRecord;
            public float[] min, max, size, placementOffset;
            public int triangles, meshes, textures, cells;
            public float panelW, panelH, panelZ, totalHeightMetres;
            public string[] materials, alphaMaterials, glassMaterials;
            public Anchors anchors;
            public PosterImage posterImage;
        }

        [Serializable]
        private class PosterImage { public int width, height; public float aspect; }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        /// <summary>BILLBOARD_SPECS (game/src/sim/billboards.ts) for the ten palette ids.</summary>
        private class Expected
        {
            public string paletteId, variant, prefab, id, shape, posterSlug;
            public int cells;
            public float panelW, panelH, panelZ, totalHeight;
        }

        private static readonly Expected[] ExpectedBillboards =
        {
            new Expected { paletteId = "billboard-wide", variant = "wide", prefab = "BillboardWide", id = "station.billboard.wide", shape = "landscape", posterSlug = "landscape-1-jfif", cells = 1, panelW = 0.86f, panelH = 0.48f, panelZ = 1.6f },
            new Expected { paletteId = "billboard-standard", variant = "standard", prefab = "BillboardStandard", id = "station.billboard.standard", shape = "wide", posterSlug = "landscape-1-jfif", cells = 2, panelW = 1.72f, panelH = 0.76f, panelZ = 1.65f },
            new Expected { paletteId = "billboard-large", variant = "large", prefab = "BillboardLarge", id = "station.billboard.large", shape = "landscape", posterSlug = "landscape-1-jfif", cells = 2, panelW = 1.86f, panelH = 0.95f, panelZ = 1.7f },
            new Expected { paletteId = "billboard-panorama", variant = "panorama", prefab = "BillboardPanorama", id = "station.billboard.panorama", shape = "panorama", posterSlug = "landscape-1-jfif", cells = 3, panelW = 2.82f, panelH = 0.75f, panelZ = 1.65f },
            new Expected { paletteId = "billboard-portrait", variant = "portrait", prefab = "BillboardPortrait", id = "station.billboard.portrait", shape = "portrait", posterSlug = "portrait-1-jpeg", cells = 1, panelW = 0.8f, panelH = 1.16f, panelZ = 1.7f },
            new Expected { paletteId = "billboard-square", variant = "square", prefab = "BillboardSquare", id = "station.billboard.square", shape = "square", posterSlug = "square-18-jpg", cells = 1, panelW = 0.8f, panelH = 0.8f, panelZ = 1.55f },
            new Expected { paletteId = "billboard-16x9-3m", variant = "16x9-3m", prefab = "Billboard16x9_3m", id = "station.billboard.16x9-3m", shape = "landscape", posterSlug = "landscape-1-jfif", cells = 6, panelW = 2.76f * 16f / 9f, panelH = 2.76f, panelZ = 1.5f, totalHeight = 3f },
            new Expected { paletteId = "billboard-16x9-4m", variant = "16x9-4m", prefab = "Billboard16x9_4m", id = "station.billboard.16x9-4m", shape = "landscape", posterSlug = "landscape-1-jfif", cells = 7, panelW = 3.76f * 16f / 9f, panelH = 3.76f, panelZ = 2f, totalHeight = 4f },
            new Expected { paletteId = "billboard-4x3-3m", variant = "4x3-3m", prefab = "Billboard4x3_3m", id = "station.billboard.4x3-3m", shape = "landscape", posterSlug = "landscape-1-jfif", cells = 4, panelW = 2.76f * 4f / 3f, panelH = 2.76f, panelZ = 1.5f, totalHeight = 3f },
            new Expected { paletteId = "billboard-4x3-4m", variant = "4x3-4m", prefab = "Billboard4x3_4m", id = "station.billboard.4x3-4m", shape = "landscape", posterSlug = "landscape-1-jfif", cells = 6, panelW = 3.76f * 4f / 3f, panelH = 3.76f, panelZ = 2f, totalHeight = 4f },
        };

        /// <summary>The three repository posters the family prints, with their pixel size.</summary>
        private static readonly Dictionary<string, Vector2Int> PosterPixels = new Dictionary<string, Vector2Int>
        {
            { "landscape-1-jfif", new Vector2Int(512, 288) },
            { "portrait-1-jpeg", new Vector2Int(288, 512) },
            { "square-18-jpg", new Vector2Int(384, 384) },
        };

        private class ImportedBillboard
        {
            public Expected expected;
            public Asset manifest;
            public string prefabPath;
            /// <summary>The shader glTFast picked for the unlit poster plate.</summary>
            public string posterShader;
            /// <summary>The imported poster texture size, for the evidence line.</summary>
            public string posterTexture;
        }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            string summaryPath = Path.Combine(evidence, "export", "manifest.json");
            Require(File.Exists(summaryPath), $"Missing {summaryPath}");
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(summaryPath));
            Require(manifest?.assets != null, "Unreadable export manifest");
            Require(manifest.assets.Length == Count, $"Expected {Count} billboard models in the manifest, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.paletteId).Distinct().Count() == Count,
                "The manifest repeats a palette id");
            requireParameters(manifest.parameters);

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var imported = new List<ImportedBillboard>();
            foreach (var expected in ExpectedBillboards)
            {
                var asset = manifest.assets.Single(entry => entry.paletteId == expected.paletteId);
                CheckFamilyParameters(asset, expected, manifest.parameters);
                var billboard = ImportAsset(asset, expected, evidence);
                imported.Add(billboard);
                summary.Add($"{asset.id}={billboard.manifest.triangles}t/{billboard.manifest.materials.Length}m/" +
                            $"{billboard.manifest.textures}tex/{asset.posterSlug}/{billboard.posterTexture}/" +
                            $"{billboard.posterShader}");
            }

            // Unity mints fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene is never byte-identical between two imports. The
            // scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above, so create it only when it is missing and
            // verify its content on every run.
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"ADVERT_IMPORT_OK {imported.Count} models {string.Join(" ", summary)} " +
                      $"row={RowX(0):F1}..{RowX(Count - 1):F1} spacing={Spacing:F1} farPlane={CameraFarPlane:F0}");
        }

        private static void requireParameters(Parameters parameters)
        {
            Require(parameters != null, "The manifest is missing its family parameters");
            Require(parameters.models == Count, $"Expected {Count} family models, got {parameters.models}");
            Require(parameters.rot == 0, $"Expected rot 0 exports, got {parameters.rot}");
            Require(!string.IsNullOrEmpty(parameters.stationData) && parameters.stationData.Contains("empty"),
                "Expected the exports to stand in an empty station document");
            Require(!string.IsNullOrEmpty(parameters.posterRule) && parameters.posterRule.Contains("first AD_POSTERS"),
                "The manifest does not record the fixed poster-slug rule");
            Require(parameters.billboardSpecs != null && parameters.billboardSpecs.Length == Count,
                $"Expected {Count} billboard spec entries, got {parameters.billboardSpecs?.Length ?? 0}");
            Require(parameters.posters != null && parameters.posters.Length == PosterPixels.Count,
                $"Expected {PosterPixels.Count} decoded posters, got {parameters.posters?.Length ?? 0}");
            foreach (var poster in parameters.posters)
            {
                Require(PosterPixels.TryGetValue(poster.slug, out var pixels),
                    $"Unexpected poster slug in the manifest: {poster.slug}");
                Require(poster.width == pixels.x && poster.height == pixels.y,
                    $"{poster.slug}: recorded poster pixels {poster.width}x{poster.height}");
                Require(poster.shapes != null && poster.shapes.Length > 0, $"{poster.slug}: no printed shapes recorded");
            }
        }

        private static void CheckFamilyParameters(Asset asset, Expected expected, Parameters parameters)
        {
            string label = $"{asset.paletteId}: ";
            Require(asset.id == expected.id, $"{label}manifest id {asset.id} != {expected.id}");
            Require(asset.catalogueId == expected.paletteId, $"{label}catalogue id {asset.catalogueId}");
            Require(asset.paletteId == expected.paletteId, $"{label}palette id {asset.paletteId}");
            Require(asset.variant == expected.variant, $"{label}variant {asset.variant}");
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.paletteId + ".glb", $"{label}file {asset.file}");
            Require(asset.shape == expected.shape, $"{label}shape {asset.shape} != {expected.shape}");
            // The fixed campaign: the first catalogue poster that prints this shape.
            Require(asset.posterSlug == expected.posterSlug, $"{label}poster {asset.posterSlug} != {expected.posterSlug}");
            Require(asset.cells == expected.cells, $"{label}cells {asset.cells} != {expected.cells}");
            Near(asset.panelW, expected.panelW, $"{label}panel width");
            Near(asset.panelH, expected.panelH, $"{label}panel height");
            Near(asset.panelZ, expected.panelZ, $"{label}panel centre height");
            Near(asset.totalHeightMetres, expected.totalHeight, $"{label}total height");
            Require(asset.posterImage != null && PosterPixels.TryGetValue(asset.posterSlug, out var pixels) &&
                    asset.posterImage.width == pixels.x && asset.posterImage.height == pixels.y,
                $"{label}poster pixels do not match {asset.posterSlug}");
            Require(asset.materials != null && asset.materials.Length == 3, $"{label}expected three materials");
            Require(asset.alphaMaterials != null && asset.alphaMaterials.Length == 0,
                $"{label}the printed panel must stay opaque");
            Require(asset.textures == PosterTextures, $"{label}expected {PosterTextures} texture, got {asset.textures}");
            Require(asset.triangles == HousingTriangles, $"{label}expected {HousingTriangles} triangles, got {asset.triangles}");
            Require(asset.meshes == HousingMeshes, $"{label}expected {HousingMeshes} meshes, got {asset.meshes}");
            Require(asset.materials.SequenceEqual(new[] { "billboardPoster", "darkSteel", "steel" }),
                $"{label}unexpected material set {string.Join(", ", asset.materials)}");
            Require(asset.placementOffset != null && asset.placementOffset.Length == 3,
                $"{label}manifest is missing the placement offset");
            // `buildBillboard` centres the run on the hovered cell, and
            // `trackOriginForCentre` anchors an even run on its lower-middle cell,
            // so an odd span sits 0.5 m from the cell origin and an even span 1.0 m.
            float runCentre = (expected.cells - 1) / 2f;
            float offsetX = 0.5f + runCentre - Mathf.Floor(runCentre);
            Near(new Vector3(asset.placementOffset[0], asset.placementOffset[1], asset.placementOffset[2]),
                new Vector3(offsetX, 0.5f, 1f), $"{label}placement offset");

            // The manifest bounds have to be the housing the builder draws around
            // this panel: (panel + frame margins) wide, panelZ-centred, with the
            // slab on the -y wall and the lit plate at y = -0.315.
            var sourceMin = SourceMin(expected);
            var sourceMax = SourceMax(expected);
            Near(new Vector3(asset.min[0], asset.min[1], asset.min[2]), sourceMin, $"{label}manifest minimum");
            Near(new Vector3(asset.max[0], asset.max[1], asset.max[2]), sourceMax, $"{label}manifest maximum");

            var parameter = parameters.billboardSpecs.Single(spec => spec.paletteId == expected.paletteId);
            Require(parameter.variant == expected.variant, $"{label}family variant {parameter.variant}");
            Require(parameter.shape == expected.shape, $"{label}family shape {parameter.shape}");
            Require(parameter.posterSlug == expected.posterSlug, $"{label}family poster {parameter.posterSlug}");
            Require(parameter.cells == expected.cells, $"{label}family cells {parameter.cells}");
            Near(parameter.panelW, expected.panelW, $"{label}family panel width");
            Near(parameter.panelH, expected.panelH, $"{label}family panel height");
            Near(parameter.panelZ, expected.panelZ, $"{label}family panel centre height");
            Near(parameter.totalHeightMetres, expected.totalHeight, $"{label}family total height");
        }

        private static ImportedBillboard ImportAsset(Asset asset, Expected expected, string evidence)
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
            Require(filters.Length == asset.meshes, $"{label}: expected {asset.meshes} mesh nodes, got {filters.Length}");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers)
                bounds.Encapsulate(renderer.bounds);
            // The panel spec, not the manifest, is what the bounds are checked
            // against here: the review re-derives the housing from the panel size.
            Near(bounds.min, Basis(SourceMin(expected)), $"{label} minimum bounds");
            Near(bounds.max, Basis(SourceMax(expected)), $"{label} maximum bounds");

            int triangles = filters.Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == HousingTriangles, $"{label}: expected {HousingTriangles} triangles, got {triangles}");
            Require(triangles == asset.triangles, $"{label}: manifest triangle count {asset.triangles} drifted");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            Require(importedMaterials.All(material => material != null), $"{label}: a mesh lost its material");
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(asset.materials),
                $"{label}: unexpected materials {string.Join(", ", materials)}");

            // The housing slab, the steel edge frame and the poster plate are all
            // opaque: the lit face is a printed panel, not a translucent screen.
            foreach (var material in importedMaterials)
            {
                Require(Array.IndexOf(asset.alphaMaterials, material.name) < 0,
                    $"{label}: {material.name} must stay opaque");
                Require(material.renderQueue < (int)RenderQueue.Transparent,
                    $"{label}: {material.name} is not in the opaque queue ({material.renderQueue})");
            }
            var poster = importedMaterials.Single(material => material.name == "billboardPoster");
            Require(poster.renderQueue < (int)RenderQueue.Transparent,
                $"{label}: the printed panel lost its opaque queue ({poster.renderQueue})");

            var textures = importedMaterials
                .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length == PosterTextures,
                $"{label}: expected {PosterTextures} poster texture, got {textures.Length}");
            var posterTexture = textures[0];
            var pixels = PosterPixels[expected.posterSlug];
            // The poster is a real 512x288 / 288x512 / 384x384 photograph; a missing
            // or placeholder map would be null (counted above) or tiny.
            Require(posterTexture.width >= 256 && posterTexture.height >= 128,
                $"{label}: poster texture is only {posterTexture.width}x{posterTexture.height}, expected {pixels.x}x{pixels.y}");
            string posterSize = $"{posterTexture.width}x{posterTexture.height}";

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

            return new ImportedBillboard
            {
                expected = expected,
                manifest = asset,
                prefabPath = prefabPath,
                posterShader = poster.shader != null ? poster.shader.name : "(no shader)",
                posterTexture = posterSize,
            };
        }

        /// <summary>
        /// One review scene: all ten wrapper prefabs in a row on 7.2 m centres,
        /// framed together by a slate-clearing camera whose far plane covers the
        /// ~65 m row. Only called when the scene is missing.
        /// </summary>
        private static void BuildReviewScene(List<ImportedBillboard> billboards)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < billboards.Count; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(billboards[i].prefabPath);
                Require(prefab != null, $"Missing prefab for {billboards[i].manifest.paletteId}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(RowX(i), 0f, 0f);
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

            // Both lights stand on the +z side with the camera: the printed panels
            // are unlit, but the steel edge frames have to read light from the front.
            var key = new GameObject("Key light").AddComponent<Light>();
            key.type = LightType.Directional;
            key.intensity = 2.6f;
            key.transform.rotation = Quaternion.Euler(35f, 150f, 0f);
            var fill = new GameObject("Fill light").AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 1.1f;
            fill.transform.rotation = Quaternion.Euler(16f, 215f, 0f);

            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.5f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the advert review scene");
        }

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: ten prefab
        /// instances linked to the wrapper prefabs at their row positions, the slate
        /// camera with a 200 m far plane and the key light the Web check depends on.
        /// </summary>
        private static void VerifyReviewScene(List<ImportedBillboard> billboards)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            for (int i = 0; i < billboards.Count; i++)
            {
                var billboard = billboards[i];
                var instance = roots.SingleOrDefault(root => root.name == billboard.expected.prefab);
                Require(instance != null, $"Review scene is missing the {billboard.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == billboard.prefabPath,
                    $"{billboard.expected.prefab} is not an instance of {billboard.prefabPath}");
                Near(instance.transform.position, new Vector3(RowX(i), 0f, 0f), $"{billboard.expected.prefab} row placement");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{billboard.expected.prefab} instance has no renderers");
            }
            // 7.2 m centres: the widest panel is the 6.804 m 16x9-4m housing, so the
            // row must not overlap and must span 64.8 m.
            Require(Mathf.Abs((RowX(Count - 1) - RowX(0)) - Spacing * (Count - 1)) < 0.001f,
                "Review row is not on 7.2 m centres");

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(Mathf.Abs(camera.fieldOfView - CameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(Mathf.Abs(camera.farClipPlane - CameraFarPlane) < 0.001f,
                $"Review camera far plane changed ({camera.farClipPlane})");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Near(camera.transform.position, CameraPosition, "Review camera position");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 1, "Review scene is missing its directional key light");
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

        private static float RowX(int index) => (index - (Count - 1) / 2f) * Spacing;

        /// <summary>The housing's source-space minimum for one panel spec.</summary>
        private static Vector3 SourceMin(Expected expected) =>
            new Vector3(-(expected.panelW + (float)FrameWidthMargin) / 2f, (float)HousingMinY,
                expected.panelZ - (expected.panelH + (float)FrameHeightMargin) / 2f);

        /// <summary>The housing's source-space maximum: the lit plate is the +y face.</summary>
        private static Vector3 SourceMax(Expected expected) =>
            new Vector3((expected.panelW + (float)FrameWidthMargin) / 2f, (float)PosterY,
                expected.panelZ + (expected.panelH + (float)FrameHeightMargin) / 2f);

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        private static Vector3 Basis(Vector3 v) => new Vector3(v.x, v.z, v.y);

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        private static void CheckAnchor(GameObject root, string name, Vector3 expected) =>
            Near(FindAnchor(root, name).position, expected, name);

        private static void Near(Vector3 actual, Vector3 expected, string field) =>
            Require(Vector3.Distance(actual, expected) < 0.002f, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Near(float actual, float expected, string field) =>
            Require(Mathf.Abs(actual - expected) < 0.001f, $"{field}: expected {expected:F5}, got {actual:F5}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
