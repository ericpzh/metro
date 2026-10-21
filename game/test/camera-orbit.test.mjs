// Dragging the nav cube (`CameraSystem.orbitBy`) — the yaw and the pitch, one axis each.
//
// The widget's drag is the one camera control with no key and no button: it is a middle
// button on the canvas and a pointer drag on the cube, so its arithmetic is only ever
// exercised by hand. The two invariants worth pinning are the ones a viewer notices when
// they break: **a sideways drag must not change how high the camera sits** and **an
// up-down drag must not swing it around the station** — the failure mode of a pitch taken
// about the world X axis instead of the screen-right one, which reads as the view slowly
// rolling as you orbit.
//
// `orbitBy` and the FOV slider's sibling work share one tail (`CameraSystem.placeAt`,
// which clamps the polar angle a hair short of the poles so the view cannot flip); the
// clamp is pinned here too, because a drag is the only way to reach it.
//
// No canvas and no GL context: the rig is `test/support/camera-rig.mjs`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cameraRig } from './support/camera-rig.mjs'

/** The camera's height above its own target, which a yaw must not touch. */
function height(cam) {
  return cam.camera.position.z - cam.controls.target.z
}

/** The bearing the camera looks *from*, around world Z, which a pitch must not touch. */
function bearing(cam) {
  return Math.atan2(cam.camera.position.y - cam.controls.target.y, cam.camera.position.x - cam.controls.target.x)
}

test('a sideways drag turns the bearing and leaves the height where it was', () => {
  const { cam } = cameraRig()
  const h0 = height(cam)
  const b0 = bearing(cam)
  cam.orbitBy(60, 0)
  assert.ok(Math.abs(bearing(cam) - b0) > 0.1, 'a sideways drag did not turn the view')
  assert.ok(Math.abs(height(cam) - h0) < 1e-9, `and it moved the camera off its level: ${height(cam)} vs ${h0}`)
})

test('an up-down drag changes the height and leaves the bearing where it was', () => {
  const { cam } = cameraRig()
  // After a turn, so the pitch axis has to be the screen-right one rather than world X.
  cam.orbitBy(60, 0)
  const h0 = height(cam)
  const b0 = bearing(cam)
  cam.orbitBy(0, -50)
  assert.ok(Math.abs(height(cam) - h0) > 1, 'an up-down drag did not move the camera')
  assert.ok(Math.abs(bearing(cam) - b0) < 1e-9, `and it swung the camera around: ${bearing(cam)} vs ${b0}`)
})

test('a drag that pitches far enough stops short of the pole instead of flipping', () => {
  const { cam } = cameraRig()
  const radius = cam.camera.position.distanceTo(cam.controls.target)
  // Straight down over the target: 500 px of pitch is far past the pole.
  for (let i = 0; i < 10; i++) cam.orbitBy(0, -500)
  const offset = cam.camera.position.clone().sub(cam.controls.target)
  assert.ok(offset.toArray().every(Number.isFinite), 'the rig went NaN')
  assert.ok(Math.abs(radius - cam.camera.position.distanceTo(cam.controls.target)) < 1e-6, 'the drag changed the distance')
  // The polar angle is clamped at POLAR_EPS, so the camera never sits exactly overhead.
  const phi = Math.acos(Math.max(-1, Math.min(1, offset.z / offset.length())))
  assert.ok(phi > 0.01, `the camera reached the pole itself (phi ${phi})`)
})

test('WASD follows the plan view screen axes when the camera looks straight down', () => {
  const { cam, keys } = cameraRig()
  cam.setPreset('plan')
  const target = cam.controls.target.clone()
  const camera = cam.camera.position.clone()
  const dt = 0.25

  keys.add('w')
  cam.panCamera(dt)
  const forward = cam.controls.target.clone().sub(target)
  assert.ok(forward.y < 0, `W moved opposite screen-up in plan view: ${forward.toArray()}`)
  assert.ok(Math.abs(forward.x) < 1e-9, `W drifted sideways: ${forward.toArray()}`)
  assert.ok(cam.camera.position.distanceTo(camera.clone().add(forward)) < 1e-9, 'camera and aim should move together')

  keys.clear()
  const beforeRight = cam.controls.target.clone()
  keys.add('d')
  cam.panCamera(dt)
  const right = cam.controls.target.clone().sub(beforeRight)
  assert.ok(right.x < 0, `D moved opposite screen-right in plan view: ${right.toArray()}`)
  assert.ok(Math.abs(right.y) < 1e-9, `D drifted vertically: ${right.toArray()}`)

  keys.clear()
  const beforeBack = cam.controls.target.clone()
  keys.add('s')
  cam.panCamera(dt)
  const back = cam.controls.target.clone().sub(beforeBack)
  assert.ok(back.y > 0, `S did not oppose W in plan view: ${back.toArray()}`)

  keys.clear()
  const beforeLeft = cam.controls.target.clone()
  keys.add('a')
  cam.panCamera(dt)
  const left = cam.controls.target.clone().sub(beforeLeft)
  assert.ok(left.x > 0, `A did not oppose D in plan view: ${left.toArray()}`)
})
