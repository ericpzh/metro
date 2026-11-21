using System;
using System.Reflection;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App {
    /// <summary>
    /// Runtime FSR 1.0 upscaling controller for Station Designer.
    ///
    /// On platforms supporting URP's built-in FSR 1.0 (<c>SystemInfo.graphicsShaderLevel &gt;= 45</c>,
    /// such as Windows Direct3D 11 / Vulkan), this configures the active URP asset's
    /// <c>renderScale</c> and <c>upscalingFilter</c> (<c>UpscalingFilterSelection.FSR = 3</c>).
    ///
    /// On WebGL 2 / OpenGL ES 3.0 (<c>graphicsShaderLevel &lt; 45</c>), URP's built-in FSR
    /// falls back to bilinear filtering; this controller instead renders the active game camera
    /// into a scaled <see cref="RenderTexture"/> and runs the WebGL 2-compatible two-pass
    /// EASU + RCAS fragment shader (<c>Resources/StationFsr1</c>) directly to the backbuffer,
    /// restoring <see cref="Camera.targetTexture"/> immediately after each camera render so
    /// picking and layout always observe full screen dimensions.
    /// </summary>
    public static class StationFsrUpscaler {
        public const string ShaderResourceName = "StationFsr1";
        public const float DefaultSharpness = 0.2f;

        const int UrpFilterAuto = 0;
        const int UrpFilterFsr = 3;

        static readonly int InputSizeId = Shader.PropertyToID("_FsrInputSize");
        static readonly int OutputSizeId = Shader.PropertyToID("_FsrOutputSize");
        static readonly int SharpnessId = Shader.PropertyToID("_FsrSharpness");

        static string activeMode = "native";
        static float activeScale = 1f;
        static bool hooksInstalled;
        static bool quitHookInstalled;

        static Camera activeCamera;
        static int activeScreenW;
        static int activeScreenH;
        static int activeLowW;
        static int activeLowH;

        static Material fsrMaterial;
        static RenderTexture lowResTarget;
        static RenderTexture easuTarget;
        static CommandBuffer commandBuffer;

        public static bool UsesNativeUrpFsr => SystemInfo.graphicsShaderLevel >= 45;

        public static bool IsValidMode(string value) =>
            value == "native" || value == "ultra" || value == "quality" || value == "balanced" || value == "performance";

        public static float ScaleFor(string mode) {
            switch (mode) {
                case "ultra": return 1f / 1.3f;
                case "quality": return 1f / 1.5f;
                case "balanced": return 1f / 1.7f;
                case "performance": return 0.5f;
                default: return 1f;
            }
        }

        public static string BackendFor(string mode) {
            if (!IsValidMode(mode) || mode == "native") return "off";
            return UsesNativeUrpFsr ? "urp-fsr1" : "webgl-fsr1";
        }

        public static void Apply(string mode) {
            string normalized = IsValidMode(mode) ? mode : "native";
            activeMode = normalized;
            activeScale = ScaleFor(normalized);

            if (!quitHookInstalled) {
                quitHookInstalled = true;
                Application.quitting += ReleaseResources;
            }

            if (UsesNativeUrpFsr) {
                UninstallHooks();
                ReleaseResources();
                ConfigureUrpAsset(activeScale, normalized == "native" ? UrpFilterAuto : UrpFilterFsr);
                return;
            }

            // WebGL 2 / ES 3.0: keep URP's own renderScale at 1.0 so native is full-res
            // and active FSR does not double-scale.
            ConfigureUrpAsset(1f, UrpFilterAuto);
            if (normalized == "native") {
                UninstallHooks();
                ReleaseResources();
            } else {
                InstallHooks();
            }
        }

        static void ConfigureUrpAsset(float renderScale, int upscalingFilter) {
            ApplyToPipelineAsset(QualitySettings.renderPipeline, renderScale, upscalingFilter);
            var current = GraphicsSettings.currentRenderPipeline;
            if (current != null && current != QualitySettings.renderPipeline) {
                ApplyToPipelineAsset(current, renderScale, upscalingFilter);
            }
        }

        static void ApplyToPipelineAsset(RenderPipelineAsset asset, float renderScale, int upscalingFilter) {
            if (asset == null) return;
            var type = asset.GetType();
            PropertyInfo scaleProp = type.GetProperty("renderScale", BindingFlags.Instance | BindingFlags.Public);
            if (scaleProp != null && scaleProp.CanWrite && scaleProp.PropertyType == typeof(float)) {
                scaleProp.SetValue(asset, renderScale);
            }
            PropertyInfo filterProp = type.GetProperty("upscalingFilter", BindingFlags.Instance | BindingFlags.Public);
            if (filterProp != null && filterProp.CanWrite && filterProp.PropertyType.IsEnum) {
                try {
                    object enumValue = Enum.ToObject(filterProp.PropertyType, upscalingFilter);
                    filterProp.SetValue(asset, enumValue);
                } catch {
                    // Older/custom pipeline asset without this enum member.
                }
            }
        }

        static void InstallHooks() {
            if (hooksInstalled) return;
            hooksInstalled = true;
            RenderPipelineManager.beginCameraRendering += OnBeginCameraRendering;
            RenderPipelineManager.endCameraRendering += OnEndCameraRendering;
        }

        static void UninstallHooks() {
            if (!hooksInstalled) return;
            hooksInstalled = false;
            RenderPipelineManager.beginCameraRendering -= OnBeginCameraRendering;
            RenderPipelineManager.endCameraRendering -= OnEndCameraRendering;
            if (activeCamera != null) {
                activeCamera.targetTexture = null;
                activeCamera = null;
            }
        }

        static void OnBeginCameraRendering(ScriptableRenderContext context, Camera camera) {
            if (activeMode == "native" || activeScale >= 0.999f) return;
            if (camera == null || camera.cameraType != CameraType.Game || camera.targetTexture != null || camera.cullingMask == 0) return;
            int screenW = Screen.width;
            int screenH = Screen.height;
            if (screenW <= 1 || screenH <= 1) return;

            int lowW = Mathf.Max(1, Mathf.RoundToInt(screenW * activeScale));
            int lowH = Mathf.Max(1, Mathf.RoundToInt(screenH * activeScale));
            if (lowW >= screenW && lowH >= screenH) return;

            if (!EnsureResources(lowW, lowH, screenW, screenH)) return;

            activeCamera = camera;
            activeScreenW = screenW;
            activeScreenH = screenH;
            activeLowW = lowW;
            activeLowH = lowH;
            camera.targetTexture = lowResTarget;
        }

        static void OnEndCameraRendering(ScriptableRenderContext context, Camera camera) {
            if (camera == null || camera != activeCamera) return;
            camera.targetTexture = null;
            activeCamera = null;

            if (fsrMaterial == null || lowResTarget == null || easuTarget == null) return;
            if (commandBuffer == null) commandBuffer = new CommandBuffer { name = "StationFsr1" };
            commandBuffer.Clear();
            commandBuffer.SetGlobalVector(InputSizeId, new Vector4(activeLowW, activeLowH, 1f / activeLowW, 1f / activeLowH));
            commandBuffer.SetGlobalVector(OutputSizeId, new Vector4(activeScreenW, activeScreenH, 1f / activeScreenW, 1f / activeScreenH));
            commandBuffer.SetGlobalFloat(SharpnessId, DefaultSharpness);
            commandBuffer.Blit(lowResTarget, easuTarget, fsrMaterial, 0);
            commandBuffer.SetRenderTarget(BuiltinRenderTextureType.CameraTarget);
            commandBuffer.SetViewport(new Rect(0f, 0f, activeScreenW, activeScreenH));
            commandBuffer.Blit(easuTarget, BuiltinRenderTextureType.CameraTarget, fsrMaterial, 1);
            context.ExecuteCommandBuffer(commandBuffer);
            context.Submit();
            commandBuffer.Clear();
        }

        static bool EnsureResources(int lowW, int lowH, int screenW, int screenH) {
            if (fsrMaterial == null) {
                var shader = Resources.Load<Shader>(ShaderResourceName) ?? Shader.Find("Metro/Station FSR 1");
                if (shader == null || !shader.isSupported) return false;
                fsrMaterial = new Material(shader) { hideFlags = HideFlags.HideAndDontSave };
            }
            if (lowResTarget == null || lowResTarget.width != lowW || lowResTarget.height != lowH) {
                ReleaseTarget(ref lowResTarget);
                lowResTarget = new RenderTexture(lowW, lowH, 24, RenderTextureFormat.Default, RenderTextureReadWrite.Default) {
                    name = "StationFsrLowRes",
                    filterMode = FilterMode.Bilinear,
                    wrapMode = TextureWrapMode.Clamp,
                    useMipMap = false,
                    autoGenerateMips = false,
                    hideFlags = HideFlags.HideAndDontSave,
                };
                lowResTarget.Create();
            }
            if (easuTarget == null || easuTarget.width != screenW || easuTarget.height != screenH) {
                ReleaseTarget(ref easuTarget);
                easuTarget = new RenderTexture(screenW, screenH, 0, RenderTextureFormat.Default, RenderTextureReadWrite.Default) {
                    name = "StationFsrEasu",
                    filterMode = FilterMode.Bilinear,
                    wrapMode = TextureWrapMode.Clamp,
                    useMipMap = false,
                    autoGenerateMips = false,
                    hideFlags = HideFlags.HideAndDontSave,
                };
                easuTarget.Create();
            }
            return true;
        }

        static void ReleaseTarget(ref RenderTexture rt) {
            if (rt == null) return;
            if (RenderTexture.active == rt) RenderTexture.active = null;
            rt.Release();
            if (Application.isPlaying) UnityEngine.Object.Destroy(rt);
            else UnityEngine.Object.DestroyImmediate(rt);
            rt = null;
        }

        public static void ReleaseResources() {
            if (activeCamera != null) {
                activeCamera.targetTexture = null;
                activeCamera = null;
            }
            ReleaseTarget(ref lowResTarget);
            ReleaseTarget(ref easuTarget);
            if (fsrMaterial != null) {
                if (Application.isPlaying) UnityEngine.Object.Destroy(fsrMaterial);
                else UnityEngine.Object.DestroyImmediate(fsrMaterial);
                fsrMaterial = null;
            }
            if (commandBuffer != null) {
                commandBuffer.Release();
                commandBuffer = null;
            }
        }
    }
}
