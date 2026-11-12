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
    /// Import the five rolling-stock GLBs exported by export-rolling.mjs (one
    /// three-car review consist per A/B/C/L/D stock class), wrap each in a prefab
    /// under the Unity gameplay basis, and verify the family contract:
    ///
    /// - the GLB digest, the two door clips and every sampled door-leaf position
    ///   (closed, plug-out, open on each bank, with the other bank stationary);
    /// - source-space bounds, triangle count, the authored material set and the
    ///   four embedded canvas textures;
    /// - the parts the checklist names: both cab shells, the intermediate car
    ///   (one cabin floor/ceiling per car), the inter-car gangway, the roof,
    ///   bogies, the catenary pantographs and the livery paint;
    /// - the four basis anchors at four facings.
    ///
    /// Then save one review scene — five consists on parallel tracks, near-side
    /// doors open — and log ROLLING_IMPORT_OK.
    /// </summary>
    public static class ReviewRolling
    {
        private const string Folder = "Assets/RollingProof";
        private const string Scene = Folder + "/Rolling.unity";
        private const int Count = 5;
        /// <summary>Track centres across the yard, in metres. Three-car consists are 52–68 m long.</summary>
        private const float TrackPitch = 9f;
        private static readonly Vector3 CameraPosition = new Vector3(-20f, 36f, -72f);
        private static readonly Vector3 CameraTarget = new Vector3(0f, 1.5f, 0f);
        private const float CameraFieldOfView = 36f;
        private const float FarClipPlane = 500f;
        private static readonly Color Slate = new Color(0.22f, 0.30f, 0.38f);

        [Serializable]
        private class Manifest
        {
            public int schemaVersion;
            public string family;
            public Parameters parameters;
            public Asset[] assets;
            public FamilyValidation validation;
        }

        [Serializable]
        private class FamilyValidation { public int errors, warnings; }

        [Serializable]
        private class Parameters
        {
            public int models, cars;
            public string power, formation, livery, doors, basis, textures, scene;
            public Formation[] representativeFormations;
        }

        [Serializable]
        private class Formation
        {
            public string stock, line, colour;
            public int[] cars;
        }

        [Serializable]
        private class Asset
        {
            public int schemaVersion, cars, triangles, meshes, textures;
            public string id, prefab, file, stock, power, colour, liveryLine, source, provenance, units, basis, sha256, doorPrefix;
            public int[] representativeCars;
            public float[] min, max, size;
            public string[] materials, alphaMaterials, glassMaterials, clips;
            public Anchors anchors;
            public Door[] doors;
            public NodeCounts nodes;
            public FamilyValidation validation;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        [Serializable]
        private class Door { public string name; public int side; public Sample[] samples; }

        [Serializable]
        private class Sample { public float[] position; }

        [Serializable]
        private class NodeCounts
        {
            public int cabShell, gangway, roof, liveryBand, bogies, pantographs, cabinFloors, cabinCeilings;
            public string[] gangwayNames;
        }

        /// <summary>One checklist row, as the game source defines it.</summary>
        private class Expected
        {
            public string id, prefab, file, stock, colour, line, cabShell, gangway;
            public int doors;
            public int[] representativeCars;
            /// <summary>Source length, before the Z-up wrapper (metres).</summary>
            public float length, width;
        }

        // Livery colours are `captureTrains.ts` LIVERY_LINE resolved through
        // `lineColourFor` (Guangzhou sign colours): A/1 yellow, B/2 blue, C/4
        // green, L/5 red, D/18 royal blue. Door counts are the three-car builds.
        private static readonly Expected[] ExpectedConsists =
        {
            new Expected { id = "train-A", prefab = "TrainA", file = "train-a.glb", stock = "A", colour = "#edcf3b", line = "1", doors = 60, cabShell = "cab-shell", gangway = "car-intercar-gangway", representativeCars = new[] { 6, 8 }, length = 67.74f, width = 3.19f },
            new Expected { id = "train-B", prefab = "TrainB", file = "train-b.glb", stock = "B", colour = "#00679e", line = "2", doors = 48, cabShell = "cab-shell", gangway = "car-intercar-gangway", representativeCars = new[] { 4, 6 }, length = 60.24f, width = 2.99f },
            new Expected { id = "train-C", prefab = "TrainC", file = "train-c.glb", stock = "C", colour = "#01824a", line = "4", doors = 48, cabShell = "cab-shell", gangway = "car-intercar-gangway", representativeCars = new[] { 4, 6 }, length = 58.74f, width = 2.66f },
            new Expected { id = "train-L", prefab = "TrainL", file = "train-l.glb", stock = "L", colour = "#c70541", line = "5", doors = 36, cabShell = "cab-shell", gangway = "car-intercar-gangway", representativeCars = new[] { 4, 6 }, length = 52.14f, width = 2.99f },
            new Expected { id = "train-D", prefab = "TrainD", file = "train-d.glb", stock = "D", colour = "#364c9c", line = "18", doors = 44, cabShell = "d-cab-shell", gangway = "d-intercar-gangway", representativeCars = new[] { 8, 8 }, length = 60.30f, width = 3.35f },
        };

        private class ImportedTrain
        {
            public Expected expected;
            public Asset manifest;
            public string modelPath, prefabPath;
        }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            string summaryPath = Path.Combine(evidence, "export", "manifest.json");
            Require(File.Exists(summaryPath), $"Missing {summaryPath}");
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(summaryPath));
            Require(manifest?.assets != null, "Unreadable rolling export manifest");
            Require(manifest.family == "rolling", $"Expected the rolling family, got {manifest.family}");
            Require(manifest.assets.Length == Count, $"Expected {Count} consists in the manifest, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.id).Distinct().Count() == Count, "The manifest repeats a consist id");
            CheckFamilyParameters(manifest.parameters);

            Directory.CreateDirectory(Folder);
            var imported = new List<ImportedTrain>();
            var summary = new List<string>();
            foreach (var expected in ExpectedConsists)
            {
                var asset = manifest.assets.SingleOrDefault(entry => entry.id == expected.id);
                Require(asset != null, $"The manifest is missing {expected.id}");
                CheckConsistParameters(asset, expected, manifest.parameters);
                var train = ImportAsset(asset, expected, evidence);
                imported.Add(train);
                summary.Add($"{expected.prefab}={asset.triangles}t/{asset.materials.Length}m/" +
                            $"{asset.textures}tx/{asset.doors.Length}d");
            }

            // Unity mints fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene is never byte-identical. The scene is a view over
            // the wrapper prefabs, so create it only when missing and verify its
            // content on every run.
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"ROLLING_IMPORT_OK {imported.Count} consists {string.Join(" ", summary)} " +
                      $"cars={manifest.parameters.cars} power={manifest.parameters.power} " +
                      $"tracks={TrackPitch:F1}m camera=({CameraPosition.x:F0},{CameraPosition.y:F0},{CameraPosition.z:F0})");
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

        private static void CheckFamilyParameters(Parameters parameters)
        {
            Require(parameters != null, "The manifest is missing its family parameters");
            Require(parameters.models == Count, $"Expected {Count} family models, got {parameters.models}");
            Require(parameters.cars == 3, $"Expected three-car review consists, got {parameters.cars}");
            Require(parameters.power == "catenary", $"Expected catenary power, got {parameters.power}");
            Require(!string.IsNullOrEmpty(parameters.formation) && parameters.formation.Contains("three-car"),
                "The manifest does not record the three-car review formation");
            Require(!string.IsNullOrEmpty(parameters.doors) && parameters.doors.Contains("OpenPlus") &&
                    parameters.doors.Contains("OpenMinus"), "The manifest does not record both door clips");
            Require(!string.IsNullOrEmpty(parameters.basis) && parameters.basis.Contains("180"),
                "The manifest does not record the Unity basis correction");
            Require(parameters.representativeFormations != null && parameters.representativeFormations.Length == Count,
                "The manifest is missing the checklist's representative formations");
            foreach (var expected in ExpectedConsists)
            {
                var formation = parameters.representativeFormations.SingleOrDefault(entry => entry.stock == expected.stock);
                Require(formation != null, $"{expected.id}: no representative formation");
                Require(formation.line == expected.line, $"{expected.id}: representative line {formation.line} != {expected.line}");
                Require(formation.colour == expected.colour, $"{expected.id}: representative colour {formation.colour} != {expected.colour}");
                Require(formation.cars != null && formation.cars.SequenceEqual(expected.representativeCars),
                    $"{expected.id}: representative formation {string.Join("/", formation.cars ?? new int[0])}");
            }
        }

        private static void CheckConsistParameters(Asset asset, Expected expected, Parameters parameters)
        {
            string label = expected.id + ": ";
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab} != {expected.prefab}");
            Require(asset.file == expected.file, $"{label}file {asset.file} != {expected.file}");
            Require(asset.stock == expected.stock, $"{label}stock {asset.stock} != {expected.stock}");
            Require(asset.cars == 3, $"{label}review consist is {asset.cars} cars, expected 3");
            Require(asset.power == "catenary", $"{label}power {asset.power} != catenary");
            Require(asset.colour == expected.colour, $"{label}livery {asset.colour} != {expected.colour}");
            Require(asset.liveryLine == expected.line, $"{label}livery line {asset.liveryLine} != {expected.line}");
            Require(asset.representativeCars != null && asset.representativeCars.SequenceEqual(expected.representativeCars),
                $"{label}representative formation");
            Require(asset.units == "metres", $"{label}units {asset.units}");
            Require(asset.clips != null && asset.clips.SequenceEqual(new[] { "OpenPlus", "OpenMinus" }),
                $"{label}clips {string.Join(",", asset.clips ?? new string[0])}");
            Require(asset.doors != null && asset.doors.Length == expected.doors,
                $"{label}expected {expected.doors} door leaves, got {asset.doors?.Length ?? 0}");
            Require(asset.doors.Count(door => door.side == 1) * 2 == expected.doors &&
                    asset.doors.Count(door => door.side == -1) * 2 == expected.doors,
                $"{label}the two door banks are not equal");
            Require(asset.doorPrefix == expected.prefab + "Door", $"{label}door prefix {asset.doorPrefix}");
            Require(asset.doors.All(door => door.name.StartsWith(asset.doorPrefix, StringComparison.Ordinal)),
                $"{label}an unnamed door leaf slipped through");
            Require(asset.validation != null && asset.validation.errors == 0 && asset.validation.warnings == 0,
                $"{label}validator reported {asset.validation?.errors}/{asset.validation?.warnings}");
            // Source-space class envelope: the body is cars x stock length plus a
            // short coupler overhang; the width is the stock width plus the door
            // plug travel. Both are metric sanity checks against a wrong builder.
            Require(asset.size != null && asset.size.Length == 3, $"{label}missing source bounds");
            Require(Mathf.Abs(asset.size[0] - expected.length) < 0.5f,
                $"{label}source length {asset.size[0]:F2} != {expected.length:F2}");
            Require(Mathf.Abs(asset.size[1] - expected.width) < 0.25f,
                $"{label}source width {asset.size[1]:F2} != {expected.width:F2}");
            Require(asset.size[2] > 3.8f && asset.size[2] < 4.5f,
                $"{label}source height {asset.size[2]:F2} outside the catenary envelope");
            Require(asset.nodes != null, $"{label}missing node counts");
            Require(asset.nodes.cabShell == 2, $"{label}expected two cab shells, manifest says {asset.nodes.cabShell}");
            Require(asset.nodes.cabinFloors == 3 && asset.nodes.cabinCeilings == 3,
                $"{label}expected three cabin floors/ceilings, manifest says {asset.nodes.cabinFloors}/{asset.nodes.cabinCeilings}");
            Require(asset.nodes.gangway >= 1, $"{label}no gangway recorded");
            Require(asset.nodes.pantographs == 2, $"{label}expected two pantographs, manifest says {asset.nodes.pantographs}");
            Require(asset.alphaMaterials != null && asset.glassMaterials != null && asset.materials != null,
                $"{label}missing material partitions");
            Require(asset.materials.Contains("lineLivery"), $"{label}missing lineLivery");
            Require(asset.materials.Contains("glass"), $"{label}missing glass");
            Require(asset.textures == 4, $"{label}expected four embedded textures, got {asset.textures}");
            Require(!string.IsNullOrEmpty(asset.sha256) && asset.sha256.Length == 64, $"{label}missing digest");
        }

        private static ImportedTrain ImportAsset(Asset asset, Expected expected, string evidence)
        {
            string label = expected.id;
            string modelPath = $"{Folder}/{asset.file}";
            string glbPath = Path.Combine(evidence, "export", asset.file);
            Require(File.Exists(glbPath), $"{label}: missing {glbPath}");
            byte[] bytes = File.ReadAllBytes(glbPath);
            string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            Require(digest == asset.sha256, $"{label}: GLB digest differs from the validated manifest");
            if (!File.Exists(modelPath) || !bytes.SequenceEqual(File.ReadAllBytes(modelPath)))
                File.WriteAllBytes(modelPath, bytes);
            AssetDatabase.ImportAsset(modelPath, ImportAssetOptions.ForceSynchronousImport);
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            Require(model != null, $"{label}: glTFast did not import the consist");
            var assets = AssetDatabase.LoadAllAssetsAtPath(modelPath);
            var clips = assets.OfType<AnimationClip>().ToDictionary(clip => clip.name);
            Require(clips.Count == 2 && clips.ContainsKey("OpenPlus") && clips.ContainsKey("OpenMinus"),
                $"{label}: expected the two independent door clips, got {string.Join(",", clips.Keys)}");
            foreach (var clip in clips.Values)
                Require(Mathf.Abs(clip.length - 1f) < 0.001f, $"{label}: {clip.name} duration changed to {clip.length}");

            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var wrapper = new GameObject(expected.prefab);
            var basis = new GameObject("Unity basis").transform;
            basis.SetParent(wrapper.transform, false);
            basis.localRotation = Quaternion.Euler(0, 180, 0);
            var imported = (GameObject)PrefabUtility.InstantiatePrefab(model, basis);

            // Door leaves: every articulated node is still an independent mesh.
            var transforms = imported.GetComponentsInChildren<Transform>(true);
            var leaves = transforms.Where(node => node.name.StartsWith(asset.doorPrefix, StringComparison.Ordinal))
                .ToDictionary(node => node.name);
            Require(leaves.Count == asset.doors.Length,
                $"{label}: expected {asset.doors.Length} door leaves, got {leaves.Count}");
            Require(asset.doors.Count(door => door.side == 1) == asset.doors.Count(door => door.side == -1),
                $"{label}: sample banks differ");

            var renderers = wrapper.GetComponentsInChildren<MeshRenderer>();
            Require(renderers.Length > 0, $"{label}: consist has no renderers");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers)
                bounds.Encapsulate(renderer.bounds);
            // Renderer.bounds transforms local AABBs, which can be conservative
            // for curved parts — the same 0.12 m readback tolerance as the train.
            Near(bounds.min, Basis(asset.min), $"{label} minimum bounds", 0.12f);
            Near(bounds.max, Basis(asset.max), $"{label} maximum bounds", 0.12f);

            var filters = wrapper.GetComponentsInChildren<MeshFilter>();
            int triangles = filters.Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == asset.triangles,
                $"{label}: expected {asset.triangles} triangles, got {triangles}");
            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materialNames = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            var expectedNames = asset.materials.OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materialNames.SequenceEqual(expectedNames),
                $"{label}: unexpected materials {string.Join(", ", materialNames)}");

            // Glass, the livery and the alpha/cutout split survive the import.
            var glass = importedMaterials.Single(material => material.name == "glass");
            Require(glass.renderQueue >= (int)RenderQueue.Transparent, $"{label}: glass lost its transparent queue");
            Require(importedMaterials.Single(material => material.name == "lineLivery").renderQueue < (int)RenderQueue.Transparent,
                $"{label}: livery material must stay opaque");
            foreach (var material in importedMaterials)
                if (asset.alphaMaterials.Contains(material.name))
                    Require(material.renderQueue >= (int)RenderQueue.Transparent,
                        $"{label}: {material.name} lost its transparent queue ({material.renderQueue})");
            var textures = importedMaterials
                .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length == asset.textures,
                $"{label}: expected {asset.textures} embedded textures, got {textures.Length}");

            // The parts the checklist names, straight off the imported hierarchy.
            // glTFast may suffix repeated node names, so match by authored prefix.
            int Prefix(string name) => transforms.Count(node => node.name.StartsWith(name, StringComparison.Ordinal));
            Require(Prefix(expected.cabShell) == asset.nodes.cabShell,
                $"{label}: expected {asset.nodes.cabShell} {expected.cabShell} nodes, got {Prefix(expected.cabShell)}");
            Require(Prefix("cabin-floor") == asset.nodes.cabinFloors && Prefix("cabin-ceiling") == asset.nodes.cabinCeilings,
                $"{label}: intermediate car is missing (floors {Prefix("cabin-floor")}, ceilings {Prefix("cabin-ceiling")})");
            var gangwayNames = asset.nodes.gangwayNames ?? new[] { expected.gangway };
            foreach (var name in gangwayNames)
                Require(Prefix(name) == asset.nodes.gangway,
                    $"{label}: expected {asset.nodes.gangway} {name} nodes, got {Prefix(name)}");
            string roofName = expected.stock == "D" ? "d-car-roof" : "car-roof";
            Require(Prefix(roofName) == asset.nodes.roof, $"{label}: expected {asset.nodes.roof} {roofName} nodes, got {Prefix(roofName)}");
            Require(Prefix("train-pantograph") == asset.nodes.pantographs,
                $"{label}: expected {asset.nodes.pantographs} pantographs, got {Prefix("train-pantograph")}");
            int bogies = transforms.Count(node => node.name.StartsWith("bogie-", StringComparison.Ordinal));
            Require(bogies == asset.nodes.bogies, $"{label}: expected {asset.nodes.bogies} bogie parts, got {bogies}");
            string liveryNode = expected.stock == "D" ? "d-car-livery" : "cab-livery-paint";
            Require(Prefix(liveryNode) > 0, $"{label}: no {liveryNode} livery paint in the import");

            // The two door banks are independent: each clip moves only its own
            // leaves, and samples 1/2 (+ bank) and 3/4 (- bank) match Three.js.
            void Check(int sample)
            {
                foreach (var door in asset.doors)
                    Near(leaves[door.name].position, Basis(door.samples[sample].position),
                        $"{label} {door.name}, sample {sample}", 0.002f);
            }
            Check(0);
            foreach (var (name, sample) in new[] { ("OpenPlus", 1), ("OpenMinus", 3) })
            {
                var clip = clips[name];
                clip.SampleAnimation(imported, 0.18f);
                Check(sample);
                clip.SampleAnimation(imported, 1);
                Check(sample + 1);
                clip.SampleAnimation(imported, 0);
                Check(0);
            }

            // Four basis anchors, shared with the bench/bin/cctv/glass/shelf
            // recipes: AxisX along the consist, Front the near door bank, Up the
            // roof, Approach the far bank.
            var axisX = FindAnchor(wrapper, "AxisX");
            var front = FindAnchor(wrapper, "Front");
            var up = FindAnchor(wrapper, "Up");
            var approach = FindAnchor(wrapper, "Approach");
            CheckAnchor(axisX, asset.anchors.AxisX, label + " AxisX");
            CheckAnchor(front, asset.anchors.Front, label + " Front");
            CheckAnchor(up, asset.anchors.Up, label + " Up");
            CheckAnchor(approach, asset.anchors.Approach, label + " Approach");
            for (int i = 1; i < 4; i++)
            {
                var rotation = Quaternion.Euler(0, i * 90, 0);
                wrapper.transform.rotation = rotation;
                Near(axisX.position, rotation * Basis(asset.anchors.AxisX), $"{label} AxisX at facing {i}");
                Near(front.position, rotation * Basis(asset.anchors.Front), $"{label} Front at facing {i}");
                Near(up.position, rotation * Basis(asset.anchors.Up), $"{label} Up at facing {i}");
                Near(approach.position, rotation * Basis(asset.anchors.Approach), $"{label} Approach at facing {i}");
            }
            wrapper.transform.rotation = Quaternion.identity;

            string prefabPath = $"{Folder}/{asset.prefab}.prefab";
            Require(PrefabUtility.SaveAsPrefabAsset(wrapper, prefabPath) != null, $"{label}: could not save the wrapper prefab");
            UnityEngine.Object.DestroyImmediate(wrapper);

            Debug.Log($"ROLLING_ASSET {asset.id} {digest.Substring(0, 12)} {asset.triangles}t " +
                      $"bounds=({bounds.size.x:F2},{bounds.size.y:F2},{bounds.size.z:F2}) " +
                      $"materials={asset.materials.Length} textures={textures.Length} leaves={leaves.Count} " +
                      $"cars={asset.cars} power={asset.power} livery={asset.colour}");
            return new ImportedTrain { expected = expected, manifest = asset, modelPath = modelPath, prefabPath = prefabPath };
        }

        /// <summary>
        /// Five consists on parallel tracks, all centred on the same x, with the
        /// near (+y) door bank opened through its own clip so the built scene
        /// shows door leaves and the cabin behind them. A raised three-quarter
        /// camera frames the whole yard; the far plane is 500 m.
        /// </summary>
        private static void BuildReviewScene(List<ImportedTrain> trains)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < trains.Count; i++)
            {
                var train = trains[i];
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(train.prefabPath);
                Require(prefab != null, $"Missing prefab for {train.expected.id}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(0f, 0f, RowZ(i));
                instance.transform.rotation = Quaternion.identity;

                var imported = instance.transform.Find("Unity basis").GetChild(0).gameObject;
                var openPlus = AssetDatabase.LoadAllAssetsAtPath(train.modelPath).OfType<AnimationClip>()
                    .Single(clip => clip.name == "OpenPlus");
                openPlus.SampleAnimation(imported, 1);
                foreach (var leaf in imported.GetComponentsInChildren<Transform>()
                             .Where(node => node.name.StartsWith(train.manifest.doorPrefix, StringComparison.Ordinal)))
                    PrefabUtility.RecordPrefabInstancePropertyModifications(leaf);
            }

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = CameraPosition;
            camera.transform.LookAt(CameraTarget);
            camera.fieldOfView = CameraFieldOfView;
            camera.nearClipPlane = 0.5f;
            camera.farClipPlane = FarClipPlane;
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
                "Could not save the rolling review scene");
        }

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: five linked
        /// prefab instances at their track positions, the near door bank open on
        /// every consist, the slate camera and the two lights the Web check needs.
        /// </summary>
        private static void VerifyReviewScene(List<ImportedTrain> trains)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            for (int i = 0; i < trains.Count; i++)
            {
                var train = trains[i];
                var instance = roots.SingleOrDefault(root => root.name == train.expected.prefab);
                Require(instance != null, $"Review scene is missing the {train.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == train.prefabPath,
                    $"{train.expected.prefab} is not an instance of {train.prefabPath}");
                Near(instance.transform.position, new Vector3(0f, 0f, RowZ(i)),
                    $"{train.expected.prefab} track placement");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{train.expected.prefab} instance has no renderers");
                // The near bank is posed open in the scene itself. Transform
                // positions read back in world space, so include the track offset.
                var track = new Vector3(0f, 0f, RowZ(i));
                var leaves = instance.GetComponentsInChildren<Transform>()
                    .Where(node => node.name.StartsWith(train.manifest.doorPrefix, StringComparison.Ordinal))
                    .ToDictionary(node => node.name);
                foreach (var door in train.manifest.doors.Where(door => door.side == 1))
                {
                    Require(leaves.ContainsKey(door.name), $"{train.expected.prefab}: scene is missing {door.name}");
                    Near(leaves[door.name].position, track + Basis(door.samples[2].position),
                        $"{train.expected.prefab} {door.name} open pose", 0.002f);
                }
            }

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(Mathf.Abs(camera.fieldOfView - CameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Require(camera.farClipPlane >= FarClipPlane, $"Review camera far plane must be at least {FarClipPlane} m");
            Near(camera.transform.position, CameraPosition, "Review camera position");
            Require(camera.transform.position.y >= 30f,
                $"Review camera must sit high enough to see five tracks (y={camera.transform.position.y:F1})");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 2, "Review scene is missing its two directional lights");
        }

        private static float RowZ(int index) => (index - (Count - 1) / 2f) * TrackPitch;

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        private static void CheckAnchor(Transform anchor, float[] expected, string field) =>
            Near(anchor.position, Basis(expected), field);

        private static void Near(Vector3 actual, Vector3 expected, string field, float tolerance = 0.001f) =>
            Require(Vector3.Distance(actual, expected) < tolerance, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
