---
name: metro-game-sim
description: Pure simulation layer in game/src/sim/ — 5 m grid and inverted street plane, walking graph, sparse hierarchical crowd routing, rolling stock and train service, vertical circulation, fare gates, activities, demand/clock/metrics, and road traffic. Use when editing game/src/sim/ or sim-coupled rules in game/src/build/.
---

# Pure Simulation (`game/src/sim/`)

`game/src/sim/` is the deterministic, pure-TypeScript simulation engine for Station Designer.
Every module runs directly in Node (for unit/integration tests) and inside the browser Web
Worker (`sim/worker.ts`).

## Dependency Boundary and Coding Rules

`game/test/layering.test.mjs` enforces a strict one-way dependency boundary:

- **`sim/` imports nothing outside `sim/`** — zero external packages and zero imports from
  `build/`, `render/`, `persistence/`, `data/`, or `app/`.
- **Zero DOM or framework coupling** — never reference `document.`, `window.`,
  `requestAnimationFrame`, `three`, or `react`.
- **Single Worker boundary** — `sim/worker.ts` (with `sim/protocol.ts`) is the only file in
  `sim/` that calls `postMessage`.
- **Strict TypeScript** — keep `.ts` extensions on relative imports, use `import type`, and
  never use TypeScript `enum` (`erasableSyntaxOnly`; use `as const` objects such as
  `AgentState`).
- **Determinism** — `seed + tick => identical crowd`. Draw all journey randomness from the
  single `Rng` (`sim/rng.ts`, mulberry32) in fixed iteration order; never call `Math.random()`
  or `Date.now()` in sim logic. Identity-derived variation (gait, physique, activities, road
  traffic) uses deterministic hashes (`sim/walking.ts`, `sim/activities.ts`, `sim/roads.ts`)
  without touching `Rng`.
- **Time base** — `SIM_SECONDS_PER_TICK = 1.0`, `BASE_TICK_MS = 1000`. Fast-forward
  multiplies ticks per real second (`intervalMs = max(4, BASE_TICK_MS / speed)`), never the
  simulation step.
- **Tuning constants** — live in `sim/constants.ts` (or `sim/stock.ts`), except sparse-routing
  constants which live in `sim/sparseConstants.ts` so baked-passenger hashes over
  `sim/constants.ts` stay stable.

```powershell
cd game
npm run typecheck  # tsc --noEmit
npm test           # node --test "test/**/*.test.mjs"
```

## Grid, Storeys, Street Plane, Zones, and Finishes

- **Coordinates and packing** — `+z` is up, `n` is `+y`, `e` is `+x`, `top` is `+z`. Always
  pack integer cell coordinates with `packKey(x, y, z)` (`sim/types.ts`, number arithmetic
  over `±4096 m`), never bit shifts.
- **5 m storey profile** — `STOREY_HEIGHT = 5` is the only supported station profile
  (`LEVEL_STEPS` from `−40` to `+30`, shifted by `levelBase ∈ 0..4` via `storeyBand`). Editable
  cells are 1 m blocks; turning stairs store half-metre internal landing `z` coordinates that
  `buildGraph` synthesizes as virtual walk nodes. See
  [five-metre-profile.md](references/five-metre-profile.md).
- **Inverted street plane (`sim/ground.ts`)** — At `z = GROUND_Z` (`0`), absence means solid
  `zone: 'outside'` pavement; dug holes store `{ fill: 'void' }`, and module-derived holes
  (at-grade platform tracks, ramp openings, head-house pads) are omitted without writing
  document cells.
  - `withGround(cells, modules, GROUND_MARGIN = 16)` materializes the bounded window for
    `buildGraph` and meshing; point checks use O(1) `solidAt` / `virtualSolidAt` /
    `groundHoleAt`.
  - `painted-ground` records keep `zone: 'outside'` and do not expand the ground window.
