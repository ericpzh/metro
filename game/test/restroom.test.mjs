// Restroom fixtures (厕所) and the ticket booth's staff seats (售票亭), GAME-SPEC
// §5.7. A restroom stocks one `cubicle` per back-row cell and one `sink` per
// front-row cell; a booth stocks one `bench` per back-row cell facing the
// counter. Each is an individually bulldozable module, migrated on load.
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

const restroom = (id = 'toilet-1') => ({ id, type: 'shop', x: 0, y: 0, z: 0, w: 4, h: 4, cfg: { kind: 'toilet', door: [] } })
const booth = (id = 'booth-1') => ({ id, type: 'booth', x: 0, y: 0, z: 0, w: 4, h: 4, cfg: { kind: 'ticket' } })
const cubicle = (x, y, z, id = 'c1') => ({ id, type: 'cubicle', x, y, z, rot: 0, cfg: {} })
const sink = (x, y, z, id = 's1') => ({ id, type: 'sink', x, y, z, rot: 0, cfg: {} })
const gate = (x, y, z, id = 'gate-1') => ({ id, type: 'gate', x, y, z, cfg: { dir: 'both' } })
const of = (state, type) => state.modules.filter((m) => m.type === type)

test('cubicles and sinks are created with the hover rotation', () => {
  assert.equal(createModule('cubicle', 1, 2, 3, 'c')?.type, 'cubicle')
  assert.equal(createModule('cubicle', 1, 2, 3, 'c', 1)?.rot, 1)
  assert.equal(createModule('sink', 1, 2, 3, 's')?.type, 'sink')
  assert.equal(createModule('sink', 1, 2, 3, 's', 2)?.rot, 2)
})

test('restroom fixtures may stand inside a walled room, but not other equipment', () => {
  assert.equal(placementBlocked([restroom()], cubicle(1, 2, 0)), false)
  assert.equal(placementBlocked([restroom()], sink(1, 0, 0)), false)
  assert.equal(placementBlocked([cubicle(1, 2, 0)], restroom()), false)
  // Fixtures still collide with each other and with other equipment.
  assert.equal(placementBlocked([cubicle(1, 2, 0)], sink(1, 2, 0)), true)
  assert.equal(placementBlocked([gate(1, 2, 0)], cubicle(1, 2, 0)), true)
})

test('moduleAt prefers a restroom fixture over the room around it', () => {
  const r = restroom()
  const c = cubicle(1, 2, 0)
  assert.equal(moduleAt([r, c], 1, 2, 0)?.id, c.id)
  assert.equal(moduleAt([c, r], 1, 2, 0)?.id, c.id)
})

test('placing a restroom stocks cubicles on the back row and sinks on the front', () => {
  const next = placeFacility(flatStation(), 'toilet', facilityRect([2, 2, 0], [5, 5, 0], 0), 'toilet-1')
  const room = next.modules.find((m) => m.id === 'toilet-1')
  assert.equal(room.cfg.stocked, true)
  const cubes = of(next, 'cubicle')
  const sinks = of(next, 'sink')
  // 4x4 room: interior columns x = 3,4; back row y = 4, front row y = 2.
  assert.deepEqual(cubes.map((m) => [m.x, m.y]).sort(), [[3, 4], [4, 4]])
  assert.deepEqual(sinks.map((m) => [m.x, m.y]).sort(), [[3, 2], [4, 2]])
  assert.ok([...cubes, ...sinks].every((m) => m.cfg.auto === true), 'every stocked unit is marked auto')
})

test('a door cell gets no fixture', () => {
  // Carve the back-middle opening before stocking via the migration path: draw
  // the legacy room with a door recorded at (3,4).
  const legacy = {
    name: 't',
    seed: 1,
    cells: flatStation().cells,
    modules: [{ id: 'toilet-1', type: 'shop', x: 2, y: 2, z: 0, w: 4, h: 4, cfg: { kind: 'toilet', door: [[3, 4]] } }],
    lines: [],
  }
  const st = toState(legacy)
  const cubes = of(st, 'cubicle').map((m) => [m.x, m.y])
  assert.ok(!cubes.some(([x, y]) => x === 3 && y === 4), 'a fixture was stocked over a door')
  assert.deepEqual(cubes.sort(), [[4, 4]])
})

test('placing a booth stocks one staff bench per back-row cell, facing the counter', () => {
  const next = placeFacility(flatStation(), 'booth', facilityRect([2, 2, 0], [5, 5, 0], 0), 'booth-1')
  const room = next.modules.find((m) => m.id === 'booth-1')
  assert.equal(room.cfg.stocked, true)
  const benches = of(next, 'bench')
  assert.deepEqual(benches.map((m) => [m.x, m.y, m.rot]).sort(), [[3, 4, 2], [4, 4, 2]])
  assert.ok(benches.every((m) => m.cfg.auto === true))
})

test('each fixture deletes on its own, and bulldozing keeps hand-placed ones', () => {
  let st = placeFacility(flatStation(), 'toilet', facilityRect([2, 2, 0], [5, 5, 0], 0), 'toilet-1')
  const first = of(st, 'cubicle')[0]
  const cut = removeModule(st, first.id)
  assert.equal(of(cut, 'cubicle').length, of(st, 'cubicle').length - 1)
  assert.ok(cut.modules.some((m) => m.id === 'toilet-1'), 'the room went with its fixture')

  const hand = createModule('sink', 3, 3, 0, 'hand-1')
  st = addEquipment(st, hand)
  const gone = removeFacility(st, 'toilet-1')
  assert.deepEqual(gone.modules.filter((m) => m.type === 'sink').map((m) => m.id), ['hand-1'], 'auto sinks stayed or the hand sink went')
  assert.equal(of(gone, 'cubicle').length, 0, 'auto cubicles outlived the room')
})

test('bulldozing a booth drops its auto benches', () => {
  const st = placeFacility(flatStation(), 'booth', facilityRect([2, 2, 0], [5, 5, 0], 0), 'booth-1')
  const gone = removeFacility(st, 'booth-1')
  assert.equal(of(gone, 'bench').length, 0, 'auto benches stayed after bulldozing the booth')
})

test('legacy restrooms and booths migrate on load, once', () => {
  const cells = flatStation().cells
  const legacy = {
    name: 't',
    seed: 1,
    cells,
    modules: [restroom(), { ...booth(), x: 5 }],
    lines: [],
  }
  const once = toState(legacy)
  assert.equal(once.modules.find((m) => m.id === 'toilet-1').cfg.stocked, true)
  assert.equal(once.modules.find((m) => m.id === 'booth-1').cfg.stocked, true)
  const cubeCount = of(once, 'cubicle').length
  const sinkCount = of(once, 'sink').length
  const benchCount = of(once, 'bench').length
  assert.ok(cubeCount > 0 && sinkCount > 0 && benchCount > 0, 'fixtures were not materialised')
  const twice = toState(toData(once))
  assert.equal(of(twice, 'cubicle').length, cubeCount, 'a reload re-stocked the restroom')
  assert.equal(of(twice, 'bench').length, benchCount, 'a reload re-stocked the booth')
})

test('a stocked restroom and its fixtures survive the save round trip', () => {
  const placed = placeFacility(flatStation(), 'toilet', facilityRect([2, 2, 0], [5, 5, 0], 0), 'toilet-1')
  const r = parse(serialize(placed))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, placed.modules)
  assert.deepEqual(r.state.cells, placed.cells)
})
