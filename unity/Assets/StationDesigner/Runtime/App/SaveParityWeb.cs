using System;
using System.Runtime.InteropServices;
using Metro.Persistence;
using UnityEngine;

namespace Metro.App {
    // QA-only scene component: exercises the production R2 reader/writer under IL2CPP.
    public sealed class SaveParityWeb : MonoBehaviour {
        public TextAsset fixture;
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void MetroSaveParityResult(string json, int droppedCells, int droppedModules);
        [DllImport("__Internal")] static extern void MetroSaveParityError(string message);
#else
        static void MetroSaveParityResult(string json,int cells,int modules) { Debug.Log(json); }
        static void MetroSaveParityError(string message) { Debug.LogError(message); }
#endif
        void Start() {
            try {
                var save=StationSaveV1.Read(fixture.text);
                MetroSaveParityResult(save.Write(new DateTimeOffset(2020,1,2,3,4,5,TimeSpan.Zero)),save.DroppedCells,save.DroppedModules);
            } catch (Exception ex) { MetroSaveParityError(ex.ToString()); }
        }
    }
}
