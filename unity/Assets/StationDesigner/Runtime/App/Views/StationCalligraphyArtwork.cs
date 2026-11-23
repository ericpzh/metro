using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Metro.Build;
using UnityEngine;
using UnityEngine.UI;

namespace Metro.App.Views {
    /// <summary>One character's slot on an inscription panel, metres from the panel's left/top.</summary>
    public struct CalligraphyGlyph {
        public char Char;
        /// <summary>The full Unicode code point string (1 UTF-16 char for BMP, 2 for a surrogate pair).</summary>
        public string Text;
        public float X, Y, Size, Turn, Drift;
    }

    /// <summary>
    /// 18 §4 — a 站名 (wall station-name inscription) prints the **committed** station name.
    ///
    /// The promoted `calligraphy-*` prefabs bake the empty review document's sample
    /// inscription into one `calligraphyInk_*` material, and `StationDisplayModuleRenderer`
    /// only placed the prefab: Zoo's eight 楷/魏 inscriptions read the sample text instead of
    /// 动物园 no matter what the document says.
    ///
    /// This is the owner that binds them. It deliberately **keeps the authored plate mesh**
    /// and only swaps in an instance material whose `_BaseMap` is the painted panel, so the
    /// source's UV mapping, its wall stand-off and its saved face all survive — including a
    /// round pillar host, whose plate is the source's curved band (`CalligraphyModel` projects
    /// the artwork around the shaft and keeps the full UV width). Nothing here rebuilds a mesh
    /// or the routing graph: a document load or a rename paints the same plate again.
    ///
    /// Layout and painting port `sim/calligraphy.ts` (`calligraphyStyle`,
    /// `calligraphyPanelSize`) and `render/calligraphyFace.ts` (`calligraphyLayout`,
    /// `drawCalligraphyPanel`): a 横排 run fills the panel's width, a 竖排 one its height, the
    /// characters are cut to `min(0.85, slot × 0.92)` with the source's `0.3 m` pad split
    /// between the ends, each glyph gets the source's stable wash and turn (an FNV-1a hash of
    /// the character and its index, never a random jitter), and the opt-in English name prints
    /// beside the run. The plate stays transparent everywhere the strokes are not: the wall
    /// behind the piece is the inscription's paper.
    /// </summary>
    public static class StationCalligraphyArtwork {
        /// <summary>`PX_PER_METRE` (`render/calligraphyFace.ts`).</summary>
        public const int PxPerMetre = 512;
        /// <summary>`CALLIGRAPHY_INK_MAX`: the largest a character is cut, metres.</summary>
        public const float InkMax = .85f;
        /// <summary>`CALLIGRAPHY_PAD`: the margin the panel keeps around the run, metres.</summary>
        public const float Pad = .3f;
        /// <summary>The ledger a verifier reads: one line per inscription bound or refused.</summary>
        public const string NotePrefix = "calligraphy-ink:";

        /// <summary>
        /// The shared face manifest's version (`sim/calligraphyFonts.ts`
        /// `CALLIGRAPHY_FONT_VERSION`): a monotone counter folded into every browser-paint
        /// cache key and echoed by `calligraphy.faceReady`. **Bump it with the TypeScript
        /// constant** (a Node test pins the two), or a shell could serve pixels painted
        /// under another manifest.
        /// </summary>
        public const string FontVersion = "calligraphy-fonts/1";

        /// <summary>One hand's printing spec (`CALLIGRAPHY_STYLES`).</summary>
        public struct StyleSpec {
            public string Key;
            public bool Bold, Italic;
            public float Strike, Tracking, Stretch;
            public Color Ink;
        }

        /// <summary>
        /// The six hands' **native** treatment: the ink, the second strike, the tracking and
        /// the stretch (and, for a font with no separate face, bold/italic). The approved
        /// *face* is `sim/calligraphyFonts.ts`'s manifest — only the browser can paint it —
        /// and this table mirrors the palette's treatment and the manifest's weight/italic
        /// so a headless smoke prints the same hand with the scene's one font. The Node
        /// suite pins every number here to `CALLIGRAPHY_STYLES`.
        /// </summary>
        static readonly Dictionary<string, StyleSpec> Styles = new Dictionary<string, StyleSpec>(StringComparer.Ordinal) {
            ["kai"] = Spec("kai", false, false, .014f, .02f, 1f, "#171a20"),
            ["xing"] = Spec("xing", false, true, .032f, .05f, 1.02f, "#14161b"),
            ["li"] = Spec("li", false, false, .008f, .11f, 1.10f, "#1b1d22"),
            ["wei"] = Spec("wei", true, false, .026f, 0f, 1.03f, "#101217"),
            ["hei"] = Spec("hei", true, false, 0f, .03f, 1f, "#1d2126"),
            ["song"] = Spec("song", false, false, .012f, .04f, .97f, "#191c22"),
        };

        static StyleSpec Spec(string key, bool bold, bool italic, float strike, float tracking, float stretch, string ink) =>
            new StyleSpec {
                Key = key, Bold = bold, Italic = italic, Strike = strike, Tracking = tracking, Stretch = stretch,
                Ink = ParseColour(ink),
            };

