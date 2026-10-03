# `game/src` module map

A file-by-file ownership map of the game. Keep the dependency rule in mind:
`app/ → render/ → sim/`, and `build/ → sim/` (build imports neither render nor
app). `sim/` imports nothing outside itself and never touches the DOM, three or
React.

## `sim/` — pure simulation

| File | Owns |
|---|---|
| `constants.ts` | Every tuning number, including the time base (`SIM_SECONDS_PER_TICK`, `BASE_TICK_MS`), speeds, LOS bands, gate/escalator/stair/lift/TVM rates, train stop choreography, agent cap, per-tick re-path budget, and the fixed storey grid `LEVEL_STEPS` + `storeyBand` (the renderer keys every cell to the grid line at or below it). |
| `types.ts` | The data model: `Cell`, `Face`, `Zone`, `GateMode`, `Module` union, `RoomKind` (a walled room's `shop.cfg.kind`), `BillboardVariant`/`BillboardAspect`, `StairStyle`, `StairFlight`, `LineDef` + `LineDirection` (`up`/`down`, a `travelSign`, and per-direction `upTerminus` / `downTerminus`), `StationData`, `SaveDoc`, `AgentState`, and `packKey`. The `Module` union includes the 装饰 pieces (`bench` / `shelf` / `desk` / `cubicle` / `sink`, each with `cfg.auto`) and the wall-mounted pair (`billboard` with `cfg.variant`, `tv`), plus `fence` and the `lift` shaft (`from`/`to` ends). |
| `rng.ts` | The single seeded RNG. All sim randomness goes through it, in fixed order. |
| `stock.ts` | Classifies rolling stock A/B/C and derives doors, capacity and line throughput. |
| `finishes.ts` | The finish table; family decides behaviour, finish decides look. `finishOf`, `floorSpeed`, `DEFAULT_FINISH`, `FINISH_LIST`. |
| `zones.ts` | Fare zones. `ZONE_LIST`, `ZONE_INDEX`, `crossingDir`, labels. A zone boundary is a movement barrier. |
| `gates.ts` | Gate policy predicates: `gateAllows`, `gateLaneAllows`, `nextGateIndex` (the two-way single-lane rule). |
| `station.ts` | `buildGraph` and `StationGraph`, servers (`ServerDef`), platforms, `PathFinder` (A* + path cache + per-tick budget), `needsClass`. A `lift` module becomes one `ServerDef` carrying a `LiftCar`: every walkable floor in the column is a stop and every ordered pair is an edge. |
| `placement.ts` | `ModuleBox`, `moduleEnvelope`, `boxesOverlap`, `placementBlocked` (exits pass stairs/escalators; furniture passes rooms; a lift reserves its own 2 × 2 m shaft box), `moduleAt` (prefers furniture over the room around it; answers a lift from any cell its envelope covers), `placementOnTrack`, `isTrackBed` / `trackBedKeys` / `isTrackCell` (a track bed is either the `floor.track` finish or a `track` module's footprint), `trackAt`, `reservedOpening` (a cell a hand-built block may not cover: a ramp's carved corridor or an exit's floor), `billboardCells` (a banner's run), and wall-mounting: `wallSide` (the facing cell a wall-mounted piece bolts to, turned by `rot`), `wallMountMissing` (a 广告牌 / 电视 needs a solid block at the facing neighbour's first course). |
| `track.ts` | Track orientation and footprint — the single source the builder, sim and renderer share: `normRot`, `rotateLocal`, `trackFacing`, `trackSide`, `trackDepth`, `trackCells`, `trackCellAt`, `trackCentre`, `trackOriginForCentre`, `edgeCells`. |
| `billboards.ts` | The 装饰 广告牌 formats: `BillboardSpec`, `BILLBOARD_SPECS`, `BILLBOARD_VARIANTS`, `billboardSpec` — run length + poster aspect shared by the builder, the collision helper, the renderer and the palette. |
| `fences.ts` | Fence (围栏) joint geometry: `FenceNeighbours`, `FenceArms`, `fenceArms` — turns a cell's fence/gate neighbours (plus rotation for a lone panel) into the arm extents and end caps the renderer draws, so every L / T / + joint is clean without three. |
| `openings.ts` | `carveRampOpenings`, `rampEnvelope`, `rampBlocked`, `rampCorridorHalf`, `ESCALATOR_HEADROOM`, `escalatorBasesSolid`, `rampOpeningAt` (the block-brush guard, sharing the carve's ramp list). |
| `stairs.ts` | The four stair shapes, `STAIR_RUN`/`STAIR_RISE`, widths + `nextStairWidth`, `stairFlights`, `stairLandings`, level/turn helpers. |
| `escalators.ts` | `escalatorModule` (the one fixed one-storey piece), `ESCALATOR_RUN`/`RISE`, `nextEscalatorDir`. |
| `lifts.ts` | Elevator (电梯) shaft geometry: `liftModule` (a 2 × 2 m assembly serving the floor one storey up from its base; its model runs on to that floor's ceiling), `liftExtendedUp`/`liftExtendedDown` (grow a shaft one storey at a time), `liftFootprintCells`, `liftStopZs` — the one definition of a placed lift, shared by the builder, the graph and the renderer. |
| `exits.ts` | Head-house geometry shared by sim and render: `EXIT_*` constants, `exitDoorCell`, `exitWallPlanes`, `exitFloorBounds`, `exitCoversCell`, `exitFloorAt`. |
| `agents.ts` | `AgentPool` / `Agent` — the crowd bodies. |
| `world.ts` | `World`, `tickOnce`, `Metrics`, trains, collision/separation pass, trip sampling, `trainRenderState`, the elevator car (`stepLift` / `stepLiftRide` / `liftRenderState`); `rebuild()` (an edit: rebuild the graph, keep the crowd) vs `load()` (a station switch: clear agents, trains, queues, clock and counters). |
| `protocol.ts` | The worker message types (`ToWorker` / `FromWorker`, `GraphInfo`). |
| `worker.ts` | The only sim file that touches `postMessage`; owns the `setInterval` tick loop. |

## `build/` — the station document and edit commands

| File | Owns |
|---|---|
| `model.ts` | `StationState`, `initialStation`, `toData`/`toState`/`cloneState`, `nearestLevel` (snaps to the `LEVEL_STEPS` grid in `sim/constants.ts`), `createModule` (the palette ids `billboard-*` name a variant and centre its run), `addEquipment`, cell add/remove, `removeModule`, module ids, face paint/erase/fill, zone paint + `zoneRegionLabels`, `fenceRotForLine` (a dragged fence run follows the drag axis), facilities (`placeFacility`, `facilityPlan`, `carveFacilityOpenings`, `removeFacility`) and their auto furniture — one `shelf`/`desk`/`cubicle`/`sink`/`bench` module per layout spot (`storeShelfSpots`, `officeDeskSpots`, `restroomSpots`, `boothBenchSpots`, `addAutoFurniture`/`dropAutoFurniture`) with the legacy migration `ensureRoomFurniture` (run by `toState`, guarded by `cfg.stocked`), build floors + their automatic walls (`addFloor`, `removeFloor`, `syncAutoWalls`, `wallRun`, `addWalls`, `wallColumnAt`/`wallColumnsAt`, `plannedAutoWalls`, `AUTO_FLOOR`/`AUTO_WALL`/`AUTO_WALL_H`/`WALL`), `liftInColumn` + `extendLift` (grow a shaft one storey up/down, keeping its id), and `labStation`. |
| `rail.ts` | Rail placement and derived screen doors: `RAIL_BED_DEPTH`, `TUNNEL_HEADROOM`, `TUNNEL_SHELL`, `railRect`, `defaultLine`, `setLinePower` (carries a line's 供电 to every track bound to it), `isPlatformCell`, `trackPieceForLine`, `makeTrack`, `derivePlatformEdges`, `dropDerivedEdges`, `regenerateRailEdges`, `trackInterferenceBlocked` / `trackClearanceBlocked` / `trackFloorMissing` / `trackBlockReason` (eligibility: nothing may share the run's space; a platform needs solid floor and open headroom), `commitTrack`, `placeTrack` (a fixed piece), `placeRail` (the legacy axis-aligned rect), `resizeTrack`, `freeTunnelEnd` / `makeTunnel` / `placeTunnel` (auto-extend a rail off the free end nearest the hovered cell; bores the wall through and raises a shell, no platform doors), `stripTunnelShell`, `railModuleAt`, `railSummary`. Pure document edits. |

## `render/` — three.js

| File | Owns |
|---|---|
| `chunkMesher.ts` | `meshChunk`, `CHUNK`/`CORNER_R`/`BEVEL`, rounded-corner voxel geometry grouped into one part per finish. |
| `materials.ts` | The procedural material kit (`createMaterials`, `MaterialSet`, `contactShadowTexture`). |
| `models.ts` | Procedural module geometry: `buildModule`, `setGateWing`, `rollEscalator`, `buildTrain`, `setDoors`, `createModelMaterials`, `TrainPose`. Draws the 装饰 pieces (shelf / desk / cubicle / sink / wall-mounted ad lightbox + TV cycling the unlit `adFramesWide`/`Square`/`Portrait` posters), the fence panel from `fenceArms`, the 供电 models (guarded 第三轨 conductor rail, overhead 接触网 wire), and the 电梯 shaft with its moving cabin (`buildLift`, cabin in `userData.liftCabin`, a sill + call panel at each real landing). Platform screen headers print the bound line's per-direction terminus. No image or GLB assets. |
| `scene.ts` | `SceneRenderer`, `SceneStats`, `PickResult` — the plain three.js scene driven by the Viewport. Meshes cells by `storeyBand` (hiding the slab at each lift stop above its base so the shaft is a real opening), owns the live fence-drag preview (`setFencePreview`), glides elevator cabins from the worker's poses (`setLifts`), boxes the selected module (`setSelection`), fades walls/screens (`setHideWalls`), and cycles every wall-mounted screen's poster by wall time (`updateAds`). |

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
| `store.ts` | zustand app state: the station document, active tool/brush/rotation/width/direction, view flags (`ghostOtherLevels`, `cutaway`, `hideWalls`, `ortho`), the 地基 `autoWalls` toggle, metrics, selection, and the worker plumbing (`initSim`, `rebuildSim`, `setFrameHandler`, whose state frame now carries the lift poses). Rail and line actions (`layTrack`, `layTunnel`, `rotateRail`, `cycleRailDir`, `setTunnelLength`, `regenRail`, `refreshRailDoors`, `removeRail`, `updateRail`, `updateLine`, `addLine`), `MODULE_OPTIONS` (including 电梯), `FACILITY_OPTIONS`, tool predicates (`isStairType`, `isBillboardType`, `isDecorType`, `isWallMountedType`, `isFenceType`, `isFacilityBrush`, `isRotatableType`). |
| `App.tsx` | Top bar, the folding inspector (`Folder` / `Disclosure`: 信息, one selectable `ExitCard` per exit, and the 线路 cards whose `LineFields` include the 上行终点 / 下行终点 termini), bottom metric bar (FPS + 方块数), global keyboard shortcuts, and the per-tool stage hint (地基 / 装饰 / 围栏 / 电梯 wording). |
| `LeftRail.tsx` | The blueprint build rail: folders for 工具 (选择 / 地基 + its 自动生成墙壁 toggle / 墙 / 删除), 设备, 轨道 (the whole rail panel — the 站台 / 隧道 tools, R rotation, direction, bound line, tunnel-length slider, 重置屏蔽门), 房间 (rooms), 装饰 (座椅 / 货架 / 办公桌 / 厕所隔间 / 洗手池, the 广告牌 nested sub-menu of four formats, 电视), surfaces, zones, view. |
| `Viewport.tsx` | Owns the `SceneRenderer` lifecycle and turns pointer input into build commands (the 地基 (auto walls toggleable) / 墙 / 删除 / equipment / 装饰 / 围栏 drag / paint / zone / 站台 / 隧道 tools, and the 电梯 place-or-extend hover). Cancels a previewing area drag on ESC, a second press, or the other button's release; keeps the 3D selection box in step with `selected`. The only app file that touches three directly. |
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

`node --test` suite importing `src/sim/*.ts` (and, for `rail`, `walls` and the
furniture suites, `src/build/*.ts`) directly: `determinism`, `capacity`,
`layering`, `surfaces`, `save`, `load`, `zones`, `gates`, `trains`, `placement`,
`openings`, `stairs`, `escalators`, `exits`, `facility`, `rail`, `walls`,
`fence`, `storey`, `shelf`, `desk`, `restroom`, `lift`. `layering.test.mjs`
enforces the dependency rule above.
