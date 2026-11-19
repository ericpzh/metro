using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

namespace Metro.Build {
    /// <summary>
    /// An inclusive plan/elevation box in document axes, from the content's own
    /// cells and modules (never an authored layout).
    /// </summary>
    public readonly struct StationBounds {
        public StationBounds(int minX, int minY, int minZ, int maxX, int maxY, int maxZ) {
            MinX = minX; MinY = minY; MinZ = minZ; MaxX = maxX; MaxY = maxY; MaxZ = maxZ;
        }
        public int MinX { get; }
        public int MinY { get; }
        public int MinZ { get; }
        public int MaxX { get; }
        public int MaxY { get; }
        public int MaxZ { get; }
        public bool IsEmpty => MaxX < MinX || MaxY < MinY || MaxZ < MinZ;
        public int Width => MaxX - MinX + 1;
        public int Depth => MaxY - MinY + 1;
        public int Height => MaxZ - MinZ + 1;
        public override string ToString() =>
            IsEmpty ? "empty" : "(" + MinX + "," + MinY + "," + MinZ + ")‥(" + MaxX + "," + MaxY + "," + MaxZ + ")";
    }

    /// <summary>
    /// The records one local edit changed, added or removed, so <see cref="StationIndex"/>,
    /// the retained world view and the simulation graph can update themselves without
    /// scanning the whole station.
    /// </summary>
    public sealed class StationIndexDelta {
        public readonly List<StationCellKey> RemovedCells = new List<StationCellKey>();
        /// <summary>Every cell record the edit wrote or replaced, at its coordinate.</summary>
        public readonly List<StationCellRecord> ChangedCells = new List<StationCellRecord>();
        public readonly List<string> RemovedModules = new List<string>();
        /// <summary>Every module record the edit added or replaced, by its (unique) id.</summary>
        public readonly List<StationModuleRecord> ChangedModules = new List<StationModuleRecord>();

        public readonly Dictionary<StationCellKey, int> CellPageIds = new Dictionary<StationCellKey, int>();
        public readonly Dictionary<string, int> ModulePageIds = new Dictionary<string, int>(StringComparer.Ordinal);
    }

    /// <summary>
    /// Immutable sorted coordinate multiplicity table for O(1) bounds/levels queries and
    /// O(|delta|) updates without scanning records.
    /// </summary>
    internal sealed class SortedAxisCounter {
        public static readonly SortedAxisCounter Empty =
            new SortedAxisCounter(Array.Empty<int>(), Array.Empty<int>());

        readonly int[] values;
        readonly int[] counts;
        IReadOnlyList<int> readOnlyValues;

        SortedAxisCounter(int[] values, int[] counts) {
            this.values = values;
            this.counts = counts;
        }

        public bool IsEmpty => values.Length == 0;
        public int Min => values.Length > 0 ? values[0] : int.MaxValue;
        public int Max => values.Length > 0 ? values[values.Length - 1] : int.MinValue;
        public IReadOnlyList<int> Values => readOnlyValues ?? (readOnlyValues = new ReadOnlyCollection<int>(values));

        public static SortedAxisCounter Build(Dictionary<int, int> accumulator) {
            if (accumulator == null || accumulator.Count == 0) return Empty;
            var keys = new int[accumulator.Count];
            int idx = 0;
            foreach (var pair in accumulator) {
                if (pair.Value > 0) keys[idx++] = pair.Key;
            }
            if (idx == 0) return Empty;
            if (idx < keys.Length) Array.Resize(ref keys, idx);
            Array.Sort(keys);
            var vals = new int[keys.Length];
            for (int i = 0; i < keys.Length; i++) vals[i] = accumulator[keys[i]];
            return new SortedAxisCounter(keys, vals);
        }

        public SortedAxisCounter Apply(Dictionary<int, int> delta) {
            if (delta == null || delta.Count == 0) return this;
            var mergedKeys = new List<int>(values.Length + delta.Count);
            var mergedCounts = new List<int>(values.Length + delta.Count);

            var sortedDeltaKeys = new int[delta.Count];
            int dCount = 0;
            foreach (var pair in delta) {
                if (pair.Value != 0) sortedDeltaKeys[dCount++] = pair.Key;
            }
            if (dCount == 0) return this;
            if (dCount < sortedDeltaKeys.Length) Array.Resize(ref sortedDeltaKeys, dCount);
            Array.Sort(sortedDeltaKeys);

            int i = 0, j = 0;
            while (i < values.Length && j < dCount) {
                int a = values[i];
                int b = sortedDeltaKeys[j];
                if (a < b) {
                    mergedKeys.Add(a);
                    mergedCounts.Add(counts[i]);
                    i++;
                } else if (b < a) {
                    int c = delta[b];
                    if (c > 0) {
                        mergedKeys.Add(b);
                        mergedCounts.Add(c);
                    }
                    j++;
                } else {
                    int c = counts[i] + delta[b];
                    if (c > 0) {
                        mergedKeys.Add(a);
                        mergedCounts.Add(c);
                    }
                    i++;
                    j++;
                }
            }
            while (i < values.Length) {
                mergedKeys.Add(values[i]);
                mergedCounts.Add(counts[i]);
                i++;
            }
            while (j < dCount) {
                int b = sortedDeltaKeys[j++];
                int c = delta[b];
                if (c > 0) {
                    mergedKeys.Add(b);
                    mergedCounts.Add(c);
                }
            }
            if (mergedKeys.Count == 0) return Empty;
            return new SortedAxisCounter(mergedKeys.ToArray(), mergedCounts.ToArray());
        }
    }

