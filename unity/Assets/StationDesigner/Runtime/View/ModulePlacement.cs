using System;
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

        public static Quaternion Rotation(ModuleFacts module) =>
            Rotation(module.Type == "light"
                ? (module.Config.Text("variant") == "rectangular" ? StationFootprints.NormRot(module.Rotation) % 2 : 0)
                : module.Rotation);

        public static float Yaw(int rotation) => StationCoordinates.Yaw(rotation);

        /// <summary>
        /// World pivot from a rotation-zero source offset. Rotate the local displacement
        /// around the canonical cell centre, then convert document axes exactly once.
        /// </summary>
        public static Vector3 Position(ModuleFacts module, Vector3 offset) {
            var local = Rotation(module) * new Vector3(offset.x - .5f, 0, offset.y - .5f);
            if (module.Type == "light") {
                var light = StationFootprints.LightPlan(module.Rotation, module.Config);
                local += new Vector3((float)light.OffsetX, 0, (float)light.OffsetY);
            }
            return new Vector3(module.X + .5f + local.x, (float)module.ExactZ + offset.z, module.Y + .5f + local.z);
        }

        /// <summary>Canonical pivot plus rotated run, outdoor surface lift, and document-dependent curtain clearance.</summary>
        public static Vector3 Resolve(StationModuleRecord module, RuntimeCatalogue.Entry entry, StationIndex index) {
            if (module == null) return Vector3.zero;
            var position = Position(module.Facts, entry) + StationCoordinates.Point(RunCentre(module.Facts));
            if (index == null) return position;
            position.y += StationOutdoorSurfaceLift.ForIndex(index).LiftOf(module);
            if (!StationModulePlacement.IsEdgeDecor(module.Type)) return position;
            var glass = index.ModulesOfType("glass");
            for (int i = 0; i < glass.Count; i++) {
                var other = glass[i];
                if (other == null || other.Id == module.Id || !StationModulePlacement.EdgeDecorGlassShare(module, other)) continue;
                StationFootprints.WallSide(module.Rotation, out var x, out var y);
                return position + new Vector3(x * .15f, 0, y * .15f);
            }
            return position;
        }

        public static Vector3 Position(ModuleFacts module, RuntimeCatalogue.Entry entry) =>
            Position(module, entry?.offset ?? new Vector3(.5f, .5f, 1));

        /// <summary>
        /// The in-cell shift that puts a run's **centre** on its anchor cell. The source
        /// pivots a run at <c>mod.x + .5 + rotateLocal(rot, (w-1)/2, 0)</c>, so a two-cell
        /// bench or billboard must not be dropped half a cell to one side. Document axes,
        /// like every offset here; callers add it before the one world conversion.
        /// </summary>
        public static Vector3 RunCentre(ModuleFacts module) {
            // These models already place their geometry relative to the first cell.
            if (module == null || module.Type == "court" || module.Type == "shelf" || module.Type == "extinguisher" ||
                module.Type == "checkout" || module.Type == "busstop") return Vector3.zero;
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
