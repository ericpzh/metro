using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using Metro.Feasibility;
using Metro.Persistence;
using Metro.Sim;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace Metro.App {
    public sealed class ZooPlayableView : MonoBehaviour {
        public TextAsset fixture, layout;
        public GameObject benchPrefab, binPrefab, trainPrefab;
        public AnimationClip platformDoors;
        public Shader stationShader;
        public Font font;

        [Serializable] sealed class Layout {
            public ZooGeometry.Footprint[] footprints;
            public GatePathSlice.Waypoint[] path;
            public int[] approach;
            public string exit, gate, platform;
        }
        [Serializable] sealed class BrowserState {
            public int cells, modules, lines, level, queued, boarded;
            public bool floor, gate, running, connected, doorsOpen;
            public string tool, message;
            public float yaw, zoom, targetX, targetY, doorMovement;
            public Vector2 floorPoint, gatePoint;
        }

        static readonly int[] Levels = { 0, -5, -10, -15, -20 };
        const int ServiceLevel = -15;
        const int GroupSize = 5;
        const float StepSeconds = .20f;
        StationSaveV1 document;
        Layout route;
        JObject authoredFloor, authoredGate;
        Dictionary<string, ZooGeometry.Footprint> footprints;
        Vector3Int floorSlot, gateSlot;
        ZooGeometry geometry;
        Mesh cube, personMesh;
        Material floorMaterial, gateMaterial, personMaterial, cursorMaterial;
        GameObject floorObject, gateObject, cursor, train, animatedTrain;
        readonly List<GameObject> editMarkers = new List<GameObject>();
        readonly List<(GatePathSlice sim, GameObject model, int delay)> passengers =
            new List<(GatePathSlice, GameObject, int)>();
        RectTransform panel;
        Text status, runLabel, levelLabel;
        int levelIndex, ticks, queued, boarded;
        bool floor, gate, running, doorsOpen;
        float elapsed, yaw, pitch, zoom;
        Vector3 target;
        string tool = "Inspect", message = "Entrance B to Line 5 down platform";
        bool dragging;
        Camera cameraView;
        Transform observedDoor;
        Vector3 closedDoorPosition;
        int doorOpenTick;

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void ZooPlayableDownload(string json);
        [DllImport("__Internal")] static extern void ZooPlayableOpen();
        [DllImport("__Internal")] static extern void ZooPlayableState(string json);
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
            authoredFloor = (JObject)authored.CopyCells().Single(c => At(c, floorSlot) && (string)c["fill"] == "solid");
            authoredGate = (JObject)authored.CopyModules().Single(m => (string)m["id"] == route.gate);
            gateSlot = new Vector3Int((int)authoredGate["x"], (int)authoredGate["y"], (int)authoredGate["z"]);

            cameraView = Camera.main;
            var primitive = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube = primitive.GetComponent<MeshFilter>().sharedMesh;
            primitive.SetActive(false);
            Destroy(primitive);
            personMesh = PlaceholderCrowdMesh.Create();
            floorMaterial = MakeMaterial(new Color(.96f, .76f, .36f));
            gateMaterial = MakeMaterial(new Color(.15f, .65f, .65f));
            personMaterial = MakeMaterial(new Color(.98f, .35f, .17f));
            cursorMaterial = MakeMaterial(new Color(.95f, .46f, .12f));
            floorObject = Model("Editable approach floor", cube, floorMaterial, World(floorSlot, .5f), Vector3.one);
            gateObject = Model(route.gate, cube, gateMaterial, World(gateSlot, 1.52f), new Vector3(.78f, 1.04f, .32f));
            gateObject.transform.rotation = Quaternion.Euler(0, (int)authoredGate["rot"] * 90, 0);
            cursor = Model("Placement preview", cube, cursorMaterial, Vector3.zero, new Vector3(.78f, .035f, .78f));
            cursor.SetActive(false);
            MarkSlot(floorSlot, floorMaterial);
            MarkSlot(gateSlot, gateMaterial);
            train = Instantiate(trainPrefab, transform);
            train.name = "Line 5 down train proxy";
            var board = route.path[route.path.Length - 1];
            train.transform.position = new Vector3((float)board.x, (float)board.z - .42f, -2.5f);
            var basis = train.transform.Find("Unity basis");
            if (basis && basis.childCount > 0) animatedTrain = basis.GetChild(0).gameObject;
            if (animatedTrain && !animatedTrain.GetComponent<Animator>()) animatedTrain.AddComponent<Animator>();
            observedDoor = animatedTrain.GetComponentsInChildren<Transform>().Single(node => node.name == "TypeADoor18");
            var otherLeaf = animatedTrain.GetComponentsInChildren<Transform>().Single(node => node.name == "TypeADoor19");
            platformDoors.SampleAnimation(animatedTrain, 0);
            closedDoorPosition = observedDoor.localPosition;
            train.transform.position += Vector3.right * ((float)board.x - (observedDoor.position.x + otherLeaf.position.x) / 2);
            BuildToolbar();
            Install(authored);
            ResetView();
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

        void Install(StationSaveV1 candidate) {
            var cells = candidate.CopyCells();
            var modules = candidate.CopyModules();
            if (!modules.Any(m => (string)m["id"] == route.exit && (string)m["type"] == "exit") ||
                !modules.Any(m => (string)m["id"] == route.platform && (string)m["type"] == "platform-edge") ||
                !modules.Any(m => (string)m["id"] == "track-5" && (string)m["type"] == "track"))
                throw new FormatException("Open an authored Zoo station save.");
            var savedGate = modules.FirstOrDefault(m => (string)m["id"] == route.gate);
            var savedFloor = cells.FirstOrDefault(c => At(c, floorSlot));
            if (savedGate != null && (!At(savedGate, gateSlot) || (string)savedGate["type"] != "gate" ||
                (int?)savedGate["rot"] != (int)authoredGate["rot"]))
                throw new FormatException("The Zoo service gate has moved.");
            var nextGeometry = new ZooGeometry(transform, stationShader, cube);
            try { nextGeometry.Build(cells, modules, footprints, benchPrefab, binPrefab, route.gate, floorSlot); }
            catch { nextGeometry.Dispose(); throw; }
            geometry?.Dispose();
            geometry = nextGeometry;
            document = candidate;
            floor = (string)savedFloor?["fill"] == "solid";
            gate = savedGate != null;
            ResetService();
            ShowLevel();
        }

        bool Connected => floor && gate;
        string RouteProblem => !floor ? "Blocked: replace the highlighted approach floor." :
            !gate ? "Blocked: place the fare gate at its marked position." : "Route connected.";

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
            gateObject.SetActive(gate && Level >= ServiceLevel);
            train.SetActive(Level == ServiceLevel);
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
            elapsed += Time.deltaTime;
            if (elapsed < StepSeconds) return;
            elapsed -= StepSeconds;
            StepService();
        }
        void HandlePointer() {
            var mouse = Mouse.current;
            if (mouse == null) return;
            var position = mouse.position.ReadValue();
            bool overToolbar = RectTransformUtility.RectangleContainsScreenPoint(panel, position);
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
            bool editFloor = slot == floorSlot && (tool == "Floor" ? !floor : tool == "Delete" && floor);
            bool editGate = slot == gateSlot && (tool == "Gate" ? !gate : tool == "Delete" && gate);
            if (!editFloor && !editGate) return;
            cursor.transform.position = World(slot, 1.045f);
            cursor.SetActive(true);
            if (!mouse.leftButton.wasPressedThisFrame) return;
            if (editFloor) {
                floor = tool == "Floor";
                document.SetCell(slot.x, slot.y, slot.z, floor ? authoredFloor : null);
            }
            if (editGate) {
                gate = tool == "Gate";
                document.SetModule(route.gate, gate ? authoredGate : null);
            }
            ResetService();
            message = RouteProblem;
            ShowLevel();
        }

        void ResetService() {
            foreach (var passenger in passengers) { passenger.model.SetActive(false); Destroy(passenger.model); }
            passengers.Clear();
            running = false;
            ticks = queued = boarded = doorOpenTick = 0;
            elapsed = 0;
            SampleDoors(false);
        }
        void ToggleRun() {
            if (!Connected) {
                message = RouteProblem;
            } else if (running) {
                running = false;
                message = "Service paused.";
            } else {
                if (passengers.Count == 0 || boarded == GroupSize) {
                    ResetService();
                    for (int i = 0; i < GroupSize; i++) {
                        var sim = new GatePathSlice(route.path, 2.0, 1);
                        var model = Model("Passenger " + (i + 1), personMesh, personMaterial,
                            new Vector3((float)sim.X, (float)sim.Z, (float)sim.Y), Vector3.one);
                        model.SetActive(false);
                        passengers.Add((sim, model, i * 2));
                    }
                }
                running = true;
                message = "Service running.";
            }
            RefreshStatus();
        }
        void StepService() {
            ticks++;
            bool admitted = false;
            queued = boarded = 0;
            foreach (var passenger in passengers) {
                var sim = passenger.sim;
                bool waitingAtTrain = sim.PathIndex == route.path.Length - 1 && ticks <= doorOpenTick + 2;
                if (ticks >= passenger.delay && !sim.Dead && !waitingAtTrain && (sim.QueueCount == 0 || !admitted)) {
                    admitted |= sim.QueueCount > 0;
                    sim.Step();
                }
                if (!doorsOpen && sim.PathIndex >= route.path.Length - 1) {
                    doorOpenTick = ticks;
                    SampleDoors(true);
                }
                passenger.model.transform.position = new Vector3((float)sim.X, (float)sim.Z, (float)sim.Y);
                RefreshPassenger(passenger);
                queued += sim.QueueCount;
                if (sim.Dead) boarded++;
            }
            if (boarded == GroupSize) {
                running = false;
                message = "All passengers boarded.";
            }
            RefreshStatus();
        }
        void RefreshPassenger((GatePathSlice sim, GameObject model, int delay) passenger) {
            passenger.model.SetActive(!passenger.sim.Dead && ticks >= passenger.delay && passenger.sim.Z <= Level + 1.1);
        }
        void SampleDoors(bool open) {
            if (animatedTrain && platformDoors && (doorsOpen != open || !open))
                platformDoors.SampleAnimation(animatedTrain, open ? platformDoors.length : 0);
            doorsOpen = open;
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
            ZooPlayableState(JsonUtility.ToJson(new BrowserState {
                cells = document.CellCount, modules = document.ModuleCount, lines = document.LineCount,
                level = Level, queued = queued, boarded = boarded, floor = floor, gate = gate,
                connected = Connected, running = running, doorsOpen = doorsOpen,
                doorMovement = Vector3.Distance(observedDoor.localPosition, closedDoorPosition),
                tool = tool, message = message, yaw = yaw, zoom = zoom, targetX = target.x, targetY = target.z,
                floorPoint = ScreenPoint(floorSlot), gatePoint = ScreenPoint(gateSlot)
            }));
        }
        void OnDestroy() {
            geometry?.Dispose();
            Destroy(personMesh);
            Destroy(floorMaterial);
            Destroy(gateMaterial);
            Destroy(personMaterial);
            Destroy(cursorMaterial);
        }
    }
}

