using System;
using System.Collections.Generic;
using System.IO;
using Metro.App;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using UnityEngine.Rendering;

namespace Metro.Editor {
    /// <summary>
    /// Builds `Assets/StationDesigner/Scenes/StationGameLocal.unity`, the project's
    /// single player scene. It is the camera/light/shader scaffold without any
    /// station: no authored roots, no layout file, no fixture adapter. The scene
    /// carries the two runtime catalogues, the A1 demo manifest with its documents,
    /// one <see cref="StationGameHost"/>, and the <c>PassengerProfile</c> anchor that
    /// the Editor fills with the local passenger catalogue on Play Mode entry; a
    /// station arrives only as a command.
    ///
    /// CLI: `-executeMethod Metro.Editor.StationGameScene.Generate`.
    /// </summary>
    public static class StationGameScene {
        public const string ScenePath = "Assets/StationDesigner/Scenes/StationGameLocal.unity";
        public const string DemosDirectory = "Assets/StationDesigner/Demos";
        public const string ManifestPath = DemosDirectory + "/provenance.json";

        [MenuItem("Metro/Station Game/Generate Scene")]
        public static void Generate() {
            Metro.Editor.RuntimeCatalogue.Ensure();
            TrainCatalogueBuilder.Ensure();
            if (File.Exists(ScenePath)) {
                var existing = EditorSceneManager.OpenScene(ScenePath);
                var existingHost = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
                if (!existing.IsValid() || existingHost == null)
                    throw new InvalidOperationException("Existing StationGameLocal scene has no StationGameHost");
                bool changed = Assign(existingHost);
                // The light rig is code-owned (StationRenderRig): applying it here keeps a
                // serialized scene in step with the source rig without regenerating it.
                StationRenderRig.Apply(UnityEngine.Object.FindAnyObjectByType<Camera>());
                EnsurePassengerAnchor();
                EditorSceneManager.MarkSceneDirty(existing);
                if (!EditorSceneManager.SaveScene(existing, ScenePath))
                    throw new InvalidOperationException("Could not update StationGameLocal scene");
                var reopened = EditorSceneManager.OpenScene(ScenePath);
                Validate(UnityEngine.Object.FindAnyObjectByType<StationGameHost>(), reopened);
                return;
            }

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var camera = new GameObject("Main Camera", typeof(Camera)).GetComponent<Camera>();
            camera.tag = "MainCamera";
            camera.orthographic = true;
            camera.farClipPlane = 360;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(.14f, .20f, .23f);
            // The source light rig (key + fill + hemisphere + ambient, no shadows, no
            // environment map, linear fog). See StationRenderRig for the numbers.
            StationRenderRig.Apply(camera);
            new GameObject("EventSystem", typeof(EventSystem), typeof(InputSystemUIInputModule));
            EnsurePassengerAnchor();

            var host = new GameObject(StationGameHost.ObjectName).AddComponent<StationGameHost>();
            host.stationCamera = camera;
            Assign(host);
            if (!host.stationShader || !EditorSceneManager.SaveScene(scene, ScenePath))
                throw new InvalidOperationException("Could not create StationGameLocal scene");
            AssetDatabase.SaveAssets();
            var saved = EditorSceneManager.OpenScene(ScenePath);
            Validate(UnityEngine.Object.FindAnyObjectByType<StationGameHost>(), saved);
        }

        /// <summary>
        /// The single scene keeps the local-passenger marker even without the internal
        /// catalogue: the anchor is serialized with a null catalogue and the Editor
        /// injects the catalogue on Play Mode entry (<c>LocalPassengerInjection</c>).
        /// </summary>
        static void EnsurePassengerAnchor() {
            var scene = EditorSceneManager.GetActiveScene();
            GameObject root = null;
            foreach (var candidate in scene.GetRootGameObjects())
                if (candidate.name == StationLocalProfile.RootName) { root = candidate; break; }
            if (root == null) {
                root = new GameObject(StationLocalProfile.RootName);
                UnityEngine.SceneManagement.SceneManager.MoveGameObjectToScene(root, scene);
            }
            if (root.GetComponent<PassengerCatalogueAnchor>() == null)
                root.AddComponent<PassengerCatalogueAnchor>();
        }

