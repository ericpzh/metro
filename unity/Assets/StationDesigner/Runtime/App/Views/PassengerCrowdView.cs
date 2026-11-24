using System;
using System.Collections.Generic;
using Metro.App;
using Metro.Build;
using Metro.Sim;
using Metro.View;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// One plain actor sample published for the crowd view: a stable simulation ID,
    /// a position in **document axes** (x plan, y plan, z elevation), a heading, the
    /// activity and its own phase. The view converts to Unity only here; nothing in
    /// this struct is a scene object and nothing here is a Unity type.
    /// </summary>
    public struct PassengerPose {
        /// <summary>Stable simulation identity; selects the recipe and the gait profile.</summary>
        public int SimId;
        /// <summary>Document plan x of the feet.</summary>
        public double X;
        /// <summary>Document plan y of the feet.</summary>
        public double Y;
        /// <summary>Document elevation of the feet (the walking plane).</summary>
        public double Z;
        /// <summary>Heading in document axes: <c>atan2(dy, dx)</c> radians.</summary>
        public double Heading;
        public PassengerActivity Activity;
        /// <summary>Seconds into the activity's own duration (the source's activity clock).</summary>
        public double ActivitySeconds;
        public StationRidePath RidePath;
        public double RideProgress, RideColumn, RideSeconds;
        public bool RideReverse;
        public int RailVariant;
        /// <summary>Cumulative walked metres since spawn (the source's travel-driven gait).</summary>
        public double WalkDistance;
        /// <summary>Gait phase at spawn, 0–1; walk distance advances it.</summary>
        public double WalkPhase;
        /// <summary>
        /// Idle→walk blend weight, 0–1 (the source's <c>gaitWeights</c>). Zero means
        /// "not published": the activity decides, so a plain frame carrying only
        /// identity/position/activity/phase still walks.
        /// </summary>
        public double WalkWeight;
        public bool HasWalkWeight;
        public PassengerDetail Detail;
        /// <summary>0 default, 1 right hand, 2 left hand (the source's preferred mode).</summary>
        public int PreferredHand;
        /// <summary>Simulation service state (Walking, Queuing, Riding, Boarding, Alighting).</summary>
        public StationPassengerState State;
        /// <summary>Bound service key (`line:...`, `lift:...`, `ride:...`, `gate:...`), if any.</summary>
        public string ServerId;
        /// <summary>False keeps the actor out of this frame without forgetting it.</summary>
        public bool Visible;
    }

    /// <summary>
    /// Packet C's actor frame source. <see cref="TryRead"/> fills the **complete**
    /// current actor set and returns false while no crowd is published (the view
    /// then keeps its last frame, so pause and replay do not blink). This is the
    /// seam the integration layer binds to C's session; the view never invents an
    /// actor when the feed is absent.
    /// </summary>
    public interface IPassengerPoseFeed {
        bool TryRead(List<PassengerPose> poses);
    }

    /// <summary>Convenience feed over a delegate (tests and the C adapter).</summary>
    public sealed class DelegatePassengerPoseFeed : IPassengerPoseFeed {
        readonly Func<List<PassengerPose>, bool> read;
        public DelegatePassengerPoseFeed(Func<List<PassengerPose>, bool> read) {
            this.read = read ?? throw new ArgumentNullException(nameof(read));
        }
        public bool TryRead(List<PassengerPose> poses) => read(poses);
    }

    /// <summary>Process-wide actor feed binding. The lead wires C's crowd here.</summary>
    public static class PassengerPoseFeeds {
        public static IPassengerPoseFeed Source { get; private set; }
        public static void SetSource(IPassengerPoseFeed feed) => Source = feed;
        public static void Clear() => Source = null;
    }

    /// <summary>
    /// Resolves a presented passenger pose's storey band, grade ownership and service
    /// eligibility from the committed station geometry, tracks and entrance footprints.
    /// </summary>
    public sealed class PassengerSupportResolver {
        readonly struct SupportCellKey : IEquatable<SupportCellKey> {
            public readonly int Fx;
            public readonly int Fy;
            public readonly int SupportZ;
            public readonly int RawCellZ;

            public SupportCellKey(int fx, int fy, int supportZ, int rawCellZ) {
                Fx = fx;
                Fy = fy;
                SupportZ = supportZ;
                RawCellZ = rawCellZ;
            }

            public bool Equals(SupportCellKey other) =>
                Fx == other.Fx && Fy == other.Fy && SupportZ == other.SupportZ && RawCellZ == other.RawCellZ;

            public override bool Equals(object obj) => obj is SupportCellKey other && Equals(other);

            public override int GetHashCode() {
                unchecked {
                    int h = Fx * 397 ^ Fy;
                    h = h * 397 ^ SupportZ;
                    h = h * 397 ^ RawCellZ;
                    return h;
                }
            }
        }

        readonly StationDocument document;
        readonly StationIndex index;
        readonly Dictionary<string, StationModuleRecord> tracksById;
        readonly HashSet<(int x, int y)> exitGroundCells;
        readonly HashSet<(int x, int y)> nonGradeGroundCells;
        readonly HashSet<(int x, int y)> fallbackCellNonGradeGroundCells;
        readonly HashSet<(int x, int y, int z)> explicitGradeCells;
        readonly List<(int x0, int y0, int x1, int y1, int zLo, int zHi)> rampVolumes;
        readonly HashSet<int> trackZs;
        readonly Dictionary<SupportCellKey, (int band, bool gradeOwned)> staticSupportCache =
            new Dictionary<SupportCellKey, (int band, bool gradeOwned)>();
        readonly Dictionary<string, (string trainKey, string trackId)> lineServerCache =
            new Dictionary<string, (string trainKey, string trackId)>(StringComparer.Ordinal);
        int cachedGridLevelBase = int.MinValue;
        int cachedGridStoreyHeight = int.MinValue;

        PassengerSupportResolver(
            StationDocument doc,
            StationIndex stationIndex,
            PassengerSupportResolver reuseModulesFrom) {
            document = doc;
            index = stationIndex;
            tracksById = reuseModulesFrom.tracksById;
            trackZs = reuseModulesFrom.trackZs;
            exitGroundCells = reuseModulesFrom.exitGroundCells;
            nonGradeGroundCells = reuseModulesFrom.nonGradeGroundCells;
            explicitGradeCells = reuseModulesFrom.explicitGradeCells;
            rampVolumes = reuseModulesFrom.rampVolumes;
            fallbackCellNonGradeGroundCells = stationIndex == null ? BuildFallbackCellSet(doc, explicitGradeCells, exitGroundCells) : null;
        }

        public PassengerSupportResolver WithDocument(StationDocument nextDocument, StationIndex nextIndex) {
            if (nextDocument == null) return new PassengerSupportResolver(null, nextIndex);
            if (document != null && ReferenceEquals(document.ModulePages, nextDocument.ModulePages)) {
                if (ReferenceEquals(index, nextIndex) && (nextIndex != null || ReferenceEquals(document.CellPages, nextDocument.CellPages))) {
                    return this;
                }
                return new PassengerSupportResolver(nextDocument, nextIndex, this);
            }
            return new PassengerSupportResolver(nextDocument, nextIndex);
        }

        public PassengerSupportResolver(StationDocument document, StationIndex stationIndex) {
            this.document = document;
            index = stationIndex;
            tracksById = new Dictionary<string, StationModuleRecord>(StringComparer.Ordinal);
            trackZs = new HashSet<int>();
            exitGroundCells = new HashSet<(int x, int y)>();
            nonGradeGroundCells = new HashSet<(int x, int y)>();
            explicitGradeCells = new HashSet<(int x, int y, int z)>();
            rampVolumes = new List<(int x0, int y0, int x1, int y1, int zLo, int zHi)>();
            if (document == null) return;
            for (int i = 0; i < document.Modules.Count; i++) {
                var module = document.Modules[i];
                if (module == null) continue;
                switch (module.Type) {
                    case "track":
                        if (!string.IsNullOrEmpty(module.Id)) tracksById[module.Id] = module;
                        trackZs.Add(module.Z);
                        if (module.Z == StationViewFeature.GroundZ) {
                            foreach (var cell in StationFootprints.TrackCells(module)) {
                                nonGradeGroundCells.Add(((int)Math.Floor(cell.X), (int)Math.Floor(cell.Y)));
                            }
                        }
                        break;
                    case "exit":
                        if (module.Z == StationViewFeature.GroundZ) {
                            foreach (var cell in StationFootprints.ExitFootprint(module)) {
                                int cx = (int)Math.Floor(cell.X);
                                int cy = (int)Math.Floor(cell.Y);
                                exitGroundCells.Add((cx, cy));
                                nonGradeGroundCells.Add((cx, cy));
                            }
                        }
                        break;
                    case "stair":
                    case "escalator":
                    case "walkway":
                    case "lift": {
                        int z0 = module.From.HasValue ? (int)Math.Round(module.From.Value.Z) : module.Z;
                        int z1 = module.To.HasValue ? (int)Math.Round(module.To.Value.Z) : module.Z;
                        int zLo = Mathf.Min(z0, z1);
                        int zHi = Mathf.Max(z0, z1);
                        int x0 = module.X, x1 = module.X + Mathf.Max(1, module.Width) - 1;
                        int y0 = module.Y, y1 = module.Y + Mathf.Max(1, module.Depth) - 1;
                        if (module.From.HasValue) {
                            int fx0 = (int)Math.Floor(module.From.Value.X);
                            int fy0 = (int)Math.Floor(module.From.Value.Y);
                            x0 = Mathf.Min(x0, fx0); x1 = Mathf.Max(x1, fx0);
                            y0 = Mathf.Min(y0, fy0); y1 = Mathf.Max(y1, fy0);
                        }
                        if (module.To.HasValue) {
                            int tx0 = (int)Math.Floor(module.To.Value.X);
                            int ty0 = (int)Math.Floor(module.To.Value.Y);
                            x0 = Mathf.Min(x0, tx0); x1 = Mathf.Max(x1, tx0);
                            y0 = Mathf.Min(y0, ty0); y1 = Mathf.Max(y1, ty0);
                        }
                        rampVolumes.Add((x0 - 1, y0 - 1, x1 + 1, y1 + 1, zLo, zHi));
                        if (z0 == StationViewFeature.GroundZ || z1 == StationViewFeature.GroundZ || module.Z == StationViewFeature.GroundZ) {
                            for (int x = x0; x <= x1; x++) {
                                for (int y = y0; y <= y1; y++) nonGradeGroundCells.Add((x, y));
                            }
                        }
                        break;
                    }
                    case "sidewalk":
                    case "lawn":
                    case "road": {
                        int w = Mathf.Max(1, module.Width);
                        int d = Mathf.Max(1, module.Depth);
                        for (int dx = 0; dx < w; dx++) {
                            for (int dy = 0; dy < d; dy++) {
                                explicitGradeCells.Add((module.X + dx, module.Y + dy, module.Z));
                            }
                        }
                        break;
                    }
                }
            }

            if (stationIndex == null) {
                fallbackCellNonGradeGroundCells = BuildFallbackCellSet(document, explicitGradeCells, exitGroundCells);
            }
        }

        static HashSet<(int x, int y)> BuildFallbackCellSet(
            StationDocument doc,
            HashSet<(int x, int y, int z)> explicitGradeCells,
            HashSet<(int x, int y)> exitGroundCells) {
            var set = new HashSet<(int x, int y)>();
            if (doc == null) return set;
            for (int i = 0; i < doc.Cells.Count; i++) {
                var cell = doc.Cells[i];
                if (cell == null || !cell.IsSolid || cell.Z != StationViewFeature.GroundZ) continue;
                if (cell.HasTag("painted-ground")) continue;
                if (explicitGradeCells.Contains((cell.X, cell.Y, StationViewFeature.GroundZ)) &&
                    !exitGroundCells.Contains((cell.X, cell.Y))) {
                    continue;
                }
                set.Add((cell.X, cell.Y));
            }
            return set;
        }

        bool IsNonGradeGroundAt(int fx, int fy) {
            if (nonGradeGroundCells.Contains((fx, fy))) return true;
            if (index != null) {
                if (!index.TryGetCell(new StationCellKey(fx, fy, StationViewFeature.GroundZ), out var cell) ||
                    cell == null || !cell.IsSolid || cell.HasTag("painted-ground")) {
                    return false;
                }
                if (explicitGradeCells.Contains((fx, fy, StationViewFeature.GroundZ)) &&
                    !exitGroundCells.Contains((fx, fy))) {
                    return false;
                }
                return true;
            }
            return fallbackCellNonGradeGroundCells != null && fallbackCellNonGradeGroundCells.Contains((fx, fy));
        }

        public bool Resolve(in PassengerPose pose, StationLevelGrid grid, TrainConsistRenderer trainRenderer,
            out int band, out bool gradeOwned) =>
            Resolve(in pose, grid, trainRenderer, out band, out _, out gradeOwned);

        public bool Resolve(in PassengerPose pose, StationLevelGrid grid, TrainConsistRenderer trainRenderer,
            out int band, out int secondBand, out bool gradeOwned) {
            band = 0;
            secondBand = 0;
            gradeOwned = false;
            if (!pose.Visible) return false;

            var serverId = pose.ServerId;
            if (!string.IsNullOrEmpty(serverId) && serverId[0] == 'l') {
                if (serverId.StartsWith("line:", StringComparison.Ordinal)) {
                    if (!lineServerCache.TryGetValue(serverId, out var parsed)) {
                        string tk = serverId.Substring(5);
                        int pipe = tk.IndexOf('|');
                        string trk = pipe >= 0 && pipe + 1 < tk.Length ? tk.Substring(pipe + 1) : null;
                        parsed = (tk, trk);
                        lineServerCache[serverId] = parsed;
                    }
                    string trainKey = parsed.trainKey;
                    if (trainRenderer != null && trainRenderer.TryGetConsist(trainKey, out var consist) && consist != null) {
                        if (!consist.Visible) return false;
                        if (pose.State == StationPassengerState.Boarding &&
                            (consist.Phase == TrainPhase.Approach || consist.Phase == TrainPhase.Depart)) {
                            return false;
                        }
                        if (consist.Berth != null && consist.Berth.Track != null) {
                            var trackBands = StationModuleLevels.Of(consist.Berth.Track, grid);
                            band = trackBands.Length > 0 ? trackBands[0] : StationModuleLevels.Band(grid, consist.Berth.Track.Z);
                        } else if (consist.LevelBands != null && consist.LevelBands.Length > 0) {
                            band = consist.LevelBands[0];
                        } else {
                            band = StationModuleLevels.Band(grid, Math.Floor(pose.Z - 1.0 + 1e-3));
                        }
                        secondBand = band;
                        gradeOwned = false;
                        return true;
                    }
                    string trackId = parsed.trackId;
                    if (trackId != null && tracksById.TryGetValue(trackId, out var track) && track != null) {
                        var trackBands = StationModuleLevels.Of(track, grid);
                        band = trackBands.Length > 0 ? trackBands[0] : StationModuleLevels.Band(grid, track.Z);
                        secondBand = band;
                        gradeOwned = false;
                        return true;
                    }
                } else if (serverId.StartsWith("lift:", StringComparison.Ordinal)) {
                    band = StationModuleLevels.Band(grid, Math.Floor(pose.Z + 1e-3));
                    secondBand = band;
                    gradeOwned = false;
                    return true;
                }
            }

            // A passenger riding an escalator, stair or walkway spans the same storey bands as
            // the ramp module itself (StationModuleLevels.Of), so riders remain visible for the
            // full length of a visible ramp instead of popping in mid-ride.
            if (pose.State == StationPassengerState.Riding && pose.RidePath != null) {
                int b0 = StationModuleLevels.Band(grid, Math.Floor(pose.RidePath.StartZ - 1.0 + 1e-3));
                int b1 = StationModuleLevels.Band(grid, Math.Floor(pose.RidePath.EndZ - 1.0 + 1e-3));
                band = b0 <= b1 ? b0 : b1;
                secondBand = b0 <= b1 ? b1 : b0;
                gradeOwned = false;
                return true;
            }

            int fx = (int)Math.Floor(pose.X);
            int fy = (int)Math.Floor(pose.Y);
            int supportZ = (int)Math.Floor(pose.Z - 1.0 + 1e-3);
            int rawCellZ = (int)Math.Floor(pose.Z + 1e-3);
            ResolveStatic(fx, fy, supportZ, rawCellZ, in grid, out band, out gradeOwned);
            secondBand = band;
            return true;
        }

        internal void ResolveStatic(int fx, int fy, int supportZ, int rawCellZ, in StationLevelGrid grid,
            out int band, out bool gradeOwned) {
            if (cachedGridLevelBase != grid.LevelBase || cachedGridStoreyHeight != grid.StoreyHeight) {
                staticSupportCache.Clear();
                cachedGridLevelBase = grid.LevelBase;
                cachedGridStoreyHeight = grid.StoreyHeight;
            }
            var cacheKey = new SupportCellKey(fx, fy, supportZ, rawCellZ);
            if (staticSupportCache.TryGetValue(cacheKey, out var cached)) {
                band = cached.band;
                gradeOwned = cached.gradeOwned;
                return;
            }
            if (!HasSupportAt(fx, fy, supportZ)) {
                if (HasSupportAt(fx, fy, rawCellZ)) supportZ = rawCellZ;
            }

            band = StationModuleLevels.Band(grid, supportZ);
            if (supportZ == StationViewFeature.GroundZ) {
                gradeOwned = !IsNonGradeGroundAt(fx, fy);
            } else {
                gradeOwned = explicitGradeCells.Contains((fx, fy, supportZ));
            }
            staticSupportCache[cacheKey] = (band, gradeOwned);
        }

        bool HasSupportAt(int x, int y, int z) {
            if (z == StationViewFeature.GroundZ) return true;
            if (index != null && index.TryGetCell(new StationCellKey(x, y, z), out var cell) && cell != null && cell.IsSolid) {
                return true;
            }
            if (explicitGradeCells.Contains((x, y, z))) return true;
            if (trackZs.Contains(z)) return true;
            for (int i = 0; i < rampVolumes.Count; i++) {
                var r = rampVolumes[i];
                if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 && z >= r.zLo && z <= r.zHi) return true;
            }
            return false;
        }
    }

    /// <summary>
    /// One instantiated soft-human passenger. Public so an EditMode/PlayMode test can
    /// assert the actual prefab, clip and transform the renderer selected instead of
    /// trusting a counter.
    /// </summary>
    public sealed class PassengerCrowdActor {
        public int SimId;
        public string Recipe = "";
        public GameObject Root;
        /// <summary>The imported scene root that carries the legacy <see cref="Animation"/>.</summary>
        public GameObject Rig;
        public Animation LegacyAnimation;
        public SkinnedMeshRenderer Skin;
        public StationVisibilityTarget Target;
        public PassengerCatalogueEntry Entry;
        public PassengerLook Look;
        public readonly Dictionary<string, AnimationClip> Clips =
            new Dictionary<string, AnimationClip>(StringComparer.Ordinal);
        public string ClipName = "";
        public float ClipTime;
        public bool Sampled;
        public bool Visible;
        /// <summary>True once the host has been told about this actor (first pose).</summary>
        public bool Registered;
        /// <summary>True when the actor was outside the active camera frustum on the last rendered frame.</summary>
        public bool FrustumCulled { get; internal set; }

        internal readonly int[] BandSlot = new int[1];
        internal readonly int[] BandPair = new int[2];
        internal int LastBand = int.MinValue;
        internal int LastSecondBand = int.MinValue;
        internal bool LastGradeOwned;
        internal bool TargetBound;
        internal bool ActiveInFrame;
        internal bool InInactivePool;
        internal bool HadToneBlock;
        internal bool ScaleApplied;
        internal bool AnimationDirty = true;
        internal Vector3 LastPosition = new Vector3(float.NaN, float.NaN, float.NaN);
        internal double LastHeading = double.NaN;
        internal StationDrawMode LastToneMode = (StationDrawMode)(-1);
        internal bool LastToneSectionShader;
        internal Material[] OriginalMaterials = Array.Empty<Material>();
        internal Material[] FullMaterials = Array.Empty<Material>();
        internal Mesh FullMesh;
        internal Mesh AppliedMesh;
        internal bool HasLodMeshes;
        internal PassengerMeshTier CachedReducedMesh;
        internal PassengerMeshTier CachedSimplifiedMesh;
        internal int MeshTier = -1;
        internal bool LastOtherLevelLod;
        internal PassengerDetail LastPoseDetail;
        internal bool HasCachedLook;
        internal PassengerDetail CachedLookDetail;
        internal bool HasLodCache;
        internal Vector3 LastLodCamPos;
        internal Vector3 LastLodActorPos;
        internal float LastLodViewScale;
        internal PassengerDetail LastLodDetail;
        internal bool LastLodFollowed;
        internal int LastLodProfile;
        internal Transform RootTransform;
        internal bool RootActive;
        internal bool ForceRenderingOff;
        internal bool HasPendingTransform;
        internal Vector3 PendingPosition = new Vector3(float.NaN, float.NaN, float.NaN);
        internal double PendingHeading = double.NaN;
        internal float ShadowScaleX = 0.72f;
        internal float ShadowScaleZ = 0.72f;
        internal string LastClipName;
        internal AnimationClip LastClip;
        internal float LastClipLength;
        internal PassengerSupportResolver CachedSupportResolver;
        internal int CachedSupportGridBase = int.MinValue;
        internal int CachedSupportGridHeight = int.MinValue;
        internal int CachedSupportFx;
        internal int CachedSupportFy;
        internal int CachedSupportZ;
        internal int CachedSupportRawZ;
        internal int CachedSupportBand;
        internal bool CachedSupportGradeOwned;

        public Vector3 Position => RootTransform != null ? RootTransform.position : (Root != null ? Root.transform.position : Vector3.zero);
        public Quaternion Rotation => RootTransform != null ? RootTransform.rotation : (Root != null ? Root.transform.rotation : Quaternion.identity);
        public Vector3 Scale => RootTransform != null ? RootTransform.localScale : (Root != null ? Root.transform.localScale : Vector3.one);
    }

    /// <summary>
    /// Renders the real recipe-selected soft-human prefabs. Every actor is a
    /// <c>Generated/Passengers</c> prefab instantiated at the document position,
    /// scaled by (width, height, depth) about its feet pivot and posed by sampling a
    /// clip from its own imported rig at the source's stride/phase.
    ///
    /// Deliberately **not** an instanced stand-in: a missing catalogue, recipe, rig
    /// or clip hides that actor and reports a named diagnostic. Child is a runtime
        /// scale of the same recipe. Local catalogue entries can provide compact
        /// skinned tiers using the same ordered joints and bind poses.
    /// </summary>
    public sealed class PassengerCrowdView : MonoBehaviour {
        public sealed class Diagnostic {
            public string Code = "";
            public int SimId;
            public string Detail = "";
            public override string ToString() => Code + " #" + SimId + ": " + Detail;
        }

        static readonly int GltfBaseProp = Shader.PropertyToID("baseColorFactor");
        static readonly int BaseColorProp = Shader.PropertyToID("_BaseColor");
        static readonly int ColorProp = Shader.PropertyToID("_Color");
        const string IdleClipName = "Idle";
        static readonly string[,] ActivityClipNames = BuildActivityClipNames();

        const float FrustumBoundsCenterY = 0.9f;
        const float FrustumBoundsExtentXZ = 1.1f;
        const float FrustumBoundsExtentY = 1.3f;

        static string[,] BuildActivityClipNames() {
            var names = new string[PassengerAppearance.ActivityNames.Length, 3];
            for (int a = 0; a < PassengerAppearance.ActivityNames.Length; a++) {
                var act = (PassengerActivity)a;
                if (act == PassengerActivity.Walk) continue;
                for (int h = 0; h < 3; h++) {
                    names[a, h] = PassengerAppearance.ClipName(act, 0, h);
                }
            }
            return names;
        }

        static string CachedActivityClipName(PassengerActivity activity, int walkProfile, int handMode) {
            int a = (int)activity;
            if (a > 0 && a < ActivityClipNames.GetLength(0) && (uint)handMode < 3u) {
                var cached = ActivityClipNames[a, handMode];
                if (cached != null) return cached;
            }
            return PassengerAppearance.ClipName(activity, walkProfile, handMode);
        }

        static Matrix4x4 ContactShadowMatrix(in Vector3 pos, float sx, float sz) {
            var m = default(Matrix4x4);
            m.m00 = sx;
            m.m11 = 1f;
            m.m22 = sz;
            m.m33 = 1f;
            m.m03 = pos.x;
            m.m13 = pos.y + StationContactShadowAssets.PassengerLiftY;
            m.m23 = pos.z;
            return m;
        }

        readonly struct LodCameraParams {
            public readonly bool HasCamera;
            public readonly Vector3 Position;
            public readonly bool Orthographic;
            public readonly float OrthoHeight;
            public readonly float NearClip;
            public readonly float TwoTanHalfFov;
            public readonly int Profile;

            public LodCameraParams(Camera camera) {
                int baseProfile = (StationGraphicsSettings.MinimumModelLod << 12) ^
                    (StationGraphicsSettings.OtherLevelModelLod << 8) ^
                    Mathf.RoundToInt(StationGraphicsSettings.ModelLodBias * 100f);
                if (camera == null) {
                    Profile = baseProfile;
                    HasCamera = false;
                    Position = Vector3.zero;
                    Orthographic = false;
                    OrthoHeight = 0f;
                    NearClip = 0.01f;
                    TwoTanHalfFov = 1f;
                    return;
                }
                HasCamera = true;
                Position = camera.transform.position;
                Orthographic = camera.orthographic;
                Profile = baseProfile ^ (1 << 20) ^ (Orthographic ? (1 << 21) : 0);
                OrthoHeight = 2f * camera.orthographicSize;
                NearClip = camera.nearClipPlane;
                TwoTanHalfFov = 2f * Mathf.Tan(camera.fieldOfView * Mathf.Deg2Rad * 0.5f);
            }

            public float ViewScale => Orthographic ? OrthoHeight : TwoTanHalfFov;
        }

        readonly Dictionary<int, PassengerCrowdActor> actors = new Dictionary<int, PassengerCrowdActor>();
        readonly Dictionary<string, List<PassengerCrowdActor>> inactiveByRecipe =
            new Dictionary<string, List<PassengerCrowdActor>>(StringComparer.Ordinal);
        readonly HashSet<int> seen = new HashSet<int>();
        readonly List<int> goneScratch = new List<int>();
        readonly List<Diagnostic> diagnostics = new List<Diagnostic>();
        readonly HashSet<string> reported = new HashSet<string>(StringComparer.Ordinal);
        readonly Plane[] frustumPlanes = new Plane[6];
        readonly Vector3[] frustumNormals = new Vector3[6];
        readonly float[] frustumEffectiveDistances = new float[6];
        readonly Dictionary<(Material baseMat, int toneBucket, StationDrawMode mode), Material> tonedMaterialCache =
            new Dictionary<(Material, int, StationDrawMode), Material>();
        readonly Dictionary<(Material[] baseArray, int toneBucket, StationDrawMode mode), Material[]> tonedArrayCache =
            new Dictionary<(Material[], int, StationDrawMode), Material[]>();
        const int MaxSteadyAnimationSamplesPerFrame = 96;
        static int globalSamplesFrame = -1;
        static int globalSteadySamplesBudgetLeft;
        readonly List<Matrix4x4> contactShadowMatrices = new List<Matrix4x4>();
        Matrix4x4[] contactShadowSlice;
        Material contactShadowMaterial;
        MaterialPropertyBlock toneBlock;
        bool posing;

        /// <summary>Active crowd contact-shadow blobs queued for this frame's instanced draw.</summary>
        public int ContactShadowCount => contactShadowMatrices.Count;
        /// <summary>
        /// Optional camera override for deterministic frustum culling and LOD tests in EditMode.
        /// Null in production (uses the active view/exploded camera while playing).
        /// </summary>
        public Camera FrustumCameraOverride { get; set; }
        PassengerCatalogue catalogue;
        StationWorldView world;
        PassengerSupportResolver supportResolver;
        Action<PassengerCrowdActor, PassengerPose> spawned;
        Action<Diagnostic> reportedTo;

        public int Spawned => actors.Count;
        public int VisibleActors { get; private set; }
        public int PosedThisFrame { get; private set; }
        public int SampledThisFrame { get; private set; }
        public int SkippedHiddenAnimationThisFrame { get; private set; }
        public int SkippedUnchangedAnimationThisFrame { get; private set; }
        public int FrustumCulledThisFrame { get; private set; }
        public double LastSimTime { get; private set; }
        public IReadOnlyList<Diagnostic> Diagnostics => diagnostics;
        public PassengerCatalogue Catalogue => catalogue;
        /// <summary>True when the bound catalogue carries at least one simplified Low mesh.</summary>
        public bool SupportsLowDetail {
            get {
                var entries = catalogue?.entries;
                if (entries == null) return false;
                for (int i = 0; i < entries.Length; i++) {
                    if (entries[i]?.simplifiedMesh?.mesh != null) return true;
                }
                return false;
            }
        }

        public static PassengerCrowdView Build(Transform parent, PassengerCatalogue catalogue,
            Action<PassengerCrowdActor, PassengerPose> spawned = null, Action<Diagnostic> diagnostic = null) {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            if (catalogue == null) throw new ArgumentNullException(nameof(catalogue));
            var view = parent.gameObject.AddComponent<PassengerCrowdView>();
            view.catalogue = catalogue;
            view.spawned = spawned;
            view.reportedTo = diagnostic;
            return view;
        }

        public void BindWorld(StationWorldView stationWorld, PassengerSupportResolver resolver = null) {
            if (!ReferenceEquals(world, stationWorld)) {
                if (world != null) world.VisibilityApplied -= RefreshVisibleCount;
                world = stationWorld;
                if (world != null) world.VisibilityApplied += RefreshVisibleCount;
            }
            supportResolver = resolver ?? (stationWorld != null && stationWorld.Document != null
                ? new PassengerSupportResolver(stationWorld.Document, stationWorld.Index)
                : null);
        }

        public void SetSupportResolver(PassengerSupportResolver resolver) {
            supportResolver = resolver;
        }

        public bool TryGetActor(int simId, out PassengerCrowdActor actor) => actors.TryGetValue(simId, out actor);

        public bool TryPick(Ray ray, float blocker, out int id, StationPickContext context = default) {
            id = 0;
            blocker = Mathf.Min(blocker, context.MaxDistance);
            foreach (var pair in actors) {
                var actor = pair.Value;
                if (!actor.Visible || !actor.ActiveInFrame || actor.FrustumCulled || actor.Skin == null || !actor.Skin.enabled) continue;
                if ((context.CullingMask & (1 << actor.Skin.gameObject.layer)) == 0 ||
                    !actor.Skin.bounds.IntersectRay(ray, out float distance) ||
                    distance < context.MinDistance || distance >= blocker) continue;
                var point = StationCoordinates.WorldToDocument(ray.GetPoint(distance));
                if (world?.Visibility != null && !world.Visibility.IsPointKept(point)) continue;
                id = pair.Key;
                blocker = distance;
            }
            return id != 0;
        }

        /// <summary>All instantiated actors, for diagnostics and tests.</summary>
        public IEnumerable<PassengerCrowdActor> Actors => actors.Values;

        void PrepareFrustumPlanes(Camera camera) {
            GeometryUtility.CalculateFrustumPlanes(camera, frustumPlanes);
            for (int i = 0; i < 6; i++) {
                var n = frustumPlanes[i].normal;
                frustumNormals[i] = n;
                frustumEffectiveDistances[i] =
                    n.y * FrustumBoundsCenterY +
                    Mathf.Abs(n.x) * FrustumBoundsExtentXZ +
                    Mathf.Abs(n.y) * FrustumBoundsExtentY +
                    Mathf.Abs(n.z) * FrustumBoundsExtentXZ +
                    frustumPlanes[i].distance;
            }
        }

        bool IsPassengerInFrustum(in Vector3 worldPos) {
            for (int i = 0; i < 6; i++) {
                var n = frustumNormals[i];
                if (n.x * worldPos.x + n.y * worldPos.y + n.z * worldPos.z + frustumEffectiveDistances[i] < 0f) {
                    return false;
                }
            }
            return true;
        }

        /// <summary>
        /// Pose the complete actor set for one simulation frame. No wall clock is
        /// read: the same poses always produce the same clips and the same times.
        /// </summary>
        public void Render(IReadOnlyList<PassengerPose> poses, double simTimeSeconds = 0, bool checkGone = true) {
            LastSimTime = simTimeSeconds;
            if (checkGone) seen.Clear();
            PosedThisFrame = 0;
            SampledThisFrame = 0;
            SkippedHiddenAnimationThisFrame = 0;
            SkippedUnchangedAnimationThisFrame = 0;
            FrustumCulledThisFrame = 0;
            var rig = StationViewFeature.Active;
            var cam = rig != null && rig.viewCamera != null ? rig.viewCamera : Camera.main;
            var overrideCam = FrustumCameraOverride;
            var lodCamera = overrideCam != null
                ? overrideCam
                : (StationExplodedView.IsStandaloneActive
                    ? StationViewFeature.ActiveExploded?.ViewerCamera : cam);
            bool hasCam = Application.isPlaying && cam != null;
            Vector3 camPos = hasCam ? cam.transform.position : Vector3.zero;
            var lodParams = new LodCameraParams(lodCamera);
            bool hasFrustum = (Application.isPlaying || overrideCam != null) && lodCamera != null;
            if (hasFrustum) PrepareFrustumPlanes(lodCamera);
            int frameNow = Time.frameCount;
            if (globalSamplesFrame != frameNow) {
                globalSamplesFrame = frameNow;
                globalSteadySamplesBudgetLeft = Application.isPlaying ? MaxSteadyAnimationSamplesPerFrame : int.MaxValue;
            }
            var vis = world != null ? world.Visibility : null;
            int followId = rig?.Visibility != null ? rig.Visibility.State.FollowPassenger : 0;
            int shadowFollowId = vis != null ? vis.State.FollowPassenger : -1;
            bool everyStorey = vis == null || vis.State.HideUi || vis.State.Cutaway;
            int activeLevel = vis != null ? vis.State.ActiveLevel : 0;
            bool hideGround = vis != null && vis.State.HideGround;
            bool sectionClip = vis != null && vis.SectionClipping;
            var grid = vis != null ? vis.State.Grid : (world != null
                ? StationLevelGrid.FromDocument(world.Document?.LevelBase ?? 0, world.Document?.StoreyHeight ?? 5)
                : default);
            var trainRenderer = TrainConsistRenderer.Current;

            contactShadowMatrices.Clear();
            int visibleCount = 0;
            if (poses != null) {
                posing = true;
                try {
                    for (int i = 0; i < poses.Count; i++) {
                        var pose = poses[i];
                        if (!pose.Visible) { Hide(pose.SimId); continue; }
                        var actor = GetOrSpawn(pose);
                        if (actor == null) continue;
                        Pose(actor, in pose, hasCam, camPos, hasFrustum, followId, in lodParams, checkGone, in grid, sectionClip, trainRenderer);
                        if (actor.Visible && actor.ActiveInFrame) {
                            if (actor.FrustumCulled) {
                                if (world == null || actor.Target == null || actor.Target.LastMode != StationDrawMode.Hidden) {
                                    visibleCount++;
                                }
                            } else if (world == null || actor.Target == null || (actor.Target.LastMode != StationDrawMode.Hidden && actor.Skin != null && actor.Skin.enabled)) {
                                visibleCount++;
                                if (actor.SimId != shadowFollowId &&
                                    !(hideGround && actor.LastGradeOwned) &&
                                    (vis == null || StationVisibilityRules.ContactShadowVisible(actor.LastBand, activeLevel, everyStorey, grid))) {
                                    var pos = actor.LastPosition;
                                    if (!float.IsNaN(pos.x) && (!sectionClip || vis.IsPointKept(StationCoordinates.WorldToDocument(pos)))) {
                                        contactShadowMatrices.Add(ContactShadowMatrix(in pos, actor.ShadowScaleX, actor.ShadowScaleZ));
                                    }
                                }
                            }
                        }
                    }
                } finally {
                    posing = false;
                }
            }
            if (checkGone) {
                // The feed publishes a complete frame: an actor that left the frame is
                // removed from view this frame (replay must not leave stale bodies).
                goneScratch.Clear();
                foreach (var pair in actors) {
                    if (!seen.Contains(pair.Key)) goneScratch.Add(pair.Key);
                }
                for (int i = 0; i < goneScratch.Count; i++) Hide(goneScratch[i]);
            }
            VisibleActors = visibleCount;
        }

        void LateUpdate() {
            DrawContactShadows();
        }

        void RebuildContactShadows() {
            contactShadowMatrices.Clear();
            var vis = world != null ? world.Visibility : null;
            int followId = vis != null ? vis.State.FollowPassenger : -1;
            bool everyStorey = vis == null || vis.State.HideUi || vis.State.Cutaway;
            int activeLevel = vis != null ? vis.State.ActiveLevel : 0;
            bool hideGround = vis != null && vis.State.HideGround;
            bool sectionClip = vis != null && vis.SectionClipping;
            var grid = vis != null ? vis.State.Grid : default;

            foreach (var actor in actors.Values) {
                if (actor == null || !actor.Visible || !actor.ActiveInFrame || actor.FrustumCulled || actor.Root == null || !actor.Root.activeSelf) continue;
                if (actor.SimId == followId) continue;
                if (hideGround && actor.LastGradeOwned) continue;
                if (vis != null && !StationVisibilityRules.ContactShadowVisible(actor.LastBand, activeLevel, everyStorey, grid)) continue;
                var pos = actor.LastPosition;
                if (float.IsNaN(pos.x)) pos = actor.Position;
                if (sectionClip && !vis.IsPointKept(StationCoordinates.WorldToDocument(pos))) continue;
                contactShadowMatrices.Add(ContactShadowMatrix(in pos, actor.ShadowScaleX, actor.ShadowScaleZ));
            }
        }

        void DrawContactShadows() {
            int total = contactShadowMatrices.Count;
            if (total == 0 || !gameObject.activeInHierarchy) return;
            if (contactShadowMaterial == null) {
                contactShadowMaterial = StationContactShadowAssets.CreateMaterial(
                    StationContactShadowAssets.PassengerTexture(), "passenger contact shadows");
                if (contactShadowMaterial == null) return;
            }
            var vis = world != null ? world.Visibility : null;
            if (vis != null && contactShadowMaterial.HasProperty("_SectionPlane")) {
                var normal = StationCoordinates.Direction(vis.Section.Normal);
                var point = StationCoordinates.Point(vis.Section.Point);
                contactShadowMaterial.SetVector("_SectionPlane",
                    new Vector4(normal.x, normal.y, normal.z, -Vector3.Dot(normal, point)));
                contactShadowMaterial.SetFloat("_SectionClip", vis.SectionClipping ? 1f : 0f);
            }
            var mesh = StationContactShadowAssets.QuadMesh();
            const int maxPerDraw = 1023;
            if (contactShadowSlice == null || contactShadowSlice.Length != maxPerDraw) {
                contactShadowSlice = new Matrix4x4[maxPerDraw];
            }
            for (int offset = 0; offset < total; offset += maxPerDraw) {
                int count = Mathf.Min(maxPerDraw, total - offset);
                contactShadowMatrices.CopyTo(offset, contactShadowSlice, 0, count);
                Graphics.DrawMeshInstanced(mesh, 0, contactShadowMaterial, contactShadowSlice, count,
                    null, UnityEngine.Rendering.ShadowCastingMode.Off, false);
            }
        }

        static void UpdateShadowScales(PassengerCrowdActor actor) {
            actor.ShadowScaleX = Mathf.Max(.2f, (float)actor.Look.Width * .72f);
            actor.ShadowScaleZ = Mathf.Max(.2f, (float)actor.Look.Depth * .72f);
        }

        static void CacheEntryLodTiers(PassengerCrowdActor actor, PassengerCatalogueEntry entry) {
            var reduced = entry?.reducedMesh?.mesh != null ? entry.reducedMesh : null;
            var simplified = entry?.simplifiedMesh?.mesh != null ? entry.simplifiedMesh : null;
            actor.CachedReducedMesh = reduced;
            actor.CachedSimplifiedMesh = simplified;
            actor.HasLodMeshes = reduced != null || simplified != null;
        }

        PassengerCrowdActor GetOrSpawn(PassengerPose pose) {
            if (actors.TryGetValue(pose.SimId, out var existing)) {
                RemoveFromInactivePool(existing);
                if (!existing.HasCachedLook || existing.CachedLookDetail != pose.Detail) {
                    var nextLook = PassengerAppearance.Look(catalogue, pose.SimId, pose.Detail);
                    existing.HasCachedLook = true;
                    existing.CachedLookDetail = pose.Detail;
                    if (!SameLook(existing.Look, nextLook)) {
                        existing.Look = nextLook;
                        UpdateShadowScales(existing);
                        existing.ScaleApplied = false;
                        existing.LastToneMode = (StationDrawMode)(-1);
                        existing.LastToneSectionShader = false;
                        existing.HasLodCache = false;
                    }
                }
                if (pose.Detail == PassengerDetail.Low && existing.Entry?.simplifiedMesh?.mesh == null)
                    Diagnose("low-topology-unported", pose.SimId, "Low mesh is not rendered; Full topology is shown");
                return existing;
            }
            if (!catalogue.TryGetForSimId(pose.SimId, out var entry)) {
                Diagnose("passenger-recipe-missing", pose.SimId,
                    "no eligible recipe for this stable identity; the stand-in is not used");
                return null;
            }
            if (TryTakeInactive(entry.recipe, out var pooled)) {
                actors.Remove(pooled.SimId);
                pooled.SimId = pose.SimId;
                pooled.Entry = entry;
                CacheEntryLodTiers(pooled, entry);
                pooled.Look = PassengerAppearance.Look(catalogue, pose.SimId, pose.Detail);
                UpdateShadowScales(pooled);
                pooled.HasCachedLook = true;
                pooled.CachedLookDetail = pose.Detail;
                pooled.ScaleApplied = false;
                pooled.AnimationDirty = true;
                pooled.FrustumCulled = false;
                pooled.HasPendingTransform = false;
                pooled.PendingPosition = new Vector3(float.NaN, float.NaN, float.NaN);
                pooled.PendingHeading = double.NaN;
                if (pooled.ForceRenderingOff && pooled.Skin != null) {
                    pooled.Skin.forceRenderingOff = false;
                    pooled.ForceRenderingOff = false;
                }
                pooled.LastPosition = new Vector3(float.NaN, float.NaN, float.NaN);
                pooled.LastHeading = double.NaN;
                pooled.Registered = false;
                pooled.LastBand = int.MinValue;
                pooled.LastSecondBand = int.MinValue;
                pooled.LastGradeOwned = false;
                pooled.LastToneMode = (StationDrawMode)(-1);
                pooled.LastToneSectionShader = false;
                pooled.LastOtherLevelLod = false;
                pooled.MeshTier = -1;
                pooled.HasLodCache = false;
                pooled.LastClipName = null;
                pooled.LastClip = null;
                pooled.LastClipLength = 0f;
                pooled.CachedSupportResolver = null;
                ClearToneBlock(pooled);
                if (pooled.Root != null) pooled.Root.name = "passenger " + pose.SimId + " " + entry.recipe;
                actors[pose.SimId] = pooled;
                if (pose.Detail == PassengerDetail.Low && entry.simplifiedMesh?.mesh == null)
                    Diagnose("low-topology-unported", pose.SimId, "Low mesh is not rendered; Full topology is shown");
                return pooled;
            }

            var root = Instantiate(entry.prefab, transform);
            root.name = "passenger " + pose.SimId + " " + entry.recipe;
            var animation = root.GetComponentInChildren<Animation>(true);
            if (animation == null) {
                Diagnose("passenger-rig-missing", pose.SimId, entry.recipe + " has no imported Animation component");
                DestroyNow(root);
                return null;
            }
            var skin = root.GetComponentInChildren<SkinnedMeshRenderer>(true);
            if (skin == null) {
                Diagnose("passenger-mesh-missing", pose.SimId, entry.recipe + " has no imported SkinnedMeshRenderer");
                DestroyNow(root);
                return null;
            }
            // Poses are sampled manually; a legacy Animation that also plays would
            // overwrite the sample on its own update. Fixed generous local bounds allow
            // frustum culling offscreen actors without clipping or bone-skinning behind the camera.
            animation.enabled = false;
            skin.updateWhenOffscreen = false;
            skin.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            skin.localBounds = new Bounds(new Vector3(0f, 0.9f, 0f), new Vector3(1.4f, 2.2f, 1.4f));
            var originals = skin.sharedMaterials != null ? (Material[])skin.sharedMaterials.Clone() : Array.Empty<Material>();

            var target = root.GetComponent<StationVisibilityTarget>() ?? root.AddComponent<StationVisibilityTarget>();
            target.Configure(StationPartRole.Actor, Array.Empty<int>(), isParked: true);
            target.Refresh();
            // Start hidden through the target so authored eligibility stays true while Skin.enabled starts false.
            target.Apply(StationDrawMode.Hidden, null);

            var fullMesh = skin.sharedMesh;
            var actor = new PassengerCrowdActor {
                SimId = pose.SimId, Recipe = entry.recipe, Root = root, RootTransform = root.transform,
                Rig = animation.gameObject, LegacyAnimation = animation, Skin = skin, Target = target, Entry = entry,
                Look = PassengerAppearance.Look(catalogue, pose.SimId, pose.Detail),
                HasCachedLook = true,
                CachedLookDetail = pose.Detail,
                OriginalMaterials = originals,
                FullMaterials = originals,
                FullMesh = fullMesh,
                AppliedMesh = fullMesh,
            };
            UpdateShadowScales(actor);
            CacheEntryLodTiers(actor, entry);
            var names = catalogue.clipSet?.clipNames ?? Array.Empty<string>();
            for (int i = 0; i < names.Length; i++) {
                var clip = animation.GetClip(names[i]);
                if (clip != null) actor.Clips[names[i]] = clip;
            }
            if (actor.Clips.Count == 0) {
                Diagnose("passenger-clip-missing", pose.SimId, entry.recipe + " resolved none of the catalogue's clips");
                DestroyNow(root);
                return null;
            }
            target.ModeApplied += mode => OnActorModeApplied(actor, mode);
            actors[pose.SimId] = actor;
            actor.Root.SetActive(false);
            actor.RootActive = false;
            if (pose.Detail == PassengerDetail.Low && entry.simplifiedMesh?.mesh == null)
                Diagnose("low-topology-unported", pose.SimId, "Low mesh is not rendered; Full topology is shown");
            return actor;
        }

        void SelectActorMesh(PassengerCrowdActor actor, PassengerDetail detail, in LodCameraParams lod, int followId) {
            if (!actor.HasLodMeshes) return;
            bool otherLevel = actor.Target != null && actor.Target.OtherLevelLod;
            bool followed = actor.SimId == followId;
            bool needsDistance = !followed && detail != PassengerDetail.Low && lod.HasCamera && !lod.Orthographic;
            var actorPos = needsDistance
                ? (float.IsNaN(actor.LastPosition.x) ? actor.Position : actor.LastPosition)
                : default;
            float viewScale = lod.ViewScale;
            if (actor.HasLodCache &&
                actor.LastOtherLevelLod == otherLevel &&
                actor.LastLodDetail == detail &&
                actor.LastLodFollowed == followed &&
                actor.LastLodProfile == lod.Profile &&
                Mathf.Abs(actor.LastLodViewScale - viewScale) < 1e-5f &&
                (!needsDistance ||
                    ((actorPos - actor.LastLodActorPos).sqrMagnitude < 1e-4f &&
                     (lod.Position - actor.LastLodCamPos).sqrMagnitude < 1e-4f))) {
                return;
            }
            var reduced = actor.CachedReducedMesh;
            var simplified = actor.CachedSimplifiedMesh;
            int desired = 0;
            if (!followed) {
                if (detail == PassengerDetail.Low) desired = 2;
                else if (lod.HasCamera) {
                    float viewHeight = lod.Orthographic
                        ? lod.OrthoHeight
                        : Mathf.Max(lod.NearClip, Vector3.Distance(actorPos, lod.Position)) * lod.TwoTanHalfFov;
                    int previous = actor.LastOtherLevelLod == otherLevel ? actor.MeshTier : -1;
                    desired = StationGraphicsSettings.SelectTier(
                        (float)actor.Look.Height / Mathf.Max(.01f, viewHeight), previous, 3, otherLevel);
                } else if (otherLevel) {
                    desired = StationGraphicsSettings.OtherLevelTier(3);
                }
            }
            var chosen = desired == 2 ? simplified ?? reduced : desired == 1 ? reduced : null;
            var mesh = chosen?.mesh ?? actor.FullMesh;
            actor.MeshTier = desired;
            actor.LastOtherLevelLod = otherLevel;
            actor.HasLodCache = true;
            actor.LastLodCamPos = lod.Position;
            actor.LastLodActorPos = actorPos;
            actor.LastLodViewScale = viewScale;
            actor.LastLodDetail = detail;
            actor.LastLodFollowed = followed;
            actor.LastLodProfile = lod.Profile;
            if (ReferenceEquals(actor.AppliedMesh, mesh)) return;
            ClearToneBlock(actor);
            actor.LastToneMode = (StationDrawMode)(-1);
            actor.OriginalMaterials = chosen?.materials ?? actor.FullMaterials;
            actor.Skin.sharedMesh = mesh;
            actor.AppliedMesh = mesh;
            actor.Skin.sharedMaterials = actor.OriginalMaterials;
            actor.Target?.Recapture(actor.Skin);
            SyncActorTone(actor, actor.Target != null ? actor.Target.LastMode : StationDrawMode.Base);
        }

        static AnimationClip ResolveClip(PassengerCrowdActor actor, string clipName, out float clipLength) {
            if (ReferenceEquals(clipName, actor.LastClipName)) {
                clipLength = actor.LastClipLength;
                return actor.LastClip;
            }
            if (actor.Clips.TryGetValue(clipName, out var found) && found != null) {
                actor.LastClipName = clipName;
                actor.LastClip = found;
                actor.LastClipLength = found.length;
                clipLength = actor.LastClipLength;
                return found;
            }
            clipLength = 0f;
            return null;
        }

        void Pose(PassengerCrowdActor actor, in PassengerPose pose, bool hasCam, Vector3 camPos, bool hasFrustum, int followId, in LodCameraParams lodParams, bool trackSeen, in StationLevelGrid grid, bool sectionClip, TrainConsistRenderer trainRenderer) {
            if (trackSeen) seen.Add(actor.SimId);
            actor.LastPoseDetail = pose.Detail;

            int band = 0;
            int secondBand = 0;
            bool gradeOwned = false;
            if (world != null) {
                if (supportResolver != null) {
                    var serverId = pose.ServerId;
                    bool isStaticSupport = (string.IsNullOrEmpty(serverId) || serverId[0] != 'l') &&
                        (pose.State != StationPassengerState.Riding || pose.RidePath == null);
                    if (isStaticSupport) {
                        int fx = (int)Math.Floor(pose.X);
                        int fy = (int)Math.Floor(pose.Y);
                        int supportZ = (int)Math.Floor(pose.Z - 1.0 + 1e-3);
                        int rawCellZ = (int)Math.Floor(pose.Z + 1e-3);
                        if (ReferenceEquals(actor.CachedSupportResolver, supportResolver) &&
                            actor.CachedSupportGridBase == grid.LevelBase &&
                            actor.CachedSupportGridHeight == grid.StoreyHeight &&
                            actor.CachedSupportFx == fx &&
                            actor.CachedSupportFy == fy &&
                            actor.CachedSupportZ == supportZ &&
                            actor.CachedSupportRawZ == rawCellZ) {
                            band = actor.CachedSupportBand;
                            secondBand = band;
                            gradeOwned = actor.CachedSupportGradeOwned;
                        } else {
                            supportResolver.ResolveStatic(fx, fy, supportZ, rawCellZ, in grid, out band, out gradeOwned);
                            secondBand = band;
                            actor.CachedSupportResolver = supportResolver;
                            actor.CachedSupportGridBase = grid.LevelBase;
                            actor.CachedSupportGridHeight = grid.StoreyHeight;
                            actor.CachedSupportFx = fx;
                            actor.CachedSupportFy = fy;
                            actor.CachedSupportZ = supportZ;
                            actor.CachedSupportRawZ = rawCellZ;
                            actor.CachedSupportBand = band;
                            actor.CachedSupportGradeOwned = gradeOwned;
                        }
                    } else if (!supportResolver.Resolve(in pose, grid, trainRenderer, out band, out secondBand, out gradeOwned)) {
                        HideActor(actor);
                        return;
                    }
                } else {
                    band = StationModuleLevels.Band(grid, Math.Floor(pose.Z - 1.0 + 1e-3));
                    secondBand = band;
                    gradeOwned = Math.Floor(pose.Z - 1.0 + 1e-3) == StationViewFeature.GroundZ;
                }
            }

            var worldPos = StationCoordinates.Point(new Vector3((float)pose.X, (float)pose.Y, (float)pose.Z));

            // Cutaway section clipping classifies live target WorldBounds inside ApplyRuntimeTarget,
            // so when sectionClip is active ensure transform position/scale are synced before Apply.
            if (sectionClip) {
                if (float.IsNaN(actor.LastPosition.x) || (worldPos - actor.LastPosition).sqrMagnitude > 1e-8f) {
                    actor.RootTransform.position = worldPos;
                    actor.LastPosition = worldPos;
                }
                if (!actor.ScaleApplied) {
                    actor.RootTransform.localScale = PassengerAppearance.LocalScale(actor.Look);
                    actor.ScaleApplied = true;
                }
            }

            if (world != null && actor.Target != null) {
                bool wasActive = actor.ActiveInFrame;
                actor.ActiveInFrame = true;
                bool dirty = !actor.TargetBound || !wasActive || actor.Target.Parked ||
                    actor.LastBand != band || actor.LastSecondBand != secondBand || actor.LastGradeOwned != gradeOwned ||
                    sectionClip;
                if (secondBand != band) {
                    actor.BandPair[0] = band;
                    actor.BandPair[1] = secondBand;
                    actor.Target.levels = actor.BandPair;
                } else {
                    actor.BandSlot[0] = band;
                    actor.Target.levels = actor.BandSlot;
                }
                actor.Target.gradeOwned = gradeOwned;
                actor.Target.parked = false;
                actor.LastBand = band;
                actor.LastSecondBand = secondBand;
                actor.LastGradeOwned = gradeOwned;
                if (!actor.TargetBound) {
                    actor.TargetBound = true;
                    world.BindRuntimeTarget(actor.Target);
                } else if (dirty) {
                    world.ApplyRuntimeTarget(actor.Target);
                } else {
                    actor.Visible = actor.Target.LastMode != StationDrawMode.Hidden;
                }
            } else {
                bool wasActive = actor.ActiveInFrame;
                actor.ActiveInFrame = true;
                if (actor.Target != null) {
                    if (!wasActive || actor.Target.Parked || actor.Target.LastMode != StationDrawMode.Base) {
                        actor.Target.parked = false;
                        actor.Target.Apply(StationDrawMode.Base, null);
                    }
                } else if (actor.Skin != null && !actor.Skin.enabled) {
                    actor.Skin.enabled = true;
                }
                actor.Visible = true;
            }

            if (!actor.Visible) {
                actor.PendingPosition = worldPos;
                actor.PendingHeading = pose.Heading;
                actor.HasPendingTransform = true;
                actor.AnimationDirty = true;
                SkippedHiddenAnimationThisFrame++;
                PosedThisFrame++;
                if (!actor.Registered) {
                    actor.Registered = true;
                    spawned?.Invoke(actor, pose);
                }
                return;
            }

            bool isFollowed = actor.SimId == followId;
            if (hasFrustum && !isFollowed && !IsPassengerInFrustum(in worldPos)) {
                actor.PendingPosition = worldPos;
                actor.PendingHeading = pose.Heading;
                actor.HasPendingTransform = true;
                if (!actor.FrustumCulled) {
                    actor.FrustumCulled = true;
                    if (!actor.ForceRenderingOff && actor.Skin != null) {
                        actor.Skin.forceRenderingOff = true;
                        actor.ForceRenderingOff = true;
                    }
                }
                actor.AnimationDirty = true;
                SkippedHiddenAnimationThisFrame++;
                FrustumCulledThisFrame++;
                PosedThisFrame++;
                if (!actor.Registered) {
                    actor.Registered = true;
                    spawned?.Invoke(actor, pose);
                }
                return;
            }

            if (actor.FrustumCulled) {
                actor.FrustumCulled = false;
            }
            actor.HasPendingTransform = false;
            actor.PendingPosition = worldPos;
            actor.PendingHeading = pose.Heading;

            bool posDirty = float.IsNaN(actor.LastPosition.x) || (worldPos - actor.LastPosition).sqrMagnitude > 1e-8f;
            bool rotDirty = double.IsNaN(actor.LastHeading) || Math.Abs(pose.Heading - actor.LastHeading) > 1e-5;
            if (posDirty && rotDirty) {
                actor.RootTransform.SetPositionAndRotation(worldPos, PassengerAppearance.Rotation(pose.Heading));
                actor.LastPosition = worldPos;
                actor.LastHeading = pose.Heading;
            } else if (posDirty) {
                actor.RootTransform.position = worldPos;
                actor.LastPosition = worldPos;
            } else if (rotDirty) {
                actor.RootTransform.rotation = PassengerAppearance.Rotation(pose.Heading);
                actor.LastHeading = pose.Heading;
            }
            if (!actor.ScaleApplied) {
                actor.RootTransform.localScale = PassengerAppearance.LocalScale(actor.Look);
                actor.ScaleApplied = true;
            }
            if (!actor.RootActive) {
                actor.Root.SetActive(true);
                actor.RootActive = true;
            }
            if (actor.ForceRenderingOff != isFollowed && actor.Skin != null) {
                actor.Skin.forceRenderingOff = isFollowed;
                actor.ForceRenderingOff = isFollowed;
            }

            SelectActorMesh(actor, pose.Detail, in lodParams, followId);
            var currentMode = (world != null && actor.Target != null) ? actor.Target.LastMode : StationDrawMode.Base;
            bool currentSectionShader = actor.Target != null && actor.Target.SectionShaderActive;
            if (actor.LastToneMode != currentMode || actor.LastToneSectionShader != currentSectionShader) {
                SyncActorTone(actor, currentMode);
            }

            double activityTime = pose.ActivitySeconds;
            var activity = pose.Activity;
            if (activity == PassengerActivity.Escalator || activity == PassengerActivity.EscalatorLeft) {
                if (pose.RideSeconds > 0)
                    activityTime = PassengerAppearance.RailTimeline(pose.RideProgress * pose.RideSeconds, pose.RideSeconds, pose.RailVariant);
                activity = PassengerAppearance.DisplayedActivity(activity, actor.Entry, activityTime);
            }
            string clipName;
            float time;
            AnimationClip chosen;
            if (activity == PassengerActivity.Walk) {
                bool stand = pose.WalkWeight <= 0.5 && (pose.HasWalkWeight || pose.WalkWeight > 1e-6);
                if (stand) {
                    clipName = IdleClipName;
                    time = 0f;
                } else {
                    var gait = PassengerAppearance.Gait(in actor.Look, pose.WalkDistance, pose.WalkPhase, pose.WalkWeight);
                    clipName = PassengerAppearance.WalkClipName(actor.Look.WalkProfile);
                    time = (float)gait.SampleTime;
                }
                chosen = ResolveClip(actor, clipName, out _);
            } else {
                int hand = PassengerAppearance.ActionMode(pose.SimId, actor.Entry, activity, pose.PreferredHand);
                clipName = CachedActivityClipName(activity, actor.Look.WalkProfile, hand);
                chosen = ResolveClip(actor, clipName, out float clipLength);
                time = (float)PassengerAppearance.ActivitySampleTime(activity, activityTime, chosen != null ? clipLength : 0f);
            }
            if (chosen == null) {
                Diagnose("passenger-clip-missing", pose.SimId, actor.Recipe + " has no clip " + clipName);
                HideActor(actor);
                return;
            }

            bool sameClip = actor.Sampled && !actor.AnimationDirty &&
                (ReferenceEquals(actor.ClipName, clipName) || string.Equals(actor.ClipName, clipName, StringComparison.Ordinal));
            float minDelta = 1e-4f;
            if (sameClip && hasCam && !isFollowed) {
                float distSq = (worldPos - camPos).sqrMagnitude;
                if (distSq > 65f * 65f) minDelta = 0.125f;
                else if (distSq > 32f * 32f) minDelta = 0.066f;
                else if (Application.isPlaying) minDelta = 0.033f;
            }
            bool mustSample = !sameClip || isFollowed;
            bool deltaExceeded = Mathf.Abs(actor.ClipTime - time) >= minDelta;
            if (mustSample || (deltaExceeded && globalSteadySamplesBudgetLeft > 0)) {
                if (!mustSample) globalSteadySamplesBudgetLeft--;
                chosen.SampleAnimation(actor.Rig, Mathf.Min(time, Mathf.Max(0f, actor.LastClipLength - 0.00001f)));
                actor.ClipName = clipName;
                actor.ClipTime = time;
                actor.Sampled = true;
                actor.AnimationDirty = false;
                SampledThisFrame++;
            } else {
                SkippedUnchangedAnimationThisFrame++;
            }
            PosedThisFrame++;

            if (!actor.Registered) {
                actor.Registered = true;
                spawned?.Invoke(actor, pose);
            }
        }

        void OnActorModeApplied(PassengerCrowdActor actor, StationDrawMode mode) {
            if (actor == null) return;
            actor.Visible = actor.ActiveInFrame && mode != StationDrawMode.Hidden;
            if (posing) {
                bool hasSection = actor.Target != null && actor.Target.SectionShaderActive;
                if (actor.LastToneMode != mode || actor.LastToneSectionShader != hasSection) {
                    actor.LastToneMode = (StationDrawMode)(-1);
                }
                return;
            }
            if (!actor.Visible) {
                actor.AnimationDirty = true;
                return;
            }
            if (actor.FrustumCulled) {
                bool hasSection = actor.Target != null && actor.Target.SectionShaderActive;
                if (actor.LastToneMode != mode || actor.LastToneSectionShader != hasSection) {
                    actor.LastToneMode = (StationDrawMode)(-1);
                }
                actor.HasLodCache = false;
                return;
            }
            if (actor.HasPendingTransform) {
                actor.HasPendingTransform = false;
                var pendingPos = actor.PendingPosition;
                if (!float.IsNaN(pendingPos.x) &&
                    (float.IsNaN(actor.LastPosition.x) || (pendingPos - actor.LastPosition).sqrMagnitude > 1e-8f)) {
                    actor.RootTransform.position = pendingPos;
                    actor.LastPosition = pendingPos;
                }
                if (!double.IsNaN(actor.PendingHeading) &&
                    (double.IsNaN(actor.LastHeading) || Math.Abs(actor.PendingHeading - actor.LastHeading) > 1e-5)) {
                    actor.RootTransform.rotation = PassengerAppearance.Rotation(actor.PendingHeading);
                    actor.LastHeading = actor.PendingHeading;
                }
                if (!actor.ScaleApplied) {
                    actor.RootTransform.localScale = PassengerAppearance.LocalScale(actor.Look);
                    actor.ScaleApplied = true;
                }
                if (!actor.RootActive && actor.Root != null) {
                    actor.Root.SetActive(true);
                    actor.RootActive = true;
                }
            }
            var rig = StationViewFeature.Active;
            var cam = rig != null && rig.viewCamera != null ? rig.viewCamera : Camera.main;
            var lodCamera = FrustumCameraOverride != null
                ? FrustumCameraOverride
                : (StationExplodedView.IsStandaloneActive
                    ? StationViewFeature.ActiveExploded?.ViewerCamera : cam);
            int followId = rig?.Visibility != null ? rig.Visibility.State.FollowPassenger : 0;
            var lodParams = new LodCameraParams(lodCamera);
            SelectActorMesh(actor, actor.LastPoseDetail, in lodParams, followId);
            SyncActorTone(actor, mode);
        }

        public void RefreshVisibleCount() {
            int visible = 0;
            foreach (var actor in actors.Values) {
                if (actor == null || !actor.ActiveInFrame) continue;
                if (world != null && actor.Target != null) {
                    actor.Visible = actor.Target.LastMode != StationDrawMode.Hidden &&
                        actor.Skin != null && actor.Skin.enabled;
                }
                if (actor.Visible) visible++;
            }
            VisibleActors = visible;
            RebuildContactShadows();
        }

        void Hide(int simId) {
            if (actors.TryGetValue(simId, out var actor)) HideActor(actor);
        }

        void HideActor(PassengerCrowdActor actor) {
            if (actor == null) return;
            actor.Visible = false;
            actor.ActiveInFrame = false;
            actor.FrustumCulled = false;
            actor.HasPendingTransform = false;
            actor.PendingPosition = new Vector3(float.NaN, float.NaN, float.NaN);
            actor.PendingHeading = double.NaN;
            actor.AnimationDirty = true;
            if (actor.ForceRenderingOff && actor.Skin != null) {
                actor.Skin.forceRenderingOff = false;
                actor.ForceRenderingOff = false;
            }
            actor.LastBand = int.MinValue;
            actor.LastSecondBand = int.MinValue;
            actor.LastGradeOwned = false;
            actor.LastToneMode = (StationDrawMode)(-1);
            actor.LastToneSectionShader = false;
            actor.HasLodCache = false;
            actor.CachedSupportResolver = null;
            if (actor.TargetBound) {
                actor.TargetBound = false;
                world?.UnbindRuntimeTarget(actor.Target);
            } else if (actor.Target != null) {
                actor.Target.parked = true;
                actor.Target.levels = Array.Empty<int>();
                actor.Target.gradeOwned = false;
                actor.Target.Apply(StationDrawMode.Hidden, null);
            }
            if (actor.Root != null && (actor.RootActive || actor.Root.activeSelf)) {
                actor.Root.SetActive(false);
                actor.RootActive = false;
            }
            AddToInactivePool(actor);
        }

        public void HideAll() {
            foreach (var actor in actors.Values) HideActor(actor);
            contactShadowMatrices.Clear();
            VisibleActors = 0;
            FrustumCulledThisFrame = 0;
        }

        void AddToInactivePool(PassengerCrowdActor actor) {
            if (actor == null || actor.InInactivePool || string.IsNullOrEmpty(actor.Recipe)) return;
            if (!inactiveByRecipe.TryGetValue(actor.Recipe, out var pool)) {
                pool = new List<PassengerCrowdActor>();
                inactiveByRecipe[actor.Recipe] = pool;
            }
            actor.InInactivePool = true;
            pool.Add(actor);
        }

        void RemoveFromInactivePool(PassengerCrowdActor actor) {
            if (actor == null || !actor.InInactivePool) return;
            actor.InInactivePool = false;
            if (inactiveByRecipe.TryGetValue(actor.Recipe, out var pool)) {
                pool.Remove(actor);
            }
        }

        bool TryTakeInactive(string recipe, out PassengerCrowdActor actor) {
            actor = null;
            if (string.IsNullOrEmpty(recipe) || !inactiveByRecipe.TryGetValue(recipe, out var pool)) return false;
            while (pool.Count > 0) {
                int last = pool.Count - 1;
                var candidate = pool[last];
                pool.RemoveAt(last);
                if (candidate == null || candidate.Root == null) continue;
                candidate.InInactivePool = false;
                actor = candidate;
                return true;
            }
            return false;
        }

        static bool SameLook(PassengerLook a, PassengerLook b) =>
            Math.Abs(a.Width - b.Width) < 1e-9 &&
            Math.Abs(a.Height - b.Height) < 1e-9 &&
            Math.Abs(a.Depth - b.Depth) < 1e-9 &&
            Math.Abs(a.Tone - b.Tone) < 1e-9 &&
            a.WalkProfile == b.WalkProfile &&
            a.IsChild == b.IsChild;

        void ClearToneBlock(PassengerCrowdActor actor) {
            if (actor == null || !actor.HadToneBlock || actor.Skin == null) return;
            int count = actor.OriginalMaterials != null ? actor.OriginalMaterials.Length : 0;
            for (int i = 0; i < count; i++) actor.Skin.SetPropertyBlock(null, i);
            actor.HadToneBlock = false;
            actor.LastToneMode = (StationDrawMode)(-1);
            actor.LastToneSectionShader = false;
        }

        Material[] GetSharedTonedMaterials(Material[] originals, int toneBucket, StationDrawMode mode, bool applyTranslucentStyle) {
            var arrKey = (originals, toneBucket, mode);
            if (tonedArrayCache.TryGetValue(arrKey, out var cachedArr)) return cachedArr;
            float tone = toneBucket / 20f;
            bool translucent = applyTranslucentStyle && (mode == StationDrawMode.Ghost || mode == StationDrawMode.Clear);
            float opacity = mode == StationDrawMode.Clear
                ? StationVisibilityPalette.ClearOpacity
                : StationVisibilityPalette.GhostOpacity;
            var result = new Material[originals.Length];
            for (int i = 0; i < originals.Length; i++) {
                var material = originals[i];
                if (material == null) { result[i] = null; continue; }
                var matKey = (material, toneBucket, mode);
                if (!tonedMaterialCache.TryGetValue(matKey, out var toned) || toned == null) {
                    toned = new Material(material) { name = material.name + " tone" + toneBucket + "_" + mode };
                    int property = -1;
                    if (toned.HasProperty(GltfBaseProp)) property = GltfBaseProp;
                    else if (toned.HasProperty(BaseColorProp)) property = BaseColorProp;
                    else if (toned.HasProperty(ColorProp)) property = ColorProp;
                    if (property >= 0) {
                        var original = toned.GetColor(property);
                        var tinted = new Color(original.r * tone, original.g * tone, original.b * tone, original.a);
                        if (translucent) {
                            float resolvedAlpha = original.a < .999f ? original.a * opacity : opacity;
                            if (original.a >= .999f) tinted = Color.Lerp(tinted, new Color(.42f, .455f, .502f, 1f), .7f);
                            tinted.a = resolvedAlpha;
                        }
                        toned.SetColor(property, tinted);
                    }
                    tonedMaterialCache[matKey] = toned;
                }
                result[i] = toned;
            }
            tonedArrayCache[arrKey] = result;
            return result;
        }

        void DisposeTonedMaterials() {
            foreach (var mat in tonedMaterialCache.Values) {
                if (mat != null) DestroyNow(mat);
            }
            tonedMaterialCache.Clear();
            tonedArrayCache.Clear();
        }

        void SyncActorTone(PassengerCrowdActor actor, StationDrawMode mode) {
            if (actor == null || actor.Skin == null || mode == StationDrawMode.Hidden) return;
            double tone = actor.Look.Tone;
            bool hasSectionPlane = actor.Target != null && actor.Target.SectionShaderActive;
            if (Math.Abs(tone - 1.0) < 1e-9) {
                if (actor.HadToneBlock && !hasSectionPlane) ClearToneBlock(actor);
                actor.LastToneMode = mode;
                actor.LastToneSectionShader = hasSectionPlane;
                return;
            }
            var materials = actor.OriginalMaterials;
            if (materials == null || materials.Length == 0) return;

            // Without an active section plane, use bounded shared toned materials (20-step buckets)
            // instead of per-actor MaterialPropertyBlocks so URP's SRP Batcher batches all passengers
            // across Base, Ghost, and Clear modes.
            if (!hasSectionPlane) {
                if (actor.HadToneBlock) ClearToneBlock(actor);
                if (actor.LastToneMode == mode && !actor.LastToneSectionShader) return;
                var currentMats = mode == StationDrawMode.Base ? null : actor.Skin.sharedMaterials;
                var sourceMats = (currentMats != null && currentMats.Length > 0) ? currentMats : materials;
                if (sourceMats == null || sourceMats.Length == 0) return;
                int bucket = Mathf.Clamp(Mathf.RoundToInt((float)tone * 20f), 10, 30);
                // When mode is Ghost/Clear, StationVisibilityTarget has already swapped Skin.sharedMaterials
                // to the translucent Ghost/Clear material (carrying 0.35/0.25 alpha and desaturation).
                // Only apply the translucent alpha/tint fallback when sourceMats fell back to raw base materials.
                bool applyTranslucentStyle = mode != StationDrawMode.Base && ReferenceEquals(sourceMats, materials);
                var sharedToned = GetSharedTonedMaterials(sourceMats, bucket, mode, applyTranslucentStyle);
                actor.Skin.sharedMaterials = sharedToned;
                actor.LastToneMode = mode;
                actor.LastToneSectionShader = false;
                return;
            }

            if (actor.HadToneBlock && actor.LastToneMode == mode && actor.LastToneSectionShader) return;
            toneBlock ??= new MaterialPropertyBlock();
            bool translucent = mode == StationDrawMode.Ghost || mode == StationDrawMode.Clear;
            float opacity = mode == StationDrawMode.Clear
                ? StationVisibilityPalette.ClearOpacity
                : StationVisibilityPalette.GhostOpacity;

            for (int i = 0; i < materials.Length; i++) {
                var material = materials[i];
                if (material == null) continue;
                int property = -1;
                if (material.HasProperty(GltfBaseProp)) property = GltfBaseProp;
                else if (material.HasProperty(BaseColorProp)) property = BaseColorProp;
                else if (material.HasProperty(ColorProp)) property = ColorProp;
                if (property < 0) continue;
                var original = material.GetColor(property);
                var tinted = new Color(original.r * (float)tone, original.g * (float)tone,
                    original.b * (float)tone, original.a);
                if (translucent) {
                    float resolvedAlpha = original.a < .999f ? original.a * opacity : opacity;
                    if (original.a >= .999f) tinted = Color.Lerp(tinted, new Color(.42f, .455f, .502f, 1f), .7f);
                    tinted.a = resolvedAlpha;
                }
                toneBlock.Clear();
                if (hasSectionPlane) actor.Skin.GetPropertyBlock(toneBlock, i);
                toneBlock.SetColor(property, tinted);
                // One material index at a time: a raw outfit colour must not be
                // replaced by another region's colour.
                actor.Skin.SetPropertyBlock(toneBlock, i);
            }
            actor.HadToneBlock = true;
            actor.LastToneMode = mode;
            actor.LastToneSectionShader = true;
        }

        void Diagnose(string code, int simId, string detail) {
            string key = code + "|" + simId + "|" + detail;
            if (!reported.Add(key)) return;
            var diagnostic = new Diagnostic { Code = code, SimId = simId, Detail = detail };
            diagnostics.Add(diagnostic);
            reportedTo?.Invoke(diagnostic);
        }

        public void Release() {
            if (world != null) {
                world.VisibilityApplied -= RefreshVisibleCount;
            }
            foreach (var actor in actors.Values) {
                if (actor.TargetBound) {
                    actor.TargetBound = false;
                    world?.UnbindRuntimeTarget(actor.Target);
                }
                if (actor.Root != null) DestroyNow(actor.Root);
            }
            world = null;
            supportResolver = null;
            actors.Clear();
            inactiveByRecipe.Clear();
            seen.Clear();
            contactShadowMatrices.Clear();
            if (contactShadowMaterial != null) { DestroyNow(contactShadowMaterial); contactShadowMaterial = null; }
            DisposeTonedMaterials();
            diagnostics.Clear();
            reported.Clear();
            VisibleActors = 0;
            PosedThisFrame = 0;
            FrustumCulledThisFrame = 0;
        }

        // The actor instances are children of this view, so hierarchy teardown
        // destroys them. Release() (called by the renderer while the world is alive)
        // is the path that destroys them explicitly.
        void OnDestroy() {
            if (world != null) {
                world.VisibilityApplied -= RefreshVisibleCount;
                world = null;
            }
            supportResolver = null;
            actors.Clear();
            inactiveByRecipe.Clear();
            seen.Clear();
            contactShadowMatrices.Clear();
            if (contactShadowMaterial != null) { DestroyNow(contactShadowMaterial); contactShadowMaterial = null; }
            DisposeTonedMaterials();
            diagnostics.Clear();
            reported.Clear();
        }

        static void DestroyNow(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) Destroy(value); else DestroyImmediate(value);
        }
    }

    /// <summary>
    /// Packet H's station-world renderer. It owns the per-world crowd view, role
    /// <c>actors</c>, and reads the plain pose feed once per committed simulation
    /// frame. The catalogue comes from <see cref="PassengerCatalogueAnchor.Resolve"/>;
    /// without a local anchor it reports <c>passenger-catalogue-missing</c> and draws
    /// nothing — it never falls back to the <c>passenger-adult.glb</c> stand-in.
    ///
    /// The host snapshots one renderer instance into every staged world, so all
    /// state is keyed by <see cref="StationWorldView"/>: a replaced world's
    /// <c>Release()</c> must not clear the candidate the host is about to commit.
    /// </summary>
    public sealed class PassengerCrowdRenderer : IStationViewRenderer, IStationLocalViewRenderer {
        public bool TryStageLocalDelta(
            StationLocalDeltaContext context,
            out IStationLocalRendererStage stage,
            out string fallbackReason) {
            stage = null;
            fallbackReason = null;
            return true;
        }

        sealed class State {
            public StationWorldView World;
            public PassengerCrowdView View;
            public StationViewBuildContext Context;
            public StationDocument CachedDocument;
            public PassengerSupportResolver Support;
            public int LastPoseSamples;
            public int LastPresentedPoses;
            public int Serial;
            public bool MissingCatalogue;
            public LineRenderer RouteLine;
            public Material RouteMaterial;
            public int RouteId;
            public long RouteTick = long.MinValue;
            public readonly List<(double X, double Y, double Z)> RoutePoints = new List<(double, double, double)>();
        }

        struct PausedPresentationKey : IEquatable<PausedPresentationKey> {
            public StationDocument Document;
            public PassengerSupportResolver Support;
            public int ActiveLevel;
            public bool ShowLevels, HideGround, HideUi, Cutaway, SectionClip;
            public int FollowId;
            public int GraphicsProfile;
            public Vector3 CamPos;
            public Vector3 CamForward;
            public float CamViewScale;
            public Vector3 SectionNormal;
            public Vector3 SectionPoint;

            public bool Equals(PausedPresentationKey other) =>
                ReferenceEquals(Document, other.Document) &&
                ReferenceEquals(Support, other.Support) &&
                ActiveLevel == other.ActiveLevel &&
                ShowLevels == other.ShowLevels &&
                HideGround == other.HideGround &&
                HideUi == other.HideUi &&
                Cutaway == other.Cutaway &&
                SectionClip == other.SectionClip &&
                FollowId == other.FollowId &&
                GraphicsProfile == other.GraphicsProfile &&
                (CamPos - other.CamPos).sqrMagnitude < 1e-6f &&
                (CamForward - other.CamForward).sqrMagnitude < 1e-6f &&
                Mathf.Abs(CamViewScale - other.CamViewScale) < 1e-5f &&
                (SectionNormal - other.SectionNormal).sqrMagnitude < 1e-6f &&
                (SectionPoint - other.SectionPoint).sqrMagnitude < 1e-6f;
        }

        readonly Dictionary<StationWorldView, State> states = new Dictionary<StationWorldView, State>();
        List<PassengerPose> poses = new List<PassengerPose>();
        List<PassengerPose> priorTickPoses = new List<PassengerPose>();
        List<PassengerPose> readScratch = new List<PassengerPose>();
        readonly List<PassengerPose> presented = new List<PassengerPose>();
        readonly List<int> alignedPriorIndex = new List<int>();
        readonly Dictionary<int, int> previousPoseIndices = new Dictionary<int, int>();
        List<PassengerPose> activePresented;
        bool currentPosesSorted;
        bool priorPosesSorted;
        bool previousPoseIndicesBuilt;
        bool hasAnyAdjacentPrior;
        IPassengerPoseFeed lastFeed;
        State lastTickState;
        long lastTick = long.MinValue;
        long lastEpoch = long.MinValue;
        double lastPresentedAlpha = double.NaN;
        bool hasTick;
        bool hasPresented;
        bool hasLastReadSession;
        StationSimulationSession lastReadSession;
        PausedPresentationKey lastPausedKey;
        State newest;
        int serial;

        public PassengerCrowdRenderer() {
            activePresented = presented;
        }

        public string Role => "actors";
        public PassengerCrowdView View => newest?.View;
        public int VisibleActors => newest?.View != null ? newest.View.VisibleActors : 0;
        public int Spawned => newest?.View != null ? newest.View.Spawned : 0;
        /// <summary>Poses the bound feed published at the last tick (before eligibility).</summary>
        public int LastPoseSamples => newest != null ? newest.LastPoseSamples : 0;
        /// <summary>Visible poses handed to the view after interpolation and eligibility filtering.</summary>
        public int LastPresentedPoses => newest != null ? newest.LastPresentedPoses : 0;
        /// <summary>Read-only view of the poses handed to <see cref="PassengerCrowdView.Render"/> on the last tick.</summary>
        public IReadOnlyList<PassengerPose> LastPresentedSnapshot => activePresented;
        public bool CatalogueBound => newest != null && !newest.MissingCatalogue;
        /// <summary>The renderer of the active built world; the frame sink uses it.</summary>
        public static PassengerCrowdRenderer Current { get; private set; }

        public bool TryGetEyePose(int id, out Vector3 position, out float heading) {
            position = default;
            heading = 0;
            if (newest?.View == null || !newest.View.TryGetActor(id, out var actor)) return false;
            var list = activePresented;
            if (list == null) return false;
            for (int i = 0; i < list.Count; i++) {
                var pose = list[i];
                if (pose.SimId != id || !pose.Visible) continue;
                position = StationCoordinates.Point(new Vector3((float)pose.X, (float)pose.Y,
                    (float)(pose.Z + 1.48 * actor.Look.Height)));
                heading = (float)pose.Heading;
                return true;
            }
            return false;
        }

        public bool TryPick(StationWorldView world, Ray ray, float blocker, in StationPickContext context, out int id) {
            id = 0;
            return world != null && states.TryGetValue(world, out var state) &&
                state.View != null && state.View.TryPick(ray, blocker, out id, context);
        }

        public void Build(StationViewBuildContext context) {
            var state = new State {
                World = context.World,
                Context = context,
                CachedDocument = context.Document,
                Support = context.Document != null ? new PassengerSupportResolver(context.Document, context.Index) : null,
                Serial = ++serial,
            };
            states[context.World] = state;
            newest = state;
            Current = this;
            var catalogue = PassengerCatalogueAnchor.Resolve();
            if (catalogue == null) {
                state.MissingCatalogue = true;
                context.ReportUnresolved("passenger-catalogue-missing", "renderer", Role,
                    "No local PassengerCatalogue is bound; the soft-human crowd is not installed (no stand-in is selected).");
                return;
            }
            var report = catalogue.Verify();
            for (int i = 0; i < report.Problems.Length; i++)
                context.ReportUnresolved("passenger-catalogue-invalid", "catalogue", report.Problems[i], report.Problems[i]);
            state.View = PassengerCrowdView.Build(context.RoleRoot(Role), catalogue,
                null,
                diagnostic => context.ReportUnresolved(diagnostic.Code, "actor", "passenger:" + diagnostic.SimId, diagnostic.Detail));
            state.View.BindWorld(context.World, state.Support);
        }

        /// <summary>
        /// One committed simulation frame. The clock is packet C's; the actors are
        /// whatever the bound feed publishes. A missing feed keeps the last frame
        /// (pause/replay must not blink) and a feed that has no crowd publishes an
        /// empty list, which hides the actors.
        ///
        /// The feed publishes one pose per passenger per fixed tick. A rendered frame
        /// inside the tick interval samples the adjacent pair at the scheduler fraction.
        /// Continuous ramp poses sample the same curve as the simulation. New identities
        /// and discontinuous train transfers use the current frame.
        /// </summary>
        public void Tick(StationDocument document, StationIndex index, StationFrameClock clock) {
            var state = newest;
            var view = state?.View;
            if (state != null && document != null && !ReferenceEquals(state.CachedDocument, document)) {
                state.CachedDocument = document;
                state.Support = state.Support != null
                    ? state.Support.WithDocument(document, index)
                    : new PassengerSupportResolver(document, index);
                view?.SetSupportResolver(state.Support);
            }
            if (view == null && state != null && state.Context != null &&
                (state.World == null || !state.World.IsDisposed)) {
                var catalogue = PassengerCatalogueAnchor.Resolve();
                if (catalogue != null) {
                    state.MissingCatalogue = false;
                    var report = catalogue.Verify();
                    for (int i = 0; i < report.Problems.Length; i++) {
                        state.Context.ReportUnresolved("passenger-catalogue-invalid", "catalogue",
                            report.Problems[i], report.Problems[i]);
                    }
                    state.CachedDocument = document ?? state.Context.Document;
                    state.Support = state.CachedDocument != null
                        ? new PassengerSupportResolver(state.CachedDocument, index ?? state.Context.Index)
                        : null;
                    view = state.View = PassengerCrowdView.Build(state.Context.RoleRoot(Role), catalogue,
                        null,
                        diagnostic => state.Context.ReportUnresolved(diagnostic.Code, "actor",
                            "passenger:" + diagnostic.SimId, diagnostic.Detail));
                    view.BindWorld(state.World, state.Support);
                }
            }
            if (view == null) return;
            var feed = PassengerPoseFeeds.Source;
            if (feed == null) return;
            var sessionFeed = feed as SessionPassengerFeed;
            var liveSession = sessionFeed != null ? sessionFeed.Session : null;
            if (sessionFeed != null && liveSession == null) return;

            bool reset = !hasTick || clock.Epoch != lastEpoch || !ReferenceEquals(feed, lastFeed) ||
                !ReferenceEquals(state, lastTickState) ||
                (sessionFeed != null && (!hasLastReadSession || !ReferenceEquals(liveSession, lastReadSession)));
            bool tickChanged = reset || clock.Tick != lastTick;

            if (!clock.Playing && !tickChanged && hasPresented && sessionFeed != null &&
                Math.Abs(clock.Fraction - lastPresentedAlpha) < 1e-6) {
                var key = CapturePausedKey(state, document);
                if (key.Equals(lastPausedKey)) {
                    UpdateSelectedRoute(state, sessionFeed, clock.Tick);
                    return;
                }
            }

            bool posesRefreshed = false;
            if (tickChanged || sessionFeed == null) {
                readScratch.Clear();
                bool published;
                try {
                    published = feed.TryRead(readScratch);
                } catch (Exception error) {
                    state.Context?.ReportUnresolved("passenger-feed-failed", "actor", "feed", error.Message);
                    return;
                }
                if (!published) return;
                hasLastReadSession = sessionFeed != null;
                lastReadSession = liveSession;
                posesRefreshed = true;
            }

            List<PassengerPose> currentPoses;
            if (reset) {
                if (hasTick && StationEditSession.SelectionKind == "agent") StationEditSession.ClearSelection();
                var oldPoses = poses;
                poses = readScratch;
                readScratch = oldPoses;
                CopyList(poses, priorTickPoses);
                currentPosesSorted = IsStrictlyAscendingBySimId(poses);
                priorPosesSorted = currentPosesSorted;
                previousPoseIndicesBuilt = false;
                RebuildAlignedPriors(poses, currentPosesSorted);
                currentPoses = poses;
                hasTick = true;
                lastFeed = feed;
                lastTickState = state;
            } else if (clock.Tick != lastTick) {
                // The tick advanced: what we saw last time becomes the previous member of
                // the pair and this frame becomes the current one via O(1) list rotation.
                var oldPrior = priorTickPoses;
                priorTickPoses = poses;
                poses = readScratch;
                readScratch = oldPrior;
                priorPosesSorted = currentPosesSorted;
                currentPosesSorted = IsStrictlyAscendingBySimId(poses);
                previousPoseIndicesBuilt = false;
                RebuildAlignedPriors(poses, currentPosesSorted);
                currentPoses = poses;
            } else if (posesRefreshed) {
                // Non-session feed re-read within the same tick: keep poses/priorTickPoses
                // intact so the next tick advance pairs against the tick's original sample.
                RebuildAlignedPriors(readScratch, IsStrictlyAscendingBySimId(readScratch));
                currentPoses = readScratch;
            } else {
                currentPoses = poses;
            }
            lastTick = clock.Tick;
            lastEpoch = clock.Epoch;

            float alpha = (float)clock.Fraction;
            List<PassengerPose> toRender;
            if ((alpha >= 1f || !hasAnyAdjacentPrior) && ReferenceEquals(currentPoses, poses)) {
                toRender = poses;
            } else {
                presented.Clear();
                int count = currentPoses.Count;
                if (presented.Capacity < count) presented.Capacity = count;
                if (alpha >= 1f || !hasAnyAdjacentPrior) {
                    for (int i = 0; i < count; i++) presented.Add(currentPoses[i]);
                } else {
                    for (int i = 0; i < count; i++) {
                        var current = currentPoses[i];
                        // alpha 0 is the previous tick frame and alpha 1 the current one, the same
                        // convention as `ModuleMotionDispatch` and the presented clock; a missing
                        // or non-adjacent pair snaps to the current frame instead.
                        int priorIdx = alignedPriorIndex[i];
                        if (priorIdx < 0) {
                            presented.Add(current);
                            continue;
                        }
                        var prior = priorTickPoses[priorIdx];
                        var blend = current;
                        blend.X = Lerp(prior.X, current.X, alpha);
                        blend.Y = Lerp(prior.Y, current.Y, alpha);
                        blend.Z = Lerp(prior.Z, current.Z, alpha);
                        blend.Heading = LerpAngle(prior.Heading, current.Heading, alpha);
                        if (prior.Activity == current.Activity)
                            blend.ActivitySeconds = Lerp(prior.ActivitySeconds, current.ActivitySeconds, alpha);
                        if (current.RidePath != null &&
                            (current.RidePath == prior.RidePath && current.ServerId == prior.ServerId ||
                             prior.RidePath == null && current.State == StationPassengerState.Riding ||
                             current.RideProgress == 1 && prior.State == StationPassengerState.Riding &&
                                prior.RidePath == current.RidePath)) {
                            bool starting = prior.RidePath == null;
                            blend.RideProgress = Lerp(starting ? 0 : prior.RideProgress, current.RideProgress, alpha);
                            current.RidePath.Sample(blend.RideProgress, current.RideReverse, current.RideColumn,
                                out double x, out double y, out double z, out double heading);
                            // Ease the short gap between the queue's actual feet and the start of the run.
                            if (starting) {
                                current.RidePath.Sample(0, current.RideReverse, current.RideColumn,
                                    out double sx, out double sy, out double sz, out _);
                                x += (prior.X - sx) * (1 - alpha);
                                y += (prior.Y - sy) * (1 - alpha);
                                z += (prior.Z - sz) * (1 - alpha);
                            }
                            blend.X = x; blend.Y = y; blend.Z = z; blend.Heading = heading;
                            if (current.RideProgress == 1 && prior.Activity != PassengerActivity.Walk) blend.Activity = prior.Activity;
                        }
                        blend.WalkDistance = Lerp(prior.WalkDistance, current.WalkDistance, alpha);
                        blend.WalkPhase = Lerp(prior.WalkPhase, current.WalkPhase, alpha);
                        bool startedWalking = current.Activity == PassengerActivity.Walk &&
                            current.WalkWeight > 0.5 &&
                            current.WalkDistance - prior.WalkDistance > 0.05;
                        blend.WalkWeight = startedWalking ? current.WalkWeight : Lerp(prior.WalkWeight, current.WalkWeight, alpha);
                        presented.Add(blend);
                    }
                }
                toRender = presented;
            }
            activePresented = toRender;
            view.Render(toRender, clock.PresentationSeconds, checkGone: tickChanged || sessionFeed == null);
            lastPresentedAlpha = clock.Fraction;
            hasPresented = true;
            lastPausedKey = CapturePausedKey(state, document);
            UpdateSelectedRoute(state, sessionFeed, clock.Tick);
            state.LastPoseSamples = currentPoses.Count;
            state.LastPresentedPoses = view.PosedThisFrame;
        }

        void RebuildAlignedPriors(List<PassengerPose> currentPoses, bool currentSorted) {
            alignedPriorIndex.Clear();
            int count = currentPoses.Count;
            if (alignedPriorIndex.Capacity < count) alignedPriorIndex.Capacity = count;
            hasAnyAdjacentPrior = false;
            int priorCount = priorTickPoses.Count;
            if (count == 0 || priorCount == 0) {
                for (int i = 0; i < count; i++) alignedPriorIndex.Add(-1);
                return;
            }
            if (priorPosesSorted && currentSorted) {
                int j = 0;
                for (int i = 0; i < count; i++) {
                    var current = currentPoses[i];
                    int simId = current.SimId;
                    while (j < priorCount && priorTickPoses[j].SimId < simId) j++;
                    if (j < priorCount && priorTickPoses[j].SimId == simId) {
                        if (current.Visible) {
                            var prior = priorTickPoses[j];
                            if (prior.Visible && Adjacent(in prior, in current)) {
                                alignedPriorIndex.Add(j);
                                hasAnyAdjacentPrior = true;
                                j++;
                                continue;
                            }
                        }
                        alignedPriorIndex.Add(-1);
                        j++;
                    } else {
                        alignedPriorIndex.Add(-1);
                    }
                }
                return;
            }

            if (!previousPoseIndicesBuilt) {
                previousPoseIndices.Clear();
                for (int j = 0; j < priorCount; j++) {
                    previousPoseIndices[priorTickPoses[j].SimId] = j;
                }
                previousPoseIndicesBuilt = true;
            }
            for (int i = 0; i < count; i++) {
                var current = currentPoses[i];
                if (current.Visible && previousPoseIndices.TryGetValue(current.SimId, out int priorIdx)) {
                    var prior = priorTickPoses[priorIdx];
                    if (prior.Visible && Adjacent(in prior, in current)) {
                        alignedPriorIndex.Add(priorIdx);
                        hasAnyAdjacentPrior = true;
                        continue;
                    }
                }
                alignedPriorIndex.Add(-1);
            }
        }

        static bool IsStrictlyAscendingBySimId(List<PassengerPose> list) {
            int count = list.Count;
            for (int i = 1; i < count; i++) {
                if (list[i].SimId <= list[i - 1].SimId) return false;
            }
            return true;
        }

        static void CopyList(List<PassengerPose> from, List<PassengerPose> to) {
            to.Clear();
            int count = from.Count;
            if (to.Capacity < count) to.Capacity = count;
            for (int i = 0; i < count; i++) to.Add(from[i]);
        }

        static PausedPresentationKey CapturePausedKey(State state, StationDocument document) {
            var vis = state?.World?.Visibility;
            var rig = StationViewFeature.Active;
            var cam = rig != null && rig.viewCamera != null ? rig.viewCamera : Camera.main;
            var overrideCam = state?.View?.FrustumCameraOverride;
            var lodCam = overrideCam != null
                ? overrideCam
                : (StationExplodedView.IsStandaloneActive
                    ? StationViewFeature.ActiveExploded?.ViewerCamera : cam);
            return new PausedPresentationKey {
                Document = document,
                Support = state?.Support,
                ActiveLevel = vis != null ? vis.State.ActiveLevel : 0,
                ShowLevels = vis != null && vis.State.ShowLevels,
                HideGround = vis != null && vis.State.HideGround,
                HideUi = vis != null && vis.State.HideUi,
                Cutaway = vis != null && vis.State.Cutaway,
                SectionClip = vis != null && vis.SectionClipping,
                FollowId = vis != null ? vis.State.FollowPassenger : 0,
                GraphicsProfile = (StationGraphicsSettings.MinimumModelLod << 12) ^
                    (StationGraphicsSettings.OtherLevelModelLod << 8) ^
                    Mathf.RoundToInt(StationGraphicsSettings.ModelLodBias * 100f),
                CamPos = lodCam != null ? lodCam.transform.position : Vector3.zero,
                CamForward = lodCam != null ? lodCam.transform.forward : Vector3.forward,
                CamViewScale = lodCam != null ? (lodCam.orthographic ? lodCam.orthographicSize : lodCam.fieldOfView) : 0f,
                SectionNormal = vis != null ? vis.Section.Normal : Vector3.zero,
                SectionPoint = vis != null ? vis.Section.Point : Vector3.zero,
            };
        }

        static Vector3 RoutePoint(double x, double y, double z) =>
            StationCoordinates.Point(new Vector3((float)x, (float)y, (float)z + .05f));

        static void UpdateSelectedRoute(State state, SessionPassengerFeed feed, long tick) {
            if (state.RouteLine != null) state.RouteLine.enabled = false;
            if (StationViewFeature.Active?.Commands?.FollowPassenger == true || StationEditSession.SelectionKind != "agent" ||
                !int.TryParse(StationEditSession.SelectionKey, out int id) || feed?.Session == null) {
                state.RouteId = 0;
                return;
            }
            if (state.RouteId != id || state.RouteTick != tick) {
                state.RouteId = id;
                state.RouteTick = tick;
                bool ok = feed.SimHost != null
                    ? feed.SimHost.WithSessionLock(s => s.Services != null && s.Services.TryReadPassengerRoute(id, state.RoutePoints))
                    : feed.Session.Services.TryReadPassengerRoute(id, state.RoutePoints);
                if (!ok) {
                    StationEditSession.ClearSelection();
                    return;
                }
            }
            if (state.RoutePoints.Count == 0 || !state.View.TryGetActor(id, out var actor) || !actor.Visible) return;
            if (!state.RouteLine) {
                var shader = Shader.Find("Metro/Station Highlight") ?? Shader.Find("Universal Render Pipeline/Unlit");
                if (!shader) return;
                var go = new GameObject("Selected passenger route");
                go.transform.SetParent(state.World.Root, false);
                state.RouteLine = go.AddComponent<LineRenderer>();
                state.RouteMaterial = new Material(shader) { color = new Color32(44, 206, 255, 255) };
                state.RouteLine.sharedMaterial = state.RouteMaterial;
                state.RouteLine.widthMultiplier = .09f;
                state.RouteLine.numCornerVertices = 3;
                state.RouteLine.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                state.RouteLine.receiveShadows = false;
            }
            var route = state.RouteLine;
            route.positionCount = 1 + state.RoutePoints.Count;
            var actorPos = actor.HasPendingTransform && !float.IsNaN(actor.PendingPosition.x)
                ? actor.PendingPosition
                : actor.Position;
            route.SetPosition(0, actorPos + Vector3.up * .05f);
            var visibility = state.World.Visibility;
            if (visibility != null && state.RouteMaterial.HasProperty("_SectionPlane")) {
                var normal = StationCoordinates.Direction(visibility.Section.Normal);
                var point = StationCoordinates.Point(visibility.Section.Point);
                state.RouteMaterial.SetVector("_SectionPlane",
                    new Vector4(normal.x, normal.y, normal.z, -Vector3.Dot(normal, point)));
                state.RouteMaterial.SetFloat("_SectionClip", visibility.SectionClipping ? 1 : 0);
            }
            for (int i = 0; i < state.RoutePoints.Count; i++) {
                var (x, y, z) = state.RoutePoints[i];
                route.SetPosition(i + 1, RoutePoint(x, y, z));
            }
            route.enabled = true;
        }

        /// <summary>A continuous ground, ramp or lift sample belonging to the same passenger.</summary>
        static bool Adjacent(in PassengerPose prior, in PassengerPose current) {
            bool ground = IsOnFoot(prior.State) && IsOnFoot(current.State);
            bool ramp = current.RidePath != null &&
                (prior.RidePath == current.RidePath || prior.RidePath == null && IsOnFoot(prior.State));
            bool priorLift = prior.ServerId != null && prior.ServerId.Length >= 5 && prior.ServerId[0] == 'l' &&
                prior.ServerId.StartsWith("lift:", StringComparison.Ordinal);
            bool currentLift = current.ServerId != null && current.ServerId.Length >= 5 && current.ServerId[0] == 'l' &&
                current.ServerId.StartsWith("lift:", StringComparison.Ordinal);
            bool lift = (priorLift && currentLift && string.Equals(prior.ServerId, current.ServerId, StringComparison.Ordinal)) ||
                (priorLift && IsOnFoot(current.State)) ||
                (currentLift && IsOnFoot(prior.State));
            if (!ground && !ramp && !lift &&
                (prior.State != current.State || !string.Equals(prior.ServerId, current.ServerId, StringComparison.Ordinal)))
                return false;
            double dx = current.X - prior.X, dy = current.Y - prior.Y, dz = current.Z - prior.Z;
            return Math.Abs(dz) < (lift ? 3.0 : ramp ? 2.0 : .75) && dx * dx + dy * dy < 3.0 * 3.0;
        }

        static bool IsOnFoot(StationPassengerState state) =>
            state == StationPassengerState.Walking || state == StationPassengerState.Queuing ||
            state == StationPassengerState.Buying || state == StationPassengerState.Browsing;

        static double Lerp(double from, double to, double alpha) => from + (to - from) * alpha;

        static double LerpAngle(double from, double to, double alpha) {
            double delta = to - from;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            return from + delta * alpha;
        }

        public void Release() {
            // The host calls Release on the world being replaced after the candidate
            // has built. Drop only disposed worlds and keep the live state.
            var dead = new List<StationWorldView>();
            foreach (var pair in states) {
                if (pair.Key == null || pair.Key.IsDisposed) {
                    pair.Value?.View?.Release();
                    if (pair.Value.RouteMaterial) UnityEngine.Object.Destroy(pair.Value.RouteMaterial);
                    dead.Add(pair.Key);
                }
            }
            for (int i = 0; i < dead.Count; i++) states.Remove(dead[i]);
            State next = null;
            foreach (var state in states.Values) if (next == null || state.Serial > next.Serial) next = state;
            newest = next;
            if (newest == null) Current = null;
        }
    }

    /// <summary>Packet H's per-frame half: C's clock and the bound actor feed.</summary>
    sealed class PassengerFrameSink : IStationFrameSink {
        public void Tick(StationDocument document, StationIndex index, StationFrameClock clock) =>
            PassengerCrowdRenderer.Current?.Tick(document, index, clock);
    }

    /// <summary>Process-wide registration of the actor renderer and its frame sink.</summary>
    public static class PassengerCrowdFeature {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() {
            StationRenderers.Add(new PassengerCrowdRenderer());
            StationFrameSinks.Add(new PassengerFrameSink());
        }
    }
}
