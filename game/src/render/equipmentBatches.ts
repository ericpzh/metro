import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { attributeKey, bakedGeometry, BATCH_SOURCE_LAYER, equalGeometry } from './batchGeometry.ts'
import { PanelAtlas, atlasUV } from './panelAtlas.ts'
import type { AtlasRegion } from './panelAtlas.ts'
import { sortedBatch } from './trainBatches.ts'
import { StaticInstances } from './staticInstances.ts'
import { EQUIPMENT_VIEW_CACHE_SIZE } from '../sim/constants.ts'
import { GeometryDetail } from './geometryDetail.ts'
import { modelDetailGeometry } from './modelDetail.ts'
import { detailHeight } from './detailPolicy.ts'
import type { GraphicsQuality } from './detailPolicy.ts'

// No moving rigs: their screens, wings, hands and cabins keep live references.
// Static TV surrounds/sign faces can batch; the artwork window stays independent.
const STATIC_TYPES = new Set(['bench', 'fence', 'light', 'vent', 'cctv', 'bin', 'extinguisher', 'shelf',
  'desk', 'cubicle', 'sink', 'stair', 'track', 'pillar', 'roof', 'hanger', 'tactile', 'door', 'shop',
  'exit', 'guidepost', 'busstop', 'tvm', 'vending', 'ac-unit', 'electrical-cabinet', 'sign', 'tv', 'billboard',
  'calligraphy', 'linemap', 'monitor', 'clock', 'gate', 'platform-edge', 'psd-end', 'lift', 'escalator', 'walkway', 'booth', 'rail-signal', 'floor-mark', 'glass', 'sidewalk', 'lawn', 'tree'])
interface Source { mesh: THREE.Mesh; root: THREE.Object3D; matrix: THREE.Matrix4; region: AtlasRegion | null; levels?: number[] }
interface Entry { signature: string; mesh: THREE.Mesh; sources: Source[]; detail?: GeometryDetail }
interface View { entries: Map<string, Entry>; sources: Set<THREE.Mesh> }

/** A Low proxy can combine several fittings beyond its owner's Near surface. */
function combinedDetailBounds(near: THREE.BufferGeometry, far: THREE.BufferGeometry): THREE.Sphere {
  near.computeBoundingBox(); near.computeBoundingSphere()
  if (far.getAttribute('position').count) {
    far.computeBoundingBox(); far.computeBoundingSphere()
    if (!near.getAttribute('position').count) {
      near.boundingBox = far.boundingBox!.clone(); near.boundingSphere = far.boundingSphere!.clone()
    } else {
      near.boundingBox!.union(far.boundingBox!); near.boundingSphere!.union(far.boundingSphere!)
    }
  }
  far.boundingBox = near.boundingBox!.clone(); far.boundingSphere = near.boundingSphere!.clone()
  return near.boundingSphere!
}

/** Cross-module rendering; original surfaces and IDs remain the picking model.
 * Buckets are local to 16 m tiles. Unchanged buckets keep their GPU allocations. */
export class EquipmentBatches {
  enabled = true
  detailEnabled = true
  equipmentDetailEnabled = true
  activeZ = 0
  hideUI = false
  graphicsQuality: GraphicsQuality = 'high'
  readonly root = new THREE.Group()
  readonly atlas = new PanelAtlas()
  private entries = new Map<string, Entry>()
  private sources = new Set<THREE.Mesh>()
  private revision: string | undefined
  private masked = new Set<Entry>()
  private entriesByRoot = new Map<THREE.Object3D, Set<Entry>>()
  private views = new Map<string, View>()
  private generation: string | undefined
  private owned = new Set<Entry>()
  private detailView: number[] = []
  private detailHeight = NaN
  private detailPolicy = ''

  invalidateViews(): void {
    this.detailView = []
    this.views.clear()
    this.revision = undefined
    this.generation = undefined
    this.publish(undefined, undefined)
  }

