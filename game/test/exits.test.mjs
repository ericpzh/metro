// Exit head-house orientation. A surface exit is turned by the player (R), so its
// floor, street-opening node and glass/back walls must all follow the same
// quarter-turn the renderer applies — otherwise the crowd leaves through a wall.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EXIT_BACK, EXIT_BACK_Y, EXIT_GLASS_Y0, EXIT_GLASS_Y1, EXIT_SIDE, EXIT_W } from '../src/sim/exits.ts'
import { exitBayCell, exitBayOffsets, exitBays, exitCentre, exitDoorCell, exitFloorBounds, exitRunHalf, exitRunOpenings, exitRunSnap, exitSide, exitSpan, exitWallPlanes, exitWidth } from '../src/sim/exits.ts'
import { STAIR_WIDTH_DOUBLE } from '../src/sim/stairs.ts'
import { createModule } from '../src/build/model.ts'

const exit = (rot) => ({ id: 'e', type: 'exit', x: 0, y: 0, z: 0, rot, cfg: { name: 'A口', inRate: 900, open: true } })
const variant = (rot, cfg) => ({ id: 'e', type: 'exit', x: 0, y: 0, z: 0, rot, cfg: { name: 'A口', inRate: 900, open: true, ...cfg } })

/** An up run whose upper landing is `(x, 0, 0)`: the base sits one storey down the mouth. */
const run = (id, x, z = -4) => {
  const m = createModule('escalator', x, -6, z, id, 0, undefined, 'up')
  if (!m) throw new Error('no escalator')
  return m
}

// A 双向 head-house is built around its two run columns (0 and 1): its centre
// sits on local x = 0.5, so its floor runs from local −1.5 to +2.5 — world
// x = −1 to 3 for an unrotated exit at the origin.
const CLOSE = 1e-9
const near = (a, b) => assert.ok(Math.abs(a - b) < CLOSE, `${a} != ${b}`)

test('an unrotated two-way exit is four blocks wide with a block each side', () => {
  const b = exitFloorBounds(exit(0))
  const { centre, half } = exitSpan(exit(0))
  near(centre, 0.5)
  near(half, 2)
  near(b.x0, -1.0)
  near(b.x1, 3.0)
  near(b.y0, 0.5 + EXIT_BACK_Y)
  near(b.y1, 0.5 + EXIT_BACK)
})

test('the floor turns with the placement rotation', () => {
  const rot = (r) => exitFloorBounds(exit(r))
  // rot 1: local −y (the mouth) maps to +x, so the long reach extends east, and
  // the four-block width is the y extent.
  const r1 = rot(1)
  near(r1.x0, 0.5 - EXIT_BACK)
  near(r1.x1, 0.5 - EXIT_BACK_Y)
  near(r1.y0, -1.0)
  near(r1.y1, 3.0)
  // rot 2: the mouth points +y.
  const r2 = rot(2)
  near(r2.y0, 0.5 - EXIT_BACK)
  near(r2.y1, 0.5 - EXIT_BACK_Y)
  // rot 3: the mouth points −x.
  const r3 = rot(3)
  near(r3.x0, 0.5 + EXIT_BACK_Y)
  near(r3.x1, 0.5 + EXIT_BACK)
})

test('the street opening turns with the exit and stays on its floor', () => {
  const centre = (c) => [c[0] + 0.5, c[1] + 0.5]
  for (let r = 0; r < 4; r++) {
    const m = exit(r)
    const [dx, dy] = centre(exitDoorCell(m))
    const b = exitFloorBounds(m)
    assert.ok(dx > b.x0 && dx < b.x1, `rot ${r}: door x off the floor`)
    assert.ok(dy > b.y0 && dy < b.y1, `rot ${r}: door y off the floor`)
  }
  // The doorway sits on the head-house's centre line: the middle cell of an even
  // four-block plan is column 1.
  assert.deepEqual(exitDoorCell(exit(0)), [1, 2, 0])
  assert.deepEqual(exitDoorCell(exit(1)), [-2, 1, 0])
  assert.deepEqual(exitDoorCell(exit(2)), [-1, -2, 0])
  assert.deepEqual(exitDoorCell(exit(3)), [2, -1, 0])
})

