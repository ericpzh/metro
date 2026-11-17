using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// A 站名 inscription's panel (`sim/calligraphy.ts`): the station's own name, cut to a wall
    /// panel **when the piece is placed and never again** — a wider inscription is a wider piece
    /// of wall, so a rename reprints the ink inside the panel it already has rather than rebuilding
    /// a wall behind a placed piece. The width is always an **odd** number of cells, which is what
    /// puts the inscription's centre on the cell the pointer aimed at.
    ///
    /// The pixels (the brush face, the tracking, the second strike) are the renderer's business;
    /// this is the table and the arithmetic, so a panel's size can be asked for without a canvas.
    /// </summary>
    public static class StationCalligraphy {
        /// <summary>The run's margin, metres (half at each end).</summary>
        public const double Pad = 0.3;
        /// <summary>One character's advance, metres.</summary>
        public const double Advance = 0.86;
        /// <summary>The largest a character is cut, metres.</summary>
        public const double InkMax = 0.85;
        /// <summary>The most characters an inscription carries.</summary>
        public const int MaxChars = 8;
        /// <summary>横排's band: one metre tall, 1.2 m to its bottom, at most five cells.</summary>
        public const double HPanelH = 1, HBottom = 1.2;
        public const int HMaxCells = 5;
        /// <summary>竖排's column: 0.98 m wide, 0.4 m to its bottom, at most 2.6 m tall.</summary>
        public const double VPanelW = 0.98, VBottom = 0.4, VMaxPanelH = 2.6;

        /// <summary>
        /// `calligraphyChars`: the name's characters in reading order, trimmed and capped; a name
        /// with none prints the fallback word rather than nothing.
        /// </summary>
        public static List<string> Chars(string name) {
            var chars = new List<string>();
            foreach (var ch in (name ?? "").Trim()) chars.Add(ch.ToString());
            if (chars.Count == 0) {
                // The reference's fallback word is localised; a station name is never blank, so
                // this is the "unnamed" case only.
                foreach (var ch in "未命名车站") chars.Add(ch.ToString());
            }
            if (chars.Count > MaxChars) chars.RemoveRange(MaxChars, chars.Count - MaxChars);
            return chars;
        }

        /// <summary>
        /// `calligraphyPanelCells`: the run's want rounded up to an **odd** cell count, capped by
        /// the band's own (also odd) ceiling.
        /// </summary>
        public static int PanelCells(double want, int max = HMaxCells) {
            int up = Math.Max(1, (int)Math.Ceiling(want - 1e-9));
            int odd = up % 2 == 1 ? up : up + 1;
            int capped = Math.Min(odd, max);
            return capped % 2 == 1 ? capped : Math.Max(1, capped - 1);
        }

        /// <summary>One panel: the cells it fills, its height and the ink size it prints.</summary>
        public readonly struct Geometry {
            public Geometry(List<string> chars, string axis, int cells, double panelH, double panelW, double ink, double bottom) {
                Chars = chars; Axis = axis; Cells = cells; PanelH = panelH; PanelW = panelW;
                Ink = ink; Bottom = bottom;
            }

            public List<string> Chars { get; }
            public string Axis { get; }
            public int Cells { get; }
            public double PanelH { get; }
            public double PanelW { get; }
            public double Ink { get; }
            public double Bottom { get; }
        }

        /// <summary>
        /// `calligraphyGeometry`: a horizontal run is a band whose width rounds to odd cells; a
        /// vertical one is always one cell wide and grows down the wall.
        /// </summary>
        public static Geometry For(string name, string axis) {
            var chars = Chars(name);
            int n = Math.Max(1, chars.Count);
            double want = Pad + n * Advance;
            if (string.Equals(axis, "v", StringComparison.Ordinal)) {
                double panelH = Math.Min(VMaxPanelH, Math.Max(1, want));
                double advance = (panelH - Pad) / n;
                return new Geometry(chars, "v", 1, panelH, VPanelW, Math.Min(InkMax, advance * 0.92), VBottom);
            }
            int cells = PanelCells(want);
            double bandAdvance = (cells - Pad) / n;
            return new Geometry(chars, "h", cells, HPanelH, cells, Math.Min(InkMax, bandAdvance * 0.92), HBottom);
        }

        /// <summary>
        /// The wall courses a panel crosses, from `bottom` to `bottom + panelH` — the backing a
        /// wall-mounted inscription needs behind it.
        /// </summary>
        public static List<int> Courses(double bottom, double panelH) {
            var courses = new List<int>();
            int first = (int)Math.Floor(bottom + 1e-9);
            int last = (int)Math.Floor(bottom + panelH - 1e-9);
            for (int course = first; course <= last; course++) courses.Add(course);
            return courses;
        }
    }
}
