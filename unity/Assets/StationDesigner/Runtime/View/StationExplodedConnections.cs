using System;
using System.Collections.Generic;
using Metro.Build;
using UnityEngine;

namespace Metro.View {
    /// <summary>
    /// One dashed connector anchor between two adjacent retained storeys, in document coordinates,
    /// matching <c>game/src/render/explodedConnections.ts</c>.
    /// </summary>
    public readonly struct StationExplodedConnection {
        public StationExplodedConnection(
            string moduleId,
            string kind,
            int lowerIndex,
            int upperIndex,
            int lowerLevel,
            int upperLevel,
            Vector3 originalPoint) {
            ModuleId = moduleId ?? "";
            Kind = kind ?? "";
            LowerIndex = lowerIndex;
            UpperIndex = upperIndex;
            LowerLevel = lowerLevel;
            UpperLevel = upperLevel;
            OriginalPoint = originalPoint;
        }

        public string ModuleId { get; }
        /// <summary>The saved module this connection starts from (the tray builder's own name).</summary>
        public string SourceModuleId => ModuleId;
        public string Kind { get; }
        public int LowerIndex { get; }
        public int UpperIndex { get; }
        public int LowerLevel { get; }
        public int UpperLevel { get; }
        /// <summary>Cut-plane intersection anchor in document coordinates <c>(x, y, z)</c>.</summary>
        public Vector3 OriginalPoint { get; }
    }

    /// <summary>
    /// Deterministic C# port of <c>ExplodedConnections</c> (<c>game/src/render/explodedConnections.ts</c>).
    /// Computes cut-surface connector tuples for retained <c>stair</c>, <c>escalator</c>, and <c>lift</c>
    /// modules across adjacent retained storeys, and evaluates live Unity world endpoints when trays are
    /// packed or manually dragged.
    /// </summary>
    public static class StationExplodedConnections {
        public const int DefaultStoreyHeight = StationExplodedLayoutPlan.DefaultStoreyHeight;

        public static StationExplodedConnection[] Build(
            IReadOnlyList<StationModuleRecord> retainedModules,
            IReadOnlyList<int> levels,
            int storeyHeight = DefaultStoreyHeight) {
            if (retainedModules == null || retainedModules.Count == 0 || levels == null || levels.Count < 2) {
                return Array.Empty<StationExplodedConnection>();
            }
            int step = storeyHeight > 0 ? storeyHeight : DefaultStoreyHeight;
            var levelIndex = new Dictionary<int, int>(levels.Count);
            for (int i = 0; i < levels.Count; i++) levelIndex[levels[i]] = i;

            var connections = new List<StationExplodedConnection>();
            for (int m = 0; m < retainedModules.Count; m++) {
                var module = retainedModules[m];
                if (module == null || !module.From.HasValue || !module.To.HasValue) continue;
                bool isStair = string.Equals(module.Type, "stair", StringComparison.Ordinal);
                bool isEscalator = string.Equals(module.Type, "escalator", StringComparison.Ordinal);
                bool isLift = string.Equals(module.Type, "lift", StringComparison.Ordinal);
                if (!isStair && !isEscalator && !isLift) continue;

                double lo = Math.Min(module.From.Value.Z, module.To.Value.Z);
                double hi = Math.Max(module.From.Value.Z, module.To.Value.Z);

                for (int upper = 0; upper < levels.Count; upper++) {
                    int z = levels[upper];
                    if (!levelIndex.TryGetValue(z - step, out int lower)) continue;
                    if (z <= lo || z > hi) continue;

                    if (isLift) {
                        float center = StationRunGeometry.LiftSize(module.Facts) * 0.5f;
                        var pt = new Vector3(module.X + center, module.Y + center, z);
                        connections.Add(new StationExplodedConnection(module.Id, module.Type, lower, upper, levels[lower], z, pt));
                        continue;
                    }

                    if (isStair) {
                        var flights = StationRunGeometry.StairFlights(module.Facts);
                        var slides = StationRunGeometry.StairFlightSlides(module.Facts, flights);
                        for (int i = 0; i < flights.Count; i++) {
                            var flight = flights[i];
                            double minZ = Math.Min(flight.From.Z, flight.To.Z);
                            double maxZ = Math.Max(flight.From.Z, flight.To.Z);
                            if (z < minZ + 1.0 || z > maxZ + 1.0 || Math.Abs(flight.From.Z - flight.To.Z) < 1e-9) continue;
                            double t = (z - 1.0 - flight.From.Z) / (flight.To.Z - flight.From.Z);
                            var slide = i < slides.Count ? slides[i] : default;
                            var pt = new Vector3(
                                (float)(flight.From.X + (flight.To.X - flight.From.X) * t + 0.5 + slide.X),
                                (float)(flight.From.Y + (flight.To.Y - flight.From.Y) * t + 0.5 + slide.Y),
                                z);
                            connections.Add(new StationExplodedConnection(module.Id, module.Type, lower, upper, levels[lower], z, pt));
                            break;
                        }
                    } else {
                        StationRunGeometry.EscalatorInclineRun(module.Facts, out var incFrom, out var incTo, out _);
                        double minZ = Math.Min(incFrom.Z, incTo.Z);
                        double maxZ = Math.Max(incFrom.Z, incTo.Z);
                        if (z < minZ + 1.0 || z > maxZ + 1.0 || Math.Abs(incFrom.Z - incTo.Z) < 1e-9) continue;
                        double t = (z - 1.0 - incFrom.Z) / (incTo.Z - incFrom.Z);
                        var pt = new Vector3(
                            (float)(incFrom.X + (incTo.X - incFrom.X) * t + 0.5),
                            (float)(incFrom.Y + (incTo.Y - incFrom.Y) * t + 0.5),
                            z);
                        connections.Add(new StationExplodedConnection(module.Id, module.Type, lower, upper, levels[lower], z, pt));
                    }
                }
            }

            return connections.ToArray();
        }

