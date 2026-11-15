using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.CompilerServices;
using Metro.Build;

namespace Metro.View {
    /// <summary>A run point in document metres. A stair flight's half landing is at `z = -7.5`, so
    /// the run helpers cannot be integer-only.</summary>
    public readonly struct StationRunPoint {
        public readonly double X, Y, Z;
        public StationRunPoint(double x, double y, double z) { X = x; Y = y; Z = z; }

        /// <summary>True when every coordinate is a whole cell (`escalatorLandings` can shift by .5).</summary>
        public bool IsCell =>
            Math.Abs(X - Math.Round(X)) < 1e-9 &&
            Math.Abs(Y - Math.Round(Y)) < 1e-9 &&
            Math.Abs(Z - Math.Round(Z)) < 1e-9;

        public override string ToString() =>
            X.ToString("0.###", CultureInfo.InvariantCulture) + "," +
            Y.ToString("0.###", CultureInfo.InvariantCulture) + "," +
            Z.ToString("0.###", CultureInfo.InvariantCulture);
    }

    /// <summary>One straight segment of a stair (`StairFlight` in `sim/types.ts`).</summary>
    public readonly struct StationStairFlight {
        public readonly StationRunPoint From, To;
        public StationStairFlight(StationRunPoint from, StationRunPoint to) { From = from; To = to; }
    }

    /// <summary>
    /// The run-family geometry the fence connection index and the exit opening both read:
    /// ports of `sim/stairs.ts` (`stairTreadWidth`, `stairFlights`, `stairFlightSlides`),
    /// `sim/escalators.ts` (`escalatorWidthOf`, `escalatorBodyWidth`, `escalatorRun`,
    /// `escalatorLandings`) and the `runTop` / `exitRunHalf` halves of `sim/exits.ts`.
    ///
    /// RCA 15 §4. `VerticalModuleViews` owns its own private copies of the stair-slide math
    /// (it builds the treads); they cannot be shared across the assembly boundary, so this
    /// file ports the same rules from the TypeScript oracle and each is pinned by its own
    /// fixture. Nothing here reads engine types.
    /// </summary>
    public static class StationRunGeometry {
        /// <summary>`ESCALATOR_BAND` (`sim/constants.ts`): the clear step band of the 窄 piece.</summary>
        public const double EscalatorBand = .68;
        /// <summary>`ESCALATOR_BALUSTRADE`: the 窄 piece's overall body width.</summary>
        public const double EscalatorBalustrade = .82;
        /// <summary>`ESCALATOR_SKIRT_INSET` (`sim/constants.ts`).</summary>
        public const double EscalatorSkirtInset = .08;
        /// <summary>`ESCALATOR_CASING_PROUD` (`sim/constants.ts`).</summary>
        public const double EscalatorCasingProud = .08;
        /// <summary>`STAIR_RAIL_PROUD` (`sim/constants.ts`).</summary>
        public const double StairRailProud = .105;

        static readonly double[] StairWidths = { EscalatorBand, 2 * EscalatorBand, 3 * EscalatorBand };

        public static int NormRot(int rot) => StationFootprints.NormRot(rot);

        /// <summary>Port of `track.rotateLocal`: local (i, j) turned into document offsets.</summary>
        public static void RotateLocal(int rot, double i, double j, out double x, out double y) =>
            StationFootprints.RotateLocal(rot, i, j, out x, out y);

        /// <summary>Port of `escalatorWidthOf`: 1–3, and an older save without one is 窄.</summary>
        public static int EscalatorWidth(ModuleFacts m) {
            int width = (int)Math.Round(m.Config.Number("width", 1));
            return width == 3 ? 3 : width == 2 ? 2 : 1;
        }

        /// <summary>Port of `escalatorBodyWidth`: the balustrade plus one metre per extra lane.</summary>
        public static double EscalatorBodyWidth(ModuleFacts m) => EscalatorBalustrade + (EscalatorWidth(m) - 1);

        /// <summary>Port of `escalatorBandWidth`: clear moving step band between skirts.</summary>
        public static double EscalatorBandWidth(ModuleFacts m) => EscalatorBand + (EscalatorWidth(m) - 1) - 2 * EscalatorSkirtInset;

        /// <summary>Port of `escalatorBalustradeWidth`: clear glass spacing inside the casing.</summary>
        public static double EscalatorBalustradeWidth(ModuleFacts m) => EscalatorBodyWidth(m) - 2 * EscalatorSkirtInset;

        /// <summary>Port of `stairTreadTrim` (`sim/stairs.ts`).</summary>
        public static double StairTreadTrim(double run) => Math.Min(.5, Math.Max(0, (run - .4) * .5));

        /// <summary>Port of `escalatorRun`: the lane-1 endpoints shifted to the run's centre.</summary>
        public static void EscalatorRun(ModuleFacts m, out StationRunPoint from, out StationRunPoint to) {
            var a = new StationRunPoint(m.From.X, m.From.Y, m.From.Z);
            var b = new StationRunPoint(m.To.X, m.To.Y, m.To.Z);
            if (!m.From.HasValue || !m.To.HasValue) { from = a; to = b; return; }
            bool lowerFirst = m.From.Z != m.To.Z
                ? m.From.Z < m.To.Z
                : m.From.X != m.To.X
                    ? m.From.X < m.To.X
                    : m.From.Y < m.To.Y;
            var lower = lowerFirst ? a : b;
            var upper = lowerFirst ? b : a;
            double len = Math.Sqrt(Sq(upper.X - lower.X) + Sq(upper.Y - lower.Y));
            double half = len > 0 ? (EscalatorWidth(m) - 1) * .5 / len : 0;
            double dx = (upper.Y - lower.Y) * half;
            double dy = -(upper.X - lower.X) * half;
            from = new StationRunPoint(a.X + dx, a.Y + dy, a.Z);
            to = new StationRunPoint(b.X + dx, b.Y + dy, b.Z);
        }

