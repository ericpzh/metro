import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGraph } from '../src/sim/station.ts'
import { clearWalkSegment, walkingLaneNode, platformWaitingNodes } from '../src/sim/walkingSpace.ts'
import { World } from '../src/sim/world.ts'
import { scenarioStation } from './support/scenario-station.ts'
import { referenceStation } from '../src/data/reference-station.ts'
import { rotateLocal } from '../src/sim/track.ts'

function corridor(width = 9) {
  const cells = []
  for (let x = 0; x <= 45; x++) for (let y = 0; y < width; y++) cells.push({ x, y, z: 4, fill: 'solid', zone: 'unpaid' })
  return { name: 'walking width', seed: 1, cells, modules: [], lines: [] }
}
function route(g) { return Int32Array.from({ length: 46 }, (_, x) => g.nodeIndex.get(`${x},0,4`)) }

test('Tanwei edge floor contains unqueued walkers under sustained crowd pressure', () => {
  const w = new World(referenceStation('tanwei')), g = w.graph
  let checked = 0
  for (const p of g.platforms) {
    const edge = w.data.modules.find(m => m.id === p.id)
    const [ix, iy] = rotateLocal(edge.rot, 0, edge.cfg.side === 'right' ? -1 : 1)
    // The reported failures occupy the outer half of this still-walkable tile.
    const node = p.cells[Math.floor(p.cells.length / 2)]
    const x = g.nodeX[node], y = g.nodeY[node], z = g.nodeZ[node]
    const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, x, y, z, 0)
    a.state = 1; a.server = -1
    const pressure = w.pool.spawn({ origin: '', stops: [], dest: '' }, x + ix * .2, y + iy * .2, z, 0)
    for (let i = 0; i < 30; i++) {
      pressure.x = a.x + ix * .2; pressure.y = a.y + iy * .2
      w.buildCollisionGrid(w.pool.live)
      w.resolveCollisions()
      assert.ok((a.x - x) * ix + (a.y - y) * iy >= -1e-9, `${p.id}: an unqueued walker stays inland of the screen`)
    }
    w.tryMove(a, x - ix * .48, y - iy * .48)
    assert.ok((a.x - x) * ix + (a.y - y) * iy >= -1e-9, 'ordinary movement also respects the edge')
    w.tryMove(a, x + iy * .25, y - ix * .25)
    assert.ok(Math.abs((a.x - x) * iy - (a.y - y) * ix - .25) < 1e-9, 'walkers can slide along the platform edge')
    a.dead = true; pressure.dead = true
    checked++
  }
  assert.ok(checked >= 4, 'both levels and both platform banks are exercised')
})

test('platform floor constraints follow both sides at every rotation and refresh on rebuild', () => {
  for (const rot of [0, 1, 2, 3]) for (const side of ['left', 'right']) {
    const data = corridor(9)
    data.modules = [{ id: 'edge', type: 'platform-edge', x: 20, y: 4, z: 4, w: 3, rot, cfg: { line: '', side } }]
    const w = new World(data), g = w.graph, node = g.platforms[0].cells[0]
    const [ix, iy] = rotateLocal(rot, 0, side === 'right' ? -1 : 1)
    const x = g.nodeX[node], y = g.nodeY[node]
    const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, x, y, 5, 0)
    w.tryMove(a, x - ix * .48, y - iy * .48)
    assert.ok(Math.abs((a.x - x) * ix + (a.y - y) * iy) < 1e-9, `${rot}/${side}: track-facing part of the tile is excluded`)
    w.data.modules = []
    w.rebuild()
    const b = w.pool.spawn({ origin: '', stops: [], dest: '' }, x, y, 5, 0)
    w.tryMove(b, x - ix * .48, y - iy * .48)
    assert.ok((b.x - x) * ix + (b.y - y) * iy < -.47, 'removing the platform removes the constraint')
  }
})

test('shared shortest wall paths offer stable lanes across the clear corridor width', () => {
  const g = buildGraph(corridor()), path = route(g), counts = new Map()
  for (let id = 1; id <= 100; id++) {
    const n = walkingLaneNode(g, path, 20, id), row = Math.floor(g.nodeY[n])
    counts.set(row, (counts.get(row) ?? 0) + 1)
    assert.equal(g.nodeY[n], g.nodeY[walkingLaneNode(g, path, 21, id)], 'a stable lane does not weave each metre')
  }
  assert.equal(counts.size, 5, 'five interior lanes fill a nine-metre corridor')
  assert.ok(Math.max(...counts.values()) <= 22, 'no single lane holds most of the wave')
  const narrow = buildGraph(corridor(1)), single = route(narrow)
  assert.equal(walkingLaneNode(narrow, single, 10, 7), single[10], 'a narrow passage retains its only route')
})

test('fine walking spreads real passengers away from a shared wall line', () => {
  const w = new World(corridor(), 3), g = w.graph, path = route(g), agents = []
  for (let i = 0; i < 30; i++) {
    const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, 0.5, 0.5, 5, 0)
    a.path = path; a.pathIdx = 0; a.destNode = path.at(-1); a.state = 1
    a.legs = [{ kind: 'exit', node: path.at(-1), ref: '' }]
    agents.push(a)
  }
  for (let i = 0; i < 35; i++) w.tickOnce()
  const progressing = agents.filter(a => !a.dead && a.x > 8)
  const rows = new Set(progressing.map(a => Math.floor(a.y)))
  assert.ok(progressing.length >= 20, `${progressing.length}/30 passengers made forward progress`)
  assert.ok(rows.size >= 5, `${rows.size} occupied rows instead of one wall line`)
  assert.ok(progressing.filter(a => a.y > 1.5).length >= progressing.length * 0.8, 'at least 80% walk away from the wall')
})

