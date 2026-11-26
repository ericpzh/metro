using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.App {
    readonly struct StationEditAudioOutcome {
        readonly string command;
        readonly string tool;
        readonly bool secondary;
        readonly bool carried;
        readonly string selectionKind;
        readonly string selectionKey;
        readonly JObject pick;
        readonly JObject paintPick;
        readonly JObject notice;

        public StationEditAudioOutcome(string type, JObject payload) {
            command = type;
            tool = StationToolSelection.Active;
            secondary = type == "pointer.rightTap" ||
                (payload["button"]?.Type == JTokenType.Integer && (int)payload["button"] == 2);
            carried = StationEditSession.HasCarried;
            selectionKind = StationEditSession.SelectionKind;
            selectionKey = StationEditSession.SelectionKey;
            pick = StationEditSession.Picked;
            paintPick = StationEditSession.PaintPick;
            notice = StationEditSession.Notice;
        }

        public string Cue(bool accepted, bool committed, string rejectCode) {
            bool pointer = command == "pointer.down" || command == "pointer.up" || command == "pointer.rightTap";
            bool move = command == "edit.move.start" || command == "edit.move.confirm";
            bool delete = command == "edit.delete";
            if (!pointer && !move && !delete && command != "edit.select") return null;

            if (accepted && committed) {
                if (command == "edit.move.confirm" || (pointer && carried && tool == "move")) return "move";
                return delete || secondary || tool == "delete" ? "delete" : "place";
            }
            if (accepted && !carried && StationEditSession.HasCarried) return "pick";
            if (accepted && (pick != StationEditSession.Picked && IsArmablePick(StationEditSession.Picked) ||
                paintPick != StationEditSession.PaintPick && StationEditSession.PaintPick != null)) return "pick";
            if (accepted && !string.IsNullOrEmpty(StationEditSession.SelectionKey) &&
                (selectionKind != StationEditSession.SelectionKind || selectionKey != StationEditSession.SelectionKey)) return "select";
            if (pointer && notice != StationEditSession.Notice &&
                (string)StationEditSession.Notice?["kind"] == "blocked" && tool != "pick" && tool != "select") return "refused";
            return !accepted && (move || delete) && !string.IsNullOrEmpty(rejectCode) ? "refused" : null;
        }

        static bool IsArmablePick(JObject picked) {
            if (picked == null) return false;
            var armable = picked["armable"];
            if (armable != null && armable.Type == JTokenType.Boolean) return (bool)armable;
            return !string.IsNullOrEmpty((string)picked["moduleId"]) || !string.IsNullOrEmpty((string)picked["finish"]);
        }
    }

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
    /// G road, …). The router calls it only for types it claims, so packets compile
    /// and register without touching the loader or the host.
    /// </summary>
    public interface IStationCommandHandler {
        /// <summary>Capability key advertised to the UI ("camera", "view", "sign", …).</summary>
        string Capability { get; }
        bool Handles(string type);
        /// <summary>
        /// True = accepted (payload becomes the ack payload). False with an empty
        /// <paramref name="rejectCode"/> = not handled; false with a code = rejected.
        /// A handler never changes the document revision — features ack, never commit.
        /// </summary>
        bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason);
    }

    /// <summary>
    /// Process-wide command-handler registry. A feature file registers its handler
    /// once with <c>[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]</c>;
    /// the host registers the snapshot with its router at Awake, so adding a packet
    /// never edits the host. Capability keys are unique  a later handler replaces an
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
    /// rules — schema version, command id, stale <c>expectedRevision</c>, session
    /// echo, stable rejection codes — and forwards feature payloads to registered
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

        internal readonly struct YieldedOpenPlan {
            public readonly StationCommand Command;
            public readonly string DocumentJson;
            public readonly StationSource Source;
            public readonly string SourceId;

            public YieldedOpenPlan(StationCommand command, string documentJson, StationSource source, string sourceId) {
                Command = command;
                DocumentJson = documentJson;
                Source = source;
                SourceId = sourceId;
            }
        }

        internal bool TryPrepareYieldedOpen(string json, out YieldedOpenPlan plan) {
            plan = default;
            if (string.IsNullOrEmpty(json)) return false;
            if (json.IndexOf("station.open", StringComparison.Ordinal) < 0) return false;
            StationCommand command;
            try {
                command = Decode(json);
            } catch (StationRejectedException) {
                return false;
            }
            if (command.ExpectedRevision.HasValue && command.ExpectedRevision.Value != host.CurrentRevision) return false;
            if (string.Equals(command.Type, "station.openDemo", StringComparison.Ordinal)) {
                var demoId = command.Payload?["id"] != null ? (string)command.Payload["id"] : "";
                if (!host.TryResolveDemoInput(demoId, out var demoText, out var demoSource)) return false;
                if (command.SessionId.Length > 0) host.NoteClientSession(command.SessionId);
                plan = new YieldedOpenPlan(command, demoText, demoSource, demoId);
                return true;
            }
            if (string.Equals(command.Type, "station.open", StringComparison.Ordinal)) {
                var docToken = command.Payload?["document"];
                if (docToken == null || docToken.Type != JTokenType.String) return false;
                var sourceId = command.Payload?["sourceId"] != null ? (string)command.Payload["sourceId"] : "file";
                var docText = (string)docToken;
                if (command.SessionId.Length > 0) host.NoteClientSession(command.SessionId);
                command.Payload = null;
                command.Raw = null;
                plan = new YieldedOpenPlan(command, docText, new StationSource(sourceId == "file" ? "" : sourceId, ""), sourceId);
                return true;
            }
            return false;
        }

        public string FormatCommitOrReject(StationCommand command, StationLoadResult result) =>
            CommitOrReject(command, result);

        public bool TryStreamCommitEnvelope(StationCommand command, StationLoadResult result, Action<string> writeChunk) {
            if (command == null || result == null || !result.Accepted || writeChunk == null) return false;
            bool forceFullDocument = string.Equals(command.Type, "station.resync", StringComparison.Ordinal);
            if (!forceFullDocument && host.CanBuildDeltaCommitPayload()) return false;
            var doc = host.Document;
            if (!StationDocumentReader.CanStreamEnvelope(doc)) return false;
            var payloadWithoutDoc = host.BuildFullCommitPayloadWithoutDocument(useRawJsonCache: true);
            StreamEnvelopeWithDocument("commit", command.Id, command.SessionId, true, null,
                payloadWithoutDoc, documentFirst: true,
                seg => StationDocumentReader.TryWriteNormalizedEnvelope(doc, seg),
                writeChunk);
            return true;
        }

        public bool TryStreamDirectReply(string json, Action<string> writeChunk) {
            if (string.IsNullOrEmpty(json) || writeChunk == null) return false;
            if (json.IndexOf("station.save", StringComparison.Ordinal) < 0 &&
                json.IndexOf("station.resync", StringComparison.Ordinal) < 0) return false;
            StationCommand command;
            try {
                command = Decode(json);
            } catch (StationRejectedException) {
                return false;
            }
            if (command.ExpectedRevision.HasValue && command.ExpectedRevision.Value != host.CurrentRevision) return false;
            if (string.Equals(command.Type, "station.save", StringComparison.Ordinal)) {
                bool includeDocument = command.Payload?["includeDocument"] != null &&
                                       command.Payload["includeDocument"].Type == JTokenType.Boolean &&
                                       (bool)command.Payload["includeDocument"];
                if (!includeDocument) return false;
                var doc = host.Document;
                if (!StationDocumentReader.CanStreamSavedEnvelope(doc)) return false;
                if (command.SessionId.Length > 0) host.NoteClientSession(command.SessionId);
                var savedAt = DateTimeOffset.UtcNow;
                var payloadWithoutDoc = new JObject {
                    ["revision"] = host.CurrentRevision,
                    ["sourceId"] = host.CurrentSourceId,
                    ["sourceHash"] = host.CurrentSourceHash,
                };
                StreamEnvelopeWithDocument("ack", command.Id, command.SessionId, true, null,
                    payloadWithoutDoc, documentFirst: false,
                    seg => StationDocumentReader.TryWriteSavedEnvelope(doc, savedAt, seg),
                    writeChunk);
                return true;
            }
            if (string.Equals(command.Type, "station.resync", StringComparison.Ordinal)) {
                if (!host.IsLoaded || !StationDocumentReader.CanStreamEnvelope(host.Document)) return false;
                if (command.SessionId.Length > 0) host.NoteClientSession(command.SessionId);
                return TryStreamCommitEnvelope(command, host.Resync(), writeChunk);
            }
            return false;
        }

        void StreamEnvelopeWithDocument(string kind, string id, string sessionId, bool accepted, string code,
            JObject payloadWithoutDocument, bool documentFirst, Action<Action<string>> writeDocumentSegments,
            Action<string> writeChunk) {
            using (var chunked = new ChunkedTextWriter(writeChunk))
            using (var jw = new JsonTextWriter(chunked) { Formatting = Formatting.None }) {
                jw.WriteStartObject();
                jw.WritePropertyName("schemaVersion"); jw.WriteValue(SchemaVersion);
                jw.WritePropertyName("kind"); jw.WriteValue(kind);
                jw.WritePropertyName("id"); jw.WriteValue(id ?? "");
                jw.WritePropertyName("sessionId"); jw.WriteValue(sessionId ?? "");
                jw.WritePropertyName("revision"); jw.WriteValue(host.CurrentRevision);
                jw.WritePropertyName("accepted"); jw.WriteValue(accepted);
                jw.WritePropertyName("code");
                if (code != null) jw.WriteValue(code); else jw.WriteNull();
                jw.WritePropertyName("payload");
                jw.WriteStartObject();

                if (documentFirst) {
                    jw.WritePropertyName("document");
                    jw.Flush();
                    chunked.Write('"');
                    writeDocumentSegments(chunked.WriteJsonEscaped);
                    chunked.Write('"');
                    jw.WriteRawValue("");
                }

                if (payloadWithoutDocument != null) {
                    foreach (var prop in payloadWithoutDocument.Properties()) {
                        prop.WriteTo(jw);
                    }
                }

                if (!documentFirst) {
                    jw.WritePropertyName("document");
                    jw.Flush();
                    chunked.Write('"');
                    writeDocumentSegments(chunked.WriteJsonEscaped);
                    chunked.Write('"');
                    jw.WriteRawValue("");
                }

                jw.WriteEndObject();
                jw.WriteEndObject();
                jw.Flush();
                chunked.FlushBuffer();
            }
        }

        sealed class ChunkedTextWriter : System.IO.TextWriter {
            const int FlushThreshold = 32768;
            readonly Action<string> onChunk;
            readonly System.Text.StringBuilder buffer = new System.Text.StringBuilder(FlushThreshold + 1024);

            public ChunkedTextWriter(Action<string> onChunk) : base(System.Globalization.CultureInfo.InvariantCulture) {
                this.onChunk = onChunk;
            }

            public override System.Text.Encoding Encoding => System.Text.Encoding.UTF8;

            public override void Write(char value) {
                buffer.Append(value);
                if (buffer.Length >= FlushThreshold) FlushBuffer();
            }

            public override void Write(string value) {
                if (string.IsNullOrEmpty(value)) return;
                buffer.Append(value);
                if (buffer.Length >= FlushThreshold) FlushBuffer();
            }

            public override void Write(char[] chars, int index, int count) {
                if (chars == null || count <= 0) return;
                buffer.Append(chars, index, count);
                if (buffer.Length >= FlushThreshold) FlushBuffer();
            }

            public void WriteJsonEscaped(string value) {
                if (string.IsNullOrEmpty(value)) return;
                int runStart = 0;
                for (int i = 0; i < value.Length; i++) {
                    char c = value[i];
                    string esc = null;
                    if (c == '"') esc = "\\\"";
                    else if (c == '\\') esc = "\\\\";
                    else if (c < 0x20) {
                        switch (c) {
                            case '\b': esc = "\\b"; break;
                            case '\f': esc = "\\f"; break;
                            case '\n': esc = "\\n"; break;
                            case '\r': esc = "\\r"; break;
                            case '\t': esc = "\\t"; break;
                            default: esc = "\\u" + ((int)c).ToString("x4", System.Globalization.CultureInfo.InvariantCulture); break;
                        }
                    } else if (c == '\u0085') esc = "\\u0085";
                    else if (c == '\u2028') esc = "\\u2028";
                    else if (c == '\u2029') esc = "\\u2029";

                    if (esc != null) {
                        if (i > runStart) buffer.Append(value, runStart, i - runStart);
                        buffer.Append(esc);
                        runStart = i + 1;
                    }
                }
                if (runStart < value.Length) buffer.Append(value, runStart, value.Length - runStart);
                if (buffer.Length >= FlushThreshold) FlushBuffer();
            }

            public void FlushBuffer() {
                if (buffer.Length == 0) return;
                onChunk(buffer.ToString());
                buffer.Clear();
            }
        }

        /// <summary>Decode, dispatch and return exactly one reply envelope as JSON.</summary>
        public string Handle(string json) => Handle(json, out _, null);

        internal string Handle(string json, out StationEditProfiling.CommitTrace committedTrace,
            StationEditProfiling.CommitTrace preStartedTrace = null) {
            StationEditProfiling.CommitTrace outTrace = null;
            try {
                string reply = HandleCore(json, preStartedTrace, out outTrace);
                committedTrace = outTrace;
                return reply;
            } finally {
                if (outTrace != preStartedTrace) preStartedTrace?.Dispose();
            }
        }

        string HandleCore(string json, StationEditProfiling.CommitTrace preStartedTrace,
            out StationEditProfiling.CommitTrace committedTrace) {
            committedTrace = null;
            StationCommand command;
            try {
                using (StationEditProfiling.Measure("StationCommand.Decode")) {
                    command = Decode(json);
                }
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
                    bool includeDocument = command.Payload?["includeDocument"] != null &&
                                           command.Payload["includeDocument"].Type == JTokenType.Boolean &&
                                           (bool)command.Payload["includeDocument"];
                    string savedDoc = includeDocument ? host.SaveDocument() : null;
                    var payload = new JObject {
                        ["revision"] = host.CurrentRevision,
                        ["sourceId"] = host.CurrentSourceId,
                        ["sourceHash"] = host.CurrentSourceHash,
                    };
                    if (includeDocument) payload["document"] = savedDoc ?? "";
                    preStartedTrace?.Dispose();
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
                        var trace = StationEditProfiling.ObserveCommit(command, revisionBefore, preStartedTrace);
                        preStartedTrace = null;
                        string rejectCode, rejectReason;
                        // The handler reads its command fields from this object and writes the
                        // ack fields back into it. Passing an empty object (as an earlier version
                        // did) made every feature handler see no input and reject with bad-payload.
                        JObject payload = command.Payload != null ? (JObject)command.Payload.DeepClone() : new JObject();
                        var audio = new StationEditAudioOutcome(command.Type, payload);
                        bool handled;
                        try {
                            handled = handler.TryHandle(command, payload, out rejectCode, out rejectReason);
                        } catch {
                            trace?.Dispose();
                            throw;
                        }
                        string cue = audio.Cue(handled, host.CurrentRevision != revisionBefore, rejectCode);
                        if (cue != null) host.PublishAudio(new JObject { ["cue"] = cue });
                        if (handled) {
                            if (host.CurrentRevision != revisionBefore) {
                                trace?.Commit(host.CurrentRevision);
                                string reply = CommitOrReject(command, host.CurrentResult(), payload);
                                trace?.Mark("commit-serialized");
                                trace?.EndCommandScope();
                                committedTrace = trace;
                                return reply;
                            }
                            trace?.Dispose();
                            return Ack(command.Id, command.SessionId, payload);
                        }
                        trace?.Dispose();
                        if (!string.IsNullOrEmpty(rejectCode)) {
                            return Reject(command.Id, command.SessionId, rejectCode,
                                rejectReason ?? "The feature handler refused the command.", host.CurrentRevision);
                        }
                        break;
                    }
                    preStartedTrace?.Dispose();
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

        string CommitOrReject(StationCommand command, StationLoadResult result, JObject extraFields = null) {
            if (!result.Accepted) {
                var rejection = result.Rejection;
                return Reject(command.Id, command.SessionId, rejection.Code, rejection.Reason, host.CurrentRevision);
            }
            bool forceFullDocument = string.Equals(command.Type, "station.resync", StringComparison.Ordinal);
            var commitPayload = host.BuildCommitPayload(forceFullDocument, useRawJsonCache: true);
            if (extraFields != null) {
                foreach (var prop in extraFields.Properties()) {
                    if (commitPayload[prop.Name] == null) commitPayload[prop.Name] = prop.Value.DeepClone();
                }
            }
            return Envelope("commit", command.Id, command.SessionId, true, null, commitPayload);
        }

        string Ack(string id, string sessionId, JObject payload) =>
            Envelope("ack", id, sessionId, true, null, payload ?? new JObject());

        string Reject(string id, string sessionId, string code, string reason, int revision) {
            var payload = new JObject { ["reason"] = reason ?? "" };
            var envelope = EnvelopeObject("reject", id, sessionId, false, code, payload);
            envelope["revision"] = revision;
            return envelope.ToString(Formatting.None);
        }

        string Envelope(string kind, string id, string sessionId, bool accepted, string code, JObject payload) {
            var envelope = EnvelopeObject(kind, id, sessionId, accepted, code, payload);
            int capacity = EstimateEnvelopeCapacity(payload);
            var sb = new System.Text.StringBuilder(capacity);
            using (var sw = new System.IO.StringWriter(sb, System.Globalization.CultureInfo.InvariantCulture))
            using (var jw = new JsonTextWriter(sw) { Formatting = Formatting.None }) {
                envelope.WriteTo(jw);
            }
            return sb.ToString();
        }

        static int EstimateEnvelopeCapacity(JObject payload) {
            const int BaseOverhead = 8192;
            if (payload != null && payload["document"] is JValue docVal && docVal.Value is string docText && docText.Length > 0) {
                int extra = 0;
                for (int i = 0; i < docText.Length; i++) {
                    char c = docText[i];
                    if (c == '"' || c == '\\') extra++;
                    else if (c < 0x20) extra += 5;
                }
                return docText.Length + extra + BaseOverhead;
            }
            return 1024;
        }

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
