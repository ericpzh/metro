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

    /// <summary>
    /// A **correctly wound, flat-shaded box** for the hand-built meshes (RCA 15 §3).
    ///
    /// The hand-built cubes in <c>BoothModuleViews</c> and <c>VerticalModuleViews</c> used one
    /// shared 8-vertex box with a perimeter-order index table. That numbering (x = bit 0,
    /// y = bit 1, z = bit 2) is not the table's order, so every "quad" was a bowtie: its two
    /// triangles had opposite signed areas, and `RecalculateNormals` then averaged the eight
    /// shared corners into one smooth blob. Opaque and transparent parts alike were affected
    /// before any material setting, which is why the Zoo booths and lifts showed triangular
    /// artifacts and dull sheet metal.
    ///
    /// This helper emits *per face vertices* (four per face, six faces) so each face keeps its
    /// own normal, and winds each triangle so `Cross(b - a, c - a)` points away from the box
    /// centre — the same test <c>OpeningModuleViews.OpeningBuilder.UnitCube</c> uses, and the
    /// direction Unity treats as a front face under backface culling. Callers pass the three
    /// **full edge vectors** of the box, already in the target space, so a document-axis or
    /// mirrored caller cannot get the handedness wrong: the winding is derived from the
    /// corners, not from an index table.
    /// </summary>
    public static class BoxFaces {
        /// <summary>Append one box from its centre and three full edge vectors.</summary>
        public static void Append(List<Vector3> vertices, List<int> triangles, Vector3 centre,
            Vector3 edgeX, Vector3 edgeY, Vector3 edgeZ) {
            Face(vertices, triangles, centre, edgeX, edgeY, edgeZ);
            Face(vertices, triangles, centre, -edgeX, edgeY, edgeZ);
            Face(vertices, triangles, centre, edgeY, edgeZ, edgeX);
            Face(vertices, triangles, centre, -edgeY, edgeZ, edgeX);
            Face(vertices, triangles, centre, edgeZ, edgeX, edgeY);
            Face(vertices, triangles, centre, -edgeZ, edgeX, edgeY);
        }

        /// <summary>Append one axis-aligned box: centre and size in the target space.</summary>
        public static void AppendAxisAligned(List<Vector3> vertices, List<int> triangles, Vector3 centre, Vector3 size) =>
            Append(vertices, triangles, centre, new Vector3(size.x, 0f, 0f), new Vector3(0f, size.y, 0f),
                new Vector3(0f, 0f, size.z));

        /// <summary>
        /// Append one axis-aligned box with **metre UVs**, one flat quad per face: each
        /// face's UVs span its own size in metres from 0, exactly like the source's
        /// `finishSlab` / `metreUv` (`BoxGeometry` scaled per face). A finish material
        /// therefore tiles at its authored texture scale instead of stretching one texel
        /// across the slab.
        /// </summary>
        public static void AppendAxisAlignedUv(List<Vector3> vertices, List<int> triangles,
            List<Vector2> uvs, Vector3 centre, Vector3 size) =>
            AppendUv(vertices, triangles, uvs, centre, new Vector3(size.x, 0f, 0f), new Vector3(0f, size.y, 0f),
                new Vector3(0f, 0f, size.z));

        /// <summary>Append one box from its centre and three full edge vectors, with metre UVs.</summary>
        public static void AppendUv(List<Vector3> vertices, List<int> triangles, List<Vector2> uvs,
            Vector3 centre, Vector3 edgeX, Vector3 edgeY, Vector3 edgeZ) {
            FaceUv(vertices, triangles, uvs, centre, edgeX, edgeY, edgeZ);
            FaceUv(vertices, triangles, uvs, centre, -edgeX, edgeY, edgeZ);
            FaceUv(vertices, triangles, uvs, centre, edgeY, edgeZ, edgeX);
            FaceUv(vertices, triangles, uvs, centre, -edgeY, edgeZ, edgeX);
            FaceUv(vertices, triangles, uvs, centre, edgeZ, edgeX, edgeY);
            FaceUv(vertices, triangles, uvs, centre, -edgeZ, edgeX, edgeY);
        }

        /// <summary>
        /// One face of the box: `outwardEdge` is the full edge that points away from the
        /// centre through this face, and `a` / `b` span it.
        /// </summary>
        static void Face(List<Vector3> vertices, List<int> triangles, Vector3 centre,
            Vector3 outwardEdge, Vector3 a, Vector3 b) {
            var faceCentre = centre + outwardEdge * .5f;
            var p0 = faceCentre - a * .5f - b * .5f;
            var p1 = faceCentre + a * .5f - b * .5f;
            var p2 = faceCentre + a * .5f + b * .5f;
            var p3 = faceCentre - a * .5f + b * .5f;
            int start = vertices.Count;
            vertices.Add(p0);
            vertices.Add(p1);
            vertices.Add(p2);
            vertices.Add(p3);
            // Winding follows the corner geometry, so a mirrored document-to-Unity mapping or a
            // left-handed edge basis still comes out facing the viewer.
            bool flipped = Vector3.Dot(Vector3.Cross(p1 - p0, p2 - p0), outwardEdge) < 0f;
            if (flipped) {
                triangles.Add(start); triangles.Add(start + 2); triangles.Add(start + 1);
                triangles.Add(start); triangles.Add(start + 3); triangles.Add(start + 2);
            } else {
                triangles.Add(start); triangles.Add(start + 1); triangles.Add(start + 2);
                triangles.Add(start); triangles.Add(start + 2); triangles.Add(start + 3);
            }
        }

        /// <summary>One face of the box with metre UVs, in the same corner order as <see cref="Face"/>.</summary>
        static void FaceUv(List<Vector3> vertices, List<int> triangles, List<Vector2> uvs, Vector3 centre,
            Vector3 outwardEdge, Vector3 a, Vector3 b) {
            var faceCentre = centre + outwardEdge * .5f;
            var p0 = faceCentre - a * .5f - b * .5f;
            var p1 = faceCentre + a * .5f - b * .5f;
            var p2 = faceCentre + a * .5f + b * .5f;
            var p3 = faceCentre - a * .5f + b * .5f;
            int start = vertices.Count;
            vertices.Add(p0);
            vertices.Add(p1);
            vertices.Add(p2);
            vertices.Add(p3);
            float u = a.magnitude;
            float v = b.magnitude;
            uvs.Add(new Vector2(0f, 0f));
            uvs.Add(new Vector2(u, 0f));
            uvs.Add(new Vector2(u, v));
            uvs.Add(new Vector2(0f, v));
            bool flipped = Vector3.Dot(Vector3.Cross(p1 - p0, p2 - p0), outwardEdge) < 0f;
            if (flipped) {
                triangles.Add(start); triangles.Add(start + 2); triangles.Add(start + 1);
                triangles.Add(start); triangles.Add(start + 3); triangles.Add(start + 2);
            } else {
                triangles.Add(start); triangles.Add(start + 1); triangles.Add(start + 2);
                triangles.Add(start); triangles.Add(start + 2); triangles.Add(start + 3);
            }
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
