# `game/src/sim/` Module Map

File-by-file ownership inventory for every file in `game/src/sim/`. All modules are pure
TypeScript with zero external dependencies and zero DOM/Three/React imports (enforced by
`game/test/layering.test.mjs`). Only `worker.ts` calls `postMessage`.

## Core World, Agents, Protocol, and Worker

| File | Owns |
|---|---|
| `constants.ts` | Global tuning constants: time base, 5 m `STOREY_HEIGHT` / `LEVEL_STEPS` / `storeyBand`, speeds, capacities, `LOS_BANDS` / `losOf`, train stop phases, PSD/track/catenary datums, gate/crowd/reroute budgets, road traffic settings. |
| `types.ts` | Station schema and pure helpers: `Cell`, `Face`, `Zone`, `GateMode`/`GateDoor`, `CellShape` (`half`/`corner`/`cuts`/`triangle`), `Module` union, `LineDef`, `StationData`, `SaveDoc`, `AgentState`, `AgentRenderState`, `Trip`, `packKey`. |
| `rng.ts` | Deterministic 32-bit mulberry32 PRNG (`Rng`) and `hashString`; sole journey randomness source. |
| `agents.ts` | `Agent`, `Needs`, and `AgentPool` with free-list recycling and `compact()` clearing stale `byId` entries. |
| `world.ts` | Barrel re-exporting `world/types.ts` and `world/World.ts` for stable `sim/world.ts` imports. |
| `world/types.ts` | Shared simulation vocabulary: `TrainState`, `Train`, `TrainAt`, `Metrics`, `LineAnchor`, `DynamicSnapshot`. |
| `world/World.ts` | `World` class: `tickOnce`, `load`/`restart`/`rebuild`/`seek`, train dispatch & cabin boarding/alighting, lift car state machine, servers, collision separation, sparse/legacy routing, route preview (`routeOf`), metrics. |
| `protocol.ts` | Worker message union (`ToWorker`, `FromWorker`, `GraphInfo`, `RoutingDiagnostic`, `RoutingFault`). |
| `worker.ts` | Web Worker wrapper: `postMessage` loop, `dirty` paused suppression, `BUILD_COALESCE_MS` coalescing, cosmetic/population/splice fast paths, history streaming, optional WASM attach. |
| `wasmRouting.ts` | Pure adapter (`WasmRouting`, `WasmRouter`) marshalling CSR buffers, congestion, and server/gate waits into the WASM A* kernel. |
| `workerWasm.ts` | Dynamic loader (`loadWasmRouting`) for the `wasm-experiment` WASM bundle and fault injection hooks. |

## Walking Graph, Sparse Routing, and Passenger Behaviour

| File | Owns |
|---|---|
| `station.ts` | `buildGraph`, `StationGraph`, `ServerDef`, `LiftCar`, `PlatformEdge`, `EDGE_KIND`, `PathFinder` (legacy A* + LRU cache + `MAX_REPATH_PER_TICK`), `queueWait`, `liftPenalty`, `congestionCost`, `gateApproach`. |
| `sparseConstants.ts` | Sparse-routing tunables: 16×16 sectors, 16-step walk horizon, 4-step refill threshold, density/claim/turn/jitter costs, 16 MiB field cache cap, mandatory/refill/optional budgets. |
| `sparsePolicy.ts` | Deterministic integer-ms routing policy (`RoutingMode`, `toMs`, `packTileKey`/`packSectorKey`, Murmur3 `hash32*`, `octantOf`, `scoreTileMs`, `StandingOccupancy`, `SoftClaimTable`). |
| `sparseGraph.ts` | `SparseTopology` & `buildSparseTopology`: 16×16 sector/region components, contiguous `SparseCrossing` runs, `SparseExplicitArc` service/directed edges, lazy exact `canReach`, concourse samples, sector diffing. |
| `sparseRouter.ts` | `SparseRouter`: `CostSnapshot`, LRU reverse distance fields, shared `ReverseCoarseTree` reverse Dijkstra trees, `tryCachedCoarseSearch`, resumable coarse/fine recovery jobs, rolling 16-step `refillWalker`, 3-pass `routeTick`, edit-retaining `onCommit`. |
| `crowdRouting.ts` | Legacy-mode local walking-corridor congestion avoidance (`crowdedWalkEnd`, `spreadWalkRoute`). |
| `walking.ts` | Identity-hashed passenger physique (`passengerIsChild`, `passengerProportions`), gait (`passengerWalkProfile`), and `passengerWalkSpeed` (independent of `Rng`). |
| `walkingSpace.ts` | Corridor lane spreading (`walkingLaneNode`), segment legality (`clearWalkSegment`), and connected platform wait spots (`platformWaitingNodes`). |
| `rampCollision.ts` | Continuous swept body clearance (`rampMoveClear`) against storey-scoped `RampWall` segments. |
| `gateTraffic.ts` | `GateTraffic` per-direction queue + `GATE_FORECAST_SECONDS` approaching-wave reservation and opposing-lane drain forecasting (capped at 600 s). |
| `activities.ts` | 15 activity kinds (`ACTIVITY_NAMES`), durations, rail-reach targets, timelines, and exact Float32 `packActivity`/`unpackActivity` (4-bit kind + 8-bit heading + 12-bit timeline). |
| `activityStops.ts` | `ActivityStop` and `activityStopPlaces` mapping TVMs, vending, shelves, benches, cubicles, and sinks to approach coordinates, yaws, and dwell durations. |