    /// <summary>
    /// The read-only lookup layer over one <see cref="StationDocument"/>: cells by
    /// <c>(x,y,z)</c>, modules by <c>id</c>, lines and the station's levels.
    /// Backed by hash-sharded immutable bucket pages so incremental updates copy only
    /// touched shards with constant O(1) lookup depth and zero overlay chains.
    /// </summary>
    public sealed class StationIndex {
        const int CellShardCount = 512;
        const int CellShardMask = CellShardCount - 1;
        const int ModuleShardCount = 128;
        const int ModuleShardMask = ModuleShardCount - 1;

        static readonly StationModuleRecord[] NoModules = Array.Empty<StationModuleRecord>();
        static readonly IReadOnlyList<int> EmptyLevels = new ReadOnlyCollection<int>(Array.Empty<int>());
        static readonly string[] ReferenceKeys = {
            "bridgeId", "boothId", "edgeId", "exitId", "pillarId", "from", "support", "corner"
        };

        internal readonly struct CellSlot {
            public readonly StationCellRecord Record;
            public readonly int PageId;
            public CellSlot(StationCellRecord record, int pageId) { Record = record; PageId = pageId; }
        }

        internal readonly struct ModuleSlot {
            public readonly StationModuleRecord Record;
            public readonly int PageId;
            public ModuleSlot(StationModuleRecord record, int pageId) { Record = record; PageId = pageId; }
        }

        readonly Dictionary<StationCellKey, CellSlot>[] cellShards;
        readonly int cellCount;
        readonly HashSet<StationCellKey> duplicateCellKeys;
        readonly Dictionary<StationCellKey, StationCellRecord> duplicateLastSolid;
        readonly Dictionary<string, ModuleSlot>[] moduleShards;
        readonly int moduleCount;
        readonly Dictionary<string, StationModuleRecord[]> modulesByType;
        readonly Dictionary<string, StationModuleRecord[]> tracksByLine;
        readonly Dictionary<string, HashSet<string>> reverseReferences;
        readonly HashSet<(int X, int Y)> unsupportedBridgePillarColumns;
        readonly SortedAxisCounter axisX, axisY, axisZ, groundX, groundY;
        readonly List<StationDiagnostic> baseDiagnostics;
        readonly List<StationDiagnostic> diagnostics;
        readonly StationBounds bounds;

        public StationIndex(StationDocument document) : this(document, true) { }

        StationIndex(StationDocument document, bool strict) {
            using var trace = StationEditTrace.Measure("StationIndex.CreateFull");
            Document = document ?? throw new ArgumentNullException(nameof(document));
            StationEditTrace.AddScanned(document.CellCount + document.ModuleCount);

            cellShards = new Dictionary<StationCellKey, CellSlot>[CellShardCount];
            duplicateCellKeys = new HashSet<StationCellKey>();
            duplicateLastSolid = new Dictionary<StationCellKey, StationCellRecord>();
            baseDiagnostics = new List<StationDiagnostic>();

            var xAcc = new Dictionary<int, int>();
            var yAcc = new Dictionary<int, int>();
            var zAcc = new Dictionary<int, int>();
            var gxAcc = new Dictionary<int, int>();
            var gyAcc = new Dictionary<int, int>();

            var cellPages = document.CellPages;
            int indexedCells = 0;
            for (int p = 0; p < cellPages.PageCount; p++) {
                var page = cellPages.RawPage(p);
                for (int j = 0; j < page.Length; j++) {
                    var cell = page[j];
                    AddCount(xAcc, cell.X, 1);
                    AddCount(yAcc, cell.Y, 1);
                    AddCount(zAcc, cell.Z, 1);
                    AddCount(gxAcc, cell.X, 1);
                    AddCount(gyAcc, cell.Y, 1);

                    var key = cell.Key;
                    int shardIdx = CellShardOf(key);
                    var shard = cellShards[shardIdx];
                    if (shard != null && shard.TryGetValue(key, out var firstSlot)) {
                        duplicateCellKeys.Add(key);
                        if (!duplicateLastSolid.ContainsKey(key) && firstSlot.Record.IsSolid && !firstSlot.Record.HasTag("suspended-ceiling")) {
                            duplicateLastSolid[key] = firstSlot.Record;
                        }
                        if (cell.IsSolid && !cell.HasTag("suspended-ceiling")) {
                            duplicateLastSolid[key] = cell;
                        }
                        baseDiagnostics.Add(new StationDiagnostic("duplicate-cell", StationDiagnosticSeverity.Warning,
                            "cell", key.ToString(),
                            "Two saved cells share one coordinate; the first record was kept and the later one ignored."));
                        continue;
                    }
                    if (shard == null) cellShards[shardIdx] = shard = new Dictionary<StationCellKey, CellSlot>(8);
                    shard.Add(key, new CellSlot(cell, p));
                    indexedCells++;
                }
            }
            cellCount = indexedCells;

            moduleShards = new Dictionary<string, ModuleSlot>[ModuleShardCount];
            var byType = new Dictionary<string, List<StationModuleRecord>>(StringComparer.Ordinal);
            reverseReferences = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

            var modPages = document.ModulePages;
            int indexedModules = 0;
            for (int p = 0; p < modPages.PageCount; p++) {
                var page = modPages.RawPage(p);
                for (int j = 0; j < page.Length; j++) {
                    var module = page[j];
                    int shardIdx = ModuleShardOf(module.Id);
                    var shard = moduleShards[shardIdx];
                    if (shard != null && shard.ContainsKey(module.Id)) {
                        var refusal = new StationRejection("duplicate-id", StationRecordKind.Module, module.Type, module.Id,
                            "Two saved modules share one id; a module id must address exactly one record.");
                        if (strict) throw new StationRejectedException(refusal);
                        baseDiagnostics.Add(new StationDiagnostic(refusal.Code, StationDiagnosticSeverity.Error, refusal.RecordType, refusal.RecordId, refusal.Reason));
                        continue;
                    }
                    if (shard == null) moduleShards[shardIdx] = shard = new Dictionary<string, ModuleSlot>(8, StringComparer.Ordinal);
                    shard.Add(module.Id, new ModuleSlot(module, p));
                    indexedModules++;

                    if (!byType.TryGetValue(module.Type, out var list)) byType.Add(module.Type, list = new List<StationModuleRecord>());
                    list.Add(module);

                    AccumulateModuleCoords(module, xAcc, yAcc, zAcc, gxAcc, gyAcc, 1);
                    IndexModuleReferences(reverseReferences, module, add: true);
                }
            }
            moduleCount = indexedModules;

            modulesByType = new Dictionary<string, StationModuleRecord[]>(byType.Count, StringComparer.Ordinal);
            foreach (var pair in byType) modulesByType[pair.Key] = pair.Value.ToArray();

            var lines = document.Lines ?? Array.Empty<StationLineRecord>();
            var lineIds = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < lines.Count; i++) lineIds.Add(lines[i].Id);
            Lines = lines;

