// Wall and ceiling mounts can be aimed from open air; floor equipment cannot.
import test from 'node:test'
import assert from 'node:assert/strict'
import { canPlaceWithoutFloorHit } from '../src/app/tools/placementInput.ts'

test('wall-mounted poster and glass tiles reach the backing-wall verdict from open air', () => {
  assert.equal(canPlaceWithoutFloorHit('billboard-wide'), true)
  assert.equal(canPlaceWithoutFloorHit('glass-1x1'), true)
  assert.equal(canPlaceWithoutFloorHit('sign-wall'), true)
})

test('ceiling-mounted tiles reach the ceiling verdict from open air', () => {
  assert.equal(canPlaceWithoutFloorHit('tv'), true)
  assert.equal(canPlaceWithoutFloorHit('sign-ceiling'), true)
})

test('floor-standing equipment still requires a solid floor hit', () => {
  assert.equal(canPlaceWithoutFloorHit('bench-steel'), false)
  assert.equal(canPlaceWithoutFloorHit('door'), false)
  assert.equal(canPlaceWithoutFloorHit('linemap-stand'), false)
})
