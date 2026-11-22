using Metro.App;
using Metro.App.Views;
using Metro.View;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering;

// Plan 13 §2 — the light rig, the finish shader and generated glass.
//
// These three are the inputs that made the Unity frame read ~1.8× brighter and flatter
// than Three: the scene lit by one directional + flat ambient instead of the source's
// key/fill/hemisphere/ambient rig, finish materials drawn by URP/Lit (which ignores the
// mesher's vertex AO), and generated glass built as opaque Lit materials. Each test pins
// the number or the URP surface setting the fix depends on, so a regression is named.
public class StationRenderTests {
    /* ------------------------------------------------------------- the light rig */

    [Test]
    public void TheRigMatchesTheSourceKeyAndFill() {
        var camera = new GameObject("rig camera", typeof(Camera)).GetComponent<Camera>();
        var saved = Snapshot();
        try {
            StationRenderRig.Apply(camera);

            Assert.AreEqual(CameraClearFlags.SolidColor, camera.clearFlags, "the station clears to the void colour");
            Assert.AreEqual(StationRenderRig.VoidColor.r, camera.backgroundColor.r, 1e-4f);
            Assert.AreEqual(StationRenderRig.VoidColor.g, camera.backgroundColor.g, 1e-4f);

            var key = Find(StationRenderRig.KeyLightName);
            var fill = Find(StationRenderRig.FillLightName);
            Assert.IsNotNull(key, "the source's key light must exist");
            Assert.IsNotNull(fill, "the source's fill light must exist");
            // Three divides diffuse by pi and URP does not, so the intensities are /pi.
            Assert.AreEqual(1.5f / Mathf.PI, key.intensity, 1e-4f, "key intensity is the source 1.5 / pi");
            Assert.AreEqual(0.45f / Mathf.PI, fill.intensity, 1e-4f, "fill intensity is the source 0.45 / pi");
            Assert.AreEqual(LightShadows.None, key.shadows, "the source renders no shadow maps");
            Assert.AreEqual(LightShadows.None, fill.shadows);
            AssertVector(new Vector3(-0.3841f, -0.7682f, 0.5122f), key.transform.forward, "key direction");
            AssertVector(new Vector3(0.6965f, -0.3980f, -0.5970f), fill.transform.forward, "fill direction");
            Assert.AreSame(key, RenderSettings.sun, "the key is the pipeline's main light");

            // No environment map in the source.
            Assert.AreEqual(0f, RenderSettings.reflectionIntensity, 1e-4f, "no environment reflections");
            // Linear fog 120…320 m in the void colour.
            Assert.IsTrue(RenderSettings.fog, "the source's linear fog must be on");
            Assert.AreEqual(FogMode.Linear, RenderSettings.fogMode);
            Assert.AreEqual(StationRenderRig.FogStart, RenderSettings.fogStartDistance, 1e-3f);
            Assert.AreEqual(StationRenderRig.FogEnd, RenderSettings.fogEndDistance, 1e-3f);
            Assert.AreEqual(StationRenderRig.VoidColor.linear.g, RenderSettings.fogColor.g, 1e-4f);
        } finally {
            Restore(saved);
            Object.DestroyImmediate(camera.gameObject);
            foreach (var light in new[] { Find(StationRenderRig.KeyLightName), Find(StationRenderRig.FillLightName) }) {
                if (light) Object.DestroyImmediate(light.gameObject);
            }
        }
    }

