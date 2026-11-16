using System;
using System.Collections.Generic;
using System.IO;
using Metro.App;
using Metro.View;
using Unity.Pipeline.Commands;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Metro.Editor {
    /// <summary>
    /// The project's **single** scene, <c>StationGameLocal.unity</c>, and the local
    /// passenger binding that the Editor applies to it. The scene on disk never
    /// references the internal soft-human catalogue (see
    /// <c>unity/tests/passenger-profile.test.mjs</c>); instead it carries one root
    /// (<see cref="RootName"/>) with a <see cref="PassengerCatalogueAnchor"/> whose
    /// catalogue field is left null. The Editor injects the 440-row catalogue when Play
    /// Mode starts (<c>Editor/LocalPassengerInjection.cs</c>), so the shipped scene
    /// stays free of every internal passenger asset.
    ///
    /// This file verifies that marker, and generates the equally local-only WebGL
    /// derivative <c>StationGameLocalWeb.unity</c> that binds the small cohort
    /// catalogue for loopback testing.
    ///
    /// CLI: `metro station_local_scene` (see <c>unity/scripts/metro-editor.ps1</c>).
    /// </summary>
    public static class StationLocalProfile {
        public const string LocalScenePath = StationGameScene.ScenePath;
        public const string RootName = "PassengerProfile";

        [MenuItem("Metro/Station Game/Generate Local Passenger Scene")]
        public static void Generate() {
            var report = GenerateReport();
            Debug.Log("STATION_LOCAL_SCENE_OK " + report);
        }

        /// <summary>
        /// Ensure the single scene carries its passenger marker and return the facts a
        /// verifier prints. Re-running is idempotent: the anchor is reused in place and
        /// the catalogue is never serialized. The scene is left open for smoke runs.
        /// </summary>
        public static string GenerateReport() {
            var catalogue = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(PassengerCatalogue.AssetPath);
            if (!catalogue)
                throw new InvalidOperationException("The internal passenger catalogue is missing: " + PassengerCatalogue.AssetPath +
                    " — run `node tools/unity-assets/promote-passenger-library.ps1` first.");
            if (catalogue.Count <= 0 || catalogue.rights != "INTERNAL_REVIEW_ONLY")
                throw new InvalidOperationException("The passenger catalogue is not the internal 440-row library (count=" + catalogue.Count +
                    ", rights=" + (catalogue.rights ?? "(none)") + ").");

            // The single scene is the source of truth for the host, demos and catalogues.
            // Regenerate it first if it is absent.
            if (!File.Exists(Path.Combine(ProjectRoot, StationGameScene.ScenePath)))
                StationGameScene.Generate();

            var scene = EditorSceneManager.OpenScene(StationGameScene.ScenePath, OpenSceneMode.Single);
            if (!scene.IsValid())
                throw new InvalidOperationException("Could not open the scene: " + StationGameScene.ScenePath);
            var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            if (host == null)
                throw new InvalidOperationException("The scene has no StationGameHost.");
            if (scene.GetRootGameObjects().Length == 0)
                throw new InvalidOperationException("The scene has no roots.");

            var anchorObject = FindRoot(scene, RootName);
            if (anchorObject == null) {
                anchorObject = new GameObject(RootName);
                UnityEngine.SceneManagement.SceneManager.MoveGameObjectToScene(anchorObject, scene);
            }
            var anchor = anchorObject.GetComponent<PassengerCatalogueAnchor>();
            if (anchor == null) anchor = anchorObject.AddComponent<PassengerCatalogueAnchor>();
            // Deliberately NOT serialized: a scene reference would put an internal
            // catalogue GUID into an asset outside the excluded folder, which the
            // public-pack guard forbids. The Editor injects the catalogue when Play Mode
            // starts (Editor/LocalPassengerInjection.cs).
            anchor.catalogue = null;
            EditorSceneManager.MarkSceneDirty(scene);
            if (!EditorSceneManager.SaveScene(scene, StationGameScene.ScenePath))
                throw new InvalidOperationException("Could not save the scene with its catalogue anchor: " + StationGameScene.ScenePath);
            AssetDatabase.SaveAssets();
            // A scene written and reopened inside one command is imported asynchronously;
            // without a synchronous import the reopened copy can still be the empty file
            // from before the anchor was added, which reads as a broken profile.
            AssetDatabase.ImportAsset(StationGameScene.ScenePath, ImportAssetOptions.ForceSynchronousImport);

            var saved = EditorSceneManager.OpenScene(StationGameScene.ScenePath, OpenSceneMode.Single);
            var savedAnchor = FindAnchor(saved);
            var problems = new List<string>();
            if (!saved.IsValid()) problems.Add("the saved scene did not reopen");
            if (savedAnchor == null) problems.Add("the scene has no passenger anchor marker");
            else if (savedAnchor.catalogue != null) problems.Add("the scene serializes an internal catalogue reference");
            string internalGuid = AssetDatabase.AssetPathToGUID(PassengerCatalogue.AssetPath);
            if (string.IsNullOrEmpty(internalGuid)) problems.Add("the catalogue asset has no GUID");
            else if (File.ReadAllText(StationGameScene.ScenePath).IndexOf(internalGuid, StringComparison.Ordinal) >= 0)
                problems.Add("the scene file references the internal catalogue by GUID");
            if (Root(StationGameHost.ObjectName, saved) == null) problems.Add("the host is missing from the scene");
            if (IsInBuildSettings(StationGameScene.ScenePath))
                problems.Add("the scene is listed in the editor build settings");
            // Leave the scene open: the next smoke run in this editor uses it.
            EditorSceneManager.OpenScene(StationGameScene.ScenePath, OpenSceneMode.Single);
            if (problems.Count > 0)
                throw new InvalidOperationException("Local passenger scene validation failed:\n  " + string.Join("\n  ", problems));
            return "path=" + StationGameScene.ScenePath + " catalogue=" + catalogue.Count + " rights=" + catalogue.rights +
                   " anchor=" + RootName + " buildSettings=absent";
        }

        /// <summary>
        /// The **local WebGL** variant (plan 11 H3): the public scene plus an anchor bound to
        /// the small cohort catalogue, so a loopback-only Web pack can render the real
        /// soft-human recipes without shipping the 719 MB library. The file is never added
        /// to the build settings and never packed publicly; the public scene stays clean.
        /// </summary>
        public const string LocalWebScenePath = "Assets/StationDesigner/Scenes/StationGameLocalWeb.unity";

        [MenuItem("Metro/Station Game/Generate Local Web Passenger Scene")]
        public static void GenerateWeb() {
            Debug.Log("STATION_LOCAL_WEB_SCENE_OK " + GenerateWebReport());
        }

        /// <summary>
        /// One-pass batch bootstrap for an isolated local WebGL preview workspace: ensures the
        /// runtime/train catalogues and the single scene are up to date, builds the 15-recipe Web
        /// cohort inside <see cref="PassengerCatalogue.InternalRoot"/>, and generates
        /// <see cref="LocalWebScenePath"/> without touching build settings or the single scene.
        /// </summary>
        public static void PrepareLocalWebBuild() {
            StationGameScene.Generate();
            var cohortReport = PassengerCatalogueBuilder.BuildWebCohort();
            var sceneReport = GenerateWebReport();
            Debug.Log("STATION_LOCAL_WEB_PREPARE_OK cohort(" + cohortReport + ") scene(" + sceneReport + ")");
        }

        /// <summary>Build the local-Web scene from the validated single scene and the cohort catalogue.</summary>
        public static string GenerateWebReport() {
            var cohort = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(PassengerCatalogueBuilder.WebCohortPath);
            if (!cohort)
                throw new InvalidOperationException("The local Web cohort catalogue is missing: " + PassengerCatalogueBuilder.WebCohortPath +
                    " — run `Metro/Passengers/Build Local Web Cohort` first.");
            if (cohort.Count <= 0 || cohort.rights != "INTERNAL_REVIEW_ONLY")
                throw new InvalidOperationException("The local Web cohort is not an internal passenger catalogue (count=" + cohort.Count +
                    ", rights=" + (cohort.rights ?? "(none)") + ").");
            if (!File.Exists(Path.Combine(ProjectRoot, StationGameScene.ScenePath)))
                StationGameScene.Generate();

            var publicScene = EditorSceneManager.OpenScene(StationGameScene.ScenePath, OpenSceneMode.Single);
            if (!publicScene.IsValid()) throw new InvalidOperationException("Could not open the scene.");
            if (UnityEngine.Object.FindAnyObjectByType<StationGameHost>() == null)
                throw new InvalidOperationException("The scene has no StationGameHost.");
            var local = EditorSceneManager.SaveScene(publicScene, LocalWebScenePath);
            if (!local) throw new InvalidOperationException("Could not write the local Web scene: " + LocalWebScenePath);

            var current = EditorSceneManager.GetActiveScene();
            var marker = FindRoot(current, RootName);
            if (marker == null) {
                marker = new GameObject(RootName);
                UnityEngine.SceneManagement.SceneManager.MoveGameObjectToScene(marker, current);
            }
            var anchor = marker.GetComponent<PassengerCatalogueAnchor>();
            if (anchor == null) anchor = marker.AddComponent<PassengerCatalogueAnchor>();
            anchor.catalogue = cohort;
            EditorSceneManager.MarkSceneDirty(current);
            if (!EditorSceneManager.SaveScene(current, LocalWebScenePath))
                throw new InvalidOperationException("Could not save the local Web scene with its cohort anchor.");
            AssetDatabase.SaveAssets();
            AssetDatabase.ImportAsset(LocalWebScenePath, ImportAssetOptions.ForceSynchronousImport);

            var saved = EditorSceneManager.OpenScene(LocalWebScenePath, OpenSceneMode.Single);
            var savedAnchor = FindAnchor(saved);
            var problems = new List<string>();
            if (!saved.IsValid()) problems.Add("the saved local Web scene did not reopen");
            if (savedAnchor == null || savedAnchor.catalogue == null) problems.Add("the cohort anchor is missing or unassigned");
            else if (savedAnchor.catalogue.Count != cohort.Count) problems.Add("the anchor binds a different catalogue");
            if (Root(StationGameHost.ObjectName, saved) == null) problems.Add("the host is missing from the local Web copy");
            if (IsInBuildSettings(LocalWebScenePath)) problems.Add("the local Web scene is listed in the editor build settings");
            if (problems.Count > 0)
                throw new InvalidOperationException("Local Web passenger scene validation failed:\n  " + string.Join("\n  ", problems));
            return "path=" + LocalWebScenePath + " catalogue=" + cohort.Count + " rights=" + cohort.rights +
                   " anchor=" + RootName + " buildSettings=absent";
        }

        /// <summary>`metro station_local_web_scene`: the batch/copy-friendly form of <see cref="GenerateWebReport"/>.</summary>
        [CliGroupCommand("metro",
            "Create or refresh the local-only WebGL passenger scene (StationGameLocalWeb.unity) that binds the small cohort catalogue and verify it. Never packed publicly.",
            Effect = CommandEffect.Destructive, Tags = new[] { "tests" })]
        internal static ExitCode StationLocalWebScene(CommandContext cmd) {
            try {
                var report = GenerateWebReport();
                cmd.Result.Write(new Newtonsoft.Json.Linq.JObject {
                    ["status"] = "passed",
                    ["scene"] = LocalWebScenePath,
                    ["detail"] = report,
                });
                return ExitCode.Success;
            } catch (Exception error) {
                cmd.Log.Error("Could not generate the local Web passenger scene: " + error);
                return ExitCode.Failed;
            }
        }

        /// <summary>
        /// `metro station_local_scene`: create/refresh the local scene and report it. The
        /// command leaves the local scene open so `metro-editor.ps1 smoke -Scene
        /// StationGameLocal` runs against it.
        /// </summary>
        [CliGroupCommand("metro",
            "Create or refresh the local-only passenger scene (StationGameLocal.unity) that binds the internal soft-human catalogue, verify it, and leave it open.",
            Effect = CommandEffect.Destructive, Tags = new[] { "tests" })]
        internal static ExitCode StationLocalScene(CommandContext cmd) {
            try {
                var report = GenerateReport();
                cmd.Result.Write(new Newtonsoft.Json.Linq.JObject {
                    ["status"] = "passed",
                    ["scene"] = LocalScenePath,
                    ["detail"] = report,
                });
                return ExitCode.Success;
            } catch (Exception error) {
                cmd.Log.Error("Could not generate the local passenger scene: " + error);
                return ExitCode.Failed;
            }
        }

        static string ProjectRoot => Directory.GetParent(Application.dataPath).FullName;

        static GameObject FindRoot(UnityEngine.SceneManagement.Scene scene, string name) {
            foreach (var root in scene.GetRootGameObjects())
                if (root.name == name) return root;
            return null;
        }

        static GameObject Root(string name, UnityEngine.SceneManagement.Scene scene) => FindRoot(scene, name);

        static PassengerCatalogueAnchor FindAnchor(UnityEngine.SceneManagement.Scene scene) {
            var root = FindRoot(scene, RootName);
            return root != null ? root.GetComponent<PassengerCatalogueAnchor>() : null;
        }

        static bool IsInBuildSettings(string assetPath) {
            foreach (var scene in EditorBuildSettings.scenes)
                if (scene.enabled && string.Equals(scene.path, assetPath, StringComparison.Ordinal)) return true;
            return false;
        }
    }
}
