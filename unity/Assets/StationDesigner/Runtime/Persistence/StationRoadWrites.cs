using System;
using System.Collections.Generic;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>
    /// The document half of the road editor (plan 27 §6). <see cref="Metro.Build.StationRoadEdits"/>
    /// resolves and validates one stroke and hands back the complete authored road list; this
    /// writes that list into the committed v1 envelope and installs it through the **one** edit
    /// transaction, so a road stroke is one revision and one undo like every other edit
    /// (`StationRoadCommandHandler`'s earlier path installed through `Coordinator.Open` and kept a
    /// private undo stack; the unified history replaces it for pointer edits).
    ///
    /// Non-road modules, their order and every raw field are preserved: the authored road records
    /// are rewritten in place, and a longer list appends after the last road slot.
    /// </summary>
    public static class StationRoadWrites {
        /// <summary>Replace the envelope's road records with `next`. Returns the new envelope text.</summary>
        public static string Apply(string savedJson, IReadOnlyList<StationRoadRecord> next, out string code) {
            code = null;
            if (string.IsNullOrEmpty(savedJson)) { code = "no-document"; return null; }
            JObject root;
            try { root = JObject.Parse(savedJson); } catch (JsonException) { code = "parse-failed"; return null; }
            if (!(root["static"] is JObject station) || !(station["modules"] is JArray modules)) {
                code = "parse-failed";
                return null;
            }
            var pending = new Queue<StationRoadRecord>(next ?? Array.Empty<StationRoadRecord>());
            var rebuilt = new JArray();
            foreach (var token in modules) {
                if (!(token is JObject module) || !string.Equals((string)module["type"], "road", StringComparison.Ordinal)) {
                    rebuilt.Add(token.DeepClone());
                    continue;
                }
                if (pending.Count == 0) continue;
                rebuilt.Add(ToSaveRecord(pending.Dequeue()));
            }
            while (pending.Count > 0) rebuilt.Add(ToSaveRecord(pending.Dequeue()));
            station["modules"] = rebuilt;
            return root.ToString(Formatting.None);
        }

        /// <summary>One authored road module record, in the save's own shape.</summary>
        public static JObject ToSaveRecord(StationRoadRecord record) {
            var cfg = new JObject { ["direction"] = record.Direction ?? "one-way" };
            if (record.HasFrom) cfg["from"] = new JArray(record.From.X, record.From.Y);
            if (record.HasTo) cfg["to"] = new JArray(record.To.X, record.To.Y);
            return new JObject {
                ["id"] = record.Id,
                ["type"] = "road",
                ["x"] = record.X, ["y"] = record.Y, ["z"] = record.Z,
                ["w"] = record.W, ["d"] = record.D, ["rot"] = record.Rotation,
                ["cfg"] = cfg,
            };
        }
    }
}
