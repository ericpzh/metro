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

        [UnityTest]
        public IEnumerator HideUiSkyboxPreservedAcrossStandaloneExplodedViewerLifecycle() {
            var opened = host.OpenDocument(BuildTwoFloorSave(), "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            yield return null;
            StationRenderRig.Apply(editorCamera, "blueprint");

            // Seek to noon and enable Hide UI: editor camera uses Skybox + horizon fog.
            var seekNoon = SendCommand("sim.seek", new JObject { ["simTimeSeconds"] = 12 * 3600 });
            Assert.AreEqual("ack", (string)seekNoon["kind"]);
            var hideAck = SendCommand("view.set", new JObject { ["key"] = "hideUi", ["value"] = true });
            Assert.IsNotNull(hideAck);
            Assert.AreEqual("ack", (string)hideAck["kind"]);
            Assert.AreEqual(CameraClearFlags.Skybox, editorCamera.clearFlags);
            Assert.IsTrue(RenderSettings.fog);

            var stateBefore = host.BuildStatePayload();
            Assert.AreEqual(true, (bool?)stateBefore["render"]?["sky"]?["shown"]);
            Assert.AreEqual(1.0, (double)stateBefore["render"]["sky"]["intensity"], 1e-4);

            // Open standalone exploded viewer: viewer camera stays SolidColor with fog off.
            var openAck = SendCommand("exploded.open", new JObject {
                ["viewportWidth"] = 1280,
                ["viewportHeight"] = 720,
                ["theme"] = "blueprint",
            });
            Assert.IsNotNull(openAck);
            Assert.AreEqual("ack", (string)openAck["kind"]);
            explodedView.CompleteAllPropsNow();
            yield return null;

            Assert.IsTrue(explodedView.IsOpen);
            Assert.IsFalse(editorCamera.enabled);
            Assert.AreEqual(CameraClearFlags.SolidColor, explodedView.ViewerCamera.clearFlags);
            Assert.IsFalse(RenderSettings.fog, "Exploded viewer disables fog while open");

            // Seek simulation to night (02:00) while exploded viewer owns presentation, and let Update run.
            var seekNight = SendCommand("sim.seek", new JObject { ["simTimeSeconds"] = 2 * 3600 });
            Assert.AreEqual("ack", (string)seekNight["kind"]);
            yield return null;
            Assert.IsFalse(RenderSettings.fog, "Frame ticks while exploded viewer is open must not re-enable fog");

            // Close standalone exploded viewer: editor camera skybox and updated night horizon fog restore cleanly.
            var closeAck = SendCommand("exploded.close", new JObject { ["generation"] = explodedView.Generation });
            Assert.IsNotNull(closeAck);
            Assert.AreEqual("ack", (string)closeAck["kind"]);
            yield return null;

            Assert.IsFalse(explodedView.IsOpen);
            Assert.IsTrue(editorCamera.enabled);
            Assert.AreEqual(CameraClearFlags.Skybox, editorCamera.clearFlags);
            Assert.IsTrue(RenderSettings.fog);
            Assert.AreEqual(StationSkySystem.MinSkyIntensity, viewRig.Sky.AppliedIntensity, 1e-5f);

            var stateAfter = host.BuildStatePayload();
            Assert.AreEqual(true, (bool?)stateAfter["render"]?["sky"]?["shown"]);
            Assert.AreEqual(StationSkySystem.MinSkyIntensity, (float)stateAfter["render"]["sky"]["intensity"], 1e-4f);
        }

        [UnityTest]
        public IEnumerator TraySelectionTintAnchorProjectionWhenHiddenAndHiddenFloorPickAndLivePoseOmission() {
            string zooPath = Path.Combine(Application.dataPath, "StationDesigner/Demos/zoo.metro.json");
            var opened = host.OpenDocument(File.ReadAllText(zooPath), "zoo");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            yield return null;

            SendCommand("exploded.open", new JObject { ["viewportWidth"] = 1280, ["viewportHeight"] = 720, ["theme"] = "blueprint" });
            explodedView.CompleteAllPropsNow();
            yield return null;

            var builder = explodedView.Builder;
            Assert.IsNotNull(builder);
            int tray0Idx = builder.Plan.IndexOfLevel(-20);
            int tray1Idx = builder.Plan.IndexOfLevel(-15);
            Assert.AreEqual(0, tray0Idx);
            Assert.AreEqual(1, tray1Idx);
            var tray0 = builder.Trays[tray0Idx];
            var tray1 = builder.Trays[tray1Idx];

            // Capture original FloorRoot materials on tray 0 and tray 1 before selection.
            var tray0Renderers = tray0.FloorRoot.GetComponentsInChildren<MeshRenderer>(true);
            var tray1Renderers = tray1.FloorRoot.GetComponentsInChildren<MeshRenderer>(true);
            Assert.Greater(tray0Renderers.Length, 0, "Tray 0 must have floor MeshRenderers");
            Assert.Greater(tray1Renderers.Length, 0, "Tray 1 must have floor MeshRenderers");
            var tray0OrigMats = new Material[tray0Renderers.Length];
            var tray1OrigMats = new Material[tray1Renderers.Length];
            for (int i = 0; i < tray0Renderers.Length; i++) tray0OrigMats[i] = tray0Renderers[i].sharedMaterial;
            for (int i = 0; i < tray1Renderers.Length; i++) tray1OrigMats[i] = tray1Renderers[i].sharedMaterial;

            // Unselected anchor projection returns false.
            Assert.IsFalse(builder.TryProjectSelectedAnchor(explodedView.ViewerCamera, out _),
                "TryProjectSelectedAnchor must return false when no tray is selected");

            // SelectTray(0) tints selected tray only and leaves tray 1 untouched.
            builder.SelectTray(tray0Idx);
            Assert.AreEqual(tray0Idx, builder.SelectedIndex);
            Assert.AreEqual(-20, builder.SelectedElevation);
            for (int i = 0; i < tray0Renderers.Length; i++) {
                Assert.IsNotNull(tray0Renderers[i].sharedMaterial);
                Assert.AreNotSame(tray0OrigMats[i], tray0Renderers[i].sharedMaterial,
                    "Selected tray renderer must switch to tinted clone material");
                StringAssert.Contains("[Tray -20m Selected]", tray0Renderers[i].sharedMaterial.name);
            }
            for (int i = 0; i < tray1Renderers.Length; i++) {
                Assert.AreSame(tray1OrigMats[i], tray1Renderers[i].sharedMaterial,
                    "Unselected tray renderer must keep its original sourceMaterial");
            }

            // Anchor projection tracks tray drag and viewer camera zoom, and stays valid while FloorVisible=false.
            Assert.IsTrue(builder.TryProjectSelectedAnchor(explodedView.ViewerCamera, out var anchorInitial));
            Assert.IsTrue(float.IsFinite(anchorInitial.x) && float.IsFinite(anchorInitial.y));

            builder.SetTrayManualOffset(tray0Idx, new Vector3(14f, 6f, 0f));
            Assert.IsTrue(builder.TryProjectSelectedAnchor(explodedView.ViewerCamera, out var anchorDragged));
            Assert.Greater(Vector2.Distance(anchorInitial, anchorDragged), 1e-3f,
                "Anchor projection must move when the selected tray is dragged");

            int gen = explodedView.Generation;
            var zoomReply = SendCommand("exploded.camera", new JObject {
                ["generation"] = gen, ["op"] = "zoom", ["deltaY"] = -320, ["viewportWidth"] = 1280, ["viewportHeight"] = 720,
            });
            Assert.AreEqual("ack", (string)zoomReply["kind"]);
            Assert.IsTrue(builder.TryProjectSelectedAnchor(explodedView.ViewerCamera, out var anchorZoomed));
            Assert.Greater(Vector2.Distance(anchorDragged, anchorZoomed), 1e-4f,
                "Anchor projection must move when viewer camera zooms");

            // Find supported floor cells on tray 0 and tray 1 and an active train consist on tray 0.
            StationCellKey floorCell20 = default;
            StationCellKey floorCell15 = default;
            bool found20 = false, found15 = false;
            foreach (var cell in builder.Plan.Trays[tray0Idx].Cells) {
                var shifted = new StationCellKey(
                    cell.X + builder.Plan.Direction.x * builder.Plan.PackedOffsets[tray0Idx],
                    cell.Y + builder.Plan.Direction.y * builder.Plan.PackedOffsets[tray0Idx],
                    cell.Z);
                if (cell.Z == -20 && builder.Plan.PassengerSupport.Contains(shifted)) {
                    floorCell20 = cell.Key; found20 = true; break;
                }
            }
            foreach (var cell in builder.Plan.Trays[tray1Idx].Cells) {
                var shifted = new StationCellKey(
                    cell.X + builder.Plan.Direction.x * builder.Plan.PackedOffsets[tray1Idx],
                    cell.Y + builder.Plan.Direction.y * builder.Plan.PackedOffsets[tray1Idx],
                    cell.Z);
                if (cell.Z == -15 && builder.Plan.PassengerSupport.Contains(shifted)) {
                    floorCell15 = cell.Key; found15 = true; break;
                }
            }
            Assert.IsTrue(found20 && found15);

            string trainId = null;
            TrainConsistView consistView = null;
            foreach (var line in host.Document.Lines) {
                foreach (var mod in host.Document.Modules) {
                    if (mod.Type == "track" && mod.Config.Text("line") == line.Id &&
                        builder.TryGetConsist(line.Id + "|" + mod.Id, out var cv, out int ctIdx) && ctIdx == tray0Idx) {
                        trainId = line.Id + "|" + mod.Id;
                        consistView = cv;
                        break;
                    }
                }
                if (trainId != null) break;
            }
            Assert.IsNotNull(trainId, "Zoo must have a train consist on tray 0 (-20 m)");

            // Hide tray 0: anchor projection stays valid, tray 0 becomes unpickable, passengers omitted, trains retired.
            builder.SetFloorVisibility(tray0Idx, false);
            Assert.IsFalse(tray0.FloorVisible);
            Assert.IsTrue(builder.TryProjectSelectedAnchor(explodedView.ViewerCamera, out var anchorHidden),
                "TryProjectSelectedAnchor must stay valid when selected tray has FloorVisible = false");
            Assert.IsTrue(float.IsFinite(anchorHidden.x) && float.IsFinite(anchorHidden.y));

            var tray0CellWorld = tray0.WorldOffset + StationCoordinates.Point(new Vector3(floorCell20.X + 0.5f, floorCell20.Y + 0.5f, -19.0f));
            var downAtTray0 = new Ray(tray0CellWorld + Vector3.up * 3f, Vector3.down);
            bool hitWhileHidden = builder.PickTray(downAtTray0, out int hitIdxWhileHidden, out _);
            Assert.IsTrue(!hitWhileHidden || hitIdxWhileHidden != tray0Idx,
                "Hidden tray must be unpickable by PickTray");

            var liveMotion = new StationMotionFrame {
                Trains = new[] {
                    new StationTrainFrame {
                        Id = trainId, LineId = consistView.LineId, TrackId = consistView.TrackId,
                        ServiceSequence = 1, Phase = TrainPhase.Dwell, PhaseSeconds = 4.0, DoorFraction = 1.0,
                    },
                },
            };
            var livePax = new[] {
                new StationPassengerFrame {
                    SimId = 101, X = floorCell20.X + 0.5, Y = floorCell20.Y + 0.5, Z = -19.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
                new StationPassengerFrame {
                    SimId = 102, X = floorCell15.X + 0.5, Y = floorCell15.Y + 0.5, Z = -14.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
            };
            builder.ApplyLiveSampleForTest(liveMotion, livePax, tick: 1, alpha: 1f);
            Assert.IsFalse(builder.PassengerTrayBySimId.ContainsKey(101),
                "Hidden floor must omit its live passengers in ApplyPassengerFrames");
            Assert.AreEqual(tray1Idx, builder.PassengerTrayBySimId[102],
                "Visible floor must keep its live passengers");
            Assert.IsFalse(consistView.Visible,
                "Hidden floor must retire its train consist in ApplyTrainFrames");

            // Restoring visibility re-enables pickability, live passengers, and train consists.
            builder.SetFloorVisibility(tray0Idx, true);
            Assert.IsTrue(builder.PickTray(downAtTray0, out int hitIdxVisible, out _));
            Assert.AreEqual(tray0Idx, hitIdxVisible);
            Assert.IsTrue(builder.PassengerTrayBySimId.ContainsKey(101));
            Assert.AreEqual(tray0Idx, builder.PassengerTrayBySimId[101]);
            Assert.IsTrue(consistView.Visible);

            // Deselect restores exact original sourceMaterial references.
            builder.SelectTray(null);
            for (int i = 0; i < tray0Renderers.Length; i++) {
                Assert.AreSame(tray0OrigMats[i], tray0Renderers[i].sharedMaterial,
                    "Deselecting tray must restore exact original sourceMaterial");
            }

            // Re-select then ResetArrangement also restores exact original sourceMaterial references.
            builder.SelectTray(tray0Idx);
            Assert.AreNotSame(tray0OrigMats[0], tray0Renderers[0].sharedMaterial);
            builder.ResetArrangement();
            Assert.IsNull(builder.SelectedIndex);
            for (int i = 0; i < tray0Renderers.Length; i++) {
                Assert.AreSame(tray0OrigMats[i], tray0Renderers[i].sharedMaterial,
                    "ResetArrangement must restore exact original sourceMaterial");
            }

            // Empty-space pointerDown clears selection.
            var selAck = SendCommand("exploded.select", new JObject { ["generation"] = gen, ["elevation"] = -20 });
            Assert.AreEqual("ack", (string)selAck["kind"]);
            Assert.AreEqual(-20, builder.SelectedElevation);

            // Zoom out slightly to guarantee viewport corners hit empty void, then locate an empty pixel.
            SendCommand("exploded.camera", new JObject {
                ["generation"] = gen, ["op"] = "zoom", ["deltaY"] = 800, ["viewportWidth"] = 1280, ["viewportHeight"] = 720,
            });
            Vector2 emptyPx = new Vector2(4f, 4f);
            bool foundEmpty = false;
            Vector2[] cornerCandidates = {
                new Vector2(4f, 4f), new Vector2(1276f, 4f), new Vector2(4f, 716f), new Vector2(1276f, 716f),
            };
            foreach (var cand in cornerCandidates) {
                var vpRay = explodedView.ViewerCamera.ViewportPointToRay(new Vector3(cand.x / 1280f, 1f - cand.y / 720f, 0f));
                if (!builder.PickTray(vpRay, out _, out _)) {
                    emptyPx = cand;
                    foundEmpty = true;
                    break;
                }
            }
            Assert.IsTrue(foundEmpty, "Must find an empty-void corner pixel for empty-space pick test");
            var emptyDown = SendCommand("exploded.pointerDown", new JObject {
                ["generation"] = gen, ["pointerId"] = 9, ["x"] = emptyPx.x, ["y"] = emptyPx.y,
                ["viewportWidth"] = 1280, ["viewportHeight"] = 720,
            });
            Assert.AreEqual("ack", (string)emptyDown["kind"]);
            Assert.IsNull(builder.SelectedElevation, "Empty-space pointerDown must clear tray selection");
        }

        [UnityTest]
        public IEnumerator ExplodedPassengersSnapAcrossAllAlphasHandleOpposingSwapsDisappearanceAndSupportTypes() {
            string zooPath = Path.Combine(Application.dataPath, "StationDesigner/Demos/zoo.metro.json");
            var opened = host.OpenDocument(File.ReadAllText(zooPath), "zoo");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            yield return null;

            SendCommand("exploded.open", new JObject { ["viewportWidth"] = 1280, ["viewportHeight"] = 720 });
            explodedView.CompleteAllPropsNow();
            yield return null;

            var builder = explodedView.Builder;
            int tray20 = builder.Plan.IndexOfLevel(-20);
            int tray15 = builder.Plan.IndexOfLevel(-15);
            Assert.GreaterOrEqual(tray20, 0);
            Assert.GreaterOrEqual(tray15, 0);

            StationCellKey cell20 = default, cell15 = default;
            bool found20 = false, found15 = false;
            foreach (var cell in builder.Plan.Trays[tray20].Cells) {
                var shifted = new StationCellKey(
                    cell.X + builder.Plan.Direction.x * builder.Plan.PackedOffsets[tray20],
                    cell.Y + builder.Plan.Direction.y * builder.Plan.PackedOffsets[tray20],
                    cell.Z);
                if (cell.Z == -20 && builder.Plan.PassengerSupport.Contains(shifted)) {
                    cell20 = cell.Key; found20 = true; break;
                }
            }
            foreach (var cell in builder.Plan.Trays[tray15].Cells) {
                var shifted = new StationCellKey(
                    cell.X + builder.Plan.Direction.x * builder.Plan.PackedOffsets[tray15],
                    cell.Y + builder.Plan.Direction.y * builder.Plan.PackedOffsets[tray15],
                    cell.Z);
                if (cell.Z == -15 && builder.Plan.PassengerSupport.Contains(shifted)) {
                    cell15 = cell.Key; found15 = true; break;
                }
            }
            Assert.IsTrue(found20 && found15);

            double packed20X = cell20.X + 0.5 + builder.Plan.Direction.x * builder.Plan.PackedOffsets[tray20];
            double packed20Y = cell20.Y + 0.5 + builder.Plan.Direction.y * builder.Plan.PackedOffsets[tray20];
            double packed15X = cell15.X + 0.5 + builder.Plan.Direction.x * builder.Plan.PackedOffsets[tray15];
            double packed15Y = cell15.Y + 0.5 + builder.Plan.Direction.y * builder.Plan.PackedOffsets[tray15];

            // Tick 1: SimId 7 on -20 m, SimId 8 on -15 m.
            var tick1 = new[] {
                new StationPassengerFrame {
                    SimId = 7, X = cell20.X + 0.5, Y = cell20.Y + 0.5, Z = -19.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
                new StationPassengerFrame {
                    SimId = 8, X = cell15.X + 0.5, Y = cell15.Y + 0.5, Z = -14.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
            };
            builder.ApplyLiveSampleForTest(default, tick1, tick: 1, alpha: 1f);
            Assert.AreEqual(tray20, builder.PassengerTrayBySimId[7]);
            Assert.AreEqual(tray15, builder.PassengerTrayBySimId[8]);

            // Tick 2: opposing simultaneous swaps in REVERSED array order tested across alphas 0.1, 0.5, 0.9.
            var tick2Swap = new[] {
                new StationPassengerFrame {
                    SimId = 8, X = cell20.X + 0.5, Y = cell20.Y + 0.5, Z = -19.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
                new StationPassengerFrame {
                    SimId = 7, X = cell15.X + 0.5, Y = cell15.Y + 0.5, Z = -14.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
            };
            foreach (float alpha in new[] { 0.1f, 0.5f, 0.9f }) {
                builder.ApplyLiveSampleForTest(default, tick2Swap, tick: 2, alpha: alpha);
                Assert.AreEqual(2, builder.PresentedPassengers.Count);
                Assert.AreEqual(tray15, builder.PassengerTrayBySimId[7], "alpha=" + alpha);
                Assert.AreEqual(tray20, builder.PassengerTrayBySimId[8], "alpha=" + alpha);
                PassengerPose pose7 = default, pose8 = default;
                foreach (var p in builder.PresentedPassengers) {
                    if (p.SimId == 7) pose7 = p;
                    else if (p.SimId == 8) pose8 = p;
                }
                Assert.AreEqual(-14.0, pose7.Z, 1e-4, "SimId 7 must snap to -14 m with zero Z lerp at alpha=" + alpha);
                Assert.AreEqual(packed15X, pose7.X, 1e-4, "SimId 7 X snapped at alpha=" + alpha);
                Assert.AreEqual(packed15Y, pose7.Y, 1e-4, "SimId 7 Y snapped at alpha=" + alpha);
                Assert.AreEqual(-19.0, pose8.Z, 1e-4, "SimId 8 must snap to -19 m with zero Z lerp at alpha=" + alpha);
                Assert.AreEqual(packed20X, pose8.X, 1e-4, "SimId 8 X snapped at alpha=" + alpha);
                Assert.AreEqual(packed20Y, pose8.Y, 1e-4, "SimId 8 Y snapped at alpha=" + alpha);
            }

            // Tick 3: SimId 7 disappears; Tick 4: SimId 7 reappears at a shifted spot on same tray at alpha = 0.25 -> must snap (no stale lerp).
            var tick3Hide7 = new[] {
                new StationPassengerFrame {
                    SimId = 7, X = cell15.X + 0.5, Y = cell15.Y + 0.5, Z = -14.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = false,
                },
                new StationPassengerFrame {
                    SimId = 8, X = cell20.X + 0.5, Y = cell20.Y + 0.5, Z = -19.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
            };
            builder.ApplyLiveSampleForTest(default, tick3Hide7, tick: 3, alpha: 1f);
            Assert.IsFalse(builder.PassengerTrayBySimId.ContainsKey(7), "Hidden passenger must not be presented");

            var tick4Reappear7 = new[] {
                new StationPassengerFrame {
                    SimId = 7, X = cell15.X + 0.9, Y = cell15.Y + 0.1, Z = -14.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
            };
            builder.ApplyLiveSampleForTest(default, tick4Reappear7, tick: 4, alpha: 0.25f);
            Assert.AreEqual(1, builder.PresentedPassengers.Count);
            double expectedReappearX = cell15.X + 0.9 + builder.Plan.Direction.x * builder.Plan.PackedOffsets[tray15];
            double expectedReappearY = cell15.Y + 0.1 + builder.Plan.Direction.y * builder.Plan.PackedOffsets[tray15];
            Assert.AreEqual(expectedReappearX, builder.PresentedPassengers[0].X, 1e-4,
                "Reappearing passenger must snap to current position without stale lerp");
            Assert.AreEqual(expectedReappearY, builder.PresentedPassengers[0].Y, 1e-4);

            // Support types: Riding, stair-incline cell, and lift-shaft cell stay visible while unsupported roof/street walkers filter out.
            StationModuleRecord stairMod = null, liftMod = null;
            foreach (var m in builder.Plan.RetainedSourceModules) {
                if (stairMod == null && m.Type == "stair" && m.From.HasValue && m.To.HasValue &&
                    Math.Abs(m.To.Value.Z - m.From.Value.Z) >= 3.0) {
                    stairMod = m;
                }
                if (liftMod == null && m.Type == "lift" && m.From.HasValue && m.To.HasValue &&
                    Math.Abs(m.To.Value.Z - m.From.Value.Z) >= 4.0) {
                    liftMod = m;
                }
            }
            Assert.IsNotNull(stairMod, "Zoo must have a retained multi-level stair");
            Assert.IsNotNull(liftMod, "Zoo must have a retained multi-level lift");

            var stairFlights = StationRunGeometry.StairFlights(stairMod.Facts);
            Assert.Greater(stairFlights.Count, 0);
            var flight0 = stairFlights[0];
            for (int f = 0; f < stairFlights.Count; f++) {
                if (Math.Abs(stairFlights[f].To.Z - stairFlights[f].From.Z) >= 2.0) {
                    flight0 = stairFlights[f];
                    break;
                }
            }
            double stairMidX = (flight0.From.X + flight0.To.X) * 0.5 + 0.5;
            double stairMidY = (flight0.From.Y + flight0.To.Y) * 0.5 + 0.5;
            double stairMidFeetZ = (flight0.From.Z + flight0.To.Z) * 0.5 + 1.0;

            double liftLo = Math.Min(liftMod.From.Value.Z, liftMod.To.Value.Z);
            double liftMidFeetZ = liftLo + 3.0; // mid-shaft, above lower slab and below upper slab

            var tick5Support = new[] {
                new StationPassengerFrame {
                    SimId = 201, X = 999.5, Y = 999.5, Z = -19.0,
                    State = StationPassengerState.Riding, Activity = StationPassengerActivity.Wait, Visible = true,
                },
                new StationPassengerFrame {
                    SimId = 202, X = stairMidX, Y = stairMidY, Z = stairMidFeetZ,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
                new StationPassengerFrame {
                    SimId = 203, X = liftMod.X + 0.5, Y = liftMod.Y + 0.5, Z = liftMidFeetZ,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Wait, Visible = true,
                },
                new StationPassengerFrame {
                    SimId = 204, X = 500.5, Y = 500.5, Z = 1.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
                new StationPassengerFrame {
                    SimId = 205, X = 500.5, Y = 500.5, Z = -19.0,
                    State = StationPassengerState.Walking, Activity = StationPassengerActivity.Walk, Visible = true,
                },
            };
            builder.ApplyLiveSampleForTest(default, tick5Support, tick: 5, alpha: 1f);
            Assert.IsTrue(builder.PassengerTrayBySimId.ContainsKey(201), "Riding passenger must stay visible");
            Assert.IsTrue(builder.PassengerTrayBySimId.ContainsKey(202), "Stair-incline passenger must stay visible via PassengerSupport");
            Assert.IsTrue(builder.PassengerTrayBySimId.ContainsKey(203), "Lift-shaft passenger must stay visible via PassengerSupport");
            Assert.IsFalse(builder.PassengerTrayBySimId.ContainsKey(204), "Unsupported street walker must filter out");
            Assert.IsFalse(builder.PassengerTrayBySimId.ContainsKey(205), "Unsupported open-void walker must filter out");
        }

        [UnityTest]
        public IEnumerator EscalatorStepFollowersTrackStoreyBoundariesGuideMaterialIsNonPickableAndCloseLeavesEditorIntact() {
            var opened = host.OpenDocument(BuildTwoFloorSave(withFrontWall: false), "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            yield return null;

            // Locate live editor VerticalModuleView for esc-1 and snapshot its meshes & materials.
            Assert.IsNotNull(VerticalModuleRenderer.Current, "VerticalModuleRenderer must be active");
            VerticalModuleView escView = null;
            foreach (var v in VerticalModuleRenderer.Current.Views) {
                if (v != null && string.Equals(v.ModuleId, "esc-1", StringComparison.Ordinal)) {
                    escView = v;
                    break;
                }
            }
            Assert.IsNotNull(escView, "Editor VerticalModuleView for esc-1 must exist");
            Assert.Greater(escView.StepCount, 0, "esc-1 must have moving step transforms");
            Assert.IsTrue(escView.TryGetPart("tread-0", out var srcTread) && srcTread != null,
                "esc-1 must expose public tread-0 part");
            var editorMeshFilters = escView.Root.GetComponentsInChildren<MeshFilter>(true);
            var editorRenderers = escView.Root.GetComponentsInChildren<MeshRenderer>(true);
            Assert.Greater(editorMeshFilters.Length, 0);
            Assert.Greater(editorRenderers.Length, 0);

            SendCommand("exploded.open", new JObject { ["viewportWidth"] = 1280, ["viewportHeight"] = 720, ["theme"] = "blueprint" });
            explodedView.CompleteAllPropsNow();
            yield return null;

            var builder = explodedView.Builder;
            Assert.IsNotNull(builder);
            Assert.Greater(builder.ActiveGuideSegmentCount, 0);

            // Guide material assertions: #8ed8ff, _DashSize == 1.5, _GapSize == 1.0.
            Assert.IsNotNull(builder.GuidesObject);
            var guideMr = builder.GuidesObject.GetComponent<MeshRenderer>();
            Assert.IsNotNull(guideMr);
            var guideMat = guideMr.sharedMaterial;
            Assert.IsNotNull(guideMat);
            Color guideColor = guideMat.HasProperty("_BaseColor")
                ? guideMat.GetColor("_BaseColor")
                : guideMat.GetColor("_Color");
            Assert.AreEqual(StationExplodedTrayBuilder.GuideColor.r, guideColor.r, 1e-3f, "Guide red channel #8e");
            Assert.AreEqual(StationExplodedTrayBuilder.GuideColor.g, guideColor.g, 1e-3f, "Guide green channel #d8");
            Assert.AreEqual(StationExplodedTrayBuilder.GuideColor.b, guideColor.b, 1e-3f, "Guide blue channel #ff");
            if (guideMat.HasProperty("_DashSize")) {
                Assert.AreEqual(1.5f, guideMat.GetFloat("_DashSize"), 1e-4f);
            }
            if (guideMat.HasProperty("_GapSize")) {
                Assert.AreEqual(1.0f, guideMat.GetFloat("_GapSize"), 1e-4f);
            }

            // Snapshot initial guide endpoints and GuidesMesh reference, then drag tray 1 far out so guide midpoint is in open void.
            var initialGuidesMesh = builder.GuidesMesh;
            var initialEndpoints = new List<(Vector3 lower, Vector3 upper)>(builder.LastGuideWorldEndpoints);
            builder.SetTrayManualOffset(1, new Vector3(40f, 15f, 0f));
            builder.UpdateGuides(explodedView.ViewerCamera);

            var shiftedSeg = builder.LastGuideWorldEndpoints[0];
            Assert.Greater(Vector3.Distance(initialEndpoints[0].upper, shiftedSeg.upper), 1f,
                "Dragging upper tray must move upper guide endpoint");
            var guideMid = (shiftedSeg.lower + shiftedSeg.upper) * 0.5f;
            var rayAtGuide = new Ray(guideMid + Vector3.up * 20f, Vector3.down);
            Assert.IsFalse(builder.PickTray(rayAtGuide, out _, out _),
                "PickTray aimed directly at a dashed guide segment must return false");

            // ResetArrangement restores exact initial guide world endpoints reusing the same GuidesMesh instance.
            builder.ResetArrangement();
            Assert.AreSame(initialGuidesMesh, builder.GuidesMesh, "ResetArrangement must reuse GuidesMesh");
            Assert.AreEqual(initialEndpoints.Count, builder.LastGuideWorldEndpoints.Count);
            for (int i = 0; i < initialEndpoints.Count; i++) {
                Assert.Less(Vector3.Distance(initialEndpoints[i].lower, builder.LastGuideWorldEndpoints[i].lower), 1e-4f);
                Assert.Less(Vector3.Distance(initialEndpoints[i].upper, builder.LastGuideWorldEndpoints[i].upper), 1e-4f);
            }

            // Escalator step followers track storey boundaries and respect FloorVisible.
            var stepsGroup0 = builder.Trays[0].LiveRoot.Find("esc-1-steps");
            var stepsGroup1 = builder.Trays[1].LiveRoot.Find("esc-1-steps");
            Assert.IsNotNull(stepsGroup0, "Lower tray (-10 m) must host esc-1-steps followers");
            Assert.IsNotNull(stepsGroup1, "Upper tray (-5 m) must host esc-1-steps followers");
            var follower0 = stepsGroup0.Find("tread-0");
            var follower1 = stepsGroup1.Find("tread-0");
            Assert.IsNotNull(follower0);
            Assert.IsNotNull(follower1);

            var originalTreadPos = srcTread.position;
            bool originalTreadActive = srcTread.gameObject.activeSelf;
            try {
                srcTread.gameObject.SetActive(true);
                // Inside -10 m band [-10, -5): lower follower active, upper inactive.
                srcTread.position = new Vector3(originalTreadPos.x, -7.5f, originalTreadPos.z);
                builder.TickLivePoses(null, default);
                Assert.IsTrue(follower0.gameObject.activeSelf, "Step at y=-7.5 must activate on -10 m tray");
                Assert.IsFalse(follower1.gameObject.activeSelf, "Step at y=-7.5 must stay inactive on -5 m tray");

                // Cross storey boundary into -5 m band [-5, 0): lower inactive, upper active.
                srcTread.position = new Vector3(originalTreadPos.x, -3.5f, originalTreadPos.z);
                builder.TickLivePoses(null, default);
                Assert.IsFalse(follower0.gameObject.activeSelf, "Step at y=-3.5 must deactivate on -10 m tray");
                Assert.IsTrue(follower1.gameObject.activeSelf, "Step at y=-3.5 must activate on -5 m tray");

                // FloorVisible=false hides followers on that tray; restoring brings them back.
                builder.SetFloorVisibility(1, false);
                Assert.IsFalse(follower1.gameObject.activeSelf, "Hidden tray must hide its escalator step followers");
                builder.SetFloorVisibility(1, true);
                Assert.IsTrue(follower1.gameObject.activeSelf, "Restoring tray visibility must reactivate its in-band step follower");
            } finally {
                srcTread.position = originalTreadPos;
                srcTread.gameObject.SetActive(originalTreadActive);
            }

            // Close()/Dispose() must leave editor VerticalModuleView meshes and materials completely alive.
            explodedView.Close();
            yield return null;
            Assert.AreEqual(StationExplodedView.PhaseClosed, explodedView.Phase);
            Assert.IsTrue(escView.Root != null, "Editor VerticalModuleView root must remain alive after Close()");
            for (int i = 0; i < editorMeshFilters.Length; i++) {
                Assert.IsTrue(editorMeshFilters[i] != null && editorMeshFilters[i].sharedMesh != null,
                    "Editor escalator MeshFilter/sharedMesh must survive exploded viewer Close()/Dispose()");
            }
            for (int i = 0; i < editorRenderers.Length; i++) {
                Assert.IsTrue(editorRenderers[i] != null && editorRenderers[i].sharedMaterial != null,
                    "Editor escalator MeshRenderer/sharedMaterial must survive exploded viewer Close()/Dispose()");
            }
        }
    }
}
