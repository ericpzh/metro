// Facility rooms (zone-tool rectangles).
//
// A walled room — 商店 (shop), 厕所 (toilet), 办公室 (office) — places a
// footprint module only: full-height walls are NOT built (the player walls the
// footprint with the block tool) and no furniture is stocked. All three share
// the `shop` module type and pick their fit-out with `cfg.kind`. A booth
// (售票亭 ticket, 问讯处 info) is not a walled room at all: a thin desk counter
// ring with no solid voxel base and no opening, served from outside, which
// keeps its staff benches.
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
  thinWallSideMap,
  toState,
} from '../src/build/model.ts'
import { scenarioStation } from './support/scenario-station.ts'
import { buildGraph, PathFinder } from '../src/sim/station.ts'
import { moduleLabel } from '../src/app/store/catalog.ts'
import { useStore } from '../src/app/store.ts'
import { PickTool } from '../src/app/tools/PickTool.ts'

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
    cells,
    modules: [],
    lines: [],
  })
}

const has = (cells, x, y, z) => cells.some((c) => c.x === x && c.y === y && c.z === z)

/** The wall columns the block tool would lay around a footprint, in test form. */
function wallRing(r) {
  const out = []
  for (let x = r.x0; x <= r.x1; x++) {
    for (let y = r.y0; y <= r.y1; y++) {
      if (!(x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1)) continue
      for (let dz = 1; dz <= SHOP_WALL_H; dz++) out.push({ x, y, z: r.z + dz, fill: 'solid' })
    }
  }
  return out
}

test('a shop places a footprint with no walls and no doorway', () => {
  const before = flatStation()
  const r = facilityRect([2, 2, 0], [6, 5, 0], 0)
  const next = placeFacility(before, 'store', r, 'shop-1')
  const mod = next.modules.find((m) => m.id === 'shop-1')
  assert.ok(mod && mod.type === 'shop')
  assert.deepEqual([mod.w, mod.h], [5, 4])
  assert.equal(mod.cfg.kind, 'store', 'the brush fit-out was not recorded')
  assert.deepEqual(mod.cfg.door, [], 'a shop should be placed with no door')
  assert.equal(mod.cfg.stocked, true)
  // No wall column is built: the player walls the footprint with the block tool.
  assert.equal(next.cells.length, before.cells.length, 'placing a shop built walls')
  assert.ok(!next.cells.some((c) => c.z > 0), 'placing a shop built walls')
  // The floor underneath is kept, and the interior is open floor.
  assert.ok(has(next.cells, 2, 2, 0), 'the floor under the footprint was removed')
  assert.ok(!has(next.cells, 4, 3, 1), 'the interior should have no wall')
})

test('a booth adds no solid cells — it is a desk, not a wall', () => {
  const r = facilityRect([1, 1, 0], [4, 4, 0], 0)
  const next = placeFacility(flatStation(), 'ticket', r, 'booth-1')
  const mod = next.modules.find((m) => m.id === 'booth-1')
  assert.ok(mod && mod.type === 'booth')
  // No cell is added at all above the floor.
  assert.ok(!next.cells.some((c) => c.z > 0), 'the booth placed a voxel base')
  assert.equal(next.cells.length, 100, 'the booth changed the floor')
  assert.equal(mod.cfg.door, undefined, 'a booth should have no door')
})

test('right-click carves player-built walls of any size, anywhere on the wall', () => {
  const r = facilityRect([2, 2, 0], [6, 5, 0], 0)
  const bare = placeFacility(flatStation(), 'store', r, 'shop-1')
  // A fresh footprint has no walls, so there is nothing to open — and carving
  // nothing leaves the room exactly as it was.
  const mod = bare.modules[0]
  assert.equal(
    facilityOpeningCells(bare.cells, mod, facilityRect([3, 2, 0], [5, 2, 0], 0)).length,
    0,
    'a fresh footprint has openings',
  )
  assert.equal(carveFacilityOpenings(bare, 'shop-1', []), bare, 'carving nothing changed the room')
  const st = { ...bare, cells: [...bare.cells, ...wallRing(r)] }
  const walled = st.modules[0]
  // A 3-wide run along the south wall.
  const dragRect = facilityRect([3, 2, 0], [5, 2, 0], 0)
  const walls = facilityOpeningCells(st.cells, walled, dragRect)
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
  const st = placeFacility(flatStation(), 'store', r, 'shop-1')
  const mod = st.modules[0]
  assert.equal(facilityCovers(mod, facilityRect([3, 3, 0], [5, 4, 0], 0)), false, 'an interior drag is not a delete')
  assert.equal(facilityCovers(mod, facilityRect([2, 2, 0], [6, 5, 0], 0)), true, 'the exact store is a delete')
  assert.equal(facilityCovers(mod, facilityRect([0, 0, 0], [9, 9, 0], 0)), true, 'a bigger drag is a delete')
})

