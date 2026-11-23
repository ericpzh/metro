# Unity 6 URP performance contracts

Active performance invariants for the Unity 6 URP runtime (`unity/`) and shared
React/Unity bridge (`game/src/unity-web/`). See [performance.md](performance.md)
for measurement rules and [perf-benchmarks.md](perf-benchmarks.md) for commands.

## Model detail profiles & non-active storey LODs

- **3-tier model detail** (`StationGraphicsSettings.cs`,
  `StationModelDetailConfiguration.cs`): `high` (bias `1.0`, min LOD `0`,
  other-level floor `1`), `balanced` (bias `0.7`, min LOD `0`, other-level floor
  `2`), and `low` (bias `0.4`, min LOD `1`, other-level floor `2`). Persisted in
  `PlayerPrefs` (`metro.graphics.model-detail`) and bridged via
  `graphics.get` / `graphics.set`.
- **LOD curves & hysteresis**: `FullThreshold = 0.12`, `ReducedThreshold = 0.05`,
  `Hysteresis = 0.10`, and `NativeThreshold = 1.0` drive
  `QualitySettings.meshLodThreshold`, `StationMeshLodIndices.Configure`, and
  `PassengerCrowdView` actor tier selection.
- **Non-active storey LOD step-down** (`StationVisibility.cs`,
  `StationModuleGroups.cs`, `PassengerCrowdView.cs`): Targets on non-active or
  ghosted storeys step down to `OtherLevelMeshLod` (`LOD1` in `high`, `LOD2` in
  `balanced`/`low`). `HideUi`, `Cutaway`, and `Grid`/`Cursor`/`Overlay` roles
  retain normal tier selection.
- **Mesh LOD budget**: Native 3-tier Mesh LODs target `LOD2 × 2 ≤ LOD0` (≥ 50%
  triangle reduction; exceptions for zero-triangle meshes, 2-triangle quads, and
  explicitly retained procedural paths). Compacted trains and rails pack
  shared-prefix or low-override index ranges (`StationMeshLodIndices.cs`,
  `TrainMeshLods.cs`). Full inventory:
  [unity-model-lod-inventory.md](unity-model-lod-inventory.md).

## Runtime FSR 1.0 upscaling

- **Modes & persistence** (`StationFsrUpscaler.cs`, `StationGraphicsSettings.cs`):
  `native` (`1.0`), `ultra` (`1/1.3`), `quality` (`1/1.5`), `balanced` (`1/1.7`),
  and `performance` (`0.5`), stored in `PlayerPrefs` (`metro.graphics.upscaling`)
  and exposed in Settings and `/game/unity/benchmark`.
- **Desktop / Shader Model ≥ 4.5 (`urp-fsr1`)**: When
  `SystemInfo.graphicsShaderLevel >= 45` (Windows D3D11/D3D12/Vulkan), sets URP
  `renderScale` and `upscalingFilter = FSR` directly on the active pipeline asset.
- **WebGL 2 / ES 3.0 (`webgl-fsr1`)**: Keeps URP `renderScale = 1.0` to avoid
  double scaling, renders the active game camera to a scaled `RenderTexture`,
  and executes the two-pass EASU + RCAS shader (`Resources/StationFsr1.shader`,
  `DefaultSharpness = 0.2`) directly to the backbuffer. Restores
  `camera.targetTexture = null` in `endCameraRendering` so picking and layout
  always observe full screen dimensions.

## Retained edits, batching & visibility

- **Incremental edit path**: Ordinary single-block edits, undo, and redo commit
  through paged `StationRecordPages`, sharded `StationIndex.TryCreateIncremental`
  deltas, typed local classification (`ClassifyLocal`, comparing retained
  unknown-root trees without reparsing JSON), retained
  `16 × 16 × storey × role × finish` `StationCellMeshWorkspace` chunks
  (`StageLocalWorld`), incremental `StationWalkGraphWorkspace.StageCellDelta`
  with ping-pong scratch buffers, selective `StationServiceRuntime`
  reconciliation, and versioned `delta` (`schemaVersion: 1`) bridge commits
  adopted incrementally by `game/src/unity-web/stationDelta.ts`.
