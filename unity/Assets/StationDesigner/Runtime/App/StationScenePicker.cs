using System;
using System.Collections.Generic;
using Metro.App.Views;
using Metro.Build;
using Metro.View;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// One pointer event's scene hit, in document axes. It is resolved **once** per
    /// event (plan 16 §1.2 / repo rule) and then handed unchanged to the tool, the
    /// candidate resolver, the ghost and the commit, so preview and release can never
    /// read two different surfaces.
    /// </summary>
    public sealed class StationSceneHit {
        /// <summary>The whole-cell placement hit (port of `render/pickCell.ts`).</summary>
        public StationPlacementHit Cell;
        /// <summary>The placed module whose drawn geometry the ray met, or null.</summary>
        public StationModuleRecord Module;
        public StationViewRecord Record;
        /// <summary>The document-space hit point (metres).</summary>
        public StationPoint Point;
        /// <summary>
        /// The **drawn surface** the module ray met, in document axes (18 §9). The module's
        /// document bounds are only a shortlist: the winner is the nearest renderer surface,
        /// so a plate on a wall, a hung TV and a gate's cabinet each answer for themselves
        /// instead of the whole module's box taking the click.
        /// </summary>
        public StationPoint ModulePoint;
        /// <summary>The surface normal at <see cref="ModulePoint"/> (document axes).</summary>
        public StationPoint ModuleNormal;
        /// <summary>The same surface point in the module holder's local axes (x along, y up, z across).</summary>
        public Vector3 ModuleLocal;
        /// <summary>True when a real renderer surface was met; false when only the module bounds were.</summary>
        public bool ModuleExact;
        /// <summary>The ray distance to the module body, or +inf when only a cell was hit.</summary>
        public float ModuleDistance = float.PositiveInfinity;
        /// <summary>The ray distance to the drawn cell surface, or +inf when none was hit.</summary>
        public float CellDistance = float.PositiveInfinity;
        public bool HasModule => Module != null;
        public bool HasCell => Cell.HasCell;
        /// <summary>The storey the pointer resolved on (the tool's editing level).</summary>
        public int Level;

        public override string ToString() =>
            (HasCell ? "cell " + Cell.X + "," + Cell.Y + "," + Cell.Z : "no cell") +
            (HasModule ? " module " + Module.Id + " " + Module.Type : "");
    }

    /// <summary>
    /// The scene picker (plan 16 §1.2): one camera ray per event, the analytic cell
    /// surface from <see cref="StationCellRenderer.TryPickActive"/>, and the nearest
    /// drawn module body from the world's pick records.
    ///
    /// Module bodies are indexed once per committed world. A record that registered its
    /// document bounds is read directly; a family that did not (the outdoor and opening
    /// builders register none) is measured from the renderers it built, converted to
    /// document axes here. The index is dropped with the world it was built for, so an
    /// edit commit can never pick against stale geometry.
    /// </summary>
    public static class StationScenePicker {
        /// <summary>Roles that are presentation only and must never take a pick.</summary>
        static readonly HashSet<string> UnpickableRoles = new HashSet<string>(StringComparer.Ordinal) {
            "cells", "grid", "overlay", "actors", "trains", "preview", "roads", "road-vehicles",
        };

        sealed class Body {
            public StationModuleRecord Module;
            public StationViewRecord Record;
            public StationBox Box;
        }

        sealed class Index {
            public StationWorldView World;
            public Body[] Bodies;
            public Dictionary<string, StationModuleRecord> Modules;
            public StationLevelGrid Grid;
        }

        static Index index;

        /// <summary>Drop the cached body index (a station install replaced the world).</summary>
        public static void Reset() => index = null;

        /// <summary>
        /// Resolve one hit. `camera` is the rendered camera; `screen` is in pixels from
        /// the bottom-left (Unity's own convention) and is clamped to the viewport.
        /// </summary>
        public static StationSceneHit Pick(StationWorldView world, Camera camera, Vector2 screen, int level) {
            if (camera == null) return new StationSceneHit { Level = level };
            return PickRay(world, camera.ScreenPointToRay(screen), level);
        }

        /// <summary>
        /// Resolve one **ray** (the single ray a pointer event already produced). The
        /// camera overload is this plus `ScreenPointToRay`; a test can cast a known ray
        /// without a screen and prove the same body index and visibility rule.
        /// </summary>
        public static StationSceneHit PickRay(StationWorldView world, Ray ray, int level,
            StationVisibilityRegistry visibility = null) {
            visibility = visibility != null ? visibility : StationViewFeature.Active?.Visibility;
            var hit = new StationSceneHit { Level = level };
            // 1. The drawn cell surface: the same analytic triangle pick the paint brush
            // reads, so a block hit and a painted face are one answer.
            if (StationCellRenderer.TryPickActive(ray, out var cellHit)) {
                StationFaces.Step(cellHit.Face, out var dx, out var dy, out var dz);
                var point = StationCoordinates.WorldToDocument(cellHit.Point);
                hit.Cell = StationPlacementHit.FromSurface(
                    new StationPoint(point.x, point.y, point.z), dx, dy, dz, true);
                hit.CellDistance = cellHit.Distance;
                hit.Point = new StationPoint(point.x, point.y, point.z);
            } else {
                // 2. Empty space: the editing storey's work plane (`pick`'s fallback).
                // The plane is the level's floor top; its cell and placement cell are
                // the same block, and the hit is explicitly **not** a solid surface.
                var planeY = StationCoordinates.Floor(level);
                var plane = new Plane(Vector3.up, new Vector3(0f, planeY, 0f));
                if (plane.Raycast(ray, out var distance) && distance > 0f && distance < 5000f) {
                    var worldPoint = ray.origin + ray.direction * distance;
                    var document = StationCoordinates.WorldToDocument(worldPoint);
                    int x = Mathf.FloorToInt(document.x), y = Mathf.FloorToInt(document.y);
                    hit.Cell = new StationPlacementHit(x, y, level, x, y, level, false,
                        new StationPoint(document.x, document.y, level + 1), level + 1);
                    hit.Point = new StationPoint(document.x, document.y, level + 1);
                }
            }
            // 3. The drawn module body, at the same ray. Bodies are filtered by the
            // view's own visibility/section rule, so a hidden storey cannot be picked
            // through — never by a hard-coded level offset.
            var module = PickModule(world, ray, level, visibility);
            if (module.HasValue) {
                var found = module.Value;
                hit.Module = found.Module;
                hit.Record = found.Record;
                hit.ModuleDistance = found.Distance;
                hit.ModulePoint = new StationPoint(found.Point.x, found.Point.y, found.Point.z);
                hit.ModuleNormal = new StationPoint(found.Normal.x, found.Normal.y, found.Normal.z);
                hit.ModuleLocal = found.Local;
                hit.ModuleExact = found.Exact;
                if (!hit.HasCell) {
                    var anchor = new StationPoint(found.Module.X + 0.5, found.Module.Y + 0.5,
                        found.Module.Z + 1);
                    int x = found.Module.X, y = found.Module.Y, z = found.Module.Z;
                    hit.Cell = new StationPlacementHit(x, y, z, x, y, z, false, anchor, z + 1);
                    hit.Point = anchor;
                }
            }
            return hit;
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

        /// <summary>One renderer surface a shortlisted body offers under the ray.</summary>
        struct SurfaceSample {
            public bool Found;
            public float Distance;
            public Vector3 WorldPoint;
            public Vector3 WorldNormal;
            public Vector3 LocalPoint;
        }

        static SurfaceSample Surface(Body body, Ray worldRay) {
            var sample = new SurfaceSample { Distance = float.MaxValue };
            var record = body.Record;
            if (record?.View == null) return sample;
            foreach (var renderer in record.View.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer || !renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                var bounds = renderer.bounds;
                if (!RayBounds(worldRay, bounds, out float distance)) continue;
                if (distance <= 1e-4f || distance >= sample.Distance) continue;
                var point = worldRay.origin + worldRay.direction.normalized * distance;
                sample.Found = true;
                sample.Distance = distance;
                sample.WorldPoint = point;
                sample.WorldNormal = FaceNormal(point, bounds);
                sample.LocalPoint = record.View.transform.InverseTransformPoint(point);
            }
            return sample;
        }

        /// <summary>The ray's entry distance into one world-space box (`tmin ≥ 0`).</summary>
        static bool RayBounds(Ray ray, Bounds bounds, out float distance) {
            distance = 0f;
            float tmin = 0f, tmax = float.MaxValue;
            for (int axis = 0; axis < 3; axis++) {
                float origin = ray.origin[axis], direction = ray.direction[axis];
                float lo = bounds.min[axis], hi = bounds.max[axis];
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
            distance = tmin;
            return tmax >= 0f;
        }

        /// <summary>The box face a point lies on, as an outward world normal.</summary>
        static Vector3 FaceNormal(Vector3 point, Bounds bounds) {
            var normal = Vector3.zero;
            float best = float.MaxValue;
            for (int axis = 0; axis < 3; axis++) {
                float low = Mathf.Abs(point[axis] - bounds.min[axis]);
                if (low < best) {
                    best = low;
                    normal = Vector3.zero;
                    normal[axis] = -1f;
                }
                float high = Mathf.Abs(point[axis] - bounds.max[axis]);
                if (high < best) {
                    best = high;
                    normal = Vector3.zero;
                    normal[axis] = 1f;
                }
            }
            return normal;
        }

        static ModuleHit? PickModule(StationWorldView world, Ray worldRay, int level,
            StationVisibilityRegistry visibility) {
            if (world == null || !world.IsBuilt) return null;
            var bodies = Bodies(world);
            if (bodies.Length == 0) return null;
            var modules = index.Modules;
            var grid = index.Grid;
            // The ray is converted once into document axes; every body box lives there.
            var origin = StationCoordinates.WorldToDocument(worldRay.origin);
            var direction = StationCoordinates.WorldToDocumentDirection(worldRay.direction);
            float best = float.MaxValue;
            float bestSurface = float.MaxValue;
            Body bestBody = null;
            Body bestSurfaceBody = null;
            SurfaceSample bestSample = default;
            for (int i = 0; i < bodies.Length; i++) {
                var body = bodies[i];
                var record = body.Record;
                if (record.View == null || !record.View.activeInHierarchy) continue;
                if (!PickableRecord(record, modules, grid, level, visibility)) continue;
                // The module's document bounds are only the shortlist: a body whose box the ray
                // misses cannot be hit, and one it meets is measured against its own renderers.
                if (!RayBox(origin, direction, body.Box, out var boxDistance)) continue;
                // A combined batch's one mesh draws many authored tiles; its renderer surfaces
                // cannot be attributed to a single tile, so the tile's own box stays the record
                // of where the ray met it (18 §9 names this as the remaining batch gap).
                bool batched = record.SourceIds != null && record.SourceIds.Length > 0;
                var sample = batched ? default : Surface(body, worldRay);
                // A single-module body whose own renderers the ray misses is not a hit, however
                // large its document bounds are: the bounds were only ever the shortlist.
                if (!batched && !sample.Found) continue;
                float distance = sample.Found ? sample.Distance : boxDistance;
                var point = sample.Found ? sample.WorldPoint : origin + direction * boxDistance;
                if (visibility != null && visibility.SectionClipping) {
                    var documentPoint = sample.Found ? StationCoordinates.WorldToDocument(point) : point;
                    if (!visibility.Section.Keeps(documentPoint)) continue;
                }
                if (IsSurfaceTile(body.Module.Type)) {
                    if (distance >= bestSurface) continue;
                    bestSurface = distance;
                    bestSurfaceBody = body;
                    bestSample = sample;
                    continue;
                }
                if (distance >= best) continue;
                best = distance;
                bestBody = body;
                bestSample = sample;
            }
            if (bestBody == null) {
                bestBody = bestSurfaceBody;
                best = bestSurface;
            } else if (bestSurfaceBody != null && bestSurface < best - SurfaceForgivenessMetres) {
                // A paving tile clearly in front of the prop still wins the ray.
                bestBody = bestSurfaceBody;
                best = bestSurface;
            }
            if (bestBody == null) return null;
            if (!bestSample.Found) {
                // The box was met but no renderer surface was: report the box entry, flagged
                // as inexact so a caller can tell "the module's bounds" from "its geometry".
                var entry = origin + direction * best;
                var local = bestBody.Record.View != null
                    ? bestBody.Record.View.transform.InverseTransformPoint(worldRay.origin + worldRay.direction * best)
                    : Vector3.zero;
                return new ModuleHit(bestBody.Module, bestBody.Record, best, entry,
                    StationCoordinates.WorldToDocumentDirection(-worldRay.direction).normalized, local, false);
            }
            return new ModuleHit(bestBody.Module, bestBody.Record, bestSample.Distance,
                StationCoordinates.WorldToDocument(bestSample.WorldPoint),
                StationCoordinates.WorldToDocumentDirection(bestSample.WorldNormal).normalized,
                bestSample.LocalPoint, true);
        }

        /// <summary>
        /// The registered view rule for one record: the mesh's role and storey membership
        /// through <see cref="StationVisibilityRegistry.DecidePart"/>, the same answer the
        /// geometry, the crowd and the section use. The old hard-coded `LevelMin &lt;= level + 2`
        /// guessed a cutaway offset and picked through hidden storeys. A headless probe
        /// with no view rig keeps the documented two-storey cutaway bound.
        /// </summary>
        static bool PickableRecord(StationViewRecord record, Dictionary<string, StationModuleRecord> modules,
            StationLevelGrid grid, int level, StationVisibilityRegistry visibility) {
            if (visibility == null) return record.LevelMin <= level + 2;
            var bands = StationViewFeature.LevelsOf(record, modules, grid);
            var role = StationViewFeature.RoleOf(record, modules);
            // 20 §4: the pick answers the same grade rule the geometry does, so a prop that Hide
            // Ground removed cannot still be clicked through the hole it left.
            return visibility.DecidePart(role, bands, false, StationVisibilityTarget.NoGroundBand,
                StationViewFeature.IsGradeOwned(record, modules)) != StationDrawMode.Hidden;
        }

        /// <summary>
        /// A flat paving/ground tile is the **floor a prop stands on**, not a rival body.
        /// A bench's own box starts a metre inside the tile's cell, so a raw AABB race
        /// would hand every click at a bench to the sidewalk slab behind it. A prop that
        /// is not clearly behind the paving (the same two metres the cell comparison
        /// forgives) wins; two props still compare strictly by distance.
        /// </summary>
        const float SurfaceForgivenessMetres = 2f;

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

        static Body[] Bodies(StationWorldView world) {
            if (index != null && index.World == world) return index.Bodies;
            var modules = new Dictionary<string, StationModuleRecord>(StringComparer.Ordinal);
            if (world.Document != null) {
                var records = world.Document.Modules;
                for (int i = 0; i < records.Count; i++) {
                    var module = records[i];
                    if (module != null) modules[module.Id] = module;
                }
            }
            var grid = StationLevelGrid.FromDocument(world.Document != null ? world.Document.LevelBase : 0,
                world.Document != null ? world.Document.StoreyHeight : StationCoordinates.StoreyHeight);
            var bodies = new List<Body>(world.Records.Count);
            foreach (var record in world.Records) {
                if (record.View == null) continue;
                if (UnpickableRoles.Contains(record.Role)) continue;
                if (!string.IsNullOrEmpty(record.ModuleId)) {
                    if (!modules.TryGetValue(record.ModuleId, out var module)) continue;
                    StationBox box;
                    if (record.HasBounds && !record.Bounds.IsEmpty) {
                        box = record.Bounds;
                    } else if (!TryMeasure(record.View, out box)) {
                        continue;
                    }
                    bodies.Add(new Body { Module = module, Record = record, Box = box });
                    continue;
                }
                // A combined surface batch has no authored module id of its own. Its
                // per-module contributions are the pickable bodies, each with the tile's
                // own box — so the winning hit is the authored tile, not the chunk.
                if (record.SourceIds == null || record.SourceIds.Length == 0) continue;
                for (int i = 0; i < record.SourceIds.Length; i++) {
                    var id = record.SourceIds[i];
                    if (string.IsNullOrEmpty(id) || !modules.TryGetValue(id, out var module)) continue;
                    StationBox box;
                    if (record.SourceBounds != null && i < record.SourceBounds.Length &&
                        !record.SourceBounds[i].IsEmpty) {
                        box = record.SourceBounds[i];
                    } else if (record.HasBounds && !record.Bounds.IsEmpty) {
                        box = record.Bounds;
                    } else if (!TryMeasure(record.View, out box)) {
                        continue;
                    }
                    bodies.Add(new Body { Module = module, Record = record, Box = box });
                }
            }
            index = new Index {
                World = world, Bodies = bodies.ToArray(), Modules = modules, Grid = grid,
            };
            return index.Bodies;
        }

        /// <summary>Measure a built view's renderers into document-axis bounds.</summary>
        static bool TryMeasure(GameObject view, out StationBox box) {
            box = default;
            var renderers = view.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return false;
            bool any = false;
            var bounds = new Bounds();
            foreach (var renderer in renderers) {
                if (renderer == null || !renderer.enabled) continue;
                if (!any) { bounds = renderer.bounds; any = true; }
                else bounds.Encapsulate(renderer.bounds);
            }
            if (!any) return false;
            var min = StationCoordinates.WorldToDocument(bounds.min);
            var max = StationCoordinates.WorldToDocument(bounds.max);
            box = new StationBox(
                Math.Min(min.x, max.x), Math.Min(min.y, max.y), Math.Min(min.z, max.z),
                Math.Max(min.x, max.x), Math.Max(min.y, max.y), Math.Max(min.z, max.z));
            return true;
        }

        /// <summary>Ray/axis-aligned-box entry distance in document space (slab test).</summary>
        static bool RayBox(Vector3 origin, Vector3 direction, StationBox box, out float distance) {
            distance = 0f;
            if (box.IsEmpty) return false;
            float tmin = 0f, tmax = float.MaxValue;
            if (!Slab(origin.x, direction.x, box.X0, box.X1, ref tmin, ref tmax)) return false;
            if (!Slab(origin.y, direction.y, box.Y0, box.Y1, ref tmin, ref tmax)) return false;
            if (!Slab(origin.z, direction.z, box.Z0, box.Z1, ref tmin, ref tmax)) return false;
            distance = tmin;
            return true;
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
