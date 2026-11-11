using System;
using System.IO;
using Metro.Feasibility;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Metro.Feasibility.Editor {
    public static class Build {
        public static void Run() {
            var args=Environment.GetCommandLineArgs(); int i=Array.IndexOf(args,"-feasibilityOut");
            if(i<0 || i+1>=args.Length) throw new Exception("Missing feasibility output");
            var output=Path.GetFullPath(args[i+1]); if(Directory.Exists(output)) throw new Exception("Output exists");
            Directory.CreateDirectory("Assets/StationDesigner/FeasibilityGenerated");
            int shaderArg=Array.IndexOf(args,"-feasibilityShader");
            string shaderName=shaderArg>=0 && shaderArg+1<args.Length && args[shaderArg+1]=="unlit" ? "Universal Render Pipeline/Unlit" : "Universal Render Pipeline/Lit";
            var shader=Shader.Find(shaderName); if(shader==null)throw new Exception("Missing shader: "+shaderName);
            var material=AssetDatabase.LoadAssetAtPath<Material>("Assets/StationDesigner/FeasibilityGenerated/Crowd.mat");
            if(material==null) { material=new Material(shader); material.name="Original placeholder material"; AssetDatabase.CreateAsset(material,"Assets/StationDesigner/FeasibilityGenerated/Crowd.mat"); }
            material.shader=shader; material.color=new Color(.15f,.55f,.8f); material.enableInstancing=true; EditorUtility.SetDirty(material);

            var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
            var camera=new GameObject("Main Camera",typeof(Camera)); camera.tag="MainCamera"; camera.GetComponent<Camera>().clearFlags=CameraClearFlags.SolidColor; camera.GetComponent<Camera>().backgroundColor=new Color(.08f,.11f,.14f);
            var light=new GameObject("Light",typeof(Light)); light.GetComponent<Light>().type=LightType.Directional; light.transform.rotation=Quaternion.Euler(50,-30,0);
            var host=new GameObject("Tianhe actual graph scale spike").AddComponent<TianheFeasibility>(); host.graph=AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/StationDesigner/FeasibilityGenerated/TianheGraph.bytes"); host.material=material;
            if(host.graph==null) throw new Exception("Graph missing");
            var scenePath="Assets/StationDesigner/FeasibilityGenerated/Tianhe.unity"; if(!EditorSceneManager.SaveScene(scene,scenePath)) throw new Exception("Scene save failed"); AssetDatabase.SaveAssets();
            PlayerSettings.WebGL.compressionFormat=WebGLCompressionFormat.Disabled; PlayerSettings.WebGL.decompressionFallback=false;
            var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions {scenes=new[]{scenePath},locationPathName=output,target=BuildTarget.WebGL,options=BuildOptions.None});
            File.WriteAllText(output+".report.txt",$"result={report.summary.result}\nbytes={report.summary.totalSize}\n");
            if(report.summary.result!=BuildResult.Succeeded) throw new Exception("Feasibility build failed");
        }
    }
}

