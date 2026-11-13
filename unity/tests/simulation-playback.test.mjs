// Plan 13 §1 playback contract: the host publishes the session's capabilities beside
// its clock, and the shell must apply both from one `state` frame before a Play or a
// speed click may become a `sim.*` command.
//
// The bug this pins: `main.tsx` fed `receiveClock(clock)` with no capabilities, so the
// adapter kept its all-false defaults and `simulationStoreActions` returned before
// sending anything. Space and the 4× button produced no command and no transport.
//
// The frames below are the ones `StationGameHost.PublishStateNow` actually emits
// (`MergeState` keys + `StationSimulationSession.ClockPayloadJson` /
// `CapabilitiesPayloadJson`), reduced through the real `stationBridge.reduce`, so the
// test fails if either the payload or the adapter drifts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reduce } from '../../game/src/unity-web/stationBridge.ts'
import {
  NO_CAPABILITIES,
  createSimulationPort,
  receiveHostState,
  simulationAvailabilityOf,
  simulationStoreActions,
} from '../../game/src/unity-web/simulationAdapter.ts'

const sessionId = 's-test-1'

/** The clock object `StationClockFrame`/`ClockJson` serializes at cold boot (06:30). */
function clockPayload({ playing = false, speed = 1, simTimeSeconds = 23400, tick = 0 } = {}) {
  return {
    simTimeSeconds, dayIndex: 0, playing, speed, serviceOpen: true, peak: false,
    period: 'offpeak', dateKey: '2026-01-01', weekday: 4, dayType: 'workday',
    timeOfDaySeconds: 23400, dayFraction: 23400 / 86400, clock: '06:30', clockSeconds: '06:30:00',
    hourHandDegrees: 195, minuteHandDegrees: 180, tick,
    service: { from: 19800, to: 52200 },
    peaks: [{ from: 25200, to: 32400 }, { from: 61200, to: 68400 }],
    demandRate: 1,
  }
}

/** The capability object `StationSimulationHost.CapabilitiesPayloadJson` publishes. */
function capabilitiesPayload(overrides = {}, session = 'sim-abc123') {
  return {
    sessionId: session,
    clock: true, play: true, speed: true, seek: true, restart: true, serviceWindow: true,
    trains: true, doors: true, escalators: true, lifts: true,
    crowd: true, gates: true, queues: true, boarding: true,
    ...overrides,
  }
}

/** The `state` envelope `StationGameHost.PublishStateNow` sends (never a document). */
function hostStateFrame({ payload }) {
  return {
    schemaVersion: 2, kind: 'state', id: '', sessionId, revision: 7, accepted: true, code: null, payload,
  }
}

function hostStatePayload({ withCapabilities = true } = {}) {
  const payload = {
    level: -20,
    name: '动物园站',
    speed: 1,
    playing: false,
    tool: 'inspect',
    toolGeneration: 3,
    queued: 0,
    boarded: 0,
    clock: clockPayload(),
    camera: { position: [0, 0, 0], target: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], back: [0, 0, 1], fov: 45, ortho: true, level: -20 },
    view: { level: -20, showLevels: true },
  }
  if (withCapabilities) payload.simulationCapabilities = capabilitiesPayload()
  return payload
}

/** A bridge snapshot as the shell holds it: the reply reduced into the live snapshot. */
function snapshotOf(reply, current = { ready: true, sessionId, revision: 7, sourceId: 'zoo', sourceHash: 'abc', document: null, documentRevision: 7, state: {}, capabilities: {}, rejects: [] }) {
  return reduce(current, reply)
}

function harness() {
  const sent = []
  const port = createSimulationPort({ send: command => sent.push(command) })
  const store = {
    playing: false,
    speed: 1,
    unityClock: null,
    station: { calendar: { epoch: { year: 2026, month: 1, day: 1 } } },
    metrics: null,
    getState() { return store },
    setState(partial) { Object.assign(store, partial) },
  }
  const actions = simulationStoreActions(port, store)
  return { sent, port, store, actions }
}

test('a clock with no capabilities leaves the transport unavailable (negative control)', () => {
  const { sent, port, actions } = harness()
  const snapshot = snapshotOf(hostStateFrame({ payload: hostStatePayload({ withCapabilities: false }) }))
  const clock = receiveHostState(port, snapshot.state)
  assert.ok(clock, 'the clock itself is applied')
  assert.equal(port.getState().clock.simTimeSeconds, 23400)
  assert.deepEqual(port.getState().capabilities, NO_CAPABILITIES)
  assert.equal(port.unavailableReason('speed'), 'speed-unavailable')
  assert.equal(port.unavailableReason('play'), 'play-unavailable')
  actions.setSpeed(4)
  actions.setPlaying(true)
  assert.deepEqual(sent, [], 'no command may leave a session that has not claimed the transport')
})

