using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;
using Metro.Build;
using Metro.View;

namespace Metro.App {
    /* ------------------------------------------------------------------ the two mounts */

    /// <summary>The two ways a 指示牌 is fixed (port of `SignMount` in `sim/sign.ts`).</summary>
    public enum StationSignMount { Ceiling = 0, Wall = 1 }

    /// <summary>One logical board face: 正面 or 背面 (`SignFaceName`).</summary>
    public enum StationSignFaceName { Front = 0, Back = 1 }

    /// <summary>The four kinds a board component can be (`SignComponentKind`).</summary>
    public enum StationSignComponentKind { Arrow = 0, Line = 1, Text = 2, Icon = 3 }

    /// <summary>The ten ways an arrow points (`SignArrow`).</summary>
    public enum StationSignArrow {
        Left = 0, Right = 1, Up = 2, Down = 3, UpLeft = 4, UpRight = 5, DownLeft = 6, DownRight = 7,
        UTurnRight = 8, UTurnLeft = 9,
    }

    /// <summary>The pictograms a component may wear (`SignIcon`).</summary>
    public enum StationSignIcon {
        Train = 0, Lift = 1, Accessible = 2, Restroom = 3, Escalator = 4, Stairs = 5, Exit = 6,
        Stop = 7, CustomerService = 8, Separator = 9, Gap = 10,
    }

    /// <summary>The save's own spellings, so no enum name ever reaches the bridge or a document.</summary>
    public static class StationSignVocabulary {
        public static readonly string[] Arrows = {
            "left", "right", "up", "down", "up-left", "up-right", "down-left", "down-right", "uturn-right", "uturn-left",
        };
        public static readonly string[] Icons = {
            "train", "lift", "accessible", "restroom", "escalator", "stairs", "exit", "stop", "customer-service", "separator", "gap",
        };
        /// <summary>The marks `render/signFace.ts` draws instead of loading art (`SIGN_DRAWN_ICONS`).</summary>
        public static readonly StationSignIcon[] DrawnIcons = {
            StationSignIcon.Exit, StationSignIcon.Stop, StationSignIcon.CustomerService,
            StationSignIcon.Separator, StationSignIcon.Gap,
        };

        public static string Arrow(StationSignArrow arrow) => Arrows[Clamp((int)arrow, 0, Arrows.Length - 1)];
        public static string Icon(StationSignIcon icon) => Icons[Clamp((int)icon, 0, Icons.Length - 1)];

        public static StationSignArrow ParseArrow(string value) {
            for (int i = 0; i < Arrows.Length; i++) if (Arrows[i] == value) return (StationSignArrow)i;
            return StationSignArrow.Right;
        }

        public static StationSignIcon ParseIcon(string value) {
            for (int i = 0; i < Icons.Length; i++) if (Icons[i] == value) return (StationSignIcon)i;
            return StationSignIcon.Restroom;
        }

        public static bool TryParseIcon(string value, out StationSignIcon icon) {
            for (int i = 0; i < Icons.Length; i++) {
                if (Icons[i] != value) continue;
                icon = (StationSignIcon)i;
                return true;
            }
            icon = StationSignIcon.Restroom;
            return false;
        }

        public static bool TryParseArrow(string value, out StationSignArrow arrow) {
            for (int i = 0; i < Arrows.Length; i++) {
                if (Arrows[i] != value) continue;
                arrow = (StationSignArrow)i;
                return true;
            }
            arrow = StationSignArrow.Right;
            return false;
        }

        public static bool IsUturn(StationSignArrow arrow) =>
            arrow == StationSignArrow.UTurnRight || arrow == StationSignArrow.UTurnLeft;

        /// <summary>True for the icons that are bitmap art, so a painter must wait for them.</summary>
        public static bool IconNeedsArt(StationSignIcon icon) => Array.IndexOf(DrawnIcons, icon) < 0;

        public static string Face(StationSignFaceName face) => face == StationSignFaceName.Front ? "front" : "back";
        public static string Side(StationSignFaceName face) => face == StationSignFaceName.Front ? "left" : "right";
        public static string Mount(StationSignMount mount) => mount == StationSignMount.Wall ? "wall" : "ceiling";

        static int Clamp(int value, int min, int max) => value < min ? min : value > max ? max : value;
    }

    /* ------------------------------------------------------------------ the mount spec */

    /// <summary>
    /// The panel a mount hangs at and what it mounts — the port of `SignMountSpec`.
    /// The heights are the source's: a hung board rides 0.65 m under its ceiling
    /// (`SIGN_HANG`), a wall board is bolted at eye height, and a booth board is
    /// aligned with the booth's header band.
    /// </summary>
    public static class StationSignMounts {
        public const float BoardThickness = 0.08f;
        public const float HangDrop = 0.65f;
        public const float WallStandOff = 0.003f;
        public const float PanelMinWidth = 1f;
        public const float PanelMinHeight = 0.4f;
        public const float PanelMaxWidth = 3.5f;
        public const float CeilingPanelZ = 2.35f;
        public const float WallPanelZ = 1.65f;
        /// <summary>2.4 − PANEL_MIN_H/2: the booth's header band centre (`boothSigns.ts`).</summary>
        public const float BoothPanelZ = 2.2f;
        public const float PiecePad = 0.02f;
        public const float EndPad = 0.12f;
        public const float RowY = 0.2f;
        public const float EdgePad = 0.006f;
        public const float UturnWidth = 0.24f;
        public const float ArrowWidth = 0.32f;
        public const float LineWidth = 0.28f;
        public const float IconWidth = 0.2f;
        public const float TextHeight = 0.107f;
        public const float TextEnScale = 0.5f;
        public const int TextMax = 24;

        /// <summary>The mount a config names, repaired: absent or unknown is the hanging board.</summary>
        public static StationSignMount Of(string mount) =>
            string.Equals(mount, "wall", StringComparison.Ordinal) ? StationSignMount.Wall : StationSignMount.Ceiling;

        /// <summary>A hung 指示牌 is read from both sides; a wall board has a wall behind it.</summary>
        public static bool DoubleSided(StationSignMount mount) => mount != StationSignMount.Wall;

        public static bool Hung(StationSignMount mount) => mount != StationSignMount.Wall;

        public static float PanelZ(StationSignMount mount, bool booth) =>
            Hung(mount) ? CeilingPanelZ : booth ? BoothPanelZ : WallPanelZ;

        /// <summary>`hangCeilingLocal` semantics: the hang surface's local height, metres.</summary>
        public static float PanelCentre(StationSignMount mount, float hangCeilingLocal, bool booth) =>
            Hung(mount) ? hangCeilingLocal - HangDrop : PanelZ(mount, booth);

        /// <summary>The local 1 m courses a wall board needs solid backing on (`signWallCourses`).</summary>
        public static int[] WallCourses(StationSignMount mount) =>
            Hung(mount) ? Array.Empty<int>() : Courses(WallPanelZ - PanelMinHeight / 2f, PanelMinHeight);

        /// <summary>Port of `wallCourses`: the `[c, c+1)` bands a panel crosses.</summary>
        public static int[] Courses(float bottom, float height) {
            int first = (int)Math.Floor(bottom + 1e-9f);
            int last = Math.Max(first, (int)Math.Ceiling(bottom + height - 1e-9f) - 1);
            var outCourses = new int[Math.Max(0, last - first + 1)];
            for (int i = 0; i < outCourses.Length; i++) outCourses[i] = first + i;
            return outCourses;
        }
    }

    /* ------------------------------------------------------------------ one component */

    /// <summary>
    /// One normalized board component (`SignComponent` in `sim/sign.ts`), the fields
    /// the painter reads. `StationSignRepair` is the normalization boundary; this is
    /// the typed adapter around its JSON, so the viewer and the painter never re-parse
    /// a save on their own.
    /// </summary>
    public sealed class StationSignComponent {
        public string Id = "";
        public StationSignComponentKind Kind;
        /// <summary>Centre on the panel, 0…1 from the left and from the bottom.</summary>
        public float X;
        public float Y = StationSignMounts.RowY;
        public float Scale = 1f;
        /// <summary>`both` | `left` | `right`; an explicit board forces `both`.</summary>
        public string Side = "both";
        public string Text = "";
        public StationSignArrow Arrow = StationSignArrow.Right;
        public StationSignIcon Icon = StationSignIcon.Restroom;
        public string LineId = "";
        public bool English;

        public StationSignComponent Clone() => (StationSignComponent)MemberwiseClone();

        public static StationSignComponent FromJson(JObject value) {
            if (value == null) return null;
            var kind = (string)value["kind"];
            var component = new StationSignComponent {
                Id = value["id"]?.Type == JTokenType.String ? (string)value["id"] : "",
                X = (float)Number(value["x"]),
                Y = (float)Number(value["y"]),
                Scale = (float)Number(value["scale"]),
                Side = "both",
            };
            switch (kind) {
                case "arrow": {
                    component.Kind = StationSignComponentKind.Arrow;
                    var arrow = (string)value["arrow"] ?? "";
                    if (StationSignVocabulary.TryParseArrow(arrow, out var parsed)) component.Arrow = parsed;
                    return component;
                }
                case "line": {
                    component.Kind = StationSignComponentKind.Line;
                    component.LineId = value["lineId"]?.Type == JTokenType.String ? (string)value["lineId"] ?? "" : "";
                    component.English = value["english"]?.Type == JTokenType.Boolean && (bool)value["english"];
                    return component;
                }
                case "text": {
                    if (value["text"]?.Type != JTokenType.String) return null;
                    component.Kind = StationSignComponentKind.Text;
                    component.Text = (string)value["text"] ?? "";
                    return component;
                }
                case "icon": {
                    var icon = (string)value["icon"] ?? "";
                    if (!StationSignVocabulary.TryParseIcon(icon, out var parsed)) return null;
                    component.Kind = StationSignComponentKind.Icon;
                    component.Icon = parsed;
                    return component;
                }
                default:
                    return null;
            }
        }

        static double Number(JToken token) {
            if (token == null || (token.Type != JTokenType.Float && token.Type != JTokenType.Integer)) return 0;
            var value = (double)token;
            return double.IsNaN(value) || double.IsInfinity(value) ? 0 : value;
        }

        public float ClampedScale {
            get {
                if (float.IsNaN(Scale) || float.IsInfinity(Scale)) return 1f;
                return Mathf.Min(2f, Mathf.Max(0.4f, Scale));
            }
        }

        /// <summary>Port of `signTextLines`: at most two rows, each at most 24 characters.</summary>
        public static string[] TextLines(string text) {
            var kept = new List<string>();
            foreach (var row in (text ?? "").Split(new[] { "\r\n", "\n" }, StringSplitOptions.None)) {
                if (row.Length == 0) continue;
                kept.Add(Prefix(row, StationSignMounts.TextMax));
                if (kept.Count == 2) break;
            }
            return kept.ToArray();
        }

        static string Prefix(string value, int count) {
            var output = new StringBuilder();
            int taken = 0;
            for (int i = 0; i < value.Length && taken < count; i++, taken++) {
                output.Append(value[i]);
                if (char.IsHighSurrogate(value[i]) && i + 1 < value.Length && char.IsLowSurrogate(value[i + 1])) output.Append(value[++i]);
            }
            return output.ToString();
        }

        /// <summary>True when a row carries a CJK ideograph, which prints at full size.</summary>
        public static bool HasCjk(string text) {
            foreach (var ch in text ?? "") {
                int code = ch;
                if ((code >= 0x2e80 && code <= 0x303f) || (code >= 0x3040 && code <= 0x30ff) ||
                    (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff) ||
                    (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef)) return true;
            }
            return false;
        }

