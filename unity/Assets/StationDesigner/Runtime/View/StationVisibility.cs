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
            StationSliceOptions options, bool dense) {
            if (dense && side != StationLevelSide.Active && !StoreyNear(levelsZ, activeZ)) return false;
            return LevelVisible(side, options);
        }

        /// <summary>True when any storey a piece occupies is next to the active one.</summary>
        public static bool StoreyNear(IReadOnlyList<int> levelsZ, int activeZ) {
            if (levelsZ == null || levelsZ.Count == 0) return true;
            for (int i = 0; i < levelsZ.Count; i++) if (Mathf.Abs(levelsZ[i] - activeZ) <= StationLevelGrid.LadderStep) return true;
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
            return Mathf.Round(value / step) * step;
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
        Transform Root { get; }
        Bounds WorldBounds { get; }
        StationDrawMode LastMode { get; }
        void Apply(StationDrawMode mode, StationVisibilityPalette palette);
        void SetExplodedOffset(Vector3 documentOffset);
        void ResetExploded();
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
        readonly Shader requested;
        Shader resolved;

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
            var clone = new Material(source) { name = source.name + (opacity < .2f ? " (clear)" : " (ghost)") };
            if (clone.HasProperty("_Surface")) clone.SetFloat("_Surface", 1f);
            if (clone.HasProperty("_Blend")) clone.SetFloat("_Blend", 0f);
            if (clone.HasProperty("_SrcBlend")) clone.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            if (clone.HasProperty("_DstBlend")) clone.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            if (clone.HasProperty("_ZWrite")) clone.SetFloat("_ZWrite", 0f);
            if (clone.HasProperty("_BaseColor")) {
                var colour = clone.GetColor("_BaseColor");
                colour.a = opacity;
                clone.SetColor("_BaseColor", colour);
            }
            if (clone.HasProperty("_Color")) {
                var colour = clone.GetColor("_Color");
                colour.a = opacity;
                clone.SetColor("_Color", colour);
            }
            clone.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            clone.DisableKeyword("_ALPHATEST_ON");
            clone.SetOverrideTag("RenderType", "Transparent");
            clone.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            cache[source] = clone;
            return clone;
        }

        public void Dispose() {
            Clear();
        }

        /// <summary>Drop the cached clones; a new station rebuilds its own materials.</summary>
        public void Clear() {
            foreach (var material in ghosts.Values) if (material) Destroy(material);
            foreach (var material in clears.Values) if (material) Destroy(material);
            ghosts.Clear();
            clears.Clear();
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

        Renderer[] renderers;
        Collider[] colliders;
        Material[][] baseMaterials;
        Vector3 basePosition;
        bool collected;
        bool exploded;
        StationDrawMode lastMode = StationDrawMode.Base;

        public StationPartRole Role => role;
        public IReadOnlyList<int> LevelZs => levels ?? Array.Empty<int>();
        public int GroundBand => groundBand;
        public bool Parked => parked;
        public bool Floating => floating;
        public bool ContactShadow => contactShadow;
        public Transform Root => transform;
        public StationDrawMode LastMode => lastMode;
        public IReadOnlyList<Renderer> Renderers { get { Collect(); return renderers; } }
        public IReadOnlyList<Collider> Colliders { get { Collect(); return colliders; } }

        public Bounds WorldBounds {
            get {
                Collect();
                bool has = false;
                var bounds = new Bounds(transform.position, Vector3.one);
                for (int i = 0; i < renderers.Length; i++) {
                    var renderer = renderers[i];
                    if (!renderer) continue;
                    if (!has) { bounds = renderer.bounds; has = true; }
                    else bounds.Encapsulate(renderer.bounds);
                }
                return bounds;
            }
        }

        public void Configure(StationPartRole partRole, int[] levelZs, int band = NoGroundBand, bool isParked = false,
            bool isFloating = false, bool isContactShadow = false) {
            role = partRole;
            levels = levelZs ?? Array.Empty<int>();
            groundBand = band;
            parked = isParked;
            floating = isFloating;
            contactShadow = isContactShadow;
            collected = false;
        }

        public void Refresh() {
            collected = false;
            Collect();
        }

        void Collect() {
            if (collected) return;
            collected = true;
            basePosition = transform.position;
            renderers = GetComponentsInChildren<Renderer>(true);
            colliders = GetComponentsInChildren<Collider>(true);
            baseMaterials = new Material[renderers.Length][];
            for (int i = 0; i < renderers.Length; i++) {
                var renderer = renderers[i];
                baseMaterials[i] = renderer ? renderer.sharedMaterials : Array.Empty<Material>();
            }
        }

        public void Apply(StationDrawMode mode, StationVisibilityPalette palette) {
            Collect();
            lastMode = mode;
            bool visible = mode != StationDrawMode.Hidden;
            for (int i = 0; i < renderers.Length; i++) {
                var renderer = renderers[i];
                if (!renderer) continue;
                renderer.enabled = visible;
                if (!visible || palette == null) continue;
                var bases = baseMaterials[i];
                if (bases == null || bases.Length == 0) continue;
                switch (mode) {
                    case StationDrawMode.Base:
                        renderer.sharedMaterials = bases;
                        break;
                    case StationDrawMode.Ghost:
                        renderer.sharedMaterials = Map(bases, palette.Ghost);
                        break;
                    case StationDrawMode.Clear:
                        renderer.sharedMaterials = Map(bases, palette.Clear);
                        break;
                }
            }
            for (int i = 0; i < colliders.Length; i++) {
                if (colliders[i]) colliders[i].enabled = visible;
            }
        }

        static Material[] Map(Material[] sources, Func<Material, Material> map) {
            var result = new Material[sources.Length];
            for (int i = 0; i < sources.Length; i++) result[i] = map(sources[i]);
            return result;
        }

        public void SetExplodedOffset(Vector3 documentOffset) {
            Collect();
            exploded = true;
            transform.position = basePosition + StationCameraSpace.ToWorld(documentOffset);
        }

        public void ResetExploded() {
            if (!exploded) return;
            Collect();
            exploded = false;
            transform.position = basePosition;
        }

        void OnDestroy() {
            ResetExploded();
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

        /// <summary>
        /// Derive the storey plans from registered target bounds. The cell-level tray
        /// algorithm stays in A's document; this is the view's own approximation so an
        /// exploded preview exists before that registration lands.
        /// </summary>
        public static StationExplodedPlan FromTargets(IReadOnlyList<IStationVisibilityTarget> targets, int[] levels = null) {
            var found = new SortedSet<int>();
            if (levels != null) foreach (int level in levels) found.Add(level);
            if (targets != null) {
                foreach (var target in targets) {
                    if (target?.LevelZs == null) continue;
                    if (!Explodable(target.Role)) continue;
                    foreach (int level in target.LevelZs) found.Add(level);
                }
            }
            var levelArray = new int[found.Count];
            found.CopyTo(levelArray);
            var plans = new List<IReadOnlyList<Vector2Int>>(levelArray.Length);
            double minX = double.MaxValue, maxX = double.MinValue, minY = double.MaxValue, maxY = double.MinValue;
            foreach (int level in levelArray) {
                var points = new HashSet<long>();
                var plan = new List<Vector2Int>();
                if (targets != null) {
                    foreach (var target in targets) {
                        if (target?.LevelZs == null) continue;
                        if (!Explodable(target.Role)) continue;
                        bool covers = false;
                        foreach (int owned in target.LevelZs) if (owned == level) { covers = true; break; }
                        if (!covers) continue;
                        var bounds = target.WorldBounds;
                        var centre = StationCameraSpace.ToDocument(bounds.center);
                        var size = StationCameraSpace.ToDocument(bounds.size);
                        int cx = Mathf.RoundToInt(centre.x);
                        int cy = Mathf.RoundToInt(centre.y);
                        int hx = Mathf.Max(1, Mathf.CeilToInt(size.x * .5f));
                        int hy = Mathf.Max(1, Mathf.CeilToInt(size.y * .5f));
                        Add(points, plan, cx, cy);
                        Add(points, plan, cx - hx, cy - hy);
                        Add(points, plan, cx + hx, cy - hy);
                        Add(points, plan, cx - hx, cy + hy);
                        Add(points, plan, cx + hx, cy + hy);
                        minX = Math.Min(minX, cx - hx); maxX = Math.Max(maxX, cx + hx);
                        minY = Math.Min(minY, cy - hy); maxY = Math.Max(maxY, cy + hy);
                    }
                }
                plans.Add(plan);
            }
            var preferred = maxX - minX >= maxY - minY ? new Vector2Int(0, 1) : new Vector2Int(1, 0);
            return Compute(levelArray, plans, preferred);
        }

        static void Add(HashSet<long> keys, List<Vector2Int> plan, int x, int y) {
            if (!keys.Add(Key(x, y))) return;
            plan.Add(new Vector2Int(x, y));
        }

        static bool Explodable(StationPartRole role) =>
            role != StationPartRole.Ground && role != StationPartRole.Roof &&
            role != StationPartRole.Grid && role != StationPartRole.Cursor && role != StationPartRole.Overlay;

        static long Key(int x, int y) => (long)x * 4294967296L + y;
    }

    /// <summary>
    /// The view walk: one visibility state, one section plane and one exploded plan
    /// applied to every registered part, actor and pick query. Renderers, colliders and
    /// material variants are the only things it writes; it never edits the document and
    /// never restarts a simulation.
    /// </summary>
    public sealed class StationVisibilityRegistry : IDisposable {
        readonly List<IStationVisibilityTarget> targets = new List<IStationVisibilityTarget>();
        readonly StationVisibilityPalette palette;
        public readonly StationVisibilityState State = new StationVisibilityState();
        public StationSectionPlane Section = StationSectionPlane.Default;
        public bool SectionClipping;
        public bool SectionSurfaceVisible = true;
        public StationExplodedPlan ExplodedPlan;

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

        public StationVisibilityRegistry(Shader materialShader = null) {
            palette = new StationVisibilityPalette(materialShader);
        }

        public StationVisibilityTarget Register(Transform root, StationPartRole role, int[] levels,
            int groundBand = StationVisibilityTarget.NoGroundBand, bool parked = false, bool floating = false,
            bool contactShadow = false) {
            if (!root) return null;
            var target = root.GetComponent<StationVisibilityTarget>() ?? root.gameObject.AddComponent<StationVisibilityTarget>();
            target.Configure(role, levels, groundBand, parked, floating, contactShadow);
            if (!targets.Contains(target)) targets.Add(target);
            return target;
        }

        public void Register(IStationVisibilityTarget target) {
            if (target != null && !targets.Contains(target)) targets.Add(target);
        }

        public bool Unregister(IStationVisibilityTarget target) => targets.Remove(target);

        public void ClearRegisteredTargets() => targets.Clear();

        public void Apply() {
            ActiveBuilt = ComputeActiveBuilt();
            var slice = StationVisibilityRules.SliceOptions(State.ShowLevels, State.AutoCeiling, State.HideUi, State.Cutaway, ActiveBuilt);
            VisibleTargets = HiddenTargets = GhostTargets = ClearTargets = CutTargets = StraddlingTargets = 0;
            SectionShaderTargets = 0;
            for (int i = targets.Count - 1; i >= 0; i--) {
                var target = targets[i];
                if (target == null) { targets.RemoveAt(i); continue; }
                // A target backed by a Unity object that was destroyed with a station
                // root must leave the walk. A plain test target has no engine identity
                // at all, so `Root == null` is not the liveness test.
                if (target is UnityEngine.Object unityObject && unityObject == null) { targets.RemoveAt(i); continue; }
                var mode = Decide(target, slice);
                target.Apply(mode, palette);
                if (mode == StationDrawMode.Hidden) HiddenTargets++;
                else {
                    VisibleTargets++;
                    if (mode == StationDrawMode.Ghost) GhostTargets++;
                    else if (mode == StationDrawMode.Clear) ClearTargets++;
                }
                if (SectionClipping) {
                    var side = Section.Classify(target.WorldBounds);
                    if (side == StationSectionSide.Cut) CutTargets++;
                    else if (side == StationSectionSide.Straddles) StraddlingTargets++;
                }
                if (State.Exploded && ExplodedPlan != null) {
                    int level = target.LevelZs != null && target.LevelZs.Count > 0 ? target.LevelZs[0] : State.ActiveLevel;
                    target.SetExplodedOffset(ExplodedPlan.DocumentOffset(level));
                } else {
                    target.ResetExploded();
                }
                ApplySectionMaterialContract(target);
            }
        }

        /// <summary>The one mode decision for a target; renderers, actors and picking share it.</summary>
        public StationDrawMode Decide(IStationVisibilityTarget target) {
            var slice = StationVisibilityRules.SliceOptions(State.ShowLevels, State.AutoCeiling, State.HideUi, State.Cutaway, ActiveBuilt);
            return Decide(target, slice);
        }

        StationDrawMode Decide(IStationVisibilityTarget target, StationSliceOptions slice) {
            var role = target.Role;
            // Hide UI's whole subject is the drawing furniture; a station piece never
            // disappears because the lattice did.
            if (role == StationPartRole.Grid || role == StationPartRole.Cursor) {
                return State.HideUi ? StationDrawMode.Hidden : StationDrawMode.Base;
            }
            bool wall = role == StationPartRole.Wall || role == StationPartRole.Psd;
            if (State.Cutaway) {
                // While a cut is on, the only thing that may hide a kept piece is the
                // player's own 隐藏墙壁; the slice is put away. The absolute surface
                // toggles (隐藏地面 / 隐藏屋顶 / 隐藏天花板) still apply — they are not
                // ways of drawing a storey.
                if (State.HideGround && role == StationPartRole.Ground) return StationDrawMode.Hidden;
                if (State.HideRoof && role == StationPartRole.Roof) return StationDrawMode.Hidden;
                if (State.AutoCeiling && role == StationPartRole.Ceiling) return StationDrawMode.Hidden;
                if (State.HideWalls && wall) return StationDrawMode.Hidden;
                if (SectionClipping && Section.Classify(target.WorldBounds) == StationSectionSide.Cut) return StationDrawMode.Hidden;
                return StationDrawMode.Base;
            }
            if (role == StationPartRole.Ground && State.HideGround) return StationDrawMode.Hidden;
            if (role == StationPartRole.Roof && State.HideRoof) return StationDrawMode.Hidden;
            if (role == StationPartRole.Ceiling && State.AutoCeiling && !State.HideUi) return StationDrawMode.Hidden;

            var grid = StationLevelGrid.FromDocument(State.LevelBase, State.StoreyHeight, null);
            if (target.ContactShadow) {
                int shadowZ = Mathf.RoundToInt(StationCameraSpace.ToDocument(target.WorldBounds.center).z);
                bool everyStorey = State.HideUi || State.Cutaway;
                if (!StationVisibilityRules.ContactShadowVisible(shadowZ, State.ActiveLevel, everyStorey, grid)) {
                    return StationDrawMode.Hidden;
                }
                return StationDrawMode.Base;
            }

            if (!State.HideUi) {
                var side = StationVisibilityRules.LevelSide(target.LevelZs, State.ActiveLevel);
                switch (role) {
                    case StationPartRole.Train:
                        if (!StationVisibilityRules.TrainVisible(side, State.ShowLevels, target.Parked)) return StationDrawMode.Hidden;
                        break;
                    case StationPartRole.Actor:
                        // A storey above is never drawn: a floor that is not drawn would
                        // leave the people standing on nothing.
                        if (!(side == StationLevelSide.Active || (State.ShowLevels && side == StationLevelSide.Below))) {
                            return StationDrawMode.Hidden;
                        }
                        break;
                    default:
                        slice.Unsupported = target.Floating ||
                            StationVisibilityRules.UnsupportedAbove(State.ActiveLevel, target.GroundBand);
                        if (!StationVisibilityRules.BoundedLevelVisible(side, target.LevelZs, State.ActiveLevel, slice, State.Dense)) {
                            return StationDrawMode.Hidden;
                        }
                        break;
                }
            }

            if (wall && State.HideWalls) return StationDrawMode.Clear;
            if (!State.HideUi) {
                var side = StationVisibilityRules.LevelSide(target.LevelZs, State.ActiveLevel);
                if (side != StationLevelSide.Active) return StationDrawMode.Ghost;
            }
            return StationDrawMode.Base;
        }

        /// <summary>Hidden parts are unpickable; ghosts and see-through walls stay addressable.</summary>
        public bool IsTargetPickable(IStationVisibilityTarget target) => Decide(target) != StationDrawMode.Hidden;

        /// <summary>The section's contribution to a pick: a point in the cut-away half is rejected.</summary>
        public bool IsPointKept(Vector3 documentPoint) => !SectionClipping || Section.Keeps(documentPoint);

        public bool IsPickableAt(IStationVisibilityTarget target, Vector3 documentPoint) =>
            IsTargetPickable(target) && IsPointKept(documentPoint);

        /// <summary>Hide UI never hides a station piece's colliders; the section and slicing do.</summary>
        bool ComputeActiveBuilt() {
            foreach (var target in targets) {
                var role = target.Role;
                if (role == StationPartRole.Ground || role == StationPartRole.Grid || role == StationPartRole.Cursor ||
                    role == StationPartRole.Overlay) continue;
                if (StationVisibilityRules.LevelSide(target.LevelZs, State.ActiveLevel) == StationLevelSide.Active) return true;
            }
            return false;
        }

        void ApplySectionMaterialContract(IStationVisibilityTarget target) {
            var root = target.Root;
            // ReferenceEquals first: a plain test target has no engine identity, and
            // the Unity `==` null operator is an engine call.
            if (ReferenceEquals(root, null)) return;
            var normal = StationCameraSpace.ToWorld(Section.Normal);
            var point = StationCameraSpace.ToWorld(Section.Point);
            var plane = new Vector4(normal.x, normal.y, normal.z, -Vector3.Dot(normal, point));
            bool supported = false;
            foreach (var renderer in root.GetComponentsInChildren<Renderer>(true)) {
                if (!renderer) continue;
                var material = renderer.sharedMaterial;
                if (material != null && material.HasProperty("_SectionPlane")) supported = true;
                var block = new MaterialPropertyBlock();
                renderer.GetPropertyBlock(block);
                block.SetVector("_SectionPlane", plane);
                block.SetFloat("_SectionClip", SectionClipping ? 1f : 0f);
                renderer.SetPropertyBlock(block);
            }
            if (supported) SectionShaderTargets++;
        }

        public void SetExplodedPlan(StationExplodedPlan plan) => ExplodedPlan = plan;

        /// <summary>A new station builds new materials; drop the previous clones.</summary>
        public void ResetMaterials() => palette.Clear();

        public void Dispose() {
            foreach (var target in targets) target?.ResetExploded();
            targets.Clear();
            palette.Dispose();
        }
    }
}
