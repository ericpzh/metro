using System;
using System.Collections.Generic;
using System.Globalization;

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
        HashSet<StationCellKey> OpeningsAtLevel(int z, IReadOnlyList<StationModuleRecord> modules);
    }

    /// <summary>
    /// Index-backed reservations handle that caches prepared ramp geometry across levels and
    /// local edits, avoiding repeated whole-station module scans per queried elevation.
    /// </summary>
    public interface IStationPreparedReservations : IStationCellReservations {
        IStationPreparedReservations Bind(StationIndex index);
        IStationPreparedReservations WithDelta(StationIndex nextIndex, StationIndexDelta delta);
        IStationPreparedReservations WithoutModules(HashSet<string> removedModuleIds);
        HashSet<StationCellKey> OpeningsAt(int z);
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
        /// <summary>
        /// Set or erase per-face finishes on an existing or materialised cell record — the 材质
        /// brush's write (`face.paint`).
        /// </summary>
        PaintFaces = 4,
    }

    /// <summary>One surgical change to a cell record, in document order.</summary>
    public sealed class StationCellWrite {
        public StationCellKey Key;
        public StationCellWriteMode Mode;
        public bool Void;
        public bool Materialise;
        public List<string> Tags = new List<string>();
        public List<string> RemoveTags = new List<string>();
        /// <summary>An explicit six-face finish for a new record or `PaintFaces` face map (empty/null value erases that face).</summary>
        public Dictionary<string, string> Finish = new Dictionary<string, string>(StringComparer.Ordinal);
        /// <summary>`Label`/`PaintFaces` mode: the zone to write, `""` to remove it, null to leave it alone.</summary>
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

        public static StationCellWrite PaintFace(StationCellKey key, string face, string finish,
            bool materialise = false, bool materialiseVoid = false, string materialiseZone = null, IEnumerable<string> materialiseTags = null) {
            var write = new StationCellWrite {
                Key = key,
                Mode = StationCellWriteMode.PaintFaces,
                Materialise = materialise,
                Void = materialiseVoid,
                Zone = materialiseZone,
            };
            if (materialiseTags != null) write.Tags.AddRange(materialiseTags);
            if (!string.IsNullOrEmpty(face)) write.Finish[face] = finish ?? "";
            return write;
        }
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
        /// Lines explicitly added by this patch.
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
        internal sealed class RegionCluster {
            public int MinX, MinY, MaxX, MaxY;
            public HashSet<(int X, int Y)> Outside;
            public HashSet<(int X, int Y)> OuterEdgeCells;
        }

        internal sealed class CachedFloorLevel {
            public int Level;
            public int GlobalMinX, GlobalMinY, GlobalMaxX, GlobalMaxY;
            public readonly List<RegionCluster> Clusters = new List<RegionCluster>();
            public readonly HashSet<(int X, int Y)> AllOuterEdgeCells = new HashSet<(int, int)>();
        }

        HashSet<StationCellKey> lazySolidSnapshot;
        readonly HashSet<(int X, int Y)> trackGroundAtGrade;
        readonly HashSet<StationCellKey> exitFloors;
        readonly HashSet<StationCellKey> trackFootprint;
        readonly HashSet<StationCellKey> platformDoors;
        readonly Dictionary<int, HashSet<(int X, int Y)>> autoFloorsByLevel;
        readonly Dictionary<int, HashSet<(int X, int Y)>> autoWallsByLevel;
        readonly Dictionary<int, HashSet<(int X, int Y)>> coveredByFloorLevel;
        readonly Dictionary<int, CachedFloorLevel> floorLevelCache;
        readonly Dictionary<(int X, int Y), HashSet<int>> reverseWallColumnOwners;
        readonly Dictionary<StationCellKey, List<string>> modulesByAnchor;
        readonly Dictionary<int, List<StationModuleRecord>> equipmentCandidatesByZ;
        readonly Dictionary<int, Dictionary<StationCellKey, List<string>>> equipmentOwnersByLevel;
        readonly Dictionary<int, HashSet<StationCellKey>> equipmentByLevel = new Dictionary<int, HashSet<StationCellKey>>();
        readonly Dictionary<int, HashSet<StationCellKey>> openingsByLevel = new Dictionary<int, HashSet<StationCellKey>>();
        readonly IStationCellReservations reservations;
        readonly IStationPreparedReservations preparedReservations;
        readonly IReadOnlyList<StationModuleRecord> modules;
        readonly HashSet<string> excludedModuleIds;

        /// <summary>Pieces whose envelope table is not ported; their reservation is unverified.</summary>
        public readonly List<string> Unverified = new List<string>();

        public StationIndex Index { get; }
        public int StoreyHeight => Index?.StoreyHeight ?? 5;
        public int LevelBase => Index?.LevelBase ?? 0;
        /// <summary>Every saved solid cell, at every level (materialized lazily if queried).</summary>
        public IReadOnlyCollection<StationCellKey> Solid {
            get {
                if (lazySolidSnapshot != null) return lazySolidSnapshot;
                var all = new HashSet<StationCellKey>();
                if (Index != null) {
                    foreach (var c in Index.Document.Cells) if (c.IsSolid) all.Add(c.Key);
                }
                lazySolidSnapshot = all;
                return lazySolidSnapshot;
            }
        }

        StationCellEditWorld(StationIndex index, IStationCellReservations reservations,
            IReadOnlyList<StationModuleRecord> modules) {
            using var trace = StationEditTrace.Measure("StationCellEditWorld.Build");
            Index = index;
            this.reservations = reservations;
            preparedReservations = (reservations as IStationPreparedReservations)?.Bind(index);
            this.modules = modules;

            trackGroundAtGrade = new HashSet<(int, int)>();
            exitFloors = new HashSet<StationCellKey>();
            trackFootprint = new HashSet<StationCellKey>();
            platformDoors = new HashSet<StationCellKey>();
            autoFloorsByLevel = new Dictionary<int, HashSet<(int X, int Y)>>();
            autoWallsByLevel = new Dictionary<int, HashSet<(int X, int Y)>>();
            coveredByFloorLevel = new Dictionary<int, HashSet<(int X, int Y)>>();
            floorLevelCache = new Dictionary<int, CachedFloorLevel>();
            reverseWallColumnOwners = new Dictionary<(int X, int Y), HashSet<int>>();
            modulesByAnchor = new Dictionary<StationCellKey, List<string>>();
            equipmentCandidatesByZ = new Dictionary<int, List<StationModuleRecord>>();
            equipmentOwnersByLevel = new Dictionary<int, Dictionary<StationCellKey, List<string>>>();

            foreach (var cell in index.Document.Cells) {
                AddAutoTagFact(autoFloorsByLevel, autoWallsByLevel, cell);
            }
            foreach (var module in modules) {
                AddModuleFact(module);
            }
        }

        StationCellEditWorld(StationCellEditWorld parent, HashSet<string> excluded, IStationPreparedReservations nextPrepared) {
            Index = parent.Index;
            reservations = parent.reservations;
            preparedReservations = nextPrepared;
            modules = parent.modules;
            excludedModuleIds = excluded;

            autoFloorsByLevel = parent.autoFloorsByLevel;
            autoWallsByLevel = parent.autoWallsByLevel;
            coveredByFloorLevel = parent.coveredByFloorLevel;
            modulesByAnchor = parent.modulesByAnchor;
            equipmentCandidatesByZ = parent.equipmentCandidatesByZ;
            equipmentOwnersByLevel = parent.equipmentOwnersByLevel;
            Unverified.AddRange(parent.Unverified);

            bool touchedStructural = false;
            foreach (var id in excluded) {
                var m = parent.Index?.GetModule(id);
                if (m != null && (m.Type == "exit" || m.Type == "track" || m.Type == "platform-edge")) {
                    touchedStructural = true;
                    break;
                }
            }
            if (!touchedStructural) {
                exitFloors = parent.exitFloors;
                trackFootprint = parent.trackFootprint;
                trackGroundAtGrade = parent.trackGroundAtGrade;
                platformDoors = parent.platformDoors;
                floorLevelCache = parent.floorLevelCache;
                reverseWallColumnOwners = parent.reverseWallColumnOwners;
            } else {
                exitFloors = new HashSet<StationCellKey>();
                trackFootprint = new HashSet<StationCellKey>();
                trackGroundAtGrade = new HashSet<(int, int)>();
                platformDoors = new HashSet<StationCellKey>();
                floorLevelCache = new Dictionary<int, CachedFloorLevel>();
                reverseWallColumnOwners = new Dictionary<(int X, int Y), HashSet<int>>();
                RebuildStructuralModuleSets(parent.Index, excluded);
            }
        }

        StationCellEditWorld(StationCellEditWorld previous, StationIndex nextIndex, StationIndexDelta delta) {
            using var trace = StationEditTrace.Measure("StationCellEditWorld.ApplyDelta");
            Index = nextIndex;
            reservations = previous.reservations;
            preparedReservations = previous.preparedReservations != null
                ? previous.preparedReservations.WithDelta(nextIndex, delta)
                : (reservations as IStationPreparedReservations)?.Bind(nextIndex);
            modules = nextIndex.Document.Modules;
            Unverified.AddRange(previous.Unverified);

            bool hasCellChanges = delta.RemovedCells.Count > 0 || delta.ChangedCells.Count > 0;
            bool hasModuleChanges = delta.RemovedModules.Count > 0 || delta.ChangedModules.Count > 0;

            if (!hasCellChanges) {
                autoFloorsByLevel = previous.autoFloorsByLevel;
                autoWallsByLevel = previous.autoWallsByLevel;
            } else {
                autoFloorsByLevel = new Dictionary<int, HashSet<(int X, int Y)>>(previous.autoFloorsByLevel);
                autoWallsByLevel = new Dictionary<int, HashSet<(int X, int Y)>>(previous.autoWallsByLevel);
            }

            coveredByFloorLevel = new Dictionary<int, HashSet<(int X, int Y)>>(previous.coveredByFloorLevel);
            floorLevelCache = new Dictionary<int, CachedFloorLevel>(previous.floorLevelCache);
            reverseWallColumnOwners = new Dictionary<(int X, int Y), HashSet<int>>();

            bool rebuildStructural = false;
            if (!hasModuleChanges) {
                trackGroundAtGrade = previous.trackGroundAtGrade;
                exitFloors = previous.exitFloors;
                trackFootprint = previous.trackFootprint;
                platformDoors = previous.platformDoors;
                modulesByAnchor = previous.modulesByAnchor;
                equipmentCandidatesByZ = previous.equipmentCandidatesByZ;
                equipmentOwnersByLevel = previous.equipmentOwnersByLevel;
            } else {
                modulesByAnchor = new Dictionary<StationCellKey, List<string>>(previous.modulesByAnchor);
                equipmentCandidatesByZ = new Dictionary<int, List<StationModuleRecord>>(previous.equipmentCandidatesByZ);
                equipmentOwnersByLevel = new Dictionary<int, Dictionary<StationCellKey, List<string>>>(previous.equipmentOwnersByLevel);

                var clonedAnchors = new HashSet<StationCellKey>();
                var clonedEquipZ = new HashSet<int>();

                for (int i = 0; i < delta.RemovedModules.Count; i++) {
                    var oldMod = previous.Index.GetModule(delta.RemovedModules[i]);
                    if (oldMod == null) continue;
                    UpdateModuleCopyOnWrite(oldMod, add: false, clonedAnchors, clonedEquipZ, out bool s);
                    if (s) rebuildStructural = true;
                }
                for (int i = 0; i < delta.ChangedModules.Count; i++) {
                    var nextMod = delta.ChangedModules[i];
                    var oldMod = previous.Index.GetModule(nextMod.Id);
                    if (oldMod != null) {
                        UpdateModuleCopyOnWrite(oldMod, add: false, clonedAnchors, clonedEquipZ, out bool sOld);
                        if (sOld) rebuildStructural = true;
                    }
                    UpdateModuleCopyOnWrite(nextMod, add: true, clonedAnchors, clonedEquipZ, out bool sNew);
                    if (sNew) rebuildStructural = true;
                }

                if (rebuildStructural) {
                    exitFloors = new HashSet<StationCellKey>();
                    trackFootprint = new HashSet<StationCellKey>();
                    trackGroundAtGrade = new HashSet<(int, int)>();
                    platformDoors = new HashSet<StationCellKey>();
                    coveredByFloorLevel.Clear();
                    floorLevelCache.Clear();
                    RebuildStructuralModuleSets(nextIndex, null);
                } else {
                    exitFloors = previous.exitFloors;
                    trackFootprint = previous.trackFootprint;
                    trackGroundAtGrade = previous.trackGroundAtGrade;
                    platformDoors = previous.platformDoors;
                }
            }

            var clonedFloorSets = new HashSet<int>();
            var clonedWallSets = new HashSet<int>();
            var clonedCovSets = new HashSet<int>();
            var dirtyFloorLevels = new Dictionary<int, HashSet<(int X, int Y)>>();

            void MarkFloorPoint(int z, int x, int y) {
                if (!dirtyFloorLevels.TryGetValue(z, out var pts)) dirtyFloorLevels[z] = pts = new HashSet<(int, int)>();
                pts.Add((x, y));
            }

            for (int i = 0; i < delta.RemovedCells.Count; i++) {
                var key = delta.RemovedCells[i];
                var oldCell = previous.Index.GetCell(key);
                if (oldCell != null) {
                    UpdateCellSetsCopyOnWrite(oldCell, add: false, clonedFloorSets, clonedWallSets, clonedCovSets);
                    MarkFloorPoint(key.Z, key.X, key.Y);
                }
            }
            for (int i = 0; i < delta.ChangedCells.Count; i++) {
                var nextCell = delta.ChangedCells[i];
                var oldCell = previous.Index.GetCell(nextCell.Key);
                if (oldCell != null) {
                    UpdateCellSetsCopyOnWrite(oldCell, add: false, clonedFloorSets, clonedWallSets, clonedCovSets);
                }
                UpdateCellSetsCopyOnWrite(nextCell, add: true, clonedFloorSets, clonedWallSets, clonedCovSets);
                MarkFloorPoint(nextCell.Z, nextCell.X, nextCell.Y);
            }

            if (!rebuildStructural) {
                foreach (var z in dirtyFloorLevels.Keys) floorLevelCache.Remove(z);
                foreach (var kv in floorLevelCache) {
                    foreach (var xy in kv.Value.AllOuterEdgeCells) SetReverseWallOwner(xy, kv.Key, add: true);
                }
            }
        }

        static void AddAutoTagFact(
            Dictionary<int, HashSet<(int X, int Y)>> autoFloors,
            Dictionary<int, HashSet<(int X, int Y)>> autoWalls,
            StationCellRecord cell) {
            if (cell.HasTag("auto-wall")) {
                if (!autoWalls.TryGetValue(cell.Z, out var w)) autoWalls[cell.Z] = w = new HashSet<(int, int)>();
                w.Add((cell.X, cell.Y));
            }
            if (cell.IsSolid && cell.HasTag("auto-floor")) {
                if (!autoFloors.TryGetValue(cell.Z, out var f)) autoFloors[cell.Z] = f = new HashSet<(int, int)>();
                f.Add((cell.X, cell.Y));
            }
        }

        void UpdateCellSetsCopyOnWrite(StationCellRecord cell, bool add,
            HashSet<int> clonedFloors, HashSet<int> clonedWalls, HashSet<int> clonedCov) {
            var xy = (cell.X, cell.Y);
            int z = cell.Z;
            if (cell.HasTag("auto-wall")) {
                if (add) {
                    if (!autoWallsByLevel.TryGetValue(z, out var w)) {
                        autoWallsByLevel[z] = w = new HashSet<(int, int)>();
                        clonedWalls.Add(z);
                    } else if (clonedWalls.Add(z)) {
                        autoWallsByLevel[z] = w = new HashSet<(int, int)>(w);
                    }
                    w.Add(xy);
                } else if (autoWallsByLevel.TryGetValue(z, out var w)) {
                    if (clonedWalls.Add(z)) autoWallsByLevel[z] = w = new HashSet<(int, int)>(w);
                    w.Remove(xy);
                    if (w.Count == 0) autoWallsByLevel.Remove(z);
                }
            }
            if (cell.IsSolid) {
                if (coveredByFloorLevel.TryGetValue(z, out var cov)) {
                    if (clonedCov.Add(z)) coveredByFloorLevel[z] = cov = new HashSet<(int, int)>(cov);
                    if (add) cov.Add(xy);
                    else if (!trackFootprint.Contains(cell.Key)) cov.Remove(xy);
                }
                if (cell.HasTag("auto-floor")) {
                    if (add) {
                        if (!autoFloorsByLevel.TryGetValue(z, out var f)) {
                            autoFloorsByLevel[z] = f = new HashSet<(int, int)>();
                            clonedFloors.Add(z);
                        } else if (clonedFloors.Add(z)) {
                            autoFloorsByLevel[z] = f = new HashSet<(int, int)>(f);
                        }
                        f.Add(xy);
                    } else if (autoFloorsByLevel.TryGetValue(z, out var f)) {
                        if (clonedFloors.Add(z)) autoFloorsByLevel[z] = f = new HashSet<(int, int)>(f);
                        f.Remove(xy);
                        if (f.Count == 0) autoFloorsByLevel.Remove(z);
                    }
                }
            }
        }

        void UpdateModuleCopyOnWrite(StationModuleRecord module, bool add,
            HashSet<StationCellKey> clonedAnchors, HashSet<int> clonedEquipZ, out bool structural) {
            structural = module.Type == "exit" || module.Type == "track" || module.Type == "platform-edge";
            var anchor = new StationCellKey(module.X, module.Y, module.Z);
            if (add) {
                if (!modulesByAnchor.TryGetValue(anchor, out var list)) {
                    modulesByAnchor[anchor] = list = new List<string>(2);
                    clonedAnchors.Add(anchor);
                } else if (clonedAnchors.Add(anchor)) {
                    modulesByAnchor[anchor] = list = new List<string>(list);
                }
                list.Add(module.Id);
            } else if (modulesByAnchor.TryGetValue(anchor, out var list)) {
                if (clonedAnchors.Add(anchor)) modulesByAnchor[anchor] = list = new List<string>(list);
                list.Remove(module.Id);
                if (list.Count == 0) modulesByAnchor.Remove(anchor);
            }

            if (IsRunOrRail(module.Type) && !(module.Type == "stair" && module.Config.Bool("block"))) return;
            if (module.Type == "roof" && module.Config.Text("variant") == "canopy") {
                if (add && !Unverified.Contains(module.Id)) Unverified.Add(module.Id);
                else if (!add) Unverified.Remove(module.Id);
                return;
            }
            int zMin = module.Z, zMax = module.Z;
            if (StationFootprints.TryClearance(module, out var box, out _)) {
                int b0 = (int)Math.Floor(box.Z0), b1 = (int)Math.Ceiling(box.Z1) - 1;
                if (b0 < zMin) zMin = b0;
                if (b1 > zMax) zMax = b1;
            }
            for (int z = zMin; z <= zMax; z++) {
                if (add) {
                    if (!equipmentCandidatesByZ.TryGetValue(z, out var list)) {
                        equipmentCandidatesByZ[z] = list = new List<StationModuleRecord>(4);
                        clonedEquipZ.Add(z);
                    } else if (clonedEquipZ.Add(z)) {
                        equipmentCandidatesByZ[z] = list = new List<StationModuleRecord>(list);
                    }
                    list.Add(module);
                } else if (equipmentCandidatesByZ.TryGetValue(z, out var list)) {
                    if (clonedEquipZ.Add(z)) equipmentCandidatesByZ[z] = list = new List<StationModuleRecord>(list);
                    for (int i = list.Count - 1; i >= 0; i--) {
                        if (string.Equals(list[i].Id, module.Id, StringComparison.Ordinal)) { list.RemoveAt(i); break; }
                    }
                    if (list.Count == 0) equipmentCandidatesByZ.Remove(z);
                }
                equipmentOwnersByLevel.Remove(z);
                equipmentByLevel.Remove(z);
            }
        }

        void AddModuleFact(StationModuleRecord module) => AddModuleFact(module, out _);

        void AddModuleFact(StationModuleRecord module, out bool structural) {
            structural = false;
            var anchor = new StationCellKey(module.X, module.Y, module.Z);
            if (!modulesByAnchor.TryGetValue(anchor, out var anchoredList))
                modulesByAnchor[anchor] = anchoredList = new List<string>(2);
            anchoredList.Add(module.Id);

            if (module.Type == "exit") {
                structural = true;
                var style = module.Config.Text("style");
                if (style != "doorway" && style != "virtual") {
                    foreach (var cell in StationFootprints.ExitFootprint(module))
                        exitFloors.Add(new StationCellKey((int)Math.Round(cell.X), (int)Math.Round(cell.Y), (int)Math.Round(cell.Z)));
                }
            } else if (module.Type == "track") {
                structural = true;
                bool cutsGround = StationFootprints.TrackCutsGround(module);
                foreach (var cell in StationFootprints.TrackCells(module)) {
                    var key = new StationCellKey((int)Math.Round(cell.X), (int)Math.Round(cell.Y), (int)Math.Round(cell.Z));
                    trackFootprint.Add(key);
                    if (coveredByFloorLevel.TryGetValue(key.Z, out var cov)) cov.Add((key.X, key.Y));
                    if (cutsGround)
                        trackGroundAtGrade.Add((key.X, key.Y));
                }
            } else if (module.Type == "platform-edge") {
                structural = true;
                foreach (var cell in StationFootprints.Footprint(module))
                    platformDoors.Add(new StationCellKey((int)Math.Round(cell.X), (int)Math.Round(cell.Y), module.Z));
            }

            RegisterEquipmentCandidate(module, add: true);
        }

        void RemoveModuleFact(StationModuleRecord module, out bool structural) {
            structural = module.Type == "exit" || module.Type == "track" || module.Type == "platform-edge";
            var anchor = new StationCellKey(module.X, module.Y, module.Z);
            if (modulesByAnchor.TryGetValue(anchor, out var anchoredList)) {
                anchoredList.Remove(module.Id);
                if (anchoredList.Count == 0) modulesByAnchor.Remove(anchor);
            }
            RegisterEquipmentCandidate(module, add: false);
        }

        void RebuildStructuralModuleSets(StationIndex idx, HashSet<string> excluded) {
            if (idx == null) return;
            foreach (var module in idx.ModulesOfType("exit")) {
                if (excluded != null && excluded.Contains(module.Id)) continue;
                var style = module.Config.Text("style");
                if (style == "doorway" || style == "virtual") continue;
                foreach (var cell in StationFootprints.ExitFootprint(module))
                    exitFloors.Add(new StationCellKey((int)Math.Round(cell.X), (int)Math.Round(cell.Y), (int)Math.Round(cell.Z)));
            }
            foreach (var module in idx.ModulesOfType("track")) {
                if (excluded != null && excluded.Contains(module.Id)) continue;
                bool cutsGround = StationFootprints.TrackCutsGround(module);
                foreach (var cell in StationFootprints.TrackCells(module)) {
                    var key = new StationCellKey((int)Math.Round(cell.X), (int)Math.Round(cell.Y), (int)Math.Round(cell.Z));
                    trackFootprint.Add(key);
                    if (cutsGround)
                        trackGroundAtGrade.Add((key.X, key.Y));
                }
            }
            foreach (var module in idx.ModulesOfType("platform-edge")) {
                if (excluded != null && excluded.Contains(module.Id)) continue;
                foreach (var cell in StationFootprints.Footprint(module))
                    platformDoors.Add(new StationCellKey((int)Math.Round(cell.X), (int)Math.Round(cell.Y), module.Z));
            }
        }

        void RegisterEquipmentCandidate(StationModuleRecord module, bool add) {
            if (IsRunOrRail(module.Type) && !(module.Type == "stair" && module.Config.Bool("block"))) return;
            if (module.Type == "roof" && module.Config.Text("variant") == "canopy") {
                if (add && !Unverified.Contains(module.Id)) Unverified.Add(module.Id);
                else if (!add) Unverified.Remove(module.Id);
                return;
            }
            int zMin = module.Z;
            int zMax = module.Z;
            if (StationFootprints.TryClearance(module, out var box, out _)) {
                int b0 = (int)Math.Floor(box.Z0);
                int b1 = (int)Math.Ceiling(box.Z1) - 1;
                if (b0 < zMin) zMin = b0;
                if (b1 > zMax) zMax = b1;
            }
            for (int z = zMin; z <= zMax; z++) {
                if (add) {
                    if (!equipmentCandidatesByZ.TryGetValue(z, out var list))
                        equipmentCandidatesByZ[z] = list = new List<StationModuleRecord>(8);
                    list.Add(module);
                } else if (equipmentCandidatesByZ.TryGetValue(z, out var list)) {
                    for (int i = list.Count - 1; i >= 0; i--) {
                        if (string.Equals(list[i].Id, module.Id, StringComparison.Ordinal)) {
                            list.RemoveAt(i);
                            break;
                        }
                    }
                    if (list.Count == 0) equipmentCandidatesByZ.Remove(z);
                }
                equipmentOwnersByLevel.Remove(z);
                equipmentByLevel.Remove(z);
            }
        }

        /// <summary>Build the world for one document. `reservations` may be null.</summary>
        public static StationCellEditWorld Build(StationIndex index, IStationCellReservations reservations = null) =>
            index == null ? null : new StationCellEditWorld(index, reservations, index.Document.Modules);

        /// <summary>Advance a retained edit world across one committed local delta.</summary>
        public StationCellEditWorld ApplyLocalDelta(StationIndex nextIndex, StationIndexDelta delta) =>
            nextIndex == null || delta == null ? Build(nextIndex, reservations) : new StationCellEditWorld(this, nextIndex, delta);

        internal StationCellEditWorld WithoutModules(IReadOnlyList<string> ids) {
            if (ids == null || ids.Count == 0) return this;
            var removed = excludedModuleIds != null
                ? new HashSet<string>(excludedModuleIds, StringComparer.Ordinal)
                : new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < ids.Count; i++) {
                if (!string.IsNullOrEmpty(ids[i])) removed.Add(ids[i]);
            }
            if (removed.Count == 0) return this;
            var nextPrepared = preparedReservations?.WithoutModules(removed);
            return new StationCellEditWorld(this, removed, nextPrepared);
        }

        internal void CollectAnchoredModuleIds(HashSet<StationCellKey> cells, List<string> sink) {
            foreach (var cell in cells) {
                if (!modulesByAnchor.TryGetValue(cell, out var ids)) continue;
                for (int i = 0; i < ids.Count; i++) {
                    var id = ids[i];
                    if (excludedModuleIds != null && excludedModuleIds.Contains(id)) continue;
                    sink.Add(id);
                }
            }
        }

        // ------------------------------------------------------------- queries

        public bool IsSolid(int x, int y, int z) => Index?.GetCell(x, y, z)?.IsSolid == true;

        public bool IsVoid(int x, int y, int z) {
            var c = Index?.GetCell(x, y, z);
            return c != null && !c.IsSolid;
        }

        public bool IsTrackCell(int x, int y, int z) {
            var key = new StationCellKey(x, y, z);
            if (IsTrackFootprint(key)) return true;
            if (z == StationFootprints.GroundZ && trackGroundAtGrade.Contains((x, y))) return true;
            var c = Index?.GetCell(key);
            return c != null && c.IsSolid && string.Equals(c.FinishTop, "floor.track", StringComparison.Ordinal);
        }

        public bool IsExitFloor(int x, int y, int z) => exitFloors.Contains(new StationCellKey(x, y, z));
        public bool IsPlatformDoor(int x, int y, int z) => platformDoors.Contains(new StationCellKey(x, y, z));

        public bool IsAutoFloor(int x, int y, int z) =>
            autoFloorsByLevel.TryGetValue(z, out var set) && set.Contains((x, y));

        /// <summary>True for a cell a reserved opening holds (`reservedOpening`).</summary>
        public bool IsOpening(int x, int y, int z) {
            if (exitFloors.Contains(new StationCellKey(x, y, z))) return true;
            var openings = OpeningsAt(z);
            return openings != null && openings.Contains(new StationCellKey(x, y, z));
        }

        public bool IsGround(int x, int y, int z) =>
            z == StationFootprints.GroundZ && !IsVoid(x, y, (int)StationFootprints.GroundZ) &&
            !trackGroundAtGrade.Contains((x, y)) && !IsOpening(x, y, z);

        public bool IsFloor(int x, int y, int z) => IsSolid(x, y, z) || IsGround(x, y, z);

        HashSet<StationCellKey> OpeningsAt(int z) {
            if (preparedReservations != null) return preparedReservations.OpeningsAt(z);
            if (openingsByLevel.TryGetValue(z, out var known)) return known;
            IReadOnlyList<StationModuleRecord> effectiveModules = modules;
            if (excludedModuleIds != null && excludedModuleIds.Count > 0) {
                var filtered = new List<StationModuleRecord>(modules.Count);
                for (int i = 0; i < modules.Count; i++) {
                    if (!excludedModuleIds.Contains(modules[i].Id)) filtered.Add(modules[i]);
                }
                effectiveModules = filtered;
            }
            var cells = reservations?.OpeningsAtLevel(z, effectiveModules);
            openingsByLevel[z] = cells;
            return cells;
        }

        Dictionary<StationCellKey, List<string>> EnsureEquipmentOwnersAt(int z) {
            if (equipmentOwnersByLevel.TryGetValue(z, out var owners)) return owners;
            owners = new Dictionary<StationCellKey, List<string>>();
            if (equipmentCandidatesByZ.TryGetValue(z, out var candidates)) {
                for (int i = 0; i < candidates.Count; i++) {
                    var module = candidates[i];
                    void AddOwner(StationCellKey k) {
                        if (!owners.TryGetValue(k, out var list)) owners[k] = list = new List<string>(1);
                        if (!list.Contains(module.Id)) list.Add(module.Id);
                    }
                    if (module.Z == z) {
                        AddOwner(new StationCellKey(module.X, module.Y, module.Z));
                        foreach (var cell in OccupyingCells(module)) {
                            int cx = (int)Math.Round(cell.X), cy = (int)Math.Round(cell.Y);
                            AddOwner(new StationCellKey(cx, cy, z));
                        }
                    }
                    if (StationFootprints.TryClearance(module, out var box, out _) &&
                        box.Z1 > z && box.Z0 < z + 1) {
                        int x0 = (int)Math.Floor(box.X0), x1 = (int)Math.Ceiling(box.X1);
                        int y0 = (int)Math.Floor(box.Y0), y1 = (int)Math.Ceiling(box.Y1);
                        for (int x = x0; x < x1; x++)
                            for (int y = y0; y < y1; y++)
                                AddOwner(new StationCellKey(x, y, z));
                    }
                }
            }
            equipmentOwnersByLevel[z] = owners;
            return owners;
        }

        public bool IsEquipmentBlocked(StationCellKey key) {
            var owners = EnsureEquipmentOwnersAt(key.Z);
            if (!owners.TryGetValue(key, out var list) || list.Count == 0) return false;
            if (excludedModuleIds == null || excludedModuleIds.Count == 0) return true;
            for (int i = 0; i < list.Count; i++) {
                if (!excludedModuleIds.Contains(list[i])) return true;
            }
            return false;
        }

        /// <summary>The cells a placed piece stands in at level `z` (port of `moduleBlockedCells`).</summary>
        public HashSet<StationCellKey> EquipmentBlockedAt(int z) {
            if (equipmentByLevel.TryGetValue(z, out var known)) return known;
            var owners = EnsureEquipmentOwnersAt(z);
            var blocked = new HashSet<StationCellKey>();
            foreach (var pair in owners) {
                if (excludedModuleIds == null || excludedModuleIds.Count == 0) {
                    blocked.Add(pair.Key);
                } else {
                    for (int i = 0; i < pair.Value.Count; i++) {
                        if (!excludedModuleIds.Contains(pair.Value[i])) {
                            blocked.Add(pair.Key);
                            break;
                        }
                    }
                }
            }
            equipmentByLevel[z] = blocked;
            return blocked;
        }

        /// <summary>The pieces standing in one cell, in document order.</summary>
        public List<string> EquipmentBlockersAt(int x, int y, int z) {
            var outIds = new List<string>();
            var key = new StationCellKey(x, y, z);
            if (!IsEquipmentBlocked(key)) return outIds;
            var cell = new StationBox(x, y, z, x + 1, y + 1, z + 1);
            if (equipmentCandidatesByZ.TryGetValue(z, out var candidates)) {
                for (int i = 0; i < candidates.Count; i++) {
                    var module = candidates[i];
                    if (excludedModuleIds != null && excludedModuleIds.Contains(module.Id)) continue;
                    if (!StationFootprints.TryClearance(module, out var box, out _)) continue;
                    if (!cell.Overlaps(box)) continue;
                    if (!outIds.Contains(module.Id)) outIds.Add(module.Id);
                }
            }
            return outIds;
        }

        /// <summary>Every floor cell of the patch a wall ring must treat as covered ground.</summary>
        public bool IsCoveredGround(int x, int y, int z) =>
            IsSolid(x, y, z) || trackFootprint.Contains(new StationCellKey(x, y, z));

        internal bool IsTrackFootprint(StationCellKey key) => trackFootprint.Contains(key);

        internal IEnumerable<StationCellKey> AutoFloorCells {
            get {
                foreach (var pair in autoFloorsByLevel) {
                    foreach (var xy in pair.Value) yield return new StationCellKey(xy.X, xy.Y, pair.Key);
                }
            }
        }

        internal IEnumerable<StationCellKey> AutoWallCells {
            get {
                foreach (var pair in autoWallsByLevel) {
                    foreach (var xy in pair.Value) yield return new StationCellKey(xy.X, xy.Y, pair.Key);
                }
            }
        }

        internal bool TryGetAutoFloorsAt(int level, out HashSet<(int X, int Y)> floors) =>
            autoFloorsByLevel.TryGetValue(level, out floors) && floors.Count > 0;

        internal bool TryGetAutoWallsAt(int z, out HashSet<(int X, int Y)> walls) =>
            autoWallsByLevel.TryGetValue(z, out walls) && walls.Count > 0;

        HashSet<(int X, int Y)> EnsureCoveredAtFloorLevel(int level) {
            if (coveredByFloorLevel.TryGetValue(level, out var cov)) return cov;
            cov = new HashSet<(int X, int Y)>();
            if (Index?.Document?.Cells is StationRecordPages<StationCellRecord> pages) {
                for (int p = 0; p < pages.PageCount; p++) {
                    var span = pages.PageSpan(p);
                    for (int i = 0; i < span.Length; i++) {
                        var cell = span[i];
                        if (cell.IsSolid && cell.Z == level) cov.Add((cell.X, cell.Y));
                    }
                }
            } else if (Index?.Document?.Cells != null) {
                var cells = Index.Document.Cells;
                for (int i = 0; i < cells.Count; i++) {
                    var cell = cells[i];
                    if (cell.IsSolid && cell.Z == level) cov.Add((cell.X, cell.Y));
                }
            }
            foreach (var key in trackFootprint) {
                if (key.Z == level) cov.Add((key.X, key.Y));
            }
            coveredByFloorLevel[level] = cov;
            return cov;
        }

        void SetReverseWallOwner((int X, int Y) xy, int floorLevel, bool add) {
            if (add) {
                if (!reverseWallColumnOwners.TryGetValue(xy, out var set))
                    reverseWallColumnOwners[xy] = set = new HashSet<int>();
                set.Add(floorLevel);
            } else if (reverseWallColumnOwners.TryGetValue(xy, out var set)) {
                set.Remove(floorLevel);
                if (set.Count == 0) reverseWallColumnOwners.Remove(xy);
            }
        }

        void InvalidateFloorLevelPoints(int level, HashSet<(int X, int Y)> dirtyPoints) {
            if (!floorLevelCache.TryGetValue(level, out var cached)) return;
            if (!TryGetAutoFloorsAt(level, out var floors)) {
                foreach (var xy in cached.AllOuterEdgeCells) SetReverseWallOwner(xy, level, add: false);
                floorLevelCache.Remove(level);
                return;
            }
            ComputeFloorBounds(floors, out int gMinX, out int gMinY, out int gMaxX, out int gMaxY);
            if (gMinX != cached.GlobalMinX || gMinY != cached.GlobalMinY ||
                gMaxX != cached.GlobalMaxX || gMaxY != cached.GlobalMaxY) {
                foreach (var xy in cached.AllOuterEdgeCells) SetReverseWallOwner(xy, level, add: false);
                floorLevelCache.Remove(level);
                return;
            }

            var cov = EnsureCoveredAtFloorLevel(level);
            // Fast path: interior removal/change strictly inside one cluster that never touches Outside
            if (dirtyPoints.Count > 0) {
                RegionCluster singleCluster = null;
                bool strictlyInterior = true;
                foreach (var p in dirtyPoints) {
                    if (cov.Contains(p)) { strictlyInterior = false; break; }
                    RegionCluster hit = null;
                    for (int c = 0; c < cached.Clusters.Count; c++) {
                        var cl = cached.Clusters[c];
                        if (p.X > cl.MinX && p.X < cl.MaxX && p.Y > cl.MinY && p.Y < cl.MaxY) {
                            hit = cl;
                            break;
                        }
                    }
                    if (hit == null || (singleCluster != null && !ReferenceEquals(singleCluster, hit))) {
                        strictlyInterior = false;
                        break;
                    }
                    singleCluster = hit;
                    if (hit.Outside.Contains(p) ||
                        hit.Outside.Contains((p.X + 1, p.Y)) || hit.Outside.Contains((p.X - 1, p.Y)) ||
                        hit.Outside.Contains((p.X, p.Y + 1)) || hit.Outside.Contains((p.X, p.Y - 1))) {
                        strictlyInterior = false;
                        break;
                    }
                }
                if (strictlyInterior && singleCluster != null) {
                    foreach (var p in dirtyPoints) {
                        if (singleCluster.OuterEdgeCells.Remove(p) && cached.AllOuterEdgeCells.Remove(p)) {
                            SetReverseWallOwner(p, level, add: false);
                        }
                    }
                    return;
                }
            }

            foreach (var xy in cached.AllOuterEdgeCells) SetReverseWallOwner(xy, level, add: false);
            floorLevelCache.Remove(level);
        }

        internal CachedFloorLevel GetOrBuildFloorLevel(int level) {
            if (floorLevelCache.TryGetValue(level, out var cached)) return cached;
            if (!TryGetAutoFloorsAt(level, out var floors)) return null;

            ComputeFloorBounds(floors, out int gMinX, out int gMinY, out int gMaxX, out int gMaxY);
            var cov = EnsureCoveredAtFloorLevel(level);
            cached = BuildFloorLevelClusters(level, floors, cov, gMinX, gMinY, gMaxX, gMaxY);
            floorLevelCache[level] = cached;
            foreach (var xy in cached.AllOuterEdgeCells) SetReverseWallOwner(xy, level, add: true);
            return cached;
        }

        static void ComputeFloorBounds(HashSet<(int X, int Y)> floors, out int gMinX, out int gMinY, out int gMaxX, out int gMaxY) {
            int minX = int.MaxValue, minY = int.MaxValue, maxX = int.MinValue, maxY = int.MinValue;
            foreach (var (x, y) in floors) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
            gMinX = minX - 1;
            gMinY = minY - 1;
            gMaxX = maxX + 1;
            gMaxY = maxY + 1;
        }

        CachedFloorLevel BuildFloorLevelClusters(int level, HashSet<(int X, int Y)> floors,
            HashSet<(int X, int Y)> covered, int gMinX, int gMinY, int gMaxX, int gMaxY) {
            var state = new CachedFloorLevel {
                Level = level,
                GlobalMinX = gMinX, GlobalMinY = gMinY, GlobalMaxX = gMaxX, GlobalMaxY = gMaxY,
            };

            var visited = new HashSet<(int X, int Y)>();
            var stack = new Stack<(int X, int Y)>();
            var boxes = new List<(int x0, int y0, int x1, int y1, bool hasAutoFloor)>();

            foreach (var seed in covered) {
                if (seed.X < gMinX || seed.X > gMaxX || seed.Y < gMinY || seed.Y > gMaxY) continue;
                if (!visited.Add(seed)) continue;
                int x0 = seed.X, y0 = seed.Y, x1 = seed.X, y1 = seed.Y;
                bool hasAuto = floors.Contains(seed);
                stack.Push(seed);
                while (stack.Count > 0) {
                    var (cx, cy) = stack.Pop();
                    if (cx < x0) x0 = cx;
                    if (cy < y0) y0 = cy;
                    if (cx > x1) x1 = cx;
                    if (cy > y1) y1 = cy;
                    if (!hasAuto && floors.Contains((cx, cy))) hasAuto = true;

                    CheckNeighbour(cx + 1, cy);
                    CheckNeighbour(cx - 1, cy);
                    CheckNeighbour(cx, cy + 1);
                    CheckNeighbour(cx, cy - 1);
                }
                boxes.Add((
                    Math.Max(gMinX, x0 - 1),
                    Math.Max(gMinY, y0 - 1),
                    Math.Min(gMaxX, x1 + 1),
                    Math.Min(gMaxY, y1 + 1),
                    hasAuto));

                void CheckNeighbour(int nx, int ny) {
                    if (nx < gMinX || nx > gMaxX || ny < gMinY || ny > gMaxY) return;
                    if (!covered.Contains((nx, ny)) || !visited.Add((nx, ny))) return;
                    stack.Push((nx, ny));
                }
            }

            // Merge overlapping or touching 1-padded component boxes so every cluster has
            // guaranteed exterior air wrapping its entire perimeter.
            bool merged = true;
            while (merged) {
                merged = false;
                for (int i = 0; i < boxes.Count; i++) {
                    for (int j = i + 1; j < boxes.Count; j++) {
                        var a = boxes[i];
                        var b = boxes[j];
                        if (a.x1 >= b.x0 && b.x1 >= a.x0 && a.y1 >= b.y0 && b.y1 >= a.y0) {
                            boxes[i] = (
                                Math.Min(a.x0, b.x0), Math.Min(a.y0, b.y0),
                                Math.Max(a.x1, b.x1), Math.Max(a.y1, b.y1),
                                a.hasAutoFloor || b.hasAutoFloor);
                            boxes.RemoveAt(j);
                            merged = true;
                            break;
                        }
                    }
                    if (merged) break;
                }
            }

            for (int i = 0; i < boxes.Count; i++) {
                var b = boxes[i];
                if (!b.hasAutoFloor) continue;
                var outside = FloodBox(b.x0, b.y0, b.x1, b.y1, xy => covered.Contains(xy));
                var outerEdges = new HashSet<(int X, int Y)>();
                foreach (var xy in floors) {
                    if (xy.X < b.x0 || xy.X > b.x1 || xy.Y < b.y0 || xy.Y > b.y1) continue;
                    if (IsPlatformDoor(xy.X, xy.Y, level)) continue;
                    if (outside.Contains((xy.X + 1, xy.Y)) || outside.Contains((xy.X - 1, xy.Y)) ||
                        outside.Contains((xy.X, xy.Y + 1)) || outside.Contains((xy.X, xy.Y - 1))) {
                        outerEdges.Add(xy);
                        state.AllOuterEdgeCells.Add(xy);
                    }
                }
                state.Clusters.Add(new RegionCluster {
                    MinX = b.x0, MinY = b.y0, MaxX = b.x1, MaxY = b.y1,
                    Outside = outside,
                    OuterEdgeCells = outerEdges,
                });
            }
            return state;
        }

        internal static HashSet<(int X, int Y)> FloodBox(int minX, int minY, int maxX, int maxY, Func<(int X, int Y), bool> blocked) {
            var seen = new HashSet<(int X, int Y)>();
            var stack = new Stack<(int X, int Y)>();
            void Push(int x, int y) {
                if (x < minX || x > maxX || y < minY || y > maxY) return;
                if (blocked((x, y)) || !seen.Add((x, y))) return;
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
    /// The variant is **normalized to the family's default** the way the source's spec tables
    /// do (`benchSpec`, `doorSpec`, `billboardSpec`, `glassModuleSpec`, `lineMapSpec`,
    /// `signMountSpec`, `shelfVariant`, `counterVariant`/`counterLength`): a legacy or
    /// hand-written record that stores no variant is the piece the palette would draw by
    /// default, so it must sweep with a current one. Comparing the raw text made two visually
    /// identical pieces refuse to join the same drag (plan 30 §2).
    /// </summary>
    public static class StationSweep {
        /// <summary>The reference's `SWEEP_STEP_PX`: one sample every 6 CSS pixels.</summary>
        public const float StepPixels = 6f;
        /// <summary>The reference's `SWEEP_MAX_SAMPLES`: a jump is sampled end to end, coarser.</summary>
        public const int MaxSamples = 24;

        static readonly HashSet<string> Sweepable = new HashSet<string>(StringComparer.Ordinal) {
            "ac-unit", "electrical-cabinet", "floor-mark", "gate", "tvm", "vending", "escalator", "walkway", "lift",
            "psd-end", "bench", "shelf", "desk", "checkout", "cubicle", "sink", "guidepost", "busstop", "bin",
            "extinguisher", "vent", "light", "clock", "cctv", "billboard", "glass", "door", "calligraphy",
            "linemap", "tv", "sign",
        };

        /// <summary>A family default for an absent/legacy variant (`X ?? DEFAULT` in the source).</summary>
        static string Default(string value, string fallback) => string.IsNullOrEmpty(value) ? fallback : value;

        // The variant tables' own key sets, for the families whose keys the port already
        // names: a value outside the table is the default piece in the source
        // (`SPECS[variant] ?? SPECS[DEFAULT]`), so the sweep identity must say so too.
        static readonly HashSet<string> BenchVariants = new HashSet<string>(StringComparer.Ordinal) {
            "wood-1", "wood-2", "office-1", "steel-1", "steel-2", "seat-1", "seat-2",
        };
        static readonly HashSet<string> DoorVariants = new HashSet<string>(StringComparer.Ordinal) {
            "steel-1", "steel-2", "wood-1", "wood-2", "glass-1", "glass-2",
        };
        static readonly HashSet<string> GlassVariants = new HashSet<string>(StringComparer.Ordinal) {
            "1x1", "2x1", "3x1", "1x2", "2x2", "3x2", "1x4", "2x4", "3x4", "4x4",
        };
        static readonly HashSet<string> BillboardVariants = new HashSet<string>(StringComparer.Ordinal) {
            "16x9-3m", "16x9-4m", "4x3-3m", "4x3-4m", "panorama", "portrait", "square", "standard", "large", "wide",
        };

        /// <summary>One spec table's answered variant: an unknown value reads as its default.</summary>
        static string Spec(string value, HashSet<string> variants, string fallback) =>
            !string.IsNullOrEmpty(value) && variants.Contains(value) ? value : fallback;

        /// <summary>`counterVariant`: an unknown counter is the plain checkout.</summary>
        static string CounterVariant(string value) {
            switch (value) {
                case "generic": case "cafe": case "cafe-pastry": return value;
                default: return "checkout";
            }
        }

        /// <summary>`counterLength`: only 1–4 cells are offered, anything else is one.</summary>

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
                // These three read the raw `cfg.variant` in the source, default or not.
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
                case "checkout": return "checkout:" + CounterVariant(cfg.Text("variant")) + ":" +
                    StationFootprints.CounterLength(module.Width).ToString(CultureInfo.InvariantCulture);
                // A catalogue shelf's own table is long and not restated here, so only the
                // absent/legacy value is normalized; a named variant stays exactly as it is.
                case "shelf": return "shelf:" + Default(cfg.Text("variant"), "dark-tall");
                case "bench": return "bench:" + Spec(cfg.Text("variant"), BenchVariants, "steel-1");
                case "billboard": return "billboard:" + Spec(cfg.Text("variant"), BillboardVariants, "wide");
                case "glass":
                    return "glass:" + Spec(cfg.Text("variant"), GlassVariants, "1x1") + ":" + cfg.Text("curtainHeight");
                case "door": return "door:" + Spec(cfg.Text("variant"), DoorVariants, "steel-1");
                case "calligraphy":
                    return "calligraphy:" + (cfg.Text("style").Length == 0 ? "kai" : cfg.Text("style")) +
                        ":" + (cfg.Text("axis").Length == 0 ? "h" : cfg.Text("axis")) +
                        ":" + (cfg.Bool("showEnglish") ? "1" : "0");
                // `lineMapSpec`/`signMountSpec` answer a mount the two-value sets can name.
                case "linemap": return "linemap:" + (cfg.Text("mount") == "stand" ? "stand" : "wall");
                case "sign": return "sign:" + (cfg.Text("mount") == "wall" ? "wall" : "ceiling");
                default: return module.Type;
            }
        }

        /// <summary>True when two pieces are the same sweep target.</summary>
        public static bool SameFamily(StationModuleRecord a, StationModuleRecord b) {
            var family = FamilyOf(a);
            return family != null && string.Equals(family, FamilyOf(b), StringComparison.Ordinal);
        }
    }

    /// <summary>
    /// `removeModule`'s dependent records (plan 30 §2): the piece itself plus what cannot
    /// stand without it. A 柱 owns its generated bridge piers (`cfg.bridgeId`) and every 站名
    /// hung on it (`cfg.pillarId`); removing the post takes them with it, exactly as the
    /// reference filters them out of the module list. Every other swept family — a bench, a
    /// gate, a sign, a board, a door, a panel — has no dependent record, so its teardown is
    /// the removal alone.
    ///
    /// This is the **document** answer, not a scene one: it reads the committed index and
    /// returns the stable ids the patch must remove. Callers fold the result into one patch so
    /// a whole sweep stays one revision and one undo frame.
    /// </summary>
    public static class StationModuleTeardown {
        public static IReadOnlyList<string> Expand(StationIndex index, IEnumerable<string> ids) {
            var removed = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            if (ids != null) {
                foreach (var id in ids) if (!string.IsNullOrEmpty(id) && seen.Add(id)) removed.Add(id);
            }
            if (index == null || removed.Count == 0) return removed;

            var queue = new Queue<string>(removed);
            var dependents = new List<string>();
            while (queue.Count > 0) {
                var target = queue.Dequeue();
                foreach (var refId in index.ReferrersOf(target)) {
                    if (seen.Contains(refId)) continue;
                    var module = index.GetModule(refId);
                    if (module == null) continue;
                    var cfg = module.Config;
                    bool dependent =
                        (string.Equals(module.Type, "pillar", StringComparison.Ordinal) &&
                            cfg.Text("bridgeId").Length > 0 && seen.Contains(cfg.Text("bridgeId"))) ||
                        (string.Equals(module.Type, "calligraphy", StringComparison.Ordinal) &&
                            cfg.Text("pillarId").Length > 0 && seen.Contains(cfg.Text("pillarId")));
                    if (!dependent) continue;
                    seen.Add(module.Id);
                    dependents.Add(module.Id);
                    queue.Enqueue(module.Id);
                }
            }
            if (dependents.Count > 1) {
                dependents.Sort((a, b) => {
                    index.TryGetModulePage(a, out _, out int pa);
                    index.TryGetModulePage(b, out _, out int pb);
                    int cmp = pa.CompareTo(pb);
                    if (cmp != 0) return cmp;
                    var span = index.Document.ModulePages.PageSpan(pa);
                    int ia = 0, ib = 0;
                    for (int i = 0; i < span.Length; i++) {
                        if (string.Equals(span[i].Id, a, StringComparison.Ordinal)) ia = i;
                        if (string.Equals(span[i].Id, b, StringComparison.Ordinal)) ib = i;
                    }
                    return ia.CompareTo(ib);
                });
            }
            for (int i = 0; i < dependents.Count; i++) removed.Add(dependents[i]);
            return removed;
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
            if (world.IsEquipmentBlocked(key)) {
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
            var anchored = new List<string>();
            world.CollectAnchoredModuleIds(removed, anchored);
            // A removed block takes what stood on it **and what cannot stand without it**
            // (plan 30 §2): a post's generated piers and the 站名 hung on it.
            foreach (var id in StationModuleTeardown.Expand(world.Index, anchored)) {
                if (!patch.RemoveModuleIds.Contains(id)) patch.RemoveModuleIds.Add(id);
            }
            if (droppedFloors.Count > 0)
                AppendAutoWallSync(world.WithoutModules(patch.RemoveModuleIds), patch, null, removed, droppedFloors);
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
        /// gesture touched, reusing per-level region-cluster exterior floods and reverse
        /// wall-column ownership for unedited overlapping floor ranges (Plan 32 §3.G).
        /// </summary>
        static void AppendAutoWallSync(StationCellEditWorld world, StationCellPatch patch,
            HashSet<StationCellKey> addedSolid, HashSet<StationCellKey> removedSolid, HashSet<int> levels) {
            using var syncTrace = StationEditTrace.Measure("StationCellPlanner.AutoWallSync");
            int height = world.StoreyHeight;
            if (levels == null || levels.Count == 0) return;

            var editsWallZs = new HashSet<int>();
            var readsFloorZs = new HashSet<int>();
            foreach (int floor in levels) {
                for (int dz = 1; dz <= height; dz++) editsWallZs.Add(floor + dz);
                for (int f = floor - height + 1; f <= floor + height - 1; f++) readsFloorZs.Add(f);
            }

            bool CoveredAt(int x, int y, int z) {
                var key = new StationCellKey(x, y, z);
                return world.IsTrackFootprint(key) ||
                       (addedSolid != null && addedSolid.Contains(key)) ||
                       ((removedSolid == null || !removedSolid.Contains(key)) && world.IsSolid(x, y, z));
            }

            bool IsCourseAllowed(StationCellKey course) {
                if (!editsWallZs.Contains(course.Z)) return false;
                if (world.IsOpening(course.X, course.Y, course.Z)) return false;
                if (world.IsEquipmentBlocked(course)) return false;
                if (world.IsTrackFootprint(course)) return false;
                if ((removedSolid == null || !removedSolid.Contains(course)) &&
                    world.IsTrackCell(course.X, course.Y, course.Z)) return false;
                return true;
            }

            var addedByFloor = new Dictionary<int, List<(int X, int Y)>>();
            if (addedSolid != null) {
                foreach (var key in addedSolid) {
                    if (!readsFloorZs.Contains(key.Z)) continue;
                    if (!addedByFloor.TryGetValue(key.Z, out var list)) addedByFloor[key.Z] = list = new List<(int, int)>();
                    list.Add((key.X, key.Y));
                }
            }

            var removedByFloor = new Dictionary<int, HashSet<(int X, int Y)>>();
            if (removedSolid != null) {
                foreach (var key in removedSolid) {
                    if (!readsFloorZs.Contains(key.Z)) continue;
                    if (!removedByFloor.TryGetValue(key.Z, out var set)) removedByFloor[key.Z] = set = new HashSet<(int, int)>();
                    set.Add((key.X, key.Y));
                }
            }

            var wanted = new HashSet<StationCellKey>();
            void EmitColumnFromFloor(int x, int y, int floor) {
                if (world.IsPlatformDoor(x, y, floor)) return;
                for (int dz = 1; dz <= height; dz++) {
                    var course = new StationCellKey(x, y, floor + dz);
                    if (IsCourseAllowed(course)) wanted.Add(course);
                }
            }

            foreach (int floor in readsFloorZs) {
                addedByFloor.TryGetValue(floor, out var addedAtFloor);
                removedByFloor.TryGetValue(floor, out var removedAtFloor);
                bool hasEditedFloorCells = (addedAtFloor != null && addedAtFloor.Count > 0) ||
                                           (removedAtFloor != null && removedAtFloor.Count > 0);

                if (!hasEditedFloorCells) {
                    // Unedited overlapping floor level: reuse cached exterior edges directly with zero flood!
                    var cached = world.GetOrBuildFloorLevel(floor);
                    if (cached == null) continue;
                    foreach (var (x, y) in cached.AllOuterEdgeCells) {
                        EmitColumnFromFloor(x, y, floor);
                    }
                    continue;
                }

                world.TryGetAutoFloorsAt(floor, out var baseAutoFloors);
                if ((baseAutoFloors == null || baseAutoFloors.Count == 0) &&
                    (addedAtFloor == null || addedAtFloor.Count == 0)) {
                    continue;
                }

                EvaluateEditedFloorLevel(world, floor, baseAutoFloors, addedAtFloor, removedAtFloor, CoveredAt, EmitColumnFromFloor);
            }

            foreach (int wallZ in editsWallZs) {
                if (!world.TryGetAutoWallsAt(wallZ, out var wallsAtZ)) continue;
                foreach (var (wx, wy) in wallsAtZ) {
                    var key = new StationCellKey(wx, wy, wallZ);
                    if (wanted.Contains(key) || (removedSolid != null && removedSolid.Contains(key))) continue;
                    patch.Add(StationCellWrite.Drop(key));
                }
            }

            HashSet<StationCellKey> gradeHoles = null;
            if (removedSolid != null) {
                for (int i = 0; i < patch.Writes.Count; i++) {
                    var write = patch.Writes[i];
                    if (write.Mode == StationCellWriteMode.Set && write.Void) {
                        gradeHoles ??= new HashSet<StationCellKey>();
                        gradeHoles.Add(write.Key);
                    }
                }
            }
            foreach (var key in wanted) {
                if (CoveredAt(key.X, key.Y, key.Z) || (gradeHoles != null && gradeHoles.Contains(key))) continue;
                if ((removedSolid == null || !removedSolid.Contains(key)) && world.Index.GetCell(key.X, key.Y, key.Z) != null) continue;
                patch.Add(StationCellWrite.Set(key, false, AutoWallTag));
            }
        }

        static void EvaluateEditedFloorLevel(
            StationCellEditWorld world,
            int level,
            HashSet<(int X, int Y)> baseAutoFloors,
            List<(int X, int Y)> addedAtFloor,
            HashSet<(int X, int Y)> removedAtFloor,
            Func<int, int, int, bool> coveredAt,
            Action<int, int, int> emitColumn) {
            var cached = (addedAtFloor == null || addedAtFloor.Count == 0) ? world.GetOrBuildFloorLevel(level) : world.GetOrBuildFloorLevel(level);

            // Compute effective auto-floor bounding box at `level`
            int minX = int.MaxValue, minY = int.MaxValue, maxX = int.MinValue, maxY = int.MinValue;
            int count = 0;
            if (baseAutoFloors != null) {
                foreach (var xy in baseAutoFloors) {
                    if (removedAtFloor != null && removedAtFloor.Contains(xy)) continue;
                    if (xy.X < minX) minX = xy.X;
                    if (xy.Y < minY) minY = xy.Y;
                    if (xy.X > maxX) maxX = xy.X;
                    if (xy.Y > maxY) maxY = xy.Y;
                    count++;
                }
            }
            if (addedAtFloor != null) {
                for (int i = 0; i < addedAtFloor.Count; i++) {
                    var xy = addedAtFloor[i];
                    if (xy.X < minX) minX = xy.X;
                    if (xy.Y < minY) minY = xy.Y;
                    if (xy.X > maxX) maxX = xy.X;
                    if (xy.Y > maxY) maxY = xy.Y;
                    count++;
                }
            }
            if (count == 0) return;
            int gMinX = minX - 1, gMinY = minY - 1, gMaxX = maxX + 1, gMaxY = maxY + 1;

            bool IsEffectiveAutoFloor((int X, int Y) xy) {
                if (removedAtFloor != null && removedAtFloor.Contains(xy)) return false;
                if (baseAutoFloors != null && baseAutoFloors.Contains(xy)) return true;
                if (addedAtFloor != null) {
                    for (int i = 0; i < addedAtFloor.Count; i++) if (addedAtFloor[i] == xy) return true;
                }
                return false;
            }

            // Fast path 1: Cached clusters exist and global auto-floor bbox is unchanged!
            if (cached != null &&
                gMinX == cached.GlobalMinX && gMinY == cached.GlobalMinY &&
                gMaxX == cached.GlobalMaxX && gMaxY == cached.GlobalMaxY) {

                // Sub-case 1a: Pure interior hole removal (no cell touches Outside -> 0 floods!)
                if ((addedAtFloor == null || addedAtFloor.Count == 0) && removedAtFloor != null && removedAtFloor.Count > 0) {
                    StationCellEditWorld.RegionCluster single = null;
                    bool interiorOnly = true;
                    foreach (var p in removedAtFloor) {
                        if (coveredAt(p.X, p.Y, level)) { interiorOnly = false; break; }
                        StationCellEditWorld.RegionCluster hit = null;
                        for (int c = 0; c < cached.Clusters.Count; c++) {
                            var cl = cached.Clusters[c];
                            if (p.X > cl.MinX && p.X < cl.MaxX && p.Y > cl.MinY && p.Y < cl.MaxY) {
                                hit = cl;
                                break;
                            }
                        }
                        if (hit == null || (single != null && !ReferenceEquals(single, hit))) {
                            interiorOnly = false;
                            break;
                        }
                        single = hit;
                        if (hit.Outside.Contains(p) ||
                            hit.Outside.Contains((p.X + 1, p.Y)) || hit.Outside.Contains((p.X - 1, p.Y)) ||
                            hit.Outside.Contains((p.X, p.Y + 1)) || hit.Outside.Contains((p.X, p.Y - 1))) {
                            interiorOnly = false;
                            break;
                        }
                    }
                    if (interiorOnly) {
                        foreach (var xy in cached.AllOuterEdgeCells) {
                            if (!removedAtFloor.Contains(xy)) emitColumn(xy.X, xy.Y, level);
                        }
                        return;
                    }
                }

                // Sub-case 1b: Cluster-local flood! Merge dirty padded bbox with any overlapping
                // clusters; keep disjoint clusters 100% cached, and flood only the affected box
                // (expanding if a newly added cell bridges a hand-built solid component).
                int dMinX = int.MaxValue, dMinY = int.MaxValue, dMaxX = int.MinValue, dMaxY = int.MinValue;
                if (addedAtFloor != null) {
                    for (int i = 0; i < addedAtFloor.Count; i++) {
                        var p = addedAtFloor[i];
                        if (p.X < dMinX) dMinX = p.X;
                        if (p.Y < dMinY) dMinY = p.Y;
                        if (p.X > dMaxX) dMaxX = p.X;
                        if (p.Y > dMaxY) dMaxY = p.Y;
                    }
                }
                if (removedAtFloor != null) {
                    foreach (var p in removedAtFloor) {
                        if (p.X < dMinX) dMinX = p.X;
                        if (p.Y < dMinY) dMinY = p.Y;
                        if (p.X > dMaxX) dMaxX = p.X;
                        if (p.Y > dMaxY) dMaxY = p.Y;
                    }
                }
                int aMinX = Math.Max(gMinX, dMinX - 1);
                int aMinY = Math.Max(gMinY, dMinY - 1);
                int aMaxX = Math.Min(gMaxX, dMaxX + 1);
                int aMaxY = Math.Min(gMaxY, dMaxY + 1);

                // Expand around any covered solids connected to added cells so hand-built bridges are included
                if (addedAtFloor != null && addedAtFloor.Count > 0) {
                    var seenCov = new HashSet<(int X, int Y)>();
                    var covStack = new Stack<(int X, int Y)>();
                    for (int i = 0; i < addedAtFloor.Count; i++) {
                        if (seenCov.Add(addedAtFloor[i])) covStack.Push(addedAtFloor[i]);
                    }
                    while (covStack.Count > 0) {
                        var (cx, cy) = covStack.Pop();
                        if (cx - 1 < aMinX) aMinX = Math.Max(gMinX, cx - 1);
                        if (cy - 1 < aMinY) aMinY = Math.Max(gMinY, cy - 1);
                        if (cx + 1 > aMaxX) aMaxX = Math.Min(gMaxX, cx + 1);
                        if (cy + 1 > aMaxY) aMaxY = Math.Min(gMaxY, cy + 1);
                        foreach (var (dx, dy) in Neighbours) {
                            int nx = cx + dx, ny = cy + dy;
                            if (nx < gMinX || nx > gMaxX || ny < gMinY || ny > gMaxY) continue;
                            if (coveredAt(nx, ny, level) && seenCov.Add((nx, ny))) covStack.Push((nx, ny));
                        }
                    }
                }

                var mergedIndices = new HashSet<int>();
                bool grewBox = true;
                while (grewBox) {
                    grewBox = false;
                    for (int c = 0; c < cached.Clusters.Count; c++) {
                        if (mergedIndices.Contains(c)) continue;
                        var cl = cached.Clusters[c];
                        if (aMaxX >= cl.MinX && cl.MaxX >= aMinX && aMaxY >= cl.MinY && cl.MaxY >= aMinY) {
                            mergedIndices.Add(c);
                            if (cl.MinX < aMinX) { aMinX = cl.MinX; grewBox = true; }
                            if (cl.MinY < aMinY) { aMinY = cl.MinY; grewBox = true; }
                            if (cl.MaxX > aMaxX) { aMaxX = cl.MaxX; grewBox = true; }
                            if (cl.MaxY > aMaxY) { aMaxY = cl.MaxY; grewBox = true; }
                        }
                    }
                }

                // Verify the perimeter of `[aMinX..aMaxX] x [aMinY..aMaxY]` is unobstructed by non-cluster solids
                bool perimeterClear = true;
                for (int x = aMinX; x <= aMaxX && perimeterClear; x++) {
                    if ((aMinY > gMinY && coveredAt(x, aMinY, level)) || (aMaxY < gMaxY && coveredAt(x, aMaxY, level)))
                        perimeterClear = false;
                }
                for (int y = aMinY; y <= aMaxY && perimeterClear; y++) {
                    if ((aMinX > gMinX && coveredAt(aMinX, y, level)) || (aMaxX < gMaxX && coveredAt(aMaxX, y, level)))
                        perimeterClear = false;
                }

                if (perimeterClear) {
                    for (int c = 0; c < cached.Clusters.Count; c++) {
                        if (mergedIndices.Contains(c)) continue;
                        foreach (var xy in cached.Clusters[c].OuterEdgeCells) emitColumn(xy.X, xy.Y, level);
                    }
                    var localOutside = StationCellEditWorld.FloodBox(aMinX, aMinY, aMaxX, aMaxY,
                        xy => coveredAt(xy.X, xy.Y, level));
                    if (baseAutoFloors != null) {
                        foreach (var xy in baseAutoFloors) {
                            if (removedAtFloor != null && removedAtFloor.Contains(xy)) continue;
                            if (xy.X < aMinX || xy.X > aMaxX || xy.Y < aMinY || xy.Y > aMaxY) continue;
                            if (HasOutsideNeighbour(xy, localOutside)) emitColumn(xy.X, xy.Y, level);
                        }
                    }
                    if (addedAtFloor != null) {
                        for (int i = 0; i < addedAtFloor.Count; i++) {
                            var xy = addedAtFloor[i];
                            if (IsEffectiveAutoFloor(xy) && HasOutsideNeighbour(xy, localOutside)) emitColumn(xy.X, xy.Y, level);
                        }
                    }
                    return;
                }
            }

            // Full level fallback when the global auto-floor bounding box shifted or touched a non-cluster solid ring
            var fullOutside = StationCellEditWorld.FloodBox(gMinX, gMinY, gMaxX, gMaxY,
                xy => coveredAt(xy.X, xy.Y, level));
            if (baseAutoFloors != null) {
                foreach (var xy in baseAutoFloors) {
                    if (removedAtFloor != null && removedAtFloor.Contains(xy)) continue;
                    if (HasOutsideNeighbour(xy, fullOutside)) emitColumn(xy.X, xy.Y, level);
                }
            }
            if (addedAtFloor != null) {
                for (int i = 0; i < addedAtFloor.Count; i++) {
                    var xy = addedAtFloor[i];
                    if (baseAutoFloors != null && baseAutoFloors.Contains(xy)) continue;
                    if (removedAtFloor != null && removedAtFloor.Contains(xy)) continue;
                    if (HasOutsideNeighbour(xy, fullOutside)) emitColumn(xy.X, xy.Y, level);
                }
            }
        }

        static bool HasOutsideNeighbour((int X, int Y) xy, HashSet<(int X, int Y)> outside) =>
            outside.Contains((xy.X + 1, xy.Y)) || outside.Contains((xy.X - 1, xy.Y)) ||
            outside.Contains((xy.X, xy.Y + 1)) || outside.Contains((xy.X, xy.Y - 1));

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
