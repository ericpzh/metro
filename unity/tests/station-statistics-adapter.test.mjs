// Plan 21 §5.3–5.5 & §6.3: Bridge request correlation, statistics adapter paging,
// run resets, malformed/duplicate page resilience, reconnect/resync, and HUD wiring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BridgeRequestError,
  envelope,
  stationBridge,
} from '../../game/src/unity-web/stationBridge.ts'
import {
  MAX_HISTORY_PAGE_ROWS,
  appendHistoryPage,
  applyHostStatistics,
  createStatisticsAdapter,
} from '../../game/src/unity-web/statisticsAdapter.ts'
import { HISTORY_INDEX, HISTORY_STRIDE, historySeries } from '../../game/src/sim/history.ts'
import { useStore } from '../../game/src/app/store.ts'

function makeMetrics(over = {}) {
  return {
    tick: 60,
    simTime: 23460,
    population: 42,
    crowdLos: 'B',
    leftBehind: 1,
    boarded: 18,
    alighted: 11,
    exited: 9,
    trainArrivals: 2,
    trainsLate: 1,
    gateQueue: 4,
    escalatorQueue: 3,
    liftQueue: 2,
    doorQueue: 5,
    period: 'offpeak',
    agentsCap: false,
    tickMs: 0.42,
    stuck: 0,
    ...over,
  }
}

function makeRow(index, over = {}) {
  const row = new Array(HISTORY_STRIDE).fill(0)
  row[HISTORY_INDEX.simTime] = over.simTime ?? (23401 + index * 60)
  row[HISTORY_INDEX.population] = over.population ?? (10 + index)
  row[HISTORY_INDEX.crowdLos] = over.crowdLos ?? (index % 6)
  row[HISTORY_INDEX.gateQueue] = over.gateQueue ?? (index % 5)
  row[HISTORY_INDEX.escalatorQueue] = over.escalatorQueue ?? (index % 4)
  row[HISTORY_INDEX.liftQueue] = over.liftQueue ?? (index % 3)
  row[HISTORY_INDEX.doorQueue] = over.doorQueue ?? (index % 7)
  row[HISTORY_INDEX.boarded] = over.boarded ?? (index * 3)
  row[HISTORY_INDEX.exited] = over.exited ?? (index * 2)
  row[HISTORY_INDEX.leftBehind] = over.leftBehind ?? (index > 10 ? 1 : 0)
  row[HISTORY_INDEX.boardedPerMin] = over.boardedPerMin ?? (index === 0 ? 0 : 3)
  row[HISTORY_INDEX.exitedPerMin] = over.exitedPerMin ?? (index === 0 ? 0 : 2)
  row[HISTORY_INDEX.leftBehindPerMin] = over.leftBehindPerMin ?? (index === 11 ? 1 : 0)
  return row
}

function makePage(runId, allRows, from, limit = MAX_HISTORY_PAGE_ROWS, start = 23401, step = 60) {
  const capped = Math.min(limit, MAX_HISTORY_PAGE_ROWS)
  const slice = allRows.slice(from, from + capped)
  const values = []
  for (const row of slice) values.push(...row)
  return {
    runId,
    from,
    count: slice.length,
    total: allRows.length,
    start,
    step,
    stride: HISTORY_STRIDE,
    values,
  }
}

function makeHostSnapshot(sessionId, runId, count, metricsOver = {}, start = 23401, step = 60) {
  return {
    ready: true,
    sessionId,
    state: {
      statistics: {
        available: true,
        runId,
        metrics: makeMetrics(metricsOver),
        history: {
          count,
          start,
          step,
          stride: HISTORY_STRIDE,
        },
      },
    },
  }
}

function flushMicrotasks() {
  return new Promise(resolve => queueMicrotask(resolve))
}

