using System;
using System.Collections.Generic;
using Metro.Build;
using UnityEngine;

namespace Metro.View {
    /// <summary>One per-storey shaft slice of a retained <c>lift</c> module (<c>:exploded:&lt;z&gt;</c>).</summary>
    public readonly struct StationExplodedLiftSlice {
        public StationExplodedLiftSlice(string id, StationModuleRecord module, int ownerLevel, double fromZ, double toZ) {
            Id = id ?? "";
            Module = module;
            OwnerLevel = ownerLevel;
            FromZ = fromZ;
            ToZ = toZ;
        }

        public string Id { get; }
        public StationModuleRecord Module { get; }
        public int OwnerLevel { get; }
        public double FromZ { get; }
        public double ToZ { get; }
    }

    /// <summary>Immutable source-coordinate specification of one storey tray in the standalone exploded view.</summary>
    public sealed class StationExplodedTraySpec {
        public StationExplodedTraySpec(
            int index,
            int level,
            int packedOffset,
            Vector2Int direction,
            StationCellRecord[] cells,
            HashSet<StationCellKey> retainedCellSet,
            StationCellRecord[] frontWalls,
            HashSet<StationCellKey> frontWallCellSet,
            StationModuleRecord[] modules,
            StationExplodedLiftSlice[] liftSlices) {
            Index = index;
            Level = level;
            PackedOffset = packedOffset;
            PackedDocumentOffset = new Vector3(direction.x * packedOffset, direction.y * packedOffset, 0f);
            Cells = cells ?? Array.Empty<StationCellRecord>();
            RetainedCellSet = retainedCellSet ?? new HashSet<StationCellKey>();
            FrontWalls = frontWalls ?? Array.Empty<StationCellRecord>();
            FrontWallCellSet = frontWallCellSet ?? new HashSet<StationCellKey>();
            Modules = modules ?? Array.Empty<StationModuleRecord>();
            LiftSlices = liftSlices ?? Array.Empty<StationExplodedLiftSlice>();
        }

        public int Index { get; }
        public int Level { get; }
        public int PackedOffset { get; }
        public Vector3 PackedDocumentOffset { get; }
        public IReadOnlyList<StationCellRecord> Cells { get; }
        public HashSet<StationCellKey> RetainedCellSet { get; }
        public IReadOnlyList<StationCellRecord> FrontWalls { get; }
        public HashSet<StationCellKey> FrontWallCellSet { get; }
        public IReadOnlyList<StationModuleRecord> Modules { get; }
        public IReadOnlyList<StationExplodedLiftSlice> LiftSlices { get; }
    }

    /// <summary>
    /// Deterministic C# port of <c>game/src/render/explodedView.ts</c> and
    /// <c>game/src/render/explodedPassengers.ts</c>.
    ///
    /// Computes retained storey levels, tray packing direction and shifts, retained structural
    /// cells, hideable front-wall perimeter cells for the default <c>+x/-y</c> isometric eye,
    /// retained indoor/station modules with wall-panel midpoint ownership, per-storey lift slices,
    /// packed passenger support cells, and exploded lift cabin poses — without mutating the
    /// committed <see cref="StationDocument"/>.
    /// </summary>
    public sealed class StationExplodedLayoutPlan {
        public const int DefaultStoreyHeight = 5;
        public const int GroundZ = 0;
        /// <summary>Presentation-only bit above the two native landing-door side bits (<c>EXPLODED_LIFT_ABSENT</c>).</summary>
        public const int ExplodedLiftAbsent = 4;

        static readonly HashSet<string> HiddenModuleTypes = new HashSet<string>(StringComparer.Ordinal) {
            "roof", "road", "sidewalk", "lawn", "tree", "traffic-light",
        };

        static readonly HashSet<string> StructureModuleTypes = new HashSet<string>(StringComparer.Ordinal) {
            "exit", "stair", "escalator", "walkway", "lift", "track", "platform-edge", "shop", "retail", "booth",
        };

        static readonly HashSet<string> FloorUseTypes = new HashSet<string>(StringComparer.Ordinal) {
            "booth", "shop", "retail", "platform-edge", "track",
        };

        static readonly HashSet<string> WallArtworkTypes = new HashSet<string>(StringComparer.Ordinal) {
            "sign", "billboard", "calligraphy", "linemap", "glass", "monitor",
        };

        static readonly int[][] CardinalSteps = {
            new[] { 1, 0 },
            new[] { -1, 0 },
            new[] { 0, 1 },
            new[] { 0, -1 },
        };

        StationExplodedLayoutPlan(
            int levelBase,
            int storeyHeight,
            int[] levels,
            Vector2Int direction,
            int[] packedOffsets,
            StationExplodedTraySpec[] trays,
            StationModuleRecord[] retainedSourceModules,
            Dictionary<string, int> moduleOwnerById,
            StationExplodedLiftSlice[] allLiftSlices,
            HashSet<StationCellKey> passengerSupport) {
            LevelBase = levelBase;
            StoreyHeight = storeyHeight;
            Levels = levels;
            Direction = direction;
            PackedOffsets = packedOffsets;
            Trays = trays;
            RetainedSourceModules = retainedSourceModules;
            ModuleOwnerById = moduleOwnerById;
            AllLiftSlices = allLiftSlices;
            PassengerSupport = passengerSupport;
        }

        public int LevelBase { get; }
        public int StoreyHeight { get; }
        public int[] Levels { get; }
        public Vector2Int Direction { get; }
        public int[] PackedOffsets { get; }
        public IReadOnlyList<StationExplodedTraySpec> Trays { get; }
        public IReadOnlyList<StationModuleRecord> RetainedSourceModules { get; }
        public IReadOnlyDictionary<string, int> ModuleOwnerById { get; }
        public IReadOnlyList<StationExplodedLiftSlice> AllLiftSlices { get; }
        /// <summary>Packed-coordinate support keys <c>(packedX, packedY, floorZ)</c> matching <c>explodedPassengerSupport</c>.</summary>
        public HashSet<StationCellKey> PassengerSupport { get; }

        public int TotalRetainedCells {
            get {
                int sum = 0;
                for (int i = 0; i < Trays.Count; i++) sum += Trays[i].Cells.Count;
                return sum;
            }
        }

        public int TotalFrontWalls {
            get {
                int sum = 0;
                for (int i = 0; i < Trays.Count; i++) sum += Trays[i].FrontWalls.Count;
                return sum;
            }
        }

