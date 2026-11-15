using System;
using System.Collections.Generic;
using System.Globalization;

namespace Metro.Build {
    /// <summary>
    /// One platform-screen doorway as the three families that must agree on it share
    /// it: the PSD run cut it, the floor vinyl under it, and the train door that stops
    /// opposite it.
    ///
    /// The identity is the edge id plus the opening's index along that run (and the run
    /// cell the source's door server seats, `round(runX)`). The world centre is the
    /// source's own rule, not a second derivation: `buildPsd` cuts the screen at
    /// `runX` along the edge, and `snapBoardingMark` puts the vinyl at that same
    /// position. Everything is document metres / plan axes (`(x, y)` plan, `z` as
    /// elevation), because both `Metro.Build` and the view layer consume it.
    /// </summary>
    public readonly struct StationDoorway {
        public readonly string EdgeId;
        /// <summary>0-based opening index along its run, as `PsdOpening.Index`.</summary>
        public readonly int Index;
        /// <summary>The run cell whose centre is nearest the doorway (`round(runX)`).</summary>
        public readonly int Cell;
        /// <summary>Metres from the edge's first cell origin along the run (`PsdOpening.Centre`).</summary>
        public readonly double RunX;
        /// <summary>The clear opening width (`PsdOpening.Width`).</summary>
        public readonly double Width;
        /// <summary>Document plan centre of the screen opening at the floor top.</summary>
        public readonly double X;
        public readonly double Y;
        public readonly double Z;
        /// <summary>The floor vinyl's centre: <see cref="X"/> + 0.02 m toward the platform.</summary>
        public readonly double MarkX;
        public readonly double MarkY;
        /// <summary>The floor vinyl's saved rotation for this bank (`edge.rot`, +2 on a left bank).</summary>
        public readonly int MarkRotation;

        public StationDoorway(string edgeId, int index, int cell, double runX, double width,
            double x, double y, double z, double markX, double markY, int markRotation) {
            EdgeId = edgeId ?? "";
            Index = index;
            Cell = cell;
            RunX = runX;
            Width = width;
            X = x;
            Y = y;
            Z = z;
            MarkX = markX;
            MarkY = markY;
            MarkRotation = markRotation;
        }

        public override string ToString() {
            var invariant = CultureInfo.InvariantCulture;
            return EdgeId + "#" + Index.ToString(invariant) + " runX=" + RunX.ToString("0.###", invariant) +
                " w=" + Width.ToString("0.###", invariant) + " at " + X.ToString("0.###", invariant) + "," +
                Y.ToString("0.###", invariant) + " z=" + Z.ToString("0.###", invariant);
        }
    }

    /// <summary>
    /// The one doorway-centre rule shared by `OpeningModuleViews` (the PSD run and its
    /// printed slots), the surface renderer's floor-mark placement, and the future
    /// placement resolver's `snapBoardingMark` port.
    ///
    /// Source constants: `PSD_WALL_OFFSET = .34`, `PSD_BASE_DEPTH = .18` (the plinth /
    /// inset strip) and the vinyl's 2 cm plate offset from `snapBoardingMark`'s
    /// `rotateLocal(edge.rot, dx, toward * -0.02)`.
    /// </summary>
    public static class StationPlatformDoorways {
        /// <summary>`sim/constants.ts:PSD_WALL_OFFSET`.</summary>
        public const double WallOffset = .34;
        /// <summary>`sim/constants.ts:PSD_BASE_DEPTH`.</summary>
        public const double BaseDepth = .18;
        /// <summary>The floor vinyl's offset toward the platform (`snapBoardingMark`: 0.02 m).</summary>
        public const double PlateOffset = .02;
        /// <summary>`snapBoardingMark`'s 1.5 m same-storey snap radius.</summary>
        public const double SnapRadius = 1.5;

        /// <summary>`cfg.side`: +1 when the platform is on the run's local +y, −1 otherwise.</summary>
        public static int TowardSign(ModuleConfig cfg) =>
            cfg != null && string.Equals(cfg.Text("side"), "right", StringComparison.Ordinal) ? 1 : -1;

        /// <summary>
        /// `snapBoardingMark`'s vinyl rotation: the edge keeps its own turn on a right
        /// bank and is turned end for end on a left bank, because the platform is on the
        /// other side of the screen.
        /// </summary>
        public static int MarkRotation(int rotation, string side) =>
            StationFootprints.NormRot(rotation + (string.Equals(side, "right", StringComparison.Ordinal) ? 0 : 2));

        /// <summary>The floor vinyl's rotation for a saved edge record.</summary>
        public static int MarkRotation(StationModuleRecord edge) =>
            edge == null ? 0 : MarkRotation(edge.Rotation, edge.Config.Text("side"));

