# Unity C# architecture, coordinates, audio & parity oracles

Detailed reference for `unity/Assets/StationDesigner/` and `tools/unity-parity/`.
For WebGL/WebView2 bridge and UI shell architecture, see
[metro-unity-web](../../metro-unity-web/references/bridge-v2.md).

## Assembly dependency graph

```text
Metro.Sim (noEngineReferences)
  ▲
  ├── Metro.Build (noEngineReferences)
  │     ▲
  │     ├── Metro.Persistence (noEngineReferences, Unity.Newtonsoft.Json)
  │     └── Metro.View (UnityEngine)
  │           ▲
  └───────────┴── Metro.App (+ Metro.Runtime, Unity.InputSystem, Unity.ugui)
                    ▲
                    ├── Assembly-CSharp-Editor (Editor-only + Unity.Pipeline + glTFast)
                    ├── Metro.EditModeTests (Editor + TestAssemblies + Newtonsoft.Json.dll)
                    └── Metro.PlayModeTests (TestAssemblies + Newtonsoft.Json.dll)
```

Boundary rules pinned by `unity/tests/runtime-layering.test.mjs` and the four
project layers in `tools/unity-parity/check-unity-compile.ps1`:

- `Metro.Sim`, `Metro.Build`, and `Metro.Persistence` set
  `"noEngineReferences": true` so pure simulation, document, and serialization
  code stays decoupled from `UnityEngine`.
- `Metro.Persistence` is the sole JSON boundary (`Unity.Newtonsoft.Json`); never
  reference `Newtonsoft.Json` from `Metro.Sim`, `Metro.Build`, or `Metro.View`.
- `Metro.EditModeTests` and `Metro.PlayModeTests` set
  `"overrideReferences": true` with `"precompiledReferences": ["Newtonsoft.Json.dll"]`
  to inspect persistence JSON contracts directly.

## Key C# file map (`unity/Assets/StationDesigner/`)

