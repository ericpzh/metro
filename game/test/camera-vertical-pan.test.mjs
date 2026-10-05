// Ctrl+Q / Ctrl+E — the camera's vertical pan (`CameraSystem.panCameraVertical`).
//
// The whole point of this control is that **the view angle does not change**: the
// camera and the point it aims at step up (or down) world Z together, so the
// station is seen from the same elevation, the same distance and the same bearing
// and simply slides up or down the screen. That is also the part a refactor can
// silently lose — moving the camera and leaving `controls.target` behind is a
// one-line change that still "moves the camera", and it quietly turns the control
// into an orbit onto a steeper angle — so the test pins the aim, the offset and the
// view direction rather than "the camera moved".
//
// The second thing it pins is the vocabulary. Q and E are the storey step in the
// app; the camera only ever hears the pan's own tokens (`PAN_UP` / `PAN_DOWN`), and
// a plain letter has to leave the view exactly where it is. **One vocabulary, two
// sources**: the keyboard holds a token while Ctrl+E / Ctrl+Q is down and the nav
// cube's two arrows hold the same token while the pointer is down, which is what
// makes the buttons and the keys one control rather than two that look alike. Both
// ends of that wire are read back in the last test.
//
// No canvas and no GL context: the rig is `test/support/camera-rig.mjs` — a plain
// three.js camera, with a DOM-shaped stub for `OrbitControls` to attach to.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { cameraRig, look, panRate } from './support/camera-rig.mjs'
import { PAN_DOWN, PAN_UP } from '../src/render/scene/systems/SceneSystem.ts'

test('Ctrl+E raises the view: camera and aim step up Z together, and the angle is untouched', () => {
  const { cam, keys } = cameraRig()
  const from = cam.camera.position.clone()
  const aim = cam.controls.target.clone()
  const offset = from.clone().sub(aim)
  const before = look(cam)
  const dt = 0.5
  keys.add(PAN_UP)
  cam.panCameraVertical(dt)
  const moved = cam.camera.position.clone().sub(from)
  const movedAim = cam.controls.target.clone().sub(aim)
  // Straight up, and the aim goes with it by the pan's own rate.
  assert.ok(Math.abs(moved.x) < 1e-9 && Math.abs(moved.y) < 1e-9, `the camera left its column: ${moved.toArray()}`)
  assert.ok(Math.abs(moved.z - panRate(offset.length()) * dt) < 1e-9, `the step was ${moved.z}`)
  assert.ok(Math.abs(movedAim.z - moved.z) < 1e-9, `the aim lagged the camera: ${movedAim.z} vs ${moved.z}`)
  assert.ok(Math.abs(movedAim.x) < 1e-9 && Math.abs(movedAim.y) < 1e-9, 'and neither drifted sideways')
  // The offset the orbit rig holds is what the view angle *is*: untouched offset,
  // untouched angle. A camera-only move would shorten it and tilt the view. The
  // comparison is a tolerance because `controls.update()` rebuilds the position
  // from the offset through its own spherical round-trip, which costs the last
  // float bits — a camera-only move would move the direction by a tenth of a
  // radian here, not by 1e-14.
  assert.ok(cam.camera.position.clone().sub(cam.controls.target).distanceTo(offset) < 1e-12, 'the orbit offset changed')
  assert.ok(look(cam).distanceTo(before) < 1e-12, `the view angle changed: ${look(cam).distanceTo(before)}`)
})

test('Ctrl+Q drops the whole view by the same rate the climb uses', () => {
  const { cam, keys } = cameraRig()
  const from = cam.camera.position.clone()
  const aim = cam.controls.target.clone()
  const distance = from.distanceTo(aim)
  const dt = 0.25
  keys.add(PAN_DOWN)
  cam.panCameraVertical(dt)
  const moved = cam.camera.position.clone().sub(from)
  assert.ok(moved.z < 0, 'Q lowers the view')
  assert.ok(Math.abs(moved.z + panRate(distance) * dt) < 1e-9)
  assert.ok(Math.abs(cam.controls.target.z - (aim.z + moved.z)) < 1e-9, 'the aim drops with the camera')
})

