// LiftSystem — vertical transport: elevator cabins gliding between sim
// snapshots plus the escalator step bands rolling with the sim clock (moved
// verbatim from `render/scene.ts`: `setLifts`, `updateLifts`,
// `updateEscalators`).
//
// GAME-SPEC lift/escalator motion: the sim sends cabin heights and door
// fractions; the renderer eases between snapshots so motion stays smooth at
// any fast-forward multiplier. The escalator bands are sibling vertical
// transport, driven by the same simulated time.

import type * as THREE from 'three'
import { rollEscalator, setDoors } from '../../models.ts'
import type { EscalatorRoll } from '../../models.ts'
import { SceneSystem } from './SceneSystem.ts'

/**
 * One elevator cabin. The shaft is built once; the sim sends the car's cabin
 * height and door fraction, and the renderer glides the cabin and eases the
 * doors between snapshots. `key` is the module's `x,y,fromZ`, which pairs a car
 * with its shaft.
 */
export interface LiftRig {
  key: string
  group: THREE.Object3D
  cabin: THREE.Object3D
  /** The group origin's z, so the cabin offset is `cabinZ - originZ`. */
  originZ: number
  /** Cabin floor height at the previous and current snapshots, world z. */
  baseFrom: number
  baseTo: number
  /** Door fraction at the previous and current snapshots, 0 shut … 1 open. */
  doorFrom: number
  doorTo: number
  /** False until the first snapshot names this rig. */
  have: boolean
}

export class LiftSystem extends SceneSystem {
  /** Elevator cabins, moved and opened from the sim car state. */
  liftRigs: LiftRig[] = []
  /** The shaft meshes, so a hover can find a lift and its height to extend it. */
  liftPickMeshes: THREE.Mesh[] = []
  /** Live escalator step bands, rolled every frame from the sim clock. */
  escalatorRolls: EscalatorRoll[] = []

  /**
   * One pose per elevator car, stride 6: plan x, plan y, lower cell z, upper
   * cell z, cabin floor height, door fraction. Pairs each car with its shaft by
   * the first three numbers and queues the new cabin position for gliding.
   */
  setLifts(buffer: Float32Array): void {
    const STRIDE = 6
    const n = Math.floor(buffer.length / STRIDE)
    for (const rig of this.liftRigs) {
      if (rig.have) {
        rig.baseFrom = rig.baseTo
        rig.doorFrom = rig.doorTo
      }
    }
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE
      const key = `${buffer[o] | 0},${buffer[o + 1] | 0},${buffer[o + 2] | 0}`
      const rig = this.liftRigs.find((r) => r.key === key)
      if (!rig) continue
      if (!rig.have) {
        rig.baseFrom = buffer[o + 4]
        rig.doorFrom = buffer[o + 5]
        rig.have = true
      }
      rig.baseTo = buffer[o + 4]
      rig.doorTo = buffer[o + 5]
    }
  }

  /** Glide every cabin between snapshots and draw its doors. */
  updateLifts(now: number): void {
    if (this.liftRigs.length === 0) return
    const alpha = Math.min(1, Math.max(0, (now - this.ctx.lastStateTime) / this.ctx.stateIntervalMs))
    for (const rig of this.liftRigs) {
      if (!rig.have) continue
      const z = rig.baseFrom + (rig.baseTo - rig.baseFrom) * alpha
      rig.cabin.position.z = z - rig.originZ
      const door = rig.doorFrom + (rig.doorTo - rig.doorFrom) * alpha
      setDoors(rig.group, door)
    }
  }

  /**
   * Roll every escalator's step band by the same simulated time the crowd
   * advances, so the steps move at `ESCALATOR_SPEED` m/s however fast the clock
   * runs. Called with `simDt`, not wall time.
   */
  updateEscalators(simDt: number): void {
    for (const roll of this.escalatorRolls) rollEscalator(roll, simDt)
  }
}
