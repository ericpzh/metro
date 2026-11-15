using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// RCA 14 §1: a view record's **storey membership** is the source `storeyBand` of
    /// the module (or, for wall artwork, the band of its envelope midpoint) — never the
    /// raw saved Z and never the record's bounds. The Zoo 玻璃板 at −14 m hung above the
    /// −15 floor and disappeared from the active storey because the old `LevelsOf` read
    /// its raw bounds endpoints.
    /// </summary>
    public sealed class StationModuleLevelsTests {
        static StationLevelGrid Grid(int levelBase = 0, int storeyHeight = 5) =>
            StationLevelGrid.FromDocument(levelBase, storeyHeight);

        static ModuleFacts Facts(JObject json) => ModuleFactsReader.Read(json);

        static StationModuleRecord Record(JObject json) {
            var facts = Facts(json);
            return new StationModuleRecord(facts.Id, facts.Type, facts.X, facts.Y, facts.Z, facts.Rotation,
                facts.Width, facts.Depth, 1, facts.CeilingAnchored, Point(facts.From), Point(facts.To), null, "", facts);
        }

        static StationPoint? Point(ModuleFacts.Point point) =>
            point.HasValue ? new StationPoint(point.X, point.Y, point.Z) : (StationPoint?)null;

        static JObject Glass(int z, string variant = "3x2", int w = 3, int rot = 1) => new JObject {
            ["id"] = "glass-" + z, ["type"] = "glass", ["x"] = 78, ["y"] = 21, ["z"] = z,
            ["rot"] = rot, ["w"] = w, ["cfg"] = new JObject { ["variant"] = variant },
        };

        [Test]
        public void WallGlassBelongsToTheStoreyItsPaneIsOn() {
            var grid = Grid();
            // Zoo's authored glass: z = −14, 3×2, rot 1. The pane spans floor+1 … floor+3,
            // so its envelope midpoint (−12) bands to −15 — the active storey in image 3.
            var bands = StationModuleLevels.Of(Record(Glass(-14)), grid);
            CollectionAssert.AreEqual(new[] { -15 }, bands, "the −14 m glass is a −15 m storey piece");
            Assert.AreEqual(StationLevelSide.Active,
                StationVisibilityRules.LevelSide(bands, -15), "active at −15");
            Assert.AreEqual(StationLevelSide.Below,
                StationVisibilityRules.LevelSide(bands, -10), "one storey below −10, so it ghosts");
        }

        [Test]
        public void WallArtworkSlicesByItsPanelNotItsAnchor() {
            // A 1×2 pane bolted to a one-metre block: the saved cell is the block *less one*
            // (z = −11) while the glazing is the −10 storey. The raw band would read −15.
            var grid = Grid();
            var record = Record(Glass(-11, "1x2", 1));
            CollectionAssert.AreEqual(new[] { -10 }, StationModuleLevels.Of(record, grid),
                "the panel envelope, not the anchor cell, is the storey");
            Assert.AreEqual(-15, StationModuleLevels.Band(grid, record.Z),
                "the raw anchor bands one storey lower: this is the defect the panel rule fixes");
        }

        [Test]
        public void OrdinaryModulesUseTheirOwnStoreyBand() {
            var grid = Grid();
            var bench = new JObject {
                ["id"] = "bench-1", ["type"] = "bench", ["x"] = 4, ["y"] = 5, ["z"] = -14,
            };
            CollectionAssert.AreEqual(new[] { -15 }, StationModuleLevels.Of(Record(bench), grid));
            // A module on a differently based document follows that station's origin.
            var shifted = Grid(3, 5);
            var atMinusTwelve = JObject.Parse(bench.ToString());
            atMinusTwelve["z"] = -12;
            CollectionAssert.AreEqual(new[] { -12 }, StationModuleLevels.Of(Record(atMinusTwelve), shifted),
                "storeyBand(z, base) moves with the saved level base");
        }

        [Test]
        public void RunsKeepBothLandingBandsAndCollapseAOneStoreyRun() {
            var grid = Grid();
            var escalator = new JObject {
                ["id"] = "esc-1", ["type"] = "escalator", ["x"] = 0, ["y"] = 0, ["z"] = -20,
                ["from"] = new JObject { ["x"] = 0, ["y"] = 0, ["z"] = -17 },
                ["to"] = new JObject { ["x"] = 4, ["y"] = 0, ["z"] = -14 },
            };
            CollectionAssert.AreEqual(new[] { -20, -15 }, StationModuleLevels.Of(Record(escalator), grid),
                "a run spanning one storey boundary keeps both bands");
            var level = JObject.Parse(escalator.ToString());
            level["id"] = "walk-1";
            level["type"] = "walkway";
            level["from"]["z"] = -18;
            level["to"]["z"] = -16;
            CollectionAssert.AreEqual(new[] { -20 }, StationModuleLevels.Of(Record(level), grid),
                "a run inside one storey collapses to a single band");
        }

        [Test]
        public void CellHeightsBandTheSameWayAsModules() {
            var grid = Grid();
            Assert.AreEqual(-15, StationModuleLevels.Band(grid, -14), "a −14 cell is the −15 storey");
            Assert.AreEqual(-20, StationModuleLevels.Band(grid, -20));
            Assert.AreEqual(-15, StationModuleLevels.Band(grid, -15));
        }

        [Test]
        public void TheRegistryGhostsTheGlassOnTheStoreyAboveAndDrawsItOnItsOwn() {
            var grid = Grid();
            var bands = StationModuleLevels.Of(Record(Glass(-14)), grid);
            var registry = new StationVisibilityRegistry(Shader.Find("Universal Render Pipeline/Lit"));
            var root = new GameObject("glass target");
            try {
                var target = registry.Register(root.transform, StationPartRole.Prop, bands);
                registry.State.ShowLevels = true;
                registry.State.ActiveLevel = -15;
                registry.Apply();
                Assert.AreEqual(StationDrawMode.Base, target.LastMode, "visible on the −15 floor");
                Assert.IsTrue(registry.IsTargetPickable(target), "visible means pickable");

                registry.State.ActiveLevel = -10;
                registry.Apply();
                Assert.AreEqual(StationDrawMode.Ghost, target.LastMode,
                    "the TS reference ghosts a piece one storey below, and so does this");
            } finally {
                registry.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void RoomFactsKeepTheAuthoredPlanDepth() {
            var booth = Facts(JObject.Parse(
                "{\"id\":\"booth-277\",\"type\":\"booth\",\"x\":63,\"y\":33,\"z\":-15,\"w\":3,\"h\":3}"));
            Assert.AreEqual(3, booth.Width, "w is the booth's plan width");
            Assert.AreEqual(3, booth.Depth, "h is the booth's plan depth, not the default 1");

            var uneven = Facts(JObject.Parse(
                "{\"id\":\"booth-9\",\"type\":\"booth\",\"x\":0,\"y\":0,\"z\":0,\"w\":2,\"h\":4,\"d\":1}"));
            Assert.AreEqual(4, uneven.Depth, "h wins over a stray d on a room family");

            var room = Facts(JObject.Parse(
                "{\"id\":\"shop-1\",\"type\":\"shop\",\"x\":0,\"y\":0,\"z\":0,\"w\":5,\"h\":7}"));
            Assert.AreEqual(7, room.Depth, "a shop uses the same w × h rectangle");

            // Every other family keeps d semantics, including its 1 m fallback.
            var bench = Facts(JObject.Parse(
                "{\"id\":\"bench-1\",\"type\":\"bench\",\"x\":0,\"y\":0,\"z\":0,\"w\":2,\"d\":2}"));
            Assert.AreEqual(2, bench.Depth, "a bench still reads d");
        }
    }
}