        public int IndexOfLevel(int level) => Array.IndexOf(Levels, level);

        public int PackedOffsetOf(int level) {
            int idx = Array.IndexOf(Levels, level);
            return idx >= 0 ? PackedOffsets[idx] : 0;
        }

        public static int StoreyBand(double z, int levelBase, int storeyHeight = DefaultStoreyHeight) {
            int h = storeyHeight > 0 ? storeyHeight : DefaultStoreyHeight;
            return (int)Math.Floor((z - levelBase) / h) * h + levelBase;
        }

        public static bool IsExplodedStructure(StationModuleRecord module) =>
            module != null && (StructureModuleTypes.Contains(module.Type) || string.Equals(module.Type, "pillar", StringComparison.Ordinal));

        public static StationExplodedLayoutPlan Build(StationDocument document) {
            if (document == null) {
                return new StationExplodedLayoutPlan(
                    0, DefaultStoreyHeight, Array.Empty<int>(), new Vector2Int(0, 1), Array.Empty<int>(),
                    Array.Empty<StationExplodedTraySpec>(), Array.Empty<StationModuleRecord>(),
                    new Dictionary<string, int>(StringComparer.Ordinal), Array.Empty<StationExplodedLiftSlice>(),
                    new HashSet<StationCellKey>());
            }

            int baseLevel = document.LevelBase;
            const int storeyHeight = DefaultStoreyHeight;
            int Band(double z) => StoreyBand(z, baseLevel, storeyHeight);

            // Preserve document.Cells order and multiplicity identically to data.cells in explodedView.ts.
            var sourceCells = new List<StationCellRecord>(document.Cells.Count);
            for (int i = 0; i < document.Cells.Count; i++) {
                var c = document.Cells[i];
                if (c != null) sourceCells.Add(c);
            }

            var solidKeys = new HashSet<StationCellKey>();
            for (int i = 0; i < sourceCells.Count; i++) {
                var c = sourceCells[i];
                if (c.IsSolid) solidKeys.Add(c.Key);
            }

            // 1. 2x2x3 underground plain concrete infill + >=2-neighbour thin remnants.
            var plainCourses = new Dictionary<StationCellKey, int>();
            var columns = new List<StationCellRecord>();
            for (int i = 0; i < sourceCells.Count; i++) {
                var c = sourceCells[i];
                if (!c.IsSolid || c.Z >= GroundZ || IsCeiling(c) || IsWallBlock(c) || HasShape(c)) continue;
                int z = Band(c.Z);
                var key = new StationCellKey(c.X, c.Y, z);
                if (!plainCourses.TryGetValue(key, out int mask)) columns.Add(c);
                plainCourses[key] = mask | (1 << (c.Z - z));
            }

            var infillColumns = new HashSet<StationCellKey>();
            var infillQueue = new List<StationCellKey>();
            void RetainInfill(int x, int y, int z) {
                var key = new StationCellKey(x, y, z);
                if (infillColumns.Add(key)) infillQueue.Add(key);
            }

            int fullCourseMask = (1 << storeyHeight) - 1;
            for (int i = 0; i < columns.Count; i++) {
                var c = columns[i];
                int z = Band(c.Z);
                int courses = fullCourseMask;
                courses &= plainCourses.TryGetValue(new StationCellKey(c.X, c.Y, z), out int m00) ? m00 : 0;
                courses &= plainCourses.TryGetValue(new StationCellKey(c.X + 1, c.Y, z), out int m10) ? m10 : 0;
                courses &= plainCourses.TryGetValue(new StationCellKey(c.X, c.Y + 1, z), out int m01) ? m01 : 0;
                courses &= plainCourses.TryGetValue(new StationCellKey(c.X + 1, c.Y + 1, z), out int m11) ? m11 : 0;
                if (HasThreeConsecutiveCourses(courses)) {
                    for (int x = c.X; x <= c.X + 1; x++)
                        for (int y = c.Y; y <= c.Y + 1; y++)
                            RetainInfill(x, y, z);
                }
            }

            for (int i = 0; i < infillQueue.Count; i++) {
                var c = infillQueue[i];
                for (int s = 0; s < CardinalSteps.Length; s++) {
                    int x = c.X + CardinalSteps[s][0];
                    int y = c.Y + CardinalSteps[s][1];
                    var key = new StationCellKey(x, y, c.Z);
                    if (infillColumns.Contains(key)) continue;
                    int own = plainCourses.TryGetValue(key, out int ownMask) ? ownMask : 0;
                    if (own == 0) continue;
                    int neighbours = 0;
                    for (int n = 0; n < CardinalSteps.Length; n++) {
                        var neighbour = new StationCellKey(x + CardinalSteps[n][0], y + CardinalSteps[n][1], c.Z);
                        if (!infillColumns.Contains(neighbour)) continue;
                        int nMask = plainCourses.TryGetValue(neighbour, out int nm) ? nm : 0;
                        int courses = own & nMask;
                        if (HasThreeConsecutiveCourses(courses)) neighbours++;
                    }
                    if (neighbours >= 2) RetainInfill(x, y, c.Z);
                }
            }

            bool IsInfill(StationCellRecord c) =>
                c.Z < GroundZ &&
                infillColumns.Contains(new StationCellKey(c.X, c.Y, Band(c.Z))) &&
                !IsCeiling(c) &&
                !HasShape(c);

            // 2. Ground rooms, floor use, tunnel caps & cap-room BFS enclosure.
            var groundRooms = new HashSet<StationCellKey>();
            for (int i = 0; i < sourceCells.Count; i++) {
                var c = sourceCells[i];
                if (c.IsSolid && c.Z == GroundZ && !IsCeiling(c) && IsLabelledFloor(c)) {
                    groundRooms.Add(c.Key);
                }
            }

            var floorUse = new HashSet<double>();
            var tunnelCaps = new HashSet<int>();
            var landings = new HashSet<StationCellKey>();
            for (int i = 0; i < document.Modules.Count; i++) {
                var m = document.Modules[i];
                if (m == null) continue;
                if (FloorUseTypes.Contains(m.Type)) floorUse.Add(m.ExactZ);
                if (string.Equals(m.Type, "track", StringComparison.Ordinal) && m.Config.Bool("tunnel")) {
                    tunnelCaps.Add(RoundInt(m.ExactZ) + storeyHeight);
                }
                if (IsVerticalModule(m.Type)) {
                    AddLandingRegion(landings, m.From);
                    AddLandingRegion(landings, m.To);
                }
            }

            var capRooms = new Dictionary<int, HashSet<StationCellKey>>();
            var enclosedCapFloors = new HashSet<StationCellKey>();
            foreach (int z in tunnelCaps) {
                if (z < GroundZ && !floorUse.Contains(z)) {
                    capRooms[z] = new HashSet<StationCellKey>();
                }
            }

            var clearCapFloors = new HashSet<StationCellKey>();
            var roomSeeds = new List<StationCellKey>();
            for (int i = 0; i < sourceCells.Count; i++) {
                var c = sourceCells[i];
                if (!capRooms.ContainsKey(c.Z) || !c.IsSolid || IsCeiling(c) || IsWallBlock(c)) continue;
                if (solidKeys.Contains(new StationCellKey(c.X, c.Y, c.Z + 1)) ||
                    solidKeys.Contains(new StationCellKey(c.X, c.Y, c.Z + 2)) ||
                    solidKeys.Contains(new StationCellKey(c.X, c.Y, c.Z + 3))) {
                    continue;
                }
                clearCapFloors.Add(c.Key);
                if (solidKeys.Contains(new StationCellKey(c.X, c.Y, c.Z + storeyHeight - 1))) {
                    roomSeeds.Add(c.Key);
                }
            }

            for (int i = 0; i < roomSeeds.Count; i++) {
                var seed = roomSeeds[i];
                if (!clearCapFloors.Remove(seed)) continue;
                enclosedCapFloors.Add(seed);
                for (int s = 0; s < CardinalSteps.Length; s++) {
                    var next = new StationCellKey(seed.X + CardinalSteps[s][0], seed.Y + CardinalSteps[s][1], seed.Z);
                    if (clearCapFloors.Contains(next)) roomSeeds.Add(next);
                }
            }

            for (int i = 0; i < sourceCells.Count; i++) {
                var c = sourceCells[i];
                if (!capRooms.TryGetValue(c.Z, out var room) || !c.IsSolid || IsCeiling(c)) continue;
                if (!(IsLabelledFloor(c) || landings.Contains(c.Key) || enclosedCapFloors.Contains(c.Key))) continue;
                for (int dx = -1; dx <= 1; dx++)
                    for (int dy = -1; dy <= 1; dy++)
                        room.Add(new StationCellKey(c.X + dx, c.Y + dy, c.Z));
            }

            bool WithinCapRoom(int x, int y, double z) {
                int cap = Band(z);
                return !capRooms.TryGetValue(cap, out var room) || room.Contains(new StationCellKey(x, y, cap));
            }

            // 3. Initial solid cell filter.
            var solids = new List<StationCellRecord>(sourceCells.Count);
            for (int i = 0; i < sourceCells.Count; i++) {
                var c = sourceCells[i];
                if (!c.IsSolid || IsCeiling(c)) continue;
                bool keep = IsInfill(c) || (
                    WithinCapRoom(c.X, c.Y, c.Z) &&
                    !(c.Z == GroundZ && !groundRooms.Contains(c.Key) && !solidKeys.Contains(new StationCellKey(c.X, c.Y, c.Z + 1))) &&
                    !(c.Z < GroundZ && tunnelCaps.Contains(c.Z) && !floorUse.Contains(c.Z) &&
                      !solidKeys.Contains(new StationCellKey(c.X, c.Y, c.Z + 1)) && !c.HasTag("auto-floor") &&
                      !IsPublicCapZone(c.Zone) && !landings.Contains(c.Key) && !enclosedCapFloors.Contains(c.Key)) &&
                    !(string.Equals(c.FinishTop, "floor.soil", StringComparison.Ordinal) && !solidKeys.Contains(new StationCellKey(c.X, c.Y, c.Z + 1))) &&
                    !(c.Z == Band(c.Z) + storeyHeight - 1 && !IsWallBlock(c)));
                if (keep) solids.Add(c);
            }

            // 4. Above-ground room plan classification (bridges/piers vs labelled elevated rooms).
            var roomPlans = new Dictionary<int, HashSet<StationCellKey>>();
            bool classifyAboveGround = false;
            for (int i = 0; i < solids.Count; i++) {
                if (solids[i].Z > GroundZ && IsLabelledFloor(solids[i])) {
                    classifyAboveGround = true;
                    break;
                }
            }
            if (classifyAboveGround) {
                for (int i = 0; i < solids.Count; i++) {
                    var c = solids[i];
                    if (c.Z < GroundZ || !IsLabelledFloor(c)) continue;
                    int z = Band(c.Z);
                    if (!roomPlans.TryGetValue(z, out var plan)) roomPlans[z] = plan = new HashSet<StationCellKey>();
                    for (int dx = -1; dx <= 1; dx++)
                        for (int dy = -1; dy <= 1; dy++)
                            plan.Add(new StationCellKey(c.X + dx, c.Y + dy, z));
                }
                var filteredSolids = new List<StationCellRecord>(solids.Count);
                for (int i = 0; i < solids.Count; i++) {
                    var c = solids[i];
                    if (c.Z < GroundZ || (roomPlans.TryGetValue(Band(c.Z), out var plan) && plan.Contains(new StationCellKey(c.X, c.Y, Band(c.Z))))) {
                        filteredSolids.Add(c);
                    }
                }
                solids = filteredSolids;
            }

            bool AtRoom(int x, int y, double z) =>
                !classifyAboveGround || z < GroundZ ||
                (roomPlans.TryGetValue(Band(z), out var plan) && plan.Contains(new StationCellKey(x, y, Band(z))));

            bool ConnectsRoom(StationModuleRecord m) {
                if (IsVerticalModule(m.Type)) {
                    return (m.From.HasValue && AtRoom(RoundInt(m.From.Value.X), RoundInt(m.From.Value.Y), m.From.Value.Z)) ||
                           (m.To.HasValue && AtRoom(RoundInt(m.To.Value.X), RoundInt(m.To.Value.Y), m.To.Value.Z));
                }
                var fp = ModuleFootprint(m);
                for (int i = 0; i < fp.Length; i++) {
                    if (AtRoom(RoundInt(fp[i].X), RoundInt(fp[i].Y), m.ExactZ)) return true;
                }
                return false;
            }

            // 5. Module retention.
            var retainedRamps = new List<StationModuleRecord>();
            for (int i = 0; i < document.Modules.Count; i++) {
                var m = document.Modules[i];
                if (m == null) continue;
                if ((string.Equals(m.Type, "stair", StringComparison.Ordinal) ||
                     string.Equals(m.Type, "escalator", StringComparison.Ordinal) ||
                     string.Equals(m.Type, "walkway", StringComparison.Ordinal)) && ConnectsRoom(m)) {
                    retainedRamps.Add(m);
                }
            }

            var candidateModules = new List<StationModuleRecord>(document.Modules.Count);
            for (int i = 0; i < document.Modules.Count; i++) {
                var m = document.Modules[i];
                if (m == null || HiddenModuleTypes.Contains(m.Type)) continue;

                bool linked = string.Equals(m.Type, "track", StringComparison.Ordinal) ||
                              string.Equals(m.Type, "platform-edge", StringComparison.Ordinal) ||
                              ConnectsRoom(m) ||
                              (string.Equals(m.Type, "exit", StringComparison.Ordinal) && ExitTouchesRetainedRamp(m, retainedRamps));
                if (!linked) continue;

                bool isStructure = StructureModuleTypes.Contains(m.Type);
                StationPoint[] footprint = null;
                if (!isStructure) {
                    footprint = ModuleFootprint(m);
                    bool capOk = false;
                    for (int f = 0; f < footprint.Length; f++) {
                        if (WithinCapRoom(RoundInt(footprint[f].X), RoundInt(footprint[f].Y), m.ExactZ)) {
                            capOk = true;
                            break;
                        }
                    }
                    if (!capOk) continue;

                    if (Math.Abs(m.ExactZ - GroundZ) < 1e-9) {
                        bool groundOk = false;
                        for (int f = 0; f < footprint.Length; f++) {
                            if (groundRooms.Contains(new StationCellKey(RoundInt(footprint[f].X), RoundInt(footprint[f].Y), GroundZ))) {
                                groundOk = true;
                                break;
                            }
                        }
                        if (!groundOk) continue;
                    }
                }

                candidateModules.Add(m);
            }

            // 6. Storey bands, top tunnel-shell cap pruning & structural module band seeding.
            var modulePoints = new Dictionary<int, List<Vector2Int>>();
            var structuralModules = new List<StationModuleRecord>();
            for (int i = 0; i < candidateModules.Count; i++) {
                var m = candidateModules[i];
                if (!IsExplodedStructure(m)) continue;
                structuralModules.Add(m);
                int z = Band(m.ExactZ);
                if (!modulePoints.TryGetValue(z, out var pts)) modulePoints[z] = pts = new List<Vector2Int>();
                var fp = ModuleFootprint(m);
                for (int f = 0; f < fp.Length; f++) {
                    pts.Add(new Vector2Int(RoundInt(fp[f].X), RoundInt(fp[f].Y)));
                }
            }

            var byLevel = new Dictionary<int, List<StationCellRecord>>();
            for (int i = 0; i < solids.Count; i++) {
                var cell = solids[i];
                int z = Band(cell.Z);
                if (!byLevel.TryGetValue(z, out var list)) byLevel[z] = list = new List<StationCellRecord>();
                list.Add(cell);
            }

            if (byLevel.Count > 1) {
                int top = int.MinValue;
                foreach (int key in byLevel.Keys) if (key > top) top = key;
                bool hasTopStructure = false;
                for (int i = 0; i < structuralModules.Count; i++) {
                    if (Band(structuralModules[i].ExactZ) == top) { hasTopStructure = true; break; }
                }
                if (!hasTopStructure && byLevel.TryGetValue(top, out var topCells)) {
                    bool allTunnelShellAtTop = true;
                    for (int i = 0; i < topCells.Count; i++) {
                        if (topCells[i].Z != top || !HasTagPrefix(topCells[i], "tunnel-shell:")) {
                            allTunnelShellAtTop = false;
                            break;
                        }
                    }
                    if (allTunnelShellAtTop) byLevel.Remove(top);
                }
            }

            for (int i = 0; i < structuralModules.Count; i++) {
                int z = Band(structuralModules[i].ExactZ);
                if (!byLevel.ContainsKey(z)) byLevel[z] = new List<StationCellRecord>();
            }

            var levels = new int[byLevel.Count];
            int levelWrite = 0;
            foreach (int z in byLevel.Keys) levels[levelWrite++] = z;
            Array.Sort(levels);

            // 7. Principal floor surface per band + ground roomFloors, then packFloors.
            var floorsByLevel = new Dictionary<int, List<StationCellRecord>>(levels.Length);
            var solidFloorPoints = new List<Vector2Int>();
            for (int l = 0; l < levels.Length; l++) {
                int z = levels[l];
                var own = byLevel[z];
                var surfaceOrder = new List<int>();
                var surfaces = new Dictionary<int, List<StationCellRecord>>();
                for (int i = 0; i < own.Count; i++) {
                    var cell = own[i];
                    if (IsInfill(cell) || IsWallBlock(cell) ||
                        cell.FinishTop.StartsWith("ceil.", StringComparison.Ordinal) ||
                        solidKeys.Contains(new StationCellKey(cell.X, cell.Y, cell.Z + 1))) {
                        continue;
                    }
                    if (!surfaces.TryGetValue(cell.Z, out var row)) {
                        surfaces[cell.Z] = row = new List<StationCellRecord>();
                        surfaceOrder.Add(cell.Z);
                    }
                    row.Add(cell);
                }

                List<StationCellRecord> bestRow = null;
                for (int i = 0; i < surfaceOrder.Count; i++) {
                    var row = surfaces[surfaceOrder[i]];
                    if (bestRow == null || row.Count > bestRow.Count) bestRow = row;
                }

                var finalFloors = new List<StationCellRecord>();
                if (bestRow != null && bestRow.Count > 0) {
                    var seenFloor = new HashSet<StationCellRecord>();
                    for (int i = 0; i < bestRow.Count; i++) {
                        if (seenFloor.Add(bestRow[i])) finalFloors.Add(bestRow[i]);
                    }
                    if (surfaces.TryGetValue(GroundZ, out var groundSurface)) {
                        for (int i = 0; i < groundSurface.Count; i++) {
                            var gc = groundSurface[i];
                            if (groundRooms.Contains(gc.Key) && seenFloor.Add(gc)) finalFloors.Add(gc);
                        }
                    }
                } else {
                    for (int i = 0; i < own.Count; i++) {
                        if (own[i].Z == z) finalFloors.Add(own[i]);
                    }
                }

                floorsByLevel[z] = finalFloors;
                for (int i = 0; i < finalFloors.Count; i++) {
                    solidFloorPoints.Add(new Vector2Int(finalFloors[i].X, finalFloors[i].Y));
                }
            }

            int extentMinX = int.MaxValue, extentMaxX = int.MinValue;
            int extentMinY = int.MaxValue, extentMaxY = int.MinValue;
            void AccumulateExtent(int x, int y) {
                if (x < extentMinX) extentMinX = x;
                if (x > extentMaxX) extentMaxX = x;
                if (y < extentMinY) extentMinY = y;
                if (y > extentMaxY) extentMaxY = y;
            }

            if (solidFloorPoints.Count > 0) {
                for (int i = 0; i < solidFloorPoints.Count; i++) AccumulateExtent(solidFloorPoints[i].x, solidFloorPoints[i].y);
            } else if (solids.Count > 0) {
                for (int i = 0; i < solids.Count; i++) AccumulateExtent(solids[i].X, solids[i].Y);
            } else {
                for (int l = 0; l < levels.Length; l++) {
                    if (!modulePoints.TryGetValue(levels[l], out var pts)) continue;
                    for (int i = 0; i < pts.Count; i++) AccumulateExtent(pts[i].x, pts[i].y);
                }
            }

            var preferred = (long)extentMaxX - extentMinX >= (long)extentMaxY - extentMinY
                ? new Vector2Int(0, 1)
                : new Vector2Int(1, 0);

            var footprints = new IReadOnlyList<Vector2Int>[levels.Length];
            for (int l = 0; l < levels.Length; l++) {
                int z = levels[l];
                var floor = floorsByLevel[z];
                var own = byLevel[z];
                var dedup = new List<Vector2Int>();
                var seen = new HashSet<long>();
                void AddFootprintPoint(int x, int y) {
                    long k = ((long)x << 32) ^ (uint)y;
                    if (seen.Add(k)) dedup.Add(new Vector2Int(x, y));
                }

                if (floor.Count > 0) {
                    for (int i = 0; i < floor.Count; i++) AddFootprintPoint(floor[i].X, floor[i].Y);
                } else if (own.Count > 0) {
                    for (int i = 0; i < own.Count; i++) AddFootprintPoint(own[i].X, own[i].Y);
                } else if (modulePoints.TryGetValue(z, out var pts)) {
                    for (int i = 0; i < pts.Count; i++) AddFootprintPoint(pts[i].x, pts[i].y);
                }

                for (int i = 0; i < own.Count; i++) {
                    if (IsInfill(own[i])) AddFootprintPoint(own[i].X, own[i].Y);
                }
                footprints[l] = dedup;
            }

            var packed = StationExplodedPlan.Compute(levels, footprints, preferred);
            var direction = packed.Direction;
            var packedOffsets = packed.Shifts ?? new int[levels.Length];
            var offsetsByLevel = new Dictionary<int, int>(levels.Length);
            for (int l = 0; l < levels.Length; l++) offsetsByLevel[levels[l]] = packedOffsets[l];

            // 8. Front-wall perimeter classification (+x / -y isometric eye) per tray.
            var frontWallsByLevel = new Dictionary<int, List<StationCellRecord>>(levels.Length);
            var frontWallSetsByLevel = new Dictionary<int, HashSet<StationCellKey>>(levels.Length);
            var retainedSetsByLevel = new Dictionary<int, HashSet<StationCellKey>>(levels.Length);

            for (int l = 0; l < levels.Length; l++) {
                int z = levels[l];
                var own = byLevel[z];
                var floorCells = floorsByLevel[z];
                var floorXY = new HashSet<long>(floorCells.Count);
                var floorKeys = new HashSet<StationCellKey>(floorCells.Count);
                var frontX = new Dictionary<int, int>();
                var frontY = new Dictionary<int, int>();
                int openMaxX = int.MinValue;
                int openMinY = int.MaxValue;

                for (int i = 0; i < floorCells.Count; i++) {
                    var cell = floorCells[i];
                    floorXY.Add(PackXY(cell.X, cell.Y));
                    floorKeys.Add(cell.Key);
                    if (IsWallBlock(cell) || solidKeys.Contains(new StationCellKey(cell.X, cell.Y, cell.Z + 1))) continue;
                    if (!frontX.TryGetValue(cell.Y, out int curMaxX) || cell.X > curMaxX) frontX[cell.Y] = cell.X;
                    if (!frontY.TryGetValue(cell.X, out int curMinY) || cell.Y < curMinY) frontY[cell.X] = cell.Y;
                    if (cell.X > openMaxX) openMaxX = cell.X;
                    if (cell.Y < openMinY) openMinY = cell.Y;
                }

                var retainedSet = new HashSet<StationCellKey>(own.Count);
                var fwList = new List<StationCellRecord>();
                var fwSet = new HashSet<StationCellKey>();
                bool isCapBand = capRooms.ContainsKey(z);

                for (int i = 0; i < own.Count; i++) {
                    var cell = own[i];
                    retainedSet.Add(cell.Key);
                    bool wallCourse = cell.Z > z || (isCapBand && solidKeys.Contains(new StationCellKey(cell.X, cell.Y, cell.Z + 1)));
                    bool frontWall = wallCourse && !IsInfill(cell) && !floorKeys.Contains(cell.Key) && (
                        (frontX.TryGetValue(cell.Y, out int maxXForY) && cell.X > maxXForY) ||
                        (frontY.TryGetValue(cell.X, out int minYForX) && cell.Y < minYForX) ||
                        (frontX.Count > 0 && !frontX.ContainsKey(cell.Y) && !frontY.ContainsKey(cell.X) &&
                         (cell.X > openMaxX || cell.Y < openMinY)) ||
                        (floorXY.Contains(PackXY(cell.X, cell.Y)) &&
                         (!floorXY.Contains(PackXY(cell.X + 1, cell.Y)) || !floorXY.Contains(PackXY(cell.X, cell.Y - 1)))));
                    if (frontWall) {
                        fwList.Add(cell);
                        fwSet.Add(cell.Key);
                    }
                }

                retainedSetsByLevel[z] = retainedSet;
                frontWallsByLevel[z] = fwList;
                frontWallSetsByLevel[z] = fwSet;
            }

            // 9. Module storey ownership, per-storey lift slices, and retained source modules.
            var modulesByLevel = new Dictionary<int, List<StationModuleRecord>>(levels.Length);
            var liftSlicesByLevel = new Dictionary<int, List<StationExplodedLiftSlice>>(levels.Length);
            for (int l = 0; l < levels.Length; l++) {
                modulesByLevel[levels[l]] = new List<StationModuleRecord>();
                liftSlicesByLevel[levels[l]] = new List<StationExplodedLiftSlice>();
            }

            var allLiftSlices = new List<StationExplodedLiftSlice>();
            var moduleOwnerById = new Dictionary<string, int>(candidateModules.Count, StringComparer.Ordinal);
            var retainedSourceModules = new List<StationModuleRecord>(candidateModules.Count);

            for (int i = 0; i < candidateModules.Count; i++) {
                var m = candidateModules[i];
                if (string.Equals(m.Type, "lift", StringComparison.Ordinal)) {
                    if (!m.From.HasValue || !m.To.HasValue) continue;
                    double lo = Math.Min(m.From.Value.Z, m.To.Value.Z);
                    double hi = Math.Max(m.From.Value.Z, m.To.Value.Z);
                    bool anySlice = false;
                    for (int l = 0; l < levels.Length; l++) {
                        int z = levels[l];
                        if (z < hi && z + storeyHeight > lo) {
                            double fromZ = Math.Max(z, lo);
                            double toZ = Math.Min(z + storeyHeight, hi);
                            var slice = new StationExplodedLiftSlice($"{m.Id}:exploded:{z}", m, z, fromZ, toZ);
                            liftSlicesByLevel[z].Add(slice);
                            allLiftSlices.Add(slice);
                            anySlice = true;
                        }
                    }
                    if (anySlice) retainedSourceModules.Add(m);
                    continue;
                }

                int owner = ComputeModuleOwnerLevel(m, baseLevel, storeyHeight);
                moduleOwnerById[m.Id] = owner;
                retainedSourceModules.Add(m);
                if (modulesByLevel.TryGetValue(owner, out var bucket)) {
                    bucket.Add(m);
                }
            }

            // 10. Passenger support in packed space (exact port of explodedPassengerSupport).
            var passengerSupport = BuildPassengerSupport(
                levels,
                byLevel,
                retainedSourceModules,
                allLiftSlices,
                moduleOwnerById,
                offsetsByLevel,
                direction,
                baseLevel,
                storeyHeight);

            var trays = new StationExplodedTraySpec[levels.Length];
            for (int l = 0; l < levels.Length; l++) {
                int z = levels[l];
                trays[l] = new StationExplodedTraySpec(
                    l,
                    z,
                    packedOffsets[l],
                    direction,
                    byLevel[z].ToArray(),
                    retainedSetsByLevel[z],
                    frontWallsByLevel[z].ToArray(),
                    frontWallSetsByLevel[z],
                    modulesByLevel[z].ToArray(),
                    liftSlicesByLevel[z].ToArray());
            }

            return new StationExplodedLayoutPlan(
                baseLevel,
                storeyHeight,
                levels,
                direction,
                packedOffsets,
                trays,
                retainedSourceModules.ToArray(),
                moduleOwnerById,
                allLiftSlices.ToArray(),
                passengerSupport);
        }

