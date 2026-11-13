using System;
using System.Collections.Generic;

namespace Metro.Build {
    // Plan 11, packet F3 - the 指示牌 edit transaction.
    //
    // This file is the engine-free half of the sign edit, exactly as
    // `StationFinishEdits` is for painting: it validates a typed transaction against
    // the committed sign facts and never mutates anything. `Metro.App` owns the v1
    // save JSON (the assembly boundary: Metro.Build has no Newtonsoft or UnityEngine
    // reference) and applies the accepted writes through
    // `StationGameHost.ApplyDocumentEdit`, which is the one path that stages a whole
    // normalized document, bumps the revision once and publishes one commit.
    //
    // The source edit model is `game/src/sim/sign.ts` + `app/store/slices/SignSlice.ts`:
    //   * a sign owns **two boards**, `cfg.front` and `cfg.back`, each an ordered list
    //     of components (`arrow` | `line` | `text` | `icon`);
    //   * the editor writes **whole faces** (`settleSignBoards`), never one component,
    //     and only the fields `signBoardsOf`/`SignComponent` declare — the mount,
    //     booth attachment and every other saved field stay with the document;
    //   * a component's `side` is folded into the face that carries it, so a committed
    //     face is always stored with `side: "both"` (`signBoardsOf`'s `own()`).
    //
    // What validation belongs here (typed, host-free):
    //   * the sign id exists (`unknown-sign`) and the face exists on it (`unknown-face`);
    //   * one write per face (`duplicate-line`);
    //   * component counts, text line/character bounds, ids, finite numbers, scale
    //     range, known line ids and known fields (`bad-payload`);
    //   * the expected revision (`stale-revision`). The router also fences a command
    //     whose envelope `expectedRevision` differs (`revision-mismatch`); this check
    //     is the transaction's own guard for direct callers and for a handler that is
    //     handed a request out of band.
    //
    // Component vocabularies (`arrow`, `icon`) are decoded by the bridge layer
    // (`StationSignVocabulary` lives in App and is the one spelling table), so this
    // transaction never invents an arrow or a pictogram: an unknown one is refused as
    // `bad-payload` before the request reaches it.

    /// <summary>Which of a sign's two boards a write replaces (`SignFaceName`).</summary>
    public enum StationSignEditFace { Front = 0, Back = 1 }

    /// <summary>The four kinds a board component can have (`SignComponentKind`).</summary>
    public enum StationSignEditKind { Arrow = 0, Line = 1, Text = 2, Icon = 3 }

    /// <summary>
    /// One board component as the editor writes it. The fields are exactly
    /// `sim/sign.ts`'s `SignComponent` union; the bridge layer fills them from JSON and
    /// the app layer converts them back with `StationSignVocabulary`.
    /// </summary>
    public sealed class StationSignEditComponent {
        public string Id = "";
        public StationSignEditKind Kind;
        /// <summary>Centre on the panel, metres from the panel's bottom-left.</summary>
        public double X;
        public double Y;
        public double Scale = 1;
        /// <summary>`both` | `left` | `right`; a committed face stores `both`.</summary>
        public string Side = "both";
        /// <summary>`text` payload: up to two rows of `StationSignEdits.MaxTextCharacters`.</summary>
        public string Text = "";
        /// <summary>`arrow` payload: one of `StationSignVocabulary.Arrows`.</summary>
        public string Arrow = "right";
        /// <summary>`icon` payload: one of `StationSignVocabulary.Icons`.</summary>
        public string Icon = "restroom";
        /// <summary>`line` payload: the shield's line id; empty means the default line.</summary>
        public string LineId = "";
        /// <summary>`line` payload: print the compact English gloss under the number.</summary>
        public bool English;
    }

    /// <summary>The content one face is set to: the whole ordered component list.</summary>
    public sealed class StationSignEditFaceContent {
        public List<StationSignEditComponent> Components = new List<StationSignEditComponent>();

        public StationSignEditFaceContent Clone() {
            var copy = new StationSignEditFaceContent { Components = new List<StationSignEditComponent>(Components.Count) };
            foreach (var component in Components) copy.Components.Add(Clone(component));
            return copy;
        }

