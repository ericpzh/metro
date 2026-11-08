import * as THREE from 'three'
import { BATCH_SOURCE_LAYER } from './batchGeometry.ts'
import { modelDetailGeometry } from './modelDetail.ts'

/** Unbatched and animated equipment keeps its mesh/rig identity and full picking surface. */
export class SourceGeometryDetail {
  private entries = new Map<THREE.Mesh, { near: THREE.BufferGeometry; raycast: THREE.Mesh['raycast']; layers: number }>()

  private readonly hideOmissionsFromRender: boolean
  constructor(hideOmissionsFromRender = false) { this.hideOmissionsFromRender = hideOmissionsFromRender }

  apply(root: THREE.Object3D, reduced: boolean): void {
    if(!reduced)return
    root.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.BatchedMesh || object instanceof THREE.SkinnedMesh ||
          object.layers.isEnabled(BATCH_SOURCE_LAYER) || Array.isArray(object.material)) return
      const near = object.geometry, far = modelDetailGeometry(object)
      if (!far || !reduced) return
      const raycast = object.raycast
      this.entries.set(object, { near, raycast, layers: object.layers.mask })
      // Three still submits a draw for empty geometry. Keep omitted surfaces
      // on the picking layer so they never enter the normal render list.
      if (this.hideOmissionsFromRender && (far.index?.count ?? far.getAttribute('position').count) === 0) object.layers.set(BATCH_SOURCE_LAYER)
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
    for (const [mesh, entry] of this.entries) {
      mesh.geometry = entry.near
      mesh.raycast = entry.raycast
      mesh.layers.mask = entry.layers
    }
    this.entries.clear()
  }
}
