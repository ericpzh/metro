using System;
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

namespace Metro.Tests {
    public sealed class StationHighlightRetentionTests {
        GameObject root;
        StationGameHost host;
        StationPlacementPreview preview;

        static string Save() => new JObject {
            ["format"] = "metro-station", ["formatVersion"] = 1,
            ["name"] = "highlight regression", ["city"] = "guangzhou", ["seed"] = 1,
            ["static"] = new JObject {
                ["cells"] = new JArray(), ["lines"] = new JArray(),
                ["modules"] = new JArray(
                    new JObject { ["id"] = "a", ["type"] = "bin", ["x"] = 2, ["y"] = 3, ["z"] = -5 },
                    new JObject { ["id"] = "b", ["type"] = "bin", ["x"] = 5, ["y"] = 3, ["z"] = -5 })
            }
        }.ToString();

        [SetUp] public void SetUp() {
            StationRenderers.Clear(); StationEditSession.Reset(); StationScenePicker.Reset();
            root = new GameObject("highlight test host");
            host = root.AddComponent<StationGameHost>();
            typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(host, null);
            host.SetSimulationHost(null);
            host.Coordinator.Assets.Catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            host.Coordinator.RegisterRenderer(new StationEquipmentModuleRenderer());
            var save = JObject.Parse(Save()); save["format"] = StationDocumentReader.SaveFormat;
            Assert.IsTrue(host.OpenDocument(save.ToString(), "fixture").Accepted);
            preview = root.AddComponent<StationPlacementPreview>(); preview.Bind(host.Index);
        }
        [TearDown] public void TearDown() {
            UnityEngine.Object.DestroyImmediate(root);
            StationRenderers.Clear(); StationEditSession.Reset(); StationScenePicker.Reset();
        }

        [Test] public void HoverReleaseMoveAwayAndGhostClearingRetainSelectionWithoutHistory() {
            int revision = host.CurrentRevision;
            string json = host.Document.NormalizedJson;
            preview.Hover(host.Index.GetModule("a"));
            var original = root.GetComponentsInChildren<MeshFilter>().Where(f => f.name == "surface highlight a").ToArray();
            Assert.IsNotEmpty(original);
            preview.Hover(host.Index.GetModule("a"));
            Assert.AreEqual(original[0], root.GetComponentsInChildren<MeshFilter>().First(f => f.name == "surface highlight a"));
            preview.Select(host.Index.GetModule("a"));
            preview.ClearGhost(); preview.ClearCells(); preview.ClearHover();
            preview.Hover(host.Index.GetModule("b"));
            Assert.AreEqual("a", preview.SelectedId);
            Assert.AreEqual("b", preview.HoveredId);
            Assert.IsTrue(root.GetComponentsInChildren<MeshFilter>().Any(f => f.name == "selection box"));
            Assert.IsTrue(root.GetComponentsInChildren<MeshFilter>().Any(f => f.name == "surface highlight a"));
            preview.HideCarried("a"); preview.RestoreCarried();
            Assert.AreEqual("a", preview.SelectedId);
            Assert.IsTrue(root.GetComponentsInChildren<MeshFilter>().Any(f => f.name == "surface highlight a"));
            Assert.AreEqual(revision, host.CurrentRevision); Assert.AreEqual(json, host.Document.NormalizedJson);
            preview.ClearSelection(); Assert.AreEqual("", preview.SelectedId);
        }

