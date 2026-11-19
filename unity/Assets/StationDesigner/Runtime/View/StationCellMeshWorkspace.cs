using System;
using System.Collections.Generic;
using Metro.Build;
using UnityEngine;

namespace Metro.View {
    /// <summary>
    /// Retained incremental cell-mesh workspace (Plan 32 Work D).
    /// Keeps spatial cell/column/chunk state in O(1)-queryable structures so local edits
    /// remesh only dirty 16x16 storey/ground chunks with an exact +-2 XY and adjacent-storey
    /// halo, matching <see cref="StationCellMesher.Mesh"/> while supporting O(|delta|) rollback.
    /// </summary>
    public sealed class StationCellMeshWorkspace : IMeshCellSource {
        public readonly struct ChunkBandKey : IEquatable<ChunkBandKey> {
            public readonly int ChunkX, ChunkY, Storey;
            public readonly bool IsGround;

            public ChunkBandKey(int chunkX, int chunkY, int storey, bool isGround) {
                ChunkX = chunkX;
                ChunkY = chunkY;
                Storey = storey;
                IsGround = isGround;
            }

            public bool Equals(ChunkBandKey other) =>
                ChunkX == other.ChunkX && ChunkY == other.ChunkY && Storey == other.Storey && IsGround == other.IsGround;

            public override bool Equals(object obj) => obj is ChunkBandKey other && Equals(other);

            public override int GetHashCode() {
                unchecked {
                    int h = ChunkX * 73856093 ^ ChunkY * 19349663 ^ Storey * 83492791;
                    return IsGround ? ~h : h;
                }
            }

            public override string ToString() => IsGround
                ? $"{ChunkX},{ChunkY}|ground({Storey})"
                : $"{ChunkX},{ChunkY}|{Storey}";
        }

        public sealed class StagedChunkMesh {
            readonly Action rollback;
            bool settled;

            public readonly List<ChunkBandKey> DirtyKeys;
            public readonly Dictionary<ChunkBandKey, List<StationCellMeshGroup>> GroupsByChunk;
            public readonly HashSet<StationCellKey> GroundHolesSnapshot;
            public readonly bool HasGroundWindow;
            public readonly int GroundX0, GroundX1, GroundY0, GroundY1;
            public readonly int RebuiltChunkCount;

            internal StagedChunkMesh(
                List<ChunkBandKey> dirtyKeys,
                Dictionary<ChunkBandKey, List<StationCellMeshGroup>> groupsByChunk,
                HashSet<StationCellKey> groundHolesSnapshot,
                bool hasGroundWindow, int gx0, int gx1, int gy0, int gy1,
                int rebuiltChunkCount,
                Action rollback) {
                DirtyKeys = dirtyKeys;
                GroupsByChunk = groupsByChunk;
                GroundHolesSnapshot = groundHolesSnapshot;
                HasGroundWindow = hasGroundWindow;
                GroundX0 = gx0; GroundX1 = gx1; GroundY0 = gy0; GroundY1 = gy1;
                RebuiltChunkCount = rebuiltChunkCount;
                this.rollback = rollback;
            }

            public void Commit() => settled = true;

            public void Rollback() {
                if (settled) return;
                settled = true;
                rollback?.Invoke();
            }
        }

        sealed class AxisSpanCounter {
            readonly SortedDictionary<int, int> counts = new SortedDictionary<int, int>();
            int minValue;
            int maxValue;
            int total;

            public int Count => total;
            public int Min => minValue;
            public int Max => maxValue;

            public void Add(int v) {
                if (counts.TryGetValue(v, out int c)) {
                    counts[v] = c + 1;
                } else {
                    counts[v] = 1;
                    if (total == 0) {
                        minValue = maxValue = v;
                    } else {
                        if (v < minValue) minValue = v;
                        if (v > maxValue) maxValue = v;
                    }
                }
                total++;
            }

            public void Remove(int v) {
                if (!counts.TryGetValue(v, out int c)) return;
                total--;
                if (c > 1) {
                    counts[v] = c - 1;
                    return;
                }
                counts.Remove(v);
                if (total <= 0) {
                    total = 0;
                    minValue = maxValue = 0;
                    return;
                }
                if (v == minValue) {
                    foreach (var kv in counts) { minValue = kv.Key; break; }
                }
                if (v == maxValue) {
                    int last = minValue;
                    foreach (var kv in counts) last = kv.Key;
                    maxValue = last;
                }
            }
        }

        readonly Dictionary<StationCellKey, StationMeshCell> authoredCells = new Dictionary<StationCellKey, StationMeshCell>();
        readonly Dictionary<StationCellKey, StationCellShape> rawShapes = new Dictionary<StationCellKey, StationCellShape>();
        readonly HashSet<StationCellKey> voids = new HashSet<StationCellKey>();
        readonly HashSet<StationCellKey> groundHoles = new HashSet<StationCellKey>();
        readonly Dictionary<StationCellKey, StationSlopeCut> slopeCuts = new Dictionary<StationCellKey, StationSlopeCut>();
        readonly HashSet<StationCellKey> slopeFills = new HashSet<StationCellKey>();
        readonly Dictionary<StationCellKey, StationCellInset> insets = new Dictionary<StationCellKey, StationCellInset>();
        readonly HashSet<StationCellKey> hiddenCells = new HashSet<StationCellKey>();

        readonly Dictionary<long, List<int>> columnZs = new Dictionary<long, List<int>>();
        readonly Dictionary<(int cx, int cy), HashSet<StationCellKey>> chunkCells = new Dictionary<(int cx, int cy), HashSet<StationCellKey>>();
        readonly AxisSpanCounter xSpan = new AxisSpanCounter();
        readonly AxisSpanCounter ySpan = new AxisSpanCounter();

        StationRampOpenings.PreparedRampOpenings preparedRamps;
        int levelBase;
        int storeyHeight;
        bool virtualGround;
        int groundZ;
        int groundMargin;
        bool explicitGroundWindow;
        int explicitGx0, explicitGx1, explicitGy0, explicitGy1;
        bool buildCeilings;
        bool buildPlates;
        bool buildGround;
        bool omitSuspendedCeilings;
        bool isolateBandOcclusion;
        string defaultFinish;
        string rampSoffitFinish;

