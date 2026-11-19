using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// The ceiling aim (`app/tools/moduleAim.ts` + `sim/placement.ts`): where a ceiling-hung
    /// piece anchors. A hung fitting hangs from the **underside** overhead — the lowest solid
    /// course whose own cell below is open air — so the pointer names the space it is in and the
    /// piece lands on that space's ceiling, not on the floor under it. A 站台 or 轨道桥 bed is a
    /// ceiling too: its deck is dug or hangs over void, so no cell marks it.
    ///
    /// A pointer that finds no ceiling falls back to the stand cell: the hit cell itself for a
    /// side hit, the cell below for a hit from underneath, and the placement cell otherwise.
    /// </summary>
    public static class StationCeilingAim {
        /// <summary>`isCeilingHung` for a palette piece: its type and (optional) own config.</summary>
        public static bool IsCeilingPiece(string type, ModuleConfig config = null) =>
            StationFootprints.IsCeilingHung(type ?? "", config ?? ModuleConfig.Empty);

        /// <summary>
        /// `moduleAim.ts` + `hungCeilingAim`: the anchor of a ceiling piece for one hit. A steel
        /// hanger beam or a hanger-compatible prop aimed at a cell spanned by an existing hanger
        /// keeps its stand anchor (`moduleAim.ts:34-38`); otherwise <paramref name="top"/> is the
        /// ceiling course overhead and the anchor is the air cell beneath it.
        /// </summary>
        public static StationPoint Aim(StationIndex index, StationPlacementRequest request, string type) {
            var hit = request.Hit;
            var stand = StandCell(hit);
            string kind = type ?? "";
            if (string.Equals(kind, "hanger", StringComparison.Ordinal) ||
                kind.StartsWith("hanger-", StringComparison.Ordinal)) {
                return stand;
            }
            bool hangerProp = request.Carried != null
                ? StationModulePlacement.HangerAcceptsPiece(
                    request.Carried.Type,
                    request.Carried.Config.Text("variant"),
                    request.Carried.Config.Text("mount"))
                : IsHangerPropPalette(kind);
            if (hangerProp && index != null) {
                int sx = (int)Math.Round(stand.X);
                int sy = (int)Math.Round(stand.Y);
                int sz = (int)Math.Round(stand.Z);
                if (HangerCellAt(index, sx, sy, sz)) return stand;
            }
            bool side = hit.PlaceX != hit.X || hit.PlaceY != hit.Y;
            int x = side ? hit.PlaceX : hit.X;
            int y = side ? hit.PlaceY : hit.Y;
            // Only a slab's own underside aimed at is the ceiling itself; every other hit looks
            // above the block the pointer is on.
            int from = !side && hit.PlaceZ < hit.Z ? hit.Z : hit.Z + 1;
            if (index != null && TryTopBlockZ(index, x, y, from, out var top)) return new StationPoint(x, y, top - 1);
            return stand;
        }

        public static bool IsHangerPropPalette(string type) {
            switch (type ?? "") {
                case "tv":
                case "tv-double":
                case "clock":
                case "clock-digital":
                case "cctv":
                case "cctv-ptz":
                case "cctv-dome":
                case "sign":
                case "sign-ceiling":
                    return true;
                default:
                    return false;
            }
        }

        public static bool HangerCellAt(StationIndex index, int x, int y, int z) {
            if (index == null) return false;
            var hangers = index.ModulesOfType("hanger");
            for (int h = 0; h < hangers.Count; h++) {
                var hanger = hangers[h];
                if (hanger == null || hanger.Z != z) continue;
                int width = Math.Max(1, hanger.Width);
                for (int i = 0; i < width; i++) {
                    StationFootprints.RotateLocal(hanger.Rotation, i, 0, out var dx, out var dy);
                    if (hanger.X + (int)Math.Round(dx) == x && hanger.Y + (int)Math.Round(dy) == y) {
                        return true;
                    }
                }
            }
            return false;
        }

        /// <summary>Port of <c>sim/placement.ts:topBlockOver</c>.</summary>
        public static bool TopBlockOver(StationIndex index, int x, int y, int z) {
            if (index == null) return false;
            int over = z + 1;
            if (StationFootprints.IsSolidAt(index, x, y, over)) return true;
            var tracks = index.ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var track = tracks[i];
                if (track == null || track.Config.Bool("tunnel") || track.Z - 1 != over) continue;
                if (StationRailRules.Covers(track, x, y, track.Z)) return true;
            }
            return false;
        }

        /// <summary>`ceilingMountStandCell`: the three fallbacks an aim with no ceiling above reads.</summary>
        public static StationPoint StandCell(StationPlacementHit hit) {
            int dz = hit.PlaceZ - hit.Z;
            if (dz == 1) return new StationPoint(hit.X, hit.Y, hit.Z);
            if (dz == -1) return new StationPoint(hit.X, hit.Y, hit.PlaceZ);
            if (hit.PlaceX == hit.X && hit.PlaceY == hit.Y) return new StationPoint(hit.X, hit.Y, hit.Z);
            return new StationPoint(hit.PlaceX, hit.PlaceY, hit.PlaceZ);
        }

        /// <summary>
        /// `topBlockZ`: the lowest solid course at or above <paramref name="from"/> whose own cell
        /// below is open air — the first **underside** overhead. A wall's stacked courses are
        /// skipped, and a non-tunnel track's deck (one course below its anchor) counts as one.
        /// </summary>
        public static bool TryTopBlockZ(StationIndex index, int x, int y, int from, out int top) {
            top = int.MaxValue;
            bool found = false;
            var bounds = index.Bounds;
            if (!bounds.IsEmpty && x >= bounds.MinX && x <= bounds.MaxX && y >= bounds.MinY && y <= bounds.MaxY) {
                int minZ = Math.Max(from, bounds.MinZ);
                for (int z = minZ; z <= bounds.MaxZ; z++) {
                    var cell = index.GetCell(x, y, z);
                    if (cell == null || !cell.IsSolid) continue;
                    var below = index.GetCell(x, y, z - 1);
                    if (below != null && below.IsSolid) continue;
                    top = z;
                    found = true;
                    break;
                }
            }
            var tracks = index.ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var module = tracks[i];
                if (module == null || module.Config.Bool("tunnel")) continue;
                int underside = module.Z - 1;
                if (underside < from || (found && underside >= top)) continue;
                if (!StationRailRules.Covers(module, x, y, module.Z)) continue;
                var below = index.GetCell(x, y, underside - 1);
                if (below != null && below.IsSolid) continue;
                top = underside;
                found = true;
            }
            int ground = (int)Math.Round(StationFootprints.GroundZ);
            if (from <= ground && (!found || top > ground) && !StationFootprints.IsGroundHole(index, x, y)) {
                var belowGround = index.GetCell(x, y, ground - 1);
                if (belowGround == null || !belowGround.IsSolid) {
                    top = ground;
                    found = true;
                }
            }
            return found;
        }
    }
}
