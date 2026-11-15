using System;
using System.Collections.Generic;
using Metro.App;
using Metro.Build;
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
        public PassengerDetail Detail;
        /// <summary>0 default, 1 right hand, 2 left hand (the source's preferred mode).</summary>
        public int PreferredHand;
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

        readonly Dictionary<int, PassengerCrowdActor> actors = new Dictionary<int, PassengerCrowdActor>();
        readonly HashSet<int> seen = new HashSet<int>();
        readonly List<Diagnostic> diagnostics = new List<Diagnostic>();
        readonly HashSet<string> reported = new HashSet<string>(StringComparer.Ordinal);
        PassengerCatalogue catalogue;
        Action<PassengerCrowdActor, PassengerPose> spawned;
        Action<Diagnostic> reportedTo;

        public int Spawned => actors.Count;
        public int VisibleActors { get; private set; }
        public int PosedThisFrame { get; private set; }
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

        public bool TryGetActor(int simId, out PassengerCrowdActor actor) => actors.TryGetValue(simId, out actor);

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
            VisibleActors = 0;
            if (poses != null) {
                for (int i = 0; i < poses.Count; i++) {
                    var pose = poses[i];
                    if (!pose.Visible) { Hide(pose.SimId); continue; }
                    var actor = GetOrSpawn(pose);
                    if (actor == null) continue;
                    Pose(actor, pose);
                }
            }
            // The feed publishes a complete frame: an actor that left the frame is
            // removed from view this frame (replay must not leave stale bodies).
            var gone = new List<int>();
            foreach (var pair in actors) {
                if (!seen.Contains(pair.Key)) gone.Add(pair.Key);
            }
            for (int i = 0; i < gone.Count; i++) Hide(gone[i]);
        }

        PassengerCrowdActor GetOrSpawn(PassengerPose pose) {
            if (actors.TryGetValue(pose.SimId, out var existing)) return existing;
            if (!catalogue.TryGetForSimId(pose.SimId, out var entry)) {
                Diagnose("passenger-recipe-missing", pose.SimId,
                    "no eligible recipe for this stable identity; the stand-in is not used");
                return null;
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
            // overwrite the sample on its own update.
            animation.enabled = false;
            var actor = new PassengerCrowdActor {
                SimId = pose.SimId, Recipe = entry.recipe, Root = root, Rig = animation.gameObject,
                LegacyAnimation = animation, Skin = skin, Entry = entry,
                Look = PassengerAppearance.Look(catalogue, pose.SimId, pose.Detail),
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
            ApplyTone(actor);
            actors[pose.SimId] = actor;
            actor.Root.SetActive(false);
            if (pose.Detail == PassengerDetail.Low)
                Diagnose("low-topology-unported", pose.SimId, "Low mesh is not rendered; Full topology is shown");
            return actor;
        }

        void Pose(PassengerCrowdActor actor, PassengerPose pose) {
            seen.Add(actor.SimId);
            actor.Visible = true;
            if (!actor.Root.activeSelf) actor.Root.SetActive(true);
            actor.Root.transform.position = StationCoordinates.Point(new Vector3((float)pose.X, (float)pose.Y, (float)pose.Z));
            actor.Root.transform.rotation = PassengerAppearance.Rotation(pose.Heading);
            actor.Root.transform.localScale = PassengerAppearance.LocalScale(actor.Look);

            var activity = PassengerAppearance.DisplayedActivity(pose.Activity, actor.Entry, pose.ActivitySeconds);
            int hand = PassengerAppearance.ActionMode(pose.SimId, actor.Entry, activity, pose.PreferredHand);
            string clipName;
            float time;
            if (activity == PassengerActivity.Walk) {
                var gait = PassengerAppearance.Gait(actor.Look, pose.WalkDistance, pose.WalkPhase, pose.WalkWeight);
                // Published weight owns the idle/walk transition. An unpublished weight
                // (0) follows the activity, so the minimal pose contract still walks.
                bool stand = pose.WalkWeight > 1e-6 && pose.WalkWeight <= 0.5;
                if (stand) {
                    // The source blends the idle and walk atlas frames by this weight.
                    // A single sampled clip cannot mix two rigs; below the halfway
                    // point the passenger is standing, above it the travel-driven
                    // walk clip owns the pose at the exact TS frame time.
                    clipName = "Idle";
                    time = 0f;
                } else {
                    clipName = PassengerAppearance.WalkClipName(actor.Look.WalkProfile);
                    time = (float)gait.SampleTime;
                }
            } else {
                clipName = PassengerAppearance.ClipName(activity, actor.Look.WalkProfile, hand);
                var candidate = actor.Clips.TryGetValue(clipName, out var clip) ? clip : null;
                time = (float)PassengerAppearance.ActivitySampleTime(activity, pose.ActivitySeconds, candidate ? candidate.length : 0f);
            }
            if (!actor.Clips.TryGetValue(clipName, out var chosen) || chosen == null) {
                Diagnose("passenger-clip-missing", pose.SimId, actor.Recipe + " has no clip " + clipName);
                HideActor(actor);
                return;
            }
            if (!actor.Root.activeSelf) actor.Root.SetActive(true);
            chosen.SampleAnimation(actor.Rig, time);
            actor.ClipName = clipName;
            actor.ClipTime = time;
            actor.Sampled = true;
            PosedThisFrame++;
            VisibleActors++;
            if (!actor.Registered) {
                actor.Registered = true;
                spawned?.Invoke(actor, pose);
            }
        }

        void Hide(int simId) {
            if (actors.TryGetValue(simId, out var actor)) HideActor(actor);
        }

        static void HideActor(PassengerCrowdActor actor) {
            actor.Visible = false;
            if (actor.Root != null && actor.Root.activeSelf) actor.Root.SetActive(false);
        }

        public void HideAll() {
            foreach (var actor in actors.Values) HideActor(actor);
            VisibleActors = 0;
        }

        void ApplyTone(PassengerCrowdActor actor) {
            double tone = actor.Look.Tone;
            if (Math.Abs(tone - 1.0) < 1e-9) return;
            var materials = actor.Skin.sharedMaterials;
            if (materials == null || materials.Length == 0) return;
            // glTFast's URP materials expose the glTF name `baseColorFactor`; the
            // built-in path and a hand-authored URP material use `_BaseColor`.
            int gltfBase = Shader.PropertyToID("baseColorFactor");
            int baseColor = Shader.PropertyToID("_BaseColor");
            int color = Shader.PropertyToID("_Color");
            var block = new MaterialPropertyBlock();
            for (int i = 0; i < materials.Length; i++) {
                var material = materials[i];
                if (material == null) continue;
                int property = -1;
                if (material.HasProperty(gltfBase)) property = gltfBase;
                else if (material.HasProperty(baseColor)) property = baseColor;
                else if (material.HasProperty(color)) property = color;
                if (property < 0) continue;
                var original = material.GetColor(property);
                var tinted = new Color(original.r * (float)tone, original.g * (float)tone,
                    original.b * (float)tone, original.a);
                block.Clear();
                block.SetColor(property, tinted);
                // One material index at a time: a raw outfit colour must not be
                // replaced by another region's colour.
                actor.Skin.SetPropertyBlock(block, i);
            }
        }

        void Diagnose(string code, int simId, string detail) {
            string key = code + "|" + simId + "|" + detail;
            if (!reported.Add(key)) return;
            var diagnostic = new Diagnostic { Code = code, SimId = simId, Detail = detail };
            diagnostics.Add(diagnostic);
            reportedTo?.Invoke(diagnostic);
        }

        public void Release() {
            foreach (var actor in actors.Values) {
                if (actor.Root != null) DestroyNow(actor.Root);
            }
            actors.Clear();
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
            actors.Clear();
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
    public sealed class PassengerCrowdRenderer : IStationViewRenderer {
        sealed class State {
            public StationWorldView World;
            public PassengerCrowdView View;
            public StationViewBuildContext Context;
            public int Serial;
            public bool MissingCatalogue;
        }

        readonly Dictionary<StationWorldView, State> states = new Dictionary<StationWorldView, State>();
        readonly List<PassengerPose> poses = new List<PassengerPose>();
        readonly List<PassengerPose> presented = new List<PassengerPose>();
        readonly Dictionary<int, PassengerPose> previousPoses = new Dictionary<int, PassengerPose>();
        readonly Dictionary<int, PassengerPose> lastTickPoses = new Dictionary<int, PassengerPose>();
        IPassengerPoseFeed lastFeed;
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
        public int LastPoseSamples { get; private set; }
        /// <summary>Visible poses handed to the view after interpolation and eligibility filtering.</summary>
        public int LastPresentedPoses { get; private set; }
        public bool CatalogueBound => newest != null && !newest.MissingCatalogue;
        /// <summary>The renderer of the active built world; the frame sink uses it.</summary>
        public static PassengerCrowdRenderer Current { get; private set; }

        public void Build(StationViewBuildContext context) {
            var state = new State { World = context.World, Context = context, Serial = ++serial };
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
                (actor, pose) => Register(context, actor, pose),
                diagnostic => context.ReportUnresolved(diagnostic.Code, "actor", "passenger:" + diagnostic.SimId, diagnostic.Detail));
        }

        void Register(StationViewBuildContext context, PassengerCrowdActor actor, PassengerPose pose) {
            if (context == null || actor == null || actor.Root == null) return;
            var look = actor.Look;
            var mesh = actor.Skin != null ? actor.Skin.sharedMesh : null;
            // The imported mesh is Y-up with X lateral and Z fore/aft: its bind-pose
            // local bounds scaled by the displayed factors are the actor's document box.
            var bounds = mesh != null ? mesh.bounds : new Bounds(new Vector3(0, 0.87f, 0.03f), new Vector3(1.61f, 1.74f, 0.50f));
            int level = StationCoordinates.StoreyBand(pose.Z, context.Document?.LevelBase ?? 0);
            context.World.RegisterModule(Role, "passenger:" + actor.SimId, actor.Root, "actor",
                new StationBox(
                    pose.X + bounds.min.x * look.Width, pose.Y + bounds.min.z * look.Depth, pose.Z + bounds.min.y * look.Height,
                    pose.X + bounds.max.x * look.Width, pose.Y + bounds.max.z * look.Depth, pose.Z + bounds.max.y * look.Height),
                level, level);
        }

        /// <summary>
        /// One committed simulation frame. The clock is packet C's; the actors are
        /// whatever the bound feed publishes. A missing feed keeps the last frame
        /// (pause/replay must not blink) and a feed that has no crowd publishes an
        /// empty list, which hides the actors.
        ///
        /// The feed publishes one pose per passenger per fixed tick. A rendered frame
        /// that falls inside the tick interval samples the adjacent tick pair at the
        /// scheduler fraction, so the crowd walks continuously instead of stepping once
        /// a simulated second (RCA 14 §5.3). A passenger that is new, changed activity,
        /// or moved further than a walk could in one tick snaps rather than gliding
        /// from an unrelated identity.
        /// </summary>
        public void Tick(StationDocument document, StationIndex index, StationFrameClock clock) {
            var state = newest;
            var view = state?.View;
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
                    view = state.View = PassengerCrowdView.Build(state.Context.RoleRoot(Role), catalogue,
                        (actor, pose) => Register(state.Context, actor, pose),
                        diagnostic => state.Context.ReportUnresolved(diagnostic.Code, "actor",
                            "passenger:" + diagnostic.SimId, diagnostic.Detail));
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

            bool reset = !hasTick || clock.Epoch != lastEpoch || !ReferenceEquals(feed, lastFeed);
            if (reset) {
                previousPoses.Clear();
                Copy(poses, previousPoses);
                lastTickPoses.Clear();
                Copy(poses, lastTickPoses);
                hasTick = true;
                lastFeed = feed;
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
                blend.ActivitySeconds = Lerp(prior.ActivitySeconds, current.ActivitySeconds, alpha);
                blend.WalkDistance = Lerp(prior.WalkDistance, current.WalkDistance, alpha);
                blend.WalkPhase = Lerp(prior.WalkPhase, current.WalkPhase, alpha);
                blend.WalkWeight = Lerp(prior.WalkWeight, current.WalkWeight, alpha);
                presented.Add(blend);
            }
            view.Render(presented, clock.PresentationSeconds);
            LastPoseSamples = poses.Count;
            LastPresentedPoses = presented.Count;
        }

        static void Copy(List<PassengerPose> from, Dictionary<int, PassengerPose> to) {
            for (int i = 0; i < from.Count; i++) to[from[i].SimId] = from[i];
        }

        /// <summary>Same actor, same activity, and a step a walking body could take.</summary>
        static bool Adjacent(PassengerPose prior, PassengerPose current) {
            if (prior.Activity != current.Activity) return false;
            double dx = current.X - prior.X, dy = current.Y - prior.Y, dz = current.Z - prior.Z;
            // A storey step or a spawn/board teleport is not an interpolatable move. A
            // 4 Hz walker covers well under two metres in one simulated second.
            return dz * dz < .75 * .75 && dx * dx + dy * dy < 3.0 * 3.0;
        }

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
