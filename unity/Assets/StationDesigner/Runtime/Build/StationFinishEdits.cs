using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Metro.Build {
    // Plan 11, packet E - the surface model's shared rules and the paint edits.
    //
    // This file is the engine-free half of packet E (Metro.Build has no UnityEngine
    // reference):
    //
    //   * `StationFace` / `StationCellShape` / `StationCellRules` - the one port of
    //     `sim/types.ts`'s shape helpers (`wallCutMask`, `shapeOf`, `cutRectangles`,
    //     `wallShapeBounds`, `cutInnerFaces`, `triangleSlopeFace`,
    //     `halfWallInnerFace`) and of `sim/contactFinishes.ts`'s `contactFaceCovered`.
    //     E1's mesher and E3's brush both read these, so a face the mesher draws and
    //     a face the brush offers cannot disagree.
    //   * `StationFinishIds` - the custom-tint finish id (`wall.enamel#ff4242`) rules
    //     from `sim/finishes.ts` (`customFinishId`, `finishBaseId`, `finishTint`).
    //   * `StationPaintSnapshot` - the committed station as the brush reads it, built
    //     from packet A's `StationDocument`/`StationIndex` records (one set of record
    //     types for the whole loader) plus the module-derived street holes.
    //   * `StationFinishEdits` - the port of `build/model/Paint.ts`: `facePresent`,
    //     `paintFace`/`paintFaces`, `eraseFace`/`eraseFaces`, `fillSurface`, plus the
    //     drag rectangle from `app/tools/geometry/faces.ts` (`planeCells`,
    //     `faceTargets`, `dominantFace`) and the tool's press/release rules from
    //     `app/tools/PaintTool.ts`.
    //
    // The edit is returned as data (`StationPaintResult.Writes`), never applied here:
    // C# owns the committed revision (plan 11 contract), so the host validates
    // `ExpectedRevision` against its own revision, applies the writes to its document
    // and increments revision itself. `ToJson` emits the `face.paint` payload shape
    // published in the handoff.

    /// <summary>One of a cell's six faces, in the source's own names (`sim/types.ts`).</summary>
    public enum StationFace { Top = 0, Bottom = 1, N = 2, E = 3, S = 4, W = 5 }

    /// <summary>The four compass sides a half wall, thin corner or wedge hugs (`WallSide`).</summary>
    public enum StationWallSide { N = 0, E = 1, S = 2, W = 3 }

    /// <summary>Which half of the cell a  wedge is (`TriangleKind`).</summary>
    public enum StationTriangleKind { Upper = 0, Lower = 1 }

    /// <summary>
    /// The shape a solid cell draws, normalized exactly as `shapeFromCutMask` /
    /// `shapeOf` do: a whole block (Full), a  panel, a  quarter, the
    /// compound `Cuts` arrangement, or a  wedge.
    /// </summary>
    public enum StationShapeKind { Full = 0, Half = 1, Corner = 2, Cuts = 3, Triangle = 4 }

    public static class StationFaces {
        public static readonly StationFace[] All = {
            StationFace.Top, StationFace.Bottom, StationFace.N, StationFace.E, StationFace.S, StationFace.W,
        };

        public static string Name(StationFace face) => face switch {
            StationFace.Top => "top",
            StationFace.Bottom => "bottom",
            StationFace.N => "n",
            StationFace.E => "e",
            StationFace.S => "s",
            StationFace.W => "w",
            _ => throw new ArgumentOutOfRangeException(nameof(face)),
        };

        public static bool TryParse(string name, out StationFace face) {
            switch (name) {
                case "top": face = StationFace.Top; return true;
                case "bottom": face = StationFace.Bottom; return true;
                case "n": face = StationFace.N; return true;
                case "e": face = StationFace.E; return true;
                case "s": face = StationFace.S; return true;
                case "w": face = StationFace.W; return true;
                default: face = StationFace.Top; return false;
            }
        }

        /// <summary>The neighbour step a face looks out on (`FACE_STEP`).</summary>
        public static void Step(StationFace face, out int dx, out int dy, out int dz) {
            switch (face) {
                case StationFace.Top: dx = 0; dy = 0; dz = 1; return;
                case StationFace.Bottom: dx = 0; dy = 0; dz = -1; return;
                case StationFace.N: dx = 0; dy = 1; dz = 0; return;
                case StationFace.S: dx = 0; dy = -1; dz = 0; return;
                case StationFace.E: dx = 1; dy = 0; dz = 0; return;
                default: dx = -1; dy = 0; dz = 0; return;
            }
        }

        /// <summary>The two in-plane axes of a face, as the four steps a flood walks (`FACE_PLANE`).</summary>
        public static void Plane(StationFace face, out int ax, out int ay, out int az, out int bx, out int by, out int bz) {
            switch (face) {
                case StationFace.Top:
                case StationFace.Bottom: ax = 1; ay = 0; az = 0; bx = 0; by = 1; bz = 0; return;
                case StationFace.E:
                case StationFace.W: ax = 0; ay = 1; az = 0; bx = 0; by = 0; bz = 1; return;
                default: ax = 1; ay = 0; az = 0; bx = 0; by = 0; bz = 1; return;
            }
        }

        /// <summary>
        /// The face a picked normal belongs to: the axis it most points along, ties
        /// going vertical then across (`render/pickCell.ts` `faceAxis`).
        /// </summary>
        public static StationFace OfNormal(float nx, float ny, float nz) {
            var ax = Math.Abs(nx);
            var ay = Math.Abs(ny);
            var az = Math.Abs(nz);
            if (az >= ax && az >= ay) return nz >= 0 ? StationFace.Top : StationFace.Bottom;
            if (ax >= ay) return nx >= 0 ? StationFace.E : StationFace.W;
            return ny >= 0 ? StationFace.N : StationFace.S;
        }

        public static StationWallSide SideOf(float nx, float ny) {
            if (Math.Abs(nx) >= Math.Abs(ny)) return nx >= 0 ? StationWallSide.E : StationWallSide.W;
            return ny >= 0 ? StationWallSide.N : StationWallSide.S;
        }

        public static StationWallSide Side(StationFace face) => face switch {
            StationFace.N => StationWallSide.N,
            StationFace.E => StationWallSide.E,
            StationFace.S => StationWallSide.S,
            StationFace.W => StationWallSide.W,
            _ => throw new ArgumentOutOfRangeException(nameof(face), "A horizontal face has no compass side"),
        };

        public static StationFace FaceOfSide(StationWallSide side) => side switch {
            StationWallSide.N => StationFace.N,
            StationWallSide.E => StationFace.E,
            StationWallSide.S => StationFace.S,
            _ => StationFace.W,
        };

        /// <summary>The side a clockwise quarter turn steps to (source `SIDE_CW`).</summary>
        public static StationWallSide Clockwise(StationWallSide side) => side switch {
            StationWallSide.N => StationWallSide.E,
            StationWallSide.E => StationWallSide.S,
            StationWallSide.S => StationWallSide.W,
            _ => StationWallSide.N,
        };
    }

    /// <summary>
    /// A cell's drawn shape. `Full` is the whole 1 m block  the source represents it
    /// as `null`, and every rule below treats `Full` exactly as that `null`.
    /// </summary>
    public readonly struct StationCellShape : IEquatable<StationCellShape> {
        public readonly StationShapeKind Kind;
        public readonly StationWallSide Side;
        public readonly int Mask;
        public readonly StationTriangleKind Triangle;

        StationCellShape(StationShapeKind kind, StationWallSide side, int mask, StationTriangleKind triangle) {
            Kind = kind; Side = side; Mask = mask; Triangle = triangle;
        }

        public static readonly StationCellShape Full = new StationCellShape(StationShapeKind.Full, StationWallSide.S, 0, StationTriangleKind.Upper);
        public static StationCellShape Half(StationWallSide side) => new StationCellShape(StationShapeKind.Half, side, 0, StationTriangleKind.Upper);
        public static StationCellShape Corner(StationWallSide side) => new StationCellShape(StationShapeKind.Corner, side, 0, StationTriangleKind.Upper);
        public static StationCellShape Cuts(int mask) => new StationCellShape(StationShapeKind.Cuts, StationWallSide.N, mask, StationTriangleKind.Upper);
        public static StationCellShape Wedge(StationTriangleKind triangle, StationWallSide side) => new StationCellShape(StationShapeKind.Triangle, side, 0, triangle);

        public bool IsFull => Kind == StationShapeKind.Full;
        public bool IsHalfWall => Kind == StationShapeKind.Half;
        public bool IsTriangle => Kind == StationShapeKind.Triangle;

        public bool Equals(StationCellShape other) =>
            Kind == other.Kind && Side == other.Side && Mask == other.Mask && Triangle == other.Triangle;
        public override bool Equals(object obj) => obj is StationCellShape other && Equals(other);
        public override int GetHashCode() => ((int)Kind * 397) ^ ((int)Side * 31) ^ (Mask * 7) ^ (int)Triangle;
        public override string ToString() => Kind switch {
            StationShapeKind.Full => "full",
            StationShapeKind.Half => "half-wall:" + StationFaces.Name(StationFaces.FaceOfSide(Side)),
            StationShapeKind.Corner => "half-corner:" + StationFaces.Name(StationFaces.FaceOfSide(Side)),
            StationShapeKind.Cuts => "cuts:" + Mask.ToString(CultureInfo.InvariantCulture),
            _ => "tri-" + (Triangle == StationTriangleKind.Upper ? "upper" : "lower") + ":" + StationFaces.Name(StationFaces.FaceOfSide(Side)),
        };
    }

    /// <summary>A rectangle in a cell's own 1 m plan (`CutRect`).</summary>
    public readonly struct StationCutRect {
        public readonly double X0, X1, Y0, Y1;
        public StationCutRect(double x0, double x1, double y0, double y1) { X0 = x0; X1 = x1; Y0 = y0; Y1 = y1; }
    }

    /// <summary>A point in a cell's own 1 m frame (`Point` in the source).</summary>
    public readonly struct StationCellPoint {
        public readonly double X, Y, Z;
        public StationCellPoint(double x, double y, double z) { X = x; Y = y; Z = z; }
    }

    /// <summary>
    /// The one port of `sim/types.ts`'s shape helpers plus
    /// `sim/contactFinishes.ts`'s geometry. Every consumer of a cell shape  the
    /// mesher, the paint brush, the contact-finish cleanup  goes through here.
    /// </summary>
    public static class StationCellRules {
        // The four quarters, clockwise from the north-west: NW (n), NE (e), SE (s), SW (w).
        public static int CornerMask(StationWallSide side) => side switch {
            StationWallSide.N => 0b0001,
            StationWallSide.E => 0b0010,
            StationWallSide.S => 0b0100,
            _ => 0b1000,
        };

        public static int HalfMask(StationWallSide side) => side switch {
            StationWallSide.N => 0b0011,
            StationWallSide.E => 0b0110,
            StationWallSide.S => 0b1100,
            _ => 0b1001,
        };

        static int SidesIndex(string side) => side switch { "n" => 0, "e" => 1, "s" => 2, "w" => 3, _ => -1 };
        static StationWallSide SideAt(int index) => (StationWallSide)index;

        /// <summary>The mask a cell's cut tags fill (`wallCutMask`); 0 for no cut tags.</summary>
        public static int WallCutMask(IEnumerable<string> tags) {
            if (tags == null) return 0;
            var mask = 0;
            foreach (var tag in tags) {
                if (tag == null) continue;
                var at = tag.IndexOf(':');
                if (at < 0) continue;
                var family = tag.Substring(0, at);
                var index = SidesIndex(tag.Substring(at + 1));
                if (index < 0) continue;
                if (family == "half-wall") mask |= HalfMask(SideAt(index));
                else if (family == "half-corner") mask |= CornerMask(SideAt(index));
            }
            return mask;
        }

        /// <summary>`triangleOf`: the  a cell's tags name, or Full.</summary>
        public static StationCellShape TriangleOf(IEnumerable<string> tags) {
            if (tags == null) return StationCellShape.Full;
            foreach (var tag in tags) {
                if (tag == null) continue;
                var at = tag.IndexOf(':');
                if (at < 0) continue;
                var family = tag.Substring(0, at);
                if (family != "tri-upper" && family != "tri-lower") continue;
                var index = SidesIndex(tag.Substring(at + 1));
                if (index < 0) continue;
                return StationCellShape.Wedge(family == "tri-upper" ? StationTriangleKind.Upper : StationTriangleKind.Lower, SideAt(index));
            }
            return StationCellShape.Full;
        }

        /// <summary>`shapeFromCutMask`: normalize a quarter mask to its simplest piece.</summary>
        public static StationCellShape ShapeFromCutMask(int mask) {
            if (mask == 0 || mask == 0b1111) return StationCellShape.Full;
            if (mask == HalfMask(StationWallSide.N)) return StationCellShape.Half(StationWallSide.N);
            if (mask == HalfMask(StationWallSide.E)) return StationCellShape.Half(StationWallSide.E);
            if (mask == HalfMask(StationWallSide.S)) return StationCellShape.Half(StationWallSide.S);
            if (mask == HalfMask(StationWallSide.W)) return StationCellShape.Half(StationWallSide.W);
            if ((mask & (mask - 1)) == 0) {
                if (mask == CornerMask(StationWallSide.N)) return StationCellShape.Corner(StationWallSide.N);
                if (mask == CornerMask(StationWallSide.E)) return StationCellShape.Corner(StationWallSide.E);
                if (mask == CornerMask(StationWallSide.S)) return StationCellShape.Corner(StationWallSide.S);
                return StationCellShape.Corner(StationWallSide.W);
            }
            return StationCellShape.Cuts(mask);
        }

        /// <summary>`shapeOf`: the cut shape of a block, Full when it fills its cell.</summary>
        public static StationCellShape ShapeOf(IEnumerable<string> tags) {
            var mask = WallCutMask(tags);
            if (mask != 0) return ShapeFromCutMask(mask);
            return TriangleOf(tags);
        }

        /// <summary>A mask as whole quarter rows, north then south (`cutRectangles`).</summary>
        public static List<StationCutRect> CutRectangles(int mask) {
            var result = new List<StationCutRect>(2);
            var north = mask & HalfMask(StationWallSide.N);
            if (north != 0) {
                var x0 = (north & CornerMask(StationWallSide.N)) != 0 ? 0d : 0.5d;
                var x1 = (north & CornerMask(StationWallSide.E)) != 0 ? 1d : 0.5d;
                result.Add(new StationCutRect(x0, x1, 0.5, 1));
            }
            var south = mask & HalfMask(StationWallSide.S);
            if (south != 0) {
                var x0 = (south & CornerMask(StationWallSide.W)) != 0 ? 0d : 0.5d;
                var x1 = (south & CornerMask(StationWallSide.S)) != 0 ? 1d : 0.5d;
                result.Add(new StationCutRect(x0, x1, 0, 0.5));
            }
            return result;
        }

        /// <summary>The horizontal bounds a cut piece keeps (`wallShapeBounds`); full cell for Full.</summary>
        public static StationCutRect Bounds(StationCellShape shape) {
            if (shape.IsFull) return new StationCutRect(0, 1, 0, 1);
            if (shape.Kind == StationShapeKind.Half) {
                return new StationCutRect(
                    shape.Side == StationWallSide.E ? 0.5 : 0,
                    shape.Side == StationWallSide.W ? 0.5 : 1,
                    shape.Side == StationWallSide.N ? 0.5 : 0,
                    shape.Side == StationWallSide.S ? 0.5 : 1);
            }
            if (shape.Kind == StationShapeKind.Corner) {
                var east = shape.Side == StationWallSide.E || shape.Side == StationWallSide.S;
                var north = shape.Side == StationWallSide.N || shape.Side == StationWallSide.E;
                return new StationCutRect(east ? 0.5 : 0, east ? 1 : 0.5, north ? 0.5 : 0, north ? 1 : 0.5);
            }
            if (shape.Kind == StationShapeKind.Triangle) return new StationCutRect(0, 1, 0, 1);
            var rects = CutRectangles(shape.Mask);
            var x0 = double.MaxValue; var x1 = double.MinValue; var y0 = double.MaxValue; var y1 = double.MinValue;
            foreach (var rect in rects) {
                x0 = Math.Min(x0, rect.X0); x1 = Math.Max(x1, rect.X1);
                y0 = Math.Min(y0, rect.Y0); y1 = Math.Max(y1, rect.Y1);
            }
            return new StationCutRect(x0, x1, y0, y1);
        }

        /// <summary>Whether a convex piece contains a point in its own unit cell (`contains`).</summary>
        public static bool Contains(StationCellShape shape, StationCellPoint point) {
            if (shape.IsFull) return true;
            if (shape.Kind == StationShapeKind.Triangle) {
                var height = shape.Side == StationWallSide.N ? point.Y
                    : shape.Side == StationWallSide.S ? 1 - point.Y
                    : shape.Side == StationWallSide.E ? point.X
                    : 1 - point.X;
                return shape.Triangle == StationTriangleKind.Upper ? point.Z <= height : point.Z >= 1 - height;
            }
            if (shape.Kind == StationShapeKind.Cuts) {
                const double eps = 1e-9;
                if (point.Z < -eps || point.Z > 1 + eps || point.X < -eps || point.X > 1 + eps || point.Y < -eps || point.Y > 1 + eps) return false;
                var quarter = point.Y >= 0.5
                    ? (point.X >= 0.5 ? CornerMask(StationWallSide.E) : CornerMask(StationWallSide.N))
                    : (point.X >= 0.5 ? CornerMask(StationWallSide.S) : CornerMask(StationWallSide.W));
                return (shape.Mask & quarter) != 0;
            }
            var bounds = Bounds(shape);
            return point.X >= bounds.X0 && point.X <= bounds.X1 && point.Y >= bounds.Y0 && point.Y <= bounds.Y1;
        }

        /// <summary>The directions a cut mask looks into its own empty quarter (`cutInnerFaces`).</summary>
        public static List<StationFace> CutInnerFaces(int mask) {
            var result = new List<StationFace>(2);
            int n = CornerMask(StationWallSide.N), e = CornerMask(StationWallSide.E);
            int s = CornerMask(StationWallSide.S), w = CornerMask(StationWallSide.W);
            if (((mask & n) != 0 && (mask & e) == 0) || ((mask & w) != 0 && (mask & s) == 0)) result.Add(StationFace.E);
            if (((mask & e) != 0 && (mask & n) == 0) || ((mask & s) != 0 && (mask & w) == 0)) result.Add(StationFace.W);
            if (((mask & w) != 0 && (mask & n) == 0) || ((mask & s) != 0 && (mask & e) == 0)) result.Add(StationFace.N);
            if (((mask & n) != 0 && (mask & w) == 0) || ((mask & e) != 0 && (mask & s) == 0)) result.Add(StationFace.S);
            return result;
        }

        /// <summary>The face a 's slope wears (`triangleSlopeFace`).</summary>
        public static StationFace TriangleSlopeFace(StationTriangleKind kind) =>
            kind == StationTriangleKind.Upper ? StationFace.Top : StationFace.Bottom;

        /// <summary>The face a 's panel turns into its own clear half (`halfWallInnerFace`).</summary>
        public static StationWallSide HalfWallInnerFace(StationWallSide side) => side switch {
            StationWallSide.N => StationWallSide.S,
            StationWallSide.S => StationWallSide.N,
            StationWallSide.E => StationWallSide.W,
            _ => StationWallSide.E,
        };

        /// <summary>Whether a tag list makes the cell a wall for every wall rule (`isWallBlock`).</summary>
        public static bool IsWallBlock(IEnumerable<string> tags) {
            if (tags == null) return false;
            foreach (var tag in tags) {
                if (tag == null) continue;
                if (tag == "wall" || tag == "auto-wall" || tag.StartsWith("tunnel-shell:", StringComparison.Ordinal)) return true;
                if (tag.StartsWith("half-wall:", StringComparison.Ordinal) ||
                    tag.StartsWith("tri-upper:", StringComparison.Ordinal) ||
                    tag.StartsWith("tri-lower:", StringComparison.Ordinal)) return true;
            }
            return false;
        }

        static void PushPoints(List<StationCellPoint> points, double x0, double x1, double y0, double y1, double z0, double z1) {
            foreach (var x in new[] { x0, x1 })
                foreach (var y in new[] { y0, y1 })
                    foreach (var z in new[] { z0, z1 })
                        points.Add(new StationCellPoint(x, y, z));
        }

        /// <summary>
        /// The vertices of a piece's actual face on the cell boundary; empty when the
        /// shape's own face is inset or is a wedge's always-drawn slope (`boundaryFace`).
        /// </summary>
        public static List<StationCellPoint> BoundaryFace(StationCellShape shape, StationFace face) {
            var points = new List<StationCellPoint>(8);
            if (shape.IsTriangle && TriangleSlopeFace(shape.Triangle) == face) return points;
            if (shape.Kind == StationShapeKind.Cuts) {
                foreach (var rect in CutRectangles(shape.Mask)) {
                    if (face == StationFace.Top || face == StationFace.Bottom) {
                        var z = face == StationFace.Top ? 1d : 0d;
                        PushPoints(points, rect.X0, rect.X1, rect.Y0, rect.Y1, z, z);
                    } else if (face == StationFace.N && rect.Y1 == 1) PushPoints(points, rect.X0, rect.X1, 1, 1, 0, 1);
                    else if (face == StationFace.S && rect.Y0 == 0) PushPoints(points, rect.X0, rect.X1, 0, 0, 0, 1);
                    else if (face == StationFace.E && rect.X1 == 1) PushPoints(points, 1, 1, rect.Y0, rect.Y1, 0, 1);
                    else if (face == StationFace.W && rect.X0 == 0) PushPoints(points, 0, 0, rect.Y0, rect.Y1, 0, 1);
                }
                return points;
            }
            var bounds = Bounds(shape);
            if ((face == StationFace.E && bounds.X1 < 1) || (face == StationFace.W && bounds.X0 > 0) ||
                (face == StationFace.N && bounds.Y1 < 1) || (face == StationFace.S && bounds.Y0 > 0)) return points;
            var xs = face == StationFace.E ? new[] { 1d } : face == StationFace.W ? new[] { 0d } : new[] { bounds.X0, bounds.X1 };
            var ys = face == StationFace.N ? new[] { 1d } : face == StationFace.S ? new[] { 0d } : new[] { bounds.Y0, bounds.Y1 };
            var zs = face == StationFace.Top ? new[] { 1d } : face == StationFace.Bottom ? new[] { 0d } : new[] { 0d, 1d };
            foreach (var x in xs)
                foreach (var y in ys)
                    foreach (var z in zs) {
                        var point = new StationCellPoint(x, y, z);
                        if (Contains(shape, point)) points.Add(point);
                    }
            // A wedge's zero-area edge is not a paintable face.
            if (points.Count < 3) points.Clear();
            return points;
        }

        /// <summary>
        /// Whether the neighbour fully covers the boundary face (`contactFaceCovered`).
        /// A compound cut may paint an inner half-cell face in the same slot as its
        /// boundary face, and that surface is never covered, so the slot survives.
        /// </summary>
        public static bool ContactFaceCovered(StationCellShape shape, StationCellShape neighbour, StationFace face) {
            if (shape.Kind == StationShapeKind.Cuts && CutInnerFaces(shape.Mask).Contains(face)) return false;
            StationFaces.Step(face, out var dx, out var dy, out var dz);
            var points = BoundaryFace(shape, face);
            if (points.Count == 0) return false;
            foreach (var point in points) {
                if (!Contains(neighbour, new StationCellPoint(point.X - dx, point.Y - dy, point.Z - dz))) return false;
            }
            return true;
        }
    }

    /// <summary>
    /// Custom-tint finish ids: `wall.enamel#ff4242` (`sim/finishes.ts`). The base id
    /// decides family, speed and look; the suffix only supplies the colour, so the
    /// per-face finish stays a plain string and the save needs no migration.
    /// </summary>
    public static class StationFinishIds {
        public const string DefaultMaterial = "floor.concrete";
        public const char TintSeparator = '#';

        public static string BaseId(string id) {
            if (string.IsNullOrEmpty(id)) return id;
            var at = id.IndexOf(TintSeparator);
            return at < 0 ? id : id.Substring(0, at);
        }

        /// <summary>The colour packed into a finish id, or -1 for a stock finish.</summary>
        public static int Tint(string id) {
            if (string.IsNullOrEmpty(id)) return -1;
            var at = id.IndexOf(TintSeparator);
            if (at < 0) return -1;
            var hex = id.Substring(at + 1);
            if (hex.Length == 0 || hex.Length > 8) return -1;
            if (!int.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var value)) return -1;
            return value & 0xFFFFFF;
        }

        public static bool IsCustom(string id) => Tint(id) >= 0;

        /// <summary>`customFinishId`: the base id wearing a colour, lowercase six hex digits.</summary>
        public static string Custom(string baseId, int rgb) =>
            BaseId(baseId) + TintSeparator + (rgb & 0xFFFFFF).ToString("x6", CultureInfo.InvariantCulture);

        public static string Hex(int rgb) => (rgb & 0xFFFFFF).ToString("x6", CultureInfo.InvariantCulture);

        public static bool TryParseHex(string hex, out int rgb) {
            rgb = 0;
            if (string.IsNullOrEmpty(hex)) return false;
            var text = hex[0] == TintSeparator ? hex.Substring(1) : hex;
            return int.TryParse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out rgb) && (rgb & ~0xFFFFFF) == 0;
        }
    }

    /// <summary>One painted material on one cell. `Finish == null` erases the override.</summary>
    public readonly struct StationFaceWrite {
        public readonly int X, Y, Z;
        public readonly StationFace Face;
        public readonly string Finish;
        /// <summary>No explicit document record existed; the host must create the cell.</summary>
        public readonly bool Materialise;
        /// <summary>Zone the materialised record carries (`outside` for a painted street underside).</summary>
        public readonly string Zone;
        /// <summary>Tags the materialised record carries (`painted-ground`).</summary>
        public readonly string[] Tags;

        public StationFaceWrite(int x, int y, int z, StationFace face, string finish, bool materialise = false, string zone = null, string[] tags = null) {
            X = x; Y = y; Z = z; Face = face; Finish = finish; Materialise = materialise; Zone = zone; Tags = tags ?? Array.Empty<string>();
        }

        public StationCellKey Cell => new StationCellKey(X, Y, Z);
        public bool IsErase => Finish == null;
    }

    /// <summary>
    /// The committed station as the brush reads it, projected from packet A's
    /// <see cref="StationDocument"/> (one record type for the whole loader). Build it
    /// with <see cref="FromDocument"/> or <see cref="FromIndex"/>; the host supplies
    /// the module-derived street holes (ramp corridors, exit floors, bored tracks)
    /// because those are derived from the module list, not from the cell records.
    /// </summary>
    public sealed class StationPaintSnapshot {
        /// <summary>The street storey: the one plane the document stores inverted.</summary>
        public const int GroundZ = 0;

        public List<StationCellRecord> Cells = new List<StationCellRecord>();
        /// <summary>Explicit `fill != solid` records: a dug hole is not a surface.</summary>
        public HashSet<StationCellKey> Voids = new HashSet<StationCellKey>();
        /// <summary>Module-derived street holes (a ramp corridor, an exit floor, a bored track).</summary>
        public HashSet<StationCellKey> GroundHoles = new HashSet<StationCellKey>();
        /// <summary>Whether absent coordinates at <see cref="GroundLevel"/> are solid street.</summary>
        public bool VirtualGround = true;
        public int GroundLevel = GroundZ;
        public int LevelBase;
        public int StoreyHeight = 5;
        /// <summary>The committed document revision the snapshot was built at, or -1.</summary>
        public int Revision = -1;

        readonly Dictionary<StationCellKey, StationCellRecord> byKey = new Dictionary<StationCellKey, StationCellRecord>();
        readonly Dictionary<StationCellKey, int> slotByKey = new Dictionary<StationCellKey, int>();
        readonly Dictionary<StationCellKey, StationCellShape> shapes = new Dictionary<StationCellKey, StationCellShape>();
        readonly HashSet<StationCellKey> suspendedCeilings = new HashSet<StationCellKey>();
        internal IEnumerable<StationCellKey> SuspendedCeilingKeys => suspendedCeilings;

        /// <summary>Index the cells by key. Call after the fields are set.</summary>
        public StationPaintSnapshot Index() {
            byKey.Clear();
            slotByKey.Clear();
            shapes.Clear();
            suspendedCeilings.Clear();
            for (int i = 0; i < Cells.Count; i++) {
                var cell = Cells[i];
                var key = cell.Key;
                byKey[key] = cell;
                slotByKey[key] = i;
                shapes[key] = StationCellRules.ShapeOf(cell.Tags);
                if (!cell.IsSolid) Voids.Add(key);
                else if (cell.HasTag("suspended-ceiling")) suspendedCeilings.Add(key);
            }
            return this;
        }

        public StationPaintSnapshot Add(StationCellRecord cell) {
            var key = cell.Key;
            if (slotByKey.TryGetValue(key, out int existingSlot)) {
                Cells[existingSlot] = cell;
            } else {
                slotByKey[key] = Cells.Count;
                Cells.Add(cell);
            }
            byKey[key] = cell;
            shapes[key] = StationCellRules.ShapeOf(cell.Tags);
            if (!cell.IsSolid) {
                Voids.Add(key);
                suspendedCeilings.Remove(key);
            } else {
                Voids.Remove(key);
                if (cell.HasTag("suspended-ceiling")) suspendedCeilings.Add(key);
                else suspendedCeilings.Remove(key);
            }
            return this;
        }

        void RemoveRecord(StationCellKey key) {
            if (slotByKey.TryGetValue(key, out int slot)) {
                int last = Cells.Count - 1;
                if (slot != last) {
                    var tail = Cells[last];
                    Cells[slot] = tail;
                    slotByKey[tail.Key] = slot;
                }
                Cells.RemoveAt(last);
                slotByKey.Remove(key);
            }
            byKey.Remove(key);
            shapes.Remove(key);
            Voids.Remove(key);
            suspendedCeilings.Remove(key);
        }

        /// <summary>Advance this paint snapshot across a committed local delta in O(|delta|).</summary>
        public void ApplyLocalDelta(StationDocument nextDoc, StationIndexDelta delta,
            HashSet<StationCellKey> nextGroundHoles, bool hasGroundWindow, int gx0, int gx1, int gy0, int gy1, int revision = -1) {
            if (nextDoc != null) {
                LevelBase = nextDoc.LevelBase;
                StoreyHeight = nextDoc.StoreyHeight;
            }
            Revision = revision;
            if (delta != null) {
                for (int i = 0; i < delta.RemovedCells.Count; i++) RemoveRecord(delta.RemovedCells[i]);
                for (int i = 0; i < delta.ChangedCells.Count; i++) Add(delta.ChangedCells[i]);
            }
            if (nextGroundHoles != null) {
                GroundHoles.Clear();
                foreach (var hole in nextGroundHoles) GroundHoles.Add(hole);
            }
            HasGroundWindow = hasGroundWindow;
            GroundX0 = gx0;
            GroundX1 = gx1;
            GroundY0 = gy0;
            GroundY1 = gy1;
        }

        /// <summary>Test/host convenience: one cell from raw fields (tags + face finishes).</summary>
        public StationPaintSnapshot Add(int x, int y, int z, bool solid, string[] tags = null,
            IReadOnlyDictionary<string, string> finish = null, string zone = null) {
            return Add(new StationCellRecord(x, y, z, "full", solid ? "solid" : "void", zone, tags, finish, null, null));
        }

        /// <summary>Project a read-only document into the brush's view of it.</summary>
        public static StationPaintSnapshot FromDocument(StationDocument document, IEnumerable<StationCellKey> groundHoles = null, int revision = -1, int groundMargin = 16) {
            if (document == null) throw new ArgumentNullException(nameof(document));
            var snapshot = new StationPaintSnapshot {
                LevelBase = document.LevelBase,
                StoreyHeight = document.StoreyHeight,
                Revision = revision,
            };
            snapshot.Cells.AddRange(document.Cells);
            if (groundHoles != null) foreach (var hole in groundHoles) snapshot.GroundHoles.Add(hole);
            snapshot.Index();
            return snapshot.BuildGroundWindow(groundMargin);
        }

        /// <summary>Project an index into the brush's view of it (same cells, no re-parse).</summary>
        public static StationPaintSnapshot FromIndex(StationIndex index, IEnumerable<StationCellKey> groundHoles = null, int revision = -1) {
            if (index == null) throw new ArgumentNullException(nameof(index));
            return FromDocument(index.Document, groundHoles, revision);
        }

        public StationCellRecord Find(StationCellKey key) => byKey.TryGetValue(key, out var cell) ? cell : null;

        public StationCellRecord Find(int x, int y, int z) => Find(new StationCellKey(x, y, z));

        /// <summary>An explicit solid record at the coordinate.</summary>
        public bool HasExplicitSolid(StationCellKey key) => byKey.TryGetValue(key, out var cell) && cell.IsSolid;

        /// <summary>
        /// The plan window the generated street materialises (`withGround`'s
        /// content + `GROUND_MARGIN`). Point queries (`solidAt`) treat the whole
        /// `GroundLevel` plane as street; the **surface** the brush and the mesher draw
        /// is only this window, exactly as the source's effective cell list is.
        /// </summary>
        public bool HasGroundWindow;
        public int GroundX0, GroundX1, GroundY0, GroundY1;

        /// <summary>Materialise the street window around the station's own content.</summary>
        public StationPaintSnapshot BuildGroundWindow(int margin) {
            if (!VirtualGround) { HasGroundWindow = false; return this; }
            var minX = int.MaxValue; var maxX = int.MinValue; var minY = int.MaxValue; var maxY = int.MinValue;
            foreach (var cell in Cells) {
                if (cell.X < minX) minX = cell.X; if (cell.X > maxX) maxX = cell.X;
                if (cell.Y < minY) minY = cell.Y; if (cell.Y > maxY) maxY = cell.Y;
            }
            foreach (var key in Voids) {
                if (key.X < minX) minX = key.X; if (key.X > maxX) maxX = key.X;
                if (key.Y < minY) minY = key.Y; if (key.Y > maxY) maxY = key.Y;
            }
            if (minX == int.MaxValue) { minX = maxX = 0; minY = maxY = 0; }
            GroundX0 = minX - margin; GroundX1 = maxX + margin;
            GroundY0 = minY - margin; GroundY1 = maxY + margin;
            HasGroundWindow = true;
            return this;
        }

        /// <summary>A generated street cell: no explicit record, above a hole-free plane.</summary>
        public bool IsVirtualGround(StationCellKey key) =>
            VirtualGround && key.Z == GroundLevel && !byKey.ContainsKey(key) && !Voids.Contains(key) && !GroundHoles.Contains(key);

        /// <summary>Whether the generated street actually draws a surface at this cell.</summary>
        public bool IsGroundSurface(StationCellKey key) =>
            IsVirtualGround(key) && (!HasGroundWindow ||
                (key.X >= GroundX0 && key.X <= GroundX1 && key.Y >= GroundY0 && key.Y <= GroundY1));

        /// <summary>`solidAt`: an explicit solid, or the virtual street.</summary>
        public bool SolidAt(StationCellKey key) => HasExplicitSolid(key) || IsVirtualGround(key);

        /// <summary>`occupied`: the virtual street still occludes a face (`index.ground`).</summary>
        public bool OccupiedAt(StationCellKey key) => SolidAt(key);

        /// <summary>The shape of the cell at a key; Full for the street and for plain blocks.</summary>
        public StationCellShape ShapeAt(StationCellKey key) => shapes.TryGetValue(key, out var shape) ? shape : StationCellShape.Full;

        /// <summary>The finish a face currently wears, including the family default.</summary>
        public string FinishOf(StationCellKey key, StationFace face) {
            var cell = Find(key);
            if (cell != null) {
                var name = StationFaces.Name(face);
                if (cell.Finish.TryGetValue(name, out var value) && !string.IsNullOrEmpty(value)) return value;
            }
            return StationFinishIds.DefaultMaterial;
        }

        /// <summary>Whether a coordinate counts as the generated street for painting.</summary>
        public bool IsGround(StationCellKey key) => IsVirtualGround(key);
    }

    /// <summary>How the brush was invoked (`PaintTool`'s left/right button + mode).</summary>
    public enum StationPaintMode { Single = 0, Surface = 1, Erase = 2 }

    /// <summary>
    /// One resolved brush action. The caller resolves the pointer **once** into
    /// <see cref="X"/>/<see cref="Y"/>/<see cref="Z"/> + <see cref="Face"/> (from the
    /// mesh pick record) and reuses the same values for hover and commit, so the
    /// preview quad and the painted face are the same surface.
    /// </summary>
    public sealed class StationPaintRequest {
        public int X, Y, Z;
        public StationFace Face;
        public string Finish = StationFinishIds.DefaultMaterial;
        public StationPaintMode Mode = StationPaintMode.Single;
        /// <summary>A drag on the anchor's plane reached this cell (`planeCells`).</summary>
        public bool HasDrag;
        public int ToX, ToY, ToZ;
        /// <summary>The host's committed revision; -1 skips the check.</summary>
        public int ExpectedRevision = -1;
    }

    public readonly struct StationPaintPick {
        public readonly int X, Y, Z;
        public readonly StationFace Face;
        public readonly string Finish;
        public StationPaintPick(int x, int y, int z, StationFace face, string finish) {
            X = x; Y = y; Z = z; Face = face; Finish = finish;
        }
        public StationCellKey Cell => new StationCellKey(X, Y, Z);
        public override string ToString() => X + "," + Y + "," + Z + "/" + StationFaces.Name(Face) + ":" + Finish;
    }

    /// <summary>The edit a brush action asks the host to commit.</summary>
    public sealed class StationPaintResult {
        public bool Accepted;
        /// <summary>`ok`, `revision-mismatch`, `face-not-present`, `no-change`.</summary>
        public string Code = "ok";
        public StationPaintPick Hit;
        public List<StationCellKey> Region = new List<StationCellKey>();
        public List<StationFaceWrite> Writes = new List<StationFaceWrite>();
        public string Finish;
        public StationPaintMode Mode;
        public int ExpectedRevision = -1;
        public string Message;

        public static StationPaintResult Reject(string code, string message = null) =>
            new StationPaintResult { Accepted = false, Code = code, Message = message };

        /// <summary>The command payload the host routes (shape published in the handoff).</summary>
        public string ToJson() => "{\"type\":\"face.paint\",\"payload\":" + ToPayloadJson() + "}";

        /// <summary>The `face.paint` payload alone, for a router that supplies its own envelope.</summary>
        public string ToPayloadJson() {
            var text = new StringBuilder(160 + Writes.Count * 80);
            text.Append('{');
            text.Append("\"revision\":").Append(ExpectedRevision.ToString(CultureInfo.InvariantCulture));
            text.Append(",\"mode\":\"").Append(Mode == StationPaintMode.Surface ? "surface" : Mode == StationPaintMode.Erase ? "erase" : "single").Append('"');
            text.Append(",\"accepted\":").Append(Accepted ? "true" : "false");
            text.Append(",\"code\":\"").Append(Code).Append('"');
            if (Hit.Finish != null || Accepted) {
                text.Append(",\"hit\":{\"cell\":[").Append(Hit.X).Append(',').Append(Hit.Y).Append(',').Append(Hit.Z).Append(']');
                text.Append(",\"face\":\"").Append(StationFaces.Name(Hit.Face)).Append('"');
                text.Append(",\"finish\":").Append(JsonString(Hit.Finish)).Append('}');
            }
            text.Append(",\"finish\":").Append(JsonString(Finish));
            text.Append(",\"writes\":[");
            for (var i = 0; i < Writes.Count; i++) {
                if (i > 0) text.Append(',');
                var write = Writes[i];
                text.Append("{\"cell\":[").Append(write.X).Append(',').Append(write.Y).Append(',').Append(write.Z).Append(']');
                text.Append(",\"face\":\"").Append(StationFaces.Name(write.Face)).Append('"');
                text.Append(",\"finish\":").Append(JsonString(write.Finish));
                if (write.Materialise) {
                    text.Append(",\"materialise\":{\"fill\":\"solid\"");
                    if (!string.IsNullOrEmpty(write.Zone)) text.Append(",\"zone\":\"").Append(write.Zone).Append('"');
                    if (write.Tags.Length > 0) {
                        text.Append(",\"tags\":[");
                        for (var t = 0; t < write.Tags.Length; t++) {
                            if (t > 0) text.Append(',');
                            text.Append(JsonString(write.Tags[t]));
                        }
                        text.Append(']');
                    }
                    text.Append('}');
                }
                text.Append('}');
            }
            text.Append("]}");
            return text.ToString();
        }

        static string JsonString(string value) {
            if (value == null) return "null";
            var text = new StringBuilder(value.Length + 2);
            text.Append('"');
            foreach (var c in value) {
                switch (c) {
                    case '"': text.Append("\\\""); break;
                    case '\\': text.Append("\\\\"); break;
                    case '\n': text.Append("\\n"); break;
                    case '\r': text.Append("\\r"); break;
                    case '\t': text.Append("\\t"); break;
                    default:
                        if (c < 0x20) text.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else text.Append(c);
                        break;
                }
            }
            text.Append('"');
            return text.ToString();
        }
    }

    public static class StationFinishEdits {
        /// <summary>Fails a flood that would leave the committed document (host safety cap).</summary>
        public const int DefaultMaxRegionCells = 200000;

        /// <summary>
        /// Whether a solid cell presents `face` to the brush (`facePresent`): the face
        /// is on the piece's surface with nothing standing across it. A 's inner
        /// face, a compound cut's inner half-cell face and a 's slope are surfaces
        /// **inside** their own cell, so a solid neighbour never covers them.
        /// </summary>
        public static bool FacePresent(StationPaintSnapshot snapshot, StationCellKey key, StationFace face) =>
            FacePresentCore(snapshot, key, face, groundIsSurface: true,
                occupied: candidate => snapshot.HasExplicitSolid(candidate) || snapshot.IsGroundSurface(candidate));

        /// <summary>
        /// The exposure rule with the source's two ground behaviours kept apart: the
        /// tool gate reads **effective** solids (generated street included), while
        /// `fillSurface`'s walk reads the document's own cells - except a bottom-face
        /// flood at the street storey, which materialises the pavement first. A ground
        /// cell still occludes a neighbour (`occupied`) even where it is not a surface.
        /// </summary>
        static bool FacePresentCore(StationPaintSnapshot snapshot, StationCellKey key, StationFace face,
            bool groundIsSurface, Func<StationCellKey, bool> occupied) {
            var isSurface = snapshot.HasExplicitSolid(key) || (groundIsSurface && snapshot.IsGroundSurface(key));
            if (!isSurface) return false;
            var shape = snapshot.ShapeAt(key);
            var vertical = face != StationFace.Top && face != StationFace.Bottom;
            var sideFace = vertical ? StationFaces.Side(face) : StationWallSide.S;
            if (shape.Kind == StationShapeKind.Corner) {
                var eastWest = shape.Side == StationWallSide.N || shape.Side == StationWallSide.W ? StationFace.E : StationFace.W;
                var northSouth = shape.Side == StationWallSide.N || shape.Side == StationWallSide.E ? StationFace.S : StationFace.N;
                if (face == eastWest || face == northSouth) return true;
            }
            if (shape.Kind == StationShapeKind.Cuts && StationCellRules.CutInnerFaces(shape.Mask).Contains(face)) return true;
            if (vertical && shape.IsHalfWall && StationCellRules.HalfWallInnerFace(shape.Side) == sideFace) return true;
            if (shape.IsTriangle && StationCellRules.TriangleSlopeFace(shape.Triangle) == face) return true;
            StationFaces.Step(face, out var dx, out var dy, out var dz);
            var neighbour = new StationCellKey(key.X + dx, key.Y + dy, key.Z + dz);
            if (!occupied(neighbour)) return true;
            // Cut neighbours can cover only part of this face: the exposed part stays
            // paintable, using the same geometric contact rule as the finish cleanup.
            var neighbourShape = snapshot.ShapeAt(neighbour);
            return !neighbourShape.IsFull && !StationCellRules.ContactFaceCovered(shape, neighbourShape, face);
        }

        /// <summary>The cells a paint drag covers on the pressed face's plane (`planeCells`).</summary>
        public static List<StationCellKey> PlaneCells(StationCellKey anchor, StationCellKey end, StationFace face) {
            var result = new List<StationCellKey>();
            if (face == StationFace.Top || face == StationFace.Bottom) {
                for (var x = Math.Min(anchor.X, end.X); x <= Math.Max(anchor.X, end.X); x++)
                    for (var y = Math.Min(anchor.Y, end.Y); y <= Math.Max(anchor.Y, end.Y); y++)
                        result.Add(new StationCellKey(x, y, anchor.Z));
            } else if (face == StationFace.E || face == StationFace.W) {
                for (var y = Math.Min(anchor.Y, end.Y); y <= Math.Max(anchor.Y, end.Y); y++)
                    for (var z = Math.Min(anchor.Z, end.Z); z <= Math.Max(anchor.Z, end.Z); z++)
                        result.Add(new StationCellKey(anchor.X, y, z));
            } else {
                for (var x = Math.Min(anchor.X, end.X); x <= Math.Max(anchor.X, end.X); x++)
                    for (var z = Math.Min(anchor.Z, end.Z); z <= Math.Max(anchor.Z, end.Z); z++)
                        result.Add(new StationCellKey(x, anchor.Y, z));
            }
            return result;
        }

        /// <summary>`faceTargets`: keep only the cells of a rectangle that present the face.</summary>
        public static List<StationCellKey> FaceTargets(StationPaintSnapshot snapshot, IEnumerable<StationCellKey> cells, StationFace face) {
            var result = new List<StationCellKey>();
            foreach (var cell in cells) if (FacePresent(snapshot, cell, face)) result.Add(cell);
            return result;
        }

        /// <summary>
        /// The connected exposed region of a face's plane (`fillSurface`). The region
        /// stops at unexposed faces and at the plane's edge  not at a change of
        /// finish, because you are painting a surface. `maxCells` only guards a
        /// runaway payload; 0 means the source's unbounded walk.
        /// </summary>
        public static List<StationCellKey> FloodRegion(StationPaintSnapshot snapshot, StationCellKey anchor, StationFace face, int maxCells = 0) {
            var result = new List<StationCellKey>();
            if (!FacePresent(snapshot, anchor, face)) return result;
            var limit = maxCells > 0 ? maxCells : DefaultMaxRegionCells;
            // A vertical flood is bounded by a suspended ceiling course the way the
            // source bounds it: the cell directly under a ceiling plate keeps its face,
            // but the walk may not cross the course to the other side of it.
            var vertical = face != StationFace.Top && face != StationFace.Bottom;
            var ceilings = new HashSet<StationCellKey>();
            var ceilingLevels = new Dictionary<StationCellKey, List<int>>();
            var anchorZ = anchor.Z;
            if (vertical) {
                StationFaces.Step(face, out var sx, out var sy, out var sz);
                foreach (var key in snapshot.SuspendedCeilingKeys) {
                    ceilings.Add(key);
                    var column = new StationCellKey(key.X - sx, key.Y - sy, 0);
                    if (!ceilingLevels.TryGetValue(column, out var levels)) ceilingLevels[column] = levels = new List<int>();
                    levels.Add(key.Z);
                }
            }
            // `fillSurface` materialises the street for a bottom-face flood; every other
            // flood reads the document's own solids, with the street still occluding.
            var groundIsSurface = face == StationFace.Bottom && anchor.Z == StationPaintSnapshot.GroundZ;
            bool Occupied(StationCellKey key) =>
                (!ceilings.Contains(key) && snapshot.HasExplicitSolid(key)) || snapshot.IsVirtualGround(key);
            bool Exposed(StationCellKey key) {
                if (ceilingLevels.TryGetValue(new StationCellKey(key.X, key.Y, 0), out var levels)) {
                    foreach (var level in levels) {
                        if (anchorZ <= level ? key.Z > level : key.Z <= level) return false;
                    }
                }
                return FacePresentCore(snapshot, key, face, groundIsSurface, Occupied);
            }
            if (!Exposed(anchor)) return result;
            var seen = new HashSet<StationCellKey> { anchor };
            var queue = new Stack<StationCellKey>();
            queue.Push(anchor);
            StationFaces.Plane(face, out var ax, out var ay, out var az, out var bx, out var by, out var bz);
            while (queue.Count > 0) {
                var current = queue.Pop();
                result.Add(current);
                if (result.Count > limit) break;
                var inset = InsetSurface(snapshot.ShapeAt(current), face);
                foreach (var (dx, dy, dz) in new[] { (ax, ay, az), (bx, by, bz), (-ax, -ay, -az), (-bx, -by, -bz) }) {
                    var next = new StationCellKey(current.X + dx, current.Y + dy, current.Z + dz);
                    if (seen.Contains(next)) continue;
                    if (!Exposed(next)) continue;
                    if (InsetSurface(snapshot.ShapeAt(next), face) != inset) continue;
                    seen.Add(next);
                    queue.Push(next);
                }
            }
            return result;
        }

        /// <summary>Whether a cell's presented face is an inset surface inside its own cell.</summary>
        static bool InsetSurface(StationCellShape shape, StationFace face) {
            if (shape.Kind == StationShapeKind.Corner) {
                var eastWest = shape.Side == StationWallSide.N || shape.Side == StationWallSide.W ? StationFace.E : StationFace.W;
                var northSouth = shape.Side == StationWallSide.N || shape.Side == StationWallSide.E ? StationFace.S : StationFace.N;
                return face == eastWest || face == northSouth;
            }
            if (shape.Kind == StationShapeKind.Cuts && StationCellRules.CutInnerFaces(shape.Mask).Contains(face)) return true;
            if (face == StationFace.Top || face == StationFace.Bottom) return false;
            return shape.IsHalfWall && StationCellRules.HalfWallInnerFace(shape.Side) == StationFaces.Side(face);
        }

        /// <summary>
        /// Resolve and validate one brush action. The returned writes are the edit the
        /// host commits; this never mutates the snapshot. Validation order matches the
        /// host's: revision first, then the resolved surface, then the region.
        /// </summary>
        public static StationPaintResult Paint(StationPaintSnapshot snapshot, StationPaintRequest request) {
            if (snapshot == null) throw new ArgumentNullException(nameof(snapshot));
            if (request == null) throw new ArgumentNullException(nameof(request));
            var result = new StationPaintResult {
                Mode = request.Mode,
                Finish = request.Mode == StationPaintMode.Erase ? null : request.Finish,
                ExpectedRevision = request.ExpectedRevision,
            };
            var anchor = new StationCellKey(request.X, request.Y, request.Z);
            result.Hit = new StationPaintPick(request.X, request.Y, request.Z, request.Face,
                snapshot.FinishOf(anchor, request.Face));
            if (request.ExpectedRevision >= 0 && snapshot.Revision >= 0 && request.ExpectedRevision != snapshot.Revision) {
                result.Code = "revision-mismatch";
                result.Message = "expected revision " + request.ExpectedRevision + ", committed " + snapshot.Revision;
                return result;
            }
            if (!FacePresent(snapshot, anchor, request.Face)) {
                result.Code = "face-not-present";
                result.Message = "no exposed " + StationFaces.Name(request.Face) + " face at " + anchor;
                return result;
            }
            List<StationCellKey> region;
            if (request.Mode == StationPaintMode.Surface) {
                region = FloodRegion(snapshot, anchor, request.Face);
                if (region.Count == 0) {
                    // The source's `fillSurface` returns the same station, so the brush
                    // paints nothing: a visible surface the walk cannot start on (the
                    // street's top under a whole-surface brush) is a no-op, not a refusal.
                    result.Accepted = true;
                    result.Code = "no-change";
                    return result;
                }
            } else if (request.HasDrag) {
                var end = new StationCellKey(request.ToX, request.ToY, request.ToZ);
                region = FaceTargets(snapshot, PlaneCells(anchor, end, request.Face), request.Face);
            } else {
                region = new List<StationCellKey> { anchor };
            }
            result.Region = region;
            foreach (var cell in region) {
                if (request.Mode == StationPaintMode.Erase) {
                    // A hole is not a surface and a face with no override already wears
                    // the family default, so erasing it is not an undo step.
                    var record = snapshot.Find(cell);
                    if (record != null && record.Finish.TryGetValue(StationFaces.Name(request.Face), out var existing) && !string.IsNullOrEmpty(existing))
                        result.Writes.Add(new StationFaceWrite(cell.X, cell.Y, cell.Z, request.Face, null));
                    continue;
                }
                if (snapshot.Find(cell) != null && snapshot.FinishOf(cell, request.Face) == request.Finish) continue;
                var ground = snapshot.IsGround(cell);
                var paintGround = ground && request.Face == StationFace.Bottom;
                result.Writes.Add(new StationFaceWrite(cell.X, cell.Y, cell.Z, request.Face, request.Finish,
                    ground,
                    ground ? (request.Face == StationFace.Bottom ? "outside" : null) : null,
                    paintGround ? new[] { "painted-ground" } : null));
            }
            result.Accepted = true;
            result.Code = result.Writes.Count == 0 ? "no-change" : "ok";
            return result;
        }

        /// <summary>Hover: the paint target a mesh pick resolves to, without committing.</summary>
        public static StationPaintPick ResolveHover(StationPaintSnapshot snapshot, int x, int y, int z, StationFace face) {
            var key = new StationCellKey(x, y, z);
            return new StationPaintPick(x, y, z, face, snapshot.FinishOf(key, face));
        }
    }
}






