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
  STATS_QUEUE_KEY,
} from '../src/app/globalStats.ts'
import {
  readShareStats,
  readStatsClientId,
  saveShareStats,
  SHARE_STATS_KEY,
  STATS_CLIENT_KEY,
} from '../src/app/statsSettings.ts'
import {
  emptyStatsBaseline,
  emptyStatsDelta,
  hasStatsDelta,
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

function collectorFixture({ stationState = station(), metricsValue = metrics(), storage = memoryStorage(), fetchImpl } = {}) {
  const store = fakeStore({
    metrics: metricsValue,
    station: stationState,
    version: 1,
    stationEpoch: 0,
    shareStats: true,
  })
  const calls = []
  const beacons = []
  const timers = fakeTimers()
  const fetchCalls = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    return { ok: true, status: 200 }
  }
  const collector = createGlobalStats({
    store,
    apiUrl: 'http://stats.test/api',
    storage,
    fetchImpl: fetchImpl ?? fetchCalls,
    beacon: (url, body) => {
      beacons.push({ url, body: JSON.parse(body) })
      return true
    },
    randomUUID: ids(),
    timers: timers.timers,
    addPageHide: () => {},
    removePageHide: () => {},
  })
  collector.start()
  return { store, collector, calls, beacons, timers, storage }
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

test('a failed submission retries with the same submit id and is not re-counted', async () => {
  const storage = memoryStorage()
  const calls = []
  const responses = [{ ok: false, status: 500 }, { ok: true, status: 200 }]
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return responses.shift()
  }
  const f = collectorFixture({ storage, fetchImpl })
  f.store.setState({ version: 2, metrics: metrics({ tick: 120, boarded: 3 }) })
  await f.collector.tick()
  assert.equal(calls.length, 1)
  assert.equal(f.collector.pending().length, 1)
  const submitId = f.collector.pending()[0].submitId
  assert.equal(storage.values.has(STATS_QUEUE_KEY), true, 'the failed payload is queued')

  await f.collector.tick()
  assert.equal(calls.length, 2)
  assert.equal(f.collector.pending().length, 0)
  assert.equal(calls[0].body.submitId, submitId)
  assert.equal(calls[1].body.submitId, submitId, 'the retry keeps its idempotency key')
  assert.equal(calls[0].body.delta.boarded, 3)
  assert.equal(calls[1].body.delta.boarded, 3, 'the retry does not grow or repeat the delta')
})

test('pagehide beacons pending work and the next page retries the same payload', async () => {
  const storage = memoryStorage()
  const first = collectorFixture({ storage })
  first.store.setState({ version: 2, metrics: metrics({ tick: 90, boarded: 2 }) })
  first.collector.pagehide()
  assert.equal(first.beacons.length, 1)
  assert.equal(first.beacons[0].url, 'http://stats.test/api/v1/submit')
  assert.equal(first.collector.pending().length, 1)
  const submitId = first.beacons[0].body.submitId
  first.collector.stop()

  const second = collectorFixture({ storage })
  await new Promise(resolve => setTimeout(resolve, 0))
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
  assert.equal(resolveStatsApiUrl({ dev: false, hostname: 'www.stationdesigner.com' }), '/stats/api')
  assert.equal(resolveStatsApiUrl({ dev: false, hostname: '127.0.0.1' }), null)
  assert.equal(resolveStatsApiUrl({ dev: false, hostname: 'preview.workers.dev' }), null)
  assert.equal(resolveStatsApiUrl({ dev: false, hostname: 'preview.workers.dev', configured: 'https://stats.example/api/' }), 'https://stats.example/api')
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

test('boot starts the collector and the settings menu owns the opt-out', () => {
  const boot = source('app/boot.tsx')
  const menu = source('app/windows/topbar/SettingsMenu.tsx')
  const messages = source('sim/i18n/messages.ts')
  const css = source('styles.css')
  assert.match(boot, /startGlobalStats\(\)/)
  assert.match(menu, /shareStats = useStore\(s => s\.shareStats\)/)
  assert.match(menu, /setShareStats = useStore\(s => s\.setShareStats\)/)
  assert.match(menu, /aria-pressed=\{shareStats\}/)
  assert.match(menu, /aria-pressed=\{!shareStats\}/)
  assert.match(menu, /t\('share_stats_note'\)/)
  for (const key of ['share_stats', 'share_stats_on', 'share_stats_off', 'share_stats_note']) {
    assert.match(messages, new RegExp(`"${key}"|${key}:`), `the catalogue names ${key}`)
  }
  assert.match(css, /\.settingsNote \{/)
})
