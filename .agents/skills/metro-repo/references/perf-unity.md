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
- **Retained view families & incremental topology**: Local delta staging covers
  cells (with single-pass `RampSlopeCutsCore` / `PreparedRampOpenings.SlopeCuts`,
  bounded AABB + `onlyExtraRuns: true` in `StationRampCarve`, bounded thin-side
  lookup, and moved-edge `GroundWindow` diffing), signs (`StationSignView` inline
  `StationSignRepair.NormalizeJson` without full-doc fallback), structural
  modules (`pillar`, `roof`, `hanger` + indexed `StationBridgePillars` column
  Z-probe invalidation), rails and trains (`track`, `platform-edge`,
  `StationRailPlanner` `ModulesOfType("track")` + `CollectModulesOnDigCells` /
  `CollectStaticGroundHoles`, `StationTunnelShell` O(1) cell lookup,
  `ModuleConfig.Bool` `"1"`/`"0"` bridge parsing, `TrainBerthRefreshStage`
  fast-path consist matching, and incremental `TrainConsistRenderer.StagedTrainDelta`
  reusing cached livery/body geometry for added consists), openings (`gate`, `door`,
  `cubicle`, `psd-end`, `psd-end-cover`),
  exits (`VerticalModuleViews` landing-height invalidation + exit-filtered ramp
  re-projection), displays/glass/booths/guideposts (`tv`, `calligraphy`,
  `linemap`, `glass`, `booth`, `guidepost` with idempotent artwork `Bind`/`Unbind`
  and shared `TouchedCeilingColumns`), 16 m chunk-indexed surface modules
  (`StationSurfaceModuleRenderer`), 64 × 64 m chunked static equipment
  (`StationEquipmentModuleRenderer` delta patching), 64 × 64 m spatial-chunked
  equipment contact shadows (`StationContactShadowRenderer` delta matrix
  updates), straight fences/trees (`OutdoorModuleRenderer`), authored road
  networks + ambient road traffic (`StationLocalEdit.TryApplyRoadSet` with
  semantic `RoadRecordUnchanged` diffing, `StationRoadComponents.Partition`
  connected-component partitioning, and component-scoped
  `StationRoadRenderer.TryStageLocalDelta` / `RoadVehicleViews.BuildMultiComponent`),
  and zone overlay bands (`StationZoneMap.FloorsAt` + `CachedZoneBand` in
  `StationOverlayRenderer`). On the simulation side, `StationSparseTopology`
  uses jagged `int[][]` adjacency with O(|dirtySectors|) `TryUpdateIncremental`
  and `OldToNewNode` claim remapping, `StationSimulationSession` uses
  `AppendOnlyModules`/`InPlaceUpdateOnly` fast paths avoiding 76k-module scans,
  and `game/src/unity-web/stationBridge.ts` `reduce()` folds `payload.edit`
  immediately on `kind === "ack"`.
  On shipped `zoo.metro.json` (4,299 modules, 2 disconnected road networks, Unity
  6000.6.8f1 `-nographics` EditMode
  `StationRoadDeltaPerfTests.MeasureRoadPreviewCommitEraseAndUndoOnZoo`,
  1 warmup + 3 trials), moving roads from full-save rebuild to component-bounded
  incremental local delta cuts median road add from `731.97 ms → 43.44 ms`
  (16.8×), erase from `737.57 ms → 54.38 ms` (13.6×), undo erase from
  `561.27 ms → 55.63 ms` (10.1×), undo add from `557.75 ms → 55.20 ms` (10.1×),
  and preview from `10.93 ms → 2.90 ms`, shifting `local_edits/full_edits` from
  `0/12 → 12/0` while rebuilding only `1/2` road components (`rebuilt_roads=1,
  retained_roads=1`). On a 4-network disconnected road fixture (8 roads across 4
  crossed networks, `MeasureBoundedComponentRoadPerfOnDisconnectedNetworks`,
  1 warmup + 5 trials), single-network edits stay bounded to `1/4` components
  (`rebuilt_roads=2, retained_roads=6`) with `preview=0.13 ms`, `add=28.97 ms`,
  `erase=25.13 ms`, `undo_erase=28.26 ms`, `undo_add=27.63 ms`.
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
- **Measured Tianhe Park 102-object placement & pick latency (`e527757c`, `high` / `native` FSR, `0×` & `1×`)**:
  Full matrix in [perf-tianhe-object-latency.md](perf-tianhe-object-latency.md).
  All **99/99** Unity-supported objects stay on the local retained-view path
  (**0** full fallbacks, **0** WebGL WASM OOMs — previously 25 fallbacks on
  `.exe` and 2 deterministic WASM OOMs on `sign-ceiling`/`sign-wall`), with
  **0 items > 500 ms** (and **0 items > 300 ms**) across both `.exe` and WebGL,
  beating Web Three.js on Mean, P90, P95, and Max:
  - **Unity Desktop `.exe` (Mono, D3D12)**: Paused `0×` P50 **`48.1 ms`** (was
    `441.1 ms`), Mean **`61.8 ms`** (was `1,982.9 ms`), P90 **`101.9 ms`** (was
    `6,517 ms`), P95 **`127.0 ms`**, Max **`237.7 ms`** (was `9,586 ms`); Live
    `1×` P50 **`52.5 ms`**, Mean **`66.2 ms`**, P90 **`109.2 ms`**, P95
    **`157.4 ms`**, Max **`271.4 ms`**. Former `> 500 ms` cases dropped to
    `bridge` (`52.4 / 65.0 ms`), `stair-left90` (`95.8 / 109.2 ms`),
    `stair-straight` (`102.9 / 99.7 ms`), `escalator` (`113.3 / 172.1 ms`),
    `tunnel` (`202.4 / 192.3 ms`), and `platform` (`237.7 / 271.4 ms`).
    Real-click pick host `ack` is `20.6–21.6 ms` (Eyedropper/Select) /
    `39.7–42.9 ms` (Move) median, with React UI adoption cut from ~`95 ms` to
    `46.7–48.9 ms` median via `ack`-folded `payload.edit`.
  - **Unity WebGL (IL2CPP WASM, ANGLE D3D11)**: Paused `0×` P50 **`69.8 ms`**
    (was `261.2 ms`), Mean **`75.5 ms`** (was `1,458 ms`), P90 **`102.3 ms`**
    (was `5,408 ms`), P95 **`128.6 ms`**, Max **`174.1 ms`** (was `5,865 ms` +
    2 OOMs); Live `1×` P50 **`80.1 ms`**, Mean **`86.0 ms`**, P90 **`113.3 ms`**,
    P95 **`137.3 ms`**, Max **`182.0 ms`** (`bridge` `68.2 / 72.7 ms`,
    `stair-left90` `97.8 / 106.7 ms`, `stair-straight` `98.8 / 103.0 ms`,
    `escalator` `128.6 / 113.1 ms`, `tunnel` `156.8 / 179.2 ms`, `platform`
    `167.6 / 158.7 ms`; `sign-ceiling` and `sign-wall` commit locally in
    `74.3–107.5 ms` with zero OOMs).
  - `exit-doorway-1`, `exit-virtual`, and `traffic-light` still return
    `no-candidate` in `StationModuleFamilies.TryParse` (parity gap).

