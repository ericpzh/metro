using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Metro.App.Views;
using Metro.Build;
using Metro.Sim;
using NUnit.Framework;
using UnityEngine;

/// <summary>
/// Packet G oracle tests. Every expected value in <c>road-oracle.json</c> comes from
/// the real TypeScript modules (<see cref="""tools/unity-parity/record-station-roads.mjs"""/>);
/// these tests parse the shipped Zoo save and the fixtures with JsonUtility and pin
/// the C# port against that output.
/// </summary>
public class StationRoadTests {
    [Serializable] public sealed class Vec2 { public double x, y; }
    [Serializable] public sealed class Span { public double lo, hi; }
    [Serializable] public sealed class HashRow { public string input; public long hash; }
    [Serializable] public sealed class ConstantsDto {
        public double nodeSnapRadius, crosswalkDepth, step, laneWidth, trafficSpacing, trafficDensity, trafficSpeed,
            maxCatchup, signalGreen, signalAmber, signalClear, followGap;
        public int trafficCapacity;
    }
    [Serializable] public sealed class RecordDto {
        public string id, type, direction;
        public int x, y, w, d, rot;
        public double z, width, length, laneWidth;
        public bool hasFrom, hasTo, acrossX;
        public int lanes;
        public Vec2 from, to;
        public Vec2[] endpoints;
    }
    [Serializable] public sealed class SegmentDto {
        public string id, sourceId, fromNode, toNode, direction;
        public int x, y, w, d, rot;
        public double z;
        public bool hasFrom, hasTo;
        public Vec2 from, to;
    }
    [Serializable] public sealed class NodeDto {
        public string id;
        public double x, y, z;
        public string[] segments;
    }
    [Serializable] public sealed class JunctionDto {
        public string id;
        public double x0, y0, x1, y1, z;
        public bool uncontrolled;
    }
    [Serializable] public sealed class EdgeDto {
        public string road;
        public int lane, sign, junction;
        public bool axis, hasControl;
        public Vec2 start, end, control;
        public double length;
        public int[] next;
    }
    [Serializable] public sealed class SideDto {
        public int junction;
        public string road;
        public bool axis;
        public int @out;
        public double boundary;
    }
    [Serializable] public sealed class NetworkDto {
        public JunctionDto[] junctions;
        public EdgeDto[] edges;
        public int[] entries;
        public SideDto[] sides;
    }
    [Serializable] public sealed class SnapDto {
        public Vec2 probe;
        public double z, radius;
        public Vec2 point;
        public bool hasNode;
        public string nodeId, roadId, atId;
    }
    [Serializable] public sealed class InkDto {
        public string road;
        public double across, margin;
        public Span[] spans;
    }
    [Serializable] public sealed class CarDto {
        public int id, edge, previousEdge, held;
        public double distance, previousDistance, size;
        public string kind, variant;
    }
    [Serializable] public sealed class PoseDto {
        public int id, edge;
        public string kind, variant;
        public double x, y, z, heading;
    }
    [Serializable] public sealed class SignalDto {
        public string junction, phase;
        public bool uncontrolled, axis;
        public double time;
    }
    [Serializable] public sealed class TrafficDto {
        public double time, trafficTime;
        public CarDto[] cars;
        public PoseDto[] poses;
        public SignalDto[] signals;
    }
    [Serializable] public sealed class SectionDto {
        public RecordDto[] records;
        public SegmentDto[] segments;
        public NodeDto[] nodes;
        public NetworkDto network;
        public SnapDto[] snaps;
        public InkDto[] inks;
        public TrafficDto[] traffic;
    }
    [Serializable] public sealed class FixtureDto {
        public string name, description;
        public RoadInputDto[] input;
        public SectionDto expected;
    }
    [Serializable] public sealed class RoadInputDto {
        public string id, type;
        public int x, y, w, d, rot;
        public double z;
        public CfgInputDto cfg;
    }
    [Serializable] public sealed class CfgInputDto {
        public string direction;
        public double[] from, to;
    }
    [Serializable] public sealed class OracleDto {
        public int schemaVersion;
        public string generatedBy, sourceSha;
        public ConstantsDto constants;
        public HashRow[] hashes;
        public SectionDto zoo;
        public SectionDto tanwei;
        public FixtureDto[] fixtures;
    }
    [Serializable] public sealed class ZooSaveDto { public ZooStaticDto @static; }
    [Serializable] public sealed class ZooStaticDto { public ZooModuleDto[] modules; }
    [Serializable] public sealed class ZooModuleDto {
        public string id, type;
        public int x, y, w, d, rot;
        public double z;
        public CfgInputDto cfg;
    }

    static OracleDto oracle;
    static OracleDto Oracle => oracle ??= JsonUtility.FromJson<OracleDto>(File.ReadAllText(
        Path.Combine(Application.dataPath, "StationDesigner/Tests/EditMode/road-oracle.json")));

    static string ZooSavePath => Path.Combine(Application.dataPath, "StationDesigner/Zoo/ZooSave.json");

    static StationRoadRecord ToRecord(RoadInputDto r) {
        var record = new StationRoadRecord {
            Id = r.id, Type = "road", X = r.x, Y = r.y, Z = r.z, W = r.w, D = r.d,
            Rotation = ((r.rot % 4) + 4) % 4, Direction = r.cfg?.direction ?? "one-way",
        };
        if (r.cfg?.from != null && r.cfg.from.Length == 2) {
            record.HasFrom = true;
            record.From = new RoadPosition(r.cfg.from[0], r.cfg.from[1]);
        }
        if (r.cfg?.to != null && r.cfg.to.Length == 2) {
            record.HasTo = true;
            record.To = new RoadPosition(r.cfg.to[0], r.cfg.to[1]);
        }
        return record;
    }

    static StationRoadRecord ToRecord(RecordDto r) {
        var record = new StationRoadRecord {
            Id = r.id, Type = "road", X = r.x, Y = r.y, Z = r.z, W = r.w, D = r.d,
            Rotation = ((r.rot % 4) + 4) % 4, Direction = r.direction,
            HasFrom = r.hasFrom, HasTo = r.hasTo,
        };
        if (r.hasFrom) record.From = new RoadPosition(r.from.x, r.from.y);
        if (r.hasTo) record.To = new RoadPosition(r.to.x, r.to.y);
        return record;
    }

    static StationRoadRecord ToRecord(ZooModuleDto r) {
        var record = new StationRoadRecord {
            Id = r.id, Type = "road", X = r.x, Y = r.y, Z = r.z, W = r.w, D = r.d,
            Rotation = ((r.rot % 4) + 4) % 4, Direction = r.cfg?.direction ?? "one-way",
        };
        if (r.cfg?.from != null && r.cfg.from.Length == 2) { record.HasFrom = true; record.From = new RoadPosition(r.cfg.from[0], r.cfg.from[1]); }
        if (r.cfg?.to != null && r.cfg.to.Length == 2) { record.HasTo = true; record.To = new RoadPosition(r.cfg.to[0], r.cfg.to[1]); }
        return record;
    }

    static void Near(double actual, double expected, string message) =>
        Assert.AreEqual(expected, actual, 1e-6, message);

    /* --------------------------------------------------------------- G1 records */

    [Test]
    public void ReadsTheTwoZooRoadRecordsFromStaticModules() {
        var save = JsonUtility.FromJson<ZooSaveDto>(File.ReadAllText(ZooSavePath));
        Assert.NotNull(save?.@static?.modules, "Zoo save has no static.modules");
        var roads = save.@static.modules.Where(m => m.type == "road").Select(ToRecord).ToList();
        Assert.AreEqual(2, roads.Count, "Zoo should carry exactly the two authored roads");
        var fast = roads.Single(r => r.Id == "road-3717");
        var twoWay = roads.Single(r => r.Id == "road-3976");

        Assert.AreEqual("one-way", fast.Direction);
        Assert.AreEqual(3, fast.Rotation, "saved quarter turn");
        Assert.AreEqual(0, fast.Z, "elevation");
        Assert.AreEqual(6, StationRoadLayout.Layout(fast).Width, "carriageway width");
        Assert.AreEqual(86, StationRoadLayout.Layout(fast).Length);
        Assert.AreEqual(2, StationRoadLayout.Layout(fast).Lanes);
        Assert.IsTrue(fast.HasFrom && fast.HasTo);
        Assert.AreEqual(new RoadPosition(31, 3), fast.From, "authored from");
        Assert.AreEqual(new RoadPosition(111, 3), fast.To, "authored to");
        // rot >= 2 reverses one-way flow even though cfg.from/to stays authored left-to-right;
        // this is the source lane-sign rule and the reason the arrow must point -X.
        Assert.AreEqual(-1, StationRoadLayout.LaneSign(fast, 0), "one-way lane flow follows rot, not cfg.from");
        Assert.AreEqual(-1, StationRoadLayout.LaneSign(fast, 1));

        Assert.AreEqual("two-way", twoWay.Direction);
        Assert.AreEqual(3, twoWay.Rotation);
        Assert.AreEqual(12, StationRoadLayout.Layout(twoWay).Width);
        Assert.AreEqual(4, StationRoadLayout.Layout(twoWay).Lanes);
        Assert.AreEqual(new RoadPosition(34, -9), twoWay.From);
        Assert.AreEqual(new RoadPosition(108, -9), twoWay.To);
        CollectionAssert.AreEqual(new[] { 1, 1, -1, -1 },
            Enumerable.Range(0, 4).Select(lane => StationRoadLayout.LaneSign(twoWay, lane)).ToArray(),
            "two-way lanes split around the centre line");
    }

