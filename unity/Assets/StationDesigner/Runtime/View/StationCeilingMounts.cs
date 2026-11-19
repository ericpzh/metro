using System;
using System.Collections.Generic;
using System.Globalization;
using Metro.Build;

namespace Metro.View {
    /// <summary>
    /// Where a **hung** piece hangs from — the port of
    /// <c>sim/placement.ts:hangCeilingLocal</c> and its two support readers
    /// (<c>topBlockOver</c>, <c>trackCeilingAt</c>) that RCA 15 §1 found missing from
    /// the Unity path.
    ///
    /// The saved <c>z</c> of a ceiling fixture is the **floor it hangs above**, not the
    /// elevation its geometry ends up at: `light-rectangular-401` is saved at
    /// <c>z = −1</c> with <c>ceilingAnchored: true</c>, so its ceiling is the street plane
    /// at elevation 0 and its body occupies 0 to −0.08. The generic catalogue placement
    /// cannot answer that on its own — it adds the prefab's own origin offset and has no
    /// idea where the support is — which is how ceiling lights and a CCTV ended up
    /// standing at ground level.
    ///
    /// The source answers in three ordered branches, and this class keeps that order:
    /// 1. an **authored ceiling anchor** (`ceilingAnchored`) hangs from the cell's own top,
    ///    so the local height is zero and the body hangs its own drop;
    /// 2. a **top block directly over the piece's own cell** — a solid cell, the virtual
    ///    street, or a 站台 / 轨道桥 bed — *is* the ceiling, so again local zero. A slab
    ///    over a dug-out platform bed leaves no solid cell, which is why the rail deck has
    ///    to be read from the module list;
    /// 3. with neither, the family's own fallback (a light's nominal ceiling line, or one
    ///    storey less a metre). The source's full slab scan (`ceilingMountHeight`) is not
    ///    needed for a branch-3 answer that no authored record in the Zoo fixture reaches;
    ///    it is reported as <see cref="SupportKind.Fallback"/> rather than guessed.
    /// </summary>
    public sealed class StationCeilingMounts {
        /// <summary>The rail deck hangs one metre below its anchor (`BRIDGE_DECK_DEPTH`).</summary>
        public const double BridgeDeckDepth = 1;

        /// <summary>The generated street plane (`GROUND_Z`).</summary>
        public const int GroundZ = 0;

        /// <summary>`DIGITAL_CLOCK_ROD_OFFSET` in `sim/hangers.ts`.</summary>
        public const double DigitalClockRodOffset = 0.32;

        /// <summary>`DIGITAL_CLOCK_MOUNT_WIDTH` in `sim/hangers.ts`.</summary>
        public const double DigitalClockMountWidth = 0.09;

        const double Epsilon = 1e-9;

        /// <summary>Which of the source's ordered branches answered.</summary>
        public enum SupportKind {
            /// <summary>`ceilingAnchored` on the saved record.</summary>
            AuthoredAnchor,
            /// <summary>A solid cell directly over the piece's own cell.</summary>
            OverheadSolid,
            /// <summary>A 站台 / 轨道桥 bed directly over the piece's own cell.</summary>
            OverheadTrackDeck,
            /// <summary>The virtual street plane directly over the piece's own cell.</summary>
            OverheadGround,
            /// <summary>An authored roof hanger (`mount == "roof"`) carrying the piece at 4 m local (`3 + 1` uplift).</summary>
            HangerRoof,
            /// <summary>An authored post hanger (`mount != "roof"`) carrying the piece at 3 m local.</summary>
            HangerPost,
            /// <summary>Nearest exposed solid underside above the footprint (`ceilingMountHeight`).</summary>
            CeilingSolid,
            /// <summary>Nearest exposed 站台 / 轨道桥 deck underside above the footprint (`ceilingMountHeight`).</summary>
            CeilingTrackDeck,
            /// <summary>Unexcavated virtual street underside above the footprint (`ceilingMountHeight`).</summary>
            CeilingGround,
            /// <summary>Nothing overhead: the family fallback stands in.</summary>
            Fallback,
        }

