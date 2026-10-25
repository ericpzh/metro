import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { createModule, addEquipment, toState } from '../src/build/model.ts'
import { STAIR_WIDTH_NARROW, STAIR_WIDTH_DOUBLE } from '../src/sim/stairs.ts'
import { rampMoveClear } from '../src/sim/rampCollision.ts'

function setup(type, width, rot = 0, dir = 'up') {
  const m = createModule(type, 0, 0, -5, 'ramp', rot, width, dir)
  const cells = []
  for (const z of [-5, 0]) for (let x = -10; x <= 10; x++) for (let y = -10; y <= 10; y++) cells.push({ x, y, z, fill: 'solid' })
  const w = new World(addEquipment(toState({ name: 'ramp spacing', seed: 1, cells, modules: [], lines: [] }), m), 1)
  return { w, s: w.graph.servers.find(s => s.kind === (type === 'escalator' ? 'escalator' : 'stair')) }
}

function queue(w, s, count) {
  return Array.from({ length: count }, () => {
    const g = w.graph
    const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, g.nodeX[s.node] + 0.1, g.nodeY[s.node] + 0.1, g.nodeZ[s.node], 0)
    w.joinServer(a, s.id)
    return a
  })
}

test('narrow escalators keep same-tick boarders single-file; wider ones provide spaced columns', () => {
  for (const width of [1, 2, 3]) for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) {
    const { w, s } = setup('escalator', width, rot, dir)
    assert.equal(s.rate, width * 1.25)
    const riders = queue(w, s, 8)
    w.stepServers()
    const aboard = riders.filter(a => a.state === 6)
    assert.equal(aboard.length, width + 1)
    for (const a of aboard) w.stepRide(a)
    const g = w.graph
    const dx = g.nodeX[s.exitNode] - g.nodeX[s.node]
    const dy = g.nodeY[s.exitNode] - g.nodeY[s.node]
    const len = Math.hypot(dx, dy)
    const across = a => ((a.x - g.nodeX[s.node]) * dy - (a.y - g.nodeY[s.node]) * dx) / len
    if (width === 1) {
      for (const a of aboard) assert.ok(Math.abs(across(a)) < 1e-6, 'narrow rider left the centreline')
      assert.ok(Math.abs(Math.abs(aboard[0].rideT - aboard[1].rideT) - 0.8) < 1e-6, 'same-tick passengers stacked instead of occupying separate steps')
    } else {
      const lanes = aboard.slice(0, width).map(across)
      for (let i = 1; i < width; i++) {
        assert.ok(Math.abs(lanes[i] - lanes[i - 1] - 0.7) < 1e-6, `width ${width} riders do not fill their spaced columns`)
      }
    }
  }
})

test('narrow stair flights wait for opposing riders; wide flights separate the two directions', () => {
  for (const width of [STAIR_WIDTH_NARROW, STAIR_WIDTH_DOUBLE]) {
    const { w, s } = setup('stair-right180', width)
    const reverse = w.graph.servers.find(other => other.node === s.exitNode && other.exitNode === s.node)
    const [forward] = queue(w, s, 1)
    const [backward] = queue(w, reverse, 1)
    w.stepServers()
    assert.equal(forward.state, 6)
    if (width === STAIR_WIDTH_NARROW) {
      assert.equal(backward.state, 2, 'opposing bodies entered the same narrow flight')
      w.simTime = s.ramp.traffic.until + 1
      w.stepServers()
      assert.equal(backward.state, 6, 'opposing queue never resumed after the flight cleared')
    } else {
      assert.equal(backward.state, 6)
      assert.ok(Math.abs(Math.hypot(forward.rideFromX - backward.rideToX, forward.rideFromY - backward.rideToY) - 0.7) < 1e-6)
    }
  }
})

test('crowd pressure cannot shove bodies through escalator or stair landing rails', () => {
  for (const [type, width] of [['escalator', 1], ['escalator', 2], ['escalator', 3], ['stair-straight', STAIR_WIDTH_NARROW], ['stair-right180', STAIR_WIDTH_DOUBLE]]) {
    for (let rot = 0; rot < 4; rot++) {
      const { w } = setup(type, width, rot)
      const wall = w.graph.rampWalls[0]
      const cx = (wall.ax + wall.bx) / 2, cy = (wall.ay + wall.by) / 2
      const x = cx - wall.inwardX * 0.45, y = cy - wall.inwardY * 0.45
      const z = wall.z0 + 1
      const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, x, y, z, 0)
      assert.ok(w.onFloor(x, y, z), 'fixture must stand on actual floor beside the ramp')
      w.tryMove(a, x + wall.inwardX * 1.4, y + wall.inwardY * 1.4)
      assert.equal(a.x, x, 'shove crossed a rail between two floor cells')
      assert.equal(a.y, y)
      w.tryMove(a, x + wall.inwardX * 0.2, y + wall.inwardY * 0.2)
      assert.equal(a.x, x, 'body was pressed into the rail without crossing its centreline')
      assert.equal(a.y, y)
      for (let i = 0; i < 20; i++) w.pool.spawn({ origin: '', stops: [], dest: '' }, x - wall.inwardX * (0.05 + i * 0.01), y - wall.inwardY * (0.05 + i * 0.01), z, 0)
      for (let i = 0; i < 12; i++) {
        w.buildCollisionGrid(w.pool.live)
        w.resolveCollisions()
        for (const body of w.pool.live) {
          const toward = (body.x - wall.ax) * wall.inwardX + (body.y - wall.ay) * wall.inwardY
          const dx = wall.bx - wall.ax, dy = wall.by - wall.ay
          const t = Math.max(0, Math.min(1, ((body.x - wall.ax) * dx + (body.y - wall.ay) * dy) / (dx * dx + dy * dy)))
          const distance = Math.hypot(body.x - wall.ax - t * dx, body.y - wall.ay - t * dy)
          assert.ok(distance >= (toward >= 0 ? 0.25 : 0.4) - 1e-6, 'repeated crowd pressure penetrated the handrail clearance')
        }
      }
    }
  }
})