## Crowds, displays & exploded view memory

- **Desktop standalone simulation worker & hot loops (`StationLoadCoordinator.cs`, `StationServiceRuntime.cs`, `SessionPassengerFeed.cs`, `StationStatisticsFeature.cs`, `StationGameHost.cs`)**:
  On Windows standalone (`#if !UNITY_WEBGL`, opt-out via `-metroSimSync`), `StationSimulationHost`
  runs `StationSimulationSession.Advance` on a dedicated background worker thread and publishes
  lock-free immutable `StationPublishedSimFrame` snapshots (including crowd counters and reused
  immutable `StationPublishedStatistics` snapshots) with a synchronous edit/command barrier.
  10 Hz `PublishStateNow()` reads `PublishedFrame` lock-free across `StationCrowdStateContributor`,
  `StationStatisticsStateContributor`, and raw contributor caches (never blocking on `sessionLock`),
  and ambient audio streams directly via `JsonTextWriter` while suppressing duplicate silent frames.
  `StationServiceRuntime` uses flat stamped 3D cell grids (with lossless dictionary overflow fallback)
  for `PriceCrowd` and `SeparateWalkers`.
- **Crowd animation & SRP batching (`PassengerCrowdView.cs`)**: Sets fixed `localBounds` with
  `updateWhenOffscreen = false` and `shadowCastingMode = Off` (covered by instanced contact shadows),
  caches `PassengerAppearance.Look`, resolved `(clipName, AnimationClip, length)`, and static
  `PassengerSupportResolver` cell queries (zero-alloc `SupportCellKey`), hoists camera LOD
  parameters, runs pure-managed 6-plane frustum culling **before** Transform writes / LOD / tone /
  clip work (suppressing offscreen draws via `Skin.forceRenderingOff` so `StationVisibilityTarget`
  eligibility is never poisoned), aligns adjacent tick poses via O(N) two-pointer merge with
  reusable list rotation (zero per-tick dictionary copies and zero per-frame dictionary lookups),
  replaces per-actor `MaterialPropertyBlock`s with bounded 20-step shared toned materials
  (preserving exact `0.35`/`0.25` Ghost/Clear alpha on SRP Batcher), and applies a globally shared
  96-sample/frame steady `SampleAnimation` budget.