        // Per-batch scratch caches (reset before each MeshDirtyChunks / MeshAll pass).
        readonly List<MeshSession.Profile> sections = new List<MeshSession.Profile>(2);
        readonly MeshSession.Profile[] blockProfiles = new MeshSession.Profile[16];
        readonly List<string> finishIds = new List<string>();
        readonly Dictionary<string, int> finishIndex = new Dictionary<string, int>(StringComparer.Ordinal);
        readonly List<StationCellFaceRecord> batchFaces = new List<StationCellFaceRecord>();
        readonly Dictionary<MeshSession.FaceRecordKey, int> faceRecordIndex = new Dictionary<MeshSession.FaceRecordKey, int>();
        readonly Dictionary<StationCellKey, byte> suspendedCache = new Dictionary<StationCellKey, byte>();
        readonly Dictionary<StationCellKey, byte> masonryRoofCache = new Dictionary<StationCellKey, byte>();
        List<StationCellMeshGroup> activeGroupSink;

        List<MeshSession.Profile> IMeshCellSource.Sections => sections;
        MeshSession.Profile[] IMeshCellSource.BlockProfiles => blockProfiles;
        public HashSet<StationCellKey> GroundHoles => groundHoles;
        public StationRampOpenings.PreparedRampOpenings PreparedRamps => preparedRamps;

        readonly StationCellSurfacePolicy.CellLookup lookup;

        StationCellMeshWorkspace() {
            lookup = TryGetRawCell;
        }

        public static StationCellMeshWorkspace Create(
            StationCellMeshInput input,
            StationRampOpenings.PreparedRampOpenings ramps = null,
            Dictionary<StationCellKey, StationCellShape> unthinnedShapes = null) {
            if (input == null) throw new ArgumentNullException(nameof(input));
            var ws = new StationCellMeshWorkspace {
                preparedRamps = ramps,
                levelBase = input.LevelBase,
                storeyHeight = input.StoreyHeight,
                virtualGround = input.VirtualGround,
                groundZ = input.GroundZ,
                groundMargin = input.GroundMargin,
                explicitGroundWindow = input.HasGroundWindow,
                explicitGx0 = input.GroundX0,
                explicitGx1 = input.GroundX1,
                explicitGy0 = input.GroundY0,
                explicitGy1 = input.GroundY1,
                buildCeilings = input.BuildCeilings,
                buildPlates = input.BuildPlates,
                buildGround = input.BuildGround,
                omitSuspendedCeilings = input.OmitSuspendedCeilings,
                isolateBandOcclusion = input.IsolateBandOcclusion,
                defaultFinish = string.IsNullOrEmpty(input.DefaultFinish) ? StationFinishIds.DefaultMaterial : input.DefaultFinish,
                rampSoffitFinish = string.IsNullOrEmpty(input.RampSoffitFinish) ? "ceil.steel" : input.RampSoffitFinish,
            };
            ws.FinishIndex(ws.defaultFinish);

            if (input.Voids != null) {
                foreach (var v in input.Voids) ws.AddVoidInternal(v);
            }
            if (input.Cells != null) {
                for (int i = 0; i < input.Cells.Count; i++) {
                    var c = input.Cells[i];
                    if (!c.Solid) continue;
                    var rawShape = unthinnedShapes != null && unthinnedShapes.TryGetValue(c.Key, out var rs) ? rs : c.Shape;
                    ws.SetAuthoredCellInternal(c, rawShape);
                }
            }
            if (input.GroundHoles != null) foreach (var h in input.GroundHoles) ws.groundHoles.Add(h);
            if (input.SlopeCuts != null) foreach (var kv in input.SlopeCuts) ws.slopeCuts[kv.Key] = kv.Value;
            if (input.SlopeFills != null) foreach (var f in input.SlopeFills) ws.slopeFills.Add(f);
            if (input.Insets != null) foreach (var kv in input.Insets) ws.insets[kv.Key] = kv.Value;
            if (input.HiddenCells != null) foreach (var h in input.HiddenCells) ws.hiddenCells.Add(h);
            return ws;
        }

        public void GetGroundWindow(out bool hasWindow, out int x0, out int x1, out int y0, out int y1) {
            if (!virtualGround) {
                hasWindow = false;
                x0 = x1 = y0 = y1 = 0;
                return;
            }
            hasWindow = true;
            if (explicitGroundWindow) {
                x0 = explicitGx0; x1 = explicitGx1;
                y0 = explicitGy0; y1 = explicitGy1;
                return;
            }
            if (xSpan.Count == 0) {
                x0 = -groundMargin; x1 = groundMargin;
                y0 = -groundMargin; y1 = groundMargin;
                return;
            }
            x0 = xSpan.Min - groundMargin;
            x1 = xSpan.Max + groundMargin;
            y0 = ySpan.Min - groundMargin;
            y1 = ySpan.Max + groundMargin;
        }

        /* ----------------------------------------------------- full & chunk meshing */

        public Dictionary<ChunkBandKey, List<StationCellMeshGroup>> MeshAll() {
            var allKeys = CollectAllChunkKeys();
            return MeshChunkList(allKeys);
        }

        List<ChunkBandKey> CollectAllChunkKeys() {
            var set = new HashSet<ChunkBandKey>();
            foreach (var pair in chunkCells) {
                var cx = pair.Key.cx;
                var cy = pair.Key.cy;
                foreach (var key in pair.Value) {
                    if (hiddenCells.Contains(key) || IsGroundPassKey(key)) continue;
                    set.Add(new ChunkBandKey(cx, cy, StoreyBand(key.Z), false));
                }
            }
            if (buildGround && virtualGround) {
                GetGroundWindow(out bool hasWin, out int gx0, out int gx1, out int gy0, out int gy1);
                if (hasWin) {
                    int gBand = StoreyBand(groundZ);
                    int cx0 = FloorChunk(gx0), cx1 = FloorChunk(gx1);
                    int cy0 = FloorChunk(gy0), cy1 = FloorChunk(gy1);
                    for (int cx = cx0; cx <= cx1; cx += StationCellMesher.ChunkSize) {
                        for (int cy = cy0; cy <= cy1; cy += StationCellMesher.ChunkSize) {
                            set.Add(new ChunkBandKey(cx, cy, gBand, true));
                        }
                    }
                }
                foreach (var kv in authoredCells) {
                    if (kv.Key.Z == groundZ && (kv.Value.Flags & StationMeshCellFlags.PaintedGround) != 0) {
                        set.Add(new ChunkBandKey(FloorChunk(kv.Key.X), FloorChunk(kv.Key.Y), StoreyBand(groundZ), true));
                    }
                }
            }
            var list = new List<ChunkBandKey>(set);
            list.Sort(CompareChunkKeys);
            return list;
        }

        static int CompareChunkKeys(ChunkBandKey a, ChunkBandKey b) {
            if (a.IsGround != b.IsGround) return a.IsGround ? 1 : -1;
            if (a.Storey != b.Storey) return a.Storey.CompareTo(b.Storey);
            if (a.ChunkX != b.ChunkX) return a.ChunkX.CompareTo(b.ChunkX);
            return a.ChunkY.CompareTo(b.ChunkY);
        }

