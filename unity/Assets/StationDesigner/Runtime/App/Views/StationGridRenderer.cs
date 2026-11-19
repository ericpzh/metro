using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// The editing lattice (plan 13 §4). `game/src/render/scene/systems/GridSystem.ts`
    /// draws a 1 m grid over the station bounds rounded out to 5 m (+5 m margin), moved to
    /// the active storey at `level + 1.002` and hidden with 隐藏UI; the Unity port had no
    /// lattice at all, which is most of why the street read as an empty void next to a
    /// Three.js frame that shows the same dark ground *with* its grid.
    ///
    /// The mesh is built once per station in document space (1 m lines, one draw call) and
    /// moved to the active storey by <see cref="SetLevel"/> from the rig's per-frame tick,
    /// so a Q/E storey step does not rebuild it. It is registered under the `grid` role,
    /// which `StationVisibilityRules` already answers with "hidden only while Hide UI is
    /// on" — the lattice is never sliced away by the storey policy.
    /// </summary>
    public sealed class StationGridRenderer : IStationViewRenderer, IStationLocalViewRenderer {
        public const string RoleName = "grid";
        /// <summary>Line colour from the source (`GridSystem`): 0x2a3444 at 0.8 alpha.</summary>
        public static readonly Color LineColour = new Color32(42, 52, 68, 204);
        /// <summary>The storey lift the source applies so the lattice never z-fights the slab.</summary>
        public const float LevelLift = 1.002f;

        static StationGridRenderer current;

        public sealed class GridState {
            public StationWorldView World;
            public GameObject Root;
            public Mesh Mesh;
            public Material Material;
            public Bounds DocumentBounds;
            public int Lines;
            public int X0, X1, Y0, Y1;
        }

        sealed class StagedGridDelta : IStationLocalRendererStage {
            readonly GridState state;
            readonly Bounds nextBounds;
            readonly int x0, x1, y0, y1;
            readonly Mesh nextMesh;
            readonly int nextLines;
            readonly bool swapMesh;
            bool committed;

            public StagedGridDelta(GridState state, Bounds nextBounds, int x0, int x1, int y0, int y1,
                Mesh nextMesh, int nextLines, bool swapMesh) {
                this.state = state;
                this.nextBounds = nextBounds;
                this.x0 = x0; this.x1 = x1; this.y0 = y0; this.y1 = y1;
                this.nextMesh = nextMesh;
                this.nextLines = nextLines;
                this.swapMesh = swapMesh;
            }

            public void Commit(StationWorldView world, StationLocalViewCommit commit) {
                committed = true;
                state.DocumentBounds = nextBounds;
                state.X0 = x0; state.X1 = x1; state.Y0 = y0; state.Y1 = y1;
                if (swapMesh) {
                    if (state.Mesh != null) commit.RetiredMeshes.Add(state.Mesh);
                    state.Mesh = nextMesh;
                    state.Lines = nextLines;
                    if (state.Root != null && state.Root.TryGetComponent<MeshFilter>(out var filter)) {
                        filter.sharedMesh = nextMesh;
                    }
                }
                float z = nextBounds.min.y;
                var nextBox = new StationBox(nextBounds.min.x, nextBounds.min.z, z, nextBounds.max.x, nextBounds.max.z, z + 1f);
                var records = world.Records;
                for (int i = 0; i < records.Count; i++) {
                    var rec = records[i];
                    if (rec != null && rec.Role == RoleName && rec.View == state.Root) {
                        rec.Bounds = nextBox;
                        rec.HasBounds = true;
                        break;
                    }
                }
            }

            public void Dispose() {
                if (!committed && swapMesh && nextMesh != null) Destroy(nextMesh);
            }
        }

        static readonly List<GridState> states = new List<GridState>();

        public string Role => RoleName;
        public GameObject Root => Live?.Root;
        public Mesh Mesh => Live?.Mesh;
        public Material Material => Live?.Material;
        public int Lines => Live?.Lines ?? 0;

        static GridState Live {
            get {
                for (var i = states.Count - 1; i >= 0; i--) {
                    var state = states[i];
                    if (state.World != null && !state.World.IsDisposed && state.Root != null) return state;
                }
                return null;
            }
        }

        static GridState StateOf(StationWorldView world) {
            for (var i = states.Count - 1; i >= 0; i--) {
                if (states[i].World == world) return states[i];
            }
            return null;
        }

        /// <summary>Move the lattice to a document storey (the rig calls this every tick).</summary>
        public static void SetLevel(int documentLevel) {
            var live = Live;
            if (live == null || live.Root == null) return;
            var position = live.Root.transform.position;
            float y = documentLevel + LevelLift;
            if (Mathf.Abs(position.y - y) < 0.0001f) return;
            live.Root.transform.position = new Vector3(0f, y, 0f);
        }

        static void QuantizeGridExtent(Bounds bounds, out int x0, out int x1, out int y0, out int y1) {
            x0 = Mathf.FloorToInt(bounds.min.x / 5f) * 5 - 5;
            x1 = Mathf.CeilToInt(bounds.max.x / 5f) * 5 + 5;
            y0 = Mathf.FloorToInt(bounds.min.y / 5f) * 5 - 5;
            y1 = Mathf.CeilToInt(bounds.max.y / 5f) * 5 + 5;
        }

        public void Build(StationViewBuildContext context) {
            if (context == null) throw new ArgumentNullException(nameof(context));
            Purge();
            var bounds = DocumentBounds(context.Document, context.Index);
            QuantizeGridExtent(bounds, out int x0, out int x1, out int y0, out int y1);
            var state = new GridState {
                World = context.World, DocumentBounds = bounds,
                X0 = x0, X1 = x1, Y0 = y0, Y1 = y1,
            };
            states.Add(state);

            var root = new GameObject("Station grid");
            root.transform.SetParent(context.RoleRoot(RoleName), false);
            root.transform.position = Vector3.zero;

            var mesh = BuildMesh(bounds, out int lines);
            if (mesh == null || lines == 0) {
                context.ReportUnresolved("grid-empty", "renderer", RoleName, "The station has no bounds to draw a lattice over.");
                Destroy(root);
                states.Remove(state);
                return;
            }
            state.Mesh = mesh;
            state.Lines = lines;
            state.Root = root;

            var filter = root.AddComponent<MeshFilter>();
            filter.sharedMesh = mesh;
            var renderer = root.AddComponent<MeshRenderer>();
            state.Material = CreateMaterial(context.Shader);
            renderer.sharedMaterial = state.Material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            // The lattice is station furniture, not a module: one record under the grid role.
            float z = bounds.min.y;
            context.World.RegisterModule(RoleName, "", root, "grid",
                new StationBox(bounds.min.x, bounds.min.z, z, bounds.max.x, bounds.max.z, z + 1f),
                int.MinValue, int.MaxValue);
            current = this;
        }

        public bool TryStageLocalDelta(
            StationLocalDeltaContext context,
            out IStationLocalRendererStage stage,
            out string fallbackReason) {
            stage = null;
            fallbackReason = null;
            var state = StateOf(context.World);
            var nextBounds = DocumentBounds(context.NextDocument, context.NextIndex);
            QuantizeGridExtent(nextBounds, out int nx0, out int nx1, out int ny0, out int ny1);
            if (state == null || state.Root == null) {
                fallbackReason = "grid-not-built";
                return false;
            }
            if (nx0 == state.X0 && nx1 == state.X1 && ny0 == state.Y0 && ny1 == state.Y1) {
                if (nextBounds == state.DocumentBounds) return true;
                stage = new StagedGridDelta(state, nextBounds, nx0, nx1, ny0, ny1, null, state.Lines, swapMesh: false);
                return true;
            }
            var nextMesh = BuildMesh(nextBounds, out int nextLines);
            if (nextMesh == null || nextLines == 0) {
                if (nextMesh != null) Destroy(nextMesh);
                fallbackReason = "grid-empty";
                return false;
            }
            stage = new StagedGridDelta(state, nextBounds, nx0, nx1, ny0, ny1, nextMesh, nextLines, swapMesh: true);
            return true;
        }

        public void Release() => Purge();

        static void Purge() {
            for (int i = states.Count - 1; i >= 0; i--) {
                var state = states[i];
                if (state.World != null && !state.World.IsDisposed) continue;
                if (state.Mesh) Destroy(state.Mesh);
                if (state.Material) Destroy(state.Material);
                states.RemoveAt(i);
            }
        }

        /// <summary>The camera's own station bounds, in document axes, in O(1) when an index is supplied.</summary>
        public static Bounds DocumentBounds(StationDocument document, StationIndex index) {
            if (document != null && index != null && !index.Bounds.IsEmpty) {
                if (document.ModuleCount > 0) {
                    var b = index.Bounds;
                    var min = new Vector3(b.MinX + 0.5f, b.MinY + 0.5f, b.MinZ);
                    var max = new Vector3(b.MaxX + 0.5f, b.MaxY + 0.5f, b.MaxZ);
                    var fast = new Bounds((min + max) * 0.5f, max - min);
                    return fast;
                }
                if (document.LevelBase != 0) {
                    var b = index.Bounds;
                    var fast = new Bounds(new Vector3(0f, 0f, document.LevelBase), Vector3.zero);
                    fast.Encapsulate(new Vector3(b.MinX + 0.5f, b.MinY + 0.5f, b.MinZ));
                    fast.Encapsulate(new Vector3(b.MaxX + 0.5f, b.MaxY + 0.5f, b.MaxZ));
                    return fast;
                }
                return new Bounds(Vector3.zero, Vector3.zero);
            }
            return DocumentBounds(document);
        }

        /// <summary>The camera's own station bounds, in document axes.</summary>
        public static Bounds DocumentBounds(StationDocument document) {
            var bounds = new Bounds();
            bool any = false;
            if (document != null) {
                foreach (var module in document.Modules) {
                    var point = new Vector3(module.X + 0.5f, module.Y + 0.5f, module.Z);
                    if (!any) { bounds = new Bounds(point, Vector3.zero); any = true; }
                    else bounds.Encapsulate(point);
                }
                if (!any && document.LevelBase != 0) {
                    bounds = new Bounds(new Vector3(0f, 0f, document.LevelBase), Vector3.zero);
                    any = true;
                }
                if (any) {
                    // Modules are single cells; the cells of the station reach further.
                    foreach (var cell in document.Cells) {
                        bounds.Encapsulate(new Vector3(cell.X + 0.5f, cell.Y + 0.5f, cell.Z));
                    }
                }
            }
            if (!any) bounds = new Bounds(Vector3.zero, Vector3.zero);
            return bounds;
        }

        /// <summary>
        /// Build the 1 m lattice as `MeshTopology.Lines`, in Unity world axes at y = 0 (the
        /// root moves it to the storey). The extent is the source's: the bounds floored and
        /// ceiled to 5 m, then one 5 m cell of margin on every side.
        /// </summary>
        static Mesh BuildMesh(Bounds bounds, out int lineCount) {
            int x0 = Mathf.FloorToInt(bounds.min.x / 5f) * 5 - 5;
            int x1 = Mathf.CeilToInt(bounds.max.x / 5f) * 5 + 5;
            int y0 = Mathf.FloorToInt(bounds.min.y / 5f) * 5 - 5;
            int y1 = Mathf.CeilToInt(bounds.max.y / 5f) * 5 + 5;
            int columns = x1 - x0 + 1;
            int rows = y1 - y0 + 1;
            int lines = columns + rows;
            lineCount = lines;
            if (lines == 0 || (columns + rows) > 40000) return null;
            var vertices = new Vector3[lines * 2];
            int index = 0;
            for (int x = x0; x <= x1; x++) {
                vertices[index++] = new Vector3(x, 0f, y0);
                vertices[index++] = new Vector3(x, 0f, y1);
            }
            for (int y = y0; y <= y1; y++) {
                vertices[index++] = new Vector3(x0, 0f, y);
                vertices[index++] = new Vector3(x1, 0f, y);
            }
            var indices = new int[vertices.Length];
            for (int i = 0; i < indices.Length; i++) indices[i] = i;
            var mesh = new Mesh { name = "station grid" };
            if (vertices.Length > 65000) mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            mesh.SetVertices(vertices);
            mesh.SetIndices(indices, MeshTopology.Lines, 0);
            mesh.RecalculateBounds();
            return mesh;
        }

        static Material CreateMaterial(Shader fallback) {
            var shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Sprites/Default") ?? fallback;
            var material = new Material(shader) { name = "station grid" };
            material.SetColor("_BaseColor", LineColour);
            material.SetColor("_Color", LineColour);
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_Blend")) material.SetFloat("_Blend", 0f);
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            if (material.HasProperty("_Cull")) material.SetFloat("_Cull", 0f);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            return material;
        }

        static void Destroy(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }
}
