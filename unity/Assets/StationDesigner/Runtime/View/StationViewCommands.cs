using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;

namespace Metro.View {
    /// <summary>The camera and view commands packet D owns (`camera.*`, `view.*`).</summary>
    public enum StationViewCommandType {
        Unknown = 0,
        Orbit,
        Pan,
        Zoom,
        Snap,
        Home,
        Fov,
        Projection,
        PanHeld,
        /// <summary>WASD: the held camera-relative ground pan (`camera.panPlanarHeld`).</summary>
        PanPlanarHeld,
        ViewSet,
        Frame,
    }

    /// <summary>The keys <c>view.set</c> accepts.</summary>
    public enum StationViewKey {
        Unknown = 0,
        Level,
        ShowLevels,
        Ceiling,
        Walls,
        Ground,
        Roof,
        HideUi,
        LevelRail,
        Cutaway,
        Section,
        SectionAnchor,
        SectionRotate,
        SectionOffset,
        SectionSurface,
        Exploded,
        Density,
        Zones,
        FollowPassenger,
        Theme,
    }

    /// <summary>One parsed command, normalised away from JSON.</summary>
    public sealed class StationViewCommand {
        public string Id;
        public string SessionId;
        public string RawType;
        public StationViewCommandType Type;
        public float Dx;
        public float Dy;
        public float Scale;
        public float Factor;
        public float Degrees;
        public int HeldDirection;
        /// <summary>For <see cref="StationViewCommandType.PanPlanarHeld"/>: the held ground pan, -1…1.</summary>
        public float HeldRight;
        public float HeldForward;
        /// <summary>The Shift accelerator a held pan may carry; absent means "leave it".</summary>
        public bool Fast;
        public bool HasFast;
        public Vector3 Direction;
        public bool HasDirection;
        public StationProjection Projection = StationProjection.Perspective;
        public StationViewKey Key;
        public bool BoolValue;
        public int IntValue;
        public float FloatValue;
        public string StringValue;
        public bool HasVector;
        public Vector3 VectorValue;
        public StationSectionPlane Section;
        public bool HasSection;
        /// <summary>For <see cref="StationViewKey.SectionRotate"/>: turn to the next quarter.</summary>
        public bool RotateToNext;
    }

    /// <summary>
    /// A dependency-light JSON reader (objects, arrays, strings, numbers, booleans,
    /// null). The View assembly deliberately does not take a JSON package reference:
    /// the transport is A's envelope and the payloads here are small and fixed.
    /// </summary>
    sealed class StationJsonReader {
        readonly string text;
        int index;

        StationJsonReader(string text) { this.text = text ?? string.Empty; }

        public static bool TryParse(string json, out object value, out string error) {
            var reader = new StationJsonReader(json);
            try {
                reader.SkipWhitespace();
                value = reader.ReadValue();
                reader.SkipWhitespace();
                if (reader.index != reader.text.Length) throw new FormatException("trailing characters");
                error = null;
                return true;
            } catch (Exception exception) {
                value = null;
                error = exception.Message;
                return false;
            }
        }

        void SkipWhitespace() {
            while (index < text.Length && char.IsWhiteSpace(text[index])) index++;
        }

        object ReadValue() {
            SkipWhitespace();
            if (index >= text.Length) throw new FormatException("missing value");
            switch (text[index]) {
                case '{': return ReadObject();
                case '[': return ReadArray();
                case '"': return ReadString();
                case 't':
                    Expect("true");
                    return true;
                case 'f':
                    Expect("false");
                    return false;
                case 'n':
                    Expect("null");
                    return null;
                default: return ReadNumber();
            }
        }

        void Expect(string literal) {
            if (index + literal.Length > text.Length || text.Substring(index, literal.Length) != literal) {
                throw new FormatException("expected " + literal);
            }
            index += literal.Length;
        }

        Dictionary<string, object> ReadObject() {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            index++; // {
            SkipWhitespace();
            if (index < text.Length && text[index] == '}') { index++; return result; }
            while (true) {
                SkipWhitespace();
                if (index >= text.Length || text[index] != '"') throw new FormatException("expected object key");
                string key = ReadString();
                SkipWhitespace();
                if (index >= text.Length || text[index] != ':') throw new FormatException("expected ':'");
                index++;
                result[key] = ReadValue();
                SkipWhitespace();
                if (index >= text.Length) throw new FormatException("unterminated object");
                if (text[index] == ',') { index++; continue; }
                if (text[index] == '}') { index++; return result; }
                throw new FormatException("expected ',' or '}'");
            }
        }

