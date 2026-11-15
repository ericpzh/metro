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

namespace Metro.Tests {
    /// <summary>
    /// Plan 22 §3: the selection mark. Both branches of `StationPlacementPreview.Select` passed
    /// the nullable <c>selectMaterial</c> field, which nothing initialised, so `BuildBox` assigned
    /// a null material and every selection drew Unity's magenta missing-material. The geometry
    /// was also a 12-prism cage built from the **clearance** box scaled by 1.06, while the web
    /// pads the module's **rendered** bounds by a fixed 0.06 m and draws one thin `#55b6ff` line
    /// box (`ModuleSystem.ts:refreshSelection`).
    /// </summary>
    public sealed class StationSelectionPreviewTests {
        static JObject Module(string id, string type, int x, int y, int z, int w = 1, JObject cfg = null) =>
            new JObject {
                ["id"] = id, ["type"] = type, ["x"] = x, ["y"] = y, ["z"] = z,
                ["w"] = w, ["rot"] = 0, ["cfg"] = cfg ?? new JObject(),
            };

        static JObject Save(JArray modules) => new JObject {
            ["format"] = StationDocumentReader.SaveFormat,
            ["formatVersion"] = StationDocumentReader.SupportedVersion,
            ["savedAt"] = StationDocumentReader.FixedSavedAt,
            ["name"] = "selection probe", ["city"] = "guangzhou", ["seed"] = 5,
            ["levelBase"] = 0, ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = new JArray(),
                ["modules"] = modules,
                ["lines"] = new JArray(),
            },
        };

        static RuntimeCatalogue Catalogue() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "runtime catalogue missing: " + RuntimeCatalogue.AssetPath);
            return catalogue;
        }

        static Shader FindShader() =>
            Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");

        static StationWorldView Build(JObject save, out GameObject root) {
            var read = StationDocumentReader.Read(save.ToString(Formatting.None),
                new StationSource("selection probe", ""));
            root = new GameObject("selection probe");
            var world = new StationWorldView(root.transform, "selection probe",
                new IStationViewRenderer[] { new StationEquipmentModuleRenderer() },
                new StationViewAssets { Catalogue = Catalogue(), Shader = FindShader() });
            world.Build(read.Document, read.Index);
            world.Activate();
            return world;
        }

        /* --------------------------------------------------------- the material */

        [Test]
        public void TheSelectionColourIsTheSourcesLineBlue() {
            Assert.AreEqual(0x55 / 255f, StationPlacementPreview.SelectionColour.r, 1e-4f);
            Assert.AreEqual(0xb6 / 255f, StationPlacementPreview.SelectionColour.g, 1e-4f);
            Assert.AreEqual(1f, StationPlacementPreview.SelectionColour.b, 1e-4f);
            Assert.AreEqual(.06f, StationPlacementPreview.SelectionPad, 1e-6f, "the source's fixed pad");
        }

        [Test]
        public void TheSelectionMaterialIsNeverNullAndIsUnlit() {
            var material = StationPlacementPreview.CreateSelectionMaterial();
            Assert.IsNotNull(material, "a selection must never hand a null material to a renderer");
            try {
                Assert.AreEqual("edit selection", material.name);
                var colors = new List<Color>();
                if (material.HasProperty("_BaseColor")) colors.Add(material.GetColor("_BaseColor"));
                if (material.HasProperty("_Color")) colors.Add(material.GetColor("_Color"));
                Assert.IsNotEmpty(colors, "the material carries a colour property");
                foreach (var color in colors) {
                    Assert.AreEqual(StationPlacementPreview.SelectionColour.r, color.r, 1e-4f);
                    Assert.AreEqual(StationPlacementPreview.SelectionColour.g, color.g, 1e-4f);
                    Assert.AreEqual(StationPlacementPreview.SelectionColour.b, color.b, 1e-4f);
                }
                var shader = material.shader != null ? material.shader.name : "";
                StringAssert.DoesNotContain("Lit", shader,
                    "a line primitive has no normals, so a Lit material renders half the box black");
            } finally {
                UnityEngine.Object.DestroyImmediate(material);
            }
        }

        /* -------------------------------------------------------------- bounds */

        [Test]
        public void TheSelectionBoxIsTheRenderedBoundsPaddedBySixCentimetres() {
            var world = Build(Save(new JArray {
                Module("bench-1", "bench", 4, 4, 0, 2, new JObject { ["variant"] = "seat-2" }),
            }), out var root);
            try {
                var module = world.Document.Modules.First(record => record.Id == "bench-1");
                Assert.IsTrue(world.TryGetModule("bench-1", out var record), "the bench is registered");
                var drawn = new Bounds();
                bool any = false;
                foreach (var renderer in record.View.GetComponentsInChildren<MeshRenderer>(true)) {
                    if (!renderer) continue;
                    if (!any) { drawn = renderer.bounds; any = true; } else drawn.Encapsulate(renderer.bounds);
                }
                Assert.IsTrue(any, "the bench has drawn geometry");
                Assert.IsTrue(StationPlacementPreview.TrySelectionBounds(world, module, out var box));
                Assert.AreEqual(drawn.center.x, box.center.x, .01);
                Assert.AreEqual(drawn.center.y, box.center.y, .01);
                Assert.AreEqual(drawn.center.z, box.center.z, .01);
                Assert.AreEqual(drawn.size.x + .12f, box.size.x, .01, "0.06 m on each side");
                Assert.AreEqual(drawn.size.y + .12f, box.size.y, .01);
                Assert.AreEqual(drawn.size.z + .12f, box.size.z, .01);
                // The clearance envelope is a different, larger box: this proves the mark measures
                // the drawn piece rather than the authored cell it reserves.
                Assert.IsTrue(StationFootprints.TryClearance(module, out var clearance, out _));
                Assert.Greater(clearance.Y1 - clearance.Y0, drawn.size.z - .01,
                    "a 2 m bench reserves its 2 cells, while it draws less than that");
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void AModuleWithNoViewFallsBackToItsAuthoredEnvelope() {
            var module = new StationModuleRecord("tree-1", "tree", 2, 3, 0, 0, 1, 1, 1, false, null, null, null, "", null);
            Assert.IsTrue(StationPlacementPreview.TrySelectionBounds(null, module, out var box),
                "a paving tile in a combined batch has no view of its own");
            Assert.IsTrue(StationFootprints.TryClearance(module, out var clearance, out var reason), reason);
            Assert.AreEqual(clearance.X1 - clearance.X0 + .12, box.size.x, .01);
            Assert.AreEqual(clearance.Y1 - clearance.Y0 + .12, box.size.z, .01,
                "the document's plan y is Unity's z");
            Assert.AreEqual(clearance.Z1 - clearance.Z0 + .12, box.size.y, .01);
        }
    }
}
