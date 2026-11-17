using System;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>How an edit verb changes one module in the committed v1 envelope.</summary>
    public enum StationModuleEditMode { Add, Replace, Remove }

    /// <summary>
    /// The document half of the canvas editor (plan 16 §1.5). The resolver in
    /// <see cref="Metro.Build.StationModulePlacement"/> names the candidate; this file
    /// writes exactly that candidate into the committed save and hands the complete
    /// envelope back to <c>StationGameHost.ApplyDocumentEdit</c>, which owns the one
    /// atomic revision bump. Nothing here touches the scene or the revision.
    ///
    /// A move patches the **original** record's identity fields, so unknown authored
    /// fields (a sign's boards, a poster, an exit's name) travel untouched.
    /// </summary>
    public static class StationModuleEdits {
        /// <summary>One candidate as a saved v1 module record.</summary>
        public static JObject ToSaveRecord(StationEditDraft draft) {
            if (draft == null) throw new ArgumentNullException(nameof(draft));
            var record = new JObject {
                ["id"] = draft.Id,
                ["type"] = draft.Type,
                ["x"] = draft.X,
                ["y"] = draft.Y,
                ["z"] = draft.Z,
                ["rot"] = RotationOf(draft),
            };
            if (draft.Width > 1) record["w"] = draft.Width;
            if (draft.Depth > 1) record["d"] = draft.Depth;
            if (draft.Height > 1) record["h"] = draft.Height;
            if (draft.CeilingAnchored) record["ceilingAnchored"] = true;
            if (draft.PanelHeight > 0) record["panelH"] = draft.PanelHeight;
            if (draft.From.HasValue) record["from"] = Point(draft.From.Value);
            if (draft.To.HasValue) record["to"] = Point(draft.To.Value);
            var cfg = new JObject();
            foreach (var key in draft.Config.Keys) {
                var text = draft.Config[key];
                if (draft.JsonKeys.Contains(key)) {
                    try { cfg[key] = JToken.Parse(text); } catch (JsonException) { cfg[key] = text; }
                } else {
                    cfg[key] = Scalar(text);
                }
            }
            // A floor mark's sub-cell aim is authored as `cfg.offset`, never as a
            // fractional anchor (the record itself stays on a whole cell).
            if (Math.Abs(draft.OffsetX) > 1e-9 || Math.Abs(draft.OffsetY) > 1e-9) {
                cfg["offset"] = new JObject { ["x"] = draft.OffsetX, ["y"] = draft.OffsetY };
            }
            record["cfg"] = cfg;
            return record;
        }

        static JObject Point(StationPoint point) => new JObject {
            ["x"] = point.X, ["y"] = point.Y, ["z"] = point.Z,
        };

        /// <summary>
        /// The saved turn. Every piece is a quarter turn **except** a 细柱: a slim pillar's `rot`
        /// is its in-cell spot among the reference's nine positions (`IN_CELL_POSITIONS`), which
        /// `StationFootprints.PillarOffset` reads back, so normalizing it to four would move a
        /// post the player had stepped around its cell (plan 28 §3).
        /// </summary>
        static int RotationOf(StationEditDraft draft) {
            if (string.Equals(draft.Type, "pillar", StringComparison.Ordinal) &&
                !string.Equals(draft.Text("size"), "thick", StringComparison.Ordinal)) {
                return ((draft.Rotation % 9) + 9) % 9;
            }
            return StationFootprints.NormRot(draft.Rotation);
        }

        static JToken Scalar(string text) {
            if (string.Equals(text, "true", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(text, "false", StringComparison.OrdinalIgnoreCase)) return false;
            if (double.TryParse(text, System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var number)) return number;
            return text;
        }

        /// <summary>
        /// Apply one edit to the committed v1 envelope text. Returns the complete new
        /// envelope; a missing target or an unreadable save returns null with a stable
        /// code, leaving the caller's document untouched.
        /// </summary>
        public static string Apply(string savedJson, StationModuleEditMode mode, StationEditDraft draft, string removeId,
            out string code) {
            code = null;
            if (string.IsNullOrEmpty(savedJson)) { code = "no-document"; return null; }
            JObject envelope;
            try { envelope = JObject.Parse(savedJson); } catch (JsonException) { code = "parse-failed"; return null; }
            if (!ApplyToEnvelope(envelope, mode, draft, removeId, out code)) return null;
            return envelope.ToString(Formatting.None);
        }

        /// <summary>
        /// The surgical half: patch one module in a parsed v1 envelope **in place** (plan 30 §2).
        /// The caller owns the tree, so a committed document's envelope is cloned before it is
        /// handed here.
        /// </summary>
        public static bool ApplyToEnvelope(JObject envelope, StationModuleEditMode mode, StationEditDraft draft,
            string removeId, out string code) {
            code = null;
            if (envelope == null) { code = "no-document"; return false; }
            if (!(envelope["static"] is JObject state) || !(state["modules"] is JArray modules)) {
                code = "parse-failed";
                return false;
            }
            switch (mode) {
                case StationModuleEditMode.Remove: {
                    var existing = Find(modules, removeId);
                    if (existing == null) { code = "not-found"; return false; }
                    existing.Remove();
                    break;
                }
                case StationModuleEditMode.Add: {
                    if (draft == null) { code = "bad-payload"; return false; }
                    if (Find(modules, draft.Id) != null) { code = "duplicate-id"; return false; }
                    modules.Add(ToSaveRecord(draft));
                    break;
                }
                default: {
                    if (draft == null) { code = "bad-payload"; return false; }
                    var existing = Find(modules, draft.SourceId.Length > 0 ? draft.SourceId : draft.Id);
                    if (existing == null) { code = "not-found"; return false; }
                    ApplyMove(existing, draft);
                    break;
                }
            }
            return true;
        }

        static JObject Find(JArray modules, string id) {
            if (string.IsNullOrEmpty(id)) return null;
            foreach (var token in modules) {
                if (token is JObject module && string.Equals((string)module["id"], id, StringComparison.Ordinal)) return module;
            }
            return null;
        }

        /// <summary>
        /// Patch only the fields a move changes. `cfg.mountZ` follows the piece to its
        /// new course for a ground 出入口, and a floor mark's own offset travels with it;
        /// every other authored field is the record's own and is never rewritten.
        /// </summary>
        static void ApplyMove(JObject record, StationEditDraft draft) {
            record["x"] = draft.X;
            record["y"] = draft.Y;
            record["z"] = draft.Z;
            record["rot"] = StationFootprints.NormRot(draft.Rotation);
            if (draft.From.HasValue) record["from"] = Point(draft.From.Value);
            if (draft.To.HasValue) record["to"] = Point(draft.To.Value);
            var cfg = record["cfg"] as JObject;
            if (draft.Config.ContainsKey("mountZ")) {
                if (cfg == null) { cfg = new JObject(); record["cfg"] = cfg; }
                cfg["mountZ"] = Scalar(draft.Config["mountZ"]);
            }
        }
    }
}
