# Unity rendering, retained edits, visibility, Mesh LODs & FSR 1.0

Active C# rendering contracts in `Metro.View` and `Metro.App`. For measured
benchmarks and memory budgets, see
[perf-unity.md](../../metro-repo/references/perf-unity.md); for Mesh LOD baking
and per-model triangle counts, see
[metro-unity-assets](../../metro-unity-assets/SKILL.md) and
[unity-model-lod-inventory.md](../../metro-repo/references/unity-model-lod-inventory.md).

## 1. Retained incremental edits & cell meshing

- **Local edit pipeline (`StationLocalEdit`, `StationLoadCoordinator`,
  `StationWorldView`):** Ordinary cell/module edits, `edit.undo`, and `edit.redo`
  patch the 1-ring neighborhood onto immutable `StationRecordPages<T>` (`256`
  records/page) and sharded `StationIndex.TryCreateIncremental` (`StationIndexDelta`),
  deferring full `NormalizedJson`/`EnsureContentHash`. `StationEditClassifier.ClassifyLocal`
  classifies edits as `DayOnly`, `Cosmetic`, or `Structural` before staging.
  `StationWorldView.StageLocalWorld` / `CommitLocalWorld` updates only dirty
  geometry, affected module families (`StationEquipmentModuleRenderer`,
  `OutdoorModuleRenderer`, `OpeningModuleRenderer` for `gate`/`door`/`cubicle`,
  `StationRoadRenderer` via `TryApplyRoadSet` + `TryStageLocalDelta`,
  `StationContactShadowRenderer`, and zone overlay bands), and
  `StationScenePicker.ApplyLocalCommit`, while
  `StationWalkGraphWorkspace.StageCellDelta` repairs walk topology in ping-pong
  scratch buffers. `StationEditSession.ClearHistory()` unconditionally clears
  undo/redo on every non-edit station load (`stationEpoch` bumps monotonically).
  Any stage failure rolls back document, view, and simulation together
  (`StationPlan32EquivalenceAndRollbackTests`, `StationShellAndRoadDeltaTests`).
- **Retained cell chunks (`StationCellMesher`, `StationCellMeshWorkspace`):**
  Chunks mesh by `16 × 16 × storey × role × finish` across six
  `StationSurfaceRole` passes (`Cell`, `Ceiling`, `Plate`, `Ground`, `Wall`,
  `Roof`), keying faces with lossless 128-bit `FaceRecordKey` and distinguishing
  `MainWorld` vs `ExplodedTray` via `StationCellViewerPolicy`.
  `StationCellSurfacePolicy` classifies full and retained builds from the same
  physical courses across hidden storey boundaries: suspended/opening ceilings
  never occlude adjacent faces; independently hideable masonry roofs apply only
  to the exposed cap of a backed deck at or above grade with a full `2 × 2`
  footprint; retained remeshing keeps a `±2` XY and adjacent-storey halo so
  upper-course edits refresh lower classifications and AO (`StationCellMeshTests`).
- **Automatic walls & edge placement parity:** Automatic walls belong to
  elevations strictly above a tracked floor through one storey height; preview
  and release reuse the same patch for matching revision/gesture inputs (pinned
  against web by `node tools/unity-parity/record-auto-wall-edits.mjs --check`,
  `StationLocalEditTests`, `StationCellPlannerTests`). `ModulePlacement.Resolve`
  rotates catalogue insets around cell centre, applies `EdgeDecorGlassShare`
  `0.15 m` curtain clearance once, and matches `edge-placement-oracle.json`
  (`node tools/unity-parity/record-edge-placement.mjs --check`).

## 2. Pointer picking, previews & highlights

