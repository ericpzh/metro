// The run's own record (§8.1, the 数据 window): one sample a minute of the counters
// the status bar shows, plus the per-minute change in the three that only ever
// climb.
//
// **It is kept in the sim, not in the app.** The worker ticks at up to 16×, `seek`
// moves the clock by days and a station `load` starts a new run — the app only hears
// about all three second-hand, and a sampler that lived beside the store would have
// to reconstruct the minute boundaries from messages that may arrive several times a
// tick or not at all. Here the clock is the only thing that decides, so a minute is a
// minute whatever the speed multiplier.
//
// The buffer **doubles rather than ring-buffers**: a sample's index never moves, so
// the worker can post only the samples since its last message and the app can append
// them where they belong. A day is 1,440 samples (~52 KB interleaved), and the record
// is dropped, not rolled, whenever the run itself restarts (`reset`).

import { LOS_ORDER, type Los } from './constants.ts'

/** The fields of one sample, in the order they are interleaved in the buffer. */
export const HISTORY_COLUMNS = [
  'simTime',
  'population',
  'crowdLos',
  'gateQueue',
  'escalatorQueue',
  'liftQueue',
  'doorQueue',
  'boarded',
  'exited',
  'leftBehind',
  'boardedPerMin',
  'exitedPerMin',
  'leftBehindPerMin',
] as const
export type HistoryColumn = (typeof HISTORY_COLUMNS)[number]
export const HISTORY_STRIDE = HISTORY_COLUMNS.length
export const HISTORY_INDEX = Object.fromEntries(
  HISTORY_COLUMNS.map((column, index) => [column, index]),
) as Record<HistoryColumn, number>

/** Seconds of sim time between samples: one minute, the window's own grain (§8.1). */
export const SAMPLE_SECONDS = 60

/**
 * What one sample reads. `Metrics` satisfies it structurally, so the collector never
 * has to import the world (and the world's own types stay the one vocabulary).
 */
export interface SampledMetrics {
  simTime: number
  population: number
  crowdLos: Los
  gateQueue: number
  escalatorQueue: number
  liftQueue: number
  doorQueue: number
  boarded: number
  exited: number
  leftBehind: number
}

export class History {
  private values = new Float32Array(HISTORY_STRIDE * 64)
  /** Samples held; sample `i` starts at `values[i * HISTORY_STRIDE]`. */
  count = 0
  /** Sim seconds of sample 0 — the clock the app labels the x axis against. */
  start: number
  step = SAMPLE_SECONDS
  private last = Number.NEGATIVE_INFINITY
  /** The counters as of the previous sample, for the per-minute columns. */
  private prev = { boarded: 0, exited: 0, leftBehind: 0 }

  constructor(start = 0) {
    this.start = start
  }

  /**
   * Start the record over at `simTime`: a station load, a restart, or a `seek` that
   * puts the clock somewhere else. The next tick samples, so a fresh run always
   * opens with a sample at its own beginning — and the counters it opens on are a
   * **baseline, not a minute's flow** (a seek keeps the totals, and the first delta
   * would otherwise read as one huge minute).
   */
  reset(simTime: number): void {
    this.count = 0
    this.start = simTime
    this.last = simTime - this.step
  }

  /** This tick's read: append when a minute has passed. True when it did. */
  sample(m: SampledMetrics): boolean {
    if (m.simTime - this.last < this.step) return false
    this.last = m.simTime
    const first = this.count === 0
    if (first) this.start = m.simTime
    const at = this.count * HISTORY_STRIDE
    this.ensure(this.count + 1)
    const v = this.values
    v[at + HISTORY_INDEX.simTime] = m.simTime
    v[at + HISTORY_INDEX.population] = m.population
    v[at + HISTORY_INDEX.crowdLos] = LOS_ORDER.indexOf(m.crowdLos)
    v[at + HISTORY_INDEX.gateQueue] = m.gateQueue
    v[at + HISTORY_INDEX.escalatorQueue] = m.escalatorQueue
    v[at + HISTORY_INDEX.liftQueue] = m.liftQueue
    v[at + HISTORY_INDEX.doorQueue] = m.doorQueue
    v[at + HISTORY_INDEX.boarded] = m.boarded
    v[at + HISTORY_INDEX.exited] = m.exited
    v[at + HISTORY_INDEX.leftBehind] = m.leftBehind
    v[at + HISTORY_INDEX.boardedPerMin] = first ? 0 : m.boarded - this.prev.boarded
    v[at + HISTORY_INDEX.exitedPerMin] = first ? 0 : m.exited - this.prev.exited
    v[at + HISTORY_INDEX.leftBehindPerMin] = first ? 0 : m.leftBehind - this.prev.leftBehind
    this.prev = { boarded: m.boarded, exited: m.exited, leftBehind: m.leftBehind }
    this.count++
    return true
  }

  /** Samples `[from, count)` as a fresh buffer, the shape one `state` message carries. */
  run(from: number): Float32Array {
    return this.values.slice(Math.max(0, from) * HISTORY_STRIDE, this.count * HISTORY_STRIDE)
  }

  private ensure(samples: number): void {
    const need = samples * HISTORY_STRIDE
    if (this.values.length >= need) return
    let size = this.values.length || HISTORY_STRIDE * 64
    while (size < need) size *= 2
    const next = new Float32Array(size)
    next.set(this.values)
    this.values = next
  }
}

/** One column of an interleaved buffer as plain numbers — one chart line's values. */
export function historySeries(values: Float32Array, column: HistoryColumn, count: number): number[] {
  const at = HISTORY_INDEX[column]
  const out = new Array<number>(count)
  for (let i = 0; i < count; i++) out[i] = values[i * HISTORY_STRIDE + at]
  return out
}
