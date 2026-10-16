// Elevator doors (电梯门) — GAME-SPEC.md §5.1.
//
// A shaft's cabin may open on its front face (local −y, the default), its back
// face (local +y) or both — a through-lift — and the choice is per storey, so
// one shaft can serve a front-only floor and a two-sided interchange. These
// tests pin the config helpers, the landing geometry, the graph stops and edges
// the crowd rides, the side the render snapshots open, and the save round trip.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LIFT_STEP,
  liftDoorSide,
  liftLandingCells,
  liftLandingRows,
  liftLandingSide,
  liftExtendedUp,
  liftModule,
  liftWithDoorSide,
} from '../src/sim/lifts.ts'
import { buildGraph, EDGE_KIND } from '../src/sim/station.ts'
import { World } from '../src/sim/world.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import { toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'

/** Floors at every storey the tests reach, so a lift has a landing each end. */
function floors(levels) {
  const cells = []
  for (let x = 0; x <= 5; x++) {
    for (let y = 0; y <= 5; y++) {
      for (const z of levels) cells.push({ x, y, z, fill: 'solid' })
    }
  }
  return cells
}

function edgeKind(g, a, b) {
  for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) return g.adjKind[e]
  return -1
}

test('the door side defaults to the front and stores only the exceptions', () => {
  const base = liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1')
  assert.equal(liftDoorSide(base.cfg, 0), 'front')
  assert.equal(liftDoorSide(base.cfg, 4), 'front')

  const back = liftWithDoorSide(base, 0, 'back')
  assert.equal(liftDoorSide(back.cfg, 0), 'back')
  assert.equal(liftDoorSide(back.cfg, 4), 'front')

  const both = liftWithDoorSide(back, 4, 'both')
  assert.equal(liftDoorSide(both.cfg, 0), 'back')
  assert.equal(liftDoorSide(both.cfg, 4), 'both')

  // Choosing the front again drops the entry, and an all-front shaft carries no
  // `doors` field at all, so an untouched save is byte-for-byte what it was.
  const cleaned = liftWithDoorSide(liftWithDoorSide(both, 0, 'front'), 4, 'front')
  assert.deepEqual(cleaned.cfg, {})
})

test('a storey lists its landing rows front first, and both sides together', () => {
  const m = liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1')
  // rot 0: the front row is south of the shaft, the back row north of it.
  assert.deepEqual(liftLandingRows(m, 0), [[[2, 1], [3, 1]]])
  assert.deepEqual(liftLandingCells(m), [[2, 1], [3, 1]], 'no storey still reads the front row')

  const both = liftWithDoorSide(m, 0, 'both')
  assert.deepEqual(liftLandingRows(both, 0), [[[2, 1], [3, 1]], [[2, 4], [3, 4]]])
  assert.deepEqual(liftLandingCells(both, 0), [[2, 1], [3, 1], [2, 4], [3, 4]])

  // A rotated shaft turns both rows with it.
  const turned = liftWithDoorSide(liftModule({ x: 2, y: 2, z: 0 }, 1, 'lift-1'), 0, 'both')
  assert.deepEqual(liftLandingRows(turned, 0), [[[4, 2], [4, 3]], [[1, 2], [1, 3]]])
})

test('landing side is read from the geometry, front 1 and back 2', () => {
  const m = liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1')
  for (const [x, y] of liftLandingRows(m, 0)[0]) assert.equal(liftLandingSide(m, x, y), 1)
  const both = liftWithDoorSide(m, 0, 'both')
  for (const [x, y] of liftLandingRows(both, 0)[1]) assert.equal(liftLandingSide(m, x, y), 2)
})

