using System;
using System.Collections.Generic;
using UnityEngine;

namespace Metro.View {
    /// <summary>
    /// The role a rendered part plays for view visibility. Every rule that names a
    /// family (a wall, the street, a roof, the editing lattice) reads this tag, so a
    /// renderer registered with the wrong role is visibly wrong rather than silently
    /// falling into "prop".
    /// </summary>
    public enum StationPartRole {
        Other = 0,
        Slab = 1,
        Ceiling = 2,
        Wall = 3,
        Psd = 4,
        Ground = 5,
        Roof = 6,
        Prop = 7,
        Sign = 8,
        Train = 9,
        Actor = 10,
        Grid = 11,
        Cursor = 12,
        Overlay = 13,
        Road = 14,
        Vehicle = 15,
        Surface = 16,
    }

    /// <summary>Where a part sits relative to the storey being edited.</summary>
    public enum StationLevelSide {
        Active = 0,
        Below = 1,
        Above = 2,
    }

    /// <summary>What the walk asks one registered part to draw as.</summary>
    public enum StationDrawMode {
        Hidden = 0,
        Base = 1,
        Ghost = 2,
        Clear = 3,
    }

    /// <summary>Which side of the 剖切 surface a bounds lies on.</summary>
    public enum StationSectionSide {
        Kept = 0,
        Cut = 1,
        Straddles = 2,
    }

    /// <summary>
    /// The station's level grid, derived from the document rather than a fixed list.
    /// The source view ladder is fifteen 5 m stops from the height origin
    /// (<c>levelSteps</c>, used on every document); a document with its own
    /// <c>storeyHeight</c> also has real levels on that pitch, and the registration can
    /// name built levels the view must accept. There is no five-entry allowlist here.
    /// </summary>
    [Serializable]
    public struct StationLevelGrid {
        public int LevelBase;
        public int StoreyHeight;
        public int[] BuiltLevels;

        /// <summary>The source viewing ladder: 15 stops, 5 m apart, from the height origin.</summary>
        public const int LadderStep = 5;
        public const int LadderStops = 15;

        public static StationLevelGrid FromDocument(int levelBase, int storeyHeight, IEnumerable<int> builtLevels = null) {
            var levels = builtLevels == null ? new List<int>() : new List<int>(builtLevels);
            levels.Sort();
            return new StationLevelGrid {
                LevelBase = NormalizeBase(levelBase),
                StoreyHeight = storeyHeight > 0 ? storeyHeight : LadderStep,
                BuiltLevels = levels.ToArray(),
            };
        }

        public static int NormalizeBase(int value) {
            // `normalizeLevelBase`: 0 .. STOREY_HEIGHT-1, rounded.
            return Mathf.Clamp(value, 0, LadderStep - 1);
        }

        /// <summary>The fifteen 5 m view stops for this height origin.</summary>
        public int[] Ladder() {
            var levels = new int[LadderStops];
            int origin = NormalizeBase(LevelBase);
            for (int i = 0; i < levels.Length; i++) levels[i] = (i - 8) * LadderStep + origin;
            return levels;
        }

        public bool IsLadderLevel(int level) {
            int origin = NormalizeBase(LevelBase);
            return Mod(level - ((0 - 8) * LadderStep + origin), LadderStep) == 0 &&
                level >= -8 * LadderStep + origin && level <= 6 * LadderStep + origin;
        }

        public bool IsStoreyLevel(int level) {
            int height = StoreyHeight > 0 ? StoreyHeight : LadderStep;
            return Mod(level - NormalizeBase(LevelBase), height) == 0;
        }

        public bool IsBuiltLevel(int level) {
            if (BuiltLevels == null) return false;
            for (int i = 0; i < BuiltLevels.Length; i++) if (BuiltLevels[i] == level) return true;
            return false;
        }

        /// <summary>
        /// Validate a level command against this station. A level is accepted when it is
        /// on the view ladder, on the document's own storey pitch, or a registered built
        /// level; everything else is rejected rather than clamped onto a guessed storey.
        /// The source chip accepts any integer, so the range guard is the source's own
        /// −100..100 edit bound.
        /// </summary>
        public bool TryValidate(int requested, out int accepted) {
            accepted = requested;
            if (requested < -100 || requested > 100) return false;
            return IsLadderLevel(requested) || IsStoreyLevel(requested) || IsBuiltLevel(requested);
        }

        /// <summary>The nearest view-ladder stop (source <c>nearestLevel</c>).</summary>
        public int NearestLadderLevel(int level) {
            var ladder = Ladder();
            int best = ladder[0];
            for (int i = 1; i < ladder.Length; i++) {
                if (Mathf.Abs(ladder[i] - level) < Mathf.Abs(best - level)) best = ladder[i];
            }
            return best;
        }

        /// <summary>
        /// The storey band a piece at <paramref name="z"/> belongs to, ported from
        /// <c>sim/constants.ts</c> <c>storeyBand</c> (clamped to the 15-stop ladder).
        /// </summary>
        public int Band(int z) {
            int origin = NormalizeBase(LevelBase);
            int height = StoreyHeight > 0 ? StoreyHeight : LadderStep;
            int lowest = -8 * LadderStep + origin;
            int highest = 6 * LadderStep + origin;
            int band = Mathf.FloorToInt((z - origin) / (float)height) * height + origin;
            return Mathf.Clamp(band, lowest, highest);
        }

        static int Mod(int value, int modulus) => ((value % modulus) + modulus) % modulus;
    }

    /// <summary>The toggles the level slice reads for one frame (source <c>SliceOptions</c>).</summary>
    public struct StationSliceOptions {
        public bool Ghost;
        public bool AutoCeiling;
        public bool HideAbove;
        public bool Unsupported;
    }

    /// <summary>
    /// The pure visibility rules, ported from <c>render/levelSlicing.ts</c>. The same
    /// answers drive renderers, actors and picking; nothing here knows about a camera.
    /// </summary>
    public static class StationVisibilityRules {
        public const int DenseStationModules = 20000;

        /// <summary>
        /// Target mesh LOD tier for objects on non-active storeys when storey-based LOD is active.
        /// Mirrors web's non-active low-LOD rule stepped down by one Unity LOD tier:
        /// High profile → Medium (1), Balanced/Low profiles → Low (2).
        /// </summary>
        public static int OtherLevelMeshLod = 1;

        public static bool IsDense(int moduleCount) => moduleCount >= DenseStationModules;

        /// <summary>The side of the active storey a piece occupies, by its true level span.</summary>
        public static StationLevelSide LevelSide(IReadOnlyList<int> levelsZ, int activeZ) {
            if (levelsZ == null || levelsZ.Count == 0) return StationLevelSide.Active;
            int low = int.MaxValue;
            int high = int.MinValue;
            for (int i = 0; i < levelsZ.Count; i++) {
                if (levelsZ[i] < low) low = levelsZ[i];
                if (levelsZ[i] > high) high = levelsZ[i];
            }
            if (low <= activeZ && high >= activeZ) return StationLevelSide.Active;
            return high < activeZ ? StationLevelSide.Below : StationLevelSide.Above;
        }

        /// <summary>隐藏UI and 剖切 put the slice away: every storey, no ceiling lifted.</summary>
        public static StationSliceOptions SliceOptions(bool showLevels, bool autoCeiling, bool hideUI, bool cutaway, bool built) {
            if (hideUI || cutaway) return new StationSliceOptions { Ghost = true, AutoCeiling = false, HideAbove = false };
            return new StationSliceOptions {
                Ghost = showLevels,
                AutoCeiling = autoCeiling,
                HideAbove = showLevels && built,
            };
        }

        /// <summary>Whether the slice draws a piece on its side.</summary>
        public static bool LevelVisible(StationLevelSide side, StationSliceOptions options) {
            if (side == StationLevelSide.Active) return true;
            if (!options.Ghost) return false;
            if (side == StationLevelSide.Below) return true;
            // An occupied storey hides everything above it; an empty one still ghosts.
            if (options.HideAbove) return false;
            return !options.AutoCeiling || options.Unsupported;
        }

        /// <summary>The slice plus the dense-document bound on distant ghost storeys.</summary>
        public static bool BoundedLevelVisible(StationLevelSide side, IReadOnlyList<int> levelsZ, int activeZ,
            StationSliceOptions options, bool dense, int storeyHeight = StationLevelGrid.LadderStep) {
            int step = storeyHeight > 0 ? storeyHeight : StationLevelGrid.LadderStep;
            if (dense && side != StationLevelSide.Active && !StoreyNear(levelsZ, activeZ, step)) return false;
            return LevelVisible(side, options);
        }

        /// <summary>True when any storey a piece occupies is next to the active one.</summary>
        public static bool StoreyNear(IReadOnlyList<int> levelsZ, int activeZ, int storeyHeight = StationLevelGrid.LadderStep) {
            if (levelsZ == null || levelsZ.Count == 0) return true;
            int step = storeyHeight > 0 ? storeyHeight : StationLevelGrid.LadderStep;
            for (int i = 0; i < levelsZ.Count; i++) if (Mathf.Abs(levelsZ[i] - activeZ) <= step) return true;
            return false;
        }

        /// <summary>A fixture's `float`: its column starts above the active storey.</summary>
        public static bool UnsupportedAbove(int activeZ, int groundBand) => groundBand != StationVisibilityTarget.NoGroundBand && groundBand > activeZ;

        /// <summary>
        /// A consist is parked between services; a train never shows from a storey above
        /// the active one (its own floor is not drawn there).
        /// </summary>
        public static bool TrainVisible(StationLevelSide side, bool showLevels, bool parked) {
            if (parked) return false;
            return side == StationLevelSide.Active || (showLevels && side == StationLevelSide.Below);
        }

        /// <summary>Whether the crowd standing on <paramref name="z"/> draws.</summary>
        public static bool CrowdVisible(int z, int activeZ, bool showLevels, bool everyStorey, StationLevelGrid grid) {
            if (everyStorey) return true;
            var side = LevelSide(new[] { grid.Band(z) }, activeZ);
            return side == StationLevelSide.Active || (showLevels && side == StationLevelSide.Below);
        }

        /// <summary>Contact shadows ground the active storey; ghosts draw without them.</summary>
        public static bool ContactShadowVisible(int z, int activeZ, bool everyStorey, StationLevelGrid grid) =>
            everyStorey || grid.Band(z) == activeZ;
    }

