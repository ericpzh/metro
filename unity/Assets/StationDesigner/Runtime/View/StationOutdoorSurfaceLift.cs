using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using Metro.Build;

namespace Metro.View {
    /// <summary>
    /// Port of <c>outdoorSurfaceLift</c> (<c>game/src/sim/placement.ts</c>): floor-standing
    /// equipment, furniture, fences, trees, pillars, post hangers, booths, doors, gates,
    /// floor marks and tactile tiles rise by <see cref="Height"/> (0.10 m) when any cell of
    /// their <c>flatEnvelope</c> sits on an authored <c>sidewalk</c> or <c>lawn</c> tile that
    /// is not cut open by an exit head-house or ramp corridor.
    ///
    /// Cached per <see cref="StationIndex"/> (or <see cref="IReadOnlyList{ModuleFacts}"/>) via
    /// <see cref="ConditionalWeakTable{TKey,TValue}"/> so stations without outdoor surface tiles
    /// pay zero allocations and lookups are O(1) per tile.
    /// </summary>
    public sealed class StationOutdoorSurfaceLift {
        /// <summary><c>OUTDOOR_SURFACE_HEIGHT</c> (<c>sim/constants.ts</c>), metres.</summary>
        public const float Height = 0.1f;

        /// <summary>Shared empty instance for stations with no <c>sidewalk</c> or <c>lawn</c> tiles.</summary>
        public static readonly StationOutdoorSurfaceLift Empty = new StationOutdoorSurfaceLift();

        static readonly ConditionalWeakTable<StationIndex, StationOutdoorSurfaceLift> ByIndex =
            new ConditionalWeakTable<StationIndex, StationOutdoorSurfaceLift>();

        static readonly ConditionalWeakTable<IReadOnlyList<ModuleFacts>, StationOutdoorSurfaceLift> ByFacts =
            new ConditionalWeakTable<IReadOnlyList<ModuleFacts>, StationOutdoorSurfaceLift>();

        readonly HashSet<StationCellKey> tiles;
        readonly StationIndex sourceIndex;
        readonly IReadOnlyList<ModuleFacts> sourceFacts;
        bool openingsReady;
        List<ModuleFacts> headHouses;
        StationRampOpenings.PreparedRampOpenings preparedRamps;
        Dictionary<int, HashSet<StationCellKey>> factRampsByLevel;

        StationOutdoorSurfaceLift() { }

        StationOutdoorSurfaceLift(HashSet<StationCellKey> tiles, StationIndex sourceIndex, IReadOnlyList<ModuleFacts> sourceFacts) {
            this.tiles = tiles;
            this.sourceIndex = sourceIndex;
            this.sourceFacts = sourceFacts;
        }

        public bool HasTiles => tiles != null && tiles.Count > 0;

        /// <summary>Cached lookup for a committed <see cref="StationIndex"/>.</summary>
        public static StationOutdoorSurfaceLift ForIndex(StationIndex index) {
            if (index == null) return Empty;
            if (ByIndex.TryGetValue(index, out var cached)) return cached;
            var sidewalks = index.ModulesOfType("sidewalk");
            var lawns = index.ModulesOfType("lawn");
            if (sidewalks.Count == 0 && lawns.Count == 0) {
                ByIndex.Add(index, Empty);
                return Empty;
            }
            var set = new HashSet<StationCellKey>();
            for (int i = 0; i < sidewalks.Count; i++) {
                var m = sidewalks[i];
                if (m != null) set.Add(new StationCellKey(m.X, m.Y, m.Z));
            }
            for (int i = 0; i < lawns.Count; i++) {
                var m = lawns[i];
                if (m != null) set.Add(new StationCellKey(m.X, m.Y, m.Z));
            }
            var built = set.Count == 0 ? Empty : new StationOutdoorSurfaceLift(set, index, null);
            ByIndex.Add(index, built);
            return built;
        }

        /// <summary>Cached lookup for a raw <see cref="ModuleFacts"/> array (direct view builders / tests).</summary>
        public static StationOutdoorSurfaceLift ForFacts(IReadOnlyList<ModuleFacts> station) {
            if (station == null || station.Count == 0) return Empty;
            if (ByFacts.TryGetValue(station, out var cached)) return cached;
            HashSet<StationCellKey> set = null;
            for (int i = 0; i < station.Count; i++) {
                var m = station[i];
                if (m == null || !StationSurfaceRules.IsSurface(m.Type)) continue;
                set ??= new HashSet<StationCellKey>();
                set.Add(new StationCellKey(m.X, m.Y, m.Z));
            }
            var built = set == null || set.Count == 0 ? Empty : new StationOutdoorSurfaceLift(set, null, station);
            ByFacts.Add(station, built);
            return built;
        }

