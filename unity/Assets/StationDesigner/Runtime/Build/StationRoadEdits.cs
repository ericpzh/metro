using System;
using System.Collections.Generic;
using System.Globalization;

namespace Metro.Build {
    /// <summary>
    /// Bridge payload for the shared road tool. JSON is owned by the command
    /// router; this type mirrors the stable shape so the router can deserialize
    /// and hand it over without touching road math.
    /// <code>
    /// road.preview: { "mode":"add"|"delete", "z":0, "from":[x,y], "to":[x,y],
    ///                 "width":6, "direction":"one-way", "rot":0, "pickedId":"road-1" }
    /// road.commit:  preview fields + { "expectedRevision": 7 }
    /// road.undo:    { "expectedRevision": 7 }
    /// road.cancel:  {}
    /// </code>
    /// </summary>
    [Serializable]
    public sealed class RoadEditRequest {
        public string mode = "add";
        public double z;
        public double[] from;
        public double[] to;
        public int width = 6;
        public string direction = "one-way";
        public int rot;
        public string pickedId;
        public int expectedRevision = -1;
    }

    /// <summary>What the ghost should draw before the document commits.</summary>
    public sealed class RoadEditPreview {
        public bool Valid;
        public string Code = "";
        public StationRoadRecord Candidate;
        /// <summary>Authored record the delete would remove (null for add).</summary>
        public string SourceId = "";
        public RoadNode FromNode;
        public RoadNode ToNode;
        public double Length;
        public int Lanes;
        public double LaneWidth;

        public static RoadEditPreview Invalid(string code) => new RoadEditPreview { Valid = false, Code = code ?? "" };
    }

    /// <summary>A revisioned document transaction. <see cref="Next"/> is the authored
    /// module list to save; derived segments are recomputed by the document layer.</summary>
    public sealed class RoadEditCommit {
        public bool Accepted;
        public string Kind = "road.add";
        public string Code = "";
        public string Message = "";
        public StationRoadRecord Record;
        /// <summary>
        /// Authored source module ID for round trips. For a split stroke a delete can
        /// hit a derived <c>-segment-N</c> rectangle; this keeps the source identity.
        /// </summary>
        public string SourceId = "";
        public List<StationRoadRecord> Previous = new List<StationRoadRecord>();
        public List<StationRoadRecord> Next = new List<StationRoadRecord>();
        public RoadEditPreview Preview;
        public int Revision;

        public static RoadEditCommit Reject(string kind, string code, string message, int revision) =>
            new RoadEditCommit { Accepted = false, Kind = kind, Code = code, Message = message, Revision = revision };
    }

    /// <summary>
    /// Port of the source <c>RoadTool.ts</c> transaction: preview never mutates the
    /// document, commit is revision-checked, delete removes one derived segment
    /// (materializing only the surviving arms of a split stroke), and undo restores
    /// the authored snapshot the caller captured before the edit.
    /// </summary>
    public static class StationRoadEdits {
        public const double NodeSnapRadius = 3;
        public const int MaxDragCells = 10000;

        /// <summary>Source pointer rounding: cells sit at integer centres for roads.</summary>
        public static RoadPosition GridPoint(IReadOnlyList<double> point, RoadPosition fallback) {
            if (point == null || point.Count < 2) return fallback;
            return new RoadPosition(Math.Round(point[0], MidpointRounding.AwayFromZero),
                Math.Round(point[1], MidpointRounding.AwayFromZero));
        }

        public static RoadEditPreview Preview(RoadGraph graph, RoadEditRequest request, IRoadSurfaceContext surfaces = null) {
            if (graph == null) throw new ArgumentNullException(nameof(graph));
            if (request == null) return RoadEditPreview.Invalid("bad-request");
            bool remove = string.Equals(request.mode, "delete", StringComparison.OrdinalIgnoreCase);
            if (remove) return PreviewDelete(graph, request);
            return PreviewAdd(graph, request, surfaces);
        }

