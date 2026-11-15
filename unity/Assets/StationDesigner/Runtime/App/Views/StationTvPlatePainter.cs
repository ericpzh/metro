using System;
using System.Globalization;
using Metro.Build;
using Metro.Sim;
using UnityEngine;
using UnityEngine.UI;

namespace Metro.App.Views {
    /// <summary>
    /// 20 §1 — the television's **station plate**: the passenger-information board around the
    /// advertisement.
    ///
    /// The promotion baked the review document's one sample departure into `tvDepartureBoard`
    /// (and `…Board2` on a back-to-back pair), and the 18-era painter drew four lines on a dark
    /// plate, which is not the reference. This is the production layout
    /// (`render/stationDisplay.ts:stationDisplayLayout` / `drawStationDisplay`) at the same
    /// 960 × 540:
    ///
    ///   * a `#258cdd` ground, with the video aperture left dark on the right
    ///     (`x = .25, y = 0, w = .75, h = .82`) for the content-window mesh that sits in front;
    ///   * **three service cards** down the left column — a Chinese label, its printed English
    ///     sub-label, the direction's terminus and the countdown / at-platform / arriving state;
    ///   * the station name card under them;
    ///   * the travel-courtesy strip and the date/HH:mm footer along the bottom.
    ///
    /// The plate is fed from the published frame and repaints only when the **printed** facts
    /// change (station, line, colour, direction, terminus, the three card states, the minute, the
    /// date or the locale), so a paused station keeps its plate and a running one repaints about
    /// once a minute.
    /// </summary>
    public static class StationTvPlatePainter {
        public const int Width = 960;
        public const int Height = 540;

        /// <summary>The video aperture, in plate fractions (`TV_POSTER_RECT`).</summary>
        public const float PosterX = .25f, PosterY = 0f, PosterW = .75f, PosterH = .82f;
        public const int CardInset = 12;

        public struct PlateRect {
            public float X, Y, W, H;
            public override string ToString() =>
                X.ToString("0.#", CultureInfo.InvariantCulture) + "," + Y.ToString("0.#", CultureInfo.InvariantCulture) +
                " " + W.ToString("0.#", CultureInfo.InvariantCulture) + "x" + H.ToString("0.#", CultureInfo.InvariantCulture);
        }

        /// <summary>One plate's rectangles, in top-left origin pixels (the source's own frame).</summary>
        public struct PlateLayout {
            public PlateRect Poster, Station, Strip, Clock;
            public PlateRect Card0, Card1, Card2;
            public PlateRect Card(int index) => index == 0 ? Card0 : index == 1 ? Card1 : Card2;
        }

        /// <summary>`stationDisplayLayout(960, 540)`, restated for the plate painter.</summary>
        public static PlateLayout Layout() {
            float width = Width, height = Height;
            float colW = width * PosterX;
            float footerY = height * .9f;
            float cardH = (footerY - 4 * CardInset) / 3f;
            var card = new PlateRect { X = CardInset, W = colW - 2 * CardInset, H = cardH };
            return new PlateLayout {
                Poster = new PlateRect { X = colW, Y = 0f, W = width * PosterW, H = height * PosterH },
                Card0 = new PlateRect { X = card.X, Y = CardInset, W = card.W, H = card.H },
                Card1 = new PlateRect { X = card.X, Y = CardInset + (cardH + CardInset), W = card.W, H = card.H },
                Card2 = new PlateRect { X = card.X, Y = CardInset + 2 * (cardH + CardInset), W = card.W, H = card.H },
                Station = new PlateRect { X = CardInset, Y = footerY + 3f, W = colW - 2 * CardInset,
                    H = height - footerY - 6f },
                Strip = new PlateRect { X = colW, Y = footerY, W = width - colW - 144f, H = height - footerY },
                Clock = new PlateRect { X = width - 144f, Y = footerY, W = 144f, H = height - footerY },
            };
        }

        /// <summary>The facts one plate prints (its content key is built from them).</summary>
        public struct PlateData {
            public string Station, Line, Direction, Terminus, Clock, Date, Locale;
            public Color Accent;
            public StationTvArrival[] Arrivals;
            public bool HasLine;
            /// <summary>What the board selected, for `state.displays` diagnostics.</summary>
            public string StatusKey;
            public string Key;
        }

        /// <summary>
        /// The plate a (document, screen) pair calls for. The screen's sample point is the
        /// television's own cell centre; the schedule answers which line and which three arrivals
        /// it prints.
        /// </summary>
        public static PlateData Describe(StationDocument document, StationMotionFrame frame, bool haveFrame,
            Vector3 sample, string locale) {
            var clock = haveFrame ? frame.Clock : default;
            return Describe(document, StationTvSchedule.Select(document, frame, haveFrame, sample), clock, locale);
        }