        /// <summary>
        /// Port of <c>explodedLiftPoses</c> (<c>game/src/render/explodedView.ts</c>): emits 7-float
        /// rows <c>[x, y, from, to, cabin, doorOpen, openSides]</c> per retained lift slice, clamping
        /// cabin presence to <c>[from + 1, to + 1)</c> (inclusive of <c>to + 1</c> at <c>to == hi</c>)
        /// and OR-ing <see cref="ExplodedLiftAbsent"/> when the cabin is outside the slice.
        /// </summary>
        public static float[] ComputeExplodedLiftPoses(
            float[] source,
            IReadOnlyList<int> levels,
            IReadOnlyList<int> packedOffsets,
            Vector2Int direction,
            IReadOnlyList<Vector3> manualOffsets = null,
            IReadOnlyList<bool> floorVisible = null,
            int storeyHeight = DefaultStoreyHeight) {
            if (source == null || source.Length < 7 || levels == null || levels.Count == 0) {
                return Array.Empty<float>();
            }
            var rows = new List<float>((source.Length / 7) * levels.Count * 7);
            for (int i = 0; i + 7 <= source.Length; i += 7) {
                float lo = source[i + 2];
                float hi = source[i + 3];
                float cabin = source[i + 4];
                for (int l = 0; l < levels.Count; l++) {
                    if (floorVisible != null && l < floorVisible.Count && !floorVisible[l]) continue;
                    int z = levels[l];
                    int offset = packedOffsets != null && l < packedOffsets.Count ? packedOffsets[l] : 0;
                    float from = Mathf.Max(lo, z);
                    float to = Mathf.Min(hi, z + storeyHeight);
                    if (from >= to) continue;
                    bool present = cabin >= from + 1f && (cabin < to + 1f || (Mathf.Approximately(to, hi) && cabin <= to + 1f));
                    Vector3 manual = manualOffsets != null && l < manualOffsets.Count ? manualOffsets[l] : Vector3.zero;
                    float x = source[i] + direction.x * offset + manual.x;
                    float y = source[i + 1] + direction.y * offset + manual.y;
                    float doorOpen = present ? source[i + 5] : 0f;
                    int flags = (int)Math.Round(source[i + 6]) | (present ? 0 : ExplodedLiftAbsent);
                    rows.Add(x);
                    rows.Add(y);
                    rows.Add(from + manual.z);
                    rows.Add(to + manual.z);
                    rows.Add(cabin + manual.z);
                    rows.Add(doorOpen);
                    rows.Add(flags);
                }
            }
            return rows.ToArray();
        }

