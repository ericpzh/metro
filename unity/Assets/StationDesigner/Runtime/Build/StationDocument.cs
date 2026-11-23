using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Text;

namespace Metro.Build {
    /// <summary>
    /// One saved module/cell coordinate in document axes: plan <c>x</c>/<c>y</c>
    /// followed by elevation <c>z</c>. Plain data, no engine references, so the
    /// document and the loading tests run without a scene.
    /// </summary>
    public readonly struct StationPoint : IEquatable<StationPoint> {
        /// <summary>
        /// Coordinates are doubles because a wide escalator's landings sit at
        /// half-cell offsets in the source's own run geometry; saved cells are
        /// always integers, so this stays exact for every document record.
        /// </summary>
        public StationPoint(double x, double y, double z) { X = x; Y = y; Z = z; }
        public double X { get; }
        public double Y { get; }
        public double Z { get; }
        public bool Equals(StationPoint other) => X == other.X && Y == other.Y && Z == other.Z;
        public override bool Equals(object obj) => obj is StationPoint other && Equals(other);
        public override int GetHashCode() => unchecked(((X.GetHashCode() * 397) ^ Y.GetHashCode()) * 397 ^ Z.GetHashCode());
        public override string ToString() => X + "," + Y + "," + Z;
        public static bool operator ==(StationPoint left, StationPoint right) => left.Equals(right);
        public static bool operator !=(StationPoint left, StationPoint right) => !left.Equals(right);
    }

    /// <summary>The immutable key of one cell: exactly the document's <c>(x,y,z)</c>.</summary>
    public readonly struct StationCellKey : IEquatable<StationCellKey> {
        public StationCellKey(int x, int y, int z) { X = x; Y = y; Z = z; }
        public int X { get; }
        public int Y { get; }
        public int Z { get; }
        public bool Equals(StationCellKey other) => X == other.X && Y == other.Y && Z == other.Z;
        public override bool Equals(object obj) => obj is StationCellKey other && Equals(other);
        public override int GetHashCode() => unchecked(((X * 397) ^ Y) * 397 ^ Z);
        public override string ToString() => X + "," + Y + "," + Z;
        public static bool operator ==(StationCellKey left, StationCellKey right) => left.Equals(right);
        public static bool operator !=(StationCellKey left, StationCellKey right) => !left.Equals(right);
    }

    public enum StationDiagnosticSeverity { Info, Warning, Error }

    /// <summary>
    /// One thing the loader had to say about a record. Codes are stable strings so
    /// the bridge can report them; they never carry a Zoo id or a path.
    /// </summary>
    public sealed class StationDiagnostic {
        public StationDiagnostic(string code, StationDiagnosticSeverity severity, string recordType, string recordId, string message) {
            Code = code ?? "";
            Severity = severity;
            RecordType = recordType ?? "";
            RecordId = recordId ?? "";
            Message = message ?? "";
        }
        public string Code { get; }
        public StationDiagnosticSeverity Severity { get; }
        public string RecordType { get; }
        public string RecordId { get; }
        public string Message { get; }
        public override string ToString() =>
            Severity.ToString().ToLowerInvariant() + " " + Code + " [" + RecordType + " " + RecordId + "] " + Message;
    }

    public enum StationRecordKind { Cell, Module, Line, Document }

    /// <summary>
    /// A typed, actionable refusal: what was rejected, which record, and why. The
    /// install transaction returns this instead of a half-loaded station, and it is
    /// what an unsupported migration reports (never a silent drop).
    /// </summary>
    public sealed class StationRejection {
        public StationRejection(string code, StationRecordKind kind, string recordType, string recordId, string reason) {
            Code = code ?? "";
            Kind = kind;
            RecordType = recordType ?? "";
            RecordId = recordId ?? "";
            Reason = reason ?? "";
        }
        public string Code { get; }
        public StationRecordKind Kind { get; }
        public string RecordType { get; }
        public string RecordId { get; }
        public string Reason { get; }
        public string Message => Code + " (" + Kind.ToString().ToLowerInvariant() + " " + RecordType + " " + RecordId + "): " + Reason;
        public override string ToString() => Message;
    }