test('the solid planes turn with the exit', () => {
  const walls = (r) => exitWallPlanes(exit(r))
  // rot 0: two glass sides along y just inside the plan's edges (world x −0.94
  // and 2.94), one back wall along x.
  const w0 = walls(0)
  assert.equal(w0.length, 3)
  assert.ok(w0.every((w) => w.axis === 'x' || w.axis === 'y'))
  const sides0 = w0.filter((w) => w.axis === 'x')
  assert.equal(sides0.length, 2)
  near(Math.min(...sides0.map((w) => w.at)), -1.0 + 0.06)
  near(Math.max(...sides0.map((w) => w.at)), 3.0 - 0.06)
  for (const w of sides0) {
    near(w.min, 0.5 + EXIT_GLASS_Y0)
    near(w.max, 0.5 + EXIT_GLASS_Y1)
  }
  const back0 = w0.find((w) => w.axis === 'y')
  near(back0.at, 0.5 + EXIT_BACK_Y)

  // rot 1: the planes swap axes — glass runs along x, the back wall along y.
  const w1 = walls(1)
  const sides1 = w1.filter((w) => w.axis === 'y')
  assert.equal(sides1.length, 2)
  const back1 = w1.find((w) => w.axis === 'x')
  near(back1.at, 0.5 - EXIT_BACK_Y)
})

test('the bay count scales the width, side by side: 3 / 4 / 5 / 6 blocks', () => {
  assert.equal(exitBays(variant(0, {})), 2, 'a bare exit is the reference two-bay piece')
  assert.equal(exitBays(variant(0, { bays: 1 })), 1)
  assert.equal(exitBays(variant(0, { bays: 3 })), 3)
  assert.equal(exitBays(variant(0, { bays: 4 })), 4)
  // The runs stand side by side in adjacent columns.
  assert.deepEqual(exitBayOffsets(1), [0])
  assert.deepEqual(exitBayOffsets(2), [0, 1])
  assert.deepEqual(exitBayOffsets(3), [0, 1, 2])
  assert.deepEqual(exitBayOffsets(4), [0, 1, 2, 3])
  assert.equal(exitCentre(1), 0)
  assert.equal(exitCentre(2), 0.5)
  assert.equal(exitCentre(3), 1)
  assert.equal(exitCentre(4), 1.5)
  near(exitWidth(1), 3)
  near(exitWidth(2), EXIT_W)
  near(exitWidth(3), 5)
  assert.ok(Math.abs(exitWidth(4) - exitWidth(3) - 1) < CLOSE, 'the four-way ground exit is 1 m wider than the three-way')
  near(EXIT_W, 4)
})

test('the floor and side planes widen with the bay count', () => {
  const one = exitFloorBounds(variant(0, { bays: 1 }))
  near(one.x0, -1.0)
  near(one.x1, 2.0)
  const three = exitFloorBounds(variant(0, { bays: 3 }))
  near(three.x0, -1.0)
  near(three.x1, 4.0)
  const sides = exitWallPlanes(variant(0, { bays: 3 })).filter((w) => w.axis === 'x')
  assert.equal(sides.length, 2)
  near(Math.min(...sides.map((w) => w.at)), -1.0 + 0.06)
  near(Math.max(...sides.map((w) => w.at)), 4.0 - 0.06)
  near(exitSide(3), 2.44)
  near(exitSide(4), 2.94)
})

test('a head-house keeps its fixed width regardless of placed runs', () => {
  // The house is 3 / 4 / 5 blocks for 1 / 2 / 3 bays — runs never widen it.
  const m = exit(0)
  assert.deepEqual(exitSpan(m), { centre: 0.5, half: 2 })
  assert.deepEqual(exitSpan(variant(0, { bays: 1 })), { centre: 0, half: 1.5 })
  assert.deepEqual(exitSpan(variant(0, { bays: 3 })), { centre: 1, half: 2.5 })
  // and its walls follow that plan.
  const sides = exitWallPlanes(m).filter((w) => w.axis === 'x')
  near(Math.min(...sides.map((w) => w.at)), -1.0 + 0.06)
  near(Math.max(...sides.map((w) => w.at)), 3.0 - 0.06)
})

test('an uncovered exit keeps its barrier planes, only the look differs', () => {
  // 无盖 draws railings where the walls were, so the sim must see the same
  // side/back planes as the covered piece: the crowd still cannot cross them.
  const covered = exitWallPlanes(variant(0, { covered: true, bays: 2 }))
  const open = exitWallPlanes(variant(0, { covered: false, bays: 2 }))
  assert.deepEqual(open, covered)
  assert.equal(exitWidth(exitBays(variant(0, { covered: false, bays: 3 }))), 5)
})

