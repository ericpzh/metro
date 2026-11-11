using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using Metro.Feasibility;
using UnityEditor;
using UnityEngine;

namespace Metro.Feasibility.Editor {
    // Invokes the exact Web spike's Step method; no rendering or performance timing.
    public static class CheckFixedTicks {
        [Serializable] sealed class Result { public int tick,queued,admitted,completed; public string nodes,agentQueue,heads,lengths,credits,queue; }
        static string Hash(Array array) { var bytes=new byte[Buffer.ByteLength(array)];Buffer.BlockCopy(array,0,bytes,0,bytes.Length);using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant(); }
        public static void Run() {
            var args=Environment.GetCommandLineArgs();int i=Array.IndexOf(args,"-fixedTickOut");if(i<0||i+1>=args.Length)throw new ArgumentException("Missing output");
            var camera=new GameObject("Main Camera",typeof(Camera));camera.tag="MainCamera";
            var obj=new GameObject("Fixed tick harness");obj.SetActive(false);var host=obj.AddComponent<TianheFeasibility>();
            host.graph=AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/StationDesigner/FeasibilityGenerated/TianheGraph.bytes");host.material=new Material(Shader.Find("Universal Render Pipeline/Lit"));
            if(host.graph==null)throw new Exception("Graph missing");obj.SetActive(true);
            var type=typeof(TianheFeasibility);var flags=BindingFlags.Instance|BindingFlags.NonPublic;var step=type.GetMethod("Step",flags); type.GetMethod("Awake",flags).Invoke(host,null);
            object Value(string field)=>type.GetField(field,flags).GetValue(host);
            for(int j=0;j<512;j++)step.Invoke(host,null);
            var result=new Result { tick=(int)Value("tick"),queued=(int)Value("queued"),admitted=(int)Value("admitted"),completed=(int)Value("completed"),nodes=Hash((int[])Value("agentNodes")),agentQueue=Hash((int[])Value("agentQueue")),heads=Hash((int[])Value("heads")),lengths=Hash((int[])Value("lengths")),credits=Hash((float[])Value("credits")),queue=Hash((int[])Value("queueData")) };
            File.WriteAllText(Path.GetFullPath(args[i+1]),JsonUtility.ToJson(result,true));
            UnityEngine.Object.DestroyImmediate(obj);UnityEngine.Object.DestroyImmediate(camera);
        }
    }
}

