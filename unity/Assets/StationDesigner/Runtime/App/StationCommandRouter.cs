using System;
using System.Collections.Generic;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.App {
    /// <summary>One decoded v2 command.</summary>
    public sealed class StationCommand {
        public int SchemaVersion;
        public string Id = "";
        public string SessionId = "";
        public string Type = "";
        public int? ExpectedRevision;
        public JObject Payload;
        public string Raw = "";
        public override string ToString() => Type + " " + Id + " rev " + (ExpectedRevision?.ToString() ?? "-");
    }

    /// <summary>
    /// A feature packet's command handler (D camera/view, E material/face, F sign,
    /// G road, â€¦). The router calls it only for types it claims, so packets compile
    /// and register without touching the loader or the host.
    /// </summary>
    public interface IStationCommandHandler {
        /// <summary>Capability key advertised to the UI ("camera", "view", "sign", â€¦).</summary>
        string Capability { get; }
        bool Handles(string type);
        /// <summary>
        /// True = accepted (payload becomes the ack payload). False with an empty
        /// <paramref name="rejectCode"/> = not handled; false with a code = rejected.
        /// A handler never changes the document revision â€” features ack, never commit.
        /// </summary>
        bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason);
    }

    /// <summary>
    /// Process-wide command-handler registry. A feature file registers its handler
    /// once with <c>[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]</c>;
    /// the host registers the snapshot with its router at Awake, so adding a packet
    /// never edits the host. Capability keys are unique — a later handler replaces an
    /// earlier one with the same capability, which is what a test seam wants.
    /// </summary>
    public static class StationCommandHandlers {
        static readonly List<IStationCommandHandler> Registered = new List<IStationCommandHandler>();

        public static void Add(IStationCommandHandler handler) {
            if (handler == null) throw new ArgumentNullException(nameof(handler));
            Remove(handler.Capability);
            Registered.Add(handler);
        }

        public static bool Remove(string capability) {
            for (int i = Registered.Count - 1; i >= 0; i--) {
                if (string.Equals(Registered[i].Capability, capability, StringComparison.Ordinal)) {
                    Registered.RemoveAt(i);
                    return true;
                }
            }
            return false;
        }

        public static IReadOnlyList<IStationCommandHandler> Snapshot() => Registered.ToArray();

        /// <summary>Test seam: forget every registration.</summary>
        public static void Clear() => Registered.Clear();
    }

    /// <summary>
    /// The single command receiver for the v2 envelope. It owns transport-level
    /// rules â€” schema version, command id, stale <c>expectedRevision</c>, session
    /// echo, stable rejection codes â€” and forwards feature payloads to registered
    /// handlers as <see cref="JObject"/>, so camera/view/sign/road/material/sim
    /// payload types stay with their packets.
    ///
    /// Only `station.*` commands may change the document revision; every feature
    /// reply is an acknowledgement.
    /// </summary>
    public sealed class StationCommandRouter {
        public const int SchemaVersion = 2;
        readonly StationGameHost host;
        readonly List<IStationCommandHandler> handlers = new List<IStationCommandHandler>();

        public StationCommandRouter(StationGameHost host) {
            this.host = host ?? throw new ArgumentNullException(nameof(host));
        }

        public IReadOnlyList<IStationCommandHandler> Handlers => handlers;

        public void Register(IStationCommandHandler handler) {
            if (handler == null) throw new ArgumentNullException(nameof(handler));
            for (int i = handlers.Count - 1; i >= 0; i--) {
                if (handlers[i] == handler) return;
                if (string.Equals(handlers[i].Capability, handler.Capability, StringComparison.Ordinal)) handlers.RemoveAt(i);
            }
            handlers.Add(handler);
        }

        public bool Unregister(string capability) {
            for (int i = handlers.Count - 1; i >= 0; i--) {
                if (string.Equals(handlers[i].Capability, capability, StringComparison.Ordinal)) {
                    handlers.RemoveAt(i);
                    return true;
                }
            }
            return false;
        }

        /// <summary>Decode, dispatch and return exactly one reply envelope as JSON.</summary>
        public string Handle(string json) {
            StationCommand command;
            try {
                command = Decode(json);
            } catch (StationRejectedException rejection) {
                return Reject("", "", rejection.Rejection.Code, rejection.Rejection.Reason, host.CurrentRevision);
            }
            if (command.SessionId.Length > 0) host.NoteClientSession(command.SessionId);

            if (command.ExpectedRevision.HasValue && command.ExpectedRevision.Value != host.CurrentRevision) {
                return Reject(command.Id, command.SessionId, "revision-mismatch",
                    "Command expected revision " + command.ExpectedRevision.Value + " but the committed revision is " + host.CurrentRevision + ".",
                    host.CurrentRevision);
            }

            switch (command.Type) {
                case "station.new": {
                    var result = host.NewStation(command.Payload);
                    return CommitOrReject(command, result);
                }
                case "station.open": {
                    var document = command.Payload?["document"];
                    if (document == null || document.Type != JTokenType.String)
                        return Reject(command.Id, command.SessionId, "parse-failed", "station.open needs payload.document as the save text.", host.CurrentRevision);
                    var result = host.OpenDocument((string)document, command.Payload?["sourceId"] != null ? (string)command.Payload["sourceId"] : "file");
                    return CommitOrReject(command, result);
                }
                case "station.openDemo": {
                    var demoId = command.Payload?["id"] != null ? (string)command.Payload["id"] : "";
                    var result = host.OpenDemo(demoId);
                    return CommitOrReject(command, result);
                }
                case "station.save": {
                    // The shell already holds the committed text; this is the ack that
                    // names the revision it belongs to.
                    var payload = new JObject {
                        ["revision"] = host.CurrentRevision,
                        ["sourceId"] = host.CurrentSourceId,
                        ["sourceHash"] = host.CurrentSourceHash,
                    };
                    return Ack(command.Id, command.SessionId, payload);
                }
                case "station.resync": {
                    var result = host.Resync();
                    return CommitOrReject(command, result);
                }
                case "sim.play":
                case "sim.speed":
                case "sim.seek":
                case "sim.restart": {
                    string code;
                    if (!host.ApplySimCommand(command.Type, command.Payload ?? new JObject(), out code))
                        return Reject(command.Id, command.SessionId, string.IsNullOrEmpty(code) ? "rejected" : code,
                            "The simulation command was refused.", host.CurrentRevision);
                    return Ack(command.Id, command.SessionId, host.BuildStatePayload());
                }
                default: {
                    for (int i = 0; i < handlers.Count; i++) {
                        var handler = handlers[i];
                        if (!handler.Handles(command.Type)) continue;
                        int revisionBefore = host.CurrentRevision;
                        string rejectCode, rejectReason;
                        // The handler reads its command fields from this object and writes the
                        // ack fields back into it. Passing an empty object (as an earlier version
                        // did) made every feature handler see no input and reject with bad-payload.
                        JObject payload = command.Payload != null ? (JObject)command.Payload.DeepClone() : new JObject();
                        if (handler.TryHandle(command, payload, out rejectCode, out rejectReason)) {
                            // An edit verb stages a whole normalized document through
                            // StationGameHost.ApplyDocumentEdit; the transaction bumps the
                            // revision and the reply becomes its commit.
                            if (host.CurrentRevision != revisionBefore) return CommitOrReject(command, host.CurrentResult());
                            return Ack(command.Id, command.SessionId, payload);
                        }
                        if (!string.IsNullOrEmpty(rejectCode)) {
                            return Reject(command.Id, command.SessionId, rejectCode,
                                rejectReason ?? "The feature handler refused the command.", host.CurrentRevision);
                        }
                        break;
                    }
                    return Reject(command.Id, command.SessionId, "unsupported-command",
                        "No registered handler accepts '" + command.Type + "'.", host.CurrentRevision);
                }
            }
        }

        public JObject BuildCapabilities() {
            var capabilities = new JObject {
                ["station"] = true,
                ["new"] = true,
                ["open"] = true,
                ["save"] = true,
                ["demos"] = host.DemoCount > 0,
                ["editing"] = host.IsLoaded,
            };
            for (int i = 0; i < handlers.Count; i++) capabilities[handlers[i].Capability] = true;
            return capabilities;
        }

        StationCommand Decode(string json) {
            JObject envelope;
            try {
                envelope = JObject.Parse(json ?? "");
            } catch (JsonException error) {
                throw new StationRejectedException(new StationRejection("parse-failed", StationRecordKind.Document, "", "",
                    "The command is not valid JSON: " + error.Message));
            }
            var schema = envelope["schemaVersion"];
            int version = schema != null && (schema.Type == JTokenType.Integer || schema.Type == JTokenType.Float) ? (int)schema : 0;
            if (version != SchemaVersion)
                throw new StationRejectedException(new StationRejection("schema-version", StationRecordKind.Document, "", "",
                    "Command schemaVersion must be " + SchemaVersion + "."));
            var type = envelope["type"] != null ? (string)envelope["type"] : "";
            if (string.IsNullOrEmpty(type))
                throw new StationRejectedException(new StationRejection("parse-failed", StationRecordKind.Document, "", "",
                    "The command has no type."));
            int? expected = null;
            var expectedToken = envelope["expectedRevision"];
            if (expectedToken != null && expectedToken.Type != JTokenType.Null) expected = (int)expectedToken;
            return new StationCommand {
                SchemaVersion = version,
                Id = envelope["id"] != null ? (string)envelope["id"] : "",
                SessionId = envelope["sessionId"] != null ? (string)envelope["sessionId"] : "",
                Type = type,
                ExpectedRevision = expected,
                Payload = envelope["payload"] as JObject,
                Raw = json,
            };
        }

        string CommitOrReject(StationCommand command, StationLoadResult result) {
            if (!result.Accepted) {
                var rejection = result.Rejection;
                return Reject(command.Id, command.SessionId, rejection.Code, rejection.Reason, host.CurrentRevision);
            }
            return Envelope("commit", command.Id, command.SessionId, true, null, host.BuildCommitPayload());
        }

        string Ack(string id, string sessionId, JObject payload) =>
            Envelope("ack", id, sessionId, true, null, payload ?? new JObject());

        string Reject(string id, string sessionId, string code, string reason, int revision) {
            var payload = new JObject { ["reason"] = reason ?? "" };
            var envelope = EnvelopeObject("reject", id, sessionId, false, code, payload);
            envelope["revision"] = revision;
            return envelope.ToString(Formatting.None);
        }

        string Envelope(string kind, string id, string sessionId, bool accepted, string code, JObject payload) =>
            EnvelopeObject(kind, id, sessionId, accepted, code, payload).ToString(Formatting.None);

        JObject EnvelopeObject(string kind, string id, string sessionId, bool accepted, string code, JObject payload) {
            var envelope = new JObject {
                ["schemaVersion"] = SchemaVersion,
                ["kind"] = kind,
                ["id"] = id ?? "",
                ["sessionId"] = sessionId ?? "",
                ["revision"] = host.CurrentRevision,
                ["accepted"] = accepted,
                ["code"] = code != null ? new JValue(code) : JValue.CreateNull(),
                ["payload"] = payload ?? new JObject(),
            };
            return envelope;
        }
    }
}
