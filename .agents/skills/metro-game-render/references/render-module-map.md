# `game/src/render/` Module Map

Complete file-by-file ownership map of the Three.js rendering layer under `game/src/render/`. See [SKILL.md](../SKILL.md) for architecture rules and cross-layer contracts.

## Scene Orchestration, Lighting, Upscaling & Audio

| File | Owns |
| --- | --- |
| `scene.ts` | Compatibility barrel re-exporting `SceneRenderer`, `PickResult`, `SceneStats`, `PAN_UP`, `PAN_DOWN`, `DEFAULT_FOV`, `FOV_MIN_DEG`, `FOV_MAX_DEG`. |
| `scene/SceneRenderer.ts` | Thin scene orchestrator: `WebGLRenderer`, `SceneContextData`, system wiring, incremental `setStation` / `updatePopulationData` paths, standalone exploded-view orchestration, async artwork/fleet preparation, demand-driven RAF loop, audio frame emission, and teardown. |
| `scene/lightRig.ts` | Canonical renderer and lighting settings (`STATION_CLEAR`, `applyStationRenderer`, `addStationLights`) shared by the live scene, menu thumbnails, and capture tools. |
| `scene/FsrUpscaler.ts` | FSR 1.0 spatial EASU + RCAS post-processing over a 4× MSAA render target (`native` bypasses targets). |
| `upscaling.ts` | `UpscalingMode` union (`native` / `ultra` / `quality` / `balanced` / `performance`) and `UPSCALING_SCALE` ratios. |
| `shaders/fsr-easu.glsl`, `fsr-rcas.glsl`, `LICENSE-web-fsr.txt` | GLSL3 fragment shaders and license for FSR 1.0 EASU/RCAS passes. |
| `renderDemand.ts` | `RenderDemand` dirty/camera-matrix check retaining the last framebuffer while paused and idle. |
| `audioScene.ts` | Pure Z-up spatial audio projection (`sourceMix`, `crowdSound`, bounded 256-sample crowd clustering). |

## Scene Systems (`scene/systems/`)

| File | Owns |
| --- | --- |
| `SceneSystem.ts` | `SceneSystem` base class, `SceneContext` / `SceneContextData`, `PickResult`, `SceneStats`, `GateWing`, `moduleLevels`, `blobRadius`, `PAN_UP`, `PAN_DOWN`. |
| `renderable.ts` | `SurfaceObject` (`Mesh \| Line \| Points`) and `isSurfaceObject` guard so slicing and clipping cover lines/points (e.g. court nets). |
| `ChunkSystem.ts` | 16³ chunk meshing across four passes (`s` storey, `f` float, `g` street ground, `c` ceilings), content-hash mesh caching, incremental column remeshing, wall-pick proxies, and coarse chunk detail swaps. |
| `ModuleSystem.ts` | Builds and retains placed module roots (`ModuleRenderGroup`), maintains O(1) `moduleRootsById` for live ancestor visibility checks (`isModuleVisible`), wires animated rigs to sibling systems, manages contact blobs, `EquipmentBatches`, `SurfaceBatches`, `SourceGeometryDetail`, moving-module masking, and selection/hover/collider boxes. |
| `GhostSystem.ts` | Drag add/remove ghosts (auto-growing box pool), cut-aware paint face quads, translucent module and live fence-drag previews (`EquipmentPreview`, `PreviewMaterialCache`), and road node handle pool. |
| `LevelSystem.ts` | Applies `levelSlicing.ts` rules across chunks, modules, and trains; manages 35% ghost (`dimOf`) and 16% wall (`clearOf`) material caches, `hideWalls`/`hideGround`/`hideRoof`/`autoCeiling`/`hideUI`/`cutaway`, and Q/E `prepareAdjacentViews`. |
| `SectionSystem.ts` | Cutaway GPU state: single shared `THREE.Plane`, translucent cut sheet/2 m hatch/handle/direction arrow, plane raypicking, and `applyClip` across chunks, modules, surfaces, `EquipmentBatches` canonical/atlas materials, crowd, and `LevelSystem`. |
| `TrainSystem.ts` | Live consist pose interpolation (10-float stride), per-bank door easing, platform-aligned PSD opening, parked fleet cache (`TRAIN_PARKED_LIMIT = 8`), idle `prepareForStation`, city badge repaints, and `trainDetails` LOD updates. |
| `LiftSystem.ts` | Elevator cabin interpolation (7-float stride), aligned landing/cabin door easing, `liftPickMeshes`, and sim-clock escalator rolling (`rollEscalator`) with drawable-part phase resync. |
| `CrowdSystem.ts` | Dual-topology instanced passengers (`agents`, `agentsLow`), ground blobs, screen-space `pickAgent`, eye-view callback, spatial-grid turnstile wings, swing doors, sink streams, LOS/zone overlays (`clearDensity`), and route ribbon. |
| `RoadTrafficSystem.ts` | Instanced ambient vehicles across 6 variants (High/Low + depth prepass), animated junction traffic-signal lenses, and 64-vehicle audio position capture. |
| `PlateSystem.ts` | Caches, retains, and repaints canvas textures for TV boards (cached TV coords/status keys with 1-panel/frame budgeted visible-first flushing), sign faces, calligraphy, line maps, cycling TV ad windows, and live rail-signal aspects (`ownsTexture` protects retained maps). |
| `ClockSystem.ts` | Drives analogue `ClockRig` hands and digital clock displays for placed clocks and hover previews from interpolated sim time with per-rig applied-state skipping. |
| `GridSystem.ts` | Editing lattice translated on Q/E (geometry rebuilt only on horizontal bound changes) and cell cursor ring. |
| `CameraSystem.ts` | Perspective and orthographic cameras, OrbitControls, wheel/pinch zoom, WASD + edge scrolling, vertical pan, eye view, and shared per-event `withPointerPick` raycasting. |
| `SkySystem.ts` | Procedural 512² Z-up cloud cubemap shown during `hideUI`, driven by `skyIntensity(simTime)` dawn/dusk curve and matching horizon fog. |

