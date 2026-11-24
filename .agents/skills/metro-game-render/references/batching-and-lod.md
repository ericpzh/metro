# Batching, LODs, Level Slicing & GPU Lifecycle

Engineering contracts for geometry detail, batching, instancing, `PanelAtlas`, storey
slicing, exploded view, and GPU resource retention/disposal in `game/src/render/`. See
[SKILL.md](../SKILL.md) for architecture overview and
[the shared performance reference](../../metro-repo/references/performance.md) for
measured baselines and triangle budgets.

## Geometry Detail Policy

`detailPolicy.ts` defines the single view-detail contract shared by chunks, equipment,
trains, crowds, and previews:

| Setting / View | Active Storey | Non-Active (Ghosted) Storeys | Dense Station (`≥ 20,000` modules) |
| --- | --- | --- | --- |
| `graphicsQuality: 'high'` (normal edit) | Full (`detailHeight = viewportHeight`) | Reduced (`detailHeight = 0`) | Ghosts only adjacent storeys (`storeyNear`) |
| `graphicsQuality: 'high'` + `hideUI` | Full (`Infinity`) | Full (`Infinity`) | Draws every storey opaque & full |
| `graphicsQuality: 'low'` (normal or `hideUI`) | Reduced (`0`) | Reduced (`0`) | Ghosts only adjacent storeys in edit; 256 m equipment tiles |

* **Screen-pixel hysteresis** (`geometryDetail.ts`): `GeometryDetail` switches to Low
  when conservative projected pixel size drops below `EQUIPMENT_DETAIL_PX` (`24 px`),
  returning to High above `24 × STATIC_DETAIL_HYSTERESIS` (`1.2`). `StaticInstances`
  uses `OUTDOOR_TILE_DETAIL_PX = 10` for paving and `OUTDOOR_TREE_DETAIL_PX = 45` /
  `OUTDOOR_TREE_FAR_PX = 18` for 3-LOD trees.
* **Meshopt fallback** (`geometryDetail.ts`): `coarseGeometry` runs `MeshoptSimplifier`
  (UV-weighted when `uv` exists) for static meshes with `≥ 64` triangles
  (`EQUIPMENT_DETAIL_MIN_TRIANGLES`), targeting `25%` (`EQUIPMENT_DETAIL_RATIO`) with
  `2%` error (`EQUIPMENT_DETAIL_ERROR`), cached per source `BufferGeometry` and
  auto-disposed on source `dispose`. If WASM init fails, full geometry is retained.

## Equipment, Train, Crowd & Vehicle LODs

* **Authored equipment Low** (`modelDetail.ts`, `planarArtworkDetail.ts`):
  * Piece builders attach Low geometry via `setModelDetail(mesh, geo)` (unions
    source/replacement bounding boxes & spheres; full source owns disposal via `dispose`
    event), `omitModelDetail` (0-triangle replacement keeping exact source picking),
    `boxModelDetail`, `panelModelDetail`, `beamModelDetail`, `surfaceModelDetail`,
    `tubeModelDetail`, and `panelStripModelDetail`.
  * `planarArtworkDetail` bakes coplanar vector artwork onto a 128 px/m canvas quad for
    Low and marks both source and print `userData.coherentModelDetail = true` so
    composite parts switch together on explicit Low/view reductions rather than
    splitting across distance thresholds.
  * `SourceGeometryDetail` swaps unbatched/moving equipment meshes in place while
    wrapping `mesh.raycast` to test full geometry and moving 0-triangle omissions to
    `BATCH_SOURCE_LAYER` (layer 31). `ModuleSystem` calls `sourceDetail.restore()`
    before batching or disposal.
  * `EquipmentPreview` applies identical `EquipmentBatches`, `SourceGeometryDetail`, and
    distance/storey rules to hover, carried, fence, and instanced roof
    (`instanceRoofPreview`) previews.
  * Equipment triangle budgets live in `tools/equipment-low-budgets.mjs` (strict
    `< 10%` of High unless an explicit minimum-shape exception applies) and are
    validated by `npm run check:equipment-lod`.
