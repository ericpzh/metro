using UnityEngine;

namespace Metro.View {
    /// <summary>
    /// The one conversion between the save's document axes and Unity world axes
    /// (plan-11 coordinates contract).
    ///
    /// A saved point is <c>(x, y, z)</c>: plan <c>x</c>, plan <c>y</c>, then
    /// elevation. Unity world is <c>(x, elevation, y)</c> — the plan is viewed from
    /// above with the same x/y signs the prefab-local axes keep, and elevation is
    /// Unity's up axis. One saved quarter turn is <c>−90°</c> of Unity yaw per
    /// <c>rot</c>, because the save counts counter-clockwise plan turns while a
    /// positive Unity yaw turns clockwise in the same plan view.
    ///
    /// Records and the simulation stay in document axes; family builders never
    /// convert a point themselves. Exact points are converted without adding
    /// <c>0.5</c> or <c>1</c>; <see cref="CellCenter"/> and <see cref="FloorTop"/>
    /// are the explicit helpers for cell and floor surfaces.
    ///
    /// The save's elevation <c>z</c> is the *bottom* of a one-metre cell, so a
    /// cell's interior spans <c>[z, z+1)</c> and its top surface is at <c>z+1</c>.
    /// This matches <c>ModulePlacement.Floor</c> and the TypeScript cell mesher.
    /// </summary>
    public static class StationCoordinates {
        /// <summary>Unity yaw in degrees per saved counter-clockwise quarter turn.</summary>
        public const float YawPerTurn = -90f;
        /// <summary>The supported storey height, metres (the v1 grid's only value).</summary>
        public const int StoreyHeight = 5;
        /// <summary>Lowest and highest editing levels relative to the level base.</summary>
        public const int LevelMinSteps = -8;
        public const int LevelMaxSteps = 6;
        const int LevelCount = 15;

        /// <summary>A save point → Unity world. Exact: no cell or floor offsets.</summary>
        public static Vector3 Point(int x, int y, double z) => new Vector3(x, (float)z, y);

        /// <summary>A document-space vector/point → Unity world. Its own inverse under the swap.</summary>
        public static Vector3 Point(Vector3 documentPoint) => new Vector3(documentPoint.x, documentPoint.z, documentPoint.y);

        /// <summary>Unity world → document space (plan x, plan y, elevation).</summary>
        public static Vector3 WorldToDocument(Vector3 world) => new Vector3(world.x, world.z, world.y);

        /// <summary>
        /// A direction in document axes → world. The same swap as a point: the
        /// mapping is linear, so using the point helper on a direction is correct
        /// and this alias exists to say so at the call site.
        /// </summary>
        public static Vector3 Direction(Vector3 documentDirection) => Point(documentDirection);

        /// <summary>A world-space direction → document axes.</summary>
        public static Vector3 WorldToDocumentDirection(Vector3 worldDirection) => WorldToDocument(worldDirection);

        /// <summary>Prefab yaw for a saved quarter turn: <c>−90° × rot</c> about world up.</summary>
        public static Quaternion ModuleRotation(int rot) => Quaternion.Euler(0f, Yaw(rot), 0f);

        /// <summary>The yaw in degrees for a saved quarter turn (normalized into 0–3).</summary>
        public static float Yaw(int rot) => YawPerTurn * NormTurn(rot);

        /// <summary>A saved quarter turn normalized to 0–3.</summary>
        public static int NormTurn(int turn) => ((turn % 4) + 4) % 4;

        /// <summary>
        /// Centre of the cell at <c>(x, y, z)</c> in world space: half a metre into the
        /// plan cell and half a metre up its elevation cell. The explicit +0.5 helper.
        /// </summary>
        public static Vector3 CellCenter(int x, int y, double z) => new Vector3(x + 0.5f, (float)z + 0.5f, y + 0.5f);

        /// <summary>
        /// Centre of the cell's **top surface** — the walking/standing plane of the
        /// block: <c>(x+0.5, z+1, y+0.5)</c>. The explicit +1 helper.
        /// </summary>
        public static Vector3 FloorTop(int x, int y, double z) => new Vector3(x + 0.5f, (float)z + 1f, y + 0.5f);

        /// <summary>The floor plane of a storey, in world metres (saved <c>z + 1</c>).</summary>
        public static float Floor(int elevation) => elevation + 1f;

        /// <summary>
        /// Intersect a world ray with the street plane (world <c>y = 0</c>, document
        /// <c>z = 0</c>) and report the hit in document space, with elevation 0.
        /// False when the ray is parallel to the plane or points away from it.
        /// </summary>
        public static bool TryRayToDocument(Ray ray, out Vector3 documentHit) {
            const float plane = 0f;
            var direction = ray.direction;
            if (Mathf.Abs(direction.y) < 1e-6f) { documentHit = default; return false; }
            var distance = (plane - ray.origin.y) / direction.y;
            if (distance < 0f) { documentHit = default; return false; }
            var world = ray.origin + direction * distance;
            documentHit = WorldToDocument(world);
            return true;
        }

        /// <summary>
        /// The editing level nearest an elevation, ported from <c>sim/constants.ts</c>:
        /// fifteen five-metre steps starting eight storeys below the level base, ties
        /// resolved towards the lower level exactly as the source loop does.
        /// </summary>
        public static int NearestLevel(double z, int levelBase) {
            var baseOffset = NormalizeLevelBase(levelBase);
            var best = StepLevel(0, baseOffset);
            for (int i = 0; i < LevelCount; i++) {
                var level = StepLevel(i, baseOffset);
                if (System.Math.Abs(level - z) < System.Math.Abs(best - z)) best = level;
            }
            return best;
        }

        /// <summary>Every editing level, ascending, for a level base (port of <c>levelSteps</c>).</summary>
        public static int[] LevelSteps(int levelBase) {
            var baseOffset = NormalizeLevelBase(levelBase);
            var levels = new int[LevelCount];
            for (int i = 0; i < LevelCount; i++) levels[i] = StepLevel(i, baseOffset);
            return levels;
        }

        /// <summary>
        /// The storey band an elevation belongs to, clamped to the editing grid
        /// (port of <c>storeyBand</c>).
        /// </summary>
        public static int StoreyBand(double z, int levelBase) {
            var offset = NormalizeLevelBase(levelBase);
            var low = LevelMinSteps * StoreyHeight + offset;
            var high = LevelMaxSteps * StoreyHeight + offset;
            var band = (int)(System.Math.Floor((z - offset) / StoreyHeight) * StoreyHeight + offset);
            return band < low ? low : band > high ? high : band;
        }

        /// <summary>Port of <c>normalizeLevelBase</c>: clamp to 0–4 and round.</summary>
        public static int NormalizeLevelBase(int levelBase) =>
            levelBase < 0 ? 0 : levelBase > StoreyHeight - 1 ? StoreyHeight - 1 : levelBase;

        static int StepLevel(int index, int baseOffset) =>
            (index + LevelMinSteps) * StoreyHeight + baseOffset;
    }
}
