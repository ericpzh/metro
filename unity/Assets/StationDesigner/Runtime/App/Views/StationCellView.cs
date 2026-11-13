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
        readonly Dictionary<StationSurfaceRole, Transform> roleRoots = new Dictionary<StationSurfaceRole, Transform>();
        readonly Dictionary<int, Transform> storeyRoots = new Dictionary<int, Transform>();
        readonly List<StationCellFaceRecord> faces;
        StationCellMeshResult mesh;
        Transform root;
        Func<Vector3, Vector3> toWorld;
        bool disposed;

        StationCellView() { faces = new List<StationCellFaceRecord>(); }

        public Transform Root => root;
        public IReadOnlyList<StationCellGroupView> Groups => groups;
        /// <summary>Every painted surface the mesh presents (`cellKey` + face + finish).</summary>
        public IReadOnlyList<StationCellFaceRecord> Faces => faces;
        public StationCellMeshResult MeshData => mesh;
        public int Triangles => mesh?.Triangles ?? 0;
        public int MeshGroups => mesh?.GroupCount ?? 0;
        /// <summary>Finish ids the mesher drew, with their triangle counts.</summary>
        public IReadOnlyDictionary<string, int> TrianglesByFinish => mesh?.TrianglesByFinish();
        /// <summary>Cells whose finish id the library could not resolve, by name.</summary>
        public IReadOnlyCollection<string> UnknownFinishes => unknownFinishes;

        readonly HashSet<string> unknownFinishes = new HashSet<string>(StringComparer.Ordinal);

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

        void BuildInternal(StationCellViewRequest request, Transform parent) {
            toWorld = request.ToWorld ?? StationCoordinates.Point;
            var rootObject = new GameObject(string.IsNullOrEmpty(request.Name) ? "Station cells" : request.Name);
            root = rootObject.transform;
            root.SetParent(parent, false);
            root.localPosition = Vector3.zero;
            root.localRotation = Quaternion.identity;
            root.localScale = Vector3.one;

            mesh = StationCellMesher.Mesh(request.Mesh);
            faces.AddRange(mesh.Faces);

            foreach (var group in mesh.Groups) {
                var material = Resolve(request, group.FinishId);
                var child = new GameObject(group.GroupKey);
                var transform = child.transform;
                transform.SetParent(RoleRoot(group.Role), false);
                transform.localPosition = Vector3.zero;
                transform.localRotation = Quaternion.identity;
                transform.localScale = Vector3.one;
                var filter = child.AddComponent<MeshFilter>();
                var renderer = child.AddComponent<MeshRenderer>();
                renderer.shadowCastingMode = ShadowCastingMode.Off;
                renderer.receiveShadows = true;
                renderer.sharedMaterial = material;
                var mesh = BuildMesh(group);
                filter.sharedMesh = mesh;
                var entry = new StationCellGroupView {
                    Data = group, GameObject = child, Filter = filter, Renderer = renderer,
                    Mesh = mesh, Material = material,
                    Wall = group.Role == StationSurfaceRole.Wall ||
                        (request.Finishes != null && !string.IsNullOrEmpty(group.FinishId) && request.Finishes.IsWall(group.FinishId)),
                };
                groups.Add(entry);
                if (request.Finishes != null && !request.Finishes.IsKnown(group.FinishId)) unknownFinishes.Add(group.FinishId);
            }
        }

        Material Resolve(StationCellViewRequest request, string finishId) {
            if (request.ResolveFinish != null) return request.ResolveFinish(finishId);
            if (request.Finishes != null) return request.Finishes.For(finishId);
            if (request.FallbackMaterial != null) return request.FallbackMaterial;
            throw new InvalidOperationException("StationCellViewRequest has no finish resolver (Finishes, ResolveFinish or FallbackMaterial)");
        }

        /// <summary>Document axes  world, then the reflected winding is reversed.</summary>
        Mesh BuildMesh(StationCellMeshGroup group) {
            var vertexCount = group.Positions.Length;
            var vertices = new Vector3[vertexCount];
            var normals = new Vector3[vertexCount];
            for (var i = 0; i < vertexCount; i++) {
                vertices[i] = toWorld(group.Positions[i]);
                normals[i] = toWorld(group.Normals[i]);
            }
            var indices = new int[group.Indices.Length];
            // The documentworld swap is a reflection: keep every triangle facing out
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
        public bool TryPick(Ray worldRay, out StationCellPickHit hit) {
            hit = default;
            var best = float.MaxValue;
            var found = false;
            foreach (var group in groups) {
                if (group.GameObject == null || !group.GameObject.activeInHierarchy) continue;
                var data = group.Data;
                if (!RayHitsBounds(worldRay, data.Bounds)) continue;
                var indices = data.Indices;
                var positions = data.Positions;
                for (var t = 0; t < indices.Length; t += 3) {
                    var i0 = indices[t];
                    var i1 = indices[t + 1];
                    var i2 = indices[t + 2];
                    var a = toWorld(positions[i0]);
                    var b = toWorld(positions[i1]);
                    var c = toWorld(positions[i2]);
                    if (!RayTriangle(worldRay, a, b, c, best, out var distance)) continue;
                    best = distance;
                    found = true;
                    var faceIndex = data.TriangleFaces != null && t / 3 < data.TriangleFaces.Length ? data.TriangleFaces[t / 3] : -1;
                    var record = faceIndex >= 0 && faceIndex < faces.Count ? faces[faceIndex] : default;
                    var normal = Vector3.Cross(b - a, c - a);
                    if (normal.sqrMagnitude > 0) normal.Normalize();
                    hit = new StationCellPickHit(record.X, record.Y, record.Z, record.Face, record.FinishId, record.Role,
                        record.Slope, worldRay.origin + worldRay.direction * distance, normal, distance, group);
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

        static bool RayHitsBounds(Ray ray, Bounds bounds) {
            // A ray that misses the document-axis bounds cannot hit the group; the
            // swap is monotone, so testing the document bounds in their own axes with
            // a swapped ray is exact.
            var origin = new Vector3(ray.origin.x, ray.origin.z, ray.origin.y);
            var direction = new Vector3(ray.direction.x, ray.direction.z, ray.direction.y);
            var documentRay = new Ray(origin, direction);
            return new Bounds(bounds.center, bounds.size).IntersectRay(documentRay);
        }

        static bool RayTriangle(Ray ray, Vector3 a, Vector3 b, Vector3 c, float maxDistance, out float distance) {
            const float epsilon = 1e-7f;
            distance = 0f;
            var edge1 = b - a;
            var edge2 = c - a;
            var h = Vector3.Cross(ray.direction, edge2);
            var determinant = Vector3.Dot(edge1, h);
            if (determinant > -epsilon && determinant < epsilon) return false;
            var inverse = 1f / determinant;
            var s = ray.origin - a;
            var u = inverse * Vector3.Dot(s, h);
            if (u < 0f || u > 1f) return false;
            var q = Vector3.Cross(s, edge1);
            var v = inverse * Vector3.Dot(ray.direction, q);
            if (v < 0f || u + v > 1f) return false;
            var t = inverse * Vector3.Dot(edge2, q);
            if (t <= epsilon || t >= maxDistance) return false;
            distance = t;
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
            if (destroyObjects && root != null) Destroy(root.gameObject);
            root = null;
            faces.Clear();
            roleRoots.Clear();
            storeyRoots.Clear();
            mesh = null;
        }
    }

    /// <summary>
    /// Packet E's registration with packet A's renderer registry: the station's cell
    /// surfaces as one renderer family (`Role = "cells"`).
    ///
    /// It projects the committed <see cref="StationDocument"/> into the mesher's plain
    /// input, builds the surfaces under `context.RoleRoot("cells")`, registers one
    /// record per emitted group (chunk  storey  role  finish) with the world, and
    /// reports what it could not derive **by name** instead of inventing it:
    ///   * `finish-library-missing`  the exported finish library is not staged, so no
    ///     cell surface is drawn (a solid-colour stand-in is never a finish);
    ///   * `finish-unknown`  a finish id outside the export, drawn with the documented
    ///     `floor.concrete` fallback and kept in the document (E2's rule);
    ///   * `ramp-slope-not-derived` / `platform-inset-not-derived` / `ramp-openings-not-derived`
    ///      module-derived mesher inputs the host has not supplied yet (the mesher
    ///     draws them when given; the module  cut/inset/opening ports are the blocker
    ///     named in `unity/plan/11-evidence/E.md`).
    ///
    /// The built <see cref="View"/> is the paint adapter's pick source:
    /// `view.TryPick(worldRay, out hit)` resolves one pointer hit once and hands back the
    /// same `cellKey + face + finish` for hover and commit.
    /// </summary>
    public sealed class StationCellRenderer : IStationViewRenderer {
        public const string RoleName = "cells";

        /// <summary>Override how the finish library is acquired (tests stage a fixture).</summary>
        public static Func<Shader, StationFinishLibrary> FinishLibraryFactory;

        /// <summary>
        /// One built world's cell surfaces. The host reuses renderer **singletons**
        /// across staged worlds, and the old world's `Dispose -> Release()` runs *after*
        /// the candidate world's `Build()`, so state is per world and never a shared
        /// field: `Release` drops only the entries whose world reports `IsDisposed`
        /// (the disposing world sets that flag before calling it), which keeps the
        /// newest live world - the committed one after a successful install.
        /// </summary>
        public sealed class CellState {
            public StationWorldView World;
            public StationCellView View;
            public StationPaintSnapshot Snapshot;
            public StationFinishLibrary Finishes;
            public int Groups;
            public int Triangles;
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

        /// <summary>The active world's pick, for a handler that has no view reference.</summary>
        public static bool TryPickActive(Ray worldRay, out StationCellPickHit hit) {
            var view = Current?.View;
            if (view != null) return view.TryPick(worldRay, out hit);
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
            var input = BuildInput(context, finishes, notes);
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
            // One record per emitted group, keyed by a cell the group actually draws:
            // cell-level picking and painting go through `view.TryPick`, which knows
            // every triangle's own face record; the registered record is the world's
            // visibility/debug handle for the group. The **anchor** is the cell the old
            // unsplit group's level span came from: a role split must draw on the same
            // storey the whole group drew on, never on the storey of its own first face.
            var registered = 0;
            foreach (var group in view.Groups) {
                var triangleFaces = group.Data?.TriangleFaces;
                if (triangleFaces == null || triangleFaces.Length == 0) continue;
                var faceIndex = triangleFaces[0];
                // A group without a resident face record cannot be registered (and a bad
                // record index must never take the whole station build down in IL2CPP).
                if (faceIndex < 0 || faceIndex >= view.Faces.Count) continue;
                var record = view.Faces[faceIndex];
                var anchor = group.Data.HasAnchor ? group.Data.Anchor : record.CellKey;
                context.World.RegisterCell(RoleName, anchor, group.GameObject);
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
        }

        /// <summary>
        /// Project the committed document into the mesher's plain input. The ground rule
        /// is the document's own: the street plane at z = 0 outside every record, minus
        /// the module-derived holes packet A can answer exactly (track beds, exit
        /// floors). Ramp openings, slope cuts and platform insets are reported, not
        /// guessed.
        /// </summary>
        public static StationCellMeshInput BuildInput(StationViewBuildContext context, StationFinishLibrary library, List<string> notes) {
            var document = context.Document;
            var input = new StationCellMeshInput {
                LevelBase = document.LevelBase,
                StoreyHeight = document.StoreyHeight,
                VirtualGround = true,
                GroundZ = StationPaintSnapshot.GroundZ,
                GroundMargin = 16,
                DefaultFinish = library != null ? library.DefaultFinishFor(StationFace.Top) : StationFinishIds.DefaultMaterial,
                RampSoffitFinish = library != null ? library.RampSoffitId : "ceil.steel",
                BuildCeilings = true,
                BuildPlates = false,
                BuildGround = true,
            };
            foreach (var cell in document.Cells) {
                if (!cell.IsSolid) { input.Voids.Add(cell.Key); continue; }
                var tags = cell.Tags;
                var flags = StationMeshCellFlags.None;
                if (StationCellRules.IsWallBlock(tags)) flags |= StationMeshCellFlags.Wall;
                if (cell.HasTag("suspended-ceiling")) flags |= StationMeshCellFlags.SuspendedCeiling;
                if (cell.HasTag("opening-ceiling")) flags |= StationMeshCellFlags.OpeningCeiling;
                if (cell.HasTag("painted-ground")) flags |= StationMeshCellFlags.PaintedGround;
                input.Cells.Add(new StationMeshCell {
                    X = cell.X, Y = cell.Y, Z = cell.Z, Solid = true,
                    Shape = StationCellRules.ShapeOf(tags),
                    Flags = flags,
                    Finish = StationFinishSet.FromRecord(cell),
                });
            }
            var holes = 0;
            var ramps = 0;
            var insets = 0;
            var rampsAtGrade = 0;
            foreach (var module in document.Modules) {
                if (module == null) continue;
                switch (module.Type) {
                    case "track":
                        if (module.Z == StationPaintSnapshot.GroundZ && !module.Config.Bool("tunnel") && !module.Config.Bool("bridge"))
                            foreach (var point in StationFootprints.TrackCells(module))
                                if (input.GroundHoles.Add(CellKeyAt(point))) holes++;
                        break;
                    case "exit":
                        if (module.Z == StationPaintSnapshot.GroundZ)
                            foreach (var point in StationFootprints.ExitFootprint(module))
                                if (input.GroundHoles.Add(CellKeyAt(point))) holes++;
                        rampsAtGrade++;
                        break;
                    case "stair":
                    case "escalator":
                    case "walkway":
                        ramps++;
                        if (module.Z == StationPaintSnapshot.GroundZ) rampsAtGrade++;
                        break;
                    case "platform-edge":
                        if (module.Config.Text("psd") != "none") insets++;
                        break;
                }
            }
            if (ramps > 0) notes.Add("ramp-slope-not-derived: " + ramps + " run(s) have no SlopeCut in this build, so a block under a run is drawn whole");
            if (insets > 0) notes.Add("platform-inset-not-derived: " + insets + " platform edge(s) with a PSD base are drawn full-width");
            if (rampsAtGrade > 0) notes.Add("ramp-openings-not-derived: " + rampsAtGrade + " run(s) at grade do not cut the street window (track/exit openings are applied)");
            if (holes > 0) notes.Add("ground-openings-applied: " + holes + " street cell(s) kept open from track/exit facts");
            return input;
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






