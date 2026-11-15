using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /* ------------------------------------------------------------------ the face request */

    /// <summary>
    /// One board face the browser should paint: the face's own normalized components,
    /// on the pair's panel, with the live line facts a shield prints.
    ///
    /// <see cref="ContentKey"/> is the cache's identity for the pixels: it covers the
    /// face, the panel's metres, every component (in paint order), the **resolved**
    /// line facts a shield prints and the locale the type is set in. Two signs with
    /// the same board therefore share one texture, and a changed component, colour or
    /// locale is a different key rather than a stale texture.
    /// </summary>
    public sealed class StationSignFaceRequest {
        /// <summary>`PX_PER_METRE` from `sim/sign.ts`: one plate is 512 px per metre.</summary>
        public const int PixelsPerMetre = 512;

        public string ModuleId = "";
        public StationSignFaceName Face;
        public float PanelWidth = StationSignMounts.PanelMinWidth;
        public float PanelHeight = StationSignMounts.PanelMinHeight;
        public StationSignComponent[] Components = StationSignBoards.NoComponents;
        public StationSignLine[] Lines = Array.Empty<StationSignLine>();
        public string DefaultLineId = "";
        public string Locale = "zh-CN";

        string key;

        /// <summary>`signPlate(panel)`: the plate's pixels, at least 64 on either axis.</summary>
        public int PlateWidth => Math.Max(64, (int)Math.Floor(PanelWidth * PixelsPerMetre + 0.5f));
        public int PlateHeight => Math.Max(64, (int)Math.Floor(PanelHeight * PixelsPerMetre + 0.5f));

        /// <summary>True when the face's pixels depend on the font (type or a shield's gloss).</summary>
        public bool DependsOnFont {
            get {
                foreach (var component in Components ?? StationSignBoards.NoComponents) {
                    if (component.Kind == StationSignComponentKind.Text || component.Kind == StationSignComponentKind.Line) return true;
                }
                return false;
            }
        }

        /// <summary>The lines a change to which must reprint this face (resolved ids).</summary>
        public string[] LineDependencies {
            get {
                var ids = new List<string>(2);
                foreach (var component in Components ?? StationSignBoards.NoComponents) {
                    if (component.Kind != StationSignComponentKind.Line) continue;
                    var line = ResolveLine(component);
                    if (line.HasValue && line.Value.Id.Length > 0 && !ids.Contains(line.Value.Id)) ids.Add(line.Value.Id);
                }
                ids.Sort(StringComparer.Ordinal);
                return ids.ToArray();
            }
        }

        /// <summary>The line a shield prints: the bound one, else the default, else the first.</summary>
        public StationSignLine? ResolveLine(StationSignComponent component) {
            var lines = Lines ?? Array.Empty<StationSignLine>();
            var id = component.LineId ?? "";
            if (id.Length == 0) id = DefaultLineId ?? "";
            if (id.Length > 0) {
                foreach (var line in lines) if (line.Id == id) return line;
            }
            return lines.Length > 0 ? lines[0] : (StationSignLine?)null;
        }

        /// <summary>The content-addressed cache key. Stable across runs and machines.</summary>
        public string ContentKey {
            get {
                if (key != null) return key;
                var text = new StringBuilder(256);
                text.Append("sign-face/1\nface=").Append(StationSignVocabulary.Face(Face));
                text.Append("\npanel=").Append(Number(PanelWidth)).Append('x').Append(Number(PanelHeight));
                text.Append("\nlocale=").Append(Locale ?? "");
                text.Append("\ndefaultLine=").Append(DefaultLineId ?? "");
                text.Append("\nlines=");
                var lines = Lines ?? Array.Empty<StationSignLine>();
                var resolved = new List<string>(4);
                foreach (var component in Components ?? StationSignBoards.NoComponents) {
                    if (component.Kind != StationSignComponentKind.Line) continue;
                    var line = ResolveLine(component);
                    resolved.Add(line.HasValue
                        ? line.Value.Id + "/" + line.Value.Name + "/" + line.Value.Colour
                        : "-");
                }
                resolved.Sort(StringComparer.Ordinal);
                text.Append(string.Join(";", resolved.ToArray()));
                text.Append("\ncomponents=");
                foreach (var component in Components ?? StationSignBoards.NoComponents) {
                    // No component id: two boards whose marks are in the same place are
                    // the same picture, and the painter never reads an id — a sign that
                    // numbers its marks `c1…c3` and one that numbers them `c3…c6` with the
                    // same content must share one texture.
                    text.Append(component.Kind).Append('|');
                    text.Append(Number(component.X)).Append('|').Append(Number(component.Y)).Append('|');
                    text.Append(Number(component.ClampedScale)).Append('|').Append(component.Side ?? "both").Append('|');
                    switch (component.Kind) {
                        case StationSignComponentKind.Arrow:
                            text.Append("arrow=").Append(StationSignVocabulary.Arrow(component.Arrow));
                            break;
                        case StationSignComponentKind.Icon:
                            text.Append("icon=").Append(StationSignVocabulary.Icon(component.Icon));
                            break;
                        case StationSignComponentKind.Line:
                            text.Append("line=").Append(component.LineId ?? "").Append(",en=").Append(component.English ? '1' : '0');
                            break;
                        case StationSignComponentKind.Text:
                            text.Append("text=").Append((component.Text ?? "").Length).Append(':').Append(component.Text ?? "");
                            break;
                    }
                    text.Append(';');
                }
                key = Hash(text.ToString());
                return key;
            }
        }

        static string Number(float value) => value.ToString("0.####", CultureInfo.InvariantCulture);

        internal static string Hash(string text) {
            using (var sha = SHA256.Create()) {
                var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(text));
                var builder = new StringBuilder(bytes.Length * 2);
                foreach (var value in bytes) builder.Append(value.ToString("x2", CultureInfo.InvariantCulture));
                return builder.ToString();
            }
        }

        /// <summary>One line for a per-ID report: which board this is and what it carries.</summary>
        public string Describe() =>
            StationSignVocabulary.Face(Face) + " " + PlateWidth + "x" + PlateHeight + " key " + (ContentKey.Length > 16 ? ContentKey.Substring(0, 16) : ContentKey) +
            " components " + (Components?.Length ?? 0);
    }

    /// <summary>Who is asking: the session and revision the reply must still belong to.</summary>
    public sealed class StationSignContext {
        public string SessionId = "";
        public int Revision = -1;
    }

    /* ------------------------------------------------------------------ provider */

    public sealed class StationSignFaceBatch {
        public string RequestId = "";
        public string Locale = "zh-CN";
        public StationSignFaceRequest[] Faces = Array.Empty<StationSignFaceRequest>();
    }

    public sealed class StationSignPaintedFace {
        public string Key = "";
        public string ModuleId = "";
        public StationSignFaceName Face;
        public int Width;
        public int Height;
        public byte[] Png = Array.Empty<byte>();
    }

    public sealed class StationSignPendingFace {
        public string Key = "";
        public string ModuleId = "";
        public StationSignFaceName Face;
        /// <summary>`font`, `pictogram`, `unsupported` or `empty` (`sim/sign.ts`'s readiness reasons).</summary>
        public string Reason = "";
        public string Detail = "";
    }

    public sealed class StationSignFaceResponse {
        public string RequestId = "";
        public int Revision = -1;
        public string SessionId = "";
        public bool ArtReady;
        public StationSignPaintedFace[] Painted = Array.Empty<StationSignPaintedFace>();
        public StationSignPendingFace[] Pending = Array.Empty<StationSignPendingFace>();
    }

    /// <summary>
    /// How the painter is reached. The Web provider ships the request over the plan-11
    /// bridge; a headless EditMode test injects its own provider and feeds deterministic
    /// PNG fixtures painted by the same `drawSignPanel`.
    /// </summary>
    public interface ISignFaceProvider : IDisposable {
        /// <summary>Send one batch (already bounded to `StationSignTextureCache.MaxRequestFaces`).</summary>
        void Request(StationSignFaceBatch batch);
        /// <summary>Take one completed reply, if any. Never blocks.</summary>
        bool TryTake(out StationSignFaceResponse response);
        void Cancel(string requestId);
    }

    /// <summary>
    /// The bridge provider: `sign.requestFace` out, `sign.faceChunk` / `sign.faceReady`
    /// in, with the chunking and the stale-revision fence.
    ///
    /// The request is a v2 envelope with `kind: "signRequest"`; the reply is two v2
    /// commands whose payloads are published in `unity/plan/11-evidence/F.md`. Bytes
    /// never travel in a `commit` document, and a reply that names another session or
    /// an older revision is dropped rather than painted onto the current station.
    /// </summary>
    public sealed class StationSignWebProvider : ISignFaceProvider {
        /// <summary>Largest base64 slice accepted in one `sign.faceChunk` (the sender uses 48 KiB).</summary>
        public const int MaxChunkCharacters = 64 * 1024;
        /// <summary>Largest assembled PNG accepted for one face, bytes.</summary>
        public const int MaxPngBytes = 16 * 1024 * 1024;

        sealed class Assembly {
            public string Key = "";
            public StationSignFaceName Face;
            public int Width;
            public int Height;
            public int Count;
            public int Received;
            public readonly Dictionary<int, string> Parts = new Dictionary<int, string>();
            public string ModuleId = "";
        }

        readonly Func<string, bool> send;
        readonly Func<StationSignContext> context;
        readonly Dictionary<string, int> requestRevisions = new Dictionary<string, int>(StringComparer.Ordinal);
        readonly Dictionary<string, Dictionary<string, Assembly>> assemblies =
            new Dictionary<string, Dictionary<string, Assembly>>(StringComparer.Ordinal);
        readonly Queue<StationSignFaceResponse> completed = new Queue<StationSignFaceResponse>();
        bool disposed;

        public StationSignWebProvider(Func<string, bool> send, Func<StationSignContext> context) {
            this.send = send ?? throw new ArgumentNullException(nameof(send));
            this.context = context ?? (() => new StationSignContext());
        }

        /// <summary>How many requests are waiting for their `sign.faceReady`.</summary>
        public int OpenRequests => requestRevisions.Count;

        /// <summary>Batches this world could not publish (no transport); each stays retryable.</summary>
        public int DroppedRequests { get; private set; }
        /// <summary>The last publication failure, for the face status report.</summary>
        public string LastPublishError { get; private set; } = "";

        public void Request(StationSignFaceBatch batch) {
            if (disposed || batch == null || batch.Faces == null || batch.Faces.Length == 0) return;
            var current = context() ?? new StationSignContext();
            requestRevisions[batch.RequestId] = current.Revision;
            assemblies[batch.RequestId] = new Dictionary<string, Assembly>(StringComparer.Ordinal);

            var faces = new JArray();
            foreach (var face in batch.Faces) faces.Add(FaceJson(face));
            var payload = new JObject {
                ["requestId"] = batch.RequestId,
                ["locale"] = batch.Locale ?? "zh-CN",
                ["faces"] = faces,
            };
            var envelope = new JObject {
                ["schemaVersion"] = 2,
                ["kind"] = "signRequest",
                ["type"] = "sign.requestFace",
                ["id"] = batch.RequestId,
                ["sessionId"] = current.SessionId ?? "",
                ["revision"] = current.Revision,
                ["payload"] = payload,
            };
            if (!send(envelope.ToString(Formatting.None))) {
                // No route this frame (the desktop presenter is not attached yet, or a
                // WebGL build without the glue). Drop the request bookkeeping but leave
                // every face in the cache's `wanted` set: `Pump` re-asks after the retry
                // window, so a late painter readiness heals instead of wedging.
                DroppedRequests++;
                LastPublishError = "publish-unavailable";
                Cancel(batch.RequestId);
            } else {
                LastPublishError = "";
            }
        }

        static JObject FaceJson(StationSignFaceRequest face) {
            var components = new JArray();
            foreach (var component in face.Components ?? StationSignBoards.NoComponents) {
                var value = new JObject {
                    ["id"] = component.Id ?? "",
                    ["kind"] = KindName(component.Kind),
                    ["x"] = component.X,
                    ["y"] = component.Y,
                    ["scale"] = component.ClampedScale,
                    ["side"] = component.Side ?? "both",
                };
                switch (component.Kind) {
                    case StationSignComponentKind.Arrow: value["arrow"] = StationSignVocabulary.Arrow(component.Arrow); break;
                    case StationSignComponentKind.Icon: value["icon"] = StationSignVocabulary.Icon(component.Icon); break;
                    case StationSignComponentKind.Line:
                        value["lineId"] = component.LineId ?? "";
                        value["english"] = component.English;
                        break;
                    case StationSignComponentKind.Text: value["text"] = component.Text ?? ""; break;
                }
                components.Add(value);
            }
            var lines = new JArray();
            foreach (var line in face.Lines ?? Array.Empty<StationSignLine>()) {
                lines.Add(new JObject {
                    ["id"] = line.Id ?? "",
                    ["name"] = line.Name ?? "",
                    ["colour"] = line.Colour ?? "",
                });
            }
            return new JObject {
                ["key"] = face.ContentKey,
                ["moduleId"] = face.ModuleId ?? "",
                ["face"] = StationSignVocabulary.Face(face.Face),
                ["panel"] = new JObject { ["w"] = face.PanelWidth, ["h"] = face.PanelHeight },
                ["components"] = components,
                ["lines"] = lines,
                ["defaultLineId"] = face.DefaultLineId ?? "",
            };
        }

        static string KindName(StationSignComponentKind kind) {
            switch (kind) {
                case StationSignComponentKind.Arrow: return "arrow";
                case StationSignComponentKind.Line: return "line";
                case StationSignComponentKind.Text: return "text";
                default: return "icon";
            }
        }

        /* -------------------------------------------------------------- replies */

        /// <summary>Route one C# → JS command here: `sign.faceChunk` or `sign.faceReady`.</summary>
        public bool Receive(string json) {
            if (disposed || string.IsNullOrEmpty(json)) return false;
            JObject message;
            try { message = JObject.Parse(json); } catch { return false; }
            var type = (string)message["type"] ?? "";
            if (type != "sign.faceChunk" && type != "sign.faceReady") return false;
            var payload = message["payload"] as JObject;
            if (payload == null) return true;
            var requestId = String(payload, "requestId");
            if (requestId.Length == 0) return true;
            // Fence: a reply from another session, or for a revision this station has
            // already moved past, is a picture of a sign that no longer exists.
            var current = context() ?? new StationSignContext();
            var sessionId = String(payload, "sessionId");
            // Fence: a reply from another session, or for a revision this station has
            // already moved past, is a picture of a sign that no longer exists.
            if (sessionId.Length > 0 && current.SessionId.Length > 0 && sessionId != current.SessionId) {
                Cancel(requestId);
                return true;
            }
            var revision = Int(payload, "revision", -1);
            if (requestRevisions.TryGetValue(requestId, out var sentRevision)) {
                // Painted for an older revision than the request named: stale pixels.
                // A reply for a **station** the player left cannot get here at all — a
                // station switch builds a new provider/cache, so the old request id is
                // unknown to this one, and the session id fences a new player generation.
                if (revision >= 0 && revision < sentRevision) { Cancel(requestId); return true; }
            } else {
                return true;
            }
            if (type == "sign.faceChunk") Chunk(requestId, payload);
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
            if (!faces.TryGetValue(key, out var assembly)) {
                assembly = new Assembly {
                    Key = key,
                    Face = String(payload, "face") == "back" ? StationSignFaceName.Back : StationSignFaceName.Front,
                    Width = Int(payload, "width", 0),
                    Height = Int(payload, "height", 0),
                    Count = count,
                    ModuleId = String(payload, "moduleId"),
                };
                faces[key] = assembly;
            }
            if (assembly.Count != count || assembly.Width != Int(payload, "width", 0) || assembly.Height != Int(payload, "height", 0)) return;
            if (assembly.Parts.ContainsKey(index)) return;
            assembly.Parts[index] = data;
            assembly.Received++;
        }

        void Ready(string requestId, JObject payload) {
            var assembled = assemblies.TryGetValue(requestId, out var faces) ? faces : null;
            var painted = new List<StationSignPaintedFace>();
            var pending = new List<StationSignPendingFace>();
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
                    painted.Add(new StationSignPaintedFace {
                        Key = key, ModuleId = assembly.ModuleId, Face = assembly.Face,
                        Width = width, Height = height, Png = png,
                    });
                }
            }
            if (payload["pending"] is JArray pendingJson) {
                foreach (var token in pendingJson) {
                    if (!(token is JObject faceJson)) continue;
                    var key = String(faceJson, "key");
                    if (key.Length == 0) continue;
                    pending.Add(new StationSignPendingFace {
                        Key = key,
                        ModuleId = String(faceJson, "moduleId"),
                        Face = String(faceJson, "face") == "back" ? StationSignFaceName.Back : StationSignFaceName.Front,
                        Reason = String(faceJson, "reason"),
                        Detail = String(faceJson, "detail"),
                    });
                }
            }
            completed.Enqueue(new StationSignFaceResponse {
                RequestId = requestId,
                Revision = Int(payload, "revision", -1),
                SessionId = String(payload, "sessionId"),
                ArtReady = payload["artReady"] != null && (bool)payload["artReady"],
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

        public bool TryTake(out StationSignFaceResponse response) {
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
    /// The lit faces of the station's signs, by content.
    ///
    /// A face is a function of its board's normalized content, the face, the panel's
    /// source dimensions, the line facts its shields print and the locale/font the type
    /// is set in — so two signs carrying the same board share one texture and a change
    /// reprint only the boards it actually touched. The cache owns the requests (one
    /// bounded batch at a time), the upload, the fingerprint, the release of replaced
    /// textures and the retry of faces the browser reported not-ready.
    ///
    /// It never paints: `render/signFace.ts` is the one painter, reached through
    /// <see cref="ISignFaceProvider"/>, which the Web build backs with the plan-11
    /// bridge and an EditMode test backs with the same painter's PNG fixtures.
    /// </summary>
    public sealed class StationSignTextureCache : IDisposable {
        /// <summary>Faces one `sign.requestFace` may carry, so one message stays small.</summary>
        public const int MaxRequestFaces = 32;
        /// <summary>How long a face reported not-ready waits before it is asked for again.</summary>
        public const float RetrySeconds = 1f;

        sealed class Entry {
            public string Key = "";
            public Texture2D Texture;
            public string Fingerprint = "";
            public int Refs;
            public string[] LineDeps = Array.Empty<string>();
            public bool DependsOnFont;
            public float LastUsed;
            /// <summary>For a retired entry: the bindings that still show its pixels.</summary>
            public List<StationSignFaceBinding> Holders;
        }

        readonly ISignFaceProvider provider;
        readonly int maxIdleTextures;
        readonly Dictionary<string, Entry> entries = new Dictionary<string, Entry>(StringComparer.Ordinal);
        readonly Dictionary<string, List<StationSignFaceBinding>> subscribers =
            new Dictionary<string, List<StationSignFaceBinding>>(StringComparer.Ordinal);
        readonly Dictionary<string, StationSignFaceRequest> wanted =
            new Dictionary<string, StationSignFaceRequest>(StringComparer.Ordinal);
        /// <summary>When each missing board was last asked for, for the retry window.</summary>
        readonly Dictionary<string, float> askedAt = new Dictionary<string, float>(StringComparer.Ordinal);
        /// <summary>How many times a missing board was asked for, for the backoff.</summary>
        readonly Dictionary<string, int> attempts = new Dictionary<string, int>(StringComparer.Ordinal);
        int counter;
        string fontStamp = "";
        bool disposed;

        public StationSignTextureCache(ISignFaceProvider provider, int maxIdleTextures = 24) {
            this.provider = provider ?? throw new ArgumentNullException(nameof(provider));
            this.maxIdleTextures = Mathf.Max(1, maxIdleTextures);
        }

        /// <summary>Textures that are painted and live (referenced by a face slot).</summary>
        public int LiveTextureCount {
            get {
                int count = 0;
                foreach (var entry in entries.Values) if (entry.Refs > 0) count++;
                return count;
            }
        }

        /// <summary>Faces waiting for pixels (queued, asked for, or reported not-ready).</summary>
        public int PendingFaceCount => wanted.Count;
        public int TextureCount => entries.Count;
        public string FontStamp => fontStamp;

        /// <summary>Fingerprints of the live textures, for a per-ID report.</summary>
        public string[] Fingerprints {
            get {
                var list = new List<string>(entries.Count);
                foreach (var entry in entries.Values) if (entry.Texture != null) list.Add(entry.Fingerprint);
                list.Sort(StringComparer.Ordinal);
                return list.ToArray();
            }
        }

        /* ------------------------------------------------------------- binding */

        /// <summary>Bind every mounted face of one view; the returned handle re-keys its faces.</summary>
        public StationSignViewBinding BindView(StationSignView view) {
            if (view == null) return null;
            var binding = new StationSignViewBinding(this, view);
            if (view.Front != null) binding.Front = Bind(view, StationSignFaceName.Front);
            if (view.Back != null) binding.Back = Bind(view, StationSignFaceName.Back);
            return binding;
        }

        /// <summary>Bind one face: a cache hit applies at once, a miss queues the request.</summary>
        public StationSignFaceBinding Bind(StationSignView view, StationSignFaceName face) {
            if (view == null) return null;
            var request = view.FaceRequest(face);
            if (request == null) return null;
            var binding = new StationSignFaceBinding(this, view, face);
            binding.Key = request.ContentKey;
            Subscribers(binding.Key).Add(binding);
            if (entries.TryGetValue(binding.Key, out var entry) && entry.Texture != null) {
                entry.Refs++;
                entry.LastUsed = Time.realtimeSinceStartup;
                binding.Apply(entry.Texture, entry.Fingerprint);
            } else {
                wanted[binding.Key] = request;
            }
            return binding;
        }

        List<StationSignFaceBinding> Subscribers(string key) {
            if (!subscribers.TryGetValue(key, out var list)) subscribers[key] = list = new List<StationSignFaceBinding>(2);
            return list;
        }

        /// <summary>A face's content changed: drop the old subscription and bind the new key.</summary>
        internal void Refresh(StationSignFaceBinding binding) {
            if (disposed || binding == null || binding.View == null) return;
            var request = binding.View.FaceRequest(binding.Face);
            if (request == null) { Release(binding); return; }
            var key = request.ContentKey;
            if (key == binding.Key) {
                if (entries.TryGetValue(key, out var existing) && existing.Texture != null) {
                    binding.Apply(existing.Texture, existing.Fingerprint);
                } else if (!wanted.ContainsKey(key)) {
                    wanted[key] = request;
                }
                return;
            }
            Unsubscribe(binding);
            binding.Key = key;
            Subscribers(key).Add(binding);
            if (entries.TryGetValue(key, out var entry) && entry.Texture != null) {
                entry.Refs++;
                entry.LastUsed = Time.realtimeSinceStartup;
                binding.Apply(entry.Texture, entry.Fingerprint);
            } else {
                wanted[key] = request;
            }
        }

        internal void Release(StationSignFaceBinding binding) {
            if (binding == null) return;
            Unsubscribe(binding);
            binding.Clear();
        }

        void Unsubscribe(StationSignFaceBinding binding) {
            if (string.IsNullOrEmpty(binding.Key)) return;
            if (subscribers.TryGetValue(binding.Key, out var list)) {
                list.Remove(binding);
                if (list.Count == 0) {
                    subscribers.Remove(binding.Key);
                    // Nobody is waiting for this board any more: stop asking for it.
                    if (!entries.ContainsKey(binding.Key)) {
                        wanted.Remove(binding.Key);
                        Forget(binding.Key);
                    }
                }
            }
            if (entries.TryGetValue(binding.Key, out var entry) && entry.Refs > 0) {
                entry.Refs--;
                entry.LastUsed = Time.realtimeSinceStartup;
                return;
            }
            // A retired texture still counts its live bindings, so it is released when
            // the last board that shows it lets go.
            ReleaseRetired(binding.Key, binding);
        }

        /// <summary>Ask again for every subscribed board whose texture this cache no longer holds.</summary>
        void Requeue() {
            foreach (var pair in subscribers) {
                if (entries.ContainsKey(pair.Key)) continue;
                foreach (var binding in pair.Value) {
                    var request = binding.View != null ? binding.View.FaceRequest(binding.Face) : null;
                    if (request == null) continue;
                    // The pixels were invalidated, so the retry window must not delay the
                    // fresh request behind the old one.
                    wanted[pair.Key] = request;
                    Forget(pair.Key);
                    break;
                }
            }
        }

        /* ------------------------------------------------------------ requests */

        /// <summary>
        /// Drain replies, upload what arrived, trim idle textures and ask for anything
        /// still missing. A board is re-asked only after <see cref="RetrySeconds"/>, so a
        /// reply in flight is not duplicated, and a reply that never came is retried
        /// rather than wedging the station's boards. The host calls this after each
        /// bridge delivery and on a short tick.
        /// </summary>
        public void Pump() {
            if (disposed) return;
            while (provider.TryTake(out var response)) Apply(response);
            TrimIdle();
            if (wanted.Count == 0) return;
            float now = Time.realtimeSinceStartup;
            var keys = new List<string>(Math.Min(MaxRequestFaces, wanted.Count));
            foreach (var key in wanted.Keys) {
                if (!ReadyToAsk(key, now)) continue;
                keys.Add(key);
                if (keys.Count >= MaxRequestFaces) break;
            }
            if (keys.Count == 0) return;
            var batch = new StationSignFaceBatch {
                RequestId = "sign-req-" + (++counter),
                Locale = "",
                Faces = new StationSignFaceRequest[keys.Count],
            };
            for (int i = 0; i < keys.Count; i++) {
                var request = wanted[keys[i]];
                batch.Faces[i] = request;
                askedAt[keys[i]] = now;
                attempts.TryGetValue(keys[i], out var attempt);
                attempts[keys[i]] = attempt + 1;
                if (batch.Locale.Length == 0) batch.Locale = request.Locale;
            }
            provider.Request(batch);
        }

        /// <summary>
        /// True when a missing board may be asked for again. A board the painter keeps
        /// reporting not-ready (a font or a pictogram that never lands) backs off
        /// 1→2→4→…→64 s instead of asking every second for the session.
        /// </summary>
        bool ReadyToAsk(string key, float now) {
            if (!askedAt.TryGetValue(key, out var asked)) return true;
            attempts.TryGetValue(key, out var attempt);
            // The first retry waits `RetrySeconds`, then 2 s, 4 s … 64 s.
            float delay = RetrySeconds * Mathf.Pow(2f, Mathf.Clamp(attempt - 1, 0, 6));
            return now - asked >= delay;
        }

        void Forget(string key) {
            askedAt.Remove(key);
            attempts.Remove(key);
        }

        void ForgetAll() {
            askedAt.Clear();
            attempts.Clear();
        }

        void Apply(StationSignFaceResponse response) {
            if (response == null) return;
            foreach (var painted in response.Painted ?? Array.Empty<StationSignPaintedFace>()) {
                if (painted == null || painted.Png == null || painted.Png.Length == 0) continue;
                if (!wanted.TryGetValue(painted.Key, out var request)) continue; // stale: no one wants it now
                if (painted.Width != request.PlateWidth || painted.Height != request.PlateHeight) continue;
                if (entries.ContainsKey(painted.Key)) continue;                 // already painted by another batch
                var texture = Decode(painted.Png, painted.Width, painted.Height, "sign face " + Short(painted.Key));
                if (texture == null) continue;
                // Every binding for this board switches to the new pixels in this loop, so
                // an entry retired by an invalidation has no reader left.
                DropRetiredFor(painted.Key);
                var entry = new Entry {
                    Key = painted.Key,
                    Texture = texture,
                    Fingerprint = Short(painted.Key) + "@" + painted.Width + "x" + painted.Height,
                    LineDeps = request.LineDependencies,
                    DependsOnFont = request.DependsOnFont,
                    LastUsed = Time.realtimeSinceStartup,
                };
                entries[painted.Key] = entry;
                wanted.Remove(painted.Key);
                Forget(painted.Key);
                if (!subscribers.TryGetValue(painted.Key, out var list)) continue;
                foreach (var binding in list.ToArray()) {
                    entry.Refs++;
                    entry.LastUsed = Time.realtimeSinceStartup;
                    binding.Apply(entry.Texture, entry.Fingerprint);
                }
            }
            foreach (var pending in response.Pending ?? Array.Empty<StationSignPendingFace>()) {
                if (pending == null) continue;
                if (!wanted.ContainsKey(pending.Key)) continue;
                // A face with nothing printable is final; a font or a pictogram that has
                // not landed yet keeps its place in the queue for the retry window.
                if (pending.Reason == "empty" || pending.Reason == "unsupported") {
                    wanted.Remove(pending.Key);
                    Forget(pending.Key);
                }
            }
            TrimIdle();
        }

        /// <summary>Ask for the pending faces now instead of after `RetrySeconds`.</summary>
        public void RetryNow() { ForgetAll(); }

        /* --------------------------------------------------------- invalidation */

        /// <summary>Retire the boards that print this line (a recolour or a rename).</summary>
        public void InvalidateLine(string lineId) => InvalidateLines(new[] { lineId });

        /// <summary>Retire only the boards whose shields print one of `lineIds`.</summary>
        public void InvalidateLines(IEnumerable<string> lineIds) {
            var changed = new HashSet<string>(lineIds ?? Array.Empty<string>(), StringComparer.Ordinal);
            if (changed.Count == 0) return;
            var touched = new List<string>();
            foreach (var entry in entries.Values) {
                foreach (var dependency in entry.LineDeps) {
                    if (!changed.Contains(dependency)) continue;
                    touched.Add(entry.Key);
                    break;
                }
            }
            foreach (var key in touched) Retire(key);
            Requeue();
        }

        /// <summary>
        /// Retire one sign's plates and ask for them again, leaving every other sign's
        /// pixels alone (plan 11 F3). A board the sign **shares** with another sign is
        /// left cached: its pixels are still correct for the sign that still prints it,
        /// so only boards this sign alone owns are dropped. Returns how many entries
        /// were retired; the caller pumps (the retry window is cleared so the fresh
        /// request is not delayed behind the old one).
        /// </summary>
        public int InvalidateSign(string moduleId) {
            if (disposed || string.IsNullOrEmpty(moduleId)) return 0;
            var touched = new List<string>();
            foreach (var entry in entries.Values) {
                if (entry.Refs <= 0) continue;
                if (!subscribers.TryGetValue(entry.Key, out var list) || list.Count == 0) continue;
                bool mine = false, other = false;
                foreach (var binding in list) {
                    if (binding.View != null && string.Equals(binding.View.ModuleId, moduleId, StringComparison.Ordinal)) mine = true;
                    else other = true;
                }
                if (mine && !other) touched.Add(entry.Key);
            }
            foreach (var key in touched) Retire(key);
            if (touched.Count > 0) Requeue();
            return touched.Count;
        }

        /// <summary>
        /// Adopt the painter's font/art epoch. A change repaints only the faces whose
        /// pixels depend on type (`DependsOnFont`) — an icon-only board is untouched.
        /// </summary>
        public void SetFontStamp(string stamp) {
            var next = stamp ?? "";
            if (next == fontStamp) return;
            fontStamp = next;
            var touched = new List<string>();
            foreach (var entry in entries.Values) if (entry.DependsOnFont) touched.Add(entry.Key);
            foreach (var key in touched) Retire(key);
            Requeue();
        }

        /// <summary>A different station: no texture of the old one may survive.</summary>
        public void InvalidateAll() {
            var keys = new List<string>(entries.Keys);
            foreach (var key in keys) Retire(key);
            foreach (var list in subscribers.Values) foreach (var binding in list) binding.Clear();
            wanted.Clear();
            ForgetAll();
        }

        void Retire(string key) {
            if (string.IsNullOrEmpty(key)) return;
            wanted.Remove(key);
            Forget(key);
            if (!entries.TryGetValue(key, out var entry)) return;
            entries.Remove(key);
            var holders = subscribers.TryGetValue(key, out var list) ? new List<StationSignFaceBinding>(list) : null;
            if (holders == null || holders.Count == 0) {
                DestroyTexture(entry.Texture);
                return;
            }
            // Still on live boards: the pixels go when the last of them takes the new
            // board (see `DropRetiredFor`) or lets go (see `Unsubscribe`).
            entry.Holders = holders;
            entry.Refs = holders.Count;
            retired.Add(entry);
        }

        readonly List<Entry> retired = new List<Entry>();

        void DropRetiredFor(string key) {
            for (int i = retired.Count - 1; i >= 0; i--) {
                if (retired[i].Key != key) continue;
                DestroyTexture(retired[i].Texture);
                retired.RemoveAt(i);
            }
        }

        void ReleaseRetired(string key, StationSignFaceBinding binding) {
            for (int i = retired.Count - 1; i >= 0; i--) {
                var entry = retired[i];
                if (entry.Key != key || entry.Holders == null) continue;
                entry.Holders.Remove(binding);
                entry.Refs = entry.Holders.Count;
                if (entry.Refs > 0) continue;
                DestroyTexture(entry.Texture);
                retired.RemoveAt(i);
            }
        }

        void TrimIdle() {
            if (entries.Count <= maxIdleTextures) return;
            var idle = new List<Entry>();
            foreach (var entry in entries.Values) if (entry.Refs == 0) idle.Add(entry);
            idle.Sort((a, b) => a.LastUsed.CompareTo(b.LastUsed));
            int excess = entries.Count - maxIdleTextures;
            for (int i = 0; i < idle.Count && excess > 0; i++, excess--) {
                entries.Remove(idle[i].Key);
                DestroyTexture(idle[i].Texture);
            }
        }

        static Texture2D Decode(byte[] png, int width, int height, string name) {
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!texture.LoadImage(png, false)) { Destroy(texture); return null; }
            if (texture.width != width || texture.height != height) { Destroy(texture); return null; }
            texture.name = name;
            texture.wrapMode = TextureWrapMode.Clamp;
            texture.filterMode = FilterMode.Bilinear;
            texture.anisoLevel = 2;
            return texture;
        }

        static string Short(string key) => string.IsNullOrEmpty(key) ? "?" : key.Length > 16 ? key.Substring(0, 16) : key;

        static void DestroyTexture(Texture2D texture) => Destroy(texture);

        static void Destroy(UnityEngine.Object value) {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }

        public void Dispose() {
            if (disposed) return;
            disposed = true;
            provider.Dispose();
            foreach (var entry in entries.Values) DestroyTexture(entry.Texture);
            entries.Clear();
            foreach (var entry in retired) DestroyTexture(entry.Texture);
            retired.Clear();
            subscribers.Clear();
            wanted.Clear();
            ForgetAll();
        }

        /// <summary>Release the textures of retired entries whose last binding has let go.</summary>
        internal void CollectRetired() {
            for (int i = retired.Count - 1; i >= 0; i--) {
                if (retired[i].Refs > 0) continue;
                DestroyTexture(retired[i].Texture);
                retired.RemoveAt(i);
            }
        }
    }

    /* ------------------------------------------------------------------ bindings */

    /// <summary>One face's live texture, and the slot it is assigned to.</summary>
    public sealed class StationSignFaceBinding : IDisposable {
        readonly StationSignTextureCache cache;
        public StationSignView View { get; }
        public StationSignFaceName Face { get; }
        public string Key { get; internal set; } = "";
        public Texture2D Texture { get; private set; }
        public string Fingerprint { get; private set; } = "";
        public bool HasTexture => Texture != null;
        bool released;

        internal StationSignFaceBinding(StationSignTextureCache cache, StationSignView view, StationSignFaceName face) {
            this.cache = cache;
            View = view;
            Face = face;
        }

        internal void Apply(Texture2D texture, string fingerprint) {
            Texture = texture;
            Fingerprint = fingerprint ?? "";
            if (View != null) View.ApplyFaceTexture(Face, texture, Fingerprint);
        }

        internal void Clear() {
            Texture = null;
            Fingerprint = "";
            if (View != null) View.ApplyFaceTexture(Face, null, "");
        }

        /// <summary>Re-read the view's current board; a changed board is a new request.</summary>
        public void Refresh() => cache.Refresh(this);

        public void Dispose() {
            if (released) return;
            released = true;
            cache.Release(this);
            cache.CollectRetired();
        }
    }

    /// <summary>Every mounted face of one view.</summary>
    public sealed class StationSignViewBinding : IDisposable {
        readonly StationSignView view;
        public StationSignView View => view;
        public StationSignFaceBinding Front;
        public StationSignFaceBinding Back;

        internal StationSignViewBinding(StationSignTextureCache cache, StationSignView view) {
            this.view = view;
            Cache = cache;
        }

        public StationSignTextureCache Cache { get; }

        public StationSignFaceBinding[] Faces {
            get {
                var list = new List<StationSignFaceBinding>(2);
                if (Front != null) list.Add(Front);
                if (Back != null) list.Add(Back);
                return list.ToArray();
            }
        }

        /// <summary>After an edit: re-key every face and request what is missing.</summary>
        public void Refresh() {
            Front?.Refresh();
            Back?.Refresh();
        }

        public void Dispose() {
            Front?.Dispose();
            Back?.Dispose();
            Front = null;
            Back = null;
        }
    }

    /* ------------------------------------------------------------------ commands */

    /// <summary>
    /// One pump per frame while the sign role is visible. Replies call
    /// <see cref="StationSignTextureCache.Pump"/> themselves; this exists for the
    /// faces the painter reported **not-ready** (a font or a pictogram that had not
    /// landed yet), which must be asked for again after the retry window even though
    /// no new message arrives. It does nothing while every board has its pixels.
    /// </summary>
    public sealed class StationSignPump : MonoBehaviour {
        public StationSignTextureCache Cache;
        void Update() {
            if (Cache != null) Cache.Pump();
        }
    }

    /// <summary>
    /// The `sign.*` command handler. Two jobs share the capability:
    ///
    ///  * the painter's replies (`sign.faceChunk`, `sign.faceReady`) and `sign.retry`
    ///    are routed into the active provider/cache. These never edit the document — a
    ///    painted face is an acknowledgement, not a commit;
    ///  * `sign.commit` (plan 11 F3) is the editor's one edit verb. It decodes the whole
    ///    face content from the payload, validates it with <see cref="Metro.Build.StationSignEdits"/>
    ///    and applies it through <see cref="StationSignCommit"/>, which stages the whole
    ///    normalized document through the host's ordinary edit transaction. The router
    ///    then replies with the commit (one revision) — or, for content that is already
    ///    committed, with an ack carrying the same key and `changed: false`.
    ///
    /// Payload (`schemaVersion: 2`, one sign per command):
    /// <code>
    /// sign.commit:
    /// { "signId": "sign-309",
    ///   "faces": { "front": [ { "id":"c1","kind":"arrow","arrow":"down-left","x":0.3,"y":0.2,"scale":1,"side":"both" },
    ///                         { "id":"c2","kind":"text","text":"文冲方向\nTowards Wenchong","x":1.0,"y":0.2,"scale":1,"side":"both" },
    ///                         { "id":"c3","kind":"line","lineId":"5","english":true,"x":1.4,"y":0.2,"scale":1,"side":"both" } ],
    ///              "back": [] } }
    /// </code>
    /// `{ "face": "front", "content": [...] }` is accepted for a one-face edit, and
    /// `locale` optionally names the print locale. The envelope's `expectedRevision`
    /// fences the edit against the committed revision (the router checks it first and
    /// answers `revision-mismatch`; the transaction's own check answers `stale-revision`).
    ///
    /// Ack (no change) / commit payload extension (changed):
    /// <code>
    /// { "signId":"sign-309", "face":"front", "contentKey":"&lt;sha256&gt;",
    ///   "faces":[{"face":"front","contentKey":"…"},{"face":"back","contentKey":"…"}],
    ///   "changed":true|false, "revision":8, "code":"ok"|"no-change" }
    /// </code>
    /// The commit reply's `payload.sign.lastCommit` carries the same record, so the UI
    /// can name the face it just applied even though the reply's own payload is the
    /// document.
    /// </summary>
    public sealed class StationSignCommandHandler : IStationCommandHandler {
        readonly Func<IStationSignEditHost> editHostProvider;

        public StationSignCommandHandler() { }

        /// <summary>Test seam: supply the edit host (document/revision/commit) without a scene.</summary>
        public StationSignCommandHandler(Func<IStationSignEditHost> editHostProvider) {
            this.editHostProvider = editHostProvider;
        }

        public string Capability => "sign";

        public bool Handles(string type) =>
            type == "sign.faceChunk" || type == "sign.faceReady" || type == "sign.retry" || type == "sign.commit";

        IStationSignEditHost EditHost => editHostProvider != null ? editHostProvider() : StationGameHostEditHost.Find();

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = null;
            rejectReason = null;
            if (command == null) return true;
            if (command.Type == "sign.commit") return Commit(command, payload ?? new JObject(), out rejectCode, out rejectReason);
            if (command.Type == "sign.retry") {
                StationSignSignage.Cache?.RetryNow();
                StationSignSignage.Pump();
                return true;
            }
            StationSignSignage.Receive(command.Raw);
            // A reply may complete several faces at once; the cache applies them and asks
            // for anything still missing (a font/pictogram that has not landed yet).
            StationSignSignage.Pump();
            return true;
        }

        /* -------------------------------------------------------------- commit */

        bool Commit(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = null;
            rejectReason = null;
            var host = EditHost;
            if (host == null || host.Document == null) {
                rejectCode = "no-session";
                rejectReason = "No station is committed, so there is no sign to edit.";
                return false;
            }
            if (!TryReadRequest(command, payload, host, out var request, out var message)) {
                rejectCode = "bad-payload";
                rejectReason = message;
                return false;
            }
            var validation = Metro.Build.StationSignEdits.Validate(request, host.CurrentRevision);
            if (!validation.Accepted) {
                rejectCode = validation.Code;
                rejectReason = validation.Message;
                return false;
            }
            if (!StationSignCommit.TryCommit(host, request, validation, payload, out var code, out var reason)) {
                rejectCode = string.IsNullOrEmpty(code) ? "rejected" : code;
                rejectReason = string.IsNullOrEmpty(reason) ? "The sign edit was refused." : reason;
                return false;
            }
            return true;
        }

        static bool TryReadRequest(
            StationCommand command, JObject payload, IStationSignEditHost host,
            out Metro.Build.StationSignEditRequest request, out string message) {
            request = null;
            message = null;
            var signId = String(payload, "signId");
            if (string.IsNullOrEmpty(signId)) { message = "sign.commit needs payload.signId."; return false; }
            var result = new Metro.Build.StationSignEditRequest {
                SignId = signId,
                ExpectedRevision = command.ExpectedRevision ?? -1,
                Signs = SignFacts(host.Document),
                KnownLineIds = LineIds(host.Document),
            };
            if (payload["faces"] != null) {
                if (!(payload["faces"] is JObject faces)) { message = "payload.faces must be an object of front/back arrays."; return false; }
                foreach (var property in faces.Properties()) {
                    if (!Metro.Build.StationSignEdits.TryParseFace(property.Name, out var face)) {
                        message = "Unknown sign face '" + property.Name + "'; use front or back.";
                        return false;
                    }
                    if (!TryReadContent(property.Value, out var content, out message)) return false;
                    result.Writes.Add(new Metro.Build.StationSignEditFaceWrite { SignId = signId, Face = face, Content = content });
                }
                if (result.Writes.Count == 0) { message = "payload.faces needs at least one face."; return false; }
            } else {
                if (!Metro.Build.StationSignEdits.TryParseFace(String(payload, "face"), out var face)) {
                    message = "sign.commit needs payload.face as front|back (or a payload.faces object).";
                    return false;
                }
                if (!TryReadContent(payload["content"], out var content, out message)) return false;
                result.Writes.Add(new Metro.Build.StationSignEditFaceWrite { SignId = signId, Face = face, Content = content });
            }
            request = result;
            return true;
        }

        static List<Metro.Build.StationSignEditSign> SignFacts(Metro.Build.StationDocument document) {
            var signs = new List<Metro.Build.StationSignEditSign>();
            if (document == null) return signs;
            foreach (var module in document.Modules) {
                if (module == null || !string.Equals(module.Type, "sign", StringComparison.Ordinal)) continue;
                var config = module.Config;
                signs.Add(new Metro.Build.StationSignEditSign {
                    Id = module.Id,
                    Mount = config.Text("mount"),
                    HasFront = config.Has("front"),
                    HasBack = config.Has("back"),
                });
            }
            return signs;
        }

        static List<string> LineIds(Metro.Build.StationDocument document) {
            var ids = new List<string>();
            if (document == null || document.Lines == null) return ids;
            foreach (var line in document.Lines) if (line != null) ids.Add(line.Id);
            return ids;
        }

        /* ------------------------------------------------------------- content */

        static bool TryReadContent(JToken token, out Metro.Build.StationSignEditFaceContent content, out string message) {
            content = null;
            message = null;
            if (!(token is JArray array)) { message = "A sign face needs a components array."; return false; }
            var components = new List<Metro.Build.StationSignEditComponent>(array.Count);
            foreach (var item in array) {
                if (!(item is JObject value)) { message = "Every sign component must be an object."; return false; }
                var kind = String(value, "kind");
                var component = new Metro.Build.StationSignEditComponent {
                    Id = String(value, "id"),
                    Side = value["side"] != null ? String(value, "side") : "both",
                };
                if (!TryNumber(value["x"], 0, out var x) || !TryNumber(value["y"], 0, out var y) ||
                    !TryNumber(value["scale"], 1, out var scale)) {
                    message = "Component " + components.Count + " has a non-numeric x, y or scale.";
                    return false;
                }
                component.X = x;
                component.Y = y;
                component.Scale = scale;
                switch (kind) {
                    case "arrow": {
                        component.Kind = Metro.Build.StationSignEditKind.Arrow;
                        var arrow = String(value, "arrow");
                        if (!StationSignVocabulary.TryParseArrow(arrow, out _)) {
                            message = "Component " + components.Count + " names unknown arrow '" + arrow + "'.";
                            return false;
                        }
                        component.Arrow = arrow;
                        break;
                    }
                    case "icon": {
                        component.Kind = Metro.Build.StationSignEditKind.Icon;
                        var icon = String(value, "icon");
                        if (!StationSignVocabulary.TryParseIcon(icon, out _)) {
                            message = "Component " + components.Count + " names unknown pictogram '" + icon + "'.";
                            return false;
                        }
                        component.Icon = icon;
                        break;
                    }
                    case "line":
                        component.Kind = Metro.Build.StationSignEditKind.Line;
                        component.LineId = String(value, "lineId");
                        component.English = value["english"] != null && value["english"].Type == JTokenType.Boolean && (bool)value["english"];
                        break;
                    case "text":
                        component.Kind = Metro.Build.StationSignEditKind.Text;
                        if (value["text"] == null || value["text"].Type != JTokenType.String) {
                            message = "Text component " + components.Count + " has no text string.";
                            return false;
                        }
                        component.Text = (string)value["text"] ?? "";
                        break;
                    default:
                        message = "Unknown sign component kind '" + kind + "'.";
                        return false;
                }
                components.Add(component);
            }
            content = new Metro.Build.StationSignEditFaceContent { Components = components };
            return true;
        }

        static bool TryNumber(JToken token, double fallback, out double value) {
            value = fallback;
            if (token == null || token.Type == JTokenType.Null) return true;
            if (token.Type != JTokenType.Integer && token.Type != JTokenType.Float) return false;
            value = (double)token;
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        static string String(JObject value, string name) =>
            value[name] != null && value[name].Type == JTokenType.String ? (string)value[name] ?? "" : "";
    }
}