        /// <summary>The plate for an already-selected service and a published clock frame.</summary>
        public static PlateData Describe(StationDocument document, StationTvLineStatus status,
            StationClockFrame clock, string locale) {
            var words = StationDisplayWords.For(locale);
            var data = new PlateData {
                Station = document != null ? document.Name : "",
                HasLine = status != null && status.HasLine,
                Line = status != null && status.HasLine ? status.Name : "",
                Direction = status != null ? status.Direction : "",
                Terminus = status != null && status.HasLine ? status.Terminus : "",
                Accent = ParseColour(status != null ? status.Colour : null),
                Arrivals = status != null ? status.Arrivals : new StationTvArrival[3],
                Locale = words.Locale,
                Clock = ClockText(clock.Clock, clock.TimeOfDaySeconds),
                Date = DateText(clock.DateKey, words),
                StatusKey = status != null ? StationTvSchedule.KeyOf(status) : "",
            };
            var key = new System.Text.StringBuilder(128);
            key.Append("plate|").Append(data.Station).Append('|').Append(data.Locale).Append('|')
                .Append(data.Line).Append('|').Append(data.Direction).Append('|').Append(data.Terminus)
                .Append('|').Append(data.Clock).Append('|').Append(data.Date)
                .Append('|').Append(data.StatusKey);
            data.Key = key.ToString();
            return data;
        }

        /// <summary>`hh:mm` from the published frame (a frame without one is formatted from seconds).</summary>
        public static string ClockText(string published, double simTime) {
            if (!string.IsNullOrEmpty(published)) return published;
            if (double.IsNaN(simTime) || double.IsInfinity(simTime) || simTime < 0) return "--:--";
            int total = (int)Math.Floor(simTime);
            int hours = (total / 3600) % 24, minutes = (total / 60) % 60;
            return hours.ToString("00", CultureInfo.InvariantCulture) + ":" + minutes.ToString("00", CultureInfo.InvariantCulture);
        }

        /// <summary>
        /// `stampAt(...).dateLabel`, translated: `{0}月{1}日` in Chinese, `{0}/{1}` in English.
        /// A frame with no date key prints nothing rather than a made-up day.
        /// </summary>
        public static string DateText(string dateKey, StationDisplayWords words) {
            if (string.IsNullOrEmpty(dateKey)) return "";
            var parts = dateKey.Split('-');
            if (parts.Length < 3) return dateKey;
            if (!int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out int month) ||
                !int.TryParse(parts[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out int day))
                return dateKey;
            return StationDisplayWords.IsChinese(words != null ? words.Locale : "zh-CN")
                ? month.ToString(CultureInfo.InvariantCulture) + "月" + day.ToString(CultureInfo.InvariantCulture) + "日"
                : month.ToString(CultureInfo.InvariantCulture) + "/" + day.ToString(CultureInfo.InvariantCulture);
        }

        /// <summary>`#rrggbb` to a colour; the source's default line blue when unparseable.</summary>
        public static Color ParseColour(string value) {
            var fallback = new Color(.12f, .47f, .82f);
            if (string.IsNullOrEmpty(value)) return fallback;
            var text = value.Trim();
            if (text.StartsWith("#", StringComparison.Ordinal)) text = text.Substring(1);
            if (text.Length == 3) text = new string(new[] { text[0], text[0], text[1], text[1], text[2], text[2] });
            if (text.Length != 6 ||
                !int.TryParse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out int rgb)) return fallback;
            return new Color(((rgb >> 16) & 0xFF) / 255f, ((rgb >> 8) & 0xFF) / 255f, (rgb & 0xFF) / 255f);
        }

