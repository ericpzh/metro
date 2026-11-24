using System;
using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Deterministic EditMode verification for Workstream C: GPU-instanced escalator and
    /// moving-walkway step bands (<see cref="EscalatorStepInstancedDrawer"/>).
    /// Covers zero per-step MeshRenderers, analytic StepHeight/Wrap matrix parity across
    /// phases/pause/reverse/loop closure, visibility mode &amp; section-clip propagation,
    /// frustum culling, clean teardown, and &gt;1023 matrix batching/chunking via
    /// <see cref="VerticalModuleRenderer"/>.
    /// </summary>
    public sealed class StationPerfEscalatorInstancingTests {
        const string EscalatorPrefabPath = "Assets/StationDesigner/Generated/Prefabs/Escalator.prefab";

        readonly List<GameObject> spawned = new List<GameObject>();
        readonly List<VerticalModuleView> views = new List<VerticalModuleView>();
        readonly List<StationWorldView> worlds = new List<StationWorldView>();
        readonly List<StationVisibilityRegistry> registries = new List<StationVisibilityRegistry>();
        readonly List<StationVisibilityPalette> palettes = new List<StationVisibilityPalette>();

        [TearDown]
        public void TearDown() {
            for (int i = 0; i < views.Count; i++) views[i]?.Dispose();
            views.Clear();
            for (int i = 0; i < worlds.Count; i++) worlds[i]?.Dispose();
            worlds.Clear();
            for (int i = 0; i < registries.Count; i++) registries[i]?.ResetMaterials();
            registries.Clear();
            for (int i = 0; i < palettes.Count; i++) palettes[i]?.Dispose();
            palettes.Clear();
            for (int i = 0; i < spawned.Count; i++) {
                if (spawned[i] != null) UnityEngine.Object.DestroyImmediate(spawned[i]);
            }
            spawned.Clear();
        }

        GameObject TrackGo(string name) {
            var go = new GameObject(name);
            spawned.Add(go);
            return go;
        }

        static GameObject LoadEscalatorPrefab() =>
            AssetDatabase.LoadAssetAtPath<GameObject>(EscalatorPrefabPath);

        static Shader LitShader() =>
            Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");

        static JObject EscalatorJson(string id, int x, int y, int z, int runX, int runY, int rise,
            string dir = "up", int width = 1, int rot = 0) {
            bool down = string.Equals(dir, "down", StringComparison.Ordinal);
            int fx = down ? x + runX : x;
            int fy = down ? y + runY : y;
            int fz = down ? z + rise : z;
            int tx = down ? x : x + runX;
            int ty = down ? y : y + runY;
            int tz = down ? z : z + rise;
            return new JObject {
                ["id"] = id, ["type"] = "escalator", ["x"] = x, ["y"] = y, ["z"] = z, ["rot"] = rot,
                ["w"] = 1, ["d"] = 1,
                ["from"] = new JObject { ["x"] = fx, ["y"] = fy, ["z"] = fz },
                ["to"] = new JObject { ["x"] = tx, ["y"] = ty, ["z"] = tz },
                ["cfg"] = new JObject { ["incline"] = 30, ["dir"] = dir, ["width"] = width },
            };
        }

        static JObject WalkwayJson(string id, int x, int y, int z, int length, int width = 2) => new JObject {
            ["id"] = id, ["type"] = "walkway", ["x"] = x, ["y"] = y, ["z"] = z, ["rot"] = 1,
            ["w"] = 1, ["d"] = 1,
            ["from"] = new JObject { ["x"] = x, ["y"] = y, ["z"] = z },
            ["to"] = new JObject { ["x"] = x + length, ["y"] = y, ["z"] = z },
            ["cfg"] = new JObject { ["dir"] = "up", ["width"] = width },
        };

        VerticalModuleView BuildBandView(JObject json, Transform parent, GameObject prefab = null, string prefabKey = "") {
            var request = VerticalModuleRequest.FromFacts(ModuleFactsReader.Read(json), prefab, prefabKey, (_, __, ___) => false);
            Assert.IsTrue(VerticalModuleViews.TryBuild(request, parent, out var view),
                "VerticalModuleViews.TryBuild failed for " + (string)json["id"]);
            views.Add(view);
            return view;
        }

        static int ExpectedVisibleSteps(VerticalModuleView view, double phaseMeters, out int expectedRisers) {
            // Re-derive the analytic StepHeight/Wrap visibility counts independently from public view facts.
            Assert.IsTrue(view.TryGetPart("band-lower", out var lowerT));
            Assert.IsTrue(view.TryGetPart("band-upper", out var upperT));
            var lowerDoc = StationCoordinates.WorldToDocument(lowerT.position);
            var upperDoc = StationCoordinates.WorldToDocument(upperT.position);
            var delta = upperDoc - lowerDoc;
            double inclineLength = delta.magnitude;
            double climbZ = delta.z / inclineLength;
            double runPerM = new Vector2(delta.x, delta.y).magnitude / inclineLength;
            double chain = view.RunLength;
            double flat = (chain - inclineLength) * 0.5;
            double pitch = view.StepPitch;
            double minVisible = -flat + pitch * 0.5;
            double maxVisible = inclineLength + flat - pitch * 0.5;

            int visibleTreads = 0;
            expectedRisers = 0;
            for (int i = 0; i < view.StepCount; i++) {
                double u = VerticalModuleViews.Wrap(i * pitch + phaseMeters, chain);
                double along = u - flat;
                bool covered = along < minVisible || along > maxVisible;
                if (covered) continue;
                visibleTreads++;
                double h0 = VerticalModuleViews.StepHeight(along, inclineLength, climbZ, runPerM);
                double h1 = VerticalModuleViews.StepHeight(along + pitch, inclineLength, climbZ, runPerM);
                if (h1 - h0 > 1e-5) expectedRisers++;
            }
            return visibleTreads;
        }

        static int FindBucketIndex(EscalatorStepInstancedDrawer drawer, Mesh mesh, int submesh) {
            for (int i = 0; i < drawer.ActiveBucketCount; i++) {
                if (drawer.TryGetBucket(i, out var snap) && ReferenceEquals(snap.Mesh, mesh) && snap.SubmeshIndex == submesh)
                    return i;
            }
            return -1;
        }

        [Test]
        public void ZeroPerStepMeshRenderersAreSpawnedAcrossPrefabDimensionedAndWalkwayBands() {
            var parent = TrackGo("zero-per-step-renderers");
            var prefab = LoadEscalatorPrefab();
            Assert.IsNotNull(prefab, "promoted Escalator.prefab must exist");

            var built = new[] {
                BuildBandView(EscalatorJson("esc-prefab", 0, 0, 0, 0, 9, 5, "up", width: 1), parent.transform, prefab, "escalator"),
                BuildBandView(EscalatorJson("esc-wide", 10, 0, 0, 9, 0, 5, "down", width: 2, rot: 1), parent.transform, prefab, "escalator"),
                BuildBandView(EscalatorJson("esc-double", 25, 0, -10, 0, 18, 10, "up", width: 1), parent.transform, prefab, "escalator"),
                BuildBandView(WalkwayJson("wk-flat", 40, 0, 0, 30, width: 2), parent.transform),
            };

            Assert.IsTrue(built[0].UsedPrefab, "canonical 9x5x30 narrow escalator should use prefab");
            Assert.IsFalse(built[1].UsedPrefab, "width-2 escalator should build dimensionally");
            Assert.IsFalse(built[2].UsedPrefab, "double-storey escalator should build dimensionally");

            foreach (var view in built) {
                Assert.IsNotNull(view.BandTreadMesh, view.ModuleId + " must expose BandTreadMesh");
                Assert.AreEqual(2, view.BandTreadMesh.subMeshCount, view.ModuleId + " tread mesh keeps steel + nosing submeshes");
                Assert.IsNotNull(view.BandRiserMesh, view.ModuleId + " must expose BandRiserMesh");
                Assert.AreEqual(1, view.BandRiserMesh.subMeshCount, view.ModuleId + " riser mesh keeps 1 submesh");
                Assert.IsNotNull(view.BandProxyRenderer, view.ModuleId + " must expose single band proxy MeshRenderer");
                Assert.IsTrue(view.TryGetPart("band", out var bandGroup), view.ModuleId + " exposes band group");
                Assert.IsTrue(view.TryGetPart("tread-0", out var tread0) && tread0 != null, view.ModuleId + " exposes tread-0 anchor");
                Assert.IsTrue(view.TryGetPart("tread-last", out var treadLast) && treadLast != null, view.ModuleId + " exposes tread-last anchor");

                // Single zero-triangle proxy MeshRenderer on band itself; ZERO MeshRenderers/MeshFilters on any step child.
                var bandRenderers = bandGroup.GetComponentsInChildren<MeshRenderer>(true);
                Assert.AreEqual(1, bandRenderers.Length, view.ModuleId + " band must have only 1 proxy MeshRenderer, zero per-step renderers");
                Assert.AreSame(view.BandProxyRenderer, bandRenderers[0]);
                var proxyFilter = bandGroup.GetComponent<MeshFilter>();
                Assert.IsNotNull(proxyFilter);
                Assert.IsNotNull(proxyFilter.sharedMesh);
                Assert.AreEqual(1, proxyFilter.sharedMesh.subMeshCount, "proxy mesh keeps 1 empty triangle submesh for picker safety");
                Assert.AreEqual(0, proxyFilter.sharedMesh.triangles.Length, "proxy mesh has zero triangles");

                var proxyMats = view.BandProxyRenderer.sharedMaterials;
                Assert.AreEqual(2, proxyMats.Length, "proxy renderer tracks steel + warm step materials");
                Assert.IsTrue(proxyMats[0].enableInstancing, "steel step material enables GPU instancing");
                Assert.IsTrue(proxyMats[1].enableInstancing, "warm nosing material enables GPU instancing");

                foreach (var child in bandGroup.GetComponentsInChildren<Transform>(true)) {
                    if (child == bandGroup) continue;
                    Assert.IsFalse(child.name.StartsWith("riser-", StringComparison.Ordinal),
                        view.ModuleId + " must not spawn riser GameObjects (" + child.name + ")");
                    Assert.IsNull(child.GetComponent<MeshRenderer>(),
                        view.ModuleId + " step anchor " + child.name + " must not have MeshRenderer");
                    Assert.IsNull(child.GetComponent<MeshFilter>(),
                        view.ModuleId + " step anchor " + child.name + " must not have MeshFilter");
                }
            }
        }

        [Test]
        public void InstancedBandMatricesMatchStepHeightAndWrapMathAcrossPhasesPauseReverseAndLoopClosure() {
            var parent = TrackGo("instanced-step-math");
            var prefab = LoadEscalatorPrefab();
            Assert.IsNotNull(prefab);

            var cases = new[] {
                BuildBandView(EscalatorJson("esc-prefab", 4, 8, -5, 0, 9, 5, "up", width: 1), parent.transform, prefab, "escalator"),
                BuildBandView(EscalatorJson("esc-dim-down", 20, 12, -5, 9, 0, 5, "down", width: 2, rot: 1), parent.transform, prefab, "escalator"),
            };

            foreach (var view in cases) {
                var drawerHost = TrackGo("drawer-" + view.ModuleId);
                var drawer = EscalatorStepInstancedDrawer.EnsureFor(drawerHost.transform);
                drawer.Register(view);

                Matrix4x4[] phase0Treads = null;
                foreach (double seconds in new[] { 0.0, 2.5, 5.0 }) {
                    Assert.IsTrue(view.Apply(ModuleMotionState.Escalator(view.ModuleId, seconds, true, 1)));
                    drawer.CollectDrawBuckets();

                    int expectedTreads = ExpectedVisibleSteps(view, view.PhaseMeters, out int expectedRisers);
                    Assert.AreEqual(1, drawer.LastVisibleBandCount, view.ModuleId + " visible band");
                    Assert.AreEqual(expectedTreads, drawer.LastTreadInstanceCount, view.ModuleId + " tread count at t=" + seconds);
                    Assert.AreEqual(expectedRisers, drawer.LastRiserInstanceCount, view.ModuleId + " riser count at t=" + seconds);
                    Assert.AreEqual(3, drawer.ActiveBucketCount, view.ModuleId + " 3 buckets: tread steel, tread warm, riser steel");

                    int steelIdx = FindBucketIndex(drawer, view.BandTreadMesh, 0);
                    int warmIdx = FindBucketIndex(drawer, view.BandTreadMesh, 1);
                    int riserIdx = FindBucketIndex(drawer, view.BandRiserMesh, 0);
                    Assert.GreaterOrEqual(steelIdx, 0);
                    Assert.GreaterOrEqual(warmIdx, 0);
                    Assert.GreaterOrEqual(riserIdx, 0);

                    Assert.IsTrue(drawer.TryGetBucket(steelIdx, out var steelBucket));
                    Assert.IsTrue(drawer.TryGetBucket(warmIdx, out var warmBucket));
                    Assert.IsTrue(drawer.TryGetBucket(riserIdx, out var riserBucket));
                    Assert.AreEqual(expectedTreads, steelBucket.Count);
                    Assert.AreEqual(expectedTreads, warmBucket.Count);
                    Assert.AreEqual(expectedRisers, riserBucket.Count);

                    var treadMats = new Matrix4x4[steelBucket.Count];
                    var warmMats = new Matrix4x4[warmBucket.Count];
                    var riserMats = new Matrix4x4[riserBucket.Count];
                    Assert.AreEqual(steelBucket.Count, drawer.CopyBucketMatrices(steelIdx, treadMats));
                    Assert.AreEqual(warmBucket.Count, drawer.CopyBucketMatrices(warmIdx, warmMats));
                    Assert.AreEqual(riserBucket.Count, drawer.CopyBucketMatrices(riserIdx, riserMats));

                    int ti = 0, ri = 0;
                    for (int s = 0; s < view.StepCount; s++) {
                        Assert.IsTrue(view.TryGetStepWorldPose(s, out bool visible, out var worldPos, out var worldRot, out _, out float riserScaleY));
                        if (!visible) continue;

                        Vector3 matPos = treadMats[ti].GetColumn(3);
                        Assert.LessOrEqual(Vector3.Distance(worldPos, matPos), 1e-4f,
                            $"{view.ModuleId} t={seconds} step {s} tread matrix translation");
                        Assert.AreEqual(treadMats[ti], warmMats[ti], "both tread submeshes share identical matrices");
                        // Verify step anchor transform (present in EditMode) agrees with matrix translation.
                        Assert.IsTrue(view.TryGetPart("band", out var bandGroup));
                        var anchor = bandGroup.Find("tread-" + s);
                        Assert.IsNotNull(anchor);
                        Assert.IsTrue(anchor.gameObject.activeSelf);
                        Assert.LessOrEqual(Vector3.Distance(anchor.position, matPos), 1e-4f,
                            $"{view.ModuleId} t={seconds} step {s} anchor matches instanced matrix");
                        ti++;

                        if (riserScaleY > 1e-5f) {
                            Vector3 riserPos = riserMats[ri].GetColumn(3);
                            Assert.LessOrEqual(Vector3.Distance(worldPos, riserPos), 1e-4f,
                                $"{view.ModuleId} t={seconds} step {s} riser translation");
                            float col1Len = ((Vector3)riserMats[ri].GetColumn(1)).magnitude;
                            Assert.AreEqual(riserScaleY, col1Len, 1e-4f,
                                $"{view.ModuleId} t={seconds} step {s} riser Y scale");
                            ri++;
                        }
                    }
                    Assert.AreEqual(expectedTreads, ti);
                    Assert.AreEqual(expectedRisers, ri);
                    if (seconds == 0.0) phase0Treads = treadMats;
                }

                // Paused state holds exact matrices without advancing.
                Assert.IsTrue(view.Apply(ModuleMotionState.Escalator(view.ModuleId, 5.0, true, 1)));
                drawer.CollectDrawBuckets();
                int idxBeforePause = FindBucketIndex(drawer, view.BandTreadMesh, 0);
                Assert.IsTrue(drawer.TryGetBucket(idxBeforePause, out var beforePauseBucket));
                var pausedBefore = new Matrix4x4[beforePauseBucket.Count];
                drawer.CopyBucketMatrices(idxBeforePause, pausedBefore);

                Assert.IsTrue(view.Apply(ModuleMotionState.Escalator(view.ModuleId, 17.5, false, 1)));
                drawer.CollectDrawBuckets();
                var pausedAfter = new Matrix4x4[beforePauseBucket.Count];
                Assert.AreEqual(beforePauseBucket.Count, drawer.CopyBucketMatrices(FindBucketIndex(drawer, view.BandTreadMesh, 0), pausedAfter));
                CollectionAssert.AreEqual(pausedBefore, pausedAfter, view.ModuleId + " paused escalator must hold identical matrices");

                // Reversed direction mirrors phase cleanly.
                Assert.IsTrue(view.Apply(ModuleMotionState.Escalator(view.ModuleId, 4.0, true, 1)));
                double forwardPhase = view.PhaseMeters;
                Assert.IsTrue(view.Apply(ModuleMotionState.Escalator(view.ModuleId, 4.0, true, -1)));
                double reversedPhase = view.PhaseMeters;
                Assert.AreEqual(VerticalModuleViews.Wrap(view.RunLength - forwardPhase, view.RunLength), reversedPhase, 1e-5,
                    view.ModuleId + " reversed direction mirrors phase");
                drawer.CollectDrawBuckets();
                int expectedRevTreads = ExpectedVisibleSteps(view, reversedPhase, out int expectedRevRisers);
                Assert.AreEqual(expectedRevTreads, drawer.LastTreadInstanceCount);
                Assert.AreEqual(expectedRevRisers, drawer.LastRiserInstanceCount);

                // Full loop returns exact phase 0 matrices.
                Assert.IsTrue(view.Apply(ModuleMotionState.Escalator(view.ModuleId, view.LoopSeconds, true, 1)));
                drawer.CollectDrawBuckets();
                int loopIdx = FindBucketIndex(drawer, view.BandTreadMesh, 0);
                Assert.IsTrue(drawer.TryGetBucket(loopIdx, out var loopBucket));
                Assert.AreEqual(phase0Treads.Length, loopBucket.Count, view.ModuleId + " loop closure tread count");
                var loopTreads = new Matrix4x4[loopBucket.Count];
                drawer.CopyBucketMatrices(loopIdx, loopTreads);
                for (int k = 0; k < phase0Treads.Length; k++) {
                    Vector3 p0 = phase0Treads[k].GetColumn(3);
                    Vector3 p1 = loopTreads[k].GetColumn(3);
                    Assert.LessOrEqual(Vector3.Distance(p0, p1), 1e-3f,
                        $"{view.ModuleId} loop closure matrix {k} returned to start");
                }
            }

            // Level walkway emits treads with zero risers (2 buckets, no riser bucket).
            var walkway = BuildBandView(WalkwayJson("wk-math", 0, 30, 0, 30, width: 2), parent.transform);
            var wkDrawerHost = TrackGo("drawer-walkway");
            var wkDrawer = EscalatorStepInstancedDrawer.EnsureFor(wkDrawerHost.transform);
            wkDrawer.Register(walkway);
            wkDrawer.CollectDrawBuckets();
            Assert.Greater(wkDrawer.LastTreadInstanceCount, 50, "30 m walkway emits visible treads");
            Assert.AreEqual(0, wkDrawer.LastRiserInstanceCount, "level walkway emits zero risers");
            Assert.AreEqual(2, wkDrawer.ActiveBucketCount, "level walkway emits only 2 tread submesh buckets");
        }

        [Test]
        public void VisibilityModeTransitionsSectionClippingFrustumCullingAndTeardownCleanlyControlInstancedBands() {
            var parent = TrackGo("visibility-and-culling");
            var shader = LitShader();
            Assert.IsNotNull(shader);

            var view = BuildBandView(EscalatorJson("esc-vis", 0, 0, -5, 0, 9, 5, "up", width: 2), parent.transform);
            var drawer = EscalatorStepInstancedDrawer.EnsureFor(parent.transform);
            drawer.Register(view);

            var registry = new StationVisibilityRegistry(shader);
            registries.Add(registry);
            registry.State.ActiveLevel = -5;
            registry.State.ShowLevels = true;
            var target = registry.Register(view.Root, StationPartRole.Prop, new[] { -5, 0 });
            registry.Apply();

            // 1. Base mode: visible with base steel & warm materials.
            drawer.CollectDrawBuckets();
            Assert.AreEqual(1, drawer.LastVisibleBandCount);
            Assert.Greater(drawer.LastTreadInstanceCount, 10);
            Assert.Greater(drawer.LastRiserInstanceCount, 10);
            int steelIdx = FindBucketIndex(drawer, view.BandTreadMesh, 0);
            int warmIdx = FindBucketIndex(drawer, view.BandTreadMesh, 1);
            Assert.IsTrue(drawer.TryGetBucket(steelIdx, out var baseSteel));
            Assert.IsTrue(drawer.TryGetBucket(warmIdx, out var baseWarm));
            Assert.IsNotNull(baseSteel.Material);
            Assert.IsNotNull(baseWarm.Material);
            Assert.IsFalse(baseSteel.HasSection);

            // 2. Hidden mode: 0 visible bands, 0 buckets, 0 instances.
            registry.State.ActiveLevel = -15;
            registry.State.ShowLevels = false;
            registry.Apply();
            Assert.AreEqual(StationDrawMode.Hidden, target.LastMode);
            drawer.CollectDrawBuckets();
            Assert.AreEqual(0, drawer.LastVisibleBandCount, "Hidden band must not draw");
            Assert.AreEqual(0, drawer.ActiveBucketCount, "Hidden band emits 0 draw buckets");
            Assert.AreEqual(0, drawer.LastTreadInstanceCount);
            Assert.AreEqual(0, drawer.LastRiserInstanceCount);

            // 3. Ghost mode (other storey with ShowLevels=true): visible with transparent instancing-enabled ghost materials.
            registry.State.ActiveLevel = 5;
            registry.State.ShowLevels = true;
            registry.Apply();
            Assert.AreEqual(StationDrawMode.Ghost, target.LastMode);
            drawer.CollectDrawBuckets();
            Assert.AreEqual(1, drawer.LastVisibleBandCount, "Ghosted band draws");
            Assert.Greater(drawer.LastTreadInstanceCount, 10);
            Assert.IsTrue(drawer.TryGetBucket(FindBucketIndex(drawer, view.BandTreadMesh, 0), out var ghostSteel));
            Assert.AreNotSame(baseSteel.Material, ghostSteel.Material, "Ghost swaps to ghost material clone");
            Assert.IsTrue(ghostSteel.Material.enableInstancing, "Ghost material preserves enableInstancing");
            Assert.GreaterOrEqual(ghostSteel.Material.renderQueue, (int)UnityEngine.Rendering.RenderQueue.Transparent,
                "Ghost material renders in Transparent queue");

            // 4. Clear mode via StationVisibilityPalette: transparent clear clone with instancing enabled.
            var palette = new StationVisibilityPalette(shader);
            palettes.Add(palette);
            target.Apply(StationDrawMode.Clear, palette);
            drawer.CollectDrawBuckets();
            Assert.AreEqual(1, drawer.LastVisibleBandCount, "Clear band draws");
            Assert.IsTrue(drawer.TryGetBucket(FindBucketIndex(drawer, view.BandTreadMesh, 0), out var clearSteel));
            Assert.AreNotSame(baseSteel.Material, clearSteel.Material);
            Assert.AreNotSame(ghostSteel.Material, clearSteel.Material);
            Assert.IsTrue(clearSteel.Material.enableInstancing, "Clear material preserves enableInstancing");

            // 5. Return to Base mode: exact original materials restored.
            registry.State.ActiveLevel = -5;
            registry.State.ShowLevels = true;
            registry.Apply();
            Assert.AreEqual(StationDrawMode.Base, target.LastMode);
            drawer.CollectDrawBuckets();
            Assert.IsTrue(drawer.TryGetBucket(FindBucketIndex(drawer, view.BandTreadMesh, 0), out var restoredSteel));
            Assert.AreSame(baseSteel.Material, restoredSteel.Material, "Base restores exact original steel material");

            // 6. Section clipping propagates _SectionPlane / HasSection into draw buckets when active.
            registry.State.Cutaway = true;
            registry.SectionClipping = true;
            registry.Section = new StationSectionPlane {
                Anchor = new Vector3(0.5f, 4.5f, -2.5f),
                Azimuth = 0f,
                Offset = 0f,
            };
            registry.Apply();
            drawer.CollectDrawBuckets();
            Assert.AreEqual(1, drawer.LastVisibleBandCount, "Straddling band stays visible under section cut");
            Assert.IsTrue(drawer.TryGetBucket(FindBucketIndex(drawer, view.BandTreadMesh, 0), out var sectionSteel));
            if (sectionSteel.Material.HasProperty("_SectionPlane")) {
                Assert.IsTrue(sectionSteel.HasSection, "Section-clipped band propagates section plane to instanced bucket");
            }
            registry.State.Cutaway = false;
            registry.SectionClipping = false;
            registry.Apply();
            drawer.CollectDrawBuckets();
            Assert.IsTrue(drawer.TryGetBucket(FindBucketIndex(drawer, view.BandTreadMesh, 0), out var unclippedSteel));
            Assert.IsFalse(unclippedSteel.HasSection, "Disabling section clipping clears HasSection on instanced bucket");

            // 7. Frustum culling: camera aimed at escalator includes it; camera aimed away culls it.
            var camGo = TrackGo("frustum-camera");
            var cam = camGo.AddComponent<Camera>();
            cam.fieldOfView = 60f;
            cam.aspect = 16f / 9f;
            cam.nearClipPlane = 0.5f;
            cam.farClipPlane = 100f;
            camGo.transform.position = new Vector3(0.5f, 5f, -12f);
            camGo.transform.LookAt(view.WorldBounds.center);

            drawer.CollectDrawBuckets(cam);
            Assert.AreEqual(1, drawer.LastVisibleBandCount, "camera facing escalator includes band");
            Assert.AreEqual(0, drawer.LastCulledBandCount);
            Assert.Greater(drawer.LastTreadInstanceCount, 10);

            camGo.transform.LookAt(new Vector3(0.5f, 5f, -50f));
            drawer.CollectDrawBuckets(cam);
            Assert.AreEqual(0, drawer.LastVisibleBandCount, "camera facing away frustum-culls band");
            Assert.AreEqual(1, drawer.LastCulledBandCount);
            Assert.AreEqual(0, drawer.LastTreadInstanceCount);

            // 8. Dispose unregisters band cleanly; OnDestroy clears drawer cleanly.
            Assert.AreEqual(1, drawer.RegisteredBandCount);
            view.Dispose();
            Assert.AreEqual(0, drawer.RegisteredBandCount, "VerticalModuleView.Dispose must unregister from drawer");
            drawer.CollectDrawBuckets();
            Assert.AreEqual(0, drawer.ActiveBucketCount);

            var secondView = BuildBandView(EscalatorJson("esc-teardown", 15, 0, 0, 0, 9, 5), parent.transform);
            var drawer2Go = TrackGo("ephemeral-drawer");
            var drawer2 = EscalatorStepInstancedDrawer.EnsureFor(drawer2Go.transform);
            drawer2.Register(secondView);
            Assert.AreEqual(1, drawer2.RegisteredBandCount);
            UnityEngine.Object.DestroyImmediate(drawer2Go);
            Assert.AreEqual(0, drawer2.RegisteredBandCount, "OnDestroy must clear registered bands");
        }

        [Test]
        public void VerticalModuleRendererSharesMeshesBatchesAcrossEscalatorsAndChunksOver1023Instances() {
            const int escalatorCount = 45;
            var modules = new JArray();
            for (int i = 0; i < escalatorCount; i++) {
                modules.Add(EscalatorJson("esc-" + i, i * 3, 0, -5, 0, 9, 5, i % 2 == 0 ? "up" : "down", width: 1));
            }
            var save = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "Escalator Instancing Stress",
                ["nameEn"] = "",
                ["city"] = "guangzhou",
                ["seed"] = 7,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = new JArray(),
                    ["modules"] = modules,
                    ["lines"] = new JArray(),
                },
            };

            var read = StationDocumentReader.Read(save.ToString(Formatting.None), StationSource.None);
            Assert.IsNotNull(read?.Document);

            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            var root = TrackGo("world-instancing-stress");
            var renderer = new VerticalModuleRenderer();
            var world = new StationWorldView(root.transform, "esc-stress", new IStationViewRenderer[] { renderer },
                new StationViewAssets { Catalogue = catalogue, Shader = LitShader() });
            worlds.Add(world);
            world.Build(read.Document, read.Index);
            world.Activate();

            var drawer = renderer.ActiveDrawer;
            Assert.IsNotNull(drawer, "VerticalModuleRenderer must attach EscalatorStepInstancedDrawer");
            Assert.AreEqual(escalatorCount, drawer.RegisteredBandCount, "all 45 escalators registered");
            Assert.AreEqual(escalatorCount, renderer.Views.Count);

            // Pooled meshes: every canonical escalator shares the exact same tread and riser Mesh instance.
            var firstTreadMesh = renderer.Views[0].BandTreadMesh;
            var firstRiserMesh = renderer.Views[0].BandRiserMesh;
            Assert.IsNotNull(firstTreadMesh);
            Assert.IsNotNull(firstRiserMesh);
            for (int i = 1; i < renderer.Views.Count; i++) {
                Assert.AreSame(firstTreadMesh, renderer.Views[i].BandTreadMesh, "tread mesh shared across escalators");
                Assert.AreSame(firstRiserMesh, renderer.Views[i].BandRiserMesh, "riser mesh shared across escalators");
            }

            // Zero per-step MeshRenderers anywhere under vertical role root.
            var roleRoot = world.RoleRoot(VerticalModuleRenderer.RoleName);
            foreach (var mr in roleRoot.GetComponentsInChildren<MeshRenderer>(true)) {
                Assert.IsFalse(mr.name.StartsWith("tread-", StringComparison.Ordinal), "no per-tread MeshRenderer: " + mr.name);
                Assert.IsFalse(mr.name.StartsWith("riser-", StringComparison.Ordinal), "no per-riser MeshRenderer: " + mr.name);
            }

            // Advance clock and verify all 45 escalators collapse into 3 buckets exceeding 1023 instances.
            Assert.AreEqual(escalatorCount, renderer.ApplyAll(10.0, running: true, bandsOnly: true));
            drawer.CollectDrawBuckets();
            Assert.AreEqual(escalatorCount, drawer.LastVisibleBandCount);
            Assert.AreEqual(3, drawer.ActiveBucketCount, "all 45 escalators batch into 3 buckets (tread steel, tread warm, riser steel)");
            Assert.Greater(drawer.LastTreadInstanceCount, EscalatorStepInstancedDrawer.MaxInstancesPerDraw,
                "45 escalators produce >1023 visible treads, exercising 1023-matrix chunking");

            int steelIdx = FindBucketIndex(drawer, firstTreadMesh, 0);
            Assert.IsTrue(drawer.TryGetBucket(steelIdx, out var steelBucket));
            Assert.AreEqual(drawer.LastTreadInstanceCount, steelBucket.Count);
            var copied = new Matrix4x4[steelBucket.Count];
            Assert.AreEqual(steelBucket.Count, drawer.CopyBucketMatrices(steelIdx, copied));

            // Disposing the world and releasing the renderer clears all registered bands cleanly.
            world.Dispose();
            renderer.Release();
            Assert.AreEqual(0, drawer.RegisteredBandCount, "releasing disposed world unregisters all bands");
        }
    }
}
