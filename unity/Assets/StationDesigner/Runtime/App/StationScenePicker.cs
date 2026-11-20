using System;
using System.Collections.Generic;
using Metro.App.Views;
using Metro.Build;
using Metro.View;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App {
    /// <summary>The winning geometry kind resolved by one scene pick.</summary>
    public enum StationSceneTargetKind {
        None = 0,
        Cell = 1,
        Module = 2,
        Plane = 3,
    }

    /// <summary>
    /// Camera, culling, clip-interval, visibility and carry-exclusion rules evaluated
    /// uniformly by <see cref="StationScenePicker"/> for one event ray.
    /// </summary>
    public readonly struct StationPickContext {
        readonly bool configured;
        readonly int cullingMask;
        readonly float minDistance;
        readonly float maxDistance;
        readonly bool evaluateWorkPlane;
        public readonly StationVisibilityRegistry Visibility;
        public readonly string ExcludeModuleId;

        public StationPickContext(int cullingMask, float minDistance, float maxDistance,
            StationVisibilityRegistry visibility, string excludeModuleId = null, bool evaluateWorkPlane = true) {
            configured = true;
            this.cullingMask = cullingMask;
            this.minDistance = Mathf.Max(0f, minDistance);
            this.maxDistance = float.IsNaN(maxDistance) ? float.PositiveInfinity : Mathf.Max(0f, maxDistance);
            this.evaluateWorkPlane = evaluateWorkPlane;
            Visibility = visibility;
            ExcludeModuleId = excludeModuleId ?? "";
        }

        public int CullingMask => configured ? cullingMask : ~0;
        public float MinDistance => configured ? minDistance : 0f;
        public float MaxDistance => configured ? maxDistance : float.PositiveInfinity;
        public bool EvaluateWorkPlane => !configured || evaluateWorkPlane;

        public static StationPickContext Default(StationVisibilityRegistry visibility = null,
            string excludeModuleId = null, bool evaluateWorkPlane = true) =>
            new StationPickContext(~0, 0f, float.PositiveInfinity, visibility, excludeModuleId, evaluateWorkPlane);

        public static StationPickContext FromCamera(Camera camera, Ray ray, StationVisibilityRegistry visibility,
            string excludeModuleId = null, bool evaluateWorkPlane = true) {
            if (camera == null) return Default(visibility, excludeModuleId, evaluateWorkPlane);
            StationCellPickFilter.ClipInterval(camera, ray, out var min, out var max);
            return new StationPickContext(camera.cullingMask, min, max, visibility, excludeModuleId, evaluateWorkPlane);
        }

        public StationCellPickFilter ToCellFilter() =>
            new StationCellPickFilter(CullingMask, MinDistance, MaxDistance, Visibility);
    }

    /// <summary>
    /// One pointer event's scene hit, in document axes. It is resolved **once** per
    /// event (plan 16 §1.2 / repo rule) and then handed unchanged to the tool, the
    /// candidate resolver, the ghost and the commit, so preview and release can never
    /// read two different surfaces.
    /// </summary>
    public sealed class StationSceneHit {
        /// <summary>Deterministic tie tolerance (metres) for coincident module/cell or prop/tile surfaces.</summary>
        public const float CoincidentTieMetres = 2e-3f;

        /// <summary>The visible cell surface hit, or <see cref="StationPlacementHit.None"/> when no cell triangle was hit.</summary>
        public StationPlacementHit Cell = StationPlacementHit.None;
        /// <summary>The authored cell key recorded on the hit triangle's face (preserved across slopes, insets and thin walls).</summary>
        public StationCellKey CellKey;
        /// <summary>The authored face enum recorded on the hit cell triangle.</summary>
        public StationFace CellFace;
        /// <summary>The outward geometric normal of the hit cell triangle in document axes.</summary>
        public StationPoint CellNormal;
        /// <summary>The finish id painted on the hit cell triangle.</summary>
        public string CellFinishId = "";
        /// <summary>The mesher surface role of the hit cell group.</summary>
        public StationSurfaceRole CellRole;
        /// <summary>True when the hit cell triangle is a 45-degree slope face.</summary>
        public bool CellSlope;

        /// <summary>
        /// The active level's horizontal work-plane fallback at <c>level + 1</c>, kept separate from
        /// <see cref="Cell"/> so empty air is never mistaken for a real block surface.
        /// </summary>
        public StationPlacementHit WorkPlane = StationPlacementHit.None;
        public float WorkPlaneDistance = float.PositiveInfinity;

        /// <summary>The nearest visible placed module whose rendered mesh triangles the ray met, or null.</summary>
        public StationModuleRecord Module;
        public StationViewRecord Record;
        /// <summary>The winning target's document-space hit point (metres).</summary>
        public StationPoint Point;
        /// <summary>The drawn surface point on <see cref="Module"/> in document axes.</summary>
        public StationPoint ModulePoint;
        /// <summary>The outward geometric surface normal at <see cref="ModulePoint"/> in document axes.</summary>
        public StationPoint ModuleNormal;
        /// <summary>The surface point in the module holder's local axes.</summary>
        public Vector3 ModuleLocal;
        /// <summary>True when a real rendered mesh triangle on <see cref="Module"/> was met.</summary>
        public bool ModuleExact;
        /// <summary>The ray distance to the nearest kept module triangle, or +inf when none was hit.</summary>
        public float ModuleDistance = float.PositiveInfinity;
        /// <summary>The ray distance to the nearest kept cell triangle, or +inf when none was hit.</summary>
        public float CellDistance = float.PositiveInfinity;

        public bool HasModule => Module != null;
        public bool HasCell => Cell.HasCell;
        public bool HasWorkPlane => WorkPlane.HasCell;

        /// <summary>
        /// The whole cell the **nearest drawn surface** names (plan 28 §1). A module that wins
        /// the pick names its own face exactly as `render/pickCell.ts:pickCells` does — so a
        /// sidewalk tile's top anchors one cell above the tile's drawn surface rather than on
        /// the ground behind it — while a cell surface keeps its authored cell and face step.
        /// The cell tools and the rail tools all read this one answer, so a paver resolves the
        /// same cell for the ghost and for the release.
        /// </summary>
        public StationPlacementHit EditCell =>
            HasModule && ModuleWins
                ? StationPlacementHit.FromNormal(ModulePoint, ModuleNormal, true)
                : Cell;

        /// <summary>True when a visible module surface was hit and is not occluded by a nearer cell surface.</summary>
        public bool ModuleWins =>
            HasModule && (!HasCell || ModuleDistance <= CellDistance + CoincidentTieMetres);

        public StationSceneTargetKind TargetKind {
            get {
                if (ModuleWins) return StationSceneTargetKind.Module;
                if (HasCell) return StationSceneTargetKind.Cell;
                if (HasWorkPlane) return StationSceneTargetKind.Plane;
                return StationSceneTargetKind.None;
            }
        }

        /// <summary>The storey the pointer resolved on (the tool's editing level).</summary>
        public int Level;

        public override string ToString() =>
            "target=" + TargetKind +
            (HasCell ? " cell " + CellKey.X + "," + CellKey.Y + "," + CellKey.Z : " no cell") +
            (HasModule ? " module " + Module.Id + " " + Module.Type : "") +
            (HasWorkPlane ? " plane " + WorkPlane.X + "," + WorkPlane.Y + "," + WorkPlane.Z : "");
    }

    /// <summary>
    /// The scene picker (plan 16 §1.2, plan 25 §1–§2): one camera ray per event, exact
    /// triangle + visibility + section-plane resolution against <see cref="StationCellRenderer"/>
    /// and the committed world's rendered module meshes.
    /// </summary>
    public static class StationScenePicker {
        /// <summary>Roles that are presentation only and must never take an edit pick.</summary>
        static readonly HashSet<string> UnpickableRoles = new HashSet<string>(StringComparer.Ordinal) {
            "cells", "grid", "cursor", "overlay", "actors", "crowd", "trains", "preview", "section", "roads", "road-vehicles",
        };

        /// <summary>Diagnostic counter incremented once per <see cref="PickRay"/> invocation (reset by <see cref="Reset"/>).</summary>
        public static int PickCount { get; private set; }

        readonly struct RenderPart {
            public readonly MeshFilter Filter;
            public readonly MeshRenderer Renderer;
            public RenderPart(MeshFilter filter, MeshRenderer renderer) {
                Filter = filter;
                Renderer = renderer;
            }
        }

        sealed class CachedMesh {
            public Mesh Mesh;
            public Vector3[] Vertices;
            public int[][] SubmeshIndices;
        }

        sealed class Body {
            public StationModuleRecord Module;
            public StationViewRecord Record;
            public StationBox Box;
            public RenderPart[] Parts;
            public bool IsBatched;
            public StationBatchSpan[] BatchSpans;
            public StationInstancedSurfaceBatch InstancedBatch;
            public int InstanceSourceIndex;
        }

        sealed class Index {
            public StationWorldView World;
            public StationDocument Document;
            public Body[] Bodies;
            public Dictionary<string, StationModuleRecord> Modules;
            public StationLevelGrid Grid;
        }

        sealed class ReferenceMeshComparer : IEqualityComparer<Mesh> {
            public static readonly ReferenceMeshComparer Instance = new ReferenceMeshComparer();
            public bool Equals(Mesh x, Mesh y) => ReferenceEquals(x, y);
            public int GetHashCode(Mesh obj) => System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(obj);
        }

        static Index index;
        static readonly Dictionary<Mesh, CachedMesh> meshCache =
            new Dictionary<Mesh, CachedMesh>(ReferenceMeshComparer.Instance);

        /// <summary>Drop the cached body index and CPU mesh cache.</summary>
        public static void Reset() {
            index = null;
            meshCache.Clear();
            PickCount = 0;
        }

        /// <summary>Drop pick caches bound to a disposed world and prune destroyed meshes.</summary>
        public static void ReleaseWorld(StationWorldView world) {
            if (world != null && index != null && ReferenceEquals(index.World, world)) {
                index = null;
            }
            if (meshCache.Count > 0) {
                List<Mesh> dead = null;
                foreach (var key in meshCache.Keys) {
                    if (key == null) (dead ??= new List<Mesh>()).Add(key);
                }
                if (dead != null) {
                    for (int i = 0; i < dead.Count; i++) meshCache.Remove(dead[i]);
                }
            }
        }

        /// <summary>Reset only the per-event diagnostic counter without dropping cached world geometry.</summary>
        public static void ResetPickCount() => PickCount = 0;

        /// <summary>
        /// Resolve one screen hit using the camera's frustum clip interval, culling mask and
        /// active visibility registry.
        /// </summary>
        public static StationSceneHit Pick(StationWorldView world, Camera camera, Vector2 screen, int level,
            StationVisibilityRegistry visibility = null, string excludeModuleId = null, bool evaluateWorkPlane = true) {
            if (camera == null) return new StationSceneHit { Level = level };
            var ray = camera.ScreenPointToRay(screen);
            visibility = visibility != null ? visibility : StationViewFeature.Active?.Visibility;
            var context = StationPickContext.FromCamera(camera, ray, visibility, excludeModuleId, evaluateWorkPlane);
            return PickRay(world, ray, level, context);
        }

        /// <summary>Resolve one unit ray with default camera context and optional visibility registry.</summary>
        public static StationSceneHit PickRay(StationWorldView world, Ray ray, int level,
            StationVisibilityRegistry visibility = null) {
            visibility = visibility != null ? visibility : StationViewFeature.Active?.Visibility;
            return PickRay(world, ray, level, StationPickContext.Default(visibility));
        }

        /// <summary>Resolve one ray against the supplied world and pick context.</summary>
        public static StationSceneHit PickRay(StationWorldView world, Ray ray, int level, in StationPickContext context) {
            PickCount++;
            var hit = new StationSceneHit { Level = level };
            if (ray.direction.sqrMagnitude <= 1e-12f) return hit;
            var unitRay = new Ray(ray.origin, ray.direction.normalized);

            // 1. Visible cell triangles on the supplied world (active GameObject, enabled MeshRenderer,
            // camera culling mask, clip interval, triangle winding/culling and section IsPointKept).
            if (world != null && StationCellRenderer.TryPickWorld(world, unitRay, context.ToCellFilter(), out var cellHit)) {
                var pointVec = StationCoordinates.WorldToDocument(cellHit.Point);
                var normalVec = StationCoordinates.WorldToDocumentDirection(cellHit.Normal).normalized;
                var docPoint = new StationPoint(pointVec.x, pointVec.y, pointVec.z);
                var docNormal = new StationPoint(normalVec.x, normalVec.y, normalVec.z);
                int stepX, stepY, stepZ;
                if (cellHit.Slope) {
                    StationPlacementHit.FaceStep(docNormal, out stepX, out stepY, out stepZ);
                } else {
                    StationFaces.Step(cellHit.Face, out stepX, out stepY, out stepZ);
                }
                hit.CellKey = cellHit.CellKey;
                hit.CellFace = cellHit.Face;
                hit.CellNormal = docNormal;
                hit.CellFinishId = cellHit.FinishId ?? "";
                hit.CellRole = cellHit.Role;
                hit.CellSlope = cellHit.Slope;
                hit.Cell = StationPlacementHit.FromCellFace(
                    cellHit.X, cellHit.Y, cellHit.Z, stepX, stepY, stepZ, true, docPoint);
                hit.CellDistance = cellHit.Distance;
            }

            // 2. Visible module mesh triangles on the supplied world, evaluated with the same
            // camera mask, clip interval, renderer state and per-triangle section predicate.
            var module = PickModule(world, unitRay, context);
            if (module.HasValue) {
                var found = module.Value;
                hit.Module = found.Module;
                hit.Record = found.Record;
                hit.ModuleDistance = found.Distance;
                hit.ModulePoint = new StationPoint(found.Point.x, found.Point.y, found.Point.z);
                hit.ModuleNormal = new StationPoint(found.Normal.x, found.Normal.y, found.Normal.z);
                hit.ModuleLocal = found.Local;
                hit.ModuleExact = found.Exact;
            }

            // 3. Optional work-plane fallback at `level + 1`: evaluated only when requested and
            // no visible cell or module surface answered, and only when kept by clip + section.
            if (context.EvaluateWorkPlane && !hit.HasCell && !hit.HasModule) {
                var planeY = StationCoordinates.Floor(level);
                var plane = new Plane(Vector3.up, new Vector3(0f, planeY, 0f));
                if (plane.Raycast(unitRay, out var distance) &&
                    distance >= context.MinDistance && distance <= context.MaxDistance && distance < 5000f) {
                    var worldPoint = unitRay.origin + unitRay.direction * distance;
                    if (context.Visibility == null ||
                        context.Visibility.IsPointKept(StationCameraSpace.ToDocument(worldPoint))) {
                        var document = StationCoordinates.WorldToDocument(worldPoint);
                        int x = Mathf.FloorToInt(document.x), y = Mathf.FloorToInt(document.y);
                        var planePoint = new StationPoint(document.x, document.y, level + 1);
                        hit.WorkPlane = new StationPlacementHit(
                            x, y, level, x, y, level, false, planePoint, level + 1, new StationPoint(0, 0, 1));
                        hit.WorkPlaneDistance = distance;
                    }
                }
            }

            // Set `Point` to the winning surface's document hit point.
            switch (hit.TargetKind) {
                case StationSceneTargetKind.Module:
                    hit.Point = hit.ModulePoint;
                    break;
                case StationSceneTargetKind.Cell:
                    hit.Point = hit.Cell.Point;
                    break;
                case StationSceneTargetKind.Plane:
                    hit.Point = hit.WorkPlane.Point;
                    break;
            }
            return hit;
        }

        /// <summary>
        /// Scoped bounds fallback for straight ramps (`CameraSystem.ts:pickModuleInBounds` +
        /// `EquipmentTool.ts:pickSnapRamp`), used ONLY when aiming a head-house `exit` over a
        /// stair/escalator whose tread gaps let the exact triangle ray pass through.
        /// Rejects hidden or section-clipped ramps, ramps occluded by a nearer cell surface,
        /// and ramps whose own exact surface hit on this ray was occluded by a nearer cell.
        /// </summary>
        public static StationModuleRecord PickSnapRampInBounds(StationWorldView world, Ray ray,
            in StationPickContext context, StationSceneHit resolvedHit) {
            if (world == null || !world.IsBuilt || ray.direction.sqrMagnitude <= 1e-12f) return null;
            var bodies = Bodies(world);
            if (bodies.Length == 0) return null;
            var unitRay = new Ray(ray.origin, ray.direction.normalized);
            var modules = index.Modules;
            var grid = index.Grid;
            float bestDist = float.PositiveInfinity;
            StationModuleRecord bestRamp = null;
            for (int i = 0; i < bodies.Length; i++) {
                var body = bodies[i];
                var module = body.Module;
                if (!IsEligibleSnapRamp(module)) continue;
                if (!string.IsNullOrEmpty(context.ExcludeModuleId) &&
                    string.Equals(module.Id, context.ExcludeModuleId, StringComparison.Ordinal)) continue;
                var record = body.Record;
                if (record.View == null || !record.View.activeInHierarchy) continue;
                if (!PickableRecord(record, modules, grid, context.Visibility)) continue;

                // Measure live world bounds of currently enabled renderers matching the camera mask.
                bool anyRenderer = false;
                var liveBounds = default(Bounds);
                for (int p = 0; p < body.Parts.Length; p++) {
                    var renderer = body.Parts[p].Renderer;
                    if (!IsRendererEligible(renderer, context.CullingMask)) continue;
                    if (!anyRenderer) { liveBounds = renderer.bounds; anyRenderer = true; }
                    else liveBounds.Encapsulate(renderer.bounds);
                }
                if (!anyRenderer) continue;

                // If the ray also hit an exact triangle on this ramp behind a nearer cell, do not
                // allow the larger AABB to resurrect an occluded run (`CameraSystem.ts:708-709`).
                var exactSample = Surface(body, unitRay, context);
                if (exactSample.Found && resolvedHit != null && resolvedHit.HasCell &&
                    resolvedHit.CellDistance + 1e-4f < exactSample.Distance) continue;

                if (!RayBoundsClipped(unitRay, liveBounds, context.MinDistance, context.MaxDistance, out var boxDist))
                    continue;
                if (resolvedHit != null && resolvedHit.HasCell && resolvedHit.CellDistance + 1e-4f < boxDist)
                    continue;
                var entryWorld = unitRay.origin + unitRay.direction * boxDist;
                if (context.Visibility != null &&
                    !context.Visibility.IsPointKept(StationCameraSpace.ToDocument(entryWorld)))
                    continue;
                if (boxDist < bestDist || (Mathf.Abs(boxDist - bestDist) <= 1e-5f && bestRamp != null &&
                    string.CompareOrdinal(module.Id, bestRamp.Id) < 0)) {
                    bestDist = boxDist;
                    bestRamp = module;
                }
            }
            return bestRamp;
        }

        static bool IsEligibleSnapRamp(StationModuleRecord module) {
            if (module == null || !module.From.HasValue || !module.To.HasValue) return false;
            if (string.Equals(module.Type, "escalator", StringComparison.Ordinal)) return true;
            if (!string.Equals(module.Type, "stair", StringComparison.Ordinal)) return false;
            if (module.Config.Bool("block")) return false;
            var style = module.Config.Text("style");
            return style.Length == 0 || string.Equals(style, "straight", StringComparison.Ordinal);
        }

        readonly struct ModuleHit {
            public ModuleHit(StationModuleRecord module, StationViewRecord record, float distance,
                Vector3 point, Vector3 normal, Vector3 local, bool exact) {
                Module = module; Record = record; Distance = distance;
                Point = point; Normal = normal; Local = local; Exact = exact;
            }
            public StationModuleRecord Module { get; }
            public StationViewRecord Record { get; }
            public float Distance { get; }
            public Vector3 Point { get; }
            public Vector3 Normal { get; }
            public Vector3 Local { get; }
            public bool Exact { get; }
        }

        struct SurfaceSample {
            public bool Found;
            public float Distance;
            public Vector3 WorldPoint;
            public Vector3 WorldNormal;
            public Vector3 LocalPoint;
        }

        readonly struct ModuleCandidate {
            public readonly Body Body;
            public readonly SurfaceSample Sample;
            public readonly bool IsSurface;
            public ModuleCandidate(Body body, SurfaceSample sample, bool isSurface) {
                Body = body;
                Sample = sample;
                IsSurface = isSurface;
            }
        }

        static ModuleHit? PickModule(StationWorldView world, Ray worldRay, in StationPickContext context) {
            if (world == null || !world.IsBuilt) return null;
            var bodies = Bodies(world);
            if (bodies.Length == 0) return null;
            var modules = index.Modules;
            var grid = index.Grid;
            var origin = StationCoordinates.WorldToDocument(worldRay.origin);
            var direction = StationCoordinates.WorldToDocumentDirection(worldRay.direction);

            bool hasBest = false;
            ModuleCandidate best = default;

            for (int i = 0; i < bodies.Length; i++) {
                var body = bodies[i];
                if (!string.IsNullOrEmpty(context.ExcludeModuleId) &&
                    string.Equals(body.Module.Id, context.ExcludeModuleId, StringComparison.Ordinal)) continue;
                var record = body.Record;
                if (record.View == null || !record.View.activeInHierarchy) continue;
                if (!PickableRecord(record, modules, grid, context.Visibility)) continue;
                if (!RayBoxInterval(origin, direction, body.Box, context.MinDistance, context.MaxDistance)) continue;

                var sample = Surface(body, worldRay, context);
                if (!sample.Found) continue;

                var candidate = new ModuleCandidate(body, sample, IsSurfaceTile(body.Module.Type));
                if (!hasBest || WinsOver(candidate, best)) {
                    best = candidate;
                    hasBest = true;
                }
            }

            if (!hasBest) return null;
            return new ModuleHit(
                best.Body.Module,
                best.Body.Record,
                best.Sample.Distance,
                StationCoordinates.WorldToDocument(best.Sample.WorldPoint),
                StationCoordinates.WorldToDocumentDirection(best.Sample.WorldNormal).normalized,
                best.Sample.LocalPoint,
                true);
        }

        /// <summary>
        /// Deterministic candidate ordering: strictly nearer triangle wins beyond
        /// <see cref="StationSceneHit.CoincidentTieMetres"/>; within that tie window a non-paving
        /// prop beats a coincident surface tile, then nearer distance, then ordinal module ID.
        /// </summary>
        static bool WinsOver(in ModuleCandidate challenger, in ModuleCandidate incumbent) {
            float delta = challenger.Sample.Distance - incumbent.Sample.Distance;
            if (delta < -StationSceneHit.CoincidentTieMetres) return true;
            if (delta > StationSceneHit.CoincidentTieMetres) return false;
            if (!challenger.IsSurface && incumbent.IsSurface) return true;
            if (challenger.IsSurface && !incumbent.IsSurface) return false;
            if (Mathf.Abs(delta) > 1e-5f) return delta < 0f;
            return string.CompareOrdinal(challenger.Body.Module.Id, incumbent.Body.Module.Id) < 0;
        }

        static SurfaceSample Surface(Body body, Ray worldRay, in StationPickContext context) {
            var sample = new SurfaceSample { Distance = float.PositiveInfinity };
            var record = body.Record;
            if (record?.View == null) return sample;

            if (body.InstancedBatch != null) {
                if (body.Parts.Length == 0) return sample;
                var part = body.Parts[0];
                if (!IsRendererEligible(part.Renderer, context.CullingMask)) return sample;
                var batch = body.InstancedBatch;
                var mesh = batch.SharedMesh;
                if (mesh == null) return sample;
                float limit = Mathf.Min(context.MaxDistance, sample.Distance);
                var batchBounds = batch.WorldBounds.size.sqrMagnitude > 1e-8f ? batch.WorldBounds : part.Renderer.bounds;
                if (!RayBoundsClipped(worldRay, batchBounds, context.MinDistance, limit, out _)) return sample;
                if (!batch.TryGetSourceRange(body.InstanceSourceIndex, out int instStart, out int instCount)) return sample;
                var cached = GetCachedMesh(mesh);
                if (batch.SubmeshIndex < 0 || batch.SubmeshIndex >= cached.SubmeshIndices.Length) return sample;
                var indices = cached.SubmeshIndices[batch.SubmeshIndex];
                if (indices == null || indices.Length < 3) return sample;
                var vertices = cached.Vertices;
                var cull = StationCellView.MaterialCullMode(part.Renderer.sharedMaterial);
                var matrices = batch.Matrices;
                var parentToWorld = part.Filter != null ? part.Filter.transform.localToWorldMatrix : Matrix4x4.identity;
                bool parentIdentity = parentToWorld.isIdentity;
                for (int k = 0; k < instCount; k++) {
                    int idx = instStart + k;
                    if (idx < 0 || idx >= matrices.Length) break;
                    var toWorld = parentIdentity ? matrices[idx] : parentToWorld * matrices[idx];
                    bool identity = toWorld.isIdentity;
                    bool flip = !identity && toWorld.determinant < 0f;
                    TestTriangles(worldRay, vertices, indices, 0, indices.Length, identity, flip, toWorld, cull,
                        context.MinDistance, context.MaxDistance, context.Visibility, record.View.transform,
                        null, ref sample);
                }
                return sample;
            }

            if (body.IsBatched) {
                if (body.Parts.Length == 0) return sample;
                var part = body.Parts[0];
                if (!IsRendererEligible(part.Renderer, context.CullingMask)) return sample;
                var mesh = part.Filter != null ? part.Filter.sharedMesh : null;
                if (mesh == null) return sample;
                float limit = Mathf.Min(context.MaxDistance, sample.Distance);
                if (!RayBoundsClipped(worldRay, part.Renderer.bounds, context.MinDistance, limit, out _)) return sample;
                var cached = GetCachedMesh(mesh);
                if (cached.SubmeshIndices.Length == 0 || cached.SubmeshIndices[0] == null) return sample;
                var indices = cached.SubmeshIndices[0];
                var vertices = cached.Vertices;
                var cull = StationCellView.MaterialCullMode(part.Renderer.sharedMaterial);
                var toWorld = part.Filter.transform.localToWorldMatrix;
                bool identity = toWorld.isIdentity;
                bool flip = !identity && toWorld.determinant < 0f;

                if (body.BatchSpans != null && body.BatchSpans.Length > 0) {
                    for (int s = 0; s < body.BatchSpans.Length; s++) {
                        var span = body.BatchSpans[s];
                        int startIdx = Math.Max(0, span.StartTriangle * 3);
                        int endIdx = Math.Min(indices.Length, (span.StartTriangle + span.TriangleCount) * 3);
                        TestTriangles(worldRay, vertices, indices, startIdx, endIdx, identity, flip, toWorld, cull,
                            context.MinDistance, context.MaxDistance, context.Visibility, record.View.transform,
                            null, ref sample);
                    }
                } else {
                    // Fallback for synthetic test batches registered without explicit triangle spans:
                    // test triangles whose document hit point lies inside the tile's own box.
                    TestTriangles(worldRay, vertices, indices, 0, indices.Length, identity, flip, toWorld, cull,
                        context.MinDistance, context.MaxDistance, context.Visibility, record.View.transform,
                        body.Box, ref sample);
                }
                return sample;
            }

            for (int p = 0; p < body.Parts.Length; p++) {
                var part = body.Parts[p];
                if (!IsRendererEligible(part.Renderer, context.CullingMask)) continue;
                var mesh = part.Filter != null ? part.Filter.sharedMesh : null;
                if (mesh == null) continue;
                float limit = Mathf.Min(context.MaxDistance, sample.Distance);
                if (!RayBoundsClipped(worldRay, part.Renderer.bounds, context.MinDistance, limit, out _)) continue;
                var cached = GetCachedMesh(mesh);
                var vertices = cached.Vertices;
                var materials = part.Renderer.sharedMaterials;
                var toWorld = part.Filter.transform.localToWorldMatrix;
                bool identity = toWorld.isIdentity;
                bool flip = !identity && toWorld.determinant < 0f;

                for (int sub = 0; sub < cached.SubmeshIndices.Length; sub++) {
                    var indices = cached.SubmeshIndices[sub];
                    if (indices == null || indices.Length < 3) continue;
                    var mat = materials != null && materials.Length > 0
                        ? materials[Math.Min(sub, materials.Length - 1)]
                        : part.Renderer.sharedMaterial;
                    var cull = StationCellView.MaterialCullMode(mat);
                    TestTriangles(worldRay, vertices, indices, 0, indices.Length, identity, flip, toWorld, cull,
                        context.MinDistance, context.MaxDistance, context.Visibility, record.View.transform,
                        null, ref sample);
                }
            }
            return sample;
        }

        static void TestTriangles(Ray ray, Vector3[] vertices, int[] indices, int startIdx, int endIdx,
            bool identity, bool flipWinding, in Matrix4x4 toWorld, CullMode cull,
            float minDistance, float maxDistance, StationVisibilityRegistry visibility, Transform holder,
            StationBox? boxFilter, ref SurfaceSample sample) {
            for (int t = startIdx; t + 2 < endIdx; t += 3) {
                var a = vertices[indices[t]];
                var b = vertices[indices[flipWinding ? t + 2 : t + 1]];
                var c = vertices[indices[flipWinding ? t + 1 : t + 2]];
                if (!identity) {
                    a = toWorld.MultiplyPoint3x4(a);
                    b = toWorld.MultiplyPoint3x4(b);
                    c = toWorld.MultiplyPoint3x4(c);
                }
                if (!RayTriangle(ray, a, b, c, cull, minDistance, maxDistance, sample.Distance,
                        out var distance, out var normal)) continue;
                var worldPoint = ray.origin + ray.direction * distance;
                if (boxFilter.HasValue) {
                    var doc = StationCoordinates.WorldToDocument(worldPoint);
                    var box = boxFilter.Value;
                    if (doc.x < box.X0 - 1e-3 || doc.x > box.X1 + 1e-3 ||
                        doc.y < box.Y0 - 1e-3 || doc.y > box.Y1 + 1e-3 ||
                        doc.z < box.Z0 - 1e-3 || doc.z > box.Z1 + 1e-3) continue;
                }
                if (visibility != null && !visibility.IsPointKept(StationCameraSpace.ToDocument(worldPoint))) {
                    // Clipped triangle must NOT update `sample.Distance`, so kept faces behind it
                    // in the same mesh or batch remain eligible.
                    continue;
                }
                sample.Found = true;
                sample.Distance = distance;
                sample.WorldPoint = worldPoint;
                sample.WorldNormal = normal;
                sample.LocalPoint = holder != null ? holder.InverseTransformPoint(worldPoint) : Vector3.zero;
            }
        }

        static bool RayTriangle(Ray ray, Vector3 v0, Vector3 v1, Vector3 v2, CullMode cull,
            float minDistance, float maxDistance, float bestDistance, out float distance, out Vector3 normal) {
            distance = 0f;
            normal = Vector3.zero;
            var e1 = v1 - v0;
            var e2 = v2 - v0;
            var pvec = Vector3.Cross(ray.direction, e2);
            var det = Vector3.Dot(e1, pvec);
            const float eps = 1e-7f;
            if (cull == CullMode.Back) {
                if (det <= eps) return false;
            } else if (cull == CullMode.Front) {
                if (det >= -eps) return false;
            } else {
                if (det > -eps && det < eps) return false;
            }
            var invDet = 1f / det;
            var tvec = ray.origin - v0;
            var u = Vector3.Dot(tvec, pvec) * invDet;
            if (u < -1e-5f || u > 1f + 1e-5f) return false;
            var qvec = Vector3.Cross(tvec, e1);
            var v = Vector3.Dot(ray.direction, qvec) * invDet;
            if (v < -1e-5f || u + v > 1f + 1e-5f) return false;
            var t = Vector3.Dot(e2, qvec) * invDet;
            if (t < minDistance || t > maxDistance || t >= bestDistance) return false;
            var faceNormal = Vector3.Cross(e1, e2);
            if (faceNormal.sqrMagnitude <= 1e-12f) return false;
            distance = t;
            normal = (det >= 0f ? faceNormal : -faceNormal).normalized;
            return true;
        }

        static bool IsRendererEligible(MeshRenderer renderer, int cullingMask) =>
            renderer != null && renderer.enabled && renderer.gameObject.activeInHierarchy &&
            ((cullingMask & (1 << renderer.gameObject.layer)) != 0);

        static CachedMesh GetCachedMesh(Mesh mesh) {
            if (meshCache.TryGetValue(mesh, out var cached) && ReferenceEquals(cached.Mesh, mesh)) return cached;
            if (mesh.isReadable) {
                int subCount = Math.Max(1, mesh.subMeshCount);
                var subs = new int[subCount][];
                for (int s = 0; s < subCount; s++) {
                    if (mesh.GetTopology(s) != MeshTopology.Triangles) continue;
                    subs[s] = mesh.GetTriangles(s);
                }
                cached = new CachedMesh {
                    Mesh = mesh,
                    Vertices = mesh.vertices,
                    SubmeshIndices = subs,
                };
            } else {
                BuildBoundsFallbackMesh(mesh.bounds, out var verts, out var tris);
                cached = new CachedMesh {
                    Mesh = mesh,
                    Vertices = verts,
                    SubmeshIndices = new[] { tris },
                };
            }
            meshCache[mesh] = cached;
            return cached;
        }

        static void BuildBoundsFallbackMesh(Bounds bounds, out Vector3[] vertices, out int[] indices) {
            var min = bounds.min;
            var max = bounds.max;
            vertices = new[] {
                new Vector3(min.x, min.y, min.z),
                new Vector3(max.x, min.y, min.z),
                new Vector3(max.x, max.y, min.z),
                new Vector3(min.x, max.y, min.z),
                new Vector3(min.x, min.y, max.z),
                new Vector3(max.x, min.y, max.z),
                new Vector3(max.x, max.y, max.z),
                new Vector3(min.x, max.y, max.z),
            };
            // Outward clockwise winding in Unity's left-handed frame for all 6 faces.
            indices = new[] {
                0, 3, 2, 0, 2, 1, // -Z
                5, 6, 7, 5, 7, 4, // +Z
                4, 7, 3, 4, 3, 0, // -X
                1, 2, 6, 1, 6, 5, // +X
                3, 7, 6, 3, 6, 2, // +Y
                4, 0, 1, 4, 1, 5, // -Y
            };
        }

        static bool PickableRecord(StationViewRecord record, Dictionary<string, StationModuleRecord> modules,
            StationLevelGrid grid, StationVisibilityRegistry visibility) {
            if (visibility == null) return true;
            var bands = StationViewFeature.LevelsOf(record, modules, grid);
            var role = StationViewFeature.RoleOf(record, modules);
            return visibility.DecidePart(role, bands, false, StationVisibilityTarget.NoGroundBand,
                StationViewFeature.IsGradeOwned(record, modules)) != StationDrawMode.Hidden;
        }

        static bool IsSurfaceTile(string type) {
            switch (type) {
                case "sidewalk":
                case "lawn":
                case "tactile":
                case "floor-mark":
                    return true;
                default:
                    return false;
            }
        }

        public static void ApplyLocalCommit(StationWorldView world, StationLocalViewCommit localCommit, StationIndexDelta delta) {
            if (localCommit != null && localCommit.RetiredMeshes.Count > 0) {
                for (int i = 0; i < localCommit.RetiredMeshes.Count; i++) {
                    var mesh = localCommit.RetiredMeshes[i];
                    if (mesh != null) meshCache.Remove(mesh);
                }
            }
            if (index == null || index.World != world || world == null || world.Document == null) return;

            if (delta != null && index.Modules != null) {
                for (int i = 0; i < delta.RemovedModules.Count; i++) {
                    index.Modules.Remove(delta.RemovedModules[i]);
                }
                for (int i = 0; i < delta.ChangedModules.Count; i++) {
                    var m = delta.ChangedModules[i];
                    if (m != null) index.Modules[m.Id] = m;
                }
            }
            index.Grid = StationLevelGrid.FromDocument(world.Document.LevelBase, world.Document.StoreyHeight);

            if (localCommit == null) {
                index.Document = world.Document;
                return;
            }

            HashSet<StationViewRecord> retiredOrUpdated = null;
            for (int i = 0; i < localCommit.RetiredRecords.Count; i++) {
                var rec = localCommit.RetiredRecords[i];
                if (rec != null && !UnpickableRoles.Contains(rec.Role)) {
                    (retiredOrUpdated ??= new HashSet<StationViewRecord>()).Add(rec);
                }
            }
            for (int i = 0; i < localCommit.UpdatedRecords.Count; i++) {
                var rec = localCommit.UpdatedRecords[i];
                if (rec != null && !UnpickableRoles.Contains(rec.Role)) {
                    (retiredOrUpdated ??= new HashSet<StationViewRecord>()).Add(rec);
                }
            }

            bool hasAddedPickable = false;
            for (int i = 0; i < localCommit.AddedRecords.Count; i++) {
                var rec = localCommit.AddedRecords[i];
                if (rec != null && !UnpickableRoles.Contains(rec.Role)) {
                    hasAddedPickable = true;
                    break;
                }
            }

            if (retiredOrUpdated == null && !hasAddedPickable) {
                if (delta != null && delta.ChangedModules.Count > 0 && index.Bodies != null) {
                    for (int i = 0; i < index.Bodies.Length; i++) {
                        var body = index.Bodies[i];
                        if (body?.Module != null && index.Modules.TryGetValue(body.Module.Id, out var updated)) {
                            body.Module = updated;
                        }
                    }
                }
                index.Document = world.Document;
                return;
            }

            var rebuilt = new List<Body>(index.Bodies != null ? index.Bodies.Length + localCommit.AddedRecords.Count : localCommit.AddedRecords.Count);
            if (index.Bodies != null) {
                for (int i = 0; i < index.Bodies.Length; i++) {
                    var body = index.Bodies[i];
                    if (body == null) continue;
                    if (retiredOrUpdated != null && retiredOrUpdated.Contains(body.Record)) continue;
                    if (body.Module != null && index.Modules.TryGetValue(body.Module.Id, out var updated)) {
                        body.Module = updated;
                    }
                    rebuilt.Add(body);
                }
            }
            for (int i = 0; i < localCommit.UpdatedRecords.Count; i++) {
                AppendRecordBodies(localCommit.UpdatedRecords[i], index.Modules, rebuilt);
            }
            for (int i = 0; i < localCommit.AddedRecords.Count; i++) {
                AppendRecordBodies(localCommit.AddedRecords[i], index.Modules, rebuilt);
            }
            index.Bodies = rebuilt.ToArray();
            index.Document = world.Document;
        }

        static void AppendRecordBodies(StationViewRecord record, Dictionary<string, StationModuleRecord> modules, List<Body> bodies) {
            if (record == null || record.View == null) return;
            if (UnpickableRoles.Contains(record.Role)) return;
            if (string.Equals(record.Part, "hidden", StringComparison.Ordinal)) return;

            var parts = CollectRenderParts(record.View);
            if (parts.Length == 0) return;
            bool hasMeshBox = TryMeasureMeshBounds(parts, out var meshBox);

            if (!string.IsNullOrEmpty(record.ModuleId)) {
                if (!modules.TryGetValue(record.ModuleId, out var module)) return;
                bool hasRecordBox = record.HasBounds && !record.Bounds.IsEmpty;
                if (!hasMeshBox && !hasRecordBox) return;
                var box = hasMeshBox && hasRecordBox
                    ? UnionBoxes(PadBox(record.Bounds), meshBox)
                    : hasMeshBox ? meshBox : PadBox(record.Bounds);
                bodies.Add(new Body {
                    Module = module,
                    Record = record,
                    Box = box,
                    Parts = parts,
                    IsBatched = false,
                });
                return;
            }

            if (record.SourceIds == null || record.SourceIds.Length == 0) return;
            var instancedBatch = record.View.GetComponent<StationInstancedSurfaceBatch>();
            var spansBySource = instancedBatch != null ? null : GroupSpansBySource(record.SourceIds.Length, record.SourceSpans);
            for (int i = 0; i < record.SourceIds.Length; i++) {
                var id = record.SourceIds[i];
                if (string.IsNullOrEmpty(id) || !modules.TryGetValue(id, out var module)) continue;
                StationBox box;
                if (record.SourceBounds != null && i < record.SourceBounds.Length) {
                    box = PadBox(record.SourceBounds[i]);
                    if (box.IsEmpty && hasMeshBox) box = meshBox;
                } else if (hasMeshBox) {
                    box = meshBox;
                } else if (record.HasBounds && !record.Bounds.IsEmpty) {
                    box = PadBox(record.Bounds);
                } else {
                    continue;
                }
                if (box.IsEmpty) continue;
                bodies.Add(new Body {
                    Module = module,
                    Record = record,
                    Box = box,
                    Parts = parts,
                    IsBatched = true,
                    BatchSpans = spansBySource != null ? spansBySource[i] : null,
                    InstancedBatch = instancedBatch,
                    InstanceSourceIndex = i,
                });
            }
        }

        static Body[] Bodies(StationWorldView world) {
            if (index != null && index.World == world && ReferenceEquals(index.Document, world.Document)) return index.Bodies;
            var modules = new Dictionary<string, StationModuleRecord>(StringComparer.Ordinal);
            if (world.Document != null) {
                var records = world.Document.Modules;
                for (int i = 0; i < records.Count; i++) {
                    var module = records[i];
                    if (module != null) modules[module.Id] = module;
                }
            }
            var grid = StationLevelGrid.FromDocument(
                world.Document != null ? world.Document.LevelBase : 0,
                world.Document != null ? world.Document.StoreyHeight : StationCoordinates.StoreyHeight);
            var bodies = new List<Body>(world.Records.Count);
            foreach (var record in world.Records) {
                AppendRecordBodies(record, modules, bodies);
            }
            index = new Index { Document = world.Document,
                World = world, Bodies = bodies.ToArray(), Modules = modules, Grid = grid,
            };
            return index.Bodies;
        }

        static RenderPart[] CollectRenderParts(GameObject view) {
            var filters = view.GetComponentsInChildren<MeshFilter>(true);
            if (filters == null || filters.Length == 0) return Array.Empty<RenderPart>();
            var list = new List<RenderPart>(filters.Length);
            for (int i = 0; i < filters.Length; i++) {
                var filter = filters[i];
                if (filter == null || filter.sharedMesh == null) continue;
                var renderer = filter.GetComponent<MeshRenderer>();
                if (renderer == null) continue;
                list.Add(new RenderPart(filter, renderer));
            }
            return list.ToArray();
        }

        static StationBatchSpan[][] GroupSpansBySource(int sourceCount, StationBatchSpan[] spans) {
            if (spans == null || spans.Length == 0 || sourceCount <= 0) return null;
            var buckets = new List<StationBatchSpan>[sourceCount];
            for (int i = 0; i < spans.Length; i++) {
                var span = spans[i];
                if (span.SourceIndex < 0 || span.SourceIndex >= sourceCount || span.TriangleCount <= 0) continue;
                var list = buckets[span.SourceIndex];
                if (list == null) buckets[span.SourceIndex] = list = new List<StationBatchSpan>(2);
                list.Add(span);
            }
            var result = new StationBatchSpan[sourceCount][];
            for (int i = 0; i < sourceCount; i++) {
                if (buckets[i] != null) result[i] = buckets[i].ToArray();
            }
            return result;
        }

        /// <summary>
        /// Measure render-mesh bounds into document axes independently of current
        /// <c>Renderer.enabled</c> or <c>activeInHierarchy</c> state.
        /// </summary>
        static bool TryMeasureMeshBounds(RenderPart[] parts, out StationBox box) {
            box = default;
            if (parts == null || parts.Length == 0) return false;
            bool any = false;
            double minX = double.PositiveInfinity, minY = double.PositiveInfinity, minZ = double.PositiveInfinity;
            double maxX = double.NegativeInfinity, maxY = double.NegativeInfinity, maxZ = double.NegativeInfinity;
            for (int p = 0; p < parts.Length; p++) {
                var filter = parts[p].Filter;
                if (filter == null || filter.sharedMesh == null) continue;
                var local = filter.sharedMesh.bounds;
                var matrix = filter.transform.localToWorldMatrix;
                var lo = local.min;
                var hi = local.max;
                for (int cx = 0; cx < 2; cx++) {
                    float x = cx == 0 ? lo.x : hi.x;
                    for (int cy = 0; cy < 2; cy++) {
                        float y = cy == 0 ? lo.y : hi.y;
                        for (int cz = 0; cz < 2; cz++) {
                            float z = cz == 0 ? lo.z : hi.z;
                            var worldPt = matrix.MultiplyPoint3x4(new Vector3(x, y, z));
                            var docPt = StationCoordinates.WorldToDocument(worldPt);
                            if (docPt.x < minX) minX = docPt.x;
                            if (docPt.y < minY) minY = docPt.y;
                            if (docPt.z < minZ) minZ = docPt.z;
                            if (docPt.x > maxX) maxX = docPt.x;
                            if (docPt.y > maxY) maxY = docPt.y;
                            if (docPt.z > maxZ) maxZ = docPt.z;
                            any = true;
                        }
                    }
                }
            }
            if (!any) return false;
            const double Pad = 2e-3;
            box = new StationBox(minX - Pad, minY - Pad, minZ - Pad, maxX + Pad, maxY + Pad, maxZ + Pad);
            return true;
        }

        static StationBox PadBox(StationBox box) {
            const double Pad = 2e-3;
            if (double.IsNaN(box.X0) || double.IsInfinity(box.X0)) return box;
            if (box.X1 < box.X0 || box.Y1 < box.Y0 || box.Z1 < box.Z0) return box;
            return new StationBox(
                box.X0 - Pad, box.Y0 - Pad, box.Z0 - Pad,
                box.X1 + Pad, box.Y1 + Pad, box.Z1 + Pad);
        }

        static StationBox UnionBoxes(StationBox a, StationBox b) =>
            new StationBox(
                Math.Min(a.X0, b.X0), Math.Min(a.Y0, b.Y0), Math.Min(a.Z0, b.Z0),
                Math.Max(a.X1, b.X1), Math.Max(a.Y1, b.Y1), Math.Max(a.Z1, b.Z1));

        static bool RayBoundsClipped(Ray ray, Bounds bounds, float minDistance, float maxDistance, out float entry) {
            entry = 0f;
            float tmin = minDistance;
            float tmax = maxDistance;
            for (int axis = 0; axis < 3; axis++) {
                float origin = ray.origin[axis], direction = ray.direction[axis];
                float lo = bounds.min[axis] - 1e-4f, hi = bounds.max[axis] + 1e-4f;
                if (Mathf.Abs(direction) < 1e-8f) {
                    if (origin < lo || origin > hi) return false;
                    continue;
                }
                float t1 = (lo - origin) / direction, t2 = (hi - origin) / direction;
                if (t1 > t2) { var swap = t1; t1 = t2; t2 = swap; }
                if (t1 > tmin) tmin = t1;
                if (t2 < tmax) tmax = t2;
                if (tmin > tmax) return false;
            }
            entry = tmin;
            return tmax >= minDistance;
        }

        static bool RayBoxInterval(Vector3 origin, Vector3 direction, StationBox box, float minDistance, float maxDistance) {
            if (box.IsEmpty) return false;
            float tmin = minDistance;
            float tmax = maxDistance;
            if (!Slab(origin.x, direction.x, box.X0, box.X1, ref tmin, ref tmax)) return false;
            if (!Slab(origin.y, direction.y, box.Y0, box.Y1, ref tmin, ref tmax)) return false;
            if (!Slab(origin.z, direction.z, box.Z0, box.Z1, ref tmin, ref tmax)) return false;
            return tmax >= minDistance;
        }

        static bool Slab(float origin, float direction, double min, double max, ref float tmin, ref float tmax) {
            if (Math.Abs(direction) < 1e-6f) return origin >= min && origin <= max;
            float inverse = 1f / direction;
            float t1 = (float)((min - origin) * inverse);
            float t2 = (float)((max - origin) * inverse);
            if (t1 > t2) { var swap = t1; t1 = t2; t2 = swap; }
            if (t1 > tmin) tmin = t1;
            if (t2 < tmax) tmax = t2;
            return tmin <= tmax;
        }
    }
}
