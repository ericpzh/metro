// Simulation world (§7) — the data shapes the crowd, the trains and the metrics are
// reported in, split out of `World` so the class and its consumers share one vocabulary.

import type { Los } from '../constants.ts'
import type { StockClass } from '../stock.ts'
import type { Trip } from '../types.ts'
export type TrainState = 'approach' | 'berth' | 'opening' | 'dwell' | 'closing' | 'hold' | 'depart'

export interface Train {
  id: number
  line: string
  /**
   * The platform track module this consist serves — one train per
   * (line, track) (§6.3), so an 上行/下行 pair runs a consist each instead of
   * sharing the first rail's.
   */
  track: string
  state: TrainState
  t: number
  boarded: number
  alighted: number
  onboard: number
  capacity: number
  late: number
  doors: number[]
  dir: string
}

export interface Metrics {
  tick: number
  simTime: number
  population: number
  worstLos: Los
  worstLosNode: number
  leftBehind: number
  boarded: number
  alighted: number
  exited: number
  trainsLate: number
  gateQueue: number
  escalatorQueue: number
  doorQueue: number
  period: 'peak' | 'offpeak' | 'late'
  agentsCap: boolean
  tickMs: number
  /** Agents that could not be routed to any destination this run. */
  stuck: number
}

/** Where a line's train appears: the track it runs on and its stock. */
export interface LineAnchor {
  x: number
  y: number
  z: number
  /** Unit run direction of the track, so a north–south line travels in y. */
  fx: number
  fy: number
  /** Yaw (radians) that turns the consist's local +x onto the run axis. */
  yaw: number
  dirSign: number
  cars: number
  stock: StockClass
  colour: number
  /**
   * Which of the consist's two door banks may open at this berth — bit 0 the
   * local +y side, bit 1 the local −y side (GAME-SPEC §1.13). A side is set
   * only where the rail has a platform-edge run, i.e. platform screen doors:
   * the train never opens onto the tunnel wall. Zero means no doors at all.
   */
  doorSides: number
}

export interface DynamicSnapshot {
  rng: number
  tick: number
  simTime: number
  agents: Array<{
    id: number
    seed: number
    x: number
    y: number
    z: number
    state: number
    trip: Trip
    legIdx: number
    pathIdx: number
  }>
}
