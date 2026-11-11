using Metro.App;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using System.Linq;

namespace Metro.Editor {
    public static class FirstPlayable {
        public const string ScenePath = "Assets/StationDesigner/Scenes/FirstPlayable.unity";
        public static void Generate() {
            // Repeated generation preserves the existing scene and its GUID.
            if (System.IO.File.Exists(ScenePath)) {
                var existing=EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
                var existingView=GameObject.Find("FirstPlayable")?.GetComponent<FirstPlayableView>();
                if (!existing.IsValid() || existingView == null)
                    throw new System.Exception("FirstPlayable scene is invalid");
                var clip=AssetDatabase.LoadAllAssetsAtPath("Assets/TrainProof/train.glb").OfType<AnimationClip>().FirstOrDefault(c=>c.name=="OpenMinus");
                if (!clip) throw new System.Exception("Type A platform door clip missing");
                var shader=Shader.Find("Universal Render Pipeline/Lit");
                if(!shader) throw new System.Exception("Station shader missing");
                if(existingView.platformDoors!=clip || existingView.stationShader!=shader) { existingView.platformDoors=clip; existingView.stationShader=shader; EditorSceneManager.MarkSceneDirty(existing); EditorSceneManager.SaveScene(existing,ScenePath); }
                return;
            }
            var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
            var cameraObject=new GameObject("Main Camera",typeof(Camera),typeof(AudioListener)); cameraObject.tag="MainCamera";
            cameraObject.transform.position=new Vector3(3,9,-9); cameraObject.transform.LookAt(new Vector3(3,0,.7f));
            var camera=cameraObject.GetComponent<Camera>(); camera.orthographic=true; camera.orthographicSize=5; camera.clearFlags=CameraClearFlags.SolidColor; camera.backgroundColor=new Color(.12f,.17f,.22f);
            var light=new GameObject("Directional Light",typeof(Light)); light.GetComponent<Light>().type=LightType.Directional; light.transform.rotation=Quaternion.Euler(50,-30,0);
            var view=new GameObject("FirstPlayable").AddComponent<FirstPlayableView>();
            view.trainPrefab=AssetDatabase.LoadAssetAtPath<GameObject>("Assets/TrainProof/TypeA.prefab");
            view.platformDoors=AssetDatabase.LoadAllAssetsAtPath("Assets/TrainProof/train.glb").OfType<AnimationClip>().FirstOrDefault(c=>c.name=="OpenMinus");
            view.stationShader=Shader.Find("Universal Render Pipeline/Lit");
            if(!view.trainPrefab) throw new System.Exception("Type A prefab missing");
            if(!view.platformDoors) throw new System.Exception("Type A platform door clip missing");
            if(!view.stationShader) throw new System.Exception("Station shader missing");
            if(!EditorSceneManager.SaveScene(scene,ScenePath)) throw new System.Exception("Could not save FirstPlayable scene");
            AssetDatabase.SaveAssets();
        }
    }
}
