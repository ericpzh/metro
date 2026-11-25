using System;
using System.Collections.Generic;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// Procedural hardware OS cursor textures for the Windows desktop/Editor WebView2 overlay
    /// (<see cref="StationDesktopUiPresenter"/>). Because <c>MetroEditorWebView.exe</c> renders
    /// offscreen, CSS <c>cursor</c> declarations inside React/Blink cannot change Unity's window
    /// cursor directly; the overlay reports normalized CSS cursor names and this helper supplies
    /// crisp 32x32 RGBA32 textures + top-left hotspots for <see cref="Cursor.SetCursor"/>.
    /// </summary>
    public static class StationDesktopCursors {
        public const int Size = 32;
        public const int MinScaledSize = 24;
        public const int MaxScaledSize = 64;

        static readonly Dictionary<string, (Texture2D texture, Vector2 hotspot)> Cache =
            new Dictionary<string, (Texture2D, Vector2)>(StringComparer.Ordinal);

        /// <summary>Map CSS <c>--ui-scale</c> to a quantized hardware cursor size in physical pixels.</summary>
        public static int ResolvePixelSize(float uiScale) {
            float clamped = !float.IsNaN(uiScale) && !float.IsInfinity(uiScale) && uiScale > 0f
                ? Mathf.Clamp(uiScale, 0.75f, 2f)
                : 1f;
            int quantized = Mathf.RoundToInt((Size * clamped) / 4f) * 4;
            return Mathf.Clamp(quantized, MinScaledSize, MaxScaledSize);
        }

        /// <summary>Normalize a raw CSS cursor string into the bounded overlay cursor vocabulary.</summary>
        public static string NormalizeName(string raw) {
            if (string.IsNullOrWhiteSpace(raw)) return "default";
            string s = raw.Trim().ToLowerInvariant();
            switch (s) {
                case "none":
                case "crosshair":
                case "pointer":
                case "grab":
                case "grabbing":
                case "move":
                case "text":
                case "ew-resize":
                case "ns-resize":
                case "not-allowed":
                case "default":
                    return s;
                case "col-resize":
                    return "ew-resize";
                case "row-resize":
                    return "ns-resize";
                case "all-scroll":
                    return "move";
                default:
                    return "default";
            }
        }

        /// <summary>
        /// Look up (and lazily build) the hardware cursor texture and top-left hotspot for a
        /// normalized CSS cursor name at default 1x scale.
        /// </summary>
        public static bool TryGet(string normalizedName, out Texture2D texture, out Vector2 hotspot) =>
            TryGet(normalizedName, 1f, out texture, out hotspot);

        /// <summary>
        /// Look up (and lazily build) the hardware cursor texture and top-left hotspot for a
        /// normalized CSS cursor name scaled by CSS <c>--ui-scale</c>. Returns false for
        /// <c>default</c> and <c>none</c>, which use the native OS arrow or <see cref="Cursor.visible"/>.
        /// </summary>
        public static bool TryGet(string normalizedName, float uiScale, out Texture2D texture, out Vector2 hotspot) {
            texture = null;
            hotspot = Vector2.zero;
            string key = NormalizeName(normalizedName);
            if (key == "default" || key == "none") return false;

            int targetSize = ResolvePixelSize(uiScale);
            string cacheKey = key + "@" + targetSize;
            if (Cache.TryGetValue(cacheKey, out var cached) && cached.texture != null) {
                texture = cached.texture;
                hotspot = cached.hotspot;
                return true;
            }

            if (!TryGetSpec(key, out string[] rows, out Vector2 baseHotspot)) return false;
            hotspot = new Vector2(
                Mathf.Clamp(Mathf.Round(baseHotspot.x * targetSize / Size), 0f, targetSize - 1),
                Mathf.Clamp(Mathf.Round(baseHotspot.y * targetSize / Size), 0f, targetSize - 1));
            texture = BuildTexture(cacheKey, rows, targetSize);
            Cache[cacheKey] = (texture, hotspot);
            return true;
        }

        /// <summary>Destroy all cached procedural cursor textures (on presenter teardown/quit).</summary>
        public static void DisposeCache() {
            foreach (var entry in Cache.Values) {
                if (entry.texture != null) {
                    if (Application.isPlaying) UnityEngine.Object.Destroy(entry.texture);
                    else UnityEngine.Object.DestroyImmediate(entry.texture);
                }
            }
            Cache.Clear();
        }

        public static bool TryGetSpec(string key, out string[] rows, out Vector2 hotspot) {
            switch (key) {
                case "crosshair":
                    rows = CrosshairRows;
                    hotspot = new Vector2(15f, 15f);
                    return true;
                case "pointer":
                    rows = PointerRows;
                    hotspot = new Vector2(10f, 3f);
                    return true;
                case "grab":
                    rows = GrabRows;
                    hotspot = new Vector2(15f, 14f);
                    return true;
                case "grabbing":
                    rows = GrabbingRows;
                    hotspot = new Vector2(15f, 14f);
                    return true;
                case "move":
                    rows = MoveRows;
                    hotspot = new Vector2(15f, 15f);
                    return true;
                case "text":
                    rows = TextRows;
                    hotspot = new Vector2(15f, 15f);
                    return true;
                case "ew-resize":
                    rows = EwResizeRows;
                    hotspot = new Vector2(15f, 15f);
                    return true;
                case "ns-resize":
                    rows = NsResizeRows;
                    hotspot = new Vector2(15f, 15f);
                    return true;
                case "not-allowed":
                    rows = NotAllowedRows;
                    hotspot = new Vector2(15f, 15f);
                    return true;
                default:
                    rows = null;
                    hotspot = Vector2.zero;
                    return false;
            }
        }

        static Texture2D BuildTexture(string name, string[] rows, int targetSize) {
            var tex = new Texture2D(targetSize, targetSize, TextureFormat.RGBA32, mipChain: false, linear: false) {
                name = "StationCursor_" + name,
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Point,
                hideFlags = HideFlags.HideAndDontSave,
            };

            var pixels = new Color32[targetSize * targetSize];
            var clear = new Color32(0, 0, 0, 0);
            var outline = new Color32(14, 18, 24, 255);
            var white = new Color32(250, 252, 255, 255);
            var red = new Color32(230, 68, 68, 255);

            int rowCount = Math.Min(Size, rows.Length);
            for (int y = 0; y < targetSize; y++) {
                int srcY = Math.Clamp((y * Size) / targetSize, 0, Size - 1);
                string row = srcY < rowCount ? rows[srcY] : "";
                int dstY = targetSize - 1 - y; // Texture2D origin is bottom-left; cursor art & hotspot are top-left.
                int dstRowOffset = dstY * targetSize;
                for (int x = 0; x < targetSize; x++) {
                    int srcX = Math.Clamp((x * Size) / targetSize, 0, Size - 1);
                    char ch = srcX < row.Length ? row[srcX] : '.';
                    pixels[dstRowOffset + x] = ch switch {
                        '#' => outline,
                        'W' => white,
                        'R' => red,
                        _ => clear,
                    };
                }
            }

            tex.SetPixels32(pixels);
            tex.Apply(updateMipmaps: false, makeNoLongerReadable: false);
            return tex;
        }

        // 32x32 top-down cursor sprites: '.' transparent, '#' dark outline, 'W' white fill, 'R' danger fill.

        static readonly string[] CrosshairRows = {
            "................................",
            "................................",
            "................................",
            "................................",
            "..............###...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "....###########W###########.....",
            "....#WWWWWWWWWW#WWWWWWWWWW#.....",
            "....###########W###########.....",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............###...............",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
        };

        static readonly string[] PointerRows = {
            "................................",
            "................................",
            ".........###....................",
            "........#WWW#...................",
            "........#WWW#...................",
            "........#WWW#...................",
            "........#WWW#...................",
            "........#WWW#...................",
            "........#WWW####................",
            "........#WWW#WW####.............",
            "........#WWW#WW#WW###...........",
            ".....####WWW#WW#WW#WW#..........",
            "....#WW##WWWWWWWWWWWW#..........",
            "....#WWW#WWWWWWWWWWWW#..........",
            ".....#WWWWWWWWWWWWWWW#..........",
            ".....#WWWWWWWWWWWWWWW#..........",
            "......#WWWWWWWWWWWWWW#..........",
            "......#WWWWWWWWWWWWWW#..........",
            ".......#WWWWWWWWWWWW#...........",
            ".......#WWWWWWWWWWWW#...........",
            "........#WWWWWWWWWW#............",
            "........#WWWWWWWWWW#............",
            "........############............",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
        };

        static readonly string[] GrabRows = {
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            ".............###................",
            ".........####WWW###.............",
            "........#WW#WWWW#WW#............",
            "........#WW#WWWW#WW###..........",
            "........#WW#WWWW#WW#WW#.........",
            "........#WW#WWWW#WW#WW#.........",
            ".....####WW#WWWW#WW#WW#.........",
            "....#WW##WWWWWWWWWWWWW#.........",
            "....#WWW#WWWWWWWWWWWWW#.........",
            ".....#WWWWWWWWWWWWWWWW#.........",
            ".....#WWWWWWWWWWWWWWWW#.........",
            "......#WWWWWWWWWWWWWWW#.........",
            "......#WWWWWWWWWWWWWWW#.........",
            ".......#WWWWWWWWWWWWW#..........",
            ".......#WWWWWWWWWWWWW#..........",
            "........#WWWWWWWWWWW#...........",
            "........#WWWWWWWWWWW#...........",
            "........#############...........",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
        };

        static readonly string[] GrabbingRows = {
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            ".........###########............",
            "........#WW#WWW#WW#W#...........",
            "......###WW#WWW#WW#WW#..........",
            ".....#WW#WWWWWWWWWWWW#..........",
            ".....#WWWWWWWWWWWWWWW#..........",
            "......#WWWWWWWWWWWWWW#..........",
            "......#WWWWWWWWWWWWWW#..........",
            ".......#WWWWWWWWWWWW#...........",
            ".......#WWWWWWWWWWWW#...........",
            "........#WWWWWWWWWW#............",
            "........#WWWWWWWWWW#............",
            "........############............",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
        };

        static readonly string[] MoveRows = {
            "................................",
            "................................",
            "................................",
            "................................",
            "...............#................",
            "..............#W#...............",
            ".............#WWW#..............",
            "............#WWWWW#.............",
            "...........#WWWWWWW#............",
            "..........#####W#####...........",
            "..............#W#...............",
            "........#.....#W#.....#.........",
            ".......##.....#W#.....##........",
            "......#W#.....#W#.....#W#.......",
            ".....#WW#######W#######WW#......",
            "....#WWWWWWWWWWWWWWWWWWWWW#.....",
            ".....#WW#######W#######WW#......",
            "......#W#.....#W#.....#W#.......",
            ".......##.....#W#.....##........",
            "........#.....#W#.....#.........",
            "..............#W#...............",
            "..........#####W#####...........",
            "...........#WWWWWWW#............",
            "............#WWWWW#.............",
            ".............#WWW#..............",
            "..............#W#...............",
            "...............#................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
        };

        static readonly string[] TextRows = {
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "...........#########............",
            "...........#WWWWWWW#............",
            "...........####W####............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "...........####W####............",
            "...........#WWWWWWW#............",
            "...........#########............",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
        };

        static readonly string[] EwResizeRows = {
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            ".........#...........#..........",
            "........##...........##.........",
            ".......#W#...........#W#........",
            "......#WW#...........#WW#.......",
            ".....#WWW#############WWW#......",
            "....#WWWWWWWWWWWWWWWWWWWWW#.....",
            ".....#WWW#############WWW#......",
            "......#WW#...........#WW#.......",
            ".......#W#...........#W#........",
            "........##...........##.........",
            ".........#...........#..........",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
        };

        static readonly string[] NsResizeRows = {
            "................................",
            "................................",
            "................................",
            "................................",
            "...............#................",
            "..............#W#...............",
            ".............#WWW#..............",
            "............#WWWWW#.............",
            "...........#WWWWWWW#............",
            "..........#####W#####...........",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..............#W#...............",
            "..........#####W#####...........",
            "...........#WWWWWWW#............",
            "............#WWWWW#.............",
            ".............#WWW#..............",
            "..............#W#...............",
            "...............#................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
        };

        static readonly string[] NotAllowedRows = {
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "...........#########............",
            ".........##RRRRRRRRR##..........",
            "........#RRRRRRRRRRRRR#.........",
            ".......#RRR#########RRR#........",
            "......#RRRR#.......##RRR#.......",
            "......#RR#RR#.......#RRR#.......",
            ".....#RRR##RR#.......#RRR#......",
            ".....#RRR#.#RR#......#RRR#......",
            ".....#RRR#..#RR#.....#RRR#......",
            ".....#RRR#...#RR#....#RRR#......",
            ".....#RRR#....#RR#...#RRR#......",
            ".....#RRR#.....#RR#..#RRR#......",
            ".....#RRR#......#RR#.#RRR#......",
            ".....#RRR#.......#RR##RRR#......",
            "......#RRR#.......#RR#RR#.......",
            "......#RRR##.......#RRRR#.......",
            ".......#RRR#########RRR#........",
            "........#RRRRRRRRRRRRR#.........",
            ".........##RRRRRRRRR##..........",
            "...........#########............",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
        };
    }
}