- **Retained view families**: Local delta staging covers cells, independent
  static equipment (`StationEquipmentModuleRenderer`), straight fences/trees
  (`OutdoorModuleRenderer`), openings (`gate`, `door`, `cubicle` in
  `OpeningModuleRenderer`; `platform-edge`/`psd-end` keep conservative fallback),
  authored road networks + ambient road traffic (`StationLocalEdit.TryApplyRoadSet`
  + `StationRoadRenderer.TryStageLocalDelta`), equipment contact shadows
  (`StationContactShadowRenderer`), and zone overlay bands
  (`StationZoneMap.FloorsAt` + `CachedZoneBand` in `StationOverlayRenderer`).
  On shipped `zoo.metro.json` (4,299 modules, 7 renderers, Unity 6000.6.8f1
  `-nographics` EditMode `StationRoadDeltaPerfTests.MeasureRoadPreviewCommitEraseAndUndoOnZoo`,
  1 warmup + 3 trials), moving roads from full-save rebuild to incremental local
  delta cuts median road add from `731.97 ms → 47.84 ms` (15.3×), erase from
  `737.57 ms → 52.04 ms` (14.2×), undo erase from `561.27 ms → 49.36 ms`
  (11.4×), undo add from `557.75 ms → 53.33 ms` (10.5×), and preview from
  `10.93 ms → 2.86 ms`, shifting `local_edits/full_edits` from `0/12 → 12/0`.
- **GPU instancing & train compaction**: Grade `lawn`/`sidewalk` tiles, static
  equipment (`64 × 64 m` spatial chunks, `BatchThreshold = 6`), and straight
  fences/trees batch via `StationInstancedSurfaceBatch`
  (`Graphics.DrawMeshInstanced` in ≤ 1,023 slices) with instanced triangle
  picking and `HideSource`/`UnhideSource` carry hiding.
  `TrainConsistViews.CompactConsistInstance` compacts static car and gangway
  bodies per `(formationKey, part)` while preserving all `TrainDoorRig` leaves,
  material slots, glass, and signage.
- **Incremental visibility (`StationVisibility.cs`)**: `ApplyLevelChange` uses
  occupied-level counters, palette-generation-cached `Material[]` arrays,
  unchanged `renderer.enabled`/`collider.enabled`/`sharedMaterials` write
  suppression, and single-level target indexing to visit only affected storey
  bands on Q/E switches. Unchanged accepted `view.set level` commands no-op
  without running `Visibility.Apply` or `RefreshHover`.

## Crowds, displays & exploded view memory

- **Crowd animation (`PassengerCrowdView.cs`)**: Sets fixed `localBounds` with
  `updateWhenOffscreen = false`, skips `SampleAnimation` on hidden storeys and
  unchanged `(ClipName, ClipTime)`, distance-quantizes PlayMode skeletal
  sampling beyond `45 m` / `85 m`, and suppresses redundant `Transform` writes.
- **Live clocks, TVs & signs**: `StationClockArtwork` shares one digital clock
  texture per world and skips unchanged analogue hand rotations;
  `StationDisplayTvArtwork` skips hidden faces, budgets PlayMode paints
  round-robin (`4/frame`), and evicts unused plate textures above `64`;
  `StationSignTextureCache` drains a FIFO decode queue at up to `4/frame` in
  PlayMode and drops stale responses before PNG decode.
- **Exploded view (`StationExplodedTrayBuilder.cs`, `StationExplodedView.cs`)**:
  Borrows the active `StationFinishLibrary`, builds only service-track consists
  using `CompactConsistInstance`, keeps `StationInstancedSurfaceBatch` props
  GPU-instanced with zero-allocation tray-drag offset tracking, lazily clones
  selection-tint materials on demand, pauses hidden editor frame sinks
  (`IStationActiveDuringExplodedView`) and instanced drawers while open,
  releases temporary build tables on completion, and clears native mesh buffers
  synchronously on close (plus `GC.Collect()` on WebGL close).

## WebGL memory & Cloudflare packaging

- **Wasm32 4 GiB ceiling**: `webGLMaximumMemorySize` stays pinned at `4096`
  (`unity/ProjectSettings/ProjectSettings.asset`, effective ceiling ~4,080 MiB).
  Never raise above `4096` (triggers Emscripten memory64/`BigInt` startup
  failure).
