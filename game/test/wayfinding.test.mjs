// Wayfinding (§7.2's path cost, §7.3's crowd, §7.4a's needs).
//
// Two complaints, one subject: a crowd that all picks the same thing.
//
// * **The elevator is not for commuters.** A lift edge is a single 40 s hop
//   between any two floors, so the moment the escalator queue passes a couple of
//   minutes A* hands the lift the whole wave and the one cabin a station owns is
//   asked to carry the morning peak. What a lift *costs* is a fact about the
//   passenger, not about the edge (`liftPenalty`): a step-free passenger is
//   charged nothing because the lift is the only way down they have, a passenger
//   with luggage minds it a little, and everyone else minds it a great deal —
//   but not infinitely, so the lift is still the pressure valve when the ramps
//   really are jammed.
// * **A crowd is part of the cost.** `waitQ` prices a queue that has formed; the
//   bodies still walking towards it are invisible to A*, which is how a whole
//   wave commits to the same turnstile and then stands in front of it. The world
//   prices them per node (`priceCongestion`) and the fare line is decided
//   *approaching* the gates rather than while standing in one (`chooseGate`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIFT_AVOID_LUGGAGE_S, LIFT_AVOID_S, GATE_LOOKAHEAD, GATE_REPLAN_PER_TICK, REROUTE_REPLAN_PER_TICK, CONGESTION_CAP, CONGESTION_S } from '../src/sim/constants.ts'
import { escalatorModule } from '../src/sim/escalators.ts'
import { exitWallPlanes } from '../src/sim/exits.ts'
import { liftModule } from '../src/sim/lifts.ts'
import { buildGraph, congestionCost, EDGE_KIND, liftPenalty, PathFinder } from '../src/sim/station.ts'
import { World } from '../src/sim/world.ts'
import { scenarioStation } from './support/scenario-station.ts'

const STOREY = 4
const WALKER = { stepFree: false, luggage: false }
const LUGGAGE = { stepFree: false, luggage: true }
const STEP_FREE = { stepFree: true, luggage: false }

/** A plate of floor at one storey, `z` being the floor block (walk at z + 1). */
function plate(cells, x0, x1, y0, y1, z, zone = 'unpaid') {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) cells.push({ x, y, z, fill: 'solid', zone })
  }
}

/* ------------------------------------------------------- the cost of a lift */

test('a lift edge costs what the passenger can avoid paying', () => {
  assert.equal(liftPenalty(STEP_FREE), 0, 'a step-free passenger must not be charged for the only way down')
  assert.equal(liftPenalty(LUGGAGE), LIFT_AVOID_LUGGAGE_S)
  assert.equal(liftPenalty(WALKER), LIFT_AVOID_S)
  assert.ok(0 < LIFT_AVOID_LUGGAGE_S && LIFT_AVOID_LUGGAGE_S < LIFT_AVOID_S, 'luggage minds the lift less than a free walker')
})

test('the crowd charge is capped, so a crush is not a wall', () => {
  assert.equal(congestionCost(-1), 0, 'an empty cell the density pass left at -1 costs nothing')
  assert.equal(congestionCost(0), 0)
  assert.equal(congestionCost(3), 3 * CONGESTION_S)
  assert.equal(congestionCost(CONGESTION_CAP + 40), CONGESTION_CAP * CONGESTION_S, 'past the cap one more body is not another second')
})

/* ------------------------------------------------- elevator versus the ramp */

/**
 * Two storeys, a lift and an escalator between them, and an exit on the top
 * floor beside the lift. The two runs start within a couple of metres of each
 * other, so the *ride* is what separates them: the escalator's 14 s against the
 * lift's 40 s cycle.
 */
function twoStoreyStation() {
  const cells = []
  plate(cells, 0, 8, 0, 8, 0)
  plate(cells, 0, 8, 0, 8, STOREY)
  const modules = [
    liftModule({ x: 1, y: 1, z: 0 }, 0, 'lift-1'),
    escalatorModule({ x: 5, y: 1, z: 0 }, 0, 'up', 'esc-1'),
    { id: 'exit-1', type: 'exit', x: 0, y: 0, z: STOREY, cfg: { name: 'A口', inRate: 0, open: true, headHouse: false } },
  ]
  return { name: 't', seed: 1, cells, modules, lines: [] }
}

