// LevelSystem — storey slicing: which storeys draw, ghost or hide the rest,
// fade walls, cut the section (moved verbatim from `render/scene.ts`:
// `setLevel`, `setAutoCeiling`, `applyLevel`, `applyGroupLevel`, `baseOf`,
// `dimOf`, `clearOf`, `setCutaway`, `setHideWalls`).
//
// The rule itself is `render/levelSlicing.ts`; this is only the walk over the
// scene. 显示其他层 off is absolute; on, the other storeys draw as 35% ghosts.
// The dim/clear caches are keyed by live materials and are dropped with the
// chunk rebuild (`releaseChunks`), or they would pin dead materials forever.

import * as THREE from 'three'
import { levelSide, levelVisible, trainVisible, unsupportedAbove } from '../../levelSlicing.ts'
import { SceneSystem } from './SceneSystem.ts'
import type { SceneContext } from './SceneSystem.ts'
import type { ChunkSystem } from './ChunkSystem.ts'
import type { ModuleSystem } from './ModuleSystem.ts'
import type { TrainSystem } from './TrainSystem.ts'
import type { CrowdSystem } from './CrowdSystem.ts'

export class LevelSystem extends SceneSystem {
  /** Sibling systems the slice walks; wired by the orchestrator. */
  chunks!: ChunkSystem
  modules!: ModuleSystem
  trains!: TrainSystem
  crowd!: CrowdSystem

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
   */
  applyLevel(): void {
    // This walks every chunk mesh and every module group in the station, so it is
    // the most expensive thing a view toggle does. One edit can ask for it three
    // times (`setStation` → `setLevel`, then `setAutoCeiling`, then `setCutaway`),
    // and two of those usually change nothing — so skip a repeat with the same
    // slice. `setStation` clears the key because it rebuilds the meshes this
    // assigns materials to.
    const key = `${this.ctx.activeZ}|${this.ctx.ghost}|${this.ctx.autoCeiling}|${this.ctx.hideWalls}`
    if (key === this.ctx.levelKey) return
    this.ctx.levelKey = key
    // One reused options record: `applyLevel` walks every chunk mesh in the
    // station, so it must not mint an object per mesh.
    const opts = { ghost: this.ctx.ghost, autoCeiling: this.ctx.autoCeiling, unsupported: false }
    const outlines = this.chunks.outlineSet
    for (const [lz, group] of this.chunks.levelGroups) {
      group.visible = true
      const side = levelSide([lz], this.ctx.activeZ)
      for (const child of group.children) {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) continue
        // A plate with nothing under it (the street outside, a canopy on its own
        // columns) survives 隐藏天花板; a supported slab is that room's ceiling.
        opts.unsupported = mesh.userData.float === true
        mesh.visible = levelVisible(side, opts)
        if (!mesh.visible) continue
        const isOutline = outlines.has(mesh)
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
    if (kind === 'train') {
      root.visible = trainVisible(side, this.ctx.ghost, root.userData.parked === true)
    } else {
      // A fixture whose column starts above the active storey stands on a plate
      // that is itself above it — the fixture's `float`, so 隐藏天花板 keeps it.
      const ground = root.userData.groundBand as number | undefined
      root.visible = levelVisible(side, {
        ghost: this.ctx.ghost,
        autoCeiling: this.ctx.autoCeiling,
        unsupported: unsupportedAbove(this.ctx.activeZ, ground),
      })
    }
    if (!root.visible) return
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const base = this.baseOf(mesh)
      // 隐藏墙壁: a wall panel or a platform screen door reads through.
      mesh.material = this.ctx.hideWalls && mesh.userData.wall === true ? this.clearOf(base) : side === 'active' ? base : this.dimOf(base)
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

  setCutaway(on: boolean): void {
    const planes = on ? [this.ctx.clipPlane] : []
    for (const m of [...this.chunks.chunkMeshes, ...this.chunks.outlineMeshes]) {
      const mat = m.material as THREE.Material
      mat.clippingPlanes = planes
      mat.needsUpdate = true
    }
    // The crowd and their shadows must cut with the floors: otherwise a
    // cutaway hides the slab but leaves the people behind it floating in front.
    for (const mat of this.crowd.clipMaterials()) {
      mat.clippingPlanes = planes
      mat.needsUpdate = true
    }
  }

  /** 隐藏墙壁: fade every wall and platform screen door, or restore them. */
  setHideWalls(on: boolean): void {
    this.ctx.hideWalls = on
    this.applyLevel()
  }
}
