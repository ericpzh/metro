import * as THREE from 'three'

/** Remove buried/duplicate faces from intersecting opaque PSD fittings (§5.7). */
export function finishPsdHousing(group: THREE.Group): void {
  const boxes = group.children.filter((child): child is THREE.Mesh<THREE.BoxGeometry> =>
    child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry && child.userData.closedX === undefined)
    .map((mesh) => {
      mesh.updateMatrix()
      mesh.geometry.computeBoundingBox()
      return { mesh, box: mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrix) }
    })
  const axes = ['x', 'y', 'z'] as const
  const epsilon = 1e-6
  for (let i = 0; i < boxes.length; i++) {
    const { mesh, box } = boxes[i]
    const positions: number[] = [], normals: number[] = [], uvs: number[] = []
    const inverse = mesh.matrix.clone().invert()
    for (const axis of axes) for (const sign of [-1, 1]) {
      const plane = sign < 0 ? box.min[axis] : box.max[axis]
      const [u, v] = axes.filter((key) => key !== axis)
      let rectangles = [[box.min[u], box.min[v], box.max[u], box.max[v]]]
      for (let j = 0; j < boxes.length; j++) {
        if (i === j) continue
        const other = boxes[j].box
        if (plane < other.min[axis] - epsilon || plane > other.max[axis] + epsilon) continue
        const sameFace = Math.abs(plane - (sign < 0 ? other.min[axis] : other.max[axis])) < epsilon
        // Wider housings own a shared end face; equal profiles have one owner.
        if (sameFace && (other.max.y - other.min.y < box.max.y - box.min.y - epsilon ||
          (Math.abs(other.max.y - other.min.y - box.max.y + box.min.y) < epsilon && j > i))) continue
        const remaining: number[][] = []
        for (const [u0, v0, u1, v1] of rectangles) {
          const a = Math.max(u0, other.min[u]), b = Math.max(v0, other.min[v])
          const c = Math.min(u1, other.max[u]), d = Math.min(v1, other.max[v])
          if (c - a <= epsilon || d - b <= epsilon) { remaining.push([u0, v0, u1, v1]); continue }
          if (a - u0 > epsilon) remaining.push([u0, v0, a, v1])
          if (u1 - c > epsilon) remaining.push([c, v0, u1, v1])
          if (b - v0 > epsilon) remaining.push([a, v0, c, b])
          if (v1 - d > epsilon) remaining.push([a, d, c, v1])
        }
        rectangles = remaining
      }
      const normal = new THREE.Vector3()
      normal[axis] = sign
      normal.transformDirection(inverse)
      for (const [u0, v0, u1, v1] of rectangles) {
        const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([a, b]) => {
          const point = new THREE.Vector3()
          point[axis] = plane; point[u] = a; point[v] = b
          return point.applyMatrix4(inverse)
        })
        const forward = new THREE.Vector3().subVectors(corners[1], corners[0])
          .cross(new THREE.Vector3().subVectors(corners[2], corners[0])).dot(normal) > 0
        for (const vertex of forward ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
          positions.push(...corners[vertex].toArray())
          normals.push(...normal.toArray())
          uvs.push(vertex === 1 || vertex === 2 ? 1 : 0, vertex >= 2 ? 1 : 0)
        }
      }
    }
    mesh.geometry.setIndex(null)
    mesh.geometry.clearGroups()
    mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    mesh.geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    mesh.geometry.computeBoundingBox()
    mesh.geometry.computeBoundingSphere()
    if (!positions.length) { group.remove(mesh); mesh.geometry.dispose() }
  }
}
