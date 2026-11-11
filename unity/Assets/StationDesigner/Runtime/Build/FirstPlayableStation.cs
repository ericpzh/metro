using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>Committed floor tiles and a single gate in the starter station.</summary>
    public sealed class FirstPlayableStation {
        public const int SlotX = 2, SlotY = 0, SlotZ = 0;
        readonly HashSet<(int, int)> floors = new HashSet<(int, int)>();
        int gateX = -1, gateY = -1;
        public bool HasFloor => floors.Contains((2, 0));
        public bool HasSecondFloor => floors.Contains((2, 1));
        public bool HasGate => gateX == 2 && gateY == 0;
        public bool HasSecondGate => gateX == 3 && gateY == 1;
        public bool HasDetourGate => gateX == 3 && gateY == 2;
        public bool HasDetourApproach => floors.Contains((2, 2));
        public bool HasDetourFloor => floors.Contains((3, 2));
        public bool PlaceFloor(int x, int y, int z) {
            if (z != 0 || !((x == 2 && y >= 0 && y <= 2) || (x == 3 && y == 2))) return false;
            return floors.Add((x, y));
        }
        public bool PlaceGate(int x, int y, int z) {
            if (z != 0 || gateX != -1) return false;
            if (!((x == 2 && y == 0 && HasFloor) || (x == 3 && y == 1) || (x == 3 && y == 2 && HasDetourFloor))) return false;
            gateX = x; gateY = y; return true;
        }
        bool Walkable(int x, int y) => floors.Contains((x,y)) ||
            (x >= 0 && x <= 1 && y >= 0 && y <= 2) ||
            (x >= 3 && x <= 4 && y >= 0 && y <= 1) || (x == 4 && y == 2);
        List<(int, int)> Find((int, int) start, (int, int) end, bool beforeGate) {
            var queue = new Queue<(int, int)>(); var previous = new Dictionary<(int, int), (int, int)>();
            queue.Enqueue(start); previous[start] = start;
            var directions = new (int, int)[] { (1,0), (0,1), (0,-1), (-1,0) };
            while (queue.Count > 0) {
                var p = queue.Dequeue(); if (p == end) break;
                foreach (var d in directions) {
                    var n = (p.Item1 + d.Item1, p.Item2 + d.Item2);
                    if (!Walkable(n.Item1,n.Item2) || previous.ContainsKey(n) || (beforeGate && n.Item1 >= gateX && n != end)) continue;
                    previous[n] = p; queue.Enqueue(n);
                }
            }
            if (!previous.ContainsKey(end)) return null;
            var path = new List<(int, int)>(); for (var p=end; ; p=previous[p]) { path.Add(p); if (p == start) break; }
            path.Reverse(); return path;
        }
        public bool TryPath(out List<(int, int)> path, out int gateIndex) {
            path = null; gateIndex = -1; if (gateX < 0) return false;
            var gate = (gateX,gateY); var before=Find((0,0),gate,true);
            var after=Find(gate,(4,1),false);
            if (before == null || after == null || before.Count < 2 || after.Count < 2) return false;
            gateIndex=before.Count-1; before.AddRange(after.GetRange(1,after.Count-1)); path=before; return true;
        }
        public bool CanRun => TryPath(out _, out _);
        public string RouteProblem => gateX >= 0 ? "Gate is disconnected: connect floor from entrance through the gate to the platform." : "Place the missing floor and fare gate first.";
        public bool TryRoute(out int x, out int lane) { x=gateX; lane=gateY; return CanRun; }
    }
}
