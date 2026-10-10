// TrainSystem — rolling stock: consist poses between worker ticks, per-bank
// door easing and the platform-screen doors that open with the berthed train
// (moved verbatim from `render/scene.ts`: `setTrains`, `updateTrains`,
// `advanceTrainDoors`, `advanceDoors`).
//
// GAME-SPEC §6 (trains) and §1.13 (door banks): the worker sends one pose per
// live train per tick, so each consist is drawn between its last two poses.

import * as THREE from 'three'
import { buildTrain, disposeObject, setDoors, setDoorsSides } from '../../models.ts'
import { storeyBand } from '../../../sim/constants.ts'
import { STOCK, STOCK_CLASSES } from '../../../sim/stock.ts'
import type { StockClass } from '../../../sim/stock.ts'
import { SceneSystem } from './SceneSystem.ts'
import type { SceneContext } from './SceneSystem.ts'
import type { LevelSystem } from './LevelSystem.ts'

/**
 * One live consist. The worker only reports a pose per tick (1 Hz at 1×), so the
 * group carries the last two poses and is drawn between them each animation
 * frame — otherwise the train would jump a tick's worth of distance at a time.
 */
interface TrainEntry {
  group: THREE.Group
  sig: string
  /** Pose at the previous snapshot. */
  from: THREE.Vector3
  /** Pose at the current snapshot. */
  to: THREE.Vector3
  /** Whether the consist was present in the previous snapshot. */
  active: boolean
  /** Snapshots this consist has been absent for, so an old one can be evicted. */
  missed: number
}

/** Sim seconds a door leaf takes to travel fully open or shut (matches the sim's
 *  `TRAIN_DOOR_TRAVEL`; the renderer eases toward the commanded state). */
const DOOR_TRAVEL_S = 2

/**
 * How many consecutive snapshots a consist may be missing before it is dropped.
 *
 * A signature is a *configuration* (colour, direction, cars, stock, yaw, door side),
 * and an edit that changes one — a new line, a recolour, a track moved — used to mint
 * a whole consist that was then parked and kept forever: invisible, but still walked
 * by every storey slice and every state frame. A train between services is absent for
 * a long stretch, so the threshold only has to outlast the gap between the sim
 * splicing a departed consist and the renderer drawing the last snapshot that
 * mentioned it.
 */
const TRAIN_MISSES_ALLOWED = 4

export class TrainSystem extends SceneSystem {
  trainGroup: THREE.Group = new THREE.Group()
  private trainSlots = new Map<string, TrainEntry>()
  /** Platform-screen-door runs with their berth position, for per-rail opening. */
  psdGroups: Array<{ group: THREE.Object3D; x: number; y: number; z: number; half: number; fx: number; fy: number }> = []
  /** Level slicing for newly arrived consists; wired by the orchestrator. */
  level!: LevelSystem

  constructor(ctx: SceneContext) {
    super(ctx)
    this.ctx.scene.add(this.trainGroup)
  }

