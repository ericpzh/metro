using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.CompilerServices;
using Metro.Build;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// 18 §2 / 20 §2 — a printed surface shows a **Unity** picture, upright and cropped once.
    ///
    /// Every promoted `billboard-*` prefab carries exactly one printed surface, material
    /// `billboardPoster`, whose baked texture is the empty review document's sample — which
    /// is why 97 billboards across 37 authored slugs all repeated the same advertisement.
    /// The televisions print into `tvContentWindow` and the line maps into
    /// `lineMapPlaceholder`, the same way.
    ///
    /// **The glTF V flip.** glTF stores V with the image's top at 1; glTFast converts the
    /// accessor to `1 − V` on import, so the promoted plates carry the physical top at
    /// V ≈ 0 while a standalone Unity PNG puts its own top at V = 1. Assigning a
    /// `Resources` texture to those UVs prints the poster upside down, and an additional
    /// centred crop was applied on top of an already cropped mesh (20 §2). The fix is a
    /// **canonical frame**: the plate's own printed face (its averaged normal) and the
    /// physical up of the node it hangs in define a right axis, every vertex is projected
    /// into that frame, and the resulting U/V run left→right and bottom→top *as seen from
    /// the face*. That is derived from the geometry, so it is correct for the back face of
    /// a paired television and for a wall board turned to any of the four quarter turns, and
    /// it is computed **once** per (source mesh, up basis): the authored mesh is never
    /// mutated, and every later crop starts from the canonical copy.
    ///
    /// The billboard plate is **static**: a billboard changes only with a document edit,
    /// which rebuilds the view and repaints from the new `cfg.poster` — no wall clock is
    /// read, so a paused station cannot flicker.
    /// </summary>
    public static class StationDisplayArtwork {
        /// <summary>The exported printed surface's material name (all nine billboard variants).</summary>
        public const string PosterTag = "billboardPoster";
        /// <summary>The instance material a bound printed surface wears (`display print <slug>`).</summary>
        public const string PrintTag = "display print";
        public const string PosterResources = "Posters/";
        public const string LedgerPrefix = "billboard-poster:";

        /// <summary>One world's bound billboards: the instance materials it owns and its ledger.</summary>
        public sealed class Scope : MonoBehaviour {
            public readonly List<string> Notes = new List<string>();
            public readonly Dictionary<string, Material> Materials = new Dictionary<string, Material>(StringComparer.Ordinal);
            /// <summary>The cropped plate meshes this world owns (one per canonical plate + window).</summary>
            public readonly Dictionary<string, Mesh> Meshes = new Dictionary<string, Mesh>(StringComparer.Ordinal);
            public int Bound;
            public string LastError = "";
            /// <summary>The scene's bound typeface: the television plate painter draws with it.</summary>
            public Font Font;
            /// <summary>The shell's print locale (`exit.locale`'s sibling, `display.locale`).</summary>
            public string Locale = "zh-CN";
            /// <summary>The canonical (upright) plate copies this world owns.</summary>
            internal readonly List<Mesh> Canonicals = new List<Mesh>();
            /// <summary>The painted plate textures this world owns (a television's board).</summary>
            internal readonly List<Texture> Textures = new List<Texture>();
            /// <summary>Painted plate textures by content key, so two faces share one board.</summary>
            internal readonly Dictionary<string, Texture> PlateTextures =
                new Dictionary<string, Texture>(StringComparer.Ordinal);
            /// <summary>Shared digital clock texture and reusable CPU pixel buffer for this world.</summary>
            internal Texture2D SharedDigitalClockTexture;
            internal Color32[] SharedDigitalClockBuffer;
            internal string SharedDigitalClockKey = "";
            /// <summary>Round-robin cursor for fair budgeted TV plate updates across frames.</summary>
            internal int TvTickCursor;
            /// <summary>The printed surfaces this world resolved, one per renderer (20 §2).</summary>
            public readonly List<UprightSurface> Surfaces = new List<UprightSurface>();
            /// <summary>The canonical frames, one per (source mesh, up basis).</summary>
            internal readonly List<PlateBasis> Bases = new List<PlateBasis>();
        }

        /// <summary>
        /// One printed surface in its canonical frame: the authored mesh is kept untouched at
        /// <see cref="Source"/>, <see cref="Canonical"/> is the upright copy every crop starts
        /// from, and <see cref="Panel"/> is the printed panel's real size in metres (measured
        /// in that frame, so a turned or double-faced plate is measured the way it reads).
        /// </summary>
        public sealed class UprightSurface {
            public MeshRenderer Renderer;
            public MeshFilter Filter;
            public Mesh Source;
            /// <summary>The authored material this surface was found with (the print template).</summary>
            public Material Template;
            public Mesh Canonical;
            public Vector2 Panel;
            /// <summary>How the UVs were derived, for the binding report.</summary>
            public string Basis = "";
            /// <summary>The source mesh identity and up basis this surface belongs to.</summary>
            public string Key = "";
            /// <summary>The canonical frame in the plate's own mesh space.</summary>
            public Vector3 FrameRight = Vector3.right, FrameUp = Vector3.up, FrameNormal = Vector3.forward;
            /// <summary>The printed panel's centre in that frame, mesh space.</summary>
            public Vector3 PanelCentre;
            /// <summary>True when the image's top lands at the physical top edge.</summary>
            public bool Upright;
            /// <summary>True when the baked U ran right→left and was corrected.</summary>
            public bool MirrorCorrected;
            /// <summary>True when the baked V ran top→bottom and was corrected.</summary>
            public bool FlipCorrected;
        }

        internal sealed class PlateBasis {
            public int Id;
            public Mesh Source;
            /// <summary>The authored material this surface was found with (the print template).</summary>
            public Material Template;
            public Vector3 Up;
            public Mesh Canonical;
            public Vector2 Panel;
            public string Basis = "";
            public bool Upright, Mirror, Flip;
            public Vector3 Right = Vector3.right, PlateUp = Vector3.up, Normal = Vector3.forward;
            public Vector3 Centre;
        }

        public static Scope CreateScope(Transform parent) {
            var go = new GameObject("display artwork");
            if (parent != null) go.transform.SetParent(parent, false);
            return go.AddComponent<Scope>();
        }

        public static void ReleaseScope(Scope scope) {
            if (scope == null) return;
            StationDisplayTvArtwork.ReleaseScope(scope);
            StationClockArtwork.ReleaseScope(scope);
            foreach (var material in scope.Materials.Values) {
                if (material) SafeDestroy(material);
            }
            scope.Materials.Clear();
            foreach (var mesh in scope.Meshes.Values) {
                if (mesh) SafeDestroy(mesh);
            }
            scope.Meshes.Clear();
            foreach (var mesh in scope.Canonicals) {
                if (mesh) SafeDestroy(mesh);
            }
            scope.Canonicals.Clear();
            foreach (var texture in scope.Textures) {
                if (texture is RenderTexture rt && rt.IsCreated()) rt.Release();
                if (texture) SafeDestroy(texture);
            }
            scope.Textures.Clear();
            scope.PlateTextures.Clear();
            scope.SharedDigitalClockTexture = null;
            scope.SharedDigitalClockBuffer = null;
            scope.SharedDigitalClockKey = "";
            scope.Surfaces.Clear();
            scope.Bases.Clear();
            if (scope.gameObject) SafeDestroy(scope.gameObject);
        }

        /* --------------------------------------------------- canonical upright frame */

        /// <summary>
        /// Resolve one printed surface's canonical frame and install the upright copy. Idempotent
        /// per renderer: a television's window is resolved once and re-pointed at each new
        /// poster, never re-canonicalised (which is what applied a second crop, 20 §2).
        /// </summary>
        public static UprightSurface BindUprightArtwork(Scope scope, MeshRenderer renderer) {
            if (scope == null || renderer == null) return null;
            for (int i = 0; i < scope.Surfaces.Count; i++) {
                var known = scope.Surfaces[i];
                if (known != null && ReferenceEquals(known.Renderer, renderer)) return known;
            }
            var filter = renderer.GetComponent<MeshFilter>();
            if (filter == null || filter.sharedMesh == null) return null;
            var source = filter.sharedMesh;
            var up = PhysicalUp(renderer.transform);
            var basis = BasisFor(scope, source, up, renderer.transform);
            if (basis == null) return null;
            var surface = new UprightSurface {
                Renderer = renderer, Filter = filter, Source = source, Canonical = basis.Canonical,
                Template = renderer.sharedMaterial,
                Panel = basis.Panel, Basis = basis.Basis, Key = KeyOf(source, up) + "#b" + basis.Id,
                Upright = basis.Upright, MirrorCorrected = basis.Mirror, FlipCorrected = basis.Flip,
                FrameRight = basis.Right, FrameUp = basis.PlateUp, FrameNormal = basis.Normal,
                PanelCentre = basis.Centre,
            };
            // The immutable source stays on the surface; the filter takes the canonical copy so
            // the plate is at least upright even before a slug resolves.
            filter.sharedMesh = basis.Canonical;
            scope.Surfaces.Add(surface);
            return surface;
        }

        /// <summary>The node's physical up in the printed mesh's own frame.</summary>
        static Vector3 PhysicalUp(Transform node) {
            if (node == null) return Vector3.up;
            var up = node.InverseTransformDirection(Vector3.up);
            return up.sqrMagnitude < 1e-10f ? Vector3.up : up.normalized;
        }

        /// <summary>A cache key that survives a prefab clone: the mesh's identity plus its up basis.</summary>
        static string KeyOf(Mesh source, Vector3 up) =>
            (source != null ? source.name : "mesh") + "#" + source.vertexCount + "#" +
            up.x.ToString("0.###", CultureInfo.InvariantCulture) + "," +
            up.y.ToString("0.###", CultureInfo.InvariantCulture) + "," +
            up.z.ToString("0.###", CultureInfo.InvariantCulture);

        static PlateBasis BasisFor(Scope scope, Mesh source, Vector3 up, Transform node) {
            for (int i = 0; i < scope.Bases.Count; i++) {
                var known = scope.Bases[i];
                if (known == null || !ReferenceEquals(known.Source, source)) continue;
                if ((known.Up - up).sqrMagnitude > 1e-6f) continue;
                return known;
            }
            var basis = Canonicalise(source, up, node);
            if (basis == null) return null;
            basis.Id = scope.Bases.Count;
            scope.Bases.Add(basis);
            if (basis.Canonical != null) scope.Canonicals.Add(basis.Canonical);
            return basis;
        }

        /// <summary>
        /// Derive the canonical frame: face normal from the mesh's own normals, physical up from
        /// the node, right = up × normal (the viewer's right for a plate facing `normal`). A
        /// degenerate plate — no normals, or two opposite faces cancelling — keeps its baked UVs
        /// with the physical-up V correction, exactly as the exit plates do.
        /// </summary>
        static PlateBasis Canonicalise(Mesh source, Vector3 up, Transform node) {
            var basis = new PlateBasis { Source = source, Up = up };
            var vertices = source.vertices;
            var uv = source.uv;
            var normals = source.normals;
            if (vertices.Length == 0 || uv == null || uv.Length != vertices.Length) {
                basis.Canonical = Copy(source, " upright");
                basis.Panel = PanelOf(source.bounds.size);
                basis.Basis = "baked:no-uv";
                basis.Upright = false;
                return basis;
            }
            var normal = Vector3.zero;
            for (int i = 0; i < normals.Length; i++) normal += normals[i];
            bool planar = normal.sqrMagnitude > 1e-6f * Mathf.Max(1, normals.Length);
            if (!planar && node != null) {
                // Two opposite printed faces sharing one mesh: the averaged normal cancels. The
                // baked UVs are the only frame that addresses both, so flip V by physical up.
                var upright = StationExitArtwork.BuildUprightPlate(source, node, out var note, out bool top);
                basis.Canonical = upright;
                basis.Panel = PanelOf(source.bounds.size);
                basis.Basis = "baked:" + note;
                basis.Upright = top;
                basis.Flip = note.IndexOf("v-flipped", StringComparison.Ordinal) >= 0;
                return basis;
            }
            if (!planar) normal = Vector3.forward;
            normal.Normalize();
            var planeUp = up - normal * Vector3.Dot(up, normal);
            if (planeUp.sqrMagnitude < 1e-8f) {
                basis.Canonical = Copy(source, " upright");
                basis.Panel = PanelOf(source.bounds.size);
                basis.Basis = "baked:no-up";
                return basis;
            }
            planeUp.Normalize();
            // In Unity's left-handed frame, `normal × planeUp` points to the viewer's right when
            // looking against `normal` (e.g. normal = (0,0,-1), planeUp = (0,1,0) => (+1,0,0)).
            // If the node hierarchy carries an odd number of negative scale axes, flip handedness.
            float handedness = 1f;
            if (node != null) {
                var lossy = node.lossyScale;
                if (lossy.x * lossy.y * lossy.z < 0f) handedness = -1f;
            }
            var right = Vector3.Cross(normal, planeUp) * handedness;
            if (right.sqrMagnitude < 1e-8f) {
                basis.Canonical = Copy(source, " upright");
                basis.Panel = PanelOf(source.bounds.size);
                basis.Basis = "baked:no-right";
                return basis;
            }
            right.Normalize();

            float uMin = float.MaxValue, uMax = float.MinValue, vMin = float.MaxValue, vMax = float.MinValue;
            int left = 0, rightMost = 0, bottom = 0, topVertex = 0;
            for (int i = 0; i < vertices.Length; i++) {
                float u = Vector3.Dot(vertices[i], right);
                float v = Vector3.Dot(vertices[i], planeUp);
                if (u < uMin) { uMin = u; left = i; }
                if (u > uMax) { uMax = u; rightMost = i; }
                if (v < vMin) { vMin = v; bottom = i; }
                if (v > vMax) { vMax = v; topVertex = i; }
            }
            float uSpan = uMax - uMin, vSpan = vMax - vMin;
            if (uSpan < 1e-6f || vSpan < 1e-6f) {
                basis.Canonical = Copy(source, " upright");
                basis.Panel = PanelOf(source.bounds.size);
                basis.Basis = "baked:degenerate";
                return basis;
            }
            var mapped = new Vector2[vertices.Length];
            for (int i = 0; i < vertices.Length; i++) {
                mapped[i] = new Vector2((Vector3.Dot(vertices[i], right) - uMin) / uSpan,
                    (Vector3.Dot(vertices[i], planeUp) - vMin) / vSpan);
            }
            // What the export had done, so the binding report can say it was corrected.
            bool mirror = uv[rightMost].x < uv[left].x;
            bool flip = uv[topVertex].y < uv[bottom].y;
            var mesh = Copy(source, " upright");
            mesh.uv = mapped;
            mesh.RecalculateBounds();
            basis.Canonical = mesh;
            basis.Panel = new Vector2(uSpan, vSpan);
            basis.Upright = true;
            basis.Mirror = mirror;
            basis.Flip = flip;
            basis.Right = right;
            basis.PlateUp = planeUp;
            basis.Normal = normal;
            basis.Centre = right * ((uMin + uMax) * .5f) + planeUp * ((vMin + vMax) * .5f);
            basis.Basis = "physical-up " + (flip ? "v-flipped" : "v-baked") + " " +
                (mirror ? "u-mirrored" : "u-baked") +
                " panel=" + uSpan.ToString("0.###", CultureInfo.InvariantCulture) + "x" +
                vSpan.ToString("0.###", CultureInfo.InvariantCulture);
            return basis;
        }

        static Mesh Copy(Mesh source, string suffix) {
            var mesh = UnityEngine.Object.Instantiate(source);
            mesh.name = source.name + suffix;
            return mesh;
        }

        static Vector2 PanelOf(Vector3 size) =>
            new Vector2(Mathf.Max(.1f, Mathf.Max(size.x, size.z)), Mathf.Max(.1f, size.y));

        /* ------------------------------------------------------------- binding */

        /// <summary>Bind one placed billboard to its saved slug. False with a ledger reason on failure.</summary>
        public static bool BindBillboard(Scope scope, GameObject root, ModuleFacts module) =>
            BindBillboard(scope, null, root, module);

        /// <summary>
        /// Bind one placed billboard to its saved slug and let the world adopt the bound
        /// material as the part's authored base, so a later Base pass restores the poster rather
        /// than the baked sample (20 §1).
        /// </summary>
        public static bool BindBillboard(Scope scope, Metro.App.StationWorldView world, GameObject root, ModuleFacts module) {
            if (scope == null || root == null || module == null) return false;
            var renderer = FindPosterRenderer(root);
            if (renderer == null) {
                scope.Notes.Add("billboard-poster-unresolved:" + module.Id + ":no-poster-surface");
                return false;
            }
            var slug = module.Config.Text("poster");
            if (slug.Length == 0) {
                scope.Notes.Add("billboard-poster-unresolved:" + module.Id + ":no-slug");
                return false;
            }
            var surface = BindUprightArtwork(scope, renderer);
            if (surface == null) {
                scope.Notes.Add("billboard-poster-unresolved:" + module.Id + ":no-plate-mesh");
                return false;
            }
            if (!PaintUpright(scope, surface, slug)) {
                scope.Notes.Add("billboard-poster-missing:" + module.Id + ":" + slug);
                return false;
            }
            world?.RecaptureArtwork(renderer);
            scope.Bound++;
            scope.Notes.Add(LedgerPrefix + module.Id + ":" + slug + ":key=" + ContentKey(slug, surface.Panel) +
                ":" + surface.Basis + (surface.Upright ? "" : ":NOT-UPRIGHT"));
            return true;
        }

        /// <summary>
        /// Print a slug on a resolved surface: one instance material for the poster and one
        /// cropped mesh cut from the canonical plate. Both are cached by content, so two
        /// surfaces printing the same poster at the same size share one allocation.
        /// </summary>
        public static bool PaintUpright(Scope scope, UprightSurface surface, string slug) =>
            PaintUpright(scope, surface, slug, PlateFit.Crop);

        /// <summary>Print a slug on a resolved surface under one fit rule.</summary>
        public static bool PaintUpright(Scope scope, UprightSurface surface, string slug, PlateFit fit) {
            if (scope == null || surface == null || surface.Renderer == null) return false;
            var texture = Poster(slug);
            if (texture == null) return false;
            return Paint(scope, surface, texture, fit);
        }

        /// <summary>Print an already-loaded texture on a resolved surface.</summary>
        public static bool Paint(Scope scope, UprightSurface surface, Texture2D texture, PlateFit fit) {
            if (scope == null || surface == null || surface.Renderer == null || texture == null) return false;
            var material = MaterialFor(scope, surface, texture);
            var mesh = PlateMesh(scope, surface, texture, fit);
            if (material == null || mesh == null) return false;
            surface.Renderer.material = material;
            surface.Filter.sharedMesh = mesh;
            return true;
        }

        /// <summary>
        /// The cropped plate mesh for one surface printing a texture of this aspect: the
        /// canonical UVs are scaled once into the source's centred window
        /// (`render/panelUv.ts:panelUvWindow`), so the poster is cropped to its panel and never
        /// stretched. Keyed by the surface identity and the window, never by mesh name alone.
        /// </summary>
        public static Mesh CroppedMesh(Scope scope, UprightSurface surface, Texture2D texture) {
            if (scope == null || surface == null || texture == null || surface.Canonical == null) return null;
            var window = UvWindow(texture.width, texture.height, surface.Panel);
            string key = surface.Key + "|" + WindowKey(window);
            if (scope.Meshes.TryGetValue(key, out var cached) && cached) return cached;
            var mesh = CropUvs(surface.Canonical, window);
            if (mesh == null) return null;
            mesh.name = surface.Canonical.name + " " + texture.name + " window";
            scope.Meshes[key] = mesh;
            return mesh;
        }

        static string WindowKey(Vector4 window) =>
            window.x.ToString("0.####", CultureInfo.InvariantCulture) + "," +
            window.y.ToString("0.####", CultureInfo.InvariantCulture) + "," +
            window.z.ToString("0.####", CultureInfo.InvariantCulture) + "," +
            window.w.ToString("0.####", CultureInfo.InvariantCulture);

        /// <summary>
        /// How a supplied poster meets its panel. `Crop` keeps the panel's own aspect and cuts a
        /// centred window out of the image (`panelUvWindow`, what a billboard and the network
        /// posters use); `Contain` keeps the **whole** image visible and shrinks the printed quad
        /// to the image's own aspect, which is what `render/lineMapArt.ts:face` builds for the six
        /// filled city maps — the board's housing shows around the poster instead of a crop.
        /// </summary>
        public enum PlateFit { Crop, Contain }

        /// <summary>The plate mesh for one surface printing `texture` under one fit rule.</summary>
        public static Mesh PlateMesh(Scope scope, UprightSurface surface, Texture2D texture, PlateFit fit) {
            if (scope == null || surface == null || texture == null) return null;
            if (fit == PlateFit.Crop) return CroppedMesh(scope, surface, texture);
            float imageAspect = Mathf.Max(1e-4f, texture.width) / Mathf.Max(1e-4f, texture.height);
            float panelAspect = Mathf.Max(1e-4f, surface.Panel.x) / Mathf.Max(1e-4f, surface.Panel.y);
            string key = surface.Key + "|contain|" + imageAspect.ToString("0.####", CultureInfo.InvariantCulture);
            if (scope.Meshes.TryGetValue(key, out var cached) && cached) return cached;
            var mesh = UnityEngine.Object.Instantiate(surface.Canonical);
            mesh.name = surface.Canonical.name + " contain";
            float scaleX = 1f, scaleY = 1f;
            if (imageAspect > panelAspect) scaleY = panelAspect / imageAspect;
            else if (imageAspect < panelAspect) scaleX = imageAspect / panelAspect;
            var vertices = mesh.vertices;
            var centre = surface.PanelCentre;
            for (int i = 0; i < vertices.Length; i++) {
                var offset = vertices[i] - centre;
                float along = Vector3.Dot(offset, surface.FrameRight) * scaleX;
                float up = Vector3.Dot(offset, surface.FrameUp) * scaleY;
                float normal = Vector3.Dot(offset, surface.FrameNormal);
                // In-plane only: a poster fitted to its own aspect still sits flush on its board.
                vertices[i] = centre + surface.FrameRight * along + surface.FrameUp * up + surface.FrameNormal * normal;
            }
            mesh.vertices = vertices;
            mesh.RecalculateBounds();
            scope.Meshes[key] = mesh;
            return mesh;
        }

        /// <summary>The promoted prefab's printed surface (`billboardPoster`).</summary>
        public static MeshRenderer FindPosterRenderer(GameObject root) {
            if (root == null) return null;
            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer) continue;
                foreach (var material in renderer.sharedMaterials) {
                    if (!material || material.name == null) continue;
                    if (material.name.IndexOf(PosterTag, StringComparison.OrdinalIgnoreCase) >= 0) return renderer;
                    // A plate this binder already printed keeps its identity: without this a
                    // second inspection fell through to the largest frame part and read the bezel.
                    if (material.name.IndexOf(PrintTag, StringComparison.OrdinalIgnoreCase) >= 0) return renderer;
                    // An importer may trim the shared prefix; the exported surface's own token
                    // is `poster`, and the plate's mesh/node carries it too.
                    if (material.name.IndexOf("poster", StringComparison.OrdinalIgnoreCase) >= 0) return renderer;
                }
                var node = renderer.transform != null ? renderer.transform.name : "";
                if (node.IndexOf("poster", StringComparison.OrdinalIgnoreCase) >= 0) return renderer;
            }
            // Two-material frames put the printed plate last; a billboard has no other
            // candidate, so the largest-area renderer is the plate when no tag survives.
            MeshRenderer best = null;
            float area = -1f;
            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer || !renderer.enabled) continue;
                var size = renderer.localBounds.size;
                float candidate = size.x * size.y + size.y * size.z + size.x * size.z;
                if (candidate <= area) continue;
                area = candidate;
                best = renderer;
            }
            return best;
        }

        static readonly Dictionary<string, Texture2D> loaded = new Dictionary<string, Texture2D>(StringComparer.Ordinal);
        static readonly HashSet<string> absent = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>
        /// The instance material for one surface printing a texture at this panel size. Keyed by
        /// the content and the **template** the surface was built with, so a billboard and a
        /// television plate of the same poster never share a shader they did not come with.
        /// </summary>
        public static Material MaterialFor(Scope scope, UprightSurface surface, Texture2D texture) {
            if (scope == null || surface == null || surface.Renderer == null || texture == null) return null;
            // A plate that has already been printed wears the print material, so the template must
            // be the one it was found with: keying by the current material minted a second instance
            // on every rebind and the plate drifted.
            var template = surface.Template != null ? surface.Template : surface.Renderer.sharedMaterial;
            if (!template) return null;
            string key = ContentKey(texture.name, surface.Panel) + "#" +
                RuntimeHelpers.GetHashCode(texture).ToString("x8", CultureInfo.InvariantCulture) + "#" +
                template.name + "#" +
                RuntimeHelpers.GetHashCode(template).ToString("x8", CultureInfo.InvariantCulture);
            if (scope.Materials.TryGetValue(key, out var material) && material) return material;
            material = CreateMaterial(template, texture);
            if (material == null) return null;
            scope.Materials[key] = material;
            return material;
        }

        /// <summary>The slug's texture, loaded once from the exported table (`Resources/Posters`).</summary>
        public static Texture2D Poster(string slug) {
            if (string.IsNullOrEmpty(slug)) return null;
            if (loaded.TryGetValue(slug, out var texture)) return texture;
            if (absent.Contains(slug)) return null;
            texture = Resources.Load<Texture2D>(PosterResources + slug);
            if (texture == null) {
                absent.Add(slug);
                return null;
            }
            loaded[slug] = texture;
            return texture;
        }

        /// <summary>The instance material's content key: the slug and the panel it is cut for.</summary>
        public static string ContentKey(string slug, Vector2 panel) =>
            slug + "@" + panel.x.ToString("0.###", CultureInfo.InvariantCulture) + "x" +
            panel.y.ToString("0.###", CultureInfo.InvariantCulture);

        /// <summary>
        /// `panelUvWindow`: the centred crop window of the image for this panel aspect, as a
        /// UV window in the image's own coordinates.
        /// </summary>
        public static Vector4 UvWindow(float imageWidth, float imageHeight, Vector2 panel) {
            float imageAspect = Mathf.Max(1e-4f, imageWidth) / Mathf.Max(1e-4f, imageHeight);
            float panelAspect = Mathf.Max(1e-4f, panel.x) / Mathf.Max(1e-4f, panel.y);
            float u0 = 0f, u1 = 1f, v0 = 0f, v1 = 1f;
            if (imageAspect > panelAspect) {
                float keep = panelAspect / imageAspect;
                u0 = (1f - keep) * .5f;
                u1 = u0 + keep;
            } else if (imageAspect < panelAspect) {
                float keep = imageAspect / panelAspect;
                v0 = (1f - keep) * .5f;
                v1 = v0 + keep;
            }
            return new Vector4(u0, u1, v0, v1);
        }

        /// <summary>The plate's own size in the placed instance's frame, metres.</summary>
        public static Vector2 PlateSize(MeshRenderer renderer) {
            if (!renderer) return new Vector2(2f, 1f);
            var size = renderer.localBounds.size;
            float width = Mathf.Max(.1f, Mathf.Max(size.x, size.z));
            float height = Mathf.Max(.1f, size.y);
            return new Vector2(width, height);
        }

        /// <summary>The poster texture a bound material carries, whichever slot its shader uses.</summary>
        public static Texture2D PosterTexture(Material material) {
            if (!material) return null;
            if (material.HasProperty("_BaseMap")) return material.GetTexture("_BaseMap") as Texture2D;
            if (material.HasProperty("baseColorTexture")) return material.GetTexture("baseColorTexture") as Texture2D;
            if (material.HasProperty("_MainTex")) return material.GetTexture("_MainTex") as Texture2D;
            return material.mainTexture as Texture2D;
        }

        /// <summary>
        /// The texture property a glTF-imported material exposes. `Shader Graphs/glTF-unlit`
        /// (the promoted display shader) exposes `baseColorTexture`; URP Lit exposes
        /// `_BaseMap`; anything else falls back to `_MainTex`.
        /// </summary>
        public static string TextureProperty(Material material) {
            if (!material) return null;
            if (material.HasProperty("_BaseMap")) return "_BaseMap";
            if (material.HasProperty("baseColorTexture")) return "baseColorTexture";
            if (material.HasProperty("_MainTex")) return "_MainTex";
            return null;
        }

        /// <summary>The texture a bound material carries (Texture2D or RenderTexture).</summary>
        public static Texture BoundTexture(Material material) {
            if (!material) return null;
            if (material.HasProperty("_BaseMap")) return material.GetTexture("_BaseMap");
            if (material.HasProperty("baseColorTexture")) return material.GetTexture("baseColorTexture");
            if (material.HasProperty("_MainTex")) return material.GetTexture("_MainTex");
            return material.mainTexture;
        }

        /// <summary>Point a material at a texture through whichever slot its shader has.</summary>
        public static void SetTexture(Material material, Texture texture) {
            if (!material) return;
            var property = TextureProperty(material);
            if (property != null) material.SetTexture(property, texture);
            else material.mainTexture = texture;
        }

        /// <summary>
        /// Reset the inherited map transform. The promoted plates carry a baked
        /// `*_ST`/`mainTextureScale` from the export; leaving it in place applies a second
        /// transform on top of the canonical crop (20 §2).
        /// </summary>
        public static void ResetTextureTransform(Material material) {
            if (!material) return;
            material.mainTextureScale = Vector2.one;
            material.mainTextureOffset = Vector2.zero;
            var property = TextureProperty(material);
            if (property != null && material.HasProperty(property + "_ST"))
                material.SetVector(property + "_ST", new Vector4(1f, 1f, 0f, 0f));
            foreach (var slot in new[] { "_BaseMap", "baseColorTexture", "_MainTex" }) {
                if (material.HasProperty(slot + "_ST")) material.SetVector(slot + "_ST", new Vector4(1f, 1f, 0f, 0f));
            }
        }

        static Material CreateMaterial(Material template, Texture2D texture) {
            if (!template) return null;
            var material = new Material(template) { name = "display print " + texture.name };
            // A glTF import may expose the base map as `_BaseMap` (URP Lit) or as glTFast's
            // own `baseColorTexture`; anything else falls back to `mainTexture`.
            SetTexture(material, texture);
            ResetTextureTransform(material);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", Color.white);
            else if (material.HasProperty("baseColorFactor")) material.SetColor("baseColorFactor", Color.white);
            return material;
        }

        /// <summary>
        /// A crop of the plate's own UVs into the source's window (`croppedPlane`'s rule: the
        /// poster is cropped to its panel, never stretched). The plate's canonical UVs span the
        /// panel, so remapping them into the window is the source's centred crop and needs
        /// nothing from the shader (a custom unlit graph has no texture transform).
        /// </summary>
        public static Mesh CropUvs(Mesh source, Vector4 window) {
            if (!source) return null;
            var mesh = UnityEngine.Object.Instantiate(source);
            mesh.name = source.name + " poster crop";
            var uvs = mesh.uv;
            if (uvs == null || uvs.Length == 0) return mesh;
            for (int i = 0; i < uvs.Length; i++) {
                uvs[i] = new Vector2(window.x + uvs[i].x * (window.y - window.x),
                    window.z + uvs[i].y * (window.w - window.z));
            }
            mesh.uv = uvs;
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>
        /// Forget the loaded-poster cache. Only a test (or a hot reload in the Editor) needs
        /// it; the player loads each slug once.
        /// </summary>
        public static void ResetPosterCache() {
            loaded.Clear();
            absent.Clear();
        }

        static void SafeDestroy(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }
}
