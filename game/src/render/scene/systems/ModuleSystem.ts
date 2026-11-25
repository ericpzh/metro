import { normalizeCityStyle } from '../../../sim/cityStyles.ts'
import { exitHeaderScale } from '../../exitHeaderResolution.ts'
// ModuleSystem — the placed equipment: building every module through the
// model factory, the contact blobs, plus the selection and
// collision highlights (moved verbatim from `render/scene.ts`: `buildModules`,
// `clearModules`, `setSelection`, `setCollisionHighlight`,
// `refreshCollisionHighlight`, `refreshSelection`).
//
// GAME-SPEC §3 item 6: modules are no longer unit cubes — `models.ts` gives
// each one a silhouette from the reference art. This system owns the module
// groups; the rigs a build discovers (lifts, gates, PSDs, screens, a 时钟's hand
// pivots) are handed to the Train/Lift/Crowd/Plate/Clock systems, which animate
// them.

import * as THREE from 'three'
import {
  cellEditInvalidatedModules,
  changedModules,
  isEquipmentContentEdit,
  moduleEditDelta,
  movedGuidepostIds,
  retainedModuleIds,
  sameModuleMetadata,
  signBoardsOnlyChange,
  translatedWalkwayIds,
} from '../../moduleDependencies.ts'

import { batchStaticModule } from '../../batchStaticModule.ts'
import { batchPlatformDoors } from '../../trainBatches.ts'
import { EquipmentBatches, type EquipmentSyncDelta } from '../../equipmentBatches.ts'
import { SourceGeometryDetail } from '../../sourceGeometryDetail.ts'
import { detailHeight } from '../../detailPolicy.ts'
import { ghostMaterial } from '../../materials.ts'
import { canRetainPaintedModules } from '../../retainPaintedModules.ts'
import { groundWindow, GROUND_Z } from '../../../sim/ground.ts'
import { getLanguage } from '../../../sim/i18n.ts'
import { populationEdit } from '../../../sim/populationEdit.ts'
import { presentationKeepIds } from '../../presentationEdit.ts'
import { prepareArtwork, repaintArtwork } from '../../artwork.ts'
import { localCellEdit } from '../../localCellEdit.ts'
import {
  buildModule,
  disposeObject,
} from '../../models.ts'
import type { ClockRig, EscalatorRoll, ModuleContext } from '../../models.ts'
import { isCeilingHung, isOutdoorSurface, isWallMounted, outdoorSurfaceHidden, outdoorSurfaceLift, trackBedKeys } from '../../../sim/placement.ts'
import { rotateLocal, trackFacing } from '../../../sim/track.ts'
import { tvPairSlot } from '../../../sim/tvs.ts'
import { blobRadius, moduleLevels, SceneSystem } from './SceneSystem.ts'
import { OUTDOOR_SURFACE_HEIGHT, STOREY_HEIGHT } from '../../../sim/constants.ts'
import { SurfaceBatches, SURFACE_BUCKET_SIZE } from '../../surfaceBatches.ts'
import type { SceneContext } from './SceneSystem.ts'
import { packKey, type Module, type StationData } from '../../../sim/types.ts'
import type { TrainSystem } from './TrainSystem.ts'
import type { LiftSystem } from './LiftSystem.ts'
import type { CrowdSystem } from './CrowdSystem.ts'
import type { PlateSystem } from './PlateSystem.ts'
import type { ClockSystem } from './ClockSystem.ts'
import { TV_FIRST_SWAP_MS, TV_SWAP_JITTER_MS } from './PlateSystem.ts'
import type { GhostSystem } from './GhostSystem.ts'

class ModuleRenderGroup extends THREE.Group {
  withVisibleRoots(draw: () => void): void {
    // Prune both the renderer's matrix walk and its render-list walk. Keep
    // ownership and the original picking list outside the synchronous draw.
    const roots = this.children
    this.children = this.visible ? roots.filter(root => root.visible) : []
    try { draw() } finally { this.children = roots }
  }
}

export class ModuleSystem extends SceneSystem {
  private retainedIds(data: StationData): Set<string> {
    return this.builtData && this.builtLanguage === getLanguage()
      ? retainedModuleIds(this.builtData, data) : new Set<string>()
  }
  private buildModel(mod: Module, ctx: ModuleContext): THREE.Object3D | null {
    return buildModule(mod, ctx)
  }
  private activityByRoot = new WeakMap<THREE.Object3D, {
    sinks: CrowdSystem['activitySinks']; doors: CrowdSystem['swingDoors']
  }>()
  presentationKeepIds(data: StationData): Set<string> | null {
    if (!this.builtData || this.builtLanguage !== getLanguage()) return null
    const edit = populationEdit(this.builtData, data)
    return edit ? presentationKeepIds(this.builtData, data, edit) : null
  }

  repaintPresentation(data: StationData, keep: Set<string>): Set<string> {
    const roots = new Map(this.moduleMeshes.children.map(g => [g.userData.moduleId, g]))
    const retained = new Set(keep)
    for (const mod of data.modules) {
      if (retained.has(mod.id)) continue
      const root = roots.get(mod.id)
      // Covered exits change their shell as well as their printed city identity.
      if (root?.userData.guideCityStyle && root.userData.guideCityStyle !== normalizeCityStyle(data.cityStyle)) continue
      if (root?.userData.exitCityStyle && root.userData.exitCityStyle !== normalizeCityStyle(data.cityStyle)) continue
      if (root?.userData.exitHeaderScale!==undefined && root.userData.exitHeaderScale !== exitHeaderScale(data.cityStyle)) continue
      if (root && repaintArtwork(root,data)) retained.add(mod.id)
    }
    return retained
  }
  /** Keep later equipment edits relative to the latest demand metadata, without
   * touching any model, batch, selection or allocation (§7). */
  updatePopulationData(data: StationData): boolean {
    if (!this.builtData || this.builtLanguage !== getLanguage() || !populationEdit(this.builtData, data)) return false
    this.builtData = data
    return true
  }
  private builtData: StationData | null = null
  private builtTrackCells: Set<string> | null = null
  private trackInputCells: StationData['cells'] | null = null
  private builtLanguage: ReturnType<typeof getLanguage> | null = null

  /** Keep the geometry and animated rigs when only unrelated floor ink changed. */
  retainPaintedModules(data: StationData): boolean {
    if (!this.builtData || this.builtLanguage !== getLanguage() || !canRetainPaintedModules(this.builtData, data)) return false
    this.builtData = data
    this.dirtyLevelRoots = new Set()
    return true
  }

  hasSameMetadata(data: StationData): boolean {
    return !!this.builtData && this.builtLanguage === getLanguage() && sameModuleMetadata(this.builtData, data)
  }

  /**
   * The one 指示牌 whose boards changed since the last build, or null — the
   * preview path a sign edit takes (`signBoardsOnlyChange`). Only a previous
   * build in the same language counts: translated plates are rebuilt whole.
   */
  signBoardsOnlyChanged(data: StationData): string | null {
    if (!this.builtData || this.builtLanguage !== getLanguage()) return null
    return signBoardsOnlyChange(this.builtData, data)
  }

  /**
   * An equipment edit changes module models without changing chunk geometry.
   * Functional pieces still rebuild worker routing; this only retains drawing.
   */
  equipmentOnlyChanged(data: StationData): boolean {
    this.classifyEquipment(data)
    return this.classifiedEquipment
  }

  equipmentContentChanged(data: StationData): boolean {
    this.classifyEquipment(data)
    return this.classifiedContent
  }
  private classifiedBefore: StationData | null = null
  private classifiedAfter: StationData | null = null
  private classifiedContent = false
  private classifiedEquipment = false
  private classifyEquipment(data: StationData): void {
    if (!this.builtData || this.builtLanguage !== getLanguage()) {
      this.classifiedBefore = this.classifiedAfter = null
      this.classifiedContent = this.classifiedEquipment = false
      return
    }
    if (this.classifiedBefore === this.builtData && this.classifiedAfter === data) return
    this.classifiedBefore = this.builtData; this.classifiedAfter = data
    this.classifiedContent = isEquipmentContentEdit(this.builtData, data)
    this.classifiedEquipment = this.classifiedContent && JSON.stringify(groundWindow(this.builtData.cells, this.builtData.modules)) === JSON.stringify(groundWindow(data.cells, data.modules))
  }
  readonly moduleMeshes = new ModuleRenderGroup()
  readonly moduleRootsById = new Map<string, THREE.Object3D>()
  readonly roadTrafficRoots = new Set<THREE.Object3D>()
  /** Non-surface children of `moduleMeshes`, in child order (equipment + contact blobs). */
  readonly equipmentRoots: THREE.Object3D[] = []
  /** Non-surface, non-blob module roots for fast transform checks and source detail. */
  private readonly moduleEquipmentRoots: THREE.Object3D[] = []
  private readonly contactBlobsByKey = new Map<string, THREE.InstancedMesh>()
  private readonly blobKeyByModuleId = new Map<string, string>()
  /** The instanced 草坪 / 人行道 layer: no per-tile mesh, source or contact blob. */
  readonly surfaces = new SurfaceBatches()
  /** Bumped when a paving tile root is built or dropped. */
  private surfaceRevision = 0
  readonly retainedLevelRoots = new Set<THREE.Object3D>()
  /** When non-null after a delta build, only these roots need level/clip updates on the same view. */
  dirtyLevelRoots: Set<THREE.Object3D> | null = null
  readonly batches = new EquipmentBatches()
  private readonly sourceDetail = new SourceGeometryDetail(true)
  private retainedBatches = false
  private batchView = ''
  private builtByType = new Map<Module['type'], Module[]>()
  private builtNonSurface: Module[] = []
  private builtSurfacesByXY: Map<number, Module[]> | null = null
  private builtIndexSource: readonly Module[] | null = null
  private equipmentGenerationRev = 0
  private pendingBatchDelta: { removed: Set<THREE.Object3D>; added: Set<THREE.Object3D>; appended: boolean } | null = null
  private batchDeltaValid = false
  private rootSnapshots = new WeakMap<THREE.Object3D, {
    px: number; py: number; pz: number
    rx: number; ry: number; rz: number
    sx: number; sy: number; sz: number
    vis: boolean; levelZs: unknown; groundBand: number | undefined
  }>()
  private movingModuleId: string | null = null
  private movingRoot: THREE.Object3D | null = null
  private movingVisible = false
  private movingBlob: { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 } | null = null
  private previewRoots: readonly THREE.Object3D[] = []
  private previewVisibility = new Map<THREE.Object3D, boolean>()

