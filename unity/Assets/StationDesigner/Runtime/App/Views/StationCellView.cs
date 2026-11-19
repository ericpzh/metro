using System;
using System.Collections.Generic;
using System.IO;
using Metro.App;
using Metro.Build;
using Newtonsoft.Json.Linq;
using Metro.View;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App.Views {
    // Plan 11, packet E (E1) - the cell surface view.
    //
    // Owns the Unity objects for `StationCellMesher`'s document-axis geometry: one
    // mesh per chunk x storey x role x finish, one material per finish from the
    // exported finish library, and the per-face pick records painting reads.
    //
    // Placement is the caller's: the view adds its root under the parent it is given
    // and never decides a station transform. The **one** document-to-world conversion
    // happens here, in `ToWorld` (default: packet A's `StationCoordinates.Point`), and
    // because that swap is a reflection the triangle winding is reversed with it; the
    // mesher keeps the source's right-handed winding so its geometry stays comparable
    // with the TypeScript oracle.
    //
    // Grouping is what packet D needs to hide or ghost surfaces without a rebuild:
    // `StationSurfaceRole` (Cell / Ceiling / Plate / Ground), the storey band, the
    // chunk column and the finish id are all on `StationCellGroupView`, and every
    // group hangs under its role's transform.

    /// <summary>
    /// What the host hands the view: the cell records to mesh (already projected from
    /// the document), the ground rule, and the finish resolver. The view does not read
    /// the document itself, so it compiles against plain packet-E types.
    /// </summary>
    public sealed class StationCellViewRequest {
        /// <summary>The station cells and derived surface inputs (built by the host).</summary>
        public StationCellMeshInput Mesh = new StationCellMeshInput();
        /// <summary>The exported finish library that resolves a finish id to a material.</summary>
        public StationFinishLibrary Finishes;
        /// <summary>Optional resolver used instead of <see cref="Finishes"/> (tests, previews).</summary>
        public Func<string, Material> ResolveFinish;
        /// <summary>Document  world; defaults to packet A's <c>StationCoordinates.Point</c>.</summary>
        public Func<Vector3, Vector3> ToWorld;
        /// <summary>Stand-in material for a finish the library cannot resolve at all.</summary>
        public Material FallbackMaterial;
        public string Name = "Station cells";
        /// <summary>Whether the view computes and keeps the per-triangle pick map.</summary>
        public bool BuildPickMap = true;
    }

    /// <summary>One emitted run of geometry and the Unity objects that draw it.</summary>
    public sealed class StationCellGroupView {
        public StationCellMeshGroup Data;
        public GameObject GameObject;
        public MeshFilter Filter;
        public MeshRenderer Renderer;
        public Mesh Mesh;
        public Material Material;
        public Vector3[] WorldVertices;
        public int[] WorldIndices;
        public Transform Transform => GameObject != null ? GameObject.transform : null;

        public StationSurfaceRole Role => Data.Role;
        public string FinishId => Data.FinishId;
        public int ChunkX => Data.ChunkX;
        public int ChunkY => Data.ChunkY;
        public int Storey => Data.Storey;
        public int Triangles => Data.TriangleCount;
        public bool Wall { get; internal set; }

        public override string ToString() => Data != null ? Data.GroupKey : "(released)";
    }

    /// <summary>
    /// Camera and visibility filter applied during analytic cell triangle picking so only
    /// triangles that are currently rendered (enabled renderer, matching camera layer,
    /// clip interval, material face culling, and section plane keep test) can win a hit.
    /// </summary>
    public readonly struct StationCellPickFilter {
        readonly bool configured;
        readonly int cullingMask;
        readonly float minDistance;
        readonly float maxDistance;
        public readonly StationVisibilityRegistry Visibility;

        public StationCellPickFilter(int cullingMask, float minDistance, float maxDistance,
            StationVisibilityRegistry visibility) {
            configured = true;
            this.cullingMask = cullingMask;
            this.minDistance = Mathf.Max(0f, minDistance);
            this.maxDistance = float.IsNaN(maxDistance) ? float.PositiveInfinity : Mathf.Max(0f, maxDistance);
            Visibility = visibility;
        }

        public int CullingMask => configured ? cullingMask : ~0;
        public float MinDistance => configured ? minDistance : 0f;
        public float MaxDistance => configured ? maxDistance : float.PositiveInfinity;

        public static StationCellPickFilter Default =>
            new StationCellPickFilter(~0, 0f, float.PositiveInfinity, null);

        public static StationCellPickFilter FromCamera(Camera camera, StationVisibilityRegistry visibility) {
            if (camera == null) return new StationCellPickFilter(~0, 0f, float.PositiveInfinity, visibility);
            return new StationCellPickFilter(
                camera.cullingMask,
                Mathf.Max(0f, camera.nearClipPlane),
                camera.farClipPlane > 0f ? camera.farClipPlane : float.PositiveInfinity,
                visibility);
        }

        public static StationCellPickFilter FromCamera(Camera camera, Ray ray, StationVisibilityRegistry visibility) {
            if (camera == null) return new StationCellPickFilter(~0, 0f, float.PositiveInfinity, visibility);
            ClipInterval(camera, ray, out var min, out var max);
            return new StationCellPickFilter(camera.cullingMask, min, max, visibility);
        }

        /// <summary>
        /// Convert a camera's planar <c>[nearClipPlane, farClipPlane]</c> depth interval into ray
        /// parameter bounds <c>[minDistance, maxDistance]</c> along <paramref name="ray"/>.
        /// <c>Camera.ScreenPointToRay</c> starts on the near clip plane, whereas unit test rays
        /// may start at the eye or elsewhere; projecting along <c>camera.transform.forward</c>
        /// handles perspective, orthographic and eye-origin rays uniformly.
        /// </summary>
        public static void ClipInterval(Camera camera, Ray ray, out float minDistance, out float maxDistance) {
            if (camera == null) {
                minDistance = 0f;
                maxDistance = float.PositiveInfinity;
                return;
            }
            var forward = camera.transform.forward;
            var dir = ray.direction.sqrMagnitude > 1e-12f ? ray.direction.normalized : forward;
            float originDepth = Vector3.Dot(ray.origin - camera.transform.position, forward);
            float cosTheta = Vector3.Dot(dir, forward);
            float near = Mathf.Max(0f, camera.nearClipPlane);
            float far = camera.farClipPlane > 0f ? camera.farClipPlane : float.PositiveInfinity;
            if (cosTheta <= 1e-5f) {
                bool inSlice = originDepth >= near - 1e-4f && originDepth <= far + 1e-4f;
                minDistance = 0f;
                maxDistance = inSlice ? float.PositiveInfinity : 0f;
                return;
            }
            minDistance = Mathf.Max(0f, (near - originDepth) / cosTheta - 1e-4f);
            maxDistance = float.IsPositiveInfinity(far)
                ? float.PositiveInfinity
                : Mathf.Max(0f, (far - originDepth) / cosTheta + 1e-4f);
        }
    }

    /// <summary>A resolved pointer hit on the drawn surface: the pick record painting reads.</summary>
    public readonly struct StationCellPickHit {
        public readonly int X, Y, Z;
        public readonly StationFace Face;
        public readonly string FinishId;
        public readonly StationSurfaceRole Role;
        public readonly bool Slope;
        /// <summary>World-space hit point and the mesh's own (flat) normal.</summary>
        public readonly Vector3 Point;
        public readonly Vector3 Normal;
        public readonly float Distance;
        public readonly StationCellGroupView Group;

        public StationCellPickHit(int x, int y, int z, StationFace face, string finishId, StationSurfaceRole role, bool slope,
            Vector3 point, Vector3 normal, float distance, StationCellGroupView group) {
            X = x; Y = y; Z = z; Face = face; FinishId = finishId; Role = role; Slope = slope;
            Point = point; Normal = normal; Distance = distance; Group = group;
        }

        public StationCellKey CellKey => new StationCellKey(X, Y, Z);
        /// <summary>The document-axis cell and face, for `StationFinishEdits`.</summary>
        public StationPaintPick Pick => new StationPaintPick(X, Y, Z, Face, FinishId);
        public override string ToString() => Pick + " (" + Role + (Slope ? " slope" : "") + ")";
    }

    /// <summary>
    /// The built cell surfaces. One instance per committed station; dispose it with the
    /// station root. Meshes are the view's own; materials belong to the finish library.
    /// </summary>
    public sealed class StationCellView : IDisposable {
        readonly List<StationCellGroupView> groups = new List<StationCellGroupView>();
        readonly Dictionary<StationCellMeshWorkspace.ChunkBandKey, List<StationCellGroupView>> groupsByChunk =
            new Dictionary<StationCellMeshWorkspace.ChunkBandKey, List<StationCellGroupView>>();
        readonly Dictionary<StationSurfaceRole, Transform> roleRoots = new Dictionary<StationSurfaceRole, Transform>();
        readonly Dictionary<int, Transform> storeyRoots = new Dictionary<int, Transform>();
        readonly List<StationCellFaceRecord> faces;
        StationCellMeshResult mesh;
        StationCellViewRequest buildRequest;
        Transform root;
        Func<Vector3, Vector3> toWorld;
        int totalTriangles;
        bool facesDirty;
        bool disposed;

        StationCellView() { faces = new List<StationCellFaceRecord>(); }

        public Transform Root => root;
        public IReadOnlyList<StationCellGroupView> Groups => groups;
        /// <summary>Every painted surface the mesh presents (`cellKey` + face + finish).</summary>
        public IReadOnlyList<StationCellFaceRecord> Faces {
            get {
                if (facesDirty) RebuildFacesList();
                return faces;
            }
        }
        public StationCellMeshResult MeshData => mesh;
        public int Triangles => totalTriangles;
        public int MeshGroups => groups.Count;
        public int ChunkCount => groupsByChunk.Count;
        /// <summary>Finish ids the mesher drew, with their triangle counts.</summary>
        public IReadOnlyDictionary<string, int> TrianglesByFinish => BuildTrianglesByFinish();
        /// <summary>Cells whose finish id the library could not resolve, by name.</summary>
        public IReadOnlyCollection<string> UnknownFinishes => unknownFinishes;

        readonly HashSet<string> unknownFinishes = new HashSet<string>(StringComparer.Ordinal);

        public sealed class StagedCellChunkSwap : IDisposable {
            readonly StationCellView owner;
            readonly StationCellMeshWorkspace.StagedChunkMesh stagedMesh;
            readonly Dictionary<StationCellMeshWorkspace.ChunkBandKey, List<StationCellGroupView>> stagedGroups;
            bool committed;
            bool disposed;

            internal StagedCellChunkSwap(
                StationCellView owner,
                StationCellMeshWorkspace.StagedChunkMesh stagedMesh,
                Dictionary<StationCellMeshWorkspace.ChunkBandKey, List<StationCellGroupView>> stagedGroups) {
                this.owner = owner;
                this.stagedMesh = stagedMesh;
                this.stagedGroups = stagedGroups;
            }

            public void Commit(
                out List<GameObject> retiredViews,
                out List<Mesh> retiredMeshes,
                out List<StationCellGroupView> addedGroups) {
                if (disposed) throw new ObjectDisposedException(nameof(StagedCellChunkSwap));
                committed = true;
                stagedMesh.Commit();
                owner.CommitChunkSwap(stagedMesh.DirtyKeys, stagedGroups, out retiredViews, out retiredMeshes, out addedGroups);
            }

            public void Dispose() {
                if (disposed) return;
                disposed = true;
                if (committed) return;
                stagedMesh?.Rollback();
                if (stagedGroups != null) {
                    foreach (var list in stagedGroups.Values) {
                        for (int i = 0; i < list.Count; i++) {
                            var entry = list[i];
                            if (entry.Mesh != null) Destroy(entry.Mesh);
                            if (entry.GameObject != null) Destroy(entry.GameObject);
                        }
                    }
                }
            }
        }

        /// <summary>
        /// Build the cell view under `parent`. The parent is the station's placement
        /// transform: the view never adds a station offset of its own.
        /// </summary>
        public static StationCellView Build(StationCellViewRequest request, Transform parent) {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var view = new StationCellView();
            view.BuildInternal(request, parent);
            return view;
        }

        static StationCellMeshWorkspace.ChunkBandKey ChunkKeyOf(StationCellMeshGroup group) =>
            new StationCellMeshWorkspace.ChunkBandKey(
                group.ChunkX,
                group.ChunkY,
                group.Storey,
                group.Role == StationSurfaceRole.Ground);

        void BuildInternal(StationCellViewRequest request, Transform parent) {
            buildRequest = request;
            toWorld = request.ToWorld ?? StationCoordinates.Point;
            var rootObject = new GameObject(string.IsNullOrEmpty(request.Name) ? "Station cells" : request.Name);
            root = rootObject.transform;
            root.SetParent(parent, false);
            root.localPosition = Vector3.zero;
            root.localRotation = Quaternion.identity;
            root.localScale = Vector3.one;

            mesh = StationCellMesher.Mesh(request.Mesh);
            faces.AddRange(mesh.Faces);
            totalTriangles = mesh.Triangles;

            foreach (var group in mesh.Groups) {
                var entry = CreateGroupView(request, group, RoleRoot(group.Role));
                groups.Add(entry);
                var ck = ChunkKeyOf(group);
                if (!groupsByChunk.TryGetValue(ck, out var bucket)) groupsByChunk[ck] = bucket = new List<StationCellGroupView>(4);
                bucket.Add(entry);
            }
        }

        StationCellGroupView CreateGroupView(StationCellViewRequest request, StationCellMeshGroup group, Transform parentTransform) {
            var material = Resolve(request, group.FinishId);
            var child = new GameObject(group.GroupKey);
            var transform = child.transform;
            transform.SetParent(parentTransform, false);
            transform.localPosition = Vector3.zero;
            transform.localRotation = Quaternion.identity;
            transform.localScale = Vector3.one;
            var filter = child.AddComponent<MeshFilter>();
            var renderer = child.AddComponent<MeshRenderer>();
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = true;
            renderer.sharedMaterial = material;
            var builtMesh = BuildMesh(group, out var worldVertices, out var worldIndices);
            filter.sharedMesh = builtMesh;
            if (request.Finishes != null && !request.Finishes.IsKnown(group.FinishId)) unknownFinishes.Add(group.FinishId);
            return new StationCellGroupView {
                Data = group, GameObject = child, Filter = filter, Renderer = renderer,
                Mesh = builtMesh, Material = material,
                WorldVertices = worldVertices, WorldIndices = worldIndices,
                Wall = group.Role == StationSurfaceRole.Wall ||
                    (request.Finishes != null && !string.IsNullOrEmpty(group.FinishId) && request.Finishes.IsWall(group.FinishId)),
            };
        }

        public StagedCellChunkSwap StageChunkSwap(StationCellMeshWorkspace.StagedChunkMesh stagedMesh, Transform stagingParent) {
            if (disposed) throw new ObjectDisposedException(nameof(StationCellView));
            if (stagedMesh == null) throw new ArgumentNullException(nameof(stagedMesh));
            var staged = new Dictionary<StationCellMeshWorkspace.ChunkBandKey, List<StationCellGroupView>>(stagedMesh.GroupsByChunk.Count);
            try {
                foreach (var kv in stagedMesh.GroupsByChunk) {
                    var list = new List<StationCellGroupView>(kv.Value.Count);
                    for (int i = 0; i < kv.Value.Count; i++) {
                        list.Add(CreateGroupView(buildRequest, kv.Value[i], stagingParent));
                    }
                    staged[kv.Key] = list;
                }
                return new StagedCellChunkSwap(this, stagedMesh, staged);
            } catch {
                foreach (var list in staged.Values) {
                    for (int i = 0; i < list.Count; i++) {
                        if (list[i].Mesh != null) Destroy(list[i].Mesh);
                        if (list[i].GameObject != null) Destroy(list[i].GameObject);
                    }
                }
                stagedMesh.Rollback();
                throw;
            }
        }

        void CommitChunkSwap(
            IReadOnlyList<StationCellMeshWorkspace.ChunkBandKey> dirtyKeys,
            Dictionary<StationCellMeshWorkspace.ChunkBandKey, List<StationCellGroupView>> stagedGroups,
            out List<GameObject> retiredViews,
            out List<Mesh> retiredMeshes,
            out List<StationCellGroupView> addedGroups) {
            retiredViews = new List<GameObject>();
            retiredMeshes = new List<Mesh>();
            addedGroups = new List<StationCellGroupView>();
            var retiredSet = new HashSet<StationCellGroupView>();

            for (int k = 0; k < dirtyKeys.Count; k++) {
                var ck = dirtyKeys[k];
                if (groupsByChunk.TryGetValue(ck, out var oldBucket)) {
                    for (int i = 0; i < oldBucket.Count; i++) {
                        var oldEntry = oldBucket[i];
                        retiredSet.Add(oldEntry);
                        totalTriangles -= oldEntry.Triangles;
                        if (oldEntry.GameObject != null) retiredViews.Add(oldEntry.GameObject);
                        if (oldEntry.Mesh != null) retiredMeshes.Add(oldEntry.Mesh);
                    }
                    groupsByChunk.Remove(ck);
                }
            }

            if (retiredSet.Count > 0) {
                groups.RemoveAll(g => retiredSet.Contains(g));
            }

            for (int k = 0; k < dirtyKeys.Count; k++) {
                var ck = dirtyKeys[k];
                if (!stagedGroups.TryGetValue(ck, out var newBucket) || newBucket.Count == 0) continue;
                groupsByChunk[ck] = newBucket;
                for (int i = 0; i < newBucket.Count; i++) {
                    var entry = newBucket[i];
                    var parentRoleRoot = RoleRoot(entry.Role);
                    entry.GameObject.transform.SetParent(parentRoleRoot, false);
                    entry.GameObject.transform.localPosition = Vector3.zero;
                    entry.GameObject.transform.localRotation = Quaternion.identity;
                    entry.GameObject.transform.localScale = Vector3.one;
                    groups.Add(entry);
                    addedGroups.Add(entry);
                    totalTriangles += entry.Triangles;
                }
            }

            if (totalTriangles < 0) totalTriangles = 0;
            facesDirty = true;
            if (mesh != null) {
                mesh.Triangles = totalTriangles;
                mesh.Groups.Clear();
                for (int i = 0; i < groups.Count; i++) mesh.Groups.Add(groups[i].Data);
            }
        }

        Dictionary<string, int> BuildTrianglesByFinish() {
            var dict = new Dictionary<string, int>(StringComparer.Ordinal);
            for (int i = 0; i < groups.Count; i++) {
                var g = groups[i];
                dict.TryGetValue(g.FinishId, out int count);
                dict[g.FinishId] = count + g.Triangles;
            }
            return dict;
        }

        void RebuildFacesList() {
            facesDirty = false;
            faces.Clear();
            var dedup = new Dictionary<(int X, int Y, int Z, StationFace Face, string FinishId, StationSurfaceRole Role, bool Slope), int>();
            for (int g = 0; g < groups.Count; g++) {
                var data = groups[g].Data;
                if (data?.LocalFaces == null || data.LocalTriangleFaces == null) continue;
                var remapped = new int[data.LocalTriangleFaces.Length];
                for (int t = 0; t < data.LocalTriangleFaces.Length; t++) {
                    int li = data.LocalTriangleFaces[t];
                    if (li < 0 || li >= data.LocalFaces.Length) { remapped[t] = -1; continue; }
                    var rec = data.LocalFaces[li];
                    var key = (rec.X, rec.Y, rec.Z, rec.Face, rec.FinishId ?? "", rec.Role, rec.Slope);
                    if (!dedup.TryGetValue(key, out int gi)) {
                        gi = faces.Count;
                        faces.Add(rec);
                        dedup[key] = gi;
                    }
                    remapped[t] = gi;
                }
                data.TriangleFaces = remapped;
            }
            if (mesh != null) {
                mesh.Faces.Clear();
                mesh.Faces.AddRange(faces);
            }
        }

        Material Resolve(StationCellViewRequest request, string finishId) {
            if (request.ResolveFinish != null) return request.ResolveFinish(finishId);
            if (request.Finishes != null) return request.Finishes.For(finishId);
            if (request.FallbackMaterial != null) return request.FallbackMaterial;
            throw new InvalidOperationException("StationCellViewRequest has no finish resolver (Finishes, ResolveFinish or FallbackMaterial)");
        }

        /// <summary>Document axes -> world, then the reflected winding is reversed.</summary>
        Mesh BuildMesh(StationCellMeshGroup group, out Vector3[] vertices, out int[] indices) {
            var vertexCount = group.Positions.Length;
            vertices = new Vector3[vertexCount];
            var normals = new Vector3[vertexCount];
            for (var i = 0; i < vertexCount; i++) {
                vertices[i] = toWorld(group.Positions[i]);
                normals[i] = toWorld(group.Normals[i]);
            }
            indices = new int[group.Indices.Length];
            // The document->world swap is a reflection: keep every triangle facing out
            // by reversing its winding, exactly once, here.
            for (var t = 0; t < indices.Length; t += 3) {
                indices[t] = group.Indices[t];
                indices[t + 1] = group.Indices[t + 2];
                indices[t + 2] = group.Indices[t + 1];
            }
            var mesh = new Mesh { name = group.GroupKey };
            if (vertexCount > 65000) mesh.indexFormat = IndexFormat.UInt32;
            mesh.SetVertices(vertices);
            mesh.SetNormals(normals);
            mesh.SetColors(group.Colors);
            mesh.SetUVs(0, group.Uvs);
            mesh.SetTriangles(indices, 0, calculateBounds: true);
            return mesh;
        }

        Transform RoleRoot(StationSurfaceRole role) {
            if (roleRoots.TryGetValue(role, out var existing)) return existing;
            var created = new GameObject(role.ToString());
            created.transform.SetParent(root, false);
            created.transform.localPosition = Vector3.zero;
            roleRoots[role] = created.transform;
            return created.transform;
        }

        Transform StoreyRoot(int storey) {
            if (storeyRoots.TryGetValue(storey, out var existing)) return existing;
            var created = new GameObject("Storey " + storey);
            created.transform.SetParent(root, false);
            created.transform.localPosition = Vector3.zero;
            storeyRoots[storey] = created.transform;
            return created.transform;
        }

        /* ------------------------------------------------------------- visibility */

        public void SetRoleVisible(StationSurfaceRole role, bool visible) {
            foreach (var group in groups) if (group.Role == role) group.GameObject.SetActive(visible);
        }

        public void SetStoreyVisible(int storey, bool visible) {
            foreach (var group in groups) if (group.Storey == storey) group.GameObject.SetActive(visible);
        }

        public void SetChunkVisible(int chunkX, int chunkY, bool visible) {
            foreach (var group in groups) if (group.ChunkX == chunkX && group.ChunkY == chunkY) group.GameObject.SetActive(visible);
        }

        /// <summary>Show only the given storeys (the slice's "other levels" rule).</summary>
        public void SetVisibleStoreys(ICollection<int> storeys) {
            foreach (var group in groups) group.GameObject.SetActive(storeys == null || storeys.Contains(group.Storey));
        }

        /// <summary>Wall groups only, for .</summary>
        public void SetWallsVisible(bool visible) {
            foreach (var group in groups) if (group.Wall) group.GameObject.SetActive(visible);
        }

        public void SetAllVisible(bool visible) {
            foreach (var group in groups) group.GameObject.SetActive(visible);
        }

        /* ----------------------------------------------------------------- picking */

        /// <summary>
        /// The nearest drawn surface under a world-space ray, with the pick record the
        /// paint brush and a block tool both read. The hit is resolved **once**: hover
        /// and commit pass the same record, so the previewed face is the painted face.
        /// </summary>
        public bool TryPick(Ray worldRay, out StationCellPickHit hit) =>
            TryPick(worldRay, StationCellPickFilter.Default, out hit);

        /// <summary>
        /// Camera- and slice-aware cell pick: skips hidden/disabled renderers, excluded
        /// camera layers, triangles outside the clip interval, culled backfaces/frontfaces,
        /// and intersection points discarded by the active section cut.
        /// </summary>
        public bool TryPick(Ray worldRay, StationCellPickFilter filter, out StationCellPickHit hit) {
            hit = default;
            if (worldRay.direction.sqrMagnitude <= 1e-12f) return false;
            var ray = new Ray(worldRay.origin, worldRay.direction);
            var best = float.PositiveInfinity;
            var minDistance = filter.MinDistance;
            var maxDistance = filter.MaxDistance;
            var cullingMask = filter.CullingMask;
            var visibility = filter.Visibility;
            var found = false;
            foreach (var group in groups) {
                if (group.GameObject == null || !group.GameObject.activeInHierarchy) continue;
                if (group.Renderer == null || !group.Renderer.enabled) continue;
                if (group.Filter == null || group.Filter.sharedMesh == null) continue;
                if ((cullingMask & (1 << group.GameObject.layer)) == 0) continue;
                var data = group.Data;
                var groupTransform = group.Transform;
                bool identity = groupTransform == null || (
                    groupTransform.position == Vector3.zero &&
                    groupTransform.rotation == Quaternion.identity &&
                    groupTransform.lossyScale == Vector3.one);
                if (identity && !RayHitsBounds(ray, data.Bounds, Mathf.Min(best, maxDistance))) continue;
                var cull = MaterialCullMode(group.Renderer.sharedMaterial);
                var indices = group.WorldIndices;
                var vertices = group.WorldVertices;
                if (indices == null || vertices == null) continue;
                var toWorldMatrix = identity ? Matrix4x4.identity : groupTransform.localToWorldMatrix;
                for (var t = 0; t < indices.Length; t += 3) {
                    var a = vertices[indices[t]];
                    var b = vertices[indices[t + 1]];
                    var c = vertices[indices[t + 2]];
                    if (!identity) {
                        a = toWorldMatrix.MultiplyPoint3x4(a);
                        b = toWorldMatrix.MultiplyPoint3x4(b);
                        c = toWorldMatrix.MultiplyPoint3x4(c);
                    }
                    if (!RayTriangle(ray, a, b, c, cull, minDistance, maxDistance, best,
                            out var distance, out var normal)) continue;
                    var worldPoint = ray.origin + ray.direction * distance;
                    if (visibility != null) {
                        var docPoint = StationCameraSpace.ToDocument(worldPoint);
                        if (!visibility.IsPointKept(docPoint)) continue;
                    }
                    best = distance;
                    found = true;
                    StationCellFaceRecord record;
                    int triIdx = t / 3;
                    if (data.LocalFaces != null && data.LocalTriangleFaces != null && triIdx < data.LocalTriangleFaces.Length) {
                        int localIdx = data.LocalTriangleFaces[triIdx];
                        record = localIdx >= 0 && localIdx < data.LocalFaces.Length ? data.LocalFaces[localIdx] : default;
                    } else {
                        var faceIndex = data.TriangleFaces != null && triIdx < data.TriangleFaces.Length ? data.TriangleFaces[triIdx] : -1;
                        record = faceIndex >= 0 && faceIndex < faces.Count ? faces[faceIndex] : default;
                    }
                    hit = new StationCellPickHit(record.X, record.Y, record.Z, record.Face, record.FinishId, record.Role,
                        record.Slope, worldPoint, normal, distance, group);
                }
            }
            return found;
        }

        /// <summary>Pick in the plane the caller already resolved (document-space ray hit).</summary>
        public bool TryPickCell(Ray worldRay, out StationCellKey cell, out StationFace face) {
            if (TryPick(worldRay, out var hit)) {
                cell = hit.CellKey;
                face = hit.Face;
                return true;
            }
            cell = default;
            face = StationFace.Top;
            return false;
        }

        /// <summary>Resolve the effective face-cull mode of a material (`_Cull`, `_CullMode`, default Back).</summary>
        public static CullMode MaterialCullMode(Material material) {
            if (material != null) {
                if (material.HasProperty("_Cull")) return (CullMode)Mathf.RoundToInt(material.GetFloat("_Cull"));
                if (material.HasProperty("_CullMode")) return (CullMode)Mathf.RoundToInt(material.GetFloat("_CullMode"));
            }
            return CullMode.Back;
        }

        static bool RayHitsBounds(Ray ray, Bounds bounds, float limit) {
            // A ray that misses the document-axis bounds cannot hit the group; the
            // swap is monotone, so testing the document bounds in their own axes with
            // a swapped ray is exact.
            var origin = new Vector3(ray.origin.x, ray.origin.z, ray.origin.y);
            var direction = new Vector3(ray.direction.x, ray.direction.z, ray.direction.y);
            var documentRay = new Ray(origin, direction);
            return new Bounds(bounds.center, bounds.size).IntersectRay(documentRay, out var enter) && enter <= limit;
        }

        static bool RayTriangle(Ray ray, Vector3 a, Vector3 b, Vector3 c, CullMode cull,
            float minDistance, float maxDistance, float bestDistance, out float distance, out Vector3 normal) {
            const float epsilon = 1e-7f;
            distance = 0f;
            normal = Vector3.zero;
            var edge1 = b - a;
            var edge2 = c - a;
            var h = Vector3.Cross(ray.direction, edge2);
            var determinant = Vector3.Dot(edge1, h);
            switch (cull) {
                case CullMode.Back:
                    if (determinant <= epsilon) return false;
                    break;
                case CullMode.Front:
                    if (determinant >= -epsilon) return false;
                    break;
                default:
                    if (determinant > -epsilon && determinant < epsilon) return false;
                    break;
            }
            var inverse = 1f / determinant;
            var s = ray.origin - a;
            var u = inverse * Vector3.Dot(s, h);
            if (u < 0f || u > 1f) return false;
            var q = Vector3.Cross(s, edge1);
            var v = inverse * Vector3.Dot(ray.direction, q);
            if (v < 0f || u + v > 1f) return false;
            var t = inverse * Vector3.Dot(edge2, q);
            if (t <= epsilon || t < minDistance || t > maxDistance || t >= bestDistance) return false;
            distance = t;
            normal = Vector3.Cross(edge1, edge2);
            if (determinant < 0f) normal = -normal;
            if (normal.sqrMagnitude > 0f) normal.Normalize();
            return true;
        }

        /* ------------------------------------------------------------------ release */

        /// <summary>`Destroy` in play mode, `DestroyImmediate` in the editor (a staged world).</summary>
        static void Destroy(UnityEngine.Object value) {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }

        public void Dispose() => DisposeCore(destroyObjects: true);

        /// <summary>
        /// Release the meshes only. A world destroyed under the view has already taken
        /// its GameObjects with it, so the owner component must not destroy them again.
        /// </summary>
        public void ReleaseMeshes() => DisposeCore(destroyObjects: false);

        void DisposeCore(bool destroyObjects) {
            if (disposed) return;
            disposed = true;
            foreach (var group in groups) {
                if (group.Mesh != null) Destroy(group.Mesh);
                if (destroyObjects && group.GameObject != null) Destroy(group.GameObject);
            }
            groups.Clear();
            groupsByChunk.Clear();
            if (destroyObjects && root != null) Destroy(root.gameObject);
            root = null;
            faces.Clear();
            roleRoots.Clear();
            storeyRoots.Clear();
            mesh = null;
            buildRequest = null;
        }
    }

    public sealed class StationCellRenderer : IStationViewRenderer, IStationLocalViewRenderer {
        public const string RoleName = "cells";

        /// <summary>Override how the finish library is acquired (tests stage a fixture).</summary>
        public static Func<Shader, StationFinishLibrary> FinishLibraryFactory;

        public sealed class CellState {
            public StationWorldView World;
            public StationCellView View;
            public StationPaintSnapshot Snapshot;
            public StationFinishLibrary Finishes;
            public StationCellMeshWorkspace Workspace;
            public int Groups;
            public int Triangles;
        }

        public sealed class StagedCellRendererDelta : IStationLocalRendererStage {
            readonly CellState state;
            readonly StationDocument nextDoc;
            readonly StationIndexDelta delta;
            readonly StationCellMeshWorkspace.StagedChunkMesh stagedMesh;
            readonly StationCellView.StagedCellChunkSwap stagedSwap;
            bool committed;

            internal StagedCellRendererDelta(
                CellState state,
                StationDocument nextDoc,
                StationIndexDelta delta,
                StationCellMeshWorkspace.StagedChunkMesh stagedMesh,
                StationCellView.StagedCellChunkSwap stagedSwap) {
                this.state = state;
                this.nextDoc = nextDoc;
                this.delta = delta;
                this.stagedMesh = stagedMesh;
                this.stagedSwap = stagedSwap;
            }

            public void Commit(
                out List<GameObject> retiredViews,
                out List<Mesh> retiredMeshes,
                out List<StationViewRecord> addedRecords) {
                committed = true;
                stagedSwap.Commit(out retiredViews, out retiredMeshes, out var addedGroups);
                state.Groups = state.View.Groups.Count;
                state.Triangles = state.View.Triangles;
                state.Snapshot?.ApplyLocalDelta(
                    nextDoc,
                    delta,
                    stagedMesh.GroundHolesSnapshot,
                    stagedMesh.HasGroundWindow,
                    stagedMesh.GroundX0,
                    stagedMesh.GroundX1,
                    stagedMesh.GroundY0,
                    stagedMesh.GroundY1,
                    -1);
                addedRecords = new List<StationViewRecord>(addedGroups.Count);
                for (int i = 0; i < addedGroups.Count; i++) {
                    var group = addedGroups[i];
                    var data = group.Data;
                    if (data == null || data.TriangleCount == 0) continue;
                    StationCellKey anchor;
                    if (data.HasAnchor) {
                        anchor = data.Anchor;
                    } else if (data.LocalFaces != null && data.LocalTriangleFaces != null &&
                               data.LocalTriangleFaces.Length > 0 && data.LocalTriangleFaces[0] >= 0 &&
                               data.LocalTriangleFaces[0] < data.LocalFaces.Length) {
                        anchor = data.LocalFaces[data.LocalTriangleFaces[0]].CellKey;
                    } else {
                        continue;
                    }
                    addedRecords.Add(new StationViewRecord {
                        Role = RoleName,
                        CellKey = anchor.ToString(),
                        View = group.GameObject,
                        LevelBands = new[] { group.Storey },
                    });
                }
            }

            void IStationLocalRendererStage.Commit(StationWorldView world, StationLocalViewCommit commit) {
                Commit(out var retiredViews, out var retiredMeshes, out var addedRecords);
                if (retiredViews.Count > 0) {
                    var retiredSet = new HashSet<GameObject>(retiredViews);
                    world.RetireRecordsWhere(rec => rec.Role == RoleName && retiredSet.Contains(rec.View), commit);
                    commit.RetiredViews.AddRange(retiredViews);
                }
                if (retiredMeshes.Count > 0) {
                    commit.RetiredMeshes.AddRange(retiredMeshes);
                }
                for (int i = 0; i < addedRecords.Count; i++) {
                    world.AddLocalRecord(addedRecords[i], commit);
                }
            }

            public void Dispose() {
                if (!committed) stagedSwap?.Dispose();
            }
        }

        public bool TryStageLocalDelta(
            StationLocalDeltaContext context,
            out IStationLocalRendererStage stage,
            out string fallbackReason) {
            stage = null;
            fallbackReason = null;
            var state = FindState(context.World);
            if (state == null || state.Workspace == null || state.View == null) {
                fallbackReason = "no-cell-workspace";
                return false;
            }
            if (!context.CellsChanged && context.TouchedModuleIds.Count == 0) {
                StationEditTrace.AddRebuiltChunks(0, state.View.ChunkCount);
                return true;
            }
            stage = StageLocalDelta(context.World, context.NextDocument, context.NextIndex, context.Delta, context.StagingRoot);
            if (stage == null) {
                fallbackReason = "cell-stage-null";
                return false;
            }
            return true;
        }

        static readonly List<CellState> states = new List<CellState>();

        /// <summary>The newest live world's cell state (what the paint handler reads).</summary>
        public static CellState Current {
            get {
                for (var i = states.Count - 1; i >= 0; i--) {
                    var state = states[i];
                    if (state.World != null && !state.World.IsDisposed && state.View != null) return state;
                }
                return null;
            }
        }

        public string Role => RoleName;
        public StationCellView View => Current?.View;
        /// <summary>The committed station as the paint engine reads it (null before a build).</summary>
        public StationPaintSnapshot Snapshot => Current?.Snapshot;
        public StationCellMeshResult Mesh => Current?.View?.MeshData;
        /// <summary>Finish ids the current build could not resolve, for the verifier report.</summary>
        public IReadOnlyCollection<string> UnknownFinishes => Current?.View?.UnknownFinishes ?? Array.Empty<string>();
        /// <summary>The finish library the current build used (null when missing).</summary>
        public StationFinishLibrary Library => Current?.Finishes;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() {
            StationRenderers.Add(new StationCellRenderer());
            StationCommandHandlers.Add(new StationFinishPaintHandler());
        }

        internal static CellState FindState(StationWorldView world) {
            if (world != null && !world.IsDisposed) {
                for (var i = states.Count - 1; i >= 0; i--) {
                    var state = states[i];
                    if (state.World == world && state.View != null) return state;
                }
            }
            return null;
        }

        /// <summary>Look up the built cell view belonging to <paramref name="world"/>.</summary>
        public static bool TryGetView(StationWorldView world, out StationCellView view) {
            var state = FindState(world);
            if (state != null) {
                view = state.View;
                return true;
            }
            view = null;
            return false;
        }

        public static StagedCellRendererDelta StageLocalDelta(
            StationWorldView world,
            StationDocument nextDoc,
            StationIndex nextIndex,
            StationIndexDelta delta,
            Transform stagingParent) {
            var state = FindState(world);
            if (state == null || state.Workspace == null || state.View == null) return null;
            int totalChunksBefore = state.View.ChunkCount;
            var stagedMesh = state.Workspace.StageDocumentDelta(nextDoc, nextIndex, delta, world.Index);
            StationEditTrace.AddRebuiltChunks(
                stagedMesh.RebuiltChunkCount,
                Math.Max(0, totalChunksBefore - stagedMesh.RebuiltChunkCount));
            var stagedSwap = state.View.StageChunkSwap(stagedMesh, stagingParent);
            return new StagedCellRendererDelta(state, nextDoc, delta, stagedMesh, stagedSwap);
        }

        /// <summary>Pick against the cell view registered for <paramref name="world"/>.</summary>
        public static bool TryPickWorld(StationWorldView world, Ray worldRay, StationCellPickFilter filter,
            out StationCellPickHit hit) {
            if (TryGetView(world, out var view)) return view.TryPick(worldRay, filter, out hit);
            hit = default;
            return false;
        }

        /// <summary>The active world's pick, for a handler that has no view reference.</summary>
        public static bool TryPickActive(Ray worldRay, out StationCellPickHit hit) {
            var view = Current?.View;
            if (view != null) {
                return view.TryPick(worldRay,
                    StationCellPickFilter.FromCamera(null, StationViewFeature.Active?.Visibility), out hit);
            }
            hit = default;
            return false;
        }

        public void Build(StationViewBuildContext context) {
            if (context == null) throw new ArgumentNullException(nameof(context));
            // Never clear another live world's state: only drop worlds already disposed.
            PurgeDisposed();
            var finishes = AcquireLibrary(context.Shader);
            if (finishes == null) {
                context.ReportUnresolved("finish-library-missing", "finish", "",
                    "The exported finish library is not staged: run `node tools/unity-assets/export-station-finishes.mjs --stage unity/Assets/Resources/StationFinishes` (or keep unity/asset-recipes/finishes next to Assets) and rebuild. No cell surface is drawn.");
            }
            var notes = new List<string>();
            var input = BuildInputCore(context.Document, context.Index, finishes, notes, null, out var unthinnedShapes, out var preparedRamps);
            var request = new StationCellViewRequest {
                Mesh = input,
                Finishes = finishes,
                Name = "Station cells",
                ToWorld = StationCoordinates.Point,
                BuildPickMap = true,
            };
            var view = StationCellView.Build(request, context.RoleRoot(RoleName));
            var state = new CellState {
                World = context.World,
                View = view,
                Snapshot = StationPaintSnapshot.FromDocument(context.Document, input.GroundHoles, -1),
                Finishes = finishes,
                Workspace = StationCellMeshWorkspace.Create(input, preparedRamps, unthinnedShapes),
                Groups = view.Groups.Count,
                Triangles = view.Triangles,
            };
            states.Add(state);
            // The role root is destroyed with its world; a cell view also owns meshes,
            // so it disposes itself there rather than relying on a shared field.
            var owner = context.RoleRoot(RoleName).gameObject.AddComponent<StationCellViewOwner>();
            owner.State = state;
            foreach (var note in notes) {
                var split = note.Split(new[] { ':' }, 2);
                context.ReportUnresolved(split[0], "cell", "", split.Length > 1 ? split[1].Trim() : note);
            }
            if (finishes != null) {
                foreach (var id in finishes.UnknownFinishIds) {
                    context.ReportUnresolved("finish-unknown", "finish", id,
                        "Finish '" + id + "' is not in the exported library; drawn with '" + finishes.FallbackId + "' and kept in the document.");
                }
            }
            var registered = 0;
            foreach (var group in view.Groups) {
                var triangleFaces = group.Data?.TriangleFaces;
                if (triangleFaces == null || triangleFaces.Length == 0) continue;
                var faceIndex = triangleFaces[0];
                if (faceIndex < 0 || faceIndex >= view.Faces.Count) continue;
                var record = view.Faces[faceIndex];
                var anchor = group.Data.HasAnchor ? group.Data.Anchor : record.CellKey;
                context.World.RegisterCell(RoleName, anchor, group.GameObject, new[] { group.Storey });
                registered++;
            }
            if (view.Triangles == 0 && finishes != null) {
                context.ReportUnresolved("cells-empty", "cell", "", "The station drew no cell surfaces (no solid cells or an empty ground window).");
            }
            _ = registered;
        }

        /// <summary>Drop only the state whose world has already been disposed.</summary>
        public void Release() => PurgeDisposed();

        static void PurgeDisposed() {
            for (var i = states.Count - 1; i >= 0; i--) {
                var state = states[i];
                if (state.World != null && !state.World.IsDisposed) continue;
                states.RemoveAt(i);
                state.View?.ReleaseMeshes();
                state.Finishes?.Dispose();
                state.View = null;
                state.Finishes = null;
                state.Workspace = null;
            }
        }

        /// <summary>Test seam: forget every built world (disposing nothing).</summary>
        public static void ClearStates() => states.Clear();

        internal static void RemoveState(CellState state) {
            if (state == null) return;
            states.Remove(state);
            state.View?.ReleaseMeshes();
            state.Finishes?.Dispose();
            state.View = null;
            state.Finishes = null;
            state.Workspace = null;
        }

        public static StationCellMeshInput BuildInput(StationViewBuildContext context, StationFinishLibrary library, List<string> notes) =>
            BuildInputCore(context.Document, context.Index, library, notes, null, out _, out _);

        public static StationCellMeshInput BuildInput(
            StationDocument document,
            StationFinishLibrary library,
            List<string> notes,
            StationCellViewerPolicy viewerPolicy) =>
            BuildInputCore(document, null, library, notes, viewerPolicy, out _, out _);

        static StationCellMeshInput BuildInputCore(
            StationDocument document,
            StationIndex stationIndex,
            StationFinishLibrary library,
            List<string> notes,
            StationCellViewerPolicy viewerPolicy,
            out Dictionary<StationCellKey, StationCellShape> unthinnedShapes,
            out StationRampOpenings.PreparedRampOpenings preparedRamps) {
            if (document == null) throw new ArgumentNullException(nameof(document));
            bool isViewer = viewerPolicy != null;
            var retained = viewerPolicy?.RetainedCells;
            var input = new StationCellMeshInput {
                LevelBase = document.LevelBase,
                StoreyHeight = document.StoreyHeight,
                VirtualGround = !isViewer,
                GroundZ = StationPaintSnapshot.GroundZ,
                GroundMargin = 16,
                DefaultFinish = library != null ? library.DefaultFinishFor(StationFace.Top) : StationFinishIds.DefaultMaterial,
                RampSoffitFinish = library != null ? library.RampSoffitId : "ceil.steel",
                BuildCeilings = true,
                BuildPlates = false,
                BuildGround = !isViewer,
                OmitSuspendedCeilings = isViewer && viewerPolicy.OmitSuspendedCeilings,
                IsolateBandOcclusion = isViewer && viewerPolicy.IsolateBandOcclusion,
            };
            var cellIndices = new Dictionary<StationCellKey, int>(document.Cells.Count);
            var solidKeys = new HashSet<StationCellKey>();
            unthinnedShapes = isViewer ? null : new Dictionary<StationCellKey, StationCellShape>(document.Cells.Count);
            foreach (var cell in document.Cells) {
                if (!cell.IsSolid) { input.Voids.Add(cell.Key); continue; }
                if (retained != null && !retained.Contains(cell.Key)) continue;
                var tags = cell.Tags;
                var flags = StationMeshCellFlags.None;
                if (StationCellRules.IsWallBlock(tags)) flags |= StationMeshCellFlags.Wall;
                if (cell.HasTag("suspended-ceiling")) flags |= StationMeshCellFlags.SuspendedCeiling;
                if (cell.HasTag("opening-ceiling")) flags |= StationMeshCellFlags.OpeningCeiling;
                if (cell.HasTag("painted-ground")) flags |= StationMeshCellFlags.PaintedGround;
                var rawShape = StationCellRules.ShapeOf(tags);
                cellIndices[cell.Key] = input.Cells.Count;
                solidKeys.Add(cell.Key);
                if (unthinnedShapes != null) unthinnedShapes[cell.Key] = rawShape;
                input.Cells.Add(new StationMeshCell {
                    X = cell.X, Y = cell.Y, Z = cell.Z, Solid = true,
                    Shape = rawShape,
                    Flags = flags,
                    Finish = StationFinishSet.FromRecord(cell),
                });
            }
            var holes = 0;
            var ramps = 0;
            var rampGroundHoles = 0;
            var wellway = 0;
            var exits = new List<StationExitOpenings>();
            foreach (var module in document.Modules) {
                if (module?.Facts == null || module.Facts.Type != "exit") continue;
                if (module.Config.Text("style") == "doorway" || module.Config.Text("style") == "virtual") continue;
                exits.Add(StationExitOpenings.For(document.Modules, module));
            }
            foreach (var module in document.Modules) {
                if (module == null) continue;
                switch (module.Type) {
                    case "track":
                        if (module.Z == StationPaintSnapshot.GroundZ && !module.Config.Bool("tunnel") && !module.Config.Bool("bridge"))
                            foreach (var point in StationFootprints.TrackCells(module))
                                if (input.GroundHoles.Add(CellKeyAt(point))) holes++;
                        break;
                    case "exit": {
                        var openings = ExitOpeningsFor(exits, module);
                        if (module.Z == StationPaintSnapshot.GroundZ)
                            foreach (var point in StationFootprints.ExitFootprint(module))
                                if (input.GroundHoles.Add(CellKeyAt(point))) holes++;
                        if (openings != null) wellway += openings.WellwayCells().Count;
                        break;
                    }
                    case "stair":
                    case "escalator":
                    case "walkway":
                        ramps++;
                        break;
                    case "platform-edge":
                        break;
                }
            }
            var moduleFacts = StationRampOpenings.ExtractFacts(document.Modules);
            var slopeCuts = StationRampOpenings.RampSlopeCuts(moduleFacts);
            input.SlopeCuts = slopeCuts;
            input.SlopeFills = StationRampOpenings.RampFillKeys(solidKeys, slopeCuts);
            preparedRamps = stationIndex != null ? StationRampOpenings.PrepareOpenings(stationIndex) : null;
            var thinCells = StationRampOpenings.RampThinCells(input.Cells, moduleFacts);
            for (int i = 0; i < thinCells.Count; i++) {
                var thin = thinCells[i];
                if (!cellIndices.TryGetValue(thin.Key, out var idx)) continue;
                var meshCell = input.Cells[idx];
                meshCell.Shape = StationCellShape.Half(thin.Side);
                input.Cells[idx] = meshCell;
            }
            var derivedRampHoles = preparedRamps != null
                ? preparedRamps.AtLevel(StationPaintSnapshot.GroundZ)
                : StationRampOpenings.RampOpeningsAtLevel(moduleFacts, StationPaintSnapshot.GroundZ);
            foreach (var hole in derivedRampHoles) {
                if (input.GroundHoles.Add(hole)) {
                    holes++;
                    rampGroundHoles++;
                }
            }
            var platformInsets = StationPlatformInsets.For(document.Modules);
            foreach (var pair in platformInsets) input.Insets[pair.Key] = pair.Value;
            if (notes != null) {
                if (platformInsets.Count > 0)
                    notes.Add("platform-inset-applied: " + platformInsets.Count + " platform cell(s) stop at the PSD base");
                if (slopeCuts.Count > 0)
                    notes.Add("ramp-slope-applied: " + slopeCuts.Count + " underside slope cut(s) derived across " + ramps + " run(s)");
                if (thinCells.Count > 0)
                    notes.Add("ramp-thin-applied: " + thinCells.Count + " wall/floor cell(s) thinned beside runs");
                if (rampGroundHoles > 0)
                    notes.Add("ramp-openings-applied: " + rampGroundHoles + " street corridor cell(s) kept open where runs cross grade");
                if (wellway > 0) notes.Add("exit-wellway-open: " + wellway + " run column cell(s) under " + exits.Count + " exit(s)");
                if (holes > 0) notes.Add("ground-openings-applied: " + holes + " street cell(s) kept open from track/exit/ramp facts");
            }
            return input;
        }

        /// <summary>The shared description for a saved exit record, or null for a doorway/virtual one.</summary>
        static StationExitOpenings ExitOpeningsFor(List<StationExitOpenings> exits, StationModuleRecord record) {
            for (int i = 0; i < exits.Count; i++) {
                var openings = exits[i];
                if (openings != null && ReferenceEquals(openings.Exit, record)) return openings;
            }
            return null;
        }

        /// <summary>A module footprint point as a cell key at the street plane.</summary>
        static StationCellKey CellKeyAt(StationPoint point) => new StationCellKey(
            (int)Math.Round(point.X, MidpointRounding.AwayFromZero),
            (int)Math.Round(point.Y, MidpointRounding.AwayFromZero),
            StationPaintSnapshot.GroundZ);

        /// <summary>The staged export if present: Resources first, then the recipe directory.</summary>
        public static StationFinishLibrary AcquireLibrary(Shader shader) {
            if (FinishLibraryFactory != null) return FinishLibraryFactory(shader);
            // The finish library resolves its own shader (the station finish shader with
            // vertex AO); `shader` is only the host's fallback.
            var finishShader = StationFinishLibrary.FindShader() ?? shader;
            if (Resources.Load<TextAsset>("StationFinishes/finishes") != null)
                return StationFinishLibrary.LoadFromResources("StationFinishes", finishShader);
            var directory = Path.GetFullPath(Path.Combine(Application.dataPath, "../asset-recipes/finishes"));
            if (File.Exists(Path.Combine(directory, "finishes.json")))
                return StationFinishLibrary.LoadFromDirectory(directory, finishShader);
            return null;
        }
    }


    /// <summary>
    /// Disposes one world's cell view when that world's role root is destroyed. State is
    /// kept per world (never a shared field) because the host reuses renderer
    /// singletons across staged worlds.
    /// </summary>
    public sealed class StationCellViewOwner : MonoBehaviour {
        public StationCellRenderer.CellState State;

        void OnDestroy() {
            var state = State;
            State = null;
            if (state != null) StationCellRenderer.RemoveState(state);
        }
    }    /// <summary>
    /// Packet E's `material.*` / `face.paint` command handler. It resolves the brush
    /// against the committed station and returns the edit as **data**: C# owns the
    /// revision, so this handler never mutates the document and never bumps revision
    /// (the router acks). The reply carries `writes`; the host applies them through its
    /// document transaction and rebuilds the world, which is where painting becomes
    /// visible and saved. Until that transaction exists the client must treat
    /// `requiresCommit: true` as *not yet applied* - never as a pass.
    ///
    /// Command payloads (published in the handoff and the evidence file):
    ///   face.paint      { cell:[x,y,z], face:"top|bottom|n|e|s|w", finish:"floor.marble",
    ///                     mode:"single|surface|erase", dragTo?:[x,y,z], expectedRevision? }
    ///   material.select { finish:"wall.enamel#ff4242", mode:"single|surface" }
    ///   material.pick   { cell:[x,y,z], face:"..." }            - eyedropper
    ///   material.palette {}                                     - the exported palette
    /// Reply payload:
    ///   { accepted, code, hit:{cell,face,finish}, finish, mode, requiresCommit,
    ///     writes:[{cell:[x,y,z],face,finish|null,materialise?:{fill,zone,tags}}] }
    /// </summary>
    public sealed class StationFinishPaintHandler : IStationCommandHandler {
        public const string CapabilityName = "material";

        static string selectedFinish = StationFinishIds.DefaultMaterial;
        static StationPaintMode paintMode = StationPaintMode.Single;

        public string Capability => CapabilityName;
        public static string SelectedFinish => selectedFinish;
        public static StationPaintMode Mode => paintMode;

        /// <summary>The brush selection (session-scoped UI state, never a document edit).</summary>
        public static void Select(string finish, StationPaintMode mode) {
            if (!string.IsNullOrEmpty(finish)) selectedFinish = finish;
            paintMode = mode;
        }

        public bool Handles(string type) =>
            type == "face.paint" || type == "material.select" || type == "material.pick" || type == "material.palette";

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = null;
            rejectReason = null;
            payload ??= new JObject();
            switch (command.Type) {
                case "material.select": {
                    var finish = payload["finish"] != null && payload["finish"].Type == JTokenType.String ? (string)payload["finish"] : selectedFinish;
                    var mode = ParseMode(payload["mode"] != null ? (string)payload["mode"] : null);
                    Select(finish, mode);
                    FillSelection(payload);
                    return true;
                }
                case "material.palette":
                    FillPalette(payload);
                    return true;
                case "material.pick": {
                    if (!TryCell(payload, out var x, out var y, out var z) || !TryFace(payload, out var face)) {
                        rejectCode = "bad-payload";
                        rejectReason = "material.pick needs cell:[x,y,z] and face.";
                        return false;
                    }
                    var renderer = StationCellRenderer.Current;
                    if (renderer?.Snapshot == null) {
                        rejectCode = "no-session";
                        rejectReason = "No committed station is loaded.";
                        return false;
                    }
                    var pick = new StationPaintPick(x, y, z, face, renderer.Snapshot.FinishOf(new StationCellKey(x, y, z), face));
                    selectedFinish = pick.Finish;
                    payload.RemoveAll();
                    payload["finish"] = pick.Finish;
                    payload["hit"] = HitJson(pick);
                    payload["mode"] = ModeName(paintMode);
                    return true;
                }
                case "face.paint":
                    return Paint(command, payload, out rejectCode, out rejectReason);
                default:
                    return false;
            }
        }

        bool Paint(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = null;
            rejectReason = null;
            var renderer = StationCellRenderer.Current;
            if (renderer?.Snapshot == null) {
                rejectCode = "no-session";
                rejectReason = "No committed station is loaded.";
                return false;
            }
            if (!TryCell(payload, out var x, out var y, out var z)) {
                rejectCode = "bad-payload";
                rejectReason = "face.paint needs cell:[x,y,z].";
                return false;
            }
            if (!TryFace(payload, out var face)) {
                rejectCode = "bad-face";
                rejectReason = "face.paint needs face: top|bottom|n|e|s|w.";
                return false;
            }
            var finish = payload["finish"] != null && payload["finish"].Type == JTokenType.String ? (string)payload["finish"] : selectedFinish;
            var mode = command.Type == "face.paint" && payload["mode"] != null ? ParseMode((string)payload["mode"]) : paintMode;
            if (mode != StationPaintMode.Erase && string.IsNullOrEmpty(finish)) finish = selectedFinish;
            var request = new StationPaintRequest {
                X = x, Y = y, Z = z, Face = face, Finish = finish, Mode = mode,
                ExpectedRevision = command.ExpectedRevision ?? -1,
            };
            if (payload["dragTo"] is JArray drag && drag.Count == 3) {
                request.HasDrag = true;
                request.ToX = (int)drag[0];
                request.ToY = (int)drag[1];
                request.ToZ = (int)drag[2];
            }
            var result = StationFinishEdits.Paint(renderer.Snapshot, request);
            if (!result.Accepted) {
                rejectCode = string.IsNullOrEmpty(result.Code) ? "rejected" : result.Code;
                rejectReason = string.IsNullOrEmpty(result.Message) ? "The paint action was refused." : result.Message;
                return false;
            }
            var reply = JObject.Parse(result.ToPayloadJson());
            reply["requiresCommit"] = result.Writes.Count > 0;
            reply["finish"] = result.Finish;
            reply["mode"] = ModeName(mode);
            payload.RemoveAll();
            foreach (var property in reply.Properties()) payload[property.Name] = property.Value;
            if (result.Writes.Count > 0) Select(result.Finish ?? selectedFinish, mode);
            // Plan 11 E3: apply the writes through the host's atomic edit transaction so a
            // paint commits one revision instead of returning "not yet applied".
            if (!StationPaintCommit.TryCommit(payload, out var commitCode)) {
                rejectCode = commitCode;
                rejectReason = "The paint was validated but could not be committed to the document.";
                return false;
            }
            return true;
        }

        static void FillSelection(JObject payload) {
            payload["finish"] = selectedFinish;
            payload["mode"] = ModeName(paintMode);
        }

        static void FillPalette(JObject payload) {
            var renderer = StationCellRenderer.Current;
            var groups = new JArray();
            var finishes = new JArray();
            if (renderer?.View != null) {
                var library = renderer.Finishes;
                if (library != null) {
                    foreach (var group in library.PaletteGroups) {
                        var ids = new JArray();
                        foreach (var id in group.ids ?? Array.Empty<string>()) ids.Add(id);
                        groups.Add(new JObject { ["fam"] = group.fam, ["label"] = group.label, ["ids"] = ids });
                    }
                    foreach (var id in library.Ids) {
                        if (!library.TryGetFacts(id, out var facts)) continue;
                        finishes.Add(new JObject {
                            ["id"] = id, ["label"] = facts.Label, ["family"] = facts.Family, ["look"] = facts.Look,
                            ["tint"] = StationFinishIds.Hex((int)(facts.Tint.r * 255) << 16 | (int)(facts.Tint.g * 255) << 8 | (int)(facts.Tint.b * 255)),
                            ["roughness"] = facts.Roughness, ["metalness"] = facts.Metalness,
                        });
                    }
                    payload["fallback"] = library.FallbackId;
                }
            }
            payload["groups"] = groups;
            payload["finishes"] = finishes;
            payload["selected"] = selectedFinish;
            payload["mode"] = ModeName(paintMode);
        }

        static JObject HitJson(StationPaintPick pick) => new JObject {
            ["cell"] = new JArray(pick.X, pick.Y, pick.Z),
            ["face"] = StationFaces.Name(pick.Face),
            ["finish"] = pick.Finish,
        };

        static bool TryCell(JObject payload, out int x, out int y, out int z) {
            x = y = z = 0;
            if (payload["cell"] is JArray cell && cell.Count == 3) {
                x = (int)cell[0]; y = (int)cell[1]; z = (int)cell[2];
                return true;
            }
            if (payload["x"] == null || payload["y"] == null || payload["z"] == null) return false;
            x = (int)payload["x"]; y = (int)payload["y"]; z = (int)payload["z"];
            return true;
        }

        static bool TryFace(JObject payload, out StationFace face) {
            var name = payload["face"] != null ? (string)payload["face"] : null;
            return StationFaces.TryParse(name, out face);
        }

        static StationPaintMode ParseMode(string mode) => mode switch {
            "surface" => StationPaintMode.Surface,
            "erase" => StationPaintMode.Erase,
            _ => StationPaintMode.Single,
        };

        static string ModeName(StationPaintMode mode) => mode == StationPaintMode.Surface ? "surface" : mode == StationPaintMode.Erase ? "erase" : "single";
    }
}