## Rolling Stock, Tracks, Headways, and PSDs

| File | Owns |
|---|---|
| `stock.ts` | `STOCK_CLASSES` (`A/B/C/D/L`), `STOCK` specs, capacities, authoritative `doorCentres`/`doorWidthAt`/`doorRunOffsets`, cabin queues (`cabinSlot`), `trainScaleForStorey`/`trainOriginForScale`/`trainContactWireZ`. |
| `track.ts` | Track orientation & footprint (`normRot`, `rotateLocal`, `trackFacing`/`trackSide`/`trackDepth`/`trackCells`/`trackCentre`/`edgeCells`), `trackHeadroom`, `TRACK_RUN_LENGTHS`, `trackSideFixtureOffset`, `trackTrainCentreV`, `thirdRailSide`, `trackCeilingUnderside`. |
| `headway.ts` | `FORMATION_OPTIONS` (`2/3/4/6/8`), headway clamping (`60..1200 s`) & split/join, `trainsPerHour`/`servedPerHour`, `serviceTrackCount`, `trainAlightPerHourAt`/`trainAlightSeries`, `repairLineRunning`. |
| `trainSchedule.ts` | Pure arrival forecast (`TrainService`, `serviceArrivals`) deriving next three countdowns and live `trainState` from active phases and headways. |
| `trainFlags.ts` | `trainFlags` packing door-side mask (bits 0–1), catenary flag (bit 2), and 1-based line index (bits 3+) into the 10th train pose float. |
| `psdEnds.ts` | Fixed PSD infill/corner panels and stacked cover courses (`psdEndOffset`, `psdEndSpan`, `snapPsdEnd`, `isPsdEndJoin`, `isPsdCornerPair`, `snapPsdEndCover`, `isPsdEndCoverSupport`). |

## Vertical Circulation, Gates, Fences, and Exits

| File | Owns |
|---|---|
| `rampLengths.ts` | Contiguous `single` (2–6 m), `double` (7–11 m), and `triple` (12–16 m) rise families shared by escalators and stairs (`rampSpanOf`, `rampLengthSpec`, `rampLengthOf`). |
| `stairs.ts` | Straight, 90°/180° turning, and forward stairs; block-grid tread widths (`stairTreadWidth`, `stairBuildWidth`), `stairFlightSlides`, `stairFlightsFor`, `stairTurnCells`/`stairTurnConnectors`, wall-hugging rail suppression (`stairWallSides`, `stairLandingWalls`). |
| `escalators.ts` | Escalator geometry & factories (`escalatorModule`, widths 1/2/3, 30° `escalatorInclineRun`/`escalatorLengthSpec`, `escalatorRun`, `escalatorLandings`, `escalatorStepHeight`). |
| `walkways.ts` | Level step-free moving walkways (`walkwayModule`, 30/60/90 m `WALKWAY_LENGTHS`, `walkwayLandings`, `walkwayCoveredCells` excluded from walk nodes). |
| `lifts.ts` | Elevator shaft specs (`liftModule`, 2×2 small / 3×3 large, mixed `LIFT_INTERVALS` 3–7 m in `cfg.rises`, `liftStops`/`liftLevels`, per-level `front`/`back`/`both`/`none` doors, `liftLandingRows`/`liftLandingCells`). |
| `gates.ts` | Gate policy predicates (`gateAllows`, `gateLaneAllows`, `nextGateIndex`) and lane/fence piece geometry (`gateDoorOf`, `gateHasLane`, `gateMachineSide`, `gateSolidFaces`). |
| `fences.ts` | Fence joint geometry (`fenceArms`), ramp/walkway landing joins (`railLandingAt`), and cached `fenceConnectionIndex`. |
| `exits.ts` | Head-house geometry (`EXIT_*`, 1–4 `exitBays` → 3–6 m width, `exitDoorCell`, `exitWallPlanes`, `exitFloorBounds`, `exitFootprintCells`, `exitRunOpenings`, `exitRunSnap`), `exitDoorwayOffset`, `isExitHeadHouse`. |
| `exitLanding.ts` | Render-only `EXIT_BASE_HEIGHT` (`0.25 m`) plinth offset (`exitLandingHeight`) shared by cuts and ramp builders. |

