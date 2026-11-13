using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

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
    /// One saved cell, typed. <see cref="RawJson"/> is the exact authored record,
    /// so a field this projection does not name still survives a round trip;
    /// <see cref="Finish"/> keeps every directional face the save carries.
    /// </summary>
    public sealed class StationCellRecord {
        static readonly IReadOnlyDictionary<string, string> NoFinish =
            new ReadOnlyDictionary<string, string>(new Dictionary<string, string>(StringComparer.Ordinal));
        static readonly string[] NoTags = Array.Empty<string>();

        public StationCellRecord(
            int x, int y, int z, string shape, string fill, string zone, string[] tags,
            IReadOnlyDictionary<string, string> finish, string room, string rawJson) {
            X = x; Y = y; Z = z;
            Shape = string.IsNullOrEmpty(shape) ? "full" : shape;
            Fill = string.IsNullOrEmpty(fill) ? "solid" : fill;
            Zone = zone ?? "";
            Tags = tags != null && tags.Length > 0 ? tags : NoTags;
            Finish = finish ?? NoFinish;
            Room = room ?? "";
            RawJson = rawJson ?? "";
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
        public string RawJson { get; }

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

        public StationModuleRecord(
            string id, string type, int x, int y, int z, int rotation, int width, int depth, int height,
            bool ceilingAnchored, StationPoint? from, StationPoint? to, string[] tags, string rawJson,
            ModuleFacts facts, double panelHeight = 0, double offsetX = 0, double offsetY = 0) {
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
            RawJson = rawJson ?? "";
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
        public string RawJson { get; }
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
        public override string ToString() => From + "â€“" + To;
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
    /// The typed, read-only normalized station every consumer builds from. It is
    /// produced once by <c>StationDocumentReader.Read</c> from the normalized
    /// <c>StationSaveV1</c> state; no consumer re-parses JSON.
    ///
    /// <see cref="NormalizedJson"/> is the complete normalized v1 envelope, so
    /// saving the committed document is a lossless round trip (unknown module or
    /// cell fields included), and <see cref="RawJson"/> on each record keeps its
    /// authored record too.
    /// </summary>
    public sealed class StationDocument {
        static readonly StationCellRecord[] NoCells = Array.Empty<StationCellRecord>();
        static readonly StationModuleRecord[] NoModules = Array.Empty<StationModuleRecord>();
        static readonly StationLineRecord[] NoLines = Array.Empty<StationLineRecord>();
        readonly IReadOnlyList<StationCellRecord> cells;
        readonly IReadOnlyList<StationModuleRecord> modules;
        readonly IReadOnlyList<StationLineRecord> lines;

        public StationDocument(
            string name, string nameEn, string city, long seed, int levelBase, int storeyHeight,
            StationDay day, StationCellRecord[] cells, StationModuleRecord[] modules, StationLineRecord[] lines,
            int droppedCells, int droppedModules, StationSource source, string savedAt, string normalizedJson) {
            Name = name ?? "";
            NameEn = nameEn ?? "";
            City = string.IsNullOrEmpty(city) ? "guangzhou" : city;
            Seed = seed;
            LevelBase = levelBase;
            StoreyHeight = storeyHeight <= 0 ? 5 : storeyHeight;
            Day = day;
            this.cells = new ReadOnlyCollection<StationCellRecord>(cells ?? NoCells);
            this.modules = new ReadOnlyCollection<StationModuleRecord>(modules ?? NoModules);
            this.lines = new ReadOnlyCollection<StationLineRecord>(lines ?? NoLines);
            DroppedCells = droppedCells;
            DroppedModules = droppedModules;
            Source = source;
            SavedAt = savedAt ?? "";
            NormalizedJson = normalizedJson ?? "";
        }

        public string Name { get; }
        public string NameEn { get; }
        public string City { get; }
        public long Seed { get; }
        /// <summary>The editing grid's base offset in metres (0â€“4), as <c>normalizeLevelBase</c> repairs it.</summary>
        public int LevelBase { get; }
        /// <summary>Always five metres for the supported v1 grid.</summary>
        public int StoreyHeight { get; }
        public StationDay Day { get; }
        public IReadOnlyList<StationCellRecord> Cells => cells;
        public IReadOnlyList<StationModuleRecord> Modules => modules;
        public IReadOnlyList<StationLineRecord> Lines => lines;
        /// <summary>Cells the grid repair dropped on the way in (reported, never hidden).</summary>
        public int DroppedCells { get; }
        public int DroppedModules { get; }
        public StationSource Source { get; }
        public string SavedAt { get; }
        /// <summary>The normalized <c>metro-save</c> v1 envelope; writing it is lossless.</summary>
        public string NormalizedJson { get; }
        public int CellCount => cells.Count;
        public int ModuleCount => modules.Count;
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
                for (int i = 0; i < cells.Count; i++) {
                    int z = cells[i].Z;
                    if (z < level) level = z;
                }
                for (int i = 0; i < modules.Count; i++) {
                    var module = modules[i];
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
