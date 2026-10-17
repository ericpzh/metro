import * as THREE from 'three'
import { coarseGeometry } from './geometryDetail.ts'
const releases = new WeakMap<THREE.Mesh, () => void>()

/** Authored §9.3 approximations belong to their full picking geometry. */
export function setModelDetail(mesh: THREE.Mesh, geometry: THREE.BufferGeometry): void {
  releases.get(mesh)?.()
  const source = mesh.geometry
  // Merged batches require the same vertex layout on both sides of a swap.
  for (const name of Object.keys(geometry.attributes)) if (!source.hasAttribute(name)) geometry.deleteAttribute(name)
  for (const [name, attribute] of Object.entries(source.attributes)) if (!geometry.hasAttribute(name)) {
    const values = new Float32Array(geometry.getAttribute('position').count * attribute.itemSize)
    if (name === 'color') values.fill(1)
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized))
  }
  source.computeBoundingBox(); source.computeBoundingSphere()
  geometry.computeBoundingBox(); geometry.computeBoundingSphere()
  geometry.boundingBox!.union(source.boundingBox!)
  geometry.boundingSphere!.union(source.boundingSphere!)
  mesh.userData.lowDetailGeometry = geometry
  const release = () => { geometry.dispose(); source.removeEventListener('dispose', release); releases.delete(mesh) }
  releases.set(mesh, release)
  source.addEventListener('dispose', release)
}

/** Keep exact source meshes for picking, while tiny hardware submits no triangles. */
export function omitModelDetail(root: THREE.Object3D): void {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    if (object.userData.lowDetailGeometry) return
    const empty = new THREE.BufferGeometry()
    for (const [name, attribute] of Object.entries((object.geometry as THREE.BufferGeometry).attributes)) {
      empty.setAttribute(name, new THREE.BufferAttribute(new Float32Array(0), attribute.itemSize, attribute.normalized))
    }
    empty.setIndex([])
    setModelDetail(object, empty)
  })
}

/** A fitting's envelope replaces bevels and dense curved surfaces at low detail. */
export function boxModelDetail(mesh: THREE.Mesh): void {
  mesh.geometry.computeBoundingBox()
  const box = mesh.geometry.boundingBox!, size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3())
  setModelDetail(mesh, new THREE.BoxGeometry(size.x, size.y, size.z).translate(centre.x, centre.y, centre.z))
}

/** A thin panel keeps both broad faces and drops its four narrow edge faces. */
export function panelModelDetail(mesh: THREE.Mesh, axis: 'x' | 'y' | 'z' = 'y'): void {
  mesh.geometry.computeBoundingBox()
  const box = mesh.geometry.boundingBox!, size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3())
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z).translate(centre.x, centre.y, centre.z)
  const offset = { x: 0, y: 12, z: 24 }[axis]
  geometry.setIndex(Array.from(geometry.index!.array.slice(offset, offset + 12)))
  geometry.clearGroups()
  setModelDetail(mesh, geometry)
}

/** Preserve a beam's thickness, omitting the end caps covered by its joints. */
export function beamModelDetail(mesh: THREE.Mesh, axis: 'x' | 'y' | 'z'): void {
  mesh.geometry.computeBoundingBox()
  const box = mesh.geometry.boundingBox!, size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3())
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z).translate(centre.x, centre.y, centre.z)
  const offset = { x: 0, y: 12, z: 24 }[axis], indices = geometry.index!.array
  geometry.setIndex([...indices.slice(0, offset), ...indices.slice(offset + 12)])
  geometry.clearGroups()
  setModelDetail(mesh, geometry)
}

export function modelDetailGeometry(mesh: THREE.Mesh): THREE.BufferGeometry | null {
  if (mesh.userData.lowDetailGeometry) return mesh.userData.lowDetailGeometry as THREE.BufferGeometry
  if (Array.isArray(mesh.material) || mesh.userData.staticInstances) return null
  const material = mesh.material as THREE.MeshStandardMaterial
  if (material.alphaMap || material.alphaTest > 0 || material.displacementMap || material.vertexColors ||
    material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return null
  return coarseGeometry(mesh.geometry)
}