- **Single-pick pointer router (`StationPointerRouter`, `StationScenePicker`):**
  Builds one camera `Ray` per pointer event, checks `StationSectionDrag` first
  (`0` picks when consumed or on `pointer.up`), and resolves at most one
  `StationScenePicker.PickRay` against camera-visible triangles (enforcing active
  `GameObject`, `Renderer.enabled`, camera mask, `ClipInterval`, submesh cull
  mode, negative-scale winding flip, per-triangle `IsPointKept`, and per-tile
  `StationBatchSpan`s on combined batches). `NeedsWorkPlane` permits active-storey
  plane fallback only on adds (never secondary erase or delete); `OwnsPress` and
  `CancelActiveGesture` handle chord/mask-loss/Escape cancellation with zero
  picks or revisions; `ProbeBudgetFor` bounds `edit.probe` candidate walks by
  cell count (`48` at `20k+`, `96` at `8k+`, `192` otherwise); post-commit hover
  re-aim defers to coalesced `StationGameHost.RequestHoverRefresh`; parked carried
  moves record `StationEditSession.ParkedMoveAim` (`StationPlacementAimInput`) and
  revalidate with zero scene picks via `RevalidateParkedMove` (guarded by
  `CommittingMove`) on document commits, hover refreshes, and `ConfirmMove`.
- **Separated preview layers & retained highlights (`StationPlacementPreview`):**
  Hover, persistent selection, carried-piece hiding (`HideCarried` /
  `RestorableInstanced`), and cell/module ghosts have separate ownership outside
  document commits and the pick registry.
  - Selection draws the module's rendered bounds expanded by `SelectionPad = 0.06 m`
    as a `#55b6ff` `MeshTopology.Lines` box.
  - Placement previews pin `renderer.forceMeshLod = 0` so ghosts stay full detail.
  - Cell erase previews merge into one dynamic retained mesh (`BuildEraseBatch`),
    cancelling shared quarter-patch faces and rendering with the section-aware
    depth-biased `Metro/Station Highlight` (`Resources/StationHighlight.shader`,
    `Offset -1, -1`). Verified with `metro-unity.ps1 test -Graphics -TestFilter StationHighlightRetentionTests`.

## 3. Unified visibility, cutaway shaders & section dragging

- **Unified visibility (`StationVisibilityRegistry`, `StationVisibilityTarget`):**
  `Decide` applies one storey/grade/cutaway decision (`Hidden`, `Base`, `Ghost`,
  `Clear`) across stationary geometry, soft-human `Actor` targets
  (`PassengerSupportResolver`), whole `Train` consists, and pooled `Vehicle`
  targets (`StationVisibilityTests`, `StationMovingVisibilityTests`).
  `ComputeActiveBuilt` inspects non-grade station geometry only; `GradeOwned`
  separates `0 m` street furniture/surfaces/traffic for `隐藏地面` while
  preserving `0 m` head-house exit pads.
- **Artwork recapture & platform/train visuals:** Whenever a view binds or swaps
  runtime textures or materials after registration (signs, PSD headers & vinyl
  decals, exits, calligraphy, train livery/cab marks via `TrainLiveryBinder`,
  billboards, TVs, line maps, clocks, road signals), it must call
  `world.RecaptureArtwork(renderer)` (`StationVisibilityTarget.Recapture` →
  `SyncDerived` updates `Ghost`, `Clear`, and section-shader clones in place) and
  set glTFast ShaderGraph `baseColorTexture` / `baseColorFactor` alongside URP
  `_BaseMap`. `StationRailMeshes` builds full 5 m rigid/gantry catenary,
  `OpeningModuleViews` emits the yellow safety line across all PSD modes plus
  four printed vinyl decals on full-height PSDs, `TrainDoorRig` supports
  both-bank platform doors, and `StationContactShadowRenderer` /
  `PassengerCrowdView` draw unpickable GPU-instanced contact shadows
  (`StationTrainAndPlatformVisualsTests`).
- **Section-plane shaders & handle drag (`StationSectionView`, `StationSectionDrag`):**
  Per-pixel cutaway clips fragments via `_SectionPlane` / `_SectionClip` in
  `StationSectionClip.hlsl` and `StationSectionDepth.hlsl` across
  `Metro/Station Finish` (`StationFinish.shader`), `Metro/Station Section Lit`
  (`StationSectionLit.shader`), `Metro/Station Section Unlit`
  (`StationSectionUnlit.shader`), and `Metro/Station Highlight`.
  `StationSectionView` draws the 2 m hatch sheet, grab sphere, and overlay
  `#2fd06a` direction arrow (`ArrowColour`, `ControlToleranceMetres = 0.22 m`).
  `StationSectionDrag` projects the cut normal once on press (`TryAxis`), slides
  strictly along that frozen screen axis with `0.5 m` snap (`0.05 m` with Shift,
  half-up `TsRound`), and updates `StationViewRig.SetSectionOffset` without
  creating revisions or undo entries (`StationSectionDragTests`).

