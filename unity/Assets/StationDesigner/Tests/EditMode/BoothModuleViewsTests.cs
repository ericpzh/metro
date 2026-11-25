using System.Collections.Generic;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// RCA 14 §3.4 / plan C2: a booth is a `w × h` room, and the promoted canonical
    /// prefab cannot honour an authored rectangle (it measures 5.45 × 3 m). The
    /// dimension-aware builder must draw the saved footprint, keep its own orientation
    /// (`cfg.front`; the saved `rot` is not a booth turn in the source), and expose the
    /// measured bounds the view record uses.
    /// </summary>
    public sealed class BoothModuleViewsTests {
        GameObject root;
        StationMaterials materials;

        [SetUp]
        public void SetUp() {
            root = new GameObject("booth probe");
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            Assert.IsNotNull(shader, "the station shader is missing");
            materials = new StationMaterials(shader);
        }

        [TearDown]
        public void TearDown() {
            if (materials != null) {
                for (int i = 0; i < StationMaterials.Colours.Length; i++) {
                    if (materials[i] != null) Object.DestroyImmediate(materials[i]);
                }
                materials = null;
            }
            DestroyNow(root);
            root = null;
        }

        static void DestroyNow(Object value) {
            if (!value) return;
            Object.DestroyImmediate(value);
        }

        static ModuleFacts Booth(int w, int h, int rot = 0, int front = 0, string kind = "ticket") => ModuleFactsReader.Read(new JObject {
            ["id"] = "booth-" + w + "x" + h,
            ["type"] = "booth",
            ["x"] = 63, ["y"] = 33, ["z"] = 0,
            ["w"] = w, ["h"] = h, ["rot"] = rot,
            ["cfg"] = new JObject { ["kind"] = kind, ["stocked"] = true, ["front"] = front },
        });

        static StationBox Measure(GameObject view) {
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            foreach (var filter in view.GetComponentsInChildren<MeshFilter>(true)) {
                var mesh = filter ? filter.sharedMesh : null;
                if (!mesh) continue;
                var local = mesh.bounds;
                for (int corner = 0; corner < 8; corner++) {
                    var point = filter.transform.TransformPoint(new Vector3(
                        (corner & 1) == 0 ? local.min.x : local.max.x,
                        (corner & 2) == 0 ? local.min.y : local.max.y,
                        (corner & 4) == 0 ? local.min.z : local.max.z));
                    var document = StationCoordinates.WorldToDocument(point);
                    min = Vector3.Min(min, document);
                    max = Vector3.Max(max, document);
                }
            }
            return new StationBox(min.x, min.y, min.z, max.x, max.y, max.z);
        }

        static StationIndex BuildIndex(JArray cells = null, JArray modules = null) {
            return StationDocumentReader.Read(new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "booth-test",
                ["nameEn"] = "Booth Test",
                ["city"] = "guangzhou",
                ["seed"] = 1,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = cells ?? new JArray(),
                    ["modules"] = modules ?? new JArray(),
                    ["lines"] = new JArray(),
                },
            }.ToString(), StationSource.None).Index;
        }

        static JArray CeilingSlab(int x0, int y0, int w, int h, int z, int skipX = int.MinValue, int skipY = int.MinValue) {
            var cells = new JArray();
            for (int x = x0; x < x0 + w; x++) {
                for (int y = y0; y < y0 + h; y++) {
                    if (x == skipX && y == skipY) continue;
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid" });
                }
            }
            return cells;
        }

        [TestCase("ticket", false)]
        [TestCase("info", false)]
        [TestCase("info", true)]
        public void LowKeepsTheBoothWithinHalfTheHighTriangleCount(string kind, bool withCeiling) {
            var index = withCeiling ? BuildIndex(CeilingSlab(63, 33, 2, 4, 5)) : null;
            Assert.IsTrue(BoothModuleViews.TryBuild(Booth(2, 4, kind: kind), root.transform, materials, out var view, out var note, 0f, index), note);
            uint full = 0, simplified = 0;
            foreach (var filter in view.GetComponentsInChildren<MeshFilter>(true)) {
                var mesh = filter.sharedMesh;
                full += mesh.GetIndexCount(0, 0);
                simplified += mesh.GetIndexCount(0, mesh.lodCount - 1);
            }
            Assert.That(simplified, Is.GreaterThan(0));
            Assert.That(simplified * 2, Is.LessThanOrEqualTo(full));
        }

        [Test]
        public void TheBoothIsDrawnOnItsAuthoredRectangle() {
            Assert.IsTrue(BoothModuleViews.TryBuild(Booth(2, 4), root.transform, materials, out var view, out var note),
                "the dimensioned booth builds");
            Assert.IsNotNull(view);
            Assert.AreEqual("", note, "the ticket kiosk needs no approximation");
            var bounds = Measure(view);
            Assert.AreEqual(2f, bounds.Width, .05f, "w is the booth's plan width");
            Assert.AreEqual(4f, bounds.Depth, .05f, "h is the booth's plan depth");
            Assert.AreEqual(2.4f, bounds.Height, .05f, "the overhead frame tops out at 2.4 m");
            Assert.AreEqual(1f, bounds.Z0, .05f, "the room starts on the cell's floor top");
        }

        [Test]
        public void TheSavedRotationIsNotABoothTurnButTheFrontIs() {
            // `BoothModel` draws its canonical room in world axes; the saved `rot` is not
            // read, so the footprint is the same at rot 0 and rot 1.
            Assert.IsTrue(BoothModuleViews.TryBuild(Booth(2, 4, rot: 1), root.transform, materials, out var turned, out _));
            var turnedBounds = Measure(turned);
            Assert.AreEqual(2f, turnedBounds.Width, .05f, "rot does not swap the booth's extents");
            Assert.AreEqual(4f, turnedBounds.Depth, .05f);
            // `cfg.front` turns the booth about its footprint centre: the rectangle is
            // built in the turned footprint, so the drawn plan stays 2 × 4.
            Assert.IsTrue(BoothModuleViews.TryBuild(Booth(2, 4, front: 1), root.transform, materials, out var front, out _));
            var frontBounds = Measure(front);
            Assert.AreEqual(2f, frontBounds.Width, .05f, "front keeps the authored footprint");
            Assert.AreEqual(4f, frontBounds.Depth, .05f);
        }

        [Test]
        public void TheInfoBoothCounterDipsToAccessibleHeightWithSlopedShoulders() {
            Assert.IsTrue(BoothModuleViews.TryBuild(Booth(4, 3, front: 0, kind: "info"), root.transform, materials, out var view, out var note),
                "the info booth builds");
            Assert.AreEqual("", note, "the info booth draws the sloped accessible shoulder with no caveat");

            float centerFrontMaxZ = float.MinValue;
            float sideFrontMaxZ = float.MinValue;
            foreach (var filter in view.GetComponentsInChildren<MeshFilter>(true)) {
                var mesh = filter ? filter.sharedMesh : null;
                if (!mesh) continue;
                foreach (var v in mesh.vertices) {
                    var doc = StationCoordinates.WorldToDocument(filter.transform.TransformPoint(v));
                    // Restrict to counter elevation band [1.0, 2.2] on the approach face (y in [33, 33.55]).
                    // For a 4x3 booth (x = 63..67, mid = 65), lowWidth = 0.90 so the dip corners sit at x = 64.55 and 65.45.
                    if (doc.y < 32.95f || doc.y > 33.6f || doc.z > 2.2f) continue;
                    if (Mathf.Abs(doc.x - 65f) <= 0.46f) centerFrontMaxZ = Mathf.Max(centerFrontMaxZ, doc.z);
                    if (doc.x > 63.05f && doc.x < 63.65f) sideFrontMaxZ = Mathf.Max(sideFrontMaxZ, doc.z);
                }
            }
            // Floor top = 1.0; lowered accessible counter rim top = 1.0 + 0.72 + 0.08 = 1.80 m.
            Assert.AreEqual(1.80f, centerFrontMaxZ, 0.01f, "accessible dip lowers front counter centre to 0.72 + 0.08 m above floor");
            // Standard info counter rim top = 1.0 + 1.02 + 0.08 = 2.10 m.
            Assert.AreEqual(2.10f, sideFrontMaxZ, 0.01f, "flanking counter stays at full 1.02 + 0.08 m height");
        }

        [Test]
        public void TheScreenCubeFlipsVForGltfLcdTextures() {
            var screen = BoothModuleViews.ScreenCube();
            Assert.IsNotNull(screen);
            Assert.AreEqual(24, screen.vertexCount);
            var verts = screen.vertices;
            var norms = screen.normals;
            var uvs = screen.uv;
            int frontTop = 0, frontBottom = 0;
            for (int i = 0; i < verts.Length; i++) {
                if (Vector3.Dot(norms[i], Vector3.back) < 0.9f) continue;
                if (verts[i].y > 0f) {
                    Assert.AreEqual(0f, uvs[i].y, 1e-4f, "top of front screen face samples v=0 (blue header in glTFast texture)");
                    frontTop++;
                } else {
                    Assert.AreEqual(1f, uvs[i].y, 1e-4f, "bottom of front screen face samples v=1 (buy button in glTFast texture)");
                    frontBottom++;
                }
            }
            Assert.AreEqual(2, frontTop);
            Assert.AreEqual(2, frontBottom);
        }

        [Test]
        public void BoothPaletteResolvesDistinctWebMatchedSlotsWithoutDestroyingPrefabMaterials() {
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            var owned = new List<Material>();
            try {
                var palette = BoothModuleViews.BoothPalette.FromCatalogue(null, shader, materials, owned);
                Assert.IsNotNull(palette[BoothModuleViews.SlotBinSteel]);
                Assert.IsNotNull(palette[BoothModuleViews.SlotSteel]);
                Assert.IsNotNull(palette[BoothModuleViews.SlotWhite]);
                Assert.IsNotNull(palette[BoothModuleViews.SlotGateRed]);
                Assert.IsNotNull(palette[BoothModuleViews.SlotHeadlight]);
                Assert.IsNotNull(palette[BoothModuleViews.SlotBlack]);
                Assert.IsNotNull(palette[BoothModuleViews.SlotScreen]);
                Assert.AreNotEqual(palette[BoothModuleViews.SlotBinSteel], palette[BoothModuleViews.SlotDarkSteel],
                    "ticket booth binSteel body must not share darkSteel");
                Assert.AreNotEqual(palette[BoothModuleViews.SlotHeadlight], palette[BoothModuleViews.SlotWhite],
                    "info booth underside headlight uses its own unlit material");

                // Verify fallback binSteel is light warm grey (~#cecec6), not dark slate.
                var binColor = palette[BoothModuleViews.SlotBinSteel].HasProperty("_BaseColor")
                    ? palette[BoothModuleViews.SlotBinSteel].GetColor("_BaseColor")
                    : palette[BoothModuleViews.SlotBinSteel].color;
                Assert.Greater(binColor.r, 0.75f, "binSteel fallback matches #cecec6 light satin stainless");
                Assert.Greater(binColor.g, 0.75f);

                Assert.IsTrue(BoothModuleViews.TryBuild(Booth(3, 3, kind: "ticket"), root.transform, palette, out var ticketView, out var ticketNote), ticketNote);
                Assert.IsTrue(BoothModuleViews.TryBuild(Booth(3, 3, kind: "info"), root.transform, palette, out var infoView, out var infoNote), infoNote);
                Assert.AreEqual("", ticketNote);
                Assert.AreEqual("", infoNote);
                Assert.IsNotNull(ticketView);
                Assert.IsNotNull(infoView);
            } finally {
                foreach (var mat in owned) DestroyNow(mat);
            }
        }

        [Test]
        public void BoothPaletteExtractsWebMatchedPrefabMaterialsFromRuntimeCatalogue() {
            var catalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "runtime catalogue missing: " + RuntimeCatalogue.AssetPath);
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            var owned = new List<Material>();
            try {
                var palette = BoothModuleViews.BoothPalette.FromCatalogue(catalogue, shader, materials, owned);
                Assert.AreEqual("binSteel", OutdoorModuleViews.MaterialBaseName(palette[BoothModuleViews.SlotBinSteel].name));
                Assert.AreEqual("steel", OutdoorModuleViews.MaterialBaseName(palette[BoothModuleViews.SlotSteel].name));
                Assert.AreEqual("darkSteel", OutdoorModuleViews.MaterialBaseName(palette[BoothModuleViews.SlotDarkSteel].name));
                Assert.AreEqual("glass", OutdoorModuleViews.MaterialBaseName(palette[BoothModuleViews.SlotGlass].name));
                Assert.AreEqual("black", OutdoorModuleViews.MaterialBaseName(palette[BoothModuleViews.SlotBlack].name));
                Assert.AreEqual("screen", OutdoorModuleViews.MaterialBaseName(palette[BoothModuleViews.SlotScreen].name));
                Assert.AreEqual("white", OutdoorModuleViews.MaterialBaseName(palette[BoothModuleViews.SlotWhite].name));
                Assert.AreEqual("gateRed", OutdoorModuleViews.MaterialBaseName(palette[BoothModuleViews.SlotGateRed].name));
                Assert.AreEqual("booth-headlight", palette[BoothModuleViews.SlotHeadlight].name);
                // Only the minted headlight material should be owned; extracted prefab assets stay asset-owned.
                Assert.AreEqual(1, owned.Count, "extracted prefab materials must not be added to world-owned disposal list");
                Assert.AreSame(palette[BoothModuleViews.SlotHeadlight], owned[0]);
            } finally {
                foreach (var mat in owned) DestroyNow(mat);
            }
        }

        [Test]
        public void EveryMonitorBaseSitsFlushOnSolidFlatCounterAcrossSizes() {
            var sizes = new[] { (1, 1), (2, 2), (2, 3), (3, 2), (3, 3), (4, 3), (5, 4), (6, 3) };
            foreach (string kind in new[] { "info", "ticket" }) {
                bool info = kind == "info";
                foreach (var (w, h) in sizes) {
                    BoothModuleViews.ComputeScreenLayout(info, w, h, out float screenY, out var xs);
                    Assert.Greater(xs.Length, 0, $"{kind} {w}x{h} places at least one monitor");
                    float inset = Mathf.Min(.55f, Mathf.Min(w / 3f, h / 3f));
                    float y0 = -h * .5f;
                    Assert.GreaterOrEqual(screenY - .09f, y0 - 1e-4f, $"{kind} {w}x{h} base stays inside front edge");
                    Assert.LessOrEqual(screenY + .09f, y0 + inset + 1e-4f, $"{kind} {w}x{h} base stays inside counter depth");
                    if (info) {
                        float a = -w * .5f + inset, b = w * .5f - inset, run = Mathf.Max(.1f, b - a);
                        float mid = (a + b) * .5f;
                        float lowWidth = Mathf.Min(.9f, run * .36f);
                        float shoulder = Mathf.Min(.32f, run * .16f);
                        float shoulderLeft = mid - lowWidth * .5f - shoulder;
                        foreach (float x in xs) {
                            Assert.GreaterOrEqual(x - .14f, -w * .5f - 1e-4f, $"info {w}x{h} base stays inside outer left edge");
                            Assert.LessOrEqual(x + .14f, shoulderLeft + 1e-4f, $"info {w}x{h} base never overhangs sloped shoulder");
                        }
                    } else {
                        for (int i = 0; i < xs.Length; i++) {
                            Assert.GreaterOrEqual(xs[i] - .14f, -w * .5f + .08f - 1e-4f, $"ticket {w}x{h} base clears left post");
                            Assert.LessOrEqual(xs[i] + .14f, w * .5f - .08f + 1e-4f, $"ticket {w}x{h} base clears right post");
                            for (int j = i + 1; j < xs.Length; j++) {
                                Assert.GreaterOrEqual(Mathf.Abs(xs[j] - xs[i]), .43f, $"ticket {w}x{h} monitors do not overlap");
                            }
                        }
                    }

                    // Verify built monitor base rests flush on countertop (0 mm gap).
                    var mod = Booth(w, h, kind: kind);
                    Assert.IsTrue(BoothModuleViews.TryBuild(mod, root.transform, materials, out var view, out _));
                    float counterTopZ = 1f + (info ? 1.02f : .96f) + .08f;
                    var darkMat = materials[StationMaterials.Dark];
                    float minMonitorBaseZ = float.MaxValue;
                    foreach (var renderer in view.GetComponentsInChildren<MeshRenderer>(true)) {
                        if (renderer.sharedMaterial != darkMat) continue;
                        var mesh = renderer.GetComponent<MeshFilter>().sharedMesh;
                        foreach (var v in mesh.vertices) {
                            var doc = StationCoordinates.WorldToDocument(renderer.transform.TransformPoint(v));
                            if (doc.z > counterTopZ - .02f && doc.z < counterTopZ + .05f &&
                                doc.y > 33.1f && doc.y < 33.6f && doc.x > 63.05f && doc.x < 63f + w - .05f) {
                                minMonitorBaseZ = Mathf.Min(minMonitorBaseZ, doc.z);
                            }
                        }
                    }
                    Assert.AreEqual(counterTopZ, minMonitorBaseZ, 0.005f, $"{kind} {w}x{h} monitor base rests flush on countertop");
                }
            }
        }

        [Test]
        public void InfoBoothTopBarHangsFromCeilingWithinThreeMetresAndIsOmittedOtherwise() {
            var infoMod = Booth(3, 3, kind: "info");

            // 1. Open sky (no ceiling) -> no overhead top bar.
            var openIndex = BuildIndex();
            Assert.IsFalse(BoothModuleViews.TryResolveInfoHeaderHang(openIndex, infoMod, out _));
            Assert.IsTrue(BoothModuleViews.TryBuild(infoMod, root.transform, materials, out var openView, out _, 0f, openIndex));
            Assert.Less(Measure(openView).Z1, 2.5f, "open sky info booth omits overhead top bar");

            // 2. Ceiling > 3 m above top bar (z = 7 -> 3.6 m drop) -> omitted.
            var highIndex = BuildIndex(CeilingSlab(63, 33, 3, 3, 7));
            Assert.IsFalse(BoothModuleViews.TryResolveInfoHeaderHang(highIndex, infoMod, out _));
            Assert.IsTrue(BoothModuleViews.TryBuild(infoMod, root.transform, materials, out var highView, out _, 0f, highIndex));
            Assert.Less(Measure(highView).Z1, 2.5f, "ceiling > 3 m above bar omits top bar");

            // 3. Ceiling slab at z = 5 (1.6 m drop) -> hung top bar + rods reach z = 5.
            var indoorIndex = BuildIndex(CeilingSlab(63, 33, 3, 3, 5));
            Assert.IsTrue(BoothModuleViews.TryResolveInfoHeaderHang(indoorIndex, infoMod, out var zs));
            Assert.AreEqual(4, zs.Length);
            for (int i = 0; i < 4; i++) Assert.AreEqual(5f, zs[i], 1e-4f);
            Assert.IsTrue(BoothModuleViews.TryBuild(infoMod, root.transform, materials, out var indoorView, out _, 0f, indoorIndex));
            Assert.AreEqual(5f, Measure(indoorView).Z1, 0.02f, "hung info booth suspension reaches ceiling at z = 5");

            // 4. Partial ceiling (one corner uncovered) -> omitted.
            var partialIndex = BuildIndex(CeilingSlab(63, 33, 3, 3, 5, skipX: 63, skipY: 33));
            Assert.IsFalse(BoothModuleViews.TryResolveInfoHeaderHang(partialIndex, infoMod, out _));

            // 5. Underground concourse (z = -5) hangs from virtual street plane at z = 0.
            var underMod = ModuleFactsReader.Read(new JObject {
                ["id"] = "booth-under", ["type"] = "booth",
                ["x"] = 63, ["y"] = 33, ["z"] = -5, ["w"] = 3, ["h"] = 3, ["rot"] = 0,
                ["cfg"] = new JObject { ["kind"] = "info", ["stocked"] = true, ["front"] = 0 },
            });
            Assert.IsTrue(BoothModuleViews.TryResolveInfoHeaderHang(openIndex, underMod, out var underZs));
            for (int i = 0; i < 4; i++) Assert.AreEqual(0f, underZs[i], 1e-4f);
            Assert.IsTrue(BoothModuleViews.TryBuild(underMod, root.transform, materials, out var underView, out _, 0f, openIndex));
            Assert.AreEqual(0f, Measure(underView).Z1, 0.02f, "underground info booth hangs from street plane z = 0");

            // 6. Canopy roof at z = 0 covers the booth within 3 m.
            var canopyIndex = BuildIndex(modules: new JArray {
                new JObject {
                    ["id"] = "canopy-1", ["type"] = "roof",
                    ["x"] = 63, ["y"] = 33, ["z"] = 0, ["w"] = 4, ["d"] = 4, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "canopy" },
                },
            });
            Assert.IsTrue(BoothModuleViews.TryResolveInfoHeaderHang(canopyIndex, infoMod, out var canopyZs));
            for (int i = 0; i < 4; i++) {
                Assert.That(canopyZs[i], Is.InRange(5.0f, 5.9f), "canopy roof underside sits within 3 m above info header");
            }
        }

        [Test]
        public void TheBoothBelongsToTheFloorItStandsOn() {
            var module = Booth(3, 3);
            module.Z = -15;
            var grid = StationLevelGrid.FromDocument(0, 5);
            CollectionAssert.AreEqual(new[] { -15 }, StationModuleLevels.Of(Record(module), grid));
        }

        static StationModuleRecord Record(ModuleFacts facts) => new StationModuleRecord(
            facts.Id, facts.Type, facts.X, facts.Y, facts.Z, facts.Rotation, facts.Width, facts.Depth, 1,
            facts.CeilingAnchored, null, null, null, "", facts);
    }
}
