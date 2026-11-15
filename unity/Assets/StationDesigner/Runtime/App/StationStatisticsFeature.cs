using System;
using Metro.Build;
using Metro.Sim;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// Publishes <c>state.statistics</c> in every player <c>state</c>, commit and resync
    /// payload so both WebGL and <c>StationDesktopUiPresenter</c> observe the active
    /// statistics run, live metrics snapshot, and history watermark without shipping the
    /// full history buffer in ordinary state frames.
    /// </summary>
    public sealed class StationStatisticsStateContributor : IStationStateContributor {
        public const string ContributorKey = "statistics";

        readonly Func<StationSimulationSession> sessionSource;

        public StationStatisticsStateContributor(Func<StationSimulationSession> sessionSource) {
            this.sessionSource = sessionSource ?? throw new ArgumentNullException(nameof(sessionSource));
        }

        public string Key => ContributorKey;

        public JObject BuildPayload(StationDocument document, StationIndex index) {
            var session = sessionSource();
            if (session == null || document == null) {
                return UnavailablePayload();
            }
            var m = session.Statistics;
            var h = session.History;
            return new JObject {
                ["available"] = true,
                ["runId"] = session.StatisticsRunId ?? "",
                ["metrics"] = BuildMetricsPayload(in m),
                ["history"] = new JObject {
                    ["count"] = h.Count,
                    ["start"] = h.Start,
                    ["step"] = h.Step,
                    ["stride"] = StationStatisticsHistory.Stride,
                },
            };
        }

        public static JObject UnavailablePayload() => new JObject {
            ["available"] = false,
            ["runId"] = "",
            ["metrics"] = JValue.CreateNull(),
            ["history"] = new JObject {
                ["count"] = 0,
                ["start"] = 0,
                ["step"] = StationStatisticsHistory.SampleSeconds,
                ["stride"] = StationStatisticsHistory.Stride,
            },
        };

        public static JObject BuildMetricsPayload(in StationStatisticsSnapshot m) => new JObject {
            ["tick"] = m.Tick,
            ["simTime"] = m.SimTime,
            ["population"] = m.Population,
            ["crowdLos"] = string.IsNullOrEmpty(m.CrowdLos) ? "A" : m.CrowdLos,
            ["leftBehind"] = m.LeftBehind,
            ["boarded"] = m.Boarded,
            ["alighted"] = m.Alighted,
            ["exited"] = m.Exited,
            ["trainArrivals"] = m.TrainArrivals,
            ["trainsLate"] = m.TrainsLate,
            ["gateQueue"] = m.GateQueue,
            ["escalatorQueue"] = m.EscalatorQueue,
            ["liftQueue"] = m.LiftQueue,
            ["doorQueue"] = m.DoorQueue,
            ["period"] = string.IsNullOrEmpty(m.Period) ? "offpeak" : m.Period,
            ["agentsCap"] = m.AgentsCap,
            ["tickMs"] = m.TickMs,
            ["stuck"] = m.Stuck,
        };
    }

    /// <summary>
    /// Handles <c>stats.history</c> paginated reads against the active simulation session.
    /// Caps each read at <see cref="MaxPageRows"/> rows, validates run identity and bounds,
    /// and never mutates the document revision.
    /// </summary>
    public sealed class StationStatisticsCommandHandler : IStationCommandHandler {
        public const string CapabilityName = "stationStatistics";
        public const string HistoryCommandType = "stats.history";
        public const int MaxPageRows = 128;

        readonly Func<StationSimulationSession> sessionSource;

        public int RequestsServed { get; private set; }
        public int LastServedRows { get; private set; }
        public string LastServedRunId { get; private set; } = "";

        public StationStatisticsCommandHandler(Func<StationSimulationSession> sessionSource) {
            this.sessionSource = sessionSource ?? throw new ArgumentNullException(nameof(sessionSource));
        }

        public string Capability => CapabilityName;

        public bool Handles(string type) =>
            string.Equals(type, HistoryCommandType, StringComparison.Ordinal);

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (command == null || !Handles(command.Type)) return false;

            var session = sessionSource();
            if (session == null) {
                rejectCode = "no-session";
                rejectReason = "No simulation session is active.";
                return false;
            }

            if (payload == null) {
                rejectCode = "bad-payload";
                rejectReason = "stats.history requires a payload object.";
                return false;
            }

            var runToken = payload["runId"];
            if (runToken == null || runToken.Type != JTokenType.String) {
                rejectCode = "bad-payload";
                rejectReason = "stats.history requires a string 'runId'.";
                return false;
            }
            string runId = (string)runToken;
            if (string.IsNullOrEmpty(runId)) {
                rejectCode = "bad-payload";
                rejectReason = "stats.history requires a non-empty 'runId'.";
                return false;
            }
            if (!string.Equals(runId, session.StatisticsRunId, StringComparison.Ordinal)) {
                rejectCode = "stale-run";
                rejectReason = "Statistics run '" + runId + "' is no longer active.";
                return false;
            }

            if (!TryReadInt(payload["from"], out int from)) {
                rejectCode = "bad-payload";
                rejectReason = "stats.history requires an integer 'from' row index.";
                return false;
            }
            int total = session.History.Count;
            if (from < 0 || from > total) {
                rejectCode = "out-of-range";
                rejectReason = "Row index 'from' (" + from + ") is outside [0, " + total + "].";
                return false;
            }

            int limit = MaxPageRows;
            var limitToken = payload["limit"];
            if (limitToken != null && limitToken.Type != JTokenType.Null) {
                if (!TryReadInt(limitToken, out limit)) {
                    rejectCode = "bad-payload";
                    rejectReason = "stats.history 'limit' must be an integer.";
                    return false;
                }
                if (limit < 0) {
                    rejectCode = "out-of-range";
                    rejectReason = "Row 'limit' (" + limit + ") must be non-negative.";
                    return false;
                }
            }

            int cappedLimit = Math.Min(limit, MaxPageRows);
            if (!session.History.TryRead(from, cappedLimit, out double[] slice, out int rowCount)) {
                rejectCode = "out-of-range";
                rejectReason = "Failed to read statistics history slice.";
                return false;
            }

            var values = new JArray();
            for (int i = 0; i < slice.Length; i++) values.Add(slice[i]);

            payload.RemoveAll();
            payload["runId"] = session.StatisticsRunId;
            payload["from"] = from;
            payload["count"] = rowCount;
            payload["total"] = total;
            payload["start"] = session.History.Start;
            payload["step"] = session.History.Step;
            payload["stride"] = StationStatisticsHistory.Stride;
            payload["values"] = values;
            RequestsServed++;
            LastServedRows = rowCount;
            LastServedRunId = session.StatisticsRunId ?? "";
            return true;
        }

        static bool TryReadInt(JToken token, out int result) {
            result = 0;
            if (token == null) return false;
            if (token.Type == JTokenType.Integer) {
                long v = (long)token;
                if (v < int.MinValue || v > int.MaxValue) return false;
                result = (int)v;
                return true;
            }
            if (token.Type == JTokenType.Float) {
                double d = (double)token;
                if (double.IsNaN(d) || double.IsInfinity(d) || Math.Floor(d) != d) return false;
                if (d < int.MinValue || d > int.MaxValue) return false;
                result = (int)d;
                return true;
            }
            return false;
        }
    }

    /// <summary>Wires <see cref="StationStatisticsStateContributor"/> and <see cref="StationStatisticsCommandHandler"/> onto a <see cref="StationGameHost"/>.</summary>
    public static class StationStatisticsFeature {
        public static StationStatisticsCommandHandler ActiveHandler { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Install() {
            var found = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            if (found) Attach(found);
        }

        public static void Attach(StationGameHost stationHost) {
            if (!stationHost) return;
            Func<StationSimulationSession> resolveSession = () => (stationHost.Simulation as StationSimulationHost)?.Session;
            var handler = new StationStatisticsCommandHandler(resolveSession);
            ActiveHandler = handler;
            stationHost.RegisterStateContributor(new StationStatisticsStateContributor(resolveSession));
            stationHost.RegisterCommandHandler(handler);
        }
    }
}
