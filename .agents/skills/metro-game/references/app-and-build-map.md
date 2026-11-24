# Game Application, Build, Persistence, and Assets Map

File-by-file ownership for `game/` outside the sibling-owned layers:

- `game/src/sim/` -> [sim-module-map.md](../../metro-game-sim/references/sim-module-map.md)
- `game/src/render/` -> [render-module-map.md](../../metro-game-render/references/render-module-map.md)
- `game/test/` -> [suite-map.md](../../metro-game-test/references/suite-map.md)
- `game/src/unity-web/` & `game/vite.unity-ui.config.ts` -> [`metro-unity-web`](../../metro-unity-web/SKILL.md)
- `game/wasm/` -> [`metro-wasm-experiment`](../../metro-wasm-experiment/SKILL.md)

## Root, Worker, Scripts, and Public Assets (`game/`)

| Path | Ownership |
| --- | --- |
| `index.html`, `src/main.tsx`, `src/styles.css` | HTML shell, capture-route / mobile-gate entry, and global CSS (including `blueprint`/`site`/`studio` themes). |
| `package.json`, `tsconfig.json`, `vite.config.ts` | Dependencies (`react`, `three`, `zustand`, `immer`), strict TS config, portable `base: './'`, dev/preview `/en/` & `/benchmark/` asset aliases, `dist-wasm` mode switch. |
| `wrangler.jsonc`, `worker/index.js` | `metro-game` Cloudflare Worker serving `stationdesigner.com/game` & `/game/*`, `308` canonical redirects, `/en/` & `/benchmark/` asset aliasing, SPA fallback. |
| `scripts/passenger-assets.ts` | Vite build plugin splitting baked passenger JSON binaries into `< 20 MiB` `.bin` chunks and enforcing the `25 MiB` Worker asset ceiling. |
| `scripts/editor-benchmark-build.ts` | Emits `editor-benchmark-build.json` (`editorTreeHash`) tying production bundles to exact `game/src` hashes for benchmarks. |
| `scripts/build-wasm.mjs` | Toolchain-pinned Rust/WASM kernel builder (`wasm-experiment` mode only). |
| `public/audio/` | Baked 6 interaction WAVs, 3 CC0 ambient MP3s, licenses, `manifest.json`, and `music/` (8 streamed 80 kbps MP3s + `manifest.json`). |
| `public/module-thumbnails/` | Checked-in `132 px` LHS palette PNGs (`index.json` + 7 non-Guangzhou city subdirs with 14 PNGs each). |
| `README.md`, `diag.mjs`, `*-gate-proof.{html,mjs}` | In-repo game documentation and local standalone diagnostic harnesses. |

## Build Layer (`game/src/build/`)

Pure document-editing commands (`build/` imports `sim/` only; never `render/` or `app/`):

