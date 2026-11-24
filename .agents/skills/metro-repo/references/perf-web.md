# Web Three.js performance contracts

Active performance invariants for the Three.js / Web Worker game (`game/`).
See [performance.md](performance.md) for measurement rules and geometry
inventories, and [perf-benchmarks.md](perf-benchmarks.md) for commands.

## Interactive editing, picking & previews

- **Response budget**: Editor feedback targets strictly `< 100 ms` (`100 ms`
  misses). Track API-to-render, two-RAF, GPU completion, and worker installation
  separately. Run `npm run bench:editor-actions` (see
  [perf-benchmarks.md](perf-benchmarks.md)) for per-action captures under
  `.preview/perf/editor-actions/`. For real-click full-catalog placement and
  pick latencies on Tianhe Park (`high` / `native` FSR, `0×` & `1×`: `102/102`
  objects OK, P50 `155–169 ms` click→render, P95 `374–386 ms`, 4 outliers
  `> 900 ms`: `block/auto-walls`, `wall`, `checkout`, `checkout-cafe-pastry`;
  pick P50 `31–33 ms` eyedropper/select, `66–68 ms` move), see
  [perf-tianhe-object-latency.md](perf-tianhe-object-latency.md).
- **Single scene pick**: Resolve at most one scene raycast per pointer event and
  share it across tools, surface aims, selection, and audio
  (`check-tool-picking.mjs`, `check-geometry-snapping.mjs`).
- **Preview isolation**: Reuse bounded preview materials and geometry. Schedule
  expensive drag previews on a 50 ms latest-target cadence (`MultiPlaceDrag` /
  `StablePreviewDelay`), and keep refused previews refused until footprint or
  inputs change.
- **Drag footprint cap**: Multi-cell drags cap at `MAX_DRAG_CELLS = 10,000`
  cells including walls (`game/src/sim/constants.ts`). Count and refuse
  oversized gestures whole before allocating footprints; commit accepted edits
  only and never scan all equipment per candidate tile.
- **Build-rail thumbnails**: Serve checked-in, lazy-loaded 132 px PNGs from
  `game/public/module-thumbnails/` (`npm --prefix game run render:menu-thumbnails`).
  Never render thumbnails with WebGL at startup.

## Document state, undo & derived indexes

- **Derived-index lifecycle** (`game/src/sim/documentCaches.ts`): Station-sized
  derived indexes (collision bodies, ceiling support, blocked levels, ground
  windows, fence joints, road networks, outdoor surfaces) live in `WeakMap`s
  keyed by immutable `cells` / `modules` arrays and register with
  `registerDocumentCache`.
- **Retire on history push**: `StationSlice` calls `forgetDocumentCaches` on
  commit, undo, redo, new station, load, and autosave restore so retained undo
  frames keep only immutable records (rebuilding indexes lazily if undone) while
  arrays shared with the live document stay cached. Any new station-sized
  `WeakMap` cache must register with `registerDocumentCache`.
- **Local structural work**: Authored-cell carve/thinning queries nearby runs in
  document order; stair models probe the shared cell index; rail validation and
  platform-edge derivation prepare only needed courses; suspended ceilings
  invalidate locally; large documents send compact worker splices applied to the
  newest snapshot while keeping the active sim graph coherent until install.

## Scene batching, retention & textures

- **Cross-module equipment batches** (`game/src/render/equipmentBatches.ts`,
  `materialCanonical.ts`): Static equipment batches into spatial tiles (`16 m`
  High, `64 m` Low, `256 m` dense Low when `modules >= DENSE_STATION_MODULES =
  20,000`) with value-canonicalized untextured static materials (resolving each
  bucket's material from its live surviving sources—single owner uses its own or
  live atlas material, multi-owner buckets use a batch-owned canonical material
  with synchronized clipping planes in `SectionSystem.applyClip`; sorted
  transparent buckets in `EquipmentBatches` may canonicalize normal-blended
  transparent materials because `sortedBatch`/`sortedEquipmentGeometry` sort per
  surface), bounded view caching (`EQUIPMENT_VIEW_CACHE_SIZE`), cached
  static-transparent draw sorting (`cacheBatchOrder`), and deterministic
  `lastSync` work counters pinned by `batching-lifecycle.test.mjs`. Unchanged
  buckets retain GPU allocations; shrinking below the merge threshold restores
  surviving sources to layer 0.