        static int ComputeModuleOwnerLevel(StationModuleRecord m, int baseLevel, int storeyHeight) {
            if (WallArtworkTypes.Contains(m.Type) && StationFootprints.IsWallMounted(m) &&
                TryWallArtworkMidpointZ(m, out double midZ)) {
                return StoreyBand(midZ, baseLevel, storeyHeight);
            }
            return StoreyBand(m.ExactZ, baseLevel, storeyHeight);
        }

        static bool TryWallArtworkMidpointZ(StationModuleRecord m, out double midZ) {
            double z0 = m.ExactZ + 1.0;
            midZ = m.ExactZ;
            switch (m.Type) {
                case "sign": {
                    // Port of sim/sign.ts + sim/boothSigns.ts: wall sign panelZ = 1.65, booth sign panelZ = 2.2 (2.4 - 0.4/2).
                    bool onBooth = m.Config.Text("boothId").Length > 0;
                    double panelZ = onBooth ? 2.2 : 1.65;
                    midZ = z0 + panelZ;
                    return true;
                }
                case "billboard": {
                    var spec = StationFootprints.BillboardSpec(m);
                    midZ = z0 + spec.PanelZ;
                    return true;
                }
                case "calligraphy": {
                    bool vertical = string.Equals(m.Config.Text("axis"), "v", StringComparison.Ordinal);
                    double bottom = vertical ? 0.4 : 1.2;
                    double panelH = m.PanelHeight > 0 ? m.PanelHeight : (vertical ? 2.6 : 1.0);
                    midZ = z0 + bottom + panelH * 0.5;
                    return true;
                }
                case "linemap": {
                    // Port of sim/linemaps.ts + sim/placement.ts: bottom = 1.06, panelH = 1.8 -> midpoint = z0 + 1.96.
                    midZ = z0 + 1.96;
                    return true;
                }
                case "glass": {
                    var spec = StationFootprints.GlassSpec(m);
                    midZ = z0 + spec.H * 0.5;
                    return true;
                }
                case "monitor": {
                    // Port of sim/placement.ts: wall monitor spans [z0 + 0.5, z0 + 2.5].
                    midZ = z0 + 1.5;
                    return true;
                }
                default:
                    return false;
            }
        }