## Meshing, Slicing, Picking & Incremental Edit Retention

| File | Owns |
| --- | --- |
| `chunkMesher.ts` | Pure voxel chunk mesher (`CHUNK = 16`, `meshChunk`, `buildSolidSet`, `wedgeSlope`): sharp cubes, half-walls, corners, compound cut masks, 45° wedges, ramp slope cuts/fills, and per-finish parts. |
| `rampSurfaceMesh.ts` | Exact ramp underside partitioning (`rampSurfaceRegions`, `rampSurfaceHeight`) splitting polygons at footprint edges, clamps, and plane intersections before triangulation. |
| `ceilingCells.ts` | Render-only classification of explicit and inferred overhead slabs into chunk pass `c` (protects blocks < 3 m above storey base). |
| `platformBlockInsets.ts` | Computes track-side floor-block insets reserved for PSD concrete foundations (`PSD_WALL_OFFSET`, `PSD_BASE_DEPTH`). |
| `levelSlicing.ts` | Pure storey-slicing predicates (`levelSide`, `sliceOptions`, `levelVisible`, `boundedLevelVisible`, `storeyNear`, `unsupportedAbove`, `trainVisible`, `crowdVisible`, `contactShadowVisible`). |
| `section.ts` | Pure three-free cutaway math (`Section`, `QUARTER_TURNS`, `SECTION_SNAP`, `sectionNormal`/`Right`/`Up`, `planeConstant`, drag projection). |
| `pickCell.ts` | Pure hit-to-grid cell resolution (`pickCells`, `faceAxis`, `faceStep`) snapping outward placement steps to cardinal axes. |
| `pickFacing.ts` | `facingFrom(camera)` returning horizontal piece-to-eye vector by negating `Camera.getWorldDirection`. |
| `localCellEdit.ts` | Classifies bounded cell-only edits (≤ 256 changed cells, `z ≠ 0`, unchanged street window) for incremental chunk/cache updates. |
| `cellChanges.ts` | Order-preserving immutable cell-record diff (`changedCellRecords`), retaining duplicate authored records. |
| `retainPaintedModules.ts` | `canRetainPaintedModules` fast path keeping module groups and rigs on unrelated top-face floor paints (excluding stair starts). |
| `moduleDependencies.ts` | Declared model-input retention (`retainedModuleIds`, `isEquipmentContentEdit`, `isEquipmentModelEdit`, `isBridgeModelEdit`, `signBoardsOnlyChange`, `movedGuidepostIds`, `translatedWalkwayIds`, `sameModuleMetadata`). |
| `structuralModelInputs.ts` | Derived input snapshots for cell/neighbour-sensitive builders (ramps, tracks/gantries, bridge piers, hangers, ceiling heights, outdoor surfaces, roads). |
| `presentationEdit.ts` | `presentationKeepIds` and `signLineInk` separating station/line/city artwork repaints from structural rebuilds. |