            tracksByLine = BuildTracksByLine(modulesByType);
            unsupportedBridgePillarColumns = ComputeUnsupportedBridgePillarColumns(modulesByType);

            axisX = SortedAxisCounter.Build(xAcc);
            axisY = SortedAxisCounter.Build(yAcc);
            axisZ = SortedAxisCounter.Build(zAcc);
            groundX = SortedAxisCounter.Build(gxAcc);
            groundY = SortedAxisCounter.Build(gyAcc);

            bounds = ComputeBounds(axisX, axisY, axisZ);
            Levels = axisZ.IsEmpty ? EmptyLevels : axisZ.Values;

            if (document.DroppedCells > 0)
                baseDiagnostics.Add(new StationDiagnostic("cells-dropped", StationDiagnosticSeverity.Warning, "cell", "",
                    document.DroppedCells + " off-grid cell(s) were dropped by the grid repair."));
            if (document.DroppedModules > 0)
                baseDiagnostics.Add(new StationDiagnostic("modules-dropped", StationDiagnosticSeverity.Warning, "module", "",
                    document.DroppedModules + " off-grid module(s) were dropped by the grid repair."));

            diagnostics = new List<StationDiagnostic>(baseDiagnostics);
            ValidateAllReferences(lineIds, diagnostics);
        }