        /// <summary>Port of <c>escalatorInclineRun</c> (<c>sim/escalators.ts</c>): exact incline inside
        /// integer landing cells; the remainder forms flat terminal tracks.</summary>
        public static void EscalatorInclineRun(ModuleFacts m, out StationRunPoint from, out StationRunPoint to, out double inset, double landingRiseDelta = 0) {
            EscalatorRun(m, out var runFrom, out var runTo);
            inset = 0;
            if (m == null || !string.Equals(m.Type, "escalator", StringComparison.Ordinal)) {
                from = runFrom;
                to = runTo;
                return;
            }
            double angle = m.Config.Number("incline", 30);
            if (angle == 0) {
                from = runFrom;
                to = runTo;
                return;
            }
            double dx = runTo.X - runFrom.X;
            double dy = runTo.Y - runFrom.Y;
            double horizontal = Math.Sqrt(Sq(dx) + Sq(dy));
            if (horizontal <= 1e-9) {
                from = runFrom;
                to = runTo;
                return;
            }
            double inclineRun = Math.Abs(runTo.Z - runFrom.Z + landingRiseDelta) / Math.Tan(angle * Math.PI / 180.0);
            inset = Math.Max(0, (horizontal - inclineRun) * 0.5);
            from = new StationRunPoint(runFrom.X + dx / horizontal * inset, runFrom.Y + dy / horizontal * inset, runFrom.Z);
            to = new StationRunPoint(runTo.X - dx / horizontal * inset, runTo.Y - dy / horizontal * inset, runTo.Z);
        }

        /// <summary>
        /// Port of `escalatorLandings`, which `walkwayLandings` also returns. A width-2/3 run adds
        /// one pair per extra lane, and those pairs are **fractional** cells: the fence index only
        /// ever queries whole cells, so only whole landings can ever match (`IsCell`).
        /// </summary>
        public static List<StationRunPoint> EscalatorLandings(ModuleFacts m) {
            var outPoints = new List<StationRunPoint>(8);
            if (!m.From.HasValue || !m.To.HasValue) {
                outPoints.Add(new StationRunPoint(m.X, m.Y, m.Z));
                return outPoints;
            }
            int width = EscalatorWidth(m);
            var from = new StationRunPoint(m.From.X, m.From.Y, m.From.Z);
            var to = new StationRunPoint(m.To.X, m.To.Y, m.To.Z);
            if (width == 1) { outPoints.Add(from); outPoints.Add(to); return outPoints; }
            EscalatorRun(m, out var runFrom, out var runTo);
            double dx = 2 * (runFrom.X - from.X) / (width - 1);
            double dy = 2 * (runFrom.Y - from.Y) / (width - 1);
            outPoints.Add(from);
            outPoints.Add(to);
            for (int lane = 1; lane < width; lane++) {
                outPoints.Add(new StationRunPoint(from.X + dx * lane, from.Y + dy * lane, from.Z));
                outPoints.Add(new StationRunPoint(to.X + dx * lane, to.Y + dy * lane, to.Z));
            }
            return outPoints;
        }

        /// <summary>Port of `stairTreadWidth` (§5.1): a straight catalogue stair fills its blocks less
        /// the two outer balustrades; a turning or block piece keeps its stored width.</summary>
        public static double StairTreadWidth(ModuleFacts m) {
            double width = m.Config.Number("width", EscalatorBand);
            int size = -1;
            for (int i = 0; i < StairWidths.Length; i++) if (Math.Abs(StairWidths[i] - width) < 1e-6) { size = i; break; }
            return !m.Config.Bool("block") && StairFlights(m).Count == 1 && size >= 0
                ? size + 1 - 2 * StairRailProud
                : width;
        }

        public static int StairRunBlocks(double width) =>
            Math.Max(1, Math.Min(3, (int)Math.Round(width + 2 * StairRailProud)));

        public static bool StairOnBlockGrid(double width) =>
            Math.Abs(width + 2 * StairRailProud - StairRunBlocks(width)) < 1e-6;

        static double StairReturnSlide(double offset, double width) {
            double step = offset - (width + 2 * StairRailProud);
            double limit = Math.Max(0, width * .5 - .25);
            return Math.Max(0, Math.Min(step, limit));
        }

        /// <summary>Port of `stairFlights`: `cfg.flights` when the save authored a turn, else the
        /// single implied run `from → to`.</summary>
        public static List<StationStairFlight> StairFlights(ModuleFacts m) {
            var authored = ParseFlights(m.Config.Json("flights"));
            if (authored.Count > 0) return authored;
            var outFlights = new List<StationStairFlight>(1);
            if (m.From.HasValue && m.To.HasValue) {
                outFlights.Add(new StationStairFlight(
                    new StationRunPoint(m.From.X, m.From.Y, m.From.Z),
                    new StationRunPoint(m.To.X, m.To.Y, m.To.Z)));
            }
            return outFlights;
        }

