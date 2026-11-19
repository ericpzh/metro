using System;
using System.Collections.Generic;
using System.Linq;
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

namespace Metro.EditModeTests {
    /// <summary>
    /// Deterministic two-floor presentation regressions for unified storey visibility across
    /// stationary cells/modules, soft-human crowd actors, train formations and pooled road
    /// vehicles — independent of any demo save or boarding schedule.
    /// </summary>
    public sealed class StationMovingVisibilityTests {
        GameObject root;
        PassengerCatalogue fallbackPassengerCatalogue;
        Mesh fallbackMesh;
        Material fallbackMaterial;
        readonly List<AnimationClip> fallbackClips = new List<AnimationClip>();

        [SetUp]
        public void SetUp() {
            PassengerCatalogueAnchor.ClearInjection();
            PassengerPoseFeeds.Clear();
            root = new GameObject("StationMovingVisibilityTests");
        }

        [TearDown]
        public void TearDown() {
            PassengerCatalogueAnchor.ClearInjection();
            PassengerPoseFeeds.Clear();
            if (root != null) UnityEngine.Object.DestroyImmediate(root);
            root = null;
            for (int i = 0; i < fallbackClips.Count; i++) {
                if (fallbackClips[i] != null) UnityEngine.Object.DestroyImmediate(fallbackClips[i]);
            }
            fallbackClips.Clear();
            if (fallbackMaterial != null) UnityEngine.Object.DestroyImmediate(fallbackMaterial);
            fallbackMaterial = null;
            if (fallbackMesh != null) UnityEngine.Object.DestroyImmediate(fallbackMesh);
            fallbackMesh = null;
            if (fallbackPassengerCatalogue != null) UnityEngine.Object.DestroyImmediate(fallbackPassengerCatalogue);
            fallbackPassengerCatalogue = null;
        }

        sealed class TwoFloorFixture : IDisposable {
            public StationReadResult Read;
            public StationWorldView World;
            public StationVisibilityRegistry Visibility;
            public PassengerCrowdRenderer Crowd;
            public TrainConsistRenderer Trains;
            public StationRoadRenderer Roads;

            public void Dispose() {
                Visibility?.Dispose();
                World?.Dispose();
            }
        }

        TwoFloorFixture BuildTwoFloorFixture(bool includeElevatedDeck = false) {
            var cells = new JArray();
            // Lower platform room at -20 m: (0..9, 0..3, -20)
            for (int x = 0; x < 10; x++) {
                for (int y = 0; y < 4; y++) {
                    cells.Add(new JObject {
                        ["x"] = x, ["y"] = y, ["z"] = -20,
                        ["fill"] = "solid",
                        ["zone"] = "paid",
                        ["finish"] = new JObject { ["top"] = "floor.concrete" },
                    });
                }
            }
            if (includeElevatedDeck) {
                for (int x = 0; x < 6; x++) {
                    for (int y = 0; y < 3; y++) {
                        cells.Add(new JObject {
                            ["x"] = x, ["y"] = y, ["z"] = 5,
                            ["fill"] = "solid",
                            ["zone"] = "unpaid",
                            ["finish"] = new JObject { ["top"] = "floor.concrete" },
                        });
                    }
                }
            }

            var modules = new JArray {
                // -20 m track + platform edge for a 6-car line-1 service
                new JObject {
                    ["id"] = "track-1", ["type"] = "track",
                    ["x"] = 0, ["y"] = -4, ["z"] = -20, ["rot"] = 0, ["w"] = 140, ["d"] = 4,
                    ["cfg"] = new JObject { ["line"] = "line-1", ["dir"] = "up" },
                },
                new JObject {
                    ["id"] = "edge-1", ["type"] = "platform-edge",
                    ["x"] = 0, ["y"] = 0, ["z"] = -20, ["rot"] = 0, ["w"] = 10, ["d"] = 1,
                    ["cfg"] = new JObject { ["line"] = "line-1", ["from"] = "track-1", ["side"] = "right", ["dir"] = "up" },
                },
                // Stair connecting -20 m and 0 m
                new JObject {
                    ["id"] = "stair-1", ["type"] = "stair",
                    ["x"] = 2, ["y"] = 2, ["z"] = -20, ["rot"] = 0, ["w"] = 20, ["d"] = 2,
                    ["from"] = new JObject { ["x"] = 2, ["y"] = 2, ["z"] = -20 },
                    ["to"] = new JObject { ["x"] = 22, ["y"] = 2, ["z"] = 0 },
                },
                // Lift connecting -20 m and 0 m
                new JObject {
                    ["id"] = "lift-1", ["type"] = "lift",
                    ["x"] = 8, ["y"] = 2, ["z"] = -20, ["rot"] = 0, ["w"] = 2, ["d"] = 2,
                    ["from"] = new JObject { ["x"] = 8, ["y"] = 2, ["z"] = -20 },
                    ["to"] = new JObject { ["x"] = 8, ["y"] = 2, ["z"] = 0 },
                },
                // Entrance head-house at 0 m (non-grade)
                new JObject {
                    ["id"] = "exit-1", ["type"] = "exit",
                    ["x"] = 24, ["y"] = 2, ["z"] = 0, ["rot"] = 0, ["w"] = 4, ["d"] = 6,
                    ["cfg"] = new JObject { ["label"] = "A" },
                },
                // Sidewalk at 0 m (grade-owned)
                new JObject {
                    ["id"] = "sidewalk-1", ["type"] = "sidewalk",
                    ["x"] = 32, ["y"] = 6, ["z"] = 0, ["rot"] = 0, ["w"] = 4, ["d"] = 4,
                },
                // Road at 0 m (grade-owned, 86 m long × 12 m wide 4-lane two-way road)
                new JObject {
                    ["id"] = "road-1", ["type"] = "road",
                    ["x"] = 0, ["y"] = 12, ["z"] = 0, ["rot"] = 3, ["w"] = 86, ["d"] = 12,
                    ["cfg"] = new JObject {
                        ["direction"] = "two-way",
                        ["from"] = new JArray(6, 18),
                        ["to"] = new JArray(80, 18),
                    },
                },
            };

            var lines = new JArray {
                new JObject {
                    ["id"] = "line-1", ["name"] = "Line 1", ["colour"] = "#e53935",
                    ["stock"] = "B", ["cars"] = 6, ["power"] = "overhead",
                    ["headway"] = 120, ["dwell"] = 25, ["direction"] = "up",
                },
            };

            var docJson = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "Two-Floor Visibility Fixture",
                ["city"] = "guangzhou",
                ["seed"] = 4242,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = cells,
                    ["modules"] = modules,
                    ["lines"] = lines,
                },
            };

