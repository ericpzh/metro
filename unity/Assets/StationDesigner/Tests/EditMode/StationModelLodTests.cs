using System.Collections.Generic;
using System.Reflection;
using Metro.App;
using Metro.App.Views;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.Tests {
    public sealed class StationModelLodTests {
        [Test]
        public void RigidCatalogueLodsRetainTheirOriginalMeshes() {
            const string folder = "Assets/StationDesigner/Resources/ModelLods/Rigid";
            var libraries = AssetDatabase.FindAssets("t:StationRigidModelLods", new[] { folder });
            Assert.That(libraries.Length, Is.GreaterThanOrEqualTo(236));
            foreach (string guid in libraries) {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var library = AssetDatabase.LoadAssetAtPath<Metro.App.StationRigidModelLods>(path);
                Assert.That(library.Meshes, Is.Not.Empty, path);
                foreach (var entry in library.Meshes) {
                    Assert.That(entry.Source, Is.Not.Null, path);
                    if (entry.Baked == null) {
                        Assert.That(entry.ReuseReason, Is.Not.Empty, path);
                        continue;
                    }
                    Assert.That(entry.Baked.lodCount, Is.GreaterThanOrEqualTo(3), path);
                    Assert.That(entry.Baked.vertexCount, Is.EqualTo(entry.Source.vertexCount), path);
                    Assert.That(entry.Baked.subMeshCount, Is.EqualTo(entry.Source.subMeshCount), path);
                    for (int i = 0; i < entry.Source.subMeshCount; i++)
                        Assert.That(entry.Baked.GetIndexCount(i, 0), Is.EqualTo(entry.Source.GetIndexCount(i)), path);
                }
            }
        }

        [Test]
        public void TreePrefabBatchKeepsBothBakedLodMeshes() {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                "Assets/StationDesigner/Generated/Prefabs/Tree.prefab");
            Assert.That(prefab, Is.Not.Null);
            var ownedMeshes = new List<Mesh>();
            try {
                Assert.That(StationPrefabMeshTemplate.TryBuild(prefab, ownedMeshes, out var template), Is.True);
                foreach (var part in template.Parts) {
                    Assert.That(part.Mesh.lodCount, Is.EqualTo(3), part.Mesh.name);
                    Assert.That(part.Mesh.GetIndexCount(part.SubmeshIndex, 2),
                        Is.LessThan(part.Mesh.GetIndexCount(part.SubmeshIndex, 0)), part.Mesh.name);
                }
            } finally {
                foreach (var mesh in ownedMeshes) Object.DestroyImmediate(mesh);
            }
        }

        [Test]
        public void SimpleBenchHasAnExplicitReuseEntryForEveryMesh() {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                "Assets/StationDesigner/Generated/Prefabs/Bench.prefab");
            var library = Resources.Load<Metro.App.StationRigidModelLods>(
                Metro.App.StationRigidModelLods.ResourcesPath + "Bench");
            Assert.That(prefab, Is.Not.Null);
            Assert.That(library, Is.Not.Null);
            var distinct = new HashSet<Mesh>();
            foreach (var filter in prefab.GetComponentsInChildren<MeshFilter>(true))
                if (filter.sharedMesh != null) distinct.Add(filter.sharedMesh);
            Assert.That(distinct.Count, Is.GreaterThan(0));
            Assert.That(library.Meshes.Length, Is.EqualTo(distinct.Count));
            foreach (var entry in library.Meshes) {
                Assert.That(distinct.Remove(entry.Source), Is.True);
                Assert.That(entry.Baked, Is.Null);
            }
        }

        [Test]
        public void GeneratedTrackKeepsRailGeometryAndSimplifiesFasteners() {
            var run = Metro.View.RailRunGeometry.Build(24, 3, 1f, 0, catenary: true);
            var steel = run.Steel.ToMesh("steel");
            var hardware = run.Dark.ToMesh("hardware");
            try {
                Assert.That(steel.lodCount, Is.EqualTo(1));
                Assert.That(hardware.lodCount, Is.EqualTo(3));
                Assert.That(hardware.GetIndexCount(0, 0), Is.EqualTo(run.Dark.Triangles.Count));
                Assert.That(hardware.GetIndexCount(0, -1), Is.EqualTo(hardware.GetIndexCount(0, 0)));
                Assert.That(hardware.GetIndexCount(0, 1), Is.LessThan(hardware.GetIndexCount(0, 0)));
                Assert.That(hardware.GetIndexCount(0, 2), Is.LessThan(hardware.GetIndexCount(0, 1)));
            } finally {
                Object.DestroyImmediate(steel);
                Object.DestroyImmediate(hardware);
            }
        }

        [Test]
        public void RoundPillarTiersUseTheSameVertexPositionsAndClosedCaps() {
            var root = new GameObject("pillar");
            var material = new Material(Shader.Find("Hidden/InternalErrorShader"));
            var meshes = new List<Mesh>();
            try {
                var parts = new StructureParts();
                parts.Cylinder(material, Vector3.zero, 1f, 3f, 32);
                parts.Emit(root.transform, meshes, "pillar");
                var mesh = meshes[0];
                Assert.That(mesh.vertexCount, Is.EqualTo(66));
                Assert.That(mesh.lodCount, Is.EqualTo(3));
                Assert.That(mesh.GetIndexCount(0, 0), Is.EqualTo(384));
                Assert.That(mesh.GetIndexCount(0, 1), Is.EqualTo(192));
                Assert.That(mesh.GetIndexCount(0, 2), Is.EqualTo(96));
            } finally {
                foreach (var mesh in meshes) Object.DestroyImmediate(mesh);
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(material);
            }
        }

        [Test]
        public void TrainCompactionKeepsDoorRigAndDropsOnlyDecorativeFaces() {
            var root = new GameObject("consist");
            var car = new GameObject("Car0-Test");
            car.transform.SetParent(root.transform, false);
            var material = new Material(Shader.Find("Hidden/InternalErrorShader"));
            var source = new Mesh {
                vertices = new[] { Vector3.zero, Vector3.up, Vector3.forward },
                triangles = new[] { 0, 1, 2 },
            };
            var owned = new List<Mesh>();
            try {
                var names = new[] { "shell", "bogie-wheel-face-bolt", "hanging-strap", "seat", "TestDoor00" };
                for (int i = 0; i < names.Length; i++) {
                    var child = new GameObject(names[i], typeof(MeshFilter), typeof(MeshRenderer));
                    child.transform.SetParent(car.transform, false);
                    child.transform.localPosition = new Vector3(i, 0f, 0f);
                    child.GetComponent<MeshFilter>().sharedMesh = source;
                    child.GetComponent<MeshRenderer>().sharedMaterial = material;
                }
                var compact = typeof(TrainConsistViews).GetMethod("CompactConsistInstance",
                    System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
                Assert.That(compact, Is.Not.Null);
                var cache = System.Activator.CreateInstance(compact.GetParameters()[2].ParameterType);
                compact.Invoke(null, new object[] { root, "test", cache, owned, null });
                Assert.That(car.transform.Find("TestDoor00"), Is.Not.Null);
                Assert.That(owned, Has.Count.EqualTo(1));
                var mesh = owned[0];
                Assert.That(mesh.GetIndexCount(0, 0), Is.EqualTo(12));
                Assert.That(mesh.GetIndexCount(0, -1), Is.EqualTo(12));
                Assert.That(mesh.GetIndexCount(0, 1), Is.EqualTo(9));
                Assert.That(mesh.GetIndexCount(0, 2), Is.EqualTo(6));
                var vertices = mesh.vertices;
                var indices = new List<int>();
                mesh.GetTriangles(indices, 0, 2);
                foreach (int index in indices)
                    Assert.That(vertices[index].x == 0f || vertices[index].x == 3f, Is.True);
            } finally {
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(source);
                Object.DestroyImmediate(material);
                foreach (var mesh in owned) Object.DestroyImmediate(mesh);
            }
        }

        [Test]
        public void EveryTrainFormationUsesAtMostHalfItsHighTrianglesAtLow() {
            var catalogue = AssetDatabase.LoadAssetAtPath<Metro.View.TrainCatalogue>(Metro.View.TrainCatalogue.AssetPath);
            Assert.That(catalogue, Is.Not.Null);
            var compact = typeof(TrainConsistViews).GetMethod("CompactConsistInstance",
                System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
            Assert.That(compact, Is.Not.Null);
            var seen = new HashSet<GameObject>();
            foreach (var entry in catalogue.Entries) {
                Assert.That(entry.prefab, Is.Not.Null, entry.key);
                if (!seen.Add(entry.prefab)) continue;
                var instance = Object.Instantiate(entry.prefab);
                var owned = new List<Mesh>();
                try {
                    var doorSpec = Metro.App.TrainDoorRig.ForLine(entry.stock, entry.cars, entry.bakedScale);
                    int originalLeaves = new Metro.App.TrainDoorRig(instance, doorSpec).Leaves;
                    var cache = System.Activator.CreateInstance(compact.GetParameters()[2].ParameterType);
                    compact.Invoke(null, new object[] { instance, entry.key, cache, owned, null });
                    var rig = new Metro.App.TrainDoorRig(instance, doorSpec);
                    Assert.That(rig.Leaves, Is.EqualTo(originalLeaves).And.Positive, entry.key);
                    rig.SetPlatformBank(1);
                    rig.SetBank(1, 1f);
                    Assert.That(rig.Movement, Is.Positive, entry.key);
                    long high = 0;
                    long low = 0;
                    foreach (var filter in instance.GetComponentsInChildren<MeshFilter>(true)) {
                        if (!filter.TryGetComponent<MeshRenderer>(out var renderer) || !renderer.enabled) continue;
                        var mesh = filter.sharedMesh;
                        if (mesh == null) continue;
                        for (int sub = 0; sub < mesh.subMeshCount; sub++) {
                            if (mesh.GetTopology(sub) != MeshTopology.Triangles) continue;
                            high += mesh.GetIndexCount(sub, 0);
                            low += mesh.GetIndexCount(sub, Mathf.Clamp(mesh.lodCount - 1, 0, 2));
                        }
                    }
                    Assert.That(high, Is.Positive, entry.key);
                    Assert.That(low, Is.Positive, entry.key);
                    Assert.That(2 * low, Is.LessThanOrEqualTo(high), $"{entry.key}: {low / 3} / {high / 3} triangles");
                } finally {
                    Object.DestroyImmediate(instance);
                    foreach (var mesh in owned) Object.DestroyImmediate(mesh);
                }
            }
            Assert.That(seen.Count, Is.EqualTo(50));
        }

        [Test]
        public void CommuterTiersFitTheSameRigWhenLocalAssetsAreInstalled() {
            const string root = "Assets/StationDesigner/Generated/Passengers/";
            const string recipe = "Models/Male/commuter/soft-male-commuter-daypack";
            var full = AssetDatabase.LoadAssetAtPath<GameObject>(root + recipe + ".glb");
            var reduced = AssetDatabase.LoadAssetAtPath<GameObject>(root + "Lods/" + recipe + "-lod1.glb");
            var simplified = AssetDatabase.LoadAssetAtPath<GameObject>(root + "Lods/" + recipe + "-lod2.glb");
            if (reduced == null && simplified == null) Assert.Ignore("Local passenger LODs are not installed.");
            Assert.That(reduced, Is.Not.Null);
            Assert.That(simplified, Is.Not.Null);
            Assert.That(full, Is.Not.Null);
            var fullSkin = full.GetComponentInChildren<SkinnedMeshRenderer>(true);
            var midSkin = reduced.GetComponentInChildren<SkinnedMeshRenderer>(true);
            var lowSkin = simplified.GetComponentInChildren<SkinnedMeshRenderer>(true);
            Assert.That(midSkin.sharedMesh.bindposes, Is.EqualTo(fullSkin.sharedMesh.bindposes));
            Assert.That(lowSkin.sharedMesh.bindposes, Is.EqualTo(fullSkin.sharedMesh.bindposes));
            Assert.That(midSkin.sharedMesh.vertexCount, Is.LessThan(fullSkin.sharedMesh.vertexCount));
            Assert.That(lowSkin.sharedMesh.vertexCount, Is.LessThan(midSkin.sharedMesh.vertexCount));
            var catalogue = AssetDatabase.LoadAssetAtPath<Metro.View.PassengerCatalogue>(
                Metro.View.PassengerCatalogue.AssetPath);
            Assert.That(catalogue, Is.Not.Null);
            Assert.That(catalogue.entries, Has.Length.EqualTo(440));
            foreach (var entry in catalogue.entries) {
                Assert.That(entry.reducedMesh?.mesh, Is.Not.Null, entry.recipe);
                Assert.That(entry.simplifiedMesh?.mesh, Is.Not.Null, entry.recipe);
            }
        }

        static StationGraphicsSettings CreateGraphicsSettings(out string originalProfile, out string originalUpscaling) {
            var ctor = typeof(StationGraphicsSettings).GetConstructor(
                BindingFlags.Instance | BindingFlags.NonPublic, null, System.Type.EmptyTypes, null);
            Assert.That(ctor, Is.Not.Null);
            var settings = (StationGraphicsSettings)ctor.Invoke(null);
            var initial = settings.BuildPayload(null, null);
            originalProfile = (string)initial["profile"];
            originalUpscaling = (string)initial["upscaling"];
            return settings;
        }

        static void SetProfile(StationGraphicsSettings settings, string profile) {
            var payload = new JObject { ["profile"] = profile };
            Assert.That(settings.TryHandle(
                new StationCommand { Type = "graphics.set", Payload = payload },
                payload, out var code, out _), Is.True, code);
        }

        static Mesh CreateThreeTierMesh(string name, Material mat) {
            var host = new GameObject("tmp-lod-mesh");
            var meshes = new List<Mesh>();
            try {
                var parts = new StructureParts();
                parts.Cylinder(mat, Vector3.zero, 1f, 3f, 32);
                parts.Emit(host.transform, meshes, name);
                return meshes[0];
            } finally {
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void OtherLevelRendererForcesSteppedDownMeshLodByProfileAndRestoresOnActiveOrHideUi() {
            var settings = CreateGraphicsSettings(out var origProfile, out var origUpscaling);
            var mat = new Material(Shader.Find("Hidden/InternalErrorShader"));
            var lodMesh = CreateThreeTierMesh("three-tier-prop", mat);
            var singleMesh = new Mesh {
                name = "single-tier-prop",
                vertices = new[] { Vector3.zero, Vector3.up, Vector3.right },
                triangles = new[] { 0, 1, 2 },
            };
            var root = new GameObject("other-level-lod-root");
            var visibility = new StationVisibilityRegistry(mat.shader);
            try {
                var propGo = new GameObject("prop", typeof(MeshFilter), typeof(MeshRenderer));
                propGo.transform.SetParent(root.transform, false);
                propGo.GetComponent<MeshFilter>().sharedMesh = lodMesh;
                var propRenderer = propGo.GetComponent<MeshRenderer>();
                propRenderer.sharedMaterial = mat;

                var singleGo = new GameObject("single", typeof(MeshFilter), typeof(MeshRenderer));
                singleGo.transform.SetParent(root.transform, false);
                singleGo.GetComponent<MeshFilter>().sharedMesh = singleMesh;
                var singleRenderer = singleGo.GetComponent<MeshRenderer>();
                singleRenderer.sharedMaterial = mat;

                var psdGo = new GameObject("psd", typeof(MeshFilter), typeof(MeshRenderer));
                psdGo.transform.SetParent(root.transform, false);
                psdGo.GetComponent<MeshFilter>().sharedMesh = lodMesh;
                var psdRenderer = psdGo.GetComponent<MeshRenderer>();
                psdRenderer.sharedMaterial = mat;

                var propTarget = visibility.Register(propGo.transform, StationPartRole.Prop, new[] { -5 });
                visibility.Register(singleGo.transform, StationPartRole.Prop, new[] { -5 });
                var psdTarget = visibility.Register(psdGo.transform, StationPartRole.Psd, new[] { -5 });

                visibility.State.ShowLevels = true;
                visibility.State.HideUi = false;
                visibility.State.Cutaway = false;

                // High profile: active level stays automatic (-1), other levels drop 1 step to Medium (1).
                SetProfile(settings, "high");
                visibility.State.ActiveLevel = -5;
                visibility.Apply();
                Assert.That(propTarget.OtherLevelLod, Is.False);
                Assert.That(propRenderer.forceMeshLod, Is.EqualTo(-1));

                visibility.State.ActiveLevel = 0;
                visibility.ApplyLevelChange(-5);
                Assert.That(propTarget.LastMode, Is.EqualTo(StationDrawMode.Ghost));
                Assert.That(propTarget.OtherLevelLod, Is.True);
                Assert.That(propRenderer.forceMeshLod, Is.EqualTo(1));
                Assert.That(singleRenderer.forceMeshLod, Is.EqualTo(-1), "Single-LOD meshes stay untouched");

                // HideWalls turns PSDs Clear, but other-level PSDs still get stepped-down LOD.
                visibility.State.HideWalls = true;
                visibility.Apply();
                Assert.That(psdTarget.LastMode, Is.EqualTo(StationDrawMode.Clear));
                Assert.That(psdTarget.OtherLevelLod, Is.True);
                Assert.That(psdRenderer.forceMeshLod, Is.EqualTo(1));
                visibility.State.HideWalls = false;

                // Hide UI disables storey-based LOD reduction.
                visibility.State.SetHideUi(true);
                visibility.Apply();
                Assert.That(propTarget.OtherLevelLod, Is.False);
                Assert.That(propRenderer.forceMeshLod, Is.EqualTo(-1));
                visibility.State.SetHideUi(false);

                // Cutaway also puts the level slice away and restores normal LOD.
                visibility.State.Cutaway = true;
                visibility.Apply();
                Assert.That(propTarget.OtherLevelLod, Is.False);
                Assert.That(propRenderer.forceMeshLod, Is.EqualTo(-1));
                visibility.State.Cutaway = false;

                // Balanced profile: other levels drop 1 step from Balanced/Medium to Low (2).
                SetProfile(settings, "balanced");
                visibility.Apply();
                Assert.That(propTarget.OtherLevelLod, Is.True);
                Assert.That(propRenderer.forceMeshLod, Is.EqualTo(2));

                // Low profile: other levels clamp at Low (2).
                SetProfile(settings, "low");
                visibility.Apply();
                Assert.That(propTarget.OtherLevelLod, Is.True);
                Assert.That(propRenderer.forceMeshLod, Is.EqualTo(2));

                // Switching back to the target's own storey restores automatic LOD (-1).
                visibility.State.ActiveLevel = -5;
                visibility.ApplyLevelChange(0);
                Assert.That(propTarget.OtherLevelLod, Is.False);
                Assert.That(propRenderer.forceMeshLod, Is.EqualTo(-1));
            } finally {
                var restore = new JObject { ["profile"] = origProfile, ["upscaling"] = origUpscaling };
                settings.TryHandle(new StationCommand { Type = "graphics.set", Payload = restore }, restore, out _, out _);
                visibility.Dispose();
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(lodMesh);
                Object.DestroyImmediate(singleMesh);
                Object.DestroyImmediate(mat);
            }
        }

        [Test]
        public void InstancedBatchOtherLevelStepsDownTierAndStillAllowsDistanceDrop() {
            var settings = CreateGraphicsSettings(out var origProfile, out var origUpscaling);
            var mat = new Material(Shader.Find("Hidden/InternalErrorShader")) { enableInstancing = true };
            var lodMesh = CreateThreeTierMesh("three-tier-instanced", mat);
            var root = new GameObject("instanced-lod-root");
            var camGo = new GameObject("instanced-lod-cam", typeof(Camera));
            var visibility = new StationVisibilityRegistry(mat.shader);
            try {
                var cam = camGo.GetComponent<Camera>();
                cam.orthographic = false;
                cam.fieldOfView = 45f;
                cam.nearClipPlane = 0.5f;
                cam.transform.position = new Vector3(0f, 1.5f, -5f);

                var drawer = StationInstancedSurfaceDrawer.EnsureFor(root.transform);
                var batchGo = new GameObject("batch", typeof(MeshFilter), typeof(MeshRenderer));
                batchGo.transform.SetParent(root.transform, false);
                var proxyMesh = new Mesh { name = "proxy", bounds = lodMesh.bounds };
                batchGo.GetComponent<MeshFilter>().sharedMesh = proxyMesh;
                var proxyRenderer = batchGo.GetComponent<MeshRenderer>();
                proxyRenderer.sharedMaterial = mat;
                var batch = batchGo.AddComponent<StationInstancedSurfaceBatch>();
                batch.ConfigureMatrices(lodMesh, 0, proxyRenderer, new List<Matrix4x4> { Matrix4x4.identity }, followTransformOffset: false);
                batch.WorldBounds = lodMesh.bounds;

                visibility.Register(batchGo.transform, StationPartRole.Prop, new[] { -5 });
                visibility.State.ShowLevels = true;

                // High profile, close camera: active = LOD0, other level = LOD1 (Medium).
                SetProfile(settings, "high");
                visibility.State.ActiveLevel = -5;
                visibility.Apply();
                drawer.SampleLodView(cam);
                Assert.That(drawer.SelectMeshLod(lodMesh, batch, batch.WorldBounds, Vector3.zero), Is.EqualTo(0));

                visibility.State.ActiveLevel = 0;
                visibility.Apply();
                drawer.SampleLodView(cam);
                Assert.That(drawer.SelectMeshLod(lodMesh, batch, batch.WorldBounds, Vector3.zero), Is.EqualTo(1));

                // High profile, far camera on other level: still drops further to LOD2 (Low).
                cam.transform.position = new Vector3(0f, 1.5f, -200f);
                drawer.SampleLodView(cam);
                Assert.That(drawer.SelectMeshLod(lodMesh, batch, batch.WorldBounds, Vector3.zero), Is.EqualTo(2));

                // Hide UI with close camera restores LOD0.
                cam.transform.position = new Vector3(0f, 1.5f, -5f);
                visibility.State.SetHideUi(true);
                visibility.Apply();
                drawer.SampleLodView(cam);
                Assert.That(drawer.SelectMeshLod(lodMesh, batch, batch.WorldBounds, Vector3.zero), Is.EqualTo(0));
                visibility.State.SetHideUi(false);

                // Balanced profile, close camera: active = LOD0, other level = LOD2 (Low).
                SetProfile(settings, "balanced");
                visibility.State.ActiveLevel = -5;
                visibility.Apply();
                drawer.SampleLodView(cam);
                Assert.That(drawer.SelectMeshLod(lodMesh, batch, batch.WorldBounds, Vector3.zero), Is.EqualTo(0));

                visibility.State.ActiveLevel = 0;
                visibility.Apply();
                drawer.SampleLodView(cam);
                Assert.That(drawer.SelectMeshLod(lodMesh, batch, batch.WorldBounds, Vector3.zero), Is.EqualTo(2));

                // Low profile, close camera: active = LOD1, other level = LOD2 (Low).
                SetProfile(settings, "low");
                visibility.State.ActiveLevel = -5;
                visibility.Apply();
                drawer.SampleLodView(cam);
                Assert.That(drawer.SelectMeshLod(lodMesh, batch, batch.WorldBounds, Vector3.zero), Is.EqualTo(1));

                visibility.State.ActiveLevel = 0;
                visibility.Apply();
                drawer.SampleLodView(cam);
                Assert.That(drawer.SelectMeshLod(lodMesh, batch, batch.WorldBounds, Vector3.zero), Is.EqualTo(2));

                Object.DestroyImmediate(proxyMesh);
            } finally {
                var restore = new JObject { ["profile"] = origProfile, ["upscaling"] = origUpscaling };
                settings.TryHandle(new StationCommand { Type = "graphics.set", Payload = restore }, restore, out _, out _);
                visibility.Dispose();
                Object.DestroyImmediate(camGo);
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(lodMesh);
                Object.DestroyImmediate(mat);
            }
        }

        [Test]
        public void PassengerActorOtherLevelStepsDownSkinnedMeshTierEvenWhenPaused() {
            var settings = CreateGraphicsSettings(out var origProfile, out var origUpscaling);
            var mat = new Material(Shader.Find("Hidden/InternalErrorShader"));
            var fullMesh = new Mesh {
                name = "passenger-lod0",
                vertices = new[] { Vector3.zero, Vector3.up, Vector3.right },
                triangles = new[] { 0, 1, 2 },
            };
            var reducedMesh = new Mesh {
                name = "passenger-lod1",
                vertices = new[] { Vector3.zero, Vector3.up, Vector3.right },
                triangles = new[] { 0, 1, 2 },
            };
            var simplifiedMesh = new Mesh {
                name = "passenger-lod2",
                vertices = new[] { Vector3.zero, Vector3.up, Vector3.right },
                triangles = new[] { 0, 1, 2 },
            };
            fullMesh.RecalculateBounds();
            reducedMesh.RecalculateBounds();
            simplifiedMesh.RecalculateBounds();

            var root = new GameObject("passenger-lod-root");
            var camGo = new GameObject("passenger-lod-cam", typeof(Camera)) { tag = "MainCamera" };
            var prefab = new GameObject("passenger-prefab");
            var clips = new List<AnimationClip>();
            var disabledCameras = new List<Camera>();
            PassengerCatalogue catalogue = null;
            var visibility = new StationVisibilityRegistry(mat.shader);
            StationWorldView world = null;
            try {
                foreach (var existingCam in Object.FindObjectsByType<Camera>(FindObjectsInactive.Exclude, FindObjectsSortMode.None)) {
                    if (existingCam == null || existingCam.gameObject == camGo) continue;
                    if (existingCam.CompareTag("MainCamera") && existingCam.enabled) {
                        existingCam.enabled = false;
                        disabledCameras.Add(existingCam);
                    }
                }
                var cam = camGo.GetComponent<Camera>();
                cam.orthographic = false;
                cam.fieldOfView = 45f;
                cam.nearClipPlane = 0.5f;
                cam.transform.position = new Vector3(2f, -3.1f, -1f);

                prefab.transform.SetParent(root.transform, false);
                prefab.SetActive(false);
                var anim = prefab.AddComponent<Animation>();
                string[] clipNames = { "Idle", "WalkSlow", "Walk", "WalkFast", "Wait", "Lift" };
                for (int i = 0; i < clipNames.Length; i++) {
                    var clip = new AnimationClip { name = clipNames[i], legacy = true };
                    anim.AddClip(clip, clipNames[i]);
                    clips.Add(clip);
                }
                var body = new GameObject("Body");
                body.transform.SetParent(prefab.transform, false);
                var skin = body.AddComponent<SkinnedMeshRenderer>();
                skin.sharedMesh = fullMesh;
                skin.sharedMaterial = mat;
                skin.localBounds = fullMesh.bounds;

                catalogue = ScriptableObject.CreateInstance<PassengerCatalogue>();
                catalogue.clipSet = new PassengerClipSet { clipNames = clipNames };
                catalogue.entries = new[] {
                    new PassengerCatalogueEntry {
                        index = 0,
                        recipe = "soft-male-commuter-none",
                        sex = "male",
                        outfit = "commuter",
                        accessory = "none",
                        prefab = prefab,
                        reducedMesh = new PassengerMeshTier { mesh = reducedMesh, materials = new[] { mat } },
                        simplifiedMesh = new PassengerMeshTier { mesh = simplifiedMesh, materials = new[] { mat } },
                    },
                };
                catalogue.Invalidate();

                world = new StationWorldView(root.transform, null, null, null);
                world.BindVisibility(visibility);
                var crowd = PassengerCrowdView.Build(root.transform, catalogue);
                crowd.BindWorld(world);

                visibility.State.ShowLevels = true;
                visibility.State.ActiveLevel = -5;
                SetProfile(settings, "high");
                visibility.Apply();

                var pose = new PassengerPose {
                    SimId = 42,
                    X = 2.0,
                    Y = 2.0,
                    Z = -4.0, // standing on -5 m floor (z - 1 = -5)
                    Heading = 0.0,
                    Activity = PassengerActivity.Walk,
                    WalkDistance = 1.0,
                    WalkPhase = 0.25,
                    WalkWeight = 1.0,
                    Detail = PassengerDetail.Full,
                    State = StationPassengerState.Walking,
                    Visible = true,
                };
                crowd.Render(new[] { pose }, 1.0);
                Assert.That(crowd.TryGetActor(42, out var actor), Is.True);
                Assert.That(actor.Visible, Is.True);
                Assert.That(actor.Skin.sharedMesh, Is.SameAs(fullMesh), "Active storey uses LOD0 in High profile");

                // Switch storeys while paused (no new crowd.Render call): High profile -> LOD1 (Medium).
                visibility.State.ActiveLevel = 0;
                visibility.Apply();
                Assert.That(actor.Target.OtherLevelLod, Is.True);
                Assert.That(actor.Skin.sharedMesh, Is.SameAs(reducedMesh), "Other storey uses LOD1 (Medium) in High profile");

                // Hide UI while paused restores LOD0.
                visibility.State.SetHideUi(true);
                visibility.Apply();
                Assert.That(actor.Target.OtherLevelLod, Is.False);
                Assert.That(actor.Skin.sharedMesh, Is.SameAs(fullMesh), "Hide UI disables storey-based LOD");
                visibility.State.SetHideUi(false);

                // Balanced profile on other storey -> LOD2 (Low).
                SetProfile(settings, "balanced");
                visibility.Apply();
                Assert.That(actor.Skin.sharedMesh, Is.SameAs(simplifiedMesh), "Other storey uses LOD2 (Low) in Balanced profile");

                // Low profile on other storey -> LOD2 (Low).
                SetProfile(settings, "low");
                visibility.Apply();
                Assert.That(actor.Skin.sharedMesh, Is.SameAs(simplifiedMesh), "Other storey uses LOD2 (Low) in Low profile");

                // Low profile on active storey -> LOD1 (Medium) close up.
                visibility.State.ActiveLevel = -5;
                visibility.Apply();
                Assert.That(actor.Skin.sharedMesh, Is.SameAs(reducedMesh), "Active storey uses LOD1 (Medium) in Low profile");
            } finally {
                var restore = new JObject { ["profile"] = origProfile, ["upscaling"] = origUpscaling };
                settings.TryHandle(new StationCommand { Type = "graphics.set", Payload = restore }, restore, out _, out _);
                world?.Dispose();
                visibility.Dispose();
                if (catalogue != null) Object.DestroyImmediate(catalogue);
                for (int i = 0; i < clips.Count; i++) if (clips[i] != null) Object.DestroyImmediate(clips[i]);
                Object.DestroyImmediate(camGo);
                for (int i = 0; i < disabledCameras.Count; i++) if (disabledCameras[i] != null) disabledCameras[i].enabled = true;
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(fullMesh);
                Object.DestroyImmediate(reducedMesh);
                Object.DestroyImmediate(simplifiedMesh);
                Object.DestroyImmediate(mat);
            }
        }
    }
}