        static StationSignEditComponent Clone(StationSignEditComponent value) => value == null ? null : new StationSignEditComponent {
            Id = value.Id, Kind = value.Kind, X = value.X, Y = value.Y, Scale = value.Scale, Side = value.Side,
            Text = value.Text, Arrow = value.Arrow, Icon = value.Icon, LineId = value.LineId, English = value.English,
        };
    }

    /// <summary>One face of one sign to replace.</summary>
    public sealed class StationSignEditFaceWrite {
        public string SignId = "";
        public StationSignEditFace Face;
        public StationSignEditFaceContent Content = new StationSignEditFaceContent();
    }

    /// <summary>The committed facts about a sign the transaction validates against.</summary>
    public sealed class StationSignEditSign {
        public string Id = "";
        /// <summary>The saved `cfg.mount`; absent is the hanging board (`signMountOf`).</summary>
        public string Mount = "";
        /// <summary>The record carries a `cfg.front` array (it may be empty).</summary>
        public bool HasFront;
        /// <summary>The record carries a `cfg.back` array (an empty back is editable).</summary>
        public bool HasBack;
    }

    /// <summary>
    /// A whole sign edit: one sign, one or both faces, and the revision it was
    /// composed against. <see cref="Signs"/> and <see cref="KnownLineIds"/> are the
    /// committed document's facts, supplied by the caller.
    /// </summary>
    public sealed class StationSignEditRequest {
        public string SignId = "";
        /// <summary>The host revision the edit was composed against; -1 skips the check.</summary>
        public int ExpectedRevision = -1;
        public List<StationSignEditFaceWrite> Writes = new List<StationSignEditFaceWrite>();
        public List<StationSignEditSign> Signs = new List<StationSignEditSign>();
        public List<string> KnownLineIds = new List<string>();
    }

    /// <summary>One face the transaction accepted, in request order.</summary>
    public sealed class StationSignEditApplied {
        public string SignId = "";
        public StationSignEditFace Face;
        public StationSignEditFaceContent Content;
    }

    /// <summary>
    /// The transaction's verdict. <see cref="Code"/> is the stable rejection string the
    /// bridge replies with: `unknown-sign`, `unknown-face`, `bad-payload`,
    /// `stale-revision` or `duplicate-line`. <see cref="Changed"/> is the commit layer's
    /// answer to "does this actually reprint the face?" - it is not set here, because
    /// only the app assembly owns the board content key.
    /// </summary>
    public sealed class StationSignEditResult {
        public bool Accepted;
        /// <summary>The app layer sets this once it has compared the committed content.</summary>
        public bool Changed;
        public string Code = "ok";
        public string Message = "";
        public List<StationSignEditApplied> Applied = new List<StationSignEditApplied>();

        public static StationSignEditResult Reject(string code, string message) =>
            new StationSignEditResult { Accepted = false, Code = code, Message = message ?? code };

        public static StationSignEditResult Accept(IEnumerable<StationSignEditApplied> applied) {
            var result = new StationSignEditResult { Accepted = true, Code = "ok" };
            if (applied != null) result.Applied.AddRange(applied);
            return result;
        }
    }

    /// <summary>
    /// The typed, validating half of one sign edit. It reads the committed sign facts
    /// (<see cref="StationSignEditSign"/>), never mutates the request or the document,
    /// and returns either the accepted face writes or one typed code.
    /// </summary>
    public static class StationSignEdits {
        /// <summary>`SIGN_COMPONENT_MAX`: the most marks one board holds.</summary>
        public const int MaxComponents = 10;
        /// <summary>`SIGN_TEXT_MAX` / `SIGN_TEXT_EN_MAX`: characters in one label row.</summary>
        public const int MaxTextCharacters = 24;
        /// <summary>`SIGN_TEXT_LINES`: the most rows one label prints.</summary>
        public const int MaxTextLines = 2;
        /// <summary>A hard cap on the raw text, so a malformed payload cannot be huge.</summary>
        public const int MaxTextStorage = 256;
        /// <summary>`SIGN_SCALE_MIN` and `SIGN_SCALE_MAX`.</summary>
        public const double MinScale = 0.4;
        public const double MaxScale = 2.0;
        /// <summary>The editor works in panel metres; a wild coordinate is a bad payload.</summary>
        public const double MaxCoordinate = 1000.0;
        /// <summary>The component id the source mints (`c1`, `c2`, ...); bounded here.</summary>
        public const int MaxIdLength = 64;