  /** Recent slices include the active one. Edits invalidate dormant GPU data. */
  private publish(revision: string | undefined, generation: string | undefined): void {
    this.root.clear()
    this.entriesByRoot.clear()
    for (const entry of this.entries.values()) this.root.add(entry.mesh)
    for (const entry of this.entries.values()) for (const source of entry.sources) {
      const entries = this.entriesByRoot.get(source.root) ?? new Set<Entry>()
      entries.add(entry); this.entriesByRoot.set(source.root, entries)
    }
    if (generation !== undefined && revision !== undefined) {
      this.views.delete(revision)
      this.views.set(revision, { entries: this.entries, sources: this.sources })
      if (this.views.size > EQUIPMENT_VIEW_CACHE_SIZE) this.views.delete(this.views.keys().next().value!)
    }
    const retained = new Set(this.entries.values())
    for (const view of this.views.values()) for (const entry of view.entries.values()) retained.add(entry)
    for (const entry of this.owned) if (!retained.has(entry)) {
      this.drop(entry); this.owned.delete(entry)
    }
  }

  setHiddenModule(root: THREE.Object3D | null): void {
    this.setHiddenModules(root ? [root] : [])
  }

  /** Mask only the local buckets containing replaced preview pieces. Keep every
   * GPU allocation; other members of a masked bucket draw from retained sources. */
  setHiddenModules(roots: readonly THREE.Object3D[]): void {
    const next = new Set<Entry>()
    for (const root of roots) for (const entry of this.entriesByRoot.get(root) ?? []) next.add(entry)
    for (const entry of this.masked) {
      if (next.has(entry)) continue
      entry.mesh.visible = true
      for (const source of entry.sources) source.mesh.layers.set(BATCH_SOURCE_LAYER)
    }
    for (const entry of next) {
      if (this.masked.has(entry)) continue
      entry.mesh.visible = false
      for (const source of entry.sources) source.mesh.layers.set(0)
    }
    this.masked = next
  }

