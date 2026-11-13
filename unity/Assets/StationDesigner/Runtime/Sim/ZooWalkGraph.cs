using System;
using System.Collections.Generic;

namespace Metro.Sim {
    // Bounded Zoo platform slice. The caller validates its fixed obstacle
    // constraints; walk edges are constructed from the current floor on search.
    public sealed class ZooWalkGraph {
        // gateMode is 0 for both directions, 1 for entry and -1 for exit.
        [Serializable] public sealed class Node { public int x, y, z, zone, blocked, gateMode; public float speed; public bool gate; }
        static readonly (int dx,int dy,int bit)[] Cardinal = { (1,0,1),(-1,0,2),(0,1,4),(0,-1,8) };
        static readonly (int dx,int dy)[] Diagonal = { (1,1),(1,-1),(-1,1),(-1,-1) };
        readonly Node[] nodes;
        readonly bool enforceFare;
        readonly Dictionary<(int,int,int),int> index = new Dictionary<(int,int,int),int>();
        public ZooWalkGraph(Node[] nodes,bool enforceFare = false) {
            this.nodes = nodes ?? throw new ArgumentNullException(nameof(nodes));
            this.enforceFare=enforceFare;
            for (int i = 0; i < nodes.Length; i++) index.Add((nodes[i].x,nodes[i].y,nodes[i].z),i);
        }
        public bool Contains(int x,int y,int z) => index.ContainsKey((x,y,z));
        public (int to,float cost)[] WalkEdges(int node,Func<int,int,int,bool> solid) {
            bool Present(int i) { var p=nodes[i]; return solid(p.x,p.y,p.z); }
            var result=new List<(int,float)>();
            if (!Present(node)) return result.ToArray();
            foreach (int n in Neighbours(node,Present)) result.Add((n,Cost(node,n)));
            return result.ToArray();
        }
        public GatePathSlice.Waypoint[] Find(int start,int gate,int door, Func<int,int,int,bool> solid,
            GatePathSlice.Waypoint[] prefix) {
            if (start < 0 || gate < 0 || door < 0 || start >= nodes.Length || gate >= nodes.Length || door >= nodes.Length) return null;
            bool Present(int n) { var p=nodes[n]; return solid(p.x,p.y,p.z); }
            if (!Present(start) || !Present(gate) || !Present(door)) return null;
            var before=Search(start,gate,Present); var after=Search(gate,door,Present);
            if (before == null || after == null) return null;
            var path=new List<GatePathSlice.Waypoint>(prefix);
            foreach (var n in before) path.Add(Waypoint(n,n==gate));
            for (int i=1;i<after.Count;i++) path.Add(Waypoint(after[i],false));
            var last=path[path.Count-1];
            path.Add(new GatePathSlice.Waypoint { x=last.x,y=-2.25,z=last.z,zone=last.zone });
            return path.ToArray();
        }
        GatePathSlice.Waypoint Waypoint(int i,bool gate) { var n=nodes[i]; return new GatePathSlice.Waypoint { x=n.x+.5,y=n.y+.5,z=n.z+1,zone=n.zone,gate=gate }; }
        List<int> Search(int start,int goal,Func<int,bool> present) {
            var score=new double[nodes.Length]; var seen=new bool[nodes.Length]; var previous=new int[nodes.Length];
            var heap=new Heap(); seen[start]=true; previous[start]=-1; heap.Push(start,Heuristic(start,goal));
            while (heap.Count>0) {
                int current=heap.Pop();
                if (current==goal) {
                    var path=new List<int>(); for(int n=goal;n!=-1;n=previous[n]) path.Add(n);
                    path.Reverse(); return path;
                }
                foreach(var next in Neighbours(current,present)) {
                    double candidate=score[current]+Cost(current,next);
                    if (seen[next] && score[next]<=candidate) continue;
                    seen[next]=true; score[next]=candidate; previous[next]=current;
                    heap.Push(next,candidate+Heuristic(next,goal));
                }
            }
            return null;
        }
        float Cost(int from,int to) {
            var a=nodes[from]; var b=nodes[to];
            double distance=a.x!=b.x && a.y!=b.y ? Math.Sqrt(2) : 1;
            return (float)(distance/(1.34*(((double)a.speed+b.speed)/2.0)));
        }
        IEnumerable<int> Neighbours(int current,Func<int,bool> present) {
            var a=nodes[current];
            foreach(var d in Cardinal) {
                if ((a.blocked & d.bit)!=0 || !index.TryGetValue((a.x+d.dx,a.y+d.dy,a.z),out int n) || !present(n) || !CardinalAllowed(current,n)) continue;
                yield return n;
            }
            if (a.gate) yield break;
            foreach(var d in Diagonal) {
                if (!index.TryGetValue((a.x+d.dx,a.y+d.dy,a.z),out int n) || !present(n) || nodes[n].gate ||
                    !index.TryGetValue((a.x+d.dx,a.y,a.z),out int c1) || !present(c1) || nodes[c1].gate ||
                    !index.TryGetValue((a.x,a.y+d.dy,a.z),out int c2) || !present(c2) || nodes[c2].gate) continue;
                if (!CardinalAllowed(current,c1) || !CardinalAllowed(c1,n) || !CardinalAllowed(current,c2) || !CardinalAllowed(c2,n)) continue;
                yield return n;
            }
        }
        bool CardinalAllowed(int from,int to) {
            var a=nodes[from]; var b=nodes[to];
            foreach(var d in Cardinal) if(a.x+d.dx==b.x && a.y+d.dy==b.y) {
                if ((a.blocked & d.bit)!=0) return false;
                if (!enforceFare) return true;
                bool fromPaid=a.zone>=3 && a.zone<=5, toPaid=b.zone>=3 && b.zone<=5;
                int direction=fromPaid==toPaid ? 0 : toPaid ? 1 : -1;
                return direction==0 || (a.gate && (a.gateMode==0 || a.gateMode==direction)) ||
                    (b.gate && (b.gateMode==0 || b.gateMode==direction));
            }
            return false;
        }
        double Heuristic(int a,int b) { double x=nodes[a].x-nodes[b].x, y=nodes[a].y-nodes[b].y; return Math.Sqrt(x*x+y*y)/1.34; }
        sealed class Heap {
            readonly List<(int node,double priority)> entries=new List<(int,double)>();
            public int Count => entries.Count;
            public void Push(int node,double priority) {
                entries.Add((node,priority)); int i=entries.Count-1;
                while(i>0) { int p=(i-1)/2; if(entries[p].priority<=entries[i].priority) break; Swap(p,i); i=p; }
            }
            public int Pop() {
                int result=entries[0].node, last=entries.Count-1; entries[0]=entries[last]; entries.RemoveAt(last);
                int i=0; while(i<entries.Count) { int l=2*i+1,r=l+1,m=i;
                    if(l<entries.Count && entries[l].priority<entries[m].priority)m=l;
                    if(r<entries.Count && entries[r].priority<entries[m].priority)m=r;
                    if(m==i)break; Swap(m,i); i=m;
                } return result;
            }
            void Swap(int a,int b) { var v=entries[a]; entries[a]=entries[b]; entries[b]=v; }
        }
    }
}