        /// <summary>Paint one plate to an RGBA texture (the caller owns it).</summary>
        public static Texture2D Paint(PlateData data, Font font) {
            RenderTexture previous = RenderTexture.active;
            RenderTexture target = null;
            GameObject cameraObject = null, canvasObject = null;
            Texture2D texture = null;
            var face = font != null ? font : StationUiFont();
            try {
                target = RenderTexture.GetTemporary(Width, Height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
                cameraObject = new GameObject("tv plate camera");
                var camera = cameraObject.AddComponent<Camera>();
                camera.clearFlags = CameraClearFlags.SolidColor;
                // The reference ground is `#258cdd`; the aperture is painted over it.
                camera.backgroundColor = new Color(.145f, .549f, .867f, 1f);
                camera.orthographic = true;
                camera.orthographicSize = Height * .5f;
                camera.nearClipPlane = .01f;
                camera.farClipPlane = 100f;
                camera.transform.position = new Vector3(Width * .5f, Height * .5f, -10f);
                camera.targetTexture = target;
                canvasObject = new GameObject("tv plate canvas", typeof(Canvas));
                var canvas = canvasObject.GetComponent<Canvas>();
                canvas.renderMode = RenderMode.WorldSpace;
                var rect = canvasObject.GetComponent<RectTransform>();
                rect.sizeDelta = new Vector2(Width, Height);
                rect.position = new Vector3(Width * .5f, Height * .5f, 0f);
                rect.localScale = Vector3.one;
                var root = canvasObject.transform;
                var layout = Layout();
                var words = StationDisplayWords.For(data.Locale);
                // `drawStationDisplay`: `g.fillRect(layout.poster.x, 0, layout.poster.w, layout.strip.y)`
                // paints `#080a0c` all the way down to the footer strip (`0.90 H`), leaving the
                // dark band below the `0.82 H` content window (`Layout().Poster.H` remains `0.82 H`).
                Panel(root, "poster", new PlateRect {
                    X = layout.Poster.X, Y = 0f, W = layout.Poster.W, H = layout.Strip.Y,
                }, new Color(.031f, .039f, .047f, 1f), null);
                var arrivals = data.Arrivals ?? new StationTvArrival[3];
                for (int card = 0; card < 3; card++) {
                    var box = layout.Card(card);
                    Panel(root, "card " + card, box, new Color(.945f, .949f, .941f, 1f), RoundedSprite());
                    var arrival = card < arrivals.Length ? arrivals[card] : default;
                    Row(root, face, words.CardLabel(card), 28, Inset(box, 6f, 6f, 6f, 33f), FontStyle.Bold,
                        new Color(.063f, .078f, .094f));
                    Row(root, face, words.CardSubLabel(card), 15, Inset(box, 8f, 37f, 8f, 22f), FontStyle.Bold,
                        new Color(.063f, .078f, .094f));
                    Row(root, face, data.HasLine ? data.Terminus : words.NoLines, 32, Inset(box, 8f, 62f, 8f, 40f),
                        FontStyle.Normal, new Color(.063f, .078f, .094f));
                    Row(root, face, data.HasLine ? words.StatusText(arrival) : words.NoServices, 32,
                        Inset(box, 8f, box.H - 44f, 8f, 40f), FontStyle.Normal, new Color(.063f, .078f, .094f));
                }
                Panel(root, "station", layout.Station, new Color(.945f, .949f, .941f, 1f), RoundedSprite());
                Row(root, face, data.Station, 27, Inset(layout.Station, 8f, 0f, 8f, layout.Station.H),
                    FontStyle.Normal, new Color(.063f, .078f, .094f));
                Row(root, face, words.Courtesy, 26,
                    new PlateRect { X = layout.Strip.X + 16f, Y = layout.Strip.Y, W = layout.Strip.W - 24f, H = layout.Strip.H },
                    FontStyle.Normal, new Color(.933f, .965f, 1f), TextAnchor.MiddleLeft);
                Row(root, face, data.Date, 18,
                    new PlateRect { X = layout.Clock.X, Y = layout.Clock.Y + 2f, W = layout.Clock.W, H = 22f },
                    FontStyle.Bold, new Color(.024f, .137f, .275f));
                Row(root, face, data.Clock, 29,
                    new PlateRect { X = layout.Clock.X, Y = layout.Clock.Y + 21f, W = layout.Clock.W, H = 32f },
                    FontStyle.Bold, new Color(.024f, .137f, .275f));
                Canvas.ForceUpdateCanvases();
                camera.Render();
                RenderTexture.active = target;
                texture = new Texture2D(Width, Height, TextureFormat.RGBA32, false) {
                    name = "tv plate " + Stable(data.Key),
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = FilterMode.Bilinear,
                    anisoLevel = 4,
                };
                texture.ReadPixels(new Rect(0, 0, Width, Height), 0, 0);
                texture.Apply(false, false);
            } finally {
                RenderTexture.active = previous;
                if (cameraObject) UnityEngine.Object.DestroyImmediate(cameraObject);
                if (canvasObject) UnityEngine.Object.DestroyImmediate(canvasObject);
                if (target != null) RenderTexture.ReleaseTemporary(target);
            }
            return texture;
        }

        /// <summary>A rectangle inside one card: the card's own box, inset and one row tall.</summary>
        static PlateRect Inset(PlateRect box, float x, float y, float w, float h) =>
            new PlateRect { X = box.X + x, Y = box.Y + y, W = Mathf.Max(8f, box.W - w * 2f), H = h };

        /// <summary>A stable suffix for a texture name (never `string.GetHashCode`, which is per-run).</summary>
        static string Stable(string text) {
            uint hash = 2166136261u;
            foreach (var ch in text ?? "") {
                hash ^= ch;
                hash *= 16777619u;
            }
            return hash.ToString("x8", CultureInfo.InvariantCulture);
        }

        /// <summary>
        /// A solid rectangle in plate pixels with a **top-left anchor and pivot**, so every
        /// element is placed in the source's own top-left frame and nesting never re-bases a
        /// coordinate.
        /// </summary>
        static RectTransform Panel(Transform root, string name, PlateRect box, Color colour, Sprite sprite) {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(root, false);
            var rect = (RectTransform)go.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            rect.sizeDelta = new Vector2(Mathf.Max(1f, box.W), Mathf.Max(1f, box.H));
            rect.anchoredPosition = new Vector2(box.X, -box.Y);
            var image = go.AddComponent<Image>();
            if (sprite != null) {
                image.sprite = sprite;
                image.type = Image.Type.Sliced;
            }
            image.color = colour;
            image.raycastTarget = false;
            return rect;
        }

        /// <summary>
        /// One text run in its own box. `resizeTextForBestFit` ports `fitText`: the reference
        /// shrinks a label until it fits its box rather than clipping or overflowing it.
        /// </summary>
        static Text Row(Transform root, Font font, string text, int size, PlateRect box, FontStyle style,
            Color colour, TextAnchor anchor = TextAnchor.MiddleCenter) {
            var go = new GameObject("text", typeof(RectTransform));
            go.transform.SetParent(root, false);
            var ui = go.AddComponent<Text>();
            ui.font = font;
            ui.text = text ?? "";
            ui.fontSize = size;
            ui.fontStyle = style;
            ui.color = colour;
            ui.alignment = anchor;
            ui.horizontalOverflow = HorizontalWrapMode.Overflow;
            ui.verticalOverflow = VerticalWrapMode.Overflow;
            ui.raycastTarget = false;
            ui.resizeTextForBestFit = true;
            ui.resizeTextMinSize = 8;
            ui.resizeTextMaxSize = size;
            var rect = (RectTransform)go.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            rect.sizeDelta = new Vector2(Mathf.Max(8f, box.W), Mathf.Max(4f, box.H));
            rect.anchoredPosition = new Vector2(box.X, -box.Y);
            return ui;
        }

        static Font uiFont;

        /// <summary>The plate's typeface when the caller supplied none.</summary>
        public static Font StationUiFont() {
            if (uiFont) return uiFont;
            try { uiFont = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); } catch (Exception) { uiFont = null; }
            return uiFont;
        }

