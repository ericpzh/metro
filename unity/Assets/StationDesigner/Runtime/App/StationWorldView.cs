using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using Metro.Build;
using Metro.App.Views;
using Metro.View;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// One renderer family (cells, modules, signs, roads, actors, trains, …). A
    /// renderer is registered once — by its own file via
    /// <see cref="StationRenderers.Add"/> or by the host — and the host calls
    /// <see cref="Build"/> into a **staged** root on every station install. Throwing
    /// from Build refuses that install and leaves the previous station in place.
    /// </summary>
    public interface IStationViewRenderer {
        /// <summary>Stable role id ("cells", "modules", "signs", "roads", …).</summary>
        string Role { get; }
        void Build(StationViewBuildContext context);
        /// <summary>Drop materials, textures and subscriptions created for the last build.</summary>
        void Release();
    }

    /// <summary>The scene's shared assets, copied from <see cref="StationGameHost"/> before any renderer builds.</summary>
    public sealed class StationViewAssets {
        public RuntimeCatalogue Catalogue;
        public TrainCatalogue TrainCatalogue;
        public Shader Shader;
        public Font Font;
    }

    /// <summary>What a renderer is given: the committed document, its index, the staged root and the scene assets.</summary>
    public sealed class StationViewBuildContext {
        readonly StationWorldView world;
        internal StationViewBuildContext(StationWorldView world, Action<string> markLoad) {
            this.world = world;
            MarkLoad = markLoad;
        }
        internal Action<string> MarkLoad { get; }
        public StationDocument Document => world.Document;
        public StationIndex Index => world.Index;
        public StationWorldView World => world;
        /// <summary>The staged station root. It is inactive until commit; parent parts here.</summary>
        public Transform Root => world.Root;
        public Transform RoleRoot(string role) => world.RoleRoot(role);
        /// <summary>The runtime prefab catalogue the scene serialized; null only in a bare test scene.</summary>
        public RuntimeCatalogue Catalogue => world.Catalogue;
        public TrainCatalogue TrainCatalogue => world.TrainCatalogue;
        public Shader Shader => world.Shader;
        public Font Font => world.Font;
        public void ReportUnresolved(string code, string recordType, string recordId, string message) =>
            world.ReportUnresolved(code, recordType, recordId, message);
    }

    /// <summary>
    /// Maps a contiguous run of triangles in a combined batch mesh back to one entry in
    /// <see cref="StationViewRecord.SourceIds"/> (`[StartTriangle, StartTriangle + TriangleCount)`).
    /// </summary>
    public readonly struct StationBatchSpan {
        public readonly int SourceIndex;
        public readonly int StartTriangle;
        public readonly int TriangleCount;

        public StationBatchSpan(int sourceIndex, int startTriangle, int triangleCount) {
            SourceIndex = sourceIndex;
            StartTriangle = startTriangle;
            TriangleCount = triangleCount;
        }
    }

    /// <summary>One pickable/visible record: a module view, a cell view or a named part.</summary>
    public sealed class StationViewRecord {
        public string Role = "";
        public string ModuleId = "";
        public string CellKey = "";
        public string Part = "";
        public GameObject View;
        /// <summary>Document-axis bounds when the renderer knows them; otherwise empty.</summary>
        public StationBox Bounds;
        public bool HasBounds;
        public int LevelMin;
        public int LevelMax;
        /// <summary>
        /// Explicit source storey bands this record belongs to (a wall panel's envelope
        /// midpoint, a run's two landings, a multi-storey shaft). Null means the view
        /// derives them from the committed module/cell itself — bounds are **not** a
        /// storey membership input (RCA 14 §1/§3).
        /// </summary>
        public int[] LevelBands;
        /// <summary>
        /// Stable authored ids this view draws when it is a combined batch. A batched
        /// surface owns its own transform, so its record cannot be addressed by one
        /// module id; the ids it was combined from are kept here for probes and the
        /// binding report (RCA 14 §3.3).
        /// </summary>
        public string[] SourceIds;
        /// <summary>
        /// The per-module document bounds of a combined batch, parallel to
        /// <see cref="SourceIds"/>. The batch owns one GameObject, but a pick must still
        /// resolve the exact authored tile under the ray, not the whole chunk, and the
        /// selection/delete path must address that tile's own record.
        /// </summary>
        public StationBox[] SourceBounds;
        /// <summary>
        /// Per-tile triangle ranges in the combined batch mesh, referencing indices in
        /// <see cref="SourceIds"/> so triangle-accurate picking resolves the exact tile hit.
        /// </summary>
        public StationBatchSpan[] SourceSpans;
        /// <summary>
        /// Independent **grade** membership (20 §4): the producer's own answer to "is this part
        /// owned by the authored 0 m ground datum?". It is deliberately separate from
        /// <see cref="Role"/>, which still has to answer 隐藏墙壁 / 隐藏屋顶 / the storey slice — a
        /// 0 m fence is a 栏杆 for every other view tool and grade furniture only for
        /// 隐藏地面. A combined batch sets it from the exact module elevation it was grouped by,
        /// so a mixed chunk cannot be classified by a bounding box that happens to cross 0 m.
        /// </summary>
        public bool GradeOwned;
        /// <summary>Why the record is (or is not) grade furniture, for diagnostics.</summary>
        public string GradeNote = "";
        public override string ToString() =>
            Role + " " + (ModuleId.Length > 0 ? "module " + ModuleId : "cell " + CellKey) + (Part.Length > 0 ? " part " + Part : "");
    }

    /// <summary>What one built world contains, for the load result and diagnostics.</summary>
    public sealed class StationViewSummary {
        readonly Dictionary<string, int> byRole;
        public StationViewSummary(Dictionary<string, int> byRole, int moduleRecords, int cellRecords, int unresolved) {
            this.byRole = byRole ?? new Dictionary<string, int>(StringComparer.Ordinal);
            ModuleRecords = moduleRecords;
            CellRecords = cellRecords;
            Unresolved = unresolved;
        }
        public IReadOnlyDictionary<string, int> ByRole => new ReadOnlyDictionary<string, int>(byRole);
        public int ModuleRecords { get; }
        public int CellRecords { get; }
        public int Unresolved { get; }
        public override string ToString() {
            var parts = new List<string>();
            foreach (var pair in byRole) parts.Add(pair.Key + "=" + pair.Value);
            return "roles(" + string.Join(",", parts) + ") modules=" + ModuleRecords + " cells=" + CellRecords + " unresolved=" + Unresolved;
        }
    }

    /// <summary>Thrown when a renderer fails to build the candidate world.</summary>
    public sealed class StationViewBuildException : Exception {
        public StationViewBuildException(string role, Exception inner) : base("Station renderer '" + role + "' failed: " + inner.Message, inner) {
            Role = role;
        }
        public string Role { get; }
    }

    /// <summary>
    /// Summary of the scene objects retired, added, and updated by a retained local world commit.
    /// </summary>
    public sealed class StationLocalViewCommit {
        public readonly List<StationViewRecord> RetiredRecords = new List<StationViewRecord>();
        public readonly List<GameObject> RetiredViews = new List<GameObject>();
        public readonly List<Mesh> RetiredMeshes = new List<Mesh>();
        public readonly List<IStationVisibilityTarget> RetiredTargets = new List<IStationVisibilityTarget>();
        public readonly List<StationViewRecord> AddedRecords = new List<StationViewRecord>();
        public readonly List<StationViewRecord> UpdatedRecords = new List<StationViewRecord>();
    }

    /// <summary>
    /// Shared read-only context passed to <see cref="IStationLocalViewRenderer.TryStageLocalDelta"/>
    /// during a retained world update.
    /// </summary>
    public sealed class StationLocalDeltaContext {
        ModuleFacts[] nextStationFacts;
        StationCeilingMounts nextCeilingMounts;

        internal StationLocalDeltaContext(
            StationWorldView world,
            StationDocument prevDoc,
            StationIndex prevIndex,
            StationDocument nextDoc,
            StationIndex nextIndex,
            StationIndexDelta delta,
            Transform stagingRoot) {
            World = world;
            PrevDocument = prevDoc;
            PrevIndex = prevIndex;
            NextDocument = nextDoc;
            NextIndex = nextIndex;
            Delta = delta;
            StagingRoot = stagingRoot;
            CellsChanged = delta.RemovedCells.Count > 0 || delta.ChangedCells.Count > 0;

            TouchedModuleIds = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < delta.RemovedModules.Count; i++) {
                if (!string.IsNullOrEmpty(delta.RemovedModules[i])) TouchedModuleIds.Add(delta.RemovedModules[i]);
            }
            for (int i = 0; i < delta.ChangedModules.Count; i++) {
                if (delta.ChangedModules[i] != null && !string.IsNullOrEmpty(delta.ChangedModules[i].Id)) {
                    TouchedModuleIds.Add(delta.ChangedModules[i].Id);
                }
            }

            TouchedColumns = new HashSet<long>();
            for (int i = 0; i < delta.RemovedCells.Count; i++) {
                var k = delta.RemovedCells[i];
                TouchedColumns.Add(PackColumn(k.X, k.Y));
            }
            for (int i = 0; i < delta.ChangedCells.Count; i++) {
                var c = delta.ChangedCells[i];
                TouchedColumns.Add(PackColumn(c.X, c.Y));
            }
        }

        public StationWorldView World { get; }
        public StationDocument PrevDocument { get; }
        public StationIndex PrevIndex { get; }
        public StationDocument NextDocument { get; }
        public StationIndex NextIndex { get; }
        public StationIndexDelta Delta { get; }
        public Transform StagingRoot { get; }
        public bool CellsChanged { get; }
        public HashSet<string> TouchedModuleIds { get; }
        public HashSet<long> TouchedColumns { get; }
        public List<StationDiagnostic> Diagnostics { get; } = new List<StationDiagnostic>();

        public static long PackColumn(int x, int y) => ((long)(x + 32768) << 20) | (uint)(y + 32768);

        public ModuleFacts[] GetNextStationFacts() {
            if (nextStationFacts != null) return nextStationFacts;
            var modules = NextDocument.Modules;
            nextStationFacts = new ModuleFacts[modules.Count];
            for (int i = 0; i < nextStationFacts.Length; i++) nextStationFacts[i] = modules[i].Facts;
            return nextStationFacts;
        }

        public ModuleFacts[] GetNextFactsOfTypes(params string[] types) {
            if (NextIndex == null || types == null || types.Length == 0) return Array.Empty<ModuleFacts>();
            int total = 0;
            for (int t = 0; t < types.Length; t++) total += NextIndex.ModulesOfType(types[t]).Count;
            if (total == 0) return Array.Empty<ModuleFacts>();
            var arr = new ModuleFacts[total];
            int k = 0;
            for (int t = 0; t < types.Length; t++) {
                var list = NextIndex.ModulesOfType(types[t]);
                for (int i = 0; i < list.Count; i++) {
                    var rec = list[i];
                    if (rec?.Facts != null) arr[k++] = rec.Facts;
                }
            }
            if (k < arr.Length) Array.Resize(ref arr, k);
            return arr;
        }

        public StationCeilingMounts GetNextCeilingMounts() =>
            nextCeilingMounts ??= StationCeilingMounts.ForIndex(NextIndex);

        public void ReportUnresolved(string code, string recordType, string recordId, string message) {
            Diagnostics.Add(new StationDiagnostic(code ?? "unresolved", StationDiagnosticSeverity.Warning,
                recordType ?? "", recordId ?? "", message ?? ""));
        }
    }

    /// <summary>One renderer family's staged local update; Dispose rolls back if Commit was not called.</summary>
    public interface IStationLocalRendererStage : IDisposable {
        void Commit(StationWorldView world, StationLocalViewCommit commit);
    }

    /// <summary>
    /// Optional retained-update seam implemented by production <see cref="IStationViewRenderer"/>s.
    /// Returning false causes <see cref="StationWorldView.StageLocalWorld"/> to abort all staged
    /// renderers and fall back cleanly to a full candidate world build.
    /// </summary>
    public interface IStationLocalViewRenderer {
        bool TryStageLocalDelta(
            StationLocalDeltaContext context,
            out IStationLocalRendererStage stage,
            out string fallbackReason);
    }

    /// <summary>
    /// The renderer registry of one station world. It is built **staged** (inactive)
    /// and only activated when the load transaction commits, so a render failure
    /// cannot show half a station. It also owns the pick/visibility records: a
    /// renderer registers each module/cell view by stable id, never by object name.
    /// </summary>
    public sealed class StationWorldView : IDisposable {
        /// <summary>Test seam: inject an exception before staging a named renderer role on the local path.</summary>
        public static Func<string, Exception> LocalStageFailureInjector;

        readonly List<IStationViewRenderer> renderers;
        readonly List<StationViewRecord> records = new List<StationViewRecord>();
        readonly List<StationDiagnostic> unresolved = new List<StationDiagnostic>();
        readonly Dictionary<string, Transform> roleRoots = new Dictionary<string, Transform>(StringComparer.Ordinal);
        readonly Dictionary<string, int> roleCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        readonly Dictionary<string, bool> roleVisibility = new Dictionary<string, bool>(StringComparer.Ordinal);
        readonly HashSet<StationVisibilityTarget> runtimeTargets = new HashSet<StationVisibilityTarget>();
        readonly GameObject rootObject;
        Dictionary<string, StationModuleRecord> modulesById;
        StationVisibilityRegistry visibility;
        StationDocument document;
        StationIndex index;
        bool activated;

        public StationWorldView(Transform parent, string name, IEnumerable<IStationViewRenderer> renderers) : this(parent, name, renderers, null) { }

        public StationWorldView(Transform parent, string name, IEnumerable<IStationViewRenderer> renderers, StationViewAssets assets) {
            this.renderers = new List<IStationViewRenderer>(renderers ?? Array.Empty<IStationViewRenderer>());
            Assets = assets ?? new StationViewAssets();
            rootObject = new GameObject(string.IsNullOrEmpty(name) ? "Station" : name);
            if (parent != null) rootObject.transform.SetParent(parent, false);
            rootObject.SetActive(false);
        }

        public GameObject RootObject => rootObject;
        public Transform Root => rootObject.transform;
        /// <summary>The assets the host bound for this world (never an edited station).</summary>
        public StationViewAssets Assets { get; }
        public RuntimeCatalogue Catalogue => Assets.Catalogue;
        public TrainCatalogue TrainCatalogue => Assets.TrainCatalogue;
        public Shader Shader => Assets.Shader;
        public Font Font => Assets.Font;
        public StationDocument Document => document;
        public StationIndex Index => index;
        public StationVisibilityRegistry Visibility => visibility;
        public int RuntimeTargetCount => runtimeTargets.Count;
        public event Action VisibilityApplied;
        public IReadOnlyList<StationViewRecord> Records => records;
        public IReadOnlyList<StationDiagnostic> Unresolved => unresolved;
        public IReadOnlyList<IStationViewRenderer> Renderers => renderers;
        public bool IsBuilt { get; private set; }
        public bool IsDisposed { get; private set; }
        public bool IsActivated => activated;

        /// <summary>Build every renderer into the staged root. Leaves the root inactive.</summary>
        public void Build(StationDocument stationDocument, StationIndex stationIndex, Action<string> markLoad = null) {
            using var editSample = StationEditProfiling.Measure("StationEdit.Build");
            if (IsBuilt) throw new InvalidOperationException("Station world is already built.");
            if (IsDisposed) throw new ObjectDisposedException(nameof(StationWorldView));
            document = stationDocument ?? throw new ArgumentNullException(nameof(stationDocument));
            index = stationIndex ?? throw new ArgumentNullException(nameof(stationIndex));
            var context = new StationViewBuildContext(this, markLoad);
            foreach (var renderer in renderers) {
                if (renderer == null) continue;
                try {
                    using var familySample = StationEditProfiling.Measure("StationEdit.View." + renderer.Role);
                    if (markLoad != null) markLoad("renderer." + renderer.Role + ".begin");
                    renderer.Build(context);
                    if (markLoad != null) markLoad("renderer." + renderer.Role + ".end");
                } catch (Exception error) {
                    throw new StationViewBuildException(renderer.Role ?? renderer.GetType().Name, error);
                }
            }
            IsBuilt = true;
        }

        /// <summary>
        /// Staged retained update across all registered renderers. If any renderer refuses or throws,
        /// <see cref="Dispose"/> rolls back every staged workspace and destroys inactive staged Unity objects.
        /// </summary>
        public sealed class LocalWorldStage : IDisposable {
            internal StationWorldView World;
            internal StationDocument Document;
            internal StationIndex Index;
            internal StationLocalDeltaContext Context;
            internal readonly List<IStationLocalRendererStage> Stages = new List<IStationLocalRendererStage>();
            internal GameObject Root;
            bool committed;

            internal void MarkCommitted() {
                committed = true;
                if (Root != null) {
                    DestroyView(Root);
                    Root = null;
                }
            }

            public void Dispose() {
                if (!committed) {
                    for (int i = Stages.Count - 1; i >= 0; i--) {
                        try { Stages[i]?.Dispose(); } catch (Exception) { }
                    }
                    Stages.Clear();
                }
                if (Root != null) {
                    DestroyView(Root);
                    Root = null;
                }
            }
        }

        static bool SameLines(IReadOnlyList<StationLineRecord> a, IReadOnlyList<StationLineRecord> b) {
            int ac = a?.Count ?? 0;
            int bc = b?.Count ?? 0;
            if (ac != bc) return false;
            for (int i = 0; i < ac; i++) {
                var la = a[i];
                var lb = b[i];
                if (ReferenceEquals(la, lb)) continue;
                if (la == null || lb == null) return false;
                if (!string.Equals(la.Id, lb.Id, StringComparison.Ordinal) ||
                    !string.Equals(la.Name, lb.Name, StringComparison.Ordinal) ||
                    !string.Equals(la.NameEn, lb.NameEn, StringComparison.Ordinal) ||
                    !string.Equals(la.Colour, lb.Colour, StringComparison.Ordinal) ||
                    !string.Equals(la.Stock, lb.Stock, StringComparison.Ordinal) ||
                    !string.Equals(la.Power, lb.Power, StringComparison.Ordinal) ||
                    la.Cars != lb.Cars ||
                    la.Direction != lb.Direction) return false;
            }
            return true;
        }

        static bool IsExitSpawnSettingsOnly(StationIndex previousIndex, StationIndexDelta delta) {
            if (previousIndex == null || delta == null) return false;
            if (delta.RemovedCells.Count > 0 || delta.ChangedCells.Count > 0 ||
                delta.RemovedModules.Count > 0 || delta.ChangedModules.Count == 0) {
                return false;
            }
            for (int i = 0; i < delta.ChangedModules.Count; i++) {
                var nextMod = delta.ChangedModules[i];
                if (nextMod == null || !string.Equals(nextMod.Type, "exit", StringComparison.Ordinal)) return false;
                if (!previousIndex.TryGetModule(nextMod.Id, out var prevMod) || prevMod == null ||
                    !string.Equals(prevMod.Type, "exit", StringComparison.Ordinal)) {
                    return false;
                }
                if (!StationEditClassifier.SameExitExceptSettings(prevMod.RawJson, nextMod.RawJson, allowName: false)) {
                    return false;
                }
            }
            return true;
        }

        public LocalWorldStage StageLocalWorld(StationDocument next, StationIndex nextIndex, StationIndexDelta delta) {
            using var editSample = StationEditProfiling.Measure("StationEdit.StageLocalWorld");
            if (!IsBuilt || IsDisposed || delta == null || document == null || index == null || next == null || nextIndex == null) {
                return null;
            }
            if (document.LevelBase != next.LevelBase ||
                document.StoreyHeight != next.StoreyHeight ||
                document.Seed != next.Seed ||
                !string.Equals(document.City, next.City, StringComparison.Ordinal) ||
                !string.Equals(document.Name, next.Name, StringComparison.Ordinal) ||
                !string.Equals(document.NameEn, next.NameEn, StringComparison.Ordinal) ||
                !SameLines(document.Lines, next.Lines)) {
                StationEditTrace.NoteViewFallback("global-station-metadata");
                return null;
            }

            for (int i = 0; i < renderers.Count; i++) {
                var renderer = renderers[i];
                if (renderer == null) continue;
                if (!(renderer is IStationLocalViewRenderer)) {
                    StationEditTrace.NoteViewFallback("non-local-renderer:" + (renderer.Role ?? renderer.GetType().Name));
                    return null;
                }
            }

            var stage = new LocalWorldStage {
                World = this,
                Document = next,
                Index = nextIndex,
                Root = new GameObject("staged local world"),
            };
            stage.Root.transform.SetParent(Root, false);
            stage.Root.SetActive(false);
            stage.Context = new StationLocalDeltaContext(this, document, index, next, nextIndex, delta, stage.Root.transform);

            if (IsExitSpawnSettingsOnly(index, delta)) {
                stage.Context.TouchedModuleIds.Clear();
                return stage;
            }

            try {
                for (int i = 0; i < renderers.Count; i++) {
                    var renderer = renderers[i];
                    if (renderer == null) continue;
                    var roleName = renderer.Role ?? renderer.GetType().Name;
                    var localRenderer = (IStationLocalViewRenderer)renderer;
                    using var familySample = StationEditProfiling.Measure("StationEdit.StageLocal." + roleName);
                    var injected = LocalStageFailureInjector?.Invoke(roleName);
                    if (injected != null) throw injected;
                    if (!localRenderer.TryStageLocalDelta(stage.Context, out var rendererStage, out var fallbackReason)) {
                        StationEditTrace.NoteViewFallback(string.IsNullOrEmpty(fallbackReason)
                            ? "renderer-refused:" + roleName
                            : fallbackReason);
                        stage.Dispose();
                        return null;
                    }
                    if (rendererStage != null) stage.Stages.Add(rendererStage);
                }
                return stage;
            } catch (StationViewBuildException) {
                stage.Dispose();
                throw;
            } catch (Exception error) {
                stage.Dispose();
                throw new StationViewBuildException("local-world", error);
            }
        }

        public StationLocalViewCommit CommitLocalWorld(LocalWorldStage stage) {
            using var editSample = StationEditProfiling.Measure("StationEdit.CommitLocalWorld");
            if (stage == null || stage.World != this) throw new ArgumentException("Wrong local view stage.");
            StationEditTrace.NoteRetainedView();
            var commit = new StationLocalViewCommit();
            document = stage.Document;
            index = stage.Index;
            modulesById = null;

            for (int i = 0; i < stage.Stages.Count; i++) {
                stage.Stages[i].Commit(this, commit);
            }

            var retiredIds = stage.Context.TouchedModuleIds;
            if (retiredIds.Count > 0 || commit.RetiredRecords.Count > 0) {
                var rebuiltModuleIds = new HashSet<string>(retiredIds, StringComparer.Ordinal);
                for (int i = 0; i < commit.RetiredRecords.Count; i++) {
                    var mid = commit.RetiredRecords[i].ModuleId;
                    if (!string.IsNullOrEmpty(mid)) rebuiltModuleIds.Add(mid);
                }
                if (rebuiltModuleIds.Count > 0) {
                    unresolved.RemoveAll(d => !string.IsNullOrEmpty(d.RecordId) && rebuiltModuleIds.Contains(d.RecordId));
                }
            }
            if (stage.Context.Diagnostics.Count > 0) {
                unresolved.AddRange(stage.Context.Diagnostics);
            }

            var seenViews = new HashSet<GameObject>();
            for (int i = 0; i < commit.RetiredViews.Count; i++) {
                var go = commit.RetiredViews[i];
                if (go == null || !seenViews.Add(go)) continue;
                var targets = go.GetComponentsInChildren<StationVisibilityTarget>(true);
                for (int t = 0; t < targets.Length; t++) {
                    if (targets[t] != null) commit.RetiredTargets.Add(targets[t]);
                }
                go.SetActive(false);
                DestroyView(go);
            }
            var seenMeshes = new HashSet<Mesh>();
            for (int i = 0; i < commit.RetiredMeshes.Count; i++) {
                var mesh = commit.RetiredMeshes[i];
                if (mesh == null || !seenMeshes.Add(mesh)) continue;
                DestroyUnityObject(mesh);
            }

            stage.MarkCommitted();
            return commit;
        }

        public void RetireRecordsWhere(Predicate<StationViewRecord> match, StationLocalViewCommit commit, bool retireViewObjects = false) {
            if (match == null) return;
            for (int i = records.Count - 1; i >= 0; i--) {
                var record = records[i];
                if (!match(record)) continue;
                records.RemoveAt(i);
                if (roleCounts.TryGetValue(record.Role, out var count) && count > 0) {
                    roleCounts[record.Role] = count - 1;
                }
                commit?.RetiredRecords.Add(record);
                if (retireViewObjects && record.View != null) {
                    commit?.RetiredViews.Add(record.View);
                }
            }
        }

        public void AddLocalRecord(StationViewRecord record, StationLocalViewCommit commit) {
            if (record == null) return;
            Add(record);
            commit?.AddedRecords.Add(record);
        }

        internal static void DestroyView(GameObject view) {
            if (view == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(view); else UnityEngine.Object.DestroyImmediate(view);
        }

        internal static void DestroyUnityObject(UnityEngine.Object obj) {
            if (obj == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(obj); else UnityEngine.Object.DestroyImmediate(obj);
        }

        /// <summary>Activate the staged root. Called by the load transaction at commit.</summary>
        public void Activate() {
            using var editSample = StationEditProfiling.Measure("StationEdit.Activate");
            if (IsDisposed) return;
            activated = true;
            rootObject.SetActive(true);
        }

        public Transform RoleRoot(string role) {
            if (string.IsNullOrEmpty(role)) role = "other";
            if (roleRoots.TryGetValue(role, out var existing) && existing != null) return existing;
            var created = new GameObject("role " + role).transform;
            created.SetParent(Root, false);
            roleRoots[role] = created;
            roleVisibility[role] = true;
            return created;
        }

        public void ReportUnresolved(string code, string recordType, string recordId, string message) {
            unresolved.Add(new StationDiagnostic(code ?? "unresolved", StationDiagnosticSeverity.Warning,
                recordType ?? "", recordId ?? "", message ?? ""));
        }

        public void RegisterModule(string role, string moduleId, GameObject view, string part = "",
            StationBox? bounds = null, int levelMin = 0, int levelMax = 0, int[] levelBands = null,
            string[] sourceIds = null, StationBox[] sourceBounds = null, bool gradeOwned = false,
            string gradeNote = "", StationBatchSpan[] sourceSpans = null) {
            Add(new StationViewRecord {
                Role = role ?? "", ModuleId = moduleId ?? "", Part = part ?? "", View = view,
                Bounds = bounds ?? default, HasBounds = bounds.HasValue, LevelMin = levelMin, LevelMax = levelMax,
                LevelBands = levelBands, SourceIds = sourceIds, SourceBounds = sourceBounds,
                SourceSpans = sourceSpans, GradeOwned = gradeOwned, GradeNote = gradeNote ?? "",
            });
        }

        public void RegisterCell(string role, StationCellKey key, GameObject view, int[] levelBands = null) {
            Add(new StationViewRecord { Role = role ?? "", CellKey = key.ToString(), View = view, LevelBands = levelBands });
        }

        void Add(StationViewRecord record) {
            records.Add(record);
            roleCounts.TryGetValue(record.Role, out var count);
            roleCounts[record.Role] = count + 1;
        }

        public bool TryGetModule(string moduleId, out StationViewRecord record) {
            if (!string.IsNullOrEmpty(moduleId)) {
                for (int i = 0; i < records.Count; i++) {
                    var candidate = records[i];
                    if (candidate.ModuleId == moduleId && candidate.Part.Length == 0 && candidate.View != null) {
                        record = candidate;
                        return true;
                    }
                }
                for (int i = 0; i < records.Count; i++) {
                    var candidate = records[i];
                    if (candidate.ModuleId == moduleId && candidate.View != null) { record = candidate; return true; }
                }
            }
            record = null;
            return false;
        }

        public bool TryGetCell(StationCellKey key, out StationViewRecord record) {
            var text = key.ToString();
            for (int i = 0; i < records.Count; i++) {
                if (records[i].CellKey == text && records[i].View != null) { record = records[i]; return true; }
            }
            record = null;
            return false;
        }

        /// <summary>
        /// The typed document record behind a renderer record's module id. The body index
        /// (picking, ghosts, the edit transaction) asks once per id, so it is a dictionary
        /// over the committed document, never a scan.
        /// </summary>
        public bool TryGetModuleRecord(string moduleId, out StationModuleRecord module) {
            if (string.IsNullOrEmpty(moduleId)) { module = null; return false; }
            if (modulesById == null) {
                modulesById = new Dictionary<string, StationModuleRecord>(StringComparer.Ordinal);
                var modules = document?.Modules;
                if (modules != null) {
                    for (int i = 0; i < modules.Count; i++) {
                        var record = modules[i];
                        if (record != null) modulesById[record.Id] = record;
                    }
                }
            }
            return modulesById.TryGetValue(moduleId, out module);
        }

        /// <summary>
        /// Adopt the materials an artwork owner just installed on one renderer as that part's
        /// authored base, so a later Base/Ghost/Clear pass restores the bound artwork instead of
        /// the baked export sample (20 §1, §2). The piece keeps its authored eligibility.
        /// </summary>
        public void RecaptureArtwork(Renderer renderer) {
            if (!renderer) return;
            var target = renderer.GetComponentInParent<Metro.View.StationVisibilityTarget>(true);
            if (target != null) target.Recapture(renderer);
        }

        public void SetRoleVisible(string role, bool visible) {
            roleVisibility[role ?? ""] = visible;
            if (roleRoots.TryGetValue(role ?? "", out var root) && root != null) root.gameObject.SetActive(visible);
        }

        public bool IsRoleVisible(string role) =>
            !roleVisibility.TryGetValue(role ?? "", out var visible) || visible;

        /// <summary>
        /// Bind the world to a visibility registry so runtime-spawned actors and pooled
        /// vehicles follow the exact same storey/section/grade policy without entering
        /// <see cref="Records"/>, <see cref="StationScenePicker"/> or document history.
        /// </summary>
        public void BindVisibility(StationVisibilityRegistry registry) {
            if (IsDisposed) return;
            if (!ReferenceEquals(visibility, registry)) {
                if (visibility != null) visibility.Applied -= OnVisibilityApplied;
                visibility = registry;
                if (visibility != null) visibility.Applied += OnVisibilityApplied;
            }
            if (visibility != null && runtimeTargets.Count > 0) {
                List<StationVisibilityTarget> dead = null;
                foreach (var target in runtimeTargets) {
                    if (target == null) { (dead ??= new List<StationVisibilityTarget>()).Add(target); continue; }
                    visibility.Register(target);
                }
                if (dead != null) {
                    for (int i = 0; i < dead.Count; i++) runtimeTargets.Remove(dead[i]);
                }
            }
        }

        void OnVisibilityApplied() => VisibilityApplied?.Invoke();

        public StationDrawMode BindRuntimeTarget(StationVisibilityTarget target) {
            if (target == null || IsDisposed) return StationDrawMode.Hidden;
            runtimeTargets.Add(target);
            if (visibility != null) {
                visibility.Register(target);
                return visibility.ApplyTarget(target);
            }
            var fallback = target.Parked ? StationDrawMode.Hidden : StationDrawMode.Base;
            target.Apply(fallback, null);
            return fallback;
        }

        public StationDrawMode ApplyRuntimeTarget(StationVisibilityTarget target) {
            if (target == null || IsDisposed) return StationDrawMode.Hidden;
            runtimeTargets.Add(target);
            if (visibility != null) {
                visibility.Register(target);
                return visibility.ApplyTarget(target);
            }
            var fallback = target.Parked ? StationDrawMode.Hidden : StationDrawMode.Base;
            target.Apply(fallback, null);
            return fallback;
        }

        public void UnbindRuntimeTarget(StationVisibilityTarget target) {
            if (target == null) return;
            runtimeTargets.Remove(target);
            visibility?.Unregister(target);
            target.parked = true;
            target.levels = Array.Empty<int>();
            target.gradeOwned = false;
            target.Apply(StationDrawMode.Hidden, null);
        }

        public StationViewSummary Summary() => new StationViewSummary(
            roleCounts, CountRecords(true), CountRecords(false), unresolved.Count);

        int CountRecords(bool modules) {
            int count = 0;
            for (int i = 0; i < records.Count; i++) {
                var record = records[i];
                if (modules ? record.ModuleId.Length > 0 : record.CellKey.Length > 0) count++;
            }
            return count;
        }

        public void Dispose() {
            using var editSample = StationEditProfiling.Measure("StationEdit.Dispose");
            if (IsDisposed) return;
            IsDisposed = true;
            if (visibility != null) {
                visibility.Applied -= OnVisibilityApplied;
                foreach (var target in runtimeTargets) {
                    if (target != null) visibility.Unregister(target);
                }
                visibility = null;
            }
            runtimeTargets.Clear();
            VisibilityApplied = null;
            for (int i = 0; i < renderers.Count; i++) {
                try { renderers[i].Release(); } catch (Exception) { /* a released family must not block teardown */ }
            }
            records.Clear();
            roleRoots.Clear();
            roleCounts.Clear();
            roleVisibility.Clear();
            unresolved.Clear();
            modulesById = null;
            document = null;
            index = null;
            StationScenePicker.ReleaseWorld(this);
            if (rootObject != null) {
                if (Application.isPlaying) UnityEngine.Object.Destroy(rootObject);
                else UnityEngine.Object.DestroyImmediate(rootObject);
            }
        }
    }

    /// <summary>
    /// One rendered frame's simulation time. <see cref="SimSeconds"/> is the
    /// authoritative fixed-tick clock; <see cref="PresentationSeconds"/> is the tick
    /// interval already elapsed, sampled by <see cref="Fraction"/> between the two
    /// adjacent tick frames. Service decisions and counters never read this clock —
    /// only the per-frame animation consumers do (RCA 14 §5).
    /// </summary>
    public readonly struct StationFrameClock {
        public StationFrameClock(long tick, long epoch, double simSeconds, double presentationSeconds,
            double fraction, bool playing) {
            Tick = tick;
            Epoch = epoch;
            SimSeconds = simSeconds;
            PresentationSeconds = presentationSeconds;
            Fraction = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
            Playing = playing;
        }

        /// <summary>The fixed tick this frame follows (authoritative).</summary>
        public long Tick { get; }
        /// <summary>The session's presentation epoch; changes invalidate frame history.</summary>
        public long Epoch { get; }
        /// <summary>Seconds since the station's day zero at the tick boundary.</summary>
        public double SimSeconds { get; }
        /// <summary>The presented instant: one tick behind the boundary, advanced by the fraction.</summary>
        public double PresentationSeconds { get; }
        /// <summary>0 at the tick boundary … 1 just before the next tick.</summary>
        public double Fraction { get; }
        public bool Playing { get; }
    }

    /// <summary>
    /// A system that needs a per-frame tick with the committed station and the
    /// simulation clock (roads, actors, traffic, …). Registered process-wide exactly
    /// like a renderer, so a packet never edits the host. A sink is called only while
    /// a station is committed; the clock is seconds since the station's day zero.
    /// </summary>
    public interface IStationFrameSink {
        void Tick(StationDocument document, StationIndex index, StationFrameClock clock);
    }

    /// <summary>
    /// Marker for frame sinks that must keep ticking while the standalone exploded viewer owns
    /// presentation (the exploded viewer itself and vertical/motion sinks feeding its live steps).
    /// Hidden editor-only sinks are paused while the editor camera is disabled.
    /// </summary>
    public interface IStationActiveDuringExplodedView { }

    /// <summary>Process-wide frame-sink registry.</summary>
    public static class StationFrameSinks {
        static readonly List<IStationFrameSink> Registered = new List<IStationFrameSink>();

        public static void Add(IStationFrameSink sink) {
            if (sink == null) throw new ArgumentNullException(nameof(sink));
            if (!Registered.Contains(sink)) Registered.Add(sink);
        }

        public static bool Remove(IStationFrameSink sink) => Registered.Remove(sink);

        public static IReadOnlyList<IStationFrameSink> Snapshot() => Registered.ToArray();

        /// <summary>Test seam: forget every registration.</summary>
        public static void Clear() => Registered.Clear();
    }

    /// <summary>
    /// Process-wide renderer registry. A family file registers itself once with
    /// <c>[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]</c>
    /// so the generic host picks it up without a scene reference or a lead edit.
    /// </summary>
    public static class StationRenderers {
        static readonly List<IStationViewRenderer> Registered = new List<IStationViewRenderer>();

        public static void Add(IStationViewRenderer renderer) {
            if (renderer == null) throw new ArgumentNullException(nameof(renderer));
            Remove(renderer.Role);
            Registered.Add(renderer);
        }

        public static bool Remove(string role) {
            for (int i = Registered.Count - 1; i >= 0; i--) {
                if (string.Equals(Registered[i].Role, role, StringComparison.Ordinal)) {
                    Registered.RemoveAt(i);
                    return true;
                }
            }
            return false;
        }

        public static IReadOnlyList<IStationViewRenderer> Snapshot() => Registered.ToArray();

        /// <summary>Test seam: forget every registration.</summary>
        public static void Clear() => Registered.Clear();
    }
}