        /// <summary>The resolved mount of one module.</summary>
        public readonly struct Mount {
            /// <summary>The branch that answered.</summary>
            public readonly SupportKind Support;
            /// <summary>Height of the hung surface above the cell's own floor top, in metres.</summary>
            public readonly double Local;
            /// <summary>The hung surface's document elevation (`module.Z + 1 + Local`).</summary>
            public readonly double Underside;
            internal Mount(SupportKind support, double local, double z) {
                Support = support;
                Local = local;
                Underside = z + 1 + local;
            }
            public string SupportName {
                get {
                    switch (Support) {
                        case SupportKind.AuthoredAnchor: return "authored-anchor";
                        case SupportKind.OverheadSolid: return "overhead-solid";
                        case SupportKind.OverheadTrackDeck: return "overhead-track-deck";
                        case SupportKind.OverheadGround: return "overhead-ground";
                        case SupportKind.HangerRoof: return "hanger-roof";
                        case SupportKind.HangerPost: return "hanger-post";
                        case SupportKind.CeilingSolid: return "ceiling-solid";
                        case SupportKind.CeilingTrackDeck: return "ceiling-track-deck";
                        case SupportKind.CeilingGround: return "ceiling-ground";
                        default: return "fallback";
                    }
                }
            }
            public override string ToString() => SupportName + " local=" + Local.ToString("0.###", CultureInfo.InvariantCulture) +
                " underside=" + Underside.ToString("0.###", CultureInfo.InvariantCulture);
        }

        readonly HashSet<long> solids = new HashSet<long>();
        readonly HashSet<long> groundVoids = new HashSet<long>();
        readonly Dictionary<long, List<int>> undersides = new Dictionary<long, List<int>>();
        readonly List<ModuleFacts> tracks = new List<ModuleFacts>();
        readonly List<ModuleFacts> hangers = new List<ModuleFacts>();
        StationIndex backingIndex;

        /// <summary>
        /// Zero-scan index-backed ceiling mount lookup: queries <see cref="StationIndex.GetCell"/>
        /// and <see cref="StationIndex.ModulesOfType"/> on demand in O(column height).
        /// </summary>
        public static StationCeilingMounts ForIndex(StationIndex index) {
            if (index == null) return new StationCeilingMounts();
            var mounts = new StationCeilingMounts { backingIndex = index };
            var trackRecords = index.ModulesOfType("track");
            for (int i = 0; i < trackRecords.Count; i++) {
                var m = trackRecords[i];
                if (m != null && IsCeilingTrack(m.Facts)) mounts.tracks.Add(m.Facts);
            }
            var hangerRecords = index.ModulesOfType("hanger");
            for (int i = 0; i < hangerRecords.Count; i++) {
                var m = hangerRecords[i];
                if (m?.Facts != null) mounts.hangers.Add(m.Facts);
            }
            return mounts;
        }

        /// <summary>
        /// Build the lookup once per committed document. Zoo has 14,066 cells, so the
        /// per-fixture question must be a hash test rather than a scan of the cell list.
        /// </summary>
        public static StationCeilingMounts For(StationDocument document) {
            var mounts = new StationCeilingMounts();
            if (document == null) return mounts;
            var cells = document.Cells;
            for (int i = 0; i < cells.Count; i++) {
                var cell = cells[i];
                if (cell.IsSolid) mounts.solids.Add(Key(cell.X, cell.Y, cell.Z));
                else if (cell.Z == GroundZ) mounts.groundVoids.Add(Key(cell.X, cell.Y, cell.Z));
            }
            for (int i = 0; i < cells.Count; i++) {
                var cell = cells[i];
                if (!cell.IsSolid || mounts.solids.Contains(Key(cell.X, cell.Y, cell.Z - 1))) continue;
                long col = ColumnKey(cell.X, cell.Y);
                if (!mounts.undersides.TryGetValue(col, out var list)) {
                    list = new List<int>();
                    mounts.undersides[col] = list;
                }
                if (!list.Contains(cell.Z)) list.Add(cell.Z);
            }
            var modules = document.Modules;
            for (int i = 0; i < modules.Count; i++) {
                var module = modules[i];
                if (IsCeilingTrack(module.Facts)) mounts.tracks.Add(module.Facts);
                else if (string.Equals(module.Type, "hanger", StringComparison.Ordinal)) mounts.hangers.Add(module.Facts);
            }
            return mounts;
        }

        /// <summary>
        /// Port of <c>isCeilingTrack</c>: a 站台 or 轨道桥 bed can ceiling a fitting. A tunnel
        /// raises its own shell ceiling, so it is left to the solid-cell rule.
        /// </summary>
        public static bool IsCeilingTrack(ModuleFacts module) =>
            module != null && string.Equals(module.Type, "track", StringComparison.Ordinal) &&
            !module.Config.Bool("tunnel");

