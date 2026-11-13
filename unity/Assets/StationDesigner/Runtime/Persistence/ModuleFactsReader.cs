using System;
using System.Collections.Generic;
using System.Globalization;
using Metro.Build;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>
    /// Projects a parsed v1 module list onto the plain facts the view resolver
    /// reads. JSON stays in this layer: the document keeps its authored records and
    /// the runtime receives an immutable snapshot of the placement and config.
    /// </summary>
    public static class ModuleFactsReader {
        public static ModuleFacts[] Read(JArray modules, string city = null) {
            if (modules == null) return Array.Empty<ModuleFacts>();
            var facts = new ModuleFacts[modules.Count];
            for (int i = 0; i < modules.Count; i++) facts[i] = Read(modules[i] as JObject, city);
            return facts;
        }

        public static ModuleFacts Read(JObject module, string city = null) {
            if (module == null) throw new ArgumentException("Invalid module record", nameof(module));
            var type = (string)module["type"] ?? throw new FormatException("Module has no type");
            return new ModuleFacts {
                Id = (string)module["id"] ?? "",
                Type = type,
                X = Int(module["x"]),
                Y = Int(module["y"]),
                Z = Int(module["z"]),
                Rotation = module["rot"]?.Type == JTokenType.Null ? 0 : Int(module["rot"]),
                Width = OptionalInt(module["w"], 1),
                Depth = OptionalInt(module["d"], 1),
                CeilingAnchored = module["ceilingAnchored"]?.Type == JTokenType.Boolean && (bool)module["ceilingAnchored"],
                From = ReadPoint(module["from"]),
                To = ReadPoint(module["to"]),
                Config = ReadConfig(module["cfg"] as JObject),
            };
        }

        static ModuleFacts.Point ReadPoint(JToken token) {
            if (token is not JObject point) return default;
            return new ModuleFacts.Point {
                X = Int(point["x"]), Y = Int(point["y"]), Z = Int(point["z"]), HasValue = true,
            };
        }

        public static ModuleConfig ReadConfig(JObject cfg) {
            if (cfg == null || cfg.Count == 0) return ModuleConfig.Empty;
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var property in cfg.Properties()) {
                var value = property.Value;
                switch (value.Type) {
                    case JTokenType.Null:
                    case JTokenType.Undefined:
                        values[property.Name] = "";
                        break;
                    case JTokenType.String:
                        values[property.Name] = (string)value;
                        break;
                    case JTokenType.Boolean:
                        values[property.Name] = (bool)value ? "true" : "false";
                        break;
                    case JTokenType.Integer:
                    case JTokenType.Float:
                        values[property.Name] = Convert.ToString(((JValue)value).Value, CultureInfo.InvariantCulture);
                        break;
                    default:
                        values[property.Name] = value.ToString(Newtonsoft.Json.Formatting.None);
                        break;
                }
            }
            return new ModuleConfig(values);
        }

        static int Int(JToken token) => token == null ? 0 : Convert.ToInt32(((JValue)token).Value, CultureInfo.InvariantCulture);
        static int OptionalInt(JToken token, int fallback) =>
            token == null || token.Type == JTokenType.Null ? fallback : Int(token);
    }
}
