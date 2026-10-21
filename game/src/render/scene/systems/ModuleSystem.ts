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

import { batchStaticModule } from '../../batchStaticModule.ts'
import { EquipmentBatches } from '../../equipmentBatches.ts'
import { SourceGeometryDetail } from '../../sourceGeometryDetail.ts'
import { detailHeight } from '../../detailPolicy.ts'
import { canRetainPaintedModules } from '../../retainPaintedModules.ts'
import { retainedModuleIds, sameModuleMetadata, signBoardsOnlyChange, isEquipmentModelEdit } from '../../moduleDependencies.ts'
import { getLanguage } from '../../../sim/i18n.ts'
import {
  buildModule,
  disposeObject,
} from '../../models.ts'
import type { ClockRig, EscalatorRoll, ModuleContext } from '../../models.ts'
import { trackBedKeys } from '../../../sim/placement.ts'
import { rotateLocal, trackFacing } from '../../../sim/track.ts'
import { tvPairSlot } from '../../../sim/tvs.ts'
import { blobRadius, moduleLevels, SceneSystem } from './SceneSystem.ts'
import type { SceneContext } from './SceneSystem.ts'
import type { StationData } from '../../../sim/types.ts'
import type { TrainSystem } from './TrainSystem.ts'
import type { LiftSystem } from './LiftSystem.ts'
import type { CrowdSystem } from './CrowdSystem.ts'
import type { PlateSystem } from './PlateSystem.ts'
import type { ClockSystem } from './ClockSystem.ts'
import { TV_FIRST_SWAP_MS, TV_SWAP_JITTER_MS } from './PlateSystem.ts'
import type { GhostSystem } from './GhostSystem.ts'
import { fenceConnectionIndex } from '../../../sim/fences.ts'

export class ModuleSystem extends SceneSystem {
  private builtData: StationData | null = null
  private builtLanguage: ReturnType<typeof getLanguage> | null = null

  /** Keep the geometry and animated rigs when only unrelated floor ink changed. */
  retainPaintedModules(data: StationData): boolean {
    if (!this.builtData || this.builtLanguage !== getLanguage() || !canRetainPaintedModules(this.builtData, data)) return false
    this.builtData = data
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
    if (!this.builtData || this.builtLanguage !== getLanguage()) return false
    return isEquipmentModelEdit(this.builtData, data)
  }
  moduleMeshes: THREE.Group = new THREE.Group()
  readonly batches = new EquipmentBatches()
  private readonly sourceDetail = new SourceGeometryDetail()
  private movingModuleId: string | null = null
  private movingRoot: THREE.Object3D | null = null
  private movingVisible = false
  private previewRoots: readonly THREE.Object3D[] = []
  private previewVisibility = new Map<THREE.Object3D, boolean>()

