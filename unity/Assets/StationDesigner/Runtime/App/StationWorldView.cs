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
        internal StationViewBuildContext(StationWorldView world) { this.world = world; }
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
    /// The renderer registry of one station world. It is built **staged** (inactive)
    /// and only activated when the load transaction commits, so a render failure
    /// cannot show half a station. It also owns the pick/visibility records: a
    /// renderer registers each module/cell view by stable id, never by object name.
    /// </summary>
    public sealed class StationWorldView : IDisposable {
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
        public void Build(StationDocument stationDocument, StationIndex stationIndex) {
            using var editSample = StationEditProfiling.Measure("StationEdit.Build");
            if (IsBuilt) throw new InvalidOperationException("Station world is already built.");
            if (IsDisposed) throw new ObjectDisposedException(nameof(StationWorldView));
            document = stationDocument ?? throw new ArgumentNullException(nameof(stationDocument));
            index = stationIndex ?? throw new ArgumentNullException(nameof(stationIndex));
            var context = new StationViewBuildContext(this);
            foreach (var renderer in renderers) {
                if (renderer == null) continue;
                try {
                    using var familySample = StationEditProfiling.Measure("StationEdit.View." + renderer.Role);
                    renderer.Build(context);
                } catch (Exception error) {
                    throw new StationViewBuildException(renderer.Role ?? renderer.GetType().Name, error);
                }
            }
            IsBuilt = true;
        }

        /// <summary>A staged, prefab-only local replacement. It owns no generated materials,
        /// artwork or meshes. Unknown dependencies and all cell edits keep the full path.</summary>
        public sealed class LocalModuleStage : IDisposable {
            internal StationWorldView World;
            internal StationDocument Document;
            internal StationIndex Index;
            internal readonly HashSet<string> Ids = new HashSet<string>(StringComparer.Ordinal);
            internal readonly List<StationViewRecord> Records = new List<StationViewRecord>();
            internal GameObject Root;
            public void Dispose() {
                if (Root == null) return;
                DestroyView(Root); Root = null;
            }
        }

        static bool IndependentPrefab(StationModuleRecord module) {
            if (module == null) return true;
            if (module.Facts.CeilingAnchored || StationFootprints.IsCeilingHung(module.Facts)) return false;
            switch (module.Type) {
                case "bin": case "tvm": case "vending": case "bench": case "shelf": case "extinguisher": return true;
                default: return false;
            }
        }

        public LocalModuleStage StageLocalModules(StationDocument next, StationIndex nextIndex, StationIndexDelta delta) {
            using var editSample = StationEditProfiling.Measure("StationEdit.StageLocalModules");
            if (delta == null || delta.RemovedCells.Count > 0 || delta.ChangedCells.Count > 0 || Catalogue == null) return null;
            StationEditClassifier.GroundWindow(document, out var x0, out var y0, out var x1, out var y1);
            StationEditClassifier.GroundWindow(next, out var nx0, out var ny0, out var nx1, out var ny1);
            if (x0 != nx0 || y0 != ny0 || x1 != nx1 || y1 != ny1) return null;
            var ids = new HashSet<string>(delta.RemovedModules, StringComparer.Ordinal);
            foreach (var module in delta.ChangedModules) ids.Add(module.Id);
            if (ids.Count == 0) return null;
            foreach (var id in ids) {
                if (!IndependentPrefab(index.GetModule(id)) || !IndependentPrefab(nextIndex.GetModule(id))) return null;
                // Refuse unexpected batched or generated records rather than deleting a shared view.
                foreach (var record in records)
                    if (record.SourceIds != null && Array.IndexOf(record.SourceIds, id) >= 0) return null;
            }
            var stage = new LocalModuleStage { World = this, Document = next, Index = nextIndex, Root = new GameObject("staged local modules") };
            stage.Root.transform.SetParent(Root, false);
            stage.Root.SetActive(false);
            foreach (var id in ids) stage.Ids.Add(id);
            try {
                var facts = new ModuleFacts[next.ModuleCount];
                for (int i = 0; i < facts.Length; i++) facts[i] = next.Modules[i].Facts;
                foreach (var id in ids) {
                    var module = nextIndex.GetModule(id);
                    if (module == null) continue;
                    var visual = ModuleViews.Resolve(module.Facts, facts, Catalogue);
                    if (!visual.HasModel || !Catalogue.TryGet(visual.Key, out var entry) || entry.prefab == null || entry.kind == "generated") {
                        stage.Dispose(); return null;
                    }
                    var go = UnityEngine.Object.Instantiate(entry.prefab, stage.Root.transform, false);
                    go.name = id + " " + module.Type;
                    go.transform.SetPositionAndRotation(ModulePlacement.Resolve(module, entry, nextIndex), ModulePlacement.Rotation(module.Rotation));
                    stage.Records.Add(new StationViewRecord { Role = StationModuleClaims.Equipment, ModuleId = id, View = go,
                        LevelMin = module.Z, LevelMax = module.Z + 1 });
                }
                return stage;
            } catch { stage.Dispose(); throw; }
        }

        public void CommitLocalModules(LocalModuleStage stage) {
            using var editSample = StationEditProfiling.Measure("StationEdit.CommitLocalModules");
            if (stage == null || stage.World != this) throw new ArgumentException("Wrong local view stage.");
            for (int i = records.Count - 1; i >= 0; i--) {
                var record = records[i];
                if (!stage.Ids.Contains(record.ModuleId)) continue;
                if (record.View != null) { record.View.SetActive(false); DestroyView(record.View); }
                roleCounts[record.Role]--;
                records.RemoveAt(i);
            }
            document = stage.Document; index = stage.Index; modulesById = null;
            foreach (var record in stage.Records) {
                record.View.transform.SetParent(RoleRoot(record.Role), true);
                Add(record);
            }
            foreach (var renderer in renderers)
                if (renderer is StationEquipmentModuleRenderer equipment) equipment.AdoptLocalModules(this, stage.Ids, stage.Records);
            stage.Dispose();
        }

        static void DestroyView(GameObject view) {
            if (Application.isPlaying) UnityEngine.Object.Destroy(view); else UnityEngine.Object.DestroyImmediate(view);
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
            modulesById = null;
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