    [Test]
    public void FractionalEndpointsSurviveTheFactsAdapter() {
        var facts = new ModuleFacts {
            Id = "frac-facts", Type = "road", X = -3, Y = -1, Z = 0, Rotation = 1, Width = 17, Depth = 7,
            Config = new ModuleConfig(new Dictionary<string, string> {
                ["direction"] = "one-way", ["from"] = "[0.5,2.25]", ["to"] = "[10.5,2.25]",
            }),
        };
        var record = StationRoadRecord.FromFacts(facts);
        Assert.AreEqual(new RoadPosition(0.5, 2.25), record.From);
        Assert.AreEqual(new RoadPosition(10.5, 2.25), record.To);
        Assert.AreEqual(3.5, StationRoadLayout.Layout(record).LaneWidth, 1e-9, "padding follows roadBetween, not the authored 6 m");
    }

    /* ---------------------------------------------------------------- G1 layout */

    [Test]
    public void ZooSegmentsNodesSnapsAndInkMatchTheOracle() {
        var roads = JsonUtility.FromJson<ZooSaveDto>(File.ReadAllText(ZooSavePath)).@static.modules
            .Where(m => m.type == "road").Select(ToRecord).ToList();
        CompareSection(Oracle.zoo, roads, "zoo", 7654321);
    }

    [Test]
    public void TanweiMultiRoadNetworkAndTrafficMatchTheOracle() {
        var records = Oracle.tanwei.records.Select(ToRecord).ToList();
        Assert.AreEqual(7, records.Count, "Tanwei carries seven authored road records");
        Assert.IsTrue(records.Any(r => r.Id == "road-2186-segment-1"), "the shipped demo already contains a split segment");
        var graph = CompareSection(Oracle.tanwei, records, "tanwei", 7654321);
        var network = StationRoadLayout.Network(graph);
        Assert.AreEqual(2, network.Junctions.Count, "Tanwei's crossing forms two controlled junction rectangles");
        Assert.Greater(network.Edges.Count, 20);
        Assert.Greater(network.Edges.Count(e => e.Junction >= 0), 8, "turn connectors are derived for the crossing");
    }

    [Test]
    public void RotatedCrossingMatchesTheOracle() {
        var fixture = Oracle.fixtures.Single(f => f.name == "rotated-crossing");
        var roads = fixture.input.Select(ToRecord).ToList();
        var graph = CompareSection(fixture.expected, roads, fixture.name, 4242);
        var network = StationRoadLayout.Network(graph);
        Assert.AreEqual(1, network.Junctions.Count, "a crossing is one controlled junction");
        Assert.IsFalse(network.Junctions[0].Uncontrolled);
        Assert.AreEqual(16, network.Junctions[0].X0);
        Assert.AreEqual(24, network.Junctions[0].X1);
        Assert.AreEqual(3, network.Junctions[0].Y1);
    }

    [Test]
    public void OverpassAtAnotherElevationDoesNotIntersect() {
        var fixture = Oracle.fixtures.Single(f => f.name == "overpass");
        var roads = fixture.input.Select(ToRecord).ToList();
        var graph = CompareSection(fixture.expected, roads, fixture.name);
        Assert.AreEqual(4, graph.Nodes.Count, "two endpoint nodes per elevation");
        Assert.AreEqual(4, graph.Nodes.Select(node => node.Id).Distinct().Count(), "node ids include elevation");
        var lower = graph.Nodes.Where(node => node.Z == 0).ToArray();
        var upper = graph.Nodes.Where(node => node.Z == 4).ToArray();
        Assert.AreEqual(2, lower.Length);
        Assert.AreEqual(2, upper.Length);
        foreach (var node in lower)
            Assert.IsTrue(node.Segments.All(id => graph.Segment(id).Road.Id == "over-lower"));
        foreach (var node in upper)
            Assert.IsTrue(node.Segments.All(id => graph.Segment(id).Road.Id == "over-upper"));
        Assert.AreEqual(0, StationRoadLayout.Network(graph).Junctions.Count, "an overpass is not a junction");
    }

    [Test]
    public void LegacyRecordWithoutEndpointsDerivesInsetEndpoints() {
        var fixture = Oracle.fixtures.Single(f => f.name == "legacy-no-endpoints");
        var road = ToRecord(fixture.input[0]);
        Assert.IsFalse(road.HasFrom || road.HasTo);
        var ends = StationRoadDocument.Endpoints(road);
        Assert.AreEqual(new RoadPosition(4, 4), ends[0]);
        Assert.AreEqual(new RoadPosition(4, 26), ends[1]);
        CompareSection(fixture.expected, new List<StationRoadRecord> { road }, fixture.name);
    }

    [Test]
    public void FractionalEndpointsMatchTheOracle() {
        var fixture = Oracle.fixtures.Single(f => f.name == "fractional-endpoints");
        var road = ToRecord(fixture.input[0]);
        CompareSection(fixture.expected, new List<StationRoadRecord> { road }, fixture.name);
        var ends = StationRoadDocument.Endpoints(road);
        Assert.AreEqual(.5, ends[0].X);
        Assert.AreEqual(2.25, ends[0].Y);
        Assert.AreEqual(10.5, ends[1].X);
    }

    [Test]
    public void HashAndLaneTurnRulesMatchTheOracle() {
        foreach (var row in Oracle.hashes)
            Assert.AreEqual((uint)row.hash, StationRoadLayout.Hash(row.input), "FNV hash for " + row.input);
        Assert.AreEqual(-1, StationRoadLayout.DriverLaneOrder(false, 1), "increasing lanes run leftward for +X");
        Assert.AreEqual(RoadTurn.Left, StationRoadLayout.Turn(false, 1, true, 1));
        Assert.AreEqual(RoadTurn.Right, StationRoadLayout.Turn(false, 1, true, -1));
        Assert.IsNull(StationRoadLayout.Turn(true, 1, true, -1), "U turns are never offered");
        CollectionAssert.AreEqual(new[] { RoadTurn.Straight, RoadTurn.Right },
            StationRoadLayout.LaneMovements(1, 2, new[] { RoadTurn.Straight, RoadTurn.Right, RoadTurn.Left }).ToArray());
        CollectionAssert.AreEqual(new[] { RoadTurn.Left, RoadTurn.Straight },
            StationRoadLayout.LaneMovements(0, 1, new[] { RoadTurn.Left, RoadTurn.Straight }).ToArray());
    }

