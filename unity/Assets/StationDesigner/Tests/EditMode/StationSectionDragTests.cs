using System.Linq;
using Metro.App;
using Metro.View;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.EditModeTests {
    /// <summary>
    /// 20 §6 — the 剖切 surface is **draggable**.
    ///
    /// The port of `section-drag.test.mjs`: the cut slides only along the direction it looks, the
    /// pointer's travel is measured on screen against an axis frozen at the press, the step snaps
    /// to half a metre (5 cm with Shift) with the source's rounding, and a cut sliding straight at
    /// the camera refuses the grab instead of dividing by nothing. The arrow's own pick proxy is
    /// pinned as a bounded analytic hit, not a collider.
    /// </summary>
    public sealed class StationSectionDragTests {
        GameObject root;
        StationSectionView view;
        Camera camera;

        [SetUp]
        public void SetUp() {
            root = new GameObject("section test");
            view = root.AddComponent<StationSectionView>();
            var cameraObject = new GameObject("section test camera");
            cameraObject.transform.SetParent(root.transform, false);
            camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = false;
            camera.fieldOfView = 45f;
            camera.nearClipPlane = .5f;
            camera.farClipPlane = 2000f;
            camera.enabled = false;
        }

        [TearDown]
        public void TearDown() {
            if (root) Object.DestroyImmediate(root);
            root = null;
            view = null;
            camera = null;
            StationSectionDrag.Reset();
        }

        /// <summary>The station's own plan, in **document** axes (the view stores it that way).</summary>
        static Bounds StationBounds => new Bounds(new Vector3(0f, 0f, -8f), new Vector3(60f, 40f, 20f));

        [TestCase("Metro/Station Finish")]
        [TestCase("Universal Render Pipeline/Lit")]
        [TestCase("Universal Render Pipeline/Unlit")]
        [TestCase("Sidewalk.prefab")]
        [TestCase("TactileWarningStrip.prefab")]
        public void AStraddlingSlabMovesItsRenderedCutWithThePlane(string shaderName) {
            if (SystemInfo.graphicsDeviceType == GraphicsDeviceType.Null) Assert.Ignore("Requires a graphics device.");
            var centre = new Vector3(500f, 300f, 500f);
            camera.transform.position = centre + Vector3.up * 8f;
            camera.transform.rotation = Quaternion.LookRotation(Vector3.down, Vector3.forward);
            camera.orthographic = true;
            camera.orthographicSize = 2f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Color.blue;
            camera.farClipPlane = 12f;
            var slab = GameObject.CreatePrimitive(PrimitiveType.Cube);
            slab.transform.SetParent(root.transform);
            slab.transform.position = centre;
            slab.transform.localScale = new Vector3(2.5f, .2f, 3f);
            bool paving = shaderName.EndsWith(".prefab", System.StringComparison.Ordinal);
            Material material;
            if (paving) {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/StationDesigner/Generated/Prefabs/" + shaderName);
                Assert.IsNotNull(prefab);
                material = new Material(prefab.GetComponentInChildren<MeshRenderer>(true).sharedMaterial);
                material.name = prefab.GetComponentInChildren<MeshRenderer>(true).sharedMaterial.name;
            } else {
                var shader = Shader.Find(shaderName);
                Assert.IsNotNull(shader, shaderName);
                material = new Material(shader);
            }
            if (shaderName == "Universal Render Pipeline/Lit") {
                material.SetColor("_EmissionColor", Color.white);
                material.EnableKeyword("_EMISSION");
            }
            var renderer = slab.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            using var visibility = new StationVisibilityRegistry();
            visibility.Register(slab.transform, paving ? StationPartRole.Surface : StationPartRole.Ground, new[] { 0 });
            visibility.State.Cutaway = true;
            visibility.Section = StationSectionPlane.Default.WithAnchor(StationCameraSpace.ToDocument(centre));
            var outward = StationCameraSpace.ToWorld(visibility.Section.Normal);
            var image = new RenderTexture(64, 64, 24);
            var pixels = new Texture2D(64, 64, TextureFormat.RGBA32, false);
            var request = new RenderPipeline.StandardRequest { destination = image };
            Assert.IsTrue(RenderPipeline.SupportsRenderRequest(camera, request), "The station camera needs a render pipeline.");
            RenderTexture previous = RenderTexture.active;
            bool asyncCompilation = ShaderUtil.allowAsyncCompilation;
            try {
                ShaderUtil.allowAsyncCompilation = false;
                void Render() {
                    visibility.Apply();
                    RenderPipeline.SubmitRenderRequest(camera, request);
                    RenderTexture.active = image;
                    pixels.ReadPixels(new Rect(0, 0, 64, 64), 0, 0);
                }
                Color Pixel(float metres) {
                    var viewport = camera.WorldToViewportPoint(centre + outward * metres);
                    return pixels.GetPixel((int)(viewport.x * 64), (int)(viewport.y * 64));
                }
                bool IsBackground(float metres) {
                    var pixel = Pixel(metres);
                    return pixel.r < .1f && pixel.g < .1f && pixel.b > .9f;
                }
                void AssertSurface(float metres, string message) {
                    var pixel = Pixel(metres);
                    Assert.IsFalse(IsBackground(metres), message + " (" + pixel + ")");
                    Assert.IsFalse(pixel.r > .9f && pixel.g < .1f && pixel.b > .9f, "Shader error at " + metres);
                }

                Render();
                AssertSurface(-.75f, "the uncut slab reaches the kept side");
                AssertSurface(.75f, "the uncut slab reaches the cut-away side");

                visibility.SectionClipping = true;
                Render();
                Assert.IsTrue(visibility.SectionShaderSupported);
                if (paving)
                    Assert.AreEqual(shaderName == "Sidewalk.prefab" ? 1f : 0f, renderer.sharedMaterial.GetFloat("_VertexColorWeight"));
                AssertSurface(-.75f, "the kept half remains visible");
                Assert.IsTrue(IsBackground(.75f), "the cut-away half exposes the background");

                visibility.Section = visibility.Section.WithOffset(1f);
                Render();
                AssertSurface(.75f, "dragging the plane reveals the newly kept strip");
                Assert.IsTrue(IsBackground(1.25f), "the rest of the same slab is still clipped");

                visibility.SectionClipping = false;
                Render();
                AssertSurface(1.25f, "turning section view off restores the slab");
                Assert.AreSame(material, renderer.sharedMaterial);
            } finally {
                ShaderUtil.allowAsyncCompilation = asyncCompilation;
                RenderTexture.active = previous;
                Object.DestroyImmediate(pixels);
                Object.DestroyImmediate(image);
                Object.DestroyImmediate(material);
            }
        }

        /// <summary>Put the camera isometric and give the section a station-sized bounds.</summary>
        void Isometric() {
            var target = StationCameraSpace.ToWorld(StationBounds.center);
            camera.transform.position = target + new Vector3(1f, .85f, -1.2f).normalized * 120f;
            camera.transform.LookAt(target);
            view.Apply(StationSectionPlane.Default, true, true, StationBounds);
        }

        [Test]
        public void TheSectionGridHasTwoMetreSpacingAndNoFilledQuad() {
            Isometric();
            var grid = GameObject.Find("Section hatch").GetComponent<MeshFilter>();
            Assert.IsNull(grid.transform.parent.Find("Section sheet"));
            var vertices = grid.sharedMesh.vertices;
            // Four border segments precede the first pair of grid lines.
            var first = grid.transform.TransformPoint(vertices[8]);
            var next = grid.transform.TransformPoint(vertices[12]);
            Assert.AreEqual(2f, Vector3.Distance(first, next), 1e-4f);
            Assert.AreEqual(2f * view.Size,
                Vector3.Distance(grid.transform.TransformPoint(vertices[0]), grid.transform.TransformPoint(vertices[1])), 1e-4f);
        }

        /// <summary>
        /// `snapOffset` with `Math.round`'s ties: half a metre, five centimetres while Shift is
        /// held, and both signs — the negative half tie is the case a banker's rounding gets wrong.
        /// </summary>
        [Test]
        public void TheStepSnapsToTheCoarseAndFineGridsWithTheSourceRounding() {
            Assert.AreEqual(.5f, StationSectionDrag.SnapOffset(.26f, false), 1e-5f);
            Assert.AreEqual(0f, StationSectionDrag.SnapOffset(.24f, false), 1e-5f);
            Assert.AreEqual(1.5f, StationSectionDrag.SnapOffset(1.26f, false), 1e-5f);
            Assert.AreEqual(-.5f, StationSectionDrag.SnapOffset(-.26f, false), 1e-5f);
            // A negative half tie rounds **up** in JavaScript, so it lands on the nearer zero.
            Assert.AreEqual(0f, StationSectionDrag.SnapOffset(-.25f, false), 1e-5f);
            Assert.AreEqual(-.05f, StationSectionDrag.SnapOffset(-.075f, true), 1e-5f);
            Assert.AreEqual(.05f, StationSectionDrag.SnapOffset(.03f, true), 1e-5f);
            Assert.AreEqual(-.15f, StationSectionDrag.SnapOffset(-.13f, true), 1e-5f);
            Assert.AreEqual(0f, StationSectionDrag.SnapOffset(-.025f, true), 1e-5f);
            Assert.AreEqual(0f, StationSectionDrag.SnapOffset(0f, false));
            // The fine step is the source's own 0.05 m.
            Assert.AreEqual(.05f, StationSectionDrag.SnapFine);
            Assert.AreEqual(.5f, StationSectionDrag.Snap);
        }

        /// <summary>
        /// A drag is measured along the frozen axis only: pushing the way the cut slides asks for
        /// exactly the metres walked, pushing across it asks for nothing, and pulling back is
        /// relative to where the grab started.
        /// </summary>
        [Test]
        public void ADragAlongTheAxisSlidesTheCutAndADragAcrossItDoesNothing() {
            var axis = new Vector2(.6f, .8f);
            foreach (float span in new[] { 10f, 40f, 133f }) {
                foreach (float metres in new[] { 2f, -.5f }) {
                    float walked = span * metres;
                    var along = new Vector2(axis.x * walked, axis.y * walked);
                    Assert.AreEqual(metres,
                        StationSectionDrag.DragOffset(0f, Vector2.Dot(along, axis), span), 1e-4f,
                        metres + " m along the axis at " + span + " px/m");
                    var across = new Vector2(-axis.y * walked, axis.x * walked);
                    Assert.AreEqual(0f,
                        StationSectionDrag.DragOffset(0f, Vector2.Dot(across, axis), span), 1e-4f,
                        "a sideways push moves the cut nowhere");
                    // Relative to the grab: +1 m pulled back 2 m lands on −1 m.
                    Assert.AreEqual(-1f,
                        StationSectionDrag.DragOffset(1f, -2f * span, span), 1e-4f);
                }
            }
            // A cut sliding straight at the camera has no span; the grab leaves it where it was.
            Assert.AreEqual(2.5f, StationSectionDrag.DragOffset(2.5f, 400f, 0f));
            Assert.AreEqual(2.5f, StationSectionDrag.DragOffset(2.5f, 400f, -1f));
        }

        /// <summary>
        /// `SceneRenderer.sectionDragAxis`: the cut's slide direction as it appears on screen is a
        /// unit vector at every quarter turn, and a cut looking away from its twin is its opposite.
        /// </summary>
        [Test]
        public void TheProjectedAxisIsAUnitLineAtEveryQuarterTurn() {
            Isometric();
            foreach (float azimuth in new[] { 0f, 90f, 180f, 270f }) {
                view.Apply(StationSectionPlane.Default.WithAzimuth(azimuth), true, true, StationBounds);
                Assert.IsTrue(StationSectionDrag.TryAxis(camera, view, out var axis, out float span),
                    "the axis is defined at " + azimuth + "°");
                Assert.Greater(span, .01f, "one metre of the cut is a real distance on screen at " + azimuth + "°");
                Assert.AreEqual(1f, axis.magnitude, 1e-4f, "the axis is a unit vector at " + azimuth + "°");
            }
            // North and south are the same line, opposite ways. Both are measured from the **same**
            // bounds: a different origin would change the perspective foreshortening, not the rule.
            view.Apply(StationSectionPlane.Default.WithAzimuth(0f), true, true, StationBounds);
            Assert.IsTrue(StationSectionDrag.TryAxis(camera, view, out var north, out float northSpan));
            view.Apply(StationSectionPlane.Default.WithAzimuth(180f), true, true, StationBounds);
            Assert.IsTrue(StationSectionDrag.TryAxis(camera, view, out var south, out float southSpan));
            Assert.AreEqual(-1f, Vector2.Dot(north, south), 1e-4f, "north and south are opposite on screen");
            // The oracle pins the axis, not the span: perspective makes the two magnitudes differ
            // by a few percent at an oblique camera, which is not a rule the drag depends on.
            Assert.Greater(northSpan, .01f);
            Assert.Greater(southSpan, .01f);
        }

        /// <summary>
        /// A camera looking straight down the cut's own normal has no screen line to drag along; the
        /// grab is refused rather than left to divide by nothing, and it says why.
        /// </summary>
        [Test]
        public void ACutSlidingStraightAtTheCameraCannotBeDraggedAndSaysSo() {
            var target = StationCameraSpace.ToWorld(StationBounds.center);
            var normal = StationCameraSpace.ToWorld(StationSectionPlane.Default.Normal);
            camera.transform.position = target - normal * 120f;
            camera.transform.LookAt(target);
            view.Apply(StationSectionPlane.Default, true, true, StationBounds);
            bool ok = StationSectionDrag.TryAxis(camera, view, out var axis, out float span);
            Assert.IsFalse(ok, "a cut sliding straight at the camera has no axis (span " + span + ")");
            Assert.AreEqual(0f, span);
            Assert.AreEqual(Vector2.zero, axis);
        }

        /// <summary>
        /// The arrow's pick proxy is a **bounded analytic** hit on the drawn mark: a ray along the
        /// shaft grabs it, one well outside misses, and the sheet remains its own grab target. The
        /// proxy follows the drawn length, so it stays a mark rather than a monument.
        /// </summary>
        [Test]
        public void TheArrowAnswersABoundedAnalyticHit() {
            Isometric();
            Assert.IsTrue(view.Clipping);
            Assert.IsTrue(view.ArrowVisible, "the arrow is drawn while the cut and sheet are visible");
            // The arrow's length is `max(3, size * .22)`, its head 40 % and its radii the source's.
            Assert.GreaterOrEqual(view.ArrowLength, 3f);
            Assert.AreEqual(view.ArrowLength * .4f, view.ArrowHeadLength, 1e-4f);
            Assert.AreEqual(view.ArrowLength * .022f, view.ArrowShaftRadius, 1e-4f);
            Assert.AreEqual(view.ArrowLength * .09f, view.ArrowHeadRadius, 1e-4f);
            // A ray aimed at the middle of the shaft, from the side the sheet is read from.
            var forward = StationCameraSpace.ToWorld(view.Plane.Point);
            var normal = StationCameraSpace.ToWorld(view.Plane.Normal);
            var up = StationCameraSpace.ToWorld(view.Plane.Up);
            var right = StationCameraSpace.ToWorld(view.Plane.Right);
            var midShaft = forward - normal * (view.ArrowLength * .3f);
            var from = midShaft + normal * 20f + up * 2f;
            var ray = new Ray(from, (midShaft - from).normalized);
            Assert.IsTrue(view.TryControlHit(ray, out var part, out float distance),
                "a ray onto the drawn shaft grabs the arrow");
            StringAssert.StartsWith("arrow", part);
            Assert.Greater(distance, 0f);
            Assert.Less(distance, 25f, "the hit lies on the drawn mark");
            var oldShaft = forward + normal * (view.ArrowLength * .3f);
            Assert.IsFalse(view.TryControlHit(new Ray(oldShaft + up * 20f, -up), out _, out _),
                "the cut-away side has no arrow hit");
            // A ray two metres to the side of the mark misses it.
            var away = midShaft + right * 2.5f;
            var miss = new Ray(away + normal * 20f, (away - (away + normal * 20f)).normalized);
            Assert.IsFalse(view.TryControlHit(miss, out _, out _), "the proxy is bounded, not the whole plane");
            // Hover and press share one hit; the sheet is the other control.
            Assert.IsTrue(view.TrySectionControl(ray, out var control, out _, out _));
            Assert.AreEqual(part, control);
            var sheetPoint = forward + right * (view.Size * .5f);
            var sheetFrom = sheetPoint + normal * 30f;
            Assert.IsTrue(view.TrySectionControl(new Ray(sheetFrom, (sheetPoint - sheetFrom).normalized),
                out var sheetPart, out _, out _), "the drawn sheet is a grab target too");
            Assert.AreEqual("sheet", sheetPart);
        }

        /// <summary>The arrow is only drawn while the cut and the sheet are visible (隐藏剖切面).</summary>
        [Test]
        public void HidingTheSheetPutsTheArrowAwayWithIt() {
            Isometric();
            Assert.IsTrue(view.ArrowVisible);
            view.Apply(StationSectionPlane.Default, true, false, StationBounds);
            Assert.IsFalse(view.ArrowVisible, "隐藏剖切面 puts the arrow and sheet away");
            var forward = StationCameraSpace.ToWorld(view.Plane.Point);
            var normal = StationCameraSpace.ToWorld(view.Plane.Normal);
            var from = forward + normal * 20f;
            Assert.IsFalse(view.TryControlHit(new Ray(from, -normal), out _, out _),
                "a hidden storey's arrow cannot be grabbed");
            Assert.IsTrue(view.Clipping, "the cut keeps cutting while the sheet is away");
        }
    }
}
