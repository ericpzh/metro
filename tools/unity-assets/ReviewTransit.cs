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
    /// Import the ten transit GLBs exported by export-transit.mjs — escalator, lift,
    /// walkway, the two pillars, the bridge, the road and the three outdoor pieces —
    /// wrap each in a prefab under the Unity gameplay basis, verify the digest,
    /// bounds, triangles, material slots, glass queues, textures and anchors, and
    /// save one review scene with all ten in a row.
    ///
    /// The row is dominated by the 31 m walkway, so the walkway is laid first and
    /// the other nine follow at their own pitch (escalator/lift 12 m, bridge and
    /// road 13 m, pillars and tiles 2 m, tree 4.5 m). The whole row is about 95 m
    /// long; the review camera's far plane is 400 m.
    /// </summary>
    public static class ReviewTransit
    {
        private const string Folder = "Assets/TransitProof";
        private const string Scene = Folder + "/Transit.unity";

        /// <summary>Row order: the walkway first, then the rest of the family.</summary>
        private static readonly string[] RowOrder =
        {
            "station.walkway.standard",
            "station.escalator.standard",
            "station.lift.standard",
            "station.track.bridge",
            "station.road.standard",
            "station.pillar.slim",
            "station.pillar.thick",
            "station.sidewalk.standard",
            "station.lawn.standard",
            "station.tree.standard",
        };

        /// <summary>Row pitch per piece, metres: the space each model is allotted.</summary>
        private static readonly Dictionary<string, float> RowPitch = new Dictionary<string, float>
        {
            { "station.walkway.standard", 31.2f },
            { "station.escalator.standard", 12f },
            { "station.lift.standard", 12f },
            { "station.track.bridge", 13f },
            { "station.road.standard", 13f },
            { "station.pillar.slim", 2f },
            { "station.pillar.thick", 2f },
            { "station.sidewalk.standard", 2f },
            { "station.lawn.standard", 2f },
            { "station.tree.standard", 4.5f },
        };

        /// <summary>The whole row spans about 95 m; 400 m frames the review camera.</summary>
        private const float FarPlane = 400f;

        [Serializable]
        private class Manifest
        {
            public Asset[] assets;
            public Parameters parameters;
        }

        [Serializable]
        private class Parameters
        {
            public float storeyHeightMetres, escalatorRiseMetres, liftSizeMetres, liftIntervalMetres;
            public float walkwayLengthMetres, pillarHeightMetres, pillarSlimWidthMetres, pillarThickWidthMetres;
            public float bridgeWidthMetres, bridgeDepthMetres, roadWidthMetres, roadDepthMetres, surfaceTileMetres;
            public int escalatorRunCells;
            public string escalatorRampLength, walkwayLength, treeDetail;
        }

        [Serializable]
        private class Asset
        {
            public string id, paletteId, kind, file, prefab, sha256, canonicalOrientation;
            public float[] min, max;
            public float modelYawDegrees;
            public int triangles, meshes, textures;
            public string[] materials, alphaMaterials, glassMaterials;
            public Anchors anchors;
            // Canonical placement facts, one subset per kind.
            public float heightMetres, widthMetres, depthMetres, tileMetres, sizeMetres, intervalMetres;
            public float riseMetres, inclineDegrees, lengthMetres;
            public string style;
            public int runCells, widthBlocks;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            var manifest = JsonUtility.FromJson<Manifest>(
                File.ReadAllText(Path.Combine(evidence, "export", "manifest.json")));
            Require(manifest?.assets != null, "The transit manifest has no asset list");
            Require(manifest.assets.Length == 10, $"Expected ten transit models, got {manifest.assets.Length}");

            // Canonical parameters recorded by the exporter. Every one of these is a
            // placement fact the game's own simulation module derives, so a drift in
            // the builder defaults shows up here before anything is promoted.
            var p = manifest.parameters;
            Require(Mathf.Approximately(p.storeyHeightMetres, 5f), $"Unexpected storey height {p.storeyHeightMetres}");
            Require(p.escalatorRampLength == "long", $"Unexpected escalator ramp length {p.escalatorRampLength}");
            Require(Mathf.Approximately(p.escalatorRiseMetres, 5f), $"Unexpected escalator rise {p.escalatorRiseMetres}");
            Require(p.escalatorRunCells == 9, $"Unexpected escalator run {p.escalatorRunCells}");
            Require(Mathf.Approximately(p.walkwayLengthMetres, 30f), $"Unexpected walkway length {p.walkwayLengthMetres}");
            Require(p.walkwayLength == "short", $"Unexpected walkway length token {p.walkwayLength}");
            Require(Mathf.Approximately(p.liftSizeMetres, 2f), $"Unexpected lift size {p.liftSizeMetres}");
            Require(Mathf.Approximately(p.liftIntervalMetres, 5f), $"Unexpected lift interval {p.liftIntervalMetres}");
            Require(Mathf.Approximately(p.pillarHeightMetres, 5f), $"Unexpected pillar height {p.pillarHeightMetres}");
            Require(Mathf.Approximately(p.pillarSlimWidthMetres, 0.3f), $"Unexpected slim pillar width {p.pillarSlimWidthMetres}");
            Require(Mathf.Approximately(p.pillarThickWidthMetres, 1f), $"Unexpected thick pillar width {p.pillarThickWidthMetres}");
            Require(Mathf.Approximately(p.bridgeWidthMetres, 12f), $"Unexpected bridge width {p.bridgeWidthMetres}");
            Require(Mathf.Approximately(p.bridgeDepthMetres, 3f), $"Unexpected bridge depth {p.bridgeDepthMetres}");
            Require(Mathf.Approximately(p.roadWidthMetres, 6f), $"Unexpected road width {p.roadWidthMetres}");
            Require(Mathf.Approximately(p.roadDepthMetres, 12f), $"Unexpected road depth {p.roadDepthMetres}");
            Require(Mathf.Approximately(p.surfaceTileMetres, 1f), $"Unexpected surface tile {p.surfaceTileMetres}");
            Require(!string.IsNullOrEmpty(p.treeDetail) && p.treeDetail.Contains("full-detail"),
                $"Unexpected tree detail {p.treeDetail}");

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            foreach (var asset in manifest.assets)
            {
                CheckCanonical(asset);

                string model = $"{Folder}/{asset.file}";
                byte[] bytes = File.ReadAllBytes(Path.Combine(evidence, "export", asset.file));
                string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                Require(digest == asset.sha256, $"{asset.id}: GLB digest differs from the validated manifest");
                if (!File.Exists(model) || !bytes.SequenceEqual(File.ReadAllBytes(model)))
                    File.WriteAllBytes(model, bytes);

                AssetDatabase.ImportAsset(model, ImportAssetOptions.ForceSynchronousImport);
                var imported = AssetDatabase.LoadAssetAtPath<GameObject>(model);
                Require(imported != null, $"{asset.id}: glTFast did not produce a model");

                // Build the wrapper prefab in a clean scene: basis parent rotated
                // 180 degrees about Y, as in ReviewBench/ReviewCctv/ReviewStair.
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
                var root = new GameObject(Path.GetFileNameWithoutExtension(asset.prefab));
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
                Require(renderers.Length > 0, $"{asset.id}: imported model has no mesh renderers");
                var bounds = renderers[0].bounds;
                foreach (var renderer in renderers)
                    bounds.Encapsulate(renderer.bounds);
                Near(bounds.min, Basis(asset.min), $"{asset.id} minimum bounds");
                Near(bounds.max, Basis(asset.max), $"{asset.id} maximum bounds");

                int triangles = root.GetComponentsInChildren<MeshFilter>().Sum(filter => filter.sharedMesh.triangles.Length / 3);
                Require(triangles == asset.triangles,
                    $"{asset.id}: expected {asset.triangles} triangles, got {triangles}");

                var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
                var materials = importedMaterials.Select(material => material.name)
                    .OrderBy(name => name, StringComparer.Ordinal).ToArray();
                Require(materials.SequenceEqual(asset.materials),
                    $"{asset.id}: unexpected materials {string.Join(", ", materials)}");

                // Glass must keep the transparent queue: the escalator/walkway
                // balustrades and the lift's glazed shaft/car are the family's only
                // alpha surfaces.
                foreach (var glassName in asset.glassMaterials)
                {
                    var glass = importedMaterials.Single(material => material.name == glassName);
                    bool transparent = Array.IndexOf(asset.alphaMaterials, glassName) >= 0;
                    if (transparent)
                        Require(glass.renderQueue >= (int)RenderQueue.Transparent,
                            $"{asset.id}: {glassName} lost its transparent queue ({glass.renderQueue})");
                    else
                        Require(glass.renderQueue < (int)RenderQueue.Transparent,
                            $"{asset.id}: {glassName} should be opaque ({glass.renderQueue})");
                }

                var textures = importedMaterials
                    .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                    .Where(texture => texture != null).Distinct().ToArray();
                Require(textures.Length == asset.textures,
                    $"{asset.id}: expected {asset.textures} textures, got {textures.Length}");

                var front = FindAnchor(root, "Front");
                var approach = FindAnchor(root, "Approach");
                for (int i = 0; i < 4; i++)
                {
                    var rotation = Quaternion.Euler(0, i * 90, 0);
                    root.transform.rotation = rotation;
                    Near(front.position, rotation * Vector3.forward, $"{asset.id} front at facing {i}");
                    Near(approach.position, rotation * Vector3.back, $"{asset.id} approach at facing {i}");
                }
                root.transform.rotation = Quaternion.identity;

                string prefabPath = $"{Folder}/{asset.prefab}";
                Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null,
                    $"{asset.id}: could not save wrapper prefab");
                UnityEngine.Object.DestroyImmediate(root);

                summary.Add($"{asset.kind}={triangles}t/{asset.materials.Length}m/{asset.alphaMaterials.Length}a");
            }

            // Unity assigns fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene would never be byte-identical between two imports.
            // The scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above and referenced by GUID, so keep the first
            // generated scene and only create it when it is missing.
            if (!File.Exists(Scene))
                BuildReviewScene(manifest.assets);

            Debug.Log($"TRANSIT_IMPORT_OK {manifest.assets.Length} models {string.Join(" ", summary)} row=0..95");
        }

        /// <summary>The canonical parameters each model's manifest entry has to carry.</summary>
        private static void CheckCanonical(Asset asset)
        {
            switch (asset.kind)
            {
                case "escalator":
                    Require(asset.modelYawDegrees == -90f, $"{asset.id}: unexpected belt yaw {asset.modelYawDegrees}");
                    Require(asset.widthBlocks == 1, $"{asset.id}: unexpected width {asset.widthBlocks}");
                    Require(Mathf.Approximately(asset.inclineDegrees, 30f), $"{asset.id}: unexpected incline {asset.inclineDegrees}");
                    Require(asset.runCells == 9, $"{asset.id}: unexpected run {asset.runCells}");
                    Require(Mathf.Approximately(asset.riseMetres, 5f), $"{asset.id}: unexpected rise {asset.riseMetres}");
                    break;
                case "walkway":
                    Require(asset.modelYawDegrees == -90f, $"{asset.id}: unexpected belt yaw {asset.modelYawDegrees}");
                    Require(asset.widthBlocks == 1, $"{asset.id}: unexpected width {asset.widthBlocks}");
                    Require(Mathf.Approximately(asset.lengthMetres, 30f), $"{asset.id}: unexpected length {asset.lengthMetres}");
                    break;
                case "lift":
                    Require(asset.style == "glass", $"{asset.id}: unexpected style {asset.style}");
                    Require(Mathf.Approximately(asset.sizeMetres, 2f), $"{asset.id}: unexpected size {asset.sizeMetres}");
                    Require(Mathf.Approximately(asset.intervalMetres, 5f), $"{asset.id}: unexpected interval {asset.intervalMetres}");
                    break;
                case "pillar-slim":
                    Require(asset.modelYawDegrees == 0f, $"{asset.id}: unexpected yaw {asset.modelYawDegrees}");
                    Require(Mathf.Approximately(asset.heightMetres, 5f), $"{asset.id}: unexpected height {asset.heightMetres}");
                    Require(Mathf.Approximately(asset.widthMetres, 0.3f), $"{asset.id}: unexpected width {asset.widthMetres}");
                    break;
                case "pillar-thick":
                    Require(Mathf.Approximately(asset.heightMetres, 5f), $"{asset.id}: unexpected height {asset.heightMetres}");
                    Require(Mathf.Approximately(asset.widthMetres, 1f), $"{asset.id}: unexpected width {asset.widthMetres}");
                    break;
                case "bridge":
                    Require(Mathf.Approximately(asset.widthMetres, 12f), $"{asset.id}: unexpected width {asset.widthMetres}");
                    Require(Mathf.Approximately(asset.depthMetres, 3f), $"{asset.id}: unexpected depth {asset.depthMetres}");
                    break;
                case "road":
                    Require(Mathf.Approximately(asset.widthMetres, 6f), $"{asset.id}: unexpected width {asset.widthMetres}");
                    Require(Mathf.Approximately(asset.depthMetres, 12f), $"{asset.id}: unexpected depth {asset.depthMetres}");
                    break;
                case "sidewalk":
                case "lawn":
                    Require(Mathf.Approximately(asset.tileMetres, 1f), $"{asset.id}: unexpected tile {asset.tileMetres}");
                    break;
                case "tree":
                    Require(Mathf.Approximately(asset.heightMetres, 4.5f), $"{asset.id}: unexpected height {asset.heightMetres}");
                    break;
                default:
                    Require(false, $"{asset.id}: unknown transit kind {asset.kind}");
                    break;
            }
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
        /// One review scene: the 31 m walkway first, then the other nine pieces at
        /// their own pitch, framed together. The row spans about 95 m, so the camera
        /// sits far back with a 400 m far plane. Only called when the scene does not
        /// exist (see the note in Import).
        /// </summary>
        private static void BuildReviewScene(Asset[] assets)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            float cursor = 0f;
            foreach (var id in RowOrder)
            {
                var asset = assets.Single(a => a.id == id);
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>($"{Folder}/{asset.prefab}");
                Require(prefab != null, $"Missing prefab for {asset.id}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.name = Path.GetFileNameWithoutExtension(asset.prefab);
                // Each piece's own left edge starts its slot; the pivot is wherever
                // the builder put it inside the bounds.
                instance.transform.position = new Vector3(cursor - asset.min[0], 0, 0);
                instance.transform.rotation = Quaternion.identity;
                float width = asset.max[0] - asset.min[0];
                cursor += Mathf.Max(RowPitch[id], width + 0.35f);
            }

            float centre = cursor / 2f;
            var camera = new GameObject("Review camera").AddComponent<Camera>();
            // High enough to read the deck surfaces (the 12 m road depth, the
            // bridge trough and the walkway band) rather than edge-on, and close
            // enough that the ~93 m row still spans nine tenths of the frame.
            camera.transform.position = new Vector3(centre, 30f, -102f);
            camera.transform.LookAt(new Vector3(centre, 1.6f, 0));
            camera.fieldOfView = 35;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = FarPlane;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.22f, 0.30f, 0.38f);

            var light = new GameObject("Key light").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 2.4f;
            light.transform.rotation = Quaternion.Euler(35, -35, 0);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.4f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the transit review scene");
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