- **Live clocks, TVs & signs**: `StationClockArtwork` paints 7-segment LED digits on the CPU into
  one reused `Texture2D` per scope with a cached per-day calendar strip and lightweight
  `ClockSnapshot()`; `StationDisplayTvArtwork` / `StationTvPlatePainter` pools an isolated offscreen
  camera/canvas plus a bounded `(width, height)` `RenderTexture` pool (`MaxPooledPlateTextures = 16`)
  and GPU-copies depth-capable `RenderTexture`s (zero `ReadPixels()` in PlayMode), skips hidden
  faces, budgets PlayMode paints round-robin (`4/frame`) exclusively inside `Advance()` (PlayMode
  `StateContributor.BuildPayload` defers repaints instead of triggering unbounded synchronous
  full-station repaints on 10 Hz publishes, and raw `"displays"` caching keys on `PublishVersion`),
  and returns evicted plate textures above `16`/`64` to the RT pool; `ModuleMotionDispatch` makes
  displacement probing opt-in (`MeasureDisplacement = false` on runtime sinks), caches per-tick
  frame indices and swing-door targets, and dirty-skips unchanged or hidden bindings (same for
  `VerticalModuleRenderer.ApplyAll`).
- **Desktop URP, escalator instancing & static batching (`StationGameHost.cs`, `VerticalModuleViews.cs`, `OpeningModuleViews.cs`, `StationPrefabBatch.cs`, `StationModuleGroups.cs`)**:
  Standalone desktop runtime disables `supportsCameraDepthTexture`, `supportsCameraOpaqueTexture`,
  and `ScreenSpaceAmbientOcclusion` (skipping the DepthNormals prepass without shader recompilation),
  sets `shadowDistance = 0` / `shadowCascadeCount = 1` (`StationRenderRig` uses `LightShadows.None`),
  disables shadow casting on interior static roles (`openings`, `equipment`, `displays`, `signs`,
  `vertical`) and instanced surface/equipment batches, coarsens surface chunks to `64 × 64`, and
  caps ambient audio publishing to `10 Hz`. `VerticalModuleViews` renders all escalator/walkway
  treads and risers via `EscalatorStepInstancedDrawer` (`Graphics.DrawMeshInstanced`, zero per-step
  `MeshRenderer`s, PlayMode anchor-only `tread-0`/`tread-last`, single zero-triangle proxy renderer
  per band for `StationVisibilityTarget` Base/Ghost/Clear/Hidden/Section parity, pooled meshes, and
  frustum culling). `StationPrefabMeshTemplate` merges same-material child meshes across all Unity 6
  multi-LOD tiers (`lodCount > 1`), `StationInstancedSurfaceDrawer` frustum-culls batches with a
  `0.25 m` margin and caches `enableInstancing`/`lodCount`, `StationEquipmentModuleRenderer` lowers
  `EquipBatchThreshold` to `3` and compacts remaining singletons, and `OpeningModuleViews` merges
  static opaque PSD parts per `(run, material)`, compacts `Gate`/`Door`/`Cubicle` static subtrees,
  and GPU-instances repeated `psd-end:cover` runs (`≥ 128` per band).
  *(Measured negative experiments to keep off: Win64 D3D12 `GraphicsJobMode.Native` caused severe
  sync stalls — 2.91 FPS / 559.6 ms worst on Tianhe Regular Low in `.preview/perf/perf60-pass2-gfxjobs/`;
  `glTF-pbrMetallicRoughness.shadergraph` ships with `m_DOTSInstancing: false`, so URP GPU Resident
  Drawer would skip glTFast renderers.)*
