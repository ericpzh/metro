using System;
using System.IO;
using Metro.App;
using Metro.Feasibility;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.Editor {
    public static class BuildZooGateSlice {
        public static void Run() {
            var args=Environment.GetCommandLineArgs();int i=Array.IndexOf(args,"-zooGateOut");if(i<0||i+1>=args.Length)throw new Exception("Missing output");
            string output=Path.GetFullPath(args[i+1]);if(Directory.Exists(output))throw new Exception("Output exists");
            const string dir="Assets/StationDesigner/FeasibilityGenerated";Directory.CreateDirectory(dir);AssetDatabase.Refresh();
            int stationArg=Array.IndexOf(args,"-station");string stationId=stationArg>=0 && stationArg+1<args.Length ? args[stationArg+1] : "zoo";
            if(stationId!="zoo" && stationId!="tianhe")throw new Exception("Unknown station fixture");
            var station=AssetDatabase.LoadAssetAtPath<TextAsset>(dir+(stationId=="zoo"?"/ZooSave.txt":"/TianheSave.txt"));var oracle=AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/StationDesigner/Tests/EditMode/"+stationId+"-gate-oracle.json");if(station==null||oracle==null)throw new Exception("Station inputs missing");
            int shaderArg=Array.IndexOf(args,"-zooShader");string shaderName=shaderArg>=0 && shaderArg+1<args.Length && args[shaderArg+1]=="lit" ? "Universal Render Pipeline/Lit" : "Universal Render Pipeline/Unlit";
            var shader=Shader.Find(shaderName);if(shader==null)throw new Exception("Shader missing");
            Material Mat(string name,Color color) {string path=dir+"/"+name+".mat";var m=AssetDatabase.LoadAssetAtPath<Material>(path);if(m==null){m=new Material(shader);AssetDatabase.CreateAsset(m,path);}m.shader=shader;m.color=color;m.enableInstancing=true;EditorUtility.SetDirty(m);return m;}
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);var camera=new GameObject("Main Camera",typeof(Camera));camera.tag="MainCamera";camera.GetComponent<Camera>().clearFlags=CameraClearFlags.SolidColor;camera.GetComponent<Camera>().backgroundColor=new Color(.08f,.11f,.14f);
            var view=new GameObject("Zoo gate slice").AddComponent<ZooGateSliceView>();view.station=station;view.oracle=oracle;view.blockMaterial=Mat("Zoo blocks",new Color(.45f,.48f,.51f));view.gateMaterial=Mat("Zoo gates",new Color(.85f,.55f,.12f));view.crowdMaterial=Mat("Zoo passenger",new Color(.15f,.55f,.8f));
            if(stationId=="tianhe") {
                view.stationName="Tianhe";view.gateModuleId="gate-new-574";view.expectedGateId=419;view.gateX=174;view.gateY=-112;view.levelBase=-5;
                var graph=AssetDatabase.LoadAssetAtPath<TextAsset>(dir+"/TianheGraph.bytes");if(graph==null)throw new Exception("Tianhe graph missing");
                var crowd=new GameObject("Synthetic background crowd").AddComponent<TianheFeasibility>();crowd.graph=graph;crowd.material=view.crowdMaterial;crowd.manualMode=true;view.syntheticCrowd=crowd;
            }
            var light=new GameObject("Key light",typeof(Light));light.GetComponent<Light>().type=LightType.Directional;light.transform.rotation=Quaternion.Euler(50,-30,0);RenderSettings.ambientMode=AmbientMode.Flat;RenderSettings.ambientLight=Color.white*.5f;
            const string scene=dir+"/ZooGateSlice.unity";if(!EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(),scene))throw new Exception("Cannot save scene");AssetDatabase.SaveAssets();
            PlayerSettings.WebGL.compressionFormat=WebGLCompressionFormat.Disabled;PlayerSettings.WebGL.decompressionFallback=false;
            var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{scene},locationPathName=output,target=BuildTarget.WebGL,options=BuildOptions.None});
            File.WriteAllText(output+".report.txt",$"result={report.summary.result}\nbytes={report.summary.totalSize}\n");if(report.summary.result!=BuildResult.Succeeded)throw new Exception("Zoo slice build failed");
        }
    }
}
