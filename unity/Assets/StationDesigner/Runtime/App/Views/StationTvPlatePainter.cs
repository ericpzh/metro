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

        const int OffscreenPainterLayer = 31;
        static readonly Vector3 PainterOrigin = new Vector3(-100000f, -100000f, -100000f);

        sealed class PainterRig {
            public GameObject CameraObject;
            public Camera Camera;
            public GameObject CanvasObject;
            public RenderTexture ScratchTarget;
            public readonly Text[] CardLabels = new Text[3];
            public readonly Text[] CardSubLabels = new Text[3];
            public readonly Text[] CardTermini = new Text[3];
            public readonly Text[] CardStatuses = new Text[3];
            public Text StationText;
            public Text CourtesyText;
            public Text DateText;
            public Text ClockText;

            public bool IsAlive => CameraObject != null && Camera != null && CanvasObject != null;

            public void Dispose() {
                if (Camera != null) Camera.targetTexture = null;
                if (ScratchTarget != null) {
                    if (ScratchTarget.IsCreated()) ScratchTarget.Release();
                    SafeDestroy(ScratchTarget);
                    ScratchTarget = null;
                }
                if (CameraObject != null) SafeDestroy(CameraObject);
                if (CanvasObject != null) SafeDestroy(CanvasObject);
                CameraObject = null;
                Camera = null;
                CanvasObject = null;
            }
        }

        static PainterRig pooledRig;

        static void SafeDestroy(UnityEngine.Object obj) {
            if (!obj) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(obj);
            else UnityEngine.Object.DestroyImmediate(obj);
        }

        /// <summary>Release the pooled offscreen TV painter rig (safe to call on shutdown or tests).</summary>
        public static void DisposePool() {
            if (pooledRig == null) return;
            pooledRig.Dispose();
            pooledRig = null;
        }

        static PainterRig EnsureRig() {
            if (pooledRig != null && pooledRig.IsAlive) {
                if (pooledRig.ScratchTarget == null || !pooledRig.ScratchTarget.IsCreated()) {
                    pooledRig.ScratchTarget = CreateScratchTarget();
                }
                return pooledRig;
            }
            pooledRig?.Dispose();
            var rig = new PainterRig {
                ScratchTarget = CreateScratchTarget(),
            };
            rig.CameraObject = new GameObject("tv plate camera (pooled)") {
                hideFlags = HideFlags.HideAndDontSave,
                layer = OffscreenPainterLayer,
            };
            var camera = rig.CameraObject.AddComponent<Camera>();
            camera.enabled = false;
            camera.clearFlags = CameraClearFlags.SolidColor;
            // The reference ground is `#258cdd`; the aperture is painted over it.
            camera.backgroundColor = new Color(.145f, .549f, .867f, 1f);
            camera.orthographic = true;
            camera.orthographicSize = Height * .5f;
            camera.nearClipPlane = .01f;
            camera.farClipPlane = 100f;
            camera.cullingMask = 1 << OffscreenPainterLayer;
            camera.allowHDR = false;
            camera.allowMSAA = false;
            camera.useOcclusionCulling = false;
            camera.transform.position = PainterOrigin + new Vector3(Width * .5f, Height * .5f, -10f);
            rig.Camera = camera;

            rig.CanvasObject = new GameObject("tv plate canvas (pooled)", typeof(Canvas)) {
                hideFlags = HideFlags.HideAndDontSave,
                layer = OffscreenPainterLayer,
            };
            var canvas = rig.CanvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            var rect = rig.CanvasObject.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(Width, Height);
            rect.position = PainterOrigin + new Vector3(Width * .5f, Height * .5f, 0f);
            rect.localScale = Vector3.one;
            var root = rig.CanvasObject.transform;
            var layout = Layout();
            var fallbackFont = StationUiFont();

            // `drawStationDisplay`: `g.fillRect(layout.poster.x, 0, layout.poster.w, layout.strip.y)`
            // paints `#080a0c` all the way down to the footer strip (`0.90 H`), leaving the
            // dark band below the `0.82 H` content window (`Layout().Poster.H` remains `0.82 H`).
            Panel(root, "poster", new PlateRect {
                X = layout.Poster.X, Y = 0f, W = layout.Poster.W, H = layout.Strip.Y,
            }, new Color(.031f, .039f, .047f, 1f), null);
            var cardColor = new Color(.945f, .949f, .941f, 1f);
            var inkColor = new Color(.063f, .078f, .094f);
            for (int card = 0; card < 3; card++) {
                var box = layout.Card(card);
                Panel(root, "card " + card, box, cardColor, RoundedSprite());
                rig.CardLabels[card] = Row(root, fallbackFont, "", 28, Inset(box, 6f, 6f, 6f, 33f), FontStyle.Bold, inkColor);
                rig.CardSubLabels[card] = Row(root, fallbackFont, "", 15, Inset(box, 8f, 37f, 8f, 22f), FontStyle.Bold, inkColor);
                rig.CardTermini[card] = Row(root, fallbackFont, "", 32, Inset(box, 8f, 62f, 8f, 40f), FontStyle.Normal, inkColor);
                rig.CardStatuses[card] = Row(root, fallbackFont, "", 32, Inset(box, 8f, box.H - 44f, 8f, 40f), FontStyle.Normal, inkColor);
            }
            Panel(root, "station", layout.Station, cardColor, RoundedSprite());
            rig.StationText = Row(root, fallbackFont, "", 27, Inset(layout.Station, 8f, 0f, 8f, layout.Station.H), FontStyle.Normal, inkColor);
            rig.CourtesyText = Row(root, fallbackFont, "", 26,
                new PlateRect { X = layout.Strip.X + 16f, Y = layout.Strip.Y, W = layout.Strip.W - 24f, H = layout.Strip.H },
                FontStyle.Normal, new Color(.933f, .965f, 1f), TextAnchor.MiddleLeft);
            var footerInk = new Color(.024f, .137f, .275f);
            rig.DateText = Row(root, fallbackFont, "", 18,
                new PlateRect { X = layout.Clock.X, Y = layout.Clock.Y + 2f, W = layout.Clock.W, H = 22f },
                FontStyle.Bold, footerInk);
            rig.ClockText = Row(root, fallbackFont, "", 29,
                new PlateRect { X = layout.Clock.X, Y = layout.Clock.Y + 21f, W = layout.Clock.W, H = 32f },
                FontStyle.Bold, footerInk);

            pooledRig = rig;
            return rig;
        }

        static RenderTexture CreateScratchTarget() {
            var rt = new RenderTexture(Width, Height, 16, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB) {
                name = "tv plate scratch rt",
                hideFlags = HideFlags.HideAndDontSave,
                useMipMap = false,
                autoGenerateMips = false,
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
            };
            rt.Create();
            return rt;
        }

        static void PopulateAndRender(PainterRig rig, PlateData data, Font font, RenderTexture target) {
            var face = font != null ? font : StationUiFont();
            var words = StationDisplayWords.For(data.Locale);
            var arrivals = data.Arrivals ?? new StationTvArrival[3];
            for (int card = 0; card < 3; card++) {
                var arrival = card < arrivals.Length ? arrivals[card] : default;
                SetRow(rig.CardLabels[card], face, words.CardLabel(card));
                SetRow(rig.CardSubLabels[card], face, words.CardSubLabel(card));
                SetRow(rig.CardTermini[card], face, data.HasLine ? data.Terminus : words.NoLines);
                SetRow(rig.CardStatuses[card], face, data.HasLine ? words.StatusText(arrival) : words.NoServices);
            }
            SetRow(rig.StationText, face, data.Station);
            SetRow(rig.CourtesyText, face, words.Courtesy);
            SetRow(rig.DateText, face, data.Date);
            SetRow(rig.ClockText, face, data.Clock);

            rig.Camera.targetTexture = target;
            Canvas.ForceUpdateCanvases();
            rig.Camera.Render();
            rig.Camera.targetTexture = null;
        }

        static void SetRow(Text ui, Font font, string text) {
            if (!ui) return;
            if (!ReferenceEquals(ui.font, font)) ui.font = font;
            string next = text ?? "";
            if (!string.Equals(ui.text, next, StringComparison.Ordinal)) ui.text = next;
        }

        /// <summary>
        /// Runtime GPU-owned plate paint: renders with the pooled camera into a depth-capable
        /// target and copies on the GPU into a dedicated RenderTexture (zero ReadPixels stalls).
        /// Falls back to CPU-readable <see cref="Paint"/> outside PlayMode for EditMode tests.
        /// </summary>
        public static Texture PaintRuntime(PlateData data, Font font) {
            if (!Application.isPlaying) return Paint(data, font);
            var rig = EnsureRig();
            var scratch = rig.ScratchTarget;
            PopulateAndRender(rig, data, font, scratch);
            var plateRt = new RenderTexture(Width, Height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB) {
                name = "tv plate " + Stable(data.Key),
                useMipMap = false,
                autoGenerateMips = false,
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                anisoLevel = 4,
            };
            plateRt.Create();
            if ((SystemInfo.copyTextureSupport & UnityEngine.Rendering.CopyTextureSupport.Basic) != 0) {
                Graphics.CopyTexture(scratch, 0, 0, plateRt, 0, 0);
            } else {
                Graphics.Blit(scratch, plateRt);
            }
            return plateRt;
        }

        /// <summary>Paint one plate to a CPU-readable RGBA Texture2D (the caller owns it).</summary>
        public static Texture2D Paint(PlateData data, Font font) {
            RenderTexture previous = RenderTexture.active;
            Texture2D texture = null;
            try {
                var rig = EnsureRig();
                var target = rig.ScratchTarget;
                PopulateAndRender(rig, data, font, target);
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
            var go = new GameObject(name, typeof(RectTransform)) {
                hideFlags = HideFlags.HideAndDontSave,
                layer = OffscreenPainterLayer,
            };
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
            var go = new GameObject("text", typeof(RectTransform)) {
                hideFlags = HideFlags.HideAndDontSave,
                layer = OffscreenPainterLayer,
            };
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
