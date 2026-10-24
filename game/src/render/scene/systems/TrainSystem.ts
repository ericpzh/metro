// TrainSystem — rolling stock: consist poses between worker ticks, per-bank
// door easing and the platform-screen doors that open with the berthed train
// (moved verbatim from `render/scene.ts`: `setTrains`, `updateTrains`,
// `advanceTrainDoors`, `advanceDoors`).
//
// GAME-SPEC §6 (trains) and §1.13 (door banks): the worker sends one pose per
// live train per tick, so each consist is drawn between its last two poses.

import * as THREE from 'three'
import { batchStaticParts } from '../../batchStaticModule.ts'
import { batchTrainDoors, batchTrainTransparent } from '../../trainBatches.ts'
import { buildTrain, disposeObject, setDoors, setDoorsSides } from '../../models.ts'
import type { TrainPose } from '../../models.ts'
import type { StationData } from '../../../sim/types.ts'
import { trainPreparationPoses } from '../../trainPreparation.ts'
import { storeyBand } from '../../../sim/constants.ts'
import { STOCK, STOCK_CLASSES, trainOriginForScale, trainScaleForStorey } from '../../../sim/stock.ts'
import type { StockClass } from '../../../sim/stock.ts'
import { SceneSystem } from './SceneSystem.ts'
import type { SceneContext } from './SceneSystem.ts'
import type { LevelSystem } from './LevelSystem.ts'
import { trainDetails } from '../../trainDetail.ts'
import type { TrainDetail } from '../../trainDetail.ts'
import { levelSide } from '../../levelSlicing.ts'

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
 * Keep eight dormant configurations for later services. The least recently seen
 * is evicted when the cache fills, bounding geometry while avoiding arrival-time
 * rebuilding of every repeated service.
 */
const TRAIN_PARKED_LIMIT = 8

export class TrainSystem extends SceneSystem {
  /** Reuse live interpolated consists; parked fleet models are never audible. */
  nearestSoundPosition(x:number,y:number,z:number):[number,number,number]|null {
    let best:THREE.Vector3|null=null,distance=Infinity
    for(const entry of this.trainSlots.values())if(entry.active){
      const p=entry.group.position,d=(p.x-x)**2+(p.y-y)**2+(p.z-z)**2
      if(d<distance){best=p;distance=d}
    }
    return best?[best.x,best.y,best.z]:null
  }
  /**
   * One swap per drawn piece of a consist. `near`/`far` are geometry references the
   * source owns (or, for a door bank's cloned approximation, the batch owns), so a
   * transition only reassigns a reference: no geometry is built, uploaded or rebuilt.
   */
  private details = new Map<THREE.Group, TrainDetail[]>()

  /** Geometry changes keep the consist, door matrices and all animation references. */
  updateGeometryDetail(): void {
    for (const [group, details] of this.details) {
      const reduced = this.ctx.detailEnabled !== false &&
        (this.ctx.graphicsQuality === 'low' || (!this.ctx.hideUI && levelSide(group.userData.levelZs, this.ctx.activeZ) !== 'active'))
      if (group.userData.trainReduced === reduced) continue
      group.userData.trainReduced = reduced
      for (const detail of details) detail.apply(reduced)
    }
  }
  trainGroup: THREE.Group = new THREE.Group()
  private trainSlots = new Map<string, TrainEntry>()
  private drawBatching = true
  private lastBuffer = new Float32Array()
  private preparationKey = ''

  /** Prepare the bounded service fleet during station opening, before playback.
   * Parked models carry no live service or pose until the worker reports one. */
  prepareForStation(data: StationData): void {
    const buffer = trainPreparationPoses(data, TRAIN_PARKED_LIMIT)
    const key = Array.from(buffer).join(',')
    if (key === this.preparationKey) return
    this.preparationKey = key
    const occurrences = new Map<string, number>(), wanted = new Set<string>()
    const modelScale = trainScaleForStorey(this.ctx.storeyHeight)
    for (let o = 0; o < buffer.length; o += 10) {
      const [x,y,z,cars,stockIdx,,colour,dirSign,yaw,flags] = buffer.subarray(o,o+10)
      const shapeKey = `${modelScale}:${dirSign}:${cars}:${stockIdx}:${yaw}:${flags}`
      const modelKey = `${modelScale}:${colour}:${dirSign}:${cars}:${stockIdx}:${yaw}:${flags}`
      const occurrence = occurrences.get(modelKey) ?? 0
      occurrences.set(modelKey, occurrence+1)
      const sig = `${modelKey}:${occurrence}`
      wanted.add(sig)
      if (this.trainSlots.has(sig)) continue
      const entry = this.createEntry(sig, shapeKey, {x,y,z,cars,stock:STOCK_CLASSES[stockIdx] ?? 'B',
        colour:`#${colour.toString(16).padStart(6,'0')}`, dirSign,yaw,modelScale,doorsOpen:false,
        power:(flags&4) !== 0 ? 'catenary' : 'third-rail'})
      entry.active = false; entry.missed = 2
      entry.group.userData.parked = true; entry.group.visible = false
    }
    const parked = [...this.trainSlots.values()].filter(entry => !entry.active)
    for (const entry of parked.filter(entry => !wanted.has(entry.sig)).slice(0, Math.max(0, parked.length-TRAIN_PARKED_LIMIT))) {
      this.dropConsist(entry.group); this.trainSlots.delete(entry.sig)
    }
    this.updateGeometryDetail()
  }

