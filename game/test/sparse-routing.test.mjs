// Comprehensive deterministic regressions for sparse region routing, shared reverse
// distance fields, rolling 16-step local walking, soft claims, work-cap budgeting,
// edit retention and read-only preview (design/crowd-routing-plan.md §1–§6).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGraph, EDGE_KIND, PathFinder } from '../src/sim/station.ts'
import { buildSparseTopology } from '../src/sim/sparseGraph.ts'
import {
  floorDiv,
  hash32Jitter,
  hash32Tile,
  octantOf,
  packSectorKey,
  packTileKey,
  scoreTileMs,
  shortestOctantDifference,
  SoftClaimTable,
  StandingOccupancy,
  toMs,
  unpackSectorKey,
  unpackTileKey,
} from '../src/sim/sparsePolicy.ts'
import { SparseRouter } from '../src/sim/sparseRouter.ts'
import { World } from '../src/sim/world.ts'
import { referenceStation } from '../src/data/reference-station.ts'
import { scenarioStation } from './support/scenario-station.ts'

test('Tianhe Park Line 11 and Line 13 alighters walk away from the screen doors without fine-recovery stalls', () => {
  const station = referenceStation('tianhe')
  const world = new World(station, station.seed)
  const g = world.graph
  const router = world.sparseRouter
  const topo = router.topology

  // Line 13 uses Spanish-solution outer side platforms (up-escalator exit only) and a
  // reachable center island for boarding. Static region reachability must distinguish them
  // and reject unreachable queries with zero coarse/field expansions.
  const plat11 = g.platforms.find((p) => p.line === '11')
  const plat13Board = g.platforms.find((p) => p.id === 'edge-track-55-right')
  const plat13AlightOnly = g.platforms.find((p) => p.id === 'edge-track-55-left')
  assert.ok(plat11 && plat13Board && plat13AlightOnly, 'Tianhe Park Line 11 and Line 13 Spanish-solution platforms exist')
  const d11 = g.servers[plat11.doors[0]].node
  const d13Board = g.servers[plat13Board.doors[0]].node
  const d13AlightOnly = g.servers[plat13AlightOnly.doors[0]].node
  assert.equal(topo.canReach(d11, d13Board, false), true, 'Line 11 can reach Line 13 boarding island')
  assert.equal(topo.canReach(d11, d13AlightOnly, false), false, 'Line 11 cannot reach Line 13 alighting-only outer platform')

  router.captureCostSnapshot(world.path.gateWait)
  const beforeStats = router.stats()
  const unreachRes = router.startCoarseSearch(d11, d13AlightOnly, { stepFree: false, luggage: false }, -1, 0, 0)
  const afterStats = router.stats()
  assert.equal(unreachRes.status, 'no_path', 'unreachable target fails immediately without coarse search')
  assert.equal(afterStats.coarseExpansions, beforeStats.coarseExpansions, 'zero coarse expansions for unreachable target')
  assert.equal(afterStats.fieldExpansions, beforeStats.fieldExpansions, 'zero field expansions for unreachable target')

  const landingPositions = new Map()
  const walkedFromDoor = new Set()
  const line11Landing = new Map()
  const line11Walked = new Set()
  for (let tick = 0; tick < 90; tick++) {
    world.tickOnce()
    for (const passenger of world.pool.live) {
      if (passenger.dead || passenger.train >= 0) continue
      if (passenger.trip.origin === 'train:13') {
        const landing = landingPositions.get(passenger.id)
        if (!landing) {
          landingPositions.set(passenger.id, { x: passenger.x, y: passenger.y, z: passenger.z })
        } else if (Math.hypot(passenger.x - landing.x, passenger.y - landing.y, passenger.z - landing.z) >= 1) {
          walkedFromDoor.add(passenger.id)
        }
      } else if (passenger.trip.origin === 'train:11') {
        const landing = line11Landing.get(passenger.id)
        if (!landing) {
          line11Landing.set(passenger.id, { x: passenger.x, y: passenger.y, z: passenger.z })
        } else if (Math.hypot(passenger.x - landing.x, passenger.y - landing.y, passenger.z - landing.z) >= 1) {
          line11Walked.add(passenger.id)
        }
      }
    }
  }

  const endStats = world.routingStats()
  assert.ok(landingPositions.size >= 500, 'both Line 13 directions discharged their arrival waves')
  assert.ok(walkedFromDoor.size >= 490, `only ${walkedFromDoor.size} Line 13 riders moved a metre beyond their landing position`)
  assert.ok(line11Landing.size >= 400, 'both Line 11 directions discharged their arrival waves')
  assert.ok(line11Walked.size >= line11Landing.size - 15, `only ${line11Walked.size}/${line11Landing.size} Line 11 riders walked away from their doors`)
  assert.equal(endStats.fineExpansions, 0, 'unreachable targets never trigger futile fine-graph recovery expansions')
  assert.equal(endStats.pendingFineJobs, 0, 'no fine-graph recovery backlog left at 06:31:30')
})

