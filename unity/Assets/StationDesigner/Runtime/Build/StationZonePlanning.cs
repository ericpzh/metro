using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// The 分区 palette's own ids (`sim/zones.ts` `ZONE_PAINT_LIST`) and the three rules the
    /// brush reads off them: a fare zone writes the cell's `zone` label, a room purpose writes
    /// `room`, and **无分区** (`none`) is a *reading*, not a record — the brush that produces it
    /// takes a label off (`eraseZoneCells`) instead of writing one.
    /// </summary>
    public static class StationZoneIds {
        /// <summary>The eraser's id: the state an unpainted cell already reads.</summary>
        public const string None = "none";

        /// <summary>The three room purposes: they live in `Cell.room`, not `Cell.zone`.</summary>
        static readonly string[] Rooms = { "store", "toilet", "office" };

        public static bool IsRoom(string id) {
            if (string.IsNullOrEmpty(id)) return false;
            for (int i = 0; i < Rooms.Length; i++) {
                if (string.Equals(Rooms[i], id, StringComparison.Ordinal)) return true;
            }
            return false;
        }

        /// <summary>
        /// True for the brush that removes a label: the 无分区 tile (`none`), no brush at all,
        /// and the secondary button (the zone tool arms the eraser for it, `ZoneTool.onDown`).
        /// </summary>
        public static bool IsErase(string id) =>
            string.IsNullOrEmpty(id) || string.Equals(id, None, StringComparison.Ordinal);

        /// <summary>True for a fare zone: a paint id that is neither the eraser nor a room.</summary>
        public static bool IsFare(string id) => !IsErase(id) && !IsRoom(id);
    }

    /// <summary>
    /// One zone gesture's world: the port of `build/model/Zones.ts`'s `floorOf` plus the two
    /// indexes it reads (`solidKeys` and `thinWallSideMap`), built once per document.
    ///
    /// A cell the document speaks for **is** its record: floor when the record is a walkable
    /// solid whose top face is at least partly exposed and which is not a ceiling plate. A
    /// coordinate the document speaks for nowhere is the **street** at grade — floor unless a
    /// ramp corridor, an exit pad or a bored rail opens it (`groundHoleAt`). Nothing here
    /// writes, and nothing here reads the scene.
    /// </summary>
    public sealed class StationZoneWorld {
        readonly Dictionary<StationCellKey, StationCellRecord> byKey;
        readonly HashSet<StationCellKey> solids = new HashSet<StationCellKey>();
        readonly Dictionary<StationCellKey, StationCellShape> shapes = new Dictionary<StationCellKey, StationCellShape>();
        readonly HashSet<(int X, int Y)> groundHoles = new HashSet<(int, int)>();

        /// <summary>The one plane the document stores inverted (`StationPaintSnapshot.GroundZ`).</summary>
        public int GroundZ = StationPaintSnapshot.GroundZ;

        public int LevelBase;
        public int StoreyHeight = 5;

        StationZoneWorld(Dictionary<StationCellKey, StationCellRecord> records) {
            byKey = records;
        }

        /// <summary>Index a committed document, deriving the street holes from its modules.</summary>
        public static StationZoneWorld Build(StationIndex index) {
            var world = Build(index?.Document);
            if (index != null) world.AddModuleGroundHoles(index.Document);
            return world;
        }

        /// <summary>Index a document without module-derived street holes (tests, tools without a session).</summary>
        public static StationZoneWorld Build(StationDocument document) {
            var records = new Dictionary<StationCellKey, StationCellRecord>();
            var world = new StationZoneWorld(records) {
                LevelBase = document?.LevelBase ?? 0,
                StoreyHeight = document?.StoreyHeight ?? 5,
            };
            if (document == null) return world;
            foreach (var cell in document.Cells) {
                if (cell == null) continue;
                records[cell.Key] = cell;
                if (!cell.IsSolid) continue;
                world.solids.Add(cell.Key);
                var shape = StationCellRules.ShapeOf(cell.Tags);
                if (!shape.IsFull) world.shapes[cell.Key] = shape;
            }
            return world;
        }

        /// <summary>
        /// `groundHoleAt`: the street plane is open where the document dug a hole and where a
        /// module's own footprint occupies it — a ground-level rail bed, a run landing, an exit
        /// pad. `StationFootprints.IsGroundHole` is the same question as a point query; this is
        /// the set form so a drag rectangle can ask it once per cell.
        /// </summary>
        void AddModuleGroundHoles(StationDocument document) {
            for (int i = 0; i < document.Cells.Count; i++) {
                var cell = document.Cells[i];
                if (cell == null || cell.Z != GroundZ || cell.IsSolid) continue;
                groundHoles.Add((cell.X, cell.Y));
            }
            foreach (var module in document.Modules) {
                if (module == null) continue;
                switch (module.Type) {
                    case "track": {
                        if (module.Config.Bool("tunnel") || module.Config.Bool("bridge")) break;
                        foreach (var at in StationFootprints.TrackCells(module)) AddGroundHole(at);
                        break;
                    }
                    case "stair":
                    case "escalator":
                    case "walkway":
                    case "lift": {
                        foreach (var at in StationFootprints.Footprint(module)) AddGroundHole(at);
                        break;
                    }
                    case "exit": {
                        var style = module.Config.Text("style");
                        if (style == "doorway" || style == "virtual") break;
                        foreach (var at in StationFootprints.ExitFootprint(module)) AddGroundHole(at);
                        break;
                    }
                }
            }
        }

        void AddGroundHole(StationPoint at) {
            int x = (int)Math.Round(at.X);
            int y = (int)Math.Round(at.Y);
            if (Math.Abs(at.Z - GroundZ) < 1e-9) groundHoles.Add((x, y));
        }

        public StationCellRecord Find(int x, int y, int z) =>
            byKey.TryGetValue(new StationCellKey(x, y, z), out var cell) ? cell : null;

        public StationCellRecord Find(StationCellKey key) => byKey.TryGetValue(key, out var cell) ? cell : null;

        public bool IsSolid(StationCellKey key) => solids.Contains(key);

        /// <summary>Is the street plane open at <c>(x,y)</c> (`groundHoleAt`)?</summary>
        public bool IsGroundHole(int x, int y) => groundHoles.Contains((x, y));

        /// <summary>
        /// `floorOf`: may the 分区 brush paint this coordinate? An authored record answers for
        /// itself (`isFloorCell`); anywhere else is the street, which is floor at grade unless a
        /// module opened a hole in it.
        /// </summary>
        public bool IsFloor(StationCellKey key) {
            var cell = Find(key);
            if (cell != null) return IsFloorCell(cell);
            return key.Z == GroundZ && OpenAbove(key.X, key.Y, key.Z) && !IsGroundHole(key.X, key.Y);
        }

        public bool IsFloor(int x, int y, int z) => IsFloor(new StationCellKey(x, y, z));

        /// <summary>
        /// `isFloorCell`: a solid whose top face is walkable and at least partly exposed, or a
        /// track bed at the foot of its own column. A ceiling plate is the ceiling however
        /// exposed its top; a half wall, corner or cut piece is not floor itself — but it leaves
        /// the floor under it partly open, which is why <see cref="OpenAbove"/> reads the shape
        /// of the course above rather than its mere existence.
        /// </summary>
        bool IsFloorCell(StationCellRecord cell) {
            if (cell == null || !cell.IsSolid) return false;
            if (cell.HasTag(StationZoneLimits.SuspendedCeilingTag) ||
                cell.HasTag(StationZoneLimits.OpeningCeilingTag)) return false;
            var shape = ShapeAt(cell.Key);
            if (shape.Kind == StationShapeKind.Half || shape.Kind == StationShapeKind.Corner ||
                shape.Kind == StationShapeKind.Cuts) return false;
            if (!OpenAbove(cell.X, cell.Y, cell.Z)) return false;
            var top = string.IsNullOrEmpty(cell.FinishTop) ? StationFinishIds.DefaultMaterial : cell.FinishTop;
            var id = StationFinishIds.BaseId(top);
            bool trackBed = string.Equals(id, StationZoneLimits.TrackBedFinish, StringComparison.Ordinal);
            bool walks = StationZoneLimits.FloorSpeed(top) > 0;
            return walks || (trackBed && !solids.Contains(new StationCellKey(cell.X, cell.Y, cell.Z - 1)));
        }

        /// <summary>The course above leaves the top face at least partly exposed.</summary>
        bool OpenAbove(int x, int y, int z) {
            var key = new StationCellKey(x, y, z + 1);
            if (!solids.Contains(key)) return true;
            if (!shapes.TryGetValue(key, out var shape)) return false;
            return shape.Kind == StationShapeKind.Half || shape.Kind == StationShapeKind.Corner ||
                   shape.Kind == StationShapeKind.Cuts ||
                   (shape.Kind == StationShapeKind.Triangle && shape.Triangle == StationTriangleKind.Lower);
        }

        StationCellShape ShapeAt(StationCellKey key) =>
            shapes.TryGetValue(key, out var shape) ? shape : StationCellShape.Full;

        /// <summary>
        /// Would this record be **bare street** if its labels came off? `eraseZoneCells` drops
        /// such a record outright: with no label, no finish and no tag left, absence *is* the
        /// street, and the coordinate reads 站外 either way.
        /// </summary>
        public bool IsBareStreet(StationCellRecord cell) {
            if (cell == null || !cell.IsSolid) return false;
            if (cell.Z != GroundZ) return false;
            if (cell.Finish.Count > 0 || cell.Tags.Count > 0) return false;
            return !IsGroundHole(cell.X, cell.Y);
        }
    }

    /// <summary>The two finish families the floor rule reads, and the tag pair that means "ceiling".</summary>
    static class StationZoneLimits {
        public const string TrackBedFinish = "floor.track";
        public const string CoverSoilFinish = "floor.soil";
        public const string SuspendedCeilingTag = "suspended-ceiling";
        public const string OpeningCeilingTag = "opening-ceiling";

        /// <summary>
        /// `floorSpeed`: the finish table's two zero-speed floors are the track bed and cover
        /// soil; every other finish (including an unknown id's `floor.concrete` fallback) walks.
        /// </summary>
        public static double FloorSpeed(string finish) {
            var id = StationFinishIds.BaseId(finish);
            if (string.Equals(id, TrackBedFinish, StringComparison.Ordinal)) return 0;
            if (string.Equals(id, CoverSoilFinish, StringComparison.Ordinal)) return 0;
            return 1;
        }
    }

    /// <summary>
    /// One 分区 gesture's verdict: the floor the rectangle covers, the non-floor it skips, and
    /// the cell writes the release would make. The ghost draws <see cref="Floor"/> and
    /// <see cref="Accepted"/>; the release commits <see cref="ToPatch"/>.
    /// </summary>
    public sealed class StationZonePlan {
        /// <summary>Every cell the gesture covered that is floor — what the tint shows.</summary>
        public readonly List<StationCellKey> Floor = new List<StationCellKey>();
        /// <summary>The floor cells whose label really changes.</summary>
        public readonly List<StationCellKey> Accepted = new List<StationCellKey>();
        /// <summary>The covered cells that are not floor: a wall coping, a ceiling, a hole.</summary>
        public readonly List<StationCellKey> Ignored = new List<StationCellKey>();
        /// <summary>The writes the release would make, in the gesture's own order.</summary>
        public readonly List<StationCellWrite> Writes = new List<StationCellWrite>();
        /// <summary>The armed brush id (`unpaid`, `paid`, `store`, … or `none` for 无分区).</summary>
        public string Paint = "";
        public bool Erase;
        /// <summary>A stable code when the whole gesture is refused (`not-floor`, `nothing-to-do`).</summary>
        public string Reason = "";

        public bool HasWork => Accepted.Count > 0;
        public int Changed => Writes.Count;

        /// <summary>The same writes as a patch, for `StationEditSession.TryApplyCells`.</summary>
        public StationCellPatch ToPatch() {
            var patch = new StationCellPatch();
            foreach (var write in Writes) patch.Add(write);
            return patch;
        }
    }

    /// <summary>
    /// The 分区 brush's pure planner (plan 27 §6), a port of `build/model/Zones.ts`'s
    /// `paintZone` / `paintZoneCells` / `eraseZoneCells` and the floor filter the zone tool
    /// drags through (`zoneFloorKeys`).
    ///
    /// A fare zone is written to `zone` and **clears** `room`; a room purpose is written to
    /// `room` and leaves the fare label alone (a store inside 站外 reads its own tint over that
    /// plane); 无分区 takes both away, and a record with nothing else on it is dropped back to
    /// the street. Nothing here validates anything else, and nothing here writes: the records
    /// are patched by <see cref="Metro.Persistence.StationCellEdits"/>.
    /// </summary>
    public static class StationZonePlanner {
        /// <summary>The shared 10,000-cell budget every drag respects (plan 27 §3).</summary>
        public const int MaxCells = StationCellPlanner.MaxDragCells;

        /// <summary>
        /// Plan one rectangle (or a single cell, the quick-tap case) of the armed brush. Only
        /// floor is asked about, so a drag across a wall row tints the floor it crosses and
        /// drops the copings it also swept.
        /// </summary>
        public static StationZonePlan Plan(StationZoneWorld world, IEnumerable<StationCellKey> cells, string paint) {
            var plan = new StationZonePlan { Paint = paint ?? StationZoneIds.None };
            plan.Erase = StationZoneIds.IsErase(plan.Paint);
            if (world == null || cells == null) { plan.Reason = "no-world"; return plan; }
            var seen = new HashSet<StationCellKey>();
            bool room = !plan.Erase && StationZoneIds.IsRoom(plan.Paint);
            int covered = 0;
            foreach (var cell in cells) {
                if (++covered > MaxCells) { plan.Reason = "over-limit"; return new StationZonePlan(); }
                if (!seen.Add(cell)) continue;
                if (!world.IsFloor(cell)) { plan.Ignored.Add(cell); continue; }
                plan.Floor.Add(cell);
                var record = world.Find(cell);
                var write = WriteFor(world, cell, record, plan.Paint, plan.Erase, room);
                if (write == null) continue;
                plan.Accepted.Add(cell);
                plan.Writes.Add(write);
            }
            if (plan.Writes.Count == 0 && plan.Reason.Length == 0) {
                plan.Reason = plan.Floor.Count == 0 ? "not-floor" : "nothing-to-do";
            }
            return plan;
        }

        /// <summary>
        /// `paintZone`'s bucket: flood the connected floor of the pressed cell's own zone at
        /// its level and repaint that whole patch. The same-zone test is what bounds the walk,
        /// so an existing zone line stops the flood and a region can be repainted once its
        /// boundary is drawn. The eraser and the room brushes have no bucket in the reference
        /// (`eraseZoneCells` takes a list, a room is drawn as a rectangle), so they are refused
        /// with a stable code rather than guessed at.
        /// </summary>
        public static StationZonePlan Bucket(StationZoneWorld world, StationCellKey start, string paint) {
            var plan = new StationZonePlan { Paint = paint ?? StationZoneIds.None };
            plan.Erase = StationZoneIds.IsErase(plan.Paint);
            if (world == null) { plan.Reason = "no-world"; return plan; }
            if (plan.Erase || StationZoneIds.IsRoom(plan.Paint)) { plan.Reason = "not-bucketable"; return plan; }
            var first = world.Find(start);
            if (first == null || !world.IsFloor(start)) { plan.Reason = "not-floor"; return plan; }
            var startZone = first.Zone ?? "";
            var seen = new HashSet<StationCellKey> { start };
            var stack = new List<StationCellKey> { start };
            var region = new List<StationCellKey>();
            while (stack.Count > 0) {
                int last = stack.Count - 1;
                var current = stack[last];
                stack.RemoveAt(last);
                var record = world.Find(current);
                if (record == null || !world.IsFloor(current)) continue;
                region.Add(current);
                if (region.Count > MaxCells) { plan.Reason = "over-limit"; return new StationZonePlan(); }
                for (int n = 0; n < 4; n++) {
                    int dx = n == 0 ? 1 : n == 1 ? -1 : 0;
                    int dy = n == 2 ? 1 : n == 3 ? -1 : 0;
                    var next = new StationCellKey(current.X + dx, current.Y + dy, current.Z);
                    if (seen.Contains(next)) continue;
                    var neighbour = world.Find(next);
                    if (neighbour == null || string.CompareOrdinal(neighbour.Zone ?? "", startZone) != 0) continue;
                    seen.Add(next);
                    stack.Add(next);
                }
            }
            foreach (var cell in region) {
                var record = world.Find(cell);
                plan.Floor.Add(cell);
                var write = WriteFor(world, cell, record, plan.Paint, false, false);
                if (write == null) continue;
                plan.Accepted.Add(cell);
                plan.Writes.Add(write);
            }
            if (plan.Writes.Count == 0) plan.Reason = "nothing-to-do";
            return plan;
        }

        /// <summary>
        /// The write one floor cell needs for the armed brush, or null when it already reads
        /// that way. A cell the document does not hold is **materialised**: virgin street gets a
        /// record so it can carry a label, which is the one place the brush writes where the
        /// document had nothing (`paintZoneCells`'s tail).
        /// </summary>
        static StationCellWrite WriteFor(StationZoneWorld world, StationCellKey cell, StationCellRecord record,
            string paint, bool erase, bool room) {
            if (erase) {
                if (record == null) return null;
                bool hasZone = !string.IsNullOrEmpty(record.Zone);
                bool hasRoom = !string.IsNullOrEmpty(record.Room);
                if (!hasZone && !hasRoom) return null;
                // `eraseZoneCells`: a cell carrying a room purpose loses **only** that purpose
                // (a paid store stays paid); a fare label is what the other branch takes away.
                if (hasRoom) {
                    if (!hasZone && world.IsBareStreet(record)) return StationCellWrite.Drop(cell);
                    return StationCellWrite.Labels(cell, null, "");
                }
                if (world.IsBareStreet(record)) return StationCellWrite.Drop(cell);
                return StationCellWrite.Labels(cell, "", null);
            }
            if (room) {
                if (record != null) {
                    if (string.Equals(record.Room ?? "", paint, StringComparison.Ordinal)) return null;
                    return StationCellWrite.Labels(cell, null, paint);
                }
                // Virgin street keeps the 站外 fare label it reads as a plane, and gains the room.
                return StationCellWrite.Labels(cell, cell.Z == world.GroundZ ? "outside" : null, paint);
            }
            if (record != null) {
                if (string.Equals(record.Zone ?? "", paint, StringComparison.Ordinal) &&
                    string.IsNullOrEmpty(record.Room)) return null;
                return StationCellWrite.Labels(cell, paint, "");
            }
            return StationCellWrite.Labels(cell, paint, "");
        }
    }
}
