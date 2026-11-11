using System;
using System.IO;
using Metro.App;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Metro.Editor {
    public static class BuildSaveParityWeb {
        public static void Run() {
            var args=Environment.GetCommandLineArgs(); int index=Array.IndexOf(args,"-saveParityOut");
            if(index<0 || index+1>=args.Length) throw new ArgumentException("Missing output");
            string output=Path.GetFullPath(args[index+1]); if(Directory.Exists(output)) throw new Exception("Output exists");
            var fixture=AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/StationDesigner/FeasibilityGenerated/AuthoredSave.txt");
            if(fixture==null) throw new Exception("Fixture missing");
            var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
            var camera=new GameObject("Main Camera",typeof(Camera));camera.tag="MainCamera";
            var host=new GameObject("Save parity").AddComponent<SaveParityWeb>();host.fixture=fixture;
            const string scenePath="Assets/StationDesigner/FeasibilityGenerated/SaveParity.unity";
            if(!EditorSceneManager.SaveScene(scene,scenePath)) throw new Exception("Cannot save scene");
            PlayerSettings.WebGL.compressionFormat=WebGLCompressionFormat.Disabled; PlayerSettings.WebGL.decompressionFallback=false;
            var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes=new[]{scenePath},locationPathName=output,target=BuildTarget.WebGL,options=BuildOptions.None });
            File.WriteAllText(output+".report.json",JsonUtility.ToJson(new Summary {result=report.summary.result.ToString(),totalSize=report.summary.totalSize},true));
            if(report.summary.result!=BuildResult.Succeeded) throw new Exception("Build failed");
        }
        [Serializable] sealed class Summary { public string result; public ulong totalSize; }
    }
}