function wideHallStation({ width = 11, length = 30, twoConnectors = false, diagonalOffset = false } = {}) {
  const cells = []
  const yMid = Math.floor(width / 2)
  for (let x = 0; x < length; x++) {
    for (let y = 0; y < width; y++) cells.push({ x, y, z: 9, fill: 'solid', zone: 'unpaid' })
  }
  for (let x = length + 3; x <= length + 12; x++) {
    for (let y = 0; y < width; y++) cells.push({ x, y, z: 4, fill: 'solid', zone: 'unpaid' })
  }
  const escY = diagonalOffset ? width - 2 : yMid
  const modules = [
    { id: 'exit-in', type: 'exit', x: 1, y: diagonalOffset ? 1 : yMid, z: 9, rot: 0, cfg: { name: 'In', open: false, inRate: 0, headHouse: false } },
    { id: 'exit-out', type: 'exit', x: length + 11, y: yMid, z: 4, rot: 0, cfg: { name: 'Out', open: true, inRate: 0, headHouse: false } },
  ]
  if (twoConnectors) {
    modules.push(
      { id: 'esc-1', type: 'escalator', x: length - 4, y: 2, z: 9, rot: 0, from: { x: length - 4, y: 2, z: 9 }, to: { x: length + 5, y: 2, z: 4 }, cfg: { dir: 'down', width: 1 } },
      { id: 'esc-2', type: 'escalator', x: length - 4, y: width - 3, z: 9, rot: 0, from: { x: length - 4, y: width - 3, z: 9 }, to: { x: length + 5, y: width - 3, z: 4 }, cfg: { dir: 'down', width: 1 } },
    )
  } else {
    modules.push(
      { id: 'esc-1', type: 'escalator', x: length - 4, y: escY, z: 9, rot: 0, from: { x: length - 4, y: escY, z: 9 }, to: { x: length + 5, y: escY, z: 4 }, cfg: { dir: 'down', width: 1 } },
    )
  }
  return { name: 'wide-hall', seed: 42, cells, modules, lines: [] }
}

