using System;
using System.Runtime.InteropServices;
using Metro.Persistence;
using UnityEngine;

namespace Metro.App {
    // Local W2 proof: retain a parsed Zoo document and acknowledge only after C# loads it.
    public sealed class DemoRouteProbe : MonoBehaviour {
        public TextAsset zooFixture;
        StationSaveV1 document;
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern int MetroDemoIsZoo();
        [DllImport("__Internal")] static extern void MetroDemoLoaded(int cells,int modules,int lines);
        [DllImport("__Internal")] static extern void MetroDemoFailed(string error);
#else
        static int MetroDemoIsZoo() => 0;
        static void MetroDemoLoaded(int cells,int modules,int lines) { }
        static void MetroDemoFailed(string error) { Debug.LogError(error); }
#endif
        void Start() {
            if(MetroDemoIsZoo()==0)return;
            try { document=StationSaveV1.Read(zooFixture.text); MetroDemoLoaded(document.CellCount,document.ModuleCount,document.LineCount); }
            catch(Exception error) { MetroDemoFailed(error.ToString()); }
        }
    }
}
