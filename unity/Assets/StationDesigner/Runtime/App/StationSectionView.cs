using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// The 剖切 surface the player sees and grabs: its border and
    /// 2 m hatch, the grab handle and the direction arrow, ported from
    /// <c>render/scene/systems/SectionSystem.ts</c>. It owns the drawing only; the plane
    /// arithmetic is <see cref="StationSectionPlane"/> and the clip application belongs to
    /// <see cref="StationVisibilityRegistry"/>, so 隐藏剖切面 can put the sheet away while
    /// the cut keeps cutting.
    /// </summary>
    public sealed class StationSectionView : MonoBehaviour {
        const float Lift = .02f;
        const float MinSize = 6f;
        const float GridPitch = 2f;
        const float ArrowMin = 3f;
        const float HeadShare = .4f;
        /// <summary>`resizeArrow`'s shaft radius as a share of the arrow's length.</summary>
        const float ShaftRadiusShare = .022f;
        /// <summary>`resizeArrow`'s head radius as a share of the arrow's length.</summary>
        const float HeadRadiusShare = .09f;
        /// <summary>How far off the drawn mark a pointer may be and still grab it, metres.</summary>
        public const float ControlToleranceMetres = .22f;
        /// <summary>The reference arrow colour, `#2fd06a`.</summary>
        public static readonly Color ArrowColour = new Color(0x2f / 255f, 0xd0 / 255f, 0x6a / 255f, 1f);

        public Camera viewCamera;

        StationSectionPlane section = StationSectionPlane.Default;
        bool clipping;
        bool surfaceVisible = true;
        Bounds stationBounds = new Bounds(Vector3.zero, Vector3.one * 40f);
        float size = MinSize;
        float arrowLength;

        GameObject group;
        MeshRenderer hatch;
        MeshRenderer handle;
        Transform arrowShaft;
        Transform arrowHead;
        Material lineMaterial;
        Material handleMaterial;
        Material arrowMaterial;
        bool built;
        bool hovered;

        public bool Clipping => clipping;
        public bool SurfaceVisible => surfaceVisible;
        public bool GroupVisible => group && group.activeSelf;
        public bool SheetVisible => hatch && hatch.enabled;
        public float Size => size;
        /// <summary>The cut this view draws (its anchor, quarter turn and offset).</summary>
        public StationSectionPlane Plane => section;
        /// <summary>The station bounds the sheet is sized from (the drag's axis origin).</summary>
        public Bounds Bounds => stationBounds;

        /// <summary>Bind the live camera and the view rules that decide what clips.</summary>
        public void Bind(Camera camera, StationVisibilityRegistry visibility) {
            viewCamera = camera;
            EnsureBuilt();
        }

        /// <summary>One state write from the command applier; cheap unless the size moved.</summary>
        public void Apply(StationSectionPlane next, bool cutting, bool showSurface, Bounds bounds) {
            EnsureBuilt();
            section = next;
            clipping = cutting;
            surfaceVisible = showSurface;
            if (bounds.size.sqrMagnitude > 1e-6f) stationBounds = bounds;
            Refresh();
        }

        void Refresh() {
            if (!group) return;
            float nextSize = Mathf.Max(MinSize, stationBounds.size.magnitude * .6f);
            if (Mathf.Abs(nextSize - size) > 1e-3f) {
                size = nextSize;
                RebuildHatch();
                ResizeArrow();
            }
            var normal = StationCameraSpace.ToWorld(section.Normal);
            var up = StationCameraSpace.ToWorld(section.Up);
            var point = StationCameraSpace.ToWorld(section.Point);
            group.transform.position = point;
            group.transform.rotation = Quaternion.LookRotation(normal, up);
            group.SetActive(clipping);
            bool drawSurface = clipping && surfaceVisible;
            hatch.enabled = drawSurface;
            handle.enabled = drawSurface;
            if (arrowShaft) arrowShaft.gameObject.SetActive(drawSurface);
            if (arrowHead) arrowHead.gameObject.SetActive(drawSurface);
        }

        void EnsureBuilt() {
            if (built) return;
            built = true;
            var shader = Shader.Find("Universal Render Pipeline/Unlit") ??
                Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");
            if (shader == null) {
                // A headless/stripped player has no section shader; the cut still runs
                // through the visibility walk and picking, only this drawing is absent.
                return;
            }
            lineMaterial = Transparent(shader, new Color(.56f, .89f, 1f), .75f);
            handleMaterial = Transparent(shader, new Color(.75f, .94f, 1f), .85f);
            // `render/scene/systems/SectionSystem.ts`: the direction arrow is a statement about
            // the station's fate, so it is opaque green and drawn **over** everything — half
            // buried in a slab it would say nothing (20 §6).
            arrowMaterial = Overlay(Shader.Find("Metro/Station Section Unlit") ?? shader, ArrowColour, 1f);

            group = new GameObject("Section surface");
            group.transform.SetParent(null, false);

            hatch = MeshObject("Section hatch", null, lineMaterial);
            hatch.transform.SetParent(group.transform, false);
            hatch.transform.localPosition = Vector3.forward * Lift;
            RebuildHatch();

            handle = MeshObject("Section handle", SphereMesh(.16f, 12, 8), handleMaterial);
            handle.transform.SetParent(group.transform, false);
            handle.transform.localPosition = Vector3.zero;

            // One unit cylinder and one unit cone, scaled by `ResizeArrow`: the source builds the
            // mark once and then gives it the station's size (`SectionSystem.buildArrow`).
            arrowShaft = MeshObject("Section arrow shaft", CylinderMesh(12), arrowMaterial).transform;
            arrowShaft.SetParent(group.transform, false);
            arrowHead = MeshObject("Section arrow head", ConeMesh(20), arrowMaterial).transform;
            arrowHead.SetParent(group.transform, false);
            arrowShaft.GetComponent<MeshRenderer>().shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            arrowHead.GetComponent<MeshRenderer>().shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            ResizeArrow();
            group.SetActive(false);
        }

        /// <summary>
        /// The pointer's ray against the drawn sheet: only while the sheet is on screen
        /// (`hit` in the source), so 隐藏剖切面 gives the pointer back to the tools.
        /// </summary>
        public bool TryHit(Ray ray, out Vector3 documentPoint) {
            documentPoint = Vector3.zero;
            if (!clipping || !surfaceVisible) return false;
            if (!TryRayPoint(ray, out documentPoint)) return false;
            var delta = documentPoint - section.Point;
            float right = Vector3.Dot(delta, section.Right);
            float up = Vector3.Dot(delta, section.Up);
            return Mathf.Abs(right) <= size && Mathf.Abs(up) <= size;
        }

        /// <summary>The ray against the section's own plane, in document space.</summary>
        public bool TryRayPoint(Ray ray, out Vector3 documentPoint) {
            documentPoint = Vector3.zero;
            var normal = StationCameraSpace.ToWorld(section.Normal);
            var point = StationCameraSpace.ToWorld(section.Point);
            var plane = new Plane(normal, point);
            if (!plane.Raycast(ray, out float enter)) return false;
            documentPoint = StationCameraSpace.ToDocument(ray.GetPoint(enter));
            return true;
        }

        /// <summary>The slide a drag asks for, from the grab point to the current hit.</summary>
        public float SlideOffset(Vector3 fromDocument, Vector3 hitDocument) => section.SlideOffset(fromDocument, hitDocument);

        public void SetHover(bool on) {
            if (hovered == on) return;
            hovered = on;
            SetColor(lineMaterial, new Color(.56f, .89f, 1f, on ? 1f : .75f));
            SetColor(handleMaterial, new Color(.75f, .94f, 1f, on ? 1f : .85f));
        }

        static void SetColor(Material material, Color colour) {
            if (!material) return;
            if (material.HasProperty("_Color")) material.SetColor("_Color", colour);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", colour);
        }

        void RebuildHatch() {
            if (!hatch) return;
            float half = size;
            var points = new System.Collections.Generic.List<Vector3>();
            void Line(float ax, float ay, float bx, float by) {
                points.Add(new Vector3(ax * half, ay * half, 0f));
                points.Add(new Vector3(bx * half, by * half, 0f));
            }
            Line(-1, -1, 1, -1);
            Line(1, -1, 1, 1);
            Line(1, 1, -1, 1);
            Line(-1, 1, -1, -1);
            int steps = Mathf.CeilToInt(half / GridPitch);
            for (int i = -steps; i <= steps; i++) {
                float v = (i * GridPitch) / half;
                if (Mathf.Abs(v) > 1f) continue;
                Line(v, -1, v, 1);
                Line(-1, v, 1, v);
            }
            var mesh = new Mesh { name = "Section hatch" };
            mesh.SetVertices(points);
            var indices = new int[points.Count];
            for (int i = 0; i < indices.Length; i++) indices[i] = i;
            mesh.SetIndices(indices, MeshTopology.Lines, 0);
            mesh.RecalculateBounds();
            if (hatch.GetComponent<MeshFilter>()) {
                var filter = hatch.GetComponent<MeshFilter>();
                if (filter.sharedMesh) DestroyNow(filter.sharedMesh);
                filter.sharedMesh = mesh;
            }
        }

        /// <summary>
        /// Lay the arrow out for `length` metres: tail on the section plane, head pointing out
        /// along the kept half, opposite Unity's outward section normal. Ports
        /// `SectionSystem.resizeArrow`: a head `HeadShare` of the length, a shaft `0.022 · length`
        /// in radius and a head `0.09 · length`, so the mark stays a mark at every station size
        /// instead of a fixed-width bar that stretches with the plane (20 §6).
        /// </summary>
        void ResizeArrow() {
            if (!arrowShaft || !arrowHead) return;
            arrowLength = Mathf.Max(ArrowMin, size * .22f);
            float head = arrowLength * HeadShare;
            float shaft = arrowLength - head;
            float shaftRadius = arrowLength * ShaftRadiusShare;
            float headRadius = arrowLength * HeadRadiusShare;
            var reverse = Quaternion.Euler(0f, 180f, 0f);
            arrowShaft.localRotation = reverse;
            arrowHead.localRotation = reverse;
            arrowShaft.localPosition = new Vector3(0f, 0f, -shaft * .5f);
            arrowShaft.localScale = new Vector3(shaftRadius, shaftRadius, Mathf.Max(.001f, shaft));
            arrowHead.localPosition = new Vector3(0f, 0f, -shaft);
            arrowHead.localScale = new Vector3(headRadius, headRadius, Mathf.Max(.001f, head));
        }

        /// <summary>The arrow's own dimensions, for the pick proxy and the verifier.</summary>
        public float ArrowLength => arrowLength;
        public float ArrowHeadLength => arrowLength * HeadShare;
        public float ArrowShaftRadius => arrowLength * ShaftRadiusShare;
        public float ArrowHeadRadius => arrowLength * HeadRadiusShare;
        public Vector3 ArrowPoint(float fraction) => section.Point - section.Normal * (arrowLength * fraction);
        /// <summary>True while the arrow is actually drawn (cutaway on and the sheet shown).</summary>
        public bool ArrowVisible => arrowShaft != null && arrowShaft.gameObject.activeInHierarchy;

        /// <summary>
        /// The pointer's ray against the **arrow's shaft and head**, in the arrow's own frame:
        /// a bounded analytic proxy, so the handle is grabbable where it is drawn instead of
        /// needing a collider (the sheet is the other grab target, <see cref="TryHit"/>). The same
        /// hit answers hover and press (20 §6). Returns the part's name and the ray distance.
        /// </summary>
        public bool TryControlHit(Ray ray, out string part, out float distance) {
            part = "";
            distance = 0f;
            if (!group || !arrowShaft || !arrowHead) return false;
            if (!clipping || !surfaceVisible || !group.activeInHierarchy) return false;
            var toLocal = group.transform.worldToLocalMatrix;
            var origin = toLocal.MultiplyPoint3x4(ray.origin);
            var direction = toLocal.MultiplyVector(ray.direction);
            if (direction.sqrMagnitude < 1e-10f) return false;
            direction.Normalize();
            float shaft = Mathf.Max(.001f, arrowLength - arrowLength * HeadShare);
            // The shaft: a capsule around the tail-to-shoulder segment.
            var shoulder = Vector3.back * shaft;
            if (RaySegment(origin, direction, Vector3.zero, shoulder, out float t,
                    out float separation) && separation <= ArrowShaftRadius + ControlToleranceMetres) {
                part = "arrow-shaft";
                distance = t;
                return true;
            }
            // The head: a cone, approximated by its own segment with a widening radius; the
            // tolerance already covers the difference at the sizes a station produces.
            if (RaySegment(origin, direction, shoulder,
                    Vector3.back * arrowLength, out t, out separation) &&
                separation <= ArrowHeadRadius + ControlToleranceMetres) {
                part = "arrow-head";
                distance = t;
                return true;
            }
            return false;
        }

        /// <summary>
        /// The pointer's ray against the section's own controls — the arrow's shaft and head, or
        /// the sheet — as one hit, so hover and press cannot disagree (20 §6). `documentPoint` is
        /// the sheet hit when `part` is `sheet`; an arrow hit leaves it at the ray's point on the
        /// section plane.
        /// </summary>
        public bool TrySectionControl(Ray ray, out string part, out Vector3 documentPoint, out float distance) {
            part = "";
            documentPoint = Vector3.zero;
            distance = 0f;
            if (TryControlHit(ray, out part, out distance)) {
                TryRayPoint(ray, out documentPoint);
                return true;
            }
            if (!TryHit(ray, out documentPoint)) return false;
            part = "sheet";
            distance = 0f;
            return true;
        }

        /// <summary>Ray/segment closest approach, in the frame both are expressed in.</summary>
        static bool RaySegment(Vector3 origin, Vector3 direction, Vector3 a, Vector3 b, out float distance,
            out float separation) {
            distance = 0f;
            separation = float.MaxValue;
            var segment = b - a;
            float segmentLength = segment.magnitude;
            var along = segmentLength > 1e-6f ? segment / segmentLength : Vector3.forward;
            // Solve the two-parameter closest approach of the ray and the segment's line.
            var w0 = origin - a;
            float dotDir = Vector3.Dot(direction, along);
            float denominator = 1f - dotDir * dotDir;
            float rayT = Vector3.Dot(along, w0) * dotDir - Vector3.Dot(direction, w0);
            float segmentT = Vector3.Dot(along, w0) - dotDir * Vector3.Dot(direction, w0);
            if (Mathf.Abs(denominator) > 1e-6f) {
                rayT /= denominator;
                segmentT /= denominator;
            } else {
                // Parallel: any point on the ray is as close as any other.
                rayT = Mathf.Max(0f, -Vector3.Dot(direction, w0));
                segmentT = 0f;
            }
            rayT = Mathf.Max(0f, rayT);
            segmentT = Mathf.Clamp(segmentT, 0f, segmentLength);
            var rayPoint = origin + direction * rayT;
            var segmentPoint = a + along * segmentT;
            separation = (rayPoint - segmentPoint).magnitude;
            distance = rayT;
            return true;
        }

        static MeshRenderer MeshObject(string name, Mesh mesh, Material material) {
            var obj = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            obj.GetComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = obj.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return renderer;
        }

        static Material Transparent(Shader shader, Color colour, float opacity) {
            var material = new Material(shader) { name = "Section surface" };
            colour.a = opacity;
            SetColor(material, colour);
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_Blend")) material.SetFloat("_Blend", 0f);
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.DisableKeyword("_ALPHATEST_ON");
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            return material;
        }

        /// <summary>
        /// The arrow's **unit** shaft: a cylinder of radius 1 running from local z = 0 to z = 1,
        /// so `ResizeArrow` scales one number into the radius and one into the length
        /// (`SectionSystem.buildArrow`'s unit `CylinderGeometry`).
        /// </summary>
        static Mesh CylinderMesh(int segments) {
            var mesh = new Mesh { name = "Section arrow shaft" };
            var vertices = new System.Collections.Generic.List<Vector3>();
            var triangles = new System.Collections.Generic.List<int>();
            for (int i = 0; i <= segments; i++) {
                float theta = i / (float)segments * Mathf.PI * 2f;
                float x = Mathf.Cos(theta), y = Mathf.Sin(theta);
                vertices.Add(new Vector3(x, y, 0f));
                vertices.Add(new Vector3(x, y, 1f));
            }
            for (int i = 0; i < segments; i++) {
                int a = i * 2, b = a + 1, c = a + 2, d = a + 3;
                triangles.Add(a); triangles.Add(c); triangles.Add(b);
                triangles.Add(b); triangles.Add(c); triangles.Add(d);
            }
            int baseCentre = vertices.Count;
            vertices.Add(Vector3.zero);
            int topCentre = vertices.Count;
            vertices.Add(new Vector3(0f, 0f, 1f));
            for (int i = 0; i < segments; i++) {
                int a = i * 2, c = a + 2;
                triangles.Add(baseCentre); triangles.Add(a); triangles.Add(c);
                triangles.Add(topCentre); triangles.Add(c + 1); triangles.Add(a + 1);
            }
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>
        /// The arrow's **unit** head: a cone of base radius 1 at local z = 0 tapering to a point at
        /// z = 1. A flat-ended shaft would read as a bar, and a bar says nothing about which way
        /// the cut keeps.
        /// </summary>
        static Mesh ConeMesh(int segments) {
            var mesh = new Mesh { name = "Section arrow head" };
            var vertices = new System.Collections.Generic.List<Vector3>();
            var triangles = new System.Collections.Generic.List<int>();
            for (int i = 0; i <= segments; i++) {
                float theta = i / (float)segments * Mathf.PI * 2f;
                vertices.Add(new Vector3(Mathf.Cos(theta), Mathf.Sin(theta), 0f));
            }
            int apex = vertices.Count;
            vertices.Add(new Vector3(0f, 0f, 1f));
            int baseCentre = vertices.Count;
            vertices.Add(Vector3.zero);
            for (int i = 0; i < segments; i++) {
                triangles.Add(i); triangles.Add(i + 1); triangles.Add(apex);
                triangles.Add(baseCentre); triangles.Add(i + 1); triangles.Add(i);
            }
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>
        /// The arrow's material: opaque, **overlay depth**, no depth write — the mark has to read
        /// through the sheet and through a slab it is half buried in, which is the whole point of
        /// saying "this half is what stays" (20 §6).
        /// </summary>
        static Material Overlay(Shader shader, Color colour, float opacity) {
            var material = new Material(shader) { name = "Section arrow" };
            colour.a = opacity;
            SetColor(material, colour);
            if (material.HasProperty("_ZTest")) material.SetFloat("_ZTest", (float)UnityEngine.Rendering.CompareFunction.Always);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            if (material.HasProperty("_Cull")) material.SetFloat("_Cull", (float)UnityEngine.Rendering.CullMode.Off);
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Overlay;
            return material;
        }

        static Mesh SphereMesh(float radius, int segments, int rings) {
            var mesh = new Mesh { name = "Section handle" };
            var vertices = new System.Collections.Generic.List<Vector3>();
            var triangles = new System.Collections.Generic.List<int>();
            for (int ring = 0; ring <= rings; ring++) {
                float v = ring / (float)rings;
                float phi = v * Mathf.PI;
                for (int segment = 0; segment <= segments; segment++) {
                    float u = segment / (float)segments;
                    float theta = u * Mathf.PI * 2f;
                    vertices.Add(new Vector3(
                        radius * Mathf.Sin(phi) * Mathf.Cos(theta),
                        radius * Mathf.Cos(phi),
                        radius * Mathf.Sin(phi) * Mathf.Sin(theta)));
                }
            }
            for (int ring = 0; ring < rings; ring++) {
                for (int segment = 0; segment < segments; segment++) {
                    int a = ring * (segments + 1) + segment;
                    int b = a + segments + 1;
                    triangles.Add(a); triangles.Add(b); triangles.Add(a + 1);
                    triangles.Add(a + 1); triangles.Add(b); triangles.Add(b + 1);
                }
            }
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        void OnDestroy() {
            if (group) DestroyNow(group);
            DestroyMaterial(lineMaterial);
            DestroyMaterial(handleMaterial);
            DestroyMaterial(arrowMaterial);
        }

        static void DestroyMaterial(Material material) {
            if (!material) return;
            if (Application.isPlaying) Destroy(material);
            else DestroyImmediate(material);
        }

        static void DestroyNow(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }

    /// <summary>
    /// One registration point for packet D's runtime: it owns the camera rig, the
    /// visibility registry, the section drawing and the command applier, and publishes
    /// the small `camera`/`view` state fragment A's host puts in a `state` reply.
    ///
    /// The lead's host should:
    /// 1. add this component to the station root and call
    ///    <see cref="Configure(Camera, Bounds, StationLevelGrid, int)"/>;
    /// 2. in its Update call <see cref="Tick(float)"/>;
    /// 3. route <c>camera.*</c> and <c>view.*</c> command JSON to
    ///    <see cref="Execute(string, out string)"/>;
    /// 4. include <see cref="SnapshotJson"/>'s object members in every `state` payload.
    /// </summary>
    public sealed class StationViewRig : MonoBehaviour {
        public Camera viewCamera;
        public StationSectionView sectionView;

        public StationCameraController CameraController { get; private set; }
        public StationVisibilityRegistry Visibility { get; private set; }
        public StationViewCommandApplier Commands { get; private set; }
        public StationSkySystem Sky { get; private set; }
        public StationLevelGrid Grid { get; private set; }
        public Bounds StationBounds { get; private set; }
        public StationSectionPlane Section => Commands?.Section ?? StationSectionPlane.Default;
        public bool SectionSurfaceVisible => Commands?.SectionSurfaceVisible ?? true;
        public bool Configured => Commands != null;

        bool configured;
        bool dirty = true;
        Func<bool, bool> pendingExplodedHandler;
        Func<double> simTimeSource;
        double manualSimTime = StationSkySystem.DefaultSimTime;

        public void SetExplodedHandler(Func<bool, bool> handler) {
            pendingExplodedHandler = handler;
            if (Commands != null) Commands.ExplodedHandler = handler;
        }

        public void SetSimTimeSource(Func<double> source) {
            simTimeSource = source;
            SyncSky();
        }

        public void SetSimTime(double simTime) {
            manualSimTime = simTime;
            SyncSky();
        }

        public void SyncSky(bool force = false) {
            if (!configured || Sky == null || Visibility == null) return;
            var exploded = StationViewFeature.ActiveExploded;
            if (exploded != null && exploded.IsOpen) return;
            var cam = Commands?.ViewCamera != null ? Commands.ViewCamera : viewCamera;
            if (cam == null) return;
            double simTime = simTimeSource != null ? simTimeSource() : manualSimTime;
            Sky.SetSimTime(simTime);
            bool hideUi = Visibility.State.HideUi;
            Sky.Update(cam, hideUi, force: force && hideUi);
        }

        public void Configure(Camera camera, Bounds documentBounds, StationLevelGrid grid, int activeLevel,
            Vector2? sectionPlanCentre = null) {
            viewCamera = camera != null ? camera : viewCamera;
            if (viewCamera != null) {
                viewCamera.cullingMask &= ~(1 << Views.StationExplodedTrayBuilder.ResolvePresentationLayer());
            }
            StationBounds = documentBounds;
            Grid = grid;
            if (!configured) {
                CameraController = new StationCameraController();
                Visibility = new StationVisibilityRegistry(FindStationShader());
                Commands = new StationViewCommandApplier(CameraController, Visibility, grid);
                Sky = new StationSkySystem();
                if (pendingExplodedHandler != null) Commands.ExplodedHandler = pendingExplodedHandler;
                Commands.Changed += MarkDirty;
                CameraController.Changed += MarkDirty;
                if (!sectionView) {
                    sectionView = GetComponentInChildren<StationSectionView>();
                    if (!sectionView) sectionView = gameObject.AddComponent<StationSectionView>();
                }
                sectionView.Bind(viewCamera, Visibility);
                configured = true;
            }
            Commands.ViewCamera = viewCamera;
            Commands.ViewportHeight = Mathf.Max(1, Screen.height);
            if (viewCamera != null) Commands.Camera.SetAspect(viewCamera.aspect);
            Commands.SetStation(documentBounds, grid, activeLevel, sectionPlanCentre);
            Commands.ApplyCamera();
            SyncSky();
            MarkDirty();
        }

        public void SetStation(Bounds documentBounds, StationLevelGrid grid, int activeLevel) {
            StationBounds = documentBounds;
            Grid = grid;
            if (Commands == null) { Configure(viewCamera, documentBounds, grid, activeLevel); return; }
            Commands.SetStation(documentBounds, grid, activeLevel);
            Commands.ApplyCamera();
            SyncSky();
            MarkDirty();
        }

        /// <summary>An edit changed the bounds; orientation/zoom stay where the player left them.</summary>
        public void SetBounds(Bounds documentBounds) {
            StationBounds = documentBounds;
            CameraController?.SetBounds(documentBounds);
            MarkDirty();
        }

        /// <summary>
        /// A later commit of the same source (an edit) keeps the player's view; only the
        /// framing numbers and the level grid move. A station switch calls
        /// <see cref="Configure"/> instead, which homes against the fresh bounds.
        /// </summary>
        public void RefreshStation(Bounds documentBounds, StationLevelGrid grid) {
            StationBounds = documentBounds;
            Grid = grid;
            if (Commands == null) return;
            Commands.Grid = grid;
            Visibility.State.LevelBase = grid.LevelBase;
            Visibility.State.StoreyHeight = grid.StoreyHeight;
            CameraController.SetBounds(documentBounds);
            Visibility.Apply();
            SyncSky();
            MarkDirty();
        }

        public StationVisibilityTarget Register(Transform root, StationPartRole role, int[] levels,
            int groundBand = StationVisibilityTarget.NoGroundBand, bool parked = false, bool floating = false,
            bool contactShadow = false, bool gradeOwned = false) {
            var target = Visibility.Register(root, role, levels, groundBand, parked, floating, contactShadow, gradeOwned);
            MarkDirty();
            return target;
        }

        // The exploded plan now lives on the standalone viewer (`StationExplodedLayoutPlan`), so
        // the section view no longer forwards a per-target plan into the visibility registry.
        // The registry's exploded offsets were the assembled view's mechanism and are gone with
        // it (plan 19 moved the exploded view out of the editor walk).

        public void SetDense(bool dense) {
            if (Visibility != null) Visibility.State.Dense = dense;
        }

        public bool Execute(string json, out string code) {
            if (Commands == null) { code = "no-station"; return false; }
            if (!StationViewCommandParser.TryParse(json, out var command, out string error)) {
                code = "parse-failed:" + error;
                return false;
            }
            float previousAzimuth = Commands.Section.Azimuth;
            if (!Commands.TryApply(command, out code)) return false;
            if (Commands.Section.Azimuth != previousAzimuth) {
                StationSectionDrag.Reset();
                SetSectionHover(false);
                RefreshSection();
            }
            Commands.ApplyCamera();
            SyncSky();
            MarkDirty();
            code = null;
            return true;
        }

        public void Tick(float deltaSeconds) {
            if (!configured || Commands == null) return;
            var exploded = StationViewFeature.ActiveExploded;
            bool explodedOwnsCamera = exploded != null && exploded.IsOpen;
            if (!explodedOwnsCamera) {
                if (Commands.ViewCamera != null) {
                    Commands.ViewportHeight = Mathf.Max(1, Screen.height);
                    Commands.Camera.SetAspect(Commands.ViewCamera.aspect);
                }
                Commands.Tick(deltaSeconds);
                Commands.ApplyCamera();
                SyncSky();
            }
            // The lattice is the active storey's, not the world's: it follows every Q/E step
            // without a rebuild (the source moves its grid group the same way).
            Metro.App.Views.StationGridRenderer.SetLevel(Commands.Camera.ActiveLevel);
            // Plan 13 §5: the overlays follow the same flags the UI toggles; density
            // refreshes a few times a second from the crowd renderer's published poses.
            var overlays = Metro.App.Views.StationOverlayRenderer.Instance;
            if (overlays != null) {
                overlays.SetView(Commands.Zones, Commands.Density, Commands.Camera.ActiveLevel);
                overlays.Tick(deltaSeconds);
            }
            if (!dirty) return;
            dirty = false;
            RefreshSection();
        }

        public string SnapshotJson() => Commands?.SnapshotJson() ?? "{\"camera\":null,\"view\":null}";

        /// <summary>The snapshot as JSON objects, for the host's `camera`/`view` contributors.</summary>
        public JObject SnapshotObject() {
            try { return JObject.Parse(SnapshotJson()); } catch (Exception) { return new JObject(); }
        }

        public bool TrySectionHit(Ray ray, out Vector3 documentPoint) {
            documentPoint = Vector3.zero;
            return sectionView != null && sectionView.TryHit(ray, out documentPoint);
        }

        public bool TrySectionRayPoint(Ray ray, out Vector3 documentPoint) {
            documentPoint = Vector3.zero;
            return sectionView != null && sectionView.TryRayPoint(ray, out documentPoint);
        }

        /// <summary>
        /// A slide the host measures from a pointer drag, writing the cut offset. The 18-era
        /// plane-to-plane helper (two plane hits, one for the grab and one for the move) cannot
        /// express a slide along the cut's own normal — both points lie on the same plane — so a
        /// drag is measured **on screen** along the projected normal instead
        /// (<see cref="StationSectionDrag"/>). This is the single write both the arrow and the
        /// sheet use.
        /// </summary>
        public bool SlideSection(Vector3 fromDocument, Vector3 hitDocument) {
            if (sectionView == null) return false;
            return SetSectionOffset(sectionView.SlideOffset(fromDocument, hitDocument));
        }

        /// <summary>
        /// Write one committed cut offset. One write per pointer move, and the plan is still the
        /// owner: this is a view command, never a document edit, so revision and undo depth are
        /// untouched (20 §6).
        /// </summary>
        public bool SetSectionOffset(float offset) {
            if (sectionView == null || Commands == null) return false;
            if (Mathf.Abs(Commands.Section.Offset - offset) < 1e-4f) return true;
            var command = new StationViewCommand {
                Type = StationViewCommandType.ViewSet,
                Key = StationViewKey.SectionOffset,
                FloatValue = offset,
            };
            if (!Commands.TryApply(command, out _)) return false;
            RefreshSection();
            return true;
        }

        /// <summary>The cut's current offset, for a drag's starting value and the readouts.</summary>
        public float SectionOffset => Commands != null ? Commands.Section.Offset : 0f;

        /// <summary>
        /// The pointer's ray against the section's own controls, delegated to the view so hover
        /// and press can never disagree (20 §6).
        /// </summary>
        public bool TrySectionControl(Ray ray, out string part, out Vector3 documentPoint, out float distance) {
            part = "";
            documentPoint = Vector3.zero;
            distance = 0f;
            return sectionView != null && sectionView.TrySectionControl(ray, out part, out documentPoint, out distance);
        }

        public bool ArrowVisible => sectionView != null && sectionView.ArrowVisible;

        public void SetSectionHover(bool hovered) => sectionView?.SetHover(hovered);

        void MarkDirty() => dirty = true;

        void RefreshSection() {
            if (sectionView == null || Commands == null) return;
            sectionView.Apply(Commands.Section, Visibility.SectionClipping, Commands.SectionSurfaceVisible, StationBounds);
        }

        void Update() {
            if (!configured) return;
            // A stalled frame (a station install, a restored tab) must not become one huge
            // camera step. The source scene clamps its frame delta to 50 ms before the
            // camera systems see it (`SceneRenderer`: `Math.min(0.05, now - lastFrame)`),
            // and the held pans integrate that same number.
            Tick(Mathf.Min(Time.unscaledDeltaTime, 0.05f));
        }

        void OnDestroy() {
            if (Commands != null) Commands.Changed -= MarkDirty;
            if (CameraController != null) CameraController.Changed -= MarkDirty;
            Sky?.Dispose();
            Visibility?.Dispose();
        }

        static Shader FindStationShader() =>
            Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
    }

    /// <summary>
    /// Packet D's process-wide feature registration. A's host owns the scene and the
    /// router; this finds it after the scene loads, adds the one
    /// <see cref="StationViewRig"/> and registers the `camera`/`view` state
    /// contributors and command handlers. No host edit is needed, and a host scene
    /// without this feature stays on A's baseline camera (the fallback `camera`
    /// payload the host publishes).
    /// </summary>
    public static class StationViewFeature {
        static StationViewRig rig;
        static StationExplodedView explodedView;
        static StationGameHost host;
        static string lastSource = "";
        static int lastRevision = -1;

        /// <summary>
        /// The view rig bound to the live host, or null before the scene host exists. A
        /// renderer that draws objects with no world record of their own (pooled road
        /// vehicles) asks it for the one slice decision every other part uses.
        /// </summary>
        public static StationViewRig Active => rig ? rig : null;

        /// <summary>The standalone exploded viewer bound to the live host, or null before attach.</summary>
        public static StationExplodedView ActiveExploded => explodedView ? explodedView : null;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Install() => Attach(UnityEngine.Object.FindAnyObjectByType<StationGameHost>());

        /// <summary>Test/entry point: bind packet D to one host and its committed station.</summary>
        public static StationViewRig Attach(StationGameHost stationHost) {
            if (!stationHost) return null;
            if (host == stationHost && rig) return rig;
            host = stationHost;
            lastSource = "";
            lastRevision = -1;
            rig = stationHost.GetComponent<StationViewRig>() ?? stationHost.gameObject.AddComponent<StationViewRig>();
            explodedView = stationHost.GetComponent<StationExplodedView>() ?? stationHost.gameObject.AddComponent<StationExplodedView>();
            explodedView.Bind(stationHost, rig);
            rig.SetExplodedHandler(explodedView.SetOpenFromLegacyCommand);
            rig.SetSimTimeSource(() => stationHost != null && stationHost.Simulation != null
                ? stationHost.Simulation.SimTimeSeconds
                : StationSkySystem.DefaultSimTime);
            stationHost.RegisterStateContributor(new StationCameraStateContributor(rig));
            stationHost.RegisterStateContributor(new StationViewStateContributor(rig));
            stationHost.RegisterStateContributor(new StationRenderStateContributor());
            stationHost.RegisterStateContributor(new StationExplodedStateContributor(explodedView));
            stationHost.RegisterCommandHandler(new StationCameraCommandHandler(rig, stationHost));
            stationHost.RegisterCommandHandler(new StationViewCommandHandler(rig, stationHost));
            stationHost.RegisterCommandHandler(new StationExplodedCommandHandler(explodedView, rig, stationHost));
            if (stationHost.Coordinator != null) stationHost.Coordinator.Committed += OnCommitted;
            // A scene preloaded with a demo may have committed before this hook runs;
            // adopt that station now instead of waiting for the next open.
            if (stationHost.Document != null) {
                OnCommitted(new StationCommitInfo {
                    Document = stationHost.Document,
                    Index = stationHost.Index,
                    Revision = stationHost.CurrentRevision,
                    SourceId = stationHost.CurrentSourceId,
                    CameraBounds = stationHost.CameraBounds,
                });
            }
            return rig;
        }

        static void OnCommitted(StationCommitInfo info) {
            if (!rig || info?.Document == null) return;
            var grid = StationLevelGrid.FromDocument(info.Document.LevelBase, info.Document.StoreyHeight,
                info.Index != null ? info.Index.Levels : null);
            var bounds = DocumentBounds(info.CameraBounds);
            // The first commit and every source switch home against the fresh station;
            // a later commit of the same source (an edit) keeps the player's view.
            bool newStation = lastRevision < 0 ||
                !string.Equals(lastSource ?? "", info.SourceId ?? "", StringComparison.Ordinal);
            lastSource = info.SourceId ?? "";
            lastRevision = info.Revision;
            if (newStation) {
                // The shell opens at the document's lowest authored metre (TS
                // `openingLevel`); a level that is not on the storey ladder is pulled to
                // the nearest one so the view grid stays valid.
                int level = grid.NearestLadderLevel(info.Document.OpeningLevel);
                var world = host?.Coordinator?.World;
                rig.Configure(host != null ? host.stationCamera : null, bounds, grid, level, SectionPlanCentre(world));
                host?.SetActiveLevel(level);
            } else {
                rig.RefreshStation(bounds, grid);
            }
            rig.SetDense(info.Document.ModuleCount >= StationVisibilityRules.DenseStationModules);
            RegisterWorld(rig, host != null && host.Coordinator != null ? host.Coordinator.World : null);
        }

        /// <summary>
        /// Tag every part A's world registered with the role and true level span the
        /// view rules need. A's <see cref="StationViewRecord"/> is the only coupling;
        /// a family that wants its own wall/PSD/ground tag registers that role on the
        /// record instead of teaching the camera about its geometry.
        /// </summary>
        static void RegisterWorld(StationViewRig rig, StationWorldView world) {
            if (rig == null || world == null) return;
            rig.Visibility.ClearRegisteredTargets();
            rig.Visibility.ResetMaterials();
            var modules = new Dictionary<string, StationModuleRecord>(StringComparer.Ordinal);
            foreach (var module in world.Document.Modules) modules[module.Id] = module;
            var grid = rig.Visibility.State.Grid;
            foreach (var record in world.Records) {
                if (record?.View == null) continue;
                var role = RoleOf(record, modules);
                var levels = LevelsOf(record, modules, grid);
                rig.Register(record.View.transform, role, levels,
                    gradeOwned: IsGradeOwned(record, modules));
            }
        }

        /// <summary>
        /// The authored 0 m ground datum (`sim/ground.ts:GROUND_Z`): the elevation the street
        /// surface stands on. A station's <c>LevelBase</c> shifts the *storey grid*, not this, so
        /// a grade classification must never be derived from the active level or a storey band.
        /// </summary>
        public const int GroundZ = 0;

        /// <summary>
        /// Is this record owned by the authored grade — the street slab and courses, pavement,
        /// plantings, fences, street decor and traffic (20 §4)? The producer's own flag wins (a
        /// combined surface batch carries the exact module elevation it was grouped by), then the
        /// role (the cell mesher's ground pass and the road deck), then the saved module itself.
        /// The entrance/exit assembly is the explicit exception and always keeps its geometry.
        /// </summary>
        public static bool IsGradeOwned(StationViewRecord record, Dictionary<string, StationModuleRecord> modules) {
            if (record == null) return false;
            if (record.GradeOwned) return true;
            if (RoleOf(record, modules) == StationPartRole.Ground) return true;
            if (string.IsNullOrEmpty(record.ModuleId)) return false;
            return modules != null && modules.TryGetValue(record.ModuleId, out var module) && IsGradeModule(module);
        }

        /// <summary>
        /// One saved module's grade membership. The source hides `sidewalk`, `lawn`, `tree`,
        /// `road` and `traffic-light` wherever they stand; everything else is grade furniture
        /// only when it **stands on the authored datum**, which is what separates a 0 m fence from
        /// the platform fence one storey down. Structural runs are never grade furniture even when
        /// they cross 0 m, and the entrance/exit assembly is never hidden.
        /// </summary>
        public static bool IsGradeModule(StationModuleRecord module) {
            if (module == null) return false;
            switch (module.Type) {
                case "sidewalk": case "lawn": case "tree": case "road": case "traffic-light": return true;
                // The entrance/exit assembly keeps its pad, glazing, fascia and guidepost.
                case "exit": case "guidepost": return false;
                // A structural run that happens to cross the datum keeps its geometry.
                case "track": case "platform-edge": case "psd": case "psd-end":
                case "stair": case "escalator": case "lift": case "walkway":
                case "glass": case "door": case "roof": case "pillar": case "hanger": return false;
            }
            return module.Z == GroundZ;
        }

        public static StationPartRole RoleOf(StationViewRecord record, Dictionary<string, StationModuleRecord> modules) {
            switch ((record.Role ?? "").ToLowerInvariant()) {
                case "cells": {
                    // E hangs each group under its surface role's transform
                    // (`StationSurfaceRole`: Cell / Ceiling / Plate / Ground / Wall / Roof).
                    var parent = record.View != null && record.View.transform.parent != null
                        ? record.View.transform.parent.name : "";
                    if (string.Equals(parent, "Ceiling", StringComparison.OrdinalIgnoreCase)) return StationPartRole.Ceiling;
                    if (string.Equals(parent, "Ground", StringComparison.OrdinalIgnoreCase)) return StationPartRole.Ground;
                    // The mesher's role split: 隐藏墙壁 sees through `Wall` (wall-flagged
                    // sides / `wall.*` finishes), 隐藏屋顶 hides the cell-geometry roof deck.
                    if (string.Equals(parent, "Wall", StringComparison.OrdinalIgnoreCase)) return StationPartRole.Wall;
                    if (string.Equals(parent, "Roof", StringComparison.OrdinalIgnoreCase)) return StationPartRole.Roof;
                    return StationPartRole.Slab;
                }
                case "roads": return StationPartRole.Ground;
                case "surfaces": return StationPartRole.Surface;
                case "signs": return StationPartRole.Sign;
                case "trains": return StationPartRole.Train;
                case "actors": case "crowd": return StationPartRole.Actor;
                case "grid": return StationPartRole.Grid;
                case "cursor": return StationPartRole.Cursor;
                case "modules":
                // Plan 22 §1: the generated structure renderer registers its roofs and pillars
                // under its own role, and a roof still has to answer the `Roof` role so Hide
                // Roof and the section plane reach the geometry it builds.
                case "structure": {
                    if (string.IsNullOrEmpty(record.ModuleId) || !modules.TryGetValue(record.ModuleId, out var module)) {
                        return StationPartRole.Prop;
                    }
                    switch (module.Type) {
                        case "psd": case "psd-end": case "platform-edge": return StationPartRole.Psd;
                        case "roof": return StationPartRole.Roof;
                        case "sidewalk": case "lawn": case "tree": case "road": case "traffic-light": return StationPartRole.Ground;
                        case "sign": case "billboard": case "calligraphy": case "linemap": case "monitor": return StationPartRole.Sign;
                        case "train": return StationPartRole.Train;
                        default: return StationPartRole.Prop;
                    }
                }
                default: return StationPartRole.Prop;
            }
        }

        /// <summary>
        /// The level membership one view record is registered with. Precedence is the
        /// source's: an explicit band list from the renderer, then the committed
        /// module's own <c>moduleLevels</c> bands (a wall panel by its envelope
        /// midpoint, a run by its endpoints), then a cell chunk's own storey band, then
        /// a renderer-supplied level, and only as a last resort the record's bounds.
        /// **Bounds are a clipping/picking input, not a storey input** (RCA 14 §1/§3);
        /// the old raw-Z bounds branch is what put the −14 m glass above the −15 floor.
        /// </summary>
        public static int[] LevelsOf(StationViewRecord record, Dictionary<string, StationModuleRecord> modules, StationLevelGrid grid) {
            if (record.LevelBands != null && record.LevelBands.Length > 0) return record.LevelBands;
            if (!string.IsNullOrEmpty(record.ModuleId) && modules.TryGetValue(record.ModuleId, out var module)) {
                var bands = StationModuleLevels.Of(module, grid);
                if (bands.Length > 0) return bands;
            }
            if (!string.IsNullOrEmpty(record.CellKey)) {
                var parts = record.CellKey.Split(',');
                if (parts.Length == 3 && int.TryParse(parts[2], out int z)) {
                    return new[] { StationModuleLevels.Band(grid, z) };
                }
            }
            if (record.LevelMax > record.LevelMin) return new[] { record.LevelMin, record.LevelMax };
            if (record.LevelMin != 0 || record.LevelMax != 0) return new[] { record.LevelMin };
            if (record.HasBounds) {
                // A record that supplied neither a module, a cell nor a level: derive a
                // band from the bounds so it can still ghost with its own storey.
                int low = StationModuleLevels.Band(grid, record.Bounds.Z0);
                int high = StationModuleLevels.Band(grid, record.Bounds.Z1);
                return low == high ? new[] { low } : new[] { low, high };
            }
            // No membership input at all: an empty list means "no storey", which the
            // visibility walk treats as active rather than hiding the part.
            return Array.Empty<int>();
        }

        /// <summary>Centre of the rendered cell plan in document X/Y, including the generated street.</summary>
        public static Vector2 SectionPlanCentre(StationWorldView world) {
            // SceneRenderer.defaultSection uses ChunkSystem's emitted mesh bounds.
            // The generated street belongs to those meshes; separate props do not.
            Bounds plan = default;
            bool hasMesh = false;
            if (world != null) {
                foreach (var record in world.Records) {
                    if (record?.Role != Views.StationCellRenderer.RoleName || !record.View ||
                        !record.View.TryGetComponent<MeshRenderer>(out var renderer)) continue;
                    var meshBounds = renderer.bounds;
                    if (world.Document != null && record.View.transform.parent?.name == "Ground")
                        continue;
                    if (hasMesh) plan.Encapsulate(meshBounds);
                    else {
                        plan = meshBounds;
                        hasMesh = true;
                    }
                }
                if (world.Document != null) {
                    var ground = ReferenceGroundBounds(world.Document);
                    if (hasMesh) plan.Encapsulate(ground);
                    else plan = ground;
                }
            }
            var centre = StationCameraSpace.ToDocument(plan.center);
            return new Vector2(centre.x, centre.y);
        }

        static Bounds ReferenceGroundBounds(StationDocument document) {
            const float margin = 16f;
            var min = new Vector2(float.PositiveInfinity, float.PositiveInfinity);
            var max = new Vector2(float.NegativeInfinity, float.NegativeInfinity);
            var paintedMin = min;
            var paintedMax = max;
            void Include(double x, double y) {
                var point = new Vector2((float)x, (float)y);
                min = Vector2.Min(min, point);
                max = Vector2.Max(max, point);
            }
            foreach (var cell in document.Cells) {
                if (cell.Z == StationPaintSnapshot.GroundZ && cell.IsSolid && cell.HasTag("painted-ground")) {
                    var point = new Vector2(cell.X, cell.Y);
                    paintedMin = Vector2.Min(paintedMin, point);
                    paintedMax = Vector2.Max(paintedMax, point);
                } else Include(cell.X, cell.Y);
            }
            foreach (var module in document.Modules) {
                Include(module.X, module.Y);
                if (module.Type == "road") Include(module.X + module.Width - 1, module.Y + module.Depth - 1);
                if (module.Type == "track")
                    foreach (var cell in StationFootprints.TrackCells(module)) Include(cell.X, cell.Y);
                if (module.From.HasValue) Include(module.From.Value.X, module.From.Value.Y);
                if (module.To.HasValue) Include(module.To.Value.X, module.To.Value.Y);
            }
            if (float.IsPositiveInfinity(min.x)) min = max = Vector2.zero;
            min = Vector2.Min(min - Vector2.one * margin, paintedMin);
            max = Vector2.Max(max + Vector2.one * margin, paintedMax) + Vector2.one;
            var bounds = new Bounds();
            bounds.SetMinMax(new Vector3(min.x, 0f, min.y), new Vector3(max.x, 0f, max.y));
            return bounds;
        }

        /// <summary>The document-space bounds of the committed world.</summary>
        public static Bounds DocumentBounds(StationCameraBounds cameraBounds) {
            var bounds = cameraBounds.Bounds;
            if (bounds.IsEmpty) return new Bounds(Vector3.zero, Vector3.one * 40f);
            var min = new Vector3(bounds.MinX, bounds.MinY, bounds.MinZ);
            var max = new Vector3(bounds.MinX + bounds.Width, bounds.MinY + bounds.Depth, bounds.MinZ + bounds.Height);
            return new Bounds((min + max) * .5f, max - min);
        }
    }

    /// <summary>`payload.camera` for every `state` and `commit` reply.</summary>
    public sealed class StationCameraStateContributor : IStationStateContributor {
        readonly StationViewRig rig;
        public StationCameraStateContributor(StationViewRig rig) { this.rig = rig; }
        public string Key => "camera";
        public JObject BuildPayload(StationDocument document, StationIndex index) =>
            rig != null && rig.Configured ? rig.SnapshotObject()["camera"] as JObject : null;
    }

    /// <summary>
    /// `payload.render` — what the frame is actually made of: the cell mesher's groups and
    /// triangles, the shader the finish library used, how many albedo maps bound, and the
    /// light rig in effect. Plan 13 §2 asks for render diagnostics before any colour is
    /// tuned; without them "the station is dark" cannot be told apart from "the cells were
    /// never built".
    /// </summary>
    public sealed class StationRenderStateContributor : IStationStateContributor {
        public string Key => "render";
        public JObject BuildPayload(StationDocument document, StationIndex index) {
            var payload = new JObject();
            var cells = Views.StationCellRenderer.Current;
            if (cells == null) {
                payload["cells"] = JValue.CreateNull();
            } else {
                var library = cells.Finishes;
                payload["cells"] = new JObject {
                    ["groups"] = cells.Groups,
                    ["triangles"] = cells.Triangles,
                    ["shader"] = library != null && library.Shader != null ? library.Shader.name : "",
                    ["shaderSupported"] = library != null && library.Shader != null && library.Shader.isSupported,
                    ["finishes"] = library != null ? library.FinishCount : 0,
                    ["textures"] = library != null ? library.TextureCount : 0,
                    ["materials"] = library != null ? library.MaterialCount : 0,
                    ["unknown"] = cells.View != null && cells.View.UnknownFinishes != null ? cells.View.UnknownFinishes.Count : 0,
                };
            }
            // One row per registered module-group renderer: the coverage number the
            // binding report gates on, visible without the Editor.
            var groups = new JObject();
            foreach (var renderer in StationRenderers.Snapshot()) {
                if (renderer is Views.StationModuleGroupRenderer group && group.Current != null) {
                    groups[group.Role] = group.Current.Count;
                }
            }
            payload["groups"] = groups;
            var overlays = Views.StationOverlayRenderer.Instance;
            if (overlays != null && overlays.Current != null) {
                payload["overlays"] = new JObject {
                    ["zones"] = overlays.Current.Zones,
                    ["density"] = overlays.Current.Density,
                    ["zoneCells"] = overlays.Current.ZoneCells,
                    ["densityCells"] = overlays.Current.DensityCells,
                    ["level"] = overlays.Current.Level,
                    ["drawCalls"] = overlays.Current.Meshes.Count,
                };
            }
            var ambient = Shader.GetGlobalColor("_StationAmbient");
            payload["ambient"] = new JArray(ambient.r, ambient.g, ambient.b);
            payload["hemiSky"] = new JArray(Shader.GetGlobalColor("_StationHemiSky").r, Shader.GetGlobalColor("_StationHemiSky").g, Shader.GetGlobalColor("_StationHemiSky").b);
            payload["fog"] = new JObject {
                ["on"] = RenderSettings.fog,
                ["start"] = RenderSettings.fogStartDistance,
                ["end"] = RenderSettings.fogEndDistance,
            };
            var activeRig = StationViewFeature.Active;
            payload["sky"] = activeRig != null && activeRig.Sky != null
                ? activeRig.Sky.SnapshotJson(activeRig.viewCamera)
                : new JObject {
                    ["shown"] = false,
                    ["intensity"] = Math.Round(StationSkySystem.SkyIntensity(StationSkySystem.DefaultSimTime), 6),
                    ["clearFlags"] = CameraClearFlags.SolidColor.ToString(),
                    ["shaderSupported"] = StationSkySystem.FindShader() != null,
                };
            var lights = new JArray();
            foreach (var light in UnityEngine.Object.FindObjectsByType<Light>(FindObjectsInactive.Exclude)) {
                if (light.type != LightType.Directional) continue;
                lights.Add(new JObject {
                    ["name"] = light.name,
                    ["intensity"] = light.intensity,
                    ["shadows"] = light.shadows.ToString(),
                });
            }
            payload["lights"] = lights;
            return payload;
        }
    }

    /// <summary>`payload.view` for every `state` and `commit` reply.</summary>
    public sealed class StationViewStateContributor : IStationStateContributor {
        readonly StationViewRig rig;
        public StationViewStateContributor(StationViewRig rig) { this.rig = rig; }
        public string Key => "view";
        public JObject BuildPayload(StationDocument document, StationIndex index) {
            if (rig == null || !rig.Configured) return null;
            var snapshot = rig.SnapshotObject();
            var view = snapshot["view"] as JObject;
            if (view == null) return null;
            if (snapshot["capabilities"] is JObject viewCaps) {
                view["capabilities"] = viewCaps;
            }
            // 20 §6: the drag's own readout rides the published view state, so the shell mirrors
            // the committed offset instead of inventing one and a verifier can see the frozen axis.
            var handle = StationSectionDrag.Snapshot(null);
            // The controls' own positions, in **normalized canvas fractions**, so a browser case
            // can grip the drawn arrow and the sheet without guessing where they are (x right,
            // y down — the shell's pointer space).
            var camera = rig.viewCamera != null ? rig.viewCamera : Camera.main;
            var section = rig.sectionView;
            if (section != null && camera != null) {
                var plane = section.Plane;
                handle["norm"] = new JObject {
                    ["sheet"] = NormPoint(camera, plane.Point),
                    ["shaft"] = NormPoint(camera, section.ArrowPoint(.3f)),
                    ["head"] = NormPoint(camera, section.ArrowPoint(.8f)),
                };
                handle["arrowLength"] = section.ArrowLength;
                handle["arrowVisible"] = section.ArrowVisible;
                handle["sheetVisible"] = section.SheetVisible;
                // The axis is published even with **no** drag in flight: a caller has to know
                // whether the cut can be dragged at all before it aims a grip, and a degenerate
                // projected axis is exactly the case a browser case has to be able to see.
                if (handle["axis"] == null && StationSectionDrag.TryAxis(camera, section, out var idleAxis, out float idleSpan)) {
                    handle["axis"] = new JArray(idleAxis.x, idleAxis.y);
                    handle["span"] = idleSpan;
                } else if (handle["axis"] == null) {
                    handle["axis"] = new JArray(0f, 0f);
                    handle["span"] = 0f;
                    handle["degenerate"] = true;
                }
            }
            view["sectionHandle"] = handle;
            view["sectionOffset"] = rig.SectionOffset;
            return view;
        }

        /// <summary>One document point as a normalized canvas fraction (x right, y down).</summary>
        static JArray NormPoint(Camera camera, Vector3 document) {
            var screen = camera.WorldToScreenPoint(StationCameraSpace.ToWorld(document));
            if (screen.z <= 0f) return new JArray(0.5, 0.5);
            float width = Mathf.Max(1f, camera.pixelWidth), height = Mathf.Max(1f, camera.pixelHeight);
            return new JArray(screen.x / width, 1f - screen.y / height);
        }
    }

    /// <summary>
    /// The `camera.*` command handler. Session-scoped: it never changes the document
    /// revision (the router acks it), and it carries the camera state back in the ack.
    /// </summary>
    public sealed class StationCameraCommandHandler : IStationCommandHandler {
        readonly StationViewRig rig;
        readonly StationGameHost host;
        public StationCameraCommandHandler(StationViewRig rig, StationGameHost host) { this.rig = rig; this.host = host; }
        public string Capability => "camera";
        public bool Handles(string type) => type != null && type.StartsWith("camera.", StringComparison.Ordinal);

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (rig == null || !rig.Configured) {
                rejectCode = "no-session";
                rejectReason = "No committed station camera is installed.";
                return false;
            }
            if (!rig.Execute(command != null ? command.Raw : "", out string code)) {
                rejectCode = string.IsNullOrEmpty(code) ? "camera-failed" : code;
                rejectReason = "The camera command was refused.";
                return false;
            }
            StationViewResponses.Fill(rig, host, payload);
            return true;
        }
    }

    /// <summary>
    /// The `view.*` command handler. It applies level and view toggles through the same
    /// applier as the camera; a level change is mirrored to the host's published
    /// `level` (the shared UI adopts it), and nothing here touches the simulation or
    /// the document revision.
    /// </summary>
    public sealed class StationViewCommandHandler : IStationCommandHandler {
        readonly StationViewRig rig;
        readonly StationGameHost host;
        public StationViewCommandHandler(StationViewRig rig, StationGameHost host) { this.rig = rig; this.host = host; }
        public string Capability => "view";
        public bool Handles(string type) => type != null && type.StartsWith("view.", StringComparison.Ordinal);

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (rig == null || !rig.Configured) {
                rejectCode = "no-session";
                rejectReason = "No committed station view is installed.";
                return false;
            }
            if (!rig.Execute(command != null ? command.Raw : "", out string code)) {
                rejectCode = string.IsNullOrEmpty(code) ? "view-failed" : code;
                rejectReason = "The view command was refused.";
                return false;
            }
            // `state.level` is the host's shared-UI level; keep it on the camera's level.
            host?.SetActiveLevel(rig.Commands.Camera.ActiveLevel);
            StationViewResponses.Fill(rig, host, payload);
            return true;
        }
    }

    /// <summary>The small ack body both D handlers return; the router wraps it in an ack.</summary>
    static class StationViewResponses {
        public static void Fill(StationViewRig rig, StationGameHost host, JObject payload) {
            if (payload == null || rig == null) return;
            var state = rig.SnapshotObject();
            payload["camera"] = state["camera"] ?? JValue.CreateNull();
            payload["view"] = state["view"] ?? JValue.CreateNull();
            // 20 §6: the drag's own readout rides the view state, so the shell can mirror the
            // committed offset without inventing one, and a verifier can see the frozen axis.
            if (payload["view"] is JObject view) {
                if (state["capabilities"] is JObject viewCaps) {
                    view["capabilities"] = viewCaps.DeepClone();
                }
                view["sectionHandle"] = StationSectionDrag.Snapshot(view["sectionHandle"]?["part"]?.ToString());
                view["sectionOffset"] = rig.SectionOffset;
            }
            payload["capabilities"] = state["capabilities"] ?? new JObject();
            payload["level"] = rig.Commands != null ? rig.Commands.Camera.ActiveLevel : 0;
            if (host != null) payload["revision"] = host.CurrentRevision;
        }
    }
}
