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
        readonly StationDocument document;
        readonly StationIndex index;
        readonly Dictionary<string, StationModuleRecord> tracksById;
        readonly HashSet<(int x, int y)> exitGroundCells;
        readonly HashSet<(int x, int y)> nonGradeGroundCells;
        readonly HashSet<(int x, int y)> fallbackCellNonGradeGroundCells;
        readonly HashSet<(int x, int y, int z)> explicitGradeCells;
        readonly List<(int x0, int y0, int x1, int y1, int zLo, int zHi)> rampVolumes;

        PassengerSupportResolver(
            StationDocument doc,
            StationIndex stationIndex,
            PassengerSupportResolver reuseModulesFrom) {
            document = doc;
            index = stationIndex;
            tracksById = reuseModulesFrom.tracksById;
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

            if (!string.IsNullOrEmpty(pose.ServerId)) {
                if (pose.ServerId.StartsWith("line:", StringComparison.Ordinal)) {
                    string trainKey = pose.ServerId.Substring(5);
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
                    int pipe = trainKey.IndexOf('|');
                    if (pipe >= 0 && pipe + 1 < trainKey.Length) {
                        string trackId = trainKey.Substring(pipe + 1);
                        if (tracksById.TryGetValue(trackId, out var track) && track != null) {
                            var trackBands = StationModuleLevels.Of(track, grid);
                            band = trackBands.Length > 0 ? trackBands[0] : StationModuleLevels.Band(grid, track.Z);
                            secondBand = band;
                            gradeOwned = false;
                            return true;
                        }
                    }
                } else if (pose.ServerId.StartsWith("lift:", StringComparison.Ordinal)) {
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
            if (!HasSupportAt(fx, fy, supportZ)) {
                int rawCellZ = (int)Math.Floor(pose.Z + 1e-3);
                if (HasSupportAt(fx, fy, rawCellZ)) supportZ = rawCellZ;
            }

            band = StationModuleLevels.Band(grid, supportZ);
            secondBand = band;
            if (supportZ == StationViewFeature.GroundZ) {
                gradeOwned = !IsNonGradeGroundAt(fx, fy);
            } else {
                gradeOwned = explicitGradeCells.Contains((fx, fy, supportZ));
            }
            return true;
        }

        bool HasSupportAt(int x, int y, int z) {
            if (z == StationViewFeature.GroundZ) return true;
            if (index != null && index.TryGetCell(new StationCellKey(x, y, z), out var cell) && cell != null && cell.IsSolid) {
                return true;
            }
            if (explicitGradeCells.Contains((x, y, z))) return true;
            for (int i = 0; i < rampVolumes.Count; i++) {
                var r = rampVolumes[i];
                if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 && z >= r.zLo && z <= r.zHi) return true;
            }
            foreach (var track in tracksById.Values) {
                if (track != null && track.Z == z) return true;
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
        internal Material[] OriginalMaterials = Array.Empty<Material>();

        public Vector3 Position => Root != null ? Root.transform.position : Vector3.zero;
        public Quaternion Rotation => Root != null ? Root.transform.rotation : Quaternion.identity;
        public Vector3 Scale => Root != null ? Root.transform.localScale : Vector3.one;
    }

    /// <summary>
    /// Renders the real recipe-selected soft-human prefabs. Every actor is a
    /// <c>Generated/Passengers</c> prefab instantiated at the document position,
    /// scaled by (width, height, depth) about its feet pivot and posed by sampling a
    /// clip from its own imported rig at the source's stride/phase.
    ///
    /// Deliberately **not** an instanced stand-in: a missing catalogue, recipe, rig
    /// or clip hides that actor and reports a named diagnostic. Child is a runtime
    /// scale of the same recipe. Low topology is declared by the manifest but not yet
    /// rendered from the retained sample; a Low request is reported
    /// (<c>low-topology-unported</c>) rather than silently substituted.
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

        readonly Dictionary<int, PassengerCrowdActor> actors = new Dictionary<int, PassengerCrowdActor>();
        readonly Dictionary<string, List<PassengerCrowdActor>> inactiveByRecipe =
            new Dictionary<string, List<PassengerCrowdActor>>(StringComparer.Ordinal);
        readonly HashSet<int> seen = new HashSet<int>();
        readonly List<int> goneScratch = new List<int>();
        readonly List<Diagnostic> diagnostics = new List<Diagnostic>();
        readonly HashSet<string> reported = new HashSet<string>(StringComparer.Ordinal);
        MaterialPropertyBlock toneBlock;
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
        public double LastSimTime { get; private set; }
        public IReadOnlyList<Diagnostic> Diagnostics => diagnostics;
        public PassengerCatalogue Catalogue => catalogue;
        /// <summary>The manifest declares Low as a runtime variant; this renderer does not draw it yet.</summary>
        public bool SupportsLowDetail => false;

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
                if (!actor.Visible || !actor.ActiveInFrame || actor.Skin == null || !actor.Skin.enabled) continue;
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

        /// <summary>
        /// Pose the complete actor set for one simulation frame. No wall clock is
        /// read: the same poses always produce the same clips and the same times.
        /// </summary>
        public void Render(IReadOnlyList<PassengerPose> poses, double simTimeSeconds = 0) {
            LastSimTime = simTimeSeconds;
            seen.Clear();
            PosedThisFrame = 0;
            SampledThisFrame = 0;
            SkippedHiddenAnimationThisFrame = 0;
            SkippedUnchangedAnimationThisFrame = 0;
            var rig = StationViewFeature.Active;
            var cam = rig != null && rig.viewCamera != null ? rig.viewCamera : Camera.main;
            bool hasCam = Application.isPlaying && cam != null;
            Vector3 camPos = hasCam ? cam.transform.position : Vector3.zero;
            int followId = rig?.Visibility != null ? rig.Visibility.State.FollowPassenger : 0;
            if (poses != null) {
                for (int i = 0; i < poses.Count; i++) {
                    var pose = poses[i];
                    if (!pose.Visible) { Hide(pose.SimId); continue; }
                    var actor = GetOrSpawn(pose);
                    if (actor == null) continue;
                    Pose(actor, pose, hasCam, camPos, followId);
                }
            }
            // The feed publishes a complete frame: an actor that left the frame is
            // removed from view this frame (replay must not leave stale bodies).
            goneScratch.Clear();
            foreach (var pair in actors) {
                if (!seen.Contains(pair.Key)) goneScratch.Add(pair.Key);
            }
            for (int i = 0; i < goneScratch.Count; i++) Hide(goneScratch[i]);
            RefreshVisibleCount();
        }

        PassengerCrowdActor GetOrSpawn(PassengerPose pose) {
            if (actors.TryGetValue(pose.SimId, out var existing)) {
                RemoveFromInactivePool(existing);
                var nextLook = PassengerAppearance.Look(catalogue, pose.SimId, pose.Detail);
                if (!SameLook(existing.Look, nextLook)) {
                    existing.Look = nextLook;
                    existing.ScaleApplied = false;
                    existing.LastToneMode = (StationDrawMode)(-1);
                }
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
                pooled.Look = PassengerAppearance.Look(catalogue, pose.SimId, pose.Detail);
                pooled.ScaleApplied = false;
                pooled.AnimationDirty = true;
                pooled.LastPosition = new Vector3(float.NaN, float.NaN, float.NaN);
                pooled.LastHeading = double.NaN;
                pooled.Registered = false;
                pooled.LastBand = int.MinValue;
                pooled.LastSecondBand = int.MinValue;
                pooled.LastGradeOwned = false;
                pooled.LastToneMode = (StationDrawMode)(-1);
                ClearToneBlock(pooled);
                if (pooled.Root != null) pooled.Root.name = "passenger " + pose.SimId + " " + entry.recipe;
                actors[pose.SimId] = pooled;
                if (pose.Detail == PassengerDetail.Low)
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
            skin.localBounds = new Bounds(new Vector3(0f, 0.9f, 0f), new Vector3(1.4f, 2.2f, 1.4f));
            var originals = skin.sharedMaterials != null ? (Material[])skin.sharedMaterials.Clone() : Array.Empty<Material>();

            var target = root.GetComponent<StationVisibilityTarget>() ?? root.AddComponent<StationVisibilityTarget>();
            target.Configure(StationPartRole.Actor, Array.Empty<int>(), isParked: true);
            target.Refresh();
            // Start hidden through the target so authored eligibility stays true while Skin.enabled starts false.
            target.Apply(StationDrawMode.Hidden, null);

            var actor = new PassengerCrowdActor {
                SimId = pose.SimId, Recipe = entry.recipe, Root = root, Rig = animation.gameObject,
                LegacyAnimation = animation, Skin = skin, Target = target, Entry = entry,
                Look = PassengerAppearance.Look(catalogue, pose.SimId, pose.Detail),
                OriginalMaterials = originals,
            };
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
            if (pose.Detail == PassengerDetail.Low)
                Diagnose("low-topology-unported", pose.SimId, "Low mesh is not rendered; Full topology is shown");
            return actor;
        }

        void Pose(PassengerCrowdActor actor, PassengerPose pose, bool hasCam, Vector3 camPos, int followId) {
            seen.Add(actor.SimId);

            int band = 0;
            int secondBand = 0;
            bool gradeOwned = false;
            if (world != null) {
                var grid = world.Visibility != null
                    ? world.Visibility.State.Grid
                    : StationLevelGrid.FromDocument(world.Document?.LevelBase ?? 0, world.Document?.StoreyHeight ?? 5);
                if (supportResolver != null) {
                    if (!supportResolver.Resolve(in pose, grid, TrainConsistRenderer.Current, out band, out secondBand, out gradeOwned)) {
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
            if (float.IsNaN(actor.LastPosition.x) || (worldPos - actor.LastPosition).sqrMagnitude > 1e-8f) {
                actor.Root.transform.position = worldPos;
                actor.LastPosition = worldPos;
            }
            if (double.IsNaN(actor.LastHeading) || Math.Abs(pose.Heading - actor.LastHeading) > 1e-5) {
                actor.Root.transform.rotation = PassengerAppearance.Rotation(pose.Heading);
                actor.LastHeading = pose.Heading;
            }
            if (!actor.ScaleApplied) {
                actor.Root.transform.localScale = PassengerAppearance.LocalScale(actor.Look);
                actor.ScaleApplied = true;
            }
            if (!actor.Root.activeSelf) actor.Root.SetActive(true);
            if (actor.Skin != null)
                actor.Skin.forceRenderingOff = followId == pose.SimId;

            if (world != null && actor.Target != null) {
                bool wasActive = actor.ActiveInFrame;
                actor.ActiveInFrame = true;
                bool dirty = !actor.TargetBound || !wasActive || actor.Target.Parked ||
                    actor.LastBand != band || actor.LastSecondBand != secondBand || actor.LastGradeOwned != gradeOwned ||
                    (world.Visibility != null && world.Visibility.SectionClipping);
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
                    SyncActorTone(actor, actor.Target.LastMode);
                }
            } else {
                actor.ActiveInFrame = true;
                if (actor.Target != null) {
                    actor.Target.parked = false;
                    actor.Target.Apply(StationDrawMode.Base, null);
                } else if (actor.Skin != null && !actor.Skin.enabled) {
                    actor.Skin.enabled = true;
                }
                actor.Visible = true;
                SyncActorTone(actor, StationDrawMode.Base);
            }

            if (!actor.Visible) {
                actor.AnimationDirty = true;
                SkippedHiddenAnimationThisFrame++;
                PosedThisFrame++;
                if (!actor.Registered) {
                    actor.Registered = true;
                    spawned?.Invoke(actor, pose);
                }
                return;
            }

            double activityTime = pose.ActivitySeconds;
            if (pose.RideSeconds > 0 &&
                (pose.Activity == PassengerActivity.Escalator || pose.Activity == PassengerActivity.EscalatorLeft))
                activityTime = PassengerAppearance.RailTimeline(pose.RideProgress * pose.RideSeconds, pose.RideSeconds, pose.RailVariant);
            var activity = PassengerAppearance.DisplayedActivity(pose.Activity, actor.Entry, activityTime);
            int hand = PassengerAppearance.ActionMode(pose.SimId, actor.Entry, activity, pose.PreferredHand);
            string clipName;
            float time;
            if (activity == PassengerActivity.Walk) {
                var gait = PassengerAppearance.Gait(actor.Look, pose.WalkDistance, pose.WalkPhase, pose.WalkWeight);
                bool stand = pose.WalkWeight <= 0.5 && (pose.HasWalkWeight || pose.WalkWeight > 1e-6);
                if (stand) {
                    clipName = "Idle";
                    time = 0f;
                } else {
                    clipName = PassengerAppearance.WalkClipName(actor.Look.WalkProfile);
                    time = (float)gait.SampleTime;
                }
            } else {
                clipName = PassengerAppearance.ClipName(activity, actor.Look.WalkProfile, hand);
                var candidate = actor.Clips.TryGetValue(clipName, out var clip) ? clip : null;
                time = (float)PassengerAppearance.ActivitySampleTime(activity, activityTime, candidate ? candidate.length : 0f);
            }
            if (!actor.Clips.TryGetValue(clipName, out var chosen) || chosen == null) {
                Diagnose("passenger-clip-missing", pose.SimId, actor.Recipe + " has no clip " + clipName);
                HideActor(actor);
                return;
            }

            bool sameClip = actor.Sampled && !actor.AnimationDirty && string.Equals(actor.ClipName, clipName, StringComparison.Ordinal);
            float minDelta = 1e-4f;
            if (sameClip && hasCam) {
                float distSq = (worldPos - camPos).sqrMagnitude;
                if (distSq > 85f * 85f) minDelta = 0.125f;
                else if (distSq > 45f * 45f) minDelta = 0.065f;
            }
            if (!sameClip || Mathf.Abs(actor.ClipTime - time) >= minDelta) {
                chosen.SampleAnimation(actor.Rig, Mathf.Min(time, Mathf.Max(0f, chosen.length - 0.00001f)));
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
        }

        void Hide(int simId) {
            if (actors.TryGetValue(simId, out var actor)) HideActor(actor);
        }

        void HideActor(PassengerCrowdActor actor) {
            if (actor == null) return;
            actor.Visible = false;
            actor.ActiveInFrame = false;
            actor.LastBand = int.MinValue;
            actor.LastSecondBand = int.MinValue;
            actor.LastGradeOwned = false;
            actor.LastToneMode = (StationDrawMode)(-1);
            if (actor.TargetBound) {
                actor.TargetBound = false;
                world?.UnbindRuntimeTarget(actor.Target);
            } else if (actor.Target != null) {
                actor.Target.parked = true;
                actor.Target.levels = Array.Empty<int>();
                actor.Target.gradeOwned = false;
                actor.Target.Apply(StationDrawMode.Hidden, null);
            }
            if (actor.Root != null && actor.Root.activeSelf) actor.Root.SetActive(false);
            AddToInactivePool(actor);
        }

        public void HideAll() {
            foreach (var actor in actors.Values) HideActor(actor);
            VisibleActors = 0;
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
        }

        void SyncActorTone(PassengerCrowdActor actor, StationDrawMode mode) {
            if (actor == null || actor.Skin == null || mode == StationDrawMode.Hidden) return;
            double tone = actor.Look.Tone;
            bool hasSectionPlane = actor.Target != null && actor.Target.SectionShaderActive;
            if (Math.Abs(tone - 1.0) < 1e-9) {
                if (actor.HadToneBlock && !hasSectionPlane) ClearToneBlock(actor);
                actor.LastToneMode = mode;
                return;
            }
            if (actor.HadToneBlock && actor.LastToneMode == mode) return;

            var materials = actor.OriginalMaterials;
            if (materials == null || materials.Length == 0) return;
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
            diagnostics.Clear();
            reported.Clear();
            VisibleActors = 0;
            PosedThisFrame = 0;
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

        readonly Dictionary<StationWorldView, State> states = new Dictionary<StationWorldView, State>();
        readonly List<PassengerPose> poses = new List<PassengerPose>();
        readonly List<PassengerPose> presented = new List<PassengerPose>();
        readonly Dictionary<int, PassengerPose> previousPoses = new Dictionary<int, PassengerPose>();
        readonly Dictionary<int, PassengerPose> lastTickPoses = new Dictionary<int, PassengerPose>();
        IPassengerPoseFeed lastFeed;
        State lastTickState;
        long lastTick = long.MinValue;
        long lastEpoch = long.MinValue;
        bool hasTick;
        State newest;
        int serial;

        public string Role => "actors";
        public PassengerCrowdView View => newest?.View;
        public int VisibleActors => newest?.View != null ? newest.View.VisibleActors : 0;
        public int Spawned => newest?.View != null ? newest.View.Spawned : 0;
        /// <summary>Poses the bound feed published at the last tick (before eligibility).</summary>
        public int LastPoseSamples => newest != null ? newest.LastPoseSamples : 0;
        /// <summary>Visible poses handed to the view after interpolation and eligibility filtering.</summary>
        public int LastPresentedPoses => newest != null ? newest.LastPresentedPoses : 0;
        public bool CatalogueBound => newest != null && !newest.MissingCatalogue;
        /// <summary>The renderer of the active built world; the frame sink uses it.</summary>
        public static PassengerCrowdRenderer Current { get; private set; }

        public bool TryGetEyePose(int id, out Vector3 position, out float heading) {
            position = default;
            heading = 0;
            if (newest?.View == null || !newest.View.TryGetActor(id, out var actor)) return false;
            foreach (var pose in presented) {
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
            poses.Clear();
            bool published;
            try {
                published = feed.TryRead(poses);
            } catch (Exception error) {
                state.Context?.ReportUnresolved("passenger-feed-failed", "actor", "feed", error.Message);
                return;
            }
            if (!published) return;

            bool reset = !hasTick || clock.Epoch != lastEpoch || !ReferenceEquals(feed, lastFeed) ||
                !ReferenceEquals(state, lastTickState);
            if (reset) {
                if (hasTick && StationEditSession.SelectionKind == "agent") StationEditSession.ClearSelection();
                previousPoses.Clear();
                Copy(poses, previousPoses);
                lastTickPoses.Clear();
                Copy(poses, lastTickPoses);
                hasTick = true;
                lastFeed = feed;
                lastTickState = state;
            } else if (clock.Tick != lastTick) {
                // The tick advanced: what we saw last time becomes the previous member of
                // the pair and this frame becomes the current one.
                previousPoses.Clear();
                foreach (var pair in lastTickPoses) previousPoses[pair.Key] = pair.Value;
                lastTickPoses.Clear();
                Copy(poses, lastTickPoses);
            }
            lastTick = clock.Tick;
            lastEpoch = clock.Epoch;

            presented.Clear();
            float alpha = (float)clock.Fraction;
            for (int i = 0; i < poses.Count; i++) {
                var current = poses[i];
                // alpha 0 is the previous tick frame and alpha 1 the current one, the same
                // convention as `ModuleMotionDispatch` and the presented clock; a missing
                // or non-adjacent pair snaps to the current frame instead.
                if (alpha >= 1f || !current.Visible ||
                    !previousPoses.TryGetValue(current.SimId, out var prior) || !prior.Visible ||
                    !Adjacent(prior, current)) {
                    presented.Add(current);
                    continue;
                }
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
            view.Render(presented, clock.PresentationSeconds);
            UpdateSelectedRoute(state, feed as SessionPassengerFeed, clock.Tick);
            state.LastPoseSamples = poses.Count;
            state.LastPresentedPoses = view.PosedThisFrame;
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
                if (!feed.Session.Services.TryReadPassengerRoute(id, state.RoutePoints)) {
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
            route.SetPosition(0, actor.Root.transform.position + Vector3.up * .05f);
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

        static void Copy(List<PassengerPose> from, Dictionary<int, PassengerPose> to) {
            for (int i = 0; i < from.Count; i++) to[from[i].SimId] = from[i];
        }

        /// <summary>A continuous ground, ramp or lift sample belonging to the same passenger.</summary>
        static bool Adjacent(PassengerPose prior, PassengerPose current) {
            bool ground = IsOnFoot(prior.State) && IsOnFoot(current.State);
            bool ramp = current.RidePath != null &&
                (prior.RidePath == current.RidePath || prior.RidePath == null && IsOnFoot(prior.State));
            bool priorLift = prior.ServerId != null && prior.ServerId.StartsWith("lift:", StringComparison.Ordinal);
            bool currentLift = current.ServerId != null && current.ServerId.StartsWith("lift:", StringComparison.Ordinal);
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
            state == StationPassengerState.Walking || state == StationPassengerState.Queuing;

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
