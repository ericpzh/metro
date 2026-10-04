// Equipment collision and bulldozing (GAME-SPEC §5). Every module has a real
// footprint; two may not share space, but a gate line of modules in adjacent
// cells is legal, and a module four metres up on the next storey does not
// collide with the one below.
import test from 'node:test'
import assert from 'node:assert/strict'
import { autofaceWallMount, boxesOverlap, isTrackBed, moduleAt, moduleEnvelope, placementBlocked, placementOnTrack, reservedOpening, wallMountMissing, wallMountStandCell, wallSide } from '../src/sim/placement.ts'
import { addCells, addEquipment, createModule, GROUND_Z, nextExitName, nextModuleId, randomAdSlug, removeModule, toData, toState } from '../src/build/model.ts'
import { billboardSpec, postersFor } from '../src/sim/billboards.ts'

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

/* ------------------------------------------------ wall-mounted decoration */

const billboard = (x, y, z, rot = 0, id = 'bb') => ({ id, type: 'billboard', x, y, z, rot, w: 1, cfg: { variant: 'wide' } })

test('wallSide turns the mount direction with the module rotation', () => {
  assert.deepEqual(wallSide(0), [0, -1])
  assert.deepEqual(wallSide(1), [1, 0])
  assert.deepEqual(wallSide(2), [0, 1])
  assert.deepEqual(wallSide(3), [-1, 0])
  assert.deepEqual(wallSide(undefined), [0, -1])
})

test('a wall-mounted ad needs a solid wall block behind it', () => {
  const floor = [{ x: 0, y: 0, z: 0, fill: 'solid' }]
  const bb = billboard(0, 0, 0)
  assert.equal(wallMountMissing(floor, bb), true, 'no wall yet')
  // The wall rises from the floor top (z + 1) in the facing neighbour.
  assert.equal(wallMountMissing([...floor, { x: 0, y: -1, z: 1, fill: 'solid' }], bb), false)
  // A solid floor neighbour at the same level is not a wall.
  assert.equal(wallMountMissing([...floor, { x: 0, y: -1, z: 0, fill: 'solid' }], bb), true)
})

test('rotating a wall-mounted ad moves the wall it needs', () => {
  const floor = [{ x: 0, y: 0, z: 0, fill: 'solid' }]
  const wallEast = [...floor, { x: 1, y: 0, z: 1, fill: 'solid' }]
  assert.equal(wallMountMissing(wallEast, billboard(0, 0, 0, 0)), true)
  assert.equal(wallMountMissing(wallEast, billboard(0, 0, 0, 1)), false)
})

test('a wall-mounted ad turns itself to face the wall, with no R needed', () => {
  const floor = [{ x: 0, y: 0, z: 0, fill: 'solid' }]
  // A wall to the east: the panel must end up at rot 1 whatever the player held.
  const wallEast = [...floor, { x: 1, y: 0, z: 1, fill: 'solid' }]
  for (const held of [0, 2, 3]) {
    const faced = autofaceWallMount(wallEast, billboard(0, 0, 0, held))
    assert.equal(faced.rot, 1, `held rot ${held} should not survive a wall to the east`)
    assert.equal(wallMountMissing(wallEast, faced), false, 'the result must actually be mounted')
  }
  // ...and equally for a wall to the north, south and west.
  for (const [wx, wy, want] of [[0, 1, 2], [0, -1, 0], [-1, 0, 3]]) {
    const cells = [...floor, { x: wx, y: wy, z: 1, fill: 'solid' }]
    assert.equal(autofaceWallMount(cells, billboard(0, 0, 0, 1)).rot, want, `wall at ${wx},${wy}`)
  }
})

test('a turn that already faces a wall is left alone', () => {
  // The player's own choice is respected when it is valid, so deliberately
  // flipping a panel between two walls is not undone under their hands.
  const floor = [{ x: 0, y: 0, z: 0, fill: 'solid' }]
  const both = [...floor, { x: 1, y: 0, z: 1, fill: 'solid' }, { x: 0, y: -1, z: 1, fill: 'solid' }]
  assert.equal(autofaceWallMount(both, billboard(0, 0, 0, 0)).rot, 0, 'an east wall must not steal a south-facing panel')
  assert.equal(autofaceWallMount(both, billboard(0, 0, 0, 1)).rot, 1)
})

test('in a corner the panel takes the wall the pointer is nearest', () => {
  // Two walls, neither matching the held turn: the aim decides. `near` is a
  // world position, so the wall step is comparable to it.
  const floor = [{ x: 0, y: 0, z: 0, fill: 'solid' }]
  const corner = [...floor, { x: 1, y: 0, z: 1, fill: 'solid' }, { x: 0, y: 1, z: 1, fill: 'solid' }]
  const held = billboard(0, 0, 0, 0) // faces south, which is not a wall here
  assert.equal(autofaceWallMount(corner, held, [2, 0.5]).rot, 1, 'aiming east takes the east wall')
  assert.equal(autofaceWallMount(corner, held, [0.5, 2]).rot, 2, 'aiming north takes the north wall')
})

