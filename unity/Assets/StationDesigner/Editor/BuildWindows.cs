using System;
using System.Collections.Generic;
using System.IO;
using Metro.App;
using Metro.View;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Metro.Editor {
    /// <summary>
    /// The Windows standalone player (plan 27 §7). Mirrors <see cref="BuildWeb"/> so the two players
    /// are built the same way: the one project scene, an output directory that must be fresh and
    /// beneath the isolated project parent, a machine-readable summary beside the build, and a hard
    /// failure when the executable is not there. The React overlay is staged by
    /// <see cref="StationEditorReactOverlay"/>'s own post-build hook for
    /// <see cref="BuildTarget.StandaloneWindows64"/>.
    /// </summary>
    public static class BuildWindows {
        [Serializable] class Summary { public string result; public ulong totalSize; public string unityVersion; public string output; public string executable; }
        public static void Run() {
            string[] args = Environment.GetCommandLineArgs();
            var index = Array.IndexOf(args, "-metroOut");
            if (index < 0 || index + 1 >= args.Length) throw new ArgumentException("-metroOut is required");
            string output = Path.GetFullPath(args[index + 1]);
            var root = new DirectoryInfo(Path.GetFullPath(Path.Combine(Application.dataPath, "..")));
            while (root != null && !Directory.Exists(Path.Combine(root.FullName, ".git")) && !File.Exists(Path.Combine(root.FullName, ".git"))) root = root.Parent;
            if (root == null) throw new Exception("Cannot locate repository root");
            string allowed = Path.GetFullPath(Path.Combine(root.FullName, ".preview", "unity")) + Path.DirectorySeparatorChar;
            if (!output.StartsWith(allowed, StringComparison.OrdinalIgnoreCase) || Directory.Exists(output))
                throw new ArgumentException("Output must be a new directory beneath the isolated project parent");
            if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.StandaloneWindows64)
                throw new Exception("Active build target is not StandaloneWindows64");
            var sceneIndex = Array.IndexOf(args, "-metroScene");
            string sceneName = sceneIndex >= 0 && sceneIndex + 1 < args.Length ? args[sceneIndex + 1] : "StationGameLocal";
            string scenePath = sceneName.StartsWith("Assets/", StringComparison.Ordinal) ? sceneName
                : string.Equals(sceneName, "StationGameLocal", StringComparison.Ordinal) ? StationGameScene.ScenePath
                : throw new ArgumentException("Only the project scene may be built as a player");
            if (!File.Exists(scenePath)) throw new Exception("Selected scene missing");
            if (sceneName.StartsWith("Assets/", StringComparison.Ordinal) && sceneName.IndexOf("/Scenes/", StringComparison.Ordinal) < 0)
                throw new ArgumentException("An explicit metroScene path must point at a scene under Assets/.../Scenes/");
            var configIndex = Array.IndexOf(args, "-metroConfiguration");
            string configuration = configIndex >= 0 && configIndex + 1 < args.Length ? args[configIndex + 1] : "Release";
            if (configuration != "Development" && configuration != "Release") throw new ArgumentException("Invalid build configuration");
            Directory.CreateDirectory(output);
            string executable = Path.Combine(output, "MetroStation.exe");
            var options = new BuildPlayerOptions {
                locationPathName = executable,
                target = BuildTarget.StandaloneWindows64,
                options = configuration == "Development" ? BuildOptions.Development : BuildOptions.CompressWithLz4HC,
            };
            var report = BuildWithDeferredTrains(options, scenePath, "MetroWindowsTrains", applyWindowsIcons: true);
            File.WriteAllText(output + ".report.json", JsonUtility.ToJson(new Summary {
                result = report.summary.result.ToString(),
                totalSize = report.summary.totalSize,
                unityVersion = Application.unityVersion,
                output = output,
                executable = executable,
            }, true));
            if (report.summary.result != BuildResult.Succeeded || !File.Exists(executable))
                throw new Exception("Windows build did not succeed");
        }

        const string AppIconAssetPath = "Assets/StationDesigner/Editor/StationDesignerIcon.png";

        internal static BuildReport BuildWithDeferredTrains(BuildPlayerOptions options, string scenePath, string resourceFolder, bool applyWindowsIcons) {
            // Keep the authoring scene and catalogue intact. Eager scene references integrate all
            // 50 train formation hierarchies into memory before the first frame (~300+ MiB on WebGL).
            string stagingPath = "Assets/__MetroBuild_" + Guid.NewGuid().ToString("N");
            string stagingName = Path.GetFileName(stagingPath);
            if (string.IsNullOrEmpty(AssetDatabase.CreateFolder("Assets", stagingName)))
                throw new IOException("Could not create build staging folder");
            var previousScenes = EditorSceneManager.GetSceneManagerSetup();
            var previousIcons = applyWindowsIcons ? PlayerSettings.GetIcons(NamedBuildTarget.Standalone, IconKind.Any) : null;
            try {
                if (applyWindowsIcons) {
                    var appIcon = AssetDatabase.LoadAssetAtPath<Texture2D>(AppIconAssetPath);
                    if (appIcon != null) {
                        int[] iconSizes = PlayerSettings.GetIconSizes(NamedBuildTarget.Standalone, IconKind.Any);
                        var icons = new Texture2D[Math.Max(1, iconSizes.Length)];
                        for (int i = 0; i < icons.Length; i++) icons[i] = appIcon;
                        PlayerSettings.SetIcons(NamedBuildTarget.Standalone, icons, IconKind.Any);
                    }
                }
                string stagedScenePath = stagingPath + "/" + Path.GetFileName(scenePath);
                if (!AssetDatabase.CopyAsset(scenePath, stagedScenePath))
                    throw new IOException("Could not copy player scene");
                var scene = EditorSceneManager.OpenScene(stagedScenePath);
                var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
                if (!host || !host.trainCatalogue) throw new InvalidOperationException("Scene has no train catalogue");
                host.trainCatalogue = StageTrainCatalogue(host.trainCatalogue, stagingPath, resourceFolder);
                if (!EditorSceneManager.SaveScene(scene))
                    throw new IOException("Could not save player scene");
                options.scenes = new[] { stagedScenePath };
                return BuildPipeline.BuildPlayer(options);
            } finally {
                if (applyWindowsIcons && previousIcons != null)
                    PlayerSettings.SetIcons(NamedBuildTarget.Standalone, previousIcons, IconKind.Any);
                try {
                    if (Array.Exists(previousScenes, setup => setup.isActive))
                        EditorSceneManager.RestoreSceneManagerSetup(previousScenes);
                    else EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
                }
                finally {
                    if (!AssetDatabase.DeleteAsset(stagingPath))
                        Debug.LogError("Could not remove build staging folder: " + stagingPath);
                }
            }
        }

        static TrainCatalogue StageTrainCatalogue(TrainCatalogue source, string stagingPath, string resourceFolder) {
            string resources = stagingPath + "/Resources";
            if (string.IsNullOrEmpty(AssetDatabase.CreateFolder(stagingPath, "Resources")) ||
                string.IsNullOrEmpty(AssetDatabase.CreateFolder(resources, resourceFolder)))
                throw new IOException("Could not create train resources folder");

            var staged = ScriptableObject.CreateInstance<TrainCatalogue>();
            var entries = new List<TrainCatalogue.Entry>();
            var copied = new HashSet<string>(StringComparer.Ordinal);
            AssetDatabase.StartAssetEditing();
            try {
                foreach (var entry in source.Entries) {
                    if (entry == null || !entry.prefab || string.IsNullOrEmpty(entry.prefabPath))
                        throw new InvalidOperationException("Invalid promoted train catalogue entry: " + entry?.key);
                    string fileName = Path.GetFileName(entry.prefabPath);
                    if (copied.Add(entry.prefabPath) && !AssetDatabase.CopyAsset(entry.prefabPath, resources + "/" + resourceFolder + "/" + fileName))
                        throw new IOException("Could not stage train formation: " + entry.prefabPath);
                    entries.Add(new TrainCatalogue.Entry {
                        key = entry.key, stock = entry.stock, cars = entry.cars, power = entry.power,
                        bakedScale = entry.bakedScale, prefabPath = entry.prefabPath,
                        resourcePath = resourceFolder + "/" + Path.GetFileNameWithoutExtension(fileName),
                    });
                }
            } finally { AssetDatabase.StopAssetEditing(); }

            staged.schemaVersion = source.schemaVersion;
            staged.entries = entries.ToArray();
            AssetDatabase.CreateAsset(staged, stagingPath + "/TrainCatalogue.asset");
            AssetDatabase.SaveAssetIfDirty(staged);
            return staged;
        }
    }
}