test('stationBridge assigns a unique command id per send/request and settles synchronous acks safely', async () => {
  stationBridge.unregister()
  const ids = []
  stationBridge.register({
    SendMessage(_obj, _method, json) {
      const msg = JSON.parse(json)
      ids.push(msg.id)
      if (msg.type === 'stats.history') {
        // Synchronous reply before SendMessage returns!
        stationBridge.receive(JSON.stringify({
          schemaVersion: 2,
          kind: 'ack',
          id: msg.id,
          sessionId: msg.sessionId,
          revision: 1,
          accepted: true,
          payload: { runId: 'run-sync', from: 0, count: 0, total: 0, start: 23400, step: 60, stride: 13, values: [] },
        }))
      }
    },
  })

  const e1 = envelope('camera.orbit')
  const e2 = envelope('camera.orbit')
  assert.notEqual(e1.id, e2.id)

  const sendId1 = stationBridge.send('view.set', { key: 'level', value: 0 })
  const sendId2 = stationBridge.send('view.set', { key: 'level', value: -5 })
  assert.notEqual(sendId1, sendId2)

  const reply = await stationBridge.request('stats.history', { runId: 'run-sync', from: 0, limit: 128 })
  assert.equal(reply.runId, 'run-sync')
  assert.equal(new Set(ids).size, 3, 'every outbound send/request received a distinct id')
  stationBridge.unregister()
})

test('stationBridge.request scopes replies away from snapshot.revision while keeping commits on onCommit', async () => {
  stationBridge.unregister()
  const outbound = []
  stationBridge.register({
    SendMessage(_obj, _method, json) {
      outbound.push(JSON.parse(json))
    },
  })
  const sessionId = stationBridge.getSnapshot().sessionId

  let commits = 0
  const stopCommit = stationBridge.onCommit(() => { commits += 1 })
  let snapshotNotifications = 0
  const stopSub = stationBridge.subscribe(() => { snapshotNotifications += 1 })

  // Commit initial station at revision 5.
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2,
    kind: 'commit',
    id: 'c-init',
    sessionId,
    revision: 5,
    accepted: true,
    payload: { document: '{"format":"metro-save","version":1}', sourceId: 'zoo', sourceHash: 'h5' },
  }))
  assert.equal(stationBridge.getSnapshot().revision, 5)
  assert.equal(commits, 1)

  // Start a history read while revision is 5.
  const pendingRead = stationBridge.request('stats.history', { runId: 'run-1', from: 0, limit: 128 })
  const readEnvelope = outbound.at(-1)

  // Before the history read returns, an edit commits revision 6!
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2,
    kind: 'commit',
    id: 'c-edit',
    sessionId,
    revision: 6,
    accepted: true,
    payload: { document: '{"format":"metro-save","version":1,"edited":true}', sourceId: 'zoo', sourceHash: 'h6' },
  }))
  assert.equal(stationBridge.getSnapshot().revision, 6)
  assert.equal(stationBridge.getSnapshot().documentRevision, 6)
  assert.equal(commits, 2)

  const notificationsBeforeAck = snapshotNotifications
  // Now the older history ack arrives stamped with revision 5!
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2,
    kind: 'ack',
    id: readEnvelope.id,
    sessionId,
    revision: 5,
    accepted: true,
    payload: { runId: 'run-1', from: 0, count: 0, total: 0, start: 23400, step: 60, stride: 13, values: [] },
  }))

  const page = await pendingRead
  assert.equal(page.runId, 'run-1')
  assert.equal(stationBridge.getSnapshot().revision, 6, 'late history ack must never roll back snapshot.revision')
  assert.equal(stationBridge.getSnapshot().documentRevision, 6)
  assert.equal(snapshotNotifications, notificationsBeforeAck, 'scoped read ack must not fire snapshot listeners')

  stopSub()
  stopCommit()
  stationBridge.unregister()
})

