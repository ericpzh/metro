# Procedural Models, Snapping & Ramp Surfaces

Engineering contracts for `game/src/render/models/`, `game/src/render/chunkMesher.ts`,
`game/src/render/rampSurfaceMesh.ts`, and
`game/src/render/scene/systems/CameraSystem.ts`. See [SKILL.md](../SKILL.md) for system
orchestration and [batching-and-lod.md](batching-and-lod.md) for LOD/batching rules.

## PieceBuilder Kit & Ownership

* `models.ts` dispatches `buildModule(mod, ctx)` to `models/pieces/*Model.ts`, then runs:
  1. `preparePrimitiveModelDetail(model)` on eligible primitive box families (drops
     narrow edges on thin sheets, end caps on rods).
  2. `compactEquipmentSheets(model)` collapsing double-sided thin equipment sheets to
     one broad surface.
  3. `outdoorSurfaceLift(ctx.data.modules, mod)` (0.1 m lift over `sidewalk`/`lawn`) and
     `hangerLiftFor` (for `clock`, `cctv`, `tv`, `sign`).
* **Material & disposal rules**: Shared materials live in `ModelMaterials`
  (`models/PieceBuilder.ts`). Any piece-minted material registers via
  `ownedMaterial(ctx, mat)` (or `userData.ownedMats` on trains) so
  `ModuleSystem`/`GhostSystem`/`TrainSystem` disposes it with its group. `disposeObject`
  skips materials (`ModelMaterials` is shared) and shared geometries
  (`userData.sharedGeometry === true`), and calls `InstancedMesh.dispose()` in addition
  to geometry disposal.
* **No environment map**: Keep painted dielectric finishes at `metalness: 0`; reserve
  `steel`, `darkSteel`, and `trainBlue` for dark fittings and glazing.

## Rolling Stock (`TrainModel` & Helpers)

* **Five stock classes**: `A`, `B`, `C`, `L` use `CarShellProfile` + `CabModel`
  (`CabRake`, `CabSkin`, `CabFrontSurface`, `TrainShell`, `TrainWiper`) and class window
  bays (`BTrainWindows`, `CTrainWindows`, `LTrainWindows`); `D` uses `StreamlinedCab` +
  `DTrainShell`.
* **Five-metre profile scale**: Consists scale uniformly by `trainScaleForStorey()`
  (`0.98`); door cadence comes from `doorCentres` / `doorRunOffsets` (`sim/stock.ts`),
  matching PSD openings and platform floor vinyls.
* **Bogies & continuous floor** (`TrainBogie`, `TrainSuspension`, `TrainUnderframe`):
  All stocks use 0.8 m wheels (`BOGIE_WHEEL_RADIUS = 0.40`), 1.44 m wheelbase
  (`BOGIE_AXLE_HALF_SPAN = 0.72`), centred 0.25 m inward of outer passenger doors
  (`carBogieCentres`). All wheel/suspension hardware stays below door sills so the cabin
  floor stays flat with no raised housings.
* **Cabs & interiors** (`CabModel`, `TrainInterior`, `TrainRoofAc`, `TrainPantograph`,
  `TrainGangway`):
  * Both ends share one cab geometry (white headlights leading, red tail lamps
    trailing). `A/B/C/L` cabs carry a 10° front rake fading to zero at the rear body
    seam; passenger roofs/skirts derive from the cab rear cut in High and Low.
  * `A/B/L` carry upright crew doors moved forward to clear opening passenger leaves by
    > 10 cm; `A/B/L` share the small centred emblem with `C` (whose narrower evacuation
    door clears it). All classes carry surface-fitted wipers below the glass.
  * `CABIN_CEILING_Z` is 2.99 m with lining 5 cm below it (`buildTrainCeiling`),
    stopping at the cab seam. `openRoofUnderside` removes downward closure faces without
    changing exterior crown or collector wells.
* **Doors & city marks**: `trainDoorMotion` (`TRAIN_DOOR_PLUG_PHASE = 0.18`) drives
  reversible plug-out then slide travel, with independent left/right door banks
  (`setDoorsSides`). Shared nose marks live on a 3-slot UV atlas (`trainMarkAtlasUV`);
  Nanjing uses a separate side texture (`NanjingTrainMark`, `refreshNanjingTrainMark`);
  Chongqing uses per-consist line-numbered badges (`chongqingTrainMark.ts`) keyed from
  pose flags.

