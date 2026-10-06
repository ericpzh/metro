// Rolling stock classes (GAME-SPEC §6.1). The table, the door cadence and the
// worker's pose index must all agree on one classification order, so adding a
// class (the linear-motor L car) cannot desync the sim from the renderer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { scenarioStation } from './support/scenario-station.ts'
import { STOCK, STOCK_CLASSES, DOOR_END_INSET, doorCentres, trainLength, trainRatedCapacity, lineCapacityPerHour, cabinSlot, CABIN_FLOOR_Z, CABIN_HALF_W, CABIN_MAX_ROWS, CABIN_MAX_TURNS, CABIN_PAIR_HALF, CABIN_ROW_PITCH } from '../src/sim/stock.ts'

test('every classified car has a matching stock row', () => {
  assert.deepEqual([...STOCK_CLASSES], ['A', 'B', 'C', 'L'])
  for (const cls of STOCK_CLASSES) {
    assert.equal(STOCK[cls].cls, cls, `${cls} row labels itself`)
    assert.ok(STOCK[cls].length > 0 && STOCK[cls].width > 0, `${cls} has real dimensions`)
  }
})

test('the L car is the linear-motor stock: short, 2.8 m, three doors a side', () => {
  const l = STOCK.L
  assert.equal(l.width, 2.8)
  assert.equal(l.length, 16.8)
  assert.equal(l.doorsPerSide, 3)
  assert.equal(l.power, 'third-rail')
  assert.equal(trainLength({ stock: 'L', cars: 6 }), 16.8 * 6)
  assert.equal(trainRatedCapacity({ stock: 'L', cars: 6 }), l.ratedPerCar * 6)
})

test('the door cadence follows the class: L has three doors per car', () => {
  const doors = doorCentres({ stock: 'L', cars: 2 })
  assert.equal(doors.length, 6)
  assert.deepEqual([...doors], [...doors].sort((a, b) => a - b), 'door centres run front to back')
  assert.equal(doors[0], -doors[doors.length - 1], 'doors are symmetric about the consist centre')
})

test('the cadence spreads the doors to the car ends, on one uniform pitch', () => {
  // A real car keeps its ends for the cab and the gangway, and pitches the doors
  // between them: they must not bunch up in the middle of the car (§1.13).
  for (const cls of STOCK_CLASSES) {
    const s = STOCK[cls]
    const fromEnd = doorCentres({ stock: cls, cars: 1 }).map((v) => v + s.length / 2)
    assert.equal(fromEnd.length, s.doorsPerSide, `${cls} door count`)
    assert.ok(Math.abs(fromEnd[0] + fromEnd[fromEnd.length - 1] - s.length) < 1e-9, `${cls} doors are centred on the car`)
    assert.ok(Math.abs(fromEnd[0] - DOOR_END_INSET) < 0.06, `${cls} holds the end door at the end inset`)
    assert.ok(fromEnd[0] - s.doorWidth / 2 < 2.4, `${cls} does not leave the end door stranded mid-car`)
    const pitch = fromEnd[1] - fromEnd[0]
    for (let d = 1; d < fromEnd.length; d++) {
      assert.ok(Math.abs(fromEnd[d] - fromEnd[d - 1] - pitch) < 0.15, `${cls} doors share one pitch (within the 0.1 m rounding)`)
    }
  }
})

test('the worker encodes the L stock index the renderer decodes', () => {
  const data = scenarioStation({ upEscalators: 3 })
  data.lines[0].stock = 'L'
  const w = new World(data, 99)
  w.tickOnce()
  const pose = w.trainRenderState()
  assert.ok(pose.length >= 9, 'a train got a pose')
  assert.equal(pose[4], STOCK_CLASSES.indexOf('L'))
})

test('the line capacity the inspector prints is cars × rated × 3600/headway', () => {
  // The 载客量 readout's other half (§6.3): a number the player sizes a line by,
  // so it is pinned rather than left to whatever the panel happens to compute.
  const line = { stock: 'B', cars: 6, headwayProfile: { peak: 150, offpeak: 240, late: 480 } }
  assert.equal(lineCapacityPerHour(line), Math.round(STOCK.B.ratedPerCar * 6 * (3600 / 150)))
  assert.equal(lineCapacityPerHour({ ...line, cars: 4 }), Math.round(STOCK.B.ratedPerCar * 4 * (3600 / 150)), 'a shorter consist carries less')
  assert.equal(lineCapacityPerHour({ ...line, headwayProfile: { ...line.headwayProfile, peak: 300 } }), Math.round(STOCK.B.ratedPerCar * 6 * (3600 / 300)), 'a longer headway carries less')
})

