using UnityEngine;

namespace Metro.Feasibility {
    /// <summary>Original geometric stand-in for scale experiments; no external character assets.</summary>
    public static class PlaceholderCrowdMesh {
        // Metres, Unity Y-up. Asymmetric right shoulder tab makes facing visible.
        public static Mesh Create() {
            var parts = new[] {
                Box(new Vector3(0, 0.98f, 0), new Vector3(0.42f, 0.62f, 0.22f)),
                Box(new Vector3(0, 1.47f, 0), new Vector3(0.26f, 0.32f, 0.24f)),
                Box(new Vector3(-0.14f, 0.34f, 0), new Vector3(0.15f, 0.68f, 0.18f)),
                Box(new Vector3(0.14f, 0.34f, 0), new Vector3(0.15f, 0.68f, 0.18f)),
                Box(new Vector3(-0.29f, 0.99f, 0), new Vector3(0.14f, 0.58f, 0.16f)),
                Box(new Vector3(0.29f, 0.99f, 0), new Vector3(0.14f, 0.58f, 0.16f)),
                Box(new Vector3(0.37f, 1.22f, 0.12f), new Vector3(0.10f, 0.10f, 0.08f))
            };
            var result = new Mesh { name = "Original crowd placeholder" };
            result.CombineMeshes(parts, true, true);
            foreach (var part in parts) { if (Application.isPlaying) Object.Destroy(part.mesh); else Object.DestroyImmediate(part.mesh); }
            result.RecalculateBounds();
            return result;
        }
        private static CombineInstance Box(Vector3 center, Vector3 size) {
            var half = size * 0.5f;
            var v = new[] {new Vector3(-half.x,-half.y,-half.z),new Vector3(half.x,-half.y,-half.z),new Vector3(half.x,half.y,-half.z),new Vector3(-half.x,half.y,-half.z),new Vector3(-half.x,-half.y,half.z),new Vector3(half.x,-half.y,half.z),new Vector3(half.x,half.y,half.z),new Vector3(-half.x,half.y,half.z)};
            var mesh = new Mesh { vertices = v, triangles = new[] {0,2,1,0,3,2,4,5,6,4,6,7,0,4,7,0,7,3,1,2,6,1,6,5,3,7,6,3,6,2,0,1,5,0,5,4} };
            mesh.RecalculateNormals();
            return new CombineInstance { mesh = mesh, transform = Matrix4x4.Translate(center) };
        }
    }
}

