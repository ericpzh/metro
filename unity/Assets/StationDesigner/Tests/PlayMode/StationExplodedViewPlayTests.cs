using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.TestTools;

namespace Metro.PlayModeTests {
    /// <summary>
    /// End-to-end PlayMode lifecycle, rigid tray dragging, single-pick invariant, hidden-wall
    /// click-through, physical ramp/lift slicing, dashed guides, generation/input fencing,
    /// cancellation/reopen parity, world-replacement safety, and live pose attachment tests
    /// for <see cref="StationExplodedView"/> (Plan 19 §5).
    /// </summary>
    public sealed class StationExplodedViewPlayTests {
        GameObject hostObject;
        GameObject cameraObject;
        StationGameHost host;
        Camera editorCamera;
        StationViewRig viewRig;
        StationExplodedView explodedView;
        readonly List<JObject> publishedReplies = new List<JObject>();

        bool baselineFog;
        FogMode baselineFogMode;
        Color baselineFogColor;
        float baselineFogStart;
        float baselineFogEnd;

        [SetUp]
        public void SetUp() {
            baselineFog = RenderSettings.fog;
            baselineFogMode = RenderSettings.fogMode;
            baselineFogColor = RenderSettings.fogColor;
            baselineFogStart = RenderSettings.fogStartDistance;
            baselineFogEnd = RenderSettings.fogEndDistance;

            publishedReplies.Clear();
            StationEditHost.ForgetHost();
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();

            cameraObject = new GameObject("TestEditorCamera");
            editorCamera = cameraObject.AddComponent<Camera>();
            editorCamera.tag = "MainCamera";
            editorCamera.orthographic = true;
            editorCamera.farClipPlane = 360f;
            editorCamera.clearFlags = CameraClearFlags.SolidColor;
            editorCamera.backgroundColor = StationRenderRig.VoidColor;
            StationRenderRig.Apply(editorCamera);

            hostObject = new GameObject(StationGameHost.ObjectName);
            host = hostObject.AddComponent<StationGameHost>();
            host.stationCamera = editorCamera;
            host.stationShader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Metro/Station Finish");
#if UNITY_EDITOR
            host.catalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            host.trainCatalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            host.font = UnityEditor.AssetDatabase.LoadAssetAtPath<Font>("Assets/StationDesigner/Fonts/NotoSansSC-Regular.ttf");
#endif
            StationEditHost.Ensure().Bind(host);
            viewRig = StationViewFeature.Attach(host);
            explodedView = StationViewFeature.ActiveExploded;
            host.ReplyPublished += OnReplyPublished;
        }

        [TearDown]
        public void TearDown() {
            if (host != null) host.ReplyPublished -= OnReplyPublished;
            if (explodedView != null) explodedView.Close();
            StationEditHost.ResetForTests();
            StationEditHost.ForgetHost();
            if (hostObject != null) UnityEngine.Object.DestroyImmediate(hostObject);
            if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
            foreach (var lightName in new[] { StationRenderRig.KeyLightName, StationRenderRig.FillLightName }) {
                var go = GameObject.Find(lightName);
                if (go != null) UnityEngine.Object.DestroyImmediate(go);
            }
            hostObject = null;
            cameraObject = null;
            host = null;
            editorCamera = null;
            viewRig = null;
            explodedView = null;

            RenderSettings.fog = baselineFog;
            RenderSettings.fogMode = baselineFogMode;
            RenderSettings.fogColor = baselineFogColor;
            RenderSettings.fogStartDistance = baselineFogStart;
            RenderSettings.fogEndDistance = baselineFogEnd;

            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
        }

        void OnReplyPublished(string json) {
            if (string.IsNullOrEmpty(json)) return;
            publishedReplies.Add(JObject.Parse(json));
        }

        JObject SendCommand(string type, JObject payload = null, string id = null, int? expectedRevision = null) {
            int beforeCount = publishedReplies.Count;
            string sessionId = !string.IsNullOrEmpty(host.ClientSessionId) ? host.ClientSessionId : "play-test-session";
            var env = new JObject {
                ["schemaVersion"] = 2,
                ["id"] = id ?? ("cmd-" + Guid.NewGuid().ToString("N")),
                ["sessionId"] = sessionId,
                ["type"] = type,
                ["payload"] = payload ?? new JObject(),
            };
            if (expectedRevision.HasValue) env["expectedRevision"] = expectedRevision.Value;
            host.BrowserCommand(env.ToString(Formatting.None));

            // Find the ack/reject/commit matching env["id"]
            string targetId = (string)env["id"];
            for (int i = publishedReplies.Count - 1; i >= beforeCount; i--) {
                var reply = publishedReplies[i];
                if (string.Equals((string)reply["id"], targetId, StringComparison.Ordinal)) {
                    return reply;
                }
            }
            return publishedReplies.Count > beforeCount ? publishedReplies[publishedReplies.Count - 1] : null;
        }

        static string Sha256Hex(string text) {
            using var sha = SHA256.Create();
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(text ?? ""));
            var sb = new StringBuilder(bytes.Length * 2);
            for (int i = 0; i < bytes.Length; i++) sb.Append(bytes[i].ToString("x2"));
            return sb.ToString();
        }

        static string SaveHashWithoutTimestamp(StationGameHost gameHost) {
            var doc = JObject.Parse(gameHost.SaveDocument());
            doc.Remove("savedAt");
            return Sha256Hex(doc.ToString(Formatting.None));
        }

