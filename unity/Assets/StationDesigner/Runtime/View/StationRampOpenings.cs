using System;
using System.Collections.Generic;
using Metro.Build;

namespace Metro.View {
    /// <summary>
    /// Shared ramp-vs-ground derivations for the station renderer (RCA 24): pure document-space ports of
    /// <c>exitLandingHeight</c> (<c>sim/exitLanding.ts</c>), <c>rampSurfaceRetainsVolume</c>
    /// (<c>sim/rampSurface.ts</c>), <c>rampSlopeCuts</c>, <c>rampFillKeys</c>, <c>rampOpeningsInWindow</c>,
    /// <c>rampThinCells</c> (<c>sim/openings.ts</c>), and <c>stairLaneMates</c> (<c>sim/stairs.ts</c>).
    ///
    /// Derived surfaces remain separate from the committed <see cref="StationDocument"/>: solid blocks
    /// beneath runs retain their walkable graph nodes while the mesher shaves their top caps to the run's
    /// underside and opens virtual street corridors where ramps descend through grade.
    /// </summary>
    public static class StationRampOpenings {
        public const double ExitBaseHeight = StationExitOpenings.BaseHeight;
        public const double RampFoot = .5;
        public const double StairBodyDrop = .36;
        public const double Headroom = 1.3;
        public const double EscalatorHeadroom = 2.2;

        const double Eps = .02;
        const double ReachEps = 1e-6;
        const double EscalatorRailProud = .15;
        const double EscalatorCorridorHalf = StationRunGeometry.EscalatorBand * .5 + EscalatorRailProud;
        const int RampBucketSize = 16;

        public readonly struct StairLaneMate {
            public readonly ModuleFacts Mate;
            public readonly int StepX;
            public readonly int StepY;
            public readonly int Side;
            public readonly bool SameFlight;

            public StairLaneMate(ModuleFacts mate, int stepX, int stepY, int side, bool sameFlight) {
                Mate = mate;
                StepX = stepX;
                StepY = stepY;
                Side = side;
                SameFlight = sameFlight;
            }
        }

        public readonly struct RampThinCell {
            public readonly int X, Y, Z;
            public readonly StationWallSide Side;

            public RampThinCell(int x, int y, int z, StationWallSide side) {
                X = x; Y = y; Z = z; Side = side;
            }

            public StationCellKey Key => new StationCellKey(X, Y, Z);
        }

        internal struct RampSegment {
            public StationRunPoint From;
            public StationRunPoint To;
            public double Headroom;
            public double BodyHalf;
            public double RailHalf;
            public double CoreHalf;
            public double Sx;
            public double Sy;
            public HashSet<StationCellKey> GroundCells;
        }

        struct FlightTile {
            public int X, Y;
            public bool AlongX;
            public double A, B;
            public double Sx, Sy;
        }

        struct Point2 {
            public double X, Y;
            public Point2(double x, double y) { X = x; Y = y; }
        }

        struct LaneSpan {
            public int LowX, LowY, LowZ;
            public int HighX, HighY, HighZ;
            public int AxisX, AxisY;
            public string Flight;
        }

        public static List<ModuleFacts> ExtractFacts(IReadOnlyList<StationModuleRecord> modules) {
            var list = new List<ModuleFacts>(modules?.Count ?? 0);
            if (modules == null) return list;
            for (int i = 0; i < modules.Count; i++) {
                var record = modules[i];
                if (record?.Facts != null) list.Add(record.Facts);
            }
            return list;
        }

        /// <summary>Port of <c>exitCoversCell</c> (<c>sim/exits.ts</c>) over <see cref="ModuleFacts"/>.</summary>
        public static bool ExitCoversCell(ModuleFacts exit, double x, double y, double z) {
            if (exit == null || !string.Equals(exit.Type, "exit", StringComparison.Ordinal)) return false;
            if (Math.Abs(exit.Z - z) > 1e-9) return false;
            string style = exit.Config.Text("style");
            if (string.Equals(style, "virtual", StringComparison.Ordinal)) {
                return x + 1 > exit.X && x < exit.X + 1 && y + 1 > exit.Y && y < exit.Y + 1;
            }
            int baysRaw = (int)Math.Round(exit.Config.Number("bays", 2));
            int bays = baysRaw == 1 || baysRaw == 3 || baysRaw == 4 ? baysRaw : 2;
            double centre = (bays - 1) * .5;
            double half = (bays + 2) * .5;
            bool doorway = string.Equals(style, "doorway", StringComparison.Ordinal);
            double lo = centre - half, hi = centre + half;
            double backY = doorway ? -.5 : -5.5;
            double frontY = doorway ? .5 : 2.3;
            double cx = exit.X + .5, cy = exit.Y + .5;
            double x0 = double.PositiveInfinity, y0 = double.PositiveInfinity;
            double x1 = double.NegativeInfinity, y1 = double.NegativeInfinity;
            SpanCorners(lo, hi, backY, frontY, exit.Rotation, cx, cy, ref x0, ref y0, ref x1, ref y1);
            return x + 1 > x0 && x < x1 && y + 1 > y0 && y < y1;
        }

        static void SpanCorners(double lo, double hi, double backY, double frontY, int rot, double cx, double cy,
            ref double x0, ref double y0, ref double x1, ref double y1) {
            AccumulateExitCorner(lo, backY, rot, cx, cy, ref x0, ref y0, ref x1, ref y1);
            AccumulateExitCorner(hi, backY, rot, cx, cy, ref x0, ref y0, ref x1, ref y1);
            AccumulateExitCorner(lo, frontY, rot, cx, cy, ref x0, ref y0, ref x1, ref y1);
            AccumulateExitCorner(hi, frontY, rot, cx, cy, ref x0, ref y0, ref x1, ref y1);
        }

