using System.Collections.Generic;
using UnityEngine;

namespace Metro.View {
    public static class StationMeshLodIndices {
        static Mesh.LodSelectionCurve selection = BuildCurve(.12f, .05f);

        public static void Configure(float full, float reduced) => selection = BuildCurve(full, reduced);

        static Mesh.LodSelectionCurve BuildCurve(float full, float reduced) {
            // The engine evaluates log2(inverse projected diameter in pixels).
            // Align the generated meshes with our relative thresholds at 1080p.
            float slope = 1f / Mathf.Log(Mathf.Max(1.01f, full / reduced), 2f);
            return new Mesh.LodSelectionCurve {
                lodSlope = slope,
                lodBias = 1f + Mathf.Log(1080f * full, 2f) * slope,
            };
        }

        public static void ApplyCombined(Mesh mesh, IReadOnlyList<CombineInstance> source, IReadOnlyList<int> lastTiers) {
            var inputIndices = new List<int>();
            mesh.GetTriangles(inputIndices, 0);
            var ranges = new int[source.Count + 1];
            int offset = 0;
            for (int i = 0; i < source.Count; i++) {
                var input = source[i];
                int count = (int)input.mesh.GetIndexCount(input.subMeshIndex);
                ranges[i] = offset;
                offset += count;
            }
            if (offset != inputIndices.Count) return;
            ranges[source.Count] = offset;
            var ordered = new List<int>(inputIndices.Count);
            void Append(int tier) {
                for (int i = 0; i < source.Count; i++) {
                    if (lastTiers[i] != tier) continue;
                    for (int next = ranges[i]; next < ranges[i + 1]; next++) ordered.Add(inputIndices[next]);
                }
            }
            Append(2);
            int simplifiedCount = ordered.Count;
            Append(1);
            int reducedCount = ordered.Count;
            Append(0);
            ApplySharedPrefix(mesh, ordered, reducedCount, simplifiedCount);
        }

        public static void ApplySharedPrefix(Mesh mesh, List<int> indices, int reducedCount, int simplifiedCount) {
            SetRanges(mesh, indices, new[] {
                new MeshLodRange(0, (uint)indices.Count),
                new MeshLodRange(0, (uint)reducedCount),
                new MeshLodRange(0, (uint)simplifiedCount),
            });
        }

        public static void ApplyLowOverride(Mesh mesh, List<int> indices, int fullCount, int reducedCount) {
            SetRanges(mesh, indices, new[] {
                new MeshLodRange(0, (uint)fullCount),
                new MeshLodRange(0, (uint)reducedCount),
                new MeshLodRange((uint)fullCount, (uint)(indices.Count - fullCount)),
            });
        }

        public static void Apply(Mesh mesh, List<int> full, List<int> reduced, List<int> simplified) {
            var packed = new List<int>(full.Count + reduced.Count + simplified.Count);
            packed.AddRange(full);
            packed.AddRange(reduced);
            packed.AddRange(simplified);
            var ranges = new[] {
                new MeshLodRange(0, (uint)full.Count),
                new MeshLodRange((uint)full.Count, (uint)reduced.Count),
                new MeshLodRange((uint)(full.Count + reduced.Count), (uint)simplified.Count),
            };
            SetRanges(mesh, packed, ranges);
        }

        static void SetRanges(Mesh mesh, List<int> indices, MeshLodRange[] ranges) {
            mesh.SetTriangles(indices, 0, calculateBounds: false);
            mesh.lodCount = ranges.Length;
            mesh.SetLods(ranges, 0);
            mesh.lodSelectionCurve = selection;
        }
    }
}
