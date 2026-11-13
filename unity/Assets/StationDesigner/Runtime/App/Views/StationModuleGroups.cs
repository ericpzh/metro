using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// Which module family a saved type belongs to (plan 13 §3).
    ///
    /// The binding report used to call every type it did not know `no-view:
    /// no-renderer:<type>`: 3,689 authored Zoo modules across 30 types, while all but one
    /// of those types already resolve through `ModuleViews.Resolve` to a live
    /// `RuntimeCatalogue` prefab. The gap was that no renderer claimed them, so this table
    /// is the single place that answers "who draws this type" for the four groups the plan
    /// names: street/platform surfaces, street furniture, concourse equipment and live
    /// displays.
    /// </summary>
    public static class StationModuleClaims {
        public const string Surfaces = "surfaces";
        public const string Street = "street";
        public const string Equipment = "equipment";
        public const string Displays = "displays";

        /// <summary>Types drawn by `StationSurfaceModuleRenderer` (tiled, batched).</summary>
        static readonly HashSet<string> surfaces = new HashSet<string>(StringComparer.Ordinal) {
            "sidewalk", "lawn", "tactile", "floor-mark",
        };

        /// <summary>Types drawn by `StationStreetModuleRenderer` (prefabs + the track run).</summary>
        static readonly HashSet<string> street = new HashSet<string>(StringComparer.Ordinal) {
            "exit", "guidepost", "vent", "rail-signal", "track",
        };

        /// <summary>Types drawn by `StationEquipmentModuleRenderer` (one prefab instance each).</summary>
        static readonly HashSet<string> equipment = new HashSet<string>(StringComparer.Ordinal) {
            "light", "cctv", "desk", "extinguisher", "bin", "bench", "shelf",
            "electrical-cabinet", "tvm", "sink", "vending", "checkout", "booth", "glass", "ac-unit",
        };

        /// <summary>Types drawn by `StationDisplayModuleRenderer` (one prefab instance each).</summary>
        static readonly HashSet<string> displays = new HashSet<string>(StringComparer.Ordinal) {
            "billboard", "tv", "clock", "calligraphy", "monitor", "linemap",
        };

        public static bool Owns(string type) => type != null && GroupOf(type) != null;

        public static string GroupOf(string type) {
            if (string.IsNullOrEmpty(type)) return null;
            if (surfaces.Contains(type)) return Surfaces;
            if (street.Contains(type)) return Street;
            if (equipment.Contains(type)) return Equipment;
            if (displays.Contains(type)) return Displays;
            return null;
        }

        public static IEnumerable<string> TypesOf(string role) {
            switch (role) {
                case Surfaces: return surfaces;
                case Street: return street;
                case Equipment: return equipment;
                case Displays: return displays;
                default: return Array.Empty<string>();
            }
        }

        /// <summary>Every claimed type, for the renderer whitelist and the coverage test.</summary>
        public static IEnumerable<string> AllTypes {
            get {
                foreach (var type in surfaces) yield return type;
                foreach (var type in street) yield return type;
                foreach (var type in equipment) yield return type;
                foreach (var type in displays) yield return type;
            }
        }
    }

    /// <summary>
    /// Shared machinery for the catalogue-backed family renderers: resolve a module to its
    /// catalogue entry, place it with the shared conversion, keep the built state per world
    /// (the host reuses renderer singletons across staged worlds) and free only the worlds
    /// that are actually disposed.
    /// </summary>
    public abstract class StationModuleGroupRenderer : IStationViewRenderer {
        public sealed class BuiltModule {
            public string ModuleId;
            public string Type;
            public GameObject View;
            public string Key;
        }

        public sealed class WorldState {
            public StationWorldView World;
            public readonly List<BuiltModule> Modules = new List<BuiltModule>();
            public readonly List<Mesh> Meshes = new List<Mesh>();
            public readonly List<Material> Materials = new List<Material>();
            public int Count;
        }

        readonly List<WorldState> states = new List<WorldState>();
        protected abstract string Group { get; }
        public abstract string Role { get; }

        /// <summary>The newest live world's state (null before a build).</summary>
        public WorldState Current {
            get {
                for (var i = states.Count - 1; i >= 0; i--) {
                    var state = states[i];
                    if (state.World != null && !state.World.IsDisposed) return state;
                }
                return null;
            }
        }

        public int BuiltCount => Current?.Count ?? 0;

        public void Build(StationViewBuildContext context) {
            if (context == null) throw new ArgumentNullException(nameof(context));
            Purge();
            var state = new WorldState { World = context.World };
            states.Add(state);
            if (context.Catalogue == null) {
                context.ReportUnresolved("missing-asset", "renderer", Role, "No RuntimeCatalogue on the station host.");
                return;
            }
            var records = context.Document.Modules;
            var facts = new ModuleFacts[records.Count];
            for (int i = 0; i < facts.Length; i++) facts[i] = records[i].Facts;
            BuildGroup(context, facts, state);
        }

        /// <summary>Draw this renderer's own types out of the document's module list.</summary>
        protected abstract void BuildGroup(StationViewBuildContext context, ModuleFacts[] station, WorldState state);

        /// <summary>True when the saved type belongs to this renderer's group.</summary>
        protected bool Owns(string type) => StationModuleClaims.GroupOf(type) == Group;

        /// <summary>Resolve one module's catalogue entry; returns false and reports why not.</summary>
        protected bool TryResolve(StationViewBuildContext context, ModuleFacts module, IReadOnlyList<ModuleFacts> station,
            out RuntimeCatalogue.Entry entry, out string key, out string diagnostic) {
            entry = null;
            key = null;
            diagnostic = null;
            var visual = ModuleViews.Resolve(module, station, context.Catalogue);
            if (!visual.HasModel) {
                diagnostic = "unresolved:" + (visual.Detail.Length > 0 ? visual.Detail : "no-view");
                return false;
            }
            if (!context.Catalogue.TryGet(visual.Key, out entry) || entry.prefab == null) {
                diagnostic = "unresolved:no-prefab:" + visual.Key;
                return false;
            }
            key = visual.Key;
            return true;
        }

        /// <summary>
        /// The root pivot for a module: the shared cell-centre placement, moved to the run
        /// centre for a module wider or deeper than one cell. The source pivots a run at
        /// `mod.x + .5 + rotateLocal(rot, (w-1)/2, 0)`, so a two-cell billboard must not be
        /// dropped half a cell to the side.
        /// </summary>
        protected static Vector3 Pivot(ModuleFacts module, RuntimeCatalogue.Entry entry) =>
            ModulePlacement.Position(module, entry) + StationCoordinates.Point(RunCentreOffset(module));

        static Vector3 RunCentreOffset(ModuleFacts module) {
            float halfWidth = Mathf.Max(0, module.Width - 1) * 0.5f;
            float halfDepth = Mathf.Max(0, module.Depth - 1) * 0.5f;
            if (halfWidth <= 0f && halfDepth <= 0f) return Vector3.zero;
            // Quarter turns in document axes: the source's `rotateLocal`.
            switch (((module.Rotation % 4) + 4) % 4) {
                case 1: return new Vector3(-halfDepth, halfWidth, 0f);
                case 2: return new Vector3(-halfWidth, -halfDepth, 0f);
                case 3: return new Vector3(halfDepth, -halfWidth, 0f);
                default: return new Vector3(halfWidth, halfDepth, 0f);
            }
        }

        /// <summary>Instantiate a prefab at the module's pivot and register it for picking.</summary>
        protected BuiltModule Place(StationViewBuildContext context, ModuleFacts module, RuntimeCatalogue.Entry entry,
            string key, WorldState state, string part = "") {
            var parent = context.RoleRoot(Role);
            var go = UnityEngine.Object.Instantiate(entry.prefab, parent, false);
            go.name = (string.IsNullOrEmpty(module.Id) ? "module" : module.Id) + " " + module.Type;
            go.transform.SetPositionAndRotation(Pivot(module, entry), ModulePlacement.Rotation(module.Rotation));
            context.World.RegisterModule(Role, module.Id, go, part, null, module.Z, module.Z + 1);
            var built = new BuiltModule { ModuleId = module.Id, Type = module.Type, View = go, Key = key };
            state.Modules.Add(built);
            state.Count++;
            return built;
        }

        /// <summary>Document-axis bounds of one module, for records that carry a box.</summary>
        protected static StationBox BoxOf(ModuleFacts module) {
            float width = Mathf.Max(1f, module.Width);
            float depth = Mathf.Max(1f, module.Depth);
            return new StationBox(
                module.X, module.Y, module.Z,
                module.X + width, module.Y + depth, module.Z + 1f);
        }

        /// <summary>Drop the states of worlds that are already disposed; never a live one.</summary>
        protected void Purge() {
            for (int i = states.Count - 1; i >= 0; i--) {
                var state = states[i];
                if (state.World != null && !state.World.IsDisposed) continue;
                foreach (var mesh in state.Meshes) if (mesh) Destroy(mesh);
                foreach (var material in state.Materials) if (material) Destroy(material);
                state.Meshes.Clear();
                state.Materials.Clear();
                state.Modules.Clear();
                states.RemoveAt(i);
            }
        }

        public void Release() => Purge();

        protected static void Destroy(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }

    /// <summary>
    /// Street and platform surfaces: `sidewalk` (2,430 on Zoo), `lawn` (704), `tactile` (77)
    /// and `floor-mark` (45). These are one-cell tiles whose source renders them as
    /// instanced batches, never as 3,256 GameObjects.
    ///
    /// The port combines a readable tile mesh into one mesh per 16×16 chunk and material
    /// (the chunking `StationCellMesher` already uses) and falls back to one instance per
    /// tile when the prefab's mesh is not readable — `Mesh.CombineMeshes` refuses those.
    /// Either way every tile keeps its own world record, so a pick still names the module.
    /// </summary>
    public sealed class StationSurfaceModuleRenderer : StationModuleGroupRenderer {
        protected override string Group => StationModuleClaims.Surfaces;
        public override string Role => StationModuleClaims.Surfaces;

        const int ChunkSize = 16;

        protected override void BuildGroup(StationViewBuildContext context, ModuleFacts[] station, WorldState state) {
            var buckets = new Dictionary<string, List<CombineInstance>>(StringComparer.Ordinal);
            var bucketMaterial = new Dictionary<string, Material>(StringComparer.Ordinal);
            var bucketBounds = new Dictionary<string, Bounds>(StringComparer.Ordinal);
            var bucketLevel = new Dictionary<string, int>(StringComparer.Ordinal);
            var bucketModules = new Dictionary<string, int>(StringComparer.Ordinal);
            var fallback = new List<(ModuleFacts module, RuntimeCatalogue.Entry entry, string key)>();

            for (int i = 0; i < station.Length; i++) {
                var module = station[i];
                if (!Owns(module.Type)) continue;
                if (!TryResolve(context, module, station, out var entry, out var key, out var diagnostic)) {
                    context.ReportUnresolved("module-group", module.Type, module.Id, diagnostic);
                    continue;
                }
                if (!TryPart(entry.prefab, out var mesh, out var material, out var local)) {
                    fallback.Add((module, entry, key));
                    continue;
                }
                if (!mesh.isReadable) {
                    fallback.Add((module, entry, key));
                    continue;
                }
                var chunkX = Mathf.FloorToInt(module.X / (float)ChunkSize);
                var chunkY = Mathf.FloorToInt(module.Y / (float)ChunkSize);
                var bucketKey = chunkX + "," + chunkY + "|" + module.Z + "|" + key;
                if (!buckets.TryGetValue(bucketKey, out var list)) {
                    buckets[bucketKey] = list = new List<CombineInstance>();
                    bucketMaterial[bucketKey] = material;
                    bucketBounds[bucketKey] = new Bounds(Pivot(module, entry), Vector3.zero);
                    bucketLevel[bucketKey] = module.Z;
                }
                var matrix = Matrix4x4.TRS(Pivot(module, entry), ModulePlacement.Rotation(module.Rotation), Vector3.one) * local;
                list.Add(new CombineInstance { mesh = mesh, subMeshIndex = 0, transform = matrix });
                bucketModules.TryGetValue(bucketKey, out int batched);
                bucketModules[bucketKey] = batched + 1;
                var bounds = bucketBounds[bucketKey];
                bounds.Encapsulate(Pivot(module, entry));
                bucketBounds[bucketKey] = bounds;
            }

            foreach (var pair in buckets) {
                var mesh = new Mesh { name = "surface " + pair.Key };
                mesh.indexFormat = pair.Value.Count > 20000
                    ? UnityEngine.Rendering.IndexFormat.UInt32
                    : UnityEngine.Rendering.IndexFormat.UInt16;
                try {
                    mesh.CombineMeshes(pair.Value.ToArray(), true, true);
                } catch (Exception error) {
                    Destroy(mesh);
                    context.ReportUnresolved("surface-combine-failed", "renderer", Role, pair.Key + ": " + error.Message);
                    continue;
                }
                var go = new GameObject("surface " + pair.Key);
                go.transform.SetParent(context.RoleRoot(Role), false);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                var renderer = go.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = bucketMaterial[pair.Key];
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                state.Meshes.Add(mesh);
                // A batch counts as the modules it draws: the coverage figure must not
                // read zero just because the tiles were combined instead of instanced.
                bucketModules.TryGetValue(pair.Key, out int moduleCount);
                state.Count += moduleCount;
                var bounds = bucketBounds[pair.Key];
                context.World.RegisterModule(Role, "", go, "batch",
                    new StationBox(bounds.min.x, bounds.min.z, bounds.min.y, bounds.max.x, bounds.max.z, bounds.max.y),
                    bucketLevel[pair.Key], bucketLevel[pair.Key] + 1);
            }

            // Unreadable tiles are still drawn: one prefab instance each. Zoo's sidewalk and
            // lawn tiles land here when the glTF import does not mark the mesh readable.
            foreach (var item in fallback) {
                Place(context, item.module, item.entry, item.key, state);
            }

            if (state.Count == 0 && buckets.Count == 0) {
                context.ReportUnresolved("surface-empty", "renderer", Role,
                    "No sidewalk/lawn/tactile/floor-mark tile was drawn for this station.");
            }
        }

        /// <summary>The first textured mesh under a prefab, with its transform in prefab space.</summary>
        internal static bool TryPart(GameObject prefab, out Mesh mesh, out Material material, out Matrix4x4 local) {
            mesh = null;
            material = null;
            local = Matrix4x4.identity;
            if (!prefab) return false;
            foreach (var filter in prefab.GetComponentsInChildren<MeshFilter>(true)) {
                if (!filter.sharedMesh) continue;
                var renderer = filter.GetComponent<MeshRenderer>();
                if (!renderer || !renderer.sharedMaterial) continue;
                mesh = filter.sharedMesh;
                material = renderer.sharedMaterial;
                local = filter.transform.localToWorldMatrix;
                return true;
            }
            return false;
        }
    }

    /// <summary>
    /// Street furniture and platform runs: `exit` (2), `guidepost` (2), `vent` (2),
    /// `rail-signal` (2) and the six `track` runs. The track has no prefab in the
    /// catalogue (`track-run` is a generated key), so it is built here as the source's own
    /// run: a ballast box along the span with two rails on top.
    /// </summary>
    public sealed class StationStreetModuleRenderer : StationModuleGroupRenderer {
        protected override string Group => StationModuleClaims.Street;
        public override string Role => StationModuleClaims.Street;

        protected override void BuildGroup(StationViewBuildContext context, ModuleFacts[] station, WorldState state) {
            Material trackMaterial = null;
            for (int i = 0; i < station.Length; i++) {
                var module = station[i];
                if (!Owns(module.Type)) continue;
                if (module.Type == "track") {
                    if (trackMaterial == null) {
                        trackMaterial = new Material(context.Shader) { name = "track run" };
                        var colour = StationMaterials.Colours[StationMaterials.Track];
                        var trackColour = (Color)colour;
                        if (trackMaterial.HasProperty("_BaseColor")) trackMaterial.SetColor("_BaseColor", trackColour.linear);
                        else trackMaterial.color = trackColour;
                        if (trackMaterial.HasProperty("_Smoothness")) trackMaterial.SetFloat("_Smoothness", .15f);
                        state.Materials.Add(trackMaterial);
                    }
                    BuildTrackRun(context, module, trackMaterial, state);
                    continue;
                }
                if (!TryResolve(context, module, station, out var entry, out var key, out var diagnostic)) {
                    context.ReportUnresolved("module-group", module.Type, module.Id, diagnostic);
                    continue;
                }
                Place(context, module, entry, key, state);
            }
        }

        void BuildTrackRun(StationViewBuildContext context, ModuleFacts module, Material material, WorldState state) {
            float width = Mathf.Max(1f, module.Width);
            float depth = Mathf.Max(1f, module.Depth);
            var root = new GameObject((string.IsNullOrEmpty(module.Id) ? "track" : module.Id) + " run");
            root.transform.SetParent(context.RoleRoot(Role), false);
            root.transform.SetPositionAndRotation(ModulePlacement.Position(module, new RuntimeCatalogue.Entry()),
                ModulePlacement.Rotation(module.Rotation));
            // Ballast bed 0.35 m deep under the two rails, rails 0.15 m wide at ±0.72 m.
            var bed = GameObject.CreatePrimitive(PrimitiveType.Cube);
            bed.name = "ballast";
            bed.transform.SetParent(root.transform, false);
            bed.transform.localPosition = new Vector3(width * .5f, -0.18f, depth * .5f);
            bed.transform.localScale = new Vector3(width, 0.36f, depth);
            var bedRenderer = bed.GetComponent<MeshRenderer>();
            bedRenderer.sharedMaterial = material;
            bedRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            var bedCollider = bed.GetComponent<Collider>();
            if (bedCollider) UnityEngine.Object.Destroy(bedCollider);
            for (int side = 0; side < 2; side++) {
                var rail = GameObject.CreatePrimitive(PrimitiveType.Cube);
                rail.name = side == 0 ? "rail left" : "rail right";
                rail.transform.SetParent(root.transform, false);
                rail.transform.localPosition = new Vector3(width * .5f, 0.02f, depth * .5f + (side == 0 ? -0.72f : 0.72f));
                rail.transform.localScale = new Vector3(width, 0.1f, 0.14f);
                var railRenderer = rail.GetComponent<MeshRenderer>();
                railRenderer.sharedMaterial = material;
                railRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                var railCollider = rail.GetComponent<Collider>();
                if (railCollider) UnityEngine.Object.Destroy(railCollider);
            }
            context.World.RegisterModule(Role, module.Id, root, "", BoxOf(module), module.Z, module.Z + 1);
            state.Count++;
        }
    }

    /// <summary>
    /// Concourse equipment: `light` (139), `cctv` (35), `desk` (21), `extinguisher` (18),
    /// `bin` (17), `bench` (14), `shelf` (10), `electrical-cabinet` (8), `tvm` (5), `sink`
    /// (3), `vending` (2), `checkout` (2), `booth` (2), `glass` (2) and `ac-unit` (1). Each
    /// is a catalogue prefab instanced at its authored cell, run centre and rotation.
    /// </summary>
    public sealed class StationEquipmentModuleRenderer : StationModuleGroupRenderer {
        protected override string Group => StationModuleClaims.Equipment;
        public override string Role => StationModuleClaims.Equipment;

        protected override void BuildGroup(StationViewBuildContext context, ModuleFacts[] station, WorldState state) {
            for (int i = 0; i < station.Length; i++) {
                var module = station[i];
                if (!Owns(module.Type)) continue;
                if (!TryResolve(context, module, station, out var entry, out var key, out var diagnostic)) {
                    context.ReportUnresolved("module-group", module.Type, module.Id, diagnostic);
                    continue;
                }
                Place(context, module, entry, key, state);
            }
        }
    }

    /// <summary>
    /// Live display families: `billboard` (97), `tv` (14), `clock` (12), `calligraphy` (8),
    /// `monitor` (5) and `linemap` (4). Each is a catalogue prefab whose screen is painted by
    /// the sign/texture pipeline; this renderer owns the mounted board so the sign renderer
    /// keeps only its own signs (`sign`).
    /// </summary>
    public sealed class StationDisplayModuleRenderer : StationModuleGroupRenderer {
        protected override string Group => StationModuleClaims.Displays;
        public override string Role => StationModuleClaims.Displays;

        protected override void BuildGroup(StationViewBuildContext context, ModuleFacts[] station, WorldState state) {
            for (int i = 0; i < station.Length; i++) {
                var module = station[i];
                if (!Owns(module.Type)) continue;
                if (!TryResolve(context, module, station, out var entry, out var key, out var diagnostic)) {
                    context.ReportUnresolved("module-group", module.Type, module.Id, diagnostic);
                    continue;
                }
                Place(context, module, entry, key, state);
            }
        }
    }
}
