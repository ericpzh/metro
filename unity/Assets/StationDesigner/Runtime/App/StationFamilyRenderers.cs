using System;
using System.Collections.Generic;
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

        sealed class OutdoorWorldState {
            public StationWorldView World;
            public readonly Dictionary<string, GameObject> HoldersById = new Dictionary<string, GameObject>(StringComparer.Ordinal);
            public readonly Dictionary<(int X, int Y, int Z), string> FencesByCell = new Dictionary<(int X, int Y, int Z), string>();
        }

        sealed class StagedOutdoorDelta : IStationLocalRendererStage {
            readonly OutdoorWorldState state;
            readonly HashSet<string> retiredIds;
            readonly List<(ModuleFacts Module, GameObject Holder, GameObject Instance)> staged;
            readonly StationIndex prevIndex;
            bool committed;

            public StagedOutdoorDelta(
                OutdoorWorldState state,
                HashSet<string> retiredIds,
                List<(ModuleFacts Module, GameObject Holder, GameObject Instance)> staged,
                StationIndex prevIndex) {
                this.state = state;
                this.retiredIds = retiredIds;
                this.staged = staged;
                this.prevIndex = prevIndex;
            }

            public void Commit(StationWorldView world, StationLocalViewCommit commit) {
                committed = true;
                if (retiredIds.Count > 0) {
                    world.RetireRecordsWhere(rec => rec.Role == RoleName && retiredIds.Contains(rec.ModuleId), commit);
                    foreach (var id in retiredIds) {
                        if (state.HoldersById.TryGetValue(id, out var oldHolder)) {
                            state.HoldersById.Remove(id);
                            if (oldHolder != null) commit.RetiredViews.Add(oldHolder);
                        }
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
                for (int i = 0; i < staged.Count; i++) {
                    var (module, holder, instance) = staged[i];
                    holder.transform.SetParent(roleRoot, false);
                    state.HoldersById[module.Id] = holder;
                    if (module.Type == "fence") state.FencesByCell[(module.X, module.Y, module.Z)] = module.Id;
                    world.AddLocalRecord(new StationViewRecord {
                        Role = RoleName,
                        ModuleId = module.Id,
                        View = instance,
                        LevelMin = module.Z,
                        LevelMax = module.Z + 1,
                    }, commit);
                }
            }

            public void Dispose() {
                if (committed) return;
                for (int i = 0; i < staged.Count; i++) {
                    if (staged[i].Holder != null) StationWorldView.DestroyView(staged[i].Holder);
                }
                staged.Clear();
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
                if (states[i].World == null || states[i].World.IsDisposed) states.RemoveAt(i);
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
            OutdoorModuleViews.BuildAll(facts, context.Catalogue, roleRoot,
                (module, view) => {
                    context.World.RegisterModule(Role, module.Id, view.Instance, "", null, module.Z, module.Z + 1);
                    if (!string.IsNullOrEmpty(module.Id) && view.Instance != null) {
                        var holder = view.Instance.transform.parent != null && view.Instance.transform.parent != roleRoot
                            ? view.Instance.transform.parent.gameObject
                            : view.Instance;
                        state.HoldersById[module.Id] = holder;
                        if (module.Type == "fence") state.FencesByCell[(module.X, module.Y, module.Z)] = module.Id;
                    }
                },
                (module, diagnostic) => context.ReportUnresolved("outdoor", module.Type, module.Id, diagnostic));
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
            int x0 = module.X - 1, x1 = module.X + Math.Max(1, module.Width);
            int y0 = module.Y - 1, y1 = module.Y + Math.Max(1, module.Depth);
            int z0 = module.Z, z1 = module.Z;
            if (module.From.HasValue) {
                var f = module.From.Value;
                x0 = Math.Min(x0, (int)Math.Floor(f.X) - 1); x1 = Math.Max(x1, (int)Math.Ceiling(f.X) + 1);
                y0 = Math.Min(y0, (int)Math.Floor(f.Y) - 1); y1 = Math.Max(y1, (int)Math.Ceiling(f.Y) + 1);
                z0 = Math.Min(z0, (int)Math.Round(f.Z)); z1 = Math.Max(z1, (int)Math.Round(f.Z));
            }
            if (module.To.HasValue) {
                var t = module.To.Value;
                x0 = Math.Min(x0, (int)Math.Floor(t.X) - 1); x1 = Math.Max(x1, (int)Math.Ceiling(t.X) + 1);
                y0 = Math.Min(y0, (int)Math.Floor(t.Y) - 1); y1 = Math.Max(y1, (int)Math.Ceiling(t.Y) + 1);
                z0 = Math.Min(z0, (int)Math.Round(t.Z)); z1 = Math.Max(z1, (int)Math.Round(t.Z));
            }
            for (int y = y0; y <= y1; y++) {
                for (int x = x0; x <= x1; x++) {
                    if (state.FencesByCell.TryGetValue((x, y, z0), out var fid) &&
                        !removedIds.Contains(fid) && nextIndex.TryGetModule(fid, out _)) {
                        dirtyIds.Add(fid);
                    }
                    if (z1 != z0 && state.FencesByCell.TryGetValue((x, y, z1), out var fid2) &&
                        !removedIds.Contains(fid2) && nextIndex.TryGetModule(fid2, out _)) {
                        dirtyIds.Add(fid2);
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

            var retiredIds = new HashSet<string>(removedIds, StringComparer.Ordinal);
            var staged = new List<(ModuleFacts Module, GameObject Holder, GameObject Instance)>(dirtyIds.Count);
            var fenceFacts = dirtyIds.Count > 0 && string.Equals(Role, "fences", StringComparison.Ordinal)
                ? context.GetNextFactsOfTypes("fence", "gate")
                : null;
            var connections = fenceFacts != null ? StationFenceConnections.For(fenceFacts) : null;

            try {
                foreach (var id in dirtyIds) {
                    retiredIds.Add(id);
                    if (!context.NextIndex.TryGetModule(id, out var record) || record == null) continue;
                    var module = record.Facts;
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
                        Neighbours = OutdoorModuleViews.Neighbours(module, connections),
                    };
                    if (!OutdoorModuleViews.TryBuild(request, holder.transform, null, out var view)) {
                        context.ReportUnresolved("outdoor", module.Type, module.Id, view.Diagnostic);
                        StationWorldView.DestroyView(holder);
                        continue;
                    }
                    StationEditTrace.AddInstantiatedPrefab();
                    staged.Add((module, holder, view.Instance));
                }
                stage = new StagedOutdoorDelta(state, retiredIds, staged, context.PrevIndex);
                return true;
            } catch {
                for (int i = 0; i < staged.Count; i++) {
                    if (staged[i].Holder != null) StationWorldView.DestroyView(staged[i].Holder);
                }
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
            StationRenderers.Add(new Metro.App.Views.StationGridRenderer());
            StationRenderers.Add(new Metro.App.Views.StationOverlayRenderer());
            StationFrameSinks.Add(new RoadFrameSink());
        }
    }
}
