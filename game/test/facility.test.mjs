// Shop & ticket-booth rooms (zone-tool rectangles).
//
// A shop is a small building: full-height walls around its floor, with NO
// automatic doorway — the player right-clicks a wall to cut an opening, and a
// right-click drag that covers the whole store deletes it. A booth is not a
// walled room at all: a thin desk counter ring with no solid voxel base and no
// opening, served from outside.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  carveFacilityOpenings,
  FACILITY_MIN,
  facilityAt,
  facilityCovers,
  facilityOpeningCells,
  facilityPlan,
  facilityRect,
  facilityWallCells,
  placeFacility,
  removeFacility,
  SHOP_WALL_H,
  toState,
} from '../src/build/model.ts'
import { referenceStation } from '../src/data/reference-station.ts'
import { buildGraph, PathFinder } from '../src/sim/station.ts'

/** Open floor: 10x10 slab at z = 0, plus an optional existing wall column. */
function flatStation({ wallAt = null } = {}) {
  const cells = []
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  if (wallAt) {
    for (let dz = 0; dz <= 3; dz++) cells.push({ x: wallAt[0], y: wallAt[1], z: dz, fill: 'solid' })
  }
  return toState({
    name: 't',
    seed: 1,
    levels: [{ id: 'G', z: 0, kind: 'at-grade', height: 4 }],
    cells,
    modules: [],
    lines: [],
  })
}

const has = (cells, x, y, z) => cells.some((c) => c.x === x && c.y === y && c.z === z)

test('a shop is walled all the way round, with no automatic doorway', () => {
  const r = facilityRect([2, 2, 0], [6, 5, 0], 0)
  const next = placeFacility(flatStation(), 'shop', r, 'shop-1')
  const mod = next.modules.find((m) => m.id === 'shop-1')
  assert.ok(mod && mod.type === 'shop')
  assert.deepEqual([mod.w, mod.h], [5, 4])
  assert.deepEqual(mod.cfg.door, [], 'a shop should be placed with no door')
  // Every perimeter cell gets the full wall column.
  let wallCells = 0
  for (let x = r.x0; x <= r.x1; x++) {
    for (let y = r.y0; y <= r.y1; y++) {
      if (!(x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1)) continue
      for (let dz = 1; dz <= SHOP_WALL_H; dz++) assert.ok(has(next.cells, x, y, dz), `missing wall at ${x},${y},${dz}`)
      wallCells++
    }
  }
  assert.ok(wallCells > 0)
  // The floor underneath is kept, and the interior is open floor.
  assert.ok(has(next.cells, 2, 2, 0), 'the floor under a wall was removed')
  assert.ok(!has(next.cells, 4, 3, 1), 'the interior should have no wall')
})

test('a booth adds no solid cells — it is a desk, not a wall', () => {
  const r = facilityRect([1, 1, 0], [4, 4, 0], 0)
  const next = placeFacility(flatStation(), 'booth', r, 'booth-1')
  const mod = next.modules.find((m) => m.id === 'booth-1')
  assert.ok(mod && mod.type === 'booth')
  // No cell is added at all above the floor.
  assert.ok(!next.cells.some((c) => c.z > 0), 'the booth placed a voxel base')
  assert.equal(next.cells.length, 100, 'the booth changed the floor')
  assert.equal(mod.cfg.door, undefined, 'a booth should have no door')
})

