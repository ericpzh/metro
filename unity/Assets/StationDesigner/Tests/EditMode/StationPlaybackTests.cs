using System.Collections.Generic;
using System.Reflection;
using Metro.App;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// Plan 13 §1, the playback contract: the host publishes the session's transport
    /// capability object as `payload.simulationCapabilities` beside `payload.clock`, and
    /// a `sim.*` command is acknowledged with the same state. Without the sibling the
    /// React adapter kept its all-false defaults and Space, Play and every speed button
    /// produced no command at all.
    /// </summary>
    public sealed class StationPlaybackTests {
        GameObject hostObject;
        StationGameHost host;

        [SetUp]
        public void SetUp() {
            hostObject = new GameObject(StationGameHost.ObjectName);
            host = hostObject.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            // A MonoBehaviour without `[ExecuteAlways]` gets no Awake in edit mode, and the
            // real host is the only place the router/coordinator/session exist.
            var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(awake, "StationGameHost.Awake exists");
            awake.Invoke(host, null);
            var result = host.NewStation(new JObject());
            Assert.IsTrue(result.Accepted, result.ToString());
        }

        [TearDown]
        public void TearDown() {
            if (hostObject != null) Object.DestroyImmediate(hostObject);
            hostObject = null;
            host = null;
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        static string Envelope(string type, JObject payload, string id = "c-1") => new JObject {
            ["schemaVersion"] = 2,
            ["id"] = id,
            ["sessionId"] = "s-playback",
            ["type"] = type,
            ["payload"] = payload,
        }.ToString(Formatting.None);

        StationSimulationSession Session => ((StationSimulationHost)host.Simulation).Session;

        [Test]
        public void TheStatePayloadCarriesTheSessionCapabilitiesBesideItsClock() {
            var payload = host.BuildStatePayload();
            Assert.IsNotNull(payload["clock"], "the clock is still published");
            var capabilities = payload["simulationCapabilities"] as JObject;
            Assert.IsNotNull(capabilities, "the shell cannot offer transport it cannot see");
            Assert.AreEqual(Session.SessionId, (string)capabilities["sessionId"], "the flags name their own session");
            foreach (var flag in new[] { "clock", "play", "speed", "seek", "restart", "serviceWindow" }) {
                Assert.IsTrue((bool)capabilities[flag], "the session honours " + flag);
            }
            Assert.AreEqual(23400.0, (double)payload["clock"]["simTimeSeconds"], 1e-9, "cold boot is 06:30");
            Assert.IsFalse((bool)payload["clock"]["playing"]);
            Assert.AreEqual(1, (int)payload["clock"]["speed"]);
            // The block is the same one the full simulation frame publishes: reusing the
            // session's serialization, not a second copy that could drift.
            var fromState = (JObject)capabilities.DeepClone();
            fromState.Remove("sessionId");
            var frame = JObject.Parse(Session.SnapshotJson());
            Assert.IsTrue(JToken.DeepEquals(fromState, frame["capabilities"]),
                "the state block and the simulation frame must advertise the same transports");
        }

        [Test]
        public void PlayAndSpeedAreAcknowledgedWithTheSameStateTheShellReads() {
            var before = host.BuildStatePayload();

            var playReply = JObject.Parse(host.SendForTest(Envelope("sim.play", new JObject { ["playing"] = true })));
            Assert.AreEqual("ack", (string)playReply["kind"], playReply.ToString());
            Assert.IsTrue((bool)playReply["payload"]["clock"]["playing"], "the ack carries the applied clock");
            Assert.IsNotNull(playReply["payload"]["simulationCapabilities"], "and the transport flags");

            host.Coordinator.Tick(1.0);
            Assert.AreEqual(23401.0, Session.Clock.SimTime, 1e-9, "one real second at 1x is one simulated second");
            Assert.AreEqual(1, (long)host.BuildStatePayload()["clock"]["tick"]);

            var speedReply = JObject.Parse(host.SendForTest(Envelope("sim.speed", new JObject { ["speed"] = 4 }, "c-2")));
            Assert.AreEqual("ack", (string)speedReply["kind"], speedReply.ToString());
            Assert.AreEqual(4, (int)speedReply["payload"]["clock"]["speed"]);
            host.Coordinator.Tick(1.0);
            Assert.AreEqual(23405.0, Session.Clock.SimTime, 1e-9, "4x steps four ticks in one real second");

            // An unsupported speed is refused by name and leaves the run alone.
            var reject = JObject.Parse(host.SendForTest(Envelope("sim.speed", new JObject { ["speed"] = 3 }, "c-3")));
            Assert.AreEqual("reject", (string)reject["kind"], reject.ToString());
            Assert.AreEqual("unsupported-speed", (string)reject["code"]);
            var after = host.BuildStatePayload();
            Assert.AreEqual(4, (int)after["clock"]["speed"], "a rejected speed never changes the run");
            Assert.AreEqual((int)before["clock"]["speed"], 1, "and the run started at 1x");
        }

        [Test]
        public void PausingStopsTheClockAtTheInstantItWasAcknowledged() {
            host.SendForTest(Envelope("sim.play", new JObject { ["playing"] = true }, "c-1"));
            host.Coordinator.Tick(1.0);
            double running = Session.Clock.SimTime;
            host.SendForTest(Envelope("sim.play", new JObject { ["playing"] = false }, "c-2"));
            // A paused session never accumulates: the sub-tick fraction is kept for the
            // presentation, but the paused real time is not banked into the clock.
            host.Coordinator.Tick(2.5);
            Assert.AreEqual(running, Session.Clock.SimTime, 1e-9, "a paused station does not advance");
            Assert.IsFalse((bool)host.BuildStatePayload()["clock"]["playing"]);
        }

        /// <summary>
        /// RCA 14 §5.1: the scheduler's sub-tick remainder is exposed to the host so the
        /// per-frame sinks can sample between two tick frames. It never advances the
        /// authoritative tick or clock.
        /// </summary>
        [Test]
        public void AFrameInsideATickPublishesItsPresentationFraction() {
            host.SendForTest(Envelope("sim.play", new JObject { ["playing"] = true }, "c-1"));
            var simulation = (StationSimulationHost)host.Simulation;
            host.Coordinator.Tick(0.4);
            Assert.AreEqual(0L, simulation.SimulationTick, "four tenths of a second is not a whole tick");
            Assert.AreEqual(0.4, simulation.PresentationFraction, 1e-9,
                "the render frame can sample 40% of the way across the tick interval");
            host.Coordinator.Tick(0.6);
            Assert.AreEqual(1L, simulation.SimulationTick, "the whole tick advanced once");
            Assert.AreEqual(0.0, simulation.PresentationFraction, 1e-9, "and the fraction settled at the boundary");
            Assert.IsNotNull(host.BuildStatePayload()["clock"], "the published clock is still the authoritative one");
        }
    }
}
