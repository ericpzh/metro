using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Metro.EditModeTests {
    /// <summary>
    /// Deterministic EditMode regressions for Workstream A:
    ///   1. Lock-free <see cref="StationCrowdStateContributor"/> and
    ///      <see cref="StationStatisticsStateContributor"/> reads from
    ///      <see cref="StationPublishedSimFrame"/> without acquiring <c>sessionLock</c>.
    ///   2. <see cref="StationDisplayTvArtwork.StateContributor"/> deferral under PlayMode
    ///      so <c>Advance()</c> owns budgeted, visible-only TV repaints, plus cache keying
    ///      on <see cref="StationDisplayTvArtwork.PublishVersion"/> instead of raw <c>simTick</c>.
    ///   3. Bounded <see cref="RenderTexture"/> pooling and clean disposal in
    ///      <see cref="StationTvPlatePainter"/>.
    ///   4. Duplicate-silent audio suppression in <see cref="StationGameHost"/>.
    /// </summary>
    public sealed class StationPerfLockFreeAndTvTests {
        const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";
        const string FontPath = "Assets/StationDesigner/Fonts/NotoSansSC.ttf";

        static readonly MethodInfo HostAwake =
            typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
        static readonly MethodInfo HostLateUpdate =
            typeof(StationGameHost).GetMethod("LateUpdate", BindingFlags.Instance | BindingFlags.NonPublic);
        static readonly FieldInfo HostNextAudioFrame =
            typeof(StationGameHost).GetField("nextAudioFrame", BindingFlags.Instance | BindingFlags.NonPublic);

        [TearDown]
        public void TearDown() {
            StationDisplayTvArtwork.DeferStateContributorRepaintOverride = null;
            PassengerCatalogueAnchor.ClearInjection();
            PassengerPoseFeeds.Clear();
            StationTvPlatePainter.DisposePool();
            StationTvPlatePainter.ResetPoolStats();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        static StationReadResult ReadZoo() {
            var read = StationDocumentReader.ReadFile(ZooPath);
            Assert.IsNotNull(read?.Document, "Zoo fixture missing: " + ZooPath);
            return read;
        }

        [Test]
        public void CrowdAndStatisticsContributorsReadPublishedFrameLockFreeAndMatchSession() {
            var read = ReadZoo();
            var simHost = new StationSimulationHost();
            var lockEntered = new ManualResetEventSlim(false);
            var releaseLock = new ManualResetEventSlim(false);
            Thread blocker = null;
            try {
                simHost.StageInstall(read.Document, read.Index);
                simHost.CommitInstall();
                Assert.IsTrue(simHost.ApplySimCommand("sim.play", new JObject { ["playing"] = true }, out var code), code);

                var session = simHost.Session;
                Assert.IsNotNull(session);
                for (int i = 0; i < 600 && session.Services.Alighted == 0; i++) {
                    simHost.Tick(1.0);
                }
                Assert.Greater(session.Services.Spawned, 0, "Zoo simulation spawned passengers");
                Assert.Greater(session.Services.Alighted, 0, "Zoo simulation alighted passengers");

                // Unchanged statistics across a speed change should reuse the immutable snapshot reference.
                var statsBeforeSpeed = simHost.PublishedFrame.Statistics;
                Assert.IsNotNull(statsBeforeSpeed);
                Assert.IsTrue(simHost.ApplySimCommand("sim.speed", new JObject { ["speed"] = 4 }, out code), code);
                Assert.AreSame(statsBeforeSpeed, simHost.PublishedFrame.Statistics,
                    "unchanged statistics snapshot must reuse its immutable reference");

                var expectedCrowd = StationCrowdStateContributor.Build(session);
                var expectedStats = new StationStatisticsStateContributor(() => session)
                    .BuildPayload(read.Document, read.Index);

                // Hold sessionLock on a background thread and prove both contributors run lock-free.
                blocker = new Thread(() => {
                    simHost.WithSessionLock(_ => {
                        lockEntered.Set();
                        releaseLock.Wait(3000);
                    });
                }) { IsBackground = true };
                blocker.Start();
                Assert.IsTrue(lockEntered.Wait(2000), "background thread acquired sessionLock");

                var crowdContributor = new StationCrowdStateContributor(() => simHost);
                var statsContributor = new StationStatisticsStateContributor(() => simHost);

                var lockFreeCrowd = crowdContributor.BuildPayload(read.Document, read.Index);
                var lockFreeStats = statsContributor.BuildPayload(read.Document, read.Index);

                Assert.IsTrue(JToken.DeepEquals(expectedCrowd, lockFreeCrowd),
                    "lock-free crowd payload must match direct session payload");
                Assert.IsTrue(JToken.DeepEquals(expectedStats, lockFreeStats),
                    "lock-free statistics payload must match direct session payload");
                Assert.IsTrue(JToken.DeepEquals(expectedCrowd, StationCrowdStateContributor.Build(simHost.PublishedFrame)));
                Assert.IsTrue(JToken.DeepEquals(expectedStats, StationStatisticsStateContributor.BuildFromPublished(simHost.PublishedFrame.Statistics)));
            } finally {
                releaseLock.Set();
                blocker?.Join(2000);
                lockEntered.Dispose();
                releaseLock.Dispose();
                simHost.Release();
            }
        }

        [Test]
        public void PublishStateNowRunsLockFreeAndDefersTvRepaintsWhenPlayModeDeferred() {
            var cameraGo = new GameObject("PerfTestCamera");
            var camera = cameraGo.AddComponent<Camera>();
            var hostGo = new GameObject("PerfTestHost");
            var host = hostGo.AddComponent<StationGameHost>();
            var lockEntered = new ManualResetEventSlim(false);
            var releaseLock = new ManualResetEventSlim(false);
            Thread blocker = null;
            try {
                host.stationCamera = camera;
                host.frameCameraOnCommit = false;
                host.catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
                host.trainCatalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
                host.stationShader = StationFinishLibrary.FindShader();
                host.font = AssetDatabase.LoadAssetAtPath<Font>(FontPath);

                HostAwake.Invoke(host, null);
                var displayRenderer = new StationDisplayModuleRenderer();
                host.RegisterRenderer(displayRenderer);
                host.RegisterStateContributor(new StationCrowdStateContributor(() => host.Simulation as StationSimulationHost));
                host.RegisterStateContributor(new StationDisplayTvArtwork.StateContributor());
                host.NoteClientSession("sess-perf-lockfree");

                var stateMessages = new List<JObject>();
                host.ReplyPublished += raw => {
                    if (string.IsNullOrEmpty(raw)) return;
                    var msg = JObject.Parse(raw);
                    if ((string)msg["kind"] == "state") stateMessages.Add(msg);
                };

                var zooJson = File.ReadAllText(ZooPath);
                var opened = host.OpenDocument(zooJson, "zoo");
                Assert.IsTrue(opened.Accepted, opened.ToString());

                var simHost = (StationSimulationHost)host.Simulation;
                Assert.IsTrue(simHost.ApplySimCommand("sim.play", new JObject { ["playing"] = true }, out var code), code);
                for (int i = 0; i < 5; i++) simHost.Tick(1.0);

                // Simulate PlayMode deferral for TV state contributor.
                StationDisplayTvArtwork.DeferStateContributorRepaintOverride = true;

                // Warm raw caches once.
                host.PublishStateNow();
                Assert.AreEqual(1, stateMessages.Count);

                // Hold sessionLock on a background thread and invoke PublishStateNow() on main thread.
                blocker = new Thread(() => {
                    simHost.WithSessionLock(_ => {
                        lockEntered.Set();
                        releaseLock.Wait(3000);
                    });
                }) { IsBackground = true };
                blocker.Start();
                Assert.IsTrue(lockEntered.Wait(2000), "background thread acquired sessionLock");

                host.PublishStateNow();
                Assert.AreEqual(2, stateMessages.Count, "PublishStateNow must succeed lock-free while worker holds sessionLock");
                var statePayload = (JObject)stateMessages[1]["payload"];
                Assert.IsNotNull(statePayload["crowd"]);
                Assert.IsNotNull(statePayload["statistics"]);
                Assert.IsNotNull(statePayload["displays"]);
                Assert.IsNotNull(statePayload["clock"]);

                releaseLock.Set();
                blocker.Join(2000);
                blocker = null;

                // Advance simulation > 60 s so TV minute rolls over, then verify StateContributor does NOT synchronously repaint.
                var scope = displayRenderer.Current?.Displays;
                Assert.IsNotNull(scope, "Zoo display scope bound");
                var faces = StationDisplayTvArtwork.EntriesFor(scope)
                    .SelectMany(e => e.Faces)
                    .Where(f => f.Plate != null)
                    .ToList();
                Assert.GreaterOrEqual(faces.Count, 2, "Zoo carries multiple TV faces");

                for (int i = 0; i < 65; i++) simHost.Tick(1.0);
                long versionBeforePublish = StationDisplayTvArtwork.PublishVersion;
                string plateKeyBefore = faces[0].PlateKey;

                host.PublishStateNow();
                Assert.AreEqual(versionBeforePublish, StationDisplayTvArtwork.PublishVersion,
                    "deferred StateContributor must not mutate/repaint TV plates on 10 Hz PublishStateNow");
                Assert.AreEqual(plateKeyBefore, faces[0].PlateKey,
                    "TV face plate must remain untouched until Advance() runs");

                // Now let Advance() paint with hidden-skip and explicit budget=1.
                faces[0].Plate.enabled = false;
                StationDisplayTvArtwork.Advance(
                    scope,
                    host.Coordinator.World,
                    1.0,
                    host.Document,
                    simHost.PublishedFrame.Motion,
                    true,
                    maxNewPaints: 1,
                    skipHidden: true);
                Assert.GreaterOrEqual(StationDisplayTvArtwork.LastSkippedHiddenPlates, 1, "hidden TV face skipped");
                Assert.LessOrEqual(StationDisplayTvArtwork.LastPaintedPlates, 1, "Advance respects paint budget");
                Assert.Greater(StationDisplayTvArtwork.PublishVersion, versionBeforePublish,
                    "repainting a visible TV plate increments PublishVersion for state.displays cache invalidation");
            } finally {
                releaseLock.Set();
                blocker?.Join(2000);
                lockEntered.Dispose();
                releaseLock.Dispose();
                StationDisplayTvArtwork.DeferStateContributorRepaintOverride = null;
                if (hostGo != null) Object.DestroyImmediate(hostGo);
                if (cameraGo != null) Object.DestroyImmediate(cameraGo);
            }
        }

        [Test]
        public void TvPlatePainterPoolsRenderTexturesBySizeRespectsCapAndDisposesCleanly() {
            StationTvPlatePainter.DisposePool();
            StationTvPlatePainter.ResetPoolStats();
            Assert.AreEqual(0, StationTvPlatePainter.PooledPlateTextureCount);

            var rtA = StationTvPlatePainter.AcquirePlateTarget(960, 540, "plate-a");
            Assert.IsNotNull(rtA);
            Assert.IsTrue(rtA.IsCreated());
            Assert.AreEqual(1, StationTvPlatePainter.TotalPlateRtAllocated);
            Assert.AreEqual(0, StationTvPlatePainter.TotalPlateRtReused);

            Assert.IsTrue(StationTvPlatePainter.ReleasePlateTarget(rtA), "first release enters RT pool");
            Assert.AreEqual(1, StationTvPlatePainter.PooledPlateTextureCount);
            // Releasing the same RT twice is idempotent and does not double-count.
            Assert.IsTrue(StationTvPlatePainter.ReleasePlateTarget(rtA), "duplicate release is idempotent");
            Assert.AreEqual(1, StationTvPlatePainter.PooledPlateTextureCount);

            var rtB = StationTvPlatePainter.AcquirePlateTarget(960, 540, "plate-b");
            Assert.AreSame(rtA, rtB, "re-acquiring same dimensions reuses pooled RenderTexture");
            Assert.AreEqual("plate-b", rtB.name);
            Assert.AreEqual(1, StationTvPlatePainter.TotalPlateRtAllocated);
            Assert.AreEqual(1, StationTvPlatePainter.TotalPlateRtReused);
            Assert.AreEqual(0, StationTvPlatePainter.PooledPlateTextureCount);

            // Different dimensions pool separately.
            var rtSmall = StationTvPlatePainter.AcquirePlateTarget(480, 270, "plate-small");
            Assert.AreNotSame(rtB, rtSmall);
            Assert.IsTrue(StationTvPlatePainter.ReleasePlateTarget(rtB));
            Assert.IsTrue(StationTvPlatePainter.ReleasePlateTarget(rtSmall));
            Assert.AreEqual(2, StationTvPlatePainter.PooledPlateTextureCount);

            var rtSmallReused = StationTvPlatePainter.AcquirePlateTarget(480, 270, "plate-small-2");
            Assert.AreSame(rtSmall, rtSmallReused, "size-keyed pool returns matching (width, height) RT");
            Assert.IsTrue(StationTvPlatePainter.ReleasePlateTarget(rtSmallReused));

            // Clear pool before testing cap.
            StationTvPlatePainter.ClearPlateTargetPool();
            Assert.AreEqual(0, StationTvPlatePainter.PooledPlateTextureCount);
            Assert.IsTrue(!rtB, "ClearPlateTargetPool destroys pooled RTs");
            Assert.IsTrue(!rtSmall, "ClearPlateTargetPool destroys all size buckets");

            // Pool enforces MaxPooledPlateTextures cap and destroys excess RTs.
            int total = StationTvPlatePainter.MaxPooledPlateTextures + 3;
            var batch = new List<RenderTexture>(total);
            for (int i = 0; i < total; i++) {
                batch.Add(StationTvPlatePainter.AcquirePlateTarget(960, 540, "cap-" + i));
            }
            int pooled = 0, destroyed = 0;
            for (int i = 0; i < batch.Count; i++) {
                if (StationTvPlatePainter.ReleasePlateTarget(batch[i])) {
                    pooled++;
                } else {
                    destroyed++;
                    Assert.IsTrue(!batch[i], "overflow RT beyond pool cap must be destroyed immediately");
                }
            }
            Assert.AreEqual(StationTvPlatePainter.MaxPooledPlateTextures, pooled);
            Assert.AreEqual(3, destroyed);
            Assert.AreEqual(StationTvPlatePainter.MaxPooledPlateTextures, StationTvPlatePainter.PooledPlateTextureCount);

            StationTvPlatePainter.DisposePool();
            Assert.AreEqual(0, StationTvPlatePainter.PooledPlateTextureCount);
            for (int i = 0; i < batch.Count; i++) {
                Assert.IsTrue(!batch[i], "DisposePool must destroy every pooled RenderTexture");
            }
        }

        [Test]
        public void SilentAudioGateSuppressesDuplicateSilentFramesAndRepublishesOnChange() {
            var cameraGo = new GameObject("AudioGateCamera");
            var camera = cameraGo.AddComponent<Camera>();
            var hostGo = new GameObject("AudioGateHost");
            var host = hostGo.AddComponent<StationGameHost>();
            try {
                host.stationCamera = camera;
                host.frameCameraOnCommit = false;
                HostAwake.Invoke(host, null);
                var opened = host.NewStation(new JObject());
                Assert.IsTrue(opened.Accepted, opened.ToString());

                var audioMessages = new List<JObject>();
                host.ReplyPublished += raw => {
                    if (string.IsNullOrEmpty(raw)) return;
                    var msg = JObject.Parse(raw);
                    if ((string)msg["kind"] == "audio") audioMessages.Add(msg);
                };

                host.NoteClientSession("sess-silent-1");

                // First silent frame publishes to establish silence.
                HostNextAudioFrame.SetValue(host, 0.0);
                HostLateUpdate.Invoke(host, null);
                Assert.AreEqual(1, audioMessages.Count, "first silent audio frame publishes");
                Assert.AreEqual(0, ((JArray)audioMessages[0]["payload"]["sources"]).Count);
                Assert.AreEqual(0, ((JArray)audioMessages[0]["payload"]["passengers"]).Count);

                // Repeated identical silent frame is suppressed.
                HostNextAudioFrame.SetValue(host, 0.0);
                HostLateUpdate.Invoke(host, null);
                Assert.AreEqual(1, audioMessages.Count, "duplicate silent audio frame is suppressed");

                // Transitioning speed republishes immediately.
                var simHost = (StationSimulationHost)host.Simulation;
                Assert.IsTrue(simHost.ApplySimCommand("sim.speed", new JObject { ["speed"] = 4 }, out var code), code);
                HostNextAudioFrame.SetValue(host, 0.0);
                HostLateUpdate.Invoke(host, null);
                Assert.AreEqual(2, audioMessages.Count, "speed change republishes audio state");
                Assert.AreEqual(4, (int)audioMessages[1]["payload"]["speed"]);

                // Subsequent identical silent frame at speed=4 is suppressed again.
                HostNextAudioFrame.SetValue(host, 0.0);
                HostLateUpdate.Invoke(host, null);
                Assert.AreEqual(2, audioMessages.Count);

                // Switching client session resets the silent gate and publishes for the new session.
                host.NoteClientSession("sess-silent-2");
                HostNextAudioFrame.SetValue(host, 0.0);
                HostLateUpdate.Invoke(host, null);
                Assert.AreEqual(3, audioMessages.Count, "new client session republishes audio state");
                Assert.AreEqual("sess-silent-2", (string)audioMessages[2]["sessionId"]);
            } finally {
                if (hostGo != null) Object.DestroyImmediate(hostGo);
                if (cameraGo != null) Object.DestroyImmediate(cameraGo);
            }
        }
    }
}
