using System;
using System.Collections.Generic;

namespace Metro.Sim {
    public sealed class FirstPlayableService {
        public enum Stage { Entrance, WalkingToGate, Queuing, ThroughGate, Platform, Boarded }
        readonly GatePathSlice passenger;
        readonly int platformIndex;
        public Stage CurrentStage { get; private set; } = Stage.Entrance;
        public int BoardedCount { get; private set; }
        public double X => passenger.X; public double Y => passenger.Y;
        public bool Finished => BoardedCount == 1;
        public FirstPlayableService(int gateX = 2, int lane = 0) : this(LegacyPath(gateX,lane), gateX == 2 ? 2 : 4) { }
        static List<(int, int)> LegacyPath(int x,int y) {
            if(x==2 && y==0) return new List<(int,int)> { (0,0),(1,0),(2,0),(3,0),(4,0),(4,1) };
            if(x==3 && y==1) return new List<(int,int)> { (0,0),(1,0),(1,1),(2,1),(3,1),(4,1) };
            throw new ArgumentException("Unsupported route");
        }
        public FirstPlayableService(List<(int,int)> cells, int gateIndex) {
            if(cells == null || gateIndex <= 0 || gateIndex >= cells.Count-1) throw new ArgumentException("Station has no route");
            var points=new List<GatePathSlice.Waypoint>();
            for(int i=0;i<cells.Count;i++) points.Add(Point(cells[i].Item1+.5,cells[i].Item2+.5,i>gateIndex?3:0,i==gateIndex));
            platformIndex=points.Count-1; points.Add(Point(5.5,2.5,3));
            passenger=new GatePathSlice(points.ToArray(),.5,1);
        }
        static GatePathSlice.Waypoint Point(double x,double y,int zone,bool gate=false) => new GatePathSlice.Waypoint { x=x,y=y,z=0,zone=zone,gate=gate };
        public void Step() {
            if(Finished)return; passenger.Step();
            if(passenger.Dead){BoardedCount=1;CurrentStage=Stage.Boarded;}
            else if(passenger.State==2)CurrentStage=Stage.Queuing;
            else if(passenger.PathIndex>platformIndex)CurrentStage=Stage.Platform;
            else if(passenger.WaitCount>0)CurrentStage=Stage.ThroughGate;
            else CurrentStage=Stage.WalkingToGate;
        }
    }
}

