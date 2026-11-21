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

        [TestCase("ticket")]
        [TestCase("info")]
        public void LowerTiersKeepTheBoothAndRemoveOnlySmallTrim(string kind) {
            Assert.IsTrue(BoothModuleViews.TryBuild(Booth(2, 4, kind: kind), root.transform, materials, out var view, out var note), note);
            uint full = 0, simplified = 0;
            foreach (var filter in view.GetComponentsInChildren<MeshFilter>(true)) {
                var mesh = filter.sharedMesh;
                full += mesh.GetIndexCount(0, 0);
                simplified += mesh.GetIndexCount(0, mesh.lodCount - 1);
            }
            Assert.That(simplified, Is.GreaterThan(0));
            Assert.That(simplified, Is.LessThan(full));
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