test('right-click carves openings of any size, anywhere on the wall', () => {
  const r = facilityRect([2, 2, 0], [6, 5, 0], 0)
  const st = placeFacility(flatStation(), 'shop', r, 'shop-1')
  const mod = st.modules[0]
  // A 3-wide run along the south wall.
  const dragRect = facilityRect([3, 2, 0], [5, 2, 0], 0)
  const walls = facilityOpeningCells(st.cells, mod, dragRect)
  assert.equal(walls.length, 3 * SHOP_WALL_H, 'expected three full wall columns')
  const cut = carveFacilityOpenings(st, 'shop-1', walls)
  for (const [x, y, z] of walls) assert.ok(!has(cut.cells, x, y, z), `wall ${x},${y},${z} not removed`)
  // The opening is remembered on the module.
  assert.equal(cut.modules[0].cfg.door.length, 3)
  // A second, separate opening elsewhere.
  const drag2 = facilityRect([4, 5, 0], [4, 5, 0], 0)
  const walls2 = facilityOpeningCells(cut.cells, cut.modules[0], drag2)
  assert.ok(walls2.length > 0, 'a single-cell opening should still cut')
  const cut2 = carveFacilityOpenings(cut, 'shop-1', walls2)
  assert.equal(cut2.modules[0].cfg.door.length, 4)
})

test('a drag that covers the whole store means delete', () => {
  const r = facilityRect([2, 2, 0], [6, 5, 0], 0)
  const st = placeFacility(flatStation(), 'shop', r, 'shop-1')
  const mod = st.modules[0]
  assert.equal(facilityCovers(mod, facilityRect([3, 3, 0], [5, 4, 0], 0)), false, 'an interior drag is not a delete')
  assert.equal(facilityCovers(mod, facilityRect([2, 2, 0], [6, 5, 0], 0)), true, 'the exact store is a delete')
  assert.equal(facilityCovers(mod, facilityRect([0, 0, 0], [9, 9, 0], 0)), true, 'a bigger drag is a delete')
})

test('facilityAt finds the store from its floor or any of its walls', () => {
  const r = facilityRect([2, 2, 0], [6, 5, 0], 0)
  const st = placeFacility(flatStation(), 'shop', r, 'shop-1')
  assert.equal(facilityAt(st, 4, 3, 0)?.id, 'shop-1', 'floor cell not found')
  assert.equal(facilityAt(st, 2, 3, 0 + SHOP_WALL_H)?.id, 'shop-1', 'wall cell not found')
  assert.equal(facilityAt(st, 8, 8, 0), undefined, 'found a store where there is none')
})

test('no wall is built where an existing wall already touches', () => {
  const st = flatStation({ wallAt: [1, 3] })
  const r = facilityRect([2, 2, 0], [5, 4, 0], 0)
  const next = placeFacility(st, 'shop', r, 'shop-1')
  assert.ok(!has(next.cells, 2, 3, 1), 'redundant wall built against an existing wall')
  assert.ok(has(next.cells, 3, 2, 1) || has(next.cells, 4, 4, 1), 'unrelated sides lost their walls')
})

test('rooms below the minimum size or without floor are rejected', () => {
  const st = flatStation()
  assert.equal(placeFacility(st, 'shop', facilityRect([0, 0, 0], [1, 1, 0], 0)), st, 'a 2x2 room was accepted')
  assert.equal(placeFacility(st, 'booth', facilityRect([0, 0, 0], [5, 5, 0], 0)).modules.length, 1, 'a valid booth was rejected')
  void FACILITY_MIN
  const edge = placeFacility(st, 'shop', facilityRect([8, 8, 0], [12, 12, 0], 0))
  assert.equal(edge, st, 'a room over void was accepted')
})

test('bulldozing a shop removes its walls but keeps the floor', () => {
  const placed = placeFacility(flatStation(), 'shop', facilityRect([2, 2, 0], [6, 5, 0], 0), 'shop-1')
  const gone = removeFacility(placed, 'shop-1')
  assert.equal(gone.modules.length, 0, 'module not removed')
  assert.equal(gone.cells.length, 100, 'the floor was changed')
  assert.ok(!gone.cells.some((c) => c.z > 0), 'auto walls were left behind')
})