        /// <summary>`calligraphyStyle`'s default: 楷书 for an unknown or legacy value.</summary>
        public static StyleSpec Style(string style) =>
            Styles.TryGetValue(style ?? "", out var spec) ? spec : Styles["kai"];

        static Color ParseColour(string hex) {
            return ColorUtility.TryParseHtmlString(hex, out var colour) ? colour : new Color(.07f, .08f, .1f);
        }

        /* ----------------------------------------------------------- the panel */

        /// <summary>`calligraphyPanelSize(axis, w, panelH)`, in metres.</summary>
        public static Vector2 PanelSize(string axis, float width, float panelHeight) {
            bool vertical = string.Equals(axis, "v", StringComparison.Ordinal);
            return new Vector2(vertical ? .72f : Mathf.Max(.5f, width <= 0f ? 1f : width),
                Mathf.Max(.4f, panelHeight <= 0f ? 1.6f : panelHeight));
        }

        /// <summary>The ink run: the document's name, the English name when the module opts in.</summary>
        public static string NameOf(StationDocument document) => document?.Name ?? "";

        /// <summary>
        /// The content key of one inscription: the name, opt-in English name, style, axis and
        /// panel dimensions. A repaint is keyed by exactly these, so a station rename cannot
        /// reuse the previous plate and an unrelated edit cannot repaint one.
        /// </summary>
        public static string ContentKey(string name, string nameEn, bool showEnglish, string style, string axis,
            Vector2 panel) =>
            "calligraphy|" + (name ?? "") + "|" + (showEnglish ? nameEn ?? "" : "") + "|" + (style ?? "") + "|" +
            (axis ?? "") + "|" + panel.x.ToString("0.###", CultureInfo.InvariantCulture) + "x" +
            panel.y.ToString("0.###", CultureInfo.InvariantCulture);

        /// <summary>
        /// `calligraphyLayout`, metres on the panel. `chars` is the inscription's text; a panel
        /// with no text falls back to the source's `unknown` marker so a record never prints an
        /// empty plate.
        /// </summary>
        public static List<CalligraphyGlyph> Layout(string text, string axis, string style, Vector2 panel) {
            bool vertical = string.Equals(axis, "v", StringComparison.Ordinal);
            var trimmed = (text ?? "").Trim();
            var chars = new List<string>();
            for (int i = 0; i < trimmed.Length; i++) {
                char ch = trimmed[i];
                if (char.IsHighSurrogate(ch) && i + 1 < trimmed.Length && char.IsLowSurrogate(trimmed[i + 1])) {
                    chars.Add(trimmed.Substring(i, 2));
                    i++;
                    continue;
                }
                if (char.IsWhiteSpace(ch)) continue;
                chars.Add(ch.ToString());
            }
            if (chars.Count == 0) chars.Add("？");
            var spec = Style(style);
            var glyphs = new List<CalligraphyGlyph>(chars.Count);
            if (vertical) {
                float slot = Mathf.Max(.05f, (panel.y - Pad) / chars.Count);
                float size = Mathf.Min(InkMax, slot * .92f);
                for (int i = 0; i < chars.Count; i++) {
                    glyphs.Add(new CalligraphyGlyph {
                        Char = chars[i][0],
                        Text = chars[i],
                        X = panel.x * .5f,
                        Y = Pad * .5f + slot * (i + .5f),
                        Size = size,
                        Turn = Jitter(chars[i], i + 97) * .035f,
                        Drift = Jitter(chars[i], i + 31) * panel.x * .03f,
                    });
                }
            } else {
                float slot = Mathf.Max(.05f, (panel.x - Pad) / chars.Count);
                float size = Mathf.Min(InkMax, slot * .92f);
                for (int i = 0; i < chars.Count; i++) {
                    glyphs.Add(new CalligraphyGlyph {
                        Char = chars[i][0],
                        Text = chars[i],
                        X = Pad * .5f + slot * (i + .5f),
                        Y = panel.y * .5f,
                        Size = size,
                        Turn = Jitter(chars[i], i + 97) * .035f,
                        Drift = Jitter(chars[i], i + 31) * panel.y * .05f,
                    });
                }
            }
            // `tracking` is the source's extra letter spacing as a fraction of the ink size;
            // it only ever widens the run, and the slot already fills the panel, so it is
            // reported through the style and not applied twice here.
            return glyphs;
        }

        /// <summary>The source's stable `jitter`: an FNV-1a hash of `index:char` mapped to [−1, 1).</summary>
        public static float Jitter(char ch, int index) => Jitter(ch.ToString(), index);

        /// <summary>The source's stable `jitter` over a full Unicode code point string (including surrogate pairs).</summary>
        public static float Jitter(string ch, int index) {
            uint hash = 2166136261u;
            var key = index.ToString(CultureInfo.InvariantCulture) + ":" + (ch ?? "");
            for (int i = 0; i < key.Length; i++) {
                hash ^= key[i];
                hash *= 16777619u;
            }
            return (hash / 4294967296f) * 2f - 1f;
        }

