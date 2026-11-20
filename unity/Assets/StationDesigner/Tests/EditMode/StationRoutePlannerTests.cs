using System;
using System.Collections.Generic;
using System.IO;
using Metro.App;
using Metro.Build;
using Metro.Sim;
using NUnit.Framework;
using UnityEngine;

// Packet C · C1 — the document-built walk graph and the route planner.
//
// The fixture is an independently authored **non-Zoo** station: the generated street
// plaza, a fence fare line with two gates, a closed pen nobody can enter, a pillar, a
// road, a bare exit portal and a basement room reached by one descending escalator.
// `station-route-oracle.json` is the source `buildGraph`/`PathFinder` run on that same
// document, so these assertions compare the port with `game/src/sim/station.ts` rather
// than with a second copy of the same arithmetic.
//
// What is *not* ported is reported by `StationWalkGraphBuilder.Unported` and listed in
// the evidence file; nothing here is allowed to fall back to a saved route, a fixed
// index or a Zoo id — `GraphIsRebuiltFromTheDocument` proves a moved gate re-cuts it.
public class StationRoutePlannerTests {
    // -------------------------------------------------------------- oracle shape

    [Serializable] public sealed class Oracle {
        public string generatedBy;
        public int graphVersion, nodeCount;
        public double stationArea;
        public int[] levelsZ;
        public NodeDto[] nodes;
        public EdgeDto[] edges;
        public ServerDto[] servers;
        public PlatformDto[] platforms;
        public ExitDto[] exits;
        public RouteDto[] routes;
        public DocumentDto document;
    }
    [Serializable] public sealed class NodeDto {
        public string key;
        public double x, y, z, speed;
        public int zone;
    }
    [Serializable] public sealed class EdgeDto { public int from, to, kind, server; public double cost; }
    [Serializable] public sealed class ServerDto { public int id, node, exitNode, batch, cycle, gateMode; public string kind; public double rate, ride; }
    [Serializable] public sealed class PlatformDto { public string id, line; public int doors, cells; }
    [Serializable] public sealed class ExitDto { public string id, name; public int node; }
    [Serializable] public sealed class RouteDto {
        public string name, start, goal;
        public NeedsDto needs;
        public bool found;
        public string[] keys;
        public double cost;
    }
    [Serializable] public sealed class NeedsDto { public bool stepFree, luggage; }
    [Serializable] public sealed class DocumentDto {
        public string stationId;
        public int levelBase;
        public CellDto[] cells;
        public ModuleDto[] modules;
        public LineDto[] lines;
    }
    [Serializable] public sealed class CellDto { public int x, y, z, zone; public bool solid; public double speed; }
    [Serializable] public sealed class ModuleDto {
        public string id, type, lineId, name, dir, side, railId;
        public int x, y, z, rot, width, depth, height, gateDir;
        public bool headHouse, gateOpen, gateHasLane, tunnel, bridge, block, hasEndpoints;
        public int fromX, fromY, fromZ, toX, toY, toZ;
        public double runLength;
    }
    [Serializable] public sealed class LineDto { public string id, direction; public double headwayPeak, headwayOffpeak, headwayLate; }

    static Oracle cached;
    public static Oracle Instance() {
        if (cached != null) return cached;
        string path = Path.Combine(Application.dataPath, "StationDesigner/Tests/EditMode/station-route-oracle.json");
        Assert.IsTrue(File.Exists(path), "Run tools/unity-parity/record-station-clock.mjs first: " + path);
        cached = JsonUtility.FromJson<Oracle>(File.ReadAllText(path));
        Assert.IsNotNull(cached, "station-route-oracle.json did not parse");
        Assert.AreEqual("tools/unity-parity/record-station-clock.mjs", cached.generatedBy);
        Assert.AreEqual(1, cached.graphVersion);
        Assert.Greater(cached.nodeCount, 0);
        return cached;
    }

