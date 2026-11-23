using System;
using System.Collections.Generic;

namespace Metro.Sim {
    // Route search over a document-built <see cref="StationWalkGraph"/> — a port of
    // the `PathFinder` half of game/src/sim/station.ts (`astar`).
    //
    // The cost model is the source's: an edge costs its own seconds, plus the crowd
    // charge arriving at its far end (§7.3), plus `STAIR_AVOID_S` for a stair, plus
    // a lift's passenger-dependent `levelPenalty` (§7.2), plus any live queue wait.
    // A standalone planner sees an empty crowd. The live session supplies the current density and queues.
    //
    // A `stepFree` search skips stair and escalator edges entirely (§7.4a): the only
    // vertical route a passenger who cannot use a step has is the lift. Live service
    // searches add the installed shafts to the walking graph.
    public struct StationRouteNeeds {
        public bool StepFree;
        public bool Luggage;
        public static StationRouteNeeds Walking => new StationRouteNeeds();
    }

    public sealed class StationRoute {
        public bool Found;
        /// <summary>Node ids from the start to the goal, inclusive.</summary>
        public int[] Nodes = Array.Empty<int>();
        /// <summary>The same path as cell keys, for reporting and comparison.</summary>
        public string[] Keys = Array.Empty<string>();
        /// <summary>Edge kind used for each leg (length <c>Nodes.Length - 1</c>).</summary>
        public WalkEdgeKind[] Kinds = Array.Empty<WalkEdgeKind>();
        /// <summary>Total cost in seconds.</summary>
        public double Cost;
        public override string ToString() => Found ? string.Join(">", Keys) + " cost=" + Cost.ToString("R") : "no route";
    }

    public sealed class StationRoutePlanner {
        public const double WalkSpeed = StationWalkGraphBuilder.WalkSpeed;
        /// <summary>§7.2's `levelPenalty`: what a lift costs a passenger who could have walked.</summary>
        public const double LiftAvoidSeconds = 300;
        public const double LiftAvoidLuggageSeconds = 30;
        /// <summary>Extra route cost, in seconds, that keeps walkers off stairs when a ramp is near.</summary>
        public const double StairAvoidSeconds = 32;
        public const double CongestionSeconds = 1.2;
        public const int CongestionCap = 10;

        readonly StationWalkGraph graph;
        readonly int[] serverAtNode;
        double[] gScore;
        int[] cameFrom;
        string[] cameByLift;
        int[] seen;
        double[] congestionVal;
        int[] congestionStamp;
        int congestionEpoch;
        int[] liftCompAll;
        int[] liftCompStepFree;
        bool liftCompDirty;
        int epoch;
        internal Func<int, double> Congestion;
        internal Func<int, int, double> GateWait;
        readonly MinHeap heap = new MinHeap();
        readonly Dictionary<int, List<LiftEdge>> liftEdges = new Dictionary<int, List<LiftEdge>>();

        internal void InvalidateCongestionCache() => congestionEpoch++;

        readonly struct LiftEdge {
            public readonly int To;
            public readonly string Id;
            public readonly Func<double> QueueWait;

            public LiftEdge(int to, string id, Func<double> queueWait) {
                To = to;
                Id = id;
                QueueWait = queueWait;
            }
        }

        internal void AddLift(string id, int[] landings, Func<double> queueWait) {
            foreach (int from in landings) {
                if (from < 0) continue;
                foreach (int to in landings) {
                    if (to < 0 || graph.NodeZ[from] == graph.NodeZ[to]) continue;
                    if (!liftEdges.TryGetValue(from, out var edges)) liftEdges[from] = edges = new List<LiftEdge>();
                    edges.Add(new LiftEdge(to, id, queueWait));
                    liftCompDirty = true;
                }
            }
        }

        public StationRoutePlanner(StationWalkGraph graph) {
            this.graph = graph ?? throw new ArgumentNullException(nameof(graph));
            gScore = new double[graph.NodeCount];
            cameFrom = new int[graph.NodeCount];
            cameByLift = new string[graph.NodeCount];
            seen = new int[graph.NodeCount];
            congestionVal = new double[graph.NodeCount];
            congestionStamp = new int[graph.NodeCount];
            congestionEpoch = 1;
            serverAtNode = new int[graph.NodeCount];
            Array.Fill(serverAtNode, -1);
            foreach (var kv in graph.ServerForNode) {
                if (kv.Key >= 0 && kv.Key < serverAtNode.Length) serverAtNode[kv.Key] = kv.Value;
            }
        }

