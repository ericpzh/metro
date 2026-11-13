using System;
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
    /// Import the ten 开口 (opening) GLBs exported by export-opening.mjs: six swing
    /// doors, two fare gates and two cubicles. Each model is wrapped in a prefab that
    /// keeps the imported hierarchy (the leaf pivots are not flattened), and the whole
    /// family is laid out in one review scene.
    /// </summary>
    public static class ReviewOpening
    {
        private const string Folder = "Assets/OpeningProof";
        private const string Scene = Folder + "/Opening.unity";

        /// <summary>Row pitch; the row is centred on the origin.</summary>
        private const float Spacing = 2.4f;

        [Serializable]
        private class Manifest
        {
            public Asset[] assets;
            public Parameters parameters;
        }

        [Serializable]
        private class Parameters
        {
            public float rotation;
            public float[] doorSpansMetres;
            public float doorPanelHeightMetres, doorLeafHeightMetres, doorThresholdMetres, doorPostDepthMetres, doorLeafMetres;
            public int doorSingleLeafCount, doorDoubleLeafCount;
            public float gateBodyWidthMetres, gateBodyDepthMetres, gateHeightMetres;
            public string gateDir, gateDoor, gateMachineHalf;
            public string[] gateLanePanels;
            public int cubiclePartitions;
            public float cubiclePartitionHeightMetres, cubicleDoorWidthMetres, cubicleDoorHeightMetres;
        }

        [Serializable]
        private class Asset
        {
            public string id, paletteId, prefab, file, sha256, kind, variant, material, machineSide, leafPivot;
            public float[] min, max;
            public int triangles, meshes, textures, leaves, partitions;
            public float spanMetres, openingMetres, panelHeightMetres, leafHeightMetres;
            public float bodyWidthMetres, bodyDepthMetres, bodyCentreX, heightMetres, laneWidthMetres;
            public float partitionHeightMetres, doorWidthMetres, doorHeightMetres;
            public string[] materials, alphaMaterials, glassMaterials, lanePanelTextures;
            public Anchors anchors;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            var manifest = JsonUtility.FromJson<Manifest>(
                File.ReadAllText(Path.Combine(evidence, "export", "manifest.json")));
            Require(manifest?.assets != null, "The opening manifest has no assets");
            Require(manifest.assets.Length == 10, $"Expected ten opening models, found {manifest.assets.Length}");

            var parameters = manifest.parameters;
            Require(parameters != null, "The opening manifest has no parameters");
            // Family parameters: the sizes the source builders authored, so a silent
            // change in sim/doors.ts, GateModel.ts or CubicleModel.ts fails here.
            Require(parameters.rotation == 0f, $"Unexpected rotation {parameters.rotation}");
            Require(parameters.doorSpansMetres.SequenceEqual(new[] { 1f, 2f }),
                $"Unexpected door spans {string.Join(", ", parameters.doorSpansMetres)}");
            Close(parameters.doorPanelHeightMetres, 1.99f, "door panel height");
            Close(parameters.doorLeafHeightMetres, 1.88f, "door leaf height");
            Close(parameters.doorThresholdMetres, 0.04f, "door threshold");
            Close(parameters.doorPostDepthMetres, 0.18f, "door post depth");
            Require(parameters.doorSingleLeafCount == 1 && parameters.doorDoubleLeafCount == 2,
                "Unexpected door leaf counts");
            Close(parameters.gateBodyWidthMetres, 0.30f, "gate body width");
            Close(parameters.gateBodyDepthMetres, 0.90f, "gate body depth");
            Close(parameters.gateHeightMetres, 1.02f, "gate height");
            Require(parameters.gateDir == "both", $"Unexpected gate direction {parameters.gateDir}");
            Require(parameters.gateDoor == "lane", $"Unexpected gate piece {parameters.gateDoor}");
            Require(parameters.gateMachineHalf == "local -x", $"Unexpected machine half {parameters.gateMachineHalf}");
            Require(parameters.gateLanePanels.SequenceEqual(new[] { "gatePanel", "gatePanelBack" }),
                $"Unexpected lane panels {string.Join(", ", parameters.gateLanePanels)}");
            Require(parameters.cubiclePartitions == 3, "Unexpected cubicle partition count");
            Close(parameters.cubiclePartitionHeightMetres, 1.80f, "cubicle partition height");
            Close(parameters.cubicleDoorWidthMetres, 0.802f, "cubicle door width");
            Close(parameters.cubicleDoorHeightMetres, 1.75f, "cubicle door height");

            Directory.CreateDirectory(Folder);
            var summary = new System.Collections.Generic.List<string>();
            foreach (var asset in manifest.assets)
            {
                string model = $"{Folder}/{asset.file}";
                byte[] bytes = File.ReadAllBytes(Path.Combine(evidence, "export", asset.file));
                string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                Require(digest == asset.sha256, $"{asset.paletteId}: GLB digest differs from the validated manifest");
                if (!File.Exists(model) || !bytes.SequenceEqual(File.ReadAllBytes(model)))
                    File.WriteAllBytes(model, bytes);

                AssetDatabase.ImportAsset(model, ImportAssetOptions.ForceSynchronousImport);
                var imported = AssetDatabase.LoadAssetAtPath<GameObject>(model);
                Require(imported != null, $"{asset.paletteId}: glTFast did not produce a model");

                // Wrapper prefab in a clean scene: the 180° Y basis parent of
                // ReviewBin/ReviewBench/ReviewCctv. The imported model keeps its own
                // hierarchy below it, pivots included.
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
                var root = new GameObject(Path.GetFileNameWithoutExtension(asset.prefab));
                var orientation = new GameObject("Unity basis").transform;
                orientation.SetParent(root.transform, false);
                PrefabUtility.InstantiatePrefab(imported, orientation);
                orientation.localRotation = Quaternion.Euler(0, 180, 0);

                CheckAnchor(root, "AxisX", Basis(asset.anchors.AxisX));
                CheckAnchor(root, "Front", Basis(asset.anchors.Front));
                CheckAnchor(root, "Up", Basis(asset.anchors.Up));
                CheckAnchor(root, "Approach", Basis(asset.anchors.Approach));

                var renderers = root.GetComponentsInChildren<MeshRenderer>();
                Require(renderers.Length > 0, $"{asset.paletteId}: imported model has no mesh renderers");
                var bounds = renderers[0].bounds;
                foreach (var renderer in renderers)
                    bounds.Encapsulate(renderer.bounds);
                Near(bounds.min, Basis(asset.min), $"{asset.paletteId} minimum bounds");
                Near(bounds.max, Basis(asset.max), $"{asset.paletteId} maximum bounds");

                int triangles = root.GetComponentsInChildren<MeshFilter>().Sum(filter => filter.sharedMesh.triangles.Length / 3);
                Require(triangles == asset.triangles,
                    $"{asset.paletteId}: expected {asset.triangles} triangles, got {triangles}");

                var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
                var materials = importedMaterials.Select(material => material.name)
                    .OrderBy(name => name, StringComparer.Ordinal).ToArray();
                Require(materials.SequenceEqual(asset.materials),
                    $"{asset.paletteId}: unexpected materials {string.Join(", ", materials)}");

                // Glass leaves sort in the transparent queue; every other material,
                // including the gate's enamel wings and the cubicle's panels, must not.
                foreach (var material in importedMaterials)
                {
                    bool transparent = Array.IndexOf(asset.alphaMaterials, material.name) >= 0;
                    if (transparent)
                        Require(material.renderQueue >= (int)RenderQueue.Transparent,
                            $"{asset.paletteId}: {material.name} lost its transparent queue ({material.renderQueue})");
                    else
                        Require(material.renderQueue < (int)RenderQueue.Transparent,
                            $"{asset.paletteId}: {material.name} should be opaque ({material.renderQueue})");
                }

                var textures = importedMaterials
                    .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                    .Where(texture => texture != null).Distinct().ToArray();
                Require(textures.Length == asset.textures,
                    $"{asset.paletteId}: expected {asset.textures} textures, got {textures.Length}");

                var pivots = Pivots(root);
                if (asset.kind == "door")
                {
                    Require(asset.alphaMaterials.Length == (asset.material == "glass" ? 1 : 0),
                        $"{asset.paletteId}: only the glass door has a transparent material");
                    Require(pivots.Length == asset.leaves,
                        $"{asset.paletteId}: expected {asset.leaves} leaf pivots, found {pivots.Length}");
                    // The leaf itself, not just the frame: every pivot must hold a
                    // mesh drawn with the door's leaf material.
                    string leafMaterial = asset.material == "glass" ? "glass" : asset.material == "wood" ? "woodLight" : "binSteel";
                    int leaves = pivots.Count(pivot => pivot.GetComponentsInChildren<MeshRenderer>()
                        .Any(renderer => renderer.sharedMaterials.Any(material => material.name == leafMaterial)));
                    Require(leaves == asset.leaves,
                        $"{asset.paletteId}: {leaves} of {asset.leaves} pivots hold a {leafMaterial} leaf");
                    if (asset.material == "glass")
                    {
                        var glass = importedMaterials.Single(material => material.name == "glass");
                        Require(glass.renderQueue >= (int)RenderQueue.Transparent,
                            $"{asset.paletteId}: the glass leaf is not transparent");
                        if (glass.HasProperty("_BaseColor"))
                            Require(glass.GetColor("_BaseColor").a < 0.9f,
                                $"{asset.paletteId}: the glass leaf is opaque ({glass.GetColor("_BaseColor").a})");
                    }
                }
                else if (asset.kind == "gate")
                {
                    Require(asset.alphaMaterials.Length == 0, $"{asset.paletteId}: a gate must not be transparent");
                    // The machine body sits on the cell's local -x half and the lane
                    // opens on +x, so bounds are deliberately asymmetric in x.
                    var body = renderers.Single(renderer => renderer.gameObject.name == "gate-body");
                    Require(body.bounds.center.x < -0.2f,
                        $"{asset.paletteId}: machine body is not on local -x ({body.bounds.center.x:F4})");
                    Require(bounds.min.x < -0.3f && bounds.max.x > 0.3f,
                        $"{asset.paletteId}: gate bounds are not asymmetric ({bounds.min.x:F4}..{bounds.max.x:F4})");
                    // The lane panels are canvas prints, and they must survive import.
                    foreach (var panel in parameters.gateLanePanels)
                    {
                        var material = importedMaterials.Single(m => m.name == panel);
                        Require(material.GetTexturePropertyNames().Any(property => material.GetTexture(property) != null),
                            $"{asset.paletteId}: {panel} lost its canvas texture");
                    }
                    Require(pivots.Length == 0, $"{asset.paletteId}: a gate has no swing-door pivot");
                    Require(asset.textures == 3,
                        $"{asset.paletteId}: expected the two lane panels and the brushed steel, got {asset.textures}");
                    // The family's moving part is the pair of fan wings that setGateWing
                    // drives. Sample closed, half-open and fully retracted and compare the leaf
                    // geometry, not just the node names.
                    var wings = root.GetComponentsInChildren<Transform>()
                        .Where(child => Named(child.name, "left-leaf") || Named(child.name, "right-leaf")).ToArray();
                    Require(wings.Length == 2, $"{asset.paletteId}: expected two fan wings, found {wings.Length}");
                    CheckGateWings(asset.paletteId, wings);
                }
                else
                {
                    var partitions = renderers.Count(renderer => Named(renderer.gameObject.name, "cubicle-partition"));
                    Require(partitions == asset.partitions,
                        $"{asset.paletteId}: expected {asset.partitions} partitions, found {partitions}");
                    Require(importedMaterials.Any(material => material.name == "cubicleCeramic"),
                        $"{asset.paletteId}: the ceramic fixture is missing");
                    if (asset.variant == "toilet")
                    {
                        Require(partitions == 0 && pivots.Length == 0,
                            $"{asset.paletteId}: the standalone toilet must not build the shared shell");
                    }
                    else
                    {
                        Require(partitions == 3, $"{asset.paletteId}: the shared cubicle builds three partitions");
                        Require(pivots.Length == 1, $"{asset.paletteId}: expected one cubicle door pivot");
                    }
                }

                var front = FindAnchor(root, "Front");
                var approach = FindAnchor(root, "Approach");
                for (int i = 0; i < 4; i++)
                {
                    var rotation = Quaternion.Euler(0, i * 90, 0);
                    root.transform.rotation = rotation;
                    Near(front.position, rotation * Vector3.forward, $"{asset.paletteId} front at facing {i}");
                    Near(approach.position, rotation * Vector3.back, $"{asset.paletteId} approach at facing {i}");
                }
                root.transform.rotation = Quaternion.identity;

                string prefabPath = $"{Folder}/{asset.prefab}";
                Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null,
                    $"{asset.paletteId}: could not save wrapper prefab");
                UnityEngine.Object.DestroyImmediate(root);

                summary.Add($"{asset.paletteId}={triangles}t/{asset.materials.Length}m/{asset.alphaMaterials.Length}a");
            }

            // Unity mints fresh scene fileIDs on every SaveScene, so a rebuilt scene
            // is never byte-identical. The scene is a view over the wrapper prefabs,
            // which are deterministic, so keep the first one and only fill a gap.
            if (!File.Exists(Scene))
                BuildReviewScene(manifest.assets);

            Debug.Log($"OPENING_IMPORT_OK {manifest.assets.Length} models {string.Join(" ", summary)} row={RowX(0):F1}..{RowX(manifest.assets.Length - 1):F1}");
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

        /// <summary>Row position of model <paramref name="index"/>, centred on the origin.</summary>
        private static float RowX(int index) => (index - 4.5f) * Spacing;

        /// <summary>
        /// One review scene: the ten wrapper prefabs in a row at 2.4 m pitch, with a
        /// camera just above eye height looking slightly down the row. Only called when
        /// the scene does not exist (see the note in Import).
        /// </summary>
        private static void BuildReviewScene(Asset[] assets)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < assets.Length; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>($"{Folder}/{assets[i].prefab}");
                Require(prefab != null, $"Missing prefab for {assets[i].paletteId}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(RowX(i), 0, 0);
                instance.transform.rotation = Quaternion.identity;
            }

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = new Vector3(0, 1.8f, -12.5f);
            camera.transform.LookAt(new Vector3(0, 0.8f, 0));
            camera.fieldOfView = 60;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 100;
            camera.clearFlags = CameraClearFlags.SolidColor;
            // Slate review background: the Web check requires it to prove the 3D scene
            // replaced the Unity splash, and it separates the pale doors and cubicles.
            camera.backgroundColor = new Color(0.22f, 0.30f, 0.38f);

            var light = new GameObject("Key light").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 2.4f;
            light.transform.rotation = Quaternion.Euler(35, -35, 0);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.4f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the opening review scene");
        }

        /// <summary>
        /// Sample a fare gate's fan wings at closed, half-open and fully retracted with
        /// setGateWing's formula (full width 0.35 m, lane edges -0.2 and 0.5) and compare
        /// the measured leaf widths. The authored pose must be the closed one.
        /// </summary>
        private static void CheckGateWings(string paletteId, Transform[] wings)
        {
            const float fullWidth = .35f;
            foreach (var wing in wings)
            {
                bool left = Named(wing.name, "left-leaf");
                float edge = left ? -.2f : .5f;
                float sign = left ? 1f : -1f;
                var authoredScale = wing.localScale;
                var authoredPosition = wing.localPosition;
                Require(Mathf.Abs(authoredScale.x - 1f) < 1e-4f,
                    $"{paletteId} {wing.name}: the authored pose is not closed (scale.x {authoredScale.x:F4})");
                float closedX = edge + sign * fullWidth * .5f;
                Require(Mathf.Abs(authoredPosition.x - closedX) < 1e-3f,
                    $"{paletteId} {wing.name}: closed x expected {closedX:F4}, got {authoredPosition.x:F4}");

                foreach (var sample in new[] { (open: .5f, width: .1875f), (open: 1f, width: .025f) })
                {
                    float width = fullWidth * (1f - sample.open) + .025f * sample.open;
                    wing.localScale = new Vector3(width / fullWidth, authoredScale.y, authoredScale.z);
                    wing.localPosition = new Vector3(edge + sign * width * .5f, authoredPosition.y, authoredPosition.z);
                    var renderers = wing.GetComponentsInChildren<MeshRenderer>();
                    Require(renderers.Length > 0, $"{paletteId} {wing.name}: the wing holds no mesh");
                    var bounds = renderers[0].bounds;
                    foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
                    Close(bounds.size.x, sample.width, $"{paletteId} {wing.name} leaf width at open {sample.open}");
                    Require(bounds.size.x > 0f, $"{paletteId} {wing.name}: the sampled leaf has no width");
                }

                wing.localScale = authoredScale;
                wing.localPosition = authoredPosition;
                Require(Mathf.Abs(wing.localScale.x - 1f) < 1e-4f,
                    $"{paletteId} {wing.name}: resetting the wing left a residual scale");
            }
        }

        /// <summary>
        /// True for a node the builders named <paramref name="name"/>. glTFast makes
        /// sibling node names unique on import (the second door leaf, the second and
        /// third cubicle partition), so the suffixes it adds are part of the name.
        /// </summary>
        private static bool Named(string candidate, string name) =>
            candidate == name || candidate.StartsWith(name + "_", StringComparison.Ordinal);

        /// <summary>Every leaf/cubicle-door pivot the builders authored.</summary>
        private static Transform[] Pivots(GameObject root) =>
            root.GetComponentsInChildren<Transform>()
                .Where(child => Named(child.name, "passenger-swing-door")).ToArray();

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        private static void CheckAnchor(GameObject root, string name, Vector3 expected) =>
            Near(FindAnchor(root, name).position, expected, name);

        private static void Close(float actual, float expected, string field) =>
            Require(Mathf.Abs(actual - expected) < 1e-4f, $"{field}: expected {expected}, got {actual}");

        private static void Near(Vector3 actual, Vector3 expected, string field) =>
            Require(Vector3.Distance(actual, expected) < 0.001f, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