| File | Ownership |
| --- | --- |
| `build/model.ts` | Compatibility barrel re-exporting public build API from `build/model/*`. |
| `build/validation.ts` | Single-verdict preview/commit aggregator (`checkBlockCells`, `checkCutCells`, `checkModulePlacements`, `dominantRefusal`, `blockRefusalNotice`, `previewNotice`). |
| `build/rail.ts` | Track/platform/tunnel/bridge placement (`placeTrack`, `commitTrack`, `resizeTrack`), `derivePlatformEdges`, `regenerateRailEdges`, `removeLineAndTracks`, `defaultLine`, `setLinePower`, `trackBlockReason`. |
| `build/model/State.ts` | `StationState`, load normalization (`toState`, `toStateRepairing`), serialization bridge (`toData`), `cloneState`. |
| `build/model/Grid.ts` | Whole-metre grid validation (`isGridCell`, `isGridModule`) and off-grid stripping (`repairGrid`). |
| `build/model/Cells.ts` | Sparse cell primitives (`addCells`, `removeCells`, `isSolid`, `sameCells`, `nearestLevel`, `storeyColumnsAt`). |
| `build/model/Floors.ts` | Floor patch edits (`addFloor`, `removeFloor`) and bounded/full auto-wall reconciliation (`plannedAutoWalls`, `syncAutoWalls`). |
| `build/model/Walls.ts` | Wall column/run placement (`addWalls`, `wallRun`, `storeyWallRun`, `wallSnap`), half-wall/corner/triangle side helpers. |
| `build/model/Ceilings.ts` | `SUSPENDED_CEILING` tag and `addSuspendedCeiling` placement in the service metre. |
| `build/model/Paint.ts` | Face finish overrides and surface floods (`paintFace`, `eraseFace`, `paintFaces`, `fillSurface`, `paintStairSurface`, `paintPillarSurface`). |
| `build/model/BridgePaint.ts`, `TrackPaint.ts`, `RoofPaint.ts` | Independent finish painting for bridge structures, track beds, and connected roofs. |
| `build/model/BridgePillars.ts`, `TunnelShell.ts` | Bridge-owned pier generation (`syncBridgePillars`) and tunnel shell boring/stripping (`boreTunnel`, `stripTunnelShell`). |
| `build/model/Equipment.ts` | Module factories (`createModule`), poster/sign backfill (`assignAdPosters`, `ensureSignLayouts`), CRUD/move (`addEquipment`, `moveEquipment`, `replaceEquipment`, `removeModule`), city-aware `nextExitName`. |
| `build/model/Lifts.ts` | Elevator column lookup (`liftInColumn`) and storey extension/trim (`extendLift`, `removeLiftExtension`). |
| `build/model/OutdoorSurfaces.ts` | Batch sidewalk/lawn tile placement and replacement (`editOutdoorSurfaces`). |
| `build/model/Roads.ts` | Authored road segment additions and splits (`addRoadSegment`, `removeRoadSegment`). |
| `build/model/Facilities.ts` | Buildable `ticket`/`info` booths, legacy `shop` room helpers (`facilityWallCells`, `SHOP_WALL_H`), furniture spots (`ensureRoomFurniture`). |
| `build/model/Zones.ts` | Fare-zone and room-purpose floor painting/erasing (`paintZone`, `paintZoneCells`, `eraseZoneCells`, `clearCeilingZoneLabels`, `zoneMapFloors`, `zoneRegionLabels`). |
| `build/model/Reference.ts` | Fixture helpers (`labStation` for `/lab`, `initialStation`). |

## Persistence, Data, and Static Assets (`game/src/{persistence,data,assets}/`)

| Path | Ownership |
| --- | --- |
| `persistence/save.ts` | `metro-save` v1 envelope (`SAVE_FORMAT`, `SAVE_VERSION`, `GAME_VERSION`, `serialize`, `parse`, forward `migrate` hook). |
| `data/reference-station.ts` | `EXAMPLE_STATION_IDS` (`zoo`, `tanwei`, `tianhe`), `referenceStation()`, `REFERENCE_BOOT`, `emptyStation()`. |
| `data/demo-station.json`, `tanwei-station.json`, `tianhe-station.json` | Shipped `StationData` demo documents (re-baked via `tools/bake-demo-station.mjs`, never hand-edited). |
| `data/line-colours.ts` | Compatibility re-export of palette constants and `lineColourFor` from `sim/cityStyles.ts`. |
| `assets/PASSENGERS.md`, `passenger-{approved,activities,human,source-lf}.json` | Baked soft-human passenger atlases and LF verification record (`npm run bake:passengers`). |
| `assets/brand/`, `branding/`, `linemaps/`, `pictograms/`, `posters/`, `stations/`, `trees/` | Favicons, city logo contour JSONs, 8 city network maps, sign pictograms, 74 `.webp` ad posters, 3 demo card `.webp` previews, and EZ-Tree ash JSON/leaf assets. |

## App Layer (`game/src/app/`)

### Bootstrap, Routing, Services, and Capture Helpers (`src/app/*.ts{,x}`)