// ------------------------------------------------------------------ the cabin
// `cabinSlot` is the one list the sim seats riders by *and* the box the car is
// drawn around (`CABIN_FLOOR_Z` and the model's floor), so it is a contract, not
// arithmetic: a doorway passes two abreast, the rows behind them recede inboard,
// and a queue deeper than the car is wide turns along the aisle instead of
// stacking on one point or walking out through the wall (§1.13, §5.9).

test('a doorway passes two abreast, symmetric about its own centre', () => {
  const [x0, y0] = cabinSlot(10, 1, -1, 0)
  const [x1, y1] = cabinSlot(10, 1, 1, 0)
  assert.ok(Math.abs(x1 - x0 - 2 * CABIN_PAIR_HALF) < 1e-9, 'the pair is two abreast, one off each side of the door')
  assert.equal(x0 + x1, 20, 'and symmetric about the door centre')
  assert.equal(y0, y1, 'both stand on the same row')
})

test('rows recede inboard from the doorway, and never leave the car', () => {
  for (const side of [-1, 1]) {
    for (let row = 0; row < CABIN_MAX_ROWS; row++) {
      const [x, y] = cabinSlot(0, side, 1, row)
      assert.ok(Math.abs(y) <= CABIN_HALF_W, `row ${row} of side ${side} stands inside the cabin (got y=${y.toFixed(2)})`)
      assert.ok(Math.abs(x) <= CABIN_PAIR_HALF + CABIN_MAX_TURNS * 0.75 + 1e-9, `row ${row} stays in its own doorway's column (got x=${x.toFixed(2)})`)
      // The first two rows are still on the doorway's own side of the car; the
      // third has crossed the centreline, which is what "receding inboard" means
      // when a 2.3 m cabin is only ~1.8 m from skin to skin.
      if (row < 2) assert.equal(Math.sign(y), side, `row ${row} of side ${side} starts on its own side of the car`)
    }
    // The first rows walk away from the doorway's skin rather than toward it.
    const near = Math.abs(cabinSlot(0, side, 1, 0)[1])
    const next = Math.abs(cabinSlot(0, side, 1, 1)[1])
    assert.ok(next < near, `row 1 of side ${side} stands further in than row 0`)
  }
})

test('a queue deeper than the car is wide turns and steps along the aisle', () => {
  // The turn happens where a row would cross to the far wall; each turn also
  // steps along the car, so a deep wave snakes down the aisle rather than
  // standing the whole queue on the centreline.
  const span = (CABIN_HALF_W - 0.25) * 2
  const turnRow = Math.round(span / CABIN_ROW_PITCH) + 1
  const before = cabinSlot(0, 1, 1, turnRow - 1)
  const after = cabinSlot(0, 1, 1, turnRow)
  assert.ok(after[0] > before[0], `the queue steps along the car at the turn (${before[0].toFixed(2)} -> ${after[0].toFixed(2)})`)
  assert.ok(after[1] < 0, 'and has crossed to the far half of the car')
  // Past the last turn the step is clamped: a crush stacks in the aisle rather
  // than walking the queue out through a car end.
  const far = cabinSlot(0, 1, 1, CABIN_MAX_ROWS - 1)
  assert.ok(Math.abs(far[0]) <= CABIN_PAIR_HALF + CABIN_MAX_TURNS * 0.75 + 1e-9, 'the last row is still inside its own car bay')
})

test('the cabin floor sits a hand above the platform, under the door sill to head band', () => {
  // The consist rides half a metre below the platform (`World.computeLineAnchors`),
  // so this is the step up a real car has — and it has to stay under the doorway,
  // or the sim would seat riders at a height the model does not draw.
  assert.ok(CABIN_FLOOR_Z > 0.5 && CABIN_FLOOR_Z < 0.7, `cabin floor ${CABIN_FLOOR_Z} is a step over the platform`)
  assert.ok(CABIN_FLOOR_Z >= 0.57, 'the floor is not below the door sill the skin is cut at')
})