    [Test]
    public void TheRigUsesHemisphereAmbientAndTheStudioVoidForTheLightTheme() {
        var camera = new GameObject("rig camera", typeof(Camera)).GetComponent<Camera>();
        var saved = Snapshot();
        try {
            StationRenderRig.Apply(camera);
            Assert.AreEqual(AmbientMode.Trilight, RenderSettings.ambientMode, "sky/equator/ground ambient, not a flat colour");
            Assert.AreEqual(StationRenderRig.AmbientSky.r, RenderSettings.ambientSkyColor.r, 1e-4f);
            Assert.AreEqual(StationRenderRig.AmbientGround.b, RenderSettings.ambientGroundColor.b, 1e-4f);
            Assert.Greater(RenderSettings.ambientSkyColor.g, RenderSettings.ambientGroundColor.g, "the sky is brighter than the ground");
            Assert.AreEqual(1f, RenderSettings.ambientIntensity, 1e-4f);

            // The finish shader reads these globals: flat ambient + hemisphere, divided by
            // pi because URP's diffuse BRDF has no 1/pi and Three's does.
            var flat = Shader.GetGlobalColor("_StationAmbient");
            var sky = Shader.GetGlobalColor("_StationHemiSky");
            var ground = Shader.GetGlobalColor("_StationHemiGround");
            Assert.AreEqual(0.8f / Mathf.PI, flat.g, 1e-4f, "flat ambient is the source 0.8 / pi");
            Assert.AreEqual(1.15f / Mathf.PI * 0.8072f, sky.g, 2e-3f, "hemisphere sky is the source sky colour * 1.15 / pi");
            Assert.Greater(sky.g, ground.g, "the hemisphere's sky is brighter than its ground");

            StationRenderRig.Apply(camera, "studio");
            Assert.AreEqual(StationRenderRig.StudioVoidColor.r, camera.backgroundColor.r, 1e-4f, "the studio theme clears to paper");
        } finally {
            Restore(saved);
            Object.DestroyImmediate(camera.gameObject);
            foreach (var light in new[] { Find(StationRenderRig.KeyLightName), Find(StationRenderRig.FillLightName) }) {
                if (light) Object.DestroyImmediate(light.gameObject);
            }
        }
    }

    /* ------------------------------------------------------------ the finish shader */

    [Test]
    public void TheFinishLibraryDrawsWithTheStationShaderAndKeepsTheAlbedo() {
        var shader = StationFinishLibrary.FindShader();
        Assert.IsNotNull(shader, "the station finish shader must resolve");
        Assert.AreEqual(StationFinishLibrary.StationShaderName, shader.name,
            "finishes draw with the vertex-AO shader, not URP/Lit (which ignores mesh colours)");
        var library = StationFinishLibrary.LoadFromResources("StationFinishes", shader);
        try {
            var material = library.For("floor.concrete");
            Assert.AreSame(shader, material.shader);
            Assert.IsNotNull(material.GetTexture("_BaseMap"), "the albedo map is bound");
            Assert.IsTrue(material.IsKeywordEnabled("_ENVIRONMENTREFLECTIONS_OFF"),
                "the source has no environment map");
            Assert.AreEqual(1f - library.Facts("floor.concrete").Roughness,
                material.GetFloat("_Smoothness"), 1e-3f, "roughness maps to 1 - smoothness");
        } finally {
            library.Dispose();
        }
    }

    /* ------------------------------------------------------------------- the glass */

    [Test]
    public void GeneratedGlassIsATransparentSurfaceNotAnOpaquePanel() {
        var shader = Shader.Find(StationFinishLibrary.DefaultShaderName);
        Assert.IsNotNull(shader);
        var glass = StationGlass.Create(shader, "test glass", new Color32(168, 216, 230, 255), .26f);
        try {
            Assert.AreEqual(1f, glass.GetFloat("_Surface"), "URP surface type must be Transparent");
            Assert.AreEqual((float)BlendMode.SrcAlpha, glass.GetFloat("_SrcBlend"));
            Assert.AreEqual((float)BlendMode.OneMinusSrcAlpha, glass.GetFloat("_DstBlend"));
            Assert.AreEqual(0f, glass.GetFloat("_ZWrite"), "glass must not write depth");
            Assert.AreEqual(StationGlass.TransparentQueue, glass.renderQueue);
            Assert.IsTrue(glass.IsKeywordEnabled("_SURFACE_TYPE_TRANSPARENT"),
                "without the keyword URP forces output alpha 1 and the pane is opaque again");
            Assert.AreEqual(.26f, glass.GetColor("_BaseColor").a, 1e-4f);
            Assert.AreEqual("Transparent", glass.GetTag("RenderType", false));
        } finally {
            Object.DestroyImmediate(glass);
        }
    }