        /// <summary>True when a module can receive outdoor-surface lift under <c>sim/placement.ts</c>.</summary>
        public static bool IsEligible(ModuleFacts m) {
            if (m == null) return false;
            var type = m.Type;
            if (string.IsNullOrEmpty(type)) return false;
            if (StationSurfaceRules.IsSurface(type)) return false;
            if (type == "road" || type == "roof" || type == "track" ||
                type == "stair" || type == "escalator" || type == "walkway" || type == "lift") {
                return false;
            }
            if (type == "exit") {
                // Head-houses return 0; doorway exits are wall-mounted; only virtual exits lift.
                return string.Equals(m.Config.Text("style"), "virtual", StringComparison.Ordinal);
            }
            if (IsWallMounted(m) || StationFootprints.IsCeilingHung(m)) return false;
            if (type == "psd-end" && string.Equals(m.Config.Text("variant"), "cover", StringComparison.Ordinal)) return false;
            if (type == "platform-edge" && string.Equals(m.Config.Text("psd"), "none", StringComparison.Ordinal)) return false;
            if (type == "hanger" && !string.Equals(m.Config.Text("mount"), "post", StringComparison.Ordinal)) return false;
            return true;
        }

        static bool IsWallMounted(ModuleFacts m) {
            switch (m.Type) {
                case "monitor": return string.Equals(m.Config.Text("mount"), "wall", StringComparison.Ordinal);
                case "exit": return string.Equals(m.Config.Text("style"), "doorway", StringComparison.Ordinal);
                case "sign": return string.Equals(m.Config.Text("mount"), "wall", StringComparison.Ordinal);
                case "glass": return !StationFootprints.GlassStandsOnFloor(m.Config);
                case "linemap": return !string.Equals(m.Config.Text("mount"), "stand", StringComparison.Ordinal);
                case "billboard":
                case "calligraphy":
                case "urinal":
                    return true;
                default:
                    return false;
            }
        }

        /// <summary>Vertical lift in metres (<c>0</c> or <see cref="Height"/>) for one committed module record.</summary>
        public float LiftOf(StationModuleRecord record) =>
            record == null ? 0f : LiftOf(record.Facts, record);

        /// <summary>Vertical lift in metres (<c>0</c> or <see cref="Height"/>) for one module.</summary>
        public float LiftOf(ModuleFacts module, StationModuleRecord record = null) {
            if (!HasTiles || module == null || !IsEligible(module)) return 0f;
            if (!TryPlanBounds(module, record, out double x0, out double y0, out double x1, out double y1)) return 0f;
            int minX = (int)Math.Floor(x0);
            int maxX = (int)Math.Ceiling(x1);
            int minY = (int)Math.Floor(y0);
            int maxY = (int)Math.Ceiling(y1);
            int z = module.Z;
            for (int x = minX; x < maxX; x++) {
                for (int y = minY; y < maxY; y++) {
                    if (tiles.Contains(new StationCellKey(x, y, z)) && !IsOpening(x, y, z)) {
                        return Height;
                    }
                }
            }
            return 0f;
        }

        /// <summary>
        /// True when <paramref name="module"/> is eligible for outdoor lift and its plan envelope
        /// overlaps any cell in <paramref name="cells"/> (used for local-delta invalidation when
        /// <c>sidewalk</c> or <c>lawn</c> tiles are added, moved or erased).
        /// </summary>
        public static bool OverlapsAnyCell(ModuleFacts module, StationModuleRecord record,
            HashSet<(int X, int Y, int Z)> cells) {
            if (module == null || cells == null || cells.Count == 0 || !IsEligible(module)) return false;
            if (!TryPlanBounds(module, record, out double x0, out double y0, out double x1, out double y1)) return false;
            int minX = (int)Math.Floor(x0);
            int maxX = (int)Math.Ceiling(x1);
            int minY = (int)Math.Floor(y0);
            int maxY = (int)Math.Ceiling(y1);
            int z = module.Z;
            for (int x = minX; x < maxX; x++) {
                for (int y = minY; y < maxY; y++) {
                    if (cells.Contains((x, y, z))) return true;
                }
            }
            return false;
        }