    /// <summary>Thrown by the strict entry points; carries the same typed refusal.</summary>
    public sealed class StationRejectedException : Exception {
        public StationRejectedException(StationRejection rejection) : base(rejection?.Message ?? "Station rejected") {
            Rejection = rejection ?? new StationRejection("parse-failed", StationRecordKind.Document, "", "", "Unknown rejection");
        }
        public StationRejection Rejection { get; }
    }

    /// <summary>Where a document came from: a file path and/or a content hash.</summary>
    public readonly struct StationSource {
        public StationSource(string path, string hash) { Path = path ?? ""; Hash = hash ?? ""; }
        public string Path { get; }
        public string Hash { get; }
        public static StationSource None => new StationSource("", "");
        public override string ToString() => Path.Length == 0 ? Hash : Path + " " + Hash;
    }

    /// <summary>One directional face finish of a cell; faces are the save's own keys.</summary>
    public static class StationFinishFace {
        public const string Top = "top";
        public const string Bottom = "bottom";
        public const string North = "n";
        public const string South = "s";
        public const string East = "e";
        public const string West = "w";
    }

    /// <summary>
    /// Compact insertion-ordered finish map (typically 1-6 faces) that is shared across
    /// cells with identical face finishes, avoiding 150k+ Dictionary instances on large saves.
    /// </summary>
    public sealed class CompactStringMap : IReadOnlyDictionary<string, string> {
        readonly string[] keys;
        readonly string[] values;

        public CompactStringMap(string[] keys, string[] values) {
            this.keys = keys ?? Array.Empty<string>();
            this.values = values ?? Array.Empty<string>();
        }

        public int Count => keys.Length;
        public string KeyAt(int index) => keys[index];
        public string ValueAt(int index) => values[index];

        public string this[string key] {
            get {
                if (TryGetValue(key, out var value)) return value;
                throw new KeyNotFoundException(key);
            }
        }

        public IEnumerable<string> Keys => keys;
        public IEnumerable<string> Values => values;

        public bool ContainsKey(string key) => TryGetValue(key, out _);

        public bool TryGetValue(string key, out string value) {
            if (key != null) {
                for (int i = 0; i < keys.Length; i++) {
                    if (string.Equals(keys[i], key, StringComparison.Ordinal)) {
                        value = values[i];
                        return true;
                    }
                }
            }
            value = null;
            return false;
        }

        public IEnumerator<KeyValuePair<string, string>> GetEnumerator() {
            for (int i = 0; i < keys.Length; i++) {
                yield return new KeyValuePair<string, string>(keys[i], values[i]);
            }
        }

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }

    /// <summary>
    /// One saved cell, typed. <see cref="RawJson"/> is the exact authored record,
    /// so a field this projection does not name still survives a round trip;
    /// <see cref="Finish"/> keeps every directional face the save carries.
    /// </summary>
    public sealed class StationCellRecord {
        static readonly IReadOnlyDictionary<string, string> NoFinish =
            new CompactStringMap(Array.Empty<string>(), Array.Empty<string>());
        static readonly string[] NoTags = Array.Empty<string>();

        // Packed 3-bit optional-field codes after x,y,z,fill (up to 5 fields fit in 15 bits):
        // 1=shape, 2=tags, 3=finish, 4=zone, 5=room; bit 15 marks canonical synthesis active.
        public const ushort CanonicalFlag = 0x8000;
        public const int FieldShape = 1;
        public const int FieldTags = 2;
        public const int FieldFinish = 3;
        public const int FieldZone = 4;
        public const int FieldRoom = 5;

        readonly string rawJson;
        readonly ushort canonicalKeyOrder;

        public StationCellRecord(
            int x, int y, int z, string shape, string fill, string zone, string[] tags,
            IReadOnlyDictionary<string, string> finish, string room, string rawJson)
            : this(x, y, z, shape, fill, zone, tags, finish, room, rawJson, 0) { }

