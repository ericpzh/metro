using System;
using System.Collections.Generic;
using System.Globalization;
using Metro.Build;
using Metro.Sim;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>One platform arrival as the departure cards read it.</summary>
    public struct StationTvArrival {
        /// <summary>Whole displayed minutes; −1 when this card has no service.</summary>
        public int Minutes;
        public bool AtPlatform;
        /// <summary>True while the train is inside `TRAIN_APPROACH_S` (the platform approach).</summary>
        public bool Arriving;
        public bool Present;
        /// <summary>The forecast seconds this card was derived from (diagnostics only).</summary>
        public double Seconds;
        public override string ToString() =>
            Present ? (AtPlatform ? "platform" : Arriving ? "arriving" : Minutes + "min") : "none";
    }

    /// <summary>
    /// The line one television's board prints, selected from the television's own position —
    /// `render/stationDisplay.ts:tvLineStatus`.
    /// </summary>
    public sealed class StationTvLineStatus {
        public bool HasLine;
        public string LineId = "", Name = "", Colour = "", Direction = "", Terminus = "";
        public StationTvArrival[] Arrivals = new StationTvArrival[3];
        /// <summary>The nearest service's track, or "" when no service answered.</summary>
        public string TrackId = "";
        /// <summary>Why no line was selected (diagnostics only).</summary>
        public string Note = "";
        /// <summary>Every visible string, joined: the plate's content key is built from it.</summary>
        public string Key = "";

        public int ArrivalCount {
            get {
                int count = 0;
                for (int i = 0; i < Arrivals.Length; i++) if (Arrivals[i].Present) count++;
                return count;
            }
        }
    }

    /// <summary>
    /// One service track's berth facts in document axes: exactly what the consist view draws
    /// from (`TrainConsistGeometry.TryBerth`), plus the rail's own half span along the run —
    /// `World.trainServices()`' `halfLength` (`track.w / 2`), which is the segment the source
    /// measures a television's distance against.
    /// </summary>
    public sealed class StationRailAnchor {
        public string TrackId = "", LineId = "", Direction = "";
        public double X, Y, Z, Fx, Fy;
        /// <summary>The track bed's half span along the run, metres (`track.w / 2`).</summary>
        public double HalfLength;
        public override string ToString() =>
            TrackId + " @(" + X.ToString("0.##", CultureInfo.InvariantCulture) + "," +
            Y.ToString("0.##", CultureInfo.InvariantCulture) + "," + Z.ToString("0.##", CultureInfo.InvariantCulture) +
            ") f=(" + Fx.ToString("0.##", CultureInfo.InvariantCulture) + "," + Fy.ToString("0.##", CultureInfo.InvariantCulture) +
            ") half=" + HalfLength.ToString("0.##", CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// 20 §1 — the television's **service**: which line one screen's board prints, and the three
    /// platform arrivals it lists.
    ///
    /// The port this replaces folded every live train into one global minimum and read the
    /// direction off "is slot zero active", so every board in the station printed the same train
    /// and skipped the idle-service forecasts the session already publishes. The source instead
    /// picks the **nearest service track in 3D** to the screen — rotated rails and both
    /// directions included — and reads that track's own forecast (`stationDisplay.ts`). This is
    /// that rule: the sample point is the television's own cell centre in document metres, the
    /// distance is the source's squared along-segment + across-track + vertical metric, ties keep
    /// the earlier service, and the line, its colour and its direction-specific terminus come
    /// from the document's typed lines.
    /// </summary>
    public static class StationTvSchedule {
        /// <summary>Cards per board (`stationDisplayLayout().cards`).</summary>
        public const int Cards = 3;

        static StationDocument anchorDocument;
        static IReadOnlyList<StationModuleRecord> anchorTracks;
        static IReadOnlyList<StationModuleRecord> anchorPlatformEdges;
        static Dictionary<string, StationRailAnchor> anchorCache;

        internal static object RailAnchorFingerprint(StationDocument document, StationIndex index = null) {
            if (document == null) return null;
            var idx = index != null && ReferenceEquals(index.Document, document)
                ? index
                : (StationGameHost.Active?.Index != null && ReferenceEquals(StationGameHost.Active.Index.Document, document)
                    ? StationGameHost.Active.Index
                    : null);
            return idx != null ? (object)(idx.ModulesOfType("track"), idx.ModulesOfType("platform-edge")) : document.ModulePages;
        }

        /// <summary>
        /// Every service track of every authored line, derived from the same berth facts the
        /// consist view uses. Rebuilt when the committed document (or its revision) changes, so a
        /// rail edit reaches the boards on the commit that made it.
        /// </summary>
        public static IReadOnlyDictionary<string, StationRailAnchor> Anchors(StationDocument document) {
            if (document == null) return Empty;
            var activeIdx = StationGameHost.Active?.Index != null && ReferenceEquals(StationGameHost.Active.Index.Document, document)
                ? StationGameHost.Active.Index
                : null;
            var curTracks = activeIdx?.ModulesOfType("track");
            var curEdges = activeIdx?.ModulesOfType("platform-edge");
            if (anchorCache != null && anchorDocument != null &&
                (ReferenceEquals(document, anchorDocument) ||
                 (ReferenceEquals(document.ModulePages, anchorDocument.ModulePages) && ReferenceEquals(document.Lines, anchorDocument.Lines)) ||
                 (curTracks != null && ReferenceEquals(curTracks, anchorTracks) && ReferenceEquals(curEdges, anchorPlatformEdges) && ReferenceEquals(document.Lines, anchorDocument.Lines)))) {
                anchorDocument = document;
                return anchorCache;
            }
            var map = new Dictionary<string, StationRailAnchor>(StringComparer.Ordinal);
            var lines = document.Lines;
            for (int l = 0; l < lines.Count; l++) {
                var line = lines[l];
                if (line == null) continue;
                var tracks = TrainConsistGeometry.ServiceTracks(document, line.Id);
                for (int t = 0; t < tracks.Count; t++) {
                    var track = tracks[t];
                    if (track == null || map.ContainsKey(track.Id)) continue;
                    if (!TrainConsistGeometry.TryBerth(document, line, track, (float)StationTrainPose.DefaultScale,
                            out var berth, out _)) continue;
                    map[track.Id] = new StationRailAnchor {
                        TrackId = track.Id,
                        LineId = line.Id,
                        Direction = TrackDirection(track, line),
                        X = berth.DocumentPosition.x,
                        Y = berth.DocumentPosition.y,
                        Z = berth.DocumentPosition.z,
                        Fx = berth.Facing.x,
                        Fy = berth.Facing.y,
                        // `World.trainServices()` publishes the **track bed's** half span, not the
                        // consist's, and `nearestTrainService` measures the screen against it.
                        HalfLength = Math.Max(.5, track.Width * .5),
                    };
                }
            }
            anchorDocument = document;
            anchorTracks = curTracks;
            anchorPlatformEdges = curEdges;
            anchorCache = map;
            return map;
        }

        static readonly Dictionary<string, StationRailAnchor> Empty =
            new Dictionary<string, StationRailAnchor>(StringComparer.Ordinal);

        /// <summary>`cfg.dir` with the line's own direction as the fallback.</summary>
        static string TrackDirection(StationModuleRecord track, StationLineRecord line) {
            var direction = track != null ? track.Config.Text("dir") : "";
            if (direction.Length > 0) return direction;
            return line != null && line.Direction.Length > 0 ? line.Direction : "up";
        }

        /// <summary>
        /// The service a screen at `sample` (document metres) prints. `haveFrame == false` (no
        /// simulation yet) still answers the station's first line so the plate is never blank.
        /// </summary>
        public static StationTvLineStatus Select(StationDocument document, StationMotionFrame frame,
            bool haveFrame, Vector3 sample) {
            var status = new StationTvLineStatus();
            if (document == null) { status.Note = "no-document"; return status; }
            var lines = document.Lines;
            if (lines.Count == 0) { status.Note = "no-lines"; return status; }
            var anchors = Anchors(document);
            StationTrainFrame nearest = default;
            bool hasNearest = false;
            if (haveFrame && frame.Trains != null) {
                double best = double.MaxValue;
                for (int i = 0; i < frame.Trains.Length; i++) {
                    var train = frame.Trains[i];
                    if (train.TrackId == null || !anchors.TryGetValue(train.TrackId, out var anchor)) continue;
                    if (!HasLine(lines, train.LineId)) continue;
                    double dx = sample.x - anchor.X, dy = sample.y - anchor.Y;
                    double along = Math.Max(0, Math.Abs(dx * anchor.Fx + dy * anchor.Fy) - anchor.HalfLength);
                    double across = dx * anchor.Fy - dy * anchor.Fx;
                    double dz = sample.z - anchor.Z;
                    double distance = along * along + across * across + dz * dz;
                    // `distance < best`: the earlier service wins a tie, exactly like the source.
                    if (distance >= best) continue;
                    best = distance;
                    nearest = train;
                    hasNearest = true;
                }
            }
            StationLineRecord line = null;
            if (hasNearest) line = FindLine(lines, nearest.LineId);
            if (line == null) line = lines[0];
            if (line == null) { status.Note = "no-line"; return status; }
            status.HasLine = true;
            status.LineId = line.Id;
            status.Name = line.Name.Length > 0 ? line.Name : line.Id;
            status.Colour = line.Colour;
            status.Direction = hasNearest
                ? (anchors.TryGetValue(nearest.TrackId, out var serviceAnchor) ? serviceAnchor.Direction : line.Direction)
                : line.Direction;
            if (status.Direction.Length == 0) status.Direction = "up";
            status.Terminus = TerminusOf(line, status.Direction);
            status.TrackId = hasNearest ? nearest.TrackId ?? "" : "";
            if (hasNearest) ReadArrivals(ref nearest, status.Arrivals);
            status.Note = hasNearest ? "" : "no-service";
            status.Key = KeyOf(status);
            return status;
        }

        static bool HasLine(IReadOnlyList<StationLineRecord> lines, string id) {
            for (int i = 0; i < lines.Count; i++) {
                if (lines[i] != null && string.Equals(lines[i].Id, id, StringComparison.Ordinal)) return true;
            }
            return false;
        }

        static StationLineRecord FindLine(IReadOnlyList<StationLineRecord> lines, string id) {
            for (int i = 0; i < lines.Count; i++) {
                if (lines[i] != null && string.Equals(lines[i].Id, id, StringComparison.Ordinal)) return lines[i];
            }
            return null;
        }

        /// <summary>`(direction === 'up' ? line.upTerminus : line.downTerminus) || t('up'/'down')`.</summary>
        static string TerminusOf(StationLineRecord line, string direction) {
            bool up = !string.Equals(direction, "down", StringComparison.OrdinalIgnoreCase);
            var terminus = up ? line.UpTerminus : line.DownTerminus;
            return terminus.Length > 0 ? terminus : (up ? "上行" : "下行");
        }

        /// <summary>
        /// The first three forecast arrivals, in dispatch order. The source converts seconds to
        /// whole minutes with `Math.ceil`, marks a platform stop, and marks a train inside the
        /// six-second approach as arriving; a slot a track has no forecast for is absent rather
        /// than invented.
        /// </summary>
        public static void ReadArrivals(ref StationTrainFrame train, StationTvArrival[] into) {
            if (into == null) return;
            var seconds = train.ArrivalSeconds;
            var atPlatform = train.ArrivalAtPlatform;
            for (int i = 0; i < into.Length; i++) {
                into[i] = default;
                if (seconds == null || i >= seconds.Length) continue;
                double value = seconds[i];
                bool parked = atPlatform != null && i < atPlatform.Length && atPlatform[i];
                into[i] = new StationTvArrival {
                    Present = true,
                    Seconds = value,
                    AtPlatform = parked,
                    Arriving = !parked && value <= StationSimConstants.TrainApproachSeconds,
                    Minutes = (int)Math.Ceiling(Math.Max(0, value) / 60.0),
                };
            }
        }

        /// <summary>The plate's content key: every field the painter prints.</summary>
        public static string KeyOf(StationTvLineStatus status) {
            if (status == null) return "tv|none";
            var text = new System.Text.StringBuilder(96);
            text.Append("tv|").Append(status.HasLine ? "1" : "0").Append('|')
                .Append(status.Name).Append('|').Append(status.Colour).Append('|')
                .Append(status.Direction).Append('|').Append(status.Terminus);
            for (int i = 0; i < status.Arrivals.Length; i++) {
                var arrival = status.Arrivals[i];
                text.Append('|').Append(arrival.Present ? (arrival.AtPlatform ? "p" : arrival.Arriving ? "a" :
                    arrival.Minutes.ToString(CultureInfo.InvariantCulture)) : "-");
            }
            return text.ToString();
        }

        /// <summary>Drop the per-document anchor cache (a test, or a station switch).</summary>
        public static void Reset() {
            anchorDocument = null;
            anchorCache = null;
        }
    }

    /// <summary>
    /// The reference plate's print vocabulary (`sim/i18n/messages.ts`). Only the strings the
    /// station display prints are carried; the "printed" sub-labels are English in both locales,
    /// exactly as the source has them.
    /// </summary>
    public sealed class StationDisplayWords {
        public string ThisTrain, PrintedFirst, NextTrain, PrintedNext, ThirdTrain, PrintedThird;
        public string NoLines, NoServices, AtPlatform, Arriving, Minutes, Courtesy, Up, Down;
        public string Locale = "zh-CN";

        public static bool IsChinese(string locale) =>
            locale != null && locale.StartsWith("zh", StringComparison.OrdinalIgnoreCase);

        public static StationDisplayWords For(string locale) {
            bool zh = IsChinese(locale);
            return new StationDisplayWords {
                Locale = zh ? "zh-CN" : "en",
                ThisTrain = zh ? "本趟列车开往" : "This train goes to",
                PrintedFirst = "The First Train",
                NextTrain = zh ? "下趟列车开往" : "Next train goes to",
                PrintedNext = "The Next Train",
                ThirdTrain = zh ? "第三趟列车开往" : "Third train goes to",
                PrintedThird = "The Third Train",
                NoLines = zh ? "暂无线路" : "No lines yet",
                NoServices = zh ? "暂无班次" : "No services",
                AtPlatform = zh ? "列车停站" : "Train at platform",
                Arriving = zh ? "即将到站" : "Arriving soon",
                Minutes = zh ? "{0} 分钟" : "{0} minutes",
                Courtesy = zh ? "文明乘车 请注意脚下安全" : "Travel courteously; watch your step",
                Up = zh ? "上行" : "Up",
                Down = zh ? "下行" : "Down",
            };
        }

        public string CardLabel(int card) => card == 0 ? ThisTrain : card == 1 ? NextTrain : ThirdTrain;
        public string CardSubLabel(int card) => card == 0 ? PrintedFirst : card == 1 ? PrintedNext : PrintedThird;
        public string MinutesText(int minutes) => string.Format(CultureInfo.InvariantCulture, Minutes, minutes);
        public string StatusText(StationTvArrival arrival) =>
            !arrival.Present ? NoServices : arrival.AtPlatform ? AtPlatform : arrival.Arriving ? Arriving :
            MinutesText(Math.Max(1, arrival.Minutes));
    }
}