    /// <summary>The oracle's document in the plain facts shape the builder reads.</summary>
    public static StationSessionDocument DocumentOf(DocumentDto dto) {
        var document = new StationSessionDocument { StationId = dto.stationId, LevelBase = dto.levelBase };
        foreach (var cell in dto.cells)
            document.Cells.Add(new StationCellFact { X = cell.x, Y = cell.y, Z = cell.z, Solid = cell.solid, Zone = cell.zone, Speed = cell.speed });
        foreach (var m in dto.modules)
            document.Modules.Add(new StationModuleFact {
                Id = m.id, Type = m.type, X = m.x, Y = m.y, Z = m.z, Rot = m.rot,
                Width = m.width, Depth = m.depth, Height = m.height,
                LineId = m.lineId, Name = m.name, HeadHouse = m.headHouse, Dir = m.dir, Side = m.side, RailId = m.railId,
                GateDir = m.gateDir, GateOpen = m.gateOpen, GateHasLane = m.gateHasLane,
                Tunnel = m.tunnel, Bridge = m.bridge, Block = m.block,
                HasEndpoints = m.hasEndpoints,
                FromX = m.fromX, FromY = m.fromY, FromZ = m.fromZ, ToX = m.toX, ToY = m.toY, ToZ = m.toZ,
                RunLength = m.runLength,
            });
        foreach (var line in dto.lines)
            document.Lines.Add(new StationLineFact { Id = line.id, Direction = line.direction, HeadwayPeak = line.headwayPeak, HeadwayOffpeak = line.headwayOffpeak, HeadwayLate = line.headwayLate });
        return document;
    }

    static StationWalkGraph Build() => StationWalkGraphBuilder.Build(DocumentOf(Instance().document));

    // ------------------------------------------------------------------- tests

    [TestCase("checkout", "cafe", 4, 4)]
    [TestCase("checkout", "", 1, 1)]
    [TestCase("shelf", "cafe-backbar-4", 1, 4)]
    [TestCase("shelf", "books", 1, 2)]
    public void ShopFixturesBlockTheirFullFootprintOnLoadAndDuringEdits(
        string type, string variant, int savedWidth, int length) {
        const int z = -5;
        var options = new StationWalkGraphOptions { IncludeGround = false };
        var empty = new StationSessionDocument();
        for (int x = 0; x < 10; x++)
            for (int y = 0; y < 8; y++)
                empty.Cells.Add(new StationCellFact { X = x, Y = y, Z = z, Solid = true, Speed = 1 });

        var config = new ModuleConfig(new Dictionary<string, string> { ["variant"] = variant });
        StationModuleRecord Record(int x, int y, int rot) => new StationModuleRecord(
            "fixture", type, x, y, z, rot, savedWidth, 1, 1, false, null, null, null, "",
            new ModuleFacts { Config = config });
        var placed = Record(4, 2, 1);
        var moved = Record(8, 6, 2);
        StationSessionDocument With(StationModuleFact fact) => new StationSessionDocument {
            Cells = empty.Cells, Modules = new List<StationModuleFact> { fact },
        };
        void Check(StationWalkGraph graph, bool blocksPlaced, bool blocksMoved) {
            for (int i = 0; i < length; i++) {
                Assert.AreEqual(!blocksPlaced, graph.NodeIndex.ContainsKey(StationWalkGraph.CellKey(4, 2 + i, z)));
                Assert.AreEqual(!blocksMoved, graph.NodeIndex.ContainsKey(StationWalkGraph.CellKey(8 - i, 6, z)));
            }
            Assert.IsTrue(graph.NodeIndex.ContainsKey(StationWalkGraph.CellKey(4, 2 + length, z)));
        }

        var add = new StationSessionDelta();
        add.ChangedModules.Add(StationSessionProjection.ModuleFact(placed));
        var after = With(add.ChangedModules[0]);
        Check(StationWalkGraphBuilder.Build(after, options), true, false);
        Check(StationWalkGraphWorkspace.Build(after, options).Graph, true, false);

        var staged = StationWalkGraphWorkspace.Build(empty, options).StageCellDelta(after, add);
        Check(staged.Graph, true, false);
        var move = new StationSessionDelta();
        move.ChangedModules.Add(StationSessionProjection.ModuleFact(moved));
        staged = staged.Workspace.StageCellDelta(With(move.ChangedModules[0]), move);
        Check(staged.Graph, false, true);
        var remove = new StationSessionDelta();
        remove.RemovedModules.Add(moved.Id);
        Check(staged.Workspace.StageCellDelta(empty, remove).Graph, false, false);
        Assert.IsFalse(StationEditClassifier.IsSimInertDecorModule(placed));
    }

