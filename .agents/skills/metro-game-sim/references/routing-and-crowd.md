# Walking Graph, Sparse Routing, Crowd Movement, Demand, and Road Traffic

## Walking Graph (`sim/station.ts`)

`buildGraph(data, zoneBarriers = ZONE_LINES_BLOCK)` builds an immutable CSR `StationGraph` from
`withGround(data.cells, data.modules)` plus synthesized virtual walk cells:

- **Walkable nodes** — Solid cells with no solid block directly above (`z + 1`),
  `floorSpeed(cell) > 0`, and not occupied by blocking cells: booths, fences, fence-mode gates,
  `psd-end`, TVMs, vending machines, checkout counters, shelves, roads, pillar columns,
  canopy/hanger posts, stair blocks, AC units, electrical cabinets, lift shaft footprints
  (`liftFootprintCells`), or moving-walkway interiors (`walkwayCoveredCells`). Node coordinates
  sit at `(x + 0.5, y + 0.5, z + 1)`.
- **Virtual walk floor** — `exitFloorCells` adds concrete pad nodes for head-house exits
  (respecting authored cells, dug voids, and `rampOpeningsInWindow`); turning stairs add
  virtual interior landing nodes at half-rise (`stairTurnCells`).
- **Open-floor diagonals** — Any 2×2 square of four walk nodes with legal cardinal edges in
  both directions receives both diagonal `EDGE_KIND.walk` edges at `√2 / speed` cost. Gates
  keep cardinal approaches; exit, ramp, and fare checks apply to diagonal segments too.
- **Storey-scoped barriers** — `exitWallPlanes` spans `m.z .. m.z + EXIT_H`, and each
  `RampWall` carries the block elevation bounds `[z0, z1]` of its own flight so barriers never
  cut unrelated storeys. Ramp balustrades extend `0.6 m` past outer landings and stop cleanly
  at interior turn landings (`stairTurnConnectors`).
- **Servers and edges** — `ServerKind` covers `gate`, `escalator`, `walkway`, `stair`, `lift`,
  `door`, and `stop`:
  - Escalators, stairs, and walkways emit capacity-limited directed edges
    (`EDGE_KIND.escalator` / `stair` / `walkway`). `walkway` is step-free; `stair` and
    `escalator` are forbidden when `needs.stepFree` is true.
  - A lift shaft creates one `lift` server with a `LiftCar` and directed `EDGE_KIND.lift` edges
    between every ordered pair of walkable stops.
  - A `platform-edge` creates one `door` server per modelled car doorway (`doorRunOffsets`),
    plus `platformFloor` inward normals (`World.rebuild`) to keep walkers on the platform side
    of PSD glass.
  - `StationGraph.stationArea` counts non-`outside` walk nodes (1 m² each).

## Sparse Hierarchical Crowd Routing (`sim/sparse*.ts`)

`World.routingMode` defaults to `'sparse'` (`'legacy'` retains full-graph `PathFinder` A*
rollback; attaching a WASM `routeSearch` also bypasses sparse routing). All sparse scoring uses
deterministic integer milliseconds (`toMs`, `INF_MS = 0x3fffffff`) mirrored in Unity `Metro.Sim`
(`tools/unity-parity/record-crowd-routing.mjs`).

### Static Topology (`sim/sparseGraph.ts`, `sim/sparsePolicy.ts`)

- **Stable keys** — 43-bit order-preserving `packTileKey(tx, ty, tz2)` with
  `tz2 = round((nodeZ - 1) * 2)` (preserving half-metre stair landings) and
  `packSectorKey(sx, sy, tz2)` using floor division by `SPARSE_SECTOR_SIZE = 16`.
- **Regions** — Connected components of bidirectional plain-walk edges (same elevation,
  `EDGE_KIND.walk`, no edge server, no gate endpoints) inside each 16×16 sector. Each
  `SparseRegion` stores sorted `tileKeys`, mean centroid `(centerX, centerY)`, free-flow
  `walkMsPerM`, and an optional concourse sample tile.
