// Exit head-house orientation. A surface exit is turned by the player (R), so its
// floor, street-opening node and glass/back walls must all follow the same
// quarter-turn the renderer applies — otherwise the crowd leaves through a wall.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EXIT_BACK, EXIT_BACK_Y, EXIT_GLASS_Y0, EXIT_GLASS_Y1, EXIT_SIDE, EXIT_W } from '../src/sim/exits.ts'
import { exitDoorCell, exitFloorBounds, exitWallPlanes } from '../src/sim/exits.ts'

const exit = (rot) => ({ id: 'e', type: 'exit', x: 0, y: 0, z: 0, rot, cfg: { name: 'A口', inRate: 900, open: true } })

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