        [Test] public void FurnitureAddDeleteAndInverseRetainUnrelatedWorldAndMeshIdentities() {
            var world = host.Coordinator.World;
            Assert.IsTrue(world.TryGetModule("a", out var first));
            Assert.IsTrue(world.TryGetModule("b", out var second));
            var sourceMesh = second.View.GetComponentInChildren<MeshFilter>().sharedMesh;
            preview.Select(host.Index.GetModule("b"));
            var draft = new StationEditDraft { Id = "new-bin", Type = "bin", X = 4, Y = 3, Z = -5, Width = 1, Depth = 1 };
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, draft, null, "place", null,
                out var added, out var code), code);
            Assert.IsTrue(added.Accepted, added.ToString());
            Assert.AreSame(world, host.Coordinator.World);
            Assert.AreSame(first.View, world.Records.First(r => r.ModuleId == "a").View);
            Assert.AreSame(second.View, world.Records.First(r => r.ModuleId == "b").View);
            Assert.AreSame(sourceMesh, second.View.GetComponentInChildren<MeshFilter>().sharedMesh);
            Assert.IsTrue(world.TryGetModule("new-bin", out _));
            preview.Bind(host.Index); Assert.AreEqual("b", preview.SelectedId);
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.AreSame(world, host.Coordinator.World);
            Assert.IsFalse(world.TryGetModule("new-bin", out _));
            Assert.IsTrue(StationEditSession.TryRedo(host, out _, out code), code);
            Assert.AreSame(world, host.Coordinator.World);
            Assert.IsTrue(world.TryGetModule("new-bin", out _));
            Assert.AreSame(second.View, world.Records.First(r => r.ModuleId == "b").View);
        }

        [Test] public void TypedClassifierKeepsFunctionalFurnitureStructuralAndUnknownRootsConservative() {
            var before = host.Coordinator.CommittedRead;
            foreach (var family in new[] { "bin", "tvm", "bench" }) {
                var draft = new StationEditDraft { Id = "classifier-" + family, Type = family, X = 4, Y = 3, Z = -5, Width = 1, Depth = 1 };
                var after = StationLocalEdit.TryApplyModule(before, StationModuleEditMode.Add, draft, null, "fixture", out var code);
                Assert.IsNotNull(after, code);
                var expected = family == "bin" ? StationDocumentEditKind.Cosmetic : StationDocumentEditKind.Structural;
                Assert.AreEqual(expected, StationEditClassifier.ClassifyLocal(before, after), family);
                Assert.AreEqual(StationEditClassifier.Classify(before.Document, after.Document), StationEditClassifier.ClassifyLocal(before, after));
                after.Envelope["unknown-future-rule"] = 1;
                Assert.AreEqual(StationDocumentEditKind.Structural, StationEditClassifier.ClassifyLocal(before, after));
            }
        }

        [Test] public void EraseBatchKeepsSixFacesTintedAndPreservesForegroundOcclusion() {
            if (SystemInfo.graphicsDeviceType == UnityEngine.Rendering.GraphicsDeviceType.Null) Assert.Ignore("Requires metro-unity.ps1 test -Graphics.");
            host.Coordinator.World.RootObject.SetActive(false);
            var cell = new StationCellKey(0, 0, -5);
            var planned = new StationCellPreview { Kind = "erase", Cursor = new StationCellKey(50, 50, -5) };
            planned.Check.Accepted.Add(cell);
            preview.ShowCells(planned);
            var batch = root.GetComponentsInChildren<MeshFilter>().Single(f => f.name == "erase surface batch");
            var mesh = batch.sharedMesh;
            Assert.AreEqual(32, mesh.triangles.Length / 3, "six exterior faces split on the half-metre plan grid");
            preview.ShowCells(planned);
            Assert.AreSame(mesh, root.GetComponentsInChildren<MeshFilter>().Single(f => f.name == "erase surface batch").sharedMesh);
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var cameraObject = new GameObject("erase render camera");
            var camera = cameraObject.AddComponent<Camera>();
            var target = new RenderTexture(96, 96, 24);
            var texture = new Texture2D(96, 96, TextureFormat.RGB24, false);
            var material = new Material(Shader.Find("Universal Render Pipeline/Unlit"));
            material.SetColor("_BaseColor", new Color(.25f, .25f, .25f));
            cube.GetComponent<Renderer>().sharedMaterial = material;
            cube.transform.position = new Vector3(.5f, -4.5f, .5f);
            camera.targetTexture = target; camera.orthographic = true; camera.orthographicSize = 1;
            camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = Color.black;
            var previous = RenderTexture.active;
            Color[] Capture() { camera.Render(); RenderTexture.active = target; texture.ReadPixels(new Rect(0, 0, 96, 96), 0, 0); texture.Apply(); return texture.GetPixels(); }
            try {
                foreach (var direction in new[] { Vector3.right, Vector3.left, Vector3.up, Vector3.down, Vector3.forward, Vector3.back,
                    new Vector3(1, .12f, 1).normalized, new Vector3(-1, .12f, 1).normalized }) {
                    camera.transform.position = cube.transform.position + direction * 4;
                    camera.transform.LookAt(cube.transform.position, Mathf.Abs(direction.y) > .9f ? Vector3.forward : Vector3.up);
                    batch.gameObject.SetActive(false); var before = Capture();
                    batch.gameObject.SetActive(true); var after = Capture();
                    for (int y = 40; y < 56; y++) for (int x = 40; x < 56; x++) {
                        int i = y * 96 + x;
                        Assert.Greater(after[i].r - before[i].r, .04f, "surface coverage " + direction + " at " + x + "," + y);
                    }
                    var foreground = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    foreground.transform.position = cube.transform.position + direction * 1.5f;
                    foreground.transform.localScale = Vector3.one * .7f;
                    foreground.GetComponent<Renderer>().sharedMaterial = material;
                    var occluded = Capture();
                    Assert.Less(Mathf.Abs(occluded[48 * 96 + 48].r - before[48 * 96 + 48].r), .02f, "opaque foreground wins depth test");
                    UnityEngine.Object.DestroyImmediate(foreground);
                }
            } finally {
                RenderTexture.active = previous; camera.targetTexture = null; target.Release();
                UnityEngine.Object.DestroyImmediate(cameraObject); UnityEngine.Object.DestroyImmediate(cube);
                UnityEngine.Object.DestroyImmediate(material); UnityEngine.Object.DestroyImmediate(target); UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        [Test] public void EveryEdgeFurnitureVariantMatchesTheWebPlacementOracleInBothBuildOrders() {
            var oracle = JObject.Parse(System.IO.File.ReadAllText(System.IO.Path.Combine(Application.dataPath,
                "StationDesigner/Tests/EditMode/edge-placement-oracle.json")));
            var catalogue = host.Coordinator.Assets.Catalogue;
            foreach (var item in (JArray)oracle["cases"]) {
                string type = (string)item["type"], variant = (string)item["variant"];
                string key = type == "shelf" ? "shelf-" + variant
                    : type == "extinguisher" && variant != "standard" ? type + "-" + variant : type;
                Assert.IsTrue(catalogue.TryGet(key, out var entry), key);
                var save = JObject.Parse(Save()); save["format"] = StationDocumentReader.SaveFormat;
                save["static"]["modules"] = item["modules"].DeepClone();
                var read = StationDocumentReader.Read(save.ToString(), StationSource.None);
                var module = read.Index.GetModule("decor");
                var actual = ModulePlacement.Resolve(module, entry, read.Index);
                var expected = (JArray)item["position"];
                string context = key + "/" + item["rot"] + "/" + item["backing"];
                Assert.AreEqual((float)expected[0], actual.x, .00001f, context);
                Assert.AreEqual((float)expected[2], actual.y, .00001f, context);
                Assert.AreEqual((float)expected[1], actual.z, .00001f, context);
            }
        }

        [TestCase("shelf")] [TestCase("extinguisher")]
        public void BakedWideBodiesDoNotReceiveASecondRunTranslation(string family) {
            for (int rotation = 0; rotation < 4; rotation++) {
                var facts = new ModuleFacts { Type = family, Width = 2, Depth = 1, Rotation = rotation };
                Assert.AreEqual(Vector3.zero, ModulePlacement.RunCentre(facts));
            }
        }

        [TestCase(0, 0f, .2f)] [TestCase(1, -.2f, 0f)]
        [TestCase(2, 0f, -.2f)] [TestCase(3, .2f, 0f)]
        public void TvmBackPlaneFollowsRotatedTileEdge(int rotation, float dx, float dy) {
            var module = new ModuleFacts { Type = "tvm", X = -3, Y = 4, Z = -10, Rotation = rotation, Width = 1, Depth = 1 };
            var position = ModulePlacement.Position(module, new Vector3(.5f, .7f, 1));
            Assert.AreEqual(-2.5f + dx, position.x, .00001f);
            Assert.AreEqual(4.5f + dy, position.z, .00001f);
            var back = position + ModulePlacement.Rotation(rotation) * new Vector3(0, 0, .3f);
            var expected = ModulePlacement.Rotation(rotation) * new Vector3(0, 0, .5f);
            Assert.AreEqual(-2.5f + expected.x, back.x, .00001f);
            Assert.AreEqual(4.5f + expected.z, back.z, .00001f);
        }
    }
}
