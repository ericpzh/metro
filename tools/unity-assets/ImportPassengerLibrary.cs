using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Metro.AssetExample
{
    /// <summary>
    /// Build the 440-prefab soft-human passenger library from the GLBs exported by
    /// export-passenger-library.mjs.
    ///
    /// Every active recipe id gets one canonical adult (fit 1), Full-detail GLB and
    /// one wrapper prefab under Generated/Passengers/&lt;Male|Female&gt;/&lt;outfit&gt;/.
    /// The wrapper nests the imported glTF model, so the 16-joint skinned
    /// hierarchy, the baked material regions, the 49 standing/walk/activity clips
    /// and the accessory geometry all come from the GLB unchanged. Child
    /// proportions and Low topology stay runtime variants of the same recipe id.
    ///
    /// Everything is INTERNAL REVIEW ONLY: the base HumanBody_Alt.fbx carries no
    /// redistribution licence, so passenger-production-rig stays BLOCKED.
    ///
    /// Run headless against a scratch copy of the project:
    ///   Unity -batchmode -nographics -quit -projectPath &lt;scratch&gt; \
    ///     -executeMethod Metro.AssetExample.ImportPassengerLibrary.Import \
    ///     -metroPassengerExport &lt;export dir&gt; -metroPassengerReport &lt;report.json&gt;
    /// </summary>
    public static class ImportPassengerLibrary
    {
        private const int ExpectedRecipes = 440;
        private const int ExpectedBones = 16;
        private const int ExpectedClips = 49;
        private const string PassengerRoot = "Assets/StationDesigner/Generated/Passengers";

        // glTFExporter writes skin.skeleton from bones[0]; the exporter permutes
        // the bake's joint table so the common-root Hips leads.
        private static readonly string[] ExpectedBoneNames =
        {
            "Hips", "LeftHip", "LeftThigh", "LeftLeg", "RightHip", "RightThigh", "RightLeg",
            "Waist", "Chest", "Head", "LeftShoulder", "LeftArm", "LeftForearm",
            "RightShoulder", "RightArm", "RightForearm",
        };

        [Serializable] private class Manifest
        {
            public int schemaVersion;
            public string family;
            public Rights rights;
            public Parameters parameters;
            public Asset[] assets;
            public Validation validation;
            public Failure[] failures;
        }

        [Serializable] private class Rights
        {
            public string status, source, license, production, note;
        }

        [Serializable] private class Parameters
        {
            public int models, expected, recipeCount, boneCount, clipCount;
            public float baseHeightMetres;
            public string[] boneNames, bakeBoneNames, clips;
            public float[] clipDurations;
            public string[] handModes, activities;
        }

        [Serializable] private class Asset
        {
            public int schemaVersion, sequence, triangles, vertices, boneCount, clipCount, bytes;
            public string id, family, recipe, sex, sexFolder, outfit, outfitLabel, accessory, accessoryType,
                accessorySide, garmentShape, role, detail, modelPath, prefabPath, rights, units, skin, sha256;
            public float fit, baseHeightMetres, assetHeightMetres;
            public float[] scale;
            public string[] bones, handModes, authoredRegionColors;
            public MaterialRegion[] materials;
            public OutfitColors outfitColors;
            public RegionTriangles regionTriangles;
            public AccessoryRecord accessoryRecord;
            public BoundsInfo bounds;
            public Clip[] clips;
            public Validation validation;
        }

        [Serializable] private class OutfitColors
        {
            public string top, bottom, trim, tie, bag;
        }

        [Serializable] private class RegionTriangles
        {
            public int total, top, bottom, accessory;
        }

        [Serializable] private class AccessoryRecord
        {
            public string id, color;
            public int triangles;
            public int[] regions;
        }

        [Serializable] private class MaterialRegion
        {
            public string name, color;
            public int region, triangles;
        }

        [Serializable] private class BoundsInfo
        {
            public float[] min, max, size;
        }

        [Serializable] private class Clip
        {
            public string name;
            public float duration;
            public int keys;
        }

        [Serializable] private class Validation
        {
            public int errors, warnings, infos;
        }

        [Serializable] private class Failure
        {
            public string recipe, message;
        }

        [Serializable] private class RecipeReport
        {
            public string recipe, sex, outfit, accessory, modelPath, prefabPath, modelGuid, prefabGuid, sha256;
            public int triangles, vertices, regions, clips;
            public float heightMetres;
        }

        [Serializable] private class Report
        {
            public int schemaVersion = 1;
            public string family = "passenger-library";
            public string rights = "INTERNAL_REVIEW_ONLY";
            public string productionRig = "BLOCKED";
            public int expected, imported, passed, failed;
            public string[] errors;
            public RecipeReport[] recipes;
        }

        public static void Import()
        {
            var report = new Report { expected = ExpectedRecipes };
            var errors = new List<string>();
            string reportPath = Argument("-metroPassengerReport") ??
                Path.Combine(Directory.GetCurrentDirectory(), "passenger-library-build-report.json");
            try
            {
                string exportRoot = Argument("-metroPassengerExport") ??
                    Environment.GetEnvironmentVariable("METRO_PASSENGER_EXPORT");
                Require(!string.IsNullOrEmpty(exportRoot), "No passenger export directory was supplied");
                exportRoot = Path.GetFullPath(exportRoot);

                var manifest = ReadManifest(Path.Combine(exportRoot, "manifest.json"));
                CheckManifest(manifest);

                // 1. Stage every GLB with a pre-seeded glTFast .meta. Writing the
                //    meta before the import keeps the importer on the Legacy
                //    animation method without a second 440-file reimport pass.
                var staged = StageModels(manifest, exportRoot);
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                EnforceLegacyAnimation(staged);

                // 2. Copy the export records next to the assets so the rights and
                //    provenance travel with the library.
                CopyRecord(exportRoot, "manifest.json", PassengerRoot + "/passenger-library.manifest.json");
                CopyRecord(exportRoot, "coverage.md", PassengerRoot + "/passenger-library.coverage.md");
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

                // 3. Verify every imported model and save one wrapper prefab each.
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var recipes = new List<RecipeReport>();
                foreach (var asset in manifest.assets)
                {
                    try
                    {
                        recipes.Add(BuildRecipe(asset, exportRoot));
                    }
                    catch (Exception error)
                    {
                        errors.Add($"{asset.recipe}: {error.Message}");
                        Debug.LogError($"PASSENGER_LIBRARY_FAILED {asset.recipe}: {error}");
                    }
                }
                report.recipes = recipes.ToArray();
                report.imported = manifest.assets.Length;
                report.passed = recipes.Count;
                report.failed = errors.Count;
                report.errors = errors.ToArray();

                Require(errors.Count == 0, $"{errors.Count} recipes failed: {string.Join("; ", errors.Take(10))}");
                Require(recipes.Count == ExpectedRecipes, $"Built {recipes.Count} prefabs, expected {ExpectedRecipes}");

                // 4. Prove the library is complete and internally consistent.
                CheckLibrary(recipes);
                CheckRightsTravel(manifest);

                File.WriteAllText(reportPath, JsonUtility.ToJson(report, true) + "\n");
                Debug.Log($"PASSENGER_LIBRARY_RIGHTS INTERNAL_REVIEW_ONLY production-rig=BLOCKED " +
                          $"licence=game-extract-no-redistribution recipes={recipes.Count}");
                Debug.Log($"PASSENGER_LIBRARY_LAYOUT {PassengerRoot}/<Male|Female>/<outfit>/ " +
                          $"models={recipes.Count} prefabs={recipes.Count} " +
                          $"male={recipes.Count(entry => entry.sex == "male")} " +
                          $"female={recipes.Count(entry => entry.sex == "female")}");
                Debug.Log($"PASSENGER_LIBRARY_CLIPS {ExpectedClips} clips x {ExpectedBones} joints x {recipes.Count} prefabs; " +
                          $"one skinned mesh each, no merged skin");
                Debug.Log($"PASSENGER_LIBRARY {recipes.Count}/{ExpectedRecipes} PASS " +
                          $"report={reportPath}");
            }
            catch (Exception error)
            {
                report.failed = Math.Max(report.failed, 1);
                report.errors = errors.Concat(new[] { error.Message }).ToArray();
                Debug.LogError($"PASSENGER_LIBRARY FAIL {report.passed}/{ExpectedRecipes} {error}");
                File.WriteAllText(reportPath, JsonUtility.ToJson(report, true) + "\n");
                throw;
            }
        }

        private static Manifest ReadManifest(string path)
        {
            Require(File.Exists(path), $"Missing passenger manifest at {path}");
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(path));
            Require(manifest != null && manifest.assets != null, "Unreadable passenger manifest");
            return manifest;
        }

        private static void CheckManifest(Manifest manifest)
        {
            Require(manifest.family == "passenger-library", $"Family is {manifest.family}");
            Require(manifest.schemaVersion == 1, "Manifest schema version changed");
            var rights = manifest.rights;
            Require(rights != null, "The manifest is missing its rights record");
            Require(rights.status == "INTERNAL_REVIEW_ONLY", $"Rights status is {rights.status}");
            Require(rights.production != null && rights.production.Contains("BLOCKED"),
                "The manifest does not record the blocked production rig");
            Require(rights.license != null && rights.license.Contains("no redistribution"),
                "The manifest does not record the missing redistribution licence");
            Require(manifest.assets.Length == ExpectedRecipes,
                $"Expected {ExpectedRecipes} recipes, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.recipe).Distinct().Count() == ExpectedRecipes,
                "The manifest repeats a recipe id");
            Require(manifest.failures == null || manifest.failures.Length == 0,
                $"{manifest.failures?.Length ?? 0} recipes failed to export");
            Require(manifest.validation != null && manifest.validation.errors == 0 && manifest.validation.warnings == 0,
                "The GLBs did not validate clean");
            Require(manifest.parameters != null, "The manifest is missing its parameters");
            Require(manifest.parameters.boneCount == ExpectedBones, $"Expected {ExpectedBones} joints");
            Require(manifest.parameters.boneNames != null && manifest.parameters.boneNames.SequenceEqual(ExpectedBoneNames),
                $"Joint names changed: {string.Join(",", manifest.parameters.boneNames ?? Array.Empty<string>())}");
            Require(manifest.parameters.clipCount == ExpectedClips, $"Expected {ExpectedClips} clips");
            Require(manifest.parameters.clips != null && manifest.parameters.clips.Length == ExpectedClips,
                "The manifest clip list is incomplete");
            Require(Mathf.Abs(manifest.parameters.baseHeightMetres - 1.7f) < 0.001f,
                $"Base height {manifest.parameters.baseHeightMetres}");
            foreach (var asset in manifest.assets)
            {
                Require(asset.rights == "INTERNAL_REVIEW_ONLY", $"{asset.recipe}: rights {asset.rights}");
                Require(asset.role == "adult" && Mathf.Abs(asset.fit - 1f) < 0.0001f,
                    $"{asset.recipe}: role {asset.role} fit {asset.fit}");
                Require(asset.detail == "full", $"{asset.recipe}: detail {asset.detail}");
                Require(asset.scale != null && asset.scale.Length == 3, $"{asset.recipe}: scale record");
                Require(asset.modelPath.StartsWith(PassengerRoot + "/Models/", StringComparison.Ordinal),
                    $"{asset.recipe}: model path {asset.modelPath}");
                Require(asset.prefabPath.StartsWith(PassengerRoot + "/", StringComparison.Ordinal) &&
                        !asset.prefabPath.StartsWith(PassengerRoot + "/Models/", StringComparison.Ordinal),
                    $"{asset.recipe}: prefab path {asset.prefabPath}");
                Require(asset.prefabPath.EndsWith("/" + asset.recipe + ".prefab", StringComparison.Ordinal),
                    $"{asset.recipe}: prefab stem {asset.prefabPath}");
                Require(asset.modelPath.EndsWith("/" + asset.recipe + ".glb", StringComparison.Ordinal),
                    $"{asset.recipe}: model stem {asset.modelPath}");
                Require(asset.boneCount == ExpectedBones && asset.bones != null &&
                        asset.bones.SequenceEqual(ExpectedBoneNames), $"{asset.recipe}: joint table");
                Require(asset.clips != null && asset.clips.Length == ExpectedClips,
                    $"{asset.recipe}: {asset.clips?.Length ?? 0} clips");
                Require(asset.materials != null && asset.materials.Length >= 3, $"{asset.recipe}: material regions");
                Require(asset.validation != null && asset.validation.errors == 0 && asset.validation.warnings == 0,
                    $"{asset.recipe}: GLB validation was not clean");
                Require(asset.outfitColors != null, $"{asset.recipe}: outfit colours");
                Require(asset.regionTriangles != null && asset.regionTriangles.top > 0 && asset.regionTriangles.bottom > 0,
                    $"{asset.recipe}: outfit regions");
                Require(asset.accessoryRecord != null, $"{asset.recipe}: accessory record");
                if (asset.accessory == "none") Require(asset.accessoryRecord.triangles == 0, $"{asset.recipe}: unbagged accessory");
                else Require(asset.accessoryRecord.triangles > 0, $"{asset.recipe}: accessory has no geometry");
            }
        }

        private static string[] StageModels(Manifest manifest, string exportRoot)
        {
            string template = FindMetaTemplate();
            var staged = new List<string>();
            AssetDatabase.StartAssetEditing();
            try
            {
                foreach (var asset in manifest.assets)
                {
                    string source = Path.Combine(exportRoot, "Models",
                        asset.sexFolder, asset.outfit, asset.recipe + ".glb");
                    Require(File.Exists(source), $"{asset.recipe}: missing exported GLB {source}");
                    string directory = Full(asset.modelPath.Substring(0, asset.modelPath.LastIndexOf('/')));
                    Directory.CreateDirectory(directory);
                    string destination = Full(asset.modelPath);
                    byte[] bytes = File.ReadAllBytes(source);
                    if (!File.Exists(destination) || !File.ReadAllBytes(destination).SequenceEqual(bytes))
                        File.WriteAllBytes(destination, bytes);
                    string meta = destination + ".meta";
                    if (!File.Exists(meta)) File.WriteAllText(meta, MetaFor(template, asset.modelPath));
                    string digest = Digest(bytes);
                    Require(digest == asset.sha256, $"{asset.recipe}: staged GLB digest changed");
                    staged.Add(asset.modelPath);
                }
            }
            finally
            {
                AssetDatabase.StopAssetEditing();
            }
            Require(staged.Count == ExpectedRecipes, $"Staged {staged.Count} GLBs");
            return staged.ToArray();
        }

        /// <summary>Deterministic metadata GUID, so a rebuild keeps prefab references.</summary>
        private static string MetaFor(string template, string assetPath)
        {
            using var sha = SHA256.Create();
            string guid = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes("metro-passenger-library|" + assetPath)))
                .Replace("-", "").ToLowerInvariant().Substring(0, 32);
            return template.Replace("__GUID__", guid);
        }

        /// <summary>The glTFast scripted-importer metadata from an existing GLB.</summary>
        private static string FindMetaTemplate()
        {
            string[] candidates = Directory.GetFiles(Full("Assets/StationDesigner/Generated"),
                "*.glb.meta", SearchOption.AllDirectories);
            foreach (string candidate in candidates)
            {
                string text = File.ReadAllText(candidate);
                if (!text.Contains("ScriptedImporter") || !text.Contains("animationMethod")) continue;
                var builder = new StringBuilder();
                foreach (string line in text.Replace("\r\n", "\n").Split('\n'))
                {
                    if (line.StartsWith("guid: ", StringComparison.Ordinal)) builder.Append("guid: __GUID__\n");
                    else builder.Append(line + "\n");
                }
                return builder.ToString().TrimEnd('\n') + "\n";
            }
            throw new InvalidOperationException("No imported GLB metadata to copy the glTFast importer settings from");
        }

        private static void EnforceLegacyAnimation(string[] modelPaths)
        {
            int reimported = 0;
            foreach (string path in modelPaths)
            {
                var importer = AssetImporter.GetAtPath(path);
                Require(importer != null, $"No importer for {path}");
                var serialized = new SerializedObject(importer);
                var property = serialized.FindProperty("importSettings.animationMethod");
                Require(property != null, $"{path}: glTFast importer exposes no animationMethod");
                int legacy = Array.IndexOf(property.enumNames, "Legacy");
                Require(legacy >= 0, $"{path}: glTFast AnimationMethod has no Legacy value");
                if (property.enumValueIndex == legacy) continue;
                property.enumValueIndex = legacy;
                serialized.ApplyModifiedPropertiesWithoutUndo();
                AssetDatabase.WriteImportSettingsIfDirty(path);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate | ImportAssetOptions.ForceSynchronousImport);
                reimported++;
            }
            if (reimported > 0) Debug.Log($"PASSENGER_LIBRARY_IMPORT re-imported {reimported} models onto the Legacy animation method");
        }

        private static void CopyRecord(string exportRoot, string name, string destination)
        {
            string source = Path.Combine(exportRoot, name);
            Require(File.Exists(source), $"Missing export record {source}");
            Directory.CreateDirectory(Path.GetDirectoryName(destination) ?? ".");
            byte[] bytes = File.ReadAllBytes(source);
            if (!File.Exists(destination) || !File.ReadAllBytes(destination).SequenceEqual(bytes))
                File.WriteAllBytes(destination, bytes);
        }

        private static RecipeReport BuildRecipe(Asset asset, string exportRoot)
        {
            Require(!string.IsNullOrEmpty(asset.recipe), "Missing recipe id");
            Require(File.Exists(asset.modelPath), $"{asset.recipe}: {asset.modelPath} was not imported");

            var model = AssetDatabase.LoadAssetAtPath<GameObject>(asset.modelPath);
            Require(model != null, $"{asset.recipe}: glTFast did not produce a model");
            var renderers = model.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            Require(renderers.Length == 1, $"{asset.recipe}: expected one skinned mesh, got {renderers.Length}");
            var renderer = renderers[0];
            Require(model.GetComponentsInChildren<MeshRenderer>(true).Length == 0,
                $"{asset.recipe}: unskinned meshes in the rig");
            Require(renderer.bones != null && renderer.bones.Length == ExpectedBones,
                $"{asset.recipe}: {renderer.bones?.Length ?? 0} bones, expected {ExpectedBones}");
            Require(renderer.bones.Select(bone => bone.name).SequenceEqual(ExpectedBoneNames),
                $"{asset.recipe}: bone order {string.Join(",", renderer.bones.Select(bone => bone.name))}");
            Require(renderer.rootBone != null && renderer.rootBone.name == "Hips",
                $"{asset.recipe}: root bone is {renderer.rootBone?.name}");
            Require(Mathf.Abs(renderer.transform.localPosition.magnitude) < 1e-4f &&
                    Quaternion.Angle(renderer.transform.localRotation, Quaternion.identity) < 0.01f,
                $"{asset.recipe}: skinned mesh carries a local transform");

            var mesh = renderer.sharedMesh;
            Require(mesh != null, $"{asset.recipe}: renderer has no mesh");
            Require(mesh.bindposes.Length == ExpectedBones, $"{asset.recipe}: {mesh.bindposes.Length} bind poses");
            Require(mesh.bindposes.Count(pose => !Approximately(pose, Matrix4x4.identity)) >= 10,
                $"{asset.recipe}: bind poses are mostly identity");
            Require(mesh.vertexCount == asset.vertices,
                $"{asset.recipe}: {mesh.vertexCount} vertices, expected {asset.vertices}");
            Require(mesh.subMeshCount == asset.materials.Length,
                $"{asset.recipe}: {mesh.subMeshCount} submeshes, expected {asset.materials.Length}");
            int triangles = 0;
            for (int index = 0; index < mesh.subMeshCount; index++)
                triangles += (int)(mesh.GetIndexCount(index) / 3);
            Require(triangles == asset.triangles, $"{asset.recipe}: {triangles} triangles, expected {asset.triangles}");

            var weights = mesh.boneWeights;
            Require(weights.Length == mesh.vertexCount, $"{asset.recipe}: weight count");
            int multi = 0;
            foreach (var weight in weights)
            {
                float sum = weight.weight0 + weight.weight1 + weight.weight2 + weight.weight3;
                Require(Mathf.Abs(sum - 1f) < 0.002f, $"{asset.recipe}: vertex weights sum to {sum:F4}");
                int influences = 0;
                if (weight.weight0 > 1e-4f) influences++;
                if (weight.weight1 > 1e-4f) influences++;
                if (weight.weight2 > 1e-4f) influences++;
                if (weight.weight3 > 1e-4f) influences++;
                Require(influences >= 1, $"{asset.recipe}: unweighted vertex");
                if (influences >= 2) multi++;
            }
            Require(multi > mesh.vertexCount * 0.1f,
                $"{asset.recipe}: only {multi}/{mesh.vertexCount} vertices blend joints");

            // glTFast negates X on import; every X extreme swaps.
            var reflectedMin = new Vector3(-asset.bounds.max[0], asset.bounds.min[1], asset.bounds.min[2]);
            var reflectedMax = new Vector3(-asset.bounds.min[0], asset.bounds.max[1], asset.bounds.max[2]);
            Near(mesh.bounds.min, reflectedMin, $"{asset.recipe} minimum bounds", 0.01f);
            Near(mesh.bounds.max, reflectedMax, $"{asset.recipe} maximum bounds", 0.01f);
            Require(Mathf.Abs(mesh.bounds.min.y) < 0.01f, $"{asset.recipe}: feet are not on y = 0");
            Require(Mathf.Abs(mesh.bounds.size.y - asset.bounds.size[1]) < 0.01f,
                $"{asset.recipe}: bind height changed");
            // The canonical export is the 1.70 m adult at fit 1.
            Require(mesh.bounds.size.y > 1.68f && mesh.bounds.size.y < 1.78f,
                $"{asset.recipe}: adult height {mesh.bounds.size.y:F3} m");

            var materials = renderer.sharedMaterials;
            Require(materials.Length == asset.materials.Length,
                $"{asset.recipe}: {materials.Length} materials, expected {asset.materials.Length}");
            var colors = new HashSet<string>();
            for (int index = 0; index < materials.Length; index++)
            {
                Require(materials[index] != null, $"{asset.recipe}: empty material slot {index}");
                Require(materials[index].name == asset.materials[index].name,
                    $"{asset.recipe}: material {index} is {materials[index].name}, expected {asset.materials[index].name}");
                // Each glTF material is named for its baked palette region, so the
                // material name itself proves the region colour survived import.
                string suffix = materials[index].name.Substring(materials[index].name.LastIndexOf('-') + 1);
                Require("#" + suffix == asset.materials[index].color,
                    $"{asset.recipe}: material {index} colour {suffix} != {asset.materials[index].color}");
                colors.Add(suffix);
            }
            Require(asset.materials.Sum(material => material.triangles) == asset.triangles,
                $"{asset.recipe}: material region triangles do not cover the mesh");
            // Outfit palette: the top and bottom colours must both be present.
            Require(colors.Contains(asset.outfitColors.top.TrimStart('#')),
                $"{asset.recipe}: the outfit top colour {asset.outfitColors.top} is missing");
            Require(colors.Contains(asset.outfitColors.bottom.TrimStart('#')),
                $"{asset.recipe}: the outfit bottom colour {asset.outfitColors.bottom} is missing");
            if (asset.accessory != "none")
            {
                Require(asset.accessoryRecord.color != null &&
                        colors.Contains(asset.accessoryRecord.color.TrimStart('#')),
                    $"{asset.recipe}: the {asset.accessory} accessory colour is missing");
                Require(asset.accessoryRecord.regions != null && asset.accessoryRecord.regions.Length > 0,
                    $"{asset.recipe}: the {asset.accessory} accessory has no material region");
                int accessoryTriangles = asset.materials
                    .Where(material => material.color == asset.accessoryRecord.color)
                    .Sum(material => material.triangles);
                Require(accessoryTriangles == asset.accessoryRecord.triangles,
                    $"{asset.recipe}: accessory triangles {accessoryTriangles} != {asset.accessoryRecord.triangles}");
            }
            else
            {
                Require(asset.materials.All(material => material.color != asset.outfitColors.bag),
                    $"{asset.recipe}: an unbagged recipe still carries bag geometry");
            }

            var clipAssets = AssetDatabase.LoadAllAssetsAtPath(asset.modelPath).OfType<AnimationClip>().ToArray();
            var clips = clipAssets.ToDictionary(clip => clip.name);
            Require(clipAssets.Length == ExpectedClips,
                $"{asset.recipe}: expected {ExpectedClips} clips, got {clipAssets.Length}");
            foreach (var info in asset.clips)
            {
                Require(clips.ContainsKey(info.name), $"{asset.recipe}: missing clip {info.name}");
                var clip = clips[info.name];
                Require(Mathf.Abs(clip.length - info.duration) < 0.01f,
                    $"{asset.recipe}: {info.name} lasts {clip.length:F3}s, expected {info.duration:F3}s");
                Require(clip.legacy, $"{asset.recipe}: {info.name} is not a legacy clip");
                Require(AnimationUtility.GetCurveBindings(clip).Length > 0, $"{asset.recipe}: {info.name} has no curves");
            }

            var animation = model.GetComponent<Animation>() ?? model.GetComponentInChildren<Animation>(true);
            Require(animation != null, $"{asset.recipe}: model has no Animation component");
            Require(animation.clip != null && animation.clip.name == "Idle",
                $"{asset.recipe}: default clip is {animation.clip?.name}, expected Idle");
            Require(animation.GetClipCount() == ExpectedClips,
                $"{asset.recipe}: Animation component has {animation.GetClipCount()} clips");

            // One wrapper prefab per recipe; the wrapper owns the runtime scale.
            var root = new GameObject(asset.recipe);
            root.transform.localScale = new Vector3(asset.scale[0], asset.scale[1], asset.scale[2]);
            var importedModel = (GameObject)PrefabUtility.InstantiatePrefab(model, root.transform);
            Require(importedModel != null, $"{asset.recipe}: could not nest the imported model");
            importedModel.transform.localPosition = Vector3.zero;
            importedModel.transform.localRotation = Quaternion.identity;
            string prefabDirectory = asset.prefabPath.Substring(0, asset.prefabPath.LastIndexOf('/'));
            Directory.CreateDirectory(prefabDirectory);
            var saved = PrefabUtility.SaveAsPrefabAsset(root, asset.prefabPath);
            UnityEngine.Object.DestroyImmediate(root);
            Require(saved != null && File.Exists(Full(asset.prefabPath)),
                $"{asset.recipe}: could not save wrapper prefab");

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(asset.prefabPath);
            Require(prefab != null, $"{asset.recipe}: wrapper prefab did not load");
            Require(prefab.name == asset.recipe, $"{asset.recipe}: prefab root is {prefab.name}");
            Require(prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true).Length == 1,
                $"{asset.recipe}: wrapper prefab lost its skinned mesh");
            Require(prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true)[0].bones.Length == ExpectedBones,
                $"{asset.recipe}: wrapper prefab lost joints");
            Require(Vector3.Distance(prefab.transform.localScale, Vector3.one) < 1e-4f,
                $"{asset.recipe}: canonical adult prefab carries a scale");
            var prefabAnimation = prefab.GetComponentInChildren<Animation>(true);
            Require(prefabAnimation != null && prefabAnimation.GetClipCount() == ExpectedClips,
                $"{asset.recipe}: wrapper prefab lost clips");
            foreach (var material in prefab.GetComponentsInChildren<Renderer>(true)
                         .SelectMany(entry => entry.sharedMaterials))
                Require(material != null, $"{asset.recipe}: wrapper prefab has a missing material");

            // The wrapper must reference the imported GLB, not a copy of its mesh.
            string modelGuid = AssetDatabase.AssetPathToGUID(asset.modelPath);
            Require(!string.IsNullOrEmpty(modelGuid), $"{asset.recipe}: the GLB has no asset GUID");
            Require(File.ReadAllText(asset.prefabPath).Contains(modelGuid),
                $"{asset.recipe}: the prefab does not reference the GLB GUID {modelGuid}");
            var prefabModel = prefab.transform.childCount > 0 ? prefab.transform.GetChild(0).gameObject : null;
            Require(prefabModel != null, $"{asset.recipe}: the prefab has no nested model");
            var source = PrefabUtility.GetCorrespondingObjectFromSource(prefabModel);
            Require(source != null && AssetDatabase.GetAssetPath(source) == asset.modelPath,
                $"{asset.recipe}: the nested model is not the imported GLB");

            return new RecipeReport
            {
                recipe = asset.recipe,
                sex = asset.sex,
                outfit = asset.outfit,
                accessory = asset.accessory,
                modelPath = asset.modelPath,
                prefabPath = asset.prefabPath,
                modelGuid = modelGuid,
                prefabGuid = AssetDatabase.AssetPathToGUID(asset.prefabPath),
                sha256 = asset.sha256,
                triangles = triangles,
                vertices = mesh.vertexCount,
                regions = asset.materials.Length,
                clips = clipAssets.Length,
                heightMetres = mesh.bounds.size.y,
            };
        }

        /// <summary>
        /// Re-check an already promoted library in place: every prefab must resolve
        /// against its imported GLB, keep the 16-joint skin, the material regions,
        /// the 49 legacy clips and the canonical adult height. This is the check to
        /// run after the assets are copied into the real project, or after any
        /// clean re-import of the promoted files.
        /// </summary>
        public static void Verify()
        {
            var manifest = ReadManifest(Full(PassengerRoot + "/passenger-library.manifest.json"));
            CheckManifest(manifest);
            var errors = new List<string>();
            var seen = new HashSet<string>();
            int passed = 0;
            foreach (var asset in manifest.assets)
            {
                try
                {
                    Require(seen.Add(asset.recipe), $"{asset.recipe}: duplicate recipe id");
                    Require(File.Exists(Full(asset.prefabPath)), $"{asset.recipe}: missing {asset.prefabPath}");
                    var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(asset.prefabPath);
                    Require(prefab != null, $"{asset.recipe}: prefab did not load");
                    Require(prefab.name == asset.recipe, $"{asset.recipe}: prefab root is {prefab.name}");
                    Require(Vector3.Distance(prefab.transform.localScale, Vector3.one) < 1e-4f,
                        $"{asset.recipe}: canonical prefab carries a scale");
                    var renderers = prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true);
                    Require(renderers.Length == 1, $"{asset.recipe}: {renderers.Length} skinned meshes");
                    var renderer = renderers[0];
                    Require(renderer.bones != null && renderer.bones.Length == ExpectedBones,
                        $"{asset.recipe}: {renderer.bones?.Length ?? 0} joints");
                    Require(renderer.bones.Select(bone => bone.name).SequenceEqual(ExpectedBoneNames),
                        $"{asset.recipe}: joint order");
                    Require(renderer.rootBone != null && renderer.rootBone.name == "Hips",
                        $"{asset.recipe}: root bone");
                    var mesh = renderer.sharedMesh;
                    Require(mesh != null, $"{asset.recipe}: no mesh");
                    Require(mesh.vertexCount == asset.vertices,
                        $"{asset.recipe}: {mesh.vertexCount} vertices, expected {asset.vertices}");
                    Require(mesh.subMeshCount == asset.materials.Length,
                        $"{asset.recipe}: {mesh.subMeshCount} submeshes");
                    int triangles = 0;
                    for (int index = 0; index < mesh.subMeshCount; index++)
                        triangles += (int)(mesh.GetIndexCount(index) / 3);
                    Require(triangles == asset.triangles, $"{asset.recipe}: {triangles} triangles");
                    Require(mesh.bounds.size.y > 1.68f && mesh.bounds.size.y < 1.78f,
                        $"{asset.recipe}: height {mesh.bounds.size.y:F3} m");
                    Require(Mathf.Abs(mesh.bounds.min.y) < 0.01f, $"{asset.recipe}: feet are not on y = 0");

                    var materials = renderer.sharedMaterials;
                    Require(materials.Length == asset.materials.Length,
                        $"{asset.recipe}: {materials.Length} materials");
                    var colors = new HashSet<string>();
                    for (int index = 0; index < materials.Length; index++)
                    {
                        Require(materials[index] != null, $"{asset.recipe}: empty material slot {index}");
                        Require(materials[index].name == asset.materials[index].name,
                            $"{asset.recipe}: material {index} is {materials[index].name}");
                        colors.Add(materials[index].name.Substring(materials[index].name.LastIndexOf('-') + 1));
                    }
                    Require(colors.Contains(asset.outfitColors.top.TrimStart('#')),
                        $"{asset.recipe}: outfit top colour missing");
                    Require(colors.Contains(asset.outfitColors.bottom.TrimStart('#')),
                        $"{asset.recipe}: outfit bottom colour missing");
                    if (asset.accessory != "none")
                        Require(colors.Contains(asset.accessoryRecord.color.TrimStart('#')),
                            $"{asset.recipe}: accessory colour missing");

                    var model = AssetDatabase.LoadAssetAtPath<GameObject>(asset.modelPath);
                    Require(model != null, $"{asset.recipe}: {asset.modelPath} did not import");
                    var prefabModel = prefab.transform.childCount > 0 ? prefab.transform.GetChild(0).gameObject : null;
                    Require(prefabModel != null, $"{asset.recipe}: prefab has no nested model");
                    var source = PrefabUtility.GetCorrespondingObjectFromSource(prefabModel);
                    Require(source != null && AssetDatabase.GetAssetPath(source) == asset.modelPath,
                        $"{asset.recipe}: the nested model is not {asset.modelPath}");
                    string modelGuid = AssetDatabase.AssetPathToGUID(asset.modelPath);
                    Require(!string.IsNullOrEmpty(modelGuid) && File.ReadAllText(Full(asset.prefabPath)).Contains(modelGuid),
                        $"{asset.recipe}: the prefab does not reference the GLB GUID");

                    var clips = AssetDatabase.LoadAllAssetsAtPath(asset.modelPath).OfType<AnimationClip>().ToArray();
                    Require(clips.Length == ExpectedClips, $"{asset.recipe}: {clips.Length} clips");
                    Require(clips.All(clip => clip.legacy), $"{asset.recipe}: clips are not legacy");
                    Require(clips.Select(clip => clip.name).OrderBy(name => name, StringComparer.Ordinal)
                            .SequenceEqual(asset.clips.Select(clip => clip.name).OrderBy(name => name, StringComparer.Ordinal)),
                        $"{asset.recipe}: clip names changed");
                    passed++;
                }
                catch (Exception error)
                {
                    errors.Add($"{asset.recipe}: {error.Message}");
                }
            }
            Require(errors.Count == 0,
                $"PASSENGER_LIBRARY_VERIFY FAIL {passed}/{ExpectedRecipes}: {string.Join("; ", errors.Take(10))}");
            Require(passed == ExpectedRecipes, $"Verified {passed} prefabs, expected {ExpectedRecipes}");
            Debug.Log($"PASSENGER_LIBRARY_VERIFY {passed}/{ExpectedRecipes} PASS " +
                      $"male={manifest.assets.Count(asset => asset.sex == "male")} " +
                      $"female={manifest.assets.Count(asset => asset.sex == "female")} " +
                      $"clips={ExpectedClips} joints={ExpectedBones} rights=INTERNAL_REVIEW_ONLY production=BLOCKED");
        }

        private static void CheckLibrary(List<RecipeReport> recipes)
        {
            Require(recipes.Select(entry => entry.recipe).Distinct().Count() == ExpectedRecipes,
                "A recipe id repeats in the library");
            Require(recipes.Select(entry => entry.prefabPath).Distinct().Count() == ExpectedRecipes,
                "A prefab path repeats in the library");
            Require(recipes.Select(entry => entry.modelPath).Distinct().Count() == ExpectedRecipes,
                "A model path repeats in the library");
            foreach (var entry in recipes)
            {
                Require(entry.clips == ExpectedClips, $"{entry.recipe}: {entry.clips} clips");
                Require(entry.heightMetres > 1.68f && entry.heightMetres < 1.78f,
                    $"{entry.recipe}: height {entry.heightMetres:F3}");
            }
            Require(recipes.Count(entry => entry.sex == "male") == 220, "The male recipes are incomplete");
            Require(recipes.Count(entry => entry.sex == "female") == 220, "The female recipes are incomplete");
            Require(recipes.Count(entry => entry.accessory == "none") == 40, "The unbagged recipes are incomplete");
            foreach (var group in recipes.GroupBy(entry => entry.sex + "/" + entry.outfit))
                Require(group.Count() == 11, $"{group.Key}: {group.Count()} accessories, expected 11");
        }

        /// <summary>The rights record has to travel into the project, not just the export.</summary>
        private static void CheckRightsTravel(Manifest manifest)
        {
            string manifestPath = PassengerRoot + "/passenger-library.manifest.json";
            Require(File.Exists(manifestPath), $"Missing {manifestPath}");
            string text = File.ReadAllText(manifestPath);
            Require(text.Contains("INTERNAL_REVIEW_ONLY"), "The promoted manifest lost its rights label");
            Require(text.Contains("BLOCKED"), "The promoted manifest lost the blocked production rig");
            var promoted = JsonUtility.FromJson<Manifest>(text);
            Require(promoted != null && promoted.assets != null && promoted.assets.Length == manifest.assets.Length,
                "The promoted manifest lost assets");
        }

        private static string Argument(string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int index = 0; index < args.Length - 1; index++)
                if (args[index] == name) return args[index + 1];
            return null;
        }

        private static string Full(string assetPath) =>
            Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), assetPath));

        private static string Digest(byte[] bytes)
        {
            using var sha = SHA256.Create();
            return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }

        private static bool Approximately(Matrix4x4 a, Matrix4x4 b)
        {
            for (int index = 0; index < 16; index++)
                if (Mathf.Abs(a[index] - b[index]) > 1e-5f) return false;
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
