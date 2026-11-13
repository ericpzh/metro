using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.AssetExample {
    // A disposable review scene built from the manifest importer's catalogue.
    public static class ReviewImportedFixtures {
        public static void BuildWeb() {
            var args = Environment.GetCommandLineArgs();
            string Arg(string flag) { int i = Array.IndexOf(args, flag); if (i < 0 || i + 1 >= args.Length) throw new Exception("Missing " + flag); return args[i + 1]; }
            string type = Arg("-metroReview"), output = Path.GetFullPath(Arg("-metroReviewOut"));
            string project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            var root = new DirectoryInfo(project);
            while (root != null && !Directory.Exists(Path.Combine(root.FullName, ".git")) && !File.Exists(Path.Combine(root.FullName, ".git"))) root = root.Parent;
            if (root == null || !output.StartsWith(Path.Combine(root.FullName, ".preview", "unity") + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || Directory.Exists(output)) throw new Exception("Review output must be a fresh directory in .preview/unity");
            if (type != "bench" && type != "train") throw new Exception("Unknown fixture");
            var catalogue = AssetDatabase.LoadAssetAtPath<Metro.ImportedAssetCatalogue>("Assets/StationDesigner/Generated/FixtureCatalogue.asset");
            string id = type == "bench" ? "station.bench.seat-2" : "train.A.three-car.catenary";
            var entry = catalogue.entries.Single(e => e.id == id);
            if (entry.prefab == null) throw new Exception("Missing catalogue wrapper");
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var wrapper = (GameObject)PrefabUtility.InstantiatePrefab(entry.prefab);
            if (type == "train") {
                var path = "Assets/StationDesigner/Generated/Models/fixture-" + id + ".glb";
                var clips = AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().ToArray();
                var imported = wrapper.transform.Find("Unity basis").GetChild(0).gameObject;
                var playback = wrapper.AddComponent<Metro.Feasibility.TrainDoorReview>();
                playback.imported = imported;
                playback.plus = clips.Single(c => c.name == "OpenPlus");
                playback.minus = clips.Single(c => c.name == "OpenMinus");
            }
            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = type == "train" ? new Vector3(38, 18, 52) : new Vector3(2.7f, 2.1f, 3.3f);
            camera.transform.LookAt(type == "train" ? new Vector3(0, 1.8f, 0) : new Vector3(0, .55f, 0));
            camera.orthographic = true; camera.orthographicSize = type == "train" ? 18 : 1.35f;
            camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = new Color(.22f, .30f, .38f);
            var light = new GameObject("Key light").AddComponent<Light>(); light.type = LightType.Directional;
            light.intensity = type == "train" ? 2.5f : 2f; light.transform.rotation = type == "train" ? Quaternion.Euler(45, 180, 0) : Quaternion.Euler(38, 145, 0);
            RenderSettings.ambientMode = AmbientMode.Flat; RenderSettings.ambientLight = Color.white * .5f;
            const string scene = "Assets/__MetroFixtureReview.unity";
            if (!EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), scene)) throw new Exception("Cannot save scene");
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.decompressionFallback = false; PlayerSettings.WebGL.template = "APPLICATION:Default";
            var report = BuildPipeline.BuildPlayer(new[] { scene }, output, BuildTarget.WebGL, BuildOptions.None);
            if (report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded) throw new Exception("Build failed: " + report.summary.result);
            Debug.Log("MANIFEST_FIXTURE_WEB_OK " + id);
        }
    }
}

