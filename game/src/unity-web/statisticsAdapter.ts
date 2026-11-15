// Plan 21 §5.4: Host statistics and paginated history adapter.
//
// Bridges `state.statistics` (`{ available, runId, metrics, history }`) and
// `stats.history` (`{ runId, from, limit }` -> `{ runId, from, count, total,
// start, step, stride, values }`) into `SimSlice.metrics` and `SimSlice.history`
// for both the WebGL player and `StationDesktopUiPresenter`.

import type { Metrics } from '../sim/world.ts'
import { DEFAULT_SIM_TIME, LOS_ORDER } from '../sim/constants.ts'
import { HISTORY_STRIDE, SAMPLE_SECONDS } from '../sim/history.ts'
import type { HistoryUpdate } from '../app/store/slices/SimSlice.ts'

type Los = Metrics['crowdLos']
type Period = Metrics['period']

export const MAX_HISTORY_PAGE_ROWS = 128

export interface HistoryReadQuery {
  runId: string
  from: number
  limit: number
}

export interface StatisticsTransport {
  requestHistory(query: HistoryReadQuery): Promise<Record<string, unknown>>
}

export interface StatisticsStoreState {
  metrics: Metrics | null
  history?: {
    start: number
    step: number
    values: Float32Array
    count: number
  }
  setMetrics: (metrics: Metrics) => void
  setHistory: (update: HistoryUpdate) => void
}

export interface StatisticsStore<T extends StatisticsStoreState = StatisticsStoreState> {
  getState(): T
  setState(partial: { metrics: Metrics | null }): void
}

export interface HostHistoryDescriptor {
  count: number
  start: number
  step: number
  stride: number
}

export type AppendHistoryResult =
  | { status: 'appended'; rows: number; cursor: number }
  | { status: 'empty'; cursor: number }
  | { status: 'ignored-stale' }
  | { status: 'ignored-duplicate' }
  | { status: 'invalid' }

export interface StatisticsAdapterState {
  sessionId: string
  runId: string
  cursor: number
  start: number
  step: number
  inFlight: boolean
  latestCount: number
  disconnected: boolean
}

export interface ApplyStatisticsOptions {
  sessionId?: string
  resync?: boolean
}

export interface StatisticsAdapter {
  getState(): StatisticsAdapterState
  apply(input: unknown, options?: ApplyStatisticsOptions): void
  appendPage(page: unknown, options?: { sessionId?: string }): AppendHistoryResult
  disconnect(): void
}

