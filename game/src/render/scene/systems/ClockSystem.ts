// ClockSystem — the station clocks' hands (时钟), turning on the simulation's own time.
//
// The dial is **geometry, not a printed plate** (`render/models/pieces/ClockModel.ts`), so
// there is no canvas to repaint when the time moves: the piece hands this system one pivot
// per hand and the system turns them. Nothing else in the scene reads the clock, so there is
// nothing here to keep in step with — `clockHandAngles` is the derivation the 信息栏's clock
// card, the 电视 plate and the crowd's demand already read, and the hands are the fourth
// drawing of it.

import { reposeClockHands } from '../../models.ts'
import type { ClockRig } from '../../models.ts'
import { SceneSystem } from './SceneSystem.ts'

/**
 * How far the sim clock may advance between two snapshots and still be **swept** rather than
 * **set**.
 *
 * One snapshot is one tick — a sim second at every speed, because fast-forward multiplies
 * ticks and never the step (`sim/constants.ts`), so consecutive snapshots are a second apart
 * however fast the clock runs. A wider gap is not the clock running: it is a **seek** (the
 * 时刻 window's calendar pick), a station load or a restart, and a clock that swept round to
 * a date a day away would be showing a journey the station never made. It is set instead,
 * the way a real station clock is set.
 */
const CLOCK_SWEEP_MAX_S = 60

export class ClockSystem extends SceneSystem {
  /**
   * Every placed 时钟's hands, in build order. `ModuleSystem` hands them over as it builds the
   * modules and empties the list with them, so a rig never outlives the dial it turns.
   */
  clockRigs: ClockRig[] = []
  /**
   * The hands of the **hover ghost**, if one is up. A preview is not a document piece: it is
   * rebuilt on every cell the pointer crosses and dropped with the ghost
   * (`GhostSystem.clearModulePreview`), which is why its rigs live in their own list. They are
   * turned by the same sweep as a placed clock's, because the ghost is the piece a click would
   * place — a preview reading 10:09 while every clock on the wall reads the sim's time is exactly
   * the surprise the hover exists to prevent.
   */
  previewRigs: ClockRig[] = []
  /** The sim clock at the last two snapshots, so the hands can sweep between them. */
  private from = 0
  private to = 0
  /**
   * False until a snapshot has named a time. Until then a piece keeps the pose it was built
   * with (10:09), which is what a station does before the sim has said what time it is.
   */
  private have = false

  /**
   * One state frame's sim clock, in seconds since the run began — the same number the worker
   * sends for the 电视 plate's own clock (`PlateSystem.setSimClock`), so the two readouts
   * cannot be given different times.
   *
   * A value at or past the last one and within `CLOCK_SWEEP_MAX_S` of it is the clock running
   * and becomes the next sweep's end; anything else — a jump forward, or a step back — is a
   * set, and the hands move to it without spinning through the hours in between.
   */
  setSimTime(simTime: number): void {
    const running = this.have && simTime >= this.to && simTime - this.to <= CLOCK_SWEEP_MAX_S
    this.from = running ? this.to : simTime
    this.to = simTime
    this.have = true
  }

  /**
   * Turn every dial's hands to the sim clock, swept between the last two snapshots over the
   * same `stateIntervalMs` window the consists glide and the lift cabins travel on. The hands
   * therefore run at the speed the sim is running at, and **stop when it stops**: while paused
   * no snapshot arrives, the interpolation reaches its end and stays there.
   *
   * A hover ghost's hands are set from the same instant as a placed piece's — one clock, whoever
   * is drawing it.
   */
  updateClocks(now: number): void {
    if (!this.have || (this.clockRigs.length === 0 && this.previewRigs.length === 0)) return
    const alpha = Math.min(1, Math.max(0, (now - this.ctx.lastStateTime) / this.ctx.stateIntervalMs))
    const seconds = this.from + (this.to - this.from) * alpha
    for (const rig of this.clockRigs) reposeClockHands(rig, seconds)
    for (const rig of this.previewRigs) reposeClockHands(rig, seconds)
  }
}
