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

        /// <summary>Port of <c>rampLaneHalf</c>: half-width in cells of the lanes a run fills.</summary>
        public static double LaneHalf(StationModuleRecord module) {
            if (module == null) return 0.5;
            if (module.Type == "stair") {
                double width = StationRampRules.StairTreadWidth(module);
                return StationRampRules.StairOnBlockGrid(width)
                    ? StationRampRules.StairRunBlocks(width) / 2.0
                    : 0.5;
            }
            if (module.Type == "escalator") return StationRampRules.Width(module) / 2.0;
            return 0.5;
        }

        /// <summary>
        /// `rampSegments` for carving: an escalator or straight stair. A level walkway lies on its
        /// floor and never carves blocks above it; a lift shaft is vertical and has no swept corridor.
        /// </summary>
        public static Run ForModule(StationModuleRecord module) {
            if (module == null || !module.From.HasValue || !module.To.HasValue) return null;
            if (module.Type != "escalator" && module.Type != "stair") return null;
            if (module.Type == "stair" && module.Config.Has("block")) return null;
            double fx = module.From.Value.X, fy = module.From.Value.Y, fz = module.From.Value.Z;
            double tx = module.To.Value.X, ty = module.To.Value.Y, tz = module.To.Value.Z;
            double slideX = 0, slideY = 0;
            if (module.Type == "escalator") {
                int lanes = StationRampRules.Width(module);
                if (lanes > 1) {
                    bool lowerFirst = fz != tz ? fz < tz : (fx != tx ? fx < tx : fy < ty);
                    double lx = lowerFirst ? fx : tx, ly = lowerFirst ? fy : ty;
                    double ux = lowerFirst ? tx : fx, uy = lowerFirst ? ty : fy;
                    double len = Math.Sqrt((ux - lx) * (ux - lx) + (uy - ly) * (uy - ly));
                    if (len > 1e-6) {
                        double shift = (lanes - 1) * 0.5 / len;
                        double sdx = (uy - ly) * shift;
                        double sdy = -(ux - lx) * shift;
                        fx += sdx; fy += sdy;
                        tx += sdx; ty += sdy;
                    }
                }
            } else if (module.Type == "stair") {
                var slides = StationStairSlides.Slides(module);
                if (slides.Count > 0) { slideX = slides[0].Dx; slideY = slides[0].Dy; }
            }
            var run = new Run {
                FromX = fx, FromY = fy, FromZ = fz,
                ToX = tx, ToY = ty, ToZ = tz,
                BodyHalf = StationRampRules.BodyHalf(module),
                RailHalf = StationRampRules.CorridorHalf(module),
                CoreHalf = LaneHalf(module),
                Headroom = module.Type == "escalator" ? EscalatorHeadroom : Headroom,
                SlideX = slideX,
                SlideY = slideY,
            };
            return run;
        }

        /// <summary>
        /// `rampSegments`: every corridor this piece carves. An escalator is one run; a stair is
        /// one run **per saved flight**, each slid across from its landings by
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
            double coreHalf = LaneHalf(module);
            for (int i = 0; i < flights.Count; i++) {
                var slide = i < slides.Count ? slides[i] : (Dx: 0.0, Dy: 0.0);
                runs.Add(new Run {
                    FromX = flights[i].From.X, FromY = flights[i].From.Y, FromZ = flights[i].From.Z,
                    ToX = flights[i].To.X, ToY = flights[i].To.Y, ToZ = flights[i].To.Z,
                    BodyHalf = StationRampRules.BodyHalf(module),
                    RailHalf = StationRampRules.CorridorHalf(module),
                    CoreHalf = coreHalf,
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
        /// `<c>carveRampOpenings</c>`: drop every reached cell (a wall or any ramp/lift landing is
        /// never carved) and tag each opened column's new ceiling. Passing
        /// <paramref name="excludeModuleId"/> ignores an old copy of a moved module.
        /// </summary>
        public static List<StationCellWrite> Carve(StationIndex index, IEnumerable<StationModuleRecord> extra = null,
            string excludeModuleId = null) {
            var writes = new List<StationCellWrite>();
            if (index == null) return writes;
            var runs = new List<Run>();
            var protect = new HashSet<StationCellKey>();
            void CollectModule(StationModuleRecord module) {
                if (module == null) return;
                runs.AddRange(RunsFor(module));
                if (module.Type == "stair" && !module.Config.Bool("block")) {
                    foreach (var l in StationRampRules.StairLandings(module)) protect.Add(l);
                } else if (module.Type == "escalator" || module.Type == "walkway") {
                    foreach (var l in StationRampRules.EscalatorLandings(module)) protect.Add(l);
                } else if (module.Type == "lift") {
                    int size = module.Config.Int("size", 2) == 3 ? 3 : 2;
                    for (int lx = 0; lx < size; lx++) {
                        for (int ly = 0; ly < size; ly++) {
                            protect.Add(new StationCellKey(module.X + lx, module.Y + ly, module.Z));
                        }
                    }
                }
            }
            foreach (var module in index.Document.Modules) {
                if (module == null) continue;
                if (!string.IsNullOrEmpty(excludeModuleId) && string.Equals(module.Id, excludeModuleId, StringComparison.Ordinal)) continue;
                CollectModule(module);
            }
            if (extra != null) {
                foreach (var module in extra) CollectModule(module);
            }
            if (runs.Count == 0) return writes;
            var kill = new HashSet<StationCellKey>();
            var opened = new Dictionary<string, int>();
            foreach (var cell in index.Document.Cells) {
                if (cell == null || !cell.IsSolid) continue;
                if (StationCellRules.IsWallBlock(cell.Tags)) continue;
                if (protect.Contains(cell.Key)) continue;
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

        /// <summary>
        /// Materialize explicit solid floor cells for any integer landing of <paramref name="candidate"/>
        /// that rests on an exit head-house's virtual floor (no authored solid cell yet).
        /// </summary>
        public static List<StationCellWrite> MaterializeExitFloorLandings(StationIndex index, StationModuleRecord candidate) {
            var writes = new List<StationCellWrite>();
            if (index == null || candidate == null) return writes;
            List<StationCellKey> landings = null;
            if (candidate.Type == "stair" && !candidate.Config.Bool("block")) {
                landings = StationRampRules.StairLandings(candidate);
            } else if (candidate.Type == "escalator" || candidate.Type == "walkway") {
                landings = StationRampRules.EscalatorLandings(candidate);
            }
            if (landings == null || landings.Count == 0) return writes;
            var seen = new HashSet<StationCellKey>();
            for (int i = 0; i < landings.Count; i++) {
                var key = landings[i];
                if (!seen.Add(key)) continue;
                var existing = index.GetCell(key.X, key.Y, key.Z);
                if (existing != null && existing.IsSolid) continue;
                if (!StationFootprints.IsExitFloorAt(index, key.X, key.Y, key.Z)) continue;
                var solidWrite = StationCellWrite.Set(key, isVoid: false);
                solidWrite.Zone = "outside";
                writes.Add(solidWrite);
            }
            return writes;
        }
    }
}