        public static readonly string[] FaceNames = { "front", "back" };
        public static readonly string[] SideNames = { "both", "left", "right" };

        public static string FaceName(StationSignEditFace face) => face == StationSignEditFace.Back ? "back" : "front";

        public static bool TryParseFace(string value, out StationSignEditFace face) {
            if (string.Equals(value, "front", StringComparison.Ordinal)) { face = StationSignEditFace.Front; return true; }
            if (string.Equals(value, "back", StringComparison.Ordinal)) { face = StationSignEditFace.Back; return true; }
            face = StationSignEditFace.Front;
            return false;
        }

        /// <summary>The characters a label prints: one per code point, as `[...r]` counts.</summary>
        public static int TextLength(string text) {
            if (string.IsNullOrEmpty(text)) return 0;
            int count = 0;
            for (int i = 0; i < text.Length; i++, count++) {
                if (char.IsHighSurrogate(text[i]) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1])) i++;
            }
            return count;
        }

        /// <summary>The non-empty rows a label prints, split as `signTextLines` splits them.</summary>
        public static string[] TextRows(string text) {
            var rows = new List<string>(2);
            if (string.IsNullOrEmpty(text)) return rows.ToArray();
            foreach (var raw in text.Split('\n')) {
                var row = raw.EndsWith("\r", StringComparison.Ordinal) ? raw.Substring(0, raw.Length - 1) : raw;
                if (row.Length == 0) continue;
                rows.Add(row);
            }
            return rows.ToArray();
        }

        /// <summary>Validate one transaction. Never throws on a bad request; never mutates it.</summary>
        public static StationSignEditResult Validate(StationSignEditRequest request, int committedRevision) {
            if (request == null) return StationSignEditResult.Reject("bad-payload", "The sign edit is missing.");
            if (string.IsNullOrEmpty(request.SignId)) return StationSignEditResult.Reject("bad-payload", "sign.commit needs payload.signId.");
            if (request.ExpectedRevision >= 0 && committedRevision >= 0 && request.ExpectedRevision != committedRevision) {
                return StationSignEditResult.Reject("stale-revision",
                    "The edit expected revision " + request.ExpectedRevision + " but the committed revision is " + committedRevision + ".");
            }
            var sign = FindSign(request.Signs, request.SignId);
            if (sign == null) return StationSignEditResult.Reject("unknown-sign", "No sign record '" + request.SignId + "' is committed.");
            if (request.Writes == null || request.Writes.Count == 0) {
                return StationSignEditResult.Reject("bad-payload", "sign.commit needs at least one face to write.");
            }

            var applied = new List<StationSignEditApplied>(request.Writes.Count);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var write in request.Writes) {
                if (write == null) return StationSignEditResult.Reject("bad-payload", "sign.commit carries an empty face write.");
                var signId = string.IsNullOrEmpty(write.SignId) ? request.SignId : write.SignId;
                if (!string.Equals(signId, request.SignId, StringComparison.Ordinal)) {
                    return StationSignEditResult.Reject("unknown-sign", "One sign edit may only write the sign it names ('" + request.SignId + "').");
                }
                if (!string.Equals(signId, sign.Id, StringComparison.Ordinal)) {
                    return StationSignEditResult.Reject("unknown-sign", "No sign record '" + signId + "' is committed.");
                }
                var faceName = FaceName(write.Face);
                if ((write.Face == StationSignEditFace.Front && !sign.HasFront) || (write.Face == StationSignEditFace.Back && !sign.HasBack)) {
                    return StationSignEditResult.Reject("unknown-face", "Sign '" + signId + "' has no '" + faceName + "' board.");
                }
                if (!seen.Add(signId + "/" + faceName)) {
                    return StationSignEditResult.Reject("duplicate-line", "Sign '" + signId + "' writes its '" + faceName + "' face twice.");
                }
                string message;
                if (!ValidateContent(write.Content, request.KnownLineIds, out message)) {
                    return StationSignEditResult.Reject("bad-payload", message);
                }
                applied.Add(new StationSignEditApplied { SignId = signId, Face = write.Face, Content = write.Content });
            }
            return StationSignEditResult.Accept(applied);
        }

        static StationSignEditSign FindSign(List<StationSignEditSign> signs, string id) {
            if (signs == null) return null;
            foreach (var sign in signs) if (sign != null && string.Equals(sign.Id, id, StringComparison.Ordinal)) return sign;
            return null;
        }

        /// <summary>The per-face rules: counts, ids, numbers, side, text and known lines.</summary>
        public static bool ValidateContent(StationSignEditFaceContent content, List<string> knownLineIds, out string message) {
            message = "";
            if (content == null || content.Components == null) {
                message = "The face needs a components array.";
                return false;
            }
            if (content.Components.Count > MaxComponents) {
                message = "A board holds at most " + MaxComponents + " marks, not " + content.Components.Count + ".";
                return false;
            }
            var ids = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < content.Components.Count; i++) {
                var component = content.Components[i];
                if (component == null) {
                    message = "Component " + i + " is empty.";
                    return false;
                }
                if (!string.IsNullOrEmpty(component.Id)) {
                    if (component.Id.Length > MaxIdLength) {
                        message = "Component id '" + component.Id + "' is longer than " + MaxIdLength + ".";
                        return false;
                    }
                    if (!ids.Add(component.Id)) {
                        message = "Component id '" + component.Id + "' appears twice on one face.";
                        return false;
                    }
                }
                if (!IsFinite(component.X) || !IsFinite(component.Y) || Math.Abs(component.X) > MaxCoordinate || Math.Abs(component.Y) > MaxCoordinate) {
                    message = "Component " + i + " has an invalid position.";
                    return false;
                }
                if (!IsFinite(component.Scale) || component.Scale < MinScale - 1e-9 || component.Scale > MaxScale + 1e-9) {
                    message = "Component " + i + " has a scale outside " + MinScale + ".." + MaxScale + ".";
                    return false;
                }
                if (!IsSide(component.Side)) {
                    message = "Component " + i + " has an unknown side '" + (component.Side ?? "") + "'.";
                    return false;
                }
                switch (component.Kind) {
                    case StationSignEditKind.Arrow:
                        if (string.IsNullOrEmpty(component.Arrow)) {
                            message = "Arrow component " + i + " has no direction.";
                            return false;
                        }
                        break;
                    case StationSignEditKind.Icon:
                        if (string.IsNullOrEmpty(component.Icon)) {
                            message = "Icon component " + i + " has no pictogram.";
                            return false;
                        }
                        break;
                    case StationSignEditKind.Line:
                        if (!KnownLine(component.LineId, knownLineIds, out message)) return false;
                        break;
                    case StationSignEditKind.Text:
                        if (!ValidateText(i, component.Text, out message)) return false;
                        break;
                    default:
                        message = "Component " + i + " has an unknown kind.";
                        return false;
                }
            }
            return true;
        }

        static bool KnownLine(string lineId, List<string> knownLineIds, out string message) {
            message = "";
            if (string.IsNullOrEmpty(lineId)) return true; // the station's first line (`signBoardsOf`)
            if (knownLineIds != null) {
                foreach (var known in knownLineIds) if (string.Equals(known, lineId, StringComparison.Ordinal)) return true;
            }
            message = "Line badge names '" + lineId + "', which the station does not have.";
            return false;
        }

        static bool ValidateText(int index, string text, out string message) {
            message = "";
            if (text == null) {
                message = "Text component " + index + " has no text.";
                return false;
            }
            if (text.Length > MaxTextStorage) {
                message = "Text component " + index + " is longer than " + MaxTextStorage + " characters.";
                return false;
            }
            var rows = TextRows(text);
            if (rows.Length > MaxTextLines) {
                message = "A label prints at most " + MaxTextLines + " rows, not " + rows.Length + ".";
                return false;
            }
            foreach (var row in rows) {
                int length = TextLength(row);
                if (length > MaxTextCharacters) {
                    message = "A label row prints at most " + MaxTextCharacters + " characters, not " + length + ".";
                    return false;
                }
            }
            return true;
        }

        static bool IsSide(string side) {
            foreach (var name in SideNames) if (string.Equals(name, side, StringComparison.Ordinal)) return true;
            return false;
        }

        static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
    }
}