  /**
   * Rolling stock (§6). The worker sends one pose per live train as a flat
   * `Float32Array`, stride 10: x, y, z, cars, stock index, doors-open, colour,
   * direction, yaw, door-side mask. A consist is cached by its signature (colour
   * + direction + length + mask), so it survives slot reordering, and its two
   * latest poses are kept so `updateTrains` can glide it between ticks.
   *
   * The mask says which door banks may open (§1.13): bit 0 the consist's local
   * +y, bit 1 its local −y. Only a side with platform screen doors is set, so
   * the leaves on the tunnel-wall side stay shut however long the train stands.
   */
  setTrains(buffer: Float32Array): void {
    const STRIDE = 10
    const n = Math.min(Math.floor(buffer.length / STRIDE), 64)
    for (const entry of this.trainSlots.values()) {
      entry.active = false
      entry.missed++
    }
    const openTrains: Array<{ x: number; y: number; z: number; fx: number; fy: number; half: number }> = []
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE
      const x = buffer[o]
      const y = buffer[o + 1]
      const z = buffer[o + 2]
      const cars = buffer[o + 3] | 0
      const stockIdx = buffer[o + 4] | 0
      const doorsOpen = buffer[o + 5] > 0.5
      const colour = buffer[o + 6] & 0xffffff
      const dirSign = buffer[o + 7] >= 0 ? 1 : -1
      const yaw = buffer[o + 8]
      const doorSides = buffer[o + 9] | 0
      if (doorsOpen && doorSides !== 0) {
        const cls = STOCK_CLASSES[stockIdx] ?? 'B'
        openTrains.push({ x, y, z, fx: Math.cos(yaw), fy: Math.sin(yaw), half: (STOCK[cls].length * cars) / 2 })
      }
      const sig = `${colour}:${dirSign}:${cars}:${stockIdx}:${yaw}:${doorSides}`
      let entry = this.trainSlots.get(sig)
      if (!entry) {
        const stock: StockClass = STOCK_CLASSES[stockIdx] ?? 'B'
        const group = buildTrain(this.ctx.modelMats, { x, y, z, cars, stock, doorsOpen, colour: `#${colour.toString(16).padStart(6, '0')}`, dirSign, yaw })
        // The storey the consist stands in: its track surface is half a metre
        // below the platform, so the walk-surface convention (`cell z + 1`)
        // rounds back to the floor block the train rides over. Without the
        // rounding a consist berthed at -16 banded to -16.5 — below the storey
        // it is standing on — and vanished with 显示其他层 off.
        group.userData.levelZs = [storeyBand(Math.round(z - 1), this.ctx.levelBase)]
        group.userData.doorT = [0, 0]
        this.trainGroup.add(group)
        entry = { group, sig, from: new THREE.Vector3(x, y, z), to: new THREE.Vector3(x, y, z), active: true, missed: 0 }
        this.trainSlots.set(sig, entry)
      } else {
        // Continue from where this consist was last drawn. A consist that has
        // reappeared after a **short** gap (a stop it was parked through, a frame or
        // two of the sim splicing it out) snaps to its approach start rather than
        // streaking back across the platform; one absent for longer than
        // `TRAIN_MISSES_ALLOWED` was evicted above, so this branch never sees it.
        if (entry.missed === 1) entry.from.copy(entry.group.position)
        else entry.from.set(x, y, z)
        entry.to.set(x, y, z)
        entry.active = true
        entry.missed = 0
      }
      // `visible` here is the sim's own state — a consist between services is
      // parked — and `parked` carries it across an `applyLevel`, which owns the
      // flag otherwise (the level slicing and the sim both write it).
      entry.group.userData.parked = false
      // Doors ease open and shut per bank in `updateTrains`, never snapping.
      entry.group.userData.doorOpen = doorsOpen ? 1 : 0
      entry.group.userData.doorSides = doorSides
      this.level.applyGroupLevel(entry.group, 'train')
    }
    for (const [sig, entry] of [...this.trainSlots]) {
      // Park it first: the sim's own state (a consist between services) is what the
      // storey slice reads, and a stale entry is parked exactly like a waiting one.
      if (!entry.active) {
        entry.group.userData.parked = true
        entry.group.visible = false
      }
      // Long gone: drop the consist, its geometry and its livery. A later service
      // with the same configuration builds a fresh group (a cache miss, once per
      // arrival) rather than the whole session paying for every configuration the
      // player ever built and then changed.
      if (entry.missed <= TRAIN_MISSES_ALLOWED) continue
      this.dropConsist(entry.group)
      this.trainSlots.delete(sig)
    }
    // A screen opens with the consist berthed at its own rail — not with any
    // train of the line — so 上行/下行 (and two stations on one line) move
    // independently. Both island faces match the one consist between them.
    for (const psd of this.psdGroups) {
      let open = false
      for (const t of openTrains) {
        if (Math.abs(psd.z - t.z) > 2) continue
        const dx = psd.x - t.x
        const dy = psd.y - t.y
        const along = Math.abs(dx * t.fx + dy * t.fy)
        const across = Math.abs(dx * t.fy - dy * t.fx)
        if (along <= t.half + psd.half + 2 && across <= 3.5) {
          open = true
          break
        }
      }
      psd.group.userData.doorTarget = open ? 1 : 0
    }
    this.updateTrains(performance.now(), 0)
  }

  /** Place every visible consist between its last two worker poses, and ease doors. */
  updateTrains(now: number, dt: number): void {
    const alpha = Math.min(1, Math.max(0, (now - this.ctx.lastStateTime) / this.ctx.stateIntervalMs))
    for (const entry of this.trainSlots.values()) {
      if (!entry.group.visible) continue
      entry.group.position.lerpVectors(entry.from, entry.to, alpha)
      this.advanceTrainDoors(entry.group, dt)
    }
    for (const psd of this.psdGroups) this.advanceDoors(psd.group, dt)
  }

  /**
   * Ease a consist's two door banks separately (§1.13). A bank opens only when
   * the doors are commanded open *and* its bit is set in the berth's mask, so
   * the side facing the tunnel wall never opens — that side simply has no
   * platform screen doors to meet.
   */
  private advanceTrainDoors(root: THREE.Object3D, dt: number): void {
    const sides = (root.userData.doorSides as number) ?? 0
    const open = ((root.userData.doorOpen as number) ?? 0) > 0.5
    const target = [open && (sides & 1) !== 0 ? 1 : 0, open && (sides & 2) !== 0 ? 1 : 0]
    const t = (root.userData.doorT as number[] | undefined) ?? [0, 0]
    const step = (dt * (1000 / this.ctx.stateIntervalMs)) / DOOR_TRAVEL_S
    for (let i = 0; i < 2; i++) {
      const cur = t[i]
      if (cur === target[i]) continue
      t[i] = target[i] > cur ? Math.min(target[i], cur + step) : Math.max(target[i], cur - step)
    }
    root.userData.doorT = t
    setDoorsSides(root, t[0], t[1])
  }

  /**
   * Ease one group's doors toward their target. A leaf takes `DOOR_TRAVEL_S` of
   * sim time to cross, so the motion stays proportional to the sim clock at any
   * fast-forward multiplier (`stateIntervalMs` shrinks as speed climbs).
   */
  private advanceDoors(root: THREE.Object3D, dt: number): void {
    const target = (root.userData.doorTarget as number) ?? 0
    const cur = (root.userData.doorT as number) ?? 0
    if (cur === target) return
    const step = (dt * (1000 / this.ctx.stateIntervalMs)) / DOOR_TRAVEL_S
    const t = target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step)
    root.userData.doorT = t
    setDoors(root, t)
  }

  /**
   * Take one consist off the scene for good: its geometry, its per-consist livery
   * (`TrainModel` tags what it minted in `userData.ownedMats`) and any instance
   * buffers it holds. The materials of the shared kit are kept — they are drawn by
   * the next consist too.
   */
  private dropConsist(group: THREE.Group): void {
    this.trainGroup.remove(group)
    disposeObject(group)
    const owned = group.userData.ownedMats as THREE.Material[] | undefined
    if (!owned) return
    for (const m of owned) {
      const map = (m as THREE.MeshStandardMaterial).map
      if (map) map.dispose()
      m.dispose()
    }
    group.userData.ownedMats = []
  }

  override dispose(): void {
    for (const entry of this.trainSlots.values()) this.dropConsist(entry.group)
    this.trainSlots.clear()
  }
}