        bool IsOpening(int x, int y, int z) {
            EnsureOpenings();
            if (headHouses != null) {
                for (int i = 0; i < headHouses.Count; i++) {
                    if (StationRampOpenings.ExitCoversCell(headHouses[i], x, y, z)) return true;
                }
            }
            if (preparedRamps != null) {
                return preparedRamps.HasRamps && preparedRamps.AtLevel(z).Contains(new StationCellKey(x, y, z));
            }
            if (sourceFacts != null) {
                factRampsByLevel ??= new Dictionary<int, HashSet<StationCellKey>>();
                if (!factRampsByLevel.TryGetValue(z, out var holes)) {
                    holes = StationRampOpenings.RampOpeningsAtLevel(sourceFacts, z);
                    factRampsByLevel[z] = holes;
                }
                return holes.Contains(new StationCellKey(x, y, z));
            }
            return false;
        }

        void EnsureOpenings() {
            if (openingsReady) return;
            openingsReady = true;
            if (sourceIndex != null) {
                var exits = sourceIndex.ModulesOfType("exit");
                for (int i = 0; i < exits.Count; i++) {
                    var e = exits[i]?.Facts;
                    if (e == null) continue;
                    var style = e.Config.Text("style");
                    if (string.Equals(style, "doorway", StringComparison.Ordinal) ||
                        string.Equals(style, "virtual", StringComparison.Ordinal)) continue;
                    (headHouses ??= new List<ModuleFacts>()).Add(e);
                }
                preparedRamps = StationRampOpenings.PrepareOpenings(sourceIndex);
            } else if (sourceFacts != null) {
                for (int i = 0; i < sourceFacts.Count; i++) {
                    var e = sourceFacts[i];
                    if (e == null || !string.Equals(e.Type, "exit", StringComparison.Ordinal)) continue;
                    var style = e.Config.Text("style");
                    if (string.Equals(style, "doorway", StringComparison.Ordinal) ||
                        string.Equals(style, "virtual", StringComparison.Ordinal)) continue;
                    (headHouses ??= new List<ModuleFacts>()).Add(e);
                }
            }
        }

        static bool TryPlanBounds(ModuleFacts m, StationModuleRecord record,
            out double x0, out double y0, out double x1, out double y1) {
            if (record != null && !string.Equals(m.Type, "hanger", StringComparison.Ordinal) &&
                StationFootprints.TryClearance(record, out var box, out _)) {
                if (box.IsEmpty || Math.Abs(box.Z0 - m.Z - 1.0) > 0.01) {
                    x0 = y0 = x1 = y1 = 0;
                    return false;
                }
                x0 = box.X0;
                y0 = box.Y0;
                x1 = box.X1;
                y1 = box.Y1;
                return true;
            }
            return TryPlanBoundsFromFacts(m, out x0, out y0, out x1, out y1);
        }

