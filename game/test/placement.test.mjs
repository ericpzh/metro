// Equipment collision and bulldozing (GAME-SPEC §5). Every module has a real
// footprint; two may not share space, but a gate line of modules in adjacent
// cells is legal, and a module four metres up on the next storey does not
// collide with the one below.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxesOverlap, isTrackBed, moduleAt, moduleEnvelope, placementBlocked, placementOnTrack, reservedOpening } from '../src/sim/placement.ts'
import { addCells, createModule, GROUND_Z, nextModuleId, removeModule, toState } from '../src/build/model.ts'

const gate = (x, y, z, id = 'gate') => ({ id, type: 'gate', x, y, z, cfg: { dir: 'both' } })
const tvm = (x, y, z, id = 'tvm') => ({ id, type: 'tvm', x, y, z, cfg: {} })
const exit = (x, y, z, id = 'exit') => ({ id, type: 'exit', x, y, z, cfg: { name: 'A口', inRate: 900, open: true } })
const esc = (id = 'esc') => ({
  id,
  type: 'escalator',
  x: 0,
  y: 0,
  z: 0,
  from: { x: 0, y: 0, z: 0 },
  to: { x: 0, y: -7, z: -4 },
  cfg: { dir: 'up' },
})

test('a module never collides with itself or an empty station', () => {
  assert.equal(moduleEnvelope(gate(0, 0, 0)) !== null, true)
  assert.equal(placementBlocked([], gate(0, 0, 0)), false)
  assert.equal(placementBlocked([gate(0, 0, 0, 'a')], gate(0, 0, 0, 'a')), false)
})

test('two modules may not share a cell, but a gate line is legal', () => {
  assert.equal(placementBlocked([gate(0, 0, 0, 'a')], gate(0, 0, 0, 'b')), true)
  assert.equal(placementBlocked([gate(0, 0, 0, 'a')], tvm(0, 0, 0, 'b')), true)
  // Adjacent cells share a boundary but not space: the reference gate line.
  assert.equal(placementBlocked([gate(0, 0, 0, 'a')], gate(1, 0, 0, 'b')), false)
  assert.equal(placementBlocked([gate(0, 0, 0, 'a')], tvm(1, 0, 0, 'b')), false)
})

test('a module on the storey above is not a conflict', () => {
  assert.equal(placementBlocked([gate(0, 0, 0, 'a')], gate(0, 0, 4, 'b')), false)
  assert.equal(placementBlocked([tvm(0, 0, 0, 'a')], tvm(0, 0, 4, 'b')), false)
})

test('an exit keeps its whole enclosure clear', () => {
  assert.equal(placementBlocked([exit(0, 0, 0, 'e')], gate(0, 1, 0, 'g')), true)
  assert.equal(placementBlocked([exit(0, 0, 0, 'e')], gate(0, 0, 0, 'g')), true)
  // Just outside the head-house, on the plaza.
  assert.equal(placementBlocked([exit(0, 0, 0, 'e')], gate(0, 3, 0, 'g')), false)
  assert.equal(placementBlocked([exit(0, 0, 0, 'e')], gate(4, 0, 0, 'g')), false)
})

test('a ramp corridor blocks flat equipment inside it', () => {
  assert.equal(placementBlocked([esc()], gate(0, 0, 0, 'g')), true)
  assert.equal(placementBlocked([esc()], gate(5, 0, 0, 'g')), false)
})

test('moduleAt finds a module from any cell it covers', () => {
  assert.equal(moduleAt([gate(0, 0, 0, 'a')], 0, 0, 0)?.id, 'a')
  assert.equal(moduleAt([gate(0, 0, 0, 'a')], 1, 0, 0), undefined)
  const e = exit(0, 0, 0, 'e')
  assert.equal(moduleAt([e], 1, 1, 0)?.id, 'e')
  assert.equal(moduleAt([e], 0, 3, 0), undefined)
  assert.equal(moduleAt([esc()], 0, 0, 0)?.id, 'esc')
})

test('boxesOverlap is strict, so touching boxes do not collide', () => {
  const a = { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }
  const b = { x0: 1, y0: 0, z0: 0, x1: 2, y1: 1, z1: 1 }
  assert.equal(boxesOverlap(a, b), false)
  assert.equal(boxesOverlap(a, { ...b, x0: 0.5 }), true)
})

test('bulldozing removes only that module and leaves its block', () => {
  const state = toState({
    name: 't',
    seed: 1,
    cells: [{ x: 0, y: 0, z: 0, fill: 'solid' }],
    modules: [gate(0, 0, 0, 'a'), tvm(1, 0, 0, 'b')],
    lines: [],
  })
  const next = removeModule(state, 'a')
  assert.deepEqual(next.modules.map((m) => m.id), ['b'])
  assert.equal(next.cells.length, 1)
  assert.equal(removeModule(state, 'missing'), state)
})