- **Crossings and explicit arcs** — Adjacent plain-walk edges across sector boundaries group
  into fence-split contiguous `SparseCrossing` runs (with `uniqueFromNodes` and a spatially
  centred representative pair). Non-plain or service edges (gates, stairs, escalators,
  walkways, lifts, one-way links) become `SparseExplicitArc` entries.
- **Exact reachability (`canReach`)** — Lazy reverse-BFS reachability bitsets over the region
  graph keyed by `(goalRegion, stepFree)`. Because every region is a connected plain-walk
  component and every non-plain edge is an explicit arc, `canReach` is exact relative to
  fine-graph reachability. `World.ensureLegNode` uses `canReach` to filter reachable boarding
  doors, and `World.startLeg` / `routeTick` immediately skip unreachable optional stops or mark
  unreachable legs stuck without coarse or fine expansions.

### Coarse Planning, Fields, and Rolling Local Walker (`sim/sparseRouter.ts`)

- **Per-tick cost snapshot (`CostSnapshot`)** — Captures `gateWaitMs`, `serverWaitMs`,
  `regionCrowdMs`, and `serverOpen` once per tick.
- **Shared field-free reverse trees (`ReverseCoarseTree`)** — For standard queries
  (`excludedServer < 0`), `SparseRouter` runs a work-capped, resumable region-level reverse
  Dijkstra tree per `(goalRegionId, effNeeds)` (`S` step-free, `L` luggage when lifts exist,
  else `N`), using region centroids, crossing costs, `regionCrowdMs`, and `explicitArcCostMs`
  (including `STAIR_AVOID_S = 32 s`, `LIFT_AVOID_S = 300 s`, `LIFT_AVOID_LUGGAGE_S = 30 s`, and
  live server/gate waits). Zero reverse distance fields are built during coarse search;
  itineraries extract in O(path length) and expose `nextGateServer`/`nextGateDistMs`/
  `nextServiceServer` for forecasts beyond the 16-step walk horizon. Queries with
  `excludedServer >= 0` run field-free region-level forward A*.
- **Arrival-wave sharing** — `World.startLeg` adopts warm cached itineraries via
  `tryCachedCoarseSearch`; on a cold miss it defers job creation to the next tick's `routeTick`
  so a simultaneous train arrival wave shares one fresh `CostSnapshot` and its
  `ReverseCoarseTree`.
- **Lazy LRU reverse distance fields** — Intra-region multi-source reverse Dijkstra fields are
  built only when `refillWalker` actually walks a region, bounded by
  `SPARSE_FIELD_CACHE_MAX_BYTES` (`16 MiB`) LRU eviction.
- **Rolling 16-step local walker (`refillWalker`, `scoreTileMs`)** — Maintains up to
  `SPARSE_WALK_HORIZON = 16` steps, refilling when `<= SPARSE_REFILL_THRESHOLD = 4` remain.
  Each candidate plain neighbour is scored in integer ms:
  - `walkCostMs + fieldMs + density + reserved + turn + jitter`
  - `density = min(2500, 500 * directOtherBodies + roundHalfUp(250 * meanAdjacentPlainOtherBodies))`
    from `StandingOccupancy`.
  - `reserved = min(1300, 650 * otherClaims)` from `SoftClaimTable` (next
    `SPARSE_CLAIM_STEPS = 2` untraversed tiles, TTL `SPARSE_CLAIM_TTL_TICKS = 4`).
  - `turn = 50 * shortestOctantDifference(heading, moveOctant)` and deterministic Murmur3
    `jitter ∈ [0, 100)`.
