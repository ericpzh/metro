using System.Reflection;
using Metro.App;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.Tests {
    public sealed class StationFsrSettingsTests {
        [Test]
        public void FsrPresetsMatchPublishedScaleRatiosAndValidateModes() {
            Assert.That(StationFsrUpscaler.ScaleFor("native"), Is.EqualTo(1f).Within(1e-6f));
            Assert.That(StationFsrUpscaler.ScaleFor("ultra"), Is.EqualTo(1f / 1.3f).Within(1e-6f));
            Assert.That(StationFsrUpscaler.ScaleFor("quality"), Is.EqualTo(1f / 1.5f).Within(1e-6f));
            Assert.That(StationFsrUpscaler.ScaleFor("balanced"), Is.EqualTo(1f / 1.7f).Within(1e-6f));
            Assert.That(StationFsrUpscaler.ScaleFor("performance"), Is.EqualTo(0.5f).Within(1e-6f));

            foreach (var valid in new[] { "native", "ultra", "quality", "balanced", "performance" }) {
                Assert.That(StationFsrUpscaler.IsValidMode(valid), Is.True, valid);
            }
            Assert.That(StationFsrUpscaler.IsValidMode("invalid"), Is.False);
            Assert.That(StationFsrUpscaler.IsValidMode(null), Is.False);
            Assert.That(StationFsrUpscaler.BackendFor("native"), Is.EqualTo("off"));
            Assert.That(StationFsrUpscaler.BackendFor("quality"), Is.EqualTo(StationFsrUpscaler.UsesNativeUrpFsr ? "urp-fsr1" : "webgl-fsr1"));
        }

        [Test]
        public void WebGlFsrShaderLoadsFromResourcesWithBothPasses() {
            var shader = Resources.Load<Shader>(StationFsrUpscaler.ShaderResourceName);
            Assert.That(shader, Is.Not.Null, "Resources/StationFsr1.shader must be present for WebGL 2 FSR 1.0");
            Assert.That(shader.passCount, Is.EqualTo(2), "StationFsr1 needs EASU and RCAS passes");
        }

        [Test]
        public void GraphicsCommandsUpdateProfileAndUpscalingIndependentlyAndTogether() {
            var ctor = typeof(StationGraphicsSettings).GetConstructor(BindingFlags.Instance | BindingFlags.NonPublic, null, System.Type.EmptyTypes, null);
            Assert.That(ctor, Is.Not.Null);
            var settings = (StationGraphicsSettings)ctor.Invoke(null);
            var initial = settings.BuildPayload(null, null);
            string origProfile = (string)initial["profile"];
            string origUpscaling = (string)initial["upscaling"];
            try {
                var setUpscaling = new JObject { ["upscaling"] = "quality" };
                Assert.That(settings.TryHandle(new StationCommand { Type = "graphics.set", Payload = setUpscaling }, setUpscaling, out var code, out _), Is.True, code);
                Assert.That((string)setUpscaling["upscaling"], Is.EqualTo("quality"));
                Assert.That((string)setUpscaling["profile"], Is.EqualTo(origProfile));
                Assert.That((float)setUpscaling["renderScale"], Is.EqualTo(1f / 1.5f).Within(1e-5f));

                var setBoth = new JObject { ["profile"] = "low", ["upscaling"] = "performance" };
                Assert.That(settings.TryHandle(new StationCommand { Type = "graphics.set", Payload = setBoth }, setBoth, out code, out _), Is.True, code);
                Assert.That((string)setBoth["profile"], Is.EqualTo("low"));
                Assert.That((string)setBoth["upscaling"], Is.EqualTo("performance"));
                Assert.That((float)setBoth["renderScale"], Is.EqualTo(0.5f).Within(1e-5f));

                var invalid = new JObject { ["upscaling"] = "turbo" };
                Assert.That(settings.TryHandle(new StationCommand { Type = "graphics.set", Payload = invalid }, invalid, out code, out _), Is.False);
                Assert.That(code, Is.EqualTo("invalid-upscaling-mode"));
            } finally {
                var restore = new JObject { ["profile"] = origProfile, ["upscaling"] = origUpscaling };
                settings.TryHandle(new StationCommand { Type = "graphics.set", Payload = restore }, restore, out _, out _);
                StationFsrUpscaler.ReleaseResources();
            }
        }
    }
}
