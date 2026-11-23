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
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Parity suite for Domain D6b: Camera (FOV, orbit, planar/vertical pan, zoom, Home/Refresh),
    /// Section plane/view/drag &amp; Sky edge hours, Visibility/Grid/Ground rules &amp; caching,
    /// Exploded layout/connections/clipping, and Graphics/FSR settings persistence &amp; hysteresis.
    /// </summary>
    public sealed class StationCameraVisibilityParityTests {
        readonly List<UnityEngine.Object> ownedObjects = new List<UnityEngine.Object>();
        readonly List<IDisposable> ownedDisposables = new List<IDisposable>();

        [TearDown]
        public void TearDown() {
            StationSectionDrag.Reset();
            StationFsrUpscaler.ReleaseResources();
            for (int i = ownedDisposables.Count - 1; i >= 0; i--) {
                ownedDisposables[i]?.Dispose();
            }
            ownedDisposables.Clear();
            for (int i = ownedObjects.Count - 1; i >= 0; i--) {
                if (ownedObjects[i] != null) UnityEngine.Object.DestroyImmediate(ownedObjects[i]);
            }
            ownedObjects.Clear();
        }

        T Track<T>(T obj) where T : UnityEngine.Object {
            if (obj != null) ownedObjects.Add(obj);
            return obj;
        }

        T TrackDisposable<T>(T item) where T : IDisposable {
            if (item != null) ownedDisposables.Add(item);
            return item;
        }

        Camera CreateTestCamera(string name = "D6b Test Camera") {
            var go = Track(new GameObject(name));
            var cam = go.AddComponent<Camera>();
            cam.enabled = false;
            cam.aspect = 16f / 9f;
            return cam;
        }

        static Bounds SampleBounds() => new Bounds(new Vector3(40f, 15f, -5f), new Vector3(80f, 40f, 20f));

        static StationCameraController CreateController(int activeLevel = 0) {
            var controller = new StationCameraController();
            controller.SetStation(SampleBounds(), activeLevel);
            return controller;
        }

        static StationDocument ParseDocument(string json, string name = "d6b-fixture") {
            var obj = JObject.Parse(json);
            if ((string)obj["format"] != StationDocumentReader.SaveFormat) {
                var wrapped = new JObject {
                    ["format"] = StationDocumentReader.SaveFormat,
                    ["formatVersion"] = StationDocumentReader.SupportedVersion,
                    ["gameVersion"] = "0.2.0",
                    ["savedAt"] = StationDocumentReader.FixedSavedAt,
                    ["name"] = name,
                    ["city"] = "guangzhou",
                    ["seed"] = 1,
                    ["levelBase"] = obj["levelBase"] ?? 0,
                    ["storeyHeight"] = obj["storeyHeight"] ?? 5,
                    ["static"] = new JObject {
                        ["cells"] = obj["cells"] ?? new JArray(),
                        ["modules"] = obj["modules"] ?? new JArray(),
                        ["lines"] = obj["lines"] ?? new JArray(),
                    },
                };
                json = wrapped.ToString(Newtonsoft.Json.Formatting.None);
            }
            var parsed = StationDocumentReader.Read(json, new StationSource(name, ""));
            Assert.IsNotNull(parsed?.Document, $"Failed to parse fixture {name}");
            return parsed.Document;
        }

        /* ============================================================== CAMERA */

        [Test]
        public void CameraFovSweepUpdatesAppliedCameraAndProjectionMatrixAndPersistsThroughOrtho() {
            var controller = CreateController();
            var cam = CreateTestCamera();

            float[] sweep = { 30f, 45f, 60f, 85f, 90f, 120f, 74f };
            foreach (float fov in sweep) {
                controller.SetFov(fov);
                controller.ApplyTo(cam);
                Assert.AreEqual(fov, cam.fieldOfView, 1e-4f, $"camera.fieldOfView for FOV {fov}");
                float expectedM11 = 1f / Mathf.Tan(fov * Mathf.Deg2Rad * 0.5f);
                Assert.AreEqual(expectedM11, cam.projectionMatrix.m11, 1e-3f, $"projectionMatrix.m11 for FOV {fov}");
            }

            // Non-finite inputs must be ignored without corrupting the last valid FOV (74°).
            controller.SetFov(float.PositiveInfinity);
            controller.SetFov(float.NegativeInfinity);
            controller.SetFov(float.NaN);
            Assert.AreEqual(74f, controller.Fov, 1e-4f, "non-finite FOV inputs must be ignored");

            // Switching to orthographic preserves the stored perspective FOV and accepts updates for return.
            controller.SetProjection(StationProjection.Orthographic);
            controller.ApplyTo(cam);
            Assert.IsTrue(cam.orthographic);
            Assert.AreEqual(74f, controller.Fov, 1e-4f, "FOV persists upon entering orthographic");

            controller.SetFov(88f);
            controller.SetProjection(StationProjection.Perspective);
            controller.ApplyTo(cam);
            Assert.IsFalse(cam.orthographic);
            Assert.AreEqual(88f, cam.fieldOfView, 1e-4f, "FOV updated in orthographic applies back in perspective");
        }

        [Test]
        public void CameraOrbitHorizontalPreservesHeightAndVerticalPreservesAzimuth() {
            var controller = CreateController();
            var beforeH = controller.Snapshot();
            var offsetBeforeH = beforeH.Position - beforeH.Target;
            float yawBeforeH = Mathf.Atan2(offsetBeforeH.y, offsetBeforeH.x);

            controller.OrbitByPixels(60f, 0f);
            var afterH = controller.Snapshot();
            var offsetAfterH = afterH.Position - afterH.Target;
            float yawAfterH = Mathf.Atan2(offsetAfterH.y, offsetAfterH.x);

            Assert.AreEqual(beforeH.Position.z, afterH.Position.z, 1e-4f, "pure horizontal orbit keeps height constant");
            Assert.AreEqual(beforeH.Distance, afterH.Distance, 1e-3f, "pure horizontal orbit preserves distance");
            Assert.Greater(Mathf.Abs(Mathf.DeltaAngle(yawBeforeH * Mathf.Rad2Deg, yawAfterH * Mathf.Rad2Deg)), 10f,
                "pure horizontal orbit rotates yaw");

            float azimuthBeforeV = Mathf.Atan2(offsetAfterH.y, offsetAfterH.x);
            controller.OrbitByPixels(0f, -50f);
            var afterV = controller.Snapshot();
            var offsetAfterV = afterV.Position - afterV.Target;
            float azimuthAfterV = Mathf.Atan2(offsetAfterV.y, offsetAfterV.x);

            Assert.AreEqual(0f, Mathf.DeltaAngle(azimuthBeforeV * Mathf.Rad2Deg, azimuthAfterV * Mathf.Rad2Deg), 1e-3f,
                "pure vertical orbit preserves azimuth");
            Assert.Greater(Mathf.Abs(afterV.Position.z - afterH.Position.z), 1f, "pure vertical orbit changes height");
        }

        [Test]
        public void CameraPlanarPanWorksInPlanPresetAndExactTopPoleOrthographic() {
            var controller = CreateController();

            controller.SetPreset(StationCameraPreset.Plan);
            var beforePlan = controller.Snapshot();
            var offsetPlan = beforePlan.Position - beforePlan.Target;
            controller.PanByMetres(new Vector2(6f, -4f));
            var afterPlan = controller.Snapshot();

            Assert.AreEqual(0f, afterPlan.Target.z - beforePlan.Target.z, 1e-5f, "Plan pan keeps Target.z fixed");
            Assert.AreEqual(Mathf.Sqrt(6f * 6f + 4f * 4f), Vector3.Distance(beforePlan.Target, afterPlan.Target), 1e-3f,
                "Plan pan translates by requested planar distance");
            Assert.AreEqual(0f, Vector3.Distance(afterPlan.Position - afterPlan.Target, offsetPlan), 1e-4f,
                "Plan pan preserves eye-to-target offset");

            controller.SetViewDirection(new Vector3(0f, 0f, 1f), StationProjection.Orthographic);
            var beforePole = controller.Snapshot();
            var offsetPole = beforePole.Position - beforePole.Target;
            controller.PanByMetres(new Vector2(-3f, 5f));
            var afterPole = controller.Snapshot();

            Assert.IsFalse(float.IsNaN(afterPole.Target.x) || float.IsNaN(afterPole.Target.y));
            Assert.AreEqual(0f, afterPole.Target.z - beforePole.Target.z, 1e-5f, "exact-pole pan keeps Target.z fixed");
            Assert.AreEqual(Mathf.Sqrt(3f * 3f + 5f * 5f), Vector3.Distance(beforePole.Target, afterPole.Target), 1e-3f,
                "exact-pole pan translates cleanly");
            Assert.AreEqual(0f, Vector3.Distance(afterPole.Position - afterPole.Target, offsetPole), 1e-4f,
                "exact-pole pan preserves orbit offset");
        }

        [Test]
        public void CameraVerticalPanPreservesXyTriplesWhenFastCrossesMaxDistanceAndFramePreservesOffset() {
            var controller = CreateController();
            var start = controller.Snapshot();

            controller.SetHeldVertical(1, fast: false);
            controller.Tick(1f);
            var normalStep = controller.Snapshot();
            float normalDz = normalStep.Target.z - start.Target.z;
            Assert.AreEqual(0f, normalStep.Target.x - start.Target.x, 1e-5f, "vertical pan dx == 0");
            Assert.AreEqual(0f, normalStep.Target.y - start.Target.y, 1e-5f, "vertical pan dy == 0");
            Assert.AreEqual(normalDz, normalStep.Position.z - start.Position.z, 1e-4f, "eye and target move together vertically");
            Assert.Greater(normalDz, 0f);

            controller.SetHeldVertical(1, fast: true);
            controller.Tick(1f);
            var fastStep = controller.Snapshot();
            float fastDz = fastStep.Target.z - normalStep.Target.z;
            Assert.AreEqual(normalDz * 3f, fastDz, 1e-3f, "fast:true triples vertical pan rate");

            // Long vertical hold climbs freely past MaxDistance (400 m) without clamping target Z.
            controller.Tick(30f);
            var afterLongHold = controller.Snapshot();
            Assert.Greater(afterLongHold.Target.z, StationCameraMath.MaxDistance + 50f,
                "long vertical pan hold moves past MaxDistance=400");
            Assert.AreEqual(0f, afterLongHold.Target.x - start.Target.x, 1e-4f);
            Assert.AreEqual(0f, afterLongHold.Target.y - start.Target.y, 1e-4f);
            controller.SetHeldVertical(0, fast: false);

            // Frame() at shifted activeLevel = 5 preserves exact orbit offset.
            var offsetBeforeFrame = afterLongHold.Position - afterLongHold.Target;
            controller.SetActiveLevel(5);
            controller.Frame();
            var afterFrame = controller.Snapshot();
            Assert.AreEqual(6f, afterFrame.Target.z, 1e-4f, "Frame() centres Z at activeLevel + 1");
            Assert.AreEqual(0f, Vector3.Distance(afterFrame.Position - afterFrame.Target, offsetBeforeFrame), 1e-4f,
                "Frame() at shifted activeLevel preserves orbit offset");
        }

        [Test]
        public void CameraZoomByHalvesDistanceAndPreservesExactTarget() {
            var controller = CreateController();
            controller.PanByMetres(new Vector2(12f, -7f));
            var before = controller.Snapshot();

            controller.ZoomBy(0.5f);
            var after = controller.Snapshot();
            Assert.AreEqual(before.Target.x, after.Target.x, 1e-5f);
            Assert.AreEqual(before.Target.y, after.Target.y, 1e-5f);
            Assert.AreEqual(before.Target.z, after.Target.z, 1e-5f);
            Assert.AreEqual(before.Distance * 0.5f, after.Distance, 1e-3f, "ZoomBy(0.5) halves perspective distance");

            controller.SetProjection(StationProjection.Orthographic);
            float orthoBefore = controller.State.OrthoZoom;
            controller.ZoomBy(0.5f);
            Assert.AreEqual(orthoBefore * 0.5f, controller.State.OrthoZoom, 1e-5f, "ZoomBy(0.5) halves OrthoZoom");
            Assert.AreEqual(before.Target, controller.State.Target, "orthographic ZoomBy preserves Target");
        }

        [Test]
        public void CameraHomeResetsFovWithoutTouchingVisibilityFlagsAndRefreshStationKeepsOrthoZoom() {
            var rigGo = Track(new GameObject("Home/Refresh Rig"));
            var cam = CreateTestCamera("Home/Refresh Camera");
            var rig = rigGo.AddComponent<StationViewRig>();
            var grid = StationLevelGrid.FromDocument(0, 5);
            rig.Configure(cam, SampleBounds(), grid, 0);

            var vis = rig.Visibility.State;
            vis.ShowLevels = false;
            vis.AutoCeiling = true;
            vis.HideWalls = true;
            vis.HideGround = true;
            vis.HideRoof = true;
            vis.HideUi = true;
            vis.Cutaway = true;

            foreach (float startFov in new[] { 30f, 120f }) {
                rig.CameraController.SetFov(startFov);
                Assert.IsTrue(rig.Execute("{\"type\":\"camera.home\"}", out var code), code);
                Assert.AreEqual(StationCameraMath.DefaultFov, rig.CameraController.Fov, 1e-4f,
                    $"Home resets FOV from {startFov} to 45");
                Assert.IsFalse(vis.ShowLevels, "ShowLevels untouched by Home");
                Assert.IsTrue(vis.AutoCeiling, "AutoCeiling untouched by Home");
                Assert.IsTrue(vis.HideWalls, "HideWalls untouched by Home");
                Assert.IsTrue(vis.HideGround, "HideGround untouched by Home");
                Assert.IsTrue(vis.HideRoof, "HideRoof untouched by Home");
                Assert.IsTrue(vis.HideUi, "HideUi untouched by Home");
                Assert.IsTrue(vis.Cutaway, "Cutaway untouched by Home");
            }

            rig.CameraController.SetProjection(StationProjection.Orthographic);
            rig.CameraController.ZoomBy(0.45f);
            float orthoBefore = rig.CameraController.State.OrthoZoom;
            var expanded = new Bounds(new Vector3(45f, 20f, -5f), new Vector3(110f, 60f, 25f));
            rig.RefreshStation(expanded, grid);
            Assert.AreEqual(orthoBefore, rig.CameraController.State.OrthoZoom, 1e-5f,
                "RefreshStation must keep OrthoZoom unchanged");
        }

        /* ========================================================= SECTION & SKY */

        [Test]
        public void SectionPlaneFrameSnappingSlideAndConstantMatchWebParity() {
            float[] turns = { 0f, 90f, 180f, 270f };
            foreach (float az in turns) {
                var plane = new StationSectionPlane {
                    Anchor = new Vector3(10f, -4f, -5f),
                    Azimuth = az,
                    Offset = 3.5f,
                };
                Assert.AreEqual(1f, plane.Normal.magnitude, 1e-4f, $"Normal unit at {az}");
                Assert.AreEqual(1f, plane.Right.magnitude, 1e-4f, $"Right unit at {az}");
                Assert.AreEqual(1f, plane.Up.magnitude, 1e-4f, $"Up unit at {az}");
                Assert.AreEqual(0f, Vector3.Dot(plane.Normal, plane.Right), 1e-4f, $"Normal·Right at {az}");
                Assert.AreEqual(0f, Vector3.Dot(plane.Normal, plane.Up), 1e-4f, $"Normal·Up at {az}");
                Assert.AreEqual(0f, Vector3.Dot(plane.Right, plane.Up), 1e-4f, $"Right·Up at {az}");

                // Zero sideways or vertical leakage when sliding along Right or Up.
                var origin = plane.Point;
                Assert.AreEqual(plane.Offset, plane.SlideOffset(origin, origin + plane.Right * 7.5f), 1e-4f,
                    $"Zero sideways leakage at {az}");
                Assert.AreEqual(plane.Offset, plane.SlideOffset(origin, origin + plane.Up * -4.25f), 1e-4f,
                    $"Zero vertical leakage at {az}");
                Assert.AreEqual(plane.Offset + 2.5f, plane.SlideOffset(origin, origin + plane.Normal * 2.5f), 1e-4f,
                    $"Exact normal slide at {az}");

                // PlaneConstant tracks Offset cleanly: -dot(n, Anchor + n * Offset) == -dot(n, Anchor) - Offset.
                float c0 = plane.WithOffset(0f).PlaneConstant;
                float c1 = plane.WithOffset(6.25f).PlaneConstant;
                Assert.AreEqual(c0 - 6.25f, c1, 1e-4f, $"PlaneConstant tracks Offset at {az}");
            }

            Assert.AreEqual(90f, StationSectionPlane.NextAzimuth(37f), 1e-4f, "NextAzimuth(37) == 90");
            Assert.AreEqual(90f, StationSectionPlane.NextAzimuth(-10f), 1e-4f, "NextAzimuth(-10) == 90");

            // Guard Surgical Fix #2: half-up JS Math.round semantics, not banker's rounding.
            Assert.AreEqual(0.5f, StationSectionPlane.SnapOffset(0.25f, false), 1e-5f, "SnapOffset(0.25) rounds half-up to 0.5");
            Assert.AreEqual(0f, StationSectionPlane.SnapOffset(-0.25f, false), 1e-5f, "SnapOffset(-0.25) rounds half-up to 0");
            Assert.AreEqual(0.05f, StationSectionPlane.SnapOffset(0.025f, true), 1e-5f, "Fine SnapOffset(0.025) rounds half-up to 0.05");
            Assert.AreEqual(0f, StationSectionPlane.SnapOffset(-0.025f, true), 1e-5f, "Fine SnapOffset(-0.025) rounds half-up to 0");
        }

        [Test]
        public void SectionViewSizeClampsToMinAndScalesPastHalfDiagonal() {
            var go = Track(new GameObject("SectionSizeView"));
            var view = go.AddComponent<StationSectionView>();
            var plane = StationSectionPlane.Default;

            // Near-zero bounds still enforce MinSize == 6 m.
            view.Apply(plane, cutting: true, showSurface: true, bounds: new Bounds(Vector3.zero, Vector3.one * 0.05f));
            Assert.AreEqual(6f, view.Size, 1e-4f, "Tiny bounds clamp section sheet Size to 6 m");

            // Zero-size bounds before any update keep default / >= 6 m.
            var bigBounds = new Bounds(Vector3.zero, new Vector3(100f, 80f, 20f));
            view.Apply(plane, cutting: true, showSurface: true, bounds: bigBounds);
            float halfDiagonal = bigBounds.size.magnitude * 0.5f;
            Assert.Greater(view.Size, halfDiagonal, "Large station section sheet exceeds diagonal / 2");
        }

        [Test]
        public void SectionDragHandleCompletesMoveCommitAndRestoresOnCancelAndLeave() {
            var hostGo = Track(new GameObject("SectionDragHost"));
            var cam = CreateTestCamera("SectionDragCamera");
            var host = hostGo.AddComponent<StationGameHost>();
            host.stationCamera = cam;
            var rig = hostGo.AddComponent<StationViewRig>();
            var bounds = new Bounds(new Vector3(0f, 0f, -8f), new Vector3(60f, 40f, 20f));
            rig.Configure(cam, bounds, StationLevelGrid.FromDocument(0, 5), 0);
            Assert.IsTrue(rig.Execute("{\"type\":\"view.set\",\"payload\":{\"key\":\"cutaway\",\"value\":true}}", out var code), code);
            rig.Tick(0f);

            // Position isometric camera clearly looking at the section handle so the projected normal axis is well-conditioned.
            var handleWorld = StationCameraSpace.ToWorld(rig.Section.Point);
            cam.transform.position = handleWorld + new Vector3(1f, 0.85f, -1.2f).normalized * 90f;
            cam.transform.LookAt(handleWorld);
            var hitRay = new Ray(cam.transform.position, (handleWorld - cam.transform.position).normalized);

            float sw = Mathf.Max(1f, Screen.width);
            float sh = Mathf.Max(1f, Screen.height);
            var downPtr = StationPointerEvent.Synthetic(sw * 0.5f, sh * 0.5f, sw, sh, button: 0, pointerId: 7);
            var reply = new JObject();

            Assert.IsTrue(StationSectionDrag.Handle(host, rig, "pointer.down", downPtr, hitRay, false, reply, out _, out var reason),
                "pointer.down on section handle starts drag: " + reason);
            var active = StationSectionDrag.Current;
            Assert.IsNotNull(active);
            float startOffset = active.StartOffset;
            Vector2 axis = active.Axis;
            float span = active.Span;
            Assert.Greater(span, StationSectionDrag.MinSpanPixels);

            // Move along the frozen screen axis while staying well inside [0.1, 0.9] of the screen so ToScreen() never clamps.
            float maxSafePx = Mathf.Min(sw, sh) * 0.3f;
            float targetDeltaMetres = Mathf.Max(0.5f, Mathf.Min(3f, Mathf.Floor((maxSafePx / span) * 2f) * 0.5f));
            var movePtr = StationPointerEvent.Synthetic(
                sw * 0.5f + axis.x * span * targetDeltaMetres,
                sh * 0.5f - axis.y * span * targetDeltaMetres,
                sw, sh, button: 0, pointerId: 7);

            Assert.IsTrue(StationSectionDrag.Handle(host, rig, "pointer.move", movePtr, hitRay, false, reply, out _, out _));
            float walked = Vector2.Dot(movePtr.ToScreen() - downPtr.ToScreen(), axis);
            float expectedCommitted = StationSectionDrag.SnapOffset(StationSectionDrag.DragOffset(startOffset, walked, span), false);
            Assert.AreNotEqual(startOffset, expectedCommitted, "Drag should move at least one snap step");
            Assert.AreEqual(expectedCommitted, rig.SectionOffset, 1e-3f, "pointer.move updates section offset along frozen axis");

            Assert.IsTrue(StationSectionDrag.Handle(host, rig, "pointer.up", movePtr, hitRay, false, reply, out _, out _));
            Assert.IsNull(StationSectionDrag.Current, "pointer.up ends drag");
            Assert.AreEqual(expectedCommitted, rig.SectionOffset, 1e-3f, "pointer.up keeps committed offset");

            // Cancel lifecycle restores StartOffset.
            var handleWorld2 = StationCameraSpace.ToWorld(rig.Section.Point);
            var hitRay2 = new Ray(cam.transform.position, (handleWorld2 - cam.transform.position).normalized);
            Assert.IsTrue(StationSectionDrag.Handle(host, rig, "pointer.down", downPtr, hitRay2, false, reply, out _, out reason), reason);
            var active2 = StationSectionDrag.Current;
            float drag2Delta = Mathf.Max(0.5f, Mathf.Min(3f, Mathf.Floor((maxSafePx / active2.Span) * 2f) * 0.5f));
            var drag2Ptr = StationPointerEvent.Synthetic(
                sw * 0.5f + active2.Axis.x * active2.Span * drag2Delta,
                sh * 0.5f - active2.Axis.y * active2.Span * drag2Delta,
                sw, sh, button: 0, pointerId: 7);
            Assert.IsTrue(StationSectionDrag.Handle(host, rig, "pointer.move", drag2Ptr, hitRay2, false, reply, out _, out _));
            Assert.AreNotEqual(expectedCommitted, rig.SectionOffset, "drag moved away from startOffset before cancel");
            Assert.IsTrue(StationSectionDrag.Handle(host, rig, "pointer.cancel", drag2Ptr, hitRay2, false, reply, out _, out _));
            Assert.IsNull(StationSectionDrag.Current, "pointer.cancel ends drag");
            Assert.AreEqual(expectedCommitted, rig.SectionOffset, 1e-3f, "pointer.cancel restores startOffset");

            // Leave lifecycle also restores StartOffset and clears hover.
            Assert.IsTrue(StationSectionDrag.Handle(host, rig, "pointer.down", downPtr, hitRay2, false, reply, out _, out reason), reason);
            Assert.IsTrue(StationSectionDrag.Handle(host, rig, "pointer.move", drag2Ptr, hitRay2, false, reply, out _, out _));
            Assert.IsTrue(StationSectionDrag.Handle(host, rig, "pointer.leave", drag2Ptr, hitRay2, false, reply, out _, out _));
            Assert.IsNull(StationSectionDrag.Current, "pointer.leave ends drag");
            Assert.IsFalse(StationSectionDrag.Hovered, "pointer.leave clears hover");
            Assert.AreEqual(expectedCommitted, rig.SectionOffset, 1e-3f, "pointer.leave restores startOffset");
        }

        [Test]
        public void SkyIntensityHandlesEdgeHoursDawnDuskMonotonicityAndNonFiniteFallback() {
            Assert.AreEqual(StationSkySystem.MinSkyIntensity, StationSkySystem.SkyIntensity(0.0), 1e-5f, "0h is night floor");
            Assert.AreEqual(StationSkySystem.MaxSkyIntensity, StationSkySystem.SkyIntensity(12.0 * 3600.0), 1e-5f, "12h is full daylight");
            Assert.AreEqual(StationSkySystem.MinSkyIntensity, StationSkySystem.SkyIntensity(24.0 * 3600.0), 1e-5f, "24h wraps to 0h");

            // Sub-hour dawn ramp (05:15..06:45) strictly increases inside (Min, Max).
            double[] dawnHours = { 5.25, 5.5, 5.75, 6.0, 6.25, 6.5, 6.75 };
            float prev = StationSkySystem.MinSkyIntensity;
            foreach (double h in dawnHours) {
                float cur = StationSkySystem.SkyIntensity(h * 3600.0);
                Assert.Greater(cur, prev, $"Dawn intensity strictly increases at {h:0.##}h");
                Assert.Less(cur, StationSkySystem.MaxSkyIntensity);
                prev = cur;
            }

            // Sub-hour dusk ramp (17:15..18:45) strictly decreases inside (Min, Max).
            double[] duskHours = { 17.25, 17.5, 17.75, 18.0, 18.25, 18.5, 18.75 };
            prev = StationSkySystem.MaxSkyIntensity;
            foreach (double h in duskHours) {
                float cur = StationSkySystem.SkyIntensity(h * 3600.0);
                Assert.Less(cur, prev, $"Dusk intensity strictly decreases at {h:0.##}h");
                Assert.Greater(cur, StationSkySystem.MinSkyIntensity);
                prev = cur;
            }

            // NaN and ±Infinity fall back deterministically to DefaultSimTime.
            float expectedDefault = StationSkySystem.SkyIntensity(StationSkySystem.DefaultSimTime);
            Assert.AreEqual(expectedDefault, StationSkySystem.SkyIntensity(double.NaN), 1e-6f, "NaN falls back to DefaultSimTime");
            Assert.AreEqual(expectedDefault, StationSkySystem.SkyIntensity(double.PositiveInfinity), 1e-6f, "+Inf fallback");
            Assert.AreEqual(expectedDefault, StationSkySystem.SkyIntensity(double.NegativeInfinity), 1e-6f, "-Inf fallback");
        }

        /* ========================================== VISIBILITY, GRID & GROUND */

        [Test]
        public void VisibilityTogglesSurviveHideUiAndStateDefaultsMatchContract() {
            var defaults = new StationVisibilityState();
            Assert.IsTrue(defaults.ShowLevels, "ShowLevels defaults true");
            Assert.IsFalse(defaults.AutoCeiling, "AutoCeiling defaults false");
            Assert.IsFalse(defaults.HideWalls, "HideWalls defaults false");
            Assert.IsFalse(defaults.HideGround, "HideGround defaults false");
            Assert.IsFalse(defaults.HideRoof, "HideRoof defaults false");
            Assert.IsFalse(defaults.HideUi, "HideUi defaults false");
            Assert.AreEqual(-1, defaults.FollowPassenger, "FollowPassenger defaults -1");

            var registry = TrackDisposable(new StationVisibilityRegistry());
            registry.State.ActiveLevel = 0;
            registry.State.HideWalls = true;
            registry.State.HideGround = true;
            registry.State.HideRoof = true;
            registry.State.SetHideUi(true);

            Assert.AreEqual(StationDrawMode.Clear,
                registry.DecidePart(StationPartRole.Wall, new[] { 0 }),
                "HideWalls keeps walls Clear while HideUi is enabled");
            Assert.AreEqual(StationDrawMode.Hidden,
                registry.DecidePart(StationPartRole.Ground, new[] { 0 }),
                "HideGround keeps Ground cells Hidden while HideUi is enabled");
            Assert.AreEqual(StationDrawMode.Hidden,
                registry.DecidePart(StationPartRole.Prop, new[] { 0 }, gradeOwned: true),
                "HideGround keeps gradeOwned modules Hidden while HideUi is enabled");
            Assert.AreEqual(StationDrawMode.Hidden,
                registry.DecidePart(StationPartRole.Roof, new[] { 0 }),
                "HideRoof keeps Roof Hidden while HideUi is enabled");
            Assert.AreEqual(StationDrawMode.Hidden,
                registry.DecidePart(StationPartRole.Grid, new[] { 0 }),
                "HideUi hides Grid editing furniture");
        }

        [Test]
        public void VisibilityTargetRestoresExactBaseMaterialCachesGhostAndSkipsUnchangedWrites() {
            var go = Track(GameObject.CreatePrimitive(PrimitiveType.Cube));
            var renderer = go.GetComponent<MeshRenderer>();
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard") ?? Shader.Find("Sprites/Default");
            var baseMat = Track(new Material(shader) { name = "D6bBaseMat" });
            renderer.sharedMaterial = baseMat;

            var registry = TrackDisposable(new StationVisibilityRegistry(shader));
            var target = registry.Register(go.transform, StationPartRole.Slab, new[] { -5 });
            registry.State.ActiveLevel = 0;
            registry.State.ShowLevels = true;
            registry.Apply();

            Assert.AreEqual(StationDrawMode.Ghost, target.LastMode);
            var ghostMatFirst = renderer.sharedMaterial;
            Assert.IsNotNull(ghostMatFirst);
            Assert.AreNotSame(baseMat, ghostMatFirst, "Ghost mode swaps in a translucent ghost material");

            // Unchanged Apply() performs zero redundant renderer or material writes.
            registry.Apply();
            Assert.AreEqual(0, target.LastMaterialWrites, "Unchanged Apply writes 0 materials");
            Assert.AreEqual(0, target.LastRendererWrites, "Unchanged Apply writes 0 renderer enables");

            // HideUi switches to Base and restores exact authored baseMat reference.
            registry.State.SetHideUi(true);
            registry.Apply();
            Assert.AreEqual(StationDrawMode.Base, target.LastMode);
            Assert.AreSame(baseMat, renderer.sharedMaterial, "HideUi/Base restores exact original Material reference");
            Assert.IsTrue(target.TryGetBaseMaterials(renderer, out var captured) && captured.Length == 1 && ReferenceEquals(captured[0], baseMat));

            // Returning to Ghost reuses the exact cached ghost material instance.
            registry.State.SetHideUi(false);
            registry.Apply();
            Assert.AreEqual(StationDrawMode.Ghost, target.LastMode);
            Assert.AreSame(ghostMatFirst, renderer.sharedMaterial, "Ghost material is cached and reused without cloning");
        }

        [Test]
        public void VisibilityRulesBoundaryConditionsHold() {
            Assert.IsFalse(StationVisibilityRules.IsDense(19999), "19999 modules is not dense");
            Assert.IsTrue(StationVisibilityRules.IsDense(20000), "20000 modules is dense");

            Assert.IsTrue(StationVisibilityRules.StoreyNear(Array.Empty<int>(), 0, 5), "Empty level list is near");
            Assert.IsTrue(StationVisibilityRules.StoreyNear(new[] { -10, -5 }, 0, 5), "Spanning piece touching active-step is near");
            Assert.IsFalse(StationVisibilityRules.StoreyNear(new[] { -15, -10 }, 0, 5), "Far spanning piece is not near");

            // UnsupportedAbove: all 4 groundBand cases.
            Assert.IsFalse(StationVisibilityRules.UnsupportedAbove(0, StationVisibilityTarget.NoGroundBand), "NoGroundBand -> false");
            Assert.IsFalse(StationVisibilityRules.UnsupportedAbove(0, -5), "groundBand < activeZ -> false");
            Assert.IsFalse(StationVisibilityRules.UnsupportedAbove(0, 0), "groundBand == activeZ -> false");
            Assert.IsTrue(StationVisibilityRules.UnsupportedAbove(0, 5), "groundBand > activeZ -> true");

            // HideAbove beats Unsupported when both are true.
            var opts = new StationSliceOptions { Ghost = true, AutoCeiling = true, HideAbove = true, Unsupported = true };
            Assert.IsFalse(StationVisibilityRules.LevelVisible(StationLevelSide.Above, opts),
                "LevelVisible(Above, HideAbove:true, Unsupported:true) must be false");

            // SliceOptions with showLevels=false disables HideAbove even when built=true.
            var slice = StationVisibilityRules.SliceOptions(showLevels: false, autoCeiling: true, hideUI: false, cutaway: false, built: true);
            Assert.IsFalse(slice.HideAbove, "SliceOptions(showLevels:false, built:true).HideAbove == false");

            // ContactShadowVisible with shifted LevelBase = 2 (band 2 covers z=2..6, band 7 covers z=7..11).
            var shifted = StationLevelGrid.FromDocument(2, 5);
            Assert.IsTrue(StationVisibilityRules.ContactShadowVisible(2, 2, everyStorey: false, shifted));
            Assert.IsTrue(StationVisibilityRules.ContactShadowVisible(6, 2, everyStorey: false, shifted));
            Assert.IsFalse(StationVisibilityRules.ContactShadowVisible(7, 2, everyStorey: false, shifted));
            Assert.IsTrue(StationVisibilityRules.ContactShadowVisible(7, 2, everyStorey: true, shifted));
        }

        [Test]
        public void GridRendererTranslatesWithoutRebuildStagesLocalDeltasAndPurgesOnDispose() {
            var doc1 = ParseDocument(
                "{\"v\":1,\"levelBase\":0,\"storeyHeight\":5,\"cells\":[{\"x\":0,\"y\":0,\"z\":0}],\"modules\":[{\"id\":\"b1\",\"type\":\"bench\",\"x\":0,\"y\":0,\"z\":0,\"rot\":0,\"w\":1,\"d\":1}]}",
                "grid-fixture");
            var idx1 = new StationIndex(doc1);
            var rootGo = Track(new GameObject("GridWorldRoot"));
            var shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Sprites/Default");
            var gridRenderer = new StationGridRenderer();
            var world = TrackDisposable(new StationWorldView(
                rootGo.transform,
                "GridWorld",
                new IStationViewRenderer[] { gridRenderer },
                new StationViewAssets { Shader = shader }));
            world.Build(doc1, idx1);

            var rootObj = gridRenderer.Root;
            var initialMesh = gridRenderer.Mesh;
            var initialMat = gridRenderer.Material;
            Assert.IsNotNull(rootObj);
            Assert.IsNotNull(initialMesh);
            Assert.IsNotNull(initialMat);

            // SetLevel translates Y to level + 1.002 without replacing Mesh or Material.
            StationGridRenderer.SetLevel(-5);
            Assert.AreEqual(-5f + StationGridRenderer.LevelLift, rootObj.transform.position.y, 1e-4f);
            Assert.AreSame(initialMesh, gridRenderer.Mesh, "SetLevel must not rebuild Mesh");
            Assert.AreSame(initialMat, gridRenderer.Material, "SetLevel must not replace Material");

            // Local delta inside the same quantized 5 m extent reuses Mesh and Material.
            var doc2 = ParseDocument(
                "{\"v\":1,\"levelBase\":0,\"storeyHeight\":5,\"cells\":[{\"x\":0,\"y\":0,\"z\":0},{\"x\":2,\"y\":1,\"z\":0}],\"modules\":[{\"id\":\"b1\",\"type\":\"bench\",\"x\":0,\"y\":0,\"z\":0,\"rot\":0,\"w\":1,\"d\":1}]}",
                "grid-fixture");
            var idx2 = new StationIndex(doc2);
            var deltaSame = new StationIndexDelta();
            deltaSame.ChangedCells.Add(doc2.Cells[1]);
            using (var stageSame = world.StageLocalWorld(doc2, idx2, deltaSame)) {
                Assert.IsNotNull(stageSame);
                var commitSame = world.CommitLocalWorld(stageSame);
                Assert.AreEqual(0, commitSame.RetiredMeshes.Count);
            }
            Assert.AreSame(initialMesh, gridRenderer.Mesh, "Same quantized 5 m extent reuses Mesh");
            Assert.AreSame(initialMat, gridRenderer.Material, "Same extent keeps Material");

            // Local delta expanding outside the 5 m extent swaps Mesh while keeping Material.
            var doc3 = ParseDocument(
                "{\"v\":1,\"levelBase\":0,\"storeyHeight\":5,\"cells\":[{\"x\":0,\"y\":0,\"z\":0},{\"x\":40,\"y\":30,\"z\":0}],\"modules\":[{\"id\":\"b1\",\"type\":\"bench\",\"x\":0,\"y\":0,\"z\":0,\"rot\":0,\"w\":1,\"d\":1}]}",
                "grid-fixture");
            var idx3 = new StationIndex(doc3);
            var deltaBig = new StationIndexDelta();
            deltaBig.ChangedCells.Add(doc3.Cells[1]);
            using (var stageBig = world.StageLocalWorld(doc3, idx3, deltaBig)) {
                Assert.IsNotNull(stageBig);
                var commitBig = world.CommitLocalWorld(stageBig);
                Assert.AreEqual(1, commitBig.RetiredMeshes.Count, "Old grid Mesh is retired and destroyed on expansion");
            }
            Assert.AreNotSame(initialMesh, gridRenderer.Mesh, "Expanded extent swaps to a larger grid Mesh");
            Assert.IsTrue(initialMesh == null, "Retired grid Mesh was destroyed by CommitLocalWorld");
            Assert.AreSame(initialMat, gridRenderer.Material, "Expanded extent keeps the same grid Material");

            var swappedMesh = gridRenderer.Mesh;
            world.Dispose();
            gridRenderer.Release();
            Assert.IsTrue(swappedMesh == null, "Purge frees grid Mesh after world.Dispose()");
            Assert.IsTrue(initialMat == null, "Purge frees grid Material after world.Dispose()");
        }

        [Test]
        public void CellMesherRoutesPaintedGroundEmptyVirtualGroundAndHangingPlatesCorrectly() {
            // 1. PaintedGround at GroundZ with VirtualGround=true emits only in Ground role (not Cell).
            var paintedInput = new StationCellMeshInput {
                VirtualGround = true,
                GroundZ = 0,
                GroundMargin = 0,
                BuildGround = true,
                Cells = new List<StationMeshCell> {
                    new StationMeshCell {
                        X = 0, Y = 0, Z = 0, Solid = true,
                        Shape = StationCellShape.Full,
                        Flags = StationMeshCellFlags.PaintedGround,
                        Finish = new StationFinishSet(top: "floor.granite"),
                    },
                },
            };
            var paintedResult = StationCellMesher.Mesh(paintedInput);
            Assert.Greater(paintedResult.Groups.Count, 0);
            foreach (var g in paintedResult.Groups) {
                Assert.AreEqual(StationSurfaceRole.Ground, g.Role, "PaintedGround cell must emit in Ground pass only");
            }

            // 2. Empty document with VirtualGround=true emits Ground pass only.
            var emptyInput = new StationCellMeshInput {
                VirtualGround = true,
                GroundZ = 0,
                GroundMargin = 2,
                BuildGround = true,
            };
            var emptyResult = StationCellMesher.Mesh(emptyInput);
            Assert.Greater(emptyResult.Groups.Count, 0);
            foreach (var g in emptyResult.Groups) {
                Assert.AreEqual(StationSurfaceRole.Ground, g.Role, "Empty virtual ground doc emits Ground pass only");
            }

            // 3. Hanging plate at z=5 with nothing below: default BuildPlates=false caps once in Cell (no Plate duplicate).
            var plateCell = new StationMeshCell {
                X = 2, Y = 2, Z = 5, Solid = true,
                Shape = StationCellShape.Full,
                Finish = new StationFinishSet(top: "floor.concrete"),
            };
            var plateOff = StationCellMesher.Mesh(new StationCellMeshInput {
                VirtualGround = false,
                BuildPlates = false,
                BuildGround = false,
                Cells = new List<StationMeshCell> { plateCell },
            });
            int cellTrisOff = 0, plateTrisOff = 0;
            foreach (var g in plateOff.Groups) {
                if (g.Role == StationSurfaceRole.Cell) cellTrisOff += g.TriangleCount;
                if (g.Role == StationSurfaceRole.Plate) plateTrisOff += g.TriangleCount;
            }
            Assert.Greater(cellTrisOff, 0, "Hanging plate emits Cell faces once when BuildPlates=false");
            Assert.AreEqual(0, plateTrisOff, "Hanging plate must not duplicate into Plate when BuildPlates=false");

            var plateOn = StationCellMesher.Mesh(new StationCellMeshInput {
                VirtualGround = false,
                BuildPlates = true,
                BuildGround = false,
                Cells = new List<StationMeshCell> { plateCell },
            });
            int plateTrisOn = 0;
            foreach (var g in plateOn.Groups) {
                if (g.Role == StationSurfaceRole.Plate) plateTrisOn += g.TriangleCount;
            }
            Assert.Greater(plateTrisOn, 0, "BuildPlates=true emits the explicit Plate pass");
        }

        /* ============================================== EXPLODED EDITMODE & FSR */

        [Test]
        public void ExplodedLayoutHandlesEmptyDocShopVsBenchSoilCapRoofCctvAndShiftedLevelBase() {
            // Empty document -> 0 trays.
            var emptyDoc = ParseDocument("{\"v\":1,\"cells\":[],\"modules\":[]}", "exploded-empty");
            var emptyPlan = StationExplodedLayoutPlan.Build(emptyDoc);
            Assert.AreEqual(0, emptyPlan.Trays.Count, "Empty doc yields 0 exploded trays");

            // Equipment-only shop creates a tray; bare bench alone creates 0 trays.
            var shopDoc = ParseDocument(
                "{\"v\":1,\"cells\":[],\"modules\":[{\"id\":\"s1\",\"type\":\"shop\",\"x\":0,\"y\":0,\"z\":-5,\"rot\":0,\"w\":3,\"d\":2}]}",
                "exploded-shop");
            var shopPlan = StationExplodedLayoutPlan.Build(shopDoc);
            Assert.AreEqual(1, shopPlan.Trays.Count, "Structural shop creates an exploded tray");
            Assert.AreEqual(-5, shopPlan.Trays[0].Level);

            var benchDoc = ParseDocument(
                "{\"v\":1,\"cells\":[],\"modules\":[{\"id\":\"b1\",\"type\":\"bench\",\"x\":0,\"y\":0,\"z\":-5,\"rot\":0,\"w\":1,\"d\":1}]}",
                "exploded-bench");
            var benchPlan = StationExplodedLayoutPlan.Build(benchDoc);
            Assert.AreEqual(0, benchPlan.Trays.Count, "Bare bench alone creates 0 exploded trays");

            // Exposed floor.soil cap is dropped while wall-backed floor.soil is kept; roof-ring cctv at z=0 without ground room is dropped.
            var soilAndCctvDoc = ParseDocument(
                "{\"v\":1,\"cells\":[" +
                "{\"x\":0,\"y\":0,\"z\":-5,\"finish\":{\"top\":\"floor.soil\"}}," +
                "{\"x\":1,\"y\":0,\"z\":-5,\"finish\":{\"top\":\"floor.soil\"}}," +
                "{\"x\":1,\"y\":0,\"z\":-4,\"tags\":[\"wall\"]}" +
                "],\"modules\":[" +
                "{\"id\":\"c1\",\"type\":\"cctv\",\"x\":0,\"y\":0,\"z\":0,\"rot\":0,\"w\":1,\"d\":1}" +
                "]}",
                "exploded-soil-cctv");
            var soilPlan = StationExplodedLayoutPlan.Build(soilAndCctvDoc);
            Assert.AreEqual(1, soilPlan.Trays.Count);
            Assert.IsFalse(soilPlan.Trays[0].RetainedCellSet.Contains(new StationCellKey(0, 0, -5)),
                "Exposed floor.soil cap cell must be dropped");
            Assert.IsTrue(soilPlan.Trays[0].RetainedCellSet.Contains(new StationCellKey(1, 0, -5)),
                "Wall-backed floor.soil cell must be kept");
            Assert.AreEqual(0, soilPlan.RetainedSourceModules.Count,
                "Roof-ring cctv at z=0 without labelled ground room must be removed");

            // Shifted levelBase=2 lift shaft spanning [2, 12] splits along bands 2 ([2,7]) and 7 ([7,12]).
            var shiftedDoc = ParseDocument(
                "{\"v\":1,\"levelBase\":2,\"storeyHeight\":5,\"cells\":[" +
                "{\"x\":0,\"y\":0,\"z\":2,\"zone\":\"public\"}," +
                "{\"x\":0,\"y\":0,\"z\":7,\"zone\":\"public\"}" +
                "],\"modules\":[" +
                "{\"id\":\"l1\",\"type\":\"lift\",\"x\":0,\"y\":0,\"z\":2,\"rot\":0,\"w\":2,\"d\":2,\"from\":{\"x\":0,\"y\":0,\"z\":2},\"to\":{\"x\":0,\"y\":0,\"z\":12}}" +
                "]}",
                "exploded-levelbase-2");
            var shiftedPlan = StationExplodedLayoutPlan.Build(shiftedDoc);
            CollectionAssert.AreEqual(new[] { 2, 7 }, shiftedPlan.Levels, "Shifted levelBase=2 produces trays [2, 7]");
            Assert.AreEqual(2, shiftedPlan.AllLiftSlices.Count, "Lift produces one slice per served shifted tray");
            Assert.AreEqual(2, shiftedPlan.AllLiftSlices[0].OwnerLevel);
            Assert.AreEqual(7, shiftedPlan.AllLiftSlices[1].OwnerLevel);
        }

        [Test]
        public void ExplodedConnectionsSkipFlatRampsAndClipMeshSubmeshToBandPreservesBoundsAndWinding() {
            var flatDoc = ParseDocument(
                "{\"v\":1,\"cells\":[],\"modules\":[" +
                "{\"id\":\"st1\",\"type\":\"stair\",\"x\":0,\"y\":0,\"z\":-5,\"rot\":0,\"w\":2,\"d\":1," +
                "\"from\":{\"x\":0,\"y\":0,\"z\":-5},\"to\":{\"x\":5,\"y\":0,\"z\":-5}}" +
                "]}",
                "exploded-flat-ramp");
            var connections = StationExplodedConnections.Build(flatDoc.Modules, new[] { -5, 0 });
            Assert.AreEqual(0, connections.Length, "Flat ramp (from.z == to.z) must emit 0 exploded connection guides");

            // Build a vertical quad spanning y = 0..10 facing +Z in Unity world space and clip to [2, 6].
            var quad = Track(new Mesh {
                vertices = new[] {
                    new Vector3(0f, 0f, 0f),
                    new Vector3(0f, 10f, 0f),
                    new Vector3(2f, 10f, 0f),
                    new Vector3(2f, 0f, 0f),
                },
                normals = new[] { Vector3.forward, Vector3.forward, Vector3.forward, Vector3.forward },
                uv = new[] { new Vector2(0f, 0f), new Vector2(0f, 1f), new Vector2(1f, 1f), new Vector2(1f, 0f) },
                colors = new[] { Color.black, Color.white, Color.white, Color.black },
                triangles = new[] { 0, 1, 2, 0, 2, 3 },
            });

            bool clipped = StationExplodedTrayBuilder.ClipMeshSubmeshToBand(
                quad, 0, Matrix4x4.identity, 2f, 6f,
                out var outPos, out var outNorm, out var outUv, out var outCol, out var outIdx);
            Assert.IsTrue(clipped, "Straddling quad clips cleanly to [2, 6]");
            Assert.GreaterOrEqual(outIdx.Count, 6);
            float minY = float.MaxValue, maxY = float.MinValue;
            for (int i = 0; i < outPos.Count; i++) {
                minY = Mathf.Min(minY, outPos[i].y);
                maxY = Mathf.Max(maxY, outPos[i].y);
                Assert.IsFalse(float.IsNaN(outUv[i].x) || float.IsNaN(outUv[i].y));
                Assert.IsFalse(float.IsNaN(outCol[i].r));
            }
            Assert.AreEqual(2f, minY, 1e-4f, "Clipped vertices stay >= minY");
            Assert.AreEqual(6f, maxY, 1e-4f, "Clipped vertices stay <= maxY");

            // Verify every output triangle retains positive winding alignment with original triangle normal.
            Vector3 srcCross = Vector3.Cross(quad.vertices[1] - quad.vertices[0], quad.vertices[2] - quad.vertices[0]).normalized;
            for (int t = 0; t + 2 < outIdx.Count; t += 3) {
                var a = outPos[outIdx[t]];
                var b = outPos[outIdx[t + 1]];
                var c = outPos[outIdx[t + 2]];
                var triCross = Vector3.Cross(b - a, c - a);
                Assert.Greater(Vector3.Dot(triCross.normalized, srcCross), 0.99f, "Clipped triangle preserves winding");
            }
        }

        [Test]
        public void GraphicsSettingsPersistInPlayerPrefsFallbackOnCorruptHandleErrorsSelectTierHysteresisAndTeardownFsr() {
            const string ProfileKey = "metro.graphics.model-detail";
            const string UpscalingKey = "metro.graphics.upscaling";
            bool hadProfile = PlayerPrefs.HasKey(ProfileKey);
            string savedProfile = hadProfile ? PlayerPrefs.GetString(ProfileKey) : null;
            bool hadUpscaling = PlayerPrefs.HasKey(UpscalingKey);
            string savedUpscaling = hadUpscaling ? PlayerPrefs.GetString(UpscalingKey) : null;

            var ctor = typeof(StationGraphicsSettings).GetConstructor(
                BindingFlags.Instance | BindingFlags.NonPublic, null, Type.EmptyTypes, null);
            var selectTier = typeof(StationGraphicsSettings).GetMethod(
                "SelectTier", BindingFlags.Static | BindingFlags.NonPublic);
            Assert.IsNotNull(ctor);
            Assert.IsNotNull(selectTier);

            var testCam = CreateTestCamera("FsrTeardownCam");
            var dummyRt = Track(new RenderTexture(64, 64, 16));
            try {
                // 1. Missing prefs fall back to default profile ("high") and "native" upscaling.
                PlayerPrefs.DeleteKey(ProfileKey);
                PlayerPrefs.DeleteKey(UpscalingKey);
                var fresh = (StationGraphicsSettings)ctor.Invoke(null);
                var getPayload = new JObject();
                Assert.IsTrue(fresh.TryHandle(new StationCommand { Type = "graphics.get", Payload = getPayload }, getPayload, out _, out _));
                Assert.AreEqual("native", (string)getPayload["upscaling"]);
                Assert.IsTrue((string)getPayload["profile"] == "high" || (string)getPayload["profile"] == "balanced" || (string)getPayload["profile"] == "low");

                // 2. Corrupt PlayerPrefs values fall back cleanly to "high" and "native".
                PlayerPrefs.SetString(ProfileKey, "corrupt-profile");
                PlayerPrefs.SetString(UpscalingKey, "corrupt-fsr");
                var recovered = (StationGraphicsSettings)ctor.Invoke(null);
                var recoveredPayload = recovered.BuildPayload(null, null);
                Assert.AreEqual("high", (string)recoveredPayload["profile"], "Corrupt profile falls back to high");
                Assert.AreEqual("native", (string)recoveredPayload["upscaling"], "Corrupt upscaling falls back to native");

                // 3. Persistence across fresh instances via graphics.set.
                var setReq = new JObject { ["profile"] = "balanced", ["upscaling"] = "quality" };
                Assert.IsTrue(recovered.TryHandle(new StationCommand { Type = "graphics.set", Payload = setReq }, setReq, out var code, out _), code);
                var reloaded = (StationGraphicsSettings)ctor.Invoke(null);
                var reloadedPayload = reloaded.BuildPayload(null, null);
                Assert.AreEqual("balanced", (string)reloadedPayload["profile"], "Profile persists in PlayerPrefs");
                Assert.AreEqual("quality", (string)reloadedPayload["upscaling"], "Upscaling persists in PlayerPrefs");

                // 4. Empty or invalid profile refused with "invalid-graphics-profile".
                var emptyReq = new JObject();
                Assert.IsFalse(reloaded.TryHandle(new StationCommand { Type = "graphics.set", Payload = emptyReq }, emptyReq, out code, out _));
                Assert.AreEqual("invalid-graphics-profile", code);
                var badProfile = new JObject { ["profile"] = "ultra-mega" };
                Assert.IsFalse(reloaded.TryHandle(new StationCommand { Type = "graphics.set", Payload = badProfile }, badProfile, out code, out _));
                Assert.AreEqual("invalid-graphics-profile", code);

                // 5. SelectTier hysteresis around FullThreshold (with "high" profile so bias == 1, min == 0).
                var highReq = new JObject { ["profile"] = "high", ["upscaling"] = "native" };
                Assert.IsTrue(reloaded.TryHandle(new StationCommand { Type = "graphics.set", Payload = highReq }, highReq, out _, out _));
                float fullThreshold = (float)typeof(StationGraphicsSettings).GetProperty("FullThreshold", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
                float hysteresis = (float)typeof(StationGraphicsSettings).GetProperty("Hysteresis", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
                float insideBand = fullThreshold * (1f - hysteresis * 0.5f);
                int fromTier0 = (int)selectTier.Invoke(null, new object[] { insideBand, 0, 3, false });
                int fromTier1 = (int)selectTier.Invoke(null, new object[] { insideBand, 1, 3, false });
                Assert.AreEqual(0, fromTier0, "Hysteresis holds tier 0 slightly below FullThreshold");
                Assert.AreEqual(1, fromTier1, "Hysteresis holds tier 1 until clearly above FullThreshold");

                // 6. FSR teardown clears activeCamera.targetTexture cleanly.
                var activeCamField = typeof(StationFsrUpscaler).GetField("activeCamera", BindingFlags.Static | BindingFlags.NonPublic);
                Assert.IsNotNull(activeCamField);
                testCam.targetTexture = dummyRt;
                activeCamField.SetValue(null, testCam);
                StationFsrUpscaler.ReleaseResources();
                Assert.IsNull(testCam.targetTexture, "StationFsrUpscaler.ReleaseResources clears camera.targetTexture");
            } finally {
                testCam.targetTexture = null;
                if (hadProfile) PlayerPrefs.SetString(ProfileKey, savedProfile); else PlayerPrefs.DeleteKey(ProfileKey);
                if (hadUpscaling) PlayerPrefs.SetString(UpscalingKey, savedUpscaling); else PlayerPrefs.DeleteKey(UpscalingKey);
                PlayerPrefs.Save();
                ((StationGraphicsSettings)ctor.Invoke(null)).BuildPayload(null, null);
                StationFsrUpscaler.ReleaseResources();
            }
        }
    }
}
