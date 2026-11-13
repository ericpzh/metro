using System;
using System.Collections.Generic;
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

        sealed class Pool {
            public readonly List<Transform> Instances = new List<Transform>();
            public Transform Root;
            public GameObject Prefab;
            public Quaternion PoseCorrection = Quaternion.identity;
        }

        readonly List<Material> ownedMaterials = new List<Material>();
        readonly List<Mesh> ownedMeshes = new List<Mesh>();
        readonly Dictionary<string, Pool> pools = new Dictionary<string, Pool>(StringComparer.Ordinal);
        readonly List<RoadVehiclePose> poses = new List<RoadVehiclePose>();
        readonly List<string> missingPrefabs = new List<string>();
        Material[] paints;
        Shader shader;
        bool low;

        public StationRoadTraffic Traffic { get; private set; }
        /// <summary>The catalogue the prefabs were resolved from; null means explicit fallback.</summary>
        public RuntimeCatalogue Catalogue { get; private set; }
        public int VisibleVehicles { get; private set; }
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
        public static RoadVehicleViews Build(Transform parent, StationRoadTraffic traffic, Shader shader,
            bool lowDetail, RuntimeCatalogue catalogue, Action<string, string> reportMissing) {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var view = parent.gameObject.AddComponent<RoadVehicleViews>();
            view.Traffic = traffic ?? throw new ArgumentNullException(nameof(traffic));
            view.shader = shader;
            view.low = lowDetail;
            view.Catalogue = catalogue;
            for (int i = 0; i < RoadVehicleViewKeys.Variants.Length; i++) {
                var variant = RoadVehicleViewKeys.Variants[i];
                var key = RoadVehicleViewKeys.All[i];
                if (view.ResolvePrefab(variant) != null) continue;
                var detail = catalogue == null
                    ? $"{key} ({variant}): no runtime catalogue was supplied"
                    : $"{key} ({variant}): catalogue has no prefab for {RoadVehicleViewKeys.PrefabPath(key)}";
                view.missingPrefabs.Add($"{key} ({variant})");
                Debug.LogWarning("RoadVehicleViews: " + detail + "; using the generated fallback body.");
                reportMissing?.Invoke("missing-vehicle-prefab", detail);
            }
            return view;
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
            for (int i = 0; i < PoolSize; i++) pool.Instances.Add(InstantiateVehicle(variant, root, prefab, pool.PoseCorrection));
            return pool;
        }

        /// <summary>
        /// Instantiate one vehicle view outside the traffic pools (test/preview seam).
        /// The promoted prefab is used when the catalogue resolves it; otherwise the
        /// explicit generated fallback body. No document state is touched.
        /// </summary>
        public Transform InstantiateVehicle(string variant, Transform parent) {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var prefab = ResolvePrefab(variant);
            return InstantiateVehicle(variant, parent, prefab,
                prefab != null ? PoseCorrection(prefab) : Quaternion.identity);
        }

        Transform InstantiateVehicle(string variant, Transform parent, GameObject prefab, Quaternion correction) {
            Transform instance;
            if (prefab != null) {
                var go = UnityEngine.Object.Instantiate(prefab, parent, false);
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
            if (Traffic == null) return;
            Traffic.Sample(simTimeSeconds, poses);
            SampledTime = simTimeSeconds;
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            Cars = Buses = Scooters = Bicycles = Mopeds = PrefabVehicleViews = FallbackVehicleViews = 0;
            foreach (var pose in poses) {
                var variant = string.IsNullOrEmpty(pose.Variant) ? "sedan" : pose.Variant;
                var pool = PoolFor(variant);
                int index = counts.TryGetValue(variant, out var held) ? held : 0;
                while (pool.Instances.Count <= index)
                    pool.Instances.Add(InstantiateVehicle(variant, pool.Root, pool.Prefab, pool.PoseCorrection));
                var instance = pool.Instances[index];
                counts[variant] = index + 1;
                instance.gameObject.SetActive(true);
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
            VisibleVehicles = poses.Count;
            foreach (var pair in pools)
                for (int i = 0; i < pair.Value.Instances.Count; i++)
                    if (!counts.TryGetValue(pair.Key, out var used) || i >= used)
                        pair.Value.Instances[i].gameObject.SetActive(false);
        }

        /// <summary>The pooled instance currently showing a simulation vehicle id, if any.</summary>
        public bool TryGetRenderedVehicle(int vehicleId, out Transform instance) {
            foreach (var pool in pools.Values) {
                foreach (var candidate in pool.Instances) {
                    if (!candidate || !candidate.gameObject.activeSelf) continue;
                    var key = candidate.GetComponent<RoadVehicleKey>();
                    if (key && key.vehicleId == vehicleId) { instance = candidate; return true; }
                }
            }
            instance = null;
            return false;
        }

        /// <summary>Camera/view filtering hook; vehicles never carry document state.</summary>
        public void SetVisible(bool visible) {
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
