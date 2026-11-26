using System;
using System.Collections.Generic;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>
    /// Bounded neighborhood local-edit installer (Plan 32 §3.C). Applies an explicit cell or
    /// module patch directly against the committed <see cref="StationRecordPages{T}"/> and
    /// sharded <see cref="StationIndex"/> without cloning, scanning, serializing or hashing a
    /// whole-station JSON envelope.
    ///
    /// Only the patch's written cells and their 1-ring neighbours are parsed and normalized;
    /// every untouched record and leaf page is shared with the committed document. Snapshot JSON
    /// and SHA-256 export hashes materialize lazily outside the edit transaction. Unsupported
    /// load-time-repaired records, line additions, off-grid modules and duplicate cell coordinates
    /// return a stable <c>local-*</c> refusal so the caller falls back to <see cref="StationDocumentReader.Read"/>.
    /// </summary>
    public static class StationLocalEdit {
        static readonly (int X, int Y, int Z)[] Neighbourhood = {
            (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
        };

        sealed class WorkingCell {
            public StationCellKey Key;
            public StationCellRecord OriginalRecord;
            public int OriginalPageId;
            public JObject Json;
            public int CurrentPageId;
            public StationCellRecord Placeholder;
        }

        // --------------------------------------------------------------- cell patches

        public static StationReadResult TryApplyCells(StationReadResult committed, StationCellPatch patch,
            string sourceId, out string code) {
            using var editSample = StationEditTrace.Measure("StationEdit.TryApplyCells");
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-document"; return null; }
            if (patch == null || (!patch.HasWork && patch.RemoveModuleIds.Count == 0)) { code = "no-change"; return null; }
            if (patch.LineAdds.Count > 0) { code = "local-line-adds"; return null; }
            if (!TryCloneRootHeader(committed, out var rootHeader, out var savedAt, out code)) return null;

            var delta = new StationIndexDelta();
            if (!TryProjectCells(committed.Document, committed.Index, patch, delta, out var cellPages, out code)) return null;
            if (!TryProjectPatchModules(committed.Document, committed.Index, patch, delta, out var modulePages, out code)) return null;

            return BuildResult(committed, rootHeader, savedAt, cellPages, modulePages, delta, sourceId, out code);
        }

        // ------------------------------------------------------------- module edits

        public static StationReadResult TryApplyModule(StationReadResult committed, StationModuleEditMode mode,
            StationEditDraft draft, string removeId, string sourceId, out string code) {
            using var editSample = StationEditTrace.Measure("StationEdit.TryApplyModule");
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-document"; return null; }
            if (!TryCloneRootHeader(committed, out var rootHeader, out var savedAt, out code)) return null;

            var delta = new StationIndexDelta();
            if (!TryProjectSingleModule(committed.Document, committed.Index, mode, draft, removeId, delta, out var modulePages, out code)) {
                return null;
            }
            return BuildResult(committed, rootHeader, savedAt, committed.Document.CellPages, modulePages, delta, sourceId, out code);
        }

        /// <summary>Patch one exit module's settings (<c>name</c>, <c>inRate</c>, <c>open</c>) in place.</summary>
        public static StationReadResult TryApplyExitSettings(StationReadResult committed, string moduleId,
            bool hasName, string name, bool hasInRate, double inRate, bool hasOpen, bool open,
            string sourceId, out string code) {
            using var editSample = StationEditTrace.Measure("StationEdit.TryApplyExitSettings");
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-document"; return null; }
            if (string.IsNullOrEmpty(moduleId)) { code = "bad-payload"; return null; }
            if (!TryCloneRootHeader(committed, out var rootHeader, out var savedAt, out code)) return null;
            if (!committed.Index.TryGetModulePage(moduleId, out var existing, out int pageId) || existing == null ||
                !string.Equals(existing.Type, "exit", StringComparison.Ordinal)) {
                code = "not-found";
                return null;
            }
            var json = JObject.Parse(existing.RawJson);
            StationModuleEdits.ApplyExitSettings(json, hasName, name, hasInRate, inRate, hasOpen, open);
            if (!TryBuildProjectedModule(json, committed.Document.City, out var built, out code)) return null;

            var builder = committed.Document.ModulePages.ToBuilder();
            if (!builder.ReplaceInPage(pageId, m => string.Equals(m.Id, moduleId, StringComparison.Ordinal), built)) {
                code = "local-module-mismatch";
                return null;
            }
            var delta = new StationIndexDelta();
            delta.ChangedModules.Add(built);
            delta.ModulePageIds[built.Id] = pageId;
            StationEditTrace.AddScanned(1);
            StationEditTrace.AddCloned(builder.ClonedRecordCount + 1);
            var modulePages = builder.Build(committed.Document.ModulePages);
            return BuildResult(committed, rootHeader, savedAt, committed.Document.CellPages, modulePages, delta, sourceId, out code);
        }

        /// <summary>
        /// Patch one module's JSON in place through the bounded local path (e.g. lift door sides,
        /// escalator/walkway direction reversal, one-way road reversal). Returns null with a stable
        /// code if the module is missing, refuses the edit, or requires full-document repair.
        /// </summary>
        public static StationReadResult TryApplyModuleInPlace(StationReadResult committed, string moduleId,
            Func<JObject, string> mutator, string sourceId, out string code) {
            using var editSample = StationEditTrace.Measure("StationEdit.TryApplyModuleInPlace");
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-document"; return null; }
            if (string.IsNullOrEmpty(moduleId) || mutator == null) { code = "bad-payload"; return null; }
            if (!TryCloneRootHeader(committed, out var rootHeader, out var savedAt, out code)) return null;
            if (!committed.Index.TryGetModulePage(moduleId, out var existing, out int pageId) || existing == null) {
                code = "not-found";
                return null;
            }
            var json = JObject.Parse(existing.RawJson);
            string err = mutator(json);
            if (!string.IsNullOrEmpty(err)) { code = err; return null; }
            if (!TryBuildProjectedModule(json, committed.Document.City, out var built, out code)) return null;

            var builder = committed.Document.ModulePages.ToBuilder();
            if (!builder.ReplaceInPage(pageId, m => string.Equals(m.Id, moduleId, StringComparison.Ordinal), built)) {
                code = "local-module-mismatch";
                return null;
            }
            var delta = new StationIndexDelta();
            delta.ChangedModules.Add(built);
            delta.ModulePageIds[built.Id] = pageId;
            StationEditTrace.AddScanned(1);
            StationEditTrace.AddCloned(builder.ClonedRecordCount + 1);
            var modulePages = builder.Build(committed.Document.ModulePages);
            return BuildResult(committed, rootHeader, savedAt, committed.Document.CellPages, modulePages, delta, sourceId, out code);
        }

        /// <summary>
        /// Apply a complete authored road-record set (<see cref="StationRoadEdits"/> output)
        /// incrementally against <see cref="StationDocument.ModulePages"/> without re-serializing
        /// or re-parsing unrelated cells or modules. Untouched road records are shared; removed,
        /// changed, and newly added road records populate <see cref="StationIndexDelta"/> so
        /// <see cref="StationRoadRenderer"/> can restage roads while all other view families stay
        /// retained.
        /// </summary>
        static bool RoadRecordUnchanged(StationModuleRecord prior, StationRoadRecord next) {
            if (prior == null || next == null) return false;
            var prev = StationRoadRecord.FromFacts(prior.Facts);
            if (!string.Equals(prev.Id, next.Id, StringComparison.Ordinal)) return false;
            if (prev.X != next.X || prev.Y != next.Y || Math.Abs(prev.Z - next.Z) > 1e-9) return false;
            if (prev.W != next.W || prev.D != next.D || prev.Rotation != next.Rotation) return false;
            if (!string.Equals(prev.Direction, next.Direction, StringComparison.Ordinal)) return false;
            if (prev.HasFrom != next.HasFrom || prev.HasTo != next.HasTo) return false;
            if (prev.HasFrom && (Math.Abs(prev.From.X - next.From.X) > 1e-6 || Math.Abs(prev.From.Y - next.From.Y) > 1e-6)) return false;
            if (prev.HasTo && (Math.Abs(prev.To.X - next.To.X) > 1e-6 || Math.Abs(prev.To.Y - next.To.Y) > 1e-6)) return false;
            return true;
        }

        public static StationReadResult TryApplyRoadSet(StationReadResult committed,
            IReadOnlyList<StationRoadRecord> nextRoads, string sourceId, out string code) {
            using var editSample = StationEditTrace.Measure("StationEdit.TryApplyRoadSet");
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-document"; return null; }
            if (nextRoads == null) { code = "bad-payload"; return null; }
            if (!TryCloneRootHeader(committed, out var rootHeader, out var savedAt, out code)) return null;

            var prevRoads = committed.Index.ModulesOfType("road");
            var prevById = new Dictionary<string, (StationModuleRecord Record, int PageId)>(prevRoads.Count, StringComparer.Ordinal);
            for (int i = 0; i < prevRoads.Count; i++) {
                var rec = prevRoads[i];
                if (rec == null || string.IsNullOrEmpty(rec.Id)) continue;
                if (!committed.Index.TryGetModulePage(rec.Id, out var paged, out int pageId) || paged == null) {
                    code = "local-road-page-missing";
                    return null;
                }
                prevById[rec.Id] = (paged, pageId);
            }

            var nextIds = new HashSet<string>(StringComparer.Ordinal);
            var changedNext = new List<StationModuleRecord>();
            string city = committed.Document.City;
            for (int i = 0; i < nextRoads.Count; i++) {
                var road = nextRoads[i];
                if (road == null || string.IsNullOrEmpty(road.Id) || !nextIds.Add(road.Id)) {
                    code = "local-bad-road";
                    return null;
                }
                if (prevById.TryGetValue(road.Id, out var existing) && RoadRecordUnchanged(existing.Record, road)) {
                    continue;
                }
                var roadJson = StationRoadWrites.ToSaveRecord(road);
                var refusal = ModuleRefusal(roadJson);
                if (refusal != null) { code = refusal; return null; }
                if (!TryBuildProjectedModule(roadJson, city, out var built, out code)) return null;
                changedNext.Add(built);
            }

            var builder = committed.Document.ModulePages.ToBuilder();
            var delta = new StationIndexDelta();

            foreach (var kv in prevById) {
                if (nextIds.Contains(kv.Key)) continue;
                if (!builder.RemoveFromPage(kv.Value.PageId, m => string.Equals(m.Id, kv.Key, StringComparison.Ordinal))) {
                    code = "local-module-mismatch";
                    return null;
                }
                delta.RemovedModules.Add(kv.Key);
            }

            for (int i = 0; i < changedNext.Count; i++) {
                var built = changedNext[i];
                if (prevById.TryGetValue(built.Id, out var prior)) {
                    if (string.Equals(prior.Record.RawJson, built.RawJson, StringComparison.Ordinal)) continue;
                    if (!builder.ReplaceInPage(prior.PageId, m => string.Equals(m.Id, built.Id, StringComparison.Ordinal), built)) {
                        code = "local-module-mismatch";
                        return null;
                    }
                    delta.ChangedModules.Add(built);
                    delta.ModulePageIds[built.Id] = prior.PageId;
                } else {
                    int pageId = builder.Append(built);
                    delta.ChangedModules.Add(built);
                    delta.ModulePageIds[built.Id] = pageId;
                }
            }

            StationEditTrace.AddScanned(prevById.Count + nextRoads.Count);
            StationEditTrace.AddCloned(builder.ClonedRecordCount + delta.ChangedModules.Count);
            var modulePages = builder.Build(committed.Document.ModulePages);
            return BuildResult(committed, rootHeader, savedAt, committed.Document.CellPages, modulePages, delta, sourceId, out code);
        }

        /// <summary>
        /// Update station-level metadata (<c>name</c>, <c>nameEn</c>, <c>city</c>) and/or the
        /// <c>static.lines</c> list without touching or cloning any cell or module page.
        /// </summary>
        public static StationReadResult TryApplyMetadata(StationReadResult committed,
            string nextName, string nextNameEn, string nextCity,
            IReadOnlyList<StationLineRecord> nextLines, string sourceId, out string code) {
            using var editSample = StationEditTrace.Measure("StationEdit.TryApplyMetadata");
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-document"; return null; }
            if (!TryCloneRootHeader(committed, out var rootHeader, out var savedAt, out code)) return null;

            var previous = committed.Document;
            string name = nextName ?? previous.Name;
            string nameEn = nextNameEn ?? previous.NameEn;
            string city = string.IsNullOrEmpty(nextCity) ? previous.City : nextCity;
            var lines = nextLines ?? previous.Lines;

            rootHeader["name"] = name;
            rootHeader["nameEn"] = nameEn;
            rootHeader["city"] = city;
            rootHeader.Remove("cityStyle");

            var rawRootJson = StationDocumentReader.CanonicalRootJson(rootHeader);
            var document = new StationDocument(
                name, nameEn, city, previous.Seed,
                previous.LevelBase, previous.StoreyHeight, previous.Day,
                previous.CellPages, previous.ModulePages, lines,
                previous.DroppedCells, previous.DroppedModules,
                new StationSource(sourceId ?? "", ""), savedAt,
                null,
                doc => StationDocumentReader.SerializeEnvelope(rootHeader, doc.SavedAt, doc),
                doc => StationDocumentReader.HashEnvelope(rootHeader, doc.SavedAt, doc),
                rawRootJson);
            StationDocumentReader.RegisterRootHeader(document, rootHeader);

            var index = committed.Index.RebindDocument(document);
            StationEditTrace.NoteLocalDocument();
            var result = StationReadResult.FromLocalEdit(document, index, committed.ReaderDiagnostics, committed.Repairs, rootHeader);
            result.LocalParent = committed;
            result.LocalDelta = new StationIndexDelta();
            return result;
        }

        // ------------------------------------------------------------- history restore

        /// <summary>
        /// Restore a retained local history snapshot in O(|delta|) by sharing the target's
        /// immutable record pages and sharded index, attaching the precomputed inverse delta.
        /// </summary>
        public static StationReadResult TryRestore(StationReadResult committed, StationReadResult target,
            StationIndexDelta inverseDelta, string sourceId, out string code) {
            using var restoreSample = StationEditTrace.Measure("StationEdit.TryRestore");
            code = null;
            if (committed?.Document == null || committed.Index == null ||
                target?.Document == null || target.Index == null) {
                code = "no-document";
                return null;
            }
            if (committed.Envelope == null || target.Envelope == null) {
                code = "local-no-envelope";
                return null;
            }
            if (!SameHeaderMetadata(committed.Envelope, target.Envelope)) {
                code = "local-history-metadata";
                return null;
            }
            if (inverseDelta == null) {
                inverseDelta = ComputeDeltaBetween(committed.Index, target.Index);
            }

            if (!TryCloneRootHeader(target, out var rootHeader, out var savedAt, out code, preserveSavedAt: true)) return null;
            var rawRootJson = StationDocumentReader.CanonicalRootJson(rootHeader);
            var existingHash = target.Document.PeekMaterializedHash() ?? "";
            var nextDoc = target.Document.WithSnapshotMetadata(
                new StationSource(sourceId ?? "", existingHash),
                savedAt,
                doc => StationDocumentReader.SerializeEnvelope(rootHeader, doc.SavedAt, doc),
                doc => StationDocumentReader.HashEnvelope(rootHeader, doc.SavedAt, doc),
                rawRootJson);
            StationDocumentReader.RegisterRootHeader(nextDoc, rootHeader);

            var nextIndex = target.Index.RebindDocument(nextDoc);
            StationEditTrace.NoteLocalDocument();
            var result = StationReadResult.FromLocalEdit(nextDoc, nextIndex, target.ReaderDiagnostics, target.Repairs, rootHeader);
            result.LocalParent = committed;
            result.LocalDelta = inverseDelta;
            return result;
        }

        public static StationReadResult TryRestore(StationReadResult committed, StationReadResult target,
            string sourceId, out string code) =>
            TryRestore(committed, target, null, sourceId, out code);

        /// <summary>
        /// Compute the exact inverse <see cref="StationIndexDelta"/> in O(|forwardDelta|) from
        /// the before/after sharded indexes.
        /// </summary>
        public static StationIndexDelta BuildInverseDelta(StationIndex beforeIndex, StationIndex afterIndex,
            StationIndexDelta forwardDelta) {
            if (beforeIndex == null || afterIndex == null || forwardDelta == null) return null;
            var inverse = new StationIndexDelta {
                HasReorderedRecords = forwardDelta.HasReorderedRecords,
            };
            for (int i = 0; i < forwardDelta.ReorderedCells.Count; i++) {
                inverse.ReorderedCells.Add(forwardDelta.ReorderedCells[i]);
            }
            var seenCells = new HashSet<StationCellKey>();

            for (int i = 0; i < forwardDelta.RemovedCells.Count; i++) {
                var key = forwardDelta.RemovedCells[i];
                if (!seenCells.Add(key)) continue;
                if (beforeIndex.TryGetCellPage(key, out var prior, out int pageId)) {
                    inverse.ChangedCells.Add(prior);
                    inverse.CellPageIds[key] = pageId;
                }
            }
            for (int i = 0; i < forwardDelta.ChangedCells.Count; i++) {
                var key = forwardDelta.ChangedCells[i].Key;
                if (!seenCells.Add(key)) continue;
                if (beforeIndex.TryGetCellPage(key, out var prior, out int pageId)) {
                    inverse.ChangedCells.Add(prior);
                    inverse.CellPageIds[key] = pageId;
                } else {
                    inverse.RemovedCells.Add(key);
                }
            }

            var seenModules = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < forwardDelta.RemovedModules.Count; i++) {
                var id = forwardDelta.RemovedModules[i];
                if (string.IsNullOrEmpty(id) || !seenModules.Add(id)) continue;
                if (beforeIndex.TryGetModulePage(id, out var prior, out int pageId)) {
                    inverse.ChangedModules.Add(prior);
                    inverse.ModulePageIds[id] = pageId;
                }
            }
            for (int i = 0; i < forwardDelta.ChangedModules.Count; i++) {
                var id = forwardDelta.ChangedModules[i].Id;
                if (string.IsNullOrEmpty(id) || !seenModules.Add(id)) continue;
                if (beforeIndex.TryGetModulePage(id, out var prior, out int pageId)) {
                    inverse.ChangedModules.Add(prior);
                    inverse.ModulePageIds[id] = pageId;
                } else {
                    inverse.RemovedModules.Add(id);
                }
            }
            return inverse;
        }

        // ------------------------------------------------------------- cell projection

        static bool TryProjectCells(StationDocument previous, StationIndex previousIndex, StationCellPatch patch,
            StationIndexDelta delta, out StationRecordPages<StationCellRecord> nextPages, out string code) {
            using var projectSample = StationEditTrace.Measure("StationEdit.TryProjectCells");
            code = null;
            nextPages = previous.CellPages;
            if (patch.Writes.Count == 0) return true;

            var writtenKeys = new HashSet<StationCellKey>();
            for (int i = 0; i < patch.Writes.Count; i++) {
                var w = patch.Writes[i];
                if (w == null) continue;
                writtenKeys.Add(w.Key);
                if (previousIndex.HasUnsupportedBridgePillarSite(w.Key.X, w.Key.Y)) {
                    code = "local-bridge-pillars";
                    return false;
                }
            }
            if (writtenKeys.Count == 0) return true;

            var affected = Expand(writtenKeys, 1);
            StationEditTrace.AddScanned(affected.Count * 6);

            foreach (var key in affected) {
                if (previousIndex.HasDuplicateCell(key)) {
                    code = "local-duplicate-cell";
                    return false;
                }
            }

            var builder = previous.CellPages.ToBuilder();
            var working = new Dictionary<StationCellKey, WorkingCell>(affected.Count);

            WorkingCell EnsureWorking(StationCellKey key) {
                if (working.TryGetValue(key, out var cell)) return cell;
                previousIndex.TryGetCellPage(key, out var orig, out int origPage);
                cell = new WorkingCell {
                    Key = key,
                    OriginalRecord = orig,
                    OriginalPageId = origPage,
                    CurrentPageId = orig != null ? origPage : -1,
                    Json = orig != null ? JObject.Parse(orig.RawJson) : null,
                    Placeholder = orig,
                };
                working.Add(key, cell);
                return cell;
            }

            for (int i = 0; i < patch.Writes.Count; i++) {
                var write = patch.Writes[i];
                if (write == null) continue;
                var state = EnsureWorking(write.Key);
                bool hadCurrent = state.Json != null;

                if (!StationCellEdits.ApplyWriteToRecord(state.Json, write, out var updatedJson)) {
                    code = "bad-cell-write";
                    return false;
                }

                if (updatedJson == null) {
                    if (hadCurrent) {
                        var toRemove = state.Placeholder;
                        var matchKey = state.Key;
                        if (!builder.RemoveFromPage(state.CurrentPageId, c => ReferenceEquals(c, toRemove) || c.Key == matchKey)) {
                            code = "local-cell-mismatch";
                            return false;
                        }
                    }
                    state.Json = null;
                    state.CurrentPageId = -1;
                    state.Placeholder = null;
                } else if (!hadCurrent) {
                    var placeholder = new StationCellRecord(
                        write.Key.X, write.Key.Y, write.Key.Z, "full", "solid", "", null, null, "", "");
                    int appendedPage = builder.Append(placeholder);
                    state.Json = updatedJson;
                    state.CurrentPageId = appendedPage;
                    state.Placeholder = placeholder;
                } else {
                    state.Json = updatedJson;
                }
            }

            foreach (var key in affected) {
                if (working.ContainsKey(key)) continue;
                if (!previousIndex.TryGetCellPage(key, out var neighbour, out int pageId)) continue;
                working.Add(key, new WorkingCell {
                    Key = key,
                    OriginalRecord = neighbour,
                    OriginalPageId = pageId,
                    CurrentPageId = pageId,
                    Json = JObject.Parse(neighbour.RawJson),
                    Placeholder = neighbour,
                });
            }

            var preNormRecords = new Dictionary<StationCellKey, StationCellRecord>(working.Count);
            foreach (var pair in working) {
                if (pair.Value.Json != null) {
                    preNormRecords[pair.Key] = StationDocumentReader.BuildCellRecord(pair.Value.Json);
                }
            }

            StationCellRecord LookupNeighbour(int x, int y, int z) {
                var k = new StationCellKey(x, y, z);
                if (working.ContainsKey(k)) {
                    return preNormRecords.TryGetValue(k, out var rec) ? rec : null;
                }
                return previousIndex.GetNormalizationNeighbour(k);
            }

            foreach (var pair in working) {
                if (pair.Value.Json == null) continue;
                StationCellNormalization.NormalizeCellRecord(pair.Value.Json, LookupNeighbour);
            }

            foreach (var pair in working) {
                var key = pair.Key;
                var state = pair.Value;
                if (state.Json == null) {
                    if (state.OriginalRecord != null) {
                        delta.RemovedCells.Add(key);
                    }
                    continue;
                }

                var finalRecord = StationDocumentReader.BuildCellRecord(state.Json);
                bool sameAsOriginal = state.OriginalRecord != null &&
                                      state.CurrentPageId == state.OriginalPageId &&
                                      ReferenceEquals(state.Placeholder, state.OriginalRecord) &&
                                      string.Equals(state.OriginalRecord.RawJson, finalRecord.RawJson, StringComparison.Ordinal);
                if (sameAsOriginal) {
                    continue;
                }

                if (state.OriginalRecord != null && !ReferenceEquals(state.Placeholder, state.OriginalRecord)) {
                    delta.ReorderedCells.Add(key);
                }

                var targetPlaceholder = state.Placeholder;
                if (!builder.ReplaceInPage(state.CurrentPageId, c => ReferenceEquals(c, targetPlaceholder) || c.Key == key, finalRecord)) {
                    code = "local-cell-mismatch";
                    return false;
                }
                delta.ChangedCells.Add(finalRecord);
                delta.CellPageIds[key] = state.CurrentPageId;
            }

            StationEditTrace.AddCloned(builder.ClonedRecordCount + delta.ChangedCells.Count);
            nextPages = builder.Build(previous.CellPages);
            return true;
        }

        // ----------------------------------------------------------- module projection

        static bool TryProjectPatchModules(StationDocument previous, StationIndex previousIndex, StationCellPatch patch,
            StationIndexDelta delta, out StationRecordPages<StationModuleRecord> nextPages, out string code) {
            code = null;
            nextPages = previous.ModulePages;
            if (patch.ModuleReplaces.Count == 0 && patch.ModuleAdds.Count == 0 && patch.RemoveModuleIds.Count == 0) {
                return true;
            }
            using var modSample = StationEditTrace.Measure("StationEdit.TryProjectModules");

            var builder = previous.ModulePages.ToBuilder();
            var liveSlots = new Dictionary<string, (StationModuleRecord Record, int PageId)>(StringComparer.Ordinal);
            var removedIds = new HashSet<string>(StringComparer.Ordinal);
            string city = previous.City;

            bool TryLookupCurrent(string id, out StationModuleRecord rec, out int pageId) {
                if (removedIds.Contains(id)) { rec = null; pageId = -1; return false; }
                if (liveSlots.TryGetValue(id, out var local)) { rec = local.Record; pageId = local.PageId; return true; }
                return previousIndex.TryGetModulePage(id, out rec, out pageId);
            }

            for (int i = 0; i < patch.ModuleReplaces.Count; i++) {
                var draft = patch.ModuleReplaces[i];
                if (draft == null) continue;
                StationEditTrace.AddScanned(1);
                if (!TryLookupCurrent(draft.Id, out var before, out int pageId)) {
                    code = "missing-module";
                    return false;
                }
                var beforeRefusal = ModuleRefusal(before);
                if (beforeRefusal != null) { code = beforeRefusal; return false; }

                var saveJson = StationModuleEdits.ToSaveRecord(draft);
                var nextRefusal = ModuleRefusal(saveJson);
                if (nextRefusal != null) { code = nextRefusal; return false; }

                if (!TryBuildProjectedModule(saveJson, city, out var built, out code)) return false;
                var matchId = draft.Id;
                if (!builder.ReplaceInPage(pageId, m => string.Equals(m.Id, matchId, StringComparison.Ordinal), built)) {
                    code = "local-module-mismatch";
                    return false;
                }
                liveSlots[built.Id] = (built, pageId);
            }

            for (int i = 0; i < patch.ModuleAdds.Count; i++) {
                var draft = patch.ModuleAdds[i];
                if (draft == null) continue;
                StationEditTrace.AddScanned(1);
                if (TryLookupCurrent(draft.Id, out _, out _)) {
                    code = "duplicate-id";
                    return false;
                }
                var saveJson = StationModuleEdits.ToSaveRecord(draft);
                var nextRefusal = ModuleRefusal(saveJson);
                if (nextRefusal != null) { code = nextRefusal; return false; }

                if (!TryBuildProjectedModule(saveJson, city, out var built, out code)) return false;
                int appendedPage = builder.Append(built);
                removedIds.Remove(built.Id);
                liveSlots[built.Id] = (built, appendedPage);
            }

            for (int i = 0; i < patch.RemoveModuleIds.Count; i++) {
                var id = patch.RemoveModuleIds[i];
                if (string.IsNullOrEmpty(id)) continue;
                StationEditTrace.AddScanned(1);
                if (!TryLookupCurrent(id, out var existing, out int pageId)) continue;
                var beforeRefusal = ModuleRefusal(existing);
                if (beforeRefusal != null) { code = beforeRefusal; return false; }

                var matchId = id;
                if (!builder.RemoveFromPage(pageId, m => string.Equals(m.Id, matchId, StringComparison.Ordinal))) {
                    code = "local-module-mismatch";
                    return false;
                }
                liveSlots.Remove(id);
                removedIds.Add(id);
            }

            foreach (var id in removedIds) {
                if (previousIndex.TryGetModule(id, out _)) delta.RemovedModules.Add(id);
            }
            foreach (var pair in liveSlots) {
                delta.ChangedModules.Add(pair.Value.Record);
                delta.ModulePageIds[pair.Key] = pair.Value.PageId;
            }

            StationEditTrace.AddCloned(builder.ClonedRecordCount + delta.ChangedModules.Count);
            nextPages = builder.Build(previous.ModulePages);
            return true;
        }

        static bool TryProjectSingleModule(StationDocument previous, StationIndex previousIndex,
            StationModuleEditMode mode, StationEditDraft draft, string removeId, StationIndexDelta delta,
            out StationRecordPages<StationModuleRecord> nextPages, out string code) {
            using var modSample = StationEditTrace.Measure("StationEdit.TryProjectModules");
            code = null;
            nextPages = previous.ModulePages;
            var builder = previous.ModulePages.ToBuilder();
            string city = previous.City;

            switch (mode) {
                case StationModuleEditMode.Remove: {
                    StationEditTrace.AddScanned(1);
                    if (string.IsNullOrEmpty(removeId) || !previousIndex.TryGetModulePage(removeId, out var existing, out int pageId)) {
                        code = "not-found";
                        return false;
                    }
                    var refusal = ModuleRefusal(existing);
                    if (refusal != null) { code = refusal; return false; }

                    if (string.Equals(existing.Type, "platform-edge", StringComparison.Ordinal)) {
                        if (string.Equals(existing.Config.Text("psd"), "none", StringComparison.Ordinal)) {
                            code = "no-change";
                            return false;
                        }
                        JObject edgeJson;
                        try { edgeJson = JObject.Parse(existing.RawJson); } catch (JsonException) { code = "local-bad-module"; return false; }
                        var edgeCfg = edgeJson["cfg"] as JObject;
                        if (edgeCfg == null) { edgeCfg = new JObject(); edgeJson["cfg"] = edgeCfg; }
                        edgeCfg["psd"] = "none";
                        if (!TryBuildProjectedModule(edgeJson, city, out var updatedEdge, out code)) return false;
                        if (!builder.ReplaceInPage(pageId, m => string.Equals(m.Id, removeId, StringComparison.Ordinal), updatedEdge)) {
                            code = "local-module-mismatch";
                            return false;
                        }
                        delta.ChangedModules.Add(updatedEdge);
                        delta.ModulePageIds[updatedEdge.Id] = pageId;

                        string fromId = existing.Config.Text("from");
                        string side = existing.Config.Text("side");
                        if (fromId.Length > 0 && (side == "left" || side == "right") &&
                            previousIndex.TryGetModulePage(fromId, out var trackRec, out int trackPageId) &&
                            trackRec != null && string.Equals(trackRec.Type, "track", StringComparison.Ordinal)) {
                            var trackRefusal = ModuleRefusal(trackRec);
                            if (trackRefusal != null) { code = trackRefusal; return false; }
                            JObject trackJson;
                            try { trackJson = JObject.Parse(trackRec.RawJson); } catch (JsonException) { code = "local-bad-module"; return false; }
                            var trackCfg = trackJson["cfg"] as JObject;
                            if (trackCfg == null) { trackCfg = new JObject(); trackJson["cfg"] = trackCfg; }
                            var sides = trackCfg["removedPsdSides"] as JArray ?? new JArray();
                            bool exists = false;
                            for (int i = 0; i < sides.Count; i++) {
                                if (string.Equals((string)sides[i], side, StringComparison.Ordinal)) { exists = true; break; }
                            }
                            if (!exists) {
                                sides.Add(side);
                                trackCfg["removedPsdSides"] = sides;
                                if (!TryBuildProjectedModule(trackJson, city, out var updatedTrack, out code)) return false;
                                if (!builder.ReplaceInPage(trackPageId, m => string.Equals(m.Id, fromId, StringComparison.Ordinal), updatedTrack)) {
                                    code = "local-module-mismatch";
                                    return false;
                                }
                                delta.ChangedModules.Add(updatedTrack);
                                delta.ModulePageIds[updatedTrack.Id] = trackPageId;
                            }
                        }
                        break;
                    }

                    if (!builder.RemoveFromPage(pageId, m => string.Equals(m.Id, removeId, StringComparison.Ordinal))) {
                        code = "local-module-mismatch";
                        return false;
                    }
                    delta.RemovedModules.Add(removeId);
                    break;
                }
                case StationModuleEditMode.Add: {
                    if (draft == null) { code = "bad-payload"; return false; }
                    StationEditTrace.AddScanned(1);
                    if (previousIndex.TryGetModule(draft.Id, out _)) {
                        code = "duplicate-id";
                        return false;
                    }
                    var saveJson = StationModuleEdits.ToSaveRecord(draft);
                    var refusal = ModuleRefusal(saveJson);
                    if (refusal != null) { code = refusal; return false; }
                    if (!TryBuildProjectedModule(saveJson, city, out var built, out code)) return false;

                    int pageId = builder.Append(built);
                    delta.ChangedModules.Add(built);
                    delta.ModulePageIds[built.Id] = pageId;
                    break;
                }
                default: {
                    if (draft == null) { code = "bad-payload"; return false; }
                    StationEditTrace.AddScanned(1);
                    string targetId = draft.SourceId.Length > 0 ? draft.SourceId : draft.Id;
                    if (string.IsNullOrEmpty(targetId) || !previousIndex.TryGetModulePage(targetId, out var existing, out int pageId)) {
                        code = "not-found";
                        return false;
                    }
                    var beforeRefusal = ModuleRefusal(existing);
                    if (beforeRefusal != null) { code = beforeRefusal; return false; }

                    var movedJson = JObject.Parse(existing.RawJson);
                    StationModuleEdits.ApplyMove(movedJson, draft);
                    var afterRefusal = ModuleRefusal(movedJson);
                    if (afterRefusal != null) { code = afterRefusal; return false; }
                    if (!TryBuildProjectedModule(movedJson, city, out var built, out code)) return false;

                    if (!builder.ReplaceInPage(pageId, m => string.Equals(m.Id, targetId, StringComparison.Ordinal), built)) {
                        code = "local-module-mismatch";
                        return false;
                    }
                    delta.ChangedModules.Add(built);
                    delta.ModulePageIds[built.Id] = pageId;
                    break;
                }
            }

            StationEditTrace.AddCloned(builder.ClonedRecordCount + delta.ChangedModules.Count);
            nextPages = builder.Build(previous.ModulePages);
            return true;
        }

        static bool TryBuildProjectedModule(JObject moduleJson, string city, out StationModuleRecord record, out string code) {
            record = null;
            code = null;
            if (string.Equals(StationDocumentReader.Str(moduleJson?["type"]), "sign", StringComparison.Ordinal)) {
                try {
                    moduleJson = JObject.Parse(StationSignRepair.NormalizeJson(moduleJson.ToString(Formatting.None)));
                } catch (NotSupportedException) {
                    code = "local-sign-repair";
                    return false;
                } catch (JsonException) {
                    code = "local-sign-repair";
                    return false;
                } catch (FormatException) {
                    code = "local-sign-repair";
                    return false;
                }
            }
            try {
                record = StationDocumentReader.BuildModule(moduleJson, city);
                return true;
            } catch (StationRejectedException) {
                code = "local-unsupported-record";
                return false;
            } catch (FormatException) {
                code = "local-bad-module";
                return false;
            }
        }

        // ------------------------------------------------------------- assembly & header

        static StationReadResult BuildResult(StationReadResult committed, JObject rootHeader, string savedAt,
            StationRecordPages<StationCellRecord> cellPages, StationRecordPages<StationModuleRecord> modulePages,
            StationIndexDelta delta, string sourceId, out string code) {
            using var buildSample = StationEditTrace.Measure("StationEdit.Build");
            code = null;
            var previous = committed.Document;
            var rawRootJson = StationDocumentReader.CanonicalRootJson(rootHeader);

            var document = new StationDocument(
                previous.Name, previous.NameEn, previous.City, previous.Seed,
                previous.LevelBase, previous.StoreyHeight, previous.Day,
                cellPages, modulePages, previous.Lines,
                previous.DroppedCells, previous.DroppedModules,
                new StationSource(sourceId ?? "", ""), savedAt,
                null,
                doc => StationDocumentReader.SerializeEnvelope(rootHeader, doc.SavedAt, doc),
                doc => StationDocumentReader.HashEnvelope(rootHeader, doc.SavedAt, doc),
                rawRootJson);
            StationDocumentReader.RegisterRootHeader(document, rootHeader);

            if (!StationIndex.TryCreateIncremental(committed.Index, document, delta, out var index, out var rejection)) {
                code = rejection?.Code ?? "local-index-failed";
                return null;
            }

            StationEditTrace.NoteLocalDocument();
            var result = StationReadResult.FromLocalEdit(document, index, committed.ReaderDiagnostics, committed.Repairs, rootHeader);
            result.LocalParent = committed;
            result.LocalDelta = delta;
            return result;
        }

        static bool TryCloneRootHeader(StationReadResult committed, out JObject rootHeader, out string savedAt, out string code,
            bool preserveSavedAt = false) {
            code = null;
            rootHeader = null;
            savedAt = preserveSavedAt && !string.IsNullOrEmpty(committed?.Document?.SavedAt)
                ? committed.Document.SavedAt
                : StationDocumentReader.FormatSavedAt(DateTimeOffset.UtcNow);
            if (committed.Envelope != null) {
                rootHeader = new JObject();
                foreach (var prop in committed.Envelope.Properties()) {
                    if (prop.Name == "static") continue;
                    rootHeader[prop.Name] = prop.Value.DeepClone();
                }
                rootHeader["savedAt"] = savedAt;
                return true;
            }
            var json = committed.Document?.NormalizedJson;
            if (string.IsNullOrEmpty(json)) { code = "local-no-envelope"; return false; }
            try {
                var parsed = JObject.Parse(json);
                parsed.Remove("static");
                parsed["savedAt"] = savedAt;
                rootHeader = parsed;
                return true;
            } catch (JsonException) {
                code = "local-no-envelope";
                return false;
            }
        }

        /// <summary>
        /// True when every root-envelope property outside the fields carried by a Bridge v2
        /// commit delta (<c>savedAt</c>, <c>name</c>, <c>nameEn</c>, <c>city</c>,
        /// <c>levelBase</c>, <c>storeyHeight</c>, and <c>static.{cells,modules,lines}</c>)
        /// is identical between <paramref name="a"/> and <paramref name="b"/>. When false,
        /// the host must publish a complete v1 envelope rather than a delta (plan 40 §2).
        /// </summary>
        public static bool CanRepresentHeaderInDelta(JObject a, JObject b) {
            if (a == null || b == null) return false;
            return SameHeaderMetadata(a, b, allowLevelAndStorey: true);
        }

        static bool SameHeaderMetadata(JObject a, JObject b, bool allowLevelAndStorey = false) {
            bool Ignored(string name) =>
                name == "savedAt" || name == "static" ||
                name == "name" || name == "nameEn" ||
                name == "city" || name == "cityStyle" ||
                (allowLevelAndStorey && (name == "levelBase" || name == "storeyHeight"));
            foreach (var prop in a.Properties()) {
                if (Ignored(prop.Name)) continue;
                if (!JToken.DeepEquals(prop.Value, b[prop.Name])) return false;
            }
            foreach (var prop in b.Properties()) {
                if (Ignored(prop.Name)) continue;
                if (!JToken.DeepEquals(a[prop.Name], prop.Value)) return false;
            }
            if (a["static"] is JObject sa && b["static"] is JObject sb) {
                foreach (var prop in sa.Properties()) {
                    if (prop.Name == "cells" || prop.Name == "modules" || prop.Name == "lines") continue;
                    if (!JToken.DeepEquals(prop.Value, sb[prop.Name])) return false;
                }
                foreach (var prop in sb.Properties()) {
                    if (prop.Name == "cells" || prop.Name == "modules" || prop.Name == "lines") continue;
                    if (!JToken.DeepEquals(sa[prop.Name], prop.Value)) return false;
                }
            }
            return true;
        }

        static StationIndexDelta ComputeDeltaBetween(StationIndex current, StationIndex target) {
            var delta = new StationIndexDelta();
            var currentCellOrder = new Dictionary<StationCellKey, int>(current.Document.CellCount);
            int cellOrd = 0;
            foreach (var cell in current.Document.CellPages) {
                currentCellOrder[cell.Key] = cellOrd++;
                if (target.GetCell(cell.Key) == null) delta.RemovedCells.Add(cell.Key);
            }
            int lastSurvivingCellOrd = -1;
            foreach (var cell in target.Document.CellPages) {
                var prior = current.GetCell(cell.Key);
                if (prior != null && currentCellOrder.TryGetValue(cell.Key, out int prevOrd)) {
                    if (prevOrd < lastSurvivingCellOrd) delta.HasReorderedRecords = true;
                    lastSurvivingCellOrd = prevOrd;
                }
                if (prior == null || !string.Equals(prior.RawJson, cell.RawJson, StringComparison.Ordinal)) {
                    delta.ChangedCells.Add(cell);
                    if (target.TryGetCellPage(cell.Key, out _, out int p)) delta.CellPageIds[cell.Key] = p;
                }
            }
            var currentModOrder = new Dictionary<string, int>(current.Document.ModuleCount, StringComparer.Ordinal);
            int modOrd = 0;
            foreach (var mod in current.Document.ModulePages) {
                currentModOrder[mod.Id] = modOrd++;
                if (target.GetModule(mod.Id) == null) delta.RemovedModules.Add(mod.Id);
            }
            int lastSurvivingModOrd = -1;
            foreach (var mod in target.Document.ModulePages) {
                var prior = current.GetModule(mod.Id);
                if (prior != null && currentModOrder.TryGetValue(mod.Id, out int prevOrd)) {
                    if (prevOrd < lastSurvivingModOrd) delta.HasReorderedRecords = true;
                    lastSurvivingModOrd = prevOrd;
                }
                if (prior == null || !string.Equals(prior.RawJson, mod.RawJson, StringComparison.Ordinal)) {
                    delta.ChangedModules.Add(mod);
                    if (target.TryGetModulePage(mod.Id, out _, out int p)) delta.ModulePageIds[mod.Id] = p;
                }
            }
            return delta;
        }

        // ------------------------------------------------------------- whitelist refusals

        static string ModuleRefusal(JObject record) {
            if (record == null) return "local-bad-module";
            var type = StationDocumentReader.Str(record["type"]);
            if (type.Length == 0) return "local-unsupported-record";
            if (!StationGridRepair.KeepsModule(record)) return "local-off-grid";
            var cfg = record["cfg"] as JObject;
            if (type == "billboard" || type == "tv" || type == "busstop") {
                return cfg != null && cfg.Property("poster") != null ? null : "local-ad-poster";
            }
            if (type == "shop" || type == "retail" || type == "booth") {
                return cfg != null && cfg["stocked"]?.Type == JTokenType.Boolean && (bool)cfg["stocked"]
                    ? null : "local-room-furniture";
            }
            if (type == "track" && cfg != null &&
                cfg["bridge"]?.Type == JTokenType.Boolean && (bool)cfg["bridge"]) return "local-bridge-pillars";
            if (type == "pillar" && cfg != null && StationDocumentReader.Str(cfg["bridgeId"]).Length > 0)
                return "local-bridge-pillars";
            return null;
        }

        static string ModuleRefusal(StationModuleRecord record) {
            if (record == null) return null;
            var type = record.Type;
            if (type == "billboard" || type == "tv" || type == "busstop") {
                return record.Config.Has("poster") ? null : "local-ad-poster";
            }
            if (type == "shop" || type == "retail" || type == "booth") {
                return record.Config.Bool("stocked") ? null : "local-room-furniture";
            }
            if (type == "track" && record.Config.Bool("bridge")) return "local-bridge-pillars";
            if (type == "pillar" && record.Config.Text("bridgeId").Length > 0) return "local-bridge-pillars";
            return null;
        }

        // -------------------------------------------------------------- ring helpers

        static HashSet<StationCellKey> Expand(HashSet<StationCellKey> source, int rings) {
            var current = new HashSet<StationCellKey>(source);
            for (int ring = 0; ring < rings; ring++) {
                var next = new HashSet<StationCellKey>(current);
                foreach (var key in current) {
                    foreach (var step in Neighbourhood) {
                        next.Add(new StationCellKey(key.X + step.X, key.Y + step.Y, key.Z + step.Z));
                    }
                }
                current = next;
            }
            return current;
        }
    }
}