- **Measured Unity Desktop standalone results (3-run median across `.preview/perf/perf60-pass1`,
  `perf60-pass1-rep2`, `perf60-pass1-rep3`; RTX 4080 SUPER, i7-14700KF, Win64 Mono D3D12,
  `1600×900`, 16×, `native` FSR, `477–479` ticks / `12` arrivals per 30 s):**
  - `zoo` Low Regular (pass 1): **173.3 → 216.8 FPS** (1% low **103.8**, worst 33.0 ms)
  - `tanwei` Low Regular (pass 1): **97.3 → 180.4 FPS** (1% low **95.5**, worst 19.1 ms)
  - `tianhe` Low Regular: **25.0 → 73.7 FPS** median (`67.7–78.8`, +195%; 1% low **34.5**, `32.0–38.6`; worst **38.9 ms**, `38.5–45.3`; peak Unity RAM 7.30 → **5.66 GB**, OS WS **4.68 GB** — **≥ 60 FPS / ≥ 30 1% low / < 60 ms target met**)
  - `tianhe` High Regular: **25.5 → 78.5 FPS** median (`68.7–78.6`, +208%; 1% low **39.4**, `32.2–39.5`; worst **38.8 ms**, `37.9–40.6`; peak Unity RAM **5.72 GB**, OS WS **4.71 GB** — **≥ 60 FPS / ≥ 30 1% low / < 60 ms target met**)
  - `tianhe` Low Exploded: **34.5 → 97.7 FPS** median (`87.2–98.0`, +183%; 1% low **46.5**, `42.9–46.7`; worst **30.0 ms**, `29.7–31.5`; peak Unity RAM **3.19 GB** — **≥ 75 FPS / ≥ 35 1% low target met**)
  - `tianhe` High Exploded: **33.9 → 97.9 FPS** median (`87.0–98.0`, +189%; 1% low **47.2**, `40.5–47.6`; worst **30.0 ms**, `29.1–44.3`; peak Unity RAM **3.12 GB** — **≥ 75 FPS / ≥ 35 1% low target met**)