interface InFlightRead {
  token: number
  sessionId: string
  runId: string
  from: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isLos(value: unknown): value is Los {
  return typeof value === 'string' && (LOS_ORDER as readonly string[]).includes(value)
}

function isPeriod(value: unknown): value is Period {
  return value === 'peak' || value === 'offpeak' || value === 'late'
}

function parseDescriptor(raw: unknown): HostHistoryDescriptor | null {
  if (!isRecord(raw)) return null
  const { count, start, step, stride } = raw
  if (!isInteger(count) || count < 0) return null
  if (!isFiniteNumber(start)) return null
  if (!isFiniteNumber(step) || step <= 0) return null
  if (stride !== HISTORY_STRIDE) return null
  return { count, start, step, stride }
}

function parseMetrics(raw: unknown): Metrics | null {
  if (!isRecord(raw)) return null
  const {
    tick,
    simTime,
    population,
    crowdLos,
    leftBehind,
    boarded,
    alighted,
    exited,
    trainArrivals,
    trainsLate,
    gateQueue,
    escalatorQueue,
    liftQueue,
    doorQueue,
    period,
    agentsCap,
    tickMs,
    stuck,
  } = raw
  if (
    !isFiniteNumber(tick) ||
    !isFiniteNumber(simTime) ||
    !isFiniteNumber(population) ||
    !isLos(crowdLos) ||
    !isFiniteNumber(leftBehind) ||
    !isFiniteNumber(boarded) ||
    !isFiniteNumber(alighted) ||
    !isFiniteNumber(exited) ||
    !isFiniteNumber(trainArrivals) ||
    !isFiniteNumber(trainsLate) ||
    !isFiniteNumber(gateQueue) ||
    !isFiniteNumber(escalatorQueue) ||
    !isFiniteNumber(liftQueue) ||
    !isFiniteNumber(doorQueue) ||
    !isPeriod(period) ||
    typeof agentsCap !== 'boolean' ||
    !isFiniteNumber(stuck)
  ) {
    return null
  }
  return {
    tick,
    simTime,
    population,
    crowdLos,
    leftBehind,
    boarded,
    alighted,
    exited,
    trainArrivals,
    trainsLate,
    gateQueue,
    escalatorQueue,
    liftQueue,
    doorQueue,
    period,
    agentsCap,
    tickMs: isFiniteNumber(tickMs) ? tickMs : 0,
    stuck,
  }
}

/**
 * Deterministic fingerprint for live `Metrics` deduplication. Wall-clock `tickMs`
 * is intentionally omitted so paused 10 Hz polls do not churn Zustand subscribers.
 */
function metricsFingerprint(runId: string, m: Metrics): string {
  return [
    runId,
    m.tick,
    m.simTime,
    m.population,
    m.crowdLos,
    m.leftBehind,
    m.boarded,
    m.alighted,
    m.exited,
    m.trainArrivals,
    m.trainsLate,
    m.gateQueue,
    m.escalatorQueue,
    m.liftQueue,
    m.doorQueue,
    m.period,
    m.agentsCap ? 1 : 0,
    m.stuck,
  ].join('|')
}

function emptyReset(start = DEFAULT_SIM_TIME, step = SAMPLE_SECONDS): HistoryUpdate {
  return {
    reset: true,
    from: 0,
    start,
    step,
    values: new Float32Array(0),
  }
}

export function createStatisticsAdapter<T extends StatisticsStoreState = StatisticsStoreState>(
  store: StatisticsStore<T>,
  transport: StatisticsTransport,
): StatisticsAdapter {
  let sessionId = ''
  let runId = ''
  let cursor = 0
  let start = DEFAULT_SIM_TIME
  let step = SAMPLE_SECONDS
  let inFlight: InFlightRead | null = null
  let latestDescriptor: HostHistoryDescriptor | null = null
  let lastMetricsKey = ''
  let disconnected = true
  let nextToken = 0

  const resetStore = (originStart = DEFAULT_SIM_TIME, originStep = SAMPLE_SECONDS, clearMetrics = true): void => {
    store.getState().setHistory(emptyReset(originStart, originStep))
    if (clearMetrics) store.setState({ metrics: null })
  }

  const clearRunState = (): void => {
    runId = ''
    cursor = 0
    start = DEFAULT_SIM_TIME
    step = SAMPLE_SECONDS
    inFlight = null
    latestDescriptor = null
    lastMetricsKey = ''
  }

  const disconnect = (): void => {
    const hadSessionOrMetrics = !disconnected || runId.length > 0 || store.getState().metrics !== null
    sessionId = ''
    clearRunState()
    disconnected = true
    if (hadSessionOrMetrics) resetStore(DEFAULT_SIM_TIME, SAMPLE_SECONDS, true)
  }

  const pumpHistory = (): void => {
    if (inFlight !== null) return
    if (!runId || !latestDescriptor) return
    if (cursor >= latestDescriptor.count) return

    const token = ++nextToken
    const activeSessionId = sessionId
    const activeRunId = runId
    const requestFrom = cursor
    inFlight = {
      token,
      sessionId: activeSessionId,
      runId: activeRunId,
      from: requestFrom,
    }

    let pendingPromise: Promise<Record<string, unknown>>
    try {
      pendingPromise = transport.requestHistory({
        runId: activeRunId,
        from: requestFrom,
        limit: MAX_HISTORY_PAGE_ROWS,
      })
    } catch {
      if (inFlight && inFlight.token === token) inFlight = null
      return
    }

    pendingPromise.then(
      page => {
        if (!inFlight || inFlight.token !== token) return
        inFlight = null
        const outcome = appendPage(page, { sessionId: activeSessionId })
        if (outcome.status === 'appended' && latestDescriptor && cursor < latestDescriptor.count) {
          pumpHistory()
        }
      },
      () => {
        // Leave `cursor` at the last good row; the next valid `state` or `resync`
        // retries from `cursor`.
        if (inFlight && inFlight.token === token) inFlight = null
      },
    )
  }

  const appendPage = (rawPage: unknown, options: { sessionId?: string } = {}): AppendHistoryResult => {
    if (!runId || disconnected) return { status: 'ignored-stale' }
    if (options.sessionId !== undefined && sessionId && options.sessionId !== sessionId) {
      return { status: 'ignored-stale' }
    }
    if (!isRecord(rawPage)) return { status: 'invalid' }

    const pageRunId = rawPage.runId
    if (typeof pageRunId !== 'string' || pageRunId.length === 0) return { status: 'invalid' }
    if (pageRunId !== runId) return { status: 'ignored-stale' }

    const { from, count, total, start: pageStart, step: pageStep, stride, values } = rawPage
    if (
      stride !== HISTORY_STRIDE ||
      !isFiniteNumber(pageStep) ||
      pageStep <= 0 ||
      !isFiniteNumber(pageStart) ||
      !isInteger(from) ||
      from < 0 ||
      !isInteger(count) ||
      count < 0 ||
      count > MAX_HISTORY_PAGE_ROWS ||
      !isInteger(total) ||
      total < 0
    ) {
      return { status: 'invalid' }
    }

    if (!Array.isArray(values) && !(values instanceof Float32Array)) {
      return { status: 'invalid' }
    }
    if (values.length !== count * HISTORY_STRIDE || from + count > total) {
      return { status: 'invalid' }
    }

    // Duplicate page already fully covered by `cursor`: ignore without mutating.
    if (from < cursor) {
      if (from + count <= cursor) return { status: 'ignored-duplicate' }
      return { status: 'invalid' }
    }
    if (from > cursor) {
      return { status: 'invalid' }
    }

    if (count === 0) {
      return { status: 'empty', cursor }
    }

    const floatValues = new Float32Array(values.length)
    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      if (!isFiniteNumber(v)) return { status: 'invalid' }
      floatValues[i] = v
    }

    store.getState().setHistory({
      reset: false,
      from: cursor,
      start: pageStart,
      step: pageStep,
      values: floatValues,
    })

    cursor += count
    start = pageStart
    step = pageStep
    if (latestDescriptor && total > latestDescriptor.count) {
      latestDescriptor = {
        ...latestDescriptor,
        count: total,
        start: pageStart,
        step: pageStep,
      }
    }
    return { status: 'appended', rows: count, cursor }
  }

