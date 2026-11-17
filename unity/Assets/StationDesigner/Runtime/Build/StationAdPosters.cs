using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// The poster catalogue a 广告牌 prints (the generated table behind `sim/billboards.ts`):
    /// every slug, in catalogue order, with the silhouettes it fits. The reference rolls one
    /// poster per screen at commit — deterministically in the module id — so the same click in
    /// the same station always hangs the same campaign, and undo/redo never reshuffles a wall.
    ///
    /// Generated from `game/src/sim/posterCatalogue.ts`; regenerate rather than edit by hand.
    /// </summary>
    public static class StationAdPosters {
        public enum Shape { Landscape, Wide, Panorama, Portrait, Square }

        public readonly struct Poster {
            public Poster(string slug, bool[] shapes) {
                Slug = slug;
                Shapes = shapes;
            }

            public string Slug { get; }
            public bool[] Shapes { get; }
        }

        static readonly Poster[] Catalogue = {
            new Poster("landscape-1-jfif", new[] { true, true, true, false, false }),
            new Poster("portrait-1-jpeg", new[] { false, false, false, true, false }),
            new Poster("landscape-1-jpg", new[] { true, true, true, false, false }),
            new Poster("portrait-1-png", new[] { false, false, false, true, false }),
            new Poster("landscape-1-webp", new[] { true, true, true, false, false }),
            new Poster("landscape-10-jpg", new[] { true, true, true, false, false }),
            new Poster("portrait-10-png", new[] { false, false, false, true, false }),
            new Poster("landscape-11-jpg", new[] { true, true, true, false, false }),
            new Poster("landscape-11-png", new[] { true, true, true, false, false }),
            new Poster("landscape-12-jpg", new[] { true, true, true, false, false }),
            new Poster("landscape-12-png", new[] { true, true, true, false, false }),
            new Poster("portrait-13-jpg", new[] { false, false, false, true, false }),
            new Poster("landscape-13-png", new[] { true, true, true, false, false }),
            new Poster("portrait-14-jpg", new[] { false, false, false, true, false }),
            new Poster("landscape-15-jpg", new[] { true, true, true, false, false }),
            new Poster("portrait-16-jpg", new[] { false, false, false, true, false }),
            new Poster("portrait-17-jpg", new[] { false, false, false, true, false }),
            new Poster("square-18-jpg", new[] { false, false, false, false, true }),
            new Poster("landscape-19-jpg", new[] { true, true, true, false, false }),
            new Poster("portrait-2-jfif", new[] { false, false, false, true, false }),
            new Poster("portrait-2-jpeg", new[] { false, false, false, true, false }),
            new Poster("portrait-2-jpg", new[] { false, false, false, true, false }),
            new Poster("portrait-2-png", new[] { false, false, false, true, false }),
            new Poster("landscape-2-webp", new[] { true, true, true, false, false }),
            new Poster("portrait-20-jpg", new[] { false, false, false, true, false }),
            new Poster("portrait-21-jpg", new[] { false, false, false, true, false }),
            new Poster("portrait-22-jpg", new[] { false, false, false, true, false }),
            new Poster("portrait-23-jpg", new[] { false, false, false, true, false }),
            new Poster("square-24-jpg", new[] { false, false, false, false, true }),
            new Poster("portrait-25-jpg", new[] { false, false, false, true, false }),
            new Poster("square-26-jpg", new[] { false, false, false, false, true }),
            new Poster("portrait-27-jpg", new[] { false, false, false, true, false }),
            new Poster("landscape-28-jpg", new[] { true, true, true, false, false }),
            new Poster("portrait-29-jpg", new[] { false, false, false, true, false }),
            new Poster("landscape-3-jfif", new[] { true, true, true, false, false }),
            new Poster("portrait-3-jpeg", new[] { false, false, false, true, false }),
            new Poster("square-3-jpg", new[] { false, false, false, false, true }),
            new Poster("landscape-3-png", new[] { true, true, true, false, false }),
            new Poster("portrait-3-webp", new[] { false, false, false, true, false }),
            new Poster("portrait-30-jpg", new[] { false, false, false, true, false }),
            new Poster("landscape-31-jpg", new[] { true, true, true, false, false }),
            new Poster("landscape-32-jpg", new[] { true, true, true, false, false }),
            new Poster("landscape-33-jpg", new[] { true, true, true, false, false }),
            new Poster("landscape-34-jpg", new[] { true, true, true, false, false }),
            new Poster("portrait-4-jfif", new[] { false, false, false, true, false }),
            new Poster("portrait-4-jpeg", new[] { false, false, false, true, false }),
            new Poster("portrait-4-jpg", new[] { false, false, false, true, false }),
            new Poster("landscape-4-png", new[] { true, true, true, false, false }),
            new Poster("portrait-4-webp", new[] { false, false, false, true, false }),
            new Poster("landscape-5-jfif", new[] { true, true, true, false, false }),
            new Poster("landscape-5-jpeg", new[] { true, true, true, false, false }),
            new Poster("landscape-5-jpg", new[] { true, true, true, false, false }),
            new Poster("landscape-5-png", new[] { true, true, true, false, false }),
            new Poster("portrait-5-webp", new[] { false, false, false, true, false }),
            new Poster("landscape-6-jfif", new[] { true, true, true, false, false }),
            new Poster("portrait-6-jpg", new[] { false, false, false, true, false }),
            new Poster("landscape-6-png", new[] { true, true, true, false, false }),
            new Poster("landscape-6-webp", new[] { true, true, true, false, false }),
            new Poster("portrait-7-jfif", new[] { false, false, false, true, false }),
            new Poster("portrait-7-jpg", new[] { false, false, false, true, false }),
            new Poster("portrait-7-png", new[] { false, false, false, true, false }),
            new Poster("landscape-7-webp", new[] { true, true, true, false, false }),
            new Poster("landscape-8-jfif", new[] { true, true, true, false, false }),
            new Poster("portrait-8-jpg", new[] { false, false, false, true, false }),
            new Poster("portrait-8-png", new[] { false, false, false, true, false }),
            new Poster("portrait-8-webp", new[] { false, false, false, true, false }),
            new Poster("portrait-9-jpg", new[] { false, false, false, true, false }),
            new Poster("portrait-9-png", new[] { false, false, false, true, false }),
            new Poster("landscape-games-2025-blue-jpg", new[] { true, true, true, false, false }),
            new Poster("portrait-games-2025-red-jpg", new[] { false, false, false, true, false }),
            new Poster("landscape-guangdong-league-jpg", new[] { true, true, true, false, false }),
            new Poster("portrait-heinz-body-jpg", new[] { false, false, false, true, false }),
            new Poster("landscape-heinz-league-jpg", new[] { true, true, true, false, false }),
            new Poster("landscape-metro-security-jpg", new[] { true, true, true, false, false }),
        };

        /// <summary>Every poster, in catalogue order.</summary>
        public static IReadOnlyList<Poster> All => Catalogue;

        /// <summary>`postersFor(shape)`: the posters that fit the silhouette, or the whole table.</summary>
        public static List<Poster> PostersFor(Shape shape) {
            var matching = new List<Poster>();
            foreach (var poster in Catalogue) if (poster.Shapes[(int)shape]) matching.Add(poster);
            return matching.Count > 0 ? matching : new List<Poster>(Catalogue);
        }

        /// <summary>The silhouette a piece prints, or null when it prints no poster.</summary>
        public static Shape? ShapeFor(string type, string variant) {
            if (string.Equals(type, "billboard", StringComparison.Ordinal)) {
                switch (variant ?? "") {
                    case "standard": return Shape.Wide;
                    case "panorama": return Shape.Panorama;
                    case "portrait": return Shape.Portrait;
                    case "square": return Shape.Square;
                    default: return Shape.Landscape;
                }
            }
            if (string.Equals(type, "tv", StringComparison.Ordinal) ||
                string.Equals(type, "busstop", StringComparison.Ordinal)) return Shape.Landscape;
            return null;
        }

        /// <summary>
        /// `needsPoster` at commit: a fresh screen takes its poster once, from the id it was
        /// given, and keeps it — a redo re-hangs the same campaign and an authored poster is
        /// never overwritten.
        /// </summary>
        public static bool RollFor(StationEditDraft draft) {
            if (draft == null || string.IsNullOrEmpty(draft.Id)) return false;
            if (!string.IsNullOrEmpty(draft.Text("poster"))) return false;
            var shape = ShapeFor(draft.Type, draft.Text("variant"));
            if (!shape.HasValue) return false;
            var slug = Roll(draft.Id, shape.Value);
            if (string.IsNullOrEmpty(slug)) return false;
            draft.Set("poster", slug);
            return true;
        }

        /// <summary>
        /// `randomAdSlug`: FNV-1a over the module id, modulo the posters that fit the shape —
        /// deterministic in the id, so a redo re-hangs the same campaign.
        /// </summary>
        public static string Roll(string moduleId, Shape shape) {
            var choices = PostersFor(shape);
            if (choices.Count == 0) return "";
            uint hash = 2166136261;
            foreach (var ch in moduleId ?? "") {
                hash ^= ch;
                hash *= 16777619;
            }
            return choices[(int)(hash % (uint)choices.Count)].Slug;
        }
    }
}
