using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App {
    /// <summary>
    /// The station's light rig, ported from `game/src/render/scene/lightRig.ts` (plan 13 §2).
    ///
    /// The source runs **one key + one fill + hemisphere + ambient**, sRGB output and
    /// **no tone mapping, no shadow maps, no environment map**, and clears to the theme's
    /// void colour with linear fog (120…320 m). The Unity scene shipped a single 0.72
    /// directional and flat 0.40/0.43/0.46 ambient over a fixed blue-grey clear, which is
    /// what made the frame read ~1.8× brighter than Three.
    ///
    /// Three's Lambert BRDF divides diffuse by π and URP's does not, so every intensity
    /// and ambient colour below is the source value **divided by π**; the light colours
    /// are converted from sRGB to linear for the same reason. The rig is applied at
    /// runtime (after the scene loads) and by the scene generator, so an already-serialized
    /// `StationGameLocal.unity` picks it up without being regenerated.
    /// </summary>
    public static class StationRenderRig {
        public const string KeyLightName = "Daylight";
        public const string FillLightName = "Station Fill";

        /// <summary>The theme's void colour as the player sees it (gamma/sRGB bytes).</summary>
        public static readonly Color VoidColor = new Color(18f / 255f, 26f / 255f, 34f / 255f, 1f);
        /// <summary>The studio theme: a light paper void instead of the dark one.</summary>
        public static readonly Color StudioVoidColor = new Color(244f / 255f, 243f / 255f, 237f / 255f, 1f);

        public const float KeyIntensity = 1.5f / Mathf.PI;
        public const float FillIntensity = 0.45f / Mathf.PI;
        public const float FogStart = 120f;
        public const float FogEnd = 320f;

        static readonly Vector3 KeyDirection = new Vector3(-0.3841f, -0.7682f, 0.5122f);
        static readonly Vector3 FillDirection = new Vector3(0.6965f, -0.3980f, -0.5970f);
        static readonly Color KeyColor = new Color32(255, 243, 224, 255);
        static readonly Color FillColor = new Color32(188, 210, 255, 255);

        // The source's indirect light, split the way the finish shader evaluates it:
        // `ambient 0.8·white` plus `hemisphere 1.15 · mix(ground, sky, ½(n·up+1))`, the
        // whole irradiance divided by π (Three's Lambert BRDF has the 1/π, URP's does not).
        // Linear, because that is what a shader consumes.
        public static readonly Color AmbientFlat = new Color(0.8f, 0.8f, 0.8f) / Mathf.PI;
        public static readonly Color HemisphereSky = new Color(0.7379f, 0.8072f, 1f) * (1.15f / Mathf.PI);
        public static readonly Color HemisphereGround = new Color(0.02316f, 0.02843f, 0.04095f) * (1.15f / Mathf.PI);

        // The trilight ambient is still set so anything reading `RenderSettings` (the
        // reflection probe, a URP Lit material the finish library did not build) agrees
        // with the finish shader instead of falling back to a flat colour.
        public static readonly Color AmbientSky = AmbientFlat + HemisphereSky;
        public static readonly Color AmbientEquator = AmbientFlat + (HemisphereSky + HemisphereGround) * 0.5f;
        public static readonly Color AmbientGround = AmbientFlat + HemisphereGround;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Install() {
            Apply();
        }

        /// <summary>
        /// Apply the rig to the running scene. `theme` is `studio` for the light paper
        /// theme; anything else is the dark blueprint/site void.
        /// </summary>
        public static void Apply(Camera camera = null, string theme = null) {
            var voidColor = theme == "studio" ? StudioVoidColor : VoidColor;

            var key = Configure(KeyLightName, KeyColor, KeyIntensity, KeyDirection);
            var fill = Configure(FillLightName, FillColor, FillIntensity, FillDirection);
            RenderSettings.sun = key;

            Shader.SetGlobalColor("_StationAmbient", AmbientFlat);
            Shader.SetGlobalColor("_StationHemiSky", HemisphereSky);
            Shader.SetGlobalColor("_StationHemiGround", HemisphereGround);

            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = AmbientSky;
            RenderSettings.ambientEquatorColor = AmbientEquator;
            RenderSettings.ambientGroundColor = AmbientGround;
            RenderSettings.ambientIntensity = 1f;

            // No environment map in the source: a skybox reflection would brighten every
            // metallic finish far past the reference. Intensity 0 leaves URP's probe path
            // intact (a null custom probe is worse than a dark one).
            RenderSettings.reflectionIntensity = 0f;

            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = voidColor.linear;
            RenderSettings.fogStartDistance = FogStart;
            RenderSettings.fogEndDistance = FogEnd;

            if (camera == null) camera = Camera.main;
            if (camera == null) {
                foreach (var candidate in Object.FindObjectsByType<Camera>(FindObjectsInactive.Exclude)) {
                    if (candidate.CompareTag("MainCamera")) { camera = candidate; break; }
                }
            }
            if (camera == null) return;
            camera.clearFlags = CameraClearFlags.SolidColor;
            // Camera background is a gamma colour in a Linear project: the player writes
            // the byte value through unchanged, so the sRGB bytes are what is set here.
            camera.backgroundColor = voidColor;
        }

        static Light Configure(string name, Color color, float intensity, Vector3 direction) {
            Light light = null;
            foreach (var candidate in Object.FindObjectsByType<Light>(FindObjectsInactive.Exclude)) {
                if (candidate.type == LightType.Directional && candidate.name == name) { light = candidate; break; }
            }
            if (light == null) {
                light = new GameObject(name, typeof(Light)).GetComponent<Light>();
                light.type = LightType.Directional;
            }
            // Light colours are linear; the source authors them in sRGB.
            light.color = color.linear;
            light.intensity = intensity;
            light.transform.rotation = Quaternion.LookRotation(direction.normalized, Vector3.up);
            light.shadows = LightShadows.None;
            light.renderMode = LightRenderMode.ForcePixel;
            return light;
        }
    }
}
