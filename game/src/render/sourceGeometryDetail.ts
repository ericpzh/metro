import * as THREE from 'three'
import { BATCH_SOURCE_LAYER } from './batchGeometry.ts'
import { modelDetailGeometry } from './modelDetail.ts'

/** Unbatched and animated equipment keeps its mesh/rig identity and full picking surface. */
export class SourceGeometryDetail {
  private entries = new Map<THREE.Mesh, { near: THREE.BufferGeometry; raycast: THREE.Mesh['raycast'] }>()

  apply(root: THREE.Object3D, reduced: boolean): void {
    if(!reduced)return
    root.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.BatchedMesh || object instanceof THREE.SkinnedMesh ||
          object.layers.isEnabled(BATCH_SOURCE_LAYER) || Array.isArray(object.material)) return
      const near = object.geometry, far = modelDetailGeometry(object)
      if (!far || !reduced) return
      const raycast = object.raycast
      this.entries.set(object, { near, raycast })
      object.geometry = far
      object.raycast = function (ray, hits) {
        const drawing = this.geometry
        this.geometry = near
        try { raycast.call(this, ray, hits) } finally { this.geometry = drawing }
      }
    })
  }

  /** Restore before batching, rebuilding or disposal; the source owns both geometries. */
  restore(): void {
    for (const [mesh, entry] of this.entries) { mesh.geometry = entry.near; mesh.raycast = entry.raycast }
    this.entries.clear()
  }
}
