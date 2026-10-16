// Equipment teardown follows the visible model before falling back to its grid cell.
import test from 'node:test'
import assert from 'node:assert/strict'
import { deletionTarget } from '../src/app/tools/deletionTarget.ts'

const poster = { id: 'poster', type: 'billboard', x: 4, y: 4, z: 0, rot: 0, w: 1, cfg: { variant: 'wide' } }
const equipment = { id: 'gate', type: 'gate', x: 0, y: 0, z: 0, rot: 0, cfg: { dir: 'both' } }
const paving = { id: 'sidewalk', type: 'sidewalk', x: 2, y: 2, z: 0, rot: 0, cfg: {} }
const tree = { id: 'tree', type: 'tree', x: 5, y: 5, z: 0, rot: 0, cfg: {} }

test('equipment right-click deletes the ray-picked poster even when the grid hit is the rail', () => {
  assert.equal(deletionTarget([equipment, poster], 'poster', [1, 0, 0]), poster)
})

test('equipment right-click falls back to the module occupying the hit cell', () => {
  assert.equal(deletionTarget([equipment], null, [0, 0, 0]), equipment)
})

test('a ray that crossed another cell does not steal the piece standing in the pointed cell', () => {
  // The 树木's canopy overhangs the paving beside it: the ray resolves the tree,
  // the pointer is on the 人行道 tile. The tile is what a delete means.
  assert.equal(deletionTarget([paving, tree], 'tree', [2, 2, 0]), paving)
  // A ray that hit nothing at all over the same tile resolves it the same way.
  assert.equal(deletionTarget([paving, tree], null, [2, 2, 0]), paving)
})

test('a drawn piece that stands in the pointed cell keeps the delete', () => {
  // A tall piece owns the cell it rises from, so aiming at its body still works
  // even where the grid hit landed a cell away.
  assert.equal(deletionTarget([paving, tree], 'tree', [5, 5, 0]), tree)
  // And a multi-cell piece is deleted from any cell of its own footprint.
  const bay = { id: 'bay', type: 'roof', x: 0, y: 0, z: 0, rot: 0, w: 4, d: 4, cfg: {} }
  assert.equal(deletionTarget([bay], 'bay', [3, 3, 0]), bay)
})
