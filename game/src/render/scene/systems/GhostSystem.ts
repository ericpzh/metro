// GhostSystem — the previews: add/remove drag ghosts, paint quads, the
// translucent module hover ghost and the live fence-drag preview (moved
// verbatim from `render/scene.ts`: `setGhost`, `ghostKeyOf`,
// `buildShapeGhost`, `clearShapeGhost`, `shapeGhostMaterial`, `setFaceGhost`,
// `clearFaceGhost`, `setModulePreview`, `tintModuleGhost`,
// `clearModulePreview`, `setFencePreview`, `clearFencePreview`).
//
// GAME-SPEC §9.5 (drag previews): a remove drag flags blocks with boxes, an
// add drag shows the final meshed shape, and a paint drag shows one quad per
// face — all before the release, so the release is never a surprise. The fence
// preview additionally rebuilds the committed fences with the dragged line
// merged in, so joints update as you drag.

import * as THREE from 'three'
import { CHUNK, meshChunk, wedgeSlope } from '../../chunkMesher.ts'
import { buildModule, disposeObject } from '../../models.ts'
import type { ModuleContext } from '../../models.ts'
import { HALF_WALL_T } from '../../../sim/constants.ts'
import { rampFillKeys } from '../../../sim/openings.ts'
import { tvPairSlot } from '../../../sim/tvs.ts'
import { halfWallInnerFace, isHalfWallShape, isTriangleShape, packKey, triangleSlopeFace } from '../../../sim/types.ts'
import type { CellShape, Face, Module } from '../../../sim/types.ts'
import { moduleGhostKey } from '../../moduleGhostKey.ts'
import { moduleLevels, SceneSystem } from './SceneSystem.ts'
import type { SceneContext } from './SceneSystem.ts'
import type { PlateSystem } from './PlateSystem.ts'
import type { ModuleSystem } from './ModuleSystem.ts'

/** Most cells one drag preview can highlight at once (the ghost instance pool). */
const GHOST_MAX = 4096

/** Hue the module hover ghost fades toward, matching the placement cursor. */
const MODULE_GHOST_TINT = new THREE.Color(0x7fe4ff)
/** Hue the ghost turns when the placement would collide with existing equipment. */
const MODULE_GHOST_BAD = new THREE.Color(0xff5d5d)

/** Outward normal of each face, in cell units; also the paint plane's axis. */
const FACE_NORMAL: Record<Face, [number, number, number]> = {
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  n: [0, 1, 0],
  s: [0, -1, 0],
  e: [1, 0, 0],
  w: [-1, 0, 0],
}

/** The plane geometry's own normal, so a quad can be turned to face a wall. */
const FACE_UP = new THREE.Vector3(0, 0, 1)

export class GhostSystem extends SceneSystem {
  /** Hover preview: a translucent copy of the module a click would place. */
  previewGroup: THREE.Group = new THREE.Group()
  private previewKey = ''
  /** Materials/geometries owned by the current preview, disposed on replacement. */
  private previewMats: THREE.Material[] = []
  private previewBases: THREE.Material[] = []
  /**
   * The same, for a hover/fence-drag preview. The ghost rebuilds on every cell the
   * pointer crosses, so its builder-minted materials are released on each rebuild
   * (`clearModulePreview`) rather than accumulating for the whole drag.
   */
  private previewOwnedMats: THREE.Material[] = []
  /**
   * Live fence-drag preview: the existing fences rebuilt with the dragged line
   * merged in (so a joint updates as you drag) plus the new translucent panels.
   */
  fencePreviewGroup: THREE.Group = new THREE.Group()
  private fencePreviewKey = ''
  private fencePreviewMats: THREE.Material[] = []
  /** Module-local base materials the fence ghost cloned, released with its ghosts. */
  private fencePreviewBases: THREE.Material[] = []
  /** Remove-drag preview: one red box per pending-delete block (§9.5). */
  private ghostMesh: THREE.InstancedMesh | null = null
  /** Add-drag preview: the pending cells meshed into their final shape. */
  private ghostGroup: THREE.Group = new THREE.Group()
  private ghostKey = ''
  private ghostMaterial: THREE.MeshStandardMaterial | null = null
  /** Paint-drag preview: one flat quad per face a drag would paint (§9.5). */
  private faceGhost: THREE.InstancedMesh | null = null
  /** Sibling systems; wired by the orchestrator. */
  plates!: PlateSystem
  modules!: ModuleSystem

