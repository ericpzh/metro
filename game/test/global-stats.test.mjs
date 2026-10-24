import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createStore } from 'zustand/vanilla'
import { emptyStation } from '../src/data/reference-station.ts'
import { toState } from '../src/build/model.ts'
import { createStatsSlice } from '../src/app/store/slices/StatsSlice.ts'
import {
  createGlobalStats,
  resolveStatsApiUrl,
  startGlobalStats,
  STATS_DEV_INTERVAL_MS,
  STATS_QUEUE_KEY,
  statsIntervalMs,
  stopGlobalStats,
} from '../src/app/globalStats.ts'
import {
  readShareStats,
  readStatsClientId,
  saveShareStats,
  createStatsId,
  SHARE_STATS_KEY,
  STATS_CLIENT_KEY,
} from '../src/app/statsSettings.ts'
import {
  emptyStatsBaseline,
  emptyStatsDelta,
  hasStatsDelta,
  makeStatsSubmission,
  stationCounts,
  statsBaseline,
  statsDelta,
  STATS_INTERVAL_MS,
} from '../src/sim/globalStats.ts'
import { msg } from '../src/sim/i18n.ts'

const source = path => fs.readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
}

function metrics(overrides = {}) {
  return {
    tick: 0,
    simTime: 0,
    population: 0,
    crowdLos: 'A',
    leftBehind: 0,
    boarded: 0,
    alighted: 0,
    exited: 0,
    trainArrivals: 0,
    trainsLate: 0,
    gateQueue: 0,
    escalatorQueue: 0,
    liftQueue: 0,
    doorQueue: 0,
    period: 'peak',
    agentsCap: false,
    tickMs: 0,
    stuck: 0,
    ...overrides,
  }
}

const TRACK = {
  id: 'track-1', type: 'track', x: 0, y: 0, z: 0, w: 4, d: 1,
  cfg: { line: 'l1', power: 'third-rail' },
}

function station(name = 'Test') {
  const state = toState(emptyStation(name))
  state.cells = [
    { x: 0, y: 0, z: 0, fill: 'solid' },
    { x: 1, y: 0, z: 0, fill: 'solid' },
    { x: 2, y: 0, z: 0, fill: 'void' },
  ]
  state.modules = [
    TRACK,
    { ...TRACK, id: 'track-2', cfg: { line: 'l1', power: 'third-rail', tunnel: true } },
    { id: 'gate-1', type: 'gate', x: 3, y: 0, z: 0, cfg: { dir: 'in' } },
  ]
  return state
}

