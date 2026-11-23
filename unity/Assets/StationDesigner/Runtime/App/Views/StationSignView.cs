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
        /// <summary>
        /// The sheet's stand-off in front of the board body: `BOARD_T/2 + 0.012` in
        /// `SignModel.mountHangingSign`, which is the printed plane a hung board uses
        /// until a promoted holder proves a farther one (RCA 15 §2).
        /// </summary>
        public const float FaceStandOff = 0.012f;
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

        /// <summary>Assign a painted board to a material, on legacy, URP, and glTFast slots.</summary>
        public static void ApplyTexture(Material material, Texture texture) {
            if (material == null) return;
            material.mainTexture = texture;
            if (material.HasProperty("baseColorTexture")) material.SetTexture("baseColorTexture", texture);
            if (material.HasProperty("baseColorTexture_ST")) material.SetVector("baseColorTexture_ST", new Vector4(1f, 1f, 0f, 0f));
            if (material.HasProperty("baseColorFactor")) material.SetColor("baseColorFactor", Color.white);
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", texture);
            if (material.HasProperty("_BaseMap_ST")) material.SetVector("_BaseMap_ST", new Vector4(1f, 1f, 0f, 0f));
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

    /* ------------------------------------------------- RCA 15 §2 holder contract */

    /// <summary>
    /// What one measured promoted-holder child is, decided from its own bounds in
    /// sign-local space (RCA 15 §2). The export's spliced nodes are unnamed, so a name
    /// test would be neither stable nor honest; the measured shape decides instead.
    /// </summary>
    public enum StationSignHolderPartKind {
        /// <summary>Nothing the contract recognises — the part decides the verdict.</summary>
        Unknown = 0,
        /// <summary>The body that spans the panel: the sheet's backing.</summary>
        Frame = 1,
        /// <summary>The lightbox enclosed between the frame's faces.</summary>
        Housing = 2,
        /// <summary>A suspension rod rising from the board to the hang surface.</summary>
        Rod = 3,
        /// <summary>A plate at the hang surface the rods fix into.</summary>
        CeilingPlate = 4,
        /// <summary>The holder's own baked printed sheet, and the only part a view may hide.</summary>
        Plate = 5,
    }

    /// <summary>
    /// One promoted-holder child mesh measured in sign-local space (RCA 15 §2). Holding a
    /// `Transform` rather than a formatted path keeps the 21-sign build allocation-free;
    /// the name path is built only when a diagnostic asks for it.
    /// </summary>
    public sealed class StationSignHolderPart {
        /// <summary>Position in the holder's `MeshFilter` traversal (the clone keeps it).</summary>
        public int Index;
        public Transform Root;
        public Transform Transform;
        public MeshRenderer Renderer;
        /// <summary>What the part's measured bounds prove it is (RCA 15 §2).</summary>
        public StationSignHolderPartKind Kind;
        /// <summary>Sign-local bounds of the child's mesh.</summary>
        public Bounds Bounds;
        /// <summary>Enabled and active at measure time — the parts a reader can see.</summary>
        public bool Enabled;
        /// <summary>Hidden by the replaceable-plate rule (never by thickness alone).</summary>
        public bool Hidden;

        public string Name => Transform != null ? Transform.name : "?";
        public string Path => StationSignHolderClearance.PathOf(Root, Transform);

        public string Describe() =>
            Kind.ToString().ToLowerInvariant() + " '" + Path + "' " + (Enabled ? "enabled" : "disabled") +
            (Hidden ? " hidden" : "") + " bounds min(" + Format(Bounds.min) + ") max(" + Format(Bounds.max) + ")";

        internal static string Format(Vector3 value) =>
            value.x.ToString("0.###", CultureInfo.InvariantCulture) + "," +
            value.y.ToString("0.###", CultureInfo.InvariantCulture) + "," +
            value.z.ToString("0.###", CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// The verdict of the RCA 15 §2 holder contract for one request: the parts measured in
    /// sign-local space, the printed plane they were checked against, and — when the holder
    /// is refused — the child that refused it. Kept by reference (no formatted strings), so
    /// the build stays cheap and the readable dump is built only when asked for.
    /// </summary>
    public sealed class StationSignHolderClearance {
        public string HolderName = "";
        public StationSignMount Mount;
        public bool Offered;
        public bool Accepted;
        /// <summary>Why the holder was refused; empty when accepted.</summary>
        public string Reason = "";
        /// <summary>The refusal was a missing frame/rod/ceiling-plate structure.</summary>
        public bool StructureMissing;
        /// <summary>The enabled opaque child that reached the printed face plane.</summary>
        public StationSignHolderPart Offender;
        public Bounds Bounds;
        /// <summary>The holder's baked sheet size, as measured.</summary>
        public Vector2 Plate;
        public bool Anchors;
        /// <summary>The source model's printed plane for this mount (signed local z).</summary>
        public float ReferencePlane;
        /// <summary>The outermost surface of the holder's own body that could cross it.</summary>
        public float ExteriorZ;
        /// <summary>The verified clear printed plane the face slots take (signed local z).</summary>
        public float FaceZ;
        public Vector2 Panel;
        public float PanelCentreZ;
        public float HangCeilingLocal;
        public float PlateWidth;
        public float PlateHeight;
        public StationSignHolderPart[] Parts = Array.Empty<StationSignHolderPart>();

        /// <summary>
        /// True when the holder was refused for its **geometry** — a missing structure or a
        /// child crossing the printed plane — rather than for being the export's one panel
        /// size. That is the refusal a build must report; a size mismatch is the ordinary
        /// "this export is one board" case the fallback exists for.
        /// </summary>
        public bool ContractRejected => Offered && !Accepted && (StructureMissing || Offender != null);

        /// <summary>How many parts the contract recognised as suspension structure.</summary>
        public int RodCount {
            get {
                int count = 0;
                foreach (var part in Parts) if (part.Kind == StationSignHolderPartKind.Rod) count++;
                return count;
            }
        }

        public int CeilingPlateCount {
            get {
                int count = 0;
                foreach (var part in Parts) if (part.Kind == StationSignHolderPartKind.CeilingPlate) count++;
                return count;
            }
        }

        public int BodyCount {
            get {
                int count = 0;
                foreach (var part in Parts)
                    if (part.Kind == StationSignHolderPartKind.Frame || part.Kind == StationSignHolderPartKind.Housing) count++;
                return count;
            }
        }

        public int PlateCount {
            get {
                int count = 0;
                foreach (var part in Parts) if (part.Kind == StationSignHolderPartKind.Plate) count++;
                return count;
            }
        }

        /// <summary>One line: the verdict, the plane and the refusing child.</summary>
        public string DescribeReason() {
            if (!Offered) return "no promoted holder offered";
            var text = new StringBuilder();
            text.Append("holder ").Append(string.IsNullOrEmpty(HolderName) ? "?" : HolderName);
            text.Append(Accepted ? " accepted" : " REJECTED: " + Reason);
            text.Append("; printed plane ");
            text.Append(ReferencePlane.ToString("0.###", CultureInfo.InvariantCulture));
            if (Accepted) {
                text.Append(" cleared to ").Append(FaceZ.ToString("0.###", CultureInfo.InvariantCulture));
            } else if (Offender != null) {
                text.Append("; child '").Append(Offender.Path).Append("' bounds min(")
                    .Append(StationSignHolderPart.Format(Offender.Bounds.min)).Append(") max(")
                    .Append(StationSignHolderPart.Format(Offender.Bounds.max)).Append(')');
            }
            return text.ToString();
        }

        /// <summary>The full dump: the verdict, every measured child and the face-plane math.</summary>
        public string Describe() {
            var text = new StringBuilder();
            text.Append("  holder ").Append(string.IsNullOrEmpty(HolderName) ? "(none)" : HolderName)
                .Append(" mount ").Append(StationSignVocabulary.Mount(Mount));
            text.Append(" panel ").Append(Panel.x.ToString("0.###", CultureInfo.InvariantCulture))
                .Append('x').Append(Panel.y.ToString("0.###", CultureInfo.InvariantCulture))
                .Append(" centre z ").Append(PanelCentreZ.ToString("0.###", CultureInfo.InvariantCulture))
                .Append(" hang ").Append(HangCeilingLocal.ToString("0.###", CultureInfo.InvariantCulture));
            text.Append(' ').Append(DescribeReason()).Append('\n');
            text.Append("  envelope min(").Append(StationSignHolderPart.Format(Bounds.min)).Append(") max(")
                .Append(StationSignHolderPart.Format(Bounds.max)).Append(") baked sheet ")
                .Append(Plate.x.ToString("0.###", CultureInfo.InvariantCulture)).Append('x')
                .Append(Plate.y.ToString("0.###", CultureInfo.InvariantCulture))
                .Append(" anchors ").Append(Anchors ? "yes" : "no").Append('\n');
            if (Parts.Length == 0) {
                text.Append("  no holder children measured\n");
            } else {
                foreach (var part in Parts) text.Append("  ").Append(part.Index).Append(' ').Append(part.Describe()).Append('\n');
            }
            text.Append("  body exterior ").Append(ExteriorZ.ToString("0.###", CultureInfo.InvariantCulture))
                .Append(" face plane ").Append(FaceZ.ToString("0.###", CultureInfo.InvariantCulture))
                .Append(" (reference ").Append(ReferencePlane.ToString("0.###", CultureInfo.InvariantCulture)).Append(')');
            return text.ToString();
        }

        internal static string PathOf(Transform root, Transform child) {
            if (child == null) return "?";
            var names = new Stack<string>();
            for (var walk = child; walk != null && walk != root; walk = walk.parent) names.Push(walk.name);
            var text = new StringBuilder();
            foreach (var name in names) {
                if (text.Length > 0) text.Append('/');
                text.Append(name);
            }
            if (text.Length == 0) text.Append(root != null ? root.name : "?");
            return text.ToString();
        }

        internal void Refuse(string reason) {
            Accepted = false;
            Reason = reason;
        }

        internal void RefuseStructure(string reason) {
            StructureMissing = true;
            Refuse(reason);
        }

        internal void RefusePart(StationSignHolderPart part, string reason) {
            Offender = part;
            Refuse(reason);
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
        /// <summary>
        /// RCA 15 §2: the promoted-holder verdict, including every measured child and the
        /// child that refused the holder. Null when the request offered no holder at all.
        /// </summary>
        public StationSignHolderClearance HolderClearance { get; private set; }
        /// <summary>
        /// RCA 15 §2: the verified clear printed plane the face slots use — the accepted
        /// holder's measured exterior, or the procedural parts' own exterior.
        /// </summary>
        public float FacePlaneZ { get; private set; }
        /// <summary>
        /// Why a promoted holder was refused, naming the offending child and its bounds, or
        /// "" when it was accepted or never offered. Built on demand so the Zoo build pays
        /// nothing for it.
        /// </summary>
        public string HolderDiagnostic =>
            HolderClearance != null && HolderClearance.Offered && !HolderClearance.Accepted
                ? HolderClearance.DescribeReason()
                : "";
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

            // RCA 15 §2: a promoted holder is accepted only on the verified contract
            // (`TryVerifyHolder`), and the printed plane then comes from the holder's own
            // measured clear exterior — never from a constant that may sit inside it.
            var holder = holders.For(request.Mount);
            bool matched = TryVerifyHolder(holder, request.Mount, panel, PanelCentreZ, request.HangCeilingLocal,
                out var clearance);
            HolderClearance = clearance;
            HolderMatched = matched;
            if (matched) {
                holderInstance = Instantiate(holder, transform, false);
                holderInstance.name = "holder " + holder.name;
                holderInstance.transform.localPosition = Vector3.zero;
                holderInstance.transform.localRotation = Quaternion.identity;
                // Only a part the contract identified as a replaceable sheet may be hidden;
                // an extruded baked board would have refused the holder already.
                DisableReplaceablePlates(holderInstance, clearance);
                HolderSource = "promoted:" + holder.name;
                FacePlaneZ = clearance.FaceZ;
            } else {
                HolderSource = "parts";
                FacePlaneZ = ProceduralFacePlane(hung);
                BuildParts(materials, panel, hung);
            }

            bool doubleSided = StationSignMounts.DoubleSided(request.Mount);
            if (StationSignBoards.HasInk(mounted.Front, StationSignFaceName.Front)) {
                front = BuildFaceSlot(materials, StationSignFaceName.Front, panel, hung, FacePlaneZ);
                if (front != null) BoardCount++;
            }
            if (doubleSided && StationSignBoards.HasInk(mounted.Back, StationSignFaceName.Back)) {
                back = BuildFaceSlot(materials, StationSignFaceName.Back, panel, hung, FacePlaneZ);
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
            // RCA 15 §2: the body is a **vertical** board — width, height, then the board's
            // thickness on the depth axis — which is `SignModel.mountHangingSign`'s
            // `slab(g, …, W, BOARD_T, H)` after the coordinate swap. Swapping the last two
            // axes here draws a horizontal slab whose ±H/2 depth crosses both printed sheets
            // at ±0.052: the solid bar across the text in the screenshot.
            Box("frame", materials.DarkSteel, new Vector3(0f, zc, 0f),
                new Vector3(width, height, StationSignMounts.BoardThickness));
            Box("lightbox", materials.Black, new Vector3(0f, zc, 0f),
                new Vector3(width - 0.03f, height - 0.03f, StationSignMounts.BoardThickness + 0.012f));
        }

        /// <summary>
        /// The printed plane the procedural path draws on: the source model's own
        /// `plate(w − 0.06, h − 0.06)` at `±(BOARD_T/2 + 0.012)` for a hung board, and the
        /// sheet 3 mm proud of the wall for a wall board. `BuildParts` emits exactly those
        /// parts, so the plane is the parts' own exterior and not a guess (RCA 15 §2).
        /// </summary>
        static float ProceduralFacePlane(bool hung) =>
            hung ? StationSignMounts.BoardThickness / 2f + StationSignMounts.FaceStandOff
                : -0.5f + StationSignMounts.WallStandOff;

        /// <summary>
        /// Hide the promoted holder's own baked printed sheet — and **only** that (RCA 15
        /// §2). The export carries the palette's neutral board where this packet paints the
        /// document's. A part is hidden only when the contract positively identified it as a
        /// replaceable flat plate; an extruded baked board or lightbox is never hidden by a
        /// thickness rule, it refuses the holder instead (`TryVerifyHolder`). The clone is
        /// matched to the measured parts by `MeshFilter` traversal order, because both trees
        /// are the same hierarchy.
        /// </summary>
        static void DisableReplaceablePlates(GameObject instance, StationSignHolderClearance clearance) {
            if (instance == null || clearance == null || clearance.Parts.Length == 0) return;
            var filters = instance.GetComponentsInChildren<MeshFilter>(true);
            for (int i = 0; i < filters.Length && i < clearance.Parts.Length; i++) {
                var part = clearance.Parts[i];
                if (part.Kind != StationSignHolderPartKind.Plate) continue;
                var renderer = filters[i].GetComponent<MeshRenderer>();
                // Not `Draws`: the view is still inactive while it builds, so a visibility
                // walk would always say no. The measured `Enabled` flag already recorded
                // whether the part draws in the inert holder.
                if (renderer == null || !renderer.enabled) continue;
                renderer.enabled = false;
                part.Hidden = true;
            }
        }

        /* ------------------------------------------------------------ the faces */

        StationSignFaceSlot BuildFaceSlot(
            StationSignMaterials materials, StationSignFaceName face, Vector2 panel, bool hung, float facePlaneZ) {
            float width = panel.x;
            float height = panel.y;
            // A hung board's printed sheet is inset inside the frame (`plate(w - 0.06,
            // h - 0.06)`); a wall/booth sheet is the whole panel, 3 mm proud of the wall.
            float plateWidth = hung ? width - 0.06f : width;
            float plateHeight = hung ? height - 0.06f : height;
            float y = PanelCentreZ;
            // RCA 15 §2: the plane is the accepted holder's verified clear exterior (or the
            // procedural parts' own exterior), so no holder part can sit in front of the
            // text. A hung board prints on both sides of it; a wall board's sheet is the
            // signed local z itself.
            float z = hung ? (face == StationSignFaceName.Front ? facePlaneZ : -facePlaneZ) : facePlaneZ;
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
        /// part envelope matches the board size and hang height, its parts carry the
        /// structure the mount needs, its baked lit sheet is the expected plate, its basis
        /// anchors still name the ship's directions (`Front` = readable face = local +z,
        /// `Up`, `Approach` = wall side, `AxisX`), and none of its opaque parts reaches the
        /// printed face plane (RCA 15 §2). Anything else falls back to the same parts at the
        /// request's dimensions.
        /// </summary>
        public static bool TryMatchHolder(
            GameObject holder, StationSignMount mount, Vector2 panel, float panelCentreZ, float hangCeilingLocal) {
            return TryVerifyHolder(holder, mount, panel, panelCentreZ, hangCeilingLocal, out _);
        }

        /// <summary>
        /// Measure a promoted holder and say why it matches (or does not) — including, on a
        /// refusal, the path and measured bounds of the child responsible (RCA 15 §2).
        /// </summary>
        public static bool MeasureHolder(
            GameObject holder, StationSignMount mount, Vector2 panel, float panelCentreZ, float hangCeilingLocal,
            out string reason) {
            bool matched = TryVerifyHolder(holder, mount, panel, panelCentreZ, hangCeilingLocal, out var clearance);
            reason = clearance != null ? clearance.DescribeReason() : "";
            return matched;
        }

        /// <summary>
        /// The RCA 15 §2 holder contract. A promoted holder is used only when it proves
        /// both halves:
        ///
        ///  * **structure** — a hung board needs the suspension it hangs from (a rod or a
        ///    ceiling plate in the band above the panel) *and* a body (frame/housing) the
        ///    sheet prints onto. A bare sheet is a material, not a holder.
        ///  * **clearance** — no enabled opaque part that overlaps the printed rectangle
        ///    may reach the printed face plane. The plane is the source model's
        ///    `BOARD_T/2 + 0.012` for a hung board (the wall's sheet plane for a wall
        ///    board), and the accepted holder's own measured exterior then sets the plane
        ///    the face slots use, so the printed sheet always sits outside every part that
        ///    could cross it.
        ///
        /// Every refusal keeps the measured parts and names the child responsible, which is
        /// the point of the packet: a bar across the text must be attributable.
        /// </summary>
        public static bool TryVerifyHolder(
            GameObject holder, StationSignMount mount, Vector2 panel, float panelCentreZ, float hangCeilingLocal,
            out StationSignHolderClearance clearance) {
            bool hung = StationSignMounts.Hung(mount);
            float plateWidth = hung ? panel.x - 0.06f : panel.x;
            float plateHeight = hung ? panel.y - 0.06f : panel.y;
            clearance = new StationSignHolderClearance {
                HolderName = holder != null ? holder.name : "",
                Mount = mount,
                Offered = holder != null,
                Panel = panel,
                PanelCentreZ = panelCentreZ,
                HangCeilingLocal = hangCeilingLocal,
                PlateWidth = plateWidth,
                PlateHeight = plateHeight,
                ReferencePlane = hung
                    ? StationSignMounts.BoardThickness / 2f + StationSignMounts.FaceStandOff
                    : -0.5f + StationSignMounts.WallStandOff,
            };
            if (holder == null) { clearance.Refuse("no promoted holder"); return false; }
            if (!hung && Mathf.Abs(panelCentreZ - StationSignMounts.WallPanelZ) > 0.0001f) {
                clearance.Refuse("booth/eye height differs");
                return false;
            }
            if (!MeasureParts(holder, clearance, out var bounds, out var plate, out var anchors)) {
                clearance.Refuse("unmeasurable holder");
                return false;
            }
            clearance.Bounds = bounds;
            clearance.Plate = plate;
            clearance.Anchors = anchors;
            Classify(clearance, hung);
            // 1. Structure first: a holder that is only a sheet has nothing to hang from,
            //    whatever its measured size, and that refusal must say so.
            if (hung && (clearance.RodCount + clearance.CeilingPlateCount == 0)) {
                clearance.RefuseStructure("no rod/ceiling-plate suspension structure");
                return false;
            }
            if (hung && clearance.BodyCount == 0) {
                clearance.RefuseStructure("no frame/housing for the printed sheet");
                return false;
            }
            const float tolerance = 0.01f;
            if (Mathf.Abs(bounds.size.x - panel.x) > tolerance) {
                clearance.Refuse("panel width " + bounds.size.x.ToString("0.###", CultureInfo.InvariantCulture));
                return false;
            }
            if (Mathf.Abs(plate.x - plateWidth) > tolerance || Mathf.Abs(plate.y - plateHeight) > tolerance) {
                clearance.Refuse("baked plate " + plate.x.ToString("0.###", CultureInfo.InvariantCulture) + "x" +
                    plate.y.ToString("0.###", CultureInfo.InvariantCulture));
                return false;
            }
            if (!anchors) { clearance.Refuse("basis anchors missing"); return false; }
            if (!hung) {
                if (Mathf.Abs(bounds.size.y - panel.y) > tolerance) { clearance.Refuse("panel height"); return false; }
                if (Mathf.Abs(bounds.min.z - (-0.5f + StationSignMounts.WallStandOff)) > tolerance) {
                    clearance.Refuse("wall stand-off");
                    return false;
                }
            } else {
                float expectedMin = panelCentreZ - panel.y / 2f;
                if (Mathf.Abs(bounds.min.y - expectedMin) > tolerance ||
                    Mathf.Abs(bounds.max.y - hangCeilingLocal) > tolerance ||
                    Mathf.Abs(bounds.size.z - 0.16f) > tolerance) {
                    clearance.Refuse("hang envelope " + bounds.min.y.ToString("0.###", CultureInfo.InvariantCulture) +
                        ".." + bounds.max.y.ToString("0.###", CultureInfo.InvariantCulture));
                    return false;
                }
                // 2. The suspension really reaches the surface the request hangs from.
                float rodTop = float.NegativeInfinity;
                foreach (var part in clearance.Parts) {
                    if (part.Kind != StationSignHolderPartKind.Rod || !part.Enabled) continue;
                    if (part.Bounds.max.y > rodTop) rodTop = part.Bounds.max.y;
                }
                if (!float.IsNegativeInfinity(rodTop) && rodTop < hangCeilingLocal - 0.12f) {
                    clearance.Refuse("suspension rods stop " + (hangCeilingLocal - rodTop)
                        .ToString("0.###", CultureInfo.InvariantCulture) + " m short of the hang surface");
                    return false;
                }
            }
            // 3. Clearance: every enabled opaque part that overlaps the printed rectangle
            //    must stay behind the printed plane. Between the two planes is the board's
            //    own body; at or past them is the reader's view of the text.
            foreach (var part in clearance.Parts) {
                if (!part.Enabled || part.Kind == StationSignHolderPartKind.Plate) continue;
                if (!OverlapsPrintedRect(part.Bounds, panelCentreZ, plateWidth, plateHeight)) continue;
                if (part.Bounds.max.z >= clearance.ReferencePlane - 0.002f) {
                    clearance.RefusePart(part, "crosses the printed face plane " +
                        clearance.ReferencePlane.ToString("0.###", CultureInfo.InvariantCulture));
                    return false;
                }
                if (hung && part.Bounds.min.z <= -clearance.ReferencePlane + 0.002f) {
                    clearance.RefusePart(part, "crosses the back printed face plane");
                    return false;
                }
            }
            // 4. The verified clear exterior sets the plane the sheets print on. The
            //    holder's body is what the sheet must clear; the rods and ceiling plates
            //    sit above the board and can never cross its rectangle.
            float exterior = 0f;
            foreach (var part in clearance.Parts) {
                if (!part.Enabled || part.Kind == StationSignHolderPartKind.Plate) continue;
                if (!OverlapsPrintedRect(part.Bounds, panelCentreZ, plateWidth, plateHeight)) continue;
                float reach = Mathf.Max(Mathf.Abs(part.Bounds.min.z), Mathf.Abs(part.Bounds.max.z));
                if (reach > exterior) exterior = reach;
            }
            clearance.ExteriorZ = exterior;
            clearance.FaceZ = hung
                ? Mathf.Max(exterior + StationSignMounts.FaceStandOff, clearance.ReferencePlane)
                : clearance.ReferencePlane;
            clearance.Accepted = true;
            clearance.Reason = hung ? "ceiling holder matches" : "wall holder matches";
            return true;
        }

        /// <summary>
        /// Classify every measured child from its bounds alone (RCA 15 §2). The export's
        /// spliced nodes are unnamed, so shape is the only honest evidence: a sheet is the
        /// expected plate exactly, a rod is tall and narrow in the band above the panel, a
        /// ceiling plate is flat at the hang surface, the frame spans the panel and the
        /// lightbox is enclosed inside it.
        /// </summary>
        static void Classify(StationSignHolderClearance clearance, bool hung) {
            const float thin = 0.001f;
            Vector2 panel = clearance.Panel;
            float plateWidth = clearance.PlateWidth;
            float plateHeight = clearance.PlateHeight;
            float zc = clearance.PanelCentreZ;
            float hang = clearance.HangCeilingLocal;
            float panelTop = zc + panel.y / 2f;
            foreach (var part in clearance.Parts) {
                if (!part.Enabled) { part.Kind = StationSignHolderPartKind.Unknown; continue; }
                var size = part.Bounds.size;
                float min = Mathf.Min(size.x, Mathf.Min(size.y, size.z));
                // The holder's own baked sheet: zero-thickness, flat in z, the exact plate.
                if (min <= thin && size.x > thin && size.y > thin &&
                    Mathf.Abs(part.Bounds.center.z) >= StationSignMounts.BoardThickness / 2f - 0.001f &&
                    Mathf.Abs(size.x - plateWidth) <= 0.02f && Mathf.Abs(size.y - plateHeight) <= 0.02f) {
                    part.Kind = StationSignHolderPartKind.Plate;
                    continue;
                }
                if (hung) {
                    // Suspension: a narrow part reaching up past the panel toward the hang.
                    if (size.y >= 0.1f && Mathf.Max(size.x, size.z) <= 0.2f && part.Bounds.center.y > panelTop) {
                        part.Kind = StationSignHolderPartKind.Rod;
                        continue;
                    }
                    if (min <= 0.06f && part.Bounds.center.y >= hang - 0.12f) {
                        part.Kind = StationSignHolderPartKind.CeilingPlate;
                        continue;
                    }
                }
                // Body: the frame spans the panel; the lightbox is enclosed inside it. Both
                // must stay within the source board's own thickness (`BoardThickness`).
                if (size.z > StationSignMounts.BoardThickness + 0.02f) continue;
                if (size.x >= panel.x - 0.02f && size.y >= panel.y - 0.02f) {
                    part.Kind = StationSignHolderPartKind.Frame;
                    continue;
                }
                if (size.x >= plateWidth - 0.02f && size.y >= plateHeight - 0.02f &&
                    size.x <= panel.x + 0.02f && size.y <= panel.y + 0.02f) {
                    part.Kind = StationSignHolderPartKind.Housing;
                }
            }
        }

        /// <summary>True when a part's bounds share area with the printed rectangle.</summary>
        static bool OverlapsPrintedRect(Bounds part, float panelCentreZ, float plateWidth, float plateHeight) {
            const float edge = 0.002f;
            if (part.max.x <= -plateWidth / 2f + edge || part.min.x >= plateWidth / 2f - edge) return false;
            if (part.max.y <= panelCentreZ - plateHeight / 2f + edge ||
                part.min.y >= panelCentreZ + plateHeight / 2f - edge) return false;
            return true;
        }

        /// <summary>
        /// Measure every child mesh in the holder's own local space, keeping the parts so a
        /// refusal can name one. `Parts` stays one-to-one with the `MeshFilter` traversal,
        /// which is what lets the clone hide exactly the measured sheet.
        /// </summary>
        static bool MeasureParts(
            GameObject holder, StationSignHolderClearance clearance, out Bounds bounds, out Vector2 plate,
            out bool anchors) {
            bounds = new Bounds(Vector3.zero, Vector3.zero);
            plate = Vector2.zero;
            anchors = false;
            bool any = false;
            bool anyPlate = false;
            var root = holder.transform;
            var filters = holder.GetComponentsInChildren<MeshFilter>(true);
            var parts = new StationSignHolderPart[filters.Length];
            for (int index = 0; index < filters.Length; index++) {
                var filter = filters[index];
                var part = new StationSignHolderPart {
                    Index = index,
                    Root = root,
                    Transform = filter.transform,
                    Renderer = filter.GetComponent<MeshRenderer>(),
                };
                parts[index] = part;
                var mesh = filter.sharedMesh;
                if (mesh == null) continue;
                var matrix = root.worldToLocalMatrix * filter.transform.localToWorldMatrix;
                var local = mesh.bounds;
                part.Enabled = Draws(part.Renderer);
                part.Bounds = TransformBounds(local, matrix);
                if (part.Enabled && Mathf.Min(local.size.x, Mathf.Min(local.size.y, local.size.z)) <= 0.001f) {
                    // A zero-thickness quad is the export's baked neutral sheet; `Classify`
                    // still has to prove it is the plate this request prints on. Its size is
                    // the **measured** sign-local extent, because a holder child may carry
                    // its own scale (the shipped export's nodes do not, a promoted variant
                    // may).
                    plate = new Vector2(Mathf.Max(plate.x, part.Bounds.size.x), Mathf.Max(plate.y, part.Bounds.size.y));
                    anyPlate = true;
                }
                if (!any) { bounds = part.Bounds; any = true; }
                else bounds.Encapsulate(part.Bounds);
            }
            clearance.Parts = parts;
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

        /// <summary>
        /// True when a child actually draws: its renderer is enabled and every ancestor is
        /// active. `activeInHierarchy` is not used because the contract also measures the
        /// promoted **asset** before it is instantiated.
        /// </summary>
        static bool Draws(MeshRenderer renderer) {
            if (renderer == null || !renderer.enabled) return false;
            for (var walk = renderer.transform; walk != null; walk = walk.parent) {
                if (!walk.gameObject.activeSelf) return false;
            }
            return true;
        }

        /// <summary>A mesh's local bounds mapped through one matrix, as a local AABB.</summary>
        static Bounds TransformBounds(Bounds local, Matrix4x4 matrix) {
            var bounds = new Bounds(matrix.MultiplyPoint3x4(local.center), Vector3.zero);
            for (int corner = 0; corner < 8; corner++) {
                var point = local.center + Vector3.Scale(local.extents, new Vector3(
                    (corner & 1) == 0 ? -1f : 1f,
                    (corner & 2) == 0 ? -1f : 1f,
                    (corner & 4) == 0 ? -1f : 1f));
                bounds.Encapsulate(matrix.MultiplyPoint3x4(point));
            }
            return bounds;
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
            if (HolderClearance != null && HolderClearance.Offered && !HolderClearance.Accepted)
                text.Append(" holder=").Append(HolderClearance.DescribeReason());
            if (Boards != null && Boards.Dropped.Count > 0) text.Append(" dropped=").Append(string.Join(",", Boards.Dropped));
            return text.ToString();
        }

        /// <summary>
        /// The RCA 15 §2 report for one sign: id, mount, holder source, the measured holder
        /// children (name, bounds, enabled) in sign-local space, both printed face bounds in
        /// the same space, and the panel centre. Built only when a diagnostic asks for it —
        /// nothing here runs during a station build.
        /// </summary>
        public string DescribeHolderClearance() {
            var text = new StringBuilder();
            text.Append(ModuleId).Append(' ').Append(StationSignVocabulary.Mount(Mount));
            text.Append(" holder ").Append(HolderSource)
                .Append(HolderMatched ? " matched" : " fallback-parts");
            text.Append(" panel ").Append(Panel.x.ToString("0.###", CultureInfo.InvariantCulture))
                .Append('x').Append(Panel.y.ToString("0.###", CultureInfo.InvariantCulture));
            text.Append(" panel centre (0,").Append(PanelCentreZ.ToString("0.###", CultureInfo.InvariantCulture))
                .Append(",0) face plane ").Append(FacePlaneZ.ToString("0.###", CultureInfo.InvariantCulture)).Append('\n');
            foreach (var slot in Slots) {
                var bounds = FaceBounds(slot);
                text.Append("  face ").Append(StationSignVocabulary.Face(slot.Face)).Append(" bounds min(")
                    .Append(StationSignHolderPart.Format(bounds.min)).Append(") max(")
                    .Append(StationSignHolderPart.Format(bounds.max)).Append(") plate ")
                    .Append(slot.Width.ToString("0.###", CultureInfo.InvariantCulture)).Append('x')
                    .Append(slot.Height.ToString("0.###", CultureInfo.InvariantCulture))
                    .Append(" tex ").Append(slot.AppliedTexture != null ? slot.AppliedFingerprint : "none").Append('\n');
            }
            if (HolderMatched) {
                if (HolderClearance != null) text.Append(HolderClearance.Describe());
            } else {
                // The procedural path draws the view's own parts. Dump them too, with the
                // same crossing test the holder contract uses, so a bar across the text is
                // attributable on **this** path as well (RCA 15 §2 item 1: compare the
                // actual child responsible before adjusting any offset).
                if (HolderClearance != null) text.Append(HolderClearance.Describe()).Append('\n');
                text.Append("  built parts (procedural)");
                foreach (var filter in GetComponentsInChildren<MeshFilter>(true)) {
                    if (filter.transform.parent != transform) continue;
                    var renderer = filter.GetComponent<MeshRenderer>();
                    var bounds = PartBounds(transform, filter);
                    text.Append("\n  ").Append(filter.name).Append(' ')
                        .Append(renderer != null && renderer.enabled ? "enabled" : "hidden")
                        .Append(" bounds min(").Append(StationSignHolderPart.Format(bounds.min))
                        .Append(") max(").Append(StationSignHolderPart.Format(bounds.max)).Append(')');
                    if (filter.name.StartsWith("face ", StringComparison.Ordinal)) { text.Append(" printed sheet"); continue; }
                    text.Append(CrossesPrintedFace(bounds) ? " CROSSES the printed face plane" : " clear of the printed face");
                }
            }
            return text.ToString();
        }

        /// <summary>
        /// True when one built part's bounds reach a printed plane inside the printed
        /// rectangle — the same geometric test the holder contract runs on a promoted child.
        /// </summary>
        bool CrossesPrintedFace(Bounds bounds) {
            bool hung = StationSignMounts.Hung(Mount);
            float plateWidth = hung ? Panel.x - 0.06f : Panel.x;
            float plateHeight = hung ? Panel.y - 0.06f : Panel.y;
            if (!OverlapsPrintedRect(bounds, PanelCentreZ, plateWidth, plateHeight)) return false;
            if (bounds.max.z >= Mathf.Abs(FacePlaneZ) - 0.002f) return true;
            return hung && bounds.min.z <= -Mathf.Abs(FacePlaneZ) + 0.002f;
        }

        /// <summary>A child's mesh bounds in the view's own local space.</summary>
        static Bounds PartBounds(Transform root, MeshFilter filter) {
            var matrix = root.worldToLocalMatrix * filter.transform.localToWorldMatrix;
            return TransformBounds(filter.sharedMesh != null ? filter.sharedMesh.bounds : default, matrix);
        }

        /// <summary>One face slot's printed rectangle, in the view's local space.</summary>
        Bounds FaceBounds(StationSignFaceSlot slot) {
            if (slot == null) return new Bounds(Vector3.zero, Vector3.zero);
            if (slot.Renderer == null) return new Bounds(slot.LocalPosition, new Vector3(slot.Width, slot.Height, 0f));
            var world = slot.Renderer.bounds;
            var matrix = transform.worldToLocalMatrix;
            var bounds = new Bounds(matrix.MultiplyPoint3x4(world.center), Vector3.zero);
            for (int corner = 0; corner < 8; corner++) {
                bounds.Encapsulate(matrix.MultiplyPoint3x4(world.center + Vector3.Scale(world.extents, new Vector3(
                    (corner & 1) == 0 ? -1f : 1f,
                    (corner & 2) == 0 ? -1f : 1f,
                    (corner & 4) == 0 ? -1f : 1f))));
            }
            return bounds;
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
        /// mount is `cfg.mount` repaired, and `hangCeilingLocal` is either the resolved
        /// attachment height from <see cref="StationCeilingMounts"/> or, when no document
        /// index is supplied, the authored-anchor / nominal-storey default.
        /// </summary>
        public static StationSignRequest RequestFor(
            Metro.Build.StationModuleRecord record, StationSignLine[] lines, string locale = "zh-CN",
            float? hangCeilingLocal = null) {
            if (record == null) return default;
            var config = record.Config;
            var boothOffset = BoothOffset(record);
            var mount = StationSignMounts.Of(config.Text("mount"));
            float resolvedHang = hangCeilingLocal ??
                (record.CeilingAnchored ? 0f : (float)(Metro.Build.StationFootprints.StoreyHeight - 1));
            return new StationSignRequest {
                ModuleId = record.Id,
                Mount = mount,
                FrontJson = config.Json("front"),
                BackJson = config.Json("back"),
                ComponentsJson = config.Json("components"),
                BoothId = config.Text("boothId"),
                BoothOffsetX = boothOffset.x,
                BoothOffsetY = boothOffset.y,
                HangCeilingLocal = resolvedHang,
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
        /// <summary>
        /// The host-bound publisher this world's painter sends through. It must reach
        /// **both** transports (WebGL glue and the desktop presenter's
        /// `ReplyPublished`); null means the build had no host and
        /// <see cref="StationSignSignage.Send"/> falls back to the WebGL bridge.
        /// </summary>
        public Func<string, bool> Publish;
        public readonly List<StationSignView> Views = new List<StationSignView>();
        public readonly List<StationSignViewBinding> Bindings = new List<StationSignViewBinding>();
        public readonly Dictionary<string, (StationSignView View, StationSignViewBinding Binding, float? HangLocal)> ById =
            new Dictionary<string, (StationSignView, StationSignViewBinding, float?)>(StringComparer.Ordinal);
        public readonly Dictionary<long, HashSet<string>> HungByColumn = new Dictionary<long, HashSet<string>>();
        public StationMaterials Palette;
        public Material FaceTemplate;
        public StationSignMaterials SignMaterials;
        public StationSignHolderSet Holders;
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

        /// <summary>Route one `sign.*` command's raw JSON to the painter's reply channel.</summary>
        public static bool Receive(string json) => Provider != null && Provider.Receive(json);

        /// <summary>Upload whatever the painter has already answered.</summary>
        public static void Pump() => Cache?.Pump();

        /// <summary>
        /// Send one C#→JS message: a test's hook first (the verifier seam), then the
        /// committed world's host-bound publisher, then the WebGL bridge. The desktop
        /// player has no WebGL bridge, so a sign request that skipped the host could
        /// never reach the React painter there — the confirmed transport fault in
        /// RCA 14 §4.1.
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
    public sealed class StationSignRenderer : IStationViewRenderer, IStationLocalViewRenderer {
        public const string RoleName = "signs";

        sealed class StagedSignDelta : IStationLocalRendererStage {
            readonly StationSignSignageScope scope;
            readonly HashSet<string> retiredIds;
            readonly List<(Metro.Build.StationModuleRecord Record, StationSignView View, float? HangLocal)> staged;
            bool committed;

            public StagedSignDelta(
                StationSignSignageScope scope,
                HashSet<string> retiredIds,
                List<(Metro.Build.StationModuleRecord Record, StationSignView View, float? HangLocal)> staged) {
                this.scope = scope;
                this.retiredIds = retiredIds;
                this.staged = staged;
            }

            public void Commit(StationWorldView world, StationLocalViewCommit commit) {
                committed = true;
                if (retiredIds.Count > 0) {
                    world.RetireRecordsWhere(rec => rec.Role == RoleName && retiredIds.Contains(rec.ModuleId), commit);
                    foreach (var id in retiredIds) {
                        if (scope.ById.TryGetValue(id, out var oldEntry)) {
                            scope.ById.Remove(id);
                            try { oldEntry.Binding?.Dispose(); } catch (Exception) { }
                            scope.Bindings.Remove(oldEntry.Binding);
                            scope.Views.Remove(oldEntry.View);
                            if (oldEntry.View != null) {
                                DestroySlotMaterials(oldEntry.View);
                                commit.RetiredViews.Add(oldEntry.View.gameObject);
                            }
                        }
                    }
                    foreach (var pair in scope.HungByColumn) {
                        pair.Value.RemoveWhere(id => retiredIds.Contains(id));
                    }
                }

                var roleRoot = world.RoleRoot(RoleName);
                bool boundAny = false;
                for (int i = 0; i < staged.Count; i++) {
                    var (record, view, hangLocal) = staged[i];
                    view.transform.SetParent(roleRoot, false);
                    view.transform.SetPositionAndRotation(StationSignViews.Placement(record), ModulePlacement.Rotation(record.Rotation));
                    var bounds = PanelBounds(view, world.Root);
                    world.AddLocalRecord(new StationViewRecord {
                        Role = RoleName,
                        ModuleId = record.Id,
                        Part = "board",
                        View = view.gameObject,
                        Bounds = bounds,
                        HasBounds = true,
                        LevelMin = record.Z,
                        LevelMax = record.Z + 1,
                    }, commit);
                    var binding = scope.Cache != null ? scope.Cache.BindView(view) : null;
                    scope.Views.Add(view);
                    if (binding != null) {
                        scope.Bindings.Add(binding);
                        boundAny = true;
                    }
                    scope.ById[record.Id] = (view, binding, hangLocal);
                    if (hangLocal.HasValue) {
                        long col = StationLocalDeltaContext.PackColumn(record.X, record.Y);
                        if (!scope.HungByColumn.TryGetValue(col, out var set)) {
                            scope.HungByColumn[col] = set = new HashSet<string>(StringComparer.Ordinal);
                        }
                        set.Add(record.Id);
                    }
                }
                if (boundAny) scope.Cache?.Pump();
            }

            public void Dispose() {
                if (committed) return;
                for (int i = 0; i < staged.Count; i++) {
                    var view = staged[i].View;
                    if (view != null) {
                        DestroySlotMaterials(view);
                        StationWorldView.DestroyView(view.gameObject);
                    }
                }
                staged.Clear();
            }

            static void DestroySlotMaterials(StationSignView view) {
                if (view == null || view.Slots == null) return;
                foreach (var slot in view.Slots) {
                    if (slot?.Material != null) StationWorldView.DestroyUnityObject(slot.Material);
                }
            }
        }

        StationSignSignageScope scope;
        StationGameHost host;

        public string Role => RoleName;
        public IReadOnlyList<StationSignView> Views => scope != null ? (IReadOnlyList<StationSignView>)scope.Views : Array.Empty<StationSignView>();
        public StationSignTextureCache Cache => scope?.Cache;
        /// <summary>The view of one saved sign, for a verifier: the edited board re-rendered.</summary>
        public StationSignView View(string moduleId) {
            if (scope == null) return null;
            if (scope.ById.TryGetValue(moduleId ?? "", out var found)) return found.View;
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
            built.SignMaterials = materials;
            built.Holders = holders;
            // The painter's outbound route is the host's, so the desktop presenter sees
            // the same envelopes the WebGL page does (RCA 14 §4.1). A document-only
            // test has no host and keeps the bridge fallback.
            var publishHost = host;
            if (publishHost != null) {
                built.Publish = json => publishHost != null && publishHost.PublishOutbound(json);
            } else {
                context.ReportUnresolved("sign-transport", "renderer", Role,
                    "No StationGameHost is in the scene; sign face requests can only use the WebGL bridge.");
            }
            built.Provider = new StationSignWebProvider(StationSignSignage.Send, CurrentContext);
            built.Cache = new StationSignTextureCache(built.Provider);

            var lines = StationSignViews.Lines(context.Document);
            var records = context.Index != null ? context.Index.ModulesOfType("sign") : StationSignViews.Records(context.Document);
            var ceilingMounts = context.Index != null
                ? StationCeilingMounts.ForIndex(context.Index)
                : StationCeilingMounts.For(context.Document);
            int storeyHeight = context.Document != null && context.Document.StoreyHeight > 0
                ? context.Document.StoreyHeight
                : (int)Metro.Build.StationFootprints.StoreyHeight;
            for (int i = 0; i < records.Count; i++) {
                var record = records[i];
                var mountKind = StationSignMounts.Of(record.Config.Text("mount"));
                float? hangCeilingLocal = null;
                if (StationSignMounts.Hung(mountKind)) {
                    double fallback = StationCeilingMounts.FallbackFor(record.Facts, storeyHeight);
                    var resolved = ceilingMounts.Resolve(record.Facts, fallback);
                    hangCeilingLocal = (float)resolved.Local;
                    StationCeilingMounts.Trace(record.Id,
                        "saved z=" + record.Z + " ceilingAnchored=" + record.CeilingAnchored +
                        " support=" + resolved.SupportName +
                        " local=" + resolved.Local.ToString("0.###", CultureInfo.InvariantCulture) +
                        " underside=" + resolved.Underside.ToString("0.###", CultureInfo.InvariantCulture));
                    if (resolved.Support == StationCeilingMounts.SupportKind.Fallback) {
                        context.ReportUnresolved("sign-hang", "sign", record.Id,
                            "no overhead anchor, block, hanger or slab backing found; using fallback " +
                            resolved.Local.ToString("0.###", CultureInfo.InvariantCulture) + " m");
                    }
                }
                var request = StationSignViews.RequestFor(record, lines, StationSignSignage.Locale, hangCeilingLocal);
                var view = StationSignView.Build(request, materials, holders, root);
                // The root carries the booth step in document axes (see `StationSignViews.Placement`).
                view.transform.SetPositionAndRotation(StationSignViews.Placement(record), ModulePlacement.Rotation(record.Rotation));
                // RCA 15 §2: a promoted holder refused for its geometry is a caveat on a
                // drawn sign, not a silent fallback — the child that crossed the printed
                // face is named here so a screenshot can be attributed to a renderer.
                if (view.HolderClearance != null && view.HolderClearance.ContractRejected) {
                    context.ReportUnresolved("sign-holder", "sign", record.Id, view.HolderDiagnostic);
                }
                if (!view.Supported || view.BoardCount == 0) {
                    context.ReportUnresolved("sign-board", "sign", record.Id,
                        view.Issue.Length > 0 ? view.Issue : "no board content");
                    continue;
                }
                context.World.RegisterModule(Role, record.Id, view.gameObject, "board",
                    PanelBounds(view, context.Root), record.Z, record.Z + 1);
                var binding = built.Cache.BindView(view);
                built.Views.Add(view);
                built.Bindings.Add(binding);
                built.ById[record.Id] = (view, binding, hangCeilingLocal);
                if (hangCeilingLocal.HasValue) {
                    long col = StationLocalDeltaContext.PackColumn(record.X, record.Y);
                    if (!built.HungByColumn.TryGetValue(col, out var set)) {
                        built.HungByColumn[col] = set = new HashSet<string>(StringComparer.Ordinal);
                    }
                    set.Add(record.Id);
                }
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

        public bool TryStageLocalDelta(
            StationLocalDeltaContext context,
            out IStationLocalRendererStage stage,
            out string fallbackReason) {
            stage = null;
            fallbackReason = null;
            var roleRoot = context.World.RoleRoot(RoleName);
            var worldScope = roleRoot != null ? roleRoot.GetComponent<StationSignSignageScope>() : null;
            if (worldScope == null) {
                if (context.NextIndex.ModulesOfType("sign").Count == 0 && context.PrevIndex.ModulesOfType("sign").Count == 0) {
                    return true;
                }
                fallbackReason = "no-sign-scope";
                return false;
            }

            var removedIds = new HashSet<string>(StringComparer.Ordinal);
            var dirtyIds = new HashSet<string>(StringComparer.Ordinal);
            var delta = context.Delta;

            for (int i = 0; i < delta.RemovedModules.Count; i++) {
                var id = delta.RemovedModules[i];
                if (context.PrevIndex.TryGetModule(id, out var oldMod) && oldMod != null && oldMod.Type == "sign") {
                    removedIds.Add(id);
                }
            }
            for (int i = 0; i < delta.ChangedModules.Count; i++) {
                var mod = delta.ChangedModules[i];
                if (mod != null && mod.Type == "sign") dirtyIds.Add(mod.Id);
            }
            if (context.CityChanged || context.VisualChangedLineIds.Count > 0) {
                var allSigns = context.NextIndex.ModulesOfType("sign");
                for (int i = 0; i < allSigns.Count; i++) {
                    var s = allSigns[i];
                    if (s != null && !removedIds.Contains(s.Id)) dirtyIds.Add(s.Id);
                }
            }

            int storeyHeight = context.NextDocument.StoreyHeight > 0
                ? context.NextDocument.StoreyHeight
                : (int)Metro.Build.StationFootprints.StoreyHeight;

            if (context.CellsChanged && worldScope.HungByColumn.Count > 0) {
                var mounts = context.GetNextCeilingMounts();
                foreach (long col in context.TouchedColumns) {
                    if (!worldScope.HungByColumn.TryGetValue(col, out var ids)) continue;
                    foreach (var id in ids) {
                        if (removedIds.Contains(id) || dirtyIds.Contains(id)) continue;
                        if (!context.NextIndex.TryGetModule(id, out var rec) || rec == null) continue;
                        double fallback = StationCeilingMounts.FallbackFor(rec.Facts, storeyHeight);
                        float nextHang = (float)mounts.Resolve(rec.Facts, fallback).Local;
                        if (!worldScope.ById.TryGetValue(id, out var existing) || !existing.HangLocal.HasValue ||
                            Mathf.Abs(existing.HangLocal.Value - nextHang) > 1e-4f) {
                            dirtyIds.Add(id);
                        }
                    }
                }
            }

            if (removedIds.Count == 0 && dirtyIds.Count == 0) return true;

            var lines = StationSignViews.Lines(context.NextDocument);
            var ceilingMounts = dirtyIds.Count > 0 ? context.GetNextCeilingMounts() : null;
            var retiredIds = new HashSet<string>(removedIds, StringComparer.Ordinal);
            var staged = new List<(Metro.Build.StationModuleRecord Record, StationSignView View, float? HangLocal)>(dirtyIds.Count);

            try {
                foreach (var id in dirtyIds) {
                    retiredIds.Add(id);
                    if (!context.NextIndex.TryGetModule(id, out var record) || record == null || record.Type != "sign") continue;
                    var mountKind = StationSignMounts.Of(record.Config.Text("mount"));
                    float? hangCeilingLocal = null;
                    if (StationSignMounts.Hung(mountKind)) {
                        double fallback = StationCeilingMounts.FallbackFor(record.Facts, storeyHeight);
                        var resolved = ceilingMounts.Resolve(record.Facts, fallback);
                        hangCeilingLocal = (float)resolved.Local;
                        if (resolved.Support == StationCeilingMounts.SupportKind.Fallback) {
                            context.ReportUnresolved("sign-hang", "sign", record.Id,
                                "no overhead anchor, block, hanger or slab backing found; using fallback " +
                                resolved.Local.ToString("0.###", CultureInfo.InvariantCulture) + " m");
                        }
                    }
                    var request = StationSignViews.RequestFor(record, lines, StationSignSignage.Locale, hangCeilingLocal);
                    var view = StationSignView.Build(request, worldScope.SignMaterials, worldScope.Holders, context.StagingRoot);
                    if (view.HolderClearance != null && view.HolderClearance.ContractRejected) {
                        context.ReportUnresolved("sign-holder", "sign", record.Id, view.HolderDiagnostic);
                    }
                    if (!view.Supported || view.BoardCount == 0) {
                        context.ReportUnresolved("sign-board", "sign", record.Id,
                            view.Issue.Length > 0 ? view.Issue : "no board content");
                        if (view.Slots != null) {
                            foreach (var slot in view.Slots) {
                                if (slot?.Material != null) StationWorldView.DestroyUnityObject(slot.Material);
                            }
                        }
                        StationWorldView.DestroyView(view.gameObject);
                        continue;
                    }
                    StationEditTrace.AddInstantiatedPrefab();
                    staged.Add((record, view, hangCeilingLocal));
                }
                stage = new StagedSignDelta(worldScope, retiredIds, staged);
                return true;
            } catch {
                for (int i = 0; i < staged.Count; i++) {
                    var view = staged[i].View;
                    if (view != null) {
                        if (view.Slots != null) {
                            foreach (var slot in view.Slots) {
                                if (slot?.Material != null) StationWorldView.DestroyUnityObject(slot.Material);
                            }
                        }
                        StationWorldView.DestroyView(view.gameObject);
                    }
                }
                throw;
            }
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
            released.ById.Clear();
            released.HungByColumn.Clear();
            released.Publish = null;
            released.Renderer = null;
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

        /// <summary>
        /// The board's envelope in document axes, transformed through the placed view's
        /// transform so rotated boards and booth offsets report their real document box.
        /// </summary>
        public static Metro.Build.StationBox PanelBounds(StationSignView view, Transform stationRoot = null) {
            if (view == null) return default;
            var local = view.LocalBounds;
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            for (int corner = 0; corner < 8; corner++) {
                var point = new Vector3(
                    (corner & 1) == 0 ? local.min.x : local.max.x,
                    (corner & 2) == 0 ? local.min.y : local.max.y,
                    (corner & 4) == 0 ? local.min.z : local.max.z);
                var world = view.transform.TransformPoint(point);
                if (stationRoot != null) world = stationRoot.InverseTransformPoint(world);
                var document = StationCoordinates.WorldToDocument(world);
                min = Vector3.Min(min, document);
                max = Vector3.Max(max, document);
            }
            return new Metro.Build.StationBox(min.x, min.y, min.z, max.x, max.y, max.z);
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
