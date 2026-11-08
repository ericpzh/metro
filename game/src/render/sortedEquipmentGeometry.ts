import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Keep per-surface culling and depth order in the index of a static batch. */
export function sortedEquipmentGeometry(parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const count = geometry.getAttribute('position').count
  const index = count > 65_536 ? new Uint32Array(count) : new Uint16Array(count)
  const attribute = new THREE.BufferAttribute(index, 1).setUsage(THREE.DynamicDrawUsage)
  geometry.setIndex(attribute)
  geometry.setDrawRange(0, 0)
  let first = 0
  const ranges = parts.flatMap((part, order) => {
    const count = part.getAttribute('position').count
    if (!count) return []
    part.computeBoundingSphere()
    const range = { first, end: first + count, bounds: part.boundingSphere!, order, depth: 0 }
    first = range.end
    return [range]
  })
  const view = new THREE.Matrix4(), clip = new THREE.Matrix4()
  const previousView = new THREE.Matrix4(), previousClip = new THREE.Matrix4()
  const frustum = new THREE.Frustum()
  let ready = false
  return {
    geometry,
    update(camera: THREE.Camera, mesh: THREE.Mesh) {
      view.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld)
      clip.multiplyMatrices(camera.projectionMatrix, view)
      if (ready && previousView.equals(view) && previousClip.equals(clip)) return
      ready = true
      previousView.copy(view)
      previousClip.copy(clip)
      frustum.setFromProjectionMatrix(clip, camera.coordinateSystem, camera.reversedDepth)
      const visible = ranges.filter(range => !mesh.frustumCulled || frustum.intersectsSphere(range.bounds))
      const matrix = view.elements
      for (const range of visible) {
        const { x, y, z } = range.bounds.center
        range.depth = matrix[2] * x + matrix[6] * y + matrix[10] * z
      }
      visible.sort((a, b) => a.depth - b.depth || a.order - b.order)
      let offset = 0
      for (const range of visible) {
        for (let vertex = range.first; vertex < range.end; vertex++) index[offset++] = vertex
      }
      geometry.setDrawRange(0, offset)
      attribute.needsUpdate = true
    },
  }
}
