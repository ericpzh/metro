using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// The corridor a stair, 扶梯, 自动步道 or lift shaft carves through solid ground
    /// (`sim/openings.ts` `carveRampOpenings`). A run is a swept line, so a block is reached when
    /// the run's lane span crosses the block's near edge and the block sits above the walking
    /// line but within the run's headroom. The lowest block left directly above an opened column
    /// is tagged `opening-ceiling`: it is the shaft's ceiling, not a plate hanging in space.
    ///
    /// Only the **straight** segment shape is ported — the shape the reference's own one-flight
    /// envelope accepts — so this file answers for walkways, 扶梯, lift shafts and single-flight
    /// stairs. A multi-flight stair's parked landings and switchback slides are not here yet.
    /// </summary>
    public static class StationRampCarve {
        public const string OpeningCeiling = "opening-ceiling";
        /// <summary>Vertical headroom a stair run carves above its walking line, metres.</summary>
        public const double Headroom = 1.3;
        /// <summary>An 扶梯 clears a taller corridor — a person and the balustrade.</summary>
        public const double EscalatorHeadroom = 2.2;
        const double Eps = 0.02;
        const double ReachEps = 1e-6;

        /// <summary>One swept run: its walking line, lane widths and slide.</summary>
        public sealed class Run {
            public double FromX, FromY, FromZ;
            public double ToX, ToY, ToZ;
            public double BodyHalf, RailHalf, CoreHalf;
            public double Headroom = StationRampCarve.Headroom;
            public double SlideX, SlideY;
        }

        /// <summary>`rampSegments` for the straight shapes: a walkway, 扶梯 or lift shaft.</summary>
        public static Run ForModule(StationModuleRecord module) {
            if (module == null || !module.From.HasValue || !module.To.HasValue) return null;
            if (module.Type != "walkway" && module.Type != "escalator" && module.Type != "lift" &&
                module.Type != "stair") return null;
            if (module.Type == "stair" && module.Config.Has("block")) return null;
            var run = new Run {
                FromX = module.From.Value.X, FromY = module.From.Value.Y, FromZ = module.From.Value.Z,
                ToX = module.To.Value.X, ToY = module.To.Value.Y, ToZ = module.To.Value.Z,
                BodyHalf = StationRampRules.BodyHalf(module),
                RailHalf = StationRampRules.CorridorHalf(module),
                CoreHalf = Math.Max(1, module.Width) / 2.0,
                Headroom = module.Type == "escalator" ? EscalatorHeadroom : Headroom,
            };
            return run;
        }

        /// <summary>
        /// `rampSegments`: every corridor this piece carves. A walkway, 扶梯 or lift shaft is one
        /// run; a stair is one run **per saved flight**, each slid across from its landings by
        /// `StationStairSlides` — a run on the block grid is centred half a lane off the landing
        /// cell, and a switchback's return slides back until the two balustrades meet.
        /// </summary>
        public static List<Run> RunsFor(StationModuleRecord module) {
            var runs = new List<Run>();
            if (module == null) return runs;
            if (module.Type != "stair") {
                var single = ForModule(module);
                if (single != null) runs.Add(single);
                return runs;
            }
            if (module.Config.Has("block")) return runs;
            var flights = StationRampRules.FlightsOf(module);
            var slides = StationStairSlides.Slides(module);
            for (int i = 0; i < flights.Count; i++) {
                var slide = i < slides.Count ? slides[i] : (Dx: 0.0, Dy: 0.0);
                runs.Add(new Run {
                    FromX = flights[i].From.X, FromY = flights[i].From.Y, FromZ = flights[i].From.Z,
                    ToX = flights[i].To.X, ToY = flights[i].To.Y, ToZ = flights[i].To.Z,
                    BodyHalf = StationRampRules.BodyHalf(module),
                    RailHalf = StationRampRules.CorridorHalf(module),
                    CoreHalf = Math.Max(1, module.Width) / 2.0,
                    Headroom = Headroom,
                    SlideX = slide.Dx,
                    SlideY = slide.Dy,
                });
            }
            return runs;
        }

        /// <summary>
        /// `within`: does the swept line at <paramref name="half"/> reach this cell? A core keeps
        /// the cells its lane span fills, including one its line merely divides; a block is
        /// reached only above the walking line and strictly below the landing.
        /// </summary>
        public static bool Within(StationCellRecord c, Run r, double half) {
            if (c == null || r == null) return false;
            double ax = r.FromX + 0.5, ay = r.FromY + 0.5, az = r.FromZ + 1;
            double dx = r.ToX + 0.5 - ax, dy = r.ToY + 0.5 - ay;
            double len2 = dx * dx + dy * dy;
            if (len2 < 1e-6) return false;
            double px = c.X + 0.5 - r.SlideX;
            double py = c.Y + 0.5 - r.SlideY;
            double t = ((px - ax) * dx + (py - ay) * dy) / len2;
            if (t < 0 || t > 1) return false;
            double lateral = Math.Abs((px - ax) * dy - (py - ay) * dx) / Math.Sqrt(len2);
            double gap = Math.Max(0, lateral - 0.5);
            if (gap >= half - ReachEps) return false;
            double h = az + (r.ToZ + 1 - az) * t;
            return c.Z + 1 > h + Eps && c.Z < h + r.Headroom;
        }

        /// <summary>
        /// `<c>carveRampOpenings</c>`: drop every reached cell (a wall is never carved — the run's
        /// rail touches it instead) and tag each opened column's new ceiling. Returns the cell
        /// writes, empty when the document has no run or nothing to open.
        /// </summary>
        public static List<StationCellWrite> Carve(StationIndex index, IEnumerable<StationModuleRecord> extra = null) {
            var writes = new List<StationCellWrite>();
            if (index == null) return writes;
            var runs = new List<Run>();
            foreach (var module in index.Document.Modules) runs.AddRange(RunsFor(module));
            if (extra != null) {
                foreach (var module in extra) runs.AddRange(RunsFor(module));
            }
            if (runs.Count == 0) return writes;
            var kill = new HashSet<StationCellKey>();
            var opened = new Dictionary<string, int>();
            foreach (var cell in index.Document.Cells) {
                if (cell == null || !cell.IsSolid) continue;
                if (StationCellRules.IsWallBlock(cell.Tags)) continue;
                bool reached = false;
                foreach (var run in runs) {
                    if (!Within(cell, run, run.CoreHalf)) continue;
                    reached = true;
                    break;
                }
                if (!reached) continue;
                kill.Add(cell.Key);
                string column = cell.X + "," + cell.Y;
                if (!opened.TryGetValue(column, out var top) || cell.Z > top) opened[column] = cell.Z;
            }
            if (kill.Count == 0) return writes;
            foreach (var key in kill) writes.Add(StationCellWrite.Drop(key));
            // The lowest solid left above each opening is the shaft's ceiling.
            var ceiling = new Dictionary<string, StationCellRecord>();
            foreach (var cell in index.Document.Cells) {
                if (cell == null || !cell.IsSolid || kill.Contains(cell.Key)) continue;
                if (!opened.TryGetValue(cell.X + "," + cell.Y, out var openedZ)) continue;
                if (cell.Z <= openedZ) continue;
                ceiling.TryGetValue(cell.X + "," + cell.Y, out var held);
                if (held == null || cell.Z < held.Z) ceiling[cell.X + "," + cell.Y] = cell;
            }
            foreach (var cell in ceiling.Values) {
                bool tagged = false;
                foreach (var tag in cell.Tags) if (string.Equals(tag, OpeningCeiling, StringComparison.Ordinal)) tagged = true;
                if (tagged) continue;
                writes.Add(StationCellWrite.AddTags(cell.Key, new[] { OpeningCeiling }));
            }
            return writes;
        }
    }
}
