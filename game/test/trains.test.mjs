// Rolling stock reaches the renderer (PLAN §6, "rolling stock in 3D"). The
// pose the worker sends is a pure function of train state, so it must be
// deterministic and must line up with the platform edge the line serves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { defaultLine, placeRail, placeTrack, placeTunnel } from '../src/build/rail.ts'
import { STOCK, doorCentres, doorRunOffsets } from '../src/sim/stock.ts'
import { rotateLocal, trackCentre } from '../src/sim/track.ts'
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

test('rotated L and D berths keep every train door centred on its screen opening', () => {
  for (const stock of ['L', 'D']) for (const rot of [0, 1, 2, 3]) for (const dir of ['up', 'down']) {
    const line = { ...defaultLine('6', dir, 'third-rail'), stock, cars: stock === 'D' ? 8 : 4 }
    // Tanwei's Line 6 uses a 68 m bed, three cells wide, at z = -7.
    const track = { id: 'track-6', type: 'track', x: 17, y: 52, z: -7, w: stock === 'D' ? 161 : 68, d: stock === 'D' ? 4 : 3, rot,
      cfg: { line: '6', dir, power: 'third-rail' } }
    const cells = []
    for (let i = 0; i < track.w; i++) for (let j = -1; j <= track.d; j++) {
      const [dx, dy] = rotateLocal(rot, i, j)
      cells.push({ x: track.x + dx, y: track.y + dy, z: track.z, fill: 'solid', finish: { top: 'floor.granite' } })
    }
    const [ex, ey] = rotateLocal(rot, 0, dir === 'down' ? track.d : -1)
    const edge = { id: 'screen-6', type: 'platform-edge', x: track.x + ex, y: track.y + ey, z: track.z, w: track.w, rot,
      cfg: { line: '6', dir, from: track.id, side: dir === 'down' ? 'left' : 'right', psd: 'full', name: '站台门' } }
    const world = new World({ ...station(cells), modules: [track, edge], lines: [line] }, 99)
    for (let tick = 0; tick < 20; tick++) world.tickOnce()
    const pose = world.trainRenderState()
    assert.equal(pose.length, STRIDE)
    assert.equal(pose[5], 1, 'compare the berthed train while its doors are open')
    const centre = trackCentre(track)
    for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(pose[axis] - centre[axis]) < 1e-5,
      `rotation ${rot}, ${dir}: berth axis ${axis} must meet the bed centre`)
    const [fx, fy] = rotateLocal(rot, 1, 0)
    const offsets = doorRunOffsets(line, track.w)
    for (const [index, door] of doorCentres(line).entries()) {
      const [dx, dy] = rotateLocal(rot, offsets[index] - 0.5, 0)
      const screenX = edge.x + 0.5 + dx
      const screenY = edge.y + 0.5 + dy
      const error = (pose[0] + fx * door - screenX) * fx + (pose[1] + fy * door - screenY) * fy
      assert.ok(Math.abs(error) < 1e-5, `rotation ${rot}, ${dir}: door ${index} is displaced ${error} m along the screen`)
    }
  }
})

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