/** The queue depth that makes an escalator's *estimated* wait `seconds`. */
function stackEscalatorQueue(g, seconds) {
  const esc = g.servers.find((s) => s.kind === 'escalator')
  const want = Math.round(seconds * esc.rate)
  for (let i = 0; i < want; i++) esc.queue.push(100000 + i)
  return esc
}

/** The edge kinds a path walks, in order. */
function kindsAlong(g, path) {
  const out = []
  for (let i = 0; i + 1 < path.length; i++) {
    for (let e = g.adjStart[path[i]]; e < g.adjStart[path[i] + 1]; e++) {
      if (g.adjTo[e] === path[i + 1]) {
        out.push(g.adjKind[e])
        break
      }
    }
  }
  return out
}

test('a walker takes the ramp where a step-free passenger must take the lift', () => {
  const g = buildGraph(twoStoreyStation())
  const from = g.nodeIndex.get('0,0,0')
  const to = g.nodeIndex.get('0,0,4')
  assert.notEqual(from, undefined, 'the lower plate is walkable')
  assert.notEqual(to, undefined, 'the upper plate is walkable')

  // A 100 s escalator queue: short enough that a walker still prefers the walk,
  // long enough that the lift is genuinely the better door-to-door trip.
  const esc = stackEscalatorQueue(g, 100)
  assert.ok(Math.abs((esc.queue.length / esc.rate) - 100) < 2, 'the escalator wait is the one the test asked for')

  const finder = new PathFinder(g)
  const walker = finder.search(from, to, WALKER)
  const luggage = finder.search(from, to, LUGGAGE)
  const stepFree = finder.search(from, to, STEP_FREE)
  assert.ok(walker && luggage && stepFree, 'every class can reach the top')

  assert.ok(kindsAlong(g, walker).includes(EDGE_KIND.escalator), 'a free walker queued for the lift instead of walking to the ramp')
  assert.ok(!kindsAlong(g, walker).includes(EDGE_KIND.lift), 'a free walker rode the lift')
  assert.ok(kindsAlong(g, luggage).includes(EDGE_KIND.lift), 'a passenger with luggage was priced off the lift')
  assert.ok(kindsAlong(g, stepFree).includes(EDGE_KIND.lift), 'a step-free passenger was priced off the only way down')
})

test('the lift is still the pressure valve when the ramps are jammed', () => {
  // Four hundred seconds of escalator queue. Every passenger who is able to walk
  // that far would rather ride: the penalty is a preference, not a ban.
  const g = buildGraph(twoStoreyStation())
  stackEscalatorQueue(g, 400)
  const walker = new PathFinder(g).search(g.nodeIndex.get('0,0,0'), g.nodeIndex.get('0,0,4'), WALKER)
  assert.ok(walker, 'the station is still connected')
  assert.ok(kindsAlong(g, walker).includes(EDGE_KIND.lift), 'a jammed ramp left the walker with no way up')
})

/* -------------------------------------------------- the crowd in the cost */

/**
 * A corridor three rows wide with a fare line across it and **two** turnstiles,
 * one at each outer row, so there are two ways to cross and the middle row has
 * to pick one. Both crossings cost the same walk, which is what makes the test
 * about the price of the node rather than about the shape of the floor.
 */
function twoGateStation() {
  const cells = []
  plate(cells, 0, 6, 0, 2, 0, 'unpaid')
  for (const c of cells) if (c.x >= 4) c.zone = 'paid'
  const modules = [
    { id: 'gate-a', type: 'gate', x: 4, y: 0, z: 0, cfg: { dir: 'both' } },
    { id: 'gate-b', type: 'gate', x: 4, y: 2, z: 0, cfg: { dir: 'both' } },
    { id: 'exit-1', type: 'exit', x: 6, y: 1, z: 0, cfg: { name: 'A口', inRate: 0, open: true, headHouse: false } },
  ]
  return { name: 't', seed: 1, cells, modules, lines: [] }
}