    [Test]
    public void DocumentBuildsTheSameNodesAsTheTypeScriptGraph() {
        var oracle = Instance();
        var graph = Build();
        Assert.AreEqual(oracle.nodeCount, graph.NodeCount, "node count");
        Assert.AreEqual(oracle.levelsZ.Length, graph.LevelsZ.Length, "storey count");
        for (int i = 0; i < oracle.levelsZ.Length; i++) Assert.AreEqual(oracle.levelsZ[i], graph.LevelsZ[i], "storey " + i);
        Assert.AreEqual(oracle.stationArea, graph.StationArea, 1e-9, "station floor area excludes the street");
        for (int i = 0; i < oracle.nodeCount; i++) {
            var expected = oracle.nodes[i];
            Assert.AreEqual(expected.key, graph.NodeKey[i], "node key " + i);
            Assert.AreEqual(expected.x, graph.NodeX[i], 1e-9, "x " + expected.key);
            Assert.AreEqual(expected.y, graph.NodeY[i], 1e-9, "y " + expected.key);
            Assert.AreEqual(expected.z, graph.NodeZ[i], 1e-9, "z " + expected.key);
            Assert.AreEqual(expected.speed, graph.NodeSpeed[i], 1e-6, "floor speed " + expected.key);
            Assert.AreEqual(expected.zone, graph.NodeZone[i], "zone " + expected.key);
        }
        // The public probe: a saved route prefix would make this pass for the wrong reason.
        Assert.IsTrue(graph.TryNode("4,-3,0", out int start), "the plaza start is a document cell");
        Assert.IsTrue(graph.TryNode("12,10,0", out int pen), "the pen's floor is a node even though nothing reaches it");
        Assert.Greater(graph.NodeCount, 1);
        Assert.Greater(start, -1);
        Assert.Greater(pen, -1);
    }

    [Test]
    public void EveryWalkEdgeMatchesTheTypeScriptGraph() {
        var oracle = Instance();
        var graph = Build();
        // The oracle's flat edge list is sorted by (from, to, kind, cost); so is this one.
        var actual = new List<EdgeDto>();
        for (int from = 0; from < graph.NodeCount; from++) {
            for (int e = 0; e < graph.AdjTo[from].Length; e++) {
                actual.Add(new EdgeDto {
                    from = from, to = graph.AdjTo[from][e], kind = graph.AdjKind[from][e],
                    cost = graph.AdjCost[from][e], server = graph.AdjServer[from][e],
                });
            }
        }
        actual.Sort((a, b) => a.from != b.from ? a.from - b.from : a.to != b.to ? a.to - b.to : a.kind != b.kind ? a.kind - b.kind : a.cost.CompareTo(b.cost));
        Assert.AreEqual(oracle.edges.Length, actual.Count, "edge count");
        for (int i = 0; i < oracle.edges.Length; i++) {
            var expected = oracle.edges[i];
            var got = actual[i];
            string where = "edge " + i + " (" + expected.from + "→" + expected.to + " kind " + expected.kind + ")";
            Assert.AreEqual(expected.from, got.from, "from " + where);
            Assert.AreEqual(expected.to, got.to, "to " + where);
            Assert.AreEqual(expected.kind, got.kind, "kind " + where);
            Assert.AreEqual(expected.cost, got.cost, 1e-5, "cost " + where);
            Assert.AreEqual(expected.server, got.server, "server " + where);
        }
    }

    [Test]
    public void ServersPlatformsAndExitsMatchTheDocument() {
        var oracle = Instance();
        var graph = Build();
        Assert.AreEqual(oracle.servers.Length, graph.Servers.Count, "server count");
        foreach (var expected in oracle.servers) {
            var actual = graph.Servers[expected.id];
            Assert.AreEqual(expected.kind, actual.Kind, "kind of server " + expected.id);
            Assert.AreEqual(expected.node, actual.Node, "node of " + expected.kind);
            Assert.AreEqual(expected.exitNode, actual.ExitNode, "exit node of " + expected.kind);
            Assert.AreEqual(expected.rate, actual.Rate, 1e-6, "rate of " + expected.kind);
            Assert.AreEqual(expected.ride, actual.Ride, 1e-5, "ride of " + expected.kind);
            Assert.AreEqual(expected.gateMode, actual.GateMode, "gate mode of " + expected.kind);
        }
        Assert.AreEqual(oracle.exits.Length, graph.Exits.Count, "exit count");
        for (int i = 0; i < oracle.exits.Length; i++) {
            Assert.AreEqual(oracle.exits[i].id, graph.Exits[i].Id);
            Assert.AreEqual(oracle.exits[i].name, graph.Exits[i].Name);
            Assert.AreEqual(oracle.exits[i].node, graph.Exits[i].Node);
        }
        // The two fare gates are the only servers a plaza route has to pass.
        int gates = 0, escalators = 0;
        foreach (var server in graph.Servers) {
            if (server.Kind == "gate") gates++;
            if (server.Kind == "escalator") escalators++;
        }
        Assert.AreEqual(2, gates, "two gates in the fence line");
        Assert.AreEqual(1, escalators, "one escalator to the basement");
        Assert.AreEqual(0, graph.Platforms.Count, "this fixture has no platform edge");
    }