        static Sprite rounded;
        static bool roundedTried;

        /// <summary>
        /// The cards' 12 px rounded corners. Generated once as a 9-sliced sprite so a 216 × 146
        /// card and a 48 px station card share one texture; a plain rectangle is the fallback if
        /// the runtime refuses to build the sprite.
        /// </summary>
        static Sprite RoundedSprite() {
            if (roundedTried) return rounded;
            roundedTried = true;
            const int radius = CardInset, size = radius * 2 + 1;
            try {
                var texture = new Texture2D(size, size, TextureFormat.RGBA32, false) {
                    name = "tv plate card",
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = FilterMode.Bilinear,
                };
                var pixels = new Color32[size * size];
                for (int y = 0; y < size; y++) {
                    for (int x = 0; x < size; x++) {
                        float dx = Mathf.Max(0f, Mathf.Max(radius - x, x - radius));
                        float dy = Mathf.Max(0f, Mathf.Max(radius - y, y - radius));
                        float distance = Mathf.Sqrt(dx * dx + dy * dy);
                        float alpha = Mathf.Clamp01(radius - distance + .5f);
                        pixels[y * size + x] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(alpha * 255f));
                    }
                }
                texture.SetPixels32(pixels);
                texture.Apply(false, false);
                // `Canvas.referencePixelsPerUnit` defaults to 100; matching 100 PPU keeps the
                // 9-slice border at 12 canvas pixels instead of scaling it 100× into an oval.
                rounded = Sprite.Create(texture, new UnityEngine.Rect(0, 0, size, size), new Vector2(.5f, .5f), 100f, 0,
                    SpriteMeshType.FullRect, new Vector4(radius, radius, radius, radius));
                rounded.name = "tv plate card";
            } catch (Exception) {
                rounded = null;
            }
            return rounded;
        }
    }
}
