using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Metro.Build;
using UnityEngine;

namespace Metro.App.Views {
    // Plan 11, packet E (E2) - the source finish library, loaded in Unity.
    //
    // Every surface finish in the game is procedural artwork, chosen by a table the
    // simulation reads too (`game/src/sim/finishes.ts`, rendered by
    // `game/src/render/materials.ts`). `tools/unity-assets/export-station-finishes.mjs`
    // renders that artwork offline and writes `finishes.json` + one PNG per finish.
    // This library is the Unity side of that export:
    //
    //   * one URP material per finish id, keyed **only** by the finish id (a cell's
    //     fare zone / room tint is a separate overlay concern and is never baked into
    //     a finish material),
    //   * albedo loaded as an **sRGB** texture with **Repeat** wrap and the exported
    //     UV repeat (`1 x 1` - one texture tile per metre, the source's `tex(canvas, 1)`),
    //   * roughness/metalness from `finishMaterialProperties`, mapped to URP Lit's
    //     `_Smoothness` / `_Metallic`,
    //   * custom tints (`wall.enamel#ff4242`): an exported tinted albedo when one
    //     exists, otherwise the base's neutral map multiplied by the tint, so a
    //     painted colour is still a real panel and never a solid-colour stand-in,
    //   * unknown ids stay in the document; this library reports them by name and
    //     resolves the documented fallback (`floor.concrete`, the source's own
    //     `finishDef` fallback).
    //
    // Vertex colours: the mesher emits the source's ambient occlusion as vertex
    // colours (the TS materials use `vertexColors: true`). URP/Lit ignores vertex
    // colours, so AO is carried in the mesh for parity and for any vertex-colour
    // shader the host wires; see `StationCellView`'s evidence note.
    //
    // The library does not read files unless asked: `FromJson` takes a texture loader
    // (Resources, StreamingAssets or a test fixture), `LoadFromDirectory` reads the
    // exported PNGs from disk for EditMode verification, and `LoadFromResources`
    // resolves the staged copies a build ships.

    [Serializable]
    public sealed class StationFinishFaceDefault {
        public string face;
        public string id;
    }

    [Serializable]
    public sealed class StationFinishPaletteGroup {
        public string fam;
        public string label;
        public string[] ids;
    }

    /// <summary>One row of `finishes.json` (field names are the export contract).</summary>
    [Serializable]
    public sealed class StationFinishEntry {
        public string id;
        public string baseId;
        public string label;
        public string family;
        public string look;
        public string tint;
        public string baseTint;
        public string albedo;
        public string detail;
        public string tintMode;
        public string albedoSha256;
        public string detailSha256;
        public string colorSpace;
        public float speed;
        public float repeatU;
        public float repeatV;
        public float metresPerTile;
        public float roughness;
        public float metalness;
        public bool cover;
        public bool doubleSided;
        public bool neutral;
        public int width;
        public int height;
        public int albedoBytes;
    }

    [Serializable]
    public sealed class StationFinishExportDocument {
        public int version;
        public string generatedBy;
        public string colorSpace;
        public string fallback;
        public string rampSoffit;
        public float metresPerTile;
        public long seed;
        public StationFinishFaceDefault[] defaults;
        public StationFinishPaletteGroup[] paletteGroups;
        public StationFinishEntry[] finishes;
    }

    /// <summary>Everything a caller may ask about one finish, without touching Unity objects.</summary>
    public readonly struct StationFinishFacts {
        public readonly string Id;
        public readonly string BaseId;
        public readonly string Label;
        public readonly string Family;
        public readonly string Look;
        public readonly Color Tint;
        public readonly float Roughness;
        public readonly float Metalness;
        public readonly float RepeatU;
        public readonly float RepeatV;
        public readonly float MetresPerTile;
        public readonly bool DoubleSided;
        public readonly bool Known;
        public readonly bool Tintable;
        public readonly bool HasNeutralDetail;

        public StationFinishFacts(string id, string baseId, string label, string family, string look, Color tint,
            float roughness, float metalness, float repeatU, float repeatV, float metresPerTile,
            bool doubleSided, bool known, bool tintable, bool hasNeutralDetail) {
            Id = id; BaseId = baseId; Label = label; Family = family; Look = look; Tint = tint;
            Roughness = roughness; Metalness = metalness; RepeatU = repeatU; RepeatV = repeatV;
            MetresPerTile = metresPerTile; DoubleSided = doubleSided; Known = known;
            Tintable = tintable; HasNeutralDetail = hasNeutralDetail;
        }

        public bool IsWall => Family == "wall";
        public bool IsCeiling => Family == "ceiling";
        public bool IsTrack => Family == "track";
    }

