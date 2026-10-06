// The refused half of the add-drag ghost (GAME-SPEC §9.5).
//
// `build/validation.ts` splits a drag into the cells the release takes and the
// cells it refuses; `GhostSystem.setGhost` draws the second half as red boxes
// beside the cyan shape, through the same instanced mesh a remove drag uses. The
// verdict side is pinned in `validation.test.mjs` — this pins the display: the
// refused cells must reach the screen, or a dropped cell reads as a block that
// quietly went missing.
//
// Beside it, the contact-blob contract for the wall pieces: a 玻璃板, a 站名 and
// a 线网图 are bolted to a wall (or, for the totem, stand on a plinth), so none
// of them wants a floor contact blob under it.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { GhostSystem } from '../src/render/scene/systems/GhostSystem.ts'
import { SceneContextData, blobRadius } from '../src/render/scene/systems/SceneSystem.ts'

/** A `GhostSystem` without a browser: it only needs a scene to parent to. */
function ghostSystem() {
  const ctx = new SceneContextData(new THREE.Scene(), null, null, null)
  return new GhostSystem(ctx)
}

test('refused candidates are drawn as red boxes beside the accepted shape', () => {
  const sys = ghostSystem()
  // No accepted cells at all — only the two the release will not take.
  sys.setGhost([], 'add', 0xff5d5d, undefined, [
    [1, 2, 0],
    [2, 2, 0],
  ])
  const mesh = sys.ghostMesh
  assert.ok(mesh, 'the refused list mints the instanced mesh')
  assert.equal(mesh.visible, true, 'and it is on screen')
  assert.equal(mesh.count, 2, 'one box per refused candidate')
  const m = new THREE.Matrix4()
  mesh.getMatrixAt(0, m)
  const p = new THREE.Vector3().setFromMatrixPosition(m)
  assert.deepEqual([p.x, p.y, p.z], [1.5, 2.5, 0.5], 'centred on the refused cell')

  // The same drag with nothing refused draws nothing.
  sys.setGhost([], 'add', 0xff5d5d, undefined, [])
  assert.equal(mesh.visible, false, 'an empty refused list clears the boxes')
})

test('a changed refused set rebuilds the boxes instead of keeping the old ones', () => {
  const sys = ghostSystem()
  sys.setGhost([], 'add', 0xff5d5d, undefined, [[1, 2, 0]])
  assert.equal(sys.ghostMesh.count, 1)
  // One cell becomes two: the key carries the refused set, so the ghost notices.
  sys.setGhost([], 'add', 0xff5d5d, undefined, [
    [1, 2, 0],
    [3, 3, 0],
  ])
  assert.equal(sys.ghostMesh.count, 2, 'the boxes follow the verdict, not the first drag')
  // The identical drag twice is a no-op rather than a rebuild.
  const mesh = sys.ghostMesh
  sys.setGhost([], 'add', 0xff5d5d, undefined, [
    [1, 2, 0],
    [3, 3, 0],
  ])
  assert.equal(sys.ghostMesh, mesh, 'no rebuild, no new mesh')
})

test('the wall pieces sit their own way: no contact blob under them', () => {
  for (const type of ['glass', 'calligraphy', 'linemap']) {
    assert.equal(blobRadius(type), 0, `${type} is bolted to a wall or a plinth, not the floor`)
  }
  // The neighbours that share their tiles keep theirs: a totem beside a bench
  // still reads as furniture on the floor.
  assert.ok(blobRadius('bench') > 0, 'a 座椅 keeps its blob')
  assert.ok(blobRadius('tvm') > 0, 'and so does a 售票机')
})