        /// <summary>
        /// The authored `cfg.flights` list. The facts layer keeps nested config as its own JSON, and
        /// `Metro.View` cannot use Newtonsoft, so this reads the one shape a stair writes —
        /// `[{from:{x,y,z},to:{x,y,z}},…]` — by taking each `"x"`/`"y"`/`"z"` value in document
        /// order. A list that does not hold whole triples is ignored (the caller falls back to
        /// `from`/`to`), which is also how a save that authored nothing reads.
        /// </summary>
        static List<StationStairFlight> ParseFlights(string json) {
            var outFlights = new List<StationStairFlight>(4);
            if (string.IsNullOrEmpty(json)) return outFlights;
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
            if (count == 0 || values.Count % 6 != 0) return outFlights;
            for (int i = 0; i < count; i++) {
                int at = i * 6;
                outFlights.Add(new StationStairFlight(
                    new StationRunPoint(values[at], values[at + 1], values[at + 2]),
                    new StationRunPoint(values[at + 3], values[at + 4], values[at + 5])));
            }
            return outFlights;
        }

        /// <summary>
        /// Port of `stairFlightSlides`: how far each flight's tread band is slid across its walking
        /// line so a block-grid run fills whole blocks. The fence index reads the band, so a
        /// switchback's returning flight lands on the cells its handrail really stands in.
        /// </summary>
        public static List<StationRunPoint> StairFlightSlides(ModuleFacts m, List<StationStairFlight> flights) {
            var slides = new List<StationRunPoint>(flights.Count);
            for (int i = 0; i < flights.Count; i++) slides.Add(new StationRunPoint(0, 0, 0));
            double width = m.Config.Number("width", EscalatorBand);
            if (flights.Count == 0) return slides;
            if (flights.Count > 2) {
                double grid = StationOnGrid(width);
                if (grid == 0) return slides;
                for (int i = 0; i < flights.Count; i++) {
                    double dx = flights[i].To.X - flights[i].From.X;
                    double dy = flights[i].To.Y - flights[i].From.Y;
                    double run = Math.Sqrt(Sq(dx) + Sq(dy));
                    if (run < 1e-6) continue;
                    slides[i] = new StationRunPoint(Z(dy / run * grid), Z(-dx / run * grid), 0);
                }
                return slides;
            }
            if (flights.Count == 1) {
                double grid = StationOnGrid(StairTreadWidth(m));
                if (grid == 0) return slides;
                var f = flights[0];
                var lower = f.From.Z <= f.To.Z ? f.From : f.To;
                var upper = f.From.Z <= f.To.Z ? f.To : f.From;
                double dx = upper.X - lower.X;
                double dy = upper.Y - lower.Y;
                double run = Math.Sqrt(Sq(dx) + Sq(dy));
                if (run < 1e-6) return slides;
                slides[0] = new StationRunPoint(Z(dy / run * grid), Z(-dx / run * grid), 0);
                return slides;
            }
            var first = flights[0];
            var second = flights[1];
            double firstRun = Math.Sqrt(Sq(first.To.X - first.From.X) + Sq(first.To.Y - first.From.Y));
            if (firstRun < 1e-6) return slides;
            double ux = (first.To.X - first.From.X) / firstRun;
            double uy = (first.To.Y - first.From.Y) / firstRun;
            double grid2 = StationOnGrid(width);
            double d2x = second.To.X - second.From.X;
            double d2y = second.To.Y - second.From.Y;
            // A 90° turn: the legs are perpendicular, so each band grows across its own run.
            if (d2x * ux + d2y * uy == 0) {
                double hand = d2x * uy - d2y * ux >= 0 ? 1 : -1;
                slides[0] = new StationRunPoint(Z(uy * grid2 * hand), Z(-ux * grid2 * hand), 0);
                slides[1] = new StationRunPoint(Z(ux * grid2), Z(uy * grid2), 0);
                return slides;
            }
            double rx = second.From.X - first.From.X;
            double ry = second.From.Y - first.From.Y;
            double across = rx * -uy + ry * ux;
            double slide = StairReturnSlide(Math.Abs(across), width);
            double side = across == 0 ? 0 : across > 0 ? -1 : 1;
            slides[0] = new StationRunPoint(Z(uy * grid2), Z(-ux * grid2), 0);
            slides[1] = new StationRunPoint(Z(uy * grid2 - uy * side * slide), Z(-ux * grid2 + ux * side * slide), 0);
            return slides;
        }

        static double StationOnGrid(double width) => StairOnBlockGrid(width) ? (StairRunBlocks(width) - 1) * .5 : 0;

        /// <summary>Normalise -0 to 0, so a caller's arithmetic matches the source's printed values.</summary>
        static double Z(double value) => value == 0 ? 0 : value;

        /// <summary>
        /// Port of `runTop` (`sim/exits.ts`): the upper landing of a run, shifted onto the lane the
        /// run's body is centred on. Null for a module that is not a stair/escalator/lift.
        /// </summary>
        public static StationRunPoint? RunTop(ModuleFacts run) {
            if (run == null) return null;
            if (run.Type == "escalator") {
                EscalatorRun(run, out var from, out var to);
                return from.Z >= to.Z ? from : to;
            }
            if (run.Type == "stair") {
                if (!run.From.HasValue || !run.To.HasValue) return null;
                bool fromIsTop = run.From.Z >= run.To.Z;
                var top = fromIsTop ? run.From : run.To;
                var flights = StairFlights(run);
                var slides = StairFlightSlides(run, flights);
                int index = fromIsTop ? 0 : slides.Count - 1;
                var slide = index >= 0 && index < slides.Count ? slides[index] : default;
                return new StationRunPoint(top.X + slide.X, top.Y + slide.Y, top.Z);
            }
            if (run.Type == "lift") {
                if (!run.From.HasValue || !run.To.HasValue) return null;
                var top = run.From.Z >= run.To.Z ? run.From : run.To;
                return new StationRunPoint(top.X, top.Y, top.Z);
            }
            return null;
        }