test('policy primitives: half-up ms rounding, negative floorDiv, monotonic keys and exact scoring', () => {
  assert.equal(toMs(0), 0)
  assert.equal(toMs(0.0005), 1, '0.5 ms rounds half up to 1')
  assert.equal(toMs(0.0004), 0)
  assert.equal(toMs(1 / 1.34), 746)
  assert.equal(floorDiv(-1, 16), -1, 'negative coordinates land in sector -1')
  assert.equal(floorDiv(-16, 16), -1)
  assert.equal(floorDiv(-17, 16), -2)
  assert.equal(floorDiv(0, 16), 0)
  assert.equal(floorDiv(15, 16), 0)
  assert.equal(floorDiv(16, 16), 1)

  const kNeg = packTileKey(-17, -5, -10)
  const kZero = packTileKey(0, 0, 0)
  const kHalf = packTileKey(3, 4, 5)
  assert.ok(kNeg < kZero && kZero < kHalf, 'tile key preserves (tz2, tx, ty) order')
  assert.deepEqual(unpackTileKey(kNeg), { tx: -17, ty: -5, tz2: -10 })
  assert.deepEqual(unpackTileKey(kHalf), { tx: 3, ty: 4, tz2: 5 })

  const sk = packSectorKey(-2, 3, -10)
  assert.deepEqual(unpackSectorKey(sk), { sx: -2, sy: 3, tz2: -10 })

  assert.equal(shortestOctantDifference(0, 7), 1)
  assert.equal(shortestOctantDifference(0, 4), 4)
  assert.equal(octantOf(1, 1), 1)
  assert.equal(octantOf(-1, 0), 4)

  // Concrete plan §4.3 example: clear diagonal (+300 ms walk) beats straight with 1 claim (+650 ms)
  // even with 50 ms turn penalty and max 99 ms jitter difference.
  const straight = scoreTileMs(746, 5000, 0, 0, 4, 1, 0, 0, 42, 7, 1, 10, 5, 0)
  const diagonal = scoreTileMs(1054, 5000, 0, 0, 4, 0, 0, 1, 42, 7, 1, 10, 6, 0)
  assert.ok(diagonal < straight, `clear diagonal (${diagonal}) beats claimed straight (${straight})`)

  // Caps bound density at 2500 ms and claims at 1300 ms so narrow corridors remain passable.
  const saturated = scoreTileMs(746, 0, 50, 200, 4, 20, 0, 0, 42, 1, 0, 0, 0, 0, { useBias: false })
  assert.equal(saturated, 746 + 2500 + 1300)

  // Deterministic hash stability
  assert.equal(hash32Tile(42, -3, 12, 0), hash32Tile(42, -3, 12, 0))
  assert.equal(hash32Jitter(42, 7, 2, 10, 5, 0), hash32Jitter(42, 7, 2, 10, 5, 0))
})

test('soft claim table counts other agents, expires by TTL, releases and remaps cleanly', () => {
  const claims = new SoftClaimTable(10)
  claims.refresh(1, 3, 4, 10, 4)
  claims.refresh(2, 3, 5, 10, 4)
  assert.equal(claims.countOtherAgentsOn(3, 1), 1, 'agent 1 sees agent 2 on tile 3')
  assert.equal(claims.countOtherAgentsOn(3, 3), 2, 'agent 3 sees both 1 and 2 on tile 3')
  claims.expire(13)
  assert.equal(claims.activeCount, 2, 'claims live before TTL expiry')
  claims.expire(14)
  assert.equal(claims.activeCount, 0, 'claims expire at TTL')
  claims.refresh(1, 2, 7, 20, 5)
  claims.remap(10, (n) => (n === 2 ? 8 : -1))
  assert.equal(claims.countOtherAgentsOn(8, 99), 1, 'surviving tile remaps')
  assert.equal(claims.countOtherAgentsOn(7, 99), 0, 'deleted tile claim drops')
})