test('a shop with no wall left is not a store — it is removed', () => {
  const r = facilityRect([2, 2, 0], [5, 5, 0], 0)
  const st = placeFacility(flatStation(), 'shop', r, 'shop-1')
  const mod = st.modules[0]
  const ring = facilityWallCells(st.cells, mod)
  assert.equal(ring.length, 2 * (4 + 4) * SHOP_WALL_H - 4 * SHOP_WALL_H, 'unexpected wall ring size')
  const cut = carveFacilityOpenings(st, 'shop-1', ring)
  assert.equal(cut.modules.length, 0, 'the store survived with no walls')
  assert.ok(!cut.cells.some((c) => c.z > 0), 'walls were left behind')
})

test('two rooms of different types may not overlap', () => {
  const st = placeFacility(flatStation(), 'shop', facilityRect([2, 2, 0], [6, 5, 0], 0), 'shop-1')
  // A booth partly on the shop footprint is refused, unchanged.
  assert.equal(placeFacility(st, 'booth', facilityRect([4, 4, 0], [8, 8, 0], 0)), st, 'a booth overlapped a shop')
  // And the reverse: a shop drawn across a booth.
  const boothOnly = placeFacility(flatStation(), 'booth', facilityRect([0, 0, 0], [3, 3, 0], 0), 'booth-1')
  assert.equal(placeFacility(boothOnly, 'shop', facilityRect([2, 2, 0], [6, 5, 0], 0)), boothOnly, 'a shop overlapped a booth')
  // The plan reports the clash so the UI can explain it.
  const plan = facilityPlan(st, 'booth', facilityRect([4, 4, 0], [8, 8, 0], 0))
  assert.equal(plan.blockedBy?.id, 'shop-1')
  assert.equal(plan.merge.length, 0)
})

test('dragging a second room over the same type extends the original', () => {
  const st = placeFacility(flatStation(), 'shop', facilityRect([2, 2, 0], [5, 4, 0], 0), 'shop-1')
  const grown = placeFacility(st, 'shop', facilityRect([4, 4, 0], [7, 6, 0], 0))
  assert.equal(grown.modules.length, 1, 'a second shop module was created')
  const mod = grown.modules[0]
  assert.equal(mod.id, 'shop-1', 'the original room id was not kept')
  assert.deepEqual([mod.x, mod.y, mod.w, mod.h], [2, 2, 6, 5], 'the room did not grow to the union')
  // Walls ring the union, and none are left stranded inside it.
  for (let x = 2; x <= 7; x++) {
    for (let y = 2; y <= 6; y++) {
      if (!(x === 2 || x === 7 || y === 2 || y === 6)) continue
      for (let dz = 1; dz <= SHOP_WALL_H; dz++) assert.ok(has(grown.cells, x, y, dz), `missing new wall ${x},${y},${dz}`)
    }
  }
  assert.ok(!has(grown.cells, 5, 4, 1), 'a wall was left inside the extended room')
  // Touching, not overlapping, still starts a separate room.
  const apart = placeFacility(flatStation(), 'shop', facilityRect([2, 2, 0], [5, 4, 0], 0), 'shop-1')
  assert.equal(placeFacility(apart, 'shop', facilityRect([6, 2, 0], [8, 4, 0], 0)).modules.length, 2)
})

test('two booths extend into one without adding voxels', () => {
  const st = placeFacility(flatStation(), 'booth', facilityRect([1, 1, 0], [3, 3, 0], 0), 'booth-1')
  const grown = placeFacility(st, 'booth', facilityRect([3, 3, 0], [5, 5, 0], 0))
  assert.equal(grown.modules.length, 1, 'a second booth module was created')
  const mod = grown.modules[0]
  assert.equal(mod.id, 'booth-1')
  assert.deepEqual([mod.x, mod.y, mod.w, mod.h], [1, 1, 5, 5])
  assert.ok(!grown.cells.some((c) => c.z > 0), 'a booth extension added voxels')
})