* **Train LODs & batching** (`batchStaticModule.ts`, `trainBatches.ts`,
  `trainDetail.ts`, `trainPreparation.ts`):
  * `batchStaticParts(group, doors, reflections)` merges opaque siblings per material,
    baking reflections with corrected winding (`bakedGeometry`) and merging authored Low
    variants alongside High.
  * `batchTrainDoors` instances identical opaque door parts into `InstancedMesh`
    (`trainDoorDetail` holds `{ near, far }`); `batchTrainTransparent` and
    `batchPlatformDoors` pack transparent panes/straps/PSD leaves into depth-sorted
    `BatchedMesh` (`trainGlassDetail` holds `{ nearIds, farIds }`).
    `syncTrainDoorBatches` updates only when door poses change.
  * `trainDetails` prepares reference-only High/Low swaps; untagged loose parts use
    `coarseGeometry` only when `boundingSphere.radius ≤ TRAIN_DETAIL_MAX_RADIUS`
    (`8 m`). Door/glass swaps restore exact sources before disposal.
  * `trainPreparationFleet` prebuilds up to `TRAIN_PARKED_LIMIT = 8` dormant consists
    (allocating a 2nd spare per appearance where room permits) via `requestIdleCallback`
    after opening paint. In dense Low mode with `KHR_parallel_shader_compile`,
    `SceneRenderer.drawFrame` compiles newly visible train shaders asynchronously via
    `compileAsync` before showing them.
* **Passenger LODs** (`passengerModel.ts`, `passengerAtlas.ts`,
  `passengerActivities.ts`, `CrowdSystem.ts`):
  * Dual `InstancedMesh` draws (`agents` full, `agentsLow` reduced) share one baked pose
    atlas (`lowIndices`/`lowCorners`) and one set of GPU bone-palette textures
    (`passenger-activities.json`), decoded from lossless zlib/frame-delta buffers
    (`passengerAtlas.ts`).
  * Both LODs draw opaque (`opacity: 1`, `transparent: false`, `depthWrite: true`) at
    `trainScaleForStorey()` (`0.98`) visual scale. Every instance records its storey in
    `passengerLevel` and packs into `drawFull` or `drawLow` per `crowdDetail(level)`—one
    draw for a single storey, two only when a ghosted storey is visible.
  * `CrowdSystem` packs only visible storey/frustum instances, uploads active prefixes,
    and skips outfit/colour uploads when slot identities are unchanged.
* **Road vehicle LODs** (`RoadTrafficSystem.ts`, `RoadVehicleModel.ts`,
  `VehicleKit.ts`):
  * Prebuilds `high` (70% opacity) and `low` (45% opacity, ≤ 25% of High triangles)
    `InstancedMesh` bins per variant, each preceded by a merged depth-only prepass
    (`colorWrite: false`, `depthWrite: true`, `renderOrder: -1`).

## Cross-Module Batching & Instancing

* **Per-module batching** (`batchStaticModule.ts`): Collapses same-material opaque
  static siblings inside `STATIC_TYPES` while preserving module roots, nested groups,
  transparent meshes, tagged/shared/mutable meshes, and animated rigs.