        static void AccumulateExitCorner(double lx, double ly, int rot, double cx, double cy,
            ref double x0, ref double y0, ref double x1, ref double y1) {
            double wx, wy;
            switch (StationRunGeometry.NormRot(rot)) {
                case 1: wx = -ly; wy = lx; break;
                case 2: wx = -lx; wy = -ly; break;
                case 3: wx = ly; wy = -lx; break;
                default: wx = lx; wy = ly; break;
            }
            if (cx + wx < x0) x0 = cx + wx;
            if (cx + wx > x1) x1 = cx + wx;
            if (cy + wy < y0) y0 = cy + wy;
            if (cy + wy > y1) y1 = cy + wy;
        }

        /// <summary>Port of <c>exitLandingHeight</c> (<c>sim/exitLanding.ts</c>).</summary>
        public static double ExitLandingHeight(IReadOnlyList<ModuleFacts> modules, double x, double y, double z) {
            if (modules == null) return 0;
            for (int i = 0; i < modules.Count; i++) {
                var m = modules[i];
                if (m == null || !string.Equals(m.Type, "exit", StringComparison.Ordinal)) continue;
                string style = m.Config.Text("style");
                if (string.Equals(style, "doorway", StringComparison.Ordinal) ||
                    string.Equals(style, "virtual", StringComparison.Ordinal)) continue;
                if (ExitCoversCell(m, x, y, z)) return ExitBaseHeight;
            }
            return 0;
        }

        public static double ExitLandingHeight(IReadOnlyList<ModuleFacts> modules, StationRunPoint p) =>
            ExitLandingHeight(modules, p.X, p.Y, p.Z);

        /// <summary>Port of <c>stairLaneMates</c> (<c>sim/stairs.ts</c>).</summary>
        public static List<StairLaneMate> StairLaneMates(IReadOnlyList<ModuleFacts> modules, ModuleFacts target) {
            var result = new List<StairLaneMate>();
            if (modules == null || target == null || !TryLaneSpan(target, out var mine)) return result;
            for (int i = 0; i < modules.Count; i++) {
                var other = modules[i];
                if (other == null || ReferenceEquals(other, target)) continue;
                if (!string.IsNullOrEmpty(target.Id) && string.Equals(other.Id, target.Id, StringComparison.Ordinal)) continue;
                if (!TryLaneSpan(other, out var theirs)) continue;
                if (theirs.LowZ != mine.LowZ || theirs.HighZ != mine.HighZ) continue;
                if (theirs.AxisX * mine.AxisX + theirs.AxisY * mine.AxisY == 0) continue;
                int dx = theirs.LowX - mine.LowX;
                int dy = theirs.LowY - mine.LowY;
                if (Math.Abs(dx) + Math.Abs(dy) != 1) continue;
                if (dx * mine.AxisX + dy * mine.AxisY != 0) continue;
                int cross = dx * mine.AxisY - dy * mine.AxisX;
                bool sameFlight = !string.IsNullOrEmpty(mine.Flight) &&
                    string.Equals(mine.Flight, theirs.Flight, StringComparison.Ordinal);
                result.Add(new StairLaneMate(other, dx, dy, cross > 0 ? 1 : -1, sameFlight));
            }
            return result;
        }

        static bool TryLaneSpan(ModuleFacts m, out LaneSpan span) {
            span = default;
            if (m == null || !string.Equals(m.Type, "stair", StringComparison.Ordinal)) return false;
            if (StationRunGeometry.StairTreadWidth(m) > 1.0 - 2.0 * StationRunGeometry.StairRailProud + 1e-9) return false;
            var flights = StationRunGeometry.StairFlights(m);
            if (flights.Count != 1) return false;
            var f = flights[0];
            if (Math.Abs(f.From.Z - f.To.Z) <= 1e-9) return false;
            if (!f.From.IsCell || !f.To.IsCell ||
                Math.Abs(f.From.Z - Math.Round(f.From.Z)) > 1e-6 ||
                Math.Abs(f.To.Z - Math.Round(f.To.Z)) > 1e-6) return false;
            int fx = (int)Math.Round(f.From.X), fy = (int)Math.Round(f.From.Y), fz = (int)Math.Round(f.From.Z);
            int tx = (int)Math.Round(f.To.X), ty = (int)Math.Round(f.To.Y), tz = (int)Math.Round(f.To.Z);
            int dx = tx - fx, dy = ty - fy;
            int ax, ay;
            if (dx != 0 && dy == 0) { ax = Math.Sign(dx); ay = 0; }
            else if (dy != 0 && dx == 0) { ax = 0; ay = Math.Sign(dy); }
            else return false;
            bool lowerFirst = fz < tz;
            span = new LaneSpan {
                LowX = lowerFirst ? fx : tx, LowY = lowerFirst ? fy : ty, LowZ = lowerFirst ? fz : tz,
                HighX = lowerFirst ? tx : fx, HighY = lowerFirst ? ty : fy, HighZ = lowerFirst ? tz : fz,
                AxisX = ax, AxisY = ay,
                Flight = m.Config.Text("flight"),
            };
            return true;
        }

        public static double RampCorridorHalf(ModuleFacts m) {
            if (m == null) return EscalatorCorridorHalf;
            if (string.Equals(m.Type, "stair", StringComparison.Ordinal))
                return StationRunGeometry.StairTreadWidth(m) * .5 + StationRunGeometry.StairRailProud;
            if (string.Equals(m.Type, "escalator", StringComparison.Ordinal) ||
                string.Equals(m.Type, "walkway", StringComparison.Ordinal))
                return StationRunGeometry.EscalatorBodyWidth(m) * .5 + StationRunGeometry.EscalatorCasingProud;
            return EscalatorCorridorHalf;
        }