        List<object> ReadArray() {
            var result = new List<object>();
            index++; // [
            SkipWhitespace();
            if (index < text.Length && text[index] == ']') { index++; return result; }
            while (true) {
                result.Add(ReadValue());
                SkipWhitespace();
                if (index >= text.Length) throw new FormatException("unterminated array");
                if (text[index] == ',') { index++; continue; }
                if (text[index] == ']') { index++; return result; }
                throw new FormatException("expected ',' or ']'");
            }
        }

        string ReadString() {
            index++; // opening quote
            var builder = new StringBuilder();
            while (index < text.Length) {
                char c = text[index++];
                if (c == '"') return builder.ToString();
                if (c != '\\') { builder.Append(c); continue; }
                if (index >= text.Length) throw new FormatException("unterminated escape");
                char escape = text[index++];
                switch (escape) {
                    case '"': builder.Append('"'); break;
                    case '\\': builder.Append('\\'); break;
                    case '/': builder.Append('/'); break;
                    case 'b': builder.Append('\b'); break;
                    case 'f': builder.Append('\f'); break;
                    case 'n': builder.Append('\n'); break;
                    case 'r': builder.Append('\r'); break;
                    case 't': builder.Append('\t'); break;
                    case 'u':
                        if (index + 4 > text.Length) throw new FormatException("short unicode escape");
                        string hex = text.Substring(index, 4);
                        index += 4;
                        builder.Append((char)int.Parse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        break;
                    default: throw new FormatException("unknown escape");
                }
            }
            throw new FormatException("unterminated string");
        }

        double ReadNumber() {
            int start = index;
            if (index < text.Length && (text[index] == '-' || text[index] == '+')) index++;
            while (index < text.Length && (char.IsDigit(text[index]) || text[index] == '.' ||
                text[index] == 'e' || text[index] == 'E' || text[index] == '+' || text[index] == '-')) index++;
            if (start == index) throw new FormatException("expected number");
            string slice = text.Substring(start, index - start);
            if (!double.TryParse(slice, NumberStyles.Float, CultureInfo.InvariantCulture, out double value)) {
                throw new FormatException("bad number");
            }
            return value;
        }
    }

    /// <summary>
    /// Parse a v2 <c>{schemaVersion,id,sessionId,type,payload}</c> envelope (or a bare
    /// <c>{type,payload}</c>) into a <see cref="StationViewCommand"/>. Unknown types and
    /// malformed payloads are refused with a stable code, never guessed at.
    /// </summary>
    public static class StationViewCommandParser {
        public const float DefaultViewportHeight = 1080f;

