import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Module } from '../sim/types.ts'
import { bakedGeometry } from './batchGeometry.ts'
import { setModelDetail } from './modelDetail.ts'

// Keep each module's root and every nested group: picking (§9.5), storey slicing
// (§9.3) and selection still address the original module. Animated rigs and
// mutable screen references must keep their individual meshes.
const STATIC_TYPES = new Set<Module['type']>([
  'bench', 'fence', 'light', 'vent', 'cctv', 'bin', 'extinguisher', 'shelf',
  'desk', 'cubicle', 'sink', 'stair', 'track', 'pillar', 'roof',
  'hanger', 'tactile', 'door', 'shop', 'exit', 'guidepost', 'busstop',
])

/** Collapse same-material opaque siblings into one draw, without changing art. */
export function batchStaticModule(root: THREE.Object3D, type: Module['type']): void {
  if (!STATIC_TYPES.has(type)) return
  batchStaticParts(root)
}

/** Batch only untagged opaque siblings, including inside animated assemblies.
 * Explicit rig references and their parent groups survive untouched. */
export function batchStaticParts(root: THREE.Object3D, protectedObjects = new Set<THREE.Object3D>(), reflections = false): void {
  root.traverse((parent) => {
    const buckets = new Map<string, THREE.Mesh[]>()
    for (const child of parent.children) {
      if (!(child instanceof THREE.Mesh) || child instanceof THREE.InstancedMesh || child instanceof THREE.SkinnedMesh) continue
      if (protectedObjects.has(child)) continue
      const geometry = child.geometry as THREE.BufferGeometry
      const material = child.material as THREE.Material | THREE.Material[]
      // Transparent parts need independent depth sorting. Tagged meshes may be
      // shared artwork or externally referenced; leave ownership untouched.
      if (Array.isArray(material) || material.transparent || !child.visible || child.children.length || Object.keys(child.userData).some(key => key !== 'lowDetailGeometry')) continue
      if (Object.keys(geometry.morphAttributes).length || geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) continue
      child.updateMatrix()
      if (child.matrix.determinant() === 0 || (!reflections && child.matrix.determinant() < 0)) continue
      const attributes = Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b))
        .map(([name, attr]) => `${name}:${attr.itemSize}:${attr.normalized}:${attr.array.constructor.name}`).join('|')
      const key = `${material.uuid}/${reflections ? false : !!geometry.index}/${attributes}/${child.renderOrder}/${child.castShadow}/${child.receiveShadow}/${child.layers.mask}/${child.frustumCulled}`
      const bucket = buckets.get(key)
      if (bucket) bucket.push(child)
      else buckets.set(key, [child])
    }
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue
      const copies = meshes.map((mesh) => reflections ? bakedGeometry(mesh.geometry, mesh.matrix) : mesh.geometry.clone().applyMatrix4(mesh.matrix))
      const geometry = mergeGeometries(copies)
      for (const copy of copies) copy.dispose()
      if (!geometry) continue
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      const first = meshes[0]
      const merged = new THREE.Mesh(geometry, first.material)
      if (meshes.some(mesh => mesh.userData.lowDetailGeometry)) {
        const reduced = meshes.map(mesh => bakedGeometry(mesh.userData.lowDetailGeometry ?? mesh.geometry, mesh.matrix))
        const detail = mergeGeometries(reduced)
        for (const copy of reduced) copy.dispose()
        if (detail) setModelDetail(merged, detail)
      }
      merged.renderOrder = first.renderOrder
      merged.castShadow = first.castShadow
      merged.receiveShadow = first.receiveShadow
      merged.layers.mask = first.layers.mask
      merged.frustumCulled = first.frustumCulled
      for (const mesh of meshes) {
        parent.remove(mesh)
        mesh.geometry.dispose()
      }
      parent.add(merged)
    }
  })
}