test('with no wall in any direction the ad is refused, not spun', () => {
  const floor = [{ x: 0, y: 0, z: 0, fill: 'solid' }]
  const held = billboard(0, 0, 0, 2)
  const faced = autofaceWallMount(floor, held)
  assert.equal(faced.rot, 2, 'there is nothing to face, so the turn must not be invented')
  assert.equal(wallMountMissing(floor, faced), true, 'the caller still sees the refusal')
  // Non-wall-mounted modules are passed straight through.
  const gate = { id: 'g', type: 'gate', x: 0, y: 0, z: 0, rot: 3, cfg: {} }
  assert.equal(autofaceWallMount(floor, gate).rot, 3)
})

test('a two-cell run autofaces only to a wall that backs both cells', () => {
  const floor = [{ x: 0, y: 0, z: 0, fill: 'solid' }, { x: 1, y: 0, z: 0, fill: 'solid' }]
  const run = { id: 'bb', type: 'billboard', x: 0, y: 0, z: 0, rot: 0, w: 2, cfg: { variant: 'large' } }
  // A wall behind only the first cell cannot back the run, so the run stays
  // where it was and the caller refuses it.
  const half = [...floor, { x: 0, y: -1, z: 1, fill: 'solid' }]
  assert.equal(autofaceWallMount(half, run).rot, 0)
  assert.equal(wallMountMissing(half, autofaceWallMount(half, run)), true)
  // A wall spanning both cells is a real mount.
  const full = [...half, { x: 1, y: -1, z: 1, fill: 'solid' }]
  assert.equal(wallMountMissing(full, autofaceWallMount(full, run)), false)
})

test('a billboard factory names the variant and its run length', () => {
  const wide = createModule('billboard-wide', 0, 0, 0, 'b1')
  assert.equal(wide?.type, 'billboard')
  assert.equal(wide?.w, 1)
  assert.equal(wide?.cfg.variant, 'wide')
  const portrait = createModule('billboard-portrait', 0, 0, 0, 'b2')
  assert.equal(portrait?.cfg.variant, 'portrait')
  const large = createModule('billboard-large', 0, 0, 0, 'b3')
  assert.equal(large?.w, 2)
  assert.equal(large?.cfg.variant, 'large')
  // The two later formats: a two-cell 标准 and the three-cell 长幅 strip.
  assert.equal(createModule('billboard-standard', 0, 0, 0, 'b4')?.w, 2)
  assert.equal(createModule('billboard-panorama', 0, 0, 0, 'b5')?.w, 3)
  // A fresh piece carries no poster yet: the roll happens on commit, so the
  // hover ghost does not re-roll its artwork on every pointer move.
  assert.equal(wide?.cfg.poster, undefined)
})

test('a placed ad screen rolls one poster and keeps it', () => {
  const state = { name: 's', seed: 1, cells: [], modules: [], lines: [] }
  const placed = addEquipment(state, createModule('billboard-standard', 0, 0, 0, 'billboard-1'))
  const billboard = placed.modules.find((m) => m.id === 'billboard-1')
  assert.equal(typeof billboard.cfg.poster, 'string')
  // The roll is deterministic in the module id, so re-placing the same piece
  // (an undo/redo pair) hangs the same campaign.
  assert.equal(billboard.cfg.poster, randomAdSlug({ id: 'billboard-1', type: 'billboard', x: 0, y: 0, z: 0, w: 2, cfg: { variant: 'standard' } }))
  // A landscape panel is only ever offered landscape artwork.
  assert.ok(postersFor(billboardSpec('standard').shape).some((p) => p.slug === billboard.cfg.poster))
  // A committed piece is never re-rolled: adding another module leaves it alone.
  const more = addEquipment(placed, createModule('tvm', 5, 5, 0, 'tvm-1'))
  assert.equal(more.modules.find((m) => m.id === 'billboard-1').cfg.poster, billboard.cfg.poster)
  // The 电视 prints a poster of its own, rolled the same way.
  const tv = addEquipment(more, createModule('tv', 9, 9, 0, 'tv-1'))
  assert.equal(typeof tv.modules.find((m) => m.id === 'tv-1').cfg.poster, 'string')
})

