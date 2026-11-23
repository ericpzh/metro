using System;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;

namespace Metro.App {
    /// <summary>
    /// Presentation background skybox and horizon fog for <c>隐藏UI</c> (<c>hideUi</c>) mode,
    /// ported from <c>game/src/render/scene/systems/SkySystem.ts</c> (GAME-SPEC §11).
    ///
    /// Normal editor mode clears to <see cref="StationRenderRig.VoidColor"/> (or
    /// <see cref="StationRenderRig.StudioVoidColor"/>) with linear void fog (120…320 m).
    /// Enabling <c>hideUi</c> switches the editor camera to the baked procedural cloud
    /// cubemap and matching horizon fog scaled by <see cref="SkyIntensity"/> from the
    /// simulated time of day, without touching scene lighting or environment reflections.
    /// </summary>
    public sealed class StationSkySystem : IDisposable {
        public const int CubemapSize = 512;
        public const string ShaderResourcePath = "StationSky";
        public const string ShaderName = "Metro/Station Sky";
        public const float MinSkyIntensity = 0.015f;
        public const float MaxSkyIntensity = 1.0f;
        public const double DefaultSimTime = StationClock.ReferenceBootSeconds;
        public const double SimDaySeconds = StationClock.SimDaySeconds;

        public static readonly Color32 HorizonSrgb = new Color32(0xd4, 0xe6, 0xef, 0xff);
        public static readonly Color32 ZenithSrgb = new Color32(0x43, 0x8b, 0xd0, 0xff);
        public static readonly Color32 BelowSrgb = new Color32(0x84, 0x9b, 0xa9, 0xff);
        public static readonly Color32 CloudSrgb = new Color32(0xff, 0xff, 0xff, 0xff);

        static readonly double HorizonLinR = SrgbByteToLinear(0xd4);
        static readonly double HorizonLinG = SrgbByteToLinear(0xe6);
        static readonly double HorizonLinB = SrgbByteToLinear(0xef);

        static readonly double ZenithLinR = SrgbByteToLinear(0x43);
        static readonly double ZenithLinG = SrgbByteToLinear(0x8b);
        static readonly double ZenithLinB = SrgbByteToLinear(0xd0);

        static readonly double BelowLinR = SrgbByteToLinear(0x84);
        static readonly double BelowLinG = SrgbByteToLinear(0x9b);
        static readonly double BelowLinB = SrgbByteToLinear(0xa9);

        public static readonly Color HorizonLinear = new Color(
            (float)HorizonLinR,
            (float)HorizonLinG,
            (float)HorizonLinB,
            1f);

        static readonly CubemapFace[] FaceOrder = {
            CubemapFace.PositiveX,
            CubemapFace.NegativeX,
            CubemapFace.PositiveY,
            CubemapFace.NegativeY,
            CubemapFace.PositiveZ,
            CubemapFace.NegativeZ,
        };

        static Cubemap sharedCubemap;

        Material skyMaterial;
        Camera boundCamera;
        Color voidColor = StationRenderRig.VoidColor;
        string theme = "blueprint";
        bool hasExplicitVoidColor;
        bool shown;
        float intensity = SkyIntensity(DefaultSimTime);
        float appliedIntensity = float.NaN;

        public bool Shown => shown;
        public float Intensity => intensity;
        public float AppliedIntensity => appliedIntensity;
        public Color VoidColor => voidColor;
        public string Theme => theme;
        public Material Material => skyMaterial;

        /// <summary>Seconds since midnight wrapped into <c>[0, 86400)</c>, preserving fractional seconds.</summary>
        public static double TimeOfDayOf(double simTime) {
            if (double.IsNaN(simTime) || double.IsInfinity(simTime)) simTime = DefaultSimTime;
            return ((simTime % SimDaySeconds) + SimDaySeconds) % SimDaySeconds;
        }

        /// <summary>Local sunrise (05:00–07:00) and sunset (17:00–19:00) sky multiplier, ported from <c>skyIntensity</c>.</summary>
        public static float SkyIntensity(double simTime) {
            double hour = TimeOfDayOf(simTime) / 3600.0;
            double daylight = Smooth(5.0, 7.0, hour) * (1.0 - Smooth(17.0, 19.0, hour));
            return (float)(MinSkyIntensity + (MaxSkyIntensity - MinSkyIntensity) * daylight);
        }