    /// <summary>The view toggles owned by C#; the bridge's <c>payload.view</c>.</summary>
    [Serializable]
    public sealed class StationVisibilityState {
        public int ActiveLevel;
        public int LevelBase;
        public int StoreyHeight = StationLevelGrid.LadderStep;
        public bool ShowLevels = true;
        public bool AutoCeiling;
        public bool HideWalls;
        public bool HideGround;
        public bool HideRoof;
        public bool HideUi;
        public bool Cutaway;
        public bool Exploded;
        public bool Density;
        public bool Zones;
        public bool Dense;
        public int FollowPassenger = -1;

        public StationLevelGrid Grid => StationLevelGrid.FromDocument(LevelBase, StoreyHeight, null);

        /// <summary>隐藏UI also puts 隐藏天花板 back: the mode draws every storey whole.</summary>
        public void SetHideUi(bool on) {
            HideUi = on;
            if (on) AutoCeiling = false;
        }

        public StationVisibilityState Clone() => (StationVisibilityState)MemberwiseClone();
    }

    /// <summary>
    /// The 剖切 surface arithmetic, ported from <c>render/section.ts</c>. Document space:
    /// <c>azimuth</c> is a quarter turn measured from +y toward +x, <c>offset</c> walks the
    /// plane along its own outward normal, and the **kept** half is behind the surface
    /// (`dot(n, p) &lt;= dot(n, point)`).
    /// </summary>
    [Serializable]
    public struct StationSectionPlane {
        public Vector3 Anchor;
        public float Azimuth;
        public float Offset;

        public static StationSectionPlane Default => new StationSectionPlane {
            Anchor = new Vector3(0f, 0f, -8f),
            Azimuth = 0f,
            Offset = 0f,
        };

        public const float Snap = .5f;
        public const float SnapFine = .05f;
        public const float DefaultAzimuth = 0f;
        public const float HighlightLift = .02f;

        public Vector3 Normal {
            get {
                float radians = Azimuth * Mathf.Deg2Rad;
                return new Vector3(Mathf.Sin(radians), Mathf.Cos(radians), 0f);
            }
        }

        public Vector3 Point => Anchor + Normal * Offset;

        /// <summary>The horizontal in-plane axis: document +z × normal.</summary>
        public Vector3 Right {
            get {
                var n = Normal;
                var right = new Vector3(-n.y, n.x, 0f);
                return right.sqrMagnitude < 1e-9f ? new Vector3(1f, 0f, 0f) : right.normalized;
            }
        }

        public Vector3 Up => Vector3.Cross(Normal, Right);

        /// <summary>
        /// Positive on the side the surface **faces** (the cut-away side); negative on
        /// the kept side.
        /// </summary>
        public float SignedDistance(Vector3 documentPoint) => Vector3.Dot(Normal, documentPoint - Point);

        public bool Keeps(Vector3 documentPoint, float epsilon = 1e-4f) => SignedDistance(documentPoint) <= epsilon;

        /// <summary>The plane constant <c>-dot(n, point)</c>, for a shader's plane vector.</summary>
        public float PlaneConstant => -Vector3.Dot(Normal, Point);

        public StationSectionPlane WithAnchor(Vector3 anchor) => new StationSectionPlane { Anchor = anchor, Azimuth = Azimuth, Offset = Offset };
        public StationSectionPlane WithOffset(float offset) => new StationSectionPlane { Anchor = Anchor, Azimuth = Azimuth, Offset = offset };
        public StationSectionPlane WithAzimuth(float azimuth) => new StationSectionPlane { Anchor = Anchor, Azimuth = SnapAzimuth(azimuth), Offset = Offset };

        /// <summary>One quarter turn clockwise, wrapping at 270 (source <c>nextAzimuth</c>).</summary>
        public static float NextAzimuth(float azimuth) {
            float from = SnapAzimuth(azimuth);
            return Mathf.Repeat(from + 90f, 360f);
        }

        public static float SnapAzimuth(float azimuth) {
            float best = 0f;
            float bestDelta = float.MaxValue;
            for (int turn = 0; turn < 4; turn++) {
                float candidate = turn * 90f;
                float delta = Mathf.Abs(Mathf.DeltaAngle(azimuth, candidate));
                if (delta < bestDelta) {
                    bestDelta = delta;
                    best = candidate;
                }
            }
            return best;
        }

        public static float SnapOffset(float value, bool fine = false) {
            float step = fine ? SnapFine : Snap;
            return Mathf.Floor(value / step + 0.5f) * step;
        }

        /// <summary>The slide a pointer drag asks for, measured along the normal.</summary>
        public float SlideOffset(Vector3 fromDocument, Vector3 hitDocument) {
            var n = Normal;
            return Offset + n.x * (hitDocument.x - fromDocument.x) +
                n.y * (hitDocument.y - fromDocument.y) +
                n.z * (hitDocument.z - fromDocument.z);
        }

        /// <summary>Which side of the surface a world-space bounds lies on.</summary>
        public StationSectionSide Classify(Bounds worldBounds) {
            var normal = StationCameraSpace.ToWorld(Normal);
            var point = StationCameraSpace.ToWorld(Point);
            var min = worldBounds.min;
            var max = worldBounds.max;
            bool anyKept = false;
            bool anyCut = false;
            for (int i = 0; i < 8; i++) {
                var corner = new Vector3(
                    (i & 1) == 0 ? min.x : max.x,
                    (i & 2) == 0 ? min.y : max.y,
                    (i & 4) == 0 ? min.z : max.z);
                if (Vector3.Dot(normal, corner - point) <= 1e-4f) anyKept = true;
                else anyCut = true;
            }
            if (anyKept && anyCut) return StationSectionSide.Straddles;
            return anyCut ? StationSectionSide.Cut : StationSectionSide.Kept;
        }

        public void AppendJson(System.Text.StringBuilder builder) {
            builder.Append("{\"anchor\":");
            StationCameraJson.AppendVector(builder, Anchor);
            builder.Append(",\"azimuth\":");
            StationCameraJson.AppendNumber(builder, Azimuth);
            builder.Append(",\"offset\":");
            StationCameraJson.AppendNumber(builder, Offset);
            builder.Append('}');
        }
    }

    /// <summary>
    /// A rendered part registered for view rules. Packet A's `StationWorldView` is the
    /// intended producer; until it lands, the host registers roots through
    /// <see cref="StationVisibilityRegistry.Register(Transform,StationPartRole,int[],int,bool)"/>.
    /// </summary>
    public interface IStationVisibilityTarget {
        StationPartRole Role { get; }
        IReadOnlyList<int> LevelZs { get; }
        int GroundBand { get; }
        bool Parked { get; }
        bool Floating { get; }
        bool ContactShadow { get; }
        bool GradeOwned { get; }
        Transform Root { get; }
        Bounds WorldBounds { get; }
        StationDrawMode LastMode { get; }
        void Apply(StationDrawMode mode, StationVisibilityPalette palette);
    }

    /// <summary>
    /// The material variants the view needs: a 35% ghost for other storeys and a 16%
    /// look-through for 隐藏墙壁. URP Lit has no transparency switch, so the palette
    /// clones the base material into the project's transparent surface settings once
    /// per material; the registry owns the cache and drops it with the station.
    /// </summary>
    public sealed class StationVisibilityPalette : IDisposable {
        public const float GhostOpacity = .35f;
        public const float ClearOpacity = .16f;

        readonly Dictionary<Material, Material> ghosts = new Dictionary<Material, Material>();
        readonly Dictionary<Material, Material> clears = new Dictionary<Material, Material>();
        readonly Dictionary<Material, Material> sectionMaterials = new Dictionary<Material, Material>();
        readonly Shader requested;
        Shader resolved;
        Shader sectionLit;
        Shader sectionUnlit;

        internal bool SectionClipping;
        internal Vector4 SectionPlane;
        internal int OtherLevelMeshLod = StationVisibilityRules.OtherLevelMeshLod;

        internal Material SectionMaterial(Material source, StationPartRole role) {
            if (!source || source.HasProperty("_SectionPlane")) return source;
            // These exported paving materials are untextured glTF PBR. Sidewalk
            // colour is baked into vertices, while tactile tiles and arms use a tint.
            bool paving = role == StationPartRole.Surface &&
                source.shader.name == "Shader Graphs/glTF-pbrMetallicRoughness" &&
                (source.name == "outdoorSurface" || source.name == "tactile");
            if (source.shader.name == "Shader Graphs/glTF-pbrMetallicRoughness" && !paving) return source;
            if (sectionMaterials.TryGetValue(source, out var clone) && clone) return clone;
            Shader shader;
            switch (source.shader.name) {
                case "Universal Render Pipeline/Lit":
                    shader = sectionLit ??= Shader.Find("Metro/Station Section Lit");
                    break;
                case "Universal Render Pipeline/Unlit":
                    shader = sectionUnlit ??= Shader.Find("Metro/Station Section Unlit");
                    break;
                case "Shader Graphs/glTF-pbrMetallicRoughness":
                    shader = Shader.Find("Metro/Station Finish");
                    break;
                default:
                    return source;
            }
            if (!shader || !shader.isSupported) return source;
            clone = new Material(source) { name = source.name + " (section)", shader = shader, enableInstancing = source.enableInstancing };
            if (paving) {
                clone.SetFloat("_VertexColorWeight", source.name == "outdoorSurface" ? 1f : 0f);
                clone.SetColor("_BaseColor", source.GetColor("baseColorFactor"));
                clone.SetFloat("_Metallic", source.GetFloat("metallicFactor"));
                clone.SetFloat("_Smoothness", 1f - source.GetFloat("roughnessFactor"));
                clone.EnableKeyword("_ENVIRONMENTREFLECTIONS_OFF");
            }
            foreach (var keyword in source.enabledKeywords) {
                var next = shader.keywordSpace.FindKeyword(keyword.name);
                if (next.isValid) clone.EnableKeyword(next);
            }
            clone.renderQueue = source.renderQueue;
            clone.SetOverrideTag("RenderType", source.GetTag("RenderType", false));
            sectionMaterials[source] = clone;
            return clone;
        }

        public StationVisibilityPalette(Shader shader = null) {
            requested = shader;
        }

        /// <summary>
        /// Resolve the material shader on first use rather than at construction: the
        /// pure view rules must be constructible without a graphics device (EditMode and
        /// the command parser tests), and no ghost material is made until a piece is
        /// actually ghosted.
        /// </summary>
        Shader ActiveShader() {
            if (requested) return requested;
            if (!resolved) resolved = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            return resolved;
        }

        public Material Ghost(Material source) => Translucent(source, GhostOpacity, ghosts);

        public Material Clear(Material source) => Translucent(source, ClearOpacity, clears);

