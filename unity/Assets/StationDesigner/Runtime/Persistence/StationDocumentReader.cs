using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>What the module migrations changed while a save was read.</summary>
    public sealed class StationRepairReport {
        public int AdPosters { get; internal set; }
        public int RoomFurnitureRooms { get; internal set; }
        public int RoomFurnitureModules { get; internal set; }
        public int BridgePillarsAdded { get; internal set; }
        public int BridgePillarsRemoved { get; internal set; }
        public int BridgePillarCandidatesUnverified { get; internal set; }
        public int Total => AdPosters + RoomFurnitureRooms + RoomFurnitureModules + BridgePillarsAdded + BridgePillarsRemoved;
        public override string ToString() =>
            "posters " + AdPosters + ", rooms " + RoomFurnitureRooms + " (+" + RoomFurnitureModules + " pieces), bridge pillars +" +
            BridgePillarsAdded + "/-" + BridgePillarsRemoved + (BridgePillarCandidatesUnverified > 0 ? ", unverified " + BridgePillarCandidatesUnverified : "");
    }

    /// <summary>A document and its index, plus everything the reader had to say.</summary>
    public sealed class StationReadResult {
        public StationReadResult(StationDocument document, StationIndex index, IReadOnlyList<StationDiagnostic> diagnostics, StationRepairReport repairs) {
            Document = document;
            Index = index;
            Diagnostics = diagnostics ?? Array.Empty<StationDiagnostic>();
            Repairs = repairs ?? new StationRepairReport();
        }
        public StationDocument Document { get; }
        public StationIndex Index { get; }
        public IReadOnlyList<StationDiagnostic> Diagnostics { get; }
        public StationRepairReport Repairs { get; }
    }

    /// <summary>
    /// The one file boundary for a station: <c>metro-save</c> v1 JSON in, a typed
    /// read-only <see cref="StationDocument"/> and <see cref="StationIndex"/> out.
    ///
    /// It reuses <see cref="StationSaveV1.Read"/> for normalization (grid, cells,
    /// signs, lines, day, ads, furniture, bridge pillars) and adds the typed
    /// projection: records, day, lines, dropped counts and the raw records for a
    /// lossless round trip. A structurally valid station with damaged content still
    /// opens — the *envelope* is what earns a refusal. A record whose migration this
    /// port does not implement is a typed <see cref="StationRejection"/> naming the
    /// type, id and reason; it is never silently dropped.
    /// </summary>
    public static class StationDocumentReader {
        public const string SaveFormat = "metro-save";
        public const int SupportedVersion = 1;
        public const string FixedSavedAt = "1970-01-01T00:00:00.000Z";

        static readonly HashSet<string> KnownModuleTypes = new HashSet<string>(StringComparer.Ordinal) {
            "ac-unit", "bench", "billboard", "bin", "booth", "busstop", "calligraphy", "cctv", "checkout", "clock",
            "court", "cubicle", "desk", "door", "electrical-cabinet", "escalator", "exit", "extinguisher", "fence",
            "floor-mark", "gate", "glass", "guidepost", "hanger", "lawn", "lift", "light", "linemap", "monitor",
            "pillar", "platform-edge", "psd-end", "rail-signal", "retail", "road", "roof", "shelf", "shop",
            "sidewalk", "sign", "sink", "stair", "tactile", "track", "traffic-light", "tree", "tv", "tvm", "urinal",
            "vending", "vent", "walkway",
        };

        /// <summary>Read a station envelope. Throws <see cref="StationRejectedException"/> on a refusal.</summary>
        public static StationReadResult Read(string json, StationSource source) {
            if (json == null) throw Reject("parse-failed", StationRecordKind.Document, "", "", "The station input is null.");
            JObject envelope;
            try {
                envelope = JObject.Parse(json);
            } catch (JsonException error) {
                throw Reject("parse-failed", StationRecordKind.Document, "", "", "The station is not valid JSON: " + error.Message);
            }
            if (!string.Equals((string)envelope["format"], SaveFormat, StringComparison.Ordinal))
                throw Reject("parse-failed", StationRecordKind.Document, "", "", "The input is not a metro-save document.");
            var versionToken = envelope["formatVersion"];
            if (versionToken != null && versionToken.Type != JTokenType.Null) {
                var version = versionToken.Type == JTokenType.Integer || versionToken.Type == JTokenType.Float
                    ? (int)Convert.ToDouble(((JValue)versionToken).Value, CultureInfo.InvariantCulture) : 0;
                if (version > SupportedVersion)
                    throw Reject("version-too-new", StationRecordKind.Document, "", "",
                        "The save format version " + version + " is newer than this build supports (" + SupportedVersion + ").");
            }
            if (!(envelope["static"] is JObject) || !(envelope["static"]["cells"] is JArray))
                throw Reject("parse-failed", StationRecordKind.Document, "", "", "The save has no station data (static.cells).");

            StationSaveV1 save;
            try {
                save = StationSaveV1.Read(envelope);
            } catch (StationRejectedException) {
                throw;
            } catch (NotSupportedException error) {
                throw Reject("unsupported-record", StationRecordKind.Document, "", "", error.Message);
            } catch (FormatException error) {
                throw Reject("parse-failed", StationRecordKind.Document, "", "", error.Message);
            }

            // The repaired state the save reader already built: projecting it in place avoids a
            // second full serialize + parse of the station (plan 29 §3).
            var state = save.State;
            var city = Str(state["cityStyle"]);
            var modules = ReadModules((JArray)state["modules"], city);
            var cells = ReadCells((JArray)state["cells"]);
            var lines = ReadLines((JArray)state["lines"]);

            var resolvedSource = source.Hash.Length == 0 ? new StationSource(source.Path, Hash(json)) : source;
            var savedAt = Str(envelope["savedAt"]);
            if (savedAt.Length == 0) savedAt = FixedSavedAt;
            DateTimeOffset savedAtValue;
            if (!DateTimeOffset.TryParse(savedAt, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out savedAtValue))
                savedAtValue = DateTimeOffset.FromUnixTimeMilliseconds(0);

            var document = new StationDocument(
                Str(state["name"]), Str(state["nameEn"]), city,
                (long)Num(state["seed"], 1234567),
                (int)Num(state["levelBase"], 0), (int)Num(state["storeyHeight"], 5),
                ReadDay(state), cells, modules, lines,
                save.DroppedCells, save.DroppedModules, resolvedSource, savedAt, save.Write(savedAtValue));

            StationIndex index;
            StationRejection rejection;
            if (!StationIndex.TryCreate(document, out index, out rejection)) throw new StationRejectedException(rejection);

            var diagnostics = new List<StationDiagnostic>(index.Diagnostics);
            var repairs = save.Repairs ?? new StationRepairReport();
            if (repairs.AdPosters > 0)
                diagnostics.Add(new StationDiagnostic("ad-posters-backfilled", StationDiagnosticSeverity.Info, "module", "",
                    repairs.AdPosters + " advertising record(s) had no poster; one was printed from the source campaign catalogue."));
            if (repairs.RoomFurnitureRooms > 0)
                diagnostics.Add(new StationDiagnostic("room-furniture-materialized", StationDiagnosticSeverity.Info, "module", "",
                    repairs.RoomFurnitureRooms + " legacy room(s) were marked stocked; " + repairs.RoomFurnitureModules + " furniture piece(s) were placed."));
            if (repairs.BridgePillarsAdded > 0 || repairs.BridgePillarsRemoved > 0)
                diagnostics.Add(new StationDiagnostic("bridge-pillars-repaired", StationDiagnosticSeverity.Info, "module", "",
                    "Bridge support repair added " + repairs.BridgePillarsAdded + " and removed " + repairs.BridgePillarsRemoved + " pillar record(s)."));
            if (repairs.BridgePillarCandidatesUnverified > 0)
                diagnostics.Add(new StationDiagnostic("bridge-pillar-unverified", StationDiagnosticSeverity.Warning, "module", "",
                    repairs.BridgePillarCandidatesUnverified + " bridge-pillar candidate(s) touched a module envelope this packet has not ported; they were left unplaced."));
            return new StationReadResult(document, index, diagnostics.AsReadOnly(), repairs);
        }

        /// <summary>Read a station from a file path; the path and content hash travel with the document.</summary>
        public static StationReadResult ReadFile(string path) {
            var json = File.ReadAllText(path, Encoding.UTF8);
            return Read(json, new StationSource(path, ""));
        }

        /// <summary>Write the committed document back as a v1 envelope with a fresh <c>savedAt</c>.</summary>
        public static string Write(StationDocument document, DateTimeOffset savedAt) {
            if (document == null) throw new ArgumentNullException(nameof(document));
            if (string.IsNullOrEmpty(document.NormalizedJson))
                throw new StationRejectedException(new StationRejection("no-document", StationRecordKind.Document, "", "",
                    "The station document has no normalized envelope to write."));
            var envelope = JObject.Parse(document.NormalizedJson);
            envelope["format"] = SaveFormat;
            envelope["formatVersion"] = SupportedVersion;
            envelope["savedAt"] = savedAt.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
            return envelope.ToString(Formatting.None);
        }

        /// <summary>Write with the current UTC time.</summary>
        public static string Write(StationDocument document) => Write(document, DateTimeOffset.UtcNow);

        /// <summary>Lower-case SHA-256 of the exact input text.</summary>
        public static string Hash(string text) {
            using (var sha = SHA256.Create()) {
                var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(text ?? ""));
                var builder = new StringBuilder(bytes.Length * 2);
                for (int i = 0; i < bytes.Length; i++) builder.Append(bytes[i].ToString("x2", CultureInfo.InvariantCulture));
                return builder.ToString();
            }
        }

        static StationRejectedException Reject(string code, StationRecordKind kind, string type, string id, string reason) =>
            new StationRejectedException(new StationRejection(code, kind, type, id, reason));

        static StationCellRecord[] ReadCells(JArray source) {
            var cells = new StationCellRecord[source.Count];
            for (int i = 0; i < source.Count; i++) {
                var cell = source[i] as JObject;
                if (cell == null) throw Reject("parse-failed", StationRecordKind.Cell, "cell", "#" + i, "A saved cell is not an object.");
                var finish = new Dictionary<string, string>(StringComparer.Ordinal);
                if (cell["finish"] is JObject faces) {
                    foreach (var face in faces.Properties()) {
                        var value = face.Value;
                        if (value == null || value.Type == JTokenType.Null) continue;
                        finish[face.Name] = value.Type == JTokenType.String ? (string)value : value.ToString(Formatting.None);
                    }
                }
                cells[i] = new StationCellRecord(
                    Int(cell["x"]), Int(cell["y"]), Int(cell["z"]),
                    Str(cell["shape"]), Str(cell["fill"]), Str(cell["zone"]),
                    StringArray(cell["tags"]), finish, Str(cell["room"]), cell.ToString(Formatting.None));
            }
            return cells;
        }

        static StationModuleRecord[] ReadModules(JArray source, string city) {
            var modules = new StationModuleRecord[source.Count];
            for (int i = 0; i < source.Count; i++) {
                var module = source[i] as JObject;
                if (module == null) throw Reject("parse-failed", StationRecordKind.Module, "module", "#" + i, "A saved module is not an object.");
                modules[i] = BuildModule(module, city);
            }
            return modules;
        }

        /// <summary>
        /// One saved module → its typed record. Shared with the repair pass, which
        /// needs the same facts to answer placement for a bridge-pillar candidate.
        /// </summary>
        internal static StationModuleRecord BuildModule(JObject module, string city) {
            var type = Str(module["type"]);
            var id = Str(module["id"]);
            if (type.Length == 0) throw Reject("unsupported-record", StationRecordKind.Module, "module", id, "The module has no type.");
            if (!KnownModuleTypes.Contains(type))
                throw Reject("unsupported-record", StationRecordKind.Module, type, id,
                    "Module type '" + type + "' has no ported migration or view in this build.");
            var facts = ModuleFactsReader.Read(module, city);
            double offsetX = 0, offsetY = 0;
            // `cfg.offset` is an array for a PSD end cover and an {x,y} object for a
            // floor-mark; both are document facts the footprint maths needs.
            if ((module["cfg"] as JObject)?["offset"] is JToken offset) {
                if (offset is JArray pair) {
                    offsetX = Num(pair.Count > 0 ? pair[0] : null);
                    offsetY = Num(pair.Count > 1 ? pair[1] : null);
                } else if (offset is JObject named) {
                    offsetX = Num(named["x"]);
                    offsetY = Num(named["y"]);
                }
            }
            return new StationModuleRecord(
                id, type, facts.X, facts.Y, facts.Z, facts.Rotation, facts.Width, facts.Depth,
                Int(module["h"], 1), facts.CeilingAnchored,
                facts.From.HasValue ? new StationPoint(facts.From.X, facts.From.Y, facts.From.Z) : (StationPoint?)null,
                facts.To.HasValue ? new StationPoint(facts.To.X, facts.To.Y, facts.To.Z) : (StationPoint?)null,
                StringArray(module["tags"]), module.ToString(Formatting.None), facts,
                Num(module["panelH"], 0), offsetX, offsetY);
        }

        static StationLineRecord[] ReadLines(JArray source) {
            var lines = new StationLineRecord[source.Count];
            for (int i = 0; i < source.Count; i++) {
                var line = source[i] as JObject;
                if (line == null) throw Reject("parse-failed", StationRecordKind.Line, "line", "#" + i, "A saved line is not an object.");
                lines[i] = new StationLineRecord(
                    Str(line["id"]), Str(line["name"]), Str(line["nameEn"]), Str(line["colour"]),
                    Str(line["stock"]), Int(line["cars"], 0), Str(line["power"]), Str(line["psd"]),
                    Str(line["direction"]), Str(line["upTerminus"]), Str(line["downTerminus"]),
                    line.ToString(Formatting.None));
            }
            return lines;
        }

        static StationDay ReadDay(JObject state) {
            var service = state["service"] as JObject;
            var morning = FirstPeak(state, 0);
            var evening = FirstPeak(state, 1);
            var demand = state["demand"] as JObject;
            var workday = demand?["workday"] as JObject;
            var offday = demand?["offday"] as JObject;
            var calendar = state["calendar"] as JObject;
            var epoch = calendar?["epoch"] as JObject;
            return new StationDay(
                new StationSpan(Num(service?["from"], 6.5 * 3600), Num(service?["to"], 23.5 * 3600)),
                new StationSpan(Num(morning["from"]), Num(morning["to"])),
                new StationSpan(Num(evening["from"]), Num(evening["to"])),
                new StationDemand(Num(workday?["amPeak"], 1), Num(workday?["pmPeak"], 0.78), Num(workday?["sharpness"], 1)),
                new StationDemand(Num(offday?["amPeak"], 0.35), Num(offday?["pmPeak"], 0.4), Num(offday?["sharpness"], 1.5)),
                Int(epoch?["year"], 2026), Int(epoch?["month"], 1), Int(epoch?["day"], 1),
                StringArray(calendar?["holidays"]));
        }

        static JObject FirstPeak(JObject state, int index) {
            if (!(state["peaks"] is JArray peaks)) return new JObject();
            return index < peaks.Count ? peaks[index] as JObject : new JObject();
        }

        static string[] StringArray(JToken token) {
            if (!(token is JArray array) || array.Count == 0) return Array.Empty<string>();
            var values = new string[array.Count];
            for (int i = 0; i < array.Count; i++) values[i] = Str(array[i]);
            return values;
        }

        internal static string Str(JToken token) {
            if (token == null || token.Type == JTokenType.Null || token.Type == JTokenType.Undefined) return "";
            // `JObject.Parse` turns an ISO timestamp into a DateTime token by default; the
            // save stores `savedAt` as a plain string, so read it back the same way.
            if (token.Type == JTokenType.Date)
                return ((DateTime)token).ToUniversalTime()
                    .ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
            return token.Type == JTokenType.String ? (string)token : token.ToString(Formatting.None);
        }

        internal static int Int(JToken token, int fallback = 0) {
            if (token == null || token.Type == JTokenType.Null) return fallback;
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float)
                return (int)Math.Round(Convert.ToDouble(((JValue)token).Value, CultureInfo.InvariantCulture));
            return fallback;
        }

        internal static double Num(JToken token, double fallback = 0) {
            if (token == null || token.Type == JTokenType.Null) return fallback;
            if (token.Type == JTokenType.Integer) return Convert.ToInt64(((JValue)token).Value, CultureInfo.InvariantCulture);
            if (token.Type == JTokenType.Float) return Convert.ToDouble(((JValue)token).Value, CultureInfo.InvariantCulture);
            return fallback;
        }
    }

    /// <summary>
    /// The module migrations the TypeScript load path applies on the way in, ported
    /// from <c>build/model/Equipment.ts</c> (<c>assignAdPosters</c>),
    /// <c>build/model/Facilities.ts</c> (<c>ensureRoomFurniture</c>) and
    /// <c>build/model/BridgePillars.ts</c> (<c>syncBridgePillars</c>).
    ///
    /// It mutates the normalized state object in place and returns what it changed.
    /// The bridge-pillar placement rule is the part of <c>sim/placement.ts</c> a
    /// pillar candidate can reach: explicit solid occupancy, floor support, track
    /// beds and module-envelope collisions. A candidate whose collision check needs a
    /// module envelope this packet has not ported is left unplaced and reported, never
    /// committed on a guess.
    /// </summary>
    public static class StationModuleRepair {
        const double BridgeDeckDepth = 1;
        const double BridgeMinZ = BridgeDeckDepth + 1;

        // The campaign catalogue, in the source's order per silhouette. A poster is a
        // stable roll from the module id, so these arrays must stay in catalogue order.
        static readonly string[] LandscapePosters =
        {
            "landscape-1-jfif", "landscape-1-jpg", "landscape-1-webp", "landscape-10-jpg",
            "landscape-11-jpg", "landscape-11-png", "landscape-12-jpg", "landscape-12-png",
            "landscape-13-png", "landscape-15-jpg", "landscape-19-jpg", "landscape-2-webp",
            "landscape-28-jpg", "landscape-3-jfif", "landscape-3-png", "landscape-31-jpg",
            "landscape-32-jpg", "landscape-33-jpg", "landscape-34-jpg", "landscape-4-png",
            "landscape-5-jfif", "landscape-5-jpeg", "landscape-5-jpg", "landscape-5-png",
            "landscape-6-jfif", "landscape-6-png", "landscape-6-webp", "landscape-7-webp",
            "landscape-8-jfif", "landscape-games-2025-blue-jpg", "landscape-guangdong-league-jpg",
            "landscape-heinz-league-jpg", "landscape-metro-security-jpg",
        };

        static readonly string[] PortraitPosters =
        {
            "portrait-1-jpeg", "portrait-1-png", "portrait-10-png", "portrait-13-jpg",
            "portrait-14-jpg", "portrait-16-jpg", "portrait-17-jpg", "portrait-2-jfif",
            "portrait-2-jpeg", "portrait-2-jpg", "portrait-2-png", "portrait-20-jpg",
            "portrait-21-jpg", "portrait-22-jpg", "portrait-23-jpg", "portrait-25-jpg",
            "portrait-27-jpg", "portrait-29-jpg", "portrait-3-jpeg", "portrait-3-webp",
            "portrait-30-jpg", "portrait-4-jfif", "portrait-4-jpeg", "portrait-4-jpg",
            "portrait-4-webp", "portrait-5-webp", "portrait-6-jpg", "portrait-7-jfif",
            "portrait-7-jpg", "portrait-7-png", "portrait-8-jpg", "portrait-8-png",
            "portrait-8-webp", "portrait-9-jpg", "portrait-9-png", "portrait-games-2025-red-jpg",
            "portrait-heinz-body-jpg",
        };

        static readonly string[] SquarePosters =
        {
            "square-18-jpg", "square-24-jpg", "square-26-jpg", "square-3-jpg",
        };

        /// <summary>Apply all three migrations to a normalized state object.</summary>
        public static StationRepairReport RepairDocument(JObject state) {
            var report = new StationRepairReport();
            // Assigning a JToken that already has a parent makes Newtonsoft clone it, which
            // would throw away every mutation made through the old instance. Only create the
            // array when the state does not carry one.
            var modules = state["modules"] as JArray;
            if (modules == null) { modules = new JArray(); state["modules"] = modules; }
            AssignAdPosters(modules, report);
            EnsureRoomFurniture(state, modules, report);
            SyncBridgePillars(state, report);
            return report;
        }

        // ------------------------------------------------------------- ad posters

        static void AssignAdPosters(JArray modules, StationRepairReport report) {
            foreach (var token in modules) {
                if (!(token is JObject module)) continue;
                var type = StationDocumentReader.Str(module["type"]);
                if (type != "billboard" && type != "tv" && type != "busstop") continue;
                var cfg = EnsureCfg(module);
                if (cfg.Property("poster") != null) continue;
                cfg["poster"] = RandomAdSlug(module, type);
                report.AdPosters++;
            }
        }

        static string RandomAdSlug(JObject module, string type) {
            var shape = type == "billboard" ? BillboardShape(StationDocumentReader.Str((module["cfg"] as JObject)?["variant"])) : "landscape";
            var choices = shape == "portrait" ? PortraitPosters : shape == "square" ? SquarePosters : LandscapePosters;
            var id = StationDocumentReader.Str(module["id"]);
            uint hash = 2166136261;
            for (int i = 0; i < id.Length; i++) {
                hash ^= id[i];
                hash *= 16777619;
            }
            return choices[hash % (uint)choices.Length];
        }

        static string BillboardShape(string variant) {
            switch (variant) {
                case "portrait": return "portrait";
                case "square": return "square";
                case "standard": return "wide";
                case "panorama": return "panorama";
                default: return "landscape";
            }
        }

        // --------------------------------------------------------- room furniture

        readonly struct FurnitureSpot {
            public FurnitureSpot(string type, int x, int y, int rot) { Type = type; X = x; Y = y; Rot = rot; }
            public string Type { get; }
            public int X { get; }
            public int Y { get; }
            public int Rot { get; }
        }

        static void EnsureRoomFurniture(JObject state, JArray modules, StationRepairReport report) {
            var rooms = new List<JObject>();
            foreach (var token in modules) {
                if (token is JObject module) {
                    var type = StationDocumentReader.Str(module["type"]);
                    if (type == "shop" || type == "retail" || type == "booth") rooms.Add(module);
                }
            }
            foreach (var room in rooms) {
                var type = StationDocumentReader.Str(room["type"]);
                var cfg = EnsureCfg(room);
                var fitOut = type == "retail" ? "store" : type == "booth" ? "ticket" : DefaultIfEmpty(StationDocumentReader.Str(cfg["kind"]), "store");
                if (fitOut != "store" && fitOut != "office" && fitOut != "toilet" && fitOut != "ticket") continue;
                if (cfg["stocked"] != null && cfg["stocked"].Type == JTokenType.Boolean && (bool)cfg["stocked"]) continue;
                if (fitOut == "ticket") {
                    var rect = RectOf(room);
                    report.RoomFurnitureModules += AddAutoFurniture(modules, StationDocumentReader.Int(room["z"]), BoothBenchSpots(rect));
                }
                cfg["stocked"] = true;
                report.RoomFurnitureRooms++;
            }
        }

        readonly struct Rect {
            public Rect(int x0, int y0, int x1, int y1, int z) { X0 = x0; Y0 = y0; X1 = x1; Y1 = y1; Z = z; }
            public int X0 { get; }
            public int Y0 { get; }
            public int X1 { get; }
            public int Y1 { get; }
            public int Z { get; }
        }

        static Rect RectOf(JObject module) {
            int w = Math.Max(1, StationDocumentReader.Int(module["w"], 1));
            int h = Math.Max(1, StationDocumentReader.Int(module["h"], 1));
            int x = StationDocumentReader.Int(module["x"]);
            int y = StationDocumentReader.Int(module["y"]);
            return new Rect(x, y, x + w - 1, y + h - 1, StationDocumentReader.Int(module["z"]));
        }

        static List<FurnitureSpot> BoothBenchSpots(Rect rect) {
            var spots = new List<FurnitureSpot>();
            const int front = 0;
            int side = ((front % 4) + 4) % 4;
            if (side % 2 == 0) {
                if (rect.Y1 - 1 <= rect.Y0) return spots;
                int y = side == 0 ? rect.Y1 - 1 : rect.Y0;
                for (int x = rect.X0 + 1; x <= rect.X1 - 1; x++) spots.Add(new FurnitureSpot("bench", x, y, (2 + side) % 4));
            } else {
                if (rect.X1 - 1 <= rect.X0) return spots;
                int x = side == 1 ? rect.X0 : rect.X1 - 1;
                for (int y = rect.Y0 + 1; y <= rect.Y1 - 1; y++) spots.Add(new FurnitureSpot("bench", x, y, (2 + side) % 4));
            }
            return spots;
        }

        static int AddAutoFurniture(JArray modules, int z, List<FurnitureSpot> spots) {
            var taken = new HashSet<string>(StringComparer.Ordinal);
            foreach (var token in modules) {
                if (!(token is JObject module)) continue;
                var type = StationDocumentReader.Str(module["type"]);
                if (type != "shelf" && type != "desk" && type != "cubicle" && type != "sink" && type != "bench") continue;
                if (StationDocumentReader.Int(module["z"]) != z) continue;
                taken.Add(StationDocumentReader.Int(module["x"]) + "," + StationDocumentReader.Int(module["y"]));
            }
            int added = 0;
            foreach (var spot in spots) {
                var key = spot.X + "," + spot.Y;
                if (!taken.Add(key)) continue;
                modules.Add(new JObject {
                    ["id"] = NextModuleId(modules, "bench"),
                    ["type"] = "bench",
                    ["x"] = spot.X,
                    ["y"] = spot.Y,
                    ["z"] = z,
                    ["rot"] = spot.Rot,
                    ["cfg"] = new JObject { ["auto"] = true },
                });
                added++;
            }
            return added;
        }

        /// <summary>Port of <c>nextModuleId</c>: first <c>&lt;type&gt;-N</c> free from N = count + 1.</summary>
        static string NextModuleId(JArray modules, string type) {
            var taken = new HashSet<string>(StringComparer.Ordinal);
            foreach (var token in modules) if (token is JObject module) taken.Add(StationDocumentReader.Str(module["id"]));
            int n = modules.Count + 1;
            while (taken.Contains(type + "-" + n)) n++;
            return type + "-" + n;
        }

        // ---------------------------------------------------------- bridge pillars

        static void SyncBridgePillars(JObject state, StationRepairReport report) {
            var modules = state["modules"] as JArray;
            if (modules == null) return;
            var cells = state["cells"] as JArray ?? new JArray();
            var bridges = new List<StationModuleRecord>();
            foreach (var token in modules) {
                if (!(token is JObject module)) continue;
                if (StationDocumentReader.Str(module["type"]) != "track") continue;
                var cfg = module["cfg"] as JObject;
                if (cfg == null || cfg["bridge"] == null || cfg["bridge"].Type != JTokenType.Boolean || !(bool)cfg["bridge"]) continue;
                bridges.Add(StationDocumentReader.BuildModule(module, ""));
            }
            if (bridges.Count == 0) {
                // Still drop an owned pillar whose bridge no longer exists.
                RemoveUnsupportedPillars(modules, new HashSet<string>(StringComparer.Ordinal), report);
                return;
            }
            var supportIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var bridge in bridges) {
                int width = Math.Max(1, bridge.Width);
                for (int i = 4; i + 4 <= width; i += 8) {
                    var id = bridge.Id + ":pillar:" + i;
                    if (!RemovedBridgePillars(bridge).Contains(id)) supportIds.Add(id);
                }
            }
            RemoveUnsupportedPillars(modules, supportIds, report);
            // No re-assignment here: `modules` is still the state's own array, and assigning
            // an attached token makes Newtonsoft clone it (dropping every change below).
            foreach (var bridge in bridges) {
                foreach (var candidate in BridgePillarCandidates(cells, modules, bridge)) {
                    var candidateJson = ToJson(candidate);
                    var reason = PillarPlacementReason(cells, modules, candidate);
                    if (reason.Length == 0) {
                        modules.Add(candidateJson);
                        report.BridgePillarsAdded++;
                    } else if (reason == "unverified") {
                        report.BridgePillarCandidatesUnverified++;
                    }
                    // 'occupied'/'floor'/'track' are the source's own refusals: the
                    // candidate is intentionally not placed, exactly as in TS.
                }
            }
        }

        static bool RemoveUnsupportedPillars(JArray modules, HashSet<string> supportIds, StationRepairReport report) {
            var keep = new JArray();
            foreach (var token in modules) {
                var module = token as JObject;
                if (module != null && StationDocumentReader.Str(module["type"]) == "pillar") {
                    var cfg = module["cfg"] as JObject;
                    var bridgeId = StationDocumentReader.Str(cfg?["bridgeId"]);
                    if (bridgeId.Length > 0 && !supportIds.Contains(StationDocumentReader.Str(module["id"]))) {
                        report.BridgePillarsRemoved++;
                        continue;
                    }
                }
                keep.Add(token);
            }
            if (report.BridgePillarsRemoved == 0) return false;
            while (modules.Count > 0) modules.RemoveAt(modules.Count - 1);
            foreach (var token in keep) modules.Add(token);
            return true;
        }

        static HashSet<string> RemovedBridgePillars(StationModuleRecord bridge) {
            var removed = new HashSet<string>(StringComparer.Ordinal);
            if (!(bridge.RawJson.Length > 0)) return removed;
            var module = JObject.Parse(bridge.RawJson);
            var list = (module["cfg"] as JObject)?["removedBridgePillars"] as JArray;
            if (list == null) return removed;
            foreach (var item in list) removed.Add(StationDocumentReader.Str(item));
            return removed;
        }

        static List<StationModuleRecord> BridgePillarCandidates(JArray cells, JArray modules, StationModuleRecord bridge) {
            var candidates = new List<StationModuleRecord>();
            if (!bridge.Config.Bool("bridge")) return candidates;
            var supported = new HashSet<string>(StringComparer.Ordinal);
            foreach (var token in modules) {
                if (!(token is JObject existing)) continue;
                if (StationDocumentReader.Str(existing["type"]) != "pillar") continue;
                var pillar = TryBuildModule(existing);
                if (pillar != null && PillarSupportsBridge(pillar, bridge)) supported.Add(pillar.X + "," + pillar.Y);
            }
            var removed = RemovedBridgePillars(bridge);
            int width = Math.Max(1, bridge.Width);
            int depth = Math.Max(1, bridge.Depth);
            double maxBase = bridge.Z - BridgeDeckDepth - 2;
            var sites = new List<StationModuleRecord>();
            var column = new Dictionary<string, int>(StringComparer.Ordinal);
            for (int i = 4; i + 4 <= width; i += 8) {
                var id = bridge.Id + ":pillar:" + i;
                if (removed.Contains(id)) continue;
                StationFootprints.RotateLocal(bridge.Rotation, i, Math.Floor(depth / 2.0), out var dx, out var dy);
                int x = bridge.X + (int)Math.Round(dx);
                int y = bridge.Y + (int)Math.Round(dy);
                if (supported.Contains(x + "," + y)) continue;
                sites.Add(Candidate(id, x, y, double.NegativeInfinity, bridge));
                column[x + "," + y] = sites.Count - 1;
            }
            if (sites.Count == 0) return candidates;
            foreach (var token in cells) {
                if (!(token is JObject cell)) continue;
                if (StationDocumentReader.Str(cell["fill"]) != "solid") continue;
                int x = StationDocumentReader.Int(cell["x"]);
                int y = StationDocumentReader.Int(cell["y"]);
                double z = StationDocumentReader.Num(cell["z"]);
                if (z > maxBase) continue;
                if (!column.TryGetValue(x + "," + y, out var index)) continue;
                if (z > sites[index].Z) sites[index] = Candidate(sites[index].Id, x, y, z, bridge);
            }
            var holeReader = new GroundHoleReader(cells, modules);
            foreach (var site in sites) {
                double z = site.Z;
                if (double.IsNegativeInfinity(z) && 0 <= maxBase && !holeReader.IsHole(site.X, site.Y)) z = 0;
                if (double.IsNegativeInfinity(z) || double.IsNaN(z)) continue;
                candidates.Add(Candidate(site.Id, site.X, site.Y, z, bridge));
            }
            return candidates;
        }

        static StationModuleRecord Candidate(string id, int x, int y, double z, StationModuleRecord bridge) {
            var cfg = new JObject {
                ["size"] = "thick",
                ["height"] = bridge.Z - z,
                ["bridgeId"] = bridge.Id,
            };
            var json = new JObject {
                ["id"] = id, ["type"] = "pillar", ["x"] = x, ["y"] = y, ["z"] = (int)z, ["rot"] = 0, ["cfg"] = cfg,
            };
            return StationDocumentReader.BuildModule(json, "");
        }

        static bool PillarSupportsBridge(StationModuleRecord pillar, StationModuleRecord bridge) {
            if (pillar.Type != "pillar" || bridge.Type != "track" || !bridge.Config.Bool("bridge")) return false;
            if (Math.Abs(pillar.Z + pillar.Config.Number("height", 0) - bridge.Z) > 1e-9) return false;
            return TrackCellAt(bridge, pillar.X, pillar.Y, bridge.Z);
        }

        static bool TrackCellAt(StationModuleRecord track, int x, int y, int z) {
            if (track.Z != z) return false;
            foreach (var cell in StationFootprints.TrackCells(track))
                if (cell.X == x && cell.Y == y) return true;
            return false;
        }

        static StationModuleRecord TryBuildModule(JObject module) {
            try { return StationDocumentReader.BuildModule(module, ""); } catch (StationRejectedException) { return null; }
        }

        static JObject ToJson(StationModuleRecord module) {
            var json = JObject.Parse(module.RawJson);
            return json;
        }

        /// <summary>
        /// The placement rule a bridge-pillar candidate reaches, ported from
        /// <c>equipmentReason</c>: solid occupancy, floor support, track beds and
        /// module collisions. <c>"unverified"</c> means a collided record's envelope
        /// is not ported, so the candidate is refused rather than guessed.
        /// </summary>
        static string PillarPlacementReason(JArray cells, JArray modules, StationModuleRecord candidate) {
            if (!StationFootprints.TryClearance(candidate, out var box, out _)) return "unverified";
            foreach (var token in cells) {
                if (!(token is JObject cell) || StationDocumentReader.Str(cell["fill"]) != "solid") continue;
                var unit = new StationBox(
                    StationDocumentReader.Int(cell["x"]), StationDocumentReader.Int(cell["y"]), StationDocumentReader.Num(cell["z"]),
                    StationDocumentReader.Int(cell["x"]) + 1, StationDocumentReader.Int(cell["y"]) + 1, StationDocumentReader.Num(cell["z"]) + 1);
                if (box.Overlaps(unit)) return "occupied";
            }
            if (!HasSolidAt(cells, candidate.X, candidate.Y, candidate.Z)) {
                if (candidate.Z != 0 || new GroundHoleReader(cells, modules).IsHole(candidate.X, candidate.Y)) return "floor";
            }
            if (TrackAt(modules, candidate.X, candidate.Y, candidate.Z) ||
                TrackAt(modules, candidate.X, candidate.Y, candidate.Z + 1)) return "track";
            bool unverified = false;
            foreach (var token in modules) {
                if (!(token is JObject existing)) continue;
                var module = TryBuildModule(existing);
                if (module == null) { unverified = true; continue; }
                if (module.Id == candidate.Id) continue;
                if (!StationFootprints.TryClearance(module, out var other, out _)) { unverified = true; continue; }
                if (other.IsEmpty) continue;
                if (other.Overlaps(box)) return "occupied";
            }
            return unverified ? "unverified" : "";
        }

        static bool HasSolidAt(JArray cells, int x, int y, double z) {
            foreach (var token in cells) {
                if (!(token is JObject cell)) continue;
                if (StationDocumentReader.Int(cell["x"]) != x || StationDocumentReader.Int(cell["y"]) != y) continue;
                if (Math.Abs(StationDocumentReader.Num(cell["z"]) - z) > 1e-9) continue;
                return StationDocumentReader.Str(cell["fill"]) == "solid";
            }
            return false;
        }

        static bool TrackAt(JArray modules, int x, int y, int z) {
            foreach (var token in modules) {
                if (!(token is JObject module)) continue;
                if (StationDocumentReader.Str(module["type"]) != "track") continue;
                var track = TryBuildModule(module);
                if (track != null && TrackCellAt(track, x, y, z)) return true;
            }
            return false;
        }

        /// <summary>
        /// The street plane's derived holes at one coordinate, for a pillar base
        /// (port of <c>groundHoleReader</c>): dug voids, ground-level tracks, run
        /// landings and exit floor plates. The full ramp-corridor model belongs to
        /// the ground packet; a run landing is the conservative part of it a pillar
        /// candidate can meet at grade.
        /// </summary>
        sealed class GroundHoleReader {
            readonly JArray cells;
            readonly JArray modules;
            public GroundHoleReader(JArray cells, JArray modules) { this.cells = cells; this.modules = modules; }
            public bool IsHole(int x, int y) {
                foreach (var token in cells) {
                    if (!(token is JObject cell)) continue;
                    if (StationDocumentReader.Int(cell["x"]) != x || StationDocumentReader.Int(cell["y"]) != y) continue;
                    if (Math.Abs(StationDocumentReader.Num(cell["z"])) > 1e-9) continue;
                    if (StationDocumentReader.Str(cell["fill"]) != "solid") return true;
                }
                foreach (var token in modules) {
                    if (!(token is JObject module)) continue;
                    var type = StationDocumentReader.Str(module["type"]);
                    var cfg = module["cfg"] as JObject;
                    if (type == "track" && cfg != null && cfg["tunnel"]?.Type == JTokenType.Boolean && (bool)cfg["tunnel"]) continue;
                    if (type == "track" && cfg != null && cfg["bridge"]?.Type == JTokenType.Boolean && (bool)cfg["bridge"]) continue;
                    var record = TryBuildModule(module);
                    if (record == null) continue;
                    if (type == "track" && TrackCellAt(record, x, y, 0)) return true;
                    if (type == "stair" || type == "escalator" || type == "walkway" || type == "lift") {
                        foreach (var cell in StationFootprints.Footprint(record))
                            if (cell.Z == 0 && cell.X == x && cell.Y == y) return true;
                    }
                    if (type == "exit" && StationDocumentReader.Str(cfg?["style"]) != "doorway" &&
                        StationDocumentReader.Str(cfg?["style"]) != "virtual") {
                        foreach (var cell in StationFootprints.ExitFootprint(record))
                            if (cell.Z == 0 && cell.X == x && cell.Y == y) return true;
                    }
                }
                return false;
            }
        }

        static JObject EnsureCfg(JObject module) {
            if (module["cfg"] is JObject cfg) return cfg;
            cfg = new JObject();
            module["cfg"] = cfg;
            return cfg;
        }

        static string DefaultIfEmpty(string value, string fallback) => string.IsNullOrEmpty(value) ? fallback : value;
    }
}
