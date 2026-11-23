using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.EditModeTests {
    /// <summary>
    /// Parity suite for Domain D6a: Passenger eye follow &amp; crowd tick/picking/ramp clips,
    /// PassengerAppearance 50k distribution &amp; catalogue sweeps, Prefab batching/instancing/
    /// chunk caching, Cell mesher AO/seams/PSD/Tianhe ceiling invalidation, Rigid LODs,
    /// Pillars/Finishes/RuntimeCatalogue, Stock D PSD openings, and Escalator indicators.
    /// </summary>
    public sealed class StationPassengerAndBatchParityTests {
        readonly List<UnityEngine.Object> ownedObjects = new List<UnityEngine.Object>();
        readonly List<IDisposable> ownedDisposables = new List<IDisposable>();

        [TearDown]
        public void TearDown() {
            PassengerPoseFeeds.Clear();
            PassengerCatalogueAnchor.ClearInjection();
            StationEditSession.Reset();
            for (int i = ownedDisposables.Count - 1; i >= 0; i--) {
                ownedDisposables[i]?.Dispose();
            }
            ownedDisposables.Clear();
            for (int i = ownedObjects.Count - 1; i >= 0; i--) {
                if (ownedObjects[i] != null) UnityEngine.Object.DestroyImmediate(ownedObjects[i]);
            }
            ownedObjects.Clear();
        }

        T Track<T>(T obj) where T : UnityEngine.Object {
            if (obj != null) ownedObjects.Add(obj);
            return obj;
        }

        T TrackDisposable<T>(T item) where T : IDisposable {
            if (item != null) ownedDisposables.Add(item);
            return item;
        }

        static PassengerCatalogue LoadLocalPassengerCatalogueOrIgnore() {
            var catalogue = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(PassengerCatalogue.AssetPath);
            if (catalogue == null || catalogue.entries == null || catalogue.entries.Length == 0) {
                Assert.Ignore("Local passenger catalogue is not installed.");
            }
            return catalogue;
        }

        static StationDocument ParseDocument(string json, string name = "d6a-fixture") {
            var obj = JObject.Parse(json);
            if ((string)obj["format"] != StationDocumentReader.SaveFormat) {
                var wrapped = new JObject {
                    ["format"] = StationDocumentReader.SaveFormat,
                    ["formatVersion"] = StationDocumentReader.SupportedVersion,
                    ["gameVersion"] = "0.2.0",
                    ["savedAt"] = StationDocumentReader.FixedSavedAt,
                    ["name"] = name,
                    ["city"] = "guangzhou",
                    ["seed"] = 1,
                    ["levelBase"] = obj["levelBase"] ?? 0,
                    ["storeyHeight"] = obj["storeyHeight"] ?? 5,
                    ["static"] = new JObject {
                        ["cells"] = obj["cells"] ?? new JArray(),
                        ["modules"] = obj["modules"] ?? new JArray(),
                        ["lines"] = obj["lines"] ?? new JArray(),
                    },
                };
                json = wrapped.ToString(Newtonsoft.Json.Formatting.None);
            }
            var parsed = StationDocumentReader.Read(json, new StationSource(name, ""));
            Assert.IsNotNull(parsed?.Document, $"Failed to parse fixture {name}");
            return parsed.Document;
        }

        static Material CreateTestMaterial(string name) {
            var shader = Shader.Find("Universal Render Pipeline/Lit")
                ?? Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Sprites/Default");
            return new Material(shader) { name = name };
        }

        static Mesh CreateUnitBoxMesh(string name) {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var clone = UnityEngine.Object.Instantiate(go.GetComponent<MeshFilter>().sharedMesh);
            clone.name = name;
            UnityEngine.Object.DestroyImmediate(go);
            return clone;
        }

        /* ==================================== PASSENGER EYE VIEW & CROWD TICK */

        [Test]
        public void PassengerEyeFollowTracksHeadingAllowsIndependentLookForcesLod0AndRestoresOnDeparture() {
            var catalogue = LoadLocalPassengerCatalogueOrIgnore();
            PassengerCatalogueAnchor.Inject(catalogue);

            var rigField = typeof(StationViewFeature).GetField("rig", BindingFlags.Static | BindingFlags.NonPublic);
            Assert.IsNotNull(rigField);
            var previousRig = (StationViewRig)rigField.GetValue(null);

            var rootGo = Track(new GameObject("EyeFollowWorld"));
            var camGo = Track(new GameObject("EyeFollowCamera"));
            var cam = camGo.AddComponent<Camera>();
            cam.enabled = false;
            cam.nearClipPlane = 0.5f;
            var rigGo = Track(new GameObject("EyeFollowRig"));
            var rig = rigGo.AddComponent<StationViewRig>();

            var doc = ParseDocument(
                "{\"v\":1,\"levelBase\":0,\"storeyHeight\":5,\"cells\":[" +
                "{\"x\":0,\"y\":0,\"z\":-5},{\"x\":1,\"y\":0,\"z\":-5},{\"x\":2,\"y\":0,\"z\":-5}" +
                "],\"modules\":[]}",
                "eye-follow");
            var index = new StationIndex(doc);
            var grid = StationLevelGrid.FromDocument(0, 5);
            rig.Configure(cam, new Bounds(new Vector3(1f, 0f, -5f), new Vector3(10f, 10f, 10f)), grid, -5);
            var crowdRenderer = new PassengerCrowdRenderer();
            var world = TrackDisposable(new StationWorldView(
                rootGo.transform, "EyeFollowWorld", new IStationViewRenderer[] { crowdRenderer }));
            world.Build(doc, index);
            world.Activate();
            world.BindVisibility(rig.Visibility);

            var currentPoses = new List<PassengerPose>();
            PassengerPoseFeeds.SetSource(new DelegatePassengerPoseFeed(list => {
                list.AddRange(currentPoses);
                return true;
            }));

            try {
                rigField.SetValue(null, rig);
                float orbitNear = cam.nearClipPlane;

                const int followedId = 42;
                float initialHeading = 0.6f;
                currentPoses.Add(new PassengerPose {
                    SimId = followedId,
                    X = 1.5, Y = 0.5, Z = -4.0,
                    Heading = initialHeading,
                    Activity = PassengerActivity.Walk,
                    WalkDistance = 1.2,
                    WalkWeight = 1.0,
                    HasWalkWeight = true,
                    Detail = PassengerDetail.Low,
                    State = StationPassengerState.Walking,
                    Visible = true,
                });

                var clock = new StationFrameClock(1, 1, 1.0, 1.0, 1.0, true);
                crowdRenderer.Tick(doc, index, clock);

                Assert.IsTrue(crowdRenderer.TryGetEyePose(followedId, out var eyePos, out float eyeHeading));
                Assert.AreEqual(initialHeading, eyeHeading, 1e-4f);

                // Enable passenger eye follow.
                rig.Visibility.State.FollowPassenger = followedId;
                crowdRenderer.Tick(doc, index, new StationFrameClock(2, 1, 1.1, 1.1, 1.0, true));
                rig.Tick(0.016f);

                Assert.IsTrue(crowdRenderer.View.TryGetActor(followedId, out var actor));
                Assert.IsTrue(actor.Skin.forceRenderingOff, "Followed passenger must hide its own mesh from the eye camera");
                var meshTierField = typeof(PassengerCrowdActor).GetField("MeshTier", BindingFlags.Instance | BindingFlags.NonPublic);
                Assert.AreEqual(0, (int)meshTierField.GetValue(actor), "Followed passenger must force LOD0");
                var expectedFullMesh = actor.Entry.prefab.GetComponentInChildren<SkinnedMeshRenderer>(true).sharedMesh;
                Assert.AreSame(expectedFullMesh, actor.Skin.sharedMesh, "Followed passenger uses FullMesh even on Detail.Low");

                Assert.IsFalse(cam.orthographic, "Eye follow forces perspective");
                Assert.AreEqual(75f, cam.fieldOfView, 1e-4f, "Eye follow sets 75° FOV");
                Assert.AreEqual(0.05f, cam.nearClipPlane, 1e-4f, "Eye follow sets 0.05 m near clip");
                var expectedInitialForward = new Vector3(Mathf.Cos(initialHeading), 0f, Mathf.Sin(initialHeading)).normalized;
                Assert.Greater(Vector3.Dot(cam.transform.forward, expectedInitialForward), 0.999f,
                    "Initial eye look direction matches pose.Heading");

                // Mouse-look rotates eyeYaw/eyePitch independently of passenger heading turns and clamps pitch to [-1.56, 1.56].
                Assert.IsTrue(rig.Execute("{\"type\":\"camera.orbit\",\"payload\":{\"dx\":250,\"dy\":-2000}}", out var orbitCode), orbitCode);
                var updatedPose = currentPoses[0];
                updatedPose.Heading = initialHeading + 1.4; // passenger turns sharply
                currentPoses[0] = updatedPose;
                crowdRenderer.Tick(doc, index, new StationFrameClock(3, 1, 1.2, 1.2, 1.0, true));
                rig.Tick(0.016f);

                float expectedYaw = initialHeading - 250f * 0.003f;
                float expectedPitch = 1.56f;
                var expectedLook = new Vector3(
                    Mathf.Cos(expectedPitch) * Mathf.Cos(expectedYaw),
                    Mathf.Sin(expectedPitch),
                    Mathf.Cos(expectedPitch) * Mathf.Sin(expectedYaw)).normalized;
                Assert.Greater(Vector3.Dot(cam.transform.forward, expectedLook), 0.999f,
                    "Mouse-look stays independent of passenger turns and clamps pitch to +1.56 rad");

                // Negative extreme pitch clamps to -1.56 rad.
                Assert.IsTrue(rig.Execute("{\"type\":\"camera.orbit\",\"payload\":{\"dx\":0,\"dy\":4000}}", out orbitCode), orbitCode);
                rig.Tick(0.016f);
                Assert.AreEqual(Mathf.Sin(-1.56f), cam.transform.forward.y, 1e-3f, "Pitch clamps at -1.56 rad");

                // Hiding the passenger's storey via ShowLevels=false still keeps TryGetEyePose live.
                rig.Visibility.State.ActiveLevel = 0;
                rig.Visibility.State.ShowLevels = false;
                rig.Visibility.Apply();
                var movedHidden = currentPoses[0];
                movedHidden.X = 2.0;
                currentPoses[0] = movedHidden;
                crowdRenderer.Tick(doc, index, new StationFrameClock(4, 1, 1.3, 1.3, 1.0, true));
                Assert.IsFalse(actor.Visible, "Actor on non-active storey with ShowLevels=false is hidden");
                Assert.IsTrue(crowdRenderer.TryGetEyePose(followedId, out var hiddenEyePos, out _),
                    "TryGetEyePose still updates while actor rendering is hidden");
                Assert.AreEqual(StationCoordinates.Point(new Vector3(2.0f, 0.5f, (float)(-4.0 + 1.48 * actor.Look.Height))).x,
                    hiddenEyePos.x, 1e-3f);

                // Departure removes the passenger from the feed -> clears FollowPassenger and restores camera near clip.
                currentPoses.Clear();
                crowdRenderer.Tick(doc, index, new StationFrameClock(5, 1, 1.4, 1.4, 1.0, true));
                rig.Tick(0.016f);
                Assert.AreEqual(-1, rig.Visibility.State.FollowPassenger, "Departure clears FollowPassenger to -1");
                Assert.AreEqual(orbitNear, cam.nearClipPlane, 1e-4f, "Departure restores orbit nearClipPlane");
            } finally {
                rigField.SetValue(null, previousRig);
                crowdRenderer.Release();
            }
        }

        [Test]
        public void CrowdRendererInterpolatesFreezesOnPauseCompactsIdentitiesPicksAndSelectsRampClips() {
            var catalogue = LoadLocalPassengerCatalogueOrIgnore();
            PassengerCatalogueAnchor.Inject(catalogue);

            var rootGo = Track(new GameObject("CrowdTickWorld"));
            var doc = ParseDocument(
                "{\"v\":1,\"levelBase\":0,\"storeyHeight\":5,\"cells\":[" +
                "{\"x\":0,\"y\":0,\"z\":-5},{\"x\":1,\"y\":0,\"z\":-5},{\"x\":2,\"y\":0,\"z\":-5},{\"x\":3,\"y\":0,\"z\":-5}" +
                "],\"modules\":[]}",
                "crowd-tick");
            var index = new StationIndex(doc);
            var renderer = new PassengerCrowdRenderer();
            var world = TrackDisposable(new StationWorldView(
                rootGo.transform, "CrowdTickWorld", new IStationViewRenderer[] { renderer }));
            world.Build(doc, index);
            world.Activate();

            var feedPoses = new List<PassengerPose>();
            PassengerPoseFeeds.SetSource(new DelegatePassengerPoseFeed(list => {
                list.AddRange(feedPoses);
                return true;
            }));

            try {
                // Tick 1: passenger 10 (walker/stair), passenger 20 (escalator rider), passenger 5 (to be compacted away).
                feedPoses.Add(new PassengerPose {
                    SimId = 5, X = 0.2, Y = 0.5, Z = -4.0, Heading = 0,
                    Activity = PassengerActivity.Walk, WalkDistance = 0.5, WalkWeight = 1.0, HasWalkWeight = true,
                    State = StationPassengerState.Walking, Visible = true,
                });
                feedPoses.Add(new PassengerPose {
                    SimId = 10, X = 1.0, Y = 0.5, Z = -4.0, Heading = 0,
                    Activity = PassengerActivity.Walk, WalkDistance = 1.0, WalkWeight = 1.0, HasWalkWeight = true,
                    State = StationPassengerState.Walking, Visible = true,
                });
                feedPoses.Add(new PassengerPose {
                    SimId = 20, X = 2.5, Y = 0.5, Z = -4.0, Heading = 0,
                    Activity = PassengerActivity.Escalator, ActivitySeconds = 1.0, RideSeconds = 6.0, RideProgress = 0.4,
                    State = StationPassengerState.Riding, Visible = true,
                });
                renderer.Tick(doc, index, new StationFrameClock(1, 1, 1.0, 1.0, 1.0, true));

                // Tick 2 at Fraction = 0.25: passenger 10 advances from X=1.0 to X=2.0 -> interpolated X == 1.25.
                // Passenger 5 departs -> compacted/hidden cleanly while 10 & 20 keep identity.
                feedPoses.Clear();
                feedPoses.Add(new PassengerPose {
                    SimId = 10, X = 2.0, Y = 0.5, Z = -4.0, Heading = 0,
                    Activity = PassengerActivity.Walk, WalkDistance = 2.0, WalkWeight = 1.0, HasWalkWeight = true,
                    State = StationPassengerState.Walking, Visible = true,
                });
                feedPoses.Add(new PassengerPose {
                    SimId = 20, X = 2.8, Y = 0.5, Z = -4.0, Heading = 0,
                    Activity = PassengerActivity.Escalator, ActivitySeconds = 1.2, RideSeconds = 6.0, RideProgress = 0.5,
                    State = StationPassengerState.Riding, Visible = true,
                });
                renderer.Tick(doc, index, new StationFrameClock(2, 1, 1.25, 1.25, 0.25, true));

                Assert.IsTrue(renderer.View.TryGetActor(5, out var departed));
                Assert.IsFalse(departed.Visible, "Departed identity 5 is hidden after compaction");

                Assert.IsTrue(renderer.View.TryGetActor(10, out var walker));
                Assert.IsTrue(renderer.View.TryGetActor(20, out var rider));
                var expectedInterpWorld = StationCoordinates.Point(new Vector3(1.25f, 0.5f, -4.0f));
                Assert.AreEqual(expectedInterpWorld.x, walker.Root.transform.position.x, 1e-3f,
                    "Sub-tick Fraction=0.25 linearly interpolates X from 1.0 toward 2.0");

                // Ramp clip parity: stair/foot walker samples Walk* clip; escalator rider samples Escalator* clip.
                Assert.IsTrue(walker.ClipName.StartsWith("Walk", StringComparison.Ordinal),
                    $"Stair/foot walker should sample Walk* clip, got '{walker.ClipName}'");
                Assert.IsTrue(rider.ClipName.StartsWith("Escalator", StringComparison.Ordinal),
                    $"Escalator rider should sample Escalator* clip, got '{rider.ClipName}'");

                // Pause freeze: repeating same Tick & Fraction holds exact position and clip time.
                Vector3 frozenPos = walker.Root.transform.position;
                float frozenTime = walker.ClipTime;
                renderer.Tick(doc, index, new StationFrameClock(2, 1, 1.25, 1.25, 0.25, false));
                Assert.AreEqual(frozenPos, walker.Root.transform.position, "Paused tick freezes interpolated pose");
                Assert.AreEqual(frozenTime, walker.ClipTime, 1e-5f, "Paused tick freezes clip time");

                // TryPick hits interpolated/paused actor at both head and legs heights, and misses when hidden.
                var pickCtx = new StationPickContext(~0, 0f, 100f, null, null, false);
                var bounds = walker.Skin.bounds;
                var headTarget = new Vector3(bounds.center.x, bounds.min.y + bounds.size.y * 0.85f, bounds.center.z);
                var legTarget = new Vector3(bounds.center.x, bounds.min.y + bounds.size.y * 0.20f, bounds.center.z);
                var headRay = new Ray(headTarget + Vector3.back * 5f, Vector3.forward);
                var legRay = new Ray(legTarget + Vector3.back * 5f, Vector3.forward);
                Assert.IsTrue(renderer.TryPick(world, headRay, 100f, in pickCtx, out int pickedHead));
                Assert.AreEqual(10, pickedHead, "TryPick hits interpolated passenger head");
                Assert.IsTrue(renderer.TryPick(world, legRay, 100f, in pickCtx, out int pickedLeg));
                Assert.AreEqual(10, pickedLeg, "TryPick hits interpolated passenger legs");

                renderer.View.HideAll();
                Assert.IsFalse(renderer.TryPick(world, headRay, 100f, in pickCtx, out _),
                    "TryPick must return false when crowd is hidden");
            } finally {
                renderer.Release();
            }
        }

        /* ========================================= PASSENGER SWEEPS & LODS */

        [Test]
        public void PassengerAppearanceFiftyThousandSweepMatchesAgeSizeIndependenceAndUniformPools() {
            const int N = 50000;
            const int PoolSize = 20;
            int childCount = 0;
            double sumH = 0, sumW = 0, sumD = 0, sumHH = 0, sumWW = 0, sumDD = 0, sumHW = 0, sumHD = 0, sumWD = 0;
            int adultCount = 0;
            var profileCounts = new int[3];
            var outfitCounts = new int[PoolSize];
            var crossTab = new int[3, PoolSize];

            for (int id = 1; id <= N; id++) {
                bool isChild = PassengerAppearance.IsChild(id);
                PassengerAppearance.Proportions(id, out double h, out double d, out double w, out double tone);
                Assert.GreaterOrEqual(tone, PassengerAppearance.ToneMin - 1e-9);
                Assert.LessOrEqual(tone, PassengerAppearance.ToneMin + PassengerAppearance.ToneSpan + 1e-9);

                if (isChild) {
                    childCount++;
                    Assert.GreaterOrEqual(h, PassengerAppearance.HeightMin * PassengerAppearance.ChildHeightScale - 1e-9);
                    Assert.LessOrEqual(h, PassengerAppearance.HeightMax * PassengerAppearance.ChildHeightScale + 1e-9);
                    Assert.GreaterOrEqual(w, PassengerAppearance.ChildWidthMin * PassengerAppearance.ChildHorizontalScale - 1e-9);
                    Assert.LessOrEqual(w, PassengerAppearance.ChildWidthMax * PassengerAppearance.ChildHorizontalScale + 1e-9);
                    Assert.GreaterOrEqual(d, PassengerAppearance.ChildDepthMin * PassengerAppearance.ChildHorizontalScale - 1e-9);
                    Assert.LessOrEqual(d, PassengerAppearance.ChildDepthMax * PassengerAppearance.ChildHorizontalScale + 1e-9);
                } else {
                    adultCount++;
                    Assert.GreaterOrEqual(h, PassengerAppearance.HeightMin - 1e-9);
                    Assert.LessOrEqual(h, PassengerAppearance.HeightMax + 1e-9);
                    Assert.GreaterOrEqual(w, PassengerAppearance.WidthMin - 1e-9);
                    Assert.LessOrEqual(w, PassengerAppearance.WidthMax + 1e-9);
                    Assert.GreaterOrEqual(d, PassengerAppearance.DepthMin - 1e-9);
                    Assert.LessOrEqual(d, PassengerAppearance.DepthMax + 1e-9);
                    sumH += h; sumW += w; sumD += d;
                    sumHH += h * h; sumWW += w * w; sumDD += d * d;
                    sumHW += h * w; sumHD += h * d; sumWD += w * d;
                }

                int profile = PassengerAppearance.WalkProfile(id);
                Assert.GreaterOrEqual(profile, 0);
                Assert.Less(profile, 3);
                profileCounts[profile]++;

                int outfitBucket = (int)Math.Floor(PassengerAppearance.IdentityUnit(id, PassengerAppearance.OutfitSalt) * PoolSize);
                if (outfitBucket >= PoolSize) outfitBucket = PoolSize - 1;
                outfitCounts[outfitBucket]++;
                crossTab[profile, outfitBucket]++;
            }

            double childShare = childCount / (double)N;
            Assert.That(childShare, Is.InRange(0.19, 0.21), $"Child share {childShare:F4} must be ~20%");

            static double Pearson(int count, double sx, double sy, double sxx, double syy, double sxy) {
                double num = count * sxy - sx * sy;
                double den = Math.Sqrt((count * sxx - sx * sx) * (count * syy - sy * sy));
                return den > 0 ? num / den : 0;
            }
            Assert.Less(Math.Abs(Pearson(adultCount, sumH, sumW, sumHH, sumWW, sumHW)), 0.03, "Height and Width are independent");
            Assert.Less(Math.Abs(Pearson(adultCount, sumH, sumD, sumHH, sumDD, sumHD)), 0.03, "Height and Depth are independent");
            Assert.Less(Math.Abs(Pearson(adultCount, sumW, sumD, sumWW, sumDD, sumWD)), 0.03, "Width and Depth are independent");

            double expectedProfile = N / 3.0;
            for (int p = 0; p < 3; p++) {
                Assert.That(profileCounts[p], Is.InRange(expectedProfile * 0.95, expectedProfile * 1.05), $"WalkProfile {p} uniform");
            }
            double expectedOutfit = N / (double)PoolSize;
            for (int o = 0; o < PoolSize; o++) {
                Assert.That(outfitCounts[o], Is.InRange(expectedOutfit * 0.90, expectedOutfit * 1.10), $"Outfit bucket {o} uniform");
                double expectedCell = N / (3.0 * PoolSize);
                for (int p = 0; p < 3; p++) {
                    Assert.That(crossTab[p, o], Is.InRange(expectedCell * 0.80, expectedCell * 1.20),
                        $"WalkProfile {p} x Outfit {o} independent");
                }
            }
        }

        [Test]
        public void PassengerCatalogueFiltersAdultEligibleAndChildEligibleMetadataExplicitly() {
            var cat = Track(ScriptableObject.CreateInstance<PassengerCatalogue>());
            var adultOnlyPrefab = Track(new GameObject("adult-only"));
            var childOnlyPrefab = Track(new GameObject("child-only"));
            var bothPrefab = Track(new GameObject("both-ages"));
            var neitherPrefab = Track(new GameObject("neither-age"));

            cat.entries = new[] {
                new PassengerCatalogueEntry { index = 0, recipe = "adult-only", prefab = adultOnlyPrefab, adultEligible = true, childEligible = false },
                new PassengerCatalogueEntry { index = 1, recipe = "child-only", prefab = childOnlyPrefab, adultEligible = false, childEligible = true },
                new PassengerCatalogueEntry { index = 2, recipe = "both-ages", prefab = bothPrefab, adultEligible = true, childEligible = true },
                new PassengerCatalogueEntry { index = 3, recipe = "neither-age", prefab = neitherPrefab, adultEligible = false, childEligible = false },
            };
            cat.Invalidate();

            Assert.AreEqual(2, cat.AdultPoolCount);
            Assert.AreEqual(2, cat.ChildPoolCount);
            CollectionAssert.AreEqual(new[] { 0, 2 }, cat.Pool(child: false));
            CollectionAssert.AreEqual(new[] { 1, 2 }, cat.Pool(child: true));

            for (int id = 1; id <= 200; id++) {
                Assert.IsTrue(cat.TryGetForSimId(id, out var entry), $"ID {id} resolved");
                if (PassengerAppearance.IsChild(id)) {
                    Assert.IsTrue(entry.childEligible, $"Child ID {id} must never receive non-childEligible '{entry.recipe}'");
                } else {
                    Assert.IsTrue(entry.adultEligible, $"Adult ID {id} must never receive non-adultEligible '{entry.recipe}'");
                }
            }
        }

        [Test]
        public void LocalPassengerCatalogueSweepVerifiesAll440EntriesTopologyWeightsLodsAndSampledAnatomy() {
            var catalogue = LoadLocalPassengerCatalogueOrIgnore();
            Assert.AreEqual(440, catalogue.entries.Length, "Local passenger library must contain 440 recipes");

            var maleOutfits = new HashSet<string>(StringComparer.Ordinal);
            var femaleOutfits = new HashSet<string>(StringComparer.Ordinal);

            for (int i = 0; i < catalogue.entries.Length; i++) {
                var entry = catalogue.entries[i];
                Assert.IsNotNull(entry, $"Entry {i}");
                Assert.IsTrue(entry.adultEligible && entry.childEligible, $"{entry.recipe}: must be eligible for both ages");
                Assert.Greater(entry.triangles, 2000, $"{entry.recipe}: full tris > 2000");
                Assert.Less(entry.triangles, 11000, $"{entry.recipe}: full tris < 11000");

                if (string.Equals(entry.sex, "male", StringComparison.OrdinalIgnoreCase)) maleOutfits.Add(entry.outfit);
                else if (string.Equals(entry.sex, "female", StringComparison.OrdinalIgnoreCase)) femaleOutfits.Add(entry.outfit);

                if (string.Equals(entry.garmentShape, "skirt", StringComparison.OrdinalIgnoreCase)) {
                    Assert.AreEqual("female", entry.sex, $"{entry.recipe}: skirt must belong to female");
                }
                if (string.Equals(entry.outfit, "trail", StringComparison.OrdinalIgnoreCase)) {
                    Assert.AreEqual("female", entry.sex, $"{entry.recipe}: trail outfit must belong to female");
                }
                if (string.Equals(entry.outfit, "beach", StringComparison.OrdinalIgnoreCase)) {
                    Assert.AreEqual("male", entry.sex, $"{entry.recipe}: beach outfit must belong to male");
                }

                Assert.IsNotNull(entry.prefab, $"{entry.recipe}: prefab bound");
                var smr = entry.prefab.GetComponentInChildren<SkinnedMeshRenderer>(true);
                Assert.IsNotNull(smr, $"{entry.recipe}: SkinnedMeshRenderer present");
                var fullMesh = smr.sharedMesh;
                Assert.IsNotNull(fullMesh, $"{entry.recipe}: full mesh present");

                // Finite, grounded vertices.
                var verts = fullMesh.vertices;
                Assert.Greater(verts.Length, 0, $"{entry.recipe}: non-empty vertices");
                float minY = float.MaxValue, maxY = float.MinValue;
                for (int v = 0; v < verts.Length; v++) {
                    var p = verts[v];
                    Assert.IsFalse(float.IsNaN(p.x) || float.IsNaN(p.y) || float.IsNaN(p.z) ||
                        float.IsInfinity(p.x) || float.IsInfinity(p.y) || float.IsInfinity(p.z),
                        $"{entry.recipe}: finite vertex {v}");
                    if (p.y < minY) minY = p.y;
                    if (p.y > maxY) maxY = p.y;
                }
                Assert.That(minY, Is.InRange(-0.15f, 0.15f), $"{entry.recipe}: grounded feet minY={minY}");
                Assert.That(maxY - minY, Is.InRange(1.2f, 2.2f), $"{entry.recipe}: human height span");

                // Bone weights sum ~ 1 with bone indices < 16.
                var weights = fullMesh.boneWeights;
                Assert.AreEqual(verts.Length, weights.Length, $"{entry.recipe}: boneWeights count matches vertices");
                for (int v = 0; v < weights.Length; v++) {
                    var bw = weights[v];
                    float sum = bw.weight0 + bw.weight1 + bw.weight2 + bw.weight3;
                    Assert.AreEqual(1f, sum, 1e-2f, $"{entry.recipe}: vertex {v} bone weight sum");
                    if (bw.weight0 > 0f) Assert.Less(bw.boneIndex0, 16, $"{entry.recipe}: boneIndex0 < 16");
                    if (bw.weight1 > 0f) Assert.Less(bw.boneIndex1, 16, $"{entry.recipe}: boneIndex1 < 16");
                    if (bw.weight2 > 0f) Assert.Less(bw.boneIndex2, 16, $"{entry.recipe}: boneIndex2 < 16");
                    if (bw.weight3 > 0f) Assert.Less(bw.boneIndex3, 16, $"{entry.recipe}: boneIndex3 < 16");
                }

                // Simplified Low mesh budget & bounds parity.
                var lowMesh = entry.simplifiedMesh?.mesh;
                Assert.IsNotNull(lowMesh, $"{entry.recipe}: simplifiedMesh present");
                int lowTris = lowMesh.triangles.Length / 3;
                Assert.Greater(lowTris, 100, $"{entry.recipe}: simplifiedMesh non-degenerate");
                Assert.Less(lowTris, entry.triangles, $"{entry.recipe}: simplifiedMesh reduces triangle count");
                Assert.LessOrEqual(lowTris, 3500, $"{entry.recipe}: simplifiedMesh within LOD2 budget");
                Assert.AreEqual(fullMesh.bounds.size.y, lowMesh.bounds.size.y, 0.2f, $"{entry.recipe}: Low height bounds parity");
                Assert.AreEqual(fullMesh.bounds.center.y, lowMesh.bounds.center.y, 0.2f, $"{entry.recipe}: Low vertical center parity");
            }

            Assert.AreEqual(20, maleOutfits.Count, "Male library must supply 20 distinct outfits");
            Assert.AreEqual(20, femaleOutfits.Count, "Female library must supply 20 distinct outfits");

            // Sample Escalator_Right and Idle on an instantiated actor and verify finite grounded bounds.
            var sampleEntry = catalogue.entries[0];
            var instance = Track(UnityEngine.Object.Instantiate(sampleEntry.prefab));
            var anim = instance.GetComponentInChildren<Animation>(true);
            var skin = instance.GetComponentInChildren<SkinnedMeshRenderer>(true);
            Assert.IsNotNull(anim);
            Assert.IsNotNull(skin);
            anim.enabled = false;
            var bakedMesh = Track(new Mesh { name = "SampledAnatomyBake" });
            foreach (var clipName in new[] { "Idle", "Escalator_Right" }) {
                var clip = anim.GetClip(clipName);
                Assert.IsNotNull(clip, $"Missing clip '{clipName}' on {sampleEntry.recipe}");
                clip.SampleAnimation(anim.gameObject, clip.length * 0.5f);
                skin.BakeMesh(bakedMesh);
                var bVerts = bakedMesh.vertices;
                Assert.Greater(bVerts.Length, 0);
                float minY = float.MaxValue, maxY = float.MinValue;
                for (int v = 0; v < bVerts.Length; v++) {
                    Assert.IsFalse(float.IsNaN(bVerts[v].x) || float.IsNaN(bVerts[v].y) || float.IsNaN(bVerts[v].z));
                    if (bVerts[v].y < minY) minY = bVerts[v].y;
                    if (bVerts[v].y > maxY) maxY = bVerts[v].y;
                }
                Assert.That(minY, Is.InRange(-0.2f, 0.25f), $"{clipName}: sampled feet stay grounded (minY={minY})");
                Assert.That(maxY - minY, Is.InRange(1.2f, 2.2f), $"{clipName}: sampled standing height stays human");
            }
        }

        /* ============== BATCHING, CHUNK CACHE, MESHER AO, LOD & REGRESSIONS */

        [Test]
        public void PrefabMeshTemplateMergesSameMaterialPartsPreservesBoundsShadowsAndDisposesClones() {
            var matA = Track(CreateTestMaterial("TemplateMatA"));
            var matB = Track(CreateTestMaterial("TemplateMatB"));
            matA.enableInstancing = false;
            matB.enableInstancing = false;
            var boxMesh = Track(CreateUnitBoxMesh("TemplateBox"));

            var prefab = Track(new GameObject("SyntheticMultiPartPrefab"));
            void AddChild(string childName, Vector3 pos, Material mat, ShadowCastingMode shadow) {
                var child = new GameObject(childName, typeof(MeshFilter), typeof(MeshRenderer));
                child.transform.SetParent(prefab.transform, false);
                child.transform.localPosition = pos;
                child.GetComponent<MeshFilter>().sharedMesh = boxMesh;
                var mr = child.GetComponent<MeshRenderer>();
                mr.sharedMaterial = mat;
                mr.shadowCastingMode = shadow;
            }
            // Two parts sharing matA + ShadowCastingMode.On merge into 1; third part with matB stays separate; fourth with ShadowCastingMode.Off stays separate.
            AddChild("p1", new Vector3(0f, 0f, 0f), matA, ShadowCastingMode.On);
            AddChild("p2", new Vector3(2f, 0f, 0f), matA, ShadowCastingMode.On);
            AddChild("p3", new Vector3(0f, 3f, 0f), matB, ShadowCastingMode.On);
            AddChild("p4", new Vector3(0f, 0f, 4f), matA, ShadowCastingMode.Off);

            var cache = new StationPrefabTemplateCache();
            Material instA;
            Mesh mergedMesh;
            try {
                Assert.IsTrue(cache.TryGetTemplate(prefab, out var template));
                Assert.AreEqual(3, template.Parts.Length, "2 same-(matA,On) parts merge into 1, leaving 3 distinct buckets");
                Assert.IsTrue(template.HasBounds);
                Assert.AreEqual(new Vector3(1f, 1.5f, 2f), template.LocalBounds.center);
                Assert.AreEqual(new Vector3(3f, 4f, 5f), template.LocalBounds.size);

                mergedMesh = template.Parts[0].Mesh;
                Assert.AreNotSame(boxMesh, mergedMesh, "Merged bucket produces a combined mesh");
                Assert.AreEqual(boxMesh.vertexCount * 2, mergedMesh.vertexCount);
                Assert.AreEqual(ShadowCastingMode.On, template.Parts[0].ShadowCasting);
                Assert.AreEqual(ShadowCastingMode.On, template.Parts[1].ShadowCasting);
                Assert.AreEqual(ShadowCastingMode.Off, template.Parts[2].ShadowCasting);

                instA = cache.InstancedMaterialFor(matA);
                Assert.IsNotNull(instA);
                Assert.AreNotSame(matA, instA, "Cache clones instanced material instead of mutating source asset");
                Assert.IsTrue(instA.enableInstancing, "Cloned material enables GPU instancing");
                Assert.IsFalse(matA.enableInstancing, "Source prefab material must NEVER be mutated");
            } finally {
                cache.Dispose();
            }

            Assert.IsTrue(instA == null, "Dispose destroys cloned instanced materials");
            Assert.IsTrue(mergedMesh == null, "Dispose destroys owned merged meshes");
            Assert.IsTrue(matA != null, "Dispose must not destroy source prefab materials");
        }

        [Test]
        public void InstancedSurfaceBatchSlicesOver1023MasksSourcesWithoutReallocatingAndSkipsWhenEmpty() {
            var go = Track(new GameObject("InstancedBatchTest", typeof(MeshFilter), typeof(MeshRenderer)));
            var mr = go.GetComponent<MeshRenderer>();
            var mesh = Track(CreateUnitBoxMesh("BatchBox"));
            var batch = go.AddComponent<StationInstancedSurfaceBatch>();

            const int total = 1200;
            var combines = new List<CombineInstance>(total);
            var sources = new List<int>(total);
            for (int i = 0; i < total; i++) {
                combines.Add(new CombineInstance {
                    mesh = mesh,
                    subMeshIndex = 0,
                    transform = Matrix4x4.Translate(new Vector3(i, 0f, 0f)),
                });
                sources.Add(i);
            }
            batch.Configure(mesh, 0, mr, new Bounds(Vector3.zero, new Vector3(1200f, 2f, 2f)), combines, total, sources);

            var origMatrices = batch.Matrices;
            Assert.AreEqual(total, origMatrices.Length);
            Assert.AreEqual(2, batch.DrawSlices.Length, "1200 instances slice into 2 draw batches (1023 + 177)");
            Assert.AreEqual(1023, batch.DrawSlices[0].Length);
            Assert.AreEqual(177, batch.DrawSlices[1].Length);

            // HideSource masks 1 source without reallocating Matrices.
            batch.HideSource(50);
            Assert.AreSame(origMatrices, batch.Matrices, "HideSource must not reallocate Matrices");
            Assert.AreEqual(1199, batch.DrawSlices.Sum(s => s.Length));

            // UnhideSource restores all 1200 instances without reallocating Matrices.
            batch.UnhideSource(50);
            Assert.AreSame(origMatrices, batch.Matrices, "UnhideSource must not reallocate Matrices");
            Assert.AreEqual(1200, batch.DrawSlices.Sum(s => s.Length));

            // Hiding every source leaves DrawSlices empty (skips drawing).
            for (int i = 0; i < total; i++) batch.HideSource(i);
            Assert.AreEqual(0, batch.DrawSlices.Length, "ActiveCount == 0 yields empty DrawSlices");
        }

        [Test]
        public void Surface16mAndEquipment64mChunkRenderersRetainUntouchedChunksOnLocalEditAndDisposeCleanly() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "RuntimeCatalogue asset must exist");
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Sprites/Default");

            // 1. StationSurfaceModuleRenderer: 32x32 = 1024 sidewalk tiles -> 4 chunks (16 m chunking).
            var surfaceMods = new JArray();
            for (int y = 0; y < 32; y++) {
                for (int x = 0; x < 32; x++) {
                    surfaceMods.Add(new JObject {
                        ["id"] = $"sw-{x}-{y}", ["type"] = "sidewalk", ["x"] = x, ["y"] = y, ["z"] = 0, ["w"] = 1, ["d"] = 1,
                    });
                }
            }
            var surfaceDoc1 = ParseDocument(new JObject {
                ["v"] = 1, ["cells"] = new JArray(), ["modules"] = surfaceMods,
            }.ToString(), "surface-1024");
            var surfaceIdx1 = new StationIndex(surfaceDoc1);
            var surfaceRoot = Track(new GameObject("SurfaceChunkWorld"));
            var surfaceRenderer = new StationSurfaceModuleRenderer();
            var surfaceWorld = TrackDisposable(new StationWorldView(
                surfaceRoot.transform,
                "SurfaceChunkWorld",
                new IStationViewRenderer[] { surfaceRenderer },
                new StationViewAssets { Catalogue = catalogue, Shader = shader }));
            surfaceWorld.Build(surfaceDoc1, surfaceIdx1);

            var surfaceCachesField = typeof(StationSurfaceModuleRenderer).GetField("surfaceCaches", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(surfaceCachesField);
            var surfaceCaches = (IList)surfaceCachesField.GetValue(surfaceRenderer);
            Assert.AreEqual(1, surfaceCaches.Count);
            var surfaceChunks = (IDictionary)surfaceCaches[0].GetType().GetField("Chunks").GetValue(surfaceCaches[0]);
            Assert.AreEqual(4, surfaceChunks.Count, "32x32 = 1024 sidewalk tiles partition into 4 16m chunks");

            // Capture untouched chunk (1, 1) view references before editing chunk (0, 0).
            var untouchedSurfBucket = surfaceChunks[(1, 1)];
            var untouchedSurfViewsBefore = ((List<GameObject>)untouchedSurfBucket.GetType().GetField("Views").GetValue(untouchedSurfBucket)).ToArray();
            Assert.IsNotEmpty(untouchedSurfViewsBefore);

            // Remove sw-0-0 in chunk (0, 0) via local delta.
            var surfaceMods2 = (JArray)surfaceMods.DeepClone();
            surfaceMods2.RemoveAt(0);
            var surfaceDoc2 = ParseDocument(new JObject {
                ["v"] = 1, ["cells"] = new JArray(), ["modules"] = surfaceMods2,
            }.ToString(), "surface-1024");
            var surfaceIdx2 = new StationIndex(surfaceDoc2);
            var surfaceDelta = new StationIndexDelta();
            surfaceDelta.RemovedModules.Add("sw-0-0");
            using (var surfStage = surfaceWorld.StageLocalWorld(surfaceDoc2, surfaceIdx2, surfaceDelta)) {
                Assert.IsNotNull(surfStage);
                surfaceWorld.CommitLocalWorld(surfStage);
            }

            var untouchedSurfBucketAfter = surfaceChunks[(1, 1)];
            var untouchedSurfViewsAfter = ((List<GameObject>)untouchedSurfBucketAfter.GetType().GetField("Views").GetValue(untouchedSurfBucketAfter)).ToArray();
            Assert.AreSame(untouchedSurfViewsBefore[0], untouchedSurfViewsAfter[0],
                "Local edit in surface chunk (0,0) retains identical GameObject reference in untouched chunk (1,1)");

            surfaceWorld.Dispose();
            surfaceRenderer.Release();
            Assert.AreEqual(0, surfaceCaches.Count, "SurfaceWorldCache disposed cleanly on Release()");

            // 2. StationEquipmentModuleRenderer: 14 benches across 2 64m chunks (x=0..6 and x=64..70).
            var equipMods = new JArray();
            for (int i = 0; i < 7; i++) {
                equipMods.Add(new JObject { ["id"] = $"b0-{i}", ["type"] = "bench", ["x"] = i * 2, ["y"] = 0, ["z"] = -5, ["w"] = 1, ["d"] = 1 });
                equipMods.Add(new JObject { ["id"] = $"b1-{i}", ["type"] = "bench", ["x"] = 64 + i * 2, ["y"] = 0, ["z"] = -5, ["w"] = 1, ["d"] = 1 });
            }
            var equipDoc1 = ParseDocument(new JObject {
                ["v"] = 1, ["cells"] = new JArray(), ["modules"] = equipMods,
            }.ToString(), "equip-64m");
            var equipIdx1 = new StationIndex(equipDoc1);
            var equipRoot = Track(new GameObject("EquipChunkWorld"));
            var equipRenderer = new StationEquipmentModuleRenderer();
            var equipWorld = TrackDisposable(new StationWorldView(
                equipRoot.transform,
                "EquipChunkWorld",
                new IStationViewRenderer[] { equipRenderer },
                new StationViewAssets { Catalogue = catalogue, Shader = shader }));
            equipWorld.Build(equipDoc1, equipIdx1);

            var batchCachesField = typeof(StationEquipmentModuleRenderer).GetField("batchCaches", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(batchCachesField);
            var batchCaches = (IList)batchCachesField.GetValue(equipRenderer);
            Assert.AreEqual(1, batchCaches.Count);
            var equipChunks = (IDictionary)batchCaches[0].GetType().GetField("Chunks").GetValue(batchCaches[0]);
            Assert.AreEqual(2, equipChunks.Count, "14 benches across x=0..12 and x=64..76 partition into 2 64m chunks");

            object farKey = null;
            GameObject farViewBefore = null;
            foreach (DictionaryEntry de in equipChunks) {
                var chunk = (StationInstancedPrefabChunk)de.Value;
                if (chunk.ModuleIds.Contains("b1-0")) {
                    farKey = de.Key;
                    farViewBefore = chunk.Views[0];
                    break;
                }
            }
            Assert.IsNotNull(farKey);
            Assert.IsNotNull(farViewBefore);

            var equipMods2 = (JArray)equipMods.DeepClone();
            equipMods2.RemoveAt(0); // removes b0-0 in chunk 0
            var equipDoc2 = ParseDocument(new JObject {
                ["v"] = 1, ["cells"] = new JArray(), ["modules"] = equipMods2,
            }.ToString(), "equip-64m");
            var equipIdx2 = new StationIndex(equipDoc2);
            var equipDelta = new StationIndexDelta();
            equipDelta.RemovedModules.Add("b0-0");
            using (var equipStage = equipWorld.StageLocalWorld(equipDoc2, equipIdx2, equipDelta)) {
                Assert.IsNotNull(equipStage);
                equipWorld.CommitLocalWorld(equipStage);
            }

            var farChunkAfter = (StationInstancedPrefabChunk)equipChunks[farKey];
            Assert.AreSame(farViewBefore, farChunkAfter.Views[0],
                "Local edit in equipment chunk 0 retains identical view reference in untouched 64m chunk 1");

            equipWorld.Dispose();
            equipRenderer.Release();
            Assert.AreEqual(0, batchCaches.Count, "EquipmentBatchCache disposed cleanly on Release()");
        }

        [Test]
        public void InstancedSurfaceDrawerSelectsOrthographicZoomLodAndEnforcesLowMinimumUnderHideUi() {
            const string ProfileKey = "metro.graphics.model-detail";
            const string UpscalingKey = "metro.graphics.upscaling";
            bool hadProfile = PlayerPrefs.HasKey(ProfileKey);
            string savedProfile = hadProfile ? PlayerPrefs.GetString(ProfileKey) : null;
            bool hadUpscaling = PlayerPrefs.HasKey(UpscalingKey);
            string savedUpscaling = hadUpscaling ? PlayerPrefs.GetString(UpscalingKey) : null;

            var ctor = typeof(StationGraphicsSettings).GetConstructor(
                BindingFlags.Instance | BindingFlags.NonPublic, null, Type.EmptyTypes, null);
            var settings = (StationGraphicsSettings)ctor.Invoke(null);

            var rootGo = Track(new GameObject("DrawerLodRoot"));
            var drawer = StationInstancedSurfaceDrawer.EnsureFor(rootGo.transform);
            var batchGo = new GameObject("DrawerBatch", typeof(MeshFilter), typeof(MeshRenderer));
            batchGo.transform.SetParent(rootGo.transform, false);
            var target = batchGo.AddComponent<StationVisibilityTarget>();
            target.Configure(StationPartRole.Prop, new[] { 0 });

            var mat = Track(CreateTestMaterial("DrawerLodMat"));
            var parts = new StructureParts();
            parts.Cylinder(mat, Vector3.zero, 0.5f, 2f, 32);
            var meshes = new List<Mesh>();
            var tmpHost = Track(new GameObject("DrawerMeshTmp"));
            parts.Emit(tmpHost.transform, meshes, "lod-cyl");
            var lodMesh = Track(meshes[0]);
            Assert.AreEqual(3, lodMesh.lodCount);

            var batch = batchGo.AddComponent<StationInstancedSurfaceBatch>();
            var mr = batchGo.GetComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            batch.ConfigureMatrices(lodMesh, 0, mr, new List<Matrix4x4> { Matrix4x4.identity }, followTransformOffset: false);
            var worldBounds = lodMesh.bounds;

            var camGo = Track(new GameObject("DrawerOrthoCam"));
            var orthoCam = camGo.AddComponent<Camera>();
            orthoCam.enabled = false;
            orthoCam.orthographic = true;
            orthoCam.transform.position = new Vector3(0f, 5f, -10f);

            var registry = TrackDisposable(new StationVisibilityRegistry());
            registry.Register(batchGo.transform, StationPartRole.Prop, new[] { 0 });

            try {
                // High profile: orthographic zoom controls LOD0 (close) -> LOD2 (far out).
                var high = new JObject { ["profile"] = "high" };
                Assert.IsTrue(settings.TryHandle(new StationCommand { Type = "graphics.set", Payload = high }, high, out _, out _));

                orthoCam.orthographicSize = 3f; // large on screen -> tier 0
                drawer.SampleLodView(orthoCam);
                int nearTier = drawer.SelectMeshLod(lodMesh, batch, worldBounds, Vector3.zero);
                Assert.AreEqual(0, nearTier, "Zoomed-in orthographic camera selects LOD0 on High profile");

                orthoCam.orthographicSize = 120f; // tiny on screen -> tier 2
                drawer.SampleLodView(orthoCam);
                int farTier = drawer.SelectMeshLod(lodMesh, batch, worldBounds, Vector3.zero);
                Assert.AreEqual(2, farTier, "Zoomed-out orthographic camera selects LOD2 on High profile");

                // Low profile + HideUi: MinimumModelLod == 1 still forces tier >= 1 even right up close.
                var low = new JObject { ["profile"] = "low" };
                Assert.IsTrue(settings.TryHandle(new StationCommand { Type = "graphics.set", Payload = low }, low, out _, out _));
                registry.State.ActiveLevel = 0;
                registry.State.SetHideUi(true);
                registry.Apply();
                Assert.IsFalse(target.OtherLevelLod, "Active storey under HideUi is not OtherLevelLod");

                orthoCam.orthographicSize = 2f; // huge on screen, but Low profile enforces MinimumModelLod == 1
                drawer.SampleLodView(orthoCam);
                int lowHideUiTier = drawer.SelectMeshLod(lodMesh, batch, worldBounds, Vector3.zero);
                Assert.GreaterOrEqual(lowHideUiTier, 1, "Low profile + HideUi enforces MinimumModelLod >= 1");
            } finally {
                if (hadProfile) PlayerPrefs.SetString(ProfileKey, savedProfile); else PlayerPrefs.DeleteKey(ProfileKey);
                if (hadUpscaling) PlayerPrefs.SetString(UpscalingKey, savedUpscaling); else PlayerPrefs.DeleteKey(UpscalingKey);
                PlayerPrefs.Save();
                ((StationGraphicsSettings)ctor.Invoke(null)).BuildPayload(null, null);
                StationFsrUpscaler.ReleaseResources();
            }
        }

        [Test]
        public void CellMesherTopAoWallAoFixedAxisFullBlockSeamsAndClosedSlopeWedgeLidHold() {
            static float FindFaceAo(StationCellMeshResult result, StationCellKey key, StationFace face) {
                foreach (var g in result.Groups) {
                    if (g.LocalFaces == null || g.LocalTriangleFaces == null || g.Colors == null) continue;
                    for (int t = 0; t < g.LocalTriangleFaces.Length; t++) {
                        var rec = g.LocalFaces[g.LocalTriangleFaces[t]];
                        if (rec.X == key.X && rec.Y == key.Y && rec.Z == key.Z && rec.Face == face) {
                            return g.Colors[g.Indices[t * 3]].r;
                        }
                    }
                }
                Assert.Fail($"Face {face} not found for cell {key}");
                return -1f;
            }

            // 1. TopAoAt: 1 solid neighbour in upper ring (z+1) -> 0.94f; unoccluded -> 1.0f.
            var topUnoccluded = StationCellMesher.Mesh(new StationCellMeshInput {
                VirtualGround = false, BuildGround = false,
                Cells = new List<StationMeshCell> {
                    new StationMeshCell { X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full },
                },
            });
            Assert.AreEqual(1.0f, FindFaceAo(topUnoccluded, new StationCellKey(0, 0, 0), StationFace.Top), 1e-4f);

            var topOneNeighbour = StationCellMesher.Mesh(new StationCellMeshInput {
                VirtualGround = false, BuildGround = false,
                Cells = new List<StationMeshCell> {
                    new StationMeshCell { X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full },
                    new StationMeshCell { X = 1, Y = 0, Z = 1, Solid = true, Shape = StationCellShape.Full },
                },
            });
            Assert.AreEqual(0.94f, FindFaceAo(topOneNeighbour, new StationCellKey(0, 0, 0), StationFace.Top), 1e-4f,
                "TopAoAt with 1 upper-ring neighbour == 0.94");

            // 2. WallAo N/S/E/W parity guarding Surgical Fix #1 (no diagonal sampling on N/S walls!).
            // For cell (0,0,0) North face (+Y, nx=0, ny=1): ax=0, ay=1, along=(1,0).
            // Occluder at (1, 1, 0) lies in wall plane -> AO == 0.91f.
            var northInPlane = StationCellMesher.Mesh(new StationCellMeshInput {
                VirtualGround = false, BuildGround = false,
                Cells = new List<StationMeshCell> {
                    new StationMeshCell { X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full },
                    new StationMeshCell { X = 1, Y = 1, Z = 0, Solid = true, Shape = StationCellShape.Full },
                },
            });
            Assert.AreEqual(0.91f, FindFaceAo(northInPlane, new StationCellKey(0, 0, 0), StationFace.N), 1e-4f,
                "N wall samples along X at (ax+1, ay, z) == 0.91");

            // Cell at (1, 2, 0) is diagonally off the North wall plane -> must NOT occlude N face (AO == 1.0f).
            var northOffDiagonal = StationCellMesher.Mesh(new StationCellMeshInput {
                VirtualGround = false, BuildGround = false,
                Cells = new List<StationMeshCell> {
                    new StationMeshCell { X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full },
                    new StationMeshCell { X = 1, Y = 2, Z = 0, Solid = true, Shape = StationCellShape.Full },
                },
            });
            Assert.AreEqual(1.0f, FindFaceAo(northOffDiagonal, new StationCellKey(0, 0, 0), StationFace.N), 1e-4f,
                "N wall must NOT sample diagonally at (1, 2, 0) (guards fixed WallAo bug)");

            // South face (-Y, nx=0, ny=-1): ax=0, ay=-1, along=(1,0). Occluder at (-1, -1, 0) -> 0.91f; off-diagonal (-1, -2, 0) -> 1.0f.
            var southInPlane = StationCellMesher.Mesh(new StationCellMeshInput {
                VirtualGround = false, BuildGround = false,
                Cells = new List<StationMeshCell> {
                    new StationMeshCell { X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full },
                    new StationMeshCell { X = -1, Y = -1, Z = 0, Solid = true, Shape = StationCellShape.Full },
                },
            });
            Assert.AreEqual(0.91f, FindFaceAo(southInPlane, new StationCellKey(0, 0, 0), StationFace.S), 1e-4f,
                "S wall samples along X at (ax-1, ay, z) == 0.91");

            // East face (+X, nx=1, ny=0): matches chunkMesher.ts along=[0,0], so cell directly above the wall-front (1, 0, 1)
            // is sampled 3 times (t=-1,0,1) -> 1 - 0.09*3 = 0.73f, while (1, 1, 0) is not sampled (1.0f).
            var eastAboveFront = StationCellMesher.Mesh(new StationCellMeshInput {
                VirtualGround = false, BuildGround = false,
                Cells = new List<StationMeshCell> {
                    new StationMeshCell { X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full },
                    new StationMeshCell { X = 1, Y = 0, Z = 1, Solid = true, Shape = StationCellShape.Full },
                },
            });
            Assert.AreEqual(0.73f, FindFaceAo(eastAboveFront, new StationCellKey(0, 0, 0), StationFace.E), 1e-4f,
                "E wall matches chunkMesher.ts along=[0,0] parity");

            // West face (-X, nx=-1, ny=0): symmetric check with (-1, 0, 1) -> 0.73f.
            var westAboveFront = StationCellMesher.Mesh(new StationCellMeshInput {
                VirtualGround = false, BuildGround = false,
                Cells = new List<StationMeshCell> {
                    new StationMeshCell { X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full },
                    new StationMeshCell { X = -1, Y = 0, Z = 1, Solid = true, Shape = StationCellShape.Full },
                },
            });
            Assert.AreEqual(0.73f, FindFaceAo(westAboveFront, new StationCellKey(0, 0, 0), StationFace.W), 1e-4f,
                "W wall matches chunkMesher.ts along=[0,0] parity");

            // 3. Two flush full blocks: strictly axis-aligned normals and 0 interior faces on the shared seam.
            var flushPair = StationCellMesher.Mesh(new StationCellMeshInput {
                VirtualGround = false, BuildGround = false,
                Cells = new List<StationMeshCell> {
                    new StationMeshCell { X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full },
                    new StationMeshCell { X = 1, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full },
                },
            });
            int totalFlushTris = 0;
            foreach (var g in flushPair.Groups) {
                totalFlushTris += g.TriangleCount;
                foreach (var n in g.Normals) {
                    int axisCount = (Mathf.Abs(n.x) > 0.999f ? 1 : 0) + (Mathf.Abs(n.y) > 0.999f ? 1 : 0) + (Mathf.Abs(n.z) > 0.999f ? 1 : 0);
                    Assert.AreEqual(1, axisCount, $"Full block normal {n} must be strictly axis-aligned");
                }
            }
            // 6 exposed side quads * 2 tris = 12 + 2 top centroid fans * 4 tris = 8 + 2 bottom fans * 4 tris = 8 => 28 tris (32 if shared interior seam were emitted).
            Assert.AreEqual(28, totalFlushTris, "2 adjacent full blocks emit 10 exposed faces (28 tris with 4-tri cap fans), 0 interior seam faces");

            // 4. Closed SlopeCuts + SlopeFills wedge lid emits an upward-sloping top surface.
            var fillKey = new StationCellKey(0, 0, 1);
            var slopeInput = new StationCellMeshInput {
                VirtualGround = false, BuildGround = false,
                Cells = new List<StationMeshCell> {
                    new StationMeshCell { X = 0, Y = 0, Z = 0, Solid = true, Shape = StationCellShape.Full },
                },
                SlopeCuts = new Dictionary<StationCellKey, StationSlopeCut> {
                    [fillKey] = new StationSlopeCut { Axis = 'x', Lo = 0.0, Hi = 0.8, HasBase = true, Base = 0.0 },
                },
                SlopeFills = new HashSet<StationCellKey> { fillKey },
            };
            var slopeResult = StationCellMesher.Mesh(slopeInput);
            bool foundSlopedLid = false;
            foreach (var g in slopeResult.Groups) {
                for (int i = 0; i < g.Normals.Length; i++) {
                    var n = g.Normals[i];
                    if (n.z > 0.1f && Mathf.Abs(n.x) > 0.1f) {
                        foundSlopedLid = true;
                        break;
                    }
                }
            }
            Assert.IsTrue(foundSlopedLid, "SlopeCuts + SlopeFills must emit a closed upward-sloping wedge lid");
        }

        [Test]
        public void CellWorkspaceLocalEditsRetainUntouchedChunksCross16mSeamRestorePsdInsetAndFlipTianheCeiling() {
            var mat = Track(CreateTestMaterial("WorkspaceCellMat"));
            var parentGo = Track(new GameObject("WorkspaceCellRoot"));
            var stagingGo = Track(new GameObject("WorkspaceCellStaging"));

            // 1. Local cell edits: chunks at x=0, x=15|16 seam, and far chunk x=48.
            var doc1 = ParseDocument(
                "{\"v\":1,\"levelBase\":0,\"storeyHeight\":5,\"cells\":[" +
                "{\"x\":0,\"y\":0,\"z\":-5}," +
                "{\"x\":15,\"y\":0,\"z\":-5}," +
                "{\"x\":16,\"y\":0,\"z\":-5}," +
                "{\"x\":48,\"y\":0,\"z\":-5}" +
                "],\"modules\":[]}",
                "ws-1");
            var idx1 = new StationIndex(doc1);
            var input1 = new StationCellMeshInput { VirtualGround = false, BuildGround = false, LevelBase = 0, StoreyHeight = 5 };
            foreach (var c in doc1.Cells) input1.Cells.Add(StationCellMeshWorkspace.BuildMeshCell(c, StationCellShape.Full, null));

            var ws = StationCellMeshWorkspace.Create(input1);
            var view = TrackDisposable(StationCellView.BuildFromWorkspace(new StationCellViewRequest {
                ResolveFinish = _ => mat,
            }, parentGo.transform, ws));

            var farGroupBefore = view.Groups.First(g => g.ChunkX == 48);
            var seamLeftBefore = view.Groups.First(g => g.ChunkX == 0);
            var seamRightBefore = view.Groups.First(g => g.ChunkX == 16);
            var farMeshBefore = farGroupBefore.Mesh;

            // Edit cell at x=15 (on the 16 m seam): invalidates chunk 0 AND chunk 16, while chunk 48 keeps identical Mesh reference.
            var doc2 = ParseDocument(
                "{\"v\":1,\"levelBase\":0,\"storeyHeight\":5,\"cells\":[" +
                "{\"x\":0,\"y\":0,\"z\":-5}," +
                "{\"x\":16,\"y\":0,\"z\":-5}," +
                "{\"x\":48,\"y\":0,\"z\":-5}" +
                "],\"modules\":[]}",
                "ws-2");
            var idx2 = new StationIndex(doc2);
            var deltaSeam = new StationIndexDelta();
            deltaSeam.RemovedCells.Add(new StationCellKey(15, 0, -5));
            var stagedSeam = ws.StageDocumentDelta(doc2, idx2, deltaSeam, idx1);
            Assert.IsTrue(stagedSeam.DirtyKeys.Any(k => k.ChunkX == 0), "Editing x=15 dirties chunk 0");
            Assert.IsTrue(stagedSeam.DirtyKeys.Any(k => k.ChunkX == 16), "Editing x=15 invalidates across the 16 m seam into chunk 16");
            Assert.IsFalse(stagedSeam.DirtyKeys.Any(k => k.ChunkX == 48), "Far chunk 48 stays clean");

            using (var swap = view.StageChunkSwap(stagedSeam, stagingGo.transform)) {
                swap.Commit(out var retiredViews, out var retiredMeshes, out _);
                Assert.Contains(seamLeftBefore.Mesh, retiredMeshes);
                Assert.Contains(seamRightBefore.Mesh, retiredMeshes);
                Assert.IsFalse(retiredMeshes.Contains(farMeshBefore));
                foreach (var rm in retiredMeshes) if (rm) UnityEngine.Object.DestroyImmediate(rm);
                foreach (var rv in retiredViews) if (rv) UnityEngine.Object.DestroyImmediate(rv);
            }
            var farGroupAfter = view.Groups.First(g => g.ChunkX == 48);
            Assert.AreSame(farMeshBefore, farGroupAfter.Mesh, "Untouched far chunk retains exact Mesh reference");

            // 2. PSD half/full -> none restores full platform block inset.
            var psdDocHalf = ParseDocument(
                "{\"v\":1,\"levelBase\":0,\"storeyHeight\":5,\"cells\":[{\"x\":0,\"y\":0,\"z\":-5}],\"modules\":[" +
                "{\"id\":\"pe1\",\"type\":\"platform-edge\",\"x\":0,\"y\":0,\"z\":-5,\"rot\":0,\"w\":1,\"d\":1,\"cfg\":{\"side\":\"right\",\"psd\":\"half\"}}" +
                "]}",
                "psd-half");
            var psdIdxHalf = new StationIndex(psdDocHalf);
            var psdInput = new StationCellMeshInput {
                VirtualGround = false, BuildGround = false,
                Cells = new List<StationMeshCell> { StationCellMeshWorkspace.BuildMeshCell(psdDocHalf.Cells[0], StationCellShape.Full, null) },
                Insets = StationPlatformInsets.For(psdIdxHalf.ModulesOfType("platform-edge")),
            };
            var psdWs = StationCellMeshWorkspace.Create(psdInput);
            var psdBefore = psdWs.MeshAll();
            float maxYHalf = psdBefore.Values.SelectMany(l => l).SelectMany(g => g.Positions).Max(p => p.y);
            Assert.AreEqual((float)StationPlatformInsets.Edge, maxYHalf, 1e-4f, "PSD half insets platform block to Edge (0.75)");

            var psdDocNone = ParseDocument(
                "{\"v\":1,\"levelBase\":0,\"storeyHeight\":5,\"cells\":[{\"x\":0,\"y\":0,\"z\":-5}],\"modules\":[" +
                "{\"id\":\"pe1\",\"type\":\"platform-edge\",\"x\":0,\"y\":0,\"z\":-5,\"rot\":0,\"w\":1,\"d\":1,\"cfg\":{\"side\":\"right\",\"psd\":\"none\"}}" +
                "]}",
                "psd-none");
            var psdIdxNone = new StationIndex(psdDocNone);
            var psdDelta = new StationIndexDelta();
            psdDelta.ChangedModules.Add(psdDocNone.Modules[0]);
            var stagedPsd = psdWs.StageDocumentDelta(psdDocNone, psdIdxNone, psdDelta, psdIdxHalf);
            stagedPsd.Commit();
            float maxYNone = stagedPsd.GroupsByChunk.Values.SelectMany(l => l).SelectMany(g => g.Positions).Max(p => p.y);
            Assert.AreEqual(1.0f, maxYNone, 1e-4f, "Switching PSD half -> none restores full 1.0 m platform block");

            // 3. Tianhe -11 ceiling invalidates back to Cell when wall support is added at -12, and back to Ceiling when removed.
            var ceilDoc1 = ParseDocument(
                "{\"v\":1,\"levelBase\":0,\"storeyHeight\":5,\"cells\":[" +
                "{\"x\":0,\"y\":0,\"z\":-15},{\"x\":1,\"y\":0,\"z\":-15}," +
                "{\"x\":0,\"y\":0,\"z\":-11},{\"x\":1,\"y\":0,\"z\":-11}" +
                "],\"modules\":[]}",
                "tianhe-ceil-1");
            var ceilIdx1 = new StationIndex(ceilDoc1);
            var ceilInput = new StationCellMeshInput { VirtualGround = false, BuildGround = false, BuildCeilings = true };
            foreach (var c in ceilDoc1.Cells) ceilInput.Cells.Add(StationCellMeshWorkspace.BuildMeshCell(c, StationCellShape.Full, null));
            var ceilWs = StationCellMeshWorkspace.Create(ceilInput);
            var ceilGroups1 = ceilWs.MeshAll().Values.SelectMany(l => l).ToList();
            Assert.IsTrue(ceilGroups1.Any(g => g.Role == StationSurfaceRole.Ceiling && g.LocalFaces.Any(f => f.X == 0 && f.Y == 0 && f.Z == -11)),
                "Untagged -11 slab over clear -15 floor classifies as Ceiling");

            // Add wall support at (0, 0, -12): (0, 0, -11) must invalidate and emit in Cell instead of Ceiling.
            var ceilDoc2 = ParseDocument(
                "{\"v\":1,\"levelBase\":0,\"storeyHeight\":5,\"cells\":[" +
                "{\"x\":0,\"y\":0,\"z\":-15},{\"x\":1,\"y\":0,\"z\":-15}," +
                "{\"x\":0,\"y\":0,\"z\":-12}," +
                "{\"x\":0,\"y\":0,\"z\":-11},{\"x\":1,\"y\":0,\"z\":-11}" +
                "],\"modules\":[]}",
                "tianhe-ceil-2");
            var ceilIdx2 = new StationIndex(ceilDoc2);
            var addSupportDelta = new StationIndexDelta();
            addSupportDelta.ChangedCells.Add(ceilDoc2.Cells.First(c => c.Z == -12));
            var stagedAdd = ceilWs.StageDocumentDelta(ceilDoc2, ceilIdx2, addSupportDelta, ceilIdx1);
            stagedAdd.Commit();
            var ceilGroups2 = stagedAdd.GroupsByChunk.Values.SelectMany(l => l).ToList();
            Assert.IsFalse(ceilGroups2.Any(g => g.Role == StationSurfaceRole.Ceiling && g.LocalFaces.Any(f => f.X == 0 && f.Y == 0 && f.Z == -11)),
                "Adding support at -12 removes (0,0,-11) from Ceiling pass");
            Assert.IsTrue(ceilGroups2.Any(g => g.Role == StationSurfaceRole.Cell && g.LocalFaces.Any(f => f.X == 0 && f.Y == 0 && f.Z == -11)),
                "Adding support at -12 re-emits (0,0,-11) in Cell pass");

            // Removing support at (0, 0, -12) restores (0, 0, -11) back to Ceiling.
            var removeSupportDelta = new StationIndexDelta();
            removeSupportDelta.RemovedCells.Add(new StationCellKey(0, 0, -12));
            var stagedRemove = ceilWs.StageDocumentDelta(ceilDoc1, ceilIdx1, removeSupportDelta, ceilIdx2);
            stagedRemove.Commit();
            var ceilGroups3 = stagedRemove.GroupsByChunk.Values.SelectMany(l => l).ToList();
            Assert.IsTrue(ceilGroups3.Any(g => g.Role == StationSurfaceRole.Ceiling && g.LocalFaces.Any(f => f.X == 0 && f.Y == 0 && f.Z == -11)),
                "Removing support at -12 restores (0,0,-11) back to Ceiling pass");
        }

        [Test]
        public void RigidModelLodsTreeBudgetPillarsFinishesCatalogueStockDPsdAndEscalatorIndicatorsHold() {
            // 1. Baked rigid model LODs reduce indices (LOD2 <= LOD1 <= LOD0, strictly reducing on baked entries) & Tree LOD2 <= 400 tris.
            var lodGuids = AssetDatabase.FindAssets("t:StationRigidModelLods", new[] { "Assets/StationDesigner/Resources/ModelLods/Rigid" });
            Assert.Greater(lodGuids.Length, 0);
            int bakedCount = 0;
            foreach (string guid in lodGuids) {
                var lib = AssetDatabase.LoadAssetAtPath<StationRigidModelLods>(AssetDatabase.GUIDToAssetPath(guid));
                foreach (var entry in lib.Meshes) {
                    if (entry.Baked == null) continue;
                    bakedCount++;
                    long i0 = 0, i1 = 0, i2 = 0;
                    for (int s = 0; s < entry.Baked.subMeshCount; s++) {
                        i0 += entry.Baked.GetIndexCount(s, 0);
                        i1 += entry.Baked.GetIndexCount(s, 1);
                        i2 += entry.Baked.GetIndexCount(s, 2);
                    }
                    Assert.LessOrEqual(i1, i0, $"{lib.name}: LOD1 <= LOD0");
                    Assert.LessOrEqual(i2, i1, $"{lib.name}: LOD2 <= LOD1");
                    Assert.Less(i2, i0, $"{lib.name}: baked LOD2 strictly reduces LOD0");
                }
            }
            Assert.Greater(bakedCount, 0);

            var treePrefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/StationDesigner/Generated/Prefabs/Tree.prefab");
            Assert.IsNotNull(treePrefab);
            var treeLod = Resources.Load<StationRigidModelLods>(StationRigidModelLods.ResourcesPath + "Tree");
            Assert.IsNotNull(treeLod);
            long treeLod0Tris = 0, treeLod1Tris = 0, treeLod2Tris = 0;
            foreach (var entry in treeLod.Meshes) {
                var m = entry.Baked != null ? entry.Baked : entry.Source;
                Assert.IsNotNull(m);
                Assert.Greater(m.bounds.size.sqrMagnitude, 0f, "Tree mesh has non-empty bounds");
                Assert.AreEqual(m.vertexCount, m.uv.Length, "Tree mesh preserves UVs");
                int lod1 = Mathf.Clamp(1, 0, m.lodCount - 1);
                int lod2 = Mathf.Clamp(m.lodCount - 1, 0, 2);
                for (int s = 0; s < m.subMeshCount; s++) {
                    treeLod0Tris += m.GetIndexCount(s, 0) / 3;
                    treeLod1Tris += m.GetIndexCount(s, lod1) / 3;
                    treeLod2Tris += m.GetIndexCount(s, lod2) / 3;
                }
            }
            Assert.Greater(treeLod2Tris, 0, "Tree LOD2 preserves trunk/canopy triangles");
            Assert.Less(treeLod1Tris, treeLod0Tris, $"Tree LOD1 ({treeLod1Tris}) strictly reduces LOD0 ({treeLod0Tris})");
            Assert.Less(treeLod2Tris, treeLod1Tris, $"Tree LOD2 ({treeLod2Tris}) strictly reduces LOD1 ({treeLod1Tris})");
            Assert.Less(treeLod2Tris, treeLod0Tris / 2, $"Tree LOD2 ({treeLod2Tris}) must cut LOD0 ({treeLod0Tris}) by >50%");

            // 2. Thick & slim pillars across heights 2/5/6/10 m: 1 shaft + 2 collars, metre UVs > 1, DefaultRoofFinish == floor.concrete.
            Assert.AreEqual("floor.concrete", StationStructureGeometry.DefaultRoofFinish);
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Sprites/Default");
            var pillarMods = new JArray();
            int px = 0;
            foreach (var size in new[] { "thick", "slim" }) {
                foreach (int h in new[] { 2, 5, 6, 10 }) {
                    pillarMods.Add(new JObject {
                        ["id"] = $"pil-{size}-{h}", ["type"] = "pillar", ["x"] = px, ["y"] = 0, ["z"] = -5,
                        ["w"] = 1, ["d"] = 1, ["cfg"] = new JObject { ["size"] = size, ["height"] = h },
                    });
                    px += 2;
                }
            }
            var pillarDoc = ParseDocument(new JObject { ["v"] = 1, ["cells"] = new JArray(), ["modules"] = pillarMods }.ToString(), "pillars");
            var pillarIdx = new StationIndex(pillarDoc);
            var pillarRoot = Track(new GameObject("PillarWorld"));
            var structRenderer = new StationStructureModuleRenderer();
            var pillarCatalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(pillarCatalogue);
            var pillarWorld = TrackDisposable(new StationWorldView(
                pillarRoot.transform,
                "PillarWorld",
                new IStationViewRenderer[] { structRenderer },
                new StationViewAssets { Catalogue = pillarCatalogue, Shader = shader }));
            pillarWorld.Build(pillarDoc, pillarIdx);
            foreach (var size in new[] { "thick", "slim" }) {
                foreach (int h in new[] { 2, 5, 6, 10 }) {
                    string id = $"pil-{size}-{h}";
                    Assert.IsTrue(pillarWorld.TryGetModule(id, out var rec), $"Pillar {id} built");
                    var filters = rec.View.GetComponentsInChildren<MeshFilter>(true);
                    Assert.AreEqual(2, filters.Length, $"{id}: 1 shaft bin + 1 collar bin (2 end collars)");
                    float maxUvY = filters.SelectMany(f => f.sharedMesh.uv).Max(uv => Mathf.Abs(uv.y));
                    Assert.Greater(maxUvY, 1.0f, $"{id} (h={h}m): metre-scale UVs exceed 1.0");
                }
            }
            pillarWorld.Dispose();
            structRenderer.Release();

            // 3. Finish metadata pins: floor.obsidian, ceil.steel, floor.hardwood.
            var finishes = TrackDisposable(StationFinishLibrary.LoadFromResources("StationFinishes", shader));
            Assert.IsNotNull(finishes);
            var obsidian = finishes.Facts("floor.obsidian");
            Assert.AreEqual(0.24f, obsidian.Roughness, 1e-4f);
            Assert.AreEqual(0.02f, obsidian.Metalness, 1e-4f);
            var steel = finishes.Facts("ceil.steel");
            Assert.AreEqual(0.55f, steel.Roughness, 1e-4f);
            Assert.AreEqual(0.40f, steel.Metalness, 1e-4f);
            var hardwood = finishes.Facts("floor.hardwood");
            Assert.AreEqual(0.78f, hardwood.Roughness, 1e-4f);
            Assert.AreEqual(0.02f, hardwood.Metalness, 1e-4f);

            // 4. RuntimeCatalogue non-empty finite bounds sweep across every promoted prefab.
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue);
            int checkedPrefabs = 0;
            foreach (var entry in catalogue.Entries) {
                if (entry == null || entry.prefab == null) continue;
                checkedPrefabs++;
                var filters = entry.prefab.GetComponentsInChildren<MeshFilter>(true);
                bool anyMesh = false;
                foreach (var f in filters) {
                    if (f.sharedMesh == null || f.sharedMesh.vertexCount == 0) continue;
                    anyMesh = true;
                    var b = f.sharedMesh.bounds;
                    Assert.IsFalse(float.IsNaN(b.size.x) || float.IsNaN(b.size.y) || float.IsNaN(b.size.z) ||
                        float.IsInfinity(b.size.x) || float.IsInfinity(b.size.y) || float.IsInfinity(b.size.z),
                        $"{entry.key}: finite mesh bounds");
                }
                Assert.IsTrue(anyMesh, $"{entry.key}: promoted prefab must contain non-empty mesh geometry");
            }
            Assert.Greater(checkedPrefabs, 50);

            // 5. Stock D variable-width PSD openings (0.8 m narrow cab end door vs 1.4 m standard doors).
            var dCentres = TrainConsist.DoorCentres("D", 4, 1f);
            Assert.AreEqual(16, dCentres.Length, "4-car Stock D has 16 doors per side");
            Assert.AreEqual(0.8f, TrainConsist.DoorWidthAt("D", 4, 1f, dCentres[0]), 1e-4f, "Stock D cab-left end door is 0.8 m");
            Assert.AreEqual(1.4f, TrainConsist.DoorWidthAt("D", 4, 1f, dCentres[1]), 1e-4f, "Stock D interior door is 1.4 m");
            Assert.AreEqual(0.8f, TrainConsist.DoorWidthAt("D", 4, 1f, dCentres[dCentres.Length - 1]), 1e-4f, "Stock D cab-right end door is 0.8 m");

            var psdReq = new PsdRunRequest {
                ModuleId = "pe-stock-d", X = 0, Y = 0, Z = -5, Rotation = 0, Width = 84,
                Side = "left", Psd = "half", StoreyHeight = 5,
                HasTrack = true, TrackX = 0, TrackY = -1, TrackRotation = 0, TrackWidth = 84,
                HasLine = true, Stock = "D", Cars = 4, ModelScale = 1f,
            };
            Assert.IsTrue(OpeningModuleViews.TryPsdRun(psdReq, out var psdLayout, out var psdDiag), psdDiag);
            Assert.AreEqual(16, psdLayout.Openings.Count);
            Assert.AreEqual(0.8f, psdLayout.Openings[0].Width, 1e-4f, "Half PSD keeps narrow 0.8 m cab opening");
            Assert.AreEqual(1.4f, psdLayout.Openings[1].Width, 1e-4f, "Half PSD keeps standard 1.4 m opening");
            Assert.AreEqual(0.8f, psdLayout.Openings[15].Width, 1e-4f, "Half PSD keeps trailing 0.8 m cab opening");

            // 6. Escalator newel indicator lights present on built escalator view.
            var escParent = Track(new GameObject("EscalatorIndicatorsParent"));
            var escReq = new VerticalModuleRequest {
                ModuleId = "esc-1", Type = "escalator",
                ConfigJson = "{\"dir\":\"up\"}",
                X = 0, Y = 0, Z = -5, Rotation = 0, Width = 1, Depth = 1,
                HasEndpoints = true, FromX = 0, FromY = 0, FromZ = -5, ToX = 12, ToY = 0, ToZ = 0,
            };
            Assert.IsTrue(VerticalModuleViews.TryBuild(escReq, escParent.transform, out var escView));
            TrackDisposable(escView);
            var childNames = new HashSet<string>(
                escView.Root.GetComponentsInChildren<Transform>(true).Select(t => t.name),
                StringComparer.Ordinal);
            Assert.IsTrue(childNames.Contains("escalator-indicator"), "Escalator builds newel indicator housing");
            Assert.IsTrue(childNames.Contains("escalator-indicator-bezel"), "Escalator builds newel indicator bezel");
            Assert.IsTrue(childNames.Contains("entry-arrow"), "Escalator builds green entry-arrow indicator");
            Assert.IsTrue(childNames.Contains("stop-bar"), "Escalator builds red stop-bar indicator");
        }
    }
}