test('facilityAt finds the store from its floor or any of its walls', () => {
  const r = facilityRect([2, 2, 0], [6, 5, 0], 0)
  const st = placeFacility(flatStation(), 'store', r, 'shop-1')
  assert.equal(facilityAt(st, 4, 3, 0)?.id, 'shop-1', 'floor cell not found')
  assert.equal(facilityAt(st, 2, 3, 0 + SHOP_WALL_H)?.id, 'shop-1', 'wall cell not found')
  assert.equal(facilityAt(st, 8, 8, 0), undefined, 'found a store where there is none')
})

test('placing next to an existing wall builds nothing and leaves it alone', () => {
  const st = flatStation({ wallAt: [1, 3] })
  const before = st.cells.length
  const r = facilityRect([2, 2, 0], [5, 4, 0], 0)
  const next = placeFacility(st, 'store', r, 'shop-1')
  assert.equal(next.cells.length, before, 'placing a room built walls')
  for (let dz = 0; dz <= 3; dz++) assert.ok(has(next.cells, 1, 3, dz), `the existing wall column lost 1,3,${dz}`)
  const mod = next.modules.find((m) => m.id === 'shop-1')
  assert.deepEqual([mod.w, mod.h], [4, 3], 'the footprint is not the drawn rect')
})

test('rooms below the minimum size or without floor are rejected', () => {
  const st = flatStation()
  assert.equal(placeFacility(st, 'store', facilityRect([0, 0, 0], [1, 1, 0], 0)), st, 'a 2x2 room was accepted')
  assert.equal(
    placeFacility(st, 'ticket', facilityRect([0, 0, 0], [5, 5, 0], 0)).modules.filter((m) => m.type === 'booth').length,
    1,
    'a valid booth was rejected',
  )
  void FACILITY_MIN
  // One storey up, where there is no street: at z = 0 the cell outside the plate is
  // implicit ground (`sim/ground.ts`) and is floor like any other, so "over void"
  // has to be asked where void can actually be.
  const edge = placeFacility(st, 'store', facilityRect([8, 8, 4], [12, 12, 4], 4))
  assert.equal(edge, st, 'a room over void was accepted')
})

test('bulldozing a shop removes its walls but keeps the floor', () => {
  const placed = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [6, 5, 0], 0), 'shop-1')
  const gone = removeFacility(placed, 'shop-1')
  assert.equal(gone.modules.length, 0, 'module not removed')
  assert.equal(gone.cells.length, 100, 'the floor was changed')
  assert.ok(!gone.cells.some((c) => c.z > 0), 'auto walls were left behind')
})

test('a shop with no player-built wall left is not a store — it is removed', () => {
  const r = facilityRect([2, 2, 0], [5, 5, 0], 0)
  const bare = placeFacility(flatStation(), 'store', r, 'shop-1')
  const st = { ...bare, cells: [...bare.cells, ...wallRing(r)] }
  const mod = st.modules[0]
  const ring = facilityWallCells(st.cells, mod)
  assert.equal(ring.length, 2 * (4 + 4) * SHOP_WALL_H - 4 * SHOP_WALL_H, 'unexpected wall ring size')
  const cut = carveFacilityOpenings(st, 'shop-1', ring)
  assert.equal(cut.modules.length, 0, 'the store survived with no walls')
  assert.ok(!cut.cells.some((c) => c.z > 0), 'walls were left behind')
})

