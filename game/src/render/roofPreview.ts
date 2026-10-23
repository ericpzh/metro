import * as THREE from 'three'
import type { Module } from '../sim/types.ts'

/** Repeat one exact roof model without rebuilding its geometry for every tile (§9.5). */
export function instanceRoofPreview(source: THREE.Object3D, modules: readonly Module[]): THREE.Group {
  const group = new THREE.Group()
  const first = modules[0]
  source.updateMatrixWorld(true)
  const translation = new THREE.Matrix4(), matrix = new THREE.Matrix4()
  source.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    // Match placed equipment's spatial/storey buckets: a distant end of a long
    // run must not inherit the near end's detail decision.
    const buckets = new Map<string, { z: number; matrices: THREE.Matrix4[] }>()
    for (const piece of modules) {
      translation.makeTranslation(piece.x - first.x, piece.y - first.y, piece.z - first.z)
      matrix.multiplyMatrices(translation, mesh.matrixWorld)
      const key = `${Math.floor(matrix.elements[12] / 16)},${Math.floor(matrix.elements[13] / 16)}|${piece.z}`
      let bucket = buckets.get(key)
      if (!bucket) { bucket = { z: piece.z, matrices: [] }; buckets.set(key, bucket) }
      bucket.matrices.push(matrix.clone())
    }
    let owner = true
    for (const bucket of buckets.values()) {
      const instances = new THREE.InstancedMesh(mesh.geometry, mesh.material, bucket.matrices.length)
      instances.userData.previewModuleZ = bucket.z
      instances.userData.sharedGeometry = mesh.userData.sharedGeometry === true || !owner
      owner = false
      // The source geometry still owns its authored approximation. Keep the link
      // when repeating it so previews follow the placed equipment's Low policy.
      instances.userData.lowDetailGeometry = mesh.userData.lowDetailGeometry
      instances.userData.coherentModelDetail = mesh.userData.coherentModelDetail
      instances.renderOrder = mesh.renderOrder
      instances.frustumCulled = false
      for (let i = 0; i < bucket.matrices.length; i++) instances.setMatrixAt(i, bucket.matrices[i])
      instances.instanceMatrix.needsUpdate = true
      group.add(instances)
    }
  })
  return group
}
