using System;
using System.Collections.Generic;
using System.Reflection;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 30 §2: the 删除 brush keeps the mode and the family it chose at the press for the
    /// whole gesture.
    ///
    /// The press on a drawn piece freezes a **module sweep** of that piece's normalized family
    /// on that piece's storey; the press on a block freezes a **rectangle dig**, which can
    /// never start collecting a module it happens to cross. The sweep grows with what the
    /// pointer visibly crossed between events (the reference's 6 px / 24 sample screen path),
    /// and an unrelated or missing hit never changes the mode, the family or the ids already
    /// collected. The release commits exactly the ids the preview showed, in one revision and
    /// one undo frame, with the dependent records a removed piece cannot leave behind.
    ///
    /// The cases drive the production router through a real camera, cell renderer and a test
    /// module renderer whose pieces register their drawn bounds, so the picks, the preview and
    /// the commit all read the same scene.
    /// </summary>
    public sealed class StationDeleteSweepTests {
        GameObject hostObject;
        GameObject cameraObject;
        StationGameHost host;
        StationViewRig rig;
        Camera camera;

        const int FloorZ = -5;

        [SetUp]
        public void SetUp() {
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            StationCellTool.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
            StationEditHost.ResetForTests();
            hostObject = new GameObject(StationGameHost.ObjectName);
            cameraObject = new GameObject("delete sweep camera");
            camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 12f;
            camera.nearClipPlane = 0.5f;
            camera.farClipPlane = 400f;
            host = hostObject.AddComponent<StationGameHost>();
            host.catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            host.trainCatalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            host.stationShader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            host.stationCamera = camera;
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
            awake.Invoke(host, null);
            host.Coordinator.RegisterRenderer(new StationCellRenderer());
            host.Coordinator.RegisterRenderer(new SweepModuleRenderer());
        }

        [TearDown]
        public void TearDown() {
            StationSectionDrag.Reset();
            StationEditHost.ResetForTests();
            if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
            if (hostObject != null) UnityEngine.Object.DestroyImmediate(hostObject);
            cameraObject = null;
            hostObject = null;
            host = null;
            rig = null;
            camera = null;
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            StationCellTool.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        // ------------------------------------------------------------------ fixture

        /// <summary>One drawn piece: a 1 m cube standing on its floor cell, drawn and registered.</summary>
        sealed class SweepModuleRenderer : IStationViewRenderer {
            Material material;

            public string Role => "modules";

            public void Build(StationViewBuildContext context) {
                var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
                material = new Material(shader) { name = "delete sweep test piece" };
                foreach (var module in context.Document.Modules) {
                    if (module == null) continue;
                    int w = Math.Max(1, module.Width), d = Math.Max(1, module.Depth);
                    const float height = 0.6f;
                    var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    go.name = module.Id;
                    var collider = go.GetComponent<Collider>();
                    if (collider != null) UnityEngine.Object.DestroyImmediate(collider);
                    go.transform.SetParent(context.RoleRoot(Role), false);
                    go.transform.position = StationCoordinates.Point(new Vector3(
                        module.X + w * 0.5f, module.Y + d * 0.5f, module.Z + 1f + height * 0.5f));
                    go.transform.localScale = new Vector3(w, height, d);
                    var renderer = go.GetComponent<MeshRenderer>();
                    if (renderer != null) renderer.sharedMaterial = material;
                    var bounds = new StationBox(module.X, module.Y, module.Z + 1,
                        module.X + w, module.Y + d, module.Z + 1 + height);
                    context.World.RegisterModule(Role, module.Id, go, "", bounds,
                        module.Z, module.Z, new[] { module.Z });
                }
            }

            public void Release() {
                if (material != null) UnityEngine.Object.DestroyImmediate(material);
                material = null;
            }
        }

        static JObject Module(string id, string type, int x, int y, int z, JObject cfg = null, int w = 1) {
            var record = new JObject {
                ["id"] = id, ["type"] = type, ["x"] = x, ["y"] = y, ["z"] = z, ["rot"] = 0,
            };
            if (w > 1) record["w"] = w;
            record["cfg"] = cfg ?? new JObject();
            return record;
        }

        static JArray Floor() {
            var cells = new JArray();
            for (int x = 0; x < 14; x++) {
                for (int y = 0; y < 14; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = FloorZ, ["fill"] = "solid" });
                }
            }
            return cells;
        }

        static string Envelope(JArray modules) => new JObject {
            ["format"] = StationDocumentReader.SaveFormat,
            ["formatVersion"] = StationDocumentReader.SupportedVersion,
            ["savedAt"] = StationDocumentReader.FixedSavedAt,
            ["name"] = "delete sweep fixture",
            ["city"] = "guangzhou",
            ["seed"] = 7,
            ["levelBase"] = 0,
            ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = Floor(), ["modules"] = modules ?? new JArray(), ["lines"] = new JArray(),
            },
        }.ToString(Newtonsoft.Json.Formatting.None);

        void Open(JArray modules) {
            var opened = host.OpenDocument(Envelope(modules), "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            rig = StationViewFeature.Attach(host);
            StationEditFeature.Attach(host);
            Assert.IsTrue(rig.Execute(new JObject {
                ["type"] = "camera.snap",
                ["payload"] = new JObject { ["face"] = "top", ["ortho"] = true },
            }.ToString(Newtonsoft.Json.Formatting.None), out var snapCode), snapCode);
            Assert.IsTrue(rig.Execute(new JObject {
                ["type"] = "camera.zoom",
                ["payload"] = new JObject { ["factor"] = 3 },
            }.ToString(Newtonsoft.Json.Formatting.None), out var zoomCode), zoomCode);
            rig.Tick(0f);
            SetLevel(FloorZ);
            Assert.IsTrue(StationToolSelection.TrySelect("delete", out _, out var toolCode), toolCode);
        }

        void SetLevel(int level) {
            Assert.IsTrue(rig.Execute(new JObject {
                ["type"] = "view.set",
                ["payload"] = new JObject { ["key"] = "level", ["value"] = level },
            }.ToString(Newtonsoft.Json.Formatting.None), out var code), code);
            rig.Tick(0f);
            host.SetActiveLevel(rig.Visibility.State.ActiveLevel);
        }

        // ------------------------------------------------------------------ helpers

        /// <summary>The pixel of one document point (its cell's top plane), in payload space.</summary>
        JObject Pointer(double docX, double docY, int button = 0, int buttons = 1, double? timeMs = null) {
            var world = StationCoordinates.Point(new Vector3((float)docX, (float)docY, FloorZ + 1f));
            var viewport = camera.WorldToViewportPoint(world);
            Assert.IsTrue(viewport.x > 0.02f && viewport.x < 0.98f && viewport.y > 0.02f && viewport.y < 0.98f,
                "the fixture aims through the rendered view: " + docX + "," + docY);
            var screen = camera.WorldToScreenPoint(world);
            var payload = new JObject {
                ["x"] = screen.x,
                ["y"] = Mathf.Max(1f, Screen.height) - screen.y,
                ["w"] = Mathf.Max(1f, Screen.width),
                ["h"] = Mathf.Max(1f, Screen.height),
                ["pointerId"] = 1,
                ["button"] = button,
                ["buttons"] = buttons,
                ["toolGeneration"] = StationToolSelection.Generation,
                ["documentRevision"] = host.CurrentRevision,
            };
            if (timeMs.HasValue) payload["time"] = timeMs.Value;
            return payload;
        }

        JObject Handle(string type, JObject payload) {
            var reply = new JObject();
            Assert.IsTrue(StationPointerRouter.Handle(host, type, payload, reply, out var code, out var reason),
                type + " " + payload + " -> " + code + " " + reason);
            return reply;
        }

        /// <summary>Press a piece, drag through the given document points, release at the last one.</summary>
        void Drag(params (double x, double y)[] points) {
            Assert.IsTrue(points.Length >= 2, "a drag needs a press and a release");
            Handle("pointer.down", Pointer(points[0].x, points[0].y, timeMs: 1000));
            for (int i = 1; i < points.Length; i++) {
                Handle("pointer.move", Pointer(points[i].x, points[i].y, button: -1, buttons: 1,
                    timeMs: 1200 + 100 * i));
            }
            var last = points[points.Length - 1];
            Handle("pointer.up", Pointer(last.x, last.y, timeMs: 1400 + 100 * points.Length));
        }

        static void AssertGone(StationGameHost host, params string[] ids) {
            foreach (var id in ids) {
                Assert.IsFalse(host.Index.TryGetModule(id, out _), "module " + id + " must be removed");
            }
        }

        static void AssertAlive(StationGameHost host, params string[] ids) {
            foreach (var id in ids) {
                Assert.IsTrue(host.Index.TryGetModule(id, out _), "module " + id + " must survive");
            }
        }

        // -------------------------------------------------------------------- cases

        /// <summary>
        /// A drag that stops on a block after crossing pieces keeps the pieces it crossed: the
        /// old straight document line from the anchor to the release cell turned away from the
        /// corner the pointer travelled, and could miss what it visibly passed over.
        /// </summary>
        [Test]
        public void ACornerPathCollectsEveryPieceItCrossed() {
            Open(new JArray(
                Module("bench-a", "bench", 1, 1, FloorZ, new JObject { ["variant"] = "steel-1" }),
                Module("bench-b", "bench", 1, 5, FloorZ, new JObject { ["variant"] = "steel-1" }),
                Module("bench-c", "bench", 5, 5, FloorZ, new JObject { ["variant"] = "steel-1" }),
                Module("bench-out", "bench", 9, 1, FloorZ, new JObject { ["variant"] = "steel-1" })));
            int revision = host.CurrentRevision;
            // Down on A, up the column to B, then across to C; the release lands on C.
            Drag((1.5, 1.5), (1.5, 5.5), (5.5, 5.5));
            AssertGone(host, "bench-a", "bench-b", "bench-c");
            AssertAlive(host, "bench-out");
            Assert.AreEqual(revision + 1, host.CurrentRevision, "the whole sweep is one revision");
            Assert.AreEqual(1, (int)StationEditSession.ToJson()["undoDepth"], "the whole sweep is one undo frame");
        }

        /// <summary>A sweep never shrinks: crossing a piece and dragging back keeps it.</summary>
        [Test]
        public void ASweepThatReturnsToItsFirstPieceKeepsWhatItCrossed() {
            Open(new JArray(
                Module("bench-a", "bench", 1, 1, FloorZ, new JObject { ["variant"] = "steel-1" }),
                Module("bench-b", "bench", 5, 1, FloorZ, new JObject { ["variant"] = "steel-1" })));
            Drag((1.5, 1.5), (5.5, 1.5), (1.5, 1.5));
            AssertGone(host, "bench-a", "bench-b");
        }

        /// <summary>
        /// The release landing on an unrelated piece (or on nothing) leaves the frozen mode, the
        /// family and the collected ids intact: it must not switch the delete into that piece.
        /// </summary>
        [Test]
        public void AReleaseOnAnUnrelatedPieceLeavesTheSweepIntact() {
            Open(new JArray(
                Module("bench-a", "bench", 1, 1, FloorZ, new JObject { ["variant"] = "steel-1" }),
                Module("bench-b", "bench", 5, 1, FloorZ, new JObject { ["variant"] = "steel-1" }),
                Module("tvm-1", "tvm", 9, 1, FloorZ)));
            Drag((1.5, 1.5), (5.5, 1.5), (9.5, 1.5));
            AssertGone(host, "bench-a", "bench-b");
            AssertAlive(host, "tvm-1");
        }

        /// <summary>
        /// A quick jump between events still collects what the pointer crossed: the reference
        /// samples the screen path, so a fast drag cannot skip a piece between two shipments.
        /// </summary>
        [Test]
        public void AQuickJumpAcrossAPieceCollectsIt() {
            Open(new JArray(
                Module("bench-a", "bench", 1, 1, FloorZ, new JObject { ["variant"] = "steel-1" }),
                Module("bench-mid", "bench", 6, 1, FloorZ, new JObject { ["variant"] = "steel-1" }),
                Module("bench-end", "bench", 11, 1, FloorZ, new JObject { ["variant"] = "steel-1" })));
            Drag((1.5, 1.5), (11.5, 1.5));
            AssertGone(host, "bench-a", "bench-mid", "bench-end");
        }

        /// <summary>
        /// A legacy piece that stores no variant is the palette's default piece, so it sweeps
        /// with the current one (`benchSpec(undefined).variant === 'steel-1'`).
        /// </summary>
        [Test]
        public void ALegacyAndACurrentPieceAreOneNormalizedFamily() {
            Assert.AreEqual("bench:steel-1", StationSweep.FamilyOf(Record("bench", null)));
            Assert.AreEqual("bench:steel-1", StationSweep.FamilyOf(Record("bench", "steel-1")));
            Assert.AreEqual("bench:steel-1", StationSweep.FamilyOf(Record("bench", "no-such-bench")),
                "an unknown variant is the table's default piece");
            Assert.AreEqual("linemap:wall", StationSweep.FamilyOf(Record("linemap", null)));
            Assert.AreEqual("door:steel-1", StationSweep.FamilyOf(Record("door", null)));
            Assert.AreEqual("door:wood-2", StationSweep.FamilyOf(Record("door", "wood-2")));
            Assert.AreEqual("glass:1x1:", StationSweep.FamilyOf(Record("glass", null)));
            Assert.AreEqual("glass:2x2:", StationSweep.FamilyOf(Record("glass", "2x2")));
            Assert.AreEqual("sign:ceiling", StationSweep.FamilyOf(Record("sign", null)));
            Assert.AreEqual("shelf:dark-tall", StationSweep.FamilyOf(Record("shelf", null)));
            Assert.AreEqual("checkout:checkout:1", StationSweep.FamilyOf(Record("checkout", null, width: 9)));

            Open(new JArray(
                Module("bench-legacy", "bench", 1, 1, FloorZ),
                Module("bench-current", "bench", 5, 1, FloorZ, new JObject { ["variant"] = "steel-1" })));
            Drag((1.5, 1.5), (5.5, 1.5));
            AssertGone(host, "bench-legacy", "bench-current");
        }

        /// <summary>
        /// A block press is a rectangle dig for the whole gesture: crossing equipment on the
        /// rectangle takes it through the cell teardown, and a piece outside the rectangle
        /// survives untouched.
        /// </summary>
        [Test]
        public void ABlockRectangleCrossingEquipmentTakesTheEquipmentAndLeavesTheRest() {
            Open(new JArray(
                Module("bench-in", "bench", 3, 3, FloorZ, new JObject { ["variant"] = "steel-1" }),
                Module("tvm-in", "tvm", 4, 3, FloorZ),
                Module("bench-out", "bench", 8, 8, FloorZ, new JObject { ["variant"] = "steel-1" })));
            int revision = host.CurrentRevision;
            // Press a bare block at (1,1) and drag a deliberate rectangle to (5,3).
            Handle("pointer.down", Pointer(1.5, 1.5, timeMs: 1000));
            Assert.IsTrue(StationCellTool.HasGesture, "the block press armed the rectangle");
            Assert.IsFalse(StationCellTool.Gesture.Sweep, "a block press is a rectangle, not a module sweep");
            Handle("pointer.move", Pointer(5.5, 3.5, button: -1, buttons: 1, timeMs: 1400));
            Handle("pointer.up", Pointer(5.5, 3.5, timeMs: 1600));
            AssertGone(host, "bench-in", "tvm-in");
            AssertAlive(host, "bench-out");
            Assert.AreEqual(revision + 1, host.CurrentRevision);
            Assert.IsNull(host.Index.GetCell(3, 3, FloorZ), "the rectangle dug the floor under the bench");
            Assert.IsNotNull(host.Index.GetCell(8, 8, FloorZ), "the piece outside the rectangle is untouched");
        }

        /// <summary>A piece of another family the drag crosses never joins the sweep.</summary>
        [Test]
        public void AnUnrelatedPieceOnThePathNeverJoinsTheSweep() {
            Open(new JArray(
                Module("bench-a", "bench", 1, 1, FloorZ, new JObject { ["variant"] = "steel-1" }),
                Module("tvm-1", "tvm", 5, 1, FloorZ),
                Module("bench-b", "bench", 9, 1, FloorZ, new JObject { ["variant"] = "steel-1" })));
            Drag((1.5, 1.5), (9.5, 1.5));
            AssertGone(host, "bench-a", "bench-b");
            AssertAlive(host, "tvm-1");
        }

        /// <summary>Undo puts every swept piece back, and the floor cells they stood on stay.</summary>
        [Test]
        public void UndoRestoresTheWholeSweep() {
            Open(new JArray(
                Module("bench-a", "bench", 1, 1, FloorZ, new JObject { ["variant"] = "steel-1" }),
                Module("bench-b", "bench", 5, 1, FloorZ, new JObject { ["variant"] = "steel-1" })));
            Drag((1.5, 1.5), (5.5, 1.5));
            AssertGone(host, "bench-a", "bench-b");
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var code), code);
            AssertAlive(host, "bench-a", "bench-b");
            Assert.IsNotNull(host.Index.GetCell(1, 1, FloorZ));
            Assert.IsNotNull(host.Index.GetCell(5, 1, FloorZ));
        }

        /// <summary>A bare piece for the pure family-key question, built without a document read.</summary>
        static StationModuleRecord Record(string type, string variant, int width = 1) {
            var config = new Dictionary<string, string>(StringComparer.Ordinal);
            if (variant != null) config["variant"] = variant;
            var facts = new ModuleFacts {
                Id = "probe", Type = type, X = 0, Y = 0, Z = FloorZ, Width = width, Depth = 1,
                Config = new ModuleConfig(config),
            };
            return new StationModuleRecord("probe", type, 0, 0, FloorZ, 0, width, 1, 1, false,
                null, null, Array.Empty<string>(), "", facts);
        }
    }
}
