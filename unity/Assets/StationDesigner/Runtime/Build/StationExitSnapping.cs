using System;
using System.Collections.Generic;
using System.Globalization;

namespace Metro.Build {
    /// <summary>
    /// The head-house placement a snapped exit takes (`snapExitToRamp` in
    /// `game/src/sim/exits.ts`): the anchor cell and the quarter turn its mouth faces.
    /// </summary>
    public readonly struct StationExitSnap {
        public readonly double X, Y, Z;
        public readonly int Rotation;
        public StationExitSnap(double x, double y, double z, int rotation) {
            X = x; Y = y; Z = z; Rotation = rotation;
        }
        public StationPoint Cell => new StationPoint(X, Y, Z);
        public override string ToString() =>
            "exit snap at " + X.ToString("0.###", CultureInfo.InvariantCulture) + "," +
            Y.ToString("0.###", CultureInfo.InvariantCulture) + "," +
            Z.ToString("0.###", CultureInfo.InvariantCulture) + " rot " + Rotation;
    }

    /// <summary>
    /// The run a ramp placed into an exit bay becomes (`exitRunSnap` in
    /// `game/src/sim/exits.ts`): its upper landing in the bay, its base the chosen
    /// rise below and toward the mouth, and the placement turn that climbs base → top.
    /// </summary>
    public readonly struct StationExitBaySnap {
        public readonly string ExitId;
        /// <summary>Local x of the column the run lands in — the bay it occupies (whole for a
        /// whole-cell pointer, as the tool always passes).</summary>
        public readonly double Bay;
        public readonly StationPoint Top;
        public readonly StationPoint Base;
        public readonly int Rotation;
        public StationExitBaySnap(string exitId, double bay, StationPoint top, StationPoint bottom, int rotation) {
            ExitId = exitId ?? "";
            Bay = bay;
            Top = top;
            Base = bottom;
            Rotation = rotation;
        }
        public override string ToString() =>
            "run snap in " + ExitId + " bay " + Bay.ToString("0.###", CultureInfo.InvariantCulture) +
            " top " + Top + " base " + Base + " rot " + Rotation;
    }

    /// <summary>
    /// The two edit-time exit snaps of `sim/exits.ts`, ported into `Metro.Build` so the
    /// one placement resolver (`StationModulePlacement.Resolve`) can normalize a fresh
    /// exit against a picked ramp — and a fresh ramp against the exit bay under the
    /// pointer — before preview or commit sees the candidate.
    ///
    /// **Ported verbatim:** <c>snapExitToRamp</c>, <c>exitRunSnap</c>, their helpers
    /// (<c>isExitHeadHouse</c>, <c>isSnapRamp</c>, <c>exitBays</c>, <c>exitBayCell</c>,
    /// <c>exitLocal</c>/<c>exitRotate</c>, <c>stairRotFor</c>, <c>runTop</c>) and the
    /// single-flight branch of <c>stairFlightSlides</c> the two functions can reach: a
    /// snap-eligible stair is straight by construction. A lift is deliberately not
    /// snapped — the source's <c>snapExitToRamp</c> accepts only a stair or escalator,
    /// and no source rule links a lift shaft to a head-house (plan 16 §5.2). Turning
    /// stairs are refused for the same reason the source refuses them: their run does
    /// not end at the bay, so snapping would not line up the opening.
    ///
    /// The document record is the input; the result is a pure value. Nothing here reads
    /// an engine type, the view layer, or the current edit session. The `reason` codes
    /// are stable and only describe why a source `null` came back.
    /// </summary>
    public static class StationExitSnapping {
        /// <summary>`STAIR_RUN` / `STAIR_RISE`: the 长 5 m rung on the five-metre grid (8 cells).</summary>
        public const double StairRun = 8;
        public const double StairRise = 5;
        /// <summary>`ESCALATOR_RUN` / `ESCALATOR_RISE`: the 30° run of the same 5 m climb (9 cells).</summary>
        public const double EscalatorRun = 9;
        public const double EscalatorRise = 5;
        /// <summary>`STAIR_WIDTH_NARROW` / `ESCALATOR_BAND`, metres.</summary>
        public const double NarrowWidth = .68;
        /// <summary>`STAIR_RAIL_PROUD`, metres.</summary>
        public const double StairRailProud = .105;
        /// <summary>`ESCALATOR_CASING_PROUD`, metres.</summary>
        public const double EscalatorCasingProud = .08;