test('rail clearance permits sliding and landing entry, blocks end-cap tunnelling, and respects storeys', () => {
  const walls = [{ ax: 0, ay: 0, bx: 0, by: 4, z0: -5, z1: 0, inwardX: 1, inwardY: 0 }]
  assert.equal(rampMoveClear(walls, -0.4, 1, -0.4, 2, -5), true, 'crowd cannot slide along a rail')
  assert.equal(rampMoveClear(walls, 0.3, -1, 0.3, 1, -5), true, 'rail clearance seals the entrance')
  assert.equal(rampMoveClear(walls, -1, -0.1, 1, -0.1, -5), false, 'a long shove tunnels around the rail end')
  assert.equal(rampMoveClear(walls, -1, 1, 1, 1, -8), true, 'ramp blocks the storey below it')
  assert.equal(rampMoveClear(walls, -0.1, 1, -0.5, 1, -5), true, 'a body already touching the rail cannot retreat')
  assert.equal(rampMoveClear(walls, -0.1, 1, 0.5, 1, -5), false, 'a body already touching the rail crosses through it')
})

test('body clearance leaves turning stair landings usable by actual walkers', () => {
  for (const style of ['right90', 'left90', 'right180', 'left180']) for (const width of [STAIR_WIDTH_NARROW, STAIR_WIDTH_DOUBLE]) for (let rot = 0; rot < 4; rot++) {
    const { w } = setup(`stair-${style}`, width, rot)
    const m = w.data.modules[0], g = w.graph
    const from = g.nodeIndex.get(`${m.from.x},${m.from.y},${m.from.z}`)
    const to = g.nodeIndex.get(`${m.to.x},${m.to.y},${m.to.z}`)
    const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, g.nodeX[from], g.nodeY[from], g.nodeZ[from], 0)
    a.needs = { stepFree: false, luggage: false }
    a.path = w.path.search(from, to, a.needs)
    assert.ok(a.path)
    a.destNode = to
    a.legs = [{ kind: 'exit', node: to }]
    a.state = 1
    for (let i = 0; i < 300 && !a.dead; i++) w.tickOnce()
    assert.ok(a.dead, `${style} width ${width} rotation ${rot}: rail clearance stranded a walker at ${a.x},${a.y},${a.z} (state ${a.state}, path ${a.path?.length})`)
    assert.equal(a.z, g.nodeZ[to])
  }
})

test('passengers displaced outside an escalator rail recover around its end without crossing it', () => {
  for (const width of [1, 2]) for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) {
    for (const queued of [false, true]) {
      const { w, s } = setup('escalator', width, rot, dir), g = w.graph
      const wall = g.rampWalls[0]
      const half = (g.nodeX[s.node] - wall.ax) * wall.inwardX + (g.nodeY[s.node] - wall.ay) * wall.inwardY
      const dx = g.nodeX[s.exitNode] - g.nodeX[s.node], dy = g.nodeY[s.exitNode] - g.nodeY[s.node]
      const length = Math.hypot(dx, dy)
      const x = g.nodeX[s.node] - wall.inwardX * (half + 0.45) + dx / length * 0.3
      const y = g.nodeY[s.node] - wall.inwardY * (half + 0.45) + dy / length * 0.3
      const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, x, y, g.nodeZ[s.node], 0)
      a.needs = { stepFree: false, luggage: false }
      a.path = Int32Array.of(s.node)
      a.destNode = s.node
      a.legs = [{ kind: 'exit', node: s.node }]
      a.state = 1
      assert.equal(rampMoveClear(g.rampWalls, x, y, g.nodeX[s.node], g.nodeY[s.node], Math.round(a.z) - 1), false)
      if (queued) w.joinServer(a, s.id)
      const originalPath = a.path
      for (let tick = 0; tick < 40 && !a.dead; tick++) {
        w.rerouteReplans = 0
        const beforeX = a.x, beforeY = a.y
        if (queued) w.stepQueue(a)
        else w.stepWalk(a)
        assert.ok(rampMoveClear(g.rampWalls, beforeX, beforeY, a.x, a.y, Math.round(a.z) - 1), 'recovery crossed through a rail')
      }
      if (queued) {
        assert.ok(Math.hypot(a.x - g.nodeX[s.node], a.y - g.nodeY[s.node]) <= 0.241, 'queue stayed stuck behind a rail')
        assert.deepEqual(s.queue, [a.id], 'recovery lost the passenger’s queue place')
        assert.equal(a.path, originalPath, 'queue recovery overwrote the journey')
      } else {
        assert.ok(a.dead, 'displaced walker never reached its destination')
      }
    }
  }
})

test('crowd pushes preserve a clear approach to the next ramp waypoint', () => {
  const { w, s } = setup('escalator', 1), g = w.graph
  const x = g.nodeX[s.node], y = g.nodeY[s.node] - 1.2, z = g.nodeZ[s.node]
  const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, x, y, z, 0)
  w.joinServer(a, s.id)
  w.tryMove(a, x - 0.85, y + 0.45, true)
  assert.ok(rampMoveClear(g.rampWalls, a.x, a.y, g.nodeX[s.node], g.nodeY[s.node], Math.round(z) - 1), 'a shove trapped a queue member behind the newel')
})