        StationIndex(StationIndex previous, StationDocument document, StationIndexDelta delta) {
            using var trace = StationEditTrace.Measure("StationIndex.CreateIncremental");
            Document = document ?? throw new ArgumentNullException(nameof(document));
            if (delta == null) throw new ArgumentNullException(nameof(delta));

            duplicateCellKeys = previous.duplicateCellKeys;
            duplicateLastSolid = previous.duplicateLastSolid;
            baseDiagnostics = previous.baseDiagnostics;
            Lines = document.Lines ?? Array.Empty<StationLineRecord>();

            var xDelta = new Dictionary<int, int>();
            var yDelta = new Dictionary<int, int>();
            var zDelta = new Dictionary<int, int>();
            var gxDelta = new Dictionary<int, int>();
            var gyDelta = new Dictionary<int, int>();

            bool hasCellChanges = delta.RemovedCells.Count > 0 || delta.ChangedCells.Count > 0;
            if (!hasCellChanges) {
                cellShards = previous.cellShards;
                cellCount = previous.cellCount;
            } else {
                var nextCellShards = new Dictionary<StationCellKey, CellSlot>[CellShardCount];
                Array.Copy(previous.cellShards, nextCellShards, CellShardCount);
                var clonedCellShards = new HashSet<int>();
                int nextCells = previous.cellCount;

                Dictionary<StationCellKey, int> fallbackCellPages = null;

                for (int i = 0; i < delta.RemovedCells.Count; i++) {
                    var key = delta.RemovedCells[i];
                    int s = CellShardOf(key);
                    var shard = nextCellShards[s];
                    if (shard == null || !shard.TryGetValue(key, out _)) continue;
                    if (clonedCellShards.Add(s)) {
                        StationEditTrace.AddCloned(shard.Count);
                        shard = new Dictionary<StationCellKey, CellSlot>(shard);
                        nextCellShards[s] = shard;
                    }
                    shard.Remove(key);
                    nextCells--;
                    AddCount(xDelta, key.X, -1);
                    AddCount(yDelta, key.Y, -1);
                    AddCount(zDelta, key.Z, -1);
                    AddCount(gxDelta, key.X, -1);
                    AddCount(gyDelta, key.Y, -1);
                }

                for (int i = 0; i < delta.ChangedCells.Count; i++) {
                    var cell = delta.ChangedCells[i];
                    var key = cell.Key;
                    int pageId;
                    if (!delta.CellPageIds.TryGetValue(key, out pageId)) {
                        if (fallbackCellPages == null) fallbackCellPages = ScanCellPageIds(document.CellPages, delta.ChangedCells);
                        fallbackCellPages.TryGetValue(key, out pageId);
                    }
                    int s = CellShardOf(key);
                    var shard = nextCellShards[s];
                    bool existed = shard != null && shard.ContainsKey(key);
                    if (shard == null) {
                        shard = new Dictionary<StationCellKey, CellSlot>(4);
                        nextCellShards[s] = shard;
                        clonedCellShards.Add(s);
                    } else if (clonedCellShards.Add(s)) {
                        StationEditTrace.AddCloned(shard.Count);
                        shard = new Dictionary<StationCellKey, CellSlot>(shard);
                        nextCellShards[s] = shard;
                    }
                    shard[key] = new CellSlot(cell, pageId);
                    if (!existed) {
                        nextCells++;
                        AddCount(xDelta, cell.X, 1);
                        AddCount(yDelta, cell.Y, 1);
                        AddCount(zDelta, cell.Z, 1);
                        AddCount(gxDelta, cell.X, 1);
                        AddCount(gyDelta, cell.Y, 1);
                    }
                }
                cellShards = nextCellShards;
                cellCount = nextCells;
            }

            bool hasModuleChanges = delta.RemovedModules.Count > 0 || delta.ChangedModules.Count > 0;
            if (!hasModuleChanges) {
                moduleShards = previous.moduleShards;
                moduleCount = previous.moduleCount;
                modulesByType = previous.modulesByType;
                tracksByLine = previous.tracksByLine;
                reverseReferences = previous.reverseReferences;
                unsupportedBridgePillarColumns = previous.unsupportedBridgePillarColumns;
                diagnostics = previous.diagnostics;
            } else {
                var nextModShards = new Dictionary<string, ModuleSlot>[ModuleShardCount];
                Array.Copy(previous.moduleShards, nextModShards, ModuleShardCount);
                var clonedModShards = new HashSet<int>();
                int nextMods = previous.moduleCount;

                var nextRevRefs = new Dictionary<string, HashSet<string>>(previous.reverseReferences.Count, StringComparer.Ordinal);
                foreach (var pair in previous.reverseReferences) nextRevRefs[pair.Key] = pair.Value;
                var clonedRevTargets = new HashSet<string>(StringComparer.Ordinal);

                var dirtyTypes = new HashSet<string>(StringComparer.Ordinal);
                var removedSet = new HashSet<string>(StringComparer.Ordinal);
                var replacedById = new Dictionary<string, StationModuleRecord>(StringComparer.Ordinal);
                var addedInOrder = new List<StationModuleRecord>();
                bool orderNeedsSort = false;

                Dictionary<string, int> fallbackModPages = null;

                for (int i = 0; i < delta.RemovedModules.Count; i++) {
                    var id = delta.RemovedModules[i];
                    if (string.IsNullOrEmpty(id)) continue;
                    int s = ModuleShardOf(id);
                    var shard = nextModShards[s];
                    if (shard == null || !shard.TryGetValue(id, out var oldSlot)) continue;
                    if (clonedModShards.Add(s)) {
                        StationEditTrace.AddCloned(shard.Count);
                        shard = new Dictionary<string, ModuleSlot>(shard, StringComparer.Ordinal);
                        nextModShards[s] = shard;
                    }
                    shard.Remove(id);
                    nextMods--;
                    removedSet.Add(id);
                    dirtyTypes.Add(oldSlot.Record.Type);
                    AccumulateModuleCoords(oldSlot.Record, xDelta, yDelta, zDelta, gxDelta, gyDelta, -1);
                    UpdateModuleReferencesCopyOnWrite(nextRevRefs, clonedRevTargets, oldSlot.Record, add: false);
                }

                for (int i = 0; i < delta.ChangedModules.Count; i++) {
                    var module = delta.ChangedModules[i];
                    int pageId;
                    if (!delta.ModulePageIds.TryGetValue(module.Id, out pageId)) {
                        if (fallbackModPages == null) fallbackModPages = ScanModulePageIds(document.ModulePages, delta.ChangedModules);
                        fallbackModPages.TryGetValue(module.Id, out pageId);
                    }
                    int s = ModuleShardOf(module.Id);
                    var shard = nextModShards[s];
                    ModuleSlot oldSlot = default;
                    bool existed = shard != null && shard.TryGetValue(module.Id, out oldSlot);
                    if (shard == null) {
                        shard = new Dictionary<string, ModuleSlot>(4, StringComparer.Ordinal);
                        nextModShards[s] = shard;
                        clonedModShards.Add(s);
                    } else if (clonedModShards.Add(s)) {
                        StationEditTrace.AddCloned(shard.Count);
                        shard = new Dictionary<string, ModuleSlot>(shard, StringComparer.Ordinal);
                        nextModShards[s] = shard;
                    }

                    if (existed) {
                        AccumulateModuleCoords(oldSlot.Record, xDelta, yDelta, zDelta, gxDelta, gyDelta, -1);
                        UpdateModuleReferencesCopyOnWrite(nextRevRefs, clonedRevTargets, oldSlot.Record, add: false);
                        dirtyTypes.Add(oldSlot.Record.Type);
                        if (!string.Equals(oldSlot.Record.Type, module.Type, StringComparison.Ordinal) || oldSlot.PageId != pageId) {
                            orderNeedsSort = true;
                        }
                        replacedById[module.Id] = module;
                    } else {
                        nextMods++;
                        removedSet.Remove(module.Id);
                        addedInOrder.Add(module);
                    }

                    shard[module.Id] = new ModuleSlot(module, pageId);
                    dirtyTypes.Add(module.Type);
                    AccumulateModuleCoords(module, xDelta, yDelta, zDelta, gxDelta, gyDelta, 1);
                    UpdateModuleReferencesCopyOnWrite(nextRevRefs, clonedRevTargets, module, add: true);
                }

                moduleShards = nextModShards;
                moduleCount = nextMods;
                reverseReferences = nextRevRefs;

                if (moduleCount != document.ModuleCount) {
                    throw new StationRejectedException(new StationRejection("duplicate-id", StationRecordKind.Module, "", "",
                        "Two saved modules share one id; a module id must address exactly one record."));
                }

                var nextByType = new Dictionary<string, StationModuleRecord[]>(previous.modulesByType.Count + dirtyTypes.Count, StringComparer.Ordinal);
                foreach (var pair in previous.modulesByType) nextByType[pair.Key] = pair.Value;

                foreach (var type in dirtyTypes) {
                    previous.modulesByType.TryGetValue(type, out var priorArr);
                    var updated = new List<StationModuleRecord>((priorArr?.Length ?? 0) + addedInOrder.Count);
                    if (priorArr != null) {
                        for (int i = 0; i < priorArr.Length; i++) {
                            var m = priorArr[i];
                            if (removedSet.Contains(m.Id)) continue;
                            if (replacedById.TryGetValue(m.Id, out var rep)) {
                                if (string.Equals(rep.Type, type, StringComparison.Ordinal)) updated.Add(rep);
                            } else {
                                updated.Add(m);
                            }
                        }
                    }
                    for (int i = 0; i < addedInOrder.Count; i++) {
                        if (string.Equals(addedInOrder[i].Type, type, StringComparison.Ordinal))
                            updated.Add(addedInOrder[i]);
                    }
                    if (orderNeedsSort) {
                        foreach (var pair in replacedById) {
                            if (string.Equals(pair.Value.Type, type, StringComparison.Ordinal) && !updated.Contains(pair.Value))
                                updated.Add(pair.Value);
                        }
                        SortModulesByDocumentOrder(updated);
                    }
                    if (updated.Count == 0) nextByType.Remove(type);
                    else nextByType[type] = updated.ToArray();
                }
                modulesByType = nextByType;

                if (dirtyTypes.Contains("track")) {
                    tracksByLine = BuildTracksByLine(modulesByType);
                } else {
                    tracksByLine = previous.tracksByLine;
                }

                if (dirtyTypes.Contains("track") || dirtyTypes.Contains("pillar")) {
                    unsupportedBridgePillarColumns = ComputeUnsupportedBridgePillarColumns(modulesByType);
                } else {
                    unsupportedBridgePillarColumns = previous.unsupportedBridgePillarColumns;
                }

                diagnostics = RebuildDiagnosticsIncremental(previous, delta);
            }

            axisX = previous.axisX.Apply(xDelta);
            axisY = previous.axisY.Apply(yDelta);
            axisZ = previous.axisZ.Apply(zDelta);
            groundX = previous.groundX.Apply(gxDelta);
            groundY = previous.groundY.Apply(gyDelta);

            bounds = ComputeBounds(axisX, axisY, axisZ);
            Levels = axisZ.IsEmpty ? EmptyLevels : axisZ.Values;
        }