## Equipment, Structural & Street Models

* **Escalators, walkways & stairs** (`EscalatorModel`, `EscalatorIndicatorModel`,
  `WalkwayModel`, `StairModel`, `StairBlockModel`, `RampJoinModel`):
  * `WalkwayModel` reuses `EscalatorModel`'s `buildRampBand` at zero rise (no carve, no
    ramp-join infill). Escalator steps level via `escalatorStepHeight` with collapsing
    risers on flat ends (`rollEscalator`) and newel entry/stop lights
    (`EscalatorIndicatorModel`).
  * `RampJoinModel` builds stainless infill caps owned by one escalator for flush
    adjacent escalators/stairs and for parallel escalators separated by one empty block
    (unless another run or obstacle crosses the sloped gap).
  * Straight and turning stairs share `stairTreadWidth` (0.79 / 1.79 / 2.79 m for
    1 / 2 / 3 blocks) and `stairFlightSlides` with carving and routing; walls running a
    flight's full length drop its handrail/posts (`stairWallSides`, `stairLandingWalls`)
    while keeping stringers. Treads/risers/landings use `stair.cfg.finish` or the
    starting floor finish. Runs landing inside a covered exit lift by `EXIT_BASE_HEIGHT`
    (`0.25 m`, `ExitLanding.ts`).
  * `StairBlockModel` builds 4 treads (or 2 for 0.5 m half-rise) in the block's floor
    finish, omitting internal faces in Low.
* **Lifts** (`LiftModel`): Glass (default) or steel full-height shaft matching stacked
  `cfg.rises`, closed by caps only at total shaft ends, with independent moving
  `userData.liftCabin` and served-floor `userData.liftLandings` (no doors at floorless
  stops). Shaft meshes register in `liftPickMeshes`.
* **PSDs & bridges** (`PsdModel`, `PsdHeader`, `PsdHousing`, `PsdDecals`, `PsdEndModel`,
  `TrackModel`, `TrackGantry`, `Bridge*`, `NoiseBarrierModel`):
  * Full-height PSDs stand `PSD_FULL_HEIGHT = 3 m`: 2.35 m glazing, 0.6 m top
    information plate, 0.05 m cap (no top padding); half-height PSDs stand
    `PSD_HALF_HEIGHT = 1.45 m` with route/station glass stickers. Both share
    `PSD_WALL_OFFSET = 0.34 m`, `PSD_BASE_DEPTH = 0.18 m`, `platformBlockInsets`,
    and recessed `0.04 m` moving-leaf frame depth (`0.05 m` / `0.06 m` half-height
    leaf rail/cap, keeping track-side frames at `-0.05 m` from the track boundary
    so Type A open plug doors clear single and dual platforms).
  * `PsdHeader.ts` prints bilingual platform-facing (`FrontSide`) route/station panels
    (`1024×256`): terminal status matches station name against the platform's own
    direction (`upTerminus` for `up`, `downTerminus` for `down`), hiding the
    next-destination arrow at terminals and drawing a schematic line with no invented
    stops at mid-line stations.
  * `finishPsdHousing` strips buried coplanar faces on intersecting opaque PSD boxes.
  * Bridge noise barriers/railings (`BridgeNoiseBarrier`, `BridgeRailing`,
    `BridgeEdgeConcrete`), ground `NoiseBarrierModel`, and `TrackGantry` share
    `PSD_WALL_OFFSET` / `trackSideFixtureOffset` alignment and clear neighbouring gantry
    posts across seams.
* **Courts, fences & barriers** (`CourtModel`, `FenceModel`, `BlueSteelFence`):
  * `CourtModel` renders 14 × 7 m pickleball/badminton courts with an open
    `THREE.LineSegments` net (`SurfaceObject` so slicing and section clipping include
    it) plus 2 m portable dividers (`variant: 'divider'`).
  * `FenceModel` builds continuous L/T/+ joints from `fenceArms` (`sim/fences.ts`),
    connecting to gate machine sides and stair/escalator landings (never `stair-block`).
    `BlueSteelFence` draws the 2 m construction variant (solid kick panel + diagonal
    wire mesh omitted in Low).
