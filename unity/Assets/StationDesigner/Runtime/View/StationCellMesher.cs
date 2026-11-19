using System;
using System.Collections.Generic;
using Metro.Build;
using UnityEngine;

namespace Metro.View {
    // Plan 11, packet E (E1)  the cell surface mesher.
    //
    // One port of `game/src/render/chunkMesher.ts` (with `rampSurfaceMesh.ts`,
    // `platformBlockInsets.ts`, `ceilingCells.ts`, `ChunkSystem.ts`'s pass split and
    // `sim/ground.ts`'s virtual street), reduced to what a committed document needs:
    // no chunk cache, no GPU objects, no Unity conversion. The output is geometry in
    // **document axes** (plan x, plan y, elevation z), exactly the source mesher's own
    // frame, grouped by chunk  storey  pass role  finish so packet D can hide or
    // ghost a role and the view can bind one material per group.
    //
    // What it draws, from the source:
    //   * every exposed face of every solid cell  never an internal face, never a
    //     void  with the cell's per-face finish (`finish.top`, `finish.e`, ...) or the
    //     family default (`floor.concrete`);
    //   * cut pieces:  panels (`half-wall:<side>`),  quarters
    //     (`half-corner:<side>`), compound `cuts` (two/three quarters) and  wedges
    //     (`tri-upper|lower:<side>`, including the always-drawn 45 slope);
    //   * a run's shaved underside: the caller's `SlopeCuts`, with the source's
    //     ramp-surface regions (split, clipped, per-patch planes) and the truss body a
    //     filling is drawn as (`SlopeFills`), plus the per-cell ambient occlusion the
    //     source puts in vertex colours;
    //   * the platform-edge block inset (`platformBlockInsets`), supplied by the caller
    //     as `Insets` (the module  inset derivation needs the track/PSD facts);
    //   * the generated street: a virtual solid plane at `GroundZ` over the station's
    //     own bounds plus `GroundMargin`, minus the document's own records and the
    //     caller's module-derived holes. Those cells are geometry and role `Ground`
    //     only  never a save record.
    //
    // Passes match `ChunkSystem` so hiding a role is exact: `Cell` (the storey's own
    // blocks), `Ceiling` (suspended / opening-ceiling plates, which do not occlude the
    // faces below them), `Plate` (unsupported plates with nothing under them) and
    // `Ground` (the generated street).
    //
    // The mesher never converts document  world: positions are written as
    // `(x + localX, y + localY, z + localZ)` in the save's own axes. `StationCellView`
    // owns the one conversion and the parent placement.

    /// <summary>Which pass a surface came from; packet D hides/ghosts these separately.</summary>
    public enum StationSurfaceRole {
        /// <summary>The storey's own blocks (the source's `s` pass).</summary>
        Cell = 0,
        /// <summary>
        /// The ceiling the source's auto-ceiling rule hides: a suspended / opening-ceiling
        /// plate (the `c` pass) or the body of the storey's top slab when its deck caps a
        /// room (the slab above the active storey).
        /// </summary>
        Ceiling = 1,
        /// <summary>An unsupported plate with nothing under it (`f`).</summary>
        Plate = 2,
        /// <summary>The generated street window (`g`); never part of the save.</summary>
        Ground = 3,
        /// <summary>
        /// A wall surface of the storey pass: the source's <c>userData.wall</c>
        /// (<c>finishDef(finish).family === 'wall'</c>) or an exposed side face of a
        /// cell the source's <c>isWallBlock</c> calls a wall (wall / auto-wall /
        /// tunnel-shell / half-wall / triangle courses). Registered as
        /// <see cref="StationPartRole.Wall"/>, so 隐藏墙壁 can see through it.
        /// </summary>
        Wall = 4,
        /// <summary>
        /// The exposed roof deck of a storey's top slab when the station's roof is cell
        /// geometry (Zoo has no <c>roof</c> modules): the top face of the highest course
        /// where it rests on solid fill. Registered as <see cref="StationPartRole.Roof"/>,
        /// so 隐藏屋顶 removes the deck the player sees from above.
        /// </summary>
        Roof = 5,
    }

    /// <summary>Authored cell tags the mesher reads for classification.</summary>
    [Flags]
    public enum StationMeshCellFlags {
        None = 0,
        /// <summary>`wall` / `auto-wall` / `tunnel-shell:*` (the source's wall tag).</summary>
        Wall = 1,
        /// <summary>`suspended-ceiling`: an independently hideable ceiling plate.</summary>
        SuspendedCeiling = 2,
        /// <summary>`opening-ceiling`: a slab over a ramp opening, still a ceiling from below.</summary>
        OpeningCeiling = 4,
        /// <summary>`painted-ground`: an explicit street record that keeps the ground pass.</summary>
        PaintedGround = 8,
    }

    /// <summary>One cell's six face finishes; a null face is the family default.</summary>
    public readonly struct StationFinishSet : IEquatable<StationFinishSet> {
        public readonly string Top, Bottom, N, E, S, W;

        public StationFinishSet(string top = null, string bottom = null, string n = null, string e = null, string s = null, string w = null) {
            Top = top; Bottom = bottom; N = n; E = e; S = s; W = w;
        }

        public string For(StationFace face) => face switch {
            StationFace.Top => Top,
            StationFace.Bottom => Bottom,
            StationFace.N => N,
            StationFace.E => E,
            StationFace.S => S,
            _ => W,
        };

        public bool Any => !string.IsNullOrEmpty(Top) || !string.IsNullOrEmpty(Bottom) ||
                           !string.IsNullOrEmpty(N) || !string.IsNullOrEmpty(E) ||
                           !string.IsNullOrEmpty(S) || !string.IsNullOrEmpty(W);

        public bool Equals(StationFinishSet other) =>
            Top == other.Top && Bottom == other.Bottom && N == other.N && E == other.E && S == other.S && W == other.W;
        public override bool Equals(object obj) => obj is StationFinishSet other && Equals(other);
        public override int GetHashCode() => (Top?.GetHashCode() ?? 0) ^ ((Bottom?.GetHashCode() ?? 0) * 397) ^
                                             ((N?.GetHashCode() ?? 0) * 31) ^ ((E?.GetHashCode() ?? 0) * 17) ^
                                             ((S?.GetHashCode() ?? 0) * 7) ^ (W?.GetHashCode() ?? 0);

        public static StationFinishSet FromRecord(StationCellRecord record) {
            if (record == null) return default;
            return new StationFinishSet(
                record.FinishOf(StationFinishFace.Top),
                record.FinishOf(StationFinishFace.Bottom),
                record.FinishOf(StationFinishFace.North),
                record.FinishOf(StationFinishFace.East),
                record.FinishOf(StationFinishFace.South),
                record.FinishOf(StationFinishFace.West));
        }
    }

    /// <summary>One solid cell as the mesher reads it, built by the caller from the document.</summary>
    public struct StationMeshCell {
        public int X, Y, Z;
        /// <summary>The cell draws as solid; a `void` record is absent from the list.</summary>
        public bool Solid;
        public StationCellShape Shape;
        public StationFinishSet Finish;
        public StationMeshCellFlags Flags;

        public StationCellKey Key => new StationCellKey(X, Y, Z);
    }

    /// <summary>The platform-edge strip a PSD base owns (`BlockInset`), in cell-local units.</summary>
    public readonly struct StationCellInset {
        public readonly double X0, X1, Y0, Y1;
        public StationCellInset(double x0, double x1, double y0, double y1) { X0 = x0; X1 = x1; Y0 = y0; Y1 = y1; }
        public bool IsFull => X0 <= 0 && X1 >= 1 && Y0 <= 0 && Y1 >= 1;
        public static readonly StationCellInset Full = new StationCellInset(0, 1, 0, 1);
    }

    /// <summary>One clipped underside plane of a run, in cell-local units (`RampSurfacePatch`).</summary>
    public readonly struct StationRampPatch {
        public readonly char Axis;
        public readonly double Lo, Hi;
        public readonly bool HasBase;
        public readonly double Base;
        public readonly double X0, X1, Y0, Y1;

        public StationRampPatch(char axis, double lo, double hi, double x0, double x1, double y0, double y1, bool hasBase = false, double @base = 0) {
            Axis = axis; Lo = lo; Hi = hi; X0 = x0; X1 = x1; Y0 = y0; Y1 = y1; HasBase = hasBase; Base = @base;
        }
    }

    /// <summary>
    /// The volume a run takes out of a block under it (`SlopeCut`): the block's top is
    /// the run's own underside, a plane sloping along one horizontal axis in
    /// cell-local units. The caller derives these from the station's modules; the
    /// mesher only draws them.
    /// </summary>
    public sealed class StationSlopeCut {
        /// <summary>The axis the plane slopes along: 'x' or 'y'.</summary>
        public char Axis = 'x';
        public double Lo;
        public double Hi;
        public bool HasBase;
        public double Base;
        /// <summary>Half-width of the run's drawn body across the axis, for a filling cell.</summary>
        public bool HasHalf;
        public double Half;
        /// <summary>The run's own painted surface, when it has one.</summary>
        public string Finish;
        /// <summary>No filling is derived over this cut (a stair leaves its ground alone).</summary>
        public bool NoFill;
        /// <summary>The run's own piece draws the body that would be filled here.</summary>
        public bool OwnBody;
        /// <summary>Every intersecting underside piece, including crossing flights.</summary>
        public StationRampPatch[] Patches;

        public IReadOnlyList<StationRampPatch> PatchList => Patches ?? new[] {
            new StationRampPatch(Axis, Lo, Hi, 0, 1, 0, 1, HasBase, Base),
        };
    }

    /// <summary>Everything the mesher draws from. The caller builds it from the document.</summary>
    public sealed class StationCellMeshInput {
        /// <summary>Every explicit solid cell of the document (voids are simply absent).</summary>
        public List<StationMeshCell> Cells = new List<StationMeshCell>();
        /// <summary>Explicit non-solid records: a dug hole must not be paved back over.</summary>
        public HashSet<StationCellKey> Voids = new HashSet<StationCellKey>();
        /// <summary>Whether absent coordinates at <see cref="GroundZ"/> are solid street.</summary>
        public bool VirtualGround = true;
        public int GroundZ;
        /// <summary>Metres the generated street reaches past the station's content (`GROUND_MARGIN`).</summary>
        public int GroundMargin = 16;
        public bool HasGroundWindow;
        public int GroundX0, GroundX1, GroundY0, GroundY1;
        /// <summary>Module-derived street holes: a ramp corridor, an exit floor, a bored track.</summary>
        public HashSet<StationCellKey> GroundHoles = new HashSet<StationCellKey>();
        public Dictionary<StationCellKey, StationSlopeCut> SlopeCuts = new Dictionary<StationCellKey, StationSlopeCut>();
        public HashSet<StationCellKey> SlopeFills = new HashSet<StationCellKey>();
        public Dictionary<StationCellKey, StationCellInset> Insets = new Dictionary<StationCellKey, StationCellInset>();
        /// <summary>Cells hidden from the mesh (a shop's auto walls), still solid for caps.</summary>
        public HashSet<StationCellKey> HiddenCells = new HashSet<StationCellKey>();
        public int LevelBase;
        public int StoreyHeight = 5;
        public bool BuildCeilings = true;
        /// <summary>Draw the source's unsupported-plate pass (`f`). Off by default: a plate is then drawn once, in the Cell role, instead of twice.</summary>
        public bool BuildPlates;
        public bool BuildGround = true;
        /// <summary>When true, suspended-ceiling chunks remain non-occluding but emit no mesh (`autoCeiling` standalone viewer).</summary>
        public bool OmitSuspendedCeilings;
        /// <summary>When true, each storey band's meshing and classification only occludes against cells in the same band.</summary>
        public bool IsolateBandOcclusion;
        /// <summary>The finish a face without an override wears (`DEFAULT_FINISH`).</summary>
        public string DefaultFinish = StationFinishIds.DefaultMaterial;
        /// <summary>The finish the derived filling under a truss wears (`RAMP_SOFFIT_FINISH`).</summary>
        public string RampSoffitFinish = "ceil.steel";
    }