## 4. Lighting rig, Hide UI skybox & standalone Exploded View

- **Light rig (`StationRenderRig`):** Ports `game/src/render/scene/lightRig.ts`
  with `/ π` URP Lambertian intensity compensation (`Daylight` `1.5/π`,
  `Station Fill` `0.45/π`, global `_StationAmbient`, `_StationHemiSky`,
  `_StationHemiGround`, `reflectionIntensity = 0`, no shadows, linear fog
  `120–320 m`, dark void `(18, 26, 34)` or `StudioVoidColor` `(244, 243, 237)`).
- **Hide UI skybox, theme sync & horizon fog (`StationSkySystem`):**
  `view.set { key: "theme", value }` (`blueprint` | `site` | `studio`, accepted
  even before `rig.Configure`) updates `StationSkySystem.SetTheme` void colour
  and linear fog immediately while `hideUi` is off, and `StationViewRig.SyncSky(force: true)`
  restores the active theme baseline when Exploded View closes. When `hideUi` is
  enabled, switches the camera from `SolidColor` + void fog to a shared `512 × 512`
  `R8G8B8A8_SRGB` procedural cloud cubemap on `Metro/Station Sky`
  (`Resources/StationSky.shader`), scaled by `SkyIntensity(simTime)` across
  `05:00–07:00` dawn and `17:00–19:00` dusk (`[0.015, 1.0]`), with linear-space
  `HorizonFogColor` matching the `120–320 m` horizon fog and `reflectionIntensity = 0`.
  Disabling `hideUi` restores `SolidColor` and void fog cleanly.
- **Standalone Exploded View (`StationExplodedView`, `StationExplodedTrayBuilder`):**
  Mounts an isolated hierarchy and orthographic `ExplodedViewerCamera` on User
  Layer 8 (`ExplodedPresentation` in `TagManager.asset`, stripped from the editor
  camera). Builds concave-packed trays (`StationExplodedLayoutPlan`), deferred
  props/connectors (`PropsBatchBudget = 96`/frame), dashed guides
  (`Metro/Station Exploded Guide`, `StationExplodedGuide.shader`), and live
  tray-owned crowd/train/lift/escalator animation without mutating the document.
  Saves and restores the editor camera and `HideUi` skybox/fog baseline across
  open/close, closes cleanly on `Coordinator.BeforePreviousDispose`, pauses
  hidden editor sinks via `IStationActiveDuringExplodedView`, and clears native
  mesh buffers synchronously on close (`StationExplodedViewPlayTests`).

## 5. Model detail profiles & non-active storey Mesh LODs

- **Profiles (`StationGraphicsSettings`, `StationModelDetailConfiguration`):**
  Configured under **Project Settings → Station Designer → Graphics**
  (`StationGraphicsProjectSettings`), persisted in `PlayerPrefs`
  (`metro.graphics.model-detail`), and exposed via `graphics.get`/`graphics.set`:
  - `high`: bias `1.0`, `MinimumModelLod = 0`, `OtherLevelModelLod = 1` (`LOD1`).
  - `balanced`: bias `0.7`, `MinimumModelLod = 0`, `OtherLevelModelLod = 2` (`LOD2`).
  - `low`: bias `0.4`, `MinimumModelLod = 1`, `OtherLevelModelLod = 2` (`LOD2`).
  - Shared curve: `FullThreshold = 0.12`, `ReducedThreshold = 0.05`,
    `Hysteresis = 0.10`, `NativeThreshold = 1.0`.
