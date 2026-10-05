// 隐藏UI: the editing lattice off the picture, and the storey slice put away
// with it.
//
// Two rules make the mode: `GridSystem` owns the lattice and its cell cursor,
// and `levelSlicing.sliceOptions` owns what the storeys draw — *every* storey, as
// itself, instead of the 35% ghost sheet that lies over the floor under the
// camera. The point of the test is that each is one line in one owner, rather
// than implicit behaviour spread over the viewport.
//
// The cursor is the half that is easy to lose: it is set by the pointer on every
// frame, so a hidden lattice has to keep its ring down whatever the pick says.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { GridSystem } from '../src/render/scene/systems/GridSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'

/** A `GridSystem` without a browser: it only ever adds a group and a mesh to a scene. */
function gridSystem() {
  const scene = new THREE.Scene()
  const ctx = new SceneContextData(scene, {}, {}, {})
  ctx.activeZ = -8
  ctx.bounds.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 20, 0))
  return new GridSystem(ctx)
}

test('the lattice is drawn until 隐藏UI takes it away', () => {
  const grid = gridSystem()
  assert.equal(grid.gridVisible, true, 'a fresh station draws the lattice')

  grid.setHideUI(true)
  assert.equal(grid.gridVisible, false)

  grid.setHideUI(false)
  assert.equal(grid.gridVisible, true, 'and the tile gives it back')
})

test('隐藏UI takes away the lattice and the cell cursor that goes with it', () => {
  const grid = gridSystem()
  grid.setCursor([2, 3, -8], true)
  assert.equal(grid.cursor.visible, true, 'the ring is up while the lattice is drawn')

  grid.setHideUI(true)
  assert.equal(grid.gridVisible, false)
  assert.equal(grid.cursor.visible, false, 'the ring is the lattice\'s own pointer mark')

  // The pointer goes on picking at 60 fps while the lattice is hidden: without
  // the guard in `setCursor` the ring would come straight back.
  grid.setCursor([4, 5, -8], true)
  assert.equal(grid.cursor.visible, false, 'a pick may not put the ring back')

  grid.setHideUI(false)
  grid.setCursor([4, 5, -8], true)
  assert.equal(grid.gridVisible, true)
  assert.equal(grid.cursor.visible, true, 'and it comes back with the lattice')
})

test('the lattice is rebuilt at the active storey whatever 隐藏UI says', () => {
  const grid = gridSystem()
  grid.setHideUI(true)
  grid.buildGrid()
  // The build is not skipped while hidden: the next storey step rebuilds it, and
  // an unbuilt group would flash an empty grid on the frame it is shown again.
  assert.ok(grid.grid.children.length > 0)
  assert.equal(grid.gridVisible, false)
})