test('sector boundaries split openings divided by a fence and preserve U-shaped obstacles & doorways', () => {
  const cells = []
  // Span two 16×16 sectors across x=15 | x=16 seam, y=0..10
  for (let x = 0; x <= 31; x++) {
    for (let y = 0; y <= 10; y++) cells.push({ x, y, z: 4, fill: 'solid', zone: 'unpaid' })
  }
  // Place a fence at (15, 5, 4) splitting the x=15->16 seam into two separate openings (y=0..4 and y=6..10).
  // Add a U-shaped obstacle in sector 0 around (6..10, 3..7).
  const modules = [
    { id: 'fence-split', type: 'fence', x: 15, y: 5, z: 4, rot: 0, cfg: {} },
    { id: 'u1', type: 'fence', x: 9, y: 4, z: 4, rot: 0, cfg: {} },
    { id: 'u2', type: 'fence', x: 9, y: 5, z: 4, rot: 0, cfg: {} },
    { id: 'u3', type: 'fence', x: 9, y: 6, z: 4, rot: 0, cfg: {} },
    { id: 'u4', type: 'fence', x: 8, y: 4, z: 4, rot: 0, cfg: {} },
    { id: 'u5', type: 'fence', x: 8, y: 6, z: 4, rot: 0, cfg: {} },
  ]
  const g = buildGraph({ name: 'seam', seed: 1, cells, modules, lines: [] })
  const { topology } = buildSparseTopology(g, 1)
  const leftReg = topology.regions[topology.nodeRegion[g.nodeIndex.get('0,0,4')]]
  const rightReg = topology.regions[topology.nodeRegion[g.nodeIndex.get('20,0,4')]]
  const seamCrossings = leftReg.crossings.filter((c) => c.toRegion === rightReg.id)
  assert.equal(seamCrossings.length, 2, 'fence at y=5 splits the sector seam into two distinct crossings')

  // Verify walking out of the U-shaped pocket reaches the far side using strictly legal edges.
  const data = {
    name: 'u-trap',
    seed: 5,
    cells,
    modules: [
      ...modules,
      { id: 'exit-goal', type: 'exit', x: 25, y: 5, z: 4, rot: 0, cfg: { name: 'E', open: true, inRate: 0, headHouse: false } },
    ],
    lines: [],
  }
  const w = new World(data, 5, { routingMode: 'sparse' })
  const a = w.pool.spawn({ origin: '', stops: [], dest: 'exit:exit-goal' }, 8.5, 5.5, 5, 0)
  a.needs = { stepFree: false, luggage: false }
  for (let t = 0; t < 80 && !a.dead; t++) w.tickOnce()
  assert.equal(w.metrics.exited, 1, 'walker exits out of a U-shaped obstacle across the split sector seam')
  assert.equal(w.metrics.stuck, 0)
})

test('angled wide-hall approach spreads passengers broadly vs tapering legacy stream, while single escalator drains', () => {
  function runCase(opts) {
    const data = wideHallStation({ width: 11, length: 30, diagonalOffset: true })
    const w = new World(data, 42, opts)
    const sections = [16, 22]
    const laneHits = Object.fromEntries(sections.map((sx) => [sx, new Map()]))
    let spawned = 0
    let maxQueue = 0
    for (let t = 0; t < 130; t++) {
      if (t < 12) {
        const batch = Math.ceil((60 - spawned) / (12 - t))
        for (let k = 0; k < batch && spawned < 60; k++) {
          const a = w.pool.spawn({ origin: 'exit:exit-in', stops: [], dest: 'exit:exit-out' }, 1.5, 1.5, 10, w.tick)
          a.needs = { stepFree: false, luggage: false }
          spawned++
        }
      }
      w.tickOnce()
      maxQueue = Math.max(maxQueue, w.metrics.escalatorQueue)
      for (const a of w.pool.live) {
        if (a.dead || a.state !== 1 || Math.abs(a.z - 10) > 0.25) continue
        const ix = Math.floor(a.x), iy = Math.floor(a.y)
        for (const sx of sections) {
          if (ix === sx) {
            const m = laneHits[sx]
            m.set(iy, (m.get(iy) ?? 0) + 1)
          }
        }
      }
    }
    const share = (sx) => {
      const m = laneHits[sx]
      const tot = [...m.values()].reduce((a, b) => a + b, 0)
      return tot > 0 ? Math.max(...m.values()) / tot : 1
    }
    return {
      exited: w.metrics.exited,
      stuck: w.metrics.stuck,
      maxQueue,
      lanes16: laneHits[16].size,
      lanes22: laneHits[22].size,
      share16: share(16),
      share22: share(22),
    }
  }

  const legacy = runCase({ routingMode: 'legacy' })
  const sparse = runCase({ routingMode: 'sparse' })
  assert.ok(sparse.exited >= 55, `sparse completed ${sparse.exited}/60`)
  assert.equal(sparse.stuck, 0)
  assert.ok(sparse.maxQueue > 0, 'single escalator still forms a real queue')
  assert.ok(sparse.lanes16 >= 7 && sparse.lanes22 >= 6, `occupied lateral tiles: ${sparse.lanes16}, ${sparse.lanes22}`)
  assert.ok(
    sparse.share16 < legacy.share16 && sparse.share22 <= legacy.share22 * 0.75,
    `sparse busiest-lane share (${sparse.share16.toFixed(3)}, ${sparse.share22.toFixed(3)}) must beat legacy (${legacy.share16.toFixed(3)}, ${legacy.share22.toFixed(3)})`,
  )

  // Phase B ablation: compare density alone, density + bias, and density + bias + claims.
  const densityOnly = runCase({ routingMode: 'sparse', sparseOptions: { useDensity: true, useBias: false, useClaims: false } })
  const densityBias = runCase({ routingMode: 'sparse', sparseOptions: { useDensity: true, useBias: true, useClaims: false } })
  const fullLocal = sparse
  assert.ok(densityOnly.exited >= 50 && densityBias.exited >= 50 && fullLocal.exited >= 55, 'all Phase B ablations drain cleanly')
  assert.ok(fullLocal.lanes16 >= 7, 'full density+bias+claims keeps broad lateral spread')
})

