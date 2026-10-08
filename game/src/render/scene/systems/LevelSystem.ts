// LevelSystem — storey slicing: which storeys draw, ghost or hide the rest,
// fade walls, hold 隐藏UI (moved verbatim from `render/scene.ts`:
// `setLevel`, `setAutoCeiling`, `applyLevel`, `applyGroupLevel`, `baseOf`,
// `dimOf`, `clearOf`, `setHideWalls`).
//
// The rule itself is `render/levelSlicing.ts`; this is only the walk over the
// scene. 显示其他层 off is absolute; on, the other storeys draw as 35% ghosts;
// 隐藏UI draws everything crisp, because it is asking to see the station rather
// than the storey being edited. The dim/clear caches are keyed by live materials
// and are dropped with the chunk rebuild (`releaseChunks`), or they would pin
// dead materials forever. The 剖切 clip is not here any more: `SectionSystem`
// owns the plane and the highlighted surface.

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
  /** The cut's plane while a cut is on, shared by every material this walk dresses. */
  private clip: THREE.Plane | null = null

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

  setHideRoof(on: boolean): void {
    this.ctx.hideRoof = on
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
   * **隐藏UI draws everything opaque.** All of that is drawing furniture — a
   * sheet of 35% dark laid over the station so the storey being edited reads —
   * and it is exactly the lie the mode exists to avoid: the slab a storey up
   * ghosts *through* the floor under the eye, and what should be a granite
   * concourse reads as a dark shadow grid. So it puts the slice away
   * (`sliceOptions`) and hands every mesh its **base** material back — not merely
   * a `visible` flag, which could turn a piece on but could not undo the ghost
   * clip the slice had already assigned it (`mesh.material = base` in the walk
   * below; a wall comes back through `dressWall` instead). 隐藏墙壁 and 隐藏地面
   * are the two toggles that stay: one is a deliberate look-through of the
   * station's own walls and the other takes the street plane away altogether —
   * neither is a way of drawing a storey.
   */
  applyLevel(): void {
    // This walks every chunk mesh and every module group in the station, so it is
    // the most expensive thing a view toggle does. One edit can ask for it three
    // times (`setStation` → `setLevel`, then `setAutoCeiling`, then `setCutaway`),
    // and two of those usually change nothing — so skip a repeat with the same
    // slice. `setStation` clears the key because it rebuilds the meshes this
    // assigns materials to.
    const key = `${this.ctx.activeZ}|${this.ctx.ghost}|${this.ctx.autoCeiling}|${this.ctx.hideWalls}|${this.ctx.hideGround}|${this.ctx.hideRoof}|${this.ctx.hideUI}|${this.ctx.cutaway}`
    if (key === this.ctx.levelKey) return
    this.ctx.levelKey = key
    // One record for the whole walk: what the view asks of the slice this frame.
    const slice = sliceOptions({
      ghost: this.ctx.ghost,
      autoCeiling: this.ctx.autoCeiling,
      hideUI: this.ctx.hideUI,
      cutaway: this.ctx.cutaway,
    })
    this.slice.ghost = slice.ghost
    this.slice.autoCeiling = slice.autoCeiling
    // **隐藏UI and 剖切 draw everything opaque**: they put the slice away, which is
    // the one thing a visibility flag could not do on its own — the 35% ghost
    // *material* the slice assigned a piece has to be undone. While a cut is on
    // this also settles which half of the station is invisible: the only thing
    // allowed to hide anything is the plane.
    const straight = this.ctx.hideUI || this.ctx.cutaway
    // The cut comes **after** the outer cut, never before: a ghost clone made
    // before the plane was switched on carries no planes of its own, so assigning
    // it here is what stops the slice's own materials being holes in the cut.
    const clip = this.ctx.cutaway ? this.clip : null
    for (const [lz, group] of this.chunks.levelGroups) {
      group.visible = true
      const side = levelSide([lz], this.ctx.activeZ)
      for (const child of group.children) {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) continue
        const isOutline = this.chunks.outlineSet.has(mesh)
        // **隐藏地面: the street plane, gone in every mode.** It is the generated
        // window (`sim/ground.ts`), meshed as its own pass and tagged `ground`
        // (`ChunkSystem.meshStation`), so this is one flag read per mesh and not a
        // rebuild. Like 隐藏墙壁 it stands outside the slice — it is a surface the
        // player asked to be rid of, not a way of drawing a storey — and like every
        // other mesh here it gets its material and its `visible` flag back from the
        // branches below the moment it is switched off.
        if (this.ctx.hideGround && mesh.userData.ground === true) {
          mesh.visible = false
          continue
        }
        if (straight) {
          mesh.visible = true
          const base = isOutline ? mesh.userData.baseMaterial ?? mesh.material : this.baseOf(mesh)
          // **The base material has to be handed back here.** `dressWall` only
          // assigns one for a wall it takes over; for everything else it returns
          // false and leaves the mesh wearing whatever the slice gave it — which is
          // the 35% ghost of the storey below. So the floors, ceilings and slabs this
          // mode is about kept their ghost, and the storey under the camera showed
          // through them: 隐藏UI drew every storey as itself except the ones it was
          // for. Walls were the one piece that came back, because `dressWall`
          // restored them — which is why the leak read as "the lower floors are
          // transparent" rather than "everything is".
          if (!this.dressWall(mesh, base, isOutline, clip)) mesh.material = base
          this.clipMesh(mesh, clip)
          continue
        }
        // A plate with nothing under it (the street outside, a canopy on its own
        // columns) survives 隐藏天花板; a supported slab is that room's ceiling.
        this.slice.unsupported = mesh.userData.float === true
        mesh.visible = levelVisible(side, this.slice)
        if (!mesh.visible) continue
        // **A wall takes its `visible` flag from this branch, not from the walk
        // before it** — and the walk may have been the one that hid it (隐藏墙壁 with
        // a cut on hides walls outright). Setting it back is what lets a wall return
        // when either toggle is switched off.
        if (mesh.userData.wall === true) {
          mesh.visible = true
          this.dressWall(mesh, this.baseOf(mesh), isOutline, clip)
          this.clipMesh(mesh, clip)
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
    const roof = kind === 'module' && root.userData.roof === true
    if (roof && this.ctx.hideRoof) {
      root.visible = false
      return
    }
    const levels = root.userData.levelZs as number[] | undefined
    const lz = root.userData.levelZ as number | undefined
    const zs = levels ?? (lz !== undefined ? [lz] : undefined)
    const side = levelSide(zs, this.ctx.activeZ)
    const straight = this.ctx.hideUI || this.ctx.cutaway
    if (straight) {
      // 隐藏UI / 剖切: drawn, and drawn as itself — a 售票机, a 屏蔽门 or a consist
      // does not become a 35% ghost because it stands on another storey.
      root.visible = kind === 'train' ? root.userData.parked !== true : true
    } else if (kind === 'train') {
      root.visible = trainVisible(side, this.ctx.ghost, root.userData.parked === true)
    } else {
      // A fixture whose column starts above the active storey stands on a plate
      // that is itself above it — the fixture's `float`, so 隐藏天花板 keeps it.
      const ground = root.userData.groundBand as number | undefined
      this.slice.unsupported = unsupportedAbove(this.ctx.activeZ, ground)
      root.visible = levelVisible(side, roof ? { ...this.slice, autoCeiling: false } : this.slice)
    }
    if (!root.visible) return
    const clip = this.ctx.cutaway ? this.clip : null
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const base = this.baseOf(mesh)
      // 隐藏墙壁: a wall panel or a platform screen door reads through — and goes
      // altogether while a cut is on (`dressWall`).
      if (this.dressWall(mesh, base, false, clip)) return
      mesh.material = side === 'active' || straight ? base : this.dimOf(base)
      this.clipMesh(mesh, clip)
    })
  }

  /**
   * Point one mesh's material at the cut's plane, or clear it again.
   *
   * This has to happen on the material the mesh is **actually wearing** and on
   * every material the slice derived and cached (`dimMats`, `clearMats`), and it
   * has to be re-stated by every walk. A clone made before the cut was switched on
   * carries no planes of its own and is handed out again on the next walk, so
   * without this the geometry in the half that should be gone comes back at full
   * strength — a cut where nothing is really cut.
   */
  private clipMesh(mesh: THREE.Mesh, plane: THREE.Plane | null): void {
    const mat = mesh.material as THREE.Material
    if (!mat) return
    const planes = plane ? [plane] : null
    if (mat.clippingPlanes === planes) return
    mat.clippingPlanes = planes
    mat.needsUpdate = true
  }

  /**
   * Put the cut's plane on a material by reference — the ones 显示其他层 and
   * 隐藏墙壁 cached (`SectionSystem.applyClip` shares its plane this way). Handing
   * over the same `THREE.Plane` object is what keeps a slide to two numbers.
   */
  setClip(plane: THREE.Plane | null): void {
    if (this.clip === plane) return
    this.clip = plane
    // The next walk re-states the planes on every material, so it must not be
    // skipped as a repeat: the plane's *membership* changed even though the
    // slice's toggles did not.
    this.ctx.levelKey = ''
    this.applyLevel()
  }

  baseOf(mesh: THREE.Mesh): THREE.Material {
    if (!mesh.userData.base) mesh.userData.base = mesh.material
    return mesh.userData.base as THREE.Material
  }

  /**
   * **隐藏墙壁**, in both slices. It is the one toggle that survives a cut (it is a
   * look-through, not a way of drawing a storey), but it cannot mean the same thing
   * in both modes:
   *
   * * Slice **on**: walls read through at 16%, and their dark outline hull is
   *   dropped — left in, that hull draws a solid black wall around its own
   *   translucent faces.
   * * Cut **on**: the slice is put away and geometry is clipped instead, so a wall
   *   in the kept half still stands between the camera and everything behind it.
   *   A translucent wall is still an occluder you can see through *badly*: the
   *   whole point of the pair is to look at what the cut exposes, so a wall the
   *   player asked to hide goes **completely** — faces and hull alike.
   *
   * Returns true when the mesh was taken over (hidden, or given the see-through
   * clone), so the caller knows not to dress it again.
   */
  private dressWall(mesh: THREE.Mesh, base: THREE.Material, isOutline: boolean, clip: THREE.Plane | null): boolean {
    const wall = mesh.userData.wall === true
    // Leaving 隐藏墙壁: put the wall back as the building rather than as a
    // see-through clone. This has to happen here and not only in the walk, because
    // with a cut on the walk's *slice* does not change when this toggle does — it
    // is already `straight` — so the walk is skipped as a repeat and nothing would
    // ever hand the base material back.
    if (!this.ctx.hideWalls) {
      if (wall) {
        mesh.visible = true
        mesh.material = base
        this.clipMesh(mesh, clip)
      }
      return false
    }
    if (!wall) return false
    if (isOutline || this.ctx.cutaway) {
      mesh.visible = false
      return true
    }
    mesh.material = this.clearOf(base)
    this.clipMesh(mesh, clip)
    return true
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
    // **A clone follows its original.** The cache is keyed by the material it came
    // from and is handed out again on later walks, so it has to take the current
    // clipping planes with it: left holding the planes it was cloned with, it is a
    // ghost that stays cut after the cut is switched off, or one that never is.
    d.clippingPlanes = base.clippingPlanes ?? null
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
    // 隐藏墙壁's clone follows its original for the same reason 显示其他层's does.
    c.clippingPlanes = base.clippingPlanes ?? null
    return c
  }

  /** 隐藏墙壁: fade every wall and platform screen door, or restore them. */
  setHideWalls(on: boolean): void {
    this.ctx.hideWalls = on
    this.applyLevel()
  }

  /**
   * 隐藏地面: draw the street plane, or take it away. It is the one surface with a
   * pass of its own (`ChunkSystem.meshStation`), so the walk below is the whole of
   * it — nothing about the station, the document or the walk graph moves.
   */
  setHideGround(on: boolean): void {
    if (this.ctx.hideGround === on) return
    this.ctx.hideGround = on
    this.applyLevel()
  }

  /**
   * 隐藏UI. The slice stops being a slice: the station as it is, with every
   * storey drawn as itself and no ceiling lifted, and with the editing lattice
   * gone as well (`GridSystem`). One slice, one owner, so the pieces and the
   * fixtures cannot disagree about it (`sliceOptions`).
   */
  setHideUI(on: boolean): void {
    if (this.ctx.hideUI === on) return
    this.ctx.hideUI = on
    this.applyLevel()
  }

  /** 剖切: while a cut is on, the slice is put away — the cut hides, nothing else. */
  get cutaway(): boolean {
    return this.ctx.cutaway
  }

  setCutaway(on: boolean): void {
    if (this.ctx.cutaway === on) return
    this.ctx.cutaway = on
    this.applyLevel()
  }
}
