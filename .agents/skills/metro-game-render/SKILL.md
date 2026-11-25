---
name: metro-game-render
description: Three.js rendering layer in game/src/render/ — SceneRenderer, scene systems, procedural models, chunk meshing, snapping/picking, LODs, batching, PanelAtlas, signage, materials, and exploded view. Activate when editing 3D scene code, models, lighting, camera/cutaway, batching, LOD, or visual overlays.
---

# Game Renderer (`game/src/render/`)

The Three.js rendering layer visualizes the immutable station document (`StationData`)
and dynamic simulation buffers (`Float32Array` agent, train, and lift poses plus
`TrainService` forecasts).

## Architecture & Dependency Boundary

* **Layering** (enforced by `game/test/layering.test.mjs`): `render/` never imports
  `app/` and never mutates the station document or simulation state. Cross-layer imports
  target `sim/` (plus two facility-wall helpers `facilityWallCells` /
  `SHOP_WALL_H` imported from `build/model.ts` in `ChunkSystem.ts` and `RoomModel.ts`).
* **Coordinate system**: `+z` is up, `n = +y`, `e = +x`. Cells occupy
  `[x, x+1] × [y, y+1] × [z, z+1]` on a 1 m grid grouped into 5 m `STOREY_HEIGHT` bands
  shifted by `levelBase` (0–4 m).
* **Shared light rig** (`scene/lightRig.ts`): `applyStationRenderer` sets sRGB output,
  `NoToneMapping`, and `STATION_CLEAR = 0x0b0f16` (no shadow maps,
  `localClippingEnabled = true`). `addStationLights` installs one hemisphere light, two
  directional lights (key + fill), and an ambient light. Editor views, menu thumbnails,
  and capture passes share this rig.
* **No environment map**: ambient light feeds diffuse only, so high `metalness` renders
  dark. Painted surfaces (train bodies, painted door leaves) use `metalness: 0`;
  `steel`, `darkSteel`, and `trainBlue` are reserved for dark fittings and glazing.
* **Demand rendering & FSR 1.0**: `RenderDemand` (`renderDemand.ts`) retains the
  framebuffer while paused and idle until an edit, camera move, live atlas update, or
  animation invalidates it. `FsrUpscaler` (`scene/FsrUpscaler.ts`, `upscaling.ts`) runs
  spatial EASU + RCAS over a 4× MSAA render target for `ultra` (`1/1.3`), `quality`
  (`1/1.5`), `balanced` (`1/1.7`), and `performance` (`0.5`), bypassing targets in
  `native`.

## Scene Orchestrator & Systems

`render/scene.ts` is a compatibility barrel over `render/scene/SceneRenderer.ts`, which
owns the WebGLRenderer, shared `SceneContextData` (`scene/systems/SceneSystem.ts`),
frame loop, and 14 domain systems under `render/scene/systems/`:

| System | Responsibility |
| --- | --- |
| `ChunkSystem` | 16³ voxel meshing, four passes (`s` storey, `f` floating plates, `g` street ground, `c` ceilings), content-hashed mesh reuse, incremental local dirty-chunk edits, platform PSD insets. |
| `ModuleSystem` | Incrementally diffs/retains placed module roots via `moduleDependencies.ts` spatial index (`retainedModuleIds`, `canRetainPaintedModules`), owns incremental `EquipmentBatches`, `SurfaceBatches`, `SourceGeometryDetail`, contact blobs, and selection/hover/collider boxes. |
| `GhostSystem` | Add/remove block ghosts (auto-growing box pool), face paint quads, translucent equipment/fence previews (`EquipmentPreview`, `PreviewMaterialCache`), and road node handles. |
| `LevelSystem` | Storey slicing (`levelSlicing.ts`): active crisp, lower storeys 35% ghost, upper storeys hidden when active has built chunks, dense 20k-module neighbour bound, `hideWalls`/`hideGround`/`hideRoof`/`autoCeiling`, `hideUI`/`cutaway` straight opaque restore, Q/E view prewarm. |
| `SectionSystem` | Cutaway (`section.ts`): one scene-lifetime `THREE.Plane` shared by reference across materials, interactive highlight sheet/hatch/arrow, and `SurfaceObject` traversal (meshes, `LineSegments`, points). |
| `TrainSystem` | Interpolated consist poses (10-float stride), per-bank door easing, platform-aligned PSD opening, parked fleet cache (≤ 8 consists, idle-prepared via `trainPreparation.ts`), per-consist LOD swaps. |
| `LiftSystem` | Interpolated elevator cabins (7-float stride), aligned landing/cabin door easing, `liftPickMeshes`, and sim-clock escalator step-band rolling (`rollEscalator`). |
| `CrowdSystem` | Dual-topology instanced passengers (`agents` + `agentsLow`), screen-space picking, eye-view tracking, turnstile wings, swing doors, sink water, LOS/zone overlays, and floor route ribbon (`routeLine.ts`). |
| `RoadTrafficSystem` | Bounded instanced ambient road vehicles across 6 variants (High/Low + depth prepass) and animated road signal lenses driven by simulation time. |
| `PlateSystem` | Retains and repaints canvas textures for TV station boards (`tvPlates`), wayfinding signs (`signPlates`), calligraphy/line-map faces (`decorPlates`), cycling TV ad windows, and live rail signals. |
| `ClockSystem` | Sweeps analogue `ClockRig` hands and digital clock displays from interpolated simulation time (both placed clocks and active hover ghosts); snaps on seek jumps > 60 s. |
| `GridSystem` | Editing lattice translated vertically on Q/E (rebuilt only on horizontal bound changes) and cell cursor ring; hidden with `hideUI`. |
| `CameraSystem` | Perspective (`DEFAULT_FOV = 45°`, 30°–120°) and orthographic cameras, OrbitControls (middle orbit, wheel/pinch zoom, WASD + edge pan, `PAN_UP`/`PAN_DOWN` vertical pan), eye view, shared per-event raycasting. |
| `SkySystem` | Procedural 512² Z-up cloud `CubeTexture` active during `hideUI`, with a 05:00–07:00 dawn / 17:00–19:00 dusk intensity curve and matching horizon fog. |

