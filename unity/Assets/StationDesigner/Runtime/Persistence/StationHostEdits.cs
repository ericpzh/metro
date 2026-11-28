using System;
using System.Collections.Generic;
using System.Globalization;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>
    /// Host-backed document edit planners for city style, bilingual station rename, line CRUD/updates,
    /// lift door sides, run/road direction flips, and platform screen door regeneration (plan 37 Track 3).
    /// Engine-free: every planner returns either a local <see cref="StationReadResult"/> (sharing
    /// untouched cell/module pages) or a complete patched v1 JSON envelope for multi-module structural
    /// changes, never mutating the committed station in place.
    /// </summary>
    public static class StationHostEdits {
        static readonly int[] FormationOptions = { 2, 3, 4, 6, 8 };
        const int HeadwayMinS = 60;
        const int HeadwayMaxS = 1200;

        public static int SnapFormation(double cars) {
            if (double.IsNaN(cars) || double.IsInfinity(cars)) return 6;
            int best = FormationOptions[0];
            double bestDist = Math.Abs(best - cars);
            for (int i = 1; i < FormationOptions.Length; i++) {
                double d = Math.Abs(FormationOptions[i] - cars);
                if (d < bestDist) {
                    best = FormationOptions[i];
                    bestDist = d;
                }
            }
            return best;
        }

        static int ClampHeadway(double value, int fallback) {
            int safe = fallback >= HeadwayMinS && fallback <= HeadwayMaxS ? fallback : 150;
            if (double.IsNaN(value) || double.IsInfinity(value)) return safe;
            int rounded = (int)Math.Round(value, MidpointRounding.AwayFromZero);
            if (rounded < HeadwayMinS) return HeadwayMinS;
            if (rounded > HeadwayMaxS) return HeadwayMaxS;
            return rounded;
        }

        public static JObject LineDraftToJson(StationLineDraft draft) {
            if (draft == null) throw new ArgumentNullException(nameof(draft));
            return new JObject {
                ["id"] = draft.Id,
                ["name"] = draft.Name,
                ["nameEn"] = draft.NameEn ?? "",
                ["colour"] = draft.Colour,
                ["stock"] = draft.Stock,
                ["cars"] = draft.Cars,
                ["power"] = draft.Power,
                ["psd"] = draft.Psd,
                ["direction"] = draft.Direction,
                ["headwayProfile"] = new JObject {
                    ["peak"] = draft.PeakHeadway,
                    ["offpeak"] = draft.OffpeakHeadway,
                    ["late"] = draft.LateHeadway,
                },
                ["alightPerTrain"] = draft.AlightPerTrain,
                ["modelScale"] = draft.ModelScale,
                ["upTerminus"] = "",
                ["downTerminus"] = "",
            };
        }

        public static StationLineRecord BuildLineRecord(JObject line) {
            if (line == null) throw new ArgumentNullException(nameof(line));
            return new StationLineRecord(
                StationDocumentReader.Str(line["id"]),
                StationDocumentReader.Str(line["name"]),
                StationDocumentReader.Str(line["nameEn"]),
                StationDocumentReader.Str(line["colour"]),
                StationDocumentReader.Str(line["stock"]),
                StationDocumentReader.Int(line["cars"], 0),
                StationDocumentReader.Str(line["power"]),
                StationDocumentReader.Str(line["psd"]),
                StationDocumentReader.Str(line["direction"]),
                StationDocumentReader.Str(line["upTerminus"]),
                StationDocumentReader.Str(line["downTerminus"]),
                line.ToString(Formatting.None));
        }

        public static bool SameLineList(IReadOnlyList<StationLineRecord> a, IReadOnlyList<StationLineRecord> b) {
            if (ReferenceEquals(a, b)) return true;
            int ac = a?.Count ?? 0;
            int bc = b?.Count ?? 0;
            if (ac != bc) return false;
            for (int i = 0; i < ac; i++) {
                if (!string.Equals(a[i]?.RawJson ?? "", b[i]?.RawJson ?? "", StringComparison.Ordinal)) return false;
            }
            return true;
        }

        // ------------------------------------------------------------- city & rename

        public static StationReadResult TryPlanCity(StationReadResult committed, string city, string sourceId, out string code) {
            code = null;
            if (committed?.Document == null) { code = "no-session"; return null; }
            if (string.IsNullOrEmpty(city) || !StationCityStyles.IsValid(city)) {
                code = "bad-city";
                return null;
            }
            string normalized = StationCityStyles.Normalize(city);
            if (string.Equals(committed.Document.City, normalized, StringComparison.Ordinal)) {
                code = "no-change";
                return null;
            }
            return StationLocalEdit.TryApplyMetadata(committed, null, null, normalized, null, sourceId, out code);
        }

        public static StationReadResult TryPlanRename(StationReadResult committed, string name, string nameEn,
            bool hasNameEn, string sourceId, out string code) {
            code = null;
            if (committed?.Document == null) { code = "no-session"; return null; }
            string trimmed = (name ?? "").Trim();
            if (trimmed.Length == 0) { code = "bad-name"; return null; }
            string trimmedEn = hasNameEn ? (nameEn ?? "").Trim() : committed.Document.NameEn;
            if (string.Equals(committed.Document.Name, trimmed, StringComparison.Ordinal) &&
                string.Equals(committed.Document.NameEn, trimmedEn, StringComparison.Ordinal)) {
                code = "no-change";
                return null;
            }
            return StationLocalEdit.TryApplyMetadata(committed, trimmed, trimmedEn, null, null, sourceId, out code);
        }

        // ------------------------------------------------------------- line CRUD

        public static StationReadResult TryPlanAddLine(StationReadResult committed, string direction, string sourceId,
            out StationLineRecord addedLine, out string code) {
            addedLine = null;
            code = null;
            if (committed?.Document == null) { code = "no-session"; return null; }
            var existing = committed.Document.Lines;
            var used = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < existing.Count; i++) used.Add(existing[i].Id);
            int n = existing.Count + 1;
            while (used.Contains(n.ToString(CultureInfo.InvariantCulture))) n++;
            string id = n.ToString(CultureInfo.InvariantCulture);
            string dir = string.Equals(direction, "down", StringComparison.Ordinal) ? "down" : "up";
            var draft = StationLineDefaults.Default(id, dir, "third-rail", committed.Document.City);
            var record = BuildLineRecord(LineDraftToJson(draft));
            var nextLines = new List<StationLineRecord>(existing.Count + 1);
            for (int i = 0; i < existing.Count; i++) nextLines.Add(existing[i]);
            nextLines.Add(record);
            addedLine = record;
            return StationLocalEdit.TryApplyMetadata(committed, null, null, null, nextLines, sourceId, out code);
        }

        public static bool TryPlanRemoveLine(StationReadResult committed, string lineId, string sourceId,
            out StationReadResult localResult, out string fullEnvelope, out string code) {
            localResult = null;
            fullEnvelope = null;
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-session"; return false; }
            if (string.IsNullOrEmpty(lineId)) { code = "bad-payload"; return false; }

            var existingLines = committed.Document.Lines;
            int foundIdx = -1;
            for (int i = 0; i < existingLines.Count; i++) {
                if (string.Equals(existingLines[i].Id, lineId, StringComparison.Ordinal)) { foundIdx = i; break; }
            }
            if (foundIdx < 0) { code = "not-found"; return false; }

            var trackIds = new HashSet<string>(StringComparer.Ordinal);
            var tracks = committed.Index.ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var t = tracks[i];
                if (t != null && string.Equals(t.Config.Text("line"), lineId, StringComparison.Ordinal)) {
                    trackIds.Add(t.Id);
                }
            }

            if (trackIds.Count == 0) {
                var nextLines = new List<StationLineRecord>(existingLines.Count - 1);
                for (int i = 0; i < existingLines.Count; i++) {
                    if (i != foundIdx) nextLines.Add(existingLines[i]);
                }
                localResult = StationLocalEdit.TryApplyMetadata(committed, null, null, null, nextLines, sourceId, out code);
                return localResult != null;
            }

            var envelope = JObject.Parse(committed.Document.NormalizedJson);
            var state = envelope["static"] as JObject;
            var linesArr = state?["lines"] as JArray;
            var modulesArr = state?["modules"] as JArray;
            if (state == null || linesArr == null || modulesArr == null) { code = "parse-failed"; return false; }

            for (int i = linesArr.Count - 1; i >= 0; i--) {
                if (linesArr[i] is JObject lo && string.Equals((string)lo["id"], lineId, StringComparison.Ordinal)) {
                    linesArr.RemoveAt(i);
                }
            }

            var stripPatch = new StationCellPatch();
            foreach (var tid in trackIds) {
                foreach (var w in StationTunnelShell.Strip(committed.Index, tid)) stripPatch.Writes.Add(w);
            }
            if (stripPatch.HasWork) {
                var strippedJson = StationCellEdits.Apply(envelope.ToString(Formatting.None), stripPatch, out var stripCode);
                if (strippedJson == null) { code = stripCode ?? "strip-failed"; return false; }
                envelope = JObject.Parse(strippedJson);
                state = envelope["static"] as JObject;
                modulesArr = state?["modules"] as JArray;
            }

            for (int i = modulesArr.Count - 1; i >= 0; i--) {
                if (!(modulesArr[i] is JObject mo)) continue;
                string id = (string)mo["id"] ?? "";
                string type = (string)mo["type"] ?? "";
                var cfg = mo["cfg"] as JObject;
                bool remove = false;
                if (type == "track" && trackIds.Contains(id)) {
                    remove = true;
                } else if (type == "platform-edge") {
                    string from = (string)cfg?["from"] ?? "";
                    string mLine = (string)cfg?["line"] ?? "";
                    if ((from.Length > 0 && trackIds.Contains(from)) || string.Equals(mLine, lineId, StringComparison.Ordinal)) {
                        remove = true;
                    }
                } else if (type == "pillar") {
                    string bridgeId = (string)cfg?["bridgeId"] ?? "";
                    if (bridgeId.Length > 0 && trackIds.Contains(bridgeId)) remove = true;
                }
                if (remove) modulesArr.RemoveAt(i);
            }

            fullEnvelope = envelope.ToString(Formatting.None);
            return true;
        }

        public static bool TryPlanUpdateLine(StationReadResult committed, string lineId, JObject patch, string sourceId,
            out StationReadResult localResult, out string fullEnvelope, out string code) {
            localResult = null;
            fullEnvelope = null;
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-session"; return false; }
            if (string.IsNullOrEmpty(lineId) || patch == null) { code = "bad-payload"; return false; }

            var existingLines = committed.Document.Lines;
            int foundIdx = -1;
            for (int i = 0; i < existingLines.Count; i++) {
                if (string.Equals(existingLines[i].Id, lineId, StringComparison.Ordinal)) { foundIdx = i; break; }
            }
            if (foundIdx < 0) { code = "not-found"; return false; }

            var prevLine = existingLines[foundIdx];
            var lineJson = JObject.Parse(prevLine.RawJson);
            int prevCars = Math.Max(1, StationDocumentReader.Int(lineJson["cars"], prevLine.Cars > 0 ? prevLine.Cars : 6));
            int prevAlight = StationDocumentReader.Int(lineJson["alightPerTrain"], 120);

            bool touchedPower = false;
            bool touchedPsd = false;
            bool touchedGeometry = false;
            string nextPower = prevLine.Power;
            string nextPsd = prevLine.Psd;

            if (patch["name"] != null && patch["name"].Type == JTokenType.String) {
                var n = ((string)patch["name"]).Trim();
                if (n.Length > 0) lineJson["name"] = n;
            }
            if (patch["nameEn"] != null && patch["nameEn"].Type == JTokenType.String) {
                lineJson["nameEn"] = ((string)patch["nameEn"]).Trim();
            }
            var colourTok = patch["colour"] ?? patch["color"];
            if (colourTok != null && colourTok.Type == JTokenType.String) {
                var col = ((string)colourTok).Trim();
                if (col.Length > 0) lineJson["colour"] = col;
            }
            if (patch["upTerminus"] != null && patch["upTerminus"].Type == JTokenType.String) {
                lineJson["upTerminus"] = (string)patch["upTerminus"];
            }
            if (patch["downTerminus"] != null && patch["downTerminus"].Type == JTokenType.String) {
                lineJson["downTerminus"] = (string)patch["downTerminus"];
            }
            if (patch["direction"] != null && patch["direction"].Type == JTokenType.String) {
                var dir = (string)patch["direction"];
                if (dir == "up" || dir == "down") lineJson["direction"] = dir;
            }
            if (patch["headwayProfile"] is JObject hpPatch) {
                var hp = lineJson["headwayProfile"] as JObject ?? new JObject {
                    ["peak"] = 150, ["offpeak"] = 240, ["late"] = 480,
                };
                int curPeak = StationDocumentReader.Int(hp["peak"], 150);
                int curOff = StationDocumentReader.Int(hp["offpeak"], 240);
                int curLate = StationDocumentReader.Int(hp["late"], 480);
                if (hpPatch["peak"] != null) curPeak = ClampHeadway(StationDocumentReader.Num(hpPatch["peak"], curPeak), curPeak);
                if (hpPatch["offpeak"] != null) curOff = ClampHeadway(StationDocumentReader.Num(hpPatch["offpeak"], curOff), curOff);
                if (hpPatch["late"] != null) curLate = ClampHeadway(StationDocumentReader.Num(hpPatch["late"], curLate), curLate);
                lineJson["headwayProfile"] = new JObject {
                    ["peak"] = curPeak, ["offpeak"] = curOff, ["late"] = curLate,
                };
            }
            bool hasExplicitAlight = patch["alightPerTrain"] != null &&
                (patch["alightPerTrain"].Type == JTokenType.Integer || patch["alightPerTrain"].Type == JTokenType.Float);
            if (hasExplicitAlight) {
                int v = Math.Max(0, (int)Math.Round(StationDocumentReader.Num(patch["alightPerTrain"], prevAlight)));
                lineJson["alightPerTrain"] = v;
            }
            if (patch["power"] != null && patch["power"].Type == JTokenType.String) {
                var p = (string)patch["power"];
                if (p == "third-rail" || p == "catenary") {
                    lineJson["power"] = p;
                    nextPower = p;
                    touchedPower = true;
                }
            }
            if (patch["psd"] != null && patch["psd"].Type == JTokenType.String) {
                var psd = (string)patch["psd"];
                if (psd == "full" || psd == "half" || psd == "none") {
                    lineJson["psd"] = psd;
                    nextPsd = psd;
                    touchedPsd = true;
                }
            }
            if (patch["stock"] != null && patch["stock"].Type == JTokenType.String) {
                var stock = (string)patch["stock"];
                if (stock == "A" || stock == "B" || stock == "C" || stock == "L" || stock == "D") {
                    lineJson["stock"] = stock;
                    touchedGeometry = true;
                }
            }
            if (patch["cars"] != null &&
                (patch["cars"].Type == JTokenType.Integer || patch["cars"].Type == JTokenType.Float)) {
                int snapped = SnapFormation(StationDocumentReader.Num(patch["cars"], prevCars));
                lineJson["cars"] = snapped;
                touchedGeometry = true;
                if (!hasExplicitAlight && snapped != prevCars) {
                    lineJson["alightPerTrain"] = (int)Math.Round(((double)prevAlight / prevCars) * snapped, MidpointRounding.AwayFromZero);
                }
            }

            var updatedRecord = BuildLineRecord(lineJson);
            if (!touchedPower && !touchedPsd && !touchedGeometry &&
                string.Equals(updatedRecord.RawJson, prevLine.RawJson, StringComparison.Ordinal)) {
                code = "no-change";
                return false;
            }

            var boundTracks = new List<StationModuleRecord>();
            var allTracks = committed.Index.ModulesOfType("track");
            for (int i = 0; i < allTracks.Count; i++) {
                var t = allTracks[i];
                if (t != null && string.Equals(t.Config.Text("line"), lineId, StringComparison.Ordinal)) {
                    boundTracks.Add(t);
                }
            }

            if ((!touchedPower && !touchedPsd && !touchedGeometry) || boundTracks.Count == 0) {
                var nextLines = new List<StationLineRecord>(existingLines.Count);
                for (int i = 0; i < existingLines.Count; i++) {
                    nextLines.Add(i == foundIdx ? updatedRecord : existingLines[i]);
                }
                localResult = StationLocalEdit.TryApplyMetadata(committed, null, null, null, nextLines, sourceId, out code);
                return localResult != null;
            }

            // Structural line update with bound tracks: validate track resizes first so overlap
            // refuses the entire edit atomically (matching Web's resizeTrack contract).
            StationRailRules.PieceForLine(updatedRecord, out int targetW, out int targetD);
            var envelope = JObject.Parse(committed.Document.NormalizedJson);
            var state = envelope["static"] as JObject;
            var linesArr = state?["lines"] as JArray;
            var modulesArr = state?["modules"] as JArray;
            if (state == null || linesArr == null || modulesArr == null) { code = "parse-failed"; return false; }

            linesArr[foundIdx] = lineJson;

            if (touchedPower) {
                for (int i = 0; i < modulesArr.Count; i++) {
                    if (!(modulesArr[i] is JObject mo) || (string)mo["type"] != "track") continue;
                    var cfg = mo["cfg"] as JObject;
                    if (!string.Equals((string)cfg?["line"], lineId, StringComparison.Ordinal)) continue;
                    if (cfg == null) { cfg = new JObject(); mo["cfg"] = cfg; }
                    cfg["power"] = nextPower;
                }
            }

            string workingJson = envelope.ToString(Formatting.None);

            if (touchedGeometry) {
                // Re-read current working document before resizing each track sequentially.
                for (int i = 0; i < boundTracks.Count; i++) {
                    var read = StationDocumentReader.Read(workingJson, new StationSource(sourceId ?? "", ""));
                    if (read?.Index == null) { code = "parse-failed"; return false; }
                    if (!read.Index.TryGetModule(boundTracks[i].Id, out var trk) || trk == null) continue;
                    bool isTunnelOrBridge = trk.Config.Bool("tunnel") || trk.Config.Bool("bridge");
                    int w = isTunnelOrBridge ? trk.Width : targetW;
                    int d = Math.Max(trk.Depth, targetD);
                    if (w == trk.Width && d == trk.Depth) continue;
                    var resizePatch = StationRailPlanner.Resize(read.Index, trk.Id, w, d, out var resizeReason);
                    if (resizeReason == "interference") {
                        code = "rail-overlap";
                        return false;
                    }
                    if (!string.IsNullOrEmpty(resizeReason) && resizeReason != "no-change") {
                        code = resizeReason;
                        return false;
                    }
                    if (resizePatch.HasWork || resizePatch.RemoveModuleIds.Count > 0) {
                        workingJson = StationCellEdits.Apply(workingJson, resizePatch, out var applyCode);
                        if (workingJson == null) { code = applyCode ?? "resize-failed"; return false; }
                    }
                }
            }

            if (touchedPsd) {
                for (int i = 0; i < boundTracks.Count; i++) {
                    var read = StationDocumentReader.Read(workingJson, new StationSource(sourceId ?? "", ""));
                    if (read?.Index == null) { code = "parse-failed"; return false; }
                    if (!read.Index.TryGetModule(boundTracks[i].Id, out var trk) || trk == null) continue;
                    if (trk.Config.Bool("tunnel") || trk.Config.Bool("bridge")) continue;
                    var regen = BuildRegenRailEnvelope(read.Index, workingJson, trk.Id, clearRemovedSides: true, psdOverride: nextPsd, out var regenCode);
                    if (regen == null) { code = regenCode ?? "regen-failed"; return false; }
                    workingJson = regen;
                }
            }

            fullEnvelope = workingJson;
            return true;
        }

        // ------------------------------------------------------------- InfoCard module verbs

        public static StationReadResult TryPlanLiftDoorSide(StationReadResult committed, string moduleId, int z,
            string side, string sourceId, out string code) {
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-session"; return null; }
            if (side != "front" && side != "back" && side != "both") { code = "bad-payload"; return null; }
            if (!committed.Index.TryGetModule(moduleId, out var existing) || existing == null ||
                !string.Equals(existing.Type, "lift", StringComparison.Ordinal)) {
                code = "not-found";
                return null;
            }
            string zKey = z.ToString(CultureInfo.InvariantCulture);
            return StationLocalEdit.TryApplyModuleInPlace(committed, moduleId, json => {
                var cfg = json["cfg"] as JObject;
                if (cfg == null) { cfg = new JObject(); json["cfg"] = cfg; }
                var doors = cfg["doors"] as JObject;
                string before = doors?[zKey]?.Type == JTokenType.String ? (string)doors[zKey] : "front";
                if (string.Equals(before, side, StringComparison.Ordinal)) return "no-change";
                if (doors == null) { doors = new JObject(); cfg["doors"] = doors; }
                if (side == "front") doors.Remove(zKey);
                else doors[zKey] = side;
                if (doors.Count == 0) cfg.Remove("doors");
                return null;
            }, sourceId, out code);
        }

        public static StationReadResult TryPlanSwitchRunDirection(StationReadResult committed, string moduleId,
            string sourceId, out string code) {
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-session"; return null; }
            if (!committed.Index.TryGetModule(moduleId, out var existing) || existing == null ||
                (!string.Equals(existing.Type, "escalator", StringComparison.Ordinal) &&
                 !string.Equals(existing.Type, "walkway", StringComparison.Ordinal))) {
                code = "not-found";
                return null;
            }
            return StationLocalEdit.TryApplyModuleInPlace(committed, moduleId, json => {
                var from = json["from"]?.DeepClone();
                var to = json["to"]?.DeepClone();
                if (from != null && to != null) {
                    json["from"] = to;
                    json["to"] = from;
                }
                var cfg = json["cfg"] as JObject;
                if (cfg == null) { cfg = new JObject(); json["cfg"] = cfg; }
                string dir = cfg["dir"]?.Type == JTokenType.String ? (string)cfg["dir"] : "up";
                cfg["dir"] = string.Equals(dir, "down", StringComparison.Ordinal) ? "up" : "down";
                return null;
            }, sourceId, out code);
        }

        public static StationReadResult TryPlanSwitchRoadDirection(StationReadResult committed, string moduleId,
            string sourceId, out string code) {
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-session"; return null; }
            if (!committed.Index.TryGetModule(moduleId, out var existing) || existing == null ||
                !string.Equals(existing.Type, "road", StringComparison.Ordinal)) {
                code = "not-found";
                return null;
            }
            return StationLocalEdit.TryApplyModuleInPlace(committed, moduleId, json => {
                var cfg = json["cfg"] as JObject;
                string direction = cfg?["direction"]?.Type == JTokenType.String ? (string)cfg["direction"] : "";
                if (!string.Equals(direction, "one-way", StringComparison.Ordinal)) return "not-one-way";
                int rot = StationDocumentReader.Int(json["rot"], 0);
                json["rot"] = ((rot + 2) % 4 + 4) % 4;
                return null;
            }, sourceId, out code);
        }

        public static StationCellPatch PlanPlatformDirection(StationIndex index, string trackId, string direction, out string code) {
            code = null;
            if (direction != "up" && direction != "down" && direction != Metro.Sim.StationTrainPose.TerminalDirection) {
                code = "bad-payload";
                return null;
            }
            if (!index.TryGetModule(trackId, out var track) || track.Type != "track" ||
                track.Config.Bool("tunnel") || track.Config.Bool("bridge")) {
                code = "not-found";
                return null;
            }
            var patch = new StationCellPatch();
            if (track.Config.Text("dir") == direction) return patch;
            var draft = StationModulePlacement.DraftOf(track);
            draft.Set("dir", direction);
            patch.ReplaceModule(draft);
            foreach (var edge in index.ModulesOfType("platform-edge")) {
                if (edge.Config.Text("from") != trackId) continue;
                var edgeDraft = StationModulePlacement.DraftOf(edge);
                edgeDraft.Set("dir", direction);
                patch.ReplaceModule(edgeDraft);
            }
            return patch;
        }

        public static StationCellPatch PlanBridgeRailing(StationIndex index, string trackId, string railing, out string code) {
            code = null;
            if (railing != "none" && railing != "railing" && railing != "sound-barrier-half" && railing != "sound-barrier") {
                code = "bad-payload";
                return null;
            }
            if (!index.TryGetModule(trackId, out var track) || track.Type != "track" || !track.Config.Bool("bridge")) {
                code = "not-found";
                return null;
            }
            var patch = new StationCellPatch();
            var current = track.Config.Text("bridgeRailing");
            if ((string.IsNullOrEmpty(current) ? "railing" : current) == railing) return patch;
            var draft = StationModulePlacement.DraftOf(track);
            draft.Set("bridgeRailing", railing);
            patch.ReplaceModule(draft);
            return patch;
        }

        public static string TryPlanRegenRail(StationReadResult committed, string trackId, out string code) {
            code = null;
            if (committed?.Document == null || committed.Index == null) { code = "no-session"; return null; }
            if (string.IsNullOrEmpty(trackId) || !committed.Index.TryGetModule(trackId, out var trk) || trk == null ||
                !string.Equals(trk.Type, "track", StringComparison.Ordinal)) {
                code = "not-found";
                return null;
            }
            return BuildRegenRailEnvelope(committed.Index, committed.Document.NormalizedJson, trackId,
                clearRemovedSides: true, psdOverride: null, out code);
        }

        static string BuildRegenRailEnvelope(StationIndex index, string envelopeJson, string trackId,
            bool clearRemovedSides, string psdOverride, out string code) {
            code = null;
            if (!index.TryGetModule(trackId, out var track) || track == null ||
                !string.Equals(track.Type, "track", StringComparison.Ordinal)) {
                code = "not-found";
                return null;
            }
            var envelope = JObject.Parse(envelopeJson);
            var state = envelope["static"] as JObject;
            var modulesArr = state?["modules"] as JArray;
            if (modulesArr == null) { code = "parse-failed"; return null; }

            if (clearRemovedSides) {
                for (int i = 0; i < modulesArr.Count; i++) {
                    if (modulesArr[i] is JObject mo && string.Equals((string)mo["id"], trackId, StringComparison.Ordinal)) {
                        (mo["cfg"] as JObject)?.Remove("removedPsdSides");
                        break;
                    }
                }
            }

            string prefix = "edge-" + trackId + "-";
            for (int i = modulesArr.Count - 1; i >= 0; i--) {
                if (!(modulesArr[i] is JObject mo) || (string)mo["type"] != "platform-edge") continue;
                string id = (string)mo["id"] ?? "";
                string from = (string)(mo["cfg"] as JObject)?["from"] ?? "";
                if (string.Equals(from, trackId, StringComparison.Ordinal) ||
                    id.StartsWith(prefix, StringComparison.Ordinal)) {
                    modulesArr.RemoveAt(i);
                }
            }

            if (!track.Config.Bool("tunnel") && !track.Config.Bool("bridge")) {
                var trackDraft = StationModulePlacement.DraftOf(track);
                var plan = new StationRailPlan {
                    LineId = track.Config.Text("line"),
                    Direction = track.Config.Text("dir"),
                    Rotation = track.Rotation,
                    X = track.X,
                    Y = track.Y,
                    Z = track.Z,
                    Width = track.Width,
                    Depth = track.Depth,
                    Track = trackDraft,
                    Tunnel = false,
                };
                var derived = StationRailPlanner.DerivePlatformEdges(index, plan);
                for (int i = 0; i < derived.Count; i++) {
                    if (!string.IsNullOrEmpty(psdOverride)) derived[i].Set("psd", psdOverride);
                    modulesArr.Add(StationModuleEdits.ToSaveRecord(derived[i]));
                }
            }

            return envelope.ToString(Formatting.None);
        }
    }
}
