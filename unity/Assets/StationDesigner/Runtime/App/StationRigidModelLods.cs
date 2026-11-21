using System;
using UnityEngine;

namespace Metro.App {
    public sealed class StationRigidModelLods : ScriptableObject {
        public const string ResourcesPath = "ModelLods/Rigid/";

        [Serializable]
        public struct Entry {
            public Mesh Source;
            public Mesh Baked;
            public string ReuseReason;
        }

        public Entry[] Meshes = Array.Empty<Entry>();
        public string PrefabDependencyHash;

        public static void Apply(GameObject instance, string prefabName) {
            if (instance == null || string.IsNullOrEmpty(prefabName)) return;
            var library = Resources.Load<StationRigidModelLods>(ResourcesPath + prefabName);
            if (library == null) return;
            foreach (var filter in instance.GetComponentsInChildren<MeshFilter>(true)) {
                var source = filter.sharedMesh;
                if (source == null) continue;
                var mesh = library.Resolve(source);
                if (mesh != source) filter.sharedMesh = mesh;
            }
        }

        public Mesh Resolve(Mesh source) {
            foreach (var entry in Meshes)
                if (entry.Source == source && entry.Baked != null) return entry.Baked;
            return source;
        }
    }
}