        /* -------------------------------------------------------------- binding */

        /// <summary>
        /// One world's inscriptions: the painted plates it owns, its ledger and — when a
        /// React shell is attached — the browser painter's provider and texture cache.
        ///
        /// It belongs to the world (owned by `StationModuleGroups.WorldState.Calligraphy`),
        /// not to the renderer, because the host stages a candidate world before the
        /// outgoing one is disposed. `ReleaseScope`/`OnDestroy` free exactly this world's
        /// textures; a reply addressed to another world's request id is unknown to this
        /// cache and is discarded (stale-discard is per world, not per module).
        /// </summary>
        public sealed class Scope : MonoBehaviour {
            public readonly List<string> Notes = new List<string>();
            public readonly Dictionary<string, Material> Materials = new Dictionary<string, Material>(StringComparer.Ordinal);
            public int Bound;
            public string LastError = "";
            /// <summary>The world this scope prints for; the reply path recaptures through it.</summary>
            public StationWorldView World;
            /// <summary>The scene's CJK face: the headless/native fallback's only font.</summary>
            public Font Font;
            /// <summary>The browser painter's cache, created only when a shell can answer.</summary>
            public StationCalligraphyFaceCache Cache;
            public StationCalligraphyWebProvider Provider;
            /// <summary>The host-bound outbound route (both transports); null = WebGL bridge only.</summary>
            public Func<string, bool> Publish;
            /// <summary>The 1×1 transparent plate a bridge-painted inscription wears until its pixels land.</summary>
            public Texture2D Placeholder;
            /// <summary>True when this world paints through the browser; false = native path throughout.</summary>
            public bool Bridge;
            public bool Released;

            void OnDestroy() => ReleaseContents(this);
        }

        /// <summary>A test/verifier seam that captures the C#→JS requests (null = the bridge).</summary>
        public static Action<string> SendHook;

        static readonly List<Scope> liveScopes = new List<Scope>();

        /// <summary>The most recent world's inscription scope, or null.</summary>
        public static Scope CurrentScope {
            get {
                for (int i = liveScopes.Count - 1; i >= 0; i--) {
                    var scope = liveScopes[i];
                    if (scope != null && scope.gameObject != null) return scope;
                }
                return null;
            }
        }

        /// <summary>
        /// True when a React shell can answer a paint request. Only a live player session can:
        /// an EditMode fixture and the editor-time binding report are not playing, and a batch
        /// build/smoke has no shell at all, so all of them keep the native `Paint`. A desktop
        /// player whose presenter failed to attach is caught later by the publish result (the
        /// request is dropped and the cache paints natively instead of leaving a blank plate).
        /// </summary>
        public static bool BridgeCandidate {
            get {
                // The explicit test/verifier seam wins even outside a player session, so a
                // fixture can drive the bridge path without a React shell.
                if (SendHook != null) return true;
                if (!Application.isPlaying || Application.isBatchMode) return false;
                return UnityEngine.Object.FindAnyObjectByType<StationGameHost>() != null;
            }
        }

        public static Scope CreateScope(Transform parent) => CreateScope(parent, null, null);

        public static Scope CreateScope(Transform parent, StationWorldView world, Font font) {
            var go = new GameObject("calligraphy artwork");
            if (parent != null) go.transform.SetParent(parent, false);
            var scope = go.AddComponent<Scope>();
            scope.World = world;
            scope.Font = font;
            if (BridgeCandidate) {
                scope.Bridge = true;
                scope.Placeholder = CreateTransparentTexture();
                scope.Provider = new StationCalligraphyWebProvider(Send, CurrentContext);
                // A request id is unique to this world: two live worlds can request the same
                // plate, and a reply must be assembled by the world that asked for it.
                scope.Cache = new StationCalligraphyFaceCache(scope.Provider, note => scope.Notes.Add(note),
                    "calligraphy-req-" + ((uint)scope.GetHashCode()).ToString("x8", CultureInfo.InvariantCulture));
                var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
                if (host != null) scope.Publish = json => host != null && host.PublishOutbound(json);
                var pump = go.AddComponent<StationCalligraphyPump>();
                pump.Cache = scope.Cache;
            }
            liveScopes.Add(scope);
            return scope;
        }

        /// <summary>Free one world's cache, textures, materials and placeholder. Idempotent.</summary>
        public static void ReleaseScope(Scope scope) {
            if (scope == null) return;
            ReleaseContents(scope);
            if (scope.gameObject) SafeDestroy(scope.gameObject);
        }

        static void ReleaseContents(Scope scope) {
            if (scope == null || scope.Released) return;
            scope.Released = true;
            liveScopes.Remove(scope);
            // The cache owns every texture it applied (browser pixels and native fallbacks
            // alike); a pure-native scope's textures belong to their materials.
            bool cacheOwnedTextures = scope.Cache != null;
            if (scope.Cache != null) {
                scope.Cache.Dispose();
                scope.Cache = null;
            }
            scope.Provider = null;
            if (scope.Placeholder) {
                SafeDestroy(scope.Placeholder);
                scope.Placeholder = null;
            }
            foreach (var material in scope.Materials.Values) {
                if (!material) continue;
                var texture = material.HasProperty("_BaseMap") ? material.GetTexture("_BaseMap") as Texture2D : null;
                SafeDestroy(material);
                if (!cacheOwnedTextures && texture) SafeDestroy(texture);
            }
            scope.Materials.Clear();
        }

