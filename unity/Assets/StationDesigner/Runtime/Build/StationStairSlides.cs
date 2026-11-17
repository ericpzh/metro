using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// How far each flight of a stair is slid across from its landings (`sim/stairs.ts`
    /// `stairFlightSlides`). A run laid **on the block grid** fills whole blocks, so its band is
    /// centred half a lane off the landing cell; a switchback's returning flight also slides back
    /// toward the first so the two balustrades meet on the seam. A 90° turn's two legs grow across
    /// **their own** runs instead, because one across-vector cannot place both bands.
    ///
    /// The slides are what make a turning stair's carved corridor land on the blocks it really
    /// occupies, so the carve reads them and the reference's own landing cells come out clean.
    /// </summary>
    public static class StationStairSlides {
        /// <summary>How far a walker's line stays clear of a tread's edge, metres.</summary>
        const double WalkClearance = 0.25;
        /// <summary>`stairSwitchbackGap`: the separation two runs' treads want, metres.</summary>
        static double Gap(double width) => width + 2 * StationRampRules.StairRailProud;
        /// <summary>`stairReturnSlide`: the slide that closes a switchback's well, metres.</summary>
        static double ReturnSlide(double offset, double width) {
            double step = offset - Gap(width);
            double limit = Math.Max(0, width / 2 - WalkClearance);
            return Math.Max(0, Math.Min(step, limit));
        }
        /// <summary>`stairLanes`: the lanes a tool width lays down, 1..3.</summary>
        static int Lanes(double width) {
            if (StationRampRules.StairOnBlockGrid(width)) return StationRampRules.StairRunBlocks(width);
            int lanes = (int)Math.Round(width / StationRampRules.Band);
            return Math.Max(1, Math.Min(3, lanes));
        }
        static double Grid(double width) =>
            StationRampRules.StairOnBlockGrid(width) ? (StationRampRules.StairRunBlocks(width) - 1) / 2.0 : 0;
        static double Clean(double value) => value == 0 ? 0 : value;

        /// <summary>
        /// `stairFlightSlides`: one slide per flight, in flight order. An axis-aligned run whose
        /// slide is exactly zero needs none.
        /// </summary>
        public static List<(double Dx, double Dy)> Slides(StationModuleRecord m) {
            var flights = StationRampRules.FlightsOf(m);
            var slides = new List<(double, double)>(flights.Count);
            foreach (var _ in flights) slides.Add((0, 0));
            if (flights.Count == 0) return slides;
            if (flights.Count > 2) {
                // A 中直跑楼梯 over several storeys climbs in more than two flights, all carrying
                // on: each band is centred across the blocks it fills, like a single run's.
                double grid = Grid(StationRampRules.StairWidth(m));
                if (grid == 0) return slides;
                for (int i = 0; i < flights.Count; i++) {
                    double dx = flights[i].To.X - flights[i].From.X;
                    double dy = flights[i].To.Y - flights[i].From.Y;
                    double run = Math.Sqrt(dx * dx + dy * dy);
                    if (run < 1e-6) continue;
                    slides[i] = (Clean(dy / run * grid), Clean(-dx / run * grid));
                }
                return slides;
            }
            double width = StationRampRules.StairWidth(m);
            if (flights.Count == 1) {
                double tread = StationRampRules.StairTreadWidth(m);
                double shift = StationRampRules.StairOnBlockGrid(tread)
                    ? (StationRampRules.StairRunBlocks(tread) - 1) / 2.0 : 0;
                var flight = flights[0];
                bool rising = flight.From.Z <= flight.To.Z;
                var lower = rising ? flight.From : flight.To;
                var upper = rising ? flight.To : flight.From;
                double dx = upper.X - lower.X, dy = upper.Y - lower.Y;
                double run = Math.Sqrt(dx * dx + dy * dy);
                if (run > 1e-6) slides[0] = (Clean(dy / run * shift), Clean(-dx / run * shift));
                return slides;
            }
            // Two flights: the first's line and the second's starting point give the across step.
            double grid2 = Grid(width);
            var first = flights[0];
            var second = flights[1];
            double rx = second.From.X - first.From.X;
            double ry = second.From.Y - first.From.Y;
            double run1 = Math.Sqrt(Math.Pow(first.To.X - first.From.X, 2) + Math.Pow(first.To.Y - first.From.Y, 2));
            if (run1 < 1e-6) return slides;
            double ux = (first.To.X - first.From.X) / run1;
            double uy = (first.To.Y - first.From.Y) / run1;
            double d2x = second.To.X - second.From.X;
            double d2y = second.To.Y - second.From.Y;
            if (Math.Abs(d2x * ux + d2y * uy) < 1e-9) {
                // A 90° turn: each leg's band grows across its own run, toward the way the other
                // leg travels, so the corner block is the first lane of both bands.
                double hand = d2x * uy - d2y * ux >= 0 ? 1 : -1;
                slides[0] = (Clean(uy * grid2 * hand), Clean(-ux * grid2 * hand));
                slides[1] = (Clean(ux * grid2), Clean(uy * grid2));
                return slides;
            }
            double across = rx * -uy + ry * ux;
            double offset = Math.Abs(across);
            double slide = ReturnSlide(offset, width);
            double side = across == 0 ? 0 : across > 0 ? -1 : 1;
            slides[0] = (Clean(uy * grid2), Clean(-ux * grid2));
            slides[1] = (Clean(uy * grid2 - uy * side * slide), Clean(-ux * grid2 + ux * side * slide));
            return slides;
        }
    }
}
