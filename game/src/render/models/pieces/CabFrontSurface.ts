import * as THREE from 'three'

const CELL = .125
const EPSILON = 1e-6
type Face = [THREE.Vector3, THREE.Vector3, THREE.Vector3]

/** Exact cab-skin intersections for its parallel fitting rays. Index the y/z
 * projection once, rather than walking the whole shell for every fitting vertex.
 * This retains the authored triangles and front-face test, including shoulders. */
export class CabFrontSurface {
  private readonly buckets = new Map<string, Face[]>()
  private readonly hit = new THREE.Vector3()

  constructor(geometry: THREE.BufferGeometry) {
    const positions = geometry.getAttribute('position'), index = geometry.index
    const count = index?.count ?? positions.count
    for (let i = 0; i < count; i += 3) {
      const face = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(i+j) : i+j)) as Face
      const minY = Math.floor((Math.min(...face.map(p => p.y))-EPSILON)/CELL)
      const maxY = Math.floor((Math.max(...face.map(p => p.y))+EPSILON)/CELL)
      const minZ = Math.floor((Math.min(...face.map(p => p.z))-EPSILON)/CELL)
      const maxZ = Math.floor((Math.max(...face.map(p => p.z))+EPSILON)/CELL)
      for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
        const key = `${y}:${z}`, bucket = this.buckets.get(key)
        if (bucket) bucket.push(face)
        else this.buckets.set(key, [face])
      }
    }
  }

  /** Ray is in the untransformed shell's frame, pointing along its negative x. */
  intersect(ray: THREE.Ray, target: THREE.Vector3): THREE.Vector3 | null {
    const faces = this.buckets.get(`${Math.floor(ray.origin.y/CELL)}:${Math.floor(ray.origin.z/CELL)}`)
    let nearest = Infinity
    for (const face of faces ?? []) {
      if (!ray.intersectTriangle(face[0], face[1], face[2], true, this.hit)) continue
      const distance = this.hit.distanceToSquared(ray.origin)
      if (distance < nearest) { nearest = distance; target.copy(this.hit) }
    }
    return nearest < Infinity ? target : null
  }
}