    [Test]
    public void RoutesMatchTheTypeScriptOracle() {
        var oracle = Instance();
        var graph = Build();
        var planner = new StationRoutePlanner(graph);
        foreach (var expected in oracle.routes) {
            var route = planner.Search(expected.start, expected.goal, new StationRouteNeeds {
                StepFree = expected.needs.stepFree, Luggage = expected.needs.luggage,
            });
            Assert.AreEqual(expected.found, route.Found, "reachability of " + expected.name);
            if (!expected.found) {
                Assert.AreEqual(0, route.Nodes.Length, "no path for " + expected.name);
                continue;
            }
            Assert.AreEqual(expected.cost, route.Cost, 1e-5, "cost of " + expected.name);
            Assert.AreEqual(expected.keys[0], route.Keys[0], "start of " + expected.name);
            Assert.AreEqual(expected.keys[expected.keys.Length - 1], route.Keys[route.Keys.Length - 1], "goal of " + expected.name);
            // Every leg must be a real edge, and the recomputed cost must equal the cost.
            for (int i = 1; i < route.Nodes.Length; i++) {
                bool linked = false;
                for (int e = 0; e < graph.AdjTo[route.Nodes[i - 1]].Length; e++)
                    if (graph.AdjTo[route.Nodes[i - 1]][e] == route.Nodes[i]) linked = true;
                Assert.IsTrue(linked, "leg " + i + " of " + expected.name + " is an edge");
            }
            Assert.AreEqual(route.Cost, graph.PathCost(route.Nodes), 1e-9, "path cost recomputes for " + expected.name);
            if (expected.needs.stepFree) {
                foreach (var kind in route.Kinds)
                    Assert.IsFalse(kind == WalkEdgeKind.Stair || kind == WalkEdgeKind.Escalator,
                        "a step-free route may not ride a stair or escalator (" + expected.name + ")");
            }
        }
    }

    [Test]
    public void TheBasementRouteRidesTheDocumentEscalatorAndTheFareLineUsesAGate() {
        var graph = Build();
        var planner = new StationRoutePlanner(graph);
        // The two basement rooms are joined only by the saved escalator.
        var lower = planner.Search("4,7,-5", "4,7,-10", StationRouteNeeds.Walking);
        Assert.IsTrue(lower.Found);
        bool rodeEscalator = false;
        foreach (var kind in lower.Kinds) if (kind == WalkEdgeKind.Escalator) rodeEscalator = true;
        Assert.IsTrue(rodeEscalator, "the only way down is the saved escalator");
        Assert.IsTrue(Array.IndexOf(lower.Keys, "3,6,-5") >= 0, "boarding at the upper landing");
        Assert.IsTrue(Array.IndexOf(lower.Keys, "3,6,-10") >= 0, "alighting at the lower landing");
        // A step-free passenger cannot ride it, and there is no lift on this station.
        Assert.IsFalse(planner.Search("4,7,-5", "4,7,-10", new StationRouteNeeds { StepFree = true }).Found);
        // The plaza has no way down to the basement at all.
        Assert.IsFalse(planner.Search("4,-3,0", "4,7,-5", StationRouteNeeds.Walking).Found);
        // No route crosses the fence except at a gate cell.
        var west = planner.Search("4,-3,0", "0,3,0", StationRouteNeeds.Walking);
        Assert.IsTrue(west.Found);
        bool throughGate = false;
        foreach (var key in west.Keys) if (key == "1,0,0" || key == "7,0,0") throughGate = true;
        Assert.IsTrue(throughGate, "the fence line is only crossed at a gate");
    }

    [Test]
    public void DisconnectedStationHasNoRoute() {
        var graph = Build();
        var planner = new StationRoutePlanner(graph);
        var route = planner.Search("4,-3,0", "12,10,0", StationRouteNeeds.Walking);
        Assert.IsFalse(route.Found, "a closed pen is not reachable");
        // And a station with nothing in it builds an empty graph rather than crashing.
        var empty = StationWalkGraphBuilder.Build(new StationSessionDocument());
        Assert.Greater(empty.NodeCount, 0, "the street exists under an empty document");
        var nowhere = new StationRoutePlanner(empty).Search("0,0,0", "5,5,0", StationRouteNeeds.Walking);
        Assert.IsTrue(nowhere.Found, "the generated plaza itself is walkable");
    }