  private static packableXY(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= -4096 && x <= 4095 && y >= -4096 && y <= 4095
  }

  private surfaceAtXY(x: number, y: number): readonly Module[] | undefined {
    if (!this.builtSurfacesByXY || !ModuleSystem.packableXY(x, y)) return undefined
    return this.builtSurfacesByXY.get(packKey(x, y, 0))
  }

  private rebuildBuiltIndex(modules: readonly Module[]): void {
    this.builtByType.clear()
    this.builtNonSurface = []
    let surfacesByXY: Map<number, Module[]> | null = new Map()
    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i]
      let list = this.builtByType.get(mod.type)
      if (!list) this.builtByType.set(mod.type, list = [])
      list.push(mod)
      if (isOutdoorSurface(mod)) {
        if (surfacesByXY) {
          if (!ModuleSystem.packableXY(mod.x, mod.y)) surfacesByXY = null
          else {
            const k = packKey(mod.x, mod.y, 0)
            let slot = surfacesByXY.get(k)
            if (!slot) surfacesByXY.set(k, slot = [])
            slot.push(mod)
          }
        }
      } else {
        this.builtNonSurface.push(mod)
      }
    }
    this.builtSurfacesByXY = surfacesByXY
    this.builtIndexSource = modules
  }

  private patchBuiltIndex(goneModules: readonly Module[], rebuild: readonly Module[], nextModules: readonly Module[]): void {
    if (goneModules.length > 0) {
      const goneIds = new Set<string>()
      const affectedTypes = new Set<Module['type']>()
      let hadNonSurface = false
      for (const old of goneModules) {
        goneIds.add(old.id)
        affectedTypes.add(old.type)
        if (isOutdoorSurface(old)) {
          if (this.builtSurfacesByXY && ModuleSystem.packableXY(old.x, old.y)) {
            const k = packKey(old.x, old.y, 0)
            const slot = this.builtSurfacesByXY.get(k)
            if (slot) {
              const filtered = slot.filter(m => !goneIds.has(m.id))
              if (filtered.length) this.builtSurfacesByXY.set(k, filtered)
              else this.builtSurfacesByXY.delete(k)
            }
          }
        } else {
          hadNonSurface = true
        }
      }
      for (const type of affectedTypes) {
        const list = this.builtByType.get(type)
        if (!list) continue
        const filtered = list.filter(m => !goneIds.has(m.id))
        if (filtered.length) this.builtByType.set(type, filtered)
        else this.builtByType.delete(type)
      }
      if (hadNonSurface) this.builtNonSurface = this.builtNonSurface.filter(m => !goneIds.has(m.id))
    }
    for (const mod of rebuild) {
      let list = this.builtByType.get(mod.type)
      if (!list) this.builtByType.set(mod.type, list = [])
      list.push(mod)
      if (isOutdoorSurface(mod)) {
        if (this.builtSurfacesByXY) {
          if (!ModuleSystem.packableXY(mod.x, mod.y)) this.builtSurfacesByXY = null
          else {
            const k = packKey(mod.x, mod.y, 0)
            let slot = this.builtSurfacesByXY.get(k)
            if (!slot) this.builtSurfacesByXY.set(k, slot = [])
            slot.push(mod)
          }
        }
      } else {
        this.builtNonSurface.push(mod)
      }
    }
    this.builtIndexSource = nextModules
  }

  restoreMovingModule(): void {
    if (this.movingBlob) {
      const { mesh, index, matrix } = this.movingBlob
      mesh.setMatrixAt(index, matrix)
      mesh.instanceMatrix.addUpdateRange(index * 16, 16)
      mesh.instanceMatrix.needsUpdate = true
      this.movingBlob = null
    }
    if (this.movingRoot) this.movingRoot.visible = this.movingVisible
    this.movingRoot = null
    for (const [root, visible] of this.previewVisibility) root.visible = visible
    this.previewVisibility.clear()
    this.batches.setHiddenModule(null)
  }

  /** Replace only neighbouring fence models during a drag, without rebatching. */
  setPreviewModules(roots: readonly THREE.Object3D[]): void {
    this.restoreMovingModule()
    this.previewRoots = roots
    this.applyMovingModule()
  }

  setMovingModule(id: string | null): void {
    this.restoreMovingModule()
    this.movingModuleId = id
    this.refreshSelection()
    this.applyMovingModule()
  }

  private applyMovingModule(): void {
    const root = this.movingModuleId === null ? undefined
      : this.moduleRootsById.get(this.movingModuleId)
    if (root) {
      this.movingRoot = root
      this.movingVisible = root.visible
      root.visible = false
    }
    if (this.movingModuleId !== null) {
      const key = this.blobKeyByModuleId.get(this.movingModuleId)
      const candidates = key && this.contactBlobsByKey.has(key)
        ? [this.contactBlobsByKey.get(key)!]
        : this.contactBlobsByKey.values()
      for (const mesh of candidates) {
        const ids = mesh.userData.contactBlobIds as string[] | undefined
        const index = ids?.indexOf(this.movingModuleId) ?? -1
        if (index < 0) continue
        const matrix = new THREE.Matrix4()
        mesh.getMatrixAt(index, matrix)
        this.movingBlob = { mesh, index, matrix }
        mesh.setMatrixAt(index, new THREE.Matrix4().makeScale(0, 0, 0))
        mesh.instanceMatrix.addUpdateRange(index * 16, 16)
        mesh.instanceMatrix.needsUpdate = true
        break
      }
    }
    for (const preview of this.previewRoots) {
      if (preview === root) continue // The moving piece already owns its saved visibility.
      this.previewVisibility.set(preview, preview.visible)
      preview.visible = false
    }
    this.batches.setHiddenModules(root ? [root, ...this.previewRoots] : this.previewRoots)
    if (this.selectionHelper) this.selectionHelper.visible = this.selectedModuleId !== this.movingModuleId
  }

  syncBatches(): void {
    const batchView = `${this.ctx.activeZ}|${this.ctx.ghost}|${this.ctx.autoCeiling}|${this.ctx.hideWalls}|${this.ctx.hideGround}|${this.ctx.hideRoof}|${this.ctx.hideUI}|${this.ctx.cutaway}|${this.ctx.graphicsQuality}|${this.ctx.detailEnabled}|${this.surfaceRevision}`
    if (this.retainedBatches && this.batchView === batchView) {
      this.restoreMovingModule()
      this.applyMovingModule()
      this.ghost?.refreshFencePreviewLevels?.()
      return
    }
    this.batchView = batchView
    this.sourceDetail.restore()
    this.restoreMovingModule()
    this.batches.activeZ = this.ctx.activeZ
    this.batches.hideUI = this.ctx.hideUI
    this.batches.graphicsQuality = this.ctx.graphicsQuality ?? 'high'
    // Immutable module builds replace affected roots; view changes dress them.
    // A cell-only edit with identical roots/slice need not walk or copy them again.
    const view = `${this.ctx.activeZ}|${this.ctx.ghost}|${this.ctx.autoCeiling}|${this.ctx.hideWalls}|${this.ctx.hideGround}|${this.ctx.hideRoof}|${this.ctx.hideUI}|${this.ctx.cutaway}|${this.ctx.graphicsQuality ?? 'high'}`
    // Paving has its own revision and visibility key in SurfaceBatches.
    // Scan only non-surface equipment roots with zero string/array allocations
    // so both external transform edits and visibility changes stay exact.
    const delta = this.batchDeltaValid ? this.pendingBatchDelta : null
    let externalTransformChange = false
    let nonDeltaVisChange = false
    let visHash = 2166136261
    let visCount = 0
    const sameLevels = (a: unknown, b: unknown): boolean => {
      if (a === b) return true
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
      return true
    }
    for (let i = 0; i < this.moduleEquipmentRoots.length; i++) {
      const g = this.moduleEquipmentRoots[i]
      const px = g.position.x, py = g.position.y, pz = g.position.z
      const rx = g.rotation.x, ry = g.rotation.y, rz = g.rotation.z
      const sx = g.scale.x, sy = g.scale.y, sz = g.scale.z
      const vis = g.visible
      const lz = g.userData.levelZs
      const gb = g.userData.groundBand as number | undefined
      if (vis) {
        visCount++
        visHash = Math.imul(visHash ^ (i + 1), 16777619)
      }
      const snap = this.rootSnapshots.get(g)
      const inDeltaAdded = delta !== null && delta.added.has(g)
      if (!snap) {
        this.rootSnapshots.set(g, {
          px, py, pz, rx, ry, rz, sx, sy, sz, vis,
          levelZs: Array.isArray(lz) ? [...lz] : lz,
          groundBand: gb,
        })
        if (!inDeltaAdded) externalTransformChange = true
      } else {
        if (
          snap.px !== px || snap.py !== py || snap.pz !== pz ||
          snap.rx !== rx || snap.ry !== ry || snap.rz !== rz ||
          snap.sx !== sx || snap.sy !== sy || snap.sz !== sz ||
          snap.groundBand !== gb || !sameLevels(snap.levelZs, lz)
        ) {
          snap.px = px; snap.py = py; snap.pz = pz
          snap.rx = rx; snap.ry = ry; snap.rz = rz
          snap.sx = sx; snap.sy = sy; snap.sz = sz
          snap.groundBand = gb
          snap.levelZs = Array.isArray(lz) ? [...lz] : lz
          if (!inDeltaAdded) externalTransformChange = true
        }
        if (snap.vis !== vis) {
          snap.vis = vis
          if (!inDeltaAdded) nonDeltaVisChange = true
        }
      }
    }
    if (externalTransformChange) this.equipmentGenerationRev++
    const useDelta: EquipmentSyncDelta | undefined =
      delta !== null && !externalTransformChange && !nonDeltaVisChange ? delta : undefined
    this.pendingBatchDelta = null
    this.batchDeltaValid = false
    // Only pure storey changes may reuse prepared views. New roots, transforms,
    // global appearance toggles and clipping invalidate every dormant slice.
    const generation = this.ctx.cutaway ? undefined : `${this.ctx.autoCeiling}|${this.ctx.hideWalls}|${this.ctx.hideGround}|${this.ctx.hideRoof}|${this.ctx.hideUI}|${this.equipmentGenerationRev}`
    const revision = `${view}|${this.equipmentGenerationRev}|${visCount}:${visHash >>> 0}`
    this.batches.sync(this.moduleMeshes, revision, generation, view, this.equipmentRoots, useDelta)
    // Paving is drawn from its own instanced buckets: the bare tile roots above
    // carry only their storey/selection state.
    const data = this.ctx.stationData
    if (data) {
      this.surfaces.sync(
        this.moduleMeshes.children,
        data,
        this.ctx.modelMats.outdoorSurface,
        SURFACE_BUCKET_SIZE,
        `${view}|${this.surfaceRevision}`,
        {
          activeZ: this.ctx.activeZ,
          ghost: this.ctx.ghost,
          straight: this.ctx.hideUI || this.ctx.cutaway,
          ghostMaterial: base => ghostMaterial(base, this.ctx.dimMats),
        },
      )
    }
    for (const root of this.moduleEquipmentRoots) {
      if (this.batches.isFullyBatched(root)) continue
      this.applySourceDetail(root)
    }
    this.applyMovingModule()
    this.ghost?.refreshFencePreviewLevels?.()
  }
  applySourceDetail(root: THREE.Object3D): void {
    if (root.userData.surfaceTile === true) return
    const reduced = this.ctx.detailEnabled !== false && detailHeight(root.userData.levelZs,
      this.ctx.activeZ, this.ctx.hideUI, this.ctx.graphicsQuality ?? 'high', 1) === 0
    this.sourceDetail.apply(root, reduced)
  }

  /** The selected module's id and its highlight box, kept across a rebuild. */
  private selectedModuleId: string | null = null
  private selectionHelper: THREE.Box3Helper | null = null
  /** The equipment under the pointer in move, picker and select tools. */
  private hoverModuleId: string | null = null
  private hoverHelper: THREE.Box3Helper | null = null
  /** Ids of placed modules a blocked preview collides with, boxed in red. */
  private colliderIds: string[] = []
  private colliderHelpers: THREE.Box3Helper[] = []
  /** Committed fence groups; only adjacent joints are masked during a drag. */
  fenceGroups: THREE.Object3D[] = []
  readonly fenceGroupsById = new Map<string, THREE.Object3D>()
  /** Sibling systems a build hands rigs to; wired by the orchestrator. */
  trains!: TrainSystem
  lifts!: LiftSystem
  crowd!: CrowdSystem
  plates!: PlateSystem
  clocks!: ClockSystem
  ghost!: GhostSystem

  constructor(ctx: SceneContext) {
    super(ctx)
    this.moduleMeshes.addEventListener('childadded', ({ child }) => {
      if (child.userData.moduleType === 'road' || child.userData.roadSignals?.length) this.roadTrafficRoots.add(child)
      if (typeof child.userData.moduleId === 'string') this.moduleRootsById.set(child.userData.moduleId, child)
      if (typeof child.userData.contactBlobKey === 'string') {
        this.contactBlobsByKey.set(child.userData.contactBlobKey, child as THREE.InstancedMesh)
      }
      if (child.userData.surfaceTile !== true) {
        this.equipmentRoots.push(child)
        if (child.userData.contactBlobKey === undefined) {
          this.moduleEquipmentRoots.push(child)
          this.equipmentGenerationRev++
        }
      }
    })
    this.moduleMeshes.addEventListener('childremoved', ({ child }) => {
      this.roadTrafficRoots.delete(child)
      const id = child.userData.moduleId
      if (typeof id === 'string' && this.moduleRootsById.get(id) === child) this.moduleRootsById.delete(id)
      const blobKey = child.userData.contactBlobKey
      if (typeof blobKey === 'string' && this.contactBlobsByKey.get(blobKey) === child) {
        this.contactBlobsByKey.delete(blobKey)
      }
      if (child.userData.surfaceTile !== true) {
        const ei = this.equipmentRoots.indexOf(child)
        if (ei >= 0) this.equipmentRoots.splice(ei, 1)
        if (blobKey === undefined) {
          const mi = this.moduleEquipmentRoots.indexOf(child)
          if (mi >= 0) this.moduleEquipmentRoots.splice(mi, 1)
          this.equipmentGenerationRev++
        }
      }
    })
    this.ctx.scene.add(this.moduleMeshes)
    this.batches.root.matrixAutoUpdate = false
    this.ctx.scene.add(this.batches.root)
    this.ctx.scene.add(this.surfaces.root)
  }

  /** Instance meshes of the paving layer: the pointer, clip and teardown walk them. */
  surfaceMeshes(): THREE.Mesh[] {
    return this.surfaces.meshes()
  }

  /** Bare tile root: position and turn only, no geometry of its own. */
  private buildSurfaceRoot(mod: Module): THREE.Object3D {
    const root = new THREE.Object3D()
    root.position.set(mod.x + 0.5, mod.y + 0.5, mod.z + 1)
    if (mod.rot) root.rotation.z = (mod.rot * Math.PI) / 2
    root.userData.surfaceTile = true
    return root
  }

  /** The box a bare paving tile occupies, for selection and hover highlights. */
  private bareSurfaceBox(root: THREE.Object3D): THREE.Box3 {
    const p = root.position
    return new THREE.Box3(
      new THREE.Vector3(p.x - 0.5, p.y - 0.5, p.z),
      new THREE.Vector3(p.x + 0.5, p.y + 0.5, p.z + OUTDOOR_SURFACE_HEIGHT),
    )
  }

  /** Whether level slicing currently draws this placed module. */
  isModuleVisible(id: string): boolean {
    const root = this.moduleRootsById.get(id)
    if (!root) return false
    for (let node: THREE.Object3D | null = root; node; node = node.parent) {
      if (!node.visible) return false
    }
    return true
  }

  /**
   * Build every placed module through the model factory (§3 item 6). Modules are
   * no longer unit cubes: `models.ts` gives each one a silhouette from the
   * reference art, and the camera sees steel, glass, enamel and screens.
   *
   * `keepIds` overrides the dependency calculation: the named groups survive as
   * they stand, and only the rest is rebuilt. The sign-preview fast path uses it
   * to rebuild one board's model while retaining everything else.
   */
  buildModules(data: StationData, _trackCells: Set<number>, reuse = false, keepIds?: Set<string>): void {
    this.buildModuleStages(data, reuse, keepIds).next()
  }

  private computeContactBlob(mod: Module, group: THREE.Object3D): {
    key: string
    levelZ: number
    ground: number | undefined
    blob: [number, number, number, number, number?]
  } | null {
    if (group.userData.surfaceTile === true) return null
    const r = isCeilingHung(mod) || isWallMounted(mod) ? 0 : blobRadius(mod.type)
    if (r <= 0) return null
    const ground = this.ctx.groundOf.get(`${mod.x},${mod.y}`)
    // Match the model's foot plane. A blob sunk into the block becomes visible
    // through a triangular block's cut face instead of grounding the equipment.
    // Follow the rendered footprint, including edge offsets and rotation.
    let blob: [number, number, number, number, number?] = [mod.x + 0.5, mod.y + 0.5, mod.z + 1 + 0.012, r]
    if (mod.type !== 'tree') {
      let bounds = group.userData.contactShadowBounds as THREE.Box3 | undefined
      if (!bounds) {
        group.updateWorldMatrix(true, true)
        bounds = group.userData.contactShadowBounds = new THREE.Box3().setFromObject(group)
      }
      const width = bounds.max.x - bounds.min.x, depth = bounds.max.y - bounds.min.y
      const tightFootprint = mod.type === 'gate' || mod.type === 'shelf' || mod.type === 'bin' || mod.type === 'extinguisher'
      if (Number.isFinite(width + depth) && (tightFootprint || group.userData.contactShadowBase || Math.max(width, depth) > 1.1)) {
        const padding = tightFootprint ? 0.12 : 0.35
        blob = [(bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, mod.z + 1 + 0.012, (width + padding) / 1.24, (depth + padding) / 1.24]
      }
    }
    return { key: `${mod.z}|${ground ?? 'x'}`, levelZ: mod.z, ground, blob }
  }

  private applyIncrementalDelta(
    data: StationData,
    goneIds: ReadonlySet<string>,
    rebuild: readonly Module[],
    appendOnly: boolean,
    batchDoors: boolean,
    reuseTrackCells: boolean,
  ): void {
    this.batches.invalidateViews(true)
    this.ghost.clearFencePreview()
    const goneRoots: THREE.Object3D[] = []
    const goneModules: Module[] = []
    const goneTypes = new Set<string>()
    let surfaceChanged = false
    for (const id of goneIds) {
      const root = this.moduleRootsById.get(id)
      if (!root) continue
      goneRoots.push(root)
      if (root.userData.module) goneModules.push(root.userData.module as Module)
      if (root.userData.surfaceTile === true) surfaceChanged = true
      if (typeof root.userData.moduleType === 'string') goneTypes.add(root.userData.moduleType)
    }
    if (goneRoots.length > 0) {
      if (goneTypes.has('tv')) this.plates.retainTvPlates(data)
      if (goneTypes.has('sign')) this.plates.retainSignPlates(data)
      if (goneTypes.has('calligraphy') || goneTypes.has('linemap')) this.plates.retainDecorPlates(data)
      const droppedMats = new Set<THREE.Material>()
      for (const root of goneRoots) {
        for (const mat of (root.userData.ownedMaterials ?? []) as THREE.Material[]) droppedMats.add(mat)
      }
      if (droppedMats.size > 0) {
        for (const root of this.moduleEquipmentRoots) {
          if (goneIds.has(root.userData.moduleId)) continue
          for (const mat of (root.userData.ownedMaterials ?? []) as THREE.Material[]) droppedMats.delete(mat)
        }
        for (const mat of droppedMats) {
          const map = (mat as THREE.MeshBasicMaterial).map
          if (map && !this.plates.ownsTexture(map)) map.dispose()
          mat.dispose()
        }
        if (droppedMats.size > 0) this.ctx.ownedMats = this.ctx.ownedMats.filter(mat => !droppedMats.has(mat))
      }
    }
    const liftRigs = goneTypes.has('lift') ? new Map(this.lifts.liftRigs.map(r => [r.group, r])) : null
    const gateWings = goneTypes.has('gate') ? new Map(this.crowd.gateWings.map(r => [r.root, r])) : null
    const tvScreens = goneTypes.has('tv') ? new Map(this.plates.tvScreens.map(r => [r.moduleId, r])) : null
    const removedBatchRoots = new Set<THREE.Object3D>()
    const addedBatchRoots = new Set<THREE.Object3D>()
    for (const root of goneRoots) {
      if (root.userData.surfaceTile !== true) removedBatchRoots.add(root)
      disposeObject(root)
      this.moduleMeshes.remove(root)
    }
    if (goneRoots.length > 0) this.filterRegistrations(new Set(goneRoots), false)

    const trackCells = reuseTrackCells && this.builtTrackCells && this.trackInputCells === data.cells
      ? this.builtTrackCells : trackBedKeys(data.cells, data.modules)
    this.builtTrackCells = trackCells
    this.trackInputCells = data.cells
    const ctx: ModuleContext = {
      mats: this.ctx.modelMats,
      ads: this.ctx.ads,
      data,
      trackCells,
      finish: (id) => this.ctx.mats.finish(id),
      tvPlate: (id, x, y) => this.plates.makeTvPlate(id, x, y),
      tvPairSlot: (id) => tvPairSlot(id, data.modules),
      signFace: (id, layout, face, panel) => this.plates.makeSignPlate(id, layout, face, panel),
      calligraphyFace: (id, spec) => this.plates.makeCalligraphyPlate(id, spec),
      lineMapFace: (id, panel) => this.plates.makeLineMapPlate(id, panel),
      owned: this.ctx.ownedMats,
    }
    const dirtyLevelRoots = new Set<THREE.Object3D>()
    const builtPairs: Array<{ mod: Module; group: THREE.Object3D }> = []
    for (const mod of rebuild) {
      const ownedStart = this.ctx.ownedMats.length
      const surface = isOutdoorSurface(mod)
      const group = surface ? this.buildSurfaceRoot(mod) : this.buildModel(mod, ctx)
      if (!group) continue
      if (surface) surfaceChanged = true
      const footName = mod.type === 'gate' ? 'gate-plinth'
        : mod.type === 'hanger' ? 'hanger-base' : mod.type === 'cctv' ? 'cctv-post-base'
        : mod.type === 'traffic-light' ? 'traffic-light-base' : mod.type === 'rail-signal' ? 'signal-concrete-base' : undefined
      const foot = footName && group.getObjectByName(footName)
      if (foot) {
        group.updateWorldMatrix(true, true)
        group.userData.contactShadowBounds = new THREE.Box3().setFromObject(foot)
        group.userData.contactShadowBase = true
      }
      prepareArtwork(group)
      batchStaticModule(group, mod.type)
      if (mod.type === 'platform-edge' && batchDoors) batchPlatformDoors(group)
      group.userData.ownedMaterials = this.ctx.ownedMats.slice(ownedStart)
      group.userData.moduleId = mod.id
      group.userData.moduleType = mod.type
      group.userData.module = mod
      if (surface) {
        group.userData.surfaceHidden = outdoorSurfaceHidden(data.cells, data.modules, mod)
      }
      group.userData.roof = mod.type === 'roof'
      group.userData.suspendedCeiling = false
      group.userData.levelZs = moduleLevels(mod, this.ctx.levelBase, this.ctx.storeyHeight)
      group.userData.groundBand = this.ctx.groundOf.get(`${mod.x},${mod.y}`)
      this.moduleMeshes.add(group)
      dirtyLevelRoots.add(group)
      if (!surface) addedBatchRoots.add(group)
      if (mod.type === 'fence') {
        this.fenceGroups.push(group)
        this.fenceGroupsById.set(mod.id, group)
      }
      if (mod.type === 'escalator' || mod.type === 'walkway') {
        const roll = group.userData.escalator as EscalatorRoll | undefined
        if (roll) this.lifts.escalatorRolls.push(roll)
      }
      if (mod.type === 'rail-signal') this.plates.railSignals?.push({ group, at: [mod.x + 0.5, mod.y + 0.5, mod.z] })
      if (mod.type === 'clock') {
        const rig = group.userData.clockRig as ClockRig | undefined
        if (rig) this.clocks.clockRigs.push(rig)
      }
      if (mod.type === 'lift') {
        const cabin = group.userData.liftCabin as THREE.Object3D | undefined
        if (cabin) {
          const originZ = group.position.z
          this.lifts.liftRigs.push(liftRigs?.get(group) ?? { key: `${mod.x},${mod.y},${mod.from.z}`, group, cabin, originZ, baseFrom: originZ, baseTo: originZ, doorFrom: 0, doorTo: 0, side: 1, have: false })
        }
        group.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.isMesh) this.lifts.liftPickMeshes.push(mesh)
        })
      }
      if (mod.type === 'platform-edge') {
        const [fx, fy] = trackFacing(mod.rot)
        const [ox, oy] = rotateLocal(mod.rot, (mod.w - 1) / 2, 0)
        this.trains.psdGroups.push({ group, x: mod.x + 0.5 + ox, y: mod.y + 0.5 + oy, z: mod.z, half: mod.w / 2, fx, fy })
      }
      if (mod.type === 'billboard' || mod.type === 'tv') {
        const screen = group.userData.adScreen as THREE.Mesh | undefined
        if (screen) this.plates.adScreens.push(screen)
        if (mod.type === 'tv' && screen) {
          this.plates.tvScreens.push(tvScreens?.get(mod.id) ?? {
            screen,
            moduleId: mod.id,
            poster: String(screen.userData.adPoster ?? ''),
            nextAt: performance.now() + TV_FIRST_SWAP_MS + Math.random() * TV_SWAP_JITTER_MS,
          })
        }
      }
      if (mod.type === 'gate' && group.userData.wing) {
        const axisY = (mod.rot ?? 0) % 2 === 0
        this.crowd.gateWings.push(gateWings?.get(group) ?? { root: group, x: mod.x + 0.5, y: mod.y + 0.5, z: mod.z + 1, axisY, pending: 0, hold: 0, open: 0, target: 0 })
      }
      let activity = this.activityByRoot.get(group)
      if (!activity) {
        activity = { sinks: [], doors: [] }
        group.updateWorldMatrix(true, true)
        group.traverse(object => {
          if (object.userData.activityWater) {
            const at = object.getWorldPosition(new THREE.Vector3())
            activity!.sinks.push({ stream: object.userData.activityWater, x: at.x, y: at.y, z: at.z })
          }
          for (const rig of object.userData.swingDoors ?? []) {
            const at = rig.pivot.getWorldPosition(new THREE.Vector3())
            activity!.doors.push({
              pivot: rig.pivot, sign: rig.sign, x: at.x, y: at.y, z: at.z, open: 0, target: 0, occupied: false,
              ...(mod.type === 'cubicle' ? { cubicleX: mod.x + 0.5, cubicleY: mod.y + 0.5 } : {}),
            })
          }
        })
        this.activityByRoot.set(group, activity)
      }
      this.crowd.activitySinks.push(...activity.sinks)
      this.crowd.swingDoors.push(...activity.doors)
      builtPairs.push({ mod, group })
    }
    if (surfaceChanged) this.surfaceRevision++
    if (goneTypes.has('rail-signal') || rebuild.some(m => m.type === 'rail-signal')) {
      this.plates.updateRailSignals?.()
    }

    // Incrementally update contact blobs: preserve slot index on in-place move
    // and append order on add so updateRanges and capacity stay exact.
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const rebuiltSpecs = new Map<string, NonNullable<ReturnType<ModuleSystem['computeContactBlob']>> | null>()
    for (const { mod, group } of builtPairs) {
      rebuiltSpecs.set(mod.id, this.computeContactBlob(mod, group))
    }
    const inPlaceUpdated = new Set<string>()
    const dirtyBlobMinIdx = new Map<string, number>()
    const markBlobDirty = (key: string, idx: number): void => {
      const prev = dirtyBlobMinIdx.get(key)
      if (prev === undefined || idx < prev) dirtyBlobMinIdx.set(key, idx)
    }
    const newBlobEntries = new Map<string, { levelZ: number; ground: number | undefined; blobs: Array<[number, number, number, number, number?]>; ids: string[] }>()

    for (const id of goneIds) {
      const newSpec = rebuiltSpecs.get(id)
      const oldKey = this.blobKeyByModuleId.get(id)
      if (newSpec && oldKey === newSpec.key) {
        const inst = this.contactBlobsByKey.get(oldKey)
        const ids = inst?.userData.contactBlobIds as string[] | undefined
        const values = inst?.userData.contactBlobValues as Array<[number, number, number, number, number?]> | undefined
        const idx = ids?.indexOf(id) ?? -1
        if (inst && ids && values && idx >= 0) {
          const prev = values[idx]
          if (prev.length !== newSpec.blob.length || !prev.every((v, j) => v === newSpec.blob[j])) {
            values[idx] = newSpec.blob
            const [x, y, z, r, ry = r] = newSpec.blob
            m.compose(p.set(x, y, z), q, s.set(r, ry, 1))
            inst.setMatrixAt(idx, m)
            inst.instanceMatrix.addUpdateRange(idx * 16, 16)
            inst.instanceMatrix.needsUpdate = true
          }
          inPlaceUpdated.add(id)
        }
      }
    }
    for (const id of goneIds) {
      if (inPlaceUpdated.has(id)) continue
      const oldKey = this.blobKeyByModuleId.get(id)
      if (oldKey === undefined) continue
      this.blobKeyByModuleId.delete(id)
      const inst = this.contactBlobsByKey.get(oldKey)
      if (!inst) continue
      const ids = inst.userData.contactBlobIds as string[]
      const values = inst.userData.contactBlobValues as Array<[number, number, number, number, number?]>
      const idx = ids.indexOf(id)
      if (idx >= 0) {
        ids.splice(idx, 1)
        values.splice(idx, 1)
        markBlobDirty(oldKey, idx)
      }
    }
    for (const [id, spec] of rebuiltSpecs) {
      if (inPlaceUpdated.has(id) || !spec) continue
      this.blobKeyByModuleId.set(id, spec.key)
      const inst = this.contactBlobsByKey.get(spec.key)
      if (inst) {
        const ids = inst.userData.contactBlobIds as string[]
        const values = inst.userData.contactBlobValues as Array<[number, number, number, number, number?]>
        const idx = values.length
        ids.push(id)
        values.push(spec.blob)
        if (!dirtyBlobMinIdx.has(spec.key) && values.length <= inst.instanceMatrix.count) {
          const [x, y, z, r, ry = r] = spec.blob
          m.compose(p.set(x, y, z), q, s.set(r, ry, 1))
          inst.setMatrixAt(idx, m)
          inst.instanceMatrix.addUpdateRange(idx * 16, 16)
          inst.instanceMatrix.needsUpdate = true
          inst.count = values.length
        } else {
          markBlobDirty(spec.key, idx)
        }
      } else {
        let entry = newBlobEntries.get(spec.key)
        if (!entry) {
          entry = { levelZ: spec.levelZ, ground: spec.ground, blobs: [], ids: [] }
          newBlobEntries.set(spec.key, entry)
        }
        entry.blobs.push(spec.blob)
        entry.ids.push(id)
      }
    }
    for (const [key, minIdx] of dirtyBlobMinIdx) {
      const inst = this.contactBlobsByKey.get(key)
      if (!inst) continue
      const values = inst.userData.contactBlobValues as Array<[number, number, number, number, number?]>
      const ids = inst.userData.contactBlobIds as string[]
      if (values.length === 0) {
        disposeObject(inst)
        this.moduleMeshes.remove(inst)
        continue
      }
      if (values.length > inst.instanceMatrix.count || values.length < inst.instanceMatrix.count / 4) {
        const levelZ = (inst.userData.levelZs as number[])[0]
        const ground = inst.userData.groundBand as number | undefined
        disposeObject(inst)
        this.moduleMeshes.remove(inst)
        const nextInst = new THREE.InstancedMesh(
          new THREE.PlaneGeometry(1.24, 1.24),
          this.ctx.mats.equipmentBlob ?? this.ctx.mats.blob,
          THREE.MathUtils.ceilPowerOfTwo(Math.max(1, values.length)),
        )
        nextInst.renderOrder = 2
        nextInst.frustumCulled = false
        nextInst.userData.levelZs = [levelZ]
        nextInst.userData.groundBand = ground
        nextInst.userData.contactBlobKey = key
        nextInst.userData.ground = levelZ === GROUND_Z
        for (let i = 0; i < values.length; i++) {
          const [x, y, z, r, ry = r] = values[i]
          m.compose(p.set(x, y, z), q, s.set(r, ry, 1))
          nextInst.setMatrixAt(i, m)
        }
        nextInst.instanceMatrix.needsUpdate = true
        nextInst.userData.contactBlobValues = values
        nextInst.userData.contactBlobIds = ids
        nextInst.count = values.length
        this.moduleMeshes.add(nextInst)
        dirtyLevelRoots.add(nextInst)
      } else {
        for (let i = minIdx; i < values.length; i++) {
          const [x, y, z, r, ry = r] = values[i]
          m.compose(p.set(x, y, z), q, s.set(r, ry, 1))
          inst.setMatrixAt(i, m)
          inst.instanceMatrix.addUpdateRange(i * 16, 16)
        }
        if (minIdx < values.length) inst.instanceMatrix.needsUpdate = true
        inst.count = values.length
      }
    }
    for (const [key, entry] of newBlobEntries) {
      const nextInst = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1.24, 1.24),
        this.ctx.mats.equipmentBlob ?? this.ctx.mats.blob,
        THREE.MathUtils.ceilPowerOfTwo(Math.max(1, entry.blobs.length)),
      )
      nextInst.renderOrder = 2
      nextInst.frustumCulled = false
      nextInst.userData.levelZs = [entry.levelZ]
      nextInst.userData.groundBand = entry.ground
      nextInst.userData.contactBlobKey = key
      nextInst.userData.ground = entry.levelZ === GROUND_Z
      for (let i = 0; i < entry.blobs.length; i++) {
        const [x, y, z, r, ry = r] = entry.blobs[i]
        m.compose(p.set(x, y, z), q, s.set(r, ry, 1))
        nextInst.setMatrixAt(i, m)
      }
      nextInst.instanceMatrix.needsUpdate = true
      nextInst.userData.contactBlobValues = entry.blobs
      nextInst.userData.contactBlobIds = entry.ids
      nextInst.count = entry.blobs.length
      this.moduleMeshes.add(nextInst)
      dirtyLevelRoots.add(nextInst)
    }

    this.patchBuiltIndex(goneModules, rebuild, data.modules)
    this.retainedLevelRoots.clear()
    if (this.moduleMeshes.children.length <= 4096) {
      for (const root of this.moduleMeshes.children) {
        if (!dirtyLevelRoots.has(root)) this.retainedLevelRoots.add(root)
      }
    }
    this.dirtyLevelRoots = dirtyLevelRoots
    this.pendingBatchDelta = { removed: removedBatchRoots, added: addedBatchRoots, appended: appendOnly }
    this.batchDeltaValid = true
    this.builtData = data
    this.builtLanguage = getLanguage()
  }

  *buildModuleStages(data: StationData, reuse = false, keepIds?: Set<string>,
    structure?: (module: Module) => boolean,
    options?: { sliceBudgetMs?: number; batchDoors?: boolean }): Generator<void> {
    this.restoreMovingModule()
    this.retainedBatches = false
    this.dirtyLevelRoots = null
    this.pendingBatchDelta = null
    this.batchDeltaValid = false
    const batchDoors = options?.batchDoors ?? !structure

    // Fast path for bounded same-cells module edits and bounded local cell edits:
    // avoid 76k-module retention Sets, 76k Maps, and 76k groundOf string lookups.
    if (
      reuse && !keepIds && !structure && this.builtData && this.builtLanguage === getLanguage() &&
      this.builtIndexSource === this.builtData.modules &&
      (this.builtData.levelBase ?? 0) === this.ctx.levelBase &&
      (this.builtData.storeyHeight ?? STOREY_HEIGHT) === this.ctx.storeyHeight
    ) {
      if (data.cells === this.builtData.cells) {
        const changes = changedModules(this.builtData, data)
        const hasWalkwayOrGuidepost = changes.some(m => m.type === 'walkway' || m.type === 'guidepost')
        if (!hasWalkwayOrGuidepost) {
          const delta = moduleEditDelta(
            this.builtData,
            data,
            this.builtByType,
            this.builtNonSurface,
            this.builtSurfacesByXY ? (x, y) => this.surfaceAtXY(x, y) : undefined,
          )
          if (delta !== null && delta.goneIds.size + delta.rebuild.length <= 256) {
            if (delta.goneIds.size === 0 && delta.rebuild.length === 0) {
              this.dirtyLevelRoots = new Set()
              this.retainedLevelRoots.clear()
              if (this.moduleMeshes.children.length <= 4096) {
                for (const root of this.moduleMeshes.children) this.retainedLevelRoots.add(root)
              }
              this.builtData = data
              this.builtIndexSource = data.modules
              this.retainedBatches = true
              return
            }
            this.applyIncrementalDelta(
              data,
              delta.goneIds,
              delta.rebuild,
              delta.appendOnly,
              batchDoors,
              this.equipmentContentChanged(data),
            )
            return
          }
        }
      } else if (sameModuleMetadata(this.builtData, data)) {
        const local = localCellEdit(this.builtData, data)
        if (local !== null && this.builtSurfacesByXY) {
          const invalidated = cellEditInvalidatedModules(
            this.builtData,
            data,
            this.builtByType,
            (x, y) => this.surfaceAtXY(x, y),
          )
          if (invalidated !== null && invalidated.length <= 256) {
            let groundBandChanged = false
            if (this.moduleMeshes.children.length <= 4096) {
              for (const mod of data.modules) {
                const root = this.moduleRootsById.get(mod.id)
                if (root && root.userData.groundBand !== this.ctx.groundOf.get(`${mod.x},${mod.y}`)) {
                  groundBandChanged = true; break
                }
              }
            } else {
              const editedXY = new Set<number>()
              let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
              const addCol = (x: number, y: number): void => {
                if (!ModuleSystem.packableXY(x, y)) return
                editedXY.add(packKey(x, y, 0))
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
              }
              for (const c of local.removed) addCol(c.x, c.y)
              for (const c of local.added) addCol(c.x, c.y)
              if (editedXY.size > 0) {
                for (const mod of this.builtNonSurface) {
                  if (mod.x < minX || mod.x > maxX || mod.y < minY || mod.y > maxY) continue
                  if (!editedXY.has(packKey(mod.x, mod.y, 0))) continue
                  const root = this.moduleRootsById.get(mod.id)
                  if (root && root.userData.groundBand !== this.ctx.groundOf.get(`${mod.x},${mod.y}`)) {
                    groundBandChanged = true; break
                  }
                }
                if (!groundBandChanged) {
                  for (const c of [...local.removed, ...local.added]) {
                    const list = this.surfaceAtXY(c.x, c.y)
                    if (!list) continue
                    const g = this.ctx.groundOf.get(`${c.x},${c.y}`)
                    for (const mod of list) {
                      const root = this.moduleRootsById.get(mod.id)
                      if (root && root.userData.groundBand !== g) { groundBandChanged = true; break }
                    }
                    if (groundBandChanged) break
                  }
                }
              }
            }
            if (!groundBandChanged) {
              if (invalidated.length === 0) {
                this.retainedLevelRoots.clear()
                if (this.moduleMeshes.children.length <= 4096) {
                  for (const root of this.moduleMeshes.children) this.retainedLevelRoots.add(root)
                }
                this.dirtyLevelRoots = new Set()
                this.builtTrackCells = null
                this.builtData = data
                this.builtIndexSource = data.modules
                this.retainedBatches = true
                return
              }
              const goneIds = new Set(invalidated.map(m => m.id))
              this.builtTrackCells = null
              this.applyIncrementalDelta(data, goneIds, invalidated, false, batchDoors, false)
              return
            }
          }
        }
      }
    }

    // A new or rebuilt tile root is the only thing that invalidates the paving
    // layer by itself. A cell edit that changes a tile's support/opening input
    // rebuilds that root through `retainedModuleIds`; a remote cell edit leaves
    // the retained roots and their instances untouched.
    let surfaceChanged = false
    const retained = keepIds ?? (reuse ? this.retainedIds(data) : new Set<string>())
    const translated=reuse&&!keepIds&&this.builtData&&this.builtLanguage===getLanguage()?translatedWalkwayIds(this.builtData,data):new Set<string>()
    const relocated=reuse&&!keepIds&&this.builtData&&this.builtLanguage===getLanguage()?movedGuidepostIds(this.builtData,data):new Set<string>()
    const transforms:Array<{root:THREE.Object3D;before:THREE.Matrix4;delta:THREE.Vector3}>=[]
    if(translated.size&&this.builtData){
      const previous=new Map(this.builtData.modules.map(m=>[m.id,m]))
      for(const mod of data.modules)if(translated.has(mod.id)){
        const root=this.moduleRootsById.get(mod.id),old=previous.get(mod.id)!
        if(!root)continue
        root.updateWorldMatrix(true,false)
        const before=root.matrixWorld.clone(),position=root.getWorldPosition(new THREE.Vector3())
        root.position.x+=mod.x-old.x;root.position.y+=mod.y-old.y;root.position.z+=mod.z-old.z
        transforms.push({root,before,delta:root.getWorldPosition(new THREE.Vector3()).sub(position)})
        retained.add(mod.id)
      }
    }
    if (reuse && !keepIds && this.builtData && this.builtLanguage === getLanguage()) {
      const moved = relocated
      for (const mod of data.modules) if (moved.has(mod.id)) {
        const root = this.moduleRootsById.get(mod.id)
        if (!root) continue
        root.updateWorldMatrix(true,false)
        const before=root.matrixWorld.clone(),position=root.getWorldPosition(new THREE.Vector3())
        const rotation=root.quaternion.clone()
        root.position.set(mod.x + .5, mod.y + .5, mod.z + 1 + outdoorSurfaceLift(data.modules, mod))
        root.rotation.z = (mod.rot ?? 0) * Math.PI / 2
        if(root.quaternion.equals(rotation))
          transforms.push({root,before,delta:root.getWorldPosition(new THREE.Vector3()).sub(position)})
        retained.add(mod.id)
      }
    }
    const kept = new Map<string, THREE.Object3D>()
    const contactBlobs = new Map<string, THREE.InstancedMesh>()
    for (const root of this.moduleMeshes.children) {
      const id = root.userData.moduleId
      const blob = root.userData.contactBlobKey
      if (retained.has(id)) kept.set(id, root)
      if (typeof blob === 'string') contactBlobs.set(blob, root as THREE.InstancedMesh)
    }
    this.retainedLevelRoots.clear()
    // A remote cell edit can leave every model and its slice inputs intact.
    // Preserve the already dressed roots, animation registries and batch views;
    // a changed ground band still takes the ordinary registration/style path.
    const translationOnly=!!this.builtData&&data.cells===this.builtData.cells&&(translated.size>0||relocated.size>0)&&data.modules.length===this.builtData.modules.length&&
      this.builtData.modules.every((mod,i)=>mod===data.modules[i]||(translated.has(mod.id)||relocated.has(mod.id))&&mod.id===data.modules[i].id)
    if (this.builtData && retained.size === data.modules.length &&
      (translationOnly||sameModuleMetadata(this.builtData, data)) && data.modules.every(mod => {
        // A rigid equipment-only move leaves every other anchor, authored
        // floor and opening fixed. Street-window edges cannot reach those
        // anchors, which remain inside the content bounds plus its margin.
        if(translationOnly&&!translated.has(mod.id)&&!relocated.has(mod.id))return true
        const root = kept.get(mod.id)
        return !root || root.userData.groundBand === this.ctx.groundOf.get(`${mod.x},${mod.y}`)&&
          (!(translated.has(mod.id)||relocated.has(mod.id))||JSON.stringify(root.userData.levelZs)===JSON.stringify(moduleLevels(mod,this.ctx.levelBase,this.ctx.storeyHeight)))
      })&&(!relocated.size||this.moveGuidepostBlobs(this.builtData,data,relocated))) {
      for (const root of this.moduleMeshes.children) this.retainedLevelRoots.add(root)
      if (this.builtData.cells !== data.cells) this.builtTrackCells = null
      this.builtData = data
      this.rebuildBuiltIndex(data.modules)
      if (translationOnly) this.restoreMovingModule()
      this.retainedBatches = !translationOnly || transforms.length === translated.size + relocated.size && this.batches.translateRoots(transforms)
      return
    }
    // Retention has proved these roots' model inputs unchanged. Cache discovery
    // across cell edits too; rebuilt roots get fresh records and removed roots
    // leave the aggregate on the next sync.
    this.batches.invalidateViews(kept.size > 0)
    const sameLevelGrid = keepIds === undefined && this.builtData &&
      (this.builtData.levelBase ?? 0) === this.ctx.levelBase &&
      (this.builtData.storeyHeight ?? STOREY_HEIGHT) === this.ctx.storeyHeight
    for (const mod of data.modules) {
      const root = kept.get(mod.id)
      if (!root || root.userData.groundBand !== this.ctx.groundOf.get(`${mod.x},${mod.y}`)) continue
      if (sameLevelGrid && !translated.has(mod.id) && !relocated.has(mod.id)) {
        this.retainedLevelRoots.add(root)
        continue
      }
      const levels = moduleLevels(mod, this.ctx.levelBase, this.ctx.storeyHeight)
      if (levels.length === root.userData.levelZs?.length && levels.every((z, i) => z === root.userData.levelZs[i]))
        this.retainedLevelRoots.add(root)
    }
    const appendOnly = !!this.builtData && data.cells === this.builtData.cells &&
      this.equipmentContentChanged(data) && retained.size === this.builtData.modules.length &&
      data.modules.length > this.builtData.modules.length
    const liftRigs = new Map(this.lifts.liftRigs.map(r => [r.group, r]))
    const gateWings = new Map(this.crowd.gateWings.map(r => [r.root, r]))
    const tvScreens = new Map(this.plates.tvScreens.map(r => [r.moduleId, r]))
    if (appendOnly) this.ghost.clearFencePreview()
    else if (kept.size && this.retainedLevelRoots.size === kept.size &&
      (this.equipmentContentChanged(data) || keepIds === undefined))
      this.clearChangedRoots(data, kept)
    else this.clearModules(data, new Set([...kept.values(), ...contactBlobs.values()]), this.retainedLevelRoots)
    // The plates belong to the module groups just dropped, so they go with them —
    // otherwise every edit would leak one texture per 电视 or 指示牌.
    const trackCells = (appendOnly || this.equipmentContentChanged(data)) && this.builtTrackCells && this.trackInputCells===data.cells
      ? this.builtTrackCells : trackBedKeys(data.cells, data.modules)
    this.builtTrackCells=trackCells
    this.trackInputCells=data.cells
    const ctx: ModuleContext = {
      mats: this.ctx.modelMats,
      ads: this.ctx.ads,
      data,
      trackCells,
      finish: (id) => this.ctx.mats.finish(id),
      tvPlate: (id, x, y) => this.plates.makeTvPlate(id, x, y),
      tvPairSlot: (id) => tvPairSlot(id, data.modules),
      signFace: (id, layout, face, panel) => this.plates.makeSignPlate(id, layout, face, panel),
      calligraphyFace: (id, spec) => this.plates.makeCalligraphyPlate(id, spec),
      lineMapFace: (id, panel) => this.plates.makeLineMapPlate(id, panel),
      owned: this.ctx.ownedMats,
    }
    const blobsByKey = new Map<string, { levelZ: number; ground: number | undefined; blobs: Array<[number, number, number, number, number?]>; ids: string[] }>()
    if (appendOnly) for (const [key, inst] of contactBlobs) {
      blobsByKey.set(key, { levelZ: inst.userData.levelZs[0], ground: inst.userData.groundBand,
        blobs: [...inst.userData.contactBlobValues], ids: [...inst.userData.contactBlobIds] })
    }
    const addBlob = (mod: Module, group: THREE.Object3D): void => {
      const spec = this.computeContactBlob(mod, group)
      if (!spec) return
      const entry = blobsByKey.get(spec.key)
      if (entry) { entry.blobs.push(spec.blob); entry.ids.push(mod.id) }
      else blobsByKey.set(spec.key, { levelZ: spec.levelZ, ground: spec.ground, blobs: [spec.blob], ids: [mod.id] })
    }
    const sliceBudgetMs = options?.sliceBudgetMs ?? 0
    const initial = structure ? data.modules.filter(structure) : data.modules
    const deferred = structure ? data.modules.filter(module => !structure(module)) : []
    const ordered = structure ? [...initial, ...deferred] : initial
    let batchStart = performance.now()
    for (let index = 0; index < ordered.length; index++) {
      const mod = ordered[index]!
      if (structure && index >= initial.length && (index === initial.length || performance.now() - batchStart >= (sliceBudgetMs || 8))) {
        yield
        batchStart = performance.now()
      } else if (!structure && sliceBudgetMs > 0 && index > 0 && (index & 63) === 0 && performance.now() - batchStart >= sliceBudgetMs) {
        yield
        batchStart = performance.now()
      }
      if (appendOnly && kept.has(mod.id)) continue
      const existing=kept.get(mod.id)
      if (existing && this.retainedLevelRoots.has(existing)) {
        existing.userData.module = mod
        if (existing.userData.surfaceTile !== true) addBlob(mod, existing)
        continue
      }
      const ownedStart = this.ctx.ownedMats.length
      const surface = isOutdoorSurface(mod)
      const group = kept.get(mod.id) ?? (surface ? this.buildSurfaceRoot(mod) : this.buildModel(mod, ctx))
      if (!group) continue
      if (!kept.has(mod.id)) {
        if (surface) surfaceChanged = true
        // Capture the actual foot before static batching merges it into the upper geometry.
        const footName = mod.type === 'gate' ? 'gate-plinth'
          : mod.type === 'hanger' ? 'hanger-base' : mod.type === 'cctv' ? 'cctv-post-base'
          : mod.type === 'traffic-light' ? 'traffic-light-base' : mod.type === 'rail-signal' ? 'signal-concrete-base' : undefined
        const foot = footName && group.getObjectByName(footName)
        if (foot) {
          group.updateWorldMatrix(true, true)
          group.userData.contactShadowBounds = new THREE.Box3().setFromObject(foot)
          group.userData.contactShadowBase = true
        }
        prepareArtwork(group)
        batchStaticModule(group, mod.type)
        if (mod.type === 'platform-edge' && batchDoors) batchPlatformDoors(group)
        group.userData.ownedMaterials = this.ctx.ownedMats.slice(ownedStart)
      }
      group.userData.moduleId = mod.id
      group.userData.moduleType = mod.type
      group.userData.module = mod
      if (group.parent === this.moduleMeshes) this.moduleRootsById.set(mod.id, group)
      if (surface) {
        // Cached until this tile's own root is rebuilt: its supporting cell or an
        // opening over it is exactly what `retainedModuleIds` compares.
        group.userData.surfaceHidden = outdoorSurfaceHidden(data.cells, data.modules, mod)
      }
      group.userData.roof = mod.type === 'roof'
      // Ceiling-attached decor is never hidden by 隐藏天花板 (see LevelSystem): only the
      // ceiling tiles themselves (pass 'c' meshes) are. Keep the field for compatibility.
      group.userData.suspendedCeiling = false
      group.userData.levelZs = moduleLevels(mod, this.ctx.levelBase, this.ctx.storeyHeight)
      const ground = this.ctx.groundOf.get(`${mod.x},${mod.y}`)
      group.userData.groundBand = ground
      if (group.parent !== this.moduleMeshes) this.moduleMeshes.add(group)
      if (mod.type === 'fence') {
        this.fenceGroups.push(group)
        this.fenceGroupsById.set(mod.id, group)
      }
      if (mod.type === 'escalator' || mod.type === 'walkway') {
        const roll = group.userData.escalator as EscalatorRoll | undefined
        if (roll) this.lifts.escalatorRolls.push(roll)
      }
      if (mod.type === 'rail-signal') this.plates.railSignals?.push({ group, at: [mod.x + 0.5, mod.y + 0.5, mod.z] })
      if (mod.type === 'clock') {
        // The dial's two hands per face are pivots, not a pose: the clock system turns them
        // from the sim clock every frame (`ClockSystem.updateClocks`).
        const rig = group.userData.clockRig as ClockRig | undefined
        if (rig) this.clocks.clockRigs.push(rig)
      }
      if (mod.type === 'lift') {
        const cabin = group.userData.liftCabin as THREE.Object3D | undefined
        if (cabin) {
          // The model sinks its foot a centimetre below the floor plane; read
          // its own origin so the cabin travels on the same sunk shaft.
          const originZ = group.position.z
          this.lifts.liftRigs.push(liftRigs.get(group) ?? { key: `${mod.x},${mod.y},${mod.from.z}`, group, cabin, originZ, baseFrom: originZ, baseTo: originZ, doorFrom: 0, doorTo: 0, side: 1, have: false })
        }
        group.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.isMesh) this.lifts.liftPickMeshes.push(mesh)
        })
      }
      if (mod.type === 'platform-edge') {
        // Where this screen run sits, so the doors open with the consist
        // berthed at its own rail rather than any train of the line colour.
        const [fx, fy] = trackFacing(mod.rot)
        const [ox, oy] = rotateLocal(mod.rot, (mod.w - 1) / 2, 0)
        this.trains.psdGroups.push({ group, x: mod.x + 0.5 + ox, y: mod.y + 0.5 + oy, z: mod.z, half: mod.w / 2, fx, fy })
      }
      if (mod.type === 'billboard' || mod.type === 'tv') {
        const screen = group.userData.adScreen as THREE.Mesh | undefined
        if (screen) this.plates.adScreens.push(screen)
        if (mod.type === 'tv' && screen) {
          // The plate is the station information and never changes; only the
          // window (the content the network feed plays in) cycles.
          this.plates.tvScreens.push(tvScreens.get(mod.id) ?? {
            screen,
            moduleId: mod.id,
            poster: String(screen.userData.adPoster ?? ''),
            nextAt: performance.now() + TV_FIRST_SWAP_MS + Math.random() * TV_SWAP_JITTER_MS,
          })
        }
      }
      if (mod.type === 'gate') {
        if (group.userData.wing) {
          // The leaf's length runs along local x, so it blocks local y; a 90°
          // rotation swaps the world crossing axis to x.
          const axisY = (mod.rot ?? 0) % 2 === 0
          this.crowd.gateWings.push(gateWings.get(group) ?? { root: group, x: mod.x + 0.5, y: mod.y + 0.5, z: mod.z + 1, axisY, pending: 0, hold: 0, open: 0, target: 0 })
        }
      }
      // Retained roots have the same model inputs and world anchor. Discover
      // activity rigs once, including the common empty result, instead of
      // traversing the entire station's models again for one structural edit.
      let activity = this.activityByRoot.get(group)
      if (!activity) {
        activity = { sinks: [], doors: [] }
        group.updateWorldMatrix(true,true)
        group.traverse(object => {
          if (object.userData.activityWater) {
            const at=object.getWorldPosition(new THREE.Vector3())
            activity!.sinks.push({stream:object.userData.activityWater,x:at.x,y:at.y,z:at.z})
          }
          for (const rig of object.userData.swingDoors ?? []) {
            const at = rig.pivot.getWorldPosition(new THREE.Vector3())
            activity!.doors.push({pivot:rig.pivot,sign:rig.sign,x:at.x,y:at.y,z:at.z,open:0,target:0,occupied:false,
              ...(mod.type==='cubicle'?{cubicleX:mod.x+.5,cubicleY:mod.y+.5}:{})})
          }
        })
        this.activityByRoot.set(group, activity)
      }
      this.crowd.activitySinks.push(...activity.sinks)
      this.crowd.swingDoors.push(...activity.doors)
      addBlob(mod, group)
    }
    if (surfaceChanged) this.surfaceRevision++
    this.plates.updateRailSignals?.()
    // Contact blobs under floor-standing modules (§11), one retained batch per
    // level. Equipment edits update changed matrices, rather than recreating all
    // station shadows. Spare capacity avoids reallocating for each new piece.
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    for (const [key, entry] of blobsByKey) {
      const { levelZ, ground, blobs } = entry
      let inst = contactBlobs.get(key)
      contactBlobs.delete(key)
      if (inst && (blobs.length > inst.instanceMatrix.count || blobs.length < inst.instanceMatrix.count / 4)) {
        disposeObject(inst)
        this.moduleMeshes.remove(inst)
        inst = undefined
      }
      const previous = inst?.userData.contactBlobValues as Array<[number, number, number, number, number?]> | undefined
      if (!inst) inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.24, 1.24), this.ctx.mats.equipmentBlob ?? this.ctx.mats.blob, THREE.MathUtils.ceilPowerOfTwo(Math.max(1, blobs.length)))
      inst.renderOrder = 2
      inst.frustumCulled = false
      inst.userData.levelZs = [levelZ]
      inst.userData.groundBand = ground
      inst.userData.contactBlobKey = key
      inst.userData.ground = levelZ === GROUND_Z
      let changed = false
      for (let i = 0; i < blobs.length; i++) {
        const [x, y, z, r, ry = r] = blobs[i]
        if (previous?.[i]?.length === blobs[i].length && previous[i].every((value, j) => value === blobs[i][j])) continue
        m.compose(p.set(x, y, z), q, s.set(r, ry, 1))
        inst.setMatrixAt(i, m)
        // A new buffer uploads in full; ranges are only for subsequent edits.
        if (previous) inst.instanceMatrix.addUpdateRange(i * 16, 16)
        changed = true
      }
      if (changed) inst.instanceMatrix.needsUpdate = true
      inst.userData.contactBlobValues = blobs
      inst.userData.contactBlobIds = entry.ids
      inst.count = blobs.length
      if (inst.parent !== this.moduleMeshes) this.moduleMeshes.add(inst)
    }
    for (const inst of contactBlobs.values()) {
      disposeObject(inst)
      this.moduleMeshes.remove(inst)
    }
    this.blobKeyByModuleId.clear()
    for (const [key, entry] of blobsByKey) {
      for (const id of entry.ids) this.blobKeyByModuleId.set(id, key)
    }
    this.rebuildBuiltIndex(data.modules)
    this.builtData = data
    this.builtLanguage = getLanguage()
  }

  private moveGuidepostBlobs(before:StationData,after:StationData,ids:ReadonlySet<string>):boolean {
    const previous=new Map(before.modules.map(m=>[m.id,m]))
    const updates:Array<{mesh:THREE.InstancedMesh;values:Array<[number,number,number,number]>;index:number;value:[number,number,number,number]}>=[]
    for(const mod of after.modules)if(ids.has(mod.id)){
      const old=previous.get(mod.id)!,r=blobRadius(mod.type),ground=this.ctx.groundOf.get(`${mod.x},${mod.y}`)
      const mesh=this.contactBlobsByKey.get(`${mod.z}|${ground??'x'}`)
      const values=mesh?.userData.contactBlobValues as Array<[number,number,number,number]>|undefined
      const index=values?.findIndex(v=>v[0]===old.x+.5&&v[1]===old.y+.5&&v[2]===old.z+1+.012&&v[3]===r)??-1
      if(!mesh||!values||index<0)return false
      updates.push({mesh,values,index,value:[mod.x+.5,mod.y+.5,mod.z+1+.012,r]})
    }
    for(const {mesh,values,index,value} of updates){
      const [x,y,z,r]=value
      mesh.setMatrixAt(index,new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion(),new THREE.Vector3(r,r,r)))
      mesh.instanceMatrix.addUpdateRange(index*16,16);mesh.instanceMatrix.needsUpdate=true
      values[index]=value
    }
    return true
  }

  /**
   * Drop the last frame's module geometry and trains without touching materials.
   *
   * `data` is the document about to be built. A 电视 or 指示牌 that is still in it
   * draws the same plate, so its canvas, texture and material are **retained**
   * rather than disposed and re-minted — a rebuild used to re-mint ~1 MB of canvas
   * per 电视 and per sign face for an edit that touched one wall. (A 指示牌's retained
   * face is still *repainted* in place, `PlateSystem.redrawSignPlates`: what is kept
   * is the allocation, not the pixels.) Called with no document (scene teardown),
   * every plate goes.
   */
  clearModules(data?: StationData, kept = new Set<THREE.Object3D>(), registered = new Set<THREE.Object3D>()): void {
    this.retainedBatches=false
    this.dirtyLevelRoots=null
    this.pendingBatchDelta=null
    this.batchDeltaValid=false
    this.sourceDetail.restore()
    if (!data) {
      this.batches.clear()
      this.blobKeyByModuleId.clear()
      this.builtByType.clear()
      this.builtNonSurface = []
      this.builtSurfacesByXY = null
      this.builtIndexSource = null
    }
    this.builtData = null
    this.builtTrackCells=null
    this.trackInputCells=null
    this.ghost.clearFencePreview()
    if (data) {
      this.plates.retainTvPlates(data)
      this.plates.retainSignPlates(data)
      this.plates.retainDecorPlates(data)
    } else {
      // The per-piece plates are minted for the groups about to be dropped, so they
      // are released here rather than leaking one texture per 电视 or 指示牌 an edit
      // passes through.
      this.plates.clearTvPlates()
      this.plates.clearSignPlates()
      this.plates.clearDecorPlates()
    }
    // The materials a builder minted for this build (a 站台门 header, an 出入口
    // header, the 售票机 marquee, a 电视's lit face, a room's 招牌). They wrap a canvas
    // of their own, so keeping them — which is what `disposeObject` does with every
    // other material — would hold the pixels and the GL texture for the rest of the
    // session.
    const keptMaterials = new Set<THREE.Material>()
    for (const group of kept) for (const material of (group.userData.ownedMaterials ?? []) as THREE.Material[]) keptMaterials.add(material)
    for (const m of this.ctx.ownedMats) {
      if (keptMaterials.has(m)) continue
      const map = (m as THREE.MeshBasicMaterial).map
      // ...unless the canvas is a **plate**, which outlives the mesh it is printed
      // on: a 电视's lit face wraps the station plate `PlateSystem` retains across
      // rebuilds, and freeing it here would throw away the very redraw the retention
      // was for.
      if (map && !this.plates.ownsTexture(map)) map.dispose()
      m.dispose()
    }
    this.ctx.ownedMats = this.ctx.ownedMats.filter(m => keptMaterials.has(m))
    for (const child of [...this.moduleMeshes.children]) {
      if (kept.has(child)) continue
      if (child.userData.surfaceTile === true) this.surfaceRevision++
      disposeObject(child)
      this.moduleMeshes.remove(child)
    }
    this.filterRegistrations(registered,true)
  }

  /** Retire only owners that the dependency check could not retain. Remote
   * roots with unchanged slice inputs keep their animation registrations. */
  private clearChangedRoots(data:StationData,kept:ReadonlyMap<string,THREE.Object3D>):void {
    this.ghost.clearFencePreview()
    const gone=new Set(this.moduleMeshes.children.filter(root=>typeof root.userData.moduleId==='string'&&!kept.has(root.userData.moduleId)))
    if(!gone.size)return
    if([...gone].some(root=>root.userData.surfaceTile===true))this.surfaceRevision++
    const types=new Set([...gone].map(root=>root.userData.moduleType))
    if(types.has('tv'))this.plates.retainTvPlates(data)
    if(types.has('sign'))this.plates.retainSignPlates(data)
    if(types.has('calligraphy')||types.has('linemap'))this.plates.retainDecorPlates(data)
    const materials=new Set<THREE.Material>([...gone].flatMap(root=>root.userData.ownedMaterials??[]))
    if (materials.size) {
      for(const root of kept.values())for(const material of (root.userData.ownedMaterials??[]) as THREE.Material[])materials.delete(material)
      for(const material of materials){
        const map=(material as THREE.MeshBasicMaterial).map
        if(map&&!this.plates.ownsTexture(map))map.dispose()
        material.dispose()
      }
      this.ctx.ownedMats=this.ctx.ownedMats.filter(material=>!materials.has(material))
    }
    for(const root of gone){disposeObject(root);this.moduleMeshes.remove(root)}
    this.filterRegistrations(gone,false)
  }

  private filterRegistrations(registered:ReadonlySet<THREE.Object3D>,keep:boolean):void {
    // Unchanged roots retain their live animation records, not just their meshes.
    // Re-registering thousands of unrelated models costs work and resets door
    // state. Filter removed owners; the build loop registers replacements only.
    const retain=<T,>(items:T[],accepts:(item:T)=>boolean):void=>{
      let size=0
      for(const item of items)if(accepts(item))items[size++]=item
      items.length=size
    }
    const rolls=new Set([...registered].map(root=>root.userData.escalator))
    const clocks=new Set([...registered].map(root=>root.userData.clockRig))
    const screens=new Set([...registered].map(root=>root.userData.adScreen))
    const ids=new Set([...registered].map(root=>root.userData.moduleId))
    const sinks=new Set([...registered].flatMap(root=>this.activityByRoot.get(root)?.sinks??[]))
    const doors=new Set([...registered].flatMap(root=>this.activityByRoot.get(root)?.doors??[]))
    retain(this.fenceGroups,root=>keep===registered.has(root))
    for(const [id,root] of this.fenceGroupsById)if(keep!==registered.has(root))this.fenceGroupsById.delete(id)
    retain(this.lifts.escalatorRolls,roll=>keep===rolls.has(roll))
    retain(this.lifts.liftRigs,rig=>keep===registered.has(rig.group))
    retain(this.lifts.liftPickMeshes,mesh=>{
      for(let root:THREE.Object3D|null=mesh;root;root=root.parent)if(registered.has(root))return keep
      return !keep
    })
    retain(this.clocks.clockRigs,rig=>keep===clocks.has(rig))
    retain(this.crowd.gateWings,rig=>keep===registered.has(rig.root))
    retain(this.crowd.swingDoors,rig=>keep===doors.has(rig))
    retain(this.crowd.activitySinks,rig=>keep===sinks.has(rig))
    retain(this.trains.psdGroups,rig=>keep===registered.has(rig.group))
    retain(this.plates.adScreens,screen=>keep===screens.has(screen))
    retain(this.plates.tvScreens,screen=>keep===ids.has(screen.moduleId))
    if(this.plates.railSignals)retain(this.plates.railSignals,signal=>keep===registered.has(signal.group))
  }

  /**
   * Highlight one placed module with a world-space box, or clear it with null.
   * The id is remembered, so a `setStation` rebuild re-finds the module.
   */
  setSelection(moduleId: string | null): void {
    this.selectedModuleId = moduleId
    this.refreshSelection()
  }

  setHoverHighlight(moduleId: string | null): void {
    this.hoverModuleId = moduleId
    this.refreshHoverHighlight()
  }

  /** A bare paving tile has no mesh to box; its document footprint stands in. */
  private moduleBox(group: THREE.Object3D): THREE.Box3 {
    const box = new THREE.Box3().setFromObject(group)
    if (!box.isEmpty()) return box
    return group.userData.surfaceTile === true ? this.bareSurfaceBox(group) : box
  }

  refreshHoverHighlight(): void {
    if (this.hoverHelper) {
      this.ctx.scene.remove(this.hoverHelper)
      this.hoverHelper.geometry.dispose()
      ;(this.hoverHelper.material as THREE.Material).dispose()
      this.hoverHelper = null
    }
    const id = this.hoverModuleId
    if (!id || id === this.selectedModuleId) return
    const group = this.moduleRootsById.get(id)
    if (!group) return
    const box = this.moduleBox(group)
    if (box.isEmpty()) return
    box.expandByScalar(0.06)
    const helper = new THREE.Box3Helper(box, 0x55b6ff)
    helper.renderOrder = 4
    this.hoverHelper = helper
    this.ctx.scene.add(helper)
  }

  /**
   * Highlight the placed modules a blocked preview collides with — the
   * offending pieces beside the red ghost itself. Ids are remembered, so a
   * `setStation` rebuild re-finds the modules. Pass null or an empty list to
   * clear.
   */
  setCollisionHighlight(moduleIds: readonly string[] | null): void {
    const next = moduleIds ? [...new Set(moduleIds)] : []
    if (next.length === this.colliderIds.length && next.every((id, i) => id === this.colliderIds[i])) return
    this.colliderIds = next
    this.refreshCollisionHighlight()
  }

  refreshCollisionHighlight(): void {
    for (const helper of this.colliderHelpers) {
      this.ctx.scene.remove(helper)
      helper.geometry.dispose()
      ;(helper.material as THREE.Material).dispose()
    }
    this.colliderHelpers = []
    for (const id of this.colliderIds) {
      if (id === this.selectedModuleId) continue
      const group = this.moduleRootsById.get(id)
      if (!group) continue
      const box = this.moduleBox(group)
      if (box.isEmpty()) continue
      box.expandByScalar(0.06)
      const helper = new THREE.Box3Helper(box, 0xff5d5d)
      helper.renderOrder = 4
      this.colliderHelpers.push(helper)
      this.ctx.scene.add(helper)
    }
  }

  refreshSelection(): void {
    // Keep the line program and unit-box buffer alive while a lifted piece is
    // hidden. Disposing the last helper between pickup and drop makes the next
    // selection pay for the same shader compilation again.
    if (this.selectionHelper) this.selectionHelper.visible = false
    const id = this.selectedModuleId
    if (!id || id === this.movingModuleId) return
    const group = this.moduleRootsById.get(id)
    if (!group) return
    const box = this.moduleBox(group)
    if (box.isEmpty()) return
    box.expandByScalar(0.06)
    const helper=this.ensureSelectionHelper()
    helper.box.copy(box)
    helper.visible = true
  }

  private ensureSelectionHelper(): THREE.Box3Helper {
    if(!this.selectionHelper){
      this.selectionHelper=new THREE.Box3Helper(new THREE.Box3(),0x55b6ff)
      this.selectionHelper.renderOrder=4
      this.selectionHelper.visible=false
      this.ctx.scene.add(this.selectionHelper)
    }
    return this.selectionHelper
  }

  /** Include the selection line program in the station-opening offscreen pass.
   * Pickup hides the box, so its first visible use can otherwise be a drop. */
  prepareSelection(draw:(helper:THREE.Box3Helper)=>void):void {
    const helper=this.ensureSelectionHelper(),visible=helper.visible,culled=helper.frustumCulled
    helper.visible=true;helper.frustumCulled=false
    try{draw(helper)}finally{helper.visible=visible;helper.frustumCulled=culled}
  }

  /** Release the selection box. Mirrors the matching lines of the old `dispose()`. */
  disposeSelection(): void {
    if (this.selectionHelper) {
      this.ctx.scene.remove(this.selectionHelper)
      this.selectionHelper.geometry.dispose()
      ;(this.selectionHelper.material as THREE.Material).dispose()
      this.selectionHelper = null
    }
  }
}
