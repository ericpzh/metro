using System;
using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App.Views {
    /* ------------------------------------------------------------------ the face request */

    /// <summary>
    /// One station-name inscription the browser should paint: the committed text on the
    /// plate it was cut for, in the hand and axis the module saved, with the plate's
    /// measured UV orientation.
    ///
    /// <see cref="Key"/> is the cache's identity for the pixels: the artwork's existing
    /// content key (name, opt-in English, hand, axis, panel) plus
    /// <see cref="StationCalligraphyArtwork.FontVersion"/> (the shared manifest) and the
    /// two orientation bits. Two plates with the same key therefore share one texture, a
    /// rename is a different key, and a manifest bump can never serve old pixels.
    /// </summary>
    public sealed class StationCalligraphyFaceRequest {
        public string ModuleId = "";
        public string Text = "";
        public string English = "";
        public string Style = "kai";
        public string Axis = "h";
        public float PanelWidth = 1f;
        public float PanelHeight = 1.6f;
        public bool ShowEnglish;
        public bool MirrorU;
        public bool FlipV;

        /// <summary>`calligraphyPlate`: the panel's pixels at 512 per metre, at least 64.</summary>
        public int PlateWidth => Math.Max(64, (int)Math.Floor(PanelWidth * StationCalligraphyArtwork.PxPerMetre + .5f));
        public int PlateHeight => Math.Max(64, (int)Math.Floor(PanelHeight * StationCalligraphyArtwork.PxPerMetre + .5f));

        /// <summary>The artwork's own content key (`StationCalligraphyArtwork.ContentKey`).</summary>
        public string ContentKey => StationCalligraphyArtwork.ContentKey(Text, English, ShowEnglish, Style, Axis,
            new Vector2(PanelWidth, PanelHeight));

        /// <summary>The cache identity: content + manifest version + plate orientation.</summary>
        public string Key => StationCalligraphyArtwork.BridgeKey(ContentKey, MirrorU, FlipV);

        /// <summary>One line for a per-ID report: the hand, the axis, the plate and the key.</summary>
        public string Describe() =>
            "calligraphy " + Style + " " + Axis + " " + PlateWidth + "x" + PlateHeight +
            " key " + Short(Key) + " '" + (Text ?? "") + "'";

        static string Short(string key) =>
            string.IsNullOrEmpty(key) ? "?" : key.Length > 16 ? key.Substring(0, 16) : key;
    }

    /// <summary>Who is asking: the session and revision the reply must still belong to.</summary>
    public sealed class StationCalligraphyFaceContext {
        public string SessionId = "";
        public int Revision = -1;
    }

    /* ------------------------------------------------------------------ provider */

    public sealed class StationCalligraphyFaceBatch {
        public string RequestId = "";
        public string Locale = "";
        public StationCalligraphyFaceRequest[] Faces = Array.Empty<StationCalligraphyFaceRequest>();
    }

    public sealed class StationCalligraphyPaintedFace {
        public string Key = "";
        public string ModuleId = "";
        public string Style = "kai";
        public string Axis = "h";
        public int Width;
        public int Height;
        /// <summary>The approved family the browser proved it painted with; "" when it could not.</summary>
        public string ResolvedFamily = "";
        /// <summary>True when the paint fell through to the deliberate last-resort fallback.</summary>
        public bool MissingFace;
        /// <summary>The browser's own one-line verdict (`style=... face=... missing=...`), for the ledger.</summary>
        public string Resolution = "";
        public byte[] Png = Array.Empty<byte>();
    }

    public sealed class StationCalligraphyPendingFace {
        public string Key = "";
        public string ModuleId = "";
        public string Style = "kai";
        public string Axis = "h";
        /// <summary>`font` (retried), `unsupported` or `empty` (final).</summary>
        public string Reason = "";
        public string Detail = "";
    }

    public sealed class StationCalligraphyFaceResponse {
        public string RequestId = "";
        public int Revision = -1;
        public string SessionId = "";
        public string ManifestVersion = "";
        public bool ArtReady;
        public StationCalligraphyPaintedFace[] Painted = Array.Empty<StationCalligraphyPaintedFace>();
        public StationCalligraphyPendingFace[] Pending = Array.Empty<StationCalligraphyPendingFace>();
    }

    /// <summary>
    /// How the browser painter is reached. The Web build ships the request over the plan-11
    /// bridge; an EditMode test injects its own provider and feeds deterministic PNG
    /// fixtures painted by the same `drawCalligraphyPanel`.
    /// </summary>
    public interface IStationCalligraphyFaceProvider : IDisposable {
        /// <summary>Publish one batch (already bounded to <see cref="StationCalligraphyFaceCache.MaxRequestFaces"/>).</summary>
        /// <returns>False when no transport could deliver it, so the caller keeps every face retryable.</returns>
        bool Request(StationCalligraphyFaceBatch batch);
        /// <summary>Take one completed reply, if any. Never blocks.</summary>
        bool TryTake(out StationCalligraphyFaceResponse response);
        void Cancel(string requestId);
    }

    /// <summary>
    /// The bridge provider: `calligraphy.requestFace` out, `calligraphy.faceChunk` /
    /// `calligraphy.faceReady` in, with the shared 48 KiB slice and the session/revision
    /// fence the sign, PSD and exit painters use.
    ///
    /// A request is a v2 envelope with `kind: "calligraphyRequest"`; the painter answers
    /// with `calligraphy.faceReady.manifestVersion`, so a shell running a different face
    /// manifest is visible to the C# side instead of quietly serving other pixels.
    /// </summary>
    public sealed class StationCalligraphyWebProvider : IStationCalligraphyFaceProvider {
        /// <summary>Largest base64 slice accepted in one `calligraphy.faceChunk` (the sender uses 48 KiB).</summary>
        public const int MaxChunkCharacters = 64 * 1024;
        /// <summary>Largest assembled PNG accepted for one face, bytes.</summary>
        public const int MaxPngBytes = 16 * 1024 * 1024;

        sealed class Assembly {
            public string Key = "";
            public string Style = "kai";
            public string Axis = "h";
            public int Width;
            public int Height;
            public int Count;
            public int Received;
            public string ModuleId = "";
            public readonly Dictionary<int, string> Parts = new Dictionary<int, string>();
        }

        readonly Func<string, bool> send;
        readonly Func<StationCalligraphyFaceContext> context;
        readonly Dictionary<string, int> requestRevisions = new Dictionary<string, int>(StringComparer.Ordinal);
        readonly Dictionary<string, Dictionary<string, Assembly>> assemblies =
            new Dictionary<string, Dictionary<string, Assembly>>(StringComparer.Ordinal);
        readonly Queue<StationCalligraphyFaceResponse> completed = new Queue<StationCalligraphyFaceResponse>();
        bool disposed;

        public StationCalligraphyWebProvider(Func<string, bool> send, Func<StationCalligraphyFaceContext> context) {
            this.send = send ?? throw new ArgumentNullException(nameof(send));
            this.context = context ?? (() => new StationCalligraphyFaceContext());
        }

        /// <summary>How many requests are waiting for their `calligraphy.faceReady`.</summary>
        public int OpenRequests => requestRevisions.Count;
        /// <summary>Batches this world could not publish (no transport); each stays retryable.</summary>
        public int DroppedRequests { get; private set; }
        /// <summary>Replies dropped because they named another session or an older revision.</summary>
        public int FencedReplies { get; private set; }
        /// <summary>The last publication failure, for the artwork ledger.</summary>
        public string LastPublishError { get; private set; } = "";

        /// <summary>True when this message belongs to the inscription painter.</summary>
        public static bool Handles(string type) =>
            type == "calligraphy.faceChunk" || type == "calligraphy.faceReady";

        public bool Request(StationCalligraphyFaceBatch batch) {
            if (disposed || batch == null || batch.Faces == null || batch.Faces.Length == 0) return false;
            var current = context() ?? new StationCalligraphyFaceContext();
            requestRevisions[batch.RequestId] = current.Revision;
            assemblies[batch.RequestId] = new Dictionary<string, Assembly>(StringComparer.Ordinal);

            var faces = new JArray();
            foreach (var face in batch.Faces) faces.Add(FaceJson(face));
            var payload = new JObject {
                ["requestId"] = batch.RequestId,
                ["locale"] = batch.Locale ?? "",
                ["faces"] = faces,
            };
            var envelope = new JObject {
                ["schemaVersion"] = 2,
                ["kind"] = "calligraphyRequest",
                ["type"] = "calligraphy.requestFace",
                ["id"] = batch.RequestId,
                ["sessionId"] = current.SessionId ?? "",
                ["revision"] = current.Revision,
                ["payload"] = payload,
            };
            if (!send(envelope.ToString(Formatting.None))) {
                // No route (a batch build with no shell, a desktop player whose presenter
                // never attached). The cache keeps every face wanted and retries after the
                // window — or paints natively when the caller asks it to.
                DroppedRequests++;
                LastPublishError = "publish-unavailable";
                Cancel(batch.RequestId);
                return false;
            }
            LastPublishError = "";
            return true;
        }

        static JObject FaceJson(StationCalligraphyFaceRequest face) => new JObject {
            ["key"] = face.Key,
            ["moduleId"] = face.ModuleId ?? "",
            ["text"] = face.Text ?? "",
            ["english"] = face.ShowEnglish ? face.English ?? "" : "",
            ["style"] = face.Style ?? "kai",
            ["axis"] = face.Axis ?? "h",
            ["w"] = face.PanelWidth,
            ["h"] = face.PanelHeight,
            ["showEnglish"] = face.ShowEnglish,
            ["mirrorU"] = face.MirrorU,
            ["flipV"] = face.FlipV,
        };

        /* -------------------------------------------------------------- replies */

        /// <summary>Route one C# → JS command here: `calligraphy.faceChunk` or `calligraphy.faceReady`.</summary>
        public bool Receive(string json) {
            if (disposed || string.IsNullOrEmpty(json)) return false;
            JObject message;
            try { message = JObject.Parse(json); } catch { return false; }
            var type = (string)message["type"] ?? "";
            if (!Handles(type)) return false;
            var payload = message["payload"] as JObject;
            if (payload == null) return true;
            var requestId = String(payload, "requestId");
            if (requestId.Length == 0) return true;
            if (!requestRevisions.TryGetValue(requestId, out var sentRevision)) return true;
            var current = context() ?? new StationCalligraphyFaceContext();
            // Fence: a reply from another session, or for a revision this station has moved
            // past, is a picture of an inscription that no longer exists.
            var sessionId = String(payload, "sessionId");
            if (sessionId.Length > 0 && current.SessionId.Length > 0 && sessionId != current.SessionId) {
                FencedReplies++;
                Cancel(requestId);
                return true;
            }
            var revision = Int(payload, "revision", -1);
            if (revision >= 0 && revision < sentRevision) {
                FencedReplies++;
                Cancel(requestId);
                return true;
            }
            if (type == "calligraphy.faceChunk") Chunk(requestId, payload);
            else Ready(requestId, payload);
            return true;
        }

        void Chunk(string requestId, JObject payload) {
            if (!assemblies.TryGetValue(requestId, out var faces)) return;
            var key = String(payload, "key");
            if (key.Length == 0) return;
            var index = Int(payload, "index", -1);
            var count = Int(payload, "count", 0);
            var data = String(payload, "data");
            if (index < 0 || count <= 0 || index >= count || data.Length == 0 || data.Length > MaxChunkCharacters) return;
            var width = Int(payload, "width", 0);
            var height = Int(payload, "height", 0);
            if (!faces.TryGetValue(key, out var assembly)) {
                assembly = new Assembly {
                    Key = key,
                    Style = String(payload, "style"),
                    Axis = String(payload, "axis"),
                    Width = width,
                    Height = height,
                    Count = count,
                    ModuleId = String(payload, "moduleId"),
                };
                faces[key] = assembly;
            }
            if (assembly.Count != count || assembly.Width != width || assembly.Height != height) return;
            if (assembly.Parts.ContainsKey(index)) return;
            assembly.Parts[index] = data;
            assembly.Received++;
        }

        void Ready(string requestId, JObject payload) {
            var assembled = assemblies.TryGetValue(requestId, out var faces) ? faces : null;
            var painted = new List<StationCalligraphyPaintedFace>();
            var pending = new List<StationCalligraphyPendingFace>();
            if (payload["painted"] is JArray paintedJson) {
                foreach (var token in paintedJson) {
                    if (!(token is JObject faceJson)) continue;
                    var key = String(faceJson, "key");
                    if (key.Length == 0) continue;
                    if (assembled == null || !assembled.TryGetValue(key, out var assembly)) continue;
                    if (assembly.Received != assembly.Count || assembly.Parts.Count != assembly.Count) continue;
                    var base64 = new StringBuilder();
                    for (int i = 0; i < assembly.Count; i++) {
                        if (!assembly.Parts.TryGetValue(i, out var part)) { base64 = null; break; }
                        base64.Append(part);
                    }
                    if (base64 == null || base64.Length == 0) continue;
                    byte[] png;
                    try { png = Convert.FromBase64String(base64.ToString()); } catch { continue; }
                    if (png.Length == 0 || png.Length > MaxPngBytes) continue;
                    var declaredBytes = Int(faceJson, "bytes", -1);
                    if (declaredBytes >= 0 && declaredBytes != png.Length) continue;
                    var width = Int(faceJson, "width", assembly.Width);
                    var height = Int(faceJson, "height", assembly.Height);
                    if (width != assembly.Width || height != assembly.Height) continue;
                    painted.Add(new StationCalligraphyPaintedFace {
                        Key = key,
                        ModuleId = assembly.ModuleId,
                        Style = assembly.Style,
                        Axis = assembly.Axis,
                        Width = width,
                        Height = height,
                        ResolvedFamily = String(faceJson, "resolvedFamily"),
                        MissingFace = faceJson["missingFace"] != null && faceJson["missingFace"].Type == JTokenType.Boolean &&
                            (bool)faceJson["missingFace"],
                        Resolution = String(faceJson, "resolution"),
                        Png = png,
                    });
                }
            }
            if (payload["pending"] is JArray pendingJson) {
                foreach (var token in pendingJson) {
                    if (!(token is JObject faceJson)) continue;
                    var key = String(faceJson, "key");
                    if (key.Length == 0) continue;
                    pending.Add(new StationCalligraphyPendingFace {
                        Key = key,
                        ModuleId = String(faceJson, "moduleId"),
                        Style = String(faceJson, "style"),
                        Axis = String(faceJson, "axis"),
                        Reason = String(faceJson, "reason"),
                        Detail = String(faceJson, "detail"),
                    });
                }
            }
            completed.Enqueue(new StationCalligraphyFaceResponse {
                RequestId = requestId,
                Revision = Int(payload, "revision", -1),
                SessionId = String(payload, "sessionId"),
                ManifestVersion = String(payload, "manifestVersion"),
                ArtReady = payload["artReady"] != null && payload["artReady"].Type == JTokenType.Boolean && (bool)payload["artReady"],
                Painted = painted.ToArray(),
                Pending = pending.ToArray(),
            });
            Cancel(requestId);
        }

        static string String(JObject value, string name) =>
            value[name] != null && value[name].Type == JTokenType.String ? (string)value[name] ?? "" : "";

        static int Int(JObject value, string name, int fallback) {
            if (value[name] == null) return fallback;
            var token = value[name];
            if (token.Type == JTokenType.Integer) return (int)token;
            if (token.Type == JTokenType.Float) return (int)Math.Round((double)token);
            return fallback;
        }

        public bool TryTake(out StationCalligraphyFaceResponse response) {
            if (completed.Count == 0) { response = null; return false; }
            response = completed.Dequeue();
            return true;
        }

        public void Cancel(string requestId) {
            if (string.IsNullOrEmpty(requestId)) return;
            requestRevisions.Remove(requestId);
            assemblies.Remove(requestId);
        }

        public void Dispose() {
            disposed = true;
            requestRevisions.Clear();
            assemblies.Clear();
            completed.Clear();
        }
    }

    /* ------------------------------------------------------------------ the cache */

    /// <summary>
    /// One live inscription slot: the renderer whose material shows the plate, and the
    /// material the reply's pixels are swapped into. The cache owns the pixels, never the
    /// renderer: the same material may be shared by every plate with this key.
    /// </summary>
    public sealed class StationCalligraphyFaceBinding {
        public string Key = "";
        public string ModuleId = "";
        public string Style = "kai";
        public string Axis = "h";
        public MeshRenderer Renderer;
        public Material Material;
        public StationWorldView World;
        /// <summary>The native painter for this plate; null when there is no font to paint with.</summary>
        public Func<Texture2D> NativePaint;
        public Texture2D Texture { get; internal set; }
        public string Fingerprint { get; internal set; } = "";
    }

    /// <summary>
    /// The station's inscription textures, by content.
    ///
    /// A plate is a function of its name, hand, axis, panel, the measured plate orientation
    /// and the shared manifest version, so two inscriptions carrying the same content share
    /// one texture and a rename is a different plate. The cache owns the requests (bounded
    /// batches of <see cref="MaxRequestFaces"/>), the upload, the retry of faces the browser
    /// reported not-ready, and the **native fallback** for a request no transport could
    /// deliver — a headless build or a desktop player with no React shell still gets an
    /// inscription, painted by `StationCalligraphyArtwork.PaintTexture` (the same uniform
    /// scene font as before), instead of a transparent plate.
    ///
    /// It never leaks a texture: every pixel it decodes or paints is owned by one entry and
    /// freed by <see cref="Dispose"/>, which runs with the world that requested it.
    /// </summary>
    public sealed class StationCalligraphyFaceCache : IDisposable {
        /// <summary>Faces one `calligraphy.requestFace` may carry, so one message stays small.</summary>
        public const int MaxRequestFaces = 32;
        /// <summary>How long a face reported not-ready waits before it is asked for again.</summary>
        public const float RetrySeconds = 1f;

        sealed class Entry {
            public string Key = "";
            public Texture2D Texture;
            public string Fingerprint = "";
            public string ResolvedFamily = "";
            public bool MissingFace;
            public bool Browser;
        }

        readonly IStationCalligraphyFaceProvider provider;
        readonly Action<string> note;
        readonly string requestPrefix;
        readonly Dictionary<string, Entry> entries = new Dictionary<string, Entry>(StringComparer.Ordinal);
        readonly Dictionary<string, List<StationCalligraphyFaceBinding>> bindings =
            new Dictionary<string, List<StationCalligraphyFaceBinding>>(StringComparer.Ordinal);
        readonly Dictionary<string, StationCalligraphyFaceRequest> wanted =
            new Dictionary<string, StationCalligraphyFaceRequest>(StringComparer.Ordinal);
        readonly Dictionary<string, float> askedAt = new Dictionary<string, float>(StringComparer.Ordinal);
        readonly Dictionary<string, int> attempts = new Dictionary<string, int>(StringComparer.Ordinal);
        /// <summary>Keys whose "no reply" caveat is already in the ledger (one line per plate).</summary>
        readonly HashSet<string> nagged = new HashSet<string>(StringComparer.Ordinal);
        int counter;
        bool disposed;

        public StationCalligraphyFaceCache(IStationCalligraphyFaceProvider provider, Action<string> note = null,
            string requestPrefix = "calligraphy-req") {
            this.provider = provider ?? throw new ArgumentNullException(nameof(provider));
            this.note = note ?? (_ => { });
            this.requestPrefix = string.IsNullOrEmpty(requestPrefix) ? "calligraphy-req" : requestPrefix;
        }

        /// <summary>Textures currently held (browser-painted or native fallback).</summary>
        public int TextureCount => entries.Count;
        /// <summary>Faces still waiting for pixels (queued or asked for).</summary>
        public int PendingCount => wanted.Count;
        /// <summary>Textures the browser painted.</summary>
        public int BrowserPaintedCount { get; private set; }
        /// <summary>Textures painted natively because no transport could deliver the request.</summary>
        public int NativeFallbackCount { get; private set; }
        /// <summary>Painted faces whose approved hand was not present on the machine.</summary>
        public int MissingFaceCount { get; private set; }
        /// <summary>True when this scope has produced at least one browser-painted texture.</summary>
        public bool AnyBrowserPainted => BrowserPaintedCount > 0;
        /// <summary>The last failure, for the scope's ledger.</summary>
        public string LastError { get; private set; } = "";
        /// <summary>The shell's manifest version when it differs from <see cref="StationCalligraphyArtwork.FontVersion"/>.</summary>
        public string ManifestMismatch { get; private set; } = "";

        /// <summary>True when this key's pixels came from the browser (not a native fallback).</summary>
        public bool IsBrowserPainted(string key) =>
            !string.IsNullOrEmpty(key) && entries.TryGetValue(key, out var entry) && entry.Browser;

        /// <summary>True when this key's pixels were painted by the native fallback.</summary>
        public bool IsNativeFallback(string key) =>
            !string.IsNullOrEmpty(key) && entries.TryGetValue(key, out var entry) && !entry.Browser;

        /// <summary>
        /// Register one slot for a plate. A cached texture applies at once; a missing one is
        /// queued (the caller pumps) and every slot waiting for the same key is repainted
        /// when the reply lands. A slot always registers, so a plate that shares a material
        /// with an earlier inscription still recaptures when the pixels arrive.
        /// </summary>
        public void Bind(StationCalligraphyFaceBinding binding, StationCalligraphyFaceRequest request) {
            if (disposed || binding == null || request == null) return;
            binding.Key = request.Key;
            if (entries.TryGetValue(request.Key, out var entry) && entry.Texture != null) {
                Apply(entry, binding);
                return;
            }
            if (!bindings.TryGetValue(request.Key, out var list)) {
                bindings[request.Key] = list = new List<StationCalligraphyFaceBinding>(2);
            }
            if (!list.Contains(binding)) list.Add(binding);
            if (!wanted.ContainsKey(request.Key)) wanted[request.Key] = request;
        }

        /// <summary>Remove bindings for retired or rebound modules and prune any wanted keys left without bindings.</summary>
        public void Unbind(HashSet<string> moduleIds) {
            if (disposed || moduleIds == null || moduleIds.Count == 0) return;
            List<string> emptyKeys = null;
            foreach (var pair in bindings) {
                var list = pair.Value;
                if (list == null) {
                    (emptyKeys ??= new List<string>()).Add(pair.Key);
                    continue;
                }
                for (int i = list.Count - 1; i >= 0; i--) {
                    var b = list[i];
                    if (b == null || (!string.IsNullOrEmpty(b.ModuleId) && moduleIds.Contains(b.ModuleId))) {
                        list.RemoveAt(i);
                    }
                }
                if (list.Count == 0) (emptyKeys ??= new List<string>()).Add(pair.Key);
            }
            if (emptyKeys != null) {
                for (int i = 0; i < emptyKeys.Count; i++) {
                    var key = emptyKeys[i];
                    bindings.Remove(key);
                    wanted.Remove(key);
                    Forget(key);
                    nagged.Remove(key);
                }
            }
        }

        public void Unbind(string moduleId) {
            if (disposed || string.IsNullOrEmpty(moduleId)) return;
            List<string> emptyKeys = null;
            foreach (var pair in bindings) {
                var list = pair.Value;
                if (list == null) {
                    (emptyKeys ??= new List<string>()).Add(pair.Key);
                    continue;
                }
                for (int i = list.Count - 1; i >= 0; i--) {
                    var b = list[i];
                    if (b == null || string.Equals(b.ModuleId, moduleId, StringComparison.Ordinal)) {
                        list.RemoveAt(i);
                    }
                }
                if (list.Count == 0) (emptyKeys ??= new List<string>()).Add(pair.Key);
            }
            if (emptyKeys != null) {
                for (int i = 0; i < emptyKeys.Count; i++) {
                    var key = emptyKeys[i];
                    bindings.Remove(key);
                    wanted.Remove(key);
                    Forget(key);
                    nagged.Remove(key);
                }
            }
        }

        /// <summary>
        /// Drain replies, upload what arrived, ask for anything still missing and paint
        /// natively anything no transport could carry. The command handler calls this after
        /// every delivery; the per-world pump calls it every frame for the retry window.
        /// </summary>
        public void Pump() {
            if (disposed) return;
            while (provider.TryTake(out var response)) Apply(response);
            if (wanted.Count == 0) return;
            float now = Time.realtimeSinceStartup;
            var keys = new List<string>(Math.Min(MaxRequestFaces, wanted.Count));
            foreach (var key in wanted.Keys) {
                if (!ReadyToAsk(key, now)) continue;
                keys.Add(key);
                if (keys.Count >= MaxRequestFaces) break;
            }
            if (keys.Count == 0) return;
            var batch = new StationCalligraphyFaceBatch {
                RequestId = requestPrefix + "-" + (++counter),
                Locale = "",
                Faces = new StationCalligraphyFaceRequest[keys.Count],
            };
            for (int i = 0; i < keys.Count; i++) {
                batch.Faces[i] = wanted[keys[i]];
                askedAt[keys[i]] = now;
                attempts.TryGetValue(keys[i], out var attempt);
                attempts[keys[i]] = attempt + 1;
                if (attempt + 1 >= 4 && nagged.Add(keys[i])) {
                    // The shell accepted the envelope but never answered; the plate keeps its
                    // transparent placeholder and the retry window. Name it so a verifier does
                    // not have to infer a missing painter from a blank wall.
                    note("calligraphy-unresolved:" + (wanted[keys[i]].ModuleId ?? "") + ":no-browser-reply");
                }
            }
            if (provider.Request(batch)) return;
            // No route this frame: paint the batch natively now rather than leaving the
            // walls blank until a transport that may never come.
            for (int i = 0; i < keys.Count; i++) Fallback(keys[i], "bridge-unavailable");
        }

        /// <summary>
        /// True when a missing plate may be asked for again. A font that never lands backs
        /// off 1→2→4→…→64 s instead of asking every second for the session.
        /// </summary>
        bool ReadyToAsk(string key, float now) {
            if (!askedAt.TryGetValue(key, out var asked)) return true;
            attempts.TryGetValue(key, out var attempt);
            float delay = RetrySeconds * Mathf.Pow(2f, Mathf.Clamp(attempt - 1, 0, 6));
            return now - asked >= delay;
        }

        void Forget(string key) {
            askedAt.Remove(key);
            attempts.Remove(key);
        }

        void Apply(StationCalligraphyFaceResponse response) {
            if (response == null) return;
            if (!string.IsNullOrEmpty(response.ManifestVersion) &&
                !string.Equals(response.ManifestVersion, StationCalligraphyArtwork.FontVersion, StringComparison.Ordinal)) {
                if (ManifestMismatch.Length == 0) {
                    ManifestMismatch = response.ManifestVersion;
                    LastError = "manifest-mismatch: " + StationCalligraphyArtwork.FontVersion + " != " + response.ManifestVersion;
                    note("calligraphy-font-version:" + StationCalligraphyArtwork.FontVersion + "!=" + response.ManifestVersion);
                }
            }
            foreach (var painted in response.Painted ?? Array.Empty<StationCalligraphyPaintedFace>()) {
                if (painted == null || painted.Png == null || painted.Png.Length == 0) continue;
                if (!wanted.TryGetValue(painted.Key, out var request)) continue; // stale: no plate wants it now
                if (painted.Width != request.PlateWidth || painted.Height != request.PlateHeight) {
                    LastError = "bad-size:" + Short(painted.Key);
                    note("calligraphy-unresolved:" + (request.ModuleId ?? "") + ":bad-size");
                    continue;
                }
                if (entries.ContainsKey(painted.Key)) continue;                  // already painted by another batch
                var texture = Decode(painted.Png, painted.Width, painted.Height, "calligraphy face " + Short(painted.Key));
                if (texture == null) {
                    LastError = "decode-failed:" + Short(painted.Key);
                    note("calligraphy-unresolved:" + (request.ModuleId ?? "") + ":decode-failed");
                    continue;
                }
                var entry = new Entry {
                    Key = painted.Key,
                    Texture = texture,
                    Fingerprint = Short(painted.Key) + "@" + painted.Width + "x" + painted.Height,
                    ResolvedFamily = painted.ResolvedFamily ?? "",
                    MissingFace = painted.MissingFace,
                    Browser = true,
                };
                entries[painted.Key] = entry;
                wanted.Remove(painted.Key);
                Forget(painted.Key);
                BrowserPaintedCount++;
                if (painted.MissingFace) {
                    MissingFaceCount++;
                    var fallback = string.IsNullOrEmpty(painted.ResolvedFamily) ? "fallback" : painted.ResolvedFamily;
                    note("calligraphy-face-missing:" + (request.ModuleId ?? "") + ":" + request.Style + ":" + fallback +
                        (string.IsNullOrEmpty(painted.Resolution) ? "" : ":" + painted.Resolution));
                } else {
                    var face = string.IsNullOrEmpty(painted.ResolvedFamily) ? "unverified" : painted.ResolvedFamily;
                    note("calligraphy-face:" + (request.ModuleId ?? "") + ":" + request.Style + ":" + face +
                        (string.IsNullOrEmpty(painted.Resolution) ? "" : ":" + painted.Resolution));
                }
                if (bindings.TryGetValue(painted.Key, out var list)) {
                    for (int i = 0; i < list.Count; i++) Apply(entry, list[i]);
                }
            }
            foreach (var pending in response.Pending ?? Array.Empty<StationCalligraphyPendingFace>()) {
                if (pending == null || !wanted.ContainsKey(pending.Key)) continue;
                // A face with nothing printable, or an unsupported record, is final: paint it
                // with the native fallback instead of asking forever. A font that has not
                // landed keeps its place in the queue for the retry window.
                if (pending.Reason == "empty" || pending.Reason == "unsupported") {
                    Fallback(pending.Key, "browser-" + (string.IsNullOrEmpty(pending.Reason) ? "refused" : pending.Reason));
                }
            }
        }

        /// <summary>
        /// Paint one wanted plate with the native fallback. The texture becomes the key's
        /// entry (so a later bind of the same content reuses it) and is swapped into the
        /// material the plate already wears — the world recaptures the part, exactly as if
        /// the browser had answered.
        /// </summary>
        void Fallback(string key, string detail) {
            if (disposed || string.IsNullOrEmpty(key)) return;
            wanted.Remove(key);
            Forget(key);
            if (entries.ContainsKey(key)) return;
            if (!bindings.TryGetValue(key, out var list) || list.Count == 0) return;
            var binding = list[0];
            Texture2D texture = null;
            try {
                texture = binding.NativePaint != null ? binding.NativePaint() : null;
            } catch (Exception error) {
                LastError = error.GetType().Name + ": " + error.Message;
                note("calligraphy-unresolved:" + (binding.ModuleId ?? "") + ":fallback-failed:" + error.Message);
                return;
            }
            if (texture == null) {
                // A scope with no scene font cannot paint at all: say so instead of keeping a
                // transparent plate and pretending the inscription bound.
                LastError = "no-native-fallback";
                note("calligraphy-unresolved:" + (binding.ModuleId ?? "") + ":no-native-fallback");
                return;
            }
            var entry = new Entry {
                Key = key,
                Texture = texture,
                Fingerprint = "native",
                Browser = false,
            };
            entries[key] = entry;
            NativeFallbackCount++;
            note("calligraphy-paint:" + (binding.ModuleId ?? "") + ":" + (string.IsNullOrEmpty(detail) ? "native-fallback" : detail));
            for (int i = 0; i < list.Count; i++) Apply(entry, list[i]);
        }

        void Apply(Entry entry, StationCalligraphyFaceBinding binding) {
            if (entry == null || binding == null) return;
            binding.Texture = entry.Texture;
            binding.Fingerprint = entry.Fingerprint;
            ApplyInkTexture(binding.Material, entry.Texture);
            if (binding.World != null) binding.World.RecaptureArtwork(binding.Renderer);
        }

        /// <summary>
        /// Put a painted panel on the plate's instance material. Exactly the slots the native
        /// painter set (`_BaseMap` + white `_BaseColor`); the plate's own UVs and stand-off
        /// are untouched, and the ink stays transparent between the strokes.
        /// </summary>
        internal static void ApplyInkTexture(Material material, Texture2D texture) {
            if (material == null) return;
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", texture);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", Color.white);
            else material.color = Color.white;
        }

        static Texture2D Decode(byte[] png, int width, int height, string name) {
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!texture.LoadImage(png, false)) { Destroy(texture); return null; }
            if (texture.width != width || texture.height != height) { Destroy(texture); return null; }
            texture.name = name;
            texture.wrapMode = TextureWrapMode.Clamp;
            texture.filterMode = FilterMode.Bilinear;
            texture.anisoLevel = 4;
            return texture;
        }

        static string Short(string key) =>
            string.IsNullOrEmpty(key) ? "?" : key.Length > 16 ? key.Substring(0, 16) : key;

        static void Destroy(UnityEngine.Object value) {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }

        public void Dispose() {
            if (disposed) return;
            disposed = true;
            provider.Dispose();
            foreach (var entry in entries.Values) Destroy(entry.Texture);
            entries.Clear();
            bindings.Clear();
            wanted.Clear();
            askedAt.Clear();
            attempts.Clear();
            nagged.Clear();
        }
    }

    /// <summary>The per-frame retry tick for faces the browser reported not-ready.</summary>
    public sealed class StationCalligraphyPump : MonoBehaviour {
        public StationCalligraphyFaceCache Cache;
        void Update() {
            if (Cache != null) Cache.Pump();
        }
    }

    /// <summary>
    /// The `calligraphy.*` command handler: the painter's replies are acknowledgements, not
    /// commits — they swap a texture into a plate's instance material and never touch the
    /// document, exactly like `sign.faceChunk` and `exit.faceChunk`.
    /// </summary>
    public sealed class StationCalligraphyCommandHandler : IStationCommandHandler {
        public string Capability => "calligraphy";

        public bool Handles(string type) =>
            StationCalligraphyWebProvider.Handles(type);

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = null;
            rejectReason = null;
            if (command == null) return true;
            StationCalligraphyArtwork.Receive(command.Raw);
            // A reply may complete several plates at once; the cache applies them and asks
            // for anything still missing (a font that has not landed yet).
            StationCalligraphyArtwork.Pump();
            return true;
        }
    }

    /// <summary>
    /// The packet's registration: the host snapshots the command registry at `Awake`, so a
    /// new artwork family never edits the host (plan 11's zero-wiring contract).
    /// </summary>
    public static class StationCalligraphyArtworkPacket {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() {
            StationCommandHandlers.Add(new StationCalligraphyCommandHandler());
        }
    }
}