test('one line with two directions runs one train per track', () => {
  // Two parallel rails on one line: the 上行 bed at y = 0 serves the y = 1
  // platform, the 下行 bed at y = 4 serves y = 3 — one screen run each.
  const cells = []
  for (let x = 0; x < 30; x++) for (let y = 0; y < 5; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  let s = station(cells)
  s = placeTrack(s, { lineId: '1', dir: 'up', power: 'third-rail', rot: 0, x: 0, y: 0, z: 0, w: 24, d: 1 })
  s = placeTrack(s, { lineId: '1', dir: 'down', power: 'third-rail', rot: 0, x: 0, y: 4, z: 0, w: 24, d: 1 })
  assert.equal(s.modules.filter((m) => m.type === 'platform-edge').length, 2, 'one screen run per rail')
  const w = new World(s, 99)
  for (let i = 0; i < 20; i++) w.tickOnce()
  assert.equal(w.trains.length, 2, 'each direction runs its own consist')
  const pose = w.trainRenderState()
  assert.equal(pose.length, 2 * STRIDE, 'one pose per consist')
  assert.notEqual(pose[1], pose[STRIDE + 1], 'the consists berth on different rails')
  const [a, b] = w.trains
  assert.notEqual(a.track, b.track, 'bound to different tracks')
  assert.ok(a.doors.length > 0 && b.doors.length > 0, 'each serves its own screen doors')
  const owned = new Set(a.doors)
  assert.ok(b.doors.every((d) => !owned.has(d)), 'no door server is served twice')
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

test('a consist runs the whole connected rail — in from beyond the entrance tunnel, out through the far end', () => {
  // A platform rail with a tunnel grown off each end. The old choreography ran a
  // fixed `consist/2 + 25 m`, so a consist vanished beside the platform however
  // long the connected tunnel was. Now the run is measured from the berth to the
  // far end of the collinear, bed-sharing chain (§6), so the consist has to draw
  // right through the built tunnel before it leaves the world.
  const cars = 4
  const line = { ...defaultLine('1', 'up', 'third-rail'), cars }
  const w = 40
  const len = 30
  const cells = []
  for (let x = -len; x < w + len; x++) for (let y = 0; y < 2; y++) cells.push({ x, y, z: 0, fill: 'solid', finish: { top: 'floor.granite' } })
  const s0 = { ...station(cells), lines: [line] }
  const withPlatform = placeTrack(s0, { lineId: '1', dir: 'up', power: 'third-rail', rot: 0, x: 0, y: 0, z: 0, w, d: 1 })
  const platform = withPlatform.modules.find((m) => m.type === 'track')
  let s = placeTunnel(withPlatform, platform.id, len, [-1, 0, 0])
  s = placeTunnel(s, platform.id, len, [w, 0, 0])
  const tunnels = s.modules.filter((m) => m.type === 'track' && m.cfg.tunnel)
  assert.equal(tunnels.length, 2, 'a tunnel run grown off each end of the platform rail')
  // rot 0, so the near (entrance) end is the smaller x and the far (exit) end the larger.
  const entranceEnd = Math.min(...tunnels.map((m) => m.x))
  const exitEnd = Math.max(...tunnels.map((m) => m.x + m.w))
  const half = (STOCK.B.length * cars) / 2

  const w1 = new World(s, 99)
  const samples = []
  for (let i = 0; i < 80; i++) {
    w1.tickOnce()
    const train = w1.trains[0]
    const pose = w1.trainRenderState()
    if (train && pose.length) samples.push({ state: train.state, t: train.t, x: pose[0], dir: pose[7] })
  }
  const firstApproach = samples.find((p) => p.state === 'approach')
  const lastDepart = [...samples].reverse().find((p) => p.state === 'depart')
  assert.equal(firstApproach?.dir, 1)
  assert.equal(lastDepart?.dir, 1)
  // The first drawn frame of the approach puts the consist's nose on the far
  // (outer) end of the entrance tunnel — it is already emerging from the bore.
  assert.ok(Math.abs(firstApproach.x + half - entranceEnd) < 0.6,
    `approach nose ${(firstApproach.x + half).toFixed(1)} must start at the entrance tunnel end ${entranceEnd}`)
  // The last drawn frame of the departure puts the consist's tail on the outer
  // end of the exit tunnel — the whole consist has run the connected rail.
  assert.ok(Math.abs(lastDepart.x - half - exitEnd) < 0.6,
    `depart tail ${(lastDepart.x - half).toFixed(1)} must clear through the exit tunnel end ${exitEnd}`)
  // And the departure only ever runs forward, off the berth and out.
  const depart = samples.filter((p) => p.state === 'depart')
  const berth = trackCentre(platform)[0]
  assert.ok(Math.abs(depart[0].x - berth) < 0.6, 'the departure starts on the berth')
  for (let i = 1; i < depart.length; i++) {
    assert.ok(depart[i].x - depart[i - 1].x > 0.5, 'the departure only runs forward')
  }
})