| Folder / Assembly | Key files |
| --- | --- |
| `Runtime/Sim/` (`Metro.Sim`) | `StationClock`, `SimulationScheduler`, `SimulationRng`, `StationWalkGraphBuilder`, `StationWalkGraphWorkspace`, `StationRoutePlanner`, `StationSparsePolicy`/`Topology`/`Router`, `StationSimulationSession`, `StationServiceRuntime`/`Doors`/`Frames`, `StationPassengerWalking`, `StationActivityStops`, `StationTrainPose`, `StationRoadTraffic`, `StationStatistics` |
| `Runtime/Build/` (`Metro.Build`) | `StationDocument`, `StationRecordPages` (256-record pages), `StationIndex` (`TryCreateIncremental`), `ModuleFacts`, `StationFootprints`, `StationEditPlanning`, `StationCellEditPlanning`, `StationWallAim`, `StationCeilingAim`, `StationRampPlanning`/`Carve`, `StationStairSlides`, `StationLiftPlanning`, `StationFacilityPlanning`, `StationModuleRuns`, `StationLineDefaults`, `StationRoofPlanning`, `StationPillarPlanning`, `StationHangerPlanning`, `StationRailPlanning`, `StationTunnelShell`, `StationSurfacePlanning`, `StationZonePlanning`, `StationFinishEdits`, `StationSignEdits`/`Layouts`, `StationExitSnapping`, `StationPlatformDoorways`, `StationPsdEndRules`, `StationRoadDocument`/`Layout`/`Edits` |
| `Runtime/Persistence/` (`Metro.Persistence`) | `StationSaveV1`, `StationSaveCandidate`, `StationDocumentReader`, `ModuleFactsReader`, `StationLocalEdit`, `StationHostEdits`, `StationCellEdits`, `StationModuleEdits`, `StationLiftEdits`, `StationRoadWrites`, `StationCellNormalization`, `StationDayRepair`, `StationGridRepair`, `StationLineRepair`, `StationSignRepair` |
| `Runtime/View/` (`Metro.View`) | `StationCoordinates`, `ModulePlacement`, `ModuleViews`, `StationModuleLevels`, `StationCeilingMounts`, `StationOutdoorSurfaceLift`, `StationOutdoorConnections`, `StationConnectionDependencies`, `StationPlatformInsets`, `StationRampOpenings`, `StationCellMesher`, `StationCellMeshWorkspace`, `StationVisibility`, `StationViewCommands`, `StationCameraState`/`Controller`, `StationRailGeometry`/`Meshes`, `StationExplodedLayoutPlan`/`Connections`, `StationMeshLodIndices`, `RuntimeCatalogue`, `TrainCatalogue`/`Consist`/`Formations`/`MeshLods`, `PassengerCatalogue`/`Anchor`/`Appearance` |
| `Runtime/App/` (`Metro.App`) | `StationGameHost`, `StationLoadCoordinator`, `StationWorldView`, `StationCommandRouter`, `StationDesktopUiPresenter`, `StationDesktopCursors`, `StationBenchmarkRecorder`, `StationPlayerBenchmark`, `StationEditProfiling`, `StationBindingReport`, `StationTools`, `StationPointerRouter`, `StationScenePicker`, `StationEditSession`, `StationPlacementPreview`, `Station{Cell,Paint,Zone,Rail,Tunnel,Surface,Roof,Pillar,Lift,Road}Tool`, `StationRenderRig`, `StationSkySystem`, `StationSectionView`/`Drag`, `StationExplodedView`, `StationStatisticsFeature`, `StationGraphicsSettings`, `StationModelDetailConfiguration`, `StationFsrUpscaler`, `StationRigidModelLods`, `StationGlass`, `StationMaterials`, `GeometryKit`, `ModuleMotion`, `TrainDoorRig`, `StationFamilyRenderers` |
| `Runtime/App/Views/` (`Metro.App`) | `StationCellView`, `StationFinishLibrary`, `StationModuleGroups`, `StationPrefabBatch`, `StationStructureModuleViews`, `StationContactShadows`, `BoothModuleViews`, `OutdoorModuleViews`, `VerticalModuleViews`, `OpeningModuleViews`, `PsdReturnTrim`, `TrainConsistViews`, `TrainLiveryBinder`, `PassengerCrowdView`, `SessionPassengerFeed`, `StationRoadView`, `RoadVehicleViews`, `StationExplodedTrayBuilder`, `StationGridRenderer`, `StationOverlayViews`, `StationZoneMap`, `StationSignView`/`TextureCache`, `StationExitArtwork`, `PsdHeaderArtwork`, `StationDisplayArtwork`, `StationDisplayTvArtwork`, `StationTvPlatePainter`/`Schedule`, `StationLineMapArtwork`, `StationClockArtwork`, `StationCalligraphyArtwork`/`FaceCache` |
| `Editor/` (`Assembly-CSharp-Editor`) | `StationGameScene`, `StationLocalProfile`, `RuntimeCatalogue`, `TrainCatalogueBuilder`, `PassengerCatalogueBuilder`, `LocalPassengerInjection`, `StationMeshLodImporter`, `TrainMeshLodBaker`, `StationGraphicsProjectSettings`, `BuildWeb`, `BuildWindows`, `ImportAssets`, `StationGameSmoke`, `StationStoreyVisibilityProbe`, `StationBindingReportCommand`, `StationEditorReactOverlay`, `StationDesignerIcon.png` |
| `Plugins/WebGL/` | `StationGame.jslib` (+ test-harness `.jslib` files; every exported function declares `<fn>__sig` with `'p'` on pointer args) |
| `Resources/` | `StationFinish`, `StationSky`, `StationSection{Lit,Unlit}`, `StationHighlight`, `StationExplodedGuide`, `StationFsr1` shaders; `StationSection{Clip,Depth}.hlsl`; `StationGlassRef.mat`, `StationUnlitTransparentRef.mat`; `StationFinishes/`, `Posters/`, `LineMaps/`, `ModelLods/` |
| `Tests/` | `Tests/EditMode/*Tests.cs` + `*-oracle.json` fixtures; `Tests/PlayMode/{BootstrapPlayTests,StationExplodedViewPlayTests}.cs` |

