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
    const instances = new THREE.InstancedMesh(mesh.geometry, mesh.material, modules.length)
    instances.renderOrder = mesh.renderOrder
    instances.frustumCulled = false
    for (let i = 0; i < modules.length; i++) {
      const piece = modules[i]
      translation.makeTranslation(piece.x - first.x, piece.y - first.y, piece.z - first.z)
      matrix.multiplyMatrices(translation, mesh.matrixWorld)
      instances.setMatrixAt(i, matrix)
    }
    instances.instanceMatrix.needsUpdate = true
    group.add(instances)
  })
  return group
}