- **Panel atlas & budgeted TV repaints** (`game/src/render/panelAtlas.ts`,
  `PlateSystem.ts`, `ModuleSystem.ts`): Releasing a deleted panel returns its
  rect to the page free list without invalidating surviving roots' UVs (only
  dormant storey views drop). `PlateSystem` caches TV coordinates and
  per-service status keys and drains coalesced dirty TVs at 1 panel/frame
  prioritizing visible modules via `ModuleSystem.moduleRootsById` O(1) live
  ancestor visibility checks (zero root array scans as station size grows). Live
  atlas panels compare dirty pixel bounds, upload at most one changed live panel
  per frame, retain CPU pages for context restoration, and request frames until
  pending uploads drain.
- **Outdoor paving instances** (`game/src/render/surfaceBatches.ts`): `lawn` and
  `sidewalk` tiles draw directly from the document via `StaticInstances` in
  `64 m` buckets (`SURFACE_BUCKET_SIZE = 64`) per finish and storey, resolving
  picks through `hit.instanceId` with no per-tile mesh or contact blob.
  `ModuleSystem` must not route paving through `EquipmentBatches`.
- **Placement & presentation retention**: Retain unaffected module roots,
  animation registrations, and Low geometry via immutable inputs and complete
  dependency keys. City switches repaint cab decals in place, replace
  city-specific exit/pylon/map roots, cache map artwork by city, decode city
  posters lazily on demand (sharing pending requests), and retain train roots.
  Ordinary label edits repaint retained artwork; invisible settings do not dirty
  geometry or trigger a render.
- **Contact shadows**: Only floor-standing equipment on the active storey
  allocates contact blobs (`contactShadowVisible`); ceiling fixtures and fixed
  PSD infill/covers allocate none.

## Level slicing, LOD & opening deferral

- **Level slicing** (`game/src/render/levelSlicing.ts`, `detailPolicy.ts`):
  - `显示其他层` OFF draws only the active storey at any camera angle.
  - `显示其他层` ON hides every storey above an occupied active storey
    (`SliceOptions.hideAbove`, derived from chunk meshes excluding generated
    street passes). An empty active storey still ghosts upper storeys, where
    `隐藏天花板` lifts ceilings while preserving unsupported plates.
  - On dense stations (`DENSE_STATION_MODULES = 20,000`), below-storey ghosting
    is bounded to the immediate neighbouring storey (`boundedLevelVisible`).
  - `隐藏UI` and `剖切` bypass slicing and draw all storeys with base materials.
- **Geometry detail** (`detailHeight` in `game/src/render/detailPolicy.ts`):
  Low quality renders authored Low geometry everywhere; High renders full detail
  on the active storey (and everywhere under `隐藏UI`) and steps non-active
  storeys down to Low. Trains share one prepared near/far swap per piece and
  keep moving door banks and sorted glass intact (`train-lod.test.mjs`). On
  dense Low stations with `KHR_parallel_shader_compile`, compile at most one
  newly visible train per frame using its actual draw meshes.
- **Deferred opening preparation** (`game/src/render/scene/SceneRenderer.ts`):
  `scheduleFleetPreparation` defers bounded train fleet preparation via
  `requestIdleCallback` (2 s timeout; `setTrains` builds on demand if needed),
  and `Viewport` chains Q/E neighbour prewarm after the first painted frame
  (`onNextFrame`). Account for post-first-frame work when measuring first pan,
  edit, or storey switch.
- **Render scaling** (`game/src/render/upscaling.ts`): Supports `native` (`1`),
  `ultra` (`1/1.3`), `quality` (`1/1.5`), `balanced` (`1/1.7`), and
  `performance` (`0.5`).

## Exploded view handoff

- **Single resident renderer**: Opening exploded view tears down the editor
  `SceneRenderer` so both full renderers do not remain resident simultaneously;
  closing rebuilds the editor renderer.
- **Structure-first streaming**: Presents the structural frame (`data-ready`)
  first, then streams equipment batches (`data-equipped`), skipping batches
  hidden by rigid trays, consolidating cross-stage **opaque** untextured
  materials, identical-content `InstancedMesh`es (`geometryKey`), and **opaque**
  `PanelAtlas` faces with `matrixAutoUpdate = false` (preserving independent
  draw boundaries for transparent untextured and textured surfaces so two-sided
  orbits maintain exact blend order), initializing deferred wall meshes from
  each floor's current `wallsVisible` setting before attachment, bounding
  temporary merge inputs at 131,072 vertices or 1,024 meshes, and flushing
  deferred buckets incrementally in `6 ms` slices (`flushPendingStep`).