        public static bool TryParse(string json, out StationViewCommand command, out string error) {
            command = null;
            if (!StationJsonReader.TryParse(json, out object value, out error)) return false;
            if (!(value is Dictionary<string, object> root)) { error = "not-an-object"; return false; }
            string type = String(root, "type");
            if (string.IsNullOrEmpty(type)) { error = "missing-type"; return false; }
            root.TryGetValue("payload", out object payloadValue);
            var payload = payloadValue as Dictionary<string, object> ?? new Dictionary<string, object>();
            var parsed = new StationViewCommand {
                Id = String(root, "id"),
                SessionId = String(root, "sessionId"),
                RawType = type,
            };
            switch (type) {
                case "camera.orbit":
                    if (!Number(payload, "dx", out parsed.Dx) || !Number(payload, "dy", out parsed.Dy)) { error = "bad-orbit"; return false; }
                    if (Number(payload, "scale", out float scale) && scale > 0f) parsed.Scale = scale;
                    parsed.Type = StationViewCommandType.Orbit;
                    break;
                case "camera.pan":
                    if (!Number(payload, "dx", out parsed.Dx) || !Number(payload, "dy", out parsed.Dy)) { error = "bad-pan"; return false; }
                    parsed.Type = StationViewCommandType.Pan;
                    break;
                case "camera.zoom":
                    if (Number(payload, "delta", out float delta)) {
                        parsed.Type = StationViewCommandType.Zoom;
                        parsed.Factor = 0f;
                        parsed.Dx = delta;
                    } else if (Number(payload, "factor", out float factor) && factor > 0f) {
                        parsed.Type = StationViewCommandType.Zoom;
                        parsed.Factor = factor;
                    } else {
                        error = "bad-zoom";
                        return false;
                    }
                    break;
                case "camera.snap":
                    if (!TrySnap(payload, out parsed.Direction, out parsed.Projection)) { error = "bad-snap"; return false; }
                    parsed.HasDirection = true;
                    parsed.Type = StationViewCommandType.Snap;
                    break;
                case "camera.home":
                    parsed.Type = StationViewCommandType.Home;
                    break;
                case "camera.frame":
                    parsed.Type = StationViewCommandType.Frame;
                    break;
                case "camera.fov":
                    if (!Number(payload, "deg", out parsed.Degrees) && !Number(payload, "degrees", out parsed.Degrees)) {
                        error = "bad-fov";
                        return false;
                    }
                    parsed.Type = StationViewCommandType.Fov;
                    break;
                case "camera.projection": {
                    if (Bool(payload, "ortho", out bool ortho)) {
                        parsed.Projection = ortho ? StationProjection.Orthographic : StationProjection.Perspective;
                    } else if (string.Equals(String(payload, "projection"), "orthographic", StringComparison.OrdinalIgnoreCase)) {
                        parsed.Projection = StationProjection.Orthographic;
                    } else if (string.Equals(String(payload, "projection"), "perspective", StringComparison.OrdinalIgnoreCase)) {
                        parsed.Projection = StationProjection.Perspective;
                    } else {
                        error = "bad-projection";
                        return false;
                    }
                    parsed.Type = StationViewCommandType.Projection;
                    break;
                }
                case "camera.panHeld": {
                    if (!Integer(payload, "direction", out parsed.HeldDirection) && !Integer(payload, "dir", out parsed.HeldDirection)) {
                        error = "bad-pan-held";
                        return false;
                    }
                    if (parsed.HeldDirection < -1 || parsed.HeldDirection > 1) { error = "bad-pan-held"; return false; }
                    if (Bool(payload, "fast", out bool fast)) { parsed.Fast = fast; parsed.HasFast = true; }
                    parsed.Type = StationViewCommandType.PanHeld;
                    break;
                }
                case "camera.panPlanarHeld": {
                    // The held ground pan: two bounded intents, never a key name, so the
                    // keyboard and the ViewCube's arrows hold one action (`Viewport.tsx`).
                    if (!Number(payload, "right", out parsed.HeldRight) && !Number(payload, "x", out parsed.HeldRight)) {
                        parsed.HeldRight = 0f;
                    }
                    if (!Number(payload, "forward", out parsed.HeldForward) && !Number(payload, "y", out parsed.HeldForward)) {
                        parsed.HeldForward = 0f;
                    }
                    if (float.IsNaN(parsed.HeldRight) || float.IsInfinity(parsed.HeldRight) ||
                        float.IsNaN(parsed.HeldForward) || float.IsInfinity(parsed.HeldForward)) {
                        error = "bad-pan-planar-held";
                        return false;
                    }
                    parsed.HeldRight = Mathf.Clamp(parsed.HeldRight, -1f, 1f);
                    parsed.HeldForward = Mathf.Clamp(parsed.HeldForward, -1f, 1f);
                    if (Bool(payload, "fast", out bool planarFast)) { parsed.Fast = planarFast; parsed.HasFast = true; }
                    parsed.Type = StationViewCommandType.PanPlanarHeld;
                    break;
                }
                case "view.set":
                    if (!TryViewSet(payload, parsed, out error)) return false;
                    parsed.Type = StationViewCommandType.ViewSet;
                    break;
                default:
                    error = "unsupported-command";
                    return false;
            }
            command = parsed;
            return true;
        }

        static bool TrySnap(Dictionary<string, object> payload, out Vector3 direction, out StationProjection projection) {
            direction = Vector3.zero;
            projection = StationProjection.Perspective;
            bool hasProjection = false;
            if (Bool(payload, "ortho", out bool ortho)) {
                projection = ortho ? StationProjection.Orthographic : StationProjection.Perspective;
                hasProjection = true;
            } else if (string.Equals(String(payload, "projection"), "orthographic", StringComparison.OrdinalIgnoreCase)) {
                projection = StationProjection.Orthographic;
                hasProjection = true;
            } else if (string.Equals(String(payload, "projection"), "perspective", StringComparison.OrdinalIgnoreCase)) {
                projection = StationProjection.Perspective;
                hasProjection = true;
            }
            if (payload.TryGetValue("direction", out object directionValue) && directionValue is List<object> array && array.Count >= 3) {
                if (!TryFloat(array[0], out direction.x) || !TryFloat(array[1], out direction.y) || !TryFloat(array[2], out direction.z)) return false;
                if (!hasProjection) projection = IsAxis(direction) ? StationProjection.Orthographic : StationProjection.Perspective;
                return direction.sqrMagnitude > 1e-10f;
            }
            string face = String(payload, "face");
            if (string.IsNullOrEmpty(face)) return false;
            if (!TryFaceDirection(face, out direction)) return false;
            if (!hasProjection) projection = IsAxis(direction) ? StationProjection.Orthographic : StationProjection.Perspective;
            return true;
        }