        StationIndex(StationIndex template, StationDocument reboundDocument) {
            Document = reboundDocument ?? throw new ArgumentNullException(nameof(reboundDocument));
            cellShards = template.cellShards;
            cellCount = template.cellCount;
            duplicateCellKeys = template.duplicateCellKeys;
            duplicateLastSolid = template.duplicateLastSolid;
            moduleShards = template.moduleShards;
            moduleCount = template.moduleCount;
            modulesByType = template.modulesByType;
            tracksByLine = template.tracksByLine;
            reverseReferences = template.reverseReferences;
            unsupportedBridgePillarColumns = template.unsupportedBridgePillarColumns;
            axisX = template.axisX;
            axisY = template.axisY;
            axisZ = template.axisZ;
            groundX = template.groundX;
            groundY = template.groundY;
            baseDiagnostics = template.baseDiagnostics;
            diagnostics = template.diagnostics;
            bounds = template.bounds;
            Lines = reboundDocument.Lines ?? Array.Empty<StationLineRecord>();
            Levels = template.Levels;
        }

        public StationIndex RebindDocument(StationDocument reboundDocument) =>
            ReferenceEquals(Document, reboundDocument) ? this : new StationIndex(this, reboundDocument);

        static int CellShardOf(StationCellKey key) {
            uint h = (uint)key.GetHashCode();
            h ^= h >> 16;
            return (int)(h & CellShardMask);
        }

        static int ModuleShardOf(string id) {
            uint h = (uint)StringComparer.Ordinal.GetHashCode(id ?? "");
            h ^= h >> 16;
            return (int)(h & ModuleShardMask);
        }

        static void AddCount(Dictionary<int, int> dict, int coord, int delta) {
            if (dict.TryGetValue(coord, out var existing)) {
                int next = existing + delta;
                if (next == 0) dict.Remove(coord);
                else dict[coord] = next;
            } else if (delta != 0) {
                dict[coord] = delta;
            }
        }

        static void AccumulateModuleCoords(StationModuleRecord module,
            Dictionary<int, int> xAcc, Dictionary<int, int> yAcc, Dictionary<int, int> zAcc,
            Dictionary<int, int> gxAcc, Dictionary<int, int> gyAcc, int sign) {
            AddCount(xAcc, module.X, sign);
            AddCount(yAcc, module.Y, sign);
            AddCount(zAcc, module.Z, sign);
            if (module.From.HasValue) AddCount(zAcc, (int)Math.Round(module.From.Value.Z), sign);
            if (module.To.HasValue) AddCount(zAcc, (int)Math.Round(module.To.Value.Z), sign);

            AddCount(gxAcc, module.X, sign);
            AddCount(gyAcc, module.Y, sign);
            if (string.Equals(module.Type, "road", StringComparison.Ordinal)) {
                AddCount(gxAcc, module.X + Math.Max(1, module.Width) - 1, sign);
                AddCount(gyAcc, module.Y + Math.Max(1, module.Depth) - 1, sign);
            }
            if (module.HasFrom && module.HasTo) {
                AddCount(gxAcc, (int)Math.Round(module.From.Value.X), sign);
                AddCount(gyAcc, (int)Math.Round(module.From.Value.Y), sign);
                AddCount(gxAcc, (int)Math.Round(module.To.Value.X), sign);
                AddCount(gyAcc, (int)Math.Round(module.To.Value.Y), sign);
            }
        }