- **Zero-rewrite drags**: Floor drags translate tray groups without extra picks,
  document commits, or vertex rewrites.

## Simulation: worker transport, collision/congestion & sparse routing

- **Worker transfers & on-demand density** (`game/src/sim/worker.ts`,
  `protocol.ts`, `SimSlice.ts`): Transfers message-owned `agents`, `trains`,
  `lifts`, `history`, `route`, and demanded `density` buffers zero-copy. Every
  `init` and topology rebuild publishes a fresh `ready` graph carrying monotonic
  `stationGen` and `graphRev` before its first density sample; the consumer
  clears stale overlays on station switch or graph replacement and consumes
  density only when both identifiers match (including on renderer recreation).
  Per-node LOS `density` is only allocated and transferred while `densityDemand`
  is active; enabling it while paused posts a density-only message (leaving
  poses, interpolation origin, metrics, history, and route preview intact), and
  during playback attaches density to the next scheduled `state` tick.
- **Stamped collision, density & congestion grids** (`game/src/sim/world/World.ts`):
  Uses per-tick stamped cell linked lists (preserving exact ascending agent
  traversal order), occupied-cell density evaluation, and precomputed CSR
  `cellNodes` touched-cell congestion pricing for bit-for-bit exact replay.
- **Presentation hot loops** (`CrowdSystem.ts`, `EscalatorModel.ts`,
  `LiftSystem.ts`, `ClockSystem.ts`): Spatial 2 m grids accelerate
  `detectGateCrossings`; crowd and escalator instance matrices write directly
  into `instanceMatrix.array`; hidden/standalone escalators and omitted Low
  sub-meshes skip matrix uploads while accumulating `phase` and resyncing newly
  drawable parts (including while paused on reveal or Low→High switches) before
  submission; settled lift poses skip writes; `ClockSystem` tracks per-rig
  applied `(seconds, calendar)` state so replaced placed or hover-preview clocks
  initialize on their first frame while unchanged rigs skip redundant writes.
- **Sparse hierarchical crowd routing** (`game/src/sim/sparseRouter.ts`,
  `sparseConstants.ts`): Uses `16 m` sectors (`SPARSE_SECTOR_SIZE = 16`),
  rolling 16-step local horizon (`SPARSE_WALK_HORIZON = 16`, refill at `4`),
  soft claims (`SPARSE_CLAIM_TTL_TICKS = 4`), and a `16 MiB` reverse-field LRU
  cap (`SPARSE_FIELD_CACHE_MAX_BYTES`).
- **Arrival-wave departure**: Shared field-free region-level `ReverseCoarseTree`
  searches per `(goalRegion, effNeeds)`, field-free region-level forward A* for
  `excludedServer >= 0` probes, fresh-snapshot arrival-wave sharing in
  `World.startLeg`, and mandatory tick budgets (`96,000` pops / `384,000` scans)
  keep post-alighting PSD departure immediate (Tianhe Park pins: Line 11 p90 ≤ 2
  / max ≤ 3 ticks, Line 13 p90 ≤ 2 / max ≤ 4 ticks, `fieldBuilds < 1,500`, zero
  fine-recovery fallbacks).
- **Road traffic scaling** (`game/src/sim/roadNetwork.ts`, `roadTraffic.ts`):
  Controlled junction green phases scale with approach lane count
  (`ROAD_SIGNAL_GREEN + (lanes - 2) * 4` s around the 2-lane baseline), and
  `trafficSchedule` meters entry spawn periods and initial spacing by downstream
  junction capacity and feeder count. Ambient traffic uses the road/signal
  registry, bounded instanced vehicle pools, and fixed simulation steps even
  while the street storey is hidden.

## Measured Tianhe Park playback (`bench-sim-stalls.mjs`, hardware ANGLE D3D11)

Captured serially with the same upgraded `tools/bench-sim-stalls.mjs` runner on
`NVIDIA GeForce RTX 4080 SUPER` / `Intel Core i7-14700KF`, `HeadlessChrome/157.0.0.0`,
`1600×900`, DPR 1, 60 Hz display, 16× speed (`base`: clean `HEAD` `b8e8773b` vs
`cand`: current tree; raw captures under `.preview/perf/threejs-tianhe/{base,cand}-*.json`).
Tianhe rows report the **3-run median**; steady state is the pre-chosen `16–30 s`
window after dense opening/staging completes (`structureReadyMs` and
`equipmentReadyMs` captured separately).

