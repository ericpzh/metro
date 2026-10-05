// LevelSystem — storey slicing: which storeys draw, ghost or hide the rest,
// fade walls, hold 沉浸 and 隐藏UI (moved verbatim from `render/scene.ts`:
// `setLevel`, `setAutoCeiling`, `applyLevel`, `applyGroupLevel`, `baseOf`,
// `dimOf`, `clearOf`, `setHideWalls`).
//
// The rule itself is `render/levelSlicing.ts`; this is only the walk over the
// scene. 显示其他层 off is absolute; on, the other storeys draw as 35% ghosts;
// 沉浸 and 隐藏UI draw everything crisp, because both are asking to see the
// station rather than the storey being edited. The dim/clear caches are keyed by
// live materials and are dropped with the chunk rebuild (`releaseChunks`), or
// they would pin dead materials forever. The 剖切 clip is not here any more:
// `SectionSystem` owns the plane and the highlighted surface.

import * as THREE from 'three'
import { levelSide, levelVisible, sliceOptions, trainVisible, unsupportedAbove } from '../../levelSlicing.ts'
import type { SliceOptions } from '../../levelSlicing.ts'
import { SceneSystem } from './SceneSystem.ts'
import type { SceneContext } from './SceneSystem.ts'
import type { ChunkSystem } from './ChunkSystem.ts'
import type { ModuleSystem } from './ModuleSystem.ts'
import type { TrainSystem } from './TrainSystem.ts'

export class LevelSystem extends SceneSystem {
  /** Sibling systems the slice walks; wired by the orchestrator. */
  chunks!: ChunkSystem
  modules!: ModuleSystem
  trains!: TrainSystem

  /**
   * The slice options the last walk used, so a piece-level answer and a
   * group-level one can never disagree about the mode. One reused record,
   * because `applyLevel` walks every chunk mesh in the station and must not mint
   * an object per mesh; `unsupported` is the one field that differs per mesh and
   * is written onto the record as the walk reaches it. Rebuilt whenever the
   * toggles move, which is the only time `applyLevel` does any work.
   */
  private readonly slice: SliceOptions = { ghost: true, autoCeiling: true }

  constructor(ctx: SceneContext) {
    super(ctx)
  }

  setLevel(z: number, ghost: boolean): void {
    this.ctx.activeZ = z
    this.ctx.ghost = ghost
    this.applyLevel()
  }

  /** 隐藏天花板: stop hiding the ceilings of the storey above the active one. */
  setAutoCeiling(on: boolean): void {
    this.ctx.autoCeiling = on
    this.applyLevel()
  }