        /// <summary>Port of `exitRunHalf`: the half-width of the wellway one run opens, its own
        /// block or its swept width plus the casing/rail it stands proud by.</summary>
        public static double ExitRunHalf(ModuleFacts run) {
            double swept = 0;
            switch (run.Type) {
                case "escalator": swept = EscalatorBodyWidth(run) / 2 + EscalatorCasingProud; break;
                case "stair": swept = StairTreadWidth(run) / 2 + StairRailProud; break;
                case "lift": swept = LiftSize(run) / 2.0; break;
            }
            return Math.Max(.5, swept);
        }

        /// <summary>Port of `liftSizeOf`: 3 for the large shaft, 2 otherwise.</summary>
        public static int LiftSize(ModuleFacts lift) {
            int size = (int)Math.Round(lift.Config.Number("size", 2));
            return size == 3 ? 3 : 2;
        }

        static double Sq(double v) => v * v;
    }

    /// <summary>
    /// Document-space port of `fenceConnectionIndex` (`game/src/sim/fences.ts`), the lookup a fence
    /// panel is built from (RCA 15 §4).
    ///
    /// One pass over the saved modules builds three lookups — fences by cell, gates by cell, and
    /// the rail landings a fence run may butt into (a stair's full-width band, an escalator's or
    /// walkway's own landings) — so a cell's four questions cost four lookups, not a scan. A
    /// neighbour counts when it holds a fence, a rail landing, or a gate whose **machine** body
    /// faces that way (`gateSolidFaces`): the lane side is a doorway the run must end at.
    ///
    /// Every sub-rule of the source is ported. The one that is **not** covered here is the
    /// preview overlay (`previewCandidates` in `modelNeighbours`): a document index cannot see an
    /// uncommitted hover piece, so the edit-time preview keeps its own small index over this one.
    /// </summary>
    public sealed class StationFenceConnections {
        public static readonly StationFenceConnections Empty = new StationFenceConnections(null);

        static readonly ConditionalWeakTable<object, StationFenceConnections> Cache =
            new ConditionalWeakTable<object, StationFenceConnections>();

        readonly Dictionary<long, List<ModuleFacts>> fences;
        readonly Dictionary<long, List<ModuleFacts>> gates;
        readonly HashSet<long> landings;

        StationFenceConnections(IReadOnlyList<ModuleFacts> modules) {
            fences = new Dictionary<long, List<ModuleFacts>>();
            gates = new Dictionary<long, List<ModuleFacts>>();
            landings = new HashSet<long>();
            if (modules == null) return;
            for (int i = 0; i < modules.Count; i++) {
                var m = modules[i];
                if (m == null) continue;
                switch (m.Type) {
                    case "fence":
                        Add(fences, m);
                        break;
                    case "gate":
                        Add(gates, m);
                        break;
                    case "stair":
                        if (m.Config.Bool("block")) break;
                        AddStairLandings(m);
                        break;
                    case "escalator":
                    case "walkway":
                        foreach (var point in StationRunGeometry.EscalatorLandings(m))
                            if (point.IsCell) landings.Add(Key((int)Math.Round(point.X), (int)Math.Round(point.Y), (int)Math.Round(point.Z)));
                        break;
                }
            }
        }

        /// <summary>The document-level index, built once per module list and reused.</summary>
        public static StationFenceConnections For(IReadOnlyList<ModuleFacts> modules) {
            if (modules == null) return Empty;
            if (Cache.TryGetValue(modules, out var cached)) return cached;
            var built = new StationFenceConnections(modules);
            Cache.Add(modules, built);
            return built;
        }

        /// <summary>The same index for a parsed document, built once per document and reused.</summary>
        public static StationFenceConnections ForDocument(StationDocument document) {
            if (document == null) return Empty;
            if (Cache.TryGetValue(document, out var cached)) return cached;
            var facts = new ModuleFacts[document.Modules.Count];
            int count = 0;
            for (int i = 0; i < document.Modules.Count; i++) {
                var record = document.Modules[i];
                if (record?.Facts != null) facts[count++] = record.Facts;
            }
            if (count != facts.Length) Array.Resize(ref facts, count);
            var built = For(facts);
            Cache.Add(document, built);
            return built;
        }

        public int FenceModules {
            get {
                int count = 0;
                foreach (var pair in fences) count += pair.Value.Count;
                return count;
            }
        }

        public int GateModules {
            get {
                int count = 0;
                foreach (var pair in gates) count += pair.Value.Count;
                return count;
            }
        }

        public int LandingCells => landings.Count;

        /// <summary>`fencesAt`: every fence saved on the cell.</summary>
        public IReadOnlyList<ModuleFacts> FencesAt(int x, int y, int z) =>
            fences.TryGetValue(Key(x, y, z), out var list) ? list : Array.Empty<ModuleFacts>();

        /// <summary>`railLandingAt`: a stair/escalator/walkway landing stands on the cell.</summary>
        public bool HasRailLanding(int x, int y, int z) => landings.Contains(Key(x, y, z));

        /// <summary>
        /// `connects`: whether the neighbour cell `(x,y,z)` holds something a panel may meet, read
        /// from the **fence's** side. `dx, dy` is the direction from the neighbour back to the fence
        /// being drawn, which is the step `gateSolidFaces` reads.
        /// </summary>
        public bool Connects(int x, int y, int z, int dx, int dy, string excludeId = null) {
            long k = Key(x, y, z);
            if (fences.TryGetValue(k, out var at)) {
                for (int i = 0; i < at.Count; i++) if (Kept(at[i], excludeId)) return true;
            }
            if (landings.Contains(k)) return true;
            if (gates.TryGetValue(k, out var gateList)) {
                for (int i = 0; i < gateList.Count; i++) {
                    var gate = gateList[i];
                    if (Kept(gate, excludeId) && GateSolidFaces(gate, dx, dy)) return true;
                }
            }
            return false;
        }