test('stationBridge.request cancels cleanly on timeout, new player register, unregister, and host reject', async () => {
  stationBridge.unregister()
  const outbound = []
  stationBridge.register({
    SendMessage(_obj, _method, json) {
      outbound.push(JSON.parse(json))
    },
  })
  const firstSession = stationBridge.getSnapshot().sessionId

  // 1. Host rejection
  const rejectedReq = stationBridge.request('stats.history', { runId: 'old', from: 0, limit: 10 })
  const rejectedMsg = outbound.at(-1)
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2,
    kind: 'reject',
    id: rejectedMsg.id,
    sessionId: firstSession,
    revision: 2,
    accepted: false,
    code: 'stale-run',
    payload: { reason: 'Run retired.' },
  }))
  await assert.rejects(rejectedReq, err => err instanceof BridgeRequestError && err.code === 'stale-run')
  assert.equal(stationBridge.getSnapshot().rejects.length, 0, 'scoped read reject does not pollute UI rejects')

  // 2. Timeout + late ack after timeout
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2,
    kind: 'commit',
    sessionId: firstSession,
    revision: 9,
    payload: { document: '{}' },
  }))
  const timedOutReq = stationBridge.request('stats.history', { runId: 'r', from: 0, limit: 10 }, { timeoutMs: 15 })
  const timedOutMsg = outbound.at(-1)
  await assert.rejects(timedOutReq, err => err instanceof BridgeRequestError && err.code === 'timeout')
  // Late ack arriving after timeout with older revision 3 must be dropped without rolling back revision 9!
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2,
    kind: 'ack',
    id: timedOutMsg.id,
    sessionId: firstSession,
    revision: 3,
    accepted: true,
    payload: {},
  }))
  assert.equal(stationBridge.getSnapshot().revision, 9)

  // 3. New player registration cancels pending request from old player
  const acrossRegister = stationBridge.request('stats.history', { runId: 'r', from: 0, limit: 10 })
  stationBridge.register({ SendMessage(_o, _m, json) { outbound.push(JSON.parse(json)) } })
  await assert.rejects(acrossRegister, err => err instanceof BridgeRequestError && err.code === 'session-changed')

  // 4. Stale sessionId reply does not settle new session's pending request; unregister cancels it
  const onSecondSession = stationBridge.request('stats.history', { runId: 'r2', from: 0, limit: 10 })
  const secondMsg = outbound.at(-1)
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2,
    kind: 'ack',
    id: secondMsg.id,
    sessionId: firstSession,
    accepted: true,
    payload: { wrong: true },
  }))
  stationBridge.unregister()
  await assert.rejects(onSecondSession, err => err instanceof BridgeRequestError && err.code === 'disconnected')
})

test('statisticsAdapter pages >128 rows with one read in flight and handles coalesced state watermarks', async () => {
  const rows = Array.from({ length: 300 }, (_, i) => makeRow(i))
  const queries = []
  let pendingResolvers = []

  const adapter = createStatisticsAdapter(useStore, {
    requestHistory(query) {
      queries.push(query)
      return new Promise(resolve => {
        pendingResolvers.push({ query, resolve })
      })
    },
  })

  // Initial state carries 100 rows; ordinary state frame has NO values array!
  const snap100 = makeHostSnapshot('s-1', 'run-multi', 100, { population: 77 })
  assert.equal('values' in snap100.state.statistics.history, false)
  applyHostStatistics(adapter, snap100)

  assert.equal(useStore.getState().metrics?.population, 77)
  assert.equal(useStore.getState().history.count, 0)
  assert.equal(queries.length, 1)
  assert.deepEqual(queries[0], { runId: 'run-multi', from: 0, limit: 128 })

  // While page 1 is in flight, frames at count=180 (skipped 101..179) and count=300 arrive!
  applyHostStatistics(adapter, makeHostSnapshot('s-1', 'run-multi', 180, { tick: 180, population: 88 }))
  applyHostStatistics(adapter, makeHostSnapshot('s-1', 'run-multi', 300, { tick: 300, population: 99 }))
  assert.equal(queries.length, 1, 'must keep only one history read in flight per run')
  assert.equal(useStore.getState().metrics?.population, 99)

  // Resolve page 1 ([0..128) since host now has 300 rows, or [0..100) at the time it was read).
  // Test returning 128 rows first:
  pendingResolvers.shift().resolve(makePage('run-multi', rows, 0, 128))
  await flushMicrotasks()
  assert.equal(useStore.getState().history.count, 128)
  assert.equal(queries.length, 2)
  assert.deepEqual(queries[1], { runId: 'run-multi', from: 128, limit: 128 })

  // Resolve page 2 ([128..256)):
  pendingResolvers.shift().resolve(makePage('run-multi', rows, 128, 128))
  await flushMicrotasks()
  assert.equal(useStore.getState().history.count, 256)
  assert.equal(queries.length, 3)
  assert.deepEqual(queries[2], { runId: 'run-multi', from: 256, limit: 128 })

  // Resolve page 3 ([256..300)):
  pendingResolvers.shift().resolve(makePage('run-multi', rows, 256, 128))
  await flushMicrotasks()
  assert.equal(useStore.getState().history.count, 300)
  assert.equal(queries.length, 3, 'stops paging once watermark is reached')

  const simTimes = historySeries(useStore.getState().history.values, 'simTime', 300)
  assert.equal(simTimes[0], 23401)
  assert.equal(simTimes[299], 23401 + 299 * 60)

  adapter.disconnect()
})