        Material Translucent(Material source, float opacity, Dictionary<Material, Material> cache) {
            var active = ActiveShader();
            if (!source || active == null) return source;
            if (cache.TryGetValue(source, out var cached) && cached) return cached;
            var clone = new Material(source) { name = source.name + (opacity < .2f ? " (clear)" : " (ghost)"), enableInstancing = source.enableInstancing };
            ApplyTranslucentOverrides(source, clone, opacity);
            cache[source] = clone;
            return clone;
        }

        static void ApplyTranslucentOverrides(Material source, Material clone, float opacity) {
            if (clone.HasProperty("_Surface")) clone.SetFloat("_Surface", 1f);
            if (clone.HasProperty("_Blend")) clone.SetFloat("_Blend", 0f);
            if (clone.HasProperty("_SrcBlend")) clone.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            if (clone.HasProperty("_DstBlend")) clone.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            if (clone.HasProperty("_AlphaDstBlend")) clone.SetFloat("_AlphaDstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            if (clone.HasProperty("_ZTestGBuffer")) clone.SetFloat("_ZTestGBuffer", (float)UnityEngine.Rendering.CompareFunction.Equal);
            if (clone.HasProperty("_ZWrite")) clone.SetFloat("_ZWrite", 0f);
            if (clone.HasProperty("_CastShadows")) clone.SetFloat("_CastShadows", 0f);
            // A ghost of an already-transparent material (glass) keeps its original
            // opacity and fades *from* it; writing the constant would make a .26 pane
            // more opaque than the solid one. Opaque materials use the ghost opacity.
            var baseAlpha = source.HasProperty("_BaseColor") ? source.GetColor("_BaseColor").a
                : source.HasProperty("_Color") ? source.GetColor("_Color").a
                : source.HasProperty("baseColorFactor") ? source.GetColor("baseColorFactor").a : 1f;
            var resolvedAlpha = baseAlpha < .999f ? baseAlpha * opacity : opacity;
            if (clone.HasProperty("_BaseColor")) {
                var colour = source.HasProperty("_BaseColor") ? source.GetColor("_BaseColor") : clone.GetColor("_BaseColor");
                // The source lerps a ghost 70% toward its grey (`ghostMaterial`); glass
                // keeps its tint because that is what a paned surface reads as.
                if (baseAlpha >= .999f) colour = Color.Lerp(colour, new Color(.42f, .455f, .502f, 1f), .7f);
                colour.a = resolvedAlpha;
                clone.SetColor("_BaseColor", colour);
            }
            if (clone.HasProperty("_Color")) {
                var colour = source.HasProperty("_Color") ? source.GetColor("_Color") : clone.GetColor("_Color");
                if (baseAlpha >= .999f) colour = Color.Lerp(colour, new Color(.42f, .455f, .502f, 1f), .7f);
                colour.a = resolvedAlpha;
                clone.SetColor("_Color", colour);
            }
            if (clone.HasProperty("baseColorFactor")) {
                var colour = source.HasProperty("baseColorFactor") ? source.GetColor("baseColorFactor") : clone.GetColor("baseColorFactor");
                if (baseAlpha >= .999f) colour = Color.Lerp(colour, new Color(.42f, .455f, .502f, 1f), .7f);
                colour.a = resolvedAlpha;
                clone.SetColor("baseColorFactor", colour);
            }
            clone.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            if (clone.shader != null && clone.shader.name.StartsWith("Shader Graphs/glTF-", StringComparison.Ordinal)) {
                clone.EnableKeyword("_DISABLE_SSR_TRANSPARENT");
                clone.EnableKeyword("_ENABLE_FOG_ON_TRANSPARENT");
                clone.SetShaderPassEnabled("TransparentDepthPrepass", false);
                clone.SetShaderPassEnabled("TransparentDepthPostpass", false);
                clone.SetShaderPassEnabled("TransparentBackface", false);
                clone.SetShaderPassEnabled("RayTracingPrepass", false);
                clone.SetShaderPassEnabled("DepthOnly", false);
                clone.SetShaderPassEnabled("ShadowCaster", false);
            }
            // Alpha-cutout (foliage) keeps its cutout: a ghost is see-through, not a solid
            // billboard. The keyword was previously *disabled* here, which is why ghosted
            // trees rendered as opaque cards.
            if (!source.IsKeywordEnabled("_ALPHATEST_ON")) clone.DisableKeyword("_ALPHATEST_ON");
            clone.SetOverrideTag("RenderType", "Transparent");
            clone.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
        }

        public void Dispose() {
            Clear();
        }

        /// <summary>
        /// Refresh cached translucent/section clones of one base material in place when live
        /// artwork updates its texture or properties, without destroying shared derived
        /// materials that sibling renderers may currently wear.
        /// </summary>
        public void SyncDerived(Material source) {
            if (!source) return;
            if (ghosts.TryGetValue(source, out var ghost) && ghost) {
                ghost.CopyPropertiesFromMaterial(source);
                ApplyTranslucentOverrides(source, ghost, GhostOpacity);
            }
            if (clears.TryGetValue(source, out var clear) && clear) {
                clear.CopyPropertiesFromMaterial(source);
                ApplyTranslucentOverrides(source, clear, ClearOpacity);
            }
            if (sectionMaterials.TryGetValue(source, out var section) && section) {
                section.CopyMatchingPropertiesFromMaterial(source);
                if (section.shader) {
                    foreach (var keyword in source.enabledKeywords) {
                        var next = section.shader.keywordSpace.FindKeyword(keyword.name);
                        if (next.isValid) section.EnableKeyword(next);
                    }
                }
            }
        }

        /// <summary>Monotonically incremented whenever cached clones are cleared, so targets invalidate derived material arrays.</summary>
        public int Generation { get; private set; }

        /// <summary>Drop the cached clones; a new station rebuilds its own materials.</summary>
        public void Clear() {
            foreach (var material in ghosts.Values) if (material) Destroy(material);
            foreach (var material in clears.Values) if (material) Destroy(material);
            foreach (var material in sectionMaterials.Values) if (material) Destroy(material);
            ghosts.Clear();
            clears.Clear();
            sectionMaterials.Clear();
            Generation++;
        }

        static void Destroy(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }

    /// <summary>
    /// The per-root visibility component: records the true level span and role, and
    /// applies one <see cref="StationDrawMode"/> to every renderer and collider under
    /// it. It also owns the exploded-view offset of the root, so the visibility walk and
    /// the exploded layout never fight over the same transform.
    /// </summary>
    public sealed class StationVisibilityTarget : MonoBehaviour, IStationVisibilityTarget {
        public const int NoGroundBand = int.MinValue;

        public StationPartRole role = StationPartRole.Prop;
        public int[] levels = Array.Empty<int>();
        public int groundBand = NoGroundBand;
        public bool parked;
        public bool floating;
        public bool contactShadow;
        /// <summary>
        /// Independent **grade** membership (20 §4): true when the part is owned by the authored
        /// 0 m ground datum — the street slab and courses, pavement, plantings, fences, street
        /// decor and traffic. It is separate from <see cref="role"/> so 隐藏墙壁 / 隐藏屋顶 and the
        /// other view tools keep reading the part's real role; only Hide Ground consults it.
        /// </summary>
        public bool gradeOwned;

        Renderer[] renderers;
        MeshFilter[] meshFilters;
        Collider[] colliders;
        Material[][] baseMaterials;
        Material[][] ghostMaterials;
        Material[][] clearMaterials;
        Material[][] sectionMaterials;
        byte[] baseHasSection;
        byte[] ghostHasSection;
        byte[] clearHasSection;
        byte[] sectionHasSection;
        byte[] appliedMaterialValid;
        StationDrawMode[] appliedMaterialMode;
        bool[] appliedMaterialClip;
        byte[] appliedSectionPlaneValid;
        bool[] appliedSectionPlaneClip;
        Vector4[] appliedSectionPlaneVec;
        byte[] appliedMeshLodValid;
        short[] appliedForceMeshLod;
        bool collected;
        bool hasApplied;
        StationDrawMode lastMode = StationDrawMode.Base;
        StationVisibilityPalette lastPalette;
        int cachedPaletteGeneration = -1;
        MaterialPropertyBlock sectionBlock;
        public bool OtherLevelLod { get; private set; }
        public bool SectionShaderActive { get; private set; }
        public int LastRendererWrites { get; private set; }
        public int LastColliderWrites { get; private set; }
        public int LastMaterialWrites { get; private set; }

        bool UsesSection => role != StationPartRole.Grid && role != StationPartRole.Cursor && role != StationPartRole.Overlay;

        /// <summary>
        /// Eligibility each renderer/collider had when the **owner** last left it alone, i.e.
        /// its authored state before any view-mode pass. `Apply` only ever writes
        /// `visible &amp;&amp; eligible`, so a piece a builder permanently retired (an exit
        /// head-house's baked pad, a baked printed plate) is never brought back by the next
        /// level toggle, and a `Refresh()` after a Hidden pass cannot mistake "hidden by the
        /// walk" for "authored off" (18 §6). Newly mounted parts are captured on first sight.
        /// </summary>
        readonly Dictionary<Renderer, bool> eligibleRenderers = new Dictionary<Renderer, bool>();
        readonly Dictionary<Collider, bool> eligibleColliders = new Dictionary<Collider, bool>();

        public StationPartRole Role => role;
        public IReadOnlyList<int> LevelZs => levels ?? Array.Empty<int>();
        public int GroundBand => groundBand;
        public bool Parked => parked;
        public bool Floating => floating;
        public bool ContactShadow => contactShadow;
        public bool GradeOwned => gradeOwned;
        public Transform Root => transform;
        public StationDrawMode LastMode => lastMode;
        public event Action<StationDrawMode> ModeApplied;
        public IReadOnlyList<Renderer> Renderers { get { Collect(); return renderers; } }
        public IReadOnlyList<Collider> Colliders { get { Collect(); return colliders; } }

        public Bounds WorldBounds {
            get {
                Collect();
                bool has = false;
                var bounds = new Bounds(transform.position, Vector3.one);
                for (int i = 0; i < renderers.Length; i++) {
                    var renderer = renderers[i];
                    if (!renderer || !Eligible(renderer)) continue;
                    var next = MeasureRendererBounds(renderer);
                    if (!has) { bounds = next; has = true; }
                    else bounds.Encapsulate(next);
                }
                return bounds;
            }
        }

        static Bounds MeasureRendererBounds(Renderer renderer) {
            if (renderer.enabled && renderer.gameObject.activeInHierarchy) {
                var live = renderer.bounds;
                if (live.size.sqrMagnitude > 1e-8f) return live;
            }
            var local = renderer.localBounds;
            if (local.size.sqrMagnitude <= 1e-8f) {
                if (renderer is SkinnedMeshRenderer skin && skin.sharedMesh != null) local = skin.sharedMesh.bounds;
                else if (renderer.TryGetComponent<MeshFilter>(out var filter) && filter.sharedMesh != null) local = filter.sharedMesh.bounds;
            }
            var matrix = renderer.transform.localToWorldMatrix;
            var center = matrix.MultiplyPoint3x4(local.center);
            var ext = local.extents;
            var axisX = matrix.MultiplyVector(new Vector3(ext.x, 0f, 0f));
            var axisY = matrix.MultiplyVector(new Vector3(0f, ext.y, 0f));
            var axisZ = matrix.MultiplyVector(new Vector3(0f, 0f, ext.z));
            var worldExt = new Vector3(
                Mathf.Abs(axisX.x) + Mathf.Abs(axisY.x) + Mathf.Abs(axisZ.x),
                Mathf.Abs(axisX.y) + Mathf.Abs(axisY.y) + Mathf.Abs(axisZ.y),
                Mathf.Abs(axisX.z) + Mathf.Abs(axisY.z) + Mathf.Abs(axisZ.z));
            return new Bounds(center, worldExt * 2f);
        }

        public void Configure(StationPartRole partRole, int[] levelZs, int band = NoGroundBand, bool isParked = false,
            bool isFloating = false, bool isContactShadow = false, bool isGradeOwned = false) {
            role = partRole;
            levels = levelZs ?? Array.Empty<int>();
            groundBand = band;
            parked = isParked;
            floating = isFloating;
            contactShadow = isContactShadow;
            gradeOwned = isGradeOwned;
            collected = false;
        }

        public void Refresh() {
            collected = false;
            Collect();
        }

        void Collect() {
            if (collected) return;
            collected = true;
            renderers = GetComponentsInChildren<Renderer>(true);
            colliders = GetComponentsInChildren<Collider>(true);
            int rCount = renderers.Length;
            meshFilters = new MeshFilter[rCount];
            baseMaterials = new Material[rCount][];
            ghostMaterials = null;
            clearMaterials = null;
            sectionMaterials = null;
            baseHasSection = new byte[rCount];
            ghostHasSection = null;
            clearHasSection = null;
            sectionHasSection = null;
            appliedMaterialValid = new byte[rCount];
            appliedMaterialMode = new StationDrawMode[rCount];
            appliedMaterialClip = new bool[rCount];
            appliedSectionPlaneValid = new byte[rCount];
            appliedSectionPlaneClip = new bool[rCount];
            appliedSectionPlaneVec = new Vector4[rCount];
            appliedMeshLodValid = new byte[rCount];
            appliedForceMeshLod = new short[rCount];
            cachedPaletteGeneration = -1;
            hasApplied = false;
            for (int i = 0; i < rCount; i++) {
                var renderer = renderers[i];
                baseMaterials[i] = renderer ? renderer.sharedMaterials : Array.Empty<Material>();
                meshFilters[i] = renderer is MeshRenderer ? renderer.GetComponent<MeshFilter>() : null;
                // First sight only: a renderer already switched off by its builder is retired
                // for good, and one the visibility walk itself switched off keeps its authored
                // eligibility because it was captured while the part was still drawable.
                if (renderer && !eligibleRenderers.ContainsKey(renderer)) eligibleRenderers[renderer] = renderer.enabled;
            }
            for (int i = 0; i < colliders.Length; i++) {
                var collider = colliders[i];
                if (collider && !eligibleColliders.ContainsKey(collider)) eligibleColliders[collider] = collider.enabled;
            }
            Prune(eligibleRenderers);
            Prune(eligibleColliders);
        }

        /// <summary>
        /// Adopt the materials a live artwork owner just installed on one renderer as the
        /// part's authored base. A display binds its own material **after** registration, so
        /// without this the next Base pass would put the baked export sample back on the screen
        /// and undo every poster, plate and line map on a level toggle (20 §1, §2).
        /// </summary>
        public void Recapture(Renderer renderer) {
            if (!renderer) return;
            Collect();
            for (int i = 0; i < renderers.Length; i++) {
                if (!ReferenceEquals(renderers[i], renderer)) continue;
                var next = renderer.sharedMaterials;
                if (lastPalette != null && next != null) {
                    for (int m = 0; m < next.Length; m++) lastPalette.SyncDerived(next[m]);
                }
                baseMaterials[i] = next;
                InvalidateRendererDerived(i);
                if (lastMode == StationDrawMode.Hidden || !Eligible(renderer) || lastPalette == null || next == null || next.Length == 0)
                    return;
                EnsurePaletteCache(lastPalette);
                ApplyRendererMaterials(i, renderer, next, lastMode, lastPalette);
                return;
            }
        }

        /// <summary>
        /// Zero-allocation fast path for callers (such as passenger LOD swaps) that already hold
        /// the immutable authored <paramref name="materials"/> array and do not mutate base textures
        /// in place. Avoids the native <c>renderer.sharedMaterials</c> copy and <c>SyncDerived</c>.
        /// </summary>
        public void SetBaseMaterials(Renderer renderer, Material[] materials, bool applyToRenderer = true) {
            if (!renderer) return;
            Collect();
            for (int i = 0; i < renderers.Length; i++) {
                if (!ReferenceEquals(renderers[i], renderer)) continue;
                baseMaterials[i] = materials;
                InvalidateRendererDerived(i);
                if (!applyToRenderer || lastMode == StationDrawMode.Hidden || !Eligible(renderer) ||
                    lastPalette == null || materials == null || materials.Length == 0)
                    return;
                EnsurePaletteCache(lastPalette);
                ApplyRendererMaterials(i, renderer, materials, lastMode, lastPalette);
                return;
            }
        }

        void InvalidateRendererDerived(int i) {
            if (ghostMaterials != null && i < ghostMaterials.Length) ghostMaterials[i] = null;
            if (clearMaterials != null && i < clearMaterials.Length) clearMaterials[i] = null;
            if (sectionMaterials != null && i < sectionMaterials.Length) sectionMaterials[i] = null;
            if (baseHasSection != null && i < baseHasSection.Length) baseHasSection[i] = 0;
            if (ghostHasSection != null && i < ghostHasSection.Length) ghostHasSection[i] = 0;
            if (clearHasSection != null && i < clearHasSection.Length) clearHasSection[i] = 0;
            if (sectionHasSection != null && i < sectionHasSection.Length) sectionHasSection[i] = 0;
            if (appliedMaterialValid != null && i < appliedMaterialValid.Length) appliedMaterialValid[i] = 0;
            if (appliedSectionPlaneValid != null && i < appliedSectionPlaneValid.Length) appliedSectionPlaneValid[i] = 0;
        }

        void EnsurePaletteCache(StationVisibilityPalette palette) {
            int gen = palette != null ? palette.Generation : -1;
            if (ReferenceEquals(lastPalette, palette) && cachedPaletteGeneration == gen) return;
            lastPalette = palette;
            cachedPaletteGeneration = gen;
            if (ghostMaterials != null) Array.Clear(ghostMaterials, 0, ghostMaterials.Length);
            if (clearMaterials != null) Array.Clear(clearMaterials, 0, clearMaterials.Length);
            if (sectionMaterials != null) Array.Clear(sectionMaterials, 0, sectionMaterials.Length);
            if (ghostHasSection != null) Array.Clear(ghostHasSection, 0, ghostHasSection.Length);
            if (clearHasSection != null) Array.Clear(clearHasSection, 0, clearHasSection.Length);
            if (sectionHasSection != null) Array.Clear(sectionHasSection, 0, sectionHasSection.Length);
            if (appliedMaterialValid != null) Array.Clear(appliedMaterialValid, 0, appliedMaterialValid.Length);
            if (appliedSectionPlaneValid != null) Array.Clear(appliedSectionPlaneValid, 0, appliedSectionPlaneValid.Length);
        }

        /// <summary>Forget destroyed entries so a long session does not grow the maps.</summary>
        static void Prune<T>(Dictionary<T, bool> map) where T : UnityEngine.Object {
            if (map.Count == 0) return;
            List<T> dead = null;
            foreach (var key in map.Keys) {
                if (key != null) continue;
                (dead ??= new List<T>()).Add(key);
            }
            if (dead == null) return;
            for (int i = 0; i < dead.Count; i++) map.Remove(dead[i]);
        }

        /// <summary>A part the owner permanently retired, or one that is drawable as authored.</summary>
        bool Eligible(Renderer renderer) =>
            !eligibleRenderers.TryGetValue(renderer, out bool eligible) || eligible;

        bool Eligible(Collider collider) =>
            !eligibleColliders.TryGetValue(collider, out bool eligible) || eligible;

        public void Apply(StationDrawMode mode, StationVisibilityPalette palette) =>
            Apply(mode, palette, mode == StationDrawMode.Ghost);

        internal void Apply(StationDrawMode mode, StationVisibilityPalette palette, bool otherLevelLod) {
            Collect();
            EnsurePaletteCache(palette);
            LastRendererWrites = 0;
            LastColliderWrites = 0;
            LastMaterialWrites = 0;
            if (hasApplied && lastMode == StationDrawMode.Hidden && mode == StationDrawMode.Hidden) {
                OtherLevelLod = false;
                SectionShaderActive = false;
                ModeApplied?.Invoke(mode);
                return;
            }
            SectionShaderActive = false;
            bool visible = mode != StationDrawMode.Hidden;
            OtherLevelLod = visible && otherLevelLod;
            int otherLevelTier = palette != null ? palette.OtherLevelMeshLod : StationVisibilityRules.OtherLevelMeshLod;
            // A part that was drawable after the last pass and is now off was retired by its
            // owner since then: record that as authored and never switch it back on.
            bool wasVisible = hasApplied ? lastMode != StationDrawMode.Hidden : true;
            if (!hasApplied && lastMode == StationDrawMode.Hidden) wasVisible = false;
            lastMode = mode;
            hasApplied = true;
            int rCount = renderers.Length;
            for (int i = 0; i < rCount; i++) {
                var renderer = renderers[i];
                if (!renderer) continue;
                bool currentlyEnabled = renderer.enabled;
                if (wasVisible && !currentlyEnabled) eligibleRenderers[renderer] = false;
                bool eligible = Eligible(renderer);
                bool wantEnabled = visible && eligible;
                if (currentlyEnabled != wantEnabled) {
                    renderer.enabled = wantEnabled;
                    LastRendererWrites++;
                }
                if (!wantEnabled) continue;
                ApplyRendererMeshLod(i, renderer, OtherLevelLod, otherLevelTier);
                if (palette == null) continue;
                var bases = baseMaterials[i];
                if (bases == null || bases.Length == 0) continue;
                ApplyRendererMaterials(i, renderer, bases, mode, palette);
            }
            int cCount = colliders.Length;
            for (int i = 0; i < cCount; i++) {
                var collider = colliders[i];
                if (!collider) continue;
                bool currentlyEnabled = collider.enabled;
                if (wasVisible && !currentlyEnabled) eligibleColliders[collider] = false;
                bool wantEnabled = visible && Eligible(collider);
                if (currentlyEnabled != wantEnabled) {
                    collider.enabled = wantEnabled;
                    LastColliderWrites++;
                }
            }
            ModeApplied?.Invoke(mode);
        }

        void ApplyRendererMeshLod(int index, Renderer renderer, bool otherLevelLod, int otherLevelTier) {
            var filter = meshFilters != null && index < meshFilters.Length ? meshFilters[index] : null;
            var mesh = filter != null ? filter.sharedMesh : null;
            if (mesh == null || mesh.lodCount <= 1) return;
            short want = otherLevelLod
                ? (short)Mathf.Clamp(otherLevelTier, 0, mesh.lodCount - 1)
                : (short)-1;
            if (appliedMeshLodValid[index] != 0 && appliedForceMeshLod[index] == want) return;
            renderer.forceMeshLod = want;
            appliedMeshLodValid[index] = 1;
            appliedForceMeshLod[index] = want;
        }

        void ApplyRendererMaterials(int index, Renderer renderer, Material[] bases, StationDrawMode mode, StationVisibilityPalette palette) {
            bool clip = UsesSection && palette.SectionClipping;
            bool needsMatWrite = appliedMaterialValid[index] == 0 ||
                appliedMaterialMode[index] != mode ||
                (mode == StationDrawMode.Base && appliedMaterialClip[index] != clip);

            Material[] targetMats;
            byte[] sectionFlags;
            switch (mode) {
                case StationDrawMode.Base:
                    if (clip) {
                        sectionMaterials ??= new Material[renderers.Length][];
                        targetMats = sectionMaterials[index] ?? (sectionMaterials[index] = MapSection(bases, palette, role));
                        sectionHasSection ??= new byte[renderers.Length];
                        sectionFlags = sectionHasSection;
                    } else {
                        targetMats = bases;
                        sectionFlags = baseHasSection;
                    }
                    break;
                case StationDrawMode.Ghost:
                    ghostMaterials ??= new Material[renderers.Length][];
                    targetMats = ghostMaterials[index] ?? (ghostMaterials[index] = Map(bases, palette.Ghost));
                    ghostHasSection ??= new byte[renderers.Length];
                    sectionFlags = ghostHasSection;
                    break;
                case StationDrawMode.Clear:
                    clearMaterials ??= new Material[renderers.Length][];
                    targetMats = clearMaterials[index] ?? (clearMaterials[index] = Map(bases, palette.Clear));
                    clearHasSection ??= new byte[renderers.Length];
                    sectionFlags = clearHasSection;
                    break;
                default:
                    return;
            }

            if (needsMatWrite) {
                renderer.sharedMaterials = targetMats;
                appliedMaterialValid[index] = 1;
                appliedMaterialMode[index] = mode;
                appliedMaterialClip[index] = clip;
                LastMaterialWrites++;
            }

            if (UsesSection) {
                byte hasFlag = sectionFlags[index];
                if (hasFlag == 0) {
                    hasFlag = HasSectionProperty(targetMats) ? (byte)2 : (byte)1;
                    sectionFlags[index] = hasFlag;
                }
                if (hasFlag == 2) {
                    SectionShaderActive = true;
                    bool planeDirty = appliedSectionPlaneValid[index] == 0 ||
                        appliedSectionPlaneClip[index] != palette.SectionClipping ||
                        (palette.SectionClipping && appliedSectionPlaneVec[index] != palette.SectionPlane);
                    if (planeDirty) {
                        sectionBlock ??= new MaterialPropertyBlock();
                        renderer.GetPropertyBlock(sectionBlock);
                        sectionBlock.SetVector("_SectionPlane", palette.SectionPlane);
                        sectionBlock.SetFloat("_SectionClip", palette.SectionClipping ? 1f : 0f);
                        renderer.SetPropertyBlock(sectionBlock);
                        appliedSectionPlaneValid[index] = 1;
                        appliedSectionPlaneClip[index] = palette.SectionClipping;
                        appliedSectionPlaneVec[index] = palette.SectionPlane;
                    }
                }
            }
        }

        static bool HasSectionProperty(Material[] materials) {
            if (materials == null) return false;
            for (int i = 0; i < materials.Length; i++) {
                var m = materials[i];
                if (m && m.HasProperty("_SectionPlane")) return true;
            }
            return false;
        }

        static Material[] MapSection(Material[] sources, StationVisibilityPalette palette, StationPartRole role) {
            var result = new Material[sources.Length];
            for (int i = 0; i < sources.Length; i++) result[i] = palette.SectionMaterial(sources[i], role);
            return result;
        }

        static Material[] Map(Material[] sources, Func<Material, Material> map) {
            var result = new Material[sources.Length];
            for (int i = 0; i < sources.Length; i++) result[i] = map(sources[i]);
            return result;
        }

        /// <summary>
        /// Returns the authored unghosted materials for <paramref name="renderer"/> when the
        /// renderer is drawable as authored (skipping parts permanently retired by their builder,
        /// even while the visibility walk currently hides or ghosts this target).
        /// </summary>
        public bool TryGetBaseMaterials(Renderer renderer, out Material[] materials) {
            materials = Array.Empty<Material>();
            if (!renderer) return false;
            Collect();
            for (int i = 0; i < renderers.Length; i++) {
                if (!ReferenceEquals(renderers[i], renderer)) continue;
                bool wasVisible = lastMode != StationDrawMode.Hidden;
                if (wasVisible && !renderer.enabled) eligibleRenderers[renderer] = false;
                if (!Eligible(renderer)) return false;
                materials = baseMaterials[i] ?? Array.Empty<Material>();
                return materials.Length > 0;
            }
            return false;
        }

        /// <summary>
        /// Resolves unghosted base materials for <paramref name="renderer"/> via its owning
        /// <see cref="StationVisibilityTarget"/> if present, or falls back to <c>sharedMaterials</c>
        /// when unregistered and currently enabled.
        /// </summary>
        public static bool ResolveDrawableBaseMaterials(Renderer renderer, out Material[] materials) {
            materials = Array.Empty<Material>();
            if (!renderer) return false;
            var target = renderer.GetComponentInParent<StationVisibilityTarget>(true);
            if (target != null) return target.TryGetBaseMaterials(renderer, out materials);
            if (!renderer.enabled) return false;
            materials = renderer.sharedMaterials ?? Array.Empty<Material>();
            return materials.Length > 0;
        }
    }

    /// <summary>One storey's tray in the exploded view, from <c>render/explodedView.ts</c>.</summary>
    public sealed class StationExplodedPlan {
        public int[] Levels = Array.Empty<int>();
        public int[] Shifts = Array.Empty<int>();
        public Vector2Int Direction = new Vector2Int(0, 1);

        public int Shift(int level) {
            int index = Array.IndexOf(Levels, level);
            return index >= 0 && index < Shifts.Length ? Shifts[index] : 0;
        }

        public Vector3 DocumentOffset(int level) {
            int shift = Shift(level);
            return new Vector3(Direction.x * shift, Direction.y * shift, 0f);
        }

        /// <summary>
        /// Port of <c>packFloors</c>: pack the storey plans along a shared direction so
        /// every tray stays free of overlap and the isometric footprint stays compact.
        /// `plans` are the plan points of each storey, in level order.
        /// </summary>
        public static StationExplodedPlan Compute(IReadOnlyList<int> levels, IReadOnlyList<IReadOnlyList<Vector2Int>> plans, Vector2Int preferred) {
            var result = new StationExplodedPlan {
                Levels = levels == null ? Array.Empty<int>() : new int[levels.Count],
                Direction = preferred,
            };
            int count = levels?.Count ?? 0;
            if (result.Levels.Length != count) result.Levels = new int[count];
            for (int i = 0; i < count; i++) result.Levels[i] = levels[i];
            result.Shifts = new int[count];
            if (count == 0) return result;

            bool concave = false;
            foreach (var plan in plans) {
                if (plan == null || plan.Count == 0) continue;
                int minX = int.MaxValue, maxX = int.MinValue, minY = int.MaxValue, maxY = int.MinValue;
                foreach (var point in plan) {
                    minX = Mathf.Min(minX, point.x); maxX = Mathf.Max(maxX, point.x);
                    minY = Mathf.Min(minY, point.y); maxY = Mathf.Max(maxY, point.y);
                }
                long area = (long)(maxX - minX + 1) * (maxY - minY + 1);
                if (area > 0 && plan.Count < area * .7) { concave = true; break; }
            }
            var directions = concave
                ? new[] { preferred, new Vector2Int(preferred.y, preferred.x), new Vector2Int(1, 1), new Vector2Int(1, -1) }
                : new[] { preferred };

            bool haveBest = false;
            double bestScore = double.MaxValue;
            Vector2Int bestDirection = preferred;
            int[] bestShifts = new int[count];

            foreach (var direction in directions) {
                var occupied = new HashSet<long>();
                var shifts = new int[count];
                int previous = 0;
                long edge = long.MinValue;
                double x0 = double.MaxValue, x1 = double.MinValue, y0 = double.MaxValue, y1 = double.MinValue;
                int planIndex = 0;
                foreach (var plan in plans) {
                    if (planIndex >= count) break;
                    int offset = previous;
                    if (occupied.Count > 0 && plan != null && plan.Count > 0) {
                        long near = long.MaxValue;
                        foreach (var point in plan) near = Math.Min(near, (long)direction.x * point.x + (long)direction.y * point.y);
                        long stop = Math.Max(offset, (long)Math.Ceiling((edge - near + 1) / (double)(direction.x * direction.x + direction.y * direction.y)));
                        for (; offset <= stop; offset++) {
                            bool overlaps = false;
                            foreach (var point in plan) {
                                int x = point.x + direction.x * offset;
                                int y = point.y + direction.y * offset;
                                if (occupied.Contains(Key(x, y))) { overlaps = true; break; }
                            }
                            if (!overlaps) break;
                        }
                    }
                    shifts[planIndex] = offset;
                    previous = offset;
                    if (plan != null) {
                        foreach (var point in plan) {
                            int x = point.x + direction.x * offset;
                            int y = point.y + direction.y * offset;
                            occupied.Add(Key(x, y));
                            edge = Math.Max(edge, (long)direction.x * x + (long)direction.y * y);
                            double sx = 1.2 * x + y;
                            double sy = -x + 1.2 * y;
                            x0 = Math.Min(x0, sx); x1 = Math.Max(x1, sx);
                            y0 = Math.Min(y0, sy); y1 = Math.Max(y1, sy);
                        }
                    }
                    planIndex++;
                }
                if (planIndex == 0) continue;
                double score = (x1 - x0 + 2.2) * (y1 - y0 + 2.2);
                if (!haveBest || score < bestScore - 1e-6) {
                    haveBest = true;
                    bestScore = score;
                    bestDirection = direction;
                    bestShifts = shifts;
                }
            }
            result.Direction = bestDirection;
            result.Shifts = bestShifts;
            return result;
        }

        static long Key(int x, int y) => (long)x * 4294967296L + y;
    }

    /// <summary>
    /// The view walk: one visibility state and one section plane applied to every
    /// registered part, actor and pick query. Renderers, colliders and material variants
    /// are the only things it writes; it never edits the document and never restarts a
    /// simulation.
    /// </summary>
    public sealed class StationVisibilityRegistry : IDisposable {
        sealed class ReferenceTargetComparer : IEqualityComparer<IStationVisibilityTarget> {
            public static readonly ReferenceTargetComparer Instance = new ReferenceTargetComparer();
            public bool Equals(IStationVisibilityTarget x, IStationVisibilityTarget y) => ReferenceEquals(x, y);
            public int GetHashCode(IStationVisibilityTarget obj) =>
                obj == null ? 0 : System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(obj);
        }

        struct AppliedTargetSummary {
            public StationDrawMode Mode;
            public byte Visible;
            public byte Hidden;
            public byte Ghost;
            public byte Clear;
            public byte Cut;
            public byte Straddling;
            public byte SectionShader;
        }

        struct TargetIndexEntry {
            public bool InSingleLevel;
            public int SingleLevel;
            public bool InDynamic;
            public bool InOccupiedCount;
        }

        struct GlobalPolicySnapshot {
            public bool ShowLevels;
            public bool AutoCeiling;
            public bool HideWalls;
            public bool HideGround;
            public bool HideRoof;
            public bool HideUi;
            public bool Cutaway;
            public bool Dense;
            public int LevelBase;
            public int StoreyHeight;
            public bool SectionClipping;
            public int OtherLevelMeshLod;

            public static GlobalPolicySnapshot Capture(StationVisibilityState state, bool sectionClipping) => new GlobalPolicySnapshot {
                ShowLevels = state.ShowLevels,
                AutoCeiling = state.AutoCeiling,
                HideWalls = state.HideWalls,
                HideGround = state.HideGround,
                HideRoof = state.HideRoof,
                HideUi = state.HideUi,
                Cutaway = state.Cutaway,
                Dense = state.Dense,
                LevelBase = state.LevelBase,
                StoreyHeight = state.StoreyHeight,
                SectionClipping = sectionClipping,
                OtherLevelMeshLod = StationVisibilityRules.OtherLevelMeshLod,
            };

            public bool Equals(in GlobalPolicySnapshot other) =>
                ShowLevels == other.ShowLevels &&
                AutoCeiling == other.AutoCeiling &&
                HideWalls == other.HideWalls &&
                HideGround == other.HideGround &&
                HideRoof == other.HideRoof &&
                HideUi == other.HideUi &&
                Cutaway == other.Cutaway &&
                Dense == other.Dense &&
                LevelBase == other.LevelBase &&
                StoreyHeight == other.StoreyHeight &&
                SectionClipping == other.SectionClipping &&
                OtherLevelMeshLod == other.OtherLevelMeshLod;
        }

        readonly List<IStationVisibilityTarget> targets = new List<IStationVisibilityTarget>();
        readonly HashSet<IStationVisibilityTarget> targetSet =
            new HashSet<IStationVisibilityTarget>(ReferenceTargetComparer.Instance);
        readonly Dictionary<IStationVisibilityTarget, AppliedTargetSummary> appliedSummaries =
            new Dictionary<IStationVisibilityTarget, AppliedTargetSummary>(ReferenceTargetComparer.Instance);
        readonly Dictionary<IStationVisibilityTarget, TargetIndexEntry> targetIndex =
            new Dictionary<IStationVisibilityTarget, TargetIndexEntry>(ReferenceTargetComparer.Instance);
        readonly Dictionary<int, List<IStationVisibilityTarget>> singleLevelTargets =
            new Dictionary<int, List<IStationVisibilityTarget>>();
        readonly List<IStationVisibilityTarget> dynamicTargets = new List<IStationVisibilityTarget>();
        readonly Dictionary<int, int> occupiedLevelCounts = new Dictionary<int, int>();
        readonly List<int> affectedLevelsScratch = new List<int>(8);
        readonly StationVisibilityPalette palette;
        bool hasFullApply;
        GlobalPolicySnapshot lastAppliedPolicy;
        public readonly StationVisibilityState State = new StationVisibilityState();
        public StationSectionPlane Section = StationSectionPlane.Default;
        public bool SectionClipping;
        public bool SectionSurfaceVisible = true;
        public event Action Applied;

        public int RegisteredTargets => targets.Count;
        public IReadOnlyList<IStationVisibilityTarget> Targets => targets;
        public int VisibleTargets { get; private set; }
        public int HiddenTargets { get; private set; }
        public int GhostTargets { get; private set; }
        public int ClearTargets { get; private set; }
        public int CutTargets { get; private set; }
        public int StraddlingTargets { get; private set; }
        public int SectionShaderTargets { get; private set; }
        public bool SectionShaderSupported => SectionShaderTargets > 0;
        public bool ActiveBuilt { get; private set; }
        public bool HasApplied => hasFullApply;
        public int LastApplyVisitedTargets { get; private set; }
        public int LastApplyChangedTargets { get; private set; }
        public bool LastApplyUsedSubset { get; private set; }
        public int LastApplyRendererWrites { get; private set; }
        public int LastApplyColliderWrites { get; private set; }
        public int LastApplyMaterialWrites { get; private set; }

        public StationVisibilityRegistry(Shader materialShader = null) {
            palette = new StationVisibilityPalette(materialShader);
        }

        static bool IsOccupiedGeometryRole(StationPartRole role) =>
            role != StationPartRole.Ground && role != StationPartRole.Road &&
            role != StationPartRole.Grid && role != StationPartRole.Cursor &&
            role != StationPartRole.Overlay && role != StationPartRole.Actor &&
            role != StationPartRole.Train && role != StationPartRole.Vehicle;

        static bool IsFurnitureRole(StationPartRole role) =>
            role == StationPartRole.Grid || role == StationPartRole.Cursor || role == StationPartRole.Overlay;

        void AddToIndex(IStationVisibilityTarget target) {
            if (target == null) return;
            RemoveFromIndex(target);
            var role = target.Role;
            if (IsFurnitureRole(role)) {
                targetIndex[target] = default;
                return;
            }
            var concrete = target as StationVisibilityTarget;
            var levels = target.LevelZs;
            bool isSingleStatic = concrete != null &&
                !concrete.parked &&
                !concrete.contactShadow &&
                !concrete.floating &&
                concrete.groundBand == StationVisibilityTarget.NoGroundBand &&
                role != StationPartRole.Train &&
                role != StationPartRole.Actor &&
                role != StationPartRole.Vehicle &&
                levels != null && levels.Count == 1;

            if (isSingleStatic) {
                int level = levels[0];
                if (!singleLevelTargets.TryGetValue(level, out var list)) {
                    list = new List<IStationVisibilityTarget>();
                    singleLevelTargets[level] = list;
                }
                list.Add(target);
                bool occupies = !concrete.gradeOwned && IsOccupiedGeometryRole(role);
                if (occupies) {
                    occupiedLevelCounts.TryGetValue(level, out int count);
                    occupiedLevelCounts[level] = count + 1;
                }
                targetIndex[target] = new TargetIndexEntry {
                    InSingleLevel = true,
                    SingleLevel = level,
                    InOccupiedCount = occupies,
                };
            } else {
                dynamicTargets.Add(target);
                targetIndex[target] = new TargetIndexEntry { InDynamic = true };
            }
        }

        void RemoveFromIndex(IStationVisibilityTarget target) {
            if (target == null || !targetIndex.TryGetValue(target, out var entry)) return;
            targetIndex.Remove(target);
            if (entry.InSingleLevel) {
                if (singleLevelTargets.TryGetValue(entry.SingleLevel, out var list)) {
                    for (int i = list.Count - 1; i >= 0; i--) {
                        if (ReferenceEquals(list[i], target)) { list.RemoveAt(i); break; }
                    }
                    if (list.Count == 0) singleLevelTargets.Remove(entry.SingleLevel);
                }
                if (entry.InOccupiedCount && occupiedLevelCounts.TryGetValue(entry.SingleLevel, out int count)) {
                    if (count <= 1) occupiedLevelCounts.Remove(entry.SingleLevel);
                    else occupiedLevelCounts[entry.SingleLevel] = count - 1;
                }
            } else if (entry.InDynamic) {
                for (int i = dynamicTargets.Count - 1; i >= 0; i--) {
                    if (ReferenceEquals(dynamicTargets[i], target)) { dynamicTargets.RemoveAt(i); break; }
                }
            }
        }

        public StationVisibilityTarget Register(Transform root, StationPartRole role, int[] levels,
            int groundBand = StationVisibilityTarget.NoGroundBand, bool parked = false, bool floating = false,
            bool contactShadow = false, bool gradeOwned = false) {
            if (!root) return null;
            var target = root.GetComponent<StationVisibilityTarget>() ?? root.gameObject.AddComponent<StationVisibilityTarget>();
            bool existed = !targetSet.Add(target);
            if (existed) RemoveFromIndex(target);
            else targets.Add(target);
            target.Configure(role, levels, groundBand, parked, floating, contactShadow, gradeOwned);
            AddToIndex(target);
            return target;
        }

        public void Register(IStationVisibilityTarget target) {
            if (target != null && targetSet.Add(target)) {
                targets.Add(target);
                AddToIndex(target);
            }
        }

        public bool Unregister(IStationVisibilityTarget target) {
            if (target == null || !targetSet.Remove(target)) return false;
            SubtractSummary(target);
            RemoveFromIndex(target);
            for (int i = targets.Count - 1; i >= 0; i--) {
                if (ReferenceEquals(targets[i], target)) {
                    targets.RemoveAt(i);
                    break;
                }
            }
            return true;
        }

        public void ClearRegisteredTargets() {
            targets.Clear();
            targetSet.Clear();
            appliedSummaries.Clear();
            targetIndex.Clear();
            singleLevelTargets.Clear();
            dynamicTargets.Clear();
            occupiedLevelCounts.Clear();
            hasFullApply = false;
            VisibleTargets = HiddenTargets = GhostTargets = ClearTargets = CutTargets = StraddlingTargets = 0;
            SectionShaderTargets = 0;
        }

        void SubtractSummary(IStationVisibilityTarget target) {
            if (!appliedSummaries.TryGetValue(target, out var prev)) return;
            appliedSummaries.Remove(target);
            VisibleTargets = Math.Max(0, VisibleTargets - prev.Visible);
            HiddenTargets = Math.Max(0, HiddenTargets - prev.Hidden);
            GhostTargets = Math.Max(0, GhostTargets - prev.Ghost);
            ClearTargets = Math.Max(0, ClearTargets - prev.Clear);
            CutTargets = Math.Max(0, CutTargets - prev.Cut);
            StraddlingTargets = Math.Max(0, StraddlingTargets - prev.Straddling);
            SectionShaderTargets = Math.Max(0, SectionShaderTargets - prev.SectionShader);
        }

        void RecordSummary(IStationVisibilityTarget target, StationDrawMode mode) {
            var next = default(AppliedTargetSummary);
            next.Mode = mode;
            if (mode == StationDrawMode.Hidden) next.Hidden = 1;
            else {
                next.Visible = 1;
                if (mode == StationDrawMode.Ghost) next.Ghost = 1;
                else if (mode == StationDrawMode.Clear) next.Clear = 1;
            }
            if (SectionClipping && TargetHasBounds(target)) {
                var side = Section.Classify(target.WorldBounds);
                if (side == StationSectionSide.Cut) next.Cut = 1;
                else if (side == StationSectionSide.Straddles) next.Straddling = 1;
            }
            if (target is StationVisibilityTarget concrete && concrete.SectionShaderActive) next.SectionShader = 1;

            appliedSummaries[target] = next;
            VisibleTargets += next.Visible;
            HiddenTargets += next.Hidden;
            GhostTargets += next.Ghost;
            ClearTargets += next.Clear;
            CutTargets += next.Cut;
            StraddlingTargets += next.Straddling;
            SectionShaderTargets += next.SectionShader;
        }

        void SyncPaletteSection() {
            palette.SectionClipping = SectionClipping;
            palette.OtherLevelMeshLod = StationVisibilityRules.OtherLevelMeshLod;
            var normal = StationCameraSpace.ToWorld(Section.Normal);
            var point = StationCameraSpace.ToWorld(Section.Point);
            palette.SectionPlane = new Vector4(normal.x, normal.y, normal.z, -Vector3.Dot(normal, point));
        }

        bool IsOtherLevelLod(IStationVisibilityTarget target, StationDrawMode mode) {
            if (mode == StationDrawMode.Hidden || State.HideUi || State.Cutaway) return false;
            var role = target.Role;
            if (role == StationPartRole.Grid || role == StationPartRole.Cursor || role == StationPartRole.Overlay)
                return false;
            if (mode == StationDrawMode.Ghost) return true;
            return StationVisibilityRules.LevelSide(target.LevelZs, State.ActiveLevel) != StationLevelSide.Active;
        }

        void ApplyMode(IStationVisibilityTarget target, StationDrawMode mode) {
            if (target is StationVisibilityTarget concrete) {
                concrete.Apply(mode, palette, IsOtherLevelLod(target, mode));
            } else {
                target.Apply(mode, palette);
            }
        }

        public bool RefreshActiveBuilt() {
            bool next = ComputeActiveBuilt();
            bool changed = next != ActiveBuilt;
            ActiveBuilt = next;
            return changed;
        }

        /// <summary>
        /// Re-evaluate and apply visibility for one live target without allocating or walking
        /// unaffected scene targets.
        /// </summary>
        public StationDrawMode ApplyTarget(IStationVisibilityTarget target) {
            if (target == null) return StationDrawMode.Hidden;
            if (target is UnityEngine.Object unityObject && unityObject == null) return StationDrawMode.Hidden;
            SyncPaletteSection();
            var slice = StationVisibilityRules.SliceOptions(State.ShowLevels, State.AutoCeiling, State.HideUi, State.Cutaway, ActiveBuilt);
            SubtractSummary(target);
            var mode = Decide(target, slice);
            ApplyMode(target, mode);
            if (targetSet.Contains(target)) RecordSummary(target, mode);
            return mode;
        }

        public void ApplyTargets(IReadOnlyList<IStationVisibilityTarget> subset) {
            if (subset == null || subset.Count == 0) return;
            SyncPaletteSection();
            var slice = StationVisibilityRules.SliceOptions(State.ShowLevels, State.AutoCeiling, State.HideUi, State.Cutaway, ActiveBuilt);
            for (int i = 0; i < subset.Count; i++) {
                var target = subset[i];
                if (target == null) continue;
                if (target is UnityEngine.Object unityObject && unityObject == null) continue;
                SubtractSummary(target);
                var mode = Decide(target, slice);
                ApplyMode(target, mode);
                if (targetSet.Contains(target)) RecordSummary(target, mode);
            }
            Applied?.Invoke();
        }

        void AddAffectedLevel(int level) {
            if (!singleLevelTargets.ContainsKey(level)) return;
            for (int i = 0; i < affectedLevelsScratch.Count; i++) {
                if (affectedLevelsScratch[i] == level) return;
            }
            affectedLevelsScratch.Add(level);
        }

        void ApplySubsetList(List<IStationVisibilityTarget> list, StationSliceOptions slice, ref bool prunedAny) {
            for (int i = list.Count - 1; i >= 0; i--) {
                var target = list[i];
                if (target == null || (target is UnityEngine.Object unityObj && unityObj == null)) {
                    list.RemoveAt(i);
                    if (target != null) {
                        SubtractSummary(target);
                        targetSet.Remove(target);
                        if (targetIndex.TryGetValue(target, out var deadEntry)) {
                            targetIndex.Remove(target);
                            if (deadEntry.InOccupiedCount && occupiedLevelCounts.TryGetValue(deadEntry.SingleLevel, out int occ)) {
                                if (occ <= 1) occupiedLevelCounts.Remove(deadEntry.SingleLevel);
                                else occupiedLevelCounts[deadEntry.SingleLevel] = occ - 1;
                            }
                        }
                    }
                    prunedAny = true;
                    continue;
                }
                LastApplyVisitedTargets++;
                bool hadPrev = appliedSummaries.TryGetValue(target, out var prevSummary);
                var mode = Decide(target, slice);
                bool modeChanged = !hadPrev || prevSummary.Mode != mode;
                if (modeChanged) LastApplyChangedTargets++;
                if (!modeChanged && !SectionClipping && mode == StationDrawMode.Hidden && target is StationVisibilityTarget hiddenConcrete) {
                    hiddenConcrete.Apply(mode, palette, otherLevelLod: false);
                    continue;
                }
                SubtractSummary(target);
                ApplyMode(target, mode);
                if (target is StationVisibilityTarget concrete) {
                    LastApplyRendererWrites += concrete.LastRendererWrites;
                    LastApplyColliderWrites += concrete.LastColliderWrites;
                    LastApplyMaterialWrites += concrete.LastMaterialWrites;
                }
                RecordSummary(target, mode);
            }
        }

        /// <summary>
        /// Incremental level-step path: when only <see cref="StationVisibilityState.ActiveLevel"/>
        /// moved under stable global flags and unchanged occupied-floor state, re-evaluates only
        /// targets in the affected storey bands plus dynamic/multi-level targets. Falls back to
        /// full <see cref="Apply"/> whenever global policy or empty/occupied floor state changed.
        /// </summary>
        public void ApplyLevelChange(int previousActiveLevel) {
            var policy = GlobalPolicySnapshot.Capture(State, SectionClipping);
            bool nextActiveBuilt = ComputeActiveBuilt();
            if (!hasFullApply ||
                State.Cutaway ||
                State.HideUi ||
                !policy.Equals(lastAppliedPolicy) ||
                nextActiveBuilt != ActiveBuilt ||
                appliedSummaries.Count != targets.Count) {
                Apply();
                return;
            }

            ActiveBuilt = nextActiveBuilt;
            SyncPaletteSection();
            var slice = StationVisibilityRules.SliceOptions(State.ShowLevels, State.AutoCeiling, State.HideUi, State.Cutaway, ActiveBuilt);
            LastApplyVisitedTargets = 0;
            LastApplyChangedTargets = 0;
            LastApplyUsedSubset = true;
            LastApplyRendererWrites = 0;
            LastApplyColliderWrites = 0;
            LastApplyMaterialWrites = 0;

            affectedLevelsScratch.Clear();
            int nextLevel = State.ActiveLevel;
            if (!State.ShowLevels) {
                AddAffectedLevel(previousActiveLevel);
                AddAffectedLevel(nextLevel);
            } else if (State.Dense) {
                int step = State.StoreyHeight > 0 ? State.StoreyHeight : StationLevelGrid.LadderStep;
                AddAffectedLevel(previousActiveLevel - step);
                AddAffectedLevel(previousActiveLevel);
                AddAffectedLevel(nextLevel - step);
                AddAffectedLevel(nextLevel);
                if (!slice.HideAbove) {
                    AddAffectedLevel(previousActiveLevel + step);
                    AddAffectedLevel(nextLevel + step);
                }
            } else {
                int lo = Math.Min(previousActiveLevel, nextLevel);
                int hi = Math.Max(previousActiveLevel, nextLevel);
                foreach (var level in singleLevelTargets.Keys) {
                    if (level >= lo && level <= hi) affectedLevelsScratch.Add(level);
                }
            }

            bool prunedAny = false;
            for (int b = 0; b < affectedLevelsScratch.Count; b++) {
                int level = affectedLevelsScratch[b];
                if (singleLevelTargets.TryGetValue(level, out var bucket)) {
                    ApplySubsetList(bucket, slice, ref prunedAny);
                    if (bucket.Count == 0) singleLevelTargets.Remove(level);
                }
            }
            ApplySubsetList(dynamicTargets, slice, ref prunedAny);
            if (prunedAny) {
                for (int i = targets.Count - 1; i >= 0; i--) {
                    var t = targets[i];
                    if (t == null || !targetSet.Contains(t)) targets.RemoveAt(i);
                }
            }
            Applied?.Invoke();
        }

        public void Apply() {
            ActiveBuilt = ComputeActiveBuilt();
            SyncPaletteSection();
            var slice = StationVisibilityRules.SliceOptions(State.ShowLevels, State.AutoCeiling, State.HideUi, State.Cutaway, ActiveBuilt);
            VisibleTargets = HiddenTargets = GhostTargets = ClearTargets = CutTargets = StraddlingTargets = 0;
            SectionShaderTargets = 0;
            LastApplyVisitedTargets = 0;
            LastApplyChangedTargets = 0;
            LastApplyUsedSubset = false;
            LastApplyRendererWrites = 0;
            LastApplyColliderWrites = 0;
            LastApplyMaterialWrites = 0;
            for (int i = targets.Count - 1; i >= 0; i--) {
                var target = targets[i];
                if (target == null) { targets.RemoveAt(i); continue; }
                // A target backed by a Unity object that was destroyed with a station
                // root must leave the walk. A plain test target has no engine identity
                // at all, so `Root == null` is not the liveness test.
                if (target is UnityEngine.Object unityObject && unityObject == null) {
                    targetSet.Remove(target);
                    appliedSummaries.Remove(target);
                    RemoveFromIndex(target);
                    targets.RemoveAt(i);
                    continue;
                }
                LastApplyVisitedTargets++;
                bool hadPrev = appliedSummaries.TryGetValue(target, out var prevSummary);
                var mode = Decide(target, slice);
                if (!hadPrev || prevSummary.Mode != mode) LastApplyChangedTargets++;
                ApplyMode(target, mode);
                if (target is StationVisibilityTarget concrete) {
                    LastApplyRendererWrites += concrete.LastRendererWrites;
                    LastApplyColliderWrites += concrete.LastColliderWrites;
                    LastApplyMaterialWrites += concrete.LastMaterialWrites;
                }
                RecordSummary(target, mode);
            }
            hasFullApply = true;
            lastAppliedPolicy = GlobalPolicySnapshot.Capture(State, SectionClipping);
            Applied?.Invoke();
        }

        /// <summary>The one mode decision for a target; renderers, actors and picking share it.</summary>
        public StationDrawMode Decide(IStationVisibilityTarget target) {
            var slice = StationVisibilityRules.SliceOptions(State.ShowLevels, State.AutoCeiling, State.HideUi, State.Cutaway, ActiveBuilt);
            return Decide(target, slice);
        }

        /// <summary>
        /// One **unregistered** part's draw mode — a pooled road vehicle, a crowd actor or
        /// any other object that follows the slice without a world record of its own. It
        /// reads the same <see cref="Decide(IStationVisibilityTarget,StationSliceOptions)"/>
        /// rule as a registered target, so a hidden storey, 隐藏地面 and a dense slice answer
        /// one way for the geometry and its actors.
        /// </summary>
        public StationDrawMode DecidePart(StationPartRole role, int[] levelsZs, bool floating = false,
            int groundBand = StationVisibilityTarget.NoGroundBand, bool gradeOwned = false,
            bool parked = false, Bounds? worldBounds = null) {
            standalone.Role = role;
            standalone.LevelZs = levelsZs ?? Array.Empty<int>();
            standalone.Floating = floating;
            standalone.GroundBand = groundBand;
            standalone.GradeOwned = gradeOwned;
            standalone.Parked = parked;
            standalone.HasBounds = worldBounds.HasValue;
            standalone.Bounds = worldBounds ?? default;
            return Decide(standalone);
        }

        readonly StandalonePart standalone = new StandalonePart();

        sealed class StandalonePart : IStationVisibilityTarget {
            public StationPartRole Role { get; set; }
            public IReadOnlyList<int> LevelZs { get; set; } = Array.Empty<int>();
            public int GroundBand { get; set; } = StationVisibilityTarget.NoGroundBand;
            public bool Parked { get; set; }
            public bool Floating { get; set; }
            public bool ContactShadow => false;
            /// <summary>An unregistered part that still belongs to the authored grade (20 §4).</summary>
            public bool GradeOwned { get; set; }
            public bool HasBounds { get; set; }
            public Bounds Bounds { get; set; }
            public Transform Root => null;
            public Bounds WorldBounds => Bounds;
            public StationDrawMode LastMode => StationDrawMode.Base;
            public void Apply(StationDrawMode mode, StationVisibilityPalette palette) { }
        }

        static bool TargetHasBounds(IStationVisibilityTarget target) =>
            !(target is StandalonePart part) || part.HasBounds;

        StationDrawMode Decide(IStationVisibilityTarget target, StationSliceOptions slice) {
            var role = target.Role;
            // Hide UI's whole subject is the drawing furniture; a station piece never
            // disappears because the lattice did.
            // Grid, cursor and the information overlays are editing furniture: Hide UI is
            // their only switch. The overlays clip themselves to the active storey (plan 13 §5),
            // so the storey slice must not also hide them.
            if (role == StationPartRole.Grid || role == StationPartRole.Cursor || role == StationPartRole.Overlay) {
                return State.HideUi ? StationDrawMode.Hidden : StationDrawMode.Base;
            }
            if (target.Parked) return StationDrawMode.Hidden;

            bool wall = role == StationPartRole.Wall || role == StationPartRole.Psd;
            if (State.Cutaway) {
                // While a cut is on, the only thing that may hide a kept piece is the
                // player's own 隐藏墙壁; the slice is put away. The absolute surface
                // toggles (隐藏地面 / 隐藏屋顶 / 隐藏天花板) still apply — they are not
                // ways of drawing a storey.
                if (IsGradePart(target)) return StationDrawMode.Hidden;
                if (State.HideRoof && role == StationPartRole.Roof) return StationDrawMode.Hidden;
                if (State.AutoCeiling && role == StationPartRole.Ceiling && !State.HideUi) return StationDrawMode.Hidden;
                if (State.HideWalls && wall) return StationDrawMode.Hidden;
                if (SectionClipping && TargetHasBounds(target) && Section.Classify(target.WorldBounds) == StationSectionSide.Cut) {
                    return StationDrawMode.Hidden;
                }
                return StationDrawMode.Base;
            }
            if (IsGradePart(target)) return StationDrawMode.Hidden;
            if (role == StationPartRole.Roof && State.HideRoof) return StationDrawMode.Hidden;
            if (role == StationPartRole.Ceiling && State.AutoCeiling && !State.HideUi) return StationDrawMode.Hidden;

            if (target.ContactShadow) {
                var grid = new StationLevelGrid {
                    LevelBase = StationLevelGrid.NormalizeBase(State.LevelBase),
                    StoreyHeight = State.StoreyHeight > 0 ? State.StoreyHeight : StationLevelGrid.LadderStep,
                };
                int shadowZ = target.LevelZs != null && target.LevelZs.Count > 0
                    ? target.LevelZs[0]
                    : Mathf.RoundToInt(StationCameraSpace.ToDocument(target.WorldBounds.center).z);
                bool everyStorey = State.HideUi || State.Cutaway;
                if (!StationVisibilityRules.ContactShadowVisible(shadowZ, State.ActiveLevel, everyStorey, grid)) {
                    return StationDrawMode.Hidden;
                }
                return StationDrawMode.Base;
            }

            var side = StationVisibilityRules.LevelSide(target.LevelZs, State.ActiveLevel);
            if (!State.HideUi) {
                slice.Unsupported = target.Floating ||
                    StationVisibilityRules.UnsupportedAbove(State.ActiveLevel, target.GroundBand);
                if (!StationVisibilityRules.BoundedLevelVisible(side, target.LevelZs, State.ActiveLevel, slice, State.Dense, State.StoreyHeight)) {
                    return StationDrawMode.Hidden;
                }
            }

            if (wall && State.HideWalls) return StationDrawMode.Clear;
            if (!State.HideUi && side != StationLevelSide.Active) return StationDrawMode.Ghost;
            return StationDrawMode.Base;
        }

        /// <summary>Hidden parts and contact shadows are unpickable; ghosts and see-through walls stay addressable.</summary>
        public bool IsTargetPickable(IStationVisibilityTarget target) =>
            target != null && !target.ContactShadow && Decide(target) != StationDrawMode.Hidden;

        /// <summary>
        /// Does 隐藏地面 remove this part? The ground slab, road deck and courses are grade roles;
        /// every other grade-owned prop, vehicle or street pedestrian carries the independent
        /// grade flag its producer classified it with (20 §4), because its own role still has to
        /// answer 隐藏墙壁 and the storey slice.
        /// </summary>
        bool IsGradePart(IStationVisibilityTarget target) {
            if (!State.HideGround || target == null) return false;
            if (target.Role == StationPartRole.Ground || target.Role == StationPartRole.Road) return true;
            return target.GradeOwned;
        }

        /// <summary>The section's contribution to a pick: a point in the cut-away half is rejected.</summary>
        public bool IsPointKept(Vector3 documentPoint) => !SectionClipping || Section.Keeps(documentPoint);

        public bool IsPickableAt(IStationVisibilityTarget target, Vector3 documentPoint) =>
            IsTargetPickable(target) && IsPointKept(documentPoint);

        /// <summary>
        /// Occupied-floor check over station geometry only: passengers, rolling stock, passing
        /// road vehicles, ground surfaces and editing furniture never turn an empty floor into
        /// an occupied one.
        /// </summary>
        bool ComputeActiveBuilt() {
            if (occupiedLevelCounts.TryGetValue(State.ActiveLevel, out int count) && count > 0) return true;
            for (int i = 0; i < dynamicTargets.Count; i++) {
                var target = dynamicTargets[i];
                if (target == null || (target is UnityEngine.Object unityObj && unityObj == null)) continue;
                if (target.Parked || target.ContactShadow || target.GradeOwned) continue;
                if (!IsOccupiedGeometryRole(target.Role)) continue;
                if (StationVisibilityRules.LevelSide(target.LevelZs, State.ActiveLevel) == StationLevelSide.Active) return true;
            }
            return false;
        }

        /// <summary>A new station builds new materials; drop the previous clones.</summary>
        public void ResetMaterials() => palette.Clear();

        public void Dispose() {
            targets.Clear();
            targetSet.Clear();
            appliedSummaries.Clear();
            targetIndex.Clear();
            singleLevelTargets.Clear();
            dynamicTargets.Clear();
            occupiedLevelCounts.Clear();
            hasFullApply = false;
            Applied = null;
            palette.Dispose();
        }
    }
}
