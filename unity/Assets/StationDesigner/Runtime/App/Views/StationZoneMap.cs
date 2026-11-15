using System;
using System.Collections.Generic;
using Metro.Build;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// One entry of the source's overlay palette (`sim/zones.ts` `ZONE_PAINT_LIST`).
    ///
    /// Fare zones lead in `ZONE_LIST` order so their dense indices stay aligned with the
    /// simulation's `ZONE_INDEX`; the room purposes follow and are selected only by a
    /// cell's `room` field. The tint a quad wears and the border a label draws read this
    /// one list, so a colour can never disagree between the two halves of the map.
    /// </summary>
    public readonly struct StationZoneCategory {
        public StationZoneCategory(int index, string id, string labelZh, string labelEn, int rgb) {
            Index = index;
            Id = id ?? "";
            LabelZh = labelZh ?? "";
            LabelEn = labelEn ?? "";
            Rgb = rgb & 0xFFFFFF;
        }

        /// <summary>Dense display index, the value <see cref="StationZoneMap.Labels"/> publishes.</summary>
        public int Index { get; }
        /// <summary>The source id: <c>none</c>, <c>unpaid</c>, <c>store</c>, …</summary>
        public string Id { get; }
        public string LabelZh { get; }
        public string LabelEn { get; }
        /// <summary>Base colour as authored, <c>0xRRGGBB</c>.</summary>
        public int Rgb { get; }

        /// <summary>Opaque palette colour: the label border and text plate.</summary>
        public Color32 Colour => new Color32((byte)((Rgb >> 16) & 0xFF), (byte)((Rgb >> 8) & 0xFF), (byte)(Rgb & 0xFF), 255);

        /// <summary>The zone map's floor tint: the palette colour at the source's `0.3` opacity.</summary>
        public Color32 Tint => new Color32((byte)((Rgb >> 16) & 0xFF), (byte)((Rgb >> 8) & 0xFF), (byte)(Rgb & 0xFF), 77);

        /// <summary>The localized label (`ZONE_PAINT_LIST[i].label`).</summary>
        public string Label(string locale) => StationZoneMap.IsEnglish(locale) ? LabelEn : LabelZh;

        public string Hex => (Rgb & 0xFFFFFF).ToString("x6", System.Globalization.CultureInfo.InvariantCulture);

        public override string ToString() => Id + " #" + Hex;
    }

    /// <summary>
    /// One floor cell the zone map draws — a document cell the source's `isFloorCell`
    /// accepts, or a synthetic track-bed cell the overlay adds back (the rail dig removed
    /// it from `cells`). It is the tint unit and the flood-fill unit of the map.
    /// </summary>
    public readonly struct StationZoneFloor {
        public StationZoneFloor(int x, int y, int z, string zone, string room, bool fromTrack) {
            X = x;
            Y = y;
            Z = z;
            Zone = zone ?? "";
            Room = room ?? "";
            FromTrack = fromTrack;
            Display = StationZoneMap.DisplayZoneIndex(Zone, Room);
        }

        /// <summary>Document plan x.</summary>
        public int X { get; }
        /// <summary>Document plan y.</summary>
        public int Y { get; }
        /// <summary>Document elevation (the bottom of the cell; its walking plane is <c>Z + 1</c>).</summary>
        public int Z { get; }
        /// <summary>The saved fare-zone label, empty when the cell carries none (无分区).</summary>
        public string Zone { get; }
        /// <summary>The saved room-purpose label (`store`/`toilet`/`office`), empty when none.</summary>
        public string Room { get; }
        /// <summary>True for a synthetic bed cell derived from a `track` module's footprint.</summary>
        public bool FromTrack { get; }
        /// <summary>Dense display-zone index (`zoneDisplayIndexOf`).</summary>
        public int Display { get; }

        /// <summary>The effective paint id: a room purpose wins over the fare zone (`cell.room ?? zoneOf`).</summary>
        public string PaintId => !string.IsNullOrEmpty(Room) ? Room : (string.IsNullOrEmpty(Zone) ? "none" : Zone);

        public StationCellKey Key => new StationCellKey(X, Y, Z);

        public override string ToString() => X + "," + Y + "," + Z + " " + PaintId;
    }

    /// <summary>
    /// One zone-map label (`Zones.ts` `ZoneLabel`): a contiguous region's name, anchored
    /// on a floor tile of that region. Positions are **document axes** exactly as the
    /// source publishes them; the view converts once, at the plate.
    /// </summary>
    public readonly struct StationZoneLabel {
        public StationZoneLabel(double x, double y, double z, int display, int cells, string text, Color32 colour, string category,
            int cellX, int cellY, int cellZ) {
            X = x;
            Y = y;
            Z = z;
            Display = display;
            Cells = cells;
            Text = text ?? "";
            Colour = colour;
            Category = category ?? "";
            CellX = cellX;
            CellY = cellY;
            CellZ = cellZ;
        }

        /// <summary>Document plan x — the anchor tile's centre.</summary>
        public double X { get; }
        /// <summary>Document plan y — the anchor tile's centre.</summary>
        public double Y { get; }
        /// <summary>Document elevation — the floor top plus the source's `0.06` lift.</summary>
        public double Z { get; }
        /// <summary>Dense display-zone index; also the label-material cache key half.</summary>
        public int Display { get; }
        /// <summary>How many floor cells the region holds.</summary>
        public int Cells { get; }
        /// <summary>The localized category text (`付费区`, `Store`, …).</summary>
        public string Text { get; }
        /// <summary>The category's palette colour (opaque; the border).</summary>
        public Color32 Colour { get; }
        /// <summary>The category id (`paid`, `store`, …).</summary>
        public string Category { get; }
        /// <summary>The anchor tile's document cell.</summary>
        public int CellX { get; }
        public int CellY { get; }
        public int CellZ { get; }

        /// <summary>The anchor in document axes, for the one conversion at the plate.</summary>
        public Vector3 DocumentPoint => new Vector3((float)X, (float)Y, (float)Z);

        public StationCellKey Cell => new StationCellKey(CellX, CellY, CellZ);

        public override string ToString() => Text + " " + Cells + " cells at " + X + "," + Y + "," + Z + " (#" + Display + ")";
    }

    /// <summary>
    /// The zone map's rules, ported once from `game/src/build/model/Zones.ts` (§4.5) and
    /// read by both halves of the overlay — the floor tint and the region labels. Nothing
    /// here touches a scene object or a save: the input is the committed document, the
    /// output is plain data, and the order is the source's own document/DFS order, so two
    /// runs over the same document produce the same floors, labels and anchors.
    ///
    /// * <see cref="Floors"/> is `zoneMapFloors`: the walkable floor, never a roof, a
    ///   ceiling plate or a buried track bed, plus one synthetic `restricted` bed cell for
    ///   every cell a `track` module covers (rotated through the shared footprint helper).
    /// * <see cref="FloorsAt"/> is `zoneMapFloorsAt`: that list filtered to one storey,
    ///   the active storey band `storeyBand` keys the level slice by.
    /// * <see cref="Labels"/> is `zoneRegionLabels`: one label per four-connected region
    ///   of the same display zone on the same exact course, at least six cells, anchored
    ///   on the included tile nearest the region's centroid.
    /// * <see cref="DisplayZoneIndex(StationCellRecord)"/> is `zoneDisplayIndexOf`: the
    ///   dense palette index including a cell's room purpose.
    /// </summary>
    public static class StationZoneMap {
        /// <summary>Smallest region that earns a text label (`LABEL_MIN_CELLS`).</summary>
        public const int LabelMinCells = 6;

        /// <summary>The source's label lift over the floor top (`zoneRegionLabels`'s `z + 1.06`).</summary>
        public const double LabelLift = .06;

        /// <summary>The source's label plate footprint (`PlaneGeometry(3.2, 1.2)`).</summary>
        public const float PlateWidth = 3.2f;
        public const float PlateDepth = 1.2f;

        /// <summary>The source's floor-tint lift over the walking plane (`c.z + 1.02`).</summary>
        public const double QuadLift = .02;

        /// <summary>
        /// `ZONE_PAINT_LIST` in order. The first six are `ZONE_LIST` and keep the
        /// simulation's dense fare indices; the room purposes follow.
        /// </summary>
        static readonly StationZoneCategory[] Palette = {
            new StationZoneCategory(0, "none", "无分区", "No zone", 0x9aa2ab),
            new StationZoneCategory(1, "outside", "站外", "Outside", 0x5b6472),
            new StationZoneCategory(2, "unpaid", "非付费区", "Unpaid area", 0x3fb27f),
            new StationZoneCategory(3, "paid", "付费区", "Paid area", 0x4ea8ff),
            new StationZoneCategory(4, "platform", "站台", "Platform", 0xf2a541),
            new StationZoneCategory(5, "restricted", "设备区", "Equipment area", 0xe4572e),
            new StationZoneCategory(6, "store", "商店", "Store", 0xb07cc6),
            new StationZoneCategory(7, "toilet", "厕所", "Restroom", 0x5fb7a6),
            new StationZoneCategory(8, "office", "办公室", "Office", 0xd9a24b),
        };

        /// <summary>The fare-zone ids in `ZONES` order (`ZONE_INDEX`).</summary>
        static readonly string[] FareZones = { "none", "outside", "unpaid", "paid", "platform", "restricted" };

        /// <summary>The finish whose bed is not walkable but is still the 设备区 floor (`floor.track`).</summary>
        const string TrackBedFinish = "floor.track";

        /// <summary>Cover soil: solid ground nobody walks on (`floor.soil`, speed 0).</summary>
        const string CoverSoilFinish = "floor.soil";

        /// <summary>The authored tags that make a block a ceiling plate rather than floor.</summary>
        const string SuspendedCeilingTag = "suspended-ceiling";
        const string OpeningCeilingTag = "opening-ceiling";

        /// <summary>The four in-plane neighbours, in the source's `NEIGH4` order.</summary>
        static readonly int[] Neigh4X = { 1, -1, 0, 0 };
        static readonly int[] Neigh4Y = { 0, 0, 1, -1 };

        public static int CategoryCount => Palette.Length;

        public static IReadOnlyList<StationZoneCategory> Categories => Palette;

        /// <summary>The palette entry at a dense display index; out-of-range reads 无分区.</summary>
        public static StationZoneCategory Category(int display) =>
            display >= 0 && display < Palette.Length ? Palette[display] : Palette[0];

        /// <summary>Dense index of a paint id, or -1 when the id is not in the palette.</summary>
        public static int DisplayIndexOf(string id) {
            if (string.IsNullOrEmpty(id)) return -1;
            for (int i = 0; i < Palette.Length; i++) {
                if (string.Equals(Palette[i].Id, id, StringComparison.Ordinal)) return i;
            }
            return -1;
        }

        /// <summary>True for the shell locales whose labels are set in English.</summary>
        public static bool IsEnglish(string locale) =>
            !string.IsNullOrEmpty(locale) && locale.StartsWith("en", StringComparison.OrdinalIgnoreCase);

        /// <summary>The canonical locale the label cache keys on: <c>en</c> or <c>zh-CN</c>.</summary>
        public static string NormalizeLocale(string locale) => IsEnglish(locale) ? "en" : "zh-CN";

        /// <summary>The dense fare-zone index of a saved zone label (`ZONE_INDEX[zoneOf(cell)]`).</summary>
        public static int FareZoneIndex(string zone) {
            for (int i = 0; i < FareZones.Length; i++) {
                if (string.Equals(FareZones[i], zone, StringComparison.Ordinal)) return i;
            }
            return 0;
        }

        /// <summary>
        /// `zoneDisplayIndexOf`: a cell's room purpose when it carries one, otherwise its
        /// fare zone, read against the full paint palette. An unknown label falls back to
        /// the fare index exactly as the source's `findIndex` fallback does.
        /// </summary>
        public static int DisplayZoneIndex(string zone, string room) {
            var id = !string.IsNullOrEmpty(room) ? room : (string.IsNullOrEmpty(zone) ? "none" : zone);
            int index = DisplayIndexOf(id);
            return index >= 0 ? index : FareZoneIndex(zone);
        }

        public static int DisplayZoneIndex(StationCellRecord cell) =>
            cell == null ? 0 : DisplayZoneIndex(cell.Zone, cell.Room);

        /* ------------------------------------------------------------ the floor */

        /// <summary>`zoneMapFloors`: every explicit floor cell, then the track beds back.</summary>
        public static IReadOnlyList<StationZoneFloor> Floors(StationDocument document) {
            var floors = new List<StationZoneFloor>();
            if (document == null) return floors;
            var cells = document.Cells;
            var solid = new HashSet<StationCellKey>();
            var shapes = new Dictionary<StationCellKey, StationCellShape>();
            for (int i = 0; i < cells.Count; i++) {
                var cell = cells[i];
                if (cell == null || !cell.IsSolid) continue;
                solid.Add(cell.Key);
                var shape = StationCellRules.ShapeOf(cell.Tags);
                if (!shape.IsFull) shapes[cell.Key] = shape;
            }
            var have = new HashSet<StationCellKey>();
            for (int i = 0; i < cells.Count; i++) {
                var cell = cells[i];
                if (cell == null || !IsFloorCell(cell, solid, shapes)) continue;
                // Explicit cells only: the infinite street is never materialised (its
                // plane is one uniform, unlabelled zone already).
                floors.Add(new StationZoneFloor(cell.X, cell.Y, cell.Z, cell.Zone, cell.Room, false));
                have.Add(cell.Key);
            }
            // A placed rail digs its bed, so those cells are gone from the document. Add
            // the module footprint back as a synthetic restricted cell, rotated through
            // the shared footprint helper so the overlay matches the placed rails (§5.4).
            var modules = document.Modules;
            for (int i = 0; i < modules.Count; i++) {
                var module = modules[i];
                if (module == null || !string.Equals(module.Type, "track", StringComparison.Ordinal)) continue;
                var bed = StationFootprints.TrackCells(module);
                for (int c = 0; c < bed.Length; c++) {
                    var point = bed[c];
                    int x = (int)Math.Round(point.X, MidpointRounding.AwayFromZero);
                    int y = (int)Math.Round(point.Y, MidpointRounding.AwayFromZero);
                    int z = (int)Math.Round(point.Z, MidpointRounding.AwayFromZero);
                    var key = new StationCellKey(x, y, z);
                    if (!have.Add(key)) continue;
                    floors.Add(new StationZoneFloor(x, y, z, "restricted", "", true));
                }
            }
            return floors;
        }

        /// <summary>`zoneMapFloorsAt`: the map of **one storey**, the floor the active level holds.</summary>
        public static IReadOnlyList<StationZoneFloor> FloorsAt(StationDocument document, int level) {
            var all = Floors(document);
            if (all.Count == 0) return all;
            int band = Band(level, document);
            var at = new List<StationZoneFloor>(all.Count);
            for (int i = 0; i < all.Count; i++) {
                if (Band(all[i].Z, document) == band) at.Add(all[i]);
            }
            return at;
        }

        /// <summary>
        /// The storey band an elevation belongs to. `sim/constants.ts` `storeyBand` ignores
        /// its height argument (`_height`) and divides the fixed five-metre v1 grid, so the
        /// repository's one port (<see cref="Metro.View.StationCoordinates.StoreyBand"/>)
        /// is exact here — the same rule the level slice keys every mesh by.
        /// </summary>
        static int Band(double z, StationDocument document) =>
            Metro.View.StationCoordinates.StoreyBand(z, document != null ? document.LevelBase : 0);

        /// <summary>
        /// `isFloorCell`: a solid whose top face is at least partly exposed and walkable,
        /// or a track bed at the foot of its column. A wall's track-finish coping is
        /// structure (it sits on solid fill); a suspended/opening ceiling plate is the
        /// ceiling however exposed its top; a half wall, corner or cut piece is not floor
        /// itself — but it leaves the floor *under* it partly open, which is why
        /// <see cref="OpenAbove"/> reads the shape of the course above.
        /// </summary>
        static bool IsFloorCell(StationCellRecord cell, HashSet<StationCellKey> solid, Dictionary<StationCellKey, StationCellShape> shapes) {
            if (cell == null || !cell.IsSolid) return false;
            if (IsCeilingPlate(cell)) return false;
            var shape = ShapeAt(shapes, cell.Key);
            if (shape.Kind == StationShapeKind.Half || shape.Kind == StationShapeKind.Corner ||
                shape.Kind == StationShapeKind.Cuts) return false;
            if (!OpenAbove(cell.X, cell.Y, cell.Z, solid, shapes)) return false;
            var top = FinishTop(cell);
            bool trackBed = string.Equals(StationFinishIds.BaseId(top), TrackBedFinish, StringComparison.Ordinal);
            return FloorSpeed(top) > 0 ||
                   (trackBed && !solid.Contains(new StationCellKey(cell.X, cell.Y, cell.Z - 1)));
        }

        /// <summary>True for the two tags that mean "this block is a ceiling, not floor".</summary>
        static bool IsCeilingPlate(StationCellRecord cell) =>
            cell.HasTag(SuspendedCeilingTag) || cell.HasTag(OpeningCeilingTag);

        /// <summary>
        /// The course above leaves the top face at least partly exposed: absent, or a
        /// piece thinner than a block (half wall, corner, cut piece, lower wedge).
        /// </summary>
        static bool OpenAbove(int x, int y, int z, HashSet<StationCellKey> solid, Dictionary<StationCellKey, StationCellShape> shapes) {
            var key = new StationCellKey(x, y, z + 1);
            if (!solid.Contains(key)) return true;
            if (!shapes.TryGetValue(key, out var shape)) return false;
            return shape.Kind == StationShapeKind.Half || shape.Kind == StationShapeKind.Corner ||
                   shape.Kind == StationShapeKind.Cuts ||
                   (shape.Kind == StationShapeKind.Triangle && shape.Triangle == StationTriangleKind.Lower);
        }

        static StationCellShape ShapeAt(Dictionary<StationCellKey, StationCellShape> shapes, StationCellKey key) =>
            shapes.TryGetValue(key, out var shape) ? shape : StationCellShape.Full;

        static string FinishTop(StationCellRecord cell) =>
            string.IsNullOrEmpty(cell.FinishTop) ? StationFinishIds.DefaultMaterial : cell.FinishTop;

        /// <summary>
        /// `floorSpeed`: the walk-speed multiplier of the floor a cell presents on top.
        /// The port's finish table has exactly two zero-speed finishes — the track bed
        /// (`floor.track`, family `track`) and cover soil (`floor.soil`) — and every other
        /// finish (including an unknown id's `floor.concrete` fallback) walks.
        /// </summary>
        static double FloorSpeed(string finish) {
            var id = StationFinishIds.BaseId(finish);
            if (string.Equals(id, TrackBedFinish, StringComparison.Ordinal)) return 0;
            if (string.Equals(id, CoverSoilFinish, StringComparison.Ordinal)) return 0;
            return 1;
        }

        /* ----------------------------------------------------------- the labels */

        /// <summary>
        /// `zoneRegionLabels`: one label per contiguous same-zone floor patch of at least
        /// <see cref="LabelMinCells"/> cells, at the patch tile nearest its centroid. The
        /// walk is the source's: four in-plane neighbours on the same exact course, a LIFO
        /// stack pushed in `NEIGH4` order, and a strict `&lt;` on the centroid distance, so
        /// a tie resolves to the first region cell in that walk — deterministic and
        /// independent of any hash order.
        /// </summary>
        public static IReadOnlyList<StationZoneLabel> Labels(IReadOnlyList<StationZoneFloor> floors, string locale) {
            var labels = new List<StationZoneLabel>();
            if (floors == null || floors.Count == 0) return labels;
            var byKey = new Dictionary<StationCellKey, StationZoneFloor>();
            for (int i = 0; i < floors.Count; i++) byKey[floors[i].Key] = floors[i];
            var seen = new HashSet<StationCellKey>();
            var stack = new List<StationZoneFloor>();
            var region = new List<StationZoneFloor>();
            for (int start = 0; start < floors.Count; start++) {
                var first = floors[start];
                if (!seen.Add(first.Key)) continue;
                int display = first.Display;
                stack.Clear();
                region.Clear();
                stack.Add(first);
                double sumX = 0, sumY = 0;
                while (stack.Count > 0) {
                    int last = stack.Count - 1;
                    var current = stack[last];
                    stack.RemoveAt(last);
                    region.Add(current);
                    sumX += current.X + 0.5;
                    sumY += current.Y + 0.5;
                    for (int n = 0; n < Neigh4X.Length; n++) {
                        var key = new StationCellKey(current.X + Neigh4X[n], current.Y + Neigh4Y[n], current.Z);
                        if (!byKey.TryGetValue(key, out var neighbour)) continue;
                        if (seen.Contains(key) || neighbour.Display != display) continue;
                        seen.Add(key);
                        stack.Add(neighbour);
                    }
                }
                if (region.Count < LabelMinCells) continue;
                // Centroid, then snap to the region cell nearest it, so the label always
                // sits on the area (and its tint) rather than floating over a concavity.
                double cx = sumX / region.Count;
                double cy = sumY / region.Count;
                var best = region[0];
                double bestDistance = double.PositiveInfinity;
                for (int i = 0; i < region.Count; i++) {
                    var cell = region[i];
                    double dx = cell.X + 0.5 - cx;
                    double dy = cell.Y + 0.5 - cy;
                    double distance = dx * dx + dy * dy;
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        best = cell;
                    }
                }
                var category = Category(display);
                labels.Add(new StationZoneLabel(
                    best.X + 0.5, best.Y + 0.5, best.Z + 1 + LabelLift, display, region.Count,
                    category.Label(locale), category.Colour, category.Id, best.X, best.Y, best.Z));
            }
            return labels;
        }
    }
}