test('lateral segments cannot cross a missing-floor strip or a fare boundary', () => {
  const data = corridor()
  data.cells = data.cells.filter(c => !(c.y === 4 && c.x > 3 && c.x < 40))
  const g = buildGraph(data), path = route(g)
  for (let id = 1; id <= 20; id++) assert.ok(g.nodeY[walkingLaneNode(g, path, 10, id)] < 4)
  assert.equal(clearWalkSegment(g, 10.5, 1.5, 10.5, 6.5, 5), false, 'a floor hole blocks the whole movement segment')
  const fare = corridor()
  for (const c of fare.cells) if (c.y >= 4) c.zone = 'paid'
  const f = buildGraph(fare, true)
  assert.equal(clearWalkSegment(f, 10.5, 1.5, 10.5, 6.5, 5), false, 'lane steering never bypasses a fare gate')
})

test('platform waiting uses connected floor rather than one doorway point', () => {
  const w = new World(scenarioStation(), 4), g = w.graph, door = g.servers.find(s => s.kind === 'door')
  door.rate = 0
  const spots = platformWaitingNodes(g, door.node)
  assert.ok(spots.length >= 8, 'the doorway has a usable waiting area')
  const inward = door.platformInward
  const safeSpots = platformWaitingNodes(g, door.node, inward)
  assert.ok(safeSpots.length >= 8)
  const lineSlot = n => ({
    depth: (g.nodeX[n] - g.nodeX[door.node]) * inward[0] + (g.nodeY[n] - g.nodeY[door.node]) * inward[1],
    side: (g.nodeX[n] - g.nodeX[door.node]) * inward[1] - (g.nodeY[n] - g.nodeY[door.node]) * inward[0],
  })
  for (let i = 0; i < 8; i++) {
    const slot = lineSlot(safeSpots[i])
    assert.equal(slot.depth, 1 + Math.floor(i / 2), 'both fronts fill before the next row')
    assert.equal(Math.abs(slot.side), 1, 'the centre aisle stays open')
    if (i % 2) assert.equal(slot.side, -lineSlot(safeSpots[i - 1]).side)
  }
  for (const n of safeSpots) assert.ok((g.nodeX[n] - g.nodeX[door.node]) * inward[0] + (g.nodeY[n] - g.nodeY[door.node]) * inward[1] >= 1, 'waiting cells stay behind the PSD row')
  const agents = []
  for (let i = 0; i < 16; i++) {
    const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, g.nodeX[door.node], g.nodeY[door.node], g.nodeZ[door.node], 0)
    w.joinServer(a, door.id)
    agents.push(a)
  }
  for (let i = 0; i < 8; i++) assert.equal(agents[i].platformWaitNode, safeSpots[i], 'queue rank assigns successive paired line slots')
  for (let i = 0; i < 20; i++) for (const a of agents) w.stepQueue(a)
  assert.ok(new Set(agents.map(a => `${Math.floor(a.x)},${Math.floor(a.y)}`)).size >= 8, 'waiting passengers occupy at least eight floor cells')
  assert.ok(agents.some(a => Math.hypot(a.x - g.nodeX[door.node], a.y - g.nodeY[door.node]) > 2), 'the queue uses platform depth')
  for (const a of agents) assert.ok(clearWalkSegment(g, g.nodeX[door.node], g.nodeY[door.node], a.x, a.y, a.z), 'each waiting place has a legal doorway approach')
  for (const a of agents) assert.ok((a.x - g.nodeX[door.node]) * inward[0] + (a.y - g.nodeY[door.node]) * inward[1] > 0, 'closed-door passengers walk inward')
  agents[0].x = g.nodeX[door.node]
  agents[0].y = g.nodeY[door.node]
  w.holdPlatformQueuesClear()
  assert.ok((agents[0].x - g.nodeX[door.node]) * inward[0] + (agents[0].y - g.nodeY[door.node]) * inward[1] >= 0.9, 'collision pressure cannot leave a queued body in the PSD')
  const far = [...spots].find(n => Math.hypot(g.nodeX[n] - g.nodeX[door.node], g.nodeY[n] - g.nodeY[door.node]) > 2)
  agents[0].x = g.nodeX[far]
  agents[0].y = g.nodeY[far]
  door.rate = 1.2
  w.stepServers()
  assert.equal(door.queue[0], agents[0].id, 'an open door cannot board a passenger from a distant waiting spot')
  assert.equal(w.metrics.boarded, 0, 'boarding requires the walk to the doorway')
  for (let i = 0; i < 10; i++) w.stepQueue(agents[0])
  assert.ok(Math.hypot(agents[0].x - g.nodeX[door.node], agents[0].y - g.nodeY[door.node]) < 0.3, 'the head walks to the open doorway')
})

test('a wave reserves different platform doors before any physical queue forms', () => {
  const w = new World(scenarioStation(), 4), g = w.graph, [line, doors] = [...w.doorsByLine][0]
  const origin = g.servers[doors[0]].node, selected = new Set()
  for (let i = 0; i < doors.length * 3; i++) {
    const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, g.nodeX[origin], g.nodeY[origin], g.nodeZ[origin], 0)
    const leg = { kind: 'line', ref: `line:${line}`, node: -1 }
    w.ensureLegNode(a, leg)
    selected.add(a.door)
  }
  assert.equal(selected.size, doors.length, 'committed walkers spread over every platform door')
  assert.ok(doors.every(d => g.servers[d].queue.length === 0), 'the balancing happens before anyone queues')
})