        Dictionary<ChunkBandKey, List<StationCellMeshGroup>> MeshChunkList(IReadOnlyList<ChunkBandKey> keys) {
            suspendedCache.Clear();
            masonryRoofCache.Clear();
            var output = new Dictionary<ChunkBandKey, List<StationCellMeshGroup>>(keys.Count);
            var groupBuffer = new List<StationCellMeshGroup>(8);

            for (int i = 0; i < keys.Count; i++) {
                var ck = keys[i];
                batchFaces.Clear();
                faceRecordIndex.Clear();
                groupBuffer.Clear();
                activeGroupSink = groupBuffer;

                if (ck.IsGround) {
                    if (buildGround && virtualGround) MeshSingleGroundChunk(ck.ChunkX, ck.ChunkY, ck.Storey);
                } else {
                    MeshSingleBandChunk(ck.ChunkX, ck.ChunkY, ck.Storey);
                }

                output[ck] = groupBuffer.Count > 0
                    ? new List<StationCellMeshGroup>(groupBuffer)
                    : new List<StationCellMeshGroup>(0);
            }
            activeGroupSink = null;
            return output;
        }

        void MeshSingleBandChunk(int cx, int cy, int band) {
            if (!chunkCells.TryGetValue((cx, cy), out var set) || set.Count == 0) return;
            var authoredInBand = new List<StationCellKey>();
            foreach (var key in set) {
                if (hiddenCells.Contains(key)) continue;
                if (IsGroundPassKey(key)) continue;
                if (StoreyBand(key.Z) != band) continue;
                authoredInBand.Add(key);
            }
            if (authoredInBand.Count == 0) return;
            authoredInBand.Sort(CompareCellKeys);

            var storeyCells = new List<StationCellKey>(authoredInBand.Count + 4);
            var ceilingCells = new List<StationCellKey>();
            var plateCells = buildPlates ? new List<StationCellKey>() : null;

            for (int i = 0; i < authoredInBand.Count; i++) {
                var key = authoredInBand[i];
                if (IsSuspended(key)) ceilingCells.Add(key);
                else storeyCells.Add(key);
                if (buildPlates && IsFloating(key)) plateCells.Add(key);

                var fill = new StationCellKey(key.X, key.Y, key.Z + 1);
                if (slopeFills.Contains(fill)) {
                    if (IsSuspended(fill)) ceilingCells.Add(fill);
                    else storeyCells.Add(fill);
                    if (buildPlates && IsFloating(fill)) plateCells.Add(fill);
                }
            }

            RunChunkPass(cx, cy, band, storeyCells, StationSurfaceRole.Cell);
            if (ceilingCells.Count > 0 && !omitSuspendedCeilings)
                RunChunkPass(cx, cy, band, ceilingCells, StationSurfaceRole.Ceiling);
            if (buildPlates && plateCells.Count > 0) {
                var plates = new List<StationCellKey>(plateCells.Count + 2);
                for (int i = 0; i < plateCells.Count; i++) {
                    var key = plateCells[i];
                    plates.Add(key);
                    if (!TryGetRawCell(key, out _)) continue;
                    var fill = new StationCellKey(key.X, key.Y, key.Z + 1);
                    if (slopeFills.Contains(fill)) plates.Add(fill);
                }
                RunChunkPass(cx, cy, band, plates, StationSurfaceRole.Plate);
            }
        }

        void MeshSingleGroundChunk(int cx, int cy, int band) {
            GetGroundWindow(out bool hasWin, out int gx0, out int gx1, out int gy0, out int gy1);
            var visits = new List<StationCellKey>(256);
            if (hasWin) {
                int xStart = Math.Max(cx, gx0), xEnd = Math.Min(cx + StationCellMesher.ChunkSize - 1, gx1);
                int yStart = Math.Max(cy, gy0), yEnd = Math.Min(cy + StationCellMesher.ChunkSize - 1, gy1);
                for (int x = xStart; x <= xEnd; x++) {
                    for (int y = yStart; y <= yEnd; y++) {
                        if (IsGeneratedGround(x, y)) visits.Add(new StationCellKey(x, y, groundZ));
                    }
                }
            }
            if (chunkCells.TryGetValue((cx, cy), out var set)) {
                foreach (var key in set) {
                    if (key.Z == groundZ && authoredCells.TryGetValue(key, out var c) &&
                        (c.Flags & StationMeshCellFlags.PaintedGround) != 0) {
                        visits.Add(key);
                    }
                }
            }
            if (visits.Count == 0) return;
            visits.Sort(CompareCellKeys);
            RunChunkPass(cx, cy, band, visits, StationSurfaceRole.Ground);
        }

        void RunChunkPass(int cx, int cy, int band, List<StationCellKey> visits, StationSurfaceRole role) {
            if (visits.Count == 0) return;
            var builder = new MeshSession.ChunkBuilder(this, cx, cy, band, role);
            for (int i = 0; i < visits.Count; i++) builder.Cell(visits[i]);
            builder.Flush();
        }

        static int CompareCellKeys(StationCellKey a, StationCellKey b) =>
            a.X != b.X ? a.X.CompareTo(b.X) : a.Y != b.Y ? a.Y.CompareTo(b.Y) : a.Z.CompareTo(b.Z);

        static int FloorChunk(int value) =>
            MeshSession.FloorDiv(value, StationCellMesher.ChunkSize) * StationCellMesher.ChunkSize;

        /* ------------------------------------------------ delta staging & rollback */

