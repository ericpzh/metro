// Elevators (电梯) — GAME-SPEC.md §5.1 / §7.4a.
//
// A lift is a 2 × 2 m vertical shaft with a 1.5 × 1.5 m carriage and one car. Its
// base piece serves the floor one storey up (its model runs on to that floor's
// ceiling) and the player grows it a storey at a time; every walkable floor in
// the column is a stop and the one car delivers each rider to their floor. These
// tests pin down the geometry, the growth, the graph join, and — most
// importantly — that a passenger really rides: they walk into the cabin, are
// pinned to it while it moves, and step out above.
import test from 'node:test'
import assert from 'node:assert/strict'
import { addEquipment, createModule, extendLift, liftInColumn, toState } from '../src/build/model.ts'
import { LIFT_EXTEND, LIFT_RISE, LIFT_STEP, liftExtendedDown, liftExtendedUp, liftFootprintCells, liftLandingCells, liftModule } from '../src/sim/lifts.ts'
import { buildGraph, EDGE_KIND } from '../src/sim/station.ts'
import { moduleEnvelope, placementBlocked } from '../src/sim/placement.ts'
import { World } from '../src/sim/world.ts'

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

const key = (p) => `${p.x},${p.y},${p.z}`

function edgeKind(g, a, b) {
  for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) return g.adjKind[e]
  return -1
}

test('a fresh lift is a 2×2 assembly that serves the floor one storey up', () => {
  for (let rot = 0; rot < 4; rot++) {
    const m = createModule('lift', 3, 5, -4, 'l', rot)
    assert.ok(m && m.type === 'lift')
    assert.deepEqual(m.from, { x: 3, y: 5, z: -4 })
    assert.deepEqual(m.to, { x: 3, y: 5, z: -4 + LIFT_RISE })
    assert.equal(m.rot, rot)
    // The assembly stands on a 2 × 2 m footprint, not one cell.
    assert.deepEqual(
      liftFootprintCells(m).sort(),
      [
        [3, 5],
        [3, 6],
        [4, 5],
        [4, 6],
      ].sort(),
    )
    const env = moduleEnvelope(m)
    assert.equal(env.x1 - env.x0, 2)
    assert.equal(env.y1 - env.y0, 2)
  }
})

test('extending a lift grows it one storey up or down, same column and id', () => {
  const base = liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1')
  const up = liftExtendedUp(base)
  const down = liftExtendedDown(base)
  assert.equal(up.to.z, base.to.z + LIFT_EXTEND)
  assert.equal(down.from.z, base.from.z - LIFT_EXTEND)
  assert.deepEqual([up.x, up.y, up.id], [base.x, base.y, base.id])

  const state = toState({ name: 't', seed: 1, cells: floors([0, LIFT_STEP, LIFT_STEP * 2]), modules: [base], lines: [] })
  const grown = extendLift(state, 'lift-1', true)
  assert.equal(grown.modules[0].to.z, LIFT_RISE + LIFT_EXTEND)
  assert.equal(liftInColumn(grown.modules, 2, 2)?.id, 'lift-1')
  assert.equal(liftInColumn(grown.modules, 3, 2), undefined)
})

