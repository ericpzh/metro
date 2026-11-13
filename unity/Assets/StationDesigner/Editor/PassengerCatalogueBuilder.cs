using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace Metro.Editor {
    /// <summary>
    /// Builds and validates the local soft-human <see cref="PassengerCatalogue"/>
    /// from the exact 440-row library manifest, and proves on import that every
    /// manifest row still resolves to its promoted prefab, model, rig and clip set.
    ///
    /// A row whose prefab, model or binding is missing **fails the build** with the
    /// recipe IDs listed. Nothing is quietly dropped and nothing falls back to the
    /// <c>passenger-adult.glb</c> stand-in. The catalogue asset is written inside the
    /// internal <see cref="PassengerCatalogue.InternalRoot"/>, so a public pack that
    /// excludes that folder cannot ship it.
    ///
    /// The asset is created on the first editor load that sees the manifest (and
    /// rebuilt when the manifest hash changes) because the EditMode tests read it as
    /// a normal project asset; `Metro/Passengers/*` reruns either step by hand.
    /// </summary>
    public static class PassengerCatalogueBuilder {
        public const string ManifestPath = PassengerCatalogue.ManifestPath;
        public const string AssetPath = PassengerCatalogue.AssetPath;

        /// <summary>Recipes the H1 proof must resolve by name, in evidence order.</summary>
        public static readonly string[] SpecimenRecipes = {
            "soft-male-commuter-none",
            "soft-female-tee-skirt-none",
            "soft-female-blouse-skirt-handbag-right",
            "soft-male-commuter-daypack",
            "soft-male-commuter-handbag-left",
        };

        /// <summary>
        /// The local-only WebGL sample catalogue (plan 11 H3). The full 440-row library is
        /// 719 MB of GLBs — far too much to ship even on loopback — so the local Web pack
        /// binds this spread of recipes: every H1 specimen plus evenly spaced rows across
        /// the manifest order. It is INTERNAL_REVIEW_ONLY and never packed publicly.
        /// </summary>
        public const string WebCohortPath = PassengerCatalogue.InternalRoot + "/passenger-catalogue-web.asset";

        /// <summary>Build the local WebGL cohort asset from the full catalogue. Returns a report line.</summary>
        public static string BuildWebCohort(int rows = 12) {
            var full = Ensure();
            if (full == null || full.Count < rows)
                throw new InvalidOperationException("The full passenger catalogue has " + (full != null ? full.Count : 0) + " rows; need at least " + rows + ".");
            var picked = new List<PassengerCatalogueEntry>();
            var used = new HashSet<string>(StringComparer.Ordinal);
            void Take(PassengerCatalogueEntry entry) {
                if (entry == null || string.IsNullOrEmpty(entry.recipe) || !used.Add(entry.recipe)) return;
                picked.Add(CloneEntry(entry, picked.Count));
            }
            foreach (var recipe in SpecimenRecipes)
                if (full.TryGet(recipe, out var specimen)) Take(specimen);
            for (int i = 0; i < rows; i++) {
                int at = (int)((long)i * full.Count / rows);
                if (full.TryGetAt(at, out var entry)) Take(entry);
            }
            if (picked.Count == 0) throw new InvalidOperationException("The Web cohort selected no recipes.");
            if (AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(WebCohortPath) == null)
                AssetDatabase.CopyAsset(AssetPath, WebCohortPath);
            var cohort = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(WebCohortPath);
            if (cohort == null) throw new InvalidOperationException("The Web cohort asset did not import: " + WebCohortPath);
            cohort.schemaVersion = full.schemaVersion;
            cohort.manifestPath = full.manifestPath;
            cohort.manifestSha256 = full.manifestSha256;
            cohort.family = full.family;
            cohort.rights = full.rights;
            cohort.sourcePath = full.sourcePath;
            cohort.sourceSha256 = full.sourceSha256;
            cohort.recipeSha256 = full.recipeSha256;
            cohort.clipSet = full.clipSet;
            cohort.entries = picked.ToArray();
            cohort.Invalidate();
            var verify = cohort.Verify();
            if (!verify.Ok)
                throw new InvalidOperationException("The Web cohort failed its structural check:\n  " + string.Join("\n  ", verify.Problems));
            EditorUtility.SetDirty(cohort);
            AssetDatabase.SaveAssets();
            AssetDatabase.ImportAsset(WebCohortPath, ImportAssetOptions.ForceSynchronousImport);
            return "path=" + WebCohortPath + " rows=" + cohort.Count + " recipes=" + string.Join(",", picked.ConvertAll(entry => entry.recipe));
        }

        static PassengerCatalogueEntry CloneEntry(PassengerCatalogueEntry source, int index) => new PassengerCatalogueEntry {
            index = index,
            recipe = source.recipe,
            sex = source.sex,
            outfit = source.outfit,
            accessory = source.accessory,
            accessoryType = source.accessoryType,
            accessorySide = source.accessorySide,
            garmentShape = source.garmentShape,
            modelPath = source.modelPath,
            prefabPath = source.prefabPath,
            prefab = source.prefab,
            assetSha256 = source.assetSha256,
            recipeSha256 = source.recipeSha256,
            adultEligible = source.adultEligible,
            childEligible = source.childEligible,
            fullDetail = source.fullDetail,
            lowDetail = source.lowDetail,
            triangles = source.triangles,
            lowTriangles = source.lowTriangles,
            baseHeightMetres = source.baseHeightMetres,
            assetHeightMetres = source.assetHeightMetres,
            rights = source.rights,
            bones = source.bones,
        };

        [MenuItem("Metro/Passengers/Build Local Web Cohort")]
        public static void BuildWebCohortMenu() {
            var report = BuildWebCohort();
            Debug.Log("PASSENGER_WEB_COHORT_OK " + report);
        }

        [Serializable]
        public sealed class BuildReport {
            public int entries, clips, clipsVerified, prefabsVerified, modelsVerified, specimens;
            public string manifestSha256, recipeSha256;
            public string[] problems = Array.Empty<string>();
            public override string ToString() =>
                entries + " entries, " + clips + " clips, " + prefabsVerified + " prefab bindings, " +
                modelsVerified + " model bindings, " + specimens + "/" + SpecimenRecipes.Length + " specimens";
        }

        // ------------------------------------------------------------------ menu

        [MenuItem("Metro/Passengers/Build Catalogue")]
        public static void BuildMenu() {
            var report = Generate();
            Debug.Log("PASSENGER_CATALOGUE_OK " + report);
        }

        [MenuItem("Metro/Passengers/Validate Catalogue")]
        public static void ValidateMenu() {
            var report = Validate();
            Debug.Log("PASSENGER_CATALOGUE_VALID " + report);
        }

        [MenuItem("Metro/Passengers/Report")]
        public static void ReportMenu() {
            var asset = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(AssetPath);
            if (asset == null) {
                Debug.LogError("PASSENGER_CATALOGUE_MISSING " + AssetPath + "; run Metro/Passengers/Build Catalogue");
                return;
            }
            var report = asset.Verify();
            Debug.Log(report.ToString());
            foreach (var specimen in SpecimenRecipes) {
                if (asset.TryGet(specimen, out var entry))
                    Debug.Log("SPECIMEN " + specimen + " prefab=" + entry.prefabPath + " sha=" + entry.assetSha256.Substring(0, 12) +
                        " simId=" + FirstSimIdFor(asset, specimen));
                else
                    Debug.LogError("SPECIMEN_MISSING " + specimen);
            }
        }

        // --------------------------------------------------------------- import

        /// <summary>
        /// First editor load after import: build once if the manifest is present and
        /// the asset is absent or stale. Failures are logged, never thrown from the
        /// import callback — the EditMode tests and the menu surface them properly.
        /// </summary>
        [InitializeOnLoadMethod]
        static void EnsureOnLoad() {
            EditorApplication.delayCall += TryEnsure;
        }

        static void TryEnsure() {
            // Wait for the import of the 440 GLBs and their prefabs; then build once.
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) {
                EditorApplication.delayCall += TryEnsure;
                return;
            }
            try {
                if (!File.Exists(ManifestPath)) return;
                var asset = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(AssetPath);
                if (asset != null && asset.manifestSha256 == ManifestSha256()) return;
                Generate();
            } catch (Exception error) {
                Debug.LogError("PASSENGER_CATALOGUE_FAILED " + error.Message);
            }
        }

        /// <summary>Build the catalogue when missing or stale; returns the current asset.</summary>
        public static PassengerCatalogue Ensure() {
            if (!File.Exists(ManifestPath)) throw new FileNotFoundException("Passenger manifest is missing", ManifestPath);
            var asset = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(AssetPath);
            if (asset != null && asset.manifestSha256 == ManifestSha256()) return asset;
            Generate();
            var created = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(AssetPath);
            if (created == null) throw new InvalidOperationException("Passenger catalogue did not import: " + AssetPath);
            return created;
        }

        // ---------------------------------------------------------------- build

        public static BuildReport Generate() {
            if (!File.Exists(ManifestPath))
                throw new FileNotFoundException("Passenger manifest is missing; the catalogue cannot be built", ManifestPath);
            var manifestText = File.ReadAllText(ManifestPath);
            var manifestSha = Sha256(manifestText);
            var manifest = JObject.Parse(manifestText);
            var problems = new List<string>();
            var report = new BuildReport {
                manifestSha256 = manifestSha,
                recipeSha256 = (string)manifest["source"]?["recipeSha256"] ?? "",
            };

            if ((string)manifest["family"] != "passenger-library") problems.Add("manifest family is not passenger-library");
            var rights = manifest["rights"];
            var rightsStatus = (string)rights?["status"] ?? "";
            if (rightsStatus != "INTERNAL_REVIEW_ONLY") problems.Add("rights status " + rightsStatus + " is not INTERNAL_REVIEW_ONLY");
            if (!((string)rights?["production"] ?? "").Contains("BLOCKED")) problems.Add("production rig is not recorded as BLOCKED");
            if (manifest["validation"]?["errors"] != null && Int(manifest["validation"]["errors"], 0) != 0)
                problems.Add("manifest validation errors " + Int(manifest["validation"]["errors"], 0));
            if (Int(manifest["parameters"]?["models"], 0) != 440) problems.Add("manifest parameters.models != 440");

            var rows = manifest["assets"] as JArray ?? new JArray();
            if (rows.Count != 440) problems.Add("manifest assets " + rows.Count + " != 440");
            var parameters = manifest["parameters"];
            var clipNames = (parameters?["clips"] as JArray)?.Select(token => (string)token).ToArray() ?? Array.Empty<string>();
            var clipDurations = (parameters?["clipDurations"] as JArray)?.Select(token => (double)token).ToArray() ?? Array.Empty<double>();
            var boneNames = (parameters?["boneNames"] as JArray)?.Select(token => (string)token).ToArray() ?? Array.Empty<string>();
            var walkProfiles = ReadWalkProfiles(parameters?["walkProfiles"] as JArray, problems);
            if (clipNames.Length != 49) problems.Add("manifest clip table " + clipNames.Length + " != 49");
            if (clipDurations.Length != clipNames.Length) problems.Add("manifest clip durations do not match the clip table");
            if (boneNames.Length != 16) problems.Add("manifest bone table " + boneNames.Length + " != 16");
            report.clips = clipNames.Length;

            var entries = new List<PassengerCatalogueEntry>();
            for (int i = 0; i < rows.Count; i++) {
                var row = rows[i];
                var recipe = (string)row["recipe"] ?? "";
                var entry = new PassengerCatalogueEntry {
                    index = i,
                    recipe = recipe,
                    sex = (string)row["sex"] ?? "",
                    outfit = (string)row["outfit"] ?? "",
                    accessory = (string)row["accessory"] ?? "",
                    accessoryType = (string)row["accessoryType"] ?? "none",
                    accessorySide = (string)row["accessorySide"] ?? "",
                    garmentShape = (string)row["garmentShape"] ?? "",
                    modelPath = (string)row["modelPath"] ?? "",
                    prefabPath = (string)row["prefabPath"] ?? "",
                    assetSha256 = (string)row["sha256"] ?? "",
                    recipeSha256 = report.recipeSha256,
                    // Every canonical row is the adult Full recipe; age and detail are
                    // runtime variants of this same ID (manifest `child`/`low` blocks).
                    adultEligible = true,
                    childEligible = true,
                    fullDetail = true,
                    lowDetail = Bool(row["low"]?["runtimeVariant"], false),
                    triangles = Int(row["triangles"], 0),
                    lowTriangles = Int(row["low"]?["triangles"], 0),
                    baseHeightMetres = Float(row["baseHeightMetres"], 1.70f),
                    assetHeightMetres = Float(row["assetHeightMetres"], 0f),
                    rights = (string)row["rights"] ?? "",
                    bones = (row["bones"] as JArray)?.Select(token => (string)token).ToArray() ?? Array.Empty<string>(),
                };
                if (string.IsNullOrEmpty(entry.recipe)) { problems.Add("row " + i + " has no recipe id"); continue; }
                if (string.IsNullOrEmpty(entry.prefabPath) || string.IsNullOrEmpty(entry.modelPath))
                    problems.Add(recipe + ": manifest row has no prefab/model path");
                if (string.IsNullOrEmpty(entry.assetSha256)) problems.Add(recipe + ": manifest row has no GLB hash");
                entries.Add(entry);
            }
            if (entries.Count != rows.Count)
                problems.Add("only " + entries.Count + " of " + rows.Count + " manifest rows have a recipe id");

            // Import bindings: one canonical clip set, then every row's prefab/model.
            PassengerClipSet clipSet = null;
            if (entries.Count > 0) {
                clipSet = LoadClipSet(entries[0].modelPath, clipNames, clipDurations, boneNames, walkProfiles, problems);
                if (clipSet != null) report.clipsVerified = clipSet.clips.Length;
            }
            try {
                for (int i = 0; i < entries.Count; i++) {
                    var entry = entries[i];
                    if (i % 25 == 0) EditorUtility.DisplayProgressBar("Passenger catalogue",
                        entry.recipe + " (" + (i + 1) + "/" + entries.Count + ")", (float)i / entries.Count);
                    var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(entry.prefabPath);
                    if (prefab == null) { problems.Add(entry.recipe + ": prefab did not import: " + entry.prefabPath); continue; }
                    entry.prefab = prefab;
                    if (prefab.name != entry.recipe) problems.Add(entry.recipe + ": prefab root is named " + prefab.name);
                    var model = AssetDatabase.LoadAssetAtPath<GameObject>(entry.modelPath);
                    if (model == null) problems.Add(entry.recipe + ": model did not import: " + entry.modelPath);
                    else report.modelsVerified++;
                    var binding = VerifyRig(prefab, boneNames);
                    if (binding != null) problems.Add(entry.recipe + ": " + binding);
                    else report.prefabsVerified++;
                    if (!string.Equals(entry.rights, "INTERNAL_REVIEW_ONLY", StringComparison.Ordinal))
                        problems.Add(entry.recipe + ": rights " + entry.rights + " is not INTERNAL_REVIEW_ONLY");
                }
            } finally {
                EditorUtility.ClearProgressBar();
            }
            report.entries = entries.Count;

            if (problems.Count > 0) {
                report.problems = problems.ToArray();
                throw new InvalidOperationException("Passenger catalogue build failed (" + problems.Count + " problems):\n  " +
                    string.Join("\n  ", problems.Take(40)) + (problems.Count > 40 ? "\n  ..." : ""));
            }

            var asset = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(AssetPath);
            if (asset == null) {
                var folder = Path.GetDirectoryName(AssetPath)?.Replace('\\', '/');
                if (!string.IsNullOrEmpty(folder) && !AssetDatabase.IsValidFolder(folder))
                    throw new InvalidOperationException("Passenger catalogue folder is missing: " + folder);
                asset = ScriptableObject.CreateInstance<PassengerCatalogue>();
                AssetDatabase.CreateAsset(asset, AssetPath);
            }
            asset.schemaVersion = 1;
            asset.manifestPath = ManifestPath;
            asset.manifestSha256 = manifestSha;
            asset.family = "passenger-library";
            asset.rights = rightsStatus;
            asset.sourcePath = (string)manifest["source"]?["path"] ?? "";
            asset.sourceSha256 = (string)manifest["source"]?["sha256"] ?? "";
            asset.recipeSha256 = report.recipeSha256;
            asset.clipSet = clipSet ?? new PassengerClipSet();
            asset.entries = entries.ToArray();
            asset.Invalidate();
            var verify = asset.Verify();
            if (!verify.Ok)
                throw new InvalidOperationException("Passenger catalogue failed its structural check:\n  " +
                    string.Join("\n  ", verify.Problems));
            EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssets();
            AssetDatabase.ImportAsset(AssetPath, ImportAssetOptions.ForceSynchronousImport);

            report.specimens = SpecimenRecipes.Count(recipe => entries.Any(entry => entry.recipe == recipe));
            if (report.specimens != SpecimenRecipes.Length)
                throw new InvalidOperationException("Passenger catalogue lost a specimen recipe: " +
                    string.Join(",", SpecimenRecipes.Where(recipe => entries.All(entry => entry.recipe != recipe))));
            Debug.Log("PASSENGER_CATALOGUE_BUILT " + report);
            // Report the identity each specimen is provable from. A throwaway in-memory
            // copy is used because the saved asset may have been reimported above.
            var probe = ScriptableObject.CreateInstance<PassengerCatalogue>();
            probe.entries = entries.ToArray();
            foreach (var specimen in SpecimenRecipes) {
                var row = entries.First(entry => entry.recipe == specimen);
                Debug.Log("PASSENGER_SPECIMEN " + specimen + " simId=" + FirstSimIdFor(probe, specimen) +
                    " sha=" + row.assetSha256.Substring(0, 12));
            }
            ScriptableObject.DestroyImmediate(probe);
            return report;
        }

        /// <summary>Compare the committed asset with the exact manifest and its bindings.</summary>
        public static BuildReport Validate() {
            if (!File.Exists(ManifestPath)) throw new FileNotFoundException("Passenger manifest is missing", ManifestPath);
            var asset = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(AssetPath);
            if (asset == null)
                throw new InvalidOperationException("Passenger catalogue is missing: " + AssetPath +
                    "; run Metro/Passengers/Build Catalogue");
            var problems = new List<string>();
            var manifestText = File.ReadAllText(ManifestPath);
            var manifestSha = Sha256(manifestText);
            if (asset.manifestSha256 != manifestSha)
                problems.Add("catalogue manifest hash " + asset.manifestSha256 + " != " + manifestSha);
            var verify = asset.Verify();
            problems.AddRange(verify.Problems ?? Array.Empty<string>());
            var manifest = JObject.Parse(manifestText);
            var rows = manifest["assets"] as JArray ?? new JArray();
            var committed = asset.entries ?? Array.Empty<PassengerCatalogueEntry>();
            if (committed.Length != rows.Count) problems.Add("catalogue entries " + committed.Length + " != manifest " + rows.Count);
            for (int i = 0; i < rows.Count && i < committed.Length; i++) {
                var row = rows[i];
                var entry = committed[i];
                string recipe = (string)row["recipe"];
                if (entry.recipe != recipe) { problems.Add("row " + i + ": " + entry.recipe + " != " + recipe); continue; }
                if (entry.prefabPath != (string)row["prefabPath"]) problems.Add(recipe + ": prefab path changed");
                if (entry.modelPath != (string)row["modelPath"]) problems.Add(recipe + ": model path changed");
                if (entry.assetSha256 != (string)row["sha256"]) problems.Add(recipe + ": GLB hash changed");
                if (entry.triangles != Int(row["triangles"], 0)) problems.Add(recipe + ": triangle count changed");
                if (entry.lowTriangles != Int(row["low"]?["triangles"], 0)) problems.Add(recipe + ": Low triangle count changed");
                if (entry.prefab == null) problems.Add(recipe + ": prefab reference is missing");
                else {
                    var binding = VerifyRig(entry.prefab, (manifest["parameters"]?["boneNames"] as JArray)?.Select(t => (string)t).ToArray() ?? Array.Empty<string>());
                    if (binding != null) problems.Add(recipe + ": " + binding);
                }
            }
            var clipNames = (manifest["parameters"]?["clips"] as JArray)?.Select(t => (string)t).ToArray() ?? Array.Empty<string>();
            for (int i = 0; i < clipNames.Length; i++) {
                if (asset.Clip(clipNames[i]) == null) problems.Add("clip set is missing " + clipNames[i]);
            }
            var specimens = SpecimenRecipes.Where(recipe => asset.TryGet(recipe, out _)).ToArray();
            if (specimens.Length != SpecimenRecipes.Length)
                problems.Add("missing specimen recipes: " + string.Join(",", SpecimenRecipes.Except(specimens)));
            if (problems.Count > 0)
                throw new InvalidOperationException("Passenger catalogue is stale (" + problems.Count + " problems):\n  " +
                    string.Join("\n  ", problems.Take(40)));
            return new BuildReport {
                entries = committed.Length, clips = asset.ClipCount, clipsVerified = asset.ClipCount,
                prefabsVerified = committed.Length, modelsVerified = committed.Length,
                specimens = specimens.Length, manifestSha256 = manifestSha, recipeSha256 = asset.recipeSha256,
            };
        }

        // ------------------------------------------------------------- bindings

        static PassengerClipSet LoadClipSet(string modelPath, string[] names, double[] durations, string[] bones,
            PassengerWalkProfileSpec[] walkProfiles, List<string> problems) {
            if (string.IsNullOrEmpty(modelPath)) { problems.Add("canonical model path is empty"); return null; }
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            if (model == null) { problems.Add("canonical model did not import: " + modelPath); return null; }
            var clipByPath = AssetDatabase.LoadAllAssetsAtPath(modelPath).OfType<AnimationClip>()
                .GroupBy(clip => clip.name, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
            if (clipByPath.Count != names.Length)
                problems.Add("canonical model " + modelPath + " has " + clipByPath.Count + " clips, expected " + names.Length);
            var clips = new AnimationClip[names.Length];
            var clipDurations = new float[names.Length];
            for (int i = 0; i < names.Length; i++) {
                if (!clipByPath.TryGetValue(names[i], out var clip)) {
                    problems.Add("canonical model is missing clip " + names[i]);
                    continue;
                }
                clips[i] = clip;
                clipDurations[i] = clip.length;
                if (i < durations.Length && Math.Abs(clip.length - durations[i]) > 0.02)
                    problems.Add("clip " + names[i] + " is " + clip.length.ToString("F3") + " s, manifest says " +
                        durations[i].ToString("F3") + " s");
            }
            var rig = model.GetComponentsInChildren<Transform>(true).Select(node => node.name).ToHashSet(StringComparer.Ordinal);
            for (int i = 0; i < bones.Length; i++) {
                if (!rig.Contains(bones[i])) problems.Add("canonical model is missing bone " + bones[i]);
            }
            var animation = model.GetComponentInChildren<Animation>(true);
            if (animation == null) problems.Add("canonical model has no legacy Animation component (animationMethod must stay Legacy)");
            var skin = model.GetComponentInChildren<SkinnedMeshRenderer>(true);
            if (skin == null) problems.Add("canonical model has no SkinnedMeshRenderer");
            return new PassengerClipSet {
                modelPath = modelPath,
                clips = clips,
                clipNames = names,
                clipDurations = clipDurations,
                bones = bones,
                walkFrames = 24,
                walkProfiles = walkProfiles,
            };
        }

        /// <summary>The manifest's own walk table, so stride/phase cannot drift from the bake.</summary>
        static PassengerWalkProfileSpec[] ReadWalkProfiles(JArray rows, List<string> problems) {
            if (rows == null || rows.Count != 3) {
                problems.Add("manifest walkProfiles must have three rows");
                return PassengerAppearance.DefaultWalkProfiles;
            }
            var profiles = new PassengerWalkProfileSpec[rows.Count];
            for (int i = 0; i < rows.Count; i++) {
                profiles[i] = new PassengerWalkProfileSpec {
                    name = (string)rows[i]["name"] ?? "",
                    speed = (double)rows[i]["speed"],
                    cycleSeconds = (double)rows[i]["cycleSeconds"],
                    stride = (double)rows[i]["stride"],
                    firstFrame = (int)rows[i]["firstFrame"],
                };
                if (!(profiles[i].stride > 0) || !(profiles[i].cycleSeconds > 0))
                    problems.Add("manifest walk profile " + i + " has a non-positive stride or cycle");
            }
            return profiles;
        }

        /// <summary>Every recipe must expose the same 16-bone legacy rig and one skinned mesh.</summary>
        static string VerifyRig(GameObject prefab, string[] boneNames) {
            if (prefab == null) return "prefab is null";
            var animation = prefab.GetComponentInChildren<Animation>(true);
            if (animation == null) return "no legacy Animation component";
            var skin = prefab.GetComponentInChildren<SkinnedMeshRenderer>(true);
            if (skin == null) return "no SkinnedMeshRenderer";
            var transforms = prefab.GetComponentsInChildren<Transform>(true);
            var names = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < transforms.Length; i++) names.Add(transforms[i].name);
            for (int i = 0; i < boneNames.Length; i++) {
                if (!names.Contains(boneNames[i])) return "missing bone " + boneNames[i];
            }
            return null;
        }

        static int FirstSimIdFor(PassengerCatalogue catalogue, string recipe) {
            for (int id = 0; id < 500000; id++) {
                if (catalogue.RecipeForSimId(id) == recipe) return id;
            }
            return -1;
        }

        static int Int(JToken token, int fallback) {
            if (token == null || token.Type == JTokenType.Null) return fallback;
            try { return (int)token; } catch (Exception) { return fallback; }
        }

        static float Float(JToken token, float fallback) {
            if (token == null || token.Type == JTokenType.Null) return fallback;
            try { return (float)token; } catch (Exception) { return fallback; }
        }

        static bool Bool(JToken token, bool fallback) {
            if (token == null || token.Type == JTokenType.Null) return fallback;
            try { return (bool)token; } catch (Exception) { return fallback; }
        }

        static string ManifestSha256() => Sha256(File.ReadAllText(ManifestPath));

        static string Sha256(string text) {
            using (var sha = SHA256.Create())
                return ToHex(sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(text)));
        }

        static string ToHex(byte[] bytes) {
            var builder = new System.Text.StringBuilder(bytes.Length * 2);
            for (int i = 0; i < bytes.Length; i++) builder.Append(bytes[i].ToString("x2", CultureInfo.InvariantCulture));
            return builder.ToString();
        }
    }
}