        static readonly double[] StairWidths = { NarrowWidth, 2 * NarrowWidth, 3 * NarrowWidth };

        /// <summary>True when the exit is a street head-house (`isExitHeadHouse`).</summary>
        public static bool IsHeadHouse(StationModuleRecord exit) {
            if (exit == null || !string.Equals(exit.Type, "exit", StringComparison.Ordinal)) return false;
            var style = exit.Config.Text("style");
            return !string.Equals(style, "doorway", StringComparison.Ordinal) &&
                   !string.Equals(style, "virtual", StringComparison.Ordinal);
        }

        /// <summary>
        /// Port of `isSnapRamp`: a straight, non-block stair or any escalator — the two
        /// families the tool lets an exit snap onto.
        /// </summary>
        public static bool IsSnapRamp(StationModuleRecord ramp) {
            if (ramp == null) return false;
            if (string.Equals(ramp.Type, "escalator", StringComparison.Ordinal)) return true;
            if (!string.Equals(ramp.Type, "stair", StringComparison.Ordinal)) return false;
            if (ramp.Config.Bool("block")) return false;
            var style = ramp.Config.Text("style");
            return style.Length == 0 || string.Equals(style, "straight", StringComparison.Ordinal);
        }

        /// <summary>
        /// Port of `runTop` for the two snap families: the upper landing of the run, moved
        /// onto the lane its tread band is centred on. The source reads a lift too; no
        /// snap calls it with one, so a lift is reported unsupported rather than guessed.
        /// </summary>
        public static bool TryRunTop(StationModuleRecord run, out StationPoint top) {
            top = default;
            if (run == null || !run.From.HasValue || !run.To.HasValue) return false;
            var a = new StationPoint(run.From.Value.X, run.From.Value.Y, run.From.Value.Z);
            var b = new StationPoint(run.To.Value.X, run.To.Value.Y, run.To.Value.Z);
            if (string.Equals(run.Type, "escalator", StringComparison.Ordinal)) {
                EscalatorCentreRun(run, a, b, out var from, out var to);
                top = from.Z >= to.Z ? from : to;
                return true;
            }
            if (string.Equals(run.Type, "stair", StringComparison.Ordinal)) {
                bool fromIsTop = a.Z >= b.Z;
                var upper = fromIsTop ? a : b;
                // The single-flight branch of `stairFlightSlides`: a straight stair's tread
                // band is centred on its block grid, so its landing cell is one half (or one)
                // block across from the saved endpoint.
                double slideX = 0, slideY = 0;
                var flights = StairFlights(run, a, b);
                if (flights.Count == 1) StairSlide(run, flights[0].Key, flights[0].Value, out slideX, out slideY);
                top = new StationPoint(upper.X + slideX, upper.Y + slideY, upper.Z);
                return true;
            }
            return false;
        }

