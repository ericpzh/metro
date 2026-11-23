using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Metro.Build {
    /// <summary>Where a module is carried: floor, wall, ceiling, track bed or a run.</summary>
    public enum StationMount { Floor, Wall, Ceiling, Track, Run }

    /// <summary>
    /// An axis-aligned world-space box in **document axes**, half-open:
    /// <c>[X0,X1) × [Y0,Y1) × [Z0,Z1)</c>. Elevation <c>Z</c> is the save's
    /// elevation; the view converts the box once at its boundary.
    /// </summary>
    public readonly struct StationBox {
        public StationBox(double x0, double y0, double z0, double x1, double y1, double z1) {
            X0 = x0; Y0 = y0; Z0 = z0; X1 = x1; Y1 = y1; Z1 = z1;
        }
        public double X0 { get; }
        public double Y0 { get; }
        public double Z0 { get; }
        public double X1 { get; }
        public double Y1 { get; }
        public double Z1 { get; }
        public double Width => X1 - X0;
        public double Depth => Y1 - Y0;
        public double Height => Z1 - Z0;
        public bool IsEmpty => X1 <= X0 || Y1 <= Y0 || Z1 <= Z0;
        public static StationBox FromCells(IEnumerable<StationPoint> cells, double z0, double z1) {
            double x0 = double.PositiveInfinity, y0 = double.PositiveInfinity;
            double x1 = double.NegativeInfinity, y1 = double.NegativeInfinity;
            foreach (var cell in cells) {
                if (cell.X < x0) x0 = cell.X;
                if (cell.Y < y0) y0 = cell.Y;
                if (cell.X + 1 > x1) x1 = cell.X + 1;
                if (cell.Y + 1 > y1) y1 = cell.Y + 1;
            }
            return double.IsInfinity(x0) ? new StationBox(0, 0, z0, 0, 0, z1) : new StationBox(x0, y0, z0, x1, y1, z1);
        }
        public bool Overlaps(StationBox other) =>
            X0 < other.X1 && X1 > other.X0 && Y0 < other.Y1 && Y1 > other.Y0 && Z0 < other.Z1 && Z1 > other.Z0;
        public bool Contains(double x, double y, double z) =>
            x >= X0 && x < X1 && y >= Y0 && y < Y1 && z >= Z0 && z < Z1;
        public override string ToString() =>
            "[" + X0 + "," + X1 + ") × [" + Y0 + "," + Y1 + ") × [" + Z0 + "," + Z1 + ")";
    }

    /// <summary>
    /// The plan footprint, mount and clearance of a saved module, ported from
    /// <c>sim/placement.ts</c> (<c>moduleFootprint</c>, <c>flatEnvelope</c>,
    /// <c>isWallMounted</c>, <c>isCeilingHung</c>, <c>wallSide</c>,
    /// <c>wallCourses</c>), <c>sim/exits.ts</c> and the run helpers in
    /// <c>sim/{track,lifts,escalators,walkways}.ts</c>.
    ///
    /// Document facts only: no <c>ZooLayout</c>, no bounds from an instantiated
    /// object, no engine types. A family this packet has not ported says so through
    /// <see cref="TryClearance"/>'s <c>unsupported</c> reason instead of returning a
    /// stand-in box.
    /// </summary>
    public static class StationFootprints {
        public const double StoreyHeight = 5;
        public const double GroundZ = 0;
        public const double OutdoorSurfaceHeight = 0.1;
        public const double PsdFullHeight = 3;
        public const double PsdHalfHeight = 1.45;
        public const double DeskHeight = 1.22;
        public const double CheckoutHeight = 1.42;
        public const double RailSignalHeight = 1;
        public const double RailSignalScale = RailSignalHeight / 2.59;
        public static readonly double[] InternalLevels = { -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6 };

        // ------------------------------------------------------------ rotation

        /// <summary>A saved quarter turn normalized to 0–3.</summary>
        public static int NormRot(int rot) => ((rot % 4) + 4) % 4;

        static readonly (int X, int Y)[] LightPositions = {
            (0, 0), (-1, 1), (0, 1), (1, 1), (-1, 0), (1, 0), (-1, -1), (0, -1), (1, -1),
        };

        /// <summary>The rectangular light's world-aligned plan and in-cell offset.</summary>
        public static (double Width, double Depth, double OffsetX, double OffsetY) LightPlan(int rotation, ModuleConfig config) {
            if (config.Text("variant") != "rectangular") return (0.5, 0.5, 0, 0);
            bool turned = NormRot(rotation) % 2 == 1;
            double width = turned ? 0.12 : 0.8;
            double depth = turned ? 0.8 : 0.12;
            int position = config.Int("position");
            var spot = LightPositions[((position % 9) + 9) % 9];
            return (width, depth, spot.X * (1 - width) / 2, spot.Y * (1 - depth) / 2);
        }

        /// <summary>
        /// Local run offset <c>(i along +x, j across +y)</c> → document offset, turning
        /// counter-clockwise (port of <c>track.rotateLocal</c>).
        /// </summary>
        public static void RotateLocal(int rot, double i, double j, out double x, out double y) {
            switch (NormRot(rot)) {
                case 1: x = -j; y = i; break;
                case 2: x = -i; y = -j; break;
                case 3: x = j; y = -i; break;
                default: x = i; y = j; break;
            }
        }

        /// <summary>
        /// The cell step from a wall-mounted module to the wall it hangs on: local
        /// (0,−1) rotated by <c>rot</c>, with −0 normalized to 0.
        /// </summary>
        public static void WallSide(int rot, out int dx, out int dy) {
            RotateLocal(rot, 0, -1, out var x, out var y);
            dx = x == 0 ? 0 : (int)Math.Round(x);
            dy = y == 0 ? 0 : (int)Math.Round(y);
        }

        static StationPoint[] Run(StationModuleRecord m) {
            var outCells = new List<StationPoint>();
            int w = m.Width > 0 ? m.Width : 1;
            for (int i = 0; i < w; i++) {
                RotateLocal(m.Rotation, i, 0, out var dx, out var dy);
                outCells.Add(new StationPoint(m.X + (int)Math.Round(dx), m.Y + (int)Math.Round(dy), m.Z));
            }
            return outCells.ToArray();
        }

        static StationPoint[] Grid(StationModuleRecord m) {
            var outCells = new List<StationPoint>(m.Width * m.Depth);
            for (int i = 0; i < m.Width; i++) {
                for (int j = 0; j < m.Depth; j++) {
                    RotateLocal(m.Rotation, i, j, out var dx, out var dy);
                    outCells.Add(new StationPoint(m.X + (int)Math.Round(dx), m.Y + (int)Math.Round(dy), m.Z));
                }
            }
            return outCells.ToArray();
        }

        // ----------------------------------------------------------- footprints

        /// <summary>
        /// The **public footprint**: the floor cells a module stands on, ported from
        /// <c>moduleFootprint</c>. A room covers its whole <c>w × h</c>; a lift its 2×2
        /// or 3×3 cells; a rail its bed; a 站台门 its screened strip; a run its two
        /// landings; a hung piece is anchored by its single cell.
        /// </summary>
        public static StationPoint[] Footprint(StationModuleRecord m) {
            if (!TryFootprint(m, out var cells, out var unsupported))
                throw new NotSupportedException(unsupported);
            return cells;
        }

        /// <summary>The footprint, or false with a reason for a family this packet has not ported.</summary>
        public static bool TryFootprint(StationModuleRecord m, out StationPoint[] cells, out string unsupported) {
            unsupported = "";
            cells = Array.Empty<StationPoint>();
            if (m == null) { unsupported = "no module"; return false; }
            switch (m.Type) {
                case "road": {
                    var outCells = new List<StationPoint>(m.Width * m.Depth);
                    for (int i = 0; i < m.Width * m.Depth; i++)
                        outCells.Add(new StationPoint(m.X + i % m.Width, m.Y + i / m.Width, m.Z));
                    cells = outCells.ToArray();
                    return true;
                }
                case "extinguisher": cells = ExtinguisherRun(m); return true;
                case "hanger": cells = Run(m); return true;
                case "court":
                case "ac-unit":
                case "electrical-cabinet":
                case "tactile":
                case "floor-mark": cells = FloorDecorCells(m); return true;
                case "retail":
                case "shop":
                case "booth": {
                    var outCells = new List<StationPoint>(m.Width * m.Height);
                    for (int x = m.X; x < m.X + m.Width; x++)
                        for (int y = m.Y; y < m.Y + m.Height; y++)
                            outCells.Add(new StationPoint(x, y, m.Z));
                    cells = outCells.ToArray();
                    return true;
                }
                case "platform-edge": cells = Run(m); return true;
                case "billboard": cells = Run(m); return true;
                case "glass": cells = Run(m); return true;
                case "door": cells = Run(m); return true;
                case "calligraphy": cells = Run(m); return true;
                case "monitor": cells = MonitorCells(m); return true;
                case "linemap": cells = Run(m); return true;
                case "shelf": cells = ShelfCells(m); return true;
                case "checkout": cells = CheckoutCells(m); return true;
                case "bench": cells = Run(m); return true;
                case "busstop":
                case "roof":
                case "track": cells = TrackCells(m); return true;
                case "lift": cells = LiftFootprint(m); return true;
                case "stair": {
                    if (m.Config.Bool("block")) { cells = new[] { m.Point }; return true; }
                    if (!m.From.HasValue || !m.To.HasValue) {
                        unsupported = "stair has no saved endpoints";
                        return false;
                    }
                    cells = new[] { m.From.Value, m.To.Value };
                    return true;
                }
                case "escalator":
                case "walkway": cells = EscalatorLandings(m); return true;
                default:
                    cells = new[] { m.Point };
                    return true;
            }
        }

        /// <summary>Every floor cell an exit head-house covers on its own level (port of <c>exitFootprintCells</c>).</summary>
        public static StationPoint[] ExitFootprint(StationModuleRecord m) {
            var b = ExitFloorBounds(m);
            var outCells = new List<StationPoint>();
            for (int x = (int)Math.Floor(b.X0); x < b.X1; x++)
                for (int y = (int)Math.Floor(b.Y0); y < b.Y1; y++)
                    outCells.Add(new StationPoint(x, y, m.Z));
            return outCells.ToArray();
        }

        /// <summary>The plan bounds an exit head-house lays floor over (world, half-open), ported from <c>exitFloorBounds</c>.</summary>
        public static StationBox ExitFloorBounds(StationModuleRecord m) {
            if (m.Config.Text("style") == "virtual") return new StationBox(m.X, m.Y, m.Z, m.X + 1, m.Y + 1, m.Z + 1);
            double cx = m.X + 0.5, cy = m.Y + 0.5;
            var span = ExitSpan(m);
            bool doorway = m.Config.Text("style") == "doorway";
            double lo = span.Centre - span.Half, hi = span.Centre + span.Half;
            double backY = doorway ? -0.5 : -5.5;
            double frontY = doorway ? 0.5 : 2.3;
            double x0 = double.PositiveInfinity, y0 = double.PositiveInfinity;
            double x1 = double.NegativeInfinity, y1 = double.NegativeInfinity;
            var corners = new[] { new[] { lo, backY }, new[] { hi, backY }, new[] { lo, frontY }, new[] { hi, frontY } };
            foreach (var corner in corners) {
                ExitRotate(corner[0], corner[1], m.Rotation, out var wx, out var wy);
                x0 = Math.Min(x0, cx + wx); x1 = Math.Max(x1, cx + wx);
                y0 = Math.Min(y0, cy + wy); y1 = Math.Max(y1, cy + wy);
            }
            return new StationBox(x0, y0, m.Z, x1, y1, m.Z + 1);
        }

        /// <summary>The exit's street-opening cell — the graph node the crowd crosses (port of <c>exitDoorCell</c>).</summary>
        public static StationPoint ExitDoorCell(StationModuleRecord m) {
            var span = ExitSpan(m);
            var style = m.Config.Text("style");
            int doorY = style == "doorway" || style == "virtual" ? 0 : 2;
            ExitRotate(Math.Round(span.Centre), doorY, m.Rotation, out var dx, out var dy);
            return new StationPoint(m.X + (int)Math.Round(dx), m.Y + (int)Math.Round(dy), m.Z);
        }

        /// <summary>The bay span of an exit: centre and half-width, in metres (port of <c>exitSpan</c>).</summary>
        public readonly struct ExitSpanValue {
            public ExitSpanValue(double centre, double half) { Centre = centre; Half = half; }
            public double Centre { get; }
            public double Half { get; }
        }

        public static ExitSpanValue ExitSpan(StationModuleRecord m) {
            int bays = ExitBays(m);
            return new ExitSpanValue((bays - 1) / 2.0, (bays + 2) / 2.0);
        }

        /// <summary>Port of <c>exitBays</c>: 1–4 are valid, anything else reads two.</summary>
        public static int ExitBays(StationModuleRecord m) {
            var bays = (int)Math.Round(m.Config.Number("bays", 2));
            return bays == 1 || bays == 3 || bays == 4 ? bays : 2;
        }

        static void ExitRotate(double lx, double ly, int rot, out double x, out double y) {
            switch (NormRot(rot)) {
                case 1: x = -ly; y = lx; break;
                case 2: x = -lx; y = -ly; break;
                case 3: x = ly; y = -lx; break;
                default: x = lx; y = ly; break;
            }
        }

        // ------------------------------------------------------------- run cells

        /// <summary>The bed cells of a track/roof/busstop run (port of <c>trackCells</c>).</summary>
        public static StationPoint[] TrackCells(StationModuleRecord m) {
            var outCells = new List<StationPoint>(m.Width * m.Depth);
            for (int i = 0; i < m.Width; i++) {
                for (int j = 0; j < m.Depth; j++) {
                    RotateLocal(m.Rotation, i, j, out var dx, out var dy);
                    outCells.Add(new StationPoint(m.X + (int)Math.Round(dx), m.Y + (int)Math.Round(dy), m.Z));
                }
            }
            return outCells.ToArray();
        }

        /// <summary>The 2×2 or 3×3 plan of a lift shaft (port of <c>liftFootprintCells</c>).</summary>
        public static StationPoint[] LiftFootprint(StationModuleRecord m) {
            int size = LiftSize(m);
            var outCells = new List<StationPoint>(size * size);
            for (int x = 0; x < size; x++) for (int y = 0; y < size; y++)
                outCells.Add(new StationPoint(m.X + x, m.Y + y, m.Z));
            return outCells.ToArray();
        }

        /// <summary>Port of <c>liftSizeOf</c>: 3 for the large shaft, 2 otherwise.</summary>
        public static int LiftSize(StationModuleRecord m) {
            var size = (int)Math.Round(m.Config.Number("size", 2));
            return size == 3 ? 3 : 2;
        }

        /// <summary>Port of <c>escalatorWidthOf</c>.</summary>
        public static int EscalatorWidth(StationModuleRecord m) {
            var width = (int)Math.Round(m.Config.Number("width", 1));
            return width == 3 ? 3 : width == 2 ? 2 : 1;
        }

        /// <summary>
        /// The landing cells of an escalator/walkway run (port of
        /// <c>escalatorLandings</c>): one pair for a narrow run, one pair per extra
        /// lane shifted by the run's own centring offset.
        /// </summary>
        public static StationPoint[] EscalatorLandings(StationModuleRecord m) {
            if (!m.From.HasValue || !m.To.HasValue) return new[] { m.Point };
            var from = m.From.Value;
            var to = m.To.Value;
            int width = EscalatorWidth(m);
            if (width == 1) return new[] { from, to };
            var run = EscalatorRun(m);
            double dx = 2.0 * (run.From.X - from.X) / (width - 1);
            double dy = 2.0 * (run.From.Y - from.Y) / (width - 1);
            var outCells = new List<StationPoint>(width * 2) { from, to };
            for (int lane = 1; lane < width; lane++) {
                outCells.Add(new StationPoint(from.X + dx * lane, from.Y + dy * lane, from.Z));
                outCells.Add(new StationPoint(to.X + dx * lane, to.Y + dy * lane, to.Z));
            }
            return outCells.ToArray();
        }

        readonly struct RunValue {
            public RunValue(StationPoint from, StationPoint to) { From = from; To = to; }
            public StationPoint From { get; }
            public StationPoint To { get; }
        }

        /// <summary>Port of <c>escalatorRun</c>: the lane-1 endpoints shifted to the run's centre.</summary>
        static RunValue EscalatorRun(StationModuleRecord m) {
            var from = m.From.Value;
            var to = m.To.Value;
            bool lowerFirst = from.Z != to.Z ? from.Z < to.Z : from.X != to.X ? from.X < to.X : from.Y < to.Y;
            var lower = lowerFirst ? from : to;
            var upper = lowerFirst ? to : from;
            double len = Math.Sqrt(Math.Pow(upper.X - lower.X, 2) + Math.Pow(upper.Y - lower.Y, 2));
            double half = len > 0 ? (EscalatorWidth(m) - 1) * 0.5 / len : 0;
            double dx = (upper.Y - lower.Y) * half;
            double dy = -(upper.X - lower.X) * half;
            StationPoint Shift(StationPoint p) => new StationPoint(p.X + dx, p.Y + dy, p.Z);
            return new RunValue(Shift(from), Shift(to));
        }

        // ------------------------------------------------------- ground & support

        /// <summary>
        /// True when the street plane is open at <c>(x,y)</c>  a saved void at z=0, a
        /// ground-level rail bed, a run landing or an exit floor plate (port of
        /// <c>groundHoleAt</c>). The full ramp-corridor sweep is not ported here; a run
        /// **landing** is the conservative part of it a point query can answer without
        /// rebuilding the opening table, and the families that own the corridor use
        /// their own envelope.
        /// </summary>
        public static bool IsGroundHole(StationIndex index, int x, int y) {
            if (index == null) return false;
            var groundCell = index.GetCell(x, y, 0);
            if (groundCell != null && !groundCell.IsSolid) return true;
            var tracks = index.ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var module = tracks[i];
                if (module.Z != 0) continue;
                var cfg = module.Config;
                if (cfg.Bool("tunnel") || cfg.Bool("bridge")) continue;
                foreach (var cell in TrackCells(module))
                    if (cell.Z == 0 && cell.X == x && cell.Y == y) return true;
            }
            string[] runTypes = { "stair", "escalator", "walkway", "lift" };
            for (int t = 0; t < runTypes.Length; t++) {
                var runs = index.ModulesOfType(runTypes[t]);
                for (int i = 0; i < runs.Count; i++) {
                    foreach (var cell in Footprint(runs[i]))
                        if (cell.Z == 0 && cell.X == x && cell.Y == y) return true;
                }
            }
            var exits = index.ModulesOfType("exit");
            for (int i = 0; i < exits.Count; i++) {
                var module = exits[i];
                if (module.Z != 0) continue;
                var style = module.Config.Text("style");
                if (style == "doorway" || style == "virtual") continue;
                foreach (var cell in ExitFootprint(module))
                    if (cell.Z == 0 && cell.X == x && cell.Y == y) return true;
            }
            return false;
        }

        /// <summary>
        /// True when a 自动步道's whole run lies on floor: the belt is a surface over solid
        /// ground, so every cell between its two landings must be solid (the street at grade
        /// counts, a dug hole does not). Port of `escalatorBasesSolid`'s walkway half.
        /// </summary>
        public static bool WalkwayFloorOk(StationModuleRecord m, StationIndex index) {
            if (m == null || index == null || !m.From.HasValue || !m.To.HasValue) return false;
            int x0 = (int)Math.Round(m.From.Value.X), y0 = (int)Math.Round(m.From.Value.Y);
            int x1 = (int)Math.Round(m.To.Value.X), y1 = (int)Math.Round(m.To.Value.Y);
            int z = m.Z;
            int dx = Math.Sign(x1 - x0), dy = Math.Sign(y1 - y0);
            int x = x0, y = y0;
            for (int guard = 0; guard <= Math.Abs(x1 - x0) + Math.Abs(y1 - y0) + 1; guard++) {
                if (!IsSolidAt(index, x, y, z)) return false;
                if (x == x1 && y == y1) return true;
                x += dx;
                y += dy;
            }
            return true;
        }

        /// <summary>True when an exit head-house lays floor over the cell at its own level.</summary>
        public static bool IsExitFloorAt(StationIndex index, int x, int y, int z) {
            if (index == null) return false;
            foreach (var module in index.ModulesOfType("exit")) {
                if (module.Z != z) continue;
                var style = module.Config.Text("style");
                if (style == "doorway" || style == "virtual") continue;
                foreach (var cell in ExitFootprint(module))
                    if (cell.X == x && cell.Y == y) return true;
            }
            return false;
        }

        /// <summary>True when a block stands at the coordinate: an authored solid or the virtual street (port of <c>solidAt</c>).</summary>
        public static bool IsSolidAt(StationIndex index, int x, int y, int z) {
            if (index == null) return false;
            var cell = index.GetCell(x, y, z);
            if (cell != null) return cell.IsSolid;
            return z == 0 && !IsGroundHole(index, x, y);
        }

        /// <summary>
        /// Do all the floor cells a module stands on have support? Port of
        /// <c>moduleFloorOk</c> for the supported footprints: authored solid, exit floor
        /// or the street plane. A run is checked at its landings (not the corridor between
        /// them), and a walkway at its covered cells  the same rule as the source's
        /// footprint list.
        /// </summary>
        public static bool ModuleFloorOk(StationModuleRecord module, StationIndex index) {
            if (module == null || index == null) return false;
            var footprint = module.Type == "roof" || module.Type == "hanger"
                ? new[] { module.Point }
                : module.Type == "stair" && !module.Config.Bool("block")
                    ? new[] { module.Point }
                    : Footprint(module);
            foreach (var cell in footprint) {
                int x = (int)Math.Round(cell.X), y = (int)Math.Round(cell.Y);
                bool floor = IsSolidAt(index, x, y, module.Z) ||
                             IsExitFloorAt(index, x, y, module.Z) ||
                             (module.Z == 0 && !IsGroundHole(index, x, y));
                if (!floor) return false;
            }
            return true;
        }

        // ---------------------------------------------------------- floor decor

        /// <summary>The floor-decor footprint (port of <c>floorDecorCells</c>).</summary>
        public static StationPoint[] FloorDecorCells(StationModuleRecord m) {
            if (m.Type == "floor-mark") {
                var b = FloorDecorBounds(m);
                var outCells = new List<StationPoint>();
                for (int x = (int)Math.Floor(b.X0 + 1e-6); x < (int)Math.Ceiling(b.X1 - 1e-6); x++)
                    for (int y = (int)Math.Floor(b.Y0 + 1e-6); y < (int)Math.Ceiling(b.Y1 - 1e-6); y++)
                        outCells.Add(new StationPoint(x, y, m.Z));
                return outCells.ToArray();
            }
            var spec = FloorDecorSpec(m);
            var cells = new List<StationPoint>();
            for (int x = 0; x < spec.W; x++) {
                for (int y = 0; y < spec.D; y++) {
                    RotateLocal(m.Rotation, x, y, out var dx, out var dy);
                    cells.Add(new StationPoint(m.X + (int)Math.Round(dx), m.Y + (int)Math.Round(dy), m.Z));
                }
            }
            return cells.ToArray();
        }

        /// <summary>
        /// Exact vinyl bounds (port of <c>floorDecorBounds</c>), including its
        /// sub-cell screen-door alignment. Elevation is the cell's top surface.
        /// </summary>
        public static StationBox FloorDecorBounds(StationModuleRecord m) {
            var spec = FloorDecorSpec(m);
            double cy = (Math.Ceiling((double)spec.D) - 1) / 2;
            double ox = m.OffsetX, oy = m.OffsetY;
            double minX = double.PositiveInfinity, minY = double.PositiveInfinity;
            double maxX = double.NegativeInfinity, maxY = double.NegativeInfinity;
            foreach (var cornerX in new[] { -spec.W / 2.0, spec.W / 2.0 }) {
                foreach (var cornerY in new[] { -spec.D / 2, spec.D / 2 }) {
                    RotateLocal(m.Rotation, cornerX + (spec.W - 1) / 2.0, cornerY + cy, out var wx, out var wy);
                    minX = Math.Min(minX, wx); maxX = Math.Max(maxX, wx);
                    minY = Math.Min(minY, wy); maxY = Math.Max(maxY, wy);
                }
            }
            return new StationBox(m.X + 0.5 + ox + minX, m.Y + 0.5 + oy + minY, m.Z + 1,
                m.X + 0.5 + ox + maxX, m.Y + 0.5 + oy + maxY, m.Z + 1 + spec.H);
        }

        /// <summary>Port of <c>floorDecorSpec</c>.</summary>
        public static (int W, double D, double H) FloorDecorSpec(StationModuleRecord m) {
            var variant = m.Config.Text("variant");
            switch (m.Type) {
                case "court": return variant == "divider" ? (2, 1, 1) : (14, 7, variant == "badminton" ? 1.6 : 0.97);
                case "ac-unit": return (3, 2, 2.7);
                case "electrical-cabinet": return (3, 1, 2.2);
                case "tactile": return (1, 1, 0.012);
                case "floor-mark": return variant == "direction" ? (1, 2, 0.006) : (3, variant == "waiting" ? 2 : 0.25, 0.006);
                default: return (1, 1, 0.012);
            }
        }

        // ---------------------------------------------------------------- small

        static StationPoint[] MonitorCells(StationModuleRecord m) {
            int count = m.Config.Text("mount") == "wall" ? 3 : 1;
            var cells = new List<StationPoint>(count);
            for (int i = 0; i < count; i++) {
                RotateLocal(m.Rotation, i, 0, out var dx, out var dy);
                cells.Add(new StationPoint(m.X + (int)Math.Round(dx), m.Y + (int)Math.Round(dy), m.Z));
            }
            return cells.ToArray();
        }

        static StationPoint[] ShelfCells(StationModuleRecord m) {
            var variant = m.Config.Text("variant");
            int width = variant == "books" || variant == "bags" || variant == "cafe-backbar-2" ? 2
                : variant == "cafe-backbar-4" ? 4 : 1;
            var cells = new List<StationPoint>(width);
            for (int i = 0; i < width; i++) {
                RotateLocal(m.Rotation, i, 0, out var dx, out var dy);
                cells.Add(new StationPoint(m.X + (int)Math.Round(dx), m.Y + (int)Math.Round(dy), m.Z));
            }
            return cells.ToArray();
        }

        public static int CounterLength(int width) => width >= 1 && width <= 4 ? width : 1;

        static StationPoint[] CheckoutCells(StationModuleRecord m) {
            // `counterCells` reads the module's own saved run length, not a cfg field.
            int length = CounterLength(m.Width);
            var cells = new List<StationPoint>(length);
            for (int i = 0; i < length; i++) {
                RotateLocal(m.Rotation, i, 0, out var dx, out var dy);
                cells.Add(new StationPoint(m.X + (int)Math.Round(dx), m.Y + (int)Math.Round(dy), m.Z));
            }
            return cells.ToArray();
        }

        static int ExtinguisherCells(StationModuleRecord m) {
            var variant = m.Config.Text("variant");
            return variant == "glass" ? 2 : 1;
        }

        static StationPoint[] ExtinguisherRun(StationModuleRecord m) {
            int count = ExtinguisherCells(m);
            var outCells = new List<StationPoint>(count);
            for (int i = 0; i < count; i++) {
                RotateLocal(m.Rotation, i, 0, out var dx, out var dy);
                outCells.Add(new StationPoint(m.X + (int)Math.Round(dx), m.Y + (int)Math.Round(dy), m.Z));
            }
            return outCells.ToArray();
        }

        // ---------------------------------------------------------------- mount

        /// <summary>Port of <c>isWallMounted</c>: is the piece bolted flat to a wall?</summary>
        public static bool IsWallMounted(StationModuleRecord m) {
            switch (m.Type) {
                case "monitor": return m.Config.Text("mount") == "wall";
                case "exit": return m.Config.Text("style") == "doorway";
                case "sign": return m.Config.Text("mount") == "wall";
                case "glass": return !GlassStandsOnFloor(m);
                case "linemap": return m.Config.Text("mount") != "stand";
                case "billboard":
                case "calligraphy":
                case "urinal": return true;
                default: return false;
            }
        }

        /// <summary>Port of <c>isCeilingHung</c> for the saved module types.</summary>
        public static bool IsCeilingHung(StationModuleRecord m) => IsCeilingHung(m.Type, m.Config);

        /// <summary>The same rule for a bare <see cref="ModuleFacts"/> (RCA 15 §1).</summary>
        public static bool IsCeilingHung(ModuleFacts m) => m != null && IsCeilingHung(m.Type, m.Config);

        /// <summary>The one <c>isCeilingHung</c> switch: type and authored config is all it reads.</summary>
        public static bool IsCeilingHung(string type, ModuleConfig config) {
            if (config == null) config = ModuleConfig.Empty;
            switch (type) {
                case "tv":
                case "tv-double":
                case "clock":
                case "clock-digital":
                case "light":
                case "light-circular":
                case "light-rectangular":
                case "vent":
                case "cctv-ptz":
                case "cctv-dome":
                case "monitor-ceiling":
                case "sign-ceiling":
                case "hanger-roof": return true;
                case "cctv": return config.Text("variant") != "post";
                case "monitor": return config.Text("mount") != "wall";
                case "sign": return config.Text("mount") != "wall";
                case "hanger": return config.Text("mount") == "roof";
                default: return false;
            }
        }

        /// <summary>The mount a module is carried by, from its own saved facts.</summary>
        public static StationMount MountOf(StationModuleRecord m) {
            if (m.Type == "track" || m.Type == "platform-edge" || m.Type == "psd-end") return StationMount.Track;
            if (m.Type == "stair" || m.Type == "escalator" || m.Type == "walkway" || m.Type == "lift") return StationMount.Run;
            if (IsCeilingHung(m)) return StationMount.Ceiling;
            if (IsWallMounted(m)) return StationMount.Wall;
            return StationMount.Floor;
        }

        /// <summary>Port of <c>glassStandsOnFloor</c>: a panel that stands on the floor edge like a doorway.</summary>
        public static bool GlassStandsOnFloor(StationModuleRecord m) => GlassStandsOnFloor(m.Config);
        public static bool GlassStandsOnFloor(ModuleConfig config) {
            if (config.Has("curtainHeight")) return true;
            var variant = config.Text("variant");
            switch (variant) {
                case "1x4":
                case "2x4":
                case "3x4":
                case "4x4": return true;
                default: return false;
            }
        }

        /// <summary>
        /// The wall courses a wall-mounted piece needs solid backing on, local
        /// (0 = the first metre above the floor top). Port of
        /// <c>wallMountCourses</c>; empty for a free-standing or hung piece.
        /// </summary>
        public static int[] WallCourses(StationModuleRecord m) {
            switch (m.Type) {
                case "urinal": return new[] { 0, 1 };
                case "monitor": return IsWallMounted(m) ? new[] { 0, 1, 2 } : Array.Empty<int>();
                case "billboard": {
                    var spec = BillboardSpec(m);
                    if (spec.TotalHeight == 0) return new[] { 0 };
                    var courses = new int[spec.TotalHeight];
                    for (int i = 0; i < courses.Length; i++) courses[i] = i;
                    return courses;
                }
                case "exit": return m.Config.Text("style") == "doorway" ? new[] { 0 } : Array.Empty<int>();
                case "glass": return Courses(0, GlassSpec(m).H);
                case "calligraphy": return m.PanelHeight > 0
                    ? Courses(CalligraphyBottom(m.Config.Text("axis")), m.PanelHeight)
                    : Array.Empty<int>();
                case "linemap": {
                    // The wall board's framed band (LINE_MAP_WALL_BOTTOM 1.06, panel 1.8,
                    // frame pad 0.05); the totem stands on its own plinth.
                    return m.Config.Text("mount") == "stand" ? Array.Empty<int>() : Courses(1.01, 1.9);
                }
                case "sign": {
                    if (!IsWallMounted(m)) return Array.Empty<int>();
                    // SIGN_WALL_PANEL_Z 1.65 with a PANEL_MIN_H 0.4 board: the second course.
                    return Courses(1.45, 0.4);
                }
                default: return Array.Empty<int>();
            }
        }

        /// <summary>Port of <c>wallCourses(bottom, height)</c>.</summary>
        public static int[] Courses(double bottom, double height) {
            int first = (int)Math.Floor(bottom + 1e-9);
            int last = Math.Max(first, (int)Math.Ceiling(bottom + height - 1e-9) - 1);
            var courses = new int[last - first + 1];
            for (int i = 0; i < courses.Length; i++) courses[i] = first + i;
            return courses;
        }

        static double CalligraphyBottom(string axis) => axis == "v" ? 0.4 : 1.2;

        static StationModuleRecord CopyWithRotation(StationModuleRecord m, int rotation) =>
            new StationModuleRecord(m.Id, m.Type, m.X, m.Y, m.Z, rotation, m.Width, m.Depth, m.Height,
                m.CeilingAnchored, m.From, m.To, null, m.RawJson, m.Facts, m.PanelHeight, m.OffsetX, m.OffsetY);

        // --------------------------------------------------------------- specs

        public readonly struct BillboardSpecValue {
            public BillboardSpecValue(int w, double panelW, double panelH, double panelZ, int totalHeight) {
                W = w; PanelW = panelW; PanelH = panelH; PanelZ = panelZ; TotalHeight = totalHeight;
            }
            public int W { get; }
            public double PanelW { get; }
            public double PanelH { get; }
            public double PanelZ { get; }
            public int TotalHeight { get; }
        }

        /// <summary>Port of <c>billboardSpec</c> (the placement/clearance fields only).</summary>
        public static BillboardSpecValue BillboardSpec(StationModuleRecord m) {
            switch (m.Config.Text("variant")) {
                case "16x9-3m": return new BillboardSpecValue(6, (3 - 0.24) * 16 / 9, 3 - 0.24, 1.5, 3);
                case "16x9-4m": return new BillboardSpecValue(7, (4 - 0.24) * 16 / 9, 4 - 0.24, 2, 4);
                case "4x3-3m": return new BillboardSpecValue(4, (3 - 0.24) * 4 / 3, 3 - 0.24, 1.5, 3);
                case "4x3-4m": return new BillboardSpecValue(6, (4 - 0.24) * 4 / 3, 4 - 0.24, 2, 4);
                case "panorama": return new BillboardSpecValue(3, 2.82, 0.75, 1.65, 0);
                case "portrait": return new BillboardSpecValue(1, 0.8, 1.16, 1.7, 0);
                case "square": return new BillboardSpecValue(1, 0.8, 0.8, 1.55, 0);
                case "standard": return new BillboardSpecValue(2, 1.72, 0.76, 1.65, 0);
                case "large": return new BillboardSpecValue(2, 1.86, 0.95, 1.7, 0);
                default: return new BillboardSpecValue(1, 0.86, 0.48, 1.6, 0);
            }
        }

        public readonly struct GlassSpecValue {
            public GlassSpecValue(int w, int h) { W = w; H = h; }
            public int W { get; }
            public int H { get; }
        }

        /// <summary>Port of <c>glassModuleSpec</c> (width/height only).</summary>
        public static GlassSpecValue GlassSpec(StationModuleRecord m) => GlassSpec(m.Config);
        public static GlassSpecValue GlassSpec(ModuleConfig config) {
            int width = 1, height = 1;
            switch (config.Text("variant")) {
                case "1x2": height = 2; break;
                case "2x1": width = 2; break;
                case "2x2": width = 2; height = 2; break;
                case "3x1": width = 3; break;
                case "3x2": width = 3; height = 2; break;
                case "1x4": height = 4; break;
                case "2x4": width = 2; height = 4; break;
                case "3x4": width = 3; height = 4; break;
                case "4x4": width = 4; height = 4; break;
            }
            if (config.Has("curtainHeight")) height = (int)Math.Round(config.Number("curtainHeight", height));
            return new GlassSpecValue(width, height);
        }

        // ----------------------------------------------------------- clearance

        /// <summary>
        /// The world box a module occupies, in document axes — the port of
        /// <c>moduleEnvelope</c> for the families this packet owns: flat bodies,
        /// platform screens, beds, shafts, rooms, doors and exits.
        ///
        /// A family whose envelope depends on a table this packet has not ported
        /// (ramp corridors, truss roofs, hangers, sign/line-map panels) returns
        /// <c>false</c> with a reason. That is an explicit diagnostic, not a
        /// stand-in box.
        /// </summary>
        public static bool TryClearance(StationModuleRecord m, out StationBox box, out string unsupported) {
            unsupported = "";
            box = default;
            if (m == null) { unsupported = "no module"; return false; }
            double z0 = m.Z + 1;
            if (m.Type == "road") {
                box = new StationBox(m.X, m.Y, m.Z + 1.01, m.X + m.Width, m.Y + m.Depth, m.Z + 1.07);
                return true;
            }
            if (m.Type == "stair" && m.Config.Bool("block")) {
                double blockHeight = m.Config.Number("blockHeight", 1);
                box = new StationBox(m.X, m.Y, m.Z + 1, m.X + 1, m.Y + 1, m.Z + 1 + blockHeight);
                return true;
            }
            if (m.Type == "lift") {
                if (!m.From.HasValue || !m.To.HasValue) { unsupported = "lift has no saved endpoints"; return false; }
                double lo = Math.Min(m.From.Value.Z, m.To.Value.Z);
                double hi = Math.Max(m.From.Value.Z, m.To.Value.Z);
                int size = LiftSize(m);
                box = new StationBox(m.X, m.Y, lo + 0.5, m.X + size, m.Y + size, hi + 1 + 0.6);
                return true;
            }
            if (m.Type == "hanger") {
                // `hangerBoxes`: the bar plus (for a post mount) the post and its foot. The union
                // is the envelope; the per-box shape stays with the view that draws it.
                if (StationHangerRules.TryBox(m, out box)) return true;
                unsupported = "hanger has no body box";
                return false;
            }
            if (m.Type == "walkway" || m.Type == "stair" || m.Type == "escalator") {
                // `rampEnvelope`: the corridor a straight run reserves. A turning stair or a
                // diagonal run reports the unported table instead of a stand-in box.
                return StationRampRules.TryEnvelope(m, out box, out unsupported);
            }
            if (m.CeilingAnchored && m.Type != "hanger" && IsCeilingHung(m) && m.Type != "light" && m.Type != "vent") {
                box = new StationBox(m.X, m.Y, z0 - 3, m.X + 1, m.Y + 1, z0);
                return true;
            }
            switch (m.Type) {
                case "sidewalk":
                case "lawn":
                    box = new StationBox(m.X, m.Y, z0, m.X + 1, m.Y + 1, z0 + OutdoorSurfaceHeight);
                    return true;
                case "tree":
                    box = new StationBox(m.X + 0.3, m.Y + 0.3, z0, m.X + 0.7, m.Y + 0.7, z0 + 4.5);
                    return true;
                case "bench":
                    box = StationBox.FromCells(Run(m), z0, z0 + 1);
                    return true;
                case "door": {
                    var run = Run(m);
                    box = StationBox.FromCells(run, z0, z0 + DoorHeight(m));
                    return true;
                }
                case "guidepost":
                    box = new StationBox(m.X, m.Y, z0, m.X + 1, m.Y + 1, z0 + 4);
                    return true;
                case "busstop":
                    box = StationBox.FromCells(TrackCells(m), z0, z0 + 3);
                    return true;
                case "checkout":
                    box = StationBox.FromCells(CheckoutCells(m), z0, z0 + CounterHeight(m));
                    return true;
                case "light": {
                    // `lightSpec`/`lightCeilingZ`: a shallow fitting hanging from its slab  a
                    // 0.5 m disc, or a 0.8 × 0.12 bar turned with the piece, 8 cm deep.
                    var light = LightPlan(m.Rotation, m.Config);
                    double x = m.X + 0.5 + light.OffsetX, y = m.Y + 0.5 + light.OffsetY;
                    double ceiling = m.CeilingAnchored ? m.Z + 1 : m.Z + 5;
                    box = new StationBox(x - light.Width / 2, y - light.Depth / 2, ceiling - 0.08,
                        x + light.Width / 2, y + light.Depth / 2, ceiling);
                    return true;
                }
                case "vent": {
                    // `VENT_WIDTH`/`VENT_DEPTH`: a 0.7 m grille, 6 cm deep, under its slab.
                    double ceiling = m.CeilingAnchored ? m.Z + 1 : m.Z + 5;
                    box = new StationBox(m.X + 0.5 - 0.35, m.Y + 0.5 - 0.35, ceiling - 0.06,
                        m.X + 0.5 + 0.35, m.Y + 0.5 + 0.35, ceiling);
                    return true;
                }
                case "gate": box = Single(m, z0, 1.3); return true;
                case "tvm":
                case "vending": box = Single(m, z0, 1.9); return true;
                case "desk": box = Single(m, z0, DeskHeight); return true;
                case "cubicle": box = Single(m, z0, 1.8); return true;
                case "sink": box = Single(m, z0, 0.9); return true;
                case "bin": box = Single(m, z0, 0.95); return true;
                case "clock": box = Single(m, z0, 4); return true;
                case "cctv": box = Single(m, z0, 4); return true;
                case "tv": box = Single(m, z0, 4); return true;
                case "urinal":
                    // A wall-hung urinal reserves its bowl only.
                    WallSide(m.Rotation, out var ux, out var uy);
                    box = new StationBox(
                        m.X + 0.5 + (ux != 0 ? Math.Min(ux * 0.04, ux * 0.5) : -0.3),
                        m.Y + 0.5 + (uy != 0 ? Math.Min(uy * 0.04, uy * 0.5) : -0.3),
                        z0 + 0.27,
                        m.X + 0.5 + (ux != 0 ? Math.Max(ux * 0.04, ux * 0.5) : 0.3),
                        m.Y + 0.5 + (uy != 0 ? Math.Max(uy * 0.04, uy * 0.5) : 0.3),
                        z0 + 1.72);
                    return true;
                case "extinguisher": {
                    var height = m.Config.Text("variant") == "glass" ? 2.0 : m.Config.Text("variant") == "compact" ? 0.5 : 1.1;
                    box = StationBox.FromCells(ExtinguisherRun(m), z0, z0 + height);
                    return true;
                }
                case "shelf": {
                    var variant = m.Config.Text("variant");
                    double height = variant == "white-short" ? 1.25 : variant == "wire" ? 1.6 : variant == "cooler" || variant == "cooler-dark" ? 2.05
                        : variant == "books" || variant == "bags" ? 2.05
                        : variant == "clothing-rail" ? 1.65 : variant == "clothing-wall" ? 1.95 : variant == "clothing-table" ? 1.05
                        : variant == "clothing-shoes" ? 1.35 : variant == "food-snacks" ? 1.65 : variant == "food-bakery" ? 1.55
                        : variant == "ice-cream" ? 0.98 : variant == "fruit-island" ? 1.05 : variant == "fruit-tiered" ? 1.5
                        : variant == "cafe-backbar" || variant == "cafe-backbar-2" || variant == "cafe-backbar-4" ? 2.15 : 1.9;
                    box = StationBox.FromCells(ShelfCells(m), z0, z0 + height);
                    return true;
                }
                case "court":
                case "ac-unit":
                case "electrical-cabinet":
                case "tactile": {
                    var spec = FloorDecorSpec(m);
                    box = StationBox.FromCells(FloorDecorCells(m), z0, z0 + spec.H);
                    return true;
                }
                case "floor-mark": {
                    var bounds = FloorDecorBounds(m);
                    box = bounds;
                    return true;
                }
                case "sign": {
                    if (IsCeilingHung(m)) { box = Single(m, z0, 4); return true; }
                    // Port of `flatEnvelope`'s wall sign branch (`sim/placement.ts` + `sim/sign.ts` +
                    // `sim/boothSigns.ts`): reserve only the printed sheet's 3 mm stand-off along the
                    // wall or booth header and the 0.4 m panel band.
                    const double panelMinH = 0.4;
                    const double half = panelMinH * 0.5;
                    const double standOff = 0.003;
                    bool hasBooth = !string.IsNullOrEmpty(m.Config.Text("boothId"));
                    double panelZ = hasBooth ? 2.4 - half : 1.65;
                    double width = SignBoardWidth(m.Config);
                    double dx = 0, dy = 0;
                    if (hasBooth) SignBoardWidthReader.TryReadPoint(m.Config.Json("boothOffset"), out dx, out dy);
                    int rot = NormRot(m.Rotation);
                    WallSide(rot, out var sx, out var sy);
                    double cx = m.X + 0.5 + dx, cy = m.Y + 0.5 + dy;
                    double wallX = cx + sx * 0.5, wallY = cy + sy * 0.5;
                    double x0 = rot % 2 == 1 ? Math.Min(wallX, wallX - sx * standOff) : cx - width * 0.5;
                    double x1 = rot % 2 == 1 ? Math.Max(wallX, wallX - sx * standOff) : cx + width * 0.5;
                    double y0 = rot % 2 == 1 ? cy - width * 0.5 : Math.Min(wallY, wallY - sy * standOff);
                    double y1 = rot % 2 == 1 ? cy + width * 0.5 : Math.Max(wallY, wallY - sy * standOff);
                    box = new StationBox(x0, y0, z0 + panelZ - half, x1, y1, z0 + panelZ + half);
                    return true;
                }
                case "billboard": {
                    var spec = BillboardSpec(m);
                    var cells = Run(m);
                    double pz = m.Z + 1 + spec.PanelZ;
                    double half = spec.PanelH / 2 + (spec.TotalHeight > 0 ? 0.12 : 0.14);
                    box = WallPanelBox(m, cells, pz - half, pz + half);
                    return true;
                }
                case "glass": {
                    var spec = GlassSpec(m);
                    // Plan 22 §2: a floor-standing 玻璃幕墙 reserves the **rotated edge strip** its
                    // pane occupies, not the wall panel's band. Its plane sits on the tile's own
                    // `rot` leading edge (`GLASS_FRAME.depth / 2 − 0.5` off the cell centre), so a
                    // door fitted into the same cell shares that strip instead of fighting the
                    // wall panel's box, which stood 0.44 m off the centre on the opposite side.
                    box = GlassEnvelope(m, spec.H);
                    return true;
                }
                case "monitor": {
                    if (m.Config.Text("mount") == "wall") {
                        box = WallPanelBox(m, MonitorCells(m), z0 + 0.5, z0 + 2.5);
                        return true;
                    }
                    box = new StationBox(m.X, m.Y, z0 + 1.7, m.X + 1, m.Y + 1, z0 + 3);
                    return true;
                }
                case "calligraphy": {
                    if (m.PanelHeight <= 0) {
                        unsupported = "calligraphy panel height (panelH) is absent from the saved record";
                        return false;
                    }
                    double bottom = CalligraphyBottom(m.Config.Text("axis"));
                    var cells = Run(m);
                    // A pillar-mounted inscription faces the other way (flatEnvelope
                    // flips the turn when cfg.pillarId is present).
                    var reference = m.Config.Has("pillarId")
                        ? CopyWithRotation(m, (m.Rotation + 2) % 4)
                        : m;
                    box = WallPanelBox(reference, cells, z0 + bottom, z0 + bottom + m.PanelHeight);
                    return true;
                }
                case "traffic-light":
                    box = new StationBox(m.X + 0.2, m.Y + 0.2, z0, m.X + 0.8, m.Y + 0.8, z0 + 3.5);
                    return true;
                case "rail-signal": {
                    double half = 0.38 * RailSignalScale;
                    box = new StationBox(m.X + 0.5 - half, m.Y + 0.5 - half, z0, m.X + 0.5 + half, m.Y + 0.5 + half, z0 + RailSignalHeight);
                    return true;
                }
                case "linemap": {
                    // LINE_MAP_PANEL_W 1.8 × PANEL_H 1.8, frame pad 0.05, wall bottom 1.06.
                    const double panelH = 1.8;
                    const double pad = 0.05;
                    if (m.Config.Text("mount") == "stand")
                        box = StationBox.FromCells(Run(m), z0, z0 + 0.45 + panelH + pad);
                    else
                        box = WallPanelBox(m, Run(m), z0 + 1.06 - pad, z0 + 1.06 + panelH + pad);
                    return true;
                }
                case "psd-end": {
                    if (m.Config.Text("variant") != "cover") {
                        // The end panel's cap: the tile-bounded strip beside the screen line
                        // (`sim/placement.ts` flatEnvelope + sim/psdEnds.ts psdEndOffset/
                        // psdEndSpan). Its `cfg.offset` is the corner's length trim, carried
                        // only when `cfg.corner` names the screen it was snapped to.
                        double h = m.Config.Text("psd") == "half" ? PsdHalfHeight : PsdFullHeight;
                        double endOffsetX = m.Config.Has("corner") ? m.OffsetX : 0;
                        double endOffsetY = m.OffsetY;
                        double spanLo = Math.Max(-0.5, -0.5 - endOffsetX);
                        double spanHi = Math.Min(0.5, 0.5 - endOffsetX);
                        double capLo = Math.Max(-0.5, -0.48 + endOffsetY);
                        double capHi = Math.Min(0.5, -0.20 + endOffsetY);
                        RotateLocal(m.Rotation, spanLo + endOffsetX, capLo, out var cax, out var cay);
                        RotateLocal(m.Rotation, spanHi + endOffsetX, capHi, out var cbx, out var cby);
                        box = new StationBox(
                            m.X + 0.5 + Math.Min(cax, cbx), m.Y + 0.5 + Math.Min(cay, cby), z0,
                            m.X + 0.5 + Math.Max(cax, cbx), m.Y + 0.5 + Math.Max(cay, cby), z0 + h);
                        return true;
                    }
                    var side = m.Config.Text("side") == "right" ? 1 : -1;
                    double width = m.Config.Number("width", 1);
                    double depth = m.Config.Number("depth", 0.24);
                    double ox = m.OffsetX, oy = m.OffsetY;
                    RotateLocal(m.Rotation, ox, side * 0.34 + oy, out var cx, out var cy);
                    RotateLocal(m.Rotation, 1, 0, out var axX, out var axY);
                    RotateLocal(m.Rotation, 0, 1, out var ayX, out var ayY);
                    double rx = Math.Abs(axX) * width * 0.5 + Math.Abs(ayX) * depth * 0.5;
                    double ry = Math.Abs(axY) * width * 0.5 + Math.Abs(ayY) * depth * 0.5;
                    box = new StationBox(m.X + 0.5 + cx - rx, m.Y + 0.5 + cy - ry, m.Z,
                        m.X + 0.5 + cx + rx, m.Y + 0.5 + cy + ry, m.Z + 1);
                    return true;
                }
                case "fence": {
                    // Bridge railings and sound barriers are the same thin edge housing
                    // (sim/noiseBarriers.ts): offset toward the local −y edge by
                    // PSD_WALL_OFFSET and a variant height, not the 1 m fence panel.
                    double noiseHeight = 0;
                    var variant = m.Config.Text("variant");
                    if (variant == "bridge-railing") noiseHeight = 0.74;
                    else if (variant == "sound-barrier-half") noiseHeight = BridgeBarrierTop("sound-barrier-half") - 0.5;
                    else if (variant == "sound-barrier") noiseHeight = BridgeBarrierTop("sound-barrier") - 0.5;
                    if (noiseHeight > 0) {
                        RotateLocal(m.Rotation, 0, -0.34, out var ndx, out var ndy);
                        if (NormRot(m.Rotation) % 2 == 1)
                            box = new StationBox(m.X + 0.44 + ndx, m.Y, z0, m.X + 0.56 + ndx, m.Y + 1, z0 + noiseHeight);
                        else
                            box = new StationBox(m.X, m.Y + 0.44 + ndy, z0, m.X + 1, m.Y + 0.56 + ndy, z0 + noiseHeight);
                        return true;
                    }
                    double fenceTop = z0 + (variant == "steel-blue" ? 2 : 1);
                    if (NormRot(m.Rotation) % 2 == 1)
                        box = new StationBox(m.X + 0.45, m.Y, z0, m.X + 0.55, m.Y + 1, fenceTop);
                    else
                        box = new StationBox(m.X, m.Y + 0.45, z0, m.X + 1, m.Y + 0.55, fenceTop);
                    return true;
                }
                case "pillar": {
                    double half = PillarWidth(m) / 2;
                    PillarOffset(m, out var ox, out var oy);
                    double height = m.Config.Number("height", 0) - (m.Config.Has("bridgeId") ? 1 + 1 : 0);
                    box = new StationBox(m.X + 0.5 + ox - half, m.Y + 0.5 + oy - half, z0,
                        m.X + 0.5 + ox + half, m.Y + 0.5 + oy + half, z0 + height);
                    return true;
                }
                case "roof":
                    // `flatEnvelope`'s roof branch. A plate with a 贴顶 snap is a thin slab
                    // pinned inside its cell; a plain tile hangs one truss base (5 m) above the
                    // cell it was dropped on, a quarter-metre thick; a truss shell spans from
                    // its base to its 10 m top, and a canopy reserves its posts and the lowered
                    // slab they carry.
                    if (!StationRoofRules.IsVariant(m.Config.Text("variant"))) {
                        var cells = TrackCells(m);
                        if (!string.IsNullOrEmpty(m.Config.Text("plateSnap"))) {
                            double centre = m.Z + (m.Config.Text("plateSnap") == "lower" ? 0.125 : 0.875);
                            box = StationBox.FromCells(cells, centre - 0.125, centre + 0.125);
                        } else {
                            box = StationBox.FromCells(cells, m.Z + 1 + 5, m.Z + 1 + 5 + 0.25);
                        }
                        return true;
                    }
                    if (string.Equals(m.Config.Text("variant"), "canopy", StringComparison.Ordinal)) {
                        return StationRoofRules.TryCanopyBody(m, out box);
                    }
                    box = StationBox.FromCells(TrackCells(m), m.Z + 1 + StationRoofRules.Base,
                        m.Z + 1 + StationRoofRules.Top);
                    return true;
                case "exit": {
                    var style = m.Config.Text("style");
                    if (style == "virtual") {
                        box = new StationBox(m.X, m.Y, z0, m.X + 1, m.Y + 1, z0 + 4);
                        return true;
                    }
                    if (style == "doorway") {
                        // The header panel spans the head-house's bay group: the local
                        // x columns of `exitSpan`, turned by the module's rotation
                        // (port of flatEnvelope's doorway branch).
                        var baySpan = ExitSpan(m);
                        var headerCells = new System.Collections.Generic.List<StationPoint>();
                        for (int lx = (int)Math.Ceiling(baySpan.Centre - baySpan.Half - 1e-6);
                             lx < (int)Math.Ceiling(baySpan.Centre + baySpan.Half - 1e-6); lx++) {
                            RotateLocal(m.Rotation, lx, 0, out var dx, out var dy);
                            headerCells.Add(new StationPoint(m.X + (int)Math.Round(dx), m.Y + (int)Math.Round(dy), m.Z));
                        }
                        double mountZ = m.Config.Number("mountZ", z0);
                        box = WallPanelBox(m, headerCells, mountZ + 0.04, mountZ + 0.96);
                        return true;
                    }
                    var span = ExitSpan(m);
                    double rx = span.Half;   // exitWidth(bays) / 2
                    double ry = 2.0;         // EXIT_L / 2
                    double half = Math.Max(rx, ry);
                    // `flatEnvelope` builds every flat body from the cell's floor top
                    // (`z0 = m.z + 1`), the exit head-house included.
                    box = new StationBox(m.X + 0.5 - half, m.Y + 0.5 - half, z0,
                        m.X + 0.5 + half, m.Y + 0.5 + half, z0 + 3.4);
                    return true;
                }
                case "retail":
                case "shop":
                case "booth": {
                    double height = m.Type == "booth" ? 2.4 : 3.6;
                    box = new StationBox(m.X, m.Y, z0, m.X + m.Width, m.Y + m.Height, z0 + height);
                    return true;
                }
                case "platform-edge": {
                    var psd = m.Config.Text("psd");
                    if (psd == "none") { box = default; return true; }
                    double height = psd == "half" ? PsdHalfHeight : PsdFullHeight;
                    var run = Run(m);
                    var b = StationBox.FromCells(run, z0, z0 + height);
                    box = b.Width <= 1.0001
                        ? new StationBox(b.X0 + 0.16, b.Y0, b.Z0, b.X1 - 0.16, b.Y1, b.Z1)
                        : new StationBox(b.X0, b.Y0 + 0.16, b.Z0, b.X1, b.Y1 - 0.16, b.Z1);
                    return true;
                }
                case "track": {
                    var cells = TrackCells(m);
                    var bridge = m.Config.Bool("bridge");
                    box = StationBox.FromCells(cells, m.Z - 1,
                        m.Z + (bridge ? BridgeBarrierTop(m.Config.Text("bridgeRailing")) : 1));
                    return true;
                }
                case "hanger":
                    unsupported = "hanger envelope (sim/hangers.ts hangerBoxes) is not ported here";
                    return false;
                default:
                    unsupported = "no clearance rule for module type '" + m.Type + "'";
                    return false;
            }
        }

        static StationBox Single(StationModuleRecord m, double z0, double height) =>
            new StationBox(m.X, m.Y, z0, m.X + 1, m.Y + 1, z0 + height);

        /// <summary>Port of <c>pillarWidth</c>.</summary>
        public static double PillarWidth(StationModuleRecord m) => m.Config.Text("size") == "thick" ? 1 : 0.3;

        /// <summary>Port of <c>pillarOffset</c>: slim supports follow the shared in-cell cycle.</summary>
        public static void PillarOffset(StationModuleRecord m, out double x, out double y) {
            if (m.Config.Text("size") != "slim") { x = 0; y = 0; return; }
            var positions = new[,] { { 0, 0 }, { -1, 1 }, { 0, 1 }, { 1, 1 }, { -1, 0 }, { 1, 0 }, { -1, -1 }, { 0, -1 }, { 1, -1 } };
            int index = ((m.Rotation % 9) + 9) % 9;
            double width = PillarWidth(m);
            x = positions[index, 0] * (1 - width) / 2;
            y = positions[index, 1] * (1 - width) / 2;
        }

        /// <summary>Port of <c>bridgeBarrierTop</c>.</summary>
        public static double BridgeBarrierTop(string railing) =>
            railing == "sound-barrier-half" ? 2 : railing == "sound-barrier" ? 3.5 : 1.29;

        /// <summary>The wall-panel box: the run's AABB narrowed to one cell's depth on the wall side.</summary>
        static StationBox WallPanelBox(StationModuleRecord m, IReadOnlyList<StationPoint> cells, double zLo, double zHi) {
            var box = StationBox.FromCells(cells, zLo, zHi);
            WallSide(m.Rotation, out var wx, out var wy);
            const double panelDepth = 0.25;
            if (wx != 0)
                return wx > 0
                    ? new StationBox(box.X1 - panelDepth, box.Y0, box.Z0, box.X1, box.Y1, box.Z1)
                    : new StationBox(box.X0, box.Y0, box.Z0, box.X0 + panelDepth, box.Y1, box.Z1);
            return wy > 0
                ? new StationBox(box.X0, box.Y1 - panelDepth, box.Z0, box.X1, box.Y1, box.Z1)
                : new StationBox(box.X0, box.Y0, box.Z0, box.X1, box.Y0 + panelDepth, box.Z1);
        }

        /// <summary>
        /// The housing of a 玻璃板: a **slab on an edge** rather than a cell. A short 玻璃板 is
        /// cladding bolted to the wall behind it, so its strip hugs the wall (`WallPanelBox`); a
        /// 玻璃幕墙 stands on the floor edge like a doorway, so its strip is the rotated leading
        /// edge with no wall behind it (`GlassModel.ts`'s `edgeIn = GLASS_FRAME.depth / 2 − 0.5`
        /// with a 0.1 m frame depth). Either way the air beside it stays the room's.
        /// </summary>
        static StationBox GlassEnvelope(StationModuleRecord m, double height) {
            double z0 = m.Z + 1;
            if (!GlassStandsOnFloor(m.Config)) return WallPanelBox(m, Run(m), z0, z0 + height);
            const double edgeIn = GlassFrameDepth * .5 - .5;
            const double halfDepth = GlassFrameDepth * .5;
            int run = Math.Max(1, m.Width > 0 ? m.Width : GlassSpec(m.Config).W);
            double halfRun = run * .5;
            RotateLocal(m.Rotation, (run - 1) * .5, edgeIn, out var centreX, out var centreY);
            double cx = m.X + .5 + centreX, cy = m.Y + .5 + centreY;
            double x0 = double.MaxValue, y0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue;
            var corners = new[] {
                (-halfRun, -halfDepth), (halfRun, -halfDepth), (halfRun, halfDepth), (-halfRun, halfDepth),
            };
            foreach (var corner in corners) {
                RotateLocal(m.Rotation, corner.Item1, corner.Item2, out var ox, out var oy);
                x0 = Math.Min(x0, cx + ox); x1 = Math.Max(x1, cx + ox);
                y0 = Math.Min(y0, cy + oy); y1 = Math.Max(y1, cy + oy);
            }
            return new StationBox(x0, y0, z0, x1, y1, z0 + height);
        }

        /// <summary>`GLASS_FRAME.depth`  every curtain member's stand-off from the wall.</summary>
        const double GlassFrameDepth = .1;

        /// <summary>Port of <c>doorSpec(...).h</c>: every door variant is 1.99 m tall.</summary>
        public static double DoorHeight(StationModuleRecord m) => 1.99;

        /// <summary>Port of <c>counterSpec(variant).height</c>.</summary>
        public static double CounterHeight(StationModuleRecord m) {
            switch (m.Config.Text("variant")) {
                case "generic": return 1.4;
                case "cafe":
                case "cafe-pastry": return 1.5;
                default: return CheckoutHeight;
            }
        }

        // ----------------------------------------------------------- sign board

        /// <summary>
        /// Port of <c>signBoardsPanel(mountedSignBoards(mount, signBoardsOf(cfg))).w</c> in
        /// <c>sim/sign.ts</c> so <c>Metro.View</c> (<c>StationCeilingMounts.HangerSupports</c>)
        /// can check rod clearance along a hanger crossbar without taking an upward dependency on
        /// <c>Metro.App</c> or <c>Newtonsoft.Json</c>.
        /// </summary>
        public static double SignBoardWidth(ModuleConfig config) => SignBoardWidthReader.Width(config);

        static class SignBoardWidthReader {
            const float PanelMinWidth = 1f;
            const float PanelMaxWidth = 3.5f;
            const float PiecePad = 0.02f;
            const float EndPad = 0.12f;
            const float EdgePad = 0.006f;
            const float UturnWidth = 0.24f;
            const float ArrowWidth = 0.32f;
            const float LineWidth = 0.28f;
            const float IconWidth = 0.2f;
            const float TextHeight = 0.107f;
            const float TextEnScale = 0.5f;
            const int TextMax = 24;

            static readonly HashSet<string> ValidIcons = new HashSet<string>(StringComparer.Ordinal) {
                "train", "lift", "accessible", "restroom", "escalator", "stairs",
                "exit", "stop", "customer-service", "separator", "gap",
            };

            struct RawMark {
                public float X;
                public float Scale;
                public float PieceWidth;
            }

            public static bool TryReadPoint(string json, out double x, out double y) {
                x = 0;
                y = 0;
                if (string.IsNullOrEmpty(json)) return false;
                int i = SkipSpace(json, 0);
                if (i >= json.Length || json[i] != '{') return false;
                i = SkipSpace(json, i + 1);
                if (i < json.Length && json[i] == '}') return true;
                while (i < json.Length) {
                    if (json[i] != '"' || !TryReadString(json, ref i, out string key)) return false;
                    i = SkipSpace(json, i);
                    if (i >= json.Length || json[i] != ':') return false;
                    i = SkipSpace(json, i + 1);
                    if (i >= json.Length) return false;
                    if (key == "x") {
                        if (!TryReadNumberOrSkip(json, ref i, out x)) return false;
                    } else if (key == "y") {
                        if (!TryReadNumberOrSkip(json, ref i, out y)) return false;
                    } else if (!SkipValue(json, ref i)) {
                        return false;
                    }
                    i = SkipSpace(json, i);
                    if (i >= json.Length) return false;
                    if (json[i] == ',') {
                        i = SkipSpace(json, i + 1);
                        continue;
                    }
                    return json[i] == '}';
                }
                return false;
            }

            public static double Width(ModuleConfig config) {
                if (config == null) return PanelMinWidth;
                string frontJson = config.Json("front");
                string backJson = config.Json("back");
                bool hasFront = IsJsonArray(frontJson);
                bool hasBack = IsJsonArray(backJson);
                if (!hasFront && !hasBack) return PanelMinWidth;
                float front = hasFront ? FacePanelWidth(frontJson) : PanelMinWidth;
                bool wall = string.Equals(config.Text("mount"), "wall", StringComparison.Ordinal);
                float back = !wall && hasBack ? FacePanelWidth(backJson) : PanelMinWidth;
                return Math.Max(front, back);
            }

            static bool IsJsonArray(string json) {
                if (string.IsNullOrEmpty(json)) return false;
                int i = SkipSpace(json, 0);
                return i < json.Length && json[i] == '[';
            }

            static float FacePanelWidth(string json) {
                if (!TryParseArray(json, out var marks) || marks.Count == 0) return PanelMinWidth;
                var packed = Pack(marks);
                float panel = PanelWidth(packed);
                var fitted = Fit(packed, panel);
                return PanelWidth(fitted);
            }

            static RawMark[] Pack(List<RawMark> layout) {
                int count = layout.Count;
                var result = new RawMark[count];
                var order = new List<int>(count);
                for (int i = 0; i < count; i++) {
                    result[i] = layout[i];
                    if (result[i].PieceWidth > 0f) order.Add(i);
                }
                order.Sort((a, b) => {
                    int byX = result[a].X.CompareTo(result[b].X);
                    return byX != 0 ? byX : a.CompareTo(b);
                });
                var occupied = new List<(float Lo, float Hi)>(count);
                foreach (int index in order) {
                    float width = result[index].PieceWidth;
                    float centre = Math.Max(EndPad + width / 2f, Math.Min(result[index].X, PanelMaxWidth - width / 2f));
                    occupied.Sort((a, b) => a.Lo.CompareTo(b.Lo));
                    foreach (var used in occupied) {
                        if (centre - width / 2f < used.Hi && centre + width / 2f > used.Lo) centre = used.Hi + width / 2f;
                    }
                    if (centre + width / 2f > PanelMaxWidth) {
                        centre = Math.Max(EndPad + width / 2f, PanelMaxWidth - width / 2f);
                    }
                    occupied.Add((centre - width / 2f, centre + width / 2f));
                    result[index].X = centre;
                }
                return result;
            }

            static RawMark[] Fit(RawMark[] layout, float panel) {
                if (layout.Length == 0) return layout;
                float left = float.PositiveInfinity;
                float right = 0f;
                for (int i = 0; i < layout.Length; i++) {
                    float width = layout[i].PieceWidth;
                    left = Math.Min(left, layout[i].X - width / 2f);
                    right = Math.Max(right, layout[i].X + width / 2f);
                }
                float shift = panel < PanelMaxWidth && left >= EdgePad && right > panel - EdgePad
                    ? (panel - (right - left)) / 2f - left
                    : 0f;
                var result = new RawMark[layout.Length];
                for (int i = 0; i < layout.Length; i++) {
                    var mark = layout[i];
                    float width = mark.PieceWidth;
                    float half = width / 2f + EdgePad;
                    float low = half * 2f >= panel ? panel / 2f : half;
                    float high = half * 2f >= panel ? panel / 2f : panel - half;
                    mark.X = Math.Min(high, Math.Max(low, mark.X + shift));
                    result[i] = mark;
                }
                return result;
            }

            static float PanelWidth(RawMark[] layout) {
                bool any = false;
                float left = 0f;
                float right = 0f;
                for (int i = 0; i < layout.Length; i++) {
                    float width = layout[i].PieceWidth;
                    if (width <= 0f) continue;
                    float markLeft = layout[i].X - width / 2f;
                    float markRight = layout[i].X + width / 2f;
                    if (!any) { left = markLeft; right = markRight; any = true; }
                    else { left = Math.Min(left, markLeft); right = Math.Max(right, markRight); }
                }
                if (!any || right <= 0f) return PanelMinWidth;
                return ClampPanel(PanelMinWidth, Math.Max(PanelMinWidth, right - left + EndPad * 2f), PanelMaxWidth);
            }

            static float ClampPanel(float min, float want, float max) {
                const double step = 0.05;
                double rounded = Math.Floor((double)want / step + 0.5 + 1e-9) * step;
                double value = Math.Min(max, Math.Max(min, rounded));
                return (float)Math.Round(value, 3);
            }

            static float ClampedScale(float scale) {
                if (float.IsNaN(scale) || float.IsInfinity(scale)) return 1f;
                return Math.Min(2f, Math.Max(0.4f, scale));
            }

            static float ComputePieceWidth(string kind, string arrow, string icon, string text, bool hasTextString, float rawScale) {
                float scale = ClampedScale(rawScale);
                float ink;
                switch (kind) {
                    case "arrow":
                        ink = (arrow == "uturn-right" || arrow == "uturn-left" ? UturnWidth : ArrowWidth) * scale;
                        break;
                    case "line":
                        ink = LineWidth * scale;
                        break;
                    case "icon":
                        if (!ValidIcons.Contains(icon ?? "")) return -1f;
                        ink = IconWidth * scale;
                        break;
                    case "text": {
                        if (!hasTextString) return -1f;
                        var lines = TextLines(text);
                        if (lines.Length == 0) return 0f;
                        float size = TextHeight * scale;
                        ink = lines.Length == 1
                            ? EstimateTextWidth(lines[0], size * 2f * LineScale(0, lines[0]))
                            : Math.Max(
                                EstimateTextWidth(lines[0], size * LineScale(0, lines[0])),
                                EstimateTextWidth(lines[1], size * LineScale(1, lines[1])));
                        break;
                    }
                    default:
                        return -1f;
                }
                return ink <= 0f ? 0f : ink + PiecePad * 2f;
            }

            static string[] TextLines(string text) {
                var kept = new List<string>();
                foreach (var row in (text ?? "").Split(new[] { "\r\n", "\n" }, StringSplitOptions.None)) {
                    if (row.Length == 0) continue;
                    kept.Add(Prefix(row, TextMax));
                    if (kept.Count == 2) break;
                }
                return kept.ToArray();
            }

            static string Prefix(string value, int count) {
                var output = new StringBuilder();
                int taken = 0;
                for (int i = 0; i < value.Length && taken < count; i++, taken++) {
                    output.Append(value[i]);
                    if (char.IsHighSurrogate(value[i]) && i + 1 < value.Length && char.IsLowSurrogate(value[i + 1])) output.Append(value[++i]);
                }
                return output.ToString();
            }

            static bool HasCjk(string text) {
                foreach (char ch in text ?? "") {
                    int code = ch;
                    if ((code >= 0x2e80 && code <= 0x303f) || (code >= 0x3040 && code <= 0x30ff) ||
                        (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff) ||
                        (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef)) return true;
                }
                return false;
            }

            static float LineScale(int index, string line) => index == 0 || HasCjk(line) ? 1f : TextEnScale;

            static float EstimateTextWidth(string text, float size) {
                float em = 0f;
                for (int i = 0; i < (text ?? "").Length; i++) {
                    int code = text[i];
                    if (char.IsHighSurrogate(text[i]) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1])) {
                        code = char.ConvertToUtf32(text, i);
                        i++;
                    }
                    if (code >= 0x2e80) em += 1f;
                    else if (code == ' ') em += 0.3f;
                    else if (code >= '0' && code <= '9') em += 0.58f;
                    else if (code >= 'A' && code <= 'Z') em += 0.68f;
                    else if (code >= 'a' && code <= 'z') em += 0.55f;
                    else em += 0.6f;
                }
                return em * size;
            }

            static bool TryParseArray(string json, out List<RawMark> marks) {
                marks = new List<RawMark>();
                int i = SkipSpace(json, 0);
                if (i >= json.Length || json[i] != '[') return false;
                i = SkipSpace(json, i + 1);
                if (i < json.Length && json[i] == ']') return true;
                while (i < json.Length) {
                    if (json[i] == '{') {
                        if (!TryParseObject(json, ref i, out var mark, out bool keep)) return false;
                        if (keep) marks.Add(mark);
                    } else {
                        if (!SkipValue(json, ref i)) return false;
                    }
                    i = SkipSpace(json, i);
                    if (i >= json.Length) return false;
                    if (json[i] == ',') {
                        i = SkipSpace(json, i + 1);
                        continue;
                    }
                    return json[i] == ']';
                }
                return false;
            }

            static bool TryParseObject(string json, ref int i, out RawMark mark, out bool keep) {
                mark = default;
                keep = false;
                string kind = "", arrow = "", icon = "", text = "";
                bool hasTextString = false;
                double x = 0, scale = 0;
                i = SkipSpace(json, i + 1);
                if (i < json.Length && json[i] == '}') {
                    i++;
                    return true;
                }
                while (i < json.Length) {
                    if (json[i] != '"' || !TryReadString(json, ref i, out string key)) return false;
                    i = SkipSpace(json, i);
                    if (i >= json.Length || json[i] != ':') return false;
                    i = SkipSpace(json, i + 1);
                    if (i >= json.Length) return false;
                    switch (key) {
                        case "kind":
                            if (json[i] == '"') { if (!TryReadString(json, ref i, out kind)) return false; }
                            else if (!SkipValue(json, ref i)) return false;
                            break;
                        case "arrow":
                            if (json[i] == '"') { if (!TryReadString(json, ref i, out arrow)) return false; }
                            else if (!SkipValue(json, ref i)) return false;
                            break;
                        case "icon":
                            if (json[i] == '"') { if (!TryReadString(json, ref i, out icon)) return false; }
                            else if (!SkipValue(json, ref i)) return false;
                            break;
                        case "text":
                            if (json[i] == '"') {
                                if (!TryReadString(json, ref i, out text)) return false;
                                hasTextString = true;
                            } else if (!SkipValue(json, ref i)) return false;
                            break;
                        case "x":
                            if (!TryReadNumberOrSkip(json, ref i, out x)) return false;
                            break;
                        case "scale":
                            if (!TryReadNumberOrSkip(json, ref i, out scale)) return false;
                            break;
                        default:
                            if (!SkipValue(json, ref i)) return false;
                            break;
                    }
                    i = SkipSpace(json, i);
                    if (i >= json.Length) return false;
                    if (json[i] == ',') {
                        i = SkipSpace(json, i + 1);
                        continue;
                    }
                    if (json[i] == '}') {
                        i++;
                        float pieceWidth = ComputePieceWidth(kind, arrow, icon, text, hasTextString, (float)scale);
                        if (pieceWidth >= 0f) {
                            mark = new RawMark { X = (float)x, Scale = (float)scale, PieceWidth = pieceWidth };
                            keep = true;
                        }
                        return true;
                    }
                    return false;
                }
                return false;
            }

            static bool TryReadNumberOrSkip(string json, ref int i, out double value) {
                value = 0;
                if (i >= json.Length) return false;
                char ch = json[i];
                if (ch != '-' && (ch < '0' || ch > '9')) return SkipValue(json, ref i);
                int start = i;
                while (i < json.Length) {
                    char c = json[i];
                    if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E') i++;
                    else break;
                }
                if (!double.TryParse(json.Substring(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
                    return false;
                value = double.IsNaN(parsed) || double.IsInfinity(parsed) ? 0 : parsed;
                return true;
            }

            static bool TryReadString(string json, ref int i, out string value) {
                value = "";
                if (i >= json.Length || json[i] != '"') return false;
                i++;
                var sb = new StringBuilder();
                while (i < json.Length) {
                    char ch = json[i++];
                    if (ch == '"') {
                        value = sb.ToString();
                        return true;
                    }
                    if (ch != '\\') {
                        sb.Append(ch);
                        continue;
                    }
                    if (i >= json.Length) return false;
                    char esc = json[i++];
                    switch (esc) {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u': {
                            if (i + 4 > json.Length) return false;
                            if (!ushort.TryParse(json.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out ushort code))
                                return false;
                            sb.Append((char)code);
                            i += 4;
                            break;
                        }
                        default:
                            return false;
                    }
                }
                return false;
            }

            static bool SkipValue(string json, ref int i) {
                i = SkipSpace(json, i);
                if (i >= json.Length) return false;
                char ch = json[i];
                if (ch == '"') return TryReadString(json, ref i, out _);
                if (ch == '{') {
                    i = SkipSpace(json, i + 1);
                    if (i < json.Length && json[i] == '}') { i++; return true; }
                    while (i < json.Length) {
                        if (!TryReadString(json, ref i, out _)) return false;
                        i = SkipSpace(json, i);
                        if (i >= json.Length || json[i] != ':') return false;
                        i++;
                        if (!SkipValue(json, ref i)) return false;
                        i = SkipSpace(json, i);
                        if (i >= json.Length) return false;
                        if (json[i] == ',') { i = SkipSpace(json, i + 1); continue; }
                        if (json[i] == '}') { i++; return true; }
                        return false;
                    }
                    return false;
                }
                if (ch == '[') {
                    i = SkipSpace(json, i + 1);
                    if (i < json.Length && json[i] == ']') { i++; return true; }
                    while (i < json.Length) {
                        if (!SkipValue(json, ref i)) return false;
                        i = SkipSpace(json, i);
                        if (i >= json.Length) return false;
                        if (json[i] == ',') { i = SkipSpace(json, i + 1); continue; }
                        if (json[i] == ']') { i++; return true; }
                        return false;
                    }
                    return false;
                }
                int start = i;
                while (i < json.Length) {
                    char c = json[i];
                    if (c == ',' || c == ']' || c == '}' || char.IsWhiteSpace(c)) break;
                    i++;
                }
                return i > start;
            }

            static int SkipSpace(string json, int i) {
                while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
                return i;
            }
        }
    }
}
