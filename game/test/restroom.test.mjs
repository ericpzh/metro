// Restroom fixtures (厕所) and the booths' staff seats (售票亭 / 问讯处),
// GAME-SPEC §5.7. Restrooms are footprint-only — placing one stocks no
// cubicles or sinks; the player fits the room out by hand. A booth (ticket or
// info) still stocks one `bench` per back-row cell facing the counter. Each
// hand-placed unit is an individually bulldozable module.
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

test('placing a restroom lays a footprint only — no cubicles, no sinks, no walls', () => {
  const before = flatStation()
  const next = placeFacility(before, 'toilet', facilityRect([2, 2, 0], [5, 5, 0], 0), 'toilet-1')
  const room = next.modules.find((m) => m.id === 'toilet-1')
  assert.ok(room && room.type === 'shop', 'the room module comes first')
  assert.equal(room.cfg.kind, 'toilet', 'the brush fit-out was not recorded')
  assert.deepEqual(room.cfg.door, [], 'a fresh footprint should carry no door')
  assert.equal(room.cfg.stocked, true)
  assert.equal(of(next, 'cubicle').length, 0, 'placing a restroom stocked cubicles')
  assert.equal(of(next, 'sink').length, 0, 'placing a restroom stocked sinks')
  assert.equal(next.cells.length, before.cells.length, 'placing a restroom built wall cells')
})

test('a recorded door stocks no fixture — rooms stock nothing at all', () => {
  // A legacy room with a carved opening still migrates to stocked-and-empty,
  // keeping its door markers.
  const legacy = {
    name: 't',
    seed: 1,
    cells: flatStation().cells,
    modules: [{ id: 'toilet-1', type: 'shop', x: 2, y: 2, z: 0, w: 4, h: 4, cfg: { kind: 'toilet', door: [[3, 4]] } }],
    lines: [],
  }
  const st = toState(legacy)
  assert.equal(of(st, 'cubicle').length, 0, 'a fixture was stocked')
  assert.equal(of(st, 'sink').length, 0, 'a fixture was stocked')
  assert.deepEqual(st.modules[0].cfg.door, [[3, 4]], 'the recorded door was lost')
  assert.equal(st.modules[0].cfg.stocked, true)
})

test('placing a booth stocks one staff bench per back-row cell, facing the counter', () => {
  const next = placeFacility(flatStation(), 'ticket', facilityRect([2, 2, 0], [5, 5, 0], 0), 'booth-1')
  const room = next.modules.find((m) => m.id === 'booth-1')
  assert.equal(room.cfg.stocked, true)
  const benches = of(next, 'bench')
  assert.deepEqual(benches.map((m) => [m.x, m.y, m.rot]).sort(), [[3, 4, 2], [4, 4, 2]])
  assert.ok(benches.every((m) => m.cfg.auto === true))
})

test('each fixture deletes on its own, and bulldozing keeps hand-placed ones', () => {
  let st = placeFacility(flatStation(), 'toilet', facilityRect([2, 2, 0], [5, 5, 0], 0), 'toilet-1')
  st = addEquipment(st, createModule('cubicle', 3, 3, 0, 'c-hand'))
  const cut = removeModule(st, 'c-hand')
  assert.equal(of(cut, 'cubicle').length, 0)
  assert.ok(cut.modules.some((m) => m.id === 'toilet-1'), 'the room went with its fixture')
  assert.equal(cut.cells.length, st.cells.length, 'a fixture bulldoze touched the voxels')
  st = cut

  const hand = createModule('sink', 3, 3, 0, 'hand-1')
  st = addEquipment(st, hand)
  // Auto-flagged units (what the old stocking used to lay) still go with the room.
  st = {
    ...st,
    modules: [
      ...st.modules,
      { id: 'auto-1', type: 'sink', x: 4, y: 4, z: 0, rot: 0, cfg: { auto: true } },
      { id: 'auto-2', type: 'cubicle', x: 3, y: 4, z: 0, rot: 0, cfg: { auto: true } },
    ],
  }
  const gone = removeFacility(st, 'toilet-1')
  assert.deepEqual(gone.modules.filter((m) => m.type === 'sink').map((m) => m.id), ['hand-1'], 'auto sinks stayed or the hand sink went')
  assert.equal(of(gone, 'cubicle').length, 0, 'auto cubicles outlived the room')
})

test('bulldozing a booth drops its auto benches', () => {
  const st = placeFacility(flatStation(), 'ticket', facilityRect([2, 2, 0], [5, 5, 0], 0), 'booth-1')
  const gone = removeFacility(st, 'booth-1')
  assert.equal(of(gone, 'bench').length, 0, 'auto benches stayed after bulldozing the booth')
})

test('legacy restrooms mark stocked without materialising; booths still stock benches', () => {
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
  assert.equal(of(once, 'cubicle').length, 0, 'cubicles were materialised')
  assert.equal(of(once, 'sink').length, 0, 'sinks were materialised')
  const benchCount = of(once, 'bench').length
  assert.ok(benchCount > 0, 'booth benches were not materialised')
  const twice = toState(toData(once))
  assert.equal(of(twice, 'cubicle').length, 0, 'a reload stocked the restroom')
  assert.equal(of(twice, 'sink').length, 0, 'a reload stocked the restroom')
  assert.equal(of(twice, 'bench').length, benchCount, 'a reload re-stocked the booth')
})

test('a stocked restroom and its fixtures survive the save round trip', () => {
  const placed = placeFacility(flatStation(), 'toilet', facilityRect([2, 2, 0], [5, 5, 0], 0), 'toilet-1')
  const r = parse(serialize(placed))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, placed.modules)
  assert.deepEqual(r.state.cells, placed.cells)
})
