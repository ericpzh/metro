// Equipment collision and bulldozing (GAME-SPEC §5). Every module has a real
// footprint; two may not share space, but a gate line of modules in adjacent
// cells is legal, and a module four metres up on the next storey does not
// collide with the one below.
import test from 'node:test'
import assert from 'node:assert/strict'
import { autofaceWallMount, boxesOverlap, isCeilingHung, isTrackBed, moduleAt, moduleBlockedCells, moduleEnvelope, placementBlocked, placementOnTrack, reservedOpening, wallMountMissing, wallMountStandCell, wallSide } from '../src/sim/placement.ts'
import { addCells, addEquipment, addFloor, createModule, GROUND_Z, nextExitName, nextModuleId, randomAdSlug, removeModule, toData, toState } from '../src/build/model.ts'
import { billboardSpec, postersFor } from '../src/sim/billboards.ts'
import { referenceStation } from '../src/data/reference-station.ts'

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

test('a stair reserves its treads, so a fence may guard the head of the run', () => {
  // The body is the slope the flight sweeps, cut tile by tile: the model trims the
  // treads half a landing cell short of each landing (`stairTreadTrim`), so both
  // landing tiles are plain floor — a 围栏 stands on the block at the head (or the
  // foot) of a run, and one beside the run joins its handrail there (`railLandingAt`
  // in the renderer). Under the low treads there is no room; higher up the flight
  // has climbed away and the floor beneath it is free again.
  const stair = createModule('stair-straight', 0, 0, -4, 's', 0)
  assert.ok(stair)
  assert.equal(placementBlocked([stair], createModule('fence', 0, 6, 0, 'f', 0)), false, 'on the top landing')
  assert.equal(placementBlocked([stair], createModule('fence', 0, 0, -4, 'f', 0)), false, 'on the lower landing')
  assert.equal(placementBlocked([stair], createModule('fence', 1, 6, 0, 'f', 0)), false, 'beside the top landing')
  assert.equal(placementBlocked([stair], createModule('fence', -1, 4, -4, 'f', 0)), false, 'mid-run, beside the body')
  assert.equal(placementBlocked([stair], createModule('fence', 0, 1, -4, 'f', 0)), true, 'under the first treads')
  assert.equal(placementBlocked([stair], createModule('fence', 0, 2, -4, 'f', 0)), true, 'under the treads a storey up')
  assert.equal(placementBlocked([stair], createModule('fence', 0, 5, -4, 'f', 0)), false, 'the floor the flight has climbed away from')
  // The rule is symmetric — the same question whichever piece came first — while
  // two runs still meet on the reservation, so a landing is never shared.
  assert.equal(placementBlocked([createModule('fence', 0, 6, 0, 'f', 0)], stair), false, 'a stair onto a fence already there')
  assert.equal(placementBlocked([stair], createModule('stair-straight', 0, 0, -4, 's2', 0)), true, 'two runs share no landing')
  assert.equal(placementBlocked([stair], createModule('stair-straight', 1, 0, -4, 's3', 0)), false, 'a run beside it is flush')
  // A legacy 1.6 m stair's body is wider than its cell, so where the flight is low
  // it still claims the next one — but its landing tiles stay floor like any
  // other stair's, and higher up the cut body leaves the neighbour alone too.
  const wide = createModule('stair-straight', 0, 0, -4, 'w', 0, 1.6)
  assert.ok(wide)
  assert.equal(placementBlocked([wide], createModule('fence', 1, 2, -4, 'f', 0)), true, 'a wide body beside the low treads')
  assert.equal(placementBlocked([wide], createModule('fence', 1, 4, -4, 'f', 0)), false, 'and clear of it once it has climbed')
  assert.equal(placementBlocked([wide], createModule('fence', 0, 6, 0, 'f', 0)), false, 'the wide stair’s landing')
})

