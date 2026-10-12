// A gait can animate perfectly while the person walks sideways. Compare its
// forward axis through the actual camera projection with the sheet's path.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { walkingHeading } from '../../tools/passenger-cards.mjs'
import { P, TW, TH } from '../../tools/iso.mjs'

test('isometric walking faces the path for all eight travel directions', () => {
  const capture = readFileSync(new URL('../src/app/capturePassengers.ts', import.meta.url), 'utf8')
  assert.ok(capture.includes('iso: [1, 1, 1]'), 'update the projection test if the capture camera changes')
  const camera = new THREE.OrthographicCamera(-1.05, 1.05, 1.4, -1.4, .1, 30)
  camera.up.set(0, 0, 1)
  camera.position.set(1, 1, 1)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const origin = new THREE.Vector3().project(camera)
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const [dx, dy] = P(x, y, 0)
    const heading = walkingHeading('iso', dx, dy, TW, TH)
    // The baked human faces +X at heading zero. A positive camera Y projects
    // upward, whereas SVG pixels increase downward.
    const forward = new THREE.Vector3(Math.cos(heading), Math.sin(heading), 0).project(camera)
    const screen = new THREE.Vector2((forward.x - origin.x) * 96, -(forward.y - origin.y) * 128).normalize()
    const path = new THREE.Vector2(dx, dy).normalize()
    assert.ok(screen.dot(path) > .999999, `world (${x},${y}): the human must face its path, not sideways or backward`)
  }
})

test('elevation walking still faces right and left', () => {
  assert.equal(walkingHeading('elevation', 20, 0, TW, TH), 0)
  assert.equal(walkingHeading('elevation', -20, 0, TW, TH), Math.PI)
})
