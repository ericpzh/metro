using System;
using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 20 §5 — the zone map and its labels, against the source's rules
    /// (`build/model/Zones.ts` `zoneMapFloorsAt` / `zoneRegionLabels`, `sim/zones.ts`
    /// `zoneDisplayIndexOf`) and against the renderer that draws them.
    ///
    /// The semantic fixture is one storey (level base 0, storey height 5, active level 0)
    /// holding every shape the rules distinguish:
    ///
    /// * two **disconnected paid areas** — the same label twice, one label each;
    /// * a **concave** unpaid U with its middle tile missing: the centroid falls in the
    ///   hole, so the anchor must snap to a region tile instead;
    /// * a **five-cell** platform area: below `LABEL_MIN_CELLS`, so no label;
    /// * a **room** (`store`) inside the paid side: its own colour and text, at the
    ///   display index that includes room purposes;
    /// * a floor under a **partial wall** (`half-wall:n`) — preserved — beside a floor
    ///   under a full block — buried;
    /// * a **raised floor** on the active band (`z = 1` still bands at 0), on supports
    ///   that are themselves covered and so never tinted;
    /// * an unpainted region that reads the **default category** (无分区);
    /// * a **rotated track bed** (`rot 1`, six cells running north), whose synthetic
    ///   restricted cells are included instead of the unrotated bounds;
    /// * a suspended ceiling, an opening ceiling, a track-finish coping and cover soil,
    ///   all of which are structure rather than floor.
    /// </summary>
    public sealed class StationZoneMapTests {
        const string FontPath = "Assets/StationDesigner/Fonts/NotoSansSC.ttf";

        /// <summary>Level base 0 / storey height 5: the fixture's active level is 0 (band 0).</summary>
        const int LevelBase = 0;
        const int StoreyHeight = 5;
        const int ActiveLevel = 0;

        static Font font;

        readonly List<GameObject> roots = new List<GameObject>();
        readonly List<StationWorldView> worlds = new List<StationWorldView>();

        [OneTimeSetUp]
        public void LoadFont() {
            font = AssetDatabase.LoadAssetAtPath<Font>(FontPath);
        }

        [SetUp]
        public void ResetOverlay() {
            PassengerPoseFeeds.Clear();
            StationOverlayRenderer.ClearLocaleOverride();
            StationOverlayRenderer.ApplyLocale("zh-CN");
        }

        [TearDown]
        public void Release() {
            for (int i = worlds.Count - 1; i >= 0; i--) {
                worlds[i]?.Dispose();
                worlds[i] = null;
            }
            worlds.Clear();
            for (int i = roots.Count - 1; i >= 0; i--) {
                if (roots[i]) Object.DestroyImmediate(roots[i]);
            }
            roots.Clear();
            PassengerPoseFeeds.Clear();
            StationOverlayRenderer.ClearLocaleOverride();
        }

        /* --------------------------------------------------------------- the fixture */

        static StationDocument Fixture() {
            var cells = new List<StationCellRecord>();
            // A — paid 3 × 3.
            for (int y = 0; y < 3; y++) {
                for (int x = 0; x < 3; x++) cells.Add(Cell(x, y, 0, "paid"));
            }
            // B — the second paid area, disconnected from A (x 3–5 are empty).
            for (int y = 0; y < 3; y++) {
                for (int x = 6; x < 9; x++) cells.Add(Cell(x, y, 0, "paid"));
            }
            // C — the concave unpaid U: 8 cells with (1,5) missing.
            cells.Add(Cell(0, 4, 0, "unpaid"));
            cells.Add(Cell(1, 4, 0, "unpaid"));
            cells.Add(Cell(2, 4, 0, "unpaid"));
            cells.Add(Cell(0, 5, 0, "unpaid"));
            cells.Add(Cell(2, 5, 0, "unpaid"));
            cells.Add(Cell(0, 6, 0, "unpaid"));
            cells.Add(Cell(1, 6, 0, "unpaid"));
            cells.Add(Cell(2, 6, 0, "unpaid"));
            // D — the five-cell platform area: one short of a label.
            cells.Add(Cell(6, 4, 0, "platform"));
            cells.Add(Cell(7, 4, 0, "platform"));
            cells.Add(Cell(8, 4, 0, "platform"));
            cells.Add(Cell(6, 5, 0, "platform"));
            cells.Add(Cell(7, 5, 0, "platform"));
            // E — the room: six cells carrying `room: store` on the paid side.
            cells.Add(Cell(10, 0, 0, "paid", "store"));
            cells.Add(Cell(11, 0, 0, "paid", "store"));
            cells.Add(Cell(10, 1, 0, "paid", "store"));
            cells.Add(Cell(11, 1, 0, "paid", "store"));
            cells.Add(Cell(10, 2, 0, "paid", "store"));
            cells.Add(Cell(11, 2, 0, "paid", "store"));
            // F — the floor under a partial wall: the half wall at z = 1 leaves it open.
            cells.Add(Cell(4, 7, 0, "restricted"));
            cells.Add(Cell(4, 7, 1, "", "", new[] { "half-wall:n" }));
            // G — the raised floor on the active band (z = 1 bands at 0) over six supports.
            for (int y = 5; y < 8; y++) {
                for (int x = 10; x < 12; x++) cells.Add(Cell(x, y, 0));
            }
            for (int y = 5; y < 8; y++) {
                for (int x = 10; x < 12; x++) cells.Add(Cell(x, y, 1, "restricted"));
            }
            // H — ceiling plates: exposed on top, still the ceiling.
            cells.Add(Cell(13, 0, 0, "paid", "", new[] { "suspended-ceiling" }, "ceil.baffle"));
            cells.Add(Cell(14, 0, 0, "paid", "", new[] { "opening-ceiling" }, "ceil.metal"));
            // I — a track bed at the foot of its column (floor) and the coping above it (buried).
            cells.Add(Cell(13, 2, 0, "paid", "", null, "floor.track"));
            cells.Add(Cell(13, 3, 0, "paid", "", null, "floor.track"));
            cells.Add(Cell(13, 3, 1, "paid", "", null, "floor.track"));
            // J — cover soil: solid, not walkable.
            cells.Add(Cell(13, 4, 0, "paid", "", null, "floor.soil"));
            // L — the default category: six unpainted cells.
            cells.Add(Cell(0, 9, 0));
            cells.Add(Cell(1, 9, 0));
            cells.Add(Cell(0, 10, 0));
            cells.Add(Cell(1, 10, 0));
            cells.Add(Cell(0, 11, 0));
            cells.Add(Cell(1, 11, 0));
            return Document(cells, new[] { Track(4, 9, 0, 6, 1, 1) });
        }

        static StationCellRecord Cell(int x, int y, int z, string zone = "", string room = "", string[] tags = null, string top = null) {
            var finish = string.IsNullOrEmpty(top)
                ? (IReadOnlyDictionary<string, string>)new Dictionary<string, string>(StringComparer.Ordinal)
                : new Dictionary<string, string>(StringComparer.Ordinal) { ["top"] = top };
            return new StationCellRecord(x, y, z, "full", "solid", zone, tags ?? Array.Empty<string>(), finish, room, "");
        }

        static StationModuleRecord Track(int x, int y, int z, int width, int depth, int rot) {
            var facts = new ModuleFacts {
                Id = "track-ns", Type = "track", X = x, Y = y, Z = z, Rotation = rot, Width = width, Depth = depth,
                Config = ModuleConfig.Empty,
            };
            return new StationModuleRecord("track-ns", "track", x, y, z, rot, width, depth, 1, false, null, null,
                Array.Empty<string>(), "", facts);
        }

        static StationDocument Document(IEnumerable<StationCellRecord> cells, IEnumerable<StationModuleRecord> modules) {
            var day = new StationDay(new StationSpan(0, 86400), new StationSpan(0, 0), new StationSpan(0, 0),
                new StationDemand(1, 1, 1), new StationDemand(1, 1, 1), 2026, 1, 1, Array.Empty<string>());
            return new StationDocument("zone map fixture", "", "guangzhou", 0, LevelBase, StoreyHeight, day,
                cells.ToArray(), modules.ToArray(), Array.Empty<StationLineRecord>(), 0, 0, StationSource.None, "", "");
        }

        /* ------------------------------------------------------------------ helpers */

        static string Key(StationZoneFloor floor) => floor.X + "," + floor.Y + "," + floor.Z;

        static bool HasFloor(IReadOnlyList<StationZoneFloor> floors, int x, int y, int z) =>
            floors.Any(floor => floor.X == x && floor.Y == y && floor.Z == z);

        static StationZoneLabel Find(IReadOnlyList<StationZoneLabel> labels, double x, double y, double z) =>
            labels.FirstOrDefault(label => Math.Abs(label.X - x) < 1e-9 && Math.Abs(label.Y - y) < 1e-9 && Math.Abs(label.Z - z) < 1e-9);

        static void AssertLabel(IReadOnlyList<StationZoneLabel> labels, string text, int cells, double x, double y, double z) {
            var label = Find(labels, x, y, z);
            Assert.AreNotEqual(default(StationZoneLabel), label, "no label anchored at " + x + "," + y + "," + z);
            Assert.AreEqual(text, label.Text, "text at " + x + "," + y + "," + z);
            Assert.AreEqual(cells, label.Cells, "cell count at " + x + "," + y + "," + z);
        }

        sealed class Built {
            public StationOverlayRenderer Overlay;
            public StationWorldView World;
            public StationOverlayRenderer.OverlayState State => Overlay.Current;
        }

        Built Build(StationDocument document) {
            var root = new GameObject("zone map fixture world");
            roots.Add(root);
            var overlay = new StationOverlayRenderer();
            var world = new StationWorldView(root.transform, "zone map fixture", new IStationViewRenderer[] { overlay },
                new StationViewAssets { Font = font, Shader = Shader.Find("Universal Render Pipeline/Unlit") });
            world.Build(document, new StationIndex(document));
            world.Activate();
            worlds.Add(world);
            return new Built { Overlay = overlay, World = world };
        }

        static bool CanPaint => font != null && SystemInfo.graphicsDeviceType != UnityEngine.Rendering.GraphicsDeviceType.Null;

        /* ------------------------------------------------------------ the floor rule */

        [Test]
        public void FloorsPaintTheEligibleFloorOfTheActiveStorey() {
            var document = Fixture();
            var floors = StationZoneMap.FloorsAt(document, ActiveLevel);

            Assert.AreEqual(57, floors.Count, "the fixture's tinted floor count changed");
            // Both paid areas, the concave U, the five-cell platform, the room and the
            // default-category patch are all floor.
            Assert.IsTrue(HasFloor(floors, 0, 0, 0), "the first paid area is floor");
            Assert.IsTrue(HasFloor(floors, 7, 1, 0), "the second paid area is floor");
            Assert.IsTrue(HasFloor(floors, 1, 4, 0), "the concave area's arm is floor");
            Assert.IsTrue(HasFloor(floors, 6, 5, 0), "the five-cell platform area is floor");
            Assert.IsTrue(HasFloor(floors, 10, 1, 0), "the room is floor");
            Assert.IsTrue(HasFloor(floors, 0, 10, 0), "the unpainted patch is floor");
            // The floor under the half wall survives, and the half wall itself is not floor.
            Assert.IsTrue(HasFloor(floors, 4, 7, 0), "a partial wall leaves the floor under it exposed");
            Assert.IsFalse(HasFloor(floors, 4, 7, 1), "the half wall itself is not a floor");
            // The raised floor is on the active band, and its supports are covered.
            Assert.IsTrue(HasFloor(floors, 10, 6, 1), "the raised floor at z = 1 belongs to band 0");
            Assert.IsFalse(HasFloor(floors, 10, 6, 0), "the raised floor's own support is buried");
            // Structure is never floor.
            Assert.IsFalse(HasFloor(floors, 13, 0, 0), "a suspended ceiling plate is not floor");
            Assert.IsFalse(HasFloor(floors, 14, 0, 0), "an opening-ceiling plate is not floor");
            Assert.IsFalse(HasFloor(floors, 13, 3, 0), "the bed under a track-finish coping is buried");
            Assert.IsFalse(HasFloor(floors, 13, 3, 1), "a track-finish coping on fill is not the foot of its column");
            Assert.IsFalse(HasFloor(floors, 13, 4, 0), "cover soil is solid but not walkable");
            Assert.IsTrue(HasFloor(floors, 13, 2, 0), "a track bed at the foot of its column is floor");
            // The floor's display categories, including the default category.
            Assert.AreEqual(0, floors.First(floor => floor.X == 0 && floor.Y == 10).Display, "an unpainted cell reads 无分区");
            Assert.AreEqual(3, floors.First(floor => floor.X == 0 && floor.Y == 0).Display, "a paid cell reads 付费区");
            Assert.AreEqual(6, floors.First(floor => floor.X == 10 && floor.Y == 1).Display, "a room cell reads 商店");
            Assert.AreEqual("store", floors.First(floor => floor.X == 10 && floor.Y == 1).PaintId);
        }

        [Test]
        public void FloorsFollowTheStoreyBand() {
            var document = Fixture();
            Assert.IsTrue(StationZoneMap.Floors(document).Any(floor => floor.Z == 1), "the whole-station list keeps the raised floor");
            Assert.AreEqual(0, StationZoneMap.FloorsAt(document, 5).Count, "band 5 has no floor in the fixture");
            Assert.AreEqual(0, StationZoneMap.FloorsAt(document, -5).Count, "band −5 has no floor in the fixture");
            // A storey off the five-metre ladder belongs to the band at or below it.
            var offGrid = Document(new[] { Cell(0, 0, -6, "paid"), Cell(1, 0, -6, "paid") }, Array.Empty<StationModuleRecord>());
            Assert.AreEqual(2, StationZoneMap.FloorsAt(offGrid, -8).Count, "z = −6 belongs to the band of −8");
            Assert.AreEqual(2, StationZoneMap.FloorsAt(offGrid, -6).Count, "asking for −6 asks for its own band");
            Assert.AreEqual(0, StationZoneMap.FloorsAt(offGrid, 0).Count, "the storey above is untouched");
        }

        [Test]
        public void AFullBlockCoversTheFloorButAPartialOneDoesNot() {
            var fullBlock = Document(new[] {
                Cell(0, 0, 0, "paid"),
                Cell(0, 0, 1, "paid"),
            }, Array.Empty<StationModuleRecord>());
            var covered = StationZoneMap.FloorsAt(fullBlock, 0);
            Assert.IsFalse(HasFloor(covered, 0, 0, 0), "a full block leaves no exposed floor under it");
            // The block's own top is walkable floor — the source's rule ("a wall course
            // the crowd can walk on top of is floor"), so the storey's one floor is z = 1.
            Assert.AreEqual(1, covered.Count, "only the covering block's own top is floor");
            Assert.IsTrue(HasFloor(covered, 0, 0, 1), "the block's top is floor");

            foreach (var tag in new[] { new[] { "half-wall:n" }, new[] { "half-wall:e" }, new[] { "half-wall:s" }, new[] { "half-wall:w" },
                new[] { "half-corner:n" }, new[] { "half-corner:e" }, new[] { "half-corner:s" }, new[] { "half-corner:w" },
                new[] { "half-wall:n", "half-corner:s" } }) {
                var thin = Document(new[] {
                    Cell(0, 0, 0, "paid"),
                    Cell(0, 0, 1, "paid", "", tag),
                }, Array.Empty<StationModuleRecord>());
                var floors = StationZoneMap.FloorsAt(thin, 0);
                Assert.AreEqual(1, floors.Count, string.Join("+", tag) + " leaves the floor under it floor");
                Assert.IsTrue(HasFloor(floors, 0, 0, 0), string.Join("+", tag) + " preserves the floor");
                Assert.IsFalse(HasFloor(floors, 0, 0, 1), string.Join("+", tag) + " is not floor itself");
            }

            // A lower wedge's *slope* is the cell's own top face, so the source counts the
            // wedge as floor too, beside the floor it leaves open underneath.
            var wedge = Document(new[] {
                Cell(0, 0, 0, "paid"),
                Cell(0, 0, 1, "paid", "", new[] { "tri-lower:s" }),
            }, Array.Empty<StationModuleRecord>());
            var wedgeFloors = StationZoneMap.FloorsAt(wedge, 0);
            Assert.AreEqual(2, wedgeFloors.Count, "a lower wedge is floor and leaves the floor under it open");
            Assert.IsTrue(HasFloor(wedgeFloors, 0, 0, 0), "the floor under a lower wedge stays floor");
            Assert.IsTrue(HasFloor(wedgeFloors, 0, 0, 1), "a lower wedge's own slope is floor");
        }

        [Test]
        public void RotatedTrackBedsAddTheirOwnRestrictedFloorCells() {
            var document = Document(Array.Empty<StationCellRecord>(), new[] { Track(4, 9, 0, 6, 1, 1) });
            var floors = StationZoneMap.Floors(document);
            Assert.AreEqual(6, floors.Count, "one cell per track bed cell");
            for (int y = 9; y < 15; y++) {
                Assert.IsTrue(HasFloor(floors, 4, y, 0), "the rotated bed covers (4," + y + ")");
            }
            // The unrotated w × d rectangle would have painted a strip across x.
            for (int x = 5; x < 10; x++) {
                Assert.IsFalse(HasFloor(floors, x, 9, 0), "(" + x + ",9) is outside the rotated bed");
            }
            Assert.IsTrue(floors.All(floor => floor.FromTrack && floor.PaintId == "restricted"),
                "synthetic track floor reads 设备区");
            var labels = StationZoneMap.Labels(floors, "zh-CN");
            Assert.AreEqual(1, labels.Count, "a six-cell bed earns one label");
            AssertLabel(labels, "设备区", 6, 4.5, 11.5, 1.06);
        }

        /* ------------------------------------------------------------ the palette */

        [Test]
        public void DisplayZoneIndexIncludesRoomPurposesAndMatchesThePalette() {
            Assert.AreEqual(0, StationZoneMap.DisplayZoneIndex("", ""), "an unlabelled cell reads 无分区");
            Assert.AreEqual(1, StationZoneMap.DisplayZoneIndex("outside", ""));
            Assert.AreEqual(2, StationZoneMap.DisplayZoneIndex("unpaid", ""));
            Assert.AreEqual(3, StationZoneMap.DisplayZoneIndex("paid", ""));
            Assert.AreEqual(4, StationZoneMap.DisplayZoneIndex("platform", ""));
            Assert.AreEqual(5, StationZoneMap.DisplayZoneIndex("restricted", ""));
            Assert.AreEqual(6, StationZoneMap.DisplayZoneIndex("paid", "store"), "a room purpose wins over the fare zone");
            Assert.AreEqual(7, StationZoneMap.DisplayZoneIndex("paid", "toilet"));
            Assert.AreEqual(8, StationZoneMap.DisplayZoneIndex("paid", "office"));
            Assert.AreEqual(0, StationZoneMap.DisplayZoneIndex("not-a-zone", ""), "an unknown label falls back to 无分区");

            // `ZONE_PAINT_LIST`: the six fare colours first, then the room purposes.
            var expected = new[] {
                ("none", "无分区", "No zone", 0x9aa2ab),
                ("outside", "站外", "Outside", 0x5b6472),
                ("unpaid", "非付费区", "Unpaid area", 0x3fb27f),
                ("paid", "付费区", "Paid area", 0x4ea8ff),
                ("platform", "站台", "Platform", 0xf2a541),
                ("restricted", "设备区", "Equipment area", 0xe4572e),
                ("store", "商店", "Store", 0xb07cc6),
                ("toilet", "厕所", "Restroom", 0x5fb7a6),
                ("office", "办公室", "Office", 0xd9a24b),
            };
            Assert.AreEqual(expected.Length, StationZoneMap.CategoryCount, "the palette size changed");
            for (int i = 0; i < expected.Length; i++) {
                var category = StationZoneMap.Category(i);
                Assert.AreEqual(i, category.Index);
                Assert.AreEqual(expected[i].Item1, category.Id, "id at " + i);
                Assert.AreEqual(expected[i].Item2, category.LabelZh, "Chinese label at " + i);
                Assert.AreEqual(expected[i].Item3, category.LabelEn, "English label at " + i);
                Assert.AreEqual(expected[i].Item4, category.Rgb, "colour at " + i);
                Assert.AreEqual(i, StationZoneMap.DisplayIndexOf(category.Id), "the palette's own id round-trips at " + i);
                // The tint the floor mesh wears and the opaque border the plate draws agree.
                Assert.AreEqual(category.Colour.r, StationOverlayRenderer.ZonePalette[i].r, "tint red at " + i);
                Assert.AreEqual(category.Colour.g, StationOverlayRenderer.ZonePalette[i].g, "tint green at " + i);
                Assert.AreEqual(category.Colour.b, StationOverlayRenderer.ZonePalette[i].b, "tint blue at " + i);
                Assert.AreEqual(77, (int)StationOverlayRenderer.ZonePalette[i].a, "the tint is the source's 0.3 opacity at " + i);
                Assert.AreEqual(255, (int)category.Colour.a, "the border is opaque at " + i);
            }
        }

        /* ------------------------------------------------------------ the labels */

        [Test]
        public void LabelsAreOnePerContiguousRegionOfSixCells() {
            var document = Fixture();
            var labels = StationZoneMap.Labels(StationZoneMap.FloorsAt(document, ActiveLevel), "zh-CN");

            Assert.AreEqual(7, labels.Count, "the fixture's labelled regions changed: " + string.Join(" | ", labels));
            // The two paid areas are separate regions with the same text, one label each.
            AssertLabel(labels, "付费区", 9, 1.5, 1.5, 1.06);
            AssertLabel(labels, "付费区", 9, 7.5, 1.5, 1.06);
            Assert.AreEqual(2, labels.Count(label => label.Text == "付费区"), "each disconnected paid area gets its own label");
            // The concave region's centroid is the missing tile; the anchor snaps to a region tile.
            AssertLabel(labels, "非付费区", 8, 0.5, 5.5, 1.06);
            Assert.AreEqual(0, labels.Count(label => Math.Abs(label.X - 1.5) < 1e-9 && Math.Abs(label.Y - 5.5) < 1e-9),
                "no label may sit in the concave region's hole");
            // The room reads its own colour and text.
            var room = Find(labels, 10.5, 1.5, 1.06);
            Assert.AreEqual("商店", room.Text);
            Assert.AreEqual(6, room.Display);
            Assert.AreEqual("store", room.Category);
            Assert.AreEqual(6, room.Cells);
            // The raised floor's label sits on its own course, 0.06 m over z = 1's top.
            AssertLabel(labels, "设备区", 6, 10.5, 6.5, 2.06);
            Assert.AreEqual(1, labels.Count(label => label.Display == 5 && Math.Abs(label.Z - 2.06) < 1e-9));
            // The default category is labelled, and the five-cell area is not.
            AssertLabel(labels, "无分区", 6, 0.5, 10.5, 1.06);
            Assert.AreEqual(1, labels.Count(label => label.Display == 0));
            Assert.AreEqual(0, labels.Count(label => label.Display == 4), "a five-cell area is too small for a label");
            // Every label is anchored on a floor tile of its own region and course.
            var floors = StationZoneMap.FloorsAt(document, ActiveLevel);
            foreach (var label in labels) {
                Assert.IsTrue(floors.Any(floor => floor.X == label.CellX && floor.Y == label.CellY && floor.Z == label.CellZ),
                    "the label at " + label + " is anchored off the map");
                Assert.AreEqual(label.Display, StationZoneMap.DisplayZoneIndex(
                    floors.First(floor => floor.X == label.CellX && floor.Y == label.CellY && floor.Z == label.CellZ).Zone,
                    floors.First(floor => floor.X == label.CellX && floor.Y == label.CellY && floor.Z == label.CellZ).Room),
                    "the label's category is its anchor tile's");
            }
        }

        [Test]
        public void LabelsNeedSixCellsOnOneExactCourse() {
            // Five cells: no label.
            var five = Document(new[] {
                Cell(0, 0, 0, "platform"), Cell(1, 0, 0, "platform"), Cell(2, 0, 0, "platform"),
                Cell(0, 1, 0, "platform"), Cell(1, 1, 0, "platform"),
            }, Array.Empty<StationModuleRecord>());
            Assert.AreEqual(5, StationZoneMap.FloorsAt(five, 0).Count);
            Assert.AreEqual(0, StationZoneMap.Labels(StationZoneMap.FloorsAt(five, 0), "zh-CN").Count, "five cells earn no label");

            // The sixth cell makes it a region.
            var six = Document(new[] {
                Cell(0, 0, 0, "platform"), Cell(1, 0, 0, "platform"), Cell(2, 0, 0, "platform"),
                Cell(0, 1, 0, "platform"), Cell(1, 1, 0, "platform"), Cell(2, 1, 0, "platform"),
            }, Array.Empty<StationModuleRecord>());
            var labels = StationZoneMap.Labels(StationZoneMap.FloorsAt(six, 0), "zh-CN");
            Assert.AreEqual(1, labels.Count, "six cells earn one label");
            AssertLabel(labels, "站台", 6, 1.5, 1.5, 1.06);

            // Three cells on each of two courses are two three-cell regions, never one —
            // the flood is four-connected **on the same exact course**, so plan-adjacent
            // tiles one storey apart cannot merge into a label.
            var stacked = Document(new[] {
                Cell(0, 0, 0, "paid"), Cell(1, 0, 0, "paid"), Cell(2, 0, 0, "paid"),
                Cell(0, 1, 1, "paid"), Cell(1, 1, 1, "paid"), Cell(2, 1, 1, "paid"),
            }, Array.Empty<StationModuleRecord>());
            Assert.AreEqual(6, StationZoneMap.FloorsAt(stacked, 0).Count, "both courses are on the band");
            Assert.AreEqual(0, StationZoneMap.Labels(StationZoneMap.FloorsAt(stacked, 0), "zh-CN").Count,
                "the flood is four-connected on the same exact course");
        }

        [Test]
        public void LabelsAreLocalizedWithoutMovingTheAnchor() {
            var document = Fixture();
            var floors = StationZoneMap.FloorsAt(document, ActiveLevel);
            var chinese = StationZoneMap.Labels(floors, "zh-CN");
            var english = StationZoneMap.Labels(floors, "en");

            Assert.AreEqual(chinese.Count, english.Count, "a language switch must not change the map");
            for (int i = 0; i < chinese.Count; i++) {
                Assert.AreEqual(chinese[i].X, english[i].X, 1e-12, "anchor x at " + i);
                Assert.AreEqual(chinese[i].Y, english[i].Y, 1e-12, "anchor y at " + i);
                Assert.AreEqual(chinese[i].Z, english[i].Z, 1e-12, "anchor z at " + i);
                Assert.AreEqual(chinese[i].Cells, english[i].Cells, "cells at " + i);
                Assert.AreEqual(chinese[i].Display, english[i].Display, "category at " + i);
                Assert.AreEqual(chinese[i].Rgb(), english[i].Rgb(), "colour at " + i);
            }
            CollectionAssert.AreEquivalent(
                new[] { "付费区", "付费区", "非付费区", "商店", "设备区", "无分区", "设备区" },
                chinese.Select(label => label.Text).ToArray(), "the Chinese names changed");
            CollectionAssert.AreEquivalent(
                new[] { "Paid area", "Paid area", "Unpaid area", "Store", "Equipment area", "No zone", "Equipment area" },
                english.Select(label => label.Text).ToArray(), "the English names changed");
            Assert.AreEqual("付费区", chinese[0].Text, "the first label is the first paid area's");
            Assert.AreEqual("Paid area", english[0].Text);
        }

        /* ------------------------------------------------------------- the renderer */

        [Test]
        public void OverlayTintsTheSameFloorsTheLabelsRead() {
            var built = Build(Fixture());
            built.Overlay.SetView(zones: true, density: false, level: ActiveLevel);
            var state = built.State;

            Assert.AreEqual(57, state.ZoneCells, "the tint covers every eligible floor cell");
            Assert.AreEqual(7, state.LabelCount, "the overlay reads the same label list as the map");
            Assert.AreEqual(6, state.ZoneDrawCalls, "one merged mesh per palette category present");
            Assert.AreEqual(
                new[] { "付费区", "付费区", "非付费区", "商店", "设备区", "无分区", "设备区" },
                state.LabelTexts.ToArray(), "the drawn labels and their order are the map's");
            // The category meshes carry the palette tint at the source's 0.3 opacity and
            // draw in the zone overlay's own sorting slot.
            for (int category = 0; category < StationZoneMap.CategoryCount; category++) {
                var go = state.ZoneObjects.FirstOrDefault(item => item != null && item.name == "zone " + category);
                if (go == null) {
                    Assert.AreEqual(0, FixtureCategoryCount(category), "category " + category + " has floor cells but no mesh");
                    continue;
                }
                var renderer = go.GetComponent<MeshRenderer>();
                var material = renderer.sharedMaterial;
                var tint = StationZoneMap.Category(category).Tint;
                Assert.AreEqual(77f / 255f, MaterialAlpha(material), .02f, "category " + category + " tint alpha");
                Assert.AreEqual(tint.r, StationOverlayRenderer.ZonePalette[category].r, "category " + category + " palette red");
                Assert.AreEqual(tint.g, StationOverlayRenderer.ZonePalette[category].g, "category " + category + " palette green");
                Assert.AreEqual(tint.b, StationOverlayRenderer.ZonePalette[category].b, "category " + category + " palette blue");
                Assert.AreEqual(StationOverlayRenderer.ZoneSortingOrder, renderer.sortingOrder, "the tint's sorting slot");
            }
            // A density refresh is a different layer, but a zone toggle hides without a rebuild.
            var meshes = state.ZoneMeshes.ToArray();
            built.Overlay.SetView(zones: false, density: false, level: ActiveLevel);
            Assert.AreEqual(0, state.ZoneCells, "turning the map off drops its geometry");
            built.Overlay.SetView(zones: true, density: false, level: ActiveLevel);
            Assert.AreEqual(meshes.Length, state.ZoneMeshes.Count, "turning it back on rebuilds the same map");
            Assert.AreNotSame(meshes[0], state.ZoneMeshes[0], "a hidden-then-shown layer is a fresh build");
        }

        static int FixtureCategoryCount(int category) {
            var document = Fixture();
            return StationZoneMap.FloorsAt(document, ActiveLevel).Count(floor => floor.Display == category);
        }

        static float MaterialAlpha(Material material) {
            if (material == null) return -1f;
            return material.HasProperty("_BaseColor") ? material.GetColor("_BaseColor").a : material.color.a;
        }

        [Test]
        public void LabelPlatesLieFlatAtFloorPlusSixCentimetres() {
            var built = Build(Fixture());
            built.Overlay.SetView(zones: true, density: false, level: ActiveLevel);
            var state = built.State;
            if (!CanPaint) Assert.Ignore("the label plates need a font and a graphics device");
            Assert.IsEmpty(state.PainterNote, "the plate painter reported " + state.PainterNote);
            Assert.AreEqual(7, state.LabelPlates.Count, "one plate per label");

            // The plate is the source's 3.2 × 1.2 m quad, flat and facing up.
            var mesh = state.PlateMesh;
            Assert.IsNotNull(mesh, "the shared plate mesh is missing");
            Assert.AreEqual(3.2f, mesh.bounds.size.x, 1e-4, "plate width");
            Assert.AreEqual(1.2f, mesh.bounds.size.z, 1e-4, "plate depth");
            Assert.AreEqual(0f, mesh.bounds.size.y, 1e-4, "the plate has no thickness");
            foreach (var normal in mesh.normals) Assert.AreEqual(Vector3.up, normal, "the plate faces up");
            // uv (0,0) is the document (−x, −y) corner and uv (1,1) the (+x, +y) corner,
            // so the glyph rows read upright from above.
            var vertices = mesh.vertices;
            var uvs = mesh.uv;
            for (int i = 0; i < vertices.Length; i++) {
                Assert.AreEqual(vertices[i].z < 0f ? 0f : 1f, uvs[i].y, 1e-4, "uv v follows the plan y of the plate");
                Assert.AreEqual(vertices[i].x < 0f ? 0f : 1f, uvs[i].x, 1e-4, "uv u follows the plan x of the plate");
            }

            // The anchors are the map's, converted once at the plate: document (x, y, z)
            // → Unity (x, z, y).
            var expected = new[] {
                new Vector3(1.5f, 1.06f, 1.5f), new Vector3(7.5f, 1.06f, 1.5f), new Vector3(.5f, 1.06f, 5.5f),
                new Vector3(10.5f, 1.06f, 1.5f), new Vector3(10.5f, 2.06f, 6.5f), new Vector3(.5f, 1.06f, 10.5f),
                new Vector3(4.5f, 1.06f, 11.5f),
            };
            for (int i = 0; i < state.LabelPlates.Count; i++) {
                var plate = state.LabelPlates[i];
                Assert.IsTrue(plate.activeInHierarchy, "plate " + i + " is not shown");
                Assert.AreEqual(expected[i].x, plate.transform.position.x, 1e-4, "plate " + i + " world x");
                Assert.AreEqual(expected[i].y, plate.transform.position.y, 1e-4, "plate " + i + " world y (elevation)");
                Assert.AreEqual(expected[i].z, plate.transform.position.z, 1e-4, "plate " + i + " world z (plan y)");
                Assert.AreEqual(Quaternion.identity, plate.transform.rotation, "the plate lies in world axes");
                Assert.IsFalse(plate.GetComponent<Collider>(), "an overlay plate is never a collider");
            }
            // The plate materials are shared by locale + category, not minted per label.
            var paidPlates = state.LabelPlates.Where((plate, index) => state.Labels[index].Display == 3).ToArray();
            Assert.AreEqual(2, paidPlates.Length);
            Assert.AreSame(paidPlates[0].GetComponent<MeshRenderer>().sharedMaterial,
                paidPlates[1].GetComponent<MeshRenderer>().sharedMaterial, "two paid labels share one material");
            Assert.AreEqual(1, state.LabelMaterials.Count(pair => pair.Value.Display == 3), "one paid plate material");
        }

        [Test]
        public void DensityRefreshKeepsZoneGeometryAndAnchors() {
            var built = Build(Fixture());
            var overlay = built.Overlay;
            overlay.SetView(zones: true, density: true, level: ActiveLevel);
            var state = built.State;
            Assert.AreEqual(57, state.ZoneCells);
            Assert.AreEqual(7, state.LabelCount);
            var zoneMeshes = state.ZoneMeshes.ToArray();
            var vertices = zoneMeshes.Select(mesh => mesh.vertices).ToArray();
            var plates = state.LabelPlates.ToArray();
            var positions = plates.Select(plate => plate.transform.position).ToArray();
            var labels = state.Labels.ToArray();
            var texts = state.LabelTexts.ToArray();

            // Publish a crowd on the active storey so the heat map really paints.
            PassengerPoseFeeds.SetSource(new DelegatePassengerPoseFeed(poses => {
                poses.Add(new PassengerPose { X = 0.5, Y = 0.5, Z = 0.0, Visible = true });
                poses.Add(new PassengerPose { X = 0.5, Y = 0.5, Z = 0.0, Visible = true });
                poses.Add(new PassengerPose { X = 7.5, Y = 1.5, Z = 0.0, Visible = true });
                return true;
            }));
            for (int i = 0; i < 4; i++) overlay.Tick(StationOverlayRenderer.DensityInterval + .01f);

            Assert.Greater(state.DensityCells, 0, "the density layer did not paint");
            Assert.AreEqual(zoneMeshes.Length, state.ZoneMeshes.Count, "a density refresh rebuilt the zone mesh count");
            for (int i = 0; i < zoneMeshes.Length; i++) {
                Assert.AreSame(zoneMeshes[i], state.ZoneMeshes[i], "a density refresh replaced zone mesh " + i);
                CollectionAssert.AreEqual(vertices[i], state.ZoneMeshes[i].vertices, "zone mesh " + i + " moved");
            }
            Assert.AreEqual(labels.Length, state.Labels.Count, "a density refresh changed the labels");
            for (int i = 0; i < labels.Length; i++) {
                Assert.AreEqual(labels[i].X, state.Labels[i].X, 1e-12, "label " + i + " anchor x");
                Assert.AreEqual(labels[i].Y, state.Labels[i].Y, 1e-12, "label " + i + " anchor y");
                Assert.AreEqual(labels[i].Z, state.Labels[i].Z, 1e-12, "label " + i + " anchor z");
                Assert.AreEqual(texts[i], state.LabelTexts[i], "label " + i + " text");
            }
            if (state.LabelPlates.Count > 0) {
                Assert.AreEqual(plates.Length, state.LabelPlates.Count, "a density refresh rebuilt the plates");
                for (int i = 0; i < plates.Length; i++) {
                    Assert.AreSame(plates[i], state.LabelPlates[i], "a density refresh replaced plate " + i);
                    Assert.AreEqual(positions[i], state.LabelPlates[i].transform.position, "plate " + i + " moved");
                }
            }

            // Turning the heat map off leaves the zone layer untouched.
            overlay.SetView(zones: true, density: false, level: ActiveLevel);
            Assert.AreEqual(0, state.DensityCells, "the heat map was not dropped");
            Assert.AreEqual(57, state.ZoneCells, "turning density off dropped the zone map");
            Assert.AreSame(zoneMeshes[0], state.ZoneMeshes[0], "turning density off rebuilt the zone mesh");
        }

        [Test]
        public void OverlayHidesWithoutDiscardingTheMap() {
            var built = Build(Fixture());
            var overlay = built.Overlay;
            overlay.SetView(zones: true, density: false, level: ActiveLevel);
            var state = built.State;
            var meshes = state.ZoneMeshes.ToArray();
            var labels = state.Labels.ToArray();
            bool hasPlates = state.LabelPlates.Count > 0;

            overlay.SetHidden(true);
            Assert.IsTrue(state.Hidden, "the overlay did not adopt 隐藏UI");
            Assert.IsFalse(state.ZoneRoot.gameObject.activeSelf, "the tint root stayed on screen with Hide UI");
            if (hasPlates) Assert.IsFalse(state.LabelRoot.gameObject.activeSelf, "the label root stayed on screen with Hide UI");
            Assert.IsTrue(state.ZoneObjects.All(go => go == null || !go.activeInHierarchy), "a tint object stayed on screen with Hide UI");
            if (hasPlates) Assert.IsTrue(state.LabelPlates.All(go => !go.activeInHierarchy), "the labels stayed on screen with Hide UI");
            overlay.Tick(.5f);
            Assert.AreEqual(meshes.Length, state.ZoneMeshes.Count, "hiding dropped the zone mesh");
            Assert.AreEqual(labels.Length, state.LabelCount, "hiding dropped the labels");

            overlay.SetHidden(false);
            Assert.IsTrue(state.ZoneRoot.gameObject.activeSelf, "the tint root did not come back");
            Assert.IsTrue(state.ZoneObjects.All(go => go != null && go.activeInHierarchy), "the tint did not come back");
            if (hasPlates) {
                Assert.IsTrue(state.LabelRoot.gameObject.activeSelf, "the label root did not come back");
                Assert.IsTrue(state.LabelPlates.All(go => go.activeInHierarchy), "the labels did not come back");
            }
            Assert.AreSame(meshes[0], state.ZoneMeshes[0], "coming back rebuilt the zone mesh");

            // A level change with no floor empties the map instead of leaving the old storey's paint.
            overlay.SetView(zones: true, density: false, level: 5);
            Assert.AreEqual(0, state.ZoneCells, "the old storey's tint survived the level change");
            Assert.AreEqual(0, state.LabelCount, "the old storey's labels survived the level change");
            Assert.AreEqual(0, state.ZoneMeshes.Count);
            overlay.SetView(zones: true, density: false, level: ActiveLevel);
            Assert.AreEqual(57, state.ZoneCells, "the fixture's storey did not come back");
        }

        [Test]
        public void LabelPlatesPaintReadableGlyphs() {
            if (!CanPaint) Assert.Ignore("glyph pixels need a font and a graphics device");
            var built = Build(Fixture());
            var overlay = built.Overlay;
            overlay.SetView(zones: true, density: false, level: ActiveLevel);
            var state = built.State;
            Assert.IsEmpty(state.PainterNote, "the plate painter reported " + state.PainterNote);
            Assert.AreEqual(7, state.LabelPlates.Count, "one painted plate per label");
            Assert.Greater(state.LabelInk, 0, "no plate painted glyph pixels");

            var paid = state.LabelMaterials.Values.First(plate => plate.Display == 3);
            Assert.AreEqual("zh-CN", paid.Locale);
            Assert.AreEqual(StationZoneLabelPainter.Width, paid.Texture.width, "the source's 256 px plate");
            Assert.AreEqual(StationZoneLabelPainter.Height, paid.Texture.height, "the source's 96 px plate");
            Assert.Greater(paid.Ink, 20, "the paid plate's white name is missing: " + paid);
            var pixels = paid.Texture.GetPixels32();
            var distinct = new HashSet<int>();
            foreach (var pixel in pixels) distinct.Add((pixel.r << 16) | (pixel.g << 8) | pixel.b | (pixel.a << 24));
            Assert.Greater(distinct.Count, 8, "the plate is a flat colour, not glyphs: " + paid);

            // A language switch repaints the plate in English — CJK and English both carry ink.
            StationOverlayRenderer.ApplyLocale("en");
            overlay.Tick(.1f);
            Assert.AreEqual("en", state.Locale, "the overlay did not adopt the English locale");
            Assert.AreEqual("Paid area", state.LabelTexts[0], "the drawn text did not switch language");
            var english = state.LabelMaterials.Values.FirstOrDefault(plate => plate.Display == 3 && plate.Locale == "en");
            Assert.IsNotNull(english, "the English plate was not painted");
            Assert.Greater(english.Ink, 20, "the English plate's white name is missing: " + english);
        }

        [Test]
        public void OverlayStatePublishesLabelDiagnostics() {
            var built = Build(Fixture());
            built.Overlay.SetView(zones: true, density: false, level: ActiveLevel);
            var json = StationOverlayRenderer.StateJson();
            Assert.IsTrue((bool)json["zones"], "the zones flag is missing from state.overlays");
            Assert.AreEqual(57, (int)json["zoneCells"], "zoneCells");
            Assert.AreEqual(7, (int)json["labelCount"], "labelCount");
            Assert.AreEqual(6, (int)json["zoneDrawCalls"], "one zone draw call per category");
            Assert.AreEqual("zh-CN", (string)json["locale"], "the label locale");
            var texts = (JArray)json["labelTexts"];
            Assert.AreEqual(7, texts.Count, "labelTexts");
            Assert.AreEqual("付费区", (string)texts[0], "the first label text");
            var labels = (JArray)json["labels"];
            Assert.AreEqual(7, labels.Count, "labels");
            var paid = labels.Children<JObject>().First(label => (string)label["category"] == "paid");
            Assert.AreEqual("付费区", (string)paid["text"], "text");
            Assert.AreEqual(9, (int)paid["cells"], "cells");
            Assert.AreEqual(1.5, (double)paid["x"], 1e-6, "document x");
            Assert.AreEqual(1.5, (double)paid["y"], 1e-6, "document y");
            Assert.AreEqual(1.06, (double)paid["z"], 1e-6, "document z");
            Assert.AreEqual(3, (int)paid["zone"], "display zone index");
            Assert.AreEqual("#4ea8ff", (string)paid["colour"], "the palette colour");
            if (built.State.LabelPlates.Count > 0) Assert.Greater((int)json["labelInk"], 0, "the plates reported no ink");
            // The contributor publishes the same payload under the documented key.
            var contributor = new StationOverlayStateContributor();
            Assert.AreEqual("overlays", contributor.Key, "the state key moved");
            Assert.AreEqual((int)json["labelCount"], (int)contributor.BuildPayload(built.World.Document, built.World.Index)["labelCount"]);
        }

        [Test]
        public void IndexedFloorsAtMatchesDocumentScanExactly() {
            var doc = Fixture();
            var index = new StationIndex(doc);
            var slow = StationZoneMap.FloorsAt(doc, ActiveLevel);
            var fast = StationZoneMap.FloorsAt(doc, index, ActiveLevel);
            Assert.AreEqual(slow.Count, fast.Count, "indexed FloorsAt cell count mismatch");
            var slowSet = new HashSet<(int, int, int, int)>(slow.Select(c => (c.X, c.Y, c.Z, c.Display)));
            var fastSet = new HashSet<(int, int, int, int)>(fast.Select(c => (c.X, c.Y, c.Z, c.Display)));
            Assert.IsTrue(slowSet.SetEquals(fastSet), "indexed FloorsAt cells differ from full scan");

            var emptySlow = StationZoneMap.FloorsAt(doc, ActiveLevel + StoreyHeight);
            var emptyFast = StationZoneMap.FloorsAt(doc, index, ActiveLevel + StoreyHeight);
            Assert.AreEqual(emptySlow.Count, emptyFast.Count);
        }

        [Test]
        public void ZoneOverlayCachesVisitedBandsAndPreservesStateAcrossSwitches() {
            var built = Build(Fixture());
            var overlay = built.Overlay;
            overlay.SetView(zones: true, density: false, level: ActiveLevel);
            var state = built.State;
            Assert.AreEqual(57, state.ZoneCells);
            Assert.AreEqual(7, state.LabelCount);
            var firstMesh = state.ZoneMeshes[0];

            // Switching to an empty band and back should reuse the cached band mesh instance.
            overlay.SetView(zones: true, density: false, level: ActiveLevel + StoreyHeight);
            Assert.AreEqual(0, state.ZoneCells);
            overlay.SetView(zones: true, density: false, level: ActiveLevel);
            Assert.AreEqual(57, state.ZoneCells);
            Assert.AreEqual(7, state.LabelCount);
            Assert.AreSame(firstMesh, state.ZoneMeshes[0], "returning to a previously built zone band should reuse its cached mesh");
        }
    }

    /// <summary>Small helper so a test can read a label's colour without a Color32 cast.</summary>
    static class StationZoneLabelTestExtensions {
        public static int Rgb(this StationZoneLabel label) => (label.Colour.r << 16) | (label.Colour.g << 8) | label.Colour.b;
    }
}