        static StationBounds ComputeBounds(SortedAxisCounter x, SortedAxisCounter y, SortedAxisCounter z) {
            if (x.IsEmpty || y.IsEmpty || z.IsEmpty) return new StationBounds(0, 0, 0, -1, -1, -1);
            return new StationBounds(x.Min, y.Min, z.Min, x.Max, y.Max, z.Max);
        }

        static Dictionary<string, StationModuleRecord[]> BuildTracksByLine(Dictionary<string, StationModuleRecord[]> byType) {
            var tracks = new Dictionary<string, List<StationModuleRecord>>(StringComparer.Ordinal);
            if (byType.TryGetValue("track", out var trackModules)) {
                for (int i = 0; i < trackModules.Length; i++) {
                    var track = trackModules[i];
                    var lineId = track.Config.Text("line");
                    if (lineId.Length == 0) continue;
                    if (!tracks.TryGetValue(lineId, out var list)) tracks.Add(lineId, list = new List<StationModuleRecord>());
                    list.Add(track);
                }
            }
            var result = new Dictionary<string, StationModuleRecord[]>(tracks.Count, StringComparer.Ordinal);
            foreach (var pair in tracks) result[pair.Key] = pair.Value.ToArray();
            return result;
        }

        static HashSet<(int X, int Y)> ComputeUnsupportedBridgePillarColumns(Dictionary<string, StationModuleRecord[]> byType) {
            var cols = new HashSet<(int X, int Y)>();
            if (!byType.TryGetValue("track", out var tracks) || tracks.Length == 0) return cols;
            byType.TryGetValue("pillar", out var pillars);
            for (int t = 0; t < tracks.Length; t++) {
                var bridge = tracks[t];
                if (!bridge.Config.Bool("bridge")) continue;
                int width = Math.Max(1, bridge.Width);
                int depth = Math.Max(1, bridge.Depth);
                for (int i = 4; i + 4 <= width; i += 8) {
                    StationFootprints.RotateLocal(bridge.Rotation, i, Math.Floor(depth / 2.0), out var dx, out var dy);
                    int x = bridge.X + (int)Math.Round(dx);
                    int y = bridge.Y + (int)Math.Round(dy);
                    bool supported = false;
                    if (pillars != null) {
                        for (int p = 0; p < pillars.Length; p++) {
                            var pillar = pillars[p];
                            if (pillar.X == x && pillar.Y == y &&
                                Math.Abs(pillar.Z + pillar.Config.Number("height", 0) - bridge.Z) <= 1e-9) {
                                supported = true;
                                break;
                            }
                        }
                    }
                    if (!supported) cols.Add((x, y));
                }
            }
            return cols;
        }

        static Dictionary<StationCellKey, int> ScanCellPageIds(StationRecordPages<StationCellRecord> pages, List<StationCellRecord> targets) {
            var need = new HashSet<StationCellKey>();
            for (int i = 0; i < targets.Count; i++) need.Add(targets[i].Key);
            var map = new Dictionary<StationCellKey, int>(need.Count);
            for (int p = 0; p < pages.PageCount && map.Count < need.Count; p++) {
                var page = pages.RawPage(p);
                for (int j = 0; j < page.Length; j++) {
                    var k = page[j].Key;
                    if (need.Contains(k) && !map.ContainsKey(k)) map[k] = p;
                }
            }
            return map;
        }

