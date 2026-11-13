using System;
using System.IO;
using System.Linq;
using Metro.App;
using Metro.View;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using UnityEngine.Rendering;

namespace Metro.Editor {
    public static class ZooPlayable {
        public const string ScenePath = "Assets/StationDesigner/Scenes/ZooPlayable.unity";
        public const string PassengerModel = "Assets/StationDesigner/Generated/Models/passenger-adult.glb";

        public static void Generate() {
            Metro.Editor.RuntimeCatalogue.Ensure();
            TrainCatalogueBuilder.Ensure();
            if (File.Exists(ScenePath)) {
                var existing = EditorSceneManager.OpenScene(ScenePath);
                var view = UnityEngine.Object.FindAnyObjectByType<ZooPlayableView>();
                if (!existing.IsValid() || !view || !view.fixture || !view.layout)
                    throw new InvalidOperationException("Existing ZooPlayable scene is invalid");
                bool changed = Assign(view);
                if (changed) {
                    EditorSceneManager.MarkSceneDirty(existing);
                    if (!EditorSceneManager.SaveScene(existing, ScenePath))
                        throw new InvalidOperationException("Could not update ZooPlayable scene");
                }
                // Validate what the scene serialized, not the in-memory edit.
                var reopened = EditorSceneManager.OpenScene(ScenePath);
                Validate(UnityEngine.Object.FindAnyObjectByType<ZooPlayableView>(), reopened);
                return;
            }

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var camera = new GameObject("Main Camera", typeof(Camera)).GetComponent<Camera>();
            camera.tag = "MainCamera";
            camera.orthographic = true;
            camera.farClipPlane = 360;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(.14f, .20f, .23f);
            var light = new GameObject("Daylight", typeof(Light)).GetComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.25f;
            light.transform.rotation = Quaternion.Euler(53, -36, 0);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(.63f, .67f, .69f);
            new GameObject("EventSystem", typeof(EventSystem), typeof(InputSystemUIInputModule));

            var zoo = new GameObject("ZooPlayable").AddComponent<ZooPlayableView>();
            zoo.fixture = Load<TextAsset>("Assets/StationDesigner/Zoo/ZooSave.json");
            zoo.layout = Load<TextAsset>("Assets/StationDesigner/Zoo/ZooLayout.json");
            zoo.font = Load<Font>(Bootstrap.FontPath);
            zoo.stationShader = Shader.Find("Universal Render Pipeline/Lit");
            Assign(zoo);
            if (!zoo.stationShader || !EditorSceneManager.SaveScene(scene, ScenePath))
                throw new InvalidOperationException("Could not create ZooPlayable scene");
            AssetDatabase.SaveAssets();
            var saved = EditorSceneManager.OpenScene(ScenePath);
            Validate(UnityEngine.Object.FindAnyObjectByType<ZooPlayableView>(), saved);
        }

        static bool Assign(ZooPlayableView view) {
            // Reload the generated assets by path: a reference created moments ago in the
            // same batch run is not a reliable thing to serialize into a scene.
            var catalogue = AssetDatabase.LoadAssetAtPath<Metro.View.RuntimeCatalogue>(Metro.View.RuntimeCatalogue.AssetPath);
            var formations = AssetDatabase.LoadAssetAtPath<Metro.View.TrainCatalogue>(Metro.View.TrainCatalogue.AssetPath);
            if (!catalogue) throw new InvalidOperationException("Runtime catalogue asset is missing: " + Metro.View.RuntimeCatalogue.AssetPath);
            if (!formations) throw new InvalidOperationException("Train catalogue asset is missing: " + Metro.View.TrainCatalogue.AssetPath);
            bool changed = false;
            void Set<T>(ref T field, T value) where T : UnityEngine.Object {
                if (field == value) return;
                field = value;
                changed = true;
            }
            Set(ref view.catalogue, catalogue);
            Set(ref view.trainCatalogue, formations);
            Set(ref view.passengerPrefab, AssetDatabase.LoadAssetAtPath<GameObject>(PassengerModel));
            var passengerClips = Clips(PassengerModel);
            if (!Same(view.passengerClips, passengerClips)) { view.passengerClips = passengerClips; changed = true; }
            return changed;
        }

        static void Validate(ZooPlayableView view, UnityEngine.SceneManagement.Scene scene) {
            if (!view || !scene.IsValid())
                throw new InvalidOperationException("ZooPlayable scene lost its playable view after saving");
            var problems = new System.Collections.Generic.List<string>();
            if (!view.catalogue) problems.Add("runtime catalogue is not assigned");
            if (!view.trainCatalogue) problems.Add("train catalogue is not assigned");
            if (!view.passengerPrefab) problems.Add("cleared passenger rig is not assigned");
            if (view.passengerClips == null || view.passengerClips.Length == 0) problems.Add("passenger clips are not assigned");
            if (view.catalogue) {
                var zoo = TrainFormations.Select("L", 6, "third-rail", view.trainCatalogue);
                if (!view.trainCatalogue.Has(zoo)) problems.Add("Line 5 formation is missing from the train catalogue: " + zoo);
            }
            if (problems.Count > 0) throw new InvalidOperationException("ZooPlayable scene validation failed:\n  " + string.Join("\n  ", problems));
            Debug.Log($"ZOO_SCENE_OK catalogue={view.catalogue.Count} formations={view.trainCatalogue.entries.Length} passengerClips={view.passengerClips.Length}");
        }

        static AnimationClip[] Clips(string path) => AssetDatabase.LoadAllAssetsAtPath(path)
            .OfType<AnimationClip>().OrderBy(clip => clip.name, StringComparer.Ordinal).ToArray();
        static AnimationClip Clip(string path, string name) =>
            Clips(path).FirstOrDefault(clip => clip.name == name);
        static bool Same(AnimationClip[] a, AnimationClip[] b) {
            if (a == null || b == null) return a == b;
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }

        static T Load<T>(string path) where T : UnityEngine.Object {
            var asset = AssetDatabase.LoadAssetAtPath<T>(path);
            if (!asset) throw new FileNotFoundException("Zoo scene asset missing", path);
            return asset;
        }
    }
}
