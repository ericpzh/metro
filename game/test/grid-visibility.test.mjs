// 隐藏UI: the editing lattice off the picture, and the storey slice put away
// with it.
//
// Two rules make the mode, and both are one line each: `GridSystem.gridVisible`
// (`!hideUI && !immersive`) owns the lattice and its cell cursor, and
// `levelSlicing.sliceOptions` owns what the storeys draw — *every* storey, as
// itself, instead of the 35% ghost sheet that lies over the floor under the
// camera. The point of the test is that those are lines rather than implicit
// behaviour spread over two modes, and that 隐藏UI and 沉浸 cannot put back what
// the other one took away.
//
// The cursor is the half that is easy to lose: it is set by the pointer on every
// frame, so a hidden lattice has to keep its ring down whatever the pick says.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { GridSystem, gridVisible } from '../src/render/scene/systems/GridSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'

/** A `GridSystem` without a browser: it only ever adds a group and a mesh to a scene. */
function gridSystem() {
  const scene = new THREE.Scene()
  const ctx = new SceneContextData(scene, {}, {}, {})
  ctx.activeZ = -8
  ctx.bounds.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 20, 0))
  return new GridSystem(ctx)
}

test('the lattice is drawn unless 隐藏UI or 沉浸 asks for it away', () => {
  assert.equal(gridVisible(false, false), true)
  assert.equal(gridVisible(true, false), false, '隐藏UI takes the lattice away on its own')
  assert.equal(gridVisible(false, true), false, '沉浸 has its own reason for the same lattice')
  assert.equal(gridVisible(true, true), false)
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

test('隐藏UI and 沉浸 hide one lattice without restoring each other\'s', () => {
  const grid = gridSystem()

  // 沉浸 is on and 隐藏UI is turned off again: the lattice stays down, because
  // the eye is still standing in the room.
  grid.setImmersive(true)
  assert.equal(grid.gridVisible, false)
  grid.setHideUI(true)
  grid.setHideUI(false)
  assert.equal(grid.gridVisible, false, '沉浸 still wants it away')

  // And the other way round: leaving 沉浸 while 隐藏UI is on changes nothing.
  grid.setHideUI(true)
  grid.setImmersive(false)
  assert.equal(grid.gridVisible, false, '隐藏UI still wants it away')

  // Both off is the only state that draws it.
  grid.setHideUI(false)
  assert.equal(grid.gridVisible, true)
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
