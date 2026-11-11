using System;
using Metro.App;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Metro.Editor {
 public static class PrepareZooRoute {
  public static void Run() {
   var fixture=AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/StationDesigner/FeasibilityGenerated/ZooSave.txt");if(fixture==null)throw new Exception("Zoo fixture missing");
   var scene=EditorSceneManager.OpenScene("Assets/StationDesigner/Scenes/Bootstrap.unity");
   var old=GameObject.Find("Zoo route proof");if(old!=null)UnityEngine.Object.DestroyImmediate(old);
   var probe=new GameObject("Zoo route proof").AddComponent<DemoRouteProbe>();probe.zooFixture=fixture;
   var authored=AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/StationDesigner/FeasibilityGenerated/AuthoredSave.txt");if(authored==null)throw new Exception("Authored fixture missing");
   var oldParity=GameObject.Find("Authored save proof");if(oldParity!=null)UnityEngine.Object.DestroyImmediate(oldParity);
   var parity=new GameObject("Authored save proof").AddComponent<SaveParityWeb>();parity.fixture=authored;
   if(!EditorSceneManager.SaveScene(scene))throw new Exception("Cannot save proof scene");
  }
 }
}
