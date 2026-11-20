# Crowd routing and spread plan

Proposed for the Three.js game and the Unity simulation used by Windows and WebGL. Give each passenger a coarse itinerary through the station and a rolling plan of about 16 walking steps. Share the expensive geometry work between passengers. Choose the actual tiles with live crowd information at walking distance.

## Why passengers form a line today

The screenshot shows a narrow stream extending well into the concourse on the approach to an escalator. Some convergence is expected at its entrance. The length of the thin approach across apparently usable floor is the behavior to reproduce. A replay is needed to establish which tiles are walkable, where the queue starts, and how much routing contributes to frame stalls.

- Both planners already charge up to 12 seconds for crowding when entering a tile. On Three.js, an A* result is shared by start node, destination node and needs class. The cache is cleared every 60 simulation ticks, but a walker keeps its committed route. Three.js also offsets walkers into legal lateral lanes where there is room. At a turn or service approach those lanes taper. [Web path cache](../game/src/sim/station.ts#L1111) · [Lateral lanes](../game/src/sim/walkingSpace.ts)
- Unity reuses exact routes within a live-cost version and can reuse whole spawn and alighting routes across ticks. The reuse windows are 60 simulated seconds for routes without lifts and 5 seconds for routes with lifts. A burst can therefore inherit the same future walking path selected for an earlier passenger. [Unity route reuse](../unity/Assets/StationDesigner/Runtime/Sim/StationServiceRuntime.cs#L2294)
- The ordinary walking detour in both builds looks about 8 metres ahead along the committed route. It needs a crowded tile, one of at most four detour searches per tick, and more than two seconds of estimated savings. It aims for a point on the same route. A newly dispatched wave can pick the same empty-looking path, converge before the detour runs, then converge again at the rejoin point. Broad density penalties also give adjacent tiles similar scores. Raising the penalty alone can increase detours while leaving those shared decisions in place. [Web detour](../game/src/sim/crowdRouting.ts) · [Unity detour](../unity/Assets/StationDesigner/Runtime/Sim/StationServiceRuntime.cs#L2121)
- Routing has already been measured as a CPU bottleneck in Unity. After the Stage 6 improvements, a 180-tick Tianhe Park peak replay still recorded 27.2 million A* expansions and a 270.94 ms p95 simulation tick. Those are historical EditMode measurements. Phase A will capture an approach and a train-release wave with fresh route and frame measurements. [Measured Stage 6 baseline](../.agents/skills/metro-repo/references/performance.md#stage-6-closure--simulation-a-hot-path--bounded-route-reuse-2026-11-19)

## 1. Cache routes through regions

Use the existing walk graph as the authority for legal moves. Build a sparse graph from it with three kinds of points.

| Point | How to build it | What the passenger aims for |
| --- | --- | --- |
| Service endpoint | Key each usable landing or approach by module or service ID, side, and level. Link directional fare gates, individual stair and escalator runs, lift boarding and alighting landings, and walkways using existing service edges. Include exits as routable endpoints. | The legal approach to the chosen service. Its existing server owns joining, capacity, waiting, traversal and release. |
| Boundary crossing | Start with 16 × 16-tile sectors keyed by level. Within each sector, label connected regions of ordinary, bidirectional floor. Group contiguous legal crossings between the same two regions and retain every distinct run, including narrow doors and passages. Preserve each directed or restricted transition as an explicit arc. | Any legal tile pair within the chosen crossing. A broad concourse seam can accept walkers across its width. |
| Concourse sample | Trial one stable, seeded representative on clear floor in each region. Rank candidates by a hash of the station seed and stable tile key, then choose among tiles with usable clearance. Keep a valid sample through refreshes. | Samples can speed up coarse attachment and provide extra alternatives in wide regions. Walkers aim for the next crossing, service approach or actual destination, so a sample cannot create a new pinch point. |

Resolve an exit, amenity or platform door using existing trip logic and attach the start and destination from their actual tiles. Door and platform candidates can share their region's cached geometry while keeping individual queues and reservations. Represent ramps and stepped geometry using existing legal edges, including nonstandard elevations. Boundary and service arcs carry connectivity even through regions that lack usable open-floor samples. Derive them from the actual graph so a split, one-tile gap, blocked diagonal or fare boundary changes what the sparse search can reach.

Run A* over the sparse points and arcs. Each within-region arc has a verified walking distance between representative boundary or service tiles. Build a reverse distance field limited to one region for a target crossing or service approach. Use a single representative as the target for a coarse arc and a multi-source field for steering to all legal tiles in a wide crossing. A crossing begins on one side and ends at its matched legal arrival tile across the seam. Measure representative error against fine A* and split unusually wide or costly crossings if needed. Begin with Dijkstra if the heuristic's lower bound is uncertain around lifts or moving walkways. Generate arc costs and fields lazily and cap the retained fields by bytes. Deduplicate requests so a wave approaching one crossing shares them. Static fields supply walking costs. The coarse search adds current directional gate waits, ride and lift waits, and existing needs penalties. Carry connector identity through the result to distinguish adjacent stair flights or lift shafts.

The passenger stores the final target, a short list of coarse crossings or services, and the active walking segment. Cache static fields, connectivity and costs by region and boundary revisions. Reuse a coarse result only with matching source attachment, target, needs, availability and cost snapshot, and any excluded service used by a queue reroute. Near competing exits or gates, attachment distance from the actual tile can change the first connector. Share the continuation from each candidate and resolve the first choice using the passenger's actual distance. Begin with live-result reuse confined to a single cost snapshot. Consider longer reuse only if profiling justifies it and queue-choice fixtures pass.

Build crossings and service endpoints first. Compare the same planner with concourse samples enabled. Keep samples where they improve attachment work or route stretch. Expose the next service ID, direction and estimated approach distance from the coarse itinerary. Existing gate forecasts and platform door balancing can then count approaching passengers even when they are more than 16 steps away. Update or release those reservations when the passenger switches service, changes legs or leaves the simulation.

## 2. Walk the next 16 steps using live density

1. **Choose a reachable target set.** Work toward the next planned boundary, service approach, or destination. Use distance through legal floor to that set for the direction of travel. A straight-line bearing can point through a wall or into a dead end. At a service approach the target narrows to the existing entry, and the service takes over.
2. **Plan a rolling segment.** At a reached waypoint choose each next tile from legal walk neighbours. Start with `walkSeconds + remainingWalkSeconds + densitySeconds + claimSeconds + turnSeconds + jitterSeconds`. The last four terms are bounded costs in walking seconds. `remainingWalkSeconds` comes from the shared reverse field, so a straight or diagonal alternate with a small extra distance can win. Consider reachable tiles, prevent immediate reversals and segment revisits, and require progress by default. If strict progress suppresses useful lateral moves, allow one sidestep within a bounded cost and require progress immediately after it. Keep a minimum-distance legal move available when crowd scores saturate.
3. **Prefer room one or two tiles ahead.** Reuse the tick's standing-occupancy snapshot. Give the candidate tile the strongest penalty, its immediate connected neighbours a smaller one, and subtract the walker's own body when applicable. Keep the broad density used for speed and crowd metrics during the first comparison. Apply soft claims to the first one or two untraversed tiles so several people deciding in the same tick can fan out before their new positions appear in the snapshot. Claims expire on traversal, queue entry, invalidation or a short tick TTL. Service reservations retain their own semantics. Saturate the costs so a busy one-tile corridor still moves.
4. **Make diversity stable.** Use a small seeded tie-break from seed, passenger ID, segment sequence and stable tile key. Keep a heading preference and a short committed prefix to reduce twitching between near-equal choices. Rotate who gets scarce planning slots in deterministic tick order. Start with each engine's existing collision, clearance and interpolation. Test the Three.js lateral offset in combination with tile choice, since the two can otherwise pull the same walker in different directions.
5. **Refill before the segment ends.** Start at 16 steps, compare 10 and 20, and request a refill with about 4 left. Preserve the current few committed edges, and discard the refill if its start or target changes. End sooner at the next service or final target. Release walking claims when the passenger joins a queue. Reconsider the coarse connector at the existing gate lookahead or queue-patience triggers, after invalidation, or after a measured stall. Use current directional waits and switch only for a meaningful improvement to a different service. A busy ordinary tile should usually change the next few steps while preserving the coarse itinerary.

Bound route work by expansions as well as requests. Neighbour scoring costs at most the horizon times ordinary node degree on a warm field. Cold field builds, coarse cache misses and fine-graph recovery use resumable jobs with a shared deterministic budget. Give urgent jobs priority with aging so long requests make progress. Record work left over and delay from request to first movement. Keep walking the valid segment while waiting. When it runs out, stand safely and retry. Treat budget exhaustion as pending work. If sparse guidance is missing or produces no progress, queue a bounded fine-graph search against the existing graph. Use it to recover connectivity or identify the next service, then return to short segments. Track fallback reason and count. Include catch-up ticks at 16× when setting the per-frame work allowance for Unity. Keep the order of routing work within a simulation tick independent of wall-clock time so replay stays deterministic.

## 3. Keep the cache during building

Apply topology and service changes on commit. Schedule optional sample refresh independently.

| Event | Required update on the accepted revision | Work that can wait |
| --- | --- | --- |
| Paint, labels, or another routing-neutral edit | Retain graph-derived data and active walks. | None. |
| Gate or exit opens/closes, direction changes, or a connector is moved, added or deleted | At commit, disable obsolete arcs and service references or install the changed ones. Update affected endpoints, availability or walk edges. Reconcile affected queues and active segments with existing service rules. | Reweight or rebuild affected approaches on demand within the route budget. Retain distant fields. |
| Floor, wall, fence, or other edit that changes legal walking | Dirty affected sectors and the edge-dependency halo, including both sides of boundaries and affected landings. Drop any cached field or crossing affected by those dependencies. Remap and validate affected walkers' next moves. Recompute touched connectivity before using it. Use budgeted recovery while required data is pending. | Refresh samples and warm new fields. Keep still-valid samples, and replace a deleted or blocked representative on demand if coarse routing needs it sooner. |
| Paused building resumes | On a real Pause → Play transition, schedule one optional refresh for dirty sectors. Required topology checks apply to the first moving tick. | Spread sample and field work across subsequent ticks. A clean resume queues zero refresh work. Coalesce jobs already queued for the same revision. |
| Building continues during Play | Process safety changes on each accepted revision. | On the first running tick at least 60 elapsed simulation seconds since the prior optional refresh, schedule a batch if sampling is dirty. Coalesce edits by sector. When a batch completes, clear only the dirtiness it consumed. Use elapsed ticks so calendar scrubbing leaves the refresh schedule intact. |
| Undo, redo, station replacement or restart | Apply undo and redo as committed edits. For a new document, tie all jobs, paths and caches to the new session. On restart of the same document, clear live decisions and claims and retain validated geometry. Discard a staged candidate on rollback. | A new session warms fields on demand with the regular route budget. |

Use a stable tile key such as `(x, y, surface elevation)` in each engine's canonical coordinates, plus module ID, mode and direction for services. Key sector data, pending work and cached fields to the revisions they depend on. On Three.js, `World.rebuild` can renumber dense walk nodes and currently replaces `PathFinder`. Keep the sparse cache at world scope and resolve retained stable keys against the new graph before reuse. Start with a per-sector topology comparison after the existing graph build, including effective edges and movement restrictions. Use committed edit deltas where they prove equivalent invalidation. On Unity, consume the retained walk-graph delta during the staged edit transaction. Publish invalidation with the graph commit so a failed staged edit leaves the active route data usable. Validate delayed results against graph dependencies, trip leg, service assignment and passenger. Walkers whose next legal edge survives an unrelated edit keep walking. Use the existing relocation and reconciliation rules when the floor or service under an actor disappears. [Web rebuild](../game/src/sim/world/World.ts#L413) · [Unity retained staging](../unity/Assets/StationDesigner/Runtime/Sim/StationSimulationSession.cs#L857)

## 4. Core algorithms in pseudocode

Use the same data and decision order in TypeScript and C#. Keep dense node indices inside the current walk graph. Use stable keys in retained routing data. Measure distances and scores in integer milliseconds in the routing policy, rounding nonnegative values half up in both builds. Preserve the existing service system's timing and movement units at the boundary.

```text
TileKey       = canonical walk tile including surface elevation
RegionKey     = sector coordinates, level, minimum TileKey in component
Crossing     = directed from-region and to-region, legal edge pairs, representative pair
ServiceArc   = exact entry and release TileKeys, service ID, direction, needs rules
FieldKey     = region key and revision, sorted target TileKeys, walk permissions
LegToken     = session ID, passenger ID, leg generation
Walker       = LegToken, goal, needs, coarse itinerary, current step, remaining steps
SearchResult = READY(value), PENDING, or NO_PATH
```

### 4.1 Build regions and crossings

Build each sector from the effective walk graph after floor, clearance and fare rules have run. An edge belongs inside a region only if both directions are legal ordinary walking without a service or permission check. A directed walk edge and any special traversal have an explicit arc and keep their rules. Use floor division for sector coordinates so negative coordinates land in the correct sector. Test the ordinary edge classifier against the legal graph in each build, including gates encoded by metadata on walk edges.

```text
rebuildSector(sector, graph)
    tiles = graph.walkableTilesIn(sector), sorted by TileKey
    regions = floodFill(tiles, using bidirectional plain edges within sector)
    key each region by its minimum TileKey
    index each tile by its region
    return regions and tile index

rebuildConnections(sector, graph, regionIndex)
    plainCrossings = []
    explicitArcs = []
    for edge in graph.legalOutgoingEdgesOf(sector), in stable order
        fromRegion = regionIndex[edge.from]
        toRegion = regionIndex[edge.to]
        if isBidirectionalPlainWalk(edge)
            if fromRegion != toRegion
                plainCrossings.add(edge)
        else
            explicitArcs.add(exactDirectedArc(edge, fromRegion, toRegion))

    group plainCrossings by ordered region pair and sector seam
    split each group into contiguous runs of legal crossing edges
    for run in stable order
        representative = middlePairInStableSpatialOrder(run)
        publish Crossing(run.fromRegion, run.toRegion, run.pairs, representative)
    publish explicitArcs and destination attachment points

refreshSample(region, oldSample, seed)
    if oldSample is still a clear walk tile in region
        return oldSample
    candidates = region.tiles with usable clearance
    if candidates is empty
        return NONE
    return argmin(candidates, score = [hash32(seed, TileKey), TileKey])
```

Treat a legal corner crossing as its own run if it cannot join a face seam. A run may have one edge. Store the actual outgoing tile pairs, so two adjacent openings divided by a fence cannot become one opening and a valid diagonal still uses the existing corner-clearance rule. When samples are enabled, use them for attachment estimates or ordering. Give every eligible crossing its real attachment cost before choosing a route.

### 4.2 Share distance fields and search the sparse graph

Each field is one region's reverse shortest-walk distances. The coarse graph uses singleton target tiles for consistent representative costs. The rolling walker uses a field seeded at every legal departure tile of its next crossing, or the exact service entry or goal tile. Use the existing edge's static walk cost in both cases.

```text
getField(region, targetTiles, needs)
    key = FieldKey(region, sortedUnique(targetTiles), walkPermissions(needs))
    if fieldCache contains key
        return READY(fieldCache[key])
    if no live job for key
        enqueue one reverse-Dijkstra job for key
    return PENDING

stepField(job, budget)
    initialize once with all targetTiles at distance 0
    if job.region revision is stale
        discard job and signal its waiters to request the current field
        return
    while job has frontier or a partly scanned expansion
        if no expansion is in progress
            if budget has no heap pop remaining
                return PENDING
            tile, distance = pop minimum by [distance, TileKey], charging one pop
            if distance != job.bestDistance[tile]
                continue
            save tile, distance and an incoming-edge cursor as the current expansion
        while current expansion has another incoming edge
            if budget has no edge scan remaining
                return PENDING
            edge = advance cursor, charging one scan
            if edge is legal plain walking within the region
                relax edge.from with saved distance + walkCost(edge)
        finish current expansion
    if job's region revision still matches
        publish distances and wake all waiters for the field
        evict cold completed fields to the retained-byte cap

startCoarseSearch(leg, startTile, goalTile, excludedService)
    capture topology revision and a read-only service cost and availability snapshot
    attach a virtual start at startTile and a virtual goal at goalTile
    enqueue sparse A* with heuristic 0 and heap order [cost, point key]

coarseSuccessors(point, query)
    region = point.region
    for endpoint in region's crossings, service approaches and virtual goal
        field = getField(region, [endpoint.representativeTile], query.needs)
        if field is PENDING
            suspend this expansion at this endpoint until its field is ready
        cost = field.distanceAt(point.tile)
        if cost is finite
            yield within-region arc to endpoint at cost

    if point is a crossing departure
        yield its representative legal crossing arc at its walk cost
    if point is a service or restricted-edge departure
        arc = exact arc from point to its release point
        if arc is allowed by query.needs, query.availability and query.excludedService
            yield arc with cost static cost + snapshot wait + needs penalty

stepCoarseSearch(query, budget)
    while query has frontier or a partly scanned expansion
        if no expansion is in progress
            if budget has no heap pop remaining
                return PENDING
            point, cost = pop minimum by [cost, point key], charging one pop
            if cost != query.bestCost[point]
                continue
            if point is query.goal
                return READY(reconstruct ordered crossing and service arcs from parents)
            save point, cost and a coarseSuccessors cursor as the current expansion
        while current expansion has another successor slot
            charge one scan when entering a new slot, or yield if budget is spent
            arc = advance successor cursor
            if arc is PENDING
                return PENDING and wait for the field that blocked the cursor
            if arc exists and saved cost + arc.cost < query.bestCost[arc.to]
                record improved cost and parent arc, then push improved point
        finish current expansion
    transfer request to fine-graph recovery
    return PENDING
```

Resume a suspended A* expansion before settling another node. Store its successor cursor so it neither skips an arc nor starts over. Charge heap pops and edge scans separately, including stale pops and high-fanout successor loops. Allow partial scans of a node's outgoing edges when a slice ends. Keep one frozen cost snapshot for an in-flight query. Recheck current service availability before adopting a result. Preserve the existing live rechoice trigger and compare the estimated cost of keeping or switching service under the same current cost snapshot. This lets a rush keep planning while queue estimates change. Initially share completed coarse results only under the same topology, cost snapshot and exact query key. Share the static fields across snapshots.

### 4.3 Score tiles and roll the walking segment forward

Use 16 edges and request more when 4 or fewer remain. The first version requires strictly decreasing field distance. This keeps walking out of U-shaped obstructions and gives a progress guarantee on an unchanged graph. The score still admits several downhill routes in a wide hall. Trial the optional sidestep only if measurements show the strict version converges too early. A sidestep must have a following legal move below the distance before the sidestep and fit within the remaining segment.

The values below give the initial tuning pass a concrete starting point. Use one occupancy snapshot per tick and adjust a candidate's crowd count for the walker itself. Read adjacent occupancy only over legal connected floor on the same level. A soft claim contributes to the score and leaves the claimed tile traversable.

```text
scoreTile(agent, current, tile, heading, field, occupancy, claims)
    direct = occupancy.otherBodiesOn(tile, agent)
    adjacent = occupancy.meanOtherBodiesOnPlainNeighbours(tile, agent)
    density = min(2500, 500 * direct + round(250 * adjacent))
    reserved = min(1300, 650 * claims.countOtherAgentsOn(tile, agent))
    turn = 0
    if heading is set
        turn = 50 * shortestOctantDifference(heading, current -> tile)
    jitter = hash32(stationSeed, agent.id, agent.segmentSequence, tile.key) mod 100
    return walkCost(current -> tile) + field[tile] + density + reserved + turn + jitter

refill(agent, occupancy, claims)
    existing = agent.untraversedSteps
    if count(existing) > 4 or existing already ends at the current target
        return
    start = last tile of existing, or agent's reached tile
    targets = legal departures for next crossing, exact service entry, or goal
    field = getField(regionOf(start), targets, agent.needs)
    if field is PENDING
        return PENDING
    if field[start] is infinite
        requestCoarseRepairOrFineRecovery(agent)
        return PENDING

    suffix = []
    at = start
    heading = direction at end of existing, or agent's last walking direction
    while at not in targets and count(existing) + count(suffix) < 16
        candidates = legal plain neighbours in region with field[next] < field[at]
        if candidates is empty
            requestCoarseRepairOrFineRecovery(agent)
            break
        next = argmin(candidates, [scoreTile(agent, at, tile, heading, field, occupancy, claims), TileKey])
        append next to suffix
        heading = direction(at -> next)
        at = next

    if suffix is nonempty and leg, target and prefix tail are still current
        append suffix after existing steps
        agent.segmentSequence += 1
        claims.refreshForNextTwoSteps(agent)

advanceWalker(agent)
    if agent has a boundary crossing in progress
        advance it through the existing movement rules
        when the arrival tile is reached, pop the crossing and enter the next region
        return
    validate the next legal edge before movement
    consume ordinary steps using existing collision and movement rules
    release passed claims and update claims as the first two steps advance
    if agent has reached its current target tile
        if target is boundary crossing
            begin crossing along a matched legal edge from the reached departure tile
        if target is service
            release walking claims and hand off to the service's queue or traversal
            advance itinerary only when the service reports the actual release landing
        if target is final goal
            release walking claims and complete this leg
    else if no valid steps are ready
        hold position while routing work is pending
```

For example, suppose a clear diagonal costs 300 ms more than going straight, and both tiles make progress toward the target. One other passenger's claim adds 650 ms to the straight tile. With equal occupancy, the diagonal still wins even after a 50 ms heading penalty and up to 99 ms of extra jitter. The same claim is a finite cost at a one-tile bottleneck, where the only legal step still wins.

If a boundary tile offers more than one legal arrival tile, pick the lowest static crossing cost plus the destination-side occupancy penalty, with the stable tile key as the final tie-break. Revalidate the chosen edge on consumption. A passenger halfway through a legal edge finishes it using the existing movement state and only consumes the itinerary at arrival. If an edit removes that edge, apply the existing relocation policy. When a service releases a passenger at a different valid landing than planned, attach the next query at that actual landing. An ordinary walking refill leaves gate and door reservations in place. A connector switch updates the applicable reservation through the service owner.

```text
considerServiceChange(agent, candidate, currentCosts)
    enter through the existing gate lookahead, queue-patience or repair trigger
    if candidate is pending
        retain a still-legal itinerary while waiting
    if candidate is ready at this waypoint and its next service is valid
        keepCost = price current itinerary at currentCosts from this waypoint
        newCost = price candidate at the same currentCosts from this waypoint
        if current service is unavailable or (candidate changes service and newCost + switchMargin < keepCost)
            use the service owner's rules to release or transfer reservations
            adopt the candidate and refill from the current waypoint
```

### 4.4 Budget work and recover from misses

Jobs yield with their frontier and resume on a later fixed simulation tick. Give safety-critical routing and field work needed by walkers a guaranteed share of the budget. Use an age threshold so a steady stream of urgent requests cannot starve other legs. The phase A measurements set the scan, pop and local-scoring budgets. Optional work receives a capped share of what remains.

```text
routeTick(tick)
    expire soft claims and capture standing occupancy
    enqueue required region repairs and route requests due this tick
    queue any sample refresh due under the elapsed-tick rule
    run mandatory jobs within scan and heap-pop budgets
        prioritize blocked walkers, then short remaining segments, with aging
        run a deduplicated field job at the highest priority of its waiters
    adopt ready results whose session, leg, start and target still match
    refill eligible walkers within the local neighbour-scan budget
        rotate stable passenger order by tick to share planning slots
    use remaining optional budget on dirty samples and field warming

recoverWithFineGraph(request)
    deduplicate by leg and recovery start, goal, needs and excluded service
    run resumable fine A* with the same legal edges and service rules
    if search is still in progress
        return PENDING
    if a legal route is found
        extract a legal prefix up to 16 steps and its next transition or service
        retain a short recovery hint and retry sparse guidance at the next attachment
        return READY(prefix, hint)
    if topology and permitted endpoints are still current
        return NO_PATH and use the existing unreachable-trip policy
    return PENDING with a request to resolve the changed leg again
```

For a valid path that the sparse graph missed, record the failed attachment or crossing and continue from the fine-search hint. Use a per-leg retry backoff for repeated sparse misses and include all fine expansions in the performance comparison. Keep routing preview queries outside these queues and claims, with their existing request token and a separate work cap.

### 4.5 Invalidate on commit and refresh samples on resume

Per-sector revisions let static fields survive unrelated edits. Pending coarse searches have a station topology revision because their frontier may span several sectors. Keep the unaffected prefix of an already-walking passenger's segment. Validate future crossings and service choices as they approach. A queue-wait change affects cost snapshots. A closed or deleted connector also changes availability, which must be checked before consumption.

```text
onCommit(previousGraph, newGraph, change)
    if change is routing-neutral
        return
    sectors = changedEffectiveWalkEdgesAndLandings(change) plus dependency halo
    publish the committed walk graph and changed service availability together
    if sectors is nonempty
        increment topologyRevision
        for sector in sectors
            increment sector.revision
            invalidate its region fields and dependent crossing runs
            mark samplesDirty[sector] = sector.revision
            queue required region and crossing repair
        cancel stale sparse and fine search frontiers
    discard affected live query results and obsolete service reservations
    for walker with an affected next edge, crossing or service
        keep maximal legal prefix against the committed graph
        release claims on discarded steps
        queue repair from the last safe waypoint as needed

scheduleSampleRefresh(resumed, elapsedTick)
    due = elapsedTick - lastScheduledRefreshTick >= ticksFor60SimSeconds
    if samplesDirty is empty or neither resumed nor due
        return
    for dirty sector in stable order
        enqueue or coalesce optional job for [sector, samplesDirty[sector]]
    if any job was newly scheduled
        lastScheduledRefreshTick = elapsedTick

finishSampleJob(sector, requestedRevision, samples)
    if sector.revision still equals requestedRevision and required repair is complete
        publish valid samples
        clear dirty mark only if it still equals requestedRevision
```

Call the refresh scheduler on the first moving tick of a real Pause → Play transition and during normal running ticks. A clean resume or a clock scrub schedules zero work. A dirty sample job waits until its sector is repaired, and an edit committed during the job leaves a newer dirty revision for the next batch. For a new station or a same-document restart, use the session and lifecycle rules in section 3. Unity publishes only successful staged edits. Three.js compares effective sector topology before remapping cached tile keys to its rebuilt dense graph.

## 5. Implementation order

| Phase | Work | Exit evidence |
| --- | --- | --- |
| A. Reproduce the stream and the stall | Obtain the screenshot save, level, clock and speed if available. Add a seeded wide concourse feeding one escalator, a two-connector variant and a narrow single-route control. Replay one burst with the current planner. Capture trajectories, queues and route timing alongside frames. | Show where lateral spread contracts and how much of the stall comes from search, congestion pricing, presentation and rendering. Record replay inputs and results in the shared performance reference. |
| B. Prove local walking | Gate the rolling walker behind a development option. Use the legacy full path to supply the next service or region exit during the experiment. Compare density alone, density plus stable bias, and density plus bias and short claims. Run the local walker in both engines before changing inter-region decisions. | The wide approach spreads, and the bottleneck still queues and drains. Same-seed replay is deterministic and added local work fits the budget. |
| C. Replace common full-grid searches | Implement static sectors and crossings, shared fields, bounded search jobs and service handoff. Roll spawn and alighting onto the sparse planner first. Migrate live gate, ride and lift choices once service fixtures pass. Draw the selected passenger's active segment plus an estimated continuation from a read-only preview query. Preserve preview tokens and keep simulation RNG, claims and route state outside preview ownership. | Common trips use sparse search and short local segments. Fine A* provides the comparison oracle and infrequent recovery. Queue and accessibility oracles pass. |
| D. Retain data across edits | Add stable-key remapping, dirty-sector repair, the coalesced refresh schedule and stale-job rejection. Test grouped edits, immediate Play, repeated toggles and a structural edit while a burst is mid-route. | A remote edit preserves unaffected fields and paths. Affected edges are repaired before use. Ordinary edits and first Play stay within navigation work budgets. |
| E. Tune and ship both builds | Retain the legacy planner as a development rollback switch during comparison. Tune shared policy from recorded fixtures, then repeat in Three.js, Unity Windows and local Unity WebGL Release. | Review visual captures and correctness, timing, backlog and memory gates. Promote the new default after both simulation implementations pass. |

On Three.js, `sim/station.ts` owns graph rules, `sim/crowdRouting.ts` is the starting point for the local policy, and `sim/world/World.ts` owns legs, occupancy, queues and job scheduling. `sim/worker.ts` receives playback and committed-edit events. In Unity, put sparse routing, local scoring and bounded search in pure `Metro.Sim`. Wire `StationRoutePlanner`, `StationServiceRuntime`, `StationWalkGraphWorkspace` and `StationSimulationSession` into the existing simulation and edit lifecycle. Keep caches and flags runtime-owned and keep the React shell and renderers reading the same passenger and service facts. Share fixtures and a TypeScript-to-C# oracle in `tools/unity-parity/` for region boundaries, candidate scores, deterministic tie breaks, budget carry-over and queue handoffs. Compare at the policy boundary using stable IDs, sorted iteration and shared integer hash vectors. Check existing cross-engine movement differences through behavior bands and travel times. [Web sim](../game/src/sim/world/World.ts) · [Unity sim](../unity/Assets/StationDesigner/Runtime/Sim/StationServiceRuntime.cs) · [Parity tools](../tools/unity-parity)

## 6. Acceptance before changing the default

### Functional and visual checks

- Replay a wide empty hall, then the same hall with a blocked or crowded lane. Use cross-sections at fixed distances from the entrance and count occupied lateral tiles and busiest-lane share over time. Require wider approaches before queue entry, plus footage at fixed camera and speed showing steady forward motion. A single escalator entrance should still form a queue and retain its discharge rate.
- Compare two connectors at similar travel cost, then load one with a queue. The empty approach should take more arrivals when it offers a better trip. Exercise opposing directions at gate banks, a forced one-way gate, escalator direction, stairs and walkways, intermediate and chained lifts, and a step-free-only route. Check boarding by individual door, queue handoff, exit completion and stop visits.
- Exercise a U-shaped obstacle, disconnected regions on the same level, stacked floors, a narrow doorway along a sector border, blocked diagonals, fare barriers and nonstandard landings. On static fixtures compare connectivity with the exact planner and score free-flow route stretch against the shortest legal route. Check that every consumed walking edge is legal and short plans make progress toward a valid service or destination.
- Replay insert/delete/move, undo/redo, repeated pause/resume, rollback, station switch and clock scrub. Track preserved field IDs and segment IDs after an unrelated edit, and invalidate a queued search or claim while it is in flight. Check a gate and a lift removed while approaching, queued and riding. Verify that passengers with pending repairs eventually resume or follow the existing unreachable-trip policy after a confirmed disconnect.
- Start with `crowd-routing`, `walking-space`, `diagonal-walk`, `gate-traffic`, `lift`, `walkways`, `population-edit`, `nonstructural-updates` and `worker-preview` on Three.js. On Unity use `StationRoutePlannerTests`, `StationServiceFrameTests`, `StationSimulationSessionTests`, `ZooGatePathTests`, `TianheGatePathTests` and the edit rollback fixtures. Add deterministic work-cap, reachability and spread tests to the owning suites. Use `metro-editor.ps1` for live Editor tests and scene capture, and `metro-unity.ps1` for isolated runs and WebGL packs. [Web tests](../game/test) · [Unity tests](../unity/Assets/StationDesigner/Tests/EditMode) · [Live Editor workflow](../unity/README.md#live-editor-test-workflow)

### Performance targets to calibrate in Phase A

Use Zoo and Tanwei as scale controls and Tianhe Park as the stress case. Match starting save, clock, seed, train release, demand, quality, camera, viewport and DPR. Compare first Play, warm steady state, a train discharging, and a walking edit committed while paused followed by Play and while already playing. Use the web `bench:sim` and `bench:sim-stalls` harnesses and the Unity `TianheParkPeakRushSimulationAndRouteProfile` fixture, then verify presented frames on Windows and hardware WebGL. Use identical trip requests in a planner-only replay to compare work even if crowd timing changes. Record cold and warm costs, p50/p95/max simulation and planning time, full/coarse/local expansions, field builds, hits and fallbacks, backlog age, path stretch, service flows, cache bytes, allocations and frame tails. Attribute costs with separate profiler runs. [Playback benchmarks](../.agents/skills/metro-repo/references/performance.md#simulation-playback-frame-tails) · [Unity rush fixture](../unity/Assets/StationDesigner/Tests/EditMode/StationServiceFrameTests.cs#L1512)

| Metric | Proposed first target |
| --- | --- |
| Spread | At least 25% lower busiest-lane share across two measured wide-hall approach sections than the seeded baseline. Measure outside the service queue. |
| Walking and service | At most 15% extra p95 travel distance in reachable obstacle-only, free-flow fixtures. At most 5% lower completion and connector throughput in the seeded single-route control. Preserve exact reachability and directional/accessibility rules. |
| Search work | At least 50% fewer total expansions across all planners and field builds in the matched warm Tianhe peak replay. Full-graph fallback below 1% of steady-state legs. Phase A sets a per-tick expansion budget and cache byte cap for each runtime. |
| Tick and frame tails | Seek at least 30% lower p95 simulation tick time on the matched peak case and check that request-to-movement delay and completion remain comparable. Retain at least 15 FPS 1% low in the existing Low/16× workload where already met, and measure progress toward that target on the heaviest case. |
| Edit and resume | Keep the repository's strict <100 ms ordinary-block first-feedback target. Track first moving frame and first route-ready tick after Play. A distant cell patch must preserve unaffected fields and valid paths. Refresh work respects the same budgets during resume and rush. |

Lock the baseline, fixture definitions and target adjustments before evaluating a candidate. Record measured results in the shared performance reference and keep raw captures under `.preview`. If route work falls but frame tails barely move, use stage timings and ablations to identify the remaining cost before investing further in route search. [Performance reference](../.agents/skills/metro-repo/references/performance.md)
