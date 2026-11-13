using System;
using System.Runtime.InteropServices;
using Metro.Build;
using Metro.Feasibility;
using Metro.Persistence;
using Metro.Sim;
using UnityEngine;

namespace Metro.App {
    public sealed class FirstPlayableView : MonoBehaviour {
        public GameObject trainPrefab;
        public AnimationClip platformDoors;
        public Shader stationShader;
        FirstPlayableStation station = new FirstPlayableStation();
        FirstPlayableService service;
        GameObject floor, secondFloor, detourApproach, detourFloor, gate, passenger, train, animatedTrain;
        Transform observedDoor;
        Vector3 closedDoorPosition;
        string tool = "Floor", message = "Place the missing floor, then the fare gate.";
        float elapsed;
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void FirstPlayableDownload(string json);
        [DllImport("__Internal")] static extern void FirstPlayableOpen();
        [DllImport("__Internal")] static extern void FirstPlayableState(string json);
#else
        static void FirstPlayableDownload(string json) { Debug.Log(json); }
        static void FirstPlayableOpen() { Debug.Log("File picker is available in Web."); }
        static void FirstPlayableState(string json) { }
#endif
        [Serializable] sealed class State { public bool floor, gate, secondFloor, secondGate, detourApproach, detourFloor, detourGate, running; public string stage, message; public int boarded; public float doorMovement, passengerX, passengerY, secondFloorScreenX, secondFloorScreenY, secondGateScreenX, secondGateScreenY, detourApproachScreenX, detourApproachScreenY, detourFloorScreenX, detourFloorScreenY; }
        void Publish() {
            var floorPoint=Camera.main.WorldToScreenPoint(new Vector3(2.5f,0,1.5f));
            var gatePoint=Camera.main.WorldToScreenPoint(new Vector3(3.5f,0,1.5f));
            var a=Camera.main.WorldToScreenPoint(new Vector3(2.5f,0,2.5f)); var b=Camera.main.WorldToScreenPoint(new Vector3(3.5f,0,2.5f));
            FirstPlayableState(JsonUtility.ToJson(new State { detourApproachScreenX=a.x, detourApproachScreenY=Screen.height-a.y, detourFloorScreenX=b.x, detourFloorScreenY=Screen.height-b.y, detourApproach=station.HasDetourApproach, detourFloor=station.HasDetourFloor, detourGate=station.HasDetourGate, secondFloorScreenX=floorPoint.x, secondFloorScreenY=Screen.height-floorPoint.y, secondGateScreenX=gatePoint.x, secondGateScreenY=Screen.height-gatePoint.y, floor=station.HasFloor, gate=station.HasGate,
            secondFloor=station.HasSecondFloor, secondGate=station.HasSecondGate, passengerX=service==null?0:(float)service.X, passengerY=service==null?0:(float)service.Y, running=service!=null && !service.Finished, stage=service==null?"Paused":service.CurrentStage.ToString(),
            boarded=service==null?0:service.BoardedCount, message=message, doorMovement=observedDoor?Vector3.Distance(observedDoor.localPosition,closedDoorPosition):0 })); }
        GameObject Box(string name, Vector3 position, Vector3 scale, Color color) {
            var obj=GameObject.CreatePrimitive(PrimitiveType.Cube); obj.name=name; obj.transform.position=position; obj.transform.localScale=scale;
            var material=new Material(stationShader); material.color=color; obj.GetComponent<Renderer>().material=material; return obj;
        }
        void Start() {
            for(int x=0;x<6;x++) if(x!=2) Box("Floor "+x,new Vector3(x+.5f,-.1f,.5f),new Vector3(.98f,.2f,.98f),new Color(.72f,.76f,.77f));
            for(int x=0;x<5;x++) if(x!=2) Box("Second floor "+x,new Vector3(x+.5f,-.1f,1.5f),new Vector3(.98f,.2f,.98f),new Color(.72f,.76f,.77f));
            for(int x=0;x<5;x++) if(x<2 || x==4) Box("Detour fixed floor "+x,new Vector3(x+.5f,-.1f,2.5f),new Vector3(.98f,.2f,.98f),new Color(.72f,.76f,.77f));
            Box("Entrance",new Vector3(.15f,1,.5f),new Vector3(.12f,2,1.4f),new Color(.1f,.55f,.5f));
            Box("Platform",new Vector3(4.8f,-.15f,1.4f),new Vector3(3,.3f,1),new Color(.65f,.66f,.62f));
            if(trainPrefab) { train=Instantiate(trainPrefab); train.name="Type A train"; train.transform.position=new Vector3(5,0,3);
                var basis=train.transform.Find("Unity basis"); if(basis && basis.childCount>0) animatedTrain=basis.GetChild(0).gameObject;
                if(animatedTrain && !animatedTrain.GetComponent<Animator>()) animatedTrain.AddComponent<Animator>();
                foreach(var node in train.GetComponentsInChildren<Transform>()) if(node.name=="TrainADoor00" || node.name=="TypeADoor00") { observedDoor=node; closedDoorPosition=node.localPosition; break; } }
            passenger=new GameObject("Passenger"); passenger.AddComponent<MeshFilter>().mesh=PlaceholderCrowdMesh.Create();
            var renderer=passenger.AddComponent<MeshRenderer>(); renderer.material=new Material(stationShader); renderer.material.color=new Color(.85f,.3f,.15f);
            passenger.SetActive(false); Refresh(); Publish();
        }
        void Refresh() {
            if(floor) Destroy(floor); if(secondFloor) Destroy(secondFloor); if(detourApproach) Destroy(detourApproach); if(detourFloor) Destroy(detourFloor); if(gate) Destroy(gate);
            if(station.HasDetourApproach) detourApproach=Box("Detour approach",new Vector3(2.5f,-.1f,2.5f),new Vector3(.98f,.2f,.98f),new Color(.8f,.78f,.55f));
            if(station.HasDetourFloor) detourFloor=Box("Detour floor",new Vector3(3.5f,-.1f,2.5f),new Vector3(.98f,.2f,.98f),new Color(.8f,.78f,.55f));
            if(station.HasDetourGate) gate=Box("Detour gate",new Vector3(3.5f,.55f,2.5f),new Vector3(.25f,1.1f,.7f),new Color(.12f,.42f,.6f));
            if(station.HasFloor) floor=Box("Placed floor",new Vector3(2.5f,-.1f,.5f),new Vector3(.98f,.2f,.98f),new Color(.8f,.78f,.55f));
            if(station.HasSecondFloor) secondFloor=Box("Second placed floor",new Vector3(2.5f,-.1f,1.5f),new Vector3(.98f,.2f,.98f),new Color(.8f,.78f,.55f));
            if(station.HasSecondGate) gate=Box("Second fare gate",new Vector3(3.5f,.55f,1.5f),new Vector3(.25f,1.1f,.7f),new Color(.12f,.42f,.6f));
            if(station.HasGate) gate=Box("Fare gate",new Vector3(2.5f,.55f,.5f),new Vector3(.25f,1.1f,.7f),new Color(.12f,.42f,.6f));
        }
        void OnGUI() {
            GUI.skin.button.normal.textColor=Color.black; GUI.skin.button.hover.textColor=Color.black;
            GUI.skin.button.active.textColor=Color.black; GUI.skin.box.normal.textColor=Color.black;
            const int h=40; int x=12;
            if(GUI.Button(new Rect(x,12,85,h),"Floor")) tool="Floor"; x+=90;
            if(GUI.Button(new Rect(x,12,85,h),"Gate")) tool="Gate"; x+=90;
            if(GUI.Button(new Rect(x,12,85,h),"Run")) Run(); x+=90;
            if(GUI.Button(new Rect(x,12,85,h),"Save")) FirstPlayableDownload(FirstPlayableSave.Write(station,DateTimeOffset.UtcNow)); x+=90;
            if(GUI.Button(new Rect(x,12,85,h),"Open")) FirstPlayableOpen();
            GUI.Box(new Rect(12,58,500,55), tool+" | "+message+"\nBoarded: "+(service==null?0:service.BoardedCount));
            var e=Event.current;
            if(e.type==EventType.MouseDown && e.button==0 && e.mousePosition.y>115) {
                var ray=Camera.main.ScreenPointToRay(new Vector3(e.mousePosition.x,Screen.height-e.mousePosition.y));
                if(new Plane(Vector3.up,Vector3.zero).Raycast(ray,out float distance)) {
                    var p=ray.GetPoint(distance); int gx=Mathf.FloorToInt(p.x), gy=Mathf.FloorToInt(p.z);
                    bool placed=tool=="Floor"?station.PlaceFloor(gx,gy,0):station.PlaceGate(gx,gy,0);
                    message=placed?tool+" placed.":"Cannot place here; the gate needs the missing floor.";
                    if(placed) Refresh(); Publish();
                }
                e.Use();
            }
        }
        void Run() {
            if(service!=null && !service.Finished) { message="Service is already running."; }
            else if(!station.CanRun) { message=station.RouteProblem; }
            else { station.TryPath(out var route, out int gateIndex); service=new FirstPlayableService(route,gateIndex); elapsed=0; passenger.SetActive(true); if(animatedTrain && platformDoors) platformDoors.SampleAnimation(animatedTrain,0); message="Service running."; }
            Publish();
        }
        void Update() {
            if(service==null || service.Finished) return;
            elapsed+=Time.deltaTime;
            if(elapsed>=.5f) { elapsed-=.5f; service.Step(); passenger.transform.position=new Vector3((float)service.X,0,(float)service.Y);
                if(animatedTrain && platformDoors && (service.CurrentStage==FirstPlayableService.Stage.Platform || service.Finished)) platformDoors.SampleAnimation(animatedTrain,1);
                if(service.Finished) { passenger.SetActive(false); message="Passenger boarded."; } Publish(); }
        }
        // The browser bridge sends the selected file only after it has been read in full.
        public void OpenFile(string json) {
            try { var candidate=FirstPlayableSave.Read(json); station=candidate; service=null; passenger.SetActive(false); Refresh(); message="Station opened."; }
            catch(Exception) { message="Could not open this station; current edits were kept."; }
            Publish();
        }
    }
}
