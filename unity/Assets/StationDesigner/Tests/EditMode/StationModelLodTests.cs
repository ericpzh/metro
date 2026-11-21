using System.Collections.Generic;
using Metro.App.Views;
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
    }
}