        static bool TryFaceDirection(string face, out Vector3 direction) {
            direction = Vector3.zero;
            switch (face.Trim().ToLowerInvariant()) {
                case "top": direction = new Vector3(0f, 0f, 1f); return true;
                case "bottom": direction = new Vector3(0f, 0f, -1f); return true;
                case "e": case "east": direction = new Vector3(1f, 0f, 0f); return true;
                case "w": case "west": direction = new Vector3(-1f, 0f, 0f); return true;
                case "n": case "north": direction = new Vector3(0f, 1f, 0f); return true;
                case "s": case "south": direction = new Vector3(0f, -1f, 0f); return true;
            }
            if (!face.StartsWith("dir:", StringComparison.OrdinalIgnoreCase)) return false;
            var parts = face.Substring(4).Split(',');
            if (parts.Length != 3) return false;
            if (!float.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out direction.x) ||
                !float.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out direction.y) ||
                !float.TryParse(parts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out direction.z)) return false;
            return direction.sqrMagnitude > 1e-10f;
        }

        static bool IsAxis(Vector3 direction) {
            var unit = direction.normalized;
            return Mathf.Abs(Mathf.Abs(unit.x) + Mathf.Abs(unit.y) + Mathf.Abs(unit.z) - 1f) < 1e-3f;
        }

        static bool TryViewSet(Dictionary<string, object> payload, StationViewCommand command, out string error) {
            error = null;
            string key = String(payload, "key");
            if (string.IsNullOrEmpty(key)) { error = "missing-view-key"; return false; }
            payload.TryGetValue("value", out object value);
            switch (NormalizeKey(key)) {
                case StationViewKey.Level:
                    if (!TryInt(value, out command.IntValue)) { error = "bad-level"; return false; }
                    command.Key = StationViewKey.Level;
                    return true;
                case StationViewKey.ShowLevels:
                case StationViewKey.Ceiling:
                case StationViewKey.Walls:
                case StationViewKey.Ground:
                case StationViewKey.Roof:
                case StationViewKey.HideUi:
                case StationViewKey.LevelRail:
                case StationViewKey.Cutaway:
                case StationViewKey.Exploded:
                case StationViewKey.Density:
                case StationViewKey.Zones:
                    if (!TryBool(value, out command.BoolValue)) { error = "bad-view-boolean"; return false; }
                    command.Key = NormalizeKey(key);
                    return true;
                case StationViewKey.SectionSurface:
                    if (!TryBool(value, out command.BoolValue)) { error = "bad-view-boolean"; return false; }
                    // The UI's 隐藏剖切面 key is the inverse of "surface visible"; accept
                    // either spelling and normalise to visibility.
                    if (key.IndexOf("hide", StringComparison.OrdinalIgnoreCase) >= 0) command.BoolValue = !command.BoolValue;
                    command.Key = StationViewKey.SectionSurface;
                    return true;
                case StationViewKey.FollowPassenger:
                    if (value == null) { command.IntValue = -1; command.Key = StationViewKey.FollowPassenger; return true; }
                    if (!TryInt(value, out command.IntValue)) { error = "bad-follow-passenger"; return false; }
                    command.Key = StationViewKey.FollowPassenger;
                    return true;
                case StationViewKey.Theme:
                    if (!(value is string themeText) || string.IsNullOrWhiteSpace(themeText)) { error = "bad-view-theme"; return false; }
                    command.StringValue = themeText.Trim().ToLowerInvariant();
                    command.Key = StationViewKey.Theme;
                    return true;
                case StationViewKey.Section:
                    if (!TrySection(value, out command.Section)) { error = "bad-section"; return false; }
                    command.HasSection = true;
                    command.Key = StationViewKey.Section;
                    return true;
                case StationViewKey.SectionAnchor:
                    if (!TryVector(value, out command.VectorValue)) { error = "bad-section-anchor"; return false; }
                    command.HasVector = true;
                    command.Key = StationViewKey.SectionAnchor;
                    return true;
                case StationViewKey.SectionRotate:
                    command.Key = StationViewKey.SectionRotate;
                    if (value == null || value is bool boolean && boolean) { command.RotateToNext = true; return true; }
                    if (value is string text && string.Equals(text, "next", StringComparison.OrdinalIgnoreCase)) { command.RotateToNext = true; return true; }
                    if (TryFloat(value, out float azimuth)) {
                        // A 0..3 integer names a quarter turn; anything larger is degrees.
                        if (Math.Abs(azimuth - Mathf.Round(azimuth)) < 1e-6f && Mathf.Abs(azimuth) <= 3f) azimuth *= 90f;
                        command.FloatValue = azimuth;
                        return true;
                    }
                    error = "bad-section-rotate";
                    return false;
                case StationViewKey.SectionOffset:
                    if (!TryFloat(value, out command.FloatValue)) { error = "bad-section-offset"; return false; }
                    command.Key = StationViewKey.SectionOffset;
                    return true;
                default:
                    error = "unknown-view-key";
                    return false;
            }
        }

