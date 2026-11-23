using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App.Views {
    /// <summary>
    /// Shared procedural assets for floor contact-shadow blobs (`render/materials.ts` &
    /// `ModuleSystem.ts` / `CrowdSystem.ts`): a 1.24 m unit XZ quad, a 64×64 feathered rectangular
    /// texture for floor-standing equipment, and a 64×64 radial gradient texture for passengers.
    /// </summary>
    public static class StationContactShadowAssets {
        public const float BaseQuadSize = 1.24f;
        public const float BlobOpacity = .9f;
        public const float EquipmentLiftZ = 1.012f;
        public const float PassengerLiftY = .03f;

        static Mesh quadMesh;
        static Texture2D equipmentTexture;
        static Texture2D passengerTexture;

        public static Mesh QuadMesh() {
            if (quadMesh != null) return quadMesh;
            float h = BaseQuadSize * .5f;
            var mesh = new Mesh { name = "contact shadow quad" };
            mesh.vertices = new[] {
                new Vector3(-h, 0f, -h), new Vector3(h, 0f, -h),
                new Vector3(h, 0f, h), new Vector3(-h, 0f, h),
            };
            mesh.uv = new[] {
                new Vector2(0f, 0f), new Vector2(1f, 0f),
                new Vector2(1f, 1f), new Vector2(0f, 1f),
            };
            mesh.normals = new[] { Vector3.up, Vector3.up, Vector3.up, Vector3.up };
            mesh.triangles = new[] { 0, 2, 1, 0, 3, 2 };
            mesh.RecalculateBounds();
            mesh.hideFlags = HideFlags.HideAndDontSave;
            quadMesh = mesh;
            return quadMesh;
        }

        /// <summary>Feathered 64×64 rectangular footprint (`render/materials.ts:455-464`).</summary>
        public static Texture2D EquipmentTexture() {
            if (equipmentTexture != null) return equipmentTexture;
            var tex = new Texture2D(64, 64, TextureFormat.RGBA32, false) {
                name = "contact-shadow-equipment",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                hideFlags = HideFlags.HideAndDontSave,
            };
            var pixels = new Color32[64 * 64];
            for (int y = 0; y < 64; y++) {
                for (int x = 0; x < 64; x++) {
                    float edge = Mathf.Min(Mathf.Min(x, y), Mathf.Min(63 - x, 63 - y)) / 12f;
                    float alpha = Mathf.Clamp01(edge);
                    byte a = (byte)Mathf.RoundToInt(115f * alpha * alpha * (3f - 2f * alpha));
                    pixels[y * 64 + x] = new Color32(0, 0, 0, a);
                }
            }
            tex.SetPixels32(pixels);
            tex.Apply(false, false);
            equipmentTexture = tex;
            return equipmentTexture;
        }

        /// <summary>Soft 64×64 radial gradient blob for passengers (`render/materials.ts:contactShadowTexture`).</summary>
        public static Texture2D PassengerTexture() {
            if (passengerTexture != null) return passengerTexture;
            var tex = new Texture2D(64, 64, TextureFormat.RGBA32, false) {
                name = "contact-shadow-passenger",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                hideFlags = HideFlags.HideAndDontSave,
            };
            var pixels = new Color32[64 * 64];
            for (int y = 0; y < 64; y++) {
                for (int x = 0; x < 64; x++) {
                    float dx = x + .5f - 32f;
                    float dy = y + .5f - 32f;
                    float dist = Mathf.Sqrt(dx * dx + dy * dy);
                    float t = Mathf.Clamp01((dist - 2f) / 28f);
                    float alpha = t <= .6f
                        ? Mathf.Lerp(.55f, .22f, t / .6f)
                        : Mathf.Lerp(.22f, 0f, (t - .6f) / .4f);
                    pixels[y * 64 + x] = new Color32(0, 0, 0, (byte)Mathf.RoundToInt(alpha * 255f));
                }
            }
            tex.SetPixels32(pixels);
            tex.Apply(false, false);
            passengerTexture = tex;
            return passengerTexture;
        }

        public static Material CreateMaterial(Texture2D texture, string name) {
            var shader = Shader.Find("Metro/Station Section Unlit")
                ?? Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Unlit/Transparent");
            if (shader == null) return null;
            var material = new Material(shader) {
                name = name ?? "contact-shadow",
                enableInstancing = true,
                renderQueue = (int)RenderQueue.Transparent + 2,
            };
            var tint = new Color(1f, 1f, 1f, BlobOpacity);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", tint);
            if (material.HasProperty("_Color")) material.color = tint;
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", texture);
            if (material.HasProperty("_MainTex")) material.SetTexture("_MainTex", texture);
            material.mainTexture = texture;
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_Blend")) material.SetFloat("_Blend", 0f);
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            return material;
        }
    }

    /// <summary>
    /// Eligibility and footprint sizing for equipment contact shadows (`SceneSystem.ts:blobRadius`
    /// and `ModuleSystem.ts:addBlob`).
    /// </summary>
    public static class StationContactShadowRules {
        public static float BlobRadius(string type) {
            switch (type ?? "") {
                case "roof":
                case "fence":
                case "door":
                case "court":
                case "tactile":
                case "floor-mark":
                case "track":
                case "platform-edge":
                case "psd-end":
                case "escalator":
                case "walkway":
                case "stair":
                case "sidewalk":
                case "lawn":
                case "road":
                case "shop":
                case "booth":
                case "retail":
                case "billboard":
                case "glass":
                case "calligraphy":
                case "linemap":
                case "sign":
                case "tv":
                    return 0f;
                case "tree":
                    return .4f;
                case "exit":
                case "lift":
                    return 1.5f;
                default:
                    return string.IsNullOrEmpty(type) ? 0f : .8f;
            }
        }

        public static bool IsEligible(StationModuleRecord module) {
            if (module == null) return false;
            if (BlobRadius(module.Type) <= 0f) return false;
            if (StationFootprints.IsCeilingHung(module) || StationFootprints.IsWallMounted(module)) return false;
            return true;
        }

        public static string FootSubmeshName(string type) {
            switch (type ?? "") {
                case "gate": return "gate-plinth";
                case "hanger": return "hanger-base";
                case "cctv": return "cctv-post-base";
                case "traffic-light": return "traffic-light-base";
                case "rail-signal": return "signal-concrete-base";
                default: return null;
            }
        }

        public static bool IsTightFootprint(string type) =>
            type == "gate" || type == "shelf" || type == "bin" || type == "extinguisher";

        /// <summary>Compute the world-space TRS matrix and document-space box for one module's shadow blob.</summary>
        public static Matrix4x4 ComputeBlobMatrix(StationModuleRecord module, StationWorldView world,
            out StationBox documentBox) {
            float r = BlobRadius(module.Type);
            float cx = module.X + .5f;
            float cy = module.Y + .5f;
            float z = module.Z + StationContactShadowAssets.EquipmentLiftZ;
            float rx = r;
            float ry = r;

            if (!string.Equals(module.Type, "tree", StringComparison.Ordinal)) {
                bool hasFoot = TryResolveFootOrBounds(module, world, out var bounds, out bool usedFootBase);
                if (hasFoot) {
                    float width = (float)(bounds.X1 - bounds.X0);
                    float depth = (float)(bounds.Y1 - bounds.Y0);
                    bool tight = IsTightFootprint(module.Type);
                    if (width > 1e-4f && depth > 1e-4f &&
                        (tight || usedFootBase || Mathf.Max(width, depth) > 1.1f)) {
                        float pad = tight ? .12f : .35f;
                        cx = (float)(bounds.X0 + bounds.X1) * .5f;
                        cy = (float)(bounds.Y0 + bounds.Y1) * .5f;
                        rx = (width + pad) / StationContactShadowAssets.BaseQuadSize;
                        ry = (depth + pad) / StationContactShadowAssets.BaseQuadSize;
                    }
                }
            }

            float halfX = rx * StationContactShadowAssets.BaseQuadSize * .5f;
            float halfY = ry * StationContactShadowAssets.BaseQuadSize * .5f;
            documentBox = new StationBox(cx - halfX, cy - halfY, z - .005, cx + halfX, cy + halfY, z + .005);
            var pos = StationCoordinates.Point(new Vector3(cx, cy, z));
            return Matrix4x4.TRS(pos, Quaternion.identity, new Vector3(rx, 1f, ry));
        }

        static bool TryResolveFootOrBounds(StationModuleRecord module, StationWorldView world,
            out StationBox bounds, out bool usedFootBase) {
            usedFootBase = false;
            bounds = default;
            if (world != null && world.TryGetModule(module.Id, out var rec) && rec != null) {
                var footName = FootSubmeshName(module.Type);
                if (!string.IsNullOrEmpty(footName) && rec.View != null) {
                    var foot = FindDescendant(rec.View.transform, footName);
                    if (foot != null && TryMeasureDocumentBounds(foot, out bounds)) {
                        usedFootBase = true;
                        return true;
                    }
                }
                if (rec.HasBounds && !rec.Bounds.IsEmpty) {
                    bounds = rec.Bounds;
                    return true;
                }
            }
            // Check batched instanced records (SourceIds + SourceBounds).
            if (world != null) {
                var records = world.Records;
                for (int i = 0; i < records.Count; i++) {
                    var rec2 = records[i];
                    if (rec2 == null || rec2.SourceIds == null || rec2.SourceBounds == null) continue;
                    if (string.Equals(rec2.Role, StationContactShadowRenderer.RoleName, StringComparison.Ordinal)) continue;
                    int idx = Array.IndexOf(rec2.SourceIds, module.Id);
                    if (idx >= 0 && idx < rec2.SourceBounds.Length && !rec2.SourceBounds[idx].IsEmpty) {
                        bounds = rec2.SourceBounds[idx];
                        return true;
                    }
                }
            }
            // Fallback to authored cell footprint.
            var cells = StationFootprints.Footprint(module);
            if (cells == null || cells.Length == 0) return false;
            int minX = int.MaxValue, minY = int.MaxValue, maxX = int.MinValue, maxY = int.MinValue;
            for (int i = 0; i < cells.Length; i++) {
                int cx = (int)Math.Round(cells[i].X);
                int cy = (int)Math.Round(cells[i].Y);
                if (cx < minX) minX = cx;
                if (cy < minY) minY = cy;
                if (cx > maxX) maxX = cx;
                if (cy > maxY) maxY = cy;
            }
            bounds = new StationBox(minX, minY, module.Z + 1, maxX + 1, maxY + 1, module.Z + 2);
            return true;
        }

        static Transform FindDescendant(Transform root, string name) {
            if (root == null) return null;
            if (string.Equals(root.name, name, StringComparison.Ordinal)) return root;
            for (int i = 0; i < root.childCount; i++) {
                var found = FindDescendant(root.GetChild(i), name);
                if (found != null) return found;
            }
            return null;
        }

        static bool TryMeasureDocumentBounds(Transform root, out StationBox box) {
            box = default;
            var renderers = root.GetComponentsInChildren<Renderer>(false);
            if (renderers == null || renderers.Length == 0) return false;
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            bool any = false;
            for (int i = 0; i < renderers.Length; i++) {
                var r = renderers[i];
                if (r == null) continue;
                var b = r.bounds;
                for (int c = 0; c < 8; c++) {
                    var p = new Vector3(
                        (c & 1) == 0 ? b.min.x : b.max.x,
                        (c & 2) == 0 ? b.min.y : b.max.y,
                        (c & 4) == 0 ? b.min.z : b.max.z);
                    var doc = StationCoordinates.WorldToDocument(p);
                    min = Vector3.Min(min, doc);
                    max = Vector3.Max(max, doc);
                    any = true;
                }
            }
            if (!any) return false;
            box = new StationBox(min.x, min.y, min.z, max.x, max.y, max.z);
            return !box.IsEmpty;
        }
    }

    /// <summary>
    /// Batched GPU-instanced contact-shadow producer for eligible floor-standing equipment
    /// (plan 37 §5.3). Groups shadows by `(storeyBand, gradeOwned)`, registers under role
    /// <c>"contact-shadows"</c> (unpickable, active-storey visibility, automatic move-hiding
    /// via <see cref="StationViewRecord.SourceIds"/>), and updates only affected level buckets
    /// on local edits.
    /// </summary>
    public sealed class StationContactShadowRenderer : IStationViewRenderer, IStationLocalViewRenderer {
        public const string RoleName = "contact-shadows";

        readonly struct BucketKey : IEquatable<BucketKey> {
            public readonly int Band;
            public readonly bool GradeOwned;
            public BucketKey(int band, bool gradeOwned) { Band = band; GradeOwned = gradeOwned; }
            public bool Equals(BucketKey other) => Band == other.Band && GradeOwned == other.GradeOwned;
            public override bool Equals(object obj) => obj is BucketKey other && Equals(other);
            public override int GetHashCode() => (Band * 397) ^ (GradeOwned ? 1 : 0);
        }

        sealed class BuiltBucket {
            public BucketKey Key;
            public GameObject View;
            public StationInstancedSurfaceBatch Batch;
            public Mesh ProxyMesh;
            public StationViewRecord Record;
            public readonly HashSet<string> ModuleIds = new HashSet<string>(StringComparer.Ordinal);
        }

        sealed class WorldState {
            public Material Material;
            public StationInstancedSurfaceDrawer Drawer;
            public Transform RoleRoot;
            public readonly Dictionary<BucketKey, BuiltBucket> Buckets = new Dictionary<BucketKey, BuiltBucket>();
            public readonly Dictionary<string, BucketKey> ModuleBuckets = new Dictionary<string, BucketKey>(StringComparer.Ordinal);
        }

        sealed class NoOpStage : IStationLocalRendererStage {
            public void Commit(StationWorldView world, StationLocalViewCommit commit) { }
            public void Dispose() { }
        }

        sealed class StagedShadowDelta : IStationLocalRendererStage {
            readonly WorldState state;
            readonly HashSet<BucketKey> dirtyKeys;
            readonly Dictionary<BucketKey, BuiltBucket> replacements;
            bool committed;

            public StagedShadowDelta(WorldState state,
                HashSet<BucketKey> dirtyKeys, Dictionary<BucketKey, BuiltBucket> replacements) {
                this.state = state;
                this.dirtyKeys = dirtyKeys;
                this.replacements = replacements;
            }

            public void Commit(StationWorldView world, StationLocalViewCommit commit) {
                committed = true;
                foreach (var key in dirtyKeys) {
                    if (state.Buckets.TryGetValue(key, out var oldBucket)) {
                        if (state.Drawer != null && oldBucket.Batch != null) state.Drawer.Remove(oldBucket.Batch);
                        if (oldBucket.View != null) {
                            var oldView = oldBucket.View;
                            world.RetireRecordsWhere(r => r != null && ReferenceEquals(r.View, oldView), commit, true);
                        }
                        if (oldBucket.ProxyMesh != null) commit.RetiredMeshes.Add(oldBucket.ProxyMesh);
                        foreach (var id in oldBucket.ModuleIds) state.ModuleBuckets.Remove(id);
                        state.Buckets.Remove(key);
                    }
                    if (replacements.TryGetValue(key, out var nextBucket)) {
                        nextBucket.View.transform.SetParent(state.RoleRoot, false);
                        nextBucket.View.SetActive(true);
                        state.Drawer?.Add(nextBucket.Batch);
                        var r = nextBucket.Record;
                        world.RegisterModule(r.Role, r.ModuleId, r.View, r.Part,
                            r.HasBounds ? r.Bounds : (StationBox?)null,
                            r.LevelMin, r.LevelMax, r.LevelBands, r.SourceIds, r.SourceBounds, r.GradeOwned);
                        commit.AddedRecords.Add(world.Records[world.Records.Count - 1]);
                        state.Buckets[key] = nextBucket;
                        foreach (var id in nextBucket.ModuleIds) state.ModuleBuckets[id] = key;
                    }
                }
            }

            public void Dispose() {
                if (committed) return;
                foreach (var bucket in replacements.Values) {
                    if (bucket.ProxyMesh != null) DestroyAsset(bucket.ProxyMesh);
                    if (bucket.View != null) StationWorldView.DestroyView(bucket.View);
                }
                replacements.Clear();
            }
        }

        readonly Dictionary<StationWorldView, WorldState> states = new Dictionary<StationWorldView, WorldState>();

        public string Role => RoleName;
        public bool Claims(string moduleType) => false;

        public void Build(StationViewBuildContext context) {
            if (context?.World == null || context.Document == null) return;
            var material = StationContactShadowAssets.CreateMaterial(
                StationContactShadowAssets.EquipmentTexture(), "station contact shadows");
            if (material == null) return;
            var roleRoot = context.RoleRoot(RoleName);
            var drawer = StationInstancedSurfaceDrawer.EnsureFor(context.Root);
            var state = new WorldState { Material = material, Drawer = drawer, RoleRoot = roleRoot };
            states[context.World] = state;

            var grid = StationLevelGrid.FromDocument(context.Document.LevelBase, context.Document.StoreyHeight);
            var grouped = GroupModules(context.Document.Modules, grid);
            foreach (var pair in grouped) {
                var bucket = BuildBucket(pair.Key, pair.Value, context.World, material, roleRoot, active: true);
                if (bucket == null) continue;
                drawer?.Add(bucket.Batch);
                var r = bucket.Record;
                context.World.RegisterModule(r.Role, r.ModuleId, r.View, r.Part,
                    r.HasBounds ? r.Bounds : (StationBox?)null,
                    r.LevelMin, r.LevelMax, r.LevelBands, r.SourceIds, r.SourceBounds, r.GradeOwned);
                state.Buckets[pair.Key] = bucket;
                foreach (var id in bucket.ModuleIds) state.ModuleBuckets[id] = pair.Key;
            }
        }

        public bool TryStageLocalDelta(StationLocalDeltaContext context, out IStationLocalRendererStage stage,
            out string fallbackReason) {
            stage = null;
            fallbackReason = null;
            if (context?.World == null || context.NextDocument == null) { fallbackReason = "no-world"; return false; }
            if (!states.TryGetValue(context.World, out var state) || state.Material == null) { fallbackReason = "no-state"; return false; }
            var delta = context.Delta;
            if (delta == null) { stage = new NoOpStage(); return true; }

            var grid = StationLevelGrid.FromDocument(context.NextDocument.LevelBase, context.NextDocument.StoreyHeight);
            var dirtyKeys = new HashSet<BucketKey>();
            for (int i = 0; i < delta.RemovedModules.Count; i++) {
                if (state.ModuleBuckets.TryGetValue(delta.RemovedModules[i], out var oldKey)) dirtyKeys.Add(oldKey);
            }
            for (int i = 0; i < delta.ChangedModules.Count; i++) {
                var mod = delta.ChangedModules[i];
                if (mod == null) continue;
                if (state.ModuleBuckets.TryGetValue(mod.Id, out var oldKey)) dirtyKeys.Add(oldKey);
                if (StationContactShadowRules.IsEligible(mod)) {
                    dirtyKeys.Add(KeyOf(mod, grid));
                }
            }
            if (dirtyKeys.Count == 0) {
                stage = new NoOpStage();
                return true;
            }

            var grouped = GroupModules(context.NextDocument.Modules, grid, dirtyKeys);
            var replacements = new Dictionary<BucketKey, BuiltBucket>();
            foreach (var key in dirtyKeys) {
                if (!grouped.TryGetValue(key, out var list) || list.Count == 0) continue;
                var bucket = BuildBucket(key, list, context.World, state.Material, context.StagingRoot, active: false);
                if (bucket != null) replacements[key] = bucket;
            }
            stage = new StagedShadowDelta(state, dirtyKeys, replacements);
            return true;
        }

        public void Release() {
            var dead = new List<StationWorldView>();
            foreach (var pair in states) {
                if (pair.Key != null && !pair.Key.IsDisposed) continue;
                var st = pair.Value;
                if (st != null) {
                    foreach (var bucket in st.Buckets.Values) {
                        if (st.Drawer != null && bucket.Batch != null) st.Drawer.Remove(bucket.Batch);
                        if (bucket.ProxyMesh != null) DestroyAsset(bucket.ProxyMesh);
                    }
                    if (st.Material != null) DestroyAsset(st.Material);
                }
                dead.Add(pair.Key);
            }
            for (int i = 0; i < dead.Count; i++) states.Remove(dead[i]);
        }

        static BucketKey KeyOf(StationModuleRecord module, StationLevelGrid grid) =>
            new BucketKey(StationModuleLevels.Band(grid, module.Z), module.Z == StationViewFeature.GroundZ);

        static Dictionary<BucketKey, List<StationModuleRecord>> GroupModules(
            IReadOnlyList<StationModuleRecord> modules, StationLevelGrid grid, HashSet<BucketKey> filter = null) {
            var result = new Dictionary<BucketKey, List<StationModuleRecord>>();
            if (modules == null) return result;
            for (int i = 0; i < modules.Count; i++) {
                var mod = modules[i];
                if (!StationContactShadowRules.IsEligible(mod)) continue;
                var key = KeyOf(mod, grid);
                if (filter != null && !filter.Contains(key)) continue;
                if (!result.TryGetValue(key, out var list)) result[key] = list = new List<StationModuleRecord>();
                list.Add(mod);
            }
            return result;
        }

        static BuiltBucket BuildBucket(BucketKey key, List<StationModuleRecord> modules, StationWorldView world,
            Material material, Transform parent, bool active) {
            if (modules == null || modules.Count == 0) return null;
            var quad = StationContactShadowAssets.QuadMesh();
            var instances = new List<CombineInstance>(modules.Count);
            var instanceSources = new List<int>(modules.Count);
            var sourceIds = new string[modules.Count];
            var sourceBounds = new StationBox[modules.Count];
            var docMin = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var docMax = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            var worldBounds = new Bounds();
            bool hasWorldBounds = false;

            for (int i = 0; i < modules.Count; i++) {
                var mod = modules[i];
                var matrix = StationContactShadowRules.ComputeBlobMatrix(mod, world, out var docBox);
                instances.Add(new CombineInstance { mesh = quad, subMeshIndex = 0, transform = matrix });
                instanceSources.Add(i);
                sourceIds[i] = mod.Id;
                sourceBounds[i] = docBox;
                docMin = Vector3.Min(docMin, new Vector3((float)docBox.X0, (float)docBox.Y0, (float)docBox.Z0));
                docMax = Vector3.Max(docMax, new Vector3((float)docBox.X1, (float)docBox.Y1, (float)docBox.Z1));
                var wb = StationPrefabMeshTemplate.TransformBounds(quad.bounds, matrix);
                if (!hasWorldBounds) { worldBounds = wb; hasWorldBounds = true; }
                else worldBounds.Encapsulate(wb);
            }

            var go = new GameObject("contact-shadows-z" + key.Band + (key.GradeOwned ? "-grade" : ""));
            go.SetActive(active);
            if (parent != null) go.transform.SetParent(parent, false);
            var proxyMesh = new Mesh { name = "contact-shadow-proxy" };
            proxyMesh.bounds = worldBounds;
            var filter = go.AddComponent<MeshFilter>();
            filter.sharedMesh = proxyMesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            var batch = go.AddComponent<StationInstancedSurfaceBatch>();
            batch.ShadowCasting = ShadowCastingMode.Off;
            batch.Configure(quad, 0, renderer, worldBounds, instances, modules.Count, instanceSources);

            var aggregateBox = new StationBox(docMin.x, docMin.y, docMin.z, docMax.x, docMax.y, docMax.z);
            var bucket = new BuiltBucket {
                Key = key,
                View = go,
                Batch = batch,
                ProxyMesh = proxyMesh,
                Record = new StationViewRecord {
                    Role = RoleName,
                    ModuleId = "",
                    Part = "contact-shadow-batch",
                    View = go,
                    Bounds = aggregateBox,
                    HasBounds = true,
                    LevelMin = key.Band,
                    LevelMax = key.Band,
                    LevelBands = new[] { key.Band },
                    SourceIds = sourceIds,
                    SourceBounds = sourceBounds,
                    GradeOwned = key.GradeOwned,
                },
            };
            for (int i = 0; i < sourceIds.Length; i++) bucket.ModuleIds.Add(sourceIds[i]);
            return bucket;
        }

        static void DestroyAsset(UnityEngine.Object asset) {
            if (asset == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(asset);
            else UnityEngine.Object.DestroyImmediate(asset);
        }
    }
}