        /// <summary>Route one `calligraphy.faceChunk` / `calligraphy.faceReady` into every live world.</summary>
        public static bool Receive(string json) {
            if (string.IsNullOrEmpty(json)) return false;
            bool handled = false;
            for (int i = liveScopes.Count - 1; i >= 0; i--) {
                var scope = liveScopes[i];
                if (scope == null || scope.Provider == null) continue;
                if (scope.Provider.Receive(json)) handled = true;
            }
            return handled;
        }

        /// <summary>Drain every live world's painter replies and retries.</summary>
        public static void Pump() {
            for (int i = liveScopes.Count - 1; i >= 0; i--) {
                var scope = liveScopes[i];
                if (scope != null && scope.Cache != null) scope.Cache.Pump();
            }
        }

        /// <summary>
        /// Send one C#→JS message: a test's hook first (the verifier seam), then the
        /// world's host-bound publisher, then the WebGL bridge. The desktop player has no
        /// WebGL bridge, so a request that skipped the host could never reach the React
        /// painter (the transport rule RCA 14 §4.1 established for sign faces).
        /// </summary>
        public static bool Send(string json) {
            if (string.IsNullOrEmpty(json)) return false;
            var hook = SendHook;
            if (hook != null) {
                hook(json);
                return true;
            }
            var scope = CurrentScope;
            var publish = scope != null ? scope.Publish : null;
            if (publish != null) return publish(json);
            return StationWebBridge.Publish(json);
        }

        static StationCalligraphyFaceContext CurrentContext() {
            var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            return new StationCalligraphyFaceContext {
                SessionId = host != null ? host.ClientSessionId : "",
                Revision = host != null ? host.CurrentRevision : -1,
            };
        }

        /// <summary>
        /// The cache key of one browser-painted plate: the native content key (name, opt-in
        /// English, hand, axis, panel) plus the manifest version and the plate's measured
        /// orientation. A face painted for a mirrored plate can never be served to an
        /// unmirrored one, and a manifest bump is a different plate.
        /// </summary>
        public static string BridgeKey(string contentKey, bool mirrorU, bool flipV) =>
            (contentKey ?? "") + "|font=" + FontVersion + "|u" + (mirrorU ? "1" : "0") + "v" + (flipV ? "1" : "0");

        /// <summary>The transparent plate a bridge-painted inscription wears until its pixels land.</summary>
        public static Texture2D CreateTransparentTexture() {
            var texture = new Texture2D(1, 1, TextureFormat.RGBA32, false) {
                name = "calligraphy ink placeholder",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
            };
            texture.SetPixel(0, 0, new Color(0f, 0f, 0f, 0f));
            texture.Apply(false, false);
            return texture;
        }

        /// <summary>
        /// Bind one placed inscription to the committed document. Returns false with the reason
        /// in <paramref name="scope"/>'s ledger when the promoted prefab carries no ink surface.
        /// </summary>
        public static bool Bind(StationDocument document, Scope scope, GameObject root, ModuleFacts module,
            Font font) =>
            Bind(document, scope, root, module, font, null);

