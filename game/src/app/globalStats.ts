// The browser half of anonymous global stats: consent, a stable local id, the
// single-use write lease, the retry queue, the five-minute tick and the
// pagehide beacon.
//
// The server endpoint is idempotent on `(clientId, submitId)`, so a payload that
// is retried after a failed fetch or a pagehide keeps its submit id. It also
// requires a lease minted by the stats Worker: the token is held in memory, sent
// with one submit, and never persisted. A station only earns a row once it has
// something built; an empty station is never sent.

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
/**
 * A lease is renewed every tick, so it must outlive one production interval.
 * The client stops using it this long before the server's expiry so a request
 * in flight cannot cross the boundary.
 */
export const STATS_LEASE_MARGIN_MS = 30_000
export const STATS_LEASE_PATH = '/v1/lease'

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
  headers?: { get: (name: string) => string | null }
  json?: () => Promise<unknown>
}

interface StatsLease {
  token: string
  expiresAt: string
  expiresAtMs: number
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
  /** Injectable clock for lease-expiry tests. */
  now?: () => number
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
 * Resolve the API root for the current host. Only the apex hostname serves the
 * game beside the stats routes; a subdomain, a local production preview and a
 * workers.dev preview have no stats Worker beside them, so they stay silent
 * unless `VITE_STATS_API_URL` names one. The Worker's origin allowlist names the
 * same host — changing one without the other is the mismatch this avoids.
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
  if (hostname === 'stationdesigner.com') return '/stats/api'
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

const LEASE_TOKEN = /^[0-9a-f]{64}$/

function parseLease(value: unknown): StatsLease | null {
  if (!isRecord(value)) return null
  const token = typeof value.token === 'string' ? value.token : ''
  const expiresAt = typeof value.expiresAt === 'string' ? value.expiresAt : ''
  const expiresAtMs = Date.parse(expiresAt)
  if (!LEASE_TOKEN.test(token) || !Number.isFinite(expiresAtMs)) return null
  return { token, expiresAt, expiresAtMs }
}

/** A 4xx that re-sending the same payload cannot fix, except `401` (stale lease). */
function rejectsPayload(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 408 && status !== 429
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
  const clock = options.now ?? (() => Date.now())
  const send = options.fetchImpl ?? ((url, init) => fetch(url, init))
  const addPageHide = options.addPageHide ?? ((listener: () => void) => {
    if (typeof window !== 'undefined') window.addEventListener('pagehide', listener)
  })
  const removePageHide = options.removePageHide ?? ((listener: () => void) => {
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', listener)
  })
  const endpoint = apiUrl ? `${apiUrl.replace(/\/+$/, '')}/v1/submit` : null
  const leaseEndpoint = apiUrl ? `${apiUrl.replace(/\/+$/, '')}${STATS_LEASE_PATH}` : null

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
  /** Memory-only capability: one token, one submit, never written to storage. */
  let lease: StatsLease | null = null
  let retryAt = 0
  let failures = 0
  let ready: Promise<void> = Promise.resolve()

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

  function usableLease(): StatsLease | null {
    return lease && lease.expiresAtMs - clock() > STATS_LEASE_MARGIN_MS ? lease : null
  }

  function deferRetry(response: StatsResponse): void {
    if (response.ok) { failures = 0; return }
    if (![403, 408, 429].includes(response.status) && response.status < 500) return
    failures = Math.min(failures + 1, 8)
    const header = response.headers?.get('Retry-After')
    const seconds = header ? Number(header) : NaN
    const deadline = header && !Number.isFinite(seconds) ? Date.parse(header) : NaN
    const delay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
      : Number.isFinite(deadline) ? Math.max(0, deadline - clock()) : 0
    retryAt = clock() + Math.max(delay, Math.min(300_000, 1000 * 2 ** failures))
  }

  /** Mint or reuse a lease. A forced call always asks for a fresh one. */
  async function takeLease(force = false): Promise<StatsLease | null> {
    if (!leaseEndpoint || clock() < retryAt) return null
    if (!force) {
      const current = usableLease()
      if (current) return current
    }
    if (!store.getState().shareStats) {
      lease = null
      return null
    }
    let response: StatsResponse
    try {
      response = await send(leaseEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: ensureClientId() }),
        keepalive: true,
      })
    } catch {
      return null
    }
    if (!response.ok) deferRetry(response)
    if (!response.ok) {
      lease = null
      return null
    }
    let value: unknown = null
    try {
      value = response.json ? await response.json() : null
    } catch {
      value = null
    }
    lease = parseLease(value)
    return lease
  }

  async function postSubmission(
    submission: StatsSubmission,
    token: string
  ): Promise<StatsResponse | null> {
    if (!endpoint) return null
    try {
      return await send(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The lease rides in the body so the pagehide beacon can carry it too:
        // `sendBeacon` cannot set a request header.
        body: JSON.stringify({ ...submission, lease: token }),
        keepalive: true,
      })
    } catch {
      return null
    }
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
        let current = await takeLease()
        if (!current) break
        let response = await postSubmission(submission, current.token)
        // The server consumes a lease on every accepted attempt; never reuse a
        // token locally, even when the response never arrived.
        lease = null
        if (response?.status === 401) {
          // Expired, spent or unknown: one fresh token, one retry, then keep
          // the payload for the next tick.
          current = await takeLease(true)
          if (!current) break
          response = await postSubmission(submission, current.token)
          lease = null
        }
        if (!response) break // Network failure: the same submit id retries.
        deferRetry(response)
        if (response.ok) {
          pending.shift()
          writePending(storage, pending)
          continue
        }
        // A request the server will never accept must not block the queue forever.
        if (rejectsPayload(response.status)) {
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

  /**
   * Hold a lease between ticks so `pagehide` can still carry one. The server
   * mints them cheaply while the tick is slow, and an unused one expires.
   */
  async function keepLease(): Promise<void> {
    if (!started || !leaseEndpoint) return
    if (!store.getState().shareStats) return
    await takeLease(true)
  }

  async function tick(): Promise<void> {
    if (!started) return
    if (!store.getState().shareStats) {
      clearPending()
      return
    }
    enqueueCurrent()
    await flush()
    await keepLease()
  }

  /** Leave the page: queue the final delta and beacon it with the held lease. */
  function pagehide(): void {
    if (!started || !endpoint) return
    enqueueCurrent()
    if (!beacon || pending.length === 0) return
    const current = usableLease()
    // Without a lease the beacon would be refused; leave the queue for the next
    // visit rather than spend a request the server will reject.
    if (!current) return
    const submission = pending[pending.length - 1]
    try {
      if (beacon(endpoint, JSON.stringify({ ...submission, lease: current.token }))) {
        lease = null
      }
    } catch { /* The persisted queue retries on the next start. */ }
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
        lease = null
        syncBaseline()
        return
      }
      // Opting back in starts from now: nothing from the opted-out span is sent.
      syncBaseline()
    })
    timer = timers.setInterval(() => { void tick() }, intervalMs)
    addPageHide(pagehide)
    if (options.submitInitial) enqueueCurrent(true)
    ready = (pending.length > 0 ? flush() : Promise.resolve())
      .then(() => keepLease())
      .catch(() => {})
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
    lease = null
    removePageHide(pagehide)
  }

  return {
    start,
    stop,
    tick,
    flush,
    pagehide,
    endpoint,
    ready: () => ready,
    pending: () => pending.slice(),
    baseline: () => baseline,
    lease: () => lease,
  }
}

let active: ReturnType<typeof createGlobalStats> | null = null

/** Boot hook: one collector per page, once the store and worker exist. */
export function startGlobalStats(apiUrl: string | null = runtimeStatsApiUrl()): void {
  if (active) return
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