- **Fixed-tick visible workload match (`tick = 460`, identical camera):**
  - Regular Low & High (`base` = `cand`): `population = 2,212`, `trainArrivals = 12`,
    `agentCount = 2,219`, `trainGroups = 8`, camera `[185.47, -159.96, 75.47]` → `[85.5, -40.0, -9.5]`.
  - Exploded Low & High (`base` = `cand`): `population = 2,212`, `trainArrivals = 12`,
    `agentCount = 1,989`, `trainGroups = 6`, camera `[447.68, -296.01, 244.30]` → `[148.5, 63.0, -10.0]`.
- **Source-to-frame publication check (Tianhe 30 s at 16×, expected `480 ± 1` ticks):**
  `base` completed `483` ticks (`484` delivered snapshots, `19–36` consumer gap
  misses); `cand` completed `484` worker ticks at the source with **`0` worker timer
  misses** across all 12 Tianhe runs (`485` delivered snapshots, `maxTickLag = 0`,
  median delivery lag `8.1–31.4 ms`, median render lag `38.5–54.3 ms`).
- **Fixed-seed exact replay (`HEAD` `b8e8773b` vs current across live edit, undo,
  redo & both Tianhe departure waves, 480 ticks, 3,570 agents, 24 arrivals):**
  `46.22 → 28.65 ms/tick` (-38.0%), 100% bit-for-bit exact match on all 4
  checkpoints (`agentsHash`, `trainsHash`, `liftsHash`, `historyHash`,
  `nodePopHash`, and all metrics).
- **Peak-crowd paused camera orbit (Tianhe Regular Low, 1,473 agents):**
  `57.0 FPS` avg (`p50 16.9 ms`, `p95 20.0 ms`, worst `32.7 ms`); paused density
  overlay toggle delivered without advancing `tick` (`162 → 162`).
- **Tianhe Exploded repeated open/close recovery (2 cycles, Low, `0` errors):**
  Editor renderer released on open (`editorReleased: true`), ready `12.8 / 12.1 s`,
  equipped `21.9 / 21.4 s`, close `13.3 / 12.0 s`, steady CDP JS heap `398.1 → 417.4 MiB`
  open and `757.4 → 776.8 MiB` after return.
- **Tianhe 1× presentation check (15 s, Regular Low):** `p50 16.9 ms` (`rAF p50
  17.2 ms`), `p95 29.3 ms`, `15` completed worker ticks / `0` worker timer misses /
  `16` delivered snapshots, worker `8.2 ms/tick`, `1,757` draws, `6.90 GiB` peak WS.
- **Editor feedback vs worker graph install (Tianhe, High, `bench-editor-actions.mjs`):**
  `preview` (`23.1 ms` gate, `56.3 ms` fence), `pickup` (`46.8 / 46.0 ms`), and
  `move-preview` (`84.3 / 77.6 ms`) pass `< 100 ms`; full 76k-module `place`
  (`325.3 / 245.4 ms`), `drop` (`311.3 / 372.1 ms`), and `delete` (`227.7 /
  192.6 ms`) remain bounded by `modules.buildModules` + `syncBatches`, separate
  from async worker graph installation (`2,365 ms` off-main-thread).

### Tianhe Park 3-run median (`base` `b8e8773b` → `cand`, 30 s at 16×)