function ids() {
  let next = 0
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`
}

function fakeStore(initial) {
  let state = initial
  const listeners = new Set()
  return {
    getState: () => state,
    setState: patch => {
      const previous = state
      state = { ...state, ...patch }
      for (const listener of listeners) listener(state, previous)
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function fakeTimers() {
  let callback = null
  let delay = 0
  return {
    timers: {
      setInterval: (fn, ms) => { callback = fn; delay = ms; return 1 },
      clearInterval: () => { callback = null },
    },
    delay: () => delay,
    run: () => callback?.(),
  }
}

function collectorFixture({ stationState = station(), metricsValue = metrics(), storage = memoryStorage(), fetchImpl, leaseImpl, submitInitial = false, beacon, now } = {}) {
  const store = fakeStore({
    metrics: metricsValue,
    station: stationState,
    version: 1,
    stationEpoch: 0,
    shareStats: true,
  })
  const calls = []
  const leaseCalls = []
  const beacons = []
  const timers = fakeTimers()
  let leased = 0
  const defaultLease = async () => {
    leased += 1
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        token: 'a'.repeat(60) + String(leased).padStart(4, '0'),
        expiresAt: new Date((now ?? Date.now)() + 6 * 60_000).toISOString(),
      }),
    }
  }
  const fetchCalls = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    return { ok: true, status: 200 }
  }
  // The collector now mints a lease before every submit. Tests that inject a
  // `fetchImpl` are describing the submit endpoint only; leases are routed
  // around it unless `leaseImpl` overrides them.
  const routedFetch = async (url, init) => {
    if (url.endsWith('/v1/lease')) {
      leaseCalls.push({ url, body: JSON.parse(init.body) })
      return (leaseImpl ?? defaultLease)(url, init)
    }
    return (fetchImpl ?? fetchCalls)(url, init)
  }
  const collector = createGlobalStats({
    store,
    apiUrl: 'http://stats.test/api',
    storage,
    fetchImpl: routedFetch,
    beacon: beacon === undefined
      ? (url, body) => {
          beacons.push({ url, body: JSON.parse(body) })
          return true
        }
      : beacon,
    randomUUID: ids(),
    timers: timers.timers,
    submitInitial,
    addPageHide: () => {},
    removePageHide: () => {},
    now,
  })
  collector.start()
  return { store, collector, calls, leaseCalls, beacons, timers, storage }
}

test('station counts, deltas and reset arithmetic are pure and deterministic', () => {
  assert.equal(STATS_INTERVAL_MS, 300_000)
  const counts = stationCounts({
    cells: [{ fill: 'solid' }, { fill: 'void' }, { fill: 'solid' }],
    modules: [
      { type: 'track', cfg: {} },
      { type: 'track', cfg: { tunnel: true } },
      { type: 'gate', cfg: { dir: 'in' } },
    ],
    lines: [{}, {}],
  })
  assert.deepEqual(counts, { cells: 2, modules: 3, lines: 2, platforms: 1, tracks: 2 })

  const base = statsBaseline(metrics({ tick: 10, boarded: 2, alighted: 1, exited: 1, leftBehind: 0, trainArrivals: 1 }))
  const forward = statsDelta(base, metrics({ tick: 25, boarded: 7, alighted: 3, exited: 2, leftBehind: 1, trainArrivals: 2 }))
  assert.equal(forward.reset, false)
  assert.deepEqual(forward.delta, { boarded: 5, alighted: 2, exited: 1, leftBehind: 1, simSeconds: 15, trainArrivals: 1 })
  assert.equal(forward.baseline.tick, 25)
  assert.equal(hasStatsDelta(forward.delta), true)
  assert.equal(hasStatsDelta(emptyStatsDelta()), false)

  const backwards = statsDelta(forward.baseline, metrics({ tick: 3, boarded: 0, alighted: 0, exited: 0, leftBehind: 0, trainArrivals: 0 }))
  assert.equal(backwards.reset, true)
  assert.deepEqual(backwards.delta, emptyStatsDelta())
  assert.deepEqual(backwards.baseline, { ...emptyStatsBaseline(), tick: 3 })

  const hashed = makeStatsSubmission({
    clientId: '00000000-0000-4000-8000-000000000001',
    submitId: '00000000-0000-4000-8000-000000000002',
    hash: 'doc-1',
    counts,
    delta: emptyStatsDelta(),
  })
  assert.equal(hashed.station.hash, 'doc-1')
  assert.equal(hashed.station.name, undefined)
})

test('a built station submits counts and deltas in one idempotent body', async () => {
  const f = collectorFixture()
  assert.equal(f.timers.delay(), STATS_INTERVAL_MS, 'the collector schedules the five-minute tick')
  f.store.setState({
    version: 2,
    metrics: metrics({ tick: 300, boarded: 5, alighted: 4, exited: 3, leftBehind: 1, trainArrivals: 2 }),
  })
  await f.collector.tick()

  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].url, 'http://stats.test/api/v1/submit')
  assert.equal(f.calls[0].init.method, 'POST')
  assert.equal(f.calls[0].init.keepalive, true)
  const body = f.calls[0].body
  assert.match(body.clientId, /^00000000-/)
  assert.match(body.submitId, /^00000000-/)
  assert.match(body.sessionId, /^00000000-/)
  assert.match(body.lease, /^[0-9a-f]{64}$/, 'the submit carries a single-use lease')
  assert.equal(f.leaseCalls.length >= 1, true, 'the collector mints the lease first')
  assert.equal(body.station.name, 'Test')
  assert.deepEqual(
    { cells: body.station.cells, modules: body.station.modules, lines: body.station.lines, platforms: body.station.platforms, tracks: body.station.tracks },
    { cells: 2, modules: 3, lines: 0, platforms: 1, tracks: 2 },
  )
  assert.deepEqual(body.delta, { boarded: 5, alighted: 4, exited: 3, leftBehind: 1, simSeconds: 300, trainArrivals: 2 })
  assert.equal(f.collector.pending().length, 0)

  await f.collector.tick()
  assert.equal(f.calls.length, 1, 'nothing changed, so nothing new is sent')
})

test('the scheduled tick is the same submission path', async () => {
  const f = collectorFixture()
  f.store.setState({ version: 2, metrics: metrics({ tick: 30, boarded: 1 }) })
  f.timers.run()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].body.delta.simSeconds, 30)
})

test('a station switch and a sim reset start a new baseline without negative deltas', async () => {
  const f = collectorFixture()
  f.store.setState({ version: 2, metrics: metrics({ tick: 300, boarded: 5 }) })
  await f.collector.tick()
  assert.equal(f.calls.length, 1)

  f.store.setState({ stationEpoch: 1, version: 3, metrics: metrics({ tick: 1 }) })
  await f.collector.tick()
  assert.equal(f.calls.length, 1, 'the new station is not paired with the old run')

  f.store.setState({ metrics: metrics({ tick: 11, boarded: 2 }) })
  await f.collector.tick()
  assert.equal(f.calls.length, 2)
  assert.deepEqual(f.calls[1].body.delta, { boarded: 2, alighted: 0, exited: 0, leftBehind: 0, simSeconds: 10, trainArrivals: 0 })

  f.store.setState({ metrics: metrics({ tick: 5, boarded: 0 }) })
  await f.collector.tick()
  assert.equal(f.calls.length, 2, 'a backwards tick is a reset, not a negative submission')
})

test('an empty station is never sent', async () => {
  const f = collectorFixture({ stationState: toState(emptyStation()) })
  f.store.setState({ version: 2, metrics: metrics({ tick: 300, boarded: 5 }) })
  await f.collector.tick()
  assert.equal(f.calls.length, 0)
  assert.equal(f.collector.pending().length, 0)
})

test('dev start sends the already-built station once, before the worker reports', async () => {
  const f = collectorFixture({ metricsValue: null, submitInitial: true })
  await f.collector.ready()
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].body.station.name, 'Test')
  assert.equal(f.calls[0].body.station.cells, 2)
  assert.deepEqual(f.calls[0].body.delta, emptyStatsDelta())
})

test('a failed submission retries with the same submit id and is not re-counted', async () => {
  const storage = memoryStorage()
  const calls = []
  const responses = [{ ok: false, status: 500 }, { ok: true, status: 200 }]
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return responses.shift()
  }
  let clock = Date.now()
  const f = collectorFixture({ storage, fetchImpl, now: () => clock })
  f.store.setState({ version: 2, metrics: metrics({ tick: 120, boarded: 3 }) })
  await f.collector.tick()
  assert.equal(calls.length, 1)
  assert.equal(f.collector.pending().length, 1)
  const submitId = f.collector.pending()[0].submitId
  assert.equal(storage.values.has(STATS_QUEUE_KEY), true, 'the failed payload is queued')

  await f.collector.tick()
  assert.equal(calls.length, 1, 'backoff suppresses immediate retry')
  clock += 3000
  await f.collector.tick()
  assert.equal(calls.length, 2)
  assert.equal(f.collector.pending().length, 0)
  assert.equal(calls[0].body.submitId, submitId)
  assert.equal(calls[1].body.submitId, submitId, 'the retry keeps its idempotency key')
  assert.equal(calls[0].body.delta.boarded, 3)
  assert.equal(calls[1].body.delta.boarded, 3, 'the retry does not grow or repeat the delta')
})

test('a lease failure keeps the payload and sends no submit', async () => {
  const f = collectorFixture({ leaseImpl: async () => ({ ok: false, status: 429 }) })
  f.store.setState({ version: 2, metrics: metrics({ tick: 30, boarded: 2 }) })
  await f.collector.tick()
  assert.equal(f.calls.length, 0, 'no lease means no submit')
  assert.equal(f.collector.pending().length, 1)
  assert.equal(f.collector.lease(), null)
})

test('a 401 spends one fresh lease and retries the same payload once', async () => {
  const calls = []
  const responses = [{ ok: false, status: 401 }, { ok: true, status: 200 }]
  const f = collectorFixture({
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body))
      return responses.shift()
    },
  })
  await f.collector.ready()
  f.store.setState({ version: 2, metrics: metrics({ tick: 20, boarded: 1 }) })
  await f.collector.tick()

  assert.equal(calls.length, 2, 'the stale lease is replaced once')
  assert.equal(calls[0].submitId, calls[1].submitId, 'the retry keeps its idempotency key')
  assert.match(calls[0].lease, /^[0-9a-f]{64}$/)
  assert.notEqual(calls[0].lease, calls[1].lease, 'the second attempt uses a different token')
  assert.equal(f.collector.pending().length, 0)
  const stored = JSON.stringify([...f.storage.values.values()])
  assert.equal(stored.includes(calls[0].lease), false, 'the lease never reaches storage')
})

test('the collector renews a standby lease each tick so pagehide can carry one', async () => {
  const f = collectorFixture()
  await f.collector.ready()
  const first = f.collector.lease()
  assert.ok(first)
  f.store.setState({ version: 2, metrics: metrics({ tick: 10, boarded: 1 }) })
  await f.collector.tick()
  const second = f.collector.lease()
  assert.ok(second)
  assert.notEqual(second.token, first.token, 'the standby is refreshed')
  assert.equal(f.leaseCalls.length >= 2, true)
})

test('an expired standby is not beaconed, and the payload waits for the next visit', async () => {
  let clock = 1_000_000
  const f = collectorFixture({ now: () => clock })
  await f.collector.ready()
  assert.ok(f.collector.lease())
  clock += 20 * 60_000
  f.store.setState({ version: 2, metrics: metrics({ tick: 60, boarded: 1 }) })
  f.collector.pagehide()
  assert.equal(f.beacons.length, 0, 'no valid lease, no beacon')
  assert.equal(f.collector.pending().length, 1)
})

test('a server rejection is dropped, while a 429 retries the same payload', async () => {
  const calls = []
  const responses = [{ ok: false, status: 400 }, { ok: false, status: 429 }, { ok: true, status: 200 }]
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body))
    return responses.shift()
  }
  let clock = Date.now()
  const f = collectorFixture({ fetchImpl, now: () => clock })
  f.store.setState({ version: 2, metrics: metrics({ tick: 10, boarded: 1 }) })
  await f.collector.tick()
  assert.equal(f.collector.pending().length, 0, 'a 400 is not retried forever')

  f.store.setState({ version: 3, metrics: metrics({ tick: 20, boarded: 2 }) })
  await f.collector.tick()
  assert.equal(f.collector.pending().length, 1, 'a 429 keeps the payload')
  const submitId = f.collector.pending()[0].submitId
  clock += 3000
  await f.collector.tick()
  assert.equal(f.collector.pending().length, 0)
  assert.equal(calls.at(-1).submitId, submitId)

  const dropped = collectorFixture({ fetchImpl: async () => ({ ok: false, status: 404 }) })
  dropped.store.setState({ version: 2, metrics: metrics({ tick: 30, boarded: 3 }) })
  await dropped.collector.tick()
  assert.equal(dropped.collector.pending().length, 0)
})

test('the persisted queue ignores corrupt data and a blocked store', () => {
  const store = fakeStore({ metrics: metrics(), station: station(), version: 1, stationEpoch: 0, shareStats: true })
  const timers = fakeTimers().timers
  const valid = { clientId: '00000000-0000-4000-8000-000000000001', submitId: '00000000-0000-4000-8000-000000000002', station: { cells: 1 }, delta: {} }

  const corrupt = createGlobalStats({ store, apiUrl: null, storage: memoryStorage({ [STATS_QUEUE_KEY]: '{bad' }), beacon: null, timers })
  assert.deepEqual(corrupt.pending(), [])

  const mixed = createGlobalStats({ store, apiUrl: null, storage: memoryStorage({ [STATS_QUEUE_KEY]: JSON.stringify([{ nope: true }, valid]) }), beacon: null, timers })
  assert.deepEqual(mixed.pending(), [valid])

  const blocked = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') }, removeItem() { throw Error('blocked') } }
  const noStore = createGlobalStats({ store, apiUrl: null, storage: blocked, beacon: null, timers })
  assert.deepEqual(noStore.pending(), [])
})

test('opting out clears a queued payload', async () => {
  let calls = 0
  const f = collectorFixture({
    fetchImpl: async () => { calls += 1; return { ok: false, status: 503 } },
  })
  f.store.setState({ version: 2, metrics: metrics({ tick: 100, boarded: 2 }) })
  await f.collector.tick()
  assert.equal(calls, 1)
  assert.equal(f.collector.pending().length, 1)

  f.store.setState({ shareStats: false })
  assert.equal(f.collector.pending().length, 0, 'the subscription drops the pending queue')
  assert.equal(f.storage.values.has(STATS_QUEUE_KEY), false)
})

test('pagehide without a beacon leaves the payload for the next visit', () => {
  const f = collectorFixture({ beacon: null })
  f.store.setState({ version: 2, metrics: metrics({ tick: 90, boarded: 2 }) })
  assert.doesNotThrow(() => f.collector.pagehide())
  assert.equal(f.beacons.length, 0)
  assert.equal(f.collector.pending().length, 1)
})

test('the boot hook is inert where no stats host exists', () => {
  assert.doesNotThrow(() => {
    startGlobalStats()
    stopGlobalStats()
  })
})

test('the boot hook starts one collector for an explicit stats host', () => {
  assert.doesNotThrow(() => {
    startGlobalStats('http://stats.test/api')
    startGlobalStats('http://ignored.test/api')
    stopGlobalStats()
  })
})

test('flush clears a queued payload when sharing has been turned off', async () => {
  const valid = { clientId: '00000000-0000-4000-8000-000000000001', submitId: '00000000-0000-4000-8000-000000000002', station: { cells: 1 }, delta: {} }
  const storage = memoryStorage({ [STATS_QUEUE_KEY]: JSON.stringify([valid]) })
  const store = fakeStore({ metrics: metrics(), station: station(), version: 1, stationEpoch: 0, shareStats: false })
  const collector = createGlobalStats({
    store,
    apiUrl: 'http://stats.test/api',
    storage,
    fetchImpl: async () => ({ ok: true, status: 200 }),
    beacon: null,
    timers: fakeTimers().timers,
    randomUUID: ids(),
  })
  await collector.flush()
  assert.equal(collector.pending().length, 0)
  assert.equal(storage.values.has(STATS_QUEUE_KEY), false)
})

test('the collector falls back to browser localStorage when none is injected', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const valid = { clientId: '00000000-0000-4000-8000-000000000001', submitId: '00000000-0000-4000-8000-000000000002', station: { cells: 1 }, delta: {} }
  const store = fakeStore({ metrics: metrics(), station: station(), version: 1, stationEpoch: 0, shareStats: true })
  const timers = fakeTimers().timers
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: memoryStorage({ [STATS_QUEUE_KEY]: JSON.stringify([valid]) }),
    })
    const fromBrowser = createGlobalStats({ store, apiUrl: null, beacon: null, timers })
    assert.deepEqual(fromBrowser.pending(), [valid])

    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('blocked') } })
    const blocked = createGlobalStats({ store, apiUrl: null, beacon: null, timers })
    assert.deepEqual(blocked.pending(), [])
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete globalThis.localStorage
  }
})

test('pagehide beacons pending work and the next page retries the same payload', async () => {
  const storage = memoryStorage()
  const first = collectorFixture({ storage })
  await first.collector.ready()
  first.store.setState({ version: 2, metrics: metrics({ tick: 90, boarded: 2 }) })
  first.collector.pagehide()
  assert.equal(first.beacons.length, 1)
  assert.equal(first.beacons[0].url, 'http://stats.test/api/v1/submit')
  assert.match(first.beacons[0].body.lease, /^[0-9a-f]{64}$/, 'the beacon carries the held lease')
  assert.equal(first.collector.pending().length, 1)
  const submitId = first.beacons[0].body.submitId
  first.collector.stop()

  const second = collectorFixture({ storage })
  await second.collector.ready()
  await second.collector.flush()
  assert.equal(second.calls.length, 1)
  assert.equal(second.calls[0].body.submitId, submitId)
  assert.equal(second.collector.pending().length, 0)
})

test('opting out clears the queue and stops every later submission', async () => {
  const f = collectorFixture()
  f.store.setState({ version: 2, metrics: metrics({ tick: 100, boarded: 2 }) })
  await f.collector.tick()
  assert.equal(f.calls.length, 1)
  assert.equal(f.storage.values.has(STATS_QUEUE_KEY), false)

  f.store.setState({ shareStats: false })
  f.store.setState({ version: 3, metrics: metrics({ tick: 200, boarded: 9 }) })
  await f.collector.tick()
  assert.equal(f.calls.length, 1)
  assert.equal(f.collector.pending().length, 0)

  f.store.setState({ shareStats: true })
  await f.collector.tick()
  assert.equal(f.calls.length, 1, 'nothing from the opted-out span is replayed')

  f.store.setState({ version: 4, metrics: metrics({ tick: 260, boarded: 12 }) })
  await f.collector.tick()
  assert.equal(f.calls.length, 2)
  assert.deepEqual(f.calls[1].body.delta, { boarded: 3, alighted: 0, exited: 0, leftBehind: 0, simSeconds: 60, trainArrivals: 0 })
})

test('the stats API only exists on the real site or an explicit override', () => {
  assert.equal(resolveStatsApiUrl({ dev: true, hostname: 'localhost' }), 'http://127.0.0.1:5176/stats/api')
  assert.equal(resolveStatsApiUrl({ dev: false, hostname: 'stationdesigner.com' }), '/stats/api')
  // The Worker's origin allowlist names the apex only, so a subdomain must not
  // silently POST to a host the server will refuse.
  assert.equal(resolveStatsApiUrl({ dev: false, hostname: 'www.stationdesigner.com' }), null)
  assert.equal(resolveStatsApiUrl({ dev: false, hostname: '127.0.0.1' }), null)
  assert.equal(resolveStatsApiUrl({ dev: false, hostname: 'preview.workers.dev' }), null)
  assert.equal(resolveStatsApiUrl({ dev: false, hostname: 'preview.workers.dev', configured: 'https://stats.example/api/' }), 'https://stats.example/api')
  assert.equal(statsIntervalMs(true), STATS_DEV_INTERVAL_MS)
  assert.equal(statsIntervalMs(false), STATS_INTERVAL_MS)
  assert.equal(STATS_DEV_INTERVAL_MS, 5_000)
})

test('the share preference and client id survive valid storage and fail closed', () => {
  const storage = memoryStorage()
  assert.equal(readShareStats(storage), true, 'sharing defaults on')
  saveShareStats(false, storage)
  assert.equal(storage.values.get(SHARE_STATS_KEY), 'off')
  assert.equal(readShareStats(storage), false)
  saveShareStats(true, storage)
  assert.equal(readShareStats(storage), true)

  const client = readStatsClientId(storage, ids())
  assert.match(client, /^00000000-/)
  assert.equal(storage.values.get(STATS_CLIENT_KEY), client)
  assert.equal(readStatsClientId(storage, () => 'different-id'), client, 'a stored id is stable across calls')

  const broken = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') }, removeItem() { throw Error('blocked') } }
  assert.equal(readShareStats(broken), true)
  assert.doesNotThrow(() => saveShareStats(false, broken))
  assert.match(readStatsClientId(broken, ids()), /^00000000-/)
})

test('the stats slice persists the opt-out without touching the document', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
  })
  try {
    const make = () => createStore((...args) => ({ ...createStatsSlice(...args), version: 7, stationEpoch: 3 }))
    const store = make()
    assert.equal(store.getState().shareStats, true)
    store.getState().setShareStats(false)
    assert.equal(store.getState().shareStats, false)
    assert.equal(store.getState().version, 7, 'the preference does not dirty the document')
    assert.equal(values.get(SHARE_STATS_KEY), 'off')
    assert.equal(make().getState().shareStats, false, 'a fresh store restores the choice')
    values.set(SHARE_STATS_KEY, 'not-a-preference')
    assert.equal(make().getState().shareStats, true, 'unknown values fall back to on')
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete globalThis.localStorage
  }
})

test('a network failure keeps the payload for a later tick', async () => {
  const f = collectorFixture({ fetchImpl: async () => { throw Error('offline') } })
  f.store.setState({ version: 2, metrics: metrics({ tick: 10, boarded: 1 }) })
  await f.collector.tick()
  assert.equal(f.collector.pending().length, 1)
  assert.equal(f.storage.values.has(STATS_QUEUE_KEY), true)
})

test('the default beacon sends a JSON blob and the default pagehide hook is inert', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const sent = []
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { sendBeacon: (url, body) => { sent.push({ url, body }); return true } },
  })
  try {
    const store = fakeStore({ metrics: metrics(), station: station(), version: 1, stationEpoch: 0, shareStats: true })
    const collector = createGlobalStats({
      store,
      apiUrl: 'http://stats.test/api',
      storage: memoryStorage(),
      fetchImpl: async url => url.endsWith('/v1/lease')
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              token: 'b'.repeat(64),
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            }),
          }
        : { ok: true, status: 200 },
      timers: fakeTimers().timers,
      randomUUID: ids(),
    })
    collector.start()
    await collector.ready()
    store.setState({ version: 2, metrics: metrics({ tick: 10, boarded: 1 }) })
    collector.pagehide()
    assert.equal(sent.length, 1)
    assert.equal(sent[0].url, 'http://stats.test/api/v1/submit')
    const payload = JSON.parse(await sent[0].body.text())
    assert.equal(payload.delta.boarded, 1)
    collector.stop()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor)
    else delete globalThis.navigator
  }
})

test('blocked browser storage and a missing crypto keep the preference and id safe', () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('blocked') } })
    assert.equal(readShareStats(), true)
    assert.doesNotThrow(() => saveShareStats(false))
    assert.match(readStatsClientId(), /^[0-9a-f-]{8,64}$/i)

    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
    assert.match(createStatsId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
    else delete globalThis.localStorage
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
    else delete globalThis.crypto
  }
})

test('boot starts the collector and the settings menu owns the opt-out', () => {
  const boot = source('app/boot.tsx')
  const menu = source('app/windows/topbar/SettingsMenu.tsx')
  const messages = source('sim/i18n/messages.ts')
  const css = source('styles.css')
  assert.match(boot, /startGlobalStats\(\)/)
  assert.match(menu, /shareStats = useStore\(s => s\.shareStats\)/)
  assert.match(menu, /setShareStats = useStore\(s => s\.setShareStats\)/)
  assert.match(menu, /aria-pressed=\{shareStats\}/)
  assert.match(menu, /onClick=\{\(\) => setShareStats\(!shareStats\)\}/)
  assert.match(menu, /aria-describedby=\{statsNoteId\}/)
  assert.match(menu, /t\('share_stats_note'\)/)
  for (const key of ['share_stats', 'share_stats_on', 'share_stats_off', 'share_stats_note']) {
    assert.match(messages, new RegExp(`"${key}"|${key}:`), `the catalogue names ${key}`)
  }
  assert.match(css, /\.settingsStatsTile:hover > \.settingsStatsTooltip/)
})

test('403 preserves data and 429 Retry-After delays lease issuance', async () => {
  for (const status of [403, 429]) {
    let clock = Date.now()
    let submits = 0
    const f = collectorFixture({ now: () => clock, fetchImpl: async () => {
      submits++
      return submits === 1
        ? { ok: false, status, headers: { get: () => '60' } }
        : { ok: true, status: 200 }
    } })
    await f.collector.ready()
    f.store.setState({ version: 2, metrics: metrics({ tick: 30, boarded: 2 }) })
    await f.collector.tick()
    const id = f.collector.pending()[0].submitId
    const leases = f.leaseCalls.length
    clock += 59_000
    await f.collector.tick()
    assert.equal(submits, 1)
    assert.equal(f.leaseCalls.length, leases)
    clock += 1001
    await f.collector.tick()
    assert.equal(submits, 2)
    assert.equal(f.collector.pending().length, 0)
    assert.ok(id)
  }
})
