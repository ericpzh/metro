using System;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>
    /// The elevator's own record patch (plan 27 §5). A shaft's growth is not a move: the record
    /// keeps its id and column and only `from`/`to` and the stacked `cfg.rises` change, so this
    /// patches those fields **in place** and leaves every other authored field — the door map,
    /// the size, anything this port has not met — exactly as it was. A generic module replace
    /// would drop the unknown fields, which is why the lift has its own writer.
    /// </summary>
    public static class StationLiftEdits {
        /// <summary>Rewrite one lift's reach and rises; returns the new envelope or null with a code.</summary>
        public static string Apply(string savedJson, StationEditDraft draft, out string code) {
            code = null;
            if (draft == null || string.IsNullOrEmpty(draft.Id)) { code = "bad-payload"; return null; }
            if (string.IsNullOrEmpty(savedJson)) { code = "no-document"; return null; }
            JObject envelope;
            try { envelope = JObject.Parse(savedJson); } catch (JsonException) { code = "parse-failed"; return null; }
            if (!(envelope["static"] is JObject state) || !(state["modules"] is JArray modules)) {
                code = "parse-failed";
                return null;
            }
            JObject record = null;
            foreach (var token in modules) {
                if (!(token is JObject module)) continue;
                if (!string.Equals((string)module["id"], draft.Id, StringComparison.Ordinal)) continue;
                record = module;
                break;
            }
            if (record == null) { code = "not-found"; return null; }
            if (draft.From.HasValue) record["from"] = Point(draft.From.Value);
            if (draft.To.HasValue) record["to"] = Point(draft.To.Value);
            if (!(record["cfg"] is JObject cfg)) {
                cfg = new JObject();
                record["cfg"] = cfg;
            }
            var rises = draft.Text("rises");
            if (rises.Length > 0) {
                try { cfg["rises"] = JToken.Parse(rises); } catch (JsonException) { code = "bad-payload"; return null; }
            }
            return envelope.ToString(Formatting.None);
        }

        static JObject Point(StationPoint point) => new JObject {
            ["x"] = point.X, ["y"] = point.Y, ["z"] = point.Z,
        };
    }
}