        /// <summary>
        /// Port of `snapExitToRamp`: move a head-house so one of its bays lands on the ramp's
        /// upper endpoint, its mouth facing back down the run. False for every case the
        /// source returns `null` (not a head-house, not a stair/escalator, a block or turning
        /// stair, a level run, missing endpoints).
        /// </summary>
        public static bool TrySnapExitToRamp(StationModuleRecord exit, StationModuleRecord ramp,
            out StationExitSnap snap, out string reason) {
            snap = default;
            reason = "";
            if (exit == null || ramp == null) { reason = "bad-request"; return false; }
            if (!IsHeadHouse(exit)) { reason = "not-head-house"; return false; }
            bool stair = string.Equals(ramp.Type, "stair", StringComparison.Ordinal);
            if (!stair && !string.Equals(ramp.Type, "escalator", StringComparison.Ordinal)) { reason = "not-ramp"; return false; }
            if (stair) {
                if (ramp.Config.Bool("block")) { reason = "blocking-stair"; return false; }
                var style = ramp.Config.Text("style");
                if (style.Length > 0 && !string.Equals(style, "straight", StringComparison.Ordinal)) {
                    reason = "turning-stair";
                    return false;
                }
            }
            if (!ramp.From.HasValue || !ramp.To.HasValue) { reason = "no-endpoints"; return false; }
            var from = new StationPoint(ramp.From.Value.X, ramp.From.Value.Y, ramp.From.Value.Z);
            var to = new StationPoint(ramp.To.Value.X, ramp.To.Value.Y, ramp.To.Value.Z);
            bool fromIsUpper = from.Z >= to.Z;
            var upper = fromIsUpper ? from : to;
            var lower = fromIsUpper ? to : from;
            if (upper.Z == lower.Z) { reason = "level-run"; return false; }
            if (!TryRunTop(ramp, out var top)) { reason = "not-ramp"; return false; }

            // Ramp catalogue turns are clockwise; exit model turns are counterclockwise.
            int rot = (4 - StairRotFor(Sign(upper.X - lower.X), Sign(upper.Y - lower.Y))) % 4;
            // The saved endpoint is the first lane. Centre all occupied lanes in the bay
            // group, including the lateral slide used by the actual stair/escalator model.
            double width = 1 + 2 * Math.Sqrt(Sq(top.X - upper.X) + Sq(top.Y - upper.Y));
            double bay = Math.Max(0, Math.Floor((StationFootprints.ExitBays(exit) - width) / 2));
            ExitBayCell(exit.X, exit.Y, rot, bay, out var bayX, out var bayY);
            snap = new StationExitSnap(exit.X + upper.X - bayX, exit.Y + upper.Y - bayY, upper.Z, rot);
            return true;
        }

        /// <summary>
        /// Port of `exitRunSnap`: the head-house the pointer cell is inside (if any) and the
        /// bay column a run of `run` cells descending `rise` metres would take. False when no
        /// head-house covers the cell.
        /// </summary>
        public static bool TrySnapRunToExitBay(IReadOnlyList<StationModuleRecord> modules, int x, int y, int z,
            double run, double rise, out StationExitBaySnap snap, out string reason) {
            snap = default;
            reason = "";
            if (modules == null) { reason = "no-document"; return false; }
            if (run <= 0 || rise <= 0) { reason = "bad-run"; return false; }
            StationModuleRecord exit = null;
            for (int i = 0; i < modules.Count; i++) {
                var candidate = modules[i];
                if (!IsHeadHouse(candidate)) continue;
                if (!CoversCell(candidate, x, y, z)) continue;
                exit = candidate;
                break;
            }
            if (exit == null) { reason = "no-exit-bay"; return false; }
            int bays = StationFootprints.ExitBays(exit);
            ExitLocal(x - exit.X, y - exit.Y, exit.Rotation, out var lx, out _);
            double bay = Math.Max(0, Math.Min(bays - 1, lx));
            ExitBayCell(exit.X, exit.Y, exit.Rotation, bay, out var topX, out var topY);
            ExitRotate(0, 1, exit.Rotation, out var fx, out var fy);
            var top = new StationPoint(topX, topY, z);
            var bottom = new StationPoint(topX - fx * run, topY - fy * run, z - rise);
            snap = new StationExitBaySnap(exit.Id, bay, top, bottom, StairRotFor((int)fx, (int)fy));
            return true;
        }

        // ------------------------------------------------------------- run geometry

