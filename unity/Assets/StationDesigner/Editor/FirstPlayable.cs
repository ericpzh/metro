using Metro.App;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using System.Linq;

namespace Metro.Editor {
    public static class FirstPlayable {
        public const string ScenePath = "Assets/StationDesigner/Scenes/FirstPlayable.unity";
        public const string TrainPrefabPath = "Assets/StationDesigner/Generated/Prefabs/TrainA.prefab";
        public const string TrainModelPath = "Assets/StationDesigner/Generated/Models/train-a.glb";
        public static void Generate() {
            var prefab=AssetDatabase.LoadAssetAtPath<GameObject>(TrainPrefabPath);
            if(!prefab) throw new System.Exception("Type A prefab missing");
            var clip=AssetDatabase.LoadAllAssetsAtPath(TrainModelPath).OfType<AnimationClip>().FirstOrDefault(c=>c.name=="OpenMinus");
            if(!clip) throw new System.Exception("Type A platform door clip missing");
            var shader=Shader.Find("Universal Render Pipeline/Lit");
            if(!shader) throw new System.Exception("Station shader missing");
            // Repeated generation preserves the existing scene and its GUID.
            if (System.IO.File.Exists(ScenePath)) {
                var existing=EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
                var existingView=GameObject.Find("FirstPlayable")?.GetComponent<FirstPlayableView>();
                if (!existing.IsValid() || existingView == null)
                    throw new System.Exception("FirstPlayable scene is invalid");
                if(existingView.trainPrefab!=prefab || existingView.platformDoors!=clip || existingView.stationShader!=shader) {
                    existingView.trainPrefab=prefab;
                    existingView.platformDoors=clip;
                    existingView.stationShader=shader;
                    EditorSceneManager.MarkSceneDirty(existing);
                    if(!EditorSceneManager.SaveScene(existing,ScenePath)) throw new System.Exception("Could not save FirstPlayable scene");
                    AssetDatabase.SaveAssets();
                }
                return;
            }
            var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
            var cameraObject=new GameObject("Main Camera",typeof(Camera),typeof(AudioListener)); cameraObject.tag="MainCamera";
            cameraObject.transform.position=new Vector3(3,9,-9); cameraObject.transform.LookAt(new Vector3(3,0,.7f));
            var camera=cameraObject.GetComponent<Camera>(); camera.orthographic=true; camera.orthographicSize=5; camera.clearFlags=CameraClearFlags.SolidColor; camera.backgroundColor=new Color(.12f,.17f,.22f);
            var light=new GameObject("Directional Light",typeof(Light)); light.GetComponent<Light>().type=LightType.Directional; light.transform.rotation=Quaternion.Euler(50,-30,0);
            var view=new GameObject("FirstPlayable").AddComponent<FirstPlayableView>();
            view.trainPrefab=prefab;
            view.platformDoors=clip;
            view.stationShader=shader;
            if(!EditorSceneManager.SaveScene(scene,ScenePath)) throw new System.Exception("Could not save FirstPlayable scene");
            AssetDatabase.SaveAssets();
        }
    }
}
