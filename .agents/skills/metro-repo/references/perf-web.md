# Web Three.js performance contracts

Active performance invariants for the Three.js / Web Worker game (`game/`).
See [performance.md](performance.md) for measurement rules and geometry
inventories, and [perf-benchmarks.md](perf-benchmarks.md) for commands.

## Interactive editing, picking & previews

- **Response budget**: Editor feedback targets strictly `< 100 ms` (`100 ms`
  misses). Track API-to-render, two-RAF, GPU completion, and worker installation
  separately. Run `npm run bench:editor-actions` (see
  [perf-benchmarks.md](perf-benchmarks.md)) for per-action captures under
  `.preview/perf/editor-actions/`.
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

- **Cross-module equipment batches** (`game/src/render/equipmentBatches.ts`):
  Static equipment batches into spatial tiles (`16 m` High, `64 m` Low, `256 m`
  dense Low when `modules >= DENSE_STATION_MODULES = 20,000`) with bounded view
  caching (`EQUIPMENT_VIEW_CACHE_SIZE`), cached static-transparent draw sorting
  (`cacheBatchOrder`), and deterministic `lastSync` work counters pinned by
  `batching-lifecycle.test.mjs`. Unchanged buckets retain GPU allocations;
  shrinking below the merge threshold restores surviving sources to layer 0.
- **Panel atlas** (`game/src/render/panelAtlas.ts`): Releasing a deleted panel
  returns its rect to the page free list without invalidating surviving roots'
  UVs (only dormant storey views drop). Live panels (TVs/clocks) compare dirty
  pixel bounds, upload at most one changed live panel per frame, coalesce fairly
  to newest pixels, retain CPU pages for context restoration, and request frames
  until pending uploads drain.
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
  hidden by rigid trays, preserving whole instances per floor, and flushing
  temporary merge inputs at 131,072 vertices or 1,024 meshes.
- **Zero-rewrite drags**: Floor drags translate tray groups without extra picks,
  document commits, or vertex rewrites.

## Simulation: sparse routing & road traffic

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