- **Low-memory WebGL open/save**: Single-pass streaming `JsonTextReader` load
  (`StationDocumentStreamingReader.cs`) with interned cell strings/tags/`CompactStringMap`
  finishes and canonical on-demand `RawJson` synthesis (zero full-save `JObject` DOM),
  deferred `TrainCatalogue` staging (`BuildWeb.cs` → `Resources/MetroWebTrains`),
  lazy cell picking (`StationCellViewRequest.LazyPickGeometry` with 32-chunk LRU cache
  and reusable upload buffers), deferred `StationWalkGraphScratchPool` allocation for
  stations ≥ 16,384 walk nodes, frame-yielded `OpenYielded` pre-read visual release
  whenever `IsLargeStation(document) || json.Length >= 4_000_000`, skipped throwaway
  `station.resync` on WebGL `/game/unity/benchmark`, streamed 16 KiB SHA-256
  (`HashEnvelope`), and 32 KiB batched WebGL commit/save envelopes (`StationGame.jslib`).
  On Tianhe Park WebGL (`?metroLoadProbe=1`), this cuts native reserved at load start from
  `1,553 → 680 MiB`, live managed heap after parse+index from `702 → 278 MiB`, after
  world build from `946 → 341 MiB`, and after simulation stage from `1,141 → 504 MiB`,
  passing all 30/30 Tianhe WebGL benchmark combinations (`regular` + `explode`, all
  3 detail tiers × 5 FSR modes) on attempt 1.
- **Brotli deploy bundles** (`tools/unity-web/stage-deploy.mjs`,
  `local-worker.mjs`, `unity/wrangler.jsonc`): Stages only public
  `StationGameLocal.unity` packs (rejecting local-only `StationGameLocalWeb*`
  passenger scenes), Brotli-compresses split `.wasm`/`.data` files into
  `≤ 20 MiB` `.brpartN` chunks (within Cloudflare's 25 MiB per-asset and 100 MB
  response limits), and pipes them zero-copy via `FixedLengthStream` under
  `/game/unity/*` (including `/game/unity/benchmark` and
  `/game/unity/benchmark/en`).

## Windows standalone `.exe` & in-app benchmark

- **Deferred train loading (`BuildWindows.cs`, `BuildWeb.cs`)**: Both Windows
  (`Resources/MetroWindowsTrains`) and WebGL (`Resources/MetroWebTrains`) builds
  stage a `TrainCatalogue` backed by `Resources` paths so the 50 formations load
  on demand (and release via `TrainCatalogue.ReleaseDeferredPrefabs()` between
  large stations) instead of stalling initial scene preload; the authoring scene
  and catalogue retain direct references.
- **Single-file portable build**: `npm run build:unity:windows` builds an
  isolated Win64 `Release` player + `MetroEditorWebView.exe` +
  `game/dist-unity-ui` and packs `.preview/unity/StationDesigner.exe`
  (`-benchmark` launches directly to `/game/benchmark`).
- **Native frame recorder (`StationBenchmarkRecorder.cs`)**: Handles
  `benchmark.mode`, `benchmark.start`, `benchmark.stop`, and `benchmark.info`,
  recording Unity `Time.unscaledDeltaTime`, simulation ticks, `Total Used Memory`
  (`ProfilerRecorder`), and `SystemInfo` hardware facts so desktop standalone
  and Editor runs measure native D3D11/D3D12/Vulkan pacing instead of WebView2's
  offscreen `requestAnimationFrame` cadence.

## Simulation parity

- **Sparse hierarchical routing** (`StationSparseRouter.cs`,
  `StationServiceRuntime.cs`): Shares the web `ReverseCoarseTree` region
  search, field-free `excludedServer >= 0` region A*, `16 MiB` reverse-field
  LRU, and same-tick cold-field warmup in `StepSparseRouting`. Legacy fallback
  paths retain stale heap pop skipping, flat congestion caching, and
  lift-inclusive Union-Find reachability (`StationRoutePlanner.cs`).
- **Road traffic scaling** (`StationRoadLayout.cs`, `StationRoadTraffic.cs`):
  Matches web lane-scaled signal greens and capacity-metered arrival scheduling
  (pinned by `StationRoadTests`).