- **Budgets and 3-pass refill priority (`routeTick`)** — Mandatory jobs (`fieldJobs`,
  `reverseTreeJobs`, `coarseJobs`, `fineJobs`) share `SPARSE_MANDATORY_POP_BUDGET = 96000` and
  `SPARSE_MANDATORY_SCAN_BUDGET = 384000`, promoting jobs aged
  `>= SPARSE_AGE_PROMOTE_TICKS = 4`. Local refills (`SPARSE_LOCAL_REFILL_BUDGET = 384`) run in
  three deterministic cursor-rotated passes:
  1. Blocked walkers (`remaining === 0`).
  2. Low-buffer walkers (`1..4` steps remaining).
  3. Optional live-crowd tail trims (retaining a 2-step safe committed prefix without
     re-searching the coarse itinerary) using leftover budget.
- **Bounded fine-graph recovery** — If coarse search or refill fails on a statically reachable
  pair, deduplicated A* `FineRecoveryJob`s run within `SPARSE_FINE_RECOVERY_POP_BUDGET = 4000`
  and return a legal prefix up to `horizon` steps.
- **Edit retention and sample refresh** — `onCommit` diffs sectors by signature, retaining
  unaffected reverse fields and active segments across remote edits. Concourse sample refresh
  (`runOptionalJobs`) runs only after a real Pause → Play transition (`notifyPlayResumed`) or
  every `SPARSE_SAMPLE_REFRESH_SIM_S = 60` elapsed sim seconds (never on clock scrub).

## Dynamic Wayfinding, Crowd Clearance, and Activities

- **Gate wait forecasts (`sim/gateTraffic.ts`)** — Tracks per-server, per-direction `queued`
  and `incoming` walkers within `GATE_FORECAST_SECONDS = 12 s` (reading both the rolling path
  and `CoarseItinerary.nextGate*`). Two-way lanes add opposing-wave drain time bounded by
  `GATE_FORECAST_MIN_DRAIN_FRACTION = 0.1` and cap waits at `600 s`.
- **Fare-line lookahead and patience rerouting (`World.ts`)** — `chooseGate` re-evaluates
  within `GATE_LOOKAHEAD = 8 m` (rationed by `GATE_REPLAN_PER_TICK = 8`; deferred walkers wait
  at the gate cell rather than joining a stale queue). `reRouteAroundQueue` triggers when a
  gate or lift queue wait exceeds patience (`PATIENCE_MIN..MAX = 60..180 s`, rationed by
  `REROUTE_REPLAN_PER_TICK = 4`) and switches only when the new itinerary selects a different
  server (requiring `SPARSE_SWITCH_MARGIN_MS = 2000` gain in sparse mode).
- **Corridor spreading and platform waiting (`sim/walkingSpace.ts`, `sim/crowdRouting.ts`)** —
  `walkingLaneNode` spreads walkers laterally across clear corridor width (`WALK_LANE_REACH =
  8`, golden-ratio lane fraction) with fan-in before turns and services. `platformWaitingNodes`
  builds connected floor spots flanking each doorway (`PLATFORM_WAIT_RADIUS = 6.5 m`) while
  leaving the doorway centre clear for alighting. Door choice balances walk distance (`0.25`)
  against committed `doorLoads` (`8`).
- **Swept clearance (`World.tryMove`, `sim/rampCollision.ts`, `sim/roads.ts`)** — Every walk
  step and collision-separation push sweeps against storey-bounded `rampWalls`
  (`RAMP_BODY_RADIUS = 0.25 m` inside, `RAMP_OUTSIDE_CLEARANCE = 0.4 m` outside), same-floor
  road rectangles (`roadMoveClear`), and `platformFloor` PSD inward normals;
  `holdPlatformQueuesClear` and `holdGateQueuesClear` (`GATE_CLEAR_RADIUS = 0.62 m`) prevent
  crowd pressure from pushing queued bodies through screens or turnstiles.
