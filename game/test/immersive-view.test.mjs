// 隐藏UI (K, the store's `immersion` flag) is a **move** of the camera rig, not a
// view of its own — and this is the guard on that claim.
//
// The mode has one job: stand the eye where a person in the room would stand. What
// it must never do is cost the player the angle they were working at. Pressing K
// used to re-aim the camera at the mode's own idea of a view (and back to the
// isometric preset on the way out), which threw away every orbit, dolly and pan
// made before it.
//
// So it is a translation: one vector, added to the camera *and* to its orbit
// target, so the offset between the two — the direction the view looks along and
// the distance it looks from — is exactly what it was. `immersiveStep` is that
// vector, pure, so the whole rule is checkable without a canvas or a GL context;
// `CameraSystem` does nothing but add it and remember the pose it came from.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CameraSystem, immersiveStep } from '../src/render/scene/systems/CameraSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { packKey } from '../src/sim/types.ts'

/**
 * A `CameraSystem` without a browser: it stores its canvas and its renderer and
 * never draws, and the rig it moves is plain three.js state, so a listener sink and
 * a `setSize` sink are all either of them ever needs. `blocks` are solid cells
 * (`[x, y, z]`) for the floor line the eye stands on.
 */
function cameraSystem(blocks = []) {
  // OrbitControls attaches listeners to the canvas, its `ownerDocument` and its root
  // node; none of them is ever dispatched here.
  const sink = { addEventListener() {}, removeEventListener() {} }
  const canvas = {
    style: {},
    ownerDocument: sink,
    getRootNode: () => sink,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture() {},
  }
  const ctx = new SceneContextData(new THREE.Scene(), null, null, null)
  ctx.bounds = new THREE.Box3(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10))
  ctx.solid = new Set(blocks.map(([x, y, z]) => packKey(x, y, z)))
  ctx.activeZ = -4
  return new CameraSystem(canvas, ctx, { setSize() {} })
}

/** A floor slab at `z`, one cell thick, as the camera's `solid` set reads it. */
const slab = (z, cells) => new Set(cells.map(([x, y]) => packKey(x, y, z)))

/** An orbit rig: a camera over a target, at whatever angle. */
function rig(position, target) {
  return { camera: new THREE.Vector3(...position), target: new THREE.Vector3(...target) }
}

const step = (r, solid, z) => immersiveStep(r.camera, r.target, solid, z)
const eyeAbove = (solid, x, y, z) => {
  // The top of the slab run the column meets, from `z` down.
  for (let cz = Math.floor(z); cz >= z - 64; cz--) {
    if (!solid.has(packKey(Math.floor(x), Math.floor(y), cz))) continue
    let top = cz
    while (solid.has(packKey(Math.floor(x), Math.floor(y), top + 1))) top++
    return top + 1
  }
  return z
}

test('the step leaves the camera’s offset from its target alone, exactly', () => {
  // An isometric-ish rig over a concourse floor at −8 m: the angle the view looks
  // along and the distance it looks from are the player's, and they survive.
  const solid = slab(-8, [[3, 4]])
  const r = rig([20, -30, 12], [0, 0, -6])
  const before = r.camera.clone().sub(r.target)
  const s = step(r, solid, -8)
  r.camera.add(s)
  r.target.add(s)
  const after = r.camera.clone().sub(r.target)
  assert.ok(before.distanceTo(after) < 1e-12, `the orbit moved: ${before.toArray()} → ${after.toArray()}`)
  // Which is the same statement as: the direction and the distance are untouched.
  assert.ok(Math.abs(before.length() - after.length()) < 1e-12, 'and with it the dolly')
})

test('the eye ends a person’s height above the storey’s own floor', () => {
  const solid = slab(-8, [[0, 0]])
  const r = rig([20, -30, 12], [0, 0, -6])
  const s = step(r, solid, -8)
  r.camera.add(s)
  // The floor of that storey is the top of the slab at −8, i.e. −7 m; a person's
  // eye is 1.62 m above it. That is the mode's one claim, and it is why the storey
  // is a parameter: at depth −8 m the camera stands at −5.38 m.
  assert.ok(Math.abs(r.camera.z - -5.38) < 1e-9, `the eye is at ${r.camera.z}, not −5.38`)
  assert.ok(Math.abs(eyeAbove(solid, 0, 0, -8) + 1.62 - r.camera.z) < 1e-9, 'and it is floor + eye height')
})

test('the eye stands where the view was looking, not where the camera happened to be', () => {
  const solid = slab(0, [[7, 3]])
  const r = rig([40, -40, 30], [7.5, 3.5, 0])
  const s = step(r, solid, 0)
  r.camera.add(s)
  r.target.add(s)
  assert.ok(Math.abs(r.camera.x - 7.5) < 1e-12 && Math.abs(r.camera.y - 3.5) < 1e-12, 'the eye is over the target')
  assert.ok(Math.abs(r.camera.z - 2.62) < 1e-9, `standing on that column's floor: ${r.camera.z}`)
  // The target keeps its offset, so it is now a little further along the same ray.
  assert.ok(r.target.z < r.camera.z, 'and the rig still looks the way it did')
})

