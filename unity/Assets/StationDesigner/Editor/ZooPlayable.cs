using System;
using System.IO;
using System.Linq;
using Metro.App;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using UnityEngine.Rendering;

namespace Metro.Editor {
    public static class ZooPlayable {
        public const string ScenePath = "Assets/StationDesigner/Scenes/ZooPlayable.unity";

        public static void Generate() {
            if (File.Exists(ScenePath)) {
                var existing = EditorSceneManager.OpenScene(ScenePath);
                var view = UnityEngine.Object.FindAnyObjectByType<ZooPlayableView>();
                if (!existing.IsValid() || !view || !view.fixture || !view.layout)
                    throw new InvalidOperationException("Existing ZooPlayable scene is invalid");
                var clip = PlatformDoors();
                if (view.platformDoors != clip) {
                    view.platformDoors = clip;
                    EditorSceneManager.MarkSceneDirty(existing);
                    if (!EditorSceneManager.SaveScene(existing, ScenePath))
                        throw new InvalidOperationException("Could not update ZooPlayable scene");
                }
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
            zoo.benchPrefab = Load<GameObject>("Assets/StationDesigner/Generated/Prefabs/Bench.prefab");
            zoo.binPrefab = Load<GameObject>("Assets/StationDesigner/Generated/Prefabs/Bin.prefab");
            zoo.trainPrefab = Load<GameObject>("Assets/TrainProof/TypeA.prefab");
            zoo.platformDoors = PlatformDoors();
            zoo.font = Load<Font>(Bootstrap.FontPath);
            zoo.stationShader = Shader.Find("Universal Render Pipeline/Lit");
            if (!zoo.stationShader || !EditorSceneManager.SaveScene(scene, ScenePath))
                throw new InvalidOperationException("Could not create ZooPlayable scene");
            AssetDatabase.SaveAssets();
        }

        static AnimationClip PlatformDoors() => AssetDatabase.LoadAllAssetsAtPath("Assets/TrainProof/train.glb")
            .OfType<AnimationClip>().Single(clip => clip.name == "OpenPlus");

        static T Load<T>(string path) where T : UnityEngine.Object {
            var asset = AssetDatabase.LoadAssetAtPath<T>(path);
            if (!asset) throw new FileNotFoundException("Zoo scene asset missing", path);
            return asset;
        }
    }
}

