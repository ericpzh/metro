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
