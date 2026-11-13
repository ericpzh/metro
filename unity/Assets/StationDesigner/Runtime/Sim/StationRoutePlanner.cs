using System;
using System.Collections.Generic;

namespace Metro.Sim {
    // Route search over a document-built <see cref="StationWalkGraph"/> — a port of
    // the `PathFinder` half of game/src/sim/station.ts (`astar`).
    //
    // The cost model is the source's: an edge costs its own seconds, plus the crowd
    // charge arriving at its far end (§7.3), plus `STAIR_AVOID_S` for a stair, plus
    // a lift's passenger-dependent `levelPenalty` (§7.2), plus any live queue wait.
    // Congestion and queue waits are zero today because the crowd is not ported —
    // that is the source's own answer for an empty station, not a placeholder cost.
    //
    // A `stepFree` search skips stair and escalator edges entirely (§7.4a): the only
    // vertical route a passenger who cannot use a step has is the lift. No lift edges
    // are built yet (see `StationWalkGraphBuilder`), so such a route correctly reports
    // "not found" instead of inventing one.
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
        double[] gScore;
        int[] cameFrom;
        int[] seen;
        int epoch;
        readonly MinHeap heap = new MinHeap();

        public StationRoutePlanner(StationWalkGraph graph) {
            this.graph = graph ?? throw new ArgumentNullException(nameof(graph));
            gScore = new double[graph.NodeCount];
            cameFrom = new int[graph.NodeCount];
            seen = new int[graph.NodeCount];
        }

        public StationWalkGraph Graph => graph;

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
            return new StationRoute { Found = true, Nodes = nodes, Keys = keys, Kinds = kinds, Cost = graph.PathCost(nodes) };
        }

        public StationRoute Search(string startKey, string goalKey, StationRouteNeeds needs) {
            graph.TryNode(startKey, out int start);
            graph.TryNode(goalKey, out int goal);
            return Search(start, goal, needs);
        }

        WalkEdgeKind ChosenKind(int from, int to) {
            var kind = WalkEdgeKind.Walk;
            double best = double.PositiveInfinity;
            for (int e = 0; e < graph.AdjTo[from].Length; e++) {
                if (graph.AdjTo[from][e] != to || graph.AdjCost[from][e] >= best) continue;
                best = graph.AdjCost[from][e];
                kind = (WalkEdgeKind)graph.AdjKind[from][e];
            }
            return kind;
        }

        /// <summary>Plain A* over the adjacency lists. Returns node ids from start to goal, or null.</summary>
        int[] Astar(int start, int goal, StationRouteNeeds needs) {
            int count = graph.NodeCount;
            if (gScore.Length != count) {
                gScore = new double[count];
                cameFrom = new int[count];
                seen = new int[count];
            }
            epoch++;
            int ep = epoch;
            double lift = LiftPenalty(needs);
            heap.Clear();
            gScore[start] = 0;
            seen[start] = ep;
            cameFrom[start] = -1;
            heap.Push(start, Heuristic(start, goal));
            while (heap.Count > 0) {
                int current = heap.Pop();
                if (current == goal) {
                    var path = new List<int>();
                    for (int node = goal; node != -1; node = cameFrom[node]) path.Add(node);
                    path.Reverse();
                    return path.ToArray();
                }
                double gs = gScore[current];
                var to = graph.AdjTo[current];
                for (int e = 0; e < to.Length; e++) {
                    var kind = (WalkEdgeKind)graph.AdjKind[current][e];
                    if (needs.StepFree && (kind == WalkEdgeKind.Stair || kind == WalkEdgeKind.Escalator)) continue;
                    int next = to[e];
                    // The edge's own cost, then what arriving at its far end costs. The
                    // congestion array is empty until the crowd is ported, so this is zero.
                    double edgeCost = graph.AdjCost[current][e];
                    if (kind == WalkEdgeKind.Stair) edgeCost += StairAvoidSeconds;
                    if (kind == WalkEdgeKind.Lift) edgeCost += lift;
                    int server = graph.AdjServer[current][e];
                    if (server >= 0) edgeCost += QueueWait(graph.Servers[server]);
                    double candidate = gs + edgeCost;
                    if (graph.ServerForNode.TryGetValue(next, out int atNode)) candidate += QueueWait(graph.Servers[atNode]);
                    if (seen[next] == ep && gScore[next] <= candidate) continue;
                    seen[next] = ep;
                    gScore[next] = candidate;
                    cameFrom[next] = current;
                    heap.Push(next, candidate + Heuristic(next, goal));
                }
            }
            return null;
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
            int length;

            public int Count => length;
            public void Clear() => length = 0;

            public void Push(int node, double value) {
                if (length == nodes.Length) {
                    Array.Resize(ref nodes, length * 2);
                    Array.Resize(ref priority, length * 2);
                }
                int i = length++;
                nodes[i] = node;
                priority[i] = value;
                while (i > 0) {
                    int parent = (i - 1) >> 1;
                    if (priority[parent] <= priority[i]) break;
                    Swap(parent, i);
                    i = parent;
                }
            }

            public int Pop() {
                int top = nodes[0];
                length--;
                if (length > 0) {
                    nodes[0] = nodes[length];
                    priority[0] = priority[length];
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
                nodes[a] = nodes[b];
                priority[a] = priority[b];
                nodes[b] = n;
                priority[b] = p;
            }
        }
    }
}
