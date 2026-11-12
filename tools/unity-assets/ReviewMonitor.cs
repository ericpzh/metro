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
    public static class ReviewMonitor
    {
        private const string Folder = "Assets/MonitorProof";
        private const string Scene = Folder + "/Monitor.unity";

        [Serializable]
        private class Summary
        {
            public Variant[] variants;
        }

        [Serializable]
        private class Variant
        {
            public string id, catalogueId, variant, file, prefab, manifest, validation, sha256;
            public float[] min, max;
            public int triangles, textures;
            public string[] materials, alphaMaterials;
            public Anchors anchors;
            public Parameters parameters;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up; }

        [Serializable]
        private class Parameters
        {
            public string mount;
            public float panelWidthM, panelHeightM, cabinetWidthM;
            public int panelColumns, panelRows, panelCount;
        }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            var summary = JsonUtility.FromJson<Summary>(
                File.ReadAllText(Path.Combine(evidence, "export", "manifest.json")));
            Require(summary?.variants != null && summary.variants.Length == 2,
                "Monitor export summary must carry the ceiling and wall variants");

            Directory.CreateDirectory(Folder);
            var measurements = new List<string>();
            foreach (var variant in summary.variants)
            {
                var manifest = JsonUtility.FromJson<Variant>(
                    File.ReadAllText(Path.Combine(evidence, "export", variant.manifest)));
                Require(manifest.id == variant.id && manifest.sha256 == variant.sha256,
                    $"{variant.file}: summary and variant manifest disagree");

                byte[] bytes = File.ReadAllBytes(Path.Combine(evidence, "export", variant.file));
                string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                Require(digest == manifest.sha256, $"{variant.file}: GLB digest differs from the validated manifest");

                var modelPath = Folder + "/" + variant.file;
                if (!File.Exists(modelPath) || !bytes.SequenceEqual(File.ReadAllBytes(modelPath)))
                    File.WriteAllBytes(modelPath, bytes);
                AssetDatabase.ImportAsset(modelPath, ImportAssetOptions.ForceSynchronousImport);
                var imported = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
                Require(imported != null, $"glTFast did not produce {variant.file}");

                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
                var root = new GameObject("Monitor " + variant.variant);
                var orientation = new GameObject("Unity basis").transform;
                orientation.SetParent(root.transform, false);
                PrefabUtility.InstantiatePrefab(imported, orientation);
                // Export rotates source Z-up to glTF Y-up, then glTFast reflects X.
                // The wrapper turns X and Z back to the gameplay convention (x,z,y).
                orientation.localRotation = Quaternion.Euler(0, 180, 0);
                CheckAnchor(root, "AxisX", Basis(manifest.anchors.AxisX));
                CheckAnchor(root, "Front", Basis(manifest.anchors.Front));
                CheckAnchor(root, "Up", Basis(manifest.anchors.Up));

                var renderers = root.GetComponentsInChildren<MeshRenderer>();
                Require(renderers.Length > 0, $"{variant.file}: imported model has no mesh renderers");
                var bounds = renderers[0].bounds;
                foreach (var renderer in renderers)
                    bounds.Encapsulate(renderer.bounds);
                Near(bounds.min, Basis(manifest.min), $"{variant.file} minimum bounds");
                Near(bounds.max, Basis(manifest.max), $"{variant.file} maximum bounds");

                int triangles = root.GetComponentsInChildren<MeshFilter>()
                    .Sum(filter => filter.sharedMesh.triangles.Length / 3);
                Require(triangles == manifest.triangles,
                    $"{variant.file}: expected {manifest.triangles} triangles, got {triangles}");

                var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials)
                    .Distinct().ToArray();
                var materials = importedMaterials.Select(material => material.name)
                    .OrderBy(name => name, StringComparer.Ordinal).ToArray();
                Require(materials.SequenceEqual(manifest.materials),
                    $"{variant.file}: unexpected materials: {string.Join(", ", materials)}");
                Require(manifest.alphaMaterials == null || manifest.alphaMaterials.Length == 0,
                    $"{variant.file}: unexpected alpha materials in manifest");
                Require(importedMaterials.All(material => material.renderQueue < (int)RenderQueue.Transparent),
                    $"{variant.file}: an opaque material was imported on the transparent queue");
                var textures = importedMaterials.SelectMany(material =>
                        material.GetTexturePropertyNames().Select(material.GetTexture))
                    .Where(texture => texture != null).Distinct().ToArray();
                Require(textures.Length >= manifest.textures,
                    $"{variant.file}: expected at least {manifest.textures} textures, got {textures.Length}");

                Require(manifest.parameters.panelCount == manifest.parameters.panelColumns * manifest.parameters.panelRows,
                    $"{variant.file}: panel count is not columns x rows");
                Require(manifest.parameters.panelColumns ==
                        Mathf.RoundToInt(manifest.parameters.cabinetWidthM / manifest.parameters.panelWidthM),
                    $"{variant.file}: panel columns are not width-driven");

                var front = FindAnchor(root, "Front");
                var axisX = FindAnchor(root, "AxisX");
                var up = FindAnchor(root, "Up");
                var frontLocal = Basis(manifest.anchors.Front);
                var axisXLocal = Basis(manifest.anchors.AxisX);
                var upLocal = Basis(manifest.anchors.Up);
                for (int i = 0; i < 4; i++)
                {
                    var rotation = Quaternion.Euler(0, i * 90, 0);
                    root.transform.rotation = rotation;
                    Near(front.position, rotation * frontLocal, $"{variant.file} front at facing {i}");
                    Near(axisX.position, rotation * axisXLocal, $"{variant.file} AxisX at facing {i}");
                    Near(up.position, rotation * upLocal, $"{variant.file} Up at facing {i}");
                }
                root.transform.rotation = Quaternion.identity;

                var prefabPath = Folder + "/" + variant.prefab;
                Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null,
                    $"Could not save wrapper prefab {variant.prefab}");
                UnityEngine.Object.DestroyImmediate(root);

                measurements.Add(
                    $"{variant.variant} size={bounds.size.x:F3}x{bounds.size.y:F3}x{bounds.size.z:F3} " +
                    $"triangles={triangles} materials={materials.Length} textures={textures.Length} " +
                    $"panels={manifest.parameters.panelColumns}x{manifest.parameters.panelRows}");
            }

            // One review scene holds both wrapper prefabs. The ceiling cabinet's
            // viewing face is local -y (Unity -Z); the wall board faces local +y
            // (Unity +Z), so its instance is turned a half turn to face the camera.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var wallPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(Folder + "/MonitorWall.prefab");
            var ceilingPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(Folder + "/MonitorCeiling.prefab");
            Require(wallPrefab != null && ceilingPrefab != null, "Could not load the monitor wrapper prefabs");

            // A fresh scene save mints random fileIDs for the camera, lights and
            // prefab instances, so rewriting it on every import changes bytes
            // that carry no asset meaning. The wrapper prefabs above are
            // regenerated byte-identically and keep their GUIDs, so write the
            // review scene once and leave it alone on the repeat import.
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(Scene) == null)
            {
            var wall = (GameObject)PrefabUtility.InstantiatePrefab(wallPrefab);
            wall.transform.position = new Vector3(-1.9f, 0, 0);
            wall.transform.rotation = Quaternion.Euler(0, 180, 0);
            var ceiling = (GameObject)PrefabUtility.InstantiatePrefab(ceilingPrefab);
            ceiling.transform.position = new Vector3(1.9f, 0, 0);

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = new Vector3(0, 2.3f, -10);
            camera.transform.LookAt(new Vector3(0, 2.3f, 0));
            camera.orthographic = true;
            camera.orthographicSize = 2.4f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.55f, 0.58f, 0.62f);
            var key = new GameObject("Key light").AddComponent<Light>();
            key.type = LightType.Directional;
            key.intensity = 2.2f;
            // Shine from the camera's side (+Z) onto the fronts that face -Z.
            key.transform.rotation = Quaternion.Euler(28, 0, 0);
            var fill = new GameObject("Fill light").AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 0.8f;
            fill.transform.rotation = Quaternion.Euler(12, 180, 0);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.55f;
            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the monitor review scene");
            }
            Debug.Log($"MONITOR_IMPORT_OK {string.Join(" | ", measurements)}");
        }

        public static void BuildWeb()
        {
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.decompressionFallback = false;
            PlayerSettings.WebGL.template = "APPLICATION:Default";
            var report = BuildPipeline.BuildPlayer(
                new[] { Scene }, Environment.GetEnvironmentVariable("METRO_BENCH_WEB"),
                BuildTarget.WebGL, BuildOptions.None);
            Require(report.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded,
                report.summary.result.ToString());
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