        /// <summary>The four same-level sides of a fence cell, exactly the `FenceNeighbours` the
        /// source's `FenceModel.build` passes to `fenceArms`.</summary>
        public void Sides(ModuleFacts fence, out bool east, out bool west, out bool north, out bool south) {
            east = west = north = south = false;
            if (fence == null) return;
            east = Connects(fence.X + 1, fence.Y, fence.Z, -1, 0);
            west = Connects(fence.X - 1, fence.Y, fence.Z, 1, 0);
            north = Connects(fence.X, fence.Y + 1, fence.Z, 0, -1);
            south = Connects(fence.X, fence.Y - 1, fence.Z, 0, 1);
        }

        /// <summary>Port of `gateHasLane` / `gateDoorOf`: only a working lane gate is open on one
        /// side; a fence (`fence`, or the old `none`) machine is solid all round.</summary>
        public static bool GateHasLane(ModuleFacts gate) {
            var door = gate.Config.Text("door");
            return !(string.Equals(door, "fence", StringComparison.Ordinal) || string.Equals(door, "none", StringComparison.Ordinal));
        }

        /// <summary>
        /// Port of `gateSolidFaces`: may a run butt into the gate's machine at the step
        /// `(dx, dy)`? The machine body stands on the gate's local −x half, so exactly one side is
        /// solid; a doorless gate presents a solid face on every side.
        /// </summary>
        public static bool GateSolidFaces(ModuleFacts gate, int dx, int dy) {
            if (!GateHasLane(gate)) return true;
            StationFootprints.RotateLocal(gate.Rotation, -1, 0, out var sx, out var sy);
            return (int)Math.Round(sx) == dx && (int)Math.Round(sy) == dy;
        }

        static bool Kept(ModuleFacts module, string excludeId) =>
            string.IsNullOrEmpty(excludeId) || !string.Equals(module.Id, excludeId, StringComparison.Ordinal);

        void Add(Dictionary<long, List<ModuleFacts>> map, ModuleFacts module) {
            long k = Key(module.X, module.Y, module.Z);
            if (!map.TryGetValue(k, out var list)) map[k] = list = new List<ModuleFacts>(1);
            list.Add(module);
        }

        /// <summary>
        /// The stair branch of the index: every cell of the band each flight draws at its **two**
        /// ends (a rail landing is where the balustrade reaches, not a stepped guess to the right of
        /// the run). Read through `stairFlightSlides` so a turning stair's returning leg, slid the
        /// other way, is covered too.
        /// </summary>
        void AddStairLandings(ModuleFacts stair) {
            double width = StationRunGeometry.StairTreadWidth(stair);
            var flights = StationRunGeometry.StairFlights(stair);
            if (flights.Count == 0) return;
            var slides = StationRunGeometry.StairFlightSlides(stair, flights);
            for (int i = 0; i < flights.Count; i++) {
                var flight = flights[i];
                double runDx = flight.To.X - flight.From.X;
                double runDy = flight.To.Y - flight.From.Y;
                if (runDx == 0 && runDy == 0) {
                    AddLanding(flight.From);
                    continue;
                }
                var slide = i < slides.Count ? slides[i] : default;
                bool acrossX = Math.Abs(runDx) < Math.Abs(runDy);
                AddBand(flight.From, slide, acrossX, width);
                AddBand(flight.To, slide, acrossX, width);
            }
        }

        void AddBand(StationRunPoint point, StationRunPoint slide, bool acrossX, double width) {
            if (acrossX) {
                double centre = point.X + .5 + slide.X;
                int lo = (int)Math.Floor(centre - width / 2 + 1e-9);
                int hi = (int)Math.Ceiling(centre + width / 2 - 1e-9) - 1;
                for (int x = lo; x <= hi; x++) AddLanding(new StationRunPoint(x, point.Y, point.Z));
            } else {
                double centre = point.Y + .5 + slide.Y;
                int lo = (int)Math.Floor(centre - width / 2 + 1e-9);
                int hi = (int)Math.Ceiling(centre + width / 2 - 1e-9) - 1;
                for (int y = lo; y <= hi; y++) AddLanding(new StationRunPoint(point.X, y, point.Z));
            }
        }

        void AddLanding(StationRunPoint point) {
            // A band cell is whole by construction; the guard keeps a malformed flight out rather
            // than inventing a fractional key no fence query could ever match.
            if (!point.IsCell) return;
            landings.Add(Key((int)Math.Round(point.X), (int)Math.Round(point.Y), (int)Math.Round(point.Z)));
        }

        static long Key(int x, int y, int z) =>
            ((long)(x & 0x1FFFFF) << 42) | ((long)(y & 0x1FFFFF) << 21) | (long)(z & 0x1FFFFF);
    }

    /// <summary>One arm of a tactile tile, in the tile's own frame (`dx`/`dy` are −1, 0 or 1).</summary>
    public readonly struct StationTactileArm {
        public readonly int DX, DY;
        public StationTactileArm(int dx, int dy) { DX = dx; DY = dy; }
        public override string ToString() => "(" + DX + "," + DY + ")";
    }