| File(s) | Ownership |
| --- | --- |
| `boot.tsx`, `App.tsx`, `LeftRail.tsx`, `SignEditor.tsx`, `store.ts` | Desktop boot (`renderGame`, autosave/demo/worker init, `window.__metro`) plus compatibility barrels over `windows/`, `rail/`, `store/`. |
| `Lab.tsx`, `MobileNotice.tsx`, `mobile.ts`, `gameLoading.ts` | `/lab` material scene, phone/tablet gate (`isMobileMode`), and `#game-loading` overlay helpers. |
| `Viewport.tsx`, `ViewCube.tsx`, `ViewCubeAdapter.ts`, `viewHome.ts`, `openingLevel.ts` | 3D canvas host (renderer mount, pointer/wheel/key dispatch, `isTypingTarget`), orientation cube + Three/Unity adapter, home camera, initial active storey selection. |
| `autosave.ts`, `demoRoute.ts`, `languageRoute.ts`, `reportIssueRoute.ts` | `metro-game.autosave.v1` persistence, `/zoo`/`/tanwei`/`/tianhe` route parsing, route-isolated i18n/benchmark URLs, `/stats[/en]/report` links. |
| `i18n.ts`, `uiTheme.ts`, `graphicsQuality.ts`, `upscaling.ts`, `edgeScrolling.ts`, `statsSettings.ts` | Reactive language hook/init and localStorage-backed player preferences outside station saves. |
| `globalStats.ts` | Anonymous 5-minute global telemetry collector, write-lease manager, retry queue, and `pagehide` beacon (`metro-stats`). |
| `gameAudio.ts`, `ambientPlayback.ts`, `audioActions.ts`, `audioSettings.ts`, `gameMusic.ts`, `musicTracks.ts` | Browser Web Audio SFX, speed-scaled spatial ambience, volume prefs, and single-element music streamer ([references/audio.md](audio.md)). |
| `stationHostBridge.ts`, `stationGeometry.ts`, `frameTask.ts`, `pointerDrag.ts`, `Slider.tsx`, `touchZoom.ts`, `sweep.ts` | Shared Unity host commit seam, geometry helper, rAF coalescing, pointer-drag/scrollbar/slider helpers, pinch zoom, delete-sweep sampling. |
| `moduleThumbnailAssets.ts`, `moduleThumbnails.ts`, `zoneThumbnails.ts` | Static LHS thumbnail URL resolver, offline PNG/elevation/isometric capture renderer, and zone icons. |
| `captureBlocks.ts`, `captureCards.ts`, `capturePassengers.ts`, `captureRamp.ts`, `captureRoadVehicles.ts`, `captureTrains.ts` | Concept-art capture passes invoked via `?capture-*` query routes (`main.tsx`). |

### Store (`src/app/store/`)

| File(s) | Ownership |
| --- | --- |
| `Store.ts`, `catalog.ts`, `builderAttributes.ts` | Zustand `useStore` wiring 12 slices; complete placeable piece catalogue (`MODULE_OPTIONS`, `MODULE_FAMILIES`, `CUT_MODES`, predicates); shared rail/keyboard builder attributes. |
| `slices/StationSlice.ts`, `SimSlice.ts` | Document state, `commit`, 40-frame undo/redo, save/load/demo/city/demand actions; Web Worker lifecycle, frame/route callbacks, clock/history/metrics. |
| `slices/ToolSlice.ts`, `ViewSlice.ts`, `RailSlice.ts`, `LineSlice.ts` | Active tool & `previousTool`, cut/ramp/module settings; active storey, level slicing, camera/overlays/quality/FSR; rail defaults & track edits; line consist/power/PSD/headway edits. |
| `slices/MoveSlice.ts`, `PickSlice.ts`, `PaintSlice.ts`, `LiftSlice.ts`, `SignSlice.ts`, `StatsSlice.ts` | Lifted module draft, eyedropper undoable pick state, finish paint mode, elevator door modal, sign board editor session, and stats-sharing consent. |

### Pointer Tools (`src/app/tools/`)