        /// <summary>`exitCoversCell`: the cell lies under the head-house's floor plate.</summary>
        public static bool CoversCell(StationModuleRecord exit, int x, int y, int z) {
            if (exit == null || exit.Z != z || !IsHeadHouse(exit)) return false;
            var box = StationFootprints.ExitFloorBounds(exit);
            return x + 1 > box.X0 && x < box.X1 && y + 1 > box.Y0 && y < box.Y1;
        }

        /// <summary>`exitBayCell`: the world cell a run column lands on at the exit's own row.</summary>
        public static void ExitBayCell(int exitX, int exitY, int rotation, double column, out double x, out double y) {
            ExitRotate(column, 0, rotation, out var dx, out var dy);
            x = exitX + dx;
            y = exitY + dy;
        }

        /// <summary>`exitRotate`: a point in the exit's local plan → world plan offsets.</summary>
        public static void ExitRotate(double lx, double ly, int rotation, out double x, out double y) {
            switch (NormRot(rotation)) {
                case 1: x = -ly; y = lx; break;
                case 2: x = -lx; y = -ly; break;
                case 3: x = ly; y = -lx; break;
                default: x = lx; y = ly; break;
            }
        }

        /// <summary>`exitLocal`: the inverse of <see cref="ExitRotate"/>.</summary>
        public static void ExitLocal(double wx, double wy, int rotation, out double lx, out double ly) {
            switch (NormRot(rotation)) {
                case 1: lx = wy; ly = -wx; break;
                case 2: lx = -wx; ly = -wy; break;
                case 3: lx = -wy; ly = wx; break;
                default: lx = wx; ly = wy; break;
            }
        }

        /// <summary>`stairRotFor`: the placement turn whose run faces the unit step.</summary>
        public static int StairRotFor(int dx, int dy) {
            for (int r = 0; r < 4; r++) {
                StairFacing(r, out var fx, out var fy);
                if (fx == dx && fy == dy) return r;
            }
            return 0;
        }

        /// <summary>`stairFacing`: the unit cell step a run at `rotation` climbs along.</summary>
        public static void StairFacing(int rotation, out int dx, out int dy) {
            switch (NormRot(rotation)) {
                case 1: dx = 1; dy = 0; break;
                case 2: dx = 0; dy = -1; break;
                case 3: dx = -1; dy = 0; break;
                default: dx = 0; dy = 1; break;
            }
        }

        /// <summary>`stairTreadWidth` for an implied single flight.</summary>
        public static double StairTreadWidth(StationModuleRecord stair) {
            double width = stair.Config.Number("width", NarrowWidth);
            int size = -1;
            for (int i = 0; i < StairWidths.Length; i++) if (Math.Abs(StairWidths[i] - width) < 1e-6) { size = i; break; }
            var from = new StationPoint(stair.From.Value.X, stair.From.Value.Y, stair.From.Value.Z);
            var to = new StationPoint(stair.To.Value.X, stair.To.Value.Y, stair.To.Value.Z);
            return !stair.Config.Bool("block") && StairFlights(stair, from, to).Count == 1 && size >= 0
                ? size + 1 - 2 * StairRailProud
                : width;
        }

        static void StairSlide(StationModuleRecord stair, StationPoint from, StationPoint to, out double slideX, out double slideY) {
            slideX = 0; slideY = 0;
            double width = StairTreadWidth(stair);
            double grid = StairOnBlockGrid(width) ? (StairRunBlocks(width) - 1) * .5 : 0;
            if (grid == 0) return;
            double dx = to.X - from.X;
            double dy = to.Y - from.Y;
            double run = Math.Sqrt(Sq(dx) + Sq(dy));
            if (run < 1e-6) return;
            slideX = Z(dy / run * grid);
            slideY = Z(-dx / run * grid);
        }

        static int StairRunBlocks(double width) =>
            Math.Max(1, Math.Min(3, (int)Math.Round(width + 2 * StairRailProud)));

        static bool StairOnBlockGrid(double width) =>
            Math.Abs(width + 2 * StairRailProud - StairRunBlocks(width)) < 1e-6;

