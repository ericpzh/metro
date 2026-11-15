using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App {
    /* ------------------------------------------------------------------ the face */

    /// <summary>
    /// Which printed face of the street furniture a slot is (plan 16 §5.3).
    ///
    /// An `exit` head-house prints one header plate (`exitHeaderPlate_*` in the promoted
    /// GLB). A `guidepost` prints three replaceable plates: the station face, which is
    /// two upper 256×277 faces plus one tall 256×993 rear face, and the square exit
    /// letter plate. The train pictogram and the city logo collar stay the promoted
    /// export's own artwork: they are not identity-bearing text (the logo is the
    /// **prefab's** city shape, see `guidepost-city-shape`).
    /// </summary>
    public enum ExitFacePainter {
        ExitHeader = 0,
        GuideStationUpper = 1,
        GuideStationRear = 2,
        GuideExitLetter = 3,
    }

    public static class ExitFaceVocabulary {
        public static string Painter(ExitFacePainter painter) {
            switch (painter) {
                case ExitFacePainter.GuideStationUpper: return "guideStationUpper";
                case ExitFacePainter.GuideStationRear: return "guideStationRear";
                case ExitFacePainter.GuideExitLetter: return "guideExitLetter";
                default: return "exitHeader";
            }
        }

        public static ExitFacePainter ParsePainter(string value) {
            switch (value ?? "") {
                case "guideStationUpper": return ExitFacePainter.GuideStationUpper;
                case "guideStationRear": return ExitFacePainter.GuideStationRear;
                case "guideExitLetter": return ExitFacePainter.GuideExitLetter;
                default: return ExitFacePainter.ExitHeader;
            }
        }

        /// <summary>The saved family the plate belongs to (`exit` or `guidepost`).</summary>
        public static string RecordType(ExitFacePainter painter) =>
            painter == ExitFacePainter.ExitHeader ? "exit" : "guidepost";
    }

    /// <summary>One live line fact an exit fascia prints (`id`, `name`, `colour`).</summary>
    public struct ExitFaceLine {
        public string Id;
        public string Name;
        public string NameEn;
        public string Colour;

        public ExitFaceLine(string id, string name, string colour, string nameEn = "") {
            Id = id ?? "";
            Name = name ?? "";
            NameEn = nameEn ?? "";
            Colour = colour ?? "";
        }
    }

    /// <summary>
    /// One printed plate the browser should paint.
    ///
    /// The pixels are a function of the painter, the station identity (`name`, `nameEn`,
    /// `city`), the exit identity (`cfg.name` / the guidepost's resolved exit), the line
    /// facts a per-city fascia prints and the locale the strings are set in.
    /// <see cref="ContentKey"/> is that identity as one hash: two exits with the same
    /// name share a plate, and a rename, a station rename, a city edit, a line recolour
    /// or a locale switch is a **different key** rather than a stale picture.
    ///
    /// <see cref="Pixels"/>/<see cref="PixelsHigh"/> are the painter's canvas when the
    /// slot is a guidepost plate (the promoted material's own texture size). The
    /// runtime plate gets **explicit upright UVs** derived from the physical face
    /// (`StationExitArtwork.BuildUprightPlate`) rather than reusing the baked glTF
    /// atlas convention on a PNG with Unity's own row order. An exit header asks for
    /// zero and lets the source painter decide its per-city resolution
    /// (`exitHeaderResolution`).
    /// </summary>
    public sealed class ExitFaceFacts {
        public string ModuleId = "";
        public string RecordType = "exit";
        public ExitFacePainter Painter;
        /// <summary>Target canvas width for a guidepost plate; 0 = the painter decides.</summary>
        public int Pixels;
        public int PixelsHigh;
        /// <summary>The printed plate's own size in source metres, for the record.</summary>
        public float Width;
        public float Height;
        public string Station = "";
        public string StationEn = "";
        public string City = "";
        /// <summary>The exit's `cfg.name` (raw); empty falls back inside the painter.</summary>
        public string ExitName = "";
        /// <summary>The exit a guidepost links to by `cfg.exitId`.</summary>
        public string ExitId = "";
        /// <summary>False when a guidepost's `cfg.exitId` names no saved exit (the source's fallback).</summary>
        public bool ExitFound = true;
        public ExitFaceLine[] Lines = Array.Empty<ExitFaceLine>();
        public string Locale = "zh-CN";

        public string ContentKey => KeyOf(this);

        /// <summary>The content-addressed identity. Stable across runs and machines.</summary>
        public static string KeyOf(ExitFaceFacts facts) {
            if (facts == null) return "";
            var text = new StringBuilder(320);
            text.Append("exit-face/1");
            text.Append("\npainter=").Append(ExitFaceVocabulary.Painter(facts.Painter));
            // No painter *module* id: the picture is the station, the exit label it prints and
            // (for a fascia) the line facts. A guidepost therefore shares its plates with
            // another pillar linked to the same exit. The linked exit id stays in the key,
            // which is what makes two identically-lettered but distinct exits their own plates.
            text.Append("\nstation=").Append(facts.Station ?? "");
            text.Append("\nstationEn=").Append(facts.StationEn ?? "");
            text.Append("\ncity=").Append(facts.City ?? "");
            text.Append("\nexit=").Append(facts.ExitName ?? "");
            text.Append("\nexitId=").Append(facts.ExitId ?? "");
            text.Append("\nexitFound=").Append(facts.ExitFound ? "1" : "0");
            text.Append("\nlocale=").Append(facts.Locale ?? "");
            text.Append("\npixels=").Append(facts.Pixels.ToString(CultureInfo.InvariantCulture))
                .Append('x').Append(facts.PixelsHigh.ToString(CultureInfo.InvariantCulture));
            text.Append("\nplate=").Append(Number(facts.Width)).Append('x').Append(Number(facts.Height));
            // Only a fascia prints line badges, and only some city styles do; the guidepost's
            // plates print the station and exit words alone. Keeping the line list off the
            // guidepost key means a line recolour does not repaint every pillar in the street.
            if (facts.Painter == ExitFacePainter.ExitHeader) {
                text.Append("\nlines=");
                var lines = new List<string>(facts.Lines != null ? facts.Lines.Length : 0);
                foreach (var line in facts.Lines ?? Array.Empty<ExitFaceLine>()) {
                    lines.Add((line.Id ?? "") + "/" + (line.Name ?? "") + "/" + (line.NameEn ?? "") + "/" + (line.Colour ?? ""));
                }
                lines.Sort(StringComparer.Ordinal);
                text.Append(string.Join(";", lines.ToArray()));
            }
            return Hash(text.ToString());
        }

        static string Number(float value) => value.ToString("0.####", CultureInfo.InvariantCulture);

        internal static string Hash(string text) {
            using (var sha = SHA256.Create()) {
                var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(text ?? ""));
                var builder = new StringBuilder(bytes.Length * 2);
                foreach (var value in bytes) builder.Append(value.ToString("x2", CultureInfo.InvariantCulture));
                return builder.ToString();
            }
        }

        public ExitFaceFacts Copy(ExitFacePainter painter, int pixels, int pixelsHigh, float width, float height) =>
            new ExitFaceFacts {
                ModuleId = ModuleId,
                RecordType = ExitFaceVocabulary.RecordType(painter),
                Painter = painter,
                Pixels = pixels,
                PixelsHigh = pixelsHigh,
                Width = width,
                Height = height,
                Station = Station,
                StationEn = StationEn,
                City = City,
                ExitName = ExitName,
                ExitId = ExitId,
                ExitFound = ExitFound,
                Lines = Lines,
                Locale = Locale,
            };

        public string Describe() =>
            ExitFaceVocabulary.Painter(Painter) + " " + (ModuleId ?? "?") +
            " plate " + Number(Width) + "×" + Number(Height) + " m" +
            (Pixels > 0 ? " canvas " + Pixels + "×" + PixelsHigh : " canvas source") +
            " station '" + (Station ?? "") + "' exit '" + (ExitName ?? "") + "' city '" + (City ?? "") + "'";
    }

    /// <summary>Who is asking: the session and revision the reply must still belong to.</summary>
    public sealed class ExitFaceContext {
        public string SessionId = "";
        public int Revision = -1;
    }

    /* ------------------------------------------------------------------ provider */

    public sealed class ExitFaceBatch {
        public string RequestId = "";
        public string Locale = "zh-CN";
        public ExitFaceFacts[] Faces = Array.Empty<ExitFaceFacts>();
    }

    public sealed class ExitFacePainted {
        public string Key = "";
        public string ModuleId = "";
        public ExitFacePainter Painter;
        public int Width;
        public int Height;
        /// <summary>Non-empty pixels the browser painted (`-1` when unmeasured).</summary>
        public float Ink = -1f;
        public string Locale = "";
        public byte[] Png = Array.Empty<byte>();
    }

    public sealed class ExitFacePending {
        public string Key = "";
        public string ModuleId = "";
        public ExitFacePainter Painter;
        /// <summary>`font`, `unsupported` or `empty`.</summary>
        public string Reason = "";
        public string Detail = "";
    }

    public sealed class ExitFaceResponse {
        public string RequestId = "";
        public int Revision = -1;
        public string SessionId = "";
        public bool ArtReady;
        public ExitFacePainted[] Painted = Array.Empty<ExitFacePainted>();
        public ExitFacePending[] Pending = Array.Empty<ExitFacePending>();
    }

    /// <summary>
    /// How the painter is reached. The Web build ships the request over the plan-11
    /// bridge; an EditMode test injects its own provider (or answers the real provider
    /// through `StationExitArtwork.SendHook`) with PNG fixtures painted by the same
    /// `exitHeaderCanvas` / `guideFace` / `guideEnglishFace` / `guideExitLetterFace`.
    ///
    /// A **distinct kind** (`exitFaceRequest` / `exit.requestFace`, replies
    /// `exit.faceChunk` / `exit.faceReady`) is used instead of a discriminant on the
    /// sign or PSD request: each painter owns its own readiness rules, and the v2
    /// envelope, the chunked base64 transport and the session/revision fence are shared
    /// byte for byte with them.
    /// </summary>
    public interface IExitFaceProvider : IDisposable {
        void Request(ExitFaceBatch batch);
        bool TryTake(out ExitFaceResponse response);
        void Cancel(string requestId);
    }

    /// <summary>
    /// The bridge provider: `exit.requestFace` out, `exit.faceChunk` /
    /// `exit.faceReady` in, with the same chunking and stale-session/revision fence as
    /// `StationSignWebProvider` and `PsdHeaderWebProvider`.
    /// </summary>
    public sealed class ExitFaceWebProvider : IExitFaceProvider {
        /// <summary>Largest base64 slice accepted in one `exit.faceChunk` (the sender uses 48 KiB).</summary>
        public const int MaxChunkCharacters = 64 * 1024;
        /// <summary>Largest assembled PNG accepted for one plate, bytes.</summary>
        public const int MaxPngBytes = 16 * 1024 * 1024;

        sealed class Assembly {
            public string Key = "";
            public ExitFacePainter Painter;
            public int Width;
            public int Height;
            public int Count;
            public string ModuleId = "";
            public string Locale = "";
            public readonly Dictionary<int, string> Parts = new Dictionary<int, string>();
        }

        readonly Func<string, bool> send;
        readonly Func<ExitFaceContext> context;
        readonly Dictionary<string, int> requestRevisions = new Dictionary<string, int>(StringComparer.Ordinal);
        readonly Dictionary<string, Dictionary<string, Assembly>> assemblies =
            new Dictionary<string, Dictionary<string, Assembly>>(StringComparer.Ordinal);
        readonly Queue<ExitFaceResponse> completed = new Queue<ExitFaceResponse>();
        bool disposed;

        public ExitFaceWebProvider(Func<string, bool> send, Func<ExitFaceContext> context) {
            this.send = send ?? throw new ArgumentNullException(nameof(send));
            this.context = context ?? (() => new ExitFaceContext());
        }

        /// <summary>How many requests are waiting for their `exit.faceReady`.</summary>
        public int OpenRequests => requestRevisions.Count;
        /// <summary>Batches this world could not publish (no transport); each stays retryable.</summary>
        public int DroppedRequests { get; private set; }
        /// <summary>Replies dropped because they named another session or an older revision.</summary>
        public int FencedReplies { get; private set; }
        /// <summary>The last publication failure, for the face status report.</summary>
        public string LastPublishError { get; private set; } = "";

        public void Request(ExitFaceBatch batch) {
            if (disposed || batch == null || batch.Faces == null || batch.Faces.Length == 0) return;
            var current = context() ?? new ExitFaceContext();
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
                ["kind"] = "exitFaceRequest",
                ["type"] = "exit.requestFace",
                ["id"] = batch.RequestId,
                ["sessionId"] = current.SessionId ?? "",
                ["revision"] = current.Revision,
                ["payload"] = payload,
            };
            if (!send(envelope.ToString(Formatting.None))) {
                // No route this frame (the desktop presenter is not attached yet, or a build
                // without the glue). Leave every face in the cache's `wanted` set so `Pump`
                // re-asks after the retry window; the view names the missing transport instead.
                DroppedRequests++;
                LastPublishError = "publish-unavailable";
                Cancel(batch.RequestId);
            } else {
                LastPublishError = "";
            }
        }

        static JObject FaceJson(ExitFaceFacts face) {
            var lines = new JArray();
            if (face.Painter == ExitFacePainter.ExitHeader) {
                foreach (var line in face.Lines ?? Array.Empty<ExitFaceLine>()) {
                    lines.Add(new JObject {
                        ["id"] = line.Id ?? "",
                        ["name"] = line.Name ?? "",
                        ["nameEn"] = line.NameEn ?? "",
                        ["colour"] = line.Colour ?? "",
                    });
                }
            }
            return new JObject {
                ["key"] = face.ContentKey,
                ["moduleId"] = face.ModuleId ?? "",
                ["recordType"] = face.RecordType ?? "",
                ["painter"] = ExitFaceVocabulary.Painter(face.Painter),
                ["pixels"] = face.Pixels,
                ["pixelsHigh"] = face.PixelsHigh,
                ["width"] = face.Width,
                ["height"] = face.Height,
                ["station"] = face.Station ?? "",
                ["stationEn"] = face.StationEn ?? "",
                ["city"] = face.City ?? "",
                ["exitName"] = face.ExitName ?? "",
                ["exitId"] = face.ExitId ?? "",
                ["exitFound"] = face.ExitFound,
                ["locale"] = face.Locale ?? "zh-CN",
                ["lines"] = lines,
            };
        }

        /* -------------------------------------------------------------- replies */

        /// <summary>True when this message belongs to the exit painter (`exit.faceChunk`/`exit.faceReady`).</summary>
        public static bool Handles(string type) => type == "exit.faceChunk" || type == "exit.faceReady";

        /// <summary>Route one C# → JS command here: `exit.faceChunk` or `exit.faceReady`.</summary>
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
            var current = context() ?? new ExitFaceContext();
            // Fence: a reply from another session, or for a revision this station has
            // already moved past, is a picture of a street that no longer exists.
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
            if (type == "exit.faceChunk") Chunk(requestId, payload);
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
                    Painter = ExitFaceVocabulary.ParsePainter(String(payload, "painter")),
                    Width = width,
                    Height = height,
                    Count = count,
                    ModuleId = String(payload, "moduleId"),
                    Locale = String(payload, "locale"),
                };
                faces[key] = assembly;
            }
            if (assembly.Count != count || assembly.Width != width || assembly.Height != height) return;
            if (assembly.Parts.ContainsKey(index)) return;
            assembly.Parts[index] = data;
        }

        void Ready(string requestId, JObject payload) {
            var assembled = assemblies.TryGetValue(requestId, out var faces) ? faces : null;
            var painted = new List<ExitFacePainted>();
            var pending = new List<ExitFacePending>();
            if (payload["painted"] is JArray paintedJson) {
                foreach (var token in paintedJson) {
                    if (!(token is JObject faceJson)) continue;
                    var key = String(faceJson, "key");
                    if (key.Length == 0) continue;
                    if (assembled == null || !assembled.TryGetValue(key, out var assembly)) continue;
                    if (assembly.Parts.Count != assembly.Count) continue;
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
                    painted.Add(new ExitFacePainted {
                        Key = key, ModuleId = assembly.ModuleId, Painter = assembly.Painter,
                        Width = width, Height = height, Ink = Float(faceJson, "ink", -1f),
                        Locale = String(faceJson, "locale").Length > 0 ? String(faceJson, "locale") : assembly.Locale,
                        Png = png,
                    });
                }
            }
            if (payload["pending"] is JArray pendingJson) {
                foreach (var token in pendingJson) {
                    if (!(token is JObject faceJson)) continue;
                    var key = String(faceJson, "key");
                    if (key.Length == 0) continue;
                    pending.Add(new ExitFacePending {
                        Key = key,
                        ModuleId = String(faceJson, "moduleId"),
                        Painter = ExitFaceVocabulary.ParsePainter(String(faceJson, "painter")),
                        Reason = String(faceJson, "reason"),
                        Detail = String(faceJson, "detail"),
                    });
                }
            }
            completed.Enqueue(new ExitFaceResponse {
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

        static float Float(JObject value, string name, float fallback) {
            if (value[name] == null) return fallback;
            var token = value[name];
            if (token.Type == JTokenType.Float || token.Type == JTokenType.Integer) return (float)token;
            return fallback;
        }

        public bool TryTake(out ExitFaceResponse response) {
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

    /* ------------------------------------------------------------------ bindings */

    /// <summary>
    /// One plate of one prefab instance: the baked renderer it replaces, the quad mounted
    /// at the same transform, and the pixels currently assigned to it.
    ///
    /// The mounted quad reuses the baked plate's **mesh** and its node transform. The
    /// promoted exports bake each printed plate as its own plane node with the texture's
    /// UVs already cut to the plate, so reusing the mesh is exact placement *and* exact
    /// UV orientation for all four facings; generating a fresh quad from bounds would be
    /// a second guess at both.
    /// </summary>
    public sealed class ExitFaceBinding {
        public ExitFaceFacts Facts;
        public MeshRenderer Baked;
        public GameObject Quad;
        public MeshRenderer Renderer;
        public Material Material;
        public Texture2D Texture;
        /// <summary>The upright runtime plate mesh (a copy of the baked geometry, new UVs).</summary>
        public Mesh RuntimeMesh;
        /// <summary>How the runtime UVs were derived from the physical face.</summary>
        public string UvBasis = "";
        /// <summary>True when the runtime mesh puts the image's top at the physical top edge.</summary>
        public bool UprightV;
        public string Key = "";
        public string Fingerprint = "";
        public string PaintedLocale = "";
        public float Ink = -1f;
        public int PixelsWide;
        public int PixelsHigh;

        public bool HasTexture => Texture != null;
        public string ModuleId => Facts != null ? Facts.ModuleId : "";
        public ExitFacePainter Painter => Facts != null ? Facts.Painter : ExitFacePainter.ExitHeader;

        internal void Apply(Texture2D texture, string fingerprint, float ink, string locale) {
            Texture = texture;
            Fingerprint = fingerprint ?? "";
            PaintedLocale = locale ?? "";
            Ink = ink;
            PixelsWide = texture != null ? texture.width : 0;
            PixelsHigh = texture != null ? texture.height : 0;
            StationExitArtwork.ApplyArtwork(Material, texture);
        }

        internal void Clear() {
            Texture = null;
            Fingerprint = "";
            PaintedLocale = "";
            Ink = -1f;
            PixelsWide = 0;
            PixelsHigh = 0;
            StationExitArtwork.ApplyArtwork(Material, null);
        }

        public string Describe() =>
            (Facts != null ? Facts.Describe() : Painter + " " + ModuleId) +
            (HasTexture ? " tex " + PixelsWide + "×" + PixelsHigh + " ink " + Ink.ToString("0.###", CultureInfo.InvariantCulture) + " " + Fingerprint : " tex none");
    }

    /* ------------------------------------------------------------------ the cache */

    /// <summary>
    /// The street's painted plates, by content.
    ///
    /// One entry per <see cref="ExitFaceFacts.ContentKey"/>: two exits lettered the same
    /// way share one texture, and a rename or locale switch mints a new key. The cache
    /// owns the bounded requests, the PNG upload, the retry of plates the painter
    /// reported not-ready and the release of replaced pixels. It never paints: the
    /// source painters are reached through <see cref="IExitFaceProvider"/>.
    /// </summary>
    public sealed class ExitFaceTextureCache : IDisposable {
        /// <summary>Plates one `exit.requestFace` may carry, so one message stays small.</summary>
        public const int MaxRequestFaces = 32;
        /// <summary>How long a plate reported not-ready waits before it is asked for again.</summary>
        public const float RetrySeconds = 1f;

        sealed class Entry {
            public string Key = "";
            public Texture2D Texture;
            public string Fingerprint = "";
            public int Refs;
            public float LastUsed;
            public float Ink = -1f;
            public int Width;
            public int Height;
            public int Bytes;
            public ExitFacePainter Painter;
            public string ModuleId = "";
            public string Locale = "";
            public string PaintedLocale = "";
        }

        readonly IExitFaceProvider provider;
        readonly List<ExitFaceBinding> bindings = new List<ExitFaceBinding>();
        readonly Dictionary<string, Entry> entries = new Dictionary<string, Entry>(StringComparer.Ordinal);
        readonly Dictionary<string, List<ExitFaceBinding>> subscribers =
            new Dictionary<string, List<ExitFaceBinding>>(StringComparer.Ordinal);
        readonly Dictionary<string, ExitFaceFacts> wanted = new Dictionary<string, ExitFaceFacts>(StringComparer.Ordinal);
        readonly Dictionary<string, float> askedAt = new Dictionary<string, float>(StringComparer.Ordinal);
        readonly Dictionary<string, int> attempts = new Dictionary<string, int>(StringComparer.Ordinal);
        int counter;
        bool disposed;

        public ExitFaceTextureCache(IExitFaceProvider provider) {
            this.provider = provider ?? throw new ArgumentNullException(nameof(provider));
        }

        public IExitFaceProvider Provider => provider;
        /// <summary>Plates this cache bound (one per replaceable face node).</summary>
        public int BoundCount => bindings.Count;
        /// <summary>Plates whose pixels are painted.</summary>
        public int ServedCount {
            get {
                int served = 0;
                foreach (var binding in bindings) if (binding.HasTexture) served++;
                return served;
            }
        }
        /// <summary>Textures currently held (one per painted key).</summary>
        public int TextureCount => entries.Count;
        /// <summary>Unique plates waiting for pixels.</summary>
        public int PendingCount => wanted.Count;
        /// <summary>Batches this cache published (a probe counts reprints with it).</summary>
        public int RequestCount { get; private set; }
        /// <summary>PNG replies this cache applied.</summary>
        public int PaintedCount { get; private set; }
        /// <summary>Plates re-keyed in place (a locale switch or an identity edit).</summary>
        public int RepaintCount { get; private set; }
        /// <summary>The least-inked served plate's non-empty fraction; 0 when nothing is served.</summary>
        public float MinInk {
            get {
                bool any = false;
                float min = 1f;
                foreach (var entry in entries.Values) {
                    if (entry.Texture == null || entry.Ink < 0f) continue;
                    if (!any || entry.Ink < min) { min = entry.Ink; any = true; }
                }
                return any ? min : 0f;
            }
        }

        /// <summary>
        /// Bind one mounted replaceable plate: a cache hit applies its pixels at once, a
        /// miss queues the request. The binding is the scene node
        /// `StationExitArtwork.Mount` created; the cache owns its pixels, not its quad.
        /// </summary>
        public void Bind(ExitFaceBinding binding) {
            if (disposed || binding == null || binding.Facts == null) return;
            bindings.Add(binding);
            Subscribe(binding);
        }

        /// <summary>Every plate this cache bound, in build order (a probe reads them).</summary>
        public IReadOnlyList<ExitFaceBinding> Bindings => bindings;

        void Subscribe(ExitFaceBinding binding) {
            if (binding == null || binding.Facts == null) return;
            binding.Key = binding.Facts.ContentKey;
            Subscribers(binding.Key).Add(binding);
            if (entries.TryGetValue(binding.Key, out var entry) && entry.Texture != null) {
                entry.Refs++;
                entry.LastUsed = Time.realtimeSinceStartup;
                binding.Apply(entry.Texture, entry.Fingerprint, entry.Ink, entry.PaintedLocale);
            } else {
                wanted[binding.Key] = binding.Facts;
            }
        }

        List<ExitFaceBinding> Subscribers(string key) {
            if (!subscribers.TryGetValue(key, out var list)) subscribers[key] = list = new List<ExitFaceBinding>(2);
            return list;
        }

        /// <summary>A different station or locale: re-key every plate and paint again.</summary>
        public void Repaint() {
            if (disposed) return;
            foreach (var binding in bindings) binding.Clear();
            foreach (var entry in entries.Values) DestroyTexture(entry.Texture);
            entries.Clear();
            subscribers.Clear();
            wanted.Clear();
            ForgetAll();
            foreach (var binding in bindings) Subscribe(binding);
            RepaintCount++;
            Pump();
        }

        /* ------------------------------------------------------------ requests */

        /// <summary>
        /// Drain replies, upload what arrived and ask for anything still missing. A plate
        /// is re-asked only after <see cref="RetrySeconds"/> (then with a bounded backoff).
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
            var batch = new ExitFaceBatch {
                RequestId = "exit-req-" + (++counter),
                Faces = new ExitFaceFacts[keys.Count],
            };
            for (int i = 0; i < keys.Count; i++) {
                batch.Faces[i] = wanted[keys[i]];
                askedAt[keys[i]] = now;
                attempts.TryGetValue(keys[i], out var attempt);
                attempts[keys[i]] = attempt + 1;
                if (batch.Locale.Length == 0 || batch.Locale == null) batch.Locale = batch.Faces[i].Locale;
            }
            if (batch.Locale == null) batch.Locale = "zh-CN";
            RequestCount++;
            provider.Request(batch);
        }

        bool ReadyToAsk(string key, float now) {
            if (!askedAt.TryGetValue(key, out var asked)) return true;
            attempts.TryGetValue(key, out var attempt);
            float delay = RetrySeconds * Mathf.Pow(2f, Mathf.Clamp(attempt - 1, 0, 6));
            return now - asked >= delay;
        }

        /// <summary>Ask again for the pending plates now instead of after `RetrySeconds`.</summary>
        public void RetryNow() {
            askedAt.Clear();
            attempts.Clear();
        }

        void Forget(string key) {
            askedAt.Remove(key);
            attempts.Remove(key);
        }

        void ForgetAll() {
            askedAt.Clear();
            attempts.Clear();
        }

        void Apply(ExitFaceResponse response) {
            if (response == null) return;
            foreach (var painted in response.Painted ?? Array.Empty<ExitFacePainted>()) {
                if (painted == null || painted.Png == null || painted.Png.Length == 0) continue;
                if (!wanted.TryGetValue(painted.Key, out var facts)) continue;      // stale: no one wants it
                if (facts.Pixels > 0 &&
                    (painted.Width != facts.Pixels || painted.Height != facts.PixelsHigh)) continue;
                if (painted.Width < 16 || painted.Height < 16 || painted.Width > 4096 || painted.Height > 4096) continue;
                if (entries.ContainsKey(painted.Key)) continue;                    // already painted by another batch
                var texture = Decode(painted.Png, painted.Width, painted.Height, "exit face " + Short(painted.Key));
                if (texture == null) continue;
                var entry = new Entry {
                    Key = painted.Key,
                    Texture = texture,
                    Fingerprint = Short(painted.Key) + "@" + painted.Width + "x" + painted.Height,
                    Ink = painted.Ink >= 0f ? painted.Ink : InkFraction(texture),
                    Width = painted.Width,
                    Height = painted.Height,
                    Bytes = painted.Png.Length,
                    Painter = facts.Painter,
                    ModuleId = facts.ModuleId,
                    Locale = facts.Locale,
                    PaintedLocale = painted.Locale,
                    LastUsed = Time.realtimeSinceStartup,
                };
                entries[painted.Key] = entry;
                wanted.Remove(painted.Key);
                Forget(painted.Key);
                PaintedCount++;
                if (!subscribers.TryGetValue(painted.Key, out var list)) continue;
                foreach (var binding in list.ToArray()) {
                    entry.Refs++;
                    entry.LastUsed = Time.realtimeSinceStartup;
                    binding.Apply(entry.Texture, entry.Fingerprint, entry.Ink, entry.PaintedLocale);
                }
            }
            foreach (var pending in response.Pending ?? Array.Empty<ExitFacePending>()) {
                if (pending == null) continue;
                if (!wanted.ContainsKey(pending.Key)) continue;
                // A plate with nothing printable is final; a font that has not landed yet
                // keeps its place in the queue for the retry window.
                if (pending.Reason == "empty" || pending.Reason == "unsupported") {
                    wanted.Remove(pending.Key);
                    Forget(pending.Key);
                }
            }
        }

        /* -------------------------------------------------------------- pixels */

        /// <summary>
        /// The fraction of pixels the painter actually marked: non-transparent coverage for
        /// a transparent plate (the guidepost's ink), non-ground pixels for the opaque
        /// fascia. A blank plate can never pass as served artwork.
        /// </summary>
        internal static float InkFraction(Texture2D texture) {
            if (texture == null) return 0f;
            try {
                var pixels = texture.GetPixels32();
                if (pixels == null || pixels.Length == 0) return 0f;
                var ground = pixels[0];
                int ink = 0;
                for (int i = 0; i < pixels.Length; i++) {
                    var pixel = pixels[i];
                    if (ground.a <= 16) {
                        if (pixel.a > 16) ink++;
                    } else if (pixel.r != ground.r || pixel.g != ground.g || pixel.b != ground.b || pixel.a != ground.a) {
                        ink++;
                    }
                }
                return ink / (float)pixels.Length;
            } catch (Exception) {
                return -1f;
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
            subscribers.Clear();
            wanted.Clear();
            ForgetAll();
            foreach (var binding in bindings) binding.Clear();
            bindings.Clear();
        }

        /// <summary>A per-plate row for the state report (no pixels, just the facts).</summary>
        public JObject Report() {
            var faces = new JArray();
            foreach (var binding in bindings) {
                var facts = binding.Facts;
                faces.Add(new JObject {
                    ["moduleId"] = binding.ModuleId,
                    ["painter"] = ExitFaceVocabulary.Painter(binding.Painter),
                    ["key"] = Short(binding.Key),
                    ["locale"] = facts != null ? facts.Locale ?? "" : "",
                    ["paintedLocale"] = binding.PaintedLocale ?? "",
                    ["pixels"] = binding.PixelsWide > 0 ? binding.PixelsWide : (facts != null ? facts.Pixels : 0),
                    ["pixelsHigh"] = binding.PixelsHigh > 0 ? binding.PixelsHigh : (facts != null ? facts.PixelsHigh : 0),
                    ["ink"] = Math.Round(binding.Ink, 4),
                    ["served"] = binding.HasTexture,
                    ["texture"] = binding.Fingerprint ?? "",
                    ["uvBasis"] = binding.UvBasis ?? "",
                    ["upright"] = binding.UprightV,
                    ["plate"] = facts != null
                        ? new JArray(Math.Round(facts.Width, 3), Math.Round(facts.Height, 3))
                        : new JArray(),
                });
            }
            var missing = new JArray();
            foreach (var key in wanted.Keys) missing.Add(Short(key));
            return new JObject {
                ["faces"] = faces,
                ["bound"] = BoundCount,
                ["served"] = ServedCount,
                ["textures"] = TextureCount,
                ["pending"] = PendingCount,
                ["minInk"] = Math.Round(MinInk, 4),
                ["requests"] = RequestCount,
                ["painted"] = PaintedCount,
                ["reprints"] = RepaintCount,
                ["missing"] = missing,
            };
        }

        public static JObject EmptyReport() => new JObject {
            ["faces"] = new JArray(),
            ["bound"] = 0,
            ["served"] = 0,
            ["textures"] = 0,
            ["pending"] = 0,
            ["minInk"] = 0.0,
            ["requests"] = 0,
            ["painted"] = 0,
            ["reprints"] = 0,
            ["missing"] = new JArray(),
        };
    }

    /* ------------------------------------------------------------------ scope */

    /// <summary>
    /// One world's street-artwork connection: the provider, the cache and the plates this
    /// build bound. It lives on the world's own `street` role root, so a station switch
    /// can never let the outgoing world's teardown take the incoming station's artwork
    /// with it (the renderer singleton is reused across the staged candidate).
    /// </summary>
    public sealed class StationExitArtworkScope : MonoBehaviour {
        public ExitFaceWebProvider Provider;
        public ExitFaceTextureCache Cache;
        /// <summary>The host-bound publisher; null means only the WebGL bridge can be tried.</summary>
        public Func<string, bool> Publish;
        public readonly List<ExitFaceBinding> Bindings = new List<ExitFaceBinding>();
        /// <summary>The scope this one replaced; restored if this build never commits.</summary>
        internal StationExitArtworkScope Previous;

        /// <summary>True when this world already bound one plate of that module/painter.</summary>
        public bool HasFace(string moduleId, ExitFacePainter painter) {
            foreach (var binding in Bindings) {
                if (binding == null || binding.Facts == null) continue;
                if (binding.Facts.Painter != painter) continue;
                if (string.Equals(binding.Facts.ModuleId, moduleId, StringComparison.Ordinal)) return true;
            }
            return false;
        }

        void OnDestroy() => StationExitArtwork.ReleaseScope(this);
    }

    /// <summary>The per-frame retry tick for plates the painter reported not-ready.</summary>
    public sealed class ExitFacePump : MonoBehaviour {
        public ExitFaceTextureCache Cache;
        void Update() {
            if (Cache != null) Cache.Pump();
        }
    }

    /* ------------------------------------------------------------------ the packet */

    /// <summary>
    /// Plan 16 §5.3 — the dynamic identity of the street exits and guideposts.
    ///
    /// The promoted `ExitUncovered2`/`ExitCovered*`/`ExitDoorway*` prefabs bake their
    /// printed fascia (`exitHeaderPlate_*`) and `Guidepost.prefab` bakes its station,
    /// rear and exit-letter plates (`guidePlate_*`) from the empty Guangzhou export.
    /// This packet finds those plate nodes on each placed instance, disables only the
    /// baked plate, mounts a replaceable quad at its exact node transform (reusing the
    /// plate mesh, so the UVs and all four facings stay the export's own), and paints
    /// the plate from the **committed** station name/nameEn, city, exit `cfg.name` and
    /// the station's line facts.
    ///
    /// The painter is the TypeScript source itself (`exitHeaderCanvas`, `guideFace`,
    /// `guideEnglishFace`, `guideExitLetterFace`) through `exitFaceProvider.ts`, so a
    /// fresh WebGL player prints the same artwork as the game. Everything else on the
    /// prefab — canopy, frame, glass, railing, posts, pictogram and logo collar — is
    /// untouched.
    /// </summary>
    public static class StationExitArtwork {
        /// <summary>A test/verifier seam that captures the C#→JS requests (null = the bridge).</summary>
        public static Action<string> SendHook;

        /// <summary>The locale the painted plates are set in; the shell keeps it current.</summary>
        public static string Locale = "zh-CN";

        /// <summary>The world scope the current provider/cache belong to.</summary>
        public static StationExitArtworkScope Scope {
            get {
                var scope = current;
                if (scope == null) return null;
                // A scope whose world was destroyed without its `OnDestroy` running (an
                // abandoned inactive candidate) reads as null instead of as a Unity fake-null.
                if (scope.gameObject == null) {
                    current = null;
                    liveScopes.Remove(scope);
                    return null;
                }
                return scope;
            }
        }
        static StationExitArtworkScope current;
        public static ExitFaceWebProvider Provider => Scope != null ? Scope.Provider : null;
        public static ExitFaceTextureCache Cache => Scope != null ? Scope.Cache : null;

        public static readonly ExitFaceArtworkState State = new ExitFaceArtworkState();

        internal static void Attach(StationExitArtworkScope scope) {
            if (scope == null || scope.Cache == null) return;
            scope.Previous = current;
            current = scope;
        }

        internal static void Detach(StationExitArtworkScope scope) {
            if (scope == null || current != scope) return;
            var previous = scope.Previous;
            if (previous != null && previous.gameObject != null) {
                current = previous;
                return;
            }
            current = null;
        }

        /// <summary>Route one `exit.faceChunk` / `exit.faceReady` into the active painter.</summary>
        public static bool Receive(string json) => Provider != null && Provider.Receive(json);

        /// <summary>Upload whatever the painter has already answered.</summary>
        public static void Pump() => Cache?.Pump();

        /// <summary>
        /// Send one C#→JS message: a test's hook first (the verifier seam), then the
        /// committed world's host-bound publisher, then the WebGL bridge. The desktop player
        /// has no WebGL bridge, so a request that skipped the host could never reach the
        /// React painter (the transport rule RCA 14 §4.1 established for sign faces).
        /// </summary>
        public static bool Send(string json) {
            if (string.IsNullOrEmpty(json)) return false;
            var hook = SendHook;
            if (hook != null) {
                hook(json);
                return true;
            }
            var scope = Scope;
            var publish = scope != null ? scope.Publish : null;
            if (publish != null) return publish(json);
            return StationWebBridge.Publish(json);
        }

        /* ------------------------------------------------------------ identity */

        /// <summary>The exit a guidepost links to by `cfg.exitId`; null when it links nothing.</summary>
        public static ModuleFacts ResolveGuideExit(IReadOnlyList<ModuleFacts> station, ModuleFacts guidepost) {
            if (guidepost == null) return null;
            var id = guidepost.Config != null ? guidepost.Config.Text("exitId") : "";
            if (string.IsNullOrEmpty(id) || station == null) return null;
            for (int i = 0; i < station.Count; i++) {
                var candidate = station[i];
                if (candidate == null || candidate.Type != "exit") continue;
                if (string.Equals(candidate.Id, id, StringComparison.Ordinal)) return candidate;
            }
            return null;
        }

        /// <summary>
        /// The label a plate prints for an exit: `guideLabels`' own rule — the saved
        /// `cfg.name` with a trailing 出入口/出口/入口/口 removed. An empty answer is left
        /// empty so the TypeScript painter applies its `t('entrance')` fallback in the
        /// active locale, exactly as the source does.
        /// </summary>
        public static string ExitLabel(ModuleFacts exit) {
            if (exit == null) return "";
            var name = exit.Config != null ? exit.Config.Text("name") : "";
            return StripExitSuffix(name);
        }

        /// <summary>Port of `guideLabels`'s `replace(/(?:出入口|出口|入口|口)$/u, '').trim()`.</summary>
        public static string StripExitSuffix(string name) {
            var value = (name ?? "").Trim();
            foreach (var suffix in new[] { "出入口", "出口", "入口", "口" }) {
                if (value.EndsWith(suffix, StringComparison.Ordinal)) {
                    return value.Substring(0, value.Length - suffix.Length).Trim();
                }
            }
            return value;
        }

        /// <summary>The facts every plate of one module shares (identity, not the plate).</summary>
        static ExitFaceFacts FactsFor(StationDocument document, ModuleFacts module, IReadOnlyList<ModuleFacts> station) {
            if (document == null || module == null) return null;
            var facts = new ExitFaceFacts {
                ModuleId = module.Id ?? "",
                Station = document.Name ?? "",
                StationEn = document.NameEn ?? "",
                City = document.City ?? "",
                Locale = string.IsNullOrEmpty(Locale) ? "zh-CN" : Locale,
            };
            var lines = new List<ExitFaceLine>(document.Lines != null ? document.Lines.Count : 0);
            if (document.Lines != null) {
                foreach (var line in document.Lines) {
                    if (line == null) continue;
                    lines.Add(new ExitFaceLine(line.Id, line.Name, line.Colour, line.NameEn));
                }
            }
            lines.Sort((a, b) => string.CompareOrdinal(a.Id, b.Id));
            facts.Lines = lines.ToArray();
            if (string.Equals(module.Type, "guidepost", StringComparison.Ordinal)) {
                var exit = ResolveGuideExit(station, module);
                facts.ExitId = module.Config != null ? module.Config.Text("exitId") : "";
                // The source keeps the saved cfg.name here and strips a trailing 口 family
                // suffix inside `guideLabels`; an unresolved link is flagged so the painter
                // applies its own `t('entrance')` fallback rather than printing nothing.
                facts.ExitName = exit != null && exit.Config != null ? exit.Config.Text("name") : "";
                facts.ExitFound = exit != null;
                if (exit != null && string.IsNullOrEmpty(facts.ExitId)) facts.ExitId = exit.Id ?? "";
            } else {
                facts.ExitId = module.Id ?? "";
                facts.ExitName = module.Config != null ? module.Config.Text("name") : "";
                facts.ExitFound = true;
            }
            return facts;
        }

        /* ------------------------------------------------------------ mounting */

        /// <summary>One discovered baked plate on a placed prefab instance.</summary>
        public sealed class FaceNode {
            public MeshRenderer Baked;
            public ExitFacePainter Painter;
            public int Pixels;
            public int PixelsHigh;
            public float Width;
            public float Height;
            public string MaterialName = "";
            public string NodeName = "";
        }

        /// <summary>
        /// Find the replaceable plate nodes on one placed street prefab. Identification is by
        /// the promoted material the export names (`exitHeaderPlate_*`, `guidePlate_256x277`,
        /// `guidePlate_256x993`, `guidePlate_256x256_2`) and, for a guidepost, the preserved
        /// node name (`guide-station-face`, `guide-square-exit-letter`). Nothing is guessed
        /// from geometry: a prefab without an identifiable plate binds nothing.
        /// </summary>
        public static List<FaceNode> Discover(GameObject root, ModuleFacts module) {
            var nodes = new List<FaceNode>(4);
            if (!root || module == null) return nodes;
            bool guidepost = string.Equals(module.Type, "guidepost", StringComparison.Ordinal);
            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer) continue;
                var material = renderer.sharedMaterial;
                var materialName = material != null ? material.name : "";
                var nodeName = renderer.transform != null ? renderer.transform.name : "";
                ExitFacePainter painter;
                if (!guidepost) {
                    if (materialName.IndexOf("exitHeaderPlate", StringComparison.OrdinalIgnoreCase) < 0 &&
                        nodeName.IndexOf("exit-doorway-sign", StringComparison.Ordinal) < 0) continue;
                    painter = ExitFacePainter.ExitHeader;
                } else if (!TryGuidePainter(nodeName, materialName, out painter)) {
                    continue;
                }
                int width, height;
                if (painter == ExitFacePainter.ExitHeader) {
                    // The painter decides its per-city resolution (`exitHeaderResolution`);
                    // the promoted plate's own metre size is recorded for the report.
                    width = 0;
                    height = 0;
                } else if (!TryPlatePixels(material, materialName, painter, out width, out height)) {
                    width = 0;
                    height = 0;
                }
                TryPlateMetres(renderer, out var metresWide, out var metresHigh);
                nodes.Add(new FaceNode {
                    Baked = renderer,
                    Painter = painter,
                    Pixels = width,
                    PixelsHigh = height,
                    Width = metresWide,
                    Height = metresHigh,
                    MaterialName = materialName,
                    NodeName = nodeName,
                });
            }
            return nodes;
        }

        /// <summary>
        /// The promoted guidepost's **explicit plate metadata**: one row per writable
        /// surface, keyed by the exact node name and material the export preserves. The
        /// old identification guessed from a material-name substring and a texture height;
        /// this table is the asset contract (logo plates and the train icon are deliberately
        /// absent, so their baked ink is never touched).
        /// </summary>
        static readonly GuidePlateSpec[] GuidePlates = {
            new GuidePlateSpec("guide-station-face", "guidePlate_256x277", ExitFacePainter.GuideStationUpper),
            new GuidePlateSpec("guide-station-face", "guidePlate_256x993", ExitFacePainter.GuideStationRear),
            new GuidePlateSpec("guide-square-exit-letter", "guidePlate_256x256_2", ExitFacePainter.GuideExitLetter),
        };

        readonly struct GuidePlateSpec {
            public readonly string Node;
            public readonly string Material;
            public readonly ExitFacePainter Painter;
            public GuidePlateSpec(string node, string material, ExitFacePainter painter) {
                Node = node; Material = material; Painter = painter;
            }
            public string Describe() => Node + "|" + Material + "|" + ExitFaceVocabulary.Painter(Painter);
        }

        /// <summary>Every writable guidepost plate the asset metadata names (a probe reads this).</summary>
        public static IReadOnlyList<string> GuidePlateMetadata {
            get {
                var rows = new string[GuidePlates.Length];
                for (int i = 0; i < GuidePlates.Length; i++) rows[i] = GuidePlates[i].Describe();
                return rows;
            }
        }

        static bool TryGuidePainter(string nodeName, string materialName, out ExitFacePainter painter) {
            painter = ExitFacePainter.GuideStationUpper;
            var material = MaterialBaseName(materialName);
            for (int i = 0; i < GuidePlates.Length; i++) {
                var spec = GuidePlates[i];
                if (!nodeName.StartsWith(spec.Node, StringComparison.Ordinal)) continue;
                if (!string.Equals(material, spec.Material, StringComparison.Ordinal)) continue;
                painter = spec.Painter;
                return true;
            }
            return false;
        }

        /// <summary>A Unity material's asset name without any importer/runtime suffix.</summary>
        static string MaterialBaseName(string name) {
            if (string.IsNullOrEmpty(name)) return "";
            int suffix = name.IndexOf(" (", StringComparison.Ordinal);
            return suffix > 0 ? name.Substring(0, suffix) : name;
        }

        static bool TryParsePlateSize(string materialName, out int width, out int height) {
            width = 0;
            height = 0;
            if (string.IsNullOrEmpty(materialName)) return false;
            var marker = materialName.IndexOf("plate_", StringComparison.OrdinalIgnoreCase);
            var start = marker >= 0 ? marker + "plate_".Length : 0;
            int i = start;
            while (i < materialName.Length && !char.IsDigit(materialName[i])) i++;
            int w = 0, h = 0;
            int digits = i;
            while (i < materialName.Length && char.IsDigit(materialName[i])) { w = w * 10 + (materialName[i] - '0'); i++; }
            if (i == digits || i >= materialName.Length || (materialName[i] != 'x' && materialName[i] != 'X')) return false;
            i++;
            digits = i;
            while (i < materialName.Length && char.IsDigit(materialName[i])) { h = h * 10 + (materialName[i] - '0'); i++; }
            if (i == digits) return false;
            width = w;
            height = h;
            return true;
        }

        static bool TryPlatePixels(Material material, string materialName, ExitFacePainter painter, out int width, out int height) {
            width = 0;
            height = 0;
            // The baked texture is the export's own canvas size, so reusing it keeps the
            // plate's UV mapping exact. A material without a texture falls back to the name.
            if (material != null) {
                var texture = material.mainTexture;
                if (texture == null && material.HasProperty("_BaseMap")) texture = material.GetTexture("_BaseMap");
                if (texture != null && texture.width > 0 && texture.height > 0) {
                    width = texture.width;
                    height = texture.height;
                    return true;
                }
            }
            if (TryParsePlateSize(materialName, out width, out height)) return true;
            switch (painter) {
                case ExitFacePainter.GuideStationUpper: width = 256; height = 277; return true;
                case ExitFacePainter.GuideStationRear: width = 256; height = 993; return true;
                case ExitFacePainter.GuideExitLetter: width = 256; height = 256; return true;
                default: return false;
            }
        }

        static void TryPlateMetres(MeshRenderer renderer, out float width, out float height) {
            width = 0f;
            height = 0f;
            var filter = renderer.GetComponent<MeshFilter>();
            var mesh = filter != null ? filter.sharedMesh : null;
            if (!mesh) return;
            var size = mesh.bounds.size;
            width = Mathf.Max(size.x, size.z);
            height = size.y;
        }

        /// <summary>One binding refusal/gap, in the shape a world diagnostic takes.</summary>
        public readonly struct FaceDiagnostic {
            public readonly string Code;
            public readonly string RecordType;
            public readonly string RecordId;
            public readonly string Message;
            public FaceDiagnostic(string code, string recordType, string recordId, string message) {
                Code = code ?? "exit-face";
                RecordType = recordType ?? "";
                RecordId = recordId ?? "";
                Message = message ?? "";
            }
        }

        /// <summary>
        /// Bind every identifiable plate of one placed `exit`/`guidepost` instance. Called
        /// from `StationStreetModuleRenderer.BuildExit` and its guidepost branch. A prefab
        /// with no identifiable plate is reported as `exit-face-not-found:<id>` and keeps
        /// its baked face: nothing is drawn at a guessed transform.
        /// </summary>
        public static void Bind(StationViewBuildContext context, Func<StationExitArtworkScope> scopeFor,
            GameObject root, ModuleFacts module, IReadOnlyList<ModuleFacts> station, string prefabPath) {
            if (context == null) return;
            Bind(context.Document,
                diagnostic => context.ReportUnresolved(diagnostic.Code, diagnostic.RecordType, diagnostic.RecordId, diagnostic.Message),
                scopeFor, root, module, station, prefabPath);
        }

        /// <summary>The document-only form, so an EditMode test can drive the same binding.</summary>
        public static void Bind(StationDocument document, Action<FaceDiagnostic> report,
            Func<StationExitArtworkScope> scopeFor, GameObject root, ModuleFacts module, IReadOnlyList<ModuleFacts> station,
            string prefabPath) {
            report ??= _ => { };
            if (root == null || module == null) return;
            var nodes = Discover(root, module);
            if (nodes.Count == 0) {
                report(new FaceDiagnostic("exit-face-not-found", module.Type, module.Id,
                    "no replaceable plate renderer on " + (prefabPath ?? "the prefab") + ": " + DescribeRenderers(root) +
                    "; the baked face is left as-is."));
                return;
            }
            var baseFacts = FactsFor(document, module, station);
            if (baseFacts == null) {
                report(new FaceDiagnostic("exit-face-facts", module.Type, module.Id, "the committed document is missing"));
                return;
            }
            StationExitArtworkScope scope = null;
            var bound = 0;
            foreach (var node in nodes) {
                if (scope == null) {
                    scope = scopeFor != null ? scopeFor() : null;
                    if (scope == null || scope.Cache == null) {
                        report(new FaceDiagnostic("exit-face-provider", module.Type, module.Id,
                            "no exit artwork provider could be created for this world"));
                        return;
                    }
                }
                // Every plate node is its own printable face: a guidepost carries two
                // upper station plates that share one painted texture but are two nodes.
                var facts = baseFacts.Copy(node.Painter, node.Pixels, node.PixelsHigh, node.Width, node.Height);
                var binding = Mount(node, facts);
                if (binding == null) {
                    report(new FaceDiagnostic("exit-face-bind", module.Type, module.Id,
                        "could not mount the " + ExitFaceVocabulary.Painter(node.Painter) + " plate of " + node.MaterialName));
                    continue;
                }
                scope.Bindings.Add(binding);
                scope.Cache.Bind(binding);
                bound++;
            }
            if (bound == 0) {
                report(new FaceDiagnostic("exit-face-not-found", module.Type, module.Id,
                    "the prefab names no printable plate for this family: " + DescribeRenderers(root)));
                return;
            }
            scope.Cache.Pump();
            if (!string.IsNullOrEmpty(baseFacts.City) &&
                !string.Equals(baseFacts.City, "guangzhou", StringComparison.OrdinalIgnoreCase)) {
                // The promoted street prefabs are the Guangzhou exports; a per-city canopy or
                // pillar shape is a separate asset gap, named rather than silently drawn.
                report(new FaceDiagnostic(
                    module.Type == "guidepost" ? "guidepost-city-shape" : "exit-city-shape",
                    module.Type, module.Id,
                    "painted for city '" + baseFacts.City + "' on the promoted guangzhou-shaped prefab"));
            }
        }

        /// <summary>Count of plates this scope bound, by kind, for a probe/report.</summary>
        public static int Count(StationExitArtworkScope scope, ExitFacePainter painter) {
            int count = 0;
            if (scope == null) return 0;
            foreach (var binding in scope.Bindings) if (binding.Painter == painter) count++;
            return count;
        }

        static ExitFaceBinding Mount(FaceNode node, ExitFaceFacts facts) {
            var baked = node.Baked;
            if (!baked) return null;
            var filter = baked.GetComponent<MeshFilter>();
            var mesh = filter != null ? filter.sharedMesh : null;
            if (!mesh) return null;
            var parent = baked.transform.parent;
            if (parent == null) return null;
            var quad = new GameObject("exit face " + ExitFaceVocabulary.Painter(facts.Painter) + " " + facts.ModuleId,
                typeof(MeshFilter), typeof(MeshRenderer));
            quad.transform.SetParent(parent, false);
            // Same node transform as the export's plate: its scale/rotation/position are the
            // placement the artist's export baked, not a second guess.
            quad.transform.localPosition = baked.transform.localPosition;
            quad.transform.localRotation = baked.transform.localRotation;
            quad.transform.localScale = baked.transform.localScale;
            // The baked mesh's atlas UVs belong to the **baked glTF atlas**. A runtime PNG
            // has Unity's own row order, so the plate gets an explicit upright mesh: the
            // physical face's up (the world up in the node's frame) decides which edge is
            // the image's top. The baked U is kept — the export's left/right is the plate's
            // own — and V is rewritten exactly once, never per sign type.
            var runtime = BuildUprightPlate(mesh, baked.transform, out var basis, out bool upright);
            quad.GetComponent<MeshFilter>().sharedMesh = runtime;
            var template = baked.sharedMaterial;
            var material = template != null
                ? new Material(template) { name = "exit face " + facts.ModuleId + " " + ExitFaceVocabulary.Painter(facts.Painter) }
                : new Material(Shader.Find("Unlit/Texture")) { name = "exit face " + facts.ModuleId };
            if (template != null) material.renderQueue = template.renderQueue;
            var renderer = quad.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            ApplyArtwork(material, null);
            // Disable only the baked plate: canopy, frame, glass, railing, posts and the
            // pictogram/logo plates stay exactly as the prefab drew them.
            baked.enabled = false;
            return new ExitFaceBinding {
                Facts = facts,
                Baked = baked,
                Quad = quad,
                Renderer = renderer,
                Material = material,
                RuntimeMesh = runtime,
                UvBasis = basis,
                UprightV = upright,
            };
        }

        /// <summary>
        /// Copy a baked plate's geometry with UVs derived from the **physical face**: the
        /// node's up in mesh space identifies the top edge, and the baked V convention is
        /// flipped when it disagrees. The U axis is kept from the export (its own left/right
        /// is already the plate's), so a runtime PNG is applied upright exactly once. A
        /// degenerate/planar-less mesh keeps its baked UVs and says so in the basis note.
        /// </summary>
        public static Mesh BuildUprightPlate(Mesh baked, Transform node, out string basis, out bool upright) {
            var runtime = new Mesh { name = (baked != null ? baked.name : "exit plate") + " runtime-upright" };
            upright = false;
            basis = "baked";
            if (baked == null || node == null) return runtime;
            var vertices = baked.vertices;
            var uv = baked.uv;
            if (uv == null || uv.Length != vertices.Length || vertices.Length == 0) {
                CopyMesh(baked, runtime);
                return runtime;
            }
            var normals = baked.normals;
            var normal = Vector3.zero;
            for (int i = 0; i < normals.Length; i++) normal += normals[i];
            if (normal.sqrMagnitude < 1e-8f) normal = Vector3.forward;
            normal.Normalize();
            var up = node.InverseTransformDirection(Vector3.up);
            up -= normal * Vector3.Dot(up, normal);
            if (up.sqrMagnitude < 1e-8f) {
                // No physical up in the node frame (a horizontal plate): keep the baked UVs.
                CopyMesh(baked, runtime);
                basis = "baked:no-up";
                return runtime;
            }
            up.Normalize();
            int top = 0;
            float best = float.MinValue;
            for (int i = 0; i < vertices.Length; i++) {
                float height = Vector3.Dot(vertices[i], up);
                if (height <= best) continue;
                best = height;
                top = i;
            }
            float bakedTopV = uv[top].y;
            bool invert = bakedTopV < .5f;
            var mapped = new Vector2[uv.Length];
            for (int i = 0; i < uv.Length; i++)
                mapped[i] = invert ? new Vector2(uv[i].x, 1f - uv[i].y) : uv[i];
            CopyMesh(baked, runtime);
            runtime.uv = mapped;
            runtime.RecalculateBounds();
            upright = mapped[top].y > .5f;
            basis = "physical-up " + (invert ? "v-flipped" : "v-baked") +
                " bakedTopV=" + bakedTopV.ToString("0.###", CultureInfo.InvariantCulture) +
                " up=(" + up.x.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                up.y.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                up.z.ToString("0.###", CultureInfo.InvariantCulture) + ")";
            return runtime;
        }

        static void CopyMesh(Mesh source, Mesh target) {
            target.Clear();
            target.indexFormat = source.indexFormat;
            target.vertices = source.vertices;
            target.normals = source.normals;
            target.uv = source.uv;
            target.subMeshCount = source.subMeshCount;
            for (int i = 0; i < source.subMeshCount; i++)
                target.SetTriangles(source.GetTriangles(i), i);
        }

        /// <summary>
        /// Assign a painted plate to a material. The source plates are unlit
        /// (`MeshBasicMaterial`), so the print goes on both the base map and emission; an
        /// unpainted transparent plate stays invisible instead of showing a dark sheet.
        /// </summary>
        internal static void ApplyArtwork(Material material, Texture2D texture) {
            if (material == null) return;
            if (texture == null) {
                bool transparent = material.renderQueue >= (int)RenderQueue.Transparent;
                var colour = transparent ? new Color(0f, 0f, 0f, 0f) : new Color(.07f, .08f, .09f, 1f);
                if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", colour);
                if (material.HasProperty("_Color")) material.color = colour;
                if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", null);
                if (material.HasProperty("_MainTex")) material.SetTexture("_MainTex", null);
                material.mainTexture = null;
                return;
            }
            StationSignMaterials.ApplyTexture(material, texture);
        }

        static string DescribeRenderers(GameObject root) {
            var text = new StringBuilder();
            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer) continue;
                if (text.Length > 0) text.Append(", ");
                text.Append('\'').Append(renderer.transform != null ? renderer.transform.name : "?").Append("'(");
                var materials = renderer.sharedMaterials;
                for (int i = 0; i < materials.Length; i++) {
                    if (i > 0) text.Append('+');
                    text.Append(materials[i] != null ? materials[i].name : "null");
                }
                text.Append(')');
            }
            return text.Length > 0 ? text.ToString() : "no mesh renderers";
        }

        /* ------------------------------------------------------------ locale */

        /// <summary>
        /// Adopt the shell's print locale. A change re-keys and repaints every bound plate:
        /// locale is part of the plate identity, so a switched language can never keep the
        /// previous session's pixels (the source painters set their fallback words — and the
        /// exit fascia's `printed_*` copy — in the active language).
        /// </summary>
        public static void ApplyLocale(string locale) {
            var next = string.IsNullOrEmpty(locale) ? "zh-CN" : locale;
            Locale = next;
            // Every live world is repainted, not only the newest: a staged candidate keeps
            // its own cache, and a locale notice that lands during a build must reach both.
            for (int i = 0; i < liveScopes.Count; i++) {
                var scope = liveScopes[i];
                if (scope == null || scope.Cache == null) continue;
                foreach (var binding in scope.Cache.Bindings) {
                    if (binding.Facts != null) binding.Facts.Locale = next;
                }
                scope.Cache.Repaint();
            }
        }

        static readonly List<StationExitArtworkScope> liveScopes = new List<StationExitArtworkScope>();

        /// <summary>Free one world's cache, textures, materials and quads. Idempotent.</summary>
        internal static void ReleaseScope(StationExitArtworkScope released) {
            if (released == null) return;
            liveScopes.Remove(released);
            Detach(released);
            if (released.Cache != null) {
                released.Cache.Dispose();
                released.Cache = null;
            }
            for (int i = 0; i < released.Bindings.Count; i++) {
                var binding = released.Bindings[i];
                if (binding == null) continue;
                if (binding.Quad != null) SafeDestroy(binding.Quad);
                if (binding.Material != null) SafeDestroy(binding.Material);
                if (binding.RuntimeMesh != null) SafeDestroy(binding.RuntimeMesh);
                binding.Quad = null;
                binding.Material = null;
                binding.RuntimeMesh = null;
            }
            released.Bindings.Clear();
            released.Provider = null;
        }

        static void SafeDestroy(UnityEngine.Object value) {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }

        /// <summary>Create the per-world provider/cache on the street role root.</summary>
        public static StationExitArtworkScope CreateScope(Transform parent) {
            if (parent == null) return null;
            var scope = parent.gameObject.AddComponent<StationExitArtworkScope>();
            StationGameHost host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            scope.Provider = new ExitFaceWebProvider(Send, () => {
                var current = host != null ? host : UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
                return new ExitFaceContext {
                    SessionId = current != null ? current.ClientSessionId : "",
                    Revision = current != null ? current.CurrentRevision : -1,
                };
            });
            scope.Cache = new ExitFaceTextureCache(scope.Provider);
            if (host != null) {
                // The lambda re-checks the host: a destroyed player must not throw from a
                // late retry (Unity's overloaded null handles a destroyed object).
                scope.Publish = json => host != null && host.PublishOutbound(json);
                host.RegisterStateContributor(State);
            }
            var pump = parent.gameObject.AddComponent<ExitFacePump>();
            pump.Cache = scope.Cache;
            liveScopes.Add(scope);
            Attach(scope);
            return scope;
        }
    }

    /// <summary>
    /// `state.exit.faces`: which street plates this world bound, whether they show painted
    /// pixels, their ink and their content fingerprints. The observable half of plan 16
    /// §5.3 — a browser check asserts that exit C and guidepost 399 really printed, not
    /// merely that a request was sent.
    /// </summary>
    public sealed class ExitFaceArtworkState : IStationStateContributor {
        public string Key => "exit";

        public JObject BuildPayload(StationDocument document, StationIndex index) {
            var cache = StationExitArtwork.Cache;
            return new JObject { ["faces"] = cache != null ? cache.Report() : ExitFaceTextureCache.EmptyReport() };
        }
    }

    /// <summary>
    /// The `exit.*` command handler: the painter's replies (`exit.faceChunk`,
    /// `exit.faceReady`) and the shell's `exit.locale` notice. Neither edits the
    /// document — a painted plate is an acknowledgement, not a commit.
    /// </summary>
    public sealed class StationExitArtworkCommandHandler : IStationCommandHandler {
        public string Capability => "exit";

        public bool Handles(string type) =>
            type == "exit.faceChunk" || type == "exit.faceReady" || type == "exit.locale";

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = null;
            rejectReason = null;
            if (command == null) return true;
            if (command.Type == "exit.locale") {
                var locale = payload != null && payload["locale"] != null ? (string)payload["locale"] : "";
                StationExitArtwork.ApplyLocale(locale);
                // 20 §1: the printed displays follow the shell's language too — a television's
                // board and a line map's caption must not stay in the previous one.
                Metro.App.Views.StationDisplayTvArtwork.ApplyLocale(locale);
                Metro.App.Views.StationLineMapArtwork.ResetLocale();
                return true;
            }
            StationExitArtwork.Receive(command.Raw);
            StationExitArtwork.Pump();
            return true;
        }
    }

    /// <summary>
    /// The packet's registration: the host snapshots the command registry at `Awake`, so
    /// adding this family never edits the host (plan 11's zero-wiring contract).
    /// </summary>
    public static class StationExitArtworkPacket {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() {
            StationCommandHandlers.Add(new StationExitArtworkCommandHandler());
        }
    }
}
