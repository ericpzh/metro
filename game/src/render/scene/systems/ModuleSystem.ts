// ModuleSystem — the placed equipment: building every module through the
// model factory, the contact blobs, the tactile strips, plus the selection and
// collision highlights (moved verbatim from `render/scene.ts`: `buildModules`,
// `clearModules`, `tactileDecals`, `setSelection`, `setCollisionHighlight`,
// `refreshCollisionHighlight`, `refreshSelection`).
//
// GAME-SPEC §3 item 6: modules are no longer unit cubes — `models.ts` gives
// each one a silhouette from the reference art. This system owns the module
// groups; the rigs a build discovers (lifts, gates, PSDs, screens) are handed
// to the Train/Lift/Crowd/Plate systems, which animate them.

import * as THREE from 'three'
import {
  buildModule,
  disposeObject,
} from '../../models.ts'
import type { EscalatorRoll, ModuleContext } from '../../models.ts'
import { trackBedKeys } from '../../../sim/placement.ts'
import { edgeCells } from '../../../sim/track.ts'
import { tvPairSlot } from '../../../sim/tvs.ts'
import { blobRadius, moduleLevels, SceneSystem } from './SceneSystem.ts'
import type { SceneContext } from './SceneSystem.ts'
import type { StationData } from '../../../sim/types.ts'
import type { TrainSystem } from './TrainSystem.ts'
import type { LiftSystem } from './LiftSystem.ts'
import type { CrowdSystem } from './CrowdSystem.ts'
import type { PlateSystem } from './PlateSystem.ts'
import { TV_FIRST_SWAP_MS, TV_SWAP_JITTER_MS } from './PlateSystem.ts'
import type { GhostSystem } from './GhostSystem.ts'

export class ModuleSystem extends SceneSystem {
  moduleMeshes: THREE.Group = new THREE.Group()
  /** The selected module's id and its highlight box, kept across a rebuild. */
  private selectedModuleId: string | null = null
  private selectionHelper: THREE.Box3Helper | null = null
  /** Ids of placed modules a blocked preview collides with, boxed in red. */
  private colliderIds: string[] = []
  private colliderHelpers: THREE.Box3Helper[] = []
  /** Committed fence groups, hidden while the live fence drag previews them. */
  fenceGroups: THREE.Object3D[] = []
  /** Sibling systems a build hands rigs to; wired by the orchestrator. */
  trains!: TrainSystem
  lifts!: LiftSystem
  crowd!: CrowdSystem
  plates!: PlateSystem
  ghost!: GhostSystem

  constructor(ctx: SceneContext) {
    super(ctx)
    this.ctx.scene.add(this.moduleMeshes)
  }

