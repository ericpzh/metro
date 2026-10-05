// Goods shelves (货架, GAME-SPEC §5.7): a store stocks one `shelf` module per
// layout spot — island rows plus wall runs — so every auto shelf is an
// individually bulldozable piece, and legacy rooms are migrated on load.
import test from 'node:test'
import assert from 'node:assert/strict'
import { moduleAt, placementBlocked } from '../src/sim/placement.ts'
import {
  addEquipment,
  createModule,
  facilityRect,
  facilityRectOf,
  facilityWallCells,
  placeFacility,
  removeFacility,
  removeModule,
  carveFacilityOpenings,
  toData,
  toState,
} from '../src/build/model.ts'
import { parse, serialize } from '../src/persistence/save.ts'

/** Open floor: 10x10 slab at z = 0. */
function flatStation() {
  const cells = []
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  return toState({ name: 't', seed: 1, cells, modules: [], lines: [] })
}

const shop = (id = 'shop-1', cfg = { kind: 'store', door: [] }) => ({ id, type: 'shop', x: 0, y: 0, z: 0, w: 5, h: 5, cfg })
const booth = (id = 'booth-1') => ({ id, type: 'booth', x: 0, y: 0, z: 0, w: 3, h: 3, cfg: { kind: 'ticket' } })
const shelf = (x, y, z, id = 'shelf-1', rot = 0) => ({ id, type: 'shelf', x, y, z, rot, cfg: {} })
const gate = (x, y, z, id = 'gate-1') => ({ id, type: 'gate', x, y, z, cfg: { dir: 'both' } })
const bench = (x, y, z, id = 'bench-1') => ({ id, type: 'bench', x, y, z, cfg: {} })
const shelvesOf = (state) => state.modules.filter((m) => m.type === 'shelf')

test('a shelf is created with the hover rotation, like any equipment', () => {
  assert.equal(createModule('shelf', 1, 2, 3, 's')?.rot, 0)
  assert.equal(createModule('shelf', 1, 2, 3, 's', 2)?.rot, 2)
  assert.equal(createModule('shelf', 1, 2, 3, 's')?.type, 'shelf')
})

test('a shelf may stand inside a walled room or booth', () => {
  assert.equal(placementBlocked([shop()], shelf(2, 2, 0)), false)
  assert.equal(placementBlocked([booth()], shelf(1, 1, 0)), false)
  // Either side of the pair may be the candidate.
  assert.equal(placementBlocked([shelf(2, 2, 0)], shop()), false)
  // But shelves still collide with each other and with other equipment.
  assert.equal(placementBlocked([shelf(2, 2, 0, 'a')], shelf(2, 2, 0, 'b')), true)
  assert.equal(placementBlocked([gate(2, 2, 0)], shelf(2, 2, 0, 'b')), true)
  // The booth's own staff bench is furniture too, so it may stand inside a booth.
  assert.equal(placementBlocked([booth()], bench(1, 1, 0)), false)
})

test('moduleAt prefers furniture over the room around it', () => {
  const s = shop()
  const f = shelf(2, 2, 0)
  assert.equal(moduleAt([s, f], 2, 2, 0)?.id, f.id)
  assert.equal(moduleAt([f, s], 2, 2, 0)?.id, f.id)
  // Away from the furniture, the room itself still answers.
  assert.equal(moduleAt([s, f], 4, 4, 0)?.id, s.id)
})

test('placing a store stocks one shelf module per layout spot', () => {
  // 5x4 room: no island rows (too shallow), wall runs only —
  // 3 south + 3 north + 2 west + 2 east.
  const next = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [6, 5, 0], 0), 'shop-1')
  const room = next.modules.find((m) => m.id === 'shop-1')
  assert.ok(room && room.type === 'shop', 'the room module comes first')
  assert.equal(room.cfg.stocked, true)
  const stocked = shelvesOf(next)
  assert.equal(stocked.length, 10, `expected 10 auto shelves, got ${stocked.length}`)
  assert.ok(stocked.every((m) => m.cfg.auto === true), 'every stocked shelf is marked auto')
  // Each wall shelf backs onto its own wall: south −y (2), north +y (0),
  // west −x (1), east +x (3).
  const byRot = [0, 1, 2, 3].map((r) => stocked.filter((m) => m.rot === r).length)
  assert.deepEqual(byRot, [3, 2, 3, 2])
})

