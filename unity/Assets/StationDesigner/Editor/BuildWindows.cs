using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
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
            if (!string.Equals(sceneName, "StationGameLocal", StringComparison.Ordinal))
                throw new ArgumentException("Only the project scene may be built as a player");
            string scenePath = StationGameScene.ScenePath;
            if (!File.Exists(scenePath)) throw new Exception("Selected scene missing");
            var configIndex = Array.IndexOf(args, "-metroConfiguration");
            string configuration = configIndex >= 0 && configIndex + 1 < args.Length ? args[configIndex + 1] : "Release";
            if (configuration != "Development" && configuration != "Release") throw new ArgumentException("Invalid build configuration");
            Directory.CreateDirectory(output);
            string executable = Path.Combine(output, "MetroStation.exe");
            var options = new BuildPlayerOptions {
                scenes = new[] { scenePath },
                locationPathName = executable,
                target = BuildTarget.StandaloneWindows64,
                options = configuration == "Development" ? BuildOptions.Development : BuildOptions.None,
            };
            var report = BuildPipeline.BuildPlayer(options);
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
    }
}
