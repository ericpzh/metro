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
    /// The records one local edit changed, added or removed, so <see cref="StationIndex"/> can
    /// update itself without rebuilding the whole station (plan 30 §3). The arrays are the
    /// authority for order; this type only names the deltas.
    /// </summary>
    public sealed class StationIndexDelta {
        public readonly List<StationCellKey> RemovedCells = new List<StationCellKey>();
        /// <summary>Every cell record the edit wrote or replaced, at its coordinate.</summary>
        public readonly List<StationCellRecord> ChangedCells = new List<StationCellRecord>();
        public readonly List<string> RemovedModules = new List<string>();
        /// <summary>Every module record the edit added or replaced, by its (unique) id.</summary>
        public readonly List<StationModuleRecord> ChangedModules = new List<StationModuleRecord>();
    }

    /// <summary>
    /// The read-only lookup layer over one <see cref="StationDocument"/>: cells by
    /// <c>(x,y,z)</c>, modules by <c>id</c>, lines and the station's levels.
    ///
    /// The constructor is strict about identity — a duplicate cell key or module id
    /// is a refusal, because two records with one key cannot both be addressed by
    /// id — and reports dangling authored references as diagnostics. A missing
    /// reference the TypeScript loader tolerates (a sign still mounted over a booth
    /// that was removed) is a <see cref="StationDiagnosticSeverity.Warning"/>; one
    /// that can no longer be repaired (a bridge-owned pillar whose bridge is gone)
    /// is an error.
    /// </summary>
    public sealed class StationIndex {
        static readonly StationModuleRecord[] NoModules = Array.Empty<StationModuleRecord>();
        static readonly int[] NoLevels = Array.Empty<int>();

        readonly Dictionary<StationCellKey, StationCellRecord> cellsByKey;
        readonly Dictionary<string, StationModuleRecord> modulesById;
        readonly Dictionary<string, StationModuleRecord[]> modulesByType;
        readonly Dictionary<string, StationModuleRecord[]> tracksByLine;
        readonly List<StationDiagnostic> diagnostics;
        readonly StationBounds bounds;

        public StationIndex(StationDocument document) : this(document, true) { }

        StationIndex(StationDocument document, bool strict) {
            Document = document ?? throw new ArgumentNullException(nameof(document));
            var cells = new Dictionary<StationCellKey, StationCellRecord>(document.CellCount + 16);
            diagnostics = new List<StationDiagnostic>();
            for (int i = 0; i < document.CellCount; i++) {
                var cell = document.Cells[i];
                if (cells.ContainsKey(cell.Key)) {
                    // The source grid repair keeps the first record at a coordinate and drops
                    // the rest (`build/model/Grid.ts`), so a save the TS game opens opens here
                    // too; the duplicate is reported, never silently drawn.
                    diagnostics.Add(new StationDiagnostic("duplicate-cell", StationDiagnosticSeverity.Warning,
                        "cell", cell.Key.ToString(),
                        "Two saved cells share one coordinate; the first record was kept and the later one ignored."));
                    continue;
                }
                cells.Add(cell.Key, cell);
            }
            cellsByKey = cells;

            var modules = new Dictionary<string, StationModuleRecord>(document.ModuleCount + 16, StringComparer.Ordinal);
            var byType = new Dictionary<string, List<StationModuleRecord>>(StringComparer.Ordinal);
            for (int i = 0; i < document.ModuleCount; i++) {
                var module = document.Modules[i];
                if (modules.ContainsKey(module.Id)) {
                    var refusal = new StationRejection("duplicate-id", StationRecordKind.Module, module.Type, module.Id,
                        "Two saved modules share one id; a module id must address exactly one record.");
                    if (strict) throw new StationRejectedException(refusal);
                    diagnostics.Add(new StationDiagnostic(refusal.Code, StationDiagnosticSeverity.Error, refusal.RecordType, refusal.RecordId, refusal.Reason));
                    continue;
                }
                modules.Add(module.Id, module);
                if (!byType.TryGetValue(module.Type, out var list)) byType.Add(module.Type, list = new List<StationModuleRecord>());
                list.Add(module);
            }
            modulesById = modules;
            modulesByType = new Dictionary<string, StationModuleRecord[]>(byType.Count, StringComparer.Ordinal);
            foreach (var pair in byType) modulesByType[pair.Key] = pair.Value.ToArray();

            var lines = document.Lines ?? Array.Empty<StationLineRecord>();
            var lineIds = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < lines.Count; i++) lineIds.Add(lines[i].Id);
            Lines = lines;

            var tracks = new Dictionary<string, List<StationModuleRecord>>(StringComparer.Ordinal);
            if (modulesByType.TryGetValue("track", out var trackModules)) {
                foreach (var track in trackModules) {
                    var lineId = track.Config.Text("line");
                    if (lineId.Length == 0) continue;
                    if (!tracks.TryGetValue(lineId, out var list)) tracks.Add(lineId, list = new List<StationModuleRecord>());
                    list.Add(track);
                }
            }
            tracksByLine = new Dictionary<string, StationModuleRecord[]>(tracks.Count, StringComparer.Ordinal);
            foreach (var pair in tracks) tracksByLine[pair.Key] = pair.Value.ToArray();

            // Levels come from the content itself: authored cells, anchored modules
            // and run endpoints, so a mezzanine or a below-grade platform shows up
            // even when no cell is filled there.
            Levels = ScanLevels(document, out bounds);

            if (document.DroppedCells > 0)
                diagnostics.Add(new StationDiagnostic("cells-dropped", StationDiagnosticSeverity.Warning, "cell", "",
                    document.DroppedCells + " off-grid cell(s) were dropped by the grid repair."));
            if (document.DroppedModules > 0)
                diagnostics.Add(new StationDiagnostic("modules-dropped", StationDiagnosticSeverity.Warning, "module", "",
                    document.DroppedModules + " off-grid module(s) were dropped by the grid repair."));

            ValidateReferences(lineIds, byType);
        }

        /// <summary>
        /// The local-edit constructor (plan 30 §3): copy the previous lookups, apply the delta,
        /// and re-derive the cheap aggregates (per-type lists, per-line tracks, levels, bounds)
        /// from the new document arrays. It never re-parses a record: the records it stores are
        /// the ones the local edit already projected.
        ///
        /// The reference diagnostics are re-validated over the new module array, because a
        /// removed or rewritten module can orphan another record's authored reference; every
        /// other diagnostic the previous index reported still holds, because a local edit cannot
        /// move it.
        /// </summary>
        StationIndex(StationIndex previous, StationDocument document, StationIndexDelta delta) {
            Document = document ?? throw new ArgumentNullException(nameof(document));
            if (delta == null) throw new ArgumentNullException(nameof(delta));

            var cells = new Dictionary<StationCellKey, StationCellRecord>(previous.cellsByKey);
            for (int i = 0; i < delta.RemovedCells.Count; i++) cells.Remove(delta.RemovedCells[i]);
            for (int i = 0; i < delta.ChangedCells.Count; i++) cells[delta.ChangedCells[i].Key] = delta.ChangedCells[i];
            cellsByKey = cells;

            var modules = new Dictionary<string, StationModuleRecord>(previous.modulesById, StringComparer.Ordinal);
            for (int i = 0; i < delta.RemovedModules.Count; i++) modules.Remove(delta.RemovedModules[i]);
            for (int i = 0; i < delta.ChangedModules.Count; i++) {
                var module = delta.ChangedModules[i];
                modules[module.Id] = module;
            }
            modulesById = modules;
            if (modules.Count != document.ModuleCount) {
                // Two records with one id cannot both be addressed; the full constructor refuses
                // this, and a local delta must not be able to introduce it silently.
                throw new StationRejectedException(new StationRejection("duplicate-id", StationRecordKind.Module, "", "",
                    "Two saved modules share one id; a module id must address exactly one record."));
            }

            // Order comes from the document, never from the dictionary: a module's position in
            // `document.Modules` is the order a full read would project.
            var byType = new Dictionary<string, List<StationModuleRecord>>(StringComparer.Ordinal);
            for (int i = 0; i < document.ModuleCount; i++) {
                var module = document.Modules[i];
                if (!byType.TryGetValue(module.Type, out var list)) byType.Add(module.Type, list = new List<StationModuleRecord>());
                list.Add(module);
            }
            modulesByType = new Dictionary<string, StationModuleRecord[]>(byType.Count, StringComparer.Ordinal);
            foreach (var pair in byType) modulesByType[pair.Key] = pair.Value.ToArray();

            var lines = document.Lines ?? Array.Empty<StationLineRecord>();
            var lineIds = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < lines.Count; i++) lineIds.Add(lines[i].Id);
            Lines = lines;

            var tracks = new Dictionary<string, List<StationModuleRecord>>(StringComparer.Ordinal);
            if (modulesByType.TryGetValue("track", out var trackModules)) {
                foreach (var track in trackModules) {
                    var lineId = track.Config.Text("line");
                    if (lineId.Length == 0) continue;
                    if (!tracks.TryGetValue(lineId, out var list)) tracks.Add(lineId, list = new List<StationModuleRecord>());
                    list.Add(track);
                }
            }
            tracksByLine = new Dictionary<string, StationModuleRecord[]>(tracks.Count, StringComparer.Ordinal);
            foreach (var pair in tracks) tracksByLine[pair.Key] = pair.Value.ToArray();

            Levels = ScanLevels(document, out bounds);

            // Keep what the previous index reported, minus the reference findings the edit can
            // invalidate (they are recomputed below) and the findings the edit rewrote away.
            // A local edit refuses an off-grid or duplicated record, so the counts and the
            // duplicate findings the previous index reported still hold.
            diagnostics = new List<StationDiagnostic>(previous.diagnostics.Count);
            for (int i = 0; i < previous.diagnostics.Count; i++) {
                var finding = previous.diagnostics[i];
                if (ReferenceDiagnostic(finding.Code)) continue;
                if (NamesEditedModule(finding, delta)) continue;
                diagnostics.Add(finding);
            }

            ValidateReferences(lineIds, byType);
        }

        static bool ReferenceDiagnostic(string code) =>
            code == "dangling-reference" || code == "line-without-track";

        static bool NamesEditedModule(StationDiagnostic finding, StationIndexDelta delta) {
            if (finding.RecordId.Length == 0) return false;
            for (int i = 0; i < delta.ChangedModules.Count; i++)
                if (string.Equals(delta.ChangedModules[i].Id, finding.RecordId, StringComparison.Ordinal)) return true;
            for (int i = 0; i < delta.RemovedModules.Count; i++)
                if (string.Equals(delta.RemovedModules[i], finding.RecordId, StringComparison.Ordinal)) return true;
            return false;
        }

        /// <summary>The tiers and box the content speaks for, shared by both constructors.</summary>
        static IReadOnlyList<int> ScanLevels(StationDocument document, out StationBounds bounds) {
            var levelSet = new SortedSet<int>();
            int minX = int.MaxValue, minY = int.MaxValue, minZ = int.MaxValue;
            int maxX = int.MinValue, maxY = int.MinValue, maxZ = int.MinValue;
            foreach (var cell in document.Cells) {
                levelSet.Add(cell.Z);
                if (cell.X < minX) minX = cell.X;
                if (cell.X > maxX) maxX = cell.X;
                if (cell.Y < minY) minY = cell.Y;
                if (cell.Y > maxY) maxY = cell.Y;
                if (cell.Z < minZ) minZ = cell.Z;
                if (cell.Z > maxZ) maxZ = cell.Z;
            }
            foreach (var module in document.Modules) {
                levelSet.Add(module.Z);
                if (module.X < minX) minX = module.X;
                if (module.X > maxX) maxX = module.X;
                if (module.Y < minY) minY = module.Y;
                if (module.Y > maxY) maxY = module.Y;
                if (module.Z < minZ) minZ = module.Z;
                if (module.Z > maxZ) maxZ = module.Z;
                if (module.From.HasValue) {
                    levelSet.Add((int)Math.Round(module.From.Value.Z));
                    if (module.From.Value.Z > maxZ) maxZ = (int)Math.Round(module.From.Value.Z);
                    if (module.From.Value.Z < minZ) minZ = (int)Math.Round(module.From.Value.Z);
                }
                if (module.To.HasValue) {
                    levelSet.Add((int)Math.Round(module.To.Value.Z));
                    if (module.To.Value.Z > maxZ) maxZ = (int)Math.Round(module.To.Value.Z);
                    if (module.To.Value.Z < minZ) minZ = (int)Math.Round(module.To.Value.Z);
                }
            }
            bounds = minX == int.MaxValue
                ? new StationBounds(0, 0, 0, -1, -1, -1)
                : new StationBounds(minX, minY, minZ, maxX, maxY, maxZ);
            return levelSet.Count > 0
                ? new ReadOnlyCollection<int>(new List<int>(levelSet))
                : new ReadOnlyCollection<int>(NoLevels);
        }

        /// <summary>
        /// Builds the index from the previous one plus a local edit's delta. Returns the typed
        /// refusal instead of throwing when the delta would break the index's identity contract.
        /// </summary>
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


        /// <summary>Builds the index and returns the typed refusal instead of throwing.</summary>
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
        /// <summary>Every distinct elevation the content speaks for, ascending.</summary>
        public IReadOnlyList<int> Levels { get; }
        public StationBounds Bounds => bounds;
        public int LevelBase => Document.LevelBase;
        public int StoreyHeight => Document.StoreyHeight;
        public IReadOnlyList<StationDiagnostic> Diagnostics => diagnostics;
        public int CellCount => cellsByKey.Count;
        public int ModuleCount => modulesById.Count;

        public bool IsValid {
            get {
                for (int i = 0; i < diagnostics.Count; i++)
                    if (diagnostics[i].Severity == StationDiagnosticSeverity.Error) return false;
                return true;
            }
        }

        public bool TryGetCell(int x, int y, int z, out StationCellRecord cell) =>
            cellsByKey.TryGetValue(new StationCellKey(x, y, z), out cell);

        public StationCellRecord GetCell(int x, int y, int z) =>
            cellsByKey.TryGetValue(new StationCellKey(x, y, z), out var cell) ? cell : null;

        public StationCellRecord GetCell(StationCellKey key) =>
            cellsByKey.TryGetValue(key, out var cell) ? cell : null;

        public bool TryGetModule(string id, out StationModuleRecord module) {
            if (string.IsNullOrEmpty(id)) { module = null; return false; }
            return modulesById.TryGetValue(id, out module);
        }

        public StationModuleRecord GetModule(string id) =>
            !string.IsNullOrEmpty(id) && modulesById.TryGetValue(id, out var module) ? module : null;

        public IReadOnlyList<StationModuleRecord> ModulesOfType(string type) =>
            !string.IsNullOrEmpty(type) && modulesByType.TryGetValue(type, out var modules) ? modules : NoModules;

        public int CountOfType(string type) {
            if (string.IsNullOrEmpty(type)) return 0;
            return modulesByType.TryGetValue(type, out var modules) ? modules.Length : 0;
        }

        /// <summary>The saved track modules whose <c>cfg.line</c> names this line.</summary>
        public IReadOnlyList<StationModuleRecord> TracksOfLine(string lineId) =>
            !string.IsNullOrEmpty(lineId) && tracksByLine.TryGetValue(lineId, out var tracks) ? tracks : NoModules;

        void ValidateReferences(HashSet<string> lineIds, Dictionary<string, List<StationModuleRecord>> byType) {
            foreach (var module in Document.Modules) {
                var cfg = module.Config;
                var bridgeId = cfg.Text("bridgeId");
                if (bridgeId.Length > 0) {
                    if (!modulesById.TryGetValue(bridgeId, out var bridge)) {
                        diagnostics.Add(new StationDiagnostic("dangling-reference", StationDiagnosticSeverity.Error,
                            module.Type, module.Id, "cfg.bridgeId names a module that does not exist: " + bridgeId));
                    } else if (!string.Equals(bridge.Type, "track", StringComparison.Ordinal)) {
                        diagnostics.Add(new StationDiagnostic("dangling-reference", StationDiagnosticSeverity.Error,
                            module.Type, module.Id, "cfg.bridgeId names " + bridge.Type + " '" + bridgeId + "', not a track."));
                    }
                }
                // Author references the source loader deliberately leaves bound to a
                // missing record (a sign plate keeps its booth placement after the
                // booth is deleted). Report them; never rebind them silently.
                WarnIfDangling(module, "boothId", "booth");
                WarnIfDangling(module, "edgeId", "platform-edge");
                WarnIfDangling(module, "exitId", "exit");
                WarnIfDangling(module, "pillarId", "pillar");
                WarnIfDangling(module, "from", "track");
                WarnIfDangling(module, "support", null);
                WarnIfDangling(module, "corner", "platform-edge");

                var lineId = cfg.Text("line");
                if (lineId.Length > 0 && !lineIds.Contains(lineId) &&
                    (string.Equals(module.Type, "track", StringComparison.Ordinal) ||
                     string.Equals(module.Type, "platform-edge", StringComparison.Ordinal))) {
                    diagnostics.Add(new StationDiagnostic("dangling-reference", StationDiagnosticSeverity.Warning,
                        module.Type, module.Id, "cfg.line names a line that does not exist: " + lineId));
                }
            }
            // A line with no saved track is a real state (a road-only or crowd-only
            // station); report it as info so a verifier can tell it from a load bug.
            foreach (var line in Document.Lines) {
                if (TracksOfLine(line.Id).Count == 0)
                    diagnostics.Add(new StationDiagnostic("line-without-track", StationDiagnosticSeverity.Info,
                        "line", line.Id, "Line has no saved track module."));
            }
            if (byType.TryGetValue("platform-edge", out var edges)) {
                foreach (var edge in edges) {
                    var lineId = edge.Config.Text("line");
                    if (lineId.Length > 0 && !lineIds.Contains(lineId))
                        diagnostics.Add(new StationDiagnostic("dangling-reference", StationDiagnosticSeverity.Warning,
                            edge.Type, edge.Id, "cfg.line names a line that does not exist: " + lineId));
                }
            }
        }

        void WarnIfDangling(StationModuleRecord module, string key, string expectedType) {
            var id = module.Config.Text(key);
            if (id.Length == 0 || modulesById.ContainsKey(id)) return;
            // `support`/`corner`/`from` values that name a *derived* platform id are
            // not module references at all; only report when the value looks like a
            // module id of a known type, or when the expected type is explicit.
            if (expectedType == null && id.IndexOf('-') < 0) return;
            diagnostics.Add(new StationDiagnostic("dangling-reference", StationDiagnosticSeverity.Warning,
                module.Type, module.Id, "cfg." + key + " names a module that does not exist: " + id +
                (expectedType == null ? "" : " (expected " + expectedType + ")")));
        }
    }
}