* **Restrooms, retail, booths & fixtures**:
  * `UrinalModel`: wall-hung ceramic shell (local `+y` faces room) with recessed bowl
    (`SHELL_RINGS`, 64×3 subdivisions High → 12 segments Low), standalone and
    cell-independent. `CubicleModel` and `SinkModel` share `RestroomFixtures`
    ceramic/turned helpers; swing doors and sink water streams remain independent rigs
    outside equipment batching.
  * `ShelfModel` / `DisplayShelves` / `ShopShelves` / `ShopStock`: 20 shelf variants
    with `InstancedMesh` merchandise (`stockBatch`, omitted in Low); `WideBackbar`
    builds continuous 2 m / 4 m café prep cabinets rather than tiled 1 m units.
    `CheckoutModel` / `ShopCounter` build 1–4 m counters. `OfficeChair.ts` is shared by
    `DeskModel` and `BenchModel` (`office-1`).
  * `BoothModel` builds a closed box inward from outer edges with corner mullions
    (`ticket`) or a single-shell white counter with a sloped accessible front dip
    (`info`). Monitors use `sim/booths.ts` (`boothScreenPositions`) to seat flush on
    solid flat counter spans without overhanging edges, glazing, or `info` dip
    shoulders; `info` overhead canopies hang via 4 corner steel suspension rods and
    ceiling plates only when all 4 corners find a ceiling within `3 m` above the
    header (`boothHeaderHang`), and are omitted otherwise (`boothModelInputs` in
    `structuralModelInputs.ts` + `moduleDependencies.ts` invalidate affected `info`
    booths on cell/roof/opening edits). `DoorModel` builds 1.99 m single/double
    steel/wood/glass doorways reused by `RoomModel` and snapped into 4 m `GlassModel`
    curtain walls (leaving the lower doorway section unglazed).
  * `ClockModel` builds double-sided geometry dials (no numerals; back dial rotated π
    around world Z) with `ClockRig` pivots; `RailSignalModel` stands 1 m tall on a
    `floor.concrete` plinth/post with mutable Y/G/R aspects (top-to-bottom `+z` to `-z`,
    red/green driven by nearest service in `PlateSystem`); `MonitorModel` builds 1 m
    ceiling-hung and 3 m 12-screen wall cabinets.
* **Exits & city variants** (`ExitModel`, `DoorwayExitModel`, `StreetDecorModel`, city
  canopies/headers/guideposts): Covered/uncovered 1–3 bay head-houses on 0.25 m plinths,
  wall-mounted 1–4 bay doorways (fixed font size with bay-width spacing), and 1×1 × 4 m
  virtual exits sharing `GuidepostModel`. `exitHeaderResolution` applies 4× logical
  print scale for Chengdu, Chongqing, Wuhan, and Nanjing.
* **Outdoor surfaces, trees & street roads**:
  * `OutdoorSurfaceModel`: 0.1 m raised vertex-coloured `sidewalk`/`lawn` geometries
    shared across `SurfaceBatches` and previews, masked over openings via
    `outdoorSurfaceHidden`.
  * `TreeModel`: offline-baked EZ-Tree ash (`assets/trees/street-ash{,-lod,-far}.json`),
    two shared meshes (`tree-trunk`, `tree-crown`) marked `staticInstances` with 3
    screen-pixel LOD tiers.
  * `RoadModel`: asphalt plane, overlap-clipped white/yellow ink (`roadInkIntervals`),
    directional lane arrows (`RoadArrowMarking`), and junction zebra crossings/signals.
    `RoadVehicleModel` + `vehicles/{VehicleKit,RoadCar,RoadBus,RoadCycle}` generate 6
    grayscale variants (`suv`, `sedan`, `bus-orange`, `bus-mosaic`, `moped`, `bicycle`)
    at 70% High / 45% Low opacity with a merged depth-only prepass (`colorWrite: false`,
    `depthWrite: true`, `renderOrder: -1`).

## Geometry Snapping Anchors & Picking

Placement and moving follow actual visible geometry, never a nominal storey band or
`levelBase`. Changing `levelBase` without changing geometry leaves snap results
identical.

