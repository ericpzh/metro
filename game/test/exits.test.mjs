// Exit head-house orientation. A surface exit is turned by the player (R), so its
// floor, street-opening node and glass/back walls must all follow the same
// quarter-turn the renderer applies — otherwise the crowd leaves through a wall.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EXIT_BACK, EXIT_BACK_Y, EXIT_GLASS_Y0, EXIT_GLASS_Y1, EXIT_SIDE, EXIT_W } from '../src/sim/exits.ts'
import { exitBayCell, exitBayOffsets, exitBays, exitDoorCell, exitFloorBounds, exitRunSnap, exitSide, exitWallPlanes, exitWidth } from '../src/sim/exits.ts'

const exit = (rot) => ({ id: 'e', type: 'exit', x: 0, y: 0, z: 0, rot, cfg: { name: 'A口', inRate: 900, open: true } })
const variant = (rot, cfg) => ({ id: 'e', type: 'exit', x: 0, y: 0, z: 0, rot, cfg: { name: 'A口', inRate: 900, open: true, ...cfg } })

// The head-house rectangle spans local x ∈ [−W/2, W/2], y ∈ [BACK_Y, BACK].
// rot 0: x = 0.5 ± 1.9, y = 0.5 + [−5.5, 2.3].
const CLOSE = 1e-9
const near = (a, b) => assert.ok(Math.abs(a - b) < CLOSE, `${a} != ${b}`)

test('an unrotated exit keeps the reference footprint', () => {
  const b = exitFloorBounds(exit(0))
  near(b.x0, 0.5 - EXIT_W / 2)
  near(b.x1, 0.5 + EXIT_W / 2)
  near(b.y0, 0.5 + EXIT_BACK_Y)
  near(b.y1, 0.5 + EXIT_BACK)
})

test('the floor turns with the placement rotation', () => {
  const rot = (r) => exitFloorBounds(exit(r))
  // rot 1: local −y (the mouth) maps to +x, so the long reach extends east.
  const r1 = rot(1)
  near(r1.x0, 0.5 - EXIT_BACK)
  near(r1.x1, 0.5 - EXIT_BACK_Y)
  near(r1.y0, 0.5 - EXIT_W / 2)
  near(r1.y1, 0.5 + EXIT_W / 2)
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
  assert.deepEqual(exitDoorCell(exit(0)), [0, 2, 0])
  assert.deepEqual(exitDoorCell(exit(1)), [-2, 0, 0])
  assert.deepEqual(exitDoorCell(exit(2)), [0, -2, 0])
  assert.deepEqual(exitDoorCell(exit(3)), [2, 0, 0])
})

test('the solid planes turn with the exit', () => {
  const walls = (r) => exitWallPlanes(exit(r))
  // rot 0: two glass sides along y at x = ±EXIT_SIDE, one back wall along x.
  const w0 = walls(0)
  assert.equal(w0.length, 3)
  assert.ok(w0.every((w) => w.axis === 'x' || w.axis === 'y'))
  const sides0 = w0.filter((w) => w.axis === 'x')
  assert.equal(sides0.length, 2)
  near(Math.min(...sides0.map((w) => w.at)), 0.5 - EXIT_SIDE)
  near(Math.max(...sides0.map((w) => w.at)), 0.5 + EXIT_SIDE)
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

test('the bay count scales the width and the run offsets', () => {
  assert.equal(exitBays(variant(0, {})), 2, 'a bare exit is the reference two-bay piece')
  assert.equal(exitBays(variant(0, { bays: 1 })), 1)
  assert.equal(exitBays(variant(0, { bays: 3 })), 3)
  assert.deepEqual(exitBayOffsets(1), [0])
  assert.deepEqual(exitBayOffsets(2), [-1, 1])
  assert.deepEqual(exitBayOffsets(3), [-2, 0, 2])
  near(exitWidth(1), 3.0)
  near(exitWidth(2), EXIT_W)
  near(exitWidth(3), 5.8)
})

test('the floor and side planes widen with the bay count', () => {
  const one = exitFloorBounds(variant(0, { bays: 1 }))
  near(one.x0, 0.5 - exitWidth(1) / 2)
  near(one.x1, 0.5 + exitWidth(1) / 2)
  const three = exitFloorBounds(variant(0, { bays: 3 }))
  near(three.x0, 0.5 - 2.9)
  near(three.x1, 0.5 + 2.9)
  const sides = exitWallPlanes(variant(0, { bays: 3 })).filter((w) => w.axis === 'x')
  assert.equal(sides.length, 2)
  near(Math.min(...sides.map((w) => w.at)), 0.5 - exitSide(3))
  near(Math.max(...sides.map((w) => w.at)), 0.5 + exitSide(3))
})

test('an uncovered exit keeps its barrier planes, only the look differs', () => {
  // 无盖 draws railings where the walls were, so the sim must see the same
  // side/back planes as the covered piece: the crowd still cannot cross them.
  const covered = exitWallPlanes(variant(0, { covered: true, bays: 2 }))
  const open = exitWallPlanes(variant(0, { covered: false, bays: 2 }))
  assert.deepEqual(open, covered)
  assert.equal(exitWidth(exitBays(variant(0, { covered: false, bays: 3 }))), 5.8)
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
  // The other bay is symmetric.
  const west = exitRunSnap(mods, -1, 0, 0)
  assert.ok(west)
  assert.equal(west.bay, -1)
  assert.deepEqual(west.base, { x: -1, y: -6, z: -4 })
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

test('a three-bay exit snaps to the nearest of its three bays', () => {
  const mods = [variant(0, { bays: 3 })]
  const east = exitRunSnap(mods, 2, 0, 0)
  assert.ok(east)
  assert.equal(east.bay, 2)
  assert.deepEqual(east.base, { x: 2, y: -6, z: -4 })
  const mid = exitRunSnap(mods, 0, 0, 0)
  assert.ok(mid)
  assert.equal(mid.bay, 0)
})

test('a pointer off the exit, or on another level, does not snap', () => {
  const mods = [exit(0)]
  assert.equal(exitRunSnap(mods, 10, 10, 0), null)
  assert.equal(exitRunSnap(mods, 0, 0, -4), null, 'the exit floor is only at its own level')
})
