import * as THREE from 'three'
import { coarseGeometry } from './geometryDetail.ts'
import { TRAIN_DETAIL_MAX_RADIUS } from '../sim/constants.ts'

/**
 * One prepared detail swap inside a consist: a drawn body piece, a door bank or
 * the sorted glass. `apply` is the only thing a quality or storey change runs;
 * `mesh`/`near`/`far` are recorded so the swap can be observed without rebuilding.
 */
export interface TrainDetail {
  mesh?: THREE.Mesh
  near?: THREE.BufferGeometry
  far?: THREE.BufferGeometry
  apply(reduced: boolean): void
  /** Release an approximation the batch minted itself; authored ones belong to their source. */
  dispose?(): void
}

/**
 * Prepare every detail swap a built consist can make.
 *
 * The authored approximation of each part is attached to its source when the part
 * is built (`setModelDetail`), and `batchStaticParts` merges both variants, so a
 * body piece only ever swaps one geometry reference. Loose pieces without an
 * authored variant fall back to the bounded-error simplifier **only while the
 * piece is small enough** for its relative error to stay sub-pixel: a merged car
 * spans a whole consist, and 2 % of that is metres, so it is never fed to it.
 */
export function trainDetails(group: THREE.Group): TrainDetail[] {
  const details: TrainDetail[] = []
  const swap = (mesh: THREE.Mesh, near: THREE.BufferGeometry, far: THREE.BufferGeometry): TrainDetail => ({
    mesh, near, far,
    apply(reduced: boolean) { mesh.geometry = reduced ? far : near },
  })
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.BatchedMesh || object instanceof THREE.InstancedMesh ||
        object instanceof THREE.SkinnedMesh || Array.isArray(object.material) || object.layers.mask !== 1) return
    const material = object.material as THREE.MeshStandardMaterial
    if (material.alphaMap || material.alphaTest > 0 || material.displacementMap || material.vertexColors ||
        material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return
    const near = object.geometry
    let far = object.userData.lowDetailGeometry as THREE.BufferGeometry | undefined
    if (!far) {
      near.computeBoundingSphere()
      if ((near.boundingSphere?.radius ?? Infinity) <= TRAIN_DETAIL_MAX_RADIUS) far = coarseGeometry(near) ?? undefined
    }
    if (far) details.push(swap(object, near, far))
  })
  for (const batch of (group.userData.trainDoorBatches ?? []) as Array<{ mesh: THREE.InstancedMesh }>) {
    const detail = batch.mesh.userData.trainDoorDetail as { near: THREE.BufferGeometry; far: THREE.BufferGeometry } | undefined
    if (!detail) continue
    const entry = swap(batch.mesh, detail.near, detail.far)
    entry.dispose = () => detail.far.dispose()
    details.push(entry)
  }
  for (const batch of (group.userData.trainGlassBatches ?? []) as Array<{ mesh: THREE.BatchedMesh }>) {
    const detail = batch.mesh.userData.trainGlassDetail as { nearIds: number[]; farIds: number[] } | undefined
    if (!detail) continue
    const mesh = batch.mesh
    details.push({
      apply(reduced: boolean) {
        const ids = reduced ? detail.farIds : detail.nearIds
        for (let i = 0; i < ids.length; i++) mesh.setGeometryIdAt(i, ids[i])
      },
    })
  }
  return details
}

/** Triangles one built consist actually draws, with each prepared swap applied. */
export function trainDrawnTriangles(group: THREE.Group): number {
  let total = 0
  group.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh) || object.layers.mask !== 1) return
    // A batch allocates capacity: count the geometry each instance references.
    const batch = object as THREE.BatchedMesh
    if (batch.isBatchedMesh) {
      for (let i = 0; i < batch.instanceCount; i++) {
        const range = batch.getGeometryRangeAt(batch.getGeometryIdAt(i))
        total += (range?.count ?? 0) / 3
      }
      return
    }
    const geometry = object.geometry
    const count = (geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0) / 3
    const instanced = object as THREE.InstancedMesh
    total += count * (instanced.isInstancedMesh ? instanced.count : 1)
  })
  return Math.round(total)
}