test('extending a shop keeps openings on the new perimeter and drops interior ones', () => {
  const st0 = placeFacility(flatStation(), 'shop', facilityRect([2, 2, 0], [5, 5, 0], 0), 'shop-1')
  const mod = st0.modules[0]
  // One opening on the south wall (y=2, which the extension will bury) and one
  // on the east wall (x=5, which stays on the perimeter).
  const south = facilityOpeningCells(st0.cells, mod, facilityRect([3, 2, 0], [3, 2, 0], 0))
  const east = facilityOpeningCells(st0.cells, mod, facilityRect([5, 3, 0], [5, 3, 0], 0))
  const st = carveFacilityOpenings(st0, 'shop-1', [...south, ...east])
  assert.deepEqual(st.modules[0].cfg.door, [[3, 2], [5, 3]])
  const grown = placeFacility(st, 'shop', facilityRect([2, 0, 0], [5, 3, 0], 0))
  assert.deepEqual([grown.modules[0].w, grown.modules[0].h], [4, 6])
  assert.deepEqual(grown.modules[0].cfg.door, [[5, 3]], 'the surviving opening was not kept')
  assert.ok(!has(grown.cells, 5, 3, 1), 'the kept opening was walled shut')
  assert.ok(has(grown.cells, 3, 0, 1), 'the new perimeter was not walled')
})

test('an extension cannot swallow a room in a bounding-box corner it never touched', () => {
  const a = placeFacility(flatStation(), 'shop', facilityRect([0, 2, 0], [2, 4, 0], 0), 'shop-1')
  const st = placeFacility(a, 'booth', facilityRect([3, 3, 0], [5, 5, 0], 0), 'booth-1')
  assert.equal(st.modules.length, 2)
  // Extending shop-1 (which touches booth-1 nowhere directly) grows its bounding
  // box over booth-1's corner. The clash must refuse the placement.
  const drag = facilityRect([2, 0, 0], [4, 2, 0], 0)
  assert.equal(facilityPlan(st, 'shop', drag).blockedBy?.id, 'booth-1')
  assert.equal(placeFacility(st, 'shop', drag), st, 'an extension swallowed a different-type room')
})

test('the demo station ships one shop and one booth that stay connected', () => {
  const data = referenceStation()
  const shop = data.modules.find((m) => m.id === 'shop-1')
  const booth = data.modules.find((m) => m.id === 'booth-1')
  assert.ok(shop && shop.type === 'shop', 'demo has no shop')
  assert.ok(booth && booth.type === 'booth', 'demo has no booth')
  assert.ok(shop.x + shop.w - 1 === 7, `shop is not against the east wall: x=${shop.x} w=${shop.w}`)
  assert.ok(booth.y > 12, 'booth is not on the unpaid side between the gates and the street')

  const g = buildGraph(data)
  for (const id of ['shop-1', 'booth-1']) assert.ok(g.stops.some((s) => s.id === id), `${id} has no sim stop`)
  // The booth is a desk the crowd is served from outside: no walkable node
  // inside its footprint.
  for (let x = booth.x; x < booth.x + booth.w; x++) {
    for (let y = booth.y; y < booth.y + booth.h; y++) {
      assert.equal(g.nodeIndex.get(`${x},${y},${booth.z}`), undefined, `booth interior ${x},${y} is walkable`)
    }
  }
  const pf = new PathFinder(g)
  const needs = { stepFree: false, luggage: false }
  // The paid hall must still reach the down escalators past the shop.
  const from = g.nodeIndex.get('0,5,-4')
  const to = g.nodeIndex.get('-4,3,-4')
  assert.ok(from !== undefined && to !== undefined)
  assert.ok(pf.search(from, to, needs), 'the shop seals off the platform exit')
  // The shop's authored street-side opening lets the crowd reach the shelves.
  const shopStop = g.stops.find((s) => s.id === 'shop-1').node
  assert.ok(pf.search(g.exits[1].node, shopStop, needs), 'the demo shop is sealed')
  // The booth stop is outside the desk and reachable from the street.
  const boothStop = g.stops.find((s) => s.id === 'booth-1').node
  assert.ok(pf.search(g.exits[1].node, boothStop, needs), 'the booth counter is unreachable')
})