        public static bool Bind(StationDocument document, Scope scope, GameObject root, ModuleFacts module,
            Font font, Metro.App.StationWorldView world) {
            if (scope == null || root == null || module == null) return false;
            var renderer = FindInkRenderer(root);
            if (renderer == null) {
                scope.Notes.Add("calligraphy-unresolved:" + module.Id + ":no-ink-surface");
                return false;
            }
            var name = NameOf(document);
            var nameEn = document?.NameEn ?? "";
            var style = module.Config.Text("style");
            var axis = module.Config.Text("axis");
            bool showEnglish = module.Config.Bool("showEnglish") || module.Config.Bool("nameEn");
            var panel = PanelSize(axis, module.Width, (float)PanelHeightOf(document, module));
            FitPlanarInkScale(renderer, panel);
            MeasureInkOrientation(root, renderer, out bool mirrorU, out bool flipV);
            if (scope.World == null) scope.World = world;
            if (scope.Font == null) scope.Font = font;
            var contentKey = ContentKey(name, nameEn, showEnglish, style, axis, panel);
            var materialKey = BridgeKey(contentKey, mirrorU, flipV);
            var plate = renderer.sharedMaterial ? renderer.sharedMaterial.name : "calligraphyInk";
            Material material;
            bool bridged = false;
            if (scope.Bridge && scope.Cache != null) {
                // The browser is the painter. The instance material starts transparent so
                // the wall shows through; the reply swaps the painted panel into this same
                // material and the world recaptures the part (`StationVisibility`'s rule).
                var request = new StationCalligraphyFaceRequest {
                    ModuleId = module.Id ?? "",
                    Text = name,
                    English = showEnglish ? nameEn : "",
                    Style = style,
                    Axis = axis,
                    PanelWidth = panel.x,
                    PanelHeight = panel.y,
                    ShowEnglish = showEnglish,
                    MirrorU = mirrorU,
                    FlipV = flipV,
                };
                if (!scope.Materials.TryGetValue(materialKey, out material) || !material) {
                    material = CreateInkMaterial(scope.Placeholder);
                    if (material == null) {
                        scope.Notes.Add("calligraphy-unresolved:" + module.Id + ":no-material");
                        return false;
                    }
                    scope.Materials[materialKey] = material;
                }
                var nativeFont = font != null ? font : scope.Font;
                scope.Cache.Bind(new StationCalligraphyFaceBinding {
                    Key = request.Key,
                    ModuleId = module.Id ?? "",
                    Style = style,
                    Axis = axis,
                    Renderer = renderer,
                    Material = material,
                    World = scope.World,
                    NativePaint = () => PaintTexture(name, showEnglish ? nameEn : "", style, axis, panel,
                        nativeFont, mirrorU, flipV, out _),
                }, request);
                bridged = true;
            } else if (!scope.Materials.TryGetValue(materialKey, out material) || !material) {
                try {
                    material = Paint(name, showEnglish ? nameEn : "", style, axis, panel, font, mirrorU, flipV,
                        out var note);
                    if (!string.IsNullOrEmpty(note)) scope.Notes.Add("calligraphy-paint:" + module.Id + ":" + note);
                } catch (Exception error) {
                    scope.LastError = error.GetType().Name + ": " + error.Message;
                    scope.Notes.Add("calligraphy-unresolved:" + module.Id + ":paint-failed:" + error.Message);
                    return false;
                }
                if (material == null) {
                    scope.Notes.Add("calligraphy-unresolved:" + module.Id + ":no-material");
                    return false;
                }
                scope.Materials[materialKey] = material;
            }
            // The instance material, never the shared prefab one: two inscriptions on the same
            // prefab key print different names. Keeping the plate's own name in the instance
            // material's name is what lets `FindInkRenderer` find the bound plate again (a
            // verifier, a repaint pass, or a later scope) without a second marker.
            if (material.name == "calligraphy ink") material.name = "calligraphy ink " + plate;
            renderer.sharedMaterial = material;
            if (bridged) scope.Cache.Pump();
            world?.RecaptureArtwork(renderer);
            scope.Bound++;
            // `src` is the current pixel source: a browser reply is asynchronous, so a fresh
            // bind is `pending` until the reply (or a publish failure's native fallback).
            var source = !bridged
                ? "native"
                : scope.Cache != null && scope.Cache.IsBrowserPainted(materialKey) ? "browser"
                : scope.Cache != null && scope.Cache.IsNativeFallback(materialKey) ? "native-fallback"
                : "pending";
            scope.Notes.Add(NotePrefix + module.Id + ":" + contentKey + ":glyphs=" + Layout(name, axis, style, panel).Count +
                ":en=" + (showEnglish && nameEn.Length > 0 ? "1" : "0") + ":src=" + source);
            return true;
        }

        /// <summary>
        /// Scale a flat 4-vertex inscription plate's transform when its module's `w × panelH`
        /// differs from the promoted prefab's baked dimensions (e.g. a 4 m Zoo wall inscription
        /// sharing the 5 m `calligraphy-wei-h` prefab), while leaving `filter.sharedMesh`, its UVs
        /// and its local bounds completely untouched. Curved pillar bands (`vertexCount > 4`) keep
        /// their authored arc.
        /// </summary>
        static void FitPlanarInkScale(MeshRenderer renderer, Vector2 panel) {
            if (!renderer) return;
            var filter = renderer.GetComponent<MeshFilter>();
            var mesh = filter != null ? filter.sharedMesh : null;
            if (!mesh || mesh.vertexCount != 4) return;
            var size = mesh.bounds.size;
            if (size.x <= .1f || size.y <= .1f || size.z > .05f) return;
            var current = renderer.transform.localScale;
            float sx = (current.x < 0f ? -1f : 1f) * (panel.x / size.x);
            float sy = (current.y < 0f ? -1f : 1f) * (panel.y / size.y);
            float sz = current.z == 0f ? 1f : (current.z < 0f ? -1f : 1f);
            renderer.transform.localScale = new Vector3(sx, sy, sz);
        }