- **Block shapes and contact finishes (`sim/types.ts`, `sim/contactFinishes.ts`)** — Non-full
  blocks normalize to `CellShape`: `half` (`half-wall:<side>`), `corner` (`half-corner:<side>`),
  compound `cuts` (4-bit quarter mask `NW/NE/SE/SW`), or `triangle` (`tri-upper:<side>` /
  `tri-lower:<side>`). `clearContactFinishes` strips face finishes wholly covered by adjacent
  solid blocks while preserving partial contacts, inset/slope faces, and both sides of
  `suspended-ceiling` cells.
- **Ceilings and partially covered floor zoning (`sim/zones.ts`, `sim/openingCeilings.ts`,
  `build/model/Zones.ts`)** — A floor cell must be solid, walkable (`floorSpeed > 0`) or a
  column-foot `floor.track` bed, not tagged `suspended-ceiling` or `opening-ceiling`, and not
  a thin-wall/corner/cut cell itself.
  - A thin wall, corner, compound cut, or `lower` wedge above a real floor leaves that floor
    exposed and zoneable; a full block or `upper` wedge covers it.
  - `clearSupportedOpeningCeilings` strips `opening-ceiling` once solid support is restored
    underneath.
- **Fare zones (`sim/zones.ts`)** — `ZONES` are `none`, `outside`, `unpaid`, `paid`,
  `platform`, `restricted`. Unlabelled cells read `DEFAULT_ZONE = 'none'` (unpaid side);
  room-purpose paints (`store`, `toilet`, `office`) write `Cell.room` without altering fare
  crossings. `crossingDir` returns `1` (unpaid → paid), `-1` (paid → unpaid), or `0` (same
  side). `ZONE_LINES_BLOCK` defaults to `false` (pass `zoneBarriers: true` to `buildGraph` /
  `new World` to enforce strict gated crossings).
- **Finishes (`sim/finishes.ts`)** — Finish `family` governs behaviour (`floor` walkable,
  `track`/`floor.soil` `speed: 0` non-walkable); `DEFAULT_MATERIAL = 'floor.concrete'`,
  `RAMP_SOFFIT_FINISH = 'ceil.steel'`. Any material paints any exposed face
  (`finishPaletteGroups`).

## Core Simulation Contracts

### 1. Walking Graph and Sparse Hierarchical Routing
`buildGraph` (`sim/station.ts`) turns exposed walkable cells (plus virtual head-house exit pads
and turning-stair landings, minus fences, booth/counter/shelf/cabinet/pillar/post/road/lift and
walkway-interior cells) into a CSR graph with diagonal open-floor walks, storey-scoped ramp and
exit barriers, and capacity servers. `routingMode` defaults to `'sparse'`
(`sim/sparse{Constants,Policy,Graph,Router}.ts`): 16×16-cell regions, lazy exact `canReach`,
shared field-free `ReverseCoarseTree` reverse Dijkstra trees, LRU 16 MiB reverse distance
fields, rolling 16-step local walking with standing occupancy, 2-step soft claims, and 3-pass
refill priority, plus `'legacy'` A* rollback and optional WASM search hooks.
See [routing-and-crowd.md](references/routing-and-crowd.md).

### 2. Rolling Stock, Tracks, and Train Service
Five stock classes `STOCK_CLASSES = ['A','B','C','D','L']` (`sim/stock.ts`), 98% scale
(`trainScaleForStorey`), authoritative `doorCentres`/`doorRunOffsets`, fixed-phase cabin
alighting/boarding choreography (`approach → berth → opening → dwell → closing → hold →
depart`), per-`(line, track)` dispatch (`sim/headway.ts`, `sim/trainSchedule.ts`), and 10-float
pose packing (`sim/trainFlags.ts`). See [rails-and-vertical.md](references/rails-and-vertical.md).