## Coordinates, handedness & flat-box winding

- **Single conversion point (`StationCoordinates.cs`):** Saved documents,
  `Metro.Sim`, and `Metro.Build` stay in document axes `(x, y, z)` (`StoreyHeight = 5`,
  `LevelMinSteps = -8`, `LevelMaxSteps = 6`; integer `Facts.Z` indexes storeys
  while `Facts.ExactZ` keeps fractional wall-mounted/vertical heights preserved
  across `ModulePlacement.Position`, `OpeningModuleViews.Pivot`,
  `BoothModuleViews.Pivot`, `StationStructureModuleViews`, and
  `StationModuleGroups.BuildWallGlassGeometry`).
  `StationCoordinates.Point(x, y, z)` maps `(x, y, z)` → Unity world `(x, z, y)`.
  Never add implicit `+0.5` or `+1` in raw `Point` conversions; use `CellCenter`
  and `FloorTop` explicitly.
- **Quarter-turns (`ModuleRotation`):** Saved counter-clockwise turns map to
  `-90° * rot` Unity yaw (`YawPerTurn = -90f`).
- **Local builder space & glTFast nuances:** Family builders receive a parent
  `Transform` already positioned in world space — never swap axes a second time.
  Opening GLBs wrap Z-up content in a `-90°` X node, so swing door hinges rotate
  about `OpeningAxis.Z` rather than local Y. Measure mirrored glTFast cabinets
  in holder space (`TryMeasureGateJambInHolder`), skip `ModulePlacement.RunCentre`
  on corner-pivoted `court-{pickleball,badminton,divider}` prefabs, and guard
  `MeshTopology.Lines` submeshes (`court-net-mesh`) before `GetTriangles(...)`.