## Street Plane, Roads, and Ambient Traffic

| File | Owns |
|---|---|
| `ground.ts` | Inverted street plane at `GROUND_Z = 0`: `groundWindow`, `groundHoleAt`/`groundHoleReader`, `virtualSolidAt`, `solidAt`, `withGround`, `resizeGround`/`primeGroundResize`, `PAINTED_GROUND`. |
| `roads.ts` | Road layout (`roadLayout`, `roadPoint`, `roadFromDrag`), overlap ink clipping (`roadInkIntervals`), `roadHash`, pedestrian blockers (`roadContainsPoint`, `roadMoveClear`), `roadsOnlyChange`. |
| `roadDocument.ts` | Authored orthogonal node/segment graph (`getRoadDocument`, `roadEndpoints`, `roadBetween`, `roadSnap`, `roadSegmentAt`) with shared square node caps and virtual splits. |
| `roadLaneMovements.ts` | Per-lane junction turn permissions (`roadLaneMovements`, `roadTurn`, `roadDriverLaneOrder`) shared by lane topology and painted arrows. |
| `roadNetwork.ts` | Cached directed lane graph (`getRoadNetwork`), collinear coalescing, crossing/T connectors, uncontrolled width merges, lane-scaled `roadSignal`, `roadJunctionSides`, `roadEdgeMovements`, `roadEdgePoint`. |
| `roadTraffic.ts` | Fixed-step (`0.1 s`) `RoadTraffic` simulation, exclusive junction reservation locks + rear-clearance tails, capacity-metered boundary spawns, and approach seed spacing. |
| `roadPlacement.ts` | Cached `roadSurfaceReason` validating floor/street support, clearance (`dz = 1..4`), and track conflicts per road footprint. |
| `outdoorSurfaces.ts` | Cached `outdoorSurfaceIndex` (`isOutdoorSurface`, `surfaceKey`) for `sidewalk` and `lawn` tiles alongside road/glass references. |

## Zones, Finishes, Opening Cuts, Placement, and Edit Classification