    /// <summary>
    /// The Unity-side finish library. One instance per loaded station; dispose it with
    /// the view root that used it.
    /// </summary>
    public sealed class StationFinishLibrary : IDisposable {
        public const string DefaultFallback = StationFinishIds.DefaultMaterial;
        public const string DefaultShaderName = "Universal Render Pipeline/Lit";
        /// <summary>The station's own finish shader (Resources): vertex AO + no environment reflections.</summary>
        public const string StationShaderName = "Metro/Station Finish";
        public const string StationShaderResource = "StationFinish";
        public const string Version = "1";

        static Shader resolvedShader;

        readonly Dictionary<string, StationFinishEntry> byId = new Dictionary<string, StationFinishEntry>(StringComparer.Ordinal);
        readonly Dictionary<string, Material> materials = new Dictionary<string, Material>(StringComparer.Ordinal);
        readonly Dictionary<string, Texture2D> textures = new Dictionary<string, Texture2D>(StringComparer.Ordinal);
        readonly List<Texture2D> ownedTextures = new List<Texture2D>();
        readonly List<Material> ownedMaterials = new List<Material>();
        readonly HashSet<string> unknown = new HashSet<string>(StringComparer.Ordinal);
        readonly List<string> diagnostics = new List<string>();
        readonly Dictionary<string, string> defaults = new Dictionary<string, string>(StringComparer.Ordinal);
        readonly List<StationFinishPaletteGroup> paletteGroups = new List<StationFinishPaletteGroup>();
        readonly Func<string, Texture2D> textureLoader;
        readonly bool ownsLoadedTextures;
        readonly Shader shader;

        StationFinishExportDocument document = new StationFinishExportDocument();

        StationFinishLibrary(string json, Func<string, Texture2D> loader, Shader shader, bool ownsLoadedTextures) {
            textureLoader = loader;
            this.shader = shader;
            this.ownsLoadedTextures = ownsLoadedTextures;
            if (!string.IsNullOrEmpty(json)) Read(json);
        }

        /* ------------------------------------------------------------ construction */

        /// <summary>
        /// Build from an export document. `textureLoader` receives the entry's albedo or
        /// detail path (`floor.granite.png`, `detail/wall.enamel.png`) and returns the
        /// texture; the caller owns those textures. Pass null for facts-only use.
        /// </summary>
        public static StationFinishLibrary FromJson(string json, Func<string, Texture2D> textureLoader, Shader shader = null) =>
            new StationFinishLibrary(json, textureLoader, shader ?? FindShader(), false);

        /// <summary>
        /// Load `finishes.json` and every PNG from a directory (the export directory, or
        /// a staged copy). The library owns the textures it creates.
        /// </summary>
        public static StationFinishLibrary LoadFromDirectory(string directory, Shader shader = null) {
            if (string.IsNullOrEmpty(directory)) throw new ArgumentNullException(nameof(directory));
            var manifest = Path.Combine(directory, "finishes.json");
            if (!File.Exists(manifest)) throw new FileNotFoundException($"finish export missing: {manifest}", manifest);
            var json = File.ReadAllText(manifest);
            StationFinishLibrary library = null;
            library = new StationFinishLibrary(json, path => {
                var full = Path.Combine(directory, path.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(full)) {
                    library?.Note($"finish-texture-missing: {path}");
                    return null;
                }
                return DecodePng(File.ReadAllBytes(full), path);
            }, shader ?? FindShader(), true);
            return library;
        }

        void Note(string message) => diagnostics.Add(message);

        /// <summary>
        /// Load the staged copies a build ships: `Resources/&lt;folder&gt;/finishes.json`
        /// (a TextAsset) and `Resources/&lt;folder&gt;/&lt;name&gt;` textures. Stage them with
        /// `export-station-finishes.mjs --stage Assets/Resources/StationFinishes`.
        /// </summary>
        public static StationFinishLibrary LoadFromResources(string folder, Shader shader = null) {
            if (string.IsNullOrEmpty(folder)) throw new ArgumentNullException(nameof(folder));
            var asset = Resources.Load<TextAsset>($"{folder}/finishes");
            if (asset == null) throw new FileNotFoundException($"finish export missing: Resources/{folder}/finishes.json");
            return new StationFinishLibrary(asset.text, path => {
                var name = Path.GetFileNameWithoutExtension(path);
                var sub = path.StartsWith("detail/", StringComparison.Ordinal) ? "detail/" : string.Empty;
                return Resources.Load<Texture2D>($"{folder}/{sub}{name}");
            }, shader ?? FindShader(), false);
        }

