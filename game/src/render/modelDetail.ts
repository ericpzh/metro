import * as THREE from 'three'
import { coarseGeometry } from './geometryDetail.ts'
const releases = new WeakMap<THREE.Mesh, () => void>()

/** Retain the original UVs/normals on an exposed face, or both sides of a sheet. */
export function surfaceModelDetail(mesh: THREE.Mesh, axis: 'x' | 'y' | 'z', sign?: -1 | 1): void {
  const source = mesh.geometry, normal = source.getAttribute('normal')
  const component = { x: 0, y: 1, z: 2 }[axis], indices: number[] = []
  const count = source.index?.count ?? source.getAttribute('position').count
  for (let i = 0; i < count; i += 3) {
    const vertex = source.index ? source.index.getX(i) : i
    const facing = normal.getComponent(vertex, component)
    if (sign === undefined ? Math.abs(facing) > .9 : facing * sign > .9) {
      for (let j = 0; j < 3; j++) indices.push(source.index ? source.index.getX(i + j) : i + j)
    }
  }
  const low = source.clone(); low.setIndex(indices); low.clearGroups()
  setModelDetail(mesh, low)
}

/** An uncapped triangular tube preserves a narrow rail in every viewing direction. */
export function tubeModelDetail(mesh: THREE.Mesh): void {
  mesh.geometry.computeBoundingBox()
  const box = mesh.geometry.boundingBox!, size = box.getSize(new THREE.Vector3())
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z'
  const low = new THREE.CylinderGeometry(1, 1, 1, 3, 1, true)
  if (axis === 'x') low.rotateZ(Math.PI / 2)
  if (axis === 'z') low.rotateX(Math.PI / 2)
  low.computeBoundingBox()
  const bounds = low.boundingBox!, extent = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3())
  low.translate(-centre.x, -centre.y, -centre.z)
  low.scale(size.x / extent.x, size.y / extent.y, size.z / extent.z)
  const target = box.getCenter(new THREE.Vector3()); low.translate(target.x, target.y, target.z)
  setModelDetail(mesh, low)
}

/** Two-sided flat strips in the mesh parent's coordinates, for coherent Low skins. */
export function panelStripModelDetail(mesh: THREE.Mesh, quads: readonly (readonly THREE.Vector3[])[]): void {
  mesh.updateMatrix()
  const inverse = mesh.matrix.clone().invert(), positions: number[] = [], uv: number[] = []
  for (const quad of quads) {
    const points = quad.map(point => point.clone().applyMatrix4(inverse))
    for (const i of [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]) {
      positions.push(...points[i].toArray()); uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0)
    }
  }
  const low = new THREE.BufferGeometry()
  low.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  low.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); low.computeVertexNormals()
  setModelDetail(mesh, low)
}

/** Double-sided thin equipment sheets need one broad surface, not two coincident
 * front/back copies. Keep the authored UVs and let the material face either view.
 * This is equipment-only; train, crowd and cutout-card topology stays separate.
 */
export function compactEquipmentSheets(root: THREE.Object3D): void {
  root.traverse(mesh => {
    if (!(mesh instanceof THREE.Mesh) || Array.isArray(mesh.material) || mesh.userData.staticInstances) return
    const material = mesh.material as THREE.MeshStandardMaterial
    if (material.side !== THREE.DoubleSide || material.alphaTest || material.alphaMap) return
    const source = mesh.userData.lowDetailGeometry as THREE.BufferGeometry | undefined
    if (!source || !(source.index?.count ?? source.getAttribute('position').count)) return
    const bounds = new THREE.Box3().setFromBufferAttribute(source.getAttribute('position') as THREE.BufferAttribute)
    const axes = bounds.getSize(new THREE.Vector3()).toArray().map((size, axis) => ({ size, axis })).sort((a, b) => a.size - b.size)
    if (axes[0].size > axes[1].size * .15) return
    const count = source.index?.count ?? source.getAttribute('position').count
    const normal = source.getAttribute('normal'), indices: number[] = []
    for (let i = 0; i < count; i += 3) {
      const vertex = source.index ? source.index.getX(i) : i
      if (normal.getComponent(vertex, axes[0].axis) > .9) for (let j = 0; j < 3; j++) indices.push(source.index ? source.index.getX(i + j) : i + j)
    }
    if (!indices.length || indices.length >= count) return
    const low = source.clone(); low.setIndex(indices); low.clearGroups(); setModelDetail(mesh, low)
  })
}

/** Palette fittings built from boxes: retain source UVs, colours and broad faces.
 * Thin sheets drop narrow edges; rods drop their small end caps. This is prepared
 * once by the dispatcher, before batching, and never changes source picking.
 */
export function preparePrimitiveModelDetail(root: THREE.Object3D): void {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.lowDetailGeometry || Array.isArray(object.material)) return
    const source = object.geometry
    if (!(source instanceof THREE.BoxGeometry)) return
    source.computeBoundingBox()
    const size = source.boundingBox!.getSize(new THREE.Vector3())
    const axes = size.toArray().map((size, axis) => ({ size, axis })).sort((a, b) => a.size - b.size)
    const sheet = axes[0].size <= axes[1].size * .25
    const axis = sheet ? axes[0].axis : axes[2].axis
    const normal = source.getAttribute('normal'), indices: number[] = []
    const count = source.index?.count ?? source.getAttribute('position').count
    for (let i = 0; i < count; i += 3) {
      const vertex = source.index ? source.index.getX(i) : i
      const aligned = Math.abs(normal.getComponent(vertex, axis)) > .9
      if (aligned === sheet) for (let j = 0; j < 3; j++) indices.push(source.index ? source.index.getX(i + j) : i + j)
    }
    if (!indices.length || indices.length >= count) return
    const low = source.clone()
    low.setIndex(indices)
    low.clearGroups()
    setModelDetail(object, low)
  })
}

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
export function omitModelDetail(root: THREE.Object3D, replace = false): void {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    if (object.userData.lowDetailGeometry && !replace) return
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