## Picking, Snapping & Preview Isolation

* **One pick per pointer event**: `CameraSystem.withPointerPick` caches a single
  raycast per event across tool queries, traversing independent visible roots once with
  `BATCH_SOURCE_LAYER` (layer 31) temporarily enabled and rejecting hits with any
  invisible ancestor (`visibleThroughParents`). Instanced paving resolves
  `hit.instanceId` through `userData.surfaceModuleIds`.
* **Surface & grid snapping**: `pickCells` (`pickCell.ts`) samples the hit block 0.02 m
  inside the surface and snaps only the outward placement step via
  `faceAxis`/`faceStep`. `pickPlacement` prioritizes the nearest visible object surface
  over terrain behind it. `facingFrom` (`pickFacing.ts`) negates
  `Camera.getWorldDirection` to return the piece-to-eye vector;
  `SceneRenderer.onCameraAim` re-aims wall ghosts when orbiting without pointer motion.
* **Preview isolation**: Hover, drag, fence, roof, and move previews run solely in
  `GhostSystem` using `ModulePreviewDocument` and `modelNeighbours` overlays. Previews
  never mutate `StationData`, history, worker graphs, or live equipment batches (moving
  and adjacent fence roots mask only affected buckets via
  `EquipmentBatches.setHiddenModules`).

## Procedural Models, Meshing & Signage

* **Models** (`render/models.ts` → `models/PieceBuilder.ts` + `models/pieces/*`): Every
  piece builder is a self-contained file producing procedural geometry (trees load
  offline EZ-Tree ash JSONs from `assets/trees/`; passengers use baked pose/activity
  atlases from `assets/`). `buildModule` runs `preparePrimitiveModelDetail`,
  `compactEquipmentSheets`, `outdoorSurfaceLift`, and `hangerLiftFor`.
* **Chunk meshing**: `chunkMesher.ts` meshes sharp 1 m cubes, half-walls, corners,
  compound cuts, 45° wedges, platform PSD insets (`platformBlockInsets.ts`), and exact
  partitioned ramp undersides (`rampSurfaceMesh.ts`). `ceilingCells.ts` classifies
  explicit/inferred overhead slabs into chunk pass `c` without modifying document cells
  (blocks < 3 m above storey base stay floor geometry).
* **Contact shadows**: Floor-standing equipment only (`blobRadius` in `SceneSystem.ts`,
  excluding ceiling-hung, wall-mounted, flush decals, doorway exits, paving, roads, and
  `psd-end`), shown on the active storey only unless `hideUI` or `cutaway` is on.
* **Signage, displays & artwork**:
  * `adArt.ts` decodes `assets/posters/*.webp` before material creation and crops via
    `panelUv.ts`.
  * `pictograms.ts` decodes inline PNGs into `signFace.ts` (5 marks are vector-drawn);
    `calligraphyFace.ts` paints transparent station-name ink; `lineMapArt.ts` /
    `cityLineMapCache.ts` lazily decode city posters with `lineMapFace.ts` placeholder
    fallback.
  * `stationDisplay.ts` draws the 960×540 TV plate from `tvLineStatus` /
    `nearestTrainService`; `PsdHeader.ts` draws bilingual directional/terminal PSD
    plates; `modelLabels.ts` (`drawModelText`) fits all canvas ink without hardcoded
    English.
  * `artwork.ts` (`bindArtworkTexture`/`repaintArtwork`) updates PSD, exit, floor-mark,
    and guidepost textures in place during presentation-only edits
    (`updatePopulationData`).