test('the placement factory carries the hover rotation into the placed module', () => {
  assert.equal(createModule('gate', 1, 2, 3, 'g')?.rot, 0)
  assert.equal(createModule('gate', 1, 2, 3, 'g', 1)?.rot, 1)
  assert.equal(createModule('tvm', 1, 2, 3, 't', 3)?.rot, 3)
  // Unknown types stay unplaceable.
  assert.equal(createModule('nope', 0, 0, 0, 'x'), null)
})

test('a surface exit is rooted at the street (z = 0)', () => {
  assert.equal(GROUND_Z, 0)
})

test('a fresh id is never one already in use', () => {
  const state = toState({
    name: 't',
    seed: 1,
    cells: [],
    modules: [gate(0, 0, 0, 'gate-1'), gate(1, 0, 0, 'gate-2')],
    lines: [],
  })
  // Length is 2, so the naive `gate-3` is free — but after bulldozing gate-1
  // the length drops and the naive id would collide.
  const id = nextModuleId([state.modules[1]], 'gate')
  assert.notEqual(id, 'gate-2')
  assert.equal([state.modules[1]].some((m) => m.id === id), false)
})

/* ------------------------------------------------------- rail track beds */

/** A 3x3 slab whose top finish is a track bed on the y = 0 row. */
const trackBedCells = () => {
  const cells = []
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) {
      cells.push({ x, y, z: 0, fill: 'solid', finish: { top: y === 0 ? 'floor.track' : 'floor.granite' } })
    }
  }
  return cells
}

test('isTrackBed sees only solid top faces painted as a track bed', () => {
  const cells = trackBedCells()
  assert.equal(isTrackBed(cells, 0, 0, 0), true)
  assert.equal(isTrackBed(cells, 1, 0, 0), true)
  assert.equal(isTrackBed(cells, 0, 1, 0), false)
  assert.equal(isTrackBed(cells, 0, 2, 0), false)
  // Void, or the wrong storey, is never a track bed.
  assert.equal(isTrackBed(cells, 9, 9, 0), false)
  assert.equal(isTrackBed(cells, 0, 0, 4), false)
  assert.equal(isTrackBed([{ x: 0, y: 0, z: 0, fill: 'void', finish: { top: 'floor.track' } }], 0, 0, 0), false)
})

test('equipment may not be placed on a rail track bed', () => {
  const cells = trackBedCells()
  assert.equal(placementOnTrack(cells, gate(0, 0, 0, 'g')), true)
  assert.equal(placementOnTrack(cells, tvm(2, 0, 0, 't')), true)
  // The next row is passenger floor, so placement is fine.
  assert.equal(placementOnTrack(cells, gate(0, 1, 0, 'g')), false)
  assert.equal(placementOnTrack(cells, gate(9, 9, 0, 'g')), false)
})

test('a room straddling a track bed is refused, not just its anchor cell', () => {
  const cells = trackBedCells()
  const shop = { id: 'shop', type: 'shop', x: 0, y: 0, z: 0, w: 2, h: 2, cfg: { kind: 'store', door: [] } }
  // The anchor (0, 0) is on the bed; a room anchored off the bed but reaching
  // onto it is blocked too.
  assert.equal(placementOnTrack(cells, shop), true)
  assert.equal(placementOnTrack(cells, { ...shop, y: -1 }), true, 'the far row still reaches the bed')
  assert.equal(placementOnTrack(cells, { ...shop, y: 1 }), false, 'clear of the bed')
})

/* -------------------------------------------- reserved auto-generated openings */

/** A descending escalator run along +y, from (0,0,0) to (0,6,-4). */
const rampRun = () => ({
  id: 'e',
  type: 'escalator',
  x: 0,
  y: 0,
  z: 0,
  from: { x: 0, y: 0, z: 0 },
  to: { x: 0, y: 6, z: -4 },
  cfg: { dir: 'down' },
})

test('a ramp reserves the corridor it carves, but not its landing or the blocks outside', () => {
  const r = rampRun()
  assert.equal(reservedOpening([r], 0, 3, 0), true, 'a cell in the carved corridor is reserved')
  assert.equal(reservedOpening([r], 0, 0, 0), false, 'the landing sits on the walking line, not reserved')
  assert.equal(reservedOpening([r], 5, 3, 0), false, 'a cell beyond the handrail is free')
  assert.equal(reservedOpening([], 0, 3, 0), false, 'no ramps reserves nothing')
})

test('an exit reserves the floor it lays over a hole', () => {
  const e = exit(0, 0, 0, 'e')
  assert.equal(reservedOpening([e], 0, 0, 0), true, 'inside the head-house floor')
  assert.equal(reservedOpening([e], 5, 5, 0), false, 'well outside the footprint')
})

test('building a block may not cover a reserved opening', () => {
  const r = rampRun()
  // The first two candidates fall in the ramp's corridor; only the far cell may
  // be built, and the refused count reports what the brush dropped.
  const { cells, changed, blocked } = addCells([], [[0, 3, 0], [0, 4, 0], [5, 5, 0]], [r])
  assert.equal(changed, 1)
  assert.equal(blocked, 2)
  assert.deepEqual(cells.map((c) => [c.x, c.y, c.z]), [[5, 5, 0]])
})