    /// <summary>Viewer meshing policy for standalone tray presentations (<c>StationExplodedTrayBuilder</c>).</summary>
    public sealed class StationCellViewerPolicy {
        /// <summary>Optional retained cell keys in original document coordinates; null keeps all solid cells.</summary>
        public HashSet<StationCellKey> RetainedCells;
        /// <summary>Omit <see cref="StationSurfaceRole.Ceiling"/> chunks emitted from suspended ceiling cells while keeping them non-occluding.</summary>
        public bool OmitSuspendedCeilings = true;
        /// <summary>Restrict face occlusion and neighbour checks to each storey band's own retained cells so tray seams re-emit caps.</summary>
        public bool IsolateBandOcclusion = true;

        public StationCellViewerPolicy() { }

        public StationCellViewerPolicy(HashSet<StationCellKey> retained, bool omitSuspendedCeilings = true,
            bool isolateBandOcclusion = true) {
            RetainedCells = retained;
            OmitSuspendedCeilings = omitSuspendedCeilings;
            IsolateBandOcclusion = isolateBandOcclusion;
        }
    }

    /// <summary>One painted surface the mesh presents, for picking and painting.</summary>
    public readonly struct StationCellFaceRecord {
        public readonly int X, Y, Z;
        public readonly StationFace Face;
        public readonly string FinishId;
        public readonly StationSurfaceRole Role;
        /// <summary>A 's always-drawn 45 slope (a face of the piece, not the cell).</summary>
        public readonly bool Slope;

        public StationCellFaceRecord(int x, int y, int z, StationFace face, string finishId, StationSurfaceRole role, bool slope) {
            X = x; Y = y; Z = z; Face = face; FinishId = finishId; Role = role; Slope = slope;
        }

        public StationCellKey CellKey => new StationCellKey(X, Y, Z);
        public override string ToString() => X + "," + Y + "," + Z + "/" + StationFaces.Name(Face) + ":" + FinishId;
    }

    /// <summary>One drawable run of triangles: chunk  storey  role  finish.</summary>
    public sealed class StationCellMeshGroup {
        public int ChunkX, ChunkY, Storey;
        public StationSurfaceRole Role;
        public string FinishId;
        public Vector3[] Positions;
        public Vector3[] Normals;
        public Color[] Colors;
        public Vector2[] Uvs;
        public int[] Indices;
        /// <summary>Per triangle, the index into <see cref="StationCellMeshResult.Faces"/>.</summary>
        public int[] TriangleFaces;
        /// <summary>Self-contained face table for this chunk group, independent of station-wide face indices.</summary>
        public StationCellFaceRecord[] LocalFaces;
        /// <summary>Per triangle, the index into <see cref="LocalFaces"/>.</summary>
        public int[] LocalTriangleFaces;
        public Bounds Bounds;
        /// <summary>
        /// The cell whose face was minted first for this finish in the chunk  storey: the
        /// anchor the old unsplit group's level span was derived from. Role splits keep
        /// the anchor so they draw on exactly the storey the unsplit group drew on.
        /// </summary>
        public StationCellKey Anchor;
        /// <summary>Whether <see cref="Anchor"/> is meaningful (always true for a built group).</summary>
        public bool HasAnchor;

        public int VertexCount => Positions?.Length ?? 0;
        public int TriangleCount => (Indices?.Length ?? 0) / 3;
        public string GroupKey => ChunkX + "," + ChunkY + "|" + Storey + "|" + Role + "|" + FinishId;
        public override string ToString() => GroupKey + " tris=" + TriangleCount;
    }

    public sealed class StationCellMeshResult {
        public List<StationCellMeshGroup> Groups = new List<StationCellMeshGroup>();
        public List<StationCellFaceRecord> Faces = new List<StationCellFaceRecord>();
        public int Triangles;
        public int CellsVisited;
        public int CellsDrawn;
        public int GeneratedGroundCells;
        public int SuspendedCeilingCells;
        public int FloatingPlateCells;
        /// <summary>Cells a slope cut shaved (their caps are the run's underside).</summary>
        public int SlopeCutCells;

        public int GroupCount => Groups.Count;

