using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>Why a cell refuses a block — the port of `sim/placement.ts:BlockRefusal`.</summary>
    public enum StationBlockRefusal {
        None = 0,
        /// <summary>A reserved opening: a ramp's carved corridor or a head-house's floor.</summary>
        Opening = 1,
        /// <summary>A placed piece already stands in the cell.</summary>
        Equipment = 2,
        /// <summary>A rail's dug bed or the `floor.track` finish.</summary>
        Track = 3,
        /// <summary>A cut piece whose quarters overlap the one already in the cell.</summary>
        Occupied = 4,
    }

    /// <summary>The stable refusal code a plan or a trace publishes.</summary>
    public static class StationBlockRefusals {
        public static string Code(StationBlockRefusal refusal) => refusal switch {
            StationBlockRefusal.Opening => "opening",
            StationBlockRefusal.Equipment => "equipment",
            StationBlockRefusal.Track => "track",
            StationBlockRefusal.Occupied => "occupied",
            _ => "",
        };
    }

    /// <summary>Layer facts the pure planner cannot derive on its own.</summary>
    /// <remarks>
    /// `sim/blockIndex.ts` asks two questions the document text answers only through the
    /// carve: which cells a 楼梯/扶梯 corridor opens at a level, and which cells a run's
    /// landing keeps. `Metro.Build` may not reference `Metro.View`, where the carve's own
    /// tables live (`StationRampOpenings`), so the owning layer supplies them. A planner
    /// built with no reservations still answers the exit-floor half of `reservedOpening`
    /// from the document and reports the rest as unverified rather than guessing.
    /// </remarks>
    public interface IStationCellReservations {
        /// <summary>The `z` level's reserved opening cells (plan coordinates), or null.</summary>
        HashSet<StationCellKey> OpeningsAtLevel(int z);
    }

    /// <summary>One block candidate's verdict.</summary>
    public readonly struct StationBlockCheck {
        public readonly StationCellKey Cell;
        public readonly bool Ok;
        public readonly StationBlockRefusal Refusal;
        /// <summary>The placed pieces that fired an `equipment` refusal, in document order.</summary>
        public readonly IReadOnlyList<string> Blockers;

        public StationBlockCheck(StationCellKey cell, bool ok, StationBlockRefusal refusal, IReadOnlyList<string> blockers) {
            Cell = cell; Ok = ok; Refusal = refusal; Blockers = blockers ?? Array.Empty<string>();
        }

        public string Reason => StationBlockRefusals.Code(Refusal);
    }

    /// <summary>What laying one cut course does to its cell.</summary>
    public enum StationCutVerdict {
        /// <summary>An empty cell: an ordinary add.</summary>
        Add = 0,
        /// <summary>A cut cell whose quarters are free: append the tag to it.</summary>
        Merge = 1,
        /// <summary>A full block, a wedge, a duplicated record: already there, nothing to say.</summary>
        Skip = 2,
        /// <summary>Refused by the block rules, or an overlapping cut.</summary>
        Refuse = 3,
    }

    /// <summary>One cut candidate's verdict.</summary>
    public readonly struct StationCutCheck {
        public readonly StationCellKey Cell;
        public readonly StationCutVerdict Verdict;
        public readonly StationBlockRefusal Refusal;
        public readonly IReadOnlyList<string> Blockers;

        public StationCutCheck(StationCellKey cell, StationCutVerdict verdict, StationBlockRefusal refusal,
            IReadOnlyList<string> blockers) {
            Cell = cell; Verdict = verdict; Refusal = refusal; Blockers = blockers ?? Array.Empty<string>();
        }

        public string Reason => StationBlockRefusals.Code(Refusal);
    }

    /// <summary>
    /// One candidate gesture, judged once. This is the value the ghost draws **and** the
    /// release reads (plan 27 §3: "the same planner supplies hover, drag and release
    /// verdicts"), so a blue cell can never turn into a refusal at the click.
    /// </summary>
    public sealed class StationCellCheck {
        /// <summary>The cells the release will take, in candidate order.</summary>
        public readonly List<StationCellKey> Accepted = new List<StationCellKey>();
        /// <summary>Every candidate's cell (accepted, refused and ignored alike).</summary>
        public readonly List<StationCellKey> Cells = new List<StationCellKey>();
        /// <summary>The refused cells, for the red boxes.</summary>
        public readonly List<StationCellKey> Blocked = new List<StationCellKey>();
        /// <summary>Cells the station already holds (or the street): neither accepted nor refused.</summary>
        public readonly List<StationCellKey> Ignored = new List<StationCellKey>();
        /// <summary>Placed pieces to box in red — the pieces standing in the way.</summary>
        public readonly List<string> ColliderIds = new List<string>();
        /// <summary>The first refusal's code, for a notice line.</summary>
        public string Reason = "";
        /// <summary>The cut shape this check judged, or <see cref="StationCellShape.Full"/>.</summary>
        public StationCellShape Shape = StationCellShape.Full;

        /// <summary>A cell the drag covered that the release will not touch.</summary>
        public bool IsIgnored(StationCellKey key) => Ignored.Contains(key);
        public bool HasWork => Accepted.Count > 0;
    }

    /// <summary>How one cell write changes its save record.</summary>
    public enum StationCellWriteMode {
        /// <summary>Create or replace the record with the write's fill, tags and finish.</summary>
        Set = 0,
        /// <summary>Delete the record outright (absence then means the virtual street).</summary>
        Remove = 1,
        /// <summary>Append tags to the existing record and drop <see cref="StationCellWrite.RemoveTags"/>.</summary>
        AppendTags = 2,
        /// <summary>
        /// Set or clear the authored `zone` / `room` labels and keep every other field — the 分区
        /// brush's write. A coordinate with no record gains one (`paintZoneCells` materialises
        /// virgin street so it can carry a label).
        /// </summary>
        Label = 3,
    }

    /// <summary>One surgical change to a cell record, in document order.</summary>
    public sealed class StationCellWrite {
        public StationCellKey Key;
        public StationCellWriteMode Mode;
        public bool Void;
        public List<string> Tags = new List<string>();
        public List<string> RemoveTags = new List<string>();
        /// <summary>An explicit six-face finish for a new record (a suspended ceiling).</summary>
        public Dictionary<string, string> Finish = new Dictionary<string, string>(StringComparer.Ordinal);
        /// <summary>`Label` mode: the zone to write, `""` to remove it, null to leave it alone.</summary>
        public string Zone;
        /// <summary>`Label` mode: the room purpose to write, `""` to remove it, null to leave it alone.</summary>
        public string Room;

        public static StationCellWrite Set(StationCellKey key, bool isVoid, params string[] tags) {
            var write = new StationCellWrite { Key = key, Mode = StationCellWriteMode.Set, Void = isVoid };
            if (tags != null) write.Tags.AddRange(tags);
            return write;
        }

        public static StationCellWrite Drop(StationCellKey key) =>
            new StationCellWrite { Key = key, Mode = StationCellWriteMode.Remove };

        public static StationCellWrite AddTags(StationCellKey key, IEnumerable<string> tags, IEnumerable<string> removeTags = null) {
            var write = new StationCellWrite { Key = key, Mode = StationCellWriteMode.AppendTags };
            if (tags != null) write.Tags.AddRange(tags);
            if (removeTags != null) write.RemoveTags.AddRange(removeTags);
            return write;
        }

        /// <summary>
        /// Set or clear the authored labels of one cell (`null` leaves that field alone). The
        /// 分区 brush writes `zone` for a fare zone and `room` for a store/restroom/office.
        /// </summary>
        public static StationCellWrite Labels(StationCellKey key, string zone, string room) =>
            new StationCellWrite { Key = key, Mode = StationCellWriteMode.Label, Zone = zone, Room = room };
    }

    /// <summary>
    /// The complete result of one gesture: the cell writes and the hosted modules it
    /// takes with them. <see cref="Metro.Persistence.StationCellEdits"/> is the only
    /// writer; the planner never touches the document or the revision.
    /// </summary>
    public sealed class StationCellPatch {
        public readonly List<StationCellWrite> Writes = new List<StationCellWrite>();
        /// <summary>Placed modules this patch adds, in candidate order (a run's panels).</summary>
        public readonly List<StationEditDraft> ModuleAdds = new List<StationEditDraft>();
        /// <summary>
        /// Placed modules this patch **replaces** by id — a counter drag that extends an
        /// existing room keeps the room's id, so its record is rewritten rather than appended.
        /// </summary>
        public readonly List<StationEditDraft> ModuleReplaces = new List<StationEditDraft>();
        /// <summary>Placed modules anchored on a removed cell (`removeCells` takes them).</summary>
        public readonly List<string> RemoveModuleIds = new List<string>();
        /// <summary>
        /// Lines this edit **adds**. A first platform rail on a line-less document creates the
        /// line it binds to in the same revision (`layTrack`'s default line), so a fresh station
        /// never refuses the railway for want of a line list (plan 28 §3c).
        /// </summary>
        public readonly List<StationLineDraft> LineAdds = new List<StationLineDraft>();
        /// <summary>Pieces whose reservation this packet could not derive (reported, never guessed).</summary>
        public readonly List<string> Unverified = new List<string>();
        /// <summary>How many records the patch really changes (0 means a no-op).</summary>
        public int Changed;

        public bool HasWork => Writes.Count > 0 || ModuleAdds.Count > 0 || ModuleReplaces.Count > 0 ||
                               RemoveModuleIds.Count > 0 || LineAdds.Count > 0;

        public void Add(StationCellWrite write) {
            if (write == null) return;
            Writes.Add(write);
            if (write.Mode != StationCellWriteMode.AppendTags || write.Tags.Count > 0 || write.RemoveTags.Count > 0) Changed++;
        }

        /// <summary>Add one line record to the same transaction as the track that binds to it.</summary>
        public void AddLine(StationLineDraft line) {
            if (line == null || string.IsNullOrEmpty(line.Id)) return;
            LineAdds.Add(line);
            Changed++;
        }

        /// <summary>Add one placed module to the same transaction as the cell writes.</summary>
        public void AddModule(StationEditDraft draft) {
            if (draft == null) return;
            ModuleAdds.Add(draft);
            Changed++;
        }

        /// <summary>Rewrite one placed module's record in place (an extended room keeps its id).</summary>
        public void ReplaceModule(StationEditDraft draft) {
            if (draft == null) return;
            ModuleReplaces.Add(draft);
            Changed++;
        }
    }

    /// <summary>
    /// The immutable facts one cell gesture plans against: the port of
    /// `sim/blockIndex.ts:blockIndex` plus the per-level equipment reservation the block
    /// brush reads (`moduleBlockedCells`).
    ///
    /// A new document (a commit, an undo, a station switch) means a new world; a gesture
    /// may read one for its whole life, which is exactly the source's immutable-array
    /// cache. Nothing here writes.
    /// </summary>
    public sealed class StationCellEditWorld {
        readonly HashSet<StationCellKey> solid = new HashSet<StationCellKey>();
        readonly HashSet<StationCellKey> voids = new HashSet<StationCellKey>();
        readonly HashSet<StationCellKey> trackBeds = new HashSet<StationCellKey>();
        readonly HashSet<(int X, int Y)> voidGround = new HashSet<(int, int)>();
        readonly HashSet<(int X, int Y)> trackGroundAtGrade = new HashSet<(int, int)>();
        readonly HashSet<StationCellKey> exitFloors = new HashSet<StationCellKey>();
        readonly HashSet<StationCellKey> trackFootprint = new HashSet<StationCellKey>();
        readonly HashSet<StationCellKey> platformDoors = new HashSet<StationCellKey>();
        readonly HashSet<StationCellKey> autoFloor = new HashSet<StationCellKey>();
        readonly HashSet<StationCellKey> autoWalls = new HashSet<StationCellKey>();
        readonly Dictionary<int, HashSet<StationCellKey>> equipmentByLevel = new Dictionary<int, HashSet<StationCellKey>>();
        readonly Dictionary<int, HashSet<StationCellKey>> openingsByLevel = new Dictionary<int, HashSet<StationCellKey>>();
        readonly IStationCellReservations reservations;

        /// <summary>Pieces whose envelope table is not ported; their reservation is unverified.</summary>
        public readonly List<string> Unverified = new List<string>();

        public StationIndex Index { get; }
        public int StoreyHeight => Index?.StoreyHeight ?? 5;
        public int LevelBase => Index?.LevelBase ?? 0;
        /// <summary>Every saved solid cell, at every level.</summary>
        public IReadOnlyCollection<StationCellKey> Solid => solid;

        StationCellEditWorld(StationIndex index, IStationCellReservations reservations) {
            Index = index;
            this.reservations = reservations;
            var document = index.Document;
            foreach (var cell in document.Cells) {
                var key = cell.Key;
                if (cell.IsSolid) {
                    solid.Add(key);
                    if (cell.FinishOf(StationFinishFace.Top) == "floor.track") trackBeds.Add(key);
                    if (cell.HasTag("auto-floor")) autoFloor.Add(key);
                    if (cell.HasTag("auto-wall")) autoWalls.Add(key);
                } else {
                    voids.Add(key);
                    if (cell.Z == StationFootprints.GroundZ) voidGround.Add((cell.X, cell.Y));
                }
            }
            foreach (var module in document.Modules) {
                if (module.Type == "exit") {
                    var style = module.Config.Text("style");
                    if (style == "doorway" || style == "virtual") continue;
                    foreach (var cell in StationFootprints.ExitFootprint(module))
                        exitFloors.Add(new StationCellKey((int)Math.Round(cell.X), (int)Math.Round(cell.Y), (int)Math.Round(cell.Z)));
                    continue;
                }
                if (module.Type == "track") {
                    var cfg = module.Config;
                    foreach (var cell in StationFootprints.TrackCells(module)) {
                        var key = new StationCellKey((int)Math.Round(cell.X), (int)Math.Round(cell.Y), (int)Math.Round(cell.Z));
                        trackFootprint.Add(key);
                        trackBeds.Add(key);
                        if (key.Z == StationFootprints.GroundZ && !cfg.Bool("tunnel") && !cfg.Bool("bridge"))
                            trackGroundAtGrade.Add((key.X, key.Y));
                    }
                    continue;
                }
                if (module.Type == "platform-edge") {
                    foreach (var cell in StationFootprints.Footprint(module))
                        platformDoors.Add(new StationCellKey((int)Math.Round(cell.X), (int)Math.Round(cell.Y), module.Z));
                }
            }
        }

        /// <summary>Build the world for one document. `reservations` may be null.</summary>
        public static StationCellEditWorld Build(StationIndex index, IStationCellReservations reservations = null) =>
            index == null ? null : new StationCellEditWorld(index, reservations);

        // ------------------------------------------------------------- queries

        public bool IsSolid(int x, int y, int z) => solid.Contains(new StationCellKey(x, y, z));
        public bool IsVoid(int x, int y, int z) => voids.Contains(new StationCellKey(x, y, z));
        public bool IsTrackCell(int x, int y, int z) => trackBeds.Contains(new StationCellKey(x, y, z));
        public bool IsExitFloor(int x, int y, int z) => exitFloors.Contains(new StationCellKey(x, y, z));
        public bool IsPlatformDoor(int x, int y, int z) => platformDoors.Contains(new StationCellKey(x, y, z));
        public bool IsAutoFloor(int x, int y, int z) => autoFloor.Contains(new StationCellKey(x, y, z));

        /// <summary>True for a cell a reserved opening holds (`reservedOpening`).</summary>
        public bool IsOpening(int x, int y, int z) {
            if (exitFloors.Contains(new StationCellKey(x, y, z))) return true;
            var openings = OpeningsAt(z);
            return openings != null && openings.Contains(new StationCellKey(x, y, z));
        }

        /// <summary>
        /// The street plane at grade: absent coordinates are solid ground unless a hole
        /// record, a grade-level rail bed or a reserved opening takes them
        /// (`blockIndex.ground`). This is what makes a drag on virgin ground lay nothing.
        /// </summary>
        public bool IsGround(int x, int y, int z) =>
            z == StationFootprints.GroundZ && !voidGround.Contains((x, y)) &&
            !trackGroundAtGrade.Contains((x, y)) && !IsOpening(x, y, z);

        /// <summary>Both authored floor and the virtual street.</summary>
        public bool IsFloor(int x, int y, int z) => IsSolid(x, y, z) || IsGround(x, y, z);

        HashSet<StationCellKey> OpeningsAt(int z) {
            if (openingsByLevel.TryGetValue(z, out var known)) return known;
            var cells = reservations?.OpeningsAtLevel(z);
            openingsByLevel[z] = cells;
            return cells;
        }

        /// <summary>The cells a placed piece stands in at level `z` (port of `moduleBlockedCells`).</summary>
        public HashSet<StationCellKey> EquipmentBlockedAt(int z) {
            if (equipmentByLevel.TryGetValue(z, out var known)) return known;
            var blocked = new HashSet<StationCellKey>();
            foreach (var module in Index.Document.Modules) {
                // A run, a rail and the screen doors beside it answer through the carve and
                // `reservedOpening` / `isTrackCell`, exactly as the source leaves them. A
                // stair **block** is an ordinary 1-cell body and does claim its cell.
                if (IsRunOrRail(module.Type) && !(module.Type == "stair" && module.Config.Bool("block"))) continue;
                if (module.Type == "roof" && module.Config.Text("variant") == "canopy") {
                    // The canopy body table (`structures.ts` `canopyBodyBoxes`) is not ported.
                    // Naming the piece is honest; inventing a cell set is not.
                    if (!Unverified.Contains(module.Id)) Unverified.Add(module.Id);
                    continue;
                }
                var key = new StationCellKey(module.X, module.Y, module.Z);
                if (module.Z == z) blocked.Add(key);
                foreach (var cell in OccupyingCells(module)) {
                    var at = new StationCellKey((int)Math.Round(cell.X), (int)Math.Round(cell.Y), module.Z);
                    if (at.Z == z) blocked.Add(at);
                }
                if (!StationFootprints.TryClearance(module, out var box, out _)) continue;
                if (box.Z1 <= z || box.Z0 >= z + 1) continue;
                for (int x = (int)Math.Floor(box.X0); x < (int)Math.Ceiling(box.X1); x++)
                    for (int y = (int)Math.Floor(box.Y0); y < (int)Math.Ceiling(box.Y1); y++)
                        blocked.Add(new StationCellKey(x, y, z));
            }
            equipmentByLevel[z] = blocked;
            return blocked;
        }

        /// <summary>The pieces standing in one cell, in document order.</summary>
        public List<string> EquipmentBlockersAt(int x, int y, int z) {
            var outIds = new List<string>();
            if (!EquipmentBlockedAt(z).Contains(new StationCellKey(x, y, z))) return outIds;
            var cell = new StationBox(x, y, z, x + 1, y + 1, z + 1);
            foreach (var module in Index.Document.Modules) {
                if (!StationFootprints.TryClearance(module, out var box, out _)) continue;
                if (!cell.Overlaps(box)) continue;
                if (!outIds.Contains(module.Id)) outIds.Add(module.Id);
            }
            return outIds;
        }

        /// <summary>Every floor cell of the patch a wall ring must treat as covered ground.</summary>
        public bool IsCoveredGround(int x, int y, int z) =>
            IsSolid(x, y, z) || trackFootprint.Contains(new StationCellKey(x, y, z));

        internal IEnumerable<StationCellKey> AutoFloorCells => autoFloor;
        internal IEnumerable<StationCellKey> AutoWallCells => autoWalls;

        static bool IsRunOrRail(string type) =>
            type == "stair" || type == "escalator" || type == "lift" || type == "platform-edge" ||
            type == "track" || type == "walkway";

        /// <summary>
        /// The cells a module stands in: its own anchor plus the footprint cells that are
        /// not the anchor (`occupyingCells`). A run answers by its anchor alone; its
        /// landings belong to `reservedOpening`.
        /// </summary>
        static List<StationPoint> OccupyingCells(StationModuleRecord module) {
            var outCells = new List<StationPoint> { module.Point };
            if (IsRunOrRail(module.Type)) return outCells;
            var footprint = FootprintFor(module);
            if (footprint == null) return outCells;
            foreach (var cell in footprint) {
                int x = (int)Math.Round(cell.X), y = (int)Math.Round(cell.Y);
                if (x == module.X && y == module.Y) continue;
                outCells.Add(new StationPoint(x, y, module.Z));
            }
            return outCells;
        }

        static StationPoint[] FootprintFor(StationModuleRecord module) {
            switch (module.Type) {
                case "track":
                case "platform-edge":
                case "billboard":
                case "glass":
                case "door":
                case "calligraphy":
                case "linemap":
                case "monitor":
                case "bench":
                    return StationFootprints.Footprint(module);
                case "exit":
                    return new[] { module.Point };
                default:
                    return StationFootprints.TryFootprint(module, out var cells, out _) ? cells : null;
            }
        }
    }

    /// <summary>
    /// The delete tool's same-type sweep identity (`app/sweep.ts:sweepFamily`).
    ///
    /// The family is the type plus the variant the palette draws it as, because a 2 m bench
    /// must not collect the 1 m ones beside it. Rotation is deliberately absent: a row of
    /// gates may face both ways and is still one row. A piece outside the sweepable set
    /// answers null — a room, a track, an exit, a stair, a PSD and a fence keep their own
    /// teardown, the same list the source excludes.
    ///
    /// This port reads the **authored** variant text rather than each family's spec table, so
    /// two pieces the source would normalise to one variant sweep separately here. That is a
    /// narrower sweep, never a wider one.
    /// </summary>
    public static class StationSweep {
        static readonly HashSet<string> Sweepable = new HashSet<string>(StringComparer.Ordinal) {
            "ac-unit", "electrical-cabinet", "floor-mark", "gate", "tvm", "vending", "escalator", "walkway", "lift",
            "psd-end", "bench", "shelf", "desk", "checkout", "cubicle", "sink", "guidepost", "busstop", "bin",
            "extinguisher", "vent", "light", "clock", "cctv", "billboard", "glass", "door", "calligraphy",
            "linemap", "tv", "sign",
        };

        public static string FamilyOf(StationModuleRecord module) {
            if (module == null) return null;
            var cfg = module.Config;
            switch (module.Type) {
                case "monitor": return "monitor:" + cfg.Text("mount");
                case "traffic-light":
                case "rail-signal": return module.Type;
                case "extinguisher": {
                    var variant = cfg.Text("variant");
                    return variant == "compact" || variant == "glass" ? "extinguisher-" + variant : "extinguisher";
                }
                case "gate": return cfg.Text("variant") == "new" ? "gate-new" : "gate";
                case "psd-end": return "psd-end:" + cfg.Text("psd");
                case "floor-mark": return "floor-mark:" + cfg.Text("variant");
                case "busstop": return "busstop:" + cfg.Text("variant");
                case "light": return "light-" + cfg.Text("variant");
                case "clock": return cfg.Text("variant") == "digital" ? "clock-digital" : "clock";
                case "cctv": {
                    var variant = cfg.Text("variant");
                    return "cctv:" + (variant.Length == 0 ? "bullet" : variant);
                }
            }
            if (!Sweepable.Contains(module.Type)) return null;
            switch (module.Type) {
                case "checkout": return "checkout:" + cfg.Text("variant") + ":" + module.Width;
                case "shelf": return "shelf:" + cfg.Text("variant");
                case "bench": return "bench:" + cfg.Text("variant");
                case "billboard": return "billboard:" + cfg.Text("variant");
                case "glass": return "glass:" + cfg.Text("variant") + ":" + cfg.Text("curtainHeight");
                case "door": return "door:" + cfg.Text("variant");
                case "calligraphy":
                    return "calligraphy:" + (cfg.Text("style").Length == 0 ? "kai" : cfg.Text("style")) +
                        ":" + (cfg.Text("axis").Length == 0 ? "h" : cfg.Text("axis")) +
                        ":" + (cfg.Bool("showEnglish") ? "1" : "0");
                case "linemap": return "linemap:" + cfg.Text("mount");
                case "sign": return "sign:" + cfg.Text("mount");
                default: return module.Type;
            }
        }

        /// <summary>True when two pieces are the same sweep target.</summary>
        public static bool SameFamily(StationModuleRecord a, StationModuleRecord b) {
            var family = FamilyOf(a);
            return family != null && string.Equals(family, FamilyOf(b), StringComparison.Ordinal);
        }
    }

    /// <summary>One 墙-tool column's snap (`walls.ts:wallSnap`).</summary>
    public readonly struct StationWallSnap {
        public readonly StationCellKey Base;
        /// <summary>The face the column shows to open space — the candidate `cycle` picked.</summary>
        public readonly StationWallSide Dir;
        /// <summary>Every direction **R** may choose, best-first.</summary>
        public readonly IReadOnlyList<StationWallSide> Dirs;

        public StationWallSnap(StationCellKey baseCell, StationWallSide dir, IReadOnlyList<StationWallSide> dirs) {
            Base = baseCell; Dir = dir; Dirs = dirs ?? Array.Empty<StationWallSide>();
        }
    }

    /// <summary>
    /// The pure cell planner (plan 27 §3). One port of `app/tools/geometry/cells.ts`,
    /// `build/validation.ts` (`checkBlockCells`, `checkCutCells`), `sim/placement.ts`
    /// (`blockReason`, `cutCourseReason`) and `build/model/{Cells,Floors,Walls,Ceilings}.ts`
    /// (`addCells`, `removeCells`, `addFloor`/`syncAutoWalls`, `addWalls`,
    /// `addSuspendedCeiling`, `storeyColumnsAt`, `wallSnap`, `wallColumnsAt`).
    ///
    /// Every function is a pure question about a document; nothing here reads a scene,
    /// touches a revision or keeps gesture state (that is `Metro.App.StationCellTool`).
    /// </summary>
    public static class StationCellPlanner {
        /// <summary>The shared drag budget, generated courses included (`MAX_DRAG_CELLS`).</summary>
        public const int MaxDragCells = 10000;
        /// <summary>Hold this long, **and** move, before a press becomes a drag (`LONG_PRESS_MS`).</summary>
        public const int LongPressMs = 160;
        /// <summary>Pointer travel in canvas pixels that counts as a drag (`DRAG_PX`).</summary>
        public const float DragPixels = 4f;

        public const string AutoFloorTag = "auto-floor";
        public const string AutoWallTag = "auto-wall";
        public const string WallTag = "wall";
        public const string SuspendedCeilingTag = "suspended-ceiling";
        public const string OpeningCeilingTag = "opening-ceiling";

        // -------------------------------------------------------------- cell math

        /// <summary>The bucket edge a fixed axis travels along for a ridge-locked 三角 run.</summary>
        public static bool TriangleRidgeIsX(StationWallSide side) => side == StationWallSide.N || side == StationWallSide.S;

        /// <summary>`rectCells`: the rectangle (or the Shift line) two pressed cells describe.</summary>
        public static List<StationCellKey> RectCells(StationCellKey a, StationCellKey b, int z, bool line) {
            var outCells = new List<StationCellKey>();
            if (line) {
                int n = Math.Max(Math.Abs(b.X - a.X), Math.Abs(b.Y - a.Y));
                for (int i = 0; i <= n; i++) {
                    double t = n == 0 ? 0 : (double)i / n;
                    outCells.Add(new StationCellKey((int)Math.Round(a.X + (b.X - a.X) * t),
                        (int)Math.Round(a.Y + (b.Y - a.Y) * t), z));
                }
                return outCells;
            }
            int x0 = Math.Min(a.X, b.X), x1 = Math.Max(a.X, b.X);
            int y0 = Math.Min(a.Y, b.Y), y1 = Math.Max(a.Y, b.Y);
            for (int x = x0; x <= x1; x++)
                for (int y = y0; y <= y1; y++)
                    outCells.Add(new StationCellKey(x, y, z));
            return outCells;
        }

        /// <summary>`dragCellCount`: how many cells a drag covers before any cap is considered.</summary>
        public static int DragCellCount(StationCellKey a, StationCellKey b, bool line) {
            int width = Math.Abs(b.X - a.X) + 1;
            int height = Math.Abs(b.Y - a.Y) + 1;
            return line ? Math.Max(width, height) : width * height;
        }

        /// <summary>`cutLineCellCount`: how many cells a ridge-locked run covers.</summary>
        public static int CutLineCellCount(StationCellKey a, StationCellKey b, StationWallSide side) =>
            TriangleRidgeIsX(side) ? Math.Abs(b.X - a.X) + 1 : Math.Abs(b.Y - a.Y) + 1;

        /// <summary>`triangleLineCells`: the straight run through `a` along `side`'s ridge.</summary>
        public static List<StationCellKey> TriangleLineCells(StationCellKey a, StationCellKey b, int z, StationWallSide side) {
            var outCells = new List<StationCellKey>();
            if (TriangleRidgeIsX(side)) {
                int x0 = Math.Min(a.X, b.X), x1 = Math.Max(a.X, b.X);
                for (int x = x0; x <= x1; x++) outCells.Add(new StationCellKey(x, a.Y, z));
            } else {
                int y0 = Math.Min(a.Y, b.Y), y1 = Math.Max(a.Y, b.Y);
                for (int y = y0; y <= y1; y++) outCells.Add(new StationCellKey(a.X, y, z));
            }
            return outCells;
        }

        /// <summary>`straightLineCells`: a wall run snaps to its dominant axis, ties go east–west.</summary>
        public static List<StationCellKey> StraightLineCells(StationCellKey a, StationCellKey b, int z) {
            var outCells = new List<StationCellKey>();
            if (Math.Abs(b.X - a.X) >= Math.Abs(b.Y - a.Y)) {
                for (int x = Math.Min(a.X, b.X); x <= Math.Max(a.X, b.X); x++) outCells.Add(new StationCellKey(x, a.Y, z));
            } else {
                for (int y = Math.Min(a.Y, b.Y); y <= Math.Max(a.Y, b.Y); y++) outCells.Add(new StationCellKey(a.X, y, z));
            }
            return outCells;
        }

        /// <summary>`axisLineCellCount`: a run's length along one fixed world axis.</summary>
        public static int AxisLineCellCount(StationCellKey a, StationCellKey b, bool xAxis) =>
            Math.Abs((xAxis ? b.X - a.X : b.Y - a.Y)) + 1;

        /// <summary>`shapeCutMask`: the quarters a cut shape fills (0 for a wedge).</summary>
        public static int ShapeCutMask(StationCellShape shape) {
            if (shape.Kind == StationShapeKind.Half) return StationCellRules.HalfMask(shape.Side);
            if (shape.Kind == StationShapeKind.Corner) return StationCellRules.CornerMask(shape.Side);
            if (shape.Kind == StationShapeKind.Cuts) return shape.Mask;
            return 0;
        }

        // -------------------------------------------------------------- storeys

        /// <summary>`storeyBand`: the storey's base elevation for `z` on the station grid.</summary>
        public static int StoreyBand(int z, int levelBase, int storeyHeight) {
            int offset = Math.Max(0, Math.Min(4, levelBase));
            int height = storeyHeight > 0 ? storeyHeight : 5;
            int band = (int)Math.Floor((z - offset) / (double)height) * height + offset;
            return Math.Max(-8 * height + offset, Math.Min(6 * height + offset, band));
        }

        /// <summary>
        /// `storeyWallRun`: a wall column's courses, each bottom cell through the top of its
        /// own storey. This is what a 墙 click or drag lays.
        /// </summary>
        public static List<StationCellKey> StoreyWallRun(IReadOnlyList<StationCellKey> cells, int levelBase, int storeyHeight) {
            var outCells = new List<StationCellKey>();
            int height = storeyHeight > 0 ? storeyHeight : 5;
            foreach (var cell in cells) {
                int top = StoreyBand(cell.Z, levelBase, height) + height;
                for (int z = cell.Z; z < top; z++) outCells.Add(new StationCellKey(cell.X, cell.Y, z));
            }
            return outCells;
        }

        /// <summary>`wallRun`: a fixed number of courses above each base cell.</summary>
        public static List<StationCellKey> WallRun(IReadOnlyList<StationCellKey> cells, int height) {
            var outCells = new List<StationCellKey>();
            if (height <= 0) return outCells;
            foreach (var cell in cells)
                for (int dz = 0; dz < height; dz++) outCells.Add(new StationCellKey(cell.X, cell.Y, cell.Z + dz));
            return outCells;
        }

        // ------------------------------------------------------------ 墙 snapping

        /// <summary>The four faces in the tool's own cycle order (`WALL_DIRS`).</summary>
        public static readonly StationWallSide[] WallDirs = {
            StationWallSide.N, StationWallSide.E, StationWallSide.S, StationWallSide.W,
        };

        /// <summary>The quarter-turn that faces `side` (`wallDirRot`: s, w, n, e).</summary>
        public static int WallDirRot(StationWallSide side) => side switch {
            StationWallSide.S => 0,
            StationWallSide.W => 1,
            StationWallSide.N => 2,
            _ => 3,
        };

        public static void WallStep(StationWallSide side, out int dx, out int dy) {
            switch (side) {
                case StationWallSide.N: dx = 0; dy = 1; return;
                case StationWallSide.E: dx = 1; dy = 0; return;
                case StationWallSide.S: dx = 0; dy = -1; return;
                default: dx = -1; dy = 0; return;
            }
        }

        /// <summary>`wallPointerDir`: the quadrant a pointer offset points at.</summary>
        public static StationWallSide WallPointerDir(double dx, double dy) {
            double ex = Math.Abs(dx), ey = Math.Abs(dy);
            if (ex == 0 && ey == 0) return StationWallSide.S;
            if (ex >= ey) return dx >= 0 ? StationWallSide.E : StationWallSide.W;
            return dy >= 0 ? StationWallSide.N : StationWallSide.S;
        }

        /// <summary>`isWallCell`: a course the 墙 tool, a ring or a cut piece owns.</summary>
        public static bool IsWallCell(StationCellRecord cell) {
            if (cell == null || !cell.IsSolid) return false;
            foreach (var tag in cell.Tags) {
                if (tag == WallTag || tag == AutoWallTag) return true;
                if (tag.StartsWith("tunnel-shell:", StringComparison.Ordinal)) return true;
                if (tag.StartsWith("half-wall:", StringComparison.Ordinal)) return true;
                if (tag.StartsWith("half-corner:", StringComparison.Ordinal)) return true;
                if (tag.StartsWith("tri-upper:", StringComparison.Ordinal)) return true;
                if (tag.StartsWith("tri-lower:", StringComparison.Ordinal)) return true;
            }
            return false;
        }

        /// <summary>
        /// The directions in which a cell faces open space: the neighbour carries **no wall**
        /// and **no floor** on this storey (`wallVoidEdges`).
        /// </summary>
        public static List<StationWallSide> WallVoidEdges(StationCellEditWorld world, int x, int y, int z) {
            var outDirs = new List<StationWallSide>(4);
            foreach (var side in WallDirs) {
                WallStep(side, out var dx, out var dy);
                int nx = x + dx, ny = y + dy;
                var neighbour = world.Index.GetCell(nx, ny, z);
                if (IsWallCell(neighbour)) continue;
                if (neighbour != null && neighbour.IsSolid) continue;
                outDirs.Add(side);
            }
            return outDirs;
        }

        /// <summary>
        /// `wallSnap`: where the 墙 tool stands its next column and which face it takes. A clean
        /// edge wins; a corner stays put and **R** chooses the face; only a buried cell steps to
        /// the nearest neighbour that has an edge. Orientation is never an input.
        /// </summary>
        public static StationWallSnap WallSnap(StationCellEditWorld world, StationCellKey cell,
            double pointerX, double pointerY, bool hasPointer, int cycle) {
            var here = WallVoidEdges(world, cell.X, cell.Y, cell.Z);
            var auto = hasPointer
                ? WallPointerDir(pointerX - (cell.X + 0.5), pointerY - (cell.Y + 0.5))
                : (StationWallSide?)null;
            StationWallSide Pick(IReadOnlyList<StationWallSide> dirs) =>
                dirs.Count == 0 ? StationWallSide.S : dirs[((cycle % dirs.Count) + dirs.Count) % dirs.Count];
            List<StationWallSide> Candidates(IEnumerable<StationWallSide> dirs) {
                var ordered = new List<StationWallSide>();
                var offered = new List<StationWallSide>(dirs);
                foreach (var side in WallDirs)
                    if (offered.Contains(side) && !ordered.Contains(side)) ordered.Add(side);
                if (ordered.Count == 0) ordered.AddRange(WallDirs);
                return ordered;
            }

            if (here.Count > 0) {
                var offered = new List<StationWallSide>();
                if (auto.HasValue && here.Contains(auto.Value) && !offered.Contains(auto.Value)) offered.Add(auto.Value);
                foreach (var side in WallDirs)
                    if (here.Contains(side) && !offered.Contains(side)) offered.Add(side);
                return new StationWallSnap(cell, Pick(offered), Candidates(here));
            }

            int bestX = 0, bestY = 0;
            StationWallSide bestDir = StationWallSide.S;
            int bestDist = int.MaxValue;
            bool found = false;
            for (int x = cell.X - 1; x <= cell.X + 1; x++) {
                for (int y = cell.Y - 1; y <= cell.Y + 1; y++) {
                    if (x == cell.X && y == cell.Y) continue;
                    var edges = WallVoidEdges(world, x, y, cell.Z);
                    if (edges.Count == 0) continue;
                    int dist = Math.Abs(x - cell.X) + Math.Abs(y - cell.Y);
                    if (found && dist >= bestDist) continue;
                    var back = WallPointerDir(cell.X - x, cell.Y - y);
                    found = true;
                    bestX = x;
                    bestY = y;
                    bestDist = dist;
                    bestDir = edges.Contains(back) ? back : edges[0];
                }
            }
            if (found) {
                return new StationWallSnap(new StationCellKey(bestX, bestY, cell.Z), bestDir,
                    Candidates(new[] { bestDir }));
            }
            // A lone buried cell: stand it on the tool's default face and let `addWalls` report
            // the reserved opening or the missing floor.
            return new StationWallSnap(cell, StationWallSide.S, Candidates(Array.Empty<StationWallSide>()));
        }

        /// <summary>
        /// `halfWallSideDirs`: the sides a 半墙 run may take. A run's panels are perpendicular to
        /// it, so a run offers only its two sides — the one facing open space first; a single
        /// column has no axis and offers all four.
        /// </summary>
        public static List<StationWallSide> HalfWallSideDirs(IReadOnlyList<StationCellKey> baseCells,
            IReadOnlyList<StationWallSide> open) {
            bool alongX = true, alongY = true;
            for (int i = 1; i < baseCells.Count; i++) {
                if (baseCells[i].Y != baseCells[0].Y) alongX = false;
                if (baseCells[i].X != baseCells[0].X) alongY = false;
            }
            StationWallSide[] pair = baseCells.Count > 1 && alongX != alongY
                ? (alongX ? new[] { StationWallSide.N, StationWallSide.S } : new[] { StationWallSide.E, StationWallSide.W })
                : null;
            var outDirs = new List<StationWallSide>(4);
            if (pair == null) {
                foreach (var side in open) if (!outDirs.Contains(side)) outDirs.Add(side);
                foreach (var side in WallDirs) if (!outDirs.Contains(side)) outDirs.Add(side);
                return outDirs;
            }
            foreach (var side in pair) if (HasSide(open, side)) outDirs.Add(side);
            foreach (var side in pair) if (!HasSide(open, side)) outDirs.Add(side);
            return outDirs;
        }

        static bool HasSide(IReadOnlyList<StationWallSide> sides, StationWallSide side) {
            for (int i = 0; i < sides.Count; i++) if (sides[i] == side) return true;
            return false;
        }

        /// <summary>`halfWallRunSide`: the side **R** has stepped to, wrapped.</summary>
        public static StationWallSide HalfWallRunSide(IReadOnlyList<StationCellKey> baseCells,
            IReadOnlyList<StationWallSide> open, int cycle) {
            var dirs = HalfWallSideDirs(baseCells, open);
            return dirs[((cycle % dirs.Count) + dirs.Count) % dirs.Count];
        }

        /// <summary>
        /// `wallColumnAt`: the contiguous wall courses through the hit that share its storey
        /// band — so a stacked column lifts one storey at a time.
        /// </summary>
        public static List<StationCellKey> WallColumnAt(StationCellEditWorld world, int x, int y, int z) {
            var outCells = new List<StationCellKey>();
            int band = StoreyBand(z, world.LevelBase, world.StoreyHeight);
            if (!IsWallCell(world.Index.GetCell(x, y, z))) return outCells;
            int bottom = z, top = z;
            while (IsWallCell(world.Index.GetCell(x, y, bottom - 1)) &&
                   StoreyBand(bottom - 1, world.LevelBase, world.StoreyHeight) == band) bottom--;
            while (IsWallCell(world.Index.GetCell(x, y, top + 1)) &&
                   StoreyBand(top + 1, world.LevelBase, world.StoreyHeight) == band) top++;
            for (int zz = bottom; zz <= top; zz++) outCells.Add(new StationCellKey(x, y, zz));
            return outCells;
        }

        /// <summary>`wallColumnsAt`: every wall column through a set of cells, de-duplicated.</summary>
        public static List<StationCellKey> WallColumnsAt(StationCellEditWorld world, IReadOnlyList<StationCellKey> cells) {
            var outCells = new List<StationCellKey>();
            var seen = new HashSet<StationCellKey>();
            foreach (var cell in cells) {
                foreach (var key in WallColumnAt(world, cell.X, cell.Y, cell.Z))
                    if (seen.Add(key)) outCells.Add(key);
            }
            return outCells;
        }

        /// <summary>
        /// `storeyColumnsAt`: G erases the selected storey through a set of columns while
        /// preserving its floor slab and the street (`cells.ts`).
        /// </summary>
        public static List<StationCellKey> StoreyColumnsAt(StationCellEditWorld world, IReadOnlyList<StationCellKey> columns) {
            var bands = new Dictionary<(int X, int Y), HashSet<int>>();
            foreach (var column in columns) {
                var at = (column.X, column.Y);
                if (!bands.TryGetValue(at, out var set)) bands[at] = set = new HashSet<int>();
                set.Add(StoreyBand(column.Z, world.LevelBase, world.StoreyHeight));
            }
            var seen = new HashSet<StationCellKey>();
            var outCells = new List<StationCellKey>();
            foreach (var cell in world.Index.Document.Cells) {
                if (!cell.IsSolid) continue;
                if (!bands.TryGetValue((cell.X, cell.Y), out var set)) continue;
                int band = StoreyBand(cell.Z, world.LevelBase, world.StoreyHeight);
                if (!set.Contains(band)) continue;
                // A storey-base slab is floor unless explicitly authored as a wall course.
                if (cell.Z == StationFootprints.GroundZ) continue;
                if (cell.Z == band && !cell.HasTag(WallTag) && !cell.HasTag(AutoWallTag)) continue;
                var key = cell.Key;
                if (seen.Add(key)) outCells.Add(key);
            }
            return outCells;
        }

        /// <summary>
        /// `addWalls` for the 墙 tool: a storey-bounded column per base cell (`height` 0), or a
        /// fixed number of courses for a 半墙/三角 click (`height` 1). `side` lays the run as
        /// **半墙**: one panel side for the whole run, merged into any cut cell whose quarters
        /// stay free.
        /// </summary>
        public static StationCellPatch PlanWalls(StationCellEditWorld world, IReadOnlyList<StationCellKey> baseCells,
            StationWallSide? side, int height) {
            var patch = new StationCellPatch();
            var run = height > 0
                ? WallRun(baseCells, height)
                : StoreyWallRun(baseCells, world.LevelBase, world.StoreyHeight);
            var added = new HashSet<StationCellKey>();
            var tag = side.HasValue ? StationCellShape.Half(side.Value).ToString() : "";
            foreach (var cell in run) {
                var key = new StationCellKey(cell.X, cell.Y, cell.Z);
                if (added.Contains(key)) continue;
                if (!BlockReason(world, cell.X, cell.Y, cell.Z).Ok) continue;
                if (world.IsSolid(cell.X, cell.Y, cell.Z)) {
                    if (!side.HasValue) continue;
                    // A cut may join a cut cell whose quarters it leaves free; a full block or a
                    // wedge is simply already there.
                    var verdict = CutCourseReason(world, cell.X, cell.Y, cell.Z, StationCellShape.Half(side.Value));
                    if (verdict.Verdict != StationCutVerdict.Merge) continue;
                    added.Add(key);
                    patch.Add(StationCellWrite.AddTags(key, new[] { WallTag, tag }));
                    continue;
                }
                added.Add(key);
                patch.Add(side.HasValue
                    ? StationCellWrite.Set(key, false, WallTag, tag)
                    : StationCellWrite.Set(key, false, WallTag));
            }
            if (added.Count > 0) AddOpeningCeilingCleanup(world, patch, added);
            return patch;
        }

        // -------------------------------------------------------------- verdicts

        /// <summary>
        /// May a block be laid at this cell, and what refuses it? The three rules the release
        /// applies, in its own order: a reserved opening, a piece of equipment, a rail bed
        /// (`sim/placement.ts:blockReason`).
        /// </summary>
        public static StationBlockCheck BlockReason(StationCellEditWorld world, int x, int y, int z) {
            var key = new StationCellKey(x, y, z);
            if (world == null) return new StationBlockCheck(key, true, StationBlockRefusal.None, null);
            if (world.IsOpening(x, y, z)) return new StationBlockCheck(key, false, StationBlockRefusal.Opening, null);
            if (world.EquipmentBlockedAt(z).Contains(key)) {
                return new StationBlockCheck(key, false, StationBlockRefusal.Equipment, world.EquipmentBlockersAt(x, y, z));
            }
            if (world.IsTrackCell(x, y, z)) return new StationBlockCheck(key, false, StationBlockRefusal.Track, null);
            return new StationBlockCheck(key, true, StationBlockRefusal.None, null);
        }

        /// <summary>
        /// May this **半墙** or **薄墙角** course be laid? A cut is an ordinary solid cell, so it
        /// answers <see cref="BlockReason"/> first; a cell that already holds one cut record may
        /// instead **merge** when the new piece's quarters are free (`cutCourseReason`).
        /// </summary>
        public static StationCutCheck CutCourseReason(StationCellEditWorld world, int x, int y, int z, StationCellShape shape) {
            var key = new StationCellKey(x, y, z);
            var block = BlockReason(world, x, y, z);
            if (!block.Ok) return new StationCutCheck(key, StationCutVerdict.Refuse, block.Refusal, block.Blockers);
            if (!world.IsSolid(x, y, z)) return new StationCutCheck(key, StationCutVerdict.Add, StationBlockRefusal.None, null);
            var record = world.Index.GetCell(key);
            int mask = ShapeCutMask(shape);
            int existingMask = record == null ? 0 : StationCellRules.WallCutMask(record.Tags);
            bool wedge = record != null && !StationCellRules.TriangleOf(record.Tags).IsFull;
            if (record == null || existingMask == 0 || wedge || mask == 0)
                return new StationCutCheck(key, StationCutVerdict.Skip, StationBlockRefusal.None, null);
            if ((existingMask & mask) == 0) return new StationCutCheck(key, StationCutVerdict.Merge, StationBlockRefusal.None, null);
            return new StationCutCheck(key, StationCutVerdict.Refuse, StationBlockRefusal.Occupied, null);
        }

        /// <summary>The block tool's preview over a whole candidate list (`checkBlockCells`).</summary>
        public static StationCellCheck CheckBlockCells(StationCellEditWorld world, IReadOnlyList<StationCellKey> cells) {
            var check = new StationCellCheck();
            var seen = new HashSet<StationCellKey>();
            foreach (var cell in cells) {
                check.Cells.Add(cell);
                if (!seen.Add(cell)) continue;
                // The street is already floor: like any held cell it is neither accepted nor
                // refused, so a drag across virgin ground draws no red boxes.
                if (world.IsSolid(cell.X, cell.Y, cell.Z) || world.IsGround(cell.X, cell.Y, cell.Z)) {
                    check.Ignored.Add(cell);
                    continue;
                }
                var verdict = BlockReason(world, cell.X, cell.Y, cell.Z);
                if (!verdict.Ok) {
                    check.Blocked.Add(cell);
                    if (check.Reason.Length == 0) check.Reason = verdict.Reason;
                    foreach (var id in verdict.Blockers)
                        if (!check.ColliderIds.Contains(id)) check.ColliderIds.Add(id);
                    continue;
                }
                check.Accepted.Add(cell);
            }
            return check;
        }

        /// <summary>The cut tool's preview over a whole candidate list (`checkCutCells`).</summary>
        public static StationCellCheck CheckCutCells(StationCellEditWorld world, IReadOnlyList<StationCellKey> cells,
            StationCellShape shape) {
            var check = new StationCellCheck { Shape = shape };
            var seen = new HashSet<StationCellKey>();
            foreach (var cell in cells) {
                check.Cells.Add(cell);
                if (!seen.Add(cell)) continue;
                // The street is already floor. A cut stands on top of it (the tool's anchor is
                // the air cell above the hit), so a cell the street holds is no candidate.
                if (world.IsGround(cell.X, cell.Y, cell.Z) && !world.IsSolid(cell.X, cell.Y, cell.Z)) {
                    check.Ignored.Add(cell);
                    continue;
                }
                var verdict = CutCourseReason(world, cell.X, cell.Y, cell.Z, shape);
                if (verdict.Verdict == StationCutVerdict.Skip) {
                    check.Ignored.Add(cell);
                    continue;
                }
                if (verdict.Verdict == StationCutVerdict.Refuse) {
                    check.Blocked.Add(cell);
                    if (check.Reason.Length == 0) check.Reason = verdict.Reason;
                    foreach (var id in verdict.Blockers)
                        if (!check.ColliderIds.Contains(id)) check.ColliderIds.Add(id);
                    continue;
                }
                check.Accepted.Add(cell);
            }
            return check;
        }

        // ---------------------------------------------------------------- release

        /// <summary>
        /// `addCells`: lay plain blocks. A held cell and the virtual street are skipped, a rule
        /// refusal is counted, and a `void` record at the coordinate is **replaced** rather than
        /// shadowed; at grade the plain block is the street itself, so the hole record is
        /// dropped instead.
        /// </summary>
        public static StationCellPatch PlanAddCells(StationCellEditWorld world, IReadOnlyList<StationCellKey> cells) {
            var patch = new StationCellPatch();
            var added = new HashSet<StationCellKey>();
            foreach (var cell in cells) {
                int x = cell.X, y = cell.Y, z = cell.Z;
                var key = new StationCellKey(x, y, z);
                if (world.IsSolid(x, y, z) || added.Contains(key) || world.IsGround(x, y, z)) continue;
                if (!BlockReason(world, x, y, z).Ok) continue;
                added.Add(key);
                if (z == StationFootprints.GroundZ && world.IsVoid(x, y, z)) {
                    // At grade a plain block is the implicit street: remove the hole record and
                    // let absence mean ground again, so a delete/re-add cycle leaves no solid.
                    patch.Add(StationCellWrite.Drop(key));
                } else {
                    // One record per coordinate: a course over a dug hole replaces the `void`
                    // record instead of shadowing it.
                    patch.Add(StationCellWrite.Set(key, false));
                }
            }
            AddOpeningCeilingCleanup(world, patch, added);
            return patch;
        }

        /// <summary>
        /// `addFloor`: a 方块 rectangle drag with 生成墙壁 on. Lays the accepted cells tagged
        /// `auto-floor` and rebuilds the wall ring around the union of the surface.
        /// </summary>
        public static StationCellPatch PlanAutoFloor(StationCellEditWorld world, IReadOnlyList<StationCellKey> cells) {
            var patch = new StationCellPatch();
            var added = new HashSet<StationCellKey>();
            var levels = new HashSet<int>();
            foreach (var cell in cells) {
                int x = cell.X, y = cell.Y, z = cell.Z;
                var key = new StationCellKey(x, y, z);
                if (world.IsSolid(x, y, z) || added.Contains(key)) continue;
                if (world.IsGround(x, y, z)) continue;
                if (!BlockReason(world, x, y, z).Ok) continue;
                added.Add(key);
                levels.Add(z);
                var write = StationCellWrite.Set(key, false, AutoFloorTag);
                patch.Add(write);
            }
            if (added.Count == 0) return patch;
            AddOpeningCeilingCleanup(world, patch, added);
            AppendAutoWallSync(world, patch, added, null, levels);
            return patch;
        }

        /// <summary>
        /// `removeCells` + `removeFloor`: dig the cells, leave a hole record at grade so the
        /// virtual plane cannot pave the dig back over, take the modules anchored on them and
        /// rebuild the ring of any auto-floor patch that lost a cell.
        /// </summary>
        public static StationCellPatch PlanRemoveCells(StationCellEditWorld world, IReadOnlyList<StationCellKey> cells) {
            var patch = new StationCellPatch();
            var removed = new HashSet<StationCellKey>();
            var droppedFloors = new HashSet<int>();
            foreach (var cell in cells) {
                if (!world.IsSolid(cell.X, cell.Y, cell.Z)) continue;
                if (!removed.Add(cell)) continue;
                patch.Add(StationCellWrite.Drop(cell));
                if (world.IsAutoFloor(cell.X, cell.Y, cell.Z)) droppedFloors.Add(cell.Z);
                // Digging the street leaves a hole record: without it the virtual plane would
                // pave the dig back over on the next read. A coordinate that is a hole either
                // way (a ramp corridor, an exit floor) needs no record.
                if (cell.Z == StationFootprints.GroundZ && !StationFootprints.IsGroundHole(world.Index, cell.X, cell.Y)) {
                    patch.Add(StationCellWrite.Set(cell, true));
                }
            }
            if (removed.Count == 0) return patch;
            foreach (var module in world.Index.Document.Modules) {
                if (removed.Contains(new StationCellKey(module.X, module.Y, module.Z)) &&
                    !patch.RemoveModuleIds.Contains(module.Id)) patch.RemoveModuleIds.Add(module.Id);
            }
            if (droppedFloors.Count > 0) AppendAutoWallSync(world, patch, null, removed, droppedFloors);
            return patch;
        }

        /// <summary>
        /// `addWalls` with the block tool's parameters: one tagged course per click (a 半墙, a
        /// 薄墙角 or a 三角), or a merged tag on a cut cell whose quarters stay free.
        /// </summary>
        public static StationCellPatch PlanCut(StationCellEditWorld world, IReadOnlyList<StationCellKey> cells,
            StationCellShape shape) {
            var patch = new StationCellPatch();
            var added = new HashSet<StationCellKey>();
            var tag = shape.ToString();
            foreach (var cell in cells) {
                var key = new StationCellKey(cell.X, cell.Y, cell.Z);
                if (added.Contains(key)) continue;
                if (!BlockReason(world, cell.X, cell.Y, cell.Z).Ok) continue;
                if (world.IsSolid(cell.X, cell.Y, cell.Z)) {
                    var verdict = CutCourseReason(world, cell.X, cell.Y, cell.Z, shape);
                    if (verdict.Verdict != StationCutVerdict.Merge) continue;
                    added.Add(key);
                    patch.Add(StationCellWrite.AddTags(key, new[] { tag }));
                    continue;
                }
                added.Add(key);
                patch.Add(StationCellWrite.Set(key, false, WallTag, tag));
            }
            if (added.Count > 0) AddOpeningCeilingCleanup(world, patch, added);
            return patch;
        }

        /// <summary>
        /// `addSuspendedCeiling`: ordinary editable blocks in the service metre, tagged and
        /// finished as the 吊顶 tile draws them.
        /// </summary>
        public static StationCellPatch PlanSuspendedCeiling(StationCellEditWorld world, IReadOnlyList<StationCellKey> cells) {
            var patch = new StationCellPatch();
            var added = new HashSet<StationCellKey>();
            foreach (var cell in cells) {
                int x = cell.X, y = cell.Y, z = cell.Z;
                var key = new StationCellKey(x, y, z);
                if (world.IsSolid(x, y, z) || added.Contains(key) || world.IsGround(x, y, z)) continue;
                if (!BlockReason(world, x, y, z).Ok) continue;
                added.Add(key);
                var write = StationCellWrite.Set(key, false, SuspendedCeilingTag);
                foreach (var face in new[] { "top", "bottom", "n", "s", "e", "w" })
                    write.Finish[face] = "ceil.baffle";
                patch.Add(write);
            }
            if (added.Count > 0) AddOpeningCeilingCleanup(world, patch, added);
            return patch;
        }

        /// <summary>
        /// `plannedAutoWalls`: the new wall columns a 方块 drag will raise — the live ghost's
        /// half of the ring. `patch` is the (preview-only) floor the drag would lay.
        /// </summary>
        public static List<StationCellKey> PlannedAutoWalls(StationCellEditWorld world,
            IReadOnlyList<StationCellKey> patch, int height) {
            var patchSet = new HashSet<StationCellKey>(patch);
            var outCells = new List<StationCellKey>();
            foreach (var cell in patchSet) {
                int x = cell.X, y = cell.Y, z = cell.Z;
                if (world.IsCoveredGround(x, y, z)) continue;
                if (world.IsPlatformDoor(x, y, z)) continue;
                if (!IsOuterEdge(world, patchSet, x, y, z)) continue;
                for (int dz = 1; dz <= height; dz++) {
                    var wall = new StationCellKey(x, y, z + dz);
                    if (world.IsSolid(wall.X, wall.Y, wall.Z)) continue;
                    if (!BlockReason(world, wall.X, wall.Y, wall.Z).Ok) continue;
                    if (!outCells.Contains(wall)) outCells.Add(wall);
                }
            }
            return outCells;
        }

        static bool IsOuterEdge(StationCellEditWorld world, HashSet<StationCellKey> patch, int x, int y, int z) {
            foreach (var (dx, dy) in Neighbours) {
                int nx = x + dx, ny = y + dy;
                var neighbour = new StationCellKey(nx, ny, z);
                if (!world.IsCoveredGround(nx, ny, z) && !patch.Contains(neighbour)) return true;
            }
            return false;
        }

        static readonly (int dx, int dy)[] Neighbours = { (1, 0), (-1, 0), (0, 1), (0, -1) };

        /// <summary>
        /// `syncAutoWalls`: rebuild the ring of every `auto-floor` patch on the levels a
        /// gesture touched. A patch cell on the surface's outer edge earns a full-height
        /// column; a ring course that became interior, or whose floor was dug away, is
        /// dropped. Hand-placed courses are never touched, because only `auto-wall` cells
        /// are named here.
        /// </summary>
        static void AppendAutoWallSync(StationCellEditWorld world, StationCellPatch patch,
            HashSet<StationCellKey> addedSolid, HashSet<StationCellKey> removedSolid, HashSet<int> levels) {
            var covered = new HashSet<StationCellKey>(world.Solid);
            if (addedSolid != null) foreach (var key in addedSolid) covered.Add(key);
            if (removedSolid != null) foreach (var key in removedSolid) covered.Remove(key);
            var trackedByLevel = new Dictionary<int, HashSet<StationCellKey>>();
            foreach (var key in world.AutoFloorCells) {
                if (!levels.Contains(key.Z) || !covered.Contains(key)) continue;
                if (!trackedByLevel.TryGetValue(key.Z, out var set)) trackedByLevel[key.Z] = set = new HashSet<StationCellKey>();
                set.Add(key);
            }
            if (addedSolid != null) {
                foreach (var key in addedSolid) {
                    if (!levels.Contains(key.Z)) continue;
                    if (!trackedByLevel.TryGetValue(key.Z, out var set)) trackedByLevel[key.Z] = set = new HashSet<StationCellKey>();
                    set.Add(key);
                }
            }
            var wanted = new HashSet<StationCellKey>();
            foreach (var pair in trackedByLevel) {
                int level = pair.Key;
                var patchCells = pair.Value;
                var outside = OutsideCells(covered, patchCells, level);
                foreach (var cell in patchCells) {
                    if (world.IsPlatformDoor(cell.X, cell.Y, level)) continue;
                    bool edge = false;
                    foreach (var (dx, dy) in Neighbours) {
                        if (outside.Contains((cell.X + dx, cell.Y + dy))) { edge = true; break; }
                    }
                    if (!edge) continue;
                    for (int dz = 1; dz <= world.StoreyHeight; dz++) {
                        var course = new StationCellKey(cell.X, cell.Y, level + dz);
                        if (covered.Contains(course)) continue;
                        if (!BlockReason(world, course.X, course.Y, course.Z).Ok) continue;
                        wanted.Add(course);
                    }
                }
            }
            var dropped = new HashSet<StationCellKey>();
            foreach (var key in world.AutoWallCells) {
                if (!levels.Contains(key.Z)) continue;
                if (wanted.Contains(key)) continue;
                patch.Add(StationCellWrite.Drop(key));
                dropped.Add(key);
            }
            foreach (var key in wanted) {
                if (covered.Contains(key) || dropped.Contains(key)) continue;
                patch.Add(StationCellWrite.Set(key, false, AutoWallTag));
            }
        }

        /// <summary>
        /// The void pockets the exterior flood reaches: a patch cell touching one is on the
        /// surface's outer edge. A hole dug through the middle of a patch is unreachable, so a
        /// stair opening is never silently boarded up.
        /// </summary>
        static HashSet<(int X, int Y)> OutsideCells(HashSet<StationCellKey> covered,
            HashSet<StationCellKey> patchCells, int level) {
            int minX = int.MaxValue, minY = int.MaxValue, maxX = int.MinValue, maxY = int.MinValue;
            foreach (var cell in patchCells) {
                if (cell.X < minX) minX = cell.X;
                if (cell.Y < minY) minY = cell.Y;
                if (cell.X > maxX) maxX = cell.X;
                if (cell.Y > maxY) maxY = cell.Y;
            }
            minX--; minY--; maxX++; maxY++;
            var seen = new HashSet<(int, int)>();
            var stack = new Stack<(int X, int Y)>();
            void Push(int x, int y) {
                if (x < minX || x > maxX || y < minY || y > maxY) return;
                if (seen.Contains((x, y)) || patchCells.Contains(new StationCellKey(x, y, level))) return;
                if (covered.Contains(new StationCellKey(x, y, level))) return;
                seen.Add((x, y));
                stack.Push((x, y));
            }
            for (int x = minX; x <= maxX; x++) { Push(x, minY); Push(x, maxY); }
            for (int y = minY; y <= maxY; y++) { Push(minX, y); Push(maxX, y); }
            while (stack.Count > 0) {
                var (x, y) = stack.Pop();
                Push(x + 1, y); Push(x - 1, y); Push(x, y + 1); Push(x, y - 1);
            }
            return seen;
        }

        /// <summary>
        /// `clearSupportedOpeningCeilings`: a plate a ramp carve marked unsupported over its
        /// opening is part of a solid column again once a block is restored under it, so the
        /// derived tag goes away.
        /// </summary>
        static void AddOpeningCeilingCleanup(StationCellEditWorld world, StationCellPatch patch, HashSet<StationCellKey> added) {
            foreach (var key in added) {
                var above = world.Index.GetCell(key.X, key.Y, key.Z + 1);
                if (above == null || !above.HasTag(OpeningCeilingTag)) continue;
                patch.Add(StationCellWrite.AddTags(above.Key, null, new[] { OpeningCeilingTag }));
            }
        }
    }
}
