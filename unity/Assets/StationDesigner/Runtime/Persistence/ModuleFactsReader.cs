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
                ExactZ = OptionalDouble(module["z"], 0),
                Rotation = module["rot"]?.Type == JTokenType.Null ? 0 : Int(module["rot"]),
                Width = OptionalInt(module["w"], 1),
                Depth = DepthOf(module, type),
                CeilingAnchored = module["ceilingAnchored"]?.Type == JTokenType.Boolean && (bool)module["ceilingAnchored"],
                From = ReadPoint(module["from"]),
                To = ReadPoint(module["to"]),
                Config = ReadConfig(module["cfg"] as JObject),
            };
        }

        /// <summary>
        /// The authored plan depth. A room family (`booth`, `shop`, `retail`) is saved as
        /// <c>w × h</c> — the source's `RoomModel`/`BoothModel` read both — so `d` is not
        /// its depth and defaulting it to 1 lost the authored rectangle (RCA 14 §3.4).
        /// Other families keep the `d` semantics (and its 1 m fallback).
        /// </summary>
        static int DepthOf(JObject module, string type) {
            if (IsRoomType(type)) {
                var height = OptionalInt(module["h"], 0);
                if (height > 0) return height;
            }
            return OptionalInt(module["d"], 1);
        }

        static bool IsRoomType(string type) =>
            string.Equals(type, "booth", StringComparison.Ordinal) ||
            string.Equals(type, "shop", StringComparison.Ordinal) ||
            string.Equals(type, "retail", StringComparison.Ordinal) ||
            string.Equals(type, "room", StringComparison.Ordinal);

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
        static double OptionalDouble(JToken token, double fallback) =>
            token == null || token.Type == JTokenType.Null ? fallback : Convert.ToDouble(((JValue)token).Value, CultureInfo.InvariantCulture);
    }
}