        /// <summary>Triangle counts per finish id, for the evidence report.</summary>
        public Dictionary<string, int> TrianglesByFinish() {
            var result = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var group in Groups) {
                result.TryGetValue(group.FinishId, out var count);
                result[group.FinishId] = count + group.TriangleCount;
            }
            return result;
        }
    }

    public static class StationCellMesher {
        public const int ChunkSize = 16;

        /// <summary>Mesh the whole station into the document-axis groups the view binds.</summary>
        public static StationCellMeshResult Mesh(StationCellMeshInput input) {
            if (input == null) throw new ArgumentNullException(nameof(input));
            var session = new MeshSession(input);
            return session.Run();
        }
    }

    internal static class StationCellSurfacePolicy {
        internal delegate bool CellLookup(StationCellKey key, out StationMeshCell cell);

        const StationMeshCellFlags Plates = StationMeshCellFlags.SuspendedCeiling | StationMeshCellFlags.OpeningCeiling;
        const StationMeshCellFlags NonPlain = Plates | StationMeshCellFlags.Wall;
        static readonly (int x, int y)[] Neighbours = { (1, 0), (-1, 0), (0, 1), (0, -1) };

        // Classify against the physical courses, including those in hidden storeys.
        internal static bool IsCeiling(StationMeshCell cell, int band, int height, bool infer, CellLookup lookup) {
            if (!infer) return (cell.Flags & StationMeshCellFlags.SuspendedCeiling) != 0;
            int x = cell.X, y = cell.Y, z = cell.Z;
            if (z - band < 3) return false;
            if ((cell.Flags & Plates) != 0) return true;
            if (!cell.Shape.IsFull || (cell.Flags & StationMeshCellFlags.Wall) != 0) return false;
            if (IsSolid(lookup, x, y, z + 1)) return false;
            // A nearby upper floor identifies lining even at a stair opening.
            if (z + 1 == band + height && HasPlainNeighbour(lookup, x, y, z + 1)) return false;
            if (!lookup(new StationCellKey(x, y, band), out var floor) ||
                !floor.Shape.IsFull || (floor.Flags & Plates) != 0) return false;
            for (int course = band + 1; course < z; course++) {
                if (IsSolid(lookup, x, y, course)) return false;
            }
            foreach (var (dx, dy) in Neighbours) {
                if (IsSolid(lookup, x + dx, y + dy, z)) return true;
            }
            return false;
        }

        // A masonry roof is an exposed, backed deck at or above grade. The footprint
        // excludes wall crests. Only its exposed cap gets the independent roof toggle.
        internal static bool IsMasonryRoof(StationMeshCell cell, int band, int height, int grade, CellLookup lookup) {
            int x = cell.X, y = cell.Y, z = cell.Z;
            if (z < grade || (z != grade && z - band < 3)) return false;
            if (!cell.Shape.IsFull || (cell.Flags & NonPlain) != 0 ||
                (cell.Finish.Top?.StartsWith("wall.", StringComparison.Ordinal) ?? false)) return false;
            if (IsSolid(lookup, x, y, z + 1) || !IsPlain(lookup, x, y, z - 1)) return false;
            if (z + 1 == band + height && HasPlainNeighbour(lookup, x, y, z + 1)) return false;
            for (int dx = -1; dx <= 1; dx += 2) {
                for (int dy = -1; dy <= 1; dy += 2) {
                    if (IsPlain(lookup, x + dx, y, z) && IsPlain(lookup, x, y + dy, z) &&
                        IsPlain(lookup, x + dx, y + dy, z)) return true;
                }
            }
            return false;
        }

        static bool HasPlainNeighbour(CellLookup lookup, int x, int y, int z) {
            foreach (var (dx, dy) in Neighbours) {
                if (IsPlain(lookup, x + dx, y + dy, z)) return true;
            }
            return false;
        }

        static bool IsSolid(CellLookup lookup, int x, int y, int z) =>
            lookup(new StationCellKey(x, y, z), out var cell) && cell.Solid;

        static bool IsPlain(CellLookup lookup, int x, int y, int z) =>
            lookup(new StationCellKey(x, y, z), out var cell) && cell.Solid &&
            cell.Shape.IsFull && (cell.Flags & NonPlain) == 0;
    }

    internal interface IMeshCellSource {
        List<MeshSession.Profile> Sections { get; }
        MeshSession.Profile[] BlockProfiles { get; }
        int FaceRecord(int x, int y, int z, StationFace face, int finishIdx, StationSurfaceRole role, bool slope);
        StationCellFaceRecord GetFaceRecord(int index);
        string FinishId(int index);
        void FinishIndexes(StationCellKey key, StationSlopeCut cut, out int top, out int bottom,
            out int e, out int w, out int n, out int s, out bool filled);
        bool IsMasonryRoof(StationCellKey key);
        bool IsWallCell(StationCellKey key);
        bool IsHidden(StationCellKey key);
        bool IsFilled(StationCellKey key);
        bool HasSlope(StationCellKey key);
        StationSlopeCut CutAt(StationCellKey key);
        StationCellShape ShapeAt(StationCellKey key);
        StationCellInset InsetAt(StationCellKey key);
        bool IsSuspended(StationCellKey key);
        bool IsPassSolid(StationCellKey key, int band, StationSurfaceRole passRole);
        bool IsBandSolid(StationCellKey key, int band);
        bool IsEmitted(StationCellKey key, int band, StationSurfaceRole passRole);
        void NoteCellDrawn();
        void EmitGroup(StationCellMeshGroup group);
    }

    /// <summary>Per-mesh working state: mirrors one `ChunkSystem.meshStation` rebuild.</summary>
    sealed class MeshSession : IMeshCellSource {
        readonly StationCellMeshInput input;
        readonly StationCellSurfacePolicy.CellLookup lookup;
        readonly StationCellMeshResult result = new StationCellMeshResult();

        readonly Dictionary<StationCellKey, StationMeshCell> cells = new Dictionary<StationCellKey, StationMeshCell>();
        readonly HashSet<StationCellKey> solid = new HashSet<StationCellKey>();
        readonly HashSet<StationCellKey> drawsKeys = new HashSet<StationCellKey>();
        readonly HashSet<StationCellKey> groundKeys = new HashSet<StationCellKey>();
        readonly Dictionary<StationCellKey, StationCellShape> thin = new Dictionary<StationCellKey, StationCellShape>();
        readonly Dictionary<StationCellKey, StationFinishSet> finishes = new Dictionary<StationCellKey, StationFinishSet>();
        readonly Dictionary<StationCellKey, int> bandOfCell = new Dictionary<StationCellKey, int>();
        readonly Dictionary<string, int> groundOfColumn = new Dictionary<string, int>(StringComparer.Ordinal);
        readonly HashSet<StationCellKey> suspended = new HashSet<StationCellKey>();
        readonly HashSet<StationCellKey> openingCeiling = new HashSet<StationCellKey>();
        readonly HashSet<StationCellKey> floating = new HashSet<StationCellKey>();
        /// <summary>Top faces of the storey's slab: the source's auto-ceiling/roof surfaces.</summary>
        readonly Dictionary<StationCellKey, StationSlopeCut> slope;
        readonly Dictionary<StationCellKey, StationCellInset> insets;
        readonly HashSet<StationCellKey> fills;
        readonly HashSet<StationCellKey> hidden;

        internal readonly struct FaceRecordKey : IEquatable<FaceRecordKey> {
            readonly long a;
            readonly long b;

            public FaceRecordKey(int x, int y, int z, StationFace face, int finishIndex, StationSurfaceRole role, bool slope) {
                a = ((long)x << 32) | (uint)y;
                b = ((long)z << 32) | (((long)(uint)finishIndex & 0xFFFFFFL) << 8) | (((long)role & 0xFL) << 4) | (((long)face & 0x7L) << 1) | (slope ? 1L : 0L);
            }

            public bool Equals(FaceRecordKey other) => a == other.a && b == other.b;
            public override bool Equals(object obj) => obj is FaceRecordKey other && Equals(other);
            public override int GetHashCode() {
                unchecked {
                    long h = a * -7046029254386353131L + b * -4417276706812531889L;
                    return (int)(h ^ (long)((ulong)h >> 32));
                }
            }
        }

        readonly List<string> finishIds = new List<string>();
        readonly Dictionary<string, int> finishIndex = new Dictionary<string, int>(StringComparer.Ordinal);
        readonly Dictionary<FaceRecordKey, int> faceRecordIndex = new Dictionary<FaceRecordKey, int>();

        // Scratch reused per cell, as the source does.
        readonly List<Profile> sections = new List<Profile>(2);
        readonly Profile[] blockProfiles = new Profile[16];
        readonly Dictionary<int, HashSet<StationCellKey>> emitByBand = new Dictionary<int, HashSet<StationCellKey>>();
        HashSet<StationCellKey> groundEmitSet;

        public List<Profile> Sections => sections;
        public Profile[] BlockProfiles => blockProfiles;

        public MeshSession(StationCellMeshInput input) {
            this.input = input;
            lookup = cells.TryGetValue;
            slope = input.SlopeCuts ?? new Dictionary<StationCellKey, StationSlopeCut>();
            insets = input.Insets ?? new Dictionary<StationCellKey, StationCellInset>();
            fills = input.SlopeFills ?? new HashSet<StationCellKey>();
            hidden = input.HiddenCells ?? new HashSet<StationCellKey>();
            // The default ids keep stable part order across a station.
            FinishIndex(input.DefaultFinish);
        }

        public StationCellMeshResult Run() {
            CollectCells();
            Classify();
            MeshBands();
            if (input.BuildGround) MeshGround();
            return result;
        }

        /* ------------------------------------------------------------ collection */

        void CollectCells() {
            foreach (var cell in input.Cells) {
                if (!cell.Solid) continue;
                var key = cell.Key;
                cells[key] = cell;
                solid.Add(key);
                drawsKeys.Add(key);
                if (!cell.Shape.IsFull) thin[key] = cell.Shape;
                if (cell.Finish.Any) finishes[key] = cell.Finish;
                if ((cell.Flags & StationMeshCellFlags.OpeningCeiling) != 0) openingCeiling.Add(key);
            }
            // The generated street (`sim/ground.ts` `withGround` minus openings): the
            // window is the station's own content plus GROUND_MARGIN, every coordinate
            // the document speaks for is skipped (a solid *or* a dug void), and so is
            // every module-derived hole.
            if (!input.VirtualGround) return;
            int minX, maxX, minY, maxY;
            if (input.HasGroundWindow) {
                minX = input.GroundX0; maxX = input.GroundX1;
                minY = input.GroundY0; maxY = input.GroundY1;
            } else {
                minX = int.MaxValue; maxX = int.MinValue; minY = int.MaxValue; maxY = int.MinValue;
                foreach (var cell in input.Cells) {
                    if (cell.X < minX) minX = cell.X;
                    if (cell.X > maxX) maxX = cell.X;
                    if (cell.Y < minY) minY = cell.Y;
                    if (cell.Y > maxY) maxY = cell.Y;
                }
                foreach (var voidKey in input.Voids) {
                    if (voidKey.X < minX) minX = voidKey.X;
                    if (voidKey.X > maxX) maxX = voidKey.X;
                    if (voidKey.Y < minY) minY = voidKey.Y;
                    if (voidKey.Y > maxY) maxY = voidKey.Y;
                }
                if (minX == int.MaxValue) { minX = maxX = 0; minY = maxY = 0; }
                minX -= input.GroundMargin; maxX += input.GroundMargin;
                minY -= input.GroundMargin; maxY += input.GroundMargin;
            }
            for (var x = minX; x <= maxX; x++) {
                for (var y = minY; y <= maxY; y++) {
                    var key = new StationCellKey(x, y, input.GroundZ);
                    if (cells.ContainsKey(key) || input.Voids.Contains(key) || input.GroundHoles.Contains(key)) continue;
                    var cell = new StationMeshCell {
                        X = x, Y = y, Z = input.GroundZ, Solid = true,
                        Shape = StationCellShape.Full, Flags = StationMeshCellFlags.None,
                    };
                    cells[key] = cell;
                    solid.Add(key);
                    drawsKeys.Add(key);
                    groundKeys.Add(key);
                    result.GeneratedGroundCells++;
                }
            }
            foreach (var cell in input.Cells) {
                if ((cell.Flags & StationMeshCellFlags.PaintedGround) != 0 && cell.Z == input.GroundZ) groundKeys.Add(cell.Key);
            }
        }

        void Classify() {
            foreach (var pair in cells) {
                if (StationCellSurfacePolicy.IsCeiling(pair.Value, StoreyBand(pair.Key.Z),
                        input.StoreyHeight, input.BuildCeilings, lookup)) suspended.Add(pair.Key);
            }
            if (input.BuildCeilings) result.SuspendedCeilingCells = suspended.Count;
            // The lowest storey each column reaches: a block standing on it has nothing
            // under it, so it is a plate hanging in space (the source's `floating`).
            groundOfColumn.Clear();
            foreach (var pair in cells) {
                var cell = pair.Value;
                if (!cell.Solid) continue;
                var band = StoreyBand(cell.Z);
                bandOfCell[pair.Key] = band;
                var column = cell.X + "," + cell.Y;
                if (!groundOfColumn.TryGetValue(column, out var current) || band < current) groundOfColumn[column] = band;
            }
            foreach (var pair in cells) {
                var cell = pair.Value;
                if (!cell.Solid) continue;
                if (openingCeiling.Contains(pair.Key) || suspended.Contains(pair.Key)) continue;
                var band = bandOfCell[pair.Key];
                if (groundOfColumn.TryGetValue(cell.X + "," + cell.Y, out var ground) && band == ground) floating.Add(pair.Key);
            }
            result.FloatingPlateCells = floating.Count;
            result.SlopeCutCells = slope.Count;
        }

        int StoreyBand(int z) => StationCoordinates.StoreyBand(z, input.LevelBase);

        /* ------------------------------------------------------------- meshing */

        void MeshBands() {
            var authoredByBand = new SortedDictionary<int, List<StationCellKey>>();
            foreach (var pair in cells) {
                var cell = pair.Value;
                if (!cell.Solid) continue;
                if (groundKeys.Contains(pair.Key)) continue;
                // A hidden cell is drawn by no pass of this storey, so it cannot occlude a
                // cap either: leaving it in `emit` suppressed the cap under a hidden
                // independent layer and left a hole (`18 §1`).
                if (hidden.Contains(pair.Key)) continue;
                if (!bandOfCell.TryGetValue(pair.Key, out var band)) band = StoreyBand(cell.Z);
                if (!authoredByBand.TryGetValue(band, out var list)) authoredByBand[band] = list = new List<StationCellKey>();
                list.Add(pair.Key);
            }
            var byBand = new SortedDictionary<int, List<StationCellKey>>();
            foreach (var pair in authoredByBand) {
                var authored = pair.Value;
                authored.Sort((a, b) => a.X != b.X ? a.X.CompareTo(b.X) : a.Y != b.Y ? a.Y.CompareTo(b.Y) : a.Z.CompareTo(b.Z));
                var list = new List<StationCellKey>(authored.Count + 8);
                for (int i = 0; i < authored.Count; i++) {
                    var key = authored[i];
                    list.Add(key);
                    // The filling a block carries up to a run's truss is meshed with it, in
                    // the block's own storey: it is that block's top surface.
                    var fill = new StationCellKey(key.X, key.Y, key.Z + 1);
                    if (fills.Contains(fill)) list.Add(fill);
                }
                byBand[pair.Key] = list;
                emitByBand[pair.Key] = new HashSet<StationCellKey>(list);
            }
            foreach (var pair in byBand) {
                var band = pair.Key;
                var keys = pair.Value;
                var byChunk = GroupByChunk(keys);
                foreach (var chunk in byChunk) {
                    var chunkCells = chunk.Value;
                    var storeyCells = new List<StationCellKey>(chunkCells.Count);
                    var ceilingCells = new List<StationCellKey>();
                    var plateCells = new List<StationCellKey>();
                    foreach (var key in chunkCells) {
                        if (suspended.Contains(key)) ceilingCells.Add(key);
                        else storeyCells.Add(key);
                        if (floating.Contains(key)) plateCells.Add(key);
                    }
                    var plates = new List<StationCellKey>(plateCells.Count);
                    foreach (var key in plateCells) {
                        plates.Add(key);
                        if (!cells.TryGetValue(key, out var cell)) continue;
                        var fill = new StationCellKey(cell.X, cell.Y, cell.Z + 1);
                        if (fills.Contains(fill)) plates.Add(fill);
                    }
                    MeshChunk(chunk.Key.x, chunk.Key.y, band, storeyCells, StationSurfaceRole.Cell);
                    if (ceilingCells.Count > 0 && !input.OmitSuspendedCeilings)
                        MeshChunk(chunk.Key.x, chunk.Key.y, band, ceilingCells, StationSurfaceRole.Ceiling);
                    if (plates.Count > 0 && input.BuildPlates)
                        MeshChunk(chunk.Key.x, chunk.Key.y, band, plates, StationSurfaceRole.Plate);
                }
            }
        }

        void MeshGround() {
            if (groundKeys.Count == 0) return;
            var band = StoreyBand(input.GroundZ);
            groundEmitSet = new HashSet<StationCellKey>(groundKeys);
            var ordered = new List<StationCellKey>(groundKeys);
            ordered.Sort((a, b) => a.X != b.X ? a.X.CompareTo(b.X) : a.Y != b.Y ? a.Y.CompareTo(b.Y) : a.Z.CompareTo(b.Z));
            var byChunk = GroupByChunk(ordered);
            foreach (var chunk in byChunk) {
                MeshChunk(chunk.Key.x, chunk.Key.y, band, chunk.Value, StationSurfaceRole.Ground);
            }
        }

        SortedDictionary<(int x, int y), List<StationCellKey>> GroupByChunk(IEnumerable<StationCellKey> keys) {
            var byChunk = new SortedDictionary<(int, int), List<StationCellKey>>();
            foreach (var key in keys) {
                var cx = FloorDiv(key.X, StationCellMesher.ChunkSize) * StationCellMesher.ChunkSize;
                var cy = FloorDiv(key.Y, StationCellMesher.ChunkSize) * StationCellMesher.ChunkSize;
                if (!byChunk.TryGetValue((cx, cy), out var list)) byChunk[(cx, cy)] = list = new List<StationCellKey>();
                list.Add(key);
            }
            return byChunk;
        }

        internal static int FloorDiv(int value, int divisor) => value >= 0 ? value / divisor : (value - divisor + 1) / divisor;

        void MeshChunk(int cx, int cy, int band, List<StationCellKey> visits, StationSurfaceRole role) {
            if (visits.Count == 0) return;
            var chunk = new ChunkBuilder(this, cx, cy, band, role);
            foreach (var key in visits) {
                result.CellsVisited++;
                chunk.Cell(key);
            }
            chunk.Flush();
        }

        /* --------------------------------------------------------------- helpers */

        int FinishIndex(string id) {
            if (string.IsNullOrEmpty(id)) id = input.DefaultFinish;
            if (finishIndex.TryGetValue(id, out var index)) return index;
            index = finishIds.Count;
            finishIds.Add(id);
            finishIndex[id] = index;
            return index;
        }

        public string FinishId(int index) => index >= 0 && index < finishIds.Count ? finishIds[index] : input.DefaultFinish;

        public int FaceRecord(int x, int y, int z, StationFace face, int finishIdx, StationSurfaceRole role, bool slope) {
            var key = new FaceRecordKey(x, y, z, face, finishIdx, role, slope);
            if (faceRecordIndex.TryGetValue(key, out var index)) return index;
            index = result.Faces.Count;
            result.Faces.Add(new StationCellFaceRecord(x, y, z, face, FinishId(finishIdx), role, slope));
            faceRecordIndex[key] = index;
            return index;
        }

        public StationCellFaceRecord GetFaceRecord(int index) =>
            index >= 0 && index < result.Faces.Count ? result.Faces[index] : default;

        public StationCellShape ShapeAt(StationCellKey key) => thin.TryGetValue(key, out var shape) ? shape : StationCellShape.Full;
        public StationCellInset InsetAt(StationCellKey key) => insets.TryGetValue(key, out var inset) ? inset : StationCellInset.Full;
        public StationSlopeCut CutAt(StationCellKey key) => slope.TryGetValue(key, out var cut) ? cut : null;
        public bool IsMasonryRoof(StationCellKey key) =>
            !groundKeys.Contains(key) && cells.TryGetValue(key, out var cell) &&
            StationCellSurfacePolicy.IsMasonryRoof(cell, StoreyBand(key.Z), input.StoreyHeight, input.GroundZ, lookup);
        public bool IsWallCell(StationCellKey key) => cells.TryGetValue(key, out var c) && (c.Flags & StationMeshCellFlags.Wall) != 0;
        public bool IsHidden(StationCellKey key) => hidden.Contains(key);
        public bool IsFilled(StationCellKey key) => fills.Contains(key);
        public bool HasSlope(StationCellKey key) => slope.ContainsKey(key);
        public bool IsSuspended(StationCellKey key) => suspended.Contains(key);

        public bool IsBandSolid(StationCellKey key, int band) =>
            input.IsolateBandOcclusion ? (emitByBand.TryGetValue(band, out var e) && e.Contains(key)) : solid.Contains(key);

        public bool IsPassSolid(StationCellKey key, int band, StationSurfaceRole passRole) {
            if (passRole == StationSurfaceRole.Ground) return solid.Contains(key);
            if (passRole == StationSurfaceRole.Plate) return floating.Contains(key);
            return IsBandSolid(key, band);
        }

        public bool IsEmitted(StationCellKey key, int band, StationSurfaceRole passRole) {
            if (passRole == StationSurfaceRole.Ground) return groundEmitSet != null && groundEmitSet.Contains(key);
            return emitByBand.TryGetValue(band, out var e) && e.Contains(key);
        }

        public void NoteCellDrawn() => result.CellsDrawn++;

        public void EmitGroup(StationCellMeshGroup group) {
            result.Groups.Add(group);
            result.Triangles += group.TriangleCount;
        }

        /// <summary>The finishes a cell's faces wear, with the defaults resolved.</summary>
        public void FinishIndexes(StationCellKey key, StationSlopeCut cut, out int top, out int bottom,
            out int e, out int w, out int n, out int s, out bool filled) {
            filled = fills.Contains(key);
            finishes.TryGetValue(key, out var own);
            StationFinishSet fin = own;
            if (!fin.Any && filled) {
                var below = new StationCellKey(key.X, key.Y, key.Z - 1);
                if (finishes.TryGetValue(below, out var inherited)) fin = inherited;
            }
            var truss = filled && cut != null && cut.HasHalf;
            var soffit = truss ? FinishIndex(input.RampSoffitFinish) : -1;
            top = (truss ? soffit : -1) >= 0 ? soffit
                : FinishIndex(fin.Top ?? (cut?.Finish ?? input.DefaultFinish));
            bottom = (truss ? soffit : -1) >= 0 ? soffit : FinishIndex(fin.Bottom ?? input.DefaultFinish);
            e = truss ? soffit : FinishIndex(fin.E ?? input.DefaultFinish);
            w = truss ? soffit : FinishIndex(fin.W ?? input.DefaultFinish);
            n = truss ? soffit : FinishIndex(fin.N ?? input.DefaultFinish);
            s = truss ? soffit : FinishIndex(fin.S ?? input.DefaultFinish);
        }

        /* ----------------------------------------------------------- the mesher */

        /// <summary>One chunk  storey  role mesh, with one builder per finish part.</summary>
        internal sealed class ChunkBuilder {
            readonly IMeshCellSource session;
            readonly int cx, cy, band;
            readonly StationSurfaceRole role;
            readonly bool hasNonOccluding;
            // A finish can be split across roles (a wall finish on a wall, the same finish
            // on a floor), so one builder per finish **and role**. The key is a packed
            // (role, finish) long rather than a ValueTuple: it keeps this hot dictionary
            // on a primitive key with no new AOT generic instantiation.
            readonly Dictionary<long, VecBuilder> builders = new Dictionary<long, VecBuilder>();
            readonly List<long> builderOrder = new List<long>();
            /// <summary>First cell a face was minted for each finish: the unsplit group's level anchor.</summary>
            readonly Dictionary<int, StationCellKey> anchors = new Dictionary<int, StationCellKey>();

            public ChunkBuilder(IMeshCellSource session, int cx, int cy, int band, StationSurfaceRole role) {
                this.session = session;
                this.cx = cx; this.cy = cy; this.band = band;
                this.role = role;
                hasNonOccluding = role != StationSurfaceRole.Ceiling;
            }

            static long BuilderKey(StationSurfaceRole builtRole, int finishIndex) =>
                ((long)(int)builtRole << 32) | (uint)finishIndex;

            VecBuilder Builder(StationSurfaceRole builtRole, int finishIndex) {
                var entry = BuilderKey(builtRole, finishIndex);
                if (!builders.TryGetValue(entry, out var builder)) {
                    builders[entry] = builder = new VecBuilder();
                    builderOrder.Add(entry);
                }
                return builder;
            }

            int Face(int x, int y, int z, StationFace face, int finishIndex, StationSurfaceRole faceRole, bool slope = false) {
                // The old unsplit group's level span came from its **first** face. The role
                // splits reuse that cell, so a wall or ceiling part of a chunk draws on
                // exactly the storey the whole chunk used to draw on.
                if (!anchors.ContainsKey(finishIndex)) anchors[finishIndex] = new StationCellKey(x, y, z);
                return session.FaceRecord(x, y, z, face, finishIndex, faceRole, slope);
            }

            StationSurfaceRole SurfaceRole(int x, int y, int z, int finishIndex, bool slope, bool top) {
                if (role != StationSurfaceRole.Cell) return role;
                var key = new StationCellKey(x, y, z);
                if (top && !slope && session.IsMasonryRoof(key)) return StationSurfaceRole.Roof;
                if (IsWallFinish(session.FinishId(finishIndex))) return StationSurfaceRole.Wall;
                if (session.IsWallCell(key)) return StationSurfaceRole.Wall;
                return StationSurfaceRole.Cell;
            }

            static bool IsWallFinish(string id) =>
                !string.IsNullOrEmpty(id) && id.StartsWith("wall.", StringComparison.Ordinal);

            bool IsSolid(int x, int y, int z) {
                var key = new StationCellKey(x, y, z);
                if (hasNonOccluding && session.IsSuspended(key)) return false;
                if (session.IsHidden(key)) return false;
                if (session.IsFilled(key)) return false;
                return session.IsPassSolid(key, band, role);
            }

            bool Draws(int x, int y, int z) {
                var key = new StationCellKey(x, y, z);
                if (hasNonOccluding && session.IsSuspended(key)) return false;
                return session.IsPassSolid(key, band, role) || session.IsFilled(key);
            }

            StationSlopeCut CutAt(int x, int y, int z) => session.CutAt(new StationCellKey(x, y, z));

            public void Cell(StationCellKey key) {
                var x = key.X; var y = key.Y; var z = key.Z;
                if (!Draws(x, y, z)) return;
                if (session.IsHidden(key)) return;
                if (!session.IsEmitted(key, band, role)) return;
                var cut = CutAt(x, y, z);
                var filled = session.IsFilled(key);
                var above = new StationCellKey(x, y, z + 1);
                bool up;
                if (hasNonOccluding && session.IsSuspended(above)) up = true;
                else if (role == StationSurfaceRole.Plate) up = !(session.IsBandSolid(above, band) || session.IsFilled(above));
                else up = !(Draws(x, y, z + 1) && session.IsEmitted(above, band, role));
                var down = !Draws(x, y, z - 1);
                // A wedge's slope leaves the square above/below it half open: only a
                // wedge whose flat base faces the cell covers it ( below,  above).
                var ownShape = session.ShapeAt(key);
                if (!up) {
                    var over = session.ShapeAt(above);
                    if (over.Kind == StationShapeKind.Cuts ||
                        (over.Kind == StationShapeKind.Corner && !(ownShape.Kind == StationShapeKind.Corner && ownShape.Side == over.Side)) ||
                        (over.Kind == StationShapeKind.Half && !(ownShape.Kind == StationShapeKind.Half && ownShape.Side == over.Side)) ||
                        (over.Kind == StationShapeKind.Triangle && over.Triangle != StationTriangleKind.Upper)) up = true;
                }
                if (!down) {
                    var under = session.ShapeAt(new StationCellKey(x, y, z - 1));
                    if (under.Kind == StationShapeKind.Cuts ||
                        (under.Kind == StationShapeKind.Corner && !(ownShape.Kind == StationShapeKind.Corner && ownShape.Side == under.Side)) ||
                        (under.Kind == StationShapeKind.Half && !(ownShape.Kind == StationShapeKind.Half && ownShape.Side == under.Side)) ||
                        (under.Kind == StationShapeKind.Triangle && under.Triangle != StationTriangleKind.Lower)) down = true;
                }
                var e = SideOpen(x, y, z, x + 1, y, StationFace.W);
                var w = SideOpen(x, y, z, x - 1, y, StationFace.E);
                var n = SideOpen(x, y, z, x, y + 1, StationFace.S);
                var s = SideOpen(x, y, z, x, y - 1, StationFace.N);
                if (!up && !down && !e && !w && !n && !s && cut == null) return;
                resultCell(key, x, y, z, cut, filled, shape: ownShape, up, down, e, w, n, s);
            }

            void resultCell(StationCellKey key, int x, int y, int z, StationSlopeCut cut, bool filled, StationCellShape shape,
                bool up, bool down, bool e, bool w, bool n, bool s) {
                session.NoteCellDrawn();
                session.FinishIndexes(key, cut, out var topI, out var bottomI, out var eI, out var wI, out var nI, out var sI, out _);
                var truss = filled && cut != null && cut.HasHalf;
                if (shape.IsTriangle) {
                    // A ridge-locked run joins end to end with no face between its wedges.
                    bool SameAt(int nx, int ny) {
                        var other = session.ShapeAt(new StationCellKey(nx, ny, z));
                        return other.Kind == StationShapeKind.Triangle && other.Triangle == shape.Triangle && other.Side == shape.Side;
                    }
                    if (shape.Side == StationWallSide.E || shape.Side == StationWallSide.W) {
                        if (SameAt(x, y + 1)) n = false;
                        if (SameAt(x, y - 1)) s = false;
                    } else {
                        if (SameAt(x + 1, y)) e = false;
                        if (SameAt(x - 1, y)) w = false;
                    }
                    PushWedge(x, y, z, e, w, n, s, up, down, shape.Triangle, shape.Side, topI, bottomI, eI, wI, nI, sI);
                    return;
                }
                // The cross-sections this cell draws. A compound cut is the union of
                // whole quarter-rows; drawing both rows' profiles is exact because the
                // shared edge lies inside the piece.
                var sections = session.Sections;
                sections.Clear();
                var trussAxis = cut?.Axis ?? 'x';
                if (truss) sections.Add(BuildTrussProfile(trussAxis, cut.Half));
                else if (shape.Kind == StationShapeKind.Corner) {
                    var east = shape.Side == StationWallSide.E || shape.Side == StationWallSide.S;
                    var north = shape.Side == StationWallSide.N || shape.Side == StationWallSide.E;
                    sections.Add(BuildProfile(e, w, n, s,
                        new StationCellInset(east ? 0.5 : 0, east ? 1 : 0.5, north ? 0.5 : 0, north ? 1 : 0.5)));
                } else if (shape.IsHalfWall) {
                    sections.Add(BuildThinProfile(shape.Side, e, w, n, s));
                } else if (shape.Kind == StationShapeKind.Cuts) {
                    foreach (var rect in StationCellRules.CutRectangles(shape.Mask)) {
                        sections.Add(BuildProfile(e, w, n, s, new StationCellInset(rect.X0, rect.X1, rect.Y0, rect.Y1)));
                    }
                } else {
                    sections.Add(BuildProfile(e, w, n, s, session.InsetAt(key)));
                }

                var nearSlope = cut != null || CutAt(x + 1, y, z) != null || CutAt(x - 1, y, z) != null ||
                                CutAt(x, y + 1, z) != null || CutAt(x, y - 1, z) != null;
                var neighbours = new List<StationSlopeCut>();
                if (nearSlope) {
                    foreach (var (dx, dy) in new[] { (1, 0), (-1, 0), (0, 1), (0, -1) }) {
                        if (!IsSolid(x + dx, y + dy, z)) continue;
                        var neighbour = CutAt(x + dx, y + dy, z);
                        if (neighbour == null) continue;
                        var patches = new List<StationRampPatch>();
                        foreach (var patch in neighbour.PatchList) {
                            var shift = patch.Axis == 'x' ? dx : dy;
                            var lo = patch.Lo - (patch.Hi - patch.Lo) * shift;
                            var hi = patch.Hi - (patch.Hi - patch.Lo) * shift;
                            patches.Add(new StationRampPatch(patch.Axis, lo, hi,
                                patch.X0 + dx, patch.X1 + dx, patch.Y0 + dy, patch.Y1 + dy, patch.HasBase, patch.Base));
                        }
                        var copy = new StationSlopeCut {
                            Axis = neighbour.Axis, Lo = neighbour.Lo, Hi = neighbour.Hi,
                            HasBase = neighbour.HasBase, Base = neighbour.Base,
                            HasHalf = neighbour.HasHalf, Half = neighbour.Half,
                            Finish = neighbour.Finish, NoFill = neighbour.NoFill, OwnBody = neighbour.OwnBody,
                            Patches = patches.ToArray(),
                        };
                        neighbours.Add(copy);
                    }
                }
                if (cut != null || neighbours.Count > 0) {
                    var topAo = up ? (float)TopAoAt(x, y, z) : 0f;
                    var surface = cut ?? new StationSlopeCut { Axis = 'x', Lo = 1, Hi = 1, Patches = Array.Empty<StationRampPatch>() };
                    foreach (var built in sections) {
                        var edges = built.Edges;
                        var outline = Outline(built);
                        var regions = RampSurfaceRegions(outline, surface, neighbours);
                        foreach (var region in regions) {
                            var polygon = region.Polygon;
                            var height = region.Height;
                            double sumX = 0, sumY = 0;
                            foreach (var point in polygon) { sumX += point.X; sumY += point.Y; }
                            var cxm = sumX / polygon.Count;
                            var cym = sumY / polygon.Count;
                            if (height(cxm, cym) <= 1e-9) continue;
                            var gx = height(cxm + 1e-5, cym) - height(cxm - 1e-5, cym);
                            var gy = height(cxm, cym + 1e-5) - height(cxm, cym - 1e-5);
                            var norm = Math.Sqrt(gx * gx + gy * gy + 2e-5 * 2e-5);
                            var normal = new[] { -gx / norm, -gy / norm, 2e-5 / norm };
                            var topFace = -1;
                            var bottomFace = -1;
                            var topRole = SurfaceRole(x, y, z, topI, false, false);
                            var bottomRole = SurfaceRole(x, y, z, bottomI, false, false);
                            var topBuilder = Builder(topRole, topI);
                            var bottomBuilder = Builder(bottomRole, bottomI);
                            for (var i = 0; i < polygon.Count; i++) {
                                var p = polygon[i];
                                var q = polygon[(i + 1) % polygon.Count];
                                var hp = height(p.X, p.Y);
                                var hq = height(q.X, q.Y);
                                // A cut exposes its cap even if the uncut cell above is solid.
                                if (up || height(cxm, cym) < 1 - 1e-9) {
                                    if (topFace < 0) topFace = Face(x, y, z, StationFace.Top, topI, topRole);
                                    PushTri(topBuilder, x + cxm, y + cym, z + height(cxm, cym),
                                        x + p.X, y + p.Y, z + hp, x + q.X, y + q.Y, z + hq, normal, topAo,
                                        new[] { (cxm, cym), (p.X, p.Y), (q.X, q.Y) }, topFace);
                                }
                                if (down) {
                                    if (bottomFace < 0) bottomFace = Face(x, y, z, StationFace.Bottom, bottomI, bottomRole);
                                    PushTri(bottomBuilder, x + cxm, y + cym, z,
                                        x + q.X, y + q.Y, z, x + p.X, y + p.Y, z, new[] { 0d, 0, -1d }, 0.6f,
                                        new[] { (cxm, cym), (q.X, q.Y), (p.X, p.Y) }, bottomFace);
                                }
                                var dx = q.X - p.X;
                                var dy = q.Y - p.Y;
                                var len = Math.Sqrt(dx * dx + dy * dy);
                                if (len < 1e-9) continue;
                                var nx = dy / len;
                                var ny = -dx / len;
                                var mx = (p.X + q.X) / 2;
                                var my = (p.Y + q.Y) / 2;
                                var cellBoundary = mx < 1e-8 || mx > 1 - 1e-8 || my < 1e-8 || my > 1 - 1e-8;
                                ProfileEdge profileEdge = null;
                                foreach (var candidate in edges) {
                                    var ex = candidate.To.X - candidate.From.X;
                                    var ey = candidate.To.Y - candidate.From.Y;
                                    if (Math.Abs(ex * (my - candidate.From.Y) - ey * (mx - candidate.From.X)) < 1e-8 &&
                                        mx >= Math.Min(candidate.From.X, candidate.To.X) - 1e-8 &&
                                        mx <= Math.Max(candidate.From.X, candidate.To.X) + 1e-8 &&
                                        my >= Math.Min(candidate.From.Y, candidate.To.Y) - 1e-8 &&
                                        my <= Math.Max(candidate.From.Y, candidate.To.Y) + 1e-8) { profileEdge = candidate; break; }
                                }
                                var external = profileEdge != null;
                                if (external && !profileEdge.Exposed) continue;
                                double OtherHeight(double px, double py) {
                                    if (!external) return RampSurfaceHeight(surface, px, py);
                                    if (!cellBoundary) return 0;
                                    var ddx = (int)Math.Round(nx);
                                    var ddy = (int)Math.Round(ny);
                                    if (!IsSolid(x + ddx, y + ddy, z)) return 0;
                                    var other = CutAt(x + ddx, y + ddy, z);
                                    return other != null ? RampSurfaceHeight(other, px - ddx, py - ddy) : 1;
                                }
                                var outside = OtherHeight(mx + nx * 1e-7, my + ny * 1e-7);
                                if (height(mx, my) <= outside + 1e-8) continue;
                                var lp = OtherHeight(p.X + nx * 1e-7 + dx * 1e-7, p.Y + ny * 1e-7 + dy * 1e-7);
                                var lq = OtherHeight(q.X + nx * 1e-7 - dx * 1e-7, q.Y + ny * 1e-7 - dy * 1e-7);
                                var sideIndex = StationFaces.SideOf((float)nx, (float)ny) switch {
                                    StationWallSide.N => nI,
                                    StationWallSide.E => eI,
                                    StationWallSide.S => sI,
                                    _ => wI,
                                };
                                var sideRole = SurfaceRole(x, y, z, sideIndex, false, false);
                                var sideFace = Face(x, y, z, StationFaces.FaceOfSide(StationFaces.SideOf((float)nx, (float)ny)), sideIndex, sideRole);
                                PushQuad(Builder(sideRole, sideIndex),
                                    x + p.X, y + p.Y, z + Math.Min(hp, lp),
                                    x + q.X, y + q.Y, z + Math.Min(hq, lq),
                                    x + q.X, y + q.Y, z + hq,
                                    x + p.X, y + p.Y, z + hp,
                                    nx, ny, 0, 0.8f, 0f, 0f, (float)len, (float)Math.Max(hp, hq), sideFace);
                            }
                        }
                    }
                    return;
                }

                // Ordinary uncut cells: the original profile and face-culling path.
                foreach (var built in sections) {
                    var edges = built.Edges;
                    var shapePoints = Outline(built);
                    for (var i = 0; i < edges.Length; i++) {
                        var edge = edges[i];
                        if (!edge.Exposed) continue;
                        var p = shapePoints[i];
                        var q = shapePoints[(i + 1) % shapePoints.Length];
                        var side = StationFaces.SideOf((float)edge.Nx, (float)edge.Ny);
                        var finish = side switch { StationWallSide.N => nI, StationWallSide.E => eI, StationWallSide.S => sI, _ => wI };
                        var face = StationFaces.FaceOfSide(side);
                        var ao = WallAo(x, y, z, edge.Nx, edge.Ny);
                        var sideRole = SurfaceRole(x, y, z, finish, false, false);
                        PushQuad(Builder(sideRole, finish), x + p.X, y + p.Y, z, x + q.X, y + q.Y, z,
                            x + q.X, y + q.Y, z + 1, x + p.X, y + p.Y, z + 1,
                            edge.Nx, edge.Ny, 0, (float)ao, 0f, 0f, (float)Math.Sqrt((q.X - p.X) * (q.X - p.X) + (q.Y - p.Y) * (q.Y - p.Y)), 1f,
                            Face(x, y, z, face, finish, sideRole));
                    }
                    var centroid = Centroid(shapePoints);
                    var topAo = up ? (float)TopAoAt(x, y, z) : 0f;
                    // A pick record describes a **drawn** surface: only mint it when the
                    // first triangle of that face is actually pushed (an occluded cap
                    // must not appear in `Faces`).
                    var topFace = -1;
                    var bottomFace = -1;
                    var topRole = SurfaceRole(x, y, z, topI, false, true);
                    var bottomRole = SurfaceRole(x, y, z, bottomI, false, false);
                    var topBuilder = Builder(topRole, topI);
                    var bottomBuilder = Builder(bottomRole, bottomI);
                    for (var i = 0; i < shapePoints.Length; i++) {
                        var p = shapePoints[i];
                        var q = shapePoints[(i + 1) % shapePoints.Length];
                        if (up) {
                            if (topFace < 0) topFace = Face(x, y, z, StationFace.Top, topI, topRole);
                            PushTri(topBuilder, x + centroid.X, y + centroid.Y, z + 1,
                                x + p.X, y + p.Y, z + 1, x + q.X, y + q.Y, z + 1, new[] { 0d, 0, 1d }, topAo,
                                new[] { (centroid.X, centroid.Y), (p.X, p.Y), (q.X, q.Y) }, topFace);
                        }
                        if (down) {
                            if (bottomFace < 0) bottomFace = Face(x, y, z, StationFace.Bottom, bottomI, bottomRole);
                            PushTri(bottomBuilder, x + centroid.X, y + centroid.Y, z,
                                x + q.X, y + q.Y, z, x + p.X, y + p.Y, z, new[] { 0d, 0, -1d }, 0.6f,
                                new[] { (centroid.X, centroid.Y), (q.X, q.Y), (p.X, p.Y) }, bottomFace);
                        }
                    }
                }
            }

            /* ------------------------------------------------------  wedge */

            void PushWedge(int x, int y, int z, bool e, bool w, bool n, bool s, bool up, bool down,
                StationTriangleKind kind, StationWallSide side, int topI, int bottomI, int eI, int wI, int nI, int sI) {
                var frame = TriFrame(side);
                var upper = kind == StationTriangleKind.Upper;
                (double, double, double) At(double u, double v, double h) =>
                    (x + frame.Ox + frame.Ux * u + frame.Vx * v, y + frame.Oy + frame.Uy * u + frame.Vy * v, z + h);

                int FinishOf(double nx, double ny, double nz) {
                    var ax = Math.Abs(nx);
                    var ay = Math.Abs(ny);
                    var az = Math.Abs(nz);
                    if (az >= ax && az >= ay) return nz >= 0 ? topI : bottomI;
                    return StationFaces.SideOf((float)nx, (float)ny) switch {
                        StationWallSide.N => nI,
                        StationWallSide.E => eI,
                        StationWallSide.S => sI,
                        _ => wI,
                    };
                }

                void Face3((double x, double y, double z)[] points, double[] normal, float ao) {
                    var finish = FinishOf(normal[0], normal[1], normal[2]);
                    var face = StationFaces.OfNormal((float)normal[0], (float)normal[1], (float)normal[2]);
                    // A wedge's full-height face and triangular ends are wall sides; its
                    // flat base is a horizontal surface, and the 45 slope is the piece's own
                    // face (never a storey top).
                    var top = normal[2] > 0.3;
                    var faceRole = SurfaceRole(x, y, z, finish, false, top);
                    PushFace(Builder(faceRole, finish), points, normal, ao, Face(x, y, z, face, finish, faceRole));
                }

                var open = new Dictionary<StationWallSide, bool> {
                    { StationWallSide.N, n }, { StationWallSide.E, e }, { StationWallSide.S, s }, { StationWallSide.W, w },
                };
                // 1. The full-height face on the side the block hugs.
                if (open[side]) {
                    var normal = new[] { -frame.Ux, -frame.Uy, 0d };
                    Face3(new[] { At(0, 0, 0), At(0, 1, 0), At(0, 1, 1), At(0, 0, 1) }, normal,
                        (float)WallAo(x, y, z, normal[0], normal[1]));
                }
                // 2. The flat square: the piece's base in the X-Y plane.
                var baseShown = upper ? down : up;
                var baseHeight = upper ? 0d : 1d;
                if (baseShown) {
                    var normal = new[] { 0d, 0d, upper ? -1d : 1d };
                    var ao = upper ? 0.6f : (float)TopAoAt(x, y, z);
                    Face3(new[] { At(0, 0, baseHeight), At(1, 0, baseHeight), At(1, 1, baseHeight), At(0, 1, baseHeight) }, normal, ao);
                }
                // 3. The two triangular ends, one on each cell face across the ridge.
                var ends = frame.Vx == 1
                    ? new[] { (w, new[] { -1d, 0, 0 }), (e, new[] { 1d, 0, 0 }) }
                    : new[] { (s, new[] { 0d, -1d, 0 }), (n, new[] { 0d, 1d, 0 }) };
                foreach (var (shown, normal) in ends) {
                    if (!shown) continue;
                    var v = normal[0] + normal[1] > 0 ? 1d : 0d;
                    var ao = (float)WallAo(x, y, z, normal[0], normal[1]);
                    Face3(upper
                        ? new[] { At(0, v, 0), At(1, v, 0), At(0, v, 1) }
                        : new[] { At(0, v, 0), At(0, v, 1), At(1, v, 1) }, normal, ao);
                }
                // 4. The 45 slope itself: always drawn, and its own finish slot.
                var slopeAo = upper ? (float)TopAoAt(x, y, z) : (float)WallAo(x, y, z, frame.Ux, frame.Uy);
                var slopeFinish = upper ? topI : bottomI;
                var slopeRole = SurfaceRole(x, y, z, slopeFinish, true, false);
                PushFace(Builder(slopeRole, slopeFinish), upper
                        ? new[] { At(0, 0, 1), At(1, 0, 0), At(1, 1, 0), At(0, 1, 1) }
                        : new[] { At(0, 0, 0), At(1, 0, 1), At(1, 1, 1), At(0, 1, 0) },
                    WedgeSlopeNormal(kind, side), slopeAo,
                    Face(x, y, z, StationCellRules.TriangleSlopeFace(kind), slopeFinish, slopeRole, slope: true));
            }

            /* --------------------------------------------------- profile helpers */

            public void Flush() {
                foreach (var entry in builderOrder) {
                    var builder = builders[entry];
                    if (builder.Triangles == 0) continue;
                    var finishIndex = (int)(entry & 0xffffffffL);
                    var role = (StationSurfaceRole)(int)(entry >> 32);
                    var hasAnchor = anchors.TryGetValue(finishIndex, out var anchor);
                    var group = builder.Build(cx, cy, band, role, session.FinishId(finishIndex), anchor, hasAnchor, session);
                    session.EmitGroup(group);
                }
            }

            Profile BuildProfile(bool e, bool w, bool n, bool s, StationCellInset inset) {
                var mask = (e ? 1 : 0) | (w ? 2 : 0) | (n ? 4 : 0) | (s ? 8 : 0);
                var blockProfiles = session.BlockProfiles;
                if (inset.IsFull && blockProfiles[mask] != null) return blockProfiles[mask];
                // Corner i is the start of side i: NW, SW, SE, NE.
                (double x, double y) Corner(int i) => (
                    i == 2 || i == 3 ? inset.X1 : inset.X0,
                    i == 0 || i == 3 ? inset.Y1 : inset.Y0);
                var open = new[] { w || inset.X0 > 0, s || inset.Y0 > 0, e || inset.X1 < 1, n || inset.Y1 < 1 };
                var edges = new ProfileEdge[4];
                for (var i = 0; i < 4; i++) {
                    var from = Corner(i);
                    var to = Corner((i + 1) % 4);
                    var dx = to.x - from.x;
                    var dy = to.y - from.y;
                    var m = Math.Sqrt(dx * dx + dy * dy);
                    if (m == 0) m = 1;
                    edges[i] = new ProfileEdge(from, to, dy / m, -dx / m, open[i]);
                }
                var profile = new Profile(edges);
                if (inset.IsFull) blockProfiles[mask] = profile;
                return profile;
            }

            Profile BuildTrussProfile(char axis, double half) {
                var lo = 0.5 - half;
                var hi = 0.5 + half;
                (double x, double y)[] corners = axis == 'x'
                    ? new[] { (0d, hi), (0d, lo), (1d, lo), (1d, hi) }
                    : new[] { (lo, 1d), (lo, 0d), (hi, 0d), (hi, 1d) };
                var edges = new ProfileEdge[4];
                for (var i = 0; i < 4; i++) {
                    var from = corners[i];
                    var to = corners[(i + 1) % 4];
                    var dx = to.x - from.x;
                    var dy = to.y - from.y;
                    var m = Math.Sqrt(dx * dx + dy * dy);
                    if (m == 0) m = 1;
                    edges[i] = new ProfileEdge(from, to, dy / m, -dx / m, true);
                }
                return new Profile(edges);
            }

            Profile BuildThinProfile(StationWallSide side, bool e, bool w, bool n, bool s) {
                var turns = SideTurns(side);
                var solid = new Dictionary<StationWallSide, bool> { { StationWallSide.N, n }, { StationWallSide.E, e }, { StationWallSide.S, s }, { StationWallSide.W, w } };
                var canon = BuildProfile(
                    solid[SideTurned(StationWallSide.E, turns)],
                    solid[SideTurned(StationWallSide.W, turns)],
                    true,
                    solid[side], StationCellInset.Full);
                var edges = new ProfileEdge[canon.Edges.Length];
                for (var i = 0; i < edges.Length; i++) {
                    var edge = canon.Edges[i];
                    var from = TurnPoint(edge.From.X, edge.From.Y * HalfWallT, turns);
                    var to = TurnPoint(edge.To.X, edge.To.Y * HalfWallT, turns);
                    var turned = TurnNormal(edge.Nx, edge.Ny * HalfWallT, turns);
                    var m = Math.Sqrt(turned.nx * turned.nx + turned.ny * turned.ny);
                    if (m == 0) m = 1;
                    edges[i] = new ProfileEdge(from, to, turned.nx / m, turned.ny / m, edge.Exposed);
                }
                return new Profile(edges);
            }

            /* ----------------------------------------------------- neighbour tests */

            bool CoversSide(int nx, int ny, int nz, StationFace facing, StationCellInset current, StationCellShape currentShape) {
                var neighbourKey = new StationCellKey(nx, ny, nz);
                var inset = session.InsetAt(neighbourKey);
                if (!inset.IsFull) {
                    if ((facing == StationFace.E && inset.X1 < 1) || (facing == StationFace.W && inset.X0 > 0) ||
                        (facing == StationFace.N && inset.Y1 < 1) || (facing == StationFace.S && inset.Y0 > 0)) return false;
                    if (facing == StationFace.E || facing == StationFace.W) {
                        if (inset.Y0 > current.Y0 || inset.Y1 < current.Y1) return false;
                    } else if (inset.X0 > current.X0 || inset.X1 < current.X1) return false;
                }
                if (session.HasSlope(neighbourKey)) return false;
                var shape = session.ShapeAt(neighbourKey);
                if (shape.IsFull) return true;
                if (shape.Kind == StationShapeKind.Triangle) return shape.Side == StationFaces.Side(facing);
                if (shape.Kind == StationShapeKind.Corner) return false;
                if (shape.Kind == StationShapeKind.Cuts) return false;
                if (shape.Side == StationFaces.Side(facing)) return true;
                // A panel hugs `side`; a facing across the run is along its ridge.
                var ridge = shape.Side == StationWallSide.E || shape.Side == StationWallSide.W
                    ? facing == StationFace.N || facing == StationFace.S
                    : facing == StationFace.E || facing == StationFace.W;
                return ridge && currentShape.Kind == StationShapeKind.Half && currentShape.Side == shape.Side;
            }

            bool SideOpen(int x, int y, int z, int nx, int ny, StationFace facing) {
                if (!IsSolid(nx, ny, z)) return true;
                var currentKey = new StationCellKey(x, y, z);
                var current = session.InsetAt(currentKey);
                return !CoversSide(nx, ny, z, facing, current, session.ShapeAt(currentKey));
            }

            /* ---------------------------------------------------------------- AO */

            double WallAo(int x, int y, int z, double nx, double ny) {
                var occl = 0;
                var ax = nx != 0 ? x + (int)Math.Round(nx) : x;
                var ay = ny != 0 ? y + (int)Math.Round(ny) : y;
                var alongX = nx != 0 ? 0 : 1;
                var alongY = nx != 0 ? 0 : 0;
                for (var dz = -1; dz <= 1; dz++) {
                    for (var t = -1; t <= 1; t++) {
                        if (t == 0 && dz == 0) continue;
                        if (IsSolid(ax + alongX * t, ay + (nx != 0 ? 0 : t), z + dz)) occl++;
                    }
                }
                return Math.Max(0.4, 1 - 0.09 * occl);
            }

            double TopAoAt(int x, int y, int z) {
                var occl = 0;
                for (var dz = 1; dz <= 2; dz++) {
                    for (var dy = -1; dy <= 1; dy++) {
                        for (var dx = -1; dx <= 1; dx++) {
                            if (dx == 0 && dy == 0) continue;
                            if (IsSolid(x + dx, y + dy, z + dz)) occl++;
                        }
                    }
                }
                return Math.Max(0.45, 1 - 0.06 * occl);
            }
        }

        /* --------------------------------------------------------- profile data */

        internal sealed class VecBuilder {
            public readonly List<float> Positions = new List<float>();
            public readonly List<float> Normals = new List<float>();
            public readonly List<float> Colors = new List<float>();
            public readonly List<float> Uvs = new List<float>();
            public readonly List<int> Indices = new List<int>();
            public readonly List<int> TriangleFace = new List<int>();

            public int Triangles => Indices.Count / 3;

            public StationCellMeshGroup Build(int chunkX, int chunkY, int storey, StationSurfaceRole role, string finishId,
                StationCellKey anchor, bool hasAnchor, IMeshCellSource source) {
                var count = Positions.Count / 3;
                var triFaces = TriangleFace.ToArray();
                var localFaces = new List<StationCellFaceRecord>(Math.Min(triFaces.Length, 32));
                var localMap = new Dictionary<int, int>(Math.Min(triFaces.Length, 32));
                var localTriFaces = new int[triFaces.Length];
                for (int t = 0; t < triFaces.Length; t++) {
                    int globalIdx = triFaces[t];
                    if (globalIdx < 0) {
                        localTriFaces[t] = -1;
                        continue;
                    }
                    if (!localMap.TryGetValue(globalIdx, out int localIdx)) {
                        localIdx = localFaces.Count;
                        localFaces.Add(source.GetFaceRecord(globalIdx));
                        localMap[globalIdx] = localIdx;
                    }
                    localTriFaces[t] = localIdx;
                }
                var group = new StationCellMeshGroup {
                    ChunkX = chunkX, ChunkY = chunkY, Storey = storey, Role = role, FinishId = finishId,
                    Anchor = anchor, HasAnchor = hasAnchor,
                    Positions = new Vector3[count],
                    Normals = new Vector3[count],
                    Colors = new Color[count],
                    Uvs = new Vector2[count],
                    Indices = Indices.ToArray(),
                    TriangleFaces = triFaces,
                    LocalFaces = localFaces.ToArray(),
                    LocalTriangleFaces = localTriFaces,
                };
                for (var i = 0; i < count; i++) {
                    group.Positions[i] = new Vector3(Positions[i * 3], Positions[i * 3 + 1], Positions[i * 3 + 2]);
                    group.Normals[i] = new Vector3(Normals[i * 3], Normals[i * 3 + 1], Normals[i * 3 + 2]);
                    group.Colors[i] = new Color(Colors[i * 3], Colors[i * 3 + 1], Colors[i * 3 + 2], 1f);
                    group.Uvs[i] = new Vector2(Uvs[i * 2], Uvs[i * 2 + 1]);
                }
                var bounds = new Bounds();
                if (count > 0) {
                    bounds.SetMinMax(group.Positions[0], group.Positions[0]);
                    for (var i = 1; i < count; i++) bounds.Encapsulate(group.Positions[i]);
                }
                group.Bounds = bounds;
                return group;
            }
        }

        internal readonly struct Pt {
            public readonly double X, Y;
            public Pt(double x, double y) { X = x; Y = y; }
        }

        internal sealed class ProfileEdge {
            public readonly Pt From, To;
            public readonly double Nx, Ny;
            public readonly bool Exposed;
            public ProfileEdge((double x, double y) from, (double x, double y) to, double nx, double ny, bool exposed) {
                From = new Pt(from.x, from.y); To = new Pt(to.x, to.y); Nx = nx; Ny = ny; Exposed = exposed;
            }
        }

        internal sealed class Profile {
            public readonly ProfileEdge[] Edges;
            public Profile(ProfileEdge[] edges) { Edges = edges; }
        }

        const double HalfWallT = 0.5;

        static Pt[] Outline(Profile profile) {
            var points = new Pt[profile.Edges.Length];
            for (var i = 0; i < points.Length; i++) points[i] = new Pt(profile.Edges[i].From.X, profile.Edges[i].From.Y);
            return points;
        }

        static int SideTurns(StationWallSide side) => side switch {
            StationWallSide.S => 0,
            StationWallSide.W => 1,
            StationWallSide.N => 2,
            _ => 3,
        };

        static StationWallSide SideTurned(StationWallSide side, int turns) {
            var result = side;
            for (var i = 0; i < turns; i++) result = StationFaces.Clockwise(result);
            return result;
        }

        static (double x, double y) TurnPoint(double x, double y, int turns) => turns switch {
            1 => (y, 1 - x),
            2 => (1 - x, 1 - y),
            3 => (1 - y, x),
            _ => (x, y),
        };

        static (double nx, double ny) TurnNormal(double nx, double ny, int turns) => turns switch {
            1 => (ny, -nx),
            2 => (-nx, -ny),
            3 => (-ny, nx),
            _ => (nx, ny),
        };

        internal readonly struct TriFrameData {
            public readonly double Ox, Oy, Ux, Uy, Vx, Vy;
            public TriFrameData(double ox, double oy, double ux, double uy, double vx, double vy) {
                Ox = ox; Oy = oy; Ux = ux; Uy = uy; Vx = vx; Vy = vy;
            }
        }

        static TriFrameData TriFrame(StationWallSide side) => side switch {
            StationWallSide.E => new TriFrameData(1, 0, -1, 0, 0, 1),
            StationWallSide.W => new TriFrameData(0, 0, 1, 0, 0, 1),
            StationWallSide.N => new TriFrameData(0, 1, 0, -1, 1, 0),
            _ => new TriFrameData(0, 0, 0, 1, 1, 0),
        };

        static double[] WedgeSlopeNormal(StationTriangleKind kind, StationWallSide side) {
            var frame = TriFrame(side);
            var s = Math.Sqrt(0.5);
            var up = kind == StationTriangleKind.Upper ? 1 : -1;
            return new[] { frame.Ux * s, frame.Uy * s, up * s };
        }

        /* ------------------------------------------------------------- pushing */

        /// <summary>Push one convex face, wound CCW from outside whatever order the corners came in.</summary>
        internal static void PushFace(VecBuilder builder, (double x, double y, double z)[] points, double[] normal, float ao, int face) {
            double turn = 0;
            for (var i = 0; i < points.Length; i++) {
                var p = points[i];
                var q = points[(i + 1) % points.Length];
                turn += (p.y * q.z - p.z * q.y) * normal[0]
                      + (p.z * q.x - p.x * q.z) * normal[1]
                      + (p.x * q.y - p.y * q.x) * normal[2];
            }
            var ring = turn >= 0 ? points : Reverse(points);
            if (ring.Length == 3) {
                var uvs = FaceUv(ring, normal);
                PushTri(builder, ring[0].x, ring[0].y, ring[0].z, ring[1].x, ring[1].y, ring[1].z,
                    ring[2].x, ring[2].y, ring[2].z, normal, ao, uvs, face);
                return;
            }
            var u = Math.Sqrt(Sqr(ring[1].x - ring[0].x, ring[1].y - ring[0].y, ring[1].z - ring[0].z));
            var v = Math.Sqrt(Sqr(ring[2].x - ring[1].x, ring[2].y - ring[1].y, ring[2].z - ring[1].z));
            PushQuad(builder,
                ring[0].x, ring[0].y, ring[0].z, ring[1].x, ring[1].y, ring[1].z,
                ring[2].x, ring[2].y, ring[2].z, ring[3].x, ring[3].y, ring[3].z,
                normal[0], normal[1], normal[2], ao, 0f, 0f, (float)u, (float)v, face);
        }

        static (double, double)[] FaceUv((double x, double y, double z)[] points, double[] normal) {
            var p0 = points[0];
            var ex = new[] { points[1].x - p0.x, points[1].y - p0.y, points[1].z - p0.z };
            var len = Math.Sqrt(ex[0] * ex[0] + ex[1] * ex[1] + ex[2] * ex[2]);
            if (len == 0) len = 1;
            for (var i = 0; i < 3; i++) ex[i] /= len;
            var fx = new[] {
                normal[1] * ex[2] - normal[2] * ex[1],
                normal[2] * ex[0] - normal[0] * ex[2],
                normal[0] * ex[1] - normal[1] * ex[0],
            };
            var uvs = new (double, double)[points.Length];
            for (var i = 0; i < points.Length; i++) {
                var p = points[i];
                uvs[i] = (
                    (p.x - p0.x) * ex[0] + (p.y - p0.y) * ex[1] + (p.z - p0.z) * ex[2],
                    (p.x - p0.x) * fx[0] + (p.y - p0.y) * fx[1] + (p.z - p0.z) * fx[2]);
            }
            return uvs;
        }

        static double Sqr(double x, double y, double z) => x * x + y * y + z * z;

        static (double x, double y, double z)[] Reverse((double x, double y, double z)[] points) {
            var result = new (double, double, double)[points.Length];
            for (var i = 0; i < points.Length; i++) result[i] = points[points.Length - 1 - i];
            return result;
        }

        internal static void PushQuad(VecBuilder builder,
            double p0x, double p0y, double p0z, double p1x, double p1y, double p1z,
            double p2x, double p2y, double p2z, double p3x, double p3y, double p3z,
            double nx, double ny, double nz, float ao, float u0, float v0, float u1, float v1, int face) {
            var baseIndex = builder.Positions.Count / 3;
            builder.Positions.Add((float)p0x); builder.Positions.Add((float)p0y); builder.Positions.Add((float)p0z);
            builder.Positions.Add((float)p1x); builder.Positions.Add((float)p1y); builder.Positions.Add((float)p1z);
            builder.Positions.Add((float)p2x); builder.Positions.Add((float)p2y); builder.Positions.Add((float)p2z);
            builder.Positions.Add((float)p3x); builder.Positions.Add((float)p3y); builder.Positions.Add((float)p3z);
            for (var i = 0; i < 4; i++) {
                builder.Normals.Add((float)nx); builder.Normals.Add((float)ny); builder.Normals.Add((float)nz);
                builder.Colors.Add(ao); builder.Colors.Add(ao); builder.Colors.Add(ao);
            }
            builder.Uvs.Add(u0); builder.Uvs.Add(v0);
            builder.Uvs.Add(u1); builder.Uvs.Add(v0);
            builder.Uvs.Add(u1); builder.Uvs.Add(v1);
            builder.Uvs.Add(u0); builder.Uvs.Add(v1);
            builder.Indices.Add(baseIndex); builder.Indices.Add(baseIndex + 1); builder.Indices.Add(baseIndex + 2);
            builder.Indices.Add(baseIndex); builder.Indices.Add(baseIndex + 2); builder.Indices.Add(baseIndex + 3);
            builder.TriangleFace.Add(face);
            builder.TriangleFace.Add(face);
        }

        internal static void PushTri(VecBuilder builder,
            double p0x, double p0y, double p0z, double p1x, double p1y, double p1z, double p2x, double p2y, double p2z,
            double[] normal, float ao, (double u, double v)[] uvs, int face) {
            var baseIndex = builder.Positions.Count / 3;
            builder.Positions.Add((float)p0x); builder.Positions.Add((float)p0y); builder.Positions.Add((float)p0z);
            builder.Positions.Add((float)p1x); builder.Positions.Add((float)p1y); builder.Positions.Add((float)p1z);
            builder.Positions.Add((float)p2x); builder.Positions.Add((float)p2y); builder.Positions.Add((float)p2z);
            for (var i = 0; i < 3; i++) {
                builder.Normals.Add((float)normal[0]); builder.Normals.Add((float)normal[1]); builder.Normals.Add((float)normal[2]);
                builder.Colors.Add(ao); builder.Colors.Add(ao); builder.Colors.Add(ao);
                builder.Uvs.Add((float)uvs[i].u); builder.Uvs.Add((float)uvs[i].v);
            }
            builder.Indices.Add(baseIndex); builder.Indices.Add(baseIndex + 1); builder.Indices.Add(baseIndex + 2);
            builder.TriangleFace.Add(face);
        }

        /* ---------------------------------------------------------- ramp surface */

        internal sealed class SurfaceRegion {
            public readonly List<Pt> Polygon;
            public readonly Func<double, double, double> Height;
            public SurfaceRegion(List<Pt> polygon, Func<double, double, double> height) {
                Polygon = polygon; Height = height;
            }
        }

        readonly struct Plane {
            public readonly double X, Y, C;
            public Plane(double x, double y, double c) { X = x; Y = y; C = c; }
        }

        const double RampEps = 1e-9;

        static double PlaneValue(Plane plane, Pt point) => plane.X * point.X + plane.Y * point.Y + plane.C;

        static List<Pt> ClipPlane(List<Pt> polygon, Plane plane, int sign) {
            var output = new List<Pt>(polygon.Count + 2);
            for (var i = 0; i < polygon.Count; i++) {
                var a = polygon[i];
                var b = polygon[(i + 1) % polygon.Count];
                var va = sign * PlaneValue(plane, a);
                var vb = sign * PlaneValue(plane, b);
                if (va >= -RampEps) output.Add(a);
                if ((va > RampEps && vb < -RampEps) || (va < -RampEps && vb > RampEps)) {
                    var t = va / (va - vb);
                    output.Add(new Pt(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t));
                }
            }
            return output;
        }

        /// <summary>Port of `rampSurfaceRegions`: split at every footprint, clamp and plane intersection.</summary>
        internal static List<SurfaceRegion> RampSurfaceRegions(Pt[] outline, StationSlopeCut cut,
            List<StationSlopeCut> partitions) {
            var patches = cut.PatchList;
            var planes = new List<Plane> { new Plane(0, 0, 0), new Plane(0, 0, 1) };
            var boundaries = new List<Plane>();
            var allPatches = new List<StationRampPatch>(patches);
            foreach (var partition in partitions) allPatches.AddRange(partition.PatchList);
            foreach (var patch in allPatches) {
                planes.Add(new Plane(patch.Axis == 'x' ? patch.Hi - patch.Lo : 0, patch.Axis == 'y' ? patch.Hi - patch.Lo : 0, patch.Lo));
                if (patch.HasBase) planes.Add(new Plane(0, 0, patch.Base));
                boundaries.Add(new Plane(1, 0, -patch.X0));
                boundaries.Add(new Plane(1, 0, -patch.X1));
                boundaries.Add(new Plane(0, 1, -patch.Y0));
                boundaries.Add(new Plane(0, 1, -patch.Y1));
            }
            for (var i = 0; i < planes.Count; i++) {
                for (var j = 0; j < i; j++) {
                    boundaries.Add(new Plane(planes[i].X - planes[j].X, planes[i].Y - planes[j].Y, planes[i].C - planes[j].C));
                }
            }
            var polygons = new List<List<Pt>> { new List<Pt>(outline) };
            foreach (var plane in boundaries) {
                var next = new List<List<Pt>>();
                foreach (var polygon in polygons) {
                    var values = new List<double>(polygon.Count);
                    var min = double.MaxValue;
                    var max = double.MinValue;
                    foreach (var point in polygon) {
                        var value = PlaneValue(plane, point);
                        values.Add(value);
                        if (value < min) min = value;
                        if (value > max) max = value;
                    }
                    if (min < -RampEps && max > RampEps) {
                        next.Add(ClipPlane(polygon, plane, 1));
                        next.Add(ClipPlane(polygon, plane, -1));
                    } else next.Add(polygon);
                }
                polygons = next;
            }
            var result = new List<SurfaceRegion>(polygons.Count);
            foreach (var polygon in polygons) {
                if (polygon.Count < 3) continue;
                double sumX = 0, sumY = 0;
                foreach (var point in polygon) { sumX += point.X; sumY += point.Y; }
                var cx = sumX / polygon.Count;
                var cy = sumY / polygon.Count;
                var selected = new Plane(0, 0, 1);
                foreach (var patch in patches) {
                    if (cx < patch.X0 - RampEps || cx > patch.X1 + RampEps || cy < patch.Y0 - RampEps || cy > patch.Y1 + RampEps) continue;
                    var candidate = new Plane(patch.Axis == 'x' ? patch.Hi - patch.Lo : 0, patch.Axis == 'y' ? patch.Hi - patch.Lo : 0, patch.Lo);
                    if (patch.HasBase && PlaneValue(candidate, new Pt(cx, cy)) < patch.Base) candidate = new Plane(0, 0, patch.Base);
                    if (PlaneValue(candidate, new Pt(cx, cy)) < PlaneValue(selected, new Pt(cx, cy))) selected = candidate;
                }
                if (PlaneValue(selected, new Pt(cx, cy)) < 0) selected = new Plane(0, 0, 0);
                var plane = selected;
                result.Add(new SurfaceRegion(polygon, (x, y) => Math.Max(0, Math.Min(1, plane.X * x + plane.Y * y + plane.C))));
            }
            return result;
        }

        /// <summary>Height on the other side of an internal footprint edge (`rampSurfaceHeight`).</summary>
        internal static double RampSurfaceHeight(StationSlopeCut cut, double x, double y) {
            var h = 1.0;
            foreach (var patch in cut.PatchList) {
                if (x < patch.X0 || x > patch.X1 || y < patch.Y0 || y > patch.Y1) continue;
                var at = patch.Lo + (patch.Hi - patch.Lo) * (patch.Axis == 'x' ? x : y);
                if (patch.HasBase) at = Math.Max(patch.Base, at);
                h = Math.Min(h, at);
            }
            return Math.Max(0, h);
        }

        /* ------------------------------------------------------------- centroid */

        internal static Pt Centroid(Pt[] points) {
            double area = 0, cx = 0, cy = 0;
            for (var i = 0; i < points.Length; i++) {
                var p = points[i];
                var q = points[(i + 1) % points.Length];
                var cross = p.X * q.Y - q.X * p.Y;
                area += cross;
                cx += (p.X + q.X) * cross;
                cy += (p.Y + q.Y) * cross;
            }
            if (Math.Abs(area) < 1e-12) {
                double sx = 0, sy = 0;
                foreach (var point in points) { sx += point.X; sy += point.Y; }
                return new Pt(sx / points.Length, sy / points.Length);
            }
            return new Pt(cx / (3 * area), cy / (3 * area));
        }
    }
}