        /// <summary>
        /// The <see cref="RenderSettings.fogColor"/> value that uploads <c>HorizonLinear * intensity</c>
        /// into URP's linear <c>unity_FogColor</c>, matching the skybox horizon with no gamma seam.
        /// </summary>
        public static Color HorizonFogColor(float skyIntensity) {
            float clamped = Mathf.Clamp(skyIntensity, 0f, 2f);
            var linear = new Color(
                HorizonLinear.r * clamped,
                HorizonLinear.g * clamped,
                HorizonLinear.b * clamped,
                1f);
            return QualitySettings.activeColorSpace == ColorSpace.Linear ? linear.gamma : linear;
        }

        /// <summary>Evaluate the unscaled (<c>intensity = 1</c>) sRGB sky texel for a document-space ray direction.</summary>
        public static Color32 EvaluateDocumentDirectionSrgb(Vector3 documentDirection) =>
            EvaluateWorldDirectionSrgb(StationCoordinates.Direction(documentDirection));

        /// <summary>Evaluate the unscaled (<c>intensity = 1</c>) sRGB sky texel for a Unity world-space ray direction.</summary>
        public static Color32 EvaluateWorldDirectionSrgb(Vector3 worldDirection) {
            if (worldDirection.sqrMagnitude < 1e-12f) worldDirection = Vector3.up;
            return EvaluateWorldDirectionSrgb(worldDirection.x, worldDirection.y, worldDirection.z, null);
        }

        public static Shader FindShader() =>
            Resources.Load<Shader>(ShaderResourcePath) ?? Shader.Find(ShaderName);

        public static Cubemap SharedCubemap() {
            if (sharedCubemap == null) sharedCubemap = CreateSkyCubemap();
            return sharedCubemap;
        }

        public void SetSimTime(double simTime) {
            intensity = SkyIntensity(simTime);
        }

        public void SetVoidColor(Color color) {
            voidColor = color;
            hasExplicitVoidColor = true;
            if (!shown && boundCamera != null) {
                boundCamera.backgroundColor = voidColor;
                if (RenderSettings.fog) RenderSettings.fogColor = voidColor.linear;
            }
        }

        public void SetTheme(string nextTheme) {
            theme = StationViewCommandApplier.NormalizeTheme(nextTheme);
            SetVoidColor(string.Equals(theme, "studio", StringComparison.OrdinalIgnoreCase)
                ? StationRenderRig.StudioVoidColor
                : StationRenderRig.VoidColor);
        }

        /// <summary>
        /// Apply or remove the skybox and horizon fog on <paramref name="camera"/>.
        /// When <paramref name="hideUi"/> has never been enabled and <paramref name="force"/> is false,
        /// leaving <paramref name="hideUi"/> false is a no-op so custom test clear colours stay untouched.
        /// </summary>
        public void Update(Camera camera, bool hideUi, bool force = false) {
            if (camera == null) return;

            if (!hideUi && !shown && !force) {
                boundCamera = camera;
                if (hasExplicitVoidColor) {
                    camera.backgroundColor = voidColor;
                    if (RenderSettings.fog) RenderSettings.fogColor = voidColor.linear;
                }
                return;
            }

            bool cameraChanged = !ReferenceEquals(boundCamera, camera);
            if (!force && !cameraChanged && hideUi == shown && Mathf.Abs(intensity - appliedIntensity) <= 1e-6f) {
                return;
            }

            if (boundCamera != null && !ReferenceEquals(boundCamera, camera) && shown) {
                RestoreVoidOnCamera(boundCamera);
            }

            boundCamera = camera;
            shown = hideUi;
            appliedIntensity = intensity;

            if (hideUi) {
                var mat = EnsureMaterial();
                if (mat != null) {
                    mat.SetTexture("_SkyMap", SharedCubemap());
                    mat.SetFloat("_Intensity", intensity);
                    var skybox = camera.GetComponent<Skybox>();
                    if (skybox == null) skybox = camera.gameObject.AddComponent<Skybox>();
                    skybox.material = mat;
                    skybox.enabled = true;
                    camera.clearFlags = CameraClearFlags.Skybox;
                }
                RenderSettings.reflectionIntensity = 0f;
                RenderSettings.fog = true;
                RenderSettings.fogMode = FogMode.Linear;
                RenderSettings.fogStartDistance = StationRenderRig.FogStart;
                RenderSettings.fogEndDistance = StationRenderRig.FogEnd;
                RenderSettings.fogColor = HorizonFogColor(intensity);
            } else {
                RestoreVoidOnCamera(camera);
                RenderSettings.reflectionIntensity = 0f;
                RenderSettings.fog = true;
                RenderSettings.fogMode = FogMode.Linear;
                RenderSettings.fogStartDistance = StationRenderRig.FogStart;
                RenderSettings.fogEndDistance = StationRenderRig.FogEnd;
                RenderSettings.fogColor = voidColor.linear;
            }
        }

