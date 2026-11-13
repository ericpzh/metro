using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// The 剖切 surface the player sees and grabs: the translucent sheet, its border and
    /// 2 m hatch, the grab handle and the direction arrow, ported from
    /// <c>render/scene/systems/SectionSystem.ts</c>. It owns the drawing only; the plane
    /// arithmetic is <see cref="StationSectionPlane"/> and the clip application belongs to
    /// <see cref="StationVisibilityRegistry"/>, so 隐藏剖切面 can put the sheet away while
    /// the cut keeps cutting.
    ///
    /// The sheet is deliberately built from primitives and a small generated mesh: the
    /// URP project has no custom section shader asset for packet D to own.
    /// </summary>
    public sealed class StationSectionView : MonoBehaviour {
        const float Lift = .02f;
        const float MinSize = 6f;
        const float GridPitch = 2f;
        const float ArrowMin = 3f;
        const float HeadShare = .4f;

        public Camera viewCamera;

        StationSectionPlane section = StationSectionPlane.Default;
        bool clipping;
        bool surfaceVisible = true;
        Bounds stationBounds = new Bounds(Vector3.zero, Vector3.one * 40f);
        float size = MinSize;
        float arrowLength;

        GameObject group;
        MeshRenderer sheet;
        MeshRenderer hatch;
        MeshRenderer handle;
        Transform arrowShaft;
        Transform arrowHead;
        Material sheetMaterial;
        Material lineMaterial;
        Material handleMaterial;
        Material arrowMaterial;
        bool built;
        bool hovered;

        public bool Clipping => clipping;
        public bool SurfaceVisible => surfaceVisible;
        public bool GroupVisible => group && group.activeSelf;
        public bool SheetVisible => sheet && sheet.enabled;
        public float Size => size;

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
            var point = StationCameraSpace.ToWorld(section.Point) + normal * Lift;
            group.transform.position = point;
            group.transform.rotation = Quaternion.LookRotation(normal, up);
            group.SetActive(clipping);
            bool drawSurface = clipping && surfaceVisible;
            sheet.enabled = drawSurface;
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
            sheetMaterial = Transparent(shader, new Color(.35f, .78f, 1f), .14f);
            lineMaterial = Transparent(shader, new Color(.56f, .89f, 1f), .75f);
            handleMaterial = Transparent(shader, new Color(.75f, .94f, 1f), .85f);
            arrowMaterial = Transparent(shader, new Color(.18f, .82f, .42f), .9f);

            group = new GameObject("Section surface");
            group.transform.SetParent(null, false);

            sheet = MeshObject("Section sheet", UnitQuad(), sheetMaterial);
            sheet.transform.SetParent(group.transform, false);
            sheet.transform.localPosition = Vector3.zero;
            sheet.transform.localScale = new Vector3(size * 2f, size * 2f, 1f);

            hatch = MeshObject("Section hatch", null, lineMaterial);
            hatch.transform.SetParent(group.transform, false);
            hatch.transform.localPosition = Vector3.zero;
            hatch.transform.localScale = new Vector3(size * 2f, size * 2f, 1f);
            RebuildHatch();

            handle = MeshObject("Section handle", SphereMesh(.16f, 12, 8), handleMaterial);
            handle.transform.SetParent(group.transform, false);
            handle.transform.localPosition = Vector3.zero;

            arrowShaft = MeshObject("Section arrow shaft", BoxMesh(.05f, .05f, 1f), arrowMaterial).transform;
            arrowShaft.SetParent(group.transform, false);
            arrowHead = MeshObject("Section arrow head", PyramidMesh(.14f, 1f), arrowMaterial).transform;
            arrowHead.SetParent(group.transform, false);
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
            if (!sheetMaterial) return;
            SetColor(sheetMaterial, new Color(.35f, .78f, 1f, on ? .26f : .14f));
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

        void ResizeArrow() {
            if (!arrowShaft || !arrowHead) return;
            arrowLength = Mathf.Max(ArrowMin, size * .22f);
            float head = arrowLength * HeadShare;
            float shaft = arrowLength - head;
            arrowShaft.localPosition = new Vector3(0f, 0f, shaft * .5f);
            arrowShaft.localScale = new Vector3(1f, 1f, Mathf.Max(.001f, shaft));
            arrowHead.localPosition = new Vector3(0f, 0f, shaft + head * .5f);
            arrowHead.localScale = new Vector3(1f, 1f, Mathf.Max(.001f, head));
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

        static Mesh UnitQuad() {
            var mesh = new Mesh { name = "Section sheet" };
            mesh.SetVertices(new[] {
                new Vector3(-.5f, -.5f, 0f), new Vector3(.5f, -.5f, 0f),
                new Vector3(.5f, .5f, 0f), new Vector3(-.5f, .5f, 0f),
            });
            mesh.SetUVs(0, new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) });
            mesh.SetTriangles(new[] { 0, 1, 2, 0, 2, 3 }, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static Mesh BoxMesh(float x, float y, float z) {
            var mesh = new Mesh { name = "Section arrow shaft" };
            float hx = x * .5f, hy = y * .5f, hz = z * .5f;
            var vertices = new[] {
                new Vector3(-hx,-hy,-hz), new Vector3(hx,-hy,-hz), new Vector3(hx,hy,-hz), new Vector3(-hx,hy,-hz),
                new Vector3(-hx,-hy,hz), new Vector3(hx,-hy,hz), new Vector3(hx,hy,hz), new Vector3(-hx,hy,hz),
            };
            var triangles = new[] {
                0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4,
                1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7,
            };
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static Mesh PyramidMesh(float radius, float height) {
            var mesh = new Mesh { name = "Section arrow head" };
            var vertices = new System.Collections.Generic.List<Vector3> {
                new Vector3(-radius, 0f, -height * .5f),
                new Vector3(radius, 0f, -height * .5f),
                new Vector3(radius, 0f, height * .5f),
                new Vector3(-radius, 0f, height * .5f),
                new Vector3(0f, radius * 2f, 0f),
            };
            var triangles = new System.Collections.Generic.List<int> {
                0, 2, 1, 0, 3, 2,
                0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4,
            };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
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
            DestroyMaterial(sheetMaterial);
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
        public StationLevelGrid Grid { get; private set; }
        public Bounds StationBounds { get; private set; }
        public StationSectionPlane Section => Commands?.Section ?? StationSectionPlane.Default;
        public bool SectionSurfaceVisible => Commands?.SectionSurfaceVisible ?? true;
        public bool Configured => Commands != null;

        bool configured;
        bool dirty = true;

        public void Configure(Camera camera, Bounds documentBounds, StationLevelGrid grid, int activeLevel) {
            viewCamera = camera != null ? camera : viewCamera;
            StationBounds = documentBounds;
            Grid = grid;
            if (!configured) {
                CameraController = new StationCameraController();
                Visibility = new StationVisibilityRegistry(FindStationShader());
                Commands = new StationViewCommandApplier(CameraController, Visibility, grid);
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
            Commands.SetStation(documentBounds, grid, activeLevel);
            MarkDirty();
        }

        public void SetStation(Bounds documentBounds, StationLevelGrid grid, int activeLevel) {
            StationBounds = documentBounds;
            Grid = grid;
            if (Commands == null) { Configure(viewCamera, documentBounds, grid, activeLevel); return; }
            Commands.SetStation(documentBounds, grid, activeLevel);
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
            MarkDirty();
        }

        public StationVisibilityTarget Register(Transform root, StationPartRole role, int[] levels,
            int groundBand = StationVisibilityTarget.NoGroundBand, bool parked = false, bool floating = false,
            bool contactShadow = false) {
            var target = Visibility.Register(root, role, levels, groundBand, parked, floating, contactShadow);
            MarkDirty();
            return target;
        }

        public void SetExplodedPlan(StationExplodedPlan plan) {
            if (Commands == null) return;
            Visibility.SetExplodedPlan(plan);
            MarkDirty();
        }

        public void SetDense(bool dense) {
            if (Visibility != null) Visibility.State.Dense = dense;
        }

        public bool Execute(string json, out string code) {
            if (Commands == null) { code = "no-station"; return false; }
            if (!StationViewCommandParser.TryParse(json, out var command, out string error)) {
                code = "parse-failed:" + error;
                return false;
            }
            if (!Commands.TryApply(command, out code)) return false;
            Commands.ApplyCamera();
            MarkDirty();
            code = null;
            return true;
        }

        public void Tick(float deltaSeconds) {
            if (!configured) return;
            if (Commands.ViewCamera != null) {
                Commands.ViewportHeight = Mathf.Max(1, Screen.height);
                Commands.Camera.SetAspect(Commands.ViewCamera.aspect);
            }
            Commands.Tick(deltaSeconds);
            Commands.ApplyCamera();
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

        /// <summary>A slide the host measures from a pointer drag, writing the cut offset.</summary>
        public bool SlideSection(Vector3 fromDocument, Vector3 hitDocument) {
            if (sectionView == null || Commands == null) return false;
            float offset = sectionView.SlideOffset(fromDocument, hitDocument);
            var command = new StationViewCommand {
                Type = StationViewCommandType.ViewSet,
                Key = StationViewKey.SectionOffset,
                FloatValue = offset,
            };
            if (!Commands.TryApply(command, out _)) return false;
            MarkDirty();
            return true;
        }

        public void SetSectionHover(bool hovered) => sectionView?.SetHover(hovered);

        void MarkDirty() => dirty = true;

        void RefreshSection() {
            if (sectionView == null || Commands == null) return;
            sectionView.Apply(Commands.Section, Visibility.SectionClipping, Commands.SectionSurfaceVisible, StationBounds);
        }

        void Update() {
            if (!configured) return;
            Tick(Time.unscaledDeltaTime);
        }

        void OnDestroy() {
            if (Commands != null) Commands.Changed -= MarkDirty;
            if (CameraController != null) CameraController.Changed -= MarkDirty;
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
        static StationGameHost host;
        static string lastSource = "";
        static int lastRevision = -1;

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
            stationHost.RegisterStateContributor(new StationCameraStateContributor(rig));
            stationHost.RegisterStateContributor(new StationViewStateContributor(rig));
            stationHost.RegisterCommandHandler(new StationCameraCommandHandler(rig, stationHost));
            stationHost.RegisterCommandHandler(new StationViewCommandHandler(rig, stationHost));
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
                rig.Configure(host != null ? host.stationCamera : null, bounds, grid, level);
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
            foreach (var record in world.Records) {
                if (record?.View == null) continue;
                var role = RoleOf(record, modules);
                var levels = LevelsOf(record, modules);
                rig.Register(record.View.transform, role, levels);
            }
        }

        static StationPartRole RoleOf(StationViewRecord record, Dictionary<string, StationModuleRecord> modules) {
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
                case "signs": return StationPartRole.Sign;
                case "trains": return StationPartRole.Train;
                case "actors": case "crowd": return StationPartRole.Actor;
                case "grid": return StationPartRole.Grid;
                case "cursor": return StationPartRole.Cursor;
                case "modules": {
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

        static int[] LevelsOf(StationViewRecord record, Dictionary<string, StationModuleRecord> modules) {
            int low = record.LevelMin;
            int high = record.LevelMax;
            if (record.HasBounds) {
                low = Mathf.FloorToInt((float)record.Bounds.Z0);
                high = Mathf.Max(low, Mathf.FloorToInt((float)record.Bounds.Z1));
            } else if (high > low) {
                // A family that knows a true span (a stair, a lift shaft) registers it.
            } else if (!string.IsNullOrEmpty(record.ModuleId) && modules.TryGetValue(record.ModuleId, out var module)) {
                low = module.Z;
                high = module.Z + 1;
            } else if (!string.IsNullOrEmpty(record.CellKey)) {
                var parts = record.CellKey.Split(',');
                if (parts.Length == 3 && int.TryParse(parts[2], out int z)) {
                    low = z;
                    high = z + 1;
                }
            }
            if (high <= low) return new[] { low };
            return new[] { low, high };
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

    /// <summary>`payload.view` for every `state` and `commit` reply.</summary>
    public sealed class StationViewStateContributor : IStationStateContributor {
        readonly StationViewRig rig;
        public StationViewStateContributor(StationViewRig rig) { this.rig = rig; }
        public string Key => "view";
        public JObject BuildPayload(StationDocument document, StationIndex index) =>
            rig != null && rig.Configured ? rig.SnapshotObject()["view"] as JObject : null;
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
            payload["capabilities"] = state["capabilities"] ?? new JObject();
            payload["level"] = rig.Commands != null ? rig.Commands.Camera.ActiveLevel : 0;
            if (host != null) payload["revision"] = host.CurrentRevision;
        }
    }
}
