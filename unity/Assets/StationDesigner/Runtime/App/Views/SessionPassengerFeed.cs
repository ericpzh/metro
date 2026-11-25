using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using Metro.App;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// The App half of packet C's crowd (plan 11 C3): reads the session's published
    /// passenger frames and hands them to <see cref="PassengerCrowdView"/> as plain
    /// <see cref="PassengerPose"/> samples. One pose per published passenger, every
    /// frame, in id order — the view spawns the body, selects the recipe from the
    /// id and poses it; nothing here invents a passenger the sim did not publish.
    ///
    /// A feed is bound to exactly one session. A station switch replaces the feed
    /// (see <see cref="StationSimulationHost"/>), so a released session can never
    /// publish into the next station's crowd.
    /// </summary>
    public sealed class SessionPassengerFeed : IPassengerPoseFeed {
        readonly Func<StationSimulationSession> source;
        readonly StationSimulationSession session;
        readonly StationSimulationHost simHost;

        public SessionPassengerFeed(StationSimulationSession session) {
            this.session = session ?? throw new ArgumentNullException(nameof(session));
            source = () => this.session;
        }

        public SessionPassengerFeed(StationSimulationHost host, StationSimulationSession session) {
            simHost = host;
            this.session = session ?? throw new ArgumentNullException(nameof(session));
            source = () => this.session;
        }

        public SessionPassengerFeed(Func<StationSimulationSession> source) {
            this.source = source ?? throw new ArgumentNullException(nameof(source));
        }

        /// <summary>The session this feed publishes, or null once it has been released.</summary>
        public StationSimulationSession Session => source();
        /// <summary>The simulation host owning this session, when bound through a host.</summary>
        public StationSimulationHost SimHost => simHost;

        /// <summary>
        /// Fill the complete current actor set. False means "no crowd is published"
        /// and leaves the view's last frame in place (a released or absent
        /// session); true with an empty list means the station is serving nobody and
        /// the actors are hidden.
        /// </summary>
        public bool TryRead(List<PassengerPose> poses) {
            if (poses == null) return false;
            StationPassengerFrame[] frames;
            if (simHost != null) {
                var published = simHost.PublishedFrame;
                if (published == null) return false;
                frames = published.Motion.Passengers;
            } else {
                var current = source();
                if (current == null) return false;
                frames = current.PassengerFrames();
            }
            poses.Clear();
            if (frames == null) return true;
            for (int i = 0; i < frames.Length; i++) poses.Add(Map(frames[i]));
            return true;
        }

        /// <summary>One published frame as the view's pose contract.</summary>
        public static PassengerPose Map(StationPassengerFrame frame) => new PassengerPose {
            SimId = frame.SimId,
            X = frame.X,
            Y = frame.Y,
            Z = frame.Z,
            Heading = frame.Heading,
            // The sim publishes the source's own activity index; the enums are the
            // same atlas order, and this is the one place they cross assemblies.
            Activity = (PassengerActivity)frame.Activity,
            ActivitySeconds = frame.ActivitySeconds,
            RidePath = frame.RidePath,
            RideProgress = frame.RideProgress,
            RideSeconds = frame.RideSeconds,
            RideColumn = frame.RideColumn,
            RideReverse = frame.RideReverse,
            RailVariant = frame.RailVariant,
            WalkDistance = frame.WalkDistance,
            WalkPhase = frame.WalkPhase,
            WalkWeight = frame.WalkWeight,
            HasWalkWeight = true,
            Detail = PassengerDetail.Full,
            PreferredHand = 0,
            State = frame.State,
            ServerId = frame.ServerId ?? "",
            Visible = frame.Visible,
        };
    }

    /// <summary>
    /// The committed session's crowd in the host's state frame: bounded passenger
    /// and gate arrays (never the document) plus the counts a panel may print.
    /// Bounded because a station can hold thousands of bodies and a state reply is
    /// coalesced and sent many times a second.
    /// </summary>
    public sealed class StationCrowdStateContributor : IStationStateContributor {
        readonly Func<StationSimulationSession> source;
        readonly Func<StationSimulationHost> hostSource;

        public StationCrowdStateContributor(Func<StationSimulationSession> source) {
            this.source = source ?? throw new ArgumentNullException(nameof(source));
        }

        public StationCrowdStateContributor(Func<StationSimulationHost> hostSource) {
            this.hostSource = hostSource ?? throw new ArgumentNullException(nameof(hostSource));
            source = () => this.hostSource()?.Session;
        }

        public string Key => "crowd";

        public JObject BuildPayload(Metro.Build.StationDocument document, Metro.Build.StationIndex index) {
            var simHost = hostSource != null
                ? hostSource()
                : StationGameHost.ResolveActive()?.Simulation as StationSimulationHost;
            if (simHost != null && (hostSource != null || ReferenceEquals(simHost.Session, source()))) {
                var published = simHost.PublishedFrame;
                if (published != null) {
                    return Build(published);
                }
                return simHost.WithSessionLock(s => Build(s));
            }
            return Build(source());
        }

        /// <summary>The bounded crowd payload from an immutable published simulation frame, or null when absent.</summary>
        public static JObject Build(StationPublishedSimFrame published) {
            if (published == null || !published.HasServices) return null;
            return BuildCore(
                published.Motion.Passengers ?? Array.Empty<StationPassengerFrame>(),
                published.Motion.Gates ?? Array.Empty<StationGateFrame>(),
                published.PublishedPassengerLimit,
                published.QueuedTotal,
                published.GateQueueTotal,
                published.BoardedOnboard,
                published.Spawned,
                published.Boarded,
                published.Alighted,
                published.Exited,
                published.Stuck);
        }

        /// <summary>
        /// Zero-JObject streaming JSON writer matching <see cref="Build(StationPublishedSimFrame)"/>
        /// field-for-field so 10 Hz state publishes avoid thousands of temporary JObject/JArray allocations.
        /// </summary>
        public static string BuildJson(StationPublishedSimFrame published, StringBuilder scratch = null) {
            if (published == null || !published.HasServices) return null;
            var frames = published.Motion.Passengers ?? Array.Empty<StationPassengerFrame>();
            var gates = published.Motion.Gates ?? Array.Empty<StationGateFrame>();
            int limit = published.PublishedPassengerLimit;
            var catalogue = PassengerCatalogueAnchor.Resolve();
            int publishedCount = limit <= 0 ? frames.Length : Math.Min(frames.Length, limit);
            var crowdRenderer = PassengerCrowdRenderer.Current;
            int boundModels = crowdRenderer != null ? crowdRenderer.Spawned : 0;
            int visibleActors = crowdRenderer != null ? crowdRenderer.VisibleActors : 0;
            int poseSamples = crowdRenderer != null ? crowdRenderer.LastPoseSamples : 0;
            int presented = crowdRenderer != null ? crowdRenderer.LastPresentedPoses : 0;

            var sb = scratch ?? new StringBuilder(8192);
            sb.Clear();
            int eligible = 0;
            using (var sw = new StringWriter(sb, CultureInfo.InvariantCulture))
            using (var w = new JsonTextWriter(sw) { Formatting = Formatting.None }) {
                w.WriteStartObject();
                w.WritePropertyName("passengersTotal"); w.WriteValue(frames.Length);
                w.WritePropertyName("published"); w.WriteValue(publishedCount);
                w.WritePropertyName("queued"); w.WriteValue(published.QueuedTotal);
                w.WritePropertyName("gateQueue"); w.WriteValue(published.GateQueueTotal);
                w.WritePropertyName("boarding"); w.WriteValue(published.BoardedOnboard);
                w.WritePropertyName("spawned"); w.WriteValue(published.Spawned);
                w.WritePropertyName("boarded"); w.WriteValue(published.Boarded);
                w.WritePropertyName("alighted"); w.WriteValue(published.Alighted);
                w.WritePropertyName("exited"); w.WriteValue(published.Exited);
                w.WritePropertyName("stuck"); w.WriteValue(published.Stuck);
                w.WritePropertyName("catalogue");
                w.WriteStartObject();
                w.WritePropertyName("bound"); w.WriteValue(catalogue != null);
                w.WritePropertyName("count"); w.WriteValue(catalogue != null ? catalogue.Count : 0);
                w.WritePropertyName("rights"); w.WriteValue(catalogue != null ? catalogue.rights ?? "" : "");
                w.WriteEndObject();
                w.WritePropertyName("passengers");
                w.WriteStartArray();
                for (int i = 0; i < publishedCount; i++) {
                    var frame = frames[i];
                    var look = catalogue != null ? PassengerAppearance.Look(catalogue, frame.SimId) : default;
                    if (catalogue != null && catalogue.TryGetForSimId(frame.SimId, out _)) eligible++;
                    w.WriteStartObject();
                    w.WritePropertyName("id"); w.WriteValue(frame.SimId);
                    w.WritePropertyName("x"); w.WriteValue(frame.X);
                    w.WritePropertyName("y"); w.WriteValue(frame.Y);
                    w.WritePropertyName("z"); w.WriteValue(frame.Z);
                    w.WritePropertyName("heading"); w.WriteValue(frame.Heading);
                    w.WritePropertyName("activity"); w.WriteValue(StationServiceText.ActivityText(frame.Activity));
                    w.WritePropertyName("activitySeconds"); w.WriteValue(frame.ActivitySeconds);
                    w.WritePropertyName("walkDistance"); w.WriteValue(frame.WalkDistance);
                    w.WritePropertyName("walkPhase"); w.WriteValue(frame.WalkPhase);
                    w.WritePropertyName("walkWeight"); w.WriteValue(frame.WalkWeight);
                    w.WritePropertyName("state"); w.WriteValue(StationServiceText.PassengerStateText(frame.State));
                    w.WritePropertyName("server"); w.WriteValue(frame.ServerId ?? "");
                    w.WritePropertyName("visible"); w.WriteValue(frame.Visible);
                    w.WritePropertyName("recipe"); w.WriteValue(look.Recipe ?? "");
                    w.WritePropertyName("child"); w.WriteValue(look.IsChild);
                    w.WriteEndObject();
                }
                w.WriteEndArray();
                w.WritePropertyName("models");
                w.WriteStartObject();
                w.WritePropertyName("samples"); w.WriteValue(poseSamples);
                w.WritePropertyName("published"); w.WriteValue(presented);
                w.WritePropertyName("eligible"); w.WriteValue(eligible);
                w.WritePropertyName("bound"); w.WriteValue(boundModels);
                w.WritePropertyName("visible"); w.WriteValue(visibleActors);
                w.WritePropertyName("reason");
                w.WriteValue(catalogue == null
                    ? "passenger-catalogue-missing"
                    : eligible == 0 ? "no-eligible-recipe" : "");
                w.WriteEndObject();
                w.WritePropertyName("gates");
                w.WriteStartArray();
                for (int i = 0; i < gates.Length; i++) {
                    var gate = gates[i];
                    w.WriteStartObject();
                    w.WritePropertyName("id"); w.WriteValue(gate.Id);
                    w.WritePropertyName("server"); w.WriteValue(gate.Server);
                    w.WritePropertyName("queue"); w.WriteValue(gate.Queue);
                    w.WritePropertyName("served"); w.WriteValue(gate.Served);
                    w.WritePropertyName("rate"); w.WriteValue(gate.Rate);
                    w.WritePropertyName("batch"); w.WriteValue(gate.Batch);
                    w.WritePropertyName("cycle"); w.WriteValue(gate.Cycle);
                    w.WritePropertyName("state"); w.WriteValue(StationServiceText.GateStateText(gate.State));
                    w.WritePropertyName("mode"); w.WriteValue(StationServiceText.GateModeText(gate.Mode));
                    w.WritePropertyName("lane"); w.WriteValue(gate.Lane);
                    w.WritePropertyName("open"); w.WriteValue(gate.Open);
                    w.WriteEndObject();
                }
                w.WriteEndArray();
                w.WriteEndObject();
            }
            return sb.ToString();
        }

        /// <summary>The bounded crowd payload for one session, or null when there is none.</summary>
        public static JObject Build(StationSimulationSession session) =>
            Build(session, null, null);

        static JObject Build(StationSimulationSession session,
            StationPassengerFrame[] cachedFrames, StationGateFrame[] cachedGates) {
            if (session == null) return null;
            var services = session.Services;
            if (services == null) return null;
            var frames = cachedFrames ?? session.PassengerFrames() ?? Array.Empty<StationPassengerFrame>();
            var gates = cachedGates ?? session.GateFrames() ?? Array.Empty<StationGateFrame>();
            int limit = services.Options != null ? services.Options.PublishedPassengerLimit : 0;
            return BuildCore(
                frames,
                gates,
                limit,
                services.QueueTotal,
                services.GateQueueTotal,
                services.Onboard,
                services.Spawned,
                services.Boarded,
                services.Alighted,
                services.Exited,
                services.Stuck);
        }

        static JObject BuildCore(
            StationPassengerFrame[] frames,
            StationGateFrame[] gates,
            int limit,
            int queuedTotal,
            int gateQueueTotal,
            int onboard,
            int spawned,
            int boarded,
            int alighted,
            int exited,
            int stuck) {
            // The profile that is actually bound: the public scene has no catalogue, so
            // it truthfully reports `bound: false` and no recipe ids instead of inventing
            // a stand-in identity (H3's local/public separation, visible over the bridge).
            var catalogue = PassengerCatalogueAnchor.Resolve();
            int published = limit <= 0 ? frames.Length : Math.Min(frames.Length, limit);
            var passengers = new JArray();
            for (int i = 0; i < published; i++) {
                var frame = frames[i];
                var look = catalogue != null ? PassengerAppearance.Look(catalogue, frame.SimId) : default;
                passengers.Add(new JObject {
                    ["id"] = frame.SimId,
                    ["x"] = frame.X, ["y"] = frame.Y, ["z"] = frame.Z,
                    ["heading"] = frame.Heading,
                    ["activity"] = StationServiceText.ActivityText(frame.Activity),
                    ["activitySeconds"] = frame.ActivitySeconds,
                    ["walkDistance"] = frame.WalkDistance,
                    ["walkPhase"] = frame.WalkPhase,
                    ["walkWeight"] = frame.WalkWeight,
                    ["state"] = StationServiceText.PassengerStateText(frame.State),
                    ["server"] = frame.ServerId ?? "",
                    ["visible"] = frame.Visible,
                    // The recipe the renderer selected from this id, empty in the public
                    // profile where no internal catalogue is bound.
                    ["recipe"] = look.Recipe ?? "",
                    ["child"] = look.IsChild,
                });
            }
            var gateRows = new JArray();
            for (int i = 0; i < gates.Length; i++) {
                var gate = gates[i];
                gateRows.Add(new JObject {
                    ["id"] = gate.Id,
                    ["server"] = gate.Server,
                    ["queue"] = gate.Queue,
                    ["served"] = gate.Served,
                    ["rate"] = gate.Rate,
                    ["batch"] = gate.Batch,
                    ["cycle"] = gate.Cycle,
                    ["state"] = StationServiceText.GateStateText(gate.State),
                    ["mode"] = StationServiceText.GateModeText(gate.Mode),
                    ["lane"] = gate.Lane,
                    ["open"] = gate.Open,
                });
            }
            // The visible-model chain, reported separately from the logical crowd so a
            // public-safe pack (no 3D catalogue) still proves spawns, boardings and
            // alightings. Each stage is a real count, never a copy of the previous one:
            // session passengers → pose samples → eligible recipes → bound models →
            // visible actors.
            var crowdRenderer = PassengerCrowdRenderer.Current;
            int boundModels = crowdRenderer != null ? crowdRenderer.Spawned : 0;
            int visibleActors = crowdRenderer != null ? crowdRenderer.VisibleActors : 0;
            int poseSamples = crowdRenderer != null ? crowdRenderer.LastPoseSamples : 0;
            int presented = crowdRenderer != null ? crowdRenderer.LastPresentedPoses : 0;
            int eligible = 0;
            if (catalogue != null) {
                for (int i = 0; i < published; i++)
                    if (catalogue.TryGetForSimId(frames[i].SimId, out _)) eligible++;
            }
            return new JObject {
                ["passengersTotal"] = frames.Length,
                ["published"] = published,
                ["queued"] = queuedTotal,
                ["gateQueue"] = gateQueueTotal,
                ["boarding"] = onboard,
                ["spawned"] = spawned,
                ["boarded"] = boarded,
                ["alighted"] = alighted,
                ["exited"] = exited,
                ["stuck"] = stuck,
                ["catalogue"] = new JObject {
                    ["bound"] = catalogue != null,
                    ["count"] = catalogue != null ? catalogue.Count : 0,
                    ["rights"] = catalogue != null ? catalogue.rights : "",
                },
                ["models"] = new JObject {
                    ["samples"] = poseSamples,
                    ["published"] = presented,
                    ["eligible"] = eligible,
                    ["bound"] = boundModels,
                    ["visible"] = visibleActors,
                    ["reason"] = catalogue == null
                        ? "passenger-catalogue-missing"
                        : eligible == 0 ? "no-eligible-recipe" : "",
                },
                ["passengers"] = passengers,
                ["gates"] = gateRows,
            };
        }
    }

    /// <summary>
    /// Packet C's process-wide registration for the crowd state frame. Like packet
    /// D's view feature, it finds the scene's host after the scene loads and adds
    /// its `crowd` contributor, so the shared host keeps one merge path and no
    /// packet edits it.
    ///
    /// **Never a one-shot miss.** A host that is not there yet (a scene still
    /// loading, a scene opened after the hook, a scene switch) is watched by a
    /// small persistent bootstrap, because a state frame that silently loses the
    /// crowd block would make two identical runs hash differently.
    /// </summary>
    public static class PassengerServiceFeature {
        static StationGameHost host;
        static StationCrowdStateContributor contributor;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Install() {
            var found = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            if (found) Attach(found);
            var bootstrap = new GameObject("PassengerServiceBootstrap");
            bootstrap.hideFlags = HideFlags.HideAndDontSave;
            UnityEngine.Object.DontDestroyOnLoad(bootstrap);
            bootstrap.AddComponent<PassengerServiceBootstrap>();
        }

        /// <summary>Bind the crowd state frame to one host. Re-attaching the same host is a no-op.</summary>
        public static void Attach(StationGameHost stationHost) {
            if (!stationHost) return;
            if (host == stationHost && contributor != null) return;
            host = stationHost;
            contributor = new StationCrowdStateContributor(
                () => stationHost.Simulation as StationSimulationHost);
            stationHost.RegisterStateContributor(contributor);
        }

        /// <summary>The feed for the committed session, or null while nothing is committed.</summary>
        public static IPassengerPoseFeed Feed() {
            if (!host) return null;
            var session = (host.Simulation as StationSimulationHost)?.Session;
            return session == null ? null : new SessionPassengerFeed(session);
        }
    }

    /// <summary>
    /// Waits for a <see cref="StationGameHost"/> and binds the crowd contributor to
    /// it (and to a new host after a scene switch). One check a second, so it costs
    /// nothing while a station runs.
    /// </summary>
    sealed class PassengerServiceBootstrap : MonoBehaviour {
        StationGameHost bound;
        float nextCheck;

        void Update() {
            if (Time.unscaledTime < nextCheck) return;
            nextCheck = Time.unscaledTime + 1f;
            var found = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            if (!found || found == bound) return;
            bound = found;
            PassengerServiceFeature.Attach(found);
        }
    }
}
