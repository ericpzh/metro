using Metro.Build;
using UnityEngine;

namespace Metro.View {
    /// <summary>
    /// Document axes → Unity world placement for one saved module. This file now
    /// delegates the coordinate contract itself to <see cref="StationCoordinates"/>
    /// (packet A, plan 11); it keeps the view-side conveniences built on top of it:
    /// the catalogue pivot offset, the storey floor plane and the cutaway rule.
    ///
    /// A saved module's <c>(x, y, z)</c> is plan position followed by elevation; the
    /// Unity world is <c>(x, elevation, y)</c>. Prefab pivots are the source
    /// builder's group origin: the promoted wrapper keeps it, and the catalogue
    /// records that origin's offset from the cell corner
    /// (<see cref="RuntimeCatalogue.Entry.offset"/>). Rotation is applied about that
    /// pivot, exactly as <c>placeLocal</c> rotates about the group origin.
    /// </summary>
    public static class ModulePlacement {
        /// <summary>Degrees of Unity yaw per saved counter-clockwise quarter turn.</summary>
        public const float YawPerTurn = StationCoordinates.YawPerTurn;

        public static Quaternion Rotation(int rotation) => StationCoordinates.ModuleRotation(rotation);

        public static float Yaw(int rotation) => StationCoordinates.Yaw(rotation);

        /// <summary>
        /// World pivot of a module for a catalogue entry offset. The offset is in
        /// document axes (plan x, plan y, elevation), exactly what the catalogue
        /// records, so it is added in document axes before the one conversion.
        /// </summary>
        public static Vector3 Position(ModuleFacts module, Vector3 offset) =>
            StationCoordinates.Point(new Vector3(module.X + offset.x, module.Y + offset.y, module.Z + offset.z));

        public static Vector3 Position(ModuleFacts module, RuntimeCatalogue.Entry entry) =>
            Position(module, entry?.offset ?? new Vector3(.5f, .5f, 1));

        /// <summary>
        /// The in-cell shift that puts a run's **centre** on its anchor cell. The source
        /// pivots a run at <c>mod.x + .5 + rotateLocal(rot, (w-1)/2, 0)</c>, so a two-cell
        /// bench or billboard must not be dropped half a cell to one side. Document axes,
        /// like every offset here; callers add it before the one world conversion.
        /// </summary>
        public static Vector3 RunCentre(ModuleFacts module) {
            float halfWidth = Mathf.Max(0, module.Width - 1) * 0.5f;
            float halfDepth = Mathf.Max(0, module.Depth - 1) * 0.5f;
            if (halfWidth <= 0f && halfDepth <= 0f) return Vector3.zero;
            switch (((module.Rotation % 4) + 4) % 4) {
                case 1: return new Vector3(-halfDepth, halfWidth, 0f);
                case 2: return new Vector3(-halfWidth, -halfDepth, 0f);
                case 3: return new Vector3(halfDepth, -halfWidth, 0f);
                default: return new Vector3(halfWidth, halfDepth, 0f);
            }
        }

        /// <summary>Floor surface plane of a storey, in Unity metres.</summary>
        public static float Floor(int elevation) => StationCoordinates.Floor(elevation);

        /// <summary>The cutaway rule shared with the existing authored geometry: a storey shows two levels above.</summary>
        public static bool VisibleAt(ModuleFacts module, int level) => module.Z <= level + 2;

        public static Vector3Int Cell(ModuleFacts module) => new Vector3Int(module.X, module.Y, module.Z);
    }
}