test('a turning stair frees the corner tiles its flights never cross', () => {
  // The reservation is the AABB of the whole turn, so it covers the inside of the
  // L as well; the body is flight by flight, so only the tiles the treads sweep are
  // closed — the inside of the corner and the half-landing stay floor.
  const turn = createModule('stair-right90', 0, 0, -4, 't', 0)
  assert.ok(turn)
  assert.equal(placementBlocked([turn], createModule('fence', 0, 1, -4, 'f', 0)), true, 'under the first flight')
  assert.equal(placementBlocked([turn], createModule('fence', 1, 3, -2, 'f', 0)), true, 'under the second flight')
  assert.equal(placementBlocked([turn], createModule('fence', 1, 1, -4, 'f', 0)), false, 'the inside of the turn is floor')
  assert.equal(placementBlocked([turn], createModule('fence', 0, 3, -2, 'f', 0)), false, 'the half-landing takes one')
  // A switchback's landings are the cell it turns on and the row between its two
  // flights: both are platform, so both take a panel, while each flight's own
  // tiles stay closed. A narrow one climbs (0,0,−4) → (0,3,−2) → (1,3,−2) →
  // (1,0,0) — its runs stand flush, so the landing row is two cells.
  const back = createModule('stair-right180', 0, 0, -4, 'b', 0)
  assert.ok(back)
  assert.equal(placementBlocked([back], createModule('fence', 0, 1, -4, 'f', 0)), true, 'under the first flight')
  assert.equal(placementBlocked([back], createModule('fence', 1, 1, -2, 'f', 0)), true, 'under the returning flight')
  assert.equal(placementBlocked([back], createModule('fence', 1, 3, -2, 'f', 0)), false, 'the cell it turns on')
  assert.equal(placementBlocked([back], createModule('fence', 0, 3, -2, 'f', 0)), false, 'the half-landing row')
  assert.equal(placementBlocked([back], createModule('fence', 2, 1, -2, 'f', 0)), false, 'beside the returning flight')
  assert.equal(placementBlocked([back], createModule('fence', 2, 3, -2, 'f', 0)), false, 'past the turn landing')
})

test('an escalator keeps its landing tiles: the step band runs to the centre', () => {
  // Unlike a stair, an escalator's truss, band and balustrades are built from
  // landing centre to landing centre, so its landing tiles are its own.
  const esc = createModule('escalator', 0, 0, -4, 'e', 0)
  assert.ok(esc)
  assert.equal(placementBlocked([esc], createModule('fence', 0, 0, -4, 'f', 0)), true, 'on the lower landing')
  assert.equal(placementBlocked([esc], createModule('fence', 0, 6, 0, 'f', 0)), true, 'on the upper landing')
  assert.equal(placementBlocked([esc], createModule('fence', 1, 6, 0, 'f', 0)), false, 'beside the upper landing')
})