- **Flat-shaded outward winding (`GeometryKit.BoxFaces` & `LocalMesh`):** Procedural
  boxes and extruded profiles in `BoothModuleViews`, `VerticalModuleViews`,
  `PsdReturnTrim`, and previews must emit 24 per-face vertices via `BoxFaces.Append*`
  (or flat-shaded outward-wound custom meshes via `GeometryKit.LocalMesh` /
  `LocalBoxMesh`, such as `BoothModuleViews.BuildProfilePrism` and `ScreenCube()` with
  `1 - v` LCD UVs matching glTFast's flipped `ticket-booth.glb` `screen` texture) so
  triangles wind outward under backface culling without smoothed corner normals
  (`MeshWindingTests`). Camera snapshots map Unity `right`/`up`/`-forward` back to
  document axes for React's `ViewCube`.

## Feature registration & per-world lifecycle

- Features self-register via `[RuntimeInitializeOnLoadMethod]` into
  `StationRenderers`, `StationCommandHandlers`, `StationFrameSinks`, and
  `host.RegisterStateContributor(...)`; `StationGameHost` holds no per-family
  branches.
- `StationLoadCoordinator` stages the candidate `StationWorldView` before
  disposing the outgoing world (`BeforePreviousDispose` fires right before old
  world teardown). Every `IStationViewRenderer` singleton must key state per
  `StationWorldView` and prune only `IsDisposed` worlds in `Release()`.
  For non-blocking desktop startup, `StationLoadCoordinator.OpenPreReadYielded`
  accepts a background-parsed `StationReadResult` and optional pre-built
  `StationSimulationSession` (`StationSimulationHost.StagePrebuiltSession`),
  drives `StationWorldView.BuildYielded` (yielding between renderers), and
  runs `IStationYieldedViewRenderer` implementations such as
  `StationCellRenderer.BuildYielded` (off-thread `StationCellMeshWorkspace.Create`
  + `10 ms` time-sliced `EnumerateChunkMeshesDirect`).
- Host-initiated browser artwork requests (signs, PSD headers & decals, street
  exits, calligraphy, train cab marks) must publish via
  `StationGameHost.PublishOutbound` — never WebGL-only
  `StationWebBridge.Publish` — so both WebGL and desktop/Editor WebView2 receive
  them (`StationSignTransportTests`). Billboards, TV departure boards, city line
  maps, digital/analogue clocks, and zone labels render natively in C# via
  `Resources/{Posters,LineMaps}` and `NotoSansSC.ttf`.
- **Lock-free state publishing & TV repaint ownership (`StationLoadCoordinator`,
  `StationGameHost`, `SessionPassengerFeed`, `StationStatisticsFeature`,
  `StationDisplayTvArtwork`, `StationTvPlatePainter`):**
  `StationSimulationHost.PublishFrameLocked()` snapshots immutable crowd counters
  and reused `StationPublishedStatistics` into `StationPublishedSimFrame`, so
  10 Hz `PublishStateNow()` reads `PublishedFrame` lock-free without waiting on
  the background worker's `sessionLock`. In PlayMode,
  `StationDisplayTvArtwork.StateContributor.BuildPayload` defers TV painting to
  `Advance()` (`4/frame`, `skipHidden: true`), raw `"displays"` caching keys on
  `PublishVersion`, and evicted `RenderTexture`s recycle through
  `StationTvPlatePainter`'s bounded `(width, height)` pool (`MaxPooledPlateTextures = 16`)
  (`StationPerfLockFreeAndTvTests`).

## Simulation parity contracts

- **Sparse hierarchical routing (`StationSparsePolicy`, `StationSparseTopology`,
  `StationSparseRouter`):** Bit-for-bit mirror of `game/src/sim/sparse*.ts`
  (`SectorSize = 16`, `WalkHorizon = 16`, `RefillThreshold = 4`, `16 MiB`
  reverse-field LRU, finite `MandatoryPopBudget`/`LocalRefillBudget` limits,
  rollback switch `StationRoutingMode.Sparse | Legacy` defaulting to `Sparse`).
  Keep static region reachability (`StationSparseTopology.CanReach`), field-free
  coarse queries, and same-tick cold-field warmup in `StepSparseRouting` aligned
  with the browser (`StationSparseRoutingTests`, `crowd-routing-oracle.json`).
- **Fare gates, platform queues, errands & walking profiles:**
  - `StationWalkGraphBuilder`/`Workspace` enforce directional fare-line crossings
    (`CrossingDir`, `GateAllows`, `GateLaneAllows`, `GateApproach`), exit
    head-house enclosure wall planes, and activity-stop nodes (`StationActivityStops`:
    TVMs, vending, benches, shelves, cubicles, sinks, shops/retail/booths).
  - `StationServiceRuntime` models committed two-way gate lanes, platform
    flanking waiting nodes (`PlatformWaitingNodes`, `PsdQueueClearDepth`), door
    load commitments, multi-leg errand queuing/dwell, and deterministic walking
    profiles (`StationPassengerWalking`, mirrored in `PassengerCrowdView`).
    Verified by `StationSimParityTests` and `StationErrandsAndWalkingTests`.
- **Vertical circulation & lifts (`StationServiceRuntime`, `StationRoutePlanner`,
  `StationWalkGraphBuilder`, `StationWalkGraphWorkspace`):**
  - Arrivals and alighters share the `3%` step-free (`StepFreeChance = 0.03`) and
    `8%` luggage (`LuggageChance = 0.08`) mix; alighter needs sample deterministically
    by passenger ID.
  - Lift edges use `LiftCycleSeconds = 40`, `LiftBatch = 15` riders/cycle queue
    wait (capped at `600 s`), and mobility penalties (`0 s` step-free, `30 s`
    luggage, `300 s` standard). Lift riders step through `LiftPhase` `0` (walk in
    to `LiftCabinSlot`, doors held via `IsLiftExchanging`), `1` (ride), and `2`
    (walk out to landing).
  - Multi-flight stairs charge `StairAvoidSeconds * StairFlights` (`32 s`/flight).
    Walk-graph builders share `ExitDoorCell` (half-up rounding),
    `EscalatorCenterShift`, `EscalatorBlockedLowerCells`, and `LiftBlockedCells`;
    `StepRideQueue` spreads queues and enforces `RideApproachRadius = 0.95 m`
    (`StationServiceFrameTests`, `StationMovingVisibilityTests`).
- **Road traffic & statistics:** `StationRoadTraffic` mirrors web lane-scaled
  green phases (`12 + (lanes - 2) * 4 s`) and FNV-1a avalanche hashing
  (`StationRoadTests`). `StationStatistics` computes Fruin `A–F` LOS, all 18
  metric fields, and 1-minute `StationStatisticsHistory` served via paginated
  `stats.history` (`StationStatisticsTests`).

## Unity audio architecture

- Audio recordings live in `game/public/audio/` (six edit cues, three ambience
  beds, eight music tracks) and play through the shared React shell via
  `game/src/unity-web/unityAudio.ts` (`gameAudio` + `gameMusic`).
- In C#, `StationCommandRouter` (`StationEditAudioOutcome`) emits edit cues
  (`place`, `select`, `pick`, `delete`, `move`, `refused`) from command outcomes
  without another scene pick. `StationGameHost.PublishAudio` emits bounded
  camera-relative ambience frames (`position`, `right`, nearest moving `train`
  and `traffic` sources, sampled `passengers` with `sampleWeight`, and `speed` —
  using exploded-tray actors/trains while exploded view is open) on the
  session-scoped `audio` channel outside the snapshot reducer. Hover, cancels,
  no-ops, and parked trains remain silent.

## TypeScript parity oracles (`tools/unity-parity/`)

Generators write deterministic JSON oracles into
`unity/Assets/StationDesigner/Tests/EditMode/` consumed by EditMode tests:

| Script | Output / purpose |
| --- | --- |
| `export-station-documents.mjs [--check]` | Exports gitignored `Demos/{zoo,tanwei,tianhe}.metro.json` + `provenance.json` |
| `record-crowd-routing.mjs` | `crowd-routing-oracle.json` (sparse + legacy routing parity) |
| `record-edge-placement.mjs [--check]` | `edge-placement-oracle.json` (edge-decor placement & curtain clearance) |
| `record-module-placement.mjs [--check] [--demos <out>]` | `module-placement-oracle.json` (1,022 exact transformed-vertex module bounds, `StationOutdoorSurfaceLift` 0.10 m paving lift, and optional full-demo audit across `zoo`/`tanwei`/`tianhe`) |
| `record-auto-wall-edits.mjs [--check]` | `auto-wall-edits-oracle.json` (floor/auto-wall edit ownership) |
| `record-station-coordinates.mjs` | `station-coordinates-oracle.json` |
| `record-station-clock.mjs` | `station-clock-oracle.json` + `station-route-oracle.json` |
| `record-station-service.mjs` | `station-service-oracle.json` (paired with `{zoo,tianhe}-gate-oracle.json`) |
| `record-station-cell-mesh.mjs` | `station-cell-mesh-oracle.json` |
| `record-station-connections.mjs` | `station-connections-oracle.json` |
| `record-station-exits.mjs` / `record-station-exit-faces.mjs [--check]` | `station-exits-oracle.json` + `station-exit-faces-oracle.json` |
| `record-station-exploded-view.mjs` | `station-exploded-view-oracle.json` |
| `record-station-edit-trace.mjs` | `station-edit-oracle.json` |
| `record-station-roads.mjs` | `road-oracle.json` |
| `record-cell-normalization.mjs` / `record-sign-normalization.mjs` / `record.mjs` | `cell-normalization-oracle.json`, `sign-normalization-{input,expected}.json`, `rng-oracle.json` |
| `record-passenger-appearance.mjs` | `passenger-appearance-oracle.json` |
| `capture-ts-view.mjs` + `compare-captures.mjs` | Matched TypeScript reference screenshots & RGB diff reports under `.preview/unity/` |
