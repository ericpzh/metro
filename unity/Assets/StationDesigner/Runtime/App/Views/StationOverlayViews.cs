using System;
using System.Collections.Generic;
using System.Globalization;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace Metro.App.Views {
    /// <summary>
    /// The two information overlays (plan 13 §5, plan 20 §5). Three.js draws them as
    /// separate scene systems over the active storey's floors: the zone map paints the
    /// floor's display zone with the palette colour and prints each contiguous area's
    /// name on a flat plate; the density map paints live occupancy.
    ///
    /// The port had the `view.set zones/density` flags and no draw path at all, so both
    /// toggles changed state and nothing else. This renderer owns
    ///
    /// * the **zone tint** — one quad mesh per palette category, over the same eligible
    ///   floor list the labels read (<see cref="StationZoneMap.FloorsAt"/>), so a wall
    ///   coping, a ceiling plate, cover soil and a buried track bed are never tinted and
    ///   the default 无分区 category is;
    /// * the **zone labels** — one flat 3.2 × 1.2 m plate per region of six or more cells,
    ///   0.06 m over its floor, painted dark/translucent with the category's coloured
    ///   border and the localized name (the source's `CrowdSystem.zoneLabelMaterial`);
    /// * the **density heat map** from the crowd renderer's published poses.
    ///
    /// The two layers have separate geometry and separate rebuild paths: a density refresh
    /// (0.25 s) never touches the zone meshes or the label positions, and those are
    /// retained until the floors, the active level, the locale or the overlay visibility
    /// (Hide UI, the section plane) changes. Everything is registered under the `overlay`
    /// role, which `StationScenePicker` already excludes from picking and
    /// `StationVisibilityRules` treats as editing furniture (hidden by 隐藏UI), and none of
    /// it is ever written into the station document.
    /// </summary>
    public sealed class StationOverlayRenderer : IStationViewRenderer, IStationLocalViewRenderer {
        public const string RoleName = "overlay";

        sealed class StagedOverlayDelta : IStationLocalRendererStage {
            readonly OverlayState state;
            readonly StationDocument nextDoc;
            readonly StationIndex nextIndex;
            readonly HashSet<int> dirtyBands;
            readonly bool invalidateAll;

            public StagedOverlayDelta(OverlayState state, StationDocument nextDoc, StationIndex nextIndex,
                HashSet<int> dirtyBands, bool invalidateAll) {
                this.state = state;
                this.nextDoc = nextDoc;
                this.nextIndex = nextIndex;
                this.dirtyBands = dirtyBands;
                this.invalidateAll = invalidateAll;
            }

            public void Commit(StationWorldView world, StationLocalViewCommit commit) {
                state.Document = nextDoc;
                state.Index = nextIndex;
                if (invalidateAll) {
                    InvalidateAllCachedZones(state);
                    state.ZoneDirty = true;
                } else if (dirtyBands != null && dirtyBands.Count > 0) {
                    int activeBand = nextDoc != null ? StationCoordinates.StoreyBand(state.Level, nextDoc.LevelBase) : state.Level;
                    foreach (int band in dirtyBands) {
                        InvalidateCachedZoneBand(state, band);
                        if (band == activeBand) state.ZoneDirty = true;
                    }
                }
            }

            public void Dispose() { }
        }

        internal sealed class CachedZoneBand {
            public int Band;
            public string Locale = "";
            public bool SectionClipping;
            public float SectionOffset;
            public float SectionAzimuth;
            public Transform ZoneSubRoot;
            public Transform LabelSubRoot;
            public readonly List<StationZoneFloor> Floors = new List<StationZoneFloor>();
            public readonly List<StationZoneLabel> Labels = new List<StationZoneLabel>();
            public readonly List<string> LabelTexts = new List<string>();
            public readonly List<int> LabelInks = new List<int>();
            public readonly List<GameObject> LabelPlates = new List<GameObject>();
            public readonly List<Mesh> ZoneMeshes = new List<Mesh>();
            public readonly List<Material> ZoneMaterials = new List<Material>();
            public readonly List<GameObject> ZoneObjects = new List<GameObject>();
            public int ZoneCells;
            public int LabelInk;
            public string PainterNote = "";

            public bool Matches(string locale, bool clipping, float offset, float azimuth) =>
                string.Equals(Locale, locale, StringComparison.Ordinal) &&
                SectionClipping == clipping &&
                (!clipping || (Mathf.Approximately(SectionOffset, offset) && Mathf.Approximately(SectionAzimuth, azimuth)));
        }

        /// <summary>Zone tints, in `ZONE_PAINT_LIST` order (the palette the labels border with).</summary>
        public static readonly Color32[] ZonePalette = BuildZonePalette();

        /// <summary>The density ramp, cold (empty) to hot (a crowd).</summary>
        static readonly Color32[] DensityRamp = {
            new Color32(64, 120, 220, 60), new Color32(80, 200, 220, 70), new Color32(120, 220, 130, 80),
            new Color32(240, 210, 90, 90), new Color32(245, 150, 70, 100), new Color32(235, 80, 70, 110),
        };

        /// <summary>The source's zone-quad lift over the walking plane (`c.z + 1.02`).</summary>
        public const float ZoneQuadLift = (float)StationZoneMap.QuadLift;
        /// <summary>The source's label lift over the walking plane (`z + 1.06`).</summary>
        public const float LabelLift = (float)StationZoneMap.LabelLift;
        /// <summary>Quads and labels draw after the station, labels after quads (source renderOrder 1/3).</summary>
        public const int ZoneSortingOrder = 1;
        public const int LabelSortingOrder = 3;
        /// <summary>The density refresh interval (`Tick`'s 0.25 s).</summary>
        public const float DensityInterval = .25f;

        /// <summary>Diagnostics `state.overlays` is built from the live state by these keys.</summary>
        public const string StateKey = "overlays";

        static string localeOverride = "";

        /// <summary>
        /// The print locale the labels are set in. The shell pushes language switches
        /// through the one print-locale notice the port has (`exit.locale` →
        /// <see cref="StationExitArtwork.Locale"/>); an explicit <see cref="ApplyLocale"/>
        /// wins for tests and for a host that routes its own notice.
        /// </summary>
        public static string Locale {
            get {
                if (!string.IsNullOrEmpty(localeOverride)) return StationZoneMap.NormalizeLocale(localeOverride);
                return StationZoneMap.NormalizeLocale(StationExitArtwork.Locale);
            }
        }

        /// <summary>Adopt a print locale (`zh-CN` or `en`); the next tick re-keys the labels.</summary>
        public static void ApplyLocale(string locale) => localeOverride = StationZoneMap.NormalizeLocale(locale);

        /// <summary>Fall back to the shell's print locale.</summary>
        public static void ClearLocaleOverride() => localeOverride = "";

        public sealed class OverlayState {
            public StationWorldView World;
            public Transform Root;
            /// <summary>One child root per layer: the zone tint, its labels and the heat map.</summary>
            public Transform ZoneRoot;
            public Transform LabelRoot;
            public Transform DensityRoot;
            public StationDocument Document;
            public StationIndex Index;
            public int Level;
            internal readonly Dictionary<int, CachedZoneBand> CachedZoneBands = new Dictionary<int, CachedZoneBand>();
            internal CachedZoneBand ActiveZoneBand;
            public bool Zones;
            public bool Density;
            public int Revision = -1;
            public float DensityClock;
            public int ZoneCells;
            public int DensityCells;

            /* --------------------------------------------------------- zone layer */
            /// <summary>The eligible floor list the tint and the labels were built from.</summary>
            public readonly List<StationZoneFloor> Floors = new List<StationZoneFloor>();
            /// <summary>One entry per drawn label (the map's, after the section filter).</summary>
            public readonly List<StationZoneLabel> Labels = new List<StationZoneLabel>();
            /// <summary>The labels' localized text, parallel to <see cref="Labels"/>.</summary>
            public readonly List<string> LabelTexts = new List<string>();
            /// <summary>Glyph pixels painted per label, parallel to <see cref="Labels"/>.</summary>
            public readonly List<int> LabelInks = new List<int>();
            /// <summary>The plate GameObjects actually mounted (one per label with a font).</summary>
            public readonly List<GameObject> LabelPlates = new List<GameObject>();
            public readonly List<Mesh> ZoneMeshes = new List<Mesh>();
            public readonly List<Material> ZoneMaterials = new List<Material>();
            public readonly List<GameObject> ZoneObjects = new List<GameObject>();
            /// <summary>The shared 3.2 × 1.2 m plate mesh every label draws.</summary>
            public Mesh PlateMesh;
            /// <summary>Label materials/textures by `locale|display` (`CrowdSystem.zoneLabelMats`).</summary>
            public readonly Dictionary<string, StationZoneLabelPlate> LabelMaterials =
                new Dictionary<string, StationZoneLabelPlate>(StringComparer.Ordinal);
            public string Locale = "";
            public bool ZoneDirty;
            public bool Hidden;
            /// <summary>An explicit 隐藏UI push from the host; the rig's state is OR-ed in.</summary>
            public bool HiddenOverride;
            public bool SectionClipping;
            public float SectionOffset;
            public float SectionAzimuth;
            public int LabelInk;
            public string PainterNote = "";

            /* ------------------------------------------------------ density layer */
            public readonly List<Mesh> DensityMeshes = new List<Mesh>();
            public readonly List<Material> DensityMaterials = new List<Material>();
            public readonly List<GameObject> DensityObjects = new List<GameObject>();

            /* ------------------------------------------------------- diagnostics */
            /// <summary>Every mesh the overlay owns: the `drawCalls` the render diagnostics print.</summary>
            public readonly List<Mesh> Meshes = new List<Mesh>();
            public readonly List<Material> Materials = new List<Material>();

            public int LabelCount => Labels.Count;
            public int ZoneDrawCalls => ZoneMeshes.Count;
            public int DensityDrawCalls => DensityMeshes.Count;
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
                Index = context.Index,
                Root = context.RoleRoot(RoleName),
            };
            // The zone tint, its labels and the heat map are three layers with three
            // lifecycles: a density refresh rebuilds and shows only its own root, and a
            // 隐藏UI pass switches the roots off without touching the built map.
            state.ZoneRoot = LayerRoot(state.Root, "zone tint");
            state.LabelRoot = LayerRoot(state.Root, "zone labels");
            state.DensityRoot = LayerRoot(state.Root, "density");
            states.Add(state);
            instance = this;
            // `state.overlays` diagnostics: the host snapshots its contributors, so the
            // overlay publishes its own payload without a station-owner edit. Nothing is
            // written into the document and no edit path reads it.
            var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            if (host != null) host.RegisterStateContributor(new StationOverlayStateContributor());
        }

        OverlayState StateOf(StationWorldView world) {
            for (var i = states.Count - 1; i >= 0; i--) {
                if (states[i].World == world) return states[i];
            }
            return null;
        }

        public bool TryStageLocalDelta(
            StationLocalDeltaContext context,
            out IStationLocalRendererStage stage,
            out string fallbackReason) {
            stage = null;
            fallbackReason = null;
            var state = StateOf(context.World);
            if (state == null) return true;
            bool invalidateAll = context.PrevDocument != null && context.NextDocument != null &&
                context.PrevDocument.LevelBase != context.NextDocument.LevelBase;
            HashSet<int> dirtyBands = null;
            if (!invalidateAll && context.Delta != null && context.NextDocument != null) {
                int levelBase = context.NextDocument.LevelBase;
                void TouchZ(int z) {
                    dirtyBands ??= new HashSet<int>();
                    dirtyBands.Add(StationCoordinates.StoreyBand(z, levelBase));
                    dirtyBands.Add(StationCoordinates.StoreyBand(z - 1, levelBase));
                    dirtyBands.Add(StationCoordinates.StoreyBand(z + 1, levelBase));
                }
                var delta = context.Delta;
                for (int i = 0; i < delta.RemovedCells.Count; i++) TouchZ(delta.RemovedCells[i].Z);
                for (int i = 0; i < delta.ChangedCells.Count; i++) TouchZ(delta.ChangedCells[i].Z);
                for (int i = 0; i < delta.RemovedModules.Count; i++) {
                    if (context.PrevIndex != null && context.PrevIndex.TryGetModule(delta.RemovedModules[i], out var oldMod) &&
                        oldMod != null && string.Equals(oldMod.Type, "track", StringComparison.Ordinal)) {
                        TouchZ(oldMod.Z);
                    }
                }
                for (int i = 0; i < delta.ChangedModules.Count; i++) {
                    var mod = delta.ChangedModules[i];
                    if (mod != null && string.Equals(mod.Type, "track", StringComparison.Ordinal)) {
                        TouchZ(mod.Z);
                    }
                }
            }
            stage = new StagedOverlayDelta(state, context.NextDocument, context.NextIndex, dirtyBands, invalidateAll);
            return true;
        }

        public void Release() => Purge();

        /// <summary>Publish the current view flags and storey (the rig calls this on change).</summary>
        public void SetView(bool zones, bool density, int level) {
            var state = Current;
            if (state == null) return;
            bool zonesChanged = state.Zones != zones;
            bool levelChanged = state.Level != level;
            bool densityChanged = state.Density != density;
            state.Zones = zones;
            state.Density = density;
            state.Level = level;
            SyncEnvironment(state);
            if (zonesChanged || levelChanged || state.ZoneDirty) RefreshZones(state);
            if (densityChanged) {
                if (density) RefreshDensity(state);
                else ClearDensity(state);
            }
            ApplyVisibility(state);
        }

        /// <summary>
        /// Advance the overlay. The density layer refreshes on its own 0.25 s clock; the
        /// zone layer is only rebuilt when its own state changed (level, floors, locale,
        /// section) or when 隐藏UI / the storey moved its visibility gate.
        /// </summary>
        public void Tick(float deltaSeconds) {
            var state = Current;
            if (state == null) return;
            SyncEnvironment(state);
            if (state.ZoneDirty) RefreshZones(state);
            if (!state.Density) {
                state.DensityClock = 0f;
                ApplyVisibility(state);
                return;
            }
            state.DensityClock += deltaSeconds > 0f ? deltaSeconds : 0f;
            if (state.DensityClock < DensityInterval) {
                ApplyVisibility(state);
                return;
            }
            state.DensityClock = 0f;
            RefreshDensity(state);
            ApplyVisibility(state);
        }

        /* ------------------------------------------------------------- lifecycle */

        /// <summary>
        /// Follow the parts of the view state the overlay does not receive as arguments:
        /// 隐藏UI (the registry maps the `overlay` role to editing furniture, but the
        /// renderer owns the objects it created), the section plane (the tint and its
        /// labels follow their owning floor) and, indirectly, the locale.
        /// </summary>
        void SyncEnvironment(OverlayState state) {
            var rig = StationViewFeature.Active;
            var visibility = rig != null ? rig.Visibility : null;
            bool hideUi = state.HiddenOverride || (visibility != null && visibility.State != null && visibility.State.HideUi);
            state.Hidden = hideUi;
            bool clipping = visibility != null && visibility.SectionClipping;
            var plane = visibility != null ? visibility.Section : StationSectionPlane.Default;
            // A language switch re-keys every label material (locale is part of the plate
            // identity), so it rebuilds the layer like a level change does.
            if (!string.Equals(state.Locale, Locale, StringComparison.Ordinal)) {
                InvalidateAllCachedZones(state);
                state.ZoneDirty = true;
            }
            // Without a section cut the plane's numbers cannot hide anything, so only a
            // clipping change matters; with one on, moving the plane re-cuts the floor.
            bool changed = state.SectionClipping != clipping ||
                           (clipping && (state.SectionOffset != plane.Offset || state.SectionAzimuth != plane.Azimuth));
            if (!changed) return;
            state.SectionClipping = clipping;
            state.SectionOffset = plane.Offset;
            state.SectionAzimuth = plane.Azimuth;
            InvalidateAllCachedZones(state);
            state.ZoneDirty = true;
        }

        /// <summary>Hide/show each built layer without rebuilding it (Hide UI, the toggles).</summary>
        void ApplyVisibility(OverlayState state) {
            bool zonesShown = state.Zones && !state.Hidden;
            bool densityShown = state.Density && !state.Hidden;
            SetRootActive(state.ZoneRoot, zonesShown);
            SetRootActive(state.LabelRoot, zonesShown && state.LabelPlates.Count > 0);
            SetRootActive(state.DensityRoot, densityShown);
        }

        /// <summary>
        /// Explicit 隐藏UI gate for a host (or a test) that pushes the flag itself; the
        /// view rig's own state is still read every tick and OR-ed with this. Hiding only
        /// switches the built objects off — the meshes, the plate materials and every
        /// label anchor are retained for the moment the UI comes back.
        /// </summary>
        public void SetHidden(bool hidden) {
            var state = Current;
            if (state == null) return;
            state.HiddenOverride = hidden;
            state.Hidden = hidden;
            ApplyVisibility(state);
        }

        void RefreshZones(OverlayState state) {
            state.ZoneDirty = false;
            state.Locale = Locale;
            if (!state.Zones || state.Document == null) {
                ClearZones(state);
                ApplyVisibility(state);
                return;
            }
            var rig = StationViewFeature.Active;
            var visibility = rig != null ? rig.Visibility : null;
            bool clipping = visibility != null && visibility.SectionClipping;
            var plane = visibility != null ? visibility.Section : StationSectionPlane.Default;
            int band = StationCoordinates.StoreyBand(state.Level, state.Document.LevelBase);

            if (state.CachedZoneBands.TryGetValue(band, out var cached)) {
                if (cached.Matches(state.Locale, clipping, plane.Offset, plane.Azimuth)) {
                    ActivateZoneBand(state, cached);
                    ApplyVisibility(state);
                    return;
                }
                InvalidateCachedZoneBand(state, band);
            }

            DeactivateActiveZoneBand(state);
            var built = new CachedZoneBand {
                Band = band,
                Locale = state.Locale,
                SectionClipping = clipping,
                SectionOffset = plane.Offset,
                SectionAzimuth = plane.Azimuth,
                ZoneSubRoot = LayerRoot(state.ZoneRoot, "zone band " + band),
                LabelSubRoot = LayerRoot(state.LabelRoot, "label band " + band),
            };

            var floors = StationZoneMap.FloorsAt(state.Document, state.Index, state.Level);
            var kept = new List<StationZoneFloor>(floors.Count);
            var byCategory = new List<Vector3>[StationZoneMap.CategoryCount];
            for (int i = 0; i < floors.Count; i++) {
                var floor = floors[i];
                if (clipping && !plane.Keeps(FloorPoint(floor))) continue;
                kept.Add(floor);
                built.Floors.Add(floor);
                var vertices = byCategory[floor.Display];
                if (vertices == null) byCategory[floor.Display] = vertices = new List<Vector3>();
                AddQuad(vertices, floor);
            }
            built.ZoneCells = kept.Count;
            for (int category = 0; category < byCategory.Length; category++) {
                if (byCategory[category] == null || byCategory[category].Count == 0) continue;
                var tint = StationZoneMap.Category(category).Tint;
                AddZoneBandMesh(state, built, byCategory[category], tint, "zone " + category, ZoneSortingOrder);
            }
            var labels = StationZoneMap.Labels(kept, state.Locale);
            var font = StationOverlayFont.Resolve(state.World != null ? state.World.Font : null);
            if (font == null && labels.Count > 0) built.PainterNote = "no-font";
            for (int i = 0; i < labels.Count; i++) {
                var label = labels[i];
                if (clipping && !plane.Keeps(label.DocumentPoint)) continue;
                built.Labels.Add(label);
                built.LabelTexts.Add(label.Text);
                int ink = AddZoneBandLabel(state, built, label, state.Locale, font);
                built.LabelInks.Add(ink);
                built.LabelInk += ink;
            }
            state.CachedZoneBands[band] = built;
            ActivateZoneBand(state, built);
            ApplyVisibility(state);
        }

        void DeactivateActiveZoneBand(OverlayState state) {
            if (state.ActiveZoneBand != null) {
                SetRootActive(state.ActiveZoneBand.ZoneSubRoot, false);
                SetRootActive(state.ActiveZoneBand.LabelSubRoot, false);
                for (int i = 0; i < state.ActiveZoneBand.ZoneMeshes.Count; i++)
                    state.Meshes.Remove(state.ActiveZoneBand.ZoneMeshes[i]);
                for (int i = 0; i < state.ActiveZoneBand.ZoneMaterials.Count; i++)
                    state.Materials.Remove(state.ActiveZoneBand.ZoneMaterials[i]);
                state.ActiveZoneBand = null;
            }
            state.ZoneObjects.Clear();
            state.LabelPlates.Clear();
            state.ZoneMeshes.Clear();
            state.ZoneMaterials.Clear();
            state.Floors.Clear();
            state.Labels.Clear();
            state.LabelTexts.Clear();
            state.LabelInks.Clear();
            state.ZoneCells = 0;
            state.LabelInk = 0;
            state.PainterNote = "";
        }

        void ActivateZoneBand(OverlayState state, CachedZoneBand band) {
            if (ReferenceEquals(state.ActiveZoneBand, band)) {
                SetRootActive(band.ZoneSubRoot, true);
                SetRootActive(band.LabelSubRoot, true);
                return;
            }
            DeactivateActiveZoneBand(state);
            state.ActiveZoneBand = band;
            SetRootActive(band.ZoneSubRoot, true);
            SetRootActive(band.LabelSubRoot, true);
            state.Floors.AddRange(band.Floors);
            state.Labels.AddRange(band.Labels);
            state.LabelTexts.AddRange(band.LabelTexts);
            state.LabelInks.AddRange(band.LabelInks);
            state.LabelPlates.AddRange(band.LabelPlates);
            state.ZoneObjects.AddRange(band.ZoneObjects);
            state.ZoneMeshes.AddRange(band.ZoneMeshes);
            state.ZoneMaterials.AddRange(band.ZoneMaterials);
            state.Meshes.AddRange(band.ZoneMeshes);
            state.Materials.AddRange(band.ZoneMaterials);
            state.ZoneCells = band.ZoneCells;
            state.LabelInk = band.LabelInk;
            state.PainterNote = band.PainterNote;
        }

        static void DestroyCachedZoneBand(CachedZoneBand band) {
            if (band == null) return;
            DestroyRoot(band.ZoneSubRoot);
            DestroyRoot(band.LabelSubRoot);
            for (int i = 0; i < band.ZoneMeshes.Count; i++) Destroy(band.ZoneMeshes[i]);
            for (int i = 0; i < band.ZoneMaterials.Count; i++) Destroy(band.ZoneMaterials[i]);
            band.ZoneMeshes.Clear();
            band.ZoneMaterials.Clear();
            band.ZoneObjects.Clear();
            band.LabelPlates.Clear();
        }

        static void InvalidateCachedZoneBand(OverlayState state, int band) {
            if (state == null || !state.CachedZoneBands.TryGetValue(band, out var cached)) return;
            if (ReferenceEquals(state.ActiveZoneBand, cached)) {
                for (int i = 0; i < cached.ZoneMeshes.Count; i++) state.Meshes.Remove(cached.ZoneMeshes[i]);
                for (int i = 0; i < cached.ZoneMaterials.Count; i++) state.Materials.Remove(cached.ZoneMaterials[i]);
                state.ActiveZoneBand = null;
                state.ZoneObjects.Clear();
                state.LabelPlates.Clear();
                state.ZoneMeshes.Clear();
                state.ZoneMaterials.Clear();
                state.Floors.Clear();
                state.Labels.Clear();
                state.LabelTexts.Clear();
                state.LabelInks.Clear();
                state.ZoneCells = 0;
                state.LabelInk = 0;
            }
            state.CachedZoneBands.Remove(band);
            DestroyCachedZoneBand(cached);
        }

        static void InvalidateAllCachedZones(OverlayState state) {
            if (state == null) return;
            if (state.ActiveZoneBand != null) {
                for (int i = 0; i < state.ActiveZoneBand.ZoneMeshes.Count; i++)
                    state.Meshes.Remove(state.ActiveZoneBand.ZoneMeshes[i]);
                for (int i = 0; i < state.ActiveZoneBand.ZoneMaterials.Count; i++)
                    state.Materials.Remove(state.ActiveZoneBand.ZoneMaterials[i]);
                state.ActiveZoneBand = null;
            }
            foreach (var pair in state.CachedZoneBands) DestroyCachedZoneBand(pair.Value);
            state.CachedZoneBands.Clear();
            state.ZoneObjects.Clear();
            state.LabelPlates.Clear();
            state.ZoneMeshes.Clear();
            state.ZoneMaterials.Clear();
            state.Floors.Clear();
            state.Labels.Clear();
            state.LabelTexts.Clear();
            state.LabelInks.Clear();
            state.ZoneCells = 0;
            state.LabelInk = 0;
        }

        void AddZoneBandMesh(OverlayState state, CachedZoneBand band, List<Vector3> vertices, Color32 colour, string name, int sortingOrder) {
            if (vertices == null || vertices.Count == 0) return;
            var mesh = new Mesh { name = name };
            if (vertices.Count > 65535) mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            var indices = new int[vertices.Count];
            for (int i = 0; i < indices.Length; i++) indices[i] = i;
            mesh.SetVertices(vertices);
            mesh.SetIndices(indices, MeshTopology.Triangles, 0);
            mesh.RecalculateBounds();
            var go = new GameObject(name);
            go.transform.SetParent(band.ZoneSubRoot, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            var material = CreateMaterial(colour, false);
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.sortingOrder = sortingOrder;
            band.ZoneMeshes.Add(mesh);
            band.ZoneMaterials.Add(material);
            band.ZoneObjects.Add(go);
            Register(state, go, name);
        }

        int AddZoneBandLabel(OverlayState state, CachedZoneBand band, in StationZoneLabel label, string locale, Font font) {
            if (font == null) return 0;
            var plate = ResolveLabelPlate(state, label, locale, font);
            if (plate == null) return 0;
            var go = new GameObject("zone label " + label.Text);
            go.transform.SetParent(band.LabelSubRoot, false);
            go.transform.position = StationCoordinates.Point(label.DocumentPoint);
            go.transform.rotation = Quaternion.identity;
            var mesh = PlateMeshOf(state);
            if (mesh != null) go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = plate.Material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.sortingOrder = LabelSortingOrder;
            band.LabelPlates.Add(go);
            Register(state, go, "zone label");
            return plate.Ink;
        }

        void RefreshDensity(OverlayState state) {
            ClearDensity(state);
            if (!state.Density) return;
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
                AddQuad(quads, x, y, state.Level + 1f + ZoneQuadLift);
                state.DensityCells++;
            }
            var order = new List<int>(byColour.Keys);
            order.Sort();
            foreach (var bucket in order) {
                AddMesh(state, byColour[bucket], DensityRamp[bucket], "density " + bucket, ZoneSortingOrder, zoneLayer: false);
            }
        }

        /* --------------------------------------------------------------- labels */

        /// <summary>
        /// Mount one flat name plate. The anchor arrives in **document axes** and is
        /// converted exactly once, here; the plate mesh is built in Unity axes (x → x,
        /// plan y → z, up → y) so the quad lies flat, faces up and reads the right way up
        /// from above. uv (0,0) is the plate's document (−x, −y) corner, uv (1,1) its
        /// (+x, +y) corner, which is what keeps the glyph rows upright in plan view.
        /// </summary>
        int AddLabel(OverlayState state, in StationZoneLabel label, string locale, Font font) {
            if (font == null) return 0;
            var plate = ResolveLabelPlate(state, label, locale, font);
            if (plate == null) return 0;
            var go = new GameObject("zone label " + label.Text);
            go.transform.SetParent(state.LabelRoot, false);
            go.transform.position = StationCoordinates.Point(label.DocumentPoint);
            go.transform.rotation = Quaternion.identity;
            var mesh = PlateMeshOf(state);
            if (mesh != null) go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = plate.Material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.sortingOrder = LabelSortingOrder;
            state.LabelPlates.Add(go);
            Register(state, go, "label");
            return plate.Ink;
        }

        /// <summary>One plate material per locale + category, exactly the source's cache key.</summary>
        StationZoneLabelPlate ResolveLabelPlate(OverlayState state, in StationZoneLabel label, string locale, Font font) {
            var key = StationZoneLabelPainter.Key(locale, label.Display);
            if (state.LabelMaterials.TryGetValue(key, out var cached)) {
                state.LabelInk += cached.Ink;
                return cached;
            }
            if (!StationZoneLabelPainter.TryPaint(label, locale, font, out var plate, out string note)) {
                if (!string.IsNullOrEmpty(note)) state.PainterNote = note;
                return null;
            }
            plate.Material = StationZoneLabelPainter.CreateMaterial(plate.Texture);
            if (plate.Material == null) {
                note = "no-shader";
                state.PainterNote = note;
                if (plate.Texture) Destroy(plate.Texture);
                return null;
            }
            state.LabelMaterials[key] = plate;
            state.LabelInk += plate.Ink;
            return plate;
        }

        /// <summary>The shared 3.2 × 1.2 m quad: flat, facing up, UVs upright in plan view.</summary>
        Mesh PlateMeshOf(OverlayState state) {
            if (state.PlateMesh) return state.PlateMesh;
            float hw = StationZoneMap.PlateWidth * .5f;
            float hd = StationZoneMap.PlateDepth * .5f;
            var mesh = new Mesh { name = "zone label plate" };
            mesh.SetVertices(new List<Vector3> {
                new Vector3(-hw, 0f, -hd), new Vector3(-hw, 0f, hd),
                new Vector3(hw, 0f, hd), new Vector3(hw, 0f, -hd),
            });
            mesh.SetUVs(0, new List<Vector2> {
                new Vector2(0f, 0f), new Vector2(0f, 1f), new Vector2(1f, 1f), new Vector2(1f, 0f),
            });
            mesh.SetNormals(new List<Vector3> {
                Vector3.up, Vector3.up, Vector3.up, Vector3.up,
            });
            mesh.SetTriangles(new[] { 0, 1, 2, 0, 2, 3 }, 0);
            mesh.RecalculateBounds();
            state.PlateMesh = mesh;
            state.Meshes.Add(mesh);
            return mesh;
        }

        /* ---------------------------------------------------------------- meshes */

        static Vector3 FloorPoint(in StationZoneFloor floor) =>
            new Vector3(floor.X + .5f, floor.Y + .5f, floor.Z + 1f);

        /// <summary>Document (x, y, z) → Unity (x, z, y). One quad per floor cell, full size.</summary>
        static void AddQuad(List<Vector3> vertices, in StationZoneFloor floor) {
            AddQuad(vertices, floor.X, floor.Y, floor.Z + 1f + ZoneQuadLift);
        }

        static void AddQuad(List<Vector3> vertices, int x, int y, float elevation) {
            float x0 = x, x1 = x + 1f, y0 = y, y1 = y + 1f;
            vertices.Add(new Vector3(x0, elevation, y0));
            vertices.Add(new Vector3(x0, elevation, y1));
            vertices.Add(new Vector3(x1, elevation, y1));
            vertices.Add(new Vector3(x0, elevation, y0));
            vertices.Add(new Vector3(x1, elevation, y1));
            vertices.Add(new Vector3(x1, elevation, y0));
        }

        void AddMesh(OverlayState state, List<Vector3> vertices, Color32 colour, string name, int sortingOrder, bool zoneLayer) {
            if (vertices == null || vertices.Count == 0) return;
            var mesh = new Mesh { name = name };
            var indices = new int[vertices.Count];
            for (int i = 0; i < indices.Length; i++) indices[i] = i;
            mesh.SetVertices(vertices);
            mesh.SetIndices(indices, MeshTopology.Triangles, 0);
            mesh.RecalculateBounds();
            var go = new GameObject(name);
            go.transform.SetParent(zoneLayer ? state.ZoneRoot : state.DensityRoot, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            var material = CreateMaterial(colour, false);
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.sortingOrder = sortingOrder;
            state.Meshes.Add(mesh);
            state.Materials.Add(material);
            if (zoneLayer) {
                state.ZoneMeshes.Add(mesh);
                state.ZoneMaterials.Add(material);
                state.ZoneObjects.Add(go);
                // One record per *built* map (a level/locale change), never per 0.25 s
                // density refresh: `StationWorldView.Records` is append-only, so the heat
                // map must not grow it.
                Register(state, go, name);
            } else {
                state.DensityMeshes.Add(mesh);
                state.DensityMaterials.Add(material);
                state.DensityObjects.Add(go);
            }
        }

        void Register(OverlayState state, GameObject go, string part) {
            state.World.RegisterModule(RoleName, "", go, part, null, int.MinValue, int.MaxValue);
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

        /* ------------------------------------------------------------ teardown */

        /// <summary>One layer's root: a switch for the whole layer without a rebuild.</summary>
        static Transform LayerRoot(Transform parent, string name) {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            return go.transform;
        }

        static void SetRootActive(Transform root, bool on) {
            if (root != null && root.gameObject.activeSelf != on) root.gameObject.SetActive(on);
        }

        static void ClearChildren(Transform root) {
            if (root == null) return;
            for (int i = root.childCount - 1; i >= 0; i--) Destroy(root.GetChild(i).gameObject);
        }

        void ClearZones(OverlayState state) {
            InvalidateAllCachedZones(state);
            ClearChildren(state.ZoneRoot);
            ClearChildren(state.LabelRoot);
        }

        void ClearDensity(OverlayState state) {
            ClearChildren(state.DensityRoot);
            for (int i = 0; i < state.DensityMeshes.Count; i++) {
                state.Meshes.Remove(state.DensityMeshes[i]);
                Destroy(state.DensityMeshes[i]);
            }
            for (int i = 0; i < state.DensityMaterials.Count; i++) {
                state.Materials.Remove(state.DensityMaterials[i]);
                Destroy(state.DensityMaterials[i]);
            }
            state.DensityObjects.Clear();
            state.DensityMeshes.Clear();
            state.DensityMaterials.Clear();
            state.DensityCells = 0;
        }

        void ReleaseState(OverlayState state) {
            ClearZones(state);
            ClearDensity(state);
            foreach (var pair in state.LabelMaterials) {
                var plate = pair.Value;
                if (plate == null) continue;
                if (plate.Material) Destroy(plate.Material);
                if (plate.Texture) Destroy(plate.Texture);
                plate.Material = null;
                plate.Texture = null;
            }
            state.LabelMaterials.Clear();
            if (state.PlateMesh) Destroy(state.PlateMesh);
            state.PlateMesh = null;
            DestroyRoot(state.ZoneRoot);
            DestroyRoot(state.LabelRoot);
            DestroyRoot(state.DensityRoot);
            state.ZoneRoot = null;
            state.LabelRoot = null;
            state.DensityRoot = null;
            state.Meshes.Clear();
            state.Materials.Clear();
            state.World = null;
            state.Document = null;
            state.Index = null;
            state.Root = null;
        }

        static void DestroyRoot(Transform root) {
            if (root != null) Destroy(root.gameObject);
        }

        void Purge() {
            for (int i = states.Count - 1; i >= 0; i--) {
                var state = states[i];
                if (state.World != null && !state.World.IsDisposed) continue;
                ReleaseState(state);
                states.RemoveAt(i);
            }
        }

        static void Destroy(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }

        /* --------------------------------------------------------- diagnostics */

        /// <summary>
        /// `state.overlays`: which flags are on, how much of the map drew, and — the part a
        /// verifier needs — every label's count, document anchor, display-zone category,
        /// localized text, colour and painted glyph pixels. Read from the live state; this
        /// never edits the document and never allocates scene objects.
        /// </summary>
        public static JObject StateJson() {
            var state = instance != null ? instance.Current : null;
            var payload = new JObject();
            payload["zones"] = state != null && state.Zones;
            payload["density"] = state != null && state.Density;
            payload["zoneCells"] = state != null ? state.ZoneCells : 0;
            payload["densityCells"] = state != null ? state.DensityCells : 0;
            payload["level"] = state != null ? state.Level : 0;
            payload["drawCalls"] = state != null ? state.Meshes.Count : 0;
            payload["zoneDrawCalls"] = state != null ? state.ZoneDrawCalls : 0;
            payload["densityDrawCalls"] = state != null ? state.DensityDrawCalls : 0;
            payload["labelCount"] = state != null ? state.LabelCount : 0;
            payload["labelPlates"] = state != null ? state.LabelPlates.Count : 0;
            payload["labelInk"] = state != null ? state.LabelInk : 0;
            payload["locale"] = state != null ? state.Locale : Locale;
            payload["hidden"] = state != null && state.Hidden;
            payload["sectionClipping"] = state != null && state.SectionClipping;
            payload["painterNote"] = state != null ? state.PainterNote : "";
            payload["revision"] = state != null ? state.Revision : -1;
            var texts = new JArray();
            var labels = new JArray();
            if (state != null) {
                for (int i = 0; i < state.Labels.Count; i++) {
                    var label = state.Labels[i];
                    texts.Add(label.Text);
                    int ink = i < state.LabelInks.Count ? state.LabelInks[i] : 0;
                    labels.Add(new JObject {
                        ["x"] = label.X,
                        ["y"] = label.Y,
                        ["z"] = label.Z,
                        ["zone"] = label.Display,
                        ["category"] = label.Category,
                        ["cells"] = label.Cells,
                        ["text"] = label.Text,
                        ["colour"] = "#" + StationZoneMap.Category(label.Display).Hex,
                        ["ink"] = ink,
                        ["plate"] = i < state.LabelPlates.Count && state.LabelPlates[i] != null,
                    });
                }
            }
            payload["labelTexts"] = texts;
            payload["labels"] = labels;
            return payload;
        }

        static Color32[] BuildZonePalette() {
            var palette = new Color32[StationZoneMap.CategoryCount];
            for (int i = 0; i < palette.Length; i++) palette[i] = StationZoneMap.Category(i).Tint;
            return palette;
        }
    }

    /// <summary>
    /// The `state.overlays` contributor. It lives beside the renderer (a packet owns its
    /// own state key), so the overlay's diagnostics never depend on a station-owner edit.
    /// </summary>
    public sealed class StationOverlayStateContributor : IStationStateContributor {
        public string Key => StationOverlayRenderer.StateKey;

        public JObject BuildPayload(StationDocument document, StationIndex index) => StationOverlayRenderer.StateJson();
    }

    /// <summary>
    /// One cached label plate: the painted pill + text texture and the material that draws
    /// it. Cached per locale and category, exactly the source's `zoneLabelMats` key, so a
    /// rebuild re-binds the same material instead of minting another texture.
    /// </summary>
    public sealed class StationZoneLabelPlate {
        public string Key = "";
        public string Locale = "";
        public int Display;
        public string Text = "";
        public Texture2D Texture;
        public Material Material;
        /// <summary>Bright (glyph) pixels in the texture: proof the plate is text, not a quad.</summary>
        public int Ink;
        public string Note = "";

        public override string ToString() => Key + " \"" + Text + "\" ink " + Ink;
    }

    /// <summary>
    /// The flat zone-name plate painter, a port of the source's canvas material
    /// (`CrowdSystem.zoneLabelMaterial`): a 256 × 96 canvas — the exact 8:3 aspect of the
    /// 3.2 × 1.2 m plate — with a dark translucent rounded pill (`rgba(9,13,19,0.78)`), a
    /// five-pixel border in the category colour and the localized name in white bold type.
    ///
    /// It follows the repository's plate-painter pattern (<see cref="StationTvPlatePainter"/>,
    /// `StationCalligraphyArtwork.Paint`): a temporary `RenderTexture`, one orthographic
    /// camera, a world-space canvas of uGUI `Text` (and one `RawImage` for the pill), then
    /// `ReadPixels` into a `Texture2D`. The canvas and camera are parked far outside the
    /// station bounds so no station geometry can fall into the plate's frustum. Nothing
    /// reads a clock or a random source.
    /// </summary>
    public static class StationZoneLabelPainter {
        /// <summary>The source canvas (`c.width = 256; c.height = 96`).</summary>
        public const int Width = 256;
        public const int Height = 96;
        /// <summary>The source's `roundRect(8, 8, w-16, h-16, 20)` minus half its 5 px stroke.</summary>
        public const int PlateInset = 6;
        public const int CornerRadius = 20;
        public const int BorderWidth = 5;
        /// <summary>The source's `bold 42px`; a longer (English) name best-fits down from it.</summary>
        public const int TextMaxPixels = 42;
        public const int TextMinPixels = 18;
        /// <summary>The canvas/camera plane is parked here, outside every station's bounds.</summary>
        public const float PaintOrigin = 100000f;

        static readonly Color32 PillFill = new Color32(9, 13, 19, 199);

        public static string Key(string locale, int display) =>
            StationZoneMap.NormalizeLocale(locale) + "|" + display.ToString(CultureInfo.InvariantCulture);

        /// <summary>Paint one plate to a transparent RGBA texture.</summary>
        public static bool TryPaint(in StationZoneLabel label, string locale, Font font, out StationZoneLabelPlate plate, out string note) {
            plate = null;
            note = "";
            if (font == null) {
                note = "no-font";
                return false;
            }
            if (SystemInfo.graphicsDeviceType == UnityEngine.Rendering.GraphicsDeviceType.Null) {
                note = "no-graphics";
                return false;
            }
            Texture2D pill = null;
            Texture2D texture = null;
            RenderTexture previous = RenderTexture.active;
            RenderTexture target = null;
            GameObject cameraObject = null;
            GameObject canvasObject = null;
            try {
                // An explicit render texture, created here rather than taken from the
                // temporary pool: the plate is painted once per locale + category, and
                // `Create()` is what makes the surface real on every graphics host (the
                // temporary pool's lazy creation reports `IsCreated()` false until first
                // use, which would silently skip the glyphs).
                target = new RenderTexture(Width, Height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB) {
                    name = "zone label plate",
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = FilterMode.Bilinear,
                };
                if (!target.Create()) {
                    note = "no-render-texture";
                    return false;
                }
                cameraObject = new GameObject("zone label camera");
                var camera = cameraObject.AddComponent<Camera>();
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0f, 0f, 0f, 0f);
                camera.orthographic = true;
                camera.orthographicSize = Height * .5f;
                camera.nearClipPlane = .01f;
                camera.farClipPlane = 100f;
                camera.transform.position = new Vector3(PaintOrigin + Width * .5f, Height * .5f, -10f);
                camera.targetTexture = target;

                canvasObject = new GameObject("zone label canvas", typeof(Canvas));
                var canvas = canvasObject.GetComponent<Canvas>();
                canvas.renderMode = RenderMode.WorldSpace;
                var canvasRect = canvasObject.GetComponent<RectTransform>();
                canvasRect.sizeDelta = new Vector2(Width, Height);
                canvasRect.position = new Vector3(PaintOrigin + Width * .5f, Height * .5f, 0f);
                canvasRect.localScale = Vector3.one;

                // The pill: dark translucent fill inside a five-pixel category border.
                pill = Pill(label.Colour);
                var pillObject = new GameObject("pill", typeof(RectTransform));
                pillObject.transform.SetParent(canvasObject.transform, false);
                var image = pillObject.AddComponent<RawImage>();
                image.texture = pill;
                image.raycastTarget = false;
                var pillRect = (RectTransform)pillObject.transform;
                pillRect.sizeDelta = new Vector2(Width, Height);
                pillRect.anchoredPosition = Vector2.zero;

                // The name, white bold, best-fit inside the pill's inner area.
                var textObject = new GameObject("text", typeof(RectTransform));
                textObject.transform.SetParent(canvasObject.transform, false);
                var text = textObject.AddComponent<Text>();
                text.font = font;
                text.text = label.Text ?? "";
                text.fontStyle = FontStyle.Bold;
                text.color = Color.white;
                text.alignment = TextAnchor.MiddleCenter;
                text.supportRichText = false;
                text.raycastTarget = false;
                text.horizontalOverflow = HorizontalWrapMode.Wrap;
                text.verticalOverflow = VerticalWrapMode.Truncate;
                text.resizeTextForBestFit = true;
                text.resizeTextMinSize = TextMinPixels;
                text.resizeTextMaxSize = TextMaxPixels;
                var textRect = (RectTransform)textObject.transform;
                textRect.sizeDelta = new Vector2(Width - 2 * (PlateInset + BorderWidth) - 12, Height - 2 * (PlateInset + BorderWidth) - 8);
                textRect.anchoredPosition = Vector2.zero;

                camera.Render();
                RenderTexture.active = target;
                texture = new Texture2D(Width, Height, TextureFormat.RGBA32, false) {
                    name = "zone label " + Key(locale, label.Display),
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = FilterMode.Bilinear,
                };
                texture.ReadPixels(new Rect(0, 0, Width, Height), 0, 0);
                texture.Apply(false, false);
            } catch (Exception error) {
                note = "paint-failed:" + error.GetType().Name;
                if (texture) Destroy(texture);
                texture = null;
            } finally {
                RenderTexture.active = previous;
                if (cameraObject) Destroy(cameraObject);
                if (canvasObject) Destroy(canvasObject);
                if (target != null) {
                    target.Release();
                    Destroy(target);
                }
                if (pill) Destroy(pill);
            }
            if (texture == null) {
                if (note.Length == 0) note = "paint-failed";
                return false;
            }
            plate = new StationZoneLabelPlate {
                Key = Key(locale, label.Display),
                Locale = StationZoneMap.NormalizeLocale(locale),
                Display = label.Display,
                Text = label.Text ?? "",
                Texture = texture,
                Ink = InkPixels(texture),
                Note = "",
            };
            return true;
        }

        /// <summary>The material that draws a painted plate (the source's `MeshBasicMaterial`).</summary>
        public static Material CreateMaterial(Texture2D texture) {
            if (texture == null) return null;
            var shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Sprites/Default");
            if (shader == null) return null;
            var material = new Material(shader) { name = "zone label " + texture.name };
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", texture);
            if (material.HasProperty("_MainTex")) material.SetTexture("_MainTex", texture);
            material.SetColor("_BaseColor", Color.white);
            material.SetColor("_Color", Color.white);
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

        /// <summary>The source's rounded pill, drawn deterministically into a readable texture.</summary>
        static Texture2D Pill(Color32 border) {
            var texture = new Texture2D(Width, Height, TextureFormat.RGBA32, false) {
                name = "zone label pill",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
            };
            var pixels = new Color32[Width * Height];
            for (int y = 0; y < Height; y++) {
                for (int x = 0; x < Width; x++) {
                    double distance = RoundedRectDistance(x + .5, y + .5, PlateInset, PlateInset,
                        Width - PlateInset, Height - PlateInset, CornerRadius);
                    if (distance > .5) {
                        pixels[y * Width + x] = default;
                        continue;
                    }
                    float coverage = Mathf.Clamp01((float)(.5 - distance));
                    pixels[y * Width + x] = distance <= -BorderWidth
                        ? new Color32(PillFill.r, PillFill.g, PillFill.b, (byte)Mathf.RoundToInt(PillFill.a * coverage))
                        : new Color32(border.r, border.g, border.b, (byte)Mathf.RoundToInt(255f * coverage));
                }
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, false);
            return texture;
        }

        /// <summary>Signed distance to a rounded rectangle: negative inside, 0 on the edge.</summary>
        static double RoundedRectDistance(double x, double y, double x0, double y0, double x1, double y1, double radius) {
            double halfWidth = (x1 - x0) * .5 - radius;
            double halfHeight = (y1 - y0) * .5 - radius;
            double px = Math.Abs(x - (x0 + x1) * .5) - halfWidth;
            double py = Math.Abs(y - (y0 + y1) * .5) - halfHeight;
            double outside = Math.Sqrt(Math.Max(px, 0) * Math.Max(px, 0) + Math.Max(py, 0) * Math.Max(py, 0));
            double inside = Math.Min(Math.Max(px, py), 0);
            return outside + inside - radius;
        }

        /// <summary>
        /// Bright, opaque pixels — the white text. The pill fill is near-black and the
        /// border carries the category colour, so this counts glyph pixels only and a
        /// verifier can tell a painted name from a coloured quad.
        /// </summary>
        public static int InkPixels(Texture2D texture) {
            if (texture == null) return 0;
            Color32[] pixels;
            try { pixels = texture.GetPixels32(); } catch (Exception) { return 0; }
            int ink = 0;
            for (int i = 0; i < pixels.Length; i++) {
                var pixel = pixels[i];
                if (pixel.a >= 128 && pixel.r >= 200 && pixel.g >= 200 && pixel.b >= 200) ink++;
            }
            return ink;
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
            // A Latin fallback keeps an English label readable when the host bound no
            // font (the scene's Noto face is what draws the CJK names).
            try { cached = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); } catch (Exception) { cached = null; }
            return cached;
        }
    }
}