test('two connectors balance arrivals onto the unloaded escalator', () => {
  const data = wideHallStation({ width: 11, length: 30, twoConnectors: true })
  const w = new World(data, 42, { routingMode: 'sparse' })
  const [esc1, esc2] = w.graph.servers.filter((s) => s.kind === 'escalator')
  const exitNode = w.graph.exits.find((e) => e.id === 'exit-out').node
  // Load esc1 with 35 queued riders so esc2 is substantially faster.
  for (let i = 0; i < 35; i++) {
    const q = w.pool.spawn({ origin: '', stops: [], dest: 'exit:exit-out' }, w.graph.nodeX[esc1.node], w.graph.nodeY[esc1.node], w.graph.nodeZ[esc1.node], 0)
    q.legs = [{ node: exitNode, kind: 'exit', ref: 'exit:exit-out' }]
    q.destNode = exitNode
    q.path = Int32Array.from([esc1.node, esc1.exitNode])
    q.pathIdx = 1
    q.server = esc1.id
    q.state = 2
    esc1.queue.push(q.id)
  }
  const fresh = []
  for (let i = 0; i < 30; i++) {
    const a = w.pool.spawn({ origin: '', stops: [], dest: 'exit:exit-out' }, 1.5, 5.5, 10, 0)
    a.needs = { stepFree: false, luggage: false }
    fresh.push(a)
  }
  let esc1Fresh = 0, esc2Fresh = 0
  const counted = new Set()
  for (let t = 0; t < 120; t++) {
    w.tickOnce()
    for (const a of fresh) {
      if (counted.has(a.id)) continue
      if (a.server === esc1.id) { esc1Fresh++; counted.add(a.id) }
      else if (a.server === esc2.id) { esc2Fresh++; counted.add(a.id) }
    }
  }
  assert.ok(esc2Fresh > esc1Fresh, `unloaded esc2 (${esc2Fresh}) must attract more arrivals than loaded esc1 (${esc1Fresh})`)
  assert.equal(w.metrics.stuck, 0)
})

