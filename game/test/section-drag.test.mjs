// The 剖切 **drag** as a whole: a pointer moving on the canvas, and the slide it
// asks for.
//
// `test/section.test.mjs` pins the arithmetic; this pins the part that only makes
// sense with a camera: which line on screen the pointer is measured along
// (`SceneRenderer.sectionDragAxis`), in the rig the game actually uses. It is
// here because the drag was wrong three times running — first measured in the
// plane the *cut* stands on, which is perpendicular to the look and so could
// never move it at all; then in a camera-facing plane, which counted a sideways
// drag as a slide whenever the camera was oblique. What the mode promises is
// narrower than either: the pointer pushes the cut **along the direction 旋转
// points it**, and a drag across that direction does nothing.
//
// No canvas and no GL context: the camera is a plain three.js object and the
// projection is three's own.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { QUARTER_TURNS, dragOffset, sectionNormal, walkAlong } from '../src/render/section.ts'

const SIZE = { w: 1280, h: 820 }

/** The rig `CameraSystem.setPreset('iso')` builds: up, east and south of centre. */
function isoCamera() {
  const target = new THREE.Vector3(0, 0, -8)
  const camera = new THREE.PerspectiveCamera(45, SIZE.w / SIZE.h, 0.5, 2000)
  camera.up.set(0, 0, 1)
  camera.position.copy(target).addScaledVector(new THREE.Vector3(1, -1.2, 0.85).normalize(), 120)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)
  return camera
}

/** `SceneRenderer.sectionScreenPoint`. */
function screenPoint(camera, point) {
  const v = new THREE.Vector3(point[0], point[1], point[2]).project(camera)
  return [((v.x + 1) / 2) * SIZE.w, ((1 - v.y) / 2) * SIZE.h]
}

/** `SceneRenderer.sectionDragAxis`, from the station centre. */
function dragAxis(camera, azimuth) {
  const n = sectionNormal({ azimuth })
  const origin = [0, 0, -8]
  const a = screenPoint(camera, origin)
  const b = screenPoint(camera, [origin[0] + n[0], origin[1] + n[1], origin[2] + n[2]])
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const span = Math.hypot(dx, dy)
  return span < 1e-6 ? { axis: [0, 0], span: 0 } : { axis: [dx / span, dy / span], span }
}

test('the drag axis is the look, seen on screen, and it is defined at every turn', () => {
  const camera = isoCamera()
  for (const az of QUARTER_TURNS) {
    const { axis, span } = dragAxis(camera, az)
    assert.ok(span > 1, `one metre of the cut at ${az}° is a real distance on screen (${span.toFixed(1)} px)`)
    assert.ok(Math.abs(Math.hypot(...axis) - 1) < 1e-9, `the axis is a unit vector at ${az}°`)
  }
  // A cut that looks north and one that looks south are the same line, opposite
  // ways; the same for east and west. Quarter turns are what make that true.
  const north = dragAxis(camera, 0)
  const south = dragAxis(camera, 180)
  assert.ok(Math.abs(north.axis[0] + south.axis[0]) < 1e-9 && Math.abs(north.axis[1] + south.axis[1]) < 1e-9, 'north and south are opposite on screen')
})

test('a drag along the axis slides the cut; a drag across it does nothing', () => {
  const camera = isoCamera()
  const start = [640, 410]
  for (const az of QUARTER_TURNS) {
    const { axis, span } = dragAxis(camera, az)
    const metres = 2
    const px = span * metres
    // Push the pointer the way the cut slides: exactly the metres it walked.
    const alongPointer = [start[0] + axis[0] * px, start[1] + axis[1] * px]
    const along = dragOffset(0, walkAlong(start, alongPointer, axis), span)
    assert.ok(Math.abs(along - metres) < 1e-9, `a ${metres} m push along the axis at ${az}° asks for ${metres} m`)

    // Push it across the axis by the same distance: the cut must not move. This
    // is the case an oblique camera used to get wrong.
    const across = [-axis[1], axis[0]]
    const acrossPointer = [start[0] + across[0] * px, start[1] + across[1] * px]
    const sideways = dragOffset(0, walkAlong(start, acrossPointer, axis), span)
    assert.ok(Math.abs(sideways) < 1e-9, `a ${metres} m push across the axis at ${az}° moves the cut nowhere`)

    // And pulling back the way the cut faces takes it back: a slide is relative.
    const back = dragOffset(1, walkAlong(start, [start[0] - axis[0] * px, start[1] - axis[1] * px], axis), span)
    assert.ok(Math.abs(back - -1) < 1e-9, `pulling back ${metres} m from +1 m lands on −1 m at ${az}°`)
  }
})

test('a cut sliding straight at the camera cannot be dragged, and says so', () => {
  // A camera looking straight down +y at a north-looking cut: its axis is the
  // view direction, so it has no length on screen. The drag is refused rather
  // than left to divide by nothing (`app/Viewport.tsx` skips the grab).
  const camera = new THREE.PerspectiveCamera(45, SIZE.w / SIZE.h, 0.5, 2000)
  camera.up.set(0, 0, 1)
  camera.position.set(0, -120, -8)
  camera.lookAt(new THREE.Vector3(0, 0, -8))
  camera.updateMatrixWorld(true)
  const { span } = dragAxis(camera, 0)
  assert.ok(span < 1, `the axis has no length to drag along (${span.toFixed(3)} px)`)
  assert.equal(dragOffset(2.5, 400, span), 2.5, 'and the cut stays where it was')
})
