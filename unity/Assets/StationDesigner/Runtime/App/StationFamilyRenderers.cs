using System;
using System.Collections.Generic;
using Metro.App.Views;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// Lead integration for plan 11: every packet's family builder is wrapped as an
    /// <see cref="IStationViewRenderer"/> here and registered once, so the station
    /// host (packet A) draws the same set of records for a demo document as for an
    /// opened save. A renderer draws only its own family, draws nothing for a record
    /// it cannot resolve, and reports the diagnostic instead of inventing geometry.
    /// </summary>
    public sealed class OutdoorModuleRenderer : IStationViewRenderer, IStationLocalViewRenderer {
        public const string RoleName = "modules";
        public string Role => RoleName;

        const int ChunkSize = 64;
        const int BatchThreshold = 6;

        readonly struct OutdoorChunkKey : IEquatable<OutdoorChunkKey> {
            public readonly int Band, ChunkX, ChunkY;
            public readonly string ViewKey;

            public OutdoorChunkKey(int band, int chunkX, int chunkY, string viewKey) {
                Band = band; ChunkX = chunkX; ChunkY = chunkY; ViewKey = viewKey ?? "";
            }

            public bool Equals(OutdoorChunkKey other) =>
                Band == other.Band && ChunkX == other.ChunkX && ChunkY == other.ChunkY &&
                string.Equals(ViewKey, other.ViewKey, StringComparison.Ordinal);

            public override bool Equals(object obj) => obj is OutdoorChunkKey other && Equals(other);

            public override int GetHashCode() {
                unchecked {
                    int h = Band;
                    h = (h * 397) ^ ChunkX;
                    h = (h * 397) ^ ChunkY;
                    h = (h * 397) ^ StringComparer.Ordinal.GetHashCode(ViewKey);
                    return h;
                }
            }

            public string Label() => "outdoor " + Band + " " + ChunkX + "," + ChunkY + " " + ViewKey;
        }

        static int ChunkCoord(int value) => value >= 0 ? value / ChunkSize : (value - (ChunkSize - 1)) / ChunkSize;

        sealed class OutdoorWorldState {
            public StationWorldView World;
            public StationPrefabTemplateCache Templates = new StationPrefabTemplateCache();
            public StationInstancedSurfaceDrawer Drawer;
            public readonly Dictionary<string, GameObject> HoldersById = new Dictionary<string, GameObject>(StringComparer.Ordinal);
            public readonly Dictionary<(int X, int Y, int Z), string> FencesByCell = new Dictionary<(int X, int Y, int Z), string>();
            public readonly Dictionary<OutdoorChunkKey, StationInstancedPrefabChunk> InstancedChunks =
                new Dictionary<OutdoorChunkKey, StationInstancedPrefabChunk>();
            public readonly Dictionary<string, OutdoorChunkKey> ModuleToChunk =
                new Dictionary<string, OutdoorChunkKey>(StringComparer.Ordinal);
            public readonly HashSet<(int Band, string ViewKey)> BatchedGroups = new HashSet<(int Band, string ViewKey)>();

            public void Dispose() {
                foreach (var chunk in InstancedChunks.Values) {
                    if (chunk == null) continue;
                    for (int i = 0; i < chunk.ProxyMeshes.Count; i++) {
                        var mesh = chunk.ProxyMeshes[i];
                        if (mesh == null) continue;
                        if (Application.isPlaying) UnityEngine.Object.Destroy(mesh);
                        else UnityEngine.Object.DestroyImmediate(mesh);
                    }
                    chunk.ProxyMeshes.Clear();
                }
                InstancedChunks.Clear();
                ModuleToChunk.Clear();
                BatchedGroups.Clear();
                Templates?.Dispose();
                Templates = null;
            }
        }

        sealed class StagedOutdoorDelta : IStationLocalRendererStage {
            readonly OutdoorWorldState state;
            readonly HashSet<string> retiredIndividualIds;
            readonly List<(ModuleFacts Module, GameObject Holder, GameObject Instance)> stagedIndividual;
            readonly List<OutdoorChunkKey> dirtyChunks;
            readonly Dictionary<OutdoorChunkKey, StationInstancedPrefabChunk> stagedChunks;
            readonly HashSet<string> removedFenceIds;
            readonly List<ModuleFacts> addedOrUpdatedFences;
            readonly StationIndex prevIndex;
            bool committed;

            public StagedOutdoorDelta(
                OutdoorWorldState state,
                HashSet<string> retiredIndividualIds,
                List<(ModuleFacts Module, GameObject Holder, GameObject Instance)> stagedIndividual,
                List<OutdoorChunkKey> dirtyChunks,
                Dictionary<OutdoorChunkKey, StationInstancedPrefabChunk> stagedChunks,
                HashSet<string> removedFenceIds,
                List<ModuleFacts> addedOrUpdatedFences,
                StationIndex prevIndex) {
                this.state = state;
                this.retiredIndividualIds = retiredIndividualIds;
                this.stagedIndividual = stagedIndividual;
                this.dirtyChunks = dirtyChunks;
                this.stagedChunks = stagedChunks;
                this.removedFenceIds = removedFenceIds;
                this.addedOrUpdatedFences = addedOrUpdatedFences;
                this.prevIndex = prevIndex;
            }

            public void Commit(StationWorldView world, StationLocalViewCommit commit) {
                committed = true;
                if (retiredIndividualIds.Count > 0) {
                    world.RetireRecordsWhere(rec => rec.Role == RoleName && retiredIndividualIds.Contains(rec.ModuleId), commit);
                    foreach (var id in retiredIndividualIds) {
                        if (state.HoldersById.TryGetValue(id, out var oldHolder)) {
                            state.HoldersById.Remove(id);
                            if (oldHolder != null) commit.RetiredViews.Add(oldHolder);
                        }
                    }
                }
                if (removedFenceIds != null) {
                    foreach (var id in removedFenceIds) {
                        if (prevIndex != null && prevIndex.TryGetModule(id, out var oldMod) &&
                            oldMod != null && oldMod.Type == "fence") {
                            var cellKey = (oldMod.X, oldMod.Y, oldMod.Z);
                            if (state.FencesByCell.TryGetValue(cellKey, out var curId) &&
                                string.Equals(curId, id, StringComparison.Ordinal)) {
                                state.FencesByCell.Remove(cellKey);
                            }
                        }
                    }
                }

                var roleRoot = world.RoleRoot(RoleName);
                if (dirtyChunks != null && dirtyChunks.Count > 0) {
                    for (int i = 0; i < dirtyChunks.Count; i++) {
                        var ck = dirtyChunks[i];
                        if (state.InstancedChunks.TryGetValue(ck, out var oldChunk)) {
                            foreach (var id in oldChunk.ModuleIds) state.ModuleToChunk.Remove(id);
                            oldChunk.RetireFrom(world, state.Drawer, commit);
                            state.InstancedChunks.Remove(ck);
                        }
                        if (stagedChunks != null && stagedChunks.TryGetValue(ck, out var newChunk) && newChunk.Views.Count > 0) {
                            for (int v = 0; v < newChunk.Views.Count; v++) {
                                newChunk.Views[v].transform.SetParent(roleRoot, false);
                            }
                            if (state.Drawer != null) {
                                for (int b = 0; b < newChunk.Batches.Count; b++) state.Drawer.Add(newChunk.Batches[b]);
                            }
                            for (int r = 0; r < newChunk.Records.Count; r++) {
                                world.AddLocalRecord(newChunk.Records[r], commit);
                            }
                            foreach (var id in newChunk.ModuleIds) state.ModuleToChunk[id] = ck;
                            state.InstancedChunks[ck] = newChunk;
                        }
                    }
                }

                for (int i = 0; i < stagedIndividual.Count; i++) {
                    var (module, holder, instance) = stagedIndividual[i];
                    holder.transform.SetParent(roleRoot, false);
                    state.HoldersById[module.Id] = holder;
                    world.AddLocalRecord(new StationViewRecord {
                        Role = RoleName,
                        ModuleId = module.Id,
                        View = instance,
                        LevelMin = module.Z,
                        LevelMax = module.Z + 1,
                    }, commit);
                }

                if (addedOrUpdatedFences != null) {
                    for (int i = 0; i < addedOrUpdatedFences.Count; i++) {
                        var m = addedOrUpdatedFences[i];
                        if (m != null && m.Type == "fence") state.FencesByCell[(m.X, m.Y, m.Z)] = m.Id;
                    }
                }
            }

            public void Dispose() {
                if (committed) return;
                for (int i = 0; i < stagedIndividual.Count; i++) {
                    if (stagedIndividual[i].Holder != null) StationWorldView.DestroyView(stagedIndividual[i].Holder);
                }
                stagedIndividual.Clear();
                if (stagedChunks != null) {
                    foreach (var chunk in stagedChunks.Values) chunk?.DestroyUncommitted();
                    stagedChunks.Clear();
                }
            }
        }

        readonly List<OutdoorWorldState> states = new List<OutdoorWorldState>();

        OutdoorWorldState StateOf(StationWorldView world) {
            for (int i = states.Count - 1; i >= 0; i--) {
                if (states[i].World == world) return states[i];
            }
            return null;
        }

        void Purge() {
            for (int i = states.Count - 1; i >= 0; i--) {
                if (states[i].World == null || states[i].World.IsDisposed) {
                    states[i].Dispose();
                    states.RemoveAt(i);
                }
            }
        }

        public void Build(StationViewBuildContext context) {
            Purge();
            var state = new OutdoorWorldState { World = context.World };
            states.Add(state);
            if (context.Catalogue == null) {
                context.ReportUnresolved("missing-asset", "renderer", Role, "No RuntimeCatalogue on the station host.");
                return;
            }
            var records = context.Document.Modules;
            var facts = new ModuleFacts[records.Count];
            for (int i = 0; i < facts.Length; i++) facts[i] = records[i].Facts;
            var roleRoot = context.RoleRoot(Role);
            var grid = StationLevelGrid.FromDocument(context.Document.LevelBase, context.Document.StoreyHeight);
            var connections = StationFenceConnections.For(facts);
            bool canInstance = SystemInfo.supportsInstancing;

            var candidates = new List<(ModuleFacts Module, RuntimeCatalogue.Entry Entry, string ViewKey, int Band, Matrix4x4 Matrix, StationBox DocBox, StationPrefabMeshTemplate Template)>();
            var groupCounts = new Dictionary<(int Band, string ViewKey), int>();
            var fallback = new List<(ModuleFacts Module, OutdoorNeighbours Neighbours)>();

            for (int i = 0; i < facts.Length; i++) {
                var module = facts[i];
                if (module == null || !OutdoorModuleViews.Owns(module.Type)) continue;
                var neighbours = OutdoorModuleViews.Neighbours(module, connections);
                if (canInstance) {
                    var visual = ModuleViews.Resolve(module, facts, context.Catalogue);
                    if (visual.HasModel && context.Catalogue.TryGet(visual.Key, out var entry) && entry.prefab != null &&
                        OutdoorModuleViews.TryResolveStaticPose(module, entry, neighbours, out var pos, out var rot, out var scale) &&
                        state.Templates.TryGetTemplate(entry.prefab, out var template)) {
                        int band = StationModuleLevels.Band(grid, module.Z);
                        var worldMatrix = Matrix4x4.TRS(pos, rot, scale);
                        if (!template.TryDocumentBounds(worldMatrix, out var docBox)) {
                            docBox = new StationBox(module.X, module.Y, module.Z, module.X + Math.Max(1, module.Width), module.Y + Math.Max(1, module.Depth), module.Z + 1);
                        }
                        candidates.Add((module, entry, visual.Key, band, worldMatrix, docBox, template));
                        var gk = (band, visual.Key);
                        groupCounts.TryGetValue(gk, out int c);
                        groupCounts[gk] = c + 1;
                        continue;
                    }
                }
                fallback.Add((module, neighbours));
            }

            foreach (var kv in groupCounts) {
                if (kv.Value >= BatchThreshold) state.BatchedGroups.Add(kv.Key);
            }

            if (state.BatchedGroups.Count > 0) {
                state.Drawer = StationInstancedSurfaceDrawer.EnsureFor(context.Root);
                var chunkItems = new Dictionary<OutdoorChunkKey, (StationPrefabMeshTemplate Template, List<StationStaticPrefabItem> Items)>();
                for (int i = 0; i < candidates.Count; i++) {
                    var c = candidates[i];
                    if (!state.BatchedGroups.Contains((c.Band, c.ViewKey))) {
                        fallback.Add((c.Module, OutdoorModuleViews.Neighbours(c.Module, connections)));
                        continue;
                    }
                    var ck = new OutdoorChunkKey(c.Band, ChunkCoord(c.Module.X), ChunkCoord(c.Module.Y), c.ViewKey);
                    if (!chunkItems.TryGetValue(ck, out var entryList)) {
                        entryList = (c.Template, new List<StationStaticPrefabItem>());
                        chunkItems[ck] = entryList;
                    }
                    entryList.Items.Add(new StationStaticPrefabItem(c.Module.Id, c.Matrix, c.DocBox));
                    if (c.Module.Type == "fence" && !string.IsNullOrEmpty(c.Module.Id)) {
                        state.FencesByCell[(c.Module.X, c.Module.Y, c.Module.Z)] = c.Module.Id;
                    }
                }
                foreach (var kv in chunkItems) {
                    var ck = kv.Key;
                    var chunk = StationInstancedPrefabChunk.Build(
                        RoleName,
                        ck.Label(),
                        kv.Value.Template,
                        state.Templates,
                        roleRoot,
                        kv.Value.Items,
                        ck.Band,
                        ck.Band,
                        new[] { ck.Band });
                    chunk.RegisterInto(context.World, state.Drawer);
                    state.InstancedChunks[ck] = chunk;
                    foreach (var id in chunk.ModuleIds) state.ModuleToChunk[id] = ck;
                }
            } else {
                for (int i = 0; i < candidates.Count; i++) {
                    fallback.Add((candidates[i].Module, OutdoorModuleViews.Neighbours(candidates[i].Module, connections)));
                }
            }

            for (int i = 0; i < fallback.Count; i++) {
                var (module, neighbours) = fallback[i];
                BuildSingleOutdoor(context, state, roleRoot, facts, module, neighbours);
            }
        }

        void BuildSingleOutdoor(
            StationViewBuildContext context,
            OutdoorWorldState state,
            Transform roleRoot,
            ModuleFacts[] station,
            ModuleFacts module,
            OutdoorNeighbours neighbours) {
            var visual = ModuleViews.Resolve(module, station, context.Catalogue);
            if (!visual.HasModel) {
                context.ReportUnresolved("outdoor", module.Type, module.Id,
                    "unresolved:" + (visual.Detail.Length > 0 ? visual.Detail : "no-view"));
                return;
            }
            if (!context.Catalogue.TryGet(visual.Key, out var entry) || entry.prefab == null) {
                context.ReportUnresolved("outdoor", module.Type, module.Id, "unresolved:no-prefab:" + visual.Key);
                return;
            }
            var holder = new GameObject(string.IsNullOrEmpty(module.Id) ? "outdoor pivot" : module.Id + " pivot");
            holder.transform.SetParent(roleRoot, false);
            holder.transform.SetPositionAndRotation(ModulePlacement.Position(module, entry), ModulePlacement.Rotation(module.Rotation));
            var request = new OutdoorModuleRequest {
                ModuleId = module.Id,
                Type = module.Type,
                ViewKey = visual.Key,
                Variant = module.Config.Text("variant"),
                Mount = module.Config.Text("mount"),
                ConfigJson = "",
                DimensionsJson = module.Width + "x" + module.Depth,
                X = module.X, Y = module.Y, Z = module.Z,
                Rotation = module.Rotation,
                Width = module.Width, Depth = module.Depth,
                Prefab = entry.prefab,
                Catalogue = context.Catalogue,
                Placement = OutdoorPlacement.ParentPlaced,
                Neighbours = neighbours,
            };
            if (!OutdoorModuleViews.TryBuild(request, holder.transform, null, out var view)) {
                context.ReportUnresolved("outdoor", module.Type, module.Id, view.Diagnostic);
                StationWorldView.DestroyView(holder);
                return;
            }
            StationRigidModelLods.Apply(view.Instance, entry.prefab.name);
            context.World.RegisterModule(Role, module.Id, view.Instance, "", null, module.Z, module.Z + 1);
            if (!string.IsNullOrEmpty(module.Id) && view.Instance != null) {
                state.HoldersById[module.Id] = holder;
                if (module.Type == "fence") state.FencesByCell[(module.X, module.Y, module.Z)] = module.Id;
            }
        }

        static bool AffectsFenceConnectivity(string type) =>
            type == "fence" || type == "gate" || type == "stair" || type == "escalator" || type == "walkway";

        static void MarkAdjacentFences(
            OutdoorWorldState state,
            StationModuleRecord module,
            HashSet<string> removedIds,
            HashSet<string> dirtyIds,
            StationIndex nextIndex) {
            if (module == null) return;
            void MarkNeighbours(int cx, int cy, int cz) {
                for (int dy = -1; dy <= 1; dy++) {
                    for (int dx = -1; dx <= 1; dx++) {
                        if (Math.Abs(dx) + Math.Abs(dy) > 1) continue;
                        if (state.FencesByCell.TryGetValue((cx + dx, cy + dy, cz), out var fid) &&
                            !removedIds.Contains(fid) && nextIndex.TryGetModule(fid, out _)) {
                            dirtyIds.Add(fid);
                        }
                    }
                }
            }
            if (module.Type == "escalator" || module.Type == "walkway") {
                foreach (var pt in StationRunGeometry.EscalatorLandings(module.Facts)) {
                    if (pt.IsCell) MarkNeighbours((int)Math.Round(pt.X), (int)Math.Round(pt.Y), (int)Math.Round(pt.Z));
                }
                return;
            }
            if (module.Type == "stair" && !module.Config.Bool("block")) {
                var flights = StationRunGeometry.StairFlights(module.Facts);
                var slides = StationRunGeometry.StairFlightSlides(module.Facts, flights);
                double width = StationRunGeometry.StairTreadWidth(module.Facts);
                for (int i = 0; i < flights.Count; i++) {
                    var f = flights[i];
                    double rdx = f.To.X - f.From.X, rdy = f.To.Y - f.From.Y;
                    if (rdx == 0 && rdy == 0) {
                        if (f.From.IsCell) MarkNeighbours((int)Math.Round(f.From.X), (int)Math.Round(f.From.Y), (int)Math.Round(f.From.Z));
                        continue;
                    }
                    var slide = i < slides.Count ? slides[i] : default;
                    bool acrossX = Math.Abs(rdx) < Math.Abs(rdy);
                    void MarkBand(StationRunPoint p) {
                        if (!p.IsCell) return;
                        int pz = (int)Math.Round(p.Z);
                        if (acrossX) {
                            double c = p.X + 0.5 + slide.X;
                            int lo = (int)Math.Floor(c - width / 2 + 1e-9);
                            int hi = (int)Math.Ceiling(c + width / 2 - 1e-9) - 1;
                            int py = (int)Math.Round(p.Y);
                            for (int x = lo; x <= hi; x++) MarkNeighbours(x, py, pz);
                        } else {
                            double c = p.Y + 0.5 + slide.Y;
                            int lo = (int)Math.Floor(c - width / 2 + 1e-9);
                            int hi = (int)Math.Ceiling(c + width / 2 - 1e-9) - 1;
                            int px = (int)Math.Round(p.X);
                            for (int y = lo; y <= hi; y++) MarkNeighbours(px, y, pz);
                        }
                    }
                    MarkBand(f.From);
                    MarkBand(f.To);
                }
                return;
            }
            int x0 = module.X - 1, x1 = module.X + Math.Max(1, module.Width);
            int y0 = module.Y - 1, y1 = module.Y + Math.Max(1, module.Depth);
            int z0 = module.Z;
            for (int y = y0; y <= y1; y++) {
                for (int x = x0; x <= x1; x++) {
                    if (state.FencesByCell.TryGetValue((x, y, z0), out var fid) &&
                        !removedIds.Contains(fid) && nextIndex.TryGetModule(fid, out _)) {
                        dirtyIds.Add(fid);
                    }
                }
            }
        }

        public bool TryStageLocalDelta(
            StationLocalDeltaContext context,
            out IStationLocalRendererStage stage,
            out string fallbackReason) {
            stage = null;
            fallbackReason = null;
            var state = StateOf(context.World);
            if (state == null) {
                fallbackReason = "no-outdoor-state";
                return false;
            }
            if (context.TouchedModuleIds.Count == 0) return true;

            var removedIds = new HashSet<string>(StringComparer.Ordinal);
            var dirtyIds = new HashSet<string>(StringComparer.Ordinal);
            var delta = context.Delta;

            for (int i = 0; i < delta.RemovedModules.Count; i++) {
                var id = delta.RemovedModules[i];
                if (!context.PrevIndex.TryGetModule(id, out var oldMod) || oldMod == null) continue;
                if (OutdoorModuleViews.Owns(oldMod.Type)) removedIds.Add(id);
                if (AffectsFenceConnectivity(oldMod.Type)) {
                    MarkAdjacentFences(state, oldMod, removedIds, dirtyIds, context.NextIndex);
                }
            }
            for (int i = 0; i < delta.ChangedModules.Count; i++) {
                var mod = delta.ChangedModules[i];
                if (mod == null) continue;
                if (OutdoorModuleViews.Owns(mod.Type)) dirtyIds.Add(mod.Id);
                if (AffectsFenceConnectivity(mod.Type)) {
                    MarkAdjacentFences(state, mod, removedIds, dirtyIds, context.NextIndex);
                    if (context.PrevIndex.TryGetModule(mod.Id, out var prevMod) && prevMod != null) {
                        MarkAdjacentFences(state, prevMod, removedIds, dirtyIds, context.NextIndex);
                    }
                }
            }

            if (removedIds.Count == 0 && dirtyIds.Count == 0) return true;

            var catalogue = context.World.Catalogue;
            if (dirtyIds.Count > 0 && catalogue == null) {
                fallbackReason = "outdoor-no-catalogue";
                return false;
            }

            var grid = StationLevelGrid.FromDocument(context.NextDocument.LevelBase, context.NextDocument.StoreyHeight);
            var retiredIndividualIds = new HashSet<string>(StringComparer.Ordinal);
            var dirtyChunkSet = new HashSet<OutdoorChunkKey>();
            var removedFenceIds = new HashSet<string>(StringComparer.Ordinal);
            var addedOrUpdatedFences = new List<ModuleFacts>();

            foreach (var id in removedIds) {
                removedFenceIds.Add(id);
                if (state.ModuleToChunk.TryGetValue(id, out var oldChunk)) dirtyChunkSet.Add(oldChunk);
                else retiredIndividualIds.Add(id);
            }

            var fenceFacts = (dirtyIds.Count > 0 || dirtyChunkSet.Count > 0)
                ? context.GetNextFactsOfTypes("fence", "gate", "stair", "escalator", "walkway")
                : null;
            var connections = fenceFacts != null ? StationFenceConnections.For(fenceFacts) : null;

            var stagedIndividual = new List<(ModuleFacts Module, GameObject Holder, GameObject Instance)>();
            var stagedChunks = new Dictionary<OutdoorChunkKey, StationInstancedPrefabChunk>();

            try {
                foreach (var id in dirtyIds) {
                    removedFenceIds.Add(id);
                    if (state.ModuleToChunk.TryGetValue(id, out var prevChunk)) dirtyChunkSet.Add(prevChunk);
                    else if (state.HoldersById.ContainsKey(id)) retiredIndividualIds.Add(id);

                    if (!context.NextIndex.TryGetModule(id, out var record) || record == null) continue;
                    var module = record.Facts;
                    addedOrUpdatedFences.Add(module);
                    var visual = ModuleViews.Resolve(module, Array.Empty<ModuleFacts>(), catalogue);
                    if (!visual.HasModel) {
                        context.ReportUnresolved("outdoor", module.Type, module.Id,
                            "unresolved:" + (visual.Detail.Length > 0 ? visual.Detail : "no-view"));
                        continue;
                    }
                    if (!catalogue.TryGet(visual.Key, out var entry) || entry.prefab == null) {
                        context.ReportUnresolved("outdoor", module.Type, module.Id, "unresolved:no-prefab:" + visual.Key);
                        continue;
                    }
                    var neighbours = OutdoorModuleViews.Neighbours(module, connections);
                    int band = StationModuleLevels.Band(grid, module.Z);
                    if (state.BatchedGroups.Contains((band, visual.Key)) &&
                        OutdoorModuleViews.TryResolveStaticPose(module, entry, neighbours, out _, out _, out _) &&
                        state.Templates.TryGetTemplate(entry.prefab, out _)) {
                        dirtyChunkSet.Add(new OutdoorChunkKey(band, ChunkCoord(module.X), ChunkCoord(module.Y), visual.Key));
                        continue;
                    }
                    var holder = new GameObject(string.IsNullOrEmpty(module.Id) ? "outdoor pivot" : module.Id + " pivot");
                    holder.transform.SetParent(context.StagingRoot, false);
                    holder.transform.SetPositionAndRotation(ModulePlacement.Position(module, entry), ModulePlacement.Rotation(module.Rotation));
                    var request = new OutdoorModuleRequest {
                        ModuleId = module.Id,
                        Type = module.Type,
                        ViewKey = visual.Key,
                        Variant = module.Config.Text("variant"),
                        Mount = module.Config.Text("mount"),
                        ConfigJson = "",
                        DimensionsJson = module.Width + "x" + module.Depth,
                        X = module.X, Y = module.Y, Z = module.Z,
                        Rotation = module.Rotation,
                        Width = module.Width, Depth = module.Depth,
                        Prefab = entry.prefab,
                        Catalogue = catalogue,
                        Placement = OutdoorPlacement.ParentPlaced,
                        Neighbours = neighbours,
                    };
                    if (!OutdoorModuleViews.TryBuild(request, holder.transform, null, out var view)) {
                        context.ReportUnresolved("outdoor", module.Type, module.Id, view.Diagnostic);
                        StationWorldView.DestroyView(holder);
                        continue;
                    }
                    StationEditTrace.AddInstantiatedPrefab();
                    stagedIndividual.Add((module, holder, view.Instance));
                }

                var dirtyChunkList = new List<OutdoorChunkKey>(dirtyChunkSet);
                if (dirtyChunkList.Count > 0) {
                    var itemsByChunk = new Dictionary<OutdoorChunkKey, (StationPrefabMeshTemplate Template, List<StationStaticPrefabItem> Items)>();
                    var nextOutdoor = context.GetNextFactsOfTypes("fence", "tree");
                    for (int i = 0; i < nextOutdoor.Length; i++) {
                        var m = nextOutdoor[i];
                        if (m == null) continue;
                        int band = StationModuleLevels.Band(grid, m.Z);
                        int cx = ChunkCoord(m.X), cy = ChunkCoord(m.Y);
                        var visual = ModuleViews.Resolve(m, Array.Empty<ModuleFacts>(), catalogue);
                        if (!visual.HasModel) continue;
                        var ck = new OutdoorChunkKey(band, cx, cy, visual.Key);
                        if (!dirtyChunkSet.Contains(ck)) continue;
                        if (!catalogue.TryGet(visual.Key, out var entry) || entry.prefab == null) continue;
                        var neighbours = OutdoorModuleViews.Neighbours(m, connections);
                        if (!OutdoorModuleViews.TryResolveStaticPose(m, entry, neighbours, out var pos, out var rot, out var scale)) continue;
                        if (!state.Templates.TryGetTemplate(entry.prefab, out var template)) continue;
                        var worldMatrix = Matrix4x4.TRS(pos, rot, scale);
                        if (!template.TryDocumentBounds(worldMatrix, out var docBox)) {
                            docBox = new StationBox(m.X, m.Y, m.Z, m.X + Math.Max(1, m.Width), m.Y + Math.Max(1, m.Depth), m.Z + 1);
                        }
                        if (!itemsByChunk.TryGetValue(ck, out var list)) {
                            list = (template, new List<StationStaticPrefabItem>());
                            itemsByChunk[ck] = list;
                        }
                        list.Items.Add(new StationStaticPrefabItem(m.Id, worldMatrix, docBox));
                    }
                    for (int i = 0; i < dirtyChunkList.Count; i++) {
                        var ck = dirtyChunkList[i];
                        if (!itemsByChunk.TryGetValue(ck, out var builtItems) || builtItems.Items.Count == 0) continue;
                        stagedChunks[ck] = StationInstancedPrefabChunk.Build(
                            RoleName,
                            ck.Label(),
                            builtItems.Template,
                            state.Templates,
                            context.StagingRoot,
                            builtItems.Items,
                            ck.Band,
                            ck.Band,
                            new[] { ck.Band });
                    }
                }

                stage = new StagedOutdoorDelta(state, retiredIndividualIds, stagedIndividual, dirtyChunkList, stagedChunks,
                    removedFenceIds, addedOrUpdatedFences, context.PrevIndex);
                return true;
            } catch {
                for (int i = 0; i < stagedIndividual.Count; i++) {
                    if (stagedIndividual[i].Holder != null) StationWorldView.DestroyView(stagedIndividual[i].Holder);
                }
                foreach (var chunk in stagedChunks.Values) chunk?.DestroyUncommitted();
                throw;
            }
        }

        public void Release() => Purge();
    }

    /// <summary>
    /// The document half of painting (plan 11 E3). Packet E resolves and validates a
    /// `face.paint` and returns the writes it would make; this applies those writes to
    /// the committed v1 document and installs it through the host's ordinary atomic
    /// edit transaction, so a paint bumps one revision, is serialized, and can be
    /// refused without touching the station. The handler in `StationCellView` calls it
    /// for any non-empty write set.
    /// </summary>
    public static class StationPaintCommit {
        public static bool TryCommit(JObject reply, out string code) {
            code = null;
            var writes = reply?["writes"] as JArray;
            if (writes == null || writes.Count == 0) return true;
            var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            if (host == null || !host.IsLoaded) { code = "no-session"; return false; }

            var patch = new StationCellPatch();
            foreach (var token in writes) {
                if (!(token is JObject write)) continue;
                if (!(write["cell"] is JArray point) || point.Count < 3) continue;
                int x = (int)point[0], y = (int)point[1], z = (int)point[2];
                string face = (string)write["face"];
                if (string.IsNullOrEmpty(face)) continue;
                var finishToken = write["finish"];
                string finishVal = finishToken == null || finishToken.Type == JTokenType.Null ? "" : (string)finishToken;
                bool hasMat = write["materialise"] is JObject;
                bool matVoid = false;
                string matZone = null;
                List<string> matTags = null;
                if (write["materialise"] is JObject materialise) {
                    matVoid = string.Equals((string)materialise["fill"], "void", StringComparison.Ordinal);
                    if (materialise["zone"] != null && materialise["zone"].Type == JTokenType.String)
                        matZone = (string)materialise["zone"];
                    if (materialise["tags"] is JArray tagsArr) {
                        matTags = new List<string>(tagsArr.Count);
                        foreach (var t in tagsArr) {
                            if (t != null && t.Type == JTokenType.String) matTags.Add((string)t);
                        }
                    }
                }
                patch.Writes.Add(StationCellWrite.PaintFace(
                    new StationCellKey(x, y, z), face, finishVal,
                    hasMat, matVoid, matZone, matTags));
            }
            if (!patch.HasWork) return true;
            if (!StationEditSession.TryApplyCells(host, patch, "paint", null, out var result, out code)) {
                return false;
            }
            reply["requiresCommit"] = false;
            reply["revision"] = result.Revision;
            return true;
        }
    }

    /// <summary>
    /// The per-frame half of a family renderer: signal lenses and ambient vehicle
    /// poses read the committed station's clock through this sink, so the host does
    /// not need to know the road type. Registered once, like the renderers.
    /// </summary>
    sealed class RoadFrameSink : IStationFrameSink {
        public void Tick(StationDocument document, StationIndex index, StationFrameClock clock) =>
            // The presented instant, not the tick boundary: signals and ambient traffic
            // sample the shared presentation clock (RCA 14 §5.3).
            Metro.App.Views.StationRoadRenderer.Current?.Update(clock.PresentationSeconds);
    }

    /// <summary>
    /// The registration point. It runs before the first scene loads, so the host's
    /// scene needs no per-family wiring and a family added later does not edit the
    /// host. A renderer that needs a scene asset reads it from the build context.
    /// </summary>
    public static class StationFamilyRenderers {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() {
            StationRenderers.Add(new OutdoorModuleRenderer());
            // Plan 13 §3: the authored families the Zoo playtest could not see. Each claims
            // its own saved types and reports every module it cannot resolve by name.
            StationRenderers.Add(new Metro.App.Views.StationSurfaceModuleRenderer());
            StationRenderers.Add(new Metro.App.Views.StationStreetModuleRenderer());
            StationRenderers.Add(new Metro.App.Views.StationEquipmentModuleRenderer());
            StationRenderers.Add(new Metro.App.Views.StationDisplayModuleRenderer());
            // Plan 22 §1: the two structure families generated from their saved dimensions. The
            // live registry had no owner for `pillar` or `roof`, so Tanwei's 73 pillars (11 of
            // them bridge piers) and 308 roofs reported `no-renderer` and drew nothing.
            StationRenderers.Add(new Metro.App.Views.StationStructureModuleRenderer());
            StationRenderers.Add(new Metro.App.Views.StationContactShadowRenderer());
            StationRenderers.Add(new Metro.App.Views.StationGridRenderer());
            StationRenderers.Add(new Metro.App.Views.StationOverlayRenderer());
            StationFrameSinks.Add(new RoadFrameSink());
        }
    }
}