        /// <summary>The underside a ceiling track hangs a fitting from (port of `trackCeilingUnderside`).</summary>
        public static double TrackCeilingUnderside(ModuleFacts module) => module.Z - BridgeDeckDepth;

        /// <summary>Port of `trackCellAt`: is `(x, y, z)` one of this track's bed cells?</summary>
        public static bool TrackCellAt(ModuleFacts track, double x, double y, double z) {
            if (track == null || Math.Abs(z - track.Z) > Epsilon) return false;
            RotateLocal(-track.Rotation, x - track.X, y - track.Y, out var i, out var j);
            double depth = Math.Max(1, track.Depth);
            return i >= -Epsilon && i < track.Width - Epsilon && j >= -Epsilon && j < depth - Epsilon;
        }

        /// <summary>Port of `rotateLocal`: a local offset turned counter-clockwise by `rot`.</summary>
        public static void RotateLocal(int rotation, double i, double j, out double x, out double y) {
            switch (((rotation % 4) + 4) % 4) {
                case 1: x = -j; y = i; return;
                case 2: x = -i; y = -j; return;
                case 3: x = j; y = -i; return;
                default: x = i; y = j; return;
            }
        }

        /// <summary>True for an explicit solid cell.</summary>
        public bool SolidAt(int x, int y, int z) =>
            backingIndex != null ? backingIndex.GetCell(x, y, z)?.IsSolid == true : solids.Contains(Key(x, y, z));

        public bool VirtualSolidAt(int x, int y, int z) {
            if (z != GroundZ) return false;
            if (backingIndex != null) {
                var c = backingIndex.GetCell(x, y, z);
                return c == null || c.IsSolid;
            }
            return !groundVoids.Contains(Key(x, y, z));
        }

        bool SolidOrStreet(int x, int y, int z) => SolidAt(x, y, z) || VirtualSolidAt(x, y, z);

        /// <summary>Port of `trackCeilingAt`: a rail deck over `(x, y)` whose underside is `z`.</summary>
        public bool TrackCeilingAt(double x, double y, double z) {
            for (int i = 0; i < tracks.Count; i++) {
                var track = tracks[i];
                if (Math.Abs(TrackCeilingUnderside(track) - z) > Epsilon) continue;
                if (TrackCellAt(track, x, y, track.Z)) return true;
            }
            return false;
        }

        /// <summary>
        /// Port of <c>topBlockOver</c>: a solid cell, the street plane or a rail deck sits
        /// directly over the piece's own cell, so that block *is* its ceiling.
        /// </summary>
        public bool TopBlockOver(ModuleFacts module, out SupportKind kind) {
            kind = SupportKind.OverheadSolid;
            if (module == null) return false;
            if (SolidAt(module.X, module.Y, module.Z + 1)) {
                kind = SupportKind.OverheadSolid;
                return true;
            }
            if (VirtualSolidAt(module.X, module.Y, module.Z + 1)) {
                kind = SupportKind.OverheadGround;
                return true;
            }
            if (TrackCeilingAt(module.X, module.Y, module.Z + 1)) {
                kind = SupportKind.OverheadTrackDeck;
                return true;
            }
            return false;
        }

        /// <summary>
        /// Port of <c>hangers.ts:hangerCells</c>: the rotated plan cells a hanger crossbar spans.
        /// </summary>
        public static (int X, int Y)[] HangerCells(ModuleFacts hanger) {
            if (hanger == null) return Array.Empty<(int X, int Y)>();
            int width = Math.Max(1, hanger.Width);
            var cells = new (int X, int Y)[width];
            for (int i = 0; i < width; i++) {
                RotateLocal(hanger.Rotation, i, 0, out var dx, out var dy);
                cells[i] = (hanger.X + (int)Math.Round(dx), hanger.Y + (int)Math.Round(dy));
            }
            return cells;
        }

