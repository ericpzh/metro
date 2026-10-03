// Office desks (办公桌, GAME-SPEC §5.7): the office grid unit as a placeable,
// rotatable 装饰 piece. An office stocks one `desk` module per grid spot, each
// individually bulldozable, and legacy offices are migrated on load.
import test from 'node:test'
import assert from 'node:assert/strict'
import { moduleAt, placementBlocked } from '../src/sim/placement.ts'
import {
  addEquipment,
  createModule,
  facilityRect,
  placeFacility,
  removeFacility,
  removeModule,
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

const office = (id = 'office-1') => ({ id, type: 'shop', x: 0, y: 0, z: 0, w: 5, h: 5, cfg: { kind: 'office', door: [] } })
const desk = (x, y, z, id = 'desk-1', rot = 0) => ({ id, type: 'desk', x, y, z, rot, cfg: {} })
const gate = (x, y, z, id = 'gate-1') => ({ id, type: 'gate', x, y, z, cfg: { dir: 'both' } })
const desksOf = (state) => state.modules.filter((m) => m.type === 'desk')

test('a desk is created with the hover rotation, like any equipment', () => {
  assert.equal(createModule('desk', 1, 2, 3, 'd')?.rot, 0)
  assert.equal(createModule('desk', 1, 2, 3, 'd', 3)?.rot, 3)
  assert.equal(createModule('desk', 1, 2, 3, 'd')?.type, 'desk')
})

test('a desk may stand inside a walled room', () => {
  assert.equal(placementBlocked([office()], desk(2, 2, 0)), false)
  // Either side of the pair may be the candidate.
  assert.equal(placementBlocked([desk(2, 2, 0)], office()), false)
  // But desks still collide with each other and with other equipment.
  assert.equal(placementBlocked([desk(2, 2, 0, 'a')], desk(2, 2, 0, 'b')), true)
  assert.equal(placementBlocked([gate(2, 2, 0)], desk(2, 2, 0, 'b')), true)
})

test('moduleAt prefers a desk over the room around it', () => {
  const o = office()
  const d = desk(3, 3, 0)
  assert.equal(moduleAt([o, d], 3, 3, 0)?.id, d.id)
  assert.equal(moduleAt([d, o], 3, 3, 0)?.id, d.id)
})

test('placing an office stocks one desk module per grid spot', () => {
  // 5x4 room: one grid row (y=3), two grid columns (x=3,5).
  const next = placeFacility(flatStation(), 'office', facilityRect([2, 2, 0], [6, 5, 0], 0), 'office-1')
  const room = next.modules.find((m) => m.id === 'office-1')
  assert.ok(room && room.type === 'shop', 'the room module comes first')
  assert.equal(room.cfg.stocked, true)
  const stocked = desksOf(next)
  assert.equal(stocked.length, 2, `expected 2 auto desks, got ${stocked.length}`)
  assert.ok(stocked.every((m) => m.cfg.auto === true), 'every stocked desk is marked auto')
  assert.deepEqual(
    stocked.map((m) => [m.x, m.y, m.rot]).sort(),
    [[3, 3, 0], [5, 3, 0]],
  )
})

test('each desk deletes on its own, leaving room and neighbours', () => {
  const next = placeFacility(flatStation(), 'office', facilityRect([2, 2, 0], [6, 5, 0], 0), 'office-1')
  const first = desksOf(next)[0]
  const cut = removeModule(next, first.id)
  assert.equal(desksOf(cut).length, desksOf(next).length - 1)
  assert.ok(cut.modules.some((m) => m.id === 'office-1'), 'the room went with its desk')
  assert.equal(cut.cells.length, next.cells.length, 'a desk bulldoze touched the voxels')
})

test('bulldozing an office drops its auto desks but keeps hand-placed ones', () => {
  let st = placeFacility(flatStation(), 'office', facilityRect([2, 2, 0], [6, 5, 0], 0), 'office-1')
  const hand = createModule('desk', 4, 4, 0, 'hand-1', 1)
  st = addEquipment(st, hand)
  assert.equal(desksOf(st).length, 3)
  const gone = removeFacility(st, 'office-1')
  assert.deepEqual(
    desksOf(gone).map((m) => m.id),
    ['hand-1'],
    'auto desks stayed or the hand desk went',
  )
})

test('legacy offices are migrated on load, once', () => {
  const legacy = { name: 't', seed: 1, cells: flatStation().cells, modules: [office()], lines: [] }
  const once = toState(legacy)
  assert.equal(once.modules.find((m) => m.id === 'office-1').cfg.stocked, true)
  const count = desksOf(once).length
  assert.ok(count > 0, 'no desks were materialised')
  const twice = toState(toData(once))
  assert.equal(desksOf(twice).length, count, 'a reload re-stocked the office')
})

test('a stocked office and its desks survive the save round trip', () => {
  const placed = placeFacility(flatStation(), 'office', facilityRect([2, 2, 0], [6, 5, 0], 0), 'office-1')
  const r = parse(serialize(placed))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, placed.modules)
  assert.deepEqual(r.state.cells, placed.cells)
})
