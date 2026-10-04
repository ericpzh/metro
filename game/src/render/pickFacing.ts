// Which way the camera is looking **from**, for a pick that resolves a module from
// its cell rather than from a drawn mesh.
//
// `moduleAt`'s `facing` says which side of a cell the caller is on, because one
// cell can hold two modules: a back-to-back 电视 pair is one object seen from two
// sides, and the cell alone cannot say which pane the pointer is on. Its contract
// (`sim/placement.ts`) is "the direction the caller is looking **from**, in world
// space" — the piece-to-eye step.
//
// The sign is the whole point, and it is easy to get backwards.
// `Camera.getWorldDirection` is *not* the camera's local +z: three overrides it to
// `super.getWorldDirection(...).negate()`, because a camera looks down its local
// −z, so it hands back the **look** direction (eye → scene). The pick needs the
// opposite of that. Getting it wrong selects the *far* pane of a pair — the screen
// whose lit face is turned away — which is invisible until someone right-clicks a
// pair and bulldozes the wrong television.
//
// Pure and three-only, so the sign is pinned by a test rather than by eye;
// `render/scene.ts` (which cannot be imported in Node — its poster artwork uses
// `import.meta.glob`) is the only caller.

import * as THREE from 'three'

/** The piece-to-eye step `moduleAt` wants, from any camera the viewport swaps to. */
export function facingFrom(camera: THREE.Camera): [number, number] {
  const dir = new THREE.Vector3()
  camera.getWorldDirection(dir)
  return [-dir.x, -dir.y]
}