        /// <summary>
        /// Port of <c>hangers.ts:hangerSupports</c>: hanging rods must land on the bar centreline
        /// and stay inside the crossbar span.
        /// </summary>
        public static bool HangerSupports(ModuleFacts hanger, ModuleFacts item) {
            if (hanger == null || item == null) return false;
            if (!string.Equals(hanger.Type, "hanger", StringComparison.Ordinal) || hanger.Z != item.Z) return false;
            bool isTv = string.Equals(item.Type, "tv", StringComparison.Ordinal);
            bool isClock = string.Equals(item.Type, "clock", StringComparison.Ordinal);
            bool isCctv = string.Equals(item.Type, "cctv", StringComparison.Ordinal);
            bool isHungSign = string.Equals(item.Type, "sign", StringComparison.Ordinal) &&
                !string.Equals(item.Config.Text("mount"), "wall", StringComparison.Ordinal);
            if (!isTv && !isClock && !isCctv && !isHungSign) return false;

            var run = HangerCells(hanger);
            bool onRun = false;
            for (int i = 0; i < run.Length; i++) {
                if (run[i].X == item.X && run[i].Y == item.Y) { onRun = true; break; }
            }
            if (!onRun) return false;

            bool centredClock = isClock && !string.Equals(item.Config.Text("variant"), "digital", StringComparison.Ordinal);
            if (!centredClock && (item.Rotation - hanger.Rotation) % 2 != 0) return false;
            if (isCctv && string.Equals(item.Config.Text("variant"), "post", StringComparison.Ordinal)) return false;

            RotateLocal(-hanger.Rotation, item.X - hanger.X, item.Y - hanger.Y, out var along, out _);
            double rodHalf = isHungSign
                ? Math.Max(0.22, StationFootprints.SignBoardWidth(item.Config) * 0.5 - 0.35) + 0.08
                : isTv ? 0.5
                : isCctv ? 0.18
                : centredClock ? 0.075
                : DigitalClockRodOffset + DigitalClockMountWidth * 0.5;
            int width = Math.Max(1, hanger.Width);
            return along + 0.5 - rodHalf >= -Epsilon && along + 0.5 + rodHalf <= width + Epsilon;
        }

        /// <summary>
        /// Port of <c>hangCeilingLocal</c> + <c>ceilingMountHeight</c> + <c>hangerLiftFor</c>: the
        /// height of the surface a hung piece attaches to, measured above the cell's own floor top.
        /// For a roof hanger, the 1 m crossbar uplift (`3 + 1 = 4 m`) is included once here so both
        /// `StationSignView` and `PlaceCeilingFixture` share the exact beam datum without a second lift.
        /// </summary>
        public Mount Resolve(ModuleFacts module, double fallback) {
            if (module == null) return new Mount(SupportKind.Fallback, fallback, 0);
            if (module.CeilingAnchored) return new Mount(SupportKind.AuthoredAnchor, 0, module.Z);
            if (TopBlockOver(module, out var kind)) return new Mount(kind, 0, module.Z);
            if (StationFootprints.IsCeilingHung(module)) {
                bool anyHanger = false;
                bool roofHanger = false;
                for (int i = 0; i < hangers.Count; i++) {
                    var hanger = hangers[i];
                    if (!HangerSupports(hanger, module)) continue;
                    anyHanger = true;
                    if (string.Equals(hanger.Config.Text("mount"), "roof", StringComparison.Ordinal)) {
                        roofHanger = true;
                        break;
                    }
                }
                if (anyHanger) {
                    return roofHanger
                        ? new Mount(SupportKind.HangerRoof, 4, module.Z)
                        : new Mount(SupportKind.HangerPost, 3, module.Z);
                }
                if (TryNearestBacking(module, out double local, out var ceilingKind)) {
                    return new Mount(ceilingKind, local, module.Z);
                }
            }
            return new Mount(SupportKind.Fallback, fallback, module.Z);
        }

        bool TryNearestBacking(ModuleFacts candidate, out double local, out SupportKind kind) {
            local = 0;
            kind = SupportKind.CeilingSolid;
            var footprint = BaseCells(candidate);
            var first = footprint.Length > 0 ? footprint[0] : (X: candidate.X, Y: candidate.Y);
            var candidates = new List<double>();
            if (backingIndex != null) {
                var bounds = backingIndex.Bounds;
                if (!bounds.IsEmpty) {
                    int maxZ = bounds.MaxZ;
                    int minZ = candidate.Z + 2;
                    for (int zi = minZ; zi <= maxZ; zi++) {
                        if (SolidAt(first.X, first.Y, zi) && !SolidAt(first.X, first.Y, zi - 1)) {
                            AddDistinct(candidates, zi);
                        }
                    }
                }
            } else if (undersides.TryGetValue(ColumnKey(first.X, first.Y), out var column)) {
                for (int i = 0; i < column.Count; i++) {
                    if (column[i] > candidate.Z + 1) AddDistinct(candidates, column[i]);
                }
            }
            for (int i = 0; i < tracks.Count; i++) {
                var track = tracks[i];
                double underside = TrackCeilingUnderside(track);
                if (underside < candidate.Z + 2 - Epsilon) continue;
                if (TrackCellAt(track, first.X, first.Y, track.Z)) AddDistinct(candidates, underside);
            }
            if (GroundZ > candidate.Z + 1 && VirtualSolidAt(first.X, first.Y, GroundZ)) {
                AddDistinct(candidates, GroundZ);
            }
            if (candidates.Count == 0) return false;
            candidates.Sort();
            for (int c = 0; c < candidates.Count; c++) {
                double z = candidates[c];
                bool covered = true;
                for (int i = 0; i < footprint.Length; i++) {
                    int x = footprint[i].X, y = footprint[i].Y;
                    if (!BackingAt(x, y, z)) {
                        covered = false;
                        break;
                    }
                }
                if (!covered) continue;
                local = z - candidate.Z - 1;
                kind = ClassifyBacking(first.X, first.Y, z);
                return true;
            }
            return false;
        }