        bool CanReachWithLifts(int start, int goal, bool stepFree) {
            int count = graph.NodeCount;
            if ((uint)start >= (uint)count || (uint)goal >= (uint)count) return false;
            if (liftCompDirty || liftCompAll == null || liftCompAll.Length != count) {
                BuildLiftComponents(count);
            }
            var comp = stepFree ? liftCompStepFree : liftCompAll;
            return comp[start] == comp[goal];
        }

        void BuildLiftComponents(int count) {
            liftCompAll = ComputeComponents(count, stepFree: false);
            liftCompStepFree = ComputeComponents(count, stepFree: true);
            liftCompDirty = false;
        }

        static int FindRoot(int[] parent, int x) {
            int root = x;
            while (parent[root] != root) root = parent[root];
            while (parent[x] != root) {
                int next = parent[x];
                parent[x] = root;
                x = next;
            }
            return root;
        }

        static void UnionNodes(int[] parent, int a, int b) {
            int ra = FindRoot(parent, a);
            int rb = FindRoot(parent, b);
            if (ra != rb) parent[rb] = ra;
        }

        int[] ComputeComponents(int count, bool stepFree) {
            var parent = new int[count];
            for (int i = 0; i < count; i++) parent[i] = i;
            var adjToRaw = graph.AdjToRaw;
            var adjKindRaw = graph.AdjKindRaw;
            for (int cur = 0; cur < count; cur++) {
                var to = adjToRaw != null ? adjToRaw[cur] : graph.AdjTo[cur];
                var kinds = adjKindRaw != null ? adjKindRaw[cur] : graph.AdjKind[cur];
                for (int e = 0; e < to.Length; e++) {
                    if (stepFree) {
                        var k = (WalkEdgeKind)kinds[e];
                        if (k == WalkEdgeKind.Stair || k == WalkEdgeKind.Escalator) continue;
                    }
                    int next = to[e];
                    if ((uint)next < (uint)count) UnionNodes(parent, cur, next);
                }
                if (liftEdges.TryGetValue(cur, out var lifts)) {
                    for (int l = 0; l < lifts.Count; l++) {
                        int next = lifts[l].To;
                        if ((uint)next < (uint)count) UnionNodes(parent, cur, next);
                    }
                }
            }
            for (int i = 0; i < count; i++) parent[i] = FindRoot(parent, i);
            return parent;
        }

        public StationWalkGraph Graph => graph;
        public long TotalQueries { get; private set; }
        public long TotalExpandedNodes { get; private set; }
        public long TotalSkippedStalePops { get; private set; }

        public void ResetMetrics() {
            TotalQueries = 0;
            TotalExpandedNodes = 0;
            TotalSkippedStalePops = 0;
        }

        /// <summary>The seconds a lift edge costs this passenger: zero for a step-free passenger.</summary>
        public static double LiftPenalty(StationRouteNeeds needs) {
            if (needs.StepFree) return 0;
            return needs.Luggage ? LiftAvoidLuggageSeconds : LiftAvoidSeconds;
        }

        /// <summary>The crowd charge a node carries for `bodies` within about two metres (§7.3).</summary>
        public static double CongestionCost(int bodies) {
            int n = bodies > CongestionCap ? CongestionCap : bodies > 0 ? bodies : 0;
            return n * CongestionSeconds;
        }

        /// <summary>Search by node ids. Returns a not-found route rather than null, so callers report "no route".</summary>
        public StationRoute Search(int start, int goal, StationRouteNeeds needs) {
            if (start < 0 || goal < 0 || start >= graph.NodeCount || goal >= graph.NodeCount) return new StationRoute();
            if (start == goal) return new StationRoute { Found = true, Nodes = new[] { start }, Keys = new[] { graph.NodeKey[start] }, Cost = 0 };
            var nodes = Astar(start, goal, needs);
            if (nodes == null) return new StationRoute();
            var kinds = new WalkEdgeKind[nodes.Length - 1];
            for (int i = 1; i < nodes.Length; i++) kinds[i - 1] = ChosenKind(nodes[i - 1], nodes[i]);
            var keys = new string[nodes.Length];
            for (int i = 0; i < nodes.Length; i++) keys[i] = graph.NodeKey[nodes[i]];
            return new StationRoute { Found = true, Nodes = nodes, Keys = keys, Kinds = kinds, Cost = Congestion == null ? graph.PathCost(nodes) : gScore[goal] };
        }

