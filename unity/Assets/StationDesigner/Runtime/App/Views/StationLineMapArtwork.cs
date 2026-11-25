using System;
using System.Collections.Generic;
using System.Globalization;
using Metro.Build;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// 20 §3 — a 线网图 prints the **city's supplied map**, not the export's placeholder.
    ///
    /// The promoted `linemap-wall.glb` and `linemap-stand.glb` expose `lineMapPlaceholder` as
    /// their printed material, minted by the palette as a drawn "no lines yet" board. The display
    /// renderer instantiated the prefab with no artwork binding at all, so a Zoo wall printed the
    /// placeholder even though the save has a line — and the runtime's real answer in Three comes
    /// separately, from `render/lineMapArt.ts` pairing `render/lineMapCity.ts`'s slug with the
    /// supplied poster under `game/src/assets/linemaps/`.
    ///
    /// This is that binding. `cityLineMapSlug` names the poster for the committed city
    /// (`network-map` for Guangzhou, `<city>-map` otherwise), the exported table under
    /// `Resources/LineMaps` supplies the pixels and their provenance, and each printed face is
    /// resolved through the shared upright-UV helper so a turned wall board and both faces of the
    /// concourse totem read the right way up. A **city** map never derives its network from the
    /// player's line list — that is the placeholder's job, and the placeholder is what the real
    /// art replaces.
    ///
    /// The fit follows the source: six cities fill their board whole (`contain`, the quad shrunk
    /// to the poster's own aspect), the network and Shenzhen posters are cropped to the panel
    /// window (`panelUvWindow`). A city with no exported poster keeps the placeholder and is
    /// reported by exact city and slug.
    /// </summary>
    public static class StationLineMapArtwork {
        public const string ResourceRoot = "LineMaps/";
        /// <summary>The promoted print plane's material name, on both mounts.</summary>
        public const string PlaceholderTag = "lineMapPlaceholder";
        public const string LedgerPrefix = "linemap:";
        public const string GuangzhouSlug = "network-map";

        /// <summary>
        /// `render/lineMapArt.ts:face` — the six filled city maps are fitted whole rather than
        /// cropped, because their posters print the tunnels and the legend to the edge.
        /// </summary>
        static readonly string[] ContainSlugs = {
            "shanghai-map", "beijing-map", "chengdu-map", "chongqing-map", "wuhan-map", "nanjing-map",
        };

        /// <summary>One printed face of a bound board, for the binding report and the tests.</summary>
        public sealed class Face {
            public string ModuleId = "";
            /// <summary>0 = the wall board or the totem's front, 1 = the totem's back.</summary>
            public int Slot;
            public string City = "", Slug = "";
            public StationDisplayArtwork.UprightSurface Surface;
            public StationDisplayArtwork.PlateFit Fit;
            public string Basis = "";
            public override string ToString() =>
                ModuleId + " face" + Slot + " " + Slug + " " + Fit + " " + Basis;
        }

        static readonly Dictionary<string, Texture2D> loaded = new Dictionary<string, Texture2D>(StringComparer.Ordinal);
        static readonly HashSet<string> absent = new HashSet<string>(StringComparer.Ordinal);
        static readonly Dictionary<StationDisplayArtwork.Scope, List<Face>> byScope =
            new Dictionary<StationDisplayArtwork.Scope, List<Face>>();

        /// <summary>The faces one world bound (`null`/empty before a build).</summary>
        public static IReadOnlyList<Face> FacesFor(StationDisplayArtwork.Scope scope) =>
            scope != null && byScope.TryGetValue(scope, out var list) ? (IReadOnlyList<Face>)list : Array.Empty<Face>();

        /// <summary>`normalizeCityStyle`: the eight supported cities, Guangzhou by default.</summary>
        public static string Normalise(string city) {
            var value = string.IsNullOrEmpty(city) ? "guangzhou" : city.Trim().ToLowerInvariant();
            return value.Length == 0 ? "guangzhou" : value;
        }

        /// <summary>`cityLineMapSlug`: the network map for Guangzhou, the city's own poster otherwise.</summary>
        public static string SlugOf(string city) {
            var normalised = Normalise(city);
            return normalised == "guangzhou" ? GuangzhouSlug : normalised + "-map";
        }

        /// <summary>True for a poster that is fitted whole rather than cropped to its panel.</summary>
        public static bool Contain(string slug) {
            for (int i = 0; i < ContainSlugs.Length; i++) {
                if (string.Equals(ContainSlugs[i], slug, StringComparison.Ordinal)) return true;
            }
            return false;
        }

        /// <summary>The supplied poster, loaded once from the exported table (`Resources/LineMaps`).</summary>
        public static Texture2D Artwork(string slug) {
            if (string.IsNullOrEmpty(slug)) return null;
            if (loaded.TryGetValue(slug, out var texture) && texture) return texture;
            if (absent.Contains(slug)) return null;
            texture = Resources.Load<Texture2D>(ResourceRoot + slug);
            if (texture == null) {
                absent.Add(slug);
                return null;
            }
            loaded[slug] = texture;
            return texture;
        }

        /// <summary>
        /// Bind every printed face of one placed 线网图 to the committed city's poster. False with
        /// a ledger reason when the prefab carries no print plane or the city's poster is missing
        /// (in which case the placeholder stays, exactly as the source falls back to its drawn
        /// board).
        /// </summary>
        public static bool Bind(StationDisplayArtwork.Scope scope, StationDocument document, GameObject root,
            ModuleFacts module, StationWorldView world) {
            if (scope == null || root == null || module == null) return false;
            var plates = PrintSurfaces(root, scope);
            if (plates.Count == 0) {
                scope.Notes.Add("linemap-unresolved:" + module.Id + ":no-print-surface");
                return false;
            }
            UnbindKeepingPlates(scope, module.Id, plates);
            var city = Normalise(document != null ? document.City : "");
            var slug = SlugOf(city);
            var texture = Artwork(slug);
            var fit = Contain(slug) ? StationDisplayArtwork.PlateFit.Contain : StationDisplayArtwork.PlateFit.Crop;
            if (!byScope.TryGetValue(scope, out var list)) byScope[scope] = list = new List<Face>();
            int bound = 0;
            for (int i = 0; i < plates.Count; i++) {
                var renderer = plates[i];
                var surface = StationDisplayArtwork.BindUprightArtwork(scope, renderer);
                if (surface == null) {
                    scope.Notes.Add("linemap-unresolved:" + module.Id + ":face" + i + ":no-plate-mesh");
                    continue;
                }
                if (texture == null) {
                    // The placeholder stays: a board printing the drawn empty network is the
                    // source's own fallback until the artwork is packaged (20 §3).
                    scope.Notes.Add("linemap-art-missing:" + module.Id + ":face" + i + ":city=" + city +
                        ":slug=" + slug + ":placeholder-kept");
                    continue;
                }
                if (!StationDisplayArtwork.Paint(scope, surface, texture, fit)) {
                    scope.Notes.Add("linemap-unresolved:" + module.Id + ":face" + i + ":no-material");
                    continue;
                }
                world?.RecaptureArtwork(renderer);
                list.Add(new Face {
                    ModuleId = module.Id ?? "", Slot = i, City = city, Slug = slug, Surface = surface, Fit = fit,
                    Basis = surface.Basis,
                });
                scope.Notes.Add(LedgerPrefix + module.Id + ":face" + i + ":city=" + city + ":slug=" + slug +
                    ":fit=" + (fit == StationDisplayArtwork.PlateFit.Contain ? "contain" : "crop") +
                    ":panel=" + surface.Panel.x.ToString("0.##", CultureInfo.InvariantCulture) + "x" +
                    surface.Panel.y.ToString("0.##", CultureInfo.InvariantCulture));
                bound++;
            }
            if (bound > 0) scope.Bound++;
            return bound > 0;
        }

        /// <summary>
        /// The prefab's printed planes in **stable face slots**: the base mount's own slot first,
        /// the totem's far side second. The export does not name the two boards, so the slot is
        /// derived from each plane's outward normal (its averaged mesh normal in world space),
        /// compared on the station's axes — never from child order, which a re-promotion may
        /// change.
        /// </summary>
        static List<MeshRenderer> PrintSurfaces(GameObject root, StationDisplayArtwork.Scope scope = null) {
            var plates = new List<MeshRenderer>();
            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer) continue;
                bool matched = false;
                foreach (var material in renderer.sharedMaterials) {
                    if (!material || material.name == null) continue;
                    if (material.name.IndexOf(PlaceholderTag, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    plates.Add(renderer);
                    matched = true;
                    break;
                }
                if (!matched && scope != null) {
                    var template = StationDisplayArtwork.TemplateForRenderer(scope, renderer);
                    if (template != null && template.name != null &&
                        template.name.IndexOf(PlaceholderTag, StringComparison.OrdinalIgnoreCase) >= 0) {
                        plates.Add(renderer);
                    }
                }
            }
            if (plates.Count <= 1) return plates;
            var normals = new Dictionary<MeshRenderer, Vector3>();
            for (int i = 0; i < plates.Count; i++) normals[plates[i]] = OutwardNormal(plates[i]);
            plates.Sort((a, b) => {
                var left = normals[a];
                var right = normals[b];
                int order = Math.Round(right.z, 3).CompareTo(Math.Round(left.z, 3));
                if (order != 0) return order;
                order = Math.Round(right.x, 3).CompareTo(Math.Round(left.x, 3));
                if (order != 0) return order;
                return Math.Round(right.y, 3).CompareTo(Math.Round(left.y, 3));
            });
            return plates;
        }

        static Vector3 OutwardNormal(MeshRenderer renderer) {
            var filter = renderer.GetComponent<MeshFilter>();
            if (filter == null || filter.sharedMesh == null) return Vector3.zero;
            var normals = filter.sharedMesh.normals;
            if (normals == null || normals.Length == 0) return Vector3.zero;
            var sum = Vector3.zero;
            for (int i = 0; i < normals.Length; i++) sum += normals[i];
            return sum.sqrMagnitude < 1e-10f ? Vector3.zero : renderer.transform.TransformDirection(sum.normalized);
        }

        /// <summary>Remove bound line-map faces and surfaces for retired or rebound modules.</summary>
        public static void Unbind(StationDisplayArtwork.Scope scope, HashSet<string> moduleIds) {
            if (scope == null || moduleIds == null || moduleIds.Count == 0) return;
            if (!byScope.TryGetValue(scope, out var list)) return;
            for (int i = list.Count - 1; i >= 0; i--) {
                var face = list[i];
                if (face == null || (!string.IsNullOrEmpty(face.ModuleId) && moduleIds.Contains(face.ModuleId))) {
                    if (face?.Surface != null) scope.Surfaces.Remove(face.Surface);
                    list.RemoveAt(i);
                }
            }
        }

        static void UnbindKeepingPlates(StationDisplayArtwork.Scope scope, string moduleId, List<MeshRenderer> keepPlates) {
            if (scope == null || string.IsNullOrEmpty(moduleId)) return;
            if (!byScope.TryGetValue(scope, out var list)) return;
            for (int i = list.Count - 1; i >= 0; i--) {
                var face = list[i];
                if (face == null || !string.Equals(face.ModuleId, moduleId, StringComparison.Ordinal)) continue;
                if (face.Surface != null && (keepPlates == null || !keepPlates.Contains(face.Surface.Renderer))) {
                    scope.Surfaces.Remove(face.Surface);
                }
                list.RemoveAt(i);
            }
        }

        internal static void ReleaseScope(StationDisplayArtwork.Scope scope) {
            if (scope != null) byScope.Remove(scope);
        }

        /// <summary>
        /// A locale switch does not change a supplied city poster — the map is the network's own
        /// artwork, not a printed caption — so this only drops the memoised lookups so a later
        /// build (or a station switch) re-resolves from the committed city.
        /// </summary>
        public static void ResetLocale() {
            loaded.Clear();
            absent.Clear();
        }

        /// <summary>Drop the loaded-poster cache (a test, or a station switch).</summary>
        public static void Reset() {
            loaded.Clear();
            absent.Clear();
            byScope.Clear();
        }
    }
}