    [Test]
    public void UnresolvedRoadProducesAnExplicitDiagnosticAndNoView() {
        var root = new GameObject("road-diagnostic-test");
        try {
            var broken = StationRoadRecord.Create("road-broken", 0, 0, 0, 0, 6, 1, "one-way");
            var view = StationRoadView.BuildRecords(root.transform, new[] { broken },
                Shader.Find("Universal Render Pipeline/Lit"));
            Assert.AreEqual(0, view.Roads);
            Assert.IsTrue(view.Diagnostics.Any(d => d.ModuleId == "road-broken" && d.Code == "road-invalid-extent"),
                "diagnostic must name the module id: " + string.Join(";", view.Diagnostics));
            Assert.IsNull(root.transform.Find("road road-broken"), "no stand-in box may claim success");
        } finally {
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    /* ----------------------------------------------------------------- G2 view */

    static StationRoadView BuildZooView(Transform parent, out List<StationRoadRecord> roads) {
        roads = JsonUtility.FromJson<ZooSaveDto>(File.ReadAllText(ZooSavePath)).@static.modules
            .Where(m => m.type == "road").Select(ToRecord).ToList();
        return StationRoadView.BuildRecords(parent, roads, Shader.Find("Universal Render Pipeline/Lit"));
    }

    [Test]
    public void RoadViewDrawsBothZooRoadsFromTheirTrueLayout() {
        var root = new GameObject("road-view-test");
        try {
            var view = BuildZooView(root.transform, out var roads);
            Assert.AreEqual(2, view.Roads);
            Assert.AreEqual(0, view.SignalsBuilt, "parallel Zoo roads have no junction");
            var fast = root.transform.Find("road road-3717");
            Assert.NotNull(fast, "road-3717 group missing");
            var deck = fast.Find("deck");
            Assert.NotNull(deck, "deck renderer missing");
            var mesh = deck.GetComponent<MeshFilter>().sharedMesh;
            Assert.NotNull(mesh);
            var bounds = mesh.bounds;
            Assert.AreEqual(86, bounds.size.x, .01, "authored length along x");
            Assert.AreEqual(6, bounds.size.z, .01, "authored width along plan y");
            Assert.AreEqual(71, bounds.center.x, .01);
            Assert.AreEqual(3, bounds.center.z, .01, "plan y maps to Unity z");
            Assert.GreaterOrEqual(bounds.max.y, 1.02f, "deck sits above the elevation-0 floor top (1.0)");
            Assert.NotNull(fast.GetComponent<BoxCollider>(), "each road needs a pick collider");
            Assert.NotNull(fast.GetComponent<RoadPiece>());
            Assert.AreEqual("road-3717", fast.GetComponent<RoadPiece>().moduleId);
            Assert.NotNull(fast.Find("curb"));
            Assert.NotNull(fast.Find("markings"));
            Assert.IsNull(fast.Find("markings-yellow"), "the one-way road has no centre line");
            Assert.Greater(view.MarkingSpans, 4);
            var twoWay = root.transform.Find("road road-3976");
            Assert.NotNull(twoWay);
            Assert.NotNull(twoWay.Find("markings-yellow"), "two-way centre line is on road-3976");
            var twoWayDeck = twoWay.Find("deck").GetComponent<MeshFilter>().sharedMesh;
            Assert.AreEqual(12, twoWayDeck.bounds.size.z, .01);
            var collider = fast.GetComponent<BoxCollider>();
            Assert.IsTrue(view.TryModuleId(collider, out var picked));
            Assert.AreEqual("road-3717", picked);
        } finally {
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void CrossingViewAddsSignalsCrosswalksStopLinesAndJunctionGaps() {
        var fixture = Oracle.fixtures.Single(f => f.name == "rotated-crossing");
        var records = fixture.input.Select(ToRecord).ToList();
        var root = new GameObject("road-crossing-view-test");
        try {
            var view = StationRoadView.BuildRecords(root.transform, records, Shader.Find("Universal Render Pipeline/Lit"));
            Assert.AreEqual(2, view.Roads);
            Assert.AreEqual(4, view.Arrows, "one arrival arrow per approach lane");
            Assert.AreEqual(3, view.SignalsBuilt, "shared approach signals dedupe per junction/axis/sign");
            Assert.AreEqual(3, view.StopLines);
            Assert.AreEqual(28, view.Crosswalks, "zebra stripes on all four junction sides");
            view.SetSimTime(0);
            var phases = view.Signals.Select(head => StationRoadLayout.Signal(head.Junction, head.Axis, 0)).Distinct().ToArray();
            Assert.Greater(phases.Length, 0);
            foreach (var head in view.Signals) {
                var active = StationRoadLayout.Signal(head.Junction, head.Axis, 0);
                var expected = active == RoadSignalPhase.Red ? 0 : active == RoadSignalPhase.Amber ? 1 : 2;
                var unlit = view.Signals.Count == 0 ? null : head.Lenses[(expected + 1) % 3].sharedMaterial;
                Assert.NotNull(head.Lenses[expected].sharedMaterial);
                Assert.NotNull(unlit);
            }
            // Markings are clipped against the crossing, so no white vertex may sit
            // inside the junction rectangle: paint and zebra gaps are real geometry.
            var white = root.transform.Find("road cross-x").Find("markings").GetComponent<MeshFilter>().sharedMesh;
            Assert.LessOrEqual(white.bounds.size.x, 46f);
            foreach (var vertex in white.vertices)
                Assert.IsFalse(vertex.x > 16.2f && vertex.x < 23.8f && vertex.z > -2.8f && vertex.z < 2.8f,
                    $"paint vertex {vertex} enters the junction gap");
            Assert.Greater(view.MarkingSpans, 8);
        } finally {
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void RoadEditPreviewSnapsCommitsDeletesAndValidatesRevision() {
        var roads = JsonUtility.FromJson<ZooSaveDto>(File.ReadAllText(ZooSavePath)).@static.modules
            .Where(m => m.type == "road").Select(ToRecord).ToList();
        var graph = StationRoadDocument.Read(roads);
        var request = new RoadEditRequest {
            mode = "add", z = 0, from = new[] { 45.0, 2.0 }, to = new[] { 75.0, 2.0 },
            width = 6, direction = "one-way", rot = 1, expectedRevision = 7,
        };
        var preview = StationRoadEdits.Preview(graph, request);
        Assert.IsTrue(preview.Valid, "preview should be valid: " + preview.Code);
        Assert.AreEqual(new RoadPosition(45, 3), preview.Candidate.From, "start snaps to the existing centre line");
        Assert.AreEqual(new RoadPosition(75, 3), preview.Candidate.To);
        Assert.AreEqual(30, preview.Length, 1e-9);

        var rejected = StationRoadEdits.Commit(graph, request, 8, 4299, roads.Select(r => r.Id));
        Assert.IsFalse(rejected.Accepted);
        Assert.AreEqual("revision-mismatch", rejected.Code);
        Assert.AreEqual(0, rejected.Next.Count, "a rejected command cannot change the document");

        var committed = StationRoadEdits.Commit(graph, request, 7, 4299, roads.Select(r => r.Id));
        Assert.IsTrue(committed.Accepted, committed.Code);
        Assert.AreEqual("road.add", committed.Kind);
        Assert.AreEqual(3, committed.Next.Count);
        Assert.AreEqual(2, committed.Previous.Count);
        Assert.IsTrue(committed.Next.Any(r => r.Id == committed.Record.Id));
        Assert.IsFalse(string.IsNullOrEmpty(committed.Record.Id));
        var afterAdd = StationRoadDocument.Read(committed.Next);
        Assert.AreEqual(3, afterAdd.Authored.Count);

        var delete = new RoadEditRequest {
            mode = "delete", z = 0, from = new[] { 50.0, 2.0 }, expectedRevision = 7,
        };
        var deletePreview = StationRoadEdits.Preview(graph, delete);
        Assert.IsTrue(deletePreview.Valid, deletePreview.Code);
        Assert.AreEqual("road-3717", deletePreview.Candidate.Id);
        Assert.AreEqual("road-3717", deletePreview.SourceId, "the source module id is kept beside the derived segment");
        var removed = StationRoadEdits.Commit(graph, delete, 7, 4299, roads.Select(r => r.Id));
        Assert.IsTrue(removed.Accepted, removed.Code);
        Assert.AreEqual("road.delete", removed.Kind);
        Assert.AreEqual("road-3717", removed.SourceId, "commit reports the authored source id, not a split id");
        Assert.AreEqual(2, removed.Previous.Count);
        Assert.AreEqual(1, removed.Next.Count);
        Assert.IsFalse(removed.Next.Any(r => r.Id == "road-3717"));
        Assert.IsTrue(removed.Next.Any(r => r.Id == "road-3976"));

        var undo = StationRoadEdits.Undo(removed.Previous, 8, 8);
        Assert.IsTrue(undo.Accepted);
        Assert.AreEqual(2, undo.Next.Count);
        var staleUndo = StationRoadEdits.Undo(removed.Previous, 9, 8);
        Assert.IsFalse(staleUndo.Accepted);
        Assert.AreEqual("revision-mismatch", staleUndo.Code);

        // A delete on a split stroke must still report the authored source id: the
        // added road overlaps road-3717, so the hit rectangle is -segment-1.
        var splitDelete = new RoadEditRequest {
            mode = "delete", z = 0, from = new[] { 50.0, 2.0 }, expectedRevision = 7,
        };
        var splitPreview = StationRoadEdits.Preview(afterAdd, splitDelete);
        Assert.IsTrue(splitPreview.Valid, splitPreview.Code);
        Assert.AreEqual("road-3717", splitPreview.SourceId);
        var splitRemoved = StationRoadEdits.Commit(afterAdd, splitDelete, 7, 4299, committed.Next.Select(r => r.Id));
        Assert.IsTrue(splitRemoved.Accepted, splitRemoved.Code);
        Assert.AreEqual("road-3717", splitRemoved.SourceId);
        Assert.IsFalse(splitRemoved.Next.Any(r => r.Id == splitPreview.Candidate.Id));
        Assert.IsTrue(splitRemoved.Next.Any(r => r.Id == "road-3976"));
        Assert.IsTrue(splitRemoved.Next.Any(r => r.Id == committed.Record.Id));
    }

    [Test]
    public void RoadEditRefusesGroundBelowZeroAndOverlongDrags() {
        var graph = StationRoadDocument.Read(Array.Empty<StationRoadRecord>());
        var below = StationRoadEdits.Preview(graph, new RoadEditRequest {
            mode = "add", z = -1, from = new[] { 0.0, 0.0 }, to = new[] { 10.0, 0.0 }, width = 6, direction = "one-way", rot = 1,
        }, new EmptySurfaceContext());
        Assert.IsFalse(below.Valid);
        Assert.AreEqual("road-ground", below.Code);
        var huge = StationRoadEdits.Preview(graph, new RoadEditRequest {
            mode = "add", z = 0, from = new[] { 0.0, 0.0 }, to = new[] { 2000.0, 0.0 }, width = 6, direction = "one-way", rot = 1,
        });
        Assert.IsFalse(huge.Valid);
        Assert.AreEqual("drag-too-large", huge.Code);
    }

    /* --------------------------------------------------------------- G3 traffic */

    [Test]
    public void TrafficSnapshotsMatchTheOracleAndKeepPosesOnTheDeck() {
        var fixture = Oracle.fixtures.Single(f => f.name == "rotated-crossing");
        var roads = fixture.input.Select(ToRecord).ToList();
        var network = StationRoadLayout.Network(roads);
        var traffic = StationRoadTrafficFor(network, 4242);
        foreach (var row in fixture.expected.traffic) {
            traffic.Advance(row.time);
            Near(traffic.Time, row.trafficTime, "stepped traffic time at " + row.time);
            var cars = traffic.Cars;
            Assert.AreEqual(row.cars.Length, cars.Count, "cars at " + row.time);
            for (int i = 0; i < cars.Count; i++) {
                var car = cars[i];
                var expected = row.cars[i];
                Assert.AreEqual(expected.id, car.Id);
                Assert.AreEqual(expected.edge, car.Edge);
                Assert.AreEqual(expected.previousEdge, car.PreviousEdge);
                Near(car.Distance, expected.distance, "distance at " + row.time);
                Near(car.PreviousDistance, expected.previousDistance, "previous distance");
                Assert.AreEqual(expected.kind, car.Kind.ToString().ToLowerInvariant());
                Near(car.Size, expected.size, "size");
                Assert.AreEqual(expected.held, car.Held);
                Assert.AreEqual(expected.variant, traffic.VariantOf(car), "package variant");
            }
            var poses = new List<RoadVehiclePose>();
            traffic.Sample(row.time, poses);
            Assert.AreEqual(row.poses.Length, poses.Count);
            for (int i = 0; i < poses.Count; i++) {
                Near(poses[i].X, row.poses[i].x, "pose x");
                Near(poses[i].Y, row.poses[i].y, "pose y");
                Near(poses[i].Z, row.poses[i].z, "pose z");
                Near(poses[i].Heading, row.poses[i].heading, "pose heading");
                Assert.AreEqual(row.poses[i].variant, poses[i].Variant);
            }
            foreach (var signal in row.signals) {
                var junction = network.Junctions.Single(j => j.Id == signal.junction);
                Assert.AreEqual(signal.phase, StationRoadLayout.Signal(junction, signal.axis, row.time).ToString().ToLowerInvariant());
            }
        }
    }

    [Test]
    public void TrafficPausesResumesSeeksResetAndNeverCrossesAProhibitedTurn() {
        var fixture = Oracle.fixtures.Single(f => f.name == "rotated-crossing");
        var network = StationRoadLayout.Network(fixture.input.Select(ToRecord).ToList());
        var traffic = StationRoadTrafficFor(network, 4242);
        traffic.Advance(9.9);
        var cars = traffic.Cars.Select(c => (c.Id, c.Edge, c.Distance)).ToArray();
        traffic.Advance(9.9);
        CollectionAssert.AreEqual(cars, traffic.Cars.Select(c => (c.Id, c.Edge, c.Distance)).ToArray(),
            "re-sending the same sim time must not step or respawn");
        traffic.Advance(9.7);
        Near(traffic.Time, 9.7, "a backwards seek resets the bounded history");
        var fresh = StationRoadTrafficFor(network, 4242);
        fresh.Advance(9.7);
        CollectionAssert.AreEqual(fresh.Cars.Select(c => (c.Id, c.Edge, c.Distance)).ToArray(),
            traffic.Cars.Select(c => (c.Id, c.Edge, c.Distance)).ToArray(), "seek reset is deterministic");
        // Every connector the network offers is a legal movement; U turns are absent.
        for (int i = 0; i < network.Edges.Count; i++) {
            var edge = network.Edges[i];
            if (edge.Junction < 0) continue;
            Assert.IsTrue(edge.Next.Count > 0, "connector has a destination");
            foreach (int next in edge.Next) {
                var exit = network.Edges[next];
                Assert.IsNotNull(StationRoadLayout.Turn(edge.Axis, edge.Sign, exit.Axis, exit.Sign),
                    $"edge {i} offers an illegal U turn via {next}");
            }
        }
        // Run a minute of traffic: every car stays on a real edge and the connectors
        // it may take are only the legal turns the network built.
        for (int step = 0; step < 600; step++) {
            traffic.Advance(9.7 + (step + 1) * .1);
            foreach (var car in traffic.Cars) {
                Assert.GreaterOrEqual(car.Edge, 0);
                Assert.Less(car.Edge, network.Edges.Count);
                var edge = network.Edges[car.Edge];
                foreach (int next in edge.Next) {
                    var exit = network.Edges[next];
                    Assert.IsNotNull(StationRoadLayout.Turn(edge.Axis, edge.Sign, exit.Axis, exit.Sign),
                        $"car {car.Id} could take an illegal turn {car.Edge}->{next}");
                }
            }
        }
        Assert.Greater(traffic.Cars.Count, 0, "traffic keeps flowing after a minute");
    }

    [Test]
    public void VehicleViewsRenderTheSampledPosesAtDeckHeight() {
        var fixture = Oracle.fixtures.Single(f => f.name == "rotated-crossing");
        var network = StationRoadLayout.Network(fixture.input.Select(ToRecord).ToList());
        var traffic = StationRoadTrafficFor(network, 4242);
        traffic.Advance(17.7);
        var root = new GameObject("vehicle-view-test");
        try {
            var view = RoadVehicleViews.Build(root.transform, traffic, Shader.Find("Universal Render Pipeline/Lit"));
            view.Render(17.7);
            Assert.Greater(view.VisibleVehicles, 0, "ambient traffic should pose at least one car");
            Assert.AreEqual(view.VisibleVehicles, view.Cars + view.Buses + view.Scooters);
            foreach (var pose in view.Poses) {
                Assert.IsTrue(new[] { "suv", "sedan", "bus-orange", "bus-mosaic", "moped", "bicycle" }.Contains(pose.Variant),
                    "unexpected variant " + pose.Variant);
                Assert.AreEqual(1.05, pose.Z, 1e-9, "vehicles ride above the elevation-0 deck");
            }
            var ids = view.Poses.Select(p => p.Id).Distinct().Count();
            Assert.AreEqual(view.Poses.Count, ids);
            view.Render(17.8);
            Assert.Greater(view.VisibleVehicles, 0, "re-render keeps pooled instances");
            Assert.AreEqual(view.Poses.Count, view.VisibleVehicles, "pool reuse must not leave stale vehicles");
        } finally {
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void HiddenRoadPosesAreFilteredBeforeAPoolSlotIsEnabled() {
        var fixture = Oracle.fixtures.Single(f => f.name == "rotated-crossing");
        var network = StationRoadLayout.Network(fixture.input.Select(ToRecord).ToList());
        var traffic = StationRoadTrafficFor(network, 4242);
        traffic.Advance(17.7);
        var root = new GameObject("vehicle-filter-test");
        try {
            var view = RoadVehicleViews.Build(root.transform, traffic, Shader.Find("Universal Render Pipeline/Lit"));
            view.Render(17.7, _ => false);
            Assert.Greater(view.SampledVehicles, 0, "the simulation still sampled traffic");
            Assert.AreEqual(0, view.VisibleVehicles, "a refused level draws nobody");
            Assert.AreEqual(view.SampledVehicles, view.FilteredVehicles, "every pose was filtered");
            foreach (var pool in root.GetComponentsInChildren<Transform>(true)) {
                if (!pool.name.StartsWith("vehicle ", StringComparison.Ordinal)) continue;
                Assert.IsFalse(pool.gameObject.activeSelf, "a filtered pool slot cannot stay enabled");
            }

            // The same slots are reused when the storey comes back: the first visible pass
            // must re-pose and re-enable them, never leave the hidden frame's transforms.
            traffic.Advance(30.0);
            view.Render(30.0, pose => pose.RoadZ >= 0);
            Assert.Greater(view.VisibleVehicles, 0, "the street storey draws its traffic again");
            Assert.AreEqual(0, view.FilteredVehicles);
            var ids = new HashSet<int>();
            foreach (var pose in view.Poses) {
                Assert.IsFalse(string.IsNullOrEmpty(pose.RoadId), "a pose names its source road");
                Assert.AreEqual(0d, pose.RoadZ, 1e-9, "the Zoo road is at street level");
                Assert.IsTrue(ids.Add(pose.Id), "a pool slot shows one pose");
                Assert.IsTrue(view.TryGetRenderedVehicle(pose.Id, out var instance), "pose " + pose.Id + " is drawn");
                Assert.IsTrue(instance.gameObject.activeSelf);
            }
            Assert.AreEqual(view.Mopeds + view.Bicycles, view.Riders,
                "road riders are counted separately from the station crowd");
        } finally {
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void StationRoadRendererRegistersBothZooRoadsInTheStagedWorld() {
        var read = Metro.Persistence.StationDocumentReader.Read(File.ReadAllText(ZooSavePath), Metro.Build.StationSource.None);
        Assert.NotNull(read.Document, "A's reader must accept the shipped Zoo save");
        var parent = new GameObject("road-renderer-world");
        Metro.App.StationWorldView world = null;
        try {
            var renderer = new StationRoadRenderer();
            world = new Metro.App.StationWorldView(parent.transform, "road-test-world",
                new Metro.App.IStationViewRenderer[] { renderer });
            world.Build(read.Document, read.Index);
            world.Activate();
            Assert.AreEqual(2, world.Summary().ByRole["roads"], "both Zoo roads register under the roads role");
            Assert.IsTrue(world.TryGetModule("road-3717", out var fast));
            Assert.NotNull(fast.View);
            Assert.IsTrue(fast.HasBounds);
            Assert.AreEqual(2, renderer.Records.Length);
            Assert.NotNull(renderer.View);
            renderer.Update(12.3);
            Assert.NotNull(renderer.View);
            Assert.NotNull(renderer.Traffic);
            Assert.AreEqual(0, renderer.View.SignalsBuilt, "no Zoo junction");
        } finally {
            world?.Dispose();
            UnityEngine.Object.DestroyImmediate(parent);
        }
    }

    [Test]
    public void RendererStateSurvivesThePreviousWorldsRelease() {
        var read = Metro.Persistence.StationDocumentReader.Read(File.ReadAllText(ZooSavePath), Metro.Build.StationSource.None);
        Assert.NotNull(read.Document);
        var renderer = new StationRoadRenderer();
        var parentA = new GameObject("world-a");
        var parentB = new GameObject("world-b");
        var worldA = new Metro.App.StationWorldView(parentA.transform, "world-a",
            new Metro.App.IStationViewRenderer[] { renderer });
        var worldB = (Metro.App.StationWorldView)null;
        try {
            worldA.Build(read.Document, read.Index);
            worldA.Activate();
            worldB = new Metro.App.StationWorldView(parentB.transform, "world-b",
                new Metro.App.IStationViewRenderer[] { renderer });
            worldB.Build(read.Document, read.Index);
            var stagedView = renderer.View;
            Assert.NotNull(stagedView);
            // This is the install order: the candidate builds first, then the previous
            // world is disposed. That Release must not clear the candidate's state.
            worldA.Dispose();
            Assert.IsNotNull(renderer.View, "the replaced world's Release cleared the candidate state");
            Assert.AreSame(stagedView, renderer.View);
            Assert.NotNull(renderer.Traffic);
            renderer.Update(2.0);
        } finally {
            worldB?.Dispose();
            UnityEngine.Object.DestroyImmediate(parentA);
            UnityEngine.Object.DestroyImmediate(parentB);
        }
    }

    /* ---------------------------------------------------------------- helpers */

    sealed class EmptySurfaceContext : IRoadSurfaceContext {
        public bool IsSolid(int x, int y, double z) => false;
        public bool IsExitFloor(int x, int y, double z) => false;
        public bool IsGroundHole(int x, int y, double z) => false;
        public bool IsTrack(int x, int y, double z) => false;
        public bool OverlapsModuleEnvelope(StationRoadRecord candidate) => false;
    }

    static StationRoadTraffic StationRoadTrafficFor(RoadNetwork network, int seed) =>
        new StationRoadTraffic(StationRoadLayout.TrafficNetwork(network), seed);

    static RoadGraph CompareSection(SectionDto expected, List<StationRoadRecord> input, string label, int? trafficSeed = null) {
        var graph = StationRoadDocument.Read(input);
        Assert.AreEqual(0, graph.Diagnostics.Count, label + " diagnostics: " + string.Join(";", graph.Diagnostics));
        Assert.AreEqual(expected.records.Length, input.Count, label + " record count");
        for (int i = 0; i < input.Count; i++) {
            var a = input[i];
            var e = expected.records[i];
            Assert.AreEqual(e.id, a.Id, $"{label} record {i} id");
            Assert.AreEqual(e.x, a.X, $"{label} {a.Id} x");
            Assert.AreEqual(e.y, a.Y, $"{label} {a.Id} y");
            Near(a.Z, e.z, $"{label} {a.Id} z");
            Assert.AreEqual(e.w, a.W, $"{label} {a.Id} w");
            Assert.AreEqual(e.d, a.D, $"{label} {a.Id} d");
            Assert.AreEqual(e.rot, a.Rotation, $"{label} {a.Id} rot");
            Assert.AreEqual(e.direction, a.Direction, $"{label} {a.Id} direction");
            var layout = StationRoadLayout.Layout(a);
            Assert.AreEqual(e.acrossX, layout.AcrossX, $"{label} {a.Id} acrossX");
            Near(layout.Width, e.width, $"{label} {a.Id} width");
            Near(layout.Length, e.length, $"{label} {a.Id} length");
            Assert.AreEqual(e.lanes, layout.Lanes, $"{label} {a.Id} lanes");
            Near(layout.LaneWidth, e.laneWidth, $"{label} {a.Id} laneWidth");
            var ends = StationRoadDocument.Endpoints(a);
            Near(ends[0].X, e.endpoints[0].x, $"{label} {a.Id} endpoint 0 x");
            Near(ends[0].Y, e.endpoints[0].y, $"{label} {a.Id} endpoint 0 y");
            Near(ends[1].X, e.endpoints[1].x, $"{label} {a.Id} endpoint 1 x");
            Near(ends[1].Y, e.endpoints[1].y, $"{label} {a.Id} endpoint 1 y");
        }

        Assert.AreEqual(expected.segments.Length, graph.Segments.Count, label + " segments");
        for (int i = 0; i < graph.Segments.Count; i++) {
            var a = graph.Segments[i];
            var e = expected.segments[i];
            Assert.AreEqual(e.id, a.Road.Id, $"{label} segment {i} id");
            Assert.AreEqual(e.sourceId, a.SourceId, $"{label} segment {i} source");
            Assert.AreEqual(e.fromNode, a.FromNodeId, $"{label} segment {i} from node");
            Assert.AreEqual(e.toNode, a.ToNodeId, $"{label} segment {i} to node");
            Assert.AreEqual(e.x, a.Road.X, $"{label} segment {i} x");
            Assert.AreEqual(e.y, a.Road.Y, $"{label} segment {i} y");
            Assert.AreEqual(e.w, a.Road.W, $"{label} segment {i} w");
            Assert.AreEqual(e.d, a.Road.D, $"{label} segment {i} d");
        }
        Assert.AreEqual(expected.nodes.Length, graph.Nodes.Count, label + " nodes");
        for (int i = 0; i < graph.Nodes.Count; i++) {
            var a = graph.Nodes[i];
            var e = expected.nodes[i];
            Assert.AreEqual(e.id, a.Id, $"{label} node {i} id");
            Near(a.X, e.x, $"{label} node {i} x");
            Near(a.Y, e.y, $"{label} node {i} y");
            Near(a.Z, e.z, $"{label} node {i} z");
            CollectionAssert.AreEqual(e.segments, a.Segments.ToArray(), $"{label} node {i} segments");
        }

        var network = StationRoadLayout.Network(graph);
        Assert.AreEqual(expected.network.junctions.Length, network.Junctions.Count, label + " junctions");
        for (int i = 0; i < network.Junctions.Count; i++) {
            var a = network.Junctions[i];
            var e = expected.network.junctions[i];
            Assert.AreEqual(e.id, a.Id, $"{label} junction {i} id");
            Near(a.X0, e.x0, $"{label} junction {i} x0");
            Near(a.Y0, e.y0, $"{label} junction {i} y0");
            Near(a.X1, e.x1, $"{label} junction {i} x1");
            Near(a.Y1, e.y1, $"{label} junction {i} y1");
            Near(a.Z, e.z, $"{label} junction {i} z");
            Assert.AreEqual(e.uncontrolled, a.Uncontrolled, $"{label} junction {i} uncontrolled");
        }
        Assert.AreEqual(expected.network.edges.Length, network.Edges.Count, label + " edges");
        for (int i = 0; i < network.Edges.Count; i++) {
            var a = network.Edges[i];
            var e = expected.network.edges[i];
            Assert.AreEqual(e.road, a.Road.Id, $"{label} edge {i} road");
            Assert.AreEqual(e.lane, a.Lane, $"{label} edge {i} lane");
            Assert.AreEqual(e.sign, a.Sign, $"{label} edge {i} sign");
            Assert.AreEqual(e.axis, a.Axis, $"{label} edge {i} axis");
            Near(a.Start.X, e.start.x, $"{label} edge {i} start.x");
            Near(a.Start.Y, e.start.y, $"{label} edge {i} start.y");
            Near(a.End.X, e.end.x, $"{label} edge {i} end.x");
            Near(a.End.Y, e.end.y, $"{label} edge {i} end.y");
            Near(a.Length, e.length, $"{label} edge {i} length");
            Assert.AreEqual(e.junction, a.Junction, $"{label} edge {i} junction");
            Assert.AreEqual(e.hasControl, a.HasControl, $"{label} edge {i} control flag");
            if (a.HasControl) {
                Near(a.Control.X, e.control.x, $"{label} edge {i} control.x");
                Near(a.Control.Y, e.control.y, $"{label} edge {i} control.y");
            }
            CollectionAssert.AreEqual(e.next, a.Next.ToArray(), $"{label} edge {i} next");
        }
        CollectionAssert.AreEqual(expected.network.entries, network.Entries.ToArray(), label + " entries");
        var sides = StationRoadLayout.JunctionSides(network);
        Assert.AreEqual(expected.network.sides.Length, sides.Count, label + " junction sides");
        for (int i = 0; i < sides.Count; i++) {
            Assert.AreEqual(expected.network.sides[i].junction, sides[i].Junction, $"{label} side {i} junction");
            Assert.AreEqual(expected.network.sides[i].road, sides[i].Road, $"{label} side {i} road");
            Assert.AreEqual(expected.network.sides[i].axis, sides[i].Axis, $"{label} side {i} axis");
            Assert.AreEqual(expected.network.sides[i].@out, sides[i].Out, $"{label} side {i} out");
            Near(sides[i].Boundary, expected.network.sides[i].boundary, $"{label} side {i} boundary");
        }

        foreach (var e in expected.snaps) {
            var snap = StationRoadDocument.Snap(graph, new RoadPosition(e.probe.x, e.probe.y), e.z, e.radius);
            Near(snap.Point.X, e.point.x, $"{label} snap x");
            Near(snap.Point.Y, e.point.y, $"{label} snap y");
            Assert.AreEqual(e.hasNode, snap.HasNode, $"{label} snap hasNode");
            Assert.AreEqual(e.nodeId, snap.Node?.Id ?? "", $"{label} snap node");
            Assert.AreEqual(e.roadId, snap.Road?.Id ?? "", $"{label} snap road");
            var at = StationRoadDocument.SegmentAt(graph, new RoadPosition(e.probe.x, e.probe.y), e.z);
            Assert.AreEqual(e.atId, at?.Road.Id ?? "", $"{label} snap segment");
        }

        int inkIndex = 0;
        foreach (var road in input) {
            var layout = StationRoadLayout.Layout(road);
            var across = new List<double> { .16, layout.Width - .16, layout.Width / 2, layout.Width / 2 - .13, layout.Width / 2 + .13 };
            for (int lane = 1; lane < layout.Lanes; lane++) across.Add(lane * layout.LaneWidth);
            foreach (double a in across.Distinct()) foreach (double margin in new[] { 0.0, StationRoadLayout.CrosswalkDepth + 1.5 }) {
                var e = expected.inks[inkIndex++];
                Assert.AreEqual(e.road, road.Id, $"{label} ink road");
                Near(e.across, a, $"{label} ink across");
                var spans = StationRoadLayout.InkIntervals(road, input, a, margin);
                Assert.AreEqual(e.spans.Length, spans.Count, $"{label} ink {road.Id} {a} m{margin} spans");
                for (int s = 0; s < spans.Count; s++) {
                    Near(spans[s].Lo, e.spans[s].lo, $"{label} ink lo");
                    Near(spans[s].Hi, e.spans[s].hi, $"{label} ink hi");
                }
            }
        }

        if (trafficSeed.HasValue && expected.traffic.Length > 0) {
            var traffic = StationRoadTrafficFor(network, trafficSeed.Value);
            foreach (var row in expected.traffic) {
                traffic.Advance(row.time);
                Near(traffic.Time, row.trafficTime, $"{label} traffic time");
                Assert.AreEqual(row.cars.Length, traffic.Cars.Count, $"{label} traffic cars at " + row.time);
                for (int i = 0; i < traffic.Cars.Count; i++) {
                    var car = traffic.Cars[i];
                    var e = row.cars[i];
                    Assert.AreEqual(e.id, car.Id);
                    Assert.AreEqual(e.edge, car.Edge);
                    Assert.AreEqual(e.previousEdge, car.PreviousEdge);
                    Near(car.Distance, e.distance, $"{label} traffic distance");
                    Near(car.PreviousDistance, e.previousDistance, $"{label} traffic previous distance");
                    Assert.AreEqual(e.kind, car.Kind.ToString().ToLowerInvariant());
                    Near(car.Size, e.size, $"{label} traffic size");
                    Assert.AreEqual(e.held, car.Held);
                    Assert.AreEqual(e.variant, traffic.VariantOf(car));
                }
                var poses = new List<RoadVehiclePose>();
                traffic.Sample(row.time, poses);
                Assert.AreEqual(row.poses.Length, poses.Count);
                for (int i = 0; i < poses.Count; i++) {
                    Near(poses[i].X, row.poses[i].x, $"{label} pose x");
                    Near(poses[i].Y, row.poses[i].y, $"{label} pose y");
                    Near(poses[i].Z, row.poses[i].z, $"{label} pose z");
                    Near(poses[i].Heading, row.poses[i].heading, $"{label} pose heading");
                    Assert.AreEqual(row.poses[i].variant, poses[i].Variant);
                }
                foreach (var signal in row.signals) {
                    var junction = network.Junctions.Single(candidate => candidate.Id == signal.junction);
                    Assert.AreEqual(signal.phase, StationRoadLayout.Signal(junction, signal.axis, row.time).ToString().ToLowerInvariant(),
                        $"{label} signal phase");
                }
            }
        }
        return graph;
    }

    /* ------------------------------------------------- G3 promoted vehicle prefabs */

    sealed class VehicleExpectation {
        public string Variant, Kind, PrefabPath;
        public float Width, Height, Length;
    }

    /// <summary>
    /// The promoted family's measured bounds from <c>tools/unity-assets/export-vehicle.mjs</c>,
    /// repeated so a builder or import drift cannot pass the traffic renderer. Source
    /// space is X width, Y length, Z height with the tyres on z = 0; the promoted
    /// wrapper maps that to the vehicle-local +Z forward / +Y up convention.
    /// </summary>
    static readonly VehicleExpectation[] Vehicles = {
        new VehicleExpectation { Variant = "suv", Kind = "car", PrefabPath = "Assets/StationDesigner/Generated/Prefabs/VehicleSuv.prefab", Width = 2.19f, Height = 1.791f, Length = 4.2845f },
        new VehicleExpectation { Variant = "sedan", Kind = "car", PrefabPath = "Assets/StationDesigner/Generated/Prefabs/VehicleSedan.prefab", Width = 2.19f, Height = 1.51f, Length = 4.2845f },
        new VehicleExpectation { Variant = "bus-orange", Kind = "bus", PrefabPath = "Assets/StationDesigner/Generated/Prefabs/VehicleBusOrange.prefab", Width = 2.9f, Height = 3.325f, Length = 10.13f },
        new VehicleExpectation { Variant = "bus-mosaic", Kind = "bus", PrefabPath = "Assets/StationDesigner/Generated/Prefabs/VehicleBusMosaic.prefab", Width = 2.9f, Height = 3.325f, Length = 10.1562f },
        new VehicleExpectation { Variant = "moped", Kind = "scooter", PrefabPath = "Assets/StationDesigner/Generated/Prefabs/VehicleMoped.prefab", Width = .88f, Height = 1.72f, Length = 1.9235f },
        new VehicleExpectation { Variant = "bicycle", Kind = "scooter", PrefabPath = "Assets/StationDesigner/Generated/Prefabs/VehicleBicycle.prefab", Width = .67f, Height = 1.81f, Length = 1.9f },
    };

    static Metro.View.RuntimeCatalogue VehicleCatalogue() {
        var catalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<Metro.View.RuntimeCatalogue>(Metro.View.RuntimeCatalogue.AssetPath);
        Assert.IsNotNull(catalogue, "the runtime catalogue asset is missing; run Metro.Editor.RuntimeCatalogue.Generate");
        return catalogue;
    }

    static List<StationRoadRecord> ZooRecords() =>
        JsonUtility.FromJson<ZooSaveDto>(File.ReadAllText(ZooSavePath)).@static.modules
            .Where(m => m.type == "road").Select(ToRecord).ToList();

    static RoadVehicleViews BuildVehicleView(Transform parent, StationRoadTraffic traffic,
        Metro.View.RuntimeCatalogue catalogue, List<string> reports = null) {
        var view = RoadVehicleViews.Build(parent, traffic, Shader.Find("Universal Render Pipeline/Lit"), false, catalogue,
            reports == null ? (Action<string, string>)null : (code, detail) => reports.Add(code + ": " + detail));
        return view;
    }

    static Vector3 PoseForward(RoadVehiclePose pose) =>
        new Vector3((float)Math.Sin(-pose.Heading), 0f, (float)Math.Cos(-pose.Heading));

    /// <summary>Rendered transform == sampled pose for every visible vehicle.</summary>
    static void AssertRenderedPoses(RoadVehicleViews view, string label) {
        Assert.Greater(view.VisibleVehicles, 0, label + ": no vehicles are visible");
        Assert.AreEqual(view.Poses.Count, view.VisibleVehicles, label + ": visible counter matches the sample");
        foreach (var pose in view.Poses) {
            Assert.IsTrue(view.TryGetRenderedVehicle(pose.Id, out var instance),
                $"{label}: no rendered instance for vehicle {pose.Id}");
            var position = instance.localPosition;
            Assert.AreEqual((float)pose.X, position.x, 2e-4f, $"{label}: vehicle {pose.Id} rendered x");
            Assert.AreEqual((float)pose.Z, position.y, 2e-4f, $"{label}: vehicle {pose.Id} rendered deck height");
            Assert.AreEqual((float)pose.Y, position.z, 2e-4f, $"{label}: vehicle {pose.Id} rendered z");
            Assert.Greater(Vector3.Dot(instance.forward, PoseForward(pose)), .999f,
                $"{label}: vehicle {pose.Id} rendered forward does not follow its heading");
        }
    }

    [Test]
    public void VehicleCatalogueResolvesSixPromotedPrefabsAtTheirAuthoredScaleAndBasis() {
        var catalogue = VehicleCatalogue();
        Assert.GreaterOrEqual(catalogue.Count, 210, "the 204 generated views plus the six vehicle rows");
        var tail = catalogue.Entries.Skip(catalogue.Count - Vehicles.Length).Select(entry => entry.key).ToArray();
        CollectionAssert.AreEqual(Metro.View.RoadVehicleViewKeys.All, tail,
            "vehicle rows must be appended after the generated rows in source variant order");

        foreach (var expected in Vehicles) {
            var key = Metro.View.RoadVehicleViewKeys.ForVariant(expected.Variant);
            var entry = catalogue.Entries.Single(candidate => candidate.key == key);
            Assert.AreEqual("prefab", entry.kind, key + " kind");
            Assert.AreEqual(expected.PrefabPath, entry.prefabPath, key + " prefab path");
            Assert.IsNotNull(entry.prefab, key + " has no prefab reference");
            Assert.AreSame(entry.prefab, catalogue.VehiclePrefab(expected.Variant), key + " resolves by variant");
        }

        var roads = ZooRecords();
        var traffic = StationRoadTrafficFor(StationRoadLayout.Network(roads), 17);
        traffic.Advance(0);
        var root = new GameObject("vehicle-prefab-test");
        try {
            var view = BuildVehicleView(root.transform, traffic, catalogue);
            Assert.AreEqual(0, view.MissingPrefabCount, "resolved: " + string.Join(";", view.MissingPrefabs));
            foreach (var expected in Vehicles) {
                var key = Metro.View.RoadVehicleViewKeys.ForVariant(expected.Variant);
                var entry = catalogue.Entries.Single(candidate => candidate.key == key);
                var instance = view.InstantiateVehicle(expected.Variant, root.transform);
                try {
                    Assert.AreEqual(Vector3.one, instance.localScale, expected.Variant + " must not be scaled as a whole");
                    var identity = instance.GetComponent<RoadVehicleKey>();
                    Assert.IsNotNull(identity, expected.Variant + " instance lost its stable key");
                    Assert.AreEqual(expected.Kind, identity.kind, expected.Variant + " key kind");
                    Assert.AreEqual(expected.Variant, identity.variant);
                    Assert.Less(Quaternion.Angle(RoadVehicleViews.PoseCorrection(entry.prefab), Quaternion.identity), .01f,
                        expected.Variant + " prefab basis is already +Z forward / +Y up");

                    var renderers = instance.GetComponentsInChildren<Renderer>(true);
                    Assert.Greater(renderers.Length, 0, expected.Variant + " has no renderers");
                    var bounds = renderers[0].bounds;
                    for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
                    Assert.AreEqual(expected.Width, bounds.size.x, .02f, expected.Variant + " width");
                    Assert.AreEqual(expected.Height, bounds.size.y, .02f, expected.Variant + " height");
                    Assert.AreEqual(expected.Length, bounds.size.z, .03f, expected.Variant + " length along +Z");
                    Assert.AreEqual(0f, bounds.min.y, .002f, expected.Variant + " pivot is not on the tyre contact plane");
                    foreach (var renderer in renderers) {
                        Assert.IsNotNull(renderer.sharedMaterial, expected.Variant + " has a missing material");
                        Assert.IsNotNull(renderer.sharedMaterial.shader, expected.Variant + " material has no shader");
                        StringAssert.DoesNotContain("Error", renderer.sharedMaterial.shader.name,
                            expected.Variant + " material uses an error shader");
                    }

                    var front = instance.GetComponentsInChildren<Transform>(true).FirstOrDefault(child => child.name == "Front");
                    Assert.IsNotNull(front, expected.Variant + " lost its Front basis anchor");
                    Assert.Greater(Vector3.Dot((front.position - instance.position).normalized, Vector3.forward), .999f,
                        expected.Variant + " forward is not +Z");
                    var up = instance.GetComponentsInChildren<Transform>(true).FirstOrDefault(child => child.name == "Up");
                    Assert.IsNotNull(up, expected.Variant + " lost its Up basis anchor");
                    Assert.Greater(Vector3.Dot((up.position - instance.position).normalized, Vector3.up), .999f,
                        expected.Variant + " up is not +Y");
                } finally {
                    UnityEngine.Object.DestroyImmediate(instance.gameObject);
                }
            }
        } finally {
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void ZooTwoWayLanesRenderOppositeDirectionsAtTheSampledPoses() {
        var roads = ZooRecords();
        var network = StationRoadLayout.Network(roads);
        var twoWay = roads.Single(record => record.Id == "road-3976");
        var traffic = StationRoadTrafficFor(network, 4242);
        var poses = new List<RoadVehiclePose>();
        double time = 0;
        RoadVehiclePose positive = default, negative = default;
        bool foundPositive = false, foundNegative = false;
        for (; time <= 30; time += .5) {
            traffic.Advance(time);
            traffic.Sample(time, poses);
            foreach (var pose in poses) {
                var edge = network.Edges[pose.Edge];
                if (edge.Road.Id != twoWay.Id) continue;
                Assert.AreEqual(StationRoadLayout.LaneSign(twoWay, edge.Lane), edge.Sign,
                    "Zoo two-way lane sign at lane " + edge.Lane);
                if (edge.Sign > 0) { positive = pose; foundPositive = true; }
                if (edge.Sign < 0) { negative = pose; foundNegative = true; }
            }
            if (foundPositive && foundNegative) break;
        }
        Assert.IsTrue(foundPositive && foundNegative, "the Zoo two-way road must carry traffic in both lane directions");
        var positiveEdge = network.Edges[positive.Edge];
        var negativeEdge = network.Edges[negative.Edge];
        double pdx = positiveEdge.End.X - positiveEdge.Start.X, pdy = positiveEdge.End.Y - positiveEdge.Start.Y;
        double ndx = negativeEdge.End.X - negativeEdge.Start.X, ndy = negativeEdge.End.Y - negativeEdge.Start.Y;
        double dot = (pdx * ndx + pdy * ndy) / (Math.Sqrt(pdx * pdx + pdy * pdy) * Math.Sqrt(ndx * ndx + ndy * ndy));
        Assert.Less(dot, -.999, "opposite lanes must travel in opposite directions");
        Assert.AreEqual(Math.PI, Math.Abs(Math.IEEERemainder(positive.Heading - negative.Heading, Math.PI * 2)), .01,
            "opposite-lane headings differ by half a turn");

        var root = new GameObject("vehicle-two-way-test");
        try {
            var view = BuildVehicleView(root.transform, traffic, VehicleCatalogue());
            view.Render(time);
            Assert.AreEqual(view.VisibleVehicles, view.PrefabVehicleViews, "the passing path must draw prefabs");
            Assert.AreEqual(0, view.FallbackVehicleViews, "no generated box may be drawn when the catalogue is complete");
            AssertRenderedPoses(view, "Zoo two-way");
            var moved = 0;
            foreach (var pose in view.Poses) {
                Assert.IsTrue(view.TryGetRenderedVehicle(pose.Id, out var instance));
                var edge = network.Edges[pose.Edge];
                var forward = new Vector3((float)(edge.End.X - edge.Start.X), 0f, (float)(edge.End.Y - edge.Start.Y)).normalized;
                Assert.Greater(Vector3.Dot(instance.forward, forward), .999f,
                    "vehicle " + pose.Id + " faces against its lane");
                if (edge.Road.Id == twoWay.Id) moved++;
            }
            Assert.Greater(moved, 0, "at least one vehicle is on the Zoo two-way road");
        } finally {
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void ControlledJunctionStopsThenGoesWhileRenderedPosesTrackTheSample() {
        var fixture = Oracle.fixtures.Single(candidate => candidate.name == "rotated-crossing");
        var records = fixture.input.Select(ToRecord).ToList();
        var network = StationRoadLayout.Network(records);
        var junction = network.Junctions.Single();
        Assert.IsFalse(junction.Uncontrolled, "the fixture junction must be signal controlled");
        var approach = network.Edges[0];
        Assert.AreEqual(RoadSignalPhase.Red, StationRoadLayout.Signal(junction, approach.Axis, 2.0),
            "the approach starts on red");
        Assert.AreEqual(RoadSignalPhase.Green, StationRoadLayout.Signal(junction, approach.Axis, 9.0),
            "the approach turns green on the signal phase");

        var traffic = StationRoadTrafficFor(network, 4242);
        var root = new GameObject("vehicle-junction-test");
        try {
            var view = BuildVehicleView(root.transform, traffic, VehicleCatalogue());
            int lastTick = -1;
            void StepTo(double time) {
                int target = (int)Math.Round(time / .1);
                while (lastTick < target) {
                    lastTick++;
                    traffic.Advance(lastTick * .1);
                }
                view.Render(time);
                AssertRenderedPoses(view, "junction t=" + time.ToString("F1", CultureInfo.InvariantCulture));
            }

            StepTo(2.0);
            var car = traffic.Cars.Single(candidate => candidate.Id == 0);
            Assert.AreEqual(0, car.Edge, "car 0 starts on the western approach");
            double held = car.Distance;
            Assert.Greater(held, 0);
            StepTo(8.9);
            car = traffic.Cars.Single(candidate => candidate.Id == 0);
            Assert.AreEqual(0, car.Edge, "a red approach must hold the car before the junction");
            Assert.AreEqual(held, car.Distance, 1e-9, "the car must not creep while the approach is red");
            StepTo(9.0);
            car = traffic.Cars.Single(candidate => candidate.Id == 0);
            Assert.AreEqual(held, car.Distance, 1e-9, "the signal turns green without teleporting the held car");
            StepTo(10.5);
            car = traffic.Cars.Single(candidate => candidate.Id == 0);
            Assert.AreNotEqual(0, car.Edge, "the car must cross once the approach is green");
            CollectionAssert.Contains(network.Edges[0].Next, car.Edge,
                "the crossing movement must be an allowed turn from the approach edge");
            StepTo(11.9);
            car = traffic.Cars.Single(candidate => candidate.Id == 0);
            Assert.AreEqual(1, car.Edge, "car 0 continues along the legal connector chain");
            CollectionAssert.Contains(network.Edges[8].Next, 1, "edge 8 -> 1 is an allowed movement");
        } finally {
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void PauseHoldsRenderedPosesAndResumeDoesNotTeleport() {
        var network = StationRoadLayout.Network(ZooRecords());
        var traffic = StationRoadTrafficFor(network, 17);
        var root = new GameObject("vehicle-pause-test");
        try {
            var view = BuildVehicleView(root.transform, traffic, VehicleCatalogue());
            double time = 5.0;
            for (int tick = 0; tick <= 50; tick++) traffic.Advance(tick * .1);
            // Sample half a step past the stepped time: the source interpolates
            // previous -> current with fraction (time - traffic.time) / step, so the
            // same sample time must reproduce the same paused pose exactly.
            double heldSample = time + .05;
            view.Render(heldSample);
            AssertRenderedPoses(view, "pause");
            var held = new Dictionary<int, (Vector3 position, Quaternion rotation)>();
            foreach (var pose in view.Poses) {
                Assert.IsTrue(view.TryGetRenderedVehicle(pose.Id, out var instance));
                held[pose.Id] = (instance.localPosition, instance.localRotation);
            }

            // A paused host keeps publishing the same station time; every pooled
            // vehicle must keep its exact pose and nothing may respawn.
            traffic.Advance(time);
            view.Render(heldSample);
            AssertRenderedPoses(view, "paused repeat");
            foreach (var pose in view.Poses) {
                Assert.IsTrue(held.TryGetValue(pose.Id, out var before), "a paused frame changed the vehicle set");
                Assert.IsTrue(view.TryGetRenderedVehicle(pose.Id, out var instance));
                Assert.AreEqual(before.position, instance.localPosition, "paused position must not change");
                Assert.AreEqual(before.rotation, instance.localRotation, "paused rotation must not change");
            }

            traffic.Advance(time + .1);
            view.Render(time + .15);
            AssertRenderedPoses(view, "resume");
            int moved = 0;
            foreach (var pose in view.Poses) {
                if (!held.TryGetValue(pose.Id, out var before)) continue;
                Assert.IsTrue(view.TryGetRenderedVehicle(pose.Id, out var instance));
                float distance = Vector3.Distance(before.position, instance.localPosition);
                Assert.LessOrEqual(distance, .61f,
                    "vehicle " + pose.Id + " jumped " + distance.ToString("F2", CultureInfo.InvariantCulture) + " m on resume");
                if (distance > .001f) moved++;
            }
            Assert.Greater(moved, 0, "resume must continue the simulation instead of freezing it");
        } finally {
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void VehiclesKeepTheirWheelsOnTheDeckAndStayInsideTheCarriageway() {
        var roads = ZooRecords();
        var network = StationRoadLayout.Network(roads);
        var traffic = StationRoadTrafficFor(network, 17);
        // A's committed cells: the Zoo roads sit on ground z = 0 above the
        // underground station levels, so a solid cell at that elevation would mean
        // a vehicle entered a building volume rather than the carriageway.
        var read = Metro.Persistence.StationDocumentReader.Read(File.ReadAllText(ZooSavePath), Metro.Build.StationSource.None);
        Assert.NotNull(read.Document);
        var solidAtRoadLevel = new HashSet<(int x, int y)>();
        foreach (var cell in read.Document.Cells)
            if (cell.Z == 0 && cell.IsSolid) solidAtRoadLevel.Add((cell.X, cell.Y));
        var root = new GameObject("vehicle-deck-test");
        try {
            var view = BuildVehicleView(root.transform, traffic, VehicleCatalogue());
            double[] samples = { 0, 2.5, 7.3, 13.1 };
            double time = -1;
            foreach (double sample in samples) {
                time = Math.Max(time, sample);
                traffic.Advance(time);
                view.Render(time);
                AssertRenderedPoses(view, "deck t=" + time.ToString("F1", CultureInfo.InvariantCulture));
                foreach (var pose in view.Poses) {
                    var edge = network.Edges[pose.Edge];
                    var record = roads.Single(candidate => candidate.Id == edge.Road.Id);
                    Assert.AreEqual(edge.Road.Z + 1.05, pose.Z, 1e-9, "traffic rides the road's 1.05 m traffic plane");
                    int cellX = (int)Math.Floor(pose.X), cellY = (int)Math.Floor(pose.Y);
                    Assert.IsFalse(solidAtRoadLevel.Contains((cellX, cellY)),
                        "vehicle " + pose.Id + " entered solid building cell " + cellX + "," + cellY);
                    var layout = StationRoadLayout.Layout(record);
                    double across = layout.AcrossX ? pose.X - record.X : pose.Y - record.Y;
                    double along = layout.AcrossX ? pose.Y - record.Y : pose.X - record.X;
                    // The carriageway rectangle is the road record; the curb strips
                    // start at 0.06 m and the sidewalk is outside it entirely.
                    Assert.GreaterOrEqual(across, .0, "vehicle " + pose.Id + " left the carriageway across");
                    Assert.LessOrEqual(across, layout.Width, "vehicle " + pose.Id + " entered the sidewalk across");
                    Assert.GreaterOrEqual(along, .0, "vehicle " + pose.Id + " left the carriageway along");
                    Assert.LessOrEqual(along, layout.Length, "vehicle " + pose.Id + " left the carriageway along");
                    Assert.AreEqual((edge.Lane + .5) * layout.LaneWidth, across, layout.LaneWidth / 2 + .01,
                        "vehicle " + pose.Id + " is not inside its lane band");

                    Assert.IsTrue(view.TryGetRenderedVehicle(pose.Id, out var instance));
                    var renderers = instance.GetComponentsInChildren<Renderer>(true);
                    var bounds = renderers[0].bounds;
                    for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
                    Assert.AreEqual((float)pose.Z, bounds.min.y, .003f,
                        "vehicle " + pose.Id + " wheels are not on the traffic deck plane");
                    // Source traffic rides 0.025 m above the drawn asphalt (z + 1.025
                    // in RoadModel.ts); the wheels sit on that plane, not in it.
                    Assert.AreEqual(0.025, pose.Z - (record.Z + 1.025), .002,
                        "vehicle " + pose.Id + " deck offset drifted from the source");
                }
            }
        } finally {
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void MissingVehicleAssetsAreReportedByNameAndUseTheExplicitFallback() {
        var traffic = StationRoadTrafficFor(StationRoadLayout.Network(ZooRecords()), 17);
        traffic.Advance(0);
        var root = new GameObject("vehicle-fallback-test");
        var empty = ScriptableObject.CreateInstance<Metro.View.RuntimeCatalogue>();
        var reports = new List<string>();
        try {
            var view = BuildVehicleView(root.transform, traffic, empty, reports);
            Assert.AreEqual(Vehicles.Length, view.MissingPrefabCount, "every vehicle key must be reported once");
            Assert.AreEqual(Vehicles.Length, reports.Count, "the host must receive one diagnostic per missing key");
            foreach (var expected in Vehicles) {
                var key = Metro.View.RoadVehicleViewKeys.ForVariant(expected.Variant);
                Assert.IsTrue(view.MissingPrefabs.Any(name => name.Contains(key)),
                    "missing report does not name " + key);
                Assert.IsTrue(reports.Any(report => report.Contains(key)),
                    "host diagnostic does not name " + key);
            }
            view.Render(0);
            Assert.Greater(view.VisibleVehicles, 0);
            Assert.AreEqual(view.VisibleVehicles, view.FallbackVehicleViews,
                "the fallback path must count every drawn vehicle");
            Assert.AreEqual(0, view.PrefabVehicleViews, "no prefab can be drawn from an empty catalogue");
            AssertRenderedPoses(view, "fallback");
        } finally {
            UnityEngine.Object.DestroyImmediate(empty);
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void RoadsStatePayloadReportsGeometryTrafficAndSampleTime() {
        var read = Metro.Persistence.StationDocumentReader.Read(File.ReadAllText(ZooSavePath), Metro.Build.StationSource.None);
        Assert.NotNull(read.Document);
        var parent = new GameObject("roads-state-world");
        Metro.App.StationWorldView world = null;
        try {
            var renderer = new StationRoadRenderer();
            world = new Metro.App.StationWorldView(parent.transform, "roads-state-world",
                new Metro.App.IStationViewRenderer[] { renderer },
                new Metro.App.StationViewAssets {
                    Catalogue = VehicleCatalogue(),
                    Shader = Shader.Find("Universal Render Pipeline/Lit"),
                });
            world.Build(read.Document, read.Index);
            world.Activate();
            renderer.Update(12.3);

            var contributor = new StationRoadStateContributor(renderer);
            Assert.AreEqual("roads", contributor.Key);
            var payload = contributor.BuildPayload(read.Document, read.Index);
            Assert.IsNotNull(payload, "the roads contributor must publish a payload for a built world");
            Assert.AreEqual(2, (int)payload["records"], "both Zoo road records are committed");
            Assert.AreEqual(2, (int)payload["segments"], "both derived segments are drawn");
            Assert.AreEqual(2, (int)payload["drawn"], "both authored rectangles are drawn");
            Assert.AreEqual(12.3, (double)payload["simTime"], 1e-9, "the payload names the station-clock sample");
            var vehicles = payload["vehicles"] as Newtonsoft.Json.Linq.JObject;
            Assert.IsNotNull(vehicles, "payload.roads.vehicles is missing");
            Assert.Greater((int)vehicles["visible"], 0, "the traffic payload must report visible vehicles");
            Assert.AreEqual((int)vehicles["visible"],
                (int)vehicles["cars"] + (int)vehicles["buses"] + (int)vehicles["scooters"],
                "cars + buses + scooters must equal the visible count");
            Assert.LessOrEqual((int)vehicles["bikes"], (int)vehicles["scooters"]);
            Assert.AreEqual(0, (int)vehicles["fallback"], "the Zoo station resolves prefabs for every vehicle");
            Assert.AreEqual((int)vehicles["visible"], (int)vehicles["prefab"]);

            var endpoints = (Newtonsoft.Json.Linq.JArray)payload["endpoints"];
            Assert.AreEqual(2, endpoints.Count, "both authored Zoo roads carry explicit endpoints");
            var fast = endpoints.Single(row => (string)row["id"] == "road-3717");
            Assert.AreEqual(31.0, (double)fast["from"][0], 1e-9);
            Assert.AreEqual(3.0, (double)fast["from"][1], 1e-9);
            Assert.AreEqual(111.0, (double)fast["to"][0], 1e-9);
            var twoWay = endpoints.Single(row => (string)row["id"] == "road-3976");
            Assert.AreEqual(34.0, (double)twoWay["from"][0], 1e-9);
            Assert.AreEqual(-9.0, (double)twoWay["from"][1], 1e-9);
            Assert.AreEqual(108.0, (double)twoWay["to"][0], 1e-9);

            // The scene hook is the same self-service registration packet D uses:
            // AttachState is what the AfterSceneLoad install calls on the real host.
            var hostObject = new GameObject("roads-state-host");
            try {
                var host = hostObject.AddComponent<Metro.App.StationGameHost>();
                var attached = StationRoadFeature.AttachState(host);
                Assert.IsNotNull(attached);
                Assert.IsTrue(host.Contributors.Any(contributor => contributor.Key == "roads"),
                    "the host must carry the roads state contributor");
                Assert.IsNull(StationRoadFeature.AttachState(null), "no host means no registration");
            } finally {
                UnityEngine.Object.DestroyImmediate(hostObject);
            }
        } finally {
            world?.Dispose();
            UnityEngine.Object.DestroyImmediate(parent);
        }
    }
}