        public StagedChunkMesh StageDocumentDelta(
            StationDocument nextDoc,
            StationIndex nextIndex,
            StationIndexDelta delta,
            StationIndex prevIndex = null) {
            if (nextDoc == null) throw new ArgumentNullException(nameof(nextDoc));
            if (nextIndex == null) throw new ArgumentNullException(nameof(nextIndex));
            if (delta == null) throw new ArgumentNullException(nameof(delta));

            int prevLevelBase = levelBase;
            int prevStoreyHeight = storeyHeight;
            var prevRamps = preparedRamps;
            GetGroundWindow(out bool oldHasWin, out int oldGx0, out int oldGx1, out int oldGy0, out int oldGy1);

            var prevAuthored = new Dictionary<StationCellKey, (bool Existed, StationMeshCell Cell, StationCellShape RawShape)>();
            var prevVoids = new Dictionary<StationCellKey, bool>();
            Dictionary<StationCellKey, StationSlopeCut> prevSlopeCuts = null;
            HashSet<StationCellKey> prevSlopeFills = null;
            HashSet<StationCellKey> prevGroundHoles = null;
            Dictionary<StationCellKey, StationCellInset> prevInsets = null;

            void RecordCellUndo(StationCellKey key) {
                if (!prevAuthored.ContainsKey(key)) {
                    if (authoredCells.TryGetValue(key, out var existing)) {
                        rawShapes.TryGetValue(key, out var rs);
                        prevAuthored[key] = (true, existing, rs);
                    } else {
                        prevAuthored[key] = (false, default, default);
                    }
                }
                if (!prevVoids.ContainsKey(key)) prevVoids[key] = voids.Contains(key);
            }

            void RollbackImpl() {
                levelBase = prevLevelBase;
                storeyHeight = prevStoreyHeight;
                preparedRamps = prevRamps;
                foreach (var kv in prevAuthored) {
                    if (kv.Value.Existed) SetAuthoredCellInternal(kv.Value.Cell, kv.Value.RawShape);
                    else RemoveAuthoredCellInternal(kv.Key);
                }
                foreach (var kv in prevVoids) {
                    if (kv.Value) AddVoidInternal(kv.Key);
                    else RemoveVoidInternal(kv.Key);
                }
                if (prevSlopeCuts != null) {
                    slopeCuts.Clear();
                    foreach (var kv in prevSlopeCuts) slopeCuts[kv.Key] = kv.Value;
                }
                if (prevSlopeFills != null) {
                    slopeFills.Clear();
                    foreach (var k in prevSlopeFills) slopeFills.Add(k);
                }
                if (prevGroundHoles != null) {
                    groundHoles.Clear();
                    foreach (var k in prevGroundHoles) groundHoles.Add(k);
                }
                if (prevInsets != null) {
                    insets.Clear();
                    foreach (var kv in prevInsets) insets[kv.Key] = kv.Value;
                }
            }

            try {
                bool gridShifted = nextDoc.LevelBase != levelBase || nextDoc.StoreyHeight != storeyHeight;
                levelBase = nextDoc.LevelBase;
                storeyHeight = nextDoc.StoreyHeight;

                var dirtyCoords = new HashSet<StationCellKey>();
                var dirtyPlateColumns = buildPlates ? new HashSet<(int X, int Y)>() : null;
                var prevPlateMinBand = buildPlates ? new Dictionary<(int X, int Y), int>() : null;

                void NoteDirtyCoord(StationCellKey key) {
                    dirtyCoords.Add(key);
                    if (buildPlates && prevPlateMinBand.TryAdd((key.X, key.Y), MinBandInColumn(key.X, key.Y))) {
                        dirtyPlateColumns.Add((key.X, key.Y));
                    }
                }

                // Check whether any module change affects ground holes, slope cuts, ramp thinning, or PSD insets.
                bool rampOrHoleModuleChanged = false;
                bool psdModuleChanged = false;
                for (int i = 0; i < delta.RemovedModules.Count; i++) {
                    if (prevIndex != null) {
                        string t = prevIndex.GetModule(delta.RemovedModules[i])?.Type;
                        if (t == "track" || t == "exit" || t == "stair" || t == "escalator" || t == "walkway" || t == "lift")
                            rampOrHoleModuleChanged = true;
                        if (t == "platform-edge")
                            psdModuleChanged = true;
                    } else {
                        rampOrHoleModuleChanged = true;
                        psdModuleChanged = true;
                    }
                }
                for (int i = 0; i < delta.ChangedModules.Count; i++) {
                    string t = delta.ChangedModules[i].Type;
                    if (t == "track" || t == "exit" || t == "stair" || t == "escalator" || t == "walkway" || t == "lift")
                        rampOrHoleModuleChanged = true;
                    if (t == "platform-edge")
                        psdModuleChanged = true;
                }

                if (rampOrHoleModuleChanged) {
                    preparedRamps = StationRampOpenings.PrepareOpenings(nextIndex);
                }

                // 1. Apply cell removals and writes.
                for (int i = 0; i < delta.RemovedCells.Count; i++) {
                    var key = delta.RemovedCells[i];
                    NoteDirtyCoord(key);
                    RecordCellUndo(key);
                    RemoveAuthoredCellInternal(key);
                    RemoveVoidInternal(key);
                }

                for (int i = 0; i < delta.ChangedCells.Count; i++) {
                    var record = delta.ChangedCells[i];
                    var key = record.Key;
                    NoteDirtyCoord(key);
                    RecordCellUndo(key);
                    if (!record.IsSolid) {
                        RemoveAuthoredCellInternal(key);
                        AddVoidInternal(key);
                    } else {
                        RemoveVoidInternal(key);
                        var rawShape = StationCellRules.ShapeOf(record.Tags);
                        var meshCell = BuildMeshCell(record, rawShape, preparedRamps);
                        SetAuthoredCellInternal(meshCell, rawShape);
                    }
                }

                // 2. Update module-derived SlopeCuts, ThinCells, GroundHoles, Insets, or local SlopeFills.
                if (rampOrHoleModuleChanged) {
                    prevSlopeCuts = new Dictionary<StationCellKey, StationSlopeCut>(slopeCuts);
                    prevSlopeFills = new HashSet<StationCellKey>(slopeFills);
                    prevGroundHoles = new HashSet<StationCellKey>(groundHoles);

                    var structuralFacts = CollectStructuralFacts(nextIndex);
                    var nextCuts = StationRampOpenings.RampSlopeCuts(structuralFacts);
                    foreach (var kv in slopeCuts) {
                        if (!nextCuts.TryGetValue(kv.Key, out var nxt) || !SameSlopeCut(kv.Value, nxt)) NoteDirtyCoord(kv.Key);
                    }
                    foreach (var kv in nextCuts) {
                        if (!slopeCuts.TryGetValue(kv.Key, out var cur) || !SameSlopeCut(cur, kv.Value)) NoteDirtyCoord(kv.Key);
                    }
                    slopeCuts.Clear();
                    foreach (var kv in nextCuts) slopeCuts[kv.Key] = kv.Value;

                    // Recompute SlopeFills across nextCuts (bounded by number of slope cuts, ~50-300).
                    var nextFills = new HashSet<StationCellKey>();
                    foreach (var pair in slopeCuts) {
                        var cut = pair.Value;
                        if (cut == null || cut.OwnBody || cut.NoFill) continue;
                        var k = pair.Key;
                        if (authoredCells.ContainsKey(k)) continue;
                        if (!authoredCells.ContainsKey(new StationCellKey(k.X, k.Y, k.Z - 1))) continue;
                        nextFills.Add(k);
                    }
                    foreach (var oldFill in slopeFills) if (!nextFills.Contains(oldFill)) NoteDirtyCoord(oldFill);
                    foreach (var newFill in nextFills) if (!slopeFills.Contains(newFill)) NoteDirtyCoord(newFill);
                    slopeFills.Clear();
                    foreach (var f in nextFills) slopeFills.Add(f);

                    // Re-evaluate RampThinCells for Full-authored cells where thin state changed.
                    var toUpdateThin = new List<(StationMeshCell Cell, StationCellShape RawShape)>();
                    foreach (var kv in rawShapes) {
                        if (kv.Value.Kind != StationShapeKind.Full) continue;
                        if (!authoredCells.TryGetValue(kv.Key, out var cur)) continue;
                        var probe = cur;
                        probe.Shape = StationCellShape.Full;
                        var nextShape = preparedRamps != null && preparedRamps.TryComputeThinSide(probe, out var side)
                            ? StationCellShape.Half(side)
                            : StationCellShape.Full;
                        if (!cur.Shape.Equals(nextShape)) {
                            probe.Shape = nextShape;
                            toUpdateThin.Add((probe, kv.Value));
                        }
                    }
                    for (int i = 0; i < toUpdateThin.Count; i++) {
                        var item = toUpdateThin[i];
                        NoteDirtyCoord(item.Cell.Key);
                        RecordCellUndo(item.Cell.Key);
                        SetAuthoredCellInternal(item.Cell, item.RawShape);
                    }

                    // Recompute GroundHoles from tracks, exits, and ramps.
                    var nextHoles = ComputeGroundHoles(nextIndex, preparedRamps, groundZ);
                    foreach (var oldHole in groundHoles) if (!nextHoles.Contains(oldHole)) NoteDirtyCoord(oldHole);
                    foreach (var newHole in nextHoles) if (!groundHoles.Contains(newHole)) NoteDirtyCoord(newHole);
                    groundHoles.Clear();
                    foreach (var h in nextHoles) groundHoles.Add(h);
                } else {
                    // Pure cell delta: SlopeFills can only change at dirty cell `k` or `k + (0,0,1)`.
                    var fillCandidates = new List<StationCellKey>((delta.RemovedCells.Count + delta.ChangedCells.Count) * 2);
                    for (int i = 0; i < delta.RemovedCells.Count; i++) {
                        var k = delta.RemovedCells[i];
                        fillCandidates.Add(k);
                        fillCandidates.Add(new StationCellKey(k.X, k.Y, k.Z + 1));
                    }
                    for (int i = 0; i < delta.ChangedCells.Count; i++) {
                        var k = delta.ChangedCells[i].Key;
                        fillCandidates.Add(k);
                        fillCandidates.Add(new StationCellKey(k.X, k.Y, k.Z + 1));
                    }
                    for (int i = 0; i < fillCandidates.Count; i++) {
                        var fk = fillCandidates[i];
                        bool shouldFill = slopeCuts.TryGetValue(fk, out var cut) &&
                                          cut != null && !cut.OwnBody && !cut.NoFill &&
                                          !authoredCells.ContainsKey(fk) &&
                                          authoredCells.ContainsKey(new StationCellKey(fk.X, fk.Y, fk.Z - 1));
                        bool wasFilled = slopeFills.Contains(fk);
                        if (shouldFill != wasFilled) {
                            prevSlopeFills ??= new HashSet<StationCellKey>(slopeFills);
                            if (shouldFill) slopeFills.Add(fk);
                            else slopeFills.Remove(fk);
                            NoteDirtyCoord(fk);
                        }
                    }
                }

                if (psdModuleChanged) {
                    var nextInsets = StationPlatformInsets.For(nextIndex.ModulesOfType("platform-edge"));
                    bool anyDiff = nextInsets.Count != insets.Count;
                    if (!anyDiff) {
                        foreach (var kv in nextInsets) {
                            if (!insets.TryGetValue(kv.Key, out var cur) || !SameInset(cur, kv.Value)) { anyDiff = true; break; }
                        }
                    }
                    if (anyDiff) {
                        prevInsets = new Dictionary<StationCellKey, StationCellInset>(insets);
                        foreach (var kv in insets) if (!nextInsets.TryGetValue(kv.Key, out var nxt) || !SameInset(kv.Value, nxt)) NoteDirtyCoord(kv.Key);
                        foreach (var kv in nextInsets) if (!insets.TryGetValue(kv.Key, out var cur) || !SameInset(kv.Value, cur)) NoteDirtyCoord(kv.Key);
                        insets.Clear();
                        foreach (var kv in nextInsets) insets[kv.Key] = kv.Value;
                    }
                }

                GetGroundWindow(out bool newHasWin, out int newGx0, out int newGx1, out int newGy0, out int newGy1);

                // 3. Expand dirty coordinates into dirty ChunkBandKeys.
                List<ChunkBandKey> dirtyChunkKeys;
                if (gridShifted) {
                    dirtyChunkKeys = CollectAllChunkKeys();
                } else {
                    var dirtySet = new HashSet<ChunkBandKey>();
                    int step = Math.Max(1, storeyHeight);
                    foreach (var p in dirtyCoords) {
                        int b1 = StoreyBand(p.Z);
                        int rise = p.Z - b1;
                        // A boundary course can change a ceiling or a roof cap one band below,
                        // even when that upper course is hidden in the view.
                        bool affectsBelow = rise <= 1;
                        // Edits lower in a column can also change whether its top course
                        // occludes the next storey's bottom face.
                        bool affectsAbove = rise >= step - 2 ||
                                            (buildCeilings && HasAnyCell(p.X, p.Y, b1 + step - 1));
                        int b0 = affectsBelow ? StoreyBand(b1 - step) : b1;
                        int b2 = affectsAbove ? StoreyBand(b1 + step) : b1;
                        // Ground AO reads one course below grade and two above. A cell
                        // in that range can change ceiling class after a floor/clearance
                        // edit in its band or an edit one course above it.
                        int groundReadMin = buildCeilings ? StoreyBand(groundZ - 1) : groundZ - 1;
                        int groundReadMax = buildCeilings ? groundZ + 3 : groundZ + 2;
                        bool touchesGround = virtualGround && buildGround && p.Z >= groundReadMin && p.Z <= groundReadMax;
                        int gBand = StoreyBand(groundZ);

                        // Ceiling classification reads one horizontal neighbour, then that
                        // cell's visibility can expose faces one more cell out. A roof
                        // cap reads a one-cell halo and never changes neighbour occlusion.
                        int xyRadius = (buildCeilings && (rise >= 3 || rise == 0)) ? 2 : 1;
                        int cxMin = FloorChunk(p.X - xyRadius), cxMax = FloorChunk(p.X + xyRadius);
                        int cyMin = FloorChunk(p.Y - xyRadius), cyMax = FloorChunk(p.Y + xyRadius);
                        for (int cx = cxMin; cx <= cxMax; cx += StationCellMesher.ChunkSize) {
                            for (int cy = cyMin; cy <= cyMax; cy += StationCellMesher.ChunkSize) {
                                dirtySet.Add(new ChunkBandKey(cx, cy, b1, false));
                                if (b0 != b1) dirtySet.Add(new ChunkBandKey(cx, cy, b0, false));
                                if (b2 != b1 && b2 != b0) dirtySet.Add(new ChunkBandKey(cx, cy, b2, false));
                                if (touchesGround) dirtySet.Add(new ChunkBandKey(cx, cy, gBand, true));
                            }
                        }
                    }

                    if (buildPlates && dirtyPlateColumns != null) {
                        foreach (var col in dirtyPlateColumns) {
                            int oldMin = prevPlateMinBand[col];
                            int newMin = MinBandInColumn(col.X, col.Y);
                            if (oldMin == newMin) continue;
                            int cxMin = FloorChunk(col.X - 1), cxMax = FloorChunk(col.X + 1);
                            int cyMin = FloorChunk(col.Y - 1), cyMax = FloorChunk(col.Y + 1);
                            for (int cx = cxMin; cx <= cxMax; cx += StationCellMesher.ChunkSize) {
                                for (int cy = cyMin; cy <= cyMax; cy += StationCellMesher.ChunkSize) {
                                    if (oldMin != int.MaxValue) dirtySet.Add(new ChunkBandKey(cx, cy, oldMin, false));
                                    if (newMin != int.MaxValue) dirtySet.Add(new ChunkBandKey(cx, cy, newMin, false));
                                }
                            }
                        }
                    }

                    // Ground window perimeter diff when station XY bounds changed.
                    if (virtualGround && (oldHasWin != newHasWin || oldGx0 != newGx0 || oldGx1 != newGx1 || oldGy0 != newGy0 || oldGy1 != newGy1)) {
                        int gBand = StoreyBand(groundZ);
                        int gBelow = StoreyBand(groundZ - step);
                        int gAbove = StoreyBand(groundZ + step);
                        if (oldHasWin && newHasWin) {
                            int uX0 = Math.Min(oldGx0, newGx0) - 2, uX1 = Math.Max(oldGx1, newGx1) + 2;
                            int uY0 = Math.Min(oldGy0, newGy0) - 2, uY1 = Math.Max(oldGy1, newGy1) + 2;
                            int iX0 = Math.Max(oldGx0, newGx0) + 2, iX1 = Math.Min(oldGx1, newGx1) - 2;
                            int iY0 = Math.Max(oldGy0, newGy0) + 2, iY1 = Math.Min(oldGy1, newGy1) - 2;
                            int cx0 = FloorChunk(uX0), cx1 = FloorChunk(uX1);
                            int cy0 = FloorChunk(uY0), cy1 = FloorChunk(uY1);
                            for (int cx = cx0; cx <= cx1; cx += StationCellMesher.ChunkSize) {
                                for (int cy = cy0; cy <= cy1; cy += StationCellMesher.ChunkSize) {
                                    bool insideUnchanged = iX0 <= iX1 && iY0 <= iY1 &&
                                                           cx >= iX0 && cx + StationCellMesher.ChunkSize - 1 <= iX1 &&
                                                           cy >= iY0 && cy + StationCellMesher.ChunkSize - 1 <= iY1;
                                    if (insideUnchanged) continue;
                                    if (buildGround) dirtySet.Add(new ChunkBandKey(cx, cy, gBand, true));
                                    dirtySet.Add(new ChunkBandKey(cx, cy, gBand, false));
                                    if (gBelow != gBand) dirtySet.Add(new ChunkBandKey(cx, cy, gBelow, false));
                                    if (gAbove != gBand) dirtySet.Add(new ChunkBandKey(cx, cy, gAbove, false));
                                }
                            }
                        } else {
                            foreach (var ck in CollectAllChunkKeys()) dirtySet.Add(ck);
                        }
                    }

                    dirtyChunkKeys = new List<ChunkBandKey>(dirtySet);
                    dirtyChunkKeys.Sort(CompareChunkKeys);
                }

                var groupsByChunk = MeshChunkList(dirtyChunkKeys);
                var holesCopy = prevGroundHoles != null ? new HashSet<StationCellKey>(groundHoles) : null;
                return new StagedChunkMesh(
                    dirtyChunkKeys,
                    groupsByChunk,
                    holesCopy,
                    newHasWin, newGx0, newGx1, newGy0, newGy1,
                    dirtyChunkKeys.Count,
                    RollbackImpl);
            } catch {
                RollbackImpl();
                throw;
            }
        }