test('two rooms of different types may not overlap', () => {
  const st = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [6, 5, 0], 0), 'shop-1')
  // A booth partly on the shop footprint is refused, unchanged.
  assert.equal(placeFacility(st, 'ticket', facilityRect([4, 4, 0], [8, 8, 0], 0)), st, 'a booth overlapped a shop')
  // And the reverse: a shop drawn across a booth.
  const boothOnly = placeFacility(flatStation(), 'ticket', facilityRect([0, 0, 0], [3, 3, 0], 0), 'booth-1')
  assert.equal(placeFacility(boothOnly, 'store', facilityRect([2, 2, 0], [6, 5, 0], 0)), boothOnly, 'a shop overlapped a booth')
  // The plan reports the clash so the UI can explain it.
  const plan = facilityPlan(st, 'ticket', facilityRect([4, 4, 0], [8, 8, 0], 0))
  assert.equal(plan.blockedBy?.id, 'shop-1')
  assert.equal(plan.merge.length, 0)
})

test('dragging a second room over the same type extends the original', () => {
  const st = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [5, 4, 0], 0), 'shop-1')
  const grown = placeFacility(st, 'store', facilityRect([4, 4, 0], [7, 6, 0], 0))
  assert.equal(
    grown.modules.filter((m) => m.type === 'shop').length,
    1,
    'a second shop module was created',
  )
  const mod = grown.modules[0]
  assert.equal(mod.id, 'shop-1', 'the original room id was not kept')
  assert.deepEqual([mod.x, mod.y, mod.w, mod.h], [2, 2, 6, 5], 'the room did not grow to the union')
  assert.equal(mod.cfg.kind, 'store', 'the extension lost the fit-out')
  assert.equal(mod.cfg.stocked, true)
  // The union is a footprint only: no walls ring it, and none stand inside it.
  assert.equal(grown.cells.length, 100, 'extending a room built walls')
  assert.ok(!grown.cells.some((c) => c.z > 0), 'a wall was left inside the extended room')
  // Touching, not overlapping, still starts a separate room.
  const apart = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [5, 4, 0], 0), 'shop-1')
  const split = placeFacility(apart, 'store', facilityRect([6, 2, 0], [8, 4, 0], 0))
  assert.equal(
    split.modules.filter((m) => m.type === 'shop').length,
    2,
    'touching rooms did not stay separate',
  )
})

test('two booths extend into one without adding voxels', () => {
  const st = placeFacility(flatStation(), 'ticket', facilityRect([1, 1, 0], [3, 3, 0], 0), 'booth-1')
  const grown = placeFacility(st, 'ticket', facilityRect([3, 3, 0], [5, 5, 0], 0))
  assert.equal(grown.modules.filter((m) => m.type === 'booth').length, 1, 'a second booth module was created')
  const mod = grown.modules.find((m) => m.type === 'booth')
  assert.equal(mod.id, 'booth-1')
  assert.deepEqual([mod.x, mod.y, mod.w, mod.h], [1, 1, 5, 5])
  assert.ok(!grown.cells.some((c) => c.z > 0), 'a booth extension added voxels')
})

test('extending a shop keeps openings on the new perimeter and drops interior ones', () => {
  const st0 = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [5, 5, 0], 0), 'shop-1')
  const walled = { ...st0, cells: [...st0.cells, ...wallRing(facilityRect([2, 2, 0], [5, 5, 0], 0))] }
  const mod = walled.modules[0]
  // One opening on the south wall (y=2, which the extension will bury) and one
  // on the east wall (x=5, which stays on the perimeter).
  const south = facilityOpeningCells(walled.cells, mod, facilityRect([3, 2, 0], [3, 2, 0], 0))
  const east = facilityOpeningCells(walled.cells, mod, facilityRect([5, 3, 0], [5, 3, 0], 0))
  const st = carveFacilityOpenings(walled, 'shop-1', [...south, ...east])
  assert.deepEqual(st.modules[0].cfg.door, [[3, 2], [5, 3]])
  const grown = placeFacility(st, 'store', facilityRect([2, 0, 0], [5, 3, 0], 0))
  assert.deepEqual([grown.modules[0].w, grown.modules[0].h], [4, 6])
  assert.deepEqual(grown.modules[0].cfg.door, [[5, 3]], 'the surviving opening was not kept')
  // The extension builds no walls of its own, and the merge clears only the
  // absorbed ring the union buries: the old south wall is interior now, while
  // the east wall still on the edge is the player's and stays.
  assert.ok(!has(grown.cells, 4, 2, 1), 'the buried south wall was left standing')
  assert.ok(has(grown.cells, 5, 2, 1), 'the merge ate the perimeter east wall')
  assert.ok(has(grown.cells, 5, 4, 1), 'the merge ate the perimeter east wall')
  assert.ok(has(grown.cells, 2, 4, 1), 'the merge ate the perimeter west wall')
  assert.ok(!has(grown.cells, 5, 3, 1), 'the kept opening was walled shut')
  assert.ok(!has(grown.cells, 3, 0, 1), 'the extension built its own walls')
})