- **Passenger activities (`sim/activities.ts`, `sim/activityStops.ts`)** — `writeTransfer`
  emits 6 floats per live agent (`[x, y, z, renderState, packedActivity, id]`, with
  `AgentRenderState.StairWalking` distinguishing stair rides visually). `packActivity` fits
  4-bit kind (15 kinds in `ACTIVITY_NAMES`), 8-bit heading, and 12-bit timeline into an exact
  Float32 integer. Optional errands honour fare sides, exclusive server occupancy (one customer
  per machine/cubicle, one occupant per bench seat), and bounded approaches.

## Demand, Calendar, Metrics, and Street Road Traffic

- **Clock and demand (`sim/clock.ts`, `sim/demand.ts`)** — `DayType` (`'workday' | 'offday'`)
  is derived from `SimCalendar.holidays` and weekends (no makeup-workday overrides).
  `periodOf(simTime, service, peaks, workday)` checks shut hours (`!withinSpan(t, service)`)
  first, then peak windows on workdays only, then shoulders (`06:30` / `22:30`). Offdays run
  `offpeak`/`late` only and read `DayDemand.offday`; workdays read `DayDemand.workday`.
  `demandAt = demandShape * PERIOD_FACTOR[period]` (`peak: 1`, `offpeak: 0.6`, `late: 0.25`).
  `World.seek` moves `simTime`, drops absolute `nextDispatch` times, and resets `History` while
  keeping crowd and counters.
- **Metrics and history (`World.computeMetrics`, `sim/history.ts`, `sim/globalStats.ts`)** —
  `crowdLos` applies `losOf(stationArea / standing)` over in-station non-`outside` non-rider
  bodies (`A` when empty); `nodePop` is filled in the same pass for density overlays. `History`
  appends a 13-column (`HISTORY_STRIDE`) sample every `SAMPLE_SECONDS = 60` sim seconds (first
  sample after reset is a zero-delta baseline). `MAX_AGENTS = 6000`.
- **Street road network and traffic (`sim/roadDocument.ts`, `sim/roadLaneMovements.ts`,
  `sim/roadNetwork.ts`, `sim/roadTraffic.ts`)**:
  - `getRoadDocument` splits intersecting orthogonal segments at derived `RoadNode` IDs with
    shared square end caps.
  - `getRoadNetwork` coalesces collinear same-width strokes, generates controlled crossing and
    T connectors using `roadLaneMovements` (no U-turns; odd T approaches share the centre lane)
    and uncontrolled width-merge junctions (no signals or crosswalks). `roadJunctionSides`
    emits a zebra side for every street meeting a controlled junction (both arrival and
    departure sides), while stop lines and poles stay on arrivals.
  - **Signal scaling (`roadSignal`)** — Each controlled axis takes the maximum lane count among
    roads with legal incoming movements: `green = ROAD_SIGNAL_GREEN + (lanes - 2) * 4` (`8 s`
    for 1 lane, `12 s` for 2 lanes, `+4 s` per extra lane). Axes alternate with
    `ROAD_SIGNAL_AMBER = 3 s` and `ROAD_SIGNAL_CLEAR = 5 s` all-red; an axis with zero incoming
    movements gets no phase and a sole active axis stays green.
  - **Metered traffic (`RoadTraffic`)** — Fixed `ROAD_STEP = 0.1 s` (`ROAD_TRAFFIC_SPEED =
    6 m/s`, cap `ROAD_TRAFFIC_CAPACITY = 192`, deterministic 10% bus / 60% scooter / 30% car
    mix via `roadHash`). Exclusive per-junction reservation locks hold until a vehicle's rear
    clears (`c.size / 2 + ROAD_FOLLOW_GAP`). `trafficSchedule` meters each boundary entry lane
    and initial approach `seedSpacing` against the most restrictive downstream crossing
    (longest connector, `BUS_LENGTH = 10 m`, crosswalk depth, green share, feeder count, and
    `1.25×` headroom) so queues drain cleanly each cycle. Mirror timing and metering changes in
    Unity (`StationRoadLayout` / `StationRoadTraffic`) and regenerate `road-oracle.json`
    (`tools/unity-parity/record-station-roads.mjs`).
