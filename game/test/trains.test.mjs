// Rolling stock reaches the renderer (PLAN §6, "rolling stock in 3D"). The
// pose the worker sends is a pure function of train state, so it must be
// deterministic and must line up with the platform edge the line serves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { defaultLine, placeRail, placeTrack } from '../src/build/rail.ts'
import { doorCentres } from '../src/sim/stock.ts'
import { scenarioStation } from './support/scenario-station.ts'
import { TRAIN_DOOR_TRAVEL, TRAIN_DWELL } from '../src/sim/constants.ts'

const STRIDE = 10

/** A bare document of floor cells and one line, for the berth-side cases. */
function station(cells) {
  return { name: '测试', seed: 1, cells, modules: [], lines: [defaultLine('1', 'up', 'third-rail')] }
}

function floorRow(x0, x1, y, finish = 'floor.granite') {
  const out = []
  for (let x = x0; x <= x1; x++) out.push({ x, y, z: 0, fill: 'solid', finish: { top: finish } })
  return out
}

test('no rolling stock before the first dispatch', () => {
  const w = new World(scenarioStation(), 99)
  assert.equal(w.trainRenderState().length, 0)
})

test('a dispatched train gets a pose on the track beside its platform edge', () => {
  const w = new World(scenarioStation({ upEscalators: 3 }), 99)
  w.tickOnce()
  const pose = w.trainRenderState()
  assert.equal(pose.length, STRIDE, 'one train, one pose')
  const [x, , z, cars, stock, doors, colour, dir, , doorSides] = pose
  // Line 2 runs B stock, six cars, on the platform edge at y = -6, z = -8. The
  // rail digs its bed, so the consist rides half a metre below the platform.
  assert.equal(cars, 6)
  assert.equal(stock, 1)
  assert.equal(z, -7.5, 'the train rides the recessed track slab')
  assert.equal(dir, 1)
  assert.equal(colour, parseInt('00679e', 16))
  assert.ok(Number.isFinite(x) && x < 0, `trains approach from off the platform, got x=${x}`)
  assert.equal(doors, 0, 'doors are shut while approaching')
  // The platform lies past the bed on the track's local +v, which is the
  // consist's local +y — bit 0. The tunnel-wall side (bit 1) has no screen
  // doors, so it is never set (§1.13).
  assert.equal(doorSides, 1, 'only the platform side may open')
})

test('a berth with no screen doors never opens a door bank', () => {
  // The bed covers the whole floor, so no platform edge is derived: the consist
  // still runs, but there is nothing to meet and both banks stay shut.
  const cells = []
  for (let x = 0; x < 40; x++) for (let y = 0; y < 3; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const s1 = placeRail(station(cells), { x0: 0, y0: 0, x1: 39, y1: 2, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  assert.equal(s1.modules.filter((m) => m.type === 'platform-edge').length, 0, 'nothing beside the bed')
  const w = new World(s1, 99)
  w.tickOnce()
  assert.equal(w.trainRenderState()[9], 0, 'no screen doors, no open side')
})

test('an island platform opens both door banks', () => {
  // Floor either side of the bed is the Spanish solution (§5.9): a screen run on
  // each side, so the consist serves both platforms at once.
  const cells = [...floorRow(0, 4, 0), ...floorRow(0, 4, 1), ...floorRow(0, 4, 2)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 4, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  assert.equal(s1.modules.filter((m) => m.type === 'platform-edge').length, 2, 'one screen run each side')
  const w = new World(s1, 99)
  w.tickOnce()
  assert.equal(w.trainRenderState()[9], 3, 'both sides have screen doors')
})

test('every screen door stands on a car door, and no car door is left without one', () => {
  // A platform beside a rail: the derived edge remembers its rail, so its screen
  // is cut at the consist's own cadence and the graph seats one door server on
  // the cell each opening falls in (§1.13). Boarding therefore happens at the
  // opening that lines up with the car door, never a bay away.
  const cells = []
  for (let x = 0; x < 120; x++) {
    cells.push({ x, y: 0, z: 0, fill: 'solid', finish: { top: 'floor.granite' } })
    cells.push({ x, y: 1, z: 0, fill: 'solid' })
  }
  const s1 = placeTrack(station(cells), { lineId: '1', dir: 'up', power: 'third-rail', rot: 0, x: 0, y: 1, z: 0, w: 120, d: 1 })
  assert.equal(s1.modules.filter((m) => m.type === 'platform-edge').length, 1, 'one screen run, on the platform side')
  const w = new World(s1, 99)
  // The consist comes to a stand at the mark: now its pose x is the rail centre,
  // which is where the door cadence is measured from.
  for (let i = 0; i < 60 && w.trains[0]?.state !== 'dwell'; i++) w.tickOnce()
  assert.equal(w.trains[0].state, 'dwell', 'the train berthed')
  const at = w.trainRenderState()[0]
  const cars = w.data.lines[0].cars
  const doors = doorCentres({ stock: w.data.lines[0].stock, cars })
  const screens = w.graph.servers.filter((s) => s.kind === 'door').map((s) => w.graph.nodeX[s.node] - at)
  assert.equal(screens.length, doors.length, 'one screen door per car door')
  for (const off of doors) {
    const near = Math.min(...screens.map((s) => Math.abs(s - off)))
    assert.ok(near <= 0.5, `car door at ${off.toFixed(2)} m has no screen door (nearest ${near.toFixed(2)} m)`)
  }
  for (const s of screens) {
    const near = Math.min(...doors.map((off) => Math.abs(off - s)))
    assert.ok(near <= 0.5, `a screen door at ${s.toFixed(2)} m stands off any car door (nearest ${near.toFixed(2)} m)`)
  }
})

test('a stop is a fixed berth / open / dwell / close / hold / depart sequence', () => {
  const w = new World(scenarioStation({ upEscalators: 3 }), 99)
  const seen = []
  const doorsOpenIn = []
  for (let i = 0; i < 60; i++) {
    w.tickOnce()
    const train = w.trains[0]
    if (!train) break
    seen.push(train.state)
    if (w.trainRenderState()[5] > 0.5) doorsOpenIn.push(train.state)
  }
  // Phase order, with consecutive repeats collapsed.
  const order = seen.filter((s, i) => s !== seen[i - 1])
  assert.deepEqual(order, ['approach', 'berth', 'opening', 'dwell', 'closing', 'hold', 'depart'])
  // Doors are commanded open for exactly the opening, dwell and closing phases.
  assert.equal(
    doorsOpenIn.length,
    TRAIN_DOOR_TRAVEL + TRAIN_DWELL + TRAIN_DOOR_TRAVEL,
    `doors open for ${doorsOpenIn.length} ticks`,
  )
  assert.ok(
    doorsOpenIn.every((s) => s === 'opening' || s === 'dwell' || s === 'closing'),
    'doors open only while the train is berthed with doors cycling',
  )
})

test('the rolling-stock pose is deterministic', () => {
  const a = new World(scenarioStation(), 424242)
  const b = new World(scenarioStation(), 424242)
  for (let i = 0; i < 300; i++) {
    a.tickOnce()
    b.tickOnce()
  }
  assert.deepEqual([...a.trainRenderState()], [...b.trainRenderState()])
})