        public static StationViewKey NormalizeKey(string key) {
            switch (key.Trim().ToLowerInvariant()) {
                case "level": return StationViewKey.Level;
                case "showlevels": case "show_levels": case "showotherlevels": case "ghostotherlevels": case "ghost": return StationViewKey.ShowLevels;
                case "ceiling": case "ceilings": case "auticeiling": case "autoceiling": case "hideceilings": case "hide_ceilings": return StationViewKey.Ceiling;
                case "walls": case "hidewalls": case "hide_walls": return StationViewKey.Walls;
                case "ground": case "hideground": case "hide_ground": case "hidefloors": case "hide_floors": return StationViewKey.Ground;
                case "roof": case "roofs": case "hideroof": case "hide_roof": case "hideroofs": case "hide_roofs": return StationViewKey.Roof;
                case "hideui": case "hide_ui": return StationViewKey.HideUi;
                case "levelrail": case "level_rail": return StationViewKey.LevelRail;
                case "cutaway": case "sectionon": case "section_on": return StationViewKey.Cutaway;
                case "section": return StationViewKey.Section;
                case "sectionanchor": case "section_anchor": return StationViewKey.SectionAnchor;
                case "sectionrotate": case "section_rotate": case "sectionazimuth": case "section_azimuth": return StationViewKey.SectionRotate;
                case "sectionoffset": case "section_offset": case "sectionslide": case "section_slide": return StationViewKey.SectionOffset;
                case "sectionsurface": case "section_surface": case "hidesectionsurface": case "hide_section_surface": return StationViewKey.SectionSurface;
                case "exploded": case "explodedview": case "exploded_view": return StationViewKey.Exploded;
                case "density": case "densityoverlay": case "density_overlay": return StationViewKey.Density;
                case "zones": case "zoneoverlay": case "zone_overlay": case "zonemap": case "zone_map": return StationViewKey.Zones;
                case "followpassenger": case "follow_passenger": case "followagent": case "follow_agent": return StationViewKey.FollowPassenger;
                case "theme": case "uitheme": case "ui_theme": return StationViewKey.Theme;
                default: return StationViewKey.Unknown;
            }
        }

        static bool TrySection(object value, out StationSectionPlane section) {
            section = StationSectionPlane.Default;
            if (!(value is Dictionary<string, object> record)) return false;
            if (record.TryGetValue("anchor", out object anchor) && TryVector(anchor, out Vector3 point)) section.Anchor = point;
            if (Number(record, "azimuth", out float azimuth)) section.Azimuth = StationSectionPlane.SnapAzimuth(azimuth);
            if (Number(record, "offset", out float offset)) section.Offset = offset;
            return true;
        }

        static bool TryVector(object value, out Vector3 vector) {
            vector = Vector3.zero;
            if (!(value is List<object> array) || array.Count < 3) return false;
            if (!TryFloat(array[0], out vector.x) || !TryFloat(array[1], out vector.y) || !TryFloat(array[2], out vector.z)) return false;
            return true;
        }

        static bool TryFloat(object value, out float number) {
            number = 0f;
            if (value is double doubleValue) { number = (float)doubleValue; return !float.IsNaN(number) && !float.IsInfinity(number); }
            if (value is int intValue) { number = intValue; return true; }
            if (value is long longValue) { number = longValue; return true; }
            return false;
        }

        static bool TryInt(object value, out int number) {
            number = 0;
            if (value is double doubleValue) {
                if (Math.Abs(doubleValue - Math.Round(doubleValue)) > 1e-6 || double.IsNaN(doubleValue) || double.IsInfinity(doubleValue)) return false;
                if (doubleValue < int.MinValue || doubleValue > int.MaxValue) return false;
                number = (int)Math.Round(doubleValue);
                return true;
            }
            if (value is int intValue) { number = intValue; return true; }
            if (value is long longValue && longValue >= int.MinValue && longValue <= int.MaxValue) { number = (int)longValue; return true; }
            return false;
        }

        static bool TryBool(object value, out bool boolean) {
            boolean = false;
            if (value is bool boolValue) { boolean = boolValue; return true; }
            if (value is string text && bool.TryParse(text, out boolean)) return true;
            return false;
        }

        static bool Number(Dictionary<string, object> payload, string key, out float value) {
            value = 0f;
            return payload.TryGetValue(key, out object raw) && TryFloat(raw, out value);
        }

        static bool Integer(Dictionary<string, object> payload, string key, out int value) {
            value = 0;
            return payload.TryGetValue(key, out object raw) && TryInt(raw, out value);
        }

        static bool Bool(Dictionary<string, object> payload, string key, out bool value) {
            value = false;
            return payload.TryGetValue(key, out object raw) && TryBool(raw, out value);
        }