        /// <summary>
        /// Inspect the authored plate's UVs in world space without mutating `sharedMesh`: glTFast
        /// imports `1 − V`, so the physical top edge sits at `V = 0` (`flipV = true`), and any U
        /// reversal relative to the viewer's right is detected the same way.
        /// </summary>
        static void MeasureInkOrientation(GameObject root, MeshRenderer renderer, out bool mirrorU, out bool flipV) {
            mirrorU = false;
            flipV = false;
            if (!renderer) return;
            var filter = renderer.GetComponent<MeshFilter>();
            var mesh = filter != null ? filter.sharedMesh : null;
            if (!mesh) return;
            var vertices = mesh.vertices;
            var uv = mesh.uv;
            var normals = mesh.normals;
            if (vertices == null || uv == null || vertices.Length == 0 || uv.Length != vertices.Length) return;
            var outwardWorld = Vector3.zero;
            if (normals != null && normals.Length == vertices.Length) {
                var sum = Vector3.zero;
                for (int i = 0; i < normals.Length; i++) sum += normals[i];
                if (sum.sqrMagnitude > 1e-6f * normals.Length) {
                    outwardWorld = renderer.transform.TransformDirection(sum.normalized);
                    var lossy = renderer.transform.lossyScale;
                    if (lossy.x * lossy.y * lossy.z < 0f) outwardWorld = -outwardWorld;
                }
            }
            if (outwardWorld.sqrMagnitude < 1e-6f && root != null) outwardWorld = root.transform.forward;
            var upWorld = Vector3.up;
            var rightWorld = Vector3.Cross(outwardWorld, upWorld);
            if (rightWorld.sqrMagnitude < 1e-6f) {
                rightWorld = root != null ? -root.transform.right : Vector3.right;
            }
            rightWorld.Normalize();
            float minX = float.MaxValue, maxX = float.MinValue, minY = float.MaxValue, maxY = float.MinValue;
            int left = 0, right = 0, bottom = 0, top = 0;
            for (int i = 0; i < vertices.Length; i++) {
                var worldPos = renderer.transform.TransformPoint(vertices[i]);
                float x = Vector3.Dot(worldPos, rightWorld);
                float y = Vector3.Dot(worldPos, upWorld);
                if (x < minX) { minX = x; left = i; }
                if (x > maxX) { maxX = x; right = i; }
                if (y < minY) { minY = y; bottom = i; }
                if (y > maxY) { maxY = y; top = i; }
            }
            if (maxX - minX > 1e-5f) mirrorU = uv[right].x < uv[left].x;
            if (maxY - minY > 1e-5f) flipV = uv[top].y < uv[bottom].y;
        }

        /// <summary>The saved record's printed panel height (`panelH`), 1.6 m when absent.</summary>
        public static double PanelHeightOf(StationDocument document, ModuleFacts module) {
            if (document != null && module != null) {
                foreach (var record in document.Modules) {
                    if (record?.Facts == null) continue;
                    if (!string.Equals(record.Facts.Id, module.Id, StringComparison.Ordinal)) continue;
                    return record.PanelHeight > 0 ? record.PanelHeight : 1.6;
                }
            }
            return 1.6;
        }