        /// <summary>`signTextLineScale`: a gloss (Latin-only second row) prints at half size.</summary>
        public static float LineScale(int index, string line) =>
            index == 0 || HasCjk(line) ? 1f : StationSignMounts.TextEnScale;

        /// <summary>Port of `estimateSignTextWidth`: the fallback advance table.</summary>
        public static float EstimateTextWidth(string text, float size) {
            float em = 0;
            for (int i = 0; i < (text ?? "").Length; i++) {
                // A lone surrogate is a character of its own here (as `codePointAt` reads
                // it in the source); only a real pair is decoded together.
                int code = text[i];
                if (char.IsHighSurrogate(text[i]) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1])) {
                    code = char.ConvertToUtf32(text, i);
                    i++;
                }
                if (code >= 0x2e80) em += 1f;
                else if (code == ' ') em += 0.3f;
                else if (code >= '0' && code <= '9') em += 0.58f;
                else if (code >= 'A' && code <= 'Z') em += 0.68f;
                else if (code >= 'a' && code <= 'z') em += 0.55f;
                else em += 0.6f;
            }
            return em * size;
        }

        /// <summary>Port of `signInkSize().w`: what the renderer draws, in metres.</summary>
        public float InkWidth {
            get {
                float scale = ClampedScale;
                switch (Kind) {
                    case StationSignComponentKind.Arrow:
                        return (StationSignVocabulary.IsUturn(Arrow) ? StationSignMounts.UturnWidth : StationSignMounts.ArrowWidth) * scale;
                    case StationSignComponentKind.Line:
                        return StationSignMounts.LineWidth * scale;
                    case StationSignComponentKind.Icon:
                        return StationSignMounts.IconWidth * scale;
                    case StationSignComponentKind.Text: {
                        var lines = TextLines(Text);
                        if (lines.Length == 0) return 0f;
                        float size = StationSignMounts.TextHeight * scale;
                        if (lines.Length == 1) return EstimateTextWidth(lines[0], size * 2f * LineScale(0, lines[0]));
                        return Mathf.Max(
                            EstimateTextWidth(lines[0], size * LineScale(0, lines[0])),
                            EstimateTextWidth(lines[1], size * LineScale(1, lines[1])));
                    }
                    default:
                        return 0f;
                }
            }
        }

        /// <summary>Port of `signPieceSize().w`: the ink plus the piece's own quiet pad.</summary>
        public float PieceWidth {
            get {
                float ink = InkWidth;
                return ink <= 0f ? 0f : ink + StationSignMounts.PiecePad * 2f;
            }
        }

        /// <summary>True when this component paints on `face` (all `both` after repair).</summary>
        public bool PrintsOn(StationSignFaceName face) =>
            Side == "both" || Side == StationSignVocabulary.Side(face);
    }

    /* ------------------------------------------------------------------ the two boards */

    /// <summary>
    /// A sign's pair of boards, repaired — the port of `signBoardsOf` /
    /// `mountedSignBoards`, with `StationSignRepair` remaining the boundary that
    /// normalized the record. A face the config carries is read as written; a face
    /// it does not carry is **empty**, which is the black plate of a one-sided sign.
    /// </summary>
    public sealed class StationSignBoards {
        public static readonly StationSignComponent[] NoComponents = Array.Empty<StationSignComponent>();

        public StationSignComponent[] Front = NoComponents;
        public StationSignComponent[] Back = NoComponents;
        public bool FrontPresent;
        public bool BackPresent;
        /// <summary>False when the record is a shape this packet refuses (a legacy board).</summary>
        public bool Supported = true;
        public string Issue = "";
        public readonly List<string> Dropped = new List<string>();

        public bool HasFront => Front.Length > 0;
        public bool HasBack => Back.Length > 0;

        /// <summary>
        /// Read the normalized `cfg.front` / `cfg.back` JSON of one sign. A config with
        /// neither face is the legacy per-component board, which `StationSignRepair`
        /// refuses and this packet does not re-invent: it comes back unsupported.
        /// </summary>
        public static StationSignBoards FromConfig(string frontJson, string backJson, string componentsJson) {
            var boards = new StationSignBoards();
            bool hasFront = IsArray(frontJson);
            bool hasBack = IsArray(backJson);
            if (!hasFront && !hasBack) {
                if (IsArray(componentsJson)) {
                    boards.Supported = false;
                    boards.Issue = "legacy sign board repair is not ported";
                }
                return boards;
            }
            boards.FrontPresent = hasFront;
            boards.BackPresent = hasBack;
            boards.Front = hasFront ? Normalize(Parse(boards, frontJson)) : NoComponents;
            boards.Back = hasBack ? Normalize(Parse(boards, backJson)) : NoComponents;
            return boards;
        }

        static bool IsArray(string json) {
            if (string.IsNullOrEmpty(json)) return false;
            var text = json.TrimStart();
            return text.Length > 0 && text[0] == '[';
        }

        static StationSignComponent[] Parse(StationSignBoards boards, string json) {
            JArray array;
            try { array = JArray.Parse(json); } catch {
                boards.Supported = false;
                boards.Issue = "invalid sign board JSON";
                return NoComponents;
            }
            var list = new List<StationSignComponent>(array.Count);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in array) {
                var component = StationSignComponent.FromJson(item as JObject);
                if (component == null) {
                    boards.Dropped.Add(item is JObject objectItem ? (string)objectItem["id"] ?? "?" : "?");
                    continue;
                }
                if (component.Id.Length == 0) component.Id = "c" + (list.Count + 1);
                while (!seen.Add(component.Id)) component.Id += "_";
                component.Side = "both";
                list.Add(component);
            }
            // A board the painter cannot read must not be silently shortened: the
            // dropped ids are reported, and the remaining marks still print.
            return list.ToArray();
        }

        /// <summary>
        /// `normalizeSignLayout`: pack the row in the order the document stores, size
        /// the board to it, and fold every mark back inside the frame. Ported from
        /// `sim/sign.ts`; on an already-repaired record it is the identity, which the
        /// Zoo fixture pins (36 non-empty faces, byte-equal output).
        /// </summary>
        public static StationSignComponent[] Normalize(IReadOnlyList<StationSignComponent> layout) {
            if (layout == null || layout.Count == 0) return NoComponents;
            var packed = Pack(layout);
            return Fit(packed, PanelWidth(packed));
        }

        static StationSignComponent[] Pack(IReadOnlyList<StationSignComponent> layout) {
            int count = layout.Count;
            var result = new StationSignComponent[count];
            var widths = new float[count];
            var order = new List<int>(count);
            for (int i = 0; i < count; i++) {
                result[i] = layout[i].Clone();
                widths[i] = result[i].PieceWidth;
                if (widths[i] > 0f) order.Add(i);
            }
            order.Sort((a, b) => {
                int byX = result[a].X.CompareTo(result[b].X);
                return byX != 0 ? byX : a.CompareTo(b);
            });
            var occupied = new List<Vector2>(count);
            foreach (var index in order) {
                float width = widths[index];
                float centre = Mathf.Max(
                    StationSignMounts.EndPad + width / 2f,
                    Mathf.Min(result[index].X, StationSignMounts.PanelMaxWidth - width / 2f));
                occupied.Sort((a, b) => a.x.CompareTo(b.x));
                foreach (var used in occupied) {
                    if (centre - width / 2f < used.y && centre + width / 2f > used.x) centre = used.y + width / 2f;
                }
                if (centre + width / 2f > StationSignMounts.PanelMaxWidth) {
                    centre = Mathf.Max(StationSignMounts.EndPad + width / 2f, StationSignMounts.PanelMaxWidth - width / 2f);
                }
                occupied.Add(new Vector2(centre - width / 2f, centre + width / 2f));
                result[index].X = centre;
                result[index].Y = StationSignMounts.RowY;
            }
            return result;
        }

        /// <summary>`fitSignRow`: move a row that overflowed its own board into its centre, then clamp.</summary>
        static StationSignComponent[] Fit(IReadOnlyList<StationSignComponent> layout, float panel) {
            if (layout.Count == 0) return NoComponents;
            float left = float.PositiveInfinity;
            float right = 0f;
            for (int i = 0; i < layout.Count; i++) {
                float width = layout[i].PieceWidth;
                left = Mathf.Min(left, layout[i].X - width / 2f);
                right = Mathf.Max(right, layout[i].X + width / 2f);
            }
            float shift = panel < StationSignMounts.PanelMaxWidth && left >= StationSignMounts.EdgePad &&
                right > panel - StationSignMounts.EdgePad
                ? (panel - (right - left)) / 2f - left
                : 0f;
            var result = new StationSignComponent[layout.Count];
            for (int i = 0; i < layout.Count; i++) {
                var component = layout[i].Clone();
                float width = component.PieceWidth;
                float half = width / 2f + StationSignMounts.EdgePad;
                float low = half * 2f >= panel ? panel / 2f : half;
                float high = half * 2f >= panel ? panel / 2f : panel - half;
                component.X = Mathf.Min(high, Mathf.Max(low, component.X + shift));
                component.Y = StationSignMounts.RowY;
                component.Scale = component.ClampedScale;
                result[i] = component;
            }
            return result;
        }

        /// <summary>
        /// Port of `signPanelSize`: one row tall, as long as its content needs (the
        /// row's span plus one quiet end pad at each end), clamped to the ceiling and
        /// rounded to the source's 5 cm step. Identical arithmetic on both sides, so
        /// the board Unity mounts is the board the browser prints.
        /// </summary>
        public static float PanelWidth(IReadOnlyList<StationSignComponent> layout) {
            bool any = false;
            float left = 0f;
            float right = 0f;
            for (int i = 0; i < (layout?.Count ?? 0); i++) {
                var component = layout[i];
                float width = component.PieceWidth;
                if (width <= 0f) continue;
                float markLeft = component.X - width / 2f;
                float markRight = component.X + width / 2f;
                if (!any) { left = markLeft; right = markRight; any = true; }
                else { left = Mathf.Min(left, markLeft); right = Mathf.Max(right, markRight); }
            }
            if (!any || right <= 0f) return StationSignMounts.PanelMinWidth;
            return ClampPanel(
                StationSignMounts.PanelMinWidth,
                Mathf.Max(StationSignMounts.PanelMinWidth, right - left + StationSignMounts.EndPad * 2f),
                StationSignMounts.PanelMaxWidth);
        }

        static float ClampPanel(float min, float want, float max) {
            const double step = 0.05;
            // `clampPanel` rounds to the *nearest* 5 cm step (JS Math.round = half up).
            double rounded = Math.Floor((double)want / step + 0.5 + 1e-9) * step;
            double value = Math.Min(max, Math.Max(min, rounded));
            return (float)Math.Round(value, 3);
        }

        /// <summary>
        /// `signBoardsPanel`: both faces print on **one** piece of steel, so the panel
        /// is the wider of the two and neither plate is cut short of the face it carries.
        /// </summary>
        public static Vector2 Panel(StationSignBoards boards) {
            var front = PanelWidth(boards.Front);
            var back = PanelWidth(boards.Back);
            return new Vector2(Mathf.Max(front, back), StationSignMounts.PanelMinHeight);
        }

        /// <summary>`mountedSignBoards`: a wall board mounts 正面 alone; a hung one mounts both.</summary>
        public StationSignBoards Mounted(StationSignMount mount) {
            if (StationSignMounts.DoubleSided(mount)) return this;
            var mounted = new StationSignBoards {
                Front = Front, Back = NoComponents, FrontPresent = FrontPresent, BackPresent = BackPresent,
                Supported = Supported, Issue = Issue,
            };
            mounted.Dropped.AddRange(Dropped);
            return mounted;
        }

        /// <summary>`signFaceHasInk`: a face with nothing on it mounts no plate at all.</summary>
        public static bool HasInk(StationSignComponent[] layout, StationSignFaceName face) {
            if (layout == null) return false;
            for (int i = 0; i < layout.Length; i++) if (layout[i].PrintsOn(face)) return true;
            return false;
        }

        /// <summary>The components one mounted face prints, in paint order.</summary>
        public static StationSignComponent[] Face(StationSignBoards boards, StationSignFaceName face) {
            var source = face == StationSignFaceName.Front ? boards.Front : boards.Back;
            if (source == null || source.Length == 0) return NoComponents;
            var list = new List<StationSignComponent>(source.Length);
            foreach (var component in source) if (component.PrintsOn(face)) list.Add(component);
            return list.ToArray();
        }
    }

    /// <summary>One live line fact a shield prints (id, name, colour).</summary>
    public struct StationSignLine {
        public string Id;
        public string Name;
        public string NameEn;
        public string Colour;

        public StationSignLine(string id, string name, string colour, string nameEn = "") {
            Id = id ?? "";
            Name = name ?? "";
            Colour = colour ?? "";
            NameEn = nameEn ?? "";
        }
    }

    /* ------------------------------------------------------------------ the request */

    /// <summary>
    /// One sign to build, in plain data. The caller places the root: this packet
    /// emits geometry in the root's local space only — local +x is the save's plan
    /// x, local +y is elevation, local +z is the save's plan y — so the host's one
    /// `StationCoordinates.Point` / `ModuleRotation` placement is the only conversion.
    /// </summary>
    public struct StationSignRequest {
        public string ModuleId;
        public StationSignMount Mount;
        public string BoothId;
        /// <summary>
        /// The saved `cfg.boothOffset`, in **document** axes. The caller adds it to the
        /// root's placement (`StationSignViews.Placement` does exactly that); the view
        /// does not step itself, because `SignModel` shifts its placed group and a piece
        /// turned 90° must still move along its booth face.
        /// </summary>
        public float BoothOffsetX;
        public float BoothOffsetY;
        /// <summary>
        /// Local height (above the module's `z+1` plane) of the surface a hung board
        /// hangs from — `hangCeilingLocal` from packet A's mount geometry. Ignored for
        /// a wall mount; 0 is the ceiling of a piece that hangs from the block over it.
        /// </summary>
        public float HangCeilingLocal;
        /// <summary>Normalized `cfg.front` JSON (required), `cfg.back` JSON, legacy `components` JSON.</summary>
        public string FrontJson;
        public string BackJson;
        public string ComponentsJson;
        public StationSignLine[] Lines;
        public string DefaultLineId;
        public string Locale;

        public static StationSignRequest Create(
            string moduleId, StationSignMount mount, string frontJson, string backJson,
            string boothId = "", float boothOffsetX = 0f, float boothOffsetY = 0f, float hangCeilingLocal = 0f) {
            return new StationSignRequest {
                ModuleId = moduleId ?? "",
                Mount = mount,
                FrontJson = frontJson,
                BackJson = backJson,
                BoothId = boothId ?? "",
                BoothOffsetX = boothOffsetX,
                BoothOffsetY = boothOffsetY,
                HangCeilingLocal = hangCeilingLocal,
                Lines = Array.Empty<StationSignLine>(),
                DefaultLineId = "",
                Locale = "zh-CN",
            };
        }
    }

    /* ------------------------------------------------------------------ materials + holders */

    /// <summary>
    /// The materials a sign view draws with. The holder's parts are shared palette
    /// materials; the face template is the lit panel's material, whose texture each
    /// face slot replaces with the board the browser painted.
    /// </summary>
    public struct StationSignMaterials {
        public Material Steel;
        public Material DarkSteel;
        public Material Black;
        public Material FaceTemplate;

        public static StationSignMaterials Create(Material steel, Material darkSteel, Material black, Material faceTemplate) {
            return new StationSignMaterials {
                Steel = steel,
                DarkSteel = darkSteel,
                Black = black != null ? black : darkSteel,
                FaceTemplate = faceTemplate,
            };
        }

        /// <summary>Assign a painted board to a material, on both the legacy and URP slots.</summary>
        public static void ApplyTexture(Material material, Texture texture) {
            if (material == null) return;
            material.mainTexture = texture;
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", texture);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", Color.white);
            if (material.HasProperty("_Color")) material.color = Color.white;
            if (material.HasProperty("_MainTex")) material.SetTexture("_MainTex", texture);
            material.mainTextureScale = Vector2.one;
            material.mainTextureOffset = Vector2.zero;
            // The source plate is **unlit** (`MeshBasicMaterial`): the board prints its
            // own light, so the station's lights must not dim it. URP Lit reaches that
            // through emission; a shader without it simply keeps the base map.
            if (texture == null || !material.HasProperty("_EmissionMap")) return;
            material.EnableKeyword("_EMISSION");
            material.SetTexture("_EmissionMap", texture);
            if (material.HasProperty("_EmissionColor")) material.SetColor("_EmissionColor", Color.white);
            material.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
        }
    }

    /// <summary>
    /// The promoted holders a sign may ride (`sign-ceiling`, `sign-wall` in the
    /// runtime catalogue). They are the source builder's own export at **one**
    /// panel size and hang height, so they are used only when the request still
    /// matches those dimensions and the export's own basis anchors.
    /// </summary>
    public struct StationSignHolderSet {
        public GameObject CeilingHolder;
        public GameObject WallHolder;

        public GameObject For(StationSignMount mount) => mount == StationSignMount.Wall ? WallHolder : CeilingHolder;

        public static StationSignHolderSet FromCatalogue(RuntimeCatalogue catalogue) {
            if (catalogue == null) return default;
            return new StationSignHolderSet {
                CeilingHolder = catalogue.Prefab("sign-ceiling"),
                WallHolder = catalogue.Prefab("sign-wall"),
            };
        }
    }

    /* ------------------------------------------------------------------ one face slot */

    /// <summary>
    /// One mounted board face: the plate the artwork lands on and the texture slot
    /// assigned to it. Front and back are separate slots on purpose — a hung 指示牌
    /// is two independent documents, and the cache keys each one on its own content.
    /// </summary>
    public sealed class StationSignFaceSlot {
        public StationSignFaceName Face;
        public GameObject GameObject;
        public MeshRenderer Renderer;
        public Material Material;
        /// <summary>Plate centre in the view's local space, metres.</summary>
        public Vector3 LocalPosition;
        /// <summary>The direction the printed face is readable from (+z = save plan +y).</summary>
        public Vector3 LocalNormal;
        /// <summary>Yaw about local +y that turns the sheet's readable side to `LocalNormal`.</summary>
        public float LocalYaw;
        public float Width;
        public float Height;
        public Texture2D AppliedTexture;
        public string AppliedFingerprint = "";

        public Vector3 LocalSize => new Vector3(Width, Height, 0f);

        public string Describe() =>
            StationSignVocabulary.Face(Face) + " " + LocalPosition.x.ToString("0.###", CultureInfo.InvariantCulture) + "," +
            LocalPosition.y.ToString("0.###", CultureInfo.InvariantCulture) + "," +
            LocalPosition.z.ToString("0.###", CultureInfo.InvariantCulture) +
            " normal " + LocalNormal.z.ToString("0.###", CultureInfo.InvariantCulture) +
            " plate " + Width.ToString("0.###", CultureInfo.InvariantCulture) + "x" +
            Height.ToString("0.###", CultureInfo.InvariantCulture) +
            (AppliedTexture != null ? " tex " + AppliedTexture.width + "x" + AppliedTexture.height + " " + AppliedFingerprint : " tex none");
    }

    /* ------------------------------------------------------------------ the view */

    /// <summary>
    /// One 指示牌's geometry and its two face slots — the port of
    /// `render/models/pieces/SignModel.ts` into Unity local axes.
    ///
    /// The mount decides everything the source decides: a **hung** board is a dark
    /// steel frame round a black lightbox, hung by two rods sized to the board's own
    /// width up to the surface A's mount geometry reports, with one lit plate per
    /// composed face at ±0.052 m; a **wall** board is the printed sheet alone bolted
    /// at eye height 3 mm proud of the wall (and, on a booth, aligned with the header
    /// band). A **promoted holder** (`SignCeiling.prefab` / `SignWall.prefab`) is
    /// instantiated only when its measured part envelope and its `Front`/`Up`/
    /// `Approach`/`AxisX` anchors still match the request; otherwise the same holder
    /// parts are built at the request's own dimensions, because a signed board grows
    /// and shrinks with its content (`signPanelSize`) and must never be stretched.
    ///
    /// The plane a face prints on is oriented so *that face's own passenger* reads
    /// it: front (正面) looks local +z (the save's plan +y) and back (背面) looks
    /// local −z, which is `SignModel`'s two plate yaws through the coordinate swap.
    /// The viewer's right then lands on the plate's +u, so the painted board reads
    /// left to right on both sides without mirroring either plate.
    /// </summary>
    public sealed class StationSignView : MonoBehaviour {
        static Mesh cubeMesh;
        static Mesh quadMesh;

        readonly List<Material> ownedMaterials = new List<Material>();
        StationSignFaceSlot front;
        StationSignFaceSlot back;
        GameObject holderInstance;

        public StationSignRequest Request { get; private set; }
        public StationSignBoards Boards { get; private set; }
        public Vector2 Panel { get; private set; }
        /// <summary>Non-empty when this record could not be built or is incomplete.</summary>
        public string Issue { get; private set; } = "";
        public bool Supported => Boards != null && Boards.Supported;
        public int BoardCount { get; private set; }
        public bool HolderMatched { get; private set; }
        public string HolderSource { get; private set; } = "parts";
        public float PanelCentreZ { get; private set; }
        public Bounds LocalBounds { get; private set; }
        public StationSignLine[] Lines { get; private set; } = Array.Empty<StationSignLine>();
        public string DefaultLineId { get; private set; } = "";
        public string Locale { get; private set; } = "zh-CN";

        public StationSignFaceSlot Front => front;
        public StationSignFaceSlot Back => back;
        public string ModuleId => Request.ModuleId;
        public StationSignMount Mount => Request.Mount;

        /// <summary>The face slots that carry a plate, in front/back order.</summary>
        public StationSignFaceSlot[] Slots {
            get {
                var list = new List<StationSignFaceSlot>(2);
                if (front != null) list.Add(front);
                if (back != null) list.Add(back);
                return list.ToArray();
            }
        }

        public StationSignFaceSlot Slot(StationSignFaceName face) => face == StationSignFaceName.Front ? front : back;

        /// <summary>
        /// Build one sign. The returned object is **not** placed: the caller sets its
        /// world position/rotation (root at `StationCoordinates.FloorTop` and yaw
        /// `StationCoordinates.ModuleRotation(rot)`), exactly as the other module views
        /// are placed.
        /// </summary>
        public static StationSignView Build(
            StationSignRequest request, StationSignMaterials materials, StationSignHolderSet holders = default,
            Transform parent = null) {
            var gameObject = new GameObject("sign " + (string.IsNullOrEmpty(request.ModuleId) ? "?" : request.ModuleId));
            gameObject.SetActive(false);
            var view = gameObject.AddComponent<StationSignView>();
            view.Request = request;
            view.Lines = request.Lines ?? Array.Empty<StationSignLine>();
            view.DefaultLineId = request.DefaultLineId ?? "";
            view.Locale = string.IsNullOrEmpty(request.Locale) ? "zh-CN" : request.Locale;
            if (parent != null) gameObject.transform.SetParent(parent, false);
            view.BuildGeometry(materials, holders);
            gameObject.SetActive(true);
            return view;
        }

        void BuildGeometry(StationSignMaterials materials, StationSignHolderSet holders) {
            var request = Request;
            var boards = StationSignBoards.FromConfig(request.FrontJson, request.BackJson, request.ComponentsJson);
            if (!boards.Supported) {
                Issue = boards.Issue;
                Boards = boards;
                return;
            }
            var mounted = boards.Mounted(request.Mount);
            var panel = StationSignBoards.Panel(mounted);
            Boards = mounted;
            Panel = panel;
            bool booth = !string.IsNullOrEmpty(request.BoothId);
            bool hung = StationSignMounts.Hung(request.Mount);
            PanelCentreZ = StationSignMounts.PanelCentre(request.Mount, request.HangCeilingLocal, booth);
            // The booth offset is the **caller's** document-space step on the root:
            // `SignModel` shifts its placed group after `placeLocal`, so a piece turned
            // 90° still steps along its booth face. Building the step into the local
            // geometry would rotate it with the piece. `BoothOffsetX/Y` stays on the
            // request as the saved metres that placement reads.

            var holder = holders.For(request.Mount);
            bool matched = TryMatchHolder(holder, request.Mount, panel, PanelCentreZ, request.HangCeilingLocal);
            HolderMatched = matched;
            if (matched) {
                holderInstance = Instantiate(holder, transform, false);
                holderInstance.name = "holder " + holder.name;
                holderInstance.transform.localPosition = Vector3.zero;
                holderInstance.transform.localRotation = Quaternion.identity;
                DisableBakedFaces(holderInstance);
                HolderSource = "promoted:" + holder.name;
            } else {
                HolderSource = "parts";
                BuildParts(materials, panel, hung);
            }

            bool doubleSided = StationSignMounts.DoubleSided(request.Mount);
            if (StationSignBoards.HasInk(mounted.Front, StationSignFaceName.Front)) {
                front = BuildFaceSlot(materials, StationSignFaceName.Front, panel, hung);
                if (front != null) BoardCount++;
            }
            if (doubleSided && StationSignBoards.HasInk(mounted.Back, StationSignFaceName.Back)) {
                back = BuildFaceSlot(materials, StationSignFaceName.Back, panel, hung);
                if (back != null) BoardCount++;
            }
            if (BoardCount == 0 && !hung && string.IsNullOrEmpty(Issue)) Issue = "no board content";
            LocalBounds = Measure();
        }

        /* ---------------------------------------------------------- holder parts */

        /// <summary>
        /// The same parts `SignModel` emits, at the board's own size: the body, its
        /// black lightbox, the two rods and their ceiling plates. A wall board mounts
        /// the sheet alone — the wall is its backing.
        /// </summary>
        void BuildParts(StationSignMaterials materials, Vector2 panel, bool hung) {
            if (!hung) return;
            float width = panel.x;
            float height = panel.y;
            float zc = PanelCentreZ;
            float ceiling = Request.HangCeilingLocal;
            float rodLength = ceiling - (zc + height / 2f) - 0.04f;
            if (rodLength > 0.001f) {
                float rodX = Mathf.Max(0.22f, width / 2f - 0.35f);
                float centre = (zc + height / 2f + ceiling) / 2f;
                for (int side = -1; side <= 1; side += 2) {
                    Box("rod", materials.Steel, new Vector3(side * rodX, centre, 0f),
                        new Vector3(0.05f, rodLength, 0.05f));
                    Box("ceiling plate", materials.DarkSteel, new Vector3(side * rodX, ceiling - 0.02f, 0f),
                        new Vector3(0.16f, 0.04f, 0.16f));
                }
            } else if (string.IsNullOrEmpty(Issue)) {
                Issue = "no headroom for suspension rods";
            }
            Box("frame", materials.DarkSteel, new Vector3(0f, zc, 0f),
                new Vector3(width, StationSignMounts.BoardThickness, height));
            Box("lightbox", materials.Black, new Vector3(0f, zc, 0f),
                new Vector3(width - 0.03f, StationSignMounts.BoardThickness + 0.012f, height - 0.03f));
        }

        /// <summary>
        /// Disable the holder's own baked lit face: the promoted export carries the
        /// palette's **neutral** board, and this packet paints the document's. A baked
        /// plate is a zero-thickness quad, which is what tells it apart from the holder's
        /// rods, frame and lightbox.
        /// </summary>
        static void DisableBakedFaces(GameObject holder) {
            foreach (var filter in holder.GetComponentsInChildren<MeshFilter>(true)) {
                var mesh = filter.sharedMesh;
                if (mesh == null) continue;
                var size = mesh.bounds.size;
                if (Mathf.Min(size.x, Mathf.Min(size.y, size.z)) > 0.001f) continue;
                var renderer = filter.GetComponent<MeshRenderer>();
                if (renderer != null) renderer.enabled = false;
            }
        }

        /* ------------------------------------------------------------ the faces */

        StationSignFaceSlot BuildFaceSlot(
            StationSignMaterials materials, StationSignFaceName face, Vector2 panel, bool hung) {
            float width = panel.x;
            float height = panel.y;
            // A hung board's printed sheet is inset inside the frame (`plate(w - 0.06,
            // h - 0.06)`); a wall/booth sheet is the whole panel, 3 mm proud of the wall.
            float plateWidth = hung ? width - 0.06f : width;
            float plateHeight = hung ? height - 0.06f : height;
            float y = PanelCentreZ;
            float z = hung
                ? (face == StationSignFaceName.Front ? StationSignMounts.BoardThickness / 2f + 0.012f
                    : -(StationSignMounts.BoardThickness / 2f + 0.012f))
                : -0.5f + StationSignMounts.WallStandOff;
            // The sheet's readable side: front (and the wall sheet) look local +z, the
            // hung back looks local −z. The yaw turns the quad's own front (−z) onto it,
            // which also puts the painted +u on the viewer's right.
            Vector3 normal = face == StationSignFaceName.Front ? Vector3.forward : Vector3.back;
            float yaw = face == StationSignFaceName.Front ? 180f : 0f;

            var slot = new StationSignFaceSlot {
                Face = face,
                LocalPosition = new Vector3(0f, y, z),
                LocalNormal = normal,
                LocalYaw = yaw,
                Width = plateWidth,
                Height = plateHeight,
            };
            Material material;
            if (materials.FaceTemplate != null) material = new Material(materials.FaceTemplate);
            else if (materials.Black != null) material = new Material(materials.Black);
            else { Issue = "no face material"; return null; }
            var gameObject = new GameObject("face " + StationSignVocabulary.Face(face), typeof(MeshFilter), typeof(MeshRenderer));
            gameObject.transform.SetParent(transform, false);
            gameObject.transform.localPosition = slot.LocalPosition;
            gameObject.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
            gameObject.transform.localScale = new Vector3(plateWidth, plateHeight, 1f);
            var filter = gameObject.GetComponent<MeshFilter>();
            filter.sharedMesh = QuadMesh();
            material.name = "sign face " + (string.IsNullOrEmpty(Request.ModuleId) ? "?" : Request.ModuleId) + " " + StationSignVocabulary.Face(face);
            ownedMaterials.Add(material);
            var renderer = gameObject.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            slot.GameObject = gameObject;
            slot.Renderer = renderer;
            slot.Material = material;
            return slot;
        }

        /// <summary>Assign a painted board to one face slot; the cache calls this.</summary>
        public void ApplyFaceTexture(StationSignFaceName face, Texture2D texture, string fingerprint = "") {
            var slot = Slot(face);
            if (slot == null) return;
            slot.AppliedTexture = texture;
            slot.AppliedFingerprint = fingerprint ?? "";
            StationSignMaterials.ApplyTexture(slot.Material, texture);
            if (texture != null || slot.Material == null) return;
            // Not painted yet: the plate shows the piece's own dark lightbox rather than
            // flashing a white sheet while the browser paints it.
            var dark = new Color(0.07f, 0.08f, 0.09f, 1f);
            if (slot.Material.HasProperty("_BaseColor")) slot.Material.SetColor("_BaseColor", dark);
            if (slot.Material.HasProperty("_Color")) slot.Material.color = dark;
        }

        /// <summary>The painter request for one mounted face; null when the face mounts nothing.</summary>
        public StationSignFaceRequest FaceRequest(StationSignFaceName face) {
            if (Boards == null || !Boards.Supported) return null;
            var slot = Slot(face);
            if (slot == null) return null;
            return new StationSignFaceRequest {
                ModuleId = Request.ModuleId,
                Face = face,
                PanelWidth = Panel.x,
                PanelHeight = Panel.y,
                Components = StationSignBoards.Face(Boards, face),
                Lines = Lines,
                DefaultLineId = DefaultLineId,
                Locale = Locale,
            };
        }

        public void SetLines(StationSignLine[] lines, string defaultLineId) {
            Lines = lines ?? Array.Empty<StationSignLine>();
            DefaultLineId = defaultLineId ?? "";
        }

        public void SetLocale(string locale) {
            Locale = string.IsNullOrEmpty(locale) ? "zh-CN" : locale;
        }

        /* ----------------------------------------------------------- primitives */

        void Box(string name, Material material, Vector3 centre, Vector3 size) {
            var part = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            part.transform.SetParent(transform, false);
            part.transform.localPosition = centre;
            part.transform.localRotation = Quaternion.identity;
            part.transform.localScale = size;
            part.GetComponent<MeshFilter>().sharedMesh = CubeMesh();
            var renderer = part.GetComponent<MeshRenderer>();
            if (material != null) renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
        }

        Bounds Measure() {
            bool any = false;
            var bounds = new Bounds(Vector3.zero, Vector3.zero);
            foreach (var filter in GetComponentsInChildren<MeshFilter>(true)) {
                var renderer = filter.GetComponent<MeshRenderer>();
                if (renderer != null && !renderer.enabled) continue;
                var mesh = filter.sharedMesh;
                if (mesh == null) continue;
                var matrix = transform.worldToLocalMatrix * filter.transform.localToWorldMatrix;
                var local = mesh.bounds;
                for (int corner = 0; corner < 8; corner++) {
                    var point = local.center + Vector3.Scale(local.extents, new Vector3(
                        (corner & 1) == 0 ? -1f : 1f,
                        (corner & 2) == 0 ? -1f : 1f,
                        (corner & 4) == 0 ? -1f : 1f));
                    var world = matrix.MultiplyPoint3x4(point);
                    if (!any) { bounds = new Bounds(world, Vector3.zero); any = true; }
                    else bounds.Encapsulate(world);
                }
            }
            if (!any) bounds = new Bounds(new Vector3(0f, PanelCentreZ, 0f), new Vector3(Panel.x, Panel.y, 0.08f));
            return bounds;
        }

        static Mesh CubeMesh() {
            if (cubeMesh != null) return cubeMesh;
            cubeMesh = BuildCube();
            cubeMesh.hideFlags = HideFlags.HideAndDontSave;
            return cubeMesh;
        }

        static Mesh QuadMesh() {
            if (quadMesh != null) return quadMesh;
            quadMesh = BuildQuad();
            quadMesh.hideFlags = HideFlags.HideAndDontSave;
            return quadMesh;
        }

        static Mesh BuildQuad() {
            // A unit sheet in local XY with its readable face toward −z and +u toward
            // +x — the source's plate before its yaw. Yawing it 180° turns the readable
            // side to +z and +u to −x, which is exactly the front face's mapping.
            //
            // The four corners are in **clockwise order as seen from the readable side**
            // and the triangles are {0,1,2, 0,2,3}; Unity's front side is the side the
            // triangle's cross product points to, which is the same rule for the boxes
            // below. This is the one thing that cannot be eyeballed from a test, so it is
            // derived here rather than guessed: cross(v1−v0, v2−v0) = −z.
            var mesh = new Mesh { name = "sign face quad" };
            mesh.vertices = new[] {
                new Vector3(-0.5f, -0.5f, 0f), new Vector3(-0.5f, 0.5f, 0f),
                new Vector3(0.5f, 0.5f, 0f), new Vector3(0.5f, -0.5f, 0f),
            };
            mesh.uv = new[] {
                new Vector2(0f, 0f), new Vector2(0f, 1f), new Vector2(1f, 1f), new Vector2(1f, 0f),
            };
            mesh.normals = new[] {
                new Vector3(0f, 0f, -1f), new Vector3(0f, 0f, -1f), new Vector3(0f, 0f, -1f), new Vector3(0f, 0f, -1f),
            };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            mesh.RecalculateBounds();
            return mesh;
        }

        static Mesh BuildCube() {
            var vertices = new Vector3[24];
            var normals = new Vector3[24];
            var uvs = new Vector2[24];
            var triangles = new int[36];
            // Corners arrive clockwise as seen from outside the box; the triangles are
            // {0,1,2, 0,2,3}, and cross(b−a, c−a) then points along the face normal.
            void Face(int index, Vector3 normal, Vector3 a, Vector3 b, Vector3 c, Vector3 d) {
                vertices[index * 4 + 0] = a; vertices[index * 4 + 1] = b;
                vertices[index * 4 + 2] = c; vertices[index * 4 + 3] = d;
                for (int i = 0; i < 4; i++) {
                    normals[index * 4 + i] = normal;
                    uvs[index * 4 + i] = i == 0 ? new Vector2(0f, 0f) : i == 1 ? new Vector2(0f, 1f) : i == 2 ? new Vector2(1f, 1f) : new Vector2(1f, 0f);
                }
                int start = index * 6;
                triangles[start + 0] = index * 4 + 0; triangles[start + 1] = index * 4 + 1; triangles[start + 2] = index * 4 + 2;
                triangles[start + 3] = index * 4 + 0; triangles[start + 4] = index * 4 + 2; triangles[start + 5] = index * 4 + 3;
            }
            float s = 0.5f;
            Face(0, Vector3.left,
                new Vector3(-s, -s, -s), new Vector3(-s, -s, s), new Vector3(-s, s, s), new Vector3(-s, s, -s));
            Face(1, Vector3.right,
                new Vector3(s, -s, -s), new Vector3(s, s, -s), new Vector3(s, s, s), new Vector3(s, -s, s));
            Face(2, Vector3.down,
                new Vector3(-s, -s, -s), new Vector3(s, -s, -s), new Vector3(s, -s, s), new Vector3(-s, -s, s));
            Face(3, Vector3.up,
                new Vector3(-s, s, -s), new Vector3(-s, s, s), new Vector3(s, s, s), new Vector3(s, s, -s));
            Face(4, Vector3.back,
                new Vector3(-s, -s, -s), new Vector3(-s, s, -s), new Vector3(s, s, -s), new Vector3(s, -s, -s));
            Face(5, Vector3.forward,
                new Vector3(-s, -s, s), new Vector3(s, -s, s), new Vector3(s, s, s), new Vector3(-s, s, s));
            var mesh = new Mesh { name = "sign box" };
            mesh.vertices = vertices;
            mesh.normals = normals;
            mesh.uv = uvs;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return mesh;
        }

        /* ------------------------------------------------------------- holder */

        /// <summary>
        /// True when a promoted holder still **is** this request's holder: its measured
        /// part envelope matches the board size and hang height, its baked lit sheet is
        /// the expected plate, and its basis anchors still name the ship's directions
        /// (`Front` = readable face = local +z, `Up`, `Approach` = wall side, `AxisX`).
        /// Anything else falls back to the same parts at the request's dimensions.
        /// </summary>
        public static bool TryMatchHolder(
            GameObject holder, StationSignMount mount, Vector2 panel, float panelCentreZ, float hangCeilingLocal) {
            return MeasureHolder(holder, mount, panel, panelCentreZ, hangCeilingLocal, out _);
        }

        /// <summary>Measure a promoted holder and say why it matches (or does not).</summary>
        public static bool MeasureHolder(
            GameObject holder, StationSignMount mount, Vector2 panel, float panelCentreZ, float hangCeilingLocal,
            out string reason) {
            reason = "";
            if (holder == null) { reason = "no promoted holder"; return false; }
            bool hung = StationSignMounts.Hung(mount);
            if (!hung && Mathf.Abs(panelCentreZ - StationSignMounts.WallPanelZ) > 0.0001f) { reason = "booth/eye height differs"; return false; }
            if (!TryMeasure(holder, out var bounds, out var plate, out var anchors)) { reason = "unmeasurable holder"; return false; }
            const float tolerance = 0.01f;
            if (Mathf.Abs(bounds.size.x - panel.x) > tolerance) { reason = "panel width " + bounds.size.x.ToString("0.###", CultureInfo.InvariantCulture); return false; }
            if (Mathf.Abs(plate.x - (hung ? panel.x - 0.06f : panel.x)) > tolerance ||
                Mathf.Abs(plate.y - (hung ? panel.y - 0.06f : panel.y)) > tolerance) {
                reason = "baked plate " + plate.x.ToString("0.###", CultureInfo.InvariantCulture) + "x" + plate.y.ToString("0.###", CultureInfo.InvariantCulture);
                return false;
            }
            if (!anchors) { reason = "basis anchors missing"; return false; }
            if (!hung) {
                if (Mathf.Abs(bounds.size.y - panel.y) > tolerance) { reason = "panel height"; return false; }
                if (Mathf.Abs(bounds.min.z - (-0.5f + StationSignMounts.WallStandOff)) > tolerance) { reason = "wall stand-off"; return false; }
                reason = "wall holder matches";
                return true;
            }
            float expectedMin = panelCentreZ - panel.y / 2f;
            if (Mathf.Abs(bounds.min.y - expectedMin) > tolerance ||
                Mathf.Abs(bounds.max.y - hangCeilingLocal) > tolerance ||
                Mathf.Abs(bounds.size.z - 0.16f) > tolerance) {
                reason = "hang envelope " + bounds.min.y.ToString("0.###", CultureInfo.InvariantCulture) + ".." +
                    bounds.max.y.ToString("0.###", CultureInfo.InvariantCulture);
                return false;
            }
            reason = "ceiling holder matches";
            return true;
        }

        static bool TryMeasure(GameObject holder, out Bounds bounds, out Vector2 plate, out bool anchors) {
            bounds = new Bounds(Vector3.zero, Vector3.zero);
            plate = Vector2.zero;
            anchors = false;
            bool any = false;
            bool anyPlate = false;
            var root = holder.transform;
            foreach (var filter in holder.GetComponentsInChildren<MeshFilter>(true)) {
                var mesh = filter.sharedMesh;
                if (mesh == null) continue;
                var matrix = root.worldToLocalMatrix * filter.transform.localToWorldMatrix;
                var local = mesh.bounds;
                if (Mathf.Min(local.size.x, Mathf.Min(local.size.y, local.size.z)) <= 0.001f) {
                    // A zero-thickness quad is a printed sheet: the promoted export's
                    // baked neutral face, at the plate the request expects.
                    plate = new Vector2(Mathf.Max(plate.x, local.size.x), Mathf.Max(plate.y, local.size.y));
                    anyPlate = true;
                }
                for (int corner = 0; corner < 8; corner++) {
                    var point = local.center + Vector3.Scale(local.extents, new Vector3(
                        (corner & 1) == 0 ? -1f : 1f,
                        (corner & 2) == 0 ? -1f : 1f,
                        (corner & 4) == 0 ? -1f : 1f));
                    var world = matrix.MultiplyPoint3x4(point);
                    if (!any) { bounds = new Bounds(world, Vector3.zero); any = true; }
                    else bounds.Encapsulate(world);
                }
            }
            if (!any || !anyPlate) return false;
            Vector3 front = Vector3.zero, up = Vector3.zero, approach = Vector3.zero, axisX = Vector3.zero;
            foreach (var child in holder.GetComponentsInChildren<Transform>(true)) {
                switch (child.name) {
                    case "Front": front = root.InverseTransformPoint(child.position); break;
                    case "Up": up = root.InverseTransformPoint(child.position); break;
                    case "Approach": approach = root.InverseTransformPoint(child.position); break;
                    case "AxisX": axisX = root.InverseTransformPoint(child.position); break;
                }
            }
            anchors = front.sqrMagnitude > 0.5f && up.sqrMagnitude > 0.5f && approach.sqrMagnitude > 0.5f && axisX.sqrMagnitude > 0.5f;
            return true;
        }

        /* ------------------------------------------------------------ lifecycle */

        void OnDestroy() {
            foreach (var material in ownedMaterials) DestroyObjectNow(material);
            ownedMaterials.Clear();
        }

        static void DestroyObjectNow(UnityEngine.Object value) {
            if (value == null) return;
            // EditMode tests build and release views too; `Destroy` refuses to run there.
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }

        /// <summary>One line for a per-ID report: mount, panel, boards and applied textures.</summary>
        public string Describe() {
            var text = new StringBuilder();
            text.Append(ModuleId).Append(' ').Append(StationSignVocabulary.Mount(Mount));
            text.Append(" panel ").Append(Panel.x.ToString("0.###", CultureInfo.InvariantCulture))
                .Append('x').Append(Panel.y.ToString("0.###", CultureInfo.InvariantCulture));
            text.Append(" zc ").Append(PanelCentreZ.ToString("0.###", CultureInfo.InvariantCulture));
            text.Append(" boards ").Append(BoardCount).Append(" holder ").Append(HolderSource);
            if (front != null) text.Append(" [").Append(front.Describe()).Append(']');
            if (back != null) text.Append(" [").Append(back.Describe()).Append(']');
            if (!string.IsNullOrEmpty(Issue)) text.Append(" issue=").Append(Issue);
            if (Boards != null && Boards.Dropped.Count > 0) text.Append(" dropped=").Append(string.Join(",", Boards.Dropped));
            return text.ToString();
        }
    }

    /// <summary>
    /// Build a whole document's signs under one role root. The station host calls
    /// <see cref="StationSignRenderer"/> instead; this is the plain entry a test or a
    /// non-host caller uses when it already has requests.
    /// </summary>
    public static class StationSignViews {
        public static StationSignView[] BuildAll(
            IReadOnlyList<StationSignRequest> requests, Transform roleRoot, StationSignMaterials materials,
            StationSignHolderSet holders = default) {
            if (requests == null) return Array.Empty<StationSignView>();
            var views = new StationSignView[requests.Count];
            for (int i = 0; i < requests.Count; i++) {
                views[i] = StationSignView.Build(requests[i], materials, holders, roleRoot);
            }
            return views;
        }

        /// <summary>The sign records of a document, in document order (`type == "sign"`).</summary>
        public static List<Metro.Build.StationModuleRecord> Records(Metro.Build.StationDocument document) {
            var records = new List<Metro.Build.StationModuleRecord>();
            if (document == null) return records;
            for (int i = 0; i < document.Modules.Count; i++) {
                var record = document.Modules[i];
                if (string.Equals(record.Type, "sign", StringComparison.Ordinal)) records.Add(record);
            }
            return records;
        }

        /// <summary>The lines a shield may print, as the painter consumes them.</summary>
        public static StationSignLine[] Lines(Metro.Build.StationDocument document) {
            if (document == null || document.Lines == null) return Array.Empty<StationSignLine>();
            var lines = new StationSignLine[document.Lines.Count];
            for (int i = 0; i < lines.Length; i++) {
                var line = document.Lines[i];
                lines[i] = new StationSignLine(line.Id, line.Name, line.Colour, line.NameEn);
            }
            return lines;
        }

        /// <summary>
        /// One saved module as the view's request. The boards are the module's own
        /// normalized `cfg.front` / `cfg.back` (the reader keeps them as raw JSON), the
        /// mount is `cfg.mount` repaired, and the hang height is `hangCeilingLocal`'s
        /// first branch: a piece anchored on the block over its cell hangs from that
        /// block, at the module's own `z+1` plane (local 0). A piece that is **not**
        /// anchored needs packet A's slab branch, which is not published yet; it falls
        /// back to the source's `storeyHeight - 1` and is reported, never assumed.
        /// </summary>
        public static StationSignRequest RequestFor(
            Metro.Build.StationModuleRecord record, StationSignLine[] lines, string locale = "zh-CN") {
            if (record == null) return default;
            var config = record.Config;
            var boothOffset = BoothOffset(record);
            var mount = StationSignMounts.Of(config.Text("mount"));
            return new StationSignRequest {
                ModuleId = record.Id,
                Mount = mount,
                FrontJson = config.Json("front"),
                BackJson = config.Json("back"),
                ComponentsJson = config.Json("components"),
                BoothId = config.Text("boothId"),
                BoothOffsetX = boothOffset.x,
                BoothOffsetY = boothOffset.y,
                HangCeilingLocal = record.CeilingAnchored ? 0f : (float)(Metro.Build.StationFootprints.StoreyHeight - 1),
                Lines = lines ?? Array.Empty<StationSignLine>(),
                DefaultLineId = lines != null && lines.Length > 0 ? lines[0].Id : "",
                Locale = string.IsNullOrEmpty(locale) ? "zh-CN" : locale,
            };
        }

        /// <summary>
        /// The world placement of one sign: the module's own cell centre on its `z+1`
        /// plane, turned by the saved quarter turn, **plus the booth offset in document
        /// axes** — `SignModel` shifts its placed group after `placeLocal`, so a booth
        /// board steps along the booth face whatever its own rotation is. The caller
        /// sets this on the view's root; the view emits only local geometry.
        /// </summary>
        public static Vector3 Placement(Metro.Build.StationModuleRecord record) {
            if (record == null) return Vector3.zero;
            var placement = ModulePlacement.Position(record.Facts, new Vector3(.5f, .5f, 1f));
            var offset = BoothOffset(record);
            placement.x += offset.x;
            placement.z += offset.y;
            return placement;
        }

        /// <summary>The saved `cfg.boothOffset` in document axes (x, y), or zero.</summary>
        public static Vector2 BoothOffset(Metro.Build.StationModuleRecord record) {
            if (record == null) return Vector2.zero;
            var json = record.Config.Json("boothOffset");
            if (string.IsNullOrEmpty(json) || json.TrimStart()[0] != '{') return Vector2.zero;
            try {
                var offset = Newtonsoft.Json.Linq.JObject.Parse(json);
                return new Vector2(
                    offset["x"] != null ? (float)offset["x"] : 0f,
                    offset["y"] != null ? (float)offset["y"] : 0f);
            } catch (Newtonsoft.Json.JsonException) {
                return Vector2.zero;
            }
        }
    }

    /* ------------------------------------------------------------ edit keys */

    /// <summary>
    /// The content-addressed identity of one board face, computed from the committed
    /// document alone. It builds the exact <see cref="StationSignFaceRequest"/> the
    /// renderer hands the cache (<see cref="StationSignView.FaceRequest"/>), so the key
    /// a `sign.commit` ack reports is the key the next texture request will carry, and
    /// an edit that leaves a face's picture unchanged is a no-op.
    /// </summary>
    public static class StationSignFaceKeys {
        /// <summary>The painter request for one saved sign's face, or null when the record is unsupported.</summary>
        public static StationSignFaceRequest FromRecord(
            Metro.Build.StationModuleRecord record, StationSignFaceName face, StationSignLine[] lines,
            string defaultLineId = null, string locale = "zh-CN") {
            if (record == null) return null;
            var request = StationSignViews.RequestFor(record, lines, locale);
            var boards = StationSignBoards.FromConfig(request.FrontJson, request.BackJson, request.ComponentsJson);
            if (!boards.Supported) return null;
            var mounted = boards.Mounted(request.Mount);
            var panel = StationSignBoards.Panel(mounted);
            return new StationSignFaceRequest {
                ModuleId = record.Id,
                Face = face,
                PanelWidth = panel.x,
                PanelHeight = panel.y,
                Components = StationSignBoards.Face(mounted, face),
                Lines = lines ?? Array.Empty<StationSignLine>(),
                DefaultLineId = string.IsNullOrEmpty(defaultLineId) && lines != null && lines.Length > 0 ? lines[0].Id : defaultLineId ?? "",
                Locale = string.IsNullOrEmpty(locale) ? "zh-CN" : locale,
            };
        }

        /// <summary>The key one face's own components print on a panel of `panel` metres.</summary>
        public static string Key(
            StationSignComponent[] components, StationSignFaceName face, Vector2 panel,
            StationSignLine[] lines, string defaultLineId, string locale) {
            return new StationSignFaceRequest {
                Face = face,
                PanelWidth = panel.x,
                PanelHeight = panel.y,
                Components = components ?? StationSignBoards.NoComponents,
                Lines = lines ?? Array.Empty<StationSignLine>(),
                DefaultLineId = defaultLineId ?? "",
                Locale = string.IsNullOrEmpty(locale) ? "zh-CN" : locale,
            }.ContentKey;
        }

        /// <summary>The lines a commit resolves shields against, as the renderer reads them.</summary>
        public static StationSignLine[] Lines(Metro.Build.StationDocument document) => StationSignViews.Lines(document);

        /// <summary>The default line a shield with no bound line prints (`RequestFor`'s rule).</summary>
        public static string DefaultLine(StationSignLine[] lines) => lines != null && lines.Length > 0 ? lines[0].Id : "";
    }

    /* ------------------------------------------------------------ the edit host */

    /// <summary>
    /// The host surface a `sign.commit` needs. Production is <see cref="StationGameHost"/>
    /// (the adapter below forwards every member one-to-one); a test supplies the same
    /// surface for a <see cref="StationLoadCoordinator"/> that is not under a scene host.
    /// The edit still commits through the host's ordinary atomic transaction, so one
    /// revision and one commit reply are the only outcomes.
    /// </summary>
    public interface IStationSignEditHost {
        Metro.Build.StationDocument Document { get; }
        int CurrentRevision { get; }
        string CurrentSourceId { get; }
        /// <summary>The committed v1 save text the edit is applied to.</summary>
        string SaveDocument();
        /// <summary>Stage and install the complete normalized document (one commit).</summary>
        Metro.App.StationLoadResult ApplyDocumentEdit(string json, string sourceId);
        void RegisterStateContributor(Metro.App.IStationStateContributor contributor);
    }

    /// <summary>The production adapter: a scene <see cref="StationGameHost"/> as an edit host.</summary>
    public sealed class StationGameHostEditHost : IStationSignEditHost {
        readonly StationGameHost host;

        public StationGameHostEditHost(StationGameHost host) {
            this.host = host ?? throw new ArgumentNullException(nameof(host));
        }

        /// <summary>The first scene host, or null in a document-only test.</summary>
        public static StationGameHostEditHost Find() {
            var found = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            return found == null ? null : new StationGameHostEditHost(found);
        }

        public Metro.Build.StationDocument Document => host.Document;
        public int CurrentRevision => host.CurrentRevision;
        public string CurrentSourceId => host.CurrentSourceId;
        public string SaveDocument() => host.SaveDocument();
        public Metro.App.StationLoadResult ApplyDocumentEdit(string json, string sourceId) => host.ApplyDocumentEdit(json, sourceId);
        public void RegisterStateContributor(Metro.App.IStationStateContributor contributor) => host.RegisterStateContributor(contributor);
    }

    /* ------------------------------------------------------------ the commit */

    /// <summary>
    /// The document half of a `sign.commit` (plan 11 F3). <see cref="StationSignEdits"/>
    /// validates the typed transaction; this applies the accepted faces to the committed
    /// v1 save, compares each face's content key so an unchanged board is an idempotent
    /// no-op, and installs the whole document through
    /// <see cref="StationGameHost.ApplyDocumentEdit"/>. A rejection never mutates the
    /// committed document: the edit is applied to a parsed copy, and the install
    /// transaction is the only thing that can replace the station.
    ///
    /// Only the fields the source editor writes are replaced (`cfg.front`/`cfg.back`);
    /// the mount, booth attachment and every other saved field stay exactly as they
    /// were. A face's components are stored with `side: "both"`, which is what
    /// `signBoardsOf` reads back for an explicit board.
    /// </summary>
    public static class StationSignCommit {
        /// <summary>
        /// Apply a validated transaction. On capture the ack fields are written into
        /// <paramref name="ack"/>: `signId`, `face`, `contentKey`, `faces[]`,
        /// `revision`, `changed`. Returns false with a stable code when the document
        /// or the host refused the edit.
        /// </summary>
        public static bool TryCommit(
            IStationSignEditHost host, StationSignEditRequest request, StationSignEditResult validation,
            Newtonsoft.Json.Linq.JObject ack, out string code, out string reason) {
            code = null;
            reason = null;
            if (host == null) { code = "no-session"; reason = "No station host is available."; return false; }
            if (host.Document == null) { code = "no-session"; reason = "No station is committed."; return false; }
            var saved = host.SaveDocument();
            Newtonsoft.Json.Linq.JObject envelope;
            try { envelope = Newtonsoft.Json.Linq.JObject.Parse(saved ?? ""); }
            catch (Exception error) { code = "parse-failed"; reason = "Could not read the committed save: " + error.Message; return false; }
            var modules = (envelope["static"] as Newtonsoft.Json.Linq.JObject)?["modules"] as Newtonsoft.Json.Linq.JArray;
            if (modules == null) { code = "parse-failed"; reason = "The committed save has no static.modules array."; return false; }
            Newtonsoft.Json.Linq.JObject module = null;
            foreach (var token in modules) {
                if (token is Newtonsoft.Json.Linq.JObject candidate && string.Equals((string)candidate["id"], request.SignId, StringComparison.Ordinal)) {
                    module = candidate;
                    break;
                }
            }
            if (module == null) { code = "unknown-sign"; reason = "No sign record '" + request.SignId + "' is committed."; return false; }
            var cfg = module["cfg"] as Newtonsoft.Json.Linq.JObject;
            if (cfg == null) { code = "parse-failed"; reason = "Sign '" + request.SignId + "' has no cfg object."; return false; }

            var record = FindRecord(host.Document, request.SignId);
            var lines = StationSignFaceKeys.Lines(host.Document);
            var defaultLine = StationSignFaceKeys.DefaultLine(lines);
            var mount = StationSignMounts.Of(cfg["mount"] != null ? (string)cfg["mount"] : "");
            var current = StationSignBoards.FromConfig(
                cfg["front"] != null ? cfg["front"].ToString(Newtonsoft.Json.Formatting.None) : "",
                cfg["back"] != null ? cfg["back"].ToString(Newtonsoft.Json.Formatting.None) : "",
                cfg["components"] != null ? cfg["components"].ToString(Newtonsoft.Json.Formatting.None) : "");
            if (!current.Supported) {
                code = "bad-payload";
                reason = "The committed sign is not an explicit front/back board: " + current.Issue;
                return false;
            }

            // Normalize every written face with the same port the renderer uses, then
            // settle the pair's panel before comparing, because a longer front reprints
            // the back on a wider piece of steel.
            var nextFront = current.Front;
            var nextBack = current.Back;
            var writes = new List<(StationSignFaceName Face, StationSignComponent[] Components)>(validation.Applied.Count);
            foreach (var applied in validation.Applied) {
                var components = Normalize(applied.Content);
                var face = applied.Face == StationSignEditFace.Front ? StationSignFaceName.Front : StationSignFaceName.Back;
                if (face == StationSignFaceName.Front) nextFront = components; else nextBack = components;
                writes.Add((face, components));
            }
            var nextMounted = Mounted(nextFront, nextBack, mount);
            var nextPanel = StationSignBoards.Panel(nextMounted);
            var currentMounted = Mounted(current.Front, current.Back, mount);

            var changed = new List<(StationSignFaceName Face, StationSignComponent[] Components, string Key)>(writes.Count);
            foreach (var write in writes) {
                var oldComponents = StationSignBoards.Face(currentMounted, write.Face);
                string oldKey = StationSignFaceKeys.Key(oldComponents, write.Face, nextPanel, lines, defaultLine, StationSignSignage.Locale);
                string newKey = StationSignFaceKeys.Key(write.Components, write.Face, nextPanel, lines, defaultLine, StationSignSignage.Locale);
                if (string.Equals(oldKey, newKey, StringComparison.Ordinal)) continue;
                changed.Add((write.Face, write.Components, newKey));
            }
            if (changed.Count == 0) {
                ack.RemoveAll();
                ack["signId"] = request.SignId;
                ack["face"] = StationSignVocabulary.Face(writes[0].Face);
                var shownFront = StationSignBoards.Face(nextMounted, StationSignFaceName.Front);
                var shownBack = StationSignBoards.Face(nextMounted, StationSignFaceName.Back);
                ack["contentKey"] = StationSignFaceKeys.Key(
                    writes[0].Face == StationSignFaceName.Front ? shownFront : shownBack, writes[0].Face,
                    nextPanel, lines, defaultLine, StationSignSignage.Locale);
                ack["faces"] = FacesJson(shownFront, shownBack, nextPanel, lines, defaultLine);
                ack["changed"] = false;
                ack["revision"] = host.CurrentRevision;
                ack["code"] = "no-change";
                StationSignSignage.LastCommit = (Newtonsoft.Json.Linq.JObject)ack.DeepClone();
                return true;
            }

            // Apply the changed faces to a parsed copy of the committed save. Only the
            // fields the editor owns are replaced; nothing else in the record moves.
            foreach (var write in changed) cfg[StationSignVocabulary.Face(write.Face)] = FaceJson(write.Components);
            var result = host.ApplyDocumentEdit(envelope.ToString(Newtonsoft.Json.Formatting.None), host.CurrentSourceId);
            if (result == null) { code = "no-session"; reason = "The host returned no result."; return false; }
            if (!result.Accepted) {
                code = result.Rejection != null && !string.IsNullOrEmpty(result.Rejection.Code) ? result.Rejection.Code : "rejected";
                reason = result.Rejection != null && !string.IsNullOrEmpty(result.Rejection.Reason) ? result.Rejection.Reason : "The sign edit was refused.";
                return false;
            }

            // Read the keys off the **committed** document: the reader repaired the
            // faces again, and the cache will key on exactly what it stored.
            record = FindRecord(host.Document, request.SignId);
            var committed = new List<(StationSignFaceName Face, string Key)>(changed.Count);
            foreach (var write in changed) {
                var request0 = record != null ? StationSignFaceKeys.FromRecord(record, write.Face, lines, defaultLine, StationSignSignage.Locale) : null;
                committed.Add((write.Face, request0 != null ? request0.ContentKey : write.Key));
            }
            ack.RemoveAll();
            ack["signId"] = request.SignId;
            ack["face"] = StationSignVocabulary.Face(committed[0].Face);
            ack["contentKey"] = committed[0].Key;
            ack["faces"] = FacesJson(committed);
            ack["changed"] = true;
            ack["revision"] = result.Revision;
            ack["code"] = "ok";
            StationSignSignage.LastCommit = (Newtonsoft.Json.Linq.JObject)ack.DeepClone();
            host.RegisterStateContributor(StationSignSignage.State);
            // The commit rebuilds the world, so the new renderer already asked for the
            // new keys. Invalidating the edited sign's plates here also covers an
            // in-place board refresh (a line recolour or locale switch) on the new cache.
            StationSignSignage.Cache?.InvalidateSign(request.SignId);
            return true;
        }

        static Metro.Build.StationModuleRecord FindRecord(Metro.Build.StationDocument document, string id) {
            if (document == null) return null;
            foreach (var module in document.Modules) {
                if (module != null && string.Equals(module.Id, id, StringComparison.Ordinal)) return module;
            }
            return null;
        }

        static StationSignBoards Mounted(StationSignComponent[] front, StationSignComponent[] back, StationSignMount mount) {
            var boards = new StationSignBoards {
                Front = front ?? StationSignBoards.NoComponents,
                Back = back ?? StationSignBoards.NoComponents,
                FrontPresent = true,
                BackPresent = true,
            };
            return boards.Mounted(mount);
        }

        /// <summary>
        /// The typed editor content as the source's `normalizeSignLayout` settles it:
        /// ids repaired, every mark on the one row, the panel grown/clamped to it, and
        /// `side` folded into the face (an explicit board stores `both`).
        /// </summary>
        public static StationSignComponent[] Normalize(StationSignEditFaceContent content) {
            if (content == null || content.Components == null) return StationSignBoards.NoComponents;
            var components = new StationSignComponent[content.Components.Count];
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < components.Length; i++) {
                var source = content.Components[i];
                string id = string.IsNullOrEmpty(source.Id) ? "c" + (i + 1) : source.Id;
                while (!seen.Add(id)) id += "_";
                components[i] = new StationSignComponent {
                    Id = id,
                    Kind = Kind(source.Kind),
                    X = (float)source.X,
                    Y = (float)source.Y,
                    Scale = (float)source.Scale,
                    Side = "both",
                    Text = source.Text ?? "",
                    Arrow = StationSignVocabulary.ParseArrow(source.Arrow),
                    Icon = StationSignVocabulary.ParseIcon(source.Icon),
                    LineId = source.LineId ?? "",
                    English = source.English,
                };
            }
            return StationSignBoards.Normalize(components);
        }

        static StationSignComponentKind Kind(StationSignEditKind kind) {
            switch (kind) {
                case StationSignEditKind.Arrow: return StationSignComponentKind.Arrow;
                case StationSignEditKind.Line: return StationSignComponentKind.Line;
                case StationSignEditKind.Text: return StationSignComponentKind.Text;
                default: return StationSignComponentKind.Icon;
            }
        }

        /// <summary>One committed face as the save stores it, with the source's field names.</summary>
        public static Newtonsoft.Json.Linq.JArray FaceJson(StationSignComponent[] components) {
            var array = new Newtonsoft.Json.Linq.JArray();
            foreach (var component in components ?? StationSignBoards.NoComponents) {
                var value = new Newtonsoft.Json.Linq.JObject {
                    ["id"] = component.Id ?? "",
                    ["kind"] = KindName(component.Kind),
                    ["x"] = Round(component.X),
                    ["y"] = Round(component.Y),
                    ["scale"] = Round(component.ClampedScale),
                    ["side"] = "both",
                };
                switch (component.Kind) {
                    case StationSignComponentKind.Arrow: value["arrow"] = StationSignVocabulary.Arrow(component.Arrow); break;
                    case StationSignComponentKind.Icon: value["icon"] = StationSignVocabulary.Icon(component.Icon); break;
                    case StationSignComponentKind.Line:
                        value["lineId"] = component.LineId ?? "";
                        value["english"] = component.English;
                        break;
                    case StationSignComponentKind.Text: value["text"] = component.Text ?? ""; break;
                }
                array.Add(value);
            }
            return array;
        }

        static string KindName(StationSignComponentKind kind) {
            switch (kind) {
                case StationSignComponentKind.Arrow: return "arrow";
                case StationSignComponentKind.Line: return "line";
                case StationSignComponentKind.Text: return "text";
                default: return "icon";
            }
        }

        static double Round(float value) => Math.Round(value, 4, MidpointRounding.AwayFromZero);

        static Newtonsoft.Json.Linq.JArray FacesJson(StationSignComponent[] front, StationSignComponent[] back, Vector2 panel,
            StationSignLine[] lines, string defaultLine) {
            var faces = new Newtonsoft.Json.Linq.JArray();
            faces.Add(FaceEntry(StationSignFaceName.Front, front, panel, lines, defaultLine));
            faces.Add(FaceEntry(StationSignFaceName.Back, back, panel, lines, defaultLine));
            return faces;
        }

        static Newtonsoft.Json.Linq.JArray FacesJson(List<(StationSignFaceName Face, string Key)> faces) {
            var array = new Newtonsoft.Json.Linq.JArray();
            foreach (var face in faces) {
                array.Add(new Newtonsoft.Json.Linq.JObject {
                    ["face"] = StationSignVocabulary.Face(face.Face),
                    ["contentKey"] = face.Key ?? "",
                });
            }
            return array;
        }

        static Newtonsoft.Json.Linq.JObject FaceEntry(StationSignFaceName face, StationSignComponent[] components, Vector2 panel,
            StationSignLine[] lines, string defaultLine) {
            return new Newtonsoft.Json.Linq.JObject {
                ["face"] = StationSignVocabulary.Face(face),
                ["contentKey"] = StationSignFaceKeys.Key(components, face, panel, lines, defaultLine, StationSignSignage.Locale),
            };
        }
    }

    /// <summary>The last accepted `sign.commit`, published in the commit/state payload as `sign.lastCommit`.</summary>
    public sealed class StationSignCommitState : Metro.App.IStationStateContributor {
        public string Key => "sign";

        public Newtonsoft.Json.Linq.JObject BuildPayload(
            Metro.Build.StationDocument document, Metro.Build.StationIndex index) {
            var last = StationSignSignage.LastCommit;
            return last == null ? null : new Newtonsoft.Json.Linq.JObject { ["lastCommit"] = last.DeepClone() };
        }
    }

    /* ---------------------------------------------------------------- packet wiring */

    /// <summary>
    /// One world's painter connection: the provider, the texture cache and the views
    /// this build minted. It lives on the world's own `signs` role root, so a station
    /// switch can never let the outgoing world's teardown take the incoming station's
    /// painter with it (the renderer singleton is reused across the staged candidate,
    /// so per-world state must belong to the world, not to the renderer).
    /// </summary>
    public sealed class StationSignSignageScope : MonoBehaviour {
        public StationSignWebProvider Provider;
        public StationSignTextureCache Cache;
        public StationSignRenderer Renderer;
        public readonly List<StationSignView> Views = new List<StationSignView>();
        public readonly List<StationSignViewBinding> Bindings = new List<StationSignViewBinding>();
        public StationMaterials Palette;
        public Material FaceTemplate;
        /// <summary>The scope this one replaced; restored if this build never commits.</summary>
        internal StationSignSignageScope Previous;

        void OnDestroy() {
            if (Renderer != null) Renderer.ReleaseScope(this);
            StationSignSignage.Detach(this);
        }
    }

    /// <summary>
    /// The packet's one connection to the plan-11 bridge and to the active station:
    /// the command handler needs the provider the renderer built, and the renderer
    /// needs the host's session/revision to fence stale replies. Both go through
    /// here, so neither file has to reach into the other's build.
    ///
    /// The current connection is a <see cref="StationSignSignageScope"/> owned by the
    /// committed world; a scope that is replaced and then destroyed (the old station,
    /// or a candidate that failed) restores its predecessor instead of clearing it.
    /// </summary>
    public static class StationSignSignage {
        /// <summary>The locale the painted boards are set in; the shell keeps it current.</summary>
        public static string Locale = "zh-CN";
        /// <summary>A test/verifier seam that captures the C#→JS requests (null = the WebGL bridge).</summary>
        public static Action<string> SendHook;

        /// <summary>The world scope the current provider/cache/renderer belong to.</summary>
        public static StationSignSignageScope Scope { get; private set; }
        /// <summary>
        /// The world's painter connection. The properties read through the scope and
        /// answer null once the scope's world has been destroyed, even when the
        /// destroyed world's `OnDestroy` did not run (an inactive candidate that was
        /// abandoned rather than committed).
        /// </summary>
        public static StationSignWebProvider Provider => Scope != null ? Scope.Provider : null;
        public static StationSignTextureCache Cache => Scope != null ? Scope.Cache : null;
        public static StationSignRenderer Renderer => Scope != null ? Scope.Renderer : null;
        /// <summary>The last accepted sign commit, as the `sign.lastCommit` state payload.</summary>
        public static Newtonsoft.Json.Linq.JObject LastCommit;
        public static readonly StationSignCommitState State = new StationSignCommitState();

        internal static void Attach(StationSignSignageScope scope) {
            if (scope == null || scope.Cache == null) return;
            scope.Previous = Scope;
            Scope = scope;
        }

        internal static void Detach(StationSignSignageScope scope) {
            if (scope == null || Scope != scope) return;
            var previous = scope.Previous;
            if (previous != null && previous.gameObject != null) {
                Scope = previous;
                return;
            }
            Scope = null;
        }

        /// <summary>Route one `sign.*` command's raw JSON to the painter's reply channel.</summary>
        public static bool Receive(string json) => Provider != null && Provider.Receive(json);

        /// <summary>Upload whatever the painter has already answered.</summary>
        public static void Pump() => Cache?.Pump();

        /// <summary>Send one C#→JS message: the WebGL state bridge, or a test's hook.</summary>
        public static bool Send(string json) {
            var hook = SendHook;
            if (hook != null) {
                hook(json);
                return true;
            }
            StationWebBridge.Publish(json);
            return true;
        }
    }

    /// <summary>
    /// The plan-11 renderer for the 指示牌 family: one view per saved `sign` record
    /// under the `signs` role root, placed by the shared coordinate contract, with
    /// its two face slots bound to the content-addressed texture cache.
    ///
    /// Each build owns a <see cref="StationSignSignageScope"/> on its own role root.
    /// `Release()` is a teardown no-op because the world that is going away may be an
    /// **older** world than the one the singleton last built (the host stages the
    /// candidate before disposing the previous station); the scope's own destruction
    /// releases exactly the world it belongs to.
    /// </summary>
    public sealed class StationSignRenderer : IStationViewRenderer {
        public const string RoleName = "signs";

        StationSignSignageScope scope;
        StationGameHost host;

        public string Role => RoleName;
        public IReadOnlyList<StationSignView> Views => scope != null ? (IReadOnlyList<StationSignView>)scope.Views : Array.Empty<StationSignView>();
        public StationSignTextureCache Cache => scope?.Cache;
        /// <summary>The view of one saved sign, for a verifier: the edited board re-rendered.</summary>
        public StationSignView View(string moduleId) {
            if (scope == null) return null;
            foreach (var view in scope.Views) if (string.Equals(view.ModuleId, moduleId, StringComparison.Ordinal)) return view;
            return null;
        }

        public void Build(StationViewBuildContext context) {
            host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            if (context.Catalogue == null) {
                context.ReportUnresolved("sign-asset", "renderer", Role, "No RuntimeCatalogue on the station host.");
                return;
            }
            if (context.Shader == null) {
                context.ReportUnresolved("sign-asset", "renderer", Role, "No station shader on the host.");
                return;
            }
            var palette = new StationMaterials(context.Shader);
            var faceTemplate = new Material(context.Shader) { name = "sign face template" };
            faceTemplate.color = Color.white;
            if (faceTemplate.HasProperty("_BaseColor")) faceTemplate.SetColor("_BaseColor", Color.white);
            var materials = StationSignMaterials.Create(
                palette[StationMaterials.Steel], palette[StationMaterials.Dark], palette[StationMaterials.Dark], faceTemplate);
            var holders = StationSignHolderSet.FromCatalogue(context.Catalogue);
            var root = context.RoleRoot(Role);
            // The world's own scope; its destruction (an old station, or an aborted
            // candidate) releases exactly this world's views, cache and palette.
            var built = root.gameObject.AddComponent<StationSignSignageScope>();
            built.Renderer = this;
            built.Palette = palette;
            built.FaceTemplate = faceTemplate;
            built.Provider = new StationSignWebProvider(StationSignSignage.Send, CurrentContext);
            built.Cache = new StationSignTextureCache(built.Provider);

            var lines = StationSignViews.Lines(context.Document);
            var records = StationSignViews.Records(context.Document);
            for (int i = 0; i < records.Count; i++) {
                var record = records[i];
                if (!record.CeilingAnchored && StationSignMounts.Hung(StationSignMounts.Of(record.Config.Text("mount")))) {
                    context.ReportUnresolved("sign-hang", "sign", record.Id,
                        "hangCeilingLocal slab branch is packet A's mount geometry; using the source fallback " +
                        (Metro.Build.StationFootprints.StoreyHeight - 1) + " m");
                }
                var request = StationSignViews.RequestFor(record, lines, StationSignSignage.Locale);
                var view = StationSignView.Build(request, materials, holders, root);
                // The root carries the booth step in document axes (see `StationSignViews.Placement`).
                view.transform.SetPositionAndRotation(StationSignViews.Placement(record), ModulePlacement.Rotation(record.Rotation));
                if (!view.Supported || view.BoardCount == 0) {
                    context.ReportUnresolved("sign-board", "sign", record.Id,
                        view.Issue.Length > 0 ? view.Issue : "no board content");
                    continue;
                }
                context.World.RegisterModule(Role, record.Id, view.gameObject, "board",
                    PanelBounds(record, view), record.Z, record.Z + 1);
                built.Views.Add(view);
                built.Bindings.Add(built.Cache.BindView(view));
            }
            // One bounded request for every board; replies arrive as `sign.faceChunk` /
            // `sign.faceReady` and the command handler pumps them into the slots. The
            // pump component retries the faces the painter reported not-ready later.
            var pumpObject = new GameObject("sign face pump");
            pumpObject.transform.SetParent(root, false);
            pumpObject.AddComponent<StationSignPump>().Cache = built.Cache;
            built.Cache.Pump();
            // Attach last: a build that threw before this point has not replaced the
            // committed station's painter, and a candidate that is later aborted restores
            // its predecessor (`StationSignSignageScope.OnDestroy`).
            scope = built;
            StationSignSignage.Attach(built);
        }

        /// <summary>
        /// Teardown is owned by the world's scope, not by this shared instance: the
        /// host builds the candidate world through the same renderer before the old
        /// world is disposed, so a release here could only guess which world it is for.
        /// </summary>
        public void Release() { }

        /// <summary>Free one world's own resources; called from its scope's destruction.</summary>
        internal void ReleaseScope(StationSignSignageScope released) {
            if (released == null) return;
            for (int i = 0; i < released.Bindings.Count; i++) {
                try { released.Bindings[i]?.Dispose(); } catch (Exception) { /* teardown must not block the next station */ }
            }
            released.Bindings.Clear();
            released.Views.Clear();
            if (released.Cache != null) {
                released.Cache.Dispose();
                released.Cache = null;
            }
            released.Provider = null;
            if (released.FaceTemplate != null) {
                if (Application.isPlaying) UnityEngine.Object.Destroy(released.FaceTemplate);
                else UnityEngine.Object.DestroyImmediate(released.FaceTemplate);
                released.FaceTemplate = null;
            }
            DisposePalette(released.Palette);
            released.Palette = null;
            if (scope == released) {
                scope = null;
                host = null;
            }
        }

        /// <summary>
        /// Free the palette this build minted. `StationMaterials.Dispose` is written for
        /// the player and calls `Object.Destroy`, which logs an error in edit mode — and
        /// the EditMode suite builds real views — so an editor build frees each slot with
        /// `DestroyImmediate` instead. Both paths free the same 14 materials.
        /// </summary>
        static void DisposePalette(StationMaterials palette) {
            if (palette == null) return;
            if (Application.isPlaying) {
                palette.Dispose();
                return;
            }
            for (int i = 0; i < StationMaterials.Colours.Length; i++) {
                var material = palette[i];
                if (material != null) UnityEngine.Object.DestroyImmediate(material);
            }
        }

        StationSignContext CurrentContext() {
            if (host == null) host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            return new StationSignContext {
                SessionId = host != null ? host.ClientSessionId : "",
                Revision = host != null ? host.CurrentRevision : -1,
            };
        }

        /// <summary>The board's envelope in document axes (the view's local axes swapped back).</summary>
        static Metro.Build.StationBox PanelBounds(Metro.Build.StationModuleRecord record, StationSignView view) {
            var local = view.LocalBounds;
            double x0 = record.X + 0.5 + Math.Min(local.min.x, local.max.x);
            double x1 = record.X + 0.5 + Math.Max(local.min.x, local.max.x);
            double y0 = record.Y + 0.5 + Math.Min(local.min.z, local.max.z);
            double y1 = record.Y + 0.5 + Math.Max(local.min.z, local.max.z);
            double z0 = record.Z + 1 + Math.Min(local.min.y, local.max.y);
            double z1 = record.Z + 1 + Math.Max(local.min.y, local.max.y);
            return new Metro.Build.StationBox(x0, y0, z0, x1, y1, z1);
        }
    }

    /// <summary>
    /// The packet's registration: the host snapshots these registries when it builds
    /// a world, so no scene reference or host edit is needed for a new station.
    /// </summary>
    public static class StationSignPacket {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() {
            StationRenderers.Add(new StationSignRenderer());
            StationCommandHandlers.Add(new StationSignCommandHandler());
        }
    }
}
