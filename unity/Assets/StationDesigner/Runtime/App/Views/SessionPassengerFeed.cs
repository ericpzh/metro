using System;
using System.Collections.Generic;
using Metro.App;
using Metro.Sim;
using Metro.View;
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

        public SessionPassengerFeed(StationSimulationSession session) {
            this.session = session ?? throw new ArgumentNullException(nameof(session));
            source = () => this.session;
        }

        public SessionPassengerFeed(Func<StationSimulationSession> source) {
            this.source = source ?? throw new ArgumentNullException(nameof(source));
        }

        /// <summary>The session this feed publishes, or null once it has been released.</summary>
        public StationSimulationSession Session => source();

        /// <summary>
        /// Fill the complete current actor set. False means "no crowd is published"
        /// and leaves the view's last frame in place (a released or absent
        /// session); true with an empty list means the station is serving nobody and
        /// the actors are hidden.
        /// </summary>
        public bool TryRead(List<PassengerPose> poses) {
            if (poses == null) return false;
            var current = source();
            if (current == null) return false;
            var frames = current.PassengerFrames();
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
            WalkDistance = frame.WalkDistance,
            WalkPhase = frame.WalkPhase,
            WalkWeight = frame.WalkWeight,
            Detail = PassengerDetail.Full,
            PreferredHand = 0,
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

        public StationCrowdStateContributor(Func<StationSimulationSession> source) {
            this.source = source ?? throw new ArgumentNullException(nameof(source));
        }

        public string Key => "crowd";

        public JObject BuildPayload(Metro.Build.StationDocument document, Metro.Build.StationIndex index) =>
            Build(source());

        /// <summary>The bounded crowd payload for one session, or null when there is none.</summary>
        public static JObject Build(StationSimulationSession session) {
            if (session == null) return null;
            var services = session.Services;
            if (services == null) return null;
            var frames = session.PassengerFrames();
            var gates = session.GateFrames();
            // The profile that is actually bound: the public scene has no catalogue, so
            // it truthfully reports `bound: false` and no recipe ids instead of inventing
            // a stand-in identity (H3's local/public separation, visible over the bridge).
            var catalogue = PassengerCatalogueAnchor.Resolve();
            int limit = services.Options.PublishedPassengerLimit;
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
                });
            }
            return new JObject {
                ["passengersTotal"] = frames.Length,
                ["published"] = published,
                ["queued"] = services.QueueTotal,
                ["gateQueue"] = services.GateQueueTotal,
                ["boarding"] = services.Onboard,
                ["spawned"] = services.Spawned,
                ["alighted"] = services.Alighted,
                ["exited"] = services.Exited,
                ["stuck"] = services.Stuck,
                ["catalogue"] = new JObject {
                    ["bound"] = catalogue != null,
                    ["count"] = catalogue != null ? catalogue.Count : 0,
                    ["rights"] = catalogue != null ? catalogue.rights : "",
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
                () => (stationHost.Simulation as StationSimulationHost)?.Session);
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
