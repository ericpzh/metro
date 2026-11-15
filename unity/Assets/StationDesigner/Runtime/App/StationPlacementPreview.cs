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

        /// <summary>
        /// The source's selection pad: `refreshSelection` grows the module's rendered box by
        /// 0.06 m on **every** side (`ModuleSystem.ts`, `box.expandByScalar(0.06)`), so the line
        /// box clears the geometry it wraps instead of z-fighting its faces.
        /// </summary>
        public const float SelectionPad = .06f;
        /// <summary>`#55b6ff`, the one colour the web's selection and hover boxes use.</summary>
        public static readonly Color SelectionColour = new Color(0x55 / 255f, 0xb6 / 255f, 1f, 1f);

        readonly List<GameObject> owned = new List<GameObject>();
        readonly List<Restorable> hidden = new List<Restorable>();
        Mesh boxMesh;
        Mesh lineMesh;
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

        /// <summary>
        /// Draw the selection mark around one placed module: the source's **rendered** bounds
        /// padded by <see cref="SelectionPad"/> drawn as a thin `#55b6ff` line box (the web's
        /// `refreshSelection`). Two things were wrong here before (plan 22 §3):
        ///
        /// * Both branches passed the nullable <c>selectMaterial</c> field, which nothing ever
        ///   initialised; `BuildBox` then assigned a null material and every selection drew
        ///   Unity's magenta missing-material. The material is now acquired here, through
        ///   <see cref="SelectionMaterial"/>.
        /// * The geometry was a 12-prism cage built from the **clearance** box scaled by 1.06,
        ///   so a stair selected a volume three times its drawn size. The source pads by a fixed
        ///   0.06 m and draws a line box, and the module's own group is what it measures.
        /// </summary>
        public void Select(StationModuleRecord module) {
            var world = CurrentWorld();
            if (world == null || module == null) return;
            if (!TrySelectionBounds(world, module, out var bounds)) return;
            BuildLineBox(bounds, SelectionMaterial());
        }

        /// <summary>
        /// The box a selection wraps: the drawn geometry's bounds, exactly as the source's
        /// `Box3().setFromObject(group)` measures it, padded by <see cref="SelectionPad"/>. A
        /// module with no view of its own — a paving tile lives in a combined surface batch
        /// whose record carries `SourceIds` instead of a `ModuleId` — falls back to its authored
        /// clearance envelope, the source's `bareSurfaceBox`. Public so a verifier can read the
        /// box a click would mark without driving a pointer.
        /// </summary>
        public static bool TrySelectionBounds(StationWorldView world, StationModuleRecord module, out Bounds bounds) {
            bounds = default;
            if (module == null) return false;
            if (TryRenderedBounds(world, module.Id, out var rendered)) {
                bounds = rendered;
            } else if (StationFootprints.TryClearance(module, out var box, out _)) {
                bounds = WorldFromDocument(box);
            } else {
                return false;
            }
            bounds.Expand(SelectionPad * 2f);
            return true;
        }

        /// <summary>
        /// World bounds of every mesh under one module's own registered view. Measured from
        /// `MeshFilter.sharedMesh` rather than `Renderer.bounds`, so it is also valid while a
        /// staged world root is still inactive.
        /// </summary>
        static bool TryRenderedBounds(StationWorldView world, string moduleId, out Bounds bounds) {
            bounds = default;
            if (world == null || string.IsNullOrEmpty(moduleId)) return false;
            bool any = false;
            foreach (var record in world.Records) {
                if (record?.View == null) continue;
                if (!string.Equals(record.ModuleId, moduleId, StringComparison.Ordinal)) continue;
                foreach (var filter in record.View.GetComponentsInChildren<MeshFilter>(true)) {
                    var mesh = filter ? filter.sharedMesh : null;
                    if (!mesh) continue;
                    var local = mesh.bounds;
                    var matrix = filter.transform.localToWorldMatrix;
                    for (int corner = 0; corner < 8; corner++) {
                        var point = matrix.MultiplyPoint3x4(new Vector3(
                            (corner & 1) == 0 ? local.min.x : local.max.x,
                            (corner & 2) == 0 ? local.min.y : local.max.y,
                            (corner & 4) == 0 ? local.min.z : local.max.z));
                        if (!any) { bounds = new Bounds(point, Vector3.zero); any = true; }
                        else bounds.Encapsulate(point);
                    }
                }
            }
            return any;
        }

        void OnDestroy() {
            ClearGhost();
            if (boxMesh != null) Destroy(boxMesh);
            if (lineMesh != null) Destroy(lineMesh);
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
            // Plan 22 §2: a 玻璃板's housing is a rotated **edge strip**, not the promoted panel's
            // centre pivot, so the generic prefab ghost stood 0.45 m off the plane the curtain (and
            // the door fitted into it) is drawn on. The clearance box is that strip, for a
            // floor-standing panel as well as for wall cladding.
            if (string.Equals(draft.Type, "glass", StringComparison.Ordinal)) return false;
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

        /// <summary>
        /// The source's selection box: twelve **line segments** on the box's edges, not twelve
        /// thin prisms. A line-topology mesh draws one device pixel wide at any zoom, which is
        /// what a `THREE.Box3Helper` does, and it costs one draw call instead of twelve.
        /// </summary>
        void BuildLineBox(Bounds bounds, Material material) {
            if (lineMesh == null) {
                // A unit cube's twelve edges as line pairs, −0.5…+0.5.
                var corners = new Vector3[8];
                for (int i = 0; i < 8; i++)
                    corners[i] = new Vector3((i & 1) == 0 ? -0.5f : 0.5f, (i & 2) == 0 ? -0.5f : 0.5f,
                        (i & 4) == 0 ? -0.5f : 0.5f);
                int[,] edges = {
                    { 0, 1 }, { 2, 3 }, { 4, 5 }, { 6, 7 },
                    { 0, 2 }, { 1, 3 }, { 4, 6 }, { 5, 7 },
                    { 0, 4 }, { 1, 5 }, { 2, 6 }, { 3, 7 },
                };
                var vertices = new List<Vector3>(24);
                var indices = new List<int>(24);
                for (int edge = 0; edge < 12; edge++) {
                    vertices.Add(corners[edges[edge, 0]]);
                    vertices.Add(corners[edges[edge, 1]]);
                    indices.Add(edge * 2);
                    indices.Add(edge * 2 + 1);
                }
                lineMesh = new Mesh { name = "edit selection box" };
                lineMesh.SetVertices(vertices);
                lineMesh.SetIndices(indices.ToArray(), MeshTopology.Lines, 0);
                lineMesh.RecalculateBounds();
            }
            var go = new GameObject("selection box");
            go.transform.SetParent(transform, false);
            go.transform.position = bounds.center;
            go.transform.localScale = bounds.size;
            go.AddComponent<MeshFilter>().sharedMesh = lineMesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            owned.Add(go);
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

        /// <summary>
        /// The one selection material, acquired on first use. **Unlit** and `#55b6ff`, like the
        /// source's `Box3Helper` line: a line primitive has no normals to shade, so a Lit
        /// material renders black on half the box and reads as a broken outline. The field used
        /// to start null and `Select` never called this, which is why the mark was magenta.
        /// </summary>
        Material SelectionMaterial() {
            if (selectMaterial != null) return selectMaterial;
            selectMaterial = CreateSelectionMaterial();
            return selectMaterial;
        }

        /// <summary>The selection material a selection mark draws with (`#55b6ff`, unlit).</summary>
        public static Material CreateSelectionMaterial() {
            var shader = Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Unlit/Color")
                ?? Shader.Find("Universal Render Pipeline/Lit")
                ?? Shader.Find("Sprites/Default");
            var material = new Material(shader) { name = "edit selection" };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", SelectionColour);
            if (material.HasProperty("_Color")) material.SetColor("_Color", SelectionColour);
            return material;
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
    }
}