test('the graph joins every floor in the shaft with one lift car, both ways', () => {
  const data = {
    name: 't',
    seed: 1,
    cells: floors([0, LIFT_STEP, LIFT_STEP * 2]),
    modules: [liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1')],
    lines: [],
  }
  const g = buildGraph(data)
  const liftServers = g.servers.filter((s) => s.kind === 'lift')
  assert.equal(liftServers.length, 1, 'a shaft is one car, not one per direction')
  const s = liftServers[0]
  assert.equal(s.lift.stops.length, 2, 'the base serves 0 and the floor above (4)')
  const bottom = g.nodeIndex.get('2,1,0')
  const top = g.nodeIndex.get('2,1,4')
  assert.equal(edgeKind(g, bottom, top), EDGE_KIND.lift)
  assert.equal(edgeKind(g, top, bottom), EDGE_KIND.lift)
})

test('a multi-storey shaft stops at every floor in its column', () => {
  const levels = [0, LIFT_STEP, LIFT_STEP * 2, LIFT_STEP * 3]
  const mod = liftExtendedUp(liftExtendedUp(liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1')))
  const g = buildGraph({ name: 't', seed: 1, cells: floors(levels), modules: [mod], lines: [] })
  const s = g.servers.find((x) => x.kind === 'lift')
  assert.equal(s.lift.stops.length, 4)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (i === j) continue
      assert.equal(edgeKind(g, s.lift.stops[i], s.lift.stops[j]), EDGE_KIND.lift)
    }
  }
})

test('only the door landing boards; the whole shaft interior is not walkable', () => {
  const data = {
    name: 't',
    seed: 1,
    cells: floors([0, LIFT_STEP, LIFT_STEP * 2]),
    modules: [liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1')],
    lines: [],
  }
  const g = buildGraph(data)
  // The four footprint cells are cabin interior: none may be a graph node.
  assert.equal(g.nodeIndex.get('2,2,0'), undefined, 'the lower-left corner is cabin interior')
  assert.equal(g.nodeIndex.get('3,2,0'), undefined, 'a shaft cell must not be walkable')
  assert.equal(g.nodeIndex.get('2,3,0'), undefined)
  assert.equal(g.nodeIndex.get('3,3,0'), undefined)
  // rot 0: the door faces −y, so the boarding tiles are (2,1) and (3,1).
  assert.notEqual(g.nodeIndex.get('2,1,0'), undefined, 'the door landing is the boarding node')
  const s = g.servers.find((x) => x.kind === 'lift')
  assert.equal(s.lift.stops[0], g.nodeIndex.get('2,1,0'))
})

test('a rotated lift boards only through the door it faces', () => {
  // rot 1 turns the opening to +x, so the landing row is east of the shaft.
  const m = liftModule({ x: 2, y: 2, z: 0 }, 1, 'lift-1')
  assert.deepEqual(liftLandingCells(m), [
    [4, 2],
    [4, 3],
  ])
  const g = buildGraph({ name: 't', seed: 1, cells: floors([0, LIFT_STEP]), modules: [m], lines: [] })
  const s = g.servers.find((x) => x.kind === 'lift')
  // The stop is the east landing, not the south-west anchor the old code used.
  assert.equal(s.lift.stops[0], g.nodeIndex.get('4,2,0'))
  assert.equal(g.nodeIndex.get('2,2,0'), undefined, 'the corner behind the door is not a stop')
})

test('a shaft may run past a floorless level; only real floors are stops', () => {
  // A shaft from 0 to 8 with floors at 0 and 8 but none at 4: two stops, not three.
  const data = {
    name: 't',
    seed: 1,
    cells: floors([0, LIFT_STEP * 2]),
    modules: [liftExtendedUp(liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1'))],
    lines: [],
  }
  const g = buildGraph(data)
  const s = g.servers.find((x) => x.kind === 'lift')
  assert.equal(s.lift.stops.length, 2, 'the floorless middle level is not a stop')
  const bottom = g.nodeIndex.get('2,1,0')
  const top = g.nodeIndex.get('2,1,8')
  assert.equal(edgeKind(g, bottom, top), EDGE_KIND.lift)
  assert.equal(g.nodeIndex.get('2,1,4'), undefined)
})

test('two lifts may not share space, but a 2 m gap is free', () => {
  const a = liftModule({ x: 2, y: 2, z: 0 }, 0, 'a')
  const same = liftModule({ x: 2, y: 2, z: 0 }, 0, 'b')
  const overlapping = liftModule({ x: 3, y: 2, z: 0 }, 0, 'c')
  const beside = liftModule({ x: 4, y: 2, z: 0 }, 0, 'd')
  assert.equal(placementBlocked([a], same), true)
  assert.equal(placementBlocked([a], overlapping), true, 'a 2×2 shaft overlaps the next cell')
  assert.equal(placementBlocked([a], beside), false, 'the next 2 m bay is free')
})

test('placing a lift appends it and keeps its landings', () => {
  const state = toState({ name: 't', seed: 1, cells: floors([0, LIFT_STEP, LIFT_STEP * 2]), modules: [], lines: [] })
  const mod = createModule('lift', 2, 2, 0, 'lift-1', 0)
  assert.ok(mod)
  const next = addEquipment(state, mod)
  assert.equal(next.modules.length, 1)
  assert.ok(next.cells.some((c) => c.x === 2 && c.y === 2 && c.z === 0))
  assert.ok(next.cells.some((c) => c.x === 2 && c.y === 2 && c.z === LIFT_RISE))
})

test('a passenger rides the car up: walks in, stays in the cabin, steps out above', () => {
  const data = {
    name: 't',
    seed: 1,
    cells: floors([0, LIFT_STEP, LIFT_STEP * 2]),
    modules: [liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1')],
    lines: [],
  }
  const w = new World(data, 1)
  const g = w.graph
  const s = g.servers.find((x) => x.kind === 'lift')
  const bottom = g.nodeIndex.get('2,1,0')
  const top = g.nodeIndex.get('2,1,4')
  const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, g.nodeX[bottom], g.nodeY[bottom], g.nodeZ[bottom], 0)
  a.state = 2
  a.server = s.id
  a.liftBoard = bottom
  a.liftDest = top
  a.liftWaitX = g.nodeX[bottom]
  a.liftWaitY = g.nodeY[bottom]
  s.queue.push(a.id)

  let sawAboard = false
  let stayedInCabin = true
  let releasedZ = null
  for (let i = 0; i < 160; i++) {
    w.tickOnce()
    if (a.liftServer >= 0 && a.liftPhase === 1) {
      sawAboard = true
      // Pinned to the cabin: the plan position stays in the 1.5 m carriage,
      // centred on the 2 × 2 assembly (anchor corner + 1 m each way).
      if (Math.abs(a.x - 3) > 0.55 || Math.abs(a.y - 3) > 0.55) stayedInCabin = false
    }
    if (releasedZ === null && a.liftServer === -1 && a.liftBoard === -1) releasedZ = a.z
  }
  assert.ok(sawAboard, 'the passenger never boarded the car')
  assert.ok(stayedInCabin, 'the passenger drifted out of the cabin while riding')
  assert.notEqual(releasedZ, null, 'the passenger never got off')
  assert.ok(Math.abs(releasedZ - g.nodeZ[top]) < 0.05, `released at z=${releasedZ}, expected ${g.nodeZ[top]}`)
})

test('the car pose is deterministic and reports a door fraction in 0..1', () => {
  const make = () => {
    const data = {
      name: 't',
      seed: 1,
      cells: floors([0, LIFT_STEP, LIFT_STEP * 2]),
      modules: [liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift-1')],
      lines: [],
    }
    const w = new World(data, 7)
    const s = w.graph.servers.find((x) => x.kind === 'lift')
    const bottom = w.graph.nodeIndex.get('2,1,0')
    const top = w.graph.nodeIndex.get('2,1,4')
    const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, w.graph.nodeX[bottom], w.graph.nodeY[bottom], w.graph.nodeZ[bottom], 0)
    a.state = 2
    a.server = s.id
    a.liftBoard = bottom
    a.liftDest = top
    s.queue.push(a.id)
    return w
  }
  const a = make()
  const b = make()
  for (let i = 0; i < 60; i++) {
    a.tickOnce()
    b.tickOnce()
  }
  assert.deepEqual([...a.liftRenderState()], [...b.liftRenderState()])
  const pose = a.liftRenderState()
  assert.equal(pose.length, 6)
  assert.ok(pose[5] >= 0 && pose[5] <= 1, `door fraction out of range: ${pose[5]}`)
})
