// One five-metre grid owns editing, wall bands and renderer storeys.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LEVEL_STEPS, levelSteps, storeyBand, STOREY_HEIGHT } from '../src/sim/constants.ts'
import { nearestLevel } from '../src/build/model.ts'

test('every grid line is its own storey band', () => {
  assert.equal(STOREY_HEIGHT, 5)
  for (const z of LEVEL_STEPS) assert.equal(storeyBand(z), z)
})
test('a floor and every wall course share one band without absorbing the next floor', () => {
  for (const base of [-15, -10, -5, 0, 5]) {
    for (let dz=0; dz<5; dz++) assert.equal(storeyBand(base+dz),base)
    assert.notEqual(storeyBand(base),storeyBand(base+5))
  }
})
test('cells between grid lines snap down to the storey below', () => {
  for (const z of [0,1,2,3,4]) assert.equal(storeyBand(z),0)
  assert.equal(storeyBand(5),5)
  assert.equal(storeyBand(9),5)
  assert.equal(storeyBand(-11),-15)
})
test('nearestLevel snaps to the closest five-metre plane within the editing range', () => {
  assert.equal(nearestLevel(-7.4),-5)
  assert.equal(nearestLevel(-7.6),-10)
  assert.equal(nearestLevel(3),5)
  assert.equal(nearestLevel(22),20)
  assert.equal(nearestLevel(23),25)
  assert.equal(nearestLevel(100),30)
  assert.equal(nearestLevel(-100),-40)
})
test('the base shifts every stop and its storey band together', () => {
  assert.deepEqual(levelSteps(3).slice(0,4),[-37,-32,-27,-22])
  assert.equal(nearestLevel(2,3),3)
  assert.equal(nearestLevel(-2,3),-2)
  assert.equal(storeyBand(3,3),3)
  assert.equal(storeyBand(7,3),3)
  assert.equal(storeyBand(-2,3),-2)
})