## Batching, Instancing, LOD & Previews

| File | Owns |
| --- | --- |
| `batchGeometry.ts` | Winding-correct `bakedGeometry`, content-based `geometryKey` / `equalGeometry`, `attributeKey`, and `BATCH_SOURCE_LAYER = 31`. |
| `batchStaticModule.ts` | Per-module opaque sibling merging (`batchStaticModule`, `batchStaticParts`) preserving Low variants, protected rigs, and reflected winding. |
| `equipmentBatches.ts` | Cross-module `EquipmentBatches` (16/64/256 m spatial buckets, value-canonicalized untextured materials resolved from live surviving sources, instancing vs merging vs sorted transparent batches, 4-view LRU cache, `translateRoots`, `setHiddenModules`, idle retirement). |
| `materialCanonical.ts` | `isOpaqueCanonicalSurface` and `canonicalUntexturedMaterialKey` for value-based untextured material consolidation (opaque-only by default for unsorted callers like `ExplodedLayout`; sorted transparent opt-in for `EquipmentBatches`). |
| `sortedEquipmentGeometry.ts` | Single-draw indexed per-surface depth sorting for dense Low transparent equipment buckets. |
| `surfaceBatches.ts` | `SurfaceBatches` instanced outdoor paving layer (`sidewalk`/`lawn`, 64 m per-finish per-storey buckets, `ghostMaterial` slicing, `surfaceModuleIds` picking). |
| `staticInstances.ts` | `StaticInstances` subclass of `InstancedMesh` with conservative screen-pixel LOD hysteresis (up to 3 LODs) and whole-instance transparency sorting. |
| `trainBatches.ts` | `sortedBatch`, `batchTrainDoors` (`InstancedMesh`), `batchTrainTransparent` and `batchPlatformDoors` (`BatchedMesh`), and `syncTrainDoorBatches`. |
| `trainDetail.ts` | `trainDetails` and `trainDrawnTriangles`: prepared reference-only High/Low swaps for train bodies, door banks, and sorted glass (`TRAIN_DETAIL_MAX_RADIUS = 8`). |
| `trainDoorMotion.ts` | `TRAIN_DOOR_PLUG_PHASE = 0.18` and `trainDoorMotion` reversible plug-out then slide curve. |
| `trainPreparation.ts` | `trainPreparationPoses` and `trainPreparationFleet` generating bounded dormant consist plans (with a 2nd spare per appearance). |
| `detailPolicy.ts` | `GraphicsQuality`, `DENSE_STATION_MODULES = 20_000`, `isDenseStation`, and `detailHeight` policy. |
| `geometryDetail.ts` | `geometryDetailReady` (MeshoptSimplifier init), cached UV-weighted `coarseGeometry`, and `GeometryDetail` screen-pixel LOD controller. |
| `meshopt-simplifier.d.ts` | TypeScript declarations for `three/examples/jsm/libs/meshopt_simplifier.module.js`. |
| `modelDetail.ts` | Authored Low geometry helpers (`setModelDetail`, `omitModelDetail`, `boxModelDetail`, `panelModelDetail`, `beamModelDetail`, `surfaceModelDetail`, `tubeModelDetail`, `panelStripModelDetail`, `preparePrimitiveModelDetail`, `compactEquipmentSheets`, `modelDetailGeometry`). |
| `sourceGeometryDetail.ts` | `SourceGeometryDetail` swapping unbatched/moving equipment to Low geometry while delegating raycasts to full geometry and hiding zero-tri omissions on layer 31. |
| `planarArtworkDetail.ts` | Bakes coplanar vector artwork onto a 128 px/m Low canvas quad (`coherentModelDetail`) while keeping High vectors. |
| `equipmentPreview.ts` | `EquipmentPreview` giving carried/fence previews the same `EquipmentBatches`, `SourceGeometryDetail`, and distance/storey LOD policy as placed equipment. |
| `modulePreviewDocument.ts` | Reuses the prepared immutable station document for hover previews and caches one source-module removal during moves. |
| `modelNeighbours.ts` | Immutable per-array typed module index (`modelNeighbours`) and cell lookup (`modelCellAt`) with lightweight preview candidate overlays. |
| `moduleGhostKey.ts` | Pure prototype fingerprint (`moduleGhostKey`) avoiding redundant hover ghost rebuilds. |
| `previewMaterialCache.ts` | Bounded LRU `PreviewMaterialCache` keeping tinted preview shader variants alive across targets. |
| `roofPreview.ts` | `instanceRoofPreview` instancing repeated roof tiles in 16 m storey buckets during drag previews. |

