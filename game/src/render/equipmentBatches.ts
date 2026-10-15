import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { attributeKey, bakedGeometry, BATCH_SOURCE_LAYER, equalGeometry } from './batchGeometry.ts'
import { PanelAtlas, atlasUV } from './panelAtlas.ts'
import type { AtlasRegion } from './panelAtlas.ts'
import { sortedBatch } from './trainBatches.ts'

// No moving rigs: their screens, wings, hands and cabins keep live references.
// Static TV surrounds/sign faces can batch; the artwork window stays independent.
const STATIC_TYPES = new Set(['bench', 'fence', 'light', 'vent', 'cctv', 'bin', 'extinguisher', 'shelf',
  'desk', 'cubicle', 'sink', 'stair', 'track', 'pillar', 'roof', 'hanger', 'tactile', 'door', 'shop',
  'exit', 'guidepost', 'busstop', 'tvm', 'vending', 'ac-unit', 'electrical-cabinet', 'sign', 'tv', 'billboard',
  'calligraphy', 'linemap', 'monitor', 'clock', 'gate', 'platform-edge', 'psd-end', 'lift', 'escalator', 'booth', 'rail-signal', 'floor-mark', 'glass'])
interface Source { mesh: THREE.Mesh; matrix: THREE.Matrix4; region: AtlasRegion | null }
interface Entry { signature: string; mesh: THREE.Mesh; sources: Source[] }

/** Cross-module rendering; original surfaces and IDs remain the picking model.
 * Buckets are local to 16 m tiles. Unchanged buckets keep their GPU allocations. */
export class EquipmentBatches {
  enabled = true
  readonly root = new THREE.Group()
  readonly atlas = new PanelAtlas()
  private entries = new Map<string, Entry>()
  private sources = new Set<THREE.Mesh>()
  private revision: string | undefined
  private masked = new Set<Entry>()

  setHiddenModule(root: THREE.Object3D | null): void {
    for (const entry of this.masked) {
      entry.mesh.visible = true
      for (const source of entry.sources) source.mesh.layers.set(BATCH_SOURCE_LAYER)
    }
    this.masked.clear()
    if (!root) return
    for (const entry of this.entries.values()) {
      const contains = entry.sources.some(source => {
        for (let node: THREE.Object3D | null = source.mesh; node; node = node.parent) if (node === root) return true
        return false
      })
      if (!contains) continue
      entry.mesh.visible = false
      for (const source of entry.sources) source.mesh.layers.set(0)
      this.masked.add(entry)
    }
  }