        /// <summary>
        /// The station finish shader. It lives in `Resources/StationFinish.shader` so the
        /// player always ships it (a shader found only by name can be stripped from a
        /// build), and it consumes the mesher's vertex AO exactly like the source's
        /// `vertexColors: true`. Falls back to URP/Lit so a project without the staged
        /// shader still draws (without AO) instead of failing.
        /// </summary>
        public static Shader FindShader() {
            if (resolvedShader != null) return resolvedShader;
            if (System.Environment.GetEnvironmentVariable("METRO_FINISH_LIT") == "1") {
                resolvedShader = Shader.Find(DefaultShaderName);
                return resolvedShader;
            }
            if (Shader.Find(StationShaderName) != null) {
                resolvedShader = Shader.Find(StationShaderName);
                return resolvedShader;
            }
            var staged = Resources.Load<Shader>(StationShaderResource);
            if (staged != null) {
                resolvedShader = staged;
                return resolvedShader;
            }
            resolvedShader = Shader.Find(DefaultShaderName);
            return resolvedShader;
        }

        static Texture2D DecodePng(byte[] bytes, string name) {
            // linear:false = sRGB. The PNGs are authored in sRGB exactly as the browser
            // canvas textures are (`colorSpace = SRGBColorSpace`).
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, true, false) { name = "finish " + name };
            if (!texture.LoadImage(bytes)) {
                UnityEngine.Object.Destroy(texture);
                throw new InvalidDataException($"finish texture is not a readable PNG: {name}");
            }
            texture.Apply(true, false);
            return texture;
        }

        /* ---------------------------------------------------------------- accessors */

        public Shader Shader => shader;
        public string FallbackId => string.IsNullOrEmpty(document.fallback) ? DefaultFallback : document.fallback;
        public string RampSoffitId => string.IsNullOrEmpty(document.rampSoffit) ? "ceil.steel" : document.rampSoffit;
        public IReadOnlyList<StationFinishPaletteGroup> PaletteGroups => paletteGroups;
        public IReadOnlyCollection<string> UnknownFinishIds => unknown;
        public IReadOnlyList<string> Diagnostics => diagnostics;
        public int FinishCount => byId.Count;
        public int MaterialCount => materials.Count;
        public int TextureCount => textures.Count;

        public IEnumerable<string> Ids {
            get {
                foreach (var entry in document.finishes ?? Array.Empty<StationFinishEntry>()) yield return entry.id;
            }
        }

        public string DefaultFinishFor(StationFace face) {
            var name = StationFaces.Name(face);
            return defaults.TryGetValue(name, out var id) ? id : FallbackId;
        }

        /// <summary>Whether the id (or its custom-tint base) is in the exported library.</summary>
        public bool IsKnown(string id) {
            if (string.IsNullOrEmpty(id)) return false;
            return byId.ContainsKey(id) || byId.ContainsKey(StationFinishIds.BaseId(id));
        }

        public bool TryGetFacts(string id, out StationFinishFacts facts) {
            var resolved = Resolve(id);
            facts = resolved.Facts;
            return resolved.Known;
        }

        /// <summary>The facts for an id, resolving a custom tint to its base and an unknown id to the fallback.</summary>
        public StationFinishFacts Facts(string id) => Resolve(id).Facts;

        /// <summary>The material for a finish id (cached). Throws if the library has no shader.</summary>
        public Material For(string id) {
            if (string.IsNullOrEmpty(id)) id = FallbackId;
            if (materials.TryGetValue(id, out var cached)) return cached;
            var resolved = Resolve(id);
            var material = CreateMaterial(resolved);
            materials[id] = material;
            ownedMaterials.Add(material);
            return material;
        }

        public bool IsWall(string id) => Facts(id).IsWall;

        /* -------------------------------------------------------------- resolution */

        sealed class Resolved {
            public StationFinishEntry Entry;
            public string RequestedId;
            public bool Known;
            public bool Exact;
            public Texture2D Albedo;
            public Texture2D Detail;
            public Color BaseColor = Color.white;
            public StationFinishFacts Facts;
        }