    [Test]
    public void GraphIsRebuiltFromTheDocumentNotASavedRoute() {
        var oracle = Instance();
        var document = DocumentOf(oracle.document);
        var before = new StationRoutePlanner(StationWalkGraphBuilder.Build(document)).Search("4,-3,0", "0,3,0", StationRouteNeeds.Walking);
        Assert.IsTrue(before.Found, "the west gate is open");
        Assert.IsTrue(Array.IndexOf(before.Keys, "1,0,0") >= 0, "and the route uses it");

        // Close the west gate's gap: the same probe must now go the long way round the
        // fence line's east end. The graph is derived from these coordinates, not from a
        // saved node index or a route prefix.
        var moved = DocumentOf(oracle.document);
        for (int i = 0; i < moved.Modules.Count; i++) {
            var module = moved.Modules[i];
            if (module.Type == "gate" && module.X == 1) { module.Type = "fence"; moved.Modules[i] = module; }
        }
        var after = new StationRoutePlanner(StationWalkGraphBuilder.Build(moved)).Search("4,-3,0", "0,3,0", StationRouteNeeds.Walking);
        Assert.IsTrue(after.Found, "the east gate still connects the plaza");
        Assert.IsTrue(Array.IndexOf(after.Keys, "1,0,0") < 0, "the old gate cell is a fence now");
        Assert.Greater(after.Cost, before.Cost, "the long way round costs more than the west gate");

        // Add a cell that opens a new way through the fence: the graph gains it.
        var opened = DocumentOf(oracle.document);
        for (int i = 0; i < opened.Modules.Count; i++) {
            var module = opened.Modules[i];
            if (module.Type == "fence" && module.X == 3 && module.Y == 0) { module.Type = "fence-open"; opened.Modules[i] = module; }
        }
        var openedGraph = StationWalkGraphBuilder.Build(opened);
        Assert.IsTrue(openedGraph.TryNode("3,0,0", out _), "removing the fence module makes its cell a node");
    }

    [Test]
    public void UnportedTraversalIsReportedByName() {
        var oracle = Instance();
        var graph = Build();
        string[] unported = graph.Unported;
        Assert.IsNotNull(unported);
        // The fixture uses only ported families, so nothing here is silently skipped.
        foreach (var name in unported) Assert.Fail("the fixture unexpectedly needs unported traversal: " + name);

        // A document that does use them names them rather than walking a shorter station.
        var document = DocumentOf(oracle.document);
        document.Modules.Add(new StationModuleFact { Id = "lift-x", Type = "lift", X = 30, Y = 30, Z = 0, Width = 2, Depth = 2, HasEndpoints = true, FromZ = 0, ToZ = -5 });
        document.Modules.Add(new StationModuleFact { Id = "bench-x", Type = "bench", X = 31, Y = 30, Z = 0 });
        document.Modules.Add(new StationModuleFact { Id = "walkway-x", Type = "walkway", X = 32, Y = 30, Z = 0, Width = 1 });
        var reported = string.Join(",", StationWalkGraphBuilder.Build(document).Unported);
        StringAssert.Contains("lift-stops:lift-x", reported);
        StringAssert.Contains("fixture-access:bench-x", reported);
        StringAssert.Contains("walkway-belt:walkway-x", reported);
    }

    [Test]
    public void WalkingCostCarriesTheFloorSpeedOfBothEnds() {
        var oracle = Instance();
        var graph = Build();
        var planner = new StationRoutePlanner(graph);
        // The generated street is concrete (speed 0.9): one cardinal metre costs
        // 1/(1.34*0.9) seconds. The authored paid slab is granite (speed 1.0).
        var concrete = planner.Search("4,-3,0", "5,-3,0", StationRouteNeeds.Walking);
        Assert.IsTrue(concrete.Found);
        Assert.AreEqual(1.0 / (StationWalkGraphBuilder.WalkSpeed * 0.9), concrete.Cost, 1e-5, "concrete leg");
        var granite = planner.Search("5,4,0", "6,4,0", StationRouteNeeds.Walking);
        Assert.IsTrue(granite.Found);
        Assert.AreEqual(1.0 / StationWalkGraphBuilder.WalkSpeed, granite.Cost, 1e-5, "granite leg");
        // A diagonal costs its real distance, and only inside a clear 2×2 square.
        var diagonal = planner.Search("4,-3,0", "5,-2,0", StationRouteNeeds.Walking);
        Assert.IsTrue(diagonal.Found);
        Assert.AreEqual(Math.Sqrt(2) / (StationWalkGraphBuilder.WalkSpeed * 0.9), diagonal.Cost, 1e-5, "diagonal leg");
    }
}