        public static double RampBodyHalf(ModuleFacts m) {
            if (m == null) return StationRunGeometry.EscalatorBand * .5;
            if (string.Equals(m.Type, "stair", StringComparison.Ordinal))
                return StationRunGeometry.StairTreadWidth(m) * .5;
            if (string.Equals(m.Type, "escalator", StringComparison.Ordinal) ||
                string.Equals(m.Type, "walkway", StringComparison.Ordinal))
                return StationRunGeometry.EscalatorBandWidth(m) * .5;
            return StationRunGeometry.EscalatorBand * .5;
        }

        public static double RampLaneHalf(ModuleFacts m) {
            if (m == null) return .5;
            if (string.Equals(m.Type, "stair", StringComparison.Ordinal)) {
                double width = StationRunGeometry.StairTreadWidth(m);
                return StationRunGeometry.StairOnBlockGrid(width) ? StationRunGeometry.StairRunBlocks(width) * .5 : .5;
            }
            if (string.Equals(m.Type, "escalator", StringComparison.Ordinal) ||
                string.Equals(m.Type, "walkway", StringComparison.Ordinal))
                return StationRunGeometry.EscalatorWidth(m) * .5;
            return .5;
        }

        /// <summary>Port of <c>rampSurfaceRetainsVolume</c> (<c>sim/rampSurface.ts</c>).</summary>
        public static bool RampSurfaceRetainsVolume(IReadOnlyList<StationRampPatch> patches) {
            if (patches == null || patches.Count == 0) return true;
            var pieces = new List<List<Point2>> {
                new List<Point2> { new Point2(0, 0), new Point2(1, 0), new Point2(1, 1), new Point2(0, 1) },
            };
            for (int pIdx = 0; pIdx < patches.Count; pIdx++) {
                var p = patches[pIdx];
                if (p.HasBase && p.Base > 0) continue;
                var kept = new List<List<Point2>>();
                for (int polyIdx = 0; polyIdx < pieces.Count; polyIdx++) {
                    var inside = pieces[polyIdx];
                    for (int planeIdx = 0; planeIdx < 5; planeIdx++) {
                        var outside = ClipPolygon(inside, p, planeIdx, -1.0);
                        if (AnyNegative(inside, p, planeIdx) && HasPolygonArea(outside)) kept.Add(outside);
                        inside = ClipPolygon(inside, p, planeIdx, 1.0);
                        if (!HasPolygonArea(inside)) break;
                    }
                }
                pieces = kept;
                if (pieces.Count == 0) return false;
            }
            return pieces.Count > 0;
        }

        static double EvalPatchPlane(StationRampPatch p, int planeIndex, Point2 q) {
            switch (planeIndex) {
                case 0: return q.X - p.X0;
                case 1: return p.X1 - q.X;
                case 2: return q.Y - p.Y0;
                case 3: return p.Y1 - q.Y;
                default: return -(p.Lo + (p.Hi - p.Lo) * (p.Axis == 'x' ? q.X : q.Y));
            }
        }

        static bool AnyNegative(List<Point2> poly, StationRampPatch p, int planeIndex) {
            for (int i = 0; i < poly.Count; i++) {
                if (EvalPatchPlane(p, planeIndex, poly[i]) < -1e-10) return true;
            }
            return false;
        }

        static List<Point2> ClipPolygon(List<Point2> poly, StationRampPatch p, int planeIndex, double sign) {
            var result = new List<Point2>(poly.Count + 2);
            for (int i = 0; i < poly.Count; i++) {
                var a = poly[i];
                var b = poly[(i + 1) % poly.Count];
                double va = sign * EvalPatchPlane(p, planeIndex, a);
                double vb = sign * EvalPatchPlane(p, planeIndex, b);
                if (va >= 0) result.Add(a);
                if ((va > 0 && vb < 0) || (va < 0 && vb > 0)) {
                    double t = va / (va - vb);
                    result.Add(new Point2(a.X + t * (b.X - a.X), a.Y + t * (b.Y - a.Y)));
                }
            }
            return result;
        }

        static bool HasPolygonArea(List<Point2> poly) {
            if (poly == null || poly.Count < 3) return false;
            double twiceArea = 0;
            for (int i = 0; i < poly.Count; i++) {
                var a = poly[i];
                var b = poly[(i + 1) % poly.Count];
                twiceArea += a.X * b.Y - a.Y * b.X;
            }
            return Math.Abs(twiceArea) > 1e-10;
        }

        public static Dictionary<StationCellKey, StationSlopeCut> RampSlopeCuts(IReadOnlyList<StationModuleRecord> modules) =>
            RampSlopeCuts(ExtractFacts(modules));

