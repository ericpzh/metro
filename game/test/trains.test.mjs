// Rolling stock reaches the renderer (PLAN §6, "rolling stock in 3D"). The
// pose the worker sends is a pure function of train state, so it must be
// deterministic and must line up with the platform edge the line serves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { referenceStation } from '../src/data/reference-station.ts'
import { TRAIN_DOOR_TRAVEL, TRAIN_DWELL } from '../src/sim/constants.ts'

const STRIDE = 8

test('no rolling stock before the first dispatch', () => {
  const w = new World(referenceStation(), 99)
  assert.equal(w.trainRenderState().length, 0)
})

test('a dispatched train gets a pose on the track beside its platform edge', () => {
  const w = new World(referenceStation({ upEscalators: 3 }), 99)
  w.tickOnce()
  const pose = w.trainRenderState()
  assert.equal(pose.length, STRIDE, 'one train, one pose')
  const [x, , z, cars, stock, doors, colour, dir] = pose
  // Line 2 runs B stock, six cars, on the platform edge at y = -6, z = -8.
  assert.equal(cars, 6)
  assert.equal(stock, 1)
  assert.equal(z, -7, 'the train floor sits on the track surface')
  assert.equal(dir, 1)
  assert.equal(colour, parseInt('2f7ef2', 16))
  assert.ok(Number.isFinite(x) && x < 0, `trains approach from off the platform, got x=${x}`)
  assert.equal(doors, 0, 'doors are shut while approaching')
})

test('a stop is a fixed berth / open / dwell / close / hold / depart sequence', () => {
  const w = new World(referenceStation({ upEscalators: 3 }), 99)
  const seen = []
  const doorsOpenIn = []
  for (let i = 0; i < 60; i++) {
    w.tickOnce()
    const train = w.trains[0]
    if (!train) break
    seen.push(train.state)
    if (w.trainRenderState()[5] > 0.5) doorsOpenIn.push(train.state)
  }
  // Phase order, with consecutive repeats collapsed.
  const order = seen.filter((s, i) => s !== seen[i - 1])
  assert.deepEqual(order, ['approach', 'berth', 'opening', 'dwell', 'closing', 'hold', 'depart'])
  // Doors are commanded open for exactly the opening, dwell and closing phases.
  assert.equal(
    doorsOpenIn.length,
    TRAIN_DOOR_TRAVEL + TRAIN_DWELL + TRAIN_DOOR_TRAVEL,
    `doors open for ${doorsOpenIn.length} ticks`,
  )
  assert.ok(
    doorsOpenIn.every((s) => s === 'opening' || s === 'dwell' || s === 'closing'),
    'doors open only while the train is berthed with doors cycling',
  )
})

test('the rolling-stock pose is deterministic', () => {
  const a = new World(referenceStation(), 424242)
  const b = new World(referenceStation(), 424242)
  for (let i = 0; i < 300; i++) {
    a.tickOnce()
    b.tickOnce()
  }
  assert.deepEqual([...a.trainRenderState()], [...b.trainRenderState()])
})
