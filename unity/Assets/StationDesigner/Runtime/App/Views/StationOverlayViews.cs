using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// The two information overlays (plan 13 §5). Three.js draws them as separate scene
    /// systems over the active storey's floors: the zone map paints each authored zone's
    /// walkable cells with a palette colour and prints the room label; the density map
    /// paints live occupancy from the simulation.
    ///
    /// The port had the `view.set zones/density` flags and no draw path at all, so both
    /// toggles changed state and nothing else. This renderer owns a quad mesh per colour
    /// (0.02 m over the floor top) under the `overlay` role, so the storey slice, the
    /// section and Hide UI apply to it like any other piece. Zones rebuild on a document
    /// revision or level change; density rebuilds a few times a second from the crowd
    /// renderer's published poses, bucketed into floor cells (the stable key the session
    /// already speaks in).
    /// </summary>
    public sealed class StationOverlayRenderer : IStationViewRenderer {
        public const string RoleName = "overlay";

        /// <summary>Zone colours, from the source's zone palette (blueprint family).</summary>
        public static readonly Color32[] ZonePalette = {
            new Color32(110, 170, 255, 90), new Color32(255, 168, 92, 90), new Color32(133, 220, 160, 90),
            new Color32(232, 140, 210, 90), new Color32(198, 160, 255, 90), new Color32(255, 214, 102, 90),
            new Color32(120, 220, 230, 90), new Color32(240, 130, 130, 90),
        };

        /// <summary>The density ramp, cold (empty) to hot (a crowd).</summary>
        static readonly Color32[] DensityRamp = {
            new Color32(64, 120, 220, 60), new Color32(80, 200, 220, 70), new Color32(120, 220, 130, 80),
            new Color32(240, 210, 90, 90), new Color32(245, 150, 70, 100), new Color32(235, 80, 70, 110),
        };

        public sealed class OverlayState {
            public StationWorldView World;
            public Transform Root;
            public readonly List<Mesh> Meshes = new List<Mesh>();
            public readonly List<Material> Materials = new List<Material>();
            public StationDocument Document;
            public int Level;
            public bool Zones;
            public bool Density;
            public int Revision = -1;
            public float DensityClock;
            public int ZoneCells;
            public int DensityCells;
        }

        readonly List<OverlayState> states = new List<OverlayState>();
        static StationOverlayRenderer instance;

        public string Role => RoleName;

        /// <summary>The newest live world's overlay state.</summary>
        public OverlayState Current {
            get {
                for (var i = states.Count - 1; i >= 0; i--) {
                    var state = states[i];
                    if (state.World != null && !state.World.IsDisposed) return state;
                }
                return null;
            }
        }

        public static StationOverlayRenderer Instance => instance;

        public void Build(StationViewBuildContext context) {
            if (context == null) throw new ArgumentNullException(nameof(context));
            Purge();
            var state = new OverlayState {
                World = context.World,
                Document = context.Document,
                Root = context.RoleRoot(RoleName),
            };
            states.Add(state);
            instance = this;
        }

        public void Release() => Purge();

        /// <summary>Publish the current view flags and storey (the rig calls this on change).</summary>
        public void SetView(bool zones, bool density, int level) {
            var state = Current;
            if (state == null) return;
            if (state.Zones == zones && state.Density == density && state.Level == level) return;
            state.Zones = zones;
            state.Density = density;
            state.Level = level;
            Rebuild(state);
        }

        /// <summary>Advance the density refresh; the host ticks this every frame.</summary>
        public void Tick(float deltaSeconds) {
            var state = Current;
            if (state == null || !state.Density) return;
            state.DensityClock += deltaSeconds;
            if (state.DensityClock < 0.25f) return;
            state.DensityClock = 0f;
            Rebuild(state);
        }

        void Rebuild(OverlayState state) {
            ClearGeometry(state);
            state.ZoneCells = 0;
            state.DensityCells = 0;
            if (state.Zones) BuildZones(state);
            if (state.Density) BuildDensity(state);
        }

        void BuildZones(OverlayState state) {
            var byColour = new Dictionary<int, List<Vector3>>();
            var labels = new Dictionary<string, Vector3>();
            foreach (var cell in state.Document.Cells) {
                if (cell.Z != state.Level) continue;
                if (string.IsNullOrEmpty(cell.Zone) && string.IsNullOrEmpty(cell.Room)) continue;
                int bucket = Bucket(cell.Zone);
                if (!byColour.TryGetValue(bucket, out var quads)) byColour[bucket] = quads = new List<Vector3>();
                AddQuad(quads, cell.X, cell.Y, cell.Z + 1.01f);
                state.ZoneCells++;
                if (!string.IsNullOrEmpty(cell.Room) && !labels.ContainsKey(cell.Room)) {
                    labels[cell.Room] = new Vector3(cell.X + 0.5f, cell.Z + 1.06f, cell.Y + 0.5f);
                }
            }
            foreach (var pair in byColour) {
                var colour = ZonePalette[((pair.Key % ZonePalette.Length) + ZonePalette.Length) % ZonePalette.Length];
                AddMesh(state, pair.Value, colour, "zone " + pair.Key, null);
            }
            foreach (var pair in labels) AddLabel(state, pair.Key, pair.Value);
        }

        void BuildDensity(OverlayState state) {
            // The crowd is published through the process-wide pose feed, the same seam the
            // renderer reads; no feed (a public-profile build with no catalogue) means an
            // empty heat map rather than a failed overlay.
            if (PassengerPoseFeeds.Source == null) return;
            var poses = new List<PassengerPose>();
            if (!PassengerPoseFeeds.Source.TryRead(poses) || poses.Count == 0) return;
            var counts = new Dictionary<long, int>();
            foreach (var pose in poses) {
                if (pose.Z < state.Level - 0.5f || pose.Z > state.Level + 1.5f) continue;
                long key = ((long)Mathf.FloorToInt((float)pose.X) << 32) ^ (uint)Mathf.FloorToInt((float)pose.Y);
                counts.TryGetValue(key, out int count);
                counts[key] = count + 1;
            }
            if (counts.Count == 0) return;
            var byColour = new Dictionary<int, List<Vector3>>();
            foreach (var pair in counts) {
                int x = (int)(pair.Key >> 32);
                int y = (int)(uint)(pair.Key & 0xFFFFFFFF);
                int bucket = Mathf.Clamp(pair.Value - 1, 0, DensityRamp.Length - 1);
                if (!byColour.TryGetValue(bucket, out var quads)) byColour[bucket] = quads = new List<Vector3>();
                AddQuad(quads, x, y, state.Level + 1.02f);
                state.DensityCells++;
            }
            foreach (var pair in byColour) AddMesh(state, pair.Value, DensityRamp[pair.Key], "density " + pair.Key, null);
        }

        static int Bucket(string zone) {
            if (string.IsNullOrEmpty(zone)) return 0;
            int hash = 0;
            foreach (var c in zone) hash = (hash * 31 + c) & 0x7FFFFFFF;
            return hash;
        }

        static void AddQuad(List<Vector3> vertices, int x, int y, float z) {
            // Document (x, y, z) -> Unity (x, z, y); the quad is the cell's floor.
            float x0 = x + 0.02f, x1 = x + 0.98f, y0 = y + 0.02f, y1 = y + 0.98f;
            vertices.Add(new Vector3(x0, z, y0));
            vertices.Add(new Vector3(x0, z, y1));
            vertices.Add(new Vector3(x1, z, y1));
            vertices.Add(new Vector3(x0, z, y0));
            vertices.Add(new Vector3(x1, z, y1));
            vertices.Add(new Vector3(x1, z, y0));
        }

        void AddMesh(OverlayState state, List<Vector3> vertices, Color32 colour, string name, Font font) {
            if (vertices == null || vertices.Count == 0) return;
            var mesh = new Mesh { name = name };
            var indices = new int[vertices.Count];
            for (int i = 0; i < indices.Length; i++) indices[i] = i;
            mesh.SetVertices(vertices);
            mesh.SetIndices(indices, MeshTopology.Triangles, 0);
            mesh.RecalculateBounds();
            var go = new GameObject(name);
            go.transform.SetParent(state.Root, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            var material = CreateMaterial(colour, false);
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            state.Meshes.Add(mesh);
            state.Materials.Add(material);
            context_register(state, go, name);
        }

        void context_register(OverlayState state, GameObject go, string part) {
            var bounds = new Bounds(go.transform.position, Vector3.zero);
            state.World.RegisterModule(RoleName, "", go, part, null, int.MinValue, int.MaxValue);
        }

        void AddLabel(OverlayState state, string text, Vector3 documentPoint) {
            // A legacy world-space TextMesh keeps the labels out of the UI layer and inside
            // the same slice/role rules as the quads. No font in the scene means no label
            // rather than an invisible object.
            var font = StationOverlayFont.Resolve(state.World.Font);
            if (font == null || string.IsNullOrEmpty(text)) return;
            var go = new GameObject("zone label " + text);
            go.transform.SetParent(state.Root, false);
            go.transform.position = StationCoordinates.Point(documentPoint) + new Vector3(0f, 0.02f, 0f);
            var mesh = go.AddComponent<TextMesh>();
            mesh.text = text;
            mesh.font = font;
            mesh.fontSize = 64;
            mesh.characterSize = 0.045f;
            mesh.anchor = TextAnchor.MiddleCenter;
            mesh.alignment = TextAlignment.Center;
            mesh.color = new Color(0.92f, 0.95f, 1f, 0.95f);
            var renderer = go.GetComponent<MeshRenderer>();
            if (renderer != null) {
                renderer.sharedMaterial = font.material;
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }
            state.World.RegisterModule(RoleName, "", go, "label", null, int.MinValue, int.MaxValue);
        }

        static Material CreateMaterial(Color32 colour, bool lit) {
            var shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Sprites/Default");
            var material = new Material(shader) { name = "overlay" };
            var value = (Color)colour;
            material.SetColor("_BaseColor", value);
            material.SetColor("_Color", value);
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

        void ClearGeometry(OverlayState state) {
            for (int i = state.Root.childCount - 1; i >= 0; i--) Destroy(state.Root.GetChild(i).gameObject);
            foreach (var mesh in state.Meshes) if (mesh) Destroy(mesh);
            foreach (var material in state.Materials) if (material) Destroy(material);
            state.Meshes.Clear();
            state.Materials.Clear();
        }

        void Purge() {
            for (int i = states.Count - 1; i >= 0; i--) {
                var state = states[i];
                if (state.World != null && !state.World.IsDisposed) continue;
                foreach (var mesh in state.Meshes) if (mesh) Destroy(mesh);
                foreach (var material in state.Materials) if (material) Destroy(material);
                state.Meshes.Clear();
                state.Materials.Clear();
                states.RemoveAt(i);
            }
        }

        static void Destroy(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }

    /// <summary>The station's scene font, with a built-in fallback so a label can draw.</summary>
    public static class StationOverlayFont {
        static Font cached;

        public static Font Resolve(Font preferred) {
            if (preferred) return preferred;
            if (cached) return cached;
            // A Latin fallback is enough for the plan's English acceptance pass; CJK rooms
            // use the scene's Noto font when the host supplied one.
            try { cached = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); } catch (Exception) { cached = null; }
            return cached;
        }
    }
}
