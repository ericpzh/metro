// The browser half of anonymous global stats: consent, a stable local id, the
// retry queue, the five-minute tick and the pagehide beacon.
//
// The server endpoint is idempotent on `(clientId, submitId)`, so a payload that
// is retried after a failed fetch or a pagehide keeps its submit id. A station
// only earns a row once it has something built; an empty station is never sent.

import type { StationState } from '../build/model.ts'
import { msg } from '../sim/i18n.ts'
import {
  emptyStatsBaseline,
  emptyStatsDelta,
  hasStatsDelta,
  isBuiltStation,
  makeStatsSubmission,
  stationCounts,
  statsBaseline,
  statsDelta,
  STATS_INTERVAL_MS,
  type StatsBaseline,
  type StatsSubmission,
} from '../sim/globalStats.ts'
import type { Metrics } from '../sim/world.ts'
import { createStatsId, readStatsClientId, type StatsStorage } from './statsSettings.ts'
import { useStore } from './store.ts'

export const STATS_QUEUE_KEY = 'metro-game.stats-queue.v1'
const MAX_PENDING = 20
/** A local game session posts every five seconds so the 5176 page reflects it. */
export const STATS_DEV_INTERVAL_MS = 5_000

export function statsIntervalMs(dev: boolean): number {
  return dev ? STATS_DEV_INTERVAL_MS : STATS_INTERVAL_MS
}

interface StatsStoreState {
  metrics: Metrics | null
  station: StationState
  version: number
  stationEpoch: number
  shareStats: boolean
}

interface StatsStore {
  getState: () => StatsStoreState
  subscribe: (listener: (state: StatsStoreState, previous: StatsStoreState) => void) => () => void
}

interface StatsResponse {
  ok: boolean
  status: number
}

type StatsFetch = (url: string, init: {
  method: 'POST'
  headers: Record<string, string>
  body: string
  keepalive: boolean
}) => Promise<StatsResponse>

type StatsBeacon = (url: string, body: string) => boolean

interface StatsTimers {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (id: unknown) => void
}

export interface GlobalStatsOptions {
  store: StatsStore
  apiUrl: string | null
  storage?: StatsStorage | null
  fetchImpl?: StatsFetch
  beacon?: StatsBeacon | null
  randomUUID?: () => string
  intervalMs?: number
  /** Dev only: send the already-built station once on start so 5176 fills at once. */
  submitInitial?: boolean
  timers?: StatsTimers
  addPageHide?: (listener: () => void) => void
  removePageHide?: (listener: () => void) => void
}

function browserStorage(): StatsStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

const defaultTimers: StatsTimers = {
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: id => globalThis.clearInterval(id as ReturnType<typeof globalThis.setInterval>),
}

function defaultBeacon(): StatsBeacon | null {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return null
  return (url, body) => navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))
}

/**
 * Resolve the API root for the current host. Production only exists on the real
 * site; a local production preview and a workers.dev preview have no stats
 * Worker beside them, so they stay silent unless `VITE_STATS_API_URL` names one.
 */
export function resolveStatsApiUrl(input: {
  dev: boolean
  configured?: string
  hostname?: string
}): string | null {
  const configured = input.configured?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  if (input.dev) return 'http://127.0.0.1:5176/stats/api'
  const hostname = (input.hostname ?? '').toLowerCase()
  if (hostname === 'stationdesigner.com' || hostname.endsWith('.stationdesigner.com')) return '/stats/api'
  return null
}