## Signage, Artwork, Branding & Materials

| File | Owns |
| --- | --- |
| `materials.ts` | `createMaterials` (`MaterialSet`: procedural finish canvases, `owns`, `retain`, `dispose`, `finishesInUse`), `ghostMaterial` (35% ghost), `contactShadowTexture`, `seamlessTextureOffsets`, `obsidianPixelAt`. |
| `panelAtlas.ts` | `PanelAtlas` (2048² pages, 2 px gutters, material/clip-plane keying, CPU-backed live `DataTexture` pixel-diffed sub-uploads at ≤ 1 panel/frame, `retain` slot recycling) and `atlasUV`. |
| `panelUv.ts` | Pure aspect-preserving UV crop arithmetic (`panelUvWindow`, `croppedPlane`). |
| `artwork.ts` | In-place canvas repaint registry (`bindArtwork`, `bindArtworkTexture`, `prepareArtwork`, `repaintArtwork`). |
| `modelLabels.ts` | Shared `drawModelText` shrink-to-fit canvas text helper. |
| `adArt.ts` | Decodes `assets/posters/*.webp` up front into shared lit `AdFace` materials and aspect-cropped quads. |
| `pictograms.ts` | Decodes inline PNG sign pictograms from `assets/pictograms/*.png` into `signFace.ts`'s registry. |
| `signFace.ts` | Pure canvas renderer (`drawSignPanel`, `drawArrow`, `drawLineBadge`, `drawText`, `drawIcon`, pictogram registry) for hanging and wall wayfinding signs. |
| `stationDisplay.ts` | Pure TV board layout (`STATION_PLATE = 960×540`, `drawStationDisplay`) and 3D service selector (`nearestTrainService`, `tvLineStatus`). |
| `calligraphyFace.ts` | Pure transparent station-name inscription renderer (`drawCalligraphyPanel`, `calligraphyLayout`, `calligraphyPlate`). |
| `floorMarkArt.ts` | Pure canvas vinyl renderer (`drawFloorMark`) for `boarding`, `waiting`, and `direction` floor marks. |
| `lineMapArt.ts`, `lineMapCity.ts`, `cityLineMapCache.ts` | Lazy per-city poster loader (`assets/linemaps/*.{jpg,png}`), city slug/cache-key helpers, and shared request deduplication. |
| `lineMapFace.ts` | Pure procedural network-map placeholder board (`lineMapPlaceholderLayout`, `drawLineMapPlaceholder`, `lineMapPlaceholderPlate`). |
| `exitHeaderResolution.ts` | Per-city logical-to-pixel resolution multiplier (`4×` for Chengdu, Chongqing, Wuhan, Nanjing; capped at 4096 px). |
| `trainMarkAtlas.ts` | `trainMarkAtlasUV` selecting 3-slot UV regions on the shared nose-mark texture so city switches retain train geometry. |
| `cityBranding.ts`, `beijingTrainMark.ts`, `chengduBranding.ts`, `chongqingBranding.ts`, `chongqingTrainMark.ts`, `nanjingBranding.ts`, `wuhanBranding.ts` | Shared city emblem drawing (`drawMetroMark`), in-place cab/side texture refresh (`refreshCityTrainMark`, `refreshNanjingTrainMark`, `refreshChongqingTrainMark`), and city-specific vector logos/wordmarks. |