        static Dictionary<string, int> ScanModulePageIds(StationRecordPages<StationModuleRecord> pages, List<StationModuleRecord> targets) {
            var need = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < targets.Count; i++) need.Add(targets[i].Id);
            var map = new Dictionary<string, int>(need.Count, StringComparer.Ordinal);
            for (int p = 0; p < pages.PageCount && map.Count < need.Count; p++) {
                var page = pages.RawPage(p);
                for (int j = 0; j < page.Length; j++) {
                    var id = page[j].Id;
                    if (need.Contains(id) && !map.ContainsKey(id)) map[id] = p;
                }
            }
            return map;
        }

        void SortModulesByDocumentOrder(List<StationModuleRecord> list) {
            if (list.Count <= 1) return;
            var modPages = Document.ModulePages;
            var order = new Dictionary<string, long>(list.Count, StringComparer.Ordinal);
            for (int i = 0; i < list.Count; i++) {
                var m = list[i];
                if (TryGetModulePage(m.Id, out _, out int pageId)) {
                    var page = modPages.RawPage(pageId);
                    int sub = 0;
                    for (int j = 0; j < page.Length; j++) {
                        if (string.Equals(page[j].Id, m.Id, StringComparison.Ordinal)) { sub = j; break; }
                    }
                    order[m.Id] = ((long)pageId << 20) | (uint)sub;
                } else {
                    order[m.Id] = long.MaxValue;
                }
            }
            list.Sort((a, b) => order[a.Id].CompareTo(order[b.Id]));
        }

        static void IndexModuleReferences(Dictionary<string, HashSet<string>> reverse, StationModuleRecord module, bool add) {
            var cfg = module.Config;
            for (int i = 0; i < ReferenceKeys.Length; i++) {
                var target = cfg.Text(ReferenceKeys[i]);
                if (target.Length == 0) continue;
                if (add) {
                    if (!reverse.TryGetValue(target, out var set)) reverse[target] = set = new HashSet<string>(StringComparer.Ordinal);
                    set.Add(module.Id);
                } else if (reverse.TryGetValue(target, out var set)) {
                    set.Remove(module.Id);
                    if (set.Count == 0) reverse.Remove(target);
                }
            }
        }

        static void UpdateModuleReferencesCopyOnWrite(
            Dictionary<string, HashSet<string>> reverse, HashSet<string> clonedTargets,
            StationModuleRecord module, bool add) {
            var cfg = module.Config;
            for (int i = 0; i < ReferenceKeys.Length; i++) {
                var target = cfg.Text(ReferenceKeys[i]);
                if (target.Length == 0) continue;
                if (add) {
                    if (!reverse.TryGetValue(target, out var set)) {
                        reverse[target] = set = new HashSet<string>(StringComparer.Ordinal);
                        clonedTargets.Add(target);
                    } else if (clonedTargets.Add(target)) {
                        set = new HashSet<string>(set, StringComparer.Ordinal);
                        reverse[target] = set;
                    }
                    set.Add(module.Id);
                } else if (reverse.TryGetValue(target, out var set)) {
                    if (clonedTargets.Add(target)) {
                        set = new HashSet<string>(set, StringComparer.Ordinal);
                        reverse[target] = set;
                    }
                    set.Remove(module.Id);
                    if (set.Count == 0) reverse.Remove(target);
                }
            }
        }

        List<StationDiagnostic> RebuildDiagnosticsIncremental(StationIndex previous, StationIndexDelta delta) {
            var recheckIds = new HashSet<string>(StringComparer.Ordinal);
            var touchedTargets = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < delta.RemovedModules.Count; i++) {
                var id = delta.RemovedModules[i];
                if (!string.IsNullOrEmpty(id)) touchedTargets.Add(id);
            }
            for (int i = 0; i < delta.ChangedModules.Count; i++) {
                var id = delta.ChangedModules[i].Id;
                recheckIds.Add(id);
                touchedTargets.Add(id);
            }
            foreach (var target in touchedTargets) {
                if (previous.reverseReferences.TryGetValue(target, out var oldRefs)) {
                    foreach (var r in oldRefs) if (TryGetModule(r, out _)) recheckIds.Add(r);
                }
                if (reverseReferences.TryGetValue(target, out var newRefs)) {
                    foreach (var r in newRefs) if (TryGetModule(r, out _)) recheckIds.Add(r);
                }
            }

            var lineIds = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < Lines.Count; i++) lineIds.Add(Lines[i].Id);

            var updated = new List<StationDiagnostic>(previous.diagnostics.Count + recheckIds.Count);
            for (int i = 0; i < previous.diagnostics.Count; i++) {
                var finding = previous.diagnostics[i];
                if (finding.Code == "line-without-track") continue;
                if (finding.Code == "dangling-reference") {
                    if (touchedTargets.Contains(finding.RecordId) || recheckIds.Contains(finding.RecordId)) continue;
                } else if (finding.RecordId.Length > 0 && touchedTargets.Contains(finding.RecordId)) {
                    continue;
                }
                updated.Add(finding);
            }

            foreach (var id in recheckIds) {
                if (TryGetModule(id, out var module)) ValidateModuleReferences(module, lineIds, updated);
            }
            for (int i = 0; i < Lines.Count; i++) {
                var line = Lines[i];
                if (TracksOfLine(line.Id).Count == 0)
                    updated.Add(new StationDiagnostic("line-without-track", StationDiagnosticSeverity.Info,
                        "line", line.Id, "Line has no saved track module."));
            }
            return updated;
        }

        void ValidateAllReferences(HashSet<string> lineIds, List<StationDiagnostic> sink) {
            foreach (var module in Document.ModulePages) {
                ValidateModuleReferences(module, lineIds, sink);
            }
            for (int i = 0; i < Lines.Count; i++) {
                var line = Lines[i];
                if (TracksOfLine(line.Id).Count == 0)
                    sink.Add(new StationDiagnostic("line-without-track", StationDiagnosticSeverity.Info,
                        "line", line.Id, "Line has no saved track module."));
            }
        }

        void ValidateModuleReferences(StationModuleRecord module, HashSet<string> lineIds, List<StationDiagnostic> sink) {
            var cfg = module.Config;
            var bridgeId = cfg.Text("bridgeId");
            if (bridgeId.Length > 0) {
                if (!TryGetModule(bridgeId, out var bridge)) {
                    sink.Add(new StationDiagnostic("dangling-reference", StationDiagnosticSeverity.Error,
                        module.Type, module.Id, "cfg.bridgeId names a module that does not exist: " + bridgeId));
                } else if (!string.Equals(bridge.Type, "track", StringComparison.Ordinal)) {
                    sink.Add(new StationDiagnostic("dangling-reference", StationDiagnosticSeverity.Error,
                        module.Type, module.Id, "cfg.bridgeId names " + bridge.Type + " '" + bridgeId + "', not a track."));
                }
            }
            WarnIfDangling(module, "boothId", "booth", sink);
            WarnIfDangling(module, "edgeId", "platform-edge", sink);
            WarnIfDangling(module, "exitId", "exit", sink);
            WarnIfDangling(module, "pillarId", "pillar", sink);
            WarnIfDangling(module, "from", "track", sink);
            WarnIfDangling(module, "support", null, sink);
            WarnIfDangling(module, "corner", "platform-edge", sink);

            var lineId = cfg.Text("line");
            if (lineId.Length > 0 && !lineIds.Contains(lineId)) {
                if (string.Equals(module.Type, "track", StringComparison.Ordinal)) {
                    sink.Add(new StationDiagnostic("dangling-reference", StationDiagnosticSeverity.Warning,
                        module.Type, module.Id, "cfg.line names a line that does not exist: " + lineId));
                } else if (string.Equals(module.Type, "platform-edge", StringComparison.Ordinal)) {
                    sink.Add(new StationDiagnostic("dangling-reference", StationDiagnosticSeverity.Warning,
                        module.Type, module.Id, "cfg.line names a line that does not exist: " + lineId));
                    sink.Add(new StationDiagnostic("dangling-reference", StationDiagnosticSeverity.Warning,
                        module.Type, module.Id, "cfg.line names a line that does not exist: " + lineId));
                }
            }
        }

        void WarnIfDangling(StationModuleRecord module, string key, string expectedType, List<StationDiagnostic> sink) {
            var id = module.Config.Text(key);
            if (id.Length == 0 || TryGetModule(id, out _)) return;
            if (expectedType == null && id.IndexOf('-') < 0) return;
            sink.Add(new StationDiagnostic("dangling-reference", StationDiagnosticSeverity.Warning,
                module.Type, module.Id, "cfg." + key + " names a module that does not exist: " + id +
                (expectedType == null ? "" : " (expected " + expectedType + ")")));
        }

        public static bool TryCreateIncremental(StationIndex previous, StationDocument document,
            StationIndexDelta delta, out StationIndex index, out StationRejection rejection) {
            try {
                index = new StationIndex(previous, document, delta);
                rejection = null;
                return true;
            } catch (StationRejectedException error) {
                index = null;
                rejection = error.Rejection;
                return false;
            }
        }

        public static bool TryCreate(StationDocument document, out StationIndex index, out StationRejection rejection) {
            try {
                index = new StationIndex(document, true);
                rejection = null;
                return true;
            } catch (StationRejectedException error) {
                index = null;
                rejection = error.Rejection;
                return false;
            }
        }

        public StationDocument Document { get; }
        public IReadOnlyList<StationLineRecord> Lines { get; }
        public IReadOnlyList<int> Levels { get; }
        public StationBounds Bounds => bounds;
        public int LevelBase => Document.LevelBase;
        public int StoreyHeight => Document.StoreyHeight;
        public IReadOnlyList<StationDiagnostic> Diagnostics => diagnostics;
        public int CellCount => cellCount;
        public int ModuleCount => moduleCount;

        public bool IsValid {
            get {
                for (int i = 0; i < diagnostics.Count; i++)
                    if (diagnostics[i].Severity == StationDiagnosticSeverity.Error) return false;
                return true;
            }
        }

        public bool HasDuplicateCell(StationCellKey key) =>
            duplicateCellKeys.Count > 0 && duplicateCellKeys.Contains(key);

        public StationCellRecord GetNormalizationNeighbour(StationCellKey key) {
            if (duplicateCellKeys.Count > 0 && duplicateCellKeys.Contains(key)) {
                return duplicateLastSolid.TryGetValue(key, out var solid) ? solid : null;
            }
            return GetCell(key);
        }

        public bool HasUnsupportedBridgePillarSite(int x, int y) =>
            unsupportedBridgePillarColumns.Count > 0 && unsupportedBridgePillarColumns.Contains((x, y));

        public void GetGroundWindow(out int x0, out int y0, out int x1, out int y1) {
            if (groundX.IsEmpty || groundY.IsEmpty) {
                x0 = y0 = x1 = y1 = 0;
                return;
            }
            x0 = groundX.Min;
            y0 = groundY.Min;
            x1 = groundX.Max;
            y1 = groundY.Max;
        }

        public bool TryGetCellPage(StationCellKey key, out StationCellRecord cell, out int pageId) {
            var shard = cellShards[CellShardOf(key)];
            if (shard != null && shard.TryGetValue(key, out var slot)) {
                cell = slot.Record;
                pageId = slot.PageId;
                return true;
            }
            cell = null;
            pageId = -1;
            return false;
        }

        public bool TryGetModulePage(string id, out StationModuleRecord module, out int pageId) {
            if (!string.IsNullOrEmpty(id)) {
                var shard = moduleShards[ModuleShardOf(id)];
                if (shard != null && shard.TryGetValue(id, out var slot)) {
                    module = slot.Record;
                    pageId = slot.PageId;
                    return true;
                }
            }
            module = null;
            pageId = -1;
            return false;
        }

        public bool TryGetCell(int x, int y, int z, out StationCellRecord cell) =>
            TryGetCell(new StationCellKey(x, y, z), out cell);

        public bool TryGetCell(StationCellKey key, out StationCellRecord cell) {
            var shard = cellShards[CellShardOf(key)];
            if (shard != null && shard.TryGetValue(key, out var slot)) {
                cell = slot.Record;
                return true;
            }
            cell = null;
            return false;
        }

        public StationCellRecord GetCell(int x, int y, int z) =>
            GetCell(new StationCellKey(x, y, z));

        public StationCellRecord GetCell(StationCellKey key) {
            var shard = cellShards[CellShardOf(key)];
            return shard != null && shard.TryGetValue(key, out var slot) ? slot.Record : null;
        }

        public bool TryGetModule(string id, out StationModuleRecord module) {
            if (!string.IsNullOrEmpty(id)) {
                var shard = moduleShards[ModuleShardOf(id)];
                if (shard != null && shard.TryGetValue(id, out var slot)) {
                    module = slot.Record;
                    return true;
                }
            }
            module = null;
            return false;
        }

        public StationModuleRecord GetModule(string id) =>
            TryGetModule(id, out var module) ? module : null;

        public IReadOnlyList<StationModuleRecord> ModulesOfType(string type) =>
            !string.IsNullOrEmpty(type) && modulesByType.TryGetValue(type, out var modules) ? modules : NoModules;

        public int CountOfType(string type) {
            if (string.IsNullOrEmpty(type)) return 0;
            return modulesByType.TryGetValue(type, out var modules) ? modules.Length : 0;
        }

        static readonly string[] NoIds = Array.Empty<string>();

        public IReadOnlyCollection<string> ReferrersOf(string targetId) {
            if (string.IsNullOrEmpty(targetId)) return NoIds;
            return reverseReferences.TryGetValue(targetId, out var set) ? (IReadOnlyCollection<string>)set : NoIds;
        }

        public IReadOnlyList<StationModuleRecord> TracksOfLine(string lineId) =>
            !string.IsNullOrEmpty(lineId) && tracksByLine.TryGetValue(lineId, out var tracks) ? tracks : NoModules;
    }
}
