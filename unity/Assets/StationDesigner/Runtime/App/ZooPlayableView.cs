using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using Metro.Feasibility;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace Metro.App {
    public sealed class ZooPlayableView : MonoBehaviour {
        public TextAsset fixture, layout;
        public RuntimeCatalogue catalogue;
        public TrainCatalogue trainCatalogue;
        public GameObject passengerPrefab;
        public AnimationClip[] passengerClips = Array.Empty<AnimationClip>();
        public Shader stationShader;
        public Font font;

        [Serializable] sealed class Layout {
            public ZooGeometry.Footprint[] footprints;
            public GatePathSlice.Waypoint[] path;
            public int[] approach;
            public string exit, gate, platform;
            public ZooWalkGraph.Node[] nodes;
            public GatePathSlice.Waypoint[] prefix;
            public int start, gateNode, door;
        }
        [Serializable] sealed class BrowserState {
            public int cells, modules, lines, level, queued, boarded, revision, speed, routeWaypoints, tick, simTime;
            public int prefabViews, liveViews, generatedViews, batchedViews, fallbackViews, unresolvedViews;
            public bool floor, gate, running, connected, doorsOpen;
            public string tool, message, document, formation, trainDoorSide;
            public string[] visualKeys = Array.Empty<string>();
            public string[] unresolved = Array.Empty<string>();
            public float yaw, zoom, targetX, targetY, doorMovement, trainScale, passengerHeight;
            public Vector2 floorPoint, gatePoint, alternatePoint, connectorPoint;
            public MissingFloor[] missingFloor;
        }
        [Serializable] sealed class MissingFloor { public int x,y,z; }
        [Serializable] sealed class BrowserCommandData {
            public string type, value;
        }

        static readonly int[] Levels = { 0, -5, -10, -15, -20 };
        const int ServiceLevel = -15;
        const int GroupSize = 5;
        StationSaveV1 document;
        Layout route;
        JObject authoredGate;
        LineFacts line;
        Dictionary<(int,int,int), JObject> authoredCells;
        Dictionary<string, JObject> authoredModules;
        JArray authoredLines;
        ZooWalkGraph walkGraph;
        ZooFloorEdits edits;
        GatePathSlice.Waypoint[] activePath;
        HashSet<(int,int,int)> committedSolids;
        MissingFloor[] missingFloor;
        int revision, acknowledgedRevision = -1;
        string documentSnapshot;
        bool documentOpenPending;
        float nextDocumentSend;
        Dictionary<string, ZooGeometry.Footprint> footprints;
        Vector3Int floorSlot, gateSlot;
        ZooGeometry geometry;
        Mesh cube;
        StationMaterials materials;
        Material floorMaterial, cursorMaterial;
        GameObject floorObject, cursor, train;
        TrainCatalogue.Entry trainEntry;
        Transform trainModel;
        TrainDoorRig trainDoors;
        readonly List<GameObject> editMarkers = new List<GameObject>();
        readonly List<(GatePathSlice sim, PassengerActor view, int delay)> passengers =
            new List<(GatePathSlice, PassengerActor, int)>();
        RectTransform panel;
        Text status, runLabel, levelLabel;
        int levelIndex, ticks, queued, boarded, speed = 1;
        bool floor, gate, running, doorsOpen;
        float yaw, pitch, zoom;
        readonly SimulationScheduler scheduler = new SimulationScheduler();
        Vector3 target;
        string tool = "Inspect", message = "Entrance B to Line 5 down platform";
        bool dragging;
        Camera cameraView;
        ZooPassengerWorld world;

        [Serializable] public sealed class LineFacts {
            public string id, stock, power, direction, city;
            public int cars;
            public float modelScale = 1;
            public string colour;
        }

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void ZooPlayableDownload(string json);
        [DllImport("__Internal")] static extern void ZooPlayableOpen();
        [DllImport("__Internal")] static extern void ZooPlayableState(string json);
        [DllImport("__Internal")] static extern bool ZooPlayablePointerOnCanvas(float x, float y, float width, float height);
#else
        static void ZooPlayableDownload(string json) => System.IO.File.WriteAllText("edited-zoo.metro.json", json);
        static void ZooPlayableOpen() => Debug.Log("Use Open in the Web preview.");
        static void ZooPlayableState(string json) { }
#endif

        void Start() {
            route = JsonUtility.FromJson<Layout>(layout.text);
            footprints = route.footprints.ToDictionary(f => f.id);
            floorSlot = new Vector3Int(route.approach[0], route.approach[1], route.approach[2]);
            var authored = StationSaveV1.Read(fixture.text);
            walkGraph = new ZooWalkGraph(route.nodes);
            authoredCells = authored.CopyCells().Cast<JObject>().ToDictionary(c => ((int)c["x"], (int)c["y"], (int)c["z"]));
            authoredModules = authored.CopyModules().Cast<JObject>().ToDictionary(m => (string)m["id"]);
            authoredLines = authored.CopyLines();
            line = ReadLine(authoredLines);
            edits = new ZooFloorEdits(authoredCells.Where(pair => (string)pair.Value["fill"] == "solid" &&
                walkGraph.Contains(pair.Key.Item1,pair.Key.Item2,pair.Key.Item3)).Select(pair => pair.Key));
            authoredGate = (JObject)authored.CopyModules().Single(m => (string)m["id"] == route.gate);
            gateSlot = new Vector3Int((int)authoredGate["x"], (int)authoredGate["y"], (int)authoredGate["z"]);

            cameraView = Camera.main;
            var primitive = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube = primitive.GetComponent<MeshFilter>().sharedMesh;
            primitive.SetActive(false);
            Destroy(primitive);
            materials = new StationMaterials(stationShader);
            floorMaterial = MakeMaterial(new Color(.96f, .76f, .36f));
            cursorMaterial = MakeMaterial(new Color(.95f, .46f, .12f));
            floorObject = Model("Editable approach floor", cube, floorMaterial, World(floorSlot, .5f), Vector3.one);
            cursor = Model("Placement preview", cube, cursorMaterial, Vector3.zero, new Vector3(.78f, .035f, .78f));
            cursor.SetActive(false);
            MarkSlot(floorSlot, floorMaterial);
            MarkSlot(gateSlot, MakeMaterial(new Color(.15f, .65f, .65f)));
            BuildTrain();
            BuildToolbar();
#if UNITY_WEBGL && !UNITY_EDITOR
            panel.parent.gameObject.SetActive(false);
#endif
            Install(authored);
            ResetView();
        }

        static LineFacts ReadLine(JArray lines) {
            var record = lines?.FirstOrDefault() as JObject;
            if (record == null) return new LineFacts { stock = "A", cars = 2, power = "overhead" };
            return new LineFacts {
                id = (string)record["id"], stock = (string)record["stock"] ?? "A",
                cars = (int?)record["cars"] ?? 2, power = (string)record["power"] ?? "overhead",
                direction = (string)record["direction"] ?? "down", colour = (string)record["colour"],
                modelScale = (float?)record["modelScale"] ?? 1f,
            };
        }

        Material MakeMaterial(Color colour) => new Material(stationShader) { color = colour };
        GameObject Model(string name, Mesh mesh, Material material, Vector3 position, Vector3 scale) {
            var obj = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            obj.transform.SetParent(transform, false);
            obj.transform.position = position;
            obj.transform.localScale = scale;
            obj.GetComponent<MeshFilter>().sharedMesh = mesh;
            obj.GetComponent<MeshRenderer>().sharedMaterial = material;
            return obj;
        }
        void MarkSlot(Vector3Int slot, Material material) {
            foreach (float offset in new[] { -.46f, .46f }) {
                var center = World(slot, 1.025f);
                editMarkers.Add(Model("Edit slot border", cube, material, center + Vector3.right * offset,
                    new Vector3(.055f, .035f, .96f)));
                editMarkers.Add(Model("Edit slot border", cube, material, center + Vector3.forward * offset,
                    new Vector3(.96f, .035f, .055f)));
            }
        }
        static bool At(JToken record, Vector3Int slot) =>
            (int)record["x"] == slot.x && (int)record["y"] == slot.y && (double)record["z"] == slot.z;
        static Vector3 World(Vector3Int slot, float rise) => new Vector3(slot.x + .5f, slot.z + rise, slot.y + .5f);

        void BuildTrain() {
            var key = TrainFormations.Select(line.stock, line.cars, line.power, trainCatalogue);
            trainEntry = null;
            trainCatalogue?.TryGet(key, out trainEntry);
            var prefab = trainEntry?.prefab;
            if (!prefab) {
                Debug.LogWarning($"No promoted formation for {key}; the Line 5 train stays hidden.");
                return;
            }
            train = Instantiate(prefab, transform);
            train.name = "Line 5 down train";
            // The promoted consist bakes the line's model scale; applying it again would
            // shrink the train a second time (`09-train-parity`).
            train.transform.localScale = Vector3.one;
            var basis = train.transform.Find("Unity basis");
            trainModel = basis && basis.childCount > 0 ? basis.GetChild(0) : train.transform;
            var board = route.path[route.path.Length - 1];
            train.transform.position = new Vector3((float)board.x, (float)board.z - .42f, -2.5f);
            AlignTrainDoor(board);
            // Door-side bindings come from this formation, not from a fixture's leaf names.
            trainDoors = new TrainDoorRig(train, trainEntry != null && trainEntry.bakedScale > 0f ? trainEntry.bakedScale : 1f);
            trainDoors.Apply(0f);
        }

        /// <summary>Shift the consist along the track so a door centre meets the platform stop.</summary>
        void AlignTrainDoor(GatePathSlice.Waypoint board) {
            var centres = train.GetComponentsInChildren<Transform>(true)
                .Where(node => node.name.StartsWith("DoorCentre-", StringComparison.Ordinal)).ToArray();
            if (centres.Length == 0) return;
            Transform nearest = null;
            float best = float.MaxValue;
            foreach (var centre in centres) {
                float distance = Mathf.Abs(centre.position.x - (float)board.x);
                if (distance >= best) continue;
                best = distance; nearest = centre;
            }
            if (!nearest) return;
            train.transform.position += Vector3.right * ((float)board.x - nearest.position.x);
        }

        void Install(StationSaveV1 candidate) {
            var cells = candidate.CopyCells();
            var modules = candidate.CopyModules();
            if (!JToken.DeepEquals(authoredLines,candidate.CopyLines())) throw new FormatException("Unsupported Zoo line edit.");
            var currentCells = cells.Cast<JObject>().ToDictionary(c => ((int)c["x"], (int)c["y"], (int)c["z"]));
            var currentModules = modules.Cast<JObject>().ToDictionary(m => (string)m["id"]);
            foreach (var pair in authoredCells) {
                bool exists = currentCells.TryGetValue(pair.Key, out var cell);
                if (!exists && edits.CanSet(pair.Key.Item1,pair.Key.Item2,pair.Key.Item3,true,false)) continue;
                if (!exists || !JToken.DeepEquals(pair.Value,cell)) throw new FormatException("Unsupported Zoo cell edit outside the walkable floor slice.");
            }
            if (currentCells.Keys.Any(key => !authoredCells.ContainsKey(key))) throw new FormatException("Unsupported new Zoo cell.");
            foreach (var pair in authoredModules) {
                if (pair.Key == route.gate && !currentModules.ContainsKey(pair.Key)) continue;
                if (!currentModules.TryGetValue(pair.Key,out var module) || !JToken.DeepEquals(pair.Value,module))
                    throw new FormatException("Unsupported Zoo module edit.");
            }
            if (currentModules.Keys.Any(key => !authoredModules.ContainsKey(key))) throw new FormatException("Unsupported new Zoo module.");
            if (!modules.Any(m => (string)m["id"] == route.exit && (string)m["type"] == "exit") ||
                !modules.Any(m => (string)m["id"] == route.platform && (string)m["type"] == "platform-edge") ||
                !modules.Any(m => (string)m["id"] == "track-5" && (string)m["type"] == "track"))
                throw new FormatException("Open an authored Zoo station save.");
            var savedGate = modules.FirstOrDefault(m => (string)m["id"] == route.gate);
            var savedFloor = cells.FirstOrDefault(c => At(c, floorSlot));
            if (savedGate != null && (!At(savedGate, gateSlot) || (string)savedGate["type"] != "gate" ||
                (int?)savedGate["rot"] != (int)authoredGate["rot"]))
                throw new FormatException("The Zoo service gate has moved.");
            var facts = ModuleFactsReader.Read(modules);
            var nextGeometry = new ZooGeometry(transform, materials, cube);
            var filled = new HashSet<(int,int,int)>(candidate.SolidCells().Select(c => (c.X,c.Y,c.Z)));
            var consist = new TrainFacts {
                Stock = line.stock, Cars = line.cars, Power = line.power, Direction = line.direction, ModelScale = line.modelScale,
            };
            try { nextGeometry.Build(cells, facts, footprints, catalogue, route.gate, floorSlot, (x,y,z) => edits.CanSet(x,y,z,true,false), (x,y,z) => filled.Contains((x,y,z)), consist); }
            catch { nextGeometry.Dispose(); throw; }
            geometry?.Dispose();
            geometry = nextGeometry;
            document = candidate;
            committedSolids = new HashSet<(int,int,int)>(candidate.SolidCells().Select(c => (c.X,c.Y,c.Z)));
            missingFloor = authoredCells.Where(p => edits.CanSet(p.Key.Item1,p.Key.Item2,p.Key.Item3,true,false) && !committedSolids.Contains(p.Key))
                .Select(p => new MissingFloor { x=p.Key.Item1,y=p.Key.Item2,z=p.Key.Item3 }).ToArray();
            floor = (string)savedFloor?["fill"] == "solid";
            gate = savedGate != null;
            activePath = gate ? walkGraph.Find(route.start,route.gateNode,route.door,
                (x,y,z) => currentCells.TryGetValue((x,y,z),out var cell) && (string)cell["fill"] == "solid",route.prefix) : null;
            revision++;
            documentSnapshot = document.Write(DateTimeOffset.UtcNow);
            // An open must reach the shared UI so it adopts the station; an edit only
            // publishes its revision and counters.
            documentOpenPending = true;
            nextDocumentSend = 0f;
            ResetService();
            ShowLevel();
        }

        bool Connected => activePath != null;
        string RouteProblem => !gate ? "Blocked: place the fare gate at its marked position." :
            !Connected ? "Blocked: connect the floor from the entrance through the gate to the platform." : "Route connected.";

        void BuildToolbar() {
            var canvas = new GameObject("Zoo toolbar", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvas.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(960, 600);
            panel = Item(canvas.transform, "Toolbar", 0, 0, 960, 86, true);
            panel.GetComponent<Image>().color = new Color(.075f, .12f, .14f, .98f);
            AddButton("Inspect", 10, 68, () => SetTool("Inspect"));
            AddButton("Floor", 84, 55, () => SetTool("Floor"));
            AddButton("Gate", 145, 55, () => SetTool("Gate"));
            AddButton("Delete", 206, 63, () => SetTool("Delete"));
            runLabel = AddButton("Run", 283, 71, ToggleRun);
            AddButton("Save", 360, 58, () => ZooPlayableDownload(document.Write(DateTimeOffset.UtcNow)));
            AddButton("Open", 424, 58, ZooPlayableOpen);
            levelLabel = AddButton("Level 0 m", 496, 109, () => SetLevel((levelIndex + 1) % Levels.Length));
            AddButton("Reset view", 611, 90, ResetView);
            AddButton("Service area", 707, 109, FocusService);
            status = Label(panel, "Service status", 12, 41, 936, 23, 13);
            Label(panel, "Camera controls", 12, 64, 936, 18, 12).text =
                "Middle drag orbit  /  Right drag pan  /  Scroll zoom  /  Left click edit";
        }

        static RectTransform Item(Transform parent, string name, float x, float y, float width, float height, bool image) {
            var obj = new GameObject(name, typeof(RectTransform));
            if (image) obj.AddComponent<Image>();
            var rect = (RectTransform)obj.transform;
            rect.SetParent(parent, false);
            rect.anchorMin = rect.anchorMax = rect.pivot = new Vector2(0, 1);
            rect.anchoredPosition = new Vector2(x, -y);
            rect.sizeDelta = new Vector2(width, height);
            return rect;
        }
        Text Label(Transform parent, string name, float x, float y, float width, float height, int size) {
            var text = Item(parent, name, x, y, width, height, false).gameObject.AddComponent<Text>();
            text.font = font;
            text.fontSize = size;
            text.color = new Color(.94f, .97f, .96f);
            text.alignment = TextAnchor.MiddleLeft;
            text.raycastTarget = false;
            return text;
        }
        Text AddButton(string caption, int x, int width, UnityEngine.Events.UnityAction click) {
            var rect = Item(panel, caption, x, 8, width, 29, true);
            var image = rect.GetComponent<Image>();
            image.color = new Color(.23f, .35f, .39f);
            var button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(click);
            var label = Label(rect, "Label", 0, 0, width, 29, 14);
            label.alignment = TextAnchor.MiddleCenter;
            label.text = caption;
            return label;
        }

        int Level => Levels[levelIndex];
        void SetLevel(int index) {
            levelIndex = index;
            target.y = Level + 1;
            ShowLevel();
            ApplyCamera();
        }
        void ShowLevel() {
            geometry.ShowThrough(Level);
            floorObject.SetActive(floor && Level >= ServiceLevel);
            if (train) train.SetActive(Level == ServiceLevel);
            foreach (var marker in editMarkers) marker.SetActive(Level == ServiceLevel);
            foreach (var passenger in passengers) RefreshPassenger(passenger);
            RefreshStatus();
        }
        void ResetView() {
            yaw = -23;
            pitch = 53;
            zoom = 52;
            target = new Vector3(68, Level + 1, 19);
            ApplyCamera();
        }
        void FocusService() {
            SetLevel(Array.IndexOf(Levels, ServiceLevel));
            yaw = -12;
            pitch = 66;
            zoom = 15;
            target = new Vector3(64, Level + 1, 10.5f);
            ApplyCamera();
        }
        /// <summary>Frame the platform door bank the consist opens on, for the smoke capture.</summary>
        void FocusTrainDoors() {
            SetLevel(Array.IndexOf(Levels, ServiceLevel));
            var board = route.path[route.path.Length - 1];
            yaw = -8; pitch = 74; zoom = 6;
            target = new Vector3((float)board.x, Level + 1, -1.2f);
            ApplyCamera();
        }
        void FocusApproach() {
            SetLevel(Array.IndexOf(Levels, ServiceLevel));
            yaw = -12; pitch = 66; zoom = 15;
            target = new Vector3(67, Level + 1, 27);
            ApplyCamera();
        }
        void ApplyCamera() {
            var rotation = Quaternion.Euler(pitch, yaw, 0);
            cameraView.transform.SetPositionAndRotation(target - rotation * Vector3.forward * 160, rotation);
            cameraView.orthographicSize = zoom;
            Publish();
        }
        void SetTool(string selected) {
            tool = selected;
            RefreshStatus();
        }

        void Update() {
            if (document == null) return;
            HandlePointer();
            if (!running) return;
            if (scheduler.Advance(Time.unscaledDeltaTime, speed, StepService) > 0) RefreshStatus();
        }
        void HandlePointer() {
            var mouse = Mouse.current;
            if (mouse == null) return;
            var position = mouse.position.ReadValue();
            bool overToolbar = RectTransformUtility.RectangleContainsScreenPoint(panel, position);
#if UNITY_WEBGL && !UNITY_EDITOR
            overToolbar = !ZooPlayablePointerOnCanvas(position.x, position.y, Screen.width, Screen.height);
#endif
            bool inCanvas = position.x >= 0 && position.x < Screen.width && position.y >= 0 && position.y < Screen.height;
            bool orbit = mouse.middleButton.isPressed;
            bool pan = mouse.rightButton.isPressed;
            if (mouse.rightButton.wasPressedThisFrame || mouse.middleButton.wasPressedThisFrame) dragging = !overToolbar && inCanvas;
            if (!orbit && !pan) dragging = false;
            var delta = mouse.delta.ReadValue();
            var scroll = mouse.scroll.ReadValue().y;
            if (dragging && delta.sqrMagnitude > 0) {
                if (orbit) {
                    yaw += delta.x * .35f;
                    pitch = Mathf.Clamp(pitch - delta.y * .3f, 17, 86);
                } else {
                    var flatForward = Quaternion.Euler(0, yaw, 0) * Vector3.forward;
                    target -= (cameraView.transform.right * delta.x + flatForward * delta.y) * (zoom * 2 / Screen.height);
                }
                ApplyCamera();
            }
            if (!overToolbar && inCanvas && Mathf.Abs(scroll) > .001f) {
                zoom = Mathf.Clamp(zoom * (scroll > 0 ? .88f : 1.14f), 4, 95);
                ApplyCamera();
            }
            cursor.SetActive(false);
            if (overToolbar || !inCanvas || dragging || tool == "Inspect" || Level != ServiceLevel) return;
            // One plane pick supplies both the preview and any click commit.
            var ray = cameraView.ScreenPointToRay(position);
            if (!new Plane(Vector3.up, new Vector3(0, Level + 1, 0)).Raycast(ray, out float distance)) return;
            var hit = ray.GetPoint(distance);
            var slot = new Vector3Int(Mathf.FloorToInt(hit.x), Mathf.FloorToInt(hit.z), Level);
            var key = (slot.x,slot.y,slot.z);
            bool exists = committedSolids.Contains(key);
            bool editFloor = (tool == "Floor" || tool == "Delete") && edits.CanSet(slot.x,slot.y,slot.z,exists,tool == "Floor");
            bool editGate = slot == gateSlot && (tool == "Gate" || tool == "Delete") &&
                edits.CanSetGate(gate,tool == "Gate",committedSolids.Contains((gateSlot.x,gateSlot.y,gateSlot.z)));
            if (slot == gateSlot && gate && tool == "Delete") editFloor = false;
            if (!editFloor && !editGate) return;
            cursor.transform.position = World(slot, 1.045f);
            cursor.SetActive(true);
            if (!mouse.leftButton.wasPressedThisFrame) return;
            // The preview verdict is rechecked against the committed state before mutation.
            // This is the only document commit; routing and rendering consume it below.
            if (editFloor && edits.CanSet(slot.x,slot.y,slot.z,committedSolids.Contains(key),tool == "Floor")) {
                bool place = tool == "Floor";
                document.SetCell(slot.x,slot.y,slot.z,place ? authoredCells[key] : null);
                if (place) committedSolids.Add(key); else committedSolids.Remove(key);
                if (slot == floorSlot) floor = place;
                else geometry.SetEditableCell(slot.x,slot.y,slot.z,place,Level,authoredCells[key]);
            } else if (editGate && edits.CanSetGate(gate,tool == "Gate",committedSolids.Contains((gateSlot.x,gateSlot.y,gateSlot.z)))) {
                gate = tool == "Gate";
                document.SetModule(route.gate,gate ? authoredGate : null);
                geometry.SetModuleVisible(route.gate, gate);
            } else return;
            activePath = gate ? walkGraph.Find(route.start,route.gateNode,route.door,
                (x,y,z) => committedSolids.Contains((x,y,z)),route.prefix) : null;
            missingFloor = authoredCells.Where(p => edits.CanSet(p.Key.Item1,p.Key.Item2,p.Key.Item3,true,false) && !committedSolids.Contains(p.Key))
                .Select(p => new MissingFloor { x=p.Key.Item1,y=p.Key.Item2,z=p.Key.Item3 }).ToArray();
            revision++;
            documentSnapshot = document.Write(DateTimeOffset.UtcNow);
            documentOpenPending = false;
            ResetService();
            message = RouteProblem;
            ShowLevel();
        }

        void ResetService() {
            foreach (var passenger in passengers) passenger.view?.Dispose();
            passengers.Clear();
            running = false;
            world = null;
            ticks = queued = boarded = 0;
            scheduler.Reset();
            SampleDoors(false);
        }
        void ToggleRun() {
            if (!Connected) {
                message = RouteProblem;
            } else if (running) {
                running = false;
                message = "Service paused.";
            } else {
                if (world == null || world.Complete) {
                    ResetService();
                    world = new ZooPassengerWorld(activePath, 7654321, GroupSize, 3600, 1);
                }
                running = true;
                message = "Service running.";
            }
            RefreshStatus();
        }
        bool StepService() {
            world.Step();
            ticks = world.Tick;
            queued = world.Queued;
            boarded = world.Boarded;
            SampleDoors(world.DoorsOpen);
            for (int i = passengers.Count; i < world.Passengers.Count; i++) {
                var sim = world.Passengers[i];
                var view = new PassengerActor("zoo-passenger-" + (i + 1), passengerPrefab,
                    passengerClips, new Vector3((float)sim.X, (float)sim.Z, (float)sim.Y), transform);
                passengers.Add((sim, view, ticks));
            }
            foreach (var passenger in passengers) {
                var sim = passenger.sim;
                passenger.view.Update(new Vector3((float)sim.X, (float)sim.Z, (float)sim.Y),
                    sim.State == 2, sim.PathIndex >= activePath.Length - 1, sim.Dead);
                RefreshPassenger(passenger);
            }
            if (boarded == GroupSize) {
                running = false;
                message = "All passengers boarded.";
            }
            return running;
        }
        void RefreshPassenger((GatePathSlice sim, PassengerActor view, int delay) passenger) {
            passenger.view?.SetVisible(!passenger.sim.Dead && ticks >= passenger.delay && passenger.sim.Z <= Level + 1.1);
        }
        void SampleDoors(bool open) {
            trainDoors?.Apply(open ? 1f : 0f);
            doorsOpen = open;
            geometry?.ApplyMotion(ticks, open, line.direction == "up" ? 1 : -1);
        }

        public void OpenFile(string json) {
            try {
                Install(StationSaveV1.Read(json));
                message = "Zoo opened. " + RouteProblem;
            } catch (Exception error) {
                message = "Could not open Zoo. " + error.Message;
            }
            RefreshStatus();
        }
        // Single browser receiver: reject unknown commands and invalid arguments before
        // touching the document. OpenFile installs only after validation succeeds.
        public void BrowserCommand(string json) {
            try {
                var command = JsonUtility.FromJson<BrowserCommandData>(json);
                if (command == null || document == null) return;
                switch (command.type) {
                    case "tool":
                        if (command.value == "Inspect" || command.value == "Floor" || command.value == "Gate" || command.value == "Delete") SetTool(command.value);
                        break;
                    case "level":
                        if (int.TryParse(command.value, out int level)) {
                            int index = Array.IndexOf(Levels, level);
                            if (index >= 0) SetLevel(index);
                        }
                        break;
                    case "run": ToggleRun(); break;
                    case "speed":
                        if (int.TryParse(command.value,out int rate) && (rate == 1 || rate == 4 || rate == 16 || rate == 64)) { speed=rate; RefreshStatus(); }
                        break;
                    case "documentReceived":
                        if (int.TryParse(command.value,out int received) && received == revision) {
                            acknowledgedRevision=received;
                            documentOpenPending=false;
                        }
                        break;
                    case "resetView": ResetView(); break;
                    case "focusService": FocusService(); break;
                    case "focusApproach": FocusApproach(); break;
                    case "focusTrainDoors": FocusTrainDoors(); break;
                    case "save": ZooPlayableDownload(document.Write(DateTimeOffset.UtcNow)); break;
                    case "open": OpenFile(command.value); break;
                }
            } catch (Exception error) {
                message = "Invalid browser command: " + error.Message;
                RefreshStatus();
            }
        }
        void RefreshStatus() {
            if (!status || document == null) return;
            status.text = $"{tool}  |  {message}  |  Queue {queued}  /  Boarded {boarded}";
            runLabel.text = running ? "Pause" : "Run";
            levelLabel.text = $"Level {Level} m";
            Publish();
        }
        Vector2 ScreenPoint(Vector3Int slot) {
            var point = cameraView.WorldToViewportPoint(World(slot, 1));
            return new Vector2(point.x, 1 - point.y);
        }
        void Publish() {
            if (document == null) return;
            var unresolved = geometry == null ? Array.Empty<string>()
                : geometry.Unresolved.Select(pair => pair.Key + " x" + pair.Value).ToArray();
            // Resend an unacknowledged open at most every two seconds rather than on
            // every camera publish (a pan publishes dozens of states per second).
            bool sendDocument = documentOpenPending && acknowledgedRevision != revision && Time.unscaledTime >= nextDocumentSend;
            if (sendDocument) nextDocumentSend = Time.unscaledTime + 2f;
            ZooPlayableState(JsonUtility.ToJson(new BrowserState {
                cells = document.CellCount, modules = document.ModuleCount, lines = document.LineCount, revision = revision, speed = speed,
                routeWaypoints = activePath?.Length ?? 0, tick = ticks, simTime = ticks,
                document = sendDocument ? documentSnapshot : null,
                missingFloor = missingFloor,
                level = Level, queued = queued, boarded = boarded, floor = floor, gate = gate,
                connected = Connected, running = running, doorsOpen = doorsOpen,
                doorMovement = trainDoors != null ? trainDoors.Movement : 0f,
                prefabViews = geometry?.PrefabViews ?? 0, liveViews = geometry?.LiveViews ?? 0,
                generatedViews = geometry?.GeneratedViews ?? 0, batchedViews = geometry?.BatchedViews ?? 0,
                fallbackViews = geometry?.FallbackViews ?? 0,
                unresolvedViews = geometry?.UnresolvedViews ?? 0,
                visualKeys = geometry?.VisualKeys.ToArray() ?? Array.Empty<string>(),
                unresolved = unresolved,
                formation = TrainFormations.Select(line.stock, line.cars, line.power, trainCatalogue),
                trainDoorSide = trainDoors != null && trainDoors.PlatformBank > 0 ? "plus" : "minus",
                trainScale = trainEntry != null ? trainEntry.bakedScale : 0f,
                passengerHeight = passengerPrefab ? 1.7f : 0f,
                tool = tool, message = message, yaw = yaw, zoom = zoom, targetX = target.x, targetY = target.z,
                floorPoint = ScreenPoint(floorSlot), gatePoint = ScreenPoint(gateSlot),
                alternatePoint = ScreenPoint(new Vector3Int(67,27,-15)), connectorPoint = ScreenPoint(new Vector3Int(73,35,-15))
            }));
        }
        void OnDestroy() {
            geometry?.Dispose();
            materials?.Dispose();
            Destroy(floorMaterial);
            Destroy(cursorMaterial);
            foreach (var passenger in passengers) passenger.view?.Dispose();
        }
    }
}