        public StationRoute Search(string startKey, string goalKey, StationRouteNeeds needs) {
            graph.TryNode(startKey, out int start);
            graph.TryNode(goalKey, out int goal);
            return Search(start, goal, needs);
        }

        WalkEdgeKind ChosenKind(int from, int to) {
            var kind = WalkEdgeKind.Walk;
            double best = double.PositiveInfinity;
            var neighbors = graph.AdjToRaw != null ? graph.AdjToRaw[from] : graph.AdjTo[from];
            var costs = graph.AdjCostRaw != null ? graph.AdjCostRaw[from] : graph.AdjCost[from];
            var kinds = graph.AdjKindRaw != null ? graph.AdjKindRaw[from] : graph.AdjKind[from];
            for (int e = 0; e < neighbors.Length; e++) {
                if (neighbors[e] != to || costs[e] >= best) continue;
                best = costs[e];
                kind = (WalkEdgeKind)kinds[e];
            }
            return kind;
        }

        /// <summary>Returns node ids from start to goal, or null.</summary>
        internal int[] Astar(int start, int goal, StationRouteNeeds needs, bool walkOnly = false, int avoidServer = -1, bool useLifts = false) {
            int count = graph.NodeCount;
            if ((uint)start >= (uint)count || (uint)goal >= (uint)count) return null;
            TotalQueries++;
            useLifts = useLifts && !walkOnly && liftEdges.Count > 0;
            if (!useLifts) {
                if (!graph.CanReach(start, goal, needs.StepFree)) return null;
            } else {
                if (!CanReachWithLifts(start, goal, needs.StepFree)) return null;
            }
            if (gScore.Length < count) {
                gScore = new double[count];
                cameFrom = new int[count];
                cameByLift = new string[count];
                seen = new int[count];
                congestionVal = new double[count];
                congestionStamp = new int[count];
            }
            epoch++;
            int ep = epoch;
            int cEp = congestionEpoch;
            var congVal = congestionVal;
            var congStamp = congestionStamp;
            double lift = LiftPenalty(needs);
            var adjToRaw = graph.AdjToRaw;
            var adjCostRaw = graph.AdjCostRaw;
            var adjKindRaw = graph.AdjKindRaw;
            var adjServerRaw = graph.AdjServerRaw;
            var nodeX = graph.NodeX;
            var nodeY = graph.NodeY;
            var nodeZ = graph.NodeZ;
            var srvAtNode = serverAtNode;
            var serversList = graph.Servers;
            var congestionFn = Congestion;
            var gateWaitFn = GateWait;
            double goalX = nodeX[goal], goalY = nodeY[goal], goalZ = nodeZ[goal];
            heap.Clear();
            gScore[start] = 0;
            seen[start] = ep;
            cameFrom[start] = -1;
            cameByLift[start] = null;
            {
                double hdx = nodeX[start] - goalX, hdy = nodeY[start] - goalY, hdz = nodeZ[start] - goalZ;
                heap.Push(start, Math.Sqrt(hdx * hdx + hdy * hdy + hdz * hdz) / WalkSpeed, 0.0);
            }
            while (heap.Count > 0) {
                int current = heap.Pop(out double poppedG);
                if (poppedG > gScore[current]) {
                    TotalSkippedStalePops++;
                    continue;
                }
                TotalExpandedNodes++;
                if (current == goal) {
                    var path = new List<int>();
                    for (int node = goal; node != -1; node = cameFrom[node]) path.Add(node);
                    path.Reverse();
                    return path.ToArray();
                }
                double gs = gScore[current];
                double curZ = nodeZ[current];
                var to = adjToRaw != null ? adjToRaw[current] : graph.AdjTo[current];
                var edgeKinds = adjKindRaw != null ? adjKindRaw[current] : graph.AdjKind[current];
                var edgeCosts = adjCostRaw != null ? adjCostRaw[current] : graph.AdjCost[current];
                var edgeServers = adjServerRaw != null ? adjServerRaw[current] : graph.AdjServer[current];
                for (int e = 0; e < to.Length; e++) {
                    var kind = (WalkEdgeKind)edgeKinds[e];
                    if (needs.StepFree && (kind == WalkEdgeKind.Stair || kind == WalkEdgeKind.Escalator)) continue;
                    int next = to[e];
                    int atNode = (uint)next < (uint)srvAtNode.Length ? srvAtNode[next] : -1;
                    if (walkOnly && (kind != WalkEdgeKind.Walk || curZ != nodeZ[next] || atNode >= 0)) continue;
                    int direction = 0;
                    if (kind == WalkEdgeKind.Walk && atNode >= 0) {
                        var endSrv = serversList[atNode];
                        if (endSrv.Kind == "gate") {
                            direction = StationWalkGraphBuilder.GateApproach(graph, current, next);
                        }
                    }
                    double congCost = 0;
                    if (congestionFn != null) {
                        if (congStamp[next] == cEp) congCost = congVal[next];
                        else {
                            congCost = congestionFn(next);
                            congVal[next] = congCost;
                            congStamp[next] = cEp;
                        }
                    }
                    double edgeCost = edgeCosts[e] + congCost;
                    int server = edgeServers[e];
                    if (kind == WalkEdgeKind.Stair) {
                        int flights = server >= 0 && server < serversList.Count && serversList[server].StairFlights > 1
                            ? serversList[server].StairFlights : 1;
                        edgeCost += StairAvoidSeconds * flights;
                    }
                    if (kind == WalkEdgeKind.Lift) edgeCost += lift;
                    if (server >= 0 && server == avoidServer) continue;
                    if (server >= 0) edgeCost += QueueWait(serversList[server]);
                    double candidate = gs + edgeCost;
                    if (atNode >= 0) {
                        if (atNode == avoidServer) continue;
                        var service = serversList[atNode];
                        candidate += service.Kind == "gate" && gateWaitFn != null ? gateWaitFn(atNode, direction) : QueueWait(service);
                    }
                    Relax(current, next, candidate, null);
                }
                if (useLifts && liftEdges.TryGetValue(current, out var liftOptions)) {
                    for (int li = 0; li < liftOptions.Count; li++) {
                        var edge = liftOptions[li];
                        int toNode = edge.To;
                        double lCong = 0;
                        if (congestionFn != null) {
                            if (congStamp[toNode] == cEp) lCong = congVal[toNode];
                            else {
                                lCong = congestionFn(toNode);
                                congVal[toNode] = lCong;
                                congStamp[toNode] = cEp;
                            }
                        }
                        double candidate = gs + StationServiceRuntime.LiftCycleSeconds + lift + edge.QueueWait() + lCong;
                        Relax(current, toNode, candidate, edge.Id);
                    }
                }
            }
            return null;

            void Relax(int from, int to, double candidate, string liftId) {
                if (seen[to] == ep && gScore[to] <= candidate) return;
                seen[to] = ep;
                gScore[to] = candidate;
                cameFrom[to] = from;
                cameByLift[to] = liftId;
                double dx = nodeX[to] - goalX, dy = nodeY[to] - goalY, dz = nodeZ[to] - goalZ;
                heap.Push(to, candidate + Math.Sqrt(dx * dx + dy * dy + dz * dz) / WalkSpeed, candidate);
            }
        }