        /// <summary>Port of <c>rampSlopeCuts</c> (<c>sim/openings.ts</c>).</summary>
        public static Dictionary<StationCellKey, StationSlopeCut> RampSlopeCuts(IReadOnlyList<ModuleFacts> modules) {
            var cuts = new Dictionary<StationCellKey, StationSlopeCut>();
            if (modules == null || modules.Count == 0) return cuts;

            var exits = new List<ModuleFacts>();
            var protect = new HashSet<(int x, int y)>();
            for (int i = 0; i < modules.Count; i++) {
                var m = modules[i];
                if (m == null) continue;
                if (string.Equals(m.Type, "exit", StringComparison.Ordinal)) {
                    exits.Add(m);
                    continue;
                }
                if (string.Equals(m.Type, "stair", StringComparison.Ordinal)) {
                    foreach (var p in StairLandings(m)) protect.Add((RoundCell(p.X), RoundCell(p.Y)));
                } else if (string.Equals(m.Type, "escalator", StringComparison.Ordinal)) {
                    double baseZ = Math.Min(m.From.Z, m.To.Z);
                    foreach (var p in StationRunGeometry.EscalatorLandings(m)) {
                        if (Math.Abs(p.Z - baseZ) <= 1e-9) protect.Add((RoundCell(p.X), RoundCell(p.Y)));
                    }
                }
            }

            for (int mIdx = 0; mIdx < modules.Count; mIdx++) {
                var m = modules[mIdx];
                if (m == null) continue;
                bool isStair = string.Equals(m.Type, "stair", StringComparison.Ordinal);
                bool isEscalator = string.Equals(m.Type, "escalator", StringComparison.Ordinal);
                if (!isStair && !isEscalator) continue;

                List<RampSegment> segs;
                if (isEscalator) {
                    if (!m.From.HasValue || !m.To.HasValue) continue;
                    double extraRise = ExitLandingHeight(exits, RunPt(m.To)) - ExitLandingHeight(exits, RunPt(m.From));
                    StationRunGeometry.EscalatorInclineRun(m, out var infFrom, out var infTo, out _, extraRise);
                    segs = new List<RampSegment>(1) {
                        new RampSegment {
                            From = infFrom, To = infTo,
                            BodyHalf = RampBodyHalf(m), RailHalf = RampCorridorHalf(m), CoreHalf = RampLaneHalf(m),
                        },
                    };
                } else {
                    segs = RampSegments(m);
                }
                if (segs == null || segs.Count == 0) continue;

                StationRunPoint? outerLow = isStair && m.From.HasValue && m.To.HasValue && Math.Abs(m.From.Z - m.To.Z) > 1e-9
                    ? (m.From.Z < m.To.Z ? RunPt(m.From) : RunPt(m.To))
                    : (StationRunPoint?)null;
                var standsOnOuterBase = new bool[segs.Count];
                for (int i = 0; i < segs.Count; i++) {
                    var s = segs[i];
                    standsOnOuterBase[i] = outerLow.HasValue && (SamePoint(s.From, outerLow.Value) || SamePoint(s.To, outerLow.Value));
                    double liftFrom = ExitLandingHeight(exits, isEscalator ? RunPt(m.From) : s.From);
                    double liftTo = ExitLandingHeight(exits, isEscalator ? RunPt(m.To) : s.To);
                    s.From = new StationRunPoint(s.From.X, s.From.Y, s.From.Z + liftFrom);
                    s.To = new StationRunPoint(s.To.X, s.To.Y, s.To.Z + liftTo);
                    segs[i] = s;
                }

                bool trimLandings = isStair;
                double foot = isStair ? StairBodyDrop : RampFoot;
                double stairTreadWidth = isStair ? StationRunGeometry.StairTreadWidth(m) : 0;
                bool stairOffGrid = isStair && !StationRunGeometry.StairOnBlockGrid(stairTreadWidth);
                string finish = isStair ? m.Config.Text("finish") : null;
                double escHalf = isEscalator ? StationRunGeometry.EscalatorBodyWidth(m) * .5 : 0;

                for (int flightIndex = 0; flightIndex < segs.Count; flightIndex++) {
                    var s = segs[flightIndex];
                    var tiles = FlightTiles(s, trimLandings);
                    if (tiles == null) continue;
                    bool hasFlightBase = trimLandings && standsOnOuterBase[flightIndex];
                    double flightBase = hasFlightBase ? Math.Min(s.From.Z, s.To.Z) + 1.0 : 0.0;
                    double bandHalf = stairOffGrid ? RampBodyHalf(m) : s.CoreHalf;
                    double segLen = Math.Sqrt(Sq(s.To.X - s.From.X) + Sq(s.To.Y - s.From.Y));
                    double trim = trimLandings ? StationRunGeometry.StairTreadTrim(segLen) : 0.0;

                    for (int tIdx = 0; tIdx < tiles.Count; tIdx++) {
                        var t = tiles[tIdx];
                        char axis = t.AlongX ? 'x' : 'y';
                        double ua = t.A - foot;
                        double ub = t.B - foot;
                        int first = (int)Math.Floor(Math.Min(ua, ub) + 1e-9);
                        int last = (int)Math.Ceiling(Math.Max(ua, ub) - 1e-9) - 1;
                        double across = t.AlongX ? t.Y + .5 + t.Sy : t.X + .5 + t.Sx;
                        double fromAlong = t.AlongX ? s.From.X : s.From.Y;
                        double toAlong = t.AlongX ? s.To.X : s.To.Y;
                        double minAlong = Math.Min(fromAlong, toAlong) + .5 + trim;
                        double maxAlong = Math.Max(fromAlong, toAlong) + .5 - trim;

                        var bandCells = CellsOnBand(t, bandHalf);
                        for (int cIdx = 0; cIdx < bandCells.Count; cIdx++) {
                            var (x, y) = bandCells[cIdx];
                            if (protect.Contains((x, y))) continue;
                            for (int z = first; z <= last; z++) {
                                double lo = ua - z;
                                double hi = ub - z;
                                if (lo >= 1.0 && hi >= 1.0) continue;
                                if (lo <= 0.0 && hi <= 0.0) continue;

                                double baseZ = hasFlightBase ? flightBase - z : 0.0;
                                bool loRaised = hasFlightBase && lo <= baseZ + 1e-9;
                                bool hiRaised = hasFlightBase && hi <= baseZ + 1e-9;
                                double localLo = loRaised ? baseZ : lo;
                                double localHi = hiRaised ? baseZ : hi;

                                double x0 = Math.Max(0.0, (t.AlongX ? minAlong : across - bandHalf) - x);
                                double x1 = Math.Min(1.0, (t.AlongX ? maxAlong : across + bandHalf) - x);
                                double y0 = Math.Max(0.0, (t.AlongX ? across - bandHalf : minAlong) - y);
                                double y1 = Math.Min(1.0, (t.AlongX ? across + bandHalf : maxAlong) - y);
                                if (x1 <= x0 + 1e-9 || y1 <= y0 + 1e-9) continue;

                                var patch = new StationRampPatch(axis, lo, hi, x0, x1, y0, y1, hasFlightBase, baseZ);
                                var key = new StationCellKey(x, y, z);
                                var cut = new StationSlopeCut {
                                    Axis = axis,
                                    Lo = localLo,
                                    Hi = localHi,
                                    HasBase = hasFlightBase && (loRaised || hiRaised),
                                    Base = hasFlightBase && (loRaised || hiRaised) ? baseZ : 0.0,
                                    HasHalf = isEscalator,
                                    Half = isEscalator ? escHalf : 0.0,
                                    OwnBody = isEscalator,
                                    NoFill = isStair,
                                    Finish = !string.IsNullOrEmpty(finish) ? finish : null,
                                };

                                if (cuts.TryGetValue(key, out var prev)) {
                                    var combined = new StationRampPatch[(prev.Patches?.Length ?? 0) + 1];
                                    if (prev.Patches != null && prev.Patches.Length > 0) {
                                        Array.Copy(prev.Patches, combined, prev.Patches.Length);
                                    }
                                    combined[combined.Length - 1] = patch;
                                    if (Math.Min(prev.Lo, prev.Hi) <= Math.Min(cut.Lo, cut.Hi)) {
                                        prev.Patches = combined;
                                        continue;
                                    }
                                    cut.Patches = combined;
                                } else {
                                    cut.Patches = new[] { patch };
                                }
                                cuts[key] = cut;
                            }
                        }
                    }
                }
            }
            return cuts;
        }

