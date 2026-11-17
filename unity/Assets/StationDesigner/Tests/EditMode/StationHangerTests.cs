using System;
using Metro.App;
using Metro.Build;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §5: the steel hanger's body. The hanger used to be reported as an unverified
    /// reservation; the boxes are `sim/hangers.ts` `hangerBoxes`, so a block brush and another
    /// piece are held off the bar, the post and the foot exactly as the reference holds them.
    /// </summary>
    public sealed class StationHangerTests {
        StationGameHost host;
        GameObject hostObject;

        [SetUp]
        public void SetUp() {
            StationEditSession.Reset();
            StationToolSelection.Reset();
            hostObject = new GameObject(StationGameHost.ObjectName);
            host = hostObject.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            awake.Invoke(host, null);
            var opened = host.OpenDocument(Save(), "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
        }

        [TearDown]
        public void TearDown() {
            StationEditHost.ResetForTests();
            if (hostObject != null) UnityEngine.Object.DestroyImmediate(hostObject);
            hostObject = null;
            host = null;
            StationEditSession.Reset();
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        StationModuleRecord Hanger(string id) => host.Index.GetModule(id);

        [Test]
        public void ARoofHangerReservesItsBarNotItsWholeRunHeight() {
            var hanger = Hanger("hanger-roof");
            Assert.IsNotNull(hanger);
            Assert.IsTrue(StationFootprints.TryClearance(hanger, out var box, out var unsupported), unsupported);
            // w = 4 along x at rot 0: the bar spans the run, 0.2 m deep, at 4 m above the anchor.
            Assert.AreEqual(2, box.X0, 0.001);
            Assert.AreEqual(6, box.X1, 0.001);
            Assert.AreEqual(3.4, box.Y0, 0.001);
            Assert.AreEqual(3.6, box.Y1, 0.001);
            Assert.AreEqual(4.8, box.Z0, 0.001, "the beam hangs 0.2 m below its 4 m top");
            Assert.AreEqual(5.0, box.Z1, 0.001);
        }

        [Test]
        public void APostHangerCarriesItsPostAndFoot() {
            var hanger = Hanger("hanger-post");
            var boxes = StationHangerRules.Boxes(hanger);
            Assert.AreEqual(3, boxes.Count, "the bar, the post and its foot");
            Assert.IsTrue(StationFootprints.TryClearance(hanger, out var box, out var unsupported), unsupported);
            // The post hangs from the anchor's own level up to the bar top, so the union starts low.
            Assert.AreEqual(1.0, box.Z0, 0.001, "the post starts one course above the anchor");
            Assert.AreEqual(4.0, box.Z1, 0.001, "and reaches the 3 m bar top");
        }

        [Test]
        public void TheHangerClaimsItsLevelInsteadOfBeingReportedUnverified() {
            var world = StationCellEditWorld.Build(host.Index);
            Assert.IsFalse(world.Unverified.Contains("hanger-roof"), "the hanger's own boxes are known now");
            // The post hanger hangs from level 0 through level 3, so its cells are reserved there.
            var blocked = world.EquipmentBlockedAt(1);
            bool named = false;
            foreach (var cell in blocked) if (cell.X == 4 && cell.Y == 3) named = true;
            Assert.IsTrue(named, "the post's column is reserved on its own level");
        }

        /// <summary>
        /// A 6 × 6 pavement with one roof-mounted hanger over it and one post-mounted hanger
        /// beside it; nothing else competes for the space.
        /// </summary>
        static string Save() {
            var cells = new JArray();
            for (int x = 0; x < 6; x++) {
                for (int y = 0; y < 6; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            var modules = new JArray {
                new JObject {
                    ["id"] = "hanger-roof", ["type"] = "hanger", ["x"] = 2, ["y"] = 3, ["z"] = 0,
                    ["rot"] = 0, ["w"] = 4, ["cfg"] = new JObject { ["mount"] = "roof" },
                },
                new JObject {
                    ["id"] = "hanger-post", ["type"] = "hanger", ["x"] = 2, ["y"] = 3, ["z"] = 0,
                    ["rot"] = 0, ["w"] = 4, ["cfg"] = new JObject { ["mount"] = "post" },
                },
            };
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Hanger fixture", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            }.ToString(Newtonsoft.Json.Formatting.None);
        }
    }
}
