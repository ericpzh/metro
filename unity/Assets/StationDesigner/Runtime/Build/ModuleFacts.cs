using System;
using System.Collections.Generic;
using System.Globalization;

namespace Metro.Build {
    /// <summary>
    /// One saved module as the view layer consumes it: identity, placement,
    /// footprint and the authored config. Plain data — no engine references — so
    /// the resolver and its tests run without a scene.
    /// </summary>
    public sealed class ModuleFacts {
        public struct Point {
            public int X, Y, Z;
            public bool HasValue;
        }

        public string Id = "";
        public string Type = "";
        public int X;
        public int Y;
        public int Z;
        double? exactZ;
        /// <summary>Exact authored elevation (<c>m.z</c>), preserving fractional wall-artwork anchors.</summary>
        public double ExactZ {
            get => exactZ ?? Z;
            set => exactZ = value;
        }
        /// <summary>Quarter turns counter-clockwise in plan space (document convention).</summary>
        public int Rotation;
        public int Width = 1;
        public int Depth = 1;
        /// <summary>Saved hanging flag: the piece rides a ceiling or hanger bar.</summary>
        public bool CeilingAnchored;
        /// <summary>Authored run endpoints (stairs, escalators, lifts, tracks).</summary>
        public Point From;
        public Point To;
        public ModuleConfig Config = ModuleConfig.Empty;

        public override string ToString() => $"{Type} {Id} at ({X},{Y},{Z}) rot {Rotation}";
    }

    /// <summary>
    /// The authored `cfg` of a module, flattened to text so the resolver can read it
    /// without a JSON dependency. Scalars keep their JSON text; arrays and objects
    /// keep their raw JSON for the dimension-driven generators.
    /// </summary>
    public sealed class ModuleConfig {
        public static readonly ModuleConfig Empty = new ModuleConfig(null);

        readonly Dictionary<string, string> values;

        public ModuleConfig(IDictionary<string, string> source) {
            values = new Dictionary<string, string>(StringComparer.Ordinal);
            if (source == null) return;
            foreach (var pair in source) values[pair.Key] = pair.Value ?? "";
        }

        public int Count => values.Count;
        public IEnumerable<string> Keys => values.Keys;
        public bool Has(string key) => values.ContainsKey(key);

        /// <summary>The scalar text of a value, or the empty string when absent.</summary>
        public string Text(string key) => values.TryGetValue(key, out var value) ? value : "";

        /// <summary>Raw JSON of a value, for arrays and objects.</summary>
        public string Json(string key) => Text(key);

        public bool Bool(string key, bool fallback = false) {
            var text = Text(key);
            if (text.Length == 0) return fallback;
            if (string.Equals(text, "true", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(text, "false", StringComparison.OrdinalIgnoreCase)) return false;
            return fallback;
        }

        public double Number(string key, double fallback = 0) =>
            double.TryParse(Text(key), NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ? value : fallback;

        /// <summary>Read a JSON number array such as offset: [0.16, -0.16].</summary>
        public bool TryNumbers(string key, out double[] values) {
            values = Array.Empty<double>();
            var text = Text(key).Trim();
            if (text.Length < 2 || text[0] != '[') return false;
            var parts = text.Substring(1, text.Length - 2).Split(',');
            var parsed = new double[parts.Length];
            for (int i = 0; i < parts.Length; i++) {
                if (!double.TryParse(parts[i].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out parsed[i]))
                    return false;
            }
            values = parsed;
            return true;
        }

        public int Int(string key, int fallback = 0) =>
            int.TryParse(Text(key), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : fallback;
    }
}