  private createEntry(sig: string, shapeKey: string, pose: TrainPose): TrainEntry {
    const group = buildTrain(this.ctx.modelMats, pose)
    group.userData.renderFamily = 'train'
    group.userData.shapeKey = shapeKey
    batchStaticParts(group, new Set(group.userData.doors as THREE.Object3D[]), this.drawBatching)
    if (this.drawBatching) { batchTrainDoors(group); batchTrainTransparent(group) }
    this.details.set(group, trainDetails(group))
    group.userData.doorT = [0, 0]
    this.trainGroup.add(group)
    const entry = { group, sig, from: new THREE.Vector3(pose.x,pose.y,pose.z), to: new THREE.Vector3(pose.x,pose.y,pose.z), active:true, missed:0 }
    this.trainSlots.set(sig, entry)
    return entry
  }

  /** Profiling ablation on the same scene/assets; does not change simulation. */
  setDrawBatching(enabled: boolean): void {
    if (this.drawBatching === enabled) return
    this.drawBatching = enabled
    this.preparationKey = ''
    for (const entry of this.trainSlots.values()) this.dropConsist(entry.group)
    this.trainSlots.clear()
    this.setTrains(this.lastBuffer)
  }
  /** Platform-screen-door runs with their berth position, for per-rail opening. */
  psdGroups: Array<{ group: THREE.Object3D; x: number; y: number; z: number; half: number; fx: number; fy: number }> = []
  /** Level slicing for newly arrived consists; wired by the orchestrator. */
  level!: LevelSystem
  /** False while the sim is paused: doors hold their pose like the crowd. */
  private playing = true
  /** Keep the first post-resume snapshot anchored to the pose shown during pause. */
  private resumeSnapshotPending = false

  constructor(ctx: SceneContext) {
    super(ctx)
    this.ctx.scene.add(this.trainGroup)
  }

