using System;
using UnityEngine;

namespace Metro {
    // References wrapper prefabs, never mutable glTFast-generated assets.
    public sealed class ImportedAssetCatalogue : ScriptableObject {
        public Entry[] entries;
        [Serializable] public sealed class Entry {
            public string id;
            public string sha256;
            public GameObject prefab;
            public string[] anchors;
            public string[] clips;
            public string[] dynamicParts;
        }
    }
}