| File(s) | Ownership |
| --- | --- |
| `ToolController.ts`, `ToolContext.ts`, `clearPreview.ts` | Base controller (`onDown`/`onMove`/`onUp`/`refreshHover`), shared drag/hover refs, and preview teardown. |
| `BlockTool.ts`, `WallTool.ts`, `DeleteTool.ts`, `PaintTool.ts`, `ZoneTool.ts`, `SelectTool.ts`, `PickTool.ts`, `MoveController.ts` | Core voxel/face/zone/inspect/pick/move gesture controllers. |
| `EquipmentTool.ts`, `PlatformTool.ts`, `TunnelTool.ts`, `RoadTool.ts`, `TactileTool.ts`, `TileEquipmentTool.ts`, `RoofTool.ts` | Equipment placement (lines, lifts, stairs, fences), platform tracks, tunnel/bridge extensions, road centrelines, tactile runs, and rectangular roof/stair-block gestures. |
| `boothSignHit.ts`, `deletionTarget.ts`, `moduleAim.ts`, `moduleTarget.ts`, `placementInput.ts`, `placementSurface.ts` | Shared geometry-snapping aim, nearest-surface hit prioritization, booth-sign picking, and visibility-filtered targeting. |
| `geometry/{cells,faces,framePreview,linePlacement,multiPlaceDrag,pointer,stablePreviewDelay,walls}.ts` | Pure drag-cell, face-plane, line-pitch, budget-refusal, long-press, 100 ms preview-delay, and wall/cut snapping math. |

### Build Rail (`src/app/rail/`), Windows (`src/app/windows/`), and Benchmark (`src/app/benchmark/`)

| Directory / File(s) | Ownership |
| --- | --- |
| `rail/LeftRail.tsx`, `helpers.ts`, `paintColours.ts`, `actions/ActionRow.tsx`, `items/LineItem.tsx`, `menus/{StructurePanel,VariantMenu}.tsx` | Left build palette shell, `RAIL_FOLDERS` (`Shift+1..0`) and `INSPECTOR_FOLDERS` (`Alt+1..4`) tables, variant sub-menus, action rows, line items, and station-owned custom paint colour derivation. |
| `rail/folders/{Tools,Rail,Equipment,Decor,Paint,Room,Zone,View}Folder.tsx` | Folder bodies for the build rail (tools, structure, equipment, 4 decor sections, materials, rooms, zones) and inspector view toggles. |
| `rail/shared/{AttributeArt,Block,ColourTile,Folder,Icon,InlinePanel,RotateTile,SpacingTile,TileGrid}.tsx`, `dimensionMark.ts`, `dimensionSelection.ts` | Shared build-rail tiles, blueprint SVG icons, inline fold-out rows, colour/rotate/spacing controls, and dimension-bar geometry. |
| `windows/AppShell.tsx`, `StationHost.tsx`, `shared/{CollapseButton,Disclosure}.tsx` | Five-window layout (`TopBar`, `LeftRail`, `Viewport`, `Inspector`, `BottomBar`), global keyboard shortcuts, notice toast, and optional Unity `StationHost` context. |
| `windows/topbar/*` | `TopBar`, `NewStationButton` (confirmation modal), `ExampleStationsButton` (`exampleStations.ts`), `CityStyleSelect`, `FileButtons`, `SimulationControls`, `PlaybackToggle`, `SettingsMenu`, `MusicSetting`. |
| `windows/inspector/*` | `Inspector`, `ClockCard`, `InfoCard`, `ExitCard`, `LineCard`, `HeadwayInput`, `LiftDoorModal`, `refreshPlatform.ts`. |
| `windows/statusbar/{BottomBar,Metric}.tsx`, `windows/time/{TimePanel,DayCurve,TrainCurve}.tsx`, `windows/charts/{ChartsPanel,LineChart,scale}.tsx` | Status bar KPIs/LOS, floating service/demand/calendar schedule editor, and time-series statistics charts. |
| `windows/sign/*` | Modal bilingual wayfinding sign board editor (`SignEditor`, `BinStrip`, `palette`, `TextFields`, `textHistory`, `tileArt`, `dragGhost`, `tokens`). |
| `windows/tutorial/{Tutorial,steps,tutorial.css}`, `windows/{ExplodedView,ExplodedViewShell,explodedPanelBounds}.*` | Interactive bilingual onboarding tour and standalone exploded-view modal shell + floor-control positioning. |
| `benchmark/{BenchmarkRoute,FrameTimeChart,benchmarkCameraTour,benchmarkCopy,benchmarkStats,benchmark.css,editorActionCases,editorActions}.*` | Interactive `/benchmark` & `/benchmark/en` performance route (with pure-DOM `benchmarkStations` buttons, `FrameTimeChart` ms time-series SVG, LOD0 close-up `CameraTourDriver`, and optional `wasm-experiment` backend picker) plus opt-in editor-action benchmark harness (`?bench-editor-actions`). |