        /// <summary>`stairFlights`: `cfg.flights` when authored, else the single implied run.</summary>
        static List<KeyValuePair<StationPoint, StationPoint>> StairFlights(StationModuleRecord stair, StationPoint from, StationPoint to) {
            var flights = ParseFlights(stair.Config.Json("flights"));
            if (flights.Count > 0) return flights;
            flights.Add(new KeyValuePair<StationPoint, StationPoint>(from, to));
            return flights;
        }

        /// <summary>
        /// The authored `cfg.flights` list, read as the save writes it
        /// (`[{from:{x,y,z},to:{x,y,z}},…]`) without Newtonsoft, exactly as the view
        /// layer's `StationRunGeometry.ParseFlights` does. A list that does not hold whole
        /// triples is ignored, which is how a save that authored nothing reads.
        /// </summary>
        static List<KeyValuePair<StationPoint, StationPoint>> ParseFlights(string json) {
            var flights = new List<KeyValuePair<StationPoint, StationPoint>>(2);
            if (string.IsNullOrEmpty(json)) return flights;
            var values = new List<double>(12);
            for (int i = 0; i + 3 < json.Length; i++) {
                if (json[i] != '"') continue;
                char axis = json[i + 1];
                if (axis != 'x' && axis != 'y' && axis != 'z') continue;
                if (json[i + 2] != '"') continue;
                int at = i + 3;
                while (at < json.Length && (json[at] == ' ' || json[at] == '\t')) at++;
                if (at >= json.Length || json[at] != ':') continue;
                at++;
                while (at < json.Length && (json[at] == ' ' || json[at] == '\t')) at++;
                int start = at;
                if (at < json.Length && (json[at] == '-' || json[at] == '+')) at++;
                while (at < json.Length && (char.IsDigit(json[at]) || json[at] == '.' || json[at] == 'e' || json[at] == 'E' ||
                       ((json[at] == '-' || json[at] == '+') && (json[at - 1] == 'e' || json[at - 1] == 'E')))) at++;
                if (at > start && double.TryParse(json.Substring(start, at - start), NumberStyles.Float,
                        CultureInfo.InvariantCulture, out var value)) values.Add(value);
                i = at - 1;
            }
            int count = values.Count / 6;
            if (count == 0 || values.Count % 6 != 0) return flights;
            for (int i = 0; i < count; i++) {
                int at = i * 6;
                flights.Add(new KeyValuePair<StationPoint, StationPoint>(
                    new StationPoint(values[at], values[at + 1], values[at + 2]),
                    new StationPoint(values[at + 3], values[at + 4], values[at + 5])));
            }
            return flights;
        }

        /// <summary>`escalatorRun`: the lane-1 endpoints shifted onto the run's centre.</summary>
        static void EscalatorCentreRun(StationModuleRecord run, StationPoint a, StationPoint b,
            out StationPoint from, out StationPoint to) {
            bool lowerFirst = a.Z != b.Z ? a.Z < b.Z : a.X != b.X ? a.X < b.X : a.Y < b.Y;
            var lower = lowerFirst ? a : b;
            var upper = lowerFirst ? b : a;
            double len = Math.Sqrt(Sq(upper.X - lower.X) + Sq(upper.Y - lower.Y));
            int width = StationFootprints.EscalatorWidth(run);
            double half = len > 0 ? (width - 1) * .5 / len : 0;
            double dx = (upper.Y - lower.Y) * half;
            double dy = -(upper.X - lower.X) * half;
            from = new StationPoint(a.X + dx, a.Y + dy, a.Z);
            to = new StationPoint(b.X + dx, b.Y + dy, b.Z);
        }

        static int Sign(double value) => value > 0 ? 1 : value < 0 ? -1 : 0;

        static int NormRot(int rot) => ((rot % 4) + 4) % 4;

        static double Sq(double value) => value * value;

        static double Z(double value) => value == 0 ? 0 : value;
    }
}