  /**
   * Rolling stock (§6). The worker sends one pose per live train as a flat
   * `Float32Array`, stride 10: x, y, z, cars, stock index, doors-open, colour,
   * direction, yaw, door/power flags (bits 0–1 doors, bit 2 catenary).
   * A consist is cached by its signature (colour + direction + length + flags),
   * so it survives slot reordering, and its two
   * latest poses are kept so `updateTrains` can glide it between ticks.
   *
   * The mask says which door banks may open (§1.13): bit 0 the consist's local
   * +y, bit 1 its local −y. Only a side with platform screen doors is set, so
   * the leaves on the tunnel-wall side stay shut however long the train stands.
   */
  setTrains(buffer: Float32Array): void {
    this.lastBuffer = buffer.slice()
    const STRIDE = 10
    const n = Math.min(Math.floor(buffer.length / STRIDE), 64)
    for (const entry of this.trainSlots.values()) {
      entry.active = false
      entry.missed++
    }
    const openTrains: Array<{ x: number; y: number; z: number; fx: number; fy: number; half: number }> = []
    const occurrences = new Map<string, number>()
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
      const flags = buffer[o + 9] | 0
      const doorSides = flags & 3
      const power = (flags & 4) !== 0 ? 'catenary' : 'third-rail'
      if (doorsOpen && doorSides !== 0) {
        const cls = STOCK_CLASSES[stockIdx] ?? 'B'
        openTrains.push({ x, y, z, fx: Math.cos(yaw), fy: Math.sin(yaw), half: (STOCK[cls].length * cars * trainScaleForStorey(this.ctx.storeyHeight)) / 2 })
      }
      const modelScale = trainScaleForStorey(this.ctx.storeyHeight)
      const modelKey = `${modelScale}:${colour}:${dirSign}:${cars}:${stockIdx}:${yaw}:${flags}`
      // A snapshot may contain several identical consists on different tracks.
      // Appearance selects the model, while its occurrence owns a distinct pose.
      const occurrence = occurrences.get(modelKey) ?? 0
      occurrences.set(modelKey, occurrence + 1)
      const sig = `${modelKey}:${occurrence}`
      let entry = this.trainSlots.get(sig)
      const shapeKey = `${modelScale}:${dirSign}:${cars}:${stockIdx}:${yaw}:${flags}`
      if (!entry) {
        // A colour edit posts the same pose without stepping. Re-key that live
        // consist and recolour its owned material; retain door rigs and buffers.
        entry = [...this.trainSlots.values()].find(e => e.missed === 1 &&
          e.group.userData.shapeKey === shapeKey && (e.to.x-x)**2+(e.to.y-y)**2+(e.to.z-z)**2 < 0.001)
          ?? [...this.trainSlots.values()].find(e=>e.missed>1 && e.group.userData.shapeKey===shapeKey)
        if (entry) {
          this.trainSlots.delete(entry.sig)
          entry.sig = sig
          const material = entry.group.userData.liveryMaterial as THREE.MeshStandardMaterial
          material.color.setHex(colour)
          this.trainSlots.set(sig, entry)
        }
      }
      if (!entry) {
        const stock: StockClass = STOCK_CLASSES[stockIdx] ?? 'B'
        entry = this.createEntry(sig, shapeKey, { x,y,z,cars,stock,power,doorsOpen,modelScale,
          colour:`#${colour.toString(16).padStart(6,'0')}`,dirSign,yaw })
      } else {
        // Continue from where this consist was last drawn. A consist that has
        // reappeared after an absent snapshot snaps to its approach start rather
        // than streaking back across the platform from its previous service.
        if (this.resumeSnapshotPending && !entry.group.userData.parked) entry.from.copy(entry.group.position)
        else if (entry.missed === 1) entry.from.copy(entry.group.position)
        else {
          entry.from.set(x, y, z)
          // Prepared/parked consists have no current live pose. A first paused
          // snapshot must place them too, without waiting for interpolation.
          entry.group.position.set(x, y, z)
        }
        entry.to.set(x, y, z)
        entry.active = true
        entry.missed = 0
      }
      // `visible` here is the sim's own state — a consist between services is
      // parked — and `parked` carries it across an `applyLevel`, which owns the
      // flag otherwise (the level slicing and the sim both write it).
      // Recover the track anchor from the platform-aligned cabin origin, including cached poses.
      entry.group.userData.levelZs = [storeyBand(Math.round(z - trainOriginForScale(modelScale)), this.ctx.levelBase, this.ctx.storeyHeight)]
      entry.group.userData.parked = false
      // Doors ease open and shut per bank in `updateTrains`, never snapping.
      entry.group.userData.doorOpen = doorsOpen ? 1 : 0
      entry.group.userData.doorSides = doorSides
      this.level.applyGroupLevel(entry.group, 'train')
    }
    const parked: TrainEntry[] = []
    for (const entry of this.trainSlots.values()) {
      // Park it first: the sim's own state (a consist between services) is what the
      // storey slice reads, and a stale entry is parked exactly like a waiting one.
      if (!entry.active) {
        entry.group.userData.parked = true
        entry.group.visible = false
        parked.push(entry)
      }
    }
    parked.sort((left, right) => left.missed - right.missed)
    for (const entry of parked.slice(TRAIN_PARKED_LIMIT)) {
      this.dropConsist(entry.group)
      this.trainSlots.delete(entry.sig)
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
    this.resumeSnapshotPending = false
    this.updateTrains(performance.now(), 0)
  }

  /** Place every visible consist between its last two worker poses, and ease doors. */
  updateTrains(now: number, dt: number): void {
    const alpha = Math.min(1, Math.max(0, (now - this.ctx.lastStateTime) / this.ctx.stateIntervalMs))
    const doorDt = this.playing ? dt : 0
    for (const entry of this.trainSlots.values()) {
      if (!entry.group.visible) continue
      if (this.playing) entry.group.position.lerpVectors(entry.from, entry.to, alpha)
      this.advanceTrainDoors(entry.group, doorDt)
    }
    for (const psd of this.psdGroups) if (psd.group.visible) this.advanceDoors(psd.group, doorDt)
  }

  /** Freeze train poses and doors while paused; resume interpolation from the held pose. */
  setPlaying(on: boolean): void {
    if (on === this.playing) return
    if (on) {
      for (const entry of this.trainSlots.values()) entry.from.copy(entry.group.position)
      this.resumeSnapshotPending = true
    }
    this.playing = on
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
    if (t[0] !== root.userData.lastDoorLeft || t[1] !== root.userData.lastDoorRight) {
      root.userData.doorT = t
      setDoorsSides(root, t[0], t[1])
      root.userData.lastDoorLeft = t[0]
      root.userData.lastDoorRight = t[1]
    }
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
    const details = this.details.get(group) ?? []
    // Restore the exact sources before disposal: a batch's swapped-in geometry is
    // released by the batch (glass) or by the source's own dispose listener (a
    // merged body piece). A door bank's clone is the one buffer nobody else owns.
    for (const detail of details) detail.apply(false)
    for (const detail of details) detail.dispose?.()
    this.details.delete(group)
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