test('statisticsAdapter drops stale in-flight replies across run resets without dropping the new run in-flight state', async () => {
  const run1Rows = [makeRow(0, { boarded: 99 }), makeRow(1, { boarded: 150 })]
  const run2Rows = [makeRow(0, { simTime: 30001, boarded: 5 }), makeRow(1, { simTime: 30061, boarded: 12 })]
  const resolvers = []

  const adapter = createStatisticsAdapter(useStore, {
    requestHistory(query) {
      return new Promise(resolve => {
        resolvers.push({ query, resolve })
      })
    },
  })

  applyHostStatistics(adapter, makeHostSnapshot('s-1', 'run-1', 2))
  assert.equal(resolvers.length, 1)
  assert.equal(resolvers[0].query.runId, 'run-1')

  // Before run-1 resolves, a seek/restart starts run-2!
  applyHostStatistics(adapter, makeHostSnapshot('s-1', 'run-2', 2, { simTime: 30061 }, 30001))
  assert.equal(useStore.getState().history.count, 0, 'new runId resets history immediately')
  assert.equal(resolvers.length, 2)
  assert.equal(resolvers[1].query.runId, 'run-2')
  assert.equal(adapter.getState().inFlight, true)

  // Resolve stale run-1 reply FIRST:
  resolvers[0].resolve(makePage('run-1', run1Rows, 0, 128))
  await flushMicrotasks()
  assert.equal(useStore.getState().history.count, 0, 'stale run reply must be ignored')
  assert.equal(adapter.getState().inFlight, true, 'stale reply must not clear run-2 inFlight guard')

  // Another state frame while run-2 is still in flight must NOT duplicate run-2's request:
  applyHostStatistics(adapter, makeHostSnapshot('s-1', 'run-2', 2, { simTime: 30062, tick: 62 }, 30001))
  assert.equal(resolvers.length, 2)

  // Resolve run-2 reply:
  resolvers[1].resolve(makePage('run-2', run2Rows, 0, 128, 30001))
  await flushMicrotasks()
  assert.equal(useStore.getState().history.count, 2)
  assert.deepEqual(historySeries(useStore.getState().history.values, 'boarded', 2), [5, 12])

  adapter.disconnect()
})

test('statisticsAdapter ignores duplicates, preserves good rows on malformed pages, and retries from cursor on later state/resync', async () => {
  const rows = [
    makeRow(0, { population: 11 }),
    makeRow(1, { population: 22 }),
    makeRow(2, { population: 33 }),
    makeRow(3, { population: 44 }),
  ]
  let hostCount = 2
  let failMalformed = false
  const queries = []

  const adapter = createStatisticsAdapter(useStore, {
    async requestHistory(query) {
      queries.push(query)
      const visibleRows = rows.slice(0, hostCount)
      if (failMalformed) {
        const bad = makePage('run-val', visibleRows, query.from, query.limit)
        bad.values[3] = Number.NaN
        return bad
      }
      return makePage('run-val', visibleRows, query.from, query.limit)
    },
  })

  // Load first 2 good rows.
  applyHostStatistics(adapter, makeHostSnapshot('s-1', 'run-val', 2))
  await flushMicrotasks()
  assert.equal(useStore.getState().history.count, 2)
  assert.deepEqual(historySeries(useStore.getState().history.values, 'population', 2), [11, 22])

  // Duplicate page is ignored cleanly.
  const dup = appendHistoryPage(adapter, makePage('run-val', rows.slice(0, 2), 0, 2), { sessionId: 's-1' })
  assert.equal(dup.status, 'ignored-duplicate')
  assert.equal(useStore.getState().history.count, 2)

  // Wrong stride, wrong session, gap offset, oversized count (>128), and Infinity values are rejected without mutating.
  assert.equal(
    appendHistoryPage(adapter, { ...makePage('run-val', rows, 2, 2), stride: 12 }, { sessionId: 's-1' }).status,
    'invalid',
  )
  assert.equal(
    appendHistoryPage(adapter, makePage('run-val', rows, 3, 1), { sessionId: 's-1' }).status,
    'invalid',
  )
  assert.equal(
    appendHistoryPage(adapter, makePage('run-val', rows, 2, 2), { sessionId: 's-other' }).status,
    'ignored-stale',
  )
  assert.equal(
    appendHistoryPage(adapter, {
      runId: 'run-val',
      from: 2,
      count: 129,
      total: 200,
      start: 23401,
      step: 60,
      stride: 13,
      values: new Array(129 * 13).fill(0),
    }, { sessionId: 's-1' }).status,
    'invalid',
  )
  assert.equal(useStore.getState().history.count, 2)

  // Now host advances to 4 rows, but transport returns a malformed NaN page:
  hostCount = 4
  failMalformed = true
  applyHostStatistics(adapter, makeHostSnapshot('s-1', 'run-val', 4, { tick: 181 }))
  await flushMicrotasks()
  assert.equal(queries.length, 2, 'did not spin in an infinite retry loop')
  assert.equal(useStore.getState().history.count, 2, 'preserved the last 2 good rows')
  assert.deepEqual(historySeries(useStore.getState().history.values, 'population', 2), [11, 22])

  // Next valid state / resync retries from cursor === 2 and completes [2..4):
  failMalformed = false
  applyHostStatistics(adapter, makeHostSnapshot('s-1', 'run-val', 4, { tick: 181 }), { resync: true })
  await flushMicrotasks()
  assert.equal(queries.at(-1).from, 2)
  assert.equal(useStore.getState().history.count, 4)
  assert.deepEqual(historySeries(useStore.getState().history.values, 'population', 4), [11, 22, 33, 44])

  adapter.disconnect()
})