        /// <summary>Port of <c>rampFillKeys</c> (<c>sim/openings.ts</c>).</summary>
        public static HashSet<StationCellKey> RampFillKeys(HashSet<StationCellKey> solid,
            IReadOnlyDictionary<StationCellKey, StationSlopeCut> slopes) {
            var fills = new HashSet<StationCellKey>();
            if (solid == null || slopes == null) return fills;
            foreach (var pair in slopes) {
                var cut = pair.Value;
                if (cut == null || cut.OwnBody || cut.NoFill) continue;
                var key = pair.Key;
                if (solid.Contains(key)) continue;
                if (!solid.Contains(new StationCellKey(key.X, key.Y, key.Z - 1))) continue;
                fills.Add(key);
            }
            return fills;
        }

        public sealed class PreparedRampOpenings {
            readonly List<RampSegment> ramps;
            readonly Dictionary<(int x, int y), List<RampSegment>> buckets;
            readonly Dictionary<int, HashSet<StationCellKey>> cacheByLevel = new Dictionary<int, HashSet<StationCellKey>>();

            internal PreparedRampOpenings(List<RampSegment> ramps) {
                this.ramps = ramps ?? new List<RampSegment>(0);
                buckets = this.ramps.Count > 0 ? BuildRampBuckets(this.ramps) : null;
            }

            public bool HasRamps => ramps.Count > 0;

            public bool TryComputeThinSide(StationMeshCell cell, out StationWallSide side) {
                side = StationWallSide.S;
                if (ramps.Count == 0 || !cell.Solid || cell.Shape.Kind != StationShapeKind.Full) return false;
                bool wall = (cell.Flags & StationMeshCellFlags.Wall) != 0;
                var candidates = NearbyRamps(ramps, buckets, cell.X, cell.Y);
                if (candidates == null || candidates.Count == 0) return false;
                for (int rIdx = 0; rIdx < candidates.Count; rIdx++) {
                    var r = candidates[rIdx];
                    if (!wall && r.GroundCells != null &&
                        r.GroundCells.Contains(new StationCellKey(cell.X, cell.Y, cell.Z)) &&
                        Within(cell.X, cell.Y, cell.Z, r, r.CoreHalf)) continue;
                    if (!Within(cell.X, cell.Y, cell.Z, r, wall ? r.RailHalf : r.BodyHalf)) continue;
                    if (!wall && r.BodyHalf <= .5 + 1e-9) continue;
                    return TryOutwardSide(cell.X, cell.Y, r, out side);
                }
                return false;
            }

            public HashSet<StationCellKey> AtLevel(int z) {
                if (cacheByLevel.TryGetValue(z, out var cached)) return cached;
                var holes = new HashSet<StationCellKey>();
                for (int i = 0; i < ramps.Count; i++) {
                    var r = ramps[i];
                    double minH = Math.Min(r.From.Z, r.To.Z);
                    double maxH = Math.Max(r.From.Z, r.To.Z) + 1.0 + (r.Headroom > 0 ? r.Headroom : Headroom);
                    if (z + 1.0 < minH || z > maxH) continue;
                    int x0 = (int)Math.Floor(Math.Min(r.From.X, r.To.X)) - 2;
                    int x1 = (int)Math.Ceiling(Math.Max(r.From.X, r.To.X)) + 2;
                    int y0 = (int)Math.Floor(Math.Min(r.From.Y, r.To.Y)) - 2;
                    int y1 = (int)Math.Ceiling(Math.Max(r.From.Y, r.To.Y)) + 2;
                    for (int x = x0; x <= x1; x++) {
                        for (int y = y0; y <= y1; y++) {
                            if (Intrudes(x, y, z, r)) holes.Add(new StationCellKey(x, y, z));
                        }
                    }
                }
                cacheByLevel[z] = holes;
                return holes;
            }
        }

