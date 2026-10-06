// Wall/ceiling snap: decor is aimed at its surface, never at a floating course.
//
// A wall panel hovered on an upper wall course still anchors to the storey floor
// below (`wallMountStandCell`), and a hung fitting hovered on the ceiling slab,
// the floor, or a wall course resolves to the floor it hangs over
// (`ceilingMountStandCell`) — so the ghost and the committed piece sit on the
// surface, while the save keeps the floor anchor the envelopes read.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ceilingMountMissing,
  ceilingMountStandCell,
  equipmentReason,
  wallMountMissing,
  wallMountStandCell,
} from '../src/sim/placement.ts'
import { createModule } from '../src/build/model.ts'

const floor = (x, y, z) => ({ x, y, z, fill: 'solid' })
const wall = (x, y, z) => ({ x, y, z, fill: 'solid', tags: ['auto-wall'] })

test('a wall hover on an upper course anchors the panel to the floor below', () => {
  const cells = [floor(0, 0, 0), wall(0, -1, 0), wall(0, -1, 1), wall(0, -1, 2), wall(0, -1, 3)]
  // Base course: unchanged behaviour.
  assert.deepEqual(wallMountStandCell(cells, [0, -1, 0], [0, 0, 0]), [0, 0, 0])
  // Second course of the same wall: the panel belongs to the floor, not to z = 1.
  assert.deepEqual(wallMountStandCell(cells, [0, -1, 1], [0, 0, 1]), [0, 0, 0])
  // Third course likewise.
  assert.deepEqual(wallMountStandCell(cells, [0, -1, 2], [0, 0, 2]), [0, 0, 0])
  // A panel anchored there really hangs: backing exists at the course it needs.
  const mod = createModule('billboard-wide', 0, 0, 0, 'bb', 0)
  assert.ok(mod)
  assert.equal(wallMountMissing(cells, mod), false)
})

test('a ceiling hover resolves to the floor below, from any face', () => {
  // Top face of the floor: the cell itself.
  assert.deepEqual(ceilingMountStandCell([2, 2, 0], [2, 2, 1]), [2, 2, 0])
  // Underside of the slab overhead: one storey down.
  assert.deepEqual(ceilingMountStandCell([2, 2, 4], [2, 2, 3]), [2, 2, 0])
  // Side face of a wall course: the face-adjacent cell, on its own storey floor.
  assert.deepEqual(ceilingMountStandCell([2, 1, 1], [2, 2, 1]), [2, 2, 0])
  // Void work plane passes through untouched.
  assert.deepEqual(ceilingMountStandCell([5, 5, 0], [5, 5, 0]), [5, 5, 0])
})

test('a hung piece aimed from the ceiling slab passes the shared verdict', () => {
  const cells = [floor(2, 2, 0), floor(2, 2, 4)]
  const at = ceilingMountStandCell([2, 2, 4], [2, 2, 3])
  assert.deepEqual(at, [2, 2, 0])
  const clock = createModule('clock', at[0], at[1], at[2], 'c', 0)
  assert.ok(clock)
  assert.equal(ceilingMountMissing(cells, clock), false)
  assert.equal(equipmentReason(cells, [], clock, true), '')
  // Open sky still refuses it.
  const open = createModule('clock', 2, 2, 0, 'c2', 0)
  assert.ok(open)
  assert.equal(equipmentReason([floor(2, 2, 0)], [], open, true), 'ceiling')
})