        internal bool GatePassage(int from, int to, out int direction) {
            int dx = (int)Math.Floor(graph.NodeX[to] - graph.NodeX[from] + 0.5);
            int dy = (int)Math.Floor(graph.NodeY[to] - graph.NodeY[from] + 0.5);
            direction = 0;
            bool fromGate = false;
            int fromRot = 0, fromMode = 0;
            if (graph.ServerForNode.TryGetValue(from, out int start)) {
                var server = graph.Servers[start];
                if (server.Kind == "gate") {
                    fromGate = true;
                    fromRot = server.GateRotation;
                    fromMode = server.GateMode;
                }
            }
            bool toGate = false;
            int toRot = 0, toMode = 0;
            if (graph.ServerForNode.TryGetValue(to, out int end)) {
                var server = graph.Servers[end];
                if (server.Kind == "gate") {
                    toGate = true;
                    toRot = server.GateRotation;
                    toMode = server.GateMode;
                    direction = StationWalkGraphBuilder.GateApproach(graph, from, to);
                }
            }
            if (!fromGate && !toGate) return true;
            return StationWalkGraphBuilder.GateStepAllowed(
                fromGate, fromRot, fromMode,
                toGate, toRot, toMode,
                dx, dy, graph.NodeZone[from], graph.NodeZone[to], graph.ZoneBarriers);
        }

        internal double LastSearchCost(int goal) => gScore[goal];
        internal string LastSearchLiftInto(int node) => cameByLift[node];

