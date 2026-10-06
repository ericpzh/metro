// Storey bands: the renderer keys every solid cell to the fixed 4 m grid line
// at or below it, so a floor and the walls it grows share a storey while a
// second floor one storey down stays its own. This is the regression guard for
// a lower floor's 4 m wall reaching the floor above and merging the two floors
// into one band (the 方块 tool's auto walls).
import test from 'node:test'
import assert from 'node:assert/strict'
import { LEVEL_STEPS, storeyBand } from '../src/sim/constants.ts'
import { nearestLevel } from '../src/build/model.ts'

test('every grid line is its own storey band', () => {
  for (const z of LEVEL_STEPS) assert.equal(storeyBand(z), z, `${z} did not band to itself`)
})

test('a floor and the walls it grows share a band', () => {
  // A floor at -4 with the 4 m auto wall above it (-3..0, minus the top course
  // that is the next floor/ceiling) stays in band -4; the next floor at -8 is
  // a storey of its own even though the wall column connects them.
  for (const z of [-4, -3, -2, -1]) assert.equal(storeyBand(z), -4, `${z} should be in the -4 storey`)
  for (const z of [-8, -7, -6, -5]) assert.equal(storeyBand(z), -8, `${z} should be in the -8 storey`)
  assert.notEqual(storeyBand(-4), storeyBand(-8), 'the two floors merged into one band')
})

test('cells between grid lines snap down to the storey below', () => {
  for (const z of [0, 1, 2, 3]) assert.equal(storeyBand(z), 0, `${z} should be in the 0 storey`)
  assert.equal(storeyBand(4), 4)
  assert.equal(storeyBand(7), 4)
  assert.equal(storeyBand(-9), -12)
})

test('nearestLevel snaps a raw z to the closest grid line', () => {
  assert.equal(nearestLevel(-7.4), -8)
  assert.equal(nearestLevel(-5.9), -4)
  assert.equal(nearestLevel(3), 4)
  assert.equal(nearestLevel(100), 12)
  assert.equal(nearestLevel(-100), -32)
})