## Passengers & Exploded Presentation

| File | Owns |
| --- | --- |
| `passengerModel.ts` | Instanced soft-human `passengerMesh` (`full` / `low` topologies over shared pose atlas), `passengerAppearance`, handedness/action channel packing (`passengerDisplayedActivity`, `passengerActionMode`, `passengerActionChannel`). |
| `passengerAtlas.ts` | `decodePassengerBytes` (zlib/base64) and `restorePassengerFrames` (in-place frame-delta restoration). |
| `passengerActivities.ts` | Shared GPU bone-palette textures (`activityShader`, `passengerActivityOffset`, `PASSENGER_ACTIVITY_GARMENTS`, `disposePassengerActivities`). |
| `passengerEligibility.ts` | Age-pool eligibility predicate (`passengerEligible`) with explicit-false precedence. |
| `routeLine.ts` | Allocation-free 3D floor-ribbon geometry writer (`writeRouteRibbon`, `routeIndices`, `ROUTE_MAX_POINTS = 1024`). |
| `explodedView.ts` | Disposable presentation generator (`explodedView`, `isExplodedStructure`): underground infill core retention, room-plan extraction, concave/cardinal tray packing, and near-side front-wall classification. |
| `explodedLayout.ts` | `ExplodedLayout`, `clipFloorGeometry` (triangle-exact plane slicing), `splitFrontWalls` (voxel-owned front-wall bucket), opaque-only canonicalization/atlas/instanced merging with incremental deferred flushing and live `wallsVisible` initialization, tray selection/dragging, and pose offsetting. |
| `explodedRamps.ts` | `ExplodedRamps` cloning multi-storey stairs/escalators across trays with shared animated instance buffers and 5 m clip planes. |
| `explodedConnections.ts` | `ExplodedConnections` dynamic dashed light-blue guide segments joining matching vertical cut points across trays. |
| `explodedPassengers.ts` | `explodedPassengerSupport` and `filterExplodedPassengers` compacting presentation buffers without editing simulation agents. |

## Procedural Models (`models/`)