test('an extension cannot swallow a room in a bounding-box corner it never touched', () => {
  const a = placeFacility(flatStation(), 'store', facilityRect([0, 2, 0], [2, 4, 0], 0), 'shop-1')
  const st = placeFacility(a, 'ticket', facilityRect([3, 3, 0], [5, 5, 0], 0), 'booth-1')
  assert.equal(
    st.modules.filter((m) => m.type === 'shop' || m.type === 'booth').length,
    2,
    'expected one shop and one booth module',
  )
  // Extending shop-1 (which touches booth-1 nowhere directly) grows its bounding
  // box over booth-1's corner. The clash must refuse the placement.
  const drag = facilityRect([2, 0, 0], [4, 2, 0], 0)
  assert.equal(facilityPlan(st, 'store', drag).blockedBy?.id, 'booth-1')
  assert.equal(placeFacility(st, 'store', drag), st, 'an extension swallowed a different-type room')
})

test('toilet and office are footprint rooms with their own fit-out', () => {
  for (const kind of ['toilet', 'office']) {
    const r = facilityRect([2, 2, 0], [5, 4, 0], 0)
    const before = flatStation()
    const st = placeFacility(before, kind, r, `${kind}-1`)
    const mod = st.modules.find((m) => m.id === `${kind}-1`)
    assert.ok(mod && mod.type === 'shop', `${kind} is not a shop-type room`)
    assert.equal(mod.cfg.kind, kind, `${kind} did not record its fit-out`)
    assert.deepEqual(mod.cfg.door, [], `${kind} should be placed with no door`)
    assert.equal(mod.cfg.stocked, true)
    // A footprint only: no walls are built.
    assert.equal(st.cells.length, before.cells.length, `${kind} built walls`)
    // A player-built wall still opens, and the fit-out survives the edit.
    const walled = { ...st, cells: [...st.cells, ...wallRing(r)] }
    const walls = facilityOpeningCells(walled.cells, walled.modules[0], facilityRect([3, 2, 0], [3, 2, 0], 0))
    assert.ok(walls.length > 0, `${kind} has no player-built wall to open`)
    const cut = carveFacilityOpenings(walled, `${kind}-1`, walls)
    assert.equal(cut.modules[0].cfg.kind, kind)
    assert.equal(cut.modules[0].cfg.door.length, 1)
    // And bulldozing takes the module, not the floor.
    const gone = removeFacility(st, `${kind}-1`)
    assert.equal(gone.modules.length, 0, 'module not removed')
    assert.equal(gone.cells.length, 100)
  }
})

test('rooms of a different fit-out do not overlap or merge', () => {
  const st = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [6, 5, 0], 0), 'shop-1')
  // A toilet drawn across the shop is refused, unchanged.
  assert.equal(placeFacility(st, 'toilet', facilityRect([4, 4, 0], [8, 8, 0], 0)), st, 'a toilet overlapped a shop')
  const plan = facilityPlan(st, 'toilet', facilityRect([4, 4, 0], [8, 8, 0], 0))
  assert.equal(plan.blockedBy?.id, 'shop-1')
  assert.equal(plan.merge.length, 0)
})