/** The first gate server a path queues at, or -1. */
function gateAlong(g, path) {
  for (let i = 0; i < path.length; i++) {
    const srv = g.serverForNode.get(path[i])
    if (srv !== undefined && g.servers[srv].kind === 'gate') return srv
  }
  return -1
}

test('a crowded node steers the search to the other turnstile', () => {
  const g = buildGraph(twoGateStation(), true)
  const from = g.nodeIndex.get('0,1,0')
  const to = g.nodeIndex.get('6,1,0')
  const gateA = g.serverForNode.get(g.nodeIndex.get('4,0,0'))
  const gateB = g.serverForNode.get(g.nodeIndex.get('4,2,0'))
  assert.ok(from !== undefined && to !== undefined && gateA !== undefined && gateB !== undefined, 'both lanes are on the graph')
  assert.notEqual(gateA, gateB)

  const finder = new PathFinder(g)
  finder.congestion[g.nodeIndex.get('4,0,0')] = 60
  assert.equal(gateAlong(g, finder.search(from, to, WALKER)), gateB, 'the crowd at gate A did not push the passenger to gate B')

  // And the mirror image, so this is the price talking and not a tie-break that
  // happens to fall the same way twice.
  const mirror = new PathFinder(g)
  mirror.congestion[g.nodeIndex.get('4,2,0')] = 60
  assert.equal(gateAlong(g, mirror.search(from, to, WALKER)), gateA, 'the crowd at gate B did not push the passenger to gate A')
})

test('the world prices the crowd onto the graph before anything plans', () => {
  const w = new World(twoGateStation(), 5, { zoneBarriers: true })
  const g = w.graph
  const gateNode = g.nodeIndex.get('4,0,0')
  const farNode = g.nodeIndex.get('6,2,0')
  for (let i = 0; i < 8; i++) {
    w.pool.spawn({ origin: '', stops: [], dest: 'exit:exit-1' }, 3.5, 0.5, 1, 0)
  }
  assert.equal(w.path.congestion[gateNode], 0, 'a station with nobody standing next to the gate charges nothing for it')
  w.tickOnce()
  assert.ok(w.path.congestion[gateNode] > 0, 'the bodies at gate A were not priced')
  assert.equal(w.path.congestion[farNode], 0, 'and the empty floor at the far end was')
})

/* ------------------------------------------- a barrier belongs to a storey */

/**
 * Three stacked plates of the same plan, with a descending escalator between the
 * top two and an exit head-house standing on the top one. Used to pin what a
 * barrier blocks: the storeys its own body occupies, and no others.
 *
 * `esc` runs from (5,8,0) down to (5,2,-4) — a run in +y inside the cell column
 * x=5, so its balustrades lie either side of that column and a walk edge that
 * crosses the column is a walk edge through the glass.
 */
function stackedStation({ withExit }) {
  const cells = []
  for (const z of [0, -4, -8]) {
    for (let x = 0; x <= 10; x++) for (let y = 0; y <= 12; y++) cells.push({ x, y, z, fill: 'solid', zone: 'paid' })
  }
  const modules = [escalatorModule({ x: 5, y: 2, z: -4 }, 0, 'down', 'esc-1')]
  if (withExit) modules.push({ id: 'exit-1', type: 'exit', x: 8, y: 4, z: 0, cfg: { name: 'A口', inRate: 0, open: true, bays: 2 } })
  return { name: 't', seed: 1, cells, modules, lines: [] }
}

function edgeBetween(g, a, b) {
  const to = (x, y, z) => g.nodeIndex.get(`${x},${y},${z}`)
  const i = to(...a)
  const j = to(...b)
  if (i === undefined || j === undefined) return false
  for (let e = g.adjStart[i]; e < g.adjStart[i + 1]; e++) if (g.adjTo[e] === j) return true
  return false
}

