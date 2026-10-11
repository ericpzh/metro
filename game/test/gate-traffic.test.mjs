import test from 'node:test'
import assert from 'node:assert/strict'
import { GateTraffic } from '../src/sim/gateTraffic.ts'
import { GATE_FORECAST_SECONDS, GATE_RATE } from '../src/sim/constants.ts'
import { World } from '../src/sim/world.ts'

function station() {
  const cells = []
  for (let x = 0; x <= 10; x++) for (let y = 0; y <= 4; y++) {
    cells.push({ x, y, z: -4, fill: 'solid', zone: x >= 6 ? 'paid' : 'unpaid' })
  }
  return { name: 'gate forecast', seed: 1, cells, lines: [], modules: [
    { id: 'gate-a', type: 'gate', x: 6, y: 1, z: -4, cfg: { dir: 'both' } },
    { id: 'gate-b', type: 'gate', x: 6, y: 3, z: -4, cfg: { dir: 'both' } },
  ] }
}

function setup() {
  const w = new World(station(), 7, { zoneBarriers: true })
  const g = w.graph
  const gate = g.servers.find(s => s.kind === 'gate')
  return { w, g, gate, traffic: new GateTraffic(g) }
}

function walker(w, g, from, to) {
  const n = g.nodeIndex.get(from), dest = g.nodeIndex.get(to)
  const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, g.nodeX[n], g.nodeY[n], g.nodeZ[n], 0)
  a.state = 1
  a.needs = { stepFree: false, luggage: false }
  a.path = w.path.search(n, dest, a.needs)
  a.pathIdx = 0
  a.destNode = dest
  return a
}

test('committed approaching passengers reserve a lane before anybody queues', () => {
  const { w, g, gate, traffic } = setup()
  const a = walker(w, g, '3,1,-4', '9,1,-4')
  a.gateChosen = true
  traffic.refresh(w.pool)
  assert.equal(gate.queue.length, 0)
  assert.ok(Math.abs(traffic.wait(gate, 1) - 1 / GATE_RATE) < 1e-8, 'an approaching passenger is invisible to the cost')
  traffic.reserve(a)
  assert.ok(Math.abs(traffic.wait(gate, 1) - 1 / GATE_RATE) < 1e-8, 're-reserving counted the same passenger twice')
  traffic.join(a, gate)
  assert.ok(Math.abs(traffic.wait(gate, 1) - 1 / GATE_RATE) < 1e-8, 'joining counted both a reservation and a queued passenger')
  traffic.leave(a, gate)
  assert.equal(traffic.wait(gate, 1), 0)
})

test('a nearby committed wave directs the next route to the other lane', () => {
  const { w, g, gate, traffic } = setup()
  for (let i = 0; i < 12; i++) {
    const a = walker(w, g, '3,1,-4', '9,1,-4')
    a.gateChosen = true
  }
  traffic.refresh(w.pool)
  w.path.gateWait = (s, dir) => traffic.wait(s, dir)
  const path = w.path.search(g.nodeIndex.get('3,1,-4'), g.nodeIndex.get('9,1,-4'), { stepFree: false, luggage: false })
  const chosen = [...path].map(n => g.serverForNode.get(n)).find(id => id !== undefined && g.servers[id].kind === 'gate')
  assert.notEqual(chosen, gate.id, 'the whole wave committed to an empty-looking queue at A')
  assert.ok(chosen >= 0, 'the alternative crossed the fare line without a gate')
})

test('opposing-direction forecasts include the active wave replenishing the queue', () => {
  const { w, g, gate, traffic } = setup()
  for (let i = 0; i < 4; i++) {
    const a = walker(w, g, '9,1,-4', '3,1,-4')
    a.gateChosen = true
  }
  for (let i = 0; i < 3; i++) {
    const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, 7.5, 1.5, -3, 0)
    a.state = 2; a.server = gate.id; a.gateDir = -1
    gate.queue.push(a.id)
  }
  gate.lane = -1
  traffic.refresh(w.pool)
  const expected = 7 / (GATE_RATE - 4 / GATE_FORECAST_SECONDS)
  assert.ok(Math.abs(traffic.wait(gate, 1) - expected) < 1e-8, 'opposing arrivals were treated as a simple FIFO queue')
  assert.ok(traffic.wait(gate, 1) > traffic.wait(gate, -1) * 4, 'both directions got the same wait estimate')
  gate.lane = 0
  assert.equal(traffic.wait(gate, 1), expected, 'an imminent outgoing wave became invisible when the lane was idle')
})

test('forecasts discard reservations after death, path changes and a new leg', () => {
  const { w, g, gate, traffic } = setup()
  const a = walker(w, g, '3,1,-4', '9,1,-4')
  a.gateChosen = true
  traffic.refresh(w.pool)
  assert.ok(traffic.wait(gate, 1) > 0)
  a.gateChosen = false
  traffic.refresh(w.pool)
  assert.equal(traffic.wait(gate, 1), 0, 'a new leg kept an old gate reservation')
  a.gateChosen = true
  a.path = new Int32Array(0)
  traffic.refresh(w.pool)
  assert.equal(traffic.wait(gate, 1), 0, 'an obsolete path kept a reservation')
  a.path = w.path.search(g.nodeIndex.get('3,1,-4'), a.destNode, a.needs)
  w.pool.kill(a)
  traffic.refresh(w.pool)
  assert.equal(traffic.wait(gate, 1), 0, 'a dead passenger kept a reservation')
})