        Resolved Resolve(string id) {
            var requested = id ?? FallbackId;
            var resolved = new Resolved { RequestedId = requested };
            if (byId.TryGetValue(requested, out var exact)) {
                // Stock finish, or a custom tint the export already rendered.
                resolved.Entry = exact;
                resolved.Known = true;
                resolved.Exact = true;
                resolved.Albedo = Texture(exact.albedo, exact);
                resolved.Facts = FactsOf(exact, requested, known: true);
                return resolved;
            }
            var baseId = StationFinishIds.BaseId(requested);
            var tint = StationFinishIds.Tint(requested);
            if (tint >= 0 && byId.TryGetValue(baseId, out var baseEntry)) {
                resolved.Entry = baseEntry;
                resolved.Known = true;
                resolved.Facts = FactsOf(baseEntry, requested, known: true);
                if (baseEntry.neutral && !string.IsNullOrEmpty(baseEntry.detail)) {
                    // The white-base map is the source artwork without a colour, so the
                    // painted colour multiplies straight onto it: a red enamel panel.
                    resolved.Detail = Texture(baseEntry.detail, baseEntry);
                    resolved.Albedo = resolved.Detail;
                    resolved.BaseColor = FromHex(tint);
                } else {
                    // No neutral map: keep the stock artwork and scale the stock tint
                    // toward the painted colour (documented approximation).
                    resolved.Albedo = Texture(baseEntry.albedo, baseEntry);
                    var stock = ParseHex(baseEntry.tint, 0x808080);
                    resolved.BaseColor = new Color(
                        stock.r > 0.001f ? Mathf.Clamp(FromHex(tint).r / stock.r, 0f, 8f) : 1f,
                        stock.g > 0.001f ? Mathf.Clamp(FromHex(tint).g / stock.g, 0f, 8f) : 1f,
                        stock.b > 0.001f ? Mathf.Clamp(FromHex(tint).b / stock.b, 0f, 8f) : 1f);
                    diagnostics.Add($"finish-tint-approximated: {requested} has no neutral detail map; material uses a colour ratio");
                }
                return resolved;
            }
            // Unknown ids stay in the document; the view reports them and draws the
            // documented fallback. Never a solid colour invented for the id.
            var fallback = byId.TryGetValue(FallbackId, out var fallbackEntry) ? fallbackEntry : null;
            resolved.Entry = fallback;
            resolved.Known = false;
            resolved.Facts = fallback != null
                ? FactsOf(fallback, requested, known: false)
                : new StationFinishFacts(requested, requested, requested, "floor", "concrete", Color.grey, 0.78f, 0.02f, 1, 1, 1, false, false, false, false);
            if (fallback != null) resolved.Albedo = Texture(fallback.albedo, fallback);
            if (unknown.Add(requested)) diagnostics.Add($"unknown-finish: '{requested}' is not in the exported library; drawn with '{FallbackId}' and kept in the document");
            return resolved;
        }

        StationFinishFacts FactsOf(StationFinishEntry entry, string requested, bool known) {
            // A custom tint's own colour wins over the base's stock tint.
            var tint = StationFinishIds.Tint(requested);
            return new StationFinishFacts(
                requested,
                string.IsNullOrEmpty(entry.baseId) ? entry.id : entry.baseId,
                entry.label ?? entry.id,
                entry.family ?? "floor",
                entry.look ?? "concrete",
                ParseHex(tint >= 0 ? StationFinishIds.Hex(tint) : entry.tint, 0x8d9299),
                entry.roughness,
                entry.metalness,
                entry.repeatU <= 0 ? 1 : entry.repeatU,
                entry.repeatV <= 0 ? 1 : entry.repeatV,
                entry.metresPerTile <= 0 ? 1 : entry.metresPerTile,
                entry.doubleSided,
                known,
                entry.neutral,
                entry.neutral);
        }

        Texture2D Texture(string path, StationFinishEntry entry) {
            if (string.IsNullOrEmpty(path) || textureLoader == null) return null;
            if (textures.TryGetValue(path, out var cached)) return cached;
            var texture = textureLoader(path);
            if (texture == null) {
                diagnostics.Add($"finish-texture-missing: {path} ({entry?.id})");
                return null;
            }
            // Validate the two import properties the source's `tex()` sets for every
            // finish: repeat wrap and sRGB. Both are fixed up here rather than trusted,
            // so a mis-imported PNG cannot change how a finish tiles or reads.
            if (texture.wrapMode != TextureWrapMode.Repeat) {
                diagnostics.Add($"finish-wrap-fixed: {path} was {texture.wrapMode}, expected Repeat");
                texture.wrapMode = TextureWrapMode.Repeat;
            }
            texture.filterMode = FilterMode.Trilinear;
            texture.anisoLevel = 4;
            if (entry != null && entry.width > 0 && (texture.width != entry.width || texture.height != entry.height)) {
                diagnostics.Add($"finish-size-mismatch: {path} is {texture.width}x{texture.height}, export says {entry.width}x{entry.height}");
            }
            var format = texture.graphicsFormat.ToString();
            if (!format.Contains("SRGB")) diagnostics.Add($"finish-colorspace: {path} is {format}, expected an sRGB format");
            textures[path] = texture;
            if (ownsLoadedTextures) ownedTextures.Add(texture);
            return texture;
        }