test('statisticsAdapter deduplicates paused snapshots, handles disconnect/reconnect, and backfills fresh store on resync', async () => {
  const rows = [makeRow(0, { exited: 7 }), makeRow(1, { exited: 15 })]
  const queries = []
  let metricsWrites = 0
  const origSetMetrics = useStore.getState().setMetrics
  useStore.setState({
    setMetrics: m => {
      metricsWrites += 1
      origSetMetrics(m)
    },
  })

  try {
    const adapter = createStatisticsAdapter(useStore, {
      async requestHistory(query) {
        queries.push(query)
        return makePage('run-pause', rows, query.from, query.limit)
      },
    })

    // 5 paused polls with identical deterministic fields (even if tickMs jittered):
    for (let i = 0; i < 5; i++) {
      applyHostStatistics(adapter, makeHostSnapshot('s-1', 'run-pause', 2, { tick: 61, tickMs: 0.2 + i * 0.1 }))
    }
    await flushMicrotasks()
    assert.equal(metricsWrites, 1, 'unchanged paused snapshots must not repeatedly update SimSlice.metrics')
    assert.equal(queries.length, 1)
    assert.equal(useStore.getState().history.count, 2)

    // Repeated same-run resync when store already has all rows issues zero extra reads:
    applyHostStatistics(adapter, makeHostSnapshot('s-1', 'run-pause', 2, { tick: 61 }), { resync: true })
    await flushMicrotasks()
    assert.equal(queries.length, 1)

    // Same-run resync on a fresh store (count === 0) fetches from 0:
    useStore.getState().setHistory({ reset: true, from: 0, start: 23400, step: 60, values: new Float32Array(0) })
    assert.equal(useStore.getState().history.count, 0)
    applyHostStatistics(adapter, makeHostSnapshot('s-1', 'run-pause', 2, { tick: 61 }), { resync: true })
    await flushMicrotasks()
    assert.equal(queries.length, 2)
    assert.equal(queries.at(-1).from, 0)
    assert.equal(useStore.getState().history.count, 2)

    // Disconnect clears metrics to null and resets history:
    applyHostStatistics(adapter, { ready: false, sessionId: '', state: {} })
    assert.equal(useStore.getState().metrics, null)
    assert.equal(useStore.getState().history.count, 0)

    // Reconnect on new session populates cleanly:
    applyHostStatistics(adapter, makeHostSnapshot('s-2', 'run-pause', 2, { tick: 61 }))
    await flushMicrotasks()
    assert.equal(useStore.getState().metrics?.tick, 61)
    assert.equal(useStore.getState().history.count, 2)

    adapter.disconnect()
  } finally {
    useStore.setState({ setMetrics: origSetMetrics })
  }
})

test('main.tsx wires statisticsAdapter and drops zooStatus override while zooUi.tsx keeps its legacy fallback', () => {
  const mainSource = readFileSync(new URL('../../game/src/unity-web/main.tsx', import.meta.url), 'utf8')
  const zooSource = readFileSync(new URL('../../game/src/unity-web/zooUi.tsx', import.meta.url), 'utf8')
  assert.match(mainSource, /createStatisticsAdapter/)
  assert.match(mainSource, /applyHostStatistics/)
  assert.doesNotMatch(mainSource, /zooStatus/)
  assert.match(zooSource, /zooStatus/)
})
