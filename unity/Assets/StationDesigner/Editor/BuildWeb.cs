using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Metro.Editor {
    public static class BuildWeb {
        [Serializable] class Summary { public string result; public ulong totalSize; public string unityVersion; public string output; }
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
            if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.WebGL) throw new Exception("Active build target is not WebGL");
            var sceneIndex = Array.IndexOf(args, "-metroScene");
            string sceneName = sceneIndex >= 0 && sceneIndex + 1 < args.Length ? args[sceneIndex + 1] : "StationGameLocal";
            // The named scene is the single project scene; an explicit `Assets/...` path
            // is the local-only WebGL cohort profile escape hatch (plan 11 H3). The
            // caller owns the promise that the scene never ships:
            // `metro-local-player.ps1` is the only script that passes a path, and it
            // serves the result on loopback only.
            string scenePath = sceneName.StartsWith("Assets/", StringComparison.Ordinal) ? sceneName
                : sceneName == "StationGameLocal" ? StationGameScene.ScenePath : throw new ArgumentException("Invalid scene");
            if (!File.Exists(scenePath)) throw new Exception("Selected scene missing");
            if (sceneName.StartsWith("Assets/", StringComparison.Ordinal) && sceneName.IndexOf("/Scenes/", StringComparison.Ordinal) < 0)
                throw new ArgumentException("An explicit metroScene path must point at a scene under Assets/.../Scenes/");
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.decompressionFallback = false;
            if (PlayerSettings.WebGL.compressionFormat != WebGLCompressionFormat.Disabled || PlayerSettings.WebGL.decompressionFallback)
                throw new Exception("Web compression settings did not apply");
            var configIndex = Array.IndexOf(args, "-metroConfiguration");
            string configuration = configIndex >= 0 && configIndex + 1 < args.Length ? args[configIndex + 1] : "Development";
            if (configuration != "Development" && configuration != "Release") throw new ArgumentException("Invalid build configuration");
            var options = new BuildPlayerOptions { scenes = new[] { scenePath }, locationPathName = output, target = BuildTarget.WebGL, options = configuration == "Development" ? BuildOptions.Development : BuildOptions.None };
            var report = BuildPipeline.BuildPlayer(options);
            File.WriteAllText(output + ".report.json", JsonUtility.ToJson(new Summary { result = report.summary.result.ToString(), totalSize = report.summary.totalSize, unityVersion = Application.unityVersion, output = output }, true));
            if (report.summary.result != BuildResult.Succeeded || !File.Exists(Path.Combine(output, "index.html"))) throw new Exception("Web build did not succeed");
        }
    }
}