        static void AssertRejectedCode(JObject reply, string expectedCode) {
            Assert.IsNotNull(reply);
            Assert.AreEqual("reject", (string)reply["kind"]);
            Assert.AreEqual(expectedCode, (string)reply["code"]);
        }

        static string BuildTwoFloorSave(bool withFrontWall = true) {
            var cells = new JArray();
            // Underground concourse at -5 m (slab at z = -5, walking plane -4)
            // Underground platform at -10 m (slab at z = -10, walking plane -9)
            foreach (int z in new[] { -10, -5 }) {
                for (int x = 0; x < 12; x++) {
                    for (int y = 0; y < 10; y++) {
                        cells.Add(new JObject {
                            ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid",
                            ["zone"] = z == -10 ? "platform" : "paid",
                            ["finish"] = new JObject { ["top"] = "floor.concrete" },
                        });
                    }
                }
                if (withFrontWall) {
                    // Front perimeter wall along y = 0 (4 courses above slab) and rear wall along y = 9
                    for (int x = 0; x < 12; x++) {
                        for (int dz = 1; dz <= 4; dz++) {
                            cells.Add(new JObject {
                                ["x"] = x, ["y"] = 0, ["z"] = z + dz, ["fill"] = "solid",
                                ["tags"] = new JArray("auto-wall"),
                            });
                            cells.Add(new JObject {
                                ["x"] = x, ["y"] = 9, ["z"] = z + dz, ["fill"] = "solid",
                                ["tags"] = new JArray("auto-wall"),
                            });
                        }
                    }
                }
            }

            var modules = new JArray {
                new JObject {
                    ["id"] = "bench-low", ["type"] = "bench", ["x"] = 4, ["y"] = 4, ["z"] = -10, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "steel-1" },
                },
                new JObject {
                    ["id"] = "stair-1", ["type"] = "stair", ["x"] = 2, ["y"] = 2, ["z"] = -10, ["rot"] = 0, ["w"] = 2,
                    ["from"] = new JObject { ["x"] = 2, ["y"] = 2, ["z"] = -10 },
                    ["to"] = new JObject { ["x"] = 7, ["y"] = 2, ["z"] = -5 },
                    ["cfg"] = new JObject(),
                },
                new JObject {
                    ["id"] = "esc-1", ["type"] = "escalator", ["x"] = 2, ["y"] = 5, ["z"] = -10, ["rot"] = 0, ["w"] = 1,
                    ["from"] = new JObject { ["x"] = 2, ["y"] = 5, ["z"] = -10 },
                    ["to"] = new JObject { ["x"] = 9, ["y"] = 5, ["z"] = -5 },
                    ["cfg"] = new JObject { ["dir"] = 1 },
                },
                new JObject {
                    ["id"] = "lift-1", ["type"] = "lift", ["x"] = 9, ["y"] = 7, ["z"] = -10, ["rot"] = 0, ["w"] = 2, ["d"] = 2,
                    ["from"] = new JObject { ["x"] = 9, ["y"] = 7, ["z"] = -10 },
                    ["to"] = new JObject { ["x"] = 9, ["y"] = 7, ["z"] = -5 },
                    ["cfg"] = new JObject { ["stops"] = new JArray(-10, -5) },
                },
            };

            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Two-floor exploded fixture", ["nameEn"] = "Two-Floor Fixture",
                ["city"] = "guangzhou", ["seed"] = 10101,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            }.ToString(Formatting.None);
        }

        static string BuildShiftedTurningSave() {
            // levelBase = 2 => storey bands at -8, -3, +2
            var cells = new JArray();
            foreach (int z in new[] { -8, -3, 2 }) {
                for (int x = 0; x < 14; x++) {
                    for (int y = 0; y < 14; y++) {
                        cells.Add(new JObject {
                            ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid",
                            ["zone"] = z == -8 ? "platform" : "paid",
                            ["room"] = z == 2 ? "concourse" : "",
                            ["finish"] = new JObject { ["top"] = "floor.concrete" },
                        });
                    }
                }
            }

            var modules = new JArray {
                // Multi-storey turning stair spanning -8 -> +2 with rot = 1 and halfLanding
                new JObject {
                    ["id"] = "stair-turn", ["type"] = "stair", ["x"] = 3, ["y"] = 3, ["z"] = -8, ["rot"] = 1, ["w"] = 2,
                    ["from"] = new JObject { ["x"] = 3, ["y"] = 3, ["z"] = -8 },
                    ["to"] = new JObject { ["x"] = 3, ["y"] = 9, ["z"] = 2 },
                    ["cfg"] = new JObject { ["halfLanding"] = true },
                },
                new JObject {
                    ["id"] = "esc-mid", ["type"] = "escalator", ["x"] = 6, ["y"] = 3, ["z"] = -8, ["rot"] = 0, ["w"] = 1,
                    ["from"] = new JObject { ["x"] = 6, ["y"] = 3, ["z"] = -8 },
                    ["to"] = new JObject { ["x"] = 12, ["y"] = 3, ["z"] = -3 },
                    ["cfg"] = new JObject { ["dir"] = 1 },
                },
                new JObject {
                    ["id"] = "lift-3stop", ["type"] = "lift", ["x"] = 10, ["y"] = 10, ["z"] = -8, ["rot"] = 0, ["w"] = 2, ["d"] = 2,
                    ["from"] = new JObject { ["x"] = 10, ["y"] = 10, ["z"] = -8 },
                    ["to"] = new JObject { ["x"] = 10, ["y"] = 10, ["z"] = 6 },
                    ["cfg"] = new JObject { ["stops"] = new JArray(-8, -3, 2), ["rises"] = new JArray(5, 5, 4) },
                },
            };

            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Shifted turning fixture", ["nameEn"] = "Shifted Turning",
                ["city"] = "guangzhou", ["seed"] = 20202,
                ["levelBase"] = 2, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            }.ToString(Formatting.None);
        }

        [UnityTest]
        public IEnumerator TwoFloorLifecycleIsolatesCameraLayerAndFogAndPreservesEditorStateOnReturn() {
            var opened = host.OpenDocument(BuildTwoFloorSave(), "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            yield return null;

            // Commit one editor change so undoDepth > 0 and select a tool + item before opening exploded view
            var draft = new StationEditDraft { Id = "bench-extra", Type = "bench", X = 6, Y = 4, Z = -10, Rotation = 0, Width = 1 };
            draft.Set("variant", "steel-1");
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, draft, null, "place", "cmd-pre-edit", out _, out var editErr), editErr);
            Assert.IsTrue(StationToolSelection.TrySelect("select", out _, out _));
            StationEditSession.SelectionKind = "module";
            StationEditSession.SelectionKey = "bench-extra";
            StationEditSession.SelectionLabel = "Bench";

            viewRig.CameraController.OrbitByPixels(42f, -18f, 0.008f);
            viewRig.CameraController.ZoomByWheel(-240f);
            viewRig.Commands.ApplyCamera();
            StationRenderRig.Apply(editorCamera, "blueprint");

            var expectedCamPos = editorCamera.transform.position;
            var expectedCamRot = editorCamera.transform.rotation;
            float expectedOrthoSize = editorCamera.orthographicSize;
            int expectedRevision = host.CurrentRevision;
            string expectedSourceHash = host.CurrentSourceHash;
            string expectedNormalizedJson = host.Document.NormalizedJson;
            string expectedSaveHash = SaveHashWithoutTimestamp(host);
            int expectedUndoDepth = (int)StationEditSession.ToJson()["undoDepth"];
            Assert.Greater(expectedUndoDepth, 0);
            bool expectedFog = RenderSettings.fog;
            float expectedFogStart = RenderSettings.fogStartDistance;
            float expectedFogEnd = RenderSettings.fogEndDistance;

            int layer = LayerMask.NameToLayer(StationExplodedTrayBuilder.DefaultLayerName);
            Assert.AreEqual(8, layer, "ProjectSettings/TagManager.asset User Layer 8 must be ExplodedPresentation");
            Assert.AreEqual(0, editorCamera.cullingMask & (1 << layer), "Editor camera must exclude ExplodedPresentation layer");

            var openReply = SendCommand("exploded.open", new JObject {
                ["viewportWidth"] = 1280,
                ["viewportHeight"] = 720,
                ["theme"] = "blueprint",
            });
            Assert.AreEqual("ack", (string)openReply["kind"]);
            explodedView.CompleteAllPropsNow();
            yield return null;

            Assert.IsTrue(explodedView.IsReady);
            Assert.IsTrue(explodedView.IsEquipped);
            Assert.IsFalse(editorCamera.enabled, "Editor camera must be disabled while standalone viewer is active");
            Assert.IsTrue(explodedView.ViewerCamera.enabled, "Viewer camera must be enabled");
            Assert.AreEqual(1 << layer, explodedView.ViewerCamera.cullingMask, "Viewer camera renders only ExplodedPresentation");
            Assert.IsFalse(RenderSettings.fog, "Standalone exploded view disables scene distance fog");
            Assert.AreEqual(StationExplodedView.DefaultVoidColor.r, explodedView.ViewerCamera.backgroundColor.r, 1e-3f);

            int gen = explodedView.Generation;

            // Theme switch to Studio paper void
            Assert.AreEqual("ack", (string)SendCommand("exploded.theme", new JObject { ["theme"] = "studio" })["kind"]);
            Assert.AreEqual(StationRenderRig.StudioVoidColor.r, explodedView.ViewerCamera.backgroundColor.r, 1e-3f);

            // Viewer camera orbit/pan/zoom/held-pan do not touch editor camera
            Assert.AreEqual("ack", (string)SendCommand("exploded.camera", new JObject {
                ["generation"] = gen, ["op"] = "orbit", ["dx"] = 60, ["dy"] = -30, ["viewportWidth"] = 1280, ["viewportHeight"] = 720,
            })["kind"]);
            Assert.AreEqual("ack", (string)SendCommand("exploded.camera", new JObject {
                ["generation"] = gen, ["op"] = "pan", ["dx"] = 25, ["dy"] = 15, ["viewportWidth"] = 1280, ["viewportHeight"] = 720,
            })["kind"]);
            Assert.AreEqual("ack", (string)SendCommand("exploded.camera", new JObject {
                ["generation"] = gen, ["op"] = "zoom", ["deltaY"] = -120, ["viewportWidth"] = 1280, ["viewportHeight"] = 720,
            })["kind"]);
            Assert.AreEqual("ack", (string)SendCommand("exploded.camera", new JObject {
                ["generation"] = gen, ["op"] = "panPlanarHeld", ["right"] = 1, ["forward"] = 1, ["boost"] = true,
            })["kind"]);
            yield return null;

            // Close and verify 100% restoration
            var closeReply = SendCommand("exploded.close", new JObject { ["generation"] = gen });
            Assert.AreEqual("ack", (string)closeReply["kind"]);
            yield return null;

            Assert.AreEqual(StationExplodedView.PhaseClosed, explodedView.Phase);
            Assert.IsTrue(editorCamera.enabled, "Editor camera must re-enable on close");
            Assert.IsFalse(explodedView.ViewerCamera.enabled, "Viewer camera must disable on close");
            Assert.AreEqual(0, editorCamera.cullingMask & (1 << layer));
            Assert.AreEqual(expectedFog, RenderSettings.fog, "Editor fog restored");
            Assert.AreEqual(expectedFogStart, RenderSettings.fogStartDistance, 1e-3f);
            Assert.AreEqual(expectedFogEnd, RenderSettings.fogEndDistance, 1e-3f);

            Assert.Less(Vector3.Distance(expectedCamPos, editorCamera.transform.position), 1e-4f, "Editor camera position untouched");
            Assert.Less(Quaternion.Angle(expectedCamRot, editorCamera.transform.rotation), 1e-3f, "Editor camera rotation untouched");
            Assert.AreEqual(expectedOrthoSize, editorCamera.orthographicSize, 1e-4f, "Editor camera ortho size untouched");
            Assert.AreEqual(expectedRevision, host.CurrentRevision, "Document revision untouched");
            Assert.AreEqual(expectedSourceHash, host.CurrentSourceHash, "Document source hash untouched");
            Assert.AreEqual(expectedNormalizedJson, host.Document.NormalizedJson, "Normalized document untouched");
            Assert.AreEqual(expectedSaveHash, SaveHashWithoutTimestamp(host), "Saved station document untouched");
            Assert.AreEqual(expectedUndoDepth, (int)StationEditSession.ToJson()["undoDepth"], "Undo stack untouched");
            Assert.AreEqual("select", StationToolSelection.Active, "Active tool untouched");
            Assert.AreEqual("bench-extra", StationEditSession.SelectionKey, "Editor selection untouched");
        }

        [UnityTest]
        public IEnumerator RigidTrayDraggingUsesOnePickPerPressNeverEditsVerticesAndSupportsHiddenWallClickThrough() {
            var opened = host.OpenDocument(BuildTwoFloorSave(withFrontWall: true), "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            yield return null;

            SendCommand("exploded.open", new JObject { ["viewportWidth"] = 1280, ["viewportHeight"] = 720, ["theme"] = "blueprint" });
            explodedView.CompleteAllPropsNow();
            yield return null;

            var builder = explodedView.Builder;
            Assert.IsNotNull(builder);
            Assert.AreEqual(2, builder.Trays.Count);
            Assert.AreEqual(0, builder.RootObject.GetComponentsInChildren<Collider>(true).Length,
                "Exploded trays must use CPU ray picking with zero Unity Colliders");

            int meshCountBefore = builder.DynamicMeshCount;
            var tray0 = builder.Trays[0]; // -10 m
            var tray1 = builder.Trays[1]; // -5 m
            var tray0InitialPos = tray0.TrayRoot.localPosition;
            var tray1InitialPos = tray1.TrayRoot.localPosition;

            // Snapshot vertices of first floor mesh to prove zero vertex mutation during drag
            var sampleFilter = tray0.FloorRoot.GetComponentInChildren<MeshFilter>();
            Assert.IsNotNull(sampleFilter);
            var originalVertices = sampleFilter.sharedMesh.vertices;

            // Project center of tray0's slab into screen pixels for a real pointerDown
            var targetWorld = tray0.WorldOffset + StationCoordinates.Point(new Vector3(6f, 5f, -9f));
            var vp = explodedView.ViewerCamera.WorldToViewportPoint(targetWorld);
            float px = vp.x * 1280f;
            float py = (1f - vp.y) * 720f;

            int picksBefore = builder.PickCount;
            int gen = explodedView.Generation;
            var downReply = SendCommand("exploded.pointerDown", new JObject {
                ["generation"] = gen, ["pointerId"] = 1, ["x"] = px, ["y"] = py, ["viewportWidth"] = 1280, ["viewportHeight"] = 720,
            });
            Assert.AreEqual("ack", (string)downReply["kind"]);
            Assert.AreEqual(picksBefore + 1, builder.PickCount, "pointerDown must execute at most one CPU tray pick");
            Assert.AreEqual(-10, builder.SelectedElevation);

            // Drag tray0 across screen: zero additional picks, zero mesh allocations, zero vertex edits
            var moveReply = SendCommand("exploded.pointerMove", new JObject {
                ["generation"] = gen, ["pointerId"] = 1, ["dx"] = 120f, ["dy"] = -60f, ["viewportWidth"] = 1280, ["viewportHeight"] = 720,
            });
            Assert.AreEqual("ack", (string)moveReply["kind"]);
            Assert.AreEqual(picksBefore + 1, builder.PickCount, "pointerMove must never re-pick");
            Assert.AreEqual(meshCountBefore, builder.DynamicMeshCount, "Dragging must allocate zero dynamic meshes");
            Assert.Greater(Vector3.Distance(tray0InitialPos, tray0.TrayRoot.localPosition), 0.5f, "Dragged tray localPosition must move");
            Assert.Less(Vector3.Distance(tray1InitialPos, tray1.TrayRoot.localPosition), 1e-5f, "Undragged tray must remain completely stationary");

            var afterVertices = sampleFilter.sharedMesh.vertices;
            Assert.AreEqual(originalVertices.Length, afterVertices.Length);
            for (int i = 0; i < originalVertices.Length; i++) {
                Assert.Less((originalVertices[i] - afterVertices[i]).sqrMagnitude, 1e-10f, "Dragging must never edit individual mesh vertices");
            }

            Assert.AreEqual("ack", (string)SendCommand("exploded.pointerUp", new JObject { ["generation"] = gen, ["pointerId"] = 1 })["kind"]);

            // Hidden front-wall click-through: cast a horizontal-ish ray through tray0's front wall (y=0.5, z=-7.5)
            // down onto its interior floor (y=3.5, z=-9.0). With walls visible, hit distance is near the front wall;
            // with walls hidden, the ray passes through the front wall and still picks tray0 on the interior slab!
            SendCommand("exploded.reset", new JObject { ["generation"] = gen });
            var wallTarget = tray0.WorldOffset + StationCoordinates.Point(new Vector3(6f, 0.5f, -7.5f));
            var floorBehind = tray0.WorldOffset + StationCoordinates.Point(new Vector3(6f, 3.5f, -9.0f));
            var dir = (floorBehind - wallTarget).normalized;
            var testRay = new Ray(wallTarget - dir * 10f, dir);

            Assert.IsTrue(builder.PickTray(testRay, out int hitWallTray, out float distWithWall));
            Assert.AreEqual(0, hitWallTray);

            Assert.AreEqual("ack", (string)SendCommand("exploded.floorVisibility", new JObject {
                ["generation"] = gen, ["elevation"] = -10, ["wallsVisible"] = false,
            })["kind"]);
            Assert.IsFalse(tray0.WallsRoot.gameObject.activeSelf, "WallsRoot must hide when wallsVisible=false");

            Assert.IsTrue(builder.PickTray(testRay, out int hitFloorTray, out float distThroughWall),
                "Ray through hidden front wall must click through to interior floor");
            Assert.AreEqual(0, hitFloorTray);
            Assert.Greater(distThroughWall, distWithWall + 0.5f, "Hidden front-wall triangles must not intercept the ray");

            // Hide floor, drag tray1, then Reset: manual offsets reset to 0 while floor/wall visibility flags stay preserved
            SendCommand("exploded.floorVisibility", new JObject {
                ["generation"] = gen, ["elevation"] = -10, ["floorVisible"] = false,
            });
            builder.SetTrayManualOffset(1, new Vector3(12f, -8f, 0f));
            SendCommand("exploded.reset", new JObject { ["generation"] = gen });

            Assert.AreEqual(Vector3.zero, tray0.ManualOffset);
            Assert.AreEqual(Vector3.zero, tray1.ManualOffset);
            Assert.IsNull(builder.SelectedElevation);
            Assert.IsFalse(tray0.FloorVisible, "Reset must preserve floorVisible choice");
            Assert.IsFalse(tray0.WallsVisible, "Reset must preserve wallsVisible choice");
        }

        [UnityTest]
        public IEnumerator ShiftedBaselineAndTurningRampSlicesProduceBoundedTraysAndTrackingDashedGuides() {
            var opened = host.OpenDocument(BuildShiftedTurningSave(), "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            yield return null;

            SendCommand("exploded.open", new JObject { ["viewportWidth"] = 1280, ["viewportHeight"] = 720 });
            explodedView.CompleteAllPropsNow();
            yield return null;

            var builder = explodedView.Builder;
            CollectionAssert.AreEqual(new[] { -8, -3, 2 }, builder.Plan.Levels, "Shifted levelBase=2 produces [-8, -3, 2] trays");

            // Verify ramp and lift slices stay strictly bounded within their owning 5 m bands
            int liftSliceCount = 0;
            int rampSliceCount = 0;
            foreach (var slice in builder.SliceRecords) {
                if (slice.Kind == "lift") {
                    liftSliceCount++;
                } else {
                    rampSliceCount++;
                    Assert.GreaterOrEqual(slice.SourceDocumentBounds.min.z, slice.TrayLevel - 1e-3f,
                        $"Slice {slice.SourceModuleId} on {slice.TrayLevel}m leaked below band");
                    Assert.LessOrEqual(slice.SourceDocumentBounds.max.z, slice.TrayLevel + 5f + 1e-3f,
                        $"Slice {slice.SourceModuleId} on {slice.TrayLevel}m leaked above band");
                }
            }
            Assert.AreEqual(3, liftSliceCount, "3-stop lift splits into one bounded shaft section per tray");
            Assert.Greater(rampSliceCount, 0, "Cross-storey turning stair/escalator must emit clipped slice meshes");

            int fullGuides = builder.ActiveGuideSegmentCount;
            Assert.AreEqual(builder.Connections.Count, fullGuides);
            Assert.GreaterOrEqual(fullGuides, 4, "Turning stair + escalator + 3-stop lift produce seam guides");

            var beforeEndpoints = new List<(Vector3 lower, Vector3 upper)>(builder.LastGuideWorldEndpoints);
            var deltaDoc = new Vector3(15f, -6f, 0f);
            var deltaWorld = StationCoordinates.Point(deltaDoc);
            builder.SetTrayManualOffset(1, deltaDoc); // middle tray (-3 m)
            builder.UpdateGuides(explodedView.ViewerCamera);

            var afterEndpoints = builder.LastGuideWorldEndpoints;
            Assert.AreEqual(beforeEndpoints.Count, afterEndpoints.Count);
            for (int i = 0; i < builder.Connections.Count; i++) {
                var conn = builder.Connections[i];
                var expectedLower = beforeEndpoints[i].lower + (conn.LowerIndex == 1 ? deltaWorld : Vector3.zero);
                var expectedUpper = beforeEndpoints[i].upper + (conn.UpperIndex == 1 ? deltaWorld : Vector3.zero);
                Assert.Less(Vector3.Distance(expectedLower, afterEndpoints[i].lower), 1e-3f);
                Assert.Less(Vector3.Distance(expectedUpper, afterEndpoints[i].upper), 1e-3f);
            }

            // Hiding middle tray (-3 m) drops all incident guides; restoring brings them back with the same mesh instance
            var guideMeshInstance = builder.GuidesMesh;
            SendCommand("exploded.floorVisibility", new JObject {
                ["generation"] = explodedView.Generation, ["elevation"] = -3, ["floorVisible"] = false,
            });
            Assert.AreEqual(0, builder.ActiveGuideSegmentCount, "All guides touch -3 m in a 3-tray ladder, so hiding -3 m hides all incident guides");

            SendCommand("exploded.floorVisibility", new JObject {
                ["generation"] = explodedView.Generation, ["elevation"] = -3, ["floorVisible"] = true,
            });
            Assert.AreEqual(fullGuides, builder.ActiveGuideSegmentCount);
            Assert.AreSame(guideMeshInstance, builder.GuidesMesh, "Guide mesh buffer must be reused without reallocating");
        }

        [UnityTest]
        public IEnumerator ValidationFencesStaleGenerationsInvalidInputsAndUncapturedPointers() {
            var opened = host.OpenDocument(BuildTwoFloorSave(), "file");
            Assert.IsTrue(opened.Accepted);
            yield return null;

            SendCommand("exploded.open", new JObject { ["viewportWidth"] = 1280, ["viewportHeight"] = 720 });
            explodedView.CompleteAllPropsNow();
            int gen = explodedView.Generation;

            AssertRejectedCode(SendCommand("exploded.select", new JObject {
                ["generation"] = gen + 5, ["elevation"] = -10,
            }), "stale-generation");

            AssertRejectedCode(SendCommand("exploded.select", new JObject {
                ["generation"] = gen, ["elevation"] = -999,
            }), "unknown-elevation");

            AssertRejectedCode(SendCommand("exploded.pointerDown", new JObject {
                ["generation"] = gen, ["pointerId"] = 1, ["x"] = 100, ["y"] = 100, ["viewportWidth"] = 0, ["viewportHeight"] = 720,
            }), "bad-pointer");

            AssertRejectedCode(SendCommand("exploded.camera", new JObject {
                ["generation"] = gen, ["op"] = "resize", ["viewportWidth"] = 0, ["viewportHeight"] = 720,
            }), "bad-viewport");

            AssertRejectedCode(SendCommand("exploded.pointerMove", new JObject {
                ["generation"] = gen, ["pointerId"] = 77, ["dx"] = 10, ["dy"] = 10, ["viewportWidth"] = 1280, ["viewportHeight"] = 720,
            }), "uncaptured-pointer");

            AssertRejectedCode(SendCommand("exploded.camera", new JObject {
                ["generation"] = gen, ["op"] = "teleport",
            }), "unknown-camera-op");

            Assert.IsNull(explodedView.Builder.SelectedElevation, "Rejected commands must never mutate viewer state");
        }

        [UnityTest]
        public IEnumerator DeferredPropCancellationZooOracleParityAndWorldReplacementSafety() {
            string zooPath = Path.Combine(Application.dataPath, "StationDesigner/Demos/zoo.metro.json");
            Assert.IsTrue(File.Exists(zooPath), "Exported Zoo demo must exist at " + zooPath);
            string zooJson = File.ReadAllText(zooPath);

            var opened = host.OpenDocument(zooJson, "zoo");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            yield return null;

            // 1. Mid-build cancellation while deferred props are still queued
            explodedView.AutoAdvanceDeferredProps = false;
            SendCommand("exploded.open", new JObject { ["viewportWidth"] = 1280, ["viewportHeight"] = 720 });
            Assert.IsTrue(explodedView.IsReady);
            Assert.IsFalse(explodedView.IsEquipped, "Zoo props should still have deferred batches pending");
            explodedView.StepPropsBatch(16);
            explodedView.Close();
            Assert.AreEqual(StationExplodedView.PhaseClosed, explodedView.Phase);
            Assert.IsTrue(editorCamera.enabled);

            // 2. Full open -> close -> open parity on Zoo + exact oracle numbers
            explodedView.AutoAdvanceDeferredProps = true;
            SendCommand("exploded.open", new JObject { ["viewportWidth"] = 1280, ["viewportHeight"] = 720 });
            explodedView.CompleteAllPropsNow();
            yield return null;

            CollectionAssert.AreEqual(new[] { -20, -15, -10, -5, 0 }, explodedView.Builder.Plan.Levels);
            CollectionAssert.AreEqual(new[] { 0, 24, 53, 67, 68 }, explodedView.Builder.Plan.PackedOffsets);
            Assert.AreEqual(22, explodedView.Builder.Connections.Count, "Zoo must emit 22 vertical connector guides");

            int meshesOpen1 = explodedView.Builder.DynamicMeshCount;
            int matsOpen1 = explodedView.Builder.ClonedMaterialCount;
            explodedView.Close();
            yield return null;

            SendCommand("exploded.open", new JObject { ["viewportWidth"] = 1280, ["viewportHeight"] = 720 });
            explodedView.CompleteAllPropsNow();
            yield return null;

            Assert.AreEqual(meshesOpen1, explodedView.Builder.DynamicMeshCount, "Reopen must allocate identical dynamic mesh count");
            Assert.AreEqual(matsOpen1, explodedView.Builder.ClonedMaterialCount, "Reopen must allocate identical material count");

            int openGenBeforeBadLoad = explodedView.Generation;

            // 3. Rejected load leaves active exploded viewer intact
            var badOpen = SendCommand("station.open", new JObject { ["document"] = "{not valid json" });
            Assert.AreEqual("reject", (string)badOpen["kind"]);
            Assert.IsTrue(explodedView.IsReady, "Rejected station load must leave open exploded viewer intact");
            Assert.AreEqual(openGenBeforeBadLoad, explodedView.Generation);

            // 4. Accepted station replacement closes exploded viewer via BeforePreviousDispose and restores editor camera
            var nextOpened = host.OpenDocument(BuildTwoFloorSave(), "two-floor");
            Assert.IsTrue(nextOpened.Accepted);
            yield return null;

            Assert.AreEqual(StationExplodedView.PhaseClosed, explodedView.Phase, "Accepted station switch must close exploded viewer");
            Assert.IsTrue(editorCamera.enabled, "Editor camera must be active after station switch");
            Assert.IsFalse(explodedView.ViewerCamera.enabled);
        }

        [UnityTest]
        public IEnumerator LivePosesPreserveOriginalTrayOwnershipSnapCrossStoreyTransfersAndMoveTrainsAndLifts() {
            string zooPath = Path.Combine(Application.dataPath, "StationDesigner/Demos/zoo.metro.json");
            var opened = host.OpenDocument(File.ReadAllText(zooPath), "zoo");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            yield return null;

            SendCommand("exploded.open", new JObject { ["viewportWidth"] = 1280, ["viewportHeight"] = 720 });
            explodedView.CompleteAllPropsNow();
            yield return null;

            var builder = explodedView.Builder;
            int trayMinus20 = builder.Plan.IndexOfLevel(-20);
            int trayMinus15 = builder.Plan.IndexOfLevel(-15);
            Assert.GreaterOrEqual(trayMinus20, 0);
            Assert.GreaterOrEqual(trayMinus15, 0);

            // Pick a real retained floor cell on -20 m and -15 m from Zoo's plan so PassengerSupport accepts them
            StationCellKey floorCell20 = default;
            StationCellKey floorCell15 = default;
            bool found20 = false, found15 = false;
            foreach (var cell in builder.Plan.Trays[trayMinus20].Cells) {
                var shifted = new StationCellKey(
                    cell.X + builder.Plan.Direction.x * builder.Plan.PackedOffsets[trayMinus20],
                    cell.Y + builder.Plan.Direction.y * builder.Plan.PackedOffsets[trayMinus20],
                    cell.Z);
                if (cell.Z == -20 && builder.Plan.PassengerSupport.Contains(shifted)) {
                    floorCell20 = cell.Key;
                    found20 = true;
                    break;
                }
            }
            foreach (var cell in builder.Plan.Trays[trayMinus15].Cells) {
                var shifted = new StationCellKey(
                    cell.X + builder.Plan.Direction.x * builder.Plan.PackedOffsets[trayMinus15],
                    cell.Y + builder.Plan.Direction.y * builder.Plan.PackedOffsets[trayMinus15],
                    cell.Z);
                if (cell.Z == -15 && builder.Plan.PassengerSupport.Contains(shifted)) {
                    floorCell15 = cell.Key;
                    found15 = true;
                    break;
                }
            }
            Assert.IsTrue(found20 && found15, "Zoo must have supported floor cells on -20 m and -15 m");

            // Find Zoo's first lift ID and first train ID
            StationModuleRecord liftMod = null;
            foreach (var mod in host.Document.Modules) {
                if (mod.Type == "lift" && mod.From.HasValue && mod.To.HasValue) { liftMod = mod; break; }
            }
            Assert.IsNotNull(liftMod);
            string liftId = liftMod.Id;
            double liftLowerZ = Math.Min(liftMod.From.Value.Z, liftMod.To.Value.Z);
            double liftTerminalZ = Math.Max(liftMod.From.Value.Z, liftMod.To.Value.Z);

            string trainId = null;
            foreach (var line in host.Document.Lines) {
                foreach (var mod in host.Document.Modules) {
                    if (mod.Type == "track" && mod.Config.Text("line") == line.Id && builder.TryGetConsist(line.Id + "|" + mod.Id, out _, out _)) {
                        trainId = line.Id + "|" + mod.Id;
                        break;
                    }
                }
                if (trainId != null) break;
            }
            Assert.IsNotNull(trainId, "Zoo must bind at least one exploded train consist");
            Assert.IsTrue(builder.TryGetConsist(trainId, out var consistView, out int consistTrayIdx));
            Assert.AreEqual(trayMinus20, consistTrayIdx, "Zoo Line 5 tracks belong to the -20 m tray");

            // Tick 1: passenger #42 at floorCell20 (-19 m feet), unsupported street walker #99 at (500, 500, 1),
            // active approaching train, and lift cabin at -19 m (inside -20 m slice)
            var motionTick1 = new StationMotionFrame {
                Trains = new[] {
                    new StationTrainFrame {
                        Id = trainId, LineId = consistView.LineId, TrackId = consistView.TrackId,
                        ServiceSequence = 1, Phase = TrainPhase.Dwell, PhaseSeconds = 5.0, DoorFraction = 1.0,
                    },
                },
                Lifts = new[] {
                    new StationLiftFrame { Id = liftId, Phase = "dwell", DoorFraction = 1.0, Z = liftLowerZ },
                },
            };
            var paxTick1 = new[] {
                new StationPassengerFrame {
                    SimId = 42, X = floorCell20.X + 0.2, Y = floorCell20.Y + 0.5, Z = -19.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
                new StationPassengerFrame {
                    SimId = 99, X = 500.5, Y = 500.5, Z = 1.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
            };
            builder.ApplyLiveSampleForTest(motionTick1, paxTick1, tick: 1, alpha: 1f);

            Assert.AreEqual(1, builder.PresentedPassengers.Count, "Unsupported street walker #99 must be filtered out");
            Assert.AreEqual(trayMinus20, builder.PassengerTrayBySimId[42]);
            Assert.IsTrue(consistView.Visible, "Active dwell train must mount on its track tray");
            Assert.AreEqual(1, builder.CountActiveLiftCabins(liftId), "Exactly one lift slice owns the cabin at -20 m");

            // Tick 2 on same -20 m floor at alpha = 0.5: interpolates smoothly along X
            var paxTick2SameFloor = new[] {
                new StationPassengerFrame {
                    SimId = 42, X = floorCell20.X + 0.8, Y = floorCell20.Y + 0.5, Z = -19.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
            };
            builder.ApplyLiveSampleForTest(motionTick1, paxTick2SameFloor, tick: 2, alpha: 0.5f);
            double expectedMidX = floorCell20.X + 0.5 + builder.Plan.Direction.x * builder.Plan.PackedOffsets[trayMinus20];
            Assert.AreEqual(expectedMidX, builder.PresentedPassengers[0].X, 1e-3, "Same-tray passenger movement interpolates at alpha=0.5");

            // While paused, drag -20 m tray vertically by +5 m so its displayed elevation overlaps -15 m:
            // ownership MUST stay on -20 m (from original pose Z) and paused pose MUST refresh immediately!
            builder.SetTrayManualOffset(trayMinus20, new Vector3(10f, 0f, 5f));
            Assert.AreEqual(trayMinus20, builder.PassengerTrayBySimId[42], "Overlapping dragged tray height must never steal passenger ownership");
            Assert.AreEqual(expectedMidX + 10.0, builder.PresentedPassengers[0].X, 1e-3, "Paused drag immediately updates passenger X");
            Assert.AreEqual(-19.0 + 5.0, builder.PresentedPassengers[0].Z, 1e-3, "Paused drag immediately updates passenger Z");

            // Tick 3: passenger #42 transfers to -15 m floor (Z = -14.0) at alpha = 0.5, and train retires (Phase.None)
            var motionTick3 = new StationMotionFrame {
                Trains = new[] {
                    new StationTrainFrame {
                        Id = trainId, LineId = consistView.LineId, TrackId = consistView.TrackId,
                        ServiceSequence = 0, Phase = TrainPhase.None,
                    },
                },
                Lifts = new[] {
                    new StationLiftFrame { Id = liftId, Phase = "dwell", DoorFraction = 0.0, Z = liftTerminalZ },
                },
            };
            var paxTick3Transfer = new[] {
                new StationPassengerFrame {
                    SimId = 42, X = floorCell15.X + 0.5, Y = floorCell15.Y + 0.5, Z = -14.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
            };
            builder.ApplyLiveSampleForTest(motionTick3, paxTick3Transfer, tick: 3, alpha: 0.5f);

            Assert.AreEqual(trayMinus15, builder.PassengerTrayBySimId[42], "Passenger transferred to -15 m tray");
            Assert.AreEqual(-14.0, builder.PresentedPassengers[0].Z, 1e-4,
                "Cross-storey floor transfer must snap immediately to destination tray without mid-air Z interpolation");
            double expected15X = floorCell15.X + 0.5 + builder.Plan.Direction.x * builder.Plan.PackedOffsets[trayMinus15];
            Assert.AreEqual(expected15X, builder.PresentedPassengers[0].X, 1e-4);
            Assert.IsFalse(consistView.Visible, "Out-of-service consist must retire cleanly");
            Assert.AreEqual(1, builder.CountActiveLiftCabins(liftId), "Terminal landing still assigns lift cabin to exactly one slice");
        }
    }
}