  const apply = (input: unknown, options: ApplyStatisticsOptions = {}): void => {
    if (!isRecord(input)) {
      disconnect()
      return
    }

    // Accept either a full `StationSnapshot` (`{ ready, sessionId, state }`) or a
    // direct `state` payload (`{ statistics }`).
    let hostState: Record<string, unknown> | null = null
    let incomingSessionId = options.sessionId
    if ('ready' in input && 'state' in input && typeof input.ready === 'boolean') {
      if (!input.ready) {
        disconnect()
        return
      }
      if (typeof input.sessionId === 'string') incomingSessionId = input.sessionId
      hostState = isRecord(input.state) ? input.state : null
    } else {
      hostState = input
    }

    if (incomingSessionId !== undefined && incomingSessionId !== sessionId) {
      // New player generation: discard any state from the previous player session.
      const hadActiveState = !disconnected || runId.length > 0 || store.getState().metrics !== null
      clearRunState()
      sessionId = incomingSessionId
      if (!incomingSessionId) {
        disconnected = true
        if (hadActiveState) resetStore(DEFAULT_SIM_TIME, SAMPLE_SECONDS, true)
        return
      }
      if (!hostState || !isRecord(hostState.statistics)) {
        disconnected = true
        if (hadActiveState) resetStore(DEFAULT_SIM_TIME, SAMPLE_SECONDS, true)
        return
      }
    }

    if (!hostState || !isRecord(hostState.statistics)) {
      return
    }

    const stats = hostState.statistics
    if (stats.available === false) {
      const hadActiveState = !disconnected || runId.length > 0 || store.getState().metrics !== null
      clearRunState()
      disconnected = true
      if (hadActiveState) resetStore(DEFAULT_SIM_TIME, SAMPLE_SECONDS, true)
      return
    }

    const incomingRunId = typeof stats.runId === 'string' ? stats.runId : ''
    const descriptor = parseDescriptor(stats.history)
    const metrics = parseMetrics(stats.metrics)
    if (!incomingRunId || !descriptor || !metrics) {
      return
    }

    disconnected = false
    if (incomingSessionId !== undefined) sessionId = incomingSessionId

    if (incomingRunId !== runId) {
      runId = incomingRunId
      cursor = 0
      start = descriptor.start
      step = descriptor.step
      inFlight = null
      latestDescriptor = descriptor
      lastMetricsKey = ''
      resetStore(descriptor.start, descriptor.step, false)
    } else {
      const storeHistory = store.getState().history
      if (storeHistory && isInteger(storeHistory.count) && storeHistory.count < cursor) {
        // Fresh store on a same-run resync: backfill from the store's actual watermark (0).
        cursor = Math.max(0, storeHistory.count)
        if (cursor === 0) {
          resetStore(descriptor.start, descriptor.step, false)
        }
      } else if (options.resync && cursor > descriptor.count) {
        cursor = 0
        resetStore(descriptor.start, descriptor.step, false)
      }
      latestDescriptor = descriptor
      start = descriptor.start
      step = descriptor.step
    }

    const key = metricsFingerprint(runId, metrics)
    if (key !== lastMetricsKey || store.getState().metrics === null) {
      lastMetricsKey = key
      store.getState().setMetrics(metrics)
    }

    pumpHistory()
  }

  return {
    getState: () => ({
      sessionId,
      runId,
      cursor,
      start,
      step,
      inFlight: inFlight !== null,
      latestCount: latestDescriptor?.count ?? 0,
      disconnected,
    }),
    apply,
    appendPage,
    disconnect,
  }
}

export function applyHostStatistics(
  adapter: StatisticsAdapter,
  snapshotOrState: unknown,
  options?: ApplyStatisticsOptions,
): void {
  adapter.apply(snapshotOrState, options)
}

export function appendHistoryPage(
  adapter: StatisticsAdapter,
  page: unknown,
  options?: { sessionId?: string },
): AppendHistoryResult {
  return adapter.appendPage(page, options)
}
