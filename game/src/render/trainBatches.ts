import * as THREE from 'three'
import { attributeKey, bakedGeometry, BATCH_SOURCE_LAYER, geometryKey, equalGeometry } from './batchGeometry.ts'

interface DoorBatch { mesh: THREE.InstancedMesh; sources: THREE.Mesh[] }

/** Keep each transparent surface sortable inside a material batch. */
export function sortedBatch(sources: THREE.Mesh[], geometries: THREE.BufferGeometry[], material: THREE.Material, reserved: THREE.BufferGeometry[] = []): THREE.BatchedMesh {
  const vertices = [...geometries, ...reserved].reduce((n, g) => n + g.getAttribute('position').count, 0)
  const batch = new THREE.BatchedMesh(sources.length, vertices, 0, material)
  for (const geometry of geometries) {
    const id = batch.addGeometry(geometry)
    batch.addInstance(id)
  }
  batch.computeBoundingBox()
  batch.computeBoundingSphere()
  return batch
}

/** Door frames, panes and feet repeat exactly; each bank keeps its own motion. */
export function batchTrainDoors(root: THREE.Group): void {
  const doors = (root.userData.doors ?? []) as THREE.Mesh[]
  const buckets = new Map<string, THREE.Mesh[]>()
  for (const door of doors) door.traverseVisible(o => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh || o instanceof THREE.InstancedMesh || o instanceof THREE.BatchedMesh || Array.isArray(o.material) || o.layers.mask !== 1) return
    if (Object.keys(o.geometry.morphAttributes).length || o.geometry.drawRange.start !== 0 || o.geometry.drawRange.count !== Infinity) return
    // Opposite sides can have different kick-plate offsets; instance transforms
    // carry those offsets, while each repeated geometry stays in its own bucket.
    const key = `${o.material.uuid}|${geometryKey(o.geometry)}|${o.renderOrder}|${o.castShadow}|${o.receiveShadow}|${o.frustumCulled}`
    const bucket = buckets.get(key) ?? []
    bucket.push(o); buckets.set(key, bucket)
  })
  const batches: DoorBatch[] = []
  for (const sources of buckets.values()) {
    if (sources.length < 2) continue
    if (!sources.every(s => equalGeometry(s.geometry, sources[0].geometry))) continue
    const mesh = new THREE.InstancedMesh(sources[0].geometry.clone(), sources[0].material, sources.length)
    // Individual door panes must sort with each other, so use the sorted glass
    // path below instead of a single unsorted transparent instance draw.
    if ((sources[0].material as THREE.Material).transparent) { mesh.geometry.dispose(); mesh.dispose(); continue }
    for (const source of sources) source.layers.set(BATCH_SOURCE_LAYER)
    mesh.renderOrder = sources[0].renderOrder
    mesh.castShadow = sources[0].castShadow; mesh.receiveShadow = sources[0].receiveShadow
    mesh.frustumCulled = sources[0].frustumCulled
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.userData.trainDoorBatch = true
    root.add(mesh)
    batches.push({ mesh, sources })
  }
  root.userData.trainDoorBatches = batches
  syncTrainDoorBatches(root)
}

interface GlassBatch { mesh: THREE.BatchedMesh; sources: THREE.Mesh[]; local: THREE.Matrix4[] }

/** Transparent glass/straps use per-surface depth sorting, including moving panes. */
export function batchTrainTransparent(root: THREE.Group): void {
  root.updateWorldMatrix(true, true)
  const inverse = root.matrixWorld.clone().invert()
  const buckets = new Map<string, THREE.Mesh[]>()
  root.traverseVisible(o => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh || o instanceof THREE.InstancedMesh || o instanceof THREE.BatchedMesh || Array.isArray(o.material)) return
    if (!o.material.transparent || !o.visible || o.children.length || o.layers.mask !== 1) return
    if (Object.keys(o.geometry.morphAttributes).length || o.geometry.drawRange.start !== 0 || o.geometry.drawRange.count !== Infinity) return
    const key = `${o.material.uuid}|${attributeKey(o.geometry)}|${o.renderOrder}|${o.castShadow}|${o.receiveShadow}|${o.frustumCulled}`
    const sources = buckets.get(key) ?? []; sources.push(o); buckets.set(key, sources)
  })
  const batches: GlassBatch[] = []
  for (const sources of buckets.values()) {
    if (sources.length < 2) continue
    const geometries = sources.map(s => bakedGeometry(s.geometry, new THREE.Matrix4()))
    const mesh = sortedBatch(sources, geometries, sources[0].material as THREE.Material)
    geometries.forEach(g => g.dispose())
    mesh.renderOrder = sources[0].renderOrder
    mesh.castShadow = sources[0].castShadow; mesh.receiveShadow = sources[0].receiveShadow
    mesh.frustumCulled = sources[0].frustumCulled
    mesh.perObjectFrustumCulled = mesh.frustumCulled
    const local = sources.map(s => inverse.clone().multiply(s.matrixWorld))
    for (let i = 0; i < sources.length; i++) {
      sources[i].layers.set(BATCH_SOURCE_LAYER)
      mesh.setMatrixAt(i, local[i])
    }
    mesh.computeBoundingBox(); mesh.computeBoundingSphere()
    mesh.userData.trainGlassBatch = true
    root.add(mesh); batches.push({ mesh, sources, local })
  }
  root.userData.trainGlassBatches = batches
}

/** Called only when a door pose changes, never when a consist merely translates. */
export function syncTrainDoorBatches(root: THREE.Object3D): void {
  const doors = root.userData.trainDoorBatches as DoorBatch[] | undefined
  const glass = root.userData.trainGlassBatches as GlassBatch[] | undefined
  if (!doors?.length && !glass?.length) return
  root.updateWorldMatrix(true, true)
  const inverse = root.matrixWorld.clone().invert()
  for (const batch of doors ?? []) {
    for (let i = 0; i < batch.sources.length; i++) batch.mesh.setMatrixAt(i, inverse.clone().multiply(batch.sources[i].matrixWorld))
    batch.mesh.instanceMatrix.needsUpdate = true
    batch.mesh.computeBoundingBox(); batch.mesh.computeBoundingSphere()
  }
  for (const batch of glass ?? []) {
    for (let i = 0; i < batch.sources.length; i++) {
      const source = batch.sources[i]
      if (!source.parent?.userData.openSign) continue
      batch.mesh.setMatrixAt(i, inverse.clone().multiply(source.matrixWorld))
    }
    batch.mesh.computeBoundingBox(); batch.mesh.computeBoundingSphere()
  }
}