        Material CreateMaterial(Resolved resolved) {
            if (shader == null) throw new InvalidOperationException(
                $"StationFinishLibrary has no shader: pass '{DefaultShaderName}' (the project's station shader) or call StationFinishLibrary.FindShader()");
            var material = new Material(shader) { name = "finish " + resolved.RequestedId };
            const string baseMap = "_BaseMap";
            if (resolved.Albedo != null) {
                material.mainTexture = resolved.Albedo;
                if (material.HasProperty(baseMap)) {
                    material.SetTexture(baseMap, resolved.Albedo);
                    material.SetTextureScale(baseMap, new Vector2(resolved.Facts.RepeatU, resolved.Facts.RepeatV));
                }
            }
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", resolved.BaseColor);
            else material.color = resolved.BaseColor;
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", resolved.Facts.Metalness);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", Mathf.Clamp01(1f - resolved.Facts.Roughness));
            if (material.HasProperty("_SmoothnessTextureChannel")) material.SetFloat("_SmoothnessTextureChannel", 0f);
            // The source supplies no environment map (`lightRig.ts` adds lights only), so a
            // metallic finish must not pick up the Unity skybox as a reflection.
            material.EnableKeyword("_ENVIRONMENTREFLECTIONS_OFF");
            if (resolved.Facts.DoubleSided) {
                // `side: DoubleSide` for the ceiling family in `finishMaterial` - the
                // grille / metal / steel soffit reads from below.
                if (material.HasProperty("_Cull")) material.SetFloat("_Cull", 0f);
                material.doubleSidedGI = true;
            }
            material.enableInstancing = true;
            return material;
        }

        /* ------------------------------------------------------------------ loading */

        void Read(string json) {
            document = JsonUtility.FromJson<StationFinishExportDocument>(json);
            if (document == null) throw new InvalidDataException("finishes.json did not parse");
            if (document.version != 1) diagnostics.Add($"finish-export-version: {document.version}, expected 1");
            byId.Clear();
            foreach (var entry in document.finishes ?? Array.Empty<StationFinishEntry>()) {
                if (entry == null || string.IsNullOrEmpty(entry.id)) continue;
                byId[entry.id] = entry;
            }
            defaults.Clear();
            foreach (var item in document.defaults ?? Array.Empty<StationFinishFaceDefault>()) {
                if (item == null || string.IsNullOrEmpty(item.face)) continue;
                defaults[item.face] = item.id;
            }
            paletteGroups.Clear();
            foreach (var group in document.paletteGroups ?? Array.Empty<StationFinishPaletteGroup>()) {
                if (group != null) paletteGroups.Add(group);
            }
            if (string.IsNullOrEmpty(document.fallback)) document.fallback = DefaultFallback;
            if (!byId.ContainsKey(document.fallback)) diagnostics.Add($"finish-fallback-missing: {document.fallback} is not in the library");
        }

        /* -------------------------------------------------------------------- utils */

        static Color FromHex(int rgb) => new Color(
            ((rgb >> 16) & 0xFF) / 255f, ((rgb >> 8) & 0xFF) / 255f, (rgb & 0xFF) / 255f, 1f);

        static Color ParseHex(string hex, int fallback) =>
            StationFinishIds.TryParseHex(hex, out var value) ? FromHex(value) : FromHex(fallback);

        /// <summary>A one-line diagnostics summary for the host's report.</summary>
        public string DiagnosticsSummary() {
            if (diagnostics.Count == 0) return "finishes: ok";
            return "finishes: " + diagnostics.Count.ToString(CultureInfo.InvariantCulture) + " diagnostic(s) - " + string.Join("; ", diagnostics);
        }

        /// <summary>`Destroy` in play mode, `DestroyImmediate` in the editor (EditMode tests, staged worlds).</summary>
        static void Destroy(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }

        public void Dispose() {
            foreach (var material in ownedMaterials) if (material) Destroy(material);
            ownedMaterials.Clear();
            materials.Clear();
            foreach (var texture in ownedTextures) if (texture) Destroy(texture);
            ownedTextures.Clear();
            textures.Clear();
            byId.Clear();
            paletteGroups.Clear();
            defaults.Clear();
        }
    }
}
