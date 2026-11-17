using System;
using System.Collections.Generic;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>
    /// The local-edit half of plan 30 §3. A whitelisted cell or module patch is applied to the
    /// committed envelope **tree** and installed by projecting only the records it touched,
    /// instead of serializing the whole save, re-parsing it, re-running every load-time repair
    /// and re-indexing the station.
    ///
    /// Everything this path cannot derive exactly like <see cref="StationDocumentReader.Read"/>
    /// is refused with a stable <c>local-*</c> code, and the caller falls back to the complete
    /// envelope path with the identical result. That is: line adds; a record a load-time repair
    /// owns (a sign's board layout, an unpostered screen, an unstocked room, a bridge track or
    /// its pillars); a record the grid repair would drop; a coordinate that already carries two
    /// saved records; and any patch the committed document does not match.
    ///
    /// Unknown fields survive because the envelope is patched surgically with the same writer
    /// the text path uses (<see cref="StationCellEdits.ApplyToEnvelope"/> /
    /// <see cref="StationModuleEdits.ApplyToEnvelope"/>), and every record the patch did not
    /// name is carried over as the exact typed instance the committed document holds.
    /// </summary>
    public static class StationLocalEdit {
        /// <summary>
        /// The per-cell rule <see cref="StationCellNormalization.NormalizeJson"/> applies reads
        /// the six axis neighbours of a cell and, one ring further out, the solids that decide
        /// whether a face is covered. A written cell therefore normalises its one ring and needs
        /// its two ring for the answer.
        /// </summary>
        static readonly (int X, int Y, int Z)[] Neighbourhood = {
            (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
        };

        // --------------------------------------------------------------- cell patches

        /// <summary>
        /// Apply one cell patch locally. Returns the next read result, or null with a
        /// <c>local-*</c> (or the writer's own) code when the caller must use the full path.
        /// </summary>
        public static StationReadResult TryApplyCells(StationReadResult committed, StationCellPatch patch,
            string sourceId, out string code) {
            if (!TryPatchEnvelope(committed, patch, out var envelope, out code)) return null;
            return TryProject(committed, envelope, patch, sourceId, out code);
        }

        /// <summary>
        /// Step one of the local path: clone the committed normalized envelope and write the
        /// patch into the clone with the same surgical writer the text path uses. No record is
        /// projected yet, so the caller can time or defer the two halves separately.
        /// </summary>
        public static bool TryPatchEnvelope(StationReadResult committed, StationCellPatch patch,
            out JObject envelope, out string code) {
            code = null;
            envelope = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-document"; return false; }
            if (patch == null || (!patch.HasWork && patch.RemoveModuleIds.Count == 0)) { code = "no-change"; return false; }
            // A line record is a whole-document fact the reader repairs; never a local write.
            if (patch.LineAdds.Count > 0) { code = "local-line-adds"; return false; }
            if (!TryCloneEnvelope(committed, out envelope, out code)) return false;
            if (!StationCellEdits.ApplyToEnvelope(envelope, patch, out code)) return false;
            return true;
        }

        /// <summary>
        /// Step two of the local path: project a patched envelope into the next typed read result.
        /// The envelope must be the one <see cref="TryPatchEnvelope"/> produced for this patch.
        /// </summary>
        public static StationReadResult TryProject(StationReadResult committed, JObject envelope,
            StationCellPatch patch, string sourceId, out string code) {
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-document"; return null; }
            if (patch == null || envelope == null) { code = "no-document"; return null; }
            if (patch.LineAdds.Count > 0) { code = "local-line-adds"; return null; }
            return Build(committed, envelope, WrittenCells(patch), AffectedModules(patch), sourceId, out code);
        }

        static HashSet<StationCellKey> WrittenCells(StationCellPatch patch) {
            var written = new HashSet<StationCellKey>();
            for (int i = 0; i < patch.Writes.Count; i++) {
                var write = patch.Writes[i];
                if (write != null) written.Add(write.Key);
            }
            return written;
        }

        static HashSet<string> AffectedModules(StationCellPatch patch) {
            var affected = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < patch.ModuleAdds.Count; i++)
                if (patch.ModuleAdds[i] != null) affected.Add(patch.ModuleAdds[i].Id);
            for (int i = 0; i < patch.ModuleReplaces.Count; i++)
                if (patch.ModuleReplaces[i] != null) affected.Add(patch.ModuleReplaces[i].Id);
            for (int i = 0; i < patch.RemoveModuleIds.Count; i++)
                if (!string.IsNullOrEmpty(patch.RemoveModuleIds[i])) affected.Add(patch.RemoveModuleIds[i]);
            return affected;
        }

        // ------------------------------------------------------------- module edits

        /// <summary>
        /// Apply one module add/replace/remove locally. Same contract as
        /// <see cref="TryApplyCells"/>: the next read result, or null with a code.
        /// </summary>
        public static StationReadResult TryApplyModule(StationReadResult committed, StationModuleEditMode mode,
            StationEditDraft draft, string removeId, string sourceId, out string code) {
            if (!TryPatchEnvelope(committed, mode, draft, removeId, out var envelope, out code)) return null;
            return TryProject(committed, envelope, mode, draft, removeId, sourceId, out code);
        }

        /// <summary>Step one for a module verb: clone the committed envelope and write one record.</summary>
        public static bool TryPatchEnvelope(StationReadResult committed, StationModuleEditMode mode,
            StationEditDraft draft, string removeId, out JObject envelope, out string code) {
            code = null;
            envelope = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-document"; return false; }
            if (!TryCloneEnvelope(committed, out envelope, out code)) return false;
            if (!StationModuleEdits.ApplyToEnvelope(envelope, mode, draft, removeId, out code)) return false;
            return true;
        }

        /// <summary>Step two for a module verb: project the patched envelope.</summary>
        public static StationReadResult TryProject(StationReadResult committed, JObject envelope,
            StationModuleEditMode mode, StationEditDraft draft, string removeId, string sourceId, out string code) {
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-document"; return null; }
            if (envelope == null) { code = "no-document"; return null; }
            // A module verb names exactly one record; there is no cell ring to repair.
            return Build(committed, envelope, NoCells, AffectedModules(mode, draft, removeId), sourceId, out code);
        }

        static readonly HashSet<StationCellKey> NoCells = new HashSet<StationCellKey>();

        static HashSet<string> AffectedModules(StationModuleEditMode mode, StationEditDraft draft, string removeId) {
            string id;
            switch (mode) {
                case StationModuleEditMode.Remove:
                    id = removeId ?? "";
                    break;
                case StationModuleEditMode.Add:
                    id = draft?.Id ?? "";
                    break;
                default:
                    id = draft == null ? "" : (draft.SourceId.Length > 0 ? draft.SourceId : draft.Id);
                    break;
            }
            var affected = new HashSet<string>(StringComparer.Ordinal);
            if (id.Length > 0) affected.Add(id);
            return affected;
        }

        // ------------------------------------------------------------------- shared

        /// <summary>
        /// The committed normalized envelope as a tree the caller may patch. It is cloned: the
        /// history frame and the previous document both still refer to the original.
        /// </summary>
        static bool TryCloneEnvelope(StationReadResult committed, out JObject envelope, out string code) {
            code = null;
            envelope = null;
            var retained = committed.Envelope;
            if (retained != null) {
                envelope = (JObject)retained.DeepClone();
            } else {
                var json = committed.Document?.NormalizedJson;
                if (string.IsNullOrEmpty(json)) { code = "local-no-envelope"; return false; }
                try { envelope = JObject.Parse(json); } catch (JsonException) { code = "local-no-envelope"; return false; }
            }
            // A local edit is one revision of the same station: stamp the envelope the way the
            // save writer does so the committed document carries the edit's own time, exactly as
            // the full path's `Write(document, UtcNow)` history frame does.
            StationDocumentReader.StampSavedAt(envelope, DateTimeOffset.UtcNow);
            return true;
        }

        static StationReadResult Build(StationReadResult committed, JObject envelope, HashSet<StationCellKey> writtenCells,
            HashSet<string> affectedModules, string sourceId, out string code) {
            code = null;
            var previous = committed.Document;
            var previousIndex = committed.Index;
            if (!(envelope["static"] is JObject state)) { code = "local-bad-envelope"; return null; }
            var cellsNode = state["cells"] as JArray;
            if (cellsNode == null) { cellsNode = new JArray(); state["cells"] = cellsNode; }
            var modulesNode = state["modules"] as JArray ?? new JArray();
            var city = StationDocumentReader.Str(state["city"]);

            var delta = new StationIndexDelta();
            if (!TryProjectCells(previous, previousIndex, cellsNode, writtenCells, delta, out var cells, out code)) return null;
            if (!TryProjectModules(committed, modulesNode, city, affectedModules, delta, out var modules, out code)) return null;
            for (int i = 0; i < modules.Length; i++) {
                if (modules[i] != null && affectedModules.Contains(modules[i].Id)) delta.ChangedModules.Add(modules[i]);
            }

            var savedAt = StationDocumentReader.Str(envelope["savedAt"]);
            if (savedAt.Length == 0) savedAt = StationDocumentReader.FixedSavedAt;
            var normalized = envelope.ToString(Formatting.None);
            var lines = new StationLineRecord[previous.LineCount];
            for (int i = 0; i < lines.Length; i++) lines[i] = previous.Lines[i];
            var document = new StationDocument(
                previous.Name, previous.NameEn, previous.City, previous.Seed,
                previous.LevelBase, previous.StoreyHeight, previous.Day, cells, modules, lines,
                previous.DroppedCells, previous.DroppedModules,
                new StationSource(sourceId ?? "", StationDocumentReader.Hash(normalized)), savedAt, normalized);

            StationIndex index;
            StationRejection rejection;
            if (!StationIndex.TryCreateIncremental(previousIndex, document, delta, out index, out rejection)) {
                code = rejection?.Code ?? "local-index-failed";
                return null;
            }
            return StationReadResult.FromLocalEdit(document, index, committed.ReaderDiagnostics, committed.Repairs, envelope);
        }

        /// <summary>
        /// Rebuild the typed cell array from the patched envelope: the records the patch wrote
        /// (and the ring the cell repair may have changed around them) are projected, every other
        /// record is the committed document's own instance, in the patched array's own order.
        /// </summary>
        static bool TryProjectCells(StationDocument previous, StationIndex previousIndex, JArray cellsNode,
            HashSet<StationCellKey> writtenCells, StationIndexDelta delta, out StationCellRecord[] cells, out string code) {
            code = null;
            cells = new StationCellRecord[cellsNode.Count];
            if (writtenCells.Count == 0) {
                if (cellsNode.Count != previous.CellCount) { code = "local-cell-mismatch"; return false; }
                for (int i = 0; i < cellsNode.Count; i++) {
                    if (!(cellsNode[i] is JObject cell) || StationDocumentReader.CellKeyOf(cell) != previous.Cells[i].Key) {
                        code = "local-cell-mismatch";
                        return false;
                    }
                    cells[i] = previous.Cells[i];
                }
                return true;
            }

            var affected = Expand(writtenCells, 1);
            var lookup = Expand(writtenCells, 2);

            // A coordinate with two saved records keeps its own first-record rule in the index and
            // its last-solid rule in the cell repair. Neither is a one-record delta, so refuse.
            if (!NoDuplicate(previous, affected, out code)) return false;

            var raw = new Dictionary<StationCellKey, JObject>();
            var positions = new Dictionary<StationCellKey, int>();
            var records = new Dictionary<StationCellKey, StationCellRecord>();
            int cursor = 0;
            for (int i = 0; i < cellsNode.Count; i++) {
                if (!(cellsNode[i] is JObject cell)) { code = "local-bad-cell"; return false; }
                var key = StationDocumentReader.CellKeyOf(cell);
                if (affected.Contains(key)) {
                    if (raw.ContainsKey(key)) { code = "local-duplicate-cell"; return false; }
                    var record = StationDocumentReader.BuildCellRecord(cell);
                    cells[i] = record;
                    records[key] = record;
                    raw[key] = cell;
                    positions[key] = i;
                    continue;
                }
                while (cursor < previous.CellCount && affected.Contains(previous.Cells[cursor].Key)) cursor++;
                if (cursor >= previous.CellCount) { code = "local-cell-mismatch"; return false; }
                var reuse = previous.Cells[cursor++];
                cells[i] = reuse;
                if (lookup.Contains(key)) records[key] = reuse;
            }
            while (cursor < previous.CellCount && affected.Contains(previous.Cells[cursor].Key)) cursor++;
            if (cursor != previous.CellCount) { code = "local-cell-mismatch"; return false; }

            // The cell repair, exactly as a full read runs it, for the records this edit touched
            // and the ring whose faces it can cover. The lookup carries the new state, so a
            // written solid covers a neighbour's face and a removed one stops covering it.
            foreach (var pair in raw) {
                StationCellNormalization.NormalizeCellRecord(pair.Value, (x, y, z) =>
                    records.TryGetValue(new StationCellKey(x, y, z), out var neighbour) ? neighbour : null);
            }
            foreach (var pair in raw) {
                var record = StationDocumentReader.BuildCellRecord(pair.Value);
                cells[positions[pair.Key]] = record;
                records[pair.Key] = record;
            }

            foreach (var key in affected) {
                var before = previousIndex.GetCell(key);
                records.TryGetValue(key, out var after);
                if (before == null && after == null) continue;
                if (after == null) { delta.RemovedCells.Add(key); continue; }
                delta.ChangedCells.Add(after);
            }
            return true;
        }

        /// <summary>
        /// Refuse a written/neighbouring coordinate that carries more than one saved record: the
        /// committed document keeps such duplicates in <c>Cells</c> but indexes only the first.
        /// </summary>
        static bool NoDuplicate(StationDocument previous, HashSet<StationCellKey> affected, out string code) {
            code = null;
            var counts = new Dictionary<StationCellKey, int>();
            for (int i = 0; i < previous.CellCount; i++) {
                var key = previous.Cells[i].Key;
                if (!affected.Contains(key)) continue;
                if (counts.TryGetValue(key, out var count)) counts[key] = count + 1;
                else counts[key] = 1;
            }
            foreach (var pair in counts) {
                if (pair.Value > 1) { code = "local-duplicate-cell"; return false; }
            }
            return true;
        }

        /// <summary>
        /// Rebuild the typed module array from the patched envelope. A module the patch named is
        /// refused when a load-time repair owns it, and projected otherwise; every other module
        /// is the committed document's own instance, in the patched array's order.
        /// </summary>
        static bool TryProjectModules(StationReadResult committed, JArray modulesNode, string city,
            HashSet<string> affectedModules, StationIndexDelta delta, out StationModuleRecord[] modules, out string code) {
            code = null;
            var previous = committed.Document;
            var previousIndex = committed.Index;
            modules = new StationModuleRecord[modulesNode.Count];
            if (affectedModules.Count == 0) {
                if (modulesNode.Count != previous.ModuleCount) { code = "local-module-mismatch"; return false; }
                for (int i = 0; i < modulesNode.Count; i++) {
                    if (!(modulesNode[i] is JObject module) ||
                        !string.Equals(StationDocumentReader.Str(module["id"]), previous.Modules[i].Id, StringComparison.Ordinal)) {
                        code = "local-module-mismatch";
                        return false;
                    }
                    modules[i] = previous.Modules[i];
                }
                return true;
            }
            // A *removed* record still has to be one the local path may touch: a bridge track or a
            // bridge-owned pillar is repaired on every read (plan 30 §3).
            foreach (var id in affectedModules) {
                var before = previousIndex.GetModule(id);
                if (before == null) continue;
                var refusal = ModuleRefusal(before);
                if (refusal != null) { code = refusal; return false; }
            }

            var found = new HashSet<string>(StringComparer.Ordinal);
            int cursor = 0;
            for (int i = 0; i < modulesNode.Count; i++) {
                if (!(modulesNode[i] is JObject module)) { code = "local-bad-module"; return false; }
                var id = StationDocumentReader.Str(module["id"]);
                if (affectedModules.Contains(id)) {
                    var refusal = ModuleRefusal(module);
                    if (refusal != null) { code = refusal; return false; }
                    try {
                        modules[i] = StationDocumentReader.BuildModule(module, city);
                    } catch (StationRejectedException) {
                        // The full reader refuses the same record (or the repairs would drop it);
                        // let the complete path produce its own answer.
                        code = "local-unsupported-record";
                        return false;
                    } catch (FormatException) {
                        code = "local-bad-module";
                        return false;
                    }
                    found.Add(id);
                    continue;
                }
                while (cursor < previous.ModuleCount && affectedModules.Contains(previous.Modules[cursor].Id)) cursor++;
                if (cursor >= previous.ModuleCount) { code = "local-module-mismatch"; return false; }
                modules[i] = previous.Modules[cursor++];
            }
            while (cursor < previous.ModuleCount && affectedModules.Contains(previous.Modules[cursor].Id)) cursor++;
            if (cursor != previous.ModuleCount) { code = "local-module-mismatch"; return false; }
            foreach (var id in affectedModules) {
                if (found.Contains(id)) continue;
                if (previousIndex.GetModule(id) != null) delta.RemovedModules.Add(id);
            }
            return true;
        }

        /// <summary>
        /// Why a saved record cannot take the local path: a load-time repair in
        /// <see cref="StationSaveV1.Read"/> would rewrite or drop it, so only the full read
        /// can say what the record becomes.
        /// </summary>
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

        /// <summary>The same refusal over an already-typed record (a removal).</summary>
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