| File / Group | Owns |
| --- | --- |
| `models.ts` | `buildModule` dispatcher (with `preparePrimitiveModelDetail`, `compactEquipmentSheets`, `outdoorSurfaceLift`, `hangerLiftFor`) and compatibility barrel. |
| `models/PieceBuilder.ts` | `PieceBuilder` base, colour palette `C`, `ModelMaterials` kit (`createModelMaterials`, `disposeModelMaterials`), geometry/canvas helpers (`slab`, `finishSlab`, `plate`, `fenceTube`, `canvasTexture`, `litPanelMaterial`, `ownedMaterial`, `placeLocal`, `disposeObject`, `isSharedGeometry`). |
| `models/desktopScreen.ts` | Procedural desktop wallpaper/taskbar canvas for desk/counter monitors. |
| **Trains — shells & cabs**: `TrainModel.ts`, `CabModel.ts`, `StreamlinedCab.ts`, `CabFrontSurface.ts`, `CabRake.ts`, `CabSkin.ts`, `CarShellProfile.ts`, `TrainShell.ts`, `DTrainShell.ts`, `BTrainWindows.ts`, `CTrainWindows.ts`, `LTrainWindows.ts`, `NanjingTrainMark.ts` | Five rolling-stock classes (`A/B/C/D/L`), cabs, profiled shells, window bays, and Nanjing side emblems. |
| **Trains — hardware & Low**: `TrainInterior.ts`, `TrainBogie.ts`, `TrainSuspension.ts`, `TrainUnderframe.ts`, `TrainGangway.ts`, `TrainRoofAc.ts`, `TrainPantograph.ts`, `TrainWiper.ts`, `TrainDoorLow.ts`, `TrainStrapLow.ts`, `TrainWindowLow.ts` | Continuous cabin interiors, bogies/suspension/underframe, gangways, roof AC, pantographs, wipers, and Low proxies. |
| **Tracks, PSDs & bridges**: `TrackModel.ts`, `TrackDetails.ts`, `TrackGantry.ts`, `CatenaryModel.ts`, `BridgeEdgeConcrete.ts`, `BridgeNoiseBarrier.ts`, `BridgeRailing.ts`, `NoiseBarrierModel.ts`, `PsdModel.ts`, `PsdEndModel.ts`, `PsdHeader.ts`, `PsdHousing.ts`, `PsdDecals.ts`, `RailSignalModel.ts` | Rail beds/tunnels/bridges, third-rail/catenary/gantry hardware, bridge barriers/railings, ground noise barriers, full/half PSDs and ends, and animated 3-aspect rail signals. |
| **Vertical & horizontal transport**: `EscalatorModel.ts`, `EscalatorIndicatorModel.ts`, `WalkwayModel.ts`, `StairModel.ts`, `StairBlockModel.ts`, `RampJoinModel.ts`, `LiftModel.ts` | Rolling escalator/walkway bands (`buildRampBand`), newel indicators, 8 fixed stair shapes + stair blocks, stainless infill caps, and glass/steel lift shafts. |
| **Exits & city architecture**: `ExitModel.ts`, `ExitLanding.ts`, `DoorwayExitModel.ts`, `StreetDecorModel.ts`, `GuidepostGeometry.ts`, `{Beijing,Chengdu,Chongqing,Nanjing,Shanghai,Shenzhen,Wuhan}ExitCanopy.ts`, `{Beijing,Chengdu,Chongqing,Nanjing,Shanghai,Wuhan}ExitHeader.ts`, `{Beijing,Chengdu,Chongqing,Nanjing,Shanghai,Shenzhen,Wuhan}Guidepost.ts`, `NanjingRoofSign.ts` | Covered/uncovered head-houses on 0.25 m plinths, doorway exits, virtual exits/guideposts, bus stops, and city-specific canopies, headers, roof signs, and guideposts. |
| **Structure, enclosures & barriers**: `PillarModel.ts`, `RoofModel.ts`, `HangerModel.ts`, `FenceModel.ts`, `BlueSteelFence.ts`, `GlassModel.ts`, `DoorModel.ts`, `RoomModel.ts`, `BoothModel.ts`, `GateModel.ts` | Slim/thick pillars, flat/truss/shell/tapered/canopy roofs, hangers, connected glass/iron/blue-steel fences, wall glass & curtain walls, 1.99 m doors, walled facility rooms, closed-box booths, and turnstiles. |
| **Concourse, retail & restroom**: `TvmModel.ts`, `VendingModel.ts`, `BenchModel.ts`, `OfficeChair.ts`, `DeskModel.ts`, `ShelfModel.ts`, `DisplayShelves.ts`, `ShopShelves.ts`, `ShopStock.ts`, `WideBackbar.ts`, `CheckoutModel.ts`, `ShopCounter.ts`, `CubicleModel.ts`, `SinkModel.ts`, `UrinalModel.ts`, `RestroomFixtures.ts`, `BinModel.ts`, `ExtinguisherModel.ts`, `AcUnitModel.ts`, `ElectricalCabinetModel.ts`, `CourtModel.ts` | Ticketing/vending machines, seating, desks/chairs, 20-variant retail shelves + instanced stock + wide backbars, 1–4 m counters, ceramic restroom fixtures, bins, extinguishers, HVAC/electrical cabinets, and pickleball/badminton courts + dividers. |
| **Signage, ceiling & floor**: `SignModel.ts`, `TvModel.ts`, `BillboardModel.ts`, `CalligraphyModel.ts`, `LineMapModel.ts`, `MonitorModel.ts`, `ClockModel.ts`, `CctvModel.ts`, `LightModel.ts`, `VentModel.ts`, `TactileModel.ts`, `FloorMarkModel.ts` | Hanging/wall signs, single/back-to-back TVs, ad lightboxes, flat/pillar calligraphy, wall/totem line maps, CCTV monitors, analogue/digital clocks, cameras, lights, vents, tactile tiles, and floor vinyls. |
| **Street & road vehicles**: `OutdoorSurfaceModel.ts`, `TreeModel.ts`, `RoadModel.ts`, `RoadArrowMarking.ts`, `TrafficLightModel.ts`, `RoadVehicleModel.ts`, `vehicles/{VehicleKit,RoadCar,RoadBus,RoadCycle}.ts` | Raised paving tiles, 3-LOD ash trees, roads/markings/signals, and 6 grayscale road vehicle variants. |