test('a ramp balustrade blocks the storeys its run climbs, and no others', () => {
  const g = buildGraph(stackedStation({ withExit: false }))
  // The edge through the glass, beside the run's lower landing: refused there…
  assert.equal(edgeBetween(g, [4, 3, -4], [5, 3, -4]), false, 'a walk edge through the balustrade was allowed')
  assert.equal(edgeBetween(g, [5, 3, -4], [6, 3, -4]), false, 'the other balustrade let the crowd through')
  // …and free on a storey the run does not reach. A plane with no height on it
  // walled off every floor of the station below a ramp, which is what left the
  // 动物园 demo with one usable route out of its platform.
  assert.equal(edgeBetween(g, [4, 3, -8], [5, 3, -8]), true, 'a storey below the run was walled off by its balustrade')
  assert.equal(edgeBetween(g, [5, 3, -8], [6, 3, -8]), true, 'a storey below the run was walled off by its balustrade')
})

test('an exit head-house walls its own storey, not the concourse underneath it', () => {
  const g = buildGraph(stackedStation({ withExit: true }))
  const exit = { id: 'exit-1', type: 'exit', x: 8, y: 4, z: 0, rot: 0, cfg: { name: 'A口', inRate: 0, open: true, bays: 2 } }
  assert.ok(exitWallPlanes(exit).length > 0, 'the head-house has walls to test')

  // Every walk edge of the plan, at the head-house's own storey and one below.
  let blockedAbove = 0
  let blockedBelow = 0
  for (let x = 0; x <= 10; x++) {
    for (let y = 0; y <= 12; y++) {
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        const a = [x, y]
        const b = [x + dx, y + dy]
        const above = edgeBetween(g, [...a, 0], [...b, 0])
        const below = edgeBetween(g, [...a, -4], [...b, -4])
        if (!above && below) blockedAbove++
        if (above && !below) blockedBelow++
      }
    }
  }
  assert.ok(blockedAbove > 0, 'the head-house blocked nothing on the storey it stands on')
  assert.equal(blockedBelow, 0, 'a head-house walled off the concourse beneath it')
})

/* ----------------------------------------------- re-choosing at the fare line */

test('a passenger whose gate queue is past patience takes the next lane', () => {
  // §7.2's re-path trigger, on the fare line: the wait the passenger is standing
  // in is re-priced against the lane next door, and it moves when the search
  // finds it queuing somewhere else.
  const w = new World(twoGateStation(), 7, { zoneBarriers: true })
  const g = w.graph
  const gateA = g.servers[g.serverForNode.get(g.nodeIndex.get('4,0,0'))]
  const gateB = g.servers[g.serverForNode.get(g.nodeIndex.get('4,2,0'))]
  // A queue in front of the passenger, so the lane it is standing in is the slow
  // one: 60 passengers is a couple of minutes of turnstile.
  for (let i = 0; i < 60; i++) {
    const waiting = w.pool.spawn({ origin: '', stops: [], dest: 'exit:exit-1' }, 3.5, 0.5, 1, 0)
    waiting.state = 2
    waiting.server = gateA.id
    gateA.queue.push(waiting.id)
  }
  const a = w.pool.spawn({ origin: '', stops: [], dest: 'exit:exit-1' }, 3.5, 0.5, 1, 0)
  for (let i = 0; i < 5; i++) w.tickOnce()
  assert.ok(a.destNode >= 0 && a.path.length > 0, 'the passenger has a leg to walk')

  // Stand it at the back of gate A's queue with no patience left.
  a.x = 3.5
  a.y = 0.5
  a.state = 2
  a.server = gateA.id
  a.wait = 0
  a.patience = 0.5
  gateA.queue.push(a.id)

  w.tickOnce()
  assert.equal(gateA.queue.includes(a.id), false, 'the passenger is still queueing at the gate it gave up on')
  assert.equal(a.server, -1, 'the passenger is still attached to the old gate')
  assert.equal(gateAlong(g, a.path), gateB.id, 'the passenger did not pick the other lane')
})

