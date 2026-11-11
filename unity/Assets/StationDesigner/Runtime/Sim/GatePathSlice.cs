using System;

namespace Metro.Sim {
    /// <summary>
    /// Single-passenger, unobstructed gate-path slice. Its waypoint path must be
    /// produced by the reference graph; crowd steering and replanning are not ported.
    /// </summary>
    public sealed class GatePathSlice {
        [Serializable] public sealed class Waypoint { public double x,y,z; public int zone; public bool gate; }
        public double X {get;private set;} public double Y {get;private set;} public double Z {get;private set;}
        public int Tick {get;private set;} public int State {get;private set;}=1; public int PathIndex {get;private set;}
        public int GateDirection {get;private set;} public int QueueCount {get;private set;} public int Lane {get;private set;}
        public double Cooldown {get;private set;} public double WaitAccum {get;private set;} public int WaitCount {get;private set;}
        public bool Dead {get;private set;}
        readonly Waypoint[] path; readonly double speed,rate; bool served; double waiting;
        public GatePathSlice(Waypoint[] path,double speed,double rate) {
            if(path==null||path.Length<3||speed<=0||rate<=0)throw new ArgumentException("Invalid gate path");
            int gates=0;foreach(var p in path){if(p==null)throw new ArgumentException("Invalid waypoint");if(p.gate)gates++;}
            if(gates!=1)throw new ArgumentException("Exactly one gate is supported");
            this.path=path;this.speed=speed;this.rate=rate;X=path[0].x;Y=path[0].y;Z=path[0].z;
        }
        static bool Paid(int z) => z==3||z==4||z==5;
        static int Direction(int from,int to) => !Paid(from)&&Paid(to)?1:Paid(from)&&!Paid(to)?-1:0;
        public void Step() {
            Tick++;
            // World.tickOnce services gates before advancing walkers.
            Cooldown-=1;
            if(Cooldown<=0 && QueueCount>0) { QueueCount=0;Lane=GateDirection;WaitAccum+=waiting;waiting=0;WaitCount++;State=1;Cooldown+=1/rate; }
            if(Cooldown<0&&QueueCount==0)Cooldown=0;
            if(Cooldown< -1)Cooldown=-1;
            if(Dead)return;
            if(State==2) { waiting+=1;return; }
            if(PathIndex>=path.Length)throw new InvalidOperationException("Path already exhausted");
            var target=path[PathIndex];double dx=target.x-X,dy=target.y-Y,dist=Math.Sqrt(dx*dx+dy*dy);
            if(dist<=speed || dist<.35) {
                if(target.gate&&!served) {
                    if(PathIndex==0||PathIndex+1>=path.Length)throw new NotSupportedException("Gate needs both adjacent waypoints");
                    GateDirection=Direction(path[PathIndex-1].zone,path[PathIndex+1].zone);served=true;State=2;QueueCount=1;waiting=0;return;
                }
                if(!target.gate) { X=target.x;Y=target.y;Z=target.z; }
                PathIndex++;if(PathIndex>=path.Length)Dead=true;
            } else { var ratio=speed/dist;X+=dx*ratio;Y+=dy*ratio;Z+=(target.z-Z)*ratio; }
        }
    }
}

