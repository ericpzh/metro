using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>One stock class's body, as far as rail sizing reads it (`sim/stock.ts`).</summary>
    public readonly struct StationStockSpec {
        public readonly string Class;
        public readonly double Width;
        public readonly double Length;

        public StationStockSpec(string stockClass, double width, double length) {
            Class = stockClass; Width = width; Length = length;
        }
    }

    /// <summary>
    /// The track kit's geometry and sizing rules (plan 27 §6): a port of `sim/track.ts`'s
    /// rotation/cell maths and `build/rail.ts`'s `trackPieceForLine` / `RAIL_BED_DEPTH` /
    /// `trackHeadroom`. A track piece is a fixed footprint — `w` cells of run along its local
    /// +x and `d` cells across — quarter-turned by `rot`, so the whole piece can be previewed
    /// and committed as one module.
    /// </summary>
    public static class StationRailRules {
        /// <summary>Default bed depth in cells (`RAIL_BED_DEPTH`).</summary>
        public const int BedDepth = 3;
        /// <summary>`trainScaleForStorey()` — the scale the source's consist maths applies.</summary>
        public const double TrainScale = 0.98;
        /// <summary>Clear courses above a third-rail bed (`trackHeadroom`).</summary>
        public const int ThirdRailHeadroom = 3;
        /// <summary>Clear courses above a catenary/gantry bed.</summary>
        public const int CatenaryHeadroom = 4;

        static readonly StationStockSpec[] Stock = {
            new StationStockSpec("A", 3.0, 22.0),
            new StationStockSpec("B", 2.8, 19.5),
            new StationStockSpec("C", 2.6, 19.0),
            new StationStockSpec("L", 2.8, 16.8),
            new StationStockSpec("D", 3.3, 20.1),
        };

        public static StationStockSpec StockOf(string stockClass) {
            for (int i = 0; i < Stock.Length; i++) {
                if (string.Equals(Stock[i].Class, stockClass, StringComparison.Ordinal)) return Stock[i];
            }
            return Stock[1];
        }

        public static int NormRot(int rot) => ((rot % 4) + 4) % 4;

        /// <summary>Local offset (i along the run, j across the bed) → world offset.</summary>
        public static void RotateLocal(int rot, double i, double j, out double x, out double y) {
            switch (NormRot(rot)) {
                case 1: x = -j; y = i; break;
                case 2: x = -i; y = -j; break;
                case 3: x = j; y = -i; break;
                default: x = i; y = j; break;
            }
        }

        /// <summary>`trainLength`: the consist's own length in metres.</summary>
        public static double TrainLength(StationLineRecord line) {
            if (line == null) return 0;
            var stock = StockOf(line.Stock);
            int cars = Math.Max(0, line.Cars);
            return stock.Length * cars * TrainScale;
        }

        /// <summary>`trackPieceForLine`: the footprint the bound line's consist needs.</summary>
        public static void PieceForLine(StationLineRecord line, out int width, out int depth) {
            var stock = StockOf(line != null ? line.Stock : "");
            int cars = line != null ? Math.Max(1, line.Cars) : 6;
            width = Math.Max(1, (int)Math.Ceiling(stock.Length * cars * TrainScale));
            depth = Math.Max(BedDepth, (int)Math.Ceiling(stock.Width * TrainScale));
        }

        /// <summary>`trackHeadroom`: clear courses above the bed, including overhead supports.</summary>
        public static int Headroom(string power, bool tunnel, bool bridge, string catenaryStyle) {
            bool catenary = string.Equals(power, "catenary", StringComparison.Ordinal);
            bool gantry = string.Equals(catenaryStyle, "gantry", StringComparison.Ordinal);
            return catenary && !tunnel && (bridge || gantry) ? CatenaryHeadroom : ThirdRailHeadroom;
        }

        /// <summary>Every world cell a track's bed covers (`trackCells`).</summary>
        public static List<StationCellKey> Cells(int x, int y, int z, int w, int d, int rot) {
            var cells = new List<StationCellKey>(Math.Max(1, w) * Math.Max(1, d));
            for (int i = 0; i < w; i++) {
                for (int j = 0; j < d; j++) {
                    RotateLocal(rot, i, j, out var dx, out var dy);
                    cells.Add(new StationCellKey(x + (int)Math.Round(dx), y + (int)Math.Round(dy), z));
                }
            }
            return cells;
        }

        public static List<StationCellKey> Cells(StationModuleRecord track) {
            if (track == null) return new List<StationCellKey>();
            return Cells(track.X, track.Y, track.Z, Math.Max(1, track.Width), Math.Max(1, track.Depth), track.Rotation);
        }

        /// <summary>`trackCellAt`: is the coordinate one of this track's bed cells?</summary>
        public static bool Covers(StationModuleRecord track, int x, int y, int z) {
            if (track == null || z != track.Z) return false;
            RotateLocal(-(track.Rotation), x - track.X, y - track.Y, out var i, out var j);
            return i >= -1e-9 && i < Math.Max(1, track.Width) - 1e-9 &&
                   j >= -1e-9 && j < Math.Max(1, track.Depth) - 1e-9;
        }

        /// <summary>
        /// `trackOriginForCentre`: the module origin that puts a `w × d` piece's centre on the
        /// anchor cell, so an even run grows evenly either side of the highlighted tile.
        /// </summary>
        public static void OriginForCentre(int rot, int x, int y, int w, int d, out int originX, out int originY) {
            RotateLocal(rot, -Math.Floor((w - 1) / 2.0), -Math.Floor((d - 1) / 2.0), out var dx, out var dy);
            originX = x + (int)Math.Round(dx);
            originY = y + (int)Math.Round(dy);
        }

        /// <summary>The axis-aligned volume a track needs clear: its bed plus its headroom.</summary>
        public static StationBox SpaceBox(IReadOnlyList<StationCellKey> bed, int z, int headroom) {
            double x0 = double.PositiveInfinity, y0 = double.PositiveInfinity;
            double x1 = double.NegativeInfinity, y1 = double.NegativeInfinity;
            foreach (var cell in bed) {
                if (cell.X < x0) x0 = cell.X;
                if (cell.Y < y0) y0 = cell.Y;
                if (cell.X + 1 > x1) x1 = cell.X + 1;
                if (cell.Y + 1 > y1) y1 = cell.Y + 1;
            }
            if (double.IsInfinity(x0)) return new StationBox(0, 0, z, 0, 0, z + 1);
            return new StationBox(x0, y0, z - 1, x1, y1, z + headroom + 1);
        }
    }

    /// <summary>
    /// One rail gesture's verdict: the track piece it would lay, the bed it would dig, the
    /// pieces it would take with it, and a stable refusal code. A plan never writes.
    /// </summary>
    public sealed class StationRailPlan {
        public string LineId = "";
        public string Direction = "up";
        public int Rotation;
        public int X, Y, Z;
        public int Width = 1, Depth = 1;
        /// <summary>The track draft the release appends.</summary>
        public StationEditDraft Track;
        /// <summary>The screen doors derived from the track's platforms (`derivePlatformEdges`).</summary>
        public readonly List<StationEditDraft> DerivedEdges = new List<StationEditDraft>();
        /// <summary>Every bed cell the release removes (the bed itself and the course under it).</summary>
        public readonly List<StationCellKey> DigCells = new List<StationCellKey>();
        /// <summary>The cells the bed covers at the track's own level (the ghost's footprint).</summary>
        public readonly List<StationCellKey> Bed = new List<StationCellKey>();
        /// <summary>Pieces standing in the way, or on a cell the bed digs.</summary>
        public readonly List<string> ColliderIds = new List<string>();
        /// <summary>Pieces the release removes (only a secondary-press removal fills this).</summary>
        public readonly List<string> RemoveModuleIds = new List<string>();
        /// <summary>`interference`, `wall`, `floor`, `no-line`, `no-document`, `no-module`.</summary>
        public string Reason = "";
        /// <summary>True when the plan is a tunnel run rather than a surface platform.</summary>
        public bool Tunnel;
        public bool Ok => Reason.Length == 0;
        public bool HasWork => Track != null || DerivedEdges.Count > 0 || DigCells.Count > 0 ||
                               RemoveModuleIds.Count > 0;

        public StationCellPatch ToPatch() {
            var patch = new StationCellPatch();
            foreach (var cell in DigCells) patch.Add(StationCellWrite.Drop(cell));
            foreach (var id in RemoveModuleIds) if (!patch.RemoveModuleIds.Contains(id)) patch.RemoveModuleIds.Add(id);
            if (Track != null) patch.AddModule(Track);
            foreach (var edge in DerivedEdges) patch.AddModule(edge);
            return patch;
        }
    }

    /// <summary>
    /// The 站台 rail planner behind the `rail` tool (plan 27 §6): a port of
    /// `build/rail.ts`'s `trackPieceForLine` / `makeTrack` / `trackBlockReason` /
    /// `commitTrack` / `railModuleAt` and the `sim/placement.ts` clearance test the reason
    /// reads. A platform rail is a fixed piece: a car-width bed sized to the bound line's
    /// consist, dug into the floor it stands on, with its headroom held clear.
    ///
    /// Not ported in this slice, and refused rather than guessed: platform-edge/PSD
    /// derivation (`derivePlatformEdges`), bridge pillars and tunnel shells. The primary
    /// gesture lays a surface platform rail; the secondary press lifts one.
    /// </summary>
    public static class StationRailPlanner {
        /// <summary>
        /// `resizeTrack`: re-cut a platform rail at a new run length (and bed depth). The bed is
        /// dug again, the rail's **derived** screen doors are rebuilt for the new span, its tunnel
        /// shell is stripped so the bore can be re-cut, and its bridge pillars go with the old
        /// centreline (`cfg.bridgeId`). A resize that meets another rail is **refused whole**: the
        /// caller keeps the original document rather than a half-stripped one, which is the
        /// reference's own rule (`resizeTrack` returns the untouched state on a refusal).
        ///
        /// A derived edge whose id survives the resize is **replaced**, one that disappears is
        /// removed, and a new one is added — so a wider bed re-hangs the doors it still has
        /// instead of deleting and re-creating the same ids in one revision.
        /// </summary>
        public static StationCellPatch Resize(StationIndex index, string trackId, int width, int depth,
            out string reason) {
            reason = "";
            var patch = new StationCellPatch();
            if (index == null) { reason = "no-session"; return patch; }
            StationModuleRecord track = null;
            index.TryGetModule(trackId, out track);
            if (track == null || !string.Equals(track.Type, "track", StringComparison.Ordinal)) {
                reason = "no-track";
                return patch;
            }
            int w = Math.Max(1, width);
            int d = Math.Max(1, depth > 0 ? depth : track.Depth);
            if (w == track.Width && d == track.Depth) { reason = "no-change"; return patch; }
            var resized = StationModulePlacement.DraftOf(track);
            resized.Width = w;
            resized.Depth = d;
            // The new bed must not meet another rail: a wider bed is a new footprint, not a move.
            var bed = StationRailRules.Cells(resized.X, resized.Y, resized.Z, w, d, resized.Rotation);
            var existingTracks = index.ModulesOfType("track");
            for (int i = 0; i < existingTracks.Count; i++) {
                var module = existingTracks[i];
                if (module == null || string.Equals(module.Id, trackId, StringComparison.Ordinal)) continue;
                foreach (var cell in bed) {
                    if (!StationRailRules.Covers(module, cell.X, cell.Y, cell.Z)) continue;
                    reason = "interference";
                    return patch;
                }
            }
            var plan = new StationRailPlan { Track = resized };
            foreach (var cell in bed) {
                plan.DigCells.Add(cell);
                plan.DigCells.Add(new StationCellKey(cell.X, cell.Y, cell.Z - 1));
            }
            plan.DerivedEdges.AddRange(DerivePlatformEdges(index, plan));
            var fresh = new Dictionary<string, StationEditDraft>(StringComparer.Ordinal);
            foreach (var edge in plan.DerivedEdges) fresh[edge.Id] = edge;
            var prefix = "edge-" + trackId + "-";
            foreach (var module in index.Document.Modules) {
                if (module == null) continue;
                bool derived = module.Id.StartsWith(prefix, StringComparison.Ordinal);
                bool bridgePillar = string.Equals(module.Type, "pillar", StringComparison.Ordinal) &&
                    string.Equals(module.Config.Text("bridgeId"), trackId, StringComparison.Ordinal);
                if (!derived && !bridgePillar) continue;
                if (derived && fresh.ContainsKey(module.Id)) continue;
                if (!patch.RemoveModuleIds.Contains(module.Id)) patch.RemoveModuleIds.Add(module.Id);
            }
            foreach (var cell in plan.DigCells) patch.Add(StationCellWrite.Drop(cell));
            if (track.Config.Has("tunnel")) {
                foreach (var write in StationTunnelShell.Strip(index, track.Id)) patch.Writes.Add(write);
            }
            patch.ModuleReplaces.Add(resized);
            foreach (var edge in plan.DerivedEdges) patch.ModuleAdds.Add(edge);
            return patch;
        }

        /// <summary>
        /// `makeBridge`: a 桥梁 is a tunnel variant — the same fixed-length run hung off the free
        /// end of the hovered rail, with `cfg.bridge` (and its railing) instead of `cfg.tunnel`,
        /// so it spans the void above rather than boring through it. Its piers are derived per
        /// bay by `StationBridgePillars` at commit time.
        /// </summary>
        public static StationRailPlan PlanBridge(StationIndex index, string sourceId, int length,
            int atX, int atY, bool hasAt, string railing) {
            return PlanExtension(index, sourceId, length, atX, atY, hasAt,
                string.IsNullOrEmpty(railing) ? "railing" : railing);
        }

        /// <summary>The requested saved line, or the first saved line as a fallback.</summary>
        public static StationLineRecord ResolveLine(StationIndex index, string lineId) {
            if (index == null) return null;
            var lines = index.Document.Lines;
            if (!string.IsNullOrEmpty(lineId)) {
                foreach (var line in lines) if (string.Equals(line.Id, lineId, StringComparison.Ordinal)) return line;
            }
            return lines.Count > 0 ? lines[0] : null;
        }

        /// <summary>
        /// `trackBlockReason` + `commitTrack`'s refusal half for a **surface platform**: an
        /// existing rail or any placed piece sharing the track's space is `interference`, a
        /// solid in the headroom is `wall`, a bed cell without floor is `floor`.
        /// </summary>
        public static StationRailPlan Plan(StationIndex index, string lineId, string direction, int rotation,
            int x, int y, int z) {
            var plan = new StationRailPlan {
                LineId = lineId ?? "",
                Direction = string.IsNullOrEmpty(direction) ? "up" : direction,
                Rotation = StationRailRules.NormRot(rotation),
                X = x, Y = y, Z = z,
            };
            if (index == null) { plan.Reason = "no-document"; return plan; }
            var line = ResolveLine(index, lineId);
            if (line == null) {
                plan.Reason = "no-line";
                return plan;
            }
            plan.LineId = line.Id;
            StationRailRules.PieceForLine(line, out var width, out var depth);
            plan.Width = width;
            plan.Depth = depth;
            // The piece is centred on the pressed cell, so an even run grows both ways.
            StationRailRules.OriginForCentre(plan.Rotation, x, y, width, depth, out var originX, out var originY);
            plan.X = originX;
            plan.Y = originY;
            plan.Bed.AddRange(StationRailRules.Cells(originX, originY, z, width, depth, plan.Rotation));
            int headroom = StationRailRules.Headroom(line.Power, false, false, "");
            // 1. Another rail's bed is never shared: that is the reference's own overlap guard.
            var existingTracks = index.ModulesOfType("track");
            for (int t = 0; t < existingTracks.Count; t++) {
                var module = existingTracks[t];
                if (module == null) continue;
                foreach (var cell in plan.Bed) {
                    if (!StationRailRules.Covers(module, cell.X, cell.Y, cell.Z)) continue;
                    plan.ColliderIds.Add(module.Id);
                    break;
                }
            }
            if (plan.ColliderIds.Count > 0) { plan.Reason = "interference"; return plan; }
            // 2. A wall across the headroom: the platform's ceiling is somebody's floor.
            foreach (var cell in plan.Bed) {
                for (int dz = 1; dz <= headroom; dz++) {
                    var above = index.GetCell(cell.X, cell.Y, cell.Z + dz);
                    if (above != null && above.IsSolid) { plan.Reason = "wall"; return plan; }
                }
            }
            // 3. The whole bed rests on floor: authored solid, an exit pad, or the street.
            HashSet<(int X, int Y)> groundHolesAtZero = z == 0 ? CollectStaticGroundHoles(index) : null;
            foreach (var cell in plan.Bed) {
                var existingCell = index.GetCell(cell.X, cell.Y, cell.Z);
                if (existingCell != null) {
                    if (existingCell.IsSolid) continue;
                    plan.Reason = "floor";
                    return plan;
                }
                if (z == 0 && !groundHolesAtZero.Contains((cell.X, cell.Y))) continue;
                plan.Reason = "floor";
                return plan;
            }
            // 4. Interference: any placed piece whose reserved volume shares the track's space.
            var space = StationRailRules.SpaceBox(plan.Bed, z, headroom);
            var allModules = index.Document.Modules;
            for (int mIdx = 0; mIdx < allModules.Count; mIdx++) {
                var module = allModules[mIdx];
                if (module == null || module.Type == "track") continue;
                if (!CouldOverlapSpaceXY(module, space)) continue;
                // A hung fitting below the new bed hangs from its deck, so it never blocks it.
                if (StationFootprints.IsCeilingHung(module) && module.Z < z) continue;
                if (!StationFootprints.TryClearance(module, out var box, out _)) continue;
                if (box.Overlaps(space)) plan.ColliderIds.Add(module.Id);
            }
            if (plan.ColliderIds.Count > 0) { plan.Reason = "interference"; return plan; }
            var track = new StationEditDraft {
                Id = "",
                Type = "track",
                X = plan.X,
                Y = plan.Y,
                Z = plan.Z,
                Width = plan.Width,
                Depth = plan.Depth,
                Rotation = plan.Rotation,
            };
            track.Set("line", plan.LineId);
            track.Set("power", string.IsNullOrEmpty(line.Power) ? "third-rail" : line.Power);
            track.Set("dir", plan.Direction);
            plan.Track = track;
            // The bed is dug through two courses (`commitTrackRaw`): the floor the piece stands
            // on and the course beneath it, so the module supplies the recessed slab.
            foreach (var cell in plan.Bed) {
                plan.DigCells.Add(cell);
                plan.DigCells.Add(new StationCellKey(cell.X, cell.Y, cell.Z - 1));
            }
            // Anything anchored on a dug cell goes with the dig.
            CollectModulesOnDigCells(allModules, plan.DigCells, plan.RemoveModuleIds);
            return plan;
        }

        static HashSet<(int X, int Y)> CollectStaticGroundHoles(StationIndex index) {
            var holes = new HashSet<(int X, int Y)>();
            var tracks = index.ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var module = tracks[i];
                if (module == null || !StationFootprints.TrackCutsGround(module)) continue;
                foreach (var cell in StationFootprints.TrackCells(module)) {
                    holes.Add(((int)Math.Round(cell.X), (int)Math.Round(cell.Y)));
                }
            }
            string[] runTypes = { "stair", "escalator", "walkway", "lift" };
            for (int t = 0; t < runTypes.Length; t++) {
                var runs = index.ModulesOfType(runTypes[t]);
                for (int i = 0; i < runs.Count; i++) {
                    var run = runs[i];
                    if (run == null) continue;
                    foreach (var cell in StationFootprints.Footprint(run)) {
                        if (cell.Z == 0) holes.Add(((int)Math.Round(cell.X), (int)Math.Round(cell.Y)));
                    }
                }
            }
            var exits = index.ModulesOfType("exit");
            for (int i = 0; i < exits.Count; i++) {
                var module = exits[i];
                if (module == null || module.Z != 0) continue;
                var style = module.Config.Text("style");
                if (style == "doorway" || style == "virtual") continue;
                foreach (var cell in StationFootprints.ExitFootprint(module)) {
                    if (cell.Z == 0) holes.Add(((int)Math.Round(cell.X), (int)Math.Round(cell.Y)));
                }
            }
            return holes;
        }

        static bool CouldOverlapSpaceXY(StationModuleRecord module, StationBox space) {
            if (module.From.HasValue || module.To.HasValue) {
                double minX = module.X, maxX = module.X;
                double minY = module.Y, maxY = module.Y;
                if (module.From.HasValue) {
                    var f = module.From.Value;
                    if (f.X < minX) minX = f.X; if (f.X > maxX) maxX = f.X;
                    if (f.Y < minY) minY = f.Y; if (f.Y > maxY) maxY = f.Y;
                }
                if (module.To.HasValue) {
                    var t = module.To.Value;
                    if (t.X < minX) minX = t.X; if (t.X > maxX) maxX = t.X;
                    if (t.Y < minY) minY = t.Y; if (t.Y > maxY) maxY = t.Y;
                }
                const double margin = 10.0;
                return maxX + margin >= space.X0 && minX - margin <= space.X1 &&
                       maxY + margin >= space.Y0 && minY - margin <= space.Y1;
            }
            string type = module.Type;
            if (type == "road" || type == "court" || type == "exit" || type == "roof" || type == "platform-edge") {
                return true;
            }
            int span = Math.Max(Math.Max(module.Width, module.Depth), 1) + 8;
            return module.X + span >= space.X0 && module.X - span <= space.X1 &&
                   module.Y + span >= space.Y0 && module.Y - span <= space.Y1;
        }

        static void CollectModulesOnDigCells(
            IReadOnlyList<StationModuleRecord> modules,
            List<StationCellKey> digCells,
            List<string> removeIds) {
            if (digCells == null || digCells.Count == 0 || modules == null) return;
            var digSet = new HashSet<StationCellKey>(digCells.Count);
            int minX = int.MaxValue, maxX = int.MinValue;
            int minY = int.MaxValue, maxY = int.MinValue;
            int minZ = int.MaxValue, maxZ = int.MinValue;
            for (int i = 0; i < digCells.Count; i++) {
                var c = digCells[i];
                digSet.Add(c);
                if (c.X < minX) minX = c.X; if (c.X > maxX) maxX = c.X;
                if (c.Y < minY) minY = c.Y; if (c.Y > maxY) maxY = c.Y;
                if (c.Z < minZ) minZ = c.Z; if (c.Z > maxZ) maxZ = c.Z;
            }
            for (int i = 0; i < modules.Count; i++) {
                var module = modules[i];
                if (module == null) continue;
                if (module.X < minX || module.X > maxX || module.Y < minY || module.Y > maxY ||
                    module.Z < minZ || module.Z > maxZ) continue;
                if (digSet.Contains(new StationCellKey(module.X, module.Y, module.Z))) {
                    removeIds.Add(module.Id);
                }
            }
        }

        /// <summary>
        /// `derivePlatformEdges`: one `platform-edge` per contiguous run of platform floor
        /// beside the bed, on both sides. A platform is an authored walkable solid with nothing
        /// solid above it — the street is deliberately not one, so a rail laid on virgin ground
        /// derives no screens until the player lays a surface of their own beside it. The run
        /// follows the track's rotation, so a north–south rail gets north–south screens.
        /// </summary>
        public static List<StationEditDraft> DerivePlatformEdges(StationIndex index, StationRailPlan plan) {
            var edges = new List<StationEditDraft>();
            if (index == null || plan?.Track == null || plan.Tunnel) return edges;
            var track = plan.Track;
            var line = ResolveLine(index, plan.LineId);
            var dir = track.Text("dir");
            if (string.IsNullOrEmpty(dir)) dir = line != null && !string.IsNullOrEmpty(line.Direction) ? line.Direction : "up";
            var psd = line != null && !string.IsNullOrEmpty(line.Psd) ? line.Psd : "full";
            // `side` is read from the screen's own frame: a platform at local j = −1 sits on the
            // track's −y, which puts the track on the edge's +y (its "right").
            string[] sides = { "right", "left" };
            int[] offsets = { -1, plan.Depth };
            for (int s = 0; s < sides.Length; s++) {
                int j = offsets[s];
                var along = new List<int>();
                for (int i = 0; i < plan.Width; i++) {
                    StationRailRules.RotateLocal(plan.Rotation, i, j, out var dx, out var dy);
                    int x = plan.X + (int)Math.Round(dx), y = plan.Y + (int)Math.Round(dy);
                    var cell = index.GetCell(x, y, plan.Z);
                    if (cell == null || !cell.IsSolid) continue;
                    if (!Walks(cell)) continue;
                    var above = index.GetCell(x, y, plan.Z + 1);
                    if (above != null && above.IsSolid) continue;
                    along.Add(i);
                }
                bool sideRemoved = HasRemovedPsdSide(track, sides[s]);
                foreach (var run in RunsOf(along)) {
                    StationRailRules.RotateLocal(plan.Rotation, run.Start, j, out var ox, out var oy);
                    var edge = new StationEditDraft {
                        // One id per run: a block in the screen course splits a side into two
                        // runs, and the document refuses two records with the same id.
                        Id = "edge-" + track.Id + "-" + sides[s] + "-" + run.Start,
                        Type = "platform-edge",
                        X = plan.X + (int)Math.Round(ox),
                        Y = plan.Y + (int)Math.Round(oy),
                        Z = plan.Z,
                        Width = run.End - run.Start + 1,
                        Rotation = plan.Rotation,
                    };
                    edge.Set("name", "站台门");
                    edge.Set("line", plan.LineId);
                    edge.Set("dir", dir);
                    edge.Set("side", sides[s]);
                    edge.Set("psd", sideRemoved ? "none" : psd);
                    edge.Set("from", track.Id);
                    edges.Add(edge);
                }
            }
            return edges;
        }

        /// <summary>True when a `platform-edge` has already had its screen removed (`cfg.psd == "none"`).</summary>
        public static bool IsBarePlatformEdge(StationModuleRecord module) =>
            module != null &&
            string.Equals(module.Type, "platform-edge", StringComparison.Ordinal) &&
            string.Equals(module.Config.Text("psd"), "none", StringComparison.Ordinal);

        /// <summary>True when <paramref name="track"/> carries <paramref name="side"/> in `cfg.removedPsdSides`.</summary>
        public static bool HasRemovedPsdSide(StationEditDraft track, string side) {
            if (track == null || string.IsNullOrEmpty(side)) return false;
            return ContainsJsonSide(track.Text("removedPsdSides"), side);
        }

        /// <summary>
        /// Port of `Equipment.ts:removeModule`'s `platform-edge` branch (§5.9): strip the
        /// physical screen (`cfg.psd = "none"`) while keeping the platform's boarding edge and
        /// yellow safety line, and record the stripped side on the parent track's
        /// `cfg.removedPsdSides` so subsequent floor edits or stock resizes preserve the choice.
        /// Returns false when the edge already has `psd: "none"`.
        /// </summary>
        public static bool PlanRemovePsd(StationIndex index, StationModuleRecord edge, StationCellPatch patch) {
            if (index == null || edge == null || patch == null) return false;
            if (!string.Equals(edge.Type, "platform-edge", StringComparison.Ordinal)) return false;
            if (IsBarePlatformEdge(edge)) return false;

            var edgeDraft = FindReplaceDraft(patch, edge.Id);
            if (edgeDraft == null) {
                edgeDraft = StationModulePlacement.DraftOf(edge);
                patch.ModuleReplaces.Add(edgeDraft);
            }
            edgeDraft.Set("psd", "none");
            patch.Changed++;

            string fromId = edge.Config.Text("from");
            string side = edge.Config.Text("side");
            if (fromId.Length > 0 &&
                (string.Equals(side, "left", StringComparison.Ordinal) ||
                 string.Equals(side, "right", StringComparison.Ordinal)) &&
                index.TryGetModule(fromId, out var track) &&
                track != null &&
                string.Equals(track.Type, "track", StringComparison.Ordinal)) {
                var trackDraft = FindReplaceDraft(patch, track.Id);
                bool addedTrack = false;
                if (trackDraft == null) {
                    trackDraft = StationModulePlacement.DraftOf(track);
                    addedTrack = true;
                }
                string before = trackDraft.Text("removedPsdSides");
                if (!ContainsJsonSide(before, side)) {
                    trackDraft.SetJson("removedPsdSides", AppendJsonSide(before, side));
                    if (addedTrack) patch.ModuleReplaces.Add(trackDraft);
                    patch.Changed++;
                }
            }
            return true;
        }

        static StationEditDraft FindReplaceDraft(StationCellPatch patch, string id) {
            for (int i = 0; i < patch.ModuleReplaces.Count; i++) {
                var existing = patch.ModuleReplaces[i];
                if (existing != null && string.Equals(existing.Id, id, StringComparison.Ordinal)) return existing;
            }
            return null;
        }

        static bool ContainsJsonSide(string json, string side) {
            if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(side)) return false;
            return json.IndexOf("\"" + side + "\"", StringComparison.Ordinal) >= 0;
        }

        static string AppendJsonSide(string json, string side) {
            var sides = new List<string>(2);
            if (!string.IsNullOrEmpty(json)) {
                int pos = 0;
                while (pos < json.Length) {
                    int q0 = json.IndexOf('"', pos);
                    if (q0 < 0) break;
                    int q1 = json.IndexOf('"', q0 + 1);
                    if (q1 < 0) break;
                    string item = json.Substring(q0 + 1, q1 - q0 - 1);
                    if (item.Length > 0 && !sides.Contains(item)) sides.Add(item);
                    pos = q1 + 1;
                }
            }
            if (!sides.Contains(side)) sides.Add(side);
            var sb = new System.Text.StringBuilder("[");
            for (int i = 0; i < sides.Count; i++) {
                if (i > 0) sb.Append(',');
                sb.Append('"').Append(sides[i]).Append('"');
            }
            sb.Append(']');
            return sb.ToString();
        }

        /// <summary>True when a cell's top finish walks (`floorSpeed &gt; 0`).</summary>
        static bool Walks(StationCellRecord cell) {
            var id = StationFinishIds.BaseId(string.IsNullOrEmpty(cell.FinishTop)
                ? StationFinishIds.DefaultMaterial
                : cell.FinishTop);
            return !string.Equals(id, "floor.track", StringComparison.Ordinal) &&
                   !string.Equals(id, "floor.soil", StringComparison.Ordinal);
        }

        /// <summary>Contiguous ascending runs in a de-duplicated list (`runsOf`).</summary>
        static List<(int Start, int End)> RunsOf(List<int> xs) {
            var runs = new List<(int, int)>();
            int start = 0, prev = 0;
            bool open = false;
            foreach (var x in xs) {
                if (!open) { start = x; open = true; } else if (x != prev + 1) {
                    runs.Add((start, prev));
                    start = x;
                }
                prev = x;
            }
            if (open) runs.Add((start, prev));
            return runs;
        }

        /// <summary>`railModuleAt`: the track whose bed covers the coordinate.</summary>
        public static StationModuleRecord RailAt(StationIndex index, int x, int y, int z) {
            if (index == null) return null;
            var tracks = index.ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var module = tracks[i];
                if (module != null && StationRailRules.Covers(module, x, y, z)) return module;
            }
            return null;
        }

        /// <summary>
        /// Lift one rail: the track and the screen doors it derived (`platform-edge` records
        /// whose `from` names it). The bed stays dug — the reference's `removeRail` lifts the
        /// module, not the ground under it.
        /// </summary>
        public static StationRailPlan PlanRemoval(StationIndex index, string moduleId) {
            var plan = new StationRailPlan();
            if (index == null) { plan.Reason = "no-document"; return plan; }
            if (string.IsNullOrEmpty(moduleId) || !index.TryGetModule(moduleId, out var track) || track == null) {
                plan.Reason = "no-module";
                return plan;
            }
            if (!string.Equals(track.Type, "track", StringComparison.Ordinal)) { plan.Reason = "no-module"; return plan; }
            plan.LineId = track.Config.Text("line");
            plan.X = track.X; plan.Y = track.Y; plan.Z = track.Z;
            plan.Width = track.Width; plan.Depth = track.Depth;
            plan.Rotation = track.Rotation;
            plan.Bed.AddRange(StationRailRules.Cells(track));
            plan.RemoveModuleIds.Add(track.Id);
            foreach (var refId in index.ReferrersOf(track.Id)) {
                if (!index.TryGetModule(refId, out var module) || module == null) continue;
                if (string.Equals(module.Type, "track", StringComparison.Ordinal)) continue;
                if (!string.Equals(module.Config.Text("from"), track.Id, StringComparison.Ordinal)) continue;
                plan.RemoveModuleIds.Add(module.Id);
            }
            return plan;
        }
        /// <summary>
        /// `freeTunnelEnd`: the end of `src` a tunnel should grow from. The nearer end to the
        /// hovered cell wins, so the preview appears where the pointer is; if that end already
        /// carries a track the other free end is used instead, and a run with both ends taken
        /// keeps the preferred one (its placement is then refused by the overlap check).
        /// </summary>
        public static int FreeTunnelEnd(StationIndex index, StationModuleRecord src, int atX, int atY, bool hasAt) {
            if (index == null || src == null) return 1;
            int rot = src.Rotation;
            int d = Math.Max(1, src.Depth);
            bool Used(int i) {
                for (int j = 0; j < d; j++) {
                    StationRailRules.RotateLocal(rot, i, j, out var dx, out var dy);
                    if (RailAt(index, src.X + (int)Math.Round(dx), src.Y + (int)Math.Round(dy), src.Z) != null) return true;
                }
                return false;
            }
            bool forwardFree = !Used(Math.Max(1, src.Width));
            bool backwardFree = !Used(-1);
            int prefer = 1;
            if (hasAt) {
                StationRailRules.RotateLocal(-rot, atX - src.X, atY - src.Y, out var i, out _);
                prefer = i > (Math.Max(1, src.Width) - 1) / 2.0 ? 1 : -1;
            }
            if (prefer > 0) return forwardFree ? 1 : backwardFree ? -1 : 1;
            return backwardFree ? -1 : forwardFree ? 1 : -1;
        }

        /// <summary>
        /// `makeTunnel`: a run continuing `src` off one end, keeping its axis, rotation and bed
        /// depth so it lines up cell for cell. `length` is in whole metres.
        /// </summary>
        public static StationEditDraft MakeTunnel(StationModuleRecord src, int end, int length, string id) {
            int w = Math.Max(1, length);
            StationRailRules.RotateLocal(src.Rotation, end > 0 ? Math.Max(1, src.Width) : -w, 0, out var dx, out var dy);
            var draft = new StationEditDraft {
                Id = id ?? "",
                Type = "track",
                X = src.X + (int)Math.Round(dx),
                Y = src.Y + (int)Math.Round(dy),
                Z = src.Z,
                Width = w,
                Depth = Math.Max(1, src.Depth),
                Rotation = src.Rotation,
            };
            draft.Set("line", src.Config.Text("line"));
            var dir = src.Config.Text("dir");
            draft.Set("dir", string.IsNullOrEmpty(dir) ? "up" : dir);
            var power = src.Config.Text("power");
            draft.Set("power", string.IsNullOrEmpty(power) ? "third-rail" : power);
            draft.Set(true, "tunnel");
            return draft;
        }

        /// <summary>
        /// The tunnel tool's plan (plan 27 §6): a fixed-length extension hung off the free end of
        /// the hovered rail, along that rail's own axis. A tunnel bores through walls and hangs
        /// over void, so only another rail's bed in the way refuses it. The shell
        /// (`boreTunnel`) is not ported yet; the run itself is the authored `track` record.
        /// </summary>
        public static StationRailPlan PlanTunnel(StationIndex index, string sourceId, int length, int atX, int atY, bool hasAt) =>
            PlanExtension(index, sourceId, length, atX, atY, hasAt, null);

        static StationRailPlan PlanExtension(StationIndex index, string sourceId, int length, int atX, int atY,
            bool hasAt, string railing) {
            bool bridge = railing != null;
            var plan = new StationRailPlan { Direction = "up", Tunnel = !bridge };
            if (index == null) { plan.Reason = "no-document"; return plan; }
            if (string.IsNullOrEmpty(sourceId) || !index.TryGetModule(sourceId, out var source) || source == null ||
                !string.Equals(source.Type, "track", StringComparison.Ordinal)) {
                plan.Reason = "no-module";
                return plan;
            }
            int end = FreeTunnelEnd(index, source, atX, atY, hasAt);
            var draft = MakeTunnel(source, end, length, "");
            if (bridge) {
                if (draft.Z < StationFootprints.GroundZ) { plan.Reason = "bridge-below-ground"; return plan; }
                draft.Config.Remove("tunnel");
                draft.Set("bridge", "1");
                draft.Set("bridgeRailing", railing);
            }
            plan.LineId = draft.Text("line");
            plan.Direction = draft.Text("dir");
            plan.X = draft.X; plan.Y = draft.Y; plan.Z = draft.Z;
            plan.Width = draft.Width; plan.Depth = draft.Depth;
            plan.Rotation = draft.Rotation;
            plan.Bed.AddRange(StationRailRules.Cells(draft.X, draft.Y, draft.Z, draft.Width, draft.Depth, draft.Rotation));
            var existingTracks = index.ModulesOfType("track");
            for (int t = 0; t < existingTracks.Count; t++) {
                var module = existingTracks[t];
                if (module == null) continue;
                foreach (var cell in plan.Bed) {
                    if (!StationRailRules.Covers(module, cell.X, cell.Y, cell.Z)) continue;
                    plan.ColliderIds.Add(module.Id);
                    break;
                }
            }
            if (plan.ColliderIds.Count > 0) { plan.Reason = "interference"; return plan; }
            int headroom = StationRailRules.Headroom(draft.Text("power"), !bridge, bridge, "");
            var space = StationRailRules.SpaceBox(plan.Bed, draft.Z, headroom);
            var allModules = index.Document.Modules;
            for (int mIdx = 0; mIdx < allModules.Count; mIdx++) {
                var module = allModules[mIdx];
                if (module == null || module.Type == "track") continue;
                if (!CouldOverlapSpaceXY(module, space)) continue;
                if (StationFootprints.IsCeilingHung(module) && module.Z < draft.Z) continue;
                if (!StationFootprints.TryClearance(module, out var box, out _)) continue;
                if (box.Overlaps(space)) plan.ColliderIds.Add(module.Id);
            }
            if (plan.ColliderIds.Count > 0) { plan.Reason = "interference"; return plan; }
            if (bridge) {
                foreach (var cell in plan.Bed) {
                    if (cell.Z > StationFootprints.GroundZ + StationBridgePillars.DeckDepth &&
                        index.GetCell(cell.X, cell.Y, cell.Z - 1)?.IsSolid == true) {
                        plan.Reason = "wall";
                        return plan;
                    }
                    for (int dz = 1; dz <= headroom; dz++) {
                        if (index.GetCell(cell.X, cell.Y, cell.Z + dz)?.IsSolid != true) continue;
                        plan.Reason = "wall";
                        return plan;
                    }
                }
            }
            plan.Track = draft;
            foreach (var cell in plan.Bed) {
                plan.DigCells.Add(cell);
                plan.DigCells.Add(new StationCellKey(cell.X, cell.Y, cell.Z - 1));
            }
            CollectModulesOnDigCells(allModules, plan.DigCells, plan.RemoveModuleIds);
            return plan;
        }
    }
}