    [Test]
    public void SerializedGlassReferenceKeepsUrpTransparentVariantAndLiftGlassUsesSkyTint() {
        var refMat = Resources.Load<Material>(StationGlass.RefResourcePath);
        Assert.IsNotNull(refMat, "Resources/" + StationGlass.RefResourcePath + ".mat must exist so player builds keep _SURFACE_TYPE_TRANSPARENT");
        Assert.AreEqual("Universal Render Pipeline/Lit", refMat.shader.name);
        Assert.IsTrue(refMat.IsKeywordEnabled("_SURFACE_TYPE_TRANSPARENT"),
            "serialized reference material must enable _SURFACE_TYPE_TRANSPARENT");
        Assert.AreEqual(1f, refMat.GetFloat("_Surface"));
        Assert.AreEqual(StationGlass.TransparentQueue, refMat.renderQueue);

        var liftGlass = Metro.App.Views.VerticalModuleViews.DefaultMaterial(Metro.App.Views.VerticalModuleViews.PaletteGlass);
        Assert.IsTrue(StationGlass.IsTransparent(liftGlass), "lift shaft glass must use the transparent surface");
        Assert.IsTrue(liftGlass.IsKeywordEnabled("_SURFACE_TYPE_TRANSPARENT"));
        var baseColor = liftGlass.GetColor("_BaseColor");
        var expected = ((Color)StationGlass.DefaultTint).linear;
        Assert.AreEqual(expected.r, baseColor.r, 0.02f, "lift glass must use the light sky tint, not dark teal");
        Assert.AreEqual(expected.g, baseColor.g, 0.02f);
        Assert.AreEqual(expected.b, baseColor.b, 0.02f);
        Assert.AreEqual(.26f, baseColor.a, 1e-4f);
    }

    [Test]
    public void TheGhostOfGlassFadesFromItsOwnOpacityAndKeepsAlphaCutout() {
        var shader = Shader.Find(StationFinishLibrary.DefaultShaderName);
        Assert.IsNotNull(shader);
        var palette = new StationVisibilityPalette(shader);
        var glass = StationGlass.Create(shader, "test glass", new Color32(168, 216, 230, 255), .4f);
        var foliage = new Material(shader) { name = "test foliage" };
        foliage.EnableKeyword("_ALPHATEST_ON");
        foliage.SetFloat("_Cutoff", .5f);
        try {
            var ghost = palette.Ghost(glass);
            Assert.Less(ghost.GetColor("_BaseColor").a, .4f,
                "a ghost of a .4 pane must be fainter, never more opaque than the solid one");
            Assert.AreEqual(1f, ghost.GetFloat("_Surface"));

            var cutout = palette.Ghost(foliage);
            Assert.IsTrue(cutout.IsKeywordEnabled("_ALPHATEST_ON"),
                "ghosting must not turn an alpha-cutout leaf into a solid transparent card");
            Assert.AreEqual(.5f, cutout.GetFloat("_Cutoff"), 1e-4f);
        } finally {
            palette.Dispose();
            Object.DestroyImmediate(glass);
            Object.DestroyImmediate(foliage);
        }
    }

    /* ---------------------------------------------------------- the Hide UI skybox */