        static bool Assign(StationGameHost host) {
            // Load generated assets by path: a reference created in the same batch run
            // is not a reliable thing to serialize into a scene (ZooPlayable's rule).
            var catalogue = AssetDatabase.LoadAssetAtPath<Metro.View.RuntimeCatalogue>(Metro.View.RuntimeCatalogue.AssetPath);
            var formations = AssetDatabase.LoadAssetAtPath<Metro.View.TrainCatalogue>(Metro.View.TrainCatalogue.AssetPath);
            if (!catalogue) throw new InvalidOperationException("Runtime catalogue asset is missing: " + Metro.View.RuntimeCatalogue.AssetPath);
            if (!formations) throw new InvalidOperationException("Train catalogue asset is missing: " + Metro.View.TrainCatalogue.AssetPath);
            var manifest = AssetDatabase.LoadAssetAtPath<TextAsset>(ManifestPath);
            if (!manifest)
                throw new InvalidOperationException("Demo manifest is missing: " + ManifestPath +
                    " Ã¢â‚¬â€ run `node tools/unity-parity/export-station-documents.mjs` first.");
            var demos = ReadManifest(manifest);
            var font = AssetDatabase.LoadAssetAtPath<Font>(Bootstrap.FontPath);
            if (!font) throw new InvalidOperationException("Scene font is missing: " + Bootstrap.FontPath);
            var shader = Shader.Find("Universal Render Pipeline/Lit");
            if (!shader) throw new InvalidOperationException("Universal Render Pipeline/Lit shader is missing");
            bool changed = false;
            void Set<T>(ref T field, T value) where T : UnityEngine.Object {
                if (field == value) return;
                field = value;
                changed = true;
            }
            Set(ref host.catalogue, catalogue);
            Set(ref host.trainCatalogue, formations);
            Set(ref host.demoManifest, manifest);
            Set(ref host.stationShader, shader);
            Set(ref host.font, font);
            if (!Same(host.demos, demos)) { host.demos = demos; changed = true; }
            return changed;
        }

        static StationGameHost.DemoStation[] ReadManifest(TextAsset manifest) {
            JObject parsed;
            try {
                parsed = JObject.Parse(manifest.text);
            } catch (Exception error) {
                throw new InvalidOperationException("Demo manifest is not JSON: " + error.Message);
            }
            if (!(parsed["demos"] is JArray rows) || rows.Count == 0)
                throw new InvalidOperationException("Demo manifest has no demos: " + ManifestPath);
            var demos = new List<StationGameHost.DemoStation>(rows.Count);
            foreach (var row in rows) {
                var id = (string)row["id"];
                var file = (string)row["file"];
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(file))
                    throw new InvalidOperationException("Demo manifest row needs id and file: " + row);
                var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(DemosDirectory + "/" + file);
                if (!asset) throw new InvalidOperationException("Demo document is missing: " + DemosDirectory + "/" + file);
                demos.Add(new StationGameHost.DemoStation { id = id, document = asset });
            }
            return demos.ToArray();
        }

        static bool Same(StationGameHost.DemoStation[] a, StationGameHost.DemoStation[] b) {
            if (a == null || b == null) return a == b;
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) {
                if (a[i] == null || b[i] == null) { if (a[i] != b[i]) return false; continue; }
                if (a[i].id != b[i].id || a[i].document != b[i].document) return false;
            }
            return true;
        }

        static void Validate(StationGameHost host, UnityEngine.SceneManagement.Scene scene) {
            if (!host || !scene.IsValid())
                throw new InvalidOperationException("StationGameLocal scene lost its host after saving");
            var problems = new List<string>();
            if (!host.catalogue) problems.Add("runtime catalogue is not assigned");
            if (!host.trainCatalogue) problems.Add("train catalogue is not assigned");
            if (!host.stationShader) problems.Add("station shader is not assigned");
            if (!host.font) problems.Add("scene font is not assigned");
            if (!host.demoManifest) problems.Add("demo manifest is not assigned");
            if (host.demos == null || host.demos.Length == 0) problems.Add("no demo documents are assigned");
            if (host.demos != null) {
                foreach (var demo in host.demos)
                    if (demo == null || string.IsNullOrEmpty(demo.id) || demo.document == null)
                        problems.Add("a demo row is missing its id or document");
            }
            var manifest = AssetDatabase.LoadAssetAtPath<TextAsset>(ManifestPath);
            if (manifest && host.demos != null) {
                var expected = ReadManifest(manifest);
                if (expected.Length != host.demos.Length) problems.Add("demo count does not match the manifest");
            }
            // No authored station root, no fixture adapter, no layout dependency.
            foreach (var root in scene.GetRootGameObjects()) {
                if (root.GetComponent<ZooPlayableView>() != null) problems.Add("scene contains the Zoo fixture adapter");
                if (root.name.IndexOf("zoo", StringComparison.OrdinalIgnoreCase) >= 0)
                    problems.Add("scene has a Zoo-named root: " + root.name);
                if (root.name == StationGameHost.ObjectName && root.GetComponent<StationGameHost>() == null)
                    problems.Add("StationGame root has no StationGameHost");
                if (root.name == StationGameHost.ObjectName && root.transform.childCount > 0)
                    problems.Add("StationGame root has authored children; a station must only arrive through the host");
            }
            var sceneText = File.ReadAllText(ScenePath);
            if (sceneText.IndexOf("ZooLayout", StringComparison.Ordinal) >= 0) problems.Add("scene references ZooLayout.json");
            if (sceneText.IndexOf("ZooSave", StringComparison.Ordinal) >= 0) problems.Add("scene references ZooSave.json");
            if (problems.Count > 0)
                throw new InvalidOperationException("StationGameLocal scene validation failed:\n  " + string.Join("\n  ", problems));
            Debug.Log($"STATION_SCENE_OK path={ScenePath} catalogue={host.catalogue.Count} formations={host.trainCatalogue.entries.Length} demos={host.demos.Length}");
        }
    }
}
