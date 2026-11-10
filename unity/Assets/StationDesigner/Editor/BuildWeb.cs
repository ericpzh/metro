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
            if (!File.Exists(Bootstrap.ScenePath)) throw new Exception("Bootstrap scene missing");
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.decompressionFallback = false;
            if (PlayerSettings.WebGL.compressionFormat != WebGLCompressionFormat.Disabled || PlayerSettings.WebGL.decompressionFallback)
                throw new Exception("Web compression settings did not apply");
            var configIndex = Array.IndexOf(args, "-metroConfiguration");
            string configuration = configIndex >= 0 && configIndex + 1 < args.Length ? args[configIndex + 1] : "Development";
            if (configuration != "Development" && configuration != "Release") throw new ArgumentException("Invalid build configuration");
            var options = new BuildPlayerOptions { scenes = new[] { Bootstrap.ScenePath }, locationPathName = output, target = BuildTarget.WebGL, options = configuration == "Development" ? BuildOptions.Development : BuildOptions.None };
            var report = BuildPipeline.BuildPlayer(options);
            File.WriteAllText(output + ".report.json", JsonUtility.ToJson(new Summary { result = report.summary.result.ToString(), totalSize = report.summary.totalSize, unityVersion = Application.unityVersion, output = output }, true));
            if (report.summary.result != BuildResult.Succeeded || !File.Exists(Path.Combine(output, "index.html"))) throw new Exception("Web build did not succeed");
        }
    }
}