        public static StationMeshCell BuildMeshCell(
            StationCellRecord cell,
            StationCellShape rawShape,
            StationRampOpenings.PreparedRampOpenings ramps) {
            var tags = cell.Tags;
            var flags = StationMeshCellFlags.None;
            if (StationCellRules.IsWallBlock(tags)) flags |= StationMeshCellFlags.Wall;
            if (cell.HasTag("suspended-ceiling")) flags |= StationMeshCellFlags.SuspendedCeiling;
            if (cell.HasTag("opening-ceiling")) flags |= StationMeshCellFlags.OpeningCeiling;
            if (cell.HasTag("painted-ground")) flags |= StationMeshCellFlags.PaintedGround;
            var meshCell = new StationMeshCell {
                X = cell.X, Y = cell.Y, Z = cell.Z, Solid = true,
                Shape = rawShape,
                Flags = flags,
                Finish = StationFinishSet.FromRecord(cell),
            };
            if (rawShape.Kind == StationShapeKind.Full && ramps != null && ramps.TryComputeThinSide(meshCell, out var thinSide)) {
                meshCell.Shape = StationCellShape.Half(thinSide);
            }
            return meshCell;
        }

        static List<ModuleFacts> CollectStructuralFacts(StationIndex index) {
            var list = new List<ModuleFacts>();
            void AddType(string type) {
                var mods = index.ModulesOfType(type);
                for (int i = 0; i < mods.Count; i++) {
                    if (mods[i]?.Facts != null) list.Add(mods[i].Facts);
                }
            }
            AddType("exit");
            AddType("stair");
            AddType("escalator");
            AddType("walkway");
            AddType("lift");
            return list;
        }