        public StationCellRecord(
            int x, int y, int z, string shape, string fill, string zone, string[] tags,
            IReadOnlyDictionary<string, string> finish, string room, string rawJson, ushort canonicalKeyOrder) {
            X = x; Y = y; Z = z;
            Shape = string.IsNullOrEmpty(shape) ? "full" : shape;
            Fill = string.IsNullOrEmpty(fill) ? "solid" : fill;
            Zone = zone ?? "";
            Tags = tags != null && tags.Length > 0 ? tags : NoTags;
            Finish = finish ?? NoFinish;
            Room = room ?? "";
            this.rawJson = canonicalKeyOrder != 0 ? null : (rawJson ?? "");
            this.canonicalKeyOrder = canonicalKeyOrder;
        }

        public int X { get; }
        public int Y { get; }
        public int Z { get; }
        /// <summary>The cell's plan/interior shape id; <c>"full"</c> when the save names none.</summary>
        public string Shape { get; }
        /// <summary><c>"solid"</c> or <c>"void"</c> (the saved hole record).</summary>
        public string Fill { get; }
        public bool IsSolid => string.Equals(Fill, "solid", StringComparison.Ordinal);
        public bool IsVoid => !IsSolid;
        public StationCellKey Key => new StationCellKey(X, Y, Z);
        public StationPoint Point => new StationPoint(X, Y, Z);
        public string Zone { get; }
        /// <summary>Authored tags such as <c>painted-ground</c>; empty when none.</summary>
        public IReadOnlyList<string> Tags { get; }
        public IReadOnlyDictionary<string, string> Finish { get; }
        /// <summary>Authored room/zone label carried on the cell, when present.</summary>
        public string Room { get; }
        public string RawJson {
            get {
                if (rawJson != null) return rawJson;
                var sb = new StringBuilder(96);
                AppendRawJson(sb);
                return sb.ToString();
            }
        }

        public void AppendRawJson(StringBuilder sb) {
            if (rawJson != null) { sb.Append(rawJson); return; }
            sb.Append("{\"x\":");
            sb.Append(X.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"y\":");
            sb.Append(Y.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"z\":");
            sb.Append(Z.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"fill\":\"");
            AppendJsonEscaped(sb, Fill);
            sb.Append('"');
            int packed = canonicalKeyOrder & 0x7FFF;
            for (int shift = 0; shift < 15; shift += 3) {
                int code = (packed >> shift) & 7;
                if (code == 0) break;
                switch (code) {
                    case FieldShape:
                        sb.Append(",\"shape\":\"");
                        AppendJsonEscaped(sb, Shape);
                        sb.Append('"');
                        break;
                    case FieldTags:
                        if (Tags.Count > 0) {
                            sb.Append(",\"tags\":[");
                            for (int i = 0; i < Tags.Count; i++) {
                                if (i > 0) sb.Append(',');
                                sb.Append('"');
                                AppendJsonEscaped(sb, Tags[i]);
                                sb.Append('"');
                            }
                            sb.Append(']');
                        }
                        break;
                    case FieldFinish:
                        if (Finish.Count > 0) {
                            sb.Append(",\"finish\":{");
                            if (Finish is CompactStringMap compact) {
                                for (int i = 0; i < compact.Count; i++) {
                                    if (i > 0) sb.Append(',');
                                    sb.Append('"');
                                    AppendJsonEscaped(sb, compact.KeyAt(i));
                                    sb.Append("\":\"");
                                    AppendJsonEscaped(sb, compact.ValueAt(i));
                                    sb.Append('"');
                                }
                            } else {
                                bool firstFace = true;
                                foreach (var kv in Finish) {
                                    if (!firstFace) sb.Append(',');
                                    firstFace = false;
                                    sb.Append('"');
                                    AppendJsonEscaped(sb, kv.Key);
                                    sb.Append("\":\"");
                                    AppendJsonEscaped(sb, kv.Value);
                                    sb.Append('"');
                                }
                            }
                            sb.Append('}');
                        }
                        break;
                    case FieldZone:
                        if (Zone.Length > 0) {
                            sb.Append(",\"zone\":\"");
                            AppendJsonEscaped(sb, Zone);
                            sb.Append('"');
                        }
                        break;
                    case FieldRoom:
                        if (Room.Length > 0) {
                            sb.Append(",\"room\":\"");
                            AppendJsonEscaped(sb, Room);
                            sb.Append('"');
                        }
                        break;
                }
            }
            sb.Append('}');
        }

