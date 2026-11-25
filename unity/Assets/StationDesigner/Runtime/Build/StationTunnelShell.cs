using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// The bore's own structure (`build/model/TunnelShell.ts`): a 隧道 is not just a track
    /// record  boring it **clears the rock** above its bed and walls the cut with an owned
    /// shell (`tunnel-shell:&lt;track id&gt;`), so the tunnel reads as a hole through the ground
    /// rather than a train inside solid rock. Lifting the bore strips exactly that shell again;
    /// the tag is owned by this file and deliberately distinct from derived auto-walls.
    ///
    /// A cell a reserved opening already holds (a ramp's corridor, a head-house floor) is never
    /// sealed: the shell is added around the opening, not across it.
    /// </summary>
    public static class StationTunnelShell {
        public const string TagRoot = "tunnel-shell";

        /// <summary>The shell tag one track owns.</summary>
        public static string Tag(string trackId) => TagRoot + ":" + (trackId ?? "");

        /// <summary>
        /// `boreTunnel`: the cell writes that clear the bore and wall it. Returns an empty list
        /// when the bore changes nothing (the caller then commits only the track record).
        /// </summary>
        public static List<StationCellWrite> Bore(StationIndex index, StationModuleRecord track,
            StationCellEditWorld world) {
            var writes = new List<StationCellWrite>();
            if (index == null || track == null) return writes;
            int headroom = StationRailRules.Headroom(track.Config.Text("power"), true, false,
                track.Config.Text("catenary"));
            var dropped = new HashSet<StationCellKey>();
            var added = new HashSet<StationCellKey>();
            bool IsSolidNow(StationCellKey key) {
                if (added.Contains(key)) return true;
                if (dropped.Contains(key)) return false;
                var cell = index.GetCell(key);
                return cell != null && cell.IsSolid;
            }
            // 1. Clear the bore: only the run's own footprint is removed.
            foreach (var bed in StationFootprints.TrackCells(track)) {
                for (int dz = 1; dz <= headroom; dz++) {
                    var key = new StationCellKey((int)Math.Round(bed.X), (int)Math.Round(bed.Y), (int)Math.Round(bed.Z) + dz);
                    if (!IsSolidNow(key)) continue;
                    dropped.Add(key);
                    writes.Add(StationCellWrite.Drop(key));
                }
            }
            string tag = Tag(track.Id);
            int width = Math.Max(1, track.Width);
            int depth = Math.Max(1, track.Depth);
            for (int i = 0; i < width; i++) {
                // Side walls run down to the dug bed, so their bottoms meet the recessed slab.
                for (int sideIdx = 0; sideIdx < 2; sideIdx++) {
                    int j = sideIdx == 0 ? -1 : depth;
                    StationFootprints.RotateLocal(track.Rotation, i, j, out var dx, out var dy);
                    int wx = track.X + (int)Math.Round(dx);
                    int wy = track.Y + (int)Math.Round(dy);
                    for (int dz = 0; dz <= headroom + 1; dz++) {
                        Want(writes, IsSolidNow, added, world, wx, wy, track.Z + dz, tag);
                    }
                }
                // The ceiling spans the bore.
                for (int j = 0; j < depth; j++) {
                    StationFootprints.RotateLocal(track.Rotation, i, j, out var dx, out var dy);
                    Want(writes, IsSolidNow, added, world, track.X + (int)Math.Round(dx), track.Y + (int)Math.Round(dy),
                        track.Z + headroom + 1, tag);
                }
            }
            return writes;
        }

        /// <summary>`stripTunnelShell`: drop every cell the given bore owns.</summary>
        public static List<StationCellWrite> Strip(StationIndex index, string trackId) {
            var writes = new List<StationCellWrite>();
            if (index == null || string.IsNullOrEmpty(trackId)) return writes;
            string tag = Tag(trackId);
            foreach (var cell in index.Document.Cells) {
                if (cell?.Tags == null || cell.Tags.Count == 0) continue;
                bool owned = false;
                foreach (var cellTag in cell.Tags) {
                    if (!string.Equals(cellTag, tag, StringComparison.Ordinal)) continue;
                    owned = true;
                    break;
                }
                if (owned) writes.Add(StationCellWrite.Drop(cell.Key));
            }
            return writes;
        }

        static void Want(List<StationCellWrite> writes, Func<StationCellKey, bool> isSolidNow, HashSet<StationCellKey> added,
            StationCellEditWorld world, int x, int y, int z, string tag) {
            var key = new StationCellKey(x, y, z);
            if (isSolidNow(key)) return;
            if (world != null && world.IsOpening(x, y, z)) return;
            added.Add(key);
            writes.Add(StationCellWrite.Set(key, false, tag));
        }
    }
}
