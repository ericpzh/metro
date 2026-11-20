using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App.Views {
    /// <summary>
    /// Material-grouped mesh template extracted once per static catalogue prefab so repeated
    /// equipment and fence instances render through GPU-instanced chunk batches
    /// (<see cref="StationInstancedSurfaceBatch"/>) instead of spawning dozens of individual
    /// child <see cref="MeshRenderer"/> GameObjects per module.
    /// </summary>
    public sealed class StationPrefabMeshTemplate {
        public readonly struct Part {
            public readonly Mesh Mesh;
            public readonly int SubmeshIndex;
            public readonly Matrix4x4 LocalMatrix;
            public readonly Material SourceMaterial;
            public readonly ShadowCastingMode ShadowCasting;
            public readonly Bounds LocalBounds;
            public readonly bool IsTriangleTopology;

            public Part(
                Mesh mesh,
                int submeshIndex,
                Matrix4x4 localMatrix,
                Material sourceMaterial,
                ShadowCastingMode shadowCasting,
                Bounds localBounds,
                bool isTriangleTopology) {
                Mesh = mesh;
                SubmeshIndex = submeshIndex;
                LocalMatrix = localMatrix;
                SourceMaterial = sourceMaterial;
                ShadowCasting = shadowCasting;
                LocalBounds = localBounds;
                IsTriangleTopology = isTriangleTopology;
            }
        }

        public readonly Part[] Parts;
        public readonly Bounds LocalBounds;
        public readonly bool HasBounds;
        public readonly Vector3 PrefabLocalScale;
        public readonly Quaternion PrefabLocalRotation;

        StationPrefabMeshTemplate(
            Part[] parts,
            Bounds localBounds,
            bool hasBounds,
            Vector3 prefabLocalScale,
            Quaternion prefabLocalRotation) {
            Parts = parts;
            LocalBounds = localBounds;
            HasBounds = hasBounds;
            PrefabLocalScale = prefabLocalScale;
            PrefabLocalRotation = prefabLocalRotation;
        }

        /// <summary>Transform the prefab's local bounds into a document-space <see cref="StationBox"/>.</summary>
        public bool TryDocumentBounds(Matrix4x4 instanceWorldMatrix, out StationBox box) {
            box = default;
            if (!HasBounds) return false;
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            var lb = LocalBounds;
            for (int c = 0; c < 8; c++) {
                var p = instanceWorldMatrix.MultiplyPoint3x4(new Vector3(
                    (c & 1) == 0 ? lb.min.x : lb.max.x,
                    (c & 2) == 0 ? lb.min.y : lb.max.y,
                    (c & 4) == 0 ? lb.min.z : lb.max.z));
                var doc = StationCoordinates.WorldToDocument(p);
                min = Vector3.Min(min, doc);
                max = Vector3.Max(max, doc);
            }
            box = new StationBox(min.x, min.y, min.z, max.x, max.y, max.z);
            return !box.IsEmpty;
        }

        /// <summary>Transform a part's local bounds by a world matrix into world-space <see cref="Bounds"/>.</summary>
        public static Bounds TransformBounds(Bounds local, Matrix4x4 matrix) {
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            for (int c = 0; c < 8; c++) {
                var p = matrix.MultiplyPoint3x4(new Vector3(
                    (c & 1) == 0 ? local.min.x : local.max.x,
                    (c & 2) == 0 ? local.min.y : local.max.y,
                    (c & 4) == 0 ? local.min.z : local.max.z));
                min = Vector3.Min(min, p);
                max = Vector3.Max(max, p);
            }
            return new Bounds((min + max) * 0.5f, max - min);
        }

        sealed class MaterialGroupKey : IEquatable<MaterialGroupKey> {
            public readonly Material Material;
            public readonly ShadowCastingMode Shadow;

            public MaterialGroupKey(Material material, ShadowCastingMode shadow) {
                Material = material;
                Shadow = shadow;
            }

            public bool Equals(MaterialGroupKey other) =>
                other != null && ReferenceEquals(Material, other.Material) && Shadow == other.Shadow;

            public override bool Equals(object obj) => obj is MaterialGroupKey other && Equals(other);

            public override int GetHashCode() {
                unchecked {
                    int h = Material != null ? System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(Material) : 0;
                    return (h * 397) ^ (int)Shadow;
                }
            }
        }

        sealed class CombineBucket {
            public Material Material;
            public ShadowCastingMode Shadow;
            public readonly List<CombineInstance> Combines = new List<CombineInstance>();
            public int VertexCount;
        }

        static bool IsActiveInPrefab(Transform node, Transform prefabRoot) {
            var cur = node;
            while (cur != null) {
                if (!cur.gameObject.activeSelf) return false;
                if (cur == prefabRoot) return true;
                cur = cur.parent;
            }
            return true;
        }

        public static bool TryBuild(GameObject prefab, List<Mesh> ownedMeshes, out StationPrefabMeshTemplate template) {
            template = null;
            if (prefab == null) return false;
            if (prefab.GetComponentInChildren<SkinnedMeshRenderer>(true) != null) return false;

            var filters = prefab.GetComponentsInChildren<MeshFilter>(true);
            if (filters == null || filters.Length == 0) return false;

            var rootInv = prefab.transform.worldToLocalMatrix;
            var groups = new Dictionary<MaterialGroupKey, CombineBucket>();
            var groupOrder = new List<CombineBucket>();
            var passthrough = new List<Part>();

            bool anyBounds = false;
            Bounds combinedLocal = default;

            for (int i = 0; i < filters.Length; i++) {
                var filter = filters[i];
                if (filter == null || !IsActiveInPrefab(filter.transform, prefab.transform)) continue;
                var mesh = filter.sharedMesh;
                if (mesh == null || mesh.vertexCount == 0) continue;
                var renderer = filter.GetComponent<MeshRenderer>();
                if (renderer == null || !renderer.enabled) continue;
                var mats = renderer.sharedMaterials;
                if (mats == null || mats.Length == 0) continue;

                var localToRoot = rootInv * filter.transform.localToWorldMatrix;
                var partBounds = TransformBounds(mesh.bounds, localToRoot);
                if (!anyBounds) { combinedLocal = partBounds; anyBounds = true; }
                else combinedLocal.Encapsulate(partBounds);

                int subCount = Math.Max(1, mesh.subMeshCount);
                for (int s = 0; s < subCount; s++) {
                    var mat = mats[Math.Min(s, mats.Length - 1)];
                    if (mat == null) continue;
                    var topo = mesh.GetTopology(s);
                    bool isTri = topo == MeshTopology.Triangles;
                    if (isTri && mesh.isReadable) {
                        var key = new MaterialGroupKey(mat, renderer.shadowCastingMode);
                        if (!groups.TryGetValue(key, out var bucket)) {
                            bucket = new CombineBucket { Material = mat, Shadow = renderer.shadowCastingMode };
                            groups[key] = bucket;
                            groupOrder.Add(bucket);
                        }
                        bucket.Combines.Add(new CombineInstance {
                            mesh = mesh,
                            subMeshIndex = s,
                            transform = localToRoot,
                        });
                        bucket.VertexCount += mesh.vertexCount;
                    } else {
                        passthrough.Add(new Part(
                            mesh,
                            s,
                            localToRoot,
                            mat,
                            renderer.shadowCastingMode,
                            mesh.bounds,
                            isTri));
                    }
                }
            }

            if (groupOrder.Count == 0 && passthrough.Count == 0) return false;

            var parts = new List<Part>(groupOrder.Count + passthrough.Count);
            for (int g = 0; g < groupOrder.Count; g++) {
                var bucket = groupOrder[g];
                if (bucket.Combines.Count == 1) {
                    var single = bucket.Combines[0];
                    parts.Add(new Part(
                        single.mesh,
                        single.subMeshIndex,
                        single.transform,
                        bucket.Material,
                        bucket.Shadow,
                        single.mesh.bounds,
                        isTriangleTopology: true));
                    continue;
                }
                var merged = new Mesh {
                    name = prefab.name + " [" + (bucket.Material != null ? bucket.Material.name : "mat") + "]",
                    indexFormat = bucket.VertexCount > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16,
                };
                merged.CombineMeshes(bucket.Combines.ToArray(), mergeSubMeshes: true, useMatrices: true);
                merged.RecalculateBounds();
                ownedMeshes?.Add(merged);
                parts.Add(new Part(
                    merged,
                    0,
                    Matrix4x4.identity,
                    bucket.Material,
                    bucket.Shadow,
                    merged.bounds,
                    isTriangleTopology: true));
            }
            for (int p = 0; p < passthrough.Count; p++) parts.Add(passthrough[p]);

            template = new StationPrefabMeshTemplate(
                parts.ToArray(),
                combinedLocal,
                anyBounds,
                prefab.transform.localScale,
                prefab.transform.localRotation);
            return true;
        }
    }

    /// <summary>
    /// Per-world cache of material-merged prefab templates and cloned instancing-enabled materials
    /// (never mutating imported asset materials). Disposed when the owning world is disposed.
    /// </summary>
    public sealed class StationPrefabTemplateCache : IDisposable {
        sealed class ReferenceComparer<T> : IEqualityComparer<T> where T : class {
            public static readonly ReferenceComparer<T> Instance = new ReferenceComparer<T>();
            public bool Equals(T x, T y) => ReferenceEquals(x, y);
            public int GetHashCode(T obj) => obj == null ? 0 : System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(obj);
        }

        readonly Dictionary<GameObject, StationPrefabMeshTemplate> templates =
            new Dictionary<GameObject, StationPrefabMeshTemplate>(ReferenceComparer<GameObject>.Instance);
        readonly Dictionary<Material, Material> instancedMaterials =
            new Dictionary<Material, Material>(ReferenceComparer<Material>.Instance);
        readonly List<Mesh> ownedMeshes = new List<Mesh>();
        Mesh proxyEmptyMesh;

        public bool TryGetTemplate(GameObject prefab, out StationPrefabMeshTemplate template) {
            template = null;
            if (prefab == null) return false;
            if (templates.TryGetValue(prefab, out template)) return template != null;
            if (!StationPrefabMeshTemplate.TryBuild(prefab, ownedMeshes, out template)) {
                templates[prefab] = null;
                return false;
            }
            templates[prefab] = template;
            return true;
        }

        public Material InstancedMaterialFor(Material source) {
            if (source == null) return null;
            if (instancedMaterials.TryGetValue(source, out var existing) && existing != null) return existing;
            var clone = new Material(source) { name = source.name, enableInstancing = true };
            instancedMaterials[source] = clone;
            return clone;
        }

        public Mesh ProxyEmptyMesh() {
            if (proxyEmptyMesh == null) {
                proxyEmptyMesh = new Mesh { name = "instanced batch proxy" };
                ownedMeshes.Add(proxyEmptyMesh);
            }
            return proxyEmptyMesh;
        }

        public void Dispose() {
            for (int i = 0; i < ownedMeshes.Count; i++) {
                if (ownedMeshes[i] != null) DestroyAsset(ownedMeshes[i]);
            }
            ownedMeshes.Clear();
            proxyEmptyMesh = null;
            foreach (var kv in instancedMaterials) {
                if (kv.Value != null) DestroyAsset(kv.Value);
            }
            instancedMaterials.Clear();
            templates.Clear();
        }

        static void DestroyAsset(UnityEngine.Object asset) {
            if (asset == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(asset);
            else UnityEngine.Object.DestroyImmediate(asset);
        }
    }

    /// <summary>One static placed module instance feeding a spatial GPU-instanced prefab chunk.</summary>
    public readonly struct StationStaticPrefabItem {
        public readonly string ModuleId;
        public readonly Matrix4x4 WorldMatrix;
        public readonly StationBox DocumentBounds;

        public StationStaticPrefabItem(string moduleId, Matrix4x4 worldMatrix, StationBox documentBounds) {
            ModuleId = moduleId;
            WorldMatrix = worldMatrix;
            DocumentBounds = documentBounds;
        }
    }

    /// <summary>
    /// Built GameObjects, instanced batches, and view records for one spatial chunk
    /// `(storeyBand, chunkX, chunkY, viewKey)`.
    /// </summary>
    public sealed class StationInstancedPrefabChunk {
        public readonly List<GameObject> Views = new List<GameObject>();
        public readonly List<Mesh> ProxyMeshes = new List<Mesh>();
        public readonly List<StationInstancedSurfaceBatch> Batches = new List<StationInstancedSurfaceBatch>();
        public readonly List<StationViewRecord> Records = new List<StationViewRecord>();
        public readonly HashSet<string> ModuleIds = new HashSet<string>(StringComparer.Ordinal);

        public void RegisterInto(StationWorldView world, StationInstancedSurfaceDrawer drawer) {
            if (world != null) {
                for (int i = 0; i < Records.Count; i++) {
                    var r = Records[i];
                    world.RegisterModule(r.Role, r.ModuleId, r.View, r.Part,
                        r.HasBounds ? r.Bounds : (StationBox?)null,
                        r.LevelMin, r.LevelMax, r.LevelBands, r.SourceIds, r.SourceBounds);
                }
            }
            if (drawer != null) {
                for (int i = 0; i < Batches.Count; i++) drawer.Add(Batches[i]);
            }
        }

        public void RetireFrom(StationWorldView world, StationInstancedSurfaceDrawer drawer, StationLocalViewCommit commit) {
            if (drawer != null) {
                for (int i = 0; i < Batches.Count; i++) drawer.Remove(Batches[i]);
            }
            if (world != null && Views.Count > 0) {
                var viewSet = new HashSet<GameObject>(Views);
                world.RetireRecordsWhere(rec => rec != null && rec.View != null && viewSet.Contains(rec.View),
                    commit, retireViewObjects: true);
            }
            if (commit != null) {
                for (int i = 0; i < ProxyMeshes.Count; i++) {
                    if (ProxyMeshes[i] != null) commit.RetiredMeshes.Add(ProxyMeshes[i]);
                }
            }
        }

        public void DestroyUncommitted() {
            for (int i = 0; i < ProxyMeshes.Count; i++) {
                if (ProxyMeshes[i] == null) continue;
                if (Application.isPlaying) UnityEngine.Object.Destroy(ProxyMeshes[i]);
                else UnityEngine.Object.DestroyImmediate(ProxyMeshes[i]);
            }
            ProxyMeshes.Clear();
            for (int i = 0; i < Views.Count; i++) {
                if (Views[i] != null) StationWorldView.DestroyView(Views[i]);
            }
            Views.Clear();
            Batches.Clear();
            Records.Clear();
            ModuleIds.Clear();
        }

        public static StationInstancedPrefabChunk Build(
            string role,
            string label,
            StationPrefabMeshTemplate template,
            StationPrefabTemplateCache cache,
            Transform parent,
            List<StationStaticPrefabItem> items,
            int levelMin,
            int levelMax,
            int[] levelBands) {
            var chunk = new StationInstancedPrefabChunk();
            if (template == null || cache == null || items == null || items.Count == 0) return chunk;

            int count = items.Count;
            var sourceIds = new string[count];
            var sourceBounds = new StationBox[count];
            StationBox unionDoc = default;
            bool hasUnion = false;

            for (int i = 0; i < count; i++) {
                var item = items[i];
                sourceIds[i] = item.ModuleId;
                sourceBounds[i] = item.DocumentBounds;
                if (!string.IsNullOrEmpty(item.ModuleId)) chunk.ModuleIds.Add(item.ModuleId);
                if (!item.DocumentBounds.IsEmpty) {
                    if (!hasUnion) { unionDoc = item.DocumentBounds; hasUnion = true; }
                    else {
                        unionDoc = new StationBox(
                            Math.Min(unionDoc.X0, item.DocumentBounds.X0),
                            Math.Min(unionDoc.Y0, item.DocumentBounds.Y0),
                            Math.Min(unionDoc.Z0, item.DocumentBounds.Z0),
                            Math.Max(unionDoc.X1, item.DocumentBounds.X1),
                            Math.Max(unionDoc.Y1, item.DocumentBounds.Y1),
                            Math.Max(unionDoc.Z1, item.DocumentBounds.Z1));
                    }
                }
            }

            var parts = template.Parts;
            var combines = new List<CombineInstance>(count);
            var instanceSources = new List<int>(count);

            for (int p = 0; p < parts.Length; p++) {
                var part = parts[p];
                if (part.Mesh == null || part.SourceMaterial == null) continue;
                var instMat = cache.InstancedMaterialFor(part.SourceMaterial);
                if (instMat == null) continue;

                combines.Clear();
                instanceSources.Clear();
                bool partLocalIdentity = part.LocalMatrix.isIdentity;
                Bounds worldBounds = default;
                bool hasWorldBounds = false;

                for (int i = 0; i < count; i++) {
                    var mat = partLocalIdentity ? items[i].WorldMatrix : items[i].WorldMatrix * part.LocalMatrix;
                    combines.Add(new CombineInstance {
                        mesh = part.Mesh,
                        subMeshIndex = part.SubmeshIndex,
                        transform = mat,
                    });
                    instanceSources.Add(i);
                    var wb = StationPrefabMeshTemplate.TransformBounds(part.LocalBounds, mat);
                    if (!hasWorldBounds) { worldBounds = wb; hasWorldBounds = true; }
                    else worldBounds.Encapsulate(wb);
                }

                var proxyMesh = new Mesh { name = label + " p" + p + " (bounds)", bounds = worldBounds };
                chunk.ProxyMeshes.Add(proxyMesh);

                var go = new GameObject(label + " p" + p);
                go.transform.SetParent(parent, false);
                var mf = go.AddComponent<MeshFilter>();
                mf.sharedMesh = proxyMesh;
                var mr = go.AddComponent<MeshRenderer>();
                mr.sharedMaterial = instMat;
                mr.shadowCastingMode = part.ShadowCasting;
                mr.receiveShadows = true;

                var batch = go.AddComponent<StationInstancedSurfaceBatch>();
                batch.ShadowCasting = part.ShadowCasting;
                batch.Configure(part.Mesh, part.SubmeshIndex, mr, worldBounds, combines, count, instanceSources);

                var rec = new StationViewRecord {
                    Role = role,
                    ModuleId = "",
                    View = go,
                    Part = "instanced-batch",
                    Bounds = unionDoc,
                    HasBounds = hasUnion,
                    LevelMin = levelMin,
                    LevelMax = levelMax,
                    LevelBands = levelBands,
                    SourceIds = sourceIds,
                    SourceBounds = sourceBounds,
                };

                chunk.Views.Add(go);
                chunk.Batches.Add(batch);
                chunk.Records.Add(rec);
            }

            return chunk;
        }
    }
}