        public static PreparedRampOpenings PrepareOpenings(StationIndex index, HashSet<string> excludedModuleIds = null) {
            if (index == null) return new PreparedRampOpenings(null);
            var structural = new List<ModuleFacts>();
            void Collect(string type) {
                var list = index.ModulesOfType(type);
                for (int i = 0; i < list.Count; i++) {
                    var m = list[i];
                    if (m?.Facts == null) continue;
                    if (excludedModuleIds != null && excludedModuleIds.Contains(m.Id)) continue;
                    structural.Add(m.Facts);
                }
            }
            Collect("exit");
            Collect("stair");
            Collect("escalator");
            Collect("lift");
            return new PreparedRampOpenings(structural.Count == 0 ? null : BuildRampList(structural));
        }

        public static HashSet<StationCellKey> RampOpeningsAtLevel(IReadOnlyList<StationModuleRecord> modules, int z) =>
            RampOpeningsAtLevel(ExtractFacts(modules), z);

        /// <summary>Port of <c>rampOpeningsInWindow</c> (<c>sim/openings.ts</c>) across all ramps at level <paramref name="z"/>.</summary>
        public static HashSet<StationCellKey> RampOpeningsAtLevel(IReadOnlyList<ModuleFacts> modules, int z,
            int minX = int.MinValue / 2, int maxX = int.MaxValue / 2, int minY = int.MinValue / 2, int maxY = int.MaxValue / 2) {
            var holes = new HashSet<StationCellKey>();
            var ramps = BuildRampList(modules);
            if (ramps.Count == 0) return holes;
            for (int i = 0; i < ramps.Count; i++) {
                var r = ramps[i];
                int x0 = Math.Max(minX, (int)Math.Floor(Math.Min(r.From.X, r.To.X)) - 2);
                int x1 = Math.Min(maxX, (int)Math.Ceiling(Math.Max(r.From.X, r.To.X)) + 2);
                int y0 = Math.Max(minY, (int)Math.Floor(Math.Min(r.From.Y, r.To.Y)) - 2);
                int y1 = Math.Min(maxY, (int)Math.Ceiling(Math.Max(r.From.Y, r.To.Y)) + 2);
                for (int x = x0; x <= x1; x++) {
                    for (int y = y0; y <= y1; y++) {
                        if (Intrudes(x, y, z, r)) holes.Add(new StationCellKey(x, y, z));
                    }
                }
            }
            return holes;
        }

        /// <summary>Port of <c>rampThinCells</c> (<c>sim/openings.ts</c>).</summary>
        public static List<RampThinCell> RampThinCells(IReadOnlyList<StationMeshCell> cells, IReadOnlyList<ModuleFacts> modules) {
            var thins = new List<RampThinCell>();
            if (cells == null || cells.Count == 0 || modules == null || modules.Count == 0) return thins;
            var ramps = BuildRampList(modules);
            if (ramps.Count == 0) return thins;
            var buckets = BuildRampBuckets(ramps);

            for (int i = 0; i < cells.Count; i++) {
                var cell = cells[i];
                if (!cell.Solid) continue;
                if (cell.Shape.Kind != StationShapeKind.Full) continue;
                bool wall = (cell.Flags & StationMeshCellFlags.Wall) != 0;
                var candidates = NearbyRamps(ramps, buckets, cell.X, cell.Y);
                if (candidates == null || candidates.Count == 0) continue;
                for (int rIdx = 0; rIdx < candidates.Count; rIdx++) {
                    var r = candidates[rIdx];
                    if (!wall && r.GroundCells != null &&
                        r.GroundCells.Contains(new StationCellKey(cell.X, cell.Y, cell.Z)) &&
                        Within(cell.X, cell.Y, cell.Z, r, r.CoreHalf)) continue;
                    if (!Within(cell.X, cell.Y, cell.Z, r, wall ? r.RailHalf : r.BodyHalf)) continue;
                    if (!wall && r.BodyHalf <= .5 + 1e-9) continue;
                    if (TryOutwardSide(cell.X, cell.Y, r, out var side)) {
                        thins.Add(new RampThinCell(cell.X, cell.Y, cell.Z, side));
                    }
                    break;
                }
            }
            return thins;
        }

        static List<RampSegment> BuildRampList(IReadOnlyList<ModuleFacts> modules) {
            var ramps = new List<RampSegment>();
            if (modules == null || modules.Count == 0) return ramps;

            var structural = new List<ModuleFacts>();
            var exits = new List<ModuleFacts>();
            for (int i = 0; i < modules.Count; i++) {
                var m = modules[i];
                if (m == null) continue;
                if (string.Equals(m.Type, "exit", StringComparison.Ordinal)) {
                    structural.Add(m);
                    exits.Add(m);
                } else if (string.Equals(m.Type, "stair", StringComparison.Ordinal) ||
                           string.Equals(m.Type, "escalator", StringComparison.Ordinal) ||
                           string.Equals(m.Type, "lift", StringComparison.Ordinal)) {
                    structural.Add(m);
                }
            }
            if (structural.Count == 0) return ramps;

            var cuts = RampSlopeCuts(structural);
            var retained = new HashSet<StationCellKey>();
            foreach (var pair in cuts) {
                if (RampSurfaceRetainsVolume(pair.Value.PatchList)) retained.Add(pair.Key);
            }

            var singleInput = new List<ModuleFacts>(exits.Count + 1);
            for (int i = 0; i < structural.Count; i++) {
                var m = structural[i];
                if (string.Equals(m.Type, "exit", StringComparison.Ordinal)) continue;
                var segs = RampSegments(m);
                if (segs == null || segs.Count == 0) continue;

                HashSet<StationCellKey> groundCells = null;
                if (!string.Equals(m.Type, "lift", StringComparison.Ordinal)) {
                    singleInput.Clear();
                    singleInput.Add(m);
                    for (int e = 0; e < exits.Count; e++) singleInput.Add(exits[e]);
                    var ownCuts = RampSlopeCuts(singleInput);
                    foreach (var key in ownCuts.Keys) {
                        if (!retained.Contains(key)) continue;
                        groundCells ??= new HashSet<StationCellKey>();
                        groundCells.Add(key);
                    }
                }

                double segHeadroom = string.Equals(m.Type, "escalator", StringComparison.Ordinal) ? EscalatorHeadroom : Headroom;
                for (int s = 0; s < segs.Count; s++) {
                    var seg = segs[s];
                    seg.GroundCells = groundCells;
                    seg.Headroom = segHeadroom;
                    ramps.Add(seg);
                }
            }
            return ramps;
        }