        public JObject SnapshotJson(Camera camera = null) {
            var cam = camera != null ? camera : boundCamera;
            var shader = skyMaterial != null ? skyMaterial.shader : FindShader();
            return new JObject {
                ["shown"] = shown,
                ["theme"] = theme,
                ["intensity"] = Math.Round(intensity, 6),
                ["clearFlags"] = cam != null ? cam.clearFlags.ToString() : CameraClearFlags.SolidColor.ToString(),
                ["shaderSupported"] = shader != null && shader.isSupported,
            };
        }

        public void Dispose() {
            if (shown && boundCamera != null) {
                RestoreVoidOnCamera(boundCamera);
            }
            shown = false;
            appliedIntensity = float.NaN;
            boundCamera = null;
            if (skyMaterial != null) {
                DestroyNow(skyMaterial);
                skyMaterial = null;
            }
        }

        void RestoreVoidOnCamera(Camera camera) {
            if (!camera) return;
            if (camera.TryGetComponent<Skybox>(out var skybox)) {
                skybox.material = null;
                skybox.enabled = false;
            }
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = voidColor;
        }

        Material EnsureMaterial() {
            if (skyMaterial != null) return skyMaterial;
            var shader = FindShader();
            if (shader == null) return null;
            skyMaterial = new Material(shader) {
                name = "Station Sky (Runtime)",
            };
            return skyMaterial;
        }

        struct HashSlot {
            public bool Valid;
            public int Ix;
            public int Iy;
            public double Value;
        }

        static Cubemap CreateSkyCubemap() {
            var cubemap = new Cubemap(CubemapSize, GraphicsFormat.R8G8B8A8_SRGB, TextureCreationFlags.None) {
                name = "StationSkyCubemap",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
            };
            var pixels = new Color32[CubemapSize * CubemapSize];
            var hashCache = new HashSlot[8192];

            for (int face = 0; face < 6; face++) {
                for (int row = 0; row < CubemapSize; row++) {
                    double v = 1.0 - 2.0 * (row + 0.5) / CubemapSize;
                    int rowOffset = row * CubemapSize;
                    for (int col = 0; col < CubemapSize; col++) {
                        double u = 2.0 * (col + 0.5) / CubemapSize - 1.0;
                        double wx, wy, wz;
                        switch (face) {
                            case 0: wx = 1.0; wy = v; wz = -u; break;
                            case 1: wx = -1.0; wy = v; wz = u; break;
                            case 2: wx = u; wy = 1.0; wz = -v; break;
                            case 3: wx = u; wy = -1.0; wz = v; break;
                            case 4: wx = u; wy = v; wz = 1.0; break;
                            default: wx = -u; wy = v; wz = -1.0; break;
                        }
                        pixels[rowOffset + col] = EvaluateWorldDirectionSrgb(wx, wy, wz, hashCache);
                    }
                }
                cubemap.SetPixelData(pixels, 0, FaceOrder[face]);
            }

            cubemap.Apply(updateMipmaps: false, makeNoLongerReadable: true);
            return cubemap;
        }