  restoreMovingModule(): void {
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
      : this.moduleMeshes.children.find(child => child.userData.moduleId === this.movingModuleId)
    if (root) {
      this.movingRoot = root
      this.movingVisible = root.visible
      root.visible = false
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
    this.sourceDetail.restore()
    this.restoreMovingModule()
    this.batches.activeZ = this.ctx.activeZ
    this.batches.hideUI = this.ctx.hideUI
    this.batches.graphicsQuality = this.ctx.graphicsQuality ?? 'high'
    // Immutable module builds replace affected roots; view changes dress them.
    // A cell-only edit with identical roots/slice need not walk or copy them again.
    const view = `${this.ctx.activeZ}|${this.ctx.ghost}|${this.ctx.autoCeiling}|${this.ctx.hideWalls}|${this.ctx.hideGround}|${this.ctx.hideRoof}|${this.ctx.hideUI}|${this.ctx.cutaway}`
    const roots = this.moduleMeshes.children.filter(g => typeof g.userData.moduleId === 'string')
      .map(g => `${g.uuid}:${g.position.toArray()}:${g.rotation.toArray()}:${g.scale.toArray()}:${g.userData.levelZs}:${g.userData.groundBand}`).join('|')
    const visibility = this.moduleMeshes.children.map(g => +g.visible).join('')
    // Only pure storey changes may reuse prepared views. New roots, transforms,
    // global appearance toggles and clipping invalidate every dormant slice.
    const generation = this.ctx.cutaway ? undefined : `${this.ctx.autoCeiling}|${this.ctx.hideWalls}|${this.ctx.hideGround}|${this.ctx.hideRoof}|${this.ctx.hideUI}|${roots}`
    this.batches.sync(this.moduleMeshes, `${view}|${visibility}|${roots}`, generation)
    for (const root of this.moduleMeshes.children) {
      const reduced = this.ctx.detailEnabled !== false && detailHeight(root.userData.levelZs,
        this.ctx.activeZ, this.ctx.hideUI, this.ctx.graphicsQuality ?? 'high', 1) === 0
      this.sourceDetail.apply(root, reduced)
    }
    this.applyMovingModule()
    this.ghost?.refreshFencePreviewLevels?.()
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
    this.ctx.scene.add(this.moduleMeshes)
    this.ctx.scene.add(this.batches.root)
  }

  /** Whether level slicing currently draws this placed module. */
  isModuleVisible(id: string): boolean {
    const root = this.moduleMeshes.children.find((child) => child.userData.moduleId === id)
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
    // Prepare once while opening/editing the immutable document, never on the
    // first pointer-down of a fence drag (§9.5).
    fenceConnectionIndex(data.modules)
    this.batches.invalidateViews()
    const retained = keepIds ?? (reuse && this.builtData && this.builtLanguage === getLanguage()
      ? retainedModuleIds(this.builtData, data) : new Set<string>())
    const kept = new Map(this.moduleMeshes.children.filter(g => retained.has(g.userData.moduleId)).map(g => [g.userData.moduleId as string, g]))
    const liftRigs = new Map(this.lifts.liftRigs.map(r => [r.group, r]))
    const gateWings = new Map(this.crowd.gateWings.map(r => [r.root, r]))
    const tvScreens = new Map(this.plates.tvScreens.map(r => [r.moduleId, r]))
    const contactBlobs = new Map(this.moduleMeshes.children
      .filter(g => typeof g.userData.contactBlobKey === 'string')
      .map(g => [g.userData.contactBlobKey as string, g as THREE.InstancedMesh]))
    this.clearModules(data, new Set([...kept.values(), ...contactBlobs.values()]))
    // The plates belong to the module groups just dropped, so they go with them —
    // otherwise every edit would leak one texture per 电视 or 指示牌.
    const trackCells = trackBedKeys(data.cells, data.modules)
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
    const blobsByKey = new Map<string, { levelZ: number; ground: number | undefined; blobs: Array<[number, number, number, number]> }>()
    this.trains.psdGroups = []
    this.plates.adScreens = []
    for (const mod of data.modules) {
      const ownedStart = this.ctx.ownedMats.length
      const group = kept.get(mod.id) ?? buildModule(mod, ctx)
      if (!group) continue
      if (!kept.has(mod.id)) {
        batchStaticModule(group, mod.type)
        group.userData.ownedMaterials = this.ctx.ownedMats.slice(ownedStart)
      }
      group.userData.moduleId = mod.id
      group.userData.moduleType = mod.type
      group.userData.roof = mod.type === 'roof'
      // Ceiling-attached decor is never hidden by 隐藏天花板 (see LevelSystem): only the
      // ceiling tiles themselves (pass 'c' meshes) are. Keep the field for compatibility.
      group.userData.suspendedCeiling = false
      group.userData.levelZs = moduleLevels(mod, this.ctx.levelBase, this.ctx.storeyHeight)
      const ground = this.ctx.groundOf.get(`${mod.x},${mod.y}`)
      group.userData.groundBand = ground
      this.moduleMeshes.add(group)
      if (mod.type === 'fence') {
        this.fenceGroups.push(group)
        this.fenceGroupsById.set(mod.id, group)
      }
      if (mod.type === 'escalator' || mod.type === 'walkway') {
        const roll = group.userData.escalator as EscalatorRoll | undefined
        if (roll) this.lifts.escalatorRolls.push(roll)
      }
      if (mod.type === 'clock') {
        // The dial's two hands per face are pivots, not a pose: the clock system turns them
        // from the sim clock every frame (`ClockSystem.updateClocks`).
        const rig = group.userData.clockRig as ClockRig | undefined
        if (rig) this.clocks.clockRigs.push(rig)
      }
      if (mod.type === 'lift') {
        const cabin = group.userData.liftCabin as THREE.Object3D | undefined
        if (cabin) {
          const originZ = mod.from.z + 1
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
      const r = blobRadius(mod.type)
      if (r > 0) {
        const blob: [number, number, number, number] = [mod.x + 0.5, mod.y + 0.5, mod.z + 1 - 0.42, r]
        const bk = `${mod.z}|${ground ?? 'x'}`
        const entry = blobsByKey.get(bk)
        if (entry) entry.blobs.push(blob)
        else blobsByKey.set(bk, { levelZ: mod.z, ground, blobs: [blob] })
      }
    }
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
      const previous = inst?.userData.contactBlobValues as Array<[number, number, number, number]> | undefined
      if (!inst) inst = new THREE.InstancedMesh(new THREE.CircleGeometry(0.62, 12), this.ctx.mats.blob, THREE.MathUtils.ceilPowerOfTwo(Math.max(1, blobs.length)))
      inst.renderOrder = 2
      inst.frustumCulled = false
      inst.userData.levelZs = [levelZ]
      inst.userData.groundBand = ground
      inst.userData.contactBlobKey = key
      let changed = false
      for (let i = 0; i < blobs.length; i++) {
        const [x, y, z, r] = blobs[i]
        if (previous?.[i]?.every((value, j) => value === blobs[i][j])) continue
        m.compose(p.set(x, y, z), q, s.set(r, r, r))
        inst.setMatrixAt(i, m)
        // A new buffer uploads in full; ranges are only for subsequent edits.
        if (previous) inst.instanceMatrix.addUpdateRange(i * 16, 16)
        changed = true
      }
      if (changed) inst.instanceMatrix.needsUpdate = true
      inst.userData.contactBlobValues = blobs
      inst.count = blobs.length
      this.moduleMeshes.add(inst)
    }
    for (const inst of contactBlobs.values()) {
      disposeObject(inst)
      this.moduleMeshes.remove(inst)
    }
    this.builtData = data
    this.builtLanguage = getLanguage()
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
  clearModules(data?: StationData, kept = new Set<THREE.Object3D>()): void {
    this.sourceDetail.restore()
    if (!data) this.batches.clear()
    this.builtData = null
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
      disposeObject(child)
      this.moduleMeshes.remove(child)
    }
    this.fenceGroups = []
    this.fenceGroupsById.clear()
    this.lifts.escalatorRolls.length = 0
    this.lifts.liftRigs.length = 0
    this.lifts.liftPickMeshes.length = 0
    this.clocks.clockRigs.length = 0
    this.crowd.gateWings.length = 0
    this.plates.adScreens.length = 0
    this.plates.tvScreens.length = 0
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

  refreshHoverHighlight(): void {
    if (this.hoverHelper) {
      this.ctx.scene.remove(this.hoverHelper)
      this.hoverHelper.geometry.dispose()
      ;(this.hoverHelper.material as THREE.Material).dispose()
      this.hoverHelper = null
    }
    const id = this.hoverModuleId
    if (!id || id === this.selectedModuleId) return
    const group = this.moduleMeshes.children.find((c) => c.userData.moduleId === id)
    if (!group) return
    const box = new THREE.Box3().setFromObject(group)
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
      const group = this.moduleMeshes.children.find((c) => c.userData.moduleId === id)
      if (!group) continue
      const box = new THREE.Box3().setFromObject(group)
      if (box.isEmpty()) continue
      box.expandByScalar(0.06)
      const helper = new THREE.Box3Helper(box, 0xff5d5d)
      helper.renderOrder = 4
      this.colliderHelpers.push(helper)
      this.ctx.scene.add(helper)
    }
  }

  refreshSelection(): void {
    if (this.selectionHelper) {
      this.ctx.scene.remove(this.selectionHelper)
      this.selectionHelper.geometry.dispose()
      ;(this.selectionHelper.material as THREE.Material).dispose()
      this.selectionHelper = null
    }
    const id = this.selectedModuleId
    if (!id || id === this.movingModuleId) return
    const group = this.moduleMeshes.children.find((c) => c.userData.moduleId === id)
    if (!group) return
    const box = new THREE.Box3().setFromObject(group)
    if (box.isEmpty()) return
    box.expandByScalar(0.06)
    const helper = new THREE.Box3Helper(box, 0x55b6ff)
    helper.renderOrder = 4
    this.selectionHelper = helper
    this.ctx.scene.add(helper)
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
