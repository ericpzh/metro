import type * as THREE from 'three'

/**
 * Anything that wears a material in the scene graph: meshes, but also the lines
 * and points equipment uses (the ball-court net is a `LineSegments`). Clipping
 * and storey dressing walk these, not only `Mesh`es.
 */
export type SurfaceObject = THREE.Mesh | THREE.Line | THREE.Points

/** True when `object` draws with a material the slice or the cut can change. */
export function isSurfaceObject(object: THREE.Object3D): object is SurfaceObject {
  const flags = object as { isMesh?: boolean; isLine?: boolean; isPoints?: boolean }
  return flags.isMesh === true || flags.isLine === true || flags.isPoints === true
}
