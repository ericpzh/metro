using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// A bridge's own supports (`build/model/BridgePillars.ts`): one **thick** centre pier per
    /// complete eight-metre bay, standing on the highest solid cell under the deck (or the street),
    /// and skipping a bay another pillar already carries. The pier is the bridge's, not the
    /// player's: its id names the bridge and its bay (`&lt;bridge&gt;:pillar:&lt;i&gt;`) and its cfg names
    /// the bridge it belongs to, so re-cutting the bridge can take its piers with it.
    ///
    /// This file derives the piers; the bridge **tool** that would place them is not ported yet.
    /// </summary>
    public static class StationBridgePillars {
        /// <summary>The deck's own depth, metres (`BRIDGE_DECK_DEPTH`).</summary>
        public const double DeckDepth = 1;
        /// <summary>The bridge's deck clears the street slab, whose top is z = 1.</summary>
        public const double MinZ = DeckDepth + 1;
        /// <summary>One pier per eight-metre bay, four metres in from the end.</summary>
        public const int Bay = 8;

        public static string PillarId(string bridgeId, int index) => (bridgeId ?? "") + ":pillar:" + index;

        /// <summary>
        /// `bridgePillarCandidates`: the piers this bridge still needs, bottom up. A bay keeps its
        /// id, so a pier the player removed (`removedBridgePillars`) is never put back.
        /// </summary>
        public static List<StationEditDraft> Candidates(StationIndex index, StationModuleRecord bridge) {
            var pillars = new List<StationEditDraft>();
            if (index == null || bridge == null) return pillars;
            if (!string.Equals(bridge.Type, "track", StringComparison.Ordinal)) return pillars;
            if (!bridge.Config.Has("bridge")) return pillars;
            var removed = new HashSet<string>(StringComparer.Ordinal);
            var text = bridge.Config.Text("removedBridgePillars");
            if (!string.IsNullOrEmpty(text)) {
                int at = 0;
                while (at < text.Length) {
                    int open = text.IndexOf('"', at);
                    if (open < 0) break;
                    int close = text.IndexOf('"', open + 1);
                    if (close < 0) break;
                    removed.Add(text.Substring(open + 1, close - open - 1));
                    at = close + 1;
                }
            }
            // A column another pillar already carries needs no pier.
            var supported = new HashSet<string>(StringComparer.Ordinal);
            foreach (var module in index.Document.Modules) {
                if (module == null || module.Type != "pillar") continue;
                if (!PillarSupportsBridge(module, bridge)) continue;
                supported.Add(module.X + "," + module.Y);
            }
            double maxBase = bridge.Z - DeckDepth - 2;
            int depth = Math.Max(1, bridge.Depth);
            for (int i = 4; i + 4 <= bridge.Width; i += Bay) {
                string id = PillarId(bridge.Id, i);
                if (removed.Contains(id)) continue;
                StationFootprints.RotateLocal(bridge.Rotation, i, Math.Floor(depth / 2.0), out var dx, out var dy);
                int x = bridge.X + (int)Math.Round(dx);
                int y = bridge.Y + (int)Math.Round(dy);
                if (supported.Contains(x + "," + y)) continue;
                double best = double.NegativeInfinity;
                foreach (var cell in index.Document.Cells) {
                    if (cell == null || !cell.IsSolid || cell.X != x || cell.Y != y) continue;
                    if (cell.Z > maxBase) continue;
                    if (cell.Z > best) best = cell.Z;
                }
                double ground = Math.Round(StationFootprints.GroundZ);
                if (ground <= maxBase && ground > best && !StationFootprints.IsGroundHole(index, x, y)) best = ground;
                if (double.IsNegativeInfinity(best)) continue;
                var pillar = new StationEditDraft {
                    Type = "pillar", X = x, Y = y, Z = (int)Math.Round(best), Rotation = 0,
                    Id = id,
                };
                pillar.Set("size", "thick");
                pillar.Set("height", Number(bridge.Z - best));
                pillar.Set("bridgeId", bridge.Id);
                pillars.Add(pillar);
            }
            return pillars;
        }

        /// <summary>`pillarSupportsBridge`: a pillar whose top meets the deck, under the track's own cell.</summary>
        public static bool PillarSupportsBridge(StationModuleRecord pillar, StationModuleRecord bridge) {
            if (pillar == null || bridge == null) return false;
            if (!string.Equals(pillar.Type, "pillar", StringComparison.Ordinal)) return false;
            if (!bridge.Config.Has("bridge")) return false;
            double height = pillar.Config.Number("height", 0);
            if (Math.Abs(pillar.Z + height - bridge.Z) > 1e-6) return false;
            foreach (var cell in StationFootprints.TrackCells(bridge)) {
                if ((int)Math.Round(cell.X) == pillar.X && (int)Math.Round(cell.Y) == pillar.Y &&
                    (int)Math.Round(cell.Z) == bridge.Z) return true;
            }
            return false;
        }

        static string Number(double value) =>
            value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
    }
}