test('remote structural edit preserves unaffected fields and active walking segments; sample refresh obeys Pause->Play and elapsed ticks', () => {
  // Large 48×16 hall spanning 3 sectors horizontally (x=0..15, 16..31, 32..47).
  const cells = []
  for (let x = 0; x < 48; x++) {
    for (let y = 0; y < 12; y++) cells.push({ x, y, z: 4, fill: 'solid', zone: 'unpaid' })
  }
  const data = {
    name: 'edit-retention',
    seed: 17,
    cells,
    modules: [
      { id: 'exit-b', type: 'exit', x: 30, y: 5, z: 4, rot: 0, cfg: { name: 'B', open: true, inRate: 0, headHouse: false } },
    ],
    lines: [],
  }
  const w = new World(data, 17, { routingMode: 'sparse' })
  const a = w.pool.spawn({ origin: '', stops: [], dest: 'exit:exit-b' }, 1.5, 5.5, 5, 0)
  a.needs = { stepFree: false, luggage: false }
  for (let i = 0; i < 4; i++) w.tickOnce()
  assert.equal(a.state, 1, 'walker is moving')
  assert.ok(a.path.length > a.pathIdx, 'walker has an active rolling segment')
  const fieldsBefore = w.routingStats().fieldCacheEntries
  assert.ok(fieldsBefore > 0, 'fields are warm before edit')

  // Distant edit in sector (2, 0) at x=46 — far from walker in sector (0, 0) and exit in sector (1, 0).
  w.data = {
    ...w.data,
    modules: [...w.data.modules, { id: 'remote-fence', type: 'fence', x: 46, y: 10, z: 4, rot: 0, cfg: {} }],
  }
  w.rebuild()
  const afterRemote = w.routingStats()
  assert.ok(afterRemote.fieldsPreservedOnEdit > 0, `distant edit preserved ${afterRemote.fieldsPreservedOnEdit} unaffected fields`)
  assert.equal(a.state, 1, 'walker outside edited sector kept walking without reset')
  assert.ok(a.path.length > 0, 'walker kept its remapped maximal legal prefix')

  // Real Pause -> Play schedules optional refresh for dirty sector.
  w.notifyPlayResumed()
  w.tickOnce()
  const afterResume = w.routingStats()
  assert.ok(afterResume.samplesRefreshed > 0, 'Pause->Play refreshed dirty sector samples')

  // Clean resume queues zero sample refresh work.
  const refreshedCount = afterResume.samplesRefreshed
  w.notifyPlayResumed()
  w.tickOnce()
  assert.equal(w.routingStats().samplesRefreshed, refreshedCount, 'clean resume queues zero refresh work')

  // Clock scrub (seek) does not disturb elapsed-tick refresh schedule; 60 elapsed ticks triggers refresh.
  w.data = {
    ...w.data,
    modules: [...w.data.modules, { id: 'remote-fence-2', type: 'fence', x: 45, y: 10, z: 4, rot: 0, cfg: {} }],
  }
  w.rebuild()
  const beforeScrub = w.routingStats().samplesRefreshed
  w.seek(w.simTime + 3600)
  for (let i = 0; i < 5; i++) w.tickOnce()
  assert.equal(w.routingStats().samplesRefreshed, beforeScrub, 'clock scrub alone does not fire the 60-sim-second refresh early')
  for (let i = 0; i < 60; i++) w.tickOnce()
  assert.ok(w.routingStats().samplesRefreshed > beforeScrub, '60 elapsed ticks fires the coalesced sample refresh')

  // Same-document restart retains validated fields while clearing live claims & crowd.
  const fieldsBeforeRestart = w.routingStats().fieldCacheEntries
  w.restart()
  assert.equal(w.pool.count, 0)
  assert.equal(w.routingStats().activeClaims, 0)
  assert.equal(w.routingStats().fieldCacheEntries, fieldsBeforeRestart, 'restart retains validated static fields')

  // New-document load bumps sessionId and clears fields.
  const prevSession = w.sparseRouter.sessionId
  w.load(data, 17)
  assert.equal(w.sparseRouter.sessionId, prevSession + 1, 'new document load creates a new session')
  assert.equal(w.routingStats().fieldCacheEntries, 0, 'new document load starts with fresh field cache')
})

test('strict work-cap budget carries frontiers across ticks deterministically without starving walkers', () => {
  const data = scenarioStation()
  function runWithTightBudget() {
    const w = new World(data, 123, {
      routingMode: 'sparse',
      sparseOptions: { mandatoryPopBudget: 600, mandatoryScanBudget: 2400, localRefillBudget: 16 },
    })
    for (let t = 0; t < 180; t++) w.tickOnce()
    return {
      pop: w.pool.count,
      exited: w.metrics.exited,
      boarded: w.metrics.boarded,
      positions: w.pool.live.map((a) => [a.id, +a.x.toFixed(4), +a.y.toFixed(4), +a.z.toFixed(4)]),
      stats: w.routingStats(),
    }
  }
  const a = runWithTightBudget()
  const b = runWithTightBudget()
  assert.deepEqual(a, b, 'tight work-cap budget replays bit-for-bit deterministically')
  assert.ok(a.stats.localRefills > 0, 'walkers still make progress under tight budgets')
})