        static HashSet<StationCellKey> BuildPassengerSupport(
            int[] levels,
            Dictionary<int, List<StationCellRecord>> byLevel,
            List<StationModuleRecord> retainedSourceModules,
            List<StationExplodedLiftSlice> liftSlices,
            Dictionary<string, int> moduleOwnerById,
            Dictionary<int, int> offsetsByLevel,
            Vector2Int direction,
            int baseLevel,
            int storeyHeight) {
            int dx = direction.x;
            int dy = direction.y;
            var packedSolids = new HashSet<StationCellKey>();
            for (int l = 0; l < levels.Length; l++) {
                int z = levels[l];
                int off = offsetsByLevel.TryGetValue(z, out int o) ? o : 0;
                var own = byLevel[z];
                for (int i = 0; i < own.Count; i++) {
                    var c = own[i];
                    packedSolids.Add(new StationCellKey(c.X + dx * off, c.Y + dy * off, c.Z));
                }
            }

            var support = new HashSet<StationCellKey>(packedSolids.Count);
            foreach (var key in packedSolids) {
                if (!packedSolids.Contains(new StationCellKey(key.X, key.Y, key.Z + 1))) {
                    support.Add(key);
                }
            }

            for (int i = 0; i < liftSlices.Count; i++) {
                var slice = liftSlices[i];
                int off = offsetsByLevel.TryGetValue(slice.OwnerLevel, out int o) ? o : 0;
                var fp = ModuleFootprint(slice.Module);
                int zLo = RoundInt(Math.Min(slice.FromZ, slice.ToZ));
                int zHi = RoundInt(Math.Max(slice.FromZ, slice.ToZ));
                for (int f = 0; f < fp.Length; f++) {
                    int px = RoundInt(fp[f].X) + dx * off;
                    int py = RoundInt(fp[f].Y) + dy * off;
                    for (int z = zLo; z <= zHi; z++) {
                        support.Add(new StationCellKey(px, py, z));
                    }
                }
            }

            for (int i = 0; i < retainedSourceModules.Count; i++) {
                var m = retainedSourceModules[i];
                if (string.Equals(m.Type, "lift", StringComparison.Ordinal)) continue;
                int owner = moduleOwnerById.TryGetValue(m.Id, out int ow) ? ow : StoreyBand(m.ExactZ, baseLevel, storeyHeight);
                int modOff = offsetsByLevel.TryGetValue(owner, out int mo) ? mo : 0;

                if (string.Equals(m.Type, "track", StringComparison.Ordinal)) {
                    var fp = ModuleFootprint(m);
                    for (int f = 0; f < fp.Length; f++) {
                        support.Add(new StationCellKey(RoundInt(fp[f].X) + dx * modOff, RoundInt(fp[f].Y) + dy * modOff, RoundInt(m.ExactZ)));
                    }
                    continue;
                }

                if (!string.Equals(m.Type, "stair", StringComparison.Ordinal) &&
                    !string.Equals(m.Type, "escalator", StringComparison.Ordinal) &&
                    !string.Equals(m.Type, "walkway", StringComparison.Ordinal)) {
                    continue;
                }

                List<StationStairFlight> flights;
                if (string.Equals(m.Type, "stair", StringComparison.Ordinal)) {
                    flights = StationRunGeometry.StairFlights(m.Facts);
                } else {
                    flights = new List<StationStairFlight>(1);
                    if (m.From.HasValue && m.To.HasValue) {
                        flights.Add(new StationStairFlight(
                            new StationRunPoint(m.From.Value.X, m.From.Value.Y, m.From.Value.Z),
                            new StationRunPoint(m.To.Value.X, m.To.Value.Y, m.To.Value.Z)));
                    }
                }

                int width = string.Equals(m.Type, "stair", StringComparison.Ordinal)
                    ? (int)Math.Ceiling(m.Config.Number("width", 1.0) / 2.0)
                    : 1;
                int baseBandOffset = offsetsByLevel.TryGetValue(StoreyBand(m.ExactZ, baseLevel, storeyHeight), out int bbo) ? bbo : 0;

                for (int f = 0; f < flights.Count; f++) {
                    var a = flights[f].From;
                    var b = flights[f].To;
                    double ax = a.X + dx * modOff;
                    double ay = a.Y + dy * modOff;
                    double bx = b.X + dx * modOff;
                    double by = b.Y + dy * modOff;
                    double hypot = Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
                    int steps = Math.Max(1, (int)Math.Ceiling(hypot * 2.0));
                    for (int s = 0; s <= steps; s++) {
                        double t = (double)s / steps;
                        double z = a.Z + (b.Z - a.Z) * t;
                        int stepBandOffset = offsetsByLevel.TryGetValue(StoreyBand(z + 1.0, baseLevel, storeyHeight), out int sbo) ? sbo : 0;
                        int shift = stepBandOffset - baseBandOffset;
                        int x = (int)Math.Floor(ax + 0.5 + (bx - ax) * t + dx * shift);
                        int y = (int)Math.Floor(ay + 0.5 + (by - ay) * t + dy * shift);
                        int fz = (int)Math.Floor(z + 1e-3);
                        for (int wx = -width; wx <= width; wx++) {
                            for (int wy = -width; wy <= width; wy++) {
                                support.Add(new StationCellKey(x + wx, y + wy, fz));
                            }
                        }
                    }
                }
            }

            return support;
        }

