using System;
using System.Collections.Generic;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// The simulation side of one install transaction. Packet C's session is adapted
    /// to this by <see cref="StationSimulationHost"/>; a different implementation can
    /// be installed without the loader knowing about it. Staging must not touch the
    /// live session; Commit swaps it in; Abort leaves the old one running.
    /// </summary>
    public interface IStationSimulationHost {
        void StageInstall(StationDocument document, StationIndex index);
        void CommitInstall();
        void AbortInstall();
        void Tick(double realSeconds);
        void Release();
        bool Playing { get; }
        int Speed { get; }
        /// <summary>Seconds since the station's day zero, for per-frame consumers.</summary>
        double SimTimeSeconds { get; }
        string ClockPayloadJson();
        /// <summary>
        /// Which simulation transports this install honours, as the `payload.simulationCapabilities`
        /// object the shell reads beside the clock (session id + the capability booleans).
        /// Empty when the host has no session to describe.
        /// </summary>
        string CapabilitiesPayloadJson();
    }

    /// <summary>Optional simulation-command support on top of <see cref="IStationSimulationHost"/>.</summary>
    public interface IStationSimulationCommands {
        bool ApplySimCommand(string type, JObject payload, out string rejectCode);
    }

    /// <summary>
    /// A snapshot key a packet owns (camera/view/finishes/ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦). The host merges every
    /// contributor into each `state`/commit payload, so no packet edits the host.
    /// </summary>
    public interface IStationStateContributor {
        string Key { get; }
        JObject BuildPayload(StationDocument document, StationIndex index);
    }

    /// <summary>Baseline camera framing for a committed document, in world metres.</summary>
    public readonly struct StationCameraBounds {
        public StationCameraBounds(StationBounds bounds, Vector3 centre, float radius, float orthoSize) {
            Bounds = bounds; Centre = centre; Radius = radius; OrthoSize = orthoSize;
        }
        public StationBounds Bounds { get; }
        public Vector3 Centre { get; }
        public float Radius { get; }
        public float OrthoSize { get; }
        public bool IsEmpty => Bounds.IsEmpty;
        public override string ToString() => Bounds + " centre " + Centre + " radius " + Radius;
    }

    /// <summary>What was committed: the document, its index, the new revision and source.</summary>
    public sealed class StationCommitInfo {
        public StationDocument Document;
        public StationIndex Index;
        public int Revision;
        public string SourceId;
        public string SourceHash;
        public StationCameraBounds CameraBounds;
        public StationViewSummary View;
        public IReadOnlyList<StationDiagnostic> Diagnostics;
    }

    /// <summary>The typed result of one install attempt.</summary>
    public sealed class StationLoadResult {
        public bool Accepted;
        public int Revision;
        public StationRejection Rejection;
        public IReadOnlyList<StationDiagnostic> Diagnostics = Array.Empty<StationDiagnostic>();
        public StationDocument Document;
        public StationIndex Index;
        public StationCameraBounds CameraBounds;
        public StationViewSummary View;
        public static StationLoadResult Rejected(StationRejection rejection, int revision) => new StationLoadResult {
            Accepted = false, Rejection = rejection, Revision = revision,
            Diagnostics = new[] { new StationDiagnostic(rejection.Code, StationDiagnosticSeverity.Error,
                rejection.RecordType, rejection.RecordId, rejection.Reason) },
        };
        public override string ToString() => Accepted ? "accepted revision " + Revision : "rejected: " + Rejection;
    }

    /// <summary>
    /// The station install transaction: parse/repair ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ document/index ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ **staged**
    /// view root + staged simulation session ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ commit document, scene, camera bounds
    /// and simulation together. Any failure disposes the candidate and returns one
    /// typed rejection; the previous station keeps running.
    /// </summary>
    public sealed class StationLoadCoordinator : IDisposable {
        readonly Transform parent;
        readonly List<IStationViewRenderer> renderers = new List<IStationViewRenderer>();
        StationWorldView world;
        StationDocument document;
        StationIndex index;
        StationCameraBounds cameraBounds;
        IStationSimulationHost simulation;
        int revision;
        string sourceId = "";
        string sourceHash = "";
        bool disposed;

        public StationLoadCoordinator(Transform parent) {
            this.parent = parent;
        }

        public event Action<StationCommitInfo> Committed;

        public StationDocument Document => document;
        public StationIndex Index => index;
        public StationWorldView World => world;
        public StationCameraBounds CameraBounds => cameraBounds;
        public int Revision => revision;
        public string SourceId => sourceId;
        public string SourceHash => sourceHash;
        public bool IsLoaded => document != null;
        public IStationSimulationHost Simulation => simulation;
        /// <summary>Scene assets copied into every candidate world before Build().</summary>
        public StationViewAssets Assets { get; set; } = new StationViewAssets();
        public IReadOnlyList<IStationViewRenderer> Renderers => renderers;

        public void RegisterRenderer(IStationViewRenderer renderer) {
            if (renderer == null) throw new ArgumentNullException(nameof(renderer));
            UnregisterRenderer(renderer.Role);
            renderers.Add(renderer);
        }

        public bool UnregisterRenderer(string role) {
            for (int i = renderers.Count - 1; i >= 0; i--) {
                if (string.Equals(renderers[i].Role, role, StringComparison.Ordinal)) {
                    renderers.RemoveAt(i);
                    return true;
                }
            }
            return false;
        }

        public void SetSimulationHost(IStationSimulationHost host) => simulation = host;

        public StationLoadResult Open(string json, StationSource source, string id) {
            StationReadResult read;
            try {
                read = StationDocumentReader.Read(json, source);
            } catch (StationRejectedException rejection) {
                return StationLoadResult.Rejected(rejection.Rejection, revision);
            }
            return Install(read, string.IsNullOrEmpty(id) ? read.Document.Source.Hash : id);
        }

        public StationLoadResult OpenFile(string path, string id) {
            StationReadResult read;
            try {
                read = StationDocumentReader.ReadFile(path);
            } catch (StationRejectedException rejection) {
                return StationLoadResult.Rejected(rejection.Rejection, revision);
            }
            return Install(read, string.IsNullOrEmpty(id) ? path : id);
        }

        /// <summary>
        /// A New station goes through the same file boundary as an opened one: the
        /// empty v1 envelope is read, repaired and indexed by the same reader.
        /// </summary>
        public StationLoadResult New(string name, string city, long seed) {
            var envelope = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = string.IsNullOrEmpty(name) ? "ÃƒÂ¦Ã…â€œÃ‚ÂªÃƒÂ¥Ã¢â‚¬ËœÃ‚Â½ÃƒÂ¥Ã‚ÂÃ‚ÂÃƒÂ¨Ã‚Â½Ã‚Â¦ÃƒÂ§Ã‚Â«Ã¢â€žÂ¢" : name,
                ["nameEn"] = "",
                ["city"] = string.IsNullOrEmpty(city) ? "guangzhou" : city,
                ["seed"] = seed,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = new JArray(), ["modules"] = new JArray(), ["lines"] = new JArray() },
            };
            return Open(envelope.ToString(Newtonsoft.Json.Formatting.None), StationSource.None, "new");
        }

        StationLoadResult Install(StationReadResult read, string id) {
            if (disposed) throw new ObjectDisposedException(nameof(StationLoadCoordinator));
            var candidate = new StationWorldView(parent, "Station " + (string.IsNullOrEmpty(id) ? read.Document.Name : id), renderers, Assets);
            IStationSimulationHost stageTarget = simulation;
            try {
                candidate.Build(read.Document, read.Index);
                if (stageTarget != null) stageTarget.StageInstall(read.Document, read.Index);
            } catch (StationViewBuildException error) {
                Abort(candidate, stageTarget);
                return StationLoadResult.Rejected(new StationRejection("render-failed", StationRecordKind.Document,
                    "renderer", error.Role, error.Message), revision);
            } catch (Exception error) {
                Abort(candidate, stageTarget);
                return StationLoadResult.Rejected(new StationRejection("simulation-failed", StationRecordKind.Document,
                    "simulation", "", error.Message), revision);
            }

            try {
                if (stageTarget != null) stageTarget.CommitInstall();
            } catch (Exception error) {
                Abort(candidate, stageTarget);
                return StationLoadResult.Rejected(new StationRejection("simulation-failed", StationRecordKind.Document,
                    "simulation", "", error.Message), revision);
            }

            var previous = world;
            var nextRevision = revision + 1;
            world = candidate;
            world.Activate();
            previous?.Dispose();
            document = read.Document;
            index = read.Index;
            revision = nextRevision;
            sourceId = string.IsNullOrEmpty(id) ? read.Document.Source.Hash : id;
            sourceHash = read.Document.Source.Hash;
            cameraBounds = ComputeCameraBounds(read.Index);

            var info = new StationCommitInfo {
                Document = document, Index = index, Revision = revision, SourceId = sourceId,
                SourceHash = sourceHash, CameraBounds = cameraBounds, View = world.Summary(),
                Diagnostics = Merge(read.Diagnostics, world.Unresolved),
            };
            Committed?.Invoke(info);
            return new StationLoadResult {
                Accepted = true, Revision = revision, Document = document, Index = index,
                CameraBounds = cameraBounds, View = info.View, Diagnostics = info.Diagnostics,
            };
        }

        static void Abort(StationWorldView candidate, IStationSimulationHost stageTarget) {
            try { stageTarget?.AbortInstall(); } catch (Exception) { /* abort must not mask the original refusal */ }
            candidate.Dispose();
        }

        static IReadOnlyList<StationDiagnostic> Merge(IReadOnlyList<StationDiagnostic> read, IReadOnlyList<StationDiagnostic> view) {
            var all = new List<StationDiagnostic>();
            if (read != null) all.AddRange(read);
            if (view != null) all.AddRange(view);
            return all;
        }

        /// <summary>
        /// The world-space box the committed content occupies, with a baseline
        /// orthographic framing. Packet D's camera controller takes these bounds over;
        /// the numbers are derived from the document, never an authored layout.
        /// </summary>
        public static StationCameraBounds ComputeCameraBounds(StationIndex index) {
            var bounds = index?.Bounds ?? new StationBounds(0, 0, 0, -1, -1, -1);
            if (bounds.IsEmpty) return new StationCameraBounds(bounds, Vector3.zero, 0f, 10f);
            double centreX = bounds.MinX + bounds.Width / 2.0;
            double centreY = bounds.MinY + bounds.Depth / 2.0;
            double centreZ = bounds.MinZ + bounds.Height / 2.0;
            var centre = StationCoordinates.Point(new Vector3((float)centreX, (float)centreY, (float)centreZ));
            float radius = new Vector3(bounds.Width, bounds.Depth, bounds.Height).magnitude * 0.5f;
            float ortho = Mathf.Max(12f, Mathf.Max(bounds.Width, bounds.Depth) * 0.62f);
            return new StationCameraBounds(bounds, centre, radius, ortho);
        }

        public string Save(DateTimeOffset savedAt) {
            if (document == null) return "";
            return StationDocumentReader.Write(document, savedAt);
        }

        public string Save() => Save(DateTimeOffset.UtcNow);

        /// <summary>
        /// Install a document produced by an edit verb. The caller has already passed
        /// the revision check; this runs the same parse → index → staged world/session
        /// → commit transaction as an open, so an edit cannot half-commit either.
        /// </summary>
        public StationLoadResult InstallEditedDocument(string json, string sourceId) =>
            Open(json, new StationSource(sourceId ?? "", ""), string.IsNullOrEmpty(sourceId) ? null : sourceId);

        public void Tick(double realSeconds) => simulation?.Tick(realSeconds);

        public void Dispose() {
            if (disposed) return;
            disposed = true;
            try { simulation?.Release(); } catch (Exception) { }
            world?.Dispose();
            world = null;
            document = null;
            index = null;
        }
    }

    /// <summary>
    /// Packet A's adapter onto C's <see cref="StationSimulationSession"/>. It builds
    /// the session's flat projection from the typed document; the session itself
    /// never sees JSON, Prefabs or the scene.
    /// </summary>
    public sealed class StationSimulationHost : IStationSimulationHost, IStationSimulationCommands {
        StationSimulationSession pending;
        StationSimulationSession session;

        public StationSimulationSession Session => session;

        public void StageInstall(StationDocument document, StationIndex index) {
            var setup = StationSessionProjection.Setup(document, index, "sim-" + (document.Source.Hash ?? ""));
            pending = new StationSimulationSession(setup);
        }

        public void CommitInstall() {
            session = pending;
            pending = null;
            BindPassengerFeed();
        }

        public void AbortInstall() {
            if (pending != null) pending = null;
        }

        /// <summary>
        /// Bind the crowd renderer's actor feed to the session that was just committed.
        /// A station switch replaces the feed in the same transaction that replaces the
        /// world, so the released session can never publish into the new station's
        /// crowd; disposing the host clears it again.
        /// </summary>
        void BindPassengerFeed() {
            if (session == null) { PassengerPoseFeeds.Clear(); return; }
            PassengerPoseFeeds.SetSource(new SessionPassengerFeed(session));
        }

        public void Tick(double realSeconds) {
            if (session != null && realSeconds > 0) session.Advance(realSeconds);
        }

        public void Release() {
            session = null;
            pending = null;
            PassengerPoseFeeds.Clear();
        }

        public bool Playing => session != null && session.Playing;
        public int Speed => session?.Speed ?? 1;
        public double SimTimeSeconds => session?.Clock?.SimTime ?? 0;
        public string ClockPayloadJson() => session?.ClockPayloadJson() ?? "{}";
        public string CapabilitiesPayloadJson() => session?.CapabilitiesPayloadJson() ?? "";

        public bool ApplySimCommand(string type, JObject payload, out string rejectCode) {
            rejectCode = "";
            if (session == null) { rejectCode = "no-session"; return false; }
            var kind = StationSimulationSession.CommandFromType(type);
            if (kind == SimCommandKind.Unknown) { rejectCode = "unsupported-command"; return false; }
            bool playing = payload?["playing"] != null && payload["playing"].Type == JTokenType.Boolean && (bool)payload["playing"];
            double value = 0;
            if (payload?["simTime"] != null) value = (double)payload["simTime"];
            else if (payload?["value"] != null) value = (double)payload["value"];
            else if (payload?["speed"] != null) value = (double)payload["speed"];
            string reason;
            if (!session.TryApplyCommand(kind, playing, value, out reason)) {
                rejectCode = string.IsNullOrEmpty(reason) ? "rejected" : reason;
                return false;
            }
            return true;
        }
    }

    /// <summary>
    /// The document ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ session projection. Only what C's session reads (flat facts,
    /// document order), so the session has no reference to Persistence or Newtonsoft.
    /// </summary>
    public static class StationSessionProjection {
        public static StationSessionSetup Setup(StationDocument document, StationIndex index, string sessionId) {
            return new StationSessionSetup {
                Document = Document(document, index),
                Day = Day(document.Day),
                Seed = unchecked((uint)document.Seed),
                StartSimTime = StationClock.ReferenceBootSeconds,
                StartPlaying = false,
                Speed = 1,
                SessionId = sessionId,
            };
        }

        public static StationDayData Day(StationDay day) {
            if (day == null) return StationDayData.Default;
            var raw = new StationDayData(
                new DaySpan((int)Math.Round(day.Service.From), (int)Math.Round(day.Service.To)),
                new PeakSpans(
                    new DaySpan((int)Math.Round(day.MorningPeak.From), (int)Math.Round(day.MorningPeak.To)),
                    new DaySpan((int)Math.Round(day.EveningPeak.From), (int)Math.Round(day.EveningPeak.To))),
                new DayDemand(
                    new DemandKnobs(day.Workday.AmPeak, day.Workday.PmPeak, day.Workday.Sharpness),
                    new DemandKnobs(day.Offday.AmPeak, day.Offday.PmPeak, day.Offday.Sharpness)),
                new SimCalendar(new SimDate(day.EpochYear, day.EpochMonth, day.EpochDay), day.Holidays != null ? ToArray(day.Holidays) : null));
            return StationClock.NormalizeDay(raw);
        }

        public static StationSessionDocument Document(StationDocument document, StationIndex index) {
            var projected = new StationSessionDocument {
                StationId = document.Source.Hash ?? "",
                LevelBase = document.LevelBase,
            };
            foreach (var cell in document.Cells) {
                projected.Cells.Add(new StationCellFact {
                    X = cell.X, Y = cell.Y, Z = cell.Z,
                    Solid = cell.IsSolid,
                    Zone = ZoneIndex(cell.Zone),
                    Speed = cell.IsSolid && string.Equals(cell.FinishTop, "floor.track", StringComparison.Ordinal) ? 0 : 1,
                });
            }
            foreach (var module in document.Modules) {
                var cfg = module.Config;
                var fact = new StationModuleFact {
                    Id = module.Id, Type = module.Type,
                    X = module.X, Y = module.Y, Z = module.Z, Rot = module.Rotation,
                    Width = module.Width, Depth = module.Depth, Height = module.Height,
                    LineId = cfg.Text("line"),
                    Dir = cfg.Text("dir"),
                    Side = cfg.Text("side"),
                    RailId = cfg.Text("from"),
                    GateDir = GateDir(cfg.Text("dir")),
                    GateOpen = module.Type == "gate",
                    GateHasLane = module.Type != "gate" || !cfg.Has("door") || cfg.Text("door") != "none",
                    Tunnel = cfg.Bool("tunnel"),
                    Bridge = cfg.Bool("bridge"),
                    Block = cfg.Bool("block"),
                    HasEndpoints = module.HasFrom && module.HasTo,
                    RunLength = 0,
                };
                if (module.HasFrom) {
                    fact.FromX = (int)Math.Round(module.From.Value.X);
                    fact.FromY = (int)Math.Round(module.From.Value.Y);
                    fact.FromZ = (int)Math.Round(module.From.Value.Z);
                }
                if (module.HasTo) {
                    fact.ToX = (int)Math.Round(module.To.Value.X);
                    fact.ToY = (int)Math.Round(module.To.Value.Y);
                    fact.ToZ = (int)Math.Round(module.To.Value.Z);
                }
                projected.Modules.Add(fact);
            }
            foreach (var line in document.Lines) {
                var fact = new StationLineFact {
                    Id = line.Id, Direction = line.Direction,
                    HeadwayPeak = 150, HeadwayOffpeak = 240, HeadwayLate = 480,
                };
                var raw = SafeLine(line.RawJson);
                var profile = raw?["headwayProfile"];
                if (profile != null) {
                    fact.HeadwayPeak = Number(profile["peak"], fact.HeadwayPeak);
                    fact.HeadwayOffpeak = Number(profile["offpeak"], fact.HeadwayOffpeak);
                    fact.HeadwayLate = Number(profile["late"], fact.HeadwayLate);
                }
                projected.Lines.Add(fact);
            }
            return projected;
        }

        /// <summary>
        /// The save's zone label as the session's integer index. The session only uses
        /// the index as an identity; the fare-line rule itself is off in the source
        /// (`ZONE_LINES_BLOCK`), so no crossing decision depends on this mapping yet.
        /// </summary>
        public static int ZoneIndex(string zone) {
            switch (zone) {
                case "paid": return 2;
                case "unpaid": return 1;
                default: return 0;
            }
        }

        static int GateDir(string direction) => direction == "in" ? 1 : direction == "out" ? -1 : 0;

        static JObject SafeLine(string raw) {
            if (string.IsNullOrEmpty(raw)) return null;
            try { return JObject.Parse(raw); } catch (Exception) { return null; }
        }

        static double Number(JToken token, double fallback) {
            if (token == null) return fallback;
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float) return (double)token;
            return fallback;
        }

        static string[] ToArray(IReadOnlyList<string> values) {
            var array = new string[values.Count];
            for (int i = 0; i < values.Count; i++) array[i] = values[i];
            return array;
        }
    }
}