        public static HashSet<StationCellKey> ComputeGroundHoles(
            StationIndex index,
            StationRampOpenings.PreparedRampOpenings ramps,
            int groundLevel) {
            var holes = new HashSet<StationCellKey>();
            var tracks = index.ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var module = tracks[i];
                if (module.Z == groundLevel && !module.Config.Bool("tunnel") && !module.Config.Bool("bridge")) {
                    foreach (var pt in StationFootprints.TrackCells(module)) {
                        holes.Add(new StationCellKey(
                            (int)Math.Round(pt.X, MidpointRounding.AwayFromZero),
                            (int)Math.Round(pt.Y, MidpointRounding.AwayFromZero),
                            groundLevel));
                    }
                }
            }
            var exits = index.ModulesOfType("exit");
            for (int i = 0; i < exits.Count; i++) {
                var module = exits[i];
                if (module.Z == groundLevel) {
                    foreach (var pt in StationFootprints.ExitFootprint(module)) {
                        holes.Add(new StationCellKey(
                            (int)Math.Round(pt.X, MidpointRounding.AwayFromZero),
                            (int)Math.Round(pt.Y, MidpointRounding.AwayFromZero),
                            groundLevel));
                    }
                }
            }
            if (ramps != null) {
                foreach (var hole in ramps.AtLevel(groundLevel)) holes.Add(hole);
            }
            return holes;
        }