        /// <summary>The promoted prefab's printed ink surface (`calligraphyInk_*`).</summary>
        public static MeshRenderer FindInkRenderer(GameObject root) {
            if (root == null) return null;
            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer) continue;
                foreach (var material in renderer.sharedMaterials) {
                    if (!material || material.name == null) continue;
                    if (material.name.IndexOf("calligraphyInk", StringComparison.OrdinalIgnoreCase) >= 0) return renderer;
                }
                var node = renderer.transform.name ?? "";
                if (node.IndexOf("ink", StringComparison.OrdinalIgnoreCase) >= 0) return renderer;
            }
            return null;
        }

        /* -------------------------------------------------------------- painting */

        const int MaxRasterFontSize = 128;

        /// <summary>
        /// Paint one inscription panel to a transparent RGBA texture and return a material that
        /// draws it. The plate is the ink alone: every pixel the strokes do not cover is clear.
        /// </summary>
        public static Material Paint(string text, string english, string style, string axis, Vector2 panel,
            Font font, out string note) =>
            Paint(text, english, style, axis, panel, font, false, false, out note);

        public static Material Paint(string text, string english, string style, string axis, Vector2 panel,
            Font font, bool mirrorU, bool flipV, out string note) {
            var texture = PaintTexture(text, english, style, axis, panel, font, mirrorU, flipV, out note);
            if (texture == null) return null;
            var material = CreateInkMaterial(texture);
            if (material == null) {
                SafeDestroy(texture);
                note = "no-shader";
                return null;
            }
            note = "";
            return material;
        }

        /// <summary>
        /// The pixels of one inscription panel, transparent except the strokes.
        ///
        /// This is the native fallback (and the headless/test/smoke path) for a plate the
        /// browser cannot paint: the same layout arithmetic and the same uniform face the
        /// scene ships (`NotoSansSC.ttf`), which is why the browser path exists — a real
        /// hand needs its own font. It is deliberately factored out of <see cref="Paint"/>
        /// so the bridge's native fallback can swap the same texture into the material it
        /// already installed, instead of a second material that would lose the plate.
        /// </summary>
        public static Texture2D PaintTexture(string text, string english, string style, string axis, Vector2 panel,
            Font font, bool mirrorU, bool flipV, out string note) {
            note = "";
            if (font == null) {
                note = "no-font";
                return null;
            }
            var spec = Style(style);
            bool vertical = string.Equals(axis, "v", StringComparison.Ordinal);
            int width = Mathf.Max(64, Mathf.RoundToInt(panel.x * PxPerMetre));
            int height = Mathf.Max(64, Mathf.RoundToInt(panel.y * PxPerMetre));
            var cleanEnglish = (english ?? "").Trim();
            // The English line takes its share of the panel (`drawCalligraphyPanel`'s inkPanel).
            var inkPanel = cleanEnglish.Length > 0
                ? (vertical ? new Vector2(panel.x * .72f, panel.y) : new Vector2(panel.x, panel.y * .72f))
                : panel;
            var glyphs = Layout(text, axis, style, inkPanel);
            var glyphStyle = spec.Bold ? FontStyle.Bold : spec.Italic ? FontStyle.Italic : FontStyle.Normal;

            RenderTexture previous = RenderTexture.active;
            RenderTexture target = null;
            GameObject cameraObject = null, canvasObject = null;
            Texture2D texture = null;
            try {
                var requested = new StringBuilder(glyphs.Count);
                foreach (var glyph in glyphs) requested.Append(string.IsNullOrEmpty(glyph.Text) ? glyph.Char.ToString() : glyph.Text);
                int samplePixels = glyphs.Count > 0
                    ? Mathf.Clamp(Mathf.RoundToInt(glyphs[0].Size * PxPerMetre), 4, MaxRasterFontSize)
                    : 64;
                font.RequestCharactersInTexture(requested.ToString(), samplePixels, glyphStyle);
                if (cleanEnglish.Length > 0) {
                    float enMetres = Mathf.Min(vertical ? panel.x * .19f : panel.y * .19f, .18f);
                    int enSample = Mathf.Clamp(Mathf.RoundToInt(enMetres * PxPerMetre), 4, MaxRasterFontSize);
                    font.RequestCharactersInTexture(cleanEnglish, enSample, FontStyle.Normal);
                }

                target = RenderTexture.GetTemporary(width, height, 0, RenderTextureFormat.ARGB32,
                    RenderTextureReadWrite.sRGB);
                cameraObject = new GameObject("calligraphy paint camera");
                var camera = cameraObject.AddComponent<Camera>();
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0f, 0f, 0f, 0f);
                camera.orthographic = true;
                camera.orthographicSize = height * .5f;
                camera.nearClipPlane = .01f;
                camera.farClipPlane = 100f;
                camera.transform.position = new Vector3(width * .5f, height * .5f, -10f);
                camera.targetTexture = target;

                canvasObject = new GameObject("calligraphy paint canvas", typeof(Canvas));
                var canvas = canvasObject.GetComponent<Canvas>();
                canvas.renderMode = RenderMode.WorldSpace;
                var canvasRect = canvasObject.GetComponent<RectTransform>();
                canvasRect.sizeDelta = new Vector2(width, height);
                canvasRect.position = new Vector3(width * .5f, height * .5f, 0f);
                canvasRect.localScale = Vector3.one;

                foreach (var glyph in glyphs) {
                    float washX = vertical ? glyph.Drift : 0f;
                    float washY = vertical ? 0f : glyph.Drift;
                    int pixels = Mathf.Max(4, Mathf.RoundToInt(glyph.Size * PxPerMetre));
                    int raster = Mathf.Clamp(pixels, 4, MaxRasterFontSize);
                    float glyphScale = pixels / (float)raster;

                    // `drawCalligraphyPanel`: translate((x + washX)*ppm, (y + washY)*ppm),
                    // rotate(turn), scale(stretch, 1) from a top-left origin.
                    var glyphText = string.IsNullOrEmpty(glyph.Text) ? glyph.Char.ToString() : glyph.Text;
                    var holder = new GameObject("glyph " + glyphText, typeof(RectTransform));
                    holder.transform.SetParent(canvasObject.transform, false);
                    var holderRect = (RectTransform)holder.transform;
                    holderRect.anchorMin = holderRect.anchorMax = new Vector2(0f, 1f);
                    holderRect.pivot = new Vector2(.5f, .5f);
                    holderRect.sizeDelta = Vector2.zero;
                    holderRect.anchoredPosition = new Vector2((glyph.X + washX) * PxPerMetre,
                        -(glyph.Y + washY) * PxPerMetre);
                    holderRect.localEulerAngles = new Vector3(0f, 0f, -glyph.Turn * Mathf.Rad2Deg);
                    holderRect.localScale = new Vector3(spec.Stretch * glyphScale, glyphScale, 1f);

                    AddGlyphPass(holder.transform, "ink", font, glyphText, raster, glyphStyle, spec.Ink,
                        Vector2.zero);
                    if (spec.Strike > 0f) {
                        var dry = new Color(spec.Ink.r, spec.Ink.g, spec.Ink.b, spec.Ink.a * .42f);
                        AddGlyphPass(holder.transform, "strike", font, glyphText, raster, glyphStyle, dry,
                            new Vector2(raster * spec.Strike, -raster * spec.Strike * .7f));
                    }
                }

                if (cleanEnglish.Length > 0) {
                    var go = new GameObject("english", typeof(RectTransform));
                    go.transform.SetParent(canvasObject.transform, false);
                    var ui = go.AddComponent<Text>();
                    ui.font = font;
                    ui.text = cleanEnglish;
                    ui.fontStyle = FontStyle.Normal;
                    ui.alignment = TextAnchor.MiddleCenter;
                    ui.color = spec.Ink;
                    ui.horizontalOverflow = HorizontalWrapMode.Overflow;
                    ui.verticalOverflow = VerticalWrapMode.Overflow;
                    ui.raycastTarget = false;
                    float size = Mathf.Min(vertical ? panel.x * .19f : panel.y * .19f, .18f);
                    int enPixels = Mathf.Max(4, Mathf.RoundToInt(size * PxPerMetre));
                    int enRaster = Mathf.Clamp(enPixels, 4, MaxRasterFontSize);
                    float enScale = enPixels / (float)enRaster;
                    ui.fontSize = enRaster;
                    ui.resizeTextForBestFit = true;
                    ui.resizeTextMinSize = 4;
                    ui.resizeTextMaxSize = enRaster;
                    var rect = (RectTransform)go.transform;
                    rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
                    rect.pivot = new Vector2(.5f, .5f);
                    rect.localScale = new Vector3(enScale, enScale, 1f);
                    if (vertical) {
                        // `drawCalligraphyPanel`: a 竖排 plate prints its Latin line turned
                        // down its right edge.
                        rect.sizeDelta = new Vector2((panel.y * .88f * PxPerMetre) / enScale,
                            (panel.x * .28f * PxPerMetre) / enScale);
                        rect.anchoredPosition = new Vector2(panel.x * .85f * PxPerMetre,
                            -panel.y * .5f * PxPerMetre);
                        rect.localEulerAngles = new Vector3(0f, 0f, -90f);
                    } else {
                        rect.sizeDelta = new Vector2((panel.x * .9f * PxPerMetre) / enScale,
                            (panel.y * .28f * PxPerMetre) / enScale);
                        rect.anchoredPosition = new Vector2(panel.x * .5f * PxPerMetre,
                            -panel.y * .85f * PxPerMetre);
                    }
                }

                Canvas.ForceUpdateCanvases();
                camera.Render();
                RenderTexture.active = target;
                texture = new Texture2D(width, height, TextureFormat.RGBA32, false) {
                    name = "calligraphy ink " + width + "x" + height,
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = FilterMode.Bilinear,
                    anisoLevel = 4,
                };
                texture.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                if (mirrorU || flipV) {
                    var pixels = texture.GetPixels32();
                    var flipped = new Color32[pixels.Length];
                    for (int y = 0; y < height; y++) {
                        int sy = flipV ? (height - 1 - y) : y;
                        int srcRow = sy * width;
                        int dstRow = y * width;
                        if (mirrorU) {
                            for (int x = 0; x < width; x++) flipped[dstRow + x] = pixels[srcRow + (width - 1 - x)];
                        } else {
                            Array.Copy(pixels, srcRow, flipped, dstRow, width);
                        }
                    }
                    texture.SetPixels32(flipped);
                }
                texture.Apply(false, false);
            } finally {
                RenderTexture.active = previous;
                if (cameraObject) SafeDestroy(cameraObject);
                if (canvasObject) SafeDestroy(canvasObject);
                if (target != null) RenderTexture.ReleaseTemporary(target);
            }
            if (texture == null) {
                note = "no-texture";
                return null;
            }
            note = "";
            return texture;
        }

        static void AddGlyphPass(Transform parent, string name, Font font, string text, int fontSize,
            FontStyle style, Color colour, Vector2 offset) {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var ui = go.AddComponent<Text>();
            ui.font = font;
            ui.text = text;
            ui.fontStyle = style;
            ui.fontSize = fontSize;
            ui.alignment = TextAnchor.MiddleCenter;
            ui.color = colour;
            ui.horizontalOverflow = HorizontalWrapMode.Overflow;
            ui.verticalOverflow = VerticalWrapMode.Overflow;
            ui.raycastTarget = false;
            var rect = (RectTransform)go.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(.5f, .5f);
            rect.pivot = new Vector2(.5f, .5f);
            rect.sizeDelta = new Vector2(fontSize * 2.4f, fontSize * 2.4f);
            rect.anchoredPosition = offset;
        }

        /// <summary>The transparent ink material: the painted panel, drawn over the wall.</summary>
        public static Material CreateInkMaterial(Texture2D texture) {
            var shader = StationFinishLibrary.FindShader();
            if (!shader) shader = Shader.Find("Universal Render Pipeline/Unlit");
            if (!shader) shader = Shader.Find("Unlit/Transparent");
            if (!shader) return null;
            var material = new Material(shader) { name = "calligraphy ink" };
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", texture);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", Color.white);
            else material.color = Color.white;
            StationGlass.MakeTransparent(material, 1f);
            if (material.HasProperty("_Cull")) material.SetFloat("_Cull", 0f);
            material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            return material;
        }

        static void SafeDestroy(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }
}