  sync(modules: THREE.Group, revision?: string, generation?: string): void {
    if (!this.enabled) { this.clear(); return }
    if (revision !== undefined && revision === this.revision && generation === this.generation) return
    this.detailView = []
    this.setHiddenModule(null)
    if (generation === undefined || generation !== this.generation) this.views.clear()
    this.generation = generation
    this.revision = revision
    for (const mesh of this.sources) mesh.layers.set(0)
    this.sources = new Set()
    const cached = revision === undefined ? undefined : this.views.get(revision)
    if (cached) {
      this.entries = cached.entries
      this.sources = cached.sources
      for (const mesh of this.sources) mesh.layers.set(BATCH_SOURCE_LAYER)
      this.publish(revision, generation)
      this.atlas.update()
      return
    }
    this.entries = new Map(this.entries)
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
        const instanceKey = o.userData.staticInstances ? `|static:${o.geometry.uuid}` : ''
        const key = `${Math.floor(p.x / 16)},${Math.floor(p.y / 16)}|${material.uuid}|${attributeKey(o.geometry)}|${o.renderOrder}|${o.castShadow}|${o.receiveShadow}|${o.frustumCulled}|${root.userData.levelZs}|${root.userData.groundBand}${instanceKey}|coherent:${o.userData.coherentModelDetail === true}`
        const bucket = buckets.get(key) ?? { material, sources: [] as Source[] }
        bucket.sources.push({ mesh: o, root, matrix: o.matrixWorld.clone(), region, levels: root.userData.levelZs }); buckets.set(key, bucket)
      })
    }
    const alive = new Set<string>()
    for (const [key, { material, sources }] of buckets) {
      const coarse = sources.map(s => modelDetailGeometry(s.mesh))
      if (sources.length < 2 && !sources[0].mesh.userData.staticInstances && !coarse[0]) continue
      alive.add(key)
      const signature = `${material.transparent}|${coarse.map(g => g?.uuid ?? '').join(',')}|` + sources.map(s => `${s.mesh.uuid}:${s.mesh.geometry.uuid}:${s.matrix.elements.join(',')}`).join('|')
      const old = this.entries.get(key)
      if (old?.signature !== signature) {
        if (old) this.entries.delete(key)
        let mesh: THREE.Mesh
        let detail: GeometryDetail | undefined
        const hasCoarse = coarse.some(Boolean)
        const size = Math.max(...sources.map(s => {
          s.mesh.geometry.computeBoundingSphere()
          return s.mesh.geometry.boundingSphere!.radius * 2 * s.matrix.getMaxScaleOnAxis()
        }))
        // Repeated identical geometry can instance without duplicating vertex data.
        // Reflections and atlas regions use the baked path to retain their winding/UV.
        const staticInstances = sources.every(s => s.mesh.userData.staticInstances === true)
        const identical = (!material.transparent || staticInstances) && sources.every((s, i) => !s.region && s.matrix.determinant() > 0 && equalGeometry(s.mesh.geometry, sources[0].mesh.geometry) &&
          (!!coarse[i] === !!coarse[0]) && (!coarse[i] || equalGeometry(coarse[i]!, coarse[0]!)))
        if (identical) {
          if (staticInstances) {
            const source = sources[0].mesh
            mesh = new StaticInstances(source.geometry, material, sources.map(s => s.matrix), source.userData.staticDetailGeometry,
              source.userData.staticDetailSize, source.userData.staticDetailPixels, source.userData.staticFarGeometry, source.userData.staticFarPixels)
          } else {
            const instance = new THREE.InstancedMesh(sources[0].mesh.geometry.clone(), material, sources.length)
            sources.forEach((s, i) => instance.setMatrixAt(i, s.matrix))
            instance.computeBoundingBox(); instance.computeBoundingSphere(); mesh = instance
            if (hasCoarse && coarse[0]) {
              const near = instance.geometry, far = coarse[0].clone()
              combinedDetailBounds(near, far); instance.computeBoundingBox(); instance.computeBoundingSphere()
              detail = new GeometryDetail(instance, size, distant => { instance.geometry = distant ? far : near }, () => far.dispose(), instance.boundingSphere!)
            }
          }
        } else {
          const geometries = sources.map(s => {
            const g = bakedGeometry(s.mesh.geometry, s.matrix)
            if (s.region) atlasUV(g, s.region)
            return g
          })
          const distant = hasCoarse ? sources.map((s, i) => {
            const g = bakedGeometry(coarse[i] ?? s.mesh.geometry, s.matrix)
            if (s.region) atlasUV(g, s.region)
            return g
          }) : []
          if (material.transparent) {
            mesh = sortedBatch(sources.map(s => s.mesh), geometries, material, distant)
            if (hasCoarse) {
              const batch = mesh as THREE.BatchedMesh
              const near = sources.map((_, i) => batch.getGeometryIdAt(i))
              const far = distant.map(g => batch.addGeometry(g))
              batch.computeBoundingBox(); batch.computeBoundingSphere()
              for (const geometry of distant) if (geometry.getAttribute('position').count) {
                geometry.computeBoundingBox(); geometry.computeBoundingSphere()
                batch.boundingBox!.union(geometry.boundingBox!); batch.boundingSphere!.union(geometry.boundingSphere!)
              }
              detail = new GeometryDetail(batch, size, useFar => {
                for (let i = 0; i < sources.length; i++) batch.setGeometryIdAt(i, (useFar ? far : near)[i])
              }, undefined, batch.boundingSphere!)
            }
          }
          else {
            const geometry = mergeGeometries(geometries)
            if (!geometry) { geometries.forEach(g => g.dispose()); alive.delete(key); continue }
            geometry.computeBoundingBox(); geometry.computeBoundingSphere(); mesh = new THREE.Mesh(geometry, material)
            if (hasCoarse) {
              const far = mergeGeometries(distant)!
              const bounds = combinedDetailBounds(geometry, far)
              const drawn = mesh
              detail = new GeometryDetail(drawn, size, useFar => { drawn.geometry = useFar ? far : geometry }, () => far.dispose(), bounds)
            }
          }
          distant.forEach(g => g.dispose())
          geometries.forEach(g => g.dispose())
        }
        mesh.renderOrder = sources[0].mesh.renderOrder
        mesh.castShadow = sources[0].mesh.castShadow; mesh.receiveShadow = sources[0].mesh.receiveShadow
        mesh.frustumCulled = sources[0].mesh.frustumCulled
        if (mesh instanceof THREE.BatchedMesh) mesh.perObjectFrustumCulled = mesh.frustumCulled
        mesh.userData.equipmentBatch = true
        const entry = { signature, mesh, sources, detail }
        this.entries.set(key, entry); this.owned.add(entry)
      }
      for (const source of sources) { source.mesh.layers.set(BATCH_SOURCE_LAYER); this.sources.add(source.mesh) }
    }
    for (const key of this.entries.keys()) if (!alive.has(key)) this.entries.delete(key)
    this.publish(revision, generation)
    this.atlas.update()
  }

  private drop(entry: Entry): void {
    entry.detail?.dispose()
    const mesh = entry.mesh
    this.root.remove(mesh)
    if (mesh instanceof THREE.BatchedMesh || mesh instanceof StaticInstances) mesh.dispose()
    else { mesh.geometry.dispose(); if (mesh instanceof THREE.InstancedMesh) mesh.dispose() }
  }

  updateDetail(camera: THREE.Camera, viewportHeight: number): boolean {
    const view = camera.matrixWorldInverse.elements, projection = camera.projectionMatrix.elements, world = this.root.matrixWorld.elements
    const policy = `${this.detailEnabled}|${this.equipmentDetailEnabled}|${this.activeZ}|${this.hideUI}|${this.graphicsQuality}`
    if (this.detailHeight === viewportHeight && this.detailPolicy === policy && this.detailView.length === 48 &&
      view.every((v, i) => Math.abs(v - this.detailView[i]) <= 1e-7) &&
      projection.every((v, i) => Math.abs(v - this.detailView[i + 16]) <= 1e-7) &&
      world.every((v, i) => Math.abs(v - this.detailView[i + 32]) <= 1e-7)) return false
    this.detailView = [...view, ...projection, ...world]; this.detailHeight = viewportHeight; this.detailPolicy = policy
    let changed = false
    for (const entry of this.entries.values()) if (entry.mesh instanceof StaticInstances) {
      const height = this.detailEnabled ? detailHeight(entry.sources[0].levels, this.activeZ, this.hideUI, this.graphicsQuality, viewportHeight) : Infinity
      changed = entry.mesh.updateDetail(camera, height, this.equipmentDetailEnabled) || changed
    }
    for (const entry of this.entries.values()) {
      // Composite proxies replace several source parts together. Independent
      // distance transitions would erase treads/ink or overlap two roof profiles.
      const height = this.detailEnabled && this.equipmentDetailEnabled ? detailHeight(entry.sources[0].levels, this.activeZ, this.hideUI, this.graphicsQuality, viewportHeight) : Infinity
      // Explicit Low/view reductions still select the complete proxy. Otherwise
      // retain every High member, even across separate spatial/material buckets.
      const coherentHeight = entry.sources[0].mesh.userData.coherentModelDetail && height > 0 ? Infinity : height
      changed = entry.detail?.update(camera, coherentHeight) || changed
    }
    return changed
  }

  clear(): void {
    this.detailView = []
    this.setHiddenModule(null)
    this.revision = undefined
    for (const mesh of this.sources) mesh.layers.set(0)
    this.sources.clear()
    for (const entry of this.owned) this.drop(entry)
    this.owned.clear()
    this.entries.clear()
    this.entriesByRoot.clear()
    this.views.clear()
    this.generation = undefined
    this.atlas.dispose()
  }
}