test('a poster-less legacy save is backfilled once, at load', () => {
  const legacy = {
    name: 's',
    seed: 1,
    cells: [],
    modules: [{ id: 'billboard-9', type: 'billboard', x: 0, y: 0, z: 0, rot: 0, w: 1, cfg: { variant: 'wide' } }],
    lines: [],
  }
  const first = toState(legacy)
  const slug = first.modules[0].cfg.poster
  assert.equal(typeof slug, 'string')
  // The backfill is part of the document, so a second load of the same save
  // prints the same poster instead of rolling a new one per frame.
  assert.equal(toState(legacy).modules[0].cfg.poster, slug)
  assert.equal(toState(toData(first)).modules[0].cfg.poster, slug)
})

test('a two-cell billboard needs a wall behind both cells', () => {
  const run = (x, rot = 0, id = 'bb') => ({ id, type: 'billboard', x, y: 0, z: 0, rot, w: 2, cfg: { variant: 'large' } })
  const floor = [
    { x: 0, y: 0, z: 0, fill: 'solid' },
    { x: 1, y: 0, z: 0, fill: 'solid' },
  ]
  // Only one of the two backing cells has a wall: the banner would hang off.
  assert.equal(wallMountMissing([...floor, { x: 0, y: -1, z: 1, fill: 'solid' }], run(0)), true)
  assert.equal(
    wallMountMissing([...floor, { x: 0, y: -1, z: 1, fill: 'solid' }, { x: 1, y: -1, z: 1, fill: 'solid' }], run(0)),
    false,
  )
  // A quarter-turn puts the run along +y, so the walls move to +x.
  assert.equal(
    wallMountMissing([...floor, { x: 1, y: 0, z: 1, fill: 'solid' }, { x: 1, y: 1, z: 1, fill: 'solid' }], run(0, 1)),
    false,
  )
})

test('a wall-mounted ad may stand over a track when the pointer is on the wall', () => {
  // The station wall across the track: the hovered cell is the wall block, so
  // the panel belongs in the face-adjacent cell in front of it (over the track).
  const wall = { x: 0, y: -1, z: 0, fill: 'solid', tags: ['auto-wall'] }
  assert.deepEqual(wallMountStandCell([wall], [0, -1, 0], [0, 0, 0]), [0, 0, 0])
  // Hovering a plain floor cell keeps the panel on that floor cell.
  const floor = { x: 0, y: 0, z: 0, fill: 'solid', tags: ['auto-floor'] }
  assert.deepEqual(wallMountStandCell([floor], [0, 0, 0], [0, 0, 1]), [0, 0, 0])
})

test('a floor-standing module never needs a wall', () => {
  assert.equal(wallMountMissing([], gate(0, 0, 0)), false)
  assert.equal(wallMountMissing([], tvm(0, 0, 0)), false)
})

test('a fence may stand beside a stair, but not on its landing node', () => {
  // A run reserves exactly the tile it stands in, so the cell beside it is free
  // ground a fence can take — and the run can meet the handrail there
  // (`railLandingAt` in the renderer). The run's own cells, landings included,
  // are its graph nodes and stay clear.
  const stair = createModule('stair-straight', 0, 0, -4, 's', 0)
  assert.ok(stair)
  assert.equal(placementBlocked([stair], createModule('fence', 1, 6, 0, 'f', 0)), false, 'beside the top landing')
  assert.equal(placementBlocked([stair], createModule('fence', -1, 4, 0, 'f', 0)), false, 'mid-run, beside the body')
  assert.equal(placementBlocked([stair], createModule('fence', 0, 6, 0, 'f', 0)), true, 'on the top landing')
  assert.equal(placementBlocked([stair], createModule('fence', 0, 0, -4, 'f', 0)), true, 'on the lower landing')
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

test('a new exit letters itself A ~ Z and reuses a freed letter', () => {
  // An empty station's first exit is A口, the next B口, and so on.
  assert.equal(nextExitName([]), 'A口')
  const a = exit(0, 0, 0, 'exit-1')
  assert.equal(nextExitName([a]), 'B口')
  const b = { ...exit(1, 0, 0, 'exit-2'), cfg: { name: 'B口', inRate: 900, open: true } }
  assert.equal(nextExitName([a, b]), 'C口')
  // A rename that does not start A ~ Z does not claim a letter.
  const renamed = { ...a, cfg: { name: '北广场', inRate: 900, open: true } }
  assert.equal(nextExitName([renamed]), 'A口')
  // Editing A口 away frees A for the next piece.
  assert.equal(nextExitName([b]), 'A口')
  // Only exits count: other equipment never claims a letter.
  assert.equal(nextExitName([gate(0, 0, 0, 'g')]), 'A口')
})

test('the placeholder returns once all 26 letters are taken', () => {
  const mods = Array.from({ length: 26 }, (_, i) => ({
    ...exit(i, 0, 0, `exit-${i}`),
    cfg: { name: `${String.fromCharCode(65 + i)}口`, inRate: 900, open: true },
  }))
  assert.equal(nextExitName(mods), '未命名口')
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
