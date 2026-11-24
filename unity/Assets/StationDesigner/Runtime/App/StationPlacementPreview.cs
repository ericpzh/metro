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

        readonly struct RestorableInstanced {
            public readonly Views.StationInstancedSurfaceBatch Batch;
            public readonly int SourceIndex;
            public RestorableInstanced(Views.StationInstancedSurfaceBatch batch, int sourceIndex) {
                Batch = batch;
                SourceIndex = sourceIndex;
            }
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
        /// <summary>The cell tool's own ghost objects, cleared independently of a module ghost.</summary>
        readonly List<GameObject> cellOwned = new List<GameObject>();
        readonly List<Restorable> hidden = new List<Restorable>();
        readonly List<RestorableInstanced> hiddenInstanced = new List<RestorableInstanced>();
        readonly List<GameObject> selectedOwned = new List<GameObject>();
        readonly List<GameObject> hoverOwned = new List<GameObject>();
        sealed class SurfaceLink { public string Id; public MeshRenderer Source; public GameObject Overlay; }
        readonly List<SurfaceLink> surfaceLinks = new List<SurfaceLink>();
        readonly List<Mesh> overlayMeshes = new List<Mesh>();
        string selectedId = "", hoveredId = "", carriedId = "";
        Material selectedFill, hoverFill;
        public string SelectedId => selectedId;
        public string HoveredId => hoveredId;
        GameObject eraseBatch;
        Mesh eraseMesh;
        readonly List<Vector3> eraseVertices = new List<Vector3>();
        readonly List<int> eraseTriangles = new List<int>();
        readonly Dictionary<(Vector3, Vector3), int> eraseFaces = new Dictionary<(Vector3, Vector3), int>();
        Mesh boxMesh;
        Mesh lineMesh;
        Mesh cellMesh;
        Mesh wedgeMesh;
        Material okMaterial;
        Material badMaterial;
        Material okLineMaterial;
        Material badLineMaterial;
        Material selectMaterial;
        Material eraseMaterial;
        Material cellOkMaterial;
        Material cellBadMaterial;
        Material cellRingMaterial;
        Material zoneMaterial;
        Material cursorOkMaterial;
        Material cursorBadMaterial;
        Material blockerOutlineMaterial;
        StationMaterials boothOkMaterials;
        StationMaterials boothBadMaterials;
        StationIndex index;
        bool bound;

        /// <summary>Bind the committed document the ghost resolves against.</summary>
        public void Bind(StationIndex stationIndex) {
            index = stationIndex;
            bound = stationIndex != null;
            RestoreCarried();
            ClearGhost();
            ClearCells();
            ClearHover();
            ClearLayer(selectedOwned);
            Select(index?.GetModule(selectedId));
        }

        /// <summary>True while a committed document is bound; a draw before this is a no-op.</summary>
        public bool Bound => bound;

        /// <summary>True while 隐藏UI is active on the bound station's visibility registry.</summary>
        public bool UiHidden => IsUiHidden();

        bool IsUiHidden() {
            var host = StationEditHost.Host != null ? StationEditHost.Host : UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            if (host != null) {
                var rig = host.GetComponent<StationViewRig>();
                if (rig != null && rig.Visibility != null) return rig.Visibility.State.HideUi;
                var worldVis = host.Coordinator?.World?.Visibility;
                if (worldVis != null) return worldVis.State.HideUi;
            }
            var activeVis = StationViewFeature.Active?.Visibility;
            return activeVis != null && activeVis.State.HideUi;
        }

        /// <summary>Drop every transient preview layer (module ghost, cell/cursor overlay and hover).</summary>
        public void ClearAll() {
            ClearGhost();
            ClearCells();
            ClearHover();
        }

        /// <summary>Hide transient cursor/preview layers immediately when <c>HideUi</c> turns on.</summary>
        public void SyncVisibility() {
            if (!IsUiHidden()) return;
            if (owned.Count > 0 || cellOwned.Count > 0 || hoverOwned.Count > 0 ||
                (eraseBatch != null && eraseBatch.activeSelf)) {
                ClearAll();
            }
        }

        /// <summary>Draw the candidate, or just the selection when there is none.</summary>
        public void Show(StationPlacementPlan plan) {
            ClearGhost();
            ClearCells();
            if (!bound || plan?.Candidate == null || IsUiHidden()) return;
            var colour = plan.Ok ? new Color(0.09f, 0.55f, 1f, 0.55f) : new Color(1f, 0.27f, 0.2f, 0.55f);
            if (!TryBuildPrefabGhost(plan.Candidate, colour)) BuildBoxGhost(plan.Candidate, colour);
            StationEditSession.Ghost = Summary("module");
        }

        /// <summary>
        /// Draw a **batch** of planned pieces (plan 28 §3): the roof tile/bay gestures preview
        /// every piece the release would lay — or lift — with the piece's own dimensions, and
        /// the refused ones in the shared red. The whole batch owns the ghost layer and the
        /// cell layer is cleared, so one gesture draws one thing.
        /// </summary>
        public void ShowModules(IReadOnlyList<StationPlacementPlan> accepted, IReadOnlyList<StationPlacementPlan> refused = null) {
            ClearGhost();
            ClearCells();
            if (!bound || IsUiHidden()) return;
            var ok = new Color(0.09f, 0.55f, 1f, 0.55f);
            var bad = new Color(1f, 0.27f, 0.2f, 0.55f);
            if (accepted != null) {
                foreach (var plan in accepted) {
                    if (plan?.Candidate == null) continue;
                    if (!TryBuildPrefabGhost(plan.Candidate, ok)) BuildBoxGhost(plan.Candidate, ok);
                }
            }
            if (refused != null) {
                foreach (var plan in refused) {
                    if (plan?.Candidate == null) continue;
                    if (!TryBuildPrefabGhost(plan.Candidate, bad)) BuildBoxGhost(plan.Candidate, bad);
                    // The pieces in the way are boxed beside it, so a refusal names its blocker.
                    foreach (var id in plan.ColliderIds) {
                        if (!TryBlockerBounds(id, out var blocker)) continue;
                        BuildLineBox(blocker, RefusalOutlineMaterial(), owned);
                    }
                }
            }
            StationEditSession.Ghost = Summary("modules");
        }

        /// <summary>Drop the ghost; the carried piece (if any) stays hidden.</summary>
        public void ClearGhost() {
            foreach (var go in owned) Destroy(go);
            owned.Clear();
            StationEditSession.Ghost = null;
        }

        /// <summary>
        /// The cell tool's ghost pass (plan 27 §3): accepted cells in the shared blue, refused
        /// ones red, the wall ring a floor patch would raise in a lighter blue, and every
        /// blocking piece boxed in red. A cut piece is drawn as the **thin** panel or the 45°
        /// wedge it will become, not as the whole block it shares a cell with, so the ghost is
        /// the piece the release lays. Overlays stay outside the pick registry: nothing here is
        /// a scene record, and no ray can hit it.
        /// </summary>
        public void ShowCells(StationCellPreview preview) {
            ClearCells();
            if (!bound || preview == null || !preview.HasPlan || IsUiHidden()) return;
            var shape = preview.Check.Shape;
            // A removal gesture draws what it would take away, in the reference's own red
            // (`setGhost(..., 'remove')`), while an add keeps the shared blue: those cells are
            // exactly what the release will lay (`checkBlockCells`'s two lists).
            bool removing = string.Equals(preview.Kind, "erase", StringComparison.Ordinal) ||
                            string.Equals(preview.Kind, "delete", StringComparison.Ordinal);
            var okColour = removing
                ? new Color(1f, 0.36f, 0.24f, 0.36f)
                : new Color(0.09f, 0.55f, 1f, 0.34f);
            var ring = new HashSet<StationCellKey>(preview.AutoWalls);
            if (removing || preview.RemovedCells.Count > 0) {
                if (eraseMaterial == null)
                    eraseMaterial = CreateUnlitTransparent("edit erase surfaces", new Color(1f, 0.36f, 0.24f, 0.36f));
                BuildEraseBatch(preview.Patch != null ? preview.RemovedCells : preview.Check.Accepted, eraseMaterial);
            }
            foreach (var cell in preview.Check.Accepted) {
                if (removing) continue;
                if (ring.Contains(cell)) {
                    // The 生成墙壁 ring reads as generated: the same blue, fainter.
                    BuildBox(CellBounds(cell, StationCellShape.Full), RingMaterial(), cellOwned);
                    continue;
                }
                BuildCellGhost(cell, shape, CellMaterial(!removing, okColour), cellOwned);
            }
            foreach (var cell in preview.Check.Blocked) BuildCellGhost(cell, shape, CellMaterial(false, new Color(1f, 0.27f, 0.2f, 0.42f)), cellOwned);
            foreach (var cell in preview.AutoWalls) {
                if (preview.Check.Accepted.Contains(cell)) continue;
                BuildBox(CellBounds(cell, StationCellShape.Full), RingMaterial(), cellOwned);
            }
            foreach (var id in preview.Check.ColliderIds) {
                if (!TryBlockerBounds(id, out var bounds)) continue;
                BuildLineBox(bounds, RefusalOutlineMaterial(), cellOwned);
            }
            // A delete gesture's pending pieces: the whole drawn body is boxed, not a cell.
            foreach (var id in preview.ModuleIds) {
                if (!TryBlockerBounds(id, out var bounds)) continue;
                BuildLineBox(bounds, RefusalOutlineMaterial(), cellOwned);
            }
            // The reference's pointer ring (`grid.setCursor`): one flat square outline on the
            // cell under the pointer, cyan when the release would take it and red when not.
            // Without it the ghost floats with nothing saying which cell the click addresses.
            bool cursorOk = !preview.OverLimit && !removing && preview.Check.Blocked.Count == 0 &&
                            (preview.Check.Accepted.Count > 0 || preview.Check.Ignored.Count > 0);
            BuildLineBox(CursorBounds(preview.Cursor), CursorMaterial(cursorOk), cellOwned);
            StationEditSession.Ghost = Summary("cells");
        }

        /// <summary>The pointer ring's own material: the web's `#6ee7ff` or its `#ff5d5d`.</summary>
        Material CursorMaterial(bool ok) {
            if (ok && cursorOkMaterial != null) return cursorOkMaterial;
            if (!ok && cursorBadMaterial != null) return cursorBadMaterial;
            var colour = ok ? new Color(0x6e / 255f, 0xe7 / 255f, 1f, 1f) : new Color(1f, 0x5d / 255f, 0x5d / 255f, 1f);
            var material = CreateUnlitTransparent(ok ? "edit cursor ring" : "edit cursor refusal", colour);
            if (ok) cursorOkMaterial = material; else cursorBadMaterial = material;
            return material;
        }

        /// <summary>A thin flat square outline on the aim cell's top face (`z + 1.02`).</summary>
        static Bounds CursorBounds(StationCellKey cell) {
            const double pad = 0.02;
            var a = StationCoordinates.Point(new Vector3(cell.X, cell.Y, cell.Z + 1f + (float)pad));
            var b = StationCoordinates.Point(new Vector3(cell.X + 1, cell.Y + 1, cell.Z + 1f + (float)pad));
            var min = Vector3.Min(a, b);
            var max = Vector3.Max(a, b);
            return new Bounds((min + max) * 0.5f, max - min);
        }

        /// <summary>Drop the cell ghost (pointer leave, a tool change, a commit).</summary>
        public void ClearCells() {
            if (eraseBatch != null) eraseBatch.SetActive(false);
            foreach (var go in cellOwned) Destroy(go);
            cellOwned.Clear();
            StationEditSession.Ghost = null;
        }

        /// <summary>
        /// What the last draw really put on screen, for the verifier (plan 28 §5): the number of
        /// ghost objects built, how many of their renderers the render loop actually drew
        /// (`Renderer.isVisible` — the camera's own answer, not a plan array) and which layer
        /// owns them. A badge with `count = 0` is exactly the invisible-ghost defect this pins.
        /// </summary>
        public Newtonsoft.Json.Linq.JObject Summary(string kind) {
            int count = 0, visible = 0;
            CountLayer(cellOwned, ref count, ref visible);
            CountLayer(owned, ref count, ref visible);
            if (eraseBatch != null && eraseBatch.activeSelf) { count++; if (eraseBatch.GetComponent<Renderer>().isVisible) visible++; }
            return new Newtonsoft.Json.Linq.JObject {
                ["kind"] = kind ?? "",
                ["bound"] = bound,
                ["count"] = count,
                ["visible"] = visible,
                ["cells"] = cellOwned.Count + (eraseBatch != null && eraseBatch.activeSelf ? 1 : 0),
                ["ghosts"] = owned.Count,
            };
        }

        static void CountLayer(List<GameObject> objects, ref int count, ref int visible) {
            for (int i = 0; i < objects.Count; i++) {
                var go = objects[i];
                if (go == null) continue;
                count++;
                var renderer = go.GetComponent<Renderer>();
                if (renderer != null) {
                    if (renderer.enabled && renderer.isVisible) visible++;
                    continue;
                }
                foreach (var child in go.GetComponentsInChildren<Renderer>(false)) {
                    if (child != null && child.enabled && child.isVisible) { visible++; break; }
                }
            }
        }

        /// <summary>
        /// The paint brush's face ghost (plan 27 §6): a thin quad on each face the release would
        /// paint, so the previewed surface is the painted one. It is the same `cellOwned` layer the
        /// cell tool uses, unlit and double-sided, and it never enters the pick registry.
        /// </summary>
        public void ShowFaces(StationPaintPreview preview) {
            ClearCells();
            if (!bound || preview == null || preview.Cells.Count == 0 || IsUiHidden()) return;
            var material = preview.Mode == "erase"
                ? CellMaterial(false, new Color(1f, 0.27f, 0.2f, 0.42f))
                : CellMaterial(true, new Color(0.45f, 0.82f, 1f, 0.42f));
            foreach (var cell in preview.Cells) {
                BuildBox(FaceBounds(cell, preview.Face), material, cellOwned);
            }
            StationEditSession.Ghost = Summary("faces");
        }

        /// <summary>
        /// The 分区 / 房间 brush's live preview (plan 27 §6):
        /// * During a facility room drag (`ticket` / `info`), draws the translucent 3D booth
        ///   (through `BoothModuleViews.TryBuild`, keeping counter/screen/glass contrast) plus its
        ///   auto-stocked staff benches and the corner cursor ring — matching the web build's
        ///   `ZoneTool.showFacilityPreview`.
        /// * On hover or a fare/room-zone drag, draws a thin top-face slab on every covered floor
        ///   cell in the armed zone's own palette colour (or warning red when erasing), plus the
        ///   cursor ring.
        /// </summary>
        public void ShowZone(StationZonePreview preview) {
            ClearGhost();
            ClearCells();
            if (!bound || preview == null || IsUiHidden()) return;
            if (preview.Facility.Length > 0 && preview.Width > 0 && preview.Height > 0) {
                bool ok = string.IsNullOrEmpty(preview.Notice);
                var tint = ok ? new Color(0x16 / 255f, 0x8c / 255f, 1f, 0.55f) : new Color(1f, 0.27f, 0.2f, 0.55f);
                var area = preview.FacilityRect;
                BuildBoothGhost(preview.Facility, area, preview.Front, ok, tint);
                var benches = StationFacilityPlanner.BoothBenchSpots(area, preview.Front);
                for (int i = 0; i < benches.Count; i++) {
                    var spot = benches[i];
                    var benchDraft = new StationEditDraft {
                        Id = "facility-preview-bench-" + i,
                        Type = "bench",
                        X = spot.X,
                        Y = spot.Y,
                        Z = area.Z,
                        Rotation = spot.Rotation,
                    };
                    benchDraft.Set(true, "auto");
                    if (!TryBuildPrefabGhost(benchDraft, tint)) BuildBoxGhost(benchDraft, tint);
                }
                if (!string.IsNullOrEmpty(preview.BlockedBy) && TryBlockerBounds(preview.BlockedBy, out var blocker)) {
                    BuildLineBox(blocker, RefusalOutlineMaterial(), cellOwned);
                }
                if (preview.HasCursor) {
                    BuildLineBox(CursorBounds(preview.Cursor), CursorMaterial(ok), cellOwned);
                }
                StationEditSession.Ghost = Summary("zone");
                return;
            }
            var tintCells = preview.Floor.Count > 0 ? preview.Floor : preview.Rect;
            if (tintCells.Count > 0) {
                var rgb = preview.Colour;
                var colour = new Color(((rgb >> 16) & 0xFF) / 255f, ((rgb >> 8) & 0xFF) / 255f, (rgb & 0xFF) / 255f, 0.42f);
                var material = ZoneMaterial(colour);
                foreach (var cell in tintCells) BuildBox(FaceBounds(cell, StationFace.Top), material, cellOwned);
            }
            if (preview.HasCursor) {
                bool cursorOk = string.IsNullOrEmpty(preview.Notice) && !preview.Erase;
                BuildLineBox(CursorBounds(preview.Cursor), CursorMaterial(cursorOk), cellOwned);
            }
            if (tintCells.Count > 0 || preview.HasCursor) {
                StationEditSession.Ghost = Summary("zone");
            }
        }

        void BuildBoothGhost(string kind, StationFacilityRect area, int front, bool ok, Color tint) {
            var palette = GhostBoothMaterials(ok);
            if (palette != null) {
                var cfg = new Dictionary<string, string>(StringComparer.Ordinal) {
                    ["kind"] = kind ?? "ticket",
                    ["stocked"] = "true",
                    ["front"] = (((front % 4) + 4) % 4).ToString(System.Globalization.CultureInfo.InvariantCulture),
                };
                var facts = new ModuleFacts {
                    Id = "facility-preview",
                    Type = "booth",
                    X = area.X0,
                    Y = area.Y0,
                    Z = area.Z,
                    ExactZ = area.Z,
                    Width = area.Width,
                    Depth = area.Height,
                    Config = new ModuleConfig(cfg),
                };
                if (Views.BoothModuleViews.TryBuild(facts, transform, palette, out var view, out _) && view != null) {
                    view.name = "ghost facility booth " + kind;
                    foreach (var renderer in view.GetComponentsInChildren<Renderer>(true)) {
                        if (renderer == null) continue;
                        renderer.forceMeshLod = 0;
                        renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                        renderer.receiveShadows = false;
                    }
                    owned.Add(view);
                    return;
                }
            }
            var fallback = new StationBox(area.X0, area.Y0, area.Z + 1, area.X1 + 1, area.Y1 + 1, area.Z + 3.4);
            BuildBox(WorldFromDocument(fallback), Tinted(ok, tint), owned);
        }

        StationMaterials GhostBoothMaterials(bool ok) {
            if (ok && boothOkMaterials != null) return boothOkMaterials;
            if (!ok && boothBadMaterials != null) return boothBadMaterials;
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            if (shader == null) return null;
            var tint = ok
                ? new Color(0x16 / 255f, 0x8c / 255f, 1f, 1f)
                : new Color(1f, 0x30 / 255f, 0x30 / 255f, 1f);
            var palette = StationMaterials.CreateGhost(shader, tint, 0.62f, 0.34f);
            if (ok) boothOkMaterials = palette; else boothBadMaterials = palette;
            return palette;
        }

        Material ZoneMaterial(Color colour) {
            if (zoneMaterial == null) {
                zoneMaterial = CreateUnlitTransparent("edit zone ghost", colour);
            } else {
                if (zoneMaterial.HasProperty("_BaseColor")) zoneMaterial.SetColor("_BaseColor", colour);
                if (zoneMaterial.HasProperty("_Color")) zoneMaterial.SetColor("_Color", colour);
            }
            return zoneMaterial;
        }

        /// <summary>
        /// The 站台 rail piece (plan 27 §6): the bed the press would dig, drawn as one box at
        /// the track's own level, in the shared blue when the run is legal and red when it is
        /// refused. The pieces in the way are boxed beside it, so an `interference` says which.
        /// </summary>
        public void ShowRail(StationRailPlan plan, IReadOnlyList<StationEditDraft> piers = null) {
            ClearCells();
            if (!bound || plan == null || plan.Bed.Count == 0 || IsUiHidden()) return;
            var colour = plan.Ok ? new Color(0.09f, 0.55f, 1f, 0.4f) : new Color(1f, 0.27f, 0.2f, 0.42f);
            var material = CellMaterial(plan.Ok, colour);
            foreach (var cell in plan.Bed) BuildBox(CellBounds(cell, StationCellShape.Full), material, cellOwned);
            // A bridge's piers are part of the run the press builds, so they are part of the
            // ghost: the deck alone would promise a span with nothing holding it up (plan 28 §3c).
            if (piers != null) {
                foreach (var pier in piers) {
                    if (pier == null) continue;
                    BuildBoxGhost(pier, colour, cellOwned);
                }
            }
            foreach (var id in plan.ColliderIds) {
                if (!TryBlockerBounds(id, out var bounds)) continue;
                BuildLineBox(bounds, RefusalOutlineMaterial(), cellOwned);
            }
            StationEditSession.Ghost = Summary("rail");
        }

        /// <summary>
        /// The 人行道 / 草坪 tile brush's patch (plan 27 §5): a thin slab on each tile the drag
        /// would lay, in the finish's own colour, and the refusal red on the cells the outdoor
        /// rules turn away.
        /// </summary>
        public void ShowSurface(StationSurfacePreview preview) {
            ClearCells();
            if (!bound || preview == null || IsUiHidden()) return;
            if (preview.Cells.Count > 0) {
                int rgb = StationSurfaceTool.ColourFor(preview.Type, preview.Erase);
                var colour = new Color(((rgb >> 16) & 0xFF) / 255f, ((rgb >> 8) & 0xFF) / 255f, (rgb & 0xFF) / 255f, 0.5f);
                var material = CellMaterial(!preview.Erase, colour);
                foreach (var cell in preview.Cells) BuildBox(FaceBounds(cell, StationFace.Top), material, cellOwned);
            }
            if (preview.Refused.Count > 0) {
                var red = CellMaterial(false, new Color(1f, 0.27f, 0.2f, 0.42f));
                foreach (var cell in preview.Refused) BuildBox(FaceBounds(cell, StationFace.Top), red, cellOwned);
            }
            StationEditSession.Ghost = Summary("surface");
        }

        /// <summary>A 2 cm slab standing just proud of one cell face, in document axes.</summary>
        static Bounds FaceBounds(StationCellKey cell, StationFace face) {            const double pad = 0.02;
            double x0 = cell.X, x1 = cell.X + 1, y0 = cell.Y, y1 = cell.Y + 1, z0 = cell.Z, z1 = cell.Z + 1;
            switch (face) {
                case StationFace.Top: z0 = z1; z1 = z1 + pad; break;
                case StationFace.Bottom: z1 = z0; z0 = z0 - pad; break;
                case StationFace.N: y0 = y1; y1 = y1 + pad; break;
                case StationFace.S: y1 = y0; y0 = y0 - pad; break;
                case StationFace.E: x0 = x1; x1 = x1 + pad; break;
                default: x1 = x0; x0 = x0 - pad; break;
            }
            var a = StationCoordinates.Point(new Vector3((float)x0, (float)y0, (float)z0));
            var b = StationCoordinates.Point(new Vector3((float)x1, (float)y1, (float)z1));
            var min = Vector3.Min(a, b);
            var max = Vector3.Max(a, b);
            return new Bounds((min + max) * 0.5f, max - min);
        }

        /// <summary>
        /// Hide the placed piece a move carries, so the player sees only the ghost. The
        /// original record is untouched: an invalid drop or a cancel restores this view.
        /// </summary>
        public void HideCarried(string moduleId) {
            RestoreCarried();
            carriedId = moduleId ?? "";
            ClearHover();
            ClearLayer(selectedOwned);
            if (string.IsNullOrEmpty(moduleId)) return;
            var world = CurrentWorld();
            if (world == null) return;
            foreach (var record in world.Records) {
                if (record?.View == null) continue;
                if (string.Equals(record.ModuleId, moduleId, StringComparison.Ordinal)) {
                    hidden.Add(new Restorable { View = record.View, Active = record.View.activeSelf });
                    record.View.SetActive(false);
                } else if (record.SourceIds != null && record.SourceIds.Length > 0) {
                    int sourceIndex = Array.IndexOf(record.SourceIds, moduleId);
                    if (sourceIndex >= 0 && record.View.TryGetComponent<Views.StationInstancedSurfaceBatch>(out var batch)) {
                        batch.HideSource(sourceIndex);
                        hiddenInstanced.Add(new RestorableInstanced(batch, sourceIndex));
                    }
                }
            }
        }

        /// <summary>Put the carried original back (cancel, refusal, commit, station switch).</summary>
        public void RestoreCarried() {
            foreach (var entry in hidden) {
                if (entry.View != null) entry.View.SetActive(entry.Active);
            }
            hidden.Clear();
            for (int i = 0; i < hiddenInstanced.Count; i++) {
                var entry = hiddenInstanced[i];
                if (entry.Batch != null) entry.Batch.UnhideSource(entry.SourceIndex);
            }
            hiddenInstanced.Clear();
            carriedId = "";
            if (selectedId.Length > 0) Select(index?.GetModule(selectedId));
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
            ClearLayer(selectedOwned);
            selectedId = module?.Id ?? "";
            var world = CurrentWorld();
            if (world == null || module == null) return;
            if (TrySelectionBounds(world, module, out var bounds)) BuildLineBox(bounds, SelectionMaterial(), selectedOwned);
            BuildSurfaceOverlay(module.Id, selectedOwned, FillMaterial(false));
            if (hoveredId == selectedId) ClearLayer(hoverOwned);
        }

        public void ClearSelection() { selectedId = ""; ClearLayer(selectedOwned); }
        public void ClearHover() { hoveredId = ""; ClearLayer(hoverOwned); }

        public void Hover(StationModuleRecord module) {
            if (IsUiHidden()) { ClearHover(); return; }
            var id = module?.Id ?? "";
            if (id == hoveredId) return;
            ClearHover();
            hoveredId = id;
            if (id.Length > 0 && id != selectedId && id != carriedId) BuildSurfaceOverlay(id, hoverOwned, FillMaterial(true));
        }

        Material FillMaterial(bool hover) {
            if (hover && hoverFill != null) return hoverFill;
            if (!hover && selectedFill != null) return selectedFill;
            var material = CreateUnlitTransparent(hover ? "edit hover fill" : "edit selected fill",
                new Color(0x16 / 255f, 0x8c / 255f, 1, hover ? .28f : .16f));
            if (hover) hoverFill = material; else selectedFill = material;
            return material;
        }

        void ClearLayer(List<GameObject> layer) {
            foreach (var go in layer) {
                if (go != null) {
                    go.SetActive(false);
                    var mesh = go.GetComponent<MeshFilter>()?.sharedMesh;
                    if (mesh != null && overlayMeshes.Remove(mesh)) Destroy(mesh);
                }
                Destroy(go);
            }
            surfaceLinks.RemoveAll(link => link.Overlay == null || layer.Contains(link.Overlay));
            layer.Clear();
        }

        // Copy only the draw binding. Source meshes and base materials remain untouched; no
        // overlay is registered with the scene picker. Batched paving uses its authored spans.
        void BuildSurfaceOverlay(string id, List<GameObject> into, Material material) {
            var world = CurrentWorld();
            if (world == null) return;
            foreach (var record in world.Records) {
                if (record.View == null) continue;
                int sourceIndex = record.SourceIds == null ? -1 : Array.IndexOf(record.SourceIds, id);
                if (record.ModuleId != id && sourceIndex < 0) continue;
                foreach (var filter in record.View.GetComponentsInChildren<MeshFilter>(true)) {
                    var source = filter.GetComponent<MeshRenderer>();
                    var mesh = filter.sharedMesh;
                    if (!source || !mesh) continue;
                    if (record.ModuleId != id) {
                        var instanced = record.View.GetComponent<Views.StationInstancedSurfaceBatch>();
                        if (instanced != null) {
                            if (instanced.SharedMesh == null ||
                                !instanced.TryGetSourceRange(sourceIndex, out int instStart, out int instCount)) continue;
                            var combines = new CombineInstance[instCount];
                            for (int k = 0; k < instCount; k++) {
                                combines[k] = new CombineInstance {
                                    mesh = instanced.SharedMesh,
                                    subMeshIndex = instanced.SubmeshIndex,
                                    transform = instanced.Matrices[instStart + k],
                                };
                            }
                            var part = new Mesh { name = "highlight source " + id };
                            part.CombineMeshes(combines, true, true);
                            part.RecalculateBounds();
                            overlayMeshes.Add(part);
                            mesh = part;
                        } else {
                            if (record.SourceSpans == null || mesh.subMeshCount != 1 || mesh.GetTopology(0) != MeshTopology.Triangles) continue;
                            var indices = mesh.GetTriangles(0);
                            var selected = new List<int>();
                            foreach (var span in record.SourceSpans) {
                                if (span.SourceIndex != sourceIndex) continue;
                                for (int i = span.StartTriangle * 3; i < (span.StartTriangle + span.TriangleCount) * 3; i++) selected.Add(indices[i]);
                            }
                            if (selected.Count == 0) continue;
                            var part = new Mesh { name = "highlight source " + id, indexFormat = mesh.indexFormat };
                            part.vertices = mesh.vertices;
                            part.SetTriangles(selected, 0);
                            part.RecalculateBounds();
                            overlayMeshes.Add(part);
                            mesh = part;
                        }
                    }
                    var go = new GameObject("surface highlight " + id);
                    go.transform.SetParent(transform, false);
                    go.AddComponent<MeshFilter>().sharedMesh = mesh;
                    var renderer = go.AddComponent<MeshRenderer>();
                    var materials = new Material[mesh.subMeshCount];
                    for (int i = 0; i < materials.Length; i++) materials[i] = material;
                    renderer.sharedMaterials = materials;
                    renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                    renderer.receiveShadows = false;
                    into.Add(go);
                    surfaceLinks.Add(new SurfaceLink { Id = id, Source = source, Overlay = go });
                }
            }
            RefreshSurfaceLinks();
        }

        void LateUpdate() {
            SyncVisibility();
            RefreshSurfaceLinks();
            var visibility = StationViewFeature.Active?.Visibility;
            if (visibility == null) return;
            var normal = StationCameraSpace.ToWorld(visibility.Section.Normal);
            var point = StationCameraSpace.ToWorld(visibility.Section.Point);
            var plane = new Vector4(normal.x, normal.y, normal.z, -Vector3.Dot(normal, point));
            ApplyClip(selectedFill, visibility.SectionClipping, plane); ApplyClip(hoverFill, visibility.SectionClipping, plane);
            ApplyClip(cellOkMaterial, visibility.SectionClipping, plane); ApplyClip(cellBadMaterial, visibility.SectionClipping, plane);
            ApplyClip(cellRingMaterial, visibility.SectionClipping, plane);
            ApplyClip(zoneMaterial, visibility.SectionClipping, plane);
            ApplyClip(eraseMaterial, visibility.SectionClipping, plane);
        }
        static void ApplyClip(Material material, bool clip, Vector4 plane) {
            if (material == null || !material.HasProperty("_SectionPlane")) return;
            material.SetVector("_SectionPlane", plane); material.SetFloat("_SectionClip", clip ? 1 : 0);
        }
        void RefreshSurfaceLinks() {
            bool selectedVisible = false;
            foreach (var link in surfaceLinks) {
                if (!link.Overlay) continue;
                bool visible = link.Source && link.Source.enabled && link.Source.gameObject.activeInHierarchy;
                link.Overlay.SetActive(visible);
                if (visible && link.Id == selectedId) selectedVisible = true;
                if (!visible) continue;
                var source = link.Source.transform;
                link.Overlay.transform.SetPositionAndRotation(source.position, source.rotation);
                link.Overlay.transform.localScale = source.lossyScale;
            }
            foreach (var go in selectedOwned) if (go != null && go.name == "selection box") go.SetActive(selectedVisible);
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
                if (string.Equals(record.ModuleId, moduleId, StringComparison.Ordinal)) {
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
                    continue;
                }
                if (record.SourceIds != null && record.SourceIds.Length > 0) {
                    int sourceIndex = Array.IndexOf(record.SourceIds, moduleId);
                    if (sourceIndex < 0) continue;
                    if (record.View.TryGetComponent<Views.StationInstancedSurfaceBatch>(out var batch) &&
                        batch.SharedMesh != null &&
                        batch.TryGetSourceRange(sourceIndex, out int instStart, out int instCount)) {
                        var local = batch.SharedMesh.bounds;
                        for (int k = 0; k < instCount; k++) {
                            var matrix = batch.Matrices[instStart + k];
                            for (int corner = 0; corner < 8; corner++) {
                                var point = matrix.MultiplyPoint3x4(new Vector3(
                                    (corner & 1) == 0 ? local.min.x : local.max.x,
                                    (corner & 2) == 0 ? local.min.y : local.max.y,
                                    (corner & 4) == 0 ? local.min.z : local.max.z));
                                if (!any) { bounds = new Bounds(point, Vector3.zero); any = true; }
                                else bounds.Encapsulate(point);
                            }
                        }
                    } else if (record.SourceBounds != null && sourceIndex < record.SourceBounds.Length &&
                               !record.SourceBounds[sourceIndex].IsEmpty) {
                        var wb = WorldFromDocument(record.SourceBounds[sourceIndex]);
                        if (!any) { bounds = wb; any = true; }
                        else bounds.Encapsulate(wb);
                    }
                }
            }
            return any;
        }

        void OnDestroy() {
            ClearGhost();
            ClearCells();
            ClearLayer(selectedOwned);
            ClearHover();
            foreach (var mesh in overlayMeshes) Destroy(mesh);
            if (selectedFill) Destroy(selectedFill);
            if (hoverFill) Destroy(hoverFill);
            if (eraseMesh != null) Destroy(eraseMesh);
            if (eraseBatch != null) Destroy(eraseBatch);
            if (boxMesh != null) Destroy(boxMesh);
            if (lineMesh != null) Destroy(lineMesh);
            if (cellMesh != null) Destroy(cellMesh);
            foreach (var mesh in wedges.Values) Destroy(mesh);
            wedges.Clear();
            if (okMaterial != null) Destroy(okMaterial);
            if (badMaterial != null) Destroy(badMaterial);
            if (okLineMaterial != null) Destroy(okLineMaterial);
            if (badLineMaterial != null) Destroy(badLineMaterial);
            if (selectMaterial != null) Destroy(selectMaterial);
            if (eraseMaterial != null) Destroy(eraseMaterial);
            if (cellOkMaterial != null) Destroy(cellOkMaterial);
            if (cellBadMaterial != null) Destroy(cellBadMaterial);
            if (cellRingMaterial != null) Destroy(cellRingMaterial);
            if (zoneMaterial != null) Destroy(zoneMaterial);
            if (cursorOkMaterial != null) Destroy(cursorOkMaterial);
            if (cursorBadMaterial != null) Destroy(cursorBadMaterial);
            if (blockerOutlineMaterial != null) Destroy(blockerOutlineMaterial);
            boothOkMaterials?.Dispose();
            boothOkMaterials = null;
            boothBadMaterials?.Dispose();
            boothBadMaterials = null;
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
                ModulePlacement.Resolve(record, entry, index),
                ModulePlacement.Rotation(facts));
            bool ok = colour.r < 0.5f;
            var material = Tinted(ok, colour);
            Material lineMaterial = null;
            foreach (var renderer in go.GetComponentsInChildren<Renderer>(true)) {
                if (renderer == null) continue;
                renderer.forceMeshLod = 0;
                var filter = renderer.GetComponent<MeshFilter>();
                var mesh = filter != null ? filter.sharedMesh : null;
                int count = renderer.sharedMaterials.Length;
                var materials = new Material[count];
                for (int i = 0; i < count; i++) {
                    bool isLine = mesh != null && mesh.subMeshCount > 0 &&
                        mesh.GetTopology(Mathf.Min(i, mesh.subMeshCount - 1)) != MeshTopology.Triangles;
                    materials[i] = isLine ? (lineMaterial ??= TintedUnlit(ok, colour)) : material;
                }
                renderer.sharedMaterials = materials;
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                renderer.receiveShadows = false;
            }
            owned.Add(go);
            return true;
        }

        /// <summary>The unresolved-candidate stand-in: the clearance body the verdict read.</summary>
        void BuildBoxGhost(StationEditDraft draft, Color colour, List<GameObject> into = null) {
            var record = StationModulePlacement.ToRecord(draft);
            if (!StationFootprints.TryClearance(record, out var box, out _)) {
                box = new StationBox(draft.X, draft.Y, draft.Z + 1, draft.X + 1, draft.Y + 1, draft.Z + 2);
            }
            BuildBox(WorldFromDocument(box), Tinted(colour.r < 0.5f, colour), into ?? owned);
        }

        /// <summary>
        /// The source's selection box: twelve **line segments** on the box's edges, not twelve
        /// thin prisms. A line-topology mesh draws one device pixel wide at any zoom, which is
        /// what a `THREE.Box3Helper` does, and it costs one draw call instead of twelve.
        /// </summary>
        void BuildLineBox(Bounds bounds, Material material, List<GameObject> into = null) {
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
            (into ?? owned).Add(go);
        }

        void BuildBox(Bounds bounds, Material material, List<GameObject> into = null) {
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
            (into ?? owned).Add(go);
        }

        // -------------------------------------------------------------- cell ghost

        /// <summary>A cell's drawn box in document axes, narrowed to a cut piece's kept part.</summary>
        static Bounds CellBounds(StationCellKey cell, StationCellShape shape) {
            var rect = StationCellRules.Bounds(shape);
            var a = StationCoordinates.Point(new Vector3((float)(cell.X + rect.X0), (float)(cell.Y + rect.Y0), cell.Z));
            var b = StationCoordinates.Point(new Vector3((float)(cell.X + rect.X1), (float)(cell.Y + rect.Y1), cell.Z + 1));
            var min = Vector3.Min(a, b);
            var max = Vector3.Max(a, b);
            return new Bounds((min + max) * 0.5f, max - min);
        }

        /// <summary>One retained mesh for erase surfaces. Quarter patches cancel shared faces,
        /// including partial contacts between full, half and corner cells. Cut wedges keep their
        /// own sloped faces. Depth bias belongs to the highlight shader, so bounds stay exact.</summary>
        void BuildEraseBatch(IReadOnlyList<StationCellKey> cells, Material material) {
            eraseVertices.Clear(); eraseTriangles.Clear(); eraseFaces.Clear();
            foreach (var cell in cells) {
                var record = index.GetCell(cell);
                var shape = record == null ? StationCellShape.Full : StationCellRules.ShapeOf(record.Tags);
                if (shape.Kind == StationShapeKind.Triangle) {
                    var wedge = WedgeMesh(shape.Side, shape.Triangle == StationTriangleKind.Lower);
                    int start = eraseVertices.Count;
                    var origin = StationCoordinates.Point(new Vector3(cell.X, cell.Y, cell.Z));
                    foreach (var vertex in wedge.vertices) eraseVertices.Add(origin + vertex);
                    foreach (var triangle in wedge.triangles) eraseTriangles.Add(start + triangle);
                    continue;
                }
                var rect = StationCellRules.Bounds(shape);
                for (double x = rect.X0; x < rect.X1; x += .5)
                    for (double y = rect.Y0; y < rect.Y1; y += .5) {
                        var a = StationCoordinates.Point(new Vector3(cell.X + (float)x, cell.Y + (float)y, cell.Z));
                        var b = a + new Vector3(.5f, 1, .5f);
                        int first = eraseVertices.Count, firstIndex = eraseTriangles.Count;
                        BoxFaces.AppendAxisAligned(eraseVertices, eraseTriangles, (a + b) / 2, b - a);
                        for (int face = 0; face < 6; face++) {
                            var min = eraseVertices[first + face * 4]; var max = min;
                            for (int v = 1; v < 4; v++) {
                                min = Vector3.Min(min, eraseVertices[first + face * 4 + v]);
                                max = Vector3.Max(max, eraseVertices[first + face * 4 + v]);
                            }
                            var key = (min, max);
                            int faceIndex = firstIndex + face * 6;
                            if (eraseFaces.TryGetValue(key, out var previous)) {
                                for (int i = 0; i < 6; i++) { eraseTriangles[previous + i] = -1; eraseTriangles[faceIndex + i] = -1; }
                                eraseFaces.Remove(key);
                            } else eraseFaces[key] = faceIndex;
                        }
                    }
            }
            eraseTriangles.RemoveAll(i => i < 0);
            if (eraseMesh == null) {
                eraseMesh = new Mesh { name = "retained erase surfaces", indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
                eraseMesh.MarkDynamic();
                eraseBatch = new GameObject("erase surface batch");
                eraseBatch.transform.SetParent(transform, false);
                eraseBatch.AddComponent<MeshFilter>().sharedMesh = eraseMesh;
                var renderer = eraseBatch.AddComponent<MeshRenderer>();
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                renderer.receiveShadows = false;
            }
            eraseMesh.Clear();
            eraseMesh.SetVertices(eraseVertices);
            eraseMesh.SetTriangles(eraseTriangles, 0);
            eraseMesh.RecalculateBounds();
            eraseBatch.GetComponent<MeshRenderer>().sharedMaterial = material;
            eraseBatch.SetActive(eraseTriangles.Count > 0);
        }

        /// <summary>One cell's ghost: the whole block, a cut's thin panel, or a 三角's wedge.</summary>
        void BuildCellGhost(StationCellKey cell, StationCellShape shape, Material material, List<GameObject> into) {
            if (shape.Kind == StationShapeKind.Triangle) {
                BuildWedge(cell, shape, material, into);
                return;
            }
            BuildBox(CellBounds(cell, shape.IsFull ? StationCellShape.Full : shape), material, into);
        }

        /// <summary>
        /// A 三角's wedge, drawn as the prism it tags: the cross-section is the region under
        /// (or over) the slope in the cell's own 1 m frame, extruded across the cell. The
        /// meshes are unit prisms in **world** axes relative to the cell's document origin,
        /// cached per side and kind, and the ghost material is unlit and double-sided — so no
        /// winding or normal can make the piece read as a whole block.
        /// </summary>
        void BuildWedge(StationCellKey cell, StationCellShape shape, Material material, List<GameObject> into) {
            var mesh = WedgeMesh(shape.Side, shape.Triangle == Metro.Build.StationTriangleKind.Lower);
            var go = new GameObject("preview wedge");
            go.transform.SetParent(transform, false);
            go.transform.position = StationCoordinates.Point(new Vector3(cell.X, cell.Y, cell.Z));
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            into.Add(go);
        }

        readonly Dictionary<(StationWallSide Side, bool Lower), Mesh> wedges =
            new Dictionary<(StationWallSide, bool), Mesh>();

        Mesh WedgeMesh(StationWallSide side, bool lower) {
            if (wedges.TryGetValue((side, lower), out var cached)) return cached;
            // Cross-section in (u, z): `u` is the plan axis the slope climbs across, `z` the
            // course. A wedge under the slope keeps z ≤ u; one over it keeps z ≥ 1 − u.
            var section = lower
                ? new[] { new Vector2(0f, 1f), new Vector2(1f, 0f), new Vector2(1f, 1f) }
                : new[] { new Vector2(0f, 0f), new Vector2(1f, 0f), new Vector2(1f, 1f) };
            var vertices = new List<Vector3>(6);
            // Document → world is the repo's one swap, (x, y, z) → (x, z, y); the mesh is built
            // already swapped and relative to the cell origin.
            foreach (var point in section) {
                for (int v = 0; v <= 1; v++) {
                    float u = point.x, z = point.y;
                    float dx, dy;
                    switch (side) {
                        case StationWallSide.S: dx = v; dy = 1f - u; break;
                        case StationWallSide.E: dx = u; dy = v; break;
                        case StationWallSide.W: dx = 1f - u; dy = v; break;
                        default: dx = v; dy = u; break;
                    }
                    vertices.Add(new Vector3(dx, z, dy));
                }
            }
            var indices = new List<int>(24);
            indices.AddRange(new[] { 0, 2, 4 });
            indices.AddRange(new[] { 1, 5, 3 });
            for (int i = 0; i < 3; i++) {
                int a = i * 2, b = ((i + 1) % 3) * 2;
                indices.AddRange(new[] { a, b, b + 1, a, b + 1, a + 1 });
            }
            var mesh = new Mesh { name = "edit preview wedge " + side + (lower ? " lower" : " upper") };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(indices, 0);
            mesh.RecalculateBounds();
            wedges[(side, lower)] = mesh;
            return mesh;
        }

        /// <summary>
        /// The cell ghost material: **unlit** and double-sided, so a translucent cell reads as
        /// a marking rather than a lit block and no backface can hide it.
        /// </summary>
        Material CellMaterial(bool ok, Color colour) {
            if (ok && cellOkMaterial != null) return cellOkMaterial;
            if (!ok && cellBadMaterial != null) return cellBadMaterial;
            var material = CreateUnlitTransparent(ok ? "edit cell ghost" : "edit cell refusal", colour);
            if (ok) cellOkMaterial = material; else cellBadMaterial = material;
            return material;
        }

        /// <summary>The auto-wall ring: the same blue, slightly fainter, so it reads as generated.</summary>
        Material RingMaterial() {
            if (cellRingMaterial != null) return cellRingMaterial;
            cellRingMaterial = CreateUnlitTransparent("edit cell ring", new Color(0.42f, 0.72f, 1f, 0.22f));
            return cellRingMaterial;
        }

        /// <summary>Boxes the placed piece standing in a refused cell.</summary>
        Material RefusalOutlineMaterial() {
            if (blockerOutlineMaterial != null) return blockerOutlineMaterial;
            blockerOutlineMaterial = CreateUnlitTransparent("edit cell blocker", new Color(1f, 0.27f, 0.2f, 1f));
            return blockerOutlineMaterial;
        }

        static Material CreateUnlitTransparent(string name, Color colour) {
            var shader = Shader.Find("Metro/Station Highlight") ?? Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color")
                ?? Shader.Find("Universal Render Pipeline/Lit");
            var material = new Material(shader) { name = name };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", colour);
            if (material.HasProperty("_Color")) material.SetColor("_Color", colour);
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_Blend")) material.SetFloat("_Blend", 0f);
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            if (material.HasProperty("_Cull")) material.SetFloat("_Cull", 0f);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            return material;
        }

        /// <summary>The drawn bounds of one placed piece, for a refusal's red outline.</summary>
        bool TryBlockerBounds(string moduleId, out Bounds bounds) {
            bounds = default;
            var world = CurrentWorld();
            if (world == null || string.IsNullOrEmpty(moduleId)) return false;
            return TrySelectionBounds(world, FindModule(moduleId), out bounds);
        }

        static StationModuleRecord FindModule(string moduleId) {
            var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            return host != null && host.Index != null ? host.Index.GetModule(moduleId) : null;
        }

        /// <summary>The one accepted (blue) or refused (red) ghost material, cached per preview.</summary>
        Material Tinted(bool ok, Color colour) {
            if (ok && okMaterial != null) return okMaterial;
            if (!ok && badMaterial != null) return badMaterial;
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            var material = shader != null
                ? StationGlass.Create(shader, ok ? "edit ghost" : "edit refusal",
                    new Color(colour.r, colour.g, colour.b, 1f), colour.a, 0.25f, 0f, doubleSided: true)
                : new Material(Shader.Find("Sprites/Default")) { name = ok ? "edit ghost" : "edit refusal" };
            if (ok) okMaterial = material; else badMaterial = material;
            return material;
        }

        /// <summary>Unlit translucent ghost material for line-topology submeshes (such as court nets).</summary>
        Material TintedUnlit(bool ok, Color colour) {
            if (ok && okLineMaterial != null) return okLineMaterial;
            if (!ok && badLineMaterial != null) return badLineMaterial;
            var shader = Shader.Find("Metro/Station Highlight") ?? Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color")
                ?? Shader.Find("Universal Render Pipeline/Lit");
            var material = new Material(shader) { name = ok ? "edit ghost line" : "edit refusal line" };
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
            if (ok) okLineMaterial = material; else badLineMaterial = material;
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