        /// <summary>
        /// Evaluates the lower and upper endpoints of <paramref name="connection"/> in **document**
        /// coordinates after applying each tray's packed offset and optional manual drag offset.
        /// </summary>
        public static void EvaluateDocumentEndpoints(
            in StationExplodedConnection connection,
            IReadOnlyList<int> packedOffsets,
            Vector2Int direction,
            IReadOnlyList<Vector3> manualOffsets,
            out Vector3 lowerDoc,
            out Vector3 upperDoc,
            out float distance) {
            int lowerPacked = packedOffsets != null && connection.LowerIndex < packedOffsets.Count ? packedOffsets[connection.LowerIndex] : 0;
            int upperPacked = packedOffsets != null && connection.UpperIndex < packedOffsets.Count ? packedOffsets[connection.UpperIndex] : 0;
            Vector3 lowerManual = manualOffsets != null && connection.LowerIndex < manualOffsets.Count ? manualOffsets[connection.LowerIndex] : Vector3.zero;
            Vector3 upperManual = manualOffsets != null && connection.UpperIndex < manualOffsets.Count ? manualOffsets[connection.UpperIndex] : Vector3.zero;

            lowerDoc = new Vector3(
                connection.OriginalPoint.x + lowerPacked * direction.x + lowerManual.x,
                connection.OriginalPoint.y + lowerPacked * direction.y + lowerManual.y,
                connection.OriginalPoint.z + lowerManual.z);
            upperDoc = new Vector3(
                connection.OriginalPoint.x + upperPacked * direction.x + upperManual.x,
                connection.OriginalPoint.y + upperPacked * direction.y + upperManual.y,
                connection.OriginalPoint.z + upperManual.z);
            distance = Vector3.Distance(lowerDoc, upperDoc);
        }

        /// <summary>
        /// Evaluates the lower and upper endpoints in Unity world coordinates (<see cref="StationCoordinates.Point(Vector3)"/>).
        /// </summary>
        public static void EvaluateWorldEndpoints(
            in StationExplodedConnection connection,
            IReadOnlyList<int> packedOffsets,
            Vector2Int direction,
            IReadOnlyList<Vector3> manualOffsets,
            out Vector3 lowerWorld,
            out Vector3 upperWorld,
            out float distance) {
            EvaluateDocumentEndpoints(in connection, packedOffsets, direction, manualOffsets, out var lowerDoc, out var upperDoc, out distance);
            lowerWorld = StationCoordinates.Point(lowerDoc);
            upperWorld = StationCoordinates.Point(upperDoc);
        }
    }
}