        internal double RouteCost(int[] path, int start, StationRouteNeeds needs) {
            double cost = 0;
            for (int i = start + 1; i < path.Length; i++) {
                int from = path[i - 1], to = path[i];
                int e = Array.IndexOf(graph.AdjTo[from], to);
                if (e < 0) return double.PositiveInfinity;
                var kind = (WalkEdgeKind)graph.AdjKind[from][e];
                if (kind == WalkEdgeKind.Walk && !GatePassage(from, to, out _)) return double.PositiveInfinity;
                cost += graph.AdjCost[from][e] + (Congestion?.Invoke(to) ?? 0);
                int server = graph.AdjServer[from][e];
                if (kind == WalkEdgeKind.Stair) {
                    int flights = server >= 0 && server < graph.Servers.Count && graph.Servers[server].StairFlights > 1
                        ? graph.Servers[server].StairFlights : 1;
                    cost += StairAvoidSeconds * flights;
                }
                if (kind == WalkEdgeKind.Lift) cost += LiftPenalty(needs);
                if (server >= 0) cost += QueueWait(graph.Servers[server]);
                if (graph.ServerForNode.TryGetValue(to, out int atNode)) {
                    var service = graph.Servers[atNode];
                    GatePassage(from, to, out int direction);
                    cost += service.Kind == "gate" && GateWait != null ? GateWait(atNode, direction) : QueueWait(service);
                }
            }
            return cost;
        }

        internal double WalkingCost(int[] path, int start, int end) {
            double cost = 0;
            for (int i = start; i < end; i++) {
                int from = path[i], to = path[i + 1];
                if (graph.ServerForNode.ContainsKey(to) || graph.NodeZ[from] != graph.NodeZ[to])
                    return double.PositiveInfinity;
                var neighbors = graph.AdjTo[from];
                int e = Array.IndexOf(neighbors, to);
                if (e < 0 || graph.AdjKind[from][e] != (int)WalkEdgeKind.Walk)
                    return double.PositiveInfinity;
                cost += graph.AdjCost[from][e] + (Congestion?.Invoke(to) ?? 0);
            }
            return cost;
        }

        /// <summary>Estimated wait at a capacity-limited edge, seconds, capped so A* stays sane.</summary>
        static double QueueWait(StationServerFact server) {
            if (server == null) return 0;
            double wait = server.Rate > 0 ? server.QueueCount / server.Rate : server.QueueCount;
            return wait > 600 ? 600 : wait;
        }

        double Heuristic(int node, int goal) {
            double dx = graph.NodeX[node] - graph.NodeX[goal];
            double dy = graph.NodeY[node] - graph.NodeY[goal];
            double dz = graph.NodeZ[node] - graph.NodeZ[goal];
            return Math.Sqrt(dx * dx + dy * dy + dz * dz) / WalkSpeed;
        }

        /// <summary>The source's binary heap, reproduced so equal-priority ties pop the same way.</summary>
        sealed class MinHeap {
            int[] nodes = new int[1024];
            double[] priority = new double[1024];
            double[] gValues = new double[1024];
            int length;

            public int Count => length;
            public void Clear() => length = 0;

            public void Push(int node, double value, double g) {
                if (length == nodes.Length) {
                    Array.Resize(ref nodes, length * 2);
                    Array.Resize(ref priority, length * 2);
                    Array.Resize(ref gValues, length * 2);
                }
                int i = length++;
                nodes[i] = node;
                priority[i] = value;
                gValues[i] = g;
                while (i > 0) {
                    int parent = (i - 1) >> 1;
                    if (priority[parent] <= priority[i]) break;
                    Swap(parent, i);
                    i = parent;
                }
            }

            public int Pop(out double g) {
                int top = nodes[0];
                g = gValues[0];
                length--;
                if (length > 0) {
                    nodes[0] = nodes[length];
                    priority[0] = priority[length];
                    gValues[0] = gValues[length];
                    int i = 0;
                    for (;;) {
                        int left = 2 * i + 1, right = left + 1, smallest = i;
                        if (left < length && priority[left] < priority[smallest]) smallest = left;
                        if (right < length && priority[right] < priority[smallest]) smallest = right;
                        if (smallest == i) break;
                        Swap(smallest, i);
                        i = smallest;
                    }
                }
                return top;
            }

            void Swap(int a, int b) {
                int n = nodes[a];
                double p = priority[a];
                double g = gValues[a];
                nodes[a] = nodes[b];
                priority[a] = priority[b];
                gValues[a] = gValues[b];
                nodes[b] = n;
                priority[b] = p;
                gValues[b] = g;
            }
        }
    }
}
