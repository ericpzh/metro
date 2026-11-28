// Passenger information reads the dispatcher's seconds and stop phases (§6.5).
import { SIM_SECONDS_PER_TICK as DT, TRAIN_APPROACH_S, TRAIN_BERTH_HOLD, TRAIN_DOOR_TRAVEL, TRAIN_DWELL, TRAIN_DEPART_HOLD, TRAIN_DEPART_S, periodOf } from './constants.ts'
import type { PeakWindows, TimeSpan } from './constants.ts'
import type { LineDef } from './types.ts'
import type { Train, TrainState } from './world/types.ts'

export interface TrainService {
  lineId: string
  /** Live phase, absent between services; signals stay green through departure. */
  trainState?: TrainState
  trackId: string
  direction: string
  x: number
  y: number
  z: number
  fx: number
  fy: number
  halfLength: number
  arrivals: Array<{ seconds: number; atPlatform: boolean }>
}

const PHASES: Array<[TrainState, number]> = [
  ['approach', TRAIN_APPROACH_S], ['berth', TRAIN_BERTH_HOLD],
  ['opening', TRAIN_DOOR_TRAVEL], ['dwell', TRAIN_DWELL],
  ['closing', TRAIN_DOOR_TRAVEL], ['hold', TRAIN_DEPART_HOLD], ['depart', TRAIN_DEPART_S],
]
const ticks = (seconds: number): number => Math.max(0, Math.ceil(seconds / DT)) * DT
const cycle = PHASES.reduce((sum, [, duration]) => sum + ticks(duration), 0)
const approachDelay = ticks(TRAIN_APPROACH_S) - DT

function trainAvailability(now: number, active: Train | undefined) {
  const arrivals: TrainService['arrivals'] = []
  let freeAt = now + DT
  if (active) {
    const phase = PHASES.findIndex(([state]) => state === active.state)
    freeAt = now + ticks(PHASES[phase][1] - active.t)
      + PHASES.slice(phase + 1).reduce((sum, [, duration]) => sum + ticks(duration), 0) + DT
    if (active.state === 'approach') arrivals.push({ seconds: ticks(TRAIN_APPROACH_S - active.t), atPlatform: false })
    else if (active.state !== 'depart') arrivals.push({ seconds: 0, atPlatform: true })
  }
  return { arrivals, freeAt }
}

/** Forecast without advancing the world or drawing from its RNG. Dispatch precedes phase stepping. */
export function serviceArrivals(now: number, next: number, active: Train | undefined, line: LineDef, service: TimeSpan, peaks: PeakWindows, workday = true): TrainService['arrivals'] {
  const { arrivals, freeAt } = trainAvailability(now, active)
  let dispatch = Math.max(now + Math.max(DT, ticks(next - now)), freeAt)
  while (arrivals.length < 3) {
    arrivals.push({ seconds: dispatch + approachDelay - now, atPlatform: false })
    // The forecast holds the current day type across its horizon: a midnight
    // crossing mid-forecast reads the wrong period for its last trainful, and
    // the dispatcher re-reads the real day every tick anyway.
    const period = periodOf(dispatch, service, peaks, workday)
    const headway = line.headwayProfile[period]
    dispatch += Math.max(DT, ticks(headway), cycle)
  }
  return arrivals
}

/** Walk the shared line schedule in dispatch order, including any berth still in use after an edit or seek. */
export function terminalServiceArrivals(now: number, next: number, trackIds: readonly string[], first: number,
  trains: readonly Train[], line: LineDef, service: TimeSpan, peaks: PeakWindows, workday: boolean): Map<string, TrainService['arrivals']> {
  const slots = trackIds.map(id => trainAvailability(now, trains.find(train => train.line === line.id && train.track === id)))
  let pending = slots.length
  let dispatch = now + Math.max(DT, ticks(next - now))
  for (let i = first; pending > 0; i = (i + 1) % slots.length) {
    const slot = slots[i]
    dispatch = Math.max(dispatch, slot.freeAt)
    if (slot.arrivals.length < 3) {
      slot.arrivals.push({ seconds: dispatch + approachDelay - now, atPlatform: false })
      if (slot.arrivals.length === 3) pending--
    }
    slot.freeAt = dispatch + cycle
    dispatch += Math.max(DT, ticks(line.headwayProfile[periodOf(dispatch, service, peaks, workday)]))
  }
  return new Map(trackIds.map((id, i) => [id, slots[i].arrivals]))
}