        static bool TryPlanBoundsFromFacts(ModuleFacts m,
            out double x0, out double y0, out double x1, out double y1) {
            x0 = m.X;
            y0 = m.Y;
            x1 = m.X + 1;
            y1 = m.Y + 1;
            switch (m.Type) {
                case "hanger": {
                    if (!string.Equals(m.Config.Text("mount"), "post", StringComparison.Ordinal)) return false;
                    int w = Math.Max(1, m.Width);
                    StationFootprints.RotateLocal(m.Rotation, (w - 1) * 0.5, 0, out var dx, out var dy);
                    double cx = m.X + 0.5 + dx;
                    double cy = m.Y + 0.5 + dy;
                    bool sideways = StationFootprints.NormRot(m.Rotation) % 2 == 1;
                    double halfX = (sideways ? 0.2 : w) * 0.5;
                    double halfY = (sideways ? w : 0.2) * 0.5;
                    StationFootprints.RotateLocal(m.Rotation, 0, 0.17, out var px, out var py);
                    x0 = Math.Min(cx - halfX, cx + px - 0.18);
                    x1 = Math.Max(cx + halfX, cx + px + 0.18);
                    y0 = Math.Min(cy - halfY, cy + py - 0.18);
                    y1 = Math.Max(cy + halfY, cy + py + 0.18);
                    return true;
                }
                case "booth":
                case "retail":
                case "shop":
                    x1 = m.X + Math.Max(1, m.Width);
                    y1 = m.Y + Math.Max(1, m.Depth);
                    return true;
                case "door":
                case "bench":
                case "glass":
                case "linemap":
                case "platform-edge":
                    RunBounds(m.X, m.Y, m.Rotation, Math.Max(1, m.Width), 1, out x0, out y0, out x1, out y1);
                    return true;
                case "busstop":
                    RunBounds(m.X, m.Y, m.Rotation, Math.Max(1, m.Width), Math.Max(1, m.Depth), out x0, out y0, out x1, out y1);
                    return true;
                case "checkout":
                    RunBounds(m.X, m.Y, m.Rotation, StationFootprints.CounterLength(m.Width), 1, out x0, out y0, out x1, out y1);
                    return true;
                case "extinguisher": {
                    int w = string.Equals(m.Config.Text("variant"), "glass", StringComparison.Ordinal) ? 2 : 1;
                    RunBounds(m.X, m.Y, m.Rotation, w, 1, out x0, out y0, out x1, out y1);
                    return true;
                }
                case "shelf": {
                    var v = m.Config.Text("variant");
                    int w = v == "cafe-backbar-4" ? 4
                        : v == "books" || v == "bags" || v == "cafe-backbar-2" || v == "clothing-table" || v == "fruit-island" ? 2
                        : 1;
                    int d = v == "fruit-island" ? 2 : 1;
                    RunBounds(m.X, m.Y, m.Rotation, w, d, out x0, out y0, out x1, out y1);
                    return true;
                }
                case "court": {
                    var v = m.Config.Text("variant");
                    int w = v == "divider" ? 2 : 14;
                    int d = v == "divider" ? 1 : 7;
                    RunBounds(m.X, m.Y, m.Rotation, w, d, out x0, out y0, out x1, out y1);
                    return true;
                }
                case "floor-mark": {
                    if (StationPlatformDoorways.TryMarkOffset(m.Config, out var ox, out var oy)) {
                        x0 = m.X + ox;
                        y0 = m.Y + oy;
                        x1 = x0 + 1;
                        y1 = y0 + 1;
                    }
                    return true;
                }
                case "psd-end": {
                    if (string.Equals(m.Config.Text("variant"), "cover", StringComparison.Ordinal)) return false;
                    double ox = 0, oy = 0;
                    if (m.Config.TryNumbers("offset", out var off) && off.Length >= 2) {
                        ox = m.Config.Has("corner") ? off[0] : 0;
                        oy = off[1];
                    }
                    double spanLo = Math.Max(-0.5, -0.5 - ox);
                    double spanHi = Math.Min(0.5, 0.5 - ox);
                    double capLo = Math.Max(-0.5, -0.48 + oy);
                    double capHi = Math.Min(0.5, -0.20 + oy);
                    StationFootprints.RotateLocal(m.Rotation, spanLo + ox, capLo, out var cax, out var cay);
                    StationFootprints.RotateLocal(m.Rotation, spanHi + ox, capHi, out var cbx, out var cby);
                    x0 = m.X + 0.5 + Math.Min(cax, cbx);
                    x1 = m.X + 0.5 + Math.Max(cax, cbx);
                    y0 = m.Y + 0.5 + Math.Min(cay, cby);
                    y1 = m.Y + 0.5 + Math.Max(cay, cby);
                    return true;
                }
                default:
                    // Single-cell floor-standing types: tree, fence, pillar, gate, cubicle, tvm,
                    // vending, desk, sink, bin, cctv-post, guidepost, ac-unit, electrical-cabinet,
                    // tactile, traffic-light, rail-signal, exit-virtual.
                    return true;
            }
        }

        static void RunBounds(int mx, int my, int rot, int w, int d,
            out double x0, out double y0, out double x1, out double y1) {
            x0 = double.PositiveInfinity;
            y0 = double.PositiveInfinity;
            x1 = double.NegativeInfinity;
            y1 = double.NegativeInfinity;
            for (int i = 0; i < w; i++) {
                for (int j = 0; j < d; j++) {
                    StationFootprints.RotateLocal(rot, i, j, out var dx, out var dy);
                    int cx = mx + (int)Math.Round(dx);
                    int cy = my + (int)Math.Round(dy);
                    if (cx < x0) x0 = cx;
                    if (cy < y0) y0 = cy;
                    if (cx + 1 > x1) x1 = cx + 1;
                    if (cy + 1 > y1) y1 = cy + 1;
                }
            }
        }
    }
}