test('a through-floor adds a stop on its back face and joins both faces to other floors', () => {
  const mod = liftWithDoorSide(liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1'), LIFT_STEP, 'both')
  const g = buildGraph({ name: 't', seed: 1, cells: floors([0, LIFT_STEP]), modules: [mod], lines: [] })
  const s = g.servers.find((x) => x.kind === 'lift')
  const front0 = g.nodeIndex.get('2,1,0')
  const front4 = g.nodeIndex.get('2,1,4')
  const back4 = g.nodeIndex.get('2,4,4')
  assert.notEqual(back4, undefined, 'the back landing is a stop')
  // stopZ has three entries: front 0, then front 4 and back 4.
  assert.deepEqual([...s.lift.stops], [front0, front4, back4])
  // Any face on one floor reaches any face on the other.
  assert.equal(edgeKind(g, front0, front4), EDGE_KIND.lift)
  assert.equal(edgeKind(g, front0, back4), EDGE_KIND.lift)
  assert.equal(edgeKind(g, back4, front0), EDGE_KIND.lift)
  // Riding from one face of a floor to the other is a walk, not a lift leg.
  assert.notEqual(edgeKind(g, front4, back4), EDGE_KIND.lift)
})

test('a back-only floor boards and alights through its back landing', () => {
  const mod = liftWithDoorSide(liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1'), 0, 'back')
  const g = buildGraph({ name: 't', seed: 1, cells: floors([0, LIFT_STEP]), modules: [mod], lines: [] })
  const s = g.servers.find((x) => x.kind === 'lift')
  assert.equal(s.lift.stops[0], g.nodeIndex.get('2,4,0'))
  assert.equal(s.lift.stops[1], g.nodeIndex.get('2,1,4'))
  assert.ok(!s.lift.stops.includes(g.nodeIndex.get('2,1,0')), 'the front is not a stop when the doors face back')
})

test('a sealed storey has no landing rows or lift stop while the car serves floors above and below', () => {
  const base = liftModule({ x: 2, y: 2, z: 0 }, 0, 'sealed-middle')
  const shaft = liftExtendedUp(liftExtendedUp(base))
  const mod = liftWithDoorSide(shaft, LIFT_STEP, 'none')
  assert.deepEqual(liftLandingRows(mod, LIFT_STEP), [])
  assert.deepEqual(liftLandingCells(mod, LIFT_STEP), [])
  const graph = buildGraph({ name: 'sealed', seed: 1, cells: floors([0, LIFT_STEP, LIFT_STEP * 2]), modules: [mod], lines: [] })
  const server = graph.servers.find((x) => x.kind === 'lift')
  assert.ok(server)
  assert.deepEqual(server.lift.stopZ, [1, 9], 'only the open bottom and top storeys are served at their floor tops')
  assert.ok(!server.lift.stops.includes(graph.nodeIndex.get(`2,1,${LIFT_STEP}`)))
  assert.ok(!server.lift.stops.includes(graph.nodeIndex.get(`2,4,${LIFT_STEP}`)))
})

test('a passenger rides the car from a back landing to a front one', () => {
  const mod = liftWithDoorSide(liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1'), 0, 'both')
  const data = { name: 't', seed: 1, cells: floors([0, LIFT_STEP]), modules: [mod], lines: [] }
  const w = new World(data, 1)
  const g = w.graph
  const s = g.servers.find((x) => x.kind === 'lift')
  const back = g.nodeIndex.get('2,4,0')
  const front = g.nodeIndex.get('2,1,4')
  const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, g.nodeX[back], g.nodeY[back], g.nodeZ[back], 0)
  a.state = 2
  a.server = s.id
  a.liftBoard = back
  a.liftDest = front
  s.queue.push(a.id)

  let releasedZ = null
  for (let i = 0; i < 160; i++) {
    w.tickOnce()
    if (releasedZ === null && a.liftServer === -1 && a.liftBoard === -1) releasedZ = a.z
  }
  assert.notEqual(releasedZ, null, 'the passenger never got off')
  assert.ok(Math.abs(releasedZ - g.nodeZ[front]) < 0.05, `released at z=${releasedZ}`)
})

test('the render snapshot reports the face a stop opens: front 1, back 2', () => {
  const make = (side) => {
    const mod = liftWithDoorSide(liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1'), 0, side)
    const data = { name: 't', seed: 1, cells: floors([0, LIFT_STEP]), modules: [mod], lines: [] }
    const w = new World(data, 7)
    const g = w.graph
    const s = g.servers.find((x) => x.kind === 'lift')
    const board = g.nodeIndex.get(side === 'back' ? '2,4,0' : '2,1,0')
    const dest = g.nodeIndex.get('2,1,4')
    const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, g.nodeX[board], g.nodeY[board], g.nodeZ[board], 0)
    a.state = 2
    a.server = s.id
    a.liftBoard = board
    a.liftDest = dest
    s.queue.push(a.id)
    for (let i = 0; i < 60; i++) w.tickOnce()
    return w.liftRenderState()
  }
  assert.equal(make('front')[6], 1)
  assert.equal(make('back')[6], 2)
})

test('the per-floor door choice survives a save', () => {
  const mod = liftWithDoorSide(liftWithDoorSide(liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1'), 0, 'both'), LIFT_STEP, 'back')
  const station = toState({ ...emptyStation(), modules: [mod] })
  const saved = parse(serialize(station))
  assert.ok(saved.ok)
  const cfg = saved.state.modules[0].cfg
  assert.equal(cfg.doors['0'], 'both')
  assert.equal(cfg.doors[String(LIFT_STEP)], 'back')
})
