import * as THREE from 'three'

/** Ten-degree front rake fades out at the square rear seam. Fittings and their
 * authored Low shapes use the same deformation, preserving glass embed depth. */
export function rakeCabFittings(parts: THREE.Mesh[], nose: number, outward: number): void {
  const point = new THREE.Vector3(), normal = new THREE.Vector3()
  for (const mesh of parts) {
    mesh.updateMatrix()
    const inverse = mesh.matrix.clone().invert()
    const rotation = new THREE.Matrix3().setFromMatrix4(mesh.matrix)
    const unrotate = rotation.clone().invert()
    const geometries = [mesh.geometry, mesh.userData.lowDetailGeometry as THREE.BufferGeometry | undefined]
    for (const geometry of geometries) {
      if (!geometry) continue
      const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal')
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrix)
        const distance = outward * (point.x - nose)
        const taper = THREE.MathUtils.clamp((distance + 2) / 1.1, 0, 1)
        const height = Math.max(0, point.z - 0.9)
        const dx = 1 - 0.18 * height * (distance > -2 && distance < -0.9 ? 1 / 1.1 : 0)
        if (normals) {
          normal.fromBufferAttribute(normals, i).applyMatrix3(rotation)
          normal.x /= dx
          normal.z += outward * 0.18 * taper * normal.x * (point.z > 0.9 ? 1 : 0)
          normal.applyMatrix3(unrotate).normalize()
          normals.setXYZ(i, normal.x, normal.y, normal.z)
        }
        point.x -= outward * 0.18 * height * taper
        point.applyMatrix4(inverse)
        positions.setXYZ(i, point.x, point.y, point.z)
      }
      positions.needsUpdate = true
      if (normals) normals.needsUpdate = true
      geometry.computeBoundingBox(); geometry.computeBoundingSphere()
    }
  }
}