test('each shelf deletes on its own, leaving room and neighbours', () => {
  const next = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [6, 5, 0], 0), 'shop-1')
  const first = shelvesOf(next)[0]
  const cut = removeModule(next, first.id)
  assert.equal(shelvesOf(cut).length, shelvesOf(next).length - 1)
  assert.ok(cut.modules.some((m) => m.id === 'shop-1'), 'the room went with its shelf')
  assert.equal(cut.cells.length, next.cells.length, 'a shelf bulldoze touched the voxels')
})

test('bulldozing a room drops its auto shelves but keeps hand-placed ones', () => {
  let st = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [6, 5, 0], 0), 'shop-1')
  const hand = createModule('shelf', 4, 3, 0, 'hand-1', 1)
  st = addEquipment(st, hand)
  assert.equal(shelvesOf(st).length, 11)
  const gone = removeFacility(st, 'shop-1')
  assert.deepEqual(
    shelvesOf(gone).map((m) => m.id),
    ['hand-1'],
    'auto shelves stayed or the hand shelf went',
  )
  assert.equal(gone.cells.length, 100, 'the floor was changed')
})

test('opening every wall drops the room and its auto shelves', () => {
  const st = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [5, 5, 0], 0), 'shop-1')
  const before = shelvesOf(st).length
  assert.ok(before > 0, 'the room stocked no shelves')
  const ring = facilityWallCells(st.cells, st.modules[0])
  const cut = carveFacilityOpenings(st, 'shop-1', ring)
  assert.ok(!cut.modules.some((m) => m.type === 'shop'), 'the wall-less room survived')
  assert.equal(shelvesOf(cut).length, 0, 'auto shelves outlived their room')
})

test('extending a room re-stocks without stacking two units on a cell', () => {
  const st = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [5, 4, 0], 0), 'shop-1')
  const grown = placeFacility(st, 'store', facilityRect([4, 4, 0], [7, 6, 0], 0))
  const rooms = grown.modules.filter((m) => m.type === 'shop')
  assert.equal(rooms.length, 1, 'a second shop module was created')
  assert.equal(rooms[0].cfg.stocked, true)
  const keys = shelvesOf(grown).map((m) => `${m.x},${m.y},${m.z}`)
  assert.equal(new Set(keys).size, keys.length, 'two shelves share a cell')
  assert.ok(shelvesOf(grown).every((m) => m.cfg.auto === true), 'a merge kept a stale unit')
})

test('legacy rooms are migrated on load, once', () => {
  // A store drawn before shelves became modules: no units, no flags.
  const legacy = { name: 't', seed: 1, cells: flatStation().cells, modules: [shop()], lines: [] }
  const once = toState(legacy)
  const room = once.modules.find((m) => m.id === 'shop-1')
  assert.equal(room.cfg.stocked, true)
  const count = shelvesOf(once).length
  assert.ok(count > 0, 'no shelves were materialised')
  // Reloading never duplicates: everything is already stocked.
  const twice = toState(toData(once))
  assert.equal(shelvesOf(twice).length, count, 'a reload re-stocked the room')
  assert.deepEqual(
    shelvesOf(twice).map((m) => m.id),
    shelvesOf(once).map((m) => m.id),
    'shelf ids moved across a reload',
  )
  // A room the player already cleared of drawn shelving stays empty.
  const cleared = toState({ ...legacy, modules: [shop('shop-1', { kind: 'store', door: [], bare: true })] })
  assert.equal(shelvesOf(cleared).length, 0, 'a cleared room was re-stocked')
  assert.equal(cleared.modules[0].cfg.stocked, true)
  // Toilets never stock shelves.
  const wc = toState({ ...legacy, modules: [{ id: 'wc', type: 'shop', x: 0, y: 0, z: 0, w: 5, h: 5, cfg: { kind: 'toilet', door: [] } }] })
  assert.equal(shelvesOf(wc).length, 0, 'a toilet was stocked')
})

test('a stocked room and its shelves survive the save round trip', () => {
  const placed = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [6, 5, 0], 0), 'shop-1')
  const r = parse(serialize(placed))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, placed.modules)
  assert.deepEqual(r.state.cells, placed.cells)
})