        static List<RampSegment> RampSegments(ModuleFacts m) {
            if (m == null) return null;
            if (string.Equals(m.Type, "stair", StringComparison.Ordinal) && m.Config.Bool("block")) return null;
            double bodyHalf = RampBodyHalf(m);
            double railHalf = RampCorridorHalf(m);
            double coreHalf = RampLaneHalf(m);
            if (string.Equals(m.Type, "escalator", StringComparison.Ordinal) ||
                string.Equals(m.Type, "walkway", StringComparison.Ordinal)) {
                if (!m.From.HasValue || !m.To.HasValue) return null;
                StationRunGeometry.EscalatorRun(m, out var from, out var to);
                return new List<RampSegment>(1) {
                    new RampSegment { From = from, To = to, BodyHalf = bodyHalf, RailHalf = railHalf, CoreHalf = coreHalf, Headroom = Headroom },
                };
            }
            if (string.Equals(m.Type, "lift", StringComparison.Ordinal)) {
                if (!m.From.HasValue || !m.To.HasValue) return null;
                return new List<RampSegment>(1) {
                    new RampSegment { From = RunPt(m.From), To = RunPt(m.To), BodyHalf = bodyHalf, RailHalf = railHalf, CoreHalf = coreHalf, Headroom = Headroom },
                };
            }
            if (string.Equals(m.Type, "stair", StringComparison.Ordinal)) {
                var flights = StationRunGeometry.StairFlights(m);
                var slides = StationRunGeometry.StairFlightSlides(m, flights);
                var list = new List<RampSegment>(flights.Count);
                for (int i = 0; i < flights.Count; i++) {
                    list.Add(new RampSegment {
                        From = flights[i].From, To = flights[i].To,
                        BodyHalf = bodyHalf, RailHalf = railHalf, CoreHalf = coreHalf,
                        Sx = slides[i].X, Sy = slides[i].Y, Headroom = Headroom,
                    });
                }
                return list;
            }
            return null;
        }

        static List<StationRunPoint> StairLandings(ModuleFacts m) {
            var landings = new List<StationRunPoint>();
            var seen = new HashSet<(int x, int y, long zBits)>();
            var flights = StationRunGeometry.StairFlights(m);
            for (int i = 0; i < flights.Count; i++) {
                AddLanding(flights[i].From, seen, landings);
                AddLanding(flights[i].To, seen, landings);
            }
            return landings;
        }

        static void AddLanding(StationRunPoint p, HashSet<(int, int, long)> seen, List<StationRunPoint> list) {
            var key = (RoundCell(p.X), RoundCell(p.Y), BitConverter.DoubleToInt64Bits(Math.Round(p.Z, 6)));
            if (seen.Add(key)) list.Add(p);
        }

        static List<FlightTile> FlightTiles(RampSegment s, bool trimLandings) {
            double dx = s.To.X - s.From.X;
            double dy = s.To.Y - s.From.Y;
            if (Math.Abs(dx) > 1e-9 && Math.Abs(dy) > 1e-9) return null;
            double len = Math.Sqrt(Sq(dx) + Sq(dy));
            if (len < 1e-6) return null;
            double trim = trimLandings ? StationRunGeometry.StairTreadTrim(len) : 0.0;
            bool alongX = Math.Abs(dx) > 1e-9;
            double start = (alongX ? s.From.X : s.From.Y) + .5;
            double end = (alongX ? s.To.X : s.To.Y) + .5;
            double forward = end > start ? 1.0 : -1.0;
            int first = (int)Math.Floor(Math.Min(start, end) + trim + 1e-9);
            int last = (int)Math.Ceiling(Math.Max(start, end) - trim - 1e-9) - 1;
            double az = s.From.Z + 1.0;
            double bz = s.To.Z + 1.0;
            double span = len - trim * 2.0;
            var list = new List<FlightTile>(Math.Max(0, last - first + 1));
            int fixedX = (int)Math.Floor(s.From.X);
            int fixedY = (int)Math.Floor(s.From.Y);
            double fracX = alongX ? 0.0 : s.From.X - fixedX;
            double fracY = alongX ? s.From.Y - fixedY : 0.0;
            for (int i = first; i <= last; i++) {
                double ua = (i - start) * forward;
                double ub = (i + 1 - start) * forward;
                list.Add(new FlightTile {
                    X = alongX ? i : fixedX,
                    Y = alongX ? fixedY : i,
                    AlongX = alongX,
                    A = trimLandings ? az + (bz - az) * ((ua - trim) / span) : az + (bz - az) * (ua / len),
                    B = trimLandings ? az + (bz - az) * ((ub - trim) / span) : az + (bz - az) * (ub / len),
                    Sx = s.Sx + fracX,
                    Sy = s.Sy + fracY,
                });
            }
            return list;
        }

