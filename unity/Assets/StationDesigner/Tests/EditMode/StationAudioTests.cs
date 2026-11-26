using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Metro.Tests {
    /// <summary>
    /// C# parity suite for edit-gesture audio cues (<c>StationEditAudioOutcome</c>) and
    /// host ambience publishing (<see cref="StationGameHost"/> <c>LateUpdate</c> / <c>PublishAudio</c>),
    /// closing the C# side of <c>game/test/audio.test.mjs</c> and <c>tools/check-game-audio.mjs</c>.
    /// </summary>
    public sealed class StationAudioTests {
        static readonly Type OutcomeType =
            typeof(StationCommandRouter).Assembly.GetType("Metro.App.StationEditAudioOutcome", throwOnError: true);
        static readonly ConstructorInfo OutcomeCtor =
            OutcomeType.GetConstructor(new[] { typeof(string), typeof(JObject) });
        static readonly MethodInfo OutcomeCue =
            OutcomeType.GetMethod("Cue", new[] { typeof(bool), typeof(bool), typeof(string) });
        static readonly MethodInfo HostAwake =
            typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
        static readonly MethodInfo HostLateUpdate =
            typeof(StationGameHost).GetMethod("LateUpdate", BindingFlags.Instance | BindingFlags.NonPublic);
        static readonly MethodInfo HostPublishAudio =
            typeof(StationGameHost).GetMethod("PublishAudio", BindingFlags.Instance | BindingFlags.NonPublic);
        static readonly FieldInfo HostNextAudioFrame =
            typeof(StationGameHost).GetField("nextAudioFrame", BindingFlags.Instance | BindingFlags.NonPublic);

        [SetUp]
        public void SetUp() {
            StationEditSession.Reset();
            StationToolSelection.Reset();
        }

        [TearDown]
        public void TearDown() {
            StationEditSession.Reset();
            StationToolSelection.Reset();
        }

        static object CaptureOutcome(string commandType, JObject payload = null) =>
            OutcomeCtor.Invoke(new object[] { commandType, payload ?? new JObject() });

        static string EvaluateCue(object outcome, bool accepted, bool committed, string rejectCode = null) =>
            (string)OutcomeCue.Invoke(outcome, new object[] { accepted, committed, rejectCode });

        static void SelectTool(string tool) {
            Assert.IsTrue(StationToolSelection.TrySelect(tool, out _, out var code), $"select tool {tool}: {code}");
        }

        static StationModuleRecord DummyModule(string id, string type = "bench") {
            var json = $"{{\"format\":\"metro-save\",\"formatVersion\":1,\"gameVersion\":\"0.2.0\",\"savedAt\":\"2026-01-01T00:00:00.000Z\",\"name\":\"audio-dummy\",\"city\":\"guangzhou\",\"seed\":1,\"levelBase\":0,\"storeyHeight\":5,\"static\":{{\"cells\":[],\"modules\":[{{\"id\":\"{id}\",\"type\":\"{type}\",\"x\":0,\"y\":0,\"z\":0,\"rot\":0,\"w\":1,\"d\":1}}],\"lines\":[]}}}}";
            return StationDocumentReader.Read(json, new StationSource("audio-dummy", "")).Document.Modules[0];
        }

        /* --------------------------------------------- StationEditAudioOutcome matrix */

        [Test]
        public void EditAudioOutcomeMapsCommittedPlaceMoveAndDeleteCues() {
            SelectTool("block");
            var placeUp = CaptureOutcome("pointer.up", new JObject { ["button"] = 0 });
            Assert.AreEqual("place", EvaluateCue(placeUp, accepted: true, committed: true),
                "primary pointer.up commit on block tool plays place");

            SelectTool("module");
            var placeDown = CaptureOutcome("pointer.down", new JObject { ["button"] = 0 });
            Assert.AreEqual("place", EvaluateCue(placeDown, accepted: true, committed: true),
                "primary pointer.down commit on module tool plays place");

            // Move confirm command always plays move on commit.
            SelectTool("move");
            var moveConfirm = CaptureOutcome("edit.move.confirm");
            Assert.AreEqual("move", EvaluateCue(moveConfirm, accepted: true, committed: true),
                "edit.move.confirm commit plays move");

            // Carried placement via pointer while move tool is active plays move.
            StationEditSession.SetCarried(DummyModule("bench-1"));
            var carriedPlace = CaptureOutcome("pointer.up", new JObject { ["button"] = 0 });
            StationEditSession.SetCarried(null);
            Assert.AreEqual("move", EvaluateCue(carriedPlace, accepted: true, committed: true),
                "pointer commit while carrying a module on move tool plays move");

            // Carried placement on non-move tool (e.g. module) falls through to place.
            SelectTool("module");
            StationEditSession.SetCarried(DummyModule("bench-1"));
            var nonMoveCarried = CaptureOutcome("pointer.up", new JObject { ["button"] = 0 });
            StationEditSession.SetCarried(null);
            Assert.AreEqual("place", EvaluateCue(nonMoveCarried, accepted: true, committed: true),
                "pointer commit outside move tool plays place");

            // Explicit delete command, delete tool, secondary button, and pointer.rightTap all play delete.
            SelectTool("select");
            Assert.AreEqual("delete", EvaluateCue(CaptureOutcome("edit.delete"), accepted: true, committed: true),
                "edit.delete commit plays delete");

            SelectTool("delete");
            Assert.AreEqual("delete", EvaluateCue(CaptureOutcome("pointer.up", new JObject { ["button"] = 0 }), accepted: true, committed: true),
                "primary commit on delete tool plays delete");

            SelectTool("block");
            Assert.AreEqual("delete", EvaluateCue(CaptureOutcome("pointer.up", new JObject { ["button"] = 2 }), accepted: true, committed: true),
                "secondary mouse button (button=2) commit plays delete");
            Assert.AreEqual("delete", EvaluateCue(CaptureOutcome("pointer.rightTap"), accepted: true, committed: true),
                "pointer.rightTap commit plays delete");
        }

        [Test]
        public void EditAudioOutcomeMapsPickAndSelectCuesWithoutDuplicateSound() {
            // 1. Carried pickup (!carried -> HasCarried).
            SelectTool("move");
            var startMove = CaptureOutcome("edit.move.start");
            StationEditSession.SetCarried(DummyModule("gate-1", "gate"));
            Assert.AreEqual("pick", EvaluateCue(startMove, accepted: true, committed: false),
                "picking up a module into carried state plays pick");
            StationEditSession.SetCarried(null);

            // 2. Eyedropper Picked with non-empty moduleId.
            SelectTool("pick");
            var eyedropModule = CaptureOutcome("pointer.up", new JObject { ["button"] = 0 });
            StationEditSession.Picked = new JObject { ["moduleId"] = "tvm-2", ["type"] = "tvm" };
            Assert.AreEqual("pick", EvaluateCue(eyedropModule, accepted: true, committed: false),
                "eyedropper setting Picked with moduleId plays pick");

            // Same Picked object reference on a later click must stay silent.
            var samePicked = CaptureOutcome("pointer.up", new JObject { ["button"] = 0 });
            Assert.IsNull(EvaluateCue(samePicked, accepted: true, committed: false),
                "unchanged Picked reference stays silent");

            // Picked with empty moduleId must stay silent.
            var emptyPicked = CaptureOutcome("pointer.up", new JObject { ["button"] = 0 });
            StationEditSession.Picked = new JObject { ["moduleId"] = "" };
            Assert.IsNull(EvaluateCue(emptyPicked, accepted: true, committed: false),
                "Picked with empty moduleId stays silent");

            // Eyedropper Picked with block/wall face finish plays pick.
            var eyedropFace = CaptureOutcome("pointer.down", new JObject { ["button"] = 0 });
            StationEditSession.Picked = new JObject {
                ["seq"] = 1, ["kind"] = "face", ["moduleId"] = "", ["finish"] = "wall.enamel#ff4242", ["armable"] = true,
            };
            StationEditSession.SelectCell(new StationCellKey(2, 1, 1));
            Assert.AreEqual("pick", EvaluateCue(eyedropFace, accepted: true, committed: false),
                "eyedropper lifting a block/wall face finish plays pick");

            // Non-armable module pick (e.g. derived platform-edge) plays select instead of pick.
            var nonArmablePick = CaptureOutcome("pointer.down", new JObject { ["button"] = 0 });
            StationEditSession.Picked = new JObject {
                ["seq"] = 2, ["kind"] = "module", ["moduleId"] = "pe-1", ["type"] = "platform-edge", ["armable"] = false,
            };
            StationEditSession.SelectModule(DummyModule("pe-1", "platform-edge"));
            Assert.AreEqual("select", EvaluateCue(nonArmablePick, accepted: true, committed: false),
                "non-armable module pick falls through to select cue");

            // Empty target pick stays silent.
            var nonePick = CaptureOutcome("pointer.down", new JObject { ["button"] = 0 });
            StationEditSession.Picked = new JObject {
                ["seq"] = 3, ["kind"] = "none", ["moduleId"] = "", ["finish"] = "", ["armable"] = false,
            };
            Assert.IsNull(EvaluateCue(nonePick, accepted: true, committed: false),
                "empty target pick stays silent");

            // 3. PaintPick eyedropper.
            SelectTool("paint");
            var eyedropPaint = CaptureOutcome("pointer.up", new JObject { ["button"] = 0 });
            StationEditSession.PaintPick = new JObject { ["finish"] = "floor.granite" };
            Assert.AreEqual("pick", EvaluateCue(eyedropPaint, accepted: true, committed: false),
                "paint eyedropper setting PaintPick plays pick");

            // 4. Selection change plays select; repeating identical selection stays silent.
            SelectTool("select");
            var selectCmd = CaptureOutcome("edit.select");
            StationEditSession.SelectCell(new StationCellKey(1, 2, -5));
            Assert.AreEqual("select", EvaluateCue(selectCmd, accepted: true, committed: false),
                "changing selection via edit.select plays select");

            var sameSelect = CaptureOutcome("edit.select");
            Assert.IsNull(EvaluateCue(sameSelect, accepted: true, committed: false),
                "re-selecting the same cell stays silent");

            var selectPointer = CaptureOutcome("pointer.up", new JObject { ["button"] = 0 });
            StationEditSession.SelectModule(DummyModule("bench-9"));
            Assert.AreEqual("select", EvaluateCue(selectPointer, accepted: true, committed: false),
                "switching selection from cell to module via pointer.up plays select");

            var clearSelect = CaptureOutcome("edit.select");
            StationEditSession.ClearSelection();
            Assert.IsNull(EvaluateCue(clearSelect, accepted: true, committed: false),
                "clearing selection to empty stays silent");
        }

        [Test]
        public void EditAudioOutcomeMapsRefusalsIncludingRepeatedIdenticalBlockedNotice() {
            SelectTool("block");
            var firstAttempt = CaptureOutcome("pointer.up", new JObject { ["button"] = 0 });
            StationEditSession.PublishNotice("blocked", "cell-occupied", "Cell is occupied.", "block");
            Assert.AreEqual("refused", EvaluateCue(firstAttempt, accepted: true, committed: false),
                "first blocked notice on pointer attempt plays refused");

            // Repeated identical refusal: PublishNotice allocates a fresh JObject so reference
            // inequality detects a new attempt even when code/reason/tool are unchanged.
            var secondAttempt = CaptureOutcome("pointer.up", new JObject { ["button"] = 0 });
            StationEditSession.PublishNotice("blocked", "cell-occupied", "Cell is occupied.", "block");
            Assert.AreEqual("refused", EvaluateCue(secondAttempt, accepted: true, committed: false),
                "repeated identical blocked refusal must still play refused");

            // Unchanged notice (no PublishNotice call during handling) stays silent.
            var staleBlocked = CaptureOutcome("pointer.up", new JObject { ["button"] = 0 });
            Assert.IsNull(EvaluateCue(staleBlocked, accepted: true, committed: false),
                "unchanged blocked notice stays silent");

            // Blocked notices on pick and select tools stay silent.
            foreach (var passiveTool in new[] { "pick", "select" }) {
                SelectTool(passiveTool);
                var passiveOutcome = CaptureOutcome("pointer.up", new JObject { ["button"] = 0 });
                StationEditSession.PublishNotice("blocked", "nothing-there", "Nothing to pick.", passiveTool);
                Assert.IsNull(EvaluateCue(passiveOutcome, accepted: true, committed: false),
                    $"blocked notice on {passiveTool} tool must stay silent");
            }

            // Rejected edit.move.start, edit.move.confirm, and edit.delete with rejectCode play refused.
            SelectTool("move");
            Assert.AreEqual("refused", EvaluateCue(CaptureOutcome("edit.move.start"), accepted: false, committed: false, rejectCode: "not-found"));
            Assert.AreEqual("refused", EvaluateCue(CaptureOutcome("edit.move.confirm"), accepted: false, committed: false, rejectCode: "blocked"));
            Assert.AreEqual("refused", EvaluateCue(CaptureOutcome("edit.delete"), accepted: false, committed: false, rejectCode: "locked"));
            Assert.IsNull(EvaluateCue(CaptureOutcome("edit.delete"), accepted: false, committed: false, rejectCode: ""),
                "rejected delete without rejectCode stays silent");
        }

        [Test]
        public void EditAudioOutcomeIsSilentForHoverCancelNoOpStaleAndNonEditCommands() {
            SelectTool("block");

            // Hover, cancel, leave, and non-edit commands are always silent even if state/notices change.
            foreach (var silentCommand in new[] {
                "pointer.move", "pointer.cancel", "pointer.leave", "edit.cancel",
                "camera.orbit", "view.set", "tool.set", "sim.play", "station.save",
            }) {
                var outcome = CaptureOutcome(silentCommand, new JObject { ["button"] = 0 });
                StationEditSession.PublishNotice("blocked", "blocked", "Blocked", "block");
                Assert.IsNull(EvaluateCue(outcome, accepted: true, committed: true),
                    $"{silentCommand} must remain silent even if committed");
                Assert.IsNull(EvaluateCue(outcome, accepted: false, committed: false, rejectCode: "err"),
                    $"{silentCommand} must remain silent even if rejected");
            }

            // no-op and stale notices stay silent on pointer attempts.
            foreach (var nonBlockedKind in new[] { "no-op", "stale" }) {
                var outcome = CaptureOutcome("pointer.up", new JObject { ["button"] = 0 });
                StationEditSession.PublishNotice(nonBlockedKind, "unchanged", "No change", "block");
                Assert.IsNull(EvaluateCue(outcome, accepted: true, committed: false),
                    $"{nonBlockedKind} notice must stay silent");
            }
        }

        /* ---------------------------------------- StationGameHost ambience publishing */

        sealed class AudioHostFixture : IDisposable {
            public readonly GameObject CameraGo;
            public readonly Camera Camera;
            public readonly GameObject HostGo;
            public readonly StationGameHost Host;
            public readonly StationViewRig Rig;
            public readonly StationExplodedView Exploded;
            public readonly List<JObject> AudioMessages = new List<JObject>();
            readonly StationGameHost prevFeatureHost;
            readonly StationViewRig prevFeatureRig;
            readonly StationExplodedView prevFeatureExploded;

            static readonly FieldInfo FeatureHostField = typeof(StationViewFeature).GetField("host", BindingFlags.Static | BindingFlags.NonPublic);
            static readonly FieldInfo FeatureRigField = typeof(StationViewFeature).GetField("rig", BindingFlags.Static | BindingFlags.NonPublic);
            static readonly FieldInfo FeatureExplodedField = typeof(StationViewFeature).GetField("explodedView", BindingFlags.Static | BindingFlags.NonPublic);

            public AudioHostFixture() {
                prevFeatureHost = (StationGameHost)FeatureHostField.GetValue(null);
                prevFeatureRig = (StationViewRig)FeatureRigField.GetValue(null);
                prevFeatureExploded = (StationExplodedView)FeatureExplodedField.GetValue(null);
                CameraGo = new GameObject("AudioTestCamera");
                Camera = CameraGo.AddComponent<Camera>();
                Camera.orthographic = false;
                Camera.fieldOfView = 45f;
                Camera.transform.SetPositionAndRotation(
                    StationCoordinates.Point(new Vector3(12f, -6f, 8f)),
                    Quaternion.LookRotation(Vector3.forward, Vector3.up));

                HostGo = new GameObject("AudioTestHost");
                Host = HostGo.AddComponent<StationGameHost>();
                Host.stationCamera = Camera;
                Host.frameCameraOnCommit = false;
                Host.catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
                Host.trainCatalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
                Host.stationShader = StationFinishLibrary.FindShader();
                Host.font = AssetDatabase.LoadAssetAtPath<Font>("Assets/StationDesigner/Fonts/NotoSansSC-Regular.ttf");

                HostAwake.Invoke(Host, null);
                Host.RegisterRenderer(new StationCellRenderer());
                Host.RegisterRenderer(new StationRoadRenderer());
                Host.RegisterRenderer(new TrainConsistRenderer());
                Host.RegisterRenderer(new PassengerCrowdRenderer());
                Rig = StationViewFeature.Attach(Host);
                Exploded = StationViewFeature.ActiveExploded;

                Host.ReplyPublished += raw => {
                    if (string.IsNullOrEmpty(raw)) return;
                    var msg = JObject.Parse(raw);
                    if ((string)msg["kind"] == "audio") AudioMessages.Add(msg);
                };

                var zooPath = Path.Combine(Application.dataPath, "StationDesigner/Demos/zoo.metro.json");
                Assert.IsTrue(File.Exists(zooPath), "Missing Zoo demo at " + zooPath);
                var opened = Host.OpenDocument(File.ReadAllText(zooPath), "zoo");
                Assert.IsTrue(opened.Accepted, opened.ToString());
            }

            public StationSimulationSession Session => (Host.Simulation as StationSimulationHost)?.Session;

            public void ResetCadence() => HostNextAudioFrame.SetValue(Host, 0.0);
            public double NextAudioFrame => (double)HostNextAudioFrame.GetValue(Host);

            public JObject InvokeLateUpdateAndPop() {
                int before = AudioMessages.Count;
                HostLateUpdate.Invoke(Host, null);
                return AudioMessages.Count > before ? AudioMessages[AudioMessages.Count - 1] : null;
            }

            public void Dispose() {
                if (Exploded != null && Exploded.IsOpen) Exploded.Close();
                if (HostGo != null) Object.DestroyImmediate(HostGo);
                if (CameraGo != null) Object.DestroyImmediate(CameraGo);
                FeatureHostField.SetValue(null, prevFeatureHost);
                FeatureRigField.SetValue(null, prevFeatureRig);
                FeatureExplodedField.SetValue(null, prevFeatureExploded);
            }
        }

        [Test]
        public void PublishAudioAndLateUpdateAreSessionScopedAndThrottleBySpeed() {
            using var fx = new AudioHostFixture();

            // Without a registered client session, both PublishAudio and LateUpdate emit nothing.
            HostPublishAudio.Invoke(fx.Host, new object[] { new JObject { ["cue"] = "place" } });
            Assert.AreEqual(0, fx.AudioMessages.Count, "PublishAudio must drop messages without a session");
            Assert.IsNull(fx.InvokeLateUpdateAndPop(), "LateUpdate must drop ambience without a session");

            // Registering a session scopes all audio replies to that sessionId.
            fx.Host.NoteClientSession("sess-audio-42");
            HostPublishAudio.Invoke(fx.Host, new object[] { new JObject { ["cue"] = "place" } });
            Assert.AreEqual(1, fx.AudioMessages.Count);
            Assert.AreEqual(StationCommandRouter.SchemaVersion, (int)fx.AudioMessages[0]["schemaVersion"]);
            Assert.AreEqual("audio", (string)fx.AudioMessages[0]["kind"]);
            Assert.AreEqual("sess-audio-42", (string)fx.AudioMessages[0]["sessionId"]);
            Assert.AreEqual("place", (string)fx.AudioMessages[0]["payload"]["cue"]);

            // Playing at 1x speed throttles at 0.1 s.
            var session = fx.Session;
            Assert.IsNotNull(session);
            session.SetPlaying(true);
            session.SetSpeed(1);
            fx.ResetCadence();
            double before1x = Time.unscaledTimeAsDouble;
            var msg1x = fx.InvokeLateUpdateAndPop();
            Assert.IsNotNull(msg1x, "first ambience frame publishes immediately");
            double delta1x = fx.NextAudioFrame - before1x;
            Assert.That(delta1x, Is.InRange(0.08, 0.15), "1x playing cadence schedules ~0.1 s ahead");
            Assert.AreEqual(1, (int)msg1x["payload"]["speed"]);

            // Calling LateUpdate again before nextAudioFrame is throttled (no message emitted).
            Assert.IsNull(fx.InvokeLateUpdateAndPop(), "immediate back-to-back LateUpdate is throttled");

            // Playing at >1x speed throttles at 1/30 s (~0.0333 s).
            session.SetSpeed(4);
            fx.ResetCadence();
            double before4x = Time.unscaledTimeAsDouble;
            var msg4x = fx.InvokeLateUpdateAndPop();
            Assert.IsNotNull(msg4x);
            double delta4x = fx.NextAudioFrame - before4x;
            Assert.That(delta4x, Is.InRange(1.0 / 35.0, 0.06), "Playing && Speed > 1 schedules ~1/30 s ahead");
            Assert.AreEqual(4, (int)msg4x["payload"]["speed"]);

            // Paused at speed > 1 reverts to 0.1 s cadence.
            session.SetPlaying(false);
            fx.ResetCadence();
            double beforePaused = Time.unscaledTimeAsDouble;
            var msgPaused = fx.InvokeLateUpdateAndPop();
            Assert.IsNotNull(msgPaused);
            double deltaPaused = fx.NextAudioFrame - beforePaused;
            Assert.That(deltaPaused, Is.InRange(0.08, 0.15), "paused cadence stays at 0.1 s even when Speed > 1");
        }

        [Test]
        public void LiveAmbiencePublishesCameraBasisStridedPassengersNearestTrainAndTraffic() {
            using var fx = new AudioHostFixture();
            fx.Host.NoteClientSession("sess-live");
            var session = fx.Session;
            session.SetPlaying(true);
            session.SetSpeed(1);

            // Position edit camera explicitly and confirm document position/right mapping.
            var camDocPos = new Vector3(10f, 5f, -5f);
            fx.Camera.transform.SetPositionAndRotation(
                StationCoordinates.Point(camDocPos),
                Quaternion.LookRotation(Vector3.forward, Vector3.up));
            var expectedRight = StationCoordinates.WorldToDocumentDirection(fx.Camera.transform.right);

            // Inject 600 passenger frames (599 visible + 1 hidden) into the session's cached frame array
            // to verify stride <= 256 samples, sampleWeight == Ceil(600 / 256) == 3, and hidden skipping.
            var services = session.Services;
            var frameCacheField = typeof(StationServiceRuntime).GetField("frameCache", BindingFlags.Instance | BindingFlags.NonPublic);
            var frameCacheVerField = typeof(StationServiceRuntime).GetField("frameCacheVersion", BindingFlags.Instance | BindingFlags.NonPublic);
            var frameVerField = typeof(StationServiceRuntime).GetField("frameVersion", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(frameCacheField);
            var syntheticFrames = new StationPassengerFrame[600];
            for (int i = 0; i < syntheticFrames.Length; i++) {
                syntheticFrames[i] = new StationPassengerFrame {
                    SimId = i + 1,
                    X = i * 0.5,
                    Y = 2.0,
                    Z = -10.0,
                    Visible = i != 0, // index 0 is sampled by stride=3 but skipped because Visible==false
                };
            }
            frameCacheField.SetValue(services, syntheticFrames);
            frameCacheVerField.SetValue(services, frameVerField.GetValue(services));

            // Configure TrainConsistRenderer consists: 1 far moving, 1 near moving, 1 nearer parked, 1 nearer Phase.None.
            var consists = TrainConsistRenderer.Current?.Consists;
            Assert.IsNotNull(consists);
            Assert.GreaterOrEqual(consists.Count, 2, "Zoo must build at least 2 consists");

            for (int i = 0; i < consists.Count; i++) {
                consists[i].Root.SetActive(false);
                consists[i].Phase = TrainPhase.None;
            }
            // Place consist[0] closer (at 14, 5, -5) and consist[1] farther (at 40, 5, -5).
            consists[0].Root.transform.position = StationCoordinates.Point(new Vector3(14f, 5f, -5f));
            consists[0].Root.SetActive(true);
            consists[0].Phase = TrainPhase.Approach;

            consists[1].Root.transform.position = StationCoordinates.Point(new Vector3(40f, 5f, -5f));
            consists[1].Root.SetActive(true);
            consists[1].Phase = TrainPhase.Dwell;

            // Populate RoadVehicleViews poses directly to verify exact nearest traffic selection.
            var vehicles = StationRoadRenderer.Current?.Vehicles;
            Assert.IsNotNull(vehicles, "Zoo builds StationRoadRenderer vehicles");
            var posesField = typeof(RoadVehicleViews).GetField("poses", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(posesField);
            var vehiclePoses = (List<RoadVehiclePose>)posesField.GetValue(vehicles);
            vehiclePoses.Clear();
            vehiclePoses.Add(new RoadVehiclePose { Id = 1, X = 80, Y = 5, Z = 0 });
            vehiclePoses.Add(new RoadVehiclePose { Id = 2, X = 12, Y = 6, Z = 0 }); // nearest
            vehiclePoses.Add(new RoadVehiclePose { Id = 3, X = -50, Y = -20, Z = 0 });

            fx.ResetCadence();
            var reply = fx.InvokeLateUpdateAndPop();
            Assert.IsNotNull(reply);
            var payload = (JObject)reply["payload"];

            // Camera position & right.
            var posArr = (JArray)payload["position"];
            Assert.AreEqual(camDocPos.x, (float)posArr[0], 1e-3f);
            Assert.AreEqual(camDocPos.y, (float)posArr[1], 1e-3f);
            Assert.AreEqual(camDocPos.z, (float)posArr[2], 1e-3f);
            var rightArr = (JArray)payload["right"];
            Assert.AreEqual(expectedRight.x, (float)rightArr[0], 1e-3f);
            Assert.AreEqual(expectedRight.y, (float)rightArr[1], 1e-3f);
            Assert.AreEqual(expectedRight.z, (float)rightArr[2], 1e-3f);

            // Strided passengers: Ceil(600 / 256) = 3; 200 strided indices minus hidden index 0 = 199 samples.
            Assert.AreEqual(3, (int)payload["sampleWeight"], "600 passengers stride by 3");
            var samples = (JArray)payload["passengers"];
            Assert.AreEqual(199 * 3, samples.Count, "sampled visible passengers (<= 256) emit 3 floats each");
            Assert.LessOrEqual(samples.Count, 256 * 3);

            // Nearest moving train & nearest traffic vehicle.
            var sources = (JArray)payload["sources"];
            var trainSrc = sources.Cast<JObject>().Single(s => (string)s["kind"] == "train");
            Assert.AreEqual(0.65, (double)trainSrc["level"], 1e-6);
            Assert.AreEqual(14f, (float)trainSrc["position"][0], 1e-3f, "nearest active moving train wins");

            var trafficSrc = sources.Cast<JObject>().Single(s => (string)s["kind"] == "traffic");
            Assert.AreEqual(0.4, (double)trafficSrc["level"], 1e-6);
            Assert.AreEqual(12f, (float)trafficSrc["position"][0], 1e-3f, "nearest road vehicle wins");
            Assert.AreEqual(6f, (float)trafficSrc["position"][1], 1e-3f);

            // Setting nearer train to TrainPhase.None skips it so farther active train wins.
            consists[0].Phase = TrainPhase.None;
            fx.ResetCadence();
            var afterNone = (JObject)fx.InvokeLateUpdateAndPop()["payload"];
            var trainAfterNone = ((JArray)afterNone["sources"]).Cast<JObject>().Single(s => (string)s["kind"] == "train");
            Assert.AreEqual(40f, (float)trainAfterNone["position"][0], 1e-3f, "TrainPhase.None train is skipped");

            // Deactivating (parking) nearer train skips it even with a moving phase.
            consists[0].Phase = TrainPhase.Approach;
            consists[0].Root.SetActive(false);
            fx.ResetCadence();
            var afterParked = (JObject)fx.InvokeLateUpdateAndPop()["payload"];
            var trainAfterParked = ((JArray)afterParked["sources"]).Cast<JObject>().Single(s => (string)s["kind"] == "train");
            Assert.AreEqual(40f, (float)trainAfterParked["position"][0], 1e-3f, "parked (inactive) train is skipped");

            // Pausing the simulation skips ALL train audio sources.
            session.SetPlaying(false);
            fx.ResetCadence();
            var whilePaused = (JObject)fx.InvokeLateUpdateAndPop()["payload"];
            Assert.IsFalse(((JArray)whilePaused["sources"]).Cast<JObject>().Any(s => (string)s["kind"] == "train"),
                "paused session emits no train audio source");
        }

        [Test]
        public void ExplodedViewSwitchesAmbienceCameraPassengersAndTrainsAndSuppressesStreetTraffic() {
            using var fx = new AudioHostFixture();
            fx.Host.NoteClientSession("sess-exploded");
            var session = fx.Session;
            session.SetPlaying(true);

            // Add a live street vehicle so we can prove exploded mode omits street traffic.
            var vehicles = StationRoadRenderer.Current?.Vehicles;
            var posesField = typeof(RoadVehicleViews).GetField("poses", BindingFlags.Instance | BindingFlags.NonPublic);
            var vehiclePoses = (List<RoadVehiclePose>)posesField.GetValue(vehicles);
            vehiclePoses.Clear();
            vehiclePoses.Add(new RoadVehiclePose { Id = 9, X = 11, Y = 4, Z = 0 });

            // Open standalone exploded view.
            Assert.IsTrue(fx.Exploded.Open("blueprint", 1280, 720, out var err), err);
            Assert.IsNotNull(fx.Exploded.ViewerCamera);
            Assert.IsNotNull(fx.Exploded.Builder);

            // Put exploded viewer camera at a distinct location from the editor camera.
            var explodedCamDoc = new Vector3(120f, 80f, 45f);
            fx.Exploded.ViewerCamera.transform.position = StationCoordinates.Point(explodedCamDoc);

            // Populate exploded tray presentedPassengers directly to verify exploded source switch.
            var presentedField = typeof(StationExplodedTrayBuilder).GetField("presentedPassengers",
                BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(presentedField);
            var presented = (List<PassengerPose>)presentedField.GetValue(fx.Exploded.Builder);
            presented.Clear();
            presented.Add(new PassengerPose { SimId = 77, X = 222.5, Y = 333.5, Z = -9.0, Visible = true });

            fx.ResetCadence();
            var explodedMsg = fx.InvokeLateUpdateAndPop();
            Assert.IsNotNull(explodedMsg);
            var payload = (JObject)explodedMsg["payload"];

            Assert.AreEqual(explodedCamDoc.x, (float)payload["position"][0], 1e-3f,
                "exploded ambience uses ViewerCamera position");
            Assert.AreEqual(explodedCamDoc.y, (float)payload["position"][1], 1e-3f);
            Assert.AreEqual(explodedCamDoc.z, (float)payload["position"][2], 1e-3f);

            var samples = (JArray)payload["passengers"];
            Assert.AreEqual(3, samples.Count);
            Assert.AreEqual(222.5, (double)samples[0], 1e-4, "exploded ambience samples tray PresentedPassengers");
            Assert.AreEqual(333.5, (double)samples[1], 1e-4);
            Assert.AreEqual(-9.0, (double)samples[2], 1e-4);
            Assert.IsFalse(((JArray)payload["sources"]).Cast<JObject>().Any(s => (string)s["kind"] == "traffic"),
                "exploded view omits live street traffic");

            // Closing exploded view switches back to the live edit camera and street traffic.
            fx.Exploded.Close();
            fx.Camera.transform.position = StationCoordinates.Point(new Vector3(5f, -3f, 7f));
            fx.ResetCadence();
            var liveMsg = fx.InvokeLateUpdateAndPop();
            Assert.IsNotNull(liveMsg);
            var livePayload = (JObject)liveMsg["payload"];
            Assert.AreEqual(5f, (float)livePayload["position"][0], 1e-3f, "closing exploded restores live camera");
            Assert.IsTrue(((JArray)livePayload["sources"]).Cast<JObject>().Any(s => (string)s["kind"] == "traffic"),
                "closing exploded restores live traffic ambience");
        }
    }
}
