import * as THREE from 'three'
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js'
import { EQUIPMENT_DETAIL_PX, EQUIPMENT_DETAIL_ERROR, EQUIPMENT_DETAIL_RATIO, EQUIPMENT_DETAIL_MIN_TRIANGLES, STATIC_DETAIL_HYSTERESIS } from '../sim/constants.ts'

let ready = false
/** Start once while assets decode; model generation remains synchronous. */
export const geometryDetailReady = (MeshoptSimplifier.ready ?? Promise.resolve()).then(() => { ready = MeshoptSimplifier.supported }, () => { ready = false })
const cache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry | null>()

/** A bounded-error distant approximation. Textures, rigs and source picks stay exact. */
export function coarseGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry | null {
  if (!ready) return null
  if (cache.has(source)) return cache.get(source)!
  const position = source.getAttribute('position')
  const count = source.index?.count ?? position?.count ?? 0
  if (!position || position.itemSize !== 3 || count / 3 < EQUIPMENT_DETAIL_MIN_TRIANGLES || Object.keys(source.morphAttributes).length ||
      Object.values(source.attributes).some(a => a instanceof THREE.BufferAttribute && a.usage !== THREE.StaticDrawUsage) ||
      source.drawRange.start !== 0 || source.drawRange.count !== Infinity || source.getAttribute('skinIndex')) return null
  const positions = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    positions[i * 3] = position.getX(i); positions[i * 3 + 1] = position.getY(i); positions[i * 3 + 2] = position.getZ(i)
  }
  const input = Uint32Array.from({ length: count }, (_, i) => source.index ? source.index.getX(i) : i)
  const target = Math.max(3, Math.floor(count * EQUIPMENT_DETAIL_RATIO / 3) * 3)
  const uv = source.getAttribute('uv')
  const attributes = new Float32Array(uv ? position.count * 2 : 0)
  if (uv) for (let i = 0; i < position.count; i++) { attributes[i * 2] = uv.getX(i); attributes[i * 2 + 1] = uv.getY(i) }
  const [indices] = uv
    ? MeshoptSimplifier.simplifyWithAttributes(input, positions, 3, attributes, 2, [.5, .5], null, target, EQUIPMENT_DETAIL_ERROR)
    : MeshoptSimplifier.simplify(input, positions, 3, target, EQUIPMENT_DETAIL_ERROR)
  let result: THREE.BufferGeometry | null = null
  if (indices.length >= 3 && indices.length < count * .8) {
    const [remap, vertices] = MeshoptSimplifier.compactMesh(indices)
    result = new THREE.BufferGeometry()
    for (const [name, a] of Object.entries(source.attributes)) {
      const attribute = new THREE.BufferAttribute(new (a.array.constructor as Float32ArrayConstructor)(vertices * a.itemSize), a.itemSize, a.normalized)
      for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) {
        for (let j = 0; j < a.itemSize; j++) attribute.setComponent(remap[i], j, a.getComponent(i, j))
      }
      result.setAttribute(name, attribute)
    }
    result.setIndex(new THREE.BufferAttribute(indices, 1))
    source.computeBoundingBox(); source.computeBoundingSphere()
    result.boundingBox = source.boundingBox!.clone(); result.boundingSphere = source.boundingSphere!.clone()
  }
  cache.set(source, result)
  source.addEventListener('dispose', () => { cache.get(source)?.dispose(); cache.delete(source) })
  return result
}

/** Allocations are prepared at build time; transitions only swap geometry/instance IDs. */
export class GeometryDetail {
  private far = false
  private readonly sphere: THREE.Sphere
  private readonly point = new THREE.Vector3()
  constructor(privateMesh: THREE.Mesh, size: number, switchGeometry: (far: boolean) => void, release: () => void = () => {}, bounds?: THREE.Sphere) {
    this.mesh = privateMesh; this.size = size; this.switchGeometry = switchGeometry; this.release = release
    const instanced = privateMesh as THREE.InstancedMesh
    if (bounds) this.sphere = bounds.clone()
    else if (instanced.isInstancedMesh || privateMesh instanceof THREE.BatchedMesh) {
      instanced.computeBoundingSphere()
      this.sphere = instanced.boundingSphere!.clone()
    } else {
      privateMesh.geometry.computeBoundingSphere(); this.sphere = privateMesh.geometry.boundingSphere!.clone()
    }
  }
  private readonly mesh: THREE.Mesh
  private readonly size: number
  private readonly switchGeometry: (far: boolean) => void
  private readonly release: () => void

  update(camera: THREE.Camera, height: number): boolean {
    const scale = this.mesh.matrixWorld.getMaxScaleOnAxis()
    this.point.copy(this.sphere.center).applyMatrix4(this.mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse)
    const depth = Math.max((camera as THREE.PerspectiveCamera).near ?? .1, -this.point.z - this.sphere.radius * scale)
    const pixels = height * .5 * Math.abs(camera.projectionMatrix.elements[5]) * this.size * scale /
      (camera.projectionMatrix.elements[15] === 0 ? depth : 1)
    const far = pixels < EQUIPMENT_DETAIL_PX * (this.far ? STATIC_DETAIL_HYSTERESIS : 1)
    if (far === this.far) return false
    this.far = far; this.switchGeometry(far); return true
  }
  dispose(): void { this.switchGeometry(false); this.release() }
}