  sync(modules: THREE.Group, revision?: string): void {
    if (!this.enabled) { this.clear(); return }
    if (revision !== undefined && revision === this.revision) return
    this.setHiddenModule(null)
    this.revision = revision
    for (const mesh of this.sources) mesh.layers.set(0)
    this.sources.clear()
    modules.updateWorldMatrix(true, true)
    const textures = new Set<THREE.Texture>()
    modules.traverse(o => {
      if (o instanceof THREE.Mesh && !Array.isArray(o.material)) {
        const map = (o.material as THREE.MeshBasicMaterial).map
        if (map) textures.add(map)
      }
    })
    this.atlas.retain(textures)
    const buckets = new Map<string, { material: THREE.Material; sources: Source[] }>()
    for (const root of modules.children) {
      if (!STATIC_TYPES.has(root.userData.moduleType) || !root.visible) continue
      const screen = root.userData.adScreen
      const moving = new Set<THREE.Object3D>()
      root.traverse(o => {
        for (const leaf of (o.userData.doors ?? []) as THREE.Object3D[]) moving.add(leaf)
        for (const pivot of [...(o.userData.clockRig?.hour ?? []), ...(o.userData.clockRig?.minute ?? [])]) moving.add(pivot)
        for (const key of ['wing', 'liftCabin']) if (o.userData[key] instanceof THREE.Object3D) moving.add(o.userData[key])
      })
      root.traverseVisible(o => {
        if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o instanceof THREE.SkinnedMesh || o instanceof THREE.BatchedMesh || Array.isArray(o.material) || o === screen) return
        if (o.children.length || Object.keys(o.geometry.morphAttributes).length || o.geometry.drawRange.start !== 0 || o.geometry.drawRange.count !== Infinity || o.layers.mask !== 1) return
        for (let parent: THREE.Object3D | null = o; parent && parent !== root; parent = parent.parent) if (moving.has(parent)) return
        const uv = o.geometry.getAttribute('uv')
        let boundedUV = !!uv
        if (uv) for (let i = 0; i < uv.count && boundedUV; i++) boundedUV = uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1
        const region = boundedUV ? this.atlas.resolve(o.material) : null
        const material = region?.material ?? o.material
        const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)
        const key = `${Math.floor(p.x / 16)},${Math.floor(p.y / 16)}|${material.uuid}|${attributeKey(o.geometry)}|${o.renderOrder}|${o.castShadow}|${o.receiveShadow}|${o.frustumCulled}|${root.userData.levelZs}|${root.userData.groundBand}`
        const bucket = buckets.get(key) ?? { material, sources: [] as Source[] }
        bucket.sources.push({ mesh: o, matrix: o.matrixWorld.clone(), region }); buckets.set(key, bucket)
      })
    }
    const alive = new Set<string>()
    for (const [key, { material, sources }] of buckets) {
      if (sources.length < 2) continue
      alive.add(key)
      const signature = `${material.transparent}|` + sources.map(s => `${s.mesh.uuid}:${s.mesh.geometry.uuid}:${s.matrix.elements.join(',')}`).join('|')
      const old = this.entries.get(key)
      if (old?.signature !== signature) {
        if (old) { this.drop(old.mesh); this.entries.delete(key) }
        const geometries = sources.map(s => {
          const g = bakedGeometry(s.mesh.geometry, s.matrix)
          if (s.region) atlasUV(g, s.region)
          return g
        })
        let mesh: THREE.Mesh
        // Repeated identical geometry can instance without duplicating vertex data.
        // Reflections and atlas regions use the baked path to retain their winding/UV.
        const identical = !material.transparent && sources.every(s => !s.region && s.matrix.determinant() > 0 && equalGeometry(s.mesh.geometry, sources[0].mesh.geometry))
        if (identical) {
          const instance = new THREE.InstancedMesh(sources[0].mesh.geometry.clone(), material, sources.length)
          sources.forEach((s, i) => instance.setMatrixAt(i, s.matrix))
          instance.computeBoundingBox(); instance.computeBoundingSphere(); mesh = instance
        } else if (material.transparent) mesh = sortedBatch(sources.map(s => s.mesh), geometries, material)
        else {
          const geometry = mergeGeometries(geometries)
          if (!geometry) { geometries.forEach(g => g.dispose()); alive.delete(key); continue }
          geometry.computeBoundingBox(); geometry.computeBoundingSphere(); mesh = new THREE.Mesh(geometry, material)
        }
        geometries.forEach(g => g.dispose())
        mesh.renderOrder = sources[0].mesh.renderOrder
        mesh.castShadow = sources[0].mesh.castShadow; mesh.receiveShadow = sources[0].mesh.receiveShadow
        mesh.frustumCulled = sources[0].mesh.frustumCulled
        if (mesh instanceof THREE.BatchedMesh) mesh.perObjectFrustumCulled = mesh.frustumCulled
        mesh.userData.equipmentBatch = true
        this.root.add(mesh); this.entries.set(key, { signature, mesh, sources })
      }
      for (const source of sources) { source.mesh.layers.set(BATCH_SOURCE_LAYER); this.sources.add(source.mesh) }
    }
    for (const [key, entry] of this.entries) if (!alive.has(key)) { this.drop(entry.mesh); this.entries.delete(key) }
    this.atlas.update()
  }

  private drop(mesh: THREE.Mesh): void {
    this.root.remove(mesh)
    if (mesh instanceof THREE.BatchedMesh) mesh.dispose()
    else { mesh.geometry.dispose(); if (mesh instanceof THREE.InstancedMesh) mesh.dispose() }
  }

  clear(): void {
    this.setHiddenModule(null)
    this.revision = undefined
    for (const mesh of this.sources) mesh.layers.set(0)
    this.sources.clear()
    for (const entry of this.entries.values()) this.drop(entry.mesh)
    this.entries.clear()
    this.atlas.dispose()
  }
}
