using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Metro.Build;
using Metro.Sim;
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
        /// <summary>
        /// The above-ground structures generated from their saved dimensions: 屋顶 and 柱.
        /// Plan 22 §1 — neither had an owner, so all 308 Tanwei roofs and 73 pillars reported
        /// `no-renderer` and drew nothing.
        /// </summary>
        public const string Structure = "structure";

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
            "electrical-cabinet", "tvm", "sink", "vending", "checkout", "booth", "glass", "ac-unit", "court",
        };

        /// <summary>Types drawn by `StationDisplayModuleRenderer` (one prefab instance each).</summary>
        static readonly HashSet<string> displays = new HashSet<string>(StringComparer.Ordinal) {
            "billboard", "tv", "clock", "calligraphy", "monitor", "linemap",
        };

        /// <summary>Types drawn by `StationStructureModuleRenderer` (generated from the record).</summary>
        static readonly HashSet<string> structure = new HashSet<string>(StringComparer.Ordinal) {
            "roof", "pillar", "hanger",
        };

        public static bool Owns(string type) => type != null && GroupOf(type) != null;

        public static string GroupOf(string type) {
            if (string.IsNullOrEmpty(type)) return null;
            if (surfaces.Contains(type)) return Surfaces;
            if (street.Contains(type)) return Street;
            if (equipment.Contains(type)) return Equipment;
            if (displays.Contains(type)) return Displays;
            if (structure.Contains(type)) return Structure;
            return null;
        }

        public static IEnumerable<string> TypesOf(string role) {
            switch (role) {
                case Surfaces: return surfaces;
                case Street: return street;
                case Equipment: return equipment;
                case Displays: return displays;
                case Structure: return structure;
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
                foreach (var type in structure) yield return type;
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
            /// <summary>
            /// This world's street-artwork connection (plan 16 §5.3): the painted exit
            /// fascia and guidepost plates bound by `StationExitArtwork`. It belongs to the
            /// world, not the renderer, because the renderer singleton stages the candidate
            /// world before the outgoing one is disposed.
            /// </summary>
            public StationExitArtworkScope Faces;
            /// <summary>
            /// This world's 站名 inscriptions (18 §4). Like <see cref="Faces"/> it belongs to
            /// the world, not the renderer singleton, because a candidate world is staged
            /// before the outgoing one is disposed.
            /// </summary>
            public StationCalligraphyArtwork.Scope Calligraphy;
            /// <summary>This world's billboard posters (18 §2): bound per saved slug.</summary>
            public StationDisplayArtwork.Scope Displays;
            /// <summary>
            /// This world's station finish library, acquired only when a head-house floor needs
            /// the source's `floor.concrete` finish (18 §6). Owned by this world, so a staged
            /// candidate never shares it with the outgoing station.
            /// </summary>
            public StationFinishLibrary Finishes;
            /// <summary>
            /// This world's palette, minted on first need and owned by the world. It must not live
            /// on the renderer: the host reuses renderer singletons across staged worlds, and the
            /// outgoing world's disposal would destroy the palette the new world is drawing with.
            /// </summary>
            public StationMaterials Palette;
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

        /// <summary>
        /// Resolve one module's catalogue entry; returns false and reports why not.
        /// A **deliberate** no-view (the second half of a 电视 pair, whose partner draws
        /// the shared housing) returns false with a null diagnostic: it is the design,
        /// not a gap, and the binding report must keep it on the `deliberate:` side.
        /// </summary>
        protected bool TryResolve(StationViewBuildContext context, ModuleFacts module, IReadOnlyList<ModuleFacts> station,
            out RuntimeCatalogue.Entry entry, out string key, out string diagnostic) {
            entry = null;
            key = null;
            diagnostic = null;
            var visual = ModuleViews.Resolve(module, station, context.Catalogue);
            if (visual.Kind == ModuleViewKind.None) return false;
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

        static Vector3 RunCentreOffset(ModuleFacts module) => ModulePlacement.RunCentre(module);

        /// <summary>Instantiate a prefab at the module's pivot and register it for picking.</summary>
        protected BuiltModule Place(StationViewBuildContext context, ModuleFacts module, RuntimeCatalogue.Entry entry,
            string key, WorldState state, string part = "") {
            var parent = context.RoleRoot(Role);
            var go = UnityEngine.Object.Instantiate(entry.prefab, parent, false);
            go.name = (string.IsNullOrEmpty(module.Id) ? "module" : module.Id) + " " + module.Type;
            go.transform.SetPositionAndRotation(ModulePlacement.Resolve(context.Index.GetModule(module.Id), entry, context.Index), ModulePlacement.Rotation(module.Rotation));
            context.World.RegisterModule(Role, module.Id, go, part, null, module.Z, module.Z + 1);
            var built = new BuiltModule { ModuleId = module.Id, Type = module.Type, View = go, Key = key };
            state.Modules.Add(built);
            state.Count++;
            return built;
        }

        /// <summary>
        /// The prefab's own attachment point — the top of its rendered geometry, in prefab
        /// space — measured once per catalogue key. A hung piece has to be aligned by this
        /// rather than by the catalogue's group offset (RCA 15 §1).
        /// </summary>
        readonly Dictionary<string, float> attachHeights = new Dictionary<string, float>(StringComparer.Ordinal);

        /// <summary>
        /// Mount one hung piece under the surface it actually hangs from (RCA 15 §1, port of
        /// `LightModel.build` / `CctvModel.build` with <c>hangCeilingLocal</c>).
        ///
        /// Two things the generic <see cref="StationModuleGroupRenderer.Place"/> cannot do:
        /// resolve **where the support is** (an authored ceiling anchor, an overhead solid,
        /// the virtual street, or a 站台 / 轨道桥 bed), and know **where on the prefab the
        /// attachment is**.
        ///
        /// The second is not academic. Measured on the shipped export, the promoted fixtures bake
        /// the source's **fallback** ceiling into their geometry: `light-rectangular` spans local
        /// 3.92…4.00 and `cctv` 3.52…4.00, i.e. `STOREY_HEIGHT − 1`. A root placed at the cell's
        /// own top (`offset.z = 1`, exactly what the catalogue records) therefore leaves the
        /// housing four metres up in the air. For `light-rectangular-401` — saved at `z = −1`,
        /// ceiling-anchored, so its true ceiling is the street plane at elevation 0 — that is the
        /// light floating at ground level. So the root is placed by aligning the **measured top**
        /// of the prefab to the resolved underside, which corrects the anchored and overhead
        /// branches and leaves the fallback branch alone (there the two offsets agree).
        ///
        /// The record keeps the storey membership from <see cref="StationModuleLevels"/> with the
        /// measured geometry bounds separate, so a fixture is sliced by the storey it belongs to
        /// while its pick box is its real geometry.
        /// </summary>
        protected bool PlaceCeilingFixture(StationViewBuildContext context, ModuleFacts module, ModuleFacts[] station,
            WorldState state, StationCeilingMounts mounts, int storeyHeight,
            Action<ModuleFacts, StationCeilingMounts.Mount, StationBox, bool> placed = null) {
            if (!TryResolve(context, module, station, out var entry, out var key, out var diagnostic)) {
                if (diagnostic != null) context.ReportUnresolved("module-group", module.Type, module.Id, diagnostic);
                return true;
            }
            var mount = mounts.Resolve(module, StationCeilingMounts.FallbackFor(module, storeyHeight));
            var parent = context.RoleRoot(Role);
            var go = UnityEngine.Object.Instantiate(entry.prefab, parent, false);
            go.name = (string.IsNullOrEmpty(module.Id) ? "module" : module.Id) + " " + module.Type;
            // The shared pivot rotates the rectangular prefab into its saved light orientation.
            var rotation = ModulePlacement.Rotation(module);
            var pivot = Pivot(module, entry);
            float attach;
            bool measured = TryAttachHeight(entry, key, out attach);
            float elevation = pivot.y;
            if (measured) {
                elevation = (float)mount.Underside - attach;
            } else {
                context.ReportUnresolved("ceiling-fixture-bounds", module.Type, module.Id,
                    "the prefab exposes no readable mesh bounds, so its attachment point cannot be aligned to " +
                    mount.Underside.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) +
                    " m; the catalogue offset is used unchanged.");
            }
            go.transform.SetPositionAndRotation(new Vector3(pivot.x, elevation, pivot.z), rotation);
            state.Modules.Add(new BuiltModule { ModuleId = module.Id, Type = module.Type, View = go, Key = key });
            state.Count++;
            var grid = StationLevelGrid.FromDocument(context.Document.LevelBase, context.Document.StoreyHeight);
            var bands = StationModuleLevels.Of(module, grid);
            int levelMin = bands.Length > 0 ? bands[0] : StationModuleLevels.Band(grid, module.Z);
            int levelMax = bands.Length > 0 ? bands[bands.Length - 1] : levelMin;
            bool hasBounds = TryDocumentBounds(go.transform, context.Root, out var bounds);
            if (hasBounds) {
                context.World.RegisterModule(Role, module.Id, go, "ceiling-fixture", bounds, levelMin, levelMax, bands);
            } else {
                context.World.RegisterModule(Role, module.Id, go, "ceiling-fixture", BoxOf(module), levelMin, levelMax, bands);
            }
            StationCeilingMounts.Trace(module.Id,
                "saved z=" + module.Z + " ceilingAnchored=" + module.CeilingAnchored + " support=" + mount.SupportName +
                " local=" + mount.Local.ToString("0.###", CultureInfo.InvariantCulture) +
                " underside=" + mount.Underside.ToString("0.###", CultureInfo.InvariantCulture) +
                " attach=" + attach.ToString("0.###", CultureInfo.InvariantCulture) +
                " rootElevation=" + elevation.ToString("0.###", CultureInfo.InvariantCulture) +
                " bands=" + string.Join(",", bands) + " key=" + key);
            placed?.Invoke(module, mount, hasBounds ? bounds : BoxOf(module), hasBounds);
            return true;
        }

        /// <summary>The prefab's attachment point: the top of its geometry in prefab space.</summary>
        bool TryAttachHeight(RuntimeCatalogue.Entry entry, string key, out float attach) {
            attach = 0f;
            if (!string.IsNullOrEmpty(key) && attachHeights.TryGetValue(key, out attach)) return true;
            if (entry?.prefab == null) return false;
            if (!OpeningModuleViews.MeshBoundsIn(entry.prefab.transform, entry.prefab.transform, out var bounds)) return false;
            attach = bounds.max.y;
            if (!string.IsNullOrEmpty(key)) attachHeights[key] = attach;
            return true;
        }


        /// <summary>Document-axis bounds of one module, for records that carry a box.</summary>
        protected static StationBox BoxOf(ModuleFacts module) {
            float width = Mathf.Max(1f, module.Width);
            float depth = Mathf.Max(1f, module.Depth);
            return new StationBox(
                module.X, module.Y, module.Z,
                module.X + width, module.Y + depth, module.Z + 1f);
        }

        /// <summary>
        /// The rendered document box of a placed instance, measured from the mesh bounds
        /// of its parts. <see cref="MeshFilter.sharedMesh"/> is read rather than
        /// <c>Renderer.bounds</c> so it is valid while the staged world root is still
        /// inactive (RCA 14 §2.3 asks for bounds from actual vertices).
        /// </summary>
        protected static bool TryDocumentBounds(Transform content, Transform root, out StationBox bounds) {
            bounds = default;
            if (!OpeningModuleViews.MeshBoundsIn(content, root, out var local)) return false;
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            for (int corner = 0; corner < 8; corner++) {
                var point = new Vector3(
                    (corner & 1) == 0 ? local.min.x : local.max.x,
                    (corner & 2) == 0 ? local.min.y : local.max.y,
                    (corner & 4) == 0 ? local.min.z : local.max.z);
                var document = StationCoordinates.WorldToDocument(root.TransformPoint(point));
                min = Vector3.Min(min, document);
                max = Vector3.Max(max, document);
            }
            bounds = new StationBox(min.x, min.y, min.z, max.x, max.y, max.z);
            return !bounds.IsEmpty;
        }

        internal void AdoptLocalModules(StationWorldView world, ISet<string> ids, IReadOnlyList<StationViewRecord> records) {
            foreach (var state in states) {
                if (state.World != world) continue;
                state.Modules.RemoveAll(module => ids.Contains(module.ModuleId));
                foreach (var record in records) {
                    var module = world.Index.GetModule(record.ModuleId);
                    state.Modules.Add(new BuiltModule { ModuleId = record.ModuleId, Type = module.Type, View = record.View });
                }
                state.Count = state.Modules.Count;
            }
        }

        /// <summary>Drop the states of worlds that are already disposed; never a live one.</summary>
        protected void Purge() {
            for (int i = states.Count - 1; i >= 0; i--) {
                var state = states[i];
                if (state.World != null && !state.World.IsDisposed) continue;
                foreach (var mesh in state.Meshes) if (mesh) Destroy(mesh);
                foreach (var material in state.Materials) if (material) Destroy(material);
                if (state.Finishes != null) {
                    state.Finishes.Dispose();
                    state.Finishes = null;
                }
                state.Meshes.Clear();
                state.Materials.Clear();
                state.Modules.Clear();
                states.RemoveAt(i);
            }
        }

        public void Release() {
            // Plan 16 §5.3: a world's street-artwork scope is released with the world that
            // owns it. `StationWorldView.Dispose` marks the world disposed before calling
            // this, so only the world going away is touched; the staged candidate the host
            // is still building keeps its own scope. This also covers an EditMode/test world
            // that was never activated, whose `OnDestroy` Unity does not call.
            for (int i = states.Count - 1; i >= 0; i--) {
                var state = states[i];
                if (state.World != null && !state.World.IsDisposed) continue;
                if (state.Faces != null) {
                    try { StationExitArtwork.ReleaseScope(state.Faces); } catch (Exception) { /* teardown must not block the next station */ }
                    state.Faces = null;
                }
                if (state.Calligraphy != null) {
                    try { StationCalligraphyArtwork.ReleaseScope(state.Calligraphy); } catch (Exception) { /* teardown must not block the next station */ }
                    state.Calligraphy = null;
                }
                if (state.Displays != null) {
                    try { StationDisplayArtwork.ReleaseScope(state.Displays); } catch (Exception) { /* teardown must not block the next station */ }
                    state.Displays = null;
                }
            }
            Purge();
        }

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

        /// <summary>
        /// How many tactile arm meshes this build composed (RCA 15 §4), so a probe can tell a
        /// composed junction from a tile that merely happened to have no arm.
        /// </summary>
        public int TactileArmParts { get; private set; }

        /// <summary>How many sidewalk/lawn tiles this build left out (`outdoorSurfaceHidden`).</summary>
        public int HiddenTiles { get; private set; }

        SurfaceHidden lastHidden;

        /// <summary>
        /// Runs at street level whose **corridor** sweep is not ported into the tile exclusion
        /// (`rampOpeningAt`): only their landing cells are excluded. Reported by name rather than
        /// dropped; the cell mesher reports the same gap as `ramp-openings-not-derived`.
        /// </summary>
        public int UnportedRampRuns => lastHidden?.UnportedRampRuns ?? 0;

        protected override void BuildGroup(StationViewBuildContext context, ModuleFacts[] station, WorldState state) {
            var buckets = new Dictionary<string, List<CombineInstance>>(StringComparer.Ordinal);
            var bucketMaterial = new Dictionary<string, Material>(StringComparer.Ordinal);
            var bucketBounds = new Dictionary<string, Bounds>(StringComparer.Ordinal);
            var bucketLevel = new Dictionary<string, int>(StringComparer.Ordinal);
            var bucketIds = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            var bucketBoxes = new Dictionary<string, List<StationBox>>(StringComparer.Ordinal);
            var bucketSpans = new Dictionary<string, List<StationBatchSpan>>(StringComparer.Ordinal);
            var bucketTriangles = new Dictionary<string, int>(StringComparer.Ordinal);
            var bucketItems = new Dictionary<string, List<(ModuleFacts module, RuntimeCatalogue.Entry entry, string key)>>(StringComparer.Ordinal);
            // 20 §4: a batch is grade furniture when the tiles it combines are, and the bucket is
            // keyed by the **exact saved module Z**, so a chunk that happens to span 0 m still
            // answers per elevation instead of by its bounding box.
            var bucketGrade = new Dictionary<string, bool>(StringComparer.Ordinal);
            var fallback = new List<(ModuleFacts module, RuntimeCatalogue.Entry entry, string key)>();
            var parts = new List<SurfacePart>(8);
            TactileArmParts = 0;
            HiddenTiles = 0;
            var hidden = new SurfaceHidden(context.Document, station);
            lastHidden = hidden;

            for (int i = 0; i < station.Length; i++) {
                var module = station[i];
                if (!Owns(module.Type)) continue;
                // RCA 15 §6.2: the same opening description the cell mesher and the exit pad use
                // also decides which tiles are not drawn (`outdoorSurfaceHidden`): a paved tile
                // under an exit's floor plate, a dug void, or a run landing at street level.
                // The record is still registered — with no geometry — so the tile is a **deliberate**
                // no-view carrying its reason, never a silent drop or an unowned family row.
                if (hidden.IsHidden(module, out var hiddenReason)) {
                    HiddenTiles++;
                    var placeholder = new GameObject((string.IsNullOrEmpty(module.Id) ? "tile" : module.Id) + " hidden");
                    placeholder.transform.SetParent(context.RoleRoot(Role), false);
                    placeholder.transform.SetPositionAndRotation(ModulePlacement.Position(module, (RuntimeCatalogue.Entry)null),
                        ModulePlacement.Rotation(module.Rotation));
                    state.Modules.Add(new BuiltModule { ModuleId = module.Id, Type = module.Type, View = placeholder, Key = "" });
                    context.World.RegisterModule(Role, module.Id, placeholder, "hidden", BoxOf(module), module.Z, module.Z + 1);
                    context.ReportUnresolved("outdoor-surface-hidden", module.Type, module.Id, hiddenReason);
                    continue;
                }
                if (!TryResolve(context, module, station, out var entry, out var key, out var diagnostic)) {
                    // A deliberate no-view (pair-panel) has no diagnostic and is not a gap.
                    if (diagnostic != null) context.ReportUnresolved("module-group", module.Type, module.Id, diagnostic);
                    continue;
                }
                EnumerateParts(entry.prefab, parts);
                if (parts.Count == 0) {
                    fallback.Add((module, entry, key));
                    continue;
                }
                bool readable = true;
                for (int p = 0; p < parts.Count; p++) {
                    if (parts[p].Mesh.isReadable) continue;
                    readable = false;
                    break;
                }
                if (!readable) {
                    // `Mesh.CombineMeshes` refuses a non-readable source; the tile is still
                    // drawn as its own prefab instance below rather than dropped.
                    fallback.Add((module, entry, key));
                    continue;
                }
                // RCA 15 §4: derive the warning tile's connectivity from `tactileArms` before
                // batching and append one arm mesh per computed arm. The arm is generated in the
                // tile's own frame (the source rotates the world step back by the tile's `rot`), so
                // it composes under `placement` exactly like the prefab's own parts and a join that
                // crosses a 16×16 chunk boundary is composed by both tiles.
                if (StationTactileArms.Applies(module)) {
                    var arms = StationTactileArms.Arms(module, station);
                    bool strip = string.Equals(module.Config.Text("variant"), "warning-strip", StringComparison.Ordinal);
                    var armMaterial = parts[0].Material;
                    for (int a = 0; a < arms.Count; a++) {
                        // The arm is a **signed** local step: `TactileModel.build` places the
                        // slab at `dx*0.3625, dy*0.3625`, so a west or south arm must be emitted
                        // on that side. The tile's own rotation then maps it to the document edge.
                        var armMesh = TactileArmMesh(strip, arms[a].DX, arms[a].DY);
                        if (!armMesh || !armMaterial) continue;
                        parts.Add(new SurfacePart(armMesh, 0, armMaterial, Matrix4x4.identity));
                        TactileArmParts++;
                    }
                }
                // RCA 16 §3.2: a floor vinyl's authored `cfg.offset` is a **world** offset.
                // The generic pivot is only the cell centre (or the run centre for a
                // multi-cell tile); `FloorMarkPivot` adds the saved offset in document axes,
                // so a boarding mark lands on the doorway `snapBoardingMark` aligned it to.
                var pivot = string.Equals(module.Type, "floor-mark", StringComparison.Ordinal)
                    ? FloorMarkPivot(module, entry)
                    : Pivot(module, entry);
                var placement = Matrix4x4.TRS(pivot, ModulePlacement.Rotation(module.Rotation), Vector3.one);
                var chunkX = Mathf.FloorToInt(module.X / (float)ChunkSize);
                var chunkY = Mathf.FloorToInt(module.Y / (float)ChunkSize);
                // The tile's own document box, so a batched surface contributes one pickable
                // body per authored module instead of one box for a 16 × 16 chunk.
                StationBox tileBox = default;
                bool hasTileBox = !string.IsNullOrEmpty(module.Id) && TryDocumentBounds(placement, parts, out tileBox);
                for (int p = 0; p < parts.Count; p++) {
                    var part = parts[p];
                    // One bucket per material: combining two materials into one mesh would
                    // keep only the first, which is how tile detail went missing. The
                    // prefab key + material name identifies it without an engine id.
                    var bucketKey = chunkX + "," + chunkY + "|" + module.Z + "|" + key + "|" + part.Material.name;
                    if (!buckets.TryGetValue(bucketKey, out var list)) {
                        buckets[bucketKey] = list = new List<CombineInstance>();
                        bucketMaterial[bucketKey] = part.Material;
                        bucketBounds[bucketKey] = new Bounds(pivot, Vector3.zero);
                        bucketLevel[bucketKey] = module.Z;
                        bucketIds[bucketKey] = new List<string>();
                        bucketBoxes[bucketKey] = new List<StationBox>();
                        bucketSpans[bucketKey] = new List<StationBatchSpan>();
                        bucketTriangles[bucketKey] = 0;
                        bucketItems[bucketKey] = new List<(ModuleFacts, RuntimeCatalogue.Entry, string)>();
                        bucketGrade[bucketKey] = string.Equals(module.Type, "sidewalk", StringComparison.Ordinal) ||
                            string.Equals(module.Type, "lawn", StringComparison.Ordinal);
                    }
                    var matrix = placement * part.Local;
                    int startTriangle = bucketTriangles[bucketKey];
                    int partTriangles = part.Mesh.GetTopology(part.Submesh) == MeshTopology.Triangles
                        ? (int)(part.Mesh.GetIndexCount(part.Submesh) / 3)
                        : 0;
                    bucketTriangles[bucketKey] = startTriangle + partTriangles;
                    list.Add(new CombineInstance { mesh = part.Mesh, subMeshIndex = part.Submesh, transform = matrix });
                    var bounds = bucketBounds[bucketKey];
                    EncapsulateTransformed(part.Mesh.bounds, matrix, ref bounds);
                    bucketBounds[bucketKey] = bounds;
                    var ids = bucketIds[bucketKey];
                    int sourceIndex = -1;
                    if (!string.IsNullOrEmpty(module.Id)) {
                        sourceIndex = ids.IndexOf(module.Id);
                        if (sourceIndex < 0) {
                            sourceIndex = ids.Count;
                            ids.Add(module.Id);
                            if (hasTileBox) bucketBoxes[bucketKey].Add(tileBox);
                            else bucketBoxes[bucketKey].Add(BoxOf(module));
                        }
                    }
                    if (sourceIndex >= 0 && partTriangles > 0) {
                        var spans = bucketSpans[bucketKey];
                        if (spans.Count > 0) {
                            var last = spans[spans.Count - 1];
                            if (last.SourceIndex == sourceIndex && last.StartTriangle + last.TriangleCount == startTriangle) {
                                spans[spans.Count - 1] = new StationBatchSpan(sourceIndex, last.StartTriangle,
                                    last.TriangleCount + partTriangles);
                            } else {
                                spans.Add(new StationBatchSpan(sourceIndex, startTriangle, partTriangles));
                            }
                        } else {
                            spans.Add(new StationBatchSpan(sourceIndex, startTriangle, partTriangles));
                        }
                    }
                    var items = bucketItems[bucketKey];
                    if (p == 0) items.Add((module, entry, key));
                }
            }

            var batchedIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var pair in buckets) {
                var mesh = new Mesh { name = "surface " + pair.Key };
                // 32-bit indices are needed by the *vertex* count, not the instance count:
                // a 24-vertex tile combined 3,000 times overflows UInt16 and `CombineMeshes`
                // throws (one 16×16 chunk of Zoo's paving failed exactly this way).
                long vertices = 0;
                for (int i = 0; i < pair.Value.Count; i++) {
                    var source = pair.Value[i].mesh;
                    if (source) vertices += Math.Max(1, source.vertexCount);
                }
                mesh.indexFormat = vertices > 60000 || pair.Value.Count > 20000
                    ? UnityEngine.Rendering.IndexFormat.UInt32
                    : UnityEngine.Rendering.IndexFormat.UInt16;
                try {
                    mesh.CombineMeshes(pair.Value.ToArray(), true, true);
                } catch (Exception error) {
                    Destroy(mesh);
                    // The pieces are drawn individually rather than dropped, and the batch
                    // names why it could not be combined (RCA 14 §2.2 / plan B3).
                    context.ReportUnresolved("surface-combine-failed", "renderer", Role,
                        pair.Key + " (" + bucketIds[pair.Key].Count + " modules): " + error.Message);
                    if (bucketItems.TryGetValue(pair.Key, out var individually)) {
                        for (int i = 0; i < individually.Count; i++) {
                            var item = individually[i];
                            Place(context, item.module, item.entry, item.key, state);
                        }
                    }
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
                for (int i = 0; i < bucketIds[pair.Key].Count; i++) batchedIds.Add(bucketIds[pair.Key][i]);
                var bounds = bucketBounds[pair.Key];
                int band = StationModuleLevels.Band(
                    StationLevelGrid.FromDocument(context.Document.LevelBase, context.Document.StoreyHeight),
                    bucketLevel[pair.Key]);
                context.World.RegisterModule(Role, "", go, "batch",
                    new StationBox(bounds.min.x, bounds.min.z, bounds.min.y, bounds.max.x, bounds.max.z, bounds.max.y),
                    band, band, new[] { band }, bucketIds[pair.Key].ToArray(), bucketBoxes[pair.Key].ToArray(),
                    bucketGrade.TryGetValue(pair.Key, out bool grade) && grade,
                    "batch z=" + bucketLevel[pair.Key].ToString(CultureInfo.InvariantCulture),
                    bucketSpans[pair.Key].ToArray());
            }

            // Unresolved or unreadable tiles are still drawn: one prefab instance each.
            // Zoo's sidewalk and lawn tiles land here when the glTF import does not mark
            // the mesh readable.
            state.Count += batchedIds.Count;
            foreach (var item in fallback) {
                Place(context, item.module, item.entry, item.key, state);
            }

            if (state.Count == 0 && buckets.Count == 0) {
                context.ReportUnresolved("surface-empty", "renderer", Role,
                    "No sidewalk/lawn/tactile/floor-mark tile was drawn for this station.");
            }
        }

        /// <summary>Grow `bounds` by a mesh bound under `matrix`, corner by corner.</summary>
        static void EncapsulateTransformed(Bounds local, Matrix4x4 matrix, ref Bounds bounds) {
            for (int corner = 0; corner < 8; corner++) {
                var point = new Vector3(
                    (corner & 1) == 0 ? local.min.x : local.max.x,
                    (corner & 2) == 0 ? local.min.y : local.max.y,
                    (corner & 4) == 0 ? local.min.z : local.max.z);
                bounds.Encapsulate(matrix.MultiplyPoint3x4(point));
            }
        }

        /// <summary>
        /// One batched tile's own document box, measured from its parts under the placement.
        /// This is the per-module contribution the pick index expands a combined batch into.
        /// </summary>
        static bool TryDocumentBounds(Matrix4x4 placement, List<SurfacePart> parts, out StationBox box) {
            box = default;
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            bool any = false;
            for (int p = 0; p < parts.Count; p++) {
                var part = parts[p];
                if (part.Mesh == null) continue;
                var matrix = placement * part.Local;
                var local = part.Mesh.bounds;
                for (int corner = 0; corner < 8; corner++) {
                    var world = matrix.MultiplyPoint3x4(new Vector3(
                        (corner & 1) == 0 ? local.min.x : local.max.x,
                        (corner & 2) == 0 ? local.min.y : local.max.y,
                        (corner & 4) == 0 ? local.min.z : local.max.z));
                    var document = StationCoordinates.WorldToDocument(world);
                    min = Vector3.Min(min, document);
                    max = Vector3.Max(max, document);
                    any = true;
                }
            }
            if (!any) return false;
            box = new StationBox(min.x, min.y, min.z, max.x, max.y, max.z);
            return !box.IsEmpty;
        }

        /// <summary>
        /// A floor tile's placed pivot, including its authored `cfg.offset`. The source
        /// (`FloorMarkModel.build`) adds the offset to the group's `position.x/y` **after**
        /// `placeLocal`, so it is a document-axis translation, not a local offset under the
        /// tile's turn; `floorDecorBounds` adds it unrotated for the same reason. Every
        /// other surface tile keeps the generic pivot.
        /// </summary>
        public static Vector3 FloorMarkPivot(ModuleFacts module, RuntimeCatalogue.Entry entry) =>
            Pivot(module, entry) + FloorMarkOffset(module);

        /// <summary>A floor mark's saved offset as a Unity-space translation (document axes → world).</summary>
        public static Vector3 FloorMarkOffset(ModuleFacts module) {
            if (module == null ||
                !StationPlatformDoorways.TryMarkOffset(module.Config, out var x, out var y)) return Vector3.zero;
            return StationCoordinates.Point(new Vector3((float)x, (float)y, 0f));
        }

        /// <summary>
        /// The arm geometry `TactileModel.build` adds for one computed arm, in the tile's own
        /// frame: the arm slab and its dot field at the source's **signed** local step
        /// (`dx`, `dy` are each −1, 0 or 1 — RCA 15 §4). The source places the slab at
        /// `dx*0.3625, dy*0.3625`, so a west or south arm is emitted on that side of the tile;
        /// emitting every arm on the local +axis put 14 of the 30 applying Zoo arms on the
        /// wrong side (the oracle's signed arm list is the same fixture). Cached per
        /// (variant, direction) because every warning tile shares the mesh; it belongs to no
        /// world, so it is never destroyed with one.
        /// </summary>
        public static Mesh TactileArmMesh(bool strip, int dx, int dy) {
            if (dx == 0 && dy == 0) return null;
            int slot = (strip ? 4 : 0) + (dx > 0 ? 0 : dx < 0 ? 1 : dy > 0 ? 2 : 3);
            if (tactileArmMeshes[slot]) return tactileArmMeshes[slot];
            var vertices = new List<Vector3>(96);
            var triangles = new List<int>(144);
            // `slab(g, tactile, dx*0.3625, dy*0.3625, .003, dx?0.275:0.45, dy?0.275:0.45, .006)`:
            // the arm reaches from the centre square's edge (.225) to the cell edge (.5), on the
            // side the signed step names.
            BoxFaces.AppendAxisAligned(vertices, triangles,
                new Vector3(dx * .3625f, .003f, dy * .3625f),
                new Vector3(dx != 0 ? .275f : .45f, .006f, dy != 0 ? .275f : .45f));
            // The dot field. A strip's crosswise arm dots sit at along .24/.32/.40 across −.16…+.16;
            // the junction square's at .28/.36/.44 across −.12…+.12 — the source's two grids differ,
            // so they are two meshes and neither duplicates a dot the prefab already draws. The
            // along coordinate keeps the arm's sign.
            float[] along = strip ? StripAlong : SquareAlong;
            float[] across = strip ? StripAcross : SquareAcross;
            for (int i = 0; i < along.Length; i++) {
                for (int j = 0; j < across.Length; j++) {
                    float x = dx != 0 ? dx * along[i] : across[j];
                    float z = dy != 0 ? dy * along[i] : across[j];
                    AppendTactileDot(vertices, triangles, new Vector3(x, .009f, z));
                }
            }
            var mesh = new Mesh {
                name = "tactile arm " + (strip ? "strip" : "warning") + " " + (dx > 0 ? "+x" : dx < 0 ? "-x" : dy > 0 ? "+y" : "-y"),
            };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            tactileArmMeshes[slot] = mesh;
            return mesh;
        }

        static readonly Mesh[] tactileArmMeshes = new Mesh[8];
        static readonly float[] StripAlong = { .24f, .32f, .40f };
        static readonly float[] StripAcross = { -.16f, -.08f, 0f, .08f, .16f };
        static readonly float[] SquareAlong = { .28f, .36f, .44f };
        static readonly float[] SquareAcross = { -.12f, -.04f, .04f, .12f };

        /// <summary>One tactile dot: `CylinderGeometry(.022, .025, .006, 8)` standing on the tile.</summary>
        static void AppendTactileDot(List<Vector3> vertices, List<int> triangles, Vector3 at) {
            const int segments = 8;
            float top = at.y + .003f, bottom = at.y - .003f;
            int start = vertices.Count;
            for (int ring = 0; ring < 2; ring++) {
                float radius = ring == 0 ? .025f : .022f;
                float y = ring == 0 ? bottom : top;
                for (int i = 0; i < segments; i++) {
                    float angle = Mathf.PI * 2f * i / segments;
                    vertices.Add(new Vector3(at.x + Mathf.Cos(angle) * radius, y, at.z + Mathf.Sin(angle) * radius));
                }
            }
            for (int i = 0; i < segments; i++) {
                int next = (i + 1) % segments;
                int a0 = start + i, a1 = start + next, b0 = start + segments + i, b1 = start + segments + next;
                triangles.Add(a0); triangles.Add(a1); triangles.Add(b0);
                triangles.Add(a1); triangles.Add(b1); triangles.Add(b0);
            }
            int caps = vertices.Count;
            vertices.Add(new Vector3(at.x, bottom, at.z));
            vertices.Add(new Vector3(at.x, top, at.z));
            for (int i = 0; i < segments; i++) {
                int next = (i + 1) % segments;
                triangles.Add(caps); triangles.Add(start + next); triangles.Add(start + i);
                triangles.Add(caps + 1); triangles.Add(start + segments + i); triangles.Add(start + segments + next);
            }
        }

        /// <summary>
        /// Port of `outdoorSurfaceHidden` (`sim/placement.ts`) for the two paved families: a tile is
        /// not drawn when its cell is a dug void, when an exit head-house's floor plate covers it, or
        /// when a ramp **crosses the street plane** there (`rampOpeningsInWindow`). The exit plates
        /// are the **same** <see cref="StationExitOpenings"/> description the head-house pad strips
        /// and the cell mesher's ground holes read, so ground, pavers and pad cannot disagree.
        ///
        /// A run's **grade landing is not an opening**: it is the saved pavement the player stands
        /// on when stepping onto the run. Hiding it deleted a one-cell strip of authored `sidewalk`
        /// in front of every at-grade stair — a block stair's terrace left a bare grey band where
        /// the JSON has a filled, paved area. Only the cells a run actually passes through are
        /// excluded, which the source derives from the ramp corridor; block stairs lay none.
        /// </summary>
        public sealed class SurfaceHidden {
            readonly HashSet<long> voids = new HashSet<long>();
            readonly HashSet<long> rampOpenings = new HashSet<long>();
            readonly List<StationExitOpenings> exits = new List<StationExitOpenings>();

            public int UnportedRampRuns { get; private set; }

            public SurfaceHidden(StationDocument document, ModuleFacts[] station) {
                foreach (var cell in document.Cells) if (!cell.IsSolid) voids.Add(CellKey(cell.X, cell.Y, cell.Z));
                foreach (var record in document.Modules) {
                    if (record?.Facts == null || !string.Equals(record.Facts.Type, "exit", StringComparison.Ordinal)) continue;
                    var openings = StationExitOpenings.For(document.Modules, record);
                    if (openings != null && openings.IsHeadHouse) exits.Add(openings);
                }
                if (station != null && station.Length > 0) {
                    var gradeHoles = StationRampOpenings.RampOpeningsAtLevel(station, StationPaintSnapshot.GroundZ);
                    foreach (var hole in gradeHoles) rampOpenings.Add(CellKey(hole.X, hole.Y, hole.Z));
                }
            }

            /// <summary>True when the saved tile must not be drawn; <paramref name="reason"/> names
            /// which rule hid it (a probe reads it, so nothing disappears silently).</summary>
            public bool IsHidden(ModuleFacts module, out string reason) {
                reason = "";
                if (module == null) return false;
                if (!string.Equals(module.Type, "sidewalk", StringComparison.Ordinal) &&
                    !string.Equals(module.Type, "lawn", StringComparison.Ordinal)) return false;
                if (voids.Contains(CellKey(module.X, module.Y, module.Z))) { reason = "void"; return true; }
                for (int i = 0; i < exits.Count; i++) {
                    var exit = exits[i];
                    if (exit.Exit.Facts.Z != module.Z || !exit.CoversCell(module.X, module.Y)) continue;
                    reason = "exit-floor:" + exit.Exit.Facts.Id;
                    return true;
                }
                if (rampOpenings.Contains(CellKey(module.X, module.Y, module.Z))) { reason = "ramp-opening"; return true; }
                return false;
            }

            static long CellKey(int x, int y, int z) =>
                ((long)(x & 0x1FFFFF) << 42) | ((long)(y & 0x1FFFFF) << 21) | (long)(z & 0x1FFFFF);
        }

        /// <summary>One drawable part of a prefab: a single submesh with its own material.</summary>
        public readonly struct SurfacePart {
            public readonly Mesh Mesh;
            public readonly int Submesh;
            public readonly Material Material;
            /// <summary>The part's transform in prefab space.</summary>
            public readonly Matrix4x4 Local;
            public SurfacePart(Mesh mesh, int submesh, Material material, Matrix4x4 local) {
                Mesh = mesh; Submesh = submesh; Material = material; Local = local;
            }
        }

        /// <summary>
        /// Stateless surface-tile part extractor for standalone presentation builders
        /// (<c>StationExplodedTrayBuilder</c>): resolves a single authored surface module's
        /// submeshes, tactile arms, and source-space placement matrix without touching
        /// active-world renderer state.
        /// </summary>
        public static bool TryExtractTileParts(
            ModuleFacts module,
            IReadOnlyList<ModuleFacts> station,
            RuntimeCatalogue catalogue,
            List<SurfacePart> parts,
            out Matrix4x4 placement,
            out string catalogueKey) {
            placement = Matrix4x4.identity;
            catalogueKey = null;
            if (parts == null) throw new ArgumentNullException(nameof(parts));
            parts.Clear();
            if (module == null || catalogue == null) return false;
            var visual = ModuleViews.Resolve(module, station, catalogue);
            if (!visual.HasModel || !catalogue.TryGet(visual.Key, out var entry) || entry == null || entry.prefab == null) {
                return false;
            }
            EnumerateParts(entry.prefab, parts);
            if (parts.Count == 0) return false;
            if (StationTactileArms.Applies(module)) {
                var arms = StationTactileArms.Arms(module, station);
                bool strip = string.Equals(module.Config.Text("variant"), "warning-strip", StringComparison.Ordinal);
                var armMaterial = parts[0].Material;
                for (int a = 0; a < arms.Count; a++) {
                    var armMesh = TactileArmMesh(strip, arms[a].DX, arms[a].DY);
                    if (!armMesh || !armMaterial) continue;
                    parts.Add(new SurfacePart(armMesh, 0, armMaterial, Matrix4x4.identity));
                }
            }
            var pivot = string.Equals(module.Type, "floor-mark", StringComparison.Ordinal)
                ? FloorMarkPivot(module, entry)
                : Pivot(module, entry);
            placement = Matrix4x4.TRS(pivot, ModulePlacement.Rotation(module.Rotation), Vector3.one);
            catalogueKey = visual.Key;
            return true;
        }

        /// <summary>
        /// Every visual part of a prefab: each submesh with the material that draws it,
        /// under its prefab-local transform. The old `TryPart` took the first mesh and
        /// only submesh zero with the renderer's first material, which discarded the
        /// rest of a multi-material tile (RCA 14 §2.2 / plan B3).
        /// </summary>
        public static void EnumerateParts(GameObject prefab, List<SurfacePart> into) {
            into.Clear();
            if (!prefab) return;
            foreach (var filter in prefab.GetComponentsInChildren<MeshFilter>(true)) {
                var mesh = filter ? filter.sharedMesh : null;
                if (!mesh) continue;
                var renderer = filter.GetComponent<MeshRenderer>();
                if (!renderer) continue;
                var materials = renderer.sharedMaterials;
                int submeshes = Mathf.Max(1, mesh.subMeshCount);
                for (int i = 0; i < submeshes; i++) {
                    var material = MaterialAt(materials, i);
                    if (!material) continue;
                    into.Add(new SurfacePart(mesh, i, material, filter.transform.localToWorldMatrix));
                }
            }
        }

        static Material MaterialAt(Material[] materials, int index) {
            if (materials == null || materials.Length == 0) return null;
            return index < materials.Length && materials[index] ? materials[index] : materials[0];
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
            StationCeilingMounts ceilingMounts = null;
            int storeyHeight = Math.Max(1, context.Document.StoreyHeight);
            trackNotes.Clear();
            ExitNotes.Clear();
            WellwayOwners.Clear();
            for (int i = 0; i < station.Length; i++) {
                var module = station[i];
                if (!Owns(module.Type)) continue;
                if (module.Type == "track") {
                    BuildTrackRun(context, module, station, state);
                    continue;
                }
                // RCA 15 §6.1: an exit head-house's floor is built from the shared opening
                // description before the generic place, so the street plane stays open over the run
                // columns the save actually links instead of being masked by the prefab's full pad.
                if (string.Equals(module.Type, "exit", StringComparison.Ordinal) && BuildExit(context, module, station, state)) continue;
                // Plan 16 §5.3: a 导向柱 prints its station and exit plates from the committed
                // document. The promoted pillar is the catalogue's guangzhou export; the plates
                // are replaced on the placed instance before anything else touches it.
                if (string.Equals(module.Type, "guidepost", StringComparison.Ordinal) &&
                    BuildGuidepost(context, module, station, state)) continue;
                // RCA 15 §1: a 风口 is ceiling-hung even though `StationModuleClaims` files it
                // with the street furniture, so this group needs the same mount resolver.
                if (module.CeilingAnchored || StationFootprints.IsCeilingHung(module)) {
                    if (ceilingMounts == null) ceilingMounts = StationCeilingMounts.For(context.Document);
                    if (PlaceCeilingFixture(context, module, station, state, ceilingMounts, storeyHeight)) continue;
                }
                if (!TryResolve(context, module, station, out var entry, out var key, out var diagnostic)) {
                    // A deliberate no-view (pair-panel) has no diagnostic and is not a gap.
                    if (diagnostic != null) context.ReportUnresolved("module-group", module.Type, module.Id, diagnostic);
                    continue;
                }
                Place(context, module, entry, key, state);
            }
            // One bounded request for every plate the street bound; replies arrive as
            // `exit.faceChunk` / `exit.faceReady` and the command handler pumps them in.
            state.Faces?.Cache?.Pump();
        }

        /// <summary>
        /// Per-head-house composition notes (`exit-floor-composed:<n>strips:<n>runs`), one for each
        /// exit whose pad this build rebuilt, plus any gap by name (`exit-pad-not-isolated`). Kept
        /// on the renderer rather than reported as unresolved: a composed plinth is the fix, not a
        /// gap. RCA 15 §6.1.
        /// </summary>
        public List<string> ExitNotes { get; } = new List<string>();

        /// <summary>
        /// One line per wellway: either `&lt;id&gt; clear wells=N` or the enabled layer and
        /// materials that still own a triangle over a well cell. It is the per-layer owner
        /// record the plan asks for; a clear head-house has no survivor line.
        /// </summary>
        public List<string> WellwayOwners { get; } = new List<string>();


        /// <summary>
        /// RCA 15 §6.1 — build an exit head-house's floor from the **shared opening description**
        /// (`StationExitOpenings`, a port of `exitRunOpenings` / `exitLandingBack`) instead of the
        /// prefab's full plinth.
        ///
        /// The promoted prefab bakes its pad over the whole plan, so no transform can cut it to the
        /// runs a save links: the pad parts are retired by their own `exitConcrete` material (the
        /// GLB keeps that much identity) and the strips are drawn between the run openings — one
        /// **terminal landing** at the street edge with its 125 mm riser, the **mouth row** solid
        /// full width under the back rail, and the side strips, each `exitRunHalf` clear of the
        /// wellway so a run's balustrade surfaces through no concrete. Canopy, frame, glass,
        /// railing and header stay the promoted prefab's, so nothing else about the house changes.
        ///
        /// A head-house whose pad cannot be isolated (no `exitConcrete` material, or none retired)
        /// keeps the prefab's pad and says so: `exit-pad-not-isolated`. A doorway or virtual exit
        /// draws no head-house pad at all and falls through to the generic place.
        /// </summary>
        bool BuildExit(StationViewBuildContext context, ModuleFacts module, ModuleFacts[] station, WorldState state) {
            if (!TryResolve(context, module, station, out var entry, out var key, out var diagnostic)) {
                if (diagnostic != null) context.ReportUnresolved("module-group", module.Type, module.Id, diagnostic);
                return true;
            }
            var style = module.Config != null ? module.Config.Text("style") : "";
            var record = ExitRecord(context, module);
            var openings = record != null ? StationExitOpenings.For(context.Document.Modules, record) : null;
            GameObject root;
            if (string.Equals(style, "doorway", StringComparison.Ordinal)) {
                var parent = context.RoleRoot(Role);
                root = UnityEngine.Object.Instantiate(entry.prefab, parent, false);
                root.name = (string.IsNullOrEmpty(module.Id) ? "module" : module.Id) + " " + module.Type;
                var pivot = Pivot(module, entry);
                double mountZ = module.Config != null ? module.Config.Number("mountZ", module.Z + 1) : (module.Z + 1);
                pivot.y += (float)(mountZ - (module.Z + 1));
                root.transform.SetPositionAndRotation(pivot, ModulePlacement.Rotation(module.Rotation));
                ApplyDoorwayCityColour(context.Document != null ? context.Document.City : "", root, state);
                StationExitArtwork.Bind(context, () => FacesFor(context, state), root, module, station, entry.prefabPath);
                if (TryDocumentBounds(root.transform, context.Root, out var bounds)) {
                    context.World.RegisterModule(Role, module.Id, root, "", bounds, module.Z, module.Z + 1);
                } else {
                    context.World.RegisterModule(Role, module.Id, root, "", null, module.Z, module.Z + 1);
                }
                state.Modules.Add(new BuiltModule { ModuleId = module.Id, Type = module.Type, View = root, Key = key });
                state.Count++;
                return true;
            }
            var built = Place(context, module, entry, key, state);
            root = built.View;
            // Plan 16 §5.3: the promoted exit prefabs bake their printed fascia or guide plates
            // from the empty Guangzhou export. Replace those plates with the committed station/exit
            // identity; canopy, frame, glass, railing and posts are left untouched.
            StationExitArtwork.Bind(context, () => FacesFor(context, state), root, module, station, entry.prefabPath);
            if (openings == null || !openings.IsHeadHouse) return true;
            int retired = 0;
            Material concrete = null;
            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer) continue;
                // The promoted export used to tag its plinth **explicitly**: the GLB nodes are
                // named `exit-concrete-base` (the material is `exitConcrete`). A name is
                // the export contract; a substring in a material name was a heuristic that
                // missed a renamed material and left the whole pad in place.
                var nodeName = renderer.transform != null ? renderer.transform.name : "";
                bool pad = nodeName.StartsWith("exit-concrete-base", StringComparison.Ordinal) ||
                    nodeName.StartsWith("exit-pad", StringComparison.Ordinal) ||
                    nodeName.StartsWith("exit-plinth", StringComparison.Ordinal);
                if (!pad) {
                    foreach (var material in renderer.sharedMaterials) {
                        if (!material || material.name.IndexOf("exitConcrete", StringComparison.OrdinalIgnoreCase) < 0) continue;
                        pad = true;
                        break;
                    }
                }
                if (!pad) continue;
                foreach (var material in renderer.sharedMaterials)
                    if (material && concrete == null) concrete = material;
                RetirePadGeometry(renderer);
                retired++;
            }
            if (concrete == null) {
                // The pad-free export carries no concrete material of its own, so the finish
                // comes from its explicit runtime binding: the same `floor.concrete` station
                // finish the web pad draws (`finishSlab(g, ctx.finish('floor.concrete'), …)`),
                // with the source's own metre UVs (18 §6). A missing finish library falls back
                // to the flat concrete palette slot and is named, never silently accepted.
                concrete = ExitConcreteMaterial(context, state);
            }
            if (retired == 0) {
                // New pad-free assets carry nothing to retire: that is the contract, not a gap.
                // A legacy prefab whose pad this has to strip is named so the export is traceable.
                ExitNotes.Add("exit-pad-free:" + module.Id + " pads=" + openings.Pads.Count);
            }
            int padCount = openings.Pads.Count + openings.LandingPads.Count;
            var vertices = new List<Vector3>(padCount * 24);
            var triangles = new List<int>(padCount * 36);
            var uvs = new List<Vector2>(padCount * 24);
            for (int i = 0; i < openings.Pads.Count; i++) {
                var pad = openings.Pads[i];
                // The description is in the exit's own metres (x across the bays, y along the run);
                // the placed root already carries the cell centre and the saved quarter turn.
                BoxFaces.AppendAxisAlignedUv(vertices, triangles, uvs,
                    new Vector3((float)pad.X, (float)(pad.Height / 2), (float)pad.Y),
                    new Vector3((float)pad.Width, (float)pad.Height, (float)pad.Length));
            }
            // The source's per-run concrete landings (`buildExit`): a stair's upper landing is
            // floored even though the corridor below it is open. Escalators have none — their own
            // deck is the landing — so this changes nothing for the two loaded Zoo escalator runs
            // in one column, and closes exactly the 1 m square a stair column would otherwise leave
            // open under the street edge (RCA 16 §5.1).
            for (int i = 0; i < openings.LandingPads.Count; i++) {
                var pad = openings.LandingPads[i];
                BoxFaces.AppendAxisAlignedUv(vertices, triangles, uvs,
                    new Vector3((float)pad.X, (float)(pad.Height / 2), (float)pad.Y),
                    new Vector3((float)pad.Width, (float)pad.Height, (float)pad.Length));
            }
            var mesh = new Mesh { name = (string.IsNullOrEmpty(module.Id) ? "exit" : module.Id) + " pad" };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.SetUVs(0, uvs);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            var strips = new GameObject("exit pad strips");
            strips.transform.SetParent(root.transform, false);
            strips.AddComponent<MeshFilter>().sharedMesh = mesh;
            var stripRenderer = strips.AddComponent<MeshRenderer>();
            stripRenderer.sharedMaterial = concrete;
            stripRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            state.Meshes.Add(mesh);
            ExitNotes.Add("exit-floor-composed:" + openings.Pads.Count + "strips:" + openings.Runs.Count +
                "runs:retired" + retired + ":" + openings.LandingPads.Count + "landing");
            AuditExitWellway(context, module, openings, root);
            return true;
        }

        /// <summary>
        /// The head-house floor's concrete: the station finish the source pad draws
        /// (`floor.concrete`), resolved through the same library the cell mesher builds. It is
        /// acquired on first need and owned by the world, so a staged candidate never shares
        /// the outgoing station's finishes. A missing library falls back to the flat concrete
        /// palette slot and every head-house says so by name (18 §6).
        /// </summary>
        Material ExitConcreteMaterial(StationViewBuildContext context, WorldState state) {
            if (state.Finishes == null) state.Finishes = StationCellRenderer.AcquireLibrary(context.Shader);
            var finish = state.Finishes != null ? state.Finishes.For(StationFinishIds.DefaultMaterial) : null;
            if (finish) return finish;
            ExitNotes.Add("exit-concrete-finish-missing:" + StationFinishIds.DefaultMaterial);
            return TrackMaterial(context, state, "exit concrete", StationMaterials.Platform, .8f, .02f);
        }

        /// <summary>
        /// Take a legacy prefab's baked plinth out of the drawn hierarchy. Switching the
        /// renderer off was not enough: the registered `StationVisibilityTarget` collected it
        /// and the next view-mode pass switched it back on, which is exactly how the street
        /// stayed capped over a wellway (18 §6). The mesh is cleared first so no triangle
        /// survives even the frame in which Unity defers the destroy, every collider under the
        /// node goes, and then the node itself.
        /// </summary>
        static void RetirePadGeometry(MeshRenderer renderer) {
            var filter = renderer.GetComponent<MeshFilter>();
            if (filter) filter.sharedMesh = null;
            renderer.enabled = false;
            foreach (var collider in renderer.GetComponentsInChildren<Collider>(true)) Destroy(collider);
            Destroy(renderer.gameObject);
        }

        /// <summary>
        /// Which layer still owns a triangle over a wellway. After the tagged pad is
        /// retired and the strips are laid from the shared opening description, any
        /// **enabled** renderer whose document plan box covers a wellway cell is a cover
        /// that must be named. A clear exit records none; the note names every survivor by
        /// node and material so the responsible layer is identifiable.
        /// </summary>
        void AuditExitWellway(StationViewBuildContext context, ModuleFacts module, StationExitOpenings openings,
            GameObject root) {
            var wells = openings.WellwayCells();
            if (wells.Count == 0) return;
            int covered = 0;
            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer || !renderer.enabled) continue;
                var bounds = renderer.bounds;
                var min = StationCoordinates.WorldToDocument(bounds.min);
                var max = StationCoordinates.WorldToDocument(bounds.max);
                for (int i = 0; i < wells.Count; i++) {
                    var cell = wells[i];
                    if (max.x <= cell.X || min.x >= cell.X + 1 || max.z <= cell.Y || min.z >= cell.Y + 1) continue;
                    if (max.y <= cell.Z || min.y >= cell.Z + 1.2f) continue;
                    covered++;
                    var materialNames = new StringBuilder();
                    var sharedMaterials = renderer.sharedMaterials;
                    for (int m = 0; m < sharedMaterials.Length; m++) {
                        var material = sharedMaterials[m];
                        if (!material) continue;
                        if (materialNames.Length > 0) materialNames.Append(',');
                        materialNames.Append(material.name);
                    }
                    WellwayOwners.Add(module.Id + " well=" + cell.X + "," + cell.Y + "," + cell.Z +
                        " layer=" + (renderer.transform != null ? renderer.transform.name : "?") +
                        " materials=" + materialNames);
                    break;
                }
            }
            if (covered == 0) {
                WellwayOwners.Add(module.Id + " clear wells=" + wells.Count);
            } else {
                context.ReportUnresolved("exit-wellway-covered", module.Type, module.Id,
                    covered + " enabled renderer(s) still cover a wellway of " + module.Id + ": " +
                    string.Join("; ", WellwayOwners.FindAll(note => note.StartsWith(module.Id + " ", StringComparison.Ordinal))));
            }
        }

        /// <summary>
        /// Plan 16 §5.3 — a 导向柱's printed plates. The promoted `Guidepost.prefab` is the
        /// source builder's Guangzhou export: its station face (two upper 256×277 plates and
        /// one tall 256×993 rear plate) and its square exit letter plate are baked from the
        /// empty review document. `StationExitArtwork` disables each baked plate and mounts a
        /// replaceable one at the same node, painted from the committed station name/nameEn,
        /// the exit resolved by `cfg.exitId` and the shell locale. The pictogram, logo collar,
        /// column and base stay the promoted prefab's own parts.
        /// </summary>
        bool BuildGuidepost(StationViewBuildContext context, ModuleFacts module, ModuleFacts[] station, WorldState state) {
            if (!TryResolve(context, module, station, out var entry, out var key, out var diagnostic)) {
                if (diagnostic != null) context.ReportUnresolved("module-group", module.Type, module.Id, diagnostic);
                return true;
            }
            var built = Place(context, module, entry, key, state);
            StationExitArtwork.Bind(context, () => FacesFor(context, state), built.View, module, station, entry.prefabPath);
            return true;
        }

        /// <summary>This world's street-artwork scope, created on first need.</summary>
        StationExitArtworkScope FacesFor(StationViewBuildContext context, WorldState state) {
            if (state.Faces != null && state.Faces.gameObject != null) {
                if (state.Faces.World == null) state.Faces.World = context.World;
                return state.Faces;
            }
            state.Faces = StationExitArtwork.CreateScope(context.RoleRoot(Role));
            if (state.Faces != null) state.Faces.World = context.World;
            return state.Faces;
        }

        /// <summary>
        /// `DoorwayExitModel`: recolour `doorwayPanel_*` to `cityStyleFor(city).entranceColour`
        /// when the committed station uses a non-Guangzhou city style.
        /// </summary>
        static void ApplyDoorwayCityColour(string city, GameObject root, WorldState state) {
            if (!root || state == null) return;
            var hex = DoorwayEntranceHex(city);
            if (string.IsNullOrEmpty(hex) || string.Equals(hex, "#c22f28", StringComparison.OrdinalIgnoreCase)) return;
            if (!ColorUtility.TryParseHtmlString(hex, out var srgb)) return;
            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer) continue;
                var materials = renderer.sharedMaterials;
                bool changed = false;
                for (int i = 0; i < materials.Length; i++) {
                    var template = materials[i];
                    if (!template || template.name == null) continue;
                    if (template.name.IndexOf("doorwayPanel", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    var clone = new Material(template) { name = template.name + " (" + city + ")" };
                    if (clone.HasProperty("baseColorFactor")) {
                        bool linearSlot = template.GetColor("baseColorFactor").r < .65f;
                        clone.SetColor("baseColorFactor", linearSlot ? srgb.linear : srgb);
                    }
                    if (clone.HasProperty("_BaseColor")) clone.SetColor("_BaseColor", srgb);
                    if (clone.HasProperty("_Color")) clone.color = srgb;
                    state.Materials.Add(clone);
                    materials[i] = clone;
                    changed = true;
                }
                if (changed) renderer.sharedMaterials = materials;
            }
        }

        static string DoorwayEntranceHex(string city) {
            switch ((city ?? "").Trim().ToLowerInvariant()) {
                case "shenzhen": return "#101b2b";
                case "shanghai": return "#353b35";
                case "beijing": return "#073563";
                case "chengdu": return "#343433";
                case "chongqing": return "#f2f0dd";
                case "wuhan": return "#183b70";
                case "nanjing": return "#14213f";
                default: return "#c22f28";
            }
        }

        /// <summary>The parsed record behind a built module, by id and then by cell.</summary>
        static StationModuleRecord ExitRecord(StationViewBuildContext context, ModuleFacts module) {
            var modules = context.Document.Modules;
            for (int i = 0; i < modules.Count; i++) {
                var record = modules[i];
                if (record?.Facts == null) continue;
                if (!string.IsNullOrEmpty(module.Id) && string.Equals(record.Facts.Id, module.Id, StringComparison.Ordinal)) return record;
            }
            for (int i = 0; i < modules.Count; i++) {
                var record = modules[i];
                if (record?.Facts == null) continue;
                if (record.Facts.X == module.X && record.Facts.Y == module.Y && record.Facts.Z == module.Z &&
                    string.Equals(record.Facts.Type, module.Type, StringComparison.Ordinal)) return record;
            }
            return null;
        }

        /// <summary>
        /// The bridge options a saved `track` run carries (`cfg.bridge`, `cfg.bridgeRailing`) —
        /// null for a run on the ground. The neighbouring-run upright list is only computed for an
        /// overhead run, because that is the only case the source asks for it
        /// (`neighboringGantryPosts` reads the gantry a bridge's own barrier must clear).
        /// </summary>
        static RailBridgeOptions RailBridgeOptionsFor(StationViewBuildContext context, ModuleFacts module,
            ModuleFacts[] station, bool catenary, int thirdRail) {
            if (!module.Config.Bool("bridge")) return null;
            var options = new RailBridgeOptions {
                Railing = module.Config.Text("bridgeRailing"),
                VehicleWidth = StockWidthOf(context, module),
            };
            if (options.Railing.Length == 0) options.Railing = "railing";
            if (catenary) options.NeighborPosts = NeighboringGantryPosts(context, module, station, thirdRail);
            return options;
        }

        /// <summary>`STOCK[line.stock].width` for a track's line, in metres.</summary>
        static float StockWidthOf(StationViewBuildContext context, ModuleFacts module) {
            var line = LineOf(context.Document, module);
            return line != null ? StationRailGeometry.StockWidth(line.Stock) : 0f;
        }

        /// <summary>
        /// Port of `TrackGantry.neighboringGantryPosts`: the uprights **other** runs at the same
        /// elevation stand on the same module seam, expressed in this run's local frame, so the
        /// barrier and its concrete shoulder stop at their faces instead of passing through them.
        /// </summary>
        static IReadOnlyList<Vector2> NeighboringGantryPosts(StationViewBuildContext context, ModuleFacts bridge,
            ModuleFacts[] station, int bridgeSide) {
            var posts = new List<Vector2>();
            float bridgeWidth = Mathf.Max(1f, bridge.Width);
            for (int i = 0; i < station.Length; i++) {
                var other = station[i];
                if (other == null || !string.Equals(other.Type, "track", StringComparison.Ordinal)) continue;
                if (string.Equals(other.Id, bridge.Id, StringComparison.Ordinal)) continue;
                if (other.Z != bridge.Z) continue;
                if (!other.Config.Bool("bridge") && !other.Config.Bool("tunnel") &&
                    !string.Equals(other.Config.Text("catenaryStyle"), "gantry", StringComparison.Ordinal)) continue;
                if (!string.Equals(StationRailGeometry.PowerOf(context.Document, other), "catenary", StringComparison.Ordinal))
                    continue;
                int side = StationRailGeometry.ThirdRailSide(other, station, StationRailGeometry.LineDirectionOf(context.Document, other));
                float offset = StationRailGeometry.TrackSideFixtureOffset(Mathf.Max(1f, other.Depth), StockWidthOf(context, other));
                float centreAcross = (Mathf.Max(1f, other.Depth) - 1f) * .5f;
                // A bridge gantry stands every eight metres from the run's origin.
                for (float x = 0f; x < Mathf.Max(1f, other.Width); x += 8f) {
                    RotateLocal(other.Rotation, x, centreAcross + side * offset, out var dx, out var dy);
                    double globalX = other.X - bridge.X + dx;
                    double globalY = other.Y - bridge.Y + dy;
                    RotateLocal(-bridge.Rotation, globalX, globalY, out var localX, out var localY);
                    if (localX < -.56 || localX > bridgeWidth - .44) continue;
                    posts.Add(new Vector2((float)localX, (float)localY));
                }
            }
            return posts;
        }

        /// <summary>`track.rotateLocal` on doubles (the source's own quarter-turn).</summary>
        static void RotateLocal(int rotation, double i, double j, out double x, out double y) {
            switch (((rotation % 4) + 4) % 4) {
                case 1: x = -j; y = i; break;
                case 2: x = -i; y = -j; break;
                case 3: x = j; y = -i; break;
                default: x = i; y = j; break;
            }
        }

        void BuildTrackRun(StationViewBuildContext context, ModuleFacts module, ModuleFacts[] station, WorldState state) {
            float width = Mathf.Max(1f, module.Width);
            float depth = Mathf.Max(1f, module.Depth);
            var stock = StationRailGeometry.StockOf(context.Document, module);
            float scale = StationRailGeometry.DefaultScale;
            // The promoted formation's own baked scale is the source's station scale; the
            // stock catalogue records it, so the running gear follows the stock drawn on it.
            var catalogue = context.TrainCatalogue;
            if (catalogue != null) {
                var line = LineOf(context.Document, module);
                if (line != null) {
                    var formation = TrainFormations.Select(line.Stock, line.Cars, line.Power, catalogue);
                    if (catalogue.TryGet(formation, out var entry) && entry != null && entry.bakedScale > 0f)
                        scale = entry.bakedScale;
                }
            }
            int thirdRail = StationRailGeometry.ThirdRailSide(module, station,
                StationRailGeometry.LineDirectionOf(context.Document, module));
            bool catenary = string.Equals(StationRailGeometry.PowerOf(context.Document, module), "catenary",
                StringComparison.Ordinal);
            // Plan 22 §1: a bridge run draws a raised deck, edge shoulders and the barrier the
            // save names. `BuildTrackRun` used to drop the whole `cfg.bridge*` group, so Tanwei's
            // four 32 × 3 m bridge runs came out as dug trenches with nothing over them.
            var bridge = RailBridgeOptionsFor(context, module, station, catenary, thirdRail);
            var run = RailRunGeometry.Build(width, depth, scale, thirdRail, catenary, bridge);
            var root = new GameObject((string.IsNullOrEmpty(module.Id) ? "track" : module.Id) + " run");
            root.transform.SetParent(context.RoleRoot(Role), false);
            // `TrackModel.build` positions its group at the track record's **floor elevation**
            // (`mod.z`), not the cell top. Starting at `z + 1` put the ballast and rails one
            // metre up, at platform height.
            root.transform.SetPositionAndRotation(
                StationCoordinates.Point(new Vector3(module.X + .5f, module.Y + .5f, module.Z)),
                ModulePlacement.Rotation(module.Rotation));
            trackNotes.Add(module.Id + " stock=" + stock + " scale=" + scale.ToString("0.###", CultureInfo.InvariantCulture) +
                " power=" + (catenary ? "catenary" : "third-rail") + " " + string.Join(" ", run.Notes));
            var bedMaterial = TrackMaterial(context, state, "track bed", StationMaterials.Platform, .86f, .02f);
            var steelMaterial = TrackMaterial(context, state, "track rail", StationMaterials.Steel, .7f, .55f);
            var darkMaterial = TrackMaterial(context, state, "track hardware", StationMaterials.Dark, .5f, .4f);
            var powerMaterial = TrackMaterial(context, state, "track power", StationMaterials.Warm, .7f, .1f);
            var insulatorMaterial = TrackMaterial(context, state, "track insulator", StationMaterials.Light, .4f, .02f);
            // The deck and barrier materials exist only on a bridge run, so a ground station does
            // not mint two unused materials per track.
            var deckMaterial = bridge != null
                ? TrackMaterial(context, state, "track deck", StationMaterials.Platform, .86f, .02f) : null;
            var panelMaterial = bridge != null
                ? TrackMaterial(context, state, "track barrier panel", StationMaterials.Light, .55f, .04f) : null;
            AddTrackPart(root.transform, run.Bed, bedMaterial, state, "track-bed");
            AddTrackPart(root.transform, run.Deck, deckMaterial, state, "track-deck");
            AddTrackPart(root.transform, run.Steel, steelMaterial, state, "track-rail");
            AddTrackPart(root.transform, run.Dark, darkMaterial, state, "track-hardware");
            AddTrackPart(root.transform, run.Power, powerMaterial, state, "track-power");
            AddTrackPart(root.transform, run.Insulator, insulatorMaterial, state, "track-insulator");
            AddTrackPart(root.transform, run.Panel, panelMaterial, state, "track-barrier-panel");
            var grid = StationLevelGrid.FromDocument(context.Document.LevelBase, context.Document.StoreyHeight);
            var bands = StationModuleLevels.Of(module, grid);
            int levelMin = bands.Length > 0 ? bands[0] : module.Z;
            int levelMax = bands.Length > 0 ? bands[bands.Length - 1] : levelMin;
            if (TryDocumentBounds(root.transform, context.Root, out var bounds)) {
                context.World.RegisterModule(Role, module.Id, root, "track-run", bounds, levelMin, levelMax, bands);
            } else {
                context.World.RegisterModule(Role, module.Id, root, "track-run", BoxOf(module), levelMin, levelMax, bands);
            }
            state.Count++;
        }

        /// <summary>Per-track composition notes (`trackNotes`), one per saved track run.</summary>
        public List<string> TrackNotes => trackNotes;
        readonly List<string> trackNotes = new List<string>();

        Material TrackMaterial(StationViewBuildContext context, WorldState state, string name, int colour,
            float smoothness, float metallic) {
            var shader = context.Shader != null ? context.Shader : Shader.Find("Universal Render Pipeline/Lit");
            var material = new Material(shader) { name = name };
            var value = (Color)StationMaterials.Colours[colour];
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", value.linear);
            else material.color = value;
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", smoothness);
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", metallic);
            state.Materials.Add(material);
            return material;
        }

        static void AddTrackPart(Transform root, RailMeshBin bin, Material material, WorldState state, string name) {
            if (bin.VertexCount == 0) return;
            var mesh = bin.ToMesh(name);
            var part = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            part.transform.SetParent(root, false);
            part.GetComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = part.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            state.Meshes.Add(mesh);
        }

        static StationLineRecord LineOf(StationDocument document, ModuleFacts module) {
            if (document == null || module == null) return null;
            var lineId = module.Config.Text("line");
            for (int i = 0; i < document.Lines.Count; i++) {
                var line = document.Lines[i];
                if (line != null && string.Equals(line.Id, lineId, StringComparison.Ordinal)) return line;
            }
            return null;
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
            StationMaterials palette = null;
            StationCeilingMounts ceilingMounts = null;
            int storeyHeight = Math.Max(1, context.Document.StoreyHeight);
            glassNotes.Clear();
            for (int i = 0; i < station.Length; i++) {
                var module = station[i];
                if (!Owns(module.Type)) continue;
                // A 玻璃板 is generated from the saved run, height, joins and fitted doors (plan
                // 22 §2); the promoted panel could honour none of them.
                if (module.Type == "glass") {
                    if (BuildWallGlass(context, module, station, state)) continue;
                }
                // A booth is authored as a `w × h` room; the promoted TicketBooth prefab
                // measures 5.45 × 3 m, so it can only stand in on an exact size match.
                if (module.Type == "booth") {
                    if (palette == null && context.Shader != null) {
                        palette = new StationMaterials(context.Shader);
                        for (int slot = 0; slot < StationMaterials.Colours.Length; slot++) state.Materials.Add(palette[slot]);
                    }
                    if (BuildBooth(context, module, station, state, palette)) continue;
                }
                // RCA 15 §1: a hung 灯具 / 监控 rides the surface it hangs from, which the
                // generic catalogue placement cannot resolve. The lookup is built lazily so a
                // station with no hung equipment pays nothing.
                if (module.CeilingAnchored || StationFootprints.IsCeilingHung(module)) {
                    if (ceilingMounts == null) ceilingMounts = StationCeilingMounts.For(context.Document);
                    if (PlaceCeilingFixture(context, module, station, state, ceilingMounts, storeyHeight)) continue;
                }
                if (!TryResolve(context, module, station, out var entry, out var key, out var diagnostic)) {
                    // A deliberate no-view (pair-panel) has no diagnostic and is not a gap.
                    if (diagnostic != null) context.ReportUnresolved("module-group", module.Type, module.Id, diagnostic);
                    continue;
                }
                if (module.Type == "court") {
                    PlaceCourt(context, module, entry, key, state);
                    continue;
                }
                Place(context, module, entry, key, state);
            }
        }

        /// <summary>
        /// Place one ball-court bay (`court-pickleball`, `court-badminton`) or portable divider
        /// (`court-divider`). `CourtModel.ts` bakes the 14×7 m / 2×1 m bay extent relative to
        /// anchor cell (0, 0) and calls `placeLocal` at `(x + 0.5, y + 0.5, z + 1)`, while saved
        /// records omit `w` and `d`; registering the measured rendered box here keeps scene
        /// picking and selection accurate even when the world is staged or another floor starts
        /// active.
        /// </summary>
        void PlaceCourt(StationViewBuildContext context, ModuleFacts module, RuntimeCatalogue.Entry entry,
            string key, WorldState state) {
            var parent = context.RoleRoot(Role);
            var go = UnityEngine.Object.Instantiate(entry.prefab, parent, false);
            go.name = (string.IsNullOrEmpty(module.Id) ? "module" : module.Id) + " " + module.Type;
            go.transform.SetPositionAndRotation(ModulePlacement.Position(module, entry), ModulePlacement.Rotation(module.Rotation));
            var grid = StationLevelGrid.FromDocument(context.Document.LevelBase, context.Document.StoreyHeight);
            int band = StationModuleLevels.Band(grid, module.Z);
            if (TryDocumentBounds(go.transform, context.Root, out var bounds)) {
                context.World.RegisterModule(Role, module.Id, go, key, bounds, band, band, new[] { band });
            } else {
                context.World.RegisterModule(Role, module.Id, go, key, null, band, band, new[] { band });
            }
            state.Modules.Add(new BuiltModule { ModuleId = module.Id, Type = module.Type, View = go, Key = key });
            state.Count++;
        }



        /// <summary>
        /// Place one ticket booth on its authored <c>w × h</c> rectangle. The promoted
        /// model may only stand in when its measured plan matches that rectangle; the
        /// canonical prefab is 5.45 × 3 m, so Zoo's 3 × 3 booths are drawn by the
        /// dimension-aware builder instead (RCA 14 §3.4 / plan C2). The record carries
        /// the measured bounds and the storey band, and a builder approximation rides a
        /// named caveat.
        /// </summary>
        bool BuildBooth(StationViewBuildContext context, ModuleFacts module, ModuleFacts[] station, WorldState state,
            StationMaterials palette) {
            var grid = StationLevelGrid.FromDocument(context.Document.LevelBase, context.Document.StoreyHeight);
            int band = StationModuleLevels.Band(grid, module.Z);
            if (palette != null) {
                GameObject generated = null;
                string note = "";
                try {
                    BoothModuleViews.TryBuild(module, context.RoleRoot(Role), palette, out generated, out note);
                } catch (Exception error) {
                    generated = null;
                    note = error.GetType().Name + ": " + error.Message;
                }
                if (generated != null) {
                    state.Modules.Add(new BuiltModule {
                        ModuleId = module.Id, Type = module.Type, View = generated, Key = "generated:booth",
                    });
                    state.Count++;
                    if (!string.IsNullOrEmpty(note)) {
                        context.ReportUnresolved("booth-caveat", module.Type, module.Id, note);
                    }
                    if (TryDocumentBounds(generated.transform, context.Root, out var bounds)) {
                        context.World.RegisterModule(Role, module.Id, generated, "booth", bounds, band, band, new[] { band });
                    } else {
                        context.World.RegisterModule(Role, module.Id, generated, "booth", BoxOf(module), band, band, new[] { band });
                    }
                    return true;
                }
                context.ReportUnresolved("booth-build-failed", module.Type, module.Id,
                    "the dimensioned booth could not be built" + (string.IsNullOrEmpty(note) ? "." : ": " + note));
            }
            // No shader or a failed assembly: the promoted prefab is the only remaining
            // geometry, and it is reported because its dimensions are not the saved ones.
            if (!TryResolve(context, module, station, out var entry, out var key, out var diagnostic)) {
                if (diagnostic != null) context.ReportUnresolved("module-group", module.Type, module.Id, diagnostic);
                return true;
            }
            int width = Mathf.Max(1, module.Width), depth = Mathf.Max(1, module.Depth);
            context.ReportUnresolved("booth-prefab-fallback", module.Type, module.Id,
                "the canonical booth prefab stands in for the saved " + width + "×" + depth + " m booth.");
            Place(context, module, entry, key, state);
            return true;
        }

        /// <summary>
        /// One authored 玻璃板 / 玻璃幕墙 (plan 22 §2). The promoted `curtain-wall` prefab is one
        /// fixed 2 × 4 m panel with an uninterrupted pane, so instancing it could not honour a
        /// saved run, a `curtainHeight` override, a corner join or a fitted door's opening — and
        /// its catalogue pivot is the panel's own centre, while the source places a
        /// floor-standing curtain on the tile's **leading edge** (0.45 m off the cell centre).
        /// That missing offset is what left a 0.41 m gap between `curtain-wall-434` and the
        /// `door-glass-1-437` fitted into it.
        ///
        /// The frame and panes are therefore generated exactly as `GlassModel.ts:buildGlass`
        /// draws them: one sill, one head and two end posts around the whole run, one pane
        /// between them, the `curtainCornerJoin` end-post trim and the `curtainDoorShare` lower
        /// opening. Storey membership is the envelope midpoint band, and the record carries the
        /// measured rendered bounds instead of the raw record Z.
        /// </summary>
        bool BuildWallGlass(StationViewBuildContext context, ModuleFacts module, ModuleFacts[] station, WorldState state) {
            var materials = Palette(context, state);
            var record = RecordOf(context, module);
            var spec = StationFootprints.GlassSpec(module.Config);
            int run = module.Width > 0 ? module.Width : spec.W;
            bool floorStanding = StationFootprints.GlassStandsOnFloor(module.Config);
            // The group origin: the run's centre, on the leading edge for a floor-standing
            // curtain (`buildGlass`'s `edgeIn`) or on the cell centre for wall cladding.
            StationFootprints.RotateLocal(module.Rotation, (run - 1) * .5, floorStanding ? GlassEdgeIn : 0,
                out var centreX, out var centreY);
            var root = new GameObject((string.IsNullOrEmpty(module.Id) ? "glass" : module.Id) + " glass");
            root.transform.SetParent(context.RoleRoot(Role), false);
            root.transform.SetPositionAndRotation(
                StationCoordinates.Point(new Vector3(module.X + .5f + (float)centreX, module.Y + .5f + (float)centreY, module.Z + 1f)),
                ModulePlacement.Rotation(module.Rotation));

            var posts = new GlassParts();
            var frame = new GlassParts();
            var panes = new GlassParts();

            float w = run, h = spec.H;
            // A short 玻璃板 is cladding bolted to the wall on its local −y face, 0.44 m off the
            // cell centre; a curtain stands on the tile edge, so its plane is the group origin.
            float across = floorStanding ? 0f : -GlassWallOffset;
            float span = w * .5f;
            const float rail = GlassRail, post = GlassPost, depth = GlassDepth, pane = GlassPane;

            var joined = new HashSet<string>(StringComparer.Ordinal);
            if (floorStanding) {
                // A same-tile crossing trims the end post that would project into the other
                // panel's frame (`curtainCornerJoin`), so two curtains read as one corner.
                for (int i = 0; i < station.Length; i++) {
                    var other = station[i];
                    if (other == null || !string.Equals(other.Type, "glass", StringComparison.Ordinal)) continue;
                    if (string.Equals(other.Id, module.Id, StringComparison.Ordinal)) continue;
                    foreach (var end in GlassCornerJoin(record, RecordOf(context, other))) joined.Add(end);
                }
            }
            float left = -span + (joined.Contains("start") ? post : 0f);
            float right = span - (joined.Contains("end") ? post : 0f);
            float frameX = (left + right) * .5f;
            float frameW = right - left;

            // A 门 fitted into a curtain replaces the lower doorway-sized section of that
            // panel: keep the upper glazing continuous and retain lower glazing only in the run
            // cells the door does not occupy.
            var covered = new HashSet<int>();
            var runCells = GlassCells(module, run);
            float cut = 0f;
            if (floorStanding) {
                for (int i = 0; i < station.Length; i++) {
                    var other = station[i];
                    if (other == null || !string.Equals(other.Type, "door", StringComparison.Ordinal)) continue;
                    var otherRecord = RecordOf(context, other);
                    if (!GlassDoorShare(record, otherRecord)) continue;
                    cut = Mathf.Max(cut, (float)StationFootprints.DoorHeight(otherRecord));
                    foreach (var cell in GlassCells(other, Mathf.Max(1, other.Width))) {
                        int index = runCells.FindIndex(candidate => candidate.X == cell.X && candidate.Y == cell.Y);
                        if (index >= 0) covered.Add(index);
                    }
                }
            }
            if (covered.Count > 0 && cut > 0f) {
                float paneH = Mathf.Max(.05f, h - cut - rail * 2f);
                float upperPostH = Mathf.Max(0f, h - cut - rail * 2f);
                // The transom over the door and the run's head rail.
                frame.Add(frameX, across, cut + rail * .5f, frameW, depth, rail);
                frame.Add(frameX, across, h - rail * .5f, frameW, depth, rail);
                if (!joined.Contains("start")) posts.Add(-(span - post * .5f), across, cut + rail + upperPostH * .5f, post, depth, upperPostH);
                if (!joined.Contains("end")) posts.Add(span - post * .5f, across, cut + rail + upperPostH * .5f, post, depth, upperPostH);
                panes.Add(0f, across + pane, cut + rail + paneH * .5f, Mathf.Max(.05f, w - post * 2f), pane, paneH);
                // Lower sections, one uninterrupted span at a time: door jambs replace the inner
                // end posts wherever the door occupies a cell.
                int cellIndex = 0;
                while (cellIndex < w) {
                    if (covered.Contains(cellIndex)) { cellIndex++; continue; }
                    int first = cellIndex;
                    while (cellIndex + 1 < w && !covered.Contains(cellIndex + 1)) cellIndex++;
                    int last = cellIndex;
                    float lo = first - (w - 1) * .5f - .5f + (first == 0 && joined.Contains("start") ? post : 0f);
                    float hi = last - (w - 1) * .5f + .5f - (last == w - 1 && joined.Contains("end") ? post : 0f);
                    float sectionW = hi - lo;
                    float sectionX = (lo + hi) * .5f;
                    frame.Add(sectionX, across, rail * .5f, sectionW, depth, rail);
                    frame.Add(sectionX, across, cut - rail * .5f, sectionW, depth, rail);
                    panes.Add(sectionX, across + pane, cut * .5f,
                        sectionW - (first == 0 ? post * .5f : 0f) - (last == w - 1 ? post * .5f : 0f),
                        pane, Mathf.Max(.05f, cut - rail * 2f));
                    if (first == 0 && !joined.Contains("start"))
                        posts.Add(-span + post * .5f, across, cut * .5f, post, depth, cut - rail * 2f);
                    if (last == w - 1 && !joined.Contains("end"))
                        posts.Add(span - post * .5f, across, cut * .5f, post, depth, cut - rail * 2f);
                    cellIndex++;
                }
            } else {
                // The outer frame: a sill on the floor, a head at the top and one post at each
                // end of the run, with nothing between them.
                frame.Add(frameX, across, rail * .5f, frameW, depth, rail);
                frame.Add(frameX, across, h - rail * .5f, frameW, depth, rail);
                float postH = Mathf.Max(0f, h - rail * 2f);
                if (!joined.Contains("start")) posts.Add(-(span - post * .5f), across, h * .5f, post, depth, postH);
                if (!joined.Contains("end")) posts.Add(span - post * .5f, across, h * .5f, post, depth, postH);
                panes.Add(0f, across + pane, h * .5f, Mathf.Max(.05f, w - post * 2f), pane,
                    Mathf.Max(.05f, h - rail * 2f));
            }

            posts.Emit(root.transform, state.Meshes, "glass-posts", Mat(materials, StationMaterials.Steel));
            frame.Emit(root.transform, state.Meshes, "glass-frame", Mat(materials, StationMaterials.Dark));
            panes.Emit(root.transform, state.Meshes, "glass-pane", Mat(materials, StationMaterials.Glass));

            state.Modules.Add(new BuiltModule { ModuleId = module.Id, Type = module.Type, View = root, Key = "generated:glass" });
            state.Count++;
            var grid = StationLevelGrid.FromDocument(context.Document.LevelBase, context.Document.StoreyHeight);
            if (!TryDocumentBounds(root.transform, context.Root, out var bounds)) {
                int fallbackBand = StationModuleLevels.Band(grid, module.Z + 1 + h * .5);
                context.World.RegisterModule(Role, module.Id, root, "wall-glass", null, fallbackBand, fallbackBand,
                    new[] { fallbackBand });
                context.ReportUnresolved("glass-bounds-missing", module.Type, module.Id,
                    "the generated curtain has no readable mesh bounds; membership uses the authored envelope.");
                return true;
            }
            int band = StationModuleLevels.Band(grid, (bounds.Z0 + bounds.Z1) * .5);
            context.World.RegisterModule(Role, module.Id, root, "wall-glass", bounds, band, band, new[] { band });
            glassNotes.Add(module.Id + " run=" + run + " height=" + h.ToString("0.##", CultureInfo.InvariantCulture) +
                " mount=" + (floorStanding ? "floor-edge" : "wall") + " doors=" + covered.Count +
                " joined=" + joined.Count);
            return true;
        }

        /* ---------------------------------------------------------- curtain kit */

        /// <summary>`GLASS_FRAME.depth` — every member's stand-off from the wall.</summary>
        const float GlassDepth = .1f;
        /// <summary>`GLASS_FRAME.rail` — the sill's and head's height.</summary>
        const float GlassRail = .1f;
        /// <summary>`GLASS_FRAME.post` — an end post's width.</summary>
        const float GlassPost = .1f;
        /// <summary>`GLASS_FRAME.pane` — how proud of the frame the pane's face sits.</summary>
        const float GlassPane = .02f;
        /// <summary>`GlassModel.ts`'s `WALL_OFFSET`.</summary>
        const float GlassWallOffset = .44f;
        /// <summary>`GLASS_FRAME.depth / 2 − 0.5`: a floor-standing panel's tile edge.</summary>
        const float GlassEdgeIn = GlassDepth * .5f - .5f;

        /// <summary>Accumulated curtain members in the module's own local frame.</summary>
        sealed class GlassParts {
            public readonly List<Vector3> Vertices = new List<Vector3>();
            public readonly List<int> Triangles = new List<int>();
            public readonly List<Vector2> Uvs = new List<Vector2>();

            /// <summary>One member: along the run, across the plane, up from the floor top.</summary>
            public void Add(float x, float across, float up, float sx, float sy, float sz) {
                if (sx <= 0f || sy <= 0f || sz <= 0f) return;
                // Source (along, across, up) → Unity local (along, up, across).
                BoxFaces.AppendUv(Vertices, Triangles, Uvs,
                    new Vector3(x, up, across),
                    new Vector3(sx, 0f, 0f), new Vector3(0f, sz, 0f), new Vector3(0f, 0f, sy));
            }

            public void Emit(Transform parent, List<Mesh> owned, string name, Material material) {
                if (Vertices.Count == 0 || !material) return;
                var mesh = new Mesh { name = name };
                mesh.SetVertices(Vertices);
                mesh.SetTriangles(Triangles, 0);
                mesh.SetUVs(0, Uvs);
                mesh.RecalculateNormals();
                mesh.RecalculateBounds();
                var part = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
                part.transform.SetParent(parent, false);
                part.GetComponent<MeshFilter>().sharedMesh = mesh;
                part.GetComponent<MeshRenderer>().sharedMaterial = material;
                owned.Add(mesh);
            }
        }

        /// <summary>Per-curtain composition notes, one per saved glass module.</summary>
        public List<string> GlassNotes => glassNotes;
        readonly List<string> glassNotes = new List<string>();

        /// <summary>`glassCells`: the run's own cells, marched the way the model draws it.</summary>
        static List<StationPoint> GlassCells(ModuleFacts module, int width) {
            int count = Mathf.Max(1, width);
            var cells = new List<StationPoint>(count);
            for (int i = 0; i < count; i++) {
                StationFootprints.RotateLocal(module.Rotation, i, 0, out var dx, out var dy);
                cells.Add(new StationPoint(module.X + (int)Math.Round(dx), module.Y + (int)Math.Round(dy), module.Z));
            }
            return cells;
        }

        static int GlassRun(StationModuleRecord record) =>
            record.Width > 0 ? record.Width : StationFootprints.GlassSpec(record.Config).W;

        /// <summary>`curtainShareCrossTile`: two floor-standing curtains on opposite sides of one tile.</summary>
        static bool GlassCrossTile(StationModuleRecord a, StationModuleRecord b) {
            if (a == null || b == null) return false;
            if (a.Z != b.Z || StationFootprints.NormRot(a.Rotation) == StationFootprints.NormRot(b.Rotation)) return false;
            if (!StationFootprints.GlassStandsOnFloor(a.Config) || !StationFootprints.GlassStandsOnFloor(b.Config)) return false;
            var cellsA = GlassCells(a.Facts, GlassRun(a));
            var cellsB = GlassCells(b.Facts, GlassRun(b));
            foreach (var cell in cellsA)
                foreach (var other in cellsB)
                    if (cell.X == other.X && cell.Y == other.Y) return true;
            return false;
        }

        /// <summary>
        /// `curtainCornerJoin`: the ends of <paramref name="a"/> whose end-post centre falls
        /// inside <paramref name="b"/>'s own envelope, so the corner's post is drawn once.
        /// </summary>
        static List<string> GlassCornerJoin(StationModuleRecord a, StationModuleRecord b) {
            var ends = new List<string>();
            if (!GlassCrossTile(a, b)) return ends;
            if (!StationFootprints.TryClearance(b, out var other, out _) || other.IsEmpty) return ends;
            int width = GlassRun(a);
            foreach (var end in new[] { "start", "end" }) {
                float endX = end == "start" ? -(width * .5f - GlassPost * .5f) : width * .5f - GlassPost * .5f;
                StationFootprints.RotateLocal(a.Rotation, .5 + (width - 1) * .5, GlassDepth * .5 - .5, out var ox, out var oy);
                StationFootprints.RotateLocal(a.Rotation, endX, 0, out var ex, out var ey);
                double x = a.X + ox + ex, y = a.Y + oy + ey;
                if (x < other.X0 || x >= other.X1 || y < other.Y0 || y >= other.Y1) continue;
                ends.Add(end);
            }
            return ends;
        }

        /// <summary>
        /// `curtainDoorShare`: a 门 fitted into a floor-standing curtain — same storey, same
        /// plane, wholly inside the curtain's run.
        /// </summary>
        static bool GlassDoorShare(StationModuleRecord glass, StationModuleRecord door) {
            if (glass == null || door == null) return false;
            if (glass.Z != door.Z) return false;
            if (StationFootprints.NormRot(glass.Rotation) != StationFootprints.NormRot(door.Rotation)) return false;
            if (!StationFootprints.GlassStandsOnFloor(glass.Config)) return false;
            var wall = new HashSet<string>(StringComparer.Ordinal);
            foreach (var cell in GlassCells(glass.Facts, GlassRun(glass))) wall.Add(cell.X + "," + cell.Y);
            foreach (var cell in GlassCells(door.Facts, Mathf.Max(1, door.Width)))
                if (!wall.Contains(cell.X + "," + cell.Y)) return false;
            return true;
        }

        /// <summary>The parsed record behind a built module, by id and then by cell.</summary>
        static StationModuleRecord RecordOf(StationViewBuildContext context, ModuleFacts module) {
            var modules = context.Document.Modules;
            for (int i = 0; i < modules.Count; i++) {
                var record = modules[i];
                if (record?.Facts == null) continue;
                if (!string.IsNullOrEmpty(module.Id) && string.Equals(record.Facts.Id, module.Id, StringComparison.Ordinal))
                    return record;
            }
            for (int i = 0; i < modules.Count; i++) {
                var record = modules[i];
                if (record?.Facts == null) continue;
                if (record.Facts.X == module.X && record.Facts.Y == module.Y && record.Facts.Z == module.Z &&
                    string.Equals(record.Facts.Type, module.Type, StringComparison.Ordinal)) return record;
            }
            return null;
        }

        /// <summary>This world's palette, minted once and owned by the world.</summary>
        static StationMaterials Palette(StationViewBuildContext context, WorldState state) {
            if (state.Palette != null) return state.Palette;
            var shader = context.Shader != null ? context.Shader : Shader.Find("Universal Render Pipeline/Lit");
            if (!shader) return null;
            state.Palette = new StationMaterials(shader);
            for (int slot = 0; slot < StationMaterials.Colours.Length; slot++) state.Materials.Add(state.Palette[slot]);
            return state.Palette;
        }

        /// <summary>A palette slot, or the shared fallback when this world has no shader.</summary>
        static Material Mat(StationMaterials materials, int slot) =>
            materials != null ? materials[slot] : VerticalModuleViews.DefaultMaterial(slot);
    }

    /// <summary>
    /// Live display families: `billboard` (97), `tv` (14), `clock` (12), `calligraphy` (8),
    /// `monitor` (5) and `linemap` (4). Each is a catalogue prefab whose screen is painted by
    /// the sign/texture pipeline; this renderer owns the mounted board so the sign renderer
    /// keeps only its own signs (`sign`).
    ///
    /// **Hung displays take the mount resolver.** `tv`, `clock` and a ceiling `monitor`
    /// are ceiling-hung in the source (`hangCeilingLocal`), so they go through
    /// <see cref="PlaceCeilingFixture"/> exactly like a light or a CCTV. The promoted
    /// prefabs bake the *fallback* ceiling into their geometry (a storey less a metre), so
    /// generic placement leaves them hanging above a real slab or inside the storey above;
    /// the display path used to ignore the mount context entirely. Wall variants
    /// (`monitor` with `mount: wall`, every billboard/calligraphy/linemap) keep the generic
    /// placement and the prefab's own baked board.
    /// </summary>
    public sealed class StationDisplayModuleRenderer : StationModuleGroupRenderer {
        protected override string Group => StationModuleClaims.Displays;
        public override string Role => StationModuleClaims.Displays;

        /// <summary>
        /// One record per hung display: the support branch, the resolved underside, the
        /// prefab's own attachment point and the resulting measured renderer bounds. A
        /// verifier reads this instead of inferring a mount from a screenshot.
        /// </summary>
        public List<string> CeilingNotes { get; } = new List<string>();

        /// <summary>The newest built display renderer (the television content sink reads it).</summary>
        public static StationDisplayModuleRenderer Active { get; private set; }

        /// <summary>
        /// The inscriptions this world bound (18 §4): one ledger line per 站名 printed from the
        /// committed name, or the reason one could not be. Read by the verifier instead of
        /// inferring the text from a screenshot.
        ///
        /// It is the **live** scope's list, not a copy: a browser-painted plate reports the
        /// face it actually used (and whether that face was missing) after the build returns,
        /// and a verifier reading this must see those lines too.
        /// </summary>
        public IReadOnlyList<string> CalligraphyNotes =>
            Current?.Calligraphy != null && Current.Calligraphy.gameObject != null
                ? (IReadOnlyList<string>)Current.Calligraphy.Notes
                : Array.Empty<string>();

        protected override void BuildGroup(StationViewBuildContext context, ModuleFacts[] station, WorldState state) {
            StationCeilingMounts ceilingMounts = null;
            int storeyHeight = Math.Max(1, context.Document.StoreyHeight);
            Active = this;
            CeilingNotes.Clear();
            BillboardNotes.Clear();
            for (int i = 0; i < station.Length; i++) {
                var module = station[i];
                if (!Owns(module.Type)) continue;
                // A `tv`, a `clock` and a ceiling `monitor` hang from the structure in the source,
                // so the ceiling-mount resolver owns their placement; a wall billboard, a
                // calligraphy run and a line-map board or totem keep the ordinary placement.
                if (StationFootprints.IsCeilingHung(module)) {
                    if (ceilingMounts == null) ceilingMounts = StationCeilingMounts.For(context.Document);
                    int before = state.Modules.Count;
                    if (PlaceCeilingFixture(context, module, station, state, ceilingMounts, storeyHeight,
                            (facts, appliedMount, bounds, hasBounds) => CeilingNotes.Add(
                                DisplayNote(facts, appliedMount, bounds, hasBounds)))) {
                        // 20 §1: **one** binding per emitted root. The mount path built the piece,
                        // so its artwork is bound to exactly that root here instead of by a second
                        // scan that rebound a paired television and lost the second module's
                        // identity.
                        var emitted = before < state.Modules.Count ? state.Modules[before] : null;
                        if (emitted?.View != null) BindArtwork(context, station, state, module, emitted.View);
                        continue;
                    }
                }
                if (!TryResolve(context, module, station, out var entry, out var key, out var diagnostic)) {
                    // A deliberate no-view (pair-panel) has no diagnostic and is not a gap.
                    if (diagnostic != null) context.ReportUnresolved("module-group", module.Type, module.Id, diagnostic);
                    continue;
                }
                var built = Place(context, module, entry, key, state);
                BindArtwork(context, station, state, module, built.View);
            }
            if (state.Calligraphy != null) {
                // Flush the inscriptions' browser requests in one bounded batch now that every
                // plate is bound; a request no transport can carry paints natively here, inside
                // the build, so a headless smoke still commits an inscription.
                state.Calligraphy.Cache?.Pump();
                if (state.Calligraphy.Notes.Count == 0 && state.Calligraphy.Bound >= 0) {
                    state.Calligraphy.Notes.Add("calligraphy-unresolved:no-inscription-bound");
                }
            }
            if (state.Displays != null) BillboardNotes.AddRange(state.Displays.Notes);
            StationDisplayTvArtwork.RegisterContributor();
        }

        /// <summary>
        /// Bind one emitted display root to its own artwork: an inscription prints the committed
        /// name, a billboard its saved slug, a television its per-face board and content rotation,
        /// a clock the simulation's time, a line map the committed city's poster. One seam, so a
        /// root can never be bound twice (20 §1).
        /// </summary>
        void BindArtwork(StationViewBuildContext context, ModuleFacts[] station, WorldState state,
            ModuleFacts module, GameObject root) {
            if (root == null) return;
            switch (module.Type) {
                case "calligraphy":
                    StationCalligraphyArtwork.Bind(context.Document, CalligraphyArtwork(context, state), root,
                        module, context.Font, context.World);
                    break;
                case "billboard":
                    StationDisplayArtwork.BindBillboard(DisplayArtwork(context, state), context.World, root, module);
                    break;
                case "tv":
                    StationDisplayTvArtwork.Bind(DisplayArtwork(context, state), context.World, context.Document,
                        InitialMotionFrame(), true, root, module, station, Time.realtimeSinceStartupAsDouble);
                    break;
                case "clock":
                    StationClockArtwork.Bind(DisplayArtwork(context, state), root, module, ClockFrame(),
                        context.World);
                    break;
                case "linemap":
                    StationLineMapArtwork.Bind(DisplayArtwork(context, state), context.Document, root, module,
                        context.World);
                    break;
            }
        }

        /// <summary>
        /// The motion frame a fresh build starts on: the running session's published snapshot, or
        /// cold boot's 06:30 when a world is built outside a session (an EditMode build, a preview).
        /// </summary>
        static StationMotionFrame InitialMotionFrame() {
            var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            var session = host != null ? (host.Simulation as StationSimulationHost)?.Session : null;
            if (session != null) return session.Snapshot();
            return new StationMotionFrame { Clock = ClockFrame() };
        }

        /// <summary>
        /// The clock a fresh build starts on: the running session's published frame, or cold boot's
        /// 06:30 when a world is built outside a session (an EditMode build, a preview).
        /// </summary>
        static StationClockFrame ClockFrame() {
            var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            var session = host != null ? (host.Simulation as StationSimulationHost)?.Session : null;
            if (session != null) return session.Snapshot().Clock;
            const double boot = 6 * 3600 + 30 * 60;
            return new StationClockFrame {
                Playing = false, DateKey = "2026-01-01", Weekday = 4, Clock = "06:30",
                ClockSeconds = "06:30:00", TimeOfDaySeconds = (int)boot,
                HourHandDegrees = 195, MinuteHandDegrees = 180,
            };
        }

        /// <summary>This world's inscription scope, created on first need.</summary>
        StationCalligraphyArtwork.Scope CalligraphyArtwork(StationViewBuildContext context, WorldState state) {
            if (state.Calligraphy != null && state.Calligraphy.gameObject != null) return state.Calligraphy;
            // The world and the scene font go in with the scope: a browser reply recaptures
            // the plate through the world, and a publish failure paints the native fallback
            // with the font the scene bound.
            state.Calligraphy = StationCalligraphyArtwork.CreateScope(context.RoleRoot(Role), context.World, context.Font);
            return state.Calligraphy;
        }

        /// <summary>
        /// The billboard posters this world bound (18 §2): one ledger line per billboard that
        /// printed its saved slug, or the reason it could not. Read by the verifier instead of
        /// inferring the artwork from a screenshot.
        /// </summary>
        public List<string> BillboardNotes { get; } = new List<string>();

        /// <summary>This world's billboard scope, created on first need.</summary>
        StationDisplayArtwork.Scope DisplayArtwork(StationViewBuildContext context, WorldState state) {
            if (state.Displays != null && state.Displays.gameObject != null) return state.Displays;
            state.Displays = StationDisplayArtwork.CreateScope(context.RoleRoot(Role));
            state.Displays.Font = context.Font;
            return state.Displays;
        }

        static string DisplayNote(ModuleFacts module, StationCeilingMounts.Mount mount, StationBox bounds, bool hasBounds) {
            var text = new StringBuilder();
            text.Append(module.Id).Append(" type=").Append(module.Type)
                .Append(" savedZ=").Append(module.Z)
                .Append(" ceilingAnchored=").Append(module.CeilingAnchored ? "true" : "false")
                .Append(" support=").Append(mount.SupportName)
                .Append(" underside=").Append(mount.Underside.ToString("0.###", CultureInfo.InvariantCulture));
            if (hasBounds) {
                text.Append(" bounds z=").Append(bounds.Z0.ToString("0.###", CultureInfo.InvariantCulture))
                    .Append("..").Append(bounds.Z1.ToString("0.###", CultureInfo.InvariantCulture))
                    .Append(" x=").Append(bounds.X0.ToString("0.###", CultureInfo.InvariantCulture))
                    .Append("..").Append(bounds.X1.ToString("0.###", CultureInfo.InvariantCulture))
                    .Append(" y=").Append(bounds.Y0.ToString("0.###", CultureInfo.InvariantCulture))
                    .Append("..").Append(bounds.Y1.ToString("0.###", CultureInfo.InvariantCulture));
            } else {
                text.Append(" bounds=unmeasured");
            }
            return text.ToString();
        }
    }
}