        internal static void AppendJsonEscaped(StringBuilder sb, string value) {
            if (string.IsNullOrEmpty(value)) return;
            for (int i = 0; i < value.Length; i++) {
                char c = value[i];
                switch (c) {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) {
                            sb.Append("\\u");
                            sb.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        } else {
                            sb.Append(c);
                        }
                        break;
                }
            }
        }

        public bool HasTag(string tag) {
            for (int i = 0; i < Tags.Count; i++) if (string.Equals(Tags[i], tag, StringComparison.Ordinal)) return true;
            return false;
        }

        public string FinishOf(string face) => Finish.TryGetValue(face, out var value) ? value : "";
        public string FinishTop => FinishOf(StationFinishFace.Top);
        public override string ToString() => "cell " + X + "," + Y + "," + Z + " " + Fill;
    }

    /// <summary>
    /// One saved module, typed, beside the plain <see cref="ModuleFacts"/> the view
    /// layer resolves. <see cref="RawJson"/> is the exact authored record.
    /// </summary>
    public sealed class StationModuleRecord {
        static readonly string[] NoTags = Array.Empty<string>();

        readonly string rawJson;
        readonly bool canonicalSimpleSurface;

        public StationModuleRecord(
            string id, string type, int x, int y, int z, int rotation, int width, int depth, int height,
            bool ceilingAnchored, StationPoint? from, StationPoint? to, string[] tags, string rawJson,
            ModuleFacts facts, double panelHeight = 0, double offsetX = 0, double offsetY = 0)
            : this(id, type, x, y, z, rotation, width, depth, height, ceilingAnchored, from, to, tags,
                  rawJson, facts, panelHeight, offsetX, offsetY, canonicalSimpleSurface: false) { }

        public StationModuleRecord(
            string id, string type, int x, int y, int z, int rotation, int width, int depth, int height,
            bool ceilingAnchored, StationPoint? from, StationPoint? to, string[] tags, string rawJson,
            ModuleFacts facts, double panelHeight, double offsetX, double offsetY, bool canonicalSimpleSurface) {
            Id = id ?? "";
            Type = type ?? "";
            X = x; Y = y; Z = z;
            Rotation = rotation;
            Width = width < 1 ? 1 : width;
            Depth = depth < 1 ? 1 : depth;
            Height = height < 1 ? 1 : height;
            CeilingAnchored = ceilingAnchored;
            From = from;
            To = to;
            Tags = tags != null && tags.Length > 0 ? tags : NoTags;
            this.rawJson = canonicalSimpleSurface ? null : (rawJson ?? "");
            this.canonicalSimpleSurface = canonicalSimpleSurface;
            Facts = facts;
            PanelHeight = panelHeight;
            OffsetX = offsetX;
            OffsetY = offsetY;
        }

        public string Id { get; }
        public string Type { get; }
        public int X { get; }
        public int Y { get; }
        public int Z { get; }
        /// <summary>Exact authored elevation (<c>m.z</c>), preserving fractional wall-artwork anchors.</summary>
        public double ExactZ => Facts != null ? Facts.ExactZ : Z;
        /// <summary>Saved quarter turns counter-clockwise in plan space.</summary>
        public int Rotation { get; }
        public int Width { get; }
        public int Depth { get; }
        /// <summary>Saved room height (<c>h</c>), 1 for single-cell pieces.</summary>
        public int Height { get; }
        /// <summary>A wall inscription's printed panel height (<c>panelH</c>), 0 when absent.</summary>
        public double PanelHeight { get; }
        /// <summary>
        /// The saved in-cell offset (<c>cfg.offset</c>), as the document stores it: an
        /// array for a PSD end cover and an <c>{x,y}</c> object for a floor-mark. Kept
        /// typed because the footprint maths needs it in both shapes.
        /// </summary>
        public double OffsetX { get; }
        public double OffsetY { get; }
        public bool CeilingAnchored { get; }
        public StationPoint? From { get; }
        public StationPoint? To { get; }
        public IReadOnlyList<string> Tags { get; }
        public string RawJson {
            get {
                if (rawJson != null) return rawJson;
                var sb = new StringBuilder(96);
                AppendRawJson(sb);
                return sb.ToString();
            }
        }

        public void AppendRawJson(StringBuilder sb) {
            if (rawJson != null) { sb.Append(rawJson); return; }
            sb.Append("{\"x\":");
            sb.Append(X.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"y\":");
            sb.Append(Y.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"z\":");
            sb.Append(Z.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"id\":\"");
            StationCellRecord.AppendJsonEscaped(sb, Id);
            sb.Append("\",\"type\":\"");
            StationCellRecord.AppendJsonEscaped(sb, Type);
            sb.Append("\",\"rot\":");
            sb.Append(Rotation.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"cfg\":{}}");
        }

        /// <summary>Placement/config snapshot the module views consume (never null).</summary>
        public ModuleFacts Facts { get; }
        public StationPoint Point => new StationPoint(X, Y, Z);
        public bool HasFrom => From.HasValue;
        public bool HasTo => To.HasValue;
        public ModuleConfig Config => Facts?.Config ?? ModuleConfig.Empty;
        public override string ToString() => Type + " " + Id + " at " + X + "," + Y + "," + Z + " rot " + Rotation;
    }

    /// <summary>A <c>[from, to)</c> span of the simulated day, in seconds since midnight.</summary>
    public readonly struct StationSpan {
        public StationSpan(double from, double to) { From = from; To = to; }
        public double From { get; }
        public double To { get; }
        public override string ToString() => From + "–" + To;
    }

    /// <summary>The demand curve's authored knobs for one day family.</summary>
    public readonly struct StationDemand {
        public StationDemand(double amPeak, double pmPeak, double sharpness) {
            AmPeak = amPeak; PmPeak = pmPeak; Sharpness = sharpness;
        }
        public double AmPeak { get; }
        public double PmPeak { get; }
        public double Sharpness { get; }
    }

    /// <summary>
    /// The station's authored day: operating hours, two peak windows, demand knobs
    /// and the calendar epoch/holidays. Always present, repaired into range by the
    /// reader, matching <c>toState</c>'s <c>normalize*</c> defaults.
    /// </summary>
    public sealed class StationDay {
        static readonly string[] NoHolidays = Array.Empty<string>();

        public StationDay(StationSpan service, StationSpan morningPeak, StationSpan eveningPeak,
            StationDemand workday, StationDemand offday, int epochYear, int epochMonth, int epochDay, string[] holidays) {
            Service = service;
            MorningPeak = morningPeak;
            EveningPeak = eveningPeak;
            Workday = workday;
            Offday = offday;
            EpochYear = epochYear;
            EpochMonth = epochMonth;
            EpochDay = epochDay;
            Holidays = holidays != null && holidays.Length > 0 ? holidays : NoHolidays;
        }

        public StationSpan Service { get; }
        public StationSpan MorningPeak { get; }
        public StationSpan EveningPeak { get; }
        public StationDemand Workday { get; }
        public StationDemand Offday { get; }
        public int EpochYear { get; }
        public int EpochMonth { get; }
        public int EpochDay { get; }
        public IReadOnlyList<string> Holidays { get; }
        public bool WithinService(double secondsOfDay) => secondsOfDay >= Service.From && secondsOfDay < Service.To;
        public override string ToString() => "service " + Service + " peaks " + MorningPeak + "/" + EveningPeak;
    }

    /// <summary>One saved line, typed. Track relationships are derived by <see cref="StationIndex"/>.</summary>
    public sealed class StationLineRecord {
        public StationLineRecord(
            string id, string name, string nameEn, string colour, string stock, int cars, string power,
            string psd, string direction, string upTerminus, string downTerminus, string rawJson) {
            Id = id ?? "";
            Name = name ?? "";
            NameEn = nameEn ?? "";
            Colour = colour ?? "";
            Stock = stock ?? "";
            Cars = cars;
            Power = power ?? "";
            Psd = psd ?? "";
            Direction = direction ?? "";
            UpTerminus = upTerminus ?? "";
            DownTerminus = downTerminus ?? "";
            RawJson = rawJson ?? "";
        }
        public string Id { get; }
        public string Name { get; }
        public string NameEn { get; }
        public string Colour { get; }
        public string Stock { get; }
        public int Cars { get; }
        public string Power { get; }
        public string Psd { get; }
        public string Direction { get; }
        public string UpTerminus { get; }
        public string DownTerminus { get; }
        public string RawJson { get; }
        public override string ToString() => "line " + Id + " " + Name;
    }

    /// <summary>
    /// The typed, read-only normalized station every consumer builds from. Cells and
    /// modules live in immutable <see cref="StationRecordPages{T}"/> so local edits share
    /// unchanged pages and records. <see cref="NormalizedJson"/> and exact export hashes
    /// materialize lazily on demand outside the ordinary edit transaction and are cached
    /// per document snapshot.
    /// </summary>
    public sealed class StationDocument {
        static readonly StationLineRecord[] NoLines = Array.Empty<StationLineRecord>();
        readonly StationRecordPages<StationCellRecord> cellPages;
        readonly StationRecordPages<StationModuleRecord> modulePages;
        readonly IReadOnlyList<StationLineRecord> lines;
        readonly Func<StationDocument, string> jsonMaterializer;
        readonly Func<StationDocument, string> hashMaterializer;
        string cachedNormalizedJson;
        string cachedContentHash;

        internal int[] InitialCellPageIds { get; private set; }
        internal int[] InitialModulePageIds { get; private set; }

        public StationDocument(
            string name, string nameEn, string city, long seed, int levelBase, int storeyHeight,
            StationDay day, StationCellRecord[] cells, StationModuleRecord[] modules, StationLineRecord[] lines,
            int droppedCells, int droppedModules, StationSource source, string savedAt, string normalizedJson)
            : this(name, nameEn, city, seed, levelBase, storeyHeight, day,
                  StationRecordPages<StationCellRecord>.FromArray(cells, out var cellPageIds),
                  StationRecordPages<StationModuleRecord>.FromArray(modules, out var modulePageIds),
                  new ReadOnlyCollection<StationLineRecord>(lines ?? NoLines),
                  droppedCells, droppedModules, source, savedAt, normalizedJson ?? "", null, null, null) {
            InitialCellPageIds = cellPageIds;
            InitialModulePageIds = modulePageIds;
        }

        public StationDocument(
            string name, string nameEn, string city, long seed, int levelBase, int storeyHeight,
            StationDay day, StationRecordPages<StationCellRecord> cellPages, StationRecordPages<StationModuleRecord> modulePages,
            IReadOnlyList<StationLineRecord> lines, int droppedCells, int droppedModules, StationSource source,
            string savedAt, string normalizedJson, Func<StationDocument, string> jsonMaterializer,
            Func<StationDocument, string> hashMaterializer = null, string rawRootJson = null,
            int[] initialCellPageIds = null, int[] initialModulePageIds = null) {
            Name = name ?? "";
            NameEn = nameEn ?? "";
            City = string.IsNullOrEmpty(city) ? "guangzhou" : city;
            Seed = seed;
            LevelBase = levelBase;
            StoreyHeight = storeyHeight <= 0 ? 5 : storeyHeight;
            Day = day;
            this.cellPages = cellPages ?? StationRecordPages<StationCellRecord>.Empty;
            this.modulePages = modulePages ?? StationRecordPages<StationModuleRecord>.Empty;
            this.lines = lines ?? new ReadOnlyCollection<StationLineRecord>(NoLines);
            DroppedCells = droppedCells;
            DroppedModules = droppedModules;
            Source = source;
            SavedAt = savedAt ?? "";
            cachedNormalizedJson = normalizedJson;
            this.jsonMaterializer = jsonMaterializer;
            this.hashMaterializer = hashMaterializer;
            cachedContentHash = !string.IsNullOrEmpty(source.Hash) ? source.Hash : null;
            RawRootJson = rawRootJson;
            InitialCellPageIds = initialCellPageIds;
            InitialModulePageIds = initialModulePageIds;
        }

        public StationDocument WithSnapshotMetadata(
            StationSource source, string savedAt, Func<StationDocument, string> nextJsonMaterializer,
            Func<StationDocument, string> nextHashMaterializer, string nextRawRootJson) {
            return new StationDocument(
                Name, NameEn, City, Seed, LevelBase, StoreyHeight, Day,
                cellPages, modulePages, lines, DroppedCells, DroppedModules,
                source, savedAt, null, nextJsonMaterializer ?? jsonMaterializer,
                nextHashMaterializer ?? hashMaterializer, nextRawRootJson ?? RawRootJson);
        }

        public string Name { get; }
        public string NameEn { get; }
        public string City { get; }
        public long Seed { get; }
        /// <summary>The editing grid's base offset in metres (0–4), as <c>normalizeLevelBase</c> repairs it.</summary>
        public int LevelBase { get; }
        /// <summary>Always five metres for the supported v1 grid.</summary>
        public int StoreyHeight { get; }
        public StationDay Day { get; }
        public StationRecordPages<StationCellRecord> CellPages => cellPages;
        public StationRecordPages<StationModuleRecord> ModulePages => modulePages;
        public IReadOnlyList<StationCellRecord> Cells => cellPages;
        public IReadOnlyList<StationModuleRecord> Modules => modulePages;
        public IReadOnlyList<StationLineRecord> Lines => lines;
        /// <summary>Cells the grid repair dropped on the way in (reported, never hidden).</summary>
        public int DroppedCells { get; }
        public int DroppedModules { get; }
        public StationSource Source { get; }
        public string SavedAt { get; }
        /// <summary>Canonical root metadata JSON excluding <c>savedAt</c> and <c>static</c>, when tracked.</summary>
        public string RawRootJson { get; }
        public bool HasMaterializedJson => cachedNormalizedJson != null;
        public bool HasMaterializedHash => !string.IsNullOrEmpty(cachedContentHash);

        /// <summary>The normalized <c>metro-save</c> v1 envelope; materialized lazily once when deferred.</summary>
        public string NormalizedJson {
            get {
                if (cachedNormalizedJson != null) return cachedNormalizedJson;
                cachedNormalizedJson = jsonMaterializer != null ? (jsonMaterializer(this) ?? "") : "";
                return cachedNormalizedJson;
            }
        }

        /// <summary>Materializes and caches the exact content hash on demand when deferred.</summary>
        public string EnsureContentHash() {
            if (!string.IsNullOrEmpty(cachedContentHash)) return cachedContentHash;
            if (hashMaterializer != null) {
                cachedContentHash = hashMaterializer(this) ?? "";
                return cachedContentHash;
            }
            return Source.Hash ?? "";
        }

        public string PeekMaterializedHash() => cachedContentHash;

        public int CellCount => cellPages.Count;
        public int ModuleCount => modulePages.Count;
        public int LineCount => lines.Count;

        /// <summary>
        /// The editing height the player opens at: the lowest authored metre, starting at
        /// <see cref="LevelBase"/> (<c>app/openingLevel.ts</c>). Wall artwork can carry a
        /// fractional anchor, so module heights are rounded the way the source does
        /// instead of becoming a fractional level.
        /// </summary>
        public int OpeningLevel {
            get {
                int level = LevelBase;
                foreach (var cell in cellPages) {
                    int z = cell.Z;
                    if (z < level) level = z;
                }
                foreach (var module in modulePages) {
                    if (module == null) continue;
                    int z = module.Z;
                    if (z < level) level = z;
                }
                return level;
            }
        }

        public override string ToString() =>
            Name + " (" + City + "): " + CellCount + " cells, " + ModuleCount + " modules, " + LineCount + " lines";
    }
}
