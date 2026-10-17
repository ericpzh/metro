import * as THREE from 'three'
import { OUTDOOR_TILE_DETAIL_PX, STATIC_DETAIL_HYSTERESIS } from '../sim/constants.ts'

/** Repeated static surfaces keep their original picking meshes on layer 31.
 * Transparent instances sort as whole source meshes, just like the unbatched view. */
export class StaticInstances extends THREE.InstancedMesh {
  private readonly detailed: THREE.BufferGeometry
  private readonly coarse: THREE.BufferGeometry | null
  private readonly minimal: THREE.BufferGeometry | null
  private minimalOn = false
  private readonly minimalThreshold: number
  private readonly transforms: THREE.Matrix4[]
  private order: number[]
  private sortedView: number[] = []
  private far = false
  private readonly centre = new THREE.Vector3()
  private readonly viewPosition = new THREE.Vector3()
  private readonly sourceSphere: THREE.Sphere
  private readonly sourceCentre: THREE.Vector3
  private readonly sortMatrix = new THREE.Matrix4()
  private readonly detailSize: number
  private readonly threshold: number

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], coarse?: THREE.BufferGeometry, detailSize = 1, threshold = OUTDOOR_TILE_DETAIL_PX, minimal?: THREE.BufferGeometry, minimalThreshold = 0) {
    const detailed = geometry.clone()
    super(detailed, material, matrices.length)
    this.detailed = detailed
    this.detailSize = detailSize; this.threshold = threshold
    this.coarse = coarse?.clone() ?? null
    this.minimal = minimal?.clone() ?? null; this.minimalThreshold = minimalThreshold
    this.transforms = matrices.map(m => m.clone())
    this.order = matrices.map((_, i) => i)
    matrices.forEach((m, i) => this.setMatrixAt(i, m))
    this.computeBoundingBox(); this.computeBoundingSphere()
    this.sourceSphere = this.boundingSphere!.clone()
    this.sourceCentre = detailed.boundingSphere!.center.clone()
  }

  /** Chunk-local, conservative distance: retain detail until even its near edge is small. */
  updateDetail(camera: THREE.Camera, height: number, extended = true): boolean {
    const sorted = this.sort(camera)
    if (!this.coarse) return sorted
    this.centre.copy(this.sourceSphere.center).applyMatrix4(this.matrixWorld)
    this.viewPosition.copy(this.centre).applyMatrix4(camera.matrixWorldInverse)
    const depth = Math.max((camera as THREE.PerspectiveCamera).near ?? .1, -this.viewPosition.z - this.sourceSphere.radius)
    const perspective = camera.projectionMatrix.elements[15] === 0
    const pixels = height * .5 * Math.abs(camera.projectionMatrix.elements[5]) * this.detailSize / (perspective ? depth : 1)
    const far = pixels < this.threshold * (this.far ? STATIC_DETAIL_HYSTERESIS : 1)
    const minimal = extended && far && this.minimal !== null && pixels < this.minimalThreshold * (this.minimalOn ? STATIC_DETAIL_HYSTERESIS : 1)
    if (far === this.far && minimal === this.minimalOn) return sorted
    this.far = far
    this.minimalOn = minimal
    this.geometry = minimal ? this.minimal! : far ? this.coarse : this.detailed
    // Both representations use the detailed bounds, so a LOD never changes culling.
    return true
  }

  private sort(camera: THREE.Camera): boolean {
    if (!(this.material as THREE.Material).transparent) return false
    const view = this.sortMatrix.multiplyMatrices(camera.matrixWorldInverse, this.matrixWorld).elements
    if (this.sortedView.length === view.length && this.sortedView.every((value, i) => Math.abs(value - view[i]) <= 1e-7)) return false
    this.sortedView = view.slice()
    const depth = (i: number) => {
      const m = this.transforms[i].elements
      const c = this.sourceCentre
      const x = m[0] * c.x + m[4] * c.y + m[8] * c.z + m[12]
      const y = m[1] * c.x + m[5] * c.y + m[9] * c.z + m[13]
      const z = m[2] * c.x + m[6] * c.y + m[10] * c.z + m[14]
      return view[2] * x + view[6] * y + view[10] * z + view[14]
    }
    const order = this.order.slice().sort((a, b) => depth(a) - depth(b) || a - b)
    if (order.every((value, i) => value === this.order[i])) return false
    order.forEach((source, i) => this.setMatrixAt(i, this.transforms[source]))
    this.instanceMatrix.needsUpdate = true
    this.order = order
    return true
  }

  override dispose(): void {
    this.detailed.dispose(); this.coarse?.dispose(); this.minimal?.dispose()
    super.dispose()
  }
}
