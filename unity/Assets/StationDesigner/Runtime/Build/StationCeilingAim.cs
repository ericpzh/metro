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
        /// `hungCeilingAim`: the anchor of a ceiling piece for one hit. <paramref name="top"/> is
        /// the ceiling course the piece hangs from, and the anchor is the air cell beneath it.
        /// </summary>
        public static StationPoint Aim(StationIndex index, StationPlacementRequest request, string type) {
            var hit = request.Hit;
            bool side = hit.PlaceX != hit.X || hit.PlaceY != hit.Y;
            int x = side ? hit.PlaceX : hit.X;
            int y = side ? hit.PlaceY : hit.Y;
            // Only a slab's own underside aimed at is the ceiling itself; every other hit looks
            // above the block the pointer is on.
            int from = !side && hit.PlaceZ < hit.Z ? hit.Z : hit.Z + 1;
            if (index != null && TryTopBlockZ(index, x, y, from, out var top)) return new StationPoint(x, y, top - 1);
            return StandCell(hit);
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
            var document = index.Document;
            var solids = new HashSet<int>();
            foreach (var cell in document.Cells) {
                if (cell == null || !cell.IsSolid || cell.X != x || cell.Y != y) continue;
                solids.Add(cell.Z);
            }
            foreach (var z in solids) {
                if (z < from) continue;
                if (solids.Contains(z - 1)) continue;
                if (!found || z < top) { top = z; found = true; }
            }
            foreach (var module in document.Modules) {
                if (module == null || module.Type != "track" || module.Config.Bool("tunnel")) continue;
                if (!StationRailRules.Covers(module, x, y, module.Z)) continue;
                int underside = module.Z - 1;
                if (underside < from) continue;
                if (solids.Contains(underside - 1)) continue;
                if (!found || underside < top) { top = underside; found = true; }
            }
            int ground = (int)Math.Round(StationFootprints.GroundZ);
            if (from <= ground && !StationFootprints.IsGroundHole(index, x, y) &&
                (!found || top > ground)) {
                top = ground;
                found = true;
            }
            return found;
        }
    }
}
