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
// Low quality is also the game's performance mode. Larger buckets reduce draw
// submission cost there; High retains finer culling and preview locality.
const BATCH_TILE_SIZE: Record<GraphicsQuality, number> = { high: 16, low: 64 }
interface Source { mesh: THREE.Mesh; root: THREE.Object3D; matrix: THREE.Matrix4; signature: string; region: AtlasRegion | null; levels?: number[] }
interface Entry { signature: string; mesh: THREE.Mesh; sources: Source[]; detail?: GeometryDetail }
interface View { entries: Map<string, Entry>; sources: Set<THREE.Mesh>; buckets: Buckets | null; roots: Map<THREE.Object3D, RootSources> }
type Buckets = Map<string, { material: THREE.Material; sources: Source[] }>
interface RootSources { key: string; matrix: THREE.Matrix4; textures: Set<THREE.Texture>; buckets: Buckets | null }

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
 * Buckets are local to 16 m in High and 64 m in Low. Unchanged buckets keep their GPU allocations. */
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
  private rootSources = new WeakMap<THREE.Object3D, Map<string, RootSources>>()
  private sourceBuckets: Buckets | null = null
  private sourceRoots = new Map<THREE.Object3D, RootSources>()
  private retired = new Set<Entry>()
  private retirementJob: number | null = null
  private sourceTransforms = new Map<THREE.Mesh, boolean>()
  private sourceOnlyRoots = new Set<THREE.Object3D>()
  private rootCoverage = new WeakMap<THREE.Object3D, { entries: Entry[]; onlySources: boolean }>()
  private translatedRoots=new WeakMap<THREE.Object3D,THREE.Matrix4>()

  isFullyBatched(root:THREE.Object3D):boolean { return this.sourceOnlyRoots.has(root) }

  /** Move exclusively owned batches without rebuilding their baked buffers.
   * Shared buckets, changed parent transforms and unknown source state fail
   * closed. A later edit/view change rediscovers these roots at their new pose. */
  translateRoots(updates:readonly {root:THREE.Object3D;before:THREE.Matrix4;delta:THREE.Vector3}[]):boolean {
    if(!this.enabled)return false
    const moved=new Map<Entry,THREE.Vector3>()
    for(const {root,before,delta}of updates){
      const prepared=this.translatedRoots.get(root)??this.sourceRoots.get(root)?.matrix
      if(!prepared?.equals(before))return false
      for(const entry of this.entriesByRoot.get(root)??[]){
        if(entry.sources.some(source=>source.root!==root))return false
        moved.set(entry,delta)
      }
    }
    this.setHiddenModule(null)
    for(const [entry,delta]of moved)entry.mesh.position.add(delta)
    for(const {root}of updates){
      this.translatedRoots.set(root,root.matrixWorld.clone())
      this.rootSources.delete(root)
    }
    this.views.clear();this.revision=undefined;this.generation=undefined
    this.releaseUnusedEntries()
    return true
  }

  private restoreSourceTransforms(): void {
    for (const [mesh, automatic] of this.sourceTransforms) mesh.matrixAutoUpdate = automatic
    this.sourceTransforms.clear()
  }

  invalidateViews(retainSources = false): void {
    this.translatedRoots=new WeakMap()
    if (!retainSources) {
      this.rootSources = new WeakMap()
      this.rootCoverage = new WeakMap()
      this.sourceBuckets = null
      this.sourceRoots.clear()
    }
    this.detailView = []
    this.views.clear()
    this.revision = undefined
    this.generation = undefined
    this.releaseUnusedEntries()
  }

  /** Recent slices include the active one. Edits invalidate dormant GPU data. */
  private publish(revision: string | undefined, generation: string | undefined): void {
    // These leaves are immutable picking surfaces; moving rigs are excluded by
    // source discovery. Their local matrices were prepared by sync. Parent world
    // transforms still propagate normally, and the next sync restores the flags
    // before discovering any changed child transforms.
    for (const mesh of this.sources) {
      if (!this.sourceTransforms.has(mesh)) this.sourceTransforms.set(mesh, mesh.matrixAutoUpdate)
      mesh.matrixAutoUpdate = false
    }
    this.root.clear()
    this.entriesByRoot.clear()
    for (const entry of this.entries.values()) this.root.add(entry.mesh)
    for (const entry of this.entries.values()) for (const source of entry.sources) {
      const entries = this.entriesByRoot.get(source.root) ?? new Set<Entry>()
      entries.add(entry); this.entriesByRoot.set(source.root, entries)
    }
    this.sourceOnlyRoots.clear()
    for (const [root,entries] of this.entriesByRoot) {
      let coverage=this.rootCoverage.get(root)
      if(!coverage || coverage.entries.length!==entries.size || coverage.entries.some(entry=>!entries.has(entry))){
        let onlySources = true
        root.traverse(object => {
          if (object instanceof THREE.Mesh) {
            if (!object.layers.isEnabled(BATCH_SOURCE_LAYER)) onlySources = false
          } else if (!(object instanceof THREE.Group) && object.type !== 'Object3D') onlySources = false
        })
        coverage={entries:[...entries],onlySources};this.rootCoverage.set(root,coverage)
      }
      if (coverage.onlySources) this.sourceOnlyRoots.add(root)
    }
    if (generation !== undefined && revision !== undefined) {
      this.views.delete(revision)
      this.views.set(revision, { entries: this.entries, sources: this.sources, buckets: this.sourceBuckets, roots: this.sourceRoots })
      if (this.views.size > EQUIPMENT_VIEW_CACHE_SIZE) this.views.delete(this.views.keys().next().value!)
    }
    this.releaseUnusedEntries()
  }

  private releaseUnusedEntries(): void {
    const retained = new Set(this.entries.values())
    for (const view of this.views.values()) for (const entry of view.entries.values()) retained.add(entry)
    for (const entry of this.owned) if (!retained.has(entry)) {
      this.owned.delete(entry)
      if (typeof requestIdleCallback === 'function') this.retired.add(entry)
      else this.drop(entry)
    }
    this.scheduleRetirement()
  }

  private scheduleRetirement(): void {
    if (!this.retired.size || this.retirementJob !== null || typeof requestIdleCallback !== 'function') return
    this.retirementJob = requestIdleCallback(() => {
      this.retirementJob = null
      const until = performance.now() + 4
      for (const entry of this.retired) {
        this.retired.delete(entry); this.drop(entry)
        if (performance.now() >= until) break
      }
      this.scheduleRetirement()
    }, { timeout: 1000 })
  }

  setHiddenModule(root: THREE.Object3D | null): void {
    this.setHiddenModules(root ? [root] : [])
  }

  /** The renderer otherwise traverses every picking-only descendant, even when
   * its layer cannot draw. Keep source visibility intact outside this synchronous
   * render, and retain original drawing for animated or temporarily unbatched roots. */
  withHiddenSources(camera: THREE.Camera, draw: () => void): void {
    if (camera.layers.isEnabled(BATCH_SOURCE_LAYER)) { draw(); return }
    const hidden: THREE.Object3D[] = []
    for (const root of this.sourceOnlyRoots) {
      if (!root.visible || [...this.entriesByRoot.get(root)!].some(entry => this.masked.has(entry))) continue
      root.visible = false; hidden.push(root)
    }
    try { draw() } finally { for (const root of hidden) root.visible = true }
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

  sync(modules: THREE.Group, revision?: string, generation?: string, sourceView?: string): void {
    if (!this.enabled) { this.clear(); return }
    if (revision !== undefined && revision === this.revision && generation === this.generation) return
    this.translatedRoots=new WeakMap()
    const batchTileSize = BATCH_TILE_SIZE[this.graphicsQuality]
    this.restoreSourceTransforms()
    this.detailView = []
    this.setHiddenModule(null)
    if (generation === undefined || generation !== this.generation) this.views.clear()
    this.generation = generation
    this.revision = revision
    const cached = revision === undefined ? undefined : this.views.get(revision)
    if (cached) {
      for (const mesh of this.sources) mesh.layers.set(0)
      this.entries = cached.entries
      this.sources = cached.sources
      this.sourceBuckets = cached.buckets
      this.sourceRoots = cached.roots
      for (const mesh of this.sources) mesh.layers.set(BATCH_SOURCE_LAYER)
      this.publish(revision, generation)
      this.atlas.update()
      return
    }
    this.entries = new Map(this.entries)
    modules.updateWorldMatrix(true, sourceView === undefined)
    const textures = new Set<THREE.Texture>()
    const prepared = new Map<THREE.Object3D, RootSources>()
    for (const root of modules.children) {
      // The shared parent chain was updated once above. Rewalking it for each
      // of thousands of roots repeats the same station/scene matrix work.
      root.updateWorldMatrix(false, false)
      const key = `${sourceView}|${batchTileSize}|${root.visible}|${root.userData.levelZs}|${root.userData.groundBand}`
      const views = this.rootSources.get(root)
      let record = sourceView === undefined ? undefined : views?.get(key)
      if (!record || record.key !== key || !record.matrix.equals(root.matrixWorld)) {
        root.updateWorldMatrix(false, true)
        record = { key, matrix: root.matrixWorld.clone(), textures: new Set(), buckets: null }
        root.traverse(o => {
          if (o instanceof THREE.Mesh && !Array.isArray(o.material)) {
            const map = (o.material as THREE.MeshBasicMaterial).map
            if (map) record!.textures.add(map)
          }
        })
        if (sourceView !== undefined) {
          const retained = views ?? new Map<string, RootSources>()
          retained.set(key, record)
          if (retained.size > EQUIPMENT_VIEW_CACHE_SIZE) retained.delete(retained.keys().next().value!)
          this.rootSources.set(root, retained)
        }
      }
      prepared.set(root, record)
      for (const texture of record.textures) textures.add(texture)
    }
    this.atlas.retain(textures)
    // Immutable edits replace only affected roots. Remove their old bucket
    // contributions and merge their replacements; remote source lists and
    // geometry signatures remain exact without another station-wide walk.
    const retainedOrder = [...this.sourceRoots.keys()].filter(root=>prepared.get(root)===this.sourceRoots.get(root))
    const nextOrder = modules.children.filter(root=>prepared.get(root)===this.sourceRoots.get(root))
    const incremental = sourceView !== undefined && this.sourceBuckets !== null &&
      retainedOrder.every((root,i)=>root===nextOrder[i])
    const unchanged = new Set<THREE.Object3D>()
    if (incremental) for (const [root,record] of prepared)
      if (this.sourceRoots.get(root) === record) unchanged.add(root)
    if (incremental) this.sources = new Set(this.sources)
    else {
      for (const mesh of this.sources) mesh.layers.set(0)
      this.sources = new Set()
    }
    const buckets: Buckets = incremental ? new Map(this.sourceBuckets!) : new Map()
    const changed = new Set<string>()
    if (incremental) {
      const affected = new Set<string>()
      for (const [root,record] of this.sourceRoots) if (!unchanged.has(root)) {
        for (const [key,bucket] of record.buckets ?? []) {
          affected.add(key)
          for (const source of bucket.sources) {
            this.sources.delete(source.mesh); source.mesh.layers.set(0)
          }
        }
      }
      for (const key of affected) {
        const bucket = buckets.get(key)!
        const sources = bucket.sources.filter(s=>unchanged.has(s.root))
        if (sources.length) buckets.set(key,{material:bucket.material,sources})
        else buckets.delete(key)
        changed.add(key)
      }
    }
    const merge = (local: Buckets): void => {
      for (const [key, bucket] of local) {
        let existing = buckets.get(key)
        if (incremental && existing && !changed.has(key)) {
          existing = { material: existing.material, sources: [...existing.sources] }
          buckets.set(key, existing)
        }
        if (existing) existing.sources.push(...bucket.sources)
        else buckets.set(key, { material: bucket.material, sources: [...bucket.sources] })
        changed.add(key)
      }
    }
    for (const root of modules.children) {
      if (unchanged.has(root)) continue
      if (!STATIC_TYPES.has(root.userData.moduleType) || !root.visible) continue
      const record = prepared.get(root)!
      if (record.buckets) {
        merge(record.buckets)
        continue
      }
      const local: Buckets = new Map()
      const screen = root.userData.adScreen
      const moving = new Set<THREE.Object3D>()
      root.traverse(o => {
        if (o.userData.signalAspect) moving.add(o)
        for (const leaf of (o.userData.doors ?? []) as THREE.Object3D[]) moving.add(leaf)
        for (const pivot of [...(o.userData.clockRig?.hour ?? []), ...(o.userData.clockRig?.minute ?? [])]) moving.add(pivot)
        for (const key of ['wing', 'liftCabin', 'activityWater']) if (o.userData[key] instanceof THREE.Object3D) moving.add(o.userData[key])
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
        const key = `${Math.floor(p.x / batchTileSize)},${Math.floor(p.y / batchTileSize)}|${material.uuid}|${attributeKey(o.geometry)}|${o.renderOrder}|${o.castShadow}|${o.receiveShadow}|${o.frustumCulled}|${root.userData.levelZs}|${root.userData.groundBand}${instanceKey}|coherent:${o.userData.coherentModelDetail === true}`
        const bucket = local.get(key) ?? { material, sources: [] as Source[] }
        const matrix = o.matrixWorld.clone()
        bucket.sources.push({ mesh: o, root, matrix, signature: `${o.uuid}:${o.geometry.uuid}:${matrix.elements.join(',')}`, region, levels: root.userData.levelZs }); local.set(key, bucket)
      })
      record.buckets = local
      merge(local)
    }
    const alive = incremental ? new Set([...this.entries.keys()].filter(key=>!changed.has(key))) : new Set<string>()
    const rootOrder = new Map(modules.children.map((root,i)=>[root,i]))
    for (const [key, { material, sources }] of buckets) {
      if (incremental && !changed.has(key)) continue
      if (incremental) sources.sort((a,b)=>rootOrder.get(a.root)!-rootOrder.get(b.root)!)
      const coarse = sources.map(s => modelDetailGeometry(s.mesh))
      if (sources.length < 2 && !sources[0].mesh.userData.staticInstances && !coarse[0]) continue
      alive.add(key)
      const signature = `${material.transparent}|${coarse.map(g => g?.uuid ?? '').join(',')}|` + sources.map(s => s.signature).join('|')
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
    this.sourceBuckets = buckets
    this.sourceRoots = prepared
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
    this.restoreSourceTransforms()
    if (this.retirementJob !== null) cancelIdleCallback(this.retirementJob)
    this.retirementJob = null
    for (const entry of this.retired) this.drop(entry)
    this.retired.clear()
    this.rootSources = new WeakMap()
    this.rootCoverage = new WeakMap()
    this.sourceBuckets = null
    this.sourceRoots.clear()
    this.detailView = []
    this.setHiddenModule(null)
    this.revision = undefined
    for (const mesh of this.sources) mesh.layers.set(0)
    this.sources.clear()
    for (const entry of this.owned) this.drop(entry)
    this.owned.clear()
    this.entries.clear()
    this.entriesByRoot.clear()
    this.sourceOnlyRoots.clear()
    this.views.clear()
    this.generation = undefined
    this.atlas.dispose()
  }
}
