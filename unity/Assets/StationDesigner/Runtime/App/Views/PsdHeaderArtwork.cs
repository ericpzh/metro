using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App {
    /* ------------------------------------------------------------------ the request */

    /// <summary>
    /// One printed PSD header panel the browser should paint (RCA 15 §5 sub-item 2).
    ///
    /// The pixels are a function of the **painted** data only: the `psdHeaderInfo` fields,
    /// the panel kind, the canvas width (`1024` for one panel, `2048` for the paired
    /// half-height sticker) and the fixed `PSD_HEADER_PIXELS` height. <see cref="Width"/>
    /// and <see cref="Height"/> are the printed plane in source metres — the quad's size,
    /// not the picture — and <see cref="Key"/> is `OpeningModuleViews.PsdHeaderKey`: the
    /// painted-data identity that lets two slots share one texture.
    /// </summary>
    public sealed class PsdHeaderPanel {
        /// <summary>`PsdHeader.ts:PSD_HEADER_PIXELS`: every header canvas is 256 px tall.</summary>
        public const int PixelHeight = 256;

        public string Key = "";
        /// <summary>The PSD run that minted this panel, for diagnostics.</summary>
        public string ModuleId = "";
        /// <summary>Every run whose slots print this key (one key can serve several runs).</summary>
        public readonly List<string> ModuleIds = new List<string>();
        public PsdHeaderKind Kind;
        /// <summary>Canvas width: 1024 (route/station) or 2048 (the paired half sticker).</summary>
        public int Pixels = 1024;
        /// <summary>The printed plane in source metres (`slot.Width`).</summary>
        public float Width = 1f;
        /// <summary>The printed plane in source metres (`slot.Height`).</summary>
        public float Height = 1f;
        /// <summary>How many slots share this panel's pixels.</summary>
        public int SlotCount;
        public PsdHeaderPlan Plan;

        public string KindName => PsdHeaderVocabulary.Kind(Kind);

        public override string ToString() =>
            KindName + " " + ModuleId + " " + Pixels + "x" + PixelHeight + " w=" +
            Width.ToString("0.###", CultureInfo.InvariantCulture) + "m slots=" + SlotCount;
    }

    /// <summary>The panels of one `psd.requestHeader`, already bounded to the cache's batch size.</summary>
    public sealed class PsdHeaderBatch {
        public string RequestId = "";
        public PsdHeaderPanel[] Panels = Array.Empty<PsdHeaderPanel>();
    }

    /// <summary>Who is asking: the session and revision the reply must still belong to.</summary>
    public sealed class PsdHeaderContext {
        public string SessionId = "";
        public int Revision = -1;
    }

    /// <summary>One panel whose PNG arrived in full.</summary>
    public sealed class PsdHeaderPaintedPanel {
        public string Key = "";
        public string ModuleId = "";
        public PsdHeaderKind Kind;
        public int Width;
        public int Height;
        /// <summary>Fraction of non-paper pixels the browser painted (`-1` when unmeasured).</summary>
        public float Ink = -1f;
        public byte[] Png = Array.Empty<byte>();
    }

    /// <summary>One panel the painter could not mint yet (a font that has not landed).</summary>
    public sealed class PsdHeaderPendingPanel {
        public string Key = "";
        public string ModuleId = "";
        public PsdHeaderKind Kind;
        /// <summary>`font`, `unsupported` or `empty`.</summary>
        public string Reason = "";
        public string Detail = "";
    }

    /// <summary>One completed `psd.requestHeader` reply, with its assembled PNGs.</summary>
    public sealed class PsdHeaderResponse {
        public string RequestId = "";
        public int Revision = -1;
        public string SessionId = "";
        public bool ArtReady;
        public PsdHeaderPaintedPanel[] Painted = Array.Empty<PsdHeaderPaintedPanel>();
        public PsdHeaderPendingPanel[] Pending = Array.Empty<PsdHeaderPendingPanel>();
    }

    public static class PsdHeaderVocabulary {
        /// <summary>The source's `drawPsdHeader` kinds, plus the paired sticker.</summary>
        public static string Kind(PsdHeaderKind kind) {
            switch (kind) {
                case PsdHeaderKind.Route: return "route";
                case PsdHeaderKind.Station: return "station";
                default: return "sticker";
            }
        }

        public static PsdHeaderKind ParseKind(string value) {
            switch (value ?? "") {
                case "station": return PsdHeaderKind.Station;
                case "sticker": return PsdHeaderKind.HalfSticker;
                default: return PsdHeaderKind.Route;
            }
        }
    }

    /* ------------------------------------------------------------------ provider */

    /// <summary>
    /// How the painter is reached. The Web build ships the request over the plan-11
    /// bridge; an EditMode test injects its own provider and feeds deterministic PNG
    /// fixtures painted by the same `drawPsdHeader`.
    ///
    /// A **distinct kind** (`psdHeaderRequest` / `psd.requestHeader`, replies
    /// `psd.headerChunk` / `psd.headerReady`) is used instead of a discriminant on the
    /// sign face request: the sign path is verified end-to-end, and reusing its
    /// envelope would put a second board shape in front of `signFaceProvider`'s
    /// readiness rules (pictograms, component normalization) that a PSD header does not
    /// have. Two small contracts keep each painter's failure modes diagnosable; the
    /// v2 envelope, the chunked base64 transport and the session/revision fence are
    /// shared byte for byte.
    /// </summary>
    public interface IPsdHeaderProvider : IDisposable {
        /// <summary>Send one batch (already bounded to `PsdHeaderTextureCache.MaxRequestPanels`).</summary>
        void Request(PsdHeaderBatch batch);
        /// <summary>Take one completed reply, if any. Never blocks.</summary>
        bool TryTake(out PsdHeaderResponse response);
        void Cancel(string requestId);
    }

    /// <summary>
    /// The bridge provider: `psd.requestHeader` out, `psd.headerChunk` /
    /// `psd.headerReady` in, with the same chunking and stale-revision fence as
    /// <see cref="StationSignWebProvider"/> (RCA 15 §5). Bytes never travel in a
    /// `commit` document, and a reply that names another session or an older revision
    /// is dropped rather than painted onto the current station.
    /// </summary>
    public sealed class PsdHeaderWebProvider : IPsdHeaderProvider {
        /// <summary>Largest base64 slice accepted in one `psd.headerChunk` (the sender uses 48 KiB).</summary>
        public const int MaxChunkCharacters = 64 * 1024;
        /// <summary>Largest assembled PNG accepted for one panel, bytes.</summary>
        public const int MaxPngBytes = 16 * 1024 * 1024;

        sealed class Assembly {
            public string Key = "";
            public PsdHeaderKind Kind;
            public int Width;
            public int Height;
            public int Count;
            public string ModuleId = "";
            public float Ink = -1f;
            public readonly Dictionary<int, string> Parts = new Dictionary<int, string>();
        }

        readonly Func<string, bool> send;
        readonly Func<PsdHeaderContext> context;
        readonly Dictionary<string, int> requestRevisions = new Dictionary<string, int>(StringComparer.Ordinal);
        readonly Dictionary<string, Dictionary<string, Assembly>> assemblies =
            new Dictionary<string, Dictionary<string, Assembly>>(StringComparer.Ordinal);
        readonly Queue<PsdHeaderResponse> completed = new Queue<PsdHeaderResponse>();
        bool disposed;

        public PsdHeaderWebProvider(Func<string, bool> send, Func<PsdHeaderContext> context) {
            this.send = send ?? throw new ArgumentNullException(nameof(send));
            this.context = context ?? (() => new PsdHeaderContext());
        }

        /// <summary>How many requests are waiting for their `psd.headerReady`.</summary>
        public int OpenRequests => requestRevisions.Count;

        /// <summary>Batches this world could not publish (no transport); each stays retryable.</summary>
        public int DroppedRequests { get; private set; }
        /// <summary>The last publication failure, for the header status report.</summary>
        public string LastPublishError { get; private set; } = "";

        public void Request(PsdHeaderBatch batch) {
            if (disposed || batch == null || batch.Panels == null || batch.Panels.Length == 0) return;
            var current = context() ?? new PsdHeaderContext();
            requestRevisions[batch.RequestId] = current.Revision;
            assemblies[batch.RequestId] = new Dictionary<string, Assembly>(StringComparer.Ordinal);

            var panels = new JArray();
            foreach (var panel in batch.Panels) panels.Add(PanelJson(panel));
            var payload = new JObject {
                ["requestId"] = batch.RequestId,
                ["revision"] = current.Revision,
                ["sessionId"] = current.SessionId ?? "",
                ["panels"] = panels,
            };
            var envelope = new JObject {
                ["schemaVersion"] = 2,
                ["kind"] = "psdHeaderRequest",
                ["type"] = "psd.requestHeader",
                ["id"] = batch.RequestId,
                ["sessionId"] = current.SessionId ?? "",
                ["revision"] = current.Revision,
                ["payload"] = payload,
            };
            if (!send(envelope.ToString(Formatting.None))) {
                // No route this frame (the desktop presenter is not attached yet, or a
                // build without the glue). Leave the panels in the cache's `wanted` set:
                // `Pump` re-asks after the retry window, so a late painter heals instead
                // of wedging, and the view keeps naming the missing transport meanwhile.
                DroppedRequests++;
                LastPublishError = "publish-unavailable";
                Cancel(batch.RequestId);
            } else {
                LastPublishError = "";
            }
        }

        static JObject PanelJson(PsdHeaderPanel panel) {
            var plan = panel.Plan;
            var ids = new JArray();
            foreach (var id in panel.ModuleIds ?? new List<string>()) ids.Add(id ?? "");
            return new JObject {
                ["key"] = panel.Key ?? "",
                ["moduleId"] = panel.ModuleId ?? "",
                ["moduleIds"] = ids,
                ["kind"] = panel.KindName,
                ["pixels"] = panel.Pixels,
                ["width"] = panel.Width,
                ["height"] = panel.Height,
                ["slots"] = panel.SlotCount,
                // Only what `drawPsdHeader` prints: the resolved line/station facts.
                ["lineId"] = plan.LineId ?? "",
                ["colour"] = plan.Colour ?? "",
                ["direction"] = plan.Direction ?? "up",
                ["stationName"] = plan.StationName ?? "",
                ["stationNameEn"] = plan.StationNameEn ?? "",
                ["destination"] = plan.Destination ?? "",
                ["destinationEn"] = plan.DestinationEn ?? "",
                ["adjacent"] = plan.Adjacent ?? "",
                ["adjacentEn"] = plan.AdjacentEn ?? "",
                ["terminal"] = plan.Terminal,
                ["arrow"] = plan.Arrow,
                ["directionFallback"] = plan.DirectionFallback,
            };
        }

        /* -------------------------------------------------------------- replies */

        /// <summary>Route one C# → JS command here: `psd.headerChunk` or `psd.headerReady`.</summary>
        public bool Receive(string json) {
            if (disposed || string.IsNullOrEmpty(json)) return false;
            JObject message;
            try { message = JObject.Parse(json); } catch { return false; }
            var type = (string)message["type"] ?? "";
            if (type != "psd.headerChunk" && type != "psd.headerReady") return false;
            var payload = message["payload"] as JObject;
            if (payload == null) return true;
            // The reply's own payload names the request; the envelope's id is the command
            // id the shell minted for this chunk, which is not the request id.
            var requestId = String(payload, "requestId");
            if (requestId.Length == 0) return true;
            if (!requestRevisions.TryGetValue(requestId, out var sentRevision)) return true;
            // Fence: a reply from another session, or for a revision this station has
            // already moved past, is a picture of a station that no longer exists.
            var current = context() ?? new PsdHeaderContext();
            var sessionId = String(payload, "sessionId");
            if (sessionId.Length > 0 && current.SessionId.Length > 0 && sessionId != current.SessionId) {
                Cancel(requestId);
                return true;
            }
            var revision = Int(payload, "revision", -1);
            if (revision >= 0 && revision < sentRevision) { Cancel(requestId); return true; }
            if (type == "psd.headerChunk") Chunk(requestId, payload);
            else Ready(requestId, payload);
            return true;
        }

        void Chunk(string requestId, JObject payload) {
            if (!assemblies.TryGetValue(requestId, out var panels)) return;
            var key = String(payload, "key");
            if (key.Length == 0) return;
            var index = Int(payload, "index", -1);
            var count = Int(payload, "count", 0);
            var data = String(payload, "data");
            if (index < 0 || count <= 0 || index >= count || data.Length == 0 || data.Length > MaxChunkCharacters) return;
            if (!panels.TryGetValue(key, out var assembly)) {
                assembly = new Assembly {
                    Key = key,
                    Kind = PsdHeaderVocabulary.ParseKind(String(payload, "kind")),
                    Width = Int(payload, "width", 0),
                    Height = Int(payload, "height", 0),
                    Count = count,
                    ModuleId = String(payload, "moduleId"),
                };
                panels[key] = assembly;
            }
            if (assembly.Count != count || assembly.Width != Int(payload, "width", 0) ||
                assembly.Height != Int(payload, "height", 0)) return;
            if (assembly.Parts.ContainsKey(index)) return;
            assembly.Parts[index] = data;
        }

        void Ready(string requestId, JObject payload) {
            var assembled = assemblies.TryGetValue(requestId, out var panels) ? panels : null;
            var painted = new List<PsdHeaderPaintedPanel>();
            var pending = new List<PsdHeaderPendingPanel>();
            if (payload["painted"] is JArray paintedJson) {
                foreach (var token in paintedJson) {
                    if (!(token is JObject panelJson)) continue;
                    var key = String(panelJson, "key");
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
                    var declaredBytes = Int(panelJson, "bytes", -1);
                    if (declaredBytes >= 0 && declaredBytes != png.Length) continue;
                    var width = Int(panelJson, "width", assembly.Width);
                    var height = Int(panelJson, "height", assembly.Height);
                    if (width != assembly.Width || height != assembly.Height) continue;
                    painted.Add(new PsdHeaderPaintedPanel {
                        Key = key, ModuleId = assembly.ModuleId, Kind = assembly.Kind,
                        Width = width, Height = height, Ink = Float(panelJson, "ink", -1f), Png = png,
                    });
                }
            }
            if (payload["pending"] is JArray pendingJson) {
                foreach (var token in pendingJson) {
                    if (!(token is JObject panelJson)) continue;
                    var key = String(panelJson, "key");
                    if (key.Length == 0) continue;
                    pending.Add(new PsdHeaderPendingPanel {
                        Key = key,
                        ModuleId = String(panelJson, "moduleId"),
                        Kind = PsdHeaderVocabulary.ParseKind(String(panelJson, "kind")),
                        Reason = String(panelJson, "reason"),
                        Detail = String(panelJson, "detail"),
                    });
                }
            }
            completed.Enqueue(new PsdHeaderResponse {
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

        public bool TryTake(out PsdHeaderResponse response) {
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
    /// The printed panels of the station's PSD runs, by painted data.
    ///
    /// A panel is a function of `psdHeaderInfo`'s resolved facts, the panel kind and the
    /// canvas width — so every route panel of a run shares one texture, every station
    /// panel shares another, and a line-colour or station-name edit becomes a different
    /// <see cref="PsdHeaderPanel.Key"/> rather than a stale picture. The cache owns one
    /// bounded request at a time, the PNG upload, the printed quad on each slot's posed
    /// node, the retry of panels the painter reported not-ready, and the release of
    /// replaced textures.
    ///
    /// It never paints: `PsdHeader.ts` is the one painter, reached through
    /// <see cref="IPsdHeaderProvider"/>, which the Web build backs with the bridge and an
    /// EditMode test backs with the same painter's PNG fixtures.
    /// </summary>
    public sealed class PsdHeaderTextureCache : IDisposable {
        /// <summary>Panels one `psd.requestHeader` may carry, so one message stays small.</summary>
        public const int MaxRequestPanels = 32;
        /// <summary>How long a panel reported not-ready waits before it is asked for again.</summary>
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
            public PsdHeaderKind Kind;
            public string ModuleId = "";
            public string Direction = "";
            public string Colour = "";
            public string LineId = "";
            public string Destination = "";
        }

        readonly IPsdHeaderProvider provider;
        readonly Material template;
        readonly Dictionary<string, Entry> entries = new Dictionary<string, Entry>(StringComparer.Ordinal);
        readonly Dictionary<string, List<PsdHeaderSlotBinding>> subscribers =
            new Dictionary<string, List<PsdHeaderSlotBinding>>(StringComparer.Ordinal);
        readonly Dictionary<string, PsdHeaderPanel> wanted = new Dictionary<string, PsdHeaderPanel>(StringComparer.Ordinal);
        readonly Dictionary<string, float> askedAt = new Dictionary<string, float>(StringComparer.Ordinal);
        readonly Dictionary<string, int> attempts = new Dictionary<string, int>(StringComparer.Ordinal);
        int counter;
        int unresolved;
        bool disposed;

        public PsdHeaderTextureCache(IPsdHeaderProvider provider, Material template) {
            this.provider = provider ?? throw new ArgumentNullException(nameof(provider));
            this.template = template;
        }

        /// <summary>The material a printed quad is cloned from (the run's own white fascia).</summary>
        public Material TemplateMaterial => template;

        /// <summary>Slots this cache bound (a slot without a printed quad is counted unresolved).</summary>
        public int SlotCount { get; private set; }
        /// <summary>Slots whose printed quad already shows painted pixels.</summary>
        public int ServedCount { get; private set; }
        /// <summary>Textures currently held (one per painted key).</summary>
        public int TextureCount => entries.Count;
        /// <summary>Unique panels waiting for pixels (queued, asked for, or reported not-ready).</summary>
        public int PendingCount => wanted.Count;
        /// <summary>Slots the cache could not bind (no node/material) or the painter refused.</summary>
        public int UnportedCount => unresolved;
        /// <summary>The least-inked served panel's non-paper fraction; 0 when nothing is served.</summary>
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

        /* ------------------------------------------------------------- binding */

        /// <summary>
        /// Bind one minted slot: create its printed quad at the slot's posed node (sized to
        /// the printed plane) and queue the pixels its key names. A slot with no node, no
        /// key or no material is counted unported and its view keeps a named diagnostic.
        /// </summary>
        public PsdHeaderSlotBinding Bind(OpeningView view, in PsdHeaderSlot slot) {
            if (disposed || view == null || string.IsNullOrEmpty(slot.Key) || slot.Node == null) {
                unresolved++;
                return null;
            }
            if (template == null) {
                unresolved++;
                return null;
            }
            var binding = new PsdHeaderSlotBinding(this, view, slot);
            CreateQuad(binding);
            if (binding.Quad == null) {
                unresolved++;
                return null;
            }
            SlotCount++;
            Subscribers(binding.Key).Add(binding);
            if (entries.TryGetValue(binding.Key, out var entry) && entry.Texture != null) {
                entry.Refs++;
                entry.LastUsed = Time.realtimeSinceStartup;
                binding.Apply(entry.Texture, entry.Fingerprint);
                ServedCount++;
            } else {
                Want(view, slot);
            }
            UpdateDiagnostic(view);
            return binding;
        }

        static void CreateQuad(PsdHeaderSlotBinding binding) {
            var node = binding.Node;
            var quad = new GameObject("psd-header-print");
            quad.transform.SetParent(node, false);
            // The slot node's forward is the printed face normal, already turned toward the
            // platform (`EmitHeaderSlots`). The quad's readable side is its own +z, so an
            // identity local rotation puts the text on the platform side and backface
            // culling removes it from the track (RCA 15 §5).
            quad.transform.localRotation = Quaternion.identity;
            quad.transform.localPosition = Vector3.zero;
            quad.transform.localScale = new Vector3(binding.Width, binding.Height, 1f);
            quad.AddComponent<MeshFilter>().sharedMesh = QuadMesh();
            var material = new Material(binding.MaterialTemplate) {
                name = "psd header " + Short(binding.Key),
            };
            var renderer = quad.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            binding.Quad = quad;
            binding.Renderer = renderer;
            binding.Material = material;
            // Unpainted: the housing behind the band stays visible rather than a white sheet.
            ApplyArtwork(material, null);
        }

        void Want(OpeningView view, in PsdHeaderSlot slot) => Want(slot.Key, view, slot);

        void Want(string key, OpeningView view, in PsdHeaderSlot slot) {
            if (wanted.TryGetValue(key, out var existing)) {
                existing.SlotCount++;
                var id = view != null ? view.ModuleId : "";
                if (id.Length > 0 && !existing.ModuleIds.Contains(id)) existing.ModuleIds.Add(id);
                return;
            }
            var panel = PanelFor(view, slot);
            panel.Key = key;
            wanted[key] = panel;
        }

        /// <summary>The request record for one slot: its painted plan and its printed plane.</summary>
        public static PsdHeaderPanel PanelFor(OpeningView view, in PsdHeaderSlot slot) {
            var panel = new PsdHeaderPanel {
                Key = slot.Key,
                ModuleId = view != null ? view.ModuleId : "",
                Kind = slot.Kind,
                Pixels = slot.Pixels,
                Width = slot.Width,
                Height = slot.Height,
                SlotCount = 1,
                Plan = view != null ? view.Header : default,
            };
            if (panel.ModuleId.Length > 0) panel.ModuleIds.Add(panel.ModuleId);
            return panel;
        }

        List<PsdHeaderSlotBinding> Subscribers(string key) {
            if (!subscribers.TryGetValue(key, out var list)) subscribers[key] = list = new List<PsdHeaderSlotBinding>(4);
            return list;
        }

        /// <summary>
        /// A view's painted plan changed in place: re-key every slot of the view. A rebuild
        /// after a line edit reaches the same place through a fresh world/cache; this is the
        /// in-place path (and what the `HeaderKey` invalidation pin exercises).
        /// </summary>
        public int RefreshHeaderKeys(OpeningView view) {
            if (disposed || view == null) return 0;
            int changed = 0;
            var oldKeys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var binding in BindingsOf(view)) {
                var next = OpeningModuleViews.PsdHeaderKey(view.Header, binding.Kind);
                if (next == binding.Key) continue;
                oldKeys.Add(binding.Key);
                Unsubscribe(binding);
                binding.Key = next;
                if (entries.TryGetValue(next, out var entry) && entry.Texture != null) {
                    entry.Refs++;
                    entry.LastUsed = Time.realtimeSinceStartup;
                    if (!binding.HasTexture) ServedCount++;
                    binding.Apply(entry.Texture, entry.Fingerprint);
                } else {
                    if (binding.HasTexture) ServedCount--;
                    binding.Clear();
                    Want(next, view, binding.Slot);
                }
                Subscribers(next).Add(binding);
                changed++;
            }
            // A key this view alone printed is now stale: free its pixels rather than
            // letting a superseded panel linger in the cache (a line recolour must not
            // keep the old ink alive next to the new request).
            foreach (var key in oldKeys) if (!subscribers.ContainsKey(key)) InvalidateKey(key);
            foreach (var binding in BindingsOf(view)) UpdateDiagnostic(view);
            return changed;
        }

        List<PsdHeaderSlotBinding> BindingsOf(OpeningView view) {
            var list = new List<PsdHeaderSlotBinding>();
            foreach (var pair in subscribers) {
                foreach (var binding in pair.Value) if (binding.View == view) list.Add(binding);
            }
            return list;
        }

        /* ------------------------------------------------------------ requests */

        /// <summary>
        /// Drain replies, upload what arrived and ask for anything still missing. A panel is
        /// re-asked only after <see cref="RetrySeconds"/> (then with a bounded backoff), so a
        /// reply in flight is not duplicated and a reply that never came is retried rather
        /// than wedging the station's printed band.
        /// </summary>
        public void Pump() {
            if (disposed) return;
            while (provider.TryTake(out var response)) Apply(response);
            if (wanted.Count == 0) return;
            float now = Time.realtimeSinceStartup;
            var keys = new List<string>(Math.Min(MaxRequestPanels, wanted.Count));
            foreach (var key in wanted.Keys) {
                if (!ReadyToAsk(key, now)) continue;
                keys.Add(key);
                if (keys.Count >= MaxRequestPanels) break;
            }
            if (keys.Count == 0) return;
            var batch = new PsdHeaderBatch {
                RequestId = "psd-req-" + (++counter),
                Panels = new PsdHeaderPanel[keys.Count],
            };
            for (int i = 0; i < keys.Count; i++) {
                batch.Panels[i] = wanted[keys[i]];
                askedAt[keys[i]] = now;
                attempts.TryGetValue(keys[i], out var attempt);
                attempts[keys[i]] = attempt + 1;
            }
            provider.Request(batch);
        }

        /// <summary>True when a missing panel may be asked for again (1→2→4→…→64 s).</summary>
        bool ReadyToAsk(string key, float now) {
            if (!askedAt.TryGetValue(key, out var asked)) return true;
            attempts.TryGetValue(key, out var attempt);
            float delay = RetrySeconds * Mathf.Pow(2f, Mathf.Clamp(attempt - 1, 0, 6));
            return now - asked >= delay;
        }

        /// <summary>Ask for the pending panels now instead of after `RetrySeconds`.</summary>
        public void RetryNow() {
            askedAt.Clear();
            attempts.Clear();
        }

        void Forget(string key) {
            askedAt.Remove(key);
            attempts.Remove(key);
        }

        void Apply(PsdHeaderResponse response) {
            if (response == null) return;
            foreach (var painted in response.Painted ?? Array.Empty<PsdHeaderPaintedPanel>()) {
                if (painted == null || painted.Png == null || painted.Png.Length == 0) continue;
                if (!wanted.TryGetValue(painted.Key, out var panel)) continue;   // stale: no one wants it
                if (painted.Width != panel.Pixels || painted.Height != PsdHeaderPanel.PixelHeight) continue;
                if (entries.ContainsKey(painted.Key)) continue;                 // already painted by another batch
                var texture = Decode(painted.Png, painted.Width, painted.Height, "psd header " + Short(painted.Key));
                if (texture == null) continue;
                var entry = new Entry {
                    Key = painted.Key,
                    Texture = texture,
                    Fingerprint = Short(painted.Key) + "@" + painted.Width + "x" + painted.Height,
                    Ink = painted.Ink >= 0f ? painted.Ink : InkFraction(texture),
                    Width = painted.Width,
                    Height = painted.Height,
                    Bytes = painted.Png.Length,
                    Kind = panel.Kind,
                    ModuleId = panel.ModuleId,
                    Direction = panel.Plan.Direction ?? "",
                    Colour = panel.Plan.Colour ?? "",
                    LineId = panel.Plan.LineId ?? "",
                    Destination = panel.Plan.Destination ?? "",
                    LastUsed = Time.realtimeSinceStartup,
                };
                entries[painted.Key] = entry;
                wanted.Remove(painted.Key);
                Forget(painted.Key);
                if (!subscribers.TryGetValue(painted.Key, out var list)) continue;
                foreach (var binding in list.ToArray()) {
                    bool first = !binding.HasTexture;
                    entry.Refs++;
                    entry.LastUsed = Time.realtimeSinceStartup;
                    binding.Apply(entry.Texture, entry.Fingerprint);
                    if (first) ServedCount++;
                }
                UpdateViews(list);
            }
            foreach (var pending in response.Pending ?? Array.Empty<PsdHeaderPendingPanel>()) {
                if (pending == null) continue;
                if (!wanted.ContainsKey(pending.Key)) continue;
                // A failed or empty panel is final; a font that has not landed yet keeps its
                // place in the queue for the retry window, exactly like the sign painter.
                if (pending.Reason == "empty" || pending.Reason == "unsupported") {
                    wanted.Remove(pending.Key);
                    Forget(pending.Key);
                    if (subscribers.TryGetValue(pending.Key, out var list)) {
                        unresolved += list.Count;
                        UpdateViews(list, "psd-header-artwork-unported:paint-" + pending.Reason);
                    }
                }
            }
        }

        void UpdateViews(List<PsdHeaderSlotBinding> bindings, string unported = null) {
            var views = new HashSet<OpeningView>();
            foreach (var binding in bindings) if (binding.View != null) views.Add(binding.View);
            foreach (var view in views) {
                UpdateDiagnostic(view, unported);
                // A provider with no route keeps the slot retryable: the view names the
                // transport rather than claiming pixels that never arrived.
                if (unported == null && ServedFor(view) == 0 && wanted.Count > 0 && TransportMissing) {
                    UpdateDiagnostic(view, "psd-header-artwork-unported:no-transport");
                }
            }
        }

        internal bool TransportMissing {
            get {
                var web = provider as PsdHeaderWebProvider;
                // The *last* publication is what matters: a route that healed must stop
                // being reported as missing even though an earlier attempt was dropped.
                return web != null && web.OpenRequests == 0 && web.LastPublishError == "publish-unavailable";
            }
        }

        int ServedFor(OpeningView view) {
            int served = 0;
            foreach (var pair in subscribers) {
                foreach (var binding in pair.Value) {
                    if (binding.View == view && binding.HasTexture) served++;
                }
            }
            return served;
        }

        /// <summary>Rewrite one view's `psd-header-artwork…` diagnostic to the current truth.</summary>
        internal void UpdateDiagnostic(OpeningView view, string unported = null) {
            if (view == null) return;
            int total = view.Headers != null ? view.Headers.Count : 0;
            if (total == 0) return;
            if (!string.IsNullOrEmpty(unported)) {
                OpeningModuleViews.SetHeaderArtwork(view, unported + "(" + total + " slot(s))");
                return;
            }
            int served = ServedFor(view);
            int pending = 0;
            foreach (var pair in subscribers) {
                foreach (var binding in pair.Value) {
                    if (binding.View == view && !binding.HasTexture) pending++;
                }
            }
            if (pending > 0 && TransportMissing) {
                OpeningModuleViews.SetHeaderArtwork(view, "psd-header-artwork-unported:no-transport(" + total + " slot(s))");
                return;
            }
            OpeningModuleViews.SetHeaderArtwork(view, served >= total
                ? "psd-header-artwork:served:" + total
                : "psd-header-artwork:pending:" + served + "/" + total);
        }

        /* --------------------------------------------------------- invalidation */

        /// <summary>Retire one panel's pixels (a line edit renames or recolours it).</summary>
        public void InvalidateKey(string key) {
            if (disposed || string.IsNullOrEmpty(key)) return;
            wanted.Remove(key);
            Forget(key);
            if (!entries.TryGetValue(key, out var entry)) return;
            entries.Remove(key);
            DestroyTexture(entry.Texture);
            if (subscribers.TryGetValue(key, out var list)) UpdateViews(list);
        }

        /// <summary>A different station: no texture of the old one may survive.</summary>
        public void InvalidateAll() {
            foreach (var entry in entries.Values) DestroyTexture(entry.Texture);
            entries.Clear();
            wanted.Clear();
            askedAt.Clear();
            attempts.Clear();
            ServedCount = 0;
            foreach (var list in subscribers.Values) foreach (var binding in list) binding.Clear();
        }

        void Unsubscribe(PsdHeaderSlotBinding binding) {
            if (binding == null || string.IsNullOrEmpty(binding.Key)) return;
            if (!subscribers.TryGetValue(binding.Key, out var list)) return;
            list.Remove(binding);
            if (list.Count == 0) {
                subscribers.Remove(binding.Key);
                if (!entries.ContainsKey(binding.Key)) {
                    wanted.Remove(binding.Key);
                    Forget(binding.Key);
                }
            }
            if (entries.TryGetValue(binding.Key, out var entry) && entry.Refs > 0) entry.Refs--;
        }

        /// <summary>Let one binding go: stop asking for its panel and clear its quad.</summary>
        internal void Release(PsdHeaderSlotBinding binding) {
            if (binding == null) return;
            Unsubscribe(binding);
            binding.Clear();
        }

        /* -------------------------------------------------------------- pixels */

        /// <summary>
        /// A cheap "did the painter actually draw" measure over the decoded texture: the
        /// fraction of pixels that differ from the paper colour. The shipping painter
        /// reports its own number from the canvas it just painted; a reply that omits it
        /// (an EditMode fixture) is re-derived here from the pixels Unity uploaded, so a
        /// blank or all-white band can never pass as served artwork.
        /// </summary>
        static float InkFraction(Texture2D texture) {
            if (texture == null) return 0f;
            try {
                var pixels = texture.GetPixels32();
                if (pixels == null || pixels.Length == 0) return 0f;
                // `drawPsdHeader` always grounds the panel on this paper (`#f4f6f8`); the
                // bottom-left pixel is the colour bar, so it cannot be the reference.
                const byte paperR = 244, paperG = 246, paperB = 248;
                int ink = 0;
                for (int i = 0; i < pixels.Length; i++) {
                    var pixel = pixels[i];
                    if (pixel.r != paperR || pixel.g != paperG || pixel.b != paperB) ink++;
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

        /// <summary>
        /// A unit sheet in local XY whose readable face is +z, with **U increasing toward
        /// local −x**.
        ///
        /// The platform-facing node is turned by `LookRotation(±z)` (`EmitHeaderSlots`), so
        /// the local +x of the quad maps to the run's own +x on a left bank and to its −x
        /// on a right bank. Under a player camera the screen-right of a platform viewer is
        /// the run's −x on a left bank and its +x on a right bank, i.e. always the quad's
        /// local −x. The source's `plate(..., platYaw)` gets there by turning the plane end
        /// for end (`platYaw = π`) rather than by flipping U, and its printed face must read
        /// left-to-right from the platform. Mapping U to local −x reproduces that for both
        /// banks with one rule (`PsdHeader.ts:psdHeaderInfo`'s "the platform-facing plane
        /// reverses its local x on the left bank" is the same statement). Mapping U to +x
        /// mirrored the print on every run (`unity/plan/16` §3.1).
        /// </summary>
        static Mesh QuadMesh() {
            if (quadMesh != null) return quadMesh;
            var mesh = new Mesh { name = "psd header quad" };
            // Corners are clockwise as seen from the readable side; triangles {0,1,2, 0,2,3},
            // so cross(v1−v0, v2−v0) = +z — the same rule the sign face quad uses.
            mesh.vertices = new[] {
                new Vector3(-.5f, -.5f, 0f), new Vector3(.5f, -.5f, 0f),
                new Vector3(.5f, .5f, 0f), new Vector3(-.5f, .5f, 0f),
            };
            mesh.uv = new[] {
                new Vector2(1f, 0f), new Vector2(0f, 0f), new Vector2(0f, 1f), new Vector2(1f, 1f),
            };
            mesh.normals = new[] {
                Vector3.forward, Vector3.forward, Vector3.forward, Vector3.forward,
            };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            mesh.RecalculateBounds();
            mesh.hideFlags = HideFlags.HideAndDontSave;
            quadMesh = mesh;
            return quadMesh;
        }

        static Mesh quadMesh;

        /// <summary>The source panel is unlit (`MeshBasicMaterial`); the station's shade must not dim it.</summary>
        internal static void ApplyArtwork(Material material, Texture2D texture) {
            if (material == null) return;
            if (texture == null) {
                var dark = new Color(.07f, .08f, .09f, 1f);
                if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", dark);
                if (material.HasProperty("_Color")) material.color = dark;
                if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", null);
                if (material.HasProperty("_MainTex")) material.SetTexture("_MainTex", null);
                material.mainTexture = null;
                return;
            }
            // The sign path's one URP texture setup: base map + emission, so the print reads
            // as the source's unlit plate rather than a lit panel.
            StationSignMaterials.ApplyTexture(material, texture);
        }

        static string Short(string key) => string.IsNullOrEmpty(key) ? "?" : key.Length > 16 ? key.Substring(0, 16) : key;

        static void DestroyTexture(Texture2D texture) => Destroy(texture);

        internal static void SafeDestroy(UnityEngine.Object value) => Destroy(value);

        static void Destroy(UnityEngine.Object value) {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }

        /// <summary>A per-panel row for the state report (no pixels, just the facts).</summary>
        public JObject Report() {            var panels = new JArray();
            foreach (var entry in entries.Values) {
                panels.Add(new JObject {
                    ["key"] = Short(entry.Key),
                    ["moduleId"] = entry.ModuleId ?? "",
                    ["kind"] = PsdHeaderVocabulary.Kind(entry.Kind),
                    ["direction"] = entry.Direction ?? "",
                    ["lineId"] = entry.LineId ?? "",
                    ["colour"] = entry.Colour ?? "",
                    ["destination"] = entry.Destination ?? "",
                    ["width"] = entry.Width,
                    ["height"] = entry.Height,
                    ["bytes"] = entry.Bytes,
                    ["ink"] = Math.Round(entry.Ink, 4),
                    ["slots"] = entry.Refs,
                });
            }
            var pending = new JArray();
            foreach (var key in wanted.Keys) pending.Add(Short(key));
            return new JObject {
                ["slots"] = SlotCount,
                ["served"] = ServedCount,
                ["textures"] = TextureCount,
                ["pending"] = PendingCount,
                ["unported"] = UnportedCount,
                ["minInk"] = Math.Round(MinInk, 4),
                ["panels"] = panels,
                ["missing"] = pending,
            };
        }

        /// <summary>The report for a station whose world has no printed PSD band (honest zeros).</summary>
        public static JObject EmptyReport() => new JObject {
            ["slots"] = 0,
            ["served"] = 0,
            ["textures"] = 0,
            ["pending"] = 0,
            ["unported"] = 0,
            ["minInk"] = 0.0,
            ["panels"] = new JArray(),
            ["missing"] = new JArray(),
        };

        public void Dispose() {
            if (disposed) return;
            disposed = true;
            provider.Dispose();
            foreach (var entry in entries.Values) DestroyTexture(entry.Texture);
            entries.Clear();
            foreach (var list in subscribers.Values) foreach (var binding in list) binding.Clear();
            subscribers.Clear();
            wanted.Clear();
            ForgetAll();
        }

        void ForgetAll() {
            askedAt.Clear();
            attempts.Clear();
        }
    }

    /* ------------------------------------------------------------------ bindings */

    /// <summary>One slot's printed quad and the pixels it shows.</summary>
    public sealed class PsdHeaderSlotBinding : IDisposable {
        readonly PsdHeaderTextureCache cache;
        public OpeningView View { get; }
        public PsdHeaderSlot Slot { get; }
        public string Key { get; internal set; } = "";
        public PsdHeaderKind Kind => Slot.Kind;
        public float Width => Slot.Width;
        public float Height => Slot.Height;
        public Transform Node => Slot.Node;
        public GameObject Quad { get; internal set; }
        public MeshRenderer Renderer { get; internal set; }
        public Material Material { get; internal set; }
        public Material MaterialTemplate { get; internal set; }
        public Texture2D Texture { get; private set; }
        public string Fingerprint { get; private set; } = "";
        public bool HasTexture => Texture != null;
        bool released;

        internal PsdHeaderSlotBinding(PsdHeaderTextureCache cache, OpeningView view, in PsdHeaderSlot slot) {
            this.cache = cache;
            View = view;
            Slot = slot;
            Key = slot.Key;
            MaterialTemplate = cache != null ? cache.TemplateMaterial : null;
        }

        internal void Apply(Texture2D texture, string fingerprint) {
            Texture = texture;
            Fingerprint = fingerprint ?? "";
            PsdHeaderTextureCache.ApplyArtwork(Material, texture);
        }

        internal void Clear() {
            Texture = null;
            Fingerprint = "";
            PsdHeaderTextureCache.ApplyArtwork(Material, null);
        }

        /// <summary>Re-read the view's current painted plan; a changed key is new pixels.</summary>
        public int Refresh() => cache.RefreshHeaderKeys(View);

        public void Dispose() {
            if (released) return;
            released = true;
            cache?.Release(this);
            // The quad and its material belong to this binding, not to the shared template.
            if (Quad != null) { PsdHeaderTextureCache.SafeDestroy(Quad); Quad = null; }
            if (Material != null) { PsdHeaderTextureCache.SafeDestroy(Material); Material = null; }
        }
    }

    /* ------------------------------------------------------------------ scope */

    /// <summary>
    /// One world's printed-header connection: the provider, the cache, the slots this build
    /// bound and the quads it minted. It lives on the world's own `openings` role root, so a
    /// station switch can never let the outgoing world's teardown take the incoming
    /// station's artwork with it (the renderer singleton is reused across the staged
    /// candidate, so per-world state must belong to the world, not to the renderer).
    /// </summary>
    public sealed class PsdHeaderArtworkScope : MonoBehaviour {
        public PsdHeaderWebProvider Provider;
        public PsdHeaderTextureCache Cache;
        /// <summary>The host-bound publisher; null means only the WebGL bridge can be tried.</summary>
        public Func<string, bool> Publish;
        public readonly List<PsdHeaderSlotBinding> Bindings = new List<PsdHeaderSlotBinding>();
        /// <summary>The scope this one replaced; restored if this build never commits.</summary>
        internal PsdHeaderArtworkScope Previous;

        void OnDestroy() {
            PsdHeaderArtwork.Detach(this);
            // The world root is going away, so its quads go with it; the pixels and the
            // materials this build minted are ours to free.
            PsdHeaderArtwork.ReleaseScope(this, destroyQuads: false);
        }
    }

    /// <summary>
    /// The packet's one connection to the plan-11 bridge and to the active station: the
    /// command handler needs the provider the renderer built, and the renderer needs the
    /// host's session/revision to fence stale replies (RCA 15 §5).
    /// </summary>
    public static class PsdHeaderArtwork {
        /// <summary>A test/verifier seam that captures the C#→JS requests (null = the bridge).</summary>
        public static Action<string> SendHook;

        /// <summary>The world scope the current provider/cache belong to.</summary>
        public static PsdHeaderArtworkScope Scope { get; private set; }
        public static PsdHeaderWebProvider Provider => Scope != null ? Scope.Provider : null;
        public static PsdHeaderTextureCache Cache => Scope != null ? Scope.Cache : null;

        public static readonly PsdHeaderArtworkState State = new PsdHeaderArtworkState();

        internal static void Attach(PsdHeaderArtworkScope scope) {
            if (scope == null || scope.Cache == null) return;
            scope.Previous = Scope;
            Scope = scope;
        }

        internal static void Detach(PsdHeaderArtworkScope scope) {
            if (scope == null) return;
            if (Scope == scope) {
                var previous = scope.Previous;
                scope.Previous = null;
                while (previous != null && previous.gameObject == null) {
                    var next = previous.Previous;
                    previous.Previous = null;
                    previous = next;
                }
                Scope = previous;
                return;
            }
            var cursor = Scope;
            while (cursor != null) {
                if (cursor.Previous == scope) {
                    cursor.Previous = scope.Previous;
                    scope.Previous = null;
                    return;
                }
                cursor = cursor.Previous;
            }
            scope.Previous = null;
        }

        /// <summary>Route one `psd.*` command's raw JSON to the painter's reply channel.</summary>
        public static bool Receive(string json) => Provider != null && Provider.Receive(json);

        /// <summary>Upload whatever the painter has already answered.</summary>
        public static void Pump() => Cache?.Pump();

        /// <summary>
        /// Send one C#→JS message: a test's hook first (the verifier seam), then the
        /// committed world's host-bound publisher, then the WebGL bridge. The desktop player
        /// has no WebGL bridge, so a header request that skipped the host could never reach
        /// the React painter (the transport rule RCA 14 §4.1 established for sign faces).
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

        /// <summary>Free one world's cache, textures, materials and quads. Idempotent.</summary>
        internal static void ReleaseScope(PsdHeaderArtworkScope released, bool destroyQuads = true) {
            if (released == null) return;
            // Pixels and subscriptions first: the cache clears every binding's slot.
            if (released.Cache != null) {
                released.Cache.Dispose();
                released.Cache = null;
            }
            for (int i = 0; i < released.Bindings.Count; i++) {
                var binding = released.Bindings[i];
                if (binding == null) continue;
                if (destroyQuads && binding.Quad != null) SafeDestroy(binding.Quad);
                if (binding.Material != null) SafeDestroy(binding.Material);
                binding.Quad = null;
                binding.Material = null;
            }
            released.Bindings.Clear();
            released.Provider = null;
            released.Publish = null;
        }

        static void SafeDestroy(UnityEngine.Object value) {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }

    /// <summary>The per-frame retry tick for panels the painter reported not-ready.</summary>
    public sealed class PsdHeaderPump : MonoBehaviour {
        public PsdHeaderTextureCache Cache;
        void Update() {
            if (Cache != null) Cache.Pump();
        }
    }

    /// <summary>
    /// `state.psd.headers`: how many printed slots the active world minted, how many show
    /// painted pixels, which textures were uploaded and the least-inked panel's non-paper
    /// fraction. It is the observable half of RCA 15 §5 sub-item 2 — the browser verifier
    /// asserts that a real station's PSD band was actually painted, not merely requested.
    /// </summary>
    public sealed class PsdHeaderArtworkState : IStationStateContributor {
        public string Key => "psd";

        public JObject BuildPayload(StationDocument document, StationIndex index) {
            var cache = PsdHeaderArtwork.Cache;
            // The contributor outlives one station: a station with no PSD band must report
            // empty headers, not leave the previous station's served count in the state.
            return new JObject { ["headers"] = cache != null ? cache.Report() : PsdHeaderTextureCache.EmptyReport() };
        }
    }

    /// <summary>
    /// The `psd.*` reply handler: `psd.headerChunk` / `psd.headerReady` never edit the
    /// document — a painted panel is an acknowledgement, not a commit (the sign handler's
    /// rule, RCA 15 §5).
    /// </summary>
    public sealed class PsdHeaderCommandHandler : IStationCommandHandler {
        public string Capability => "psd";

        public bool Handles(string type) => type == "psd.headerChunk" || type == "psd.headerReady";

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = null;
            rejectReason = null;
            if (command == null) return true;
            PsdHeaderArtwork.Receive(command.Raw);
            // A reply may complete several panels at once; the cache applies them and asks
            // for anything still missing (the font that has not landed yet).
            PsdHeaderArtwork.Pump();
            return true;
        }
    }

    /// <summary>
    /// The packet's registration: the host snapshots the command registry at `Awake`, so
    /// adding this family never edits the host (plan 11's zero-wiring contract).
    /// </summary>
    public static class PsdHeaderArtworkPacket {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() {
            StationCommandHandlers.Add(new PsdHeaderCommandHandler());
        }
    }
}