- **Non-active storey step-down (`StationVisibilityRules.OtherLevelMeshLod`):**
  Objects on non-active or ghosted storeys step down by one Unity LOD tier:
  - `StationVisibilityTarget` sets `renderer.forceMeshLod` on multi-LOD
    `MeshRenderer`s (including `Clear` walls/PSDs under `HideWalls`).
  - `StationInstancedSurfaceDrawer.SelectMeshLod` floors instanced batches to
    the stepped-down tier while still permitting distance drops to `LOD2`.
  - `PassengerCrowdView.SelectActorMesh` (live and paused via `OnActorModeApplied`)
    swaps skinned actor tiers accordingly.
  - **Exemptions:** `HideUi`, `Cutaway`, `Grid`/`Cursor`/`Overlay` roles,
    standalone exploded trays, placement previews (`forceMeshLod = 0`), and the
    followed passenger retain normal detail. Profile switches reapply
    `StationViewFeature.Active?.Visibility?.Apply()` (`StationModelLodTests`).

## 6. Runtime FSR 1.0 upscaling (`StationFsrUpscaler`)

- Modes (`PlayerPrefs` key `metro.graphics.upscaling`, default `native`):
  `native` (`1.0`), `ultra` (`1/1.3`), `quality` (`1/1.5`), `balanced` (`1/1.7`),
  `performance` (`0.5`), exposed through `graphics.get`/`graphics.set`
  (`upscaling`, `renderScale`, `upscalingBackend`) to Settings and
  `/game/unity/benchmark` (`StationFsrSettingsTests`).
- **Desktop / Shader Model ≥ 4.5 (`upscalingBackend: "urp-fsr1"`):** When
  `SystemInfo.graphicsShaderLevel >= 45` (Windows D3D11/D3D12/Vulkan), sets URP
  `renderScale` and `upscalingFilter = 3` (`FSR`) directly on the pipeline asset.
- **WebGL 2 / ES 3.0 (`upscalingBackend: "webgl-fsr1"`):** Keeps URP
  `renderScale = 1.0` to prevent double scaling, redirects active `CameraType.Game`
  rendering to a scaled `RenderTexture` in `beginCameraRendering`, runs the
  two-pass EASU (`Pass 0`) + RCAS (`Pass 1`, `DefaultSharpness = 0.2`) shader
  (`Resources/StationFsr1.shader`, `Metro/Station FSR 1`) to the backbuffer in
  `endCameraRendering`, and immediately restores `camera.targetTexture = null`
  so picking and viewport layout observe full screen dimensions.

## 7. Glass, GPU instancing & player shader-variant preservation

- **Generated glass (`StationGlass`) & Linear color space:** All procedurally
  generated transparent glass (`StationGlass.Create` / `MakeTransparent`, default
  sRGB tint `#a8d8e6`, `queue = 3000`, `_ZWrite = 0`, `_SrcBlend = SrcAlpha`,
  `_DstBlend = OneMinusSrcAlpha`, `_BlendModePreserveSpecular = 0`,
  `_SURFACE_TYPE_TRANSPARENT` enabled, `_ALPHAPREMULTIPLY_ON` disabled) clones
  `Resources/StationGlassRef.mat` (`URP/Lit`) when using `Universal Render Pipeline/Lit`.
  Pass authored **sRGB** `Color` directly to `SetColor("_BaseColor", ...)` —
  Unity converts `Color` properties sRGB → linear automatically in Linear color
  space (`m_ActiveColorSpace: 1`), so calling `.linear` first double-darkens
  pale sky-blue into deep teal. Never mutate shared imported glTFast asset
  materials directly.
- **Glazed lift material parity (`VerticalModuleViews`):** Glazed lifts use
  `PaletteLiftSteel` (`#b7bdc4`, `_Metallic = 0.18`, `_Smoothness = 0.68`,
  matching `LiftModel.ts` so stainless stays readable with `reflectionIntensity = 0`)
  for `shaft`, `portals`, `caps`, and `cabin-body`, and `PaletteLiftGlass`
  (`#a8d8e6`, opacity `0.20`) for glazed shaft/portal/cabin panels and leaves;
  steel lifts keep `PaletteDark` caps. Shared across main world, EditMode
  defaults, and exploded trays via `VerticalModuleViews.CreatePaletteMaterial`.
