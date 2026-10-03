// Rolling stock classes (GAME-SPEC §6.1). The table, the door cadence and the
// worker's pose index must all agree on one classification order, so adding a
// class (the linear-motor L car) cannot desync the sim from the renderer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { referenceStation } from '../src/data/reference-station.ts'
import { STOCK, STOCK_CLASSES, doorCentres, trainLength, trainRatedCapacity } from '../src/sim/stock.ts'

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

test('the worker encodes the L stock index the renderer decodes', () => {
  const data = referenceStation({ upEscalators: 3 })
  data.lines[0].stock = 'L'
  const w = new World(data, 99)
  w.tickOnce()
  const pose = w.trainRenderState()
  assert.ok(pose.length >= 9, 'a train got a pose')
  assert.equal(pose[4], STOCK_CLASSES.indexOf('L'))
})
