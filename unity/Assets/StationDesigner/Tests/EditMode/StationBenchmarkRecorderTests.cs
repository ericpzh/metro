using Metro.App;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace Metro.EditModeTests {
    public sealed class StationBenchmarkRecorderTests {
        [Test]
        public void StartRecordAndStopProduceCompactFrameTriplesAndHardwareMetadata() {
            var recorder = new StationBenchmarkRecorder();
            Assert.IsTrue(recorder.Handles("benchmark.start"));
            Assert.IsTrue(recorder.Handles("benchmark.stop"));
            Assert.IsTrue(recorder.Handles("benchmark.info"));
            Assert.IsFalse(recorder.Handles("benchmark.unknown"));

            var infoPayload = new JObject();
            Assert.IsTrue(recorder.TryHandle(new StationCommand { Type = "benchmark.info", Payload = infoPayload }, infoPayload, out _, out _));
            Assert.IsFalse((bool)infoPayload["recording"]);
            Assert.IsNotNull(infoPayload["hardware"]);
            Assert.IsNotEmpty((string)infoPayload["hardware"]["engine"]);

            recorder.StartRecording(10.0);
            Assert.IsTrue(recorder.IsRecording);
            recorder.RecordFrame(10.008, 8.0, 100);
            recorder.RecordFrame(10.016, 8.333, 101);
            recorder.RecordFrame(11.020, 7.5, 116);

            var stopPayload = new JObject();
            Assert.IsTrue(recorder.TryHandle(new StationCommand { Type = "benchmark.stop", Payload = stopPayload }, stopPayload, out _, out _));
            Assert.IsFalse(recorder.IsRecording);
            Assert.IsFalse((bool)stopPayload["recording"]);

            var frames = stopPayload["frames"] as JArray;
            Assert.IsNotNull(frames);
            Assert.AreEqual(3, frames.Count);
            Assert.AreEqual(8.0, (double)frames[0][1], 0.01);
            Assert.AreEqual(100, (long)frames[0][2]);
            Assert.AreEqual(116, (long)frames[2][2]);

            var resources = stopPayload["resources"] as JArray;
            Assert.IsNotNull(resources);
            Assert.AreEqual(1, resources.Count);
            Assert.GreaterOrEqual((double)resources[0]["at"], 1000.0);
        }

        [Test]
        public void DesktopRouteParserSupportsBenchmarkFlagsAndExplicitRoute() {
            Assert.IsNull(StationDesktopUiPresenter.ParseCommandLineRoute(new[] { "MetroStation.exe" }));
            Assert.AreEqual("/game/benchmark", StationDesktopUiPresenter.ParseCommandLineRoute(new[] { "MetroStation.exe", "-benchmark" }));
            Assert.AreEqual("/game/benchmark", StationDesktopUiPresenter.ParseCommandLineRoute(new[] { "MetroStation.exe", "--benchmark" }));
            Assert.AreEqual("/game/benchmark/en", StationDesktopUiPresenter.ParseCommandLineRoute(new[] { "MetroStation.exe", "-benchmark", "--en" }));
            Assert.AreEqual("/game/benchmark/en", StationDesktopUiPresenter.ParseCommandLineRoute(new[] { "MetroStation.exe", "-metroRoute", "game/benchmark/en" }));
            Assert.IsTrue(StationDesktopUiPresenter.IsBenchmarkRoute("/game/benchmark"));
            Assert.IsTrue(StationDesktopUiPresenter.IsBenchmarkRoute("/game/unity/benchmark/en/"));
            Assert.IsFalse(StationDesktopUiPresenter.IsBenchmarkRoute("/game/zoo"));
        }

        [Test]
        public void BenchmarkModeCommandTracksActiveBenchmarkUiState() {
            var recorder = new StationBenchmarkRecorder();
            Assert.IsTrue(recorder.Handles("benchmark.mode"));
            try {
                var onPayload = new JObject();
                Assert.IsTrue(recorder.TryHandle(
                    new StationCommand { Type = "benchmark.mode", Payload = new JObject { ["active"] = true } },
                    onPayload, out _, out _));
                Assert.IsTrue(StationBenchmarkRecorder.InBenchmarkUi);
                Assert.IsTrue((bool)onPayload["active"]);

                var offPayload = new JObject();
                Assert.IsTrue(recorder.TryHandle(
                    new StationCommand { Type = "benchmark.mode", Payload = new JObject { ["active"] = false } },
                    offPayload, out _, out _));
                Assert.IsFalse(StationBenchmarkRecorder.InBenchmarkUi);
                Assert.IsFalse((bool)offPayload["active"]);
            } finally {
                recorder.TryHandle(
                    new StationCommand { Type = "benchmark.mode", Payload = new JObject { ["active"] = false } },
                    new JObject(), out _, out _);
            }
        }
    }
}