test('a plain Q or E never moves the view — that letter is the storey step', () => {
  const { cam, keys } = cameraRig()
  const from = cam.camera.position.clone()
  const aim = cam.controls.target.clone()
  keys.add('q')
  keys.add('e')
  cam.panCameraVertical(0.5)
  assert.deepEqual(cam.camera.position.toArray(), from.toArray())
  assert.deepEqual(cam.controls.target.toArray(), aim.toArray())
})

test('Shift makes the vertical pan fast, as it does the ground pan', () => {
  const plain = cameraRig()
  const fast = cameraRig()
  for (const rig of [plain, fast]) rig.keys.add(PAN_UP)
  fast.keys.add('shift')
  const z0 = plain.cam.camera.position.z
  const z1 = fast.cam.camera.position.z
  plain.cam.panCameraVertical(0.2)
  fast.cam.panCameraVertical(0.2)
  const slow = plain.cam.camera.position.z - z0
  const quick = fast.cam.camera.position.z - z1
  // Three times, to the float error of three multiplications of the same rate.
  assert.ok(Math.abs(quick - slow * 3) < 1e-9, `shift step ${quick} is not 3x ${slow}`)
})

test('a long hold keeps the angle and the distance exactly, so nothing clamps it', () => {
  const { cam, keys } = cameraRig()
  const before = look(cam)
  const distance = cam.camera.position.distanceTo(cam.controls.target)
  keys.add(PAN_UP)
  // Far past `OrbitControls.maxDistance` (400 m) from the station centre. A
  // camera-only move would have been clamped there and lost its angle on the
  // way; the rig here holds its offset, so the distance is constant and the
  // hold is bounded only by the key.
  for (let i = 0; i < 40; i++) cam.panCameraVertical(0.5)
  assert.ok(Math.abs(cam.camera.position.distanceTo(cam.controls.target) - distance) < 1e-9, 'the orbit distance changed')
  // One step reproduces the direction exactly (above); forty of them leave the
  // last float bit or two of a normalised quaternion behind, which is drift and
  // not a changing angle, so the long hold is pinned to a tolerance.
  assert.ok(look(cam).distanceTo(before) < 1e-12, `the view angle drifted over a long hold: ${look(cam).distanceTo(before)}`)
  assert.ok(Number.isFinite(cam.camera.position.z), 'the rig never went NaN')
})

test('the vertical pan is wired: the frame loop drives it and both sources hold its tokens', () => {
  // A camera method that nothing calls is the failure this guards: it compiles, it
  // has a test, and the control does nothing in the game. `SceneRenderer.animate`
  // is the driver, and the key set has exactly two writers — the shell's keyboard
  // handler and the nav cube's arrows — so all three ends of the wire are read back
  // here (`test/scene-wiring.test.mjs` guards the sibling references the same way).
  const src = (p) => fs.readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
  assert.match(src('render/scene/SceneRenderer.ts'), /this\.cameraSys\.panCameraVertical\(dt\)/, 'the frame loop drives the vertical pan')
  const viewport = src('app/Viewport.tsx')
  assert.match(viewport, /scene\.keys\.add\(k === 'e' \? PAN_UP : PAN_DOWN\)/, 'Ctrl+E / Ctrl+Q hold the pan token')
  assert.match(viewport, /if \(k === 'e'\) scene\.keys\.delete\(PAN_UP\)/, 'and the letter release lets it go')
  const cube = src('app/ViewCube.tsx')
  assert.match(cube, /keys\.add\(PAN_UP\)/, 'the nav cube up arrow holds the same token')
  assert.match(cube, /keys\.add\(PAN_DOWN\)/, 'and its down arrow the other')
  assert.match(cube, /onPointerUp=\{\(\) => holdPan\(0\)\}/, 'a release clears it')
})
