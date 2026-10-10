import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

/** Rounded nose with a square rear cut, meeting the car roof without overlapping skins. */
export function cabShellGeometry(width: number): THREE.BufferGeometry {
  const source = new RoundedBoxGeometry(2.8, width, 2.66, 5, 0.42)
  const positions = source.getAttribute('position')
  const normals = source.getAttribute('normal')
  const out: number[] = []
  const outNormals: number[] = []
  const cut = -0.6 // shell centre is 1.4 m inward; rear seam is 2 m inward
  type Vertex = { p: THREE.Vector3; n: THREE.Vector3 }
  for (let i = 0; i < positions.count; i += 3) {
    const triangle: Vertex[] = [0, 1, 2].map((j) => ({
      p: new THREE.Vector3().fromBufferAttribute(positions, i + j),
      n: new THREE.Vector3().fromBufferAttribute(normals, i + j),
    }))
    const polygon: Vertex[] = []
    for (let j = 0; j < 3; j++) {
      const a = triangle[j]
      const b = triangle[(j + 1) % 3]
      const insideA = a.p.x >= cut
      const insideB = b.p.x >= cut
      if (insideA) polygon.push(a)
      if (insideA !== insideB) {
        const t = (cut - a.p.x) / (b.p.x - a.p.x)
        polygon.push({ p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize() })
      }
    }
    for (let j = 1; j + 1 < polygon.length; j++) {
      for (const v of [polygon[0], polygon[j], polygon[j + 1]]) {
        out.push(v.p.x, v.p.y, v.p.z)
        outNormals.push(v.n.x, v.n.y, v.n.z)
      }
    }
  }
  source.dispose()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(outNormals, 3))
  return geometry
}
