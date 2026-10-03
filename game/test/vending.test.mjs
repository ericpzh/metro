// Vending machines (自动贩卖机, GAME-SPEC §7.4a): a drinks machine that behaves
// like a ticket machine — the same 1 × 1 m equipment footprint, the same stop
// rate in the unpaid zone — with a different cabinet model.
import test from 'node:test'
import assert from 'node:assert/strict'
import { moduleAt, moduleEnvelope, placementBlocked } from '../src/sim/placement.ts'
import { createModule, toData, toState } from '../src/build/model.ts'
import { buildGraph } from '../src/sim/station.ts'
import { TVM_RATE } from '../src/sim/constants.ts'

/** Open floor: 10x10 slab at z = 0. */
function flatStation(modules = []) {
  const cells = []
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  return toState({ name: 't', seed: 1, cells, modules, lines: [] })
}

const tvm = (x, y, z, id = 'tvm-1') => ({ id, type: 'tvm', x, y, z, cfg: {} })
const vending = (x, y, z, id = 'vending-1') => ({ id, type: 'vending', x, y, z, cfg: {} })

test('a vending machine is created with the hover rotation, like any equipment', () => {
  const mod = createModule('vending', 1, 2, 3, 'v')
  assert.equal(mod?.type, 'vending')
  assert.deepEqual(mod?.cfg, {})
  assert.equal(createModule('vending', 1, 2, 3, 'v', 3)?.rot, 3)
})

test('a vending machine has the same footprint as a TVM and blocks it', () => {
  const box = moduleEnvelope(vending(0, 0, 0))
  assert.ok(box, 'no envelope')
  // The same plan and height as the ticket machine.
  assert.deepEqual(box, moduleEnvelope(tvm(0, 0, 0)))
  assert.equal(placementBlocked([tvm(0, 0, 0, 'a')], vending(0, 0, 0, 'b')), true)
  // Adjacent cells stay legal.
  assert.equal(placementBlocked([vending(0, 0, 0, 'a')], vending(1, 0, 0, 'b')), false)
})

test('the graph makes a vending machine an unpaid-zone stop at the TVM rate', () => {
  const g = buildGraph(toData(flatStation([tvm(1, 1, 0), vending(3, 1, 0)])))
  const vs = g.stops.find((s) => s.kind === 'vending')
  assert.ok(vs, 'no vending stop')
  const server = g.servers.find((s) => s.kind === 'stop' && s.node === vs.node)
  assert.ok(server, 'no stop server')
  assert.equal(server.rate, TVM_RATE)
  assert.equal(server.label, '自动贩卖机')
  assert.ok(g.stops.some((s) => s.kind === 'tvm'), 'the TVM stop went missing')
})

test('moduleAt finds a vending machine from its cell', () => {
  assert.equal(moduleAt([vending(2, 2, 0)], 2, 2, 0)?.type, 'vending')
})