  /**
   * Build every placed module through the model factory (§3 item 6). Modules are
   * no longer unit cubes: `models.ts` gives each one a silhouette from the
   * reference art, and the camera sees steel, glass, enamel and screens.
   */
  buildModules(data: StationData, _trackCells: Set<number>): void {
    this.clearModules(data)
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
      const group = buildModule(mod, ctx)
      if (!group) continue
      group.userData.moduleId = mod.id
      group.userData.levelZs = moduleLevels(mod)
      const ground = this.ctx.groundOf.get(`${mod.x},${mod.y}`)
      group.userData.groundBand = ground
      this.moduleMeshes.add(group)
      if (mod.type === 'fence') this.fenceGroups.push(group)
      if (mod.type === 'escalator') {
        const roll = group.userData.escalator as EscalatorRoll | undefined
        if (roll) this.lifts.escalatorRolls.push(roll)
      }
      if (mod.type === 'lift') {
        const cabin = group.userData.liftCabin as THREE.Object3D | undefined
        if (cabin) {
          const originZ = mod.from.z + 1
          this.lifts.liftRigs.push({ key: `${mod.x},${mod.y},${mod.from.z}`, group, cabin, originZ, baseFrom: originZ, baseTo: originZ, doorFrom: 0, doorTo: 0, have: false })
        }
        group.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.isMesh) this.lifts.liftPickMeshes.push(mesh)
        })
      }
      if (mod.type === 'platform-edge') {
        const line = data.lines.find((l) => l.id === mod.cfg.line)
        const colour = line ? parseInt(line.colour.replace('#', ''), 16) || 0x1f5fd0 : 0x1f5fd0
        this.trains.psdGroups.push({ group, colour })
      }
      if (mod.type === 'billboard' || mod.type === 'tv') {
        const screen = group.userData.adScreen as THREE.Mesh | undefined
        if (screen) this.plates.adScreens.push(screen)
        if (mod.type === 'tv' && screen) {
          // The plate is the station information and never changes; only the
          // window (the content the network feed plays in) cycles.
          this.plates.tvScreens.push({
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
          this.crowd.gateWings.push({ root: group, x: mod.x + 0.5, y: mod.y + 0.5, z: mod.z + 1, axisY, pending: 0, hold: 0, open: 0, target: 0 })
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
    // Contact blobs under the floor-standing modules (§11), one batch per level
    // so a shadow disappears with the storey it sits on. `clearModules` disposes
    // every previous batch, so none of them are removed again here.
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    for (const entry of blobsByKey.values()) {
      const { levelZ, ground, blobs } = entry
      const inst = new THREE.InstancedMesh(new THREE.CircleGeometry(0.62, 12), this.ctx.mats.blob, Math.max(1, blobs.length))
      inst.renderOrder = 2
      inst.frustumCulled = false
      inst.userData.levelZs = [levelZ]
      inst.userData.groundBand = ground
      for (let i = 0; i < blobs.length; i++) {
        const [x, y, z, r] = blobs[i]
        m.compose(p.set(x, y, z), q, s.set(r, r, r))
        inst.setMatrixAt(i, m)
      }
      inst.count = blobs.length
      this.moduleMeshes.add(inst)
    }
    const decal = this.tactileDecals(data)
    if (decal) this.moduleMeshes.add(decal)
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
  clearModules(data?: StationData): void {
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
    for (const m of this.ctx.ownedMats) {
      const map = (m as THREE.MeshBasicMaterial).map
      // ...unless the canvas is a **plate**, which outlives the mesh it is printed
      // on: a 电视's lit face wraps the station plate `PlateSystem` retains across
      // rebuilds, and freeing it here would throw away the very redraw the retention
      // was for.
      if (map && !this.plates.ownsTexture(map)) map.dispose()
      m.dispose()
    }
    this.ctx.ownedMats = []
    for (const child of [...this.moduleMeshes.children]) {
      disposeObject(child)
      this.moduleMeshes.remove(child)
    }
    this.fenceGroups = []
    this.lifts.escalatorRolls.length = 0
    this.lifts.liftRigs.length = 0
    this.lifts.liftPickMeshes.length = 0
    this.crowd.gateWings.length = 0
    this.plates.adScreens.length = 0
    this.plates.tvScreens.length = 0
  }

  /**
   * Tactile strips along every platform edge, as a separate transparent quad
   * layer so they never break a chunk merge (§4.2). The strip sits on the side
   * of the edge cell that faces a track bed.
   */
  private tactileDecals(data: StationData): THREE.Mesh | null {
    const track = trackBedKeys(data.cells, data.modules)
    if (track.size === 0) return null
    const pos: number[] = []
    const nor: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    let base = 0
    const quad = (x0: number, y0: number, x1: number, y1: number, z: number): void => {
      pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z)
      for (let i = 0; i < 4; i++) nor.push(0, 0, 1)
      uv.push(0, 0, 1, 0, 1, 1, 0, 1)
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
      base += 4
    }
    for (const m of data.modules) {
      if (m.type !== 'platform-edge') continue
      const z = m.z + 1 + 0.02
      for (const [x, y] of edgeCells(m)) {
        if (track.has(`${x},${y - 1},${m.z}`)) quad(x, y, x + 1, y + 0.3, z)
        else if (track.has(`${x},${y + 1},${m.z}`)) quad(x, y + 0.7, x + 1, y + 1, z)
        else if (track.has(`${x - 1},${y},${m.z}`)) quad(x, y, x + 0.3, y + 1, z)
        else if (track.has(`${x + 1},${y},${m.z}`)) quad(x + 0.7, y, x + 1, y + 1, z)
      }
    }
    if (idx.length === 0) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2))
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1))
    const mesh = new THREE.Mesh(geo, this.ctx.mats.tactile)
    mesh.renderOrder = 1
    mesh.userData.levelZs = [...new Set(data.modules.filter((m) => m.type === 'platform-edge').map((m) => m.z))]
    return mesh
  }

  /**
   * Highlight one placed module with a world-space box, or clear it with null.
   * The id is remembered, so a `setStation` rebuild re-finds the module.
   */
  setSelection(moduleId: string | null): void {
    this.selectedModuleId = moduleId
    this.refreshSelection()
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
    if (!id) return
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