test('free-flow sparse route stretch stays within 15% of exact shortest path and preserves reachability', () => {
  const data = scenarioStation()
  const w = new World(data, 55, { routingMode: 'sparse' })
  const g = w.graph
  const exact = new PathFinder(g)
  const router = w.sparseRouter
  router.captureCostSnapshot(null)
  const needs = { stepFree: false, luggage: false }

  const samples = []
  const step = Math.max(1, Math.floor(g.nodeCount / 40))
  for (let i = 0; i < g.nodeCount; i += step) samples.push(i)
  const ratios = []
  let pairsChecked = 0
  for (let i = 0; i < Math.min(12, samples.length); i++) {
    for (let j = i + 1; j < Math.min(12, samples.length); j++) {
      const u = samples[i], v = samples[j]
      const exactPath = exact.astar(u, v, needs, false)
      const res = router.startCoarseSearch(u, v, needs, -1, 0, 0)
      let itin = res.status === 'ready' ? res.itinerary : null
      if (res.status === 'pending' && res.jobId !== undefined) {
        const done = router.stepCoarseJobNow(res.jobId, 500000, 2000000)
        itin = done?.status === 'ready' ? done.result : null
      }
      if (!exactPath) {
        assert.equal(itin, null, 'unreachable pair must also be unreachable in sparse search')
        continue
      }
      assert.ok(itin !== null, `reachable pair (${u} -> ${v}) must be reachable in sparse search`)
      let exactCost = 0
      for (let k = 1; k < exactPath.length; k++) {
        for (let e = g.adjStart[exactPath[k - 1]]; e < g.adjStart[exactPath[k - 1] + 1]; e++) {
          if (g.adjTo[e] === exactPath[k]) {
            exactCost += g.adjCost[e]
            if (g.adjKind[e] === EDGE_KIND.stair) exactCost += 32
            if (g.adjKind[e] === EDGE_KIND.lift) exactCost += 300
            break
          }
        }
      }
      if (exactCost > 1) {
        ratios.push((itin.totalCostMs / 1000) / exactCost)
        pairsChecked++
      }
    }
  }
  assert.ok(pairsChecked >= 10, `checked ${pairsChecked} reachable pairs`)
  ratios.sort((a, b) => a - b)
  const p95 = ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * 0.95))]
  assert.ok(p95 <= 1.15, `free-flow p95 route stretch ${p95.toFixed(3)} exceeds 1.15`)
})

test('blocked walkers receive local refills ahead of speculative crowded-tail trims', () => {
  const data = wideHallStation({ width: 5, length: 24 })
  const w = new World(data, 42, {
    routingMode: 'sparse',
    sparseOptions: { localRefillBudget: 4 },
  })
  // Spawn 16 closely-packed walkers ahead of a fresh wave so every tick triggers crowdedAhead trims.
  for (let i = 0; i < 16; i++) {
    const a = w.pool.spawn({ origin: 'exit:exit-in', stops: [], dest: 'exit:exit-out' }, 2.5 + (i % 4), 2.5, 10, 0)
    a.needs = { stepFree: false, luggage: false }
  }
  for (let t = 0; t < 4; t++) w.tickOnce()

  // Add 4 newly-arrived blocked walkers at the tail of `pool.live`.
  const freshIds = []
  for (let i = 0; i < 4; i++) {
    const a = w.pool.spawn({ origin: 'exit:exit-in', stops: [], dest: 'exit:exit-out' }, 1.5, 1.5 + i * 0.5, 10, 4)
    a.needs = { stepFree: false, luggage: false }
    freshIds.push(a.id)
  }
  // Tick twice (one to solve/adopt coarse itinerary if cold, one to guarantee initial refill).
  w.tickOnce()
  w.tickOnce()

  const active = new Map(w.pool.live.map((a) => [a.id, a]))
  for (const id of freshIds) {
    const a = active.get(id)
    assert.ok(a && !a.awaitingPath && a.path.length > a.pathIdx, `fresh blocked walker ${id} must not be starved by crowded-tail trims`)
  }
})
