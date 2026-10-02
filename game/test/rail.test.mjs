// Rail placement and auto-derived platform screen doors (GAME-SPEC §5.4, §5.9).
// Placing a rail digs its bed (the cells become void, so the mesher exposes the
// platform edge as a half-metre drop) and generates one platform-edge per
// contiguous run of platform floor beside the bed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultLine, derivePlatformEdges, dropDerivedEdges, isPlatformCell, placeRail, railModuleAt, regenerateRailEdges } from '../src/build/rail.ts'
import { moduleEnvelope, placementOnTrack, trackBedKeys, trackAt } from '../src/sim/placement.ts'
import { World } from '../src/sim/world.ts'

const G = [{ id: 'G', z: 0, kind: 'at-grade', height: 4.5 }]

function station(cells) {
  return { name: '测试', seed: 1, levels: G, cells, modules: [], lines: [defaultLine('1', 'up', 'third-rail')] }
}

function floorRow(x0, x1, y, finish = 'floor.granite') {
  const out = []
  for (let x = x0; x <= x1; x++) out.push({ x, y, z: 0, fill: 'solid', finish: { top: finish } })
  return out
}

test('placing a rail digs the bed, lays the track and derives the screen doors', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })

  // The bed course is gone; the platform block stays.
  assert.equal(s1.cells.some((c) => c.y === 1 && c.z === 0), false, 'the bed is dug')
  assert.equal(s1.cells.some((c) => c.y === 0), true, 'the platform floor stays')

  const track = s1.modules.find((m) => m.type === 'track')
  assert.ok(track, 'a track module is placed')
  assert.equal(track.w, 6)
  assert.equal(track.d, 1)
  assert.equal(track.cfg.line, '1')

  const edges = s1.modules.filter((m) => m.type === 'platform-edge')
  assert.equal(edges.length, 1, 'one edge on the platform side')
  assert.equal(edges[0].y, 0, 'the edge sits on the platform row')
  assert.equal(edges[0].w, 6)
  assert.equal(edges[0].cfg.from, track.id, 'the edge remembers its rail')
})

test('an island platform beside both sides yields two edges', () => {
  const cells = [...floorRow(0, 4, 0), ...floorRow(0, 4, 1), ...floorRow(0, 4, 2)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 4, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const edges = s1.modules.filter((m) => m.type === 'platform-edge')
  assert.equal(edges.length, 2)
  assert.deepEqual(edges.map((e) => e.y).sort(), [0, 2])
})

test('a wall above a platform cell splits the derived edge', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1), { x: 2, y: 0, z: 1, fill: 'solid' }]
  assert.equal(isPlatformCell(cells, 2, 0, 0), false, 'a cell with a wall above is not platform floor')
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const edges = s1.modules.filter((m) => m.type === 'platform-edge')
  assert.deepEqual(edges.map((e) => [e.x, e.w]), [[0, 2], [3, 3]], 'split either side of the wall')
})

test('regeneration is idempotent and follows the current platform floor', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const track = s1.modules.find((m) => m.type === 'track')
  const once = regenerateRailEdges(s1, track.id)
  const twice = regenerateRailEdges(once, track.id)
  assert.equal(twice.modules.filter((m) => m.type === 'platform-edge').length, 1, 'no duplicate edges')

  // Withdraw the platform: the derived edge goes away.
  const bare = { ...s1, cells: s1.cells.filter((c) => c.y !== 0) }
  const regen = regenerateRailEdges(bare, track.id)
  assert.equal(regen.modules.filter((m) => m.type === 'platform-edge').length, 0)
})

test('the dug bed blocks equipment and reads as track by either rule', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const track = s1.modules.find((m) => m.type === 'track')

  assert.ok(trackAt(s1.modules, 3, 1, 0), 'trackAt finds the bed')
  assert.ok(railModuleAt(s1, 0, 1, 0), 'the inspector finds the rail')
  assert.ok(trackBedKeys(s1.cells, s1.modules).has('3,1,0'), 'the bed is a track key')

  const env = moduleEnvelope(track)
  assert.equal(env.z0, 0)
  assert.equal(env.z1, 1, 'the trench fills the block, so equipment cannot sit in it')
  assert.equal(placementOnTrack(s1.cells, { id: 'g', type: 'gate', x: 2, y: 1, z: 0, cfg: { dir: 'both' } }, s1.modules), true, 'equipment is refused in the bed')

  const removed = dropDerivedEdges(s1, track.id)
  assert.equal(removed.modules.filter((m) => m.type === 'platform-edge').length, 0)
})

test('a second rail may not overlap the first bed', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1), ...floorRow(0, 5, 2)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const again = placeRail(s1, { x0: 3, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  assert.equal(again, s1, 'an overlapping rail is refused unchanged')
})

test('a rail with no platform still gets a running train', () => {
  const cells = []
  for (let x = 0; x < 40; x++) for (let y = 0; y < 3; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const s0 = station(cells)
  const s1 = placeRail(s0, { x0: 0, y0: 0, x1: 39, y1: 2, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  assert.equal(s1.modules.filter((m) => m.type === 'platform-edge').length, 0, 'nothing beside the bed')

  // The anchor comes from the track, not the edge, so the consist appears.
  const w = new World(s1, 99)
  w.tickOnce()
  const pose = w.trainRenderState()
  assert.equal(pose.length, 8, 'one train, one pose')
  assert.equal(pose[3], 6, 'six cars')
  assert.equal(pose[2], 0.5, 'rides the recessed slab')
})

test('a fresh line is B stock, six cars, and carries the rail direction', () => {
  const line = defaultLine('3', 'down', 'catenary')
  assert.equal(line.id, '3')
  assert.equal(line.name, '3号线')
  assert.equal(line.stock, 'B')
  assert.equal(line.cars, 6)
  assert.equal(line.power, 'catenary')
  assert.equal(line.direction, 'down')
  assert.equal(line.travelSign, 1)
  // A line is born wearing the Guangzhou Metro sign colour for its number.
  assert.equal(line.colour, '#e89e47', 'line 3 is the Guangzhou orange')
  assert.equal(defaultLine('1', 'up', 'third-rail').colour, '#edcf3b', 'line 1 is yellow')
  assert.equal(defaultLine('2', 'up', 'third-rail').colour, '#00679e', 'line 2 is blue')
  assert.equal(defaultLine('99', 'up', 'third-rail').colour, '#2f7ef2', 'unknown numbers fall back')
})

test('the reference station ships a dug bed with an auto-consistent edge', async () => {
  const { referenceStation } = await import('../src/data/reference-station.ts')
  const s = referenceStation()
  const track = s.modules.find((m) => m.type === 'track')
  assert.ok(track, 'the demo lays a track module')
  assert.equal(track.d, 3, 'a three-metre bed fits the Type-B car')
  // The bed cells are dug, so nothing is left painted floor.track under it.
  for (let x = track.x; x < track.x + track.w; x++) {
    for (let y = track.y; y < track.y + (track.d ?? 1); y++) {
      assert.equal(s.cells.some((c) => c.x === x && c.y === y && c.z === track.z), false)
    }
  }
})
