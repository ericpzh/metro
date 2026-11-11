using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using UnityEngine;

namespace Metro.Feasibility {
    // A scale spike, not the TS World: actual Tianhe graph + synthetic walks and queues.
    public sealed class TianheFeasibility : MonoBehaviour {
        public TextAsset graph; public Material material; public bool manualMode;
        const int Population = 5171, QueueCapacity = 128;
        static readonly int[] Speeds = { 1, 4, 16, 64 };
        const double WarmSeconds = 2, MeasureSeconds = 10, TickBudgetMs = 50;
        int n, e, serverCount, tick, phase, frameCount, tickCount, queued, admitted, completed, discardedBacklog;
        float[] x, y, z, rates, credits; int[] starts, edges, serverNodes, serverByNode, heads, lengths, queueData, agentNodes, agentQueue;
        Matrix4x4[] matrices = new Matrix4x4[1023]; Mesh mesh; double accumulator, phaseStarted, previousFrame;
        readonly List<double> frames = new List<double>(); readonly List<double> ticks = new List<double>();
        [Serializable] sealed class Phase { public int speed, frames, ticks, queued, admitted, completed, discardedBacklog; public double elapsed, effectiveTicksPerSecond, frameMedianMs, frameP95Ms, frameMaxMs, tickMedianMs, tickP95Ms, tickMaxMs; }
        [Serializable] sealed class Summary { public string status, kind, limitations; public int nodes, edges, servers, population; public Phase[] phases; }
        readonly List<Phase> phases = new List<Phase>();
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void MetroFeasibilityResult(string json);
#else
        static void MetroFeasibilityResult(string json) { Debug.Log(json); }
#endif
        static int ReadInt(BinaryReader r) => r.ReadInt32();
        void Awake() {
            using (var r = new BinaryReader(new MemoryStream(graph.bytes))) {
                if (ReadInt(r) != 0x4d475231) throw new Exception("Wrong graph version");
                n = ReadInt(r); e = ReadInt(r); serverCount = ReadInt(r);
                if (n != 153720 || e < n || serverCount < 1) throw new Exception("Unexpected graph fixture");
                x = new float[n]; y = new float[n]; z = new float[n];
                foreach (var a in new[] { x, y, z }) for (int i = 0; i < n; i++) a[i] = r.ReadSingle();
                starts = new int[n+1]; edges = new int[e]; for (int i=0;i<starts.Length;i++) starts[i]=ReadInt(r); for (int i=0;i<e;i++) edges[i]=ReadInt(r);
                serverNodes = new int[serverCount]; rates = new float[serverCount]; serverByNode = new int[n]; for (int i=0;i<n;i++) serverByNode[i]=-1;
                for (int i=0;i<serverCount;i++) { serverNodes[i]=ReadInt(r); rates[i]=r.ReadSingle(); if (serverNodes[i]>=0 && serverNodes[i]<n) serverByNode[serverNodes[i]]=i; }
                if (r.BaseStream.Position != r.BaseStream.Length || starts[n] != e) throw new Exception("Invalid graph layout");
            }
            heads=new int[serverCount]; lengths=new int[serverCount]; credits=new float[serverCount]; queueData=new int[serverCount*QueueCapacity]; agentNodes=new int[Population]; agentQueue=new int[Population];
            var floor = new List<int>(); double sx=0,sy=0; for(int i=0;i<n;i++) if(Math.Abs(z[i]+5)<.01f) { floor.Add(i); sx+=x[i]; sy+=y[i]; }
            if(floor.Count==0) throw new Exception("No Tianhe concourse nodes");
            for(int i=0;i<Population;i++) { agentNodes[i]=floor[(int)(((uint)i*2654435761u)%floor.Count)]; agentQueue[i]=-1; }
            mesh=PlaceholderCrowdMesh.Create(); material.enableInstancing=true;
            var camera=Camera.main; camera.transform.position=new Vector3((float)(sx/floor.Count),95,(float)(sy/floor.Count)-65); camera.transform.rotation=Quaternion.Euler(55,0,0); camera.orthographic=true; camera.orthographicSize=65; camera.farClipPlane=400;
            phaseStarted=previousFrame=Time.realtimeSinceStartupAsDouble;
        }
        void Update() {
            if (manualMode) return;
            double now=Time.realtimeSinceStartupAsDouble, dt=now-previousFrame; previousFrame=now;
            if (phase>=Speeds.Length) { RenderAgents(); return; }
            double elapsed=now-phaseStarted;
            if (elapsed-dt>=WarmSeconds) { frames.Add(dt*1000); frameCount++; }
            accumulator+=Math.Min(dt, .25)*Speeds[phase];
            double start=Time.realtimeSinceStartupAsDouble;
            while(accumulator>=1 && (Time.realtimeSinceStartupAsDouble-start)*1000<TickBudgetMs) {
                long before=System.Diagnostics.Stopwatch.GetTimestamp(); Step(); double ms=(System.Diagnostics.Stopwatch.GetTimestamp()-before)*1000.0/System.Diagnostics.Stopwatch.Frequency;
                if(elapsed>=WarmSeconds) { ticks.Add(ms); tickCount++; } accumulator-=1;
            }
            if(accumulator>Speeds[phase]*2) { int discard=(int)(accumulator-Speeds[phase]*2); accumulator-=discard; discardedBacklog+=discard; }
            RenderAgents();
            if(elapsed>=WarmSeconds+MeasureSeconds) EndPhase(elapsed-WarmSeconds);
        }
        public void ManualStep() { if(!manualMode)throw new InvalidOperationException("Manual mode is disabled"); Step(); }
        public void ManualRender() { if(!manualMode)throw new InvalidOperationException("Manual mode is disabled"); RenderAgents(); }
        public int ManualTick => tick;
        public int ManualQueued => queued;
        public int ManualAdmitted => admitted;
        public int ManualCompleted => completed;
        void RenderAgents() {
            for(int first=0;first<Population;first+=matrices.Length) {
                int count=Math.Min(matrices.Length,Population-first);
                for(int j=0;j<count;j++) { int id=first+j, node=agentNodes[id]; matrices[j]=Matrix4x4.TRS(new Vector3(x[node],z[node],y[node]),Quaternion.identity,Vector3.one); }
                Graphics.DrawMeshInstanced(mesh,0,material,matrices,count,null,UnityEngine.Rendering.ShadowCastingMode.Off,false);
            }
        }
        void Step() {
            tick++;
            for(int s=0;s<serverCount;s++) {
                credits[s]=Mathf.Min(8,credits[s]+Mathf.Max(0,rates[s])); int capacity=Math.Min(8,(int)credits[s]); credits[s]-=capacity;
                while(capacity-->0 && lengths[s]>0) { int id=queueData[s*QueueCapacity+heads[s]]; heads[s]=(heads[s]+1)%QueueCapacity; lengths[s]--; agentQueue[id]=-1; queued--; completed++; }
            }
            for(int i=0;i<Population;i++) {
                if(agentQueue[i]>=0) continue;
                int node=agentNodes[i];
                // Fixed-rate arrivals sample real server nodes while walking the real graph.
                if((i+tick)%97==0) { int s=(int)(((uint)i*2654435761u+(uint)tick)%serverCount); if(serverNodes[s]>=0 && serverNodes[s]<n && lengths[s]<QueueCapacity) { agentNodes[i]=serverNodes[s]; queueData[s*QueueCapacity+(heads[s]+lengths[s])%QueueCapacity]=i; lengths[s]++; agentQueue[i]=s; queued++; admitted++; continue; } }
                int count=starts[node+1]-starts[node]; if(count>0) agentNodes[i]=edges[starts[node]+(int)(((uint)i*1103515245u+(uint)tick*12345u)%(uint)count)];
            }
        }
        static double Percentile(List<double> values,double fraction) { if(values.Count==0)return 0; var sorted=values.ToArray(); Array.Sort(sorted); return sorted[(int)Math.Floor((sorted.Length-1)*fraction)]; }
        void EndPhase(double elapsed) {
            phases.Add(new Phase { speed=Speeds[phase],frames=frameCount,ticks=tickCount,queued=queued,admitted=admitted,completed=completed,discardedBacklog=discardedBacklog,elapsed=elapsed,effectiveTicksPerSecond=tickCount/elapsed,frameMedianMs=Percentile(frames,.5),frameP95Ms=Percentile(frames,.95),frameMaxMs=Percentile(frames,1),tickMedianMs=Percentile(ticks,.5),tickP95Ms=Percentile(ticks,.95),tickMaxMs=Percentile(ticks,1) });
            phase++; if(phase==Speeds.Length) { MetroFeasibilityResult(JsonUtility.ToJson(new Summary {status="complete",kind="actual-tianhe-graph-synthetic-crowd",limitations="Random adjacency walk and synthetic arrivals; not TS World, A* pathfinding, station geometry, GPU completion or physical display.",nodes=n,edges=e,servers=serverCount,population=Population,phases=phases.ToArray()})); return; }
            frames.Clear(); ticks.Clear(); frameCount=tickCount=discardedBacklog=admitted=completed=0; accumulator=0; phaseStarted=Time.realtimeSinceStartupAsDouble;
        }
        void OnDestroy() { if(mesh!=null) Destroy(mesh); }
    }
}