test('the demo station’s platform stairs take a fence over the run and on the −12 landing', () => {
  // The shipped 动物园 station climbs from the z = −16 track up to z = −12 on two
  // straight stairs, each already guarded by a 围栏 run one row in front
  // (`fence-220` in front of `stair-straight-221`, `fence-219` — with `fence-218`
  // beside it — in front of `stair-straight-211`). With the body cut to the slope per tile, three
  // kinds of cell take a panel: the block at the head of a run, the block at its
  // foot, and the slab the flight climbs *underneath* — its lower half passes below
  // the −12 floor, so that floor keeps its headroom and a 围栏 stands on it. The
  // tiles the low treads run just above stay closed, as do the shipped guard run's
  // own cells.
  const st = referenceStation()
  const solid = new Set(st.cells.filter((c) => c.fill === 'solid').map((c) => `${c.x},${c.y},${c.z}`))
  const at = (p) => `${p.x},${p.y},${p.z}`
  const panel = (x, y, z) => createModule('fence', x, y, z, 'guard', 0)
  const stairs = st.modules.filter(
    (m) => m.type === 'stair' && Math.min(m.from.z, m.to.z) === -16 && Math.max(m.from.z, m.to.z) === -12,
  )
  assert.equal(stairs.length, 2, 'the demo has two stairs up from the platform at z = −16')
  // A slab takes the panel only while *nothing* stands in the cell — the demo's own
  // guard runs (fence-315 over the low treads of stair-straight-221, fence-316 over
  // stair-straight-211) and just as much the props the author hangs from the same
  // slab (the 监控 at 100,3,−12). Any module owns its cell (§5), so the refusal is
  // "this cell is taken", never "this cell is fenced". The two stairs between them
  // exercise both answers — 211 keeps a free slab over its run, 221 has both of its
  // own taken — so the halves are counted over the pair rather than asked of every
  // stair, and a save that closes the last free slab (or frees every taken one)
  // reports which branch went missing.
  let freeSlabs = 0
  let takenSlabs = 0
  let accepted = 0
  let refused = 0
  for (const s of stairs) {
    const top = s.to.z === -12 ? s.to : s.from
    const bottom = s.to.z === -12 ? s.from : s.to
    for (const [where, p] of [['top', top], ['bottom', bottom]]) {
      assert.ok(solid.has(at(p)), `${s.id}: the ${where} landing ${at(p)} has no floor`)
      assert.equal(placementBlocked(st.modules, panel(p.x, p.y, p.z)), false, `${s.id}: the ${where} landing ${at(p)} refuses a fence`)
      assert.equal(placementOnTrack(st.cells, panel(p.x, p.y, p.z), st.modules), false, `${s.id}: the ${where} landing is not a track bed`)
    }
    // The five tiles between the landings are the flight, walked from the bottom.
    const dx = Math.sign(top.x - bottom.x)
    const dy = Math.sign(top.y - bottom.y)
    const tiles = []
    for (let i = 1; i <= 5; i++) tiles.push({ x: bottom.x + dx * i, y: bottom.y + dy * i })
    // Under the low treads (the first tile, at the lower storey) there is no room.
    assert.ok(solid.has(`${tiles[0].x},${tiles[0].y},${bottom.z}`), `${s.id}: the first tile has no floor at z = −16`)
    assert.equal(placementBlocked(st.modules, panel(tiles[0].x, tiles[0].y, bottom.z)), true, `${s.id}: the treads over ${at({ ...tiles[0], z: bottom.z })}`)
    // The top storey: the well is open where the flight surfaces, and the tiles it
    // merely passes under are floor — a free one takes the panel, a taken one refuses
    // it. A **floor-standing** piece is what takes a cell from a 围栏; a 装饰 hung
    // from the slab overhead — the 监控 the author hangs over this very run — is up
    // under the ceiling, so the panel stands on the slab beneath it.
    const overRun = tiles.filter(({ x, y }) => solid.has(`${x},${y},${top.z}`))
    assert.ok(tiles.some(({ x, y }) => !solid.has(`${x},${y},${top.z}`)), `${s.id}: the well is open at z = −12`)
    assert.ok(overRun.length > 0, `${s.id}: no floor at z = −12 over the run at all`)
    for (const { x, y } of overRun) {
      const taken = st.modules.some((m) => m.x === x && m.y === y && m.z === top.z && !isCeilingHung(m))
      const blocked = placementBlocked(st.modules, panel(x, y, top.z))
      if (taken) takenSlabs++
      else freeSlabs++
      if (blocked) refused++
      else accepted++
      assert.equal(blocked, taken, `${s.id}: the −12 slab over the run at ${x},${y},−12`)
    }
    // The guard run the demo ships sits one row in front of the stair: that row is
    // where the well's railing is extended, and its own cells are taken already.
    const guard = st.modules.find((m) => m.type === 'fence' && m.z === top.z && m.y === top.y - 1 && m.x === top.x)
    assert.ok(guard, `${s.id}: no guard panel is shipped beside the head of the run`)
    assert.equal(placementBlocked(st.modules, panel(guard.x, guard.y, guard.z)), true, 'a second panel does not stack on the guard')
  }
  assert.ok(freeSlabs > 0, 'every slab over the two runs is taken, so taking the panel is untested')
  assert.ok(takenSlabs > 0, 'the demo takes no slab over either run, so the refusal is untested')
  assert.ok(accepted > 0, 'no free slab over the runs took the panel')
  assert.ok(refused > 0, 'no taken slab over the runs refused the panel')
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

/* ------------------------------------------- a block through a placed piece */

test('a block may not be built through a piece of equipment', () => {
  // `placementBlocked` only ever compares two *modules*, so the block brush needs
  // the same question asked of it — otherwise a 闸机, a 座椅 or a 房间 can be buried
  // in a block laid on top of it. One cell per candidate, so the refusal is the
  // piece's own cell and not an over-wide envelope.
  const room = { id: 'r1', type: 'shop', x: 0, y: 0, z: 0, w: 2, h: 2, rot: 0, cfg: { kind: 'store', door: [] } }
  const modules = [gate(4, 0, 0, 'g1'), tvm(5, 0, 0, 't1'), createModule('bench', 6, 0, 0, 'b1', 0), room]
  for (const [x, y] of [[4, 0], [5, 0], [6, 0], [0, 0], [1, 0], [0, 1], [1, 1]]) {
    const { cells, changed, blocked } = addCells([], [[x, y, 1]], modules)
    assert.equal(changed, 0, `a block was built in the cell of a piece at ${x},${y}`)
    assert.equal(blocked, 1)
    assert.deepEqual(cells, [])
  }
  // The cells beside every one of them are free ground.
  for (const [x, y] of [[4, 1], [7, 0], [2, 0], [0, 2]]) {
    const { changed } = addCells([], [[x, y, 1]], modules)
    assert.equal(changed, 1, `${x},${y} should be free`)
  }
  // A **run** is not in this set: its landings are floor the crowd stands on and the
  // cell under its slope is the filling §5.1 says the brush is *for*, so it claims no
  // block column at all. Its corridor is `reservedOpening`'s answer, asked of the
  // carve — the rule that really draws the opening.
  const esc = createModule('escalator', 4, 0, 0, 'e1', 0)
  assert.equal(moduleBlockedCells([esc], 0).size, 0, 'a run claims no block column')
  assert.equal(moduleBlockedCells([esc], 1).size, 0, 'nor the ground under its slope')
  assert.equal(addCells([], [[4, 0, 0]], [esc]).changed, 1, 'the ground under a run is floor')
  // The corridor itself is still refused, by the carve rather than by silence.
  const corridor = addCells([], [[4, 3, 3]], [esc])
  assert.equal(corridor.changed, 0, 'the carved corridor took a block')
  assert.equal(corridor.blocked, 1, 'and reported it as a reserved opening')
  // A hung 指示牌 hangs in its own column over the cell it was dropped on, and that
  // cell is reserved for it — the sign's rods really are in the way of a slab there.
  const hung = createModule('sign', 9, 0, 0, 's1', 0)
  assert.equal(moduleBlockedCells([hung], 1).has('9,0,1'), true, 'the sign wants the column it hangs in')
  assert.equal(addCells([], [[9, 0, 1]], [hung]).blocked, 1, 'a block in the sign’s own column is refused')
  assert.equal(addCells([], [[9, 0, 0]], [hung]).blocked, 1, 'and the cell its rods pass through')
})

test('a floor patch carries on around a piece instead of burying it', () => {
  // The 闸机 stands in the cell the drag covers, and the patch leaves it alone while
  // laying floor all round it — the same rule the brush answers to.
  const modules = [gate(1, 1, 0, 'g1')]
  const cells = []
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) cells.push([x, y, 0])
  const st = addFloor(toState({ name: 't', seed: 1, cells: [], modules, lines: [] }), cells)
  assert.equal(st.cells.some((c) => c.x === 1 && c.y === 1 && c.z === 0), false, 'the drag poured a block into the 闸机')
  for (const [x, y] of [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]) {
    assert.ok(st.cells.some((c) => c.x === x && c.y === y && c.z === 0), `the patch skipped ${x},${y}`)
  }
  // The wall ring the patch raises may not board up the piece either.
  for (const c of st.cells) {
    if (c.z === 0) continue
    assert.equal(c.x === 1 && c.y === 1, false, 'the ring rose through the 闸机')
  }
})
