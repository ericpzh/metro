// Unity review for the `light` family: both ceiling-light variants from one
// evidence directory.
//
//   Metro.AssetExample.ReviewLight.Import()   imports the two GLBs, verifies the
//                                             digests, bounds, triangles,
//                                             materials, anchors, four facings
//                                             and the diffuser's emission, then
//                                             writes LightCircular.prefab,
//                                             LightRectangular.prefab and one
//                                             review scene (Light.unity).
//   Metro.AssetExample.ReviewLight.BuildWeb() builds that scene un-compressed.
//
// Run through tools/unity-assets/prove-model.ps1 -Family light, which sets
// METRO_BENCH_PROOF to the evidence directory and METRO_BENCH_WEB to its `web`
// folder. The wrapper prefab puts the 180° Y basis correction on a parent of the
// imported model, exactly like ReviewBench and ReviewBin.
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
    public static class ReviewLight
    {
        private const string Folder = "Assets/LightProof";
        private const string Scene = Folder + "/Light.unity";

        // glTFast names its shader properties after the glTF keys: the diffuser's
        // emission is `emissiveFactor` (an HDR colour), not Unity's `_EmissionColor`.
        // The palette material is a lit standard material with an emissive factor,
        // not an unlit/basic one, so both facts are asserted below.
        private const string EmissiveProperty = "emissiveFactor";
        private const string MetallicProperty = "metallicFactor";

        [Serializable]
        private class Summary
        {
            public string family, source, basisId;
            public Variant[] variants;
        }

        [Serializable]
        private class Variant
        {
            public string id, catalogueId, variant, file, prefab, sha256, facade;
            public float[] placementOffset, min, max, size;
            public int triangles, textures;
            public string[] materials, alphaMaterials;
            public Anchors anchors;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up; }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            string export = Path.Combine(evidence, "export");
            var summary = JsonUtility.FromJson<Summary>(File.ReadAllText(Path.Combine(export, "manifest.json")));
            Require(summary != null && summary.variants != null && summary.variants.Length == 2,
                "Expected two light variants in the export manifest");
            Require(summary.family == "light", $"Unexpected family {summary.family}");

            Directory.CreateDirectory(Folder);
            var measurements = new List<string>();
            foreach (var manifest in summary.variants)
            {
                byte[] bytes = File.ReadAllBytes(Path.Combine(export, manifest.file));
                string digest = Digest(bytes);
                Require(digest == manifest.sha256, $"{manifest.id}: GLB digest differs from the validated manifest");

                string model = Folder + "/" + manifest.file;
                if (!File.Exists(model) || !bytes.SequenceEqual(File.ReadAllBytes(model)))
                    File.WriteAllBytes(model, bytes);
                AssetDatabase.ImportAsset(model, ImportAssetOptions.ForceSynchronousImport);
                var imported = AssetDatabase.LoadAssetAtPath<GameObject>(model);
                Require(imported != null, $"{manifest.id}: glTFast did not produce a model");

                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
                var root = new GameObject(manifest.variant == "circular" ? "Circular ceiling light" : "Rectangular ceiling light");
                var orientation = new GameObject("Unity basis").transform;
                orientation.SetParent(root.transform, false);
                PrefabUtility.InstantiatePrefab(imported, orientation);
                // Export rotates source Z-up to glTF Y-up, then glTFast reflects X.
                // The wrapper turns X and Z back to the gameplay convention (x, z, y).
                orientation.localRotation = Quaternion.Euler(0, 180, 0);

                CheckAnchor(root, "AxisX", Basis(manifest.anchors.AxisX), manifest.id);
                CheckAnchor(root, "Front", Basis(manifest.anchors.Front), manifest.id);
                CheckAnchor(root, "Up", Basis(manifest.anchors.Up), manifest.id);

                var renderers = root.GetComponentsInChildren<MeshRenderer>();
                Require(renderers.Length > 0, $"{manifest.id}: imported model has no mesh renderers");
                var bounds = renderers[0].bounds;
                foreach (var renderer in renderers)
                    bounds.Encapsulate(renderer.bounds);
                Near(bounds.min, Basis(manifest.min), $"{manifest.id}: minimum bounds");
                Near(bounds.max, Basis(manifest.max), $"{manifest.id}: maximum bounds");
                int triangles = root.GetComponentsInChildren<MeshFilter>().Sum(filter => filter.sharedMesh.triangles.Length / 3);
                Require(triangles == manifest.triangles, $"{manifest.id}: expected {manifest.triangles} triangles, got {triangles}");

                var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
                var materials = importedMaterials.Select(material => material.name)
                    .OrderBy(name => name, StringComparer.Ordinal).ToArray();
                Require(materials.SequenceEqual(manifest.materials),
                    $"{manifest.id}: unexpected materials {string.Join(", ", materials)}");
                Require(manifest.alphaMaterials.Length == 0, $"{manifest.id}: a ceiling light has no alpha material");
                Require(importedMaterials.All(material => material.renderQueue <= (int)RenderQueue.GeometryLast),
                    $"{manifest.id}: unexpected transparent material on an opaque fitting");

                // The diffuser is the piece's whole point: a lit material with a strong
                // emissive factor. Reading the glTF property names is what makes this a
                // real check of the palette material rather than a hard-coded shader guess.
                var diffuser = importedMaterials.Single(material => material.name == "lightDiffuser");
                Require(diffuser.HasProperty(EmissiveProperty), $"{manifest.id}: lightDiffuser has no {EmissiveProperty} property");
                Color emission = diffuser.GetColor(EmissiveProperty);
                float glow = Mathf.Max(emission.r, Mathf.Max(emission.g, emission.b));
                Require(glow > 0.5f, $"{manifest.id}: lightDiffuser is not emissive (max channel {glow:F3})");
                Require(!diffuser.shader.name.Contains("Unlit"),
                    $"{manifest.id}: lightDiffuser must be a lit material, got shader {diffuser.shader.name}");
                var steel = importedMaterials.Single(material => material.name == "steel");
                Require(steel.HasProperty(EmissiveProperty) || steel.HasProperty(MetallicProperty),
                    $"{manifest.id}: steel lost its standard properties");
                if (steel.HasProperty(EmissiveProperty))
                {
                    Color steelEmission = steel.GetColor(EmissiveProperty);
                    Require(Mathf.Max(steelEmission.r, Mathf.Max(steelEmission.g, steelEmission.b)) < 0.05f,
                        $"{manifest.id}: steel must not glow");
                }
                if (steel.HasProperty(MetallicProperty))
                    Require(steel.GetFloat(MetallicProperty) > 0.5f, $"{manifest.id}: steel lost its metallic response");

                var front = FindAnchor(root, "Front");
                var up = FindAnchor(root, "Up");
                for (int i = 0; i < 4; i++)
                {
                    var rotation = Quaternion.Euler(0, i * 90, 0);
                    root.transform.rotation = rotation;
                    Near(front.position, rotation * Vector3.forward, $"{manifest.id}: front at facing {i}");
                    Near(up.position, rotation * Vector3.up, $"{manifest.id}: up at facing {i}");
                }
                root.transform.rotation = Quaternion.identity;

                string prefab = Folder + "/" + manifest.prefab;
                Require(PrefabUtility.SaveAsPrefabAsset(root, prefab) != null, $"{manifest.id}: could not save wrapper prefab");
                UnityEngine.Object.DestroyImmediate(root);

                measurements.Add($"{manifest.id} size={bounds.size.x:F3}x{bounds.size.y:F3}x{bounds.size.z:F3} " +
                    $"tris={triangles} mats={materials.Length} glow={glow:F2}");
            }

            BuildReviewScene(summary);

            Debug.Log($"LIGHT_IMPORT_OK {string.Join(" | ", measurements)} scene={Scene}");
        }

        private static readonly Color Background = new Color(0.22f, 0.30f, 0.38f);
        private static readonly Vector3[] ScenePositions = { new Vector3(-0.62f, 0, 0), new Vector3(0.62f, 0, 0) };

        private static void BuildReviewScene(Summary summary)
        {
            // Rebuild and re-save on every import: Unity gives runtime-created scene
            // objects fresh local file IDs, so the file is not byte-stable by design
            // (the proof runner therefore fingerprints only GLB/prefab/meta bytes).
            // The saved scene's content is verified below instead.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            // Both wrappers hang at their moulded 3.92-4.00 m local height, so the
            // scene camera looks up at them from a three-quarter angle below: the
            // luminous face points down and must stay visible.
            for (int i = 0; i < summary.variants.Length; i++)
            {
                string path = Folder + "/" + summary.variants[i].prefab;
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                Require(prefab != null, $"Missing wrapper prefab {path}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = ScenePositions[i];
            }

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = new Vector3(0.35f, 1.35f, 2.55f);
            camera.transform.LookAt(new Vector3(0, 3.96f, 0));
            camera.fieldOfView = 45f;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 50f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Background;

            // A single key from below-front so the steel rim reads without washing
            // out the emissive diffuser; ambient keeps the housings out of black.
            var key = new GameObject("Key light").AddComponent<Light>();
            key.type = LightType.Directional;
            key.intensity = 2f;
            key.transform.rotation = Quaternion.Euler(-38, 18, 0);
            var fill = new GameObject("Fill light").AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 0.7f;
            fill.transform.rotation = Quaternion.Euler(24, 200, 0);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.45f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene), "Could not save the light review scene");
            VerifyReviewScene(summary);
        }

        /// <summary>
        /// Reopen the scene that was just saved and prove it carries what the Web
        /// check photographs: one instance of each wrapper prefab at its framing
        /// position, the full model (triangles and both materials), an emissive
        /// diffuser, two directional lights and a solid-colour review camera that
        /// actually contains both pieces in its frustum.
        /// </summary>
        private static void VerifyReviewScene(Summary summary)
        {
            var scene = EditorSceneManager.OpenScene(Scene);
            var roots = scene.GetRootGameObjects();
            Require(roots.Length == summary.variants.Length + 3,
                $"Expected {summary.variants.Length + 3} review-scene roots, found {roots.Length}");

            var camera = UnityEngine.Object.FindFirstObjectByType<Camera>();
            Require(camera != null, "Review scene has no camera");
            Require(camera.clearFlags == CameraClearFlags.SolidColor &&
                Vector4.Distance(camera.backgroundColor, Background) < 0.001f,
                "Review camera lost its solid review background");
            var planes = GeometryUtility.CalculateFrustumPlanes(camera);

            for (int i = 0; i < summary.variants.Length; i++)
            {
                var manifest = summary.variants[i];
                string expected = Folder + "/" + manifest.prefab;
                var instance = roots.FirstOrDefault(root =>
                    PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(root) == expected);
                Require(instance != null, $"Review scene is missing the {manifest.prefab} instance");
                Near(instance.transform.position, ScenePositions[i], $"{manifest.id}: review-scene position");

                var renderers = instance.GetComponentsInChildren<MeshRenderer>();
                var bounds = renderers[0].bounds;
                foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
                Require(GeometryUtility.TestPlanesAABB(planes, bounds),
                    $"{manifest.id}: review camera does not frame the piece");

                int triangles = instance.GetComponentsInChildren<MeshFilter>()
                    .Sum(filter => filter.sharedMesh.triangles.Length / 3);
                Require(triangles == manifest.triangles,
                    $"{manifest.id}: review scene carries {triangles} triangles, expected {manifest.triangles}");
                var sceneMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials)
                    .Select(material => material.name).Distinct()
                    .OrderBy(name => name, StringComparer.Ordinal).ToArray();
                Require(sceneMaterials.SequenceEqual(manifest.materials),
                    $"{manifest.id}: review scene materials {string.Join(", ", sceneMaterials)}");

                var diffuser = renderers.SelectMany(renderer => renderer.sharedMaterials)
                    .First(material => material.name == "lightDiffuser");
                Require(diffuser.HasProperty(EmissiveProperty) &&
                    diffuser.GetColor(EmissiveProperty).maxColorComponent > 0.5f,
                    $"{manifest.id}: review scene lost the diffuser's emission");
            }

            var lights = UnityEngine.Object.FindObjectsByType<Light>(FindObjectsSortMode.None);
            Require(lights.Length == 2 && lights.All(light => light.type == LightType.Directional),
                "Review scene must contain the two directional review lights");
            Debug.Log($"LIGHT_SCENE_OK {Scene} roots={roots.Length} variants={summary.variants.Length} camera={camera.transform.position}");
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

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        private static string Digest(byte[] bytes) =>
            BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        private static void CheckAnchor(GameObject root, string name, Vector3 expected, string id) =>
            Near(FindAnchor(root, name).position, expected, $"{id}: anchor {name}");

        private static void Near(Vector3 actual, Vector3 expected, string field) =>
            Require(Vector3.Distance(actual, expected) < 0.001f, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
