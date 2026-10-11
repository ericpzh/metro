import test from 'node:test'
import assert from 'node:assert/strict'
import { TouchZoom } from '../src/app/touchZoom.ts'
import { cameraRig } from './support/camera-rig.mjs'

test('spreading fingers zooms in; pinching zooms out without editing on either release', () => {
  const gesture = new TouchZoom()
  gesture.down(1, 0, 0)
  gesture.down(2, 100, 0)
  assert.equal(gesture.move(2, 200, 0), 0.5)
  assert.equal(gesture.move(2, 100, 0), 2)
  assert.equal(gesture.up(1), false)
  assert.equal(gesture.move(2, 90, 0), 1)
  assert.equal(gesture.up(2), false)
  gesture.down(3, 50, 50)
  assert.equal(gesture.up(3), true, 'a new single-finger session can tap again')
})

test('cancelled, coincident and extra fingers never create invalid zoom or tap edits', () => {
  const gesture = new TouchZoom()
  gesture.down(1, 0, 0)
  gesture.down(2, 0, 0)
  assert.equal(gesture.move(2, 100, 0), 1)
  gesture.down(3, 50, 0)
  assert.equal(gesture.move(3, 60, 0), 1)
  gesture.cancel(3)
  assert.equal(gesture.move(2, 200, 0), 0.5)
  assert.equal(gesture.up(2), false)
  assert.equal(gesture.up(1), false)
  gesture.down(4, 0, 0)
  gesture.cancel(4)
  assert.equal(gesture.up(4), false)
})

test('pinch zoom preserves the perspective aim and clamps both camera projections', () => {
  const { cam } = cameraRig()
  const aim = cam.controls.target.clone()
  const before = cam.camera.position.distanceTo(aim)
  cam.zoomBy(0.5)
  assert.ok(Math.abs(cam.camera.position.distanceTo(aim) - before * 0.5) < 1e-8)
  assert.ok(cam.controls.target.equals(aim))
  cam.zoomBy(1e-9)
  assert.ok(Math.abs(cam.camera.position.distanceTo(aim) - 4) < 1e-8)
  cam.zoomBy(1e9)
  assert.ok(Math.abs(cam.camera.position.distanceTo(aim) - 400) < 1e-8)
  cam.setOrtho(true)
  const width = cam.ortho.right - cam.ortho.left
  cam.zoomBy(0.5)
  assert.ok(Math.abs((cam.ortho.right - cam.ortho.left) - width * 0.5) < 1e-8)
  cam.zoomBy(NaN)
  cam.zoomBy(0)
  assert.ok(Number.isFinite(cam.ortho.right))
  cam.dispose()
})
