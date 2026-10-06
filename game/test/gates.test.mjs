// Turnstile policy — exit only, enter only, and the two-way lane. A one-way gate
// is a barrier to the wrong direction (the walk graph itself refuses the edge),
// and a two-way gate is a single lane that serves one direction at a time:
// first come sets the lane, and only when that side is empty can it flip.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { buildGraph } from '../src/sim/station.ts'
import { gateAllows, nextGateIndex } from '../src/sim/gates.ts'

/** A 2 m corridor x=0..12, unpaid up to x=4 and paid from x=5, a gate at x=5
 *  and a line at the far end. */
function flatStation(dir) {
  const cells = []
  for (let x = 0; x <= 12; x++) {
    for (let y = 0; y <= 1; y++) cells.push({ x, y, z: 0, fill: 'solid', zone: x <= 4 ? 'unpaid' : 'paid' })
  }
  const modules = [
    { id: 'exit', type: 'exit', x: 0, y: 0, z: 0, cfg: { name: 'A口', inRate: 6000, open: true, headHouse: false } },
    { id: 'edge', type: 'platform-edge', x: 10, y: 0, z: 0, w: 3, cfg: { name: '1站台', line: '2', dir: 'up', side: 'left' } },
    { id: 'g1', type: 'gate', x: 5, y: 0, z: 0, cfg: { dir } },
  ]
  const lines = [
    {
      id: '2', name: '2号线', colour: '#2f7ef2', stock: 'B', cars: 6, power: 'third-rail',
      headwayProfile: { peak: 60, offpeak: 120, late: 240 }, alightPerTrain: 540,
      terminus: 'through', direction: 'up', travelSign: 1, stations: ['edge'],
    },
  ]
  return { name: 't', seed: 3, cells, modules, lines }
}

function hasEdge(g, fromKey, toKey) {
  const a = g.nodeIndex.get(fromKey)
  const b = g.nodeIndex.get(toKey)
  if (a === undefined || b === undefined) return false
  for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) return true
  return false
}

/**
 * This suite is about the fare line, so it runs the fixture with §4.5's barrier
 * **enforced** — it is off by default while the demo's paint is unfinished
 * (`ZONE_LINES_BLOCK`), and `zones.test.mjs` covers that default.
 */
function run(data, ticks, opts = { zoneBarriers: true }) {
  const w = new World(data, 3, opts)
  for (let i = 0; i < ticks; i++) w.tickOnce()
  return w
}

test('gateAllows is a direction filter for one-way gates', () => {
  assert.equal(gateAllows('in', 1), true)
  assert.equal(gateAllows('in', -1), false)
  assert.equal(gateAllows('out', -1), true)
  assert.equal(gateAllows('out', 1), false)
  assert.equal(gateAllows('both', 1), true)
  assert.equal(gateAllows('both', -1), true)
  // A step that does not cross the fare line is nobody's business.
  for (const m of ['in', 'out', 'both']) assert.equal(gateAllows(m, 0), true, m)
})

test('a two-way lane serves one direction at a time, first come first served', () => {
  // Idle lane: the first arrival (an exiting agent) claims it.
  assert.equal(nextGateIndex([-1, 1], 'both', 0), 0)
  // Committed to exit: the entering agent behind it must wait, but a later exit
  // still gets through.
  assert.equal(nextGateIndex([1], 'both', -1), -1)
  assert.equal(nextGateIndex([1, -1], 'both', -1), 1)
  // Lane released: the entering agent can claim it.
  assert.equal(nextGateIndex([1], 'both', 0), 0)
  // One-way gates ignore the lane and always apply their own direction.
  assert.equal(nextGateIndex([1, -1], 'out', 0), 1)
  assert.equal(nextGateIndex([1], 'out', 0), -1)
  assert.equal(nextGateIndex([-1, 1], 'in', 0), 1)
})

test('the graph offers only the crossing a one-way gate allows', () => {
  // Cell 4 is unpaid, cell 5 is the gate (paid, since x>4). Leaving the paid
  // zone is the edge 5 -> 4; entering it is the reverse, 4 -> 5.
  const out = buildGraph(flatStation('out'), true)
  assert.equal(hasEdge(out, '4,0,0', '5,0,0'), false, 'an exit gate let someone in')
  assert.equal(hasEdge(out, '5,0,0', '4,0,0'), true, 'an exit gate blocked an exit')

  const inn = buildGraph(flatStation('in'), true)
  assert.equal(hasEdge(inn, '4,0,0', '5,0,0'), true, 'an entry gate blocked an entry')
  assert.equal(hasEdge(inn, '5,0,0', '4,0,0'), false, 'an entry gate let someone out')

  const both = buildGraph(flatStation('both'), true)
  assert.equal(hasEdge(both, '4,0,0', '5,0,0'), true)
  assert.equal(hasEdge(both, '5,0,0', '4,0,0'), true)
})

