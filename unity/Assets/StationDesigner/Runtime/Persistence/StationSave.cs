using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    // First vertical slice: empty station v1 envelopes only. Refuse records that
    // require grid repair rather than claim unimplemented gameplay parity.
    public sealed class StationSave {
        readonly JObject source;
        StationSave(JObject source) { this.source = source; }
        public static StationSave ReadEmptyV1(string text) {
            JObject doc;
            try { doc = JObject.Parse(text); }
            catch (JsonException e) { throw new FormatException("Corrupt save", e); }
            if ((string)doc["format"] != "metro-save") throw new FormatException("Not a metro save");
            var version = doc["formatVersion"];
            if (version != null && version.Type != JTokenType.Integer && version.Type != JTokenType.Float)
                throw new NotSupportedException("Non-numeric version requires legacy reader");
            if (version != null && (double)version > 1) throw new FormatException("Save version is too new");
            var data = doc["static"] as JObject;
            var cells = data?["cells"] as JArray;
            if (cells == null) throw new FormatException("Missing station cells");
            foreach (string key in new[] { "cells", "modules", "lines" }) {
                var value = data[key];
                if (value != null && value.Type != JTokenType.Null && (!(value is JArray array) || array.Count != 0))
                    throw new NotSupportedException("Non-empty or invalid " + key + " needs the station repair port");
            }
            return new StationSave((JObject)doc.DeepClone());
        }
        public string WriteV1(DateTimeOffset savedAt) {
            var doc = (JObject)source.DeepClone();
            doc["formatVersion"] = 1;
            doc["gameVersion"] = "0.2.0";
            doc["savedAt"] = savedAt.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
            var data = (JObject)doc["static"];
            if (data["modules"] == null || data["modules"].Type == JTokenType.Null) data["modules"] = new JArray();
            if (data["lines"] == null || data["lines"].Type == JTokenType.Null) data["lines"] = new JArray();
            return doc.ToString(Formatting.None);
        }
    }
}
