using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using Metro.Build;
using Metro.View;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// One renderer family (cells, modules, signs, roads, actors, trains, Ã¢â‚¬Â¦). A
    /// renderer is registered once Ã¢â‚¬â€ by its own file via
    /// <see cref="StationRenderers.Add"/> or by the host Ã¢â‚¬â€ and the host calls
    /// <see cref="Build"/> into a **staged** root on every station install. Throwing
    /// from Build refuses that install and leaves the previous station in place.
    /// </summary>
    public interface IStationViewRenderer {
        /// <summary>Stable role id ("cells", "modules", "signs", "roads", Ã¢â‚¬Â¦).</summary>
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
        readonly GameObject rootObject;
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
        public IReadOnlyList<StationViewRecord> Records => records;
        public IReadOnlyList<StationDiagnostic> Unresolved => unresolved;
        public IReadOnlyList<IStationViewRenderer> Renderers => renderers;
        public bool IsBuilt { get; private set; }
        public bool IsDisposed { get; private set; }
        public bool IsActivated => activated;

        /// <summary>Build every renderer into the staged root. Leaves the root inactive.</summary>
        public void Build(StationDocument stationDocument, StationIndex stationIndex) {
            if (IsBuilt) throw new InvalidOperationException("Station world is already built.");
            if (IsDisposed) throw new ObjectDisposedException(nameof(StationWorldView));
            document = stationDocument ?? throw new ArgumentNullException(nameof(stationDocument));
            index = stationIndex ?? throw new ArgumentNullException(nameof(stationIndex));
            var context = new StationViewBuildContext(this);
            foreach (var renderer in renderers) {
                if (renderer == null) continue;
                try {
                    renderer.Build(context);
                } catch (Exception error) {
                    throw new StationViewBuildException(renderer.Role ?? renderer.GetType().Name, error);
                }
            }
            IsBuilt = true;
        }

        /// <summary>Activate the staged root. Called by the load transaction at commit.</summary>
        public void Activate() {
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
            StationBox? bounds = null, int levelMin = 0, int levelMax = 0) {
            Add(new StationViewRecord {
                Role = role ?? "", ModuleId = moduleId ?? "", Part = part ?? "", View = view,
                Bounds = bounds ?? default, HasBounds = bounds.HasValue, LevelMin = levelMin, LevelMax = levelMax,
            });
        }

        public void RegisterCell(string role, StationCellKey key, GameObject view) {
            Add(new StationViewRecord { Role = role ?? "", CellKey = key.ToString(), View = view });
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

        public void SetRoleVisible(string role, bool visible) {
            roleVisibility[role ?? ""] = visible;
            if (roleRoots.TryGetValue(role ?? "", out var root) && root != null) root.gameObject.SetActive(visible);
        }

        public bool IsRoleVisible(string role) =>
            !roleVisibility.TryGetValue(role ?? "", out var visible) || visible;

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
            if (IsDisposed) return;
            IsDisposed = true;
            for (int i = 0; i < renderers.Count; i++) {
                try { renderers[i].Release(); } catch (Exception) { /* a released family must not block teardown */ }
            }
            records.Clear();
            roleRoots.Clear();
            if (rootObject != null) {
                if (Application.isPlaying) UnityEngine.Object.Destroy(rootObject);
                else UnityEngine.Object.DestroyImmediate(rootObject);
            }
        }
    }

    /// <summary>
    /// A system that needs a per-frame tick with the committed station and the
    /// simulation clock (roads, actors, traffic, …). Registered process-wide exactly
    /// like a renderer, so a packet never edits the host. A sink is called only while
    /// a station is committed; the clock is seconds since the station's day zero.
    /// </summary>
    public interface IStationFrameSink {
        void Tick(StationDocument document, StationIndex index, double simTimeSeconds);
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