            var read = StationDocumentReader.Read(docJson.ToString(Formatting.None), StationSource.None);
            Assert.IsNotNull(read?.Document);

            var passengerCatalogue = ResolveOrBuildPassengerCatalogue();
            PassengerCatalogueAnchor.Inject(passengerCatalogue);

            var runtimeCatalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            var trainCatalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            var litShader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");

            var cellRenderer = new StationCellRenderer();
            var openingRenderer = new OpeningModuleRenderer();
            var verticalRenderer = new VerticalModuleRenderer();
            var surfaceRenderer = new StationSurfaceModuleRenderer();
            var crowdRenderer = new PassengerCrowdRenderer();
            var trainRenderer = new TrainConsistRenderer();
            var roadRenderer = new StationRoadRenderer();

            var world = new StationWorldView(
                root.transform,
                "two-floor-world",
                new IStationViewRenderer[] {
                    cellRenderer, openingRenderer, verticalRenderer, surfaceRenderer,
                    crowdRenderer, trainRenderer, roadRenderer,
                },
                new StationViewAssets {
                    Catalogue = runtimeCatalogue,
                    TrainCatalogue = trainCatalogue,
                    Shader = litShader,
                });
            world.Build(read.Document, read.Index);
            world.Activate();

            var visibility = new StationVisibilityRegistry(litShader);
            visibility.State.ActiveLevel = -20;
            visibility.State.ShowLevels = true;
            StationViewFeature.RegisterWorld(visibility, world);