        static RoadEditPreview PreviewAdd(RoadGraph graph, RoadEditRequest request, IRoadSurfaceContext surfaces) {
            if (request.from == null || request.from.Length < 2) return RoadEditPreview.Invalid("bad-request");
            var raw = GridPoint(request.from, default);
            double z = request.z;
            var startSnap = StationRoadDocument.Snap(graph, raw, z, NodeSnapRadius);
            var start = startSnap.Point;
            var targetSnap = request.to != null && request.to.Length >= 2
                ? StationRoadDocument.Snap(graph, GridPoint(request.to, raw), z, NodeSnapRadius)
                : startSnap;
            var target = targetSnap.Point;
            bool vertical = Math.Abs(target.Y - start.Y) >= Math.Abs(target.X - start.X);
            var end = vertical ? new RoadPosition(start.X, target.Y) : new RoadPosition(target.X, start.Y);
            bool reverse = (vertical ? end.Y < start.Y : end.X < start.X) != (StationRoadLayout.Turn(request.rot) >= 2);
            var candidate = StationRoadDocument.Between(start, end, z,
                Math.Max(1, request.width), string.IsNullOrEmpty(request.direction) ? "one-way" : request.direction,
                reverse, "road-preview");
            var layout = StationRoadLayout.Layout(candidate);
            var preview = new RoadEditPreview {
                Candidate = candidate,
                Length = Math.Sqrt((end.X - start.X) * (end.X - start.X) + (end.Y - start.Y) * (end.Y - start.Y)),
                Lanes = layout.Lanes,
                LaneWidth = layout.LaneWidth,
            };
            if (preview.Length < 1) { preview.Code = "road-nodes-distinct"; return preview; }
            if (layout.Width * layout.Length > MaxDragCells) { preview.Code = "drag-too-large"; return preview; }
            var refusal = StationRoadLayout.PlacementRefusal(candidate, surfaces);
            if (!string.IsNullOrEmpty(refusal)) { preview.Code = refusal; return preview; }
            preview.Valid = true;
            preview.FromNode = graph.Node(StationRoadDocument.NodeId(candidate.From, z));
            preview.ToNode = graph.Node(StationRoadDocument.NodeId(candidate.To, z));
            return preview;
        }

        static RoadEditPreview PreviewDelete(RoadGraph graph, RoadEditRequest request) {
            if (request.from == null || request.from.Length < 2) return RoadEditPreview.Invalid("bad-request");
            StationRoadRecord picked = null;
            if (!string.IsNullOrEmpty(request.pickedId)) picked = graph.Segment(request.pickedId)?.Road;
            double z = picked?.Z ?? request.z;
            var p = GridPoint(request.from, default);
            var segment = StationRoadDocument.SegmentAt(graph, p, z, request.pickedId);
            if (segment == null) return RoadEditPreview.Invalid("no-road-to-remove");
            var layout = StationRoadLayout.Layout(segment.Road);
            return new RoadEditPreview {
                Valid = true, Candidate = segment.Road, SourceId = segment.SourceId,
                Length = layout.Length, Lanes = layout.Lanes, LaneWidth = layout.LaneWidth,
            };
        }

        static bool RevisionOk(int expected, int actual, out RoadEditCommit reject, string kind) {
            reject = null;
            if (expected < 0) return true;
            if (expected == actual) return true;
            reject = RoadEditCommit.Reject(kind, "revision-mismatch", $"expected revision {expected}, document is {actual}", actual);
            return false;
        }

