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
            var inverse = new StationIndexDelta();
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

        static bool SameHeaderMetadata(JObject a, JObject b) {
            foreach (var prop in a.Properties()) {
                if (prop.Name == "savedAt" || prop.Name == "static") continue;
                if (!JToken.DeepEquals(prop.Value, b[prop.Name])) return false;
            }
            foreach (var prop in b.Properties()) {
                if (prop.Name == "savedAt" || prop.Name == "static") continue;
                if (!JToken.DeepEquals(a[prop.Name], prop.Value)) return false;
            }
            if (a["static"] is JObject sa && b["static"] is JObject sb) {
                foreach (var prop in sa.Properties()) {
                    if (prop.Name == "cells" || prop.Name == "modules") continue;
                    if (!JToken.DeepEquals(prop.Value, sb[prop.Name])) return false;
                }
                foreach (var prop in sb.Properties()) {
                    if (prop.Name == "cells" || prop.Name == "modules") continue;
                    if (!JToken.DeepEquals(sa[prop.Name], prop.Value)) return false;
                }
            }
            return true;
        }

        static StationIndexDelta ComputeDeltaBetween(StationIndex current, StationIndex target) {
            var delta = new StationIndexDelta();
            foreach (var cell in current.Document.CellPages) {
                if (target.GetCell(cell.Key) == null) delta.RemovedCells.Add(cell.Key);
            }
            foreach (var cell in target.Document.CellPages) {
                var prior = current.GetCell(cell.Key);
                if (prior == null || !string.Equals(prior.RawJson, cell.RawJson, StringComparison.Ordinal)) {
                    delta.ChangedCells.Add(cell);
                    if (target.TryGetCellPage(cell.Key, out _, out int p)) delta.CellPageIds[cell.Key] = p;
                }
            }
            foreach (var mod in current.Document.ModulePages) {
                if (target.GetModule(mod.Id) == null) delta.RemovedModules.Add(mod.Id);
            }
            foreach (var mod in target.Document.ModulePages) {
                var prior = current.GetModule(mod.Id);
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
            if (type == "sign") return "local-sign-repair";
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
            if (type == "sign") return "local-sign-repair";
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
