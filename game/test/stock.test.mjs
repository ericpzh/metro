// Rolling stock classes (GAME-SPEC §6.1). The table, the door cadence and the
// worker's pose index must all agree on one classification order, so adding a
// class (the linear-motor L car) cannot desync the sim from the renderer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { scenarioStation } from './support/scenario-station.ts'
import { STOCK, STOCK_CLASSES, DOOR_END_INSET, doorCentres, trainLength, trainRatedCapacity } from '../src/sim/stock.ts'

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
