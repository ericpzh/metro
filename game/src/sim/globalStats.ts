// Anonymous global-stats aggregation, pure and DOM-free.
//
// The game sends aggregate station counts and the passenger deltas since its last
// submission. Nothing here touches storage or the network; `app/globalStats.ts`
// owns the browser half. Keeping the arithmetic here lets the test suite pin the
// reset and idempotency rules without a worker, a clock or a fetch.

import type { Cell, Module } from './types.ts'
import type { Metrics } from './world/types.ts'

/** One submission every five minutes, plus pagehide. */
export const STATS_INTERVAL_MS = 300_000

export interface StatsDelta {
  boarded: number
  alighted: number
  exited: number
  leftBehind: number
  simSeconds: number
  trainArrivals: number
}

/** The counters a delta is measured from. `tick` is the run's own sim seconds. */
export interface StatsBaseline {
  tick: number
  boarded: number
  alighted: number
  exited: number
  leftBehind: number
  trainArrivals: number
}

export interface StationCounts {
  cells: number
  modules: number
  lines: number
  platforms: number
  tracks: number
}

/** Only the document fields the stats page counts; `StationState` satisfies it. */
export interface StationCountSource {
  cells: readonly Pick<Cell, 'fill'>[]
  modules: readonly Module[]
  lines: readonly unknown[]
}

export interface StatsStation extends StationCounts {
  name?: string
  hash?: string
}

export interface StatsSubmission {
  clientId: string
  submitId: string
  sessionId?: string
  station: StatsStation
  delta: StatsDelta
}

export function emptyStatsDelta(): StatsDelta {
  return { boarded: 0, alighted: 0, exited: 0, leftBehind: 0, simSeconds: 0, trainArrivals: 0 }
}

/** The baseline a fresh run starts from. */
export function statsBaseline(metrics: Metrics): StatsBaseline {
  return {
    tick: metrics.tick,
    boarded: metrics.boarded,
    alighted: metrics.alighted,
    exited: metrics.exited,
    leftBehind: metrics.leftBehind,
    trainArrivals: metrics.trainArrivals,
  }
}

/** The zero baseline a worker that has not reported a frame yet stands on. */
export function emptyStatsBaseline(): StatsBaseline {
  return { tick: 0, boarded: 0, alighted: 0, exited: 0, leftBehind: 0, trainArrivals: 0 }
}

/**
 * Counters since `baseline`, and the next baseline to hold.
 *
 * A sim reset runs backwards (restart, station switch, a fresh `init`), so its
 * first frame is treated as a new baseline rather than a negative delta. Every
 * counter is also clamped: a defensive reset that leaves the tick alone must not
 * send a negative number.
 */
export function statsDelta(
  baseline: StatsBaseline,
  metrics: Metrics
): { delta: StatsDelta; baseline: StatsBaseline; reset: boolean } {
  if (metrics.tick < baseline.tick) {
    return { delta: emptyStatsDelta(), baseline: statsBaseline(metrics), reset: true }
  }
  return {
    delta: {
      boarded: Math.max(0, metrics.boarded - baseline.boarded),
      alighted: Math.max(0, metrics.alighted - baseline.alighted),
      exited: Math.max(0, metrics.exited - baseline.exited),
      leftBehind: Math.max(0, metrics.leftBehind - baseline.leftBehind),
      simSeconds: Math.max(0, metrics.tick - baseline.tick),
      trainArrivals: Math.max(0, metrics.trainArrivals - baseline.trainArrivals),
    },
    baseline: statsBaseline(metrics),
    reset: false,
  }
}

export function hasStatsDelta(delta: StatsDelta): boolean {
  return delta.boarded > 0 || delta.alighted > 0 || delta.exited > 0
    || delta.leftBehind > 0 || delta.simSeconds > 0 || delta.trainArrivals > 0
}

/**
 * The station size the stats page shows. Voids are dug holes, not built cells, so
 * they are left out. A platform is a track at street/platform level; tunnel and
 * bridge runs are tracks but not platforms (§6.3).
 */
export function stationCounts(station: StationCountSource): StationCounts {
  let cells = 0
  for (const cell of station.cells) if (cell.fill === 'solid') cells += 1
  let tracks = 0
  let platforms = 0
  for (const module of station.modules) {
    if (module.type !== 'track') continue
    tracks += 1
    if (!module.cfg.tunnel && !module.cfg.bridge) platforms += 1
  }
  return { cells, modules: station.modules.length, lines: station.lines.length, platforms, tracks }
}

export function isBuiltStation(counts: StationCounts): boolean {
  return counts.cells > 0 || counts.modules > 0 || counts.lines > 0
}

/** Build the exact body the stats Worker's `/v1/submit` accepts. */
export function makeStatsSubmission(input: {
  clientId: string
  submitId: string
  sessionId?: string
  name?: string
  hash?: string
  counts: StationCounts
  delta: StatsDelta
}): StatsSubmission {
  const station: StatsStation = { ...input.counts }
  if (input.name) station.name = input.name
  else if (input.hash) station.hash = input.hash
  return {
    clientId: input.clientId,
    submitId: input.submitId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    station,
    delta: { ...input.delta },
  }
}