            return new TwoFloorFixture {
                Read = read,
                World = world,
                Visibility = visibility,
                Crowd = crowdRenderer,
                Trains = trainRenderer,
                Roads = roadRenderer,
            };
        }

        PassengerCatalogue ResolveOrBuildPassengerCatalogue() {
            var existing = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(PassengerCatalogue.AssetPath);
            if (existing != null && existing.Count > 0) return existing;

            fallbackMesh = new Mesh { name = "fallback-passenger-mesh" };
            fallbackMesh.vertices = new[] {
                new Vector3(-0.25f, 0f, -0.15f),
                new Vector3(0.25f, 0f, -0.15f),
                new Vector3(0.25f, 1.72f, 0.15f),
                new Vector3(-0.25f, 1.72f, 0.15f),
            };
            fallbackMesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            fallbackMesh.RecalculateNormals();
            fallbackMesh.RecalculateBounds();

            var shader = Shader.Find("Shader Graphs/glTF-pbrMetallicRoughness") ??
                         Shader.Find("Universal Render Pipeline/Lit") ??
                         Shader.Find("Unlit/Color");
            fallbackMaterial = new Material(shader) { name = "fallback-outfit" };
            if (fallbackMaterial.HasProperty("baseColorFactor")) fallbackMaterial.SetColor("baseColorFactor", new Color(0.8f, 0.3f, 0.2f, 1f));
            if (fallbackMaterial.HasProperty("_BaseColor")) fallbackMaterial.SetColor("_BaseColor", new Color(0.8f, 0.3f, 0.2f, 1f));

            var prefab = new GameObject("soft-male-commuter-none");
            prefab.transform.SetParent(root.transform, false);
            prefab.SetActive(false);
            var anim = prefab.AddComponent<Animation>();
            string[] clipNames = { "Idle", "WalkA", "WalkB", "WalkC", "WalkD", "WalkE", "WalkF", "WalkM", "Wait", "Lift" };
            var clipSet = new PassengerClipSet { clipNames = clipNames };
            for (int i = 0; i < clipNames.Length; i++) {
                var clip = new AnimationClip { name = clipNames[i], legacy = true };
                anim.AddClip(clip, clipNames[i]);
                fallbackClips.Add(clip);
            }
            var skinGo = new GameObject("Body");
            skinGo.transform.SetParent(prefab.transform, false);
            var skin = skinGo.AddComponent<SkinnedMeshRenderer>();
            skin.sharedMesh = fallbackMesh;
            skin.sharedMaterial = fallbackMaterial;
            skin.localBounds = fallbackMesh.bounds;

            fallbackPassengerCatalogue = ScriptableObject.CreateInstance<PassengerCatalogue>();
            fallbackPassengerCatalogue.clipSet = clipSet;
            fallbackPassengerCatalogue.entries = new[] {
                new PassengerCatalogueEntry {
                    index = 0,
                    recipe = "soft-male-commuter-none",
                    sex = "male",
                    outfit = "commuter",
                    accessory = "none",
                    prefab = prefab,
                },
            };
            fallbackPassengerCatalogue.Invalidate();
            return fallbackPassengerCatalogue;
        }

        static PassengerPose Pose(int simId, double x, double y, double z,
            PassengerActivity activity = PassengerActivity.Walk,
            StationPassengerState state = StationPassengerState.Walking,
            string serverId = "",
            bool visible = true) => new PassengerPose {
                SimId = simId,
                X = x,
                Y = y,
                Z = z,
                Heading = 0,
                Activity = activity,
                ActivitySeconds = 0.5,
                WalkDistance = 2.0,
                WalkPhase = 0.25,
                WalkWeight = 1.0,
                Detail = PassengerDetail.Full,
                State = state,
                ServerId = serverId,
                Visible = visible,
            };

        static float ReadEffectiveAlpha(SkinnedMeshRenderer skin) {
            Assert.IsNotNull(skin);
            if (skin.HasPropertyBlock()) {
                var block = new MaterialPropertyBlock();
                skin.GetPropertyBlock(block, 0);
                int gltfId = Shader.PropertyToID("baseColorFactor");
                if (block.HasColor(gltfId)) return block.GetColor(gltfId).a;
                int baseId = Shader.PropertyToID("_BaseColor");
                if (block.HasColor(baseId)) return block.GetColor(baseId).a;
            }
            var mat = skin.sharedMaterial;
            if (mat == null) return 1f;
            if (mat.HasProperty("baseColorFactor")) return mat.GetColor("baseColorFactor").a;
            if (mat.HasProperty("_BaseColor")) return mat.GetColor("_BaseColor").a;
            if (mat.HasProperty("_Color")) return mat.GetColor("_Color").a;
            return 1f;
        }

        [Test]
        public void UpperFloorActorSpawnedAboveRegisteredMinus20FloorIsHiddenOnFirstFrameAndNeverPollutesWorldRecords() {
            using var fixture = BuildTwoFloorFixture();
            int initialRecords = fixture.World.Records.Count;
            int initialModuleRecords = fixture.World.Summary().ModuleRecords;

            var poses = new List<PassengerPose> {
                Pose(101, 4.5, 1.5, -19.0), // standing on -20 m platform (cell.z + 1 = -19)
                Pose(202, 33.5, 7.5, 1.0),  // standing on 0 m sidewalk above -20 m (cell.z + 1 = +1)
            };
            PassengerPoseFeeds.SetSource(new DelegatePassengerPoseFeed(list => {
                list.AddRange(poses);
                return true;
            }));

            // First frame with ShowLevels = true at occupied -20 m.
            fixture.Crowd.Tick(fixture.Read.Document, fixture.Read.Index,
                new StationFrameClock(1, 1, 1.0, 1.0, 1.0, true));

            var view = fixture.Crowd.View;
            Assert.IsNotNull(view);
            Assert.IsTrue(view.TryGetActor(101, out var lowerActor));
            Assert.IsTrue(view.TryGetActor(202, out var upperActor));

            Assert.AreEqual(StationDrawMode.Base, lowerActor.Target.LastMode, "-20 m actor draws Base on active -20 m");
            Assert.IsTrue(lowerActor.Skin.enabled, "-20 m actor renderer is enabled on first frame");

            Assert.AreEqual(StationDrawMode.Hidden, upperActor.Target.LastMode, "0 m actor above occupied -20 m is Hidden on first frame");
            Assert.IsFalse(upperActor.Skin.enabled, "0 m actor SkinnedMeshRenderer must be disabled before drawing");
            Assert.AreEqual(1, view.VisibleActors, "only the active -20 m actor is counted visible");

            // Also verify ShowLevels = false on first-frame spawn of another upper-floor actor.
            fixture.Visibility.State.ShowLevels = false;
            fixture.Visibility.Apply();
            poses.Add(Pose(303, 25.5, 3.5, 1.0)); // standing on 0 m exit pad
            fixture.Crowd.Tick(fixture.Read.Document, fixture.Read.Index,
                new StationFrameClock(2, 1, 2.0, 2.0, 1.0, true));

            Assert.IsTrue(view.TryGetActor(303, out var secondUpper));
            Assert.AreEqual(StationDrawMode.Hidden, secondUpper.Target.LastMode);
            Assert.IsFalse(secondUpper.Skin.enabled);
            Assert.AreEqual(1, view.VisibleActors);

            // Runtime targets never enter world.Records or Summary().ModuleRecords (keeping StationScenePicker clean).
            Assert.AreEqual(initialRecords, fixture.World.Records.Count, "spawning passengers must not add StationViewRecords");
            Assert.AreEqual(initialModuleRecords, fixture.World.Summary().ModuleRecords);
            Assert.IsFalse(fixture.World.Records.Any(r => r.ModuleId != null && r.ModuleId.StartsWith("passenger:", StringComparison.Ordinal)));
        }

        [Test]
        public void ActorCrossingStairAndLiftUpdatesModePausesCleanlyDespawnsReusesAndDisposes() {
            using var fixture = BuildTwoFloorFixture();
            var view = fixture.Crowd.View;
            Assert.IsNotNull(view);

            // Pick a SimId whose Tone != 1 so property-block ghost alpha is exercised alongside material alpha.
            int walkerId = 17;
            for (int candidate = 1; candidate < 80; candidate++) {
                var look = PassengerAppearance.Look(view.Catalogue, candidate);
                if (Math.Abs(look.Tone - 1.0) > 1e-3) { walkerId = candidate; break; }
            }
            int liftRiderId = walkerId + 100;

            // 1) Start both at -20 m while viewing -20 m (ShowLevels = true).
            view.Render(new[] {
                Pose(walkerId, 2.5, 2.5, -19.0),
                Pose(liftRiderId, 8.5, 2.5, -20.0, PassengerActivity.Lift, StationPassengerState.Riding, "lift:lift-1"),
            }, 1.0);
            Assert.IsTrue(view.TryGetActor(walkerId, out var walker));
            Assert.IsTrue(view.TryGetActor(liftRiderId, out var liftRider));
            Assert.AreEqual(StationDrawMode.Base, walker.Target.LastMode);
            Assert.IsTrue(walker.Skin.enabled);
            Assert.AreEqual(1f, ReadEffectiveAlpha(walker.Skin), 1e-3f);
            Assert.AreEqual(StationDrawMode.Base, liftRider.Target.LastMode);
            Assert.IsTrue(liftRider.Skin.enabled);

            // 2) Move walker up the stair to 0 m (footZ = 1.0) and liftRider up the lift to 0 m (CarZ = 0.0).
            view.Render(new[] {
                Pose(walkerId, 22.5, 2.5, 1.0),
                Pose(liftRiderId, 8.5, 2.5, 0.0, PassengerActivity.Lift, StationPassengerState.Riding, "lift:lift-1"),
            }, 2.0);
            Assert.AreEqual(StationDrawMode.Hidden, walker.Target.LastMode, "reaching 0 m hides walker above -20 m");
            Assert.IsFalse(walker.Skin.enabled);
            Assert.AreEqual(StationDrawMode.Hidden, liftRider.Target.LastMode, "reaching 0 m stop hides lift rider above -20 m");
            Assert.IsFalse(liftRider.Skin.enabled);
            Assert.AreEqual(0, view.VisibleActors);

            // 3) Move both back down to -20 m (reverse direction), plus add a street walker (gradeOwned)
            //    and an entrance head-house pad walker (non-grade) on 0 m.
            int streetId = walkerId + 200;
            int exitPadId = walkerId + 300;
            view.Render(new[] {
                Pose(walkerId, 3.5, 1.0, -19.0),
                Pose(liftRiderId, 8.5, 2.5, -20.0, PassengerActivity.Lift, StationPassengerState.Riding, "lift:lift-1"),
                Pose(streetId, 33.5, 7.5, 1.0), // sidewalk-1 at (32..35, 6..9, 0) -> gradeOwned
                Pose(exitPadId, 25.5, 3.5, 1.0), // exit-1 pad at (24..27, 2..7, 0) -> non-grade
            }, 3.0);
            Assert.IsTrue(view.TryGetActor(streetId, out var streetActor));
            Assert.IsTrue(view.TryGetActor(exitPadId, out var exitActor));
            Assert.IsTrue(streetActor.Target.GradeOwned, "sidewalk pedestrian is grade-owned");
            Assert.IsFalse(exitActor.Target.GradeOwned, "entrance head-house pad pedestrian is not grade-owned");
            Assert.IsTrue(walker.Skin.enabled);
            Assert.IsTrue(liftRider.Skin.enabled);
            Assert.IsFalse(streetActor.Skin.enabled);
            Assert.IsFalse(exitActor.Skin.enabled);

            // 4) PAUSED view switches (no Render() call — retained poses only!):
            // Switch active floor to 0 m with ShowLevels = true: 0 m actors become Base, -20 m actors become Ghost (0.35 alpha)!
            fixture.Visibility.State.ActiveLevel = 0;
            fixture.Visibility.State.ShowLevels = true;
            fixture.Visibility.Apply();

            Assert.AreEqual(StationDrawMode.Base, streetActor.Target.LastMode);
            Assert.IsTrue(streetActor.Skin.enabled);
            Assert.AreEqual(StationDrawMode.Base, exitActor.Target.LastMode);
            Assert.IsTrue(exitActor.Skin.enabled);
            Assert.AreEqual(StationDrawMode.Ghost, walker.Target.LastMode, "-20 m walker ghosts beneath 0 m");
            Assert.IsTrue(walker.Skin.enabled);
            Assert.AreEqual(StationVisibilityPalette.GhostOpacity, ReadEffectiveAlpha(walker.Skin), 1e-3f,
                "ghosted passenger wears 35% ghost alpha even with per-submesh tone MaterialPropertyBlock");
            Assert.AreEqual(StationDrawMode.Ghost, liftRider.Target.LastMode);
            Assert.AreEqual(4, view.VisibleActors);

            // Toggle ShowLevels = false while paused at 0 m: -20 m actors hide, 0 m actors stay Base.
            fixture.Visibility.State.ShowLevels = false;
            fixture.Visibility.Apply();
            Assert.IsFalse(walker.Skin.enabled);
            Assert.IsFalse(liftRider.Skin.enabled);
            Assert.IsTrue(streetActor.Skin.enabled);
            Assert.IsTrue(exitActor.Skin.enabled);
            Assert.AreEqual(2, view.VisibleActors);

            // Toggle Hide Ground = true while paused at 0 m (with ShowLevels = true):
            // street walker hides with street geometry, while exit head-house walker stays Base and -20 m ghosts!
            fixture.Visibility.State.ShowLevels = true;
            fixture.Visibility.State.HideGround = true;
            fixture.Visibility.Apply();
            Assert.AreEqual(StationDrawMode.Hidden, streetActor.Target.LastMode);
            Assert.IsFalse(streetActor.Skin.enabled);
            Assert.AreEqual(StationDrawMode.Base, exitActor.Target.LastMode);
            Assert.IsTrue(exitActor.Skin.enabled);
            Assert.AreEqual(StationDrawMode.Ghost, walker.Target.LastMode);
            Assert.IsTrue(walker.Skin.enabled);
            Assert.AreEqual(3, view.VisibleActors);

            // Toggle Hide UI = true (with Hide Ground = false): every storey draws crisp Base (alpha 1.0).
            fixture.Visibility.State.HideGround = false;
            fixture.Visibility.State.SetHideUi(true);
            fixture.Visibility.Apply();
            Assert.AreEqual(StationDrawMode.Base, walker.Target.LastMode);
            Assert.AreEqual(1f, ReadEffectiveAlpha(walker.Skin), 1e-3f, "returning to Base restores opaque alpha");
            Assert.AreEqual(4, view.VisibleActors);
            fixture.Visibility.State.SetHideUi(false);

            // Cutaway section plane: y > 3.5 is Cut, y <= 3.5 is Kept, y == 3.5 straddles!
            fixture.Visibility.State.Cutaway = true;
            fixture.Visibility.SectionClipping = true;
            fixture.Visibility.Section = new StationSectionPlane {
                Anchor = new Vector3(10f, 3.5f, -10f),
                Azimuth = 0f,
                Offset = 0f,
            };
            fixture.Visibility.Apply();
            Assert.AreEqual(StationDrawMode.Base, walker.Target.LastMode, "walker at y=1.0 is wholly on kept side");
            Assert.IsTrue(walker.Skin.enabled);
            Assert.AreEqual(StationDrawMode.Base, exitActor.Target.LastMode, "exit actor at y=3.5 straddles the cut plane and stays drawn");
            Assert.IsTrue(exitActor.Skin.enabled);
            Assert.AreEqual(StationDrawMode.Hidden, streetActor.Target.LastMode, "street actor at y=7.5 is wholly on cut side");
            Assert.IsFalse(streetActor.Skin.enabled);

            // Move the cut-hidden streetActor across the section plane onto y=1.0 while Skin.enabled was false:
            // live bounds fallback must still detect the new world bounds and turn it back on!
            view.Render(new[] {
                Pose(streetId, 33.5, 1.0, 1.0),
            }, 4.0);
            Assert.AreEqual(StationDrawMode.Base, streetActor.Target.LastMode,
                "disabled SkinnedMeshRenderer moving from Cut to Kept side updates live bounds and draws");
            Assert.IsTrue(streetActor.Skin.enabled);

            // 5) Despawn all actors, then reuse a pooled recipe instance on -20 m while viewing -20 m.
            fixture.Visibility.State.Cutaway = false;
            fixture.Visibility.SectionClipping = false;
            fixture.Visibility.State.ActiveLevel = -20;
            fixture.Visibility.State.ShowLevels = true;
            fixture.Visibility.Apply();

            var reusedRoot = streetActor.Root;
            string reusedRecipe = streetActor.Recipe;
            view.Render(Array.Empty<PassengerPose>(), 5.0);
            Assert.AreEqual(0, view.VisibleActors);
            Assert.AreEqual(0, fixture.World.RuntimeTargetCount, "despawned actors unregister from runtime targets");
            Assert.IsFalse(reusedRoot.activeSelf);

            // Find a new SimId that selects the same recipe so cross-SimId pool reuse is verified.
            int newIdSameRecipe = streetId;
            for (int candidate = 1000; candidate < 5000; candidate++) {
                if (view.Catalogue.TryGetForSimId(candidate, out var entry) && entry.recipe == reusedRecipe) {
                    newIdSameRecipe = candidate;
                    break;
                }
            }
            view.Render(new[] { Pose(newIdSameRecipe, 33.5, 3.5, 1.0) }, 6.0);
            Assert.IsTrue(view.TryGetActor(newIdSameRecipe, out var reusedActor));
            Assert.AreSame(reusedRoot, reusedActor.Root, "despawned actor prefab instance is reused from recipe pool");
            Assert.AreEqual(StationDrawMode.Hidden, reusedActor.Target.LastMode, "reused actor on 0 m is hidden at -20 m on frame 1");
            Assert.IsFalse(reusedActor.Skin.enabled);

            // Move reused actor to -20 m -> immediately Base!
            view.Render(new[] { Pose(newIdSameRecipe, 4.5, 1.5, -19.0) }, 7.0);
            Assert.AreEqual(StationDrawMode.Base, reusedActor.Target.LastMode);
            Assert.IsTrue(reusedActor.Skin.enabled);
            Assert.AreEqual(1, fixture.World.RuntimeTargetCount);

            // 6) World disposal unregisters all runtime targets from the registry.
            int targetsBeforeDispose = fixture.Visibility.RegisteredTargets;
            fixture.World.Dispose();
            fixture.Visibility.Apply();
            Assert.Less(fixture.Visibility.RegisteredTargets, targetsBeforeDispose);
            Assert.AreEqual(0, fixture.World.RuntimeTargetCount);
        }

        [Test]
        public void TrainFormationsAlightingBoardingPassengersAndPooledRoadVehiclesInheritConsistentModes() {
            using var fixture = BuildTwoFloorFixture(includeElevatedDeck: true);
            Assert.IsTrue(fixture.Trains.TryGetConsist("line-1|track-1", out var consist), "line-1|track-1 consist must build");
            Assert.Greater(consist.Cars, 0);
            Assert.Greater(consist.Gangways.Count, 0, "6-car B formation includes gangways");

            var allTrainRenderers = consist.Root.GetComponentsInChildren<Renderer>(true);
            Assert.Greater(allTrainRenderers.Length, consist.Cars, "formation has car, gangway and door renderers");

            // Initially retired before service dispatch: Hidden across every view mode.
            Assert.IsFalse(consist.Visible);
            Assert.IsTrue(consist.Target.Parked);
            Assert.AreEqual(StationDrawMode.Hidden, consist.Target.LastMode);

            // Board/alight passengers while consist is still retired -> simulation-ineligible, must stay hidden!
            var crowdView = fixture.Crowd.View;
            crowdView.Render(new[] {
                Pose(501, 5.0, -0.5, -19.0, PassengerActivity.Wait, StationPassengerState.Boarding, "line:line-1|track-1"),
            }, 1.0);
            Assert.IsTrue(crowdView.TryGetActor(501, out var rider));
            Assert.IsFalse(rider.Skin.enabled, "rider bound to a retired consist cannot draw");

            // Mount consist in Dwell at -20 m while ActiveLevel = -20 m:
            fixture.Trains.Apply(new StationMotionFrame {
                Clock = new StationClockFrame { Playing = true, SimTimeSeconds = 10.0 },
                Trains = new[] {
                    new StationTrainFrame {
                        Id = "line-1|track-1",
                        LineId = "line-1",
                        TrackId = "track-1",
                        Phase = TrainPhase.Dwell,
                        PhaseSeconds = 5.0,
                        DoorFraction = 1.0,
                        ServiceSequence = 1,
                    },
                },
                Escalators = Array.Empty<StationEscalatorFrame>(),
                Lifts = Array.Empty<StationLiftFrame>(),
                Doors = Array.Empty<StationDoorFrame>(),
                Passengers = Array.Empty<StationPassengerFrame>(),
                Gates = Array.Empty<StationGateFrame>(),
            });
            Assert.IsTrue(consist.Visible);
            Assert.IsFalse(consist.Target.Parked);
            Assert.AreEqual(StationDrawMode.Base, consist.Target.LastMode);
            Assert.IsTrue(allTrainRenderers.All(r => r.enabled), "every car, gangway and door renderer enables in Base");

            // Alighting (drop-off) and Boarding passengers on line-1|track-1 agree with platform & train at -20 m:
            int alighterId = 502;
            crowdView.Render(new[] {
                Pose(501, 5.0, -1.5, -19.0, PassengerActivity.Wait, StationPassengerState.Boarding, "line:line-1|track-1"),
                Pose(alighterId, 5.0, -0.2, -19.0, PassengerActivity.Walk, StationPassengerState.Alighting, "line:line-1|track-1"),
            }, 10.0);
            Assert.IsTrue(crowdView.TryGetActor(alighterId, out var alighter));
            Assert.AreEqual(StationDrawMode.Base, rider.Target.LastMode);
            Assert.AreEqual(StationDrawMode.Base, alighter.Target.LastMode);
            Assert.IsTrue(rider.Skin.enabled && alighter.Skin.enabled);

            // Sample road vehicles on the 0 m road while viewing -20 m: all pooled vehicles must be Hidden!
            fixture.Roads.Update(12.0);
            var roadVehicles = fixture.Roads.Vehicles;
            Assert.IsNotNull(roadVehicles);
            Assert.Greater(roadVehicles.SampledVehicles, 0, "traffic sampled vehicles on road-1");
            Assert.AreEqual(0, roadVehicles.VisibleVehicles, "0 m road vehicles are hidden when viewing occupied -20 m");
            Assert.AreEqual(roadVehicles.SampledVehicles, roadVehicles.FilteredVehicles);
            foreach (var key in roadVehicles.GetComponentsInChildren<RoadVehicleKey>(true)) {
                if (!key.gameObject.activeInHierarchy) continue;
                Assert.IsTrue(key.GetComponentsInChildren<Renderer>(true).All(r => !r.enabled),
                    "every renderer (including riders) on 0 m pooled vehicle " + key.variant + " is disabled at -20 m");
            }

            // Switch active floor to 0 m (with ShowLevels = true) while paused:
            // - 0 m road vehicles become Base (all renderers enabled, opaque)
            // - -20 m train consist (cars, gangways, doors), -20 m platform, and both boarding/alighting riders become Ghost!
            fixture.Visibility.State.ActiveLevel = 0;
            fixture.Visibility.State.ShowLevels = true;
            fixture.Visibility.Apply();

            Assert.AreEqual(roadVehicles.SampledVehicles, roadVehicles.VisibleVehicles, "0 m road vehicles draw at 0 m");
            Assert.AreEqual(StationDrawMode.Ghost, consist.Target.LastMode, "-20 m consist ghosts from 0 m");
            Assert.IsTrue(allTrainRenderers.All(r => r.enabled), "all consist subparts stay enabled in Ghost");
            var sampleCarMat = allTrainRenderers[0].sharedMaterial;
            if (sampleCarMat != null && sampleCarMat.HasProperty("baseColorFactor")) {
                Assert.AreEqual(StationVisibilityPalette.GhostOpacity, sampleCarMat.GetColor("baseColorFactor").a, 1e-3f,
                    "glTF train material receives 35% ghost alpha");
            }
            Assert.AreEqual(StationDrawMode.Ghost, rider.Target.LastMode, "boarding rider ghosts with its train");
            Assert.AreEqual(StationDrawMode.Ghost, alighter.Target.LastMode, "alighting rider ghosts with its train and platform");

            // Switch active floor to +5 m (occupied elevated deck) with ShowLevels = true:
            // 0 m road vehicles become Ghost (35% alpha across car/bus/moped/bicycle + rider renderers)!
            fixture.Visibility.State.ActiveLevel = 5;
            fixture.Visibility.State.ShowLevels = true;
            fixture.Visibility.Apply();

            Assert.AreEqual(roadVehicles.SampledVehicles, roadVehicles.VisibleVehicles, "0 m road vehicles ghost beneath +5 m");
            int verifiedActiveVehicleSlots = 0;
            foreach (var key in roadVehicles.GetComponentsInChildren<RoadVehicleKey>(true)) {
                if (!key.gameObject.activeInHierarchy) continue;
                var vTarget = key.GetComponent<StationVisibilityTarget>();
                if (vTarget == null || vTarget.Parked) continue;
                verifiedActiveVehicleSlots++;
                Assert.AreEqual(StationDrawMode.Ghost, vTarget.LastMode, "vehicle " + key.variant + " ghosts below +5 m");
                foreach (var mr in key.GetComponentsInChildren<Renderer>(true)) {
                    Assert.IsTrue(mr.enabled, key.variant + " renderer enabled in Ghost");
                    Assert.IsTrue(StationVisibilityTarget.ResolveDrawableBaseMaterials(mr, out var baseMats) && baseMats.Length > 0);
                    var ghostMats = mr.sharedMaterials;
                    for (int m = 0; m < ghostMats.Length && m < baseMats.Length; m++) {
                        if (ghostMats[m] != null && ghostMats[m].HasProperty("baseColorFactor") &&
                            baseMats[m] != null && baseMats[m].HasProperty("baseColorFactor")) {
                            float origAlpha = baseMats[m].GetColor("baseColorFactor").a;
                            float expectedAlpha = origAlpha < .999f
                                ? origAlpha * StationVisibilityPalette.GhostOpacity
                                : StationVisibilityPalette.GhostOpacity;
                            Assert.AreEqual(expectedAlpha, ghostMats[m].GetColor("baseColorFactor").a, 1e-3f,
                                key.variant + " submaterial " + m + " ghost alpha");
                        }
                    }
                }
            }
            Assert.Greater(verifiedActiveVehicleSlots, 0);

            // ShowLevels = false at +5 m: both 0 m road vehicles and -20 m train + riders hide!
            fixture.Visibility.State.ShowLevels = false;
            fixture.Visibility.Apply();
            Assert.AreEqual(0, roadVehicles.VisibleVehicles);
            Assert.IsTrue(allTrainRenderers.All(r => !r.enabled), "entire consist hides when ShowLevels is off");
            Assert.IsFalse(rider.Skin.enabled);
            Assert.IsFalse(alighter.Skin.enabled);

            // Section straddle vs cut on the train formation:
            // Track runs along X around x=70; an East-facing plane (Azimuth = 90) at x=70 straddles the 6-car consist,
            // while at x=10 (facing +X, keeping x<=10) the consist centred around x=70 is wholly on the Cut side!
            fixture.Visibility.State.Cutaway = true;
            fixture.Visibility.SectionClipping = true;
            float consistDocX = consist.DocumentPosition.x;
            fixture.Visibility.Section = new StationSectionPlane {
                Anchor = new Vector3(consistDocX, 0f, -20f),
                Azimuth = 90f,
                Offset = 0f,
            };
            fixture.Visibility.Apply();
            Assert.AreEqual(StationDrawMode.Base, consist.Target.LastMode, "straddling consist stays drawn whole");
            Assert.IsTrue(allTrainRenderers.All(r => r.enabled), "cars, gangways and doors stay together when straddling");

            fixture.Visibility.Section = new StationSectionPlane {
                Anchor = new Vector3(consistDocX - 200f, 0f, -20f),
                Azimuth = 90f,
                Offset = 0f,
            };
            fixture.Visibility.Apply();
            Assert.AreEqual(StationDrawMode.Hidden, consist.Target.LastMode, "wholly cut consist hides");
            Assert.IsTrue(allTrainRenderers.All(r => !r.enabled), "cars, gangways and doors all hide when cut");
        }

        [Test]
        public void EscalatorRiderRemainsVisibleForFullDescentWhenViewingLowerStorey() {
            using var fixture = BuildTwoFloorFixture(includeElevatedDeck: true);
            var view = fixture.Crowd.View;
            Assert.IsNotNull(view);

            // Down escalator spanning 0 m -> -20 m while viewing the -20 m floor (ShowLevels = true).
            var ridePath = new StationRidePath(new[] {
                (22.5, 2.5, 1.0),
                (22.0, 2.5, 1.0),
                (3.0, 2.5, -19.0),
                (2.5, 2.5, -19.0),
            });

            PassengerPose RidePose(double progress) {
                ridePath.Sample(progress, false, 0, out double x, out double y, out double z, out double h);
                return new PassengerPose {
                    SimId = 777,
                    X = x, Y = y, Z = z, Heading = h,
                    Activity = PassengerActivity.Wait,
                    ActivitySeconds = 0.5,
                    RidePath = ridePath,
                    RideProgress = progress,
                    RideSeconds = 20.0,
                    WalkWeight = 0.0,
                    HasWalkWeight = true,
                    Detail = PassengerDetail.Full,
                    State = StationPassengerState.Riding,
                    ServerId = "ride:1",
                    Visible = true,
                };
            }

            // At ActiveLevel = -20 m, the rider must draw Base from progress = 0 (top landing) all the way down,
            // never popping into existence partway down the escalator.
            foreach (double progress in new[] { 0.0, 0.05, 0.25, 0.6, 0.95 }) {
                view.Render(new[] { RidePose(progress) }, 1.0 + progress * 20.0);
                Assert.IsTrue(view.TryGetActor(777, out var rider));
                Assert.AreEqual(StationDrawMode.Base, rider.Target.LastMode,
                    "rider at progress " + progress + " must stay Base on active -20 m floor");
                Assert.IsTrue(rider.Skin.enabled, "rider renderer enabled at progress " + progress);
            }

            // Switching to +5 m (above both ends of the 0 m -> -20 m escalator) ghosts the rider consistently.
            fixture.Visibility.State.ActiveLevel = 5;
            fixture.Visibility.State.ShowLevels = true;
            fixture.Visibility.Apply();
            Assert.IsTrue(view.TryGetActor(777, out var ghostRider));
            Assert.AreEqual(StationDrawMode.Ghost, ghostRider.Target.LastMode, "escalator rider ghosts beneath +5 m");
            Assert.IsTrue(ghostRider.Skin.enabled);
        }

        [Test]
        public void PassengerCrowdRendererInterpolatesSmoothlyWhenWalkingIntoAndOutOfLift() {
            using var fixture = BuildTwoFloorFixture();
            var view = fixture.Crowd.View;
            Assert.IsNotNull(view);

            PassengerPose currentPose = default;
            PassengerPoseFeeds.SetSource(new DelegatePassengerPoseFeed(list => {
                list.Add(currentPose);
                return true;
            }));

            PassengerPose LiftPose(double x, double y, double z, double heading, PassengerActivity act,
                StationPassengerState state, string serverId, double walkDist, double walkWeight) => new PassengerPose {
                SimId = 888,
                X = x, Y = y, Z = z, Heading = heading,
                Activity = act,
                ActivitySeconds = 0.5,
                WalkDistance = walkDist,
                WalkPhase = 0.0,
                WalkWeight = walkWeight,
                HasWalkWeight = true,
                Detail = PassengerDetail.Full,
                State = state,
                ServerId = serverId,
                Visible = true,
            };

            // Tick 1: waiting outside the lift door at (5.5, 4.5, -19.0) with WalkWeight = 0.
            currentPose = LiftPose(5.5, 4.5, -19.0, Math.PI * 0.5, PassengerActivity.Wait,
                StationPassengerState.Queuing, "lift:lift-1", 10.0, 0.0);
            fixture.Crowd.Tick(fixture.Read.Document, fixture.Read.Index,
                new StationFrameClock(1, 1, 1.0, 1.0, 1.0, true));

            // Tick 2: walking into the cab to (6.0, 5.7, -19.0) with WalkWeight = 1.
            currentPose = LiftPose(6.0, 5.7, -19.0, Math.PI * 0.4, PassengerActivity.Walk,
                StationPassengerState.Walking, "lift:lift-1", 11.3, 1.0);
            fixture.Crowd.Tick(fixture.Read.Document, fixture.Read.Index,
                new StationFrameClock(2, 1, 2.0, 1.25, 0.25, true));
            Assert.IsTrue(view.TryGetActor(888, out var actor));
            var midBoardDoc = StationCoordinates.WorldToDocument(actor.Position);
            Assert.AreEqual(5.625f, midBoardDoc.x, 1e-3f, "must smoothly interpolate into cab at alpha=0.25 (not snap)");
            Assert.AreEqual(4.8f, midBoardDoc.y, 1e-3f, "must smoothly interpolate across doorway at alpha=0.25");
            Assert.AreNotEqual("Idle", actor.ClipName, "walking into cab must sample a walk clip immediately from alpha=0.25");

            // Tick 3: settled inside cab at (6.245, 6.0, -19.0) in Lift Riding state.
            currentPose = LiftPose(6.245, 6.0, -19.0, -Math.PI * 0.5, PassengerActivity.Lift,
                StationPassengerState.Riding, "lift:lift-1", 11.3, 0.0);
            fixture.Crowd.Tick(fixture.Read.Document, fixture.Read.Index,
                new StationFrameClock(3, 1, 3.0, 2.5, 0.5, true));
            var midSettleDoc = StationCoordinates.WorldToDocument(actor.Position);
            Assert.AreEqual(6.1225f, midSettleDoc.x, 1e-3f, "Walking -> Riding lift transition must interpolate (not snap)");

            // Tick 4: lift moving up at peak eased speed (2.25 m/s) stays interpolated (not snapped).
            currentPose = LiftPose(6.245, 6.0, -16.75, -Math.PI * 0.5, PassengerActivity.Lift,
                StationPassengerState.Riding, "lift:lift-1", 11.3, 0.0);
            fixture.Crowd.Tick(fixture.Read.Document, fixture.Read.Index,
                new StationFrameClock(4, 1, 4.0, 3.5, 0.5, true));
            var midRideDoc = StationCoordinates.WorldToDocument(actor.Position);
            Assert.AreEqual(-17.875f, midRideDoc.z, 1e-3f, "peak-speed vertical lift travel must stay smoothly interpolated");

            // Tick 5: walking out of the cab from Riding -> Walking across the doorway.
            currentPose = LiftPose(5.5, 4.8, -16.75, -Math.PI * 0.5, PassengerActivity.Walk,
                StationPassengerState.Walking, "lift:lift-1", 12.7, 1.0);
            fixture.Crowd.Tick(fixture.Read.Document, fixture.Read.Index,
                new StationFrameClock(5, 1, 5.0, 4.5, 0.5, true));
            var midExitDoc = StationCoordinates.WorldToDocument(actor.Position);
            Assert.AreEqual(5.4f, midExitDoc.y, 1e-3f, "Riding -> Walking lift exit must smoothly interpolate out through door");
            Assert.AreNotEqual("Idle", actor.ClipName, "walking out of cab must sample a walk clip");
        }
    }
}
