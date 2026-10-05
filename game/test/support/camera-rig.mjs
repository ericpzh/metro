// A live `CameraSystem` in node — the rig the widget's camera tests drive
// (`test/camera-vertical-pan.test.mjs`, `test/camera-fov.test.mjs`,
// `test/camera-orbit.test.mjs`).
//
// No canvas and no GL context: the camera is a plain three.js object, `OrbitControls`
// only needs a DOM-shaped element to attach the listeners it never gets to fire, and
// the context is the two fields the camera reads (`keys`, `bounds`).
import * as THREE from 'three'
import { CameraSystem } from '../../src/render/scene/systems/CameraSystem.ts'

/** A DOM-shaped element: `OrbitControls` connects to it and nothing else runs. */
export function stubElement() {
  const doc = { addEventListener() {}, removeEventListener() {} }
  return {
    style: {},
    ownerDocument: doc,
    addEventListener() {},
    removeEventListener() {},
    getRootNode: () => doc,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 820 }),
  }
}

/** A camera rig on the iso view the game opens on, plus the keys it reads. */
export function cameraRig() {
  const keys = new Set()
  const bounds = new THREE.Box3(new THREE.Vector3(-20, -20, -20), new THREE.Vector3(20, 20, 20))
  const cam = new CameraSystem(stubElement(), { keys, bounds }, { setSize() {} })
  cam.setPreset('iso')
  return { cam, keys }
}

/** `CameraSystem.moveSpeed`: the rate both pans travel at, from the orbit distance. */
export function panRate(distance) {
  return Math.max(4, Math.min(45, distance * 0.4))
}

/** The camera's look direction — which *is* the view angle the pan may not change. */
export function look(cam) {
  return cam.camera.getWorldDirection(new THREE.Vector3())
}