| Case | Full 30 s sub / rAF FPS (1% low) | Steady (`16–30 s`) sub=rAF FPS / 1% low | Steady `p50 / p95 / p99 / worst` (ms) | Draws | Struct / Equip ready (s) | Steady CDP JS / Peak JS / Peak WS / Peak Priv | Worker ticks / misses / `tickMs` / lag (del/ren p50) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Regular Low** | 20.0→**27.9** / 21.7→**29.6** (0.5→0.7) | 38.4→**50.6** / 17.3→**20.2** | 24.5→**17.0** / 38.7→**35.0** / 53.5→**47.3** / 65.5→**55.5** | 2,827→**1,714** | 4.7→4.7 / 16.8→**16.2** | 616→736 MiB / 4.23→4.39 / 7.85→**7.67** / 10.16→**10.10** GiB | 483→484 / **0** (17 cMiss) / 54.3→**23.8** ms / 14.5 / 40.9 ms |
| **Regular High** | 10.0→**11.7** / 11.7→**13.4** (0.3→0.3) | 19.0→**21.5** / 10.8→**12.1** | 53.7→**39.8** / 72.3→**63.6** / 78.0→**72.0** / 102.2→**101.3** | 6,315→**5,456** | 4.7→4.8 / 17.4→**17.1** | 644→832 MiB / 3.99→4.04 / 8.47→**8.06** / 11.11→**10.78** GiB | 483→484 / **0** (30 cMiss) / 54.0→**23.8** ms / 31.4 / 54.3 ms |
| **Exploded Low** | 25.3→**44.5** / 25.3→**44.5** (2.0→**2.5**) | 25.8→**53.5** / 5.0→**26.8** | 33.8→**16.2** / 78.8→**33.6** / 108.7→**35.4** / 208.4→**41.6** | 5,680→**1,767** | 6.5→6.5 / 25.4→**21.0** | 582→**452** MiB / 2.22→3.70 / 6.09→7.48 / 8.36→10.34 GiB | 483→484 / **0** (10 cMiss) / 54.1→**24.2** ms / 8.1 / 38.6 ms |
| **Exploded High** | 23.4→**39.7** / 23.4→**39.7** (1.9→**2.3**) | 23.4→**41.8** / 5.0→**20.4** | 36.5→**18.3** / 81.8→**42.5** / 121.9→**47.3** / 217.8→**51.3** | 6,321→**1,940** | 7.4→7.5 / 28.8→**22.6** | 597→**403** MiB / 2.68→4.33 / 7.07→8.53 / 9.84→11.90 GiB | 483→484 / **0** (9 cMiss) / 54.4→**23.9** ms / 10.2 / 38.5 ms |

> [!NOTE]
> Exploded steady-state CDP JS heap dropped **-22% to -32%** (`582→452` / `597→403 MiB`),
> while transient staging peak Working Set rose `+1.39–1.46 GiB` (`6.09→7.48` / `7.07→8.53 GiB`)
> while deferred cross-stage merge buckets stay resident before final flush; Regular Low and High
> peak Working Set both improved (`7.85→7.67` / `8.47→8.06 GiB`).

### Smaller-station matched guards (`base` `b8e8773b` → `cand`, 20 s at 16×, steady = `10–20 s`)

| Case | Full 20 s FPS | Steady FPS / 1% low | Steady `p50 / p95 / p99 / worst` (ms) | Draws | Struct / Equip (s) | Steady CDP JS / Peak WS | Worker ticks / misses / `tickMs` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Zoo Regular Low** | 59.9→**59.9** | 59.9→**59.9** / 43.9→**46.4** | 16.7→16.7 / 17.4→17.5 / 20.9→**18.4** / 25.1→31.8 | 873→**832** | 5.4→5.5 / 5.4→5.5 | 172→**170** MiB / 3.68→3.81 GiB | 323→323 / **0** / 6.8→**4.2** ms |
| **Zoo Exploded Low** | 56.4→56.2 | 59.2→**59.9** / 18.8→**53.7** | 16.7→16.7 / 17.2→17.4 / 49.5→**18.1** / 56.8→**19.4** | 1,159→**503** | 3.2→**3.1** / 4.6→4.6 | 167→**151** MiB / 2.93→3.55 GiB | 323→323 / **0** / 6.8→**4.5** ms |
| **Tanwei Regular Low** | 59.8→**59.9** | 59.9→**59.9** / 34.2→**49.3** | 16.7→16.7 / 18.0→18.2 / 24.7→**19.6** / 32.6→**21.3** | 1,460→**1,416** | 8.3→8.3 / 8.3→8.3 | 260→343 MiB / 4.50→4.55 GiB | 322→323 / **0** / 17.9→**8.3** ms |
| **Tanwei Exploded Low** | 54.6→**54.8** | 59.5→**60.0** / 22.3→**53.8** | 16.7→16.7 / 17.3→17.4 / 38.8→**18.4** / 49.0→**19.2** | 1,532→**589** | 3.3→3.4 / 6.1→6.3 | 321→**208** MiB / 4.36→**3.73** GiB | 323→323 / **0** / 15.0→**8.2** ms |