        bool BackingAt(int x, int y, double z) {
            int zi = (int)Math.Round(z);
            if (Math.Abs(z - zi) <= Epsilon && (SolidAt(x, y, zi) || VirtualSolidAt(x, y, zi))) return true;
            return TrackCeilingAt(x, y, z);
        }

        SupportKind ClassifyBacking(int x, int y, double z) {
            int zi = (int)Math.Round(z);
            if (Math.Abs(z - zi) <= Epsilon) {
                if (SolidAt(x, y, zi)) return SupportKind.CeilingSolid;
                if (VirtualSolidAt(x, y, zi)) return SupportKind.CeilingGround;
            }
            return SupportKind.CeilingTrackDeck;
        }

        static (int X, int Y)[] BaseCells(ModuleFacts module) {
            if (module == null) return Array.Empty<(int X, int Y)>();
            if (string.Equals(module.Type, "hanger", StringComparison.Ordinal)) return HangerCells(module);
            if (string.Equals(module.Type, "monitor", StringComparison.Ordinal) &&
                string.Equals(module.Config.Text("mount"), "wall", StringComparison.Ordinal)) {
                var cells = new (int X, int Y)[3];
                for (int i = 0; i < 3; i++) {
                    RotateLocal(module.Rotation, i, 0, out var dx, out var dy);
                    cells[i] = (module.X + (int)Math.Round(dx), module.Y + (int)Math.Round(dy));
                }
                return cells;
            }
            return new[] { (module.X, module.Y) };
        }

        static void AddDistinct(List<double> list, double value) {
            for (int i = 0; i < list.Count; i++) {
                if (Math.Abs(list[i] - value) <= Epsilon) return;
            }
            list.Add(value);
        }

        /// <summary>
        /// The family fallback the source passes into `hangCeilingLocal`:
        /// `LightModel` uses <c>lightCeilingZ(mod) − mod.z − 1</c> (zero when the record is
        /// ceiling-anchored, else one storey less a metre); every other hung piece uses one
        /// storey less a metre.
        /// </summary>
        public static double FallbackFor(ModuleFacts module, double storeyHeight) {
            if (module != null && (string.Equals(module.Type, "light", StringComparison.Ordinal))) {
                // `lightCeilingZ(m) - m.z - 1`: ceilingAnchored reads `m.z + 1`, else `m.z + storeyHeight`.
                double ceiling = module.CeilingAnchored ? module.Z + 1 : module.Z + storeyHeight;
                return ceiling - module.Z - 1;
            }
            return storeyHeight - 1;
        }

        /* ---------------------------------------------------------- the trace */

        /// <summary>
        /// Opt-in record of the mount decisions (RCA 15 §2's "log saved Z, selected support,
        /// prefab attach height, renderer bounds"). Off by default so the 174 Zoo fixtures do
        /// not flood a normal load; tests and the live Editor turn it on by id substring.
        /// </summary>
        public static string TraceFilter { get; set; }
        static readonly List<string> traceLines = new List<string>();
        public static IReadOnlyList<string> TraceLines => traceLines;
        public static void ClearTrace() => traceLines.Clear();

        public static void Trace(string moduleId, string line) {
            var filter = TraceFilter;
            if (string.IsNullOrEmpty(filter)) return;
            if (string.IsNullOrEmpty(moduleId) || moduleId.IndexOf(filter, StringComparison.Ordinal) < 0) return;
            traceLines.Add(moduleId + " " + line);
        }

        static long Key(int x, int y, int z) =>
            ((long)(x + 32768) << 40) | ((long)(y + 32768) << 20) | (long)(z + 32768);

        static long ColumnKey(int x, int y) =>
            ((long)(x + 32768) << 20) | (long)(y + 32768);
    }
}