        static List<(int x, int y)> CellsOnBand(FlightTile t, double half) {
            double across = t.AlongX ? t.Y + .5 + t.Sy : t.X + .5 + t.Sx;
            int lo = (int)Math.Floor(across - half - .5);
            int hi = (int)Math.Ceiling(across + half - .5);
            var list = new List<(int x, int y)>(Math.Max(1, hi - lo + 1));
            for (int i = lo; i <= hi; i++) {
                if (Math.Abs(i + .5 - across) >= half + .5 - 1e-9) continue;
                list.Add(t.AlongX ? (t.X, i) : (i, t.Y));
            }
            return list;
        }

        static bool Within(int cx, int cy, int cz, RampSegment r, double half) {
            double ax = r.From.X + .5;
            double ay = r.From.Y + .5;
            double az = r.From.Z + 1.0;
            double dx = r.To.X + .5 - ax;
            double dy = r.To.Y + .5 - ay;
            double len2 = dx * dx + dy * dy;
            if (len2 < 1e-6) return false;
            double px = cx + .5 - r.Sx;
            double py = cy + .5 - r.Sy;
            double t = ((px - ax) * dx + (py - ay) * dy) / len2;
            if (t < 0.0 || t > 1.0) return false;
            double lateral = Math.Abs((px - ax) * dy - (py - ay) * dx) / Math.Sqrt(len2);
            double gap = Math.Max(0.0, lateral - .5);
            if (gap >= half - ReachEps) return false;
            double h = az + (r.To.Z + 1.0 - az) * t;
            double headroom = r.Headroom > 0 ? r.Headroom : Headroom;
            return cz + 1.0 > h + Eps && cz < h + headroom;
        }

        static bool Intrudes(int cx, int cy, int cz, RampSegment r) {
            if (r.GroundCells != null && r.GroundCells.Contains(new StationCellKey(cx, cy, cz))) return false;
            return Within(cx, cy, cz, r, r.CoreHalf);
        }

        static bool TryOutwardSide(int cx, int cy, RampSegment r, out StationWallSide side) {
            side = StationWallSide.S;
            double ax = r.From.X + .5;
            double ay = r.From.Y + .5;
            double dx = r.To.X + .5 - ax;
            double dy = r.To.Y + .5 - ay;
            double len2 = dx * dx + dy * dy;
            if (len2 < 1e-6) return false;
            double px = cx + .5;
            double py = cy + .5;
            double t = ((px - ax) * dx + (py - ay) * dy) / len2;
            double projX = ax + t * dx;
            double projY = ay + t * dy;
            double nx = -dy;
            double ny = dx;
            double nl = Math.Sqrt(nx * nx + ny * ny);
            if (nl < 1e-6) return false;
            nx /= nl;
            ny /= nl;
            double d = (px - projX) * nx + (py - projY) * ny;
            if (Math.Abs(d) < 1e-3) return false;
            double sign = d > 0 ? 1.0 : -1.0;
            if (Math.Abs(nx) >= Math.Abs(ny)) {
                side = nx * sign > 0 ? StationWallSide.E : StationWallSide.W;
            } else {
                side = ny * sign > 0 ? StationWallSide.N : StationWallSide.S;
            }
            return true;
        }

        static Dictionary<(int x, int y), List<RampSegment>> BuildRampBuckets(List<RampSegment> ramps) {
            var buckets = new Dictionary<(int x, int y), List<RampSegment>>();
            for (int i = 0; i < ramps.Count; i++) {
                var r = ramps[i];
                double reach = Math.Max(r.CoreHalf, Math.Max(r.RailHalf, r.BodyHalf)) + .5;
                int x0 = FloorDiv(Math.Min(r.From.X, r.To.X) + r.Sx - reach, RampBucketSize);
                int x1 = FloorDiv(Math.Max(r.From.X, r.To.X) + r.Sx + reach, RampBucketSize);
                int y0 = FloorDiv(Math.Min(r.From.Y, r.To.Y) + r.Sy - reach, RampBucketSize);
                int y1 = FloorDiv(Math.Max(r.From.Y, r.To.Y) + r.Sy + reach, RampBucketSize);
                if ((long)(x1 - x0 + 1) * (y1 - y0 + 1) > 1024) return null;
                for (int x = x0; x <= x1; x++) {
                    for (int y = y0; y <= y1; y++) {
                        if (!buckets.TryGetValue((x, y), out var list)) {
                            list = new List<RampSegment>(4);
                            buckets[(x, y)] = list;
                        }
                        list.Add(r);
                    }
                }
            }
            return buckets;
        }

        static List<RampSegment> NearbyRamps(List<RampSegment> all, Dictionary<(int x, int y), List<RampSegment>> buckets, int x, int y) {
            if (buckets == null) return all;
            return buckets.TryGetValue((FloorDiv(x, RampBucketSize), FloorDiv(y, RampBucketSize)), out var list) ? list : null;
        }

        static int FloorDiv(double v, int div) => (int)Math.Floor(v / div);

        static int RoundCell(double v) => (int)Math.Round(v, MidpointRounding.AwayFromZero);

        static StationRunPoint RunPt(ModuleFacts.Point p) => new StationRunPoint(p.X, p.Y, p.Z);

        static bool SamePoint(StationRunPoint a, StationRunPoint b) =>
            Math.Abs(a.X - b.X) <= 1e-6 && Math.Abs(a.Y - b.Y) <= 1e-6 && Math.Abs(a.Z - b.Z) <= 1e-6;

        static double Sq(double v) => v * v;
    }
}
