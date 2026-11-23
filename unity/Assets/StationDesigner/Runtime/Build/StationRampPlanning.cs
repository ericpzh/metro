using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// The ramp corridor (plan 27 §5): the port of `sim/openings.ts`'s `rampEnvelope` for the
    /// **straight** runs this port creates — one flight per stair, one escalator/walkway band —
    /// with the body, corridor and lane halves `rampBodyHalf`/`rampCorridorHalf`/`rampLaneHalf`
    /// read. A turning stair's multi-flight envelope (`stairSegments` + `stairFlightSlides`) is
    /// not ported: <see cref="TryEnvelope"/> refuses it with a stable code instead of guessing.
    ///
    /// The envelope is the reservation: `RAMP_FOOT` (0.5 m) below the walking line for the body,
    /// `RAMP_HEADROOM` (1.2 m) above it for the balustrade, and `RAMP_CLEAR` (0.15 m) of padding
    /// on each side. The **carve** (`rampSlopeCuts`/`carveRampOpenings`) is a separate rule: a
    /// run may only be laid where this envelope is already open — see
    /// <see cref="CorridorClear"/> — and a run that would need its blocks cut is refused with
    /// `ramp-carve-required` rather than silently carving the player's work.
    /// </summary>
    public static class StationRampRules {
        /// <summary>How deep a run's body hangs under its walking line (`RAMP_FOOT`).</summary>
        public const double Foot = 0.5;
        /// <summary>Balustrade height above the walking line (`RAMP_HEADROOM`).</summary>
        public const double Headroom = 1.2;
        /// <summary>Vertical padding so a run never reads as touching the storey above/below.</summary>
        public const double Clear = 0.15;
        /// <summary>The clear step band between an escalator's balustrades (`ESCALATOR_BAND`).</summary>
        public const double Band = 0.68;
        /// <summary>The spacing between an escalator's balustrades (`ESCALATOR_BALUSTRADE`).</summary>
        public const double Balustrade = 0.82;
        /// <summary>How far an escalator's casing stands proud of its body (`ESCALATOR_CASING_PROUD`).</summary>
        public const double CasingProud = 0.08;
        /// <summary>A stair handrail's proud run (`STAIR_RAIL_PROUD`).</summary>
        public const double StairRailProud = 0.105;
        /// <summary>The three catalogue stair widths, in metres (`STAIR_WIDTHS`).</summary>
        static readonly double[] StairWidths = { Band, 2 * Band, 3 * Band };

        /// <summary>True for a run piece: a flight, an escalator or a 自动步道 (never a 楼梯块).</summary>
        public static bool IsRun(StationModuleRecord m) =>
            m != null && !(m.Type == "stair" && m.Config.Bool("block")) &&
            (m.Type == "stair" || m.Type == "escalator" || m.Type == "walkway");

        /// <summary>`stairTreadWidth`: a catalogue straight stair fills the blocks it stands in.</summary>
        public static double StairTreadWidth(StationModuleRecord m) {
            double width = m.Config.Number("width", Band);
            int size = Array.FindIndex(StairWidths, w => Math.Abs(width - w) < 1e-6);
            bool single = Flights(m) <= 1;
            return !m.Config.Bool("block") && single && size >= 0 ? size + 1 - 2 * StairRailProud : width;
        }

        /// <summary>The width a stair stores (`cfg.width`), the palette narrow width when none.</summary>
        public static double StairWidth(StationModuleRecord m) {
            double width = m.Config.Number("width", Band);
            return width > 0 ? width : Band;
        }

        /// <summary>How many lanes a stair width fills (`stairRunBlocks`, 1..3).</summary>
        public static int StairRunBlocks(double width) =>
            Math.Max(1, Math.Min(3, (int)Math.Round(width + 2 * StairRailProud)));

        /// <summary>`stairOnBlockGrid`: the width fills whole blocks, so its runs sit on the grid.</summary>
        public static bool StairOnBlockGrid(double width) =>
            Math.Abs(width + 2 * StairRailProud - StairRunBlocks(width)) < 1e-6;

        /// <summary>`rampBodyHalf`: half the drawn body, handrails excluded.</summary>
        public static double BodyHalf(StationModuleRecord m) {
            if (m.Type == "stair") return StairTreadWidth(m) / 2;
            if (m.Type == "escalator" || m.Type == "walkway") return EscalatorBodyWidth(Width(m)) / 2;
            return Band / 2;
        }

        /// <summary>`rampCorridorHalf`: the body plus its handrail/casing proud.</summary>
        public static double CorridorHalf(StationModuleRecord m) {
            if (m.Type == "stair") return StairTreadWidth(m) / 2 + StairRailProud;
            if (m.Type == "escalator" || m.Type == "walkway") return EscalatorBodyWidth(Width(m)) / 2 + CasingProud;
            return Band / 2 + CasingProud;
        }

        /// <summary>`escalatorBodyWidth`: the casing's width for a lane count.</summary>
        public static double EscalatorBodyWidth(int width) => Balustrade + (Math.Max(1, width) - 1);

        /// <summary>`cfg.width`, the lane count a wide escalator/walkway fills.</summary>
        public static int Width(StationModuleRecord m) =>
            Math.Max(1, Math.Min(3, (int)Math.Round(m.Config.Number("width", 1))));

        /// <summary>`cfg.flights` length: 1 for a straight run, more for a turning one.</summary>
        /// <summary>
        /// The saved flights of a stair, in the order they were built (`stairFlights`): the one
        /// `from`/`to` pair when the piece carries none, one entry per flight otherwise.
        /// </summary>
        public static List<(StationPoint From, StationPoint To)> FlightsOf(StationModuleRecord m) {
            var flights = new List<(StationPoint From, StationPoint To)>();
            if (m == null) return flights;
            var text = m.Config.Text("flights");
            if (!string.IsNullOrEmpty(text)) {
                try {
                    var array = Newtonsoft.Json.Linq.JArray.Parse(text);
                    foreach (var token in array) {
                        if (!(token is Newtonsoft.Json.Linq.JObject entry)) continue;
                        var from = PointOf(entry["from"]);
                        var to = PointOf(entry["to"]);
                        if (from.HasValue && to.HasValue) flights.Add((from.Value, to.Value));
                    }
                } catch (Newtonsoft.Json.JsonException) {
                    flights.Clear();
                }
            }
            if (flights.Count == 0 && m.From.HasValue && m.To.HasValue) flights.Add((m.From.Value, m.To.Value));
            return flights;
        }

        static StationPoint? PointOf(Newtonsoft.Json.Linq.JToken token) {
            if (!(token is Newtonsoft.Json.Linq.JObject point)) return null;
            return new StationPoint((double)point["x"], (double)point["y"], (double)point["z"]);
        }

        public static int Flights(StationModuleRecord m) {
            var text = m.Config.Text("flights");
            if (string.IsNullOrEmpty(text) || text == "[]") return 0;
            int count = 0, at = 0;
            while ((at = text.IndexOf("\"from\"", at, StringComparison.Ordinal)) >= 0) { count++; at += 6; }
            return count;
        }

        /// <summary>
        /// The straight-run corridor (`rampEnvelope` with one segment). A turning stair or an
        /// endpoint-less run is refused with a stable code.
        /// </summary>
        public static bool TryEnvelope(StationModuleRecord m, out StationBox box, out string unsupported) {
            box = default;
            unsupported = "";
            if (m == null) { unsupported = "no module"; return false; }
            if (!IsRun(m)) { unsupported = "not a run"; return false; }
            if (!m.From.HasValue || !m.To.HasValue) { unsupported = m.Type + " has no saved endpoints"; return false; }
            // A multi-flight stair is the union of its flights' corridors (`rampEnvelope` folds
            // every segment): each leg is boxed on its own slid centreline, so a turning stair
            // reserves the blocks it really climbs through. The union of the boxes is coarser
            // than the reference's per-segment list, which over-reserves a switchback's empty
            // corner — a reservation, never a placement rule.
            if (m.Type == "stair" && Flights(m) > 1) return TryFlightUnion(m, out box, out unsupported);
            // An oblique run is still one straightened segment: `rampEnvelope` boxes the swept
            // line between its endpoints, widened by the run's own half-width on both axes.
            // The AABB over-reserves the corners of a 45° run — a reservation, never a
            // placement rule.
            bool diagonal = m.From.Value.X != m.To.Value.X && m.From.Value.Y != m.To.Value.Y;
            int width = (m.Type == "escalator" || m.Type == "walkway") ? Width(m) : 1;
            double half = width > 1 ? width / 2.0 : Math.Max(0.5, BodyHalf(m));
            double shiftX = 0, shiftY = 0;
            bool wide = (m.Type == "escalator" || m.Type == "walkway") && width > 1;
            if (wide) {
                // Port of `sim/escalators.ts:escalatorRun`: centre wide escalators/walkways across
                // their plan blocks from low->high order so 2- and 3-block pieces align with the grid.
                bool lowerFirst = m.From.Value.Z != m.To.Value.Z
                    ? m.From.Value.Z < m.To.Value.Z
                    : m.From.Value.X != m.To.Value.X
                        ? m.From.Value.X < m.To.Value.X
                        : m.From.Value.Y < m.To.Value.Y;
                var lower = lowerFirst ? m.From.Value : m.To.Value;
                var upper = lowerFirst ? m.To.Value : m.From.Value;
                double ux = upper.X - lower.X, uy = upper.Y - lower.Y;
                double len = Math.Sqrt(ux * ux + uy * uy);
                if (len > 0) {
                    double k = (width - 1) * 0.5 / len;
                    shiftX = uy * k;
                    shiftY = -ux * k;
                }
            }
            double ax = m.From.Value.X + 0.5 + shiftX, ay = m.From.Value.Y + 0.5 + shiftY;
            double bx = m.To.Value.X + 0.5 + shiftX, by = m.To.Value.Y + 0.5 + shiftY;
            double hx = diagonal ? half : (wide && m.From.Value.X != m.To.Value.X ? 0.5 : half);
            double hy = diagonal ? half : (wide && m.From.Value.Y != m.To.Value.Y ? 0.5 : half);
            double lo = Math.Min(m.From.Value.Z, m.To.Value.Z);
            double hi = Math.Max(m.From.Value.Z, m.To.Value.Z);
            box = new StationBox(
                Math.Min(ax, bx) - hx, Math.Min(ay, by) - hy, lo + 1 - Foot - Clear,
                Math.Max(ax, bx) + hx, Math.Max(ay, by) + hy, hi + 1 + Headroom + Clear);
            return true;
        }

        /// <summary>True when the run is the catalogue's straight single flight (the carved case).</summary>
        /// <summary>
        /// The union of one corridor box per flight, each on its own slid centreline, including an
        /// oblique leg (boxed by its half-width on both axes).
        /// </summary>
        static bool TryFlightUnion(StationModuleRecord m, out StationBox box, out string unsupported) {
            box = default;
            unsupported = "";
            var flights = FlightsOf(m);
            var slides = StationStairSlides.Slides(m);
            double half = Math.Max(0.5, BodyHalf(m));
            bool any = false;
            double x0 = 0, y0 = 0, x1 = 0, y1 = 0, lo = 0, hi = 0;
            for (int i = 0; i < flights.Count; i++) {
                var flight = flights[i];
                // An oblique leg is boxed on both axes by its half-width (see the single-run
                // note): the union stays a reservation, not a placement rule.
                var slide = i < slides.Count ? slides[i] : (Dx: 0.0, Dy: 0.0);
                double ax = flight.From.X + 0.5 + slide.Dx, ay = flight.From.Y + 0.5 + slide.Dy;
                double bx = flight.To.X + 0.5 + slide.Dx, by = flight.To.Y + 0.5 + slide.Dy;
                double flightLo = Math.Min(flight.From.Z, flight.To.Z);
                double flightHi = Math.Max(flight.From.Z, flight.To.Z);
                double fx0 = Math.Min(ax, bx) - half, fy0 = Math.Min(ay, by) - half;
                double fx1 = Math.Max(ax, bx) + half, fy1 = Math.Max(ay, by) + half;
                double fz0 = flightLo + 1 - Foot - Clear, fz1 = flightHi + 1 + Headroom + Clear;
                if (!any) {
                    x0 = fx0; y0 = fy0; x1 = fx1; y1 = fy1; lo = fz0; hi = fz1; any = true;
                } else {
                    x0 = Math.Min(x0, fx0); y0 = Math.Min(y0, fy0);
                    x1 = Math.Max(x1, fx1); y1 = Math.Max(y1, fy1);
                    lo = Math.Min(lo, fz0); hi = Math.Max(hi, fz1);
                }
            }
            if (!any) { unsupported = "stair has no flights"; return false; }
            box = new StationBox(x0, y0, lo, x1, y1, hi);
            return true;
        }

        public static bool IsStraightRun(StationModuleRecord m) => TryEnvelope(m, out _, out _);

        // ------------------------------------------------------------- ramp lengths, spans, flights & landings

        /// <summary>Port of <c>sim/rampLengths.ts</c> + <c>escalatorLengthSpec</c> (5 rungs × 3 spans).</summary>
        public static void RampSpecFor(string span, string lengthId, bool escalator, out int run, out int rise) {
            string normSpan = span == "triple" ? "triple" : span == "double" ? "double" : "single";
            string id = string.IsNullOrEmpty(lengthId) ? "long" : lengthId;
            if (normSpan == "single") {
                switch (id) {
                    case "ultra-short": rise = 2; run = 3; break;
                    case "short": rise = 3; run = 5; break;
                    case "medium": rise = 4; run = 6; break;
                    case "ultra-long": rise = 6; run = 9; break;
                    default: rise = 5; run = 8; break;
                }
            } else if (normSpan == "double") {
                switch (id) {
                    case "ultra-short": rise = 7; run = 11; break;
                    case "short": rise = 8; run = 12; break;
                    case "medium": rise = 9; run = 14; break;
                    case "ultra-long": rise = 11; run = 17; break;
                    default: rise = 10; run = 15; break;
                }
            } else {
                switch (id) {
                    case "ultra-short": rise = 12; break;
                    case "short": rise = 13; break;
                    case "medium": rise = 14; break;
                    case "ultra-long": rise = 16; break;
                    default: rise = 15; break;
                }
                run = (int)Math.Ceiling(rise * 1.5);
            }
            if (escalator) {
                run = (int)Math.Ceiling(rise / Math.Tan(Math.PI / 6.0));
            }
        }

        public static int StairLanes(double width) {
            if (width <= 0) return 1;
            if (StairOnBlockGrid(width)) return StairRunBlocks(width);
            int lanes = (int)Math.Round(width / Band, MidpointRounding.AwayFromZero);
            return Math.Max(1, Math.Min(3, lanes));
        }

        public static double StairSwitchbackRunWidth(double width) =>
            StairLanes(width) - 2.0 * StairRailProud;

        public static double StairBuildWidth(string style, double width) {
            double w = width > 0 ? width : Band;
            return string.IsNullOrEmpty(style) || style == "straight" ? w : StairSwitchbackRunWidth(w);
        }

        public static void StairRight(int rot, out int rx, out int ry) {
            StationExitSnapping.StairFacing(rot, out int fx, out int fy);
            rx = fy;
            ry = -fx;
        }

        static int StairStories(int rise) {
            if (rise > 11) return 3;
            if (rise > 6) return 2;
            return 1;
        }

        /// <summary>Port of <c>sim/stairs.ts:stairFlightsFor</c> for all 8 stair styles and 3 spans.</summary>
        public static List<(StationPoint From, StationPoint To)> StairFlightsFor(
            StationPoint basePt, int rot, string style, double width, string lengthId, string span) {
            RampSpecFor(span, lengthId, escalator: false, out int run, out int rise);
            int flightRun = Math.Max(1, (int)Math.Ceiling(run / 2.0));
            double flightRise = rise / 2.0;
            StationExitSnapping.StairFacing(rot, out int fx, out int fy);
            StairRight(rot, out int rx, out int ry);
            StationPoint At(double df, double dr, double dz) =>
                new StationPoint(basePt.X + fx * df + rx * dr, basePt.Y + fy * df + ry * dr, basePt.Z + dz);

            int switchbackSpan = StairLanes(width > 0 ? width : Band);
            int quarterStep = switchbackSpan - 1;
            var flights = new List<(StationPoint From, StationPoint To)>(4);

            switch (style ?? "straight") {
                case "right90":
                    flights.Add((basePt, At(flightRun, 0, flightRise)));
                    flights.Add((At(flightRun, quarterStep, flightRise), At(flightRun, quarterStep + flightRun, rise)));
                    break;
                case "left90":
                    flights.Add((basePt, At(flightRun, 0, flightRise)));
                    flights.Add((At(flightRun, -quarterStep, flightRise), At(flightRun, -quarterStep - flightRun, rise)));
                    break;
                case "right180":
                    flights.Add((basePt, At(flightRun, 0, flightRise)));
                    flights.Add((At(flightRun, switchbackSpan, flightRise), At(0, switchbackSpan, rise)));
                    break;
                case "left180":
                    flights.Add((basePt, At(flightRun, 0, flightRise)));
                    flights.Add((At(flightRun, -switchbackSpan, flightRise), At(0, -switchbackSpan, rise)));
                    break;
                case "leftForward":
                    flights.Add((basePt, At(flightRun, 0, flightRise)));
                    flights.Add((At(flightRun, -switchbackSpan, flightRise), At(flightRun * 2, -switchbackSpan, rise)));
                    break;
                case "rightForward":
                    flights.Add((basePt, At(flightRun, 0, flightRise)));
                    flights.Add((At(flightRun, switchbackSpan, flightRise), At(flightRun * 2, switchbackSpan, rise)));
                    break;
                case "centerForward": {
                    int stories = StairStories(rise);
                    int halfUnits = (int)Math.Round(rise * 2.0);
                    var levels = new int[stories + 2];
                    levels[0] = 0;
                    for (int k = 1; k <= stories; k++) {
                        levels[k] = (int)Math.Round(halfUnits * (2 * k - 1) / (2.0 * stories), MidpointRounding.AwayFromZero);
                    }
                    levels[stories + 1] = halfUnits;
                    int along = 0;
                    for (int i = 0; i < stories + 1; i++) {
                        double climb = (levels[i + 1] - levels[i]) / 2.0;
                        int cells = Math.Max(1, (int)Math.Ceiling(climb / rise * run));
                        flights.Add((
                            new StationPoint(basePt.X + fx * along, basePt.Y + fy * along, basePt.Z + levels[i] / 2.0),
                            new StationPoint(basePt.X + fx * (along + cells), basePt.Y + fy * (along + cells), basePt.Z + levels[i + 1] / 2.0)));
                        along += cells;
                    }
                    break;
                }
                default:
                    flights.Add((basePt, At(run, 0, rise)));
                    break;
            }
            return flights;
        }

        /// <summary>Port of <c>sim/escalators.ts:escalatorLandings</c>.</summary>
        public static List<StationCellKey> EscalatorLandings(StationModuleRecord m) {
            var outCells = new List<StationCellKey>();
            if (m == null || !m.From.HasValue || !m.To.HasValue) return outCells;
            var f = m.From.Value;
            var t = m.To.Value;
            outCells.Add(new StationCellKey((int)Math.Round(f.X), (int)Math.Round(f.Y), (int)Math.Round(f.Z)));
            outCells.Add(new StationCellKey((int)Math.Round(t.X), (int)Math.Round(t.Y), (int)Math.Round(t.Z)));
            int w = Width(m);
            if (w <= 1) return outCells;
            bool lowerFirst = f.Z != t.Z ? f.Z < t.Z : (f.X != t.X ? f.X < t.X : f.Y < t.Y);
            var low = lowerFirst ? f : t;
            var high = lowerFirst ? t : f;
            double ux = high.X - low.X, uy = high.Y - low.Y;
            double len = Math.Sqrt(ux * ux + uy * uy);
            if (len < 1e-6) return outCells;
            double dx = uy / len;
            double dy = -ux / len;
            for (int lane = 1; lane < w; lane++) {
                outCells.Add(new StationCellKey((int)Math.Round(f.X + dx * lane), (int)Math.Round(f.Y + dy * lane), (int)Math.Round(f.Z)));
                outCells.Add(new StationCellKey((int)Math.Round(t.X + dx * lane), (int)Math.Round(t.Y + dy * lane), (int)Math.Round(t.Z)));
            }
            return outCells;
        }

        /// <summary>Port of <c>sim/stairs.ts:stairLandings</c>.</summary>
        public static List<StationCellKey> StairLandings(StationModuleRecord m) {
            var outCells = new List<StationCellKey>();
            if (m == null) return outCells;
            var seen = new HashSet<StationCellKey>();
            var flights = FlightsOf(m);
            for (int i = 0; i < flights.Count; i++) {
                var a = flights[i].From;
                var b = flights[i].To;
                if (Math.Abs(a.Z - Math.Round(a.Z)) < 1e-6) {
                    var ka = new StationCellKey((int)Math.Round(a.X), (int)Math.Round(a.Y), (int)Math.Round(a.Z));
                    if (seen.Add(ka)) outCells.Add(ka);
                }
                if (Math.Abs(b.Z - Math.Round(b.Z)) < 1e-6) {
                    var kb = new StationCellKey((int)Math.Round(b.X), (int)Math.Round(b.Y), (int)Math.Round(b.Z));
                    if (seen.Add(kb)) outCells.Add(kb);
                }
            }
            return outCells;
        }
    }
}