test('patience re-routes are rationed: a crush retries over ticks, not all at once', () => {
  // `reRouteAroundQueue` is the same synchronous search as the fare-line choice,
  // fired from `queueTime` for every agent whose wait passed patience — so an
  // unrationed crush runs one full A* per impatient agent in the same tick.
  // `REROUTE_REPLAN_PER_TICK` caps the searches; a skipped agent keeps its place
  // and its patience clock restarts, so it retries after another interval.
  const w = new World(twoGateStation(), 7, { zoneBarriers: true })
  const g = w.graph
  const gateA = g.servers[g.serverForNode.get(g.nodeIndex.get('4,0,0'))]
  const gateB = g.servers[g.serverForNode.get(g.nodeIndex.get('4,2,0'))]
  for (let i = 0; i < 60; i++) {
    const waiting = w.pool.spawn({ origin: '', stops: [], dest: 'exit:exit-1' }, 3.5, 0.5, 1, 0)
    waiting.state = 2
    waiting.server = gateA.id
    gateA.queue.push(waiting.id)
  }
  const six = []
  for (let i = 0; i < 6; i++) {
    six.push(w.pool.spawn({ origin: '', stops: [], dest: 'exit:exit-1' }, 3.5, 0.5, 1, 0))
  }
  for (let i = 0; i < 5; i++) w.tickOnce()
  assert.ok(six.every((a) => a.destNode >= 0 && a.path.length > 0), 'every passenger has a leg to walk')
  for (const a of six) {
    // A warmup tick may already have queued one at the gate: re-queue at the back
    // or the taker is counted twice — once walking away, once still queued.
    for (const s of g.servers) {
      const qi = s.queue.indexOf(a.id)
      if (qi >= 0) s.queue.splice(qi, 1)
    }
    a.x = 3.5
    a.y = 0.5
    a.state = 2
    a.server = gateA.id
    a.wait = 0
    a.patience = 0.5
    gateA.queue.push(a.id)
  }

  w.tickOnce()
  const moved = six.filter((a) => a.server === -1)
  const stayed = six.filter((a) => gateA.queue.includes(a.id))
  assert.equal(moved.length, REROUTE_REPLAN_PER_TICK, 'every impatient agent re-routed in the same tick')
  assert.equal(stayed.length, six.length - REROUTE_REPLAN_PER_TICK, 'a skipped agent lost its place in the queue')
  for (const a of stayed) assert.equal(a.wait, 0, 'a skipped agent retries only after another patience interval')
  for (const a of moved) assert.equal(gateAlong(g, a.path), gateB.id, 'a re-routed agent did not take the other lane')
})

test('the fare-line ration holds at the gate: a wave chooses over ticks', () => {
  // `chooseGate` used to skip its ration for an agent standing at the gate, so a
  // wave arriving together ran one synchronous search per agent in the same tick.
  // Rationed, only `GATE_REPLAN_PER_TICK` choose per tick; a skipped agent keeps
  // `gateChosen` false and retries next tick.
  const w = new World(twoGateStation(), 11, { zoneBarriers: true })
  const g = w.graph
  const gateNode = g.nodeIndex.get('4,0,0')
  const five = []
  for (let i = 0; i < 5; i++) {
    five.push(w.pool.spawn({ origin: '', stops: [], dest: 'exit:exit-1' }, 1.5, 0.5, 1, 0))
  }
  for (let i = 0; i < 3; i++) w.tickOnce()
  for (const a of five) {
    const idx = a.path.indexOf(gateNode)
    assert.ok(idx >= 0, 'the wave walks through gate A')
    for (const s of g.servers) {
      const qi = s.queue.indexOf(a.id)
      if (qi >= 0) s.queue.splice(qi, 1)
    }
    a.server = -1
    a.state = 1
    a.x = g.nodeX[gateNode]
    a.y = g.nodeY[gateNode]
    a.z = g.nodeZ[gateNode]
    a.pathIdx = idx
    a.gateChosen = false
    a.wait = 0
  }

  w.tickOnce()
  assert.equal(five.filter((a) => a.gateChosen).length, GATE_REPLAN_PER_TICK, 'the whole wave chose at the gate in one tick')
})

