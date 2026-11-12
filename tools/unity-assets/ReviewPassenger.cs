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
    /// Import the original humanoid passenger stand-in GLBs exported by
    /// export-passenger.mjs, verify the rig (15 named bones, normalised skin
    /// weights, bind poses, 1.70 m / 1.20 m scale, eight clips and a sampled pose
    /// per clip), verify the low-detail LOD and the attachment points, and save
    /// one review scene with the variants in a row and a 24-instance crowd.
    ///
    /// The assets are original procedural geometry: no HumanBody_Alt.fbx, baked
    /// soft-human atlas or game crowd mesh is involved.
    /// </summary>
    public static class ReviewPassenger
    {
        private const string Folder = "Assets/PassengerProof";
        private const string Scene = Folder + "/Passenger.unity";
        private const int Count = 4;
        private const int CrowdCount = 24;

        // Scene layout. The camera sits in front of the row (which faces +Z) and
        // sees both the four variants and the crowd block behind them.
        private static readonly Vector3 CameraPosition = new Vector3(0f, 2.9f, 10.8f);
        private static readonly Vector3 CameraTarget = new Vector3(0f, 1.0f, -0.6f);
        private const float CameraFieldOfView = 42f;
        private const float CameraFarPlane = 150f;
        private static readonly Color Slate = new Color(0.22f, 0.30f, 0.38f);
        private const float RowZ = 1.6f;
        private static readonly float[] RowX = { -3.9f, -1.3f, 1.3f, 3.9f };
        // The crowd shows the standing/travel clips that make sense for people
        // queueing on a platform; the seated clips are verified by clip sampling
        // (there are no train seats in this review scene to sit on).
        private static readonly string[] CrowdClips =
        {
            "Walk", "Idle", "Stairs", "Ticket", "Escalator", "Board",
        };

        private static readonly string[] ExpectedBones =
        {
            "Hips", "Spine", "Chest", "Neck", "Head",
            "UpperArm.L", "LowerArm.L", "UpperArm.R", "LowerArm.R",
            "UpperLeg.L", "LowerLeg.L", "Foot.L", "UpperLeg.R", "LowerLeg.R", "Foot.R",
        };

        private static readonly string[] ExpectedClips =
        {
            "Idle", "Walk", "Stairs", "Escalator", "Board", "Seated", "Ticket", "Bench",
        };

        private static readonly string[] ExpectedAnchors = { "Attach.Hand.R", "Attach.Hand.L", "Attach.Seat", "Attach.Head" };

        [Serializable]
        private class Manifest
        {
            public string family;
            public Asset[] assets;
            public Parameters parameters;
            public Validation validation;
        }

        [Serializable]
        private class Validation
        {
            public int errors, warnings, infos;
        }

        [Serializable]
        private class Parameters
        {
            public int models, boneCount, lodFullTriangles, lodLowTriangles;
            public string family, rig, provenance, licenseRecord, basis, skinning, grounding, wardrobe, hair, bags;
            public string[] boneNames, clipNames;
            public float[] clipDurations;
            public float baseHeightMetres, childHeightMetres, ankleHeightMetres;
        }
        [Serializable]
        private class Asset
        {
            public string id, prefab, file, role, scaleVariantOf, label, source, provenance, licenseRecord, units, hair, bag;
            public float heightMetres, ankleHeightMetres;
            public int triangles, vertices, meshes, boneCount;
            public string[] materials, bones;
            public Wardrobe wardrobe;
            public AnchorInfo[] anchors;
            public BoundsInfo bounds;
            public ClipInfo[] clips;
            public Validation validation;
        }

        [Serializable]
        private class Wardrobe
        {
            public string name, top, trousers, skin;
        }

        [Serializable]
        private class AnchorInfo
        {
            public string name, bone;
            public float[] localPosition;
        }

        [Serializable]
        private class BoundsInfo
        {
            public float[] min, max, size;
        }

        [Serializable]
        private class ClipInfo
        {
            public string name;
            public float duration;
            public int channels, keyframes;
            public float[] contactTimes;
            public Sample[] samples;
        }

        [Serializable]
        private class Sample
        {
            public float time, lowestSole;
            public float[] hips;
            public FootSample[] feet;
            public BoneSample[] bones, attachments;
        }

        [Serializable]
        private class FootSample
        {
            public string name;
            public float sole;
        }

        [Serializable]
        private class BoneSample
        {
            public string name;
            public float[] position;
        }

        private class Expected
        {
            public string id, prefab, file, role, hair, wardrobe;
            public float height;
            public bool low, bag;
        }

        // The four family assets, in review-row order.
        private static readonly Expected[] ExpectedAssets =
        {
            new Expected { id = "passenger.adult", prefab = "PassengerAdult", file = "passenger-adult.glb", role = "adult", height = 1.7f, wardrobe = "navy", hair = "cap", bag = true },
            new Expected { id = "passenger.child", prefab = "PassengerChild", file = "passenger-child.glb", role = "child", height = 1.2f, wardrobe = "orange", hair = "bob", bag = false },
            new Expected { id = "passenger.jacket", prefab = "PassengerJacket", file = "passenger-jacket.glb", role = "adult", height = 1.7f, wardrobe = "teal", hair = "ponytail", bag = true },
            new Expected { id = "passenger.low", prefab = "PassengerLow", file = "passenger-low.glb", role = "adult-low", height = 1.7f, wardrobe = "navy", hair = "cap", bag = true, low = true },
        };

        private class Imported
        {
            public Expected expected;
            public Asset manifest;
            public string prefabPath;
            public Dictionary<string, AnimationClip> clips;
        }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            string summaryPath = Path.Combine(evidence, "export", "manifest.json");
            Require(File.Exists(summaryPath), $"Missing {summaryPath}");
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(summaryPath));
            Require(manifest?.assets != null, "Unreadable export manifest");
            Require(manifest.assets.Length == Count, $"Expected {Count} passenger assets, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.id).Distinct().Count() == Count, "The manifest repeats an asset id");
            CheckFamilyParameters(manifest);

            Directory.CreateDirectory(Folder);
            var imported = new List<Imported>();
            var summary = new List<string>();
            foreach (var expected in ExpectedAssets)
            {
                var asset = manifest.assets.SingleOrDefault(entry => entry.id == expected.id);
                Require(asset != null, $"Manifest is missing {expected.id}");
                CheckAssetParameters(asset, expected, manifest.parameters);
                var result = ImportAsset(asset, expected, evidence);
                imported.Add(result);
                summary.Add($"{asset.prefab}={asset.triangles}t/{asset.bones.Length}b/{asset.clips.Length}c/{asset.heightMetres:F2}m");
            }

            // The adult and the low-detail prefab are the near/far LOD pair.
            var full = imported.Single(entry => entry.expected.id == "passenger.adult").manifest;
            var low = imported.Single(entry => entry.expected.id == "passenger.low").manifest;
            Require(low.triangles < full.triangles * 0.6f,
                $"Low LOD is not lighter: {low.triangles} vs {full.triangles} triangles");
            Require(low.triangles > 0, "Low LOD has no triangles");
            Require(low.materials.SequenceEqual(full.materials), "Low LOD does not keep the adult material recipe");
            Require(low.bones.SequenceEqual(full.bones), "Low LOD does not share the adult skeleton");

            // Unity mints fresh fileIDs on every SaveScene, so the scene is not
            // byte-stable by design. Create it only when missing and verify its
            // content on every import.
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"PASSENGER_IMPORT_OK {imported.Count} models {string.Join(" ", summary)} " +
                      $"rig={ExpectedBones.Length}bones clips={string.Join("/", ExpectedClips)} " +
                      $"lod={full.triangles}t->{low.triangles}t row={RowX[0]:F1}..{RowX[Count - 1]:F1} crowd={CrowdCount}");
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

        private static void CheckFamilyParameters(Manifest manifest)
        {
            var parameters = manifest.parameters;
            Require(parameters != null, "The manifest is missing its family parameters");
            Require(manifest.family == "passenger", $"Family is {manifest.family}");
            Require(parameters.models == Count, $"Expected {Count} models, got {parameters.models}");
            Require(parameters.boneCount == ExpectedBones.Length, $"Expected {ExpectedBones.Length} bones, got {parameters.boneCount}");
            Require(parameters.boneNames != null && parameters.boneNames.SequenceEqual(ExpectedBones),
                $"Bone names changed: {string.Join(",", parameters.boneNames ?? Array.Empty<string>())}");
            Require(parameters.clipNames != null && parameters.clipNames.SequenceEqual(ExpectedClips),
                $"Clip names changed: {string.Join(",", parameters.clipNames ?? Array.Empty<string>())}");
            Require(parameters.clipDurations != null && parameters.clipDurations.Length == ExpectedClips.Length,
                "The manifest clip durations are incomplete");
            Require(Mathf.Abs(parameters.baseHeightMetres - 1.7f) < 0.001f, $"Adult height {parameters.baseHeightMetres}");
            Require(Mathf.Abs(parameters.childHeightMetres - 1.2f) < 0.001f, $"Child height {parameters.childHeightMetres}");
            Require(!string.IsNullOrEmpty(parameters.provenance) && parameters.provenance.Contains("Original"),
                "The manifest does not record original procedural provenance");
            Require(!string.IsNullOrEmpty(parameters.licenseRecord) && parameters.licenseRecord.Contains("no third-party"),
                "The manifest does not record the clean license position");
            Require(!string.IsNullOrEmpty(parameters.skinning) && parameters.skinning.Contains("smoothstep") &&
                    parameters.skinning.Contains("sums to 1"),
                "The manifest does not describe the smooth, normalised skin weights");
            Require(manifest.validation != null && manifest.validation.errors == 0 && manifest.validation.warnings == 0,
                "The GLBs did not validate clean");
        }

        private static void CheckAssetParameters(Asset asset, Expected expected, Parameters parameters)
        {
            string label = $"{expected.id}: ";
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.file, $"{label}file {asset.file}");
            Require(asset.role == expected.role, $"{label}role {asset.role}");
            Require(Mathf.Abs(asset.heightMetres - expected.height) < 0.001f,
                $"{label}height {asset.heightMetres} != {expected.height}");
            Require(asset.bones != null && asset.bones.SequenceEqual(ExpectedBones), $"{label}bone list changed");
            Require(asset.boneCount == ExpectedBones.Length, $"{label}bone count {asset.boneCount}");
            Require(asset.hair == expected.hair, $"{label}hair {asset.hair}");
            Require(asset.wardrobe != null && asset.wardrobe.name == expected.wardrobe,
                $"{label}wardrobe {asset.wardrobe?.name}");
            Require((asset.bag != "none") == expected.bag, $"{label}bag {asset.bag}");
            Require(asset.clips != null && asset.clips.Length == ExpectedClips.Length, $"{label}clip count");
            Require(asset.clips.Select(clip => clip.name).SequenceEqual(ExpectedClips), $"{label}clip names");
            foreach (var duration in asset.clips.Select(clip => clip.duration))
                Require(duration > 0.1f, $"{label}clip duration {duration}");
            Require(asset.clips.All(clip => clip.samples != null && clip.samples.Length >= 3),
                $"{label}clips need at least three sampled poses");
            Require(asset.anchors != null && asset.anchors.Select(anchor => anchor.name).SequenceEqual(ExpectedAnchors),
                $"{label}attachment points changed");
            Require(asset.bounds != null && asset.bounds.min != null && asset.bounds.max != null, $"{label}bounds missing");
            Require(Mathf.Abs(asset.bounds.size[1] - expected.height) < 0.01f, $"{label}manifest bounds height");
            Require(asset.triangles > 0 && asset.meshes > 0, $"{label}no geometry");
            Require(asset.validation != null && asset.validation.errors == 0 && asset.validation.warnings == 0,
                $"{label}GLB validation was not clean");
            if (expected.low)
            {
                Require(asset.scaleVariantOf == "passenger.adult", $"{label}low LOD source");
                Require(asset.triangles < parameters.lodFullTriangles * 0.6f, $"{label}low LOD triangles");
            }
            else
            {
                Require(string.IsNullOrEmpty(asset.scaleVariantOf), $"{label}unexpected scale variant {asset.scaleVariantOf}");
            }
        }

        private static Imported ImportAsset(Asset asset, Expected expected, string evidence)
        {
            string label = asset.prefab;
            string modelPath = $"{Folder}/{asset.file}";
            string glbPath = Path.Combine(evidence, "export", asset.file);
            Require(File.Exists(glbPath), $"{label}: missing {glbPath}");
            byte[] bytes = File.ReadAllBytes(glbPath);
            string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            Require(digest == CreateDigest(glbPath), $"{label}: GLB digest changed while reading");
            if (!File.Exists(modelPath) || !bytes.SequenceEqual(File.ReadAllBytes(modelPath)))
                File.WriteAllBytes(modelPath, bytes);

            AssetDatabase.ImportAsset(modelPath, ImportAssetOptions.ForceSynchronousImport);

            // The clip set is imported as legacy animation clips, so the model
            // root receives an Animation component that plays the default clip
            // (Idle) in the Web review. Setting the importer method is
            // deterministic: once Legacy is stored, later imports leave it alone.
            UseLegacyAnimation(modelPath);

            var model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            Require(model != null, $"{label}: glTFast did not produce a model");

            var renderers = model.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            Require(renderers.Length == asset.meshes, $"{label}: expected {asset.meshes} skinned meshes, got {renderers.Length}");
            Require(model.GetComponentsInChildren<MeshRenderer>(true).Length == 0, $"{label}: unskinned meshes in the rig");

            var materials = renderers.Select(renderer => renderer.sharedMaterials)
                .SelectMany(list => list).Where(material => material != null).Distinct()
                .Select(material => material.name).OrderBy(name => name, StringComparer.Ordinal).ToArray();
            var expectedMaterials = asset.materials.OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(expectedMaterials),
                $"{label}: materials {string.Join(",", materials)} != {string.Join(",", expectedMaterials)}");
            foreach (var renderer in renderers)
                Require(renderer.sharedMaterials.Length == 1, $"{label}: {renderer.name} does not have one material slot");

            int triangles = 0, vertices = 0, smoothVertices = 0;
            var meshBounds = new Bounds();
            bool hasBounds = false;
            foreach (var renderer in renderers)
            {
                var mesh = renderer.sharedMesh;
                Require(mesh != null, $"{label}: {renderer.name} has no mesh");
                Require(renderer.bones != null && renderer.bones.Length == ExpectedBones.Length,
                    $"{label}: {renderer.name} has {renderer.bones?.Length ?? 0} bones, expected {ExpectedBones.Length}");
                Require(renderer.bones.Select(bone => bone.name).SequenceEqual(ExpectedBones),
                    $"{label}: {renderer.name} bone names changed");
                Require(renderer.rootBone != null && renderer.rootBone.name == "Hips",
                    $"{label}: {renderer.name} root bone is {renderer.rootBone?.name}");
                Require(mesh.bindposes.Length == ExpectedBones.Length,
                    $"{label}: {renderer.name} has {mesh.bindposes.Length} bind poses");
                Require(mesh.bindposes.Count(pose => !Approximately(pose, Matrix4x4.identity)) >= 10,
                    $"{label}: {renderer.name} bind poses are all identity");
                Require(Mathf.Abs(renderer.transform.localPosition.magnitude) < 0.0001f &&
                        Quaternion.Angle(renderer.transform.localRotation, Quaternion.identity) < 0.01f,
                    $"{label}: {renderer.name} carries an unexpected transform");
                Require(Vector3.Distance(renderer.transform.lossyScale, Vector3.one) < 0.001f,
                    $"{label}: {renderer.name} is scaled {renderer.transform.lossyScale}");

                var weights = mesh.boneWeights;
                Require(weights.Length == mesh.vertexCount,
                    $"{label}: {renderer.name} bone weights {weights.Length} != vertices {mesh.vertexCount}");
                Require(weights.Length > 0, $"{label}: {renderer.name} has no vertices");
                foreach (var weight in weights)
                {
                    float sum = weight.weight0 + weight.weight1 + weight.weight2 + weight.weight3;
                    Require(Mathf.Abs(sum - 1f) < 0.002f,
                        $"{label}: {renderer.name} vertex weights sum to {sum:F4}");
                    int influences = 0;
                    if (weight.weight0 > 0.0001f) influences++;
                    if (weight.weight1 > 0.0001f) influences++;
                    if (weight.weight2 > 0.0001f) influences++;
                    if (weight.weight3 > 0.0001f) influences++;
                    Require(influences >= 1, $"{label}: {renderer.name} has an unweighted vertex");
                    if (influences >= 2) smoothVertices++;
                }
                vertices += mesh.vertexCount;
                triangles += mesh.triangles.Length / 3;
                if (!hasBounds) { meshBounds = mesh.bounds; hasBounds = true; }
                else meshBounds.Encapsulate(mesh.bounds);
            }
            Require(vertices == asset.vertices, $"{label}: expected {asset.vertices} vertices, got {vertices}");
            Require(triangles == asset.triangles, $"{label}: expected {asset.triangles} triangles, got {triangles}");
            Require(smoothVertices > vertices * 0.15f,
                $"{label}: only {smoothVertices}/{vertices} vertices blend more than one joint (skin is rigid)");

            // Mesh bounds are in the model root's space (mesh nodes are at the
            // origin); glTFast reflects X, so the manifest's X extremes swap.
            Require(hasBounds, $"{label}: no mesh bounds");
            var reflectedMin = new Vector3(-asset.bounds.max[0], asset.bounds.min[1], asset.bounds.min[2]);
            var reflectedMax = new Vector3(-asset.bounds.min[0], asset.bounds.max[1], asset.bounds.max[2]);
            Near(meshBounds.min, reflectedMin, $"{label} minimum bounds", 0.01f);
            Near(meshBounds.max, reflectedMax, $"{label} maximum bounds", 0.01f);
            Require(Mathf.Abs(meshBounds.size.y - expected.height) < 0.01f,
                $"{label}: mesh height {meshBounds.size.y:F3} != {expected.height:F3}");
            Require(Mathf.Abs(meshBounds.min.y) < 0.01f, $"{label}: feet are not on y = 0 ({meshBounds.min.y:F3})");

            // Attachment points ship inside the GLB, parented to their bone.
            foreach (var anchor in asset.anchors)
            {
                var node = FindNode(model, anchor.name);
                Require(node != null, $"{label}: missing attachment {anchor.name}");
                Require(node.parent != null && node.parent.name == anchor.bone,
                    $"{label}: {anchor.name} is not parented to {anchor.bone}");
                Near(node.localPosition, new Vector3(anchor.localPosition[0], anchor.localPosition[1], anchor.localPosition[2]),
                    $"{label} {anchor.name} local position", 0.001f);
            }

            // The imported animation clips are legacy so the Web crowd's
            // Animation components can play them in a build.
            var clipAssets = AssetDatabase.LoadAllAssetsAtPath(modelPath).OfType<AnimationClip>().ToArray();
            var clips = clipAssets.ToDictionary(clip => clip.name);
            Require(clips.Count == ExpectedClips.Length,
                $"{label}: expected {ExpectedClips.Length} clips, got {string.Join(",", clips.Keys)}");
            foreach (var info in asset.clips)
            {
                Require(clips.ContainsKey(info.name), $"{label}: missing clip {info.name}");
                var clip = clips[info.name];
                Require(Mathf.Abs(clip.length - info.duration) < 0.01f,
                    $"{label}: {info.name} lasts {clip.length:F3}s, expected {info.duration:F3}s");
                Require(clip.legacy, $"{label}: {info.name} is not a legacy clip");
                Require(AnimationUtility.GetCurveBindings(clip).Length > 0, $"{label}: {info.name} has no curves");
                // Every sampled pose must actually move a bone or attachment.
                if (info.samples.Length > 1)
                {
                    var first = info.samples[0];
                    bool Moved(BoneSample[] current, BoneSample[] baseline) => current.Any(sample =>
                    {
                        var start = baseline.First(other => other.name == sample.name);
                        return Vector3.Distance(Reflect(sample.position), Reflect(start.position)) > 0.005f;
                    });
                    var moved = info.samples.Skip(1).Any(sample =>
                        Moved(sample.bones, first.bones) || Moved(sample.attachments, first.attachments));
                    Require(moved, $"{label}: {info.name} never moves a bone");
                }
            }
            Require(clipAssets.Length == ExpectedClips.Length, $"{label}: extra imported clips");

            // Sample each clip on a scratch instance and compare every bone and
            // attachment against the exporter's world positions (X reflected).
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var preview = (GameObject)PrefabUtility.InstantiatePrefab(model);
            Require(preview != null, $"{label}: could not instantiate the model for sampling");
            foreach (var info in asset.clips)
            {
                var clip = clips[info.name];
                foreach (var sample in info.samples)
                {
                    clip.SampleAnimation(preview, Mathf.Min(sample.time, clip.length));
                    foreach (var bone in sample.bones)
                    {
                        var transform = FindNode(preview, bone.name);
                        Require(transform != null, $"{label}: missing bone {bone.name}");
                        Near(transform.position, Reflect(bone.position),
                            $"{label} {info.name}@{sample.time:F2}s {bone.name}", 0.005f);
                    }
                    foreach (var attachment in sample.attachments)
                    {
                        var transform = FindNode(preview, attachment.name);
                        Require(transform != null, $"{label}: missing attachment {attachment.name}");
                        Near(transform.position, Reflect(attachment.position),
                            $"{label} {info.name}@{sample.time:F2}s {attachment.name}", 0.005f);
                    }
                    float lowestSole = float.MaxValue;
                    foreach (var foot in sample.feet)
                    {
                        var transform = FindNode(preview, foot.name);
                        Require(transform != null, $"{label}: missing bone {foot.name}");
                        float sole = transform.position.y - asset.ankleHeightMetres;
                        Require(Mathf.Abs(sole - foot.sole) < 0.006f,
                            $"{label}: {info.name}@{sample.time:F2}s {foot.name} sole {sole:F3} != {foot.sole:F3}");
                        lowestSole = Mathf.Min(lowestSole, sole);
                    }
                    Require(Mathf.Abs(lowestSole - sample.lowestSole) < 0.006f,
                        $"{label}: {info.name}@{sample.time:F2}s lowest sole {lowestSole:F3} != {sample.lowestSole:F3}");
                    Require(lowestSole > -0.02f && lowestSole < 0.03f,
                        $"{label}: {info.name}@{sample.time:F2}s pushes a foot through the floor ({lowestSole:F3})");
                    if (info.contactTimes != null && info.contactTimes.Any(time => Mathf.Abs(time - sample.time) < 1e-4f))
                        Require(lowestSole < 0.01f,
                            $"{label}: {info.name}@{sample.time:F2}s contact frame has no planted foot ({lowestSole:F3})");
                }
            }
            UnityEngine.Object.DestroyImmediate(preview);

            // One wrapper prefab per asset: the imported model under a named root
            // (the GLB is authored Y-up, so no basis rotation is needed).
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var root = new GameObject(expected.prefab);
            var importedModel = (GameObject)PrefabUtility.InstantiatePrefab(model, root.transform);
            Require(importedModel != null, $"{label}: could not nest the imported model");
            importedModel.transform.localPosition = Vector3.zero;
            importedModel.transform.localRotation = Quaternion.identity;
            string prefabPath = $"{Folder}/{expected.prefab}.prefab";
            Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null, $"{label}: could not save wrapper prefab");
            UnityEngine.Object.DestroyImmediate(root);

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            Require(prefab != null, $"{label}: wrapper prefab did not load");
            Require(prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true).Length == asset.meshes,
                $"{label}: wrapper prefab lost skinned meshes");
            var animation = prefab.GetComponentInChildren<Animation>(true);
            Require(animation != null, $"{label}: model has no Animation component");
            Require(animation.clip != null && animation.clip.name == "Idle",
                $"{label}: default clip is {animation.clip?.name}, expected Idle");
            Require(animation.GetClipCount() == ExpectedClips.Length,
                $"{label}: Animation component has {animation.GetClipCount()} clips");

            return new Imported { expected = expected, manifest = asset, prefabPath = prefabPath, clips = clips };
        }

        /// <summary>
        /// glTFast can import clips for the legacy Animation component instead of
        /// Mecanim. A legacy import adds an Animation component to the model root
        /// with all clips, so the Web crowd animates without a controller asset
        /// (which promotion would not carry).
        /// </summary>
        private static void UseLegacyAnimation(string modelPath)
        {
            var importer = AssetImporter.GetAtPath(modelPath);
            Require(importer != null, $"No importer for {modelPath}");
            var serialized = new SerializedObject(importer);
            var property = serialized.FindProperty("importSettings.animationMethod");
            Require(property != null, $"{modelPath}: glTFast importer exposes no animationMethod");
            int legacy = Array.IndexOf(property.enumNames, "Legacy");
            Require(legacy >= 0, $"{modelPath}: glTFast AnimationMethod has no Legacy value");
            if (property.enumValueIndex == legacy) return;
            property.enumValueIndex = legacy;
            serialized.ApplyModifiedPropertiesWithoutUndo();
            AssetDatabase.WriteImportSettingsIfDirty(modelPath);
            AssetDatabase.ImportAsset(modelPath, ImportAssetOptions.ForceUpdate | ImportAssetOptions.ForceSynchronousImport);
        }

        /// <summary>
        /// One review scene: the four variants in a row in front, and a 24-instance
        /// crowd block behind them, posed from the exported clips. The crowd's
        /// Animation components keep their clip assignment, so the Web build shows
        /// clip motion as well as the wardrobe/hair/bag variants.
        /// </summary>
        private static void BuildReviewScene(List<Imported> imported)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);

            for (int i = 0; i < imported.Count; i++)
            {
                var entry = imported[i];
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(entry.prefabPath);
                Require(prefab != null, $"Missing prefab {entry.prefabPath}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.name = entry.expected.prefab;
                instance.transform.position = new Vector3(RowX[i], 0f, RowZ);
                instance.transform.rotation = Quaternion.identity;
            }

            for (int i = 0; i < CrowdCount; i++)
            {
                int column = i % 6, row = i / 6;
                var entry = imported[i % Count];
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(entry.prefabPath);
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.name = $"Crowd_{i:00}";
                float jitterX = ((i * 37) % 5 - 2) * 0.05f;
                float jitterZ = ((i * 53) % 5 - 2) * 0.05f;
                // Six columns wide enough that the outer crowd silhouettes reach
                // the left/right frame edges; the Web check needs a populated band
                // across the whole width, not just the row's centre.
                instance.transform.position = new Vector3(-6.6f + column * 2.64f + jitterX, 0f, -1.2f - row * 1.6f + jitterZ);
                instance.transform.rotation = Quaternion.Euler(0f, (i * 47) % 61 - 30f, 0f);

                var model = instance.transform.GetChild(0);
                var animation = model.GetComponent<Animation>();
                Require(animation != null, $"{instance.name}: crowd model lost its Animation component");
                string clipName = CrowdClips[i % CrowdClips.Length];
                var clip = entry.clips[clipName];
                animation.clip = clip;
                animation.wrapMode = WrapMode.Loop;
                PrefabUtility.RecordPrefabInstancePropertyModifications(animation);

                // Bake a varied editor pose from that clip as well, so the saved
                // scene reads as a crowd without entering Play mode.
                float time = clip.length * ((i % 4) / 4f);
                clip.SampleAnimation(model.gameObject, time);
                foreach (var bone in model.GetComponentsInChildren<Transform>(true))
                    PrefabUtility.RecordPrefabInstancePropertyModifications(bone);
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
                "Could not save the passenger review scene");
        }

        /// <summary>
        /// Reopen the saved scene and check what it contains: the four prefab
        /// instances in their row, a 24-instance crowd with clip assignments, the
        /// slate camera (far plane 150) and the key light the Web check depends on.
        /// </summary>
        private static void VerifyReviewScene(List<Imported> imported)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();

            for (int i = 0; i < imported.Count; i++)
            {
                var entry = imported[i];
                var instance = roots.SingleOrDefault(root => root.name == entry.expected.prefab);
                Require(instance != null, $"Review scene is missing the {entry.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == entry.prefabPath,
                    $"{entry.expected.prefab} is not an instance of {entry.prefabPath}");
                Near(instance.transform.position, new Vector3(RowX[i], 0f, RowZ), $"{entry.expected.prefab} row placement", 0.001f);
                Require(instance.GetComponentsInChildren<SkinnedMeshRenderer>(true).Length == entry.manifest.meshes,
                    $"{entry.expected.prefab} lost skinned meshes");
            }

            var crowd = roots.Where(root => root.name.StartsWith("Crowd_", StringComparison.Ordinal)).ToArray();
            Require(crowd.Length == CrowdCount, $"Review scene has {crowd.Length} crowd instances, expected {CrowdCount}");
            var crowdClips = new HashSet<string>();
            foreach (var instance in crowd)
            {
                Require(instance.GetComponentsInChildren<SkinnedMeshRenderer>(true).Length > 0,
                    $"{instance.name} has no skinned renderers");
                var animation = instance.GetComponentInChildren<Animation>(true);
                Require(animation != null && animation.clip != null, $"{instance.name} has no playing clip");
                crowdClips.Add(animation.clip.name);
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && imported.Any(entry => AssetDatabase.GetAssetPath(source) == entry.prefabPath),
                    $"{instance.name} is not an instance of a passenger prefab");
            }
            Require(crowdClips.Count >= 4, $"Crowd only uses {crowdClips.Count} clips: {string.Join(",", crowdClips)}");

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(Mathf.Abs(camera.fieldOfView - CameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(Mathf.Abs(camera.farClipPlane - CameraFarPlane) < 0.001f, $"Review camera far plane is {camera.farClipPlane}, expected {CameraFarPlane}");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Near(camera.transform.position, CameraPosition, "Review camera position", 0.001f);

            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 1, "Review scene is missing its directional key light");
        }

        private static string CreateDigest(string path)
        {
            using var sha = SHA256.Create();
            return BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(path))).Replace("-", "").ToLowerInvariant();
        }

        private static Transform FindNode(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>(true).FirstOrDefault(transform => transform.name == name);

        private static Vector3 Reflect(float[] v) => new Vector3(-v[0], v[1], v[2]);

        private static bool Approximately(Matrix4x4 a, Matrix4x4 b)
        {
            for (int i = 0; i < 16; i++)
                if (Mathf.Abs(a[i] - b[i]) > 1e-5f) return false;
            return true;
        }

        private static void Near(Vector3 actual, Vector3 expected, string field, float tolerance) =>
            Require(Vector3.Distance(actual, expected) < tolerance, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