* **Cross-module `EquipmentBatches`** (`equipmentBatches.ts`, `materialCanonical.ts`):
  * Spatial bucket size: `16 m` (High), `64 m` (Low), `256 m` (dense Low).
  * Excludes moving/mutable subtrees: `signalAspect`, `doors`, `clockRig` pivots,
    `wing`, `liftCabin`, `activityWater`, cycling `adScreen` windows, and `explodedRamp`
    roots.
  * Value-canonicalizes equivalent untextured static materials (`canonicalUntexturedMaterialKey`,
    resolving each rebuilt bucket's material from its live surviving sources—single owner
    uses its own or live atlas material, multi-owner buckets use a batch-owned canonical
    material with synchronized clipping planes in `SectionSystem.applyClip` and disposal on
    `clear()`; normal-blended non-wireframe transparent buckets opt in because they route
    through per-surface depth-sorted draws).
  * Chooses the cheapest draw per bucket: `StaticInstances` (trees), `InstancedMesh`
    (identical positive-determinant geometries without atlas regions, matching High and
    Low), `sortedEquipmentGeometry` (single indexed depth-sorted draw for dense Low
    transparent buckets), `BatchedMesh` with cached camera-order sorting
    (`cacheBatchOrder`) for other transparent buckets, or merged `Mesh` for opaque
    buckets.
  * Moves batched source meshes to `BATCH_SOURCE_LAYER` (layer 31) and sets
    `matrixAutoUpdate = false`; `withHiddenSources` temporarily hides fully batched
    roots during normal camera draws while preserving layer-31 raycasting.
  * **4-view cache & incremental edits**: Retains up to `EQUIPMENT_VIEW_CACHE_SIZE = 4`
    storey views under the same generation key (invalidated by root/transform/toggle/
    clip changes). Incremental edits remove only changed roots' bucket contributions; a
    bucket shrinking to 1 non-coarse source hands its survivor back to layer 0.
    `translateRoots` shifts exclusively owned flat-walkway buckets without re-baking
    buffers.
  * **Preview masking**: `setHiddenModules` masks only local buckets containing a
    carried/adjacent-fence root (restoring their siblings to layer 0) without rebuilding
    GPU allocations. Retired entries drop lazily via `requestIdleCallback`.
* **Outdoor paving (`SurfaceBatches`)**: Draws visible `sidewalk`/`lawn` tiles directly
  in 64 m per-finish per-storey `StaticInstances` buckets (unchanged buckets reuse GPU
  buffers). Tile roots carry no mesh, equipment source, or contact blob; ghosted storeys
  use `ghostMaterial`, and picking maps `hit.instanceId` via
  `userData.surfaceModuleIds`.

## `PanelAtlas` & Live Canvas Panels

* **Page layout** (`panelAtlas.ts`): Packs eligible `MeshBasicMaterial` +
  `CanvasTexture` panels at full pixel resolution into `2048×2048` pages with extruded
  2 px gutters, linear filtering, and no mipmaps. Panels with repeating/offset UVs,
  custom shaders, or size `> 2044 px` keep standalone maps.
* **Material keying**: Includes every render state plus clipping-plane object identity
  (`planeIds` `WeakMap`), because distinct `THREE.Plane` instances can move
  independently.
* **Live TV pages**: Sources tagged `userData.livePanel = true` allocate separate
  CPU-backed `DataTexture` pages. On `atlas.update(renderer)`, `copyLivePixels` computes
  the changed bounding rectangle and uploads at most **one** panel per frame via
  `renderer.copyTextureToTexture` (retaining complete CPU pixels for context restore and
  invalidating `RenderDemand` until `pendingUpdates` drains).
* **Slot recycling**: `retain(liveTextures)` returns freed rects to the page free list
  and increments `mappingVersion`. Because freed rects never relocate live slots and
  reused rects carry new map/material UUIDs, `EquipmentBatches` clears dormant storey
  views on `mappingVersion` change without re-baking unaffected live buckets.

## Level Slicing, Cutaway & Exploded View

* **Storey slicing** (`levelSlicing.ts`, `LevelSystem.ts`): `sliceOptions` maps `hideUI`
  or `cutaway` to straight opaque rendering (`{ ghost: true, autoCeiling: false,
  hideAbove: false }`), restoring base materials (`baseOf`) rather than toggling
  visibility alone. Normal editing ghosts lower storeys at 35% (`dimOf`,
  `depthWrite: false`), hides upper storeys when the active storey has built non-ground
  chunks (`hideAbove`), fades walls/PSDs to 16% (`clearOf`) or hides them completely
  during cutaway, and hides street ground (`hideGround`), roofs (`hideRoof`), or pass
  `c` ceilings (`autoCeiling`) via visibility flags.
