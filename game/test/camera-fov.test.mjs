// 视场角 — the FOV slider's arithmetic (`CameraSystem.fov` / `setFov`).
//
// The slider is the camera's **lens, in the camera's own degrees**: the number on it is
// the vertical field of view, so it can be compared with the lens anyone else quotes
// (a shooter's 90, a wide-angle's 100) without a conversion in between. Three things are
// worth pinning, and all three are about the number rather than about three.js:
//
// * **The degrees are read back as themselves.** The slider *follows the camera*, so
//   `fov()` has to return exactly what `setFov()` was given, or the thumb creeps a little
//   every frame it is left alone.
// * **Both ends of the track are real lenses.** 30° must genuinely magnify — the subject
//   occupies *more* of the frame — and 120° must genuinely open it up, which is the whole
//   reason for a degrees scale with a wide end rather than a narrowing percentage.
// * **The lens is clamped in the camera, not only on the slider.** `FOV_MIN_DEG` /
//   `FOV_MAX_DEG` are one range shared by both, so no caller can set a lens nothing can be
//   read through, and the ends are the slider's own ends.
//
// No canvas and no GL context: the rig is `test/support/camera-rig.mjs`, a plain
// three.js camera with a DOM-shaped stub for `OrbitControls` to attach to.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { cameraRig } from './support/camera-rig.mjs'
import { DEFAULT_FOV, FOV_MAX_DEG, FOV_MIN_DEG } from '../src/render/scene/systems/CameraSystem.ts'

/** The frustum's y scale: how much of the frame a fixed slice of the station fills. */
function magnification(cam) {
  return cam.camera.projectionMatrix.elements[5]
}

test('the camera opens on the building lens, and reports it in degrees', () => {
  const { cam } = cameraRig()
  assert.equal(cam.fov(), DEFAULT_FOV, 'the rig opens at DEFAULT_FOV')
  assert.equal(DEFAULT_FOV, 45, 'and that lens is the 45° building view')
  assert.ok(FOV_MIN_DEG < DEFAULT_FOV && DEFAULT_FOV < FOV_MAX_DEG, 'the default sits inside the track, not on an end')
})

test('a lens is read back as itself, across the whole track', () => {
  const { cam } = cameraRig()
  for (const deg of [30, 45, 60, 85, 90, 120, 74]) {
    cam.setFov(deg)
    assert.equal(cam.fov(), deg, `asked for ${deg}°, read ${cam.fov()}°`)
    assert.equal(cam.camera.fov, deg, 'and the camera itself carries it')
  }
})

test('the long end magnifies and the wide end opens the frame up', () => {
  const { cam } = cameraRig()
  cam.setFov(DEFAULT_FOV)
  const at45 = magnification(cam)
  // The station's own lens is the reference: everything below it is a longer lens.
  cam.setFov(FOV_MIN_DEG)
  const at30 = magnification(cam)
  assert.ok(at30 > at45, `30° did not magnify past the 45° view (${at30} vs ${at45})`)
  cam.setFov(FOV_MAX_DEG)
  const at120 = magnification(cam)
  assert.ok(at120 < at45, `120° did not open the frame past the 45° view (${at120} vs ${at45})`)
  assert.ok(at120 < at30, 'and the order of the two ends is the wrong way round')
  // A third of the angle is a good deal more than a third more magnification — the
  // tangent is not linear — which is exactly why the slider is in degrees and not in a
  // percentage of the default: 67% of 45° is not 67% of the view.
  assert.ok(at30 / at45 > 1.4, `30° is only ${(at30 / at45).toFixed(2)}× the default lens`)
})

test('the lens is clamped in the camera, at the slider’s own ends', () => {
  const { cam } = cameraRig()
  cam.setFov(1e6)
  assert.equal(cam.fov(), FOV_MAX_DEG, 'a huge push stopped at the wide end')
  cam.setFov(-1e6)
  assert.equal(cam.fov(), FOV_MIN_DEG, 'a tiny push stopped at the long end')
  cam.setFov(Number.NaN)
  assert.ok(Number.isFinite(cam.fov()), 'a NaN lens would blank the station')
})

test('setting the lens updates the projection matrix, so the change is drawn', () => {
  const { cam } = cameraRig()
  cam.setFov(DEFAULT_FOV)
  const before = cam.camera.projectionMatrix.elements.slice()
  cam.setFov(FOV_MAX_DEG)
  assert.notDeepEqual(cam.camera.projectionMatrix.elements, before, 'the projection never changed')
  assert.ok(magnification(cam) > 0, 'and it stayed a usable frustum')
})

test('the slider is wired: the widget writes degrees and reads them back', () => {
  const src = (p) => fs.readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
  const cube = src('app/ViewCube.tsx')
  assert.match(cube, /onChange=\{\(e\) => setFov\(Number\(e\.target\.value\)\)\}/, 'the slider writes the camera')
  assert.match(cube, /sceneRef\.current\?\.setFov\(deg\)/, 'in degrees')
  assert.match(cube, /const deg = Math\.round\(scene\.fov\(\)\)/, 'and the camera is what it reads back')
  assert.match(cube, /min=\{FOV_MIN_DEG\}/, 'the track’s ends are the camera’s own constants')
  assert.match(cube, /max=\{FOV_MAX_DEG\}/, 'both of them')
  const orchestrator = src('render/scene/SceneRenderer.ts')
  assert.match(orchestrator, /fov\(\): number \{\s*return this\.cameraSys\.fov\(\)/, 'the orchestrator forwards the read')
  assert.match(orchestrator, /setFov\(deg: number\): void \{\s*this\.cameraSys\.setFov\(deg\)/, 'and the write')
})
