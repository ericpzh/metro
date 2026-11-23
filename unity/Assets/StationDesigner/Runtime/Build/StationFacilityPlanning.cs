using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>An inclusive axis-aligned footprint on one floor level (`Facilities.ts` `FacilityRect`).</summary>
    public readonly struct StationFacilityRect : IEquatable<StationFacilityRect> {
        public readonly int X0, Y0, X1, Y1, Z;

        public StationFacilityRect(int x0, int y0, int x1, int y1, int z) {
            X0 = Math.Min(x0, x1); Y0 = Math.Min(y0, y1);
            X1 = Math.Max(x0, x1); Y1 = Math.Max(y0, y1);
            Z = z;
        }

        public int Width => X1 - X0 + 1;
        public int Height => Y1 - Y0 + 1;
        public int CellCount => Width * Height;
        public bool SameAs(StationFacilityRect other) =>
            X0 == other.X0 && Y0 == other.Y0 && X1 == other.X1 && Y1 == other.Y1 && Z == other.Z;
        public bool Equals(StationFacilityRect other) => SameAs(other);
        public override bool Equals(object obj) => obj is StationFacilityRect other && SameAs(other);
        public override int GetHashCode() => unchecked((((X0 * 397) ^ Y0) * 397 ^ X1) * 397 ^ (Y1 * 397 ^ Z));
        public override string ToString() => "(" + X0 + "," + Y0 + ")-(" + X1 + "," + Y1 + ") z" + Z;
    }

    /// <summary>One auto-furniture unit's floor cell and quarter-turn (`FurnitureSpot`).</summary>
    public sealed class StationFurnitureSpot {
        public string Type = "bench";
        public int X;
        public int Y;
        public int Rotation;
    }

    /// <summary>
    /// The facility-room rules shared by the 分区 brush's counter tiles and the inspector
    /// (`build/model/Facilities.ts`): the two booth brushes, the minimum room size, the
    /// signature a drag compares, and the perimeter test a walled room's walls hang off.
    /// </summary>
    public static class StationFacilityRules {
        /// <summary>Minimum room size: walls plus at least one metre of walkable interior.</summary>
        public const int Min = 3;
        /// <summary>Largest room a drag may draw (`placeFacility`'s 400-cell guard).</summary>
        public const int MaxCells = 400;
        /// <summary>Wall height in blocks above the floor: a shop is a full room.</summary>
        public const int ShopWallH = 3;

        /// <summary>The auto furniture a room stocks, individually bulldozable.</summary>
        public static bool IsFurniture(string type) =>
            type == "bench" || type == "shelf" || type == "desk" || type == "cubicle" || type == "sink";

        public static bool IsFacility(string type) => type == "shop" || type == "booth" || type == "retail";

        /// <summary>The two counter brushes: they build a `booth`, not a walled room.</summary>
        public static bool IsBoothBrush(string kind) => kind == "ticket" || kind == "info";

        public static bool IsWalledRoomBrush(string kind) => kind == "store" || kind == "toilet" || kind == "office";

        public static bool IsFacilityBrush(string kind) => IsBoothBrush(kind) || IsWalledRoomBrush(kind);

        /// <summary>
        /// `facilitySignature`: two rooms merge only when their kind matches, so a toilet
        /// drawn over a shop is a clash rather than a silent fit-out swap.
        /// </summary>
        public static string Signature(string type, string kind) {
            if (type == "shop") return "shop:" + (string.IsNullOrEmpty(kind) ? "store" : kind);
            if (type == "booth") return "booth:" + (string.IsNullOrEmpty(kind) ? "ticket" : kind);
            return type ?? "";
        }

        /// <summary>The signature a brush builds — the twin of <see cref="Signature"/>.</summary>
        public static string BrushSignature(string kind) =>
            IsWalledRoomBrush(kind) ? "shop:" + kind : "booth:" + kind;

        public static StationFacilityRect RectOf(StationModuleRecord module) {
            int w = Math.Max(1, module.Width);
            int h = Math.Max(1, module.Height > 1 ? module.Height : module.Depth);
            return new StationFacilityRect(module.X, module.Y, module.X + w - 1, module.Y + h - 1, module.Z);
        }

        /// <summary>`facilityCovers`: true when <paramref name="rect"/> covers the whole room footprint.</summary>
        public static bool Covers(StationModuleRecord module, StationFacilityRect rect) {
            if (module == null) return false;
            var own = RectOf(module);
            return rect.Z == own.Z && rect.X0 <= own.X0 && rect.Y0 <= own.Y0 && rect.X1 >= own.X1 && rect.Y1 >= own.Y1;
        }

        /// <summary>True when two rects share at least one cell on the same level.</summary>
        public static bool Overlaps(StationFacilityRect a, StationFacilityRect b) =>
            a.Z == b.Z && a.X0 <= b.X1 && a.X1 >= b.X0 && a.Y0 <= b.Y1 && a.Y1 >= b.Y0;

        public static StationFacilityRect Union(StationFacilityRect a, StationFacilityRect b) =>
            new StationFacilityRect(Math.Min(a.X0, b.X0), Math.Min(a.Y0, b.Y0),
                Math.Max(a.X1, b.X1), Math.Max(a.Y1, b.Y1), a.Z);

        public static bool IsPerimeter(StationFacilityRect rect, int x, int y) =>
            x == rect.X0 || x == rect.X1 || y == rect.Y0 || y == rect.Y1;

        /// <summary>The cells a rect covers on its own level, in row order.</summary>
        public static List<StationCellKey> Cells(StationFacilityRect rect) {
            var cells = new List<StationCellKey>(rect.CellCount);
            for (int y = rect.Y0; y <= rect.Y1; y++)
                for (int x = rect.X0; x <= rect.X1; x++)
                    cells.Add(new StationCellKey(x, y, rect.Z));
            return cells;
        }
    }

    /// <summary>
    /// One facility gesture's verdict: the room it would build (or extend), the pieces it
    /// absorbs, and the cell/module writes the release would make. A plan never writes.
    /// </summary>
    public sealed class StationFacilityPlan {
        public string Kind = "";
        public StationFacilityRect Rect;
        /// <summary>Same-type rooms a placement absorbs into the union.</summary>
        public readonly List<StationModuleRecord> Merge = new List<StationModuleRecord>();
        /// <summary>A different-type room the drag overlaps.</summary>
        public StationModuleRecord BlockedBy;
        /// <summary>`clash`, `min-size`, `too-large`, `no-floor`, `no-module`, `unsupported-brush`.</summary>
        public string Reason = "";
        /// <summary>The room the release would build: a fresh booth, or the merged room rewritten.</summary>
        public StationEditDraft Room;
        /// <summary>True when <see cref="Room"/> rewrites an existing record instead of appending.</summary>
        public bool RoomReplaces;
        /// <summary>The auto furniture the release adds.</summary>
        public readonly List<StationEditDraft> Adds = new List<StationEditDraft>();
        /// <summary>The pieces the release removes: absorbed rooms and their auto furniture.</summary>
        public readonly List<string> Removes = new List<string>();
        /// <summary>Cells the release removes (a walled room's own walls).</summary>
        public readonly List<StationCellKey> DropCells = new List<StationCellKey>();

        public bool Ok => Reason.Length == 0;
        public bool HasWork => Room != null || Adds.Count > 0 || Removes.Count > 0 || DropCells.Count > 0;
        public int Width => Rect.Width;
        public int Height => Rect.Height;

        /// <summary>The same work as one cell patch, for `StationEditSession.TryApplyCells`.</summary>
        public StationCellPatch ToPatch() {
            var patch = new StationCellPatch();
            foreach (var cell in DropCells) patch.Add(StationCellWrite.Drop(cell));
            foreach (var id in Removes) if (!patch.RemoveModuleIds.Contains(id)) patch.RemoveModuleIds.Add(id);
            if (Room != null) {
                if (RoomReplaces) patch.ReplaceModule(Room);
                else patch.AddModule(Room);
            }
            foreach (var draft in Adds) patch.AddModule(draft);
            return patch;
        }
    }

    /// <summary>
    /// The facility-room planner behind the 分区 folder's counter tiles and the inspector
    /// (plan 27 §6): a port of `build/model/Facilities.ts`'s `facilityStandZ`, `facilityPlan`,
    /// `placeFacility` and `removeFacility` for the two booth brushes the palette arms
    /// (售票亭 / 问询台), plus the walled-room removal the same rules define.
    ///
    /// A booth is not a walled room: it is a desk counter around open floor, staffed from
    /// outside, with one auto bench per back-row interior cell. A drag that overlaps another
    /// booth of the same kind extends it into one room covering the union; overlapping a
    /// different kind is refused. Nothing here writes or reads a scene.
    /// </summary>
    public static class StationFacilityPlanner {
        /// <summary>
        /// `facilityStandZ`: the level a room stands on, read from the **block under the
        /// pointer**. A wall course is not a floor — the pointer often lands on the room's own
        /// wall — so the column walks down through the contiguous wall to the course's foot. A
        /// plain block is never walked through: the block the pointer names is the floor.
        /// </summary>
        public static int StandZ(StationIndex index, int x, int y, int z) {
            if (index == null) return z;
            int at = z;
            for (;;) {
                var cell = index.GetCell(x, y, at);
                if (cell == null || !cell.IsSolid || !StationCellRules.IsWallBlock(cell.Tags)) return at;
                at--;
            }
        }

        /// <summary>
        /// `facilityAt`: the room a cell belongs to — its floor or any of its wall courses —
        /// so a right-click on a wall finds the store it should edit.
        /// </summary>
        public static StationModuleRecord At(StationIndex index, int x, int y, int z) {
            if (index == null) return null;
            foreach (var module in index.Document.Modules) {
                if (!StationFacilityRules.IsFacility(module.Type)) continue;
                var rect = StationFacilityRules.RectOf(module);
                if (x < rect.X0 || x > rect.X1 || y < rect.Y0 || y > rect.Y1) continue;
                if (z < module.Z || z > module.Z + StationFacilityRules.ShopWallH) continue;
                return module;
            }
            return null;
        }

        /// <summary>
        /// `facilityPlan` + `placeFacility` for one drag: the union the room would occupy, the
        /// same-kind rooms it absorbs, and every refusal the release would hit. The plan is the
        /// value the ghost draws **and** the release commits, so a blue room cannot refuse.
        /// </summary>
        public static StationFacilityPlan Plan(StationIndex index, string kind, StationFacilityRect rect, int front) {
            var plan = new StationFacilityPlan { Kind = kind ?? "", Rect = rect };
            if (index == null) { plan.Reason = "no-document"; return plan; }
            if (!StationFacilityRules.IsFacilityBrush(plan.Kind)) { plan.Reason = "unsupported-brush"; return plan; }
            bool walled = StationFacilityRules.IsWalledRoomBrush(plan.Kind);
            var want = StationFacilityRules.BrushSignature(plan.Kind);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var current = rect;
            for (;;) {
                bool grew = false;
                foreach (var module in index.Document.Modules) {
                    if (module == null || !StationFacilityRules.IsFacility(module.Type)) continue;
                    var own = StationFacilityRules.RectOf(module);
                    if (!StationFacilityRules.Overlaps(current, own)) continue;
                    var signature = StationFacilityRules.Signature(module.Type, module.Config.Text("kind"));
                    if (!string.Equals(signature, want, StringComparison.Ordinal)) {
                        plan.Rect = current;
                        plan.BlockedBy = module;
                        plan.Reason = "clash";
                        return plan;
                    }
                    if (!seen.Add(module.Id)) continue;
                    plan.Merge.Add(module);
                    var grown = StationFacilityRules.Union(current, own);
                    if (!grown.SameAs(current)) grew = true;
                    current = grown;
                }
                plan.Rect = current;
                if (!grew) break;
            }
            if (current.Width < StationFacilityRules.Min || current.Height < StationFacilityRules.Min) {
                plan.Reason = "min-size";
                return plan;
            }
            if (current.CellCount > StationFacilityRules.MaxCells) { plan.Reason = "too-large"; return plan; }
            // Every rect cell must already be floor — at grade the implicit street is floor,
            // so a room or counter may be drawn on virgin ground, but never across a dug hole.
            for (int y = current.Y0; y <= current.Y1; y++) {
                for (int x = current.X0; x <= current.X1; x++) {
                    if (StationFootprints.IsSolidAt(index, x, y, current.Z)) continue;
                    plan.Reason = "no-floor";
                    return plan;
                }
            }
            var reserved = new HashSet<string>(StringComparer.Ordinal);
            if (walled) {
                string roomId = plan.Merge.Count > 0 ? plan.Merge[0].Id : NextFreeId(index, plan.Kind, reserved);
                var keptDoors = CollectKeptPerimeterDoors(plan.Merge, current);
                var shop = new StationEditDraft {
                    Id = roomId,
                    Type = "shop",
                    X = current.X0,
                    Y = current.Y0,
                    Z = current.Z,
                    Width = current.Width,
                    Height = current.Height,
                    Rotation = 0,
                };
                shop.Set("kind", plan.Kind);
                shop.SetJson("door", FormatDoorArray(keptDoors));
                shop.Set(true, "stocked");
                plan.Room = shop;
                plan.RoomReplaces = plan.Merge.Count > 0;

                // Clear interior walls from absorbed rooms while keeping any wall cell on the new
                // union perimeter or needed by a surviving unmerged walled room.
                if (plan.Merge.Count > 0) {
                    var mergedIds = new HashSet<string>(StringComparer.Ordinal);
                    for (int i = 0; i < plan.Merge.Count; i++) mergedIds.Add(plan.Merge[i].Id);
                    var keep = new HashSet<StationCellKey>();
                    for (int y = current.Y0; y <= current.Y1; y++) {
                        for (int x = current.X0; x <= current.X1; x++) {
                            if (!StationFacilityRules.IsPerimeter(current, x, y)) continue;
                            for (int dz = 1; dz <= StationFacilityRules.ShopWallH; dz++) {
                                keep.Add(new StationCellKey(x, y, current.Z + dz));
                            }
                        }
                    }
                    foreach (var other in index.Document.Modules) {
                        if (other == null || mergedIds.Contains(other.Id) || other.Type != "shop") continue;
                        foreach (var cell in WallCells(index, other)) keep.Add(cell);
                    }
                    var dropSet = new HashSet<StationCellKey>();
                    foreach (var merged in plan.Merge) {
                        bool keepsId = plan.RoomReplaces && string.Equals(merged.Id, roomId, StringComparison.Ordinal);
                        if (!keepsId) plan.Removes.Add(merged.Id);
                        foreach (var id in AutoFurnitureIn(index, StationFacilityRules.RectOf(merged))) {
                            if (!plan.Removes.Contains(id)) plan.Removes.Add(id);
                        }
                        foreach (var cell in WallCells(index, merged)) {
                            if (!keep.Contains(cell) && dropSet.Add(cell)) plan.DropCells.Add(cell);
                        }
                    }
                }
                return plan;
            }

            string boothId = plan.Merge.Count > 0 ? plan.Merge[0].Id : NextFreeId(index, "booth", reserved);
            var booth = new StationEditDraft {
                Id = boothId,
                Type = "booth",
                X = current.X0,
                Y = current.Y0,
                Z = current.Z,
                Width = current.Width,
                Height = current.Height,
                Rotation = 0,
            };
            booth.Set("kind", plan.Kind);
            booth.Set(true, "stocked");
            booth.Set(((front % 4) + 4) % 4, "front");
            // Extending reuses the absorbed room's id, so its record is rewritten rather than a
            // second room appended (`placeFacility` keeps `plan.merge[0].id`).
            plan.Room = booth;
            plan.RoomReplaces = plan.Merge.Count > 0;
            // `addAutoFurniture`: one bench per back-row interior cell, skipping a cell that
            // already holds furniture on that level (a hand-placed 货架 keeps its cell).
            var taken = new HashSet<(int, int)>();
            foreach (var module in index.Document.Modules) {
                if (module == null || !StationFacilityRules.IsFurniture(module.Type) || module.Z != current.Z) continue;
                taken.Add((module.X, module.Y));
            }
            foreach (var spot in BoothBenchSpots(current, front)) {
                if (!taken.Add((spot.X, spot.Y))) continue;
                var bench = new StationEditDraft {
                    Id = NextFreeId(index, "bench", reserved),
                    Type = "bench",
                    X = spot.X,
                    Y = spot.Y,
                    Z = current.Z,
                    Rotation = spot.Rotation,
                };
                bench.Set(true, "auto");
                plan.Adds.Add(bench);
            }
            // Absorbed rooms go first, with the auto furniture they had stocked — including the
            // room whose id the union keeps: it is rewritten, and its old fit-out is re-stocked
            // against the union so no bench is left standing inside the new room.
            foreach (var merged in plan.Merge) {
                bool keepsId = plan.RoomReplaces && string.Equals(merged.Id, boothId, StringComparison.Ordinal);
                if (!keepsId) plan.Removes.Add(merged.Id);
                foreach (var id in AutoFurnitureIn(index, StationFacilityRules.RectOf(merged))) plan.Removes.Add(id);
            }
            return plan;
        }

        /// <summary>
        /// `removeFacility`: bulldoze a booth (and its auto benches) or a walled room (and the
        /// auto walls only it needs). A removed room's generated furniture goes with it while
        /// hand-placed pieces stay behind on the floor.
        /// </summary>
        public static StationFacilityPlan PlanRemoval(StationIndex index, string moduleId) {
            var plan = new StationFacilityPlan();
            if (index == null) { plan.Reason = "no-document"; return plan; }
            if (string.IsNullOrEmpty(moduleId) || !index.TryGetModule(moduleId, out var module) || module == null) {
                plan.Reason = "no-module";
                return plan;
            }
            if (!StationFacilityRules.IsFacility(module.Type)) { plan.Reason = "not-facility"; return plan; }
            plan.Rect = StationFacilityRules.RectOf(module);
            plan.Kind = module.Config.Text("kind");
            plan.Removes.Add(module.Id);
            foreach (var id in AutoFurnitureIn(index, plan.Rect)) plan.Removes.Add(id);
            if (module.Type == "shop") {
                // A walled room's whole wall ring is its own; never a column a surviving room
                // still needs, and never the floor under it.
                var keep = new HashSet<StationCellKey>();
                foreach (var other in index.Document.Modules) {
                    if (other == null || other.Id == module.Id || other.Type != "shop") continue;
                    foreach (var cell in WallCells(index, other)) keep.Add(cell);
                }
                foreach (var cell in WallCells(index, module)) {
                    if (!keep.Contains(cell)) plan.DropCells.Add(cell);
                }
            }
            return plan;
        }

        /// <summary>`boothBenchSpots`: one bench per back-row interior cell, facing the public front.</summary>
        public static List<StationFurnitureSpot> BoothBenchSpots(StationFacilityRect rect, int front) {
            var spots = new List<StationFurnitureSpot>();
            int side = ((front % 4) + 4) % 4;
            if (side % 2 == 0) {
                if (rect.Y1 - 1 <= rect.Y0) return spots;
                int y = side == 0 ? rect.Y1 - 1 : rect.Y0;
                for (int x = rect.X0 + 1; x <= rect.X1 - 1; x++)
                    spots.Add(new StationFurnitureSpot { Type = "bench", X = x, Y = y, Rotation = (2 + side) % 4 });
            } else {
                if (rect.X1 - 1 <= rect.X0) return spots;
                int x = side == 1 ? rect.X0 : rect.X1 - 1;
                for (int y = rect.Y0 + 1; y <= rect.Y1 - 1; y++)
                    spots.Add(new StationFurnitureSpot { Type = "bench", X = x, Y = y, Rotation = (2 + side) % 4 });
            }
            return spots;
        }

        /// <summary>`facilityWallCells`: the solid courses a shop's own perimeter carries.</summary>
        public static List<StationCellKey> WallCells(StationIndex index, StationModuleRecord module) {
            var cells = new List<StationCellKey>();
            if (index == null || module == null || module.Type != "shop") return cells;
            var rect = StationFacilityRules.RectOf(module);
            for (int y = rect.Y0; y <= rect.Y1; y++) {
                for (int x = rect.X0; x <= rect.X1; x++) {
                    if (!StationFacilityRules.IsPerimeter(rect, x, y)) continue;
                    for (int dz = 1; dz <= StationFacilityRules.ShopWallH; dz++) {
                        var cell = index.GetCell(x, y, rect.Z + dz);
                        if (cell != null && cell.IsSolid) cells.Add(cell.Key);
                    }
                }
            }
            return cells;
        }

        /// <summary>`facilityOpeningCells`: wall cells on <paramref name="module"/>'s perimeter inside <paramref name="rect"/>.</summary>
        public static List<StationCellKey> OpeningCells(StationIndex index, StationModuleRecord module, StationFacilityRect rect) {
            var cells = new List<StationCellKey>();
            if (index == null || module == null || module.Type != "shop") return cells;
            foreach (var cell in WallCells(index, module)) {
                if (cell.X >= rect.X0 && cell.X <= rect.X1 && cell.Y >= rect.Y0 && cell.Y <= rect.Y1) {
                    cells.Add(cell);
                }
            }
            return cells;
        }

        /// <summary>
        /// `carveFacilityOpenings`: cut perimeter wall columns inside <paramref name="rect"/> and record
        /// each opened <c>[x,y]</c> on <c>cfg.door</c>. Drops the room (and any auto furniture) if its
        /// last wall cell is opened.
        /// </summary>
        public static StationFacilityPlan PlanCarveOpenings(StationIndex index, string moduleId, StationFacilityRect rect) {
            var plan = new StationFacilityPlan { Rect = rect };
            if (index == null) { plan.Reason = "no-document"; return plan; }
            if (string.IsNullOrEmpty(moduleId) || !index.TryGetModule(moduleId, out var module) || module == null ||
                module.Type != "shop") {
                plan.Reason = "no-module";
                return plan;
            }
            var own = StationFacilityRules.RectOf(module);
            plan.Kind = module.Config.Text("kind");
            var cut = OpeningCells(index, module, rect);
            if (cut.Count == 0) { plan.Reason = "no-openings"; return plan; }

            var cutSet = new HashSet<StationCellKey>(cut);
            foreach (var cell in cut) plan.DropCells.Add(cell);

            var allWalls = WallCells(index, module);
            bool anyWallLeft = false;
            for (int i = 0; i < allWalls.Count; i++) {
                if (!cutSet.Contains(allWalls[i])) { anyWallLeft = true; break; }
            }

            if (!anyWallLeft) {
                plan.Removes.Add(module.Id);
                foreach (var id in AutoFurnitureIn(index, own)) plan.Removes.Add(id);
                return plan;
            }

            var doors = ParseDoors(module);
            var have = new HashSet<(int, int)>(doors);
            for (int i = 0; i < cut.Count; i++) {
                var pair = (cut[i].X, cut[i].Y);
                if (have.Add(pair)) doors.Add(pair);
            }
            var updated = new StationEditDraft {
                Id = module.Id,
                SourceId = module.Id,
                Type = "shop",
                X = own.X0,
                Y = own.Y0,
                Z = own.Z,
                Width = own.Width,
                Height = own.Height,
                Rotation = 0,
            };
            updated.Set("kind", string.IsNullOrEmpty(plan.Kind) ? "store" : plan.Kind);
            updated.SetJson("door", FormatDoorArray(doors));
            updated.Set(true, "stocked");
            plan.Room = updated;
            plan.RoomReplaces = true;
            return plan;
        }

        static List<(int X, int Y)> ParseDoors(StationModuleRecord module) {
            var doors = new List<(int X, int Y)>();
            if (module == null) return doors;
            var raw = module.Config.Text("door");
            if (string.IsNullOrEmpty(raw)) return doors;
            int i = 0;
            int n = raw.Length;
            bool ReadInt(out int value) {
                value = 0;
                while (i < n && !char.IsDigit(raw[i]) && raw[i] != '-') i++;
                if (i >= n) return false;
                int start = i;
                if (raw[i] == '-') i++;
                while (i < n && char.IsDigit(raw[i])) i++;
                return int.TryParse(raw.Substring(start, i - start),
                    System.Globalization.NumberStyles.Integer,
                    System.Globalization.CultureInfo.InvariantCulture, out value);
            }
            while (ReadInt(out int x) && ReadInt(out int y)) {
                doors.Add((x, y));
            }
            return doors;
        }

        static List<(int X, int Y)> CollectKeptPerimeterDoors(List<StationModuleRecord> merged, StationFacilityRect union) {
            var seen = new HashSet<(int, int)>();
            var kept = new List<(int, int)>();
            for (int i = 0; i < merged.Count; i++) {
                var m = merged[i];
                if (m == null || (m.Type != "shop" && m.Type != "booth")) continue;
                var doors = ParseDoors(m);
                for (int d = 0; d < doors.Count; d++) {
                    var p = doors[d];
                    if (p.X >= union.X0 && p.X <= union.X1 && p.Y >= union.Y0 && p.Y <= union.Y1 &&
                        StationFacilityRules.IsPerimeter(union, p.X, p.Y) && seen.Add(p)) {
                        kept.Add(p);
                    }
                }
            }
            return kept;
        }

        static string FormatDoorArray(List<(int X, int Y)> doors) {
            if (doors == null || doors.Count == 0) return "[]";
            var sb = new System.Text.StringBuilder(doors.Count * 10 + 2);
            sb.Append('[');
            for (int i = 0; i < doors.Count; i++) {
                if (i > 0) sb.Append(',');
                sb.Append('[').Append(doors[i].X).Append(',').Append(doors[i].Y).Append(']');
            }
            sb.Append(']');
            return sb.ToString();
        }

        /// <summary>The `cfg.auto` furniture a room's footprint stocked, for `dropAutoFurniture`.</summary>
        static List<string> AutoFurnitureIn(StationIndex index, StationFacilityRect rect) {
            var ids = new List<string>();
            foreach (var module in index.Document.Modules) {
                if (module == null || !StationFacilityRules.IsFurniture(module.Type)) continue;
                if (!module.Config.Bool("auto")) continue;
                if (module.Z != rect.Z) continue;
                if (module.X < rect.X0 || module.X > rect.X1 || module.Y < rect.Y0 || module.Y > rect.Y1) continue;
                ids.Add(module.Id);
            }
            return ids;
        }

        /// <summary>The first `<type>-N` id free in the document and in this plan.</summary>
        static string NextFreeId(StationIndex index, string type, HashSet<string> reserved) {
            int n = index.Document.ModuleCount + 1;
            for (;;) {
                var id = type + "-" + n;
                if (index.GetModule(id) == null && !reserved.Contains(id)) {
                    reserved.Add(id);
                    return id;
                }
                n++;
            }
        }
    }
}