| File | Owns |
|---|---|
| `zones.ts` | Fare zones (`ZONE_LIST`, `ZONE_PAINT_LIST` with `store`/`toilet`/`office` room tints), `zoneOf`, `zoneIndexOf`, `zoneDisplayIndexOf`, `isPaidZone`/`isUnpaidZone`, `crossingDir`. |
| `finishes.ts` | Material table (`FINISH_LIST`, `DEFAULT_MATERIAL`, `RAMP_SOFFIT_FINISH`), `finishPaletteGroups` (`stone`/`metal`/`wood`/`other`), `finishDef`/`finishOf`/`floorSpeed`/`finishesForFace`. |
| `contactFinishes.ts` | `contactFaceCovered` and `clearContactFinishes` stripping wholly covered solid face finishes while retaining partial contacts, slopes, and suspended ceilings. |
| `openings.ts` | Ramp slab carving (`carveRampOpenings`), per-tile `rampBodyBoxes`, `rampSlopeCuts`, `rampThinCells`/`thinWallCells`, `rampOpeningAt`/`rampOpeningsInWindow`, `rampFillKeys`, `escalatorBasesSolid`. |
| `rampSurface.ts` | Exact vertical underside drops (`RAMP_FOOT = 0.5`, `STAIR_BODY_DROP = 0.36`, `ESCALATOR_TRUSS_DEPTH = 0.34`), `escalatorTrussOffset`, polygon-clipped `rampSurfaceRetainsVolume`. |
| `openingCeilings.ts` | `OPENING_CEILING` tag and `clearSupportedOpeningCeilings` clearing ceiling classification when solid support returns below. |
| `placement.ts` | Single-verdict placement & move rules: `blockReason`, `equipmentReason`, `trackBlockReason`, `moduleEnvelope`/`collisionBoxes`/`placementColliders`, wall/ceiling/track-deck aiming & validation, `moduleAt`/`pillarAt`, `isMovableModule`/`movedModule`/`moveCandidate`/`moveDropReason`. |
| `blockIndex.ts` | Document-cached `BlockIndex` (per-level occupancy, track keys, per-level openings, virtual ground, memoized `BlockCheck`s). |
| `solidCellIndex.ts` | Document-cached 16×16×1 spatial bucket index (`firstAuthoredCell`, `hasAuthoredSolid`, `solidCellsInBounds`). |
| `documentCaches.ts` | Registry (`registerDocumentCache`, `forgetDocumentCaches`) releasing station-sized `WeakMap` indexes when undo history retires a document. |
| `cosmeticEdit.ts` | Fail-closed `isCosmeticStationEdit` detecting appearance-only cell finish and inert decor edits that skip graph rebuilds. |
| `decorInert.ts` | `isSimInertDecorModule` / `isSimInertDecorEdit` classifying decor modules (including roof-mounted `hanger` and `tree`) that never alter routing or street bounds. |
| `populationEdit.ts` | `populationEdit` / `applyPopulationEdit` / `hasPresentationEdit` for non-structural line, exit, headway, day-setting, and label/city edits. |
| `stationEdit.ts` | Bounded array-splice diff (`stationEdit`, `applyStationEdit`, `MAX_EDIT_RECORDS = 4096`) for incremental `build-edit` worker updates. |
| `lineSpacing.ts` | Seven-rung line-placement gap ladder (`LINE_SPACINGS` 0–6 blocks, `lineSpacing`, `nextLineSpacing`, `spacingActiveBoxes`). |
| `lineDeletion.ts` | `isLineDeletable` whitelisting loose decor/equipment/pillars/courts for right-drag line sweep while excluding structures, rooms, rails, exits, and surfaces. |

## Structures, Fixtures, Decor, Signage, and City Identity