test('the re-path queue drains on a budget and compacts its consumed prefix', () => {
  // `process()` used to `shift()` every request — O(n²) to drain a wave backed
  // up behind the per-tick budget. The head index makes dequeue O(1) with an
  // amortised compaction; this pins the accounting it replaced: a budgeted drain,
  // an exact remainder, and a queue that answers empty and reuses afterwards.
  const g = buildGraph(twoGateStation(), true)
  const nodes = [...g.nodeIndex.values()]
  const finder = new PathFinder(g)
  const pairs = []
  for (let i = 0; i < nodes.length && pairs.length < 10; i++) {
    for (let j = 0; j < nodes.length && pairs.length < 10; j++) {
      if (i !== j) pairs.push([nodes[i], nodes[j]])
    }
  }
  pairs.forEach(([from, to], k) => finder.request(k, from, to, WALKER))
  assert.equal(finder.pendingCount, 10, 'every miss queues')
  assert.equal(finder.process(3).length, 3, 'only the budget drains')
  assert.equal(finder.pendingCount, 7, 'and the remainder stays queued')
  assert.equal(finder.process(100).length, 7, 'a later tick drains the rest')
  assert.equal(finder.pendingCount, 0)
  assert.equal(finder.process(10).length, 0, 'a drained queue answers empty, not stale')

  // A session-long backlog reclaims its consumed prefix instead of pinning it.
  // Distinct legs each spend the budget (cache hits would drain free), so a
  // wide plate supplies the pairs: 1200 consumed of 1500 trips the compaction.
  const wide = { name: 't', seed: 1, cells: [], modules: [], lines: [] }
  plate(wide.cells, 0, 39, 0, 39, 0)
  const wideGraph = buildGraph(wide)
  const wideNodes = [...wideGraph.nodeIndex.values()]
  const wave = new PathFinder(wideGraph)
  for (let i = 0; i < 1500; i++) wave.request(i, wideNodes[i], wideNodes[i + 1], WALKER)
  assert.equal(wave.pendingCount, 1500)
  assert.equal(wave.process(1200).length, 1200)
  assert.equal(wave.pendingCount, 300, 'the budget binds distinct legs')
  assert.equal(wave.pending.length, 300, 'and the consumed prefix is reclaimed')
  assert.equal(wave.process(1000).length, 300)
  assert.equal(wave.pendingCount, 0)
  assert.equal(wave.pending.length, 0, 'a fully drained queue drops its array, not just its count')
})

test('the fare line is chosen while the gate is still metres away', () => {
  // The lookahead is the whole point of `chooseGate`: an agent that only decides
  // when the gate is its next node is already standing in the crowd it should
  // have walked around. Watch a busy gate line and record how far an agent still
  // had to walk at the moment its gate changed.
  const world = new World(scenarioStation({ upEscalators: 3, gates: 3 }), 99, { zoneBarriers: true })
  const g = world.graph
  const head = (a) => {
    let lead = 0
    let px = a.x
    let py = a.y
    for (let i = a.pathIdx; i < a.path.length; i++) {
      const n = a.path[i]
      lead += Math.hypot(g.nodeX[n] - px, g.nodeY[n] - py)
      px = g.nodeX[n]
      py = g.nodeY[n]
      const srv = g.serverForNode.get(n)
      if (srv !== undefined && g.servers[srv].kind === 'gate') return { server: srv, lead }
      if (lead > GATE_LOOKAHEAD * 2) break
    }
    return null
  }
  const seen = new Map()
  let early = 0
  let furthest = 0
  for (let i = 0; i < 600; i++) {
    world.tickOnce()
    for (const a of world.pool.live) {
      const key = `${a.id}|${a.legIdx}`
      const now = a.state === 1 && a.destNode >= 0 ? head(a) : null
      const before = seen.get(key)
      if (before && now && before.server !== now.server && before.lead > 1.5) {
        early++
        furthest = Math.max(furthest, before.lead)
      }
      if (now) seen.set(key, now)
      else seen.delete(key)
    }
  }
  assert.ok(early > 0, 'no passenger ever changed its mind about a gate before reaching it')
  assert.ok(
    furthest > 3,
    `the furthest a gate was re-chosen from was ${furthest.toFixed(1)} m — the fare line is being decided at the gate, not before it`,
  )
})