test('a bay cell turns with the exit, so the floor pad finds its run', () => {
  // The renderer opens the pad only where a run lands; that cell must follow
  // the placement rotation exactly as the drawn head-house does.
  assert.deepEqual(exitBayCell(exit(0), 0), [0, 0, 0])
  assert.deepEqual(exitBayCell(exit(0), -1), [-1, 0, 0])
  assert.deepEqual(exitBayCell(exit(0), 1), [1, 0, 0])
  assert.deepEqual(exitBayCell(exit(1), 1), [0, 1, 0])
  assert.deepEqual(exitBayCell(exit(2), 1), [-1, 0, 0])
  assert.deepEqual(exitBayCell(exit(3), 1), [0, -1, 0])
})

test('a ramp snapped into an exit lands on the bay and descends to the floor below', () => {
  const mods = [exit(0)]
  // Hovering a bay snaps the run's upper landing to it and drops its base a
  // storey below, back toward the mouth (−y for an unrotated exit).
  const one = exitRunSnap(mods, 1, 0, 0)
  assert.ok(one)
  assert.equal(one.bay, 1)
  assert.deepEqual(one.top, { x: 1, y: 0, z: 0 })
  assert.deepEqual(one.base, { x: 1, y: -6, z: -4 })
  assert.equal(one.rot, 0, 'the run climbs base → top toward +y')
  // The first bay, and a pointer west of the group clamping into it: the runs are
  // side by side, so there is no bay on the far side of the house.
  const first = exitRunSnap(mods, 0, 0, 0)
  assert.ok(first)
  assert.equal(first.bay, 0)
  assert.deepEqual(first.base, { x: 0, y: -6, z: -4 })
  const west = exitRunSnap(mods, -1, 0, 0)
  assert.ok(west)
  assert.equal(west.bay, 0)
  assert.deepEqual(west.top, { x: 0, y: 0, z: 0 })
})

test('the snapped run follows the head-house rotation', () => {
  // rot 1 turns the mouth to +x, so the run descends toward +x and its base is
  // east of the bay; the placement rotation must match that climb direction.
  const snap = exitRunSnap([exit(1)], 0, 1, 0)
  assert.ok(snap)
  assert.deepEqual(snap.top, { x: 0, y: 1, z: 0 })
  assert.deepEqual(snap.base, { x: 6, y: 1, z: -4 })
  assert.equal(snap.rot, 3)
})

test('a three-bay exit snaps into its three side-by-side bays', () => {
  const mods = [variant(0, { bays: 3 })]
  const east = exitRunSnap(mods, 2, 0, 0)
  assert.ok(east)
  assert.equal(east.bay, 2)
  assert.deepEqual(east.base, { x: 2, y: -6, z: -4 })
  const mid = exitRunSnap(mods, 1, 0, 0)
  assert.ok(mid)
  assert.equal(mid.bay, 1)
  assert.deepEqual(mid.base, { x: 1, y: -6, z: -4 })
  // Past the far end of the group the pointer clamps back into it.
  const clamped = exitRunSnap(mods, 3, 0, 0)
  assert.ok(clamped)
  assert.equal(clamped.bay, 2)
  // A 单向 holds one column only.
  assert.equal(exitRunSnap([variant(0, { bays: 1 })], 1, 0, 0).bay, 0)
})

test('a head-house opens a wellway per run, one block wide', () => {
  const m = exit(0)
  assert.deepEqual(exitRunOpenings([m], m), [], 'a bare head-house opens nothing')
  // A pair side by side: one block each, so the pad keeps a full block beside it.
  assert.deepEqual(exitRunOpenings([m, run('w', 0), run('e', 1)], m), [
    { column: 0, half: 0.5 },
    { column: 1, half: 0.5 },
  ])
  // A run wider than a block opens wider, so its rails never surface through the
  // floor beside it. (A turning stair is one such piece; a straight wide stair is
  // laid as one-block lanes and never needs it.)
  const wide = createModule('stair-straight', 0, -6, -4, 'wide', 0, STAIR_WIDTH_DOUBLE)
  assert.ok(wide)
  assert.ok(Math.abs(exitRunHalf(wide) - (STAIR_WIDTH_DOUBLE / 2 + 0.105)) < 1e-9)
  assert.equal(exitRunOpenings([m, wide], m)[0].half > 0.5, true)
  // A run that lands off the head-house, or stands on another level, does not
  // open anything: the pad follows the run that really descends through it.
  assert.deepEqual(exitRunOpenings([m, run('away', 8)], m), [])
  assert.deepEqual(exitRunOpenings([m, run('up', 0, 0)], m), [])
})

test('a pointer off the exit, or on another level, does not snap', () => {
  const mods = [exit(0)]
  assert.equal(exitRunSnap(mods, 10, 10, 0), null)
  assert.equal(exitRunSnap(mods, 0, 0, -4), null, 'the exit floor is only at its own level')
})