| File | Owns |
|---|---|
| `structures.ts` | Pillars (`PILLAR_LENGTHS` 2–6 m, 9-spot slim offsets, `extendedPillar`), roofs (`ROOF_WIDTHS` 4/8/12 m, truss/canopy heights & `canopyPostCells`), and bridge deck/barrier/pier rules (`BRIDGE_DECK_DEPTH`, `pillarSupportsBridge`). |
| `inCellPositions.ts` | Shared 9-spot in-cell offset cycle (centre then 3×3 reading order) for slim pillars and rectangular ceiling lights. |
| `courses.ts` | Half-open `wallCourses(bottom, height)` mapping wall panel vertical spans to crossed 1 m wall courses. |
| `hangers.ts` | Roof-suspended and floor-post steel hanging bars (`HANGER_LENGTHS` 4/6/8 m, `hangerCells`, `hangerPostCells`, `hangerBoxes`, `hangerRoofZ`/`hangerRoofMissing`, `hangerSupports`, `hangerLiftFor`). |
| `floorDecor.ts` | Floor equipment & stickers (`court`, `ac-unit`, `electrical-cabinet`, `tactile`, `floor-mark`): specs, bounds, `tactileArms`, screen-aligned `snapBoardingMark` / `realignSavedFloorMarks`. |
| `benches.ts` | `BENCH_SPECS` (1 m / 2 m plain and backed variants) shared by builder, collision, activity stops, and renderer. |
| `counters.ts` | `COUNTER_SPECS` (`checkout`/`generic`/`cafe`/`cafe-pastry`), 1–4 m lengths (`COUNTER_LENGTHS`), and `counterCells`. |
| `booths.ts` | Booth monitor layout (`boothScreenPositions`, flush counter-seated spans clearing `info` accessible dips, glazing, and edges) and `info` overhead canopy ceiling-hang checks (`BOOTH_HEADER_BOTTOM`, `BOOTH_HEADER_TOP`, `BOOTH_HEADER_MAX_HANG = 3`, `boothSuspensionCorners`, `boothCeilingZ`, `boothHeaderHang`). |
| `shelves.ts` | `SHELF_SPECS` (store/cooler/clothing/bakery/fruit/cafe/book/bag variants), `shelfWidth`, and `shelfCells`. |
| `extinguishers.ts` | `EXTINGUISHER_SPECS` (`standard`/`compact`/`glass`, 1–2 cells) and `extinguisherCells`. |
| `doors.ts` | Free-standing & room `DOOR_SPECS` (single/double × steel/wood/glass, 1.99 m height) and shared `DOOR_FRAME` hardware metrics. |
| `glassPanels.ts` | Wall-mounted glass panels and floor-edge curtain walls (`GLASS_SPECS`, `glassWallCourses`, `GLASS_FRAME`). |
| `noiseBarriers.ts` | Fence-based acoustic barrier and bridge railing variants (`sound-barrier`, `sound-barrier-half`, `bridge-railing`), offset, and heights. |
| `lights.ts` | Ceiling light specs (circular / 9-position rectangular batten) and ceiling mount height. |
| `vents.ts` | Ceiling vent grille dimensions (`VENT_WIDTH`, `VENT_DEPTH`) and `ventCeilingZ`. |
| `monitors.ts` | Wall-mounted monitor footprint (`monitorCells`). |
| `tvs.ts` | Ceiling-hung TV width (`TV_MODEL_WIDTH`), facing, and back-to-back 180° shared-cell pairing (`tvBackToBack`, `tvPairSlot`). |
| `billboards.ts` | Wall lightbox formats (`BILLBOARD_SPECS`) and poster selection (`AD_POSTERS`, `postersFor`, `posterFor`, `panelPosters`). |
| `posterCatalogue.ts` | Generated poster metadata table (`POSTER_CATALOGUE`) mapping campaign slugs to aspect/format metadata. |
| `linemaps.ts` | Wall-mounted and standing totem network-map specs (`LINE_MAP_SPECS`, `isStandingLineMap`, `lineMapWallCourses`). |
| `sign.ts` | Pure wayfinding sign document model: `SignMount` (`ceiling`/`wall`), `SIGN_ICONS`, board sizing/packing (`settleSignLayout`, `packSignRow`, `signMarkFits`), block stamps, normalization, `signWallCourses`. |
| `boothSigns.ts` | Booth-header wall-sign snapping and fit validation (`snapSignToBooth`, `boothHoldsSign`, `boothSignFits`, `boothSupportsSign`). |
| `calligraphy.ts` | Station-name calligraphy styles, horizontal/vertical sizing (`calligraphyGeometry`, `calligraphyPanelCells`, `calligraphyPanelSize`), and wall/pillar mount math. |
| `calligraphyFonts.ts` | Approved font-face manifest (`CALLIGRAPHY_FONT_MANIFEST`) and CSS shorthand helpers shared by canvas painters. |
| `cityStyles.ts` | Eight city identities (`guangzhou`, `shenzhen`, `shanghai`, `beijing`, `chengdu`, `chongqing`, `wuhan`, `nanjing`), normalization, brand keys, and default line-colour palettes. |

## Clock, Demand, History, Global Stats, and i18n

| File | Owns |
|---|---|
| `clock.ts` | Civil calendar (`DEFAULT_CALENDAR`, `SimCalendar`), derived `dayTypeOf` (`workday`/`offday`), `stampAt`, `monthGrid`, `simTimeAtDate`, `clockHandAngles`, and `normalizeService`/`normalizePeaks`/`normalizeCalendar`. |
| `demand.ts` | Double-peak time-of-day curve (`demandShape`, `demandAt`, `demandRate`, `demandSeries`), separate `workday`/`offday` `DayDemand` curves, `PERIOD_FACTOR`, `normalizeDemand`/`normalizeDayDemand`. |
| `history.ts` | Minute-grained run telemetry (`History`, `HISTORY_COLUMNS`/`HISTORY_STRIDE`, `SAMPLE_SECONDS = 60`, baseline first sample, incremental `run(from)` slices, `historySeries`). |
| `globalStats.ts` | Pure telemetry aggregation (`statsBaseline`, `statsDelta`, `stationCounts`, `makeStatsSubmission`) handling backwards-tick resets and idempotent deltas. |
| `i18n.ts` | Pure bilingual copy API (`msg` canonical Chinese, `t` active locale, `tForLanguage` explicit locale, `translate` presentation lookup, `languageForPath`). |
| `i18n/messages.ts` | Master Simplified Chinese / English (`zh` / `en`) catalogue dictionary for UI, notices, finishes, zones, stock, and built-in signage. |