    /// <summary>
    /// Document-space port of `tactileArms` (`game/src/sim/floorDecor.ts`, RCA 15 §4).
    ///
    /// A warning square reaches every connected neighbour, so an L, T or cross needs no separate
    /// tile; a warning strip already covers both ends of its own run, so it only grows a crosswise
    /// arm, and only toward a neighbour whose band really crosses the shared edge. The result is in
    /// the tile's **own** frame: the source rotates the world step back by the tile's rotation
    /// (`rotateLocal(-rot, dx, dy)`) before handing the arm to the model.
    ///
    /// Only `warning` and `warning-strip` consume this: `TactileModel.build` never calls it for a
    /// `guide` (its ribs already run the length of the band), so a guide tile must not grow one.
    /// </summary>
    public static class StationTactileArms {
        static readonly int[,] Steps = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } };

        /// <summary>True for the variants whose geometry the arm rule shapes.</summary>
        public static bool Applies(ModuleFacts tactile) {
            if (tactile == null || !string.Equals(tactile.Type, "tactile", StringComparison.Ordinal)) return false;
            var variant = tactile.Config.Text("variant");
            return string.Equals(variant, "warning", StringComparison.Ordinal) ||
                   string.Equals(variant, "warning-strip", StringComparison.Ordinal);
        }

        /// <summary>`tactileArms`: the local one-cell steps this tile grows an arm along.</summary>
        public static List<StationTactileArm> Arms(ModuleFacts tactile, IReadOnlyList<ModuleFacts> station) {
            var arms = new List<StationTactileArm>(4);
            if (!Applies(tactile) || station == null) return arms;
            bool strip = string.Equals(tactile.Config.Text("variant"), "warning-strip", StringComparison.Ordinal);
            for (int i = 0; i < Steps.GetLength(0); i++) {
                int dx = Steps[i, 0], dy = Steps[i, 1];
                var neighbour = TactileAt(station, tactile.X + dx, tactile.Y + dy, tactile.Z);
                if (neighbour == null) continue;
                bool junction = string.Equals(neighbour.Config.Text("variant"), "warning", StringComparison.Ordinal);
                // A band crosses the shared edge only along its own spine; a junction square
                // reaches every edge with its own arm.
                bool continues = StationRunGeometry.NormRot(neighbour.Rotation) % 2 == 0 ? dy == 0 : dx == 0;
                if (strip ? junction || !continues : !junction && !continues) continue;
                StationFootprints.RotateLocal(-tactile.Rotation, dx, dy, out var lx, out var ly);
                // The strip's own one-metre top already covers the run's shared edges.
                if (strip && Math.Abs(ly) < 1e-9) continue;
                arms.Add(new StationTactileArm((int)Math.Round(lx), (int)Math.Round(ly)));
            }
            return arms;
        }

        /// <summary>The first saved tactile on the cell — the source's `find`, in document order.</summary>
        public static ModuleFacts TactileAt(IReadOnlyList<ModuleFacts> station, int x, int y, int z) {
            if (station == null) return null;
            for (int i = 0; i < station.Count; i++) {
                var m = station[i];
                if (m == null || !string.Equals(m.Type, "tactile", StringComparison.Ordinal)) continue;
                if (m.X == x && m.Y == y && m.Z == z) return m;
            }
            return null;
        }
    }

    /// <summary>One floor strip of an exit head-house, in the exit's own metres: the plan is
    /// `x` across the bays and `y` along the run, with the mouth at −y.</summary>
    public readonly struct StationExitPad {
        public readonly double X, Y, Width, Length, Height;
        public StationExitPad(double x, double y, double width, double length, double height) {
            X = x; Y = y; Width = width; Length = length; Height = height;
        }
        public override string ToString() =>
            "pad(" + X.ToString("0.###", CultureInfo.InvariantCulture) + "," + Y.ToString("0.###", CultureInfo.InvariantCulture) +
            " " + Width.ToString("0.###", CultureInfo.InvariantCulture) + "x" + Length.ToString("0.###", CultureInfo.InvariantCulture) +
            " h" + Height.ToString("0.###", CultureInfo.InvariantCulture) + ")";
    }

    /// <summary>One run's wellway in a head-house floor (`ExitRunOpening` in `sim/exits.ts`).</summary>
    public readonly struct StationExitRunOpening {
        /// <summary>Local x of the wellway: the run column, in exit metres from the anchor cell centre.</summary>
        public readonly double Column;
        /// <summary>Local y of the run's upper landing; usually 0, but a saved exit can be offset.</summary>
        public readonly double Row;
        /// <summary>Half-width the run needs (`exitRunHalf`), its own block or its swept width.</summary>
        public readonly double Half;
        /// <summary>True when the run in this column is an escalator: the source lets it own
        /// its deck, so its column alone is left open at the upper landing row.</summary>
        public readonly bool Escalator;
        public StationExitRunOpening(double column, double row, double half, bool escalator = false) {
            Column = column; Row = row; Half = half; Escalator = escalator;
        }
        public override string ToString() =>
            "run(" + Column.ToString("0.###", CultureInfo.InvariantCulture) + "," + Row.ToString("0.###", CultureInfo.InvariantCulture) +
            " ±" + Half.ToString("0.###", CultureInfo.InvariantCulture) + ")";
    }

    /// <summary>
    /// The shared exit opening description (RCA 15 §6): a document-space port of
    /// `exitRunOpenings` and `exitLandingBack` from `game/src/sim/exits.ts`, plus the floor strips
    /// `buildExit` lays between the runs (`sim/render/models/pieces/ExitModel.ts`).
    ///
    /// One description answers three consumers, so the head-house pad, the virtual ground and the
    /// street pavers cannot disagree: <see cref="Pads"/> is the pad geometry `BuildExit` draws,
    /// <see cref="IsWellwayCell"/> is the opening the cell mesher must leave in the street plane,
    /// and <see cref="CoversCell"/> is the plate the surface renderer's tiles must not be drawn
    /// under (`outdoorSurfaceHidden`). The exit's own level and rotation are honoured, so a turned
    /// two-bay fixture reports the same opening in world cells.
    /// </summary>
    public sealed class StationExitOpenings {
        /// <summary>`EXIT_BASE_HEIGHT` (`sim/exitLanding.ts`): the head-house plinth, metres.</summary>
        public const double BaseHeight = .25;
        /// <summary>`EXIT_BACK` (`sim/exits.ts`): canopy overhang past the street doorway, metres.</summary>
        public const double Back = 2.3;
        /// <summary>`EXIT_BACK_Y`: the back wall, local y (lands on the cell boundary at `y = −5`).</summary>
        public const double BackY = -5.5;

        readonly StationModuleRecord exit;
        readonly List<StationExitRunOpening> runs;
        readonly List<StationExitPad> pads;
        readonly List<StationExitPad> landings;

        StationExitOpenings(StationModuleRecord exitRecord, List<StationExitRunOpening> runOpenings,
            double padLo, double padHi, double width, double yHi, double landingBack, double corridorBackY,
            double upperEdge, List<StationExitPad> strips, List<StationExitPad> runLandings) {
            exit = exitRecord;
            runs = runOpenings;
            pads = strips;
            landings = runLandings;
            PadLo = padLo;
            PadHi = padHi;
            Width = width;
            YHi = yHi;
            LandingBack = landingBack;
            CorridorBack = corridorBackY;
            UpperEdge = upperEdge;
        }

        public StationModuleRecord Exit => exit;
        public IReadOnlyList<StationExitRunOpening> Runs => runs;
        /// <summary>The floor strips the head-house lays between the run columns, in exit-local
        /// metres (`null` for a doorway/virtual exit, which draws no head-house pad).</summary>
        public IReadOnlyList<StationExitPad> Pads => pads;
        /// <summary>
        /// The concrete top landings the source lays over a **non-escalator** run column
        /// (`buildExit`: "Stairs receive a concrete top landing; escalators own their deck").
        /// One 1 m square at the run's own row, so a stair's upper landing is floored while its
        /// descending corridor below stays open. Kept beside <see cref="Pads"/> rather than in it
        /// because these are per-run features of the same plate, and the two lists tile it with
        /// the wellway: base strips + landings + open columns = the whole plan.
        /// </summary>
        public IReadOnlyList<StationExitPad> LandingPads => landings;
        /// <summary>Local x the house is built around (`exitSpan.centre`).</summary>
        public double Centre { get; private set; }
        public double Half { get; private set; }
        public double PadLo { get; }
        public double PadHi { get; }
        public double Width { get; }
        /// <summary>Cell-aligned street edge, local y (`ceil(EXIT_BACK + 0.5) - 0.5`).</summary>
        public double YHi { get; }
        /// <summary>`exitLandingBack`: the street side of the wellway, advanced through offset tops.</summary>
        public double LandingBack { get; }
        /// <summary>The mouth-most row stays floored under the back rail (`EXIT_BACK_Y + 1`).</summary>
        public double CorridorBack { get; }
        /// <summary>The upper floor's street-side edge, one riser short of `YHi`.</summary>
        public double UpperEdge { get; }

        /// <summary>True when the exit is a street head-house (not a 地面 panel, not a 虚拟 pillar).</summary>
        public bool IsHeadHouse =>
            exit != null && exit.Config.Text("style") != "doorway" && exit.Config.Text("style") != "virtual";

        /// <summary>Port of `exitRunOpenings`, over the run families the renderer passes:
        /// `stair`, `escalator` and `walkway`. A lift is deliberately not opened — the source's only
        /// caller (`buildExit`) never passes one.</summary>
        public static StationExitOpenings For(IReadOnlyList<StationModuleRecord> modules, StationModuleRecord exitRecord) {
            if (exitRecord == null) return null;
            var runs = new List<StationExitRunOpening>();
            if (modules != null) {
                var seen = new HashSet<string>(StringComparer.Ordinal);
                for (int i = 0; i < modules.Count; i++) {
                    var run = modules[i];
                    if (run?.Facts == null) continue;
                    var type = run.Facts.Type;
                    if (!string.Equals(type, "stair", StringComparison.Ordinal) &&
                        !string.Equals(type, "escalator", StringComparison.Ordinal) &&
                        !string.Equals(type, "walkway", StringComparison.Ordinal)) continue;
                    var top = StationRunGeometry.RunTop(run.Facts);
                    if (!top.HasValue || Math.Abs(top.Value.Z - exitRecord.Facts.Z) > 1e-9) continue;
                    if (!Covers(exitRecord, top.Value.X, top.Value.Y)) continue;
                    ExitLocal(top.Value.X - exitRecord.Facts.X, top.Value.Y - exitRecord.Facts.Y, exitRecord.Rotation,
                        out var lx, out var ly);
                    var key = lx.ToString("0.###", CultureInfo.InvariantCulture) + "," + ly.ToString("0.###", CultureInfo.InvariantCulture);
                    if (!seen.Add(key)) continue;
                    runs.Add(new StationExitRunOpening(lx, ly, StationRunGeometry.ExitRunHalf(run.Facts),
                        string.Equals(type, "escalator", StringComparison.Ordinal)));
                }
            }
            runs.Sort((a, b) => a.Column != b.Column ? a.Column.CompareTo(b.Column) : a.Row.CompareTo(b.Row));

            bool headHouse = exitRecord.Config.Text("style") != "doorway" && exitRecord.Config.Text("style") != "virtual";
            double spanCentre = StationFootprints.ExitSpan(exitRecord).Centre;
            double spanHalf = StationFootprints.ExitSpan(exitRecord).Half;
            double width = spanHalf * 2;
            double yHi = Math.Ceiling(Back + .5) - .5; // the street edge is cell-aligned
            double landingBack = LandingBackOf(runs, yHi - .3);
            double corridorBackY = BackY + 1; // the mouth-most row keeps floor under the rail
            double stepDepth = .3;
            double upperEdge = yHi - stepDepth;

            var pads = new List<StationExitPad>();
            var landings = new List<StationExitPad>();
            if (headHouse) {
                double padLo = spanCentre - spanHalf;
                double padHi = spanCentre + spanHalf;
                pads.Add(new StationExitPad(spanCentre, (landingBack + upperEdge) / 2, width, upperEdge - landingBack, BaseHeight));
                pads.Add(new StationExitPad(spanCentre, yHi - stepDepth / 2, width, stepDepth, BaseHeight / 2));
                pads.Add(new StationExitPad(spanCentre, (BackY + corridorBackY) / 2, width, corridorBackY - BackY, BaseHeight));
                double stripLength = landingBack - corridorBackY;
                double stripY = (landingBack + corridorBackY) / 2;
                void Strip(double cx, double stripWidth) {
                    if (stripWidth > .02) pads.Add(new StationExitPad(cx, stripY, stripWidth, stripLength, BaseHeight));
                }
                double prev = padLo;
                for (int i = 0; i < runs.Count; i++) {
                    var run = runs[i];
                    Strip((prev + (run.Column - run.Half)) / 2, run.Column - run.Half - prev);
                    prev = Math.Max(prev, run.Column + run.Half);
                }
                Strip((prev + padHi) / 2, padHi - prev);
                // `buildExit`: every run that is not an escalator gets a concrete 1 m top
                // landing over its own column; an escalator owns its deck and stays open.
                for (int i = 0; i < runs.Count; i++) {
                    var run = runs[i];
                    if (run.Escalator) continue;
                    landings.Add(new StationExitPad(run.Column, run.Row, run.Half * 2, 1, BaseHeight));
                }
            }
            var description = new StationExitOpenings(exitRecord, runs, spanCentre - spanHalf, spanCentre + spanHalf,
                width, yHi, landingBack, corridorBackY, upperEdge, pads, landings) {
                Centre = spanCentre,
                Half = spanHalf,
            };
            return description;
        }

        /// <summary>`exitLandingBack`: the street-side edge of the wellway, never past `upperLimit`
        /// and never nearer the street than half a block.</summary>
        public static double LandingBackOf(IReadOnlyList<StationExitRunOpening> runOpenings, double upperLimit) {
            double back = .5;
            if (runOpenings != null) {
                for (int i = 0; i < runOpenings.Count; i++) back = Math.Max(back, runOpenings[i].Row + .5);
            }
            return Math.Min(upperLimit, back);
        }

        /// <summary>`exitCoversCell`: the cell lies under the head-house's floor plate.</summary>
        public bool CoversCell(int x, int y) => Covers(exit, x, y);

        /// <summary>
        /// True when the cell is under a run's wellway — the part of the plate that is **open**
        /// rather than floored: the run column's half-width, between the mouth row's inner edge and
        /// the street-side landing. This is the cell the street plane and the pavers must leave
        /// open, and the one the pad strips step around with the run's handrail clearance.
        /// </summary>
        public bool IsWellwayCell(int x, int y) {
            if (!IsHeadHouse || runs.Count == 0) return false;
            ExitLocal(x - exit.Facts.X, y - exit.Facts.Y, exit.Rotation, out var lx, out var ly);
            if (ly <= CorridorBack - 1e-9 || ly >= LandingBack - 1e-9) return false;
            for (int i = 0; i < runs.Count; i++) {
                var run = runs[i];
                if (Math.Abs(lx - run.Column) <= run.Half + 1e-9) return true;
            }
            return false;
        }

        /// <summary>Every wellway cell, in document order (`x`, then `y`).</summary>
        public List<StationCellKey> WellwayCells() {
            var cells = new List<StationCellKey>();
            var bounds = StationFootprints.ExitFloorBounds(exit);
            for (int x = (int)Math.Floor(bounds.X0); x < bounds.X1; x++) {
                for (int y = (int)Math.Floor(bounds.Y0); y < bounds.Y1; y++) {
                    if (IsWellwayCell(x, y)) cells.Add(new StationCellKey(x, y, exit.Facts.Z));
                }
            }
            return cells;
        }

        public override string ToString() {
            var text = "exit " + (exit?.Facts?.Id ?? "") + " " + runs.Count + " run(s)";
            for (int i = 0; i < runs.Count; i++) text += " " + runs[i];
            for (int i = 0; i < pads.Count; i++) text += " " + pads[i];
            return text;
        }

        static bool Covers(StationModuleRecord exitRecord, double x, double y) {
            var box = StationFootprints.ExitFloorBounds(exitRecord);
            return x + 1 > box.X0 && x < box.X1 && y + 1 > box.Y0 && y < box.Y1;
        }

        /// <summary>
        /// Port of `exitLocal`: a world plan offset in the exit's own frame. `StationFootprints`
        /// keeps `exitRotate` private, so the inverse is spelled here beside its caller; both match
        /// the source's `group.rotation.z = rot·π/2`.
        /// </summary>
        static void ExitLocal(double wx, double wy, int rot, out double lx, out double ly) {
            switch (StationRunGeometry.NormRot(rot)) {
                case 1: lx = wy; ly = -wx; break;
                case 2: lx = -wx; ly = -wy; break;
                case 3: lx = -wy; ly = wx; break;
                default: lx = wx; ly = wy; break;
            }
        }
    }
}