        static Color32 EvaluateWorldDirectionSrgb(double wx, double wy, double wz, HashSlot[] hashCache) {
            double invLen = 1.0 / Math.Sqrt(wx * wx + wy * wy + wz * wz);
            // Document direction is (wx, wz, wy); Three.js WebGLBackground premultiplies CubeTexture
            // lookup by diag(-1, 1, 1), sampling SkySystem.ts at (-doc.x, doc.y, doc.z) = (-wx, wz, wy).
            double dirX = -wx * invLen;
            double dirY = wz * invLen;
            double height = wy * invLen;

            double tHeight = Math.Pow(Math.Abs(height), 0.55);
            double targetR = height >= 0.0 ? ZenithLinR : BelowLinR;
            double targetG = height >= 0.0 ? ZenithLinG : BelowLinG;
            double targetB = height >= 0.0 ? ZenithLinB : BelowLinB;

            double r = Lerp(HorizonLinR, targetR, tHeight);
            double g = Lerp(HorizonLinG, targetG, tHeight);
            double b = Lerp(HorizonLinB, targetB, tHeight);

            if (height > 0.0) {
                double proj = 2.8 / (height + 0.16);
                double cx = dirX * proj + 12.0;
                double cy = dirY * proj + 7.0;
                double field = CloudField(cx, cy, hashCache);
                double cover = Smooth(0.49, 0.7, field) * Smooth(0.01, 0.18, height);
                double shade = Smooth(0.48, 0.8, field);
                double cloudMix = cover * (0.72 + 0.28 * shade);
                r = Lerp(r, 1.0, cloudMix);
                g = Lerp(g, 1.0, cloudMix);
                b = Lerp(b, 1.0, cloudMix);
            }

            return new Color32(
                LinearToSrgbByte(r),
                LinearToSrgbByte(g),
                LinearToSrgbByte(b),
                255);
        }

        static double CloudField(double x, double y, HashSlot[] cache) =>
            Noise(x, y, cache) * 0.55 +
            Noise(x * 2.03 + 17.0, y * 2.03, cache) * 0.25 +
            Noise(x * 4.07, y * 4.07 + 31.0, cache) * 0.13 +
            Noise(x * 8.11, y * 8.11, cache) * 0.07;

        static double Noise(double x, double y, HashSlot[] cache) {
            int ix = (int)Math.Floor(x);
            int iy = (int)Math.Floor(y);
            double u = Smooth01(x - ix);
            double v = Smooth01(y - iy);
            double h00 = Hash(ix, iy, cache);
            double h10 = Hash(ix + 1, iy, cache);
            double h01 = Hash(ix, iy + 1, cache);
            double h11 = Hash(ix + 1, iy + 1, cache);
            return Lerp(Lerp(h00, h10, u), Lerp(h01, h11, u), v);
        }

        static double Hash(int ix, int iy, HashSlot[] cache) {
            if (cache != null) {
                int slot = ((ix * 73856093) ^ (iy * 19349663)) & 8191;
                ref var entry = ref cache[slot];
                if (entry.Valid && entry.Ix == ix && entry.Iy == iy) return entry.Value;
                double computed = HashUncached(ix, iy);
                entry.Valid = true;
                entry.Ix = ix;
                entry.Iy = iy;
                entry.Value = computed;
                return computed;
            }
            return HashUncached(ix, iy);
        }

        static double HashUncached(int ix, int iy) {
            double n = Math.Sin((double)ix * 127.1 + (double)iy * 311.7) * 43758.5453;
            return n - Math.Floor(n);
        }

        static double Smooth(double a, double b, double value) {
            double t = Clamp01((value - a) / (b - a));
            return t * t * (3.0 - 2.0 * t);
        }

        static double Smooth01(double value) {
            double t = Clamp01(value);
            return t * t * (3.0 - 2.0 * t);
        }

        static double Lerp(double a, double b, double t) => a + (b - a) * t;

        static double Clamp01(double v) => v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v);

        static double SrgbByteToLinear(int byteValue) {
            double c = byteValue / 255.0;
            return c <= 0.04045 ? c * 0.0773993808 : Math.Pow(c * 0.9478672986 + 0.0521327014, 2.4);
        }

        static byte LinearToSrgbByte(double linear) {
            double c = Clamp01(linear);
            double srgb = c <= 0.0031308 ? c * 12.92 : Math.Pow(c, 0.41666) * 1.055 - 0.055;
            int rounded = (int)Math.Round(Clamp01(srgb) * 255.0, MidpointRounding.AwayFromZero);
            return (byte)(rounded < 0 ? 0 : (rounded > 255 ? 255 : rounded));
        }

        static void DestroyNow(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }
}
