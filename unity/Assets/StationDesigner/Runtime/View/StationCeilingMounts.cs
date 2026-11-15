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
                        default: return "fallback";
                    }
                }
            }
            public override string ToString() => SupportName + " local=" + Local.ToString("0.###", CultureInfo.InvariantCulture) +
                " underside=" + Underside.ToString("0.###", CultureInfo.InvariantCulture);
        }

        readonly HashSet<long> solids = new HashSet<long>();
        readonly HashSet<long> groundVoids = new HashSet<long>();
        readonly List<ModuleFacts> tracks = new List<ModuleFacts>();

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
            var modules = document.Modules;
            for (int i = 0; i < modules.Count; i++) {
                var module = modules[i];
                if (IsCeilingTrack(module.Facts)) mounts.tracks.Add(module.Facts);
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
        public bool SolidAt(int x, int y, int z) => solids.Contains(Key(x, y, z));

        /// <summary>
        /// Port of `virtualSolidAt`: the generated street at <see cref="GroundZ"/> counts as
        /// solid unless the document dug a hole there.
        ///
        /// The source's hole rule also subtracts ramp and exit openings
        /// (`ground.ts:groundHoleReader`). Those derivations are not ported by this packet
        /// (`StationCellRenderer.BuildInput` reports `ramp-opening-not-derived`), so a hole
        /// under an exit head-house or a ramp reads as street here. That is a named gap, not
        /// a silent one: it can only *add* support, never move a fixture the authored anchor
        /// or a solid/track block already answers.
        /// </summary>
        public bool VirtualSolidAt(int x, int y, int z) => z == GroundZ && !groundVoids.Contains(Key(x, y, z));

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
        /// Port of <c>hangCeilingLocal</c>: the height of the surface a hung piece hangs from,
        /// measured above the cell's own floor top. The callers pass their family's fallback
        /// from <see cref="FallbackFor"/>, exactly as the source does for a 灯具 / 风口.
        /// </summary>
        public Mount Resolve(ModuleFacts module, double fallback) {
            if (module == null) return new Mount(SupportKind.Fallback, fallback, 0);
            if (module.CeilingAnchored) return new Mount(SupportKind.AuthoredAnchor, 0, module.Z);
            if (TopBlockOver(module, out var kind)) return new Mount(kind, 0, module.Z);
            return new Mount(SupportKind.Fallback, fallback, module.Z);
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
    }
}