        static string String(Dictionary<string, object> payload, string key) =>
            payload != null && payload.TryGetValue(key, out object value) ? value as string : null;
    }

    /// <summary>The capability facts the view publishes, so the UI can disable unwired controls.</summary>
    public struct StationViewCapabilities {
        public bool SectionBoundsCull;
        public bool SectionShaderPlane;
        public bool DensityOverlay;
        public bool ZoneOverlay;
        public bool PassengerFollow;
        public bool ExplodedOffsets;
        public bool ExplodedDrag;
        public bool LevelRailGeometry;

        public void AppendJson(StringBuilder builder) {
            builder.Append("{\"sectionBoundsCull\":");
            StationCameraJson.AppendBool(builder, SectionBoundsCull);
            builder.Append(",\"sectionShaderPlane\":");
            StationCameraJson.AppendBool(builder, SectionShaderPlane);
            builder.Append(",\"densityOverlay\":");
            StationCameraJson.AppendBool(builder, DensityOverlay);
            builder.Append(",\"zoneOverlay\":");
            StationCameraJson.AppendBool(builder, ZoneOverlay);
            builder.Append(",\"passengerFollow\":");
            StationCameraJson.AppendBool(builder, PassengerFollow);
            builder.Append(",\"explodedOffsets\":");
            StationCameraJson.AppendBool(builder, ExplodedOffsets);
            builder.Append(",\"explodedDrag\":");
            StationCameraJson.AppendBool(builder, ExplodedDrag);
            builder.Append(",\"levelRailGeometry\":");
            StationCameraJson.AppendBool(builder, LevelRailGeometry);
            builder.Append('}');
        }
    }

    /// <summary>
    /// Applies the parsed camera/view commands to one camera rig and one visibility
    /// registry. This is the object A's command router calls for <c>camera.*</c> and
    /// <c>view.*</c>; it never touches a document or a simulation, so changing a level
    /// or a view while the sim runs cannot cause a document edit or a reset.
    /// </summary>
    public sealed class StationViewCommandApplier {
        public readonly StationCameraController Camera;
        public readonly StationVisibilityRegistry Visibility;
        public StationLevelGrid Grid;
        public StationSectionPlane Section = StationSectionPlane.Default;
        public bool SectionSurfaceVisible = true;
        /// <summary>The published 分区图 / 热力图 flags (plan 13 §5), for the overlay renderer.</summary>
        public bool Zones => Visibility.State.Zones;
        public bool Density => Visibility.State.Density;
        public float ViewportHeight = StationViewCommandParser.DefaultViewportHeight;
        public Camera ViewCamera;
        public StationViewCapabilities Capabilities;
        public bool LevelRail = true;
        public bool FollowPassenger = false;
        public string Theme { get; private set; } = "blueprint";

        /// <summary>Raised after an accepted command; the host coalesces the publish.</summary>
        public event Action Changed;
        /// <summary>Raised when <c>view.set { key: "theme" }</c> changes the active UI theme.</summary>
        public event Action<string> ThemeChanged;

        Func<bool, bool> explodedHandler;

        /// <summary>
        /// Optional standalone exploded-view lifecycle handler (<c>StationExplodedView</c>).
        /// When bound, <c>view.set exploded</c> routes through the standalone viewer without
        /// mutating editor visibility flags or moving registered editor transforms.
        /// </summary>
        public Func<bool, bool> ExplodedHandler {
            get => explodedHandler;
            set {
                explodedHandler = value;
                Capabilities.ExplodedDrag = value != null;
            }
        }

        public StationViewCommandApplier(StationCameraController camera, StationVisibilityRegistry visibility, StationLevelGrid grid) {
            Camera = camera ?? throw new ArgumentNullException(nameof(camera));
            Visibility = visibility ?? throw new ArgumentNullException(nameof(visibility));
            Grid = grid;
            Section = visibility.Section;
            Visibility.SectionClipping = false;
            Capabilities = new StationViewCapabilities {
                SectionBoundsCull = true,
                SectionShaderPlane = false,
                // Plan 13 §5: both overlays are drawn now (`StationOverlayRenderer`).
                DensityOverlay = true,
                ZoneOverlay = true,
                PassengerFollow = false,
                ExplodedOffsets = true,
                ExplodedDrag = false,
                LevelRailGeometry = false,
            };
        }

        /// <summary>Install a live station: bounds, its level grid and the home view.</summary>
        public void SetStation(Bounds documentBounds, StationLevelGrid grid, int activeLevel, Vector2? sectionPlanCentre = null) {
            Grid = grid;
            Camera.SetStation(documentBounds, activeLevel);
            Visibility.State.ActiveLevel = activeLevel;
            Visibility.State.LevelBase = grid.LevelBase;
            Visibility.State.StoreyHeight = grid.StoreyHeight;
            // The source re-places 剖切 on a station switch at the middle of the plan
            // on the storey being edited (`SceneRenderer.defaultSection`); an edit keeps
            // the player's cut.
            var centre = sectionPlanCentre ?? new Vector2(documentBounds.center.x, documentBounds.center.y);
            Section = new StationSectionPlane {
                Anchor = new Vector3(centre.x, centre.y, activeLevel),
                Azimuth = StationSectionPlane.DefaultAzimuth,
                Offset = 0f,
            };
            Visibility.Section = Section;
            Visibility.Apply();
            PublishChanged();
        }

        public bool TryApply(StationViewCommand command, out string code) {
            code = null;
            if (command == null) { code = "no-command"; return false; }
            switch (command.Type) {
                case StationViewCommandType.Orbit:
                    Camera.OrbitByPixels(command.Dx, command.Dy, command.Scale > 0f ? command.Scale : StationCameraMath.OrbitRadiansPerPixel);
                    break;
                case StationViewCommandType.Pan:
                    Camera.PanByPixels(command.Dx, command.Dy, ViewportHeight);
                    break;
                case StationViewCommandType.Zoom:
                    if (command.Factor > 0f) Camera.ZoomBy(command.Factor);
                    else Camera.ZoomByWheel(command.Dx);
                    break;
                case StationViewCommandType.Snap:
                    if (!command.HasDirection) { code = "bad-snap"; return false; }
                    Camera.SetViewDirection(command.Direction, command.Projection);
                    break;
                case StationViewCommandType.Home:
                    Camera.Home();
                    break;
                case StationViewCommandType.Frame:
                    Camera.Frame();
                    break;
                case StationViewCommandType.Fov:
                    Camera.SetFov(command.Degrees);
                    break;
                case StationViewCommandType.Projection:
                    Camera.SetProjection(command.Projection);
                    break;
                case StationViewCommandType.PanHeld:
                    Camera.SetHeldVertical(command.HeldDirection, command.HasFast ? command.Fast : (bool?)null);
                    break;
                case StationViewCommandType.PanPlanarHeld:
                    Camera.SetHeldPlanar(command.HeldRight, command.HeldForward, command.HasFast ? command.Fast : (bool?)null);
                    break;
                case StationViewCommandType.ViewSet:
                    if (!ApplyViewSet(command, out code)) return false;
                    break;
                default:
                    code = "unsupported-command";
                    return false;
            }
            PublishChanged();
            return true;
        }

        bool ApplyViewSet(StationViewCommand command, out string code) {
            code = null;
            var state = Visibility.State;
            switch (command.Key) {
                case StationViewKey.Level:
                    if (!Grid.TryValidate(command.IntValue, out int accepted)) { code = "level-outside-grid"; return false; }
                    if (state.ActiveLevel == accepted && Camera.ActiveLevel == accepted && Visibility.HasApplied) {
                        return true;
                    }
                    int previousLevel = state.ActiveLevel;
                    Camera.SetActiveLevel(accepted);
                    state.ActiveLevel = accepted;
                    Visibility.ApplyLevelChange(previousLevel);
                    return true;
                case StationViewKey.ShowLevels:
                    state.ShowLevels = command.BoolValue;
                    break;
                case StationViewKey.Ceiling:
                    state.AutoCeiling = command.BoolValue;
                    break;
                case StationViewKey.Walls:
                    state.HideWalls = command.BoolValue;
                    break;
                case StationViewKey.Ground:
                    state.HideGround = command.BoolValue;
                    break;
                case StationViewKey.Roof:
                    state.HideRoof = command.BoolValue;
                    break;
                case StationViewKey.HideUi:
                    state.SetHideUi(command.BoolValue);
                    break;
                case StationViewKey.LevelRail:
                    LevelRail = command.BoolValue;
                    break;
                case StationViewKey.Cutaway:
                    state.Cutaway = command.BoolValue;
                    Visibility.SectionClipping = command.BoolValue;
                    break;
                case StationViewKey.Section:
                    if (!command.HasSection) { code = "bad-section"; return false; }
                    Section = command.Section;
                    Visibility.Section = Section;
                    break;
                case StationViewKey.SectionAnchor:
                    if (!command.HasVector) { code = "bad-section-anchor"; return false; }
                    Section = Section.WithAnchor(command.VectorValue);
                    Visibility.Section = Section;
                    break;
                case StationViewKey.SectionRotate:
                    Section = Section.WithAzimuth(command.RotateToNext
                        ? StationSectionPlane.NextAzimuth(Section.Azimuth)
                        : command.FloatValue).WithOffset(0f);
                    Visibility.Section = Section;
                    break;
                case StationViewKey.SectionOffset:
                    Section = Section.WithOffset(command.FloatValue);
                    Visibility.Section = Section;
                    break;
                case StationViewKey.SectionSurface:
                    // 隐藏剖切面 keeps cutting; it only puts the sheet away.
                    SectionSurfaceVisible = command.BoolValue;
                    Visibility.SectionSurfaceVisible = command.BoolValue;
                    Visibility.Apply();
                    return true;
                case StationViewKey.Exploded:
                    if (!SetExploded(command.BoolValue, out code)) return false;
                    return true;
                case StationViewKey.Density:
                    state.Density = command.BoolValue;
                    break;
                case StationViewKey.Zones:
                    state.Zones = command.BoolValue;
                    break;
                case StationViewKey.FollowPassenger:
                    state.FollowPassenger = command.IntValue;
                    FollowPassenger = command.IntValue >= 0;
                    // The first-person eye view is not ported; the flag is state only and
                    // the published capability says so rather than pretending to move.
                    break;
                case StationViewKey.Theme: {
                    string normalized = NormalizeTheme(command.StringValue);
                    Theme = normalized;
                    ThemeChanged?.Invoke(normalized);
                    return true;
                }
                default:
                    code = "unknown-view-key";
                    return false;
            }
            Visibility.Apply();
            return true;
        }

        public void SyncExplodedState(bool on) {
            if (Visibility.State.Exploded == on) return;
            Visibility.State.Exploded = on;
            PublishChanged();
        }

        bool SetExploded(bool on, out string code) {
            code = null;
            if (ExplodedHandler != null && !ExplodedHandler(on)) {
                code = "exploded-failed";
                return false;
            }
            Visibility.State.Exploded = on;
            return true;
        }

        /// <summary>Advance the held vertical pan; the host calls this from Update.</summary>
        public void Tick(float deltaSeconds, bool fast = false) => Camera.Tick(deltaSeconds, fast);

        /// <summary>Write the camera pose to the Unity camera (if one is bound).</summary>
        public void ApplyCamera() {
            if (ViewCamera) Camera.ApplyTo(ViewCamera);
        }

        /// <summary>The small state fragment the host embeds in a v2 `state` reply.</summary>
        public string SnapshotJson() {
            Capabilities.SectionShaderPlane = Visibility.SectionShaderSupported;
            Capabilities.ExplodedDrag = ExplodedHandler != null;
            var builder = new StringBuilder(512);
            builder.Append("{\"camera\":");
            var snapshot = Camera.Snapshot(ViewCamera);
            snapshot.AppendJson(builder);
            builder.Append(",\"view\":");
            AppendViewJson(builder);
            builder.Append(",\"capabilities\":");
            Capabilities.AppendJson(builder);
            builder.Append('}');
            return builder.ToString();
        }

        public void AppendViewJson(StringBuilder builder) {
            var state = Visibility.State;
            builder.Append("{\"level\":").Append(state.ActiveLevel);
            builder.Append(",\"showLevels\":");
            StationCameraJson.AppendBool(builder, state.ShowLevels);
            builder.Append(",\"ceiling\":");
            StationCameraJson.AppendBool(builder, state.AutoCeiling);
            builder.Append(",\"walls\":");
            StationCameraJson.AppendBool(builder, state.HideWalls);
            builder.Append(",\"ground\":");
            StationCameraJson.AppendBool(builder, state.HideGround);
            builder.Append(",\"roof\":");
            StationCameraJson.AppendBool(builder, state.HideRoof);
            builder.Append(",\"hideUi\":");
            StationCameraJson.AppendBool(builder, state.HideUi);
            builder.Append(",\"levelRail\":");
            StationCameraJson.AppendBool(builder, LevelRail);
            builder.Append(",\"cutaway\":");
            StationCameraJson.AppendBool(builder, state.Cutaway);
            builder.Append(",\"exploded\":");
            StationCameraJson.AppendBool(builder, state.Exploded);
            builder.Append(",\"density\":");
            StationCameraJson.AppendBool(builder, state.Density);
            builder.Append(",\"zones\":");
            StationCameraJson.AppendBool(builder, state.Zones);
            builder.Append(",\"section\":");
            Section.AppendJson(builder);
            builder.Append(",\"sectionSurface\":");
            StationCameraJson.AppendBool(builder, SectionSurfaceVisible);
            builder.Append(",\"followPassenger\":").Append(state.FollowPassenger);
            builder.Append(",\"theme\":\"");
            builder.Append(Theme ?? "blueprint");
            builder.Append("\"}");
        }

        public static string NormalizeTheme(string theme) =>
            string.Equals(theme, "studio", StringComparison.OrdinalIgnoreCase) ? "studio"
            : string.Equals(theme, "site", StringComparison.OrdinalIgnoreCase) ? "site"
            : "blueprint";

        void PublishChanged() {
            Capabilities.SectionShaderPlane = Visibility.SectionShaderSupported;
            Changed?.Invoke();
        }
    }
}
