using System;
using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.EditModeTests {
    /// <summary>
    /// Deterministic EditMode regression coverage for Workstream D static scene batching:
    /// multi-LOD prefab combining, GPU-instanced frustum culling, lowered equipment threshold
    /// &amp; singleton compaction, static opaque PSD merging, opening subtree compaction, and
    /// instanced `psd-end:cover` batching.
    /// </summary>
    public sealed class StationPerfStaticBatchingTests {
        readonly List<UnityEngine.Object> ownedObjects = new List<UnityEngine.Object>();
        readonly List<IDisposable> ownedDisposables = new List<IDisposable>();
        readonly List<OpeningPalette> ownedPalettes = new List<OpeningPalette>();

        [TearDown]
        public void TearDown() {
            StationScenePicker.Reset();
            for (int i = ownedDisposables.Count - 1; i >= 0; i--) ownedDisposables[i]?.Dispose();
            ownedDisposables.Clear();
            for (int i = ownedPalettes.Count - 1; i >= 0; i--) ownedPalettes[i]?.Release();
            ownedPalettes.Clear();
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

        OpeningPalette TrackPalette(OpeningPalette palette) {
            if (palette != null) ownedPalettes.Add(palette);
            return palette;
        }

        static Shader FindShader() =>
            Shader.Find("Universal Render Pipeline/Lit")
            ?? Shader.Find("Universal Render Pipeline/Unlit")
            ?? Shader.Find("Sprites/Default")
            ?? Shader.Find("Hidden/InternalErrorShader");

        static Material CreateMaterial(string name) =>
            new Material(FindShader()) { name = name };

        static Mesh CreateUnitBoxMesh(string name) {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var clone = UnityEngine.Object.Instantiate(go.GetComponent<MeshFilter>().sharedMesh);
            clone.name = name;
            UnityEngine.Object.DestroyImmediate(go);
            return clone;
        }

        static Mesh CreateThreeTierCylinderMesh(string name, Material mat) {
            var tmp = new GameObject("tmp-3lod-cyl");
            var meshes = new List<Mesh>();
            try {
                var parts = new StructureParts();
                parts.Cylinder(mat, Vector3.zero, 0.5f, 2f, 32);
                parts.Emit(tmp.transform, meshes, name);
                return meshes[0];
            } finally {
                UnityEngine.Object.DestroyImmediate(tmp);
            }
        }

        static StationDocument ParseDocument(JArray modules, string name = "perf-static-batching") {
            var save = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = name,
                ["city"] = "guangzhou",
                ["seed"] = 1,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = new JArray(),
                    ["modules"] = modules ?? new JArray(),
                    ["lines"] = new JArray(),
                },
            };
            var read = StationDocumentReader.Read(save.ToString(Newtonsoft.Json.Formatting.None), new StationSource(name, ""));
            Assert.IsNotNull(read?.Document, "Failed to parse synthetic document: " + name);
            return read.Document;
        }

        /* ==================================== 1. MULTI-LOD PREFAB COMBINING */

        [Test]
        public void PrefabMeshTemplateCombinesSameMaterialMultiLodAndMixedLodMeshesPreservingTiersAndBounds() {
            var matA = Track(CreateMaterial("MultiLodMatA"));
            var matB = Track(CreateMaterial("MultiLodMatB"));
            matA.enableInstancing = false;
            matB.enableInstancing = false;

            var cyl3Lod = Track(CreateThreeTierCylinderMesh("Cyl3Lod", matA));
            Assert.AreEqual(3, cyl3Lod.lodCount, "Source cylinder must carry 3 LOD tiers");
            uint cylLod0 = cyl3Lod.GetIndexCount(0, 0);
            uint cylLod1 = cyl3Lod.GetIndexCount(0, 1);
            uint cylLod2 = cyl3Lod.GetIndexCount(0, 2);
            Assert.Less(cylLod2, cylLod1);
            Assert.Less(cylLod1, cylLod0);

            var box1Lod = Track(CreateUnitBoxMesh("Box1Lod"));
            uint boxLod0 = box1Lod.GetIndexCount(0);

            var prefab = Track(new GameObject("SyntheticMultiLodPrefab"));
            void AddChild(string childName, Vector3 pos, Vector3 scale, Mesh mesh, Material mat, ShadowCastingMode shadow) {
                var child = new GameObject(childName, typeof(MeshFilter), typeof(MeshRenderer));
                child.transform.SetParent(prefab.transform, false);
                child.transform.localPosition = pos;
                child.transform.localScale = scale;
                child.GetComponent<MeshFilter>().sharedMesh = mesh;
                var mr = child.GetComponent<MeshRenderer>();
                mr.sharedMaterial = mat;
                mr.shadowCastingMode = shadow;
            }

            // Three parts sharing (matA, On): two 3-LOD cylinders (one mirrored in X) + one 1-LOD box.
            AddChild("cyl-a", new Vector3(0f, 0f, 0f), Vector3.one, cyl3Lod, matA, ShadowCastingMode.On);
            AddChild("cyl-b-mirror", new Vector3(4f, 0f, 0f), new Vector3(-1f, 1f, 1f), cyl3Lod, matA, ShadowCastingMode.On);
            AddChild("box-c", new Vector3(2f, 3f, 0f), Vector3.one, box1Lod, matA, ShadowCastingMode.On);
            // Distinct material (matB, On) stays its own 3-LOD bucket.
            AddChild("cyl-matB", new Vector3(0f, 0f, 5f), Vector3.one, cyl3Lod, matB, ShadowCastingMode.On);
            // Distinct shadow mode (matA, Off) stays its own 3-LOD bucket.
            AddChild("cyl-noShadow", new Vector3(-3f, 0f, 0f), Vector3.one, cyl3Lod, matA, ShadowCastingMode.Off);

            var cache = new StationPrefabTemplateCache();
            Mesh mergedMesh = null;
            GameObject compactedInstance = null;
            try {
                Assert.IsTrue(cache.TryGetTemplate(prefab, out var template));
                Assert.AreEqual(3, template.Parts.Length,
                    "3 same-(matA,On) children (2x 3-LOD + 1x 1-LOD) merge into 1 bucket, leaving 3 parts total");

                var mergedPart = template.Parts[0];
                mergedMesh = mergedPart.Mesh;
                Assert.AreNotSame(cyl3Lod, mergedMesh);
                Assert.AreEqual(3, mergedMesh.lodCount, "Combined mesh preserves 3 LOD tiers");
                Assert.AreEqual(cylLod0 * 2 + boxLod0, mergedMesh.GetIndexCount(0, 0), "LOD0 index sum matches");
                Assert.AreEqual(cylLod1 * 2 + boxLod0, mergedMesh.GetIndexCount(0, 1), "LOD1 reduces multi-LOD parts and retains 1-LOD part");
                Assert.AreEqual(cylLod2 * 2 + boxLod0, mergedMesh.GetIndexCount(0, 2), "LOD2 reduces further");
                Assert.Less(mergedMesh.GetIndexCount(0, 2), mergedMesh.GetIndexCount(0, 1));
                Assert.Less(mergedMesh.GetIndexCount(0, 1), mergedMesh.GetIndexCount(0, 0));

                // Bounds encapsulate all 5 children.
                Assert.IsTrue(template.HasBounds);
                Assert.LessOrEqual(template.LocalBounds.min.x, -3.49f);
                Assert.GreaterOrEqual(template.LocalBounds.max.x, 4.49f);
                Assert.GreaterOrEqual(template.LocalBounds.max.y, 3.49f);
                Assert.GreaterOrEqual(template.LocalBounds.max.z, 5.49f);

                // Unbatched compacted instantiation reduces 5 renderers -> 3 while preserving source materials & LODs.
                var parent = Track(new GameObject("CompactedHost"));
                Assert.IsTrue(template.TryInstantiateCompacted(parent.transform, "compacted", Vector3.zero, Quaternion.identity, out compactedInstance));
                var renderers = compactedInstance.GetComponentsInChildren<MeshRenderer>(true);
                Assert.AreEqual(3, renderers.Length, "Compacted instance emits 3 MeshRenderers instead of 5");
                Assert.IsFalse(matA.enableInstancing, "Source material must remain unmutated");
            } finally {
                if (compactedInstance != null) UnityEngine.Object.DestroyImmediate(compactedInstance);
                cache.Dispose();
            }

            Assert.IsTrue(mergedMesh == null, "Template cache Dispose destroys owned merged multi-LOD meshes");
            Assert.IsTrue(cyl3Lod != null && box1Lod != null, "Dispose must not destroy source meshes");
        }

        /* ======================== 2. INSTANCED DRAWER FRUSTUM CULLING */

        [Test]
        public void InstancedSurfaceDrawerFrustumCullsOffScreenBatchesAndHandlesOffsetAndNullCamera() {
            var mat = Track(CreateMaterial("FrustumBatchMat"));
            var box = Track(CreateUnitBoxMesh("FrustumBox"));
            var root = Track(new GameObject("FrustumDrawerRoot"));
            var drawer = StationInstancedSurfaceDrawer.EnsureFor(root.transform);

            var camGo = Track(new GameObject("FrustumTestCamera"));
            var cam = camGo.AddComponent<Camera>();
            cam.enabled = false;
            cam.orthographic = false;
            cam.fieldOfView = 60f;
            cam.aspect = 16f / 9f;
            cam.nearClipPlane = 0.5f;
            cam.farClipPlane = 50f;
            cam.transform.position = new Vector3(0f, 2f, -10f);
            cam.transform.rotation = Quaternion.identity; // looking +Z

            StationInstancedSurfaceBatch MakeBatch(string name, Vector3 worldPos, bool followOffset) {
                var go = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
                go.transform.SetParent(root.transform, false);
                var mr = go.GetComponent<MeshRenderer>();
                mr.sharedMaterial = mat;
                var batch = go.AddComponent<StationInstancedSurfaceBatch>();
                if (followOffset) {
                    go.transform.position = worldPos;
                    batch.ConfigureMatrices(box, 0, mr, new List<Matrix4x4> { Matrix4x4.identity }, followTransformOffset: true);
                } else {
                    var combines = new List<CombineInstance> {
                        new CombineInstance { mesh = box, subMeshIndex = 0, transform = Matrix4x4.Translate(worldPos) },
                    };
                    batch.Configure(box, 0, mr, new Bounds(worldPos, Vector3.one), combines, 1, new List<int> { 0 });
                }
                drawer.Add(batch);
                return batch;
            }

            var inFront = MakeBatch("in-front", new Vector3(0f, 2f, 5f), followOffset: false);
            var behind = MakeBatch("behind", new Vector3(0f, 2f, -30f), followOffset: false);
            var farRight = MakeBatch("far-right", new Vector3(200f, 2f, 5f), followOffset: false);
            var offsetBatch = MakeBatch("offset-follow", new Vector3(0f, 2f, 10f), followOffset: true);

            // ConfigureMatrices must populate WorldBounds automatically for exploded-view offset batches.
            Assert.Greater(offsetBatch.WorldBounds.size.sqrMagnitude, 0.5f,
                "ConfigureMatrices must compute non-empty WorldBounds");

            // Pure-C# frustum test agrees with Unity's GeometryUtility.TestPlanesAABB.
            var planes = GeometryUtility.CalculateFrustumPlanes(cam);
            Assert.IsTrue(StationInstancedSurfaceDrawer.IntersectsFrustum(planes, inFront.WorldBounds, 0f));
            Assert.IsTrue(GeometryUtility.TestPlanesAABB(planes, inFront.WorldBounds));
            Assert.IsFalse(StationInstancedSurfaceDrawer.IntersectsFrustum(planes, behind.WorldBounds, 0f));
            Assert.IsFalse(GeometryUtility.TestPlanesAABB(planes, behind.WorldBounds));
            Assert.IsFalse(StationInstancedSurfaceDrawer.IntersectsFrustum(planes, farRight.WorldBounds, 0f));
            Assert.IsFalse(GeometryUtility.TestPlanesAABB(planes, farRight.WorldBounds));

            // Submit with camera: inFront + offsetBatch survive; behind + farRight are culled.
            drawer.SubmitNow(cam);
            Assert.AreEqual(2, drawer.LastSubmittedBatches, "Only the 2 in-frustum batches should submit");
            Assert.AreEqual(2, drawer.LastFrustumCulledBatches, "Both off-frustum batches should be culled");

            // Translating the FollowTransformOffset batch behind the camera culls it too.
            offsetBatch.transform.position = new Vector3(0f, 2f, -40f);
            drawer.SubmitNow(cam);
            Assert.AreEqual(1, drawer.LastSubmittedBatches);
            Assert.AreEqual(3, drawer.LastFrustumCulledBatches);

            // Null-camera fallback (when no active camera exists): never frustum-culls.
            var disabledCams = new List<Camera>();
            foreach (var existing in UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsInactive.Exclude)) {
                if (existing != null && existing.CompareTag("MainCamera") && existing.enabled) {
                    existing.enabled = false;
                    disabledCams.Add(existing);
                }
            }
            try {
                drawer.SubmitNow(null);
                Assert.AreEqual(0, drawer.LastFrustumCulledBatches, "Null camera must not frustum-cull");
                Assert.AreEqual(4, drawer.LastSubmittedBatches, "All 4 active batches submit when camera is null");
            } finally {
                for (int i = 0; i < disabledCams.Count; i++) disabledCams[i].enabled = true;
            }
        }

        /* ==================== 3. EQUIPMENT THRESHOLD 3 & SINGLETON COMPACT */

        [Test]
        public void EquipmentRendererBatchesAtThresholdThreeAndCompactsUnbatchedIndividuals() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "RuntimeCatalogue asset must exist");
            Assert.IsTrue(catalogue.TryGet("bin", out var binEntry) && binEntry.prefab != null);
            int rawBinRenderers = binEntry.prefab.GetComponentsInChildren<MeshRenderer>(true).Count(r => r != null && r.enabled);

            var mods = new JArray {
                // 3 extinguishers on band -5 -> GPU-instanced with EquipBatchThreshold = 3.
                new JObject { ["id"] = "ext-0", ["type"] = "extinguisher", ["x"] = 0, ["y"] = 0, ["z"] = -5 },
                new JObject { ["id"] = "ext-1", ["type"] = "extinguisher", ["x"] = 2, ["y"] = 0, ["z"] = -5 },
                new JObject { ["id"] = "ext-2", ["type"] = "extinguisher", ["x"] = 4, ["y"] = 0, ["z"] = -5 },
                // 2 bins on band -5 -> below threshold 3, stays individual ModuleId records & compacted.
                new JObject { ["id"] = "bin-0", ["type"] = "bin", ["x"] = 10, ["y"] = 0, ["z"] = -5 },
                new JObject { ["id"] = "bin-1", ["type"] = "bin", ["x"] = 12, ["y"] = 0, ["z"] = -5 },
            };
            var doc = ParseDocument(mods, "equip-threshold-3");
            var idx = new StationIndex(doc);
            var root = Track(new GameObject("EquipThreshold3Root"));
            var renderer = new StationEquipmentModuleRenderer();
            var world = TrackDisposable(new StationWorldView(
                root.transform, "EquipThreshold3", new IStationViewRenderer[] { renderer },
                new StationViewAssets { Catalogue = catalogue, Shader = FindShader() }));
            world.Build(doc, idx);

            Assert.AreEqual(5, renderer.BuiltCount);
            bool foundBatchedExt = world.Records.Any(r =>
                r.Role == StationModuleClaims.Equipment &&
                r.SourceIds != null && r.SourceIds.Contains("ext-0") && r.SourceIds.Contains("ext-2") &&
                r.View != null && r.View.GetComponent<StationInstancedSurfaceBatch>() != null);
            Assert.IsTrue(foundBatchedExt, "3 extinguishers on one storey band must batch via StationInstancedSurfaceBatch");

            Assert.IsTrue(world.TryGetModule("bin-0", out var bin0), "2 bins stay individual ModuleId records");
            Assert.IsTrue(world.TryGetModule("bin-1", out var bin1));
            int compactedBinRenderers = bin0.View.GetComponentsInChildren<MeshRenderer>(true).Length;
            Assert.Greater(compactedBinRenderers, 0);
            Assert.Less(compactedBinRenderers, rawBinRenderers,
                $"Unbatched bin should compact child MeshRenderers ({compactedBinRenderers} < {rawBinRenderers})");
            Assert.IsNotNull(bin1.View);
        }

        /* ============ 4. PSD STATIC OPAQUE MERGING & OPENING SUBTREE COMPACT */

        [Test]
        public void OpeningBuilderMergesStaticOpaquePartsPreservingPerPartBoundsAndConcreteFinish() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue);
            var shader = FindShader();
            var concreteMat = Track(new Material(shader) { name = "finish floor.concrete" });
            var palette = TrackPalette(new OpeningPalette(shader, concreteMat, OpeningPalette.FoundationFinishId));
            var root = Track(new GameObject("PsdStaticMergeRoot"));

            var facts = new ModuleFacts { Id = "edge-merge", Type = "platform-edge", X = 0, Y = 0, Z = -10, Width = 24, Depth = 1 };
            var request = new OpeningModuleViews.OpeningRequest {
                ModuleId = "edge-merge", Type = "platform-edge", X = 0, Y = 0, Z = -10, Width = 24, Depth = 1,
                Side = "left", Psd = "full", StoreyHeight = 5, Dir = "up",
                LineId = "5", LineColour = "#c70541", HasLine = true, Stock = "B", Cars = 2, ModelScale = 1f,
                StationName = "Fixture", StationNameEn = "Fixture", UpTerminus = "Far", UpNextStation = "Near",
            };

            Assert.IsTrue(OpeningModuleViews.TryBuild(request, facts, new[] { facts }, catalogue, root.transform, palette, out var view),
                view.Diagnostic);

            // All 5 static Black parts share one merged MeshRenderer under the run holder.
            var threshold = view.Part("psd-threshold");
            var fasciaCap = view.Part("psd-fascia-cap");
            var fixedRail = view.Part("psd-fixed-rail");
            var fixedPost = view.Part("psd-fixed-post");
            var pillar = view.Part("psd-section-pillar");
            Assert.IsNotNull(threshold);
            Assert.IsNotNull(fasciaCap);
            Assert.IsNotNull(fixedRail);
            Assert.IsNotNull(fixedPost);
            Assert.IsNotNull(pillar);
            Assert.AreSame(threshold.Node, fasciaCap.Node, "Static Black PSD parts must share one merged renderer");
            Assert.AreSame(threshold.Node, fixedRail.Node);
            Assert.AreSame(threshold.Node, fixedPost.Node);
            Assert.AreSame(threshold.Node, pillar.Node);

            // Individual logical OpeningPart bounds remain exact despite sharing one combined mesh.
            Assert.AreEqual(0.02f, threshold.Local.size.y, 1e-3f, "psd-threshold retains exact 0.02 m height");
            Assert.AreEqual(0.98f, threshold.Local.min.y, 1e-3f);
            Assert.AreEqual(1.0f, threshold.Local.max.y, 1e-3f);
            Assert.AreEqual(0.05f, fasciaCap.Local.size.y, 1e-3f, "psd-fascia-cap retains exact 0.05 m height");

            // Concrete foundation keeps its own renderer and handed-in floor.concrete material.
            var foundation = view.Part("psd-concrete-foundation");
            Assert.IsNotNull(foundation);
            Assert.AreEqual(OpeningPalette.FoundationFinishId, foundation.Material);
            Assert.AreEqual(0.98f, foundation.Local.size.y, 1e-3f);
            Assert.AreNotSame(threshold.Node, foundation.Node);
            var foundationMr = foundation.Node.GetComponentInChildren<MeshRenderer>(true);
            Assert.IsNotNull(foundationMr);
            Assert.AreSame(concreteMat, foundationMr.sharedMaterial);

            // Fixed glazing stays separate from opaque parts.
            var fixedGlass = view.Part("psd-fixed-glass");
            Assert.IsNotNull(fixedGlass);
            Assert.AreNotSame(threshold.Node, fixedGlass.Node);
            Assert.AreSame(palette[OpeningColour.Glass], fixedGlass.Node.GetComponentInChildren<MeshRenderer>(true).sharedMaterial);
        }

        [Test]
        public void OpeningSubtreeCompactionReducesGateDoorAndCubicleRenderersWhilePreservingMotion() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue);
            var palette = TrackPalette(new OpeningPalette(FindShader()));
            var root = Track(new GameObject("OpeningCompactRoot"));

            int RawRendererCount(string key) {
                Assert.IsTrue(catalogue.TryGet(key, out var entry) && entry.prefab != null, "Missing prefab: " + key);
                return entry.prefab.GetComponentsInChildren<MeshRenderer>(true).Count(r => r != null && r.enabled);
            }

            // 1. Gate: compacts static cabinet while keeping wing, gate-body, and indicator renderers.
            var gateFacts = new ModuleFacts {
                Id = "gate-c", Type = "gate", X = 0, Y = 0, Z = -5, Width = 1, Depth = 1,
                Config = new ModuleConfig(new Dictionary<string, string> { ["door"] = "wing", ["dir"] = "in" }),
            };
            var gateReq = new OpeningModuleViews.OpeningRequest {
                ModuleId = "gate-c", Type = "gate", X = 0, Y = 0, Z = -5, Width = 1, Depth = 1, Door = "wing", Dir = "in",
            };
            Assert.IsTrue(OpeningModuleViews.TryBuild(gateReq, gateFacts, new[] { gateFacts }, catalogue, root.transform, palette, out var gateView),
                gateView.Diagnostic);
            int gateRaw = RawRendererCount(gateView.ViewKey);
            int gateBuilt = gateView.Instance.GetComponentsInChildren<MeshRenderer>(true).Count(r => r != null && r.enabled);
            Assert.Less(gateBuilt, gateRaw, $"Compacted gate should reduce renderers ({gateBuilt} < {gateRaw})");
            Assert.IsNotNull(gateView.Instance.GetComponentsInChildren<Transform>(true).FirstOrDefault(t => t.name == "gate-body"));
            Assert.AreEqual(1, gateView.Instance.GetComponentsInChildren<MeshRenderer>(true).Count(r => r.enabled && r.gameObject.name == "entry-arrow"));
            Assert.AreEqual(1, gateView.Instance.GetComponentsInChildren<MeshRenderer>(true).Count(r => r.enabled && r.gameObject.name == "no-entry-cross"));
            float shutX = gateView.Leaves[0].Node.localPosition.x;
            gateView.Apply(OpeningState.Uniform(1f));
            Assert.AreNotEqual(shutX, gateView.Leaves[0].Node.localPosition.x, "Gate wings still animate after compaction");

            // 2. Door: compacts static frame and swing leaf while keeping Approach and 81-deg swing.
            var doorFacts = new ModuleFacts {
                Id = "door-c", Type = "door", X = 2, Y = 0, Z = -5, Width = 1, Depth = 1,
                Config = new ModuleConfig(new Dictionary<string, string> { ["variant"] = "steel-1" }),
            };
            var doorReq = new OpeningModuleViews.OpeningRequest {
                ModuleId = "door-c", Type = "door", X = 2, Y = 0, Z = -5, Width = 1, Depth = 1, Variant = "steel-1",
            };
            Assert.IsTrue(OpeningModuleViews.TryBuild(doorReq, doorFacts, new[] { doorFacts }, catalogue, root.transform, palette, out var doorView),
                doorView.Diagnostic);
            int doorRaw = RawRendererCount(doorView.ViewKey);
            int doorBuilt = doorView.Instance.GetComponentsInChildren<MeshRenderer>(true).Count(r => r != null && r.enabled);
            Assert.Less(doorBuilt, doorRaw, $"Compacted door should reduce renderers ({doorBuilt} < {doorRaw})");
            Assert.IsNotNull(doorView.Instance.GetComponentsInChildren<Transform>(true).FirstOrDefault(t => t.name == "Approach"));
            doorView.Apply(OpeningState.Uniform(1f));
            Assert.AreEqual(81f, Quaternion.Angle(Quaternion.identity, doorView.Leaves[0].Node.localRotation), 0.1f);

            // 3. Cubicle: compacts 28-renderer prefab while keeping 3-LOD meshes and 81-deg swing.
            var cubFacts = new ModuleFacts {
                Id = "cub-c", Type = "cubicle", X = 4, Y = 0, Z = -5, Width = 1, Depth = 1, Config = ModuleConfig.Empty,
            };
            var cubReq = new OpeningModuleViews.OpeningRequest {
                ModuleId = "cub-c", Type = "cubicle", X = 4, Y = 0, Z = -5, Width = 1, Depth = 1,
            };
            Assert.IsTrue(OpeningModuleViews.TryBuild(cubReq, cubFacts, new[] { cubFacts }, catalogue, root.transform, palette, out var cubView),
                cubView.Diagnostic);
            int cubRaw = RawRendererCount(cubView.ViewKey);
            int cubBuilt = cubView.Instance.GetComponentsInChildren<MeshRenderer>(true).Count(r => r != null && r.enabled);
            Assert.Less(cubBuilt, cubRaw, $"Compacted cubicle should reduce renderers ({cubBuilt} < {cubRaw})");
            cubView.Apply(OpeningState.Uniform(1f));
            Assert.AreEqual(81f, Quaternion.Angle(Quaternion.identity, cubView.Leaves[0].Node.localRotation), 0.1f);
        }

        /* ================= 5. PSD-END COVER INSTANCING & VISIBILITY LIFECYCLE */

        [Test]
        public void OpeningRendererBatchesRepeatedPsdCoversPreservingBoundsVisibilityAndCleanRebuild() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue);
            var shader = FindShader();

            const int canonicalCount = 140; // > DefaultPsdCoverBatchThreshold (128)
            var mods = new JArray();
            for (int i = 0; i < canonicalCount; i++) {
                mods.Add(new JObject {
                    ["id"] = "cover-" + i,
                    ["type"] = "psd-end",
                    ["x"] = i,
                    ["y"] = 0,
                    ["z"] = -10,
                    ["rot"] = 0,
                    ["w"] = 1,
                    ["d"] = 1,
                    ["cfg"] = new JObject { ["variant"] = "cover", ["side"] = "left", ["psd"] = "full" },
                });
            }
            mods.Add(new JObject {
                ["id"] = "cover-trim-0", ["type"] = "psd-end", ["x"] = 200, ["y"] = 0, ["z"] = -10, ["rot"] = 0, ["w"] = 1, ["d"] = 1,
                ["cfg"] = new JObject { ["variant"] = "cover", ["side"] = "left", ["psd"] = "full", ["width"] = 0.72, ["depth"] = 0.12 },
            });
            mods.Add(new JObject {
                ["id"] = "end-full-0", ["type"] = "psd-end", ["x"] = 202, ["y"] = 0, ["z"] = -10, ["rot"] = 0, ["w"] = 1, ["d"] = 1,
                ["cfg"] = new JObject { ["side"] = "left", ["psd"] = "full" },
            });

            var doc = ParseDocument(mods, "psd-cover-batch");
            var idx = new StationIndex(doc);
            var root = Track(new GameObject("CoverBatchWorldRoot"));
            var renderer = new OpeningModuleRenderer();
            var visibility = TrackDisposable(new StationVisibilityRegistry(shader));

            var world1 = new StationWorldView(
                root.transform, "CoverBatch1", new IStationViewRenderer[] { renderer },
                new StationViewAssets { Catalogue = catalogue, Shader = shader });
            world1.Build(doc, idx);

            Assert.AreEqual(canonicalCount + 2, renderer.Views.Count, "Every cover and end remains in OpeningModuleSet");
            Assert.Greater(renderer.BatchedCoverChunkCount, 0, "140 canonical covers must batch into instanced chunks");
            Assert.LessOrEqual(renderer.BatchedCoverChunkCount, 4, "140 covers across x=0..139 fit into 3x 64m chunks");

            var roleRoot = world1.RoleRoot(OpeningModuleRenderer.RoleName);
            int totalRenderers = roleRoot.GetComponentsInChildren<MeshRenderer>(true).Length;
            Assert.Less(totalRenderers, 20, $"140 batched covers + 1 trimmed cover + 1 end should emit <20 MeshRenderers, got {totalRenderers}");

            // Batched cover metadata preserves OpeningPart bounds and view key.
            Assert.IsTrue(renderer.Views.TryGet("cover-10", out var coverView));
            Assert.AreEqual(OpeningKind.PsdCover, coverView.Kind);
            Assert.AreEqual(OpeningModuleViews.PsdCoverPrefabKey, coverView.ViewKey);
            var coverPart = coverView.Part("psd-cover-panel");
            Assert.IsNotNull(coverPart);
            Assert.AreEqual(1f, coverPart.Local.size.x, 0.02f);
            Assert.AreEqual(0.24f, coverPart.Local.size.z, 0.02f);
            Assert.AreEqual(-10f, coverPart.Document.min.z, 0.02f);
            Assert.AreEqual(-9f, coverPart.Document.max.z, 0.02f);

            // Trimmed cover and full end stay unbatched individual records.
            Assert.IsTrue(world1.TryGetModule("cover-trim-0", out _));
            Assert.IsTrue(world1.TryGetModule("end-full-0", out _));

            // Visibility registry transitions Base -> Ghost -> Hidden cleanly on batched cover proxy renderers.
            var batches = roleRoot.GetComponentsInChildren<StationInstancedSurfaceBatch>(true);
            Assert.Greater(batches.Length, 0);
            var byId = doc.Modules.ToDictionary(m => m.Id, StringComparer.Ordinal);
            var grid = StationLevelGrid.FromDocument(doc.LevelBase, doc.StoreyHeight);
            foreach (var rec in world1.Records) {
                visibility.Register(rec.View.transform, StationViewFeature.RoleOf(rec, byId),
                    StationViewFeature.LevelsOf(rec, byId, grid));
            }
            visibility.State.ShowLevels = true;
            visibility.State.ActiveLevel = -10;
            visibility.Apply();
            Assert.IsTrue(batches.All(b => b.ProxyRenderer.enabled), "Active storey enables cover batches");

            visibility.State.ActiveLevel = 0;
            visibility.State.ShowLevels = true;
            visibility.Apply();
            Assert.IsTrue(batches.All(b => b.ProxyRenderer.enabled), "ShowLevels=true keeps lower storey cover batches ghosted & enabled");

            visibility.State.ShowLevels = false;
            visibility.Apply();
            Assert.IsTrue(batches.All(b => !b.ProxyRenderer.enabled), "ShowLevels=false hides non-active cover batches");

            // Dispose & rebuild cleanly with zero stale batches on drawer.
            var drawer = world1.Root.GetComponent<StationInstancedSurfaceDrawer>();
            Assert.IsNotNull(drawer);
            Assert.AreEqual(batches.Length, drawer.BatchCount);
            world1.Dispose();
            Assert.AreEqual(0, renderer.Views.Count);
            Assert.AreEqual(0, renderer.BatchedCoverChunkCount);

            var world2 = TrackDisposable(new StationWorldView(
                root.transform, "CoverBatch2", new IStationViewRenderer[] { renderer },
                new StationViewAssets { Catalogue = catalogue, Shader = shader }));
            world2.Build(doc, idx);
            Assert.AreEqual(canonicalCount + 2, renderer.Views.Count, "Rebuild after teardown restores all views cleanly");
            Assert.Greater(renderer.BatchedCoverChunkCount, 0);
        }
    }
}
