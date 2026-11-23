using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>
    /// Single-pass streaming <see cref="JsonTextReader"/> loader for <c>metro-save</c> v1
    /// documents. Avoids materializing a full-document <see cref="JObject"/> DOM (~463 MiB on
    /// Tianhe Park) and interns repeated cell strings, tag arrays, and finish maps while
    /// preserving byte-identical round-trip semantics and all load-time repairs.
    /// </summary>
    internal static class StationDocumentStreamingReader {
        static readonly string[] ValidCities = {
            "guangzhou", "shenzhen", "shanghai", "beijing", "chengdu", "chongqing", "wuhan", "nanjing",
        };

        sealed class StringInterner {
            readonly Dictionary<string, string> strings = new Dictionary<string, string>(256, StringComparer.Ordinal);
            readonly Dictionary<string, string[]> tagArrays = new Dictionary<string, string[]>(64, StringComparer.Ordinal);
            readonly Dictionary<string, CompactStringMap> finishMaps = new Dictionary<string, CompactStringMap>(128, StringComparer.Ordinal);
            readonly StringBuilder keyBuf = new StringBuilder(128);

            public string Intern(string value) {
                if (string.IsNullOrEmpty(value)) return "";
                if (strings.TryGetValue(value, out var existing)) return existing;
                strings[value] = value;
                return value;
            }

            public string[] InternTags(List<string> tags) {
                if (tags == null || tags.Count == 0) return Array.Empty<string>();
                keyBuf.Clear();
                for (int i = 0; i < tags.Count; i++) {
                    if (i > 0) keyBuf.Append('\u001f');
                    keyBuf.Append(tags[i]);
                }
                var k = keyBuf.ToString();
                if (tagArrays.TryGetValue(k, out var existing)) return existing;
                var arr = new string[tags.Count];
                for (int i = 0; i < tags.Count; i++) arr[i] = Intern(tags[i]);
                tagArrays[k] = arr;
                return arr;
            }

            public CompactStringMap InternFinish(List<KeyValuePair<string, string>> faces) {
                if (faces == null || faces.Count == 0) return null;
                keyBuf.Clear();
                for (int i = 0; i < faces.Count; i++) {
                    if (i > 0) keyBuf.Append('\u001f');
                    keyBuf.Append(faces[i].Key);
                    keyBuf.Append('=');
                    keyBuf.Append(faces[i].Value);
                }
                var k = keyBuf.ToString();
                if (finishMaps.TryGetValue(k, out var existing)) return existing;
                var keys = new string[faces.Count];
                var vals = new string[faces.Count];
                for (int i = 0; i < faces.Count; i++) {
                    keys[i] = Intern(faces[i].Key);
                    vals[i] = Intern(faces[i].Value);
                }
                var map = new CompactStringMap(keys, vals);
                finishMaps[k] = map;
                return map;
            }
        }

        struct StreamedCell {
            public int X, Y, Z;
            public string Shape, Fill, Zone, Room;
            public string[] Tags;
            public CompactStringMap Finish;
            public ushort CanonicalKeyOrder;
            public JObject FallbackObj;
        }

        internal sealed class StreamedSave {
            public StationCellRecord[] Cells;
            public StationModuleRecord[] Modules;
            public StationLineRecord[] Lines;
            public JObject RootHeader;
            public string RawRootJson;
            public string Name, NameEn, City, FormattedSavedAt;
            public long Seed;
            public int LevelBase, StoreyHeight, DroppedCells, DroppedModules;
            public StationDay Day;
            public StationSource ResolvedSource;
            public StationRepairReport Repairs;
        }

        internal static StreamedSave ReadStreaming(string json, StationSource source, Action<string> markLoad) {
            markLoad?.Invoke("parse.begin");
            if (json == null)
                throw Reject("parse-failed", StationRecordKind.Document, "", "", "The station input is null.");

            var interner = new StringInterner();
            var rootEnvelope = new JObject();
            List<StreamedCell> rawCells = null;
            List<StationModuleRecord> modules = null;
            JArray rawLines = null;
            bool hasStatic = false;
            bool hasCells = false;
            int droppedCells = 0;
            int droppedModules = 0;
            var repairs = new StationRepairReport();
            bool hasUnstockedRoom = false;
            bool hasBridgeTrack = false;
            bool hasBridgePillar = false;

            // Reusable scratch collections to keep GC pressure near zero during cell streaming.
            var scratchTags = new List<string>(4);
            var scratchFinish = new List<KeyValuePair<string, string>>(6);
            var scratchSb = new StringBuilder(256);

            try {
                using var sr = new StringReader(json);
                using var reader = new JsonTextReader(sr) { DateParseHandling = DateParseHandling.None };
                if (!reader.Read() || reader.TokenType != JsonToken.StartObject)
                    throw Reject("parse-failed", StationRecordKind.Document, "", "", "The station is not valid JSON: expected root object.");

                while (reader.Read()) {
                    if (reader.TokenType == JsonToken.EndObject) break;
                    if (reader.TokenType != JsonToken.PropertyName)
                        throw Reject("parse-failed", StationRecordKind.Document, "", "", "The station is not valid JSON: expected property name.");
                    var propName = (string)reader.Value;
                    if (!reader.Read())
                        throw Reject("parse-failed", StationRecordKind.Document, "", "", "The station is not valid JSON: unexpected end of input.");

                    if (string.Equals(propName, "static", StringComparison.Ordinal)) {
                        if (reader.TokenType != JsonToken.StartObject) {
                            JToken.Load(reader);
                            continue;
                        }
                        hasStatic = true;
                        while (reader.Read()) {
                            if (reader.TokenType == JsonToken.EndObject) break;
                            if (reader.TokenType != JsonToken.PropertyName)
                                throw Reject("parse-failed", StationRecordKind.Document, "", "", "Invalid static section.");
                            var staticKey = (string)reader.Value;
                            if (!reader.Read())
                                throw Reject("parse-failed", StationRecordKind.Document, "", "", "Unexpected end in static section.");

                            if (string.Equals(staticKey, "cells", StringComparison.Ordinal)) {
                                if (reader.TokenType != JsonToken.StartArray) {
                                    JToken.Load(reader);
                                    continue;
                                }
                                hasCells = true;
                                rawCells = new List<StreamedCell>(4096);
                                while (reader.Read()) {
                                    if (reader.TokenType == JsonToken.EndArray) break;
                                    if (reader.TokenType != JsonToken.StartObject)
                                        throw Reject("parse-failed", StationRecordKind.Cell, "cell", "#" + (rawCells.Count + droppedCells), "A saved cell is not an object.");
                                    if (TryReadCell(reader, interner, scratchTags, scratchFinish, out var streamedCell)) {
                                        rawCells.Add(streamedCell);
                                    } else {
                                        droppedCells++;
                                    }
                                }
                            } else if (string.Equals(staticKey, "modules", StringComparison.Ordinal)) {
                                if (reader.TokenType == JsonToken.Null) {
                                    modules = new List<StationModuleRecord>();
                                    continue;
                                }
                                if (reader.TokenType != JsonToken.StartArray)
                                    throw Reject("parse-failed", StationRecordKind.Document, "", "", "Invalid station arrays");
                                modules = new List<StationModuleRecord>(2048);
                                while (reader.Read()) {
                                    if (reader.TokenType == JsonToken.EndArray) break;
                                    if (reader.TokenType != JsonToken.StartObject)
                                        throw Reject("parse-failed", StationRecordKind.Module, "module", "#" + (modules.Count + droppedModules), "Invalid module");
                                    var record = ReadModuleStreaming(reader, interner, scratchSb, repairs,
                                        ref droppedModules, ref hasUnstockedRoom, ref hasBridgeTrack, ref hasBridgePillar);
                                    if (record != null) modules.Add(record);
                                }
                            } else if (string.Equals(staticKey, "lines", StringComparison.Ordinal)) {
                                if (reader.TokenType == JsonToken.Null) {
                                    rawLines = new JArray();
                                    continue;
                                }
                                if (reader.TokenType != JsonToken.StartArray)
                                    throw Reject("parse-failed", StationRecordKind.Document, "", "", "Invalid station arrays");
                                rawLines = JArray.Load(reader);
                            } else {
                                reader.Skip();
                            }
                        }
                    } else {
                        rootEnvelope[propName] = JToken.Load(reader);
                    }
                }
            } catch (StationRejectedException) {
                throw;
            } catch (JsonException error) {
                throw Reject("parse-failed", StationRecordKind.Document, "", "", "The station is not valid JSON: " + error.Message);
            } catch (NotSupportedException error) {
                throw Reject("unsupported-record", StationRecordKind.Document, "", "", error.Message);
            } catch (FormatException error) {
                throw Reject("parse-failed", StationRecordKind.Document, "", "", error.Message);
            }

            markLoad?.Invoke("parse.end");

            if (!string.Equals((string)rootEnvelope["format"], StationDocumentReader.SaveFormat, StringComparison.Ordinal))
                throw Reject("parse-failed", StationRecordKind.Document, "", "", "The input is not a metro-save document.");

            var versionToken = rootEnvelope["formatVersion"];
            if (versionToken != null && versionToken.Type != JTokenType.Null) {
                var version = versionToken.Type == JTokenType.Integer || versionToken.Type == JTokenType.Float
                    ? (int)Convert.ToDouble(((JValue)versionToken).Value, CultureInfo.InvariantCulture) : 0;
                if (version > StationDocumentReader.SupportedVersion)
                    throw Reject("version-too-new", StationRecordKind.Document, "", "",
                        "The save format version " + version + " is newer than this build supports (" + StationDocumentReader.SupportedVersion + ").");
            }

            if (!hasStatic || !hasCells || rawCells == null)
                throw Reject("parse-failed", StationRecordKind.Document, "", "", "The save has no station data (static.cells).");

            var resolvedSource = source.Hash.Length == 0 ? new StationSource(source.Path, StationDocumentReader.Hash(json)) : source;
            json = null;

            markLoad?.Invoke("repair.begin");

            if (modules == null) modules = new List<StationModuleRecord>();
            if (rawLines == null) rawLines = new JArray();

            StationCellRecord[] cells;
            try {
                cells = NormalizeAndBuildCells(rawCells, interner, scratchFinish, scratchSb);
                rawCells.Clear();
                rawCells = null;

                if (hasUnstockedRoom) EnsureRoomFurnitureOnRecords(modules, repairs);
                if (hasBridgeTrack || hasBridgePillar) SyncBridgePillarsOnRecords(cells, modules, repairs);
            } catch (StationRejectedException) {
                throw;
            } catch (NotSupportedException error) {
                throw Reject("unsupported-record", StationRecordKind.Document, "", "", error.Message);
            } catch (FormatException error) {
                throw Reject("parse-failed", StationRecordKind.Document, "", "", error.Message);
            }

            var cityToken = rootEnvelope["city"]?.Type == JTokenType.Null
                ? rootEnvelope["cityStyle"]
                : rootEnvelope["city"] ?? rootEnvelope["cityStyle"];
            string city = cityToken?.Type == JTokenType.String ? (string)cityToken : "";
            if (Array.IndexOf(ValidCities, city) < 0) city = "guangzhou";

            var baseValue = rootEnvelope["levelBase"];
            double level = baseValue != null && (baseValue.Type == JTokenType.Integer || baseValue.Type == JTokenType.Float)
                ? (double)baseValue : 0;
            if (double.IsNaN(level) || double.IsInfinity(level)) level = 0;
            int levelBase = (int)Math.Max(0, Math.Min(4, Math.Floor(level + 0.5)));

            var dayInput = new JObject {
                ["service"] = rootEnvelope["service"]?.DeepClone() ?? JValue.CreateNull(),
                ["peaks"] = rootEnvelope["peaks"]?.DeepClone() ?? JValue.CreateNull(),
                ["demand"] = rootEnvelope["demand"]?.DeepClone() ?? JValue.CreateNull(),
                ["calendar"] = rootEnvelope["calendar"]?.DeepClone() ?? JValue.CreateNull(),
            };
            var dayObj = JObject.Parse(StationDayRepair.RepairJson(dayInput.ToString(Formatting.None)));

            var repairedLinesArray = JArray.Parse(StationLineRepair.RepairJson(rawLines.ToString(Formatting.None)));
            var lines = StationDocumentReader.ReadLines(repairedLinesArray);

            var savedAt = StationDocumentReader.Str(rootEnvelope["savedAt"]);
            if (savedAt.Length == 0) savedAt = StationDocumentReader.FixedSavedAt;
            DateTimeOffset savedAtValue;
            if (!DateTimeOffset.TryParse(savedAt, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out savedAtValue))
                savedAtValue = DateTimeOffset.FromUnixTimeMilliseconds(0);

            var nameToken = rootEnvelope["name"]?.Type == JTokenType.String ? rootEnvelope["name"].DeepClone() : new JValue("未命名车站");
            var nameEnToken = rootEnvelope["nameEn"]?.Type == JTokenType.String ? new JValue(((string)rootEnvelope["nameEn"]).Trim()) : new JValue("");
            var seedToken = rootEnvelope["seed"]?.Type == JTokenType.Integer || rootEnvelope["seed"]?.Type == JTokenType.Float
                ? rootEnvelope["seed"].DeepClone() : new JValue(1234567);

            var rootHeader = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FormatSavedAt(savedAtValue),
                ["name"] = nameToken,
                ["nameEn"] = nameEnToken,
                ["city"] = city,
                ["seed"] = seedToken,
                ["levelBase"] = levelBase,
                ["storeyHeight"] = 5,
                ["service"] = dayObj["service"].DeepClone(),
                ["peaks"] = dayObj["peaks"].DeepClone(),
                ["demand"] = dayObj["demand"].DeepClone(),
                ["calendar"] = dayObj["calendar"].DeepClone(),
            };
            foreach (var prop in rootEnvelope.Properties()) {
                if (prop.Name == "static" || prop.Name == "cityStyle" || rootHeader.Property(prop.Name) != null) continue;
                rootHeader[prop.Name] = prop.Value.DeepClone();
            }
            var formattedSavedAt = StationDocumentReader.Str(rootHeader["savedAt"]);
            if (formattedSavedAt.Length == 0) formattedSavedAt = savedAt;
            var rawRootJson = StationDocumentReader.CanonicalRootJson(rootHeader);

            markLoad?.Invoke("repair.end");

            return new StreamedSave {
                Cells = cells,
                Modules = modules.ToArray(),
                Lines = lines,
                RootHeader = rootHeader,
                RawRootJson = rawRootJson,
                Name = StationDocumentReader.Str(nameToken),
                NameEn = StationDocumentReader.Str(nameEnToken),
                City = city,
                FormattedSavedAt = formattedSavedAt,
                Seed = (long)StationDocumentReader.Num(seedToken, 1234567),
                LevelBase = levelBase,
                StoreyHeight = 5,
                Day = StationDocumentReader.ReadDay(dayObj),
                DroppedCells = droppedCells,
                DroppedModules = droppedModules,
                ResolvedSource = resolvedSource,
                Repairs = repairs,
            };
        }

        // ------------------------------------------------------------- cell streaming

        static bool TryReadInt(JsonTextReader reader, out int value, out bool isNumber) {
            if (reader.TokenType == JsonToken.Integer) {
                long lv = Convert.ToInt64(reader.Value, CultureInfo.InvariantCulture);
                if (lv >= int.MinValue && lv <= int.MaxValue) {
                    value = (int)lv;
                    isNumber = true;
                    return true;
                }
            } else if (reader.TokenType == JsonToken.Float) {
                double dv = Convert.ToDouble(reader.Value, CultureInfo.InvariantCulture);
                if (!double.IsNaN(dv) && !double.IsInfinity(dv) && Math.Truncate(dv) == dv &&
                    dv >= int.MinValue && dv <= int.MaxValue) {
                    value = (int)dv;
                    isNumber = true;
                    return true;
                }
                value = 0;
                isNumber = true;
                return false;
            }
            value = 0;
            isNumber = false;
            return false;
        }

        static bool TryReadCell(
            JsonTextReader reader,
            StringInterner interner,
            List<string> scratchTags,
            List<KeyValuePair<string, string>> scratchFinish,
            out StreamedCell cell) {
            cell = default;
            scratchTags.Clear();
            scratchFinish.Clear();

            bool hasX = false, hasY = false, hasZ = false, hasFill = false;
            bool validX = false, validY = false, validZ = false;
            int x = 0, y = 0, z = 0;
            string fill = "";
            string shape = "";
            string zone = "";
            string room = "";

            bool canonical = true;
            int propIndex = 0;
            int optShift = 0;
            int optPacked = 0;
            int seenOptMask = 0;
            JObject fallback = null;

            void SwitchToFallback() {
                if (fallback != null) return;
                canonical = false;
                fallback = new JObject();
                // Rebuild already-read standard fields in the order they appeared.
                if (hasX) fallback["x"] = x;
                if (hasY) fallback["y"] = y;
                if (hasZ) fallback["z"] = z;
                if (hasFill) fallback["fill"] = fill;
                for (int s = 0; s < optShift; s += 3) {
                    int code = (optPacked >> s) & 7;
                    switch (code) {
                        case StationCellRecord.FieldShape: fallback["shape"] = shape; break;
                        case StationCellRecord.FieldTags:
                            var ta = new JArray();
                            for (int i = 0; i < scratchTags.Count; i++) ta.Add(scratchTags[i]);
                            fallback["tags"] = ta;
                            break;
                        case StationCellRecord.FieldFinish:
                            var fo = new JObject();
                            for (int i = 0; i < scratchFinish.Count; i++) fo[scratchFinish[i].Key] = scratchFinish[i].Value;
                            fallback["finish"] = fo;
                            break;
                        case StationCellRecord.FieldZone: fallback["zone"] = zone; break;
                        case StationCellRecord.FieldRoom: fallback["room"] = room; break;
                    }
                }
            }

            while (reader.Read()) {
                if (reader.TokenType == JsonToken.EndObject) break;
                if (reader.TokenType != JsonToken.PropertyName)
                    throw new FormatException("Invalid cell property");
                string name = (string)reader.Value;
                if (!reader.Read()) throw new FormatException("Unexpected end in cell");

                if (fallback != null) {
                    fallback[name] = JToken.Load(reader);
                    continue;
                }

                if (propIndex == 0 && name == "x" && reader.TokenType == JsonToken.Integer && TryReadInt(reader, out x, out _)) {
                    hasX = validX = true; propIndex++; continue;
                }
                if (propIndex == 1 && name == "y" && reader.TokenType == JsonToken.Integer && TryReadInt(reader, out y, out _)) {
                    hasY = validY = true; propIndex++; continue;
                }
                if (propIndex == 2 && name == "z" && reader.TokenType == JsonToken.Integer && TryReadInt(reader, out z, out _)) {
                    hasZ = validZ = true; propIndex++; continue;
                }
                if (propIndex == 3 && name == "fill" && reader.TokenType == JsonToken.String) {
                    string fv = (string)reader.Value;
                    if (!string.IsNullOrEmpty(fv)) {
                        fill = interner.Intern(fv);
                        hasFill = true; propIndex++; continue;
                    }
                }

                if (propIndex >= 4 && optShift < 15) {
                    if (name == "shape" && (seenOptMask & (1 << StationCellRecord.FieldShape)) == 0 && reader.TokenType == JsonToken.String) {
                        string sv = (string)reader.Value;
                        if (!string.IsNullOrEmpty(sv)) {
                            shape = interner.Intern(sv);
                            seenOptMask |= 1 << StationCellRecord.FieldShape;
                            optPacked |= StationCellRecord.FieldShape << optShift;
                            optShift += 3;
                            propIndex++;
                            continue;
                        }
                    } else if (name == "zone" && (seenOptMask & (1 << StationCellRecord.FieldZone)) == 0 && reader.TokenType == JsonToken.String) {
                        string zv = (string)reader.Value;
                        if (!string.IsNullOrEmpty(zv)) {
                            zone = interner.Intern(zv);
                            seenOptMask |= 1 << StationCellRecord.FieldZone;
                            optPacked |= StationCellRecord.FieldZone << optShift;
                            optShift += 3;
                            propIndex++;
                            continue;
                        }
                    } else if (name == "room" && (seenOptMask & (1 << StationCellRecord.FieldRoom)) == 0 && reader.TokenType == JsonToken.String) {
                        string rv = (string)reader.Value;
                        if (!string.IsNullOrEmpty(rv)) {
                            room = interner.Intern(rv);
                            seenOptMask |= 1 << StationCellRecord.FieldRoom;
                            optPacked |= StationCellRecord.FieldRoom << optShift;
                            optShift += 3;
                            propIndex++;
                            continue;
                        }
                    } else if (name == "tags" && (seenOptMask & (1 << StationCellRecord.FieldTags)) == 0 && reader.TokenType == JsonToken.StartArray) {
                        bool allStr = true;
                        var nonStrTokens = new List<JToken>();
                        while (reader.Read()) {
                            if (reader.TokenType == JsonToken.EndArray) break;
                            if (reader.TokenType == JsonToken.String) {
                                scratchTags.Add(interner.Intern((string)reader.Value));
                            } else {
                                allStr = false;
                                nonStrTokens.Add(JToken.Load(reader));
                            }
                        }
                        if (!allStr) throw new FormatException("Invalid cell tag");
                        if (scratchTags.Count > 0) {
                            seenOptMask |= 1 << StationCellRecord.FieldTags;
                            optPacked |= StationCellRecord.FieldTags << optShift;
                            optShift += 3;
                            propIndex++;
                            continue;
                        }
                        // Empty tags array []: preserve exact JSON via fallback
                        SwitchToFallback();
                        fallback["tags"] = new JArray();
                        continue;
                    } else if (name == "finish" && (seenOptMask & (1 << StationCellRecord.FieldFinish)) == 0 && reader.TokenType == JsonToken.StartObject) {
                        bool simpleFinish = true;
                        JObject finishFallback = null;
                        while (reader.Read()) {
                            if (reader.TokenType == JsonToken.EndObject) break;
                            if (reader.TokenType != JsonToken.PropertyName) throw new FormatException("Invalid cell finish");
                            string fk = (string)reader.Value;
                            if (!reader.Read()) throw new FormatException("Invalid cell finish");
                            if (simpleFinish && reader.TokenType == JsonToken.String) {
                                scratchFinish.Add(new KeyValuePair<string, string>(interner.Intern(fk), interner.Intern((string)reader.Value)));
                            } else {
                                if (finishFallback == null) {
                                    finishFallback = new JObject();
                                    for (int i = 0; i < scratchFinish.Count; i++) finishFallback[scratchFinish[i].Key] = scratchFinish[i].Value;
                                }
                                simpleFinish = false;
                                finishFallback[fk] = JToken.Load(reader);
                            }
                        }
                        if (simpleFinish && scratchFinish.Count > 0) {
                            seenOptMask |= 1 << StationCellRecord.FieldFinish;
                            optPacked |= StationCellRecord.FieldFinish << optShift;
                            optShift += 3;
                            propIndex++;
                            continue;
                        }
                        SwitchToFallback();
                        if (finishFallback == null) {
                            finishFallback = new JObject();
                            for (int i = 0; i < scratchFinish.Count; i++) finishFallback[scratchFinish[i].Key] = scratchFinish[i].Value;
                        }
                        fallback["finish"] = finishFallback;
                        continue;
                    }
                }

                // Non-canonical key order, null/empty optional value, float coordinate, or extra key -> fallback for this cell only.
                SwitchToFallback();
                fallback[name] = JToken.Load(reader);
            }

            if (fallback != null) {
                if (!StationGridRepair.KeepsCell(fallback)) return false;
                // Validate tags & finish types immediately (matches StationCellNormalization).
                var tagsTok = fallback["tags"];
                if (tagsTok != null && tagsTok.Type != JTokenType.Null) {
                    if (!(tagsTok is JArray ta)) throw new FormatException("Invalid cell tags");
                    scratchTags.Clear();
                    for (int i = 0; i < ta.Count; i++) {
                        if (ta[i].Type != JTokenType.String) throw new FormatException("Invalid cell tag");
                        scratchTags.Add(interner.Intern((string)ta[i]));
                    }
                } else {
                    scratchTags.Clear();
                }
                cell = new StreamedCell {
                    X = StationDocumentReader.Int(fallback["x"]),
                    Y = StationDocumentReader.Int(fallback["y"]),
                    Z = StationDocumentReader.Int(fallback["z"]),
                    Fill = interner.Intern(StationDocumentReader.Str(fallback["fill"])),
                    Tags = interner.InternTags(scratchTags),
                    FallbackObj = fallback,
                };
                return true;
            }

            if (!validX || !validY || !validZ) return false;
            if (!hasFill) {
                // Missing fill property -> build fallback so RawJson doesn't inject "fill".
                SwitchToFallback();
                cell = new StreamedCell {
                    X = x, Y = y, Z = z,
                    Fill = "",
                    Tags = interner.InternTags(scratchTags),
                    FallbackObj = fallback,
                };
                return true;
            }

            cell = new StreamedCell {
                X = x, Y = y, Z = z,
                Shape = shape,
                Fill = fill,
                Zone = zone,
                Room = room,
                Tags = interner.InternTags(scratchTags),
                Finish = interner.InternFinish(scratchFinish),
                CanonicalKeyOrder = canonical ? (ushort)(StationCellRecord.CanonicalFlag | optPacked) : (ushort)0,
            };
            return true;
        }

        static bool HasTag(string[] tags, string tag) {
            if (tags == null) return false;
            for (int i = 0; i < tags.Length; i++) {
                if (string.Equals(tags[i], tag, StringComparison.Ordinal)) return true;
            }
            return false;
        }

        static StationCellRecord[] NormalizeAndBuildCells(
            List<StreamedCell> rawCells,
            StringInterner interner,
            List<KeyValuePair<string, string>> scratchFinish,
            StringBuilder sb) {
            int count = rawCells.Count;
            var solids = new Dictionary<StationCellKey, StationCellNormalization.Shape>(count);
            for (int i = 0; i < count; i++) {
                var c = rawCells[i];
                if (string.Equals(c.Fill, "solid", StringComparison.Ordinal) && !HasTag(c.Tags, "suspended-ceiling")) {
                    solids[new StationCellKey(c.X, c.Y, c.Z)] = StationCellNormalization.ShapeOfTags(c.Tags);
                }
            }

            var result = new StationCellRecord[count];
            using var sw = new StringWriter(sb, CultureInfo.InvariantCulture);
            using var jw = new JsonTextWriter(sw) { Formatting = Formatting.None };
            var dirs = StationCellNormalization.Directions;

            for (int i = 0; i < count; i++) {
                var c = rawCells[i];
                bool suspended = HasTag(c.Tags, "suspended-ceiling");
                bool openingCeiling = HasTag(c.Tags, "opening-ceiling");

                if (c.FallbackObj != null) {
                    var obj = c.FallbackObj;
                    if (suspended || openingCeiling) {
                        obj.Remove("zone");
                        obj.Remove("room");
                    }
                    if (string.Equals(c.Fill, "solid", StringComparison.Ordinal) &&
                        obj["finish"] != null && obj["finish"].Type != JTokenType.Null && !suspended) {
                        if (!(obj["finish"] is JObject finishObj)) throw new FormatException("Invalid cell finish");
                        var shape = StationCellNormalization.ShapeOfTags(c.Tags);
                        bool changed = false;
                        for (int d = 0; d < dirs.Length; d++) {
                            var dir = dirs[d];
                            if (finishObj.Property(dir.face) == null) continue;
                            if (!solids.TryGetValue(new StationCellKey(c.X + dir.x, c.Y + dir.y, c.Z + dir.z), out var neighbour)) continue;
                            if (!StationCellNormalization.Covered(shape, neighbour, dir)) continue;
                            finishObj.Remove(dir.face);
                            changed = true;
                        }
                        if (changed && !finishObj.HasValues) obj.Remove("finish");
                    }
                    sb.Clear();
                    obj.WriteTo(jw);
                    jw.Flush();
                    string rawJson = sb.ToString();
                    scratchFinish.Clear();
                    if (obj["finish"] is JObject fObj && fObj.HasValues) {
                        foreach (var face in fObj.Properties()) {
                            var val = face.Value;
                            if (val == null || val.Type == JTokenType.Null) continue;
                            string fv = val.Type == JTokenType.String ? (string)val : val.ToString(Formatting.None);
                            scratchFinish.Add(new KeyValuePair<string, string>(interner.Intern(face.Name), interner.Intern(fv)));
                        }
                    }
                    result[i] = new StationCellRecord(
                        c.X, c.Y, c.Z,
                        interner.Intern(StationDocumentReader.Str(obj["shape"])),
                        c.Fill,
                        interner.Intern(StationDocumentReader.Str(obj["zone"])),
                        c.Tags,
                        interner.InternFinish(scratchFinish),
                        interner.Intern(StationDocumentReader.Str(obj["room"])),
                        rawJson);
                    continue;
                }

                string zone = (suspended || openingCeiling) ? "" : c.Zone;
                string room = (suspended || openingCeiling) ? "" : c.Room;
                CompactStringMap finish = c.Finish;

                if (finish != null && finish.Count > 0 &&
                    string.Equals(c.Fill, "solid", StringComparison.Ordinal) && !suspended) {
                    var shape = StationCellNormalization.ShapeOfTags(c.Tags);
                    bool anyRemoved = false;
                    int keptMask = 0;
                    for (int fi = 0; fi < finish.Count; fi++) {
                        string faceName = finish.KeyAt(fi);
                        bool covered = false;
                        for (int d = 0; d < dirs.Length; d++) {
                            if (!string.Equals(dirs[d].face, faceName, StringComparison.Ordinal)) continue;
                            var dir = dirs[d];
                            if (solids.TryGetValue(new StationCellKey(c.X + dir.x, c.Y + dir.y, c.Z + dir.z), out var neighbour) &&
                                StationCellNormalization.Covered(shape, neighbour, dir)) {
                                covered = true;
                            }
                            break;
                        }
                        if (covered) anyRemoved = true;
                        else keptMask |= 1 << fi;
                    }
                    if (anyRemoved) {
                        if (keptMask == 0) {
                            finish = null;
                        } else {
                            scratchFinish.Clear();
                            for (int fi = 0; fi < finish.Count; fi++) {
                                if ((keptMask & (1 << fi)) != 0) {
                                    scratchFinish.Add(new KeyValuePair<string, string>(finish.KeyAt(fi), finish.ValueAt(fi)));
                                }
                            }
                            finish = interner.InternFinish(scratchFinish);
                        }
                    }
                }

                result[i] = new StationCellRecord(
                    c.X, c.Y, c.Z,
                    c.Shape, c.Fill, zone, c.Tags, finish, room,
                    rawJson: null, canonicalKeyOrder: c.CanonicalKeyOrder);
            }

            return result;
        }

        // ------------------------------------------------------------- module streaming

        static StationModuleRecord ReadModuleStreaming(
            JsonTextReader reader,
            StringInterner interner,
            StringBuilder sb,
            StationRepairReport repairs,
            ref int droppedModules,
            ref bool hasUnstockedRoom,
            ref bool hasBridgeTrack,
            ref bool hasBridgePillar) {
            // Fast path for canonical simple paving modules (91.4% of Tianhe's 76,438 modules):
            // {"x":X,"y":Y,"z":Z,"id":ID,"type":"lawn"|"sidewalk","rot":R,"cfg":{}}
            int x = 0, y = 0, z = 0, rot = 0;
            string id = "", type = "";
            bool hasX = false, hasY = false, hasZ = false, hasId = false, hasType = false, hasRot = false, hasCfg = false;
            int step = 0;
            JObject obj = null;

            void SwitchToObj() {
                if (obj != null) return;
                obj = new JObject();
                if (hasX) obj["x"] = x;
                if (hasY) obj["y"] = y;
                if (hasZ) obj["z"] = z;
                if (hasId) obj["id"] = id;
                if (hasType) obj["type"] = type;
                if (hasRot) obj["rot"] = rot;
                if (hasCfg) obj["cfg"] = new JObject();
            }

            while (reader.Read()) {
                if (reader.TokenType == JsonToken.EndObject) break;
                if (reader.TokenType != JsonToken.PropertyName) throw new FormatException("Invalid module");
                string prop = (string)reader.Value;
                if (!reader.Read()) throw new FormatException("Invalid module");

                if (obj != null) {
                    obj[prop] = JToken.Load(reader);
                    continue;
                }

                if (step == 0 && prop == "x" && reader.TokenType == JsonToken.Integer && TryReadInt(reader, out x, out _)) {
                    hasX = true; step = 1; continue;
                }
                if (step == 1 && prop == "y" && reader.TokenType == JsonToken.Integer && TryReadInt(reader, out y, out _)) {
                    hasY = true; step = 2; continue;
                }
                if (step == 2 && prop == "z" && reader.TokenType == JsonToken.Integer && TryReadInt(reader, out z, out _)) {
                    hasZ = true; step = 3; continue;
                }
                if (step == 3 && prop == "id" && reader.TokenType == JsonToken.String) {
                    id = (string)reader.Value ?? "";
                    hasId = true; step = 4; continue;
                }
                if (step == 4 && prop == "type" && reader.TokenType == JsonToken.String) {
                    string tv = (string)reader.Value ?? "";
                    if (tv == "lawn" || tv == "sidewalk") {
                        type = interner.Intern(tv);
                        hasType = true; step = 5; continue;
                    }
                }
                if (step == 5 && prop == "rot" && reader.TokenType == JsonToken.Integer && TryReadInt(reader, out rot, out _)) {
                    hasRot = true; step = 6; continue;
                }
                if (step == 6 && prop == "cfg" && reader.TokenType == JsonToken.StartObject) {
                    if (!reader.Read()) throw new FormatException("Invalid module");
                    if (reader.TokenType == JsonToken.EndObject) {
                        hasCfg = true; step = 7; continue;
                    }
                    // Non-empty cfg: materialize JObject for this single module.
                    SwitchToObj();
                    var cfgObj = new JObject();
                    while (true) {
                        if (reader.TokenType == JsonToken.EndObject) break;
                        if (reader.TokenType != JsonToken.PropertyName) throw new FormatException("Invalid module cfg");
                        string ck = (string)reader.Value;
                        if (!reader.Read()) throw new FormatException("Invalid module cfg");
                        cfgObj[ck] = JToken.Load(reader);
                        if (!reader.Read()) throw new FormatException("Invalid module cfg");
                    }
                    obj["cfg"] = cfgObj;
                    continue;
                }

                SwitchToObj();
                obj[prop] = JToken.Load(reader);
            }

            if (obj == null && step == 7) {
                var facts = new ModuleFacts {
                    Id = id,
                    Type = type,
                    X = x,
                    Y = y,
                    Z = z,
                    ExactZ = z,
                    Rotation = rot,
                    Width = 1,
                    Depth = 1,
                    CeilingAnchored = false,
                    Config = ModuleConfig.Empty,
                };
                return new StationModuleRecord(
                    id, type, x, y, z, rot, 1, 1, 1,
                    false, null, null, null, null, facts,
                    0, 0, 0, canonicalSimpleSurface: true);
            }

            if (obj == null) SwitchToObj();

            if (!StationGridRepair.KeepsModule(obj)) {
                droppedModules++;
                return null;
            }
            if (obj.Property("storeyHeight") != null) obj["storeyHeight"] = 5;

            string modType = StationDocumentReader.Str(obj["type"]);
            if (modType == "sign") {
                obj = JObject.Parse(StationSignRepair.NormalizeJson(obj.ToString(Formatting.None)));
                modType = StationDocumentReader.Str(obj["type"]);
            }
            if (modType == "billboard" || modType == "tv" || modType == "busstop") {
                StationModuleRepair.AssignAdPosterSingle(obj, modType, repairs);
            }
            if (modType == "shop" || modType == "retail" || modType == "booth") {
                var cfg = obj["cfg"] as JObject;
                string fitOut = modType == "retail" ? "store"
                    : modType == "booth" ? "ticket"
                    : string.IsNullOrEmpty(StationDocumentReader.Str(cfg?["kind"])) ? "store" : StationDocumentReader.Str(cfg?["kind"]);
                if ((fitOut == "store" || fitOut == "office" || fitOut == "toilet" || fitOut == "ticket") &&
                    (cfg == null || cfg["stocked"] == null || cfg["stocked"].Type != JTokenType.Boolean || !(bool)cfg["stocked"])) {
                    hasUnstockedRoom = true;
                }
            }
            if (modType == "track") {
                var cfg = obj["cfg"] as JObject;
                if (cfg != null && cfg["bridge"] != null && cfg["bridge"].Type == JTokenType.Boolean && (bool)cfg["bridge"]) {
                    hasBridgeTrack = true;
                }
            } else if (modType == "pillar") {
                var cfg = obj["cfg"] as JObject;
                if (!string.IsNullOrEmpty(StationDocumentReader.Str(cfg?["bridgeId"]))) {
                    hasBridgePillar = true;
                }
            }

            sb.Clear();
            using (var sw = new StringWriter(sb, CultureInfo.InvariantCulture))
            using (var jw = new JsonTextWriter(sw) { Formatting = Formatting.None }) {
                obj.WriteTo(jw);
                jw.Flush();
            }
            return StationDocumentReader.BuildModule(obj, "", sb.ToString());
        }

        // ------------------------------------------------------------- record-level repairs

        static void EnsureRoomFurnitureOnRecords(List<StationModuleRecord> modules, StationRepairReport report) {
            var roomIndices = new List<int>();
            for (int i = 0; i < modules.Count; i++) {
                var t = modules[i].Type;
                if (t == "shop" || t == "retail" || t == "booth") roomIndices.Add(i);
            }
            for (int r = 0; r < roomIndices.Count; r++) {
                int idx = roomIndices[r];
                var room = modules[idx];
                var obj = JObject.Parse(room.RawJson);
                var cfg = obj["cfg"] as JObject;
                if (cfg == null) { cfg = new JObject(); obj["cfg"] = cfg; }
                string fitOut = room.Type == "retail" ? "store"
                    : room.Type == "booth" ? "ticket"
                    : string.IsNullOrEmpty(StationDocumentReader.Str(cfg["kind"])) ? "store" : StationDocumentReader.Str(cfg["kind"]);
                if (fitOut != "store" && fitOut != "office" && fitOut != "toilet" && fitOut != "ticket") continue;
                if (cfg["stocked"] != null && cfg["stocked"].Type == JTokenType.Boolean && (bool)cfg["stocked"]) continue;
                if (fitOut == "ticket") {
                    int w = Math.Max(1, StationDocumentReader.Int(obj["w"], 1));
                    int h = Math.Max(1, StationDocumentReader.Int(obj["h"], 1));
                    int x0 = room.X, y0 = room.Y, x1 = x0 + w - 1, y1 = y0 + h - 1;
                    if (y1 - 1 > y0) {
                        var taken = new HashSet<long>();
                        var takenIds = new HashSet<string>(StringComparer.Ordinal);
                        for (int i = 0; i < modules.Count; i++) {
                            var m = modules[i];
                            takenIds.Add(m.Id);
                            if (m.Z != room.Z) continue;
                            if (m.Type == "shelf" || m.Type == "desk" || m.Type == "cubicle" || m.Type == "sink" || m.Type == "bench") {
                                taken.Add(((long)(m.X + 32768) << 20) | (uint)(m.Y + 32768));
                            }
                        }
                        int y = y1 - 1;
                        for (int bx = x0 + 1; bx <= x1 - 1; bx++) {
                            long k = ((long)(bx + 32768) << 20) | (uint)(y + 32768);
                            if (!taken.Add(k)) continue;
                            int n = modules.Count + 1;
                            while (takenIds.Contains("bench-" + n)) n++;
                            string benchId = "bench-" + n;
                            takenIds.Add(benchId);
                            var benchObj = new JObject {
                                ["id"] = benchId, ["type"] = "bench",
                                ["x"] = bx, ["y"] = y, ["z"] = room.Z, ["rot"] = 2,
                                ["cfg"] = new JObject { ["auto"] = true },
                            };
                            modules.Add(StationDocumentReader.BuildModule(benchObj, "", benchObj.ToString(Formatting.None)));
                            report.RoomFurnitureModules++;
                        }
                    }
                }
                cfg["stocked"] = true;
                modules[idx] = StationDocumentReader.BuildModule(obj, "", obj.ToString(Formatting.None));
                report.RoomFurnitureRooms++;
            }
        }

        static void SyncBridgePillarsOnRecords(StationCellRecord[] cells, List<StationModuleRecord> modules, StationRepairReport report) {
            var bridges = new List<StationModuleRecord>();
            for (int i = 0; i < modules.Count; i++) {
                var m = modules[i];
                if (m.Type == "track" && m.Config.Bool("bridge")) bridges.Add(m);
            }
            var supportIds = new HashSet<string>(StringComparer.Ordinal);
            for (int b = 0; b < bridges.Count; b++) {
                var bridge = bridges[b];
                var removed = RemovedBridgePillarsOf(bridge);
                int width = Math.Max(1, bridge.Width);
                for (int i = 4; i + 4 <= width; i += 8) {
                    var id = bridge.Id + ":pillar:" + i;
                    if (!removed.Contains(id)) supportIds.Add(id);
                }
            }
            // Drop unsupported bridge-owned pillars.
            int writeIdx = 0;
            for (int i = 0; i < modules.Count; i++) {
                var m = modules[i];
                if (m.Type == "pillar") {
                    var bridgeId = m.Config.Text("bridgeId");
                    if (!string.IsNullOrEmpty(bridgeId) && !supportIds.Contains(m.Id)) {
                        report.BridgePillarsRemoved++;
                        continue;
                    }
                }
                modules[writeIdx++] = m;
            }
            if (writeIdx < modules.Count) modules.RemoveRange(writeIdx, modules.Count - writeIdx);
            if (bridges.Count == 0) return;

            // Build lookup helpers once for all bridge pillar candidates.
            var solidSet = new HashSet<StationCellKey>();
            var groundVoidSet = new HashSet<long>();
            for (int i = 0; i < cells.Length; i++) {
                var c = cells[i];
                if (c.IsSolid) solidSet.Add(c.Key);
                else if (c.Z == 0) groundVoidSet.Add(((long)(c.X + 32768) << 20) | (uint)(c.Y + 32768));
            }
            var trackCells = new HashSet<StationCellKey>();
            var groundModuleHoles = new HashSet<long>();
            for (int i = 0; i < modules.Count; i++) {
                var m = modules[i];
                if (m.Type == "track") {
                    bool isTunnelOrBridge = m.Config.Bool("tunnel") || m.Config.Bool("bridge");
                    foreach (var tc in StationFootprints.TrackCells(m)) {
                        int tx = (int)Math.Round(tc.X), ty = (int)Math.Round(tc.Y), tz = (int)Math.Round(tc.Z);
                        trackCells.Add(new StationCellKey(tx, ty, tz));
                        if (!isTunnelOrBridge && tz == 0) {
                            groundModuleHoles.Add(((long)(tx + 32768) << 20) | (uint)(ty + 32768));
                        }
                    }
                } else if (m.Type == "stair" || m.Type == "escalator" || m.Type == "walkway" || m.Type == "lift") {
                    foreach (var fc in StationFootprints.Footprint(m)) {
                        if (fc.Z == 0) groundModuleHoles.Add(((long)(fc.X + 32768) << 20) | (uint)(fc.Y + 32768));
                    }
                } else if (m.Type == "exit") {
                    string style = m.Config.Text("style");
                    if (style != "doorway" && style != "virtual") {
                        foreach (var ec in StationFootprints.ExitFootprint(m)) {
                            if (ec.Z == 0) groundModuleHoles.Add(((long)(ec.X + 32768) << 20) | (uint)(ec.Y + 32768));
                        }
                    }
                }
            }

            bool IsGroundHole(int gx, int gy) {
                long k = ((long)(gx + 32768) << 20) | (uint)(gy + 32768);
                return groundVoidSet.Contains(k) || groundModuleHoles.Contains(k);
            }

            const double BridgeDeckDepth = 1;
            for (int b = 0; b < bridges.Count; b++) {
                var bridge = bridges[b];
                var supported = new HashSet<long>();
                for (int i = 0; i < modules.Count; i++) {
                    var p = modules[i];
                    if (p.Type != "pillar") continue;
                    if (Math.Abs(p.Z + p.Config.Number("height", 0) - bridge.Z) > 1e-9) continue;
                    bool onTrack = false;
                    foreach (var tc in StationFootprints.TrackCells(bridge)) {
                        if (tc.Z == bridge.Z && tc.X == p.X && tc.Y == p.Y) { onTrack = true; break; }
                    }
                    if (onTrack) supported.Add(((long)(p.X + 32768) << 20) | (uint)(p.Y + 32768));
                }

                var removed = RemovedBridgePillarsOf(bridge);
                int width = Math.Max(1, bridge.Width);
                int depth = Math.Max(1, bridge.Depth);
                double maxBase = bridge.Z - BridgeDeckDepth - 2;
                var sites = new List<(string id, int x, int y, double z)>();
                var column = new Dictionary<long, int>();
                for (int i = 4; i + 4 <= width; i += 8) {
                    var id = bridge.Id + ":pillar:" + i;
                    if (removed.Contains(id)) continue;
                    StationFootprints.RotateLocal(bridge.Rotation, i, Math.Floor(depth / 2.0), out var dx, out var dy);
                    int sx = bridge.X + (int)Math.Round(dx);
                    int sy = bridge.Y + (int)Math.Round(dy);
                    long sk = ((long)(sx + 32768) << 20) | (uint)(sy + 32768);
                    if (supported.Contains(sk)) continue;
                    column[sk] = sites.Count;
                    sites.Add((id, sx, sy, double.NegativeInfinity));
                }
                if (sites.Count == 0) continue;

                for (int i = 0; i < cells.Length; i++) {
                    var c = cells[i];
                    if (!c.IsSolid || c.Z > maxBase) continue;
                    long ck = ((long)(c.X + 32768) << 20) | (uint)(c.Y + 32768);
                    if (!column.TryGetValue(ck, out int si)) continue;
                    if (c.Z > sites[si].z) sites[si] = (sites[si].id, sites[si].x, sites[si].y, c.Z);
                }

                for (int si = 0; si < sites.Count; si++) {
                    var site = sites[si];
                    double z = site.z;
                    if (double.IsNegativeInfinity(z) && 0 <= maxBase && !IsGroundHole(site.x, site.y)) z = 0;
                    if (double.IsNegativeInfinity(z) || double.IsNaN(z)) continue;
                    var candObj = new JObject {
                        ["id"] = site.id,
                        ["type"] = "pillar",
                        ["x"] = site.x,
                        ["y"] = site.y,
                        ["z"] = (int)z,
                        ["rot"] = 0,
                        ["cfg"] = new JObject {
                            ["size"] = "thick",
                            ["height"] = bridge.Z - z,
                            ["bridgeId"] = bridge.Id,
                        },
                    };
                    var candidate = StationDocumentReader.BuildModule(candObj, "", candObj.ToString(Formatting.None));
                    string reason = PillarPlacementReason(candidate, solidSet, trackCells, modules, IsGroundHole);
                    if (reason.Length == 0) {
                        modules.Add(candidate);
                        report.BridgePillarsAdded++;
                    } else if (reason == "unverified") {
                        report.BridgePillarCandidatesUnverified++;
                    }
                }
            }
        }

        static HashSet<string> RemovedBridgePillarsOf(StationModuleRecord bridge) {
            var removed = new HashSet<string>(StringComparer.Ordinal);
            var rawList = bridge.Config.Json("removedBridgePillars");
            if (string.IsNullOrEmpty(rawList)) return removed;
            try {
                if (JToken.Parse(rawList) is JArray arr) {
                    foreach (var item in arr) removed.Add(StationDocumentReader.Str(item));
                }
            } catch (JsonException) { }
            return removed;
        }

        static string PillarPlacementReason(
            StationModuleRecord candidate,
            HashSet<StationCellKey> solidSet,
            HashSet<StationCellKey> trackCells,
            List<StationModuleRecord> modules,
            Func<int, int, bool> isGroundHole) {
            if (!StationFootprints.TryClearance(candidate, out var box, out _)) return "unverified";
            int x0 = (int)Math.Floor(box.X0), x1 = (int)Math.Ceiling(box.X1) - 1;
            int y0 = (int)Math.Floor(box.Y0), y1 = (int)Math.Ceiling(box.Y1) - 1;
            int z0 = (int)Math.Floor(box.Z0), z1 = (int)Math.Ceiling(box.Z1) - 1;
            for (int cx = x0; cx <= x1; cx++) {
                for (int cy = y0; cy <= y1; cy++) {
                    for (int cz = z0; cz <= z1; cz++) {
                        if (!solidSet.Contains(new StationCellKey(cx, cy, cz))) continue;
                        var unit = new StationBox(cx, cy, cz, cx + 1, cy + 1, cz + 1);
                        if (box.Overlaps(unit)) return "occupied";
                    }
                }
            }
            if (!solidSet.Contains(new StationCellKey(candidate.X, candidate.Y, candidate.Z))) {
                if (candidate.Z != 0 || isGroundHole(candidate.X, candidate.Y)) return "floor";
            }
            if (trackCells.Contains(new StationCellKey(candidate.X, candidate.Y, candidate.Z)) ||
                trackCells.Contains(new StationCellKey(candidate.X, candidate.Y, candidate.Z + 1))) return "track";
            bool unverified = false;
            for (int i = 0; i < modules.Count; i++) {
                var existing = modules[i];
                if (existing.Id == candidate.Id) continue;
                if (!StationFootprints.TryClearance(existing, out var other, out _)) { unverified = true; continue; }
                if (other.IsEmpty) continue;
                if (other.Overlaps(box)) return "occupied";
            }
            return unverified ? "unverified" : "";
        }

        static StationRejectedException Reject(string code, StationRecordKind kind, string type, string id, string reason) =>
            new StationRejectedException(new StationRejection(code, kind, type, id, reason));
    }
}
