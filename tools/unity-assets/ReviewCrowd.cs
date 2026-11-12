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
    /// Import the soft-human crowd GLBs exported by export-crowd.mjs.
    ///
    /// The GLBs are the active game bake re-expressed as skinned meshes: the same
    /// 16-joint soft-human rig, the same source skin weights, the same baked
    /// palette regions and the same standing/walk/station-activity poses the
    /// TypeScript crowd renders. Everything is INTERNAL REVIEW ONLY: the base
    /// HumanBody_Alt.fbx carries no redistribution licence, so the production-rig
    /// row stays BLOCKED even though these review fixtures import cleanly.
    /// </summary>
    public static class ReviewCrowd
    {
        private const string Folder = "Assets/CrowdProof";
        private const string Scene = Folder + "/Crowd.unity";
        private const int Count = 8;
        private const int CrowdCount = 24;

        // The camera sits in front of the variant row (which faces +Z) and sees
        // the eight recipes and the 24-instance crowd block behind them.
        private static readonly Vector3 CameraPosition = new Vector3(0f, 3.1f, 12.4f);
        private static readonly Vector3 CameraTarget = new Vector3(0f, 0.95f, -0.9f);
        private const float CameraFieldOfView = 44f;
        private const float CameraFarPlane = 150f;
        private static readonly Color Slate = new Color(0.22f, 0.30f, 0.38f);
        private const float RowZ = 1.6f;
        private static readonly float[] RowX = { -7.35f, -5.25f, -3.15f, -1.05f, 1.05f, 3.15f, 5.25f, 7.35f };
        private static readonly string[] CrowdClips =
        {
            "Walk", "Idle", "WalkSlow", "Wait", "Queue", "WalkFast", "Shop", "Ticket", "Escalator", "Sit",
        };

        // glTFExporter writes skin.skeleton from bones[0]; the exporter permutes
        // the bake's joint table so the common-root Hips leads.
        private static readonly string[] ExpectedBones =
        {
            "Hips", "LeftHip", "LeftThigh", "LeftLeg", "RightHip", "RightThigh", "RightLeg",
            "Waist", "Chest", "Head", "LeftShoulder", "LeftArm", "LeftForearm",
            "RightShoulder", "RightArm", "RightForearm",
        };

        [Serializable]
        private class Manifest
        {
            public int schemaVersion;
            public string family;
            public Source source;
            public Rights rights;
            public Parameters parameters;
            public Asset[] assets;
            public Validation validation;
        }

        [Serializable]
        private class Source
        {
            public string path, sha256, recipeSha256, normalizedRecipeSha256;
        }

        [Serializable]
        private class Rights
        {
            public string status, source, license, production, note;
        }

        [Serializable]
        private class Parameters
        {
            public int models, recipeCount, boneCount, fitCount, sampleCount, walkFrames, frames, paletteCount;
            public float baseHeightMetres, meshHeightMetres;
            public float[] fits, clipDurations;
            public string[] handModes, activities, boneNames, bakeBoneNames, clips;
            public string rig, skinning, geometry, animation, rights, provenance;
            public WalkProfile[] walkProfiles;
            public Comparison comparison;
        }

        [Serializable]
        private class WalkProfile
        {
            public string name;
            public float speed, cycleSeconds, stride;
            public int firstFrame;
        }

        [Serializable]
        private class Comparison
        {
            public float activityMatrixMaxError, idleFrameMaxMetres, walkFrameMaxMetres, heldAccessoryMaxMetres, authoredSourceVertexMaxMetres;
            public string heldAccessory;
        }

        [Serializable]
        private class Asset
        {
            public int schemaVersion;
            public string id, family, prefab, file, role, recipe, outfit, character, hair, bag, garmentShape, detail, label, rights, units;
            public float fit, baseHeightMetres;
            public string[] handModes, authoredRegionColors;
            public float[] scale;
            public int triangles, vertices;
            public MaterialRegion[] materials;
            public BoundsInfo bounds;
            public Clip[] clips;
            public LowInfo low;
            public Comparison comparison;
            public Validation validation;
        }

        [Serializable]
        private class MaterialRegion
        {
            public string name, color;
            public int region, triangles;
        }

        [Serializable]
        private class BoundsInfo
        {
            public float[] min, max, size;
        }

        [Serializable]
        private class Clip
        {
            public string name;
            public float duration;
            public int keys;
            public Sample[] samples;
        }

        [Serializable]
        private class Sample
        {
            public float time;
            public float[] bones, scales;
        }

        [Serializable]
        private class LowInfo
        {
            public int triangles;
            public float ratio;
            public bool sharedVertexPool;
        }

        [Serializable]
        private class Validation
        {
            public int errors, warnings, infos;
        }

        private class Imported
        {
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
            Require(manifest != null && manifest.assets != null, "Unreadable export manifest");
            CheckManifest(manifest);

            Directory.CreateDirectory(Folder);
            var imported = new List<Imported>();
            var summary = new List<string>();
            foreach (var asset in manifest.assets)
            {
                var result = ImportAsset(asset, evidence);
                imported.Add(result);
                summary.Add($"{asset.prefab}={asset.triangles}t/{ExpectedBones.Length}b/{asset.clips.Length}c/{asset.fit:F2}f");
            }

            CheckLods(imported);
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"CROWD_RIGHTS INTERNAL_REVIEW_ONLY production-rig=BLOCKED " +
                      $"source={manifest.source.sha256.Substring(0, 12)} " +
                      $"recipe={manifest.source.recipeSha256.Substring(0, 12)} " +
                      "licence=game-extract-no-redistribution");
            Debug.Log($"CROWD_ASSET_COMPARISON walk={manifest.parameters.comparison.walkFrameMaxMetres:F6}m " +
                      $"idle={manifest.parameters.comparison.idleFrameMaxMetres:F6}m " +
                      $"activity={manifest.parameters.comparison.activityMatrixMaxError:E2} " +
                      $"held={manifest.parameters.comparison.heldAccessoryMaxMetres:F3}m " +
                      "game=passenger-approved.json+passenger-activities.json");
            Debug.Log($"CROWD_IMPORT_OK {imported.Count} soft-human recipes " +
                      $"rig={ExpectedBones.Length}bones clips={manifest.parameters.clips.Length} " +
                      $"activities={manifest.parameters.activities.Length}x{manifest.parameters.handModes.Length} " +
                      $"walkFrames={manifest.parameters.walkFrames} fits={manifest.parameters.fits.Length} " +
                      $"palette={manifest.parameters.paletteCount} row={RowX[0]:F1}..{RowX[Count - 1]:F1} crowd={CrowdCount}");
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

        private static void CheckManifest(Manifest manifest)
        {
            Require(manifest.family == "crowd", $"Family is {manifest.family}");
            Require(manifest.schemaVersion == 1, "Manifest schema version changed");
            var rights = manifest.rights;
            Require(rights != null, "The manifest is missing its rights record");
            Require(rights.status == "INTERNAL_REVIEW_ONLY", $"Rights status is {rights.status}");
            Require(rights.production != null && rights.production.Contains("BLOCKED"),
                "The manifest does not record the blocked production rig");
            Require(rights.license != null && rights.license.Contains("no redistribution"),
                "The manifest does not record the missing redistribution licence");
            Require(manifest.source != null && manifest.source.sha256 != null && manifest.source.sha256.Length == 64,
                "The manifest is missing its source hash");
            Require(manifest.source.recipeSha256 == manifest.source.normalizedRecipeSha256,
                "The source and line-ending-neutral recipe hashes disagree");

            var parameters = manifest.parameters;
            Require(parameters != null, "The manifest is missing its family parameters");
            Require(parameters.models == Count, $"Expected {Count} models, got {parameters.models}");
            Require(manifest.assets.Length == Count, $"Expected {Count} assets, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.id).Distinct().Count() == Count, "The manifest repeats an asset id");
            Require(parameters.recipeCount == 440, $"Expected 440 active recipes, got {parameters.recipeCount}");
            Require(parameters.boneCount == ExpectedBones.Length, $"Expected {ExpectedBones.Length} joints, got {parameters.boneCount}");
            Require(parameters.boneNames != null && parameters.boneNames.SequenceEqual(ExpectedBones),
                $"Joint names changed: {string.Join(",", parameters.boneNames ?? Array.Empty<string>())}");
            Require(parameters.fits != null && parameters.fits.Length == 8, "The bake height fits are incomplete");
            Require(parameters.handModes != null && parameters.handModes.SequenceEqual(new[] { "default", "right", "left" }),
                "Hand modes changed");
            Require(parameters.activities != null && parameters.activities.Length == 15, "Activity list changed");
            Require(parameters.clips != null && parameters.clips.Length == 49, $"Expected 49 clips, got {parameters.clips?.Length ?? 0}");
            Require(parameters.clips.Distinct().Count() == parameters.clips.Length, "Clip names repeat");
            Require(parameters.clipDurations != null && parameters.clipDurations.Length == parameters.clips.Length,
                "Clip durations are incomplete");
            Require(Mathf.Abs(parameters.baseHeightMetres - 1.7f) < 0.001f, $"Base height {parameters.baseHeightMetres}");
            Require(parameters.meshHeightMetres > 1.68f && parameters.meshHeightMetres < 1.78f,
                $"Mesh height {parameters.meshHeightMetres}");
            Require(parameters.paletteCount > 0, "The palette is empty");
            Require(parameters.comparison != null, "The manifest is missing its game comparison");
            Require(parameters.comparison.activityMatrixMaxError < 1e-4f,
                $"Baked activity palette replay error {parameters.comparison.activityMatrixMaxError}");
            Require(parameters.comparison.walkFrameMaxMetres < 0.005f,
                $"Exported walk differs from the game atlas by {parameters.comparison.walkFrameMaxMetres} m");
            Require(parameters.comparison.idleFrameMaxMetres < 0.005f,
                $"Exported standing pose differs from the game atlas by {parameters.comparison.idleFrameMaxMetres} m");
            Require(manifest.validation != null && manifest.validation.errors == 0 && manifest.validation.warnings == 0,
                "The GLBs did not validate clean");
            foreach (var asset in manifest.assets)
            {
                Require(asset.id.StartsWith("crowd.", StringComparison.Ordinal), $"Unexpected asset id {asset.id}");
                Require(asset.rights == "INTERNAL_REVIEW_ONLY", $"{asset.id}: rights {asset.rights}");
                Require(asset.recipe.StartsWith("soft-", StringComparison.Ordinal), $"{asset.id}: recipe {asset.recipe}");
                Require(asset.scale != null && asset.scale.Length == 3, $"{asset.id}: scale record");
                Require(asset.materials != null && asset.materials.Length >= 3, $"{asset.id}: material regions");
                Require(asset.clips != null && asset.clips.Length == parameters.clips.Length, $"{asset.id}: clip count");
                Require(asset.clips.Select(clip => clip.name).SequenceEqual(parameters.clips), $"{asset.id}: clip names");
                Require(asset.clips.All(clip => clip.samples != null && clip.samples.Length >= 2), $"{asset.id}: clip samples");
                Require(asset.validation != null && asset.validation.errors == 0 && asset.validation.warnings == 0,
                    $"{asset.id}: GLB validation was not clean");
                Require(asset.low != null && asset.low.ratio < 0.1f, $"{asset.id}: Low LOD ratio");
                Require(asset.comparison != null, $"{asset.id}: game comparison");
            }
        }

        private static Imported ImportAsset(Asset asset, string evidence)
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
            UseLegacyAnimation(modelPath);

            var model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            Require(model != null, $"{label}: glTFast did not produce a model");

            var renderers = model.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            Require(renderers.Length == 1, $"{label}: expected one skinned mesh, got {renderers.Length}");
            var renderer = renderers[0];
            Require(model.GetComponentsInChildren<MeshRenderer>(true).Length == 0, $"{label}: unskinned meshes in the rig");
            Require(renderer.bones != null && renderer.bones.Length == ExpectedBones.Length,
                $"{label}: {renderer.bones?.Length ?? 0} bones, expected {ExpectedBones.Length}");
            Require(renderer.bones.Select(bone => bone.name).SequenceEqual(ExpectedBones),
                $"{label}: bone order {string.Join(",", renderer.bones.Select(bone => bone.name))}");
            Require(renderer.rootBone != null && renderer.rootBone.name == "Hips",
                $"{label}: root bone is {renderer.rootBone?.name}");
            Require(Mathf.Abs(renderer.transform.localPosition.magnitude) < 1e-4f &&
                    Quaternion.Angle(renderer.transform.localRotation, Quaternion.identity) < 0.01f,
                $"{label}: skinned mesh carries a local transform");

            var mesh = renderer.sharedMesh;
            Require(mesh != null, $"{label}: renderer has no mesh");
            Require(mesh.bindposes.Length == ExpectedBones.Length, $"{label}: {mesh.bindposes.Length} bind poses");
            Require(mesh.bindposes.Count(pose => !Approximately(pose, Matrix4x4.identity)) >= 10,
                $"{label}: bind poses are mostly identity");
            Require(mesh.vertexCount == asset.vertices, $"{label}: {mesh.vertexCount} vertices, expected {asset.vertices}");
            Require(mesh.subMeshCount == asset.materials.Length,
                $"{label}: {mesh.subMeshCount} submeshes, expected {asset.materials.Length}");
            int triangles = 0;
            for (int index = 0; index < mesh.subMeshCount; index++) triangles += (int)(mesh.GetIndexCount(index) / 3);
            Require(triangles == asset.triangles, $"{label}: {triangles} triangles, expected {asset.triangles}");

            var weights = mesh.boneWeights;
            Require(weights.Length == mesh.vertexCount, $"{label}: weight count");
            int multi = 0;
            foreach (var weight in weights)
            {
                float sum = weight.weight0 + weight.weight1 + weight.weight2 + weight.weight3;
                Require(Mathf.Abs(sum - 1f) < 0.002f, $"{label}: vertex weights sum to {sum:F4}");
                int influences = 0;
                if (weight.weight0 > 1e-4f) influences++;
                if (weight.weight1 > 1e-4f) influences++;
                if (weight.weight2 > 1e-4f) influences++;
                if (weight.weight3 > 1e-4f) influences++;
                Require(influences >= 1, $"{label}: unweighted vertex");
                if (influences >= 2) multi++;
            }
            Require(multi > mesh.vertexCount * 0.1f,
                $"{label}: only {multi}/{mesh.vertexCount} vertices blend joints");

            // glTFast negates X on import; every X extreme swaps.
            var reflectedMin = new Vector3(-asset.bounds.max[0], asset.bounds.min[1], asset.bounds.min[2]);
            var reflectedMax = new Vector3(-asset.bounds.min[0], asset.bounds.max[1], asset.bounds.max[2]);
            Near(mesh.bounds.min, reflectedMin, $"{label} minimum bounds", 0.01f);
            Near(mesh.bounds.max, reflectedMax, $"{label} maximum bounds", 0.01f);
            Require(Mathf.Abs(mesh.bounds.min.y) < 0.01f, $"{label}: feet are not on y = 0");
            Require(Mathf.Abs(mesh.bounds.size.y - asset.bounds.size[1]) < 0.01f, $"{label}: bind height changed");

            var materials = renderer.sharedMaterials;
            Require(materials.Length == asset.materials.Length,
                $"{label}: {materials.Length} materials, expected {asset.materials.Length}");
            for (int index = 0; index < materials.Length; index++)
            {
                Require(materials[index] != null, $"{label}: empty material slot {index}");
                Require(materials[index].name == asset.materials[index].name,
                    $"{label}: material {index} is {materials[index].name}, expected {asset.materials[index].name}");
            }
            Require(asset.materials.Sum(material => material.triangles) == asset.triangles,
                $"{label}: material region triangles do not cover the mesh");

            var clipAssets = AssetDatabase.LoadAllAssetsAtPath(modelPath).OfType<AnimationClip>().ToArray();
            var clips = clipAssets.ToDictionary(clip => clip.name);
            Require(clipAssets.Length == asset.clips.Length,
                $"{label}: expected {asset.clips.Length} clips, got {string.Join(",", clips.Keys)}");
            foreach (var info in asset.clips)
            {
                Require(clips.ContainsKey(info.name), $"{label}: missing clip {info.name}");
                var clip = clips[info.name];
                Require(Mathf.Abs(clip.length - info.duration) < 0.01f,
                    $"{label}: {info.name} lasts {clip.length:F3}s, expected {info.duration:F3}s");
                Require(clip.legacy, $"{label}: {info.name} is not a legacy clip");
                Require(AnimationUtility.GetCurveBindings(clip).Length > 0, $"{label}: {info.name} has no curves");
            }

            // Sample every recorded game pose on a scratch instance: world joint
            // positions compare with X reflected, local scales compare directly.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var preview = (GameObject)PrefabUtility.InstantiatePrefab(model);
            Require(preview != null, $"{label}: could not instantiate the model for sampling");
            foreach (var info in asset.clips)
            {
                var clip = clips[info.name];
                foreach (var sample in info.samples)
                {
                    // Sampling at exactly clip.length makes Unity wrap to the
                    // first key; the recorded game pose is the final key.
                    clip.SampleAnimation(preview, Mathf.Min(sample.time, clip.length - 0.0001f));
                    for (int bone = 0; bone < ExpectedBones.Length; bone++)
                    {
                        var transform = FindNode(preview, ExpectedBones[bone]);
                        Require(transform != null, $"{label}: missing bone {ExpectedBones[bone]}");
                        var expected = new Vector3(-sample.bones[bone * 3], sample.bones[bone * 3 + 1], sample.bones[bone * 3 + 2]);
                        Near(transform.position, expected, $"{label} {info.name}@{sample.time:F2}s {ExpectedBones[bone]}", 0.005f);
                        if (sample.scales != null && sample.scales.Length >= ExpectedBones.Length * 3)
                        {
                            var scale = transform.localScale;
                            var expectedScale = new Vector3(sample.scales[bone * 3], sample.scales[bone * 3 + 1], sample.scales[bone * 3 + 2]);
                            Require(Vector3.Distance(scale, expectedScale) < 0.002f,
                                $"{label} {info.name}@{sample.time:F2}s {ExpectedBones[bone]} scale {scale} != {expectedScale}");
                        }
                    }
                }
            }
            UnityEngine.Object.DestroyImmediate(preview);

            // One wrapper prefab per recipe; the wrapper owns the approved age scale.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var root = new GameObject(asset.prefab);
            root.transform.localScale = new Vector3(asset.scale[0], asset.scale[1], asset.scale[2]);
            var importedModel = (GameObject)PrefabUtility.InstantiatePrefab(model, root.transform);
            Require(importedModel != null, $"{label}: could not nest the imported model");
            importedModel.transform.localPosition = Vector3.zero;
            importedModel.transform.localRotation = Quaternion.identity;
            string prefabPath = $"{Folder}/{asset.prefab}.prefab";
            Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null, $"{label}: could not save wrapper prefab");
            UnityEngine.Object.DestroyImmediate(root);

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            Require(prefab != null, $"{label}: wrapper prefab did not load");
            Require(prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true).Length == 1,
                $"{label}: wrapper prefab lost its skinned mesh");
            var animation = prefab.GetComponentInChildren<Animation>(true);
            Require(animation != null, $"{label}: model has no Animation component");
            Require(animation.clip != null && animation.clip.name == "Idle",
                $"{label}: default clip is {animation.clip?.name}, expected Idle");
            Require(animation.GetClipCount() == asset.clips.Length,
                $"{label}: Animation component has {animation.GetClipCount()} clips");

            // Age scale is the approved 65% height / 70% width child fit.
            if (asset.role == "child")
            {
                Require(prefab.transform.localScale.x > 0.69f && prefab.transform.localScale.x < 0.71f, $"{label}: child width");
                Require(prefab.transform.localScale.y > 0.64f && prefab.transform.localScale.y < 0.66f, $"{label}: child height");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                var childRenderer = instance.GetComponentInChildren<SkinnedMeshRenderer>(true);
                Require(childRenderer != null, $"{label}: child renderer");
                float expectedHeight = asset.bounds.size[1] * asset.scale[1];
                Require(Mathf.Abs(childRenderer.bounds.size.y - expectedHeight) < 0.02f,
                    $"{label}: child world height {childRenderer.bounds.size.y:F3} != {expectedHeight:F3}");
                UnityEngine.Object.DestroyImmediate(instance);
            }

            return new Imported { manifest = asset, prefabPath = prefabPath, clips = clips };
        }

        private static void CheckLods(List<Imported> imported)
        {
            var full = imported.First(entry => entry.manifest.id == "crowd.adult-commuter-daypack").manifest;
            var low = imported.First(entry => entry.manifest.id == "crowd.adult-commuter-daypack-low").manifest;
            Require(low.triangles < full.triangles * 0.12f,
                $"Low LOD is not light enough: {low.triangles} vs {full.triangles}");
            Require(low.triangles > 0, "Low LOD has no triangles");
            Require(low.materials.Select(material => material.name).SequenceEqual(full.materials.Select(material => material.name)),
                "Low LOD does not keep the full material regions");
            Require(low.low.sharedVertexPool, "Low LOD does not declare the shared baked vertex pool");
            Require(full.role == "adult-low" || full.role == "adult", "Unexpected LOD roles");
            Require(low.clips.Select(clip => clip.name).SequenceEqual(full.clips.Select(clip => clip.name)),
                "Low LOD does not share the clip set");
        }

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

        private static void BuildReviewScene(List<Imported> imported)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);

            for (int i = 0; i < imported.Count; i++)
            {
                var entry = imported[i];
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(entry.prefabPath);
                Require(prefab != null, $"Missing prefab {entry.prefabPath}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.name = entry.manifest.prefab;
                instance.transform.position = new Vector3(RowX[i], 0f, RowZ);
                instance.transform.rotation = Quaternion.identity;
            }

            for (int i = 0; i < CrowdCount; i++)
            {
                int column = i % 6, row = i / 6;
                var entry = imported[i % imported.Count];
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(entry.prefabPath);
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.name = $"Crowd_{i:00}";
                float jitterX = ((i * 37) % 5 - 2) * 0.05f;
                float jitterZ = ((i * 53) % 5 - 2) * 0.05f;
                instance.transform.position = new Vector3(-6.6f + column * 2.64f + jitterX, 0f, -1.2f - row * 1.7f + jitterZ);
                instance.transform.rotation = Quaternion.Euler(0f, (i * 47) % 61 - 30f, 0f);

                var model = instance.transform.GetChild(0);
                var animation = model.GetComponent<Animation>();
                Require(animation != null, $"{instance.name}: crowd model lost its Animation component");
                string clipName = CrowdClips[i % CrowdClips.Length];
                var clip = entry.clips[clipName];
                animation.clip = clip;
                animation.wrapMode = WrapMode.Loop;
                PrefabUtility.RecordPrefabInstancePropertyModifications(animation);

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
            key.intensity = 2.4f;
            key.transform.rotation = Quaternion.Euler(35f, -35f, 0f);
            var fill = new GameObject("Fill light").AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 1.0f;
            fill.transform.rotation = Quaternion.Euler(16f, 148f, 0f);

            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.5f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the crowd review scene");
        }

        private static void VerifyReviewScene(List<Imported> imported)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();

            for (int i = 0; i < imported.Count; i++)
            {
                var entry = imported[i];
                var instance = roots.SingleOrDefault(root => root.name == entry.manifest.prefab);
                Require(instance != null, $"Review scene is missing the {entry.manifest.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == entry.prefabPath,
                    $"{entry.manifest.prefab} is not an instance of {entry.prefabPath}");
                Near(instance.transform.position, new Vector3(RowX[i], 0f, RowZ), $"{entry.manifest.prefab} row placement", 0.001f);
                Require(instance.GetComponentsInChildren<SkinnedMeshRenderer>(true).Length == 1,
                    $"{entry.manifest.prefab} lost its skinned mesh");
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
                    $"{instance.name} is not an instance of a crowd prefab");
            }
            Require(crowdClips.Count >= 5, $"Crowd only uses {crowdClips.Count} clips: {string.Join(",", crowdClips)}");

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(Mathf.Abs(camera.fieldOfView - CameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(Mathf.Abs(camera.farClipPlane - CameraFarPlane) < 0.001f, "Review camera far plane changed");
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
