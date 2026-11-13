using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App {
    /// <summary>
    /// Batched primitives for a generated assembly: boxes accumulate per palette
    /// colour and combine into one mesh each, so a 101-cell screen run costs a few
    /// draw calls instead of a thousand. Moving parts get their own transform through
    /// <see cref="Node"/> and are registered with a <see cref="ModuleMotion"/>.
    /// </summary>
    sealed class GeometryKit {
        readonly Mesh cube;
        readonly StationMaterials materials;
        readonly Transform root;
        readonly Dictionary<int, List<CombineInstance>> batches = new Dictionary<int, List<CombineInstance>>();
        readonly List<Mesh> meshes = new List<Mesh>();

        public GeometryKit(Transform parent, Mesh cube, StationMaterials materials) {
            root = new GameObject("Assembly").transform;
            root.SetParent(parent, false);
            this.cube = cube ?? throw new ArgumentNullException(nameof(cube));
            this.materials = materials ?? throw new ArgumentNullException(nameof(materials));
        }

        public Transform Root => root;

        public void Box(Vector3 centre, Vector3 size, int colour, Quaternion rotation = default) {
            if (!batches.TryGetValue(colour, out var parts)) batches.Add(colour, parts = new List<CombineInstance>());
            parts.Add(new CombineInstance {
                mesh = cube,
                transform = Matrix4x4.TRS(centre, rotation == default ? Quaternion.identity : rotation, size),
            });
        }

        /// <summary>A box in a local frame: `origin` plus `rotation * local`.</summary>
        public void LocalBox(Vector3 origin, Quaternion rotation, Vector3 local, Vector3 size, int colour) =>
            Box(origin + rotation * local, size, colour, rotation);

        public void Combine(string name) {
            foreach (var entry in batches) {
                if (entry.Value.Count == 0) continue;
                var mesh = new Mesh { name = name + " part", indexFormat = IndexFormat.UInt32 };
                mesh.CombineMeshes(entry.Value.ToArray());
                meshes.Add(mesh);
                var part = new GameObject(name + " part", typeof(MeshFilter), typeof(MeshRenderer));
                part.transform.SetParent(root, false);
                part.GetComponent<MeshFilter>().sharedMesh = mesh;
                part.GetComponent<MeshRenderer>().sharedMaterial = materials[entry.Key];
            }
            batches.Clear();
        }

        public Transform Node(string name, Vector3 position, Quaternion rotation) {
            var node = new GameObject(name).transform;
            node.SetParent(root, false);
            node.SetPositionAndRotation(position, rotation);
            return node;
        }

        /// <summary>One mesh instance as its own transform, for a moving part.</summary>
        public Transform Part(string name, Vector3 position, Vector3 size, Quaternion rotation, int colour) {
            var part = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            part.transform.SetParent(root, false);
            part.transform.SetPositionAndRotation(position, rotation);
            part.transform.localScale = size;
            part.GetComponent<MeshFilter>().sharedMesh = cube;
            part.GetComponent<MeshRenderer>().sharedMaterial = materials[colour];
            return part.transform;
        }

        public GameObject Finish(string name, bool disposeOnDestroy = true) {
            Combine(name);
            root.name = name;
            var holder = root.gameObject;
            if (disposeOnDestroy) holder.AddComponent<AssemblyOwner>().Bind(meshes);
            return holder;
        }
    }

    /// <summary>Frees an assembly's combined meshes with its host object.</summary>
    sealed class AssemblyOwner : MonoBehaviour {
        List<Mesh> meshes = new List<Mesh>();
        public void Bind(List<Mesh> owned) => meshes = owned;
        void OnDestroy() {
            foreach (var mesh in meshes) if (mesh) Destroy(mesh);
        }
    }
}
