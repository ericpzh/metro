using System;
using System.Collections.Generic;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>
    /// The document half of the cell tools (plan 27 §3). <see cref="Metro.Build.StationCellPlanner"/>
    /// names the cells and the hosted modules; this file writes exactly those records into
    /// the committed v1 envelope and hands the complete envelope back to
    /// <c>StationGameHost.ApplyDocumentEdit</c>, which owns the one atomic revision bump.
    ///
    /// It patches, never re-serializes: a cell keeps its authored zone, room, finish and any
    /// field this port has not met, a merged cut appends its tag instead of replacing the
    /// record, and a module the gesture did not name is untouched. Nothing here reads a
    /// scene, resolves a cell or decides whether an edit is allowed.
    /// </summary>
    public static class StationCellEdits {
        /// <summary>
        /// Apply one patch to the committed v1 envelope text. Returns the complete new
        /// envelope; a malformed save or a missing record returns null with a stable code,
        /// leaving the caller's document untouched.
        /// </summary>
        public static string Apply(string savedJson, StationCellPatch patch, out string code) {
            code = null;
            if (patch == null || (!patch.HasWork && patch.RemoveModuleIds.Count == 0)) {
                code = "no-change";
                return null;
            }
            if (string.IsNullOrEmpty(savedJson)) { code = "no-document"; return null; }
            JObject envelope;
            try { envelope = JObject.Parse(savedJson); } catch (JsonException) { code = "parse-failed"; return null; }
            if (!ApplyToEnvelope(envelope, patch, out code)) return null;
            return envelope.ToString(Formatting.None);
        }

        /// <summary>
        /// The surgical half: patch a parsed v1 envelope **in place** and leave every record the
        /// patch did not name exactly as it was (plan 30 §2). The caller owns the tree, so a
        /// committed document's envelope is cloned before it is handed here; a refusal can
        /// leave the clone half-patched, and the caller drops it.
        /// </summary>
        public static bool ApplyToEnvelope(JObject envelope, StationCellPatch patch, out string code) {
            code = null;
            if (patch == null || (!patch.HasWork && patch.RemoveModuleIds.Count == 0)) { code = "no-change"; return false; }
            if (envelope == null) { code = "no-document"; return false; }
            if (!(envelope["static"] is JObject state)) { code = "parse-failed"; return false; }
            if (!(state["cells"] is JArray cells)) {
                cells = new JArray();
                state["cells"] = cells;
            }
            if (patch.Writes.Count > 0) {
                foreach (var write in patch.Writes) {
                    if (!ApplyWrite(cells, write)) { code = "bad-cell-write"; return false; }
                }
            }
            if (patch.ModuleReplaces.Count > 0) {
                if (!(state["modules"] is JArray placed)) {
                    placed = new JArray();
                    state["modules"] = placed;
                }
                foreach (var draft in patch.ModuleReplaces) {
                    if (draft == null) continue;
                    var existing = FindModule(placed, draft.Id);
                    if (existing == null) { code = "missing-module"; return false; }
                    existing.Replace(StationModuleEdits.ToSaveRecord(draft));
                }
            }
            if (patch.ModuleAdds.Count > 0) {
                if (!(state["modules"] is JArray placed)) {
                    placed = new JArray();
                    state["modules"] = placed;
                }
                foreach (var draft in patch.ModuleAdds) {
                    if (draft == null) continue;
                    if (FindModule(placed, draft.Id) != null) { code = "duplicate-id"; return false; }
                    placed.Add(StationModuleEdits.ToSaveRecord(draft));
                }
            }
            if (patch.RemoveModuleIds.Count > 0 && state["modules"] is JArray modules) {
                foreach (var id in patch.RemoveModuleIds) RemoveModule(modules, id);
            }
            if (patch.LineAdds.Count > 0) {
                if (!(state["lines"] is JArray lines)) {
                    lines = new JArray();
                    state["lines"] = lines;
                }
                foreach (var draft in patch.LineAdds) {
                    if (draft == null || string.IsNullOrEmpty(draft.Id)) continue;
                    if (FindLine(lines, draft.Id) != null) { code = "duplicate-line"; return false; }
                    lines.Add(ToSaveLine(draft));
                }
            }
            return true;
        }

        static JObject FindLine(JArray lines, string id) {
            foreach (var token in lines) {
                if (token is JObject line && string.Equals((string)line["id"], id, StringComparison.Ordinal))
                    return line;
            }
            return null;
        }

        /// <summary>One added line as a saved v1 line record (`defaultLine`'s own fields).</summary>
        static JObject ToSaveLine(StationLineDraft line) => new JObject {
            ["id"] = line.Id,
            ["name"] = line.Name,
            ["nameEn"] = line.NameEn,
            ["colour"] = line.Colour,
            ["stock"] = line.Stock,
            ["cars"] = line.Cars,
            ["power"] = line.Power,
            ["psd"] = line.Psd,
            ["direction"] = line.Direction,
            ["headwayProfile"] = new JObject {
                ["peak"] = line.PeakHeadway,
                ["offpeak"] = line.OffpeakHeadway,
                ["late"] = line.LateHeadway,
            },
            ["alightPerTrain"] = line.AlightPerTrain,
            ["terminus"] = line.Terminus,
            ["travelSign"] = line.TravelSign,
            ["modelScale"] = line.ModelScale,
            ["upTerminus"] = "",
            ["downTerminus"] = "",
            ["stations"] = new JArray(),
        };

        static JObject FindModule(JArray modules, string id) {
            if (string.IsNullOrEmpty(id)) return null;
            foreach (var token in modules) {
                if (token is JObject module && string.Equals((string)module["id"], id, StringComparison.Ordinal))
                    return module;
            }
            return null;
        }

        /// <summary>
        /// Apply one cell write to an isolated cell <see cref="JObject"/> (null when absent).
        /// Used by <see cref="StationLocalEdit"/> so single-record patching shares the exact
        /// field/tag/label semantics of <see cref="ApplyToEnvelope"/> without scanning a JArray.
        /// </summary>
        internal static bool ApplyWriteToRecord(JObject current, StationCellWrite write, out JObject next) {
            next = current;
            if (write == null) return true;
            switch (write.Mode) {
                case StationCellWriteMode.Remove:
                    next = null;
                    return true;
                case StationCellWriteMode.AppendTags: {
                    if (current == null) return false;
                    var tags = TagsOf(current);
                    foreach (var tag in write.Tags) if (!tags.Contains(tag)) tags.Add(tag);
                    foreach (var tag in write.RemoveTags) tags.Remove(tag);
                    WriteTags(current, tags);
                    next = current;
                    return true;
                }
                case StationCellWriteMode.Label: {
                    if (current == null) {
                        var zone = write.Zone;
                        var room = write.Room;
                        if (string.IsNullOrEmpty(zone) && string.IsNullOrEmpty(room)) {
                            next = null;
                            return true;
                        }
                        var created = new JObject {
                            ["x"] = write.Key.X,
                            ["y"] = write.Key.Y,
                            ["z"] = write.Key.Z,
                            ["fill"] = "solid",
                        };
                        if (!string.IsNullOrEmpty(zone)) created["zone"] = zone;
                        if (!string.IsNullOrEmpty(room)) created["room"] = room;
                        next = created;
                        return true;
                    }
                    WriteLabel(current, "zone", write.Zone);
                    WriteLabel(current, "room", write.Room);
                    next = current;
                    return true;
                }
                case StationCellWriteMode.PaintFaces: {
                    var target = current;
                    if (target == null) {
                        if (!write.Materialise) {
                            next = null;
                            return true;
                        }
                        target = new JObject {
                            ["x"] = write.Key.X,
                            ["y"] = write.Key.Y,
                            ["z"] = write.Key.Z,
                            ["fill"] = write.Void ? "void" : "solid",
                        };
                        if (!string.IsNullOrEmpty(write.Zone)) target["zone"] = write.Zone;
                        if (write.Tags.Count > 0) WriteTags(target, new List<string>(write.Tags));
                    }
                    var finishes = target["finish"] as JObject;
                    if (finishes == null) {
                        finishes = new JObject();
                        target["finish"] = finishes;
                    }
                    foreach (var pair in write.Finish) {
                        if (string.IsNullOrEmpty(pair.Value)) finishes.Remove(pair.Key);
                        else finishes[pair.Key] = pair.Value;
                    }
                    next = target;
                    return true;
                }
                default: {
                    var record = new JObject {
                        ["x"] = write.Key.X,
                        ["y"] = write.Key.Y,
                        ["z"] = write.Key.Z,
                        ["fill"] = write.Void ? "void" : "solid",
                    };
                    var tags = new List<string>(write.Tags);
                    WriteTags(record, tags);
                    if (write.Finish.Count > 0) {
                        var finish = new JObject();
                        foreach (var pair in write.Finish) finish[pair.Key] = pair.Value;
                        record["finish"] = finish;
                    }
                    next = record;
                    return true;
                }
            }
        }

        /// <summary>Write one cell record change into the envelope's cell array.</summary>
        static bool ApplyWrite(JArray cells, StationCellWrite write) {
            var existing = Find(cells, write.Key.X, write.Key.Y, write.Key.Z);
            switch (write.Mode) {
                case StationCellWriteMode.Remove:
                    existing?.Remove();
                    return true;
                case StationCellWriteMode.AppendTags: {
                    if (existing == null) return false;
                    var tags = TagsOf(existing);
                    foreach (var tag in write.Tags) if (!tags.Contains(tag)) tags.Add(tag);
                    foreach (var tag in write.RemoveTags) tags.Remove(tag);
                    WriteTags(existing, tags);
                    return true;
                }
                case StationCellWriteMode.Label: {
                    if (existing == null) {
                        // `paintZoneCells`'s tail: virgin street is materialised so it can carry
                        // a label. A room on the ground plane keeps the 站外 fare label the plane
                        // already reads; anything else is handed the brush's own zone.
                        var zone = write.Zone;
                        var room = write.Room;
                        if (string.IsNullOrEmpty(zone) && string.IsNullOrEmpty(room)) return true;
                        var record = new JObject {
                            ["x"] = write.Key.X,
                            ["y"] = write.Key.Y,
                            ["z"] = write.Key.Z,
                            ["fill"] = "solid",
                        };
                        if (!string.IsNullOrEmpty(zone)) record["zone"] = zone;
                        if (!string.IsNullOrEmpty(room)) record["room"] = room;
                        cells.Add(record);
                        return true;
                    }
                    WriteLabel(existing, "zone", write.Zone);
                    WriteLabel(existing, "room", write.Room);
                    return true;
                }
                case StationCellWriteMode.PaintFaces: {
                    var target = existing;
                    if (target == null) {
                        if (!write.Materialise) return true;
                        target = new JObject {
                            ["x"] = write.Key.X,
                            ["y"] = write.Key.Y,
                            ["z"] = write.Key.Z,
                            ["fill"] = write.Void ? "void" : "solid",
                        };
                        if (!string.IsNullOrEmpty(write.Zone)) target["zone"] = write.Zone;
                        if (write.Tags.Count > 0) WriteTags(target, new List<string>(write.Tags));
                        cells.Add(target);
                    }
                    var finishes = target["finish"] as JObject;
                    if (finishes == null) {
                        finishes = new JObject();
                        target["finish"] = finishes;
                    }
                    foreach (var pair in write.Finish) {
                        if (string.IsNullOrEmpty(pair.Value)) finishes.Remove(pair.Key);
                        else finishes[pair.Key] = pair.Value;
                    }
                    return true;
                }
                default: {
                    // A `void` hole is **replaced**, not shadowed: the document holds one
                    // record per coordinate, exactly as `addCells`/`addWalls` write it.
                    var record = new JObject {
                        ["x"] = write.Key.X,
                        ["y"] = write.Key.Y,
                        ["z"] = write.Key.Z,
                        ["fill"] = write.Void ? "void" : "solid",
                    };
                    var tags = new List<string>(write.Tags);
                    WriteTags(record, tags);
                    if (write.Finish.Count > 0) {
                        var finish = new JObject();
                        foreach (var pair in write.Finish) finish[pair.Key] = pair.Value;
                        record["finish"] = finish;
                    }
                    if (existing != null) {
                        // A plain block over a dug hole **replaces** the record, which is what
                        // `addCells` writes (`out[hole] = {x, y, z, fill: "solid"}`): the hole
                        // carried no authored data, and a `void` cannot also be solid. A merge
                        // that must keep a cell's zone, room and finish uses `AppendTags`.
                        existing.Replace(record);
                    } else {
                        cells.Add(record);
                    }
                    return true;
                }
            }
        }

        static JObject Find(JArray cells, int x, int y, int z) {
            foreach (var token in cells) {
                if (!(token is JObject cell)) continue;
                if ((int?)cell["x"] != x || (int?)cell["y"] != y) continue;
                var value = cell["z"];
                if (value == null) continue;
                double depth = value.Type == JTokenType.Float || value.Type == JTokenType.Integer ? (double)value : double.NaN;
                if (Math.Abs(depth - z) < 1e-9) return cell;
            }
            return null;
        }

        static List<string> TagsOf(JObject cell) {
            var tags = new List<string>();
            if (cell["tags"] is JArray array) {
                foreach (var tag in array) if (tag.Type == JTokenType.String) tags.Add((string)tag);
            }
            return tags;
        }

        /// <summary>
        /// Write one authored label: null leaves the field alone, `""` removes it, any other
        /// value sets it. The rest of the record — fill, tags, finish, an unknown field — is
        /// untouched, which is why a zone repaint never costs a cell its material.
        /// </summary>
        static void WriteLabel(JObject cell, string field, string value) {
            if (value == null) return;
            if (value.Length == 0) { cell.Remove(field); return; }
            cell[field] = value;
        }

        static void WriteTags(JObject cell, List<string> tags) {
            if (tags == null || tags.Count == 0) { cell.Remove("tags"); return; }
            var array = new JArray();
            foreach (var tag in tags) array.Add(tag);
            cell["tags"] = array;
        }

        static void RemoveModule(JArray modules, string id) {
            if (string.IsNullOrEmpty(id)) return;
            for (int i = modules.Count - 1; i >= 0; i--) {
                if (modules[i] is JObject module && string.Equals((string)module["id"], id, StringComparison.Ordinal)) {
                    modules.RemoveAt(i);
                    return;
                }
            }
        }
    }
}
