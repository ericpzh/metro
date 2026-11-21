using System;
using System.Collections.Generic;
using UnityEngine;

namespace Metro.View {
    [PreferBinarySerialization]
    public sealed class TrainMeshLods : ScriptableObject {
        public const string ResourceKey = "ModelLods/TrainMeshes";

        [Serializable]
        public struct Entry {
            public Mesh full;
            public Mesh low;
        }

        public Entry[] entries = Array.Empty<Entry>();
        Dictionary<Mesh, Mesh> lookup;

        public Mesh FindLow(Mesh full) {
            if (lookup == null) {
                lookup = new Dictionary<Mesh, Mesh>(entries.Length);
                foreach (var entry in entries)
                    if (entry.full != null && entry.low != null) lookup.Add(entry.full, entry.low);
            }
            return full != null && lookup.TryGetValue(full, out var low) ? low : null;
        }
    }
}