        static bool ExitTouchesRetainedRamp(StationModuleRecord exit, List<StationModuleRecord> retainedRamps) {
            for (int i = 0; i < retainedRamps.Count; i++) {
                var r = retainedRamps[i];
                if (r.From.HasValue && EndpointNearExit(r.From.Value, exit)) return true;
                if (r.To.HasValue && EndpointNearExit(r.To.Value, exit)) return true;
            }
            return false;
        }

        static bool EndpointNearExit(StationPoint p, StationModuleRecord exit) =>
            Math.Abs(p.Z - exit.ExactZ) < 1e-9 &&
            Math.Abs(p.X - exit.X) <= 3.0 &&
            Math.Abs(p.Y - exit.Y) <= 3.0;

        static StationPoint[] ModuleFootprint(StationModuleRecord m) =>
            StationFootprints.TryFootprint(m, out var pts, out _) ? pts : new[] { m.Point };

        static void AddLandingRegion(HashSet<StationCellKey> landings, StationPoint? end) {
            if (!end.HasValue) return;
            int ex = RoundInt(end.Value.X);
            int ey = RoundInt(end.Value.Y);
            int ez = RoundInt(end.Value.Z);
            for (int dx = -2; dx <= 2; dx++)
                for (int dy = -2; dy <= 2; dy++)
                    landings.Add(new StationCellKey(ex + dx, ey + dy, ez));
        }