        /// <summary>
        /// The doorway at `runX` on a saved edge, in document metres. This is the one
        /// arithmetic both `buildPsd` and `snapBoardingMark` perform:
        /// <c>(edge.x + .5, edge.y + .5) + rotateLocal(edge.rot, runX, toward * −.02)</c>
        /// for the vinyl, with the screen opening at the same centre without the plate
        /// offset. `runX` is `PsdOpening.Centre` (run-local metres from the edge's first
        /// cell origin).
        /// </summary>
        public static StationDoorway At(string edgeId, int index, int x, int y, int z, int rotation, string side,
            double runX, double width) {
            int toward = string.Equals(side, "right", StringComparison.Ordinal) ? 1 : -1;
            StationFootprints.RotateLocal(rotation, runX, 0, out var ox, out var oy);
            StationFootprints.RotateLocal(rotation, 0, toward * -PlateOffset, out var px, out var py);
            return new StationDoorway(edgeId, index, (int)Math.Round(runX, MidpointRounding.AwayFromZero),
                runX, width, x + .5 + ox, y + .5 + oy, z + 1,
                x + .5 + ox + px, y + .5 + oy + py, MarkRotation(rotation, side));
        }

        /// <summary>The doorway of a saved edge record.</summary>
        public static StationDoorway At(StationModuleRecord edge, int index, double runX, double width) {
            if (edge == null) throw new ArgumentNullException(nameof(edge));
            return At(edge.Id, index, edge.X, edge.Y, edge.Z, edge.Rotation,
                edge.Config.Text("side"), runX, width);
        }

        /// <summary>The floor vinyl's exact centre (the source `floorDecorBounds` centre).</summary>
        public static StationPoint MarkCentre(StationModuleRecord mark) {
            var bounds = StationFootprints.FloorDecorBounds(mark);
            return new StationPoint((bounds.X0 + bounds.X1) * .5, (bounds.Y0 + bounds.Y1) * .5, mark.Z + 1);
        }

        /// <summary>
        /// The placed mark group's origin: the cell centre plus `cfg.offset` in **document
        /// axes**. `FloorMarkModel.build` adds the offset to the group's `position.x/y`
        /// after `placeLocal`, so it is a world offset, never rotated by the mark's turn.
        /// </summary>
        public static StationPoint MarkOrigin(StationModuleRecord mark) =>
            new StationPoint(mark.X + .5 + mark.OffsetX, mark.Y + .5 + mark.OffsetY, mark.Z + 1);

        /// <summary>
        /// Read a floor mark's `cfg.offset` from the flattened config (`{x, y}`; a PSD end
        /// cover's `[u, v]` array is not a floor-mark offset). Absent or malformed is
        /// false and leaves the mark on its cell centre, exactly as the source does.
        /// </summary>
        public static bool TryMarkOffset(ModuleConfig cfg, out double x, out double y) {
            x = 0;
            y = 0;
            if (cfg == null) return false;
            var text = (cfg.Json("offset") ?? "").Trim();
            if (text.Length < 5 || text[0] != '{') return false;
            bool hasX = TryJsonNumber(text, "x", out x);
            bool hasY = TryJsonNumber(text, "y", out y);
            return hasX || hasY;
        }

        /// <summary>
        /// The nearest doorway whose vinyl centre is within `SnapRadius` of this mark's
        /// authored centre. False preserves the authored, unbound marker exactly where TS
        /// leaves it unbound (`snapBoardingMark` returns the mark unchanged).
        /// </summary>
        public static bool TryNearest(StationModuleRecord mark, IReadOnlyList<StationDoorway> doorways,
            out StationDoorway nearest) {
            nearest = default;
            if (mark == null || doorways == null || doorways.Count == 0) return false;
            var centre = MarkCentre(mark);
            double best = SnapRadius;
            bool found = false;
            for (int i = 0; i < doorways.Count; i++) {
                var door = doorways[i];
                double dx = door.MarkX - centre.X;
                double dy = door.MarkY - centre.Y;
                double distance = Math.Sqrt(dx * dx + dy * dy);
                // `snapBoardingMark` is strict (`d < distance`), so exactly 1.5 m is unbound.
                if (distance >= best) continue;
                best = distance;
                nearest = door;
                found = true;
            }
            return found;
        }

        static bool TryJsonNumber(string text, string key, out double value) {
            value = 0;
            int at = text.IndexOf("\"" + key + "\"", StringComparison.Ordinal);
            if (at < 0) return false;
            int i = at + key.Length + 2;
            while (i < text.Length && (text[i] == ':' || char.IsWhiteSpace(text[i]))) i++;
            int start = i;
            while (i < text.Length && (char.IsDigit(text[i]) || text[i] == '-' || text[i] == '+' ||
                                       text[i] == '.' || text[i] == 'e' || text[i] == 'E')) i++;
            return i > start && double.TryParse(text.Substring(start, i - start), NumberStyles.Float,
                CultureInfo.InvariantCulture, out value);
        }
    }
}