test('the host capability object reaches the adapter from the same state frame', () => {
  const { sent, port, actions } = harness()
  const snapshot = snapshotOf(hostStateFrame({ payload: hostStatePayload() }))
  const clock = receiveHostState(port, snapshot.state)
  assert.ok(clock, 'the clock and the capabilities arrive together')
  const capabilities = port.getState().capabilities
  assert.equal(capabilities.sessionId, 'sim-abc123')
  assert.equal(capabilities.play, true)
  assert.equal(capabilities.speed, true)
  assert.deepEqual(simulationAvailabilityOf(port), { play: true, speed: true, seek: true, restart: true })
  assert.equal(port.unavailableReason('play'), null)
  assert.equal(port.unavailableReason('speed'), null)
  // The day-edit controls stay off until the host commits day edits itself.
  assert.equal(port.unavailableReason('serviceWindow'), 'day-edit-unavailable')

  actions.setSpeed(4)
  actions.setPlaying(true)
  assert.deepEqual(sent, [
    { type: 'sim.speed', payload: { speed: 4 } },
    { type: 'sim.play', payload: { playing: true } },
  ])
})

test('a rejected speed never leaves the port claiming it can drive speed', () => {
  const { sent, port, actions } = harness()
  const snapshot = snapshotOf(hostStateFrame({ payload: hostStatePayload() }), undefined)
  receiveHostState(port, { ...snapshot.state, simulationCapabilities: capabilitiesPayload({ speed: false }) })
  assert.equal(port.unavailableReason('speed'), 'speed-unavailable')
  actions.setSpeed(16)
  assert.deepEqual(sent, [], 'an unavailable speed is not sent')
  actions.setPlaying(true)
  assert.deepEqual(sent, [{ type: 'sim.play', payload: { playing: true } }], 'play still works when only speed is off')
})

test('a new simulation session resets the previous one capabilities', () => {
  const { sent, port, actions } = harness()
  const first = snapshotOf(hostStateFrame({ payload: hostStatePayload() }))
  receiveHostState(port, first.state)
  assert.equal(port.unavailableReason('play'), null)

  // A station switch installs a session of its own. The flags the old session
  // advertised must not survive it: this one publishes the clock only.
  receiveHostState(port, { ...first.state, simulationCapabilities: capabilitiesPayload({ play: false, speed: false }, 'sim-other') })
  assert.equal(port.getState().sessionId, 'sim-other')
  assert.equal(port.getState().capabilities.play, false, 'the new session answers for itself')
  assert.equal(port.unavailableReason('play'), 'play-unavailable')
  actions.setPlaying(true)
  assert.deepEqual(sent, [])
})

test('the clock reply is acknowledged state, never an optimistic toggle', async () => {
  const { port, store } = harness()
  const { applyUnityClock } = await import('../../game/src/unity-web/simulationAdapter.ts')
  const snapshot = snapshotOf(hostStateFrame({ payload: hostStatePayload() }))
  const clock = receiveHostState(port, snapshot.state)
  applyUnityClock(store, clock)
  assert.equal(store.playing, false, 'the C# clock is paused, so the UI is paused')
  assert.equal(store.speed, 1)
  assert.equal(store.unityClock, 23400)
  receiveHostState(port, {
    ...snapshot.state,
    clock: clockPayload({ playing: true, speed: 4, simTimeSeconds: 23401, tick: 1 }),
  })
  applyUnityClock(store, port.getState().clock)
  assert.equal(store.playing, true)
  assert.equal(store.speed, 4)
  assert.equal(store.unityClock, 23401, 'sim seconds, never a tick count')
})

test('a frame with no clock disconnects and disables every transport control', () => {
  const { port, actions, sent } = harness()
  const snapshot = snapshotOf(hostStateFrame({ payload: hostStatePayload() }))
  receiveHostState(port, snapshot.state)
  assert.equal(receiveHostState(port, { level: -20 }), null)
  port.disconnect()
  assert.equal(port.getState().clock, null)
  assert.equal(port.unavailableReason('play'), 'no-session')
  assert.deepEqual(simulationAvailabilityOf(port), { play: false, speed: false, seek: false, restart: false })
  actions.setPlaying(true)
  assert.deepEqual(sent, [])
})
