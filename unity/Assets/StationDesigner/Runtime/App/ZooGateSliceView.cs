using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using Metro.Feasibility;
using Metro.Persistence;
using Metro.Sim;
using UnityEngine;

namespace Metro.App {
    // A bounded one-passenger comparison, not the full Zoo renderer or World port.
    public sealed class ZooGateSliceView : MonoBehaviour {
        public TextAsset station,oracle;
        public Material blockMaterial,gateMaterial,crowdMaterial;
        public string stationName="Zoo",gateModuleId="gate-243"; public int expectedGateId=52,gateX=59,gateY=18,levelBase=-15;
        public TianheFeasibility syntheticCrowd;
        [Serializable] sealed class Fixture { public int seed,gateId,passengerId; public double speed,rate; public GatePathSlice.Waypoint[] path; }
        [Serializable] sealed class Snapshot { public int tick,state,pathIndex,gateDir,queue,lane,waitCount,syntheticTick,syntheticQueued,syntheticAdmitted,syntheticCompleted; public double x,y,z,cooldown,waitAccum; public bool dead; }
        GatePathSlice sim; Mesh cube,crowd; readonly List<Matrix4x4[]> blocks=new List<Matrix4x4[]>(); readonly List<Matrix4x4[]> gates=new List<Matrix4x4[]>();
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void MetroZooGateState(string json);
        [DllImport("__Internal")] static extern void MetroZooGateError(string message);
#else
        static void MetroZooGateState(string json) { Debug.Log(json); }
        static void MetroZooGateError(string message) { Debug.LogError(message); }
#endif
        static void Pack(List<Matrix4x4[]> target,List<Matrix4x4> source) { for(int i=0;i<source.Count;i+=1023)target.Add(source.GetRange(i,Math.Min(1023,source.Count-i)).ToArray()); }
        void Start() {
            try {
                var doc=StationSaveV1.Read(station.text);var cfg=JsonUtility.FromJson<Fixture>(oracle.text);
                if(cfg.seed!=7654321 || cfg.gateId!=expectedGateId || cfg.passengerId!=1)throw new Exception("Unexpected gate fixture");
                if(!doc.Gates().Any(g=>g.Id==gateModuleId && g.X==gateX && g.Y==gateY && g.Z==levelBase))throw new Exception("Fixture gate missing");
                sim=new GatePathSlice(cfg.path,cfg.speed,cfg.rate);
                var primitive=GameObject.CreatePrimitive(PrimitiveType.Cube);cube=primitive.GetComponent<MeshFilter>().sharedMesh;Destroy(primitive);crowd=PlaceholderCrowdMesh.Create();
                var cells=new List<Matrix4x4>();foreach(var c in doc.SolidCells()) if(c.Z>=levelBase && c.Z<levelBase+5) cells.Add(Matrix4x4.TRS(new Vector3(c.X+.5f,c.Z+.5f,c.Y+.5f),Quaternion.identity,Vector3.one));Pack(blocks,cells);
                var machines=new List<Matrix4x4>();foreach(var g in doc.Gates()) if(g.Z==levelBase) machines.Add(Matrix4x4.TRS(new Vector3(g.X+.5f,g.Z+1.5f,g.Y+.5f),Quaternion.Euler(0,g.Rotation*90,0),new Vector3(.25f,1,.8f)));Pack(gates,machines);
                blockMaterial.enableInstancing=true;gateMaterial.enableInstancing=true;crowdMaterial.enableInstancing=true;
                var target=new Vector3(gateX+.5f,levelBase+1,gateY+.5f);var cam=Camera.main;cam.transform.position=target+new Vector3(18,22,-18);cam.transform.LookAt(target);cam.orthographic=true;cam.orthographicSize=18;cam.farClipPlane=400;
                Publish();
            } catch(Exception error) { MetroZooGateError(error.ToString());enabled=false; }
        }
        void Publish() { MetroZooGateState(JsonUtility.ToJson(new Snapshot {tick=sim.Tick,state=sim.State,pathIndex=sim.PathIndex,gateDir=sim.GateDirection,queue=sim.QueueCount,lane=sim.Lane,waitCount=sim.WaitCount,x=sim.X,y=sim.Y,z=sim.Z,cooldown=sim.Cooldown,waitAccum=sim.WaitAccum,dead=sim.Dead,syntheticTick=syntheticCrowd?syntheticCrowd.ManualTick:0,syntheticQueued=syntheticCrowd?syntheticCrowd.ManualQueued:0,syntheticAdmitted=syntheticCrowd?syntheticCrowd.ManualAdmitted:0,syntheticCompleted=syntheticCrowd?syntheticCrowd.ManualCompleted:0})); }
        void OnGUI() {
            if(sim==null)return;
            if(GUI.Button(new Rect(16,16,180,40),"Advance one second")&&!sim.Dead){if(syntheticCrowd)syntheticCrowd.ManualStep();sim.Step();Publish();}
            GUI.Label(new Rect(16,62,380,26),$"{stationName} gate | tick {sim.Tick} | queue {sim.QueueCount} | served {sim.WaitCount}");
        }
        void Update() {
            if(sim==null)return;
            foreach(var batch in blocks)Graphics.DrawMeshInstanced(cube,0,blockMaterial,batch,batch.Length,null,UnityEngine.Rendering.ShadowCastingMode.Off,false);
            foreach(var batch in gates)Graphics.DrawMeshInstanced(cube,0,gateMaterial,batch,batch.Length,null,UnityEngine.Rendering.ShadowCastingMode.Off,false);
            if(syntheticCrowd)syntheticCrowd.ManualRender();
            if(!sim.Dead)Graphics.DrawMeshInstanced(crowd,0,crowdMaterial,new[]{Matrix4x4.TRS(new Vector3((float)sim.X,(float)sim.Z,(float)sim.Y),Quaternion.identity,Vector3.one)},1,null,UnityEngine.Rendering.ShadowCastingMode.Off,false);
        }
        void OnDestroy(){if(crowd!=null)Destroy(crowd);}
    }
}