        static bool SameInset(StationCellInset a, StationCellInset b) =>
            a.X0 == b.X0 && a.X1 == b.X1 && a.Y0 == b.Y0 && a.Y1 == b.Y1;

        static bool SameSlopeCut(StationSlopeCut a, StationSlopeCut b) {
            if (ReferenceEquals(a, b)) return true;
            if (a == null || b == null) return false;
            if (a.Axis != b.Axis || a.Lo != b.Lo || a.Hi != b.Hi ||
                a.HasBase != b.HasBase || a.Base != b.Base ||
                a.HasHalf != b.HasHalf || a.Half != b.Half ||
                a.NoFill != b.NoFill || a.OwnBody != b.OwnBody ||
                !string.Equals(a.Finish, b.Finish, StringComparison.Ordinal)) return false;
            var pa = a.PatchList;
            var pb = b.PatchList;
            if (pa.Count != pb.Count) return false;
            for (int i = 0; i < pa.Count; i++) {
                var x = pa[i];
                var y = pb[i];
                if (x.Axis != y.Axis || x.Lo != y.Lo || x.Hi != y.Hi ||
                    x.HasBase != y.HasBase || x.Base != y.Base ||
                    x.X0 != y.X0 || x.X1 != y.X1 || x.Y0 != y.Y0 || x.Y1 != y.Y1) return false;
            }
            return true;
        }

        /* ------------------------------------------------- internal state mutation */

        void SetAuthoredCellInternal(StationMeshCell cell, StationCellShape rawShape) {
            var key = cell.Key;
            bool existed = authoredCells.ContainsKey(key);
            authoredCells[key] = cell;
            rawShapes[key] = rawShape;
            if (!existed) {
                if (!voids.Contains(key)) {
                    xSpan.Add(key.X);
                    ySpan.Add(key.Y);
                }
                long col = PackColumn(key.X, key.Y);
                if (!columnZs.TryGetValue(col, out var zs)) {
                    columnZs[col] = zs = new List<int>(4) { key.Z };
                } else {
                    int idx = zs.BinarySearch(key.Z);
                    if (idx < 0) zs.Insert(~idx, key.Z);
                }
                var ck = (FloorChunk(key.X), FloorChunk(key.Y));
                if (!chunkCells.TryGetValue(ck, out var set)) chunkCells[ck] = set = new HashSet<StationCellKey>();
                set.Add(key);
            }
        }

        void RemoveAuthoredCellInternal(StationCellKey key) {
            if (!authoredCells.Remove(key)) return;
            rawShapes.Remove(key);
            if (!voids.Contains(key)) {
                xSpan.Remove(key.X);
                ySpan.Remove(key.Y);
            }
            long col = PackColumn(key.X, key.Y);
            if (columnZs.TryGetValue(col, out var zs)) {
                int idx = zs.BinarySearch(key.Z);
                if (idx >= 0) zs.RemoveAt(idx);
                if (zs.Count == 0) columnZs.Remove(col);
            }
            var ck = (FloorChunk(key.X), FloorChunk(key.Y));
            if (chunkCells.TryGetValue(ck, out var set)) {
                set.Remove(key);
                if (set.Count == 0) chunkCells.Remove(ck);
            }
        }

        void AddVoidInternal(StationCellKey key) {
            if (!voids.Add(key)) return;
            if (!authoredCells.ContainsKey(key)) {
                xSpan.Add(key.X);
                ySpan.Add(key.Y);
            }
        }

        void RemoveVoidInternal(StationCellKey key) {
            if (!voids.Remove(key)) return;
            if (!authoredCells.ContainsKey(key)) {
                xSpan.Remove(key.X);
                ySpan.Remove(key.Y);
            }
        }

        static long PackColumn(int x, int y) => ((long)x << 32) | (uint)y;

        /* ----------------------------------------------- IMeshCellSource queries */

        int StoreyBand(int z) => StationCoordinates.StoreyBand(z, levelBase);

        bool IsGeneratedGround(int x, int y) {
            if (!virtualGround) return false;
            GetGroundWindow(out bool hasWin, out int gx0, out int gx1, out int gy0, out int gy1);
            if (!hasWin || x < gx0 || x > gx1 || y < gy0 || y > gy1) return false;
            var key = new StationCellKey(x, y, groundZ);
            return !authoredCells.ContainsKey(key) && !voids.Contains(key) && !groundHoles.Contains(key);
        }

        bool IsGroundPassKey(StationCellKey key) {
            if (!virtualGround || key.Z != groundZ) return false;
            if (IsGeneratedGround(key.X, key.Y)) return true;
            return authoredCells.TryGetValue(key, out var c) && (c.Flags & StationMeshCellFlags.PaintedGround) != 0;
        }

        bool HasAnyCell(int x, int y, int z) =>
            authoredCells.ContainsKey(new StationCellKey(x, y, z)) || (z == groundZ && IsGeneratedGround(x, y));

        bool TryGetRawCell(StationCellKey key, out StationMeshCell cell) {
            if (authoredCells.TryGetValue(key, out cell)) return true;
            if (key.Z == groundZ && IsGeneratedGround(key.X, key.Y)) {
                cell = new StationMeshCell {
                    X = key.X, Y = key.Y, Z = groundZ, Solid = true,
                    Shape = StationCellShape.Full, Flags = StationMeshCellFlags.None,
                };
                return true;
            }
            cell = default;
            return false;
        }