    [Test]
    public void SkyIntensityFollowsSimulationTimeOfDayAndRepeatsDaily() {
        const double h = 3600.0;
        const double day = StationSkySystem.SimDaySeconds;

        Assert.AreEqual(StationSkySystem.MinSkyIntensity, StationSkySystem.SkyIntensity(2 * h), 1e-6f);
        Assert.AreEqual(StationSkySystem.MinSkyIntensity, StationSkySystem.SkyIntensity(23 * h), 1e-6f);

        Assert.AreEqual(StationSkySystem.MinSkyIntensity, StationSkySystem.SkyIntensity(5 * h), 1e-6f);
        Assert.Less(StationSkySystem.SkyIntensity(5 * h), StationSkySystem.SkyIntensity(6 * h));
        Assert.Less(StationSkySystem.SkyIntensity(6 * h), StationSkySystem.SkyIntensity(7 * h));
        Assert.AreEqual(StationSkySystem.MaxSkyIntensity, StationSkySystem.SkyIntensity(7 * h), 1e-6f);
        Assert.AreEqual(StationSkySystem.MaxSkyIntensity, StationSkySystem.SkyIntensity(12 * h), 1e-6f);
        Assert.AreEqual(StationSkySystem.MaxSkyIntensity, StationSkySystem.SkyIntensity(17 * h), 1e-6f);
        Assert.Greater(StationSkySystem.SkyIntensity(17 * h), StationSkySystem.SkyIntensity(18 * h));
        Assert.Greater(StationSkySystem.SkyIntensity(18 * h), StationSkySystem.SkyIntensity(19 * h));
        Assert.AreEqual(StationSkySystem.MinSkyIntensity, StationSkySystem.SkyIntensity(19 * h), 1e-6f);

        // Repeats with the simulation's day, across multi-day and negative seeks, with no midnight jump.
        Assert.AreEqual(StationSkySystem.SkyIntensity(6.5 * h), StationSkySystem.SkyIntensity(6.5 * h + day), 1e-6f);
        Assert.AreEqual(StationSkySystem.SkyIntensity(18 * h), StationSkySystem.SkyIntensity(18 * h + 8 * day), 1e-6f);
        Assert.AreEqual(StationSkySystem.SkyIntensity(12 * h), StationSkySystem.SkyIntensity(12 * h - 3 * day), 1e-6f);
        Assert.AreEqual(StationSkySystem.SkyIntensity(day - 1), StationSkySystem.SkyIntensity(day), 1e-6f);
    }

