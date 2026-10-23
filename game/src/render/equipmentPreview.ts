import * as THREE from 'three'
import { EquipmentBatches } from './equipmentBatches.ts'
import { SourceGeometryDetail } from './sourceGeometryDetail.ts'
import { GeometryDetail } from './geometryDetail.ts'
import { modelDetailGeometry } from './modelDetail.ts'
import { detailHeight, type GraphicsQuality } from './detailPolicy.ts'

interface DetailPolicy { activeZ: number; hideUI: boolean; graphicsQuality?: GraphicsQuality; detailEnabled?: boolean }

/** Carried and placed equipment use the same prepared batches, authored Low
 * geometry, distance thresholds and storey/quality policy. Own only preview
 * batches; the source root keeps ownership of its High and Low geometry. */
export class EquipmentPreview {
  readonly batches = new EquipmentBatches()
  private readonly sourceDetail = new SourceGeometryDetail()
  private readonly instances: Array<{ detail: GeometryDetail; levels?: number[]; coherent: boolean }> = []
  private sourcePolicy = ''
  private revision = 0
  private readonly source: THREE.Group

  constructor(source: THREE.Group) { this.source = source }

  sync(): void {
    this.sourceDetail.restore()
    for (const entry of this.instances) entry.detail.dispose()
    this.instances.length = 0
    this.sourcePolicy = ''
    this.source.updateMatrixWorld(true)
    this.batches.sync(this.source, String(++this.revision))
    this.batches.root.visible = this.source.visible
    for (const root of this.source.children) {
      if (!root.userData.previewInstances) continue
      root.traverse(object => {
        if (!(object instanceof THREE.InstancedMesh) || Array.isArray(object.material)) return
        const near = object.geometry, far = modelDetailGeometry(object)
        if (!far) return
        near.computeBoundingSphere()
        const size = near.boundingSphere!.radius * 2
        // Bounds include both authored shapes, as in EquipmentBatches.
        far.computeBoundingSphere()
        const bounds = near.boundingSphere!.clone().union(far.boundingSphere!)
        const combined = new THREE.Sphere(), transformed = new THREE.Sphere(), transform = new THREE.Matrix4()
        combined.makeEmpty()
        for (let i = 0; i < object.count; i++) {
          object.getMatrixAt(i, transform)
          combined.union(transformed.copy(bounds).applyMatrix4(transform))
        }
        this.instances.push({ levels: object.userData.previewLevels ?? root.userData.levelZs, coherent: object.userData.coherentModelDetail === true,
          detail: new GeometryDetail(object, size, reduced => { object.geometry = reduced ? far : near }, undefined, combined) })
      })
    }
  }

  update(policy: DetailPolicy, camera: THREE.Camera, viewportHeight: number, equipmentDetailEnabled = true): void {
    const { batches } = this
    batches.activeZ = policy.activeZ; batches.hideUI = policy.hideUI
    batches.graphicsQuality = policy.graphicsQuality ?? 'high'
    batches.detailEnabled = policy.detailEnabled !== false
    batches.equipmentDetailEnabled = equipmentDetailEnabled
    // Candidate transforms are baked at sync. Camera-only frames must not walk
    // every source fitting again; the normal scene pass updates animated rigs.
    batches.root.updateMatrixWorld(true)
    batches.updateDetail(camera, viewportHeight)
    const key = `${policy.activeZ}|${policy.hideUI}|${policy.graphicsQuality}|${policy.detailEnabled}`
    if (key !== this.sourcePolicy) {
      this.sourceDetail.restore()
      for (const root of this.source.children) {
        if (root.userData.previewInstances) continue
        const reduced = policy.detailEnabled !== false && detailHeight(root.userData.levelZs,
          policy.activeZ, policy.hideUI, policy.graphicsQuality ?? 'high', 1) === 0
        this.sourceDetail.apply(root, reduced)
      }
      this.sourcePolicy = key
    }
    for (const entry of this.instances) {
      const height = policy.detailEnabled !== false && equipmentDetailEnabled
        ? detailHeight(entry.levels, policy.activeZ, policy.hideUI, policy.graphicsQuality ?? 'high', viewportHeight) : Infinity
      entry.detail.update(camera, entry.coherent && height > 0 ? Infinity : height)
    }
  }

  clear(): void {
    this.sourceDetail.restore()
    for (const entry of this.instances) entry.detail.dispose()
    this.instances.length = 0
    this.batches.clear()
    this.batches.root.visible = false
    this.sourcePolicy = ''
  }

  dispose(): void { this.clear(); this.batches.root.removeFromParent() }
}
