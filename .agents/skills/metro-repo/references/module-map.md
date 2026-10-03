# `game/src` module map

A file-by-file ownership map of the game. Keep the dependency rule in mind:
`app/ → render/ → sim/`, and `build/ → sim/` (build imports neither render nor
app). `sim/` imports nothing outside itself and never touches the DOM, three or
React.

## `sim/` — pure simulation

| File | Owns |
|---|---|
| `constants.ts` | Every tuning number, including the time base (`SIM_SECONDS_PER_TICK`, `BASE_TICK_MS`), speeds, LOS bands, gate/escalator/stair/lift/TVM rates, train stop choreography, agent cap, per-tick re-path budget. |
| `types.ts` | The data model: `Cell`, `Face`, `Zone`, `GateMode`, `Module` union, `RoomKind` (a walled room's `shop.cfg.kind`), `StairStyle`, `StairFlight`, `LineDef` + `LineDirection` (`up`/`down` and a `travelSign`), `StationData`, `SaveDoc`, `AgentState`, and `packKey`. |
| `rng.ts` | The single seeded RNG. All sim randomness goes through it, in fixed order. |
| `stock.ts` | Classifies rolling stock A/B/C and derives doors, capacity and line throughput. |
| `finishes.ts` | The finish table; family decides behaviour, finish decides look. `finishOf`, `floorSpeed`, `DEFAULT_FINISH`, `FINISH_LIST`. |
| `zones.ts` | Fare zones. `ZONE_LIST`, `ZONE_INDEX`, `crossingDir`, labels. A zone boundary is a movement barrier. |
| `gates.ts` | Gate policy predicates: `gateAllows`, `gateLaneAllows`, `nextGateIndex` (the two-way single-lane rule). |
| `station.ts` | `buildGraph` and `StationGraph`, servers (`ServerDef`), platforms, `PathFinder` (A* + path cache + per-tick budget), `needsClass`. |
| `placement.ts` | `ModuleBox`, `moduleEnvelope`, `boxesOverlap`, `placementBlocked`, `moduleAt`, `placementOnTrack`, `isTrackBed` / `trackBedKeys` / `isTrackCell` (a track bed is either the `floor.track` finish or a `track` module's footprint), `trackAt`, `reservedOpening` (a cell a hand-built block may not cover: a ramp's carved corridor or an exit's floor). |
| `track.ts` | Track orientation and footprint — the single source the builder, sim and renderer share: `normRot`, `rotateLocal`, `trackFacing`, `trackSide`, `trackDepth`, `trackCells`, `trackCellAt`, `trackCentre`, `trackOriginForCentre`, `edgeCells`. |
| `openings.ts` | `carveRampOpenings`, `rampEnvelope`, `rampBlocked`, `rampCorridorHalf`, `ESCALATOR_HEADROOM`, `escalatorBasesSolid`, `rampOpeningAt` (the block-brush guard, sharing the carve's ramp list). |
| `stairs.ts` | The four stair shapes, `STAIR_RUN`/`STAIR_RISE`, widths + `nextStairWidth`, `stairFlights`, `stairLandings`, level/turn helpers. |
| `escalators.ts` | `escalatorModule` (the one fixed one-storey piece), `ESCALATOR_RUN`/`RISE`, `nextEscalatorDir`. |
| `exits.ts` | Head-house geometry shared by sim and render: `EXIT_*` constants, `exitDoorCell`, `exitWallPlanes`, `exitFloorBounds`, `exitCoversCell`, `exitFloorAt`. |
| `agents.ts` | `AgentPool` / `Agent` — the crowd bodies. |
| `world.ts` | `World`, `tickOnce`, `Metrics`, trains, collision/separation pass, trip sampling, `trainRenderState`; `rebuild()` (an edit: rebuild the graph, keep the crowd) vs `load()` (a station switch: clear agents, trains, queues, clock and counters). |
| `protocol.ts` | The worker message types (`ToWorker` / `FromWorker`, `GraphInfo`). |
| `worker.ts` | The only sim file that touches `postMessage`; owns the `setInterval` tick loop. |

## `build/` — the station document and edit commands

| File | Owns |
|---|---|
| `model.ts` | `StationState`, `initialStation`, `toData`/`toState`/`cloneState`, `LEVEL_STEPS`/`nearestLevel`, `createModule`, `addEquipment`, cell add/remove, `removeModule`, module ids, face paint/erase/fill, zone paint + `zoneRegionLabels`, facilities (`placeFacility`, `facilityPlan`, `carveFacilityOpenings`, `removeFacility`), build floors + their automatic walls (`addFloor`, `removeFloor`, `syncAutoWalls`, `wallRun`, `addWalls`, `wallColumnAt`/`wallColumnsAt`, `plannedAutoWalls`, `AUTO_FLOOR`/`AUTO_WALL`/`AUTO_WALL_H`/`WALL`), and `labStation`. |
| `rail.ts` | Rail placement and derived screen doors: `RAIL_BED_DEPTH`, `TUNNEL_HEADROOM`, `TUNNEL_SHELL`, `railRect`, `defaultLine`, `isPlatformCell`, `trackPieceForLine`, `makeTrack`, `derivePlatformEdges`, `dropDerivedEdges`, `regenerateRailEdges`, `trackInterferenceBlocked` / `trackClearanceBlocked` / `trackFloorMissing` / `trackBlockReason` (eligibility: nothing may share the run's space; a platform needs solid floor and open headroom), `commitTrack`, `placeTrack` (a fixed piece), `placeRail` (the legacy axis-aligned rect), `resizeTrack`, `freeTunnelEnd` / `makeTunnel` / `placeTunnel` (auto-extend a rail off the free end nearest the hovered cell; bores the wall through and raises a shell, no platform doors), `stripTunnelShell`, `railModuleAt`, `railSummary`. Pure document edits. |

## `render/` — three.js

| File | Owns |
|---|---|
| `chunkMesher.ts` | `meshChunk`, `CHUNK`/`CORNER_R`/`BEVEL`, rounded-corner voxel geometry grouped into one part per finish. |
| `materials.ts` | The procedural material kit (`createMaterials`, `MaterialSet`, `contactShadowTexture`). |
| `models.ts` | Procedural module geometry: `buildModule`, `setGateWing`, `rollEscalator`, `buildTrain`, `setDoors`, `createModelMaterials`, `TrainPose`. No image or GLB assets. |
| `scene.ts` | `SceneRenderer`, `SceneStats`, `PickResult` — the plain three.js scene driven by the Viewport. |

## `persistence/`

| File | Owns |
|---|---|
| `save.ts` | The `metro-save` v1 envelope: `SAVE_FORMAT`, `SAVE_VERSION`, `GAME_VERSION`, `serialize`, `parse`, `ParseResult`. Static station + dynamic agent block. |

## `data/`

| File | Owns |
|---|---|
| `reference-station.ts` | `referenceStation` — the demo, built from the same equipment constructors the builder uses — and `emptyStation`. |
| `line-colours.ts` | `GUANGZHOU_LINE_COLOURS` + `lineColourFor` / `DEFAULT_LINE_COLOUR`: a new line is born wearing its real 广州地铁 sign colour. Reference data, not tuning. |

## `app/` — React shell (panels only, no sim logic)

| File | Owns |
|---|---|
| `store.ts` | zustand app state: the station document, active tool/brush/rotation/width/direction, view flags, metrics, and the worker plumbing (`initSim`, `rebuildSim`, `setFrameHandler`). Rail and line actions (`layTrack`, `layTunnel`, `rotateRail`, `cycleRailDir`, `setTunnelLength`, `regenRail`, `refreshRailDoors`, `removeRail`, `updateRail`, `updateLine`, `addLine`), `MODULE_OPTIONS`, `FACILITY_OPTIONS`, tool predicates. |
| `App.tsx` | Top bar, inspector (including the 线路 card), bottom metric bar, global keyboard shortcuts, the stage hint. |
| `LeftRail.tsx` | The blueprint build rail: folders for tools, equipment, 轨道 (the whole rail panel — the 站台 / 隧道 tools, R rotation, direction, bound line, tunnel-length slider, 重置屏蔽门), 房间 (rooms), surfaces, zones, view. |
| `Viewport.tsx` | Owns the `SceneRenderer` lifecycle and turns pointer input into build commands (the 建造 / 墙 / 删除 / equipment / paint / zone / 站台 / 隧道 tools). The only app file that touches three directly. |
| `ViewCube.tsx` | The orientation cube. |
| `Lab.tsx` | The `/lab` material/renderer lab. |
| `boot.tsx` | Lazily imported bootstrap that renders the app and starts the sim. |
| `mobile.ts` / `MobileNotice.tsx` | The phone/tablet gate and its notice; keeps three.js out of a mobile download. |
| `moduleThumbnails.ts` / `zoneThumbnails.ts` | Render the rail's thumbnails from the real models and zone colours. |

## Entry points outside `src/`

* `game/index.html`, `game/src/main.tsx` — page entry; `main.tsx` chooses the
  mobile notice or lazy-imports `boot.tsx`.
* `game/worker/index.js` — the game Worker's prefix-rewrite entry.

## `game/test/`

`node --test` suite importing `src/sim/*.ts` (and, for `rail` and `walls`,
`src/build/*.ts`) directly: `determinism`, `capacity`, `layering`, `surfaces`,
`save`, `load`, `zones`, `gates`, `trains`, `placement`, `openings`, `stairs`,
`escalators`, `exits`, `facility`, `rail`, `walls`. `layering.test.mjs` enforces
the dependency rule above.