  constructor(ctx: SceneContext) {
    super(ctx)
    this.previewGroup.visible = false
    this.ctx.scene.add(this.previewGroup)
    this.ctx.scene.add(this.fencePreviewGroup)
    this.ctx.scene.add(this.ghostGroup)
  }

  /**
   * Ghost preview for the active drag (§9.5). A remove drag flags the blocks it
   * would delete with boxes (red by default, or a caller's colour for a
   * different meaning — e.g. cyan for a wall opening); an add drag shows the
   * final shape the pending cells will take — meshed with the real profile, then
   * drawn translucent — so the release is not a surprise. `thin` names the
   * pending cells that are **半墙** (packed key → the side the panel hugs), so a
   * half-block wall previews as half a block rather than as a full one: the
   * thickness is the whole piece. `refused` names the candidates the release will
   * **not** take (the cells a piece of equipment already holds, a reserved opening,
   * a rail bed): they are drawn as red boxes beside the cyan shape, so a blocked
   * cell reads as "not this one" rather than as a block that quietly went missing.
   */
  setGhost(
    cells: Array<[number, number, number]>,
    kind: 'add' | 'remove',
    colour = 0xff5d5d,
    thin?: ReadonlyMap<number, CellShape>,
    refused: ReadonlyArray<[number, number, number]> = [],
  ): void {
    if (kind === 'add') {
      if (this.ghostMesh) this.ghostMesh.visible = false
      // A refused candidate is drawn as a **red box** beside the shape the release
      // would take, so a drag that drops a cell says which cell and not merely
      // "one fewer block than you drew". The box is the same instanced mesh a
      // remove drag uses, and the two never show at once: `add` keeps only the
      // refused list here, `remove` only the cells being taken away.
      const key = `${this.ghostKeyOf(cells, thin)}|${this.refusedKeyOf(refused)}`
      if (key === this.ghostKey) return
      this.ghostKey = key
      this.buildShapeGhost(cells, thin)
      this.setRefusedBoxes(refused, 0xff5d5d)
      return
    }

    this.ghostGroup.visible = false
    this.ghostKey = ''
    if (cells.length === 0) {
      if (this.ghostMesh) this.ghostMesh.visible = false
      return
    }
    if (!this.ghostMesh) {
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false })
      this.ghostMesh = new THREE.InstancedMesh(geo, mat, GHOST_MAX)
      this.ghostMesh.frustumCulled = false
      this.ghostMesh.renderOrder = 3
      this.ctx.scene.add(this.ghostMesh)
    }
    const m = new THREE.Matrix4()
    const col = new THREE.Color(colour)
    // Clamp to the pool capacity, not the previous frame's count — a drag that
    // grows bigger than the last preview must still draw every pending block.
    const n = Math.min(cells.length, GHOST_MAX)
    this.ghostMesh.count = n
    for (let i = 0; i < n; i++) {
      const [x, y, z] = cells[i]
      m.makeTranslation(x + 0.5, y + 0.5, z + 0.5)
      this.ghostMesh.setMatrixAt(i, m)
      this.ghostMesh.setColorAt(i, col)
    }
    this.ghostMesh.visible = true
    this.ghostMesh.instanceMatrix.needsUpdate = true
    if (this.ghostMesh.instanceColor) this.ghostMesh.instanceColor.needsUpdate = true
  }

  /**
   * Draw the refused candidates of an add preview as red boxes through the same
   * instanced mesh a remove drag uses. Called after `buildShapeGhost`, which may
   * have left the mesh hidden; an empty list clears it.
   */
  private setRefusedBoxes(refused: ReadonlyArray<[number, number, number]>, colour: number): void {
    if (!this.ghostMesh) {
      if (refused.length === 0) return
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false })
      this.ghostMesh = new THREE.InstancedMesh(geo, mat, GHOST_MAX)
      this.ghostMesh.frustumCulled = false
      this.ghostMesh.renderOrder = 3
      this.ctx.scene.add(this.ghostMesh)
    }
    if (refused.length === 0) {
      this.ghostMesh.visible = false
      return
    }
    const m = new THREE.Matrix4()
    const col = new THREE.Color(colour)
    const n = Math.min(refused.length, GHOST_MAX)
    this.ghostMesh.count = n
    for (let i = 0; i < n; i++) {
      const [x, y, z] = refused[i]
      m.makeTranslation(x + 0.5, y + 0.5, z + 0.5)
      this.ghostMesh.setMatrixAt(i, m)
      this.ghostMesh.setColorAt(i, col)
    }
    this.ghostMesh.visible = true
    this.ghostMesh.instanceMatrix.needsUpdate = true
    if (this.ghostMesh.instanceColor) this.ghostMesh.instanceColor.needsUpdate = true
  }

  /** A cheap order-stable fingerprint of the refused cells, for the ghost key. */
  private refusedKeyOf(cells: ReadonlyArray<[number, number, number]>): string {
    let h = 2166136261
    for (const [x, y, z] of cells) {
      h = Math.imul(h ^ (x + 4096), 16777619)
      h = Math.imul(h ^ (y + 4096), 16777619)
      h = Math.imul(h ^ (z + 4096), 16777619)
    }
    return `${cells.length}:${h >>> 0}`
  }

  /**
   * A cheap order-stable fingerprint of a pending cell set, to skip re-meshing.
   * The 半墙 sides are part of it: R steps the thickness a thin wall's panel takes
   * without the pending cells moving at all, and a ghost that skipped that rebuild
   * would show the wall the player just turned away from. So is the run's cut,
   * which changes when a 楼梯 / 扶梯 is placed or bulldozed under an unmoved cell.
   */
  private ghostKeyOf(cells: Array<[number, number, number]>, thin?: ReadonlyMap<number, CellShape>): string {
    let h = 2166136261
    for (const [x, y, z] of cells) {
      h = Math.imul(h ^ (x + 4096), 16777619)
      h = Math.imul(h ^ (y + 4096), 16777619)
      h = Math.imul(h ^ (z + 4096), 16777619)
      const k = packKey(x, y, z)
      const shape = thin?.get(k)
      if (shape !== undefined) {
        // The family and the hugged side both change the piece, and **R** steps the
        // side without the pending cell moving: a ghost that skipped that rebuild
        // would show the cut the player just turned away from.
        h = Math.imul(h ^ (shape.kind === 'half' ? 0 : shape.triangle === 'upper' ? 1 : 2), 16777619)
        for (let i = 0; i < shape.side.length; i++) h = Math.imul(h ^ shape.side.charCodeAt(i), 16777619)
      }
      const cut = this.ctx.slopeCuts.get(k)
      if (cut !== undefined) {
        h = Math.imul(h ^ cut.axis.charCodeAt(0), 16777619)
        h = Math.imul(h ^ Math.round(cut.lo * 1024), 16777619)
        h = Math.imul(h ^ Math.round(cut.hi * 1024), 16777619)
      }
      // A block under a run carries the ground up to the truss, and that filling is
      // part of what the ghost draws: whether it exists depends on the cell above
      // being free and on the run's cut there, neither of which the cell's own key
      // carries.
      const above = packKey(x, y, z + 1)
      const fillCut = this.ctx.slopeCuts.get(above)
      if (fillCut !== undefined && !this.ctx.solid.has(above)) {
        h = Math.imul(h ^ 0x5bf03635, 16777619)
        h = Math.imul(h ^ fillCut.axis.charCodeAt(0), 16777619)
        h = Math.imul(h ^ Math.round(fillCut.lo * 1024), 16777619)
        h = Math.imul(h ^ Math.round(fillCut.hi * 1024), 16777619)
        // The run's drawn body width shapes that filling (a truss box, not a block).
        if (fillCut.half !== undefined) h = Math.imul(h ^ Math.round(fillCut.half * 1024), 16777619)
      }
    }
    return `${cells.length}:${h >>> 0}`
  }

  /**
   * Draw the pending add-cells as their final geometry. The real chunk mesher
   * builds the rounded silhouette, but only the pending cells emit faces while
   * the whole station answers neighbour queries — so the preview is the exact
   * surface the release will add, sitting at the exact target cells. A 半墙 among
   * them is meshed half a block thick, and a block under a 楼梯 / 扶梯 is meshed
   * shaved to the run's underside, exactly as they will be once laid.
   */
  private buildShapeGhost(cells: Array<[number, number, number]>, thin?: ReadonlyMap<number, CellShape>): void {
    this.clearShapeGhost()
    if (cells.length === 0) return
    const emit = new Set<number>()
    const chunks = new Map<string, { cx: number; cy: number; cz: number }>()
    const added: number[] = []
    const put = (x: number, y: number, z: number): void => {
      chunks.set(`${Math.floor(x / CHUNK) * CHUNK},${Math.floor(y / CHUNK) * CHUNK},${z}`, {
        cx: Math.floor(x / CHUNK) * CHUNK,
        cy: Math.floor(y / CHUNK) * CHUNK,
        cz: z,
      })
    }
    for (const [x, y, z] of cells) {
      const k = packKey(x, y, z)
      emit.add(k)
      put(x, y, z)
      if (!this.ctx.solid.has(k)) {
        this.ctx.solid.add(k)
        added.push(k)
      }
    }
    // A block landing under a 楼梯 / 扶梯 carries the ground up to the truss: the
    // filling above it (`rampFillKeys`, read with the pending cells in place) is part
    // of what the release shows, so the preview draws it too.
    const fills = rampFillKeys(this.ctx.solid, this.ctx.slopeCuts)
    for (const [x, y, z] of cells) {
      if (!fills.has(packKey(x, y, z + 1))) continue
      emit.add(packKey(x, y, z + 1))
      put(x, y, z + 1)
    }
    const mat = this.shapeGhostMaterial()
    try {
      for (const { cx, cy, cz } of chunks.values()) {
        const chunk = meshChunk(this.ctx.solid, this.ctx.finishes, cx, cy, cz, cz, emit, undefined, undefined, thin, this.ctx.slopeCuts, fills)
        for (const part of chunk.parts) {
          const geo = new THREE.BufferGeometry()
          geo.setAttribute('position', new THREE.BufferAttribute(part.positions, 3))
          geo.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3))
          geo.setAttribute('color', new THREE.BufferAttribute(part.colors, 3))
          const mesh = new THREE.Mesh(geo, mat)
          mesh.frustumCulled = false
          mesh.renderOrder = 3
          this.ghostGroup.add(mesh)
        }
      }
    } finally {
      for (const k of added) this.ctx.solid.delete(k)
    }
    this.ghostGroup.visible = this.ghostGroup.children.length > 0
  }

  clearShapeGhost(): void {
    for (const child of [...this.ghostGroup.children]) {
      this.ghostGroup.remove(child)
      ;(child as THREE.Mesh).geometry?.dispose()
    }
  }

  private shapeGhostMaterial(): THREE.MeshStandardMaterial {
    if (!this.ghostMaterial) {
      this.ghostMaterial = new THREE.MeshStandardMaterial({
        color: 0x7fe4ff,
        emissive: 0x123a4a,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        vertexColors: true,
        roughness: 0.5,
        metalness: 0.0,
      })
    }
    return this.ghostMaterial
  }

  /**
   * Paint-tool preview (§9.5): a flat translucent quad sitting just proud of
   * every face a paint drag would colour. `colour` is the brush's own tint, so
   * the preview shows the finish, not just the rectangle. A **半墙** is the one
   * surface that is not on its cell's boundary: its panel is half a block thick,
   * so the quad for the face looking across the cell's clear half sits on the
   * panel itself, half a block in — the same place the brush will paint. A
   * **三角**'s slope is the other: it is a face of the piece, so the quad goes on
   * the sawn diagonal (`wedgeSlope`) rather than a metre above it on the cell's
   * ceiling, where it would promise a surface that is not there.
   */
  setFaceGhost(cells: Array<[number, number, number]>, face: Face, colour: number): void {
    if (cells.length === 0) {
      if (this.faceGhost) this.faceGhost.visible = false
      return
    }
    const n = Math.min(cells.length, GHOST_MAX)
    if (!this.faceGhost) {
      const g = new THREE.PlaneGeometry(1, 1)
      const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })
      this.faceGhost = new THREE.InstancedMesh(g, m, GHOST_MAX)
      this.faceGhost.renderOrder = 4
      this.faceGhost.frustumCulled = false
      this.ctx.scene.add(this.faceGhost)
    }
    const [nx, ny, nz] = FACE_NORMAL[face]
    const q = new THREE.Quaternion()
    const mat = new THREE.Matrix4()
    const col = new THREE.Color(colour)
    const pos = new THREE.Vector3()
    const scale = new THREE.Vector3(1, 1, 1)
    // Scratch axes for a wedge's slope, so the common axis-aligned cell allocates none.
    const ax = new THREE.Vector3()
    const ay = new THREE.Vector3()
    const az = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const [x, y, z] = cells[i]
      const shape = this.ctx.thinSides.get(packKey(x, y, z))
      // A 半墙's panel turns its inner face into its own cell, half a block in, so the
      // paint ghost sits on the panel rather than on the boundary. A 三角's faces are
      // its own geometry, not the cell's, so its slope takes the diagonal itself (the
      // plane the wedge was sawn on passes through the cell's centre) and its three
      // axis-aligned faces keep the boundary, exactly as `facePresent` offers them.
      if (isTriangleShape(shape) && triangleSlopeFace(shape.triangle) === face) {
        const plane = wedgeSlope(shape.triangle, shape.side)
        pos.set(x + 0.5 + plane.normal[0] * 0.005, y + 0.5 + plane.normal[1] * 0.005, z + 0.5 + plane.normal[2] * 0.005)
        // The quad's own axes are the slope's: `x` falls along the diagonal, `y` runs
        // the ridge, `z` is the normal it is turned to face.
        ax.set(plane.along[0], plane.along[1], plane.along[2])
        ay.set(plane.ridge[0], plane.ridge[1], plane.ridge[2])
        az.set(plane.normal[0], plane.normal[1], plane.normal[2])
        q.setFromRotationMatrix(mat.makeBasis(ax, ay, az))
        // √2 across the fall, 1 m along the ridge: the slope's own 1 × √2 m.
        scale.set(Math.SQRT2, 1, 1)
      } else {
        const inset = isHalfWallShape(shape) && face === halfWallInnerFace(shape.side) ? HALF_WALL_T : 0
        const off = 0.505 - inset
        pos.set(x + 0.5 + nx * off, y + 0.5 + ny * off, z + 0.5 + nz * off)
        q.setFromUnitVectors(FACE_UP, az.set(nx, ny, nz))
        scale.set(1, 1, 1)
      }
      mat.compose(pos, q, scale)
      this.faceGhost.setMatrixAt(i, mat)
      this.faceGhost.setColorAt(i, col)
    }
    this.faceGhost.count = n
    this.faceGhost.visible = true
    this.faceGhost.instanceMatrix.needsUpdate = true
    if (this.faceGhost.instanceColor) this.faceGhost.instanceColor.needsUpdate = true
  }

  clearFaceGhost(): void {
    if (this.faceGhost) this.faceGhost.visible = false
  }

  /**
   * Hover preview for the module tool: a translucent copy of the exact piece a
   * click would place at the hovered cell, so the release is not a surprise. A
   * wide stair is several lane pieces in one placement, so this takes a list. The
   * model is built through the same factory as a placed module and then every
   * surface is swapped for a faded clone; passing `null` clears it.
   */
  setModulePreview(mod: Module | readonly Module[] | null, blocked = false): void {
    const mods = mod ? (Array.isArray(mod) ? mod : [mod]) : []
    const key = mods.length === 0 ? '' : `${mods.map(moduleGhostKey).join('|')}:${blocked ? 'x' : '-'}`
    if (key === this.previewKey) return
    this.clearModulePreview()
    this.previewKey = key
    if (mods.length === 0 || !this.ctx.stationData) return
    // The ghost is built against the station *plus* its own pieces, so a
    // multi-piece hover sees itself: the lanes of a wide stair join their steps
    // and drop the rail between them exactly as they will once placed.
    const data = { ...this.ctx.stationData, modules: [...this.ctx.stationData.modules, ...mods] }
    const ctx: ModuleContext = {
      mats: this.ctx.modelMats,
      ads: this.ctx.ads,
      data,
      trackCells: this.ctx.trackCellSet,
      finish: (id) => this.ctx.mats.finish(id),
      preview: true,
      tvPlate: (id, x, y) => this.plates.makeTvPlate(id, x, y),
      tvPairSlot: (id) => tvPairSlot(id, data.modules),
      signFace: (id, layout, face, panel) => this.plates.makeSignPlate(id, layout, face, panel),
      calligraphyFace: (id, spec) => this.plates.makeCalligraphyPlate(id, spec),
      lineMapFace: (id, panel) => this.plates.makeLineMapPlate(id, panel),
      owned: this.previewOwnedMats,
    }
    const tint = blocked ? MODULE_GHOST_BAD : MODULE_GHOST_TINT
    for (const piece of mods) {
      const group = buildModule(piece, ctx)
      if (!group) continue
      this.tintModuleGhost(group, piece, tint, 0.45, this.previewMats, this.previewBases, (m) => this.sceneOwns(m))
      this.previewGroup.add(group)
    }
    this.previewGroup.visible = true
  }

  /**
   * The shared model kit, as an ownership test. Built once, on first use: the kit
   * is a fixed set of materials, and rebuilding it per hover was a per-pointer-move
   * cost. `MaterialSet` answers for itself through `owns`, which is why a finish the
   * ghost **just minted** for its own cells counts as the scene's and is never
   * pushed onto a preview's disposal list.
   */
  private kitMats: WeakSet<THREE.Material> | null = null
  private sceneOwns(mat: THREE.Material): boolean {
    if (this.ctx.mats.owns(mat)) return true
    // A printed plate: the material wraps a texture the plate system mints and keeps
    // for the sign it is drawn on, so it is not the ghost's to dispose either.
    if (this.plates.ownsTexture((mat as THREE.MeshBasicMaterial).map)) return true
    let kit = this.kitMats
    if (!kit) {
      kit = new WeakSet<THREE.Material>()
      for (const value of Object.values(this.ctx.modelMats)) {
        if (Array.isArray(value)) for (const m of value as THREE.Material[]) kit.add(m)
        else kit.add(value as THREE.Material)
      }
      this.kitMats = kit
    }
    return kit.has(mat)
  }

  /**
   * Swap every surface of a module group for a translucent ghost, and hand back the
   * map it built so a caller can reuse one ghost per base material.
   *
   * `tinted` is the colour a ghost is washed toward, or null to leave the materials'
   * own colours alone (the fence drag does not tint). `sceneOwns` answers whether a
   * base material belongs to the scene (the shared kit, or anything `MaterialSet`
   * minted); a base it does not own is module-local — a printed sign, say — and is
   * pushed onto `bases` for the caller to dispose when the preview moves on.
   *
   * **A lit face keeps its own sidedness.** A 装饰 screen prints its artwork out of the
   * front of a plane only (`render/adArt.ts`), and a ghost that forced
   * `DoubleSide` — as the rest of the piece wants, so a translucent shape reads from
   * every angle — would print the campaign out of the back of the screen again. The
   * one thing R has to make obvious is which way the piece will face, and a back that
   * shows content cannot say. So a mesh the model already marked single-sided stays
   * single-sided, and the ghost shows the screen's own black housing from behind.
   */
  private tintModuleGhost(
    group: THREE.Object3D,
    mod: Module,
    tint: THREE.Color | null,
    opacity: number,
    owned: THREE.Material[],
    bases: THREE.Material[],
    sceneOwns: (mat: THREE.Material) => boolean,
  ): Map<THREE.Material, THREE.Material> {
    const ghostOf = new Map<THREE.Material, THREE.Material>()
    group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const base = mesh.material as THREE.Material
      let ghost = ghostOf.get(base)
      if (!ghost) {
        ghost = base.clone()
        const any = ghost as THREE.MeshStandardMaterial
        any.transparent = true
        any.opacity = opacity
        any.depthWrite = false
        if (any.side !== THREE.FrontSide) any.side = THREE.DoubleSide
        // A track bed lives *inside* the floor block until it is dug, so its ghost
        // must ignore depth or the block hides it entirely.
        if (mod.type === 'track') any.depthTest = false
        if (tint && any.color) any.color = any.color.clone().lerp(tint, 0.4)
        ghostOf.set(base, ghost)
        owned.push(ghost)
        // A factory material may be shared scene-wide; a module-local one is the
        // caller's to dispose when the preview moves on.
        if (!sceneOwns(base)) bases.push(base)
      }
      mesh.material = ghost
      mesh.renderOrder = 5
      mesh.frustumCulled = false
    })
    return ghostOf
  }

  /** Drop the hover preview's geometry and the materials/geometries it owns. */
  clearModulePreview(): void {
    for (const child of [...this.previewGroup.children]) {
      disposeObject(child)
      this.previewGroup.remove(child)
    }
    for (const m of this.previewMats) m.dispose()
    for (const m of this.previewBases) m.dispose()
    this.previewMats.length = 0
    this.previewBases.length = 0
    for (const m of this.previewOwnedMats) {
      const map = (m as THREE.MeshBasicMaterial).map
      // A plate is the scene's, not the ghost's: the lit face of a 电视 ghost wraps
      // the same station plate the placed piece prints on (`PlateSystem.ownsTexture`).
      if (map && !this.plates.ownsTexture(map)) map.dispose()
      m.dispose()
    }
    this.previewOwnedMats = []
    this.previewGroup.visible = false
    this.previewKey = ''
  }

  /**
   * Live preview for the 围栏 drag. Unlike a single-module hover, a fence's shape
   * depends on its neighbours, so the existing fences are rebuilt here with the
   * dragged line merged into their module list — dragging up to an existing end
   * updates that end's block (its cap and end post go) as you drag — and the new
   * panels are drawn translucent. Committed fences are hidden while this is up.
   * Passing `null` (or an empty list) clears it.
   */
  setFencePreview(mods: Module[] | null, blocked = false): void {
    const list = mods ?? []
    const key = list.length === 0 ? '' : `${blocked ? 'x' : '-'}|${list.map((m) => `${m.x},${m.y},${m.z},${m.rot ?? 0}`).join(';')}`
    if (key === this.fencePreviewKey) return
    this.clearFencePreview()
    this.fencePreviewKey = key
    if (list.length === 0 || !this.ctx.stationData) return
    // Hide the committed fences; the preview rebuilds every fence, so there is
    // no z-fighting and every joint reflects the in-progress line.
    for (const f of this.modules.fenceGroups) f.visible = false
    const merged = { ...this.ctx.stationData, modules: [...this.ctx.stationData.modules, ...list] }
    const ctx: ModuleContext = {
      mats: this.ctx.modelMats,
      ads: this.ctx.ads,
      data: merged,
      trackCells: this.ctx.trackCellSet,
      finish: (id) => this.ctx.mats.finish(id),
      tvPlate: (id, x, y) => this.plates.makeTvPlate(id, x, y),
      tvPairSlot: (id) => tvPairSlot(id, merged.modules),
      signFace: (id, layout, face, panel) => this.plates.makeSignPlate(id, layout, face, panel),
    }
    const shown = (m: Module): boolean => {
      const zs = moduleLevels(m)
      const lowest = zs.length > 0 ? Math.min(...zs) : undefined
      const ground = this.ctx.groundOf.get(`${m.x},${m.y}`)
      return lowest === undefined || lowest <= this.ctx.activeZ || (ground !== undefined && ground > this.ctx.activeZ)
    }
    for (const m of this.ctx.stationData.modules) {
      if (m.type !== 'fence') continue
      const group = buildModule(m, ctx)
      if (!group) continue
      group.visible = shown(m)
      this.fencePreviewGroup.add(group)
    }
    // The dragged panels, tinted like the module hover ghost.
    const previewCtx: ModuleContext = { ...ctx, preview: true }
    const tint = blocked ? MODULE_GHOST_BAD : MODULE_GHOST_TINT
    for (const m of list) {
      const group = buildModule(m, previewCtx)
      if (!group) continue
      this.tintModuleGhost(group, m, tint, 0.5, this.fencePreviewMats, this.fencePreviewBases, (mat) => this.sceneOwns(mat))
      this.fencePreviewGroup.add(group)
    }
  }

  /** Drop the fence-drag preview and bring the committed fences back. */
  clearFencePreview(): void {
    for (const child of [...this.fencePreviewGroup.children]) {
      disposeObject(child)
      this.fencePreviewGroup.remove(child)
    }
    for (const m of this.fencePreviewMats) m.dispose()
    for (const m of this.fencePreviewBases) m.dispose()
    this.fencePreviewMats.length = 0
    this.fencePreviewBases.length = 0
    this.fencePreviewKey = ''
    for (const f of this.modules.fenceGroups) f.visible = true
  }

  override dispose(): void {
    this.clearShapeGhost()
    this.clearModulePreview()
    this.clearFencePreview()
    this.ghostMaterial?.dispose()
    if (this.faceGhost) {
      this.ctx.scene.remove(this.faceGhost)
      this.faceGhost.geometry.dispose()
      ;(this.faceGhost.material as THREE.Material).dispose()
      this.faceGhost.dispose()
      this.faceGhost = null
    }
  }
}
