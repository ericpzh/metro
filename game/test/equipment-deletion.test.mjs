// Equipment teardown follows the visible model before falling back to its grid cell.
import test from 'node:test'
import assert from 'node:assert/strict'
import { deletionTarget } from '../src/app/tools/deletionTarget.ts'

const poster = { id: 'poster', type: 'billboard', x: 4, y: 4, z: 0, rot: 0, w: 1, cfg: { variant: 'wide' } }
const equipment = { id: 'gate', type: 'gate', x: 0, y: 0, z: 0, rot: 0, cfg: { dir: 'both' } }

test('equipment right-click deletes the ray-picked poster even when the grid hit is the rail', () => {
  assert.equal(deletionTarget([equipment, poster], 'poster', [1, 0, 0]), poster)
})

test('equipment right-click falls back to the module occupying the hit cell', () => {
  assert.equal(deletionTarget([equipment], null, [0, 0, 0]), equipment)
})