## LOD Policy, Batching & Resource Retention

* **Unified detail policy** (`detailPolicy.ts`): `low` quality forces reduced geometry
  everywhere; `high` draws the active storey full and non-active storeys reduced;
  `hideUI` restores full visible geometry in High quality.
* **Three LOD tracks**: Equipment uses authored Low geometry (`modelDetail.ts`,
  `planarArtworkDetail.ts`, `SourceGeometryDetail`) plus `MeshoptSimplifier` fallback
  (`geometryDetail.ts`); trains swap pre-merged body, door-bank, and sorted-glass
  geometries (`trainDetail.ts`); crowds pack into dual prepared `InstancedMesh` draws
  (`agents` / `agentsLow`) over one shared pose atlas.
* **Batching & `PanelAtlas`**: `batchStaticModule`/`batchStaticParts` merge opaque
  siblings per module; `EquipmentBatches` batches across modules in 16 / 64 / 256 m
  spatial buckets with a 4-view cache (`EQUIPMENT_VIEW_CACHE_SIZE = 4`) while keeping
  original picking meshes on layer 31; `SurfaceBatches` instances paving in 64 m
  buckets; `PanelAtlas` packs full-resolution canvas panels onto 2048² pages with 2 px
  gutters, using CPU-backed `DataTexture` live pages (≤ 1 changed TV panel uploaded per
  frame via `copyTextureToTexture`).
* **Resource ownership**: `MaterialSet.retain(finishesInUse(data))` drops unused custom
  finish canvases; `ownedMats` / `previewOwnedMats` free builder-minted materials while
  `PlateSystem.ownsTexture` protects retained plates; `BatchedMesh.dispose()` owns its
  internal buffers, whereas `InstancedMesh` requires both `geometry.dispose()` and
  `mesh.dispose()`.

## Exploded Presentation & Spatial Audio

* **Standalone exploded view** (`explodedView.ts`, `explodedLayout.ts`,
  `explodedRamps.ts`, `explodedConnections.ts`, `explodedPassengers.ts`): Read-only
  disposable presentation (`setStandalonePresentation`). Bakes floor trays once with
  physical triangle clipping at 5 m planes and a separate front-wall bucket; translates
  tray `Group`s only; renders dashed guide lines; teleports cross-floor passengers by
  tray identity; never edits station state or worker data.
* **Spatial audio frames** (`audioScene.ts`): Pure Z-up distance/pan projection emitted
  from `SceneRenderer` at ≤ 10 Hz (1×) or ~30 Hz (accelerated) using ≤ 256 passenger
  samples, ≤ 64 rendered vehicles, and active live trains (parked consists stay silent).

## Verification Commands

```powershell
npm --prefix game run typecheck
npm --prefix game run build
npm run test:perf
npm run check:render-batching
npm run check:equipment-lod
npm run check:geometry-detail
npm run check:passenger-lod
node tools/check-panel-atlas.mjs
node tools/check-exploded-view.mjs
node tools/check-road-vehicles.mjs
node tools/check-geometry-snapping.mjs
```

## References & Sibling Skills

* [Render module map](references/render-module-map.md) — complete file-by-file ownership
  of `game/src/render/`.
* [Models, snapping & ramp surfaces](references/models-and-snapping.md) — procedural
  model contracts, geometry snapping anchors, exact ramp undersides, and signage/wall
  decor rules.
* [Batching, LODs & lifecycle](references/batching-and-lod.md) — detail policy,
  equipment/train/crowd/vehicle LODs, `EquipmentBatches`, `SurfaceBatches`,
  `PanelAtlas`, level slicing, exploded view, and GPU teardown.
* Sibling skills: [metro-game](../metro-game/SKILL.md) (app/build/saves/city styles),
  [metro-game-sim](../metro-game-sim/SKILL.md) (`sim/` data & rules),
  [metro-game-test](../metro-game-test/SKILL.md) (Node & browser tests),
  [metro-unity-assets](../metro-unity-assets/SKILL.md) (Unity GLB/finish asset parity),
  [metro-model](../metro-model/SKILL.md) (passenger bake pipeline), and
  [shared performance reference](../metro-repo/references/performance.md).