        int MinBandInColumn(int x, int y) {
            int best = int.MaxValue;
            if (columnZs.TryGetValue(PackColumn(x, y), out var zs) && zs.Count > 0) {
                int b = StoreyBand(zs[0]);
                if (b < best) best = b;
            }
            if (IsGeneratedGround(x, y)) {
                int gb = StoreyBand(groundZ);
                if (gb < best) best = gb;
            }
            return best;
        }

        bool IsFloating(StationCellKey key) {
            if (!HasAnyCell(key.X, key.Y, key.Z)) return false;
            if (IsSuspended(key)) return false;
            if (authoredCells.TryGetValue(key, out var c) && (c.Flags & StationMeshCellFlags.OpeningCeiling) != 0) return false;
            return StoreyBand(key.Z) == MinBandInColumn(key.X, key.Y);
        }

        public bool IsSuspended(StationCellKey key) {
            if (suspendedCache.TryGetValue(key, out byte cached)) return cached != 0;
            bool ans = ComputeIsSuspended(key);
            suspendedCache[key] = ans ? (byte)1 : (byte)0;
            return ans;
        }

        bool ComputeIsSuspended(StationCellKey key) =>
            TryGetRawCell(key, out var cell) &&
            StationCellSurfacePolicy.IsCeiling(cell, StoreyBand(key.Z), storeyHeight, buildCeilings, lookup);

        public bool IsMasonryRoof(StationCellKey key) {
            if (masonryRoofCache.TryGetValue(key, out byte cached)) return cached != 0;
            bool roof = !IsGroundPassKey(key) && authoredCells.TryGetValue(key, out var cell) &&
                StationCellSurfacePolicy.IsMasonryRoof(cell, StoreyBand(key.Z), storeyHeight, groundZ, lookup);
            masonryRoofCache[key] = roof ? (byte)1 : (byte)0;
            return roof;
        }

        public bool IsWallCell(StationCellKey key) =>
            authoredCells.TryGetValue(key, out var c) && (c.Flags & StationMeshCellFlags.Wall) != 0;

        public bool IsHidden(StationCellKey key) => hiddenCells.Contains(key);
        public bool IsFilled(StationCellKey key) => slopeFills.Contains(key);
        public bool HasSlope(StationCellKey key) => slopeCuts.ContainsKey(key);
        public StationSlopeCut CutAt(StationCellKey key) => slopeCuts.TryGetValue(key, out var cut) ? cut : null;

        public StationCellShape ShapeAt(StationCellKey key) =>
            authoredCells.TryGetValue(key, out var c) ? c.Shape : StationCellShape.Full;

        public StationCellInset InsetAt(StationCellKey key) =>
            insets.TryGetValue(key, out var inset) ? inset : StationCellInset.Full;

        public bool IsBandSolid(StationCellKey key, int band) =>
            isolateBandOcclusion ? IsBandEmitted(key, band) : HasAnyCell(key.X, key.Y, key.Z);

        public bool IsPassSolid(StationCellKey key, int band, StationSurfaceRole passRole) {
            if (passRole == StationSurfaceRole.Ground) return HasAnyCell(key.X, key.Y, key.Z);
            if (passRole == StationSurfaceRole.Plate) return IsFloating(key);
            return IsBandSolid(key, band);
        }

        public bool IsEmitted(StationCellKey key, int band, StationSurfaceRole passRole) =>
            passRole == StationSurfaceRole.Ground ? IsGroundPassKey(key) : IsBandEmitted(key, band);

        bool IsBandEmitted(StationCellKey key, int band) {
            if (authoredCells.TryGetValue(key, out var c) && c.Solid && !hiddenCells.Contains(key) &&
                !IsGroundPassKey(key) && StoreyBand(key.Z) == band) return true;
            if (slopeFills.Contains(key)) {
                var below = new StationCellKey(key.X, key.Y, key.Z - 1);
                if (authoredCells.TryGetValue(below, out var bc) && bc.Solid && !hiddenCells.Contains(below) &&
                    !IsGroundPassKey(below) && StoreyBand(below.Z) == band) return true;
            }
            return false;
        }

        int FinishIndex(string id) {
            if (string.IsNullOrEmpty(id)) id = defaultFinish;
            if (finishIndex.TryGetValue(id, out int idx)) return idx;
            idx = finishIds.Count;
            finishIds.Add(id);
            finishIndex[id] = idx;
            return idx;
        }

        public string FinishId(int index) => index >= 0 && index < finishIds.Count ? finishIds[index] : defaultFinish;

        public int FaceRecord(int x, int y, int z, StationFace face, int finishIdx, StationSurfaceRole role, bool slope) {
            var key = new MeshSession.FaceRecordKey(x, y, z, face, finishIdx, role, slope);
            if (faceRecordIndex.TryGetValue(key, out int idx)) return idx;
            idx = batchFaces.Count;
            batchFaces.Add(new StationCellFaceRecord(x, y, z, face, FinishId(finishIdx), role, slope));
            faceRecordIndex[key] = idx;
            return idx;
        }

        public StationCellFaceRecord GetFaceRecord(int index) =>
            index >= 0 && index < batchFaces.Count ? batchFaces[index] : default;

        public void FinishIndexes(StationCellKey key, StationSlopeCut cut, out int top, out int bottom,
            out int e, out int w, out int n, out int s, out bool filled) {
            filled = slopeFills.Contains(key);
            StationFinishSet fin = authoredCells.TryGetValue(key, out var own) ? own.Finish : default;
            if (!fin.Any && filled) {
                var below = new StationCellKey(key.X, key.Y, key.Z - 1);
                if (authoredCells.TryGetValue(below, out var belowCell)) fin = belowCell.Finish;
            }
            bool truss = filled && cut != null && cut.HasHalf;
            int soffit = truss ? FinishIndex(rampSoffitFinish) : -1;
            top = soffit >= 0 ? soffit : FinishIndex(fin.Top ?? (cut?.Finish ?? defaultFinish));
            bottom = soffit >= 0 ? soffit : FinishIndex(fin.Bottom ?? defaultFinish);
            e = truss ? soffit : FinishIndex(fin.E ?? defaultFinish);
            w = truss ? soffit : FinishIndex(fin.W ?? defaultFinish);
            n = truss ? soffit : FinishIndex(fin.N ?? defaultFinish);
            s = truss ? soffit : FinishIndex(fin.S ?? defaultFinish);
        }

        public void NoteCellDrawn() { }

        public void EmitGroup(StationCellMeshGroup group) => activeGroupSink?.Add(group);
    }
}