        public static RoadEditCommit Commit(RoadGraph graph, RoadEditRequest request, int actualRevision,
            int stationModuleCount, IEnumerable<string> allModuleIds = null, IRoadSurfaceContext surfaces = null) {
            if (graph == null) throw new ArgumentNullException(nameof(graph));
            if (request == null) return RoadEditCommit.Reject("road.add", "bad-request", "missing payload", actualRevision);
            bool remove = string.Equals(request.mode, "delete", StringComparison.OrdinalIgnoreCase);
            string kind = remove ? "road.delete" : "road.add";
            if (!RevisionOk(request.expectedRevision, actualRevision, out var reject, kind)) return reject;
            var preview = Preview(graph, request, surfaces);
            if (!preview.Valid) return RoadEditCommit.Reject(kind, preview.Code, preview.Code, actualRevision);
            var previous = new List<StationRoadRecord>(graph.Authored);
            var next = new List<StationRoadRecord>(graph.Authored);
            StationRoadRecord record;
            string sourceId;
            if (remove) {
                var segment = StationRoadDocument.SegmentAt(graph,
                    GridPoint(request.from, default), request.z, request.pickedId);
                if (segment == null) return RoadEditCommit.Reject(kind, "no-road-to-remove", "no road here", actualRevision);
                record = segment.Road;
                sourceId = segment.SourceId;
                int sourceIndex = next.FindIndex(m => m.Id == segment.SourceId);
                if (sourceIndex < 0) return RoadEditCommit.Reject(kind, "no-source-road", segment.SourceId, actualRevision);
                var siblings = new List<StationRoadRecord>();
                foreach (var candidate in graph.Segments) {
                    if (candidate.Road.Id == segment.Road.Id) continue;
                    if (candidate.SourceId == segment.SourceId || candidate.Road.Id == segment.SourceId)
                        siblings.Add(candidate.Road);
                }
                next.RemoveAt(sourceIndex);
                // Materialize the surviving arms of a split stroke only; a whole
                // authored record is deleted as the single document fact it is.
                if (siblings.Count > 0) next.InsertRange(sourceIndex, siblings);
            } else {
                record = preview.Candidate.Clone();
                record.Id = StationRoadDocument.NextId(stationModuleCount, allModuleIds ?? ModuleIds(graph), "road");
                sourceId = record.Id;
                next.Add(record);
            }
            return new RoadEditCommit {
                Accepted = true, Kind = kind, Record = record, SourceId = sourceId,
                Previous = previous, Next = next, Preview = preview, Revision = actualRevision,
            };
        }

        /// <summary>Undo: restore the authored snapshot captured before the last commit.</summary>
        public static RoadEditCommit Undo(IReadOnlyList<StationRoadRecord> snapshot, int expectedRevision,
            int actualRevision) {
            string kind = "road.undo";
            if (!RevisionOk(expectedRevision, actualRevision, out var reject, kind)) return reject;
            var previous = new List<StationRoadRecord>(snapshot ?? Array.Empty<StationRoadRecord>());
            return new RoadEditCommit {
                Accepted = true, Kind = kind, Previous = previous, Next = new List<StationRoadRecord>(previous),
                Revision = actualRevision,
            };
        }

        static IEnumerable<string> ModuleIds(RoadGraph graph) {
            foreach (var module in graph.Authored) yield return module.Id;
        }

        /// <summary>Ack payload attached to the router's commit response.</summary>
        public static Dictionary<string, object> AckPayload(RoadEditCommit commit) {
            var payload = new Dictionary<string, object>(StringComparer.Ordinal) {
                ["kind"] = commit.Kind,
                ["accepted"] = commit.Accepted,
                ["code"] = commit.Code,
                ["revision"] = commit.Revision,
            };
            if (commit.Record != null) payload["record"] = string.IsNullOrEmpty(commit.SourceId) ? commit.Record.Id : commit.SourceId;
            if (commit.Preview != null) {
                payload["valid"] = commit.Preview.Valid;
                payload["previewCode"] = commit.Preview.Code;
                if (commit.Preview.Candidate != null) payload["candidate"] = commit.Preview.Candidate.Id;
            }
            var ids = new List<string>();
            foreach (var module in commit.Next) ids.Add(module.Id);
            payload["moduleIds"] = ids.ToArray();
            return payload;
        }

        /// <summary>
        /// Number of cells a preview spans (source <c>roadLayout(road).width*length</c>),
        /// exposed so the UI can show the same measure hint.
        /// </summary>
        public static double CellCount(StationRoadRecord road) {
            var layout = StationRoadLayout.Layout(road);
            return layout.Width * layout.Length;
        }

        public static string Describe(StationRoadRecord road) {
            if (road == null) return "";
            var layout = StationRoadLayout.Layout(road);
            return string.Format(CultureInfo.InvariantCulture, "{0}×{1} {2} lane{3}",
                layout.Width, layout.Length, layout.Lanes, layout.Lanes == 1 ? "" : "s");
        }
    }
}