function noStreetSpawn(data) {
  for (const m of data.modules) if (m.type === 'exit') m.cfg.inRate = 0
  return data
}

/** No alighting: the line still runs and its doors still exist, but nobody
 *  steps off — so the only crowd is the street's. */
function noAlighting(data) {
  for (const l of data.lines) l.alightPerTrain = 0
  return data
}

test('an exit-only gate strands entry demand but lets the alighting out', () => {
  const stranded = run(flatStation('out'), 240)
  assert.equal(stranded.totals.boarded, 0, 'somebody boarded through an exit-only gate')
  assert.ok(stranded.metrics.stuck > 0, 'expected entrants to be stranded at the fare line')

  // With the street closed, everyone who leaves came off a train.
  const alightOnly = run(noStreetSpawn(flatStation('out')), 240)
  assert.ok(alightOnly.totals.exited > 0, 'nobody left through the gate at all')
})

test('an entry-only gate boards but traps the alighting', () => {
  const boardOnly = run(flatStation('in'), 240)
  assert.ok(boardOnly.totals.boarded > 0, 'nobody boarded through an entry-only gate')

  const alightOnly = run(noStreetSpawn(flatStation('in')), 240)
  assert.equal(alightOnly.totals.exited, 0, 'somebody left through an entry-only gate')
  assert.ok(alightOnly.metrics.stuck > 0, 'expected alighting passengers to be stranded')
})

test('a two-way gate passes both directions', () => {
  // Each direction is given the lane in turn. They cannot both hold it at once
  // and the fixture's train surge is far heavier than one lane's 0.42 pax/s, so
  // in a genuinely mixed crowd the committed direction keeps it and the other
  // waits — that is §7.1's first-come rule, and the assertion below would be
  // reading the lane race rather than the gate. So: the street without the
  // train, then the train without the street.
  const entering = run(noAlighting(flatStation('both')), 240)
  assert.ok(entering.totals.boarded > 0, 'nobody boarded through a two-way gate')

  const alightOnly = run(noStreetSpawn(flatStation('both')), 240)
  assert.ok(alightOnly.totals.exited > 0, 'nobody left through a two-way gate')
})

test('a two-way gate holds its lane until the committed side is clear', () => {
  // A quiet station: no exits open and no line, so the only bodies are the two
  // we inject straight into the gate queue.
  const data = flatStation('both')
  for (const m of data.modules) if (m.type === 'exit') m.cfg.inRate = 0
  data.lines = []
  const w = new World(data, 5, { zoneBarriers: true })
  const g = w.graph
  const gateNode = g.nodeIndex.get('5,0,0')
  const gateId = g.serverForNode.get(gateNode)
  const server = g.servers[gateId]
  const pool = w.pool.all()

  const aExit = w.pool.spawn({ origin: '', stops: [], dest: 'exit:exit' }, 5.5, 0.5, 1, 0)
  const aEntry = w.pool.spawn({ origin: '', stops: [], dest: 'line:2' }, 5.5, 0.5, 1, 0)
  for (const [a, dir] of [[aExit, -1], [aEntry, 1]]) {
    a.state = 2 // queuing
    a.server = gateId
    a.gateDir = dir
    server.queue.push(a.id)
  }
  server.cooldown = 0
  server.lane = 0

  w.tickOnce()
  assert.equal(server.lane, -1, 'the first arrival (exiting) did not claim the lane')
  assert.ok(!server.queue.includes(aExit.id), 'the exiting agent was not served')
  assert.ok(server.queue.includes(aEntry.id), 'the entering agent jumped the committed lane')

  // It takes a few ticks for the exiting pass to clear, then the lane flips and
  // the same entering agent goes through — no new arrival needed.
  for (let i = 0; i < 8 && server.queue.includes(aEntry.id); i++) w.tickOnce()
  assert.ok(!server.queue.includes(aEntry.id), 'the entering agent never got the flipped lane')
  assert.equal(pool.get(aEntry.id)?.gateDir, 1)
})