test('a column with no floor there is not a hole to fall through', () => {
  // A void over the storey — the 动物园's wellways have them — leaves the eye the
  // right height above the grid rather than dropping it to the bottom of the world.
  const solid = slab(-8, [[0, 0]])
  const r = rig([30, -30, 20], [50, 50, -6])
  const s = step(r, solid, -8)
  r.camera.add(s)
  assert.ok(Math.abs(r.camera.z - (-8 + 1.62)) < 1e-9, `the eye is at ${r.camera.z}, not −6.38`)
})

test('stepping out is stepping back: the two moves cancel', () => {
  // Turning the mode off restores the saved pose rather than re-aiming, so the pair
  // has to be an exact inverse for K to read as a peek.
  const solid = slab(-4, [[1, 1]])
  const before = rig([12, -9, 7], [1.5, 1.5, -3])
  const r = rig([...before.camera.toArray()], [...before.target.toArray()])
  const s = step(r, solid, -4)
  r.camera.add(s)
  r.target.add(s)
  r.camera.sub(s)
  r.target.sub(s)
  assert.ok(r.camera.distanceTo(before.camera) < 1e-12, 'the camera came back')
  assert.ok(r.target.distanceTo(before.target) < 1e-12, 'and so did its target')
})

test('K moves the rig and K again puts it back, angle and all', () => {
  // The whole toggle, on a real `CameraSystem`. It needs a canvas and a renderer,
  // but it never draws: it only stores them, so stubs are enough — and the rig it
  // moves is plain three.js state.
  const sys = cameraSystem()
  sys.setPreset('iso')
  // Orbit the player's own way first: an odd angle no preset would pick, and the
  // exact thing the mode used to throw away.
  sys.camera.position.set(17, -3, 9)
  sys.controls.target.set(1, 2, -6)
  sys.controls.update()
  const offset = sys.camera.position.clone().sub(sys.controls.target)
  const saved = sys.camera.position.clone()
  const savedTarget = sys.controls.target.clone()

  sys.setImmersive(true, -4)
  assert.ok(sys.immersive, 'K turns the mode on')
  const inside = sys.camera.position.clone().sub(sys.controls.target)
  assert.ok(offset.distanceTo(inside) < 1e-9, `the angle arrived at is the one it was given: ${offset.toArray()} vs ${inside.toArray()}`)

  sys.setImmersive(false)
  assert.ok(!sys.immersive, 'K turns it off again')
  assert.ok(sys.camera.position.distanceTo(saved) < 1e-9, 'and the view is the one that was there')
  assert.ok(sys.controls.target.distanceTo(savedTarget) < 1e-9, 'to the metre, target included')
})

test('a preset is how the player leaves the mode, and it is not restored over', () => {
  // 1/2/4/5 and the nav cube's home are explicit views, so they end 隐藏UI *without*
  // putting the old rig back — which is only true if the mode forgets the pose it
  // saved. Otherwise the `setImmersive(false)` that follows the preset would land
  // the player back at the view they were working at instead of the one they asked
  // for.
  const sys = cameraSystem()
  sys.setPreset('iso')
  sys.camera.position.set(17, -3, 9)
  sys.controls.target.set(1, 2, -6)
  sys.controls.update()
  sys.setImmersive(true, -4)

  sys.setPreset('front')
  const front = sys.camera.position.clone()
  assert.ok(!sys.immersive, 'a preset ends the mode')
  sys.setImmersive(false)
  assert.ok(sys.camera.position.distanceTo(front) < 1e-9, 'and the preset stands: nothing restores over it')
})

test('re-entering, or a re-seat, never remembers the mode’s own pose', () => {
  // A second K, or the mount effect running twice, must be a no-op rather than a
  // save — remembering the immersion pose would lose the view being come back to.
  const sys = cameraSystem()
  sys.setPreset('iso')
  sys.camera.position.set(4, -9, 11)
  sys.controls.target.set(0, 0, -2)
  sys.controls.update()
  const saved = sys.camera.position.clone()

  sys.setImmersive(true, -4)
  sys.setImmersive(true, -4)
  sys.setImmersive(false)
  assert.ok(sys.camera.position.distanceTo(saved) < 1e-9, 'the view before the first K is the one that comes back')
})

test('a nested storey is stood on at the height of its own floor', () => {
  // `immersiveZ` is what a re-seat and the entry both use, and the floor under the
  // eye is that storey's: standing on the platform is not standing on the concourse.
  const sys = cameraSystem([[0, 0, -12]])
  sys.setPreset('iso')
  sys.controls.target.set(0, 0, -8)
  sys.setImmersive(true, -12)
  assert.ok(Math.abs(sys.camera.position.z - -9.38) < 1e-9, `the eye is at ${sys.camera.position.z}, not −9.38`)
})