test('failed patience checks preserve full waiting time and service records it', () => {
  const { w, gate } = setup()
  const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, 5.5, 1.5, -3, 0)
  a.gateDir = 1
  w.joinServer(a, gate.id)
  a.destNode = -1 // There is no alternative route to switch to.
  a.patience = 2
  for (let i = 0; i < 7; i++) w.queueTime(a)
  assert.equal(a.wait, 7, 'a failed patience check erased the measured wait')
  assert.equal(a.patienceWait, 1, 'patience is checked on its own interval')
  w.serve(a, gate)
  assert.equal(gate.waitAccum, 7, 'service recorded only the last patience interval')
  assert.equal(gate.waitCount, 1)
  assert.equal(a.wait, 0)
  assert.equal(a.patienceWait, 0)
})

test('a body pressed near the gate still pays its queue cost when re-choosing', () => {
  const { w, g, gate } = setup()
  const a = walker(w, g, '5,1,-4', '9,1,-4')
  a.pathIdx = [...a.path].indexOf(gate.node)
  assert.ok(a.pathIdx > 0)
  a.x = g.nodeX[gate.node] - 0.05
  a.y = g.nodeY[gate.node]
  gate.queue = Array.from({ length: 60 }, (_, i) => 100000 + i)
  w.gateTraffic.refresh(w.pool)
  w.chooseGate(a)
  const chosen = [...a.path].map(n => g.serverForNode.get(n)).find(id => id !== undefined && g.servers[id].kind === 'gate')
  assert.notEqual(chosen, gate.id, 'starting on the gate node made its long queue look free')
})

test('a stopped lane, cooldown and the ten-minute cap bound the forecast', () => {
  const { gate, traffic } = setup()
  gate.rate = 0
  assert.equal(traffic.wait(gate, 1), 600, 'a stopped lane is not free')
  gate.rate = 1
  gate.cooldown = 5
  assert.equal(traffic.wait(gate, 1), 5, 'cooldown prices the batch in service')
  gate.cooldown = 1000
  assert.equal(traffic.wait(gate, 1), 600, 'forecasts never exceed ten minutes')
  gate.cooldown = 0
})

test('neutral and single-direction lanes price the whole floor', () => {
  const { w, g, gate, traffic } = setup()
  const queue = (dir, n) => {
    for (let i = 0; i < n; i++) {
      const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, 7.5, 1.5, -3, 0)
      a.state = 2; a.server = gate.id; a.gateDir = dir
      gate.queue.push(a.id)
    }
  }
  queue(-1, 2); queue(0, 1); queue(1, 3)
  traffic.refresh(w.pool)
  const rate = gate.rate
  assert.ok(Math.abs(traffic.wait(gate, 0) - 6 / rate) < 1e-8, 'a neutral crossing queues behind every lane')
  const single = { ...gate, gateMode: 'single' }
  assert.ok(Math.abs(traffic.wait(single, 1) - 6 / rate) < 1e-8, 'a single-direction lane has no dedicated bank to price alone')
})

test('a saturated opposing wave drains at the minimum fraction, not at zero', () => {
  const { w, g, gate, traffic } = setup()
  gate.lane = -1
  // More arrivals per second than the lane serves: rate - arrivals goes negative.
  const arrivals = Math.ceil(gate.rate * GATE_FORECAST_SECONDS) + 4
  for (let i = 0; i < arrivals; i++) {
    const a = walker(w, g, '9,1,-4', '3,1,-4')
    a.gateChosen = true
  }
  traffic.refresh(w.pool)
  const floor = gate.rate * 0.1
  const expected = arrivals / floor
  assert.ok(Number.isFinite(traffic.wait(gate, 1)), 'a flooded lane must not divide by zero')
  assert.ok(Math.abs(traffic.wait(gate, 1) - expected) < 1e-8, 'the drain floor bounds a saturated lane')
})

test('a gate past the forecast horizon takes no reservation', () => {
  const { w, g, gate, traffic } = setup()
  const a = walker(w, g, '3,1,-4', '9,1,-4')
  a.gateChosen = true
  // Walk the body far from the gate's cells so the lead distance exceeds the horizon.
  a.x = -1000; a.y = -1000
  traffic.refresh(w.pool)
  assert.equal(traffic.wait(gate, 1), 0, 'a distant gate kept a reservation past its horizon')
})

test('queued dead bodies never price the lane, and riders never reserve it', () => {
  const { w, g, gate, traffic } = setup()
  const dead = w.pool.spawn({ origin: '', stops: [], dest: '' }, 7.5, 1.5, -3, 0)
  dead.state = 2; dead.server = gate.id; dead.gateDir = 1
  gate.queue.push(dead.id)
  dead.dead = true // still indexed, so the refresh guard sees the corpse
  const rider = walker(w, g, '3,1,-4', '9,1,-4')
  rider.gateChosen = true
  rider.train = 3
  const waiter = walker(w, g, '3,1,-4', '9,1,-4')
  waiter.gateChosen = true
  waiter.awaitingPath = true
  const served = walker(w, g, '3,1,-4', '9,1,-4')
  served.gateChosen = true
  served.servedFor = gate.id
  traffic.refresh(w.pool)
  assert.equal(traffic.wait(gate, 1), 0, 'a dead queue, a rider, a re-pathing body or the served gate priced the lane')
})