        static bool IsVerticalModule(string type) =>
            string.Equals(type, "stair", StringComparison.Ordinal) ||
            string.Equals(type, "escalator", StringComparison.Ordinal) ||
            string.Equals(type, "walkway", StringComparison.Ordinal) ||
            string.Equals(type, "lift", StringComparison.Ordinal);

        static bool HasThreeConsecutiveCourses(int mask) =>
            (mask & (mask >> 1) & (mask >> 2)) != 0;

        static bool IsCeiling(StationCellRecord c) =>
            c.HasTag("suspended-ceiling") || c.HasTag("opening-ceiling");

        static bool IsLabelledFloor(StationCellRecord c) =>
            c.Room.Length > 0 ||
            IsUsableZone(c.Zone) ||
            c.HasTag("auto-floor");

        static bool IsUsableZone(string zone) =>
            string.Equals(zone, "paid", StringComparison.Ordinal) ||
            string.Equals(zone, "unpaid", StringComparison.Ordinal) ||
            string.Equals(zone, "platform", StringComparison.Ordinal) ||
            string.Equals(zone, "restricted", StringComparison.Ordinal);

        static bool IsPublicCapZone(string zone) =>
            string.Equals(zone, "paid", StringComparison.Ordinal) ||
            string.Equals(zone, "unpaid", StringComparison.Ordinal) ||
            string.Equals(zone, "platform", StringComparison.Ordinal);