    [Test]
    public void HideUiSwitchesBetweenVoidClearAndCloudSkyboxWithMatchingHorizonFog() {
        var camGo = new GameObject("sky test camera", typeof(Camera));
        var camera = camGo.GetComponent<Camera>();
        var rigGo = new GameObject("sky test rig");
        var rig = rigGo.AddComponent<StationViewRig>();
        // Odd dimensions place pixel (32, 32) at exact optical-axis NDC (0, 0).
        var rt = new RenderTexture(65, 65, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
        var readback = new Texture2D(65, 65, TextureFormat.RGBA32, false);
        var saved = Snapshot();
        try {
            StationRenderRig.Apply(camera);
            rig.SetSimTime(12 * 3600.0);
            rig.Configure(camera, new Bounds(Vector3.zero, new Vector3(40f, 40f, 15f)),
                StationLevelGrid.FromDocument(0, 5, new[] { -10, -5, 0 }), -10);

            // Normal editor mode: solid void clear and void linear fog.
            Assert.AreEqual(CameraClearFlags.SolidColor, camera.clearFlags);
            Assert.AreEqual(StationRenderRig.VoidColor.r, camera.backgroundColor.r, 1e-4f);
            Assert.AreEqual(StationRenderRig.VoidColor.linear.g, RenderSettings.fogColor.g, 1e-4f);
            Assert.IsFalse(rig.Sky.Shown);

            // Enable Hide UI at noon (intensity = 1.0).
            Assert.IsTrue(rig.Execute("{\"type\":\"view.set\",\"payload\":{\"key\":\"hideUi\",\"value\":true}}", out _));
            Assert.IsTrue(rig.Sky.Shown);
            Assert.AreEqual(1f, rig.Sky.AppliedIntensity, 1e-5f);
            Assert.AreEqual(CameraClearFlags.Skybox, camera.clearFlags);
            var skybox = camera.GetComponent<Skybox>();
            Assert.IsNotNull(skybox);
            Assert.IsTrue(skybox.enabled);
            Assert.IsNotNull(skybox.material);
            Assert.AreEqual(StationSkySystem.ShaderName, skybox.material.shader.name);
            Assert.IsTrue(skybox.material.shader.isSupported);
            Assert.AreEqual(0f, RenderSettings.reflectionIntensity, 1e-4f, "skybox must never leak reflections");

            // Linear fog colour at noon equals HorizonLinear * 1.0.
            var fogLinearNoon = QualitySettings.activeColorSpace == ColorSpace.Linear
                ? RenderSettings.fogColor.linear
                : RenderSettings.fogColor;
            Assert.AreEqual(StationSkySystem.HorizonLinear.r, fogLinearNoon.r, 2e-3f);
            Assert.AreEqual(StationSkySystem.HorizonLinear.g, fogLinearNoon.g, 2e-3f);
            Assert.AreEqual(StationSkySystem.HorizonLinear.b, fogLinearNoon.b, 2e-3f);

            // Render actual GPU frames looking at zenith, nadir, and horizon (perspective + orthographic).
            camera.cullingMask = 0;
            var zenithNoon = RenderCenterPixel(camera, rt, readback, Vector3.up, Vector3.forward, orthographic: false);
            AssertColor32Near(StationSkySystem.ZenithSrgb, zenithNoon, 3, "noon zenith skybox");

            var nadirNoon = RenderCenterPixel(camera, rt, readback, Vector3.down, Vector3.forward, orthographic: false);
            AssertColor32Near(StationSkySystem.BelowSrgb, nadirNoon, 3, "noon nadir skybox");

            var horizonNoon = RenderCenterPixel(camera, rt, readback, Vector3.right, Vector3.up, orthographic: false);
            AssertColor32Near(StationSkySystem.HorizonSrgb, horizonNoon, 4, "noon horizon skybox");

            var orthoHorizon = RenderCenterPixel(camera, rt, readback, Vector3.forward, Vector3.up, orthographic: true);
            AssertColor32Near(StationSkySystem.HorizonSrgb, orthoHorizon, 4, "orthographic horizon skybox");

            // Verify upper-hemisphere cloud field & GPU cubemap face alignment across azimuths.
            int minUpperRed = 255;
            int maxUpperRed = 0;
            for (int i = 0; i < 24; i++) {
                float angle = (Mathf.PI * 2f * i) / 24f;
                var upperDir = new Vector3(Mathf.Cos(angle) * 0.92f, 0.39f, Mathf.Sin(angle) * 0.92f).normalized;
                var expectedUpper = StationSkySystem.EvaluateWorldDirectionSrgb(upperDir);
                var renderedUpper = RenderCenterPixel(camera, rt, readback, upperDir, Vector3.up, orthographic: false);
                AssertColor32Near(expectedUpper, renderedUpper, 4, "upper hemisphere azimuth " + i);
                if (renderedUpper.r < minUpperRed) minUpperRed = renderedUpper.r;
                if (renderedUpper.r > maxUpperRed) maxUpperRed = renderedUpper.r;
            }
            Assert.Greater(maxUpperRed - minUpperRed, 25, "upper hemisphere must contain procedural white clouds over blue sky");

            // Seek to night (02:00 -> intensity = 0.015): sky and horizon fog dim together.
            rig.SetSimTime(2 * 3600.0);
            Assert.AreEqual(StationSkySystem.MinSkyIntensity, rig.Sky.AppliedIntensity, 1e-5f);
            var fogLinearNight = QualitySettings.activeColorSpace == ColorSpace.Linear
                ? RenderSettings.fogColor.linear
                : RenderSettings.fogColor;
            Assert.AreEqual(StationSkySystem.HorizonLinear.g * StationSkySystem.MinSkyIntensity, fogLinearNight.g, 2e-3f);
            var horizonNight = RenderCenterPixel(camera, rt, readback, Vector3.right, Vector3.up, orthographic: false);
            Assert.Less(horizonNight.g, 45, "night skybox must dim to 0.015 linear intensity");

            // Turning Hide UI off restores the solid void background and void fog.
            Assert.IsTrue(rig.Execute("{\"type\":\"view.set\",\"payload\":{\"key\":\"hideUi\",\"value\":false}}", out _));
            Assert.IsFalse(rig.Sky.Shown);
            Assert.AreEqual(CameraClearFlags.SolidColor, camera.clearFlags);
            Assert.IsFalse(skybox.enabled);
            Assert.AreEqual(StationRenderRig.VoidColor.r, camera.backgroundColor.r, 1e-4f);
            Assert.AreEqual(StationRenderRig.VoidColor.linear.g, RenderSettings.fogColor.g, 1e-4f);
        } finally {
            Restore(saved);
            rt.Release();
            Object.DestroyImmediate(rt);
            Object.DestroyImmediate(readback);
            Object.DestroyImmediate(rigGo);
            Object.DestroyImmediate(camGo);
            foreach (var light in new[] { Find(StationRenderRig.KeyLightName), Find(StationRenderRig.FillLightName) }) {
                if (light) Object.DestroyImmediate(light.gameObject);
            }
        }
    }

    static Color32 RenderCenterPixel(Camera camera, RenderTexture rt, Texture2D readback,
        Vector3 forward, Vector3 up, bool orthographic) {
        camera.orthographic = orthographic;
        camera.fieldOfView = 30f;
        camera.orthographicSize = 10f;
        camera.transform.SetPositionAndRotation(Vector3.zero, Quaternion.LookRotation(forward, up));
        var prevTarget = camera.targetTexture;
        var prevActive = RenderTexture.active;
        try {
            camera.targetTexture = rt;
            camera.Render();
            RenderTexture.active = rt;
            readback.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0, false);
            readback.Apply(false, false);
            return readback.GetPixel(rt.width / 2, rt.height / 2);
        } finally {
            camera.targetTexture = prevTarget;
            RenderTexture.active = prevActive;
        }
    }