- **Measured Unity WebGL results on the same Plan 38 changes (`b8e8773b`, `pack-20261123184339044`,
  `.preview/perf/plan38-bench-pass3/`, Chrome hardware GPU RTX 4080 SUPER, `1600×900`, 16×, `native` FSR,
  474–479 ticks/30 s; excludes `#if !UNITY_WEBGL` background sim worker, desktop URP tuning, and interior
  shadow-caster toggles):**
  - `zoo` Low Regular: **40.80 → 47.58 FPS** (+16.6%, 1% low 18.72 → 9.89, worst 62 → 206.6 ms, Chrome OS WS 3,562 → 3,198 MB)
  - `tanwei` Low Regular: **26.69 → 35.31 FPS** (+32.3%, 1% low 8.99 → 4.49, worst 143 → 322.1 ms, Chrome OS WS 4,209 → 3,854 MB)
  - `tianhe` Low Regular: **7.78 → 9.07 FPS** (+16.6%, 1% low 3.15 → 2.66, worst 394 → 379.3 ms, Chrome OS WS 5,279 → 5,543 MB)
  - `tianhe` High Regular: **7.74 → 9.03 FPS** (+16.7%, 1% low 3.57 → 2.69, worst 282 → 380.5 ms, Chrome OS WS 5,244 → 5,545 MB)
  - `tianhe` Low Exploded: **10.86 → 16.06 FPS** (+47.9%, 1% low 3.41 → 3.29, worst 313 → 353.7 ms, Chrome OS WS 6,141 → 6,270 MB)
  - `tianhe` High Exploded: **10.97 → 15.90 FPS** (+44.9%, 1% low 3.49 → 3.45, worst 303 → 349.3 ms, Chrome OS WS 5,988 → 6,260 MB)
  *(Note: `zoo` and `tanwei` WebGL runs showed ~8–10 intermittent 100–320 ms frame spikes lowering 1% low
  despite the +17–32% average FPS gain; needs follow-up isolation between `StationTvPlatePainter.PaintRuntime`
  WebGL `RenderTexture` churn and concurrent Plan 39 changes in `b8e8773b`.)*
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
- **Lossless raw-JSON coalesced WebGL autosave (`game/src/unity-web/webglAutosave.ts`, `StationGameHost.cs`)**:
  Splits the complete host `documentText` directly into raw JSON root values
  and ordered raw JSON slices for `cells`, `modules`, and `lines` (never passing
  untouched metadata or records through JS `JSON.parse`/`Number`), and applies
  raw sequential host commit deltas (`changedCellsJson`, `changedCellIndices`,
  `changedModulesJson`, `changedModuleIndices`, `linesJson`, plus editable
  header fields, omitting duplicate parsed record bodies on the wire) while
  gating `CanBuildDeltaCommitPayload()` on
  `StationLocalEdit.CanRepresentHeaderInDelta` and
  `!HasReorderedRecords`. Preserves own root `__proto__` properties, >53-bit
  integer tokens, host-preserved extra fields, and exact host array order across
  additions, in-place edits, deletions, undo, and redo (`ReorderedCells`
  handles grade-hole remove+append in O(|delta|)). Enforces
  `(sessionId, stationEpoch, baseRevision)` sequence coherence and final-sequence
  target-index validation after removals and insertions for both existing and
  inserted raw cell/module records (rejecting impossible, wrong in-range,
  conflicting, or missing indices, discarding failed reconstructions before
  writing, and recovering via `station.resync`).
  Local delta commits never scan or encode synchronously inside `adopt()` /
  `noteCommit()`: full host envelopes are reused directly, delta encoding
  coalesces outside input handling via `requestIdleCallback`/`setTimeout`, and
  `pagehide`, `visibilitychange(hidden)`, `beforeunload`, and interval timers
  retain a synchronous unload-safe fallback without a bridge round trip.
  Replacement commands (`station.openDemo`, `station.open`, `station.new`)
  register intent via `stationBridge.send(..., { beforeSend })` and invalidate
  `AUTOSAVE_KEY` before writing so quota failures never resurrect a stale
  station on reload. On packaged Tianhe Park WebGL (`151,852` cells,
  `16,805,093 B` envelope, headless Chrome SwiftShader, idle machine, 1 warmup
  + 6 local delta `face.paint`/undo/redo edits, 5 cold + 5 prepared `pagehide`
  trials per pack, `writesDuringBurst = 0` across all runs):
  - Plan 39 (`pack-20261123184339044`, UI-projected lossy `serialize(station)`):
    `editToAdopt` median `137.55 ms` (`115.2–212.2`), JS `adopt` median
    `0.80 ms` (max `1.4`), cold `pagehide` median `53.30 ms` (`51.1–89.1`),
    prepared `pagehide` median `12.40 ms` (`8.8–15.2`).
  - Plan 40 (`pack-20261123190031490`, `JSON.parse`/`stringify` envelope):
    `editToAdopt` median `128.35 ms` (`112.5–167.0`), JS `adopt` median
    `0.70 ms` (max `6.9`), cold `pagehide` median `104.70 ms` (`101.8–119.9`),
    prepared `pagehide` median `11.80 ms` (`9.7–14.7`).
  - Plan 41 (`pack-20261123211811350`, raw-JSON lossless + exact host order):
    `editToAdopt` median `115.65 ms` (`110.1–139.7`, vs `362.45 ms` synchronous
    pre-Plan-39 baseline), JS `adopt` median `0.70 ms` (max `5.6`, vs `73.20 ms`
    synchronous baseline), cold `pagehide` median `116.80 ms` (`114.9–118.6`),
    prepared `pagehide` median `10.70 ms` (`10.5–11.1`).
  - Plan 42 (`pack-20261123220057312`, raw-JSON lossless + final-position
    validation + FIFO adoption-gated queue): `editToAdopt` median `116.65 ms`
    (`110.2–160.4`), JS `adopt` median `0.70 ms` (max `1.3`), cold `pagehide`
    median `110.00 ms` (`108.6–115.4`), prepared `pagehide` median `9.70 ms`
    (`9.3–10.5`).
  - Quota outcome (separate from successful persistence): all `10/10` Tianhe
    flushes per pack generated valid `16.8 MB` envelopes (`16,805,127 B` on
    Plan 41 & Plan 42) and hit Chrome's 5 MB `localStorage` `QuotaExceededError`
    cleanly (`0/10` persisted, no uncaught error); successful persistence, quota
    retry, invalid-position rejection + resync recovery, and byte-identical
    reload were verified separately on the smaller `Plan42Fixture` station.
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