test('two toilets of the same fit-out extend into one room', () => {
  const st = placeFacility(flatStation(), 'toilet', facilityRect([1, 1, 0], [3, 3, 0], 0), 'toilet-1')
  const grown = placeFacility(st, 'toilet', facilityRect([3, 3, 0], [5, 5, 0], 0))
  assert.equal(grown.modules.filter((m) => m.type === 'shop').length, 1, 'a second toilet module was created')
  const room = grown.modules.find((m) => m.type === 'shop')
  assert.equal(room.id, 'toilet-1')
  assert.equal(room.cfg.kind, 'toilet')
  assert.deepEqual([room.w, room.h], [5, 5])
})

test('the info booth (问讯处) builds cfg.kind info with staff benches', () => {
  const next = placeFacility(flatStation(), 'info', facilityRect([2, 2, 0], [5, 5, 0], 0), 'booth-1')
  const room = next.modules.find((m) => m.id === 'booth-1')
  assert.ok(room && room.type === 'booth', 'an info brush should build a booth, not a room')
  assert.equal(room.cfg.kind, 'info')
  assert.equal(room.cfg.stocked, true)
  assert.equal(moduleLabel('booth', room.cfg.kind), '问讯处', 'the info booth reads as a 售票亭')
  assert.equal(moduleLabel('booth', 'ticket'), '售票亭')
  // The same seats as a ticket booth: one bench per back-row interior cell,
  // facing the counter (rot 2).
  const benches = next.modules.filter((m) => m.type === 'bench')
  assert.deepEqual(
    benches.map((m) => [m.x, m.y, m.rot]).sort(),
    [[3, 4, 2], [4, 4, 2]],
  )
  assert.ok(benches.every((m) => m.cfg.auto === true))
  // A different booth kind is a clash, not a merge.
  assert.equal(
    placeFacility(next, 'ticket', facilityRect([4, 4, 0], [7, 7, 0], 0)),
    next,
    'a ticket booth merged into an info booth',
  )
})

/** The picker with the scene stubbed and the drawn-model pick scripted. */
function ctxFor(pickedId) {
  const ref = (v = null) => ({ current: v })
  return new PickTool({
    scene: () => ({ setGhost: () => {}, setCursor: () => {}, setModulePreview: () => {}, setCollisionHighlight: () => {} }),
    pick: () => null,
    pickModule: () => pickedId,
    facing: () => undefined,
    solids: () => new Set(useStore.getState().station.cells.filter((c) => c.fill === 'solid').map((c) => `${c.x},${c.y},${c.z}`)),
    thins: () => thinWallSideMap(useStore.getState().station.cells, useStore.getState().station.modules),
    hover: ref(),
    drag: ref(),
    paint: ref(),
    zoneDrag: ref(),
    facilityDrag: ref(),
    showMeasure: () => {},
    clearMeasure: () => {},
  })
}

/** One left press on a cell; `solid` says the ray hit a block face. */
function press(cell, solid = true, button = 0) {
  return {
    clientX: 0,
    clientY: 0,
    button,
    buttons: button === 2 ? 2 : 1,
    shiftKey: false,
    hit: { cell, place: [cell[0], cell[1], cell[2] + 1], solid, normal: [0, 0, 1], point: [cell[0] + 0.5, cell[1] + 0.5] },
    preventDefault: () => {},
  }
}

test('picking an info booth arms the info zone brush', () => {
  const before = useStore.getState()
  try {
    const station = placeFacility(flatStation(), 'info', facilityRect([2, 2, 0], [5, 5, 0], 0), 'booth-1')
    useStore.setState({ station, tool: 'pick', zoneBrush: 'paid', pickDraft: null })
    ctxFor('booth-1').onDown(press([2, 2, 0]))
    const st = useStore.getState()
    assert.equal(st.tool, 'zone')
    assert.equal(st.zoneBrush, 'info', 'the 问讯处 booth arms its own brush, revealing 房间')
    assert.equal(st.selected.key, 'booth-1')
    assert.equal(st.selected.label, '问讯处')
  } finally {
    useStore.setState(before)
  }
})

test('the demo station ships one shop and one booth that stay connected', () => {
  const data = scenarioStation()
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
