using System;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §5: the sign **layout model**. `StationSignRepair` is the settle/compact pass for an
    /// authored board — component widths by kind, the scale clamp, source-order packing with
    /// collision resolution, the panel's width, the edge shift and the per-component clamp. A fresh
    /// 标识 is born with `defaultSignLayout` (`StationSignLayouts`); this is what an *edited* board
    /// goes through, so a composed face lands on a legal panel.
    /// </summary>
    public sealed class StationSignRepairTests {
        static JObject Sign(params JObject[] front) {
            var boards = new JArray();
            foreach (var component in front) boards.Add(component);
            return new JObject {
                ["id"] = "sign-1", ["type"] = "sign", ["x"] = 4, ["y"] = 4, ["z"] = 1, ["rot"] = 0,
                ["cfg"] = new JObject {
                    ["mount"] = "wall",
                    ["front"] = boards,
                    ["back"] = new JArray(),
                },
            };
        }

        static JObject Component(string id, string kind, double x, double scale = 1) => new JObject {
            ["id"] = id, ["kind"] = kind, ["x"] = x, ["y"] = 0.2, ["scale"] = scale,
            ["side"] = "both",
            ["arrow"] = kind == "arrow" ? "left" : null,
        };

        [Test]
        public void AComposedBoardIsSettledOntoALegalPanel() {
            // Two arrows aimed at almost the same spot would overlap, so the settle pass pushes the
            // second clear of the first and puts both on the board's own centre line.
            var sign = Sign(Component("c1", "arrow", 1.6), Component("c2", "arrow", 1.62));
            var repaired = StationSignRepair.NormalizeJson(sign.ToString(Newtonsoft.Json.Formatting.None));
            var front = (JArray)JObject.Parse(repaired)["cfg"]["front"];
            Assert.AreEqual(2, front.Count, "both components survive");
            double first = (double)front[0]["x"], second = (double)front[1]["x"];
            Assert.Less(first, second, "they are packed left to right");
            Assert.GreaterOrEqual(second - first, 0.3, "and no longer overlap");
            foreach (var component in front) {
                Assert.AreEqual(0.2, (double)component["y"], 1e-9, "every component sits on the row");
                Assert.AreEqual("both", (string)component["side"], "and prints on both faces");
            }
        }

        [Test]
        public void TheScaleIsClampedToTheBoardsRange() {
            var sign = Sign(Component("c1", "arrow", 1.0, 9), Component("c2", "icon", 1.6, 0.01));
            var repaired = StationSignRepair.NormalizeJson(sign.ToString(Newtonsoft.Json.Formatting.None));
            var front = (JArray)JObject.Parse(repaired)["cfg"]["front"];
            Assert.AreEqual(2.0, (double)front[0]["scale"], 1e-9, "a huge scale clamps to 2");
            Assert.AreEqual(0.4, (double)front[1]["scale"], 1e-9, "and a tiny one to 0.4");
        }

        [Test]
        public void APerComponentSignSplitsByEachMarksOwnSide() {
            // Shape 3: the per-component era. A mark that names the **right** face prints on the
            // back; everything else prints on the front. Nothing is guessed.
            var frontMark = Component("c1", "arrow", 1.0);
            frontMark["side"] = "both";
            var backMark = Component("c2", "icon", 1.6);
            backMark["side"] = "right";
            var legacy = new JObject {
                ["id"] = "sign-old", ["type"] = "sign", ["x"] = 4, ["y"] = 4, ["z"] = 1, ["rot"] = 0,
                ["cfg"] = new JObject { ["components"] = new JArray(frontMark, backMark) },
            };
            var repaired = StationSignRepair.NormalizeJson(legacy.ToString(Newtonsoft.Json.Formatting.None));
            var cfg = JObject.Parse(repaired)["cfg"];
            Assert.AreEqual(1, ((JArray)cfg["front"]).Count, "the front mark stays on the front");
            Assert.AreEqual(1, ((JArray)cfg["back"]).Count, "and the right-face mark is the back");
            Assert.AreEqual("c2", (string)((JArray)cfg["back"])[0]["id"]);
        }

        [Test]
        public void ASignFromBeforeBoardsPrintsTheDefaultBoardOnItsFrontOnly() {
            // Shape 2: no front, no back, no components — the default board on the front and an
            // empty back, because a back nobody composed should not claim one.
            var bare = new JObject {
                ["id"] = "sign-bare", ["type"] = "sign", ["x"] = 4, ["y"] = 4, ["z"] = 1, ["rot"] = 0,
                ["cfg"] = new JObject(),
            };
            var repaired = StationSignRepair.NormalizeJson(bare.ToString(Newtonsoft.Json.Formatting.None));
            var cfg = JObject.Parse(repaired)["cfg"];
            Assert.Greater(((JArray)cfg["front"]).Count, 0, "the default board is printed");
            Assert.AreEqual(0, ((JArray)cfg["back"]).Count, "and the back stays empty");
        }
    }
}
