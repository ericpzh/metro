using System;
using System.Collections.Generic;
using System.Globalization;
using Metro.Build;
using Metro.View;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// The two above-ground **structures** the authored station carries — 屋顶 (`roof`) and
    /// 柱 (`pillar`) — generated from the saved record instead of instanced from one promoted
    /// reference piece (plan 22 §1).
    ///
    /// Both families need the saved dimensions, which no single prefab can stand in for:
    ///
    /// * The promoted tapered truss is a 4 × 4 m bay, while Tanwei's `roof-124` is
    ///   4 × 12 m — its sheet pitch, purlin spacing and web ribs all follow the saved
    ///   `w`/`d`. A 1 × 1 m flat plate at `plateSnap: lower` (`ceil.steel`) is likewise
    ///   a different piece from the promoted default-height tile.
    /// * A 柱 rises the saved `cfg.height`, and a **bridge pillar** stops at the deck
    ///   underside (`track.z − BRIDGE_DECK_DEPTH`), not at its own nominal height; its
    ///   round shaft and steel collars are the source's `PillarModel` assembly, not the
    ///   legacy square pillar of the Zoo renderer.
    ///
    /// Everything is built in the module's own local frame (`x` along the run, `z` up,
    /// `y` across) under a root placed at the source's `placeLocal` origin, so the
    /// saved quarter turn is applied exactly once.
    /// </summary>
    public static class StationStructureGeometry {
        /* ------------------------------------------------------- roof constants */

        /// <summary>`ROOF_THICKNESS`.</summary>
        public const float RoofThickness = .25f;
        /// <summary>`TRUSS_ROOF_BASE` — the roof's own origin above its supporting storey.</summary>
        public const float TrussRoofBase = 5f;
        /// <summary>`TRUSS_ROOF_HEIGHT`.</summary>
        public const float TrussRoofHeight = 5f;
        /// <summary>`TRUSS_ROOF_EAVE`.</summary>
        public const float TrussRoofEave = 9f;
        /// <summary>`TRUSS_ROOF_SKIN` — the finished sheet's thickness.</summary>
        public const float TrussRoofSkin = .12f;
        /// <summary>`TRUSS_ROOF_CHORD`.</summary>
        public const float TrussRoofChord = .4f;
        /// <summary>`CANOPY_ROOF_DROP` — a canopy shares the truss shell one storey lower.</summary>
        public const float CanopyRoofDrop = 5f;
        /// <summary>`CANOPY_POST_RADIUS`.</summary>
        public const float CanopyPostRadius = .09f;
        /// <summary>`DEFAULT_ROOF_FINISH` (the source's `DEFAULT_MATERIAL`).</summary>
        public const string DefaultRoofFinish = StationFinishIds.DefaultMaterial;

        /// <summary>`trussRoofRidge`.</summary>
        public static float TrussRoofRidge(float width) => TrussRoofBase + TrussRoofHeight - TrussRoofSkin;

        /// <summary>`trussRoofTop`.</summary>
        public static float TrussRoofTop(float width) => TrussRoofRidge(width) + TrussRoofSkin;

        /// <summary>`canopyPostRows(width)`.</summary>
        public static float[] CanopyPostRows(float width) {
            float inset = width / 4f - 1f;
            return new[] { inset, width - 1f - inset };
        }

        /// <summary>
        /// The flat plate's local elevation for a saved `cfg.plateSnap`
        /// (`lower` hangs one metre below the module origin, `upper` a quarter above it,
        /// and the default sits on the five-metre ceiling).
        /// </summary>
        public static float FlatRoofZ(string plateSnap) {
            if (string.Equals(plateSnap, "lower", StringComparison.Ordinal)) return -.875f;
            if (string.Equals(plateSnap, "upper", StringComparison.Ordinal)) return -.125f;
            return TrussRoofBase + RoofThickness * .5f;
        }

        /* ----------------------------------------------------- pillar constants */

        /// <summary>`BRIDGE_DECK_DEPTH`.</summary>
        public const float BridgeDeckDepth = 1f;
        /// <summary>`pillarWidth`: a 粗柱 is one metre across, a 细柱 0.3 m.</summary>
        public static float PillarWidth(ModuleFacts module) => module.Config.Text("size") == "thick" ? 1f : .3f;

        /// <summary>`pillarOffset`: a 细柱's `rot` selects one of the nine in-cell spots.</summary>
        public static Vector2 PillarOffset(ModuleFacts module) {
            if (module.Config.Text("size") == "thick") return Vector2.zero;
            float width = PillarWidth(module);
            var spots = new[] {
                new Vector2(0f, 0f), new Vector2(-1f, 1f), new Vector2(0f, 1f), new Vector2(1f, 1f),
                new Vector2(-1f, 0f), new Vector2(1f, 0f), new Vector2(-1f, -1f), new Vector2(0f, -1f), new Vector2(1f, -1f),
            };
            var spot = spots[((module.Rotation % 9) + 9) % 9];
            return new Vector2(spot.x * (1f - width) * .5f, spot.y * (1f - width) * .5f);
        }

        /// <summary>
        /// `PillarModel.build`'s `h` for a pillar with **no** bridge run over it: the saved
        /// `cfg.height`, less `BRIDGE_DECK_DEPTH + 1` when a `cfg.bridgeId` remains, because a
        /// pier authored for a deck that is no longer there still stops where the deck was.
        /// </summary>
        public static float PillarHeight(ModuleFacts module) {
            float height = (float)module.Config.Number("height", 5);
            if (height <= 0f) height = 5f;
            if (module.Config.Has("bridgeId")) height -= BridgeDeckDepth + 1f;
            return Math.Max(.1f, height);
        }

        /// <summary>
        /// `pillarSupportsBridge`: a saved track at this pillar's cell whose elevation is the
        /// pillar's own top, and which is a bridge.
        /// </summary>
        public static ModuleFacts BridgeFor(ModuleFacts pillar, IReadOnlyList<ModuleFacts> station) {
            if (pillar == null || station == null) return null;
            float top = pillar.Z + (float)pillar.Config.Number("height", 0);
            for (int i = 0; i < station.Count; i++) {
                var track = station[i];
                if (track == null || !string.Equals(track.Type, "track", StringComparison.Ordinal)) continue;
                if (!track.Config.Bool("bridge")) continue;
                if (Math.Abs(track.Z - top) > 1e-3) continue;
                if (!ContainsCell(track, pillar.X, pillar.Y)) continue;
                return track;
            }
            return null;
        }

        /// <summary>Indexed overload of <see cref="BridgeFor(ModuleFacts, IReadOnlyList{ModuleFacts})"/> scanning only track modules.</summary>
        public static ModuleFacts BridgeFor(ModuleFacts pillar, StationIndex index) {
            if (pillar == null || index == null) return null;
            float top = pillar.Z + (float)pillar.Config.Number("height", 0);
            var tracks = index.ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var track = tracks[i]?.Facts;
                if (track == null || !track.Config.Bool("bridge")) continue;
                if (Math.Abs(track.Z - top) > 1e-3) continue;
                if (!ContainsCell(track, pillar.X, pillar.Y)) continue;
                return track;
            }
            return null;
        }

        static bool ContainsCell(ModuleFacts run, int x, int y) {
            int width = Math.Max(1, run.Width), depth = Math.Max(1, run.Depth);
            int rotation = ((run.Rotation % 4) + 4) % 4;
            for (int i = 0; i < width; i++) {
                for (int j = 0; j < depth; j++) {
                    int dx, dy;
                    switch (rotation) {
                        case 1: dx = -j; dy = i; break;
                        case 2: dx = -i; dy = -j; break;
                        case 3: dx = j; dy = -i; break;
                        default: dx = i; dy = j; break;
                    }
                    if (run.X + dx == x && run.Y + dy == y) return true;
                }
            }
            return false;
        }

        /* ----------------------------------------------------- hanger constants */

        /// <summary>`HANGER_BAR_TOP` in `sim/hangers.ts`.</summary>
        public const float HangerBarTop = 4f;
        /// <summary>`HANGER_POST_BAR_TOP` in `sim/hangers.ts`.</summary>
        public const float HangerPostBarTop = 3f;
        /// <summary>`HANGER_BAR_DEPTH` in `sim/hangers.ts`.</summary>
        public const float HangerBarDepth = .2f;
        /// <summary>`HANGER_POST_WIDTH` in `sim/hangers.ts`.</summary>
        public const float HangerPostWidth = .18f;
        /// <summary>`HANGER_POST_OFFSET` in `sim/hangers.ts`.</summary>
        public const float HangerPostOffset = .17f;

        /// <summary>Port of <c>hangers.ts:hangerCells</c>: rotated plan cells along the crossbar.</summary>
        public static (int X, int Y)[] HangerCells(ModuleFacts module) => StationCeilingMounts.HangerCells(module);

        /// <summary>
        /// Port of <c>hangers.ts:hangerRoofZ</c>: nearest eligible solid cell or roof backing at or
        /// above the hanger crossbar, evaluated independently at a suspension endpoint <c>(x, y)</c>.
        /// </summary>
        public static double? HangerRoofZ(IReadOnlyList<StationCellRecord> cells, IReadOnlyList<ModuleFacts> station,
            ModuleFacts hanger, int x, int y) {
            if (hanger == null) return null;
            double barTop = hanger.Z + 1d + HangerBarTop;
            double? backing = null;
            if (cells != null) {
                for (int i = 0; i < cells.Count; i++) {
                    var cell = cells[i];
                    if (cell == null || !cell.IsSolid || cell.X != x || cell.Y != y) continue;
                    if (cell.Z >= barTop && (!backing.HasValue || cell.Z < backing.Value)) {
                        backing = cell.Z;
                    }
                }
            }
            if (station != null) {
                for (int i = 0; i < station.Count; i++) {
                    var roof = station[i];
                    if (!TryRoofBackingAt(roof, x, y, out double z)) continue;
                    if (z >= barTop && (!backing.HasValue || z < backing.Value)) {
                        backing = z;
                    }
                }
            }
            return backing;
        }

        internal static bool TryRoofBackingAt(ModuleFacts roof, int x, int y, out double z) {
            z = 0;
            if (roof == null || !string.Equals(roof.Type, "roof", StringComparison.Ordinal)) return false;
            if (!ContainsCell(roof, x, y)) return false;
            StationCeilingMounts.RotateLocal(-roof.Rotation, x - roof.X, y - roof.Y, out _, out double localY);
            double depth = Math.Max(1, roof.Depth);
            const double ridge = 5d + 5d - 0.12d; // TRUSS_ROOF_BASE + TRUSS_ROOF_HEIGHT - TRUSS_ROOF_SKIN
            const double eave = 9d;               // TRUSS_ROOF_EAVE
            const double baseHeight = 5d;         // TRUSS_ROOF_BASE
            const double canopyDrop = 5d;         // CANOPY_ROOF_DROP
            double height = ridge - (ridge - eave) * Math.Abs(localY - (depth - 1d) * 0.5d) / (depth * 0.5d);
            string variant = roof.Config.Text("variant");
            z = variant.Length == 0
                ? roof.Z + 1d + baseHeight
                : roof.Z + 1d + height - (string.Equals(variant, "canopy", StringComparison.Ordinal) ? canopyDrop : 0d);
            return true;
        }
    }

    /// <summary>
    /// Accumulates one generated assembly as boxes, beams and cylinders, collected per
    /// material so each becomes a single mesh. Every primitive carries **metre UVs**, so a
    /// finish material tiles at its authored scale instead of stretching one texel across a
    /// face — the roof and pillar families both wear real station finishes.
    /// </summary>
    public sealed class StructureParts {
        sealed class Bin {
            public Material Material;
            public readonly List<Vector3> Vertices = new List<Vector3>();
            public readonly List<int> Triangles = new List<int>();
            public readonly List<Vector2> Uvs = new List<Vector2>();
            public readonly List<(int Offset, int Vertex, int Segments, int Top, int Bottom)> Cylinders =
                new List<(int, int, int, int, int)>();
        }

        readonly List<Bin> bins = new List<Bin>();

        public int Triangles {
            get {
                int total = 0;
                for (int i = 0; i < bins.Count; i++) total += bins[i].Triangles.Count / 3;
                return total;
            }
        }

        Bin For(Material material) {
            for (int i = 0; i < bins.Count; i++) if (ReferenceEquals(bins[i].Material, material)) return bins[i];
            var bin = new Bin { Material = material };
            bins.Add(bin);
            return bin;
        }

        /// <summary>One axis-aligned box: centre and **source-axis** size (along, across, up).</summary>
        public void Box(Material material, Vector3 centre, Vector3 size) {
            var bin = For(material);
            // Source (along, across, up) → Unity local (along, up, across).
            BoxFaces.AppendUv(bin.Vertices, bin.Triangles, bin.Uvs,
                new Vector3(centre.x, centre.z, centre.y),
                new Vector3(size.x, 0f, 0f), new Vector3(0f, size.z, 0f), new Vector3(0f, 0f, size.y));
        }

        /// <summary>A box built from three explicit local edge vectors (a tilted sheet, a rib).</summary>
        public void Edged(Material material, Vector3 centre, Vector3 edgeX, Vector3 edgeY, Vector3 edgeZ) {
            var bin = For(material);
            BoxFaces.AppendUv(bin.Vertices, bin.Triangles, bin.Uvs, centre, edgeX, edgeY, edgeZ);
        }

        /// <summary>
        /// One structural member between two **source-axis** points, `width` metres square
        /// (`RoofModel.ts:member`): its long axis follows the member, so a diagonal rib is a
        /// real diagonal beam rather than an axis-aligned box.
        /// </summary>
        public void Member(Material material, Vector3 from, Vector3 to, float width) {
            var a = new Vector3(from.x, from.z, from.y);
            var b = new Vector3(to.x, to.z, to.y);
            var delta = b - a;
            if (delta.sqrMagnitude < 1e-8f) return;
            var up = delta;
            var reference = Mathf.Abs(Vector3.Dot(up.normalized, Vector3.right)) > .9f ? Vector3.up : Vector3.right;
            var side = Vector3.Cross(up, reference).normalized * width;
            var other = Vector3.Cross(up, side).normalized * width;
            Edged(material, (a + b) * .5f, side, up, other);
        }

        /// <summary>
        /// A round column standing on <paramref name="bottom"/> along local up
        /// (`CANOPY_POST_RADIUS` posts and the 粗柱's shaft). Sides and both caps are wound
        /// outward from the ring, so the shaft shades as a cylinder rather than a prism.
        /// </summary>
        public void Cylinder(Material material, Vector3 bottom, float radius, float height, int segments) {
            if (radius <= 0f || height <= 0f) return;
            segments = Mathf.Max(3, segments);
            var bin = For(material);
            int start = bin.Vertices.Count;
            float circumference = 2f * Mathf.PI * radius;
            for (int ring = 0; ring < 2; ring++) {
                float y = ring == 0 ? 0f : height;
                for (int i = 0; i < segments; i++) {
                    float a = i * Mathf.PI * 2f / segments;
                    bin.Vertices.Add(bottom + new Vector3(Mathf.Cos(a) * radius, y, Mathf.Sin(a) * radius));
                    bin.Uvs.Add(new Vector2(i / (float)segments * circumference, y));
                }
            }
            int topCentre = bin.Vertices.Count;
            bin.Vertices.Add(bottom + new Vector3(0f, height, 0f));
            bin.Uvs.Add(new Vector2(0f, height));
            int bottomCentre = bin.Vertices.Count;
            bin.Vertices.Add(bottom);
            bin.Uvs.Add(Vector2.zero);
            if (segments >= 12 && segments % 4 == 0)
                bin.Cylinders.Add((bin.Triangles.Count, start, segments, topCentre, bottomCentre));
            for (int i = 0; i < segments; i++) {
                int next = (i + 1) % segments;
                int lo = start + i, loNext = start + next;
                int hi = start + segments + i, hiNext = start + segments + next;
                var radial = new Vector3(bin.Vertices[lo].x - bottom.x, 0f, bin.Vertices[lo].z - bottom.z);
                Quad(bin, lo, loNext, hiNext, hi, radial);
                Triangle(bin, topCentre, hi, hiNext, Vector3.up);
                Triangle(bin, bottomCentre, loNext, lo, Vector3.down);
            }
        }

        void Quad(Bin bin, int a, int b, int c, int d, Vector3 outward) {
            var p0 = bin.Vertices[a];
            var p1 = bin.Vertices[b];
            var p2 = bin.Vertices[c];
            var p3 = bin.Vertices[d];
            if (Vector3.Dot(Vector3.Cross(p1 - p0, p2 - p0), outward) < 0f) {
                bin.Triangles.Add(a); bin.Triangles.Add(c); bin.Triangles.Add(b);
                bin.Triangles.Add(a); bin.Triangles.Add(d); bin.Triangles.Add(c);
            } else {
                bin.Triangles.Add(a); bin.Triangles.Add(b); bin.Triangles.Add(c);
                bin.Triangles.Add(a); bin.Triangles.Add(c); bin.Triangles.Add(d);
            }
        }

        void Triangle(Bin bin, int a, int b, int c, Vector3 outward) {
            var p0 = bin.Vertices[a];
            var p1 = bin.Vertices[b];
            var p2 = bin.Vertices[c];
            if (Vector3.Dot(Vector3.Cross(p1 - p0, p2 - p0), outward) < 0f) {
                bin.Triangles.Add(a); bin.Triangles.Add(c); bin.Triangles.Add(b);
            } else {
                bin.Triangles.Add(a); bin.Triangles.Add(b); bin.Triangles.Add(c);
            }
        }

        /// <summary>Emit one mesh per material under <paramref name="parent"/>.</summary>
        public void Emit(Transform parent, List<Mesh> owned, string name) {
            for (int b = 0; b < bins.Count; b++) {
                var bin = bins[b];
                if (bin.Triangles.Count == 0 || bin.Material == null) continue;
                var mesh = new Mesh { name = name + " " + b, indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
                mesh.SetVertices(bin.Vertices);
                mesh.SetTriangles(bin.Triangles, 0);
                mesh.SetUVs(0, bin.Uvs);
                mesh.RecalculateNormals();
                mesh.RecalculateBounds();
                if (bin.Cylinders.Count > 0)
                    StationMeshLodIndices.Apply(mesh, bin.Triangles, CylinderTier(bin, 2), CylinderTier(bin, 4));
                var part = new GameObject(name + " " + b, typeof(MeshFilter), typeof(MeshRenderer));
                part.transform.SetParent(parent, false);
                part.GetComponent<MeshFilter>().sharedMesh = mesh;
                var renderer = part.GetComponent<MeshRenderer>();
                renderer.sharedMaterial = bin.Material;
                owned?.Add(mesh);
            }
        }

        static List<int> CylinderTier(Bin bin, int stride) {
            var result = new List<int>();
            int source = 0;
            foreach (var shape in bin.Cylinders) {
                for (; source < shape.Offset; source++) result.Add(bin.Triangles[source]);
                for (int i = 0; i < shape.Segments; i += stride) {
                    int next = (i + stride) % shape.Segments;
                    int lo = shape.Vertex + i, loNext = shape.Vertex + next;
                    int hi = lo + shape.Segments, hiNext = loNext + shape.Segments;
                    result.Add(lo); result.Add(hiNext); result.Add(loNext);
                    result.Add(lo); result.Add(hi); result.Add(hiNext);
                    result.Add(shape.Top); result.Add(hiNext); result.Add(hi);
                    result.Add(shape.Bottom); result.Add(lo); result.Add(loNext);
                }
                source = shape.Offset + shape.Segments * 12;
            }
            for (; source < bin.Triangles.Count; source++) result.Add(bin.Triangles[source]);
            return result;
        }
    }

    /// <summary>
    /// The station-world renderer for the two structure families. It owns `roof` and
    /// `pillar`, builds each from the committed document's saved dimensions, finish and
    /// turn, and registers one record per module by stable id — so the roof's parts land
    /// on the `Roof` visibility role (Hide Roof and the section plane reach them) and a
    /// pillar's parts carry its storey bands.
    /// </summary>
    public sealed class StationStructureModuleRenderer : StationModuleGroupRenderer, IStationLocalViewRenderer {
        protected override string Group => StationModuleClaims.Structure;
        public override string Role => StationModuleClaims.Structure;

        /// <summary>One line per built roof: the variant, its bay size and the parts drawn.</summary>
        public List<string> RoofNotes { get; } = new List<string>();
        /// <summary>One line per built pillar: its size, height, datum and the parts drawn.</summary>
        public List<string> PillarNotes { get; } = new List<string>();
        /// <summary>One line per built hanger: its mount, span, bar top and endpoint backing.</summary>
        public List<string> HangerNotes { get; } = new List<string>();

        sealed class StructureWorldCache {
            public StationWorldView World;
            public readonly Dictionary<long, HashSet<string>> RoofHangersByColumn = new Dictionary<long, HashSet<string>>();
            public readonly Dictionary<long, HashSet<string>> PillarsByColumn = new Dictionary<long, HashSet<string>>();
            public readonly Dictionary<string, List<Mesh>> MeshesByModuleId = new Dictionary<string, List<Mesh>>(StringComparer.Ordinal);
        }

        sealed class StagedStructureDelta : IStationLocalRendererStage {
            readonly WorldState state;
            readonly StructureWorldCache cache;
            readonly HashSet<string> retiredIds;
            readonly List<(ModuleFacts Module, string Kind, GameObject Root, List<Mesh> Meshes, StationViewRecord Record, long[] EndpointColumns, long? PillarColumn)> staged;
            bool committed;

            public StagedStructureDelta(
                WorldState state,
                StructureWorldCache cache,
                HashSet<string> retiredIds,
                List<(ModuleFacts Module, string Kind, GameObject Root, List<Mesh> Meshes, StationViewRecord Record, long[] EndpointColumns, long? PillarColumn)> staged) {
                this.state = state;
                this.cache = cache;
                this.retiredIds = retiredIds;
                this.staged = staged;
            }

            public void Commit(StationWorldView world, StationLocalViewCommit commit) {
                committed = true;
                if (retiredIds.Count > 0) {
                    world.RetireRecordsWhere(rec => rec.Role == StationModuleClaims.Structure && retiredIds.Contains(rec.ModuleId),
                        commit, retireViewObjects: true);
                    state.Modules.RemoveAll(m => retiredIds.Contains(m.ModuleId));
                    foreach (var id in retiredIds) {
                        state.ById.Remove(id);
                        if (cache.MeshesByModuleId.TryGetValue(id, out var oldMeshes)) {
                            cache.MeshesByModuleId.Remove(id);
                            for (int i = 0; i < oldMeshes.Count; i++) {
                                var m = oldMeshes[i];
                                if (m == null) continue;
                                state.Meshes.Remove(m);
                                commit.RetiredMeshes.Add(m);
                            }
                        }
                    }
                    foreach (var pair in cache.RoofHangersByColumn) {
                        pair.Value.RemoveWhere(id => retiredIds.Contains(id));
                    }
                    foreach (var pair in cache.PillarsByColumn) {
                        pair.Value.RemoveWhere(id => retiredIds.Contains(id));
                    }
                }

                var roleRoot = world.RoleRoot(StationModuleClaims.Structure);
                for (int i = 0; i < staged.Count; i++) {
                    var item = staged[i];
                    item.Root.transform.SetParent(roleRoot, false);
                    var built = new BuiltModule {
                        ModuleId = item.Module.Id,
                        Type = item.Module.Type,
                        View = item.Root,
                        Key = "generated:" + item.Kind,
                    };
                    state.Modules.Add(built);
                    if (!string.IsNullOrEmpty(item.Module.Id)) {
                        state.ById[item.Module.Id] = built;
                        cache.MeshesByModuleId[item.Module.Id] = item.Meshes;
                    }
                    state.Meshes.AddRange(item.Meshes);
                    if (item.EndpointColumns != null && !string.IsNullOrEmpty(item.Module.Id)) {
                        for (int c = 0; c < item.EndpointColumns.Length; c++) {
                            long col = item.EndpointColumns[c];
                            if (!cache.RoofHangersByColumn.TryGetValue(col, out var set)) {
                                cache.RoofHangersByColumn[col] = set = new HashSet<string>(StringComparer.Ordinal);
                            }
                            set.Add(item.Module.Id);
                        }
                    }
                    if (item.PillarColumn.HasValue && !string.IsNullOrEmpty(item.Module.Id)) {
                        long col = item.PillarColumn.Value;
                        if (!cache.PillarsByColumn.TryGetValue(col, out var set)) {
                            cache.PillarsByColumn[col] = set = new HashSet<string>(StringComparer.Ordinal);
                        }
                        set.Add(item.Module.Id);
                    }
                    world.AddLocalRecord(item.Record, commit);
                }
                state.Count = state.Modules.Count;
            }

            public void Dispose() {
                if (committed) return;
                for (int i = 0; i < staged.Count; i++) {
                    var item = staged[i];
                    for (int m = 0; m < item.Meshes.Count; m++) {
                        if (item.Meshes[m] != null) Destroy(item.Meshes[m]);
                    }
                    if (item.Root != null) Destroy(item.Root);
                }
                staged.Clear();
            }
        }

        readonly List<StructureWorldCache> worldCaches = new List<StructureWorldCache>();

        StructureWorldCache WorldCacheOf(StationWorldView world) {
            for (int i = worldCaches.Count - 1; i >= 0; i--) {
                if (worldCaches[i].World == world) return worldCaches[i];
            }
            return null;
        }

        void PurgeWorldCaches() {
            for (int i = worldCaches.Count - 1; i >= 0; i--) {
                if (worldCaches[i].World == null || worldCaches[i].World.IsDisposed) worldCaches.RemoveAt(i);
            }
        }

        public override void Release() {
            base.Release();
            PurgeWorldCaches();
        }

        sealed class HangerBackingIndex {
            readonly StationIndex index;
            readonly Dictionary<long, List<int>> solidColumns;
            readonly List<ModuleFacts> roofs = new List<ModuleFacts>();

            public HangerBackingIndex(StationIndex stationIndex, IReadOnlyList<StationCellRecord> cells, ModuleFacts[] station) {
                index = stationIndex;
                if (index != null) {
                    var roofMods = index.ModulesOfType("roof");
                    for (int i = 0; i < roofMods.Count; i++) {
                        if (roofMods[i]?.Facts != null) roofs.Add(roofMods[i].Facts);
                    }
                    return;
                }
                solidColumns = new Dictionary<long, List<int>>();
                if (cells != null) {
                    for (int i = 0; i < cells.Count; i++) {
                        var cell = cells[i];
                        if (cell == null || !cell.IsSolid) continue;
                        long key = ColumnKey(cell.X, cell.Y);
                        if (!solidColumns.TryGetValue(key, out var zs)) {
                            zs = new List<int>();
                            solidColumns[key] = zs;
                        }
                        zs.Add(cell.Z);
                    }
                }
                if (station != null) {
                    for (int i = 0; i < station.Length; i++) {
                        var module = station[i];
                        if (module != null && string.Equals(module.Type, "roof", StringComparison.Ordinal)) {
                            roofs.Add(module);
                        }
                    }
                }
            }

            public double? RoofZ(ModuleFacts hanger, int x, int y) {
                double barTop = hanger.Z + 1d + StationStructureGeometry.HangerBarTop;
                double? backing = null;
                if (index != null) {
                    var b = index.Bounds;
                    if (!b.IsEmpty && x >= b.MinX && x <= b.MaxX && y >= b.MinY && y <= b.MaxY) {
                        int minZ = Math.Max(b.MinZ, (int)Math.Ceiling(barTop - 1e-9));
                        for (int z = minZ; z <= b.MaxZ; z++) {
                            var cell = index.GetCell(x, y, z);
                            if (cell != null && cell.IsSolid) {
                                backing = z;
                                break;
                            }
                        }
                    }
                } else if (solidColumns != null && solidColumns.TryGetValue(ColumnKey(x, y), out var zs)) {
                    for (int i = 0; i < zs.Count; i++) {
                        int z = zs[i];
                        if (z >= barTop && (!backing.HasValue || z < backing.Value)) backing = z;
                    }
                }
                for (int i = 0; i < roofs.Count; i++) {
                    if (!StationStructureGeometry.TryRoofBackingAt(roofs[i], x, y, out double z)) continue;
                    if (z >= barTop && (!backing.HasValue || z < backing.Value)) backing = z;
                }
                return backing;
            }

            static long ColumnKey(int x, int y) => ((long)(x + 32768) << 20) | (long)(y + 32768);
        }

        protected override void BuildGroup(StationViewBuildContext context, ModuleFacts[] station, WorldState state) {
            PurgeWorldCaches();
            var worldCache = new StructureWorldCache { World = context.World };
            worldCaches.Add(worldCache);
            RoofNotes.Clear();
            PillarNotes.Clear();
            HangerNotes.Clear();
            StationMaterials palette = null;
            HangerBackingIndex hangerBacking = null;
            var grid = StationLevelGrid.FromDocument(context.Document.LevelBase, context.Document.StoreyHeight);
            for (int i = 0; i < station.Length; i++) {
                var module = station[i];
                if (module == null || !Owns(module.Type)) continue;
                // The shared palette is minted for the first structure module only: a station with
                // neither a roof, pillar nor hanger pays nothing for this renderer.
                if (palette == null && context.Shader != null) {
                    palette = state.Palette ?? new StationMaterials(context.Shader);
                    if (state.Palette == null) {
                        state.Palette = palette;
                        for (int slot = 0; slot < StationMaterials.Colours.Length; slot++) state.Materials.Add(palette[slot]);
                    }
                }
                int meshesBefore = state.Meshes.Count;
                if (string.Equals(module.Type, "roof", StringComparison.Ordinal)) {
                    BuildRoof(context, module, state, palette, grid);
                } else if (string.Equals(module.Type, "hanger", StringComparison.Ordinal)) {
                    if (hangerBacking == null) hangerBacking = new HangerBackingIndex(context.Index, context.Document?.Cells, station);
                    BuildHanger(context, module, hangerBacking, state, palette, grid);
                } else {
                    BuildPillar(context, module, station, state, palette, grid);
                }
                RecordModuleCache(worldCache, module, state, meshesBefore);
            }
        }

        static void RecordModuleCache(StructureWorldCache cache, ModuleFacts module, WorldState state, int meshesBefore) {
            if (cache == null || string.IsNullOrEmpty(module?.Id)) return;
            var meshes = new List<Mesh>(Math.Max(0, state.Meshes.Count - meshesBefore));
            for (int m = meshesBefore; m < state.Meshes.Count; m++) meshes.Add(state.Meshes[m]);
            cache.MeshesByModuleId[module.Id] = meshes;
            if (string.Equals(module.Type, "hanger", StringComparison.Ordinal)) {
                if (!string.Equals(module.Config.Text("mount"), "post", StringComparison.Ordinal)) {
                    var run = StationStructureGeometry.HangerCells(module);
                    int width = Math.Max(1, module.Width);
                    int[] endpoints = { 0, width - 1 };
                    for (int e = 0; e < endpoints.Length; e++) {
                        var cell = run[endpoints[e]];
                        long col = StationLocalDeltaContext.PackColumn(cell.X, cell.Y);
                        if (!cache.RoofHangersByColumn.TryGetValue(col, out var set)) {
                            cache.RoofHangersByColumn[col] = set = new HashSet<string>(StringComparer.Ordinal);
                        }
                        set.Add(module.Id);
                    }
                }
            } else if (string.Equals(module.Type, "pillar", StringComparison.Ordinal)) {
                long col = StationLocalDeltaContext.PackColumn(module.X, module.Y);
                if (!cache.PillarsByColumn.TryGetValue(col, out var set)) {
                    cache.PillarsByColumn[col] = set = new HashSet<string>(StringComparer.Ordinal);
                }
                set.Add(module.Id);
            }
        }

        static void AddRoofFootprintColumns(StationModuleRecord roof, HashSet<long> columns) {
            if (roof == null || columns == null) return;
            int width = Math.Max(1, roof.Width), depth = Math.Max(1, roof.Depth);
            int rotation = ((roof.Rotation % 4) + 4) % 4;
            for (int i = 0; i < width; i++) {
                for (int j = 0; j < depth; j++) {
                    int dx, dy;
                    switch (rotation) {
                        case 1: dx = -j; dy = i; break;
                        case 2: dx = -i; dy = -j; break;
                        case 3: dx = j; dy = -i; break;
                        default: dx = i; dy = j; break;
                    }
                    columns.Add(StationLocalDeltaContext.PackColumn(roof.X + dx, roof.Y + dy));
                }
            }
        }

        static void AddBridgeTrackColumns(StationModuleRecord track, HashSet<long> columns) {
            if (track == null || columns == null) return;
            var cells = StationFootprints.TrackCells(track);
            for (int i = 0; i < cells.Length; i++) {
                columns.Add(StationLocalDeltaContext.PackColumn((int)Math.Round(cells[i].X), (int)Math.Round(cells[i].Y)));
            }
        }

        public override bool TryStageLocalDelta(
            StationLocalDeltaContext context,
            out IStationLocalRendererStage stage,
            out string fallbackReason) {
            stage = null;
            fallbackReason = null;
            var state = StateOf(context.World);
            if (state == null) {
                fallbackReason = "no-structure-state";
                return false;
            }
            var cache = WorldCacheOf(context.World);
            if (cache == null) {
                if (state.Modules.Count > 0) {
                    fallbackReason = "no-structure-world-cache";
                    return false;
                }
                cache = new StructureWorldCache { World = context.World };
                worldCaches.Add(cache);
            }

            var removedIds = new HashSet<string>(StringComparer.Ordinal);
            var dirtyIds = new HashSet<string>(StringComparer.Ordinal);
            HashSet<long> dirtyRoofColumns = null;
            HashSet<long> dirtyBridgeColumns = null;
            var delta = context.Delta;

            for (int i = 0; i < delta.RemovedModules.Count; i++) {
                var id = delta.RemovedModules[i];
                if (!context.PrevIndex.TryGetModule(id, out var oldMod) || oldMod == null) continue;
                if (string.Equals(oldMod.Type, "track", StringComparison.Ordinal) && oldMod.Config.Bool("bridge")) {
                    AddBridgeTrackColumns(oldMod, dirtyBridgeColumns ??= new HashSet<long>());
                    continue;
                }
                if (!Owns(oldMod.Type)) continue;
                removedIds.Add(id);
                if (string.Equals(oldMod.Type, "roof", StringComparison.Ordinal)) {
                    AddRoofFootprintColumns(oldMod, dirtyRoofColumns ??= new HashSet<long>());
                }
            }
            for (int i = 0; i < delta.ChangedModules.Count; i++) {
                var mod = delta.ChangedModules[i];
                if (mod == null) continue;
                if (string.Equals(mod.Type, "track", StringComparison.Ordinal)) {
                    if (mod.Config.Bool("bridge")) {
                        AddBridgeTrackColumns(mod, dirtyBridgeColumns ??= new HashSet<long>());
                    }
                    if (context.PrevIndex.TryGetModule(mod.Id, out var prevTrack) && prevTrack != null &&
                        string.Equals(prevTrack.Type, "track", StringComparison.Ordinal) && prevTrack.Config.Bool("bridge")) {
                        AddBridgeTrackColumns(prevTrack, dirtyBridgeColumns ??= new HashSet<long>());
                    }
                    continue;
                }
                if (!Owns(mod.Type)) continue;
                dirtyIds.Add(mod.Id);
                if (string.Equals(mod.Type, "roof", StringComparison.Ordinal)) {
                    AddRoofFootprintColumns(mod, dirtyRoofColumns ??= new HashSet<long>());
                    if (context.PrevIndex.TryGetModule(mod.Id, out var prevRoof) && prevRoof != null &&
                        string.Equals(prevRoof.Type, "roof", StringComparison.Ordinal)) {
                        AddRoofFootprintColumns(prevRoof, dirtyRoofColumns);
                    }
                }
            }

            if (context.CellsChanged && cache.RoofHangersByColumn.Count > 0) {
                foreach (long col in context.TouchedColumns) {
                    if (!cache.RoofHangersByColumn.TryGetValue(col, out var ids)) continue;
                    foreach (var id in ids) {
                        if (!removedIds.Contains(id) && context.NextIndex.TryGetModule(id, out _)) {
                            dirtyIds.Add(id);
                        }
                    }
                }
            }

            if (dirtyRoofColumns != null && cache.RoofHangersByColumn.Count > 0) {
                foreach (long col in dirtyRoofColumns) {
                    if (!cache.RoofHangersByColumn.TryGetValue(col, out var ids)) continue;
                    foreach (var id in ids) {
                        if (!removedIds.Contains(id) && context.NextIndex.TryGetModule(id, out _)) {
                            dirtyIds.Add(id);
                        }
                    }
                }
            }

            if (dirtyBridgeColumns != null && cache.PillarsByColumn.Count > 0) {
                foreach (long col in dirtyBridgeColumns) {
                    if (!cache.PillarsByColumn.TryGetValue(col, out var ids)) continue;
                    foreach (var id in ids) {
                        if (!removedIds.Contains(id) && context.NextIndex.TryGetModule(id, out _)) {
                            dirtyIds.Add(id);
                        }
                    }
                }
            }

            if (removedIds.Count == 0 && dirtyIds.Count == 0) return true;

            if (dirtyIds.Count > 0 && state.Palette == null && context.World.Shader != null) {
                state.Palette = new StationMaterials(context.World.Shader);
                for (int slot = 0; slot < StationMaterials.Colours.Length; slot++) state.Materials.Add(state.Palette[slot]);
            }

            HangerBackingIndex backing = null;
            var grid = StationLevelGrid.FromDocument(context.NextDocument.LevelBase, context.NextDocument.StoreyHeight);
            var retiredIds = new HashSet<string>(removedIds, StringComparer.Ordinal);
            var staged = new List<(ModuleFacts Module, string Kind, GameObject Root, List<Mesh> Meshes, StationViewRecord Record, long[] EndpointColumns, long? PillarColumn)>(dirtyIds.Count);

            try {
                foreach (var id in dirtyIds) {
                    retiredIds.Add(id);
                    if (!context.NextIndex.TryGetModule(id, out var record) || record == null || !Owns(record.Type)) continue;
                    var module = record.Facts;
                    StructureParts parts;
                    string kind;
                    bool turn = true;
                    long[] endpointCols = null;
                    long? pillarCol = null;

                    if (string.Equals(module.Type, "roof", StringComparison.Ordinal)) {
                        kind = "roof";
                        parts = BuildRoofParts(module, context.World.Shader, state, state.Palette,
                            context.ReportUnresolved, out _, out _, out _, out _);
                    } else if (string.Equals(module.Type, "pillar", StringComparison.Ordinal)) {
                        kind = "pillar";
                        parts = BuildPillarParts(module, context.NextIndex, null, context.World.Shader, state, state.Palette,
                            context.ReportUnresolved, out bool thick, out _, out _, out _);
                        turn = thick;
                        pillarCol = StationLocalDeltaContext.PackColumn(module.X, module.Y);
                    } else {
                        kind = "hanger";
                        backing ??= new HangerBackingIndex(context.NextIndex, null, null);
                        parts = BuildHangerParts(module, backing, context.World.Shader, state, state.Palette,
                            context.ReportUnresolved, out _);
                        if (!string.Equals(module.Config.Text("mount"), "post", StringComparison.Ordinal)) {
                            var run = StationStructureGeometry.HangerCells(module);
                            int width = Math.Max(1, module.Width);
                            endpointCols = new[] {
                                StationLocalDeltaContext.PackColumn(run[0].X, run[0].Y),
                                StationLocalDeltaContext.PackColumn(run[width - 1].X, run[width - 1].Y),
                            };
                        }
                    }

                    var root = new GameObject((string.IsNullOrEmpty(module.Id) ? kind : module.Id) + " " + kind);
                    root.transform.SetParent(context.StagingRoot, false);
                    root.transform.SetPositionAndRotation(
                        StationCoordinates.Point(new Vector3(module.X + .5f, module.Y + .5f, module.Z + 1f)),
                        turn ? ModulePlacement.Rotation(module.Rotation) : Quaternion.identity);
                    var meshes = new List<Mesh>(4);
                    parts.Emit(root.transform, meshes, kind);
                    var bands = StationModuleLevels.Of(module, grid);
                    int levelMin = bands.Length > 0 ? bands[0] : module.Z;
                    int levelMax = bands.Length > 0 ? bands[bands.Length - 1] : levelMin;
                    bool hasBounds = TryDocumentBounds(root.transform, context.World.Root, out var bounds);
                    var viewRecord = new StationViewRecord {
                        Role = Role,
                        ModuleId = module.Id,
                        Part = kind,
                        View = root,
                        Bounds = hasBounds ? bounds : BoxOf(module),
                        HasBounds = true,
                        LevelMin = levelMin,
                        LevelMax = levelMax,
                        LevelBands = bands,
                    };
                    StationEditTrace.AddInstantiatedPrefab();
                    staged.Add((module, kind, root, meshes, viewRecord, endpointCols, pillarCol));
                }
                stage = new StagedStructureDelta(state, cache, retiredIds, staged);
                return true;
            } catch {
                for (int i = 0; i < staged.Count; i++) {
                    for (int m = 0; m < staged[i].Meshes.Count; m++) {
                        if (staged[i].Meshes[m] != null) Destroy(staged[i].Meshes[m]);
                    }
                    if (staged[i].Root != null) Destroy(staged[i].Root);
                }
                throw;
            }
        }

        StructureParts BuildHangerParts(ModuleFacts module, HangerBackingIndex backing, Shader shader, WorldState state,
            StationMaterials palette, Action<string, string, string, string> reportUnresolved, out string endpointSummary) {
            var parts = new StructureParts();
            int width = Math.Max(1, module.Width);
            string mount = module.Config.Text("mount");
            bool isRoof = string.Equals(mount, "roof", StringComparison.Ordinal);
            bool isPost = string.Equals(mount, "post", StringComparison.Ordinal);
            float barTop = isRoof ? StationStructureGeometry.HangerBarTop : StationStructureGeometry.HangerPostBarTop;
            float centre = (width - 1) * .5f;
            var steel = palette != null ? palette[StationMaterials.Steel] : null;
            if (!steel) steel = FinishMaterial(shader, state, StationStructureGeometry.DefaultRoofFinish, reportUnresolved);

            parts.Box(steel,
                new Vector3(centre, 0f, barTop - StationStructureGeometry.HangerBarDepth * .5f),
                new Vector3(width, StationStructureGeometry.HangerBarDepth, StationStructureGeometry.HangerBarDepth));

            if (isPost) {
                parts.Box(steel,
                    new Vector3(centre, StationStructureGeometry.HangerPostOffset, StationStructureGeometry.HangerPostBarTop * .5f),
                    new Vector3(StationStructureGeometry.HangerPostWidth, StationStructureGeometry.HangerPostWidth, StationStructureGeometry.HangerPostBarTop));
                parts.Box(steel,
                    new Vector3(centre, StationStructureGeometry.HangerPostOffset, .025f),
                    new Vector3(.36f, .36f, .05f));
                endpointSummary = "post";
            } else {
                var run = StationStructureGeometry.HangerCells(module);
                int[] endpoints = { 0, width - 1 };
                double end0 = 0, end1 = 0;
                for (int e = 0; e < endpoints.Length; e++) {
                    int index = endpoints[e];
                    var cell = run[index];
                    double roofZ = backing.RoofZ(module, cell.X, cell.Y) ?? (module.Z + 5d);
                    if (e == 0) end0 = roofZ; else end1 = roofZ;
                    float height = Mathf.Max(0f, (float)(roofZ - (module.Z + 1d + barTop)));
                    if (height > 0f) {
                        parts.Box(steel, new Vector3(index, 0f, barTop + height * .5f), new Vector3(.08f, .08f, height));
                    }
                    parts.Box(steel, new Vector3(index, 0f, barTop), new Vector3(.3f, .3f, .04f));
                }
                endpointSummary = "roofZ=" + end0.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                    end1.ToString("0.###", CultureInfo.InvariantCulture);
            }
            return parts;
        }

        /// <summary>The world's finish library, acquired on first need like the cell mesher's.</summary>
        Material FinishMaterial(Shader shader, WorldState state, string id, Action<string, string, string, string> reportUnresolved) {
            if (state.Finishes == null && shader != null) {
                state.Finishes = StationCellRenderer.AcquireLibrary(shader);
            }
            var material = state.Finishes != null ? state.Finishes.For(id) : null;
            if (material) return material;
            if (!finishMissingReported) {
                finishMissingReported = true;
                reportUnresolved?.Invoke("finish-library-missing", "structure", id,
                    "the station finish library is not staged, so '" + id +
                    "' resolves to the palette; run `node tools/unity-assets/export-station-finishes.mjs --stage unity/Assets/Resources/StationFinishes`.");
            }
            return null;
        }

        bool finishMissingReported;

        /* ------------------------------------------------------------------ roof */

        StructureParts BuildRoofParts(ModuleFacts module, Shader shader, WorldState state, StationMaterials palette,
            Action<string, string, string, string> reportUnresolved,
            out string variant, out string finishId, out float length, out float width) {
            var parts = new StructureParts();
            length = Math.Max(1, module.Width);
            width = Math.Max(1, module.Depth);
            variant = module.Config.Text("variant");
            finishId = module.Config.Text("finish");
            if (finishId.Length == 0) finishId = StationStructureGeometry.DefaultRoofFinish;
            var sheet = FinishMaterial(shader, state, finishId, reportUnresolved);
            if (!sheet && palette != null) sheet = palette[StationMaterials.Platform];
            var steel = palette != null ? palette[StationMaterials.Steel] : null;
            if (!steel) steel = sheet;

            // The source's local frame: `x` along the run, `y` across, `z` up. `centreX` and
            // `crestY` are the run's centre line; the eave is just inside the footprint.
            float centreX = (length - 1f) * .5f;
            float crestY = (width - 1f) * .5f;
            float eaveY = width - .5f;
            if (variant.Length == 0) {
                float plateZ = StationStructureGeometry.FlatRoofZ(module.Config.Text("plateSnap"));
                parts.Box(sheet, new Vector3(centreX, crestY, plateZ),
                    new Vector3(length, width, StationStructureGeometry.RoofThickness));
            } else {
                bool canopy = string.Equals(variant, "canopy", StringComparison.Ordinal);
                float drop = canopy ? StationStructureGeometry.CanopyRoofDrop : 0f;
                float ridgeZ = StationStructureGeometry.TrussRoofRidge(width) - drop;
                float eaveZ = StationStructureGeometry.TrussRoofEave - drop;
                float localWidth = width;
                float upper(float y) => ridgeZ - (ridgeZ - eaveZ) * Mathf.Abs(y - crestY) / (localWidth * .5f);
                float lowerZ = StationStructureGeometry.TrussRoofBase + StationStructureGeometry.TrussRoofChord * .5f;
                float skin = StationStructureGeometry.TrussRoofSkin;
                // Two continuous sheet runs with the crest along the run's own axis. Each sheet
                // is tilted about that axis, so its eave and crest land on `upper()` exactly.
                for (int side = -1; side <= 1; side += 2) {
                    float y0 = side < 0 ? -.48f : crestY;
                    float y1 = side < 0 ? crestY : eaveY - .02f;
                    float z0 = upper(y0), z1 = upper(y1);
                    float angle = Mathf.Atan2(z1 - z0, y1 - y0);
                    float run = Mathf.Sqrt((y1 - y0) * (y1 - y0) + (z1 - z0) * (z1 - z0));
                    float cos = Mathf.Cos(angle), sin = Mathf.Sin(angle);
                    // Source (along, across, up) → Unity local: the across axis gains the
                    // slope and the thickness axis tips with it.
                    var centre = new Vector3(centreX, (z0 + z1) * .5f + skin - skin * cos * .5f, (y0 + y1) * .5f);
                    parts.Edged(sheet, centre,
                        new Vector3(length, 0f, 0f),
                        new Vector3(0f, skin * cos, -skin * sin),
                        new Vector3(0f, run * sin, run * cos));
                }
                if (!string.Equals(variant, "shell", StringComparison.Ordinal)) {
                    // Purlins follow the crest immediately below the shared skin.
                    for (float y = 0f; y < width; y += 1f) {
                        parts.Box(steel, new Vector3(centreX, y, upper(y) - .1f), new Vector3(length, .11f, .11f));
                    }
                    if (canopy) {
                        foreach (var row in StationStructureGeometry.CanopyPostRows(width)) {
                            for (float x = 0f; x < length; x += 1f) {
                                float ridge = StationStructureGeometry.TrussRoofRidge(width);
                                float height = ridge - (ridge - StationStructureGeometry.TrussRoofEave) *
                                    Mathf.Abs(row - crestY) / (width * .5f) - StationStructureGeometry.CanopyRoofDrop - .1f;
                                parts.Cylinder(steel, new Vector3(x, 0f, row),
                                    StationStructureGeometry.CanopyPostRadius, Mathf.Max(0f, height), 12);
                            }
                        }
                    } else if (string.Equals(variant, "tapered-truss", StringComparison.Ordinal)) {
                        // A closed triangular web: a heavy central chord, one upright per bay on
                        // the crest, mirrored ribs and end ties carrying the shell into it.
                        parts.Box(steel, new Vector3(centreX, crestY, lowerZ), new Vector3(length, StationStructureGeometry.TrussRoofChord, StationStructureGeometry.TrussRoofChord));
                        var ribs = new List<float>();
                        for (float y = 0f; y < width * .5f; y += 2f) ribs.Add(y);
                        for (int r = 0; r < ribs.Count; r++) {
                            float y = ribs[r];
                            if (!ribs.Contains(width - 1f - y)) ribs.Add(width - 1f - y);
                        }
                        float crown = ridgeZ - .12f;
                        for (float x = 0f; x < length; x += 1f) {
                            parts.Member(steel, new Vector3(x, crestY, lowerZ), new Vector3(x, crestY, crown), .14f);
                            foreach (var y in ribs) {
                                parts.Member(steel, new Vector3(x, crestY, lowerZ), new Vector3(x, y, upper(y) - .12f), .12f);
                                if (x < length - 1f)
                                    parts.Member(steel, new Vector3(x, crestY, lowerZ), new Vector3(x + 1f, y, upper(y) - .12f), .1f);
                            }
                            foreach (var y in new[] { 0f, width - 1f }) {
                                parts.Member(steel, new Vector3(x, y, upper(y) - .12f), new Vector3(x, crestY, crown), .14f);
                            }
                        }
                    } else {
                        // The open web: longitudinal chords on the two edges and one run roughly
                        // every four metres, each carrying a triangular web.
                        var trussYs = new List<float> { 0f, width - 1f };
                        for (float y = 4f; y < width - 1f; y += 4f) trussYs.Add(y);
                        foreach (var y in trussYs) {
                            parts.Box(steel, new Vector3(centreX, y, lowerZ), new Vector3(length, StationStructureGeometry.TrussRoofChord, StationStructureGeometry.TrussRoofChord));
                            for (float x = 0f; x < length; x += 1f) {
                                parts.Member(steel, new Vector3(x, y, lowerZ), new Vector3(x, y, upper(y) - .12f), .1f);
                                if (x < length - 1f)
                                    parts.Member(steel, new Vector3(x, y, lowerZ), new Vector3(x + 1f, y, upper(y) - .12f), .09f);
                            }
                        }
                    }
                }
            }
            return parts;
        }

        void BuildRoof(StationViewBuildContext context, ModuleFacts module, WorldState state,
            StationMaterials palette, StationLevelGrid grid) {
            var parts = BuildRoofParts(module, context.Shader, state, palette, context.ReportUnresolved,
                out var variant, out var finishId, out float length, out float width);
            Emit(context, state, module, grid, parts, "roof");
            RoofNotes.Add(module.Id + " variant=" + (variant.Length == 0 ? "flat" : variant) +
                " bay=" + length.ToString("0.##", CultureInfo.InvariantCulture) + "x" +
                width.ToString("0.##", CultureInfo.InvariantCulture) +
                " finish=" + finishId + " triangles=" + parts.Triangles);
        }

        /* ---------------------------------------------------------------- pillar */

        StructureParts BuildPillarParts(ModuleFacts module, StationIndex index, IReadOnlyList<ModuleFacts> station,
            Shader shader, WorldState state, StationMaterials palette,
            Action<string, string, string, string> reportUnresolved,
            out bool thick, out float h, out ModuleFacts bridge, out string finishId) {
            var parts = new StructureParts();
            thick = module.Config.Text("size") == "thick";
            float w = StationStructureGeometry.PillarWidth(module);
            var offset = StationStructureGeometry.PillarOffset(module);
            bridge = index != null
                ? StationStructureGeometry.BridgeFor(module, index)
                : StationStructureGeometry.BridgeFor(module, station);
            h = bridge != null
                // `bridge.z − BRIDGE_DECK_DEPTH − mod.z − 1`: the shaft meets the deck's underside.
                ? bridge.Z - StationStructureGeometry.BridgeDeckDepth - module.Z - 1f
                : StationStructureGeometry.PillarHeight(module);
            if (h < .1f) h = .1f;
            finishId = module.Config.Text("finish");
            if (finishId.Length == 0) finishId = StationStructureGeometry.DefaultRoofFinish;
            var shaftMaterial = thick
                ? FinishMaterial(shader, state, finishId, reportUnresolved) ?? (palette != null ? palette[StationMaterials.Platform] : null)
                : palette != null ? palette[StationMaterials.Dark] : null;
            var collarMaterial = palette != null ? palette[StationMaterials.Steel] : shaftMaterial;
            if (!shaftMaterial) shaftMaterial = collarMaterial;
            if (!collarMaterial) collarMaterial = shaftMaterial;
            // The group's own origin is the cell centre at the pillar's floor top; a 细柱's
            // saved `rot` selects its in-cell spot, so it is applied once, here.
            var origin = new Vector3(offset.x, 0f, offset.y);
            if (thick) {
                // A round shaft recessed beneath its collars, so no face is coincident.
                if (h > .2f)
                    parts.Cylinder(shaftMaterial, origin + new Vector3(0f, .1f, 0f), w * .5f - .01f, h - .2f, 32);
                parts.Cylinder(collarMaterial, origin + new Vector3(0f, Mathf.Max(.05f, Mathf.Min(h - .05f, 0f)) - .05f, 0f), w * .5f, .1f, 32);
                if (h > .1f)
                    parts.Cylinder(collarMaterial, origin + new Vector3(0f, Mathf.Max(.05f, Mathf.Min(h - .05f, h)) - .05f, 0f), w * .5f, .1f, 32);
            } else {
                // A slim shaft stays inside its steel collars; `rot` already placed it.
                float shaftStart = .1f;
                float shaftEnd = Mathf.Max(shaftStart, h - .1f);
                float shaftWidth = w - .08f;
                if (shaftEnd > shaftStart) {
                    float mid = (shaftStart + shaftEnd) * .5f;
                    parts.Box(shaftMaterial, new Vector3(offset.x, offset.y, mid),
                        new Vector3(shaftWidth, shaftWidth, shaftEnd - shaftStart));
                }
                foreach (var z in new[] { 0f, h }) {
                    parts.Box(collarMaterial, new Vector3(offset.x, offset.y, Mathf.Max(.05f, Mathf.Min(h - .05f, z))),
                        new Vector3(w, w, .1f));
                }
            }
            return parts;
        }

        void BuildPillar(StationViewBuildContext context, ModuleFacts module, ModuleFacts[] station, WorldState state,
            StationMaterials palette, StationLevelGrid grid) {
            var parts = BuildPillarParts(module, context.Index, station, context.Shader, state, palette,
                context.ReportUnresolved, out bool thick, out float h, out var bridge, out var finishId);
            // `placeLocal(mod.cfg.size === 'slim' ? { ...mod, rot: 0 } : mod)`: a slim pillar's
            // in-cell spot is its turn, so the model must not turn about the origin as well.
            bool turn = thick;
            Emit(context, state, module, grid, parts, "pillar", turn);
            PillarNotes.Add(module.Id + " size=" + (thick ? "thick" : "slim") +
                " height=" + h.ToString("0.###", CultureInfo.InvariantCulture) +
                " bridge=" + (bridge != null ? bridge.Id : "none") +
                " finish=" + finishId + " triangles=" + parts.Triangles);
        }

        /* ---------------------------------------------------------------- hanger */

        void BuildHanger(StationViewBuildContext context, ModuleFacts module, HangerBackingIndex backing,
            WorldState state, StationMaterials palette, StationLevelGrid grid) {
            int width = Math.Max(1, module.Width);
            string mount = module.Config.Text("mount");
            bool isRoof = string.Equals(mount, "roof", StringComparison.Ordinal);
            float barTop = isRoof ? StationStructureGeometry.HangerBarTop : StationStructureGeometry.HangerPostBarTop;
            var parts = BuildHangerParts(module, backing, context.Shader, state, palette, context.ReportUnresolved, out var endpointSummary);

            Emit(context, state, module, grid, parts, "hanger");
            HangerNotes.Add(module.Id + " mount=" + (mount.Length == 0 ? "post" : mount) +
                " width=" + width +
                " barTop=" + (module.Z + 1d + barTop).ToString("0.###", CultureInfo.InvariantCulture) +
                " " + endpointSummary +
                " triangles=" + parts.Triangles);
        }

        /* ----------------------------------------------------------------- emit */

        void Emit(StationViewBuildContext context, WorldState state, ModuleFacts module, StationLevelGrid grid,
            StructureParts parts, string kind, bool turn = true) {
            var parent = context.RoleRoot(Role);
            var root = new GameObject((string.IsNullOrEmpty(module.Id) ? kind : module.Id) + " " + kind);
            root.transform.SetParent(parent, false);
            root.transform.SetPositionAndRotation(
                StationCoordinates.Point(new Vector3(module.X + .5f, module.Y + .5f, module.Z + 1f)),
                turn ? ModulePlacement.Rotation(module.Rotation) : Quaternion.identity);
            parts.Emit(root.transform, state.Meshes, kind);
            state.Count++;
            var built = new BuiltModule { ModuleId = module.Id, Type = module.Type, View = root, Key = "generated:" + kind };
            state.Modules.Add(built);
            if (!string.IsNullOrEmpty(module.Id)) state.ById[module.Id] = built;
            var bands = StationModuleLevels.Of(module, grid);
            int levelMin = bands.Length > 0 ? bands[0] : module.Z;
            int levelMax = bands.Length > 0 ? bands[bands.Length - 1] : levelMin;
            if (TryDocumentBounds(root.transform, context.Root, out var bounds)) {
                context.World.RegisterModule(Role, module.Id, root, kind, bounds, levelMin, levelMax, bands);
            } else {
                context.World.RegisterModule(Role, module.Id, root, kind, BoxOf(module), levelMin, levelMax, bands);
            }
        }
    }
}