* **Q/E view prewarm**: `SceneRenderer.prepareBuildViews` calls
  `LevelSystem.prepareAdjacentViews` using `levelSteps(levelBase)` (active ± 5 m) and
  renders into a disposable 1×1 `WebGLRenderTarget` to warm GPU buffers/programs, plus
  compiles the selection box shader onscreen. `GridSystem.buildGrid` translates the
  retained grid group vertically without reallocating vertices.
* **Section clipping** (`section.ts`, `SectionSystem.ts`): One scene-lifetime
  `THREE.Plane` written in place (sliding updates only `normal` and `constant`).
  `applyClip` traverses chunks, outlines, crowd, surfaces, modules (all
  `SurfaceObject`s including `LineSegments`), and `LevelSystem.setClip`, skipping
  retained roots when plane and `levelKey` agree.
* **Exploded presentation** (`explodedView.ts`, `explodedLayout.ts`,
  `explodedRamps.ts`, `explodedConnections.ts`, `explodedPassengers.ts`):
  `setStandalonePresentation` disables `EquipmentBatches` and enables tray-keyed
  `teleportBetweenStoreys`. `ExplodedLayout` physically clips triangles once at 5 m
  planes (`clipFloorGeometry`), splits near-side walls by voxel ownership
  (`splitFrontWalls`), consolidates cross-stage **opaque** untextured materials,
  opaque `PanelAtlas` faces, and identical-content opaque `InstancedMesh`es (preserving
  independent draw boundaries for transparent surfaces), initializes deferred wall meshes
  from `wallsVisible[owner]`, flushes deferred equipment in 6 ms steps
  (`flushPendingStep`), and translates tray `Group`s only. `ExplodedRamps` clones
  multi-storey ramps across trays while sharing animated instance buffers/LODs and
  restoring `userData.base` on disposal. `ExplodedConnections` reuses dynamic buffers
  for dashed guides (excluded from picking).

## Retention & GPU Disposal Rules

* **Incremental edit fast paths** (`SceneRenderer.setStation` / `updatePopulationData`):
  1. `updatePopulationData` (line names/colours/termini, headways, exits, city style):
     repaints retained PSD/exit/guidepost/train/plate textures in place (`artwork.ts`,
     `PlateSystem`, `TrainSystem.repaintPresentation`), rebuilding only roots whose
     shell/resolution changed (e.g. city exit canopies/guideposts).
  2. `signBoardsOnlyChanged`: skips chunk remeshing and rebuilds/repaints only the
     edited sign.
  3. `equipmentOnlyChanged` / `isBridgeModelEdit`: skips chunk meshing;
     `retainedModuleIds` (`moduleDependencies.ts`), `movedGuidepostIds`, and
     `translatedWalkwayIds` keep unchanged roots and rigs.
  4. `canRetainPaintedModules`: top-face floor paints (excluding stair starts) remesh
     affected chunks while retaining all module groups and batches.
  5. Both sign-only and equipment-only fast paths clear `ctx.levelKey` so the trailing
     `applyLevel` / `syncBatches` updates batches and visibility.
* **Disposal checklist**:
  * `MaterialSet.retain(finishesInUse(data))` frees unused custom paint canvases;
    `dispose()` frees all cached finish materials/textures and outline/blob/tactile
    materials.
  * `PlateSystem` protects its retained canvases with `ownsTexture`; `ModuleSystem` and
    `GhostSystem` never dispose textures owned by `PlateSystem`, `AdArt`, or
    `LineMapArt`.
  * `BatchedMesh.dispose()` owns its internal geometry and matrix/indirection
    textures—call `dispose()` once, never separately dispose its `geometry`.
  * `InstancedMesh` requires both `mesh.geometry.dispose()` (if not shared) and
    `mesh.dispose()` to release `instanceMatrix` / `instanceColor`.
  * `StaticInstances.dispose()` disposes its cloned `detailed`, `coarse`, and `minimal`
    geometries plus `super.dispose()`.
  * `SceneRenderer.dispose()` sets `ctx.disposed = true`, cancels `raf`, removes
    `webglcontextrestored`, tears down exploded views before source modules, and
    disposes every system, material kit, artwork cache, upscaler, and renderer.
