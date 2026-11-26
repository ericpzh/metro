using System;
using System.Collections.Generic;
using System.Reflection;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Deterministic EditMode regressions for Workstream B (<see cref="PassengerCrowdView"/>
    /// and <see cref="PassengerCrowdRenderer"/> hot-path optimizations):
    /// 1. Early frustum culling before transform/LOD/clip work and lossless re-entry restoration.
    /// 2. Multi-tick dense-prior interpolation parity (bit-for-bit against the reference dictionary
    ///    algorithm across resets, tick advances, adjacent walks/ramps/lifts, teleports,
    ///    appearing/disappearing IDs, unsorted feeds, and fractional alphas).
    /// 3. Per-actor clip cache and static support cache invalidation across activities and edits.
    /// </summary>
    public sealed class StationPerfCrowdHotPathTests {
        GameObject root;
        PassengerCatalogue catalogue;
        Mesh fullMesh;
        Mesh reducedMesh;
        Mesh simplifiedMesh;
        Material outfitMaterial;
        readonly List<AnimationClip> clips = new List<AnimationClip>();
        readonly List<IDisposable> disposables = new List<IDisposable>();

        [SetUp]
        public void SetUp() {
            PassengerCatalogueAnchor.ClearInjection();
            PassengerPoseFeeds.Clear();
            StationEditSession.Reset();
            root = new GameObject("StationPerfCrowdHotPathTests");
            catalogue = BuildThreeTierCatalogue();
        }

        [TearDown]
        public void TearDown() {
            PassengerCatalogueAnchor.ClearInjection();
            PassengerPoseFeeds.Clear();
            StationEditSession.Reset();
            for (int i = disposables.Count - 1; i >= 0; i--) disposables[i]?.Dispose();
            disposables.Clear();
            if (root != null) UnityEngine.Object.DestroyImmediate(root);
            root = null;
            for (int i = 0; i < clips.Count; i++) {
                if (clips[i] != null) UnityEngine.Object.DestroyImmediate(clips[i]);
            }
            clips.Clear();
            if (outfitMaterial != null) UnityEngine.Object.DestroyImmediate(outfitMaterial);
            outfitMaterial = null;
            if (fullMesh != null) UnityEngine.Object.DestroyImmediate(fullMesh);
            fullMesh = null;
            if (reducedMesh != null) UnityEngine.Object.DestroyImmediate(reducedMesh);
            reducedMesh = null;
            if (simplifiedMesh != null) UnityEngine.Object.DestroyImmediate(simplifiedMesh);
            simplifiedMesh = null;
            if (catalogue != null) UnityEngine.Object.DestroyImmediate(catalogue);
            catalogue = null;
        }

        static Mesh CreateQuadMesh(string name, float width, float height) {
            var mesh = new Mesh { name = name };
            mesh.vertices = new[] {
                new Vector3(-width * 0.5f, 0f, -0.15f),
                new Vector3(width * 0.5f, 0f, -0.15f),
                new Vector3(width * 0.5f, height, 0.15f),
                new Vector3(-width * 0.5f, height, 0.15f),
            };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        PassengerCatalogue BuildThreeTierCatalogue() {
            fullMesh = CreateQuadMesh("perf-passenger-lod0", 0.5f, 1.72f);
            reducedMesh = CreateQuadMesh("perf-passenger-lod1", 0.5f, 1.72f);
            simplifiedMesh = CreateQuadMesh("perf-passenger-lod2", 0.5f, 1.72f);

            var shader = Shader.Find("Universal Render Pipeline/Lit")
                ?? Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Hidden/InternalErrorShader");
            outfitMaterial = new Material(shader) { name = "perf-passenger-outfit" };
            if (outfitMaterial.HasProperty("_BaseColor")) {
                outfitMaterial.SetColor("_BaseColor", new Color(0.6f, 0.4f, 0.3f, 1f));
            }

            var prefab = new GameObject("soft-male-commuter-none");
            prefab.transform.SetParent(root.transform, false);
            prefab.SetActive(false);

            var anim = prefab.AddComponent<Animation>();
            var clipDefs = new (string name, float duration)[] {
                ("Idle", 1.0f),
                ("WalkSlow", 1.12f),
                ("Walk", 1.12f),
                ("WalkFast", 1.12f),
                ("Wait", 12.0f),
                ("Queue", 12.0f),
                ("Lift", 9.0f),
                ("Escalator", 10.0f),
                ("Escalator_Right", 10.0f),
                ("Escalator_Left", 10.0f),
                ("EscalatorLeft", 10.0f),
                ("EscalatorLeft_Right", 10.0f),
                ("EscalatorLeft_Left", 10.0f),
                ("Card", 8.0f),
                ("Card_Right", 8.0f),
                ("Card_Left", 8.0f),
            };
            var clipNames = new string[clipDefs.Length];
            var clipAssets = new AnimationClip[clipDefs.Length];
            for (int i = 0; i < clipDefs.Length; i++) {
                var clip = new AnimationClip { name = clipDefs[i].name, legacy = true };
                // Add a real keyframe curve so clip.length equals duration and SampleAnimation writes a bone/transform.
                var curve = AnimationCurve.Linear(0f, 0f, clipDefs[i].duration, 0.25f);
                clip.SetCurve("Body", typeof(Transform), "localPosition.y", curve);
                anim.AddClip(clip, clipDefs[i].name);
                clipNames[i] = clipDefs[i].name;
                clipAssets[i] = clip;
                clips.Add(clip);
            }

            var body = new GameObject("Body");
            body.transform.SetParent(prefab.transform, false);
            var skin = body.AddComponent<SkinnedMeshRenderer>();
            skin.sharedMesh = fullMesh;
            skin.sharedMaterial = outfitMaterial;
            skin.localBounds = fullMesh.bounds;

            var cat = ScriptableObject.CreateInstance<PassengerCatalogue>();
            cat.clipSet = new PassengerClipSet {
                clipNames = clipNames,
                clips = clipAssets,
                walkProfiles = PassengerAppearance.DefaultWalkProfiles,
            };
            cat.entries = new[] {
                new PassengerCatalogueEntry {
                    index = 0,
                    recipe = "soft-male-commuter-none",
                    sex = "male",
                    outfit = "commuter",
                    accessory = "none",
                    adultEligible = true,
                    childEligible = true,
                    prefab = prefab,
                    reducedMesh = new PassengerMeshTier { mesh = reducedMesh, materials = new[] { outfitMaterial } },
                    simplifiedMesh = new PassengerMeshTier { mesh = simplifiedMesh, materials = new[] { outfitMaterial } },
                },
            };
            cat.Invalidate();
            return cat;
        }

        static StationGraphicsSettings CreateGraphicsSettings(out string originalProfile, out string originalUpscaling) {
            var ctor = typeof(StationGraphicsSettings).GetConstructor(
                BindingFlags.Instance | BindingFlags.NonPublic, null, Type.EmptyTypes, null);
            Assert.That(ctor, Is.Not.Null);
            var settings = (StationGraphicsSettings)ctor.Invoke(null);
            var initial = settings.BuildPayload(null, null);
            originalProfile = (string)initial["profile"];
            originalUpscaling = (string)initial["upscaling"];
            return settings;
        }

        static void SetGraphicsProfile(StationGraphicsSettings settings, string profile) {
            var payload = new JObject { ["profile"] = profile };
            Assert.That(settings.TryHandle(
                new StationCommand { Type = "graphics.set", Payload = payload },
                payload, out var code, out _), Is.True, code);
        }

        static StationReadResult BuildSimpleStation(int floorZ = -5, bool includeGroundExit = false) {
            var cells = new JArray();
            for (int x = -4; x <= 12; x++) {
                for (int y = -4; y <= 12; y++) {
                    cells.Add(new JObject {
                        ["x"] = x,
                        ["y"] = y,
                        ["z"] = floorZ,
                        ["fill"] = "solid",
                        ["zone"] = "paid",
                    });
                }
            }
            var modules = new JArray();
            if (includeGroundExit) {
                modules.Add(new JObject {
                    ["id"] = "exit-1",
                    ["type"] = "exit",
                    ["x"] = 0,
                    ["y"] = 0,
                    ["z"] = 0,
                    ["rot"] = 0,
                    ["w"] = 4,
                    ["d"] = 4,
                    ["cfg"] = new JObject { ["label"] = "A" },
                });
            }
            var docJson = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "PerfCrowdHotPathFixture",
                ["city"] = "guangzhou",
                ["seed"] = 1,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = cells,
                    ["modules"] = modules,
                    ["lines"] = new JArray(),
                },
            };
            var read = StationDocumentReader.Read(docJson.ToString(Formatting.None), StationSource.None);
            Assert.IsNotNull(read?.Document);
            return read;
        }

        static PassengerPose MakePose(
            int simId,
            double x,
            double y,
            double z,
            double heading = 0.0,
            PassengerActivity activity = PassengerActivity.Walk,
            double activitySeconds = 0.5,
            double walkDistance = 1.0,
            double walkPhase = 0.25,
            double walkWeight = 1.0,
            StationPassengerState state = StationPassengerState.Walking,
            string serverId = "",
            StationRidePath ridePath = null,
            double rideProgress = 0.0,
            double rideSeconds = 0.0,
            bool visible = true) => new PassengerPose {
                SimId = simId,
                X = x,
                Y = y,
                Z = z,
                Heading = heading,
                Activity = activity,
                ActivitySeconds = activitySeconds,
                RidePath = ridePath,
                RideProgress = rideProgress,
                RideSeconds = rideSeconds,
                WalkDistance = walkDistance,
                WalkPhase = walkPhase,
                WalkWeight = walkWeight,
                HasWalkWeight = true,
                Detail = PassengerDetail.Full,
                State = state,
                ServerId = serverId,
                Visible = visible,
            };

        [Test]
        public void FrustumCullHidesOffscreenMeshSkipsTransformsAndReEntryRestoresPoseLodAndFreshSample() {
            var settings = CreateGraphicsSettings(out var origProfile, out var origUpscaling);
            try {
                SetGraphicsProfile(settings, "high");

                var read = BuildSimpleStation(floorZ: 0);
                var shader = outfitMaterial.shader;
                var visibility = new StationVisibilityRegistry(shader);
                disposables.Add(visibility);
                var world = new StationWorldView(root.transform, "FrustumWorld", Array.Empty<IStationViewRenderer>());
                disposables.Add(world);
                world.Build(read.Document, read.Index);
                world.Activate();
                world.BindVisibility(visibility);

                visibility.State.ActiveLevel = 0;
                visibility.State.ShowLevels = true;
                visibility.Apply();

                var camGo = new GameObject("FrustumTestCamera");
                camGo.transform.SetParent(root.transform, false);
                var cam = camGo.AddComponent<Camera>();
                cam.enabled = false;
                cam.orthographic = false;
                cam.fieldOfView = 45f;
                cam.aspect = 16f / 9f;
                cam.nearClipPlane = 0.5f;
                cam.farClipPlane = 150f;
                // Camera at Unity (0, 2, -2) looking along +Z (document +Y).
                cam.transform.SetPositionAndRotation(new Vector3(0f, 2f, -2f), Quaternion.identity);

                var crowd = PassengerCrowdView.Build(root.transform, catalogue);
                crowd.BindWorld(world);
                crowd.FrustumCameraOverride = cam;

                int simId = 101;
                while (PassengerAppearance.IsChild(simId)) simId++;
                var look = PassengerAppearance.Look(catalogue, simId, PassengerDetail.Full);

                // 1) In frustum close-up: doc (0, 1.5, 1) -> Unity (0, 1, 1.5), distance ~3.6 m -> guaranteed LOD0.
                var closePose = MakePose(simId, x: 0.0, y: 1.5, z: 1.0, heading: 0.25, walkDistance: 1.0);
                crowd.Render(new[] { closePose }, simTimeSeconds: 1.0);

                Assert.IsTrue(crowd.TryGetActor(simId, out var actor));
                Assert.IsFalse(actor.FrustumCulled, "close actor in front of camera must not be frustum-culled");
                Assert.IsTrue(actor.Skin.enabled, "in-frustum actor Skin.enabled must be true");
                Assert.IsFalse(actor.Skin.forceRenderingOff, "in-frustum non-followed actor must render");
                Assert.IsTrue(actor.Root.activeSelf);
                var expectedCloseWorld = StationCoordinates.Point(new Vector3(0f, 1.5f, 1f));
                Assert.That((actor.Position - expectedCloseWorld).magnitude, Is.LessThan(1e-4f));
                Assert.That(Quaternion.Angle(actor.Rotation, PassengerAppearance.Rotation(0.25)), Is.LessThan(0.05f));
                Assert.AreSame(fullMesh, actor.Skin.sharedMesh, "close in-frustum actor uses LOD0");
                Assert.AreEqual(1, crowd.SampledThisFrame);
                Assert.AreEqual(0, crowd.FrustumCulledThisFrame);
                Assert.AreEqual(1, crowd.VisibleActors);
                Assert.AreEqual(1, crowd.ContactShadowCount);

                // 2) Actor walks OUT of frustum to doc (200, 1.5, 1) -> Unity (200, 1, 1.5):
                //    Must hide mesh via forceRenderingOff (no stale mesh stuck at screen edge),
                //    skip Transform writes, skip SampleAnimation, drop contact shadow, reject TryPick,
                //    and keep Skin.enabled intact so StationVisibilityTarget never permanently retires it.
                var offscreenPose = MakePose(simId, x: 200.0, y: 1.5, z: 1.0, heading: 1.4, walkDistance: 4.5);
                crowd.Render(new[] { offscreenPose }, simTimeSeconds: 2.0);

                Assert.IsTrue(actor.FrustumCulled, "offscreen actor must be marked FrustumCulled");
                Assert.IsTrue(actor.Skin.forceRenderingOff, "offscreen actor must suppress rendering so no stale mesh freezes at screen edge");
                Assert.IsTrue(actor.Skin.enabled, "Skin.enabled stays owned by StationVisibilityTarget");
                Assert.That((actor.Position - expectedCloseWorld).magnitude, Is.LessThan(1e-4f),
                    "frustum culling must happen BEFORE writing Root.transform.position");
                Assert.AreEqual(0, crowd.SampledThisFrame);
                Assert.AreEqual(1, crowd.FrustumCulledThisFrame);
                Assert.AreEqual(1, crowd.SkippedHiddenAnimationThisFrame);
                Assert.AreEqual(1, crowd.PosedThisFrame);
                Assert.AreEqual(1, crowd.VisibleActors, "storey-visible count remains stable across camera frustum changes");
                Assert.AreEqual(0, crowd.ContactShadowCount, "culled actor must not leave a stale contact shadow");
                var oldRay = new Ray(expectedCloseWorld + new Vector3(0f, 0.9f, -3f), Vector3.forward);
                Assert.IsFalse(crowd.TryPick(oldRay, 50f, out _), "culled actor cannot be picked at its pre-cull position");

                // Visibility switches while frustum-culled must NOT poison StationVisibilityTarget eligibility!
                visibility.State.ActiveLevel = -5; // actor on 0 m with ShowLevels = false -> Hidden
                visibility.State.ShowLevels = false;
                visibility.Apply();
                Assert.IsFalse(actor.Skin.enabled, "storey-hidden culled actor disables Skin.enabled via StationVisibilityTarget");
                visibility.State.ActiveLevel = 0;  // back to 0 m -> Base
                visibility.State.ShowLevels = true;
                visibility.Apply();
                Assert.IsTrue(actor.Skin.enabled, "returning to actor's storey restores Skin.enabled (eligibility never poisoned)");
                Assert.IsTrue(actor.Skin.forceRenderingOff, "still offscreen so forceRenderingOff stays true until re-entry");

                // 3) Actor walks BACK INTO frustum at doc (0, 80, 1) -> Unity (0, 1, 80), distance 82 m:
                //    Must restore rendering, snap exact position & rotation, switch LOD mesh to LOD2 for 82 m distance,
                //    and immediately resample animation on the re-entry frame.
                var reentryPose = MakePose(simId, x: 0.0, y: 80.0, z: 1.0, heading: Math.PI * 0.5, walkDistance: 9.75);
                crowd.Render(new[] { reentryPose }, simTimeSeconds: 5.0);

                Assert.IsFalse(actor.FrustumCulled, "re-entering frustum clears FrustumCulled");
                Assert.IsTrue(actor.Skin.enabled, "re-entry restores Skin.enabled");
                Assert.IsFalse(actor.Skin.forceRenderingOff, "re-entry restores visible rendering");
                Assert.IsTrue(actor.Root.activeSelf);
                var expectedReentryWorld = StationCoordinates.Point(new Vector3(0f, 80f, 1f));
                Assert.That((actor.Position - expectedReentryWorld).magnitude, Is.LessThan(1e-4f),
                    "re-entry immediately syncs exact Root.transform.position");
                Assert.That(Quaternion.Angle(actor.Rotation, PassengerAppearance.Rotation(Math.PI * 0.5)), Is.LessThan(0.05f),
                    "re-entry immediately syncs exact Root.transform.rotation");
                Assert.AreSame(simplifiedMesh, actor.Skin.sharedMesh,
                    "re-entry at 82 m updates LOD mesh to LOD2 instead of keeping stale close-up LOD0");
                var expectedGait = PassengerAppearance.Gait(in look, reentryPose.WalkDistance, reentryPose.WalkPhase, reentryPose.WalkWeight);
                Assert.AreEqual(1, crowd.SampledThisFrame, "re-entry must immediately run fresh SampleAnimation");
                Assert.AreEqual((float)expectedGait.SampleTime, actor.ClipTime, 1e-4f,
                    "re-entry animation sample reflects new walk distance with no stale pose");
                Assert.AreEqual(1, crowd.ContactShadowCount, "re-entry restores contact shadow");

                // 4) Cull again, then clear FrustumCameraOverride (!hasFrustum): must restore everything cleanly.
                var offscreenAgain = MakePose(simId, x: -180.0, y: 10.0, z: 1.0, heading: 2.1, walkDistance: 12.25);
                crowd.Render(new[] { offscreenAgain }, simTimeSeconds: 6.0);
                Assert.IsTrue(actor.FrustumCulled);
                Assert.IsTrue(actor.Skin.forceRenderingOff);

                crowd.FrustumCameraOverride = null;
                crowd.Render(new[] { offscreenAgain }, simTimeSeconds: 6.5);
                Assert.IsFalse(actor.FrustumCulled, "clearing frustum camera must un-cull previously culled actors");
                Assert.IsTrue(actor.Skin.enabled);
                Assert.IsFalse(actor.Skin.forceRenderingOff);
                var expectedNoFrustumWorld = StationCoordinates.Point(new Vector3(-180f, 10f, 1f));
                Assert.That((actor.Position - expectedNoFrustumWorld).magnitude, Is.LessThan(1e-4f));
                Assert.That(Quaternion.Angle(actor.Rotation, PassengerAppearance.Rotation(2.1)), Is.LessThan(0.05f));
                Assert.AreEqual(1, crowd.SampledThisFrame);
            } finally {
                var restore = new JObject { ["profile"] = origProfile, ["upscaling"] = origUpscaling };
                settings.TryHandle(new StationCommand { Type = "graphics.set", Payload = restore }, restore, out _, out _);
            }
        }

        [Test]
        public void PrecomputedFrustumCheckMatchesUnityTestPlanesAabbAcrossAllSixPlanes() {
            var camGo = new GameObject("PlaneParityCam");
            camGo.transform.SetParent(root.transform, false);
            var cam = camGo.AddComponent<Camera>();
            cam.enabled = false;
            cam.orthographic = false;
            cam.fieldOfView = 50f;
            cam.aspect = 16f / 9f;
            cam.nearClipPlane = 1.0f;
            cam.farClipPlane = 80f;
            cam.transform.SetPositionAndRotation(new Vector3(5f, 8f, -12f), Quaternion.Euler(20f, 15f, 0f));

            var crowd = PassengerCrowdView.Build(root.transform, catalogue);
            crowd.FrustumCameraOverride = cam;

            var planes = GeometryUtility.CalculateFrustumPlanes(cam);
            var sampleDocs = new[] {
                new Vector3(5f, 10f, 0f),      // center inside
                new Vector3(5f, -20f, 0f),     // behind camera (near plane)
                new Vector3(5f, 150f, 0f),     // beyond far plane
                new Vector3(-100f, 10f, 0f),   // far left
                new Vector3(120f, 10f, 0f),    // far right
                new Vector3(5f, 10f, 60f),     // far above
                new Vector3(5f, 10f, -60f),    // far below
                new Vector3(15f, 20f, 2f),     // angled inside
                new Vector3(-12f, 5f, 4f),     // near left edge
                new Vector3(28f, 35f, -5f),    // near right/bottom edge
            };

            var poses = new List<PassengerPose>(sampleDocs.Length);
            for (int i = 0; i < sampleDocs.Length; i++) {
                var d = sampleDocs[i];
                poses.Add(MakePose(500 + i, d.x, d.y, d.z));
            }
            crowd.Render(poses, simTimeSeconds: 1.0);

            for (int i = 0; i < sampleDocs.Length; i++) {
                var worldPos = StationCoordinates.Point(sampleDocs[i]);
                var expectedBounds = new Bounds(worldPos + new Vector3(0f, 0.9f, 0f), new Vector3(2.2f, 2.6f, 2.2f));
                bool unityInFrustum = GeometryUtility.TestPlanesAABB(planes, expectedBounds);
                Assert.IsTrue(crowd.TryGetActor(500 + i, out var actor));
                Assert.AreEqual(!unityInFrustum, actor.FrustumCulled,
                    $"Frustum test mismatch for sample {i} at world {worldPos}");
            }
        }

        [Test]
        public void MultiTickInterpolationMatchesReferenceOracleBitForBitAcrossResetsTicksTeleportsAndUnsortedFeeds() {
            PassengerCatalogueAnchor.Inject(catalogue);
            var read = BuildSimpleStation(floorZ: -5);
            var renderer = new PassengerCrowdRenderer();
            var world = new StationWorldView(root.transform, "InterpWorld", new IStationViewRenderer[] { renderer });
            disposables.Add(world);
            world.Build(read.Document, read.Index);
            world.Activate();

            var feedPoses = new List<PassengerPose>();
            PassengerPoseFeeds.SetSource(new DelegatePassengerPoseFeed(list => {
                list.AddRange(feedPoses);
                return true;
            }));

            var ridePath = new StationRidePath(new[] {
                (2.0, 2.0, -4.0),
                (2.5, 2.0, -4.0),
                (10.0, 2.0, 1.0),
                (10.5, 2.0, 1.0),
            });

            var oracle = new ReferenceInterpolator();
            double[] alphas = { 0.0, 0.25, 0.5, 1.0 };

            void RunTickAndVerify(long tick, long epoch, List<PassengerPose> framePoses, string label) {
                feedPoses.Clear();
                feedPoses.AddRange(framePoses);
                for (int a = 0; a < alphas.Length; a++) {
                    double alpha = alphas[a];
                    double simSec = tick * 0.0625;
                    var clock = new StationFrameClock(tick, epoch, simSec, simSec - (1.0 - alpha) * 0.0625, alpha, true);
                    renderer.Tick(read.Document, read.Index, clock);
                    var expected = oracle.Tick(framePoses, tick, epoch, (float)alpha);
                    var actual = renderer.LastPresentedSnapshot;
                    Assert.IsNotNull(actual, label);
                    Assert.AreEqual(expected.Count, actual.Count, $"{label} alpha={alpha}: count mismatch");
                    for (int i = 0; i < expected.Count; i++) {
                        AssertPoseBitIdentical(expected[i], actual[i], $"{label} alpha={alpha} index={i} id={expected[i].SimId}");
                    }
                }
            }

            try {
                // Tick 1 (reset, sorted ascending): walkers, escalator riders, teleport candidate, disappearing, hidden.
                ridePath.Sample(0.2, false, 0, out double r30x1, out double r30y1, out double r30z1, out double r30h1);
                RunTickAndVerify(1, 1, new List<PassengerPose> {
                    MakePose(10, 1.0, 1.0, -4.0, heading: 3.0, walkDistance: 2.0, walkPhase: 0.1, walkWeight: 1.0),
                    MakePose(20, 3.0, 1.0, -4.0, heading: 0.0, activity: PassengerActivity.Wait, walkDistance: 5.0, walkPhase: 0.3, walkWeight: 0.0, state: StationPassengerState.Queuing),
                    MakePose(30, r30x1, r30y1, r30z1, heading: r30h1, activity: PassengerActivity.Escalator, activitySeconds: 1.0, state: StationPassengerState.Riding, serverId: "ride:1", ridePath: ridePath, rideProgress: 0.2, rideSeconds: 10.0),
                    MakePose(40, 1.8, 2.1, -4.0, heading: 0.1, activity: PassengerActivity.Walk, walkDistance: 4.0, walkWeight: 1.0, state: StationPassengerState.Walking),
                    MakePose(50, 1.0, 4.0, -4.0, heading: 0.5, walkDistance: 1.0, walkWeight: 1.0),
                    MakePose(60, 2.0, 4.0, -4.0, heading: 0.2, walkDistance: 1.5, walkWeight: 1.0),
                    MakePose(70, 3.0, 4.0, -4.0, heading: 0.4, walkDistance: 0.5, walkWeight: 1.0, visible: false),
                }, "tick1-reset");

                // Tick 2: heading wrap across ±pi (#10), startedWalking (#20), escalator continue (#30),
                //         escalator entry easing (#40), non-adjacent teleport (#50), #60 disappears,
                //         #70 becomes visible (no blend from invisible prior), #80 newly appears.
                ridePath.Sample(0.5, false, 0, out double r30x2, out double r30y2, out double r30z2, out double r30h2);
                ridePath.Sample(0.15, false, 0, out double r40x2, out double r40y2, out double r40z2, out double r40h2);
                RunTickAndVerify(2, 1, new List<PassengerPose> {
                    MakePose(10, 1.8, 1.4, -4.0, heading: -3.0, walkDistance: 2.9, walkPhase: 0.15, walkWeight: 1.0),
                    MakePose(20, 3.4, 1.2, -4.0, heading: 0.3, activity: PassengerActivity.Walk, walkDistance: 5.5, walkPhase: 0.35, walkWeight: 0.9, state: StationPassengerState.Walking),
                    MakePose(30, r30x2, r30y2, r30z2, heading: r30h2, activity: PassengerActivity.Escalator, activitySeconds: 2.5, state: StationPassengerState.Riding, serverId: "ride:1", ridePath: ridePath, rideProgress: 0.5, rideSeconds: 10.0),
                    MakePose(40, r40x2, r40y2, r40z2, heading: r40h2, activity: PassengerActivity.Escalator, activitySeconds: 0.8, state: StationPassengerState.Riding, serverId: "ride:1", ridePath: ridePath, rideProgress: 0.15, rideSeconds: 10.0),
                    MakePose(50, 26.0, 4.0, -4.0, heading: 1.2, walkDistance: 2.0, walkWeight: 1.0),
                    MakePose(70, 3.5, 4.0, -4.0, heading: 0.7, walkDistance: 1.0, walkWeight: 1.0, visible: true),
                    MakePose(80, 6.0, 1.0, -4.0, heading: -0.5, walkDistance: 0.2, walkWeight: 1.0),
                }, "tick2-advance");

                // Tick 3: lift vertical adjacency (#10 enters lift), escalator exit (#30 RideProgress=1),
                //         escalator continue (#40), #60 re-appears after gap (must snap), #80 blends smoothly.
                ridePath.Sample(1.0, false, 0, out double r30x3, out double r30y3, out double r30z3, out double r30h3);
                ridePath.Sample(0.45, false, 0, out double r40x3, out double r40y3, out double r40z3, out double r40h3);
                RunTickAndVerify(3, 1, new List<PassengerPose> {
                    MakePose(10, 2.0, 1.5, -2.5, heading: -2.8, activity: PassengerActivity.Lift, activitySeconds: 0.4, walkDistance: 2.9, walkPhase: 0.15, walkWeight: 0.0, state: StationPassengerState.Riding, serverId: "lift:lift-1"),
                    MakePose(30, r30x3, r30y3, r30z3, heading: r30h3, activity: PassengerActivity.Walk, activitySeconds: 0.1, state: StationPassengerState.Walking, serverId: "", ridePath: ridePath, rideProgress: 1.0, rideSeconds: 10.0),
                    MakePose(40, r40x3, r40y3, r40z3, heading: r40h3, activity: PassengerActivity.Escalator, activitySeconds: 2.0, state: StationPassengerState.Riding, serverId: "ride:1", ridePath: ridePath, rideProgress: 0.45, rideSeconds: 10.0),
                    MakePose(60, 2.4, 4.2, -4.0, heading: 0.9, walkDistance: 3.0, walkWeight: 1.0),
                    MakePose(80, 6.9, 1.3, -4.0, heading: -0.2, walkDistance: 1.15, walkWeight: 1.0),
                }, "tick3-lift-and-reappear");

                // Epoch 2 reset: must clear prior tick linkage and snap to current tick.
                RunTickAndVerify(3, 2, new List<PassengerPose> {
                    MakePose(10, 5.0, 5.0, -4.0, heading: 1.0, walkDistance: 0.5, walkWeight: 1.0),
                    MakePose(80, 7.0, 2.0, -4.0, heading: 0.0, walkDistance: 2.0, walkWeight: 1.0),
                }, "epoch2-reset");

                // Unsorted SimIds (exercises dictionary fallback path!) across two consecutive ticks.
                RunTickAndVerify(4, 2, new List<PassengerPose> {
                    MakePose(80, 7.6, 2.4, -4.0, heading: 0.2, walkDistance: 2.7, walkWeight: 1.0),
                    MakePose(10, 5.5, 5.3, -4.0, heading: 1.3, walkDistance: 1.1, walkWeight: 1.0),
                    MakePose(95, 0.5, 0.5, -4.0, heading: -1.0, walkDistance: 0.1, walkWeight: 1.0),
                }, "tick4-unsorted");

                RunTickAndVerify(5, 2, new List<PassengerPose> {
                    MakePose(95, 1.1, 0.8, -4.0, heading: -0.7, walkDistance: 0.8, walkWeight: 1.0),
                    MakePose(10, 6.1, 5.5, -4.0, heading: 1.5, walkDistance: 1.8, walkWeight: 1.0),
                    MakePose(80, 8.2, 2.8, -4.0, heading: 0.4, walkDistance: 3.4, walkWeight: 1.0),
                }, "tick5-unsorted-advance");
            } finally {
                renderer.Release();
            }
        }

        [Test]
        public void ClipCacheAndStaticSupportCacheStayExactAcrossActivitiesAndDocumentEdits() {
            var readBefore = BuildSimpleStation(floorZ: -5, includeGroundExit: false);
            var readAfter = BuildSimpleStation(floorZ: -5, includeGroundExit: true);
            var visibility = new StationVisibilityRegistry(outfitMaterial.shader);
            disposables.Add(visibility);
            var world = new StationWorldView(root.transform, "CacheInvalidationWorld", Array.Empty<IStationViewRenderer>());
            disposables.Add(world);
            world.Build(readBefore.Document, readBefore.Index);
            world.Activate();
            world.BindVisibility(visibility);
            visibility.State.ActiveLevel = 0;
            visibility.State.ShowLevels = true;
            visibility.Apply();

            var resolverBefore = new PassengerSupportResolver(readBefore.Document, readBefore.Index);
            var crowd = PassengerCrowdView.Build(root.transform, catalogue);
            crowd.BindWorld(world, resolverBefore);

            // Walk -> Idle -> Escalator (right hand) -> Wait -> Walk: verify exact clip & sample time on every transition.
            const int simId = 303;
            var look = PassengerAppearance.Look(catalogue, simId);
            string expectedWalkClip = PassengerAppearance.WalkClipName(look.WalkProfile);

            crowd.Render(new[] { MakePose(simId, 1.5, 1.5, 1.0, activity: PassengerActivity.Walk, walkDistance: 1.2, walkWeight: 1.0) }, 1.0);
            Assert.IsTrue(crowd.TryGetActor(simId, out var actor));
            Assert.AreEqual(expectedWalkClip, actor.ClipName);
            Assert.IsTrue(actor.Target.GradeOwned, "0 m ground without an exit head-house is grade-owned");

            crowd.Render(new[] { MakePose(simId, 1.5, 1.5, 1.0, activity: PassengerActivity.Walk, walkDistance: 1.2, walkWeight: 0.0) }, 1.5);
            Assert.AreEqual("Idle", actor.ClipName);
            Assert.AreEqual(0f, actor.ClipTime, 1e-5f);

            crowd.Render(new[] { MakePose(simId, 1.5, 1.5, 1.0, activity: PassengerActivity.Escalator, activitySeconds: 3.0) }, 2.0);
            Assert.AreEqual("Escalator_Right", actor.ClipName);
            Assert.AreEqual(3.0f, actor.ClipTime, 1e-4f);

            crowd.Render(new[] { MakePose(simId, 1.5, 1.5, 1.0, activity: PassengerActivity.Wait, activitySeconds: 4.5) }, 2.5);
            Assert.AreEqual("Wait", actor.ClipName);
            Assert.AreEqual(4.5f, actor.ClipTime, 1e-4f);

            // Repeated identical Wait frame hits clip cache and skips redundant SampleAnimation.
            crowd.Render(new[] { MakePose(simId, 1.5, 1.5, 1.0, activity: PassengerActivity.Wait, activitySeconds: 4.5) }, 2.5);
            Assert.AreEqual(0, crowd.SampledThisFrame);
            Assert.AreEqual(1, crowd.SkippedUnchangedAnimationThisFrame);

            // Replacing the support resolver after placing an exit head-house at (0..3, 0..3, 0)
            // must invalidate the per-actor static support cache and flip GradeOwned from true -> false.
            var resolverAfter = resolverBefore.WithDocument(readAfter.Document, readAfter.Index);
            Assert.AreNotSame(resolverBefore, resolverAfter, "module page change yields a fresh PassengerSupportResolver");
            crowd.SetSupportResolver(resolverAfter);
            crowd.Render(new[] { MakePose(simId, 1.5, 1.5, 1.0, activity: PassengerActivity.Walk, walkDistance: 2.0, walkWeight: 1.0) }, 3.0);
            Assert.AreEqual(expectedWalkClip, actor.ClipName);
            Assert.IsFalse(actor.Target.GradeOwned, "adding an exit head-house flips 0 m footprint from grade-owned to non-grade");
        }

        [Test]
        public void PausedFrustumReEntryWithUnchangedPoseSkipsRedundantAnimationSample() {
            var read = BuildSimpleStation(floorZ: 0);
            var visibility = new StationVisibilityRegistry(outfitMaterial.shader);
            disposables.Add(visibility);
            var world = new StationWorldView(root.transform, "PausedReEntryWorld", Array.Empty<IStationViewRenderer>());
            disposables.Add(world);
            world.Build(read.Document, read.Index);
            world.Activate();
            world.BindVisibility(visibility);
            visibility.State.ActiveLevel = 0;
            visibility.State.ShowLevels = true;
            visibility.Apply();

            var camGo = new GameObject("PausedReEntryCam");
            camGo.transform.SetParent(root.transform, false);
            var cam = camGo.AddComponent<Camera>();
            cam.enabled = false;
            cam.orthographic = false;
            cam.fieldOfView = 45f;
            cam.aspect = 16f / 9f;
            cam.nearClipPlane = 0.5f;
            cam.farClipPlane = 150f;
            cam.transform.SetPositionAndRotation(new Vector3(0f, 2f, -2f), Quaternion.identity);

            var crowd = PassengerCrowdView.Build(root.transform, catalogue);
            crowd.BindWorld(world);
            crowd.FrustumCameraOverride = cam;

            var pose = MakePose(701, x: 0.0, y: 10.0, z: 1.0, walkDistance: 2.5);
            crowd.Render(new[] { pose }, simTimeSeconds: 1.0);
            Assert.AreEqual(1, crowd.SampledThisFrame, "first spawn samples immediately");

            // Swing camera away so actor is frustum-culled while simulation is paused (unchanged pose).
            cam.transform.SetPositionAndRotation(new Vector3(0f, 2f, -2f), Quaternion.Euler(0f, 180f, 0f));
            crowd.Render(new[] { pose }, simTimeSeconds: 1.0);
            Assert.AreEqual(1, crowd.FrustumCulledThisFrame);
            Assert.AreEqual(0, crowd.SampledThisFrame);

            // Swing camera back onto the paused actor: rig already holds the exact sampled pose -> 0 resamples.
            cam.transform.SetPositionAndRotation(new Vector3(0f, 2f, -2f), Quaternion.identity);
            crowd.Render(new[] { pose }, simTimeSeconds: 1.0);
            Assert.AreEqual(0, crowd.FrustumCulledThisFrame);
            Assert.AreEqual(0, crowd.SampledThisFrame, "paused re-entry with unchanged clip & time must not re-run SampleAnimation");
            Assert.AreEqual(1, crowd.SkippedUnchangedAnimationThisFrame);
        }

        [Test]
        public void MassFrustumReEntryRespectsAnimationAndLodBudgetsWithoutStampede() {
            var settings = CreateGraphicsSettings(out var origProfile, out var origUpscaling);
            try {
                SetGraphicsProfile(settings, "high");
                var read = BuildSimpleStation(floorZ: 0);
                var visibility = new StationVisibilityRegistry(outfitMaterial.shader);
                disposables.Add(visibility);
                var world = new StationWorldView(root.transform, "BudgetWorld", Array.Empty<IStationViewRenderer>());
                disposables.Add(world);
                world.Build(read.Document, read.Index);
                world.Activate();
                world.BindVisibility(visibility);
                visibility.State.ActiveLevel = 0;
                visibility.State.ShowLevels = true;
                visibility.Apply();

                var camGo = new GameObject("BudgetCam");
                camGo.transform.SetParent(root.transform, false);
                var cam = camGo.AddComponent<Camera>();
                cam.enabled = false;
                cam.orthographic = false;
                cam.fieldOfView = 45f;
                cam.aspect = 16f / 9f;
                cam.nearClipPlane = 0.5f;
                cam.farClipPlane = 200f;
                cam.transform.SetPositionAndRotation(new Vector3(0f, 2f, -2f), Quaternion.identity);

                var crowd = PassengerCrowdView.Build(root.transform, catalogue);
                crowd.BindWorld(world);
                crowd.FrustumCameraOverride = cam;
                crowd.AnimationSampleBudgetOverride = 96;
                crowd.LodSwapBudgetOverride = 48;

                const int count = 200;
                var initialPoses = new PassengerPose[count];
                for (int i = 0; i < count; i++) {
                    double x = -3.0 + (i % 20) * 0.3;
                    double y = 4.0 + (i / 20) * 0.3;
                    initialPoses[i] = MakePose(1000 + i, x, y, 1.0, walkDistance: 1.0);
                }

                // Frame 0: initial spawn — every unsampled actor samples immediately so zero T-poses appear.
                crowd.Render(initialPoses, simTimeSeconds: 1.0);
                Assert.AreEqual(count, crowd.SampledThisFrame, "initial spawn samples every new actor");

                // Frame 1: turn camera 180 deg away so all 200 actors leave frustum.
                cam.transform.SetPositionAndRotation(new Vector3(0f, 2f, -2f), Quaternion.Euler(0f, 180f, 0f));
                crowd.Render(initialPoses, simTimeSeconds: 1.5);
                Assert.AreEqual(count, crowd.FrustumCulledThisFrame);

                // Frame 2: snap camera back at far distance (~90 m -> LOD2) while all 200 actors advanced walkDistance.
                // Both animation resamples and LOD mesh swaps must stay capped by their per-frame budgets!
                cam.transform.SetPositionAndRotation(new Vector3(0f, 2f, -85f), Quaternion.identity);
                var movedPoses = new PassengerPose[count];
                for (int i = 0; i < count; i++) {
                    var p = initialPoses[i];
                    p.WalkDistance = 4.25;
                    movedPoses[i] = p;
                }
                crowd.Render(movedPoses, simTimeSeconds: 3.0);
                Assert.AreEqual(0, crowd.FrustumCulledThisFrame, "all 200 actors are visible again");
                Assert.LessOrEqual(crowd.SampledThisFrame, 96, "mass re-entry must obey animation sample budget");
                Assert.Greater(crowd.SampledThisFrame, 0, "budgeted re-entry still makes immediate progress");
                Assert.LessOrEqual(crowd.LodSwapsThisFrame, 48, "mass re-entry must obey LOD mesh swap budget");
                Assert.Greater(crowd.LodSwapsThisFrame, 0, "budgeted LOD swaps still make immediate progress");

                // Subsequent frames converge all 200 actors to simplifiedMesh (LOD2) cleanly.
                for (int f = 0; f < 6; f++) {
                    crowd.Render(movedPoses, simTimeSeconds: 3.0);
                }
                int atLod2 = 0;
                for (int i = 0; i < count; i++) {
                    Assert.IsTrue(crowd.TryGetActor(1000 + i, out var actor));
                    Assert.IsFalse(actor.Skin.forceRenderingOff);
                    if (ReferenceEquals(actor.Skin.sharedMesh, simplifiedMesh)) atLod2++;
                }
                Assert.AreEqual(count, atLod2, "all 200 actors converge to LOD2 over a few frames");
            } finally {
                var restore = new JObject { ["profile"] = origProfile, ["upscaling"] = origUpscaling };
                settings.TryHandle(new StationCommand { Type = "graphics.set", Payload = restore }, restore, out _, out _);
            }
        }

        [Test]
        public void NewSpawnBudgetAndInstancedCoalescingAndStreamingCrowdJsonHoldContracts() {
            // 1. Cold prefab instantiation budget caps spawns per frame and converges cleanly.
            var read = BuildSimpleStation(floorZ: 0);
            var crowd = PassengerCrowdView.Build(root.transform, catalogue);
            crowd.NewSpawnBudgetOverride = 12;
            var poses = new PassengerPose[30];
            for (int i = 0; i < poses.Length; i++) {
                poses[i] = MakePose(2000 + i, i * 0.4, 2.0, 1.0, walkDistance: 1.0);
            }
            crowd.Render(poses, simTimeSeconds: 1.0);
            Assert.AreEqual(12, crowd.Spawned, "frame 1 caps cold prefab instantiations to budget");
            crowd.Render(poses, simTimeSeconds: 1.1);
            Assert.AreEqual(24, crowd.Spawned, "frame 2 instantiates next slice");
            crowd.Render(poses, simTimeSeconds: 1.2);
            Assert.AreEqual(30, crowd.Spawned, "frame 3 completes full crowd without drops");

            // 2. StationInstancedSurfaceDrawer coalesces matching spatial chunks into fewer GPU draw calls.
            var drawerRoot = new GameObject("CoalesceDrawer");
            drawerRoot.transform.SetParent(root.transform, false);
            var drawerCamGo = new GameObject("CoalesceCam");
            drawerCamGo.transform.SetParent(root.transform, false);
            var drawerCam = drawerCamGo.AddComponent<Camera>();
            drawerCam.enabled = false;
            drawerCam.orthographic = false;
            drawerCam.fieldOfView = 60f;
            drawerCam.aspect = 16f / 9f;
            drawerCam.nearClipPlane = 0.5f;
            drawerCam.farClipPlane = 200f;
            drawerCam.transform.SetPositionAndRotation(new Vector3(10f, 5f, -30f), Quaternion.identity);
            var drawer = StationInstancedSurfaceDrawer.EnsureFor(drawerRoot.transform);
            var instMat = new Material(outfitMaterial) { enableInstancing = true };
            try {
                for (int c = 0; c < 6; c++) {
                    var chunkGo = new GameObject("chunk-" + c);
                    chunkGo.transform.SetParent(drawerRoot.transform, false);
                    var mr = chunkGo.AddComponent<MeshRenderer>();
                    mr.sharedMaterial = instMat;
                    var batch = chunkGo.AddComponent<StationInstancedSurfaceBatch>();
                    var instances = new List<CombineInstance> {
                        new CombineInstance { mesh = fullMesh, transform = Matrix4x4.Translate(new Vector3(c * 4f, 0f, 0f)) },
                        new CombineInstance { mesh = fullMesh, transform = Matrix4x4.Translate(new Vector3(c * 4f + 1f, 0f, 0f)) },
                    };
                    batch.Configure(fullMesh, 0, mr, new Bounds(new Vector3(c * 4f, 0.5f, 0f), Vector3.one * 2f),
                        instances, 2, new List<int> { 0, 1 });
                    drawer.Add(batch);
                }
                drawer.SubmitNow(cameraOverride: drawerCam);
                Assert.AreEqual(6, drawer.LastSubmittedBatches, "all 6 spatial chunks were submitted");
                Assert.AreEqual(1, drawer.LastSubmittedDrawCalls, "6 identical chunks coalesce into 1 instanced GPU draw call");
            } finally {
                UnityEngine.Object.DestroyImmediate(instMat);
            }

            // 3. Streaming crowd JSON matches JObject Build() field-for-field.
            var published = new StationPublishedSimFrame {
                HasServices = true,
                PublishedPassengerLimit = 32,
                QueuedTotal = 3,
                GateQueueTotal = 2,
                BoardedOnboard = 5,
                Spawned = 10,
                Boarded = 6,
                Alighted = 4,
                Exited = 2,
                Stuck = 0,
                Motion = new StationMotionFrame {
                    Passengers = new[] {
                        new StationPassengerFrame {
                            SimId = 42, X = 1.5, Y = 2.5, Z = -4.0, Heading = 0.5,
                            Activity = StationPassengerActivity.Walk, ActivitySeconds = 1.2,
                            WalkDistance = 3.4, WalkPhase = 0.25, WalkWeight = 1.0,
                            State = StationPassengerState.Walking, ServerId = "", Visible = true,
                        },
                    },
                    Gates = new[] {
                        new StationGateFrame {
                            Id = "g-1", Server = 12, Queue = 1, Served = 7, Rate = 0.5,
                            Batch = 1, Cycle = 2, State = StationGateState.Idle, Mode = 0,
                            Lane = 0, Open = 1.0,
                        },
                    },
                },
            };
            var expectedObj = StationCrowdStateContributor.Build(published);
            var actualJson = StationCrowdStateContributor.BuildJson(published);
            var actualObj = JObject.Parse(actualJson);
            Assert.IsTrue(JToken.DeepEquals(expectedObj, actualObj),
                "streaming BuildJson must match JObject Build() identically.\nExpected: " + expectedObj + "\nActual: " + actualObj);
        }

        static void AssertPoseBitIdentical(PassengerPose expected, PassengerPose actual, string context) {
            Assert.AreEqual(expected.SimId, actual.SimId, context + " SimId");
            Assert.AreEqual(expected.Visible, actual.Visible, context + " Visible");
            Assert.AreEqual(expected.Activity, actual.Activity, context + " Activity");
            Assert.AreEqual(expected.State, actual.State, context + " State");
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expected.X), BitConverter.DoubleToInt64Bits(actual.X), context + " X");
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expected.Y), BitConverter.DoubleToInt64Bits(actual.Y), context + " Y");
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expected.Z), BitConverter.DoubleToInt64Bits(actual.Z), context + " Z");
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expected.Heading), BitConverter.DoubleToInt64Bits(actual.Heading), context + " Heading");
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expected.ActivitySeconds), BitConverter.DoubleToInt64Bits(actual.ActivitySeconds), context + " ActivitySeconds");
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expected.RideProgress), BitConverter.DoubleToInt64Bits(actual.RideProgress), context + " RideProgress");
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expected.WalkDistance), BitConverter.DoubleToInt64Bits(actual.WalkDistance), context + " WalkDistance");
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expected.WalkPhase), BitConverter.DoubleToInt64Bits(actual.WalkPhase), context + " WalkPhase");
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expected.WalkWeight), BitConverter.DoubleToInt64Bits(actual.WalkWeight), context + " WalkWeight");
        }

        /// <summary>
        /// Exact dictionary-based reference implementation of PassengerCrowdRenderer.Tick's
        /// pre-optimization interpolation semantics.
        /// </summary>
        sealed class ReferenceInterpolator {
            readonly Dictionary<int, PassengerPose> previousPoses = new Dictionary<int, PassengerPose>();
            readonly Dictionary<int, PassengerPose> lastTickPoses = new Dictionary<int, PassengerPose>();
            bool hasTick;
            long lastTick = long.MinValue;
            long lastEpoch = long.MinValue;

            public List<PassengerPose> Tick(List<PassengerPose> poses, long tick, long epoch, float alpha) {
                bool reset = !hasTick || epoch != lastEpoch;
                if (reset) {
                    previousPoses.Clear();
                    for (int i = 0; i < poses.Count; i++) previousPoses[poses[i].SimId] = poses[i];
                    lastTickPoses.Clear();
                    for (int i = 0; i < poses.Count; i++) lastTickPoses[poses[i].SimId] = poses[i];
                    hasTick = true;
                } else if (tick != lastTick) {
                    previousPoses.Clear();
                    foreach (var pair in lastTickPoses) previousPoses[pair.Key] = pair.Value;
                    lastTickPoses.Clear();
                    for (int i = 0; i < poses.Count; i++) lastTickPoses[poses[i].SimId] = poses[i];
                }
                lastTick = tick;
                lastEpoch = epoch;

                var result = new List<PassengerPose>(poses.Count);
                for (int i = 0; i < poses.Count; i++) {
                    var current = poses[i];
                    if (alpha >= 1f || !current.Visible ||
                        !previousPoses.TryGetValue(current.SimId, out var prior) || !prior.Visible ||
                        !Adjacent(prior, current)) {
                        result.Add(current);
                        continue;
                    }
                    var blend = current;
                    blend.X = Lerp(prior.X, current.X, alpha);
                    blend.Y = Lerp(prior.Y, current.Y, alpha);
                    blend.Z = Lerp(prior.Z, current.Z, alpha);
                    blend.Heading = LerpAngle(prior.Heading, current.Heading, alpha);
                    if (prior.Activity == current.Activity)
                        blend.ActivitySeconds = Lerp(prior.ActivitySeconds, current.ActivitySeconds, alpha);
                    if (current.RidePath != null &&
                        (current.RidePath == prior.RidePath && current.ServerId == prior.ServerId ||
                         prior.RidePath == null && current.State == StationPassengerState.Riding ||
                         current.RideProgress == 1 && prior.State == StationPassengerState.Riding &&
                            prior.RidePath == current.RidePath)) {
                        bool starting = prior.RidePath == null;
                        blend.RideProgress = Lerp(starting ? 0 : prior.RideProgress, current.RideProgress, alpha);
                        current.RidePath.Sample(blend.RideProgress, current.RideReverse, current.RideColumn,
                            out double x, out double y, out double z, out double heading);
                        if (starting) {
                            current.RidePath.Sample(0, current.RideReverse, current.RideColumn,
                                out double sx, out double sy, out double sz, out _);
                            x += (prior.X - sx) * (1 - alpha);
                            y += (prior.Y - sy) * (1 - alpha);
                            z += (prior.Z - sz) * (1 - alpha);
                        }
                        blend.X = x; blend.Y = y; blend.Z = z; blend.Heading = heading;
                        if (current.RideProgress == 1 && prior.Activity != PassengerActivity.Walk) blend.Activity = prior.Activity;
                    }
                    blend.WalkDistance = Lerp(prior.WalkDistance, current.WalkDistance, alpha);
                    blend.WalkPhase = Lerp(prior.WalkPhase, current.WalkPhase, alpha);
                    bool startedWalking = current.Activity == PassengerActivity.Walk &&
                        current.WalkWeight > 0.5 &&
                        current.WalkDistance - prior.WalkDistance > 0.05;
                    blend.WalkWeight = startedWalking ? current.WalkWeight : Lerp(prior.WalkWeight, current.WalkWeight, alpha);
                    result.Add(blend);
                }
                return result;
            }

            static bool Adjacent(PassengerPose prior, PassengerPose current) {
                bool ground = IsOnFoot(prior.State) && IsOnFoot(current.State);
                bool ramp = current.RidePath != null &&
                    (prior.RidePath == current.RidePath || prior.RidePath == null && IsOnFoot(prior.State));
                bool priorLift = prior.ServerId != null && prior.ServerId.StartsWith("lift:", StringComparison.Ordinal);
                bool currentLift = current.ServerId != null && current.ServerId.StartsWith("lift:", StringComparison.Ordinal);
                bool lift = (priorLift && currentLift && string.Equals(prior.ServerId, current.ServerId, StringComparison.Ordinal)) ||
                    (priorLift && IsOnFoot(current.State)) ||
                    (currentLift && IsOnFoot(prior.State));
                bool trainTransfer =
                    (prior.State == StationPassengerState.Alighting && IsOnFoot(current.State)) ||
                    (IsOnFoot(prior.State) && current.State == StationPassengerState.Boarding);
                if (!ground && !ramp && !lift && !trainTransfer &&
                    (prior.State != current.State || !string.Equals(prior.ServerId, current.ServerId, StringComparison.Ordinal)))
                    return false;
                double dx = current.X - prior.X, dy = current.Y - prior.Y, dz = current.Z - prior.Z;
                double maxPlanar = trainTransfer ? 4.5 : 3.0;
                return Math.Abs(dz) < (lift ? 3.0 : ramp ? 2.0 : .75) && dx * dx + dy * dy < maxPlanar * maxPlanar;
            }

            static bool IsOnFoot(StationPassengerState state) =>
                state == StationPassengerState.Walking || state == StationPassengerState.Queuing ||
                state == StationPassengerState.Buying || state == StationPassengerState.Browsing;

            static double Lerp(double from, double to, double alpha) => from + (to - from) * alpha;

            static double LerpAngle(double from, double to, double alpha) {
                double delta = to - from;
                while (delta > Math.PI) delta -= Math.PI * 2;
                while (delta < -Math.PI) delta += Math.PI * 2;
                return from + delta * alpha;
            }
        }
    }
}
