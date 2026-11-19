using System;

namespace Metro.Build {
    /// <summary>
    /// The wall aim (`app/tools/moduleAim.ts`'s wall branch): where a wall-mounted piece
    /// anchors. A wall piece is hung on the **face** of a column, so the pointer's hit names the
    /// course and the piece stands on the floor at the foot of that column  the exposed floor
    /// in front of it, or the column's own base when the column starts below the floor.
    ///
    /// A 玻璃板 that is **not** floor-standing is the one piece that follows the aimed course
    /// instead (`wallMountFollowsCourse`), because its size is a band of wall: it is a window
    /// placed where the player aims it, not cladding at whatever height the floor happens to be.
    /// </summary>
    public static class StationWallAim {
        /// <summary>`wallMountFollowsCourse`: only a non-floor-standing glass panel follows the course.</summary>
        public static bool FollowsCourse(string type, ModuleConfig config) {
            if (!string.Equals(type, "glass", StringComparison.Ordinal)) return false;
            return !StationFootprints.GlassStandsOnFloor(config ?? ModuleConfig.Empty);
        }

        /// <summary>
        /// `wallMountStandCell`: the anchor of a wall piece for one hit. <paramref name="followCourse"/>
        /// pins a glass panel to the course it was aimed at; every other wall piece stands on the
        /// floor at the foot of the column.
        /// </summary>
        public static StationPoint StandCell(StationIndex index, StationPlacementHit hit, bool snapToSolidBlock,
            bool followCourse) {
            int cx = hit.X, cy = hit.Y, cz = hit.Z;
            var column = index != null ? index.GetCell(cx, cy, cz) : null;
            bool onWall = column != null && column.IsSolid &&
                          (snapToSolidBlock || StationCellRules.IsWallBlock(column.Tags));
            bool side = hit.PlaceX != cx || hit.PlaceY != cy;
            if (side) {
                bool coveredAbove = index != null && StationFootprints.IsSolidAt(index, cx, cy, cz + 1);
                bool columnBelow = followCourse && column != null && column.IsSolid &&
                                   StationFootprints.IsSolidAt(index, cx, cy, cz - 1);
                if (followCourse && (onWall || coveredAbove || columnBelow))
                    return new StationPoint(hit.PlaceX, hit.PlaceY, cz - 1);
                return new StationPoint(hit.PlaceX, hit.PlaceY, AnchorZ(index, hit.PlaceX, hit.PlaceY, cz));
            }
            if (!onWall) return new StationPoint(cx, cy, cz);
            return new StationPoint(cx, cy, ExposedFloorZ(index, cx, cy, cz) ?? WallBaseZ(index, cx, cy, cz) ?? cz);
        }

        /// <summary>`wallAnchorZ`: the highest support at or below the aimed course.</summary>
        public static int AnchorZ(StationIndex index, int x, int y, int below) {
            int? exposed = ExposedFloorZ(index, x, y, below);
            int? baseZ = WallBaseZ(index, x, y, below);
            int z = Math.Max(exposed ?? int.MinValue, baseZ ?? int.MinValue);
            return z == int.MinValue ? below : z;
        }

        /// <summary>
        /// `exposedFloorZ`: the highest solid **non-wall** course at or below `below` whose own
        /// cell above is open air, or the street at grade. A wall course is not a floor, so the
        /// column's own blocks never answer this.
        /// </summary>
        public static int? ExposedFloorZ(StationIndex index, int x, int y, int below) {
            if (index == null) return null;
            int? best = null;
            var bounds = index.Bounds;
            if (!bounds.IsEmpty && x >= bounds.MinX && x <= bounds.MaxX && y >= bounds.MinY && y <= bounds.MaxY) {
                int maxZ = Math.Min(below, bounds.MaxZ);
                for (int z = maxZ; z >= bounds.MinZ; z--) {
                    var cell = index.GetCell(x, y, z);
                    if (cell == null || !cell.IsSolid) continue;
                    if (StationCellRules.IsWallBlock(cell.Tags)) continue;
                    if (StationFootprints.IsSolidAt(index, x, y, z + 1)) continue;
                    best = z;
                    break;
                }
            }
            if (below >= (int)Math.Round(StationFootprints.GroundZ) &&
                !StationFootprints.IsGroundHole(index, x, y) &&
                (best == null || best < StationFootprints.GroundZ)) {
                best = (int)Math.Round(StationFootprints.GroundZ);
            }
            return best;
        }

        /// <summary>
        /// `wallBaseZ`: the bottom of the contiguous column the course belongs to. With no floor
        /// beside it, the piece still hangs on the wall's own foot  one course below the base
        /// when that base is a wall block (the floor the wall was raised from).
        /// </summary>
        public static int? WallBaseZ(StationIndex index, int x, int y, int z) {
            if (index == null) return null;
            var column = index.GetCell(x, y, z);
            if (column == null || !column.IsSolid) return null;
            int at = z;
            while (at > -256 && StationFootprints.IsSolidAt(index, x, y, at - 1)) at--;
            var baseCell = index.GetCell(x, y, at);
            bool wallBase = baseCell != null && StationCellRules.IsWallBlock(baseCell.Tags);
            bool hasAbove = StationFootprints.IsSolidAt(index, x, y, at + 1);
            return wallBase || hasAbove ? at - 1 : at;
        }
    }
}