  /**
   * Show, ghost or hide every storey for the active level. The rule itself is
   * `render/levelSlicing.ts`; this is only the walk over the scene.
   *
   * 显示其他层 off is absolute: the active storey and nothing else — blocks,
   * fixtures, crowd and trains alike — whatever the camera angle. On, the other
   * storeys are drawn as 35% ghosts, which are translucent and keep their real
   * depth, so a storey the active one covers is simply behind it and the depth
   * test drops it: the ghost shows exactly where it does not block the depth
   * being worked on. 隐藏天花板 is the one thing above the active storey that
   * still draws, and only for the plates that are not that room's ceiling.
   *
   * **隐藏UI and 沉浸 draw everything opaque.** All of that is drawing
   * furniture — a sheet of 35% dark laid over the station so the storey being
   * edited reads — and it is exactly the lie the two modes exist to avoid: the
   * slab a storey up ghosts *through* the floor under the eye, and what should be
   * a granite concourse reads as a dark shadow grid. So both put the slice away
   * (`sliceOptions`) and skip this walk's materials entirely: every piece draws
   * as itself, at full opacity, whatever storey it belongs to. 隐藏墙壁 is the
   * one toggle that stays: it is a deliberate look-through, not the slice.
   */
  applyLevel(): void {
    // This walks every chunk mesh and every module group in the station, so it is
    // the most expensive thing a view toggle does. One edit can ask for it three
    // times (`setStation` → `setLevel`, then `setAutoCeiling`, then `setCutaway`),
    // and two of those usually change nothing — so skip a repeat with the same
    // slice. `setStation` clears the key because it rebuilds the meshes this
    // assigns materials to.
    const key = `${this.ctx.activeZ}|${this.ctx.ghost}|${this.ctx.autoCeiling}|${this.ctx.hideWalls}|${this.ctx.hideUI}|${this.ctx.immersive}`
    if (key === this.ctx.levelKey) return
    this.ctx.levelKey = key
    // One record for the whole walk: what the view asks of the slice this frame.
    const slice = sliceOptions({
      ghost: this.ctx.ghost,
      autoCeiling: this.ctx.autoCeiling,
      hideUI: this.ctx.hideUI,
      immersive: this.ctx.immersive,
    })
    this.slice.ghost = slice.ghost
    this.slice.autoCeiling = slice.autoCeiling
    // **隐藏UI draws everything opaque**, and so does 沉浸: both put the slice
    // away, which is the one thing a visibility flag could not do on its own —
    // the 35% ghost *material* the slice assigned a piece has to be undone.
    const straight = this.ctx.hideUI || this.ctx.immersive
    for (const [lz, group] of this.chunks.levelGroups) {
      group.visible = true
      const side = levelSide([lz], this.ctx.activeZ)
      for (const child of group.children) {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) continue
        const isOutline = this.chunks.outlineSet.has(mesh)
        if (straight) {
          mesh.visible = true
          const base = isOutline ? mesh.userData.baseMaterial ?? mesh.material : this.baseOf(mesh)
          mesh.material = this.ctx.hideWalls && mesh.userData.wall === true ? this.clearOf(base) : base
          continue
        }
        // A plate with nothing under it (the street outside, a canopy on its own
        // columns) survives 隐藏天花板; a supported slab is that room's ceiling.
        this.slice.unsupported = mesh.userData.float === true
        mesh.visible = levelVisible(side, this.slice)
        if (!mesh.visible) continue
        // 隐藏墙壁: fade the wall faces, and drop their dark outline hull, which
        // would otherwise read as a solid black wall around the translucent faces.
        if (this.ctx.hideWalls && mesh.userData.wall === true) {
          if (isOutline) {
            mesh.visible = false
            continue
          }
          mesh.material = this.clearOf(this.baseOf(mesh))
          continue
        }
        const base = isOutline ? mesh.userData.baseMaterial ?? mesh.material : this.baseOf(mesh)
        mesh.material = side === 'active' ? base : this.dimOf(base)
      }
    }
    // Fixtures follow the same rule: the storey above loses the pieces that hang
    // over the room below, and 显示其他层 decides whether the rest are drawn.
    for (const child of this.modules.moduleMeshes.children) this.applyGroupLevel(child, 'module')
    // Trains own their `visible` flag (`setTrains` parks them between services),
    // so the slicing is combined with the sim's own state rather than replacing it.
    for (const child of this.trains.trainGroup.children) this.applyGroupLevel(child, 'train')
  }

  /**
   * Show, ghost or hide one module or train group by the level(s) it occupies.
   * A ramp (escalator, stair, lift) belongs to every storey it spans;
   * everything else to its cell. Forestanding furniture with no level tag
   * (shadows, decals) always shows.
   */
  applyGroupLevel(root: THREE.Object3D, kind: 'module' | 'train'): void {
    const levels = root.userData.levelZs as number[] | undefined
    const lz = root.userData.levelZ as number | undefined
    const zs = levels ?? (lz !== undefined ? [lz] : undefined)
    const side = levelSide(zs, this.ctx.activeZ)
    const straight = this.ctx.hideUI || this.ctx.immersive
    if (straight) {
      // 隐藏UI / 沉浸: drawn, and drawn as itself — a 售票机, a 屏蔽门 or a consist
      // does not become a 35% ghost because it stands on another storey.
      root.visible = kind === 'train' ? root.userData.parked !== true : true
    } else if (kind === 'train') {
      root.visible = trainVisible(side, this.ctx.ghost, root.userData.parked === true)
    } else {
      // A fixture whose column starts above the active storey stands on a plate
      // that is itself above it — the fixture's `float`, so 隐藏天花板 keeps it.
      const ground = root.userData.groundBand as number | undefined
      this.slice.unsupported = unsupportedAbove(this.ctx.activeZ, ground)
      root.visible = levelVisible(side, this.slice)
    }
    if (!root.visible) return
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const base = this.baseOf(mesh)
      // 隐藏墙壁: a wall panel or a platform screen door reads through.
      if (this.ctx.hideWalls && mesh.userData.wall === true) mesh.material = this.clearOf(base)
      else mesh.material = side === 'active' || straight ? base : this.dimOf(base)
    })
  }

  baseOf(mesh: THREE.Mesh): THREE.Material {
    if (!mesh.userData.base) mesh.userData.base = mesh.material
    return mesh.userData.base as THREE.Material
  }

  /**
   * A 35% ghost of `base` for 显示其他层. `depthWrite` is off so a ghost never
   * occludes another ghost — the layers stack as translucent sheets and the
   * active storey, drawn opaque and first, still wins every pixel it covers.
   */
  dimOf(base: THREE.Material): THREE.Material {
    let d = this.ctx.dimMats.get(base)
    if (!d) {
      d = base.clone()
      const anyMat = d as THREE.MeshStandardMaterial
      anyMat.transparent = true
      anyMat.opacity = 0.35
      anyMat.depthWrite = false
      if (anyMat.color) anyMat.color = anyMat.color.clone().lerp(new THREE.Color(0x6b7480), 0.7)
      if (anyMat.onBeforeCompile !== base.onBeforeCompile) anyMat.onBeforeCompile = base.onBeforeCompile
      this.ctx.dimMats.set(base, d)
    }
    return d
  }

  /**
   * A translucent clone of `base` for 隐藏墙壁: walls and platform screen doors
   * stay legible as surfaces but stop hiding the crowd and the station behind
   * them. `depthWrite` is off so the layers behind actually show through.
   */
  clearOf(base: THREE.Material): THREE.Material {
    let c = this.ctx.clearMats.get(base)
    if (!c) {
      c = base.clone()
      c.transparent = true
      c.opacity = 0.16
      c.depthWrite = false
      if (c.onBeforeCompile !== base.onBeforeCompile) c.onBeforeCompile = base.onBeforeCompile
      this.ctx.clearMats.set(base, c)
    }
    return c
  }

  /** 隐藏墙壁: fade every wall and platform screen door, or restore them. */
  setHideWalls(on: boolean): void {
    this.ctx.hideWalls = on
    this.applyLevel()
  }

  /**
   * 沉浸. The slice stops being a slice: every storey draws crisp and no
   * ceiling is lifted, so what hides what is real geometry rather than a
   * ghosting choice (`render/levelSlicing.ts`).
   */
  setImmersive(on: boolean): void {
    if (this.ctx.immersive === on) return
    this.ctx.immersive = on
    this.applyLevel()
  }

  /**
   * 隐藏UI. The same picture as 沉浸 — the station as it is, with every storey
   * drawn as itself — without moving the camera, and with the editing lattice
   * gone as well (`GridSystem`). The two ask for one slice (`sliceOptions`), so
   * neither can leave the other's ghost sheet in place.
   */
  setHideUI(on: boolean): void {
    if (this.ctx.hideUI === on) return
    this.ctx.hideUI = on
    this.applyLevel()
  }
}