function runtimeStatsApiUrl(): string | null {
  return resolveStatsApiUrl({
    dev: Boolean(import.meta.env?.DEV),
    configured: import.meta.env?.VITE_STATS_API_URL,
    hostname: typeof location === 'undefined' ? '' : location.hostname,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSubmission(value: unknown): value is StatsSubmission {
  return isRecord(value)
    && typeof value.clientId === 'string'
    && typeof value.submitId === 'string'
    && isRecord(value.station)
    && isRecord(value.delta)
}

function readPending(storage: StatsStorage | null): StatsSubmission[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(STATS_QUEUE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSubmission).slice(-MAX_PENDING)
  } catch {
    return []
  }
}

function writePending(storage: StatsStorage | null, pending: readonly StatsSubmission[]): void {
  if (!storage) return
  try {
    if (pending.length === 0) storage.removeItem(STATS_QUEUE_KEY)
    else storage.setItem(STATS_QUEUE_KEY, JSON.stringify(pending.slice(-MAX_PENDING)))
  } catch { /* The queue stays in memory when storage is unavailable. */ }
}

export function createGlobalStats(options: GlobalStatsOptions) {
  const { store, apiUrl, intervalMs = STATS_INTERVAL_MS } = options
  const storage = options.storage === undefined ? browserStorage() : options.storage
  const createId = options.randomUUID ?? createStatsId
  const timers = options.timers ?? defaultTimers
  const beacon = options.beacon === undefined ? defaultBeacon() : options.beacon
  const addPageHide = options.addPageHide ?? ((listener: () => void) => {
    if (typeof window !== 'undefined') window.addEventListener('pagehide', listener)
  })
  const removePageHide = options.removePageHide ?? ((listener: () => void) => {
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', listener)
  })
  const endpoint = apiUrl ? `${apiUrl.replace(/\/+$/, '')}/v1/submit` : null

  let started = false
  let timer: unknown = null
  let unsubscribe: (() => void) | null = null
  let pending: StatsSubmission[] = readPending(storage)
  let baseline: StatsBaseline = emptyStatsBaseline()
  let lastVersion = 0
  let lastEpoch = 0
  let flushing = false
  let clientId: string | null = null
  let sessionId: string | null = null

  function syncBaseline(): void {
    const state = store.getState()
    baseline = state.metrics ? statsBaseline(state.metrics) : emptyStatsBaseline()
    lastVersion = state.version
    lastEpoch = state.stationEpoch
  }

  function clearPending(): void {
    if (pending.length === 0) return
    pending = []
    writePending(storage, pending)
  }

  function ensureClientId(): string {
    return clientId ?? (clientId = readStatsClientId(storage, createId))
  }

  function ensureSessionId(): string {
    return sessionId ?? (sessionId = createId())
  }

  /** Turn the current store state into one payload, or null when nothing changed. */
  function currentSubmission(force = false): StatsSubmission | null {
    const state = store.getState()
    if (!state.shareStats) return null

    const counts = stationCounts(state.station)
    if (!isBuiltStation(counts)) {
      syncBaseline()
      return null
    }

    const metrics = state.metrics
    if (!metrics) {
      lastVersion = state.version
      lastEpoch = state.stationEpoch
      if (!force) return null
      return makeStatsSubmission({
        clientId: ensureClientId(),
        submitId: createId(),
        sessionId: ensureSessionId(),
        name: state.station.name.trim() || msg('unnamed_station'),
        counts,
        delta: emptyStatsDelta(),
      })
    }

    // A station switch is a new run: never pair the old run's counters with the
    // new document's counts. The next tick starts the new baseline.
    if (state.stationEpoch !== lastEpoch) {
      syncBaseline()
      return null
    }

    const next = statsDelta(baseline, metrics)
    baseline = next.baseline
    if (next.reset) {
      lastVersion = state.version
      lastEpoch = state.stationEpoch
      return null
    }

    const stationChanged = state.version !== lastVersion
    lastVersion = state.version
    lastEpoch = state.stationEpoch
    if (!hasStatsDelta(next.delta) && !stationChanged && !force) return null

    return makeStatsSubmission({
      clientId: ensureClientId(),
      submitId: createId(),
      sessionId: ensureSessionId(),
      name: state.station.name.trim() || msg('unnamed_station'),
      counts,
      delta: next.delta,
    })
  }

  function enqueueCurrent(force = false): void {
    const submission = currentSubmission(force)
    if (!submission) return
    pending.push(submission)
    if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING)
    writePending(storage, pending)
  }

  async function flush(): Promise<void> {
    if (!endpoint || flushing || pending.length === 0) return
    if (!store.getState().shareStats) {
      clearPending()
      return
    }
    flushing = true
    try {
      while (pending.length > 0) {
        const submission = pending[0]
        let response: StatsResponse
        try {
          response = await (options.fetchImpl ?? ((url, init) => fetch(url, init)))(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(submission),
            keepalive: true,
          })
        } catch {
          break // Keep the queue; the same submit id retries next tick.
        }
        if (response.ok) {
          pending.shift()
          writePending(storage, pending)
          continue
        }
        // A request the server will never accept must not block the queue forever.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          pending.shift()
          writePending(storage, pending)
          continue
        }
        break // 429/5xx: the same payload retries later.
      }
    } finally {
      flushing = false
    }
  }

  async function tick(): Promise<void> {
    if (!started) return
    if (!store.getState().shareStats) {
      clearPending()
      return
    }
    enqueueCurrent()
    await flush()
  }

  /** Leave the page: queue the final delta, then beacon every pending payload. */
  function pagehide(): void {
    if (!started || !endpoint) return
    enqueueCurrent()
    if (!beacon) return
    for (const submission of pending) {
      try {
        beacon(endpoint, JSON.stringify(submission))
      } catch { /* The persisted queue retries on the next start. */ }
    }
  }

  function start(): void {
    if (started || !endpoint) return
    started = true
    if (!store.getState().shareStats) clearPending()
    syncBaseline()
    unsubscribe = store.subscribe((state, previous) => {
      if (state.shareStats === previous.shareStats) return
      if (!state.shareStats) {
        clearPending()
        syncBaseline()
        return
      }
      // Opting back in starts from now: nothing from the opted-out span is sent.
      syncBaseline()
    })
    timer = timers.setInterval(() => { void tick() }, intervalMs)
    addPageHide(pagehide)
    if (options.submitInitial) enqueueCurrent(true)
    if (pending.length > 0) void flush()
  }

  function stop(): void {
    if (!started) return
    started = false
    if (timer !== null) {
      timers.clearInterval(timer)
      timer = null
    }
    unsubscribe?.()
    unsubscribe = null
    removePageHide(pagehide)
  }

  return {
    start,
    stop,
    tick,
    flush,
    pagehide,
    endpoint,
    pending: () => pending.slice(),
    baseline: () => baseline,
  }
}

let active: ReturnType<typeof createGlobalStats> | null = null

/** Boot hook: one collector per page, once the store and worker exist. */
export function startGlobalStats(): void {
  if (active) return
  const apiUrl = runtimeStatsApiUrl()
  if (!apiUrl) return
  active = createGlobalStats({
    store: useStore,
    apiUrl,
    intervalMs: statsIntervalMs(Boolean(import.meta.env?.DEV)),
    submitInitial: Boolean(import.meta.env?.DEV),
  })
  active.start()
}

export function stopGlobalStats(): void {
  active?.stop()
  active = null
}