    static void AssertColor32Near(Color32 expected, Color32 actual, int tolerance, string label) {
        Assert.LessOrEqual(Mathf.Abs(expected.r - actual.r), tolerance, label + " R (" + actual + " vs " + expected + ")");
        Assert.LessOrEqual(Mathf.Abs(expected.g - actual.g), tolerance, label + " G (" + actual + " vs " + expected + ")");
        Assert.LessOrEqual(Mathf.Abs(expected.b - actual.b), tolerance, label + " B (" + actual + " vs " + expected + ")");
    }

    /* ----------------------------------------------------------------- utilities */

    static Light Find(string name) {
        foreach (var light in Object.FindObjectsByType<Light>(FindObjectsInactive.Include)) {
            if (light.name == name) return light;
        }
        return null;
    }

    static void AssertVector(Vector3 expected, Vector3 actual, string message) {
        expected.Normalize();
        Assert.AreEqual(expected.x, actual.x, 2e-3f, message + " x");
        Assert.AreEqual(expected.y, actual.y, 2e-3f, message + " y");
        Assert.AreEqual(expected.z, actual.z, 2e-3f, message + " z");
    }

    struct RenderState {
        public AmbientMode AmbientMode;
        public Color AmbientLight, AmbientSky, AmbientEquator, AmbientGround;
        public float AmbientIntensity;
        public bool Fog;
        public FogMode FogMode;
        public Color FogColor;
        public float FogStart, FogEnd, ReflectionIntensity;
        public Light Sun;
    }

    static RenderState Snapshot() => new RenderState {
        AmbientMode = RenderSettings.ambientMode,
        AmbientLight = RenderSettings.ambientLight,
        AmbientSky = RenderSettings.ambientSkyColor,
        AmbientEquator = RenderSettings.ambientEquatorColor,
        AmbientGround = RenderSettings.ambientGroundColor,
        AmbientIntensity = RenderSettings.ambientIntensity,
        Fog = RenderSettings.fog,
        FogMode = RenderSettings.fogMode,
        FogColor = RenderSettings.fogColor,
        FogStart = RenderSettings.fogStartDistance,
        FogEnd = RenderSettings.fogEndDistance,
        ReflectionIntensity = RenderSettings.reflectionIntensity,
        Sun = RenderSettings.sun,
    };

    static void Restore(RenderState state) {
        RenderSettings.ambientMode = state.AmbientMode;
        RenderSettings.ambientLight = state.AmbientLight;
        RenderSettings.ambientSkyColor = state.AmbientSky;
        RenderSettings.ambientEquatorColor = state.AmbientEquator;
        RenderSettings.ambientGroundColor = state.AmbientGround;
        RenderSettings.ambientIntensity = state.AmbientIntensity;
        RenderSettings.fog = state.Fog;
        RenderSettings.fogMode = state.FogMode;
        RenderSettings.fogColor = state.FogColor;
        RenderSettings.fogStartDistance = state.FogStart;
        RenderSettings.fogEndDistance = state.FogEnd;
        RenderSettings.reflectionIntensity = state.ReflectionIntensity;
        RenderSettings.sun = state.Sun;
    }
}