        static bool IsWallBlock(StationCellRecord c) {
            var tags = c.Tags;
            for (int i = 0; i < tags.Count; i++) {
                string t = tags[i];
                if (string.Equals(t, "wall", StringComparison.Ordinal) ||
                    string.Equals(t, "auto-wall", StringComparison.Ordinal) ||
                    t.StartsWith("tunnel-shell:", StringComparison.Ordinal) ||
                    t.StartsWith("half-wall:", StringComparison.Ordinal) ||
                    t.StartsWith("tri-upper:", StringComparison.Ordinal) ||
                    t.StartsWith("tri-lower:", StringComparison.Ordinal)) {
                    return true;
                }
            }
            return false;
        }

        static bool HasShape(StationCellRecord c) {
            var tags = c.Tags;
            int mask = 0;
            for (int i = 0; i < tags.Count; i++) {
                string t = tags[i];
                if (t.StartsWith("half-wall:", StringComparison.Ordinal) && t.Length == 11) {
                    mask |= HalfMask(t[10]);
                } else if (t.StartsWith("half-corner:", StringComparison.Ordinal) && t.Length == 13) {
                    mask |= CornerMask(t[12]);
                }
            }
            if (mask != 0) return mask != 0b1111;
            for (int i = 0; i < tags.Count; i++) {
                string t = tags[i];
                if (t.StartsWith("tri-upper:", StringComparison.Ordinal) && t.Length == 11 && IsCardinalSide(t[10])) return true;
                if (t.StartsWith("tri-lower:", StringComparison.Ordinal) && t.Length == 11 && IsCardinalSide(t[10])) return true;
            }
            return false;
        }

        static int HalfMask(char side) {
            switch (side) {
                case 'n': return 0b0011;
                case 'e': return 0b0110;
                case 's': return 0b1100;
                case 'w': return 0b1001;
                default: return 0;
            }
        }

        static int CornerMask(char side) {
            switch (side) {
                case 'n': return 0b0001;
                case 'e': return 0b0010;
                case 's': return 0b0100;
                case 'w': return 0b1000;
                default: return 0;
            }
        }

        static bool IsCardinalSide(char side) => side == 'n' || side == 'e' || side == 's' || side == 'w';

        static bool HasTagPrefix(StationCellRecord c, string prefix) {
            var tags = c.Tags;
            for (int i = 0; i < tags.Count; i++) {
                if (tags[i].StartsWith(prefix, StringComparison.Ordinal)) return true;
            }
            return false;
        }

        static long PackXY(int x, int y) => ((long)x << 32) ^ (uint)y;

        static int RoundInt(double value) => (int)Math.Round(value);
    }
}
