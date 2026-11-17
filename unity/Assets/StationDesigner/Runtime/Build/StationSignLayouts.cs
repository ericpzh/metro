using System;
using System.Collections.Generic;
using System.Globalization;

namespace Metro.Build {
    /// <summary>
    /// The board a fresh 标识 is born with (`sim/sign.ts` `defaultSignLayout`): a composed
    /// **front**, not a blank face — arrow-left, the station's first line badge, an exit icon and
    /// arrow-right, all on the board's centre line and printed on both faces. A station with no
    /// line yet prints **no shield**: an empty one would claim a line the station does not have.
    ///
    /// This is the layout model's default only. The sign **editor** (component dragging, bins,
    /// settle/compact rules for authored layouts) is not ported, so a saved sign with a composed
    /// layout is read as-is and never re-settled here.
    /// </summary>
    public static class StationSignLayouts {
        /// <summary>The panel's height floor, metres — every component sits on its centre line.</summary>
        public const double PanelMinHeight = 0.4;
        /// <summary>`ROW_Y`: the centre line every component sits on, metres.</summary>
        public static double RowY => PanelMinHeight / 2;

        /// <summary>
        /// `defaultSignLayout` as the stored `front` array: four components on the centre line,
        /// the line badge omitted when the station has no line.
        /// </summary>
        public static string Default(StationLineRecord firstLine) {
            var parts = new List<string> {
                Component("c1", "arrow", "\"arrow\":\"left\"", 0.32),
                Component("c3", "icon", "\"icon\":\"exit\"", 1.2),
                Component("c4", "arrow", "\"arrow\":\"right\"", 1.6),
            };
            if (firstLine != null) {
                parts.Insert(1, Component("c2", "line",
                    "\"lineId\":" + Quote(firstLine.Id ?? "") + ",\"english\":true", 0.8));
            }
            return "[" + string.Join(",", parts) + "]";
        }

        static string Component(string id, string kind, string extra, double x) =>
            "{\"id\":" + Quote(id) + ",\"kind\":" + Quote(kind) + "," + extra +
            ",\"x\":" + Number(x) + ",\"y\":" + Number(RowY) +
            ",\"scale\":1,\"side\":\"both\"}";

        static string Quote(string value) {
            var builder = new System.Text.StringBuilder("\"");
            foreach (var ch in value ?? "") {
                if (ch == '"' || ch == '\\') builder.Append('\\');
                builder.Append(ch);
            }
            return builder.Append('"').ToString();
        }

        static string Number(double value) => value.ToString("0.###", CultureInfo.InvariantCulture);
    }
}
