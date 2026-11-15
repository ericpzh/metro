using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// The canvas editor's ghost and selection pass (plan 16 §1.5). It draws the exact
    /// candidate the resolver returned — never a re-derived piece — plus the refusal
    /// tint and the blue selection box, and it parks the carried original while a move
    /// is in the air. Nothing here writes the document, the history or the simulation.
    ///
    /// The ghost is mounted through the same <see cref="ModulePlacement"/> pivot and
    /// catalogue entry the station's own module renderer uses, so a preview stands on
    /// the surface it will be committed to.
    /// </summary>
    public sealed class StationPlacementPreview : MonoBehaviour {
        sealed class Restorable {
            public GameObject View;
            public bool Active;
        }

        readonly List<GameObject> owned = new List<GameObject>();
        readonly List<Restorable> hidden = new List<Restorable>();
        Mesh boxMesh;
        Material okMaterial;
        Material badMaterial;
        Material selectMaterial;
        StationIndex index;
        bool bound;

        /// <summary>Bind the committed document the ghost resolves against.</summary>
        public void Bind(StationIndex stationIndex) {
            index = stationIndex;
            bound = stationIndex != null;
            RestoreCarried();
            ClearGhost();
        }

        /// <summary>Draw the candidate, or just the selection when there is none.</summary>
        public void Show(StationPlacementPlan plan) {
            ClearGhost();
            if (!bound || plan?.Candidate == null) return;
            var colour = plan.Ok ? new Color(0.09f, 0.55f, 1f, 0.55f) : new Color(1f, 0.27f, 0.2f, 0.55f);
            if (!TryBuildPrefabGhost(plan.Candidate, colour)) BuildBoxGhost(plan.Candidate, colour);
        }

        /// <summary>Drop the ghost; the carried piece (if any) stays hidden.</summary>
        public void ClearGhost() {
            foreach (var go in owned) Destroy(go);
            owned.Clear();
        }

        /// <summary>
        /// Hide the placed piece a move carries, so the player sees only the ghost. The
        /// original record is untouched: an invalid drop or a cancel restores this view.
        /// </summary>
        public void HideCarried(string moduleId) {
            RestoreCarried();
            if (string.IsNullOrEmpty(moduleId)) return;
            var world = CurrentWorld();
            if (world == null) return;
            foreach (var record in world.Records) {
                if (!string.Equals(record.ModuleId, moduleId, StringComparison.Ordinal) || record.View == null) continue;
                hidden.Add(new Restorable { View = record.View, Active = record.View.activeSelf });
                record.View.SetActive(false);
            }
        }

        /// <summary>Put the carried original back (cancel, refusal, commit, station switch).</summary>
        public void RestoreCarried() {
            foreach (var entry in hidden) {
                if (entry.View != null) entry.View.SetActive(entry.Active);
            }
            hidden.Clear();
        }

        /// <summary>Draw the selection highlight around one placed module's real bounds.</summary>
        public void Select(StationModuleRecord module) {
            var world = CurrentWorld();
            if (world == null || module == null) return;
            if (!StationFootprints.TryClearance(module, out var box, out _)) {
                if (!world.TryGetModule(module.Id, out var record) || record.View == null) return;
                if (!TryWorldBounds(record.View, out var worldBox)) return;
                BuildOutline(worldBox, selectMaterial, 1.06f);
                return;
            }
            BuildOutline(WorldFromDocument(box), selectMaterial, 1.06f);
        }

        void OnDestroy() {
            ClearGhost();
            if (boxMesh != null) Destroy(boxMesh);
            if (okMaterial != null) Destroy(okMaterial);
            if (badMaterial != null) Destroy(badMaterial);
            if (selectMaterial != null) Destroy(selectMaterial);
        }

        static void Destroy(UnityEngine.Object value) {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }

        StationWorldView CurrentWorld() {
            var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            return host != null ? host.Coordinator?.World : null;
        }

        bool TryBuildPrefabGhost(StationEditDraft draft, Color colour) {
            var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            var world = host != null ? host.Coordinator?.World : null;
            if (world?.Catalogue == null || index == null) return false;
            var record = StationModulePlacement.ToRecord(draft);
            var facts = record.Facts;
            var station = StationFacts(index);
            var visual = ModuleViews.Resolve(facts, station, world.Catalogue);
            if (visual.Kind == ModuleViewKind.None || !visual.HasModel) return false;
            if (!world.Catalogue.TryGet(visual.Key, out var entry) || entry.prefab == null) return false;
            var go = Instantiate(entry.prefab, transform, false);
            go.name = "ghost " + draft.Id + " " + draft.Type;
            go.transform.SetPositionAndRotation(
                ModulePlacement.Position(facts, entry) + StationCoordinates.Point(ModulePlacement.RunCentre(facts)),
                ModulePlacement.Rotation(facts.Rotation));
            var material = Tinted(colour.r < 0.5f, colour);
            foreach (var renderer in go.GetComponentsInChildren<Renderer>(true)) {
                if (renderer == null) continue;
                var materials = new Material[renderer.sharedMaterials.Length];
                for (int i = 0; i < materials.Length; i++) materials[i] = material;
                renderer.sharedMaterials = materials;
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                renderer.receiveShadows = false;
            }
            owned.Add(go);
            return true;
        }

        /// <summary>The unresolved-candidate stand-in: the clearance body the verdict read.</summary>
        void BuildBoxGhost(StationEditDraft draft, Color colour) {
            var record = StationModulePlacement.ToRecord(draft);
            if (!StationFootprints.TryClearance(record, out var box, out _)) {
                box = new StationBox(draft.X, draft.Y, draft.Z + 1, draft.X + 1, draft.Y + 1, draft.Z + 2);
            }
            BuildBox(WorldFromDocument(box), Tinted(colour.r < 0.5f, colour));
        }

        void BuildOutline(Bounds bounds, Material material, float scale) {
            var centre = bounds.center;
            var size = bounds.size * scale;
            var half = size * 0.5f;
            const float thickness = 0.035f;
            // Twelve thin prisms along the box's edges: an outline that reads at any zoom
            // without a custom wireframe shader.
            for (int axis = 0; axis < 3; axis++) {
                for (int a = 0; a < 2; a++) {
                    for (int b = 0; b < 2; b++) {
                        var edge = new Vector3(thickness, thickness, thickness);
                        edge[axis] = size[axis];
                        var offset = Vector3.zero;
                        offset[(axis + 1) % 3] = (a == 0 ? -1f : 1f) * half[(axis + 1) % 3];
                        offset[(axis + 2) % 3] = (b == 0 ? -1f : 1f) * half[(axis + 2) % 3];
                        BuildBox(new Bounds(centre + offset, edge), material);
                    }
                }
            }
        }

        void BuildBox(Bounds bounds, Material material) {
            if (boxMesh == null) {
                var vertices = new List<Vector3>();
                var triangles = new List<int>();
                BoxFaces.AppendAxisAligned(vertices, triangles, Vector3.zero, Vector3.one);
                boxMesh = new Mesh { name = "edit preview box" };
                boxMesh.SetVertices(vertices);
                boxMesh.SetTriangles(triangles, 0);
                boxMesh.RecalculateNormals();
            }
            var go = new GameObject("preview box");
            go.transform.SetParent(transform, false);
            go.transform.position = bounds.center;
            go.transform.localScale = bounds.size;
            go.AddComponent<MeshFilter>().sharedMesh = boxMesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            owned.Add(go);
        }

        /// <summary>The one accepted (blue) or refused (red) ghost material, cached per preview.</summary>
        Material Tinted(bool ok, Color colour) {
            if (ok && okMaterial != null) return okMaterial;
            if (!ok && badMaterial != null) return badMaterial;
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            var material = new Material(shader) { name = ok ? "edit ghost" : "edit refusal" };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", colour);
            if (material.HasProperty("_Color")) material.SetColor("_Color", colour);
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_Blend")) material.SetFloat("_Blend", 0f);
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            if (ok) okMaterial = material; else badMaterial = material;
            return material;
        }

        Material SelectionMaterial() {
            if (selectMaterial != null) return selectMaterial;
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            var colour = new Color(0.12f, 0.62f, 1f, 0.95f);
            selectMaterial = new Material(shader) { name = "edit selection" };
            if (selectMaterial.HasProperty("_BaseColor")) selectMaterial.SetColor("_BaseColor", colour);
            if (selectMaterial.HasProperty("_Color")) selectMaterial.SetColor("_Color", colour);
            if (selectMaterial.HasProperty("_Surface")) selectMaterial.SetFloat("_Surface", 1f);
            if (selectMaterial.HasProperty("_Blend")) selectMaterial.SetFloat("_Blend", 0f);
            if (selectMaterial.HasProperty("_SrcBlend")) selectMaterial.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            if (selectMaterial.HasProperty("_DstBlend")) selectMaterial.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            if (selectMaterial.HasProperty("_ZWrite")) selectMaterial.SetFloat("_ZWrite", 0f);
            selectMaterial.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            selectMaterial.SetOverrideTag("RenderType", "Transparent");
            selectMaterial.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            return selectMaterial;
        }

        static ModuleFacts[] StationFacts(StationIndex station) {
            var modules = station.Document.Modules;
            var facts = new ModuleFacts[modules.Count];
            for (int i = 0; i < facts.Length; i++) facts[i] = modules[i].Facts;
            return facts;
        }

        /// <summary>A document-axis box → a Unity world box (the one swap, once).</summary>
        static Bounds WorldFromDocument(StationBox box) {
            var a = StationCoordinates.Point(new Vector3((float)box.X0, (float)box.Y0, (float)box.Z0));
            var b = StationCoordinates.Point(new Vector3((float)box.X1, (float)box.Y1, (float)box.Z1));
            var min = Vector3.Min(a, b);
            var max = Vector3.Max(a, b);
            return new Bounds((min + max) * 0.5f, max - min);
        }

        static bool TryWorldBounds(GameObject view, out Bounds bounds) {
            bounds = default;
            var renderers = view.GetComponentsInChildren<Renderer>(true);
            bool any = false;
            foreach (var renderer in renderers) {
                if (renderer == null) continue;
                if (!any) { bounds = renderer.bounds; any = true; }
                else bounds.Encapsulate(renderer.bounds);
            }
            return any;
        }
    }
}