- **Shader variant preservation in player builds:** URP `Lit.shader` declares
  both `_SURFACE_TYPE_TRANSPARENT` and `_ALPHAPREMULTIPLY_ON` as
  `shader_feature_local_fragment`. `Resources/StationGlassRef.mat` MUST keep
  the exact straight-alpha keyword set (`_SURFACE_TYPE_TRANSPARENT` enabled,
  `_ALPHAPREMULTIPLY_ON` disabled, `_BlendModePreserveSpecular = 0`,
  `_SrcBlend = 5`) matching runtime `StationGlass` and `StationVisibilityPalette`
  translucent clones; serializing `_ALPHAPREMULTIPLY_ON` causes Windows `.exe`
  and WebGL builds to strip the straight-alpha variant and fall back to opaque
  (`OutputAlpha` forces `alpha = 1`, pinned by `StationRenderTests`).
  `Resources/StationUnlitTransparentRef.mat` preserves transparent `URP/Unlit`,
  and `ProjectSettings/GraphicsSettings.asset` keeps `m_InstancingStripping: 2`
  (`Keep All`) so instanced drawers (`<= 1,023` instances/draw) render in built
  players.
- **GPU instancing, static batching & crowd culling invariants:**
  - **Escalator steps (`VerticalModuleViews`, `EscalatorStepInstancedDrawer`,
    `StationExplodedTrayBuilder`):** Zero per-step `MeshRenderer`s (`PlayMode`
    spawns anchor-only `tread-0`/`tread-last`; `EditMode` keeps anchor-only
    `tread-0..N`). Each band carries one zero-triangle proxy `MeshRenderer` so
    `StationVisibilityTarget` drives `Base`/`Ghost`/`Clear`/`Hidden`/section-clip
    (check `material.HasProperty("_SectionClip")` before reading stale
    `MaterialPropertyBlock` clip floats). `EscalatorStepInstancedDrawer` carries
    `[ExecuteAlways]` (skipping `LateUpdate` outside PlayMode), pauses during
    standalone Exploded View, frustum-culls band bounds, and pools step meshes;
    `StationExplodedTrayBuilder` reads `BandTreadMesh`/`BandRiserMesh` and
    `TryGetStepWorldPose` (`StationPerfEscalatorInstancingTests`).
  - **Multi-LOD prefab batching & openings (`StationPrefabBatch`,
    `StationModuleGroups`, `OpeningModuleViews`):** `StationPrefabMeshTemplate`
    combines readable same-material child meshes across Unity 6 multi-LOD tiers
    (`lodCount > 1`); `StationInstancedSurfaceDrawer` frustum-culls batches
    (`0.25 m` margin) and caches `enableInstancing`/`lodCount`;
    `StationEquipmentModuleRenderer` uses `EquipBatchThreshold = 3` (preserving
    2-bin `StationHighlightRetentionTests` individual views), `EquipChunkSize = 64`
    (preserving `StationPassengerAndBatchParityTests`), and compacts remaining
    singletons. `OpeningModuleViews` merges static opaque PSD boxes per
    `(run, colour)`, compacts `Gate`/`Door`/`Cubicle` static subtrees, and
    GPU-instances canonical `psd-end:cover` runs (`>= 128`/band, leaving Zoo's
    101/103 covers 1:1 for `OpeningModuleViewTests`) (`StationPerfStaticBatchingTests`).
  - **Crowd hot path (`PassengerCrowdView`):** Runs pure-managed 6-plane frustum
    culling before Transform/LOD/tone/clip work and suppresses offscreen meshes
    via `Skin.forceRenderingOff = true` — **never** `Skin.enabled = false`, which
    would trip `StationVisibilityTarget`'s permanent retirement check on floor
    switches. `GetSharedTonedMaterials` must not re-apply Ghost/Clear opacity when
    `sourceMats` already came from `StationVisibilityTarget`'s `GhostOf`/`ClearOf`
    materials. Tick pose alignment rotates reusable lists with O(N) two-pointer
    merging (zero per-tick dictionary copies) (`StationPerfCrowdHotPathTests`).
  - **Desktop pipeline guardrails:** Keep `GraphicsJobMode.Native` **off** on
    Win64 D3D12 (causes >500 ms sync stalls with `RenderMeshInstanced`/`Texture2D.Apply`),
    and note `glTF-pbrMetallicRoughness.shadergraph` ships with
    `m_DOTSInstancing: false` (so URP GPU Resident Drawer skips glTFast meshes).