| Target Category | Anchor / Support Source |
| --- | --- |
| Floor equipment, tiles, walls, rails, roads | Picked surface cell/deck, exact surface height, or empty-space work plane (`pickPlacement` prioritizes nearest visible object over terrain behind it). |
| Wall posters, signs, monitors, maps, lettering | Pointed wall course via `wallDecorAnchorZ` (short signs < 1 m vertically centred in course; other panels bottom-aligned; `calligraphy` uses integer anchors + authored ink inset; vertical `calligraphy` wraps thick round pillars via `calligraphyOnPillar`). |
| Wall glass | Pointed wall course (`wallMountFollowsCourse`); lone slab edges keep slab height. |
| Ceiling props | Nearest exposed slab or rail-deck underside above the aimed column (including unexcavated street); `ceilingAnchored` is inferred solely from actual support above. |
| Hanger-mounted props & hanger suspension | Hit hanger beam translates to its attachment anchor; hanger endpoints seek nearest real block/roof backing overhead. |
| Pillar / lift extension targeting | Actual shaft overlap with pointed air cell; `CameraSystem` enables layer 31 so upper batched shafts remain pickable. |
| Doors, booth signs, exits, ramp bays, PSD ends/covers, floor marks | Host curtain, booth header, backing block, landing, screen door, or rail geometry in its own rotation/dimensions (`pickModuleInBounds` / `pickRoofModuleNear` provide gap-forgiving fallbacks occluded by nearer blocks). |

* **Grid-safe picking**: `pickCells(point, normal)` reads the hit cell 0.02 m inside the
  surface and snaps only the outward placement normal via `faceAxis`/`faceStep` so
  wedges and sloped ramp cuts never emit fractional coordinates.
* **Camera-driven facing**: `facingFrom(camera)` negates `Camera.getWorldDirection`
  (piece → eye). `SceneRenderer.onCameraAim` emits when horizontal aim shifts by
  `> 1e-3` so wall-mounted hover/move ghosts re-aim on orbit.

## Exact Ramp Undersides, Chunk Meshing & Ceilings

* **Sharp blockwork** (`chunkMesher.ts`): 1 m cube profiles with zero bevel/rounding;
  exposed sides cull only against covering neighbours (`coversSide`). Supports
  half-walls, quarter-cell corners, compound cut masks (`cuts`), 45° upper/lower wedges
  (`wedgeSlope`), and PSD track-side `platformBlockInsets`.
* **Exact ramp underside surfaces** (`rampSurfaceMesh.ts`): `rampSurfaceRegions` splits
  every slope-cut cell at all `SlopeCut.patches` footprint bounds, `[0, 1]` clamps,
  `SlopeCut.base` clamps (outer lower landing only — interior stair landings never
  flatten ground beside them), and plane-to-plane intersections before triangulation so
  no triangle chords across bends or gaps. Unoccupied cells under a truss standing on
  solid ground (`slopeFills` / `rampFillKeys`) mesh seamlessly up to the soffit.
* **Render-only ceiling classification** (`ceilingCells.ts`): Routes explicit
  `suspended-ceiling` / `opening-ceiling` plates and inferred single-course overhead
  slabs (over a solid floor with clear air between and an orthogonal neighbour) into
  `ChunkSystem` pass `c`, toggled by `autoCeiling` (`隐藏天花板`). Blocks < 3 m above
  their storey floor base remain floor geometry (protecting raised platforms), and
  untagged linings directly beneath an upper plain floor course stay in their own storey
  slice.

## Wall Decor, Signage & Artwork Pipelines

* **Text fitting**: Every canvas decal uses `drawModelText` (`modelLabels.ts`) with
  localized `t('printed_*')` keys—never hardcoded English or stretched fonts.
* **Posters & line maps**: `adArt.ts` eagerly globs `assets/posters/*.webp` (never
  `assets/ads/`, which ad-blockers reject), decodes all images before building
  materials, and applies aspect-preserving centred crops via `panelUv.ts`.
  `lineMapArt.ts` + `cityLineMapCache.ts` lazily decode `assets/linemaps/*.{jpg,png}`
  per requested city while drawing `lineMapFace.ts` placeholders until ready.
* **Signs, calligraphy & TVs**: `pictograms.ts` decodes inline PNGs into `signFace.ts`
  (5 marks are vector-drawn); `calligraphyFace.ts` uses deterministic FNV-1a glyph
  offsets over a transparent background; `stationDisplay.ts` renders the 960×540 TV
  plate (`tvLineStatus`, `nearestTrainService`) while `TvModel` supports single-sided
  and 180° back-to-back pairs (`TV_HALF_DEPTH`, `FrontSide` poster materials).
