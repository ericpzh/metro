using System;
using System.Collections.Generic;
using Metro.App;
using Metro.Build;
using Metro.Sim;
using Metro.View;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>Stable identity of one ambient vehicle instance (simulation serial, not a module).</summary>
    public sealed class RoadVehicleKey : MonoBehaviour {
        public int vehicleId;
        public string kind = "";
        public string variant = "";
    }

    /// <summary>
    /// Renders <see cref="StationRoadTraffic"/> poses from the six promoted vehicle
    /// prefabs (<see cref="RoadVehicleViewKeys"/>: SUV, sedan, both bus liveries,
    /// moped and bicycle). The simulation still owns every pose, variant choice and
    /// signal decision; this view only pools one instance per visible pose.
    ///
    /// The prefabs are authored in the vehicle-local convention of the source kit:
    /// +Z forward, +Y up, origin on the tyre contact plane (measured bounds have
    /// min y = 0). The camera-facing pose math is therefore a yaw only; a prefab
    /// whose own basis differs is corrected once per prefab through
    /// <see cref="PoseCorrection"/>, never per vehicle type.
    ///
    /// The pre-promotion generated box bodies survive only as an explicit,
    /// reported fallback for a missing catalogue entry. <see cref="FallbackVehicleViews"/>
    /// counts the vehicles drawn that way in the last frame, and
    /// <see cref="MissingPrefabs"/> names every unresolved key so a test and the
    /// host diagnostics can see them; the normal path never builds a box.
    /// </summary>
    public sealed class RoadVehicleViews : MonoBehaviour {
        enum Ink { Paint, Pale, Accent, Glass, Rubber, Metal, Lamp, Tail }

        const int PoolSize = 12;

        /// <summary>Generated fallback body bins (only used when a prefab is absent).</summary>
        sealed class VehicleMesh {
            readonly Dictionary<Ink, (List<Vector3> vertices, List<int> triangles)> bins =
                new Dictionary<Ink, (List<Vector3>, List<int>)>();
            public bool Low;

            public void Box(Ink ink, Vector3 centre, Vector3 size) {
                if (!bins.TryGetValue(ink, out var bin)) bins.Add(ink, bin = (new List<Vector3>(), new List<int>()));
                float hx = size.x / 2, hy = size.y / 2, hz = size.z / 2;
                var p = new Vector3[8];
                for (int i = 0; i < 8; i++)
                    p[i] = centre + new Vector3((i & 1) == 0 ? -hx : hx, (i & 2) == 0 ? -hy : hy, (i & 4) == 0 ? -hz : hz);
                void Face(int a, int b, int c, int d) {
                    int start = bin.vertices.Count;
                    bin.vertices.Add(p[a]); bin.vertices.Add(p[b]); bin.vertices.Add(p[c]); bin.vertices.Add(p[d]);
                    bin.triangles.Add(start); bin.triangles.Add(start + 1); bin.triangles.Add(start + 2);
                    bin.triangles.Add(start); bin.triangles.Add(start + 2); bin.triangles.Add(start + 3);
                }
                Face(0, 1, 3, 2); Face(4, 6, 7, 5); Face(0, 4, 5, 1);
                Face(2, 3, 7, 6); Face(0, 2, 6, 4); Face(1, 5, 7, 3);
            }

            public Dictionary<Ink, Mesh> Build(string name) {
                var result = new Dictionary<Ink, Mesh>();
                foreach (var pair in bins) {
                    var mesh = new Mesh { name = name + " " + pair.Key, indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
                    mesh.SetVertices(pair.Value.vertices);
                    mesh.SetTriangles(pair.Value.triangles, 0);
                    mesh.RecalculateNormals();
                    mesh.RecalculateBounds();
                    result[pair.Key] = mesh;
                }
                return result;
            }
        }

        sealed class Slot {
            public Transform Instance;
            public StationVisibilityTarget Target;
            public readonly int[] BandSlot = new int[1];
            public int LastBand = int.MinValue;
            public bool Bound;
            public bool ActiveThisSample;
            public bool IsPrefab;
            public string Variant = "";
            public RoadVehiclePose Pose;
        }

        sealed class Pool {
            public readonly List<Slot> Slots = new List<Slot>();
            public Transform Root;
            public GameObject Prefab;
            public Quaternion PoseCorrection = Quaternion.identity;
        }

        sealed class ComponentPool {
            public int Serial;
            public Transform Root;
            public readonly Dictionary<string, Pool> Pools = new Dictionary<string, Pool>(StringComparer.Ordinal);
            public int SampledCount;
        }

        readonly List<Material> ownedMaterials = new List<Material>();
        readonly List<Mesh> ownedMeshes = new List<Mesh>();
        readonly Dictionary<string, Pool> pools = new Dictionary<string, Pool>(StringComparer.Ordinal);
        readonly Dictionary<int, ComponentPool> componentPools = new Dictionary<int, ComponentPool>();
        readonly Dictionary<string, int> countScratch = new Dictionary<string, int>(StringComparer.Ordinal);
        readonly List<RoadVehiclePose> poses = new List<RoadVehiclePose>();
        readonly List<RoadVehiclePose> sampled = new List<RoadVehiclePose>();
        readonly List<string> missingPrefabs = new List<string>();
        Material[] paints;
        Shader shader;
        StationWorldView world;
        bool low;
        bool multiComponent;

        public StationRoadTraffic Traffic { get; private set; }
        /// <summary>The catalogue the prefabs were resolved from; null means explicit fallback.</summary>
        public RuntimeCatalogue Catalogue { get; private set; }
        public int VisibleVehicles { get; private set; }
        /// <summary>Sampled this frame before the view predicate (the simulation's own count).</summary>
        public int SampledVehicles { get; private set; }
        /// <summary>Sampled poses the live view refused (a hidden storey or 隐藏地面).</summary>
        public int FilteredVehicles { get; private set; }
        /// <summary>
        /// Visible **road riders** — the people aboard a promoted moped or bicycle. They
        /// are ambient road traffic, not station crowd actors; a report must count them
        /// separately from <c>PassengerCrowdView</c>'s bodies.
        /// </summary>
        public int Riders { get; private set; }
        public int Cars { get; private set; }
        public int Buses { get; private set; }
        /// <summary>Every two-wheeled vehicle (mopeds and bicycles).</summary>
        public int Scooters { get; private set; }
        public int Bicycles { get; private set; }
        public int Mopeds { get; private set; }
        /// <summary>Visible vehicles drawn from a promoted prefab in the last render.</summary>
        public int PrefabVehicleViews { get; private set; }
        /// <summary>Visible vehicles drawn by the generated fallback body in the last render.</summary>
        public int FallbackVehicleViews { get; private set; }
        public int MissingPrefabCount => missingPrefabs.Count;
        public IReadOnlyList<string> MissingPrefabs => missingPrefabs;
        /// <summary>Sim time the current poses were sampled at; NaN before the first render.</summary>
        public double SampledTime { get; private set; } = double.NaN;
        public IReadOnlyList<RoadVehiclePose> Poses => poses;
        public bool LowDetail => low;

        public static RoadVehicleViews Build(Transform parent, StationRoadTraffic traffic, Shader shader, bool lowDetail = false) =>
            Build(parent, traffic, shader, lowDetail, null, null);

        /// <summary>
        /// Build the view and resolve the six vehicle keys up front. A catalogue row
        /// that is absent or has no prefab is reported once by key (and through
        /// <paramref name="reportMissing"/> when the host supplies one); the matching
        /// variant then uses the generated fallback body explicitly.
        /// </summary>
        /// <summary>
        /// Build a persistent multi-component vehicle host whose pools are partitioned per
        /// connected road component so editing one road network retains disconnected vehicle
        /// pools and transforms intact (plan 39 §9).
        /// </summary>
        public static RoadVehicleViews BuildMultiComponent(Transform parent, Shader shader,
            bool lowDetail, RuntimeCatalogue catalogue, Action<string, string> reportMissing) {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var view = parent.gameObject.AddComponent<RoadVehicleViews>();
            view.multiComponent = true;
            view.shader = shader;
            view.low = lowDetail;
            view.Catalogue = catalogue;
            view.ResolveAllPrefabs(catalogue, reportMissing);
            return view;
        }

        public static RoadVehicleViews Build(Transform parent, StationRoadTraffic traffic, Shader shader,
            bool lowDetail, RuntimeCatalogue catalogue, Action<string, string> reportMissing) {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var view = parent.gameObject.AddComponent<RoadVehicleViews>();
            view.Traffic = traffic ?? throw new ArgumentNullException(nameof(traffic));
            view.shader = shader;
            view.low = lowDetail;
            view.Catalogue = catalogue;
            view.ResolveAllPrefabs(catalogue, reportMissing);
            return view;
        }

        void ResolveAllPrefabs(RuntimeCatalogue catalogue, Action<string, string> reportMissing) {
            for (int i = 0; i < RoadVehicleViewKeys.Variants.Length; i++) {
                var variant = RoadVehicleViewKeys.Variants[i];
                var key = RoadVehicleViewKeys.All[i];
                if (ResolvePrefab(variant) != null) continue;
                var detail = catalogue == null
                    ? $"{key} ({variant}): no runtime catalogue was supplied"
                    : $"{key} ({variant}): catalogue has no prefab for {RoadVehicleViewKeys.PrefabPath(key)}";
                missingPrefabs.Add($"{key} ({variant})");
                Debug.LogWarning("RoadVehicleViews: " + detail + "; using the generated fallback body.");
                reportMissing?.Invoke("missing-vehicle-prefab", detail);
            }
        }

        public void SetPrimaryTraffic(StationRoadTraffic traffic) {
            Traffic = traffic;
        }

        public bool TryGetComponentPoolRoot(int componentSerial, out Transform root) {
            if (componentPools.TryGetValue(componentSerial, out var pool) && pool.Root != null) {
                root = pool.Root;
                return true;
            }
            root = null;
            return false;
        }

        ComponentPool EnsureComponentPool(int componentSerial) {
            if (componentPools.TryGetValue(componentSerial, out var existing)) return existing;
            var root = new GameObject("vehicles-net " + componentSerial).transform;
            root.SetParent(transform, false);
            var created = new ComponentPool { Serial = componentSerial, Root = root };
            componentPools.Add(componentSerial, created);
            return created;
        }

        Pool PoolForComponent(ComponentPool comp, string variant) {
            if (comp.Pools.TryGetValue(variant, out var pool)) return pool;
            var root = new GameObject("vehicles " + variant).transform;
            root.SetParent(comp.Root, false);
            var prefab = ResolvePrefab(variant);
            pool = new Pool {
                Root = root,
                Prefab = prefab,
                PoseCorrection = prefab != null ? PoseCorrection(prefab) : Quaternion.identity,
            };
            comp.Pools.Add(variant, pool);
            return pool;
        }

        /// <summary>
        /// Sample and pose a single road component into its isolated <see cref="ComponentPool"/>
        /// without touching any other component's transforms, visibility targets, or pools.
        /// Call <see cref="RefreshWorldCounts"/> once after updating one or more components.
        /// </summary>
        public void RenderComponentForWorld(int componentSerial, StationRoadTraffic traffic, int idOffset,
            double simTimeSeconds, StationWorldView stationWorld) {
            if (traffic == null) return;
            BindWorld(stationWorld);
            var comp = EnsureComponentPool(componentSerial);
            traffic.Sample(simTimeSeconds, sampled);
            SampledTime = simTimeSeconds;
            comp.SampledCount = sampled.Count;
            countScratch.Clear();

            var grid = stationWorld?.Visibility != null
                ? stationWorld.Visibility.State.Grid
                : StationLevelGrid.FromDocument(stationWorld?.Document?.LevelBase ?? 0, stationWorld?.Document?.StoreyHeight ?? 5);

            for (int i = 0; i < sampled.Count; i++) {
                var pose = sampled[i];
                pose.Id += idOffset;
                var variant = string.IsNullOrEmpty(pose.Variant) ? "sedan" : pose.Variant;
                var pool = PoolForComponent(comp, variant);
                int index = countScratch.TryGetValue(variant, out var held) ? held : 0;
                while (pool.Slots.Count <= index) {
                    pool.Slots.Add(CreateSlot(variant, pool.Root, pool.Prefab, pool.PoseCorrection));
                }
                var slot = pool.Slots[index];
                countScratch[variant] = index + 1;

                slot.Pose = pose;
                slot.Variant = variant;
                slot.ActiveThisSample = true;
                slot.Instance.localPosition = new Vector3((float)pose.X, (float)pose.Z, (float)pose.Y);
                slot.Instance.localRotation = Quaternion.Euler(0, (float)(-pose.Heading * 180.0 / Math.PI), 0) * pool.PoseCorrection;
                if (!slot.Instance.gameObject.activeSelf) slot.Instance.gameObject.SetActive(true);
                var key = slot.Instance.GetComponent<RoadVehicleKey>();
                if (key) { key.vehicleId = pose.Id; key.variant = variant; }

                int band = StationModuleLevels.Band(grid, pose.RoadZ);
                bool dirty = !slot.Bound || slot.Target.Parked || slot.LastBand != band ||
                    (stationWorld?.Visibility != null && stationWorld.Visibility.SectionClipping);
                slot.BandSlot[0] = band;
                slot.Target.levels = slot.BandSlot;
                slot.Target.gradeOwned = true;
                slot.Target.parked = false;
                slot.LastBand = band;

                if (stationWorld != null) {
                    if (!slot.Bound) {
                        slot.Bound = true;
                        stationWorld.BindRuntimeTarget(slot.Target);
                    } else if (dirty) {
                        stationWorld.ApplyRuntimeTarget(slot.Target);
                    }
                } else {
                    slot.Target.Apply(StationDrawMode.Base, null);
                }
            }

            foreach (var pair in comp.Pools) {
                int used = countScratch.TryGetValue(pair.Key, out var u) ? u : 0;
                var slots = pair.Value.Slots;
                for (int i = used; i < slots.Count; i++) {
                    var slot = slots[i];
                    slot.ActiveThisSample = false;
                    slot.LastBand = int.MinValue;
                    if (slot.Bound) {
                        slot.Bound = false;
                        stationWorld?.UnbindRuntimeTarget(slot.Target);
                    } else if (slot.Target != null) {
                        slot.Target.parked = true;
                    }
                    if (slot.Instance != null && slot.Instance.gameObject.activeSelf) {
                        slot.Instance.gameObject.SetActive(false);
                    }
                }
            }
        }

        /// <summary>
        /// Retire one component's vehicle pool cleanly during an affected-component swap.
        /// Disconnected component pools remain live and untouched.
        /// </summary>
        public void RemoveComponentPool(int componentSerial, StationWorldView stationWorld, StationLocalViewCommit commit) {
            if (!componentPools.TryGetValue(componentSerial, out var comp)) return;
            componentPools.Remove(componentSerial);
            foreach (var pool in comp.Pools.Values) {
                var slots = pool.Slots;
                for (int i = 0; i < slots.Count; i++) {
                    var slot = slots[i];
                    slot.ActiveThisSample = false;
                    if (slot.Bound) {
                        slot.Bound = false;
                        stationWorld?.UnbindRuntimeTarget(slot.Target);
                    }
                }
            }
            if (comp.Root != null) {
                if (commit != null) commit.RetiredViews.Add(comp.Root.gameObject);
                else DestroyNow(comp.Root.gameObject);
            }
        }

        public void BindWorld(StationWorldView stationWorld) {
            if (ReferenceEquals(world, stationWorld)) return;
            if (world != null) world.VisibilityApplied -= RefreshWorldCounts;
            world = stationWorld;
            if (world != null) world.VisibilityApplied += RefreshWorldCounts;
        }

        Material[] EnsurePaints() {
            if (paints != null) return paints;
            Shader lit = shader != null ? shader : Shader.Find("Universal Render Pipeline/Lit");
            if (!lit) lit = Shader.Find("Unlit/Color");
            if (!lit) lit = Shader.Find("Sprites/Default");
            if (!lit) throw new InvalidOperationException("RoadVehicleViews needs a shader for the generated fallback bodies");
            var materials = new Material[Enum.GetValues(typeof(Ink)).Length];
            materials[(int)Ink.Paint] = Paint(lit, new Color(0xa5 / 255f, 0xa5 / 255f, 0xa5 / 255f));
            materials[(int)Ink.Pale] = Paint(lit, new Color(0xe2 / 255f, 0xe2 / 255f, 0xe2 / 255f));
            materials[(int)Ink.Accent] = Paint(lit, new Color(0x77 / 255f, 0x77 / 255f, 0x77 / 255f));
            materials[(int)Ink.Glass] = Paint(lit, new Color(0x30 / 255f, 0x30 / 255f, 0x30 / 255f));
            materials[(int)Ink.Rubber] = Paint(lit, new Color(0x20 / 255f, 0x20 / 255f, 0x20 / 255f));
            materials[(int)Ink.Metal] = Paint(lit, new Color(0xbc / 255f, 0xbc / 255f, 0xbc / 255f));
            materials[(int)Ink.Lamp] = Paint(lit, new Color(0xf4 / 255f, 0xf4 / 255f, 0xf4 / 255f));
            materials[(int)Ink.Tail] = Paint(lit, new Color(0x55 / 255f, 0x55 / 255f, 0x55 / 255f));
            paints = materials;
            return paints;
        }

        Material Paint(Shader target, Color color) {
            var material = new Material(target) { color = color };
            material.SetInt("_Cull", 0);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            ownedMaterials.Add(material);
            return material;
        }

        GameObject ResolvePrefab(string variant) {
            if (Catalogue == null || !RoadVehicleViewKeys.TryForVariant(variant, out var key)) return null;
            return Catalogue.Prefab(key);
        }

        Pool PoolFor(string variant) {
            if (pools.TryGetValue(variant, out var pool)) return pool;
            var root = new GameObject("vehicles " + variant).transform;
            root.SetParent(transform, false);
            var prefab = ResolvePrefab(variant);
            pool = new Pool {
                Root = root, Prefab = prefab,
                PoseCorrection = prefab != null ? PoseCorrection(prefab) : Quaternion.identity,
            };
            pools.Add(variant, pool);
            for (int i = 0; i < PoolSize; i++) pool.Slots.Add(CreateSlot(variant, root, prefab, pool.PoseCorrection));
            return pool;
        }

        Slot CreateSlot(string variant, Transform parent, GameObject prefab, Quaternion correction) {
            var instance = InstantiateVehicle(variant, parent, prefab, correction);
            var target = instance.GetComponent<StationVisibilityTarget>() ?? instance.gameObject.AddComponent<StationVisibilityTarget>();
            target.Configure(StationPartRole.Vehicle, Array.Empty<int>(), isParked: true, isGradeOwned: true);
            target.Refresh();
            target.Apply(StationDrawMode.Hidden, null);
            return new Slot {
                Instance = instance,
                Target = target,
                IsPrefab = prefab != null,
                Variant = variant,
            };
        }

        /// <summary>
        /// Instantiate one vehicle view outside the traffic pools (test/preview seam).
        /// The promoted prefab is used when the catalogue resolves it; otherwise the
        /// explicit generated fallback body. No document state is touched.
        /// </summary>
        public Transform InstantiateVehicle(string variant, Transform parent) {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var prefab = ResolvePrefab(variant);
            var instance = InstantiateVehicle(variant, parent, prefab,
                prefab != null ? PoseCorrection(prefab) : Quaternion.identity);
            instance.gameObject.SetActive(true);
            return instance;
        }

        Transform InstantiateVehicle(string variant, Transform parent, GameObject prefab, Quaternion correction) {
            Transform instance;
            if (prefab != null) {
                var go = UnityEngine.Object.Instantiate(prefab, parent, false);
                StationRigidModelLods.Apply(go, prefab.name);
                go.name = "vehicle " + variant;
                // The promoted family is authored in metres; never scale the whole prefab.
                go.transform.localScale = Vector3.one;
                instance = go.transform;
                if (low) DisableShadows(instance);
            } else {
                instance = BuildGeneratedBody(variant, parent);
            }
            var key = instance.GetComponent<RoadVehicleKey>() ?? instance.gameObject.AddComponent<RoadVehicleKey>();
            key.kind = KindOf(variant);
            key.variant = variant;
            instance.localRotation = correction;
            instance.gameObject.SetActive(false);
            return instance;
        }

        /// <summary>
        /// One basis correction per prefab: map the prefab's own "Front" anchor onto the
        /// renderer's +Z-forward convention. All six promoted vehicles already carry
        /// Front = +Z and Up = +Y, so this is identity for them today; a differently
        /// based prefab is corrected here rather than with a per-type rotation.
        /// </summary>
        public static Quaternion PoseCorrection(GameObject prefab) {
            if (!prefab) return Quaternion.identity;
            Transform front = null;
            foreach (var candidate in prefab.GetComponentsInChildren<Transform>(true)) {
                if (candidate.name != "Front") continue;
                front = candidate;
                break;
            }
            if (front != null) {
                var local = front.position - prefab.transform.position;
                if (local.sqrMagnitude > 1e-6f)
                    return Quaternion.FromToRotation(local.normalized, Vector3.forward);
            }
            var renderers = prefab.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length > 0) {
                var bounds = renderers[0].bounds;
                for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
                if (bounds.size.x > bounds.size.z * 1.2f) return Quaternion.Euler(0, -90, 0);
            }
            return Quaternion.identity;
        }

        static void DisableShadows(Transform instance) {
            foreach (var renderer in instance.GetComponentsInChildren<Renderer>(true))
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        }

        Transform BuildGeneratedBody(string variant, Transform parent) {
            var data = new VehicleMesh { Low = low };
            bool suv = variant == "suv";
            bool bus = variant == "bus-orange" || variant == "bus-mosaic";
            bool bicycle = variant == "bicycle";
            if (suv || variant == "sedan") {
                float roof = suv ? 1.64f : 1.43f, belt = suv ? 1.03f : .88f;
                data.Box(Ink.Paint, new Vector3(0, belt * .62f, 0), new Vector3(1.72f, belt * .62f, 4.2f));
                data.Box(Ink.Glass, new Vector3(0, (belt + roof) / 2, -.16f), new Vector3(1.5f, roof - belt, 2.3f));
                data.Box(Ink.Paint, new Vector3(0, roof + .03f, -.25f), new Vector3(1.52f, .08f, 1.9f));
                foreach (float side in new[] { -1f, 1f }) {
                    data.Box(Ink.Rubber, new Vector3(side * .84f, .35f, 1.3f), new Vector3(.2f, .7f, .7f));
                    data.Box(Ink.Rubber, new Vector3(side * .84f, .35f, -1.3f), new Vector3(.2f, .7f, .7f));
                    data.Box(Ink.Accent, new Vector3(side * .883f, .55f, 0), new Vector3(.03f, .1f, 3.6f));
                }
                data.Box(Ink.Lamp, new Vector3(-.55f, .72f, 2.1f), new Vector3(.42f, .12f, .03f));
                data.Box(Ink.Lamp, new Vector3(.55f, .72f, 2.1f), new Vector3(.42f, .12f, .03f));
                data.Box(Ink.Tail, new Vector3(0, .78f, -2.1f), new Vector3(1.1f, .08f, .03f));
                data.Box(Ink.Glass, new Vector3(0, .95f, 2.08f), new Vector3(1.2f, .32f, .04f));
            } else if (bus) {
                bool mosaic = variant == "bus-mosaic";
                var body = mosaic ? Ink.Accent : Ink.Pale;
                var band = mosaic ? Ink.Tail : Ink.Paint;
                data.Box(body, new Vector3(0, 1.6f, 0), new Vector3(2.4f, 2.5f, 10f));
                data.Box(Ink.Glass, new Vector3(0, 2.16f, 0), new Vector3(2.42f, .95f, 9.3f));
                data.Box(band, new Vector3(0, .62f, 0), new Vector3(2.42f, .5f, 9.7f));
                data.Box(Ink.Pale, new Vector3(0, 2.93f, 0), new Vector3(2.3f, .2f, 9.7f));
                data.Box(Ink.Glass, new Vector3(0, 1.9f, 5.01f), new Vector3(2.1f, 1.5f, .04f));
                data.Box(Ink.Glass, new Vector3(0, 2.0f, -5.01f), new Vector3(1.9f, 1.2f, .04f));
                foreach (float side in new[] { -1f, 1f }) {
                    foreach (float z in new[] { 3.05f, -3.1f }) {
                        data.Box(Ink.Rubber, new Vector3(side * 1.08f, .46f, z), new Vector3(.3f, .92f, .92f));
                        data.Box(Ink.Rubber, new Vector3(side * 1.18f, .7f, z), new Vector3(.06f, .4f, 1.1f));
                    }
                    data.Box(Ink.Lamp, new Vector3(side * .72f, .95f, 5.03f), new Vector3(.3f, .2f, .03f));
                    data.Box(Ink.Tail, new Vector3(side * .88f, 1.0f, -5.03f), new Vector3(.22f, .14f, .03f));
                }
            } else {
                float radius = bicycle ? .33f : .26f;
                data.Box(Ink.Rubber, new Vector3(0, radius, .64f), new Vector3(.12f, radius * 2, radius * 2));
                data.Box(Ink.Rubber, new Vector3(0, radius, -.64f), new Vector3(.12f, radius * 2, radius * 2));
                data.Box(Ink.Paint, new Vector3(0, .55f, 0), new Vector3(.18f, .22f, 1.15f));
                data.Box(Ink.Paint, new Vector3(0, .82f, -.3f), new Vector3(.3f, .5f, .18f));
                data.Box(Ink.Accent, new Vector3(0, 1.12f, -.32f), new Vector3(.36f, .5f, .3f));
                data.Box(Ink.Glass, new Vector3(0, 1.5f, -.32f), new Vector3(.2f, .22f, .2f));
                data.Box(Ink.Metal, new Vector3(0, .85f, .52f), new Vector3(.52f, .06f, .06f));
                data.Box(Ink.Lamp, new Vector3(0, .82f, .67f), new Vector3(.16f, .1f, .04f));
            }
            var materials = EnsurePaints();
            var root = new GameObject("vehicle " + variant).transform;
            root.SetParent(parent, false);
            var meshes = data.Build(variant);
            foreach (var pair in meshes) {
                ownedMeshes.Add(pair.Value);
                var part = new GameObject(pair.Key.ToString(), typeof(MeshFilter), typeof(MeshRenderer));
                part.transform.SetParent(root, false);
                part.GetComponent<MeshFilter>().sharedMesh = pair.Value;
                part.GetComponent<MeshRenderer>().sharedMaterial = materials[(int)pair.Key];
            }
            return root;
        }

        static string KindOf(string variant) =>
            variant != null && variant.StartsWith("bus", StringComparison.Ordinal) ? "bus"
            : variant == "suv" || variant == "sedan" ? "car" : "scooter";

        /// <summary>Poses every vehicle for the current station clock; reused transforms only.</summary>
        public void Render(double simTimeSeconds) {
            if (world != null) {
                RenderForWorld(simTimeSeconds, world);
                return;
            }
            Render(simTimeSeconds, null);
        }

        /// <summary>
        /// World-bound presentation pass: routes every active pooled vehicle slot through
        /// <see cref="StationWorldView"/>'s shared <see cref="StationVisibilityRegistry"/>
        /// (`Hidden`, `Base` or `Ghost`, plus grade ownership and live-bounds section clipping).
        /// </summary>
        public void RenderForWorld(double simTimeSeconds, StationWorldView stationWorld) {
            if (Traffic == null) return;
            BindWorld(stationWorld);
            Traffic.Sample(simTimeSeconds, sampled);
            SampledTime = simTimeSeconds;
            SampledVehicles = sampled.Count;
            countScratch.Clear();

            var grid = stationWorld?.Visibility != null
                ? stationWorld.Visibility.State.Grid
                : StationLevelGrid.FromDocument(stationWorld?.Document?.LevelBase ?? 0, stationWorld?.Document?.StoreyHeight ?? 5);

            for (int i = 0; i < sampled.Count; i++) {
                var pose = sampled[i];
                var variant = string.IsNullOrEmpty(pose.Variant) ? "sedan" : pose.Variant;
                var pool = PoolFor(variant);
                int index = countScratch.TryGetValue(variant, out var held) ? held : 0;
                while (pool.Slots.Count <= index) {
                    pool.Slots.Add(CreateSlot(variant, pool.Root, pool.Prefab, pool.PoseCorrection));
                }
                var slot = pool.Slots[index];
                countScratch[variant] = index + 1;

                slot.Pose = pose;
                slot.Variant = variant;
                slot.ActiveThisSample = true;
                slot.Instance.localPosition = new Vector3((float)pose.X, (float)pose.Z, (float)pose.Y);
                slot.Instance.localRotation = Quaternion.Euler(0, (float)(-pose.Heading * 180.0 / Math.PI), 0) * pool.PoseCorrection;
                if (!slot.Instance.gameObject.activeSelf) slot.Instance.gameObject.SetActive(true);
                var key = slot.Instance.GetComponent<RoadVehicleKey>();
                if (key) { key.vehicleId = pose.Id; key.variant = variant; }

                int band = StationModuleLevels.Band(grid, pose.RoadZ);
                bool dirty = !slot.Bound || slot.Target.Parked || slot.LastBand != band ||
                    (stationWorld?.Visibility != null && stationWorld.Visibility.SectionClipping);
                slot.BandSlot[0] = band;
                slot.Target.levels = slot.BandSlot;
                slot.Target.gradeOwned = true;
                slot.Target.parked = false;
                slot.LastBand = band;

                if (stationWorld != null) {
                    if (!slot.Bound) {
                        slot.Bound = true;
                        stationWorld.BindRuntimeTarget(slot.Target);
                    } else if (dirty) {
                        stationWorld.ApplyRuntimeTarget(slot.Target);
                    }
                } else {
                    slot.Target.Apply(StationDrawMode.Base, null);
                }
            }

            foreach (var pair in pools) {
                int used = countScratch.TryGetValue(pair.Key, out var u) ? u : 0;
                var slots = pair.Value.Slots;
                for (int i = used; i < slots.Count; i++) {
                    var slot = slots[i];
                    slot.ActiveThisSample = false;
                    slot.LastBand = int.MinValue;
                    if (slot.Bound) {
                        slot.Bound = false;
                        stationWorld?.UnbindRuntimeTarget(slot.Target);
                    } else if (slot.Target != null) {
                        slot.Target.parked = true;
                    }
                    if (slot.Instance != null && slot.Instance.gameObject.activeSelf) {
                        slot.Instance.gameObject.SetActive(false);
                    }
                }
            }

            RefreshWorldCounts();
        }

        public void RefreshWorldCounts() {
            if (world == null) return;
            poses.Clear();
            FilteredVehicles = 0;
            Cars = Buses = Scooters = Bicycles = Mopeds = PrefabVehicleViews = FallbackVehicleViews = 0;
            void AccumulatePool(Pool pool) {
                var slots = pool.Slots;
                for (int i = 0; i < slots.Count; i++) {
                    var slot = slots[i];
                    if (!slot.ActiveThisSample || slot.Instance == null || !slot.Instance.gameObject.activeSelf) continue;
                    bool visible = world.Visibility == null || slot.Target == null || slot.Target.LastMode != StationDrawMode.Hidden;
                    if (!visible) {
                        FilteredVehicles++;
                        continue;
                    }
                    var pose = slot.Pose;
                    poses.Add(pose);
                    if (slot.IsPrefab) PrefabVehicleViews++;
                    else FallbackVehicleViews++;
                    switch (pose.Kind) {
                        case RoadVehicleKind.Car: Cars++; break;
                        case RoadVehicleKind.Bus: Buses++; break;
                        default: Scooters++; break;
                    }
                    if (slot.Variant == "bicycle") Bicycles++;
                    else if (slot.Variant == "moped") Mopeds++;
                }
            }
            if (multiComponent) {
                int totalSampled = 0;
                foreach (var comp in componentPools.Values) {
                    totalSampled += comp.SampledCount;
                    foreach (var pool in comp.Pools.Values) AccumulatePool(pool);
                }
                SampledVehicles = totalSampled;
            } else {
                foreach (var pool in pools.Values) AccumulatePool(pool);
            }
            Riders = Mopeds + Bicycles;
            VisibleVehicles = poses.Count;
        }

        /// <summary>
        /// Poses the sampled traffic, but only for poses <paramref name="visible"/> accepts.
        /// Kept as a direct predicate seam for standalone tests without a bound world.
        /// </summary>
        public void Render(double simTimeSeconds, Func<RoadVehiclePose, bool> visible) {
            if (Traffic == null) return;
            Traffic.Sample(simTimeSeconds, sampled);
            SampledTime = simTimeSeconds;
            poses.Clear();
            FilteredVehicles = 0;
            for (int i = 0; i < sampled.Count; i++) {
                var pose = sampled[i];
                if (visible != null && !visible(pose)) { FilteredVehicles++; continue; }
                poses.Add(pose);
            }
            SampledVehicles = sampled.Count;
            countScratch.Clear();
            Cars = Buses = Scooters = Bicycles = Mopeds = PrefabVehicleViews = FallbackVehicleViews = 0;
            foreach (var pose in poses) {
                var variant = string.IsNullOrEmpty(pose.Variant) ? "sedan" : pose.Variant;
                var pool = PoolFor(variant);
                int index = countScratch.TryGetValue(variant, out var held) ? held : 0;
                while (pool.Slots.Count <= index)
                    pool.Slots.Add(CreateSlot(variant, pool.Root, pool.Prefab, pool.PoseCorrection));
                var slot = pool.Slots[index];
                var instance = slot.Instance;
                countScratch[variant] = index + 1;
                slot.ActiveThisSample = true;
                slot.Pose = pose;
                slot.Variant = variant;
                instance.gameObject.SetActive(true);
                if (slot.Target != null) {
                    slot.Target.parked = false;
                    slot.Target.Apply(StationDrawMode.Base, null);
                }
                instance.localPosition = new Vector3((float)pose.X, (float)pose.Z, (float)pose.Y);
                instance.localRotation = Quaternion.Euler(0, (float)(-pose.Heading * 180.0 / Math.PI), 0) * pool.PoseCorrection;
                var key = instance.GetComponent<RoadVehicleKey>();
                if (key) { key.vehicleId = pose.Id; key.variant = variant; }
                if (pool.Prefab != null) PrefabVehicleViews++;
                else FallbackVehicleViews++;
                switch (pose.Kind) {
                    case RoadVehicleKind.Car: Cars++; break;
                    case RoadVehicleKind.Bus: Buses++; break;
                    default: Scooters++; break;
                }
                if (variant == "bicycle") Bicycles++;
                else if (variant == "moped") Mopeds++;
            }
            Riders = Mopeds + Bicycles;
            VisibleVehicles = poses.Count;
            foreach (var pair in pools) {
                var slots = pair.Value.Slots;
                for (int i = 0; i < slots.Count; i++) {
                    if (!countScratch.TryGetValue(pair.Key, out var used) || i >= used) {
                        slots[i].ActiveThisSample = false;
                        if (slots[i].Target != null) slots[i].Target.parked = true;
                        slots[i].Instance.gameObject.SetActive(false);
                    }
                }
            }
        }

        /// <summary>The pooled instance currently showing a simulation vehicle id, if any.</summary>
        public bool TryGetRenderedVehicle(int vehicleId, out Transform instance) {
            bool SearchPool(Pool pool, out Transform found) {
                foreach (var slot in pool.Slots) {
                    var candidate = slot.Instance;
                    if (!candidate || !candidate.gameObject.activeSelf) continue;
                    if (world != null && world.Visibility != null && slot.Target != null &&
                        slot.Target.LastMode == StationDrawMode.Hidden) {
                        continue;
                    }
                    var key = candidate.GetComponent<RoadVehicleKey>();
                    if (key && key.vehicleId == vehicleId) { found = candidate; return true; }
                }
                found = null;
                return false;
            }
            if (multiComponent) {
                foreach (var comp in componentPools.Values) {
                    foreach (var pool in comp.Pools.Values) {
                        if (SearchPool(pool, out instance)) return true;
                    }
                }
            } else {
                foreach (var pool in pools.Values) {
                    if (SearchPool(pool, out instance)) return true;
                }
            }
            instance = null;
            return false;
        }

        /// <summary>Camera/view filtering hook; vehicles never carry document state.</summary>
        public void SetVisible(bool visible) {
            if (multiComponent) {
                foreach (var comp in componentPools.Values) {
                    if (comp.Root != null) comp.Root.gameObject.SetActive(visible);
                }
                return;
            }
            foreach (var pool in pools.Values) pool.Root.gameObject.SetActive(visible);
        }

        public bool TryVehicleId(Collider collider, out int id) {
            id = -1;
            if (!collider) return false;
            var key = collider.GetComponentInParent<RoadVehicleKey>();
            if (!key) return false;
            id = key.vehicleId;
            return true;
        }

        void OnDestroy() {
            if (world != null) {
                world.VisibilityApplied -= RefreshWorldCounts;
                foreach (var pool in pools.Values) {
                    for (int i = 0; i < pool.Slots.Count; i++) {
                        if (pool.Slots[i].Bound) {
                            pool.Slots[i].Bound = false;
                            world.UnbindRuntimeTarget(pool.Slots[i].Target);
                        }
                    }
                }
                foreach (var comp in componentPools.Values) {
                    foreach (var pool in comp.Pools.Values) {
                        for (int i = 0; i < pool.Slots.Count; i++) {
                            if (pool.Slots[i].Bound) {
                                pool.Slots[i].Bound = false;
                                world.UnbindRuntimeTarget(pool.Slots[i].Target);
                            }
                        }
                    }
                }
                world = null;
            }
            for (int i = 0; i < ownedMeshes.Count; i++) DestroyNow(ownedMeshes[i]);
            for (int i = 0; i < ownedMaterials.Count; i++) DestroyNow(ownedMaterials[i]);
            ownedMeshes.Clear();
            ownedMaterials.Clear();
        }

        static void DestroyNow(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) Destroy(value); else DestroyImmediate(value);
        }
    }
}