### 3. Vertical Circulation, Gates, Exits, and Placement
Shared `single`/`double`/`triple` ramp rise families (`sim/rampLengths.ts`: 2–6 / 7–11 /
12–16 m), straight/turning/forward stairs (`sim/stairs.ts`), 30° escalators
(`sim/escalators.ts`), flat step-free moving walkways (`sim/walkways.ts`), multi-storey
mixed-interval lifts (`sim/lifts.ts`), gate policies and forecasts (`sim/gates.ts`,
`sim/gateTraffic.ts`), head-house/doorway/virtual exits (`sim/exits.ts`), exact ramp underside
cuts (`sim/openings.ts`, `sim/rampSurface.ts`), and single-verdict placement rules
(`sim/placement.ts`). See [rails-and-vertical.md](references/rails-and-vertical.md).

### 4. Passenger Activities, Demand, Clock, and Metrics
- **Activity stream** — Six-float agent buffer (`[x, y, z, renderState, packedActivity, id]`)
  packs 4-bit kind, 8-bit heading, and 12-bit timeline (`sim/activities.ts`,
  `sim/activityStops.ts`).
- **Clock and demand** — `sim/demand.ts` uses separate `workday` and `offday` curves scaled by
  `PERIOD_FACTOR`, driven by `sim/clock.ts` (`periodOf` checks shut hours first; offdays never
  enter `peak`).
- **Metrics and stats** — Station-wide `crowdLos` divides standing in-station bodies (excluding
  `outside` and train riders) by `StationGraph.stationArea`; `sim/history.ts` samples once per
  sim minute (`SAMPLE_SECONDS = 60`), and `sim/globalStats.ts` builds idempotent deltas.

### 5. Street Road Network and Ambient Traffic
`sim/roadDocument.ts` models authored node/segment splits, `sim/roadLaneMovements.ts` defines
turn permissions, `sim/roadNetwork.ts` builds directed lane graphs and crossing/T connectors
with lane-scaled green timing, and `sim/roadTraffic.ts` runs fixed-step (`0.1 s`) metered
vehicle simulation with exclusive junction reservations. Roads exclude pedestrian graph nodes
and sweep-block pedestrian moves (`roadMoveClear`) on their floor only.

### 6. Worker Protocol, Edit Classification, and Cache Lifetime
- `sim/worker.ts` handles `init`, `build`, `build-edit` (bounded splices via
  `sim/stationEdit.ts`), `population` (`sim/populationEdit.ts`), `control`, `restart`, `seek`,
  `selectAgent`, and `enableWasm`.
- Cosmetic and sim-inert decor edits (`sim/cosmeticEdit.ts`, `sim/decorInert.ts`) skip graph
  rebuilds; structural builds coalesce over `BUILD_COALESCE_MS` (`100 ms`). A `dirty` flag
  suppresses idle paused snapshots.
- Station-sized `WeakMap` caches register with `sim/documentCaches.ts` so retired undo frames
  release derived indexes.

## References and Related Skills

- [references/sim-module-map.md](references/sim-module-map.md) — File-by-file ownership table
  for every file in `game/src/sim/`.
- [references/five-metre-profile.md](references/five-metre-profile.md) — 5 m storey profile,
  track/catenary/PSD vertical datums, ramp/lift intervals, and persistence contract.
- [references/routing-and-crowd.md](references/routing-and-crowd.md) — Walking graph, sparse
  hierarchical routing, local walker, gate forecasts, clearance, activities, demand, and roads.
- [references/rails-and-vertical.md](references/rails-and-vertical.md) — Rolling stock, tracks,
  train stop choreography, stairs/escalators/walkways/lifts, exits, gates, and placement rules.
- Sibling skills: [metro-game](../metro-game/SKILL.md) (game architecture, `build/`,
  `persistence/`, `app/`, city styles, audio), [metro-game-render](../metro-game-render/SKILL.md)
  (Three.js renderer), [metro-game-test](../metro-game-test/SKILL.md) (Node and headless browser
  suites), [metro-wasm-experiment](../metro-wasm-experiment/SKILL.md) (opt-in Rust/WASM A*
  routing), [metro-unity](../metro-unity/SKILL.md) (C# simulation parity), and
  [performance guide](../metro-repo/references/performance.md).